"""What the poll and the room smoothing give, poll by poll, written down whole.

Used by tests/test_golden_poll.py. Two kinds of scenario run through
PadSpan's own code (BluetoothLive, then one real coordinator poll every 5 s)
on a simulated clock:

  * the synthetic walks of tests/room_speed_sim.py, as they are: one device,
    one floor, with and without the house drawn;
  * a larger house built here on the same radio model: two floors and a
    garden, nine devices at once (a labelled phone, a tag that sends its own
    reference power, an iBeacon on two addresses, two pinned beacons, a phone
    on a rotating private address, a passer-by nobody named, a tag that
    leaves and comes back, one that leaves for good), calibration points for
    the fingerprint match, and the pinned beacons' own automatic calibration
    points. It is run twice: with a new install's settings, and with the
    settings the poll and the smoothing read moved off their defaults
    (OTHER_SETTINGS), a 10 s poll and adaptive learning on.

After every poll a record is taken of everything the poll returned and of
all the state the coordinator keeps between polls (the STATE_ lists below
say which attribute is recorded where). The record keeps every digit;
tests/golden_tools.py says how it is compared on a machine whose maths
functions round differently.
"""

from __future__ import annotations

import asyncio
import json
import math
import random
import sys
from contextlib import contextmanager
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from typing import Any, Callable, Iterator
from unittest.mock import MagicMock, patch

from custom_components.padspan_ha import adaptive_store as _ad
from custom_components.padspan_ha import bluetooth_live as _bl
from custom_components.padspan_ha import calibration_store as _cs
from custom_components.padspan_ha import presence_coordinator as _pc
from custom_components.padspan_ha.const import (
    DATA_ADAPTIVE, DATA_CALIBRATION, DATA_MODEL, DATA_SETTINGS, DOMAIN, OUTSIDE_FLOOR_ID,
)
from custom_components.padspan_ha.settings_store import DEFAULT_SETTINGS
from tests import golden_tools as gt
from tests import room_speed_sim as sim

# ── Which coordinator state is recorded, and where ───────────────────────────
# Every attribute a PresenceCoordinator has after a run is in exactly one of
# these lists (test_every_coordinator_attribute_is_accounted_for), so state
# added later is either recorded or left out on purpose.

# Kept per object key: recorded with that object.
STATE_BY_KEY = (
    "_last_seen", "_away_miss", "_kalman_addr_key",
    "_room_votes", "_confirmed_room", "_room_confidence", "_rssi_margin_confidence",
    "_knn_position", "_smooth_xy", "_room_unsure", "_unsure_run", "_clear_run",
    "_spatial_position", "_spatial_smooth_xy", "_spatial_debug",
    "_floor_evidence", "_outside_by_cov", "_coverage_hist", "_last_candidate",
    "_beacon_autocal_last", "_beacon_autocal_buf",
    "_last_room_change_mono", "_room_dwell_start", "_floor_dwell_start", "_device_floor",
    "_adaptive_last_obs", "_adaptive_last_vec",
    "_room_before_gap", "_room_gap_mono", "_room_alert_held", "_room_alert_reported",
)
# Kept per address the signal filter runs on (an object's own key for an
# iBeacon): recorded with the object that filter belongs to.
STATE_BY_ADDR = ("_ema_rssi", "_kalman_p", "_silence_miss", "_advert_gap")
# One value for the whole house: recorded once per poll.
STATE_SHARED = (
    "_adverts_used", "_espresense_dist", "_addr_tx_power", "_excluded_cache", "_floor_cache",
    "_scanner_agree", "_scanner_reliability", "_co_visible", "_adj_learn_polls",
    "_coverage_floor", "_coverage_floor_src", "_coverage_stamp",
    "_prev_present", "_prev_groups", "_prev_away_s", "_presence_primed", "_quiet_keys",
    "_object_failures", "last_object_counts", "_door_debounce", "_alert_last_sent",
    "_adaptive_save_counter", "_fusion_nudges", "_preferred_method", "_corr_cache",
    "_suspend_until", "_suspend_permanent", "_use_metres", "_cleanup_counter",
)
# Not recorded, and why.
STATE_LEFT_OUT = {
    # Home Assistant's side of the coordinator, and the worker thread.
    "hass": "the stand-in for Home Assistant",
    "logger": "logging", "name": "a constant", "data": "set by Home Assistant, not by the poll",
    "update_interval": "recorded as poll_s",
    "_compute_executor": "the worker thread", "_compute_executor_mode": "the worker thread",
    # The house as the poll reads it from the model each time: an input, the
    # same on every poll of a scenario. What it does shows in every position.
    "_room_centroids": "geometry read each poll", "_scanner_positions": "geometry read each poll",
    "_scanner_abs_z": "geometry read each poll", "_floor_bases": "geometry read each poll",
    "_floor_stack_idx": "geometry read each poll", "_max_range_m": "geometry read each poll",
    "_floor_bounds": "geometry read each poll", "_rf_barriers": "geometry read each poll",
    "_floor_rooms": "geometry read each poll", "_pl_fits": "calibration fits read each poll",
    "_last_source_to_area": "scanner areas read each poll",
    # The object as last listed: the same dict the poll returned (recorded as
    # the object's result); only its "_stale" mark is state, recorded as stale.
    "_known_objs": "recorded as result and stale",
    # Emptied before the poll returns; recorded as events.room_changes.
    "_pending_room_changes": "recorded as events",
    # The hourly accuracy test, which no scenario turns on.
    "_heldout": "accuracy test, off", "_heldout_mono": "accuracy test, off",
    "_heldout_running": "accuracy test, off", "_heldout_want": "accuracy test, off",
    "_heldout_seq": "accuracy test, off", "_heldout_again": "accuracy test, off",
    # Counters for log lines and the opt-in report.
    "_knn_log_count": "how often a debug line is logged",
    "_steady_rooms": "the opt-in report, off", "_fabric_pruned": "a one-time model clean-up",
}


