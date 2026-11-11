"""Let Claude draw your rooms, piece 3: a plan's scale by one guided measurement.

plan_ai_write.py's scale section (scale_save, scale_undo, settle_scale), the
Measure tool's writer it goes through (ws_fabric.async_write_measured_transform),
ModelStore.async_unset_world_gauge, and ws_plan_ai.py's plan_build_scale_*
commands (design PadspanResearch ai-wizard-design-2026-11-10.md, E.2-E.6, H.1).
test_plan_build.py's synthetic house in the REAL model, maps and calibration
stores, on disk, with one more plan that was never measured: every write is
the real one. No house's plans or data are in the repo.
"""
from __future__ import annotations

import asyncio
import copy
import json
import re
import time
from pathlib import Path

import pytest

from custom_components.padspan_ha import house3d_store as H3
from custom_components.padspan_ha import plan_ai as A
from custom_components.padspan_ha import plan_ai_write as C
from custom_components.padspan_ha import plan_geom as G
from custom_components.padspan_ha import subzones as SZ
from custom_components.padspan_ha import telemetry as T
from custom_components.padspan_ha import ws_fabric as F
from custom_components.padspan_ha import ws_plan_ai as WP
from custom_components.padspan_ha.const import DATA_HOUSE3D, DATA_PLAN_AI, DATA_SUBZONES, DOMAIN, MODEL_STORE_KEY, PLAN_AI_STORE_KEY
from custom_components.padspan_ha.model_store import ModelStore
from tests.test_house3d_edit import disk  # noqa: F401  (the on-disk store fixture)
from tests.test_house3d_store import _run
from tests.test_plan_build import _call, _counters, _house
from tests.test_plan_build_write import _backups, _real

_PKG = Path(__file__).resolve().parents[1] / "custom_components" / "padspan_ha"
# A plan nobody measured: 1000 x 800 pixels on the main floor.
_N1 = {"id": "n1", "name": "New plan", "floor_id": "main", "image": {"filename": "other.png", "width": 1000, "height": 800, "sha256": "nn"},
       "updated": "2026-11-09", "room_bounds": {}, "receivers": [], "beacons": [], "lights": []}
# Half the picture's width is five metres: 100 px/m, the plan 10 m by 8 m.
_ACROSS = {"p1": [0.1, 0.5], "p2": [0.6, 0.5], "text": "5 m"}


def _setup(monkeypatch, tmp_path, disk, *, gauge=True, plan=None):  # noqa: F811
    h, conn, _ai = _house(monkeypatch, tmp_path, extra_maps=[dict(plan or _N1)])
    mdl, ms, cal = _real(h, disk)
    mdl.data["map_transforms"].pop("n1")                      # never measured
    if not gauge:
        mdl.data["world_gauge"] = {"m_per_unit": None, "source_map_id": None}
    _run(mdl.store.async_save(mdl.data))
    disk.writes.clear()
    return h, conn, mdl, ms, cal


def _now(mdl, ms, cal) -> str:
    """The three house stores, as their bytes."""
    return json.dumps({"model": mdl.data, "maps": ms.data, "cal": cal.data})


def _metres(mdl, cal) -> dict:
    return copy.deepcopy({"rooms": mdl.room_geometry_m(), "receivers": mdl.scanner_positions_m(), "beacons": mdl.beacon_positions_m(),
                          "lights": mdl.light_positions_m(), "cal": cal.data})


def _save(h, conn, **kw):
    msg = {"map_id": "n1", "sig": "nn", "measures": [dict(_ACROSS)], "source": "guided", "via": "wizard", **kw}
    return _call(WP.ws_plan_build_scale_save, h, conn, **msg)


def _undo(h, conn, **kw):
    return _call(WP.ws_plan_build_scale_undo, h, conn, via="wizard", **kw)


def _store(h):
    return h.data[DOMAIN][DATA_PLAN_AI]


# ═══ the save ═════════════════════════════════════════════════════════════════

