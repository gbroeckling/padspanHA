# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""Honest accuracy (0.38.165): held-out score, the better method, "unsure",
and motion sensors + usual moves as a tie-breaker.

The score the Calibration tab has always shown is leave-one-out: one point
out, every other point in, including the dozens of near-copies a pinned
beacon records at the same spot. A near-copy answers for the point left out,
so the score reads close to perfect on the spots that were walked and says
nothing about the spots that were not. The held-out score takes out every
point within 1.5 m of the test spot (and the rest of a beacon's own points),
which is the test the evidence asks for.

The three new settings are off by default and, off, the pipeline must give
exactly what 0.38.164 gave: the golden digest below was recorded from
0.38.164's code on the same synthetic walk.
"""

from __future__ import annotations

import hashlib
import json
import math
import random
from datetime import timedelta
from typing import Any
from unittest.mock import MagicMock, patch

from custom_components.padspan_ha import presence_coordinator as pc_mod
from custom_components.padspan_ha.calibration_store import CalibrationStore
from custom_components.padspan_ha.const import (
    DATA_CALIBRATION, DATA_MODEL, DATA_SETTINGS, DOMAIN,
)
from custom_components.padspan_ha.presence_coordinator import PresenceCoordinator
from custom_components.padspan_ha.random_forest import RandomForestLocator


# ── a small house: Kitchen | Hall | Office along one floor ───────────────────

SCANNERS = {
    "k1": (1.0, 1.0), "k2": (4.0, 3.0), "h1": (6.5, 2.0),
    "o1": (10.0, 1.0), "o2": (12.0, 3.0),
}
S2A = {"k1": "Kitchen", "k2": "Kitchen", "h1": "Hall", "o1": "Office", "o2": "Office"}
S2F = {s: "main" for s in SCANNERS}
ROOMS = {"Kitchen", "Hall", "Office"}


def room_at(x: float, y: float, _floor: str = "main") -> str:
    if not (0.0 <= y <= 4.0) or not (0.0 <= x <= 13.0):
        return ""
    return "Kitchen" if x < 5.0 else "Hall" if x < 8.0 else "Office"


def rssi_at(x: float, y: float, rng: random.Random, sd: float = 2.0) -> dict[str, float]:
    out = {}
    for s, (sx, sy) in SCANNERS.items():
        d = max(0.5, math.hypot(x - sx, y - sy))
        out[s] = round(-59.0 - 25.0 * math.log10(d) + rng.gauss(0.0, sd), 1)
    return out


def cal_point(i: int, x: float, y: float, readings: dict[str, float], **extra) -> dict:
    p = {
        "id": f"p{i}", "map_id": "m", "floor_id": "main", "x_m": x, "y_m": y,
        "room": room_at(x, y), "label": "",
        "scanner_readings": [
            {"source": s, "name": s, "rssi_samples": [v], "mean_rssi": v,
             "std_rssi": 0.0, "sample_count": 5}
            for s, v in readings.items()
        ],
    }
    p.update(extra)
    return p


def calibration_points(seed: int = 3) -> list[dict]:
    """A walked grid, plus a pinned beacon's pile of near-copies."""
    rng = random.Random(seed)
    pts: list[dict] = []
    i = 0
    for x in (1.0, 3.0, 6.0, 7.5, 9.5, 11.5):
        for y in (1.0, 3.0):
            pts.append(cal_point(i, x, y, rssi_at(x, y, rng)))
            i += 1
    for _ in range(40):
        pts.append(cal_point(i, 2.0, 2.0, rssi_at(2.0, 2.0, rng, sd=0.5),
                             label="[auto] Beacon", device_id="b1"))
        i += 1
    return pts


def make_store(points: list[dict]) -> CalibrationStore:
    store = CalibrationStore.__new__(CalibrationStore)
    store.hass = MagicMock()
    store.hass.data = {DOMAIN: {}}
    store.store = MagicMock()
    store.data = {"points": list(points), "model": {}}
    store._rf = RandomForestLocator()
    store._model = None
    return store


def make_coord(settings: dict[str, Any] | None = None) -> PresenceCoordinator:
    hass = MagicMock()
    st = MagicMock()
    st.data = {"kalman_q": 0.125, "kalman_r": 8.0, **(settings or {})}
    model = MagicMock()
    model.beacon_room_from_geometry.side_effect = lambda x, y, f: room_at(x, y, f)
    cal = make_store(calibration_points())
    cal.hass = hass
    hass.data = {DOMAIN: {DATA_SETTINGS: st, DATA_MODEL: model, DATA_CALIBRATION: cal}}
    c = PresenceCoordinator(hass)
    c.update_interval = timedelta(seconds=10)
    c._pending_room_changes = []
    c._use_metres = True
    c._scanner_positions = {s: (x, y, "main") for s, (x, y) in SCANNERS.items()}
    c._floor_stack_idx = {"main": 0}
    c._floor_bases = {"main": 0.0}
    c._scanner_abs_z = {s: 2.3 for s in SCANNERS}
    c._floor_bounds = {"main": (0.0, 0.0, 13.0, 4.0)}
    c._room_centroids = {"Kitchen": (2.5, 2.0, "main"), "Hall": (6.5, 2.0, "main"),
                         "Office": (10.5, 2.0, "main")}
    return c


def walk(coord: PresenceCoordinator, seed: int = 11) -> list[Any]:
    """Two devices, 60 polls: one walks Kitchen -> Office and back, one sits
    in the Hall; every seventh poll only two scanners hear the walker."""
    rng = random.Random(seed)
    clock = [1000.0]
    rows: list[Any] = []
    with patch.object(pc_mod.time, "monotonic", lambda: clock[0]):
        for t in range(60):
            clock[0] += 10.0
            x = 1.0 + 11.0 * (t / 30.0) if t < 30 else 12.0 - 11.0 * ((t - 30) / 30.0)
            r1 = rssi_at(x, 2.0, rng, sd=3.0)
            if t % 7 == 3:
                r1 = dict(sorted(r1.items(), key=lambda kv: -kv[1])[:2])
            r2 = rssi_at(6.5, 1.5, rng, sd=3.0)
            for key, addr, r in (("walker", "AA:00:00:00:00:01", r1),
                                 ("sitter", "AA:00:00:00:00:02", r2)):
                room = coord._smooth_room(key, addr, {addr: r}, S2A, 3, 2, S2F, ROOMS)
                rows.append([
                    key, room, coord._room_confidence.get(key),
                    coord._rssi_margin_confidence.get(key),
                    coord._knn_position.get(key), coord._spatial_position.get(key),
                    coord._last_candidate.get(key),
                ])
    return rows


def digest(rows: list[Any]) -> str:
    return hashlib.sha256(json.dumps(rows, sort_keys=True, default=str).encode()).hexdigest()


# Recorded from 0.38.164's presence_coordinator on walk() above.
GOLDEN_0_38_164 = "b5d6d0d9cca7454ef5fd6546ba2d122ebf9d028058a5401a9f1172e5174e3dc9"


def test_settings_off_give_exactly_what_0_38_164_gave():
    assert digest(walk(make_coord())) == GOLDEN_0_38_164
