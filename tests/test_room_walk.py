"""Walk a room (room_walk.py, setting calibration_room_walk, off by default).

The walk only ever adds points the user confirmed, marked source="room_walk";
replacing a walk touches only that room's room_walk points; every other
calibration point stays exactly as it was. Off, nothing changes anywhere.
"""

from __future__ import annotations

import asyncio
import copy
import random
import re
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

from custom_components.padspan_ha import room_walk as RW
from custom_components.padspan_ha import telemetry as T
from custom_components.padspan_ha import ws_calibration as WC
from custom_components.padspan_ha.calibration_store import CalibrationStore
from custom_components.padspan_ha.const import DATA_CALIBRATION, DATA_SETTINGS, DOMAIN
from custom_components.padspan_ha.settings_store import DEFAULT_SETTINGS

_WWW = Path(__file__).resolve().parents[1] / "custom_components" / "padspan_ha" / "www" / "padspan-ha"


class _Model:
    def map_frac_to_metres(self, x, y, map_id):
        return (x * 10.0, y * 10.0)

    def room_geometry_m(self):
        return {}

    def room_meta(self):
        return {}

    def floor_base_elevations_m(self):
        return {"ground": 0.0}


def _store(points):
    s = CalibrationStore.__new__(CalibrationStore)
    s.hass = SimpleNamespace(data={})
    s.store = AsyncMock()
    s.data = {"points": copy.deepcopy(points), "model": {"k": 1}}
    s._model = _Model()
    s._async_train_rf = AsyncMock()
    return s


def _pt(pid, room, readings, **extra):
    return {"id": pid, "map_id": "m", "x_frac": 0.2, "y_frac": 0.3, "x_m": 2.0, "y_m": 3.0,
            "floor_id": "ground", "room": room, "label": "", "device_id": "phone",
            "scanner_readings": [{"source": s, "name": s, "rssi_samples": [v] * 5, "mean_rssi": v,
                                  "std_rssi": 0.0, "sample_count": 5} for s, v in readings.items()],
            **extra}


EXISTING = [
    _pt("cp_kitchen", "Kitchen", {"a": -50.0, "b": -80.0}),
    _pt("cp_auto", "Office", {"a": -85.0, "b": -55.0}, label="[auto] tag"),
    _pt("cp_walk_office", "Office", {"a": -84.0, "b": -56.0}, source="room_walk", walk_id="rw_old"),
]


def _polls(base, n=90, seed=1):
    rnd = random.Random(seed)
    return [{s: v + rnd.uniform(-3, 3) for s, v in base.items()} for _ in range(n)]


def _run(coro):
    return asyncio.run(coro)


# ── The pure part, on synthetic walks ───────────────────────────────────────

def test_polls_are_cleaned_and_masked():
    polls = RW.clean_polls([{"a": -60, "b": "x", "c": True, "d": 5.0, "gone": -70}, "junk", {}],
                           excluded=frozenset({"gone"}))
    assert polls == [{"a": -60.0}, {}]


def test_summary_counts_and_says_how_distinct_the_room_is():
    walk = _polls({"a": -52.0, "b": -79.0})
    s = RW.summarize(walk, "Lounge", EXISTING)
    assert s["polls"] == 90 and s["samples"] == 180 and s["scanners"] == 2 and s["enough"]
    assert s["nearest_room"] == "Kitchen" and s["looks"] == "similar"   # it reads like the kitchen
    far = RW.summarize(_polls({"a": -70.0, "b": -70.0, "c": -60.0}), "Hall", EXISTING)
    assert far["looks"] == "distinct" and far["gap_db"] >= RW.DISTINCT_DB
    assert RW.summarize(walk, "Office", EXISTING)["previous_walk_points"] == 1
    assert not RW.summarize(walk[:5], "Lounge", EXISTING)["enough"]
    assert RW.summarize(walk, "Lounge", [])["looks"] == "unknown"