def test_the_save_writes_exactly_measures_payload_through_the_shared_writer(monkeypatch, tmp_path, disk):  # noqa: F811
    h, conn, mdl, ms, cal = _setup(monkeypatch, tmp_path, disk)
    sent, real = [], F.async_write_measured_transform

    async def spy(hass, map_id, transform):
        sent.append((map_id, copy.deepcopy(transform)))
        return await real(hass, map_id, transform)
    monkeypatch.setattr(F, "async_write_measured_transform", spy)
    out = _save(h, conn)
    assert out["ok"] is True and out["across_m"] == 10.0 and out["down_m"] == 8.0 and out["odd"] is False
    today = time.strftime("%Y-%m-%d", time.gmtime())
    # maps.js's Save Scale: scale_x_m, scale_y_m, floor_id, reference_measurements (p1, p2, distance_m, px_per_meter, angle_deg, date): no origin, rotation or lean.
    assert sent == [("n1", {"scale_x_m": 10.0, "scale_y_m": 8.0, "floor_id": "main", "reference_measurements": [
        {"p1": [0.1, 0.5], "p2": [0.6, 0.5], "distance_m": 5.0, "px_per_meter": 100.0, "angle_deg": 0, "date": today, "source": "guided"}]})]
    t = mdl.map_transform("n1")
    assert t["scale_x_m"] == 10.0 and t["origin_x_m"] == 0.0 and t["rotation_rad"] == 0.0 and t["origin_anchored"] is True
    assert _counters(h)["plan_build_scale_save:done"] == 1
    b = next(iter(_store(h).data["scale_batches"].values()))
    assert b["after"]["t"] == t and not b.get("pending") and b["before"]["t"] is None


def test_measures_own_handler_goes_through_the_same_writer(monkeypatch, tmp_path, disk):  # noqa: F811
    h, conn, mdl, ms, cal = _setup(monkeypatch, tmp_path, disk)
    calls = []

    async def spy(hass, map_id, transform):
        calls.append(map_id)
        return {"scale_x_m": 1.0, "scale_y_m": 1.0, "reference_measurements": []}
    monkeypatch.setattr(F, "async_write_measured_transform", spy)
    out = _call(F.ws_fabric_map_transform_set, h, conn, map_id="n1", transform={"scale_x_m": 3.0, "scale_y_m": 2.0})
    assert calls == ["n1"] and out["ok"] is True
    assert "n1" not in mdl.data["map_transforms"]                 # the handler wrote nothing itself


def test_one_writer_the_helper_never_writes_a_plans_scale_past_measures_writer(monkeypatch, tmp_path, disk):  # noqa: F811
    """A mutation: Measure's writer made a do-nothing, the save must leave
    every record and the house scale as they were (test_map_transform_single_writer.py's shape)."""
    h, conn, mdl, ms, cal = _setup(monkeypatch, tmp_path, disk, gauge=False)
    was = copy.deepcopy((mdl.data["map_transforms"], mdl.data["world_gauge"]))

    async def nothing(hass, map_id, transform):
        return {}
    monkeypatch.setattr(F, "async_write_measured_transform", nothing)
    _save(h, conn)
    assert (mdl.data["map_transforms"], mdl.data["world_gauge"]) == was
    # And in the source: the scale section names no other writer of a placement or of the house scale.
    src = (_PKG / "plan_ai_write.py").read_text(encoding="utf-8")
    scale = src[src.index("# ── The rooms helper's scale"):]
    assert ".async_set_map_transform(" not in scale and ".async_reanchor_map(" not in scale and "reanchor=" not in scale
    assert "map_transforms\"]" not in scale and "[\"world_gauge\"] =" not in scale
    # The un-set writer: defined once, called from scale_undo only.
    callers = [p.name for p in _PKG.glob("*.py") if "async_unset_world_gauge(" in p.read_text(encoding="utf-8")]
    assert sorted(callers) == ["model_store.py", "plan_ai_write.py"] and scale.count("async_unset_world_gauge(") == 1


def test_the_house_scale_is_seeded_only_when_none_existed(monkeypatch, tmp_path, disk):  # noqa: F811
    h, conn, mdl, ms, cal = _setup(monkeypatch, tmp_path, disk, gauge=False)
    out = _save(h, conn)
    assert out["ok"] and out["house_scale_set"] is True
    g = mdl.world_gauge()
    assert g["source_map_id"] == "n1" and g["m_per_unit"] > 0


def test_a_house_scale_already_set_keeps_its_bytes(monkeypatch, tmp_path, disk):  # noqa: F811
    h, conn, mdl, ms, cal = _setup(monkeypatch, tmp_path, disk)
    was = json.dumps(mdl.data["world_gauge"])
    out = _save(h, conn, measures=[{"p1": [0.0, 0.0], "p2": [0.0, 1.0], "text": "13' 1 7/8\""}])
    assert out["ok"] and out["house_scale_set"] is False and json.dumps(mdl.data["world_gauge"]) == was
    on_disk = json.loads((tmp_path / ".storage" / MODEL_STORE_KEY).read_text(encoding="utf-8"))["data"]
    assert json.dumps(on_disk["world_gauge"]) == was