class Recorder:
    """Takes a record after every poll of every coordinator made while
    recording() is open."""

    def __init__(self) -> None:
        self.polls: list[dict[str, Any]] = []
        self.coordinators: list[Any] = []
        self._events: dict[int, dict[str, Any]] = {}

    def _watch(self, coord: Any) -> None:
        """Note the room changes and the arrivals and departures a poll hands
        on (to alerts, movement history and automations), which are gone from
        the coordinator by the time the poll returns."""
        self.coordinators.append(coord)
        ev = self._events[id(coord)] = {}
        alerts, automations = coord._process_room_alerts, coord._run_automations

        async def _room_alerts(now, result, *a, **kw):
            ev["room_changes"] = [list(c) for c in coord._pending_room_changes]
            return await alerts(now, result, *a, **kw)

        async def _automations(arrived, departed, result, now, members, *a, **kw):
            ev["arrived"], ev["departed"] = sorted(arrived), sorted(departed)
            ev["members"] = {k: sorted(v) for k, v in sorted(members.items())}
            return await automations(arrived, departed, result, now, members, *a, **kw)

        coord._process_room_alerts = _room_alerts
        coord._run_automations = _automations

    def take(self, coord: Any, result: dict[str, Any]) -> None:
        ev = self._events[id(coord)]
        by_key: dict[str, dict[str, Any]] = {}
        seen_addrs: set[str] = set()
        keys = [k for k in result if k != "__scanner_health__"]
        extra: set[str] = set()
        for attr in STATE_BY_KEY:
            extra.update(k for k in getattr(coord, attr) if k not in result)
        extra.update(k for k in coord._known_objs if k not in result)
        for key in keys + sorted(extra):
            state: dict[str, Any] = {}
            for attr in STATE_BY_KEY:
                d = getattr(coord, attr)
                if key in d:
                    state[attr] = d[key]
            addr = coord._kalman_addr_key.get(key, key)
            seen_addrs.add(addr)
            for attr in STATE_BY_ADDR:
                d = getattr(coord, attr)
                if addr in d:
                    state[attr] = d[addr]
            if key in coord._known_objs:
                state["stale"] = bool(coord._known_objs[key].get("_stale"))
            by_key[key] = {"result": result.get(key), "state": state}
        orphans = {attr: {a: v for a, v in getattr(coord, attr).items() if a not in seen_addrs}
                   for attr in STATE_BY_ADDR}
        shared = {attr: getattr(coord, attr) for attr in STATE_SHARED if hasattr(coord, attr)}
        # gt.plain copies everything now: the coordinator goes on changing
        # these same dicts and deques on the next poll.
        self.polls.append(gt.plain({
            "t": _pc.time.monotonic(),
            "poll_s": coord.update_interval.total_seconds(),
            "objects": by_key,
            "scanner_health": result.get("__scanner_health__"),
            "events": dict(ev),
            "shared": shared,
            "filter_state_with_no_object": {a: v for a, v in orphans.items() if v},
        }))
        ev.clear()


@contextmanager
def recording() -> Iterator[Recorder]:
    """Record every poll made inside the block (see Recorder)."""
    rec = Recorder()
    real = _pc.PresenceCoordinator._async_update_data

    async def _update(self):
        if id(self) not in rec._events:
            rec._watch(self)
        result = await real(self)
        rec.take(self, result)
        return result

    with patch.object(_pc.PresenceCoordinator, "_async_update_data", _update):
        yield rec


# ── Scenario 1: the synthetic walks as they are ──────────────────────────────

def run_sim_walk(device: sim.Device, seed: int, fabric: bool) -> Recorder:
    with recording() as rec:
        sim.run_walk(device, seed, fabric=fabric)
    return rec


# ── Scenario 2: two floors, a garden, nine devices ──────────────────────────
# The ground floor is room_speed_sim's house (its rooms, scanners, walls and
# doors). Above it, three rooms and four scanners; beside it, a garden with
# one scanner on the outside floor. Stairs join the hall to the landing.

