# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
# See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
from __future__ import annotations

"""
Room location runs: the robot vacuum as an optional room-location tool.

2026-11-24, the owner (by form): "Use the robot optionally as a room location
enhancement tool. Build that into the robovac card." Points it collects are
"Added, with undo": calibration is backed up before each run, a run's points
go into calibration as they are collected, and one tap removes exactly that
run's points again. Off until the owner starts a run; a run never starts by
itself, and one runs at a time.

PadSpan talks to the robot's own Valetudo REST API (Valetudo 2026.10.0,
backend/lib/webserver/capabilityRouters), never through Home Assistant's
vacuum entity, so nothing here needs MQTT:

  GET  /api/v2/robot/state/map            the ValetudoMap (vacuum_import parses it)
  GET  /api/v2/robot/state/attributes     StatusStateAttribute {value, flag, error?},
                                          BatteryStateAttribute {level, flag}
  PUT  /api/v2/robot/capabilities/GoToLocationCapability  {"action": "goto", "coordinates": {x, y}} (cm)
  PUT  /api/v2/robot/capabilities/BasicControlCapability  {"action": "start" | "stop" | "pause" | "home"}

The robot itself is never heard: the MOVA P10 Pro Ultra has no Bluetooth
radio PadSpan could use. What is heard is a fixed-address BLE beacon stuck on
top of it (the walker's tag setting), riding about TAG_Z_M off the floor.

A run:
  1. plan_spots: a grid RUN_SPACING_M apart inside each room (Valetudo
     segment), on known floor at least WALL_CLEAR_M from any wall, at least
     MIN_SPOTS_PER_ROOM in a room big enough for them, ordered room by room
     from the dock so the robot does not cross the house back and forth.
  2. calibration backed up (ws_backup._auto_backup, the one path every
     operation's safety net takes), else the run does not start.
  3. each spot: go-to; the map and status read every POLL_S until the robot
     stands within ARRIVE_M of it (or GOTO_TIMEOUT_S passes: the spot is
     skipped); then the tag is listened to for DWELL_S (once DWELL_MORE_S
     more when too few receivers heard it), by the walker's own rules; then
     one point is added through calibration_store's normal path, where the
     robot says it stands, labelled "[robot] <run id> <room>".
  4. the end, Stop, an error or RUN_LIMIT_S: the robot is sent home.

Nothing survives a Home Assistant restart: a run going then is over (its
points stay, and stay undoable).

Wi-Fi at each spot (the owner said yes to the robot for the Wi-Fi coverage
heatmap, 2026-11-24). Once the robot stands at a spot it is asked
GET /api/v2/robot/capabilities/WifiConfigurationCapability, Valetudo's
ValetudoWifiStatus {state: "connected" | "not_connected" | "unknown",
details: {ssid, bssid, signal (dBm), frequency ("2.4ghz" | "5ghz"), ips,
upspeed, downspeed}}. Each answer is kept in the vacuum store (the last
WIFI_KEPT); one that fails is skipped and the run goes on. Other integrations
(UniFi Utopia, which finds the robot among UniFi's clients by its IP) read
them through one admin-only command, versioned:

  padspan_ha/robot_wifi_readings  ->  {
      "version": 1,
      "robot_ip": "192.168.1.50" | null,    # from details.ips, the last one known
      "readings": [{"run_id": "rr_1a2b3c", "ts": 1764000000.0,   # epoch seconds
                    "x_m": 3.21, "y_m": 4.5, "floor_id": "main", "room": "Kitchen",
                    "signal": -61, "bssid": "aa:bb:cc:dd:ee:ff",
                    "frequency": "5ghz", "state": "connected"}, ...]   # oldest first
  }

Fields Valetudo does not give are null. The SSID is not kept; neither it nor
a BSSID goes into the opt-in report (a run that read Wi-Fi is counted, no more).
"""

import asyncio
import logging
import math
import os
import time
from datetime import datetime, timezone
from typing import Any

from .calibration_store import ROBOT_LABEL
from .const import CALIBRATION_STORE_KEY, DATA_CALIBRATION, DOMAIN
from . import vacuum_import as vi
from .quiet_errors import note as _quiet_error
from .util import address_url, async_check_address