def test_nothing_else_in_metres_moves_and_nothing_is_placed_again(monkeypatch, tmp_path, disk):  # noqa: F811
    h, conn, mdl, ms, cal = _setup(monkeypatch, tmp_path, disk, gauge=False)
    cal.data["points"].append({"id": "cp_x", "map_id": "m1", "x_frac": 0.5, "y_frac": 0.5, "x_m": 4.0, "y_m": 3.0, "floor_id": "basement", "room": "Den"})
    was, others = _metres(mdl, cal), copy.deepcopy({k: v for k, v in mdl.data["map_transforms"].items()})
    real_set = ModelStore.async_set_map_transform

    async def no_reanchor(self, *a, **kw):
        raise AssertionError("re-anchor called")

    async def set_spy(self, map_id, transform, *, reanchor=False):
        assert reanchor is False
        return await real_set(self, map_id, transform)
    monkeypatch.setattr(ModelStore, "async_reanchor_map", no_reanchor)
    monkeypatch.setattr(ModelStore, "async_set_map_transform", set_spy)
    assert _save(h, conn)["ok"] is True
    assert _metres(mdl, cal) == was
    assert {k: v for k, v in mdl.data["map_transforms"].items() if k != "n1"} == others


def test_the_typed_length_is_parsed_on_the_server_and_a_scale_from_the_panel_is_never_read(monkeypatch, tmp_path, disk):  # noqa: F811
    h, conn, mdl, ms, cal = _setup(monkeypatch, tmp_path, disk)
    assert abs(G.parse_length("30' 5 1/2\"") - 9.2837) < 1e-3
    pv = _call(WP.ws_plan_build_scale_preview, h, conn, map_id="n1", via="wizard",
               measures=[{"p1": [0.0, 0.5], "p2": [1.0, 0.5], "text": "30' 5 1/2\""}])
    assert abs(pv["metres"][0] - 9.2837) < 1e-3 and abs(pv["across_m"] - 9.2837) < 1e-3 and pv["sig"] == "nn" and pv["stop"] is None
    for text, m in (("4.2 m", 4.2), ("420 cm", 4.2), ("13' 9\"", 4.191)):
        got = _call(WP.ws_plan_build_scale_preview, h, conn, map_id="n1", via="wizard", measures=[{**_ACROSS, "text": text}])
        assert abs(got["metres"][0] - m) < 1e-3, text
    bad = _call(WP.ws_plan_build_scale_preview, h, conn, map_id="n1", via="wizard", measures=[{**_ACROSS, "text": "about four"}])
    assert bad["metres"] == [None] and bad["invalid"] and "across_m" not in bad
    early = _call(WP.ws_plan_build_scale_preview, h, conn, map_id="n1", via="wizard", measures=[{"text": "13' 9\""}])
    assert abs(early["metres"][0] - 4.191) < 1e-3 and "across_m" not in early and "invalid" not in early      # understood before the clicks
    out = _save(h, conn, measures=[{**_ACROSS, "px_per_meter": 7.0, "scale_x_m": 99.0, "ppm": 3}], scale_x_m=99.0, ppm=3)
    assert out["ok"] and mdl.map_transform("n1")["scale_x_m"] == 10.0
    assert mdl.map_transform("n1")["reference_measurements"][0]["px_per_meter"] == 100.0


def test_a_bare_number_says_which_unit_it_was_read_in(monkeypatch, tmp_path, disk):  # noqa: F811
    h, conn, mdl, ms, cal = _setup(monkeypatch, tmp_path, disk)
    for text, m, unit in (("12", 12.0, "metres"), ("450", 0.45, "millimetres"), ("2 400", 2.4, "millimetres"), ("5 m", 5.0, None),
                          ("420 cm", 4.2, None), ("13' 9\"", 4.191, None), ("about four", None, None)):
        got = _call(WP.ws_plan_build_scale_preview, h, conn, map_id="n1", via="wizard", measures=[{**_ACROSS, "text": text}])
        assert got["assumed"] == [unit], text
        assert (got["metres"][0] is None) if m is None else abs(got["metres"][0] - m) < 1e-3, text
    assert G.length_read("1000+2") == (3.0, "metres and millimetres")
    assert all(G.parse_length(t) == G.length_read(t)[0] for t in ("12", "450", "9.284 m", "30'-5 1/2\"", "3 1/2\"", "1'+2'", "x"))


def test_an_odd_overall_size_is_said_never_refused(monkeypatch, tmp_path, disk):  # noqa: F811
    h, conn, mdl, ms, cal = _setup(monkeypatch, tmp_path, disk)
    out = _save(h, conn, measures=[{**_ACROSS, "text": "206 m"}])
    assert out["ok"] is True and out["odd"] is True and out["across_m"] > 400


# ═══ the refusals: data safety only, nothing written ══════════════════════════