MAIN, UPPER, OUT = "main", "upper", OUTSIDE_FLOOR_ID
FLOOR_BASE_M = {MAIN: 0.0, UPPER: 2.8, OUT: 0.0}
FLOOR_INDEX = {MAIN: 0, UPPER: 1, OUT: 0}
UPPER_ROOMS: dict[str, tuple[float, float, float, float]] = {
    "Loft": (0.0, 0.0, 5.0, 10.0),
    "Study": (5.0, 0.0, 10.0, 5.0),
    "Landing": (5.0, 5.0, 10.0, 10.0),
}
GARDEN = ("Garden", (10.0, 0.0, 15.0, 10.0))
ROOMS: dict[str, tuple[str, tuple[float, float, float, float]]] = {
    **{r: (MAIN, box) for r, box in sim.ROOMS.items()},
    **{r: (UPPER, box) for r, box in UPPER_ROOMS.items()},
    GARDEN[0]: (OUT, GARDEN[1]),
}
# source -> (x, y, floor, room, duty)
SCANNERS: dict[str, tuple[float, float, str, str, float]] = {
    **{s: (x, y, MAIN, room, duty) for s, (x, y, room, duty) in sim.SCANNERS.items()},
    "AA:00:00:00:01:01": (1.0, 5.0, UPPER, "Loft", 0.85),
    "AA:00:00:00:01:02": (4.0, 9.2, UPPER, "Loft", 0.09),
    "AA:00:00:00:01:03": (9.0, 1.0, UPPER, "Study", 0.85),
    "AA:00:00:00:01:04": (9.0, 9.0, UPPER, "Landing", 0.85),
    "AA:00:00:00:02:01": (12.5, 5.0, OUT, "Garden", 0.85),
}
UPPER_WALLS = [((5.0, 0.0), (5.0, 4.0)), ((5.0, 5.0), (5.0, 10.0)),     # a door at (5, 4.5)
               ((5.0, 5.0), (7.0, 5.0)), ((8.0, 5.0), (10.0, 5.0))]     # a door at (7.5, 5)
OUTER_WALL = [((10.0, 0.0), (10.0, 5.5)), ((10.0, 6.5), (10.0, 10.0))]   # the garden door at (10, 6)
SLAB_DB = 14.0
OUTER_WALL_DB = 8.0
STAIRS = (5.5, 6.0)      # in the hall below, on the landing above


def _walls_between(floor_a: str, floor_b: str) -> tuple[list, float]:
    """The walls a signal between two floors' points may cross, and what one costs."""
    if floor_a == floor_b == MAIN:
        return sim.WALLS, sim.WALL_DB
    if floor_a == floor_b == UPPER:
        return UPPER_WALLS, sim.WALL_DB
    if OUT in (floor_a, floor_b) and floor_a != floor_b:
        return OUTER_WALL, OUTER_WALL_DB
    return [], 0.0


def mean_rssi(tx_1m: float, x: float, y: float, floor: str, source: str) -> float:
    sx, sy, sfloor, _room, _duty = SCANNERS[source]
    dz = (FLOOR_BASE_M[sfloor] + sim.SCANNER_Z_M) - (FLOOR_BASE_M[floor] + sim.DEVICE_Z_M)
    d = math.sqrt((x - sx) ** 2 + (y - sy) ** 2 + dz ** 2)
    walls, wall_db = _walls_between(floor, sfloor)
    crossed = sum(1 for a, b in walls if sim._crosses((x, y), (sx, sy), a, b))
    slabs = abs(FLOOR_INDEX[sfloor] - FLOOR_INDEX[floor])
    return tx_1m - 10.0 * sim.PATH_LOSS_N * math.log10(max(d, 0.5)) - wall_db * crossed - SLAB_DB * slabs


class HouseModel(sim.FakeModel):
    """HOUSE as the poll reads it from the model store."""

    def __init__(self, pins: dict[str, dict[str, Any]]) -> None:
        super().__init__()
        self._pins = pins
        # One floor has a picture, so a solved position there is also given
        # as a place on it.
        self.data = {"map_transforms": {"map_main": {"floor_id": MAIN}}}

    def get_scanner_mappings(self):
        return ({s: v[3] for s, v in SCANNERS.items()}, {s: v[2] for s, v in SCANNERS.items()})

    def beacon_positions_m(self) -> dict:
        return {k: dict(v) for k, v in self._pins.items()}

    def room_geometry_m(self) -> dict:
        return {r: {"type": "poly", "floor_id": fl,
                    "points_m": [[x0, y0], [x1, y0], [x1, y1], [x0, y1]]}
                for r, (fl, (x0, y0, x1, y1)) in ROOMS.items()}

    def room_meta(self) -> dict:
        return {}

    def room_centroids_m(self) -> dict:
        return {r: ((x0 + x1) / 2, (y0 + y1) / 2, fl) for r, (fl, (x0, y0, x1, y1)) in ROOMS.items()}

    def scanner_positions_m(self) -> dict:
        return {s: {"x_m": v[0], "y_m": v[1], "floor_id": v[2]} for s, v in SCANNERS.items()}

    def scanner_absolute_z_m(self) -> dict:
        return {s: FLOOR_BASE_M[v[2]] + sim.SCANNER_Z_M for s, v in SCANNERS.items()}

    def floor_base_elevations_m(self) -> dict:
        return dict(FLOOR_BASE_M)

    def floor_stack_index(self) -> dict:
        return dict(FLOOR_INDEX)

    def rf_barriers_m(self) -> list:
        return ([{"points_m": [list(a), list(b)], "attenuation_dbm": sim.WALL_DB,
                  "material": "drywall", "floor_id": MAIN} for a, b in sim.WALLS]
                + [{"points_m": [list(a), list(b)], "attenuation_dbm": sim.WALL_DB,
                    "material": "drywall", "floor_id": UPPER} for a, b in UPPER_WALLS])

    def metres_to_map_frac(self, x, y, map_id):
        return (x / 10.0, y / 10.0)

    def map_frac_to_metres(self, x, y, map_id):
        return (x * 10.0, y * 10.0)


