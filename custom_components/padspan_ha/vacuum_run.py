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

Research, 2026-11-24 (Valetudo 2026.10.0 source, Home Assistant's developer
docs): every advertisement during a stop (vacuum_sampler.py); the robot read
again when the stop ends, the stop dropped if it moved or is no longer idle;
a run ends sending nothing once someone or a Valetudo timer has the robot
(cleaning, driven by hand, paused, home on its own); a spot it reports it
cannot reach (a transient error) is skipped; a robot settled within ACCEPT_M
of its target, in the planned room, is at its stop; a run never starts on a
map the robot has made again since the import (its dock moved) or one with no
dock; the robot's no-go areas, virtual walls and obstacles are kept clear of;
a Valetudo timer firing within two hours is said on the card. How the stops'
readings are used is the owner's choice, made before the first run
(vacuum_use.py).

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
      "readings": [{"run_id": "rr_1a2b3c", "ts": 1764000000.0,   # epoch seconds, the stop's middle
                    "ts_start": 1763999990.0, "ts_end": 1764000010.0,  # the stop (2026-11-24, research S8)
                    "x_m": 3.21, "y_m": 4.5, "floor_id": "main", "room": "Kitchen",
                    "signal": -61, "bssid": "aa:bb:cc:dd:ee:ff",       # the median of the stop's reads
                    "frequency": "5ghz", "state": "connected",
                    "kind": "stop", "weight": 1.0}, ...]                 # oldest first
  }

ts_start and ts_end are on readings from 2026-11-24 on (older ones have ts
alone): a joining integration takes only what was heard between them.

