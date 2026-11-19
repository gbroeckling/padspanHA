"""How fast a room change is shown, and how often a still device flickers,
measured through PadSpan's own pipeline on an explicit clock.

SYNTHETIC WALKS. No recorded walk with room marks exists: this PC and the home
server were searched on 2026-11-18 for capture sessions (capture_store's
format) and walk logs, and the only recording found, fm_shadow_0927, is a Find
My shadow of two still tags with no room marks. What could be taken from it
was: how often each real scanner refreshes a device (per scanner, not per
signal level: some proxies hold a fresh reading every 1-3 s, others only every
~20 s, consistent with ESPHome's default 30 ms / 320 ms scan window), and the
size of the noise on a still device (about 2.6 dB between new adverts).

What runs is PadSpan's code, unchanged:

  air -> FakeScanner lists + habluetooth-style callbacks
      -> BluetoothLive (_on_adv, the scanner reseed, get_snapshot)
      -> one real PresenceCoordinator poll (_async_update_data) per 5 s

Only the radio and Home Assistant's Bluetooth manager are modelled (below).
Time is a Clock that the walk advances; nothing reads the wall clock, so the
numbers do not depend on how fast the machine runs.

Used by tests/test_room_speed.py: the regression bounds, and the full report
(PADSPAN_ROOM_SPEED_REPORT=1).
"""

from __future__ import annotations

import asyncio
import datetime as dt
import math
import random
import statistics
import sys
from contextlib import contextmanager
from dataclasses import dataclass, field
from datetime import timedelta
from types import SimpleNamespace
from typing import Any, Iterator
from unittest.mock import MagicMock, patch

from custom_components.padspan_ha import bluetooth_live as _bl
from custom_components.padspan_ha import presence_coordinator as _pc
from custom_components.padspan_ha.const import DATA_SETTINGS, DOMAIN
from custom_components.padspan_ha.settings_store import DEFAULT_SETTINGS

# ── The house: one floor, 10 m x 10 m, a hall down the middle ───────────────
ROOMS: dict[str, tuple[float, float, float, float]] = {   # x0, y0, x1, y1 (m)
    "Kitchen": (0.0, 0.0, 4.0, 5.0),
    "Lounge": (0.0, 5.0, 4.0, 10.0),
    "Hall": (4.0, 0.0, 6.0, 10.0),
    "Office": (6.0, 0.0, 10.0, 4.0),
    "Bedroom": (6.0, 4.0, 10.0, 8.0),
    "Bath": (6.0, 8.0, 10.0, 10.0),
}
DOORS: dict[frozenset, tuple[float, float]] = {           # door centre, 1 m wide
    frozenset(("Kitchen", "Hall")): (4.0, 2.5),
    frozenset(("Lounge", "Hall")): (4.0, 7.5),
    frozenset(("Office", "Hall")): (6.0, 2.0),
    frozenset(("Bedroom", "Hall")): (6.0, 6.0),
    frozenset(("Bath", "Hall")): (6.0, 9.0),
    frozenset(("Kitchen", "Lounge")): (2.0, 5.0),
}
# One scanner per room. duty: the share of a device's adverts the scanner
# catches when the signal is good. Half are tuned proxies, half are left at
# ESPHome's default scan window (~9 %), as on the reference house.
SCANNERS: dict[str, tuple[float, float, str, float]] = {
    "AA:00:00:00:00:01": (0.6, 0.8, "Kitchen", 0.85),
    "AA:00:00:00:00:02": (0.6, 9.2, "Lounge", 0.09),
    "AA:00:00:00:00:03": (5.0, 5.0, "Hall", 0.85),
    "AA:00:00:00:00:04": (9.4, 0.6, "Office", 0.09),
    "AA:00:00:00:00:05": (9.4, 6.0, "Bedroom", 0.85),
    "AA:00:00:00:00:06": (9.4, 9.4, "Bath", 0.09),
}
# Rooms whose scanner catches most adverts, and those left at the default
# scan window (where a move can only show once that scanner hears one).
TUNED_ROOMS = {v[2] for v in SCANNERS.values() if v[3] >= 0.5}
SPARSE_ROOMS = set(ROOMS) - TUNED_ROOMS
SCANNER_Z_M = 1.5
DEVICE_Z_M = 1.0
WALL_DB = 4.0             # one interior wall
PATH_LOSS_N = 2.3
WALK_MS = 1.2             # walking speed