@dataclass
class Dev:
    """One thing on the air, and the object the snapshot lists it as."""
    key: str
    kind: str                       # ble | private_ble | ibeacon
    addresses: tuple[str, ...]      # the addresses it advertises from, one at a time
    route: list[tuple]              # see _timeline
    interval_s: float = 2.0
    tx_1m: float = -62.0
    payload_change_p: float = 0.0
    tx_power: int | None = None     # the power it puts in its adverts
    rotate_s: float = 0.0           # how long it keeps one address
    label: str = ""
    identified: bool = True
    seed: int = 0
    # filled in by the run
    timeline: list[tuple] = field(default_factory=list)
    heard_at: float | None = None


def _timeline(route: list[tuple]) -> list[tuple]:
    """A route as (t0, t1, floor, (x0, y0), (x1, y1)) pieces; floor None is
    away (not advertising). Route steps:
        ("at", x, y, floor)   start here
        ("go", x, y)          walk there
        ("stay", seconds)
        ("floor", floor)      take the stairs, where it stands
        ("away", seconds)     gone, then back where it was
    """
    out: list[tuple] = []
    t, x, y, floor = 0.0, 0.0, 0.0, MAIN
    for step in route:
        if step[0] == "at":
            x, y, floor = step[1], step[2], step[3]
        elif step[0] == "go":
            dur = math.dist((x, y), (step[1], step[2])) / sim.WALK_MS
            out.append((t, t + dur, floor, (x, y), (step[1], step[2])))
            t, x, y = t + dur, step[1], step[2]
        elif step[0] == "stay":
            out.append((t, t + step[1], floor, (x, y), (x, y)))
            t += step[1]
        elif step[0] == "floor":
            floor = step[1]
        elif step[0] == "away":
            out.append((t, t + step[1], None, (x, y), (x, y)))
            t += step[1]
        else:
            raise ValueError(step)
    return out


def _where(dev: Dev, t: float) -> tuple[float, float, str | None]:
    for t0, t1, floor, a, b in dev.timeline:
        if t < t1:
            f = (t - t0) / (t1 - t0) if t1 > t0 else 1.0
            f = min(1.0, max(0.0, f))
            return a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, floor
    _t0, _t1, floor, _a, b = dev.timeline[-1]
    return b[0], b[1], floor


IBEACON_KEY = "ibeacon:0a1b2c3d-0000-4000-8000-00000000cafe:1:2"
PRIVATE_KEY = "irk:5ca1ab1e"
PIN_BATH, PIN_LOFT = "C0:FF:EE:00:00:04", "C0:FF:EE:00:00:05"
PINS = {
    # A pin in a real room, and one whose room is not a room of this house.
    PIN_BATH: {"room": "Bath", "floor_id": MAIN, "x_m": 8.0, "y_m": 9.0},
    PIN_LOFT: {"room": "Blue tag", "floor_id": UPPER, "x_m": 2.0, "y_m": 2.0},
}
RUN_S = 1500.0     # 25 minutes, 300 polls