_LOGGER = logging.getLogger(__name__)

DATA_RUN = "vacuum_run"

RUN_SPACING_M = 1.5          # spots this far apart, a grid in each room
WALL_CLEAR_M = 0.4           # a spot this far from any wall, on floor the robot mapped
MIN_SPOTS_PER_ROOM = 2       # in a room big enough: a small room gets these, further than SMALL_APART_M apart
SMALL_APART_M = 1.0
ARRIVE_M = 0.3               # there: this close to the spot
STILL_M = 0.05               # and moved less than this since the last read
POLL_S = 2.0                 # the robot read this often while it drives
GOTO_TIMEOUT_S = 90.0        # a spot not reached by then is skipped
DWELL_S = 20.0               # the tag listened to this long (a ~200 ms beacon: ~100 adverts)
DWELL_MORE_S = 15.0          # once more, when too few receivers heard it
RUN_LIMIT_S = 2 * 3600.0     # a run ends after this, wherever it is
TAG_Z_M = 0.1                # the tag rides on the robot's top, about this off the floor
RUNS_KEPT = 20               # runs in the history; one whose points are still in calibration is never dropped
LOW_BATTERY = 20             # %: below this a run does not start, and one going ends (the robot needs its dock)
POLL_FAILS = 3               # robot reads in a row that may fail while it drives before the run gives up
LABEL_PREFIX = ROBOT_LABEL     # calibration_store.is_owner_point: a run's points are PadSpan's, not the owner's
HEARD_WINDOW_S = 60.0        # "heard now": within the last minute
MAP_PATH = "/api/v2/robot/state/map"
ATTRS_PATH = "/api/v2/robot/state/attributes"
GOTO_PATH = "/api/v2/robot/capabilities/GoToLocationCapability"
CONTROL_PATH = "/api/v2/robot/capabilities/BasicControlCapability"
CONTROL_ACTIONS = ("start", "pause", "home")
WIFI_PATH = "/api/v2/robot/capabilities/WifiConfigurationCapability"
WIFI_KEPT = 2000             # Wi-Fi readings kept, the oldest dropped first
WIFI_VERSION = 1             # padspan_ha/robot_wifi_readings' shape


class RobotError(Exception):
    """The robot could not be reached or refused; `code` says which, for the card's words."""

    def __init__(self, code: str, text: str) -> None:
        super().__init__(text)
        self.code = code


class RobotLeft(Exception):
    """The robot is going home on its own, or its battery is low: the run ends and sends nothing more."""

    def __init__(self, why: str) -> None:
        super().__init__(why)
        self.why = why


class RunRefused(Exception):
    """A run (or an undo) that cannot start, with a code the card puts in words."""

    def __init__(self, code: str, text: str) -> None:
        super().__init__(text)
        self.code = code


# ── talking to Valetudo ─────────────────────────────────────────────────────

def robot_base(vs: vi.VacuumStore) -> str:
    """The robot's address: the one given in its card, else the link's when
    the map was imported from the robot's address. "" when neither."""
    url = str(((vs.data.get("robot") or {}).get("url")) or "").strip()
    lk = vs.data.get("link")
    if not url and isinstance(lk, dict) and lk.get("read") == "url":
        url = str(lk.get("ref") or "")
    url = url.rstrip("/")
    if url.endswith(MAP_PATH):
        url = url[:-len(MAP_PATH)]
    return url