# ── The radio ────────────────────────────────────────────────────────────────
SLOW_SIGMA_DB = 2.5       # body / furniture shadowing, changes over seconds
SLOW_TAU_S = 10.0
FAST_SIGMA_DB = 2.5       # advert to advert
FADE_P = 0.05             # a deep multipath fade on this advert
FADE_DB = (6.0, 14.0)
HEAR_FLOOR_DBM = -98.0    # nothing heard below; full duty from 8 dB above

# Home Assistant's Bluetooth manager (habluetooth 3.7.0, bleak-retry-connector
# RSSI_SWITCH_THRESHOLD 5): callbacks come from ONE preferred scanner per
# address, which changes only when another is 5 dB stronger or the preferred
# one has not heard the device for its advert interval + 5 s; and only when
# the advert's data changed.
RSSI_SWITCH_DB = 5.0
STALE_WOBBLE_S = 5.0


@dataclass(frozen=True)
class Device:
    name: str
    address: str
    interval_s: float      # advert interval
    tx_1m: float           # RSSI at 1 m
    payload_change_p: float  # chance an advert's data differs from the last


PHONE = Device("phone", "C0:FF:EE:00:00:01", 1.0, -59.0, 0.3)
TAG = Device("tag", "C0:FF:EE:00:00:02", 2.0, -62.0, 0.0)


def _walls() -> list[tuple[tuple[float, float], tuple[float, float]]]:
    """Every room edge as wall segments, with the doors cut out."""
    edges: dict[tuple, int] = {}
    for x0, y0, x1, y1 in ROOMS.values():
        for a, b in (((x0, y0), (x1, y0)), ((x1, y0), (x1, y1)),
                     ((x0, y1), (x1, y1)), ((x0, y0), (x0, y1))):
            edges[tuple(sorted((a, b)))] = 1
    out = []
    for (a, b) in edges:
        cuts = []
        for (dx, dy) in DOORS.values():
            if a[0] == b[0] == dx and min(a[1], b[1]) <= dy <= max(a[1], b[1]):
                cuts.append((dy - 0.5, dy + 0.5))
            elif a[1] == b[1] == dy and min(a[0], b[0]) <= dx <= max(a[0], b[0]):
                cuts.append((dx - 0.5, dx + 0.5))
        vertical = a[0] == b[0]
        lo, hi = (a[1], b[1]) if vertical else (a[0], b[0])
        lo, hi = min(lo, hi), max(lo, hi)
        pos = lo
        for c0, c1 in sorted(cuts):
            if c0 > pos:
                out.append(((a[0], pos), (a[0], c0)) if vertical else ((pos, a[1]), (c0, a[1])))
            pos = max(pos, c1)
        if pos < hi:
            out.append(((a[0], pos), (a[0], hi)) if vertical else ((pos, a[1]), (hi, a[1])))
    return out


WALLS = _walls()


def _crosses(p, q, a, b) -> bool:
    def cr(o, u, v):
        return (u[0] - o[0]) * (v[1] - o[1]) - (u[1] - o[1]) * (v[0] - o[0])
    d1, d2, d3, d4 = cr(a, b, p), cr(a, b, q), cr(p, q, a), cr(p, q, b)
    return ((d1 > 0) != (d2 > 0)) and ((d3 > 0) != (d4 > 0)) and d1 * d2 != 0 and d3 * d4 != 0


def mean_rssi(dev: Device, x: float, y: float, sx: float, sy: float) -> float:
    d = math.sqrt((x - sx) ** 2 + (y - sy) ** 2 + (SCANNER_Z_M - DEVICE_Z_M) ** 2)
    walls = sum(1 for a, b in WALLS if _crosses((x, y), (sx, sy), a, b))
    return dev.tx_1m - 10.0 * PATH_LOSS_N * math.log10(max(d, 0.5)) - WALL_DB * walls


def room_at(x: float, y: float) -> str | None:
    for name, (x0, y0, x1, y1) in ROOMS.items():
        if x0 <= x < x1 and y0 <= y < y1:
            return name
    return None


# ── The clock ────────────────────────────────────────────────────────────────
class Clock:
    """Simulated time. monotonic() and time() as the time module's; now() as
    bluetooth_live._now. Every reader in the pipeline is pointed here."""

    MONO0 = 10_000.0
    EPOCH0 = 1_790_000_000.0

    def __init__(self) -> None:
        self.t = 0.0

    def monotonic(self) -> float:
        return self.MONO0 + self.t

    def time(self) -> float:
        return self.EPOCH0 + self.t

    def perf_counter(self) -> float:
        return self.t

    def thread_time(self) -> float:
        return self.t

    def now(self) -> dt.datetime:
        return dt.datetime.fromtimestamp(self.EPOCH0 + self.t, tz=dt.timezone.utc)