def devices() -> list[Dev]:
    return [
        # Round the ground floor, up the stairs and round the upper floor,
        # down and out into the garden, back in, then gone four minutes.
        Dev("C0:FF:EE:00:00:01", "ble", ("C0:FF:EE:00:00:01",), [
            ("at", 2.0, 2.5, MAIN), ("stay", 90), ("go", 4.0, 2.5), ("go", 5.0, 2.5),
            ("go", *STAIRS), ("floor", UPPER), ("go", 7.5, 5.0), ("go", 7.5, 2.5), ("stay", 120),
            ("go", 5.0, 4.5), ("go", 2.5, 5.0), ("stay", 120),
            ("go", 5.0, 4.5), ("go", 7.5, 5.0), ("go", *STAIRS), ("floor", MAIN),
            ("go", 6.0, 6.0), ("go", 8.0, 6.0), ("stay", 100),
            ("go", 10.0, 6.0), ("floor", OUT), ("go", 13.0, 5.0), ("stay", 150),
            ("go", 10.0, 6.0), ("floor", MAIN), ("go", 8.0, 6.0), ("stay", 60),
            ("go", 6.0, 6.0), ("go", 5.0, 7.5), ("go", 4.0, 7.5), ("go", 2.0, 7.5), ("stay", 150),
            ("away", 240), ("stay", 400)],
            interval_s=1.0, tx_1m=-59.0, payload_change_p=0.3, label="Phone", seed=1),
        # A tag that states its own reference power; carried downstairs once.
        Dev("C0:FF:EE:00:00:02", "ble", ("C0:FF:EE:00:00:02",), [
            ("at", 8.0, 2.0, UPPER), ("stay", 700), ("go", 7.5, 5.0), ("go", *STAIRS), ("floor", MAIN),
            ("go", 5.0, 2.0), ("go", 6.0, 2.0), ("go", 8.0, 2.0), ("stay", 800)],
            tx_1m=-62.0, tx_power=-62, seed=2),
        # An iBeacon that changes address every five minutes.
        Dev(IBEACON_KEY, "ibeacon", ("C0:FF:EE:00:00:03", "C0:FF:EE:00:00:13"), [
            ("at", 1.5, 8.5, MAIN), ("stay", 800), ("go", 4.0, 7.5), ("go", 5.0, 7.0),
            ("go", 6.0, 6.0), ("go", 8.0, 5.0), ("stay", 700)],
            tx_1m=-60.0, rotate_s=300.0, seed=3),
        Dev(PIN_BATH, "ble", (PIN_BATH,), [("at", 8.0, 9.0, MAIN), ("stay", RUN_S)],
            interval_s=1.0, label="Bath beacon", seed=4),
        Dev(PIN_LOFT, "ble", (PIN_LOFT,), [("at", 2.0, 2.0, UPPER), ("stay", RUN_S)],
            interval_s=1.5, seed=5),
        # A phone on a private address that changes every four minutes.
        Dev(PRIVATE_KEY, "private_ble", ("4A:00:00:00:00:06", "5B:00:00:00:00:06", "6C:00:00:00:00:06"), [
            ("at", 8.0, 6.0, MAIN), ("stay", 300), ("go", 6.0, 6.0), ("go", 6.0, 9.0), ("go", 8.0, 9.0),
            ("stay", 300), ("go", 6.0, 9.0), ("go", 5.0, 5.0), ("stay", 900)],
            interval_s=1.0, tx_1m=-58.0, payload_change_p=0.3, rotate_s=240.0, seed=6),
        # Someone passing: unnamed, heard for two minutes, then never again.
        Dev("C0:FF:EE:00:00:07", "ble", ("C0:FF:EE:00:00:07",), [
            ("at", 5.0, 9.0, MAIN), ("stay", 120), ("away", RUN_S)],
            identified=False, seed=7),
        # A visitor's tag: leaves, drops off the list after 15 minutes, and is
        # heard again a minute and a half later (inside the two-minute grace).
        Dev("C0:FF:EE:00:00:08", "ble", ("C0:FF:EE:00:00:08",), [
            ("at", 1.5, 3.5, MAIN), ("stay", 280), ("away", 985), ("stay", RUN_S)],
            seed=8),
        # And one that leaves for good: dropped once the grace runs out.
        Dev("C0:FF:EE:00:00:09", "ble", ("C0:FF:EE:00:00:09",), [
            ("at", 8.0, 2.0, MAIN), ("stay", 100), ("away", RUN_S)],
            seed=9),
    ]


def calibration_points() -> list[dict[str, Any]]:
    """A walked grid on both floors, as the calibration store keeps points."""
    rng = random.Random(20261119)
    pts: list[dict[str, Any]] = []
    for floor, rooms in ((MAIN, sim.ROOMS), (UPPER, UPPER_ROOMS)):
        for gx in (1.5, 3.5, 5.0, 7.0, 8.5):
            for gy in (1.5, 4.0, 6.5, 9.0):
                room = next(r for r, (x0, y0, x1, y1) in rooms.items() if x0 <= gx < x1 and y0 <= gy < y1)
                readings = []
                for s in SCANNERS:
                    m = mean_rssi(-59.0, gx, gy, floor, s)
                    if m < -92.0:
                        continue
                    samples = [float(round(m + rng.gauss(0.0, 2.5))) for _ in range(5)]
                    srt = sorted(samples)
                    readings.append({"source": s, "name": s, "rssi_samples": samples,
                                     "mean_rssi": srt[2], "std_rssi": 2.5, "sample_count": 5})
                pts.append({"id": f"cp_{len(pts):03d}", "map_id": "", "x_frac": 0.5, "y_frac": 0.5,
                            "x_m": gx, "y_m": gy, "floor_id": floor, "room": room, "label": "",
                            "device_id": "walker", "collected_at": "2026-11-01T12:00:00+00:00",
                            "duration_s": 15, "weight": 1.0, "scanner_readings": readings})
    return pts


class _Resolver:
    """The private-address resolver: knows one phone's three addresses."""

    def __init__(self, addresses: tuple[str, ...]) -> None:
        self._known = {a.upper() for a in addresses}

    def has_devices(self) -> bool:
        return True

    def resolve_address(self, address: str):
        if address.upper() in self._known:
            return {"canonical_id": PRIVATE_KEY, "name": "Private phone", "kind": "private_ble"}
        return None