@pytest.mark.parametrize("case", ["already_placed", "points_on_plan", "plan_changed", "no_picture_size", "floor_unknown", "backup_failed"])
def test_each_refusal_writes_nothing_and_is_counted(monkeypatch, tmp_path, disk, case):  # noqa: F811
    h, conn, mdl, ms, cal = _setup(monkeypatch, tmp_path, disk)
    kw = {}
    if case == "no_picture_size":
        ms.get_map("n1")["image"].pop("width")
    if case == "already_placed":
        kw = {"map_id": "m1", "sig": "mm"}
    elif case == "points_on_plan":
        cal.data["points"].append({"id": "cp_n", "map_id": "n1", "x_frac": 0.5, "y_frac": 0.5, "x_m": 1.0, "y_m": 1.0, "floor_id": "main", "room": ""})
    elif case == "plan_changed":
        kw = {"sig": "an_older_picture"}
    elif case == "floor_unknown":
        kw = {"floor_id": "attic"}
    else:
        disk.fail = ["swallowed"]                                   # the backup list's write is lost
    was = _now(mdl, ms, cal)
    out = _save(h, conn, **kw)
    assert out["ok"] is False and out["code"] == case and out["message"]
    assert _now(mdl, ms, cal) == was and _counters(h)[f"plan_build_scale_save:{case}"] == 1
    assert not (_store(h).data.get("scale_batches") or {})
    if case == "floor_unknown":
        assert out["floors"] == ["basement", "main", "upper"]
    if case == "no_picture_size":                                   # its own words, never "the picture changed"
        assert "no size on record" in out["message"] and "Mapping → Edit → Measure" in out["message"]
        pv = _call(WP.ws_plan_build_scale_preview, h, conn, map_id="n1", via="wizard")
        assert pv["stop"] == "no_picture_size" and pv["stop_message"] == out["message"]


def test_a_floor_picked_moves_the_plan_and_undo_puts_it_back(monkeypatch, tmp_path, disk):  # noqa: F811
    h, conn, mdl, ms, cal = _setup(monkeypatch, tmp_path, disk, plan={**_N1, "floor_id": "ground"})
    pv = _call(WP.ws_plan_build_scale_preview, h, conn, map_id="n1", via="wizard")
    assert pv["floor_known"] is False and pv["stop"] is None
    assert _save(h, conn)["code"] == "floor_unknown"
    out = _save(h, conn, floor_id="upper")
    assert out["ok"] and ms.get_map("n1")["floor_id"] == "upper" and mdl.map_transform("n1")["floor_id"] == "upper"
    assert _undo(h, conn)["ok"] is True
    assert ms.get_map("n1")["floor_id"] == "ground" and mdl.map_transform("n1") is None


def test_a_backup_in_its_own_slot_before_each_save_and_undo(monkeypatch, tmp_path, disk):  # noqa: F811
    h, conn, mdl, ms, cal = _setup(monkeypatch, tmp_path, disk)
    assert _save(h, conn)["ok"] and _undo(h, conn)["ok"]
    mine = [b for b in _backups(tmp_path) if b.get("slot") == C.SCALE_SLOT]
    assert len(mine) == 2 and mine[0]["note"].startswith("Before Let Claude draw your rooms set a plan's scale")
    assert "n1" not in mine[0]["stores"][MODEL_STORE_KEY]["map_transforms"] and "n1" in mine[1]["stores"][MODEL_STORE_KEY]["map_transforms"]


# ═══ undo ═════════════════════════════════════════════════════════════════════

@pytest.mark.parametrize("gauge", [True, False])
def test_undo_round_trip_byte_for_byte(monkeypatch, tmp_path, disk, gauge):  # noqa: F811
    h, conn, mdl, ms, cal = _setup(monkeypatch, tmp_path, disk, gauge=gauge)
    was = _now(mdl, ms, cal)
    assert _save(h, conn)["ok"]
    assert _now(mdl, ms, cal) != was
    out = _undo(h, conn)
    assert out["ok"] is True and out["house_scale_unset"] is (not gauge)
    assert _now(mdl, ms, cal) == was
    assert _counters(h)["plan_build_scale_undo:done"] == 1
    assert _undo(h, conn)["code"] == "nothing_to_undo"