# ── Home Assistant's side: scanners and the manager ──────────────────────────
class FakeScanner:
    """A habluetooth remote scanner: the latest advert per address and when."""

    def __init__(self, source: str) -> None:
        self.source = source
        self.discovered_devices_and_advertisement_data: dict[str, tuple] = {}
        self.discovered_device_timestamps: dict[str, float] = {}

    def heard(self, addr: str, rssi: int, mono: float, payload: int) -> None:
        dev = SimpleNamespace(address=addr, name="", details={})
        adv = SimpleNamespace(rssi=rssi, local_name="", tx_power=None, service_uuids=[],
                              service_data={}, manufacturer_data={0xFFFF: payload.to_bytes(4, "big")})
        self.discovered_devices_and_advertisement_data[addr] = (dev, adv)
        self.discovered_device_timestamps[addr] = mono


class FakeManager:
    """The bits of habluetooth's manager PadSpan reads, plus its callback rule."""

    def __init__(self, scanners: list[FakeScanner]) -> None:
        self._scanners = scanners
        self.history: dict[str, tuple[str, float, float, int]] = {}   # addr -> (src, rssi, mono, payload)

    def async_current_scanners(self) -> list[FakeScanner]:
        return list(self._scanners)

    def async_last_service_info(self, addr: str, connectable: bool) -> None:
        return None

    def dispatch(self, addr: str, src: str, rssi: float, mono: float, payload: int,
                 stale_s: float) -> bool:
        """habluetooth's scanner_adv_received, reduced to what decides whether
        PadSpan's callback runs. True when it would."""
        old = self.history.get(addr)
        if old is not None and src != old[0]:
            if not (mono - old[2] > stale_s or rssi - RSSI_SWITCH_DB > old[1]):
                return False
        self.history[addr] = (src, rssi, mono, payload)
        return old is None or payload != old[3]


class FakeModel:
    """The house drawn in PadSpan's fabric: rooms, scanner positions and walls,
    so the poll takes its spatial path (Path A) instead of strongest-scanner
    (Path B). Only what the poll reads; nothing is stored."""

    data: dict[str, Any] = {}

    def __init__(self) -> None:
        from custom_components.padspan_ha.model_store import ModelStore
        self._room_of = ModelStore.beacon_room_from_geometry

    def beacon_room_from_geometry(self, x_m: float, y_m: float, floor_id: str) -> str:
        return self._room_of(self, x_m, y_m, floor_id)

    async def async_sync_floors(self, floors) -> None:
        return None

    async def async_set_adjacency(self, room, neighbours) -> None:
        return None

    def sync_mode(self) -> str:
        return "manual"

    def get_scanner_mappings(self):
        return ({s: v[2] for s, v in SCANNERS.items()}, {s: "main" for s in SCANNERS})

    def beacon_positions_m(self) -> dict:
        return {}

    def room_geometry_m(self) -> dict:
        return {r: {"type": "poly", "floor_id": "main",
                    "points_m": [[x0, y0], [x1, y0], [x1, y1], [x0, y1]]}
                for r, (x0, y0, x1, y1) in ROOMS.items()}

    def room_centroids_m(self) -> dict:
        return {r: ((x0 + x1) / 2, (y0 + y1) / 2, "main") for r, (x0, y0, x1, y1) in ROOMS.items()}

    def scanner_positions_m(self) -> dict:
        return {s: {"x_m": v[0], "y_m": v[1], "floor_id": "main"} for s, v in SCANNERS.items()}

    def scanner_absolute_z_m(self) -> dict:
        return {s: SCANNER_Z_M for s in SCANNERS}

    def floor_base_elevations_m(self) -> dict:
        return {"main": 0.0}

    def floor_stack_index(self) -> dict:
        return {"main": 0}

    def rf_barriers_m(self) -> list:
        return [{"points_m": [list(a), list(b)], "attenuation_dbm": WALL_DB,
                 "material": "drywall", "floor_id": "main"} for a, b in WALLS]

    def adjacency(self) -> dict:
        return {}

    def metres_to_map_frac(self, x, y, map_id):
        return None