def _calibration_store(hass: Any, model: Any) -> Any:
    store = _cs.CalibrationStore.__new__(_cs.CalibrationStore)
    store.hass = hass

    async def _save(_data):
        return None

    store.store = SimpleNamespace(async_save=_save)
    store.data = {"points": calibration_points(),
                  # Two scanners have their own measured fit; the rest use the settings.
                  "model": {"path_loss": {
                      "AA:00:00:00:00:03": {"units": "m", "rssi_1m": -58.0, "n": 2.4, "point_count": 14},
                      "AA:00:00:00:01:01": {"units": "m", "rssi_1m": -60.5, "n": 2.2, "point_count": 9},
                  }}}
    store._rf = _cs.RandomForestLocator()
    store._model = model
    return store


@contextmanager
def _pinned_ids_and_dates(clock: sim.Clock) -> Iterator[None]:
    """A new calibration point's id is random bytes and its date is now: give
    both from the run, so the points the poll saves are the same every time."""
    count = [0]

    def _urandom(n: int) -> bytes:
        count[0] += 1
        return count[0].to_bytes(n, "big")

    class _Os:
        urandom = staticmethod(_urandom)

        def __getattr__(self, name: str) -> Any:
            return getattr(sys.modules["os"], name)

    def _now_iso() -> str:
        return clock.now().replace(microsecond=0).isoformat()

    with patch.object(_cs, "os", _Os()), patch.object(_cs, "_now_iso", _now_iso):
        yield


def run_house(settings: dict[str, Any] | None = None, run_s: float = RUN_S,
              poll_s: float = 5.0, learning: bool = False) -> Recorder:
    """The house for run_s seconds; every poll recorded. Also records, per
    poll, the calibration points the poll itself saved ("saved_points").
    learning: the house has an adaptive-learning store (empty at the start);
    each poll then records a digest of what it holds, and the last poll all
    of it."""
    devs = devices()
    for d in devs:
        d.timeline = _timeline(d.route)
    clock = sim.Clock()
    scanners = {s: sim.FakeScanner(s) for s in SCANNERS}
    manager = sim.FakeManager(list(scanners.values()))
    model = HouseModel(PINS)

    st = dict(DEFAULT_SETTINGS)
    st.update(settings or {})
    st["presence_poll_interval_s"] = poll_s
    hass = MagicMock()
    hass.data = {DOMAIN: {DATA_SETTINGS: SimpleNamespace(data=st), DATA_MODEL: model}}

    async def _executor_job(fn, *args):
        return fn(*args)

    hass.async_add_executor_job = _executor_job
    cal = _calibration_store(hass, model)
    hass.data[DOMAIN][DATA_CALIBRATION] = cal
    learned = None
    if learning:
        async def _save(_data):
            return None

        learned = _ad.AdaptiveStore.__new__(_ad.AdaptiveStore)
        learned.hass, learned.store, learned.data = hass, SimpleNamespace(async_save=_save), _ad._empty_data()
        hass.data[DOMAIN][DATA_ADAPTIVE] = learned
    private = next(d for d in devs if d.kind == "private_ble")
    resolver = _Resolver(private.addresses)

    async def _get_resolver(_hass):
        return resolver

    snap_box: list = [None]
    loop = asyncio.new_event_loop()
    hass.loop = loop            # where the worker modes run the smoothing from
    hass.async_create_task = loop.create_task   # the learning store's own saves
    radios = [{"source": s, "area_name": v[3]} for s, v in SCANNERS.items()]
    rngs = {d.key: random.Random(d.seed * 7919 + 17) for d in devs}
    slow = {d.key: {s: 0.0 for s in SCANNERS} for d in devs}
    payload = {d.key: 1 for d in devs}
    last_adv = {d.key: 0.0 for d in devs}
    next_adv = {d.key: rngs[d.key].uniform(0.0, d.interval_s) for d in devs}
    next_poll = 2.5
    mean_cache: dict[tuple, float] = {}

    with recording() as rec, sim._patched(clock, manager, snap_box), _pinned_ids_and_dates(clock), \
            patch("custom_components.padspan_ha.private_ble_resolver.get_resolver", _get_resolver), \
            patch.object(_ad, "time", clock), \
            patch.object(_ad, "_now_iso", lambda: clock.now().replace(microsecond=0).isoformat()):
        bl = _bl.BluetoothLive(hass)
        coord = _pc.PresenceCoordinator(hass)
        coord.update_interval = timedelta(seconds=poll_s)
        coord._pending_room_changes = []
        try:
            while True:
                dev = min(devs, key=lambda d: next_adv[d.key])
                t = min(next_adv[dev.key], next_poll)
                if t > run_s:
                    break
                clock.t = t
                if next_adv[dev.key] <= next_poll:
                    _advertise(dev, t, clock, rngs[dev.key], slow[dev.key], payload, last_adv,
                               scanners, manager, bl, mean_cache)
                    next_adv[dev.key] = t + dev.interval_s * rngs[dev.key].uniform(0.95, 1.05)
                else:
                    ble = bl.get_snapshot(max_ads=1000, max_age_s=900)
                    ble["radios"] = radios
                    snap_box[0] = {"objects": {"list": _objects(devs, ble, t)}, "ble": ble}
                    n_before = len(cal.data["points"])
                    loop.run_until_complete(coord._async_update_data())
                    rec.polls[-1]["saved_points"] = gt.plain(cal.data["points"][n_before:])
                    rec.polls[-1]["calibration_points"] = len(cal.data["points"])
                    if learned is not None:
                        rec.polls[-1]["learned"] = gt.short(learned.data)
                    next_poll = t + poll_s
            if learned is not None and rec.polls:
                rec.polls[-1]["learned_in_all"] = gt.plain(learned.data)
        finally:
            coord.shutdown_compute_executor()
            loop.close()
    return rec


