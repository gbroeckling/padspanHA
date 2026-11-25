# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
# See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
from __future__ import annotations

"""
Wi-Fi while the robot cleans (the owner, 2026-11-25: "the roaming/working
robovac can also give wifi data, selectable, and a far lower weight than
standing still vac").

A switch on the robovac card, off by default, per house (the vacuum store's
robot.wifi_moving). While it is on, the robot is linked (the live position
on, its map from Valetudo), its address is known and no room location run is
going (a run keeps its own stops' Wi-Fi, vacuum_run.py), Valetudo's status
(StatusStateAttribute, GET /api/v2/robot/state/attributes) decides: cleaning,
moving or returning, and the robot's own Wi-Fi is read about every
SAMPLE_EVERY_S with where it is at that moment; docked, idle, paused or
anything else, nothing is read but that status, once every IDLE_CHECK_S.
Nothing is ever sent to the robot: three GETs, through vacuum_run.robot_call
(the robot's address checked as for every call, its login from the store).

The cadence rides the live link (vacuum_import.TICK_S, 10 s), so the map is
not read faster than needed:
  - right after the tick has read the map, its status, then its Wi-Fi
    (WifiConfigurationCapability), paired with the position the tick just
    read: no second map read. Only when the link reads Valetudo's map itself
    (read "url"); a camera's picture may be older than it looks, so then the
    map is read here too;
  - SAMPLE_EVERY_S after the tick began, the Wi-Fi again, then the map at once
    (one map read per sample, the two requests back to back).
While it cleans the map is read every 5 s instead of every 10 (one extra read
per tick, parsed off the event loop as the tick's is), plus one small Wi-Fi
request every 5 s and the status once per tick.

A reading is kept only when its position was read within FRESH_S of its
Wi-Fi (the robot drives about 0.3 m/s); otherwise, or without a position or
a signal, it is skipped. Kept as "moving" readings at
vacuum_run.MOVING_WEIGHT (0.1; a stop is 1.0) in the vacuum store's
wifi.moving, the last vacuum_run.MOVING_KEPT, apart from the stops' list so
they never push a stop out; written to disk at most once a minute
(VacuumStore.schedule_save). They go out with the stops through
vacuum_run.robot_wifi_snapshot (version 1, kind and weight per reading).

Nothing here is ever an error to the owner: a read that fails is a quiet
count (quiet_errors) and, with the opt-in report on, a closed-list counter
(telemetry ROBOT_WIFI_EVENTS); never an SSID, a BSSID or an address.
"""

import asyncio
import logging
import time
from datetime import datetime, timezone
from typing import Any

from .const import DATA_FABRIC, DOMAIN
from . import vacuum_import as vi
from . import vacuum_run as vr
from .quiet_errors import note as _quiet_error

_LOGGER = logging.getLogger(__name__)

SAMPLE_EVERY_S = 5.0         # a reading about this often while it cleans
FRESH_S = 3.0                # its position read at most this far from its Wi-Fi, or it is skipped
IDLE_CHECK_S = 60.0          # docked or idle: its status asked again after this
ACTIVE = ("cleaning", "moving", "returning")   # Valetudo's statuses it is read in
READ_BUCKETS = (1, 100, 1000)  # the day's readings: counted once as each is reached


def wanted(vs: vi.VacuumStore) -> bool:
    """The switch on, the robot linked to a Valetudo map, its address known, no run going."""
    robot = vs.data.get("robot") or {}
    lk = vs.data.get("link")
    if not robot.get("wifi_moving") or not vs.link_on() or not isinstance(lk, dict) or lk.get("format") != "valetudo":
        return False
    to_m = lk.get("to_m")
    if not (isinstance(to_m, list) and len(to_m) == 6) or not vr.robot_base(vs):
        return False
    eng = vs.hass.data.get(DOMAIN, {}).get(vr.DATA_RUN)
    return not (eng is not None and (eng.running or eng._starting))


def _today() -> str:
    return datetime.now(timezone.utc).date().isoformat()