# ── Walks ────────────────────────────────────────────────────────────────────
@dataclass
class Stay:
    room: str
    x: float
    y: float
    seconds: float
    note: str = ""


@dataclass
class Leg:
    """Where the device is between t0 and t1, as a polyline at walking speed
    followed by standing still."""
    t0: float
    t1: float
    path: list[tuple[float, float]]
    walk_s: float
    stay: Stay


def route(a: str, b: str) -> list[tuple[float, float]]:
    """Door points from room a to room b (the hall joins everything)."""
    if a == b:
        return []
    key = frozenset((a, b))
    if key in DOORS:
        return [DOORS[key]]
    pts = []
    if a != "Hall":
        pts.append(DOORS[frozenset((a, "Hall"))])
    if b != "Hall":
        pts.append(DOORS[frozenset((b, "Hall"))])
    return pts


def spot(rng: random.Random, room: str, margin: float = 0.7) -> tuple[float, float]:
    x0, y0, x1, y1 = ROOMS[room]
    return (rng.uniform(x0 + margin, x1 - margin), rng.uniform(y0 + margin, y1 - margin))


def tour(rng: random.Random) -> list[Stay]:
    """About 35 minutes of going from room to room and staying a few minutes,
    with two short stops in the hall, then two long still sits: one in the
    middle of a room, one half a metre from a doorway (where a device is most
    likely to flicker). Stays are long enough that a slow change is measured,
    not cut off; a room not shown before the device leaves counts as never."""
    plan = [("Kitchen", 150), ("Office", 180), ("Hall", 60), ("Bedroom", 180),
            ("Bath", 120), ("Bedroom", 150), ("Lounge", 180), ("Kitchen", 150),
            ("Lounge", 150), ("Hall", 60), ("Kitchen", 150), ("Office", 150),
            ("Bath", 150), ("Lounge", 120)]
    stays = [Stay(r, *spot(rng, r), s) for r, s in plan]
    stays.append(Stay("Lounge", 2.0, 7.5, 600, "still, middle of the room"))
    # Bedroom side of the bedroom/hall door, 0.5 m in.
    stays.append(Stay("Bedroom", 6.5, 6.0 + rng.uniform(-0.3, 0.3), 600, "still, by a doorway"))
    return stays


def legs(stays: list[Stay]) -> list[Leg]:
    out: list[Leg] = []
    t = 0.0
    prev: Stay | None = None
    for s in stays:
        path = [(prev.x, prev.y)] if prev else [(s.x, s.y)]
        if prev:
            path += route(prev.room, s.room)
        path.append((s.x, s.y))
        walk = sum(math.dist(path[i], path[i + 1]) for i in range(len(path) - 1)) / WALK_MS
        out.append(Leg(t, t + walk + s.seconds, path, walk, s))
        t += walk + s.seconds
        prev = s
    return out


def position(leg: Leg, t: float) -> tuple[float, float]:
    d = (t - leg.t0) * WALK_MS
    for i in range(len(leg.path) - 1):
        seg = math.dist(leg.path[i], leg.path[i + 1])
        if d <= seg:
            f = d / seg if seg else 1.0
            (ax, ay), (bx, by) = leg.path[i], leg.path[i + 1]
            return ax + (bx - ax) * f, ay + (by - ay) * f
        d -= seg
    return leg.path[-1]


def entry_time(leg: Leg) -> float:
    """When the device last crossed into its destination room on this leg."""
    if leg.walk_s <= 0:
        return leg.t0
    t, step, entered = leg.t0, 0.05, leg.t0
    inside_prev = room_at(*position(leg, t)) == leg.stay.room
    while t <= leg.t0 + leg.walk_s:
        inside = room_at(*position(leg, t)) == leg.stay.room
        if inside and not inside_prev:
            entered = t
        inside_prev = inside
        t += step
    return entered