async def robot_call(hass, base: str, method: str, path: str, body: dict | None = None,
                     auth: tuple[str, str] | None = None) -> Any:
    """One request to the robot's Valetudo. GET answers its JSON, PUT None.

    The same rules as the map import (vacuum_import.fetch_url_json): never this
    machine nor a link-local address, no redirect followed. The user and
    password go in the request only, never in a log or the report."""
    from homeassistant.helpers.aiohttp_client import async_get_clientsession  # noqa: PLC0415
    import aiohttp  # noqa: PLC0415
    url = address_url(base, path)
    await async_check_address(hass, url, "the robot")
    try:
        async with async_get_clientsession(hass).request(
                method, url, json=body, timeout=aiohttp.ClientTimeout(total=15), allow_redirects=False,
                auth=aiohttp.BasicAuth(*auth) if auth else None) as resp:
            if resp.status == 401:
                raise RobotError("auth", "The robot asked for its Valetudo user name and password (HTTP 401)")
            if 300 <= resp.status < 400:
                raise RobotError("refused", f"The robot's address sent PadSpan on to another address (HTTP {resp.status})")
            if resp.status >= 400:
                raise RobotError("refused", f"The robot answered HTTP {resp.status}")
            if method != "GET":
                return None
            raw = await vi.read_capped(resp)
    except (aiohttp.ClientError, asyncio.TimeoutError) as exc:
        raise RobotError("unreachable", f"The robot did not answer ({type(exc).__name__})") from exc
    except vi.VacuumImportError as exc:
        raise RobotError("refused", "The robot's answer is too large") from exc
    except ValueError as exc:      # a login aiohttp will not send (a ":" in the user name), or a bad address
        raise RobotError("bad_login", "The robot's address or login cannot be used") from exc
    try:
        return await hass.async_add_executor_job(vi._json_answer, raw)
    except vi.VacuumImportError as exc:
        raise RobotError("refused", str(exc)) from exc


def robot_state(attrs: Any) -> dict[str, Any]:
    """Status and battery from Valetudo's attributes list (StatusStateAttribute,
    BatteryStateAttribute); missing parts are None, unknown words kept as sent."""
    out: dict[str, Any] = {"status": None, "flag": None, "error": None, "battery": None, "charging": None}
    for a in attrs if isinstance(attrs, list) else []:
        if not isinstance(a, dict):
            continue
        if a.get("__class") == "StatusStateAttribute":
            out["status"] = str(a.get("value") or "")[:40] or None
            out["flag"] = str(a.get("flag") or "")[:40] or None
            err = a.get("error")
            if isinstance(err, dict):
                out["error"] = str(err.get("message") or "")[:200] or None
        elif a.get("__class") == "BatteryStateAttribute":
            lv = a.get("level")
            out["battery"] = round(float(lv)) if isinstance(lv, (int, float)) else None
            out["charging"] = a.get("flag") == "charging"
    return out


def wifi_of(status: Any) -> dict[str, Any] | None:
    """A ValetudoWifiStatus as one reading's Wi-Fi part, or None (not one)."""
    if not isinstance(status, dict):
        return None
    d = status.get("details") if isinstance(status.get("details"), dict) else {}
    sig = d.get("signal")
    freq = d.get("frequency")
    return {"state": str(status.get("state") or "unknown")[:20],
            "signal": round(float(sig)) if isinstance(sig, (int, float)) and math.isfinite(sig) else None,
            "bssid": str(d.get("bssid"))[:40].lower() if d.get("bssid") else None,
            "frequency": freq if freq in ("2.4ghz", "5ghz") else None}


def robot_ip(status: Any) -> str | None:
    """The robot's own address from details.ips: an IPv4 one not link-local first."""
    import ipaddress  # noqa: PLC0415
    ips = ((status or {}).get("details") or {}).get("ips") if isinstance(status, dict) else None
    good = []
    for s in ips if isinstance(ips, list) else []:
        try:
            ip = ipaddress.ip_address(str(s).split("%")[0])
        except ValueError:
            continue
        if not (ip.is_link_local or ip.is_loopback):
            good.append(ip)
    good.sort(key=lambda ip: ip.version)
    return str(good[0]) if good else None


# ── planning the spots ──────────────────────────────────────────────────────