kind and weight (2026-11-25, additive; version stays 1): "stop" at
STOP_WEIGHT (1.0) for a run's stop, "moving" at MOVING_WEIGHT (0.1) for a
reading taken while the robot cleans or drives on its own (vacuum_moving.py,
the owner's switch on its card, off by default). A moving reading has no
run_id, ts_start or ts_end: ts is the moment its Wi-Fi was read, its place
where the robot's map put it within vacuum_moving.FRESH_S (3 s) of that. A reading without kind
or weight is a stop at 1.0. A joining integration takes UniFi's side for a
moving reading only from a sample taken within a few seconds of its ts.

Fields Valetudo does not give are null. The SSID is not kept; neither it nor
a BSSID goes into the opt-in report (a run that read Wi-Fi is counted, no more).
Another integration in the same Home Assistant can read the same answer
without the websocket: robot_wifi_snapshot(hass) below.
"""

import asyncio
import logging
import math
import os
import statistics
import time
from datetime import datetime, timedelta, timezone
from typing import Any

from .calibration_store import ROBOT_LABEL
from .const import CALIBRATION_STORE_KEY, DATA_CALIBRATION, DATA_FABRIC, DOMAIN
from . import vacuum_import as vi
from . import vacuum_use as vu
from .vacuum_sampler import StopSampler, samples_bucket
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
ACCEPT_M = 1.0               # a robot settled this near its target, in the planned room, is at its stop (research S4)
DOCK_MOVED_M = 0.3           # the dock further than this from the import's: the map has changed (research B3)
TIMER_AHEAD_S = 2 * 3600.0   # a Valetudo timer firing this soon is said on the card (research S10)
SAMPLE_EVERY_S = 1.0         # the scanners read this often during a stop, without the every-packet callback
WIFI_READS = 3               # Wi-Fi reads per stop; the median signal is kept (research S8)
TIMERS_PATH = "/api/v2/timers"
# A Valetudo status the run did not ask for: someone (a person, a timer) has the robot now (research B2).
TAKEN_OVER = ("cleaning", "manual_control", "paused")
MAP_PATH = "/api/v2/robot/state/map"
ATTRS_PATH = "/api/v2/robot/state/attributes"
GOTO_PATH = "/api/v2/robot/capabilities/GoToLocationCapability"
CONTROL_PATH = "/api/v2/robot/capabilities/BasicControlCapability"
CONTROL_ACTIONS = ("start", "pause", "home")
WIFI_PATH = "/api/v2/robot/capabilities/WifiConfigurationCapability"
WIFI_KEPT = 2000             # Wi-Fi readings kept, the oldest dropped first
WIFI_VERSION = 1             # padspan_ha/robot_wifi_readings' shape
# How much one reading counts on the coverage map (the owner, 2026-11-25: "a far lower weight than standing
# still"): a stop stood ~20 s with three reads and its median; one taken on the move is a single read, up to
# vacuum_moving.FRESH_S (3 s) from its position, somewhere along about a metre of the robot's path. This one place sets both;
# the answer carries each reading's weight, and the Wi-Fi screen weighs by what it is given.
STOP_WEIGHT = 1.0
MOVING_WEIGHT = 0.1
MOVING_KEPT = 5000           # readings taken on the move, kept apart from the stops' WIFI_KEPT, the oldest dropped first


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
    out: dict[str, Any] = {"status": None, "flag": None, "error": None, "error_kind": None, "error_subsystem": None,
                           "battery": None, "charging": None}
    for a in attrs if isinstance(attrs, list) else []:
        if not isinstance(a, dict):
            continue
        if a.get("__class") == "StatusStateAttribute":
            out["status"] = str(a.get("value") or "")[:40] or None
            out["flag"] = str(a.get("flag") or "")[:40] or None
            err = a.get("error")
            if isinstance(err, dict):
                out["error"] = str(err.get("message") or "")[:200] or None
                sev = err.get("severity") if isinstance(err.get("severity"), dict) else {}
                out["error_kind"] = str(sev.get("kind") or "")[:20] or None          # transient | permanent | unknown
                out["error_subsystem"] = str(err.get("subsystem") or "")[:20] or None
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


def timer_soon(timers: Any, now: datetime | None = None, ahead_s: float = TIMER_AHEAD_S) -> str | None:
    """When the next enabled Valetudo timer fires within ahead_s (its time, UTC, ISO), or None.
    Timers are UTC, dow Sunday = 0 (Valetudo's ValetudoTimer)."""
    now = now or datetime.now(timezone.utc)
    best = None
    for t in (timers.values() if isinstance(timers, dict) else timers if isinstance(timers, list) else []):
        if not isinstance(t, dict) or not t.get("enabled"):
            continue
        try:
            hour, minute, dows = int(t.get("hour")), int(t.get("minute")), {int(d) for d in t.get("dow") or []}
        except (TypeError, ValueError):
            continue
        for day in (0, 1):
            at = (now + timedelta(days=day)).replace(hour=hour, minute=minute, second=0, microsecond=0)
            if (at.weekday() + 1) % 7 in dows and 0 <= (at - now).total_seconds() <= ahead_s:
                best = at if best is None or at < best else best
    return best.isoformat() if best else None


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

    # The owner's own restrictions on the robot's map (research S3): never a spot in a
    # no-go area, nor within WALL_CLEAR_M of a virtual wall or an obstacle the robot saw.
    ents = vmap.get("entities") if isinstance(vmap.get("entities"), list) else []
    nogo, lines, dots = [], [], []
    for e in ents:
        p = e.get("points") if isinstance(e, dict) else None
        if not isinstance(p, list) or len(p) < 2 or not all(isinstance(v, (int, float)) for v in p):
            continue
        xy = [(float(p[i]) / ps, float(p[i + 1]) / ps) for i in range(0, len(p) - 1, 2)]
        if e.get("type") == "no_go_area" and len(xy) >= 3:
            nogo.append(xy)
        elif e.get("type") == "virtual_wall" and len(xy) >= 2:
            lines.append((xy[0], xy[1]))
        elif e.get("type") == "obstacle":
            dots.append(xy[0])

    def _inside(x: float, y: float, poly: list) -> bool:
        hit = False
        for i in range(len(poly)):
            (x1, y1), (x2, y2) = poly[i - 1], poly[i]
            if (y1 > y) != (y2 > y) and x < (x2 - x1) * (y - y1) / (y2 - y1) + x1:
                hit = not hit
        return hit

    def _to_line(x: float, y: float, a: tuple, b: tuple) -> float:
        dx, dy = b[0] - a[0], b[1] - a[1]
        t = 0.0 if dx == dy == 0 else max(0.0, min(1.0, ((x - a[0]) * dx + (y - a[1]) * dy) / (dx * dx + dy * dy)))
        return math.hypot(x - a[0] - t * dx, y - a[1] - t * dy)

    def allowed(x: int, y: int) -> bool:
        cx, cy = x + 0.5, y + 0.5
        return (not any(_inside(cx, cy, g) for g in nogo)
                and all(_to_line(cx, cy, a, b) > c for a, b in lines)
                and all(math.hypot(cx - ox, cy - oy) > c for ox, oy in dots))

    def clear(x: int, y: int) -> bool:
        return allowed(x, y) and all((x + dx, y + dy) in free and (x + dx, y + dy) not in walls for dx, dy in disc)

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
    """A run as the card shows it: no point ids, no stops' readings."""
    out = {k: v for k, v in r.items() if k not in ("points", "stops")}
    out["points_kept"] = len(r.get("points") or [])
    out["stops_kept"] = len(r.get("stops") or [])
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
        self._rooms: dict = {}                 # the house's rooms, read at the run's start (a stop's room)
        self._own: dict[str, int] = {}         # the owner's own points per room, at the run's start (vacuum_use)
        self._sampled = "buffer"               # how the last stop heard the tag (vacuum_sampler)
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
        use = vu.use_of(vs)
        if use is None:
            raise RunRefused("no_use", "Choose how the robot's points are used first")
        st = robot_state(await robot_call(hass, base, "GET", ATTRS_PATH, auth=vs.basic_auth()))
        if isinstance(st["battery"], (int, float)) and st["battery"] < LOW_BATTERY:
            raise RunRefused("low_battery", "The robot's battery is low: let it charge first")
        vmap = await robot_call(hass, base, "GET", MAP_PATH, auth=vs.basic_auth())
        # Data safety (research B3): a map the robot has made again since the import is in
        # another frame; its points would land in the wrong places. Its dock tells.
        ents = vmap.get("entities") if isinstance(vmap, dict) and isinstance(vmap.get("entities"), list) else []
        dock = vi._point_entity(ents, "charger_location")
        was = lk.get("dock") if isinstance(lk.get("dock"), dict) else None
        if not dock:
            raise RunRefused("no_dock", "The robot's map shows no dock")
        if not was or not isinstance(was.get("x_m"), (int, float)) or \
                math.dist(vi._apply(lk["to_m"], dock["x"], dock["y"]), (was["x_m"], was["y_m"])) > DOCK_MOVED_M:
            raise RunRefused("map_changed", "The robot's map has changed since it was imported: import it again")
        plan = await hass.async_add_executor_job(plan_spots, vmap, room or None)
        if not plan["spots"]:
            raise RunRefused("no_spots", "No room on the robot's map has a spot clear of its walls")
        # A Valetudo timer about to fire (research S10): said on the card, never a reason not to run.
        try:
            soon = timer_soon(await robot_call(hass, base, "GET", TIMERS_PATH, auth=vs.basic_auth()))
        except Exception:  # noqa: BLE001 — no timers read: nothing to say
            _quiet_error("vacuum_run:timers")
            soon = None
        rid = f"rr_{os.urandom(3).hex()}"
        from .ws_backup import _auto_backup  # noqa: PLC0415
        backup_id = await _auto_backup(hass, f"Before the robot's room location run {rid}", [CALIBRATION_STORE_KEY],
                                       slot="robot_run", slot_keep=3)
        if not backup_id:
            raise RunRefused("backup_failed", "Calibration could not be backed up, so the run did not start")
        run = {"id": rid, "started": _now_iso(), "ended": None, "state": "running", "room": room or "",
               "rooms": sorted({s["room"] for s in plan["spots"]}), "small": plan["small"],
               "spots": len(plan["spots"]), "spot": 0, "at_room": "", "added": 0, "skipped": 0,
               "points": [], "undone": False, "error": "", "backup_id": backup_id, "wifi": 0,
               "use": use, "tag": tag, "stops": [], "kept": 0, "timer_soon": soon,
               "accuracy": {"before": await self._accuracy(), "after": None}}
        runs = vs.data.setdefault("runs", [])
        runs.append(run)
        trim_runs(runs, {str(p.get("id")) for p in cal.list_points()})
        await vs.async_save()
        self.current = run
        self._stop.clear()
        self._interrupt = self._left_dock = False
        fab = hass.data.get(DOMAIN, {}).get(DATA_FABRIC)
        self._rooms = fab.rooms_flat() if fab and hasattr(fab, "rooms_flat") else {}
        self._own = vu.own_per_room(cal.list_points(), self._rooms)
        coro = self._async_run(run, plan["spots"], base, dict(lk), tag, cal)
        # The config entry's own background task where there is one (research N1): Home
        # Assistant then ends it with PadSpan; async_shutdown_run has sent the robot home first.
        entry = next(iter(getattr(getattr(hass, "config_entries", None), "async_entries", lambda d: [])(DOMAIN)), None)
        if entry is not None and hasattr(entry, "async_create_background_task"):
            self._task = entry.async_create_background_task(hass, coro, "padspan_ha robot room location run")
        else:
            self._task = hass.async_create_background_task(coro, "padspan_ha robot room location run")
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

    async def _accuracy(self) -> dict | None:
        """The held-out score on the owner's own test spots (robot points are never test
        spots, heldout.py), worked out now: {knn, spatial} each {rooms_right_pc,
        median_error_m, spots}, or None (too few spots, or PadSpan still loading)."""
        pc = self.hass.data.get(DOMAIN, {}).get("presence_coordinator")
        if pc is None or not hasattr(pc, "async_heldout"):
            return None
        try:
            res = await pc.async_heldout(0.0)
        except Exception:  # noqa: BLE001 — no score: the card says nothing about it
            _quiet_error("vacuum_run:accuracy")
            return None
        if not isinstance(res, dict):
            return None
        keep = ("rooms_right_pc", "median_error_m", "spots")
        return {m: {k: (res.get(m) or {}).get(k) for k in keep} for m in ("knn", "spatial") if isinstance(res.get(m), dict)} or None

    async def _wait(self, s: float) -> bool:
        """Sleep s seconds; True when Stop was pressed meanwhile."""
        try:
            await asyncio.wait_for(self._stop.wait(), s)
            return True
        except asyncio.TimeoutError:
            return False

    async def _arrive(self, spot: dict, base: str, lk: dict | None = None) -> dict | None:
        """Read the robot until it stands at the spot: where it stands, or None
        (timed out, a spot it cannot reach, or stopped)."""
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
                # "Cannot reach target" is transient (Valetudo's Dreame robots: severity transient,
                # subsystem navigation): that spot is skipped and the run goes on (research S2).
                if st.get("error_kind") == "transient":
                    return None
                raise RobotError("robot_error", st["error"] or "The robot reports an error")
            # Going home on its own (to charge, or someone pressed Dock), or a low battery: the run ends.
            if st["status"] == "returning" or (st["status"] == "docked" and self._left_dock):
                raise RobotLeft("robot_home")
            # Cleaning, driven by hand or paused: a person or a Valetudo timer has it now (research B2).
            if st["status"] in TAKEN_OVER:
                raise RobotLeft("taken_over")
            if isinstance(st["battery"], (int, float)) and st["battery"] < LOW_BATTERY:
                raise RobotLeft("low_battery")
            if st["status"] not in (None, "docked"):
                self._left_dock = True
            pos = vi.robot_spot("valetudo", vmap)
            still = bool(pos and last and st["status"] != "moving"
                         and math.hypot(pos["x"] - last["x"], pos["y"] - last["y"]) / 100 < STILL_M)
            off = math.hypot(pos["x"] - spot["x"], pos["y"] - spot["y"]) / 100 if pos else None
            if still and off <= ARRIVE_M:
                return pos
            # Settled near it, in the room it was planned in: that is the stop (research S4);
            # where it stands is what is stored anyway.
            if still and off <= ACCEPT_M and lk and self._in_room(pos, spot["room"], lk):
                return pos
            last = pos
        return None

    def _in_room(self, pos: dict, room: str, lk: dict) -> bool:
        from .subzones import room_at  # noqa: PLC0415
        x, y = vi._apply(lk["to_m"], pos["x"], pos["y"])
        return bool(self._rooms) and room_at(self._rooms, str(lk.get("floor_id") or ""), x, y) == room

    async def _listen(self, sampler: StopSampler, seconds: float, base: str, wifi: list, wifi_at: list) -> bool:
        """seconds of the stop, read a second at a time (the scanners, and Wi-Fi at its
        moments); True when Stop was pressed."""
        t0 = time.monotonic()
        while True:
            left = seconds - (time.monotonic() - t0)
            if wifi_at and time.monotonic() - t0 >= wifi_at[0]:
                wifi_at.pop(0)
                try:
                    wifi.append(await robot_call(self.hass, base, "GET", WIFI_PATH, auth=self.vs.basic_auth()))
                except Exception:  # noqa: BLE001 — no Wi-Fi reading this time, the run goes on
                    _quiet_error("vacuum_run:wifi")
            if left <= 0:
                return False
            if await self._wait(min(SAMPLE_EVERY_S, left)):
                return True
            sampler.poll()

    async def _dwell(self, tag: str, base: str = "", wifi: list | None = None) -> list[dict] | None:
        """The tag's readings over the stop ([] too few heard; None stopped). Every
        packet each receiver hears (vacuum_sampler.py), with the buffer's samples as
        the fallback; the robot's Wi-Fi read WIFI_READS times along the way."""
        sampler = StopSampler(self.hass, tag)
        sampler.start()
        wifi = wifi if wifi is not None else []
        wifi_at = [DWELL_S * i / max(1, WIFI_READS - 1) for i in range(WIFI_READS)] if base else []
        try:
            if await self._listen(sampler, DWELL_S, base, wifi, wifi_at):
                return None
            got = good_readings(sampler.merged(vi.tag_samples(self.hass, tag, DWELL_S + 1)))
            if not got:
                if await self._listen(sampler, DWELL_MORE_S, base, wifi, []):
                    return None
                got = good_readings(sampler.merged(vi.tag_samples(self.hass, tag, DWELL_S + DWELL_MORE_S + 1)))
        finally:
            sampler.stop()
        self._sampled = sampler.mode
        for r in got or []:
            self._bump(samples_bucket(len(r["rssi_samples"])))
        return got

    async def _still_there(self, pos: dict, base: str) -> bool:
        """After the stop: the robot where it was and idle, or the stop is not kept (research B2)."""
        auth = self.vs.basic_auth()
        st = robot_state(await robot_call(self.hass, base, "GET", ATTRS_PATH, auth=auth))
        if st["status"] in TAKEN_OVER or st["status"] == "returning" or st["status"] == "docked":
            raise RobotLeft("taken_over" if st["status"] in TAKEN_OVER else "robot_home")
        now = vi.robot_spot("valetudo", await robot_call(self.hass, base, "GET", MAP_PATH, auth=auth))
        return bool(now and st["status"] == "idle"
                    and math.hypot(now["x"] - pos["x"], now["y"] - pos["y"]) / 100 <= STILL_M)

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
                pos = await self._arrive(sp, base, lk)
                if self._stop.is_set():
                    why = self._stopped()
                    break
                if pos is None:
                    run["skipped"] += 1
                    continue
                t_start, wifi = _now_iso(), []
                readings = await self._dwell(tag, base, wifi)
                t_end = _now_iso()
                self._wifi(run, sp, pos, lk, wifi, t_start, t_end)
                if readings is None:
                    why = self._stopped()
                    break
                if not readings or not await self._still_there(pos, base):
                    run["skipped"] += 1                   # too little heard, or it moved during the stop
                    continue
                x_m, y_m = vi._apply(lk["to_m"], pos["x"], pos["y"])
                stop = vu.stop_record(x_m, y_m, lk.get("floor_id") or "", sp["room"], t_start, t_end, readings)
                run["stops"].append(stop)
                # The owner's choice (vacuum_use.py): into calibration at its weight, or kept in the run's record.
                w = vu.decide(run["use"], sp["room"], self._own)
                if w is not None:
                    saved = await cal.async_add_point(vu.stop_point(run["id"], stop, w, tag, TAG_Z_M, DWELL_S))
                    stop["point_id"], stop["weight"] = saved["id"], w
                    run["points"].append(saved["id"])
                    run["added"] += 1
                else:
                    run["kept"] += 1
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

    def _wifi(self, run: dict, sp: dict, pos: dict, lk: dict, statuses: list, t_start: str, t_end: str) -> None:
        """The robot's Wi-Fi where it stood, kept for the coverage map: the median
        signal of the stop's reads (research S8), with the stop's start and end so
        another integration joins only what was heard inside it. No read: none kept."""
        ws = [w for w in (wifi_of(s) for s in statuses) if w]
        if not ws:
            return
        sig = [w["signal"] for w in ws if w["signal"] is not None]
        last = ws[-1]
        w = {**last, "signal": round(statistics.median(sig)) if sig else None}
        x_m, y_m = vi._apply(lk["to_m"], pos["x"], pos["y"])
        wifi = self.vs.data.setdefault("wifi", {"readings": [], "robot_ip": ""})
        ip = next((i for i in (robot_ip(s) for s in reversed(statuses)) if i), None)
        if ip:
            wifi["robot_ip"] = ip
        t0, t1 = datetime.fromisoformat(t_start).timestamp(), datetime.fromisoformat(t_end).timestamp()
        rd = wifi.setdefault("readings", [])
        rd.append({"run_id": run["id"], "ts": round((t0 + t1) / 2, 1), "ts_start": round(t0, 1), "ts_end": round(t1, 1),
                   "x_m": round(x_m, 3), "y_m": round(y_m, 3), "floor_id": lk.get("floor_id") or "", "room": sp["room"], **w})
        del rd[:max(0, len(rd) - WIFI_KEPT)]
        run["wifi"] = run.get("wifi", 0) + 1

    async def _finish(self, run: dict, why: str, base: str) -> None:
        # Going home already, low on battery, or someone else has it now: nothing more is sent.
        if why not in ("robot_home", "low_battery", "taken_over"):
            try:
                await robot_call(self.hass, base, "PUT", CONTROL_PATH, {"action": "home"}, auth=self.vs.basic_auth())
            except Exception:  # noqa: BLE001 — sent home when it can be; the run is over either way
                _quiet_error("vacuum_run:home")
                run["home_failed"] = True
        run["state"], run["ended"], run["at_room"] = why, _now_iso(), ""
        # The measured effect, beside the run's Undo: the owner's own test spots, now.
        if run.get("added") and isinstance(run.get("accuracy"), dict) and not self._interrupt:
            run["accuracy"]["after"] = await self._accuracy()
        try:
            await self.vs.async_save()
        except Exception:  # noqa: BLE001
            _quiet_error("vacuum_run:save")
        self._bump(why)
        self._bump(_points_bucket(run["added"]))
        if run.get("wifi"):
            self._bump("wifi_read")
        if getattr(self, "_sampled", None) in ("every", "poll"):
            self._bump(f"sampled_{self._sampled}")
        if run.get("use") in vu.USES:
            self._bump(f"use_{run['use']}")
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
        for s in run.get("stops") or []:
            if s.get("point_id") in ids:
                s["point_id"], s["weight"] = None, None
        run["undone"], run["undone_at"], run["removed"] = True, _now_iso(), removed
        await self.vs.async_save()
        self._bump("undone")
        return removed


def robot_wifi_snapshot(hass) -> dict[str, Any] | None:
    """The robot's Wi-Fi readings, the same version-1 shape as
    padspan_ha/robot_wifi_readings (the module docstring), for another
    integration in the same Home Assistant to call directly: UniFi Utopia's
    Wi-Fi survey reads it (as custom_components.padspan_ha.vacuum_run, once
    PadSpan is loaded) and joins each reading with what its access point hears
    from the robot. None while the vacuum store is not loaded yet. Reads only,
    never waits, never loads the store; the readings are copies. The stops
    (each run's, "kind" "stop") and those taken while the robot cleans
    ("kind" "moving", vacuum_moving.py) together, oldest first, each with its
    "weight"."""
    if not vi.licensed(hass):            # the Robot vacuum add-on's (vacuum_import.licensed): none without it
        return None
    vs = hass.data.get(DOMAIN, {}).get(vi.DATA_VACUUM)
    data = getattr(vs, "data", None)
    if not isinstance(data, dict):
        return None
    wifi = data.get("wifi") or {}
    stops = [{**r, "kind": "stop", "weight": STOP_WEIGHT} for r in wifi.get("readings") or [] if isinstance(r, dict)]
    moving = [dict(r) for r in wifi.get("moving") or [] if isinstance(r, dict)]
    readings = stops + moving
    if moving:
        readings.sort(key=lambda r: r.get("ts") or 0)       # oldest first, both kinds together
    return {"version": WIFI_VERSION, "robot_ip": wifi.get("robot_ip") or None, "readings": readings}


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