# ── The run ──────────────────────────────────────────────────────────────────
@contextmanager
def _patched(clock: Clock, manager: FakeManager, snap_box: list) -> Iterator[None]:
    """Point every clock at `clock`, habluetooth at `manager`, and the poll's
    snapshot at snap_box[0]; the RPA resolver knows no phones."""
    saved = (_bl._now, _bl.time, _pc.time, sys.modules.get("habluetooth"))
    _bl._now = clock.now
    _bl.time = clock          # type: ignore[assignment]
    _pc.time = clock          # type: ignore[assignment]
    sys.modules["habluetooth"] = SimpleNamespace(get_manager=lambda: manager)  # type: ignore[assignment]
    resolver = MagicMock()
    resolver.has_devices.return_value = False

    async def _snap(_hass):
        return snap_box[0]

    async def _get_resolver(_hass):
        return resolver

    try:
        with patch("custom_components.padspan_ha.websocket._live_snapshot", _snap),              patch("custom_components.padspan_ha.private_ble_resolver.get_resolver", _get_resolver):
            yield
    finally:
        _bl._now, _bl.time, _pc.time = saved[0], saved[1], saved[2]
        if saved[3] is None:
            sys.modules.pop("habluetooth", None)
        else:
            sys.modules["habluetooth"] = saved[3]


@dataclass
class Trace:
    device: str
    seed: int
    legs: list[Leg]
    shown: list[tuple[float, str | None]] = field(default_factory=list)   # (t, room) per poll


def run_walk(dev: Device, seed: int, *, settings: dict[str, Any] | None = None,
             poll_s: float = 5.0, stays: list[Stay] | None = None,
             fabric: bool = False, on_poll=None) -> Trace:
    """Walk one device through the house; the room PadSpan shows at each poll.
    fabric: the house is drawn (rooms, scanner positions, walls), so rooms come
    from the spatial solve; otherwise from the strongest scanner per room."""
    rng = random.Random(seed * 7919 + sum(map(ord, dev.name)))
    walk = legs(stays if stays is not None else tour(random.Random(seed)))
    end = walk[-1].t1
    clock = Clock()
    scanners = {s: FakeScanner(s) for s in SCANNERS}
    manager = FakeManager(list(scanners.values()))

    st = dict(DEFAULT_SETTINGS)
    st.update(settings or {})
    st["presence_poll_interval_s"] = poll_s
    hass = MagicMock()
    store = MagicMock()
    store.data = st
    hass.data = {DOMAIN: {DATA_SETTINGS: store}}
    if fabric:
        from custom_components.padspan_ha.const import DATA_MODEL
        hass.data[DOMAIN][DATA_MODEL] = FakeModel()

    trace = Trace(dev.name, seed, walk)
    snap_box: list = [None]
    loop = asyncio.new_event_loop()
    with _patched(clock, manager, snap_box):
        bl = _bl.BluetoothLive(hass)
        coord = _pc.PresenceCoordinator(hass)
        coord.update_interval = timedelta(seconds=poll_s)
        coord._pending_room_changes = []
        radios = [{"source": s, "area_name": v[2]} for s, v in SCANNERS.items()]
        slow = {s: 0.0 for s in SCANNERS}
        payload = 1
        next_adv = rng.uniform(0.0, dev.interval_s)
        next_poll = rng.uniform(0.0, poll_s)
        last_adv_t = 0.0
        li = 0
        while True:
            t = min(next_adv, next_poll)
            if t > end:
                break
            clock.t = t
            while walk[li].t1 < t:
                li += 1
            if next_adv <= next_poll:
                x, y = position(walk[li], t)
                a = math.exp(-(t - last_adv_t) / SLOW_TAU_S)
                last_adv_t = t
                if rng.random() < dev.payload_change_p:
                    payload += 1
                for s, (sx, sy, _room, duty) in SCANNERS.items():
                    slow[s] = a * slow[s] + math.sqrt(1 - a * a) * rng.gauss(0.0, SLOW_SIGMA_DB)
                    r = mean_rssi(dev, x, y, sx, sy) + slow[s] + rng.gauss(0.0, FAST_SIGMA_DB)
                    if rng.random() < FADE_P:
                        r -= rng.uniform(*FADE_DB)
                    hear = duty * min(1.0, max(0.0, (r - HEAR_FLOOR_DBM) / 8.0))
                    if rng.random() >= hear:
                        continue
                    ri = int(round(r))
                    mono = clock.monotonic()
                    scanners[s].heard(dev.address, ri, mono, payload)
                    pref = manager.history.get(dev.address)
                    pref_duty = SCANNERS[pref[0]][3] if pref else 1.0
                    stale = dev.interval_s / max(pref_duty, 0.05) + STALE_WOBBLE_S
                    if manager.dispatch(dev.address, s, ri, mono, payload, stale):
                        bl._on_adv(SimpleNamespace(
                            address=dev.address, time=mono, rssi=ri, source=s, name="",
                            manufacturer_data={0xFFFF: payload.to_bytes(4, "big")},
                            service_data={}, service_uuids=[], tx_power=None,
                            connectable=False, device=None))
                next_adv = t + dev.interval_s * rng.uniform(0.95, 1.05)
            else:
                ble = bl.get_snapshot(max_ads=1000, max_age_s=900)
                ble["radios"] = radios
                ages = [a["age_s"] for a in ble["advertisements"] if a["address"] == dev.address]
                obj = {"key": dev.address, "address": dev.address, "kind": "ble",
                       "name": dev.name, "identified": True,
                       "age_s": min(ages) if ages else 1e9}
                snap_box[0] = {"objects": {"list": [obj]}, "ble": ble}
                result = loop.run_until_complete(coord._async_update_data())
                trace.shown.append((t, (result.get(dev.address) or {}).get("room")))
                if on_poll is not None:
                    on_poll(t, coord, bl)
                next_poll = t + poll_s
    loop.close()
    return trace