def plan_spots(vmap: Any, room: str | None = None) -> dict[str, Any]:
    """Where the robot goes, from its own map: {"spots": [{room, x, y}] in the
    robot's centimetres, in the order it goes; "rooms": every room's name;
    "small": rooms too small for a spot}. `room`: that one room only."""
    if not isinstance(vmap, dict) or not isinstance(vmap.get("layers"), list):
        raise vi.VacuumImportError("Not a Valetudo map (no layers)")
    ps = float(vmap.get("pixelSize") or 5)
    if not (0.5 <= ps <= 50):
        raise vi.VacuumImportError("The map's pixel size is missing or unusable")
    walls: set[tuple[int, int]] = set()
    free: set[tuple[int, int]] = set()
    segs: list[tuple[str, set[tuple[int, int]]]] = []
    budget = vi.MAX_MASK_PX
    for lay in vmap["layers"]:
        if not isinstance(lay, dict) or lay.get("type") not in ("floor", "wall", "segment"):
            continue
        px = vi._layer_pixels(lay, budget)
        budget -= len(px)
        if lay["type"] == "wall":
            walls.update(px)
            continue
        free.update(px)
        if lay["type"] == "segment" and px:
            segs.append((vi.segment_name(lay, len(segs)), set(px)))
    rooms = [n for n, _ in segs]
    c = max(1, math.ceil(WALL_CLEAR_M * 100 / ps))
    disc = [(dx, dy) for dx in range(-c, c + 1) for dy in range(-c, c + 1) if dx * dx + dy * dy <= c * c]

    def clear(x: int, y: int) -> bool:
        return all((x + dx, y + dy) in free and (x + dx, y + dy) not in walls for dx, dy in disc)

    step = max(1, round(RUN_SPACING_M * 100 / ps))
    sub = max(1, round(0.25 * 100 / ps))
    apart = SMALL_APART_M * 100 / ps
    per_room: list[tuple[str, list[tuple[int, int]]]] = []
    small: list[str] = []
    for name, mask in segs:
        if room and name != room:
            continue
        xs, ys = [p[0] for p in mask], [p[1] for p in mask]
        x0, y0, x1, y1 = min(xs), min(ys), max(xs), max(ys)
        # The grid centred in the room's box, so the margins on both sides match.
        gx, gy = x0 + ((x1 - x0) % step) // 2, y0 + ((y1 - y0) % step) // 2
        pts = [(x, y) for x in range(gx, x1 + 1, step) for y in range(gy, y1 + 1, step)
               if (x, y) in mask and clear(x, y)]
        if len(pts) < MIN_SPOTS_PER_ROOM:
            # A small room: the clear spots on a finer grid, the one nearest the
            # middle first, then the furthest from those already taken.
            cand = [(x, y) for x in range(x0, x1 + 1, sub) for y in range(y0, y1 + 1, sub)
                    if (x, y) in mask and clear(x, y)]
            if cand and not pts:
                mx, my = sum(xs) / len(xs), sum(ys) / len(ys)
                pts.append(min(cand, key=lambda p: (p[0] - mx) ** 2 + (p[1] - my) ** 2))
            while cand and len(pts) < MIN_SPOTS_PER_ROOM:
                far = max(cand, key=lambda p: min(math.dist(p, q) for q in pts))
                if min(math.dist(far, q) for q in pts) < apart:
                    break
                pts.append(far)
        if pts:
            per_room.append((name, pts))
        else:
            small.append(name)
    # Room by room from the dock (else where the robot is): the room with the
    # nearest spot next, and in it the nearest spot each time.
    ents = vmap.get("entities") if isinstance(vmap.get("entities"), list) else []
    start = vi._point_entity(ents, "charger_location") or vi._point_entity(ents, "robot_position")
    at = (start["x"] / ps, start["y"] / ps) if start else (per_room[0][1][0] if per_room else (0, 0))
    order: list[dict[str, Any]] = []
    left = list(per_room)
    while left:
        i = min(range(len(left)), key=lambda k: min(math.dist(at, p) for p in left[k][1]))
        name, pts = left.pop(i)
        pts = list(pts)
        while pts:
            j = min(range(len(pts)), key=lambda k: math.dist(at, pts[k]))
            at = pts.pop(j)
            # The middle of the pixel, in whole centimetres: the robot's own map unit.
            order.append({"room": name, "x": round((at[0] + 0.5) * ps), "y": round((at[1] + 0.5) * ps)})
    return {"spots": order, "rooms": rooms, "small": small}


