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


def test_settings_explicitly_off_are_the_same_as_absent():
    off = {"positioning_pick_better": False, "positioning_unsure": False,
           "positioning_sensor_fusion": False}
    assert digest(walk(make_coord(off))) == GOLDEN_0_38_164


def test_a_preferred_method_chosen_while_the_setting_is_off_changes_nothing():
    # The hourly held-out run also feeds the opt-in report, so it can pick a
    # method in a house that never turned Pick the better method on.
    c = make_coord()
    c._preferred_method = "knn"
    assert digest(walk(c)) == GOLDEN_0_38_164
    assert c._prefer_knn_now() is False


def test_each_setting_on_does_something():
    assert digest(walk(make_coord({"positioning_unsure": True}))) != GOLDEN_0_38_164
    c = make_coord({"positioning_pick_better": True})
    c._preferred_method = "knn"
    rows = walk(c)
    assert digest(rows) != GOLDEN_0_38_164
    assert any((r[6] or {}).get("source") == "knn" for r in rows)


# ── defaults and plumbing ────────────────────────────────────────────────────

from pathlib import Path  # noqa: E402

from custom_components.padspan_ha import heldout as H  # noqa: E402
from custom_components.padspan_ha import telemetry as T  # noqa: E402

_WWW = Path(H.__file__).resolve().parent / "www" / "padspan-ha"
NEW_KEYS = ("positioning_pick_better", "positioning_unsure", "positioning_sensor_fusion")


def test_all_three_are_off_by_default_and_accepted():
    from custom_components.padspan_ha import ws_settings as WS
    from custom_components.padspan_ha.settings_store import DEFAULT_SETTINGS
    src = Path(WS.__file__).read_text(encoding="utf-8")
    for k in NEW_KEYS:
        assert DEFAULT_SETTINGS[k] is False
        assert f'vol.Optional("{k}"): bool' in src
    assert ('for _hk in ("positioning_pick_better", "positioning_unsure", '
            '"positioning_sensor_fusion")') in src


def test_the_settings_card_offers_them_and_says_they_are_off():
    js = (_WWW / "views" / "settings.js").read_text(encoding="utf-8")
    card = js[js.index("// ── Honest accuracy"):js.index("// ── Presence Poll Interval")]
    for k in NEW_KEYS:
        assert f'"{k}"' in card
    assert "Pick the better method for this house" in card
    assert "settings[key] === true" in card and "All off by default" in card


def test_the_held_out_line_sits_beside_the_existing_score():
    cal = (_WWW / "views" / "calibration.js").read_text(encoding="utf-8")
    assert 'statGrid.appendChild(stat("Est. Accuracy"' in cal          # unchanged
    assert "Tested on spots it hasn't seen" in cal
    qa = (_WWW / "views" / "qa.js").read_text(encoding="utf-8")
    assert '_propBar("Distance Accuracy"' in qa and "Tested on spots it hasn't seen" in qa


# ── the held-out score ───────────────────────────────────────────────────────

def _site() -> H.SpatialSite:
    return H.SpatialSite(positions={s: (x, y, "main") for s, (x, y) in SCANNERS.items()},
                         fit_sources=set(SCANNERS), ref=-59.0, n_exp=2.5,
                         abs_z={s: 2.3 for s in SCANNERS}, floor_bases={"main": 0.0})


def test_held_out_reads_worse_than_leave_one_out_on_duplicate_heavy_data():
    pts = calibration_points()
    loo = make_store(pts).loo_accuracy()
    ho = H.evaluate(pts, room_at=room_at, site=_site(), source_area=S2A)
    # Leave-one-out: a near-copy answers for every beacon point left out.
    assert loo["median_error_m"] < 0.1
    assert ho["knn"]["median_error_m"] > loo["median_error_m"] + 1.0
    assert ho["knn"]["rooms_right_pc"] / 100 < loo["room_confusion"]["overall_accuracy"]


def test_the_beacon_pile_is_one_test_spot_and_is_held_out_whole():
    pts = calibration_points()
    ho = H.evaluate(pts, room_at=room_at)
    assert ho["knn"]["spots"] == 12 + 1
    beacon = next(i for i, p in enumerate(pts) if p.get("device_id") == "b1")
    train = H.held_in(pts, beacon)
    assert not any(p.get("device_id") == "b1" for p in train)
    assert all(math.hypot(p["x_m"] - 2.0, p["y_m"] - 2.0) > H.HELDOUT_RADIUS_M for p in train)


def test_the_held_out_test_never_changes_calibration_data():
    import copy
    pts = calibration_points()
    before = copy.deepcopy(pts)
    H.evaluate(pts, room_at=room_at, site=_site(), source_area=S2A)
    assert pts == before
    c = make_coord()
    cal = c.hass.data[DOMAIN][DATA_CALIBRATION]
    snap = copy.deepcopy(cal.data)
    c._last_source_to_area = dict(S2A)
    res = c.heldout_compute()
    assert res and res["knn"] and res["spatial"]
    assert cal.data == snap


def test_too_few_points_is_no_score():
    assert H.evaluate(calibration_points()[:3]) is None


def _res(kr, sr, km=1.0, sm=1.0, n=20):
    return {"knn": {"rooms_right_pc": kr, "median_error_m": km, "room_spots": n},
            "spatial": {"rooms_right_pc": sr, "median_error_m": sm, "room_spots": n}}