@pytest.mark.parametrize("added", ["room", "receiver", "calibration_point", "other_plan"])
def test_undo_is_refused_once_something_in_metres_was_added(monkeypatch, tmp_path, disk, added):  # noqa: F811
    h, conn, mdl, ms, cal = _setup(monkeypatch, tmp_path, disk, gauge=False)
    assert _save(h, conn)["ok"]
    if added == "room":
        rooms = mdl.fabric.rooms_flat()
        monkeypatch.setattr(mdl.fabric, "rooms_flat", lambda: {**rooms, "Attic": {"floor_id": "main", "points_m": [[0, 0], [2, 0], [2, 2]]}})
    elif added == "receiver":
        rx = mdl.fabric.scanner_positions_m()
        monkeypatch.setattr(mdl.fabric, "scanner_positions_m", lambda: {**rx, "CC:DD": {"x_m": 1.0, "y_m": 1.0, "floor_id": "main"}})
    elif added == "calibration_point":
        cal.data["points"].append({"id": "cp_y", "map_id": "n1", "x_frac": 0.2, "y_frac": 0.2, "x_m": 2.0, "y_m": 1.6, "floor_id": "main", "room": ""})
    else:
        _run(mdl.async_set_map_transform("r1", {**mdl.map_transform("r1"), "scale_x_m": 7.0}))
    was = _now(mdl, ms, cal)
    out = _undo(h, conn)
    assert out["ok"] is False and out["code"] == "changed_since" and "Measure" in out["message"]
    assert _now(mdl, ms, cal) == was and mdl.world_gauge()["source_map_id"] == "n1"
    assert _counters(h)["plan_build_scale_undo:changed_since"] == 1


def test_undo_is_refused_after_a_hand_measure_and_that_measure_is_counted(monkeypatch, tmp_path, disk):  # noqa: F811
    h, conn, mdl, ms, cal = _setup(monkeypatch, tmp_path, disk)
    assert _save(h, conn)["ok"]
    hand = {"scale_x_m": 10.5, "scale_y_m": 8.4, "floor_id": "main", "reference_measurements": [
        {"p1": [0.1, 0.5], "p2": [0.6, 0.5], "distance_m": 5.25, "px_per_meter": 95.24, "angle_deg": 0, "date": "2026-11-10"}]}
    assert _call(F.ws_fabric_map_transform_set, h, conn, map_id="n1", transform=hand)["ok"]
    assert _counters(h)["plan_build_scale_remeasured:3_10"] == 1
    assert _undo(h, conn)["code"] == "changed_since"


def test_undo_with_no_backup_changes_nothing(monkeypatch, tmp_path, disk):  # noqa: F811
    h, conn, mdl, ms, cal = _setup(monkeypatch, tmp_path, disk)
    assert _save(h, conn)["ok"]
    was = _now(mdl, ms, cal)
    disk.fail = ["swallowed"]
    out = _undo(h, conn)
    assert out["code"] == "backup_failed" and _now(mdl, ms, cal) == was and _counters(h)["plan_build_scale_undo:failed"] == 1


# ═══ a restart in the middle ══════════════════════════════════════════════════

def _restart(h):
    """Home Assistant restarted: the plan store is read again from its file."""
    h.data[DOMAIN].pop(DATA_PLAN_AI, None)


@pytest.mark.parametrize("cut", ["before_the_write", "after_the_write"])
def test_a_save_cut_short_is_finished_or_taken_back_at_the_next_start(monkeypatch, tmp_path, disk, cut):  # noqa: F811
    h, conn, mdl, ms, cal = _setup(monkeypatch, tmp_path, disk, gauge=False)
    real = F.async_write_measured_transform

    async def cut_short(hass, map_id, transform):
        if cut == "after_the_write":
            await mdl.async_set_map_transform(map_id, transform)       # the record landed; the house scale not seeded yet
        raise asyncio.CancelledError                                   # Home Assistant stopping
    monkeypatch.setattr(F, "async_write_measured_transform", cut_short)
    with pytest.raises(asyncio.CancelledError):
        _save(h, conn)
    on_disk = json.loads((tmp_path / ".storage" / PLAN_AI_STORE_KEY).read_text(encoding="utf-8"))["data"]
    assert [b.get("pending") is not None for b in on_disk["scale_batches"].values()] == [True]
    monkeypatch.setattr(F, "async_write_measured_transform", real)
    _restart(h)
    _call(WP.ws_plan_build_scale_preview, h, conn, map_id="n1", via="wizard")      # the next start settles it
    batches = _store(h).data["scale_batches"]
    if cut == "before_the_write":
        assert batches == {} and mdl.map_transform("n1") is None and mdl.world_gauge()["m_per_unit"] is None
        assert _counters(h)["plan_build_settled:put_back"] == 1
    else:
        (b,) = batches.values()
        assert not b.get("pending") and b["after"]["t"] == mdl.map_transform("n1") and mdl.world_gauge()["source_map_id"] == "n1"
        assert _counters(h)["plan_build_settled:finished"] == 1
        assert _undo(h, conn)["ok"] is True and mdl.map_transform("n1") is None and mdl.world_gauge()["m_per_unit"] is None


# ═══ the rooms read after the helper's own scale; the counts ═════════════════