def test_the_walk_is_cut_into_consecutive_slices():
    walk = _polls({"a": -60.0}, n=60)
    sl = RW.slice_readings(walk)
    assert len(sl) == RW.WALK_SLICES
    assert sum(len(r[0]["rssi_samples"]) for r in sl) == 60
    assert sl[0][0]["rssi_samples"] == [p["a"] for p in walk[:10]]


# ── Saving: only room_walk points, only after confirm, nothing else touched ──

def _walk_pts(n=90):
    return [{"map_id": "m", "x_frac": 0.5, "y_frac": 0.5, "floor_id": "ground", "device_id": "phone",
             "duration_s": 15, "scanner_readings": r}
            for r in RW.slice_readings(_polls({"a": -60.0, "b": -65.0}, n=n))]


def test_save_adds_only_room_walk_points_and_leaves_the_rest_untouched():
    s = _store(EXISTING)
    res = _run(s.async_add_room_walk("Lounge", _walk_pts()))
    assert res["added"] == RW.WALK_SLICES and res["replaced"] == 0
    assert s.data["points"][:3] == EXISTING           # byte-for-byte as they were
    new = s.data["points"][3:]
    assert all(p["source"] == "room_walk" and p["room"] == "Lounge" and p["walk_id"] == res["walk_id"]
               and p["label"] == "[walk] Lounge" for p in new)
    assert s.data["model"] == {"k": 1}


def test_a_room_with_a_walk_is_refused_without_confirm():
    s = _store(EXISTING)
    try:
        _run(s.async_add_room_walk("Office", _walk_pts()))
        raise AssertionError("should refuse")
    except ValueError as e:
        assert "already has a walk" in str(e)
    assert s.data["points"] == EXISTING
    s.store.async_save.assert_not_called()


def test_replace_touches_only_that_rooms_walk_points():
    s = _store(EXISTING + [_pt("cp_walk_kitchen", "Kitchen", {"a": -49.0}, source="room_walk")])
    res = _run(s.async_add_room_walk("Office", _walk_pts(), replace=True))
    ids = [p["id"] for p in s.data["points"]]
    assert res["replaced"] == 1 and "cp_walk_office" not in ids
    assert ids[:3] == ["cp_kitchen", "cp_auto", "cp_walk_kitchen"]   # the Office [auto] point stays
    assert s.data["points"][0] == EXISTING[0] and s.data["points"][1] == EXISTING[1]


def test_remove_takes_only_that_rooms_walk():
    s = _store(EXISTING)
    assert _run(s.async_remove_room_walk("Kitchen")) == 0
    assert _run(s.async_remove_room_walk("Office")) == 1
    assert s.data["points"] == EXISTING[:2]


def test_an_ordinary_point_save_is_unchanged():
    s = _store([])
    p = _run(s.async_add_point({"map_id": "m", "x_frac": 0.5, "y_frac": 0.5, "room": "Den", "source": "room_walk",
                                "scanner_readings": [{"source": "a", "rssi_samples": [-60, -61, -62]}]}))
    assert "source" not in p and "walk_id" not in p


# ── The websocket commands ──────────────────────────────────────────────────

def _house(on, points=EXISTING):
    st = SimpleNamespace(data={**DEFAULT_SETTINGS, "calibration_room_walk": on})
    cal = _store(points)
    coord = SimpleNamespace(async_heldout=AsyncMock(side_effect=[
        {"knn": {"rooms_right_pc": 70}}, {"knn": {"rooms_right_pc": 80}}]))
    cal.hass = SimpleNamespace(data={DOMAIN: {DATA_SETTINGS: st}})
    return SimpleNamespace(data={DOMAIN: {DATA_SETTINGS: st, DATA_CALIBRATION: cal,
                                          "presence_coordinator": coord}}), cal


def _conn():
    return MagicMock(user=SimpleNamespace(is_admin=True))