def _advertise(dev: Dev, t: float, clock: sim.Clock, rng: random.Random, slow: dict[str, float],
               payload: dict[str, int], last_adv: dict[str, float], scanners: dict[str, Any],
               manager: Any, bl: Any, mean_cache: dict[tuple, float]) -> None:
    """One advert from dev: which scanners hear it and at what level (the
    radio of room_speed_sim.run_walk, for any number of devices and floors)."""
    x, y, floor = _where(dev, t)
    if floor is None:
        return
    addr = dev.addresses[int(t // dev.rotate_s) % len(dev.addresses)] if dev.rotate_s else dev.addresses[0]
    a = math.exp(-(t - last_adv[dev.key]) / sim.SLOW_TAU_S)
    last_adv[dev.key] = t
    if rng.random() < dev.payload_change_p:
        payload[dev.key] += 1
    data = {0xFFFF: payload[dev.key].to_bytes(4, "big")}
    for s, (_sx, _sy, _sfloor, _room, duty) in SCANNERS.items():
        slow[s] = a * slow[s] + math.sqrt(1 - a * a) * rng.gauss(0.0, sim.SLOW_SIGMA_DB)
        ck = (dev.tx_1m, x, y, floor, s)
        mean = mean_cache.get(ck)
        if mean is None:
            mean = mean_cache[ck] = mean_rssi(dev.tx_1m, x, y, floor, s)
        r = mean + slow[s] + rng.gauss(0.0, sim.FAST_SIGMA_DB)
        if rng.random() < sim.FADE_P:
            r -= rng.uniform(*sim.FADE_DB)
        hear = duty * min(1.0, max(0.0, (r - sim.HEAR_FLOOR_DBM) / 8.0))
        if rng.random() >= hear:
            continue
        ri = int(round(r))
        mono = clock.monotonic()
        sc = scanners[s]
        sc.discovered_devices_and_advertisement_data[addr] = (
            SimpleNamespace(address=addr, name="", details={}),
            SimpleNamespace(rssi=ri, local_name="", tx_power=dev.tx_power, service_uuids=[],
                            service_data={}, manufacturer_data=data))
        sc.discovered_device_timestamps[addr] = mono
        pref = manager.history.get(addr)
        pref_duty = SCANNERS[pref[0]][4] if pref else 1.0
        stale = dev.interval_s / max(pref_duty, 0.05) + sim.STALE_WOBBLE_S
        if manager.dispatch(addr, s, ri, mono, payload[dev.key], stale):
            bl._on_adv(SimpleNamespace(
                address=addr, time=mono, rssi=ri, source=s, name="", manufacturer_data=data,
                service_data={}, service_uuids=[], tx_power=dev.tx_power,
                connectable=False, device=None))
        dev.heard_at = t


def _objects(devs: list[Dev], ble: dict[str, Any], t: float) -> list[dict[str, Any]]:
    """The object list as the poll is given it: one entry per device heard in
    the last 15 minutes, and a labelled one for good (the object history
    keeps those listed, with an age that goes on growing)."""
    out = []
    for d in devs:
        mine = [a for a in ble["advertisements"] if a["address"] in d.addresses]
        if not mine and not d.label:
            continue
        freshest = min(mine, key=lambda a: a["age_s"]) if mine else None
        age = freshest["age_s"] if freshest else (t - d.heard_at if d.heard_at is not None else 1e9)
        obj: dict[str, Any] = {"key": d.key, "kind": d.kind, "name": d.label or d.key,
                               "identified": d.identified, "age_s": age}
        if d.kind == "ibeacon":
            obj["address"] = d.key
            obj["all_addresses"] = sorted({a["address"] for a in mine})
        else:
            obj["address"] = freshest["address"] if freshest else d.addresses[0]
        if d.kind == "private_ble":
            obj["canonical_id"] = d.key
        if d.label:
            obj["user_label"] = d.label
        out.append(obj)
    return out


# ── The scenarios the test holds ─────────────────────────────────────────────

# The same house with the settings the poll and the smoothing read moved off
# their defaults, a 10 s poll, and adaptive learning on from an empty store.
OTHER_SETTINGS: dict[str, Any] = {
    "kalman_q": 0.3, "kalman_r": 12.0, "ref_power": -61.0, "path_loss_exp": 2.6,
    "assumed_device_height_m": 1.3, "room_change_delay_s": 30, "away_timeout_m": 2,
    "scanner_offsets": {"AA:00:00:00:00:05": -4.0},
    "excluded_scanners": ["AA:00:00:00:01:02"],
    "scanner_min_rssi": {"AA:00:00:00:00:03": -85},
    "adaptive_learning_enabled": True, "adaptive_floor_detection": True,
    "positioning_unsure": True, "positioning_sensor_fusion": True,
}

SCENARIOS: dict[str, Callable[[], Recorder]] = {
    "walk_phone": lambda: run_sim_walk(sim.PHONE, 0, fabric=False),
    "walk_tag_house_drawn": lambda: run_sim_walk(sim.TAG, 1, fabric=True),
    "two_floors": run_house,
    "two_floors_other_settings": lambda: run_house(settings=OTHER_SETTINGS, poll_s=10.0, learning=True),
}
# The polls stored whole, to read (the summary has a line for every poll).
SAMPLE = {"walk_phone": [0, 200], "walk_tag_house_drawn": [0, 200], "two_floors": [120],
          "two_floors_other_settings": [60]}


def counts(polls: list[dict[str, Any]]) -> dict[str, int]:
    keys = {k for p in polls for k in p["objects"]}
    return {"polls": len(polls), "objects": len(keys),
            "object_polls": sum(len(p["objects"]) for p in polls)}


# ── The stored summary of a poll, and what to say when it differs ────────────
# Per object: its room, the vote's confidence, its position and floor as they
# are, then a short digest of each part of its record.

_PARTS = {
    "the signal filter's state": STATE_BY_ADDR + ("_kalman_addr_key",),
    "the room vote's state": (
        "_room_votes", "_confirmed_room", "_room_confidence", "_rssi_margin_confidence",
        "_room_unsure", "_unsure_run", "_clear_run", "_last_candidate",
        "_last_room_change_mono", "_room_dwell_start", "_room_before_gap", "_room_gap_mono",
        "_room_alert_held", "_room_alert_reported"),
    "the position and floor state": (
        "_knn_position", "_smooth_xy", "_spatial_position", "_spatial_smooth_xy", "_spatial_debug",
        "_floor_evidence", "_device_floor", "_floor_dwell_start", "_outside_by_cov", "_coverage_hist"),
}
_HEAD = ("room", "room_confidence", "x_m", "y_m", "floor_id")
_COLUMNS = _HEAD + ("what the poll returned for it",) + tuple(_PARTS) + ("its other state",)


def summarise(record: dict[str, Any]) -> dict[str, Any]:
    objs: dict[str, list] = {}
    for key, o in record["objects"].items():
        result, state = o["result"] or {}, o["state"]
        named = {a for attrs in _PARTS.values() for a in attrs}
        objs[key] = ([result.get(h) for h in _HEAD] + [gt.short(o["result"])]
                     + [gt.short({a: state[a] for a in attrs if a in state}) for attrs in _PARTS.values()]
                     + [gt.short({a: v for a, v in state.items() if a not in named})])
    return {"t": record["t"], "objects": objs,
            "house": gt.short({k: v for k, v in record.items() if k != "objects"})}


def where(index: int, record: dict[str, Any]) -> str:
    return f"poll {index} (at {record['t'] - sim.Clock.MONO0:.1f} s)"


def explain(index: int, stored: dict[str, Any], now: dict[str, Any],
            record: dict[str, Any], before: dict[str, Any] | None) -> list[str]:
    """The message for the first poll whose summary is not the stored one."""
    out: list[str] = []
    so, no = stored["objects"], now["objects"]
    for key in list(so) + [k for k in no if k not in so]:
        if so.get(key) == no.get(key):
            continue
        out.append(f'First difference: {where(index, record)}, object "{key}"')
        if key not in so or key not in no:
            out.append("    stored: " + ("listed" if key in so else "not listed")
                       + "; now: " + ("listed" if key in no else "not listed"))
        else:
            for col, e, a in zip(_COLUMNS, so[key], no[key]):
                if col in _HEAD:
                    if type(e) is not type(a) or e != a:
                        out.append(f"    {col}: stored {json.dumps(e)}, now {json.dumps(a)}")
                elif e != a:
                    out.append(f"    differs: {col}")
            same = [col for col, e, a in zip(_COLUMNS, so[key], no[key]) if col not in _HEAD and e == a]
            if same:
                out.append("    the same: " + "; ".join(same))
        out.append("    its record now:        " + gt.clip(record["objects"].get(key), 1500))
        if before is not None:
            out.append("    one poll before, now:  " + gt.clip(before["objects"].get(key), 1500))
        break
    else:
        if list(so) != list(no):
            out.append(f"First difference: {where(index, record)}: the objects are listed in a different order")
            out.append(f"    stored: {list(so)}")
            out.append(f"    now:    {list(no)}")
        else:
            out.append(f"First difference: {where(index, record)}: every object is the same; the poll's "
                       "own values differ (room changes, arrivals, scanner health, state shared by all objects)")
            out.append("    now: " + gt.clip({k: v for k, v in record.items() if k != "objects"}, 2500))
    return out