# ── the tag on the robot ────────────────────────────────────────────────────

def good_readings(readings: list[dict]) -> list[dict]:
    """The walker's rule: receivers with enough samples, and enough of them, else []."""
    from .calibration_store import MIN_SCANNER_SAMPLES  # noqa: PLC0415
    ok = [r for r in readings if len(r["rssi_samples"]) >= MIN_SCANNER_SAMPLES]
    return ok if len(ok) >= vi.WALK_MIN_SOURCES else []


def tag_heard(hass, tag: str) -> dict[str, Any]:
    """Whether the tag on the robot is heard now: by how many receivers in the
    last minute, and how long ago it was last heard (None: not in the buffer)."""
    from .bluetooth_live import DATA_KEY, _now  # noqa: PLC0415
    tag = str(tag or "").strip().upper()
    out: dict[str, Any] = {"receivers": len(vi.tag_samples(hass, tag, HEARD_WINDOW_S)) if tag else 0, "age_s": None}
    samples = getattr(hass.data.get(DOMAIN, {}).get(DATA_KEY), "_rssi_samples", None)
    per = next((v for k, v in samples.items() if str(k).upper() == tag), None) if tag and isinstance(samples, dict) else None
    last = [dq[-1][0] for src, dq in (per or {}).items() if dq and src != "_unknown"]
    if last:
        out["age_s"] = max(0, round((_now() - max(last)).total_seconds()))
    return out


# ── the run ─────────────────────────────────────────────────────────────────

def _now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def run_for_client(r: dict) -> dict:
    """A run as the card shows it: no point ids."""
    out = {k: v for k, v in r.items() if k != "points"}
    out["points_kept"] = len(r.get("points") or [])
    return out


def runs_for_card(runs: list[dict]) -> list[dict]:
    """Newest first: the last run, and every older one whose points can still be undone."""
    if not runs:
        return []
    return [runs[-1]] + [r for r in reversed(runs[:-1]) if r.get("points") and not r.get("undone")]


def trim_runs(runs: list[dict], in_calibration: set[str]) -> None:
    """The oldest runs over RUNS_KEPT go, but never one going, nor one with a point still in calibration."""
    extra = len(runs) - RUNS_KEPT
    keep = []
    for r in runs:
        if extra > 0 and r.get("state") != "running" and (r.get("undone") or not set(r.get("points") or []) & in_calibration):
            extra -= 1
            continue
        keep.append(r)
    runs[:] = keep


def _points_bucket(n: int) -> str:
    return "points_0" if n <= 0 else "points_1_5" if n <= 5 else "points_6_20" if n <= 20 else "points_21_plus"