def test_the_rooms_read_right_after_the_helpers_scale_skips_the_minute_gap_only(monkeypatch, tmp_path, disk):  # noqa: F811
    h, conn, mdl, ms, cal = _setup(monkeypatch, tmp_path, disk)
    now = time.monotonic()
    h.data[DOMAIN][A._DATA_STARTS] = [now - 5]                                     # noqa: SLF001
    assert A.start_allowed(h, now) == "too_soon"
    assert A.take_scale_gap(h, now) is False                                      # no scale saved: no skip
    assert _save(h, conn)["ok"]
    assert A.take_scale_gap(h) is True and A.take_scale_gap(h) is False           # once
    assert A.start_allowed(h, now, skip_gap=True) is None
    h.data[DOMAIN][A._DATA_STARTS] = [now - 100 - i for i in range(A.STARTS_A_DAY)]  # noqa: SLF001
    assert A.start_allowed(h, now, skip_gap=True) == "daily_cap"
    src = (_PKG / "ws_plan_ai.py").read_text(encoding="utf-8")
    assert 'skip_gap=msg.get("via") == "wizard" and A.take_scale_gap(hass)' in src


def test_the_scale_counts_are_closed_shareable_and_named():
    words = {e for e in T.AI_WIZARD_EVENTS if e.startswith("plan_build_scale")}
    assert words == ({f"plan_build_scale:{k}" for k in ("printed", "unconfirmed_shown", "none_found", "guided", "already_set")}
                     | {f"plan_build_scale_save:{k}" for k in ("done", *C.SCALE_STOPS)}
                     | {f"plan_build_scale_undo:{k}" for k in ("done", "changed_since", "failed")}
                     | {f"plan_build_scale_remeasured:{k}" for k in T.PLAN_BUILD_PCT}
                     | {f"plan_build_scale_check:{k}" for k in ("yes", "corrected", "guided_instead")}
                     | {f"plan_build_scale_axes:{k}" for k in ("two", "one", "none")}
                     | {f"plan_build_scale_{w}:{k}" for w in ("fix", "stretch") for k in T.PLAN_BUILD_PCT})
    for e in words:
        assert T.event_allowed(e)
        T.assert_shareable({"usage": {e: 1}})
    assert not T.event_allowed("plan_build_scale:Kitchen")


def test_the_words_a_person_reads_say_no_inside_words():
    banned = re.compile(r"\b(anchor|refile|fabric|gauge|transform|placement|proposal)", re.I)
    for code, text in C.SCALE_WORDS.items():
        assert not banned.search(text), code


# ═══ the review's findings (2026-11-10): what the undo's check sees, and when ══

_CP = {"id": "cp_m", "map_id": "m1", "x_frac": 0.5, "y_frac": 0.5, "x_m": 4.0, "y_m": 3.0, "floor_id": "basement", "room": "Den"}
_ATTIC = {"floor_id": "main", "points_m": [[0, 0], [2, 0], [2, 2]]}
_HAND = {"scale_x_m": 10.5, "scale_y_m": 8.4, "floor_id": "main", "reference_measurements": [
    {"p1": [0.1, 0.5], "p2": [0.6, 0.5], "distance_m": 5.25, "px_per_meter": 95.24, "angle_deg": 0, "date": "2026-11-10"}]}


def _cut_save(monkeypatch, h, conn, mdl, **kw):
    """A save Home Assistant stopped right after Measure's write landed; then the restart."""
    real = F.async_write_measured_transform

    async def cut_short(hass, map_id, transform):
        await mdl.async_set_map_transform(map_id, transform)
        raise asyncio.CancelledError
    monkeypatch.setattr(F, "async_write_measured_transform", cut_short)
    with pytest.raises(asyncio.CancelledError):
        _save(h, conn, **kw)
    monkeypatch.setattr(F, "async_write_measured_transform", real)
    _restart(h)


def test_a_room_drawn_between_a_cut_save_and_its_settling_still_blocks_the_undo(monkeypatch, tmp_path, disk):  # noqa: F811
    h, conn, mdl, ms, cal = _setup(monkeypatch, tmp_path, disk, gauge=False)
    _cut_save(monkeypatch, h, conn, mdl)
    rooms = mdl.fabric.rooms_flat()
    monkeypatch.setattr(mdl.fabric, "rooms_flat", lambda: {**rooms, "Attic": _ATTIC})   # drawn after the restart, before the next command
    _call(WP.ws_plan_build_scale_preview, h, conn, map_id="n1", via="wizard")           # which settles the save
    (b,) = _store(h).data["scale_batches"].values()
    assert not b.get("pending") and b["fp"]
    out = _undo(h, conn)
    assert out["code"] == "changed_since" and mdl.map_transform("n1") is not None and mdl.world_gauge()["source_map_id"] == "n1"