def _save_msg(**kw):
    return {"id": 1, "room": "Lounge", "map_id": "m", "x_frac": 0.5, "y_frac": 0.5, "floor_id": "ground",
            "device_id": "phone", "duration_s": 90, "polls": _polls({"a": -60.0}), "replace": False, **kw}


def test_off_the_commands_do_nothing():
    for handler, msg in ((WC.ws_calibration_room_walk_preview, {"id": 1, "room": "Lounge", "polls": []}),
                         (WC.ws_calibration_room_walk_save, _save_msg())):
        hass, cal = _house(False)
        conn = _conn()
        _run(handler(hass, conn, msg))
        assert conn.send_error.call_args.args[1] == "off"
        assert cal.data["points"] == EXISTING
        cal.store.async_save.assert_not_called()


def test_save_reports_heldout_before_and_after():
    hass, cal = _house(True)
    conn = _conn()
    _run(WC.ws_calibration_room_walk_save(hass, conn, _save_msg()))
    r = conn.send_result.call_args.args[1]
    assert r["ok"] and r["added"] == RW.WALK_SLICES and r["change"] == "up"
    assert r["heldout_before"]["knn"]["rooms_right_pc"] == 70 and r["heldout_after"]["knn"]["rooms_right_pc"] == 80
    assert cal.data["points"][:3] == EXISTING and cal.data["room_walk"] == {"last_change": "up"}


def test_save_without_confirm_on_a_walked_room_asks_first():
    hass, cal = _house(True)
    conn = _conn()
    _run(WC.ws_calibration_room_walk_save(hass, conn, _save_msg(room="Office")))
    assert conn.send_error.call_args.args[1] == "exists" and cal.data["points"] == EXISTING


def test_a_short_walk_is_not_saved():
    hass, cal = _house(True)
    conn = _conn()
    _run(WC.ws_calibration_room_walk_save(hass, conn, _save_msg(polls=_polls({"a": -60.0}, n=3))))
    assert conn.send_error.call_args.args[1] == "too_short" and cal.data["points"] == EXISTING


# ── Field signal ─────────────────────────────────────────────────────────────

def test_report_buckets_only_when_on_and_walked():
    on = {"calibration_room_walk": True}
    assert RW.report_buckets({}, EXISTING, "up") is None
    assert RW.report_buckets(on, EXISTING[:2], "up") is None
    assert RW.report_buckets(on, EXISTING, "up") == {"walks": "1", "change": "up"}
    assert RW.report_buckets(on, EXISTING, None) == {"walks": "1"}
    assert RW.change_word({"knn": {"rooms_right_pc": 80}}, {"knn": {"rooms_right_pc": 81}}) == "same"
    assert RW.change_word(None, {"knn": {"rooms_right_pc": 81}}) is None


def test_the_report_vocabulary_is_closed():
    T.assert_shareable({"env": {"room_walk": {"walks": "2_3", "change": "down"}}})
    for bad in ({"walks": "3"}, {"rooms": "1"}, {"walks": "1", "change": "Kitchen"}):
        try:
            T.assert_shareable({"env": {"room_walk": bad}})
            raise AssertionError(bad)
        except ValueError:
            pass
    assert T._FEATURE_ON_ONLY["calibration_room_walk"] == "room_walk"


# ── Off by default; the panel shows nothing new until it is on ──────────────

def test_off_by_default():
    assert DEFAULT_SETTINGS["calibration_room_walk"] is False


def test_the_tab_and_the_module_only_load_when_on():
    src = (_WWW / "views" / "calibration.js").read_text(encoding="utf-8")
    assert re.search(r'settings\?\.calibration_room_walk === true\s*\)\s*TABS\.push\(\["walk"', src)
    assert 'if (cs.tab === "walk" && _walkOn)' in src
    assert 'import("./calibration_walk.js' in src and 'from "./calibration_walk.js' not in src