class RunEngine:
    """The one run going (or none), and the history kept in the vacuum store."""

    def __init__(self, hass, vs: vi.VacuumStore) -> None:
        self.hass, self.vs = hass, vs
        self.current: dict | None = None
        self._task: asyncio.Task | None = None
        self._stop = asyncio.Event()
        self._starting = False                 # a start between its checks and its task: a second one waits
        self._interrupt = False                # stopped by PadSpan itself going (unload, restore, reset)
        self._left_dock = False                # "docked" ends a run only once the robot has left it
        # A run the store says was going is from before a restart: it is over.
        changed = False
        for r in vs.data.get("runs") or []:
            if r.get("state") == "running":
                r["state"], r["ended"] = "interrupted", r.get("ended") or _now_iso()
                changed = True
        self._dirty = changed

    @property
    def running(self) -> bool:
        return self._task is not None and not self._task.done()

    def _bump(self, word: str) -> None:
        from .telemetry import bump as _b  # noqa: PLC0415
        _b(self.hass, f"robot_run:{word}")

    async def async_settle(self) -> None:
        if self._dirty:
            self._dirty = False
            await self.vs.async_save()

    async def async_start(self, room: str | None = None) -> dict:
        """Check, plan, back up, then start the run in the background."""
        if self.running or self._starting:
            raise RunRefused("busy", "A run is going already")
        self._starting = True
        try:
            return await self._async_start(room)
        finally:
            self._starting = False

    async def _async_start(self, room: str | None) -> dict:
        vs, hass = self.vs, self.hass
        lk = vs.data.get("link")
        if not (isinstance(lk, dict) and lk.get("map_id") and lk.get("format") == "valetudo"
                and isinstance(lk.get("to_m"), list) and len(lk["to_m"]) == 6):
            raise RunRefused("no_map", "Import the robot's map from Valetudo first")
        base = robot_base(vs)
        if not base:
            raise RunRefused("no_address", "Give the robot's address first")
        tag = str((vs.data.get("walker") or {}).get("tag") or "").strip().upper()
        if not tag:
            raise RunRefused("no_tag", "Name the tag on the robot first")
        cal = hass.data.get(DOMAIN, {}).get(DATA_CALIBRATION)
        if not cal:
            raise RunRefused("not_ready", "PadSpan is still loading")
        st = robot_state(await robot_call(hass, base, "GET", ATTRS_PATH, auth=vs.basic_auth()))
        if isinstance(st["battery"], (int, float)) and st["battery"] < LOW_BATTERY:
            raise RunRefused("low_battery", "The robot's battery is low: let it charge first")
        vmap = await robot_call(hass, base, "GET", MAP_PATH, auth=vs.basic_auth())
        plan = await hass.async_add_executor_job(plan_spots, vmap, room or None)
        if not plan["spots"]:
            raise RunRefused("no_spots", "No room on the robot's map has a spot clear of its walls")
        rid = f"rr_{os.urandom(3).hex()}"
        from .ws_backup import _auto_backup  # noqa: PLC0415
        backup_id = await _auto_backup(hass, f"Before the robot's room location run {rid}", [CALIBRATION_STORE_KEY],
                                       slot="robot_run", slot_keep=3)
        if not backup_id:
            raise RunRefused("backup_failed", "Calibration could not be backed up, so the run did not start")
        run = {"id": rid, "started": _now_iso(), "ended": None, "state": "running", "room": room or "",
               "rooms": sorted({s["room"] for s in plan["spots"]}), "small": plan["small"],
               "spots": len(plan["spots"]), "spot": 0, "at_room": "", "added": 0, "skipped": 0,
               "points": [], "undone": False, "error": "", "backup_id": backup_id, "wifi": 0}
        runs = vs.data.setdefault("runs", [])
        runs.append(run)
        trim_runs(runs, {str(p.get("id")) for p in cal.list_points()})
        await vs.async_save()
        self.current = run
        self._stop.clear()
        self._interrupt = self._left_dock = False
        self._task = hass.async_create_background_task(
            self._async_run(run, plan["spots"], base, dict(lk), tag, cal), "padspan_ha robot room location run")
        self._bump("started")
        return run

    def stop(self) -> bool:
        if not self.running:
            return False
        self._stop.set()
        return True

    async def async_shutdown(self) -> None:
        """PadSpan itself is going (unloaded, a backup restored, a factory reset): the run
        going ends "interrupted", the robot is sent home, and its last save lands first."""
        if not self.running:
            return
        self._interrupt = True
        self._stop.set()
        try:
            await asyncio.wait_for(asyncio.shield(self._task), 30)
        except Exception:  # noqa: BLE001 — too slow or failed: it ends here regardless
            _quiet_error("vacuum_run:shutdown")
            self._task.cancel()

    def _stopped(self) -> str:
        return "interrupted" if self._interrupt else "stopped"

    async def _wait(self, s: float) -> bool:
        """Sleep s seconds; True when Stop was pressed meanwhile."""
        try:
            await asyncio.wait_for(self._stop.wait(), s)
            return True
        except asyncio.TimeoutError:
            return False

    async def _arrive(self, spot: dict, base: str) -> dict | None:
        """Read the robot until it stands at the spot: where it stands, or None
        (timed out, or stopped)."""
        end = time.monotonic() + GOTO_TIMEOUT_S
        last, fails = None, 0
        while time.monotonic() < end:
            if await self._wait(POLL_S):
                return None
            auth = self.vs.basic_auth()
            try:
                st = robot_state(await robot_call(self.hass, base, "GET", ATTRS_PATH, auth=auth))
                vmap = await robot_call(self.hass, base, "GET", MAP_PATH, auth=auth)
            except RobotError as exc:
                # A read lost on Wi-Fi now and then is no reason to end the run; a few in a row are.
                fails += 1
                if exc.code == "auth" or fails >= POLL_FAILS:
                    raise
                continue
            fails = 0
            if st["status"] == "error":
                raise RobotError("robot_error", st["error"] or "The robot reports an error")
            # Going home on its own (to charge, or someone pressed Dock), or a low battery: the run ends.
            if st["status"] == "returning" or (st["status"] == "docked" and self._left_dock):
                raise RobotLeft("robot_home")
            if isinstance(st["battery"], (int, float)) and st["battery"] < LOW_BATTERY:
                raise RobotLeft("low_battery")
            if st["status"] not in (None, "docked"):
                self._left_dock = True
            pos = vi.robot_spot("valetudo", vmap)
            if pos and math.hypot(pos["x"] - spot["x"], pos["y"] - spot["y"]) / 100 <= ARRIVE_M \
                    and st["status"] != "moving" and last \
                    and math.hypot(pos["x"] - last["x"], pos["y"] - last["y"]) / 100 < STILL_M:
                return pos
            last = pos
        return None

    async def _dwell(self, tag: str) -> list[dict] | None:
        """The tag's readings over the dwell ([] too few heard; None stopped)."""
        if await self._wait(DWELL_S):
            return None
        got = good_readings(vi.tag_samples(self.hass, tag, DWELL_S + 1))
        if got:
            return got
        if await self._wait(DWELL_MORE_S):
            return None
        return good_readings(vi.tag_samples(self.hass, tag, DWELL_S + DWELL_MORE_S + 1))

    async def _async_run(self, run: dict, spots: list[dict], base: str, lk: dict, tag: str, cal) -> None:
        deadline = time.monotonic() + RUN_LIMIT_S
        why = "finished"
        try:
            for i, sp in enumerate(spots):
                if self._stop.is_set():
                    why = self._stopped()
                    break
                if time.monotonic() > deadline:
                    why = "time_limit"
                    break
                run["spot"], run["at_room"] = i + 1, sp["room"]
                await robot_call(self.hass, base, "PUT", GOTO_PATH,
                                 {"action": "goto", "coordinates": {"x": sp["x"], "y": sp["y"]}}, auth=self.vs.basic_auth())
                pos = await self._arrive(sp, base)
                if self._stop.is_set():
                    why = self._stopped()
                    break
                if pos is None:
                    run["skipped"] += 1
                    continue
                await self._wifi(run, sp, pos, lk, base)
                readings = await self._dwell(tag)
                if readings is None:
                    why = self._stopped()
                    break
                if not readings:
                    run["skipped"] += 1
                    continue
                x_m, y_m = vi._apply(lk["to_m"], pos["x"], pos["y"])
                saved = await cal.async_add_point({
                    "map_id": "", "x_frac": 0.5, "y_frac": 0.5,
                    "x_m": round(x_m, 3), "y_m": round(y_m, 3), "floor_id": lk.get("floor_id") or "",
                    "room": sp["room"],
                    "label": f"{LABEL_PREFIX} {run['id']} {sp['room']} (tag {TAG_Z_M:g} m above the floor)",
                    "device_id": tag, "collected_at": _now_iso(), "duration_s": round(DWELL_S),
                    "scanner_readings": readings,
                })
                run["points"].append(saved["id"])
                run["added"] += 1
                await self.vs.async_save()
        except RobotLeft as exc:
            why = exc.why
        except RobotError as exc:
            why, run["error"] = "failed", exc.code
        except asyncio.CancelledError:
            why = self._stopped()
            raise
        except Exception:  # noqa: BLE001 — the run ends, its points stay
            _quiet_error("vacuum_run:run")
            _LOGGER.debug("Robot room location run failed", exc_info=True)
            why, run["error"] = "failed", "other"
        finally:
            await self._finish(run, why, base)

    async def _wifi(self, run: dict, sp: dict, pos: dict, lk: dict, base: str) -> None:
        """The robot's Wi-Fi where it stands, kept for the coverage map. A read
        that fails is skipped: it never stops the run."""
        try:
            status = await robot_call(self.hass, base, "GET", WIFI_PATH, auth=self.vs.basic_auth())
        except Exception:  # noqa: BLE001 — no Wi-Fi reading at this spot, the run goes on
            _quiet_error("vacuum_run:wifi")
            return
        w = wifi_of(status)
        if not w:
            return
        x_m, y_m = vi._apply(lk["to_m"], pos["x"], pos["y"])
        wifi = self.vs.data.setdefault("wifi", {"readings": [], "robot_ip": ""})
        ip = robot_ip(status)
        if ip:
            wifi["robot_ip"] = ip
        rd = wifi.setdefault("readings", [])
        rd.append({"run_id": run["id"], "ts": round(time.time(), 1), "x_m": round(x_m, 3), "y_m": round(y_m, 3),
                   "floor_id": lk.get("floor_id") or "", "room": sp["room"], **w})
        del rd[:max(0, len(rd) - WIFI_KEPT)]
        run["wifi"] = run.get("wifi", 0) + 1

    async def _finish(self, run: dict, why: str, base: str) -> None:
        # Going home already (or low on battery, on its way): nothing more is sent.
        if why not in ("robot_home", "low_battery"):
            try:
                await robot_call(self.hass, base, "PUT", CONTROL_PATH, {"action": "home"}, auth=self.vs.basic_auth())
            except Exception:  # noqa: BLE001 — sent home when it can be; the run is over either way
                _quiet_error("vacuum_run:home")
                run["home_failed"] = True
        run["state"], run["ended"], run["at_room"] = why, _now_iso(), ""
        try:
            await self.vs.async_save()
        except Exception:  # noqa: BLE001
            _quiet_error("vacuum_run:save")
        self._bump(why)
        self._bump(_points_bucket(run["added"]))
        if run.get("wifi"):
            self._bump("wifi_read")
        _LOGGER.info("Robot room location run %s %s: %d points added, %d spots skipped",
                     run["id"], why, run["added"], run["skipped"])

    async def async_undo(self, run_id: str) -> int:
        """Remove exactly that run's points: its recorded ids, each still
        labelled as that run's. Nothing else is touched."""
        run = next((r for r in self.vs.data.get("runs") or [] if r.get("id") == run_id), None)
        if not run:
            raise RunRefused("not_found", "That run is no longer in the list")
        if self.current is run and self.running:
            raise RunRefused("busy", "Stop the run first")
        if run.get("undone"):
            raise RunRefused("undone", "That run was undone already")
        cal = self.hass.data.get(DOMAIN, {}).get(DATA_CALIBRATION)
        if not cal:
            raise RunRefused("not_ready", "PadSpan is still loading")
        mine = set(run.get("points") or [])
        prefix = f"{LABEL_PREFIX} {run_id} "
        ids = {p["id"] for p in cal.list_points() if p.get("id") in mine and str(p.get("label") or "").startswith(prefix)}
        removed = await cal.async_delete_points(ids) if ids else 0
        run["undone"], run["undone_at"], run["removed"] = True, _now_iso(), removed
        await self.vs.async_save()
        self._bump("undone")
        return removed


def engine(hass, vs: vi.VacuumStore) -> RunEngine:
    """The one engine: a run going is never left behind by a second one (it stays
    stoppable); a new store gets a new engine only once none is going."""
    dom = hass.data.setdefault(DOMAIN, {})
    eng = dom.get(DATA_RUN)
    if eng is None or (eng.vs is not vs and not (eng.running or eng._starting)):
        eng = RunEngine(hass, vs)
        dom[DATA_RUN] = eng
    return eng


async def async_shutdown_run(hass) -> None:
    """End the run going, if any, and forget the engine (unload, restore, factory reset)."""
    eng = hass.data.get(DOMAIN, {}).pop(DATA_RUN, None)
    if eng is not None:
        await eng.async_shutdown()