class MovingWifi:
    """The one collector of a vacuum store (moving_for)."""

    def __init__(self, vs: vi.VacuumStore) -> None:
        self.vs = vs
        self._task: asyncio.Task | None = None
        self._idle_until = 0.0
        self._on_day = ""                       # the day robot_wifi:moving_on was counted
        self._reads: tuple[str, int] = ("", 0)  # (day, readings kept that day)

    def _bump(self, word: str) -> None:
        from .telemetry import bump as _b  # noqa: PLC0415
        _b(self.vs.hass, f"robot_wifi:{word}")

    def after_tick(self, t_pos: float | None, xy: tuple[float, float] | None) -> None:
        """The live link has just read the robot: t_pos when it asked Valetudo's map (None: it read
        a camera), xy where that put the robot in metres. Starts one round, never two at once."""
        if not wanted(self.vs):
            return
        if self._on_day != _today():
            self._on_day = _today()
            self._bump("moving_on")
        if (self._task is not None and not self._task.done()) or time.monotonic() < self._idle_until:
            return
        self._task = self.vs.hass.async_create_background_task(
            self._async_round(t_pos, xy), "padspan_ha robot Wi-Fi while it cleans")

    def cancel(self) -> None:
        if self._task is not None and not self._task.done():
            self._task.cancel()
        self._task = None

    async def _get(self, path: str) -> Any:
        return await vr.robot_call(self.vs.hass, vr.robot_base(self.vs), "GET", path, auth=self.vs.basic_auth())

    async def _async_round(self, t_pos: float | None, xy: tuple[float, float] | None) -> None:
        t0 = time.monotonic()
        try:
            st = vr.robot_state(await self._get(vr.ATTRS_PATH))
        except Exception:  # noqa: BLE001 — no status, no reading this time
            _quiet_error("vacuum_moving:status")
            self._bump("moving_failed")
            return
        if st["status"] not in ACTIVE:
            self._idle_until = time.monotonic() + IDLE_CHECK_S
            return
        await self._sample(t_pos, xy)
        left = SAMPLE_EVERY_S - (time.monotonic() - t0)
        if left > 0:
            await asyncio.sleep(left)
        if wanted(self.vs):
            await self._sample(None, None)

    async def _sample(self, t_pos: float | None, xy: tuple[float, float] | None) -> None:
        """One reading: the Wi-Fi, and the map's position unless the tick's is given."""
        lk = self.vs.data.get("link") or {}
        try:
            a = time.time()
            status = await self._get(vr.WIFI_PATH)
            t_wifi = (a + time.time()) / 2
            if t_pos is None:
                t_pos = time.time()            # Valetudo answers with the map as it is when asked
                spot = vi.robot_spot("valetudo", await self._get(vr.MAP_PATH))
                xy = vi._apply(lk["to_m"], spot["x"], spot["y"]) if spot else None
        except Exception:  # noqa: BLE001 — a read lost on Wi-Fi: this reading skipped
            _quiet_error("vacuum_moving:read")
            self._bump("moving_failed")
            return
        w = vr.wifi_of(status)
        if xy is None or not w or w["signal"] is None or abs(t_wifi - t_pos) > FRESH_S:
            self._bump("moving_skipped")
            return
        self._keep(status, w, t_wifi, xy, str(lk.get("floor_id") or ""))

    def _keep(self, status: Any, w: dict, ts: float, xy: tuple[float, float], floor_id: str) -> None:
        from .subzones import room_at  # noqa: PLC0415
        fab = self.vs.hass.data.get(DOMAIN, {}).get(DATA_FABRIC)
        rooms = fab.rooms_flat() if fab and hasattr(fab, "rooms_flat") else {}
        wifi = self.vs.data.setdefault("wifi", {"readings": [], "robot_ip": ""})
        ip = vr.robot_ip(status)
        if ip:
            wifi["robot_ip"] = ip
        mv = wifi.setdefault("moving", [])
        mv.append({"kind": "moving", "weight": vr.MOVING_WEIGHT, "ts": round(ts, 1),
                   "x_m": round(xy[0], 3), "y_m": round(xy[1], 3), "floor_id": floor_id,
                   "room": room_at(rooms, floor_id, xy[0], xy[1]) if rooms else "", **w})
        del mv[:max(0, len(mv) - vr.MOVING_KEPT)]
        self.vs.schedule_save()
        day, n = self._reads
        n = n + 1 if day == _today() else 1
        self._reads = (_today(), n)
        if n in READ_BUCKETS:
            self._bump(f"moving_read_{n}")


def moving_for(vs: vi.VacuumStore) -> MovingWifi:
    """The store's one collector."""
    mw = getattr(vs, "_moving", None)
    if mw is None:
        mw = vs._moving = MovingWifi(vs)
    return mw