def test_better_needs_a_clear_win_and_a_tie_keeps_what_is_in_use():
    assert H.better_method(_res(90, 80)) == "knn"
    assert H.better_method(_res(80, 90)) == "spatial"
    assert H.better_method(_res(85, 83)) == "tie"
    assert H.better_method(_res(85, 83, km=1.0, sm=2.0)) == "knn"
    assert H.better_method(_res(90, 80, n=5)) is None
    assert H.next_preferred("spatial", _res(90, 80)) == "knn"
    assert H.next_preferred("knn", _res(85, 83)) == "knn"      # no flip on noise
    assert H.next_preferred("knn", None) == "knn"
    assert H.next_preferred("knn", _res(70, 90)) == "spatial"


def test_the_refresh_runs_only_while_something_uses_it():
    c = make_coord()
    c.hass.async_create_task = MagicMock()
    c._maybe_refresh_heldout()
    c.hass.async_create_task.assert_not_called()
    for key in ("positioning_pick_better", "telemetry_enabled"):
        c = make_coord({key: True})
        c.hass.async_create_task = MagicMock()
        c._maybe_refresh_heldout()
        assert c.hass.async_create_task.call_count == 1
        c.hass.async_create_task.call_args.args[0].close()


# ── unsure ───────────────────────────────────────────────────────────────────

def test_unsure_keeps_the_room_and_says_why():
    c = make_coord({"positioning_unsure": True})
    addr = "AA:00:00:00:00:09"
    with patch.object(pc_mod.time, "monotonic", lambda: 5000.0):
        for _ in range(4):
            c._smooth_room("d", addr, {addr: rssi_at(1.5, 2.0, random.Random(1), 0.5)},
                           S2A, 3, 2, S2F, ROOMS)
        assert c._confirmed_room["d"] == "Kitchen" and "d" not in c._room_unsure
        office = dict(sorted(rssi_at(11.5, 2.0, random.Random(2), 0.5).items(),
                             key=lambda kv: -kv[1])[:2])
        for _ in range(6):
            c._smooth_room("d", addr, {addr: office}, S2A, 3, 2, S2F, ROOMS)
    assert c._room_unsure["d"] == "few_scanners"
    assert c._confirmed_room["d"] == "Kitchen"


def test_unsure_reaches_the_entity_and_the_snapshot_only_when_set():
    pkg = Path(H.__file__).parent
    sensor = (pkg / "sensor.py").read_text(encoding="utf-8")
    assert 'if obj.get("room_unsure"):\n            attrs["room_unsure"] = obj["room_unsure"]' in sensor
    assert '"room_unsure",' in (pkg / "snapshot_builder.py").read_text(encoding="utf-8")


# ── sensor fusion + the transition prior ─────────────────────────────────────

def _fusion_coord(corr: dict[str, Any], prior: dict[str, float] | None = None):
    from custom_components.padspan_ha.const import DATA_ADAPTIVE
    c = make_coord({"positioning_sensor_fusion": True})
    c._room_corroborated = lambda r: corr.get(r)
    ad = MagicMock()
    ad.transition_prior.return_value = prior or {}
    c.hass.data[DOMAIN][DATA_ADAPTIVE] = ad
    return c


def test_fusion_breaks_a_near_tie_toward_the_room_with_motion():
    c = _fusion_coord({"Hall": True, "Kitchen": False})
    assert c._fusion_nudge("Kitchen", "Kitchen", {"Kitchen": -60.0, "Hall": -62.0}) == "Hall"


def test_fusion_never_picks_a_room_the_radios_put_far_behind_or_do_not_hear():
    c = _fusion_coord({"Office": True, "Garden": True, "Kitchen": False})
    assert c._fusion_nudge("Kitchen", None, {"Kitchen": -60.0, "Office": -70.0}) == "Kitchen"


def test_fusion_keeps_the_candidate_on_an_even_score():
    c = _fusion_coord({})
    assert c._fusion_nudge("Kitchen", "Kitchen", {"Kitchen": -60.0, "Hall": -61.0}) == "Kitchen"


def test_fusion_uses_the_learned_moves():
    # From the Hall this device has gone to the Office, never to the Kitchen.
    c = _fusion_coord({}, prior={"Office": 1.0, "Kitchen": 0.0})
    assert c._fusion_nudge("Kitchen", "Hall", {"Kitchen": -60.0, "Office": -61.0}) == "Office"


def test_fusion_on_in_a_house_with_no_sensors_changes_nothing():
    c = make_coord({"positioning_sensor_fusion": True})
    c._room_corroborated = lambda r: None
    assert digest(walk(c)) == GOLDEN_0_38_164


# ── the opt-in report: buckets only, only where they apply ───────────────────

def test_report_buckets_are_words_from_the_list():
    pts = calibration_points()
    b = H.report_buckets(H.evaluate(pts, room_at=room_at, site=_site(), source_area=S2A))
    assert set(b) <= {"knn_room", "knn_med", "sp_room", "sp_med", "better"}
    assert b["better"] in H.BETTER_WORDS and b["knn_room"] in H.ROOM_BUCKETS
    assert H.report_buckets(None) is None
    assert H.room_bucket(94.9) == "85_95" and H.median_bucket(0.4) == "lt1"


def test_the_report_refuses_a_heldout_word_off_the_list():
    import pytest
    T.assert_shareable({"install_id": "", "env": {"heldout": {"knn_room": "ge95", "better": "knn"}}})
    with pytest.raises(ValueError):
        T.assert_shareable({"install_id": "", "env": {"heldout": {"knn_room": "97"}}})


def test_the_settings_are_reported_as_on_only():
    for k, w in (("positioning_pick_better", "pick_better"), ("positioning_unsure", "unsure"),
                 ("positioning_sensor_fusion", "fusion")):
        assert T._FEATURE_ON_ONLY[k] == w
    assert T.PERF_METRICS["pos_unsure_pc"] == ("pos_unsure", ("p50", "p95"))
    assert T.PERF_METRICS["fusion_changes"] == ("fusion_chg", ("per_h",))