# ── Scoring ──────────────────────────────────────────────────────────────────
@dataclass
class Score:
    delays: list[float]          # seconds from entering the room to it being shown
    missed: int                  # stays it never showed
    wrong_switches: int          # changes of the shown room while still (not the move's own)
    still_s: float               # seconds standing still
    moves: int

    @property
    def flicker_per_h(self) -> float:
        return self.wrong_switches / (self.still_s / 3600.0) if self.still_s else 0.0

    def pct(self, q: float) -> float:
        """The q-quantile of the delays, a stay never shown counting as forever."""
        xs = sorted(self.delays) + [math.inf] * self.missed
        if not xs:
            return math.nan
        i = min(len(xs) - 1, max(0, math.ceil(q * len(xs)) - 1))
        return xs[i]


def score(traces: list[Trace], min_stay_s: float = 30.0, rooms: set[str] | None = None) -> Score:
    """Delay: per room change (a walk into a different room, then a stay of
    at least min_stay_s; the two still sits are for flicker only), the seconds
    from crossing into the room to PadSpan showing it.

    Flicker: every change of the shown room while the device stands still,
    except the one change that shows the move itself. A detour (a room passed
    through shown after the device stopped) counts; so does a doorway spot
    switching back and forth, whichever room is right there.

    rooms: count only stays in these rooms (e.g. the ones whose scanner is
    tuned, TUNED_ROOMS)."""
    delays: list[float] = []
    missed = wrong = moves = 0
    still = 0.0
    for tr in traces:
        for i, leg in enumerate(tr.legs):
            if i == 0 or (rooms is not None and leg.stay.room not in rooms):
                continue
            stand0 = leg.t0 + leg.walk_s
            still += leg.t1 - stand0
            t_in = entry_time(leg)
            room = leg.stay.room
            seen_room = any(r == room for t, r in tr.shown if t_in <= t < stand0)
            prev = next((r for t, r in reversed(tr.shown) if t < stand0), None)
            for t, r in tr.shown:
                if not (stand0 <= t < leg.t1):
                    continue
                if r != prev:
                    if r == room and not seen_room:
                        seen_room = True
                    else:
                        wrong += 1
                prev = r
            if (leg.stay.note or leg.stay.seconds < min_stay_s
                    or tr.legs[i - 1].stay.room == room):
                continue
            moves += 1
            shown_at = next((t for t, r in tr.shown if t_in <= t < leg.t1 and r == room), None)
            if shown_at is None:
                missed += 1
            else:
                delays.append(shown_at - t_in)
    return Score(delays, missed, wrong, still, moves)


def summary(sc: Score) -> dict[str, Any]:
    return {
        "moves": sc.moves,
        "median_s": round(sc.pct(0.5), 1),
        "p90_s": round(sc.pct(0.9), 1),
        "shown_median_s": round(statistics.median(sc.delays), 1) if sc.delays else None,
        "missed": sc.missed,
        "flicker_per_h": round(sc.flicker_per_h, 2),
        "wrong_switches": sc.wrong_switches,
        "still_h": round(sc.still_s / 3600.0, 2),
    }


def run_set(devices=(PHONE, TAG), seeds=range(6), settings: dict[str, Any] | None = None,
            poll_s: float = 5.0, fabric: bool = False) -> list[Trace]:
    return [run_walk(d, s, settings=settings, poll_s=poll_s, fabric=fabric)
            for s in seeds for d in devices]