@pytest.mark.parametrize("change", ["point_moved", "point_swapped", "auto_point", "wall", "zone", "piece", "opening"])
def test_undo_is_refused_once_anything_else_in_metres_changed(monkeypatch, tmp_path, disk, change):  # noqa: F811
    h, conn, mdl, ms, cal = _setup(monkeypatch, tmp_path, disk, gauge=False)
    cal.data["points"].append(dict(_CP))
    assert _save(h, conn)["ok"]
    dom, pts = h.data[DOMAIN], cal.data["points"]
    assert isinstance(dom.get(DATA_HOUSE3D), H3.House3dStore) and isinstance(dom.get(DATA_SUBZONES), SZ.SubzoneStore)
    if change == "point_moved":
        pts[-1]["x_m"] = 4.5
    elif change == "point_swapped":                                     # one deleted, one added: the count the same
        pts[-1] = {**_CP, "id": "cp_other"}
    elif change == "auto_point":                                        # recorded by a pinned beacon on its own: metres from the scale
        pts.append({**_CP, "id": "cp_auto", "map_id": "", "label": "[auto] Keys"})
    elif change == "wall":
        monkeypatch.setattr(mdl.fabric, "rf_barriers_m", lambda: [{"id": "w1", "floor_id": "main", "points_m": [[0, 0], [3, 0]]}])
    elif change == "zone":
        _run(dom[DATA_SUBZONES].async_put(None, {"name": "Bed", "floor_id": "main", "points_m": [[0, 0], [1, 0], [1, 1]]}))
    elif change == "piece":
        dom[DATA_HOUSE3D].data["pieces"]["p_new"] = {"id": "p_new", "x_m": 1.0, "y_m": 1.0}
    else:
        dom[DATA_HOUSE3D].data["openings"]["door:9"] = {"x_m": 2.0, "y_m": 0.0}
    was = _now(mdl, ms, cal)
    out = _undo(h, conn)
    assert out["ok"] is False and out["code"] == "changed_since" and "calibration points were recorded since" in out["message"]
    assert _now(mdl, ms, cal) == was and mdl.world_gauge()["source_map_id"] == "n1"


def test_the_fingerprint_is_the_same_after_a_restart_for_an_untouched_house(monkeypatch, tmp_path, disk):  # noqa: F811
    h, conn, mdl, ms, cal = _setup(monkeypatch, tmp_path, disk)
    cal.data["points"].append({**_CP, "x_m": 4, "y_m": 3.25})              # a whole number and a decimal
    _run(cal.store.async_save(cal.data))
    h3, sz = _run(H3.async_get_store(h)), _run(SZ.async_get_store(h))
    assert _run(h3.async_write({**h3.data, "pieces": {"p1": {"id": "p1", "x_m": 1, "y_m": 2.5, "z_m": 0.0}}}))
    _run(sz.async_put(None, {"name": "Bed", "floor_id": "main", "points_m": [[0, 0], [1.5, 0], [1.5, 2]]}))
    before = C._metres_fp(h, "n1")  # noqa: SLF001
    for st in (mdl, ms, cal):
        st.data = _run(st.store.async_load())
    h.data[DOMAIN].pop(DATA_HOUSE3D)
    h.data[DOMAIN].pop(DATA_SUBZONES)
    _run(C._metre_files_read(h))  # noqa: SLF001
    assert h.data[DOMAIN][DATA_HOUSE3D].data["pieces"] and h.data[DOMAIN][DATA_SUBZONES].zones()
    assert C._metres_fp(h, "n1") == before  # noqa: SLF001


def test_a_measure_landing_while_the_record_of_a_save_is_written_wins(monkeypatch, tmp_path, disk):  # noqa: F811
    h, conn, mdl, ms, cal = _setup(monkeypatch, tmp_path, disk)
    real, landed = A.PlanAiStore.async_checked_save, []

    async def measure_meanwhile(self):
        if not landed and any(b.get("pending") for b in (self.data.get("scale_batches") or {}).values()):
            landed.append(await F.async_write_measured_transform(h, "n1", copy.deepcopy(_HAND)))   # Measure takes no lock
        return await real(self)
    monkeypatch.setattr(A.PlanAiStore, "async_checked_save", measure_meanwhile)
    out = _save(h, conn)
    assert landed and out["ok"] is False and out["code"] == "already_placed"
    assert mdl.map_transform("n1")["scale_x_m"] == 10.5 and not (_store(h).data.get("scale_batches") or {})


def test_a_room_drawn_while_the_record_of_an_undo_is_written_stops_the_undo(monkeypatch, tmp_path, disk):  # noqa: F811
    h, conn, mdl, ms, cal = _setup(monkeypatch, tmp_path, disk, gauge=False)
    assert _save(h, conn)["ok"]
    real, rooms = A.PlanAiStore.async_checked_save, mdl.fabric.rooms_flat()

    async def room_meanwhile(self):
        if any(b.get("undo_of") and b.get("pending") for b in (self.data.get("scale_batches") or {}).values()):
            monkeypatch.setattr(mdl.fabric, "rooms_flat", lambda: {**rooms, "Attic": _ATTIC})
        return await real(self)
    monkeypatch.setattr(A.PlanAiStore, "async_checked_save", room_meanwhile)
    out = _undo(h, conn)
    assert out["code"] == "changed_since" and mdl.map_transform("n1") is not None and mdl.world_gauge()["source_map_id"] == "n1"
    assert not any(b.get("undo_of") for b in _store(h).data["scale_batches"].values())


def test_a_house_scale_set_by_measure_during_the_backup_is_kept_by_the_undo(monkeypatch, tmp_path, disk):  # noqa: F811
    h, conn, mdl, ms, cal = _setup(monkeypatch, tmp_path, disk, gauge=False)
    real = C._backup  # noqa: SLF001

    async def measure_meanwhile(hass, note, slot):
        bid = await real(hass, note, slot)
        if "set a plan's scale" in note:                                   # another plan measured: the house scale seeded from it
            mdl.data["world_gauge"] = {"m_per_unit": 0.02, "source_map_id": "m1"}
            await mdl.store.async_save(mdl.data)
        return bid
    monkeypatch.setattr(C, "_backup", measure_meanwhile)
    out = _save(h, conn)
    g = copy.deepcopy(mdl.data["world_gauge"])
    assert out["ok"] and out["house_scale_set"] is False and g["m_per_unit"] and g["source_map_id"] != "n1"
    b = next(iter(_store(h).data["scale_batches"].values()))
    assert b["before"]["gauge_set"] is True and b["before"]["gauge"] == g
    u = _undo(h, conn)
    assert u["ok"] is True and u["house_scale_unset"] is False and mdl.data["world_gauge"] == g and mdl.map_transform("n1") is None


def test_settling_a_cut_save_leaves_a_floor_changed_by_hand(monkeypatch, tmp_path, disk):  # noqa: F811
    h, conn, mdl, ms, cal = _setup(monkeypatch, tmp_path, disk, plan={**_N1, "floor_id": "ground"})
    _cut_save(monkeypatch, h, conn, mdl, floor_id="upper")
    ms.get_map("n1")["floor_id"] = "basement"                          # put on a floor by hand before the next command
    _call(WP.ws_plan_build_scale_preview, h, conn, map_id="n1", via="wizard")
    (b,) = _store(h).data["scale_batches"].values()
    assert not b.get("pending") and ms.get_map("n1")["floor_id"] == "basement"


@pytest.mark.parametrize("by_hand", [False, True])
def test_settling_a_cut_undo_moves_the_floor_back_only_from_where_the_save_put_it(monkeypatch, tmp_path, disk, by_hand):  # noqa: F811
    h, conn, mdl, ms, cal = _setup(monkeypatch, tmp_path, disk, plan={**_N1, "floor_id": "ground"})
    assert _save(h, conn, floor_id="upper")["ok"] and ms.get_map("n1")["floor_id"] == "upper"
    real = C._write_refile  # noqa: SLF001

    async def cut(hass, map_id, side, record=True):
        raise asyncio.CancelledError                                   # stopped after the record went, before the floor
    monkeypatch.setattr(C, "_write_refile", cut)
    with pytest.raises(asyncio.CancelledError):
        _undo(h, conn)
    monkeypatch.setattr(C, "_write_refile", real)
    _restart(h)
    if by_hand:
        ms.get_map("n1")["floor_id"] = "basement"
    _call(WP.ws_plan_build_scale_preview, h, conn, map_id="n1", via="wizard")
    assert mdl.map_transform("n1") is None and C.scale_undo_info(_store(h)) is None
    assert ms.get_map("n1")["floor_id"] == ("basement" if by_hand else "ground")


def test_a_corrupt_stored_record_never_stops_a_measure_save(monkeypatch, tmp_path, disk):  # noqa: F811
    h, conn, mdl, ms, cal = _setup(monkeypatch, tmp_path, disk)
    mdl.data["map_transforms"]["n1"] = {"scale_x_m": 3.0, "scale_y_m": 2.0, "reference_measurements": 5}
    out = _call(F.ws_fabric_map_transform_set, h, conn, map_id="n1", transform=copy.deepcopy(_HAND))
    assert out.get("ok") is True and mdl.map_transform("n1")["scale_x_m"] == 10.5
