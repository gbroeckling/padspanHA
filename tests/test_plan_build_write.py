"""Build from plans, Stage 1b (experimental): saving a line-up and undoing it.

plan_ai_write.py's line-up section, the one writer (plan-build design 3.8, 13,
14, 15): a placement through ModelStore.async_reanchor_map, a refile through
maps_store.async_update_map and ModelStore.async_set_map_floor; a backup
before each save in its own slot (the last six kept); the ledger; a save cut
short finished or put back; one undo for a session. The session is lined up
on test_plan_build.py's synthetic house, then the house is swapped for the
REAL model, maps and calibration stores holding the same data, on disk, so
every write is the real one.
"""

from __future__ import annotations

import asyncio
import copy
import inspect
import json
import re
from pathlib import Path

import pytest

from custom_components.padspan_ha import plan_ai as A
from custom_components.padspan_ha import plan_ai_write as C
from custom_components.padspan_ha import telemetry as T
from custom_components.padspan_ha import ws_plan_ai as W
from custom_components.padspan_ha.calibration_store import CalibrationStore
from custom_components.padspan_ha.const import (BACKUPS_STORE_KEY, CALIBRATION_STORE_KEY, DATA_CALIBRATION, DATA_MAPS, DATA_MODEL, DATA_PLAN_AI,
                                                DATA_SETTINGS, DOMAIN, MAPS_STORE_KEY, MODEL_STORE_KEY, PLAN_AI_STORE_KEY)
from custom_components.padspan_ha.maps_store import MapsStore
from custom_components.padspan_ha.model_store import ModelStore
from tests.test_house3d_edit import disk  # noqa: F401  (the on-disk store fixture)
from tests.test_house3d_store import _run
from tests.test_plan_build import _T_MOVING, _call, _counters, _house, _session

_ROOT = Path(__file__).resolve().parents[1] / "custom_components" / "padspan_ha"
_PKG = _ROOT
_HOUSE_KEYS = (MODEL_STORE_KEY, MAPS_STORE_KEY, CALIBRATION_STORE_KEY)
# A second scan of the basement with nothing drawn on it: a proposal that shifts nothing (group accept).
_M2 = {"id": "m2", "name": "Scan copy", "floor_id": "basement", "image": {"filename": "moving.png", "width": 900, "height": 750, "sha256": "m2"},
       "updated": "2026-11-09", "room_bounds": {}, "receivers": [], "beacons": [], "lights": [], "_t": dict(_T_MOVING)}


class _Fabric:
    """The metres the house keeps (rooms, scanners, beacons, lights): read only, as the fabric is to this writer."""

    def __init__(self, fake_model) -> None:
        self._m = fake_model

    def rooms_flat(self):
        return self._m.room_geometry_m()

    def scanner_positions_m(self):
        return self._m.scanner_positions_m()

    def beacon_positions_m(self):
        return {}

    def beacon_heights_m(self):
        return {}

    def light_positions_m(self):
        return self._m.light_positions_m()

    def light_heights_m(self):
        return {}

    def rf_barriers_m(self):
        return []


def _real(h, disk):
    """The fakes' house in the real stores, saved to disk once (as a running HA has them)."""
    dom = h.data[DOMAIN]
    fm, fmaps, fcal = dom[DATA_MODEL], dom[DATA_MAPS], dom[DATA_CALIBRATION]
    maps = copy.deepcopy(fmaps.list_maps())
    for m in maps:
        m.pop("_t", None)
        m["stack"] = {"z_level": 0, "ceiling_height_m": 2.4}
    ms = MapsStore.__new__(MapsStore)
    ms.hass, ms.data, ms.store = h, {"maps": maps}, disk(h, 1, MAPS_STORE_KEY)
    ms.image_file = fmaps.image_file
    mdl = ModelStore.__new__(ModelStore)
    mdl.hass, mdl.store = h, disk(h, 1, MODEL_STORE_KEY)
    mdl.data = {"map_transforms": {m["id"]: {**fm.map_transform(m["id"]), "floor_id": m["floor_id"], "origin_anchored": True} for m in maps},
                "floors": [{**f, "level": i} for i, f in enumerate(fm.floors())], "world_gauge": fm.world_gauge()}
    mdl.fabric = _Fabric(fm)
    cal = CalibrationStore.__new__(CalibrationStore)
    cal.hass, cal.store, cal._model = h, disk(h, 1, CALIBRATION_STORE_KEY), mdl
    cal.data = {"points": copy.deepcopy(fcal.list_points()), "model": {}}
    dom[DATA_MODEL], dom[DATA_MAPS], dom[DATA_CALIBRATION] = mdl, ms, cal
    for st in (mdl, ms, cal):
        _run(st.store.async_save(st.data))
    return mdl, ms, cal


def _ready(monkeypatch, tmp_path, disk, extra=(_M2,)):
    h, conn, ai = _house(monkeypatch, tmp_path, extra_maps=list(extra))
    store, sess = _session(h)
    h.data[DOMAIN][A._DATA_JOB] = None                                       # noqa: SLF001
    mdl, ms, cal = _real(h, disk)
    disk.writes.clear()
    return h, conn, store, mdl, ms, cal


def _house_now(mdl, ms, cal) -> dict:
    return copy.deepcopy({"t": mdl.data["map_transforms"], "maps": ms.data["maps"], "points": cal.data["points"], "gauge": mdl.data["world_gauge"]})


def _rev(h) -> int:
    return h.data[DOMAIN][DATA_PLAN_AI].lineup("pb_t")["rev"]


def _commit(h, conn, items, group=False):
    return _call(W.ws_plan_build_commit, h, conn, session="pb_t", rev=_rev(h), items=items, group=group)


def _undo(h, conn):
    return _call(W.ws_plan_build_undo, h, conn, session="pb_t")


def _backups(tmp_path) -> list[dict]:
    f = tmp_path / ".storage" / BACKUPS_STORE_KEY
    return json.loads(f.read_text(encoding="utf-8"))["data"]["backups"] if f.is_file() else []


def _metres(cal) -> list:
    return [(p["id"], p["x_m"], p["y_m"], p["floor_id"], p["room"], p["map_id"]) for p in cal.data["points"]]


def _stops(h) -> list[str]:
    return [s["reason"] for s in h.data[DOMAIN][DATA_PLAN_AI].lineup("pb_t").get("stops") or []]


# ═══ save and undo, round trip ═══════════════════════════════════════════════

def test_a_placement_saved_then_undone_comes_back_exactly(monkeypatch, tmp_path, disk):
    h, conn, store, mdl, ms, cal = _ready(monkeypatch, tmp_path, disk)
    was = _house_now(mdl, ms, cal)
    metres, rooms = _metres(cal), copy.deepcopy(mdl.fabric.rooms_flat())
    prop = store.lineup("pb_t")["items"]["place_m1"]["proposal"]
    out = _commit(h, conn, ["place_m1"])
    assert out["ok"] is True and out["items"]["place_m1"]["state"] == "committed" and out["backup_id"]
    t = mdl.data["map_transforms"]["m1"]
    assert {k: t[k] for k in prop} == prop and t["origin_anchored"] is True and t["floor_id"] == "basement"
    # Reanchor's re-derivations: the calibration pin and the scanner pin moved on the picture; their metres didn't.
    assert _metres(cal) == metres and mdl.fabric.rooms_flat() == rooms
    assert cal.data["points"][0]["x_frac"] != was["points"][0]["x_frac"]
    assert ms.get_map("m1")["receivers"][0]["x"] != was["maps"][1]["receivers"][0]["x"]
    assert ms.get_map("m1")["room_bounds"] == was["maps"][1]["room_bounds"]                  # a traced room is never redrawn
    assert mdl.data["world_gauge"] == was["gauge"] and mdl.data["map_transforms"]["a1"] == was["t"]["a1"]
    assert set(disk.writes) <= {*_HOUSE_KEYS, PLAN_AI_STORE_KEY, BACKUPS_STORE_KEY, "padspan_ha.telemetry_counters"}
    assert out["undo"]["session"] == "pb_t" and out["undo"]["items"] == 1

    out = _undo(h, conn)
    assert out["ok"] is True and out["undone"] == 1 and out["skipped"] == [] and out["items"]["place_m1"]["state"] == "undone"
    now = _house_now(mdl, ms, cal)
    assert now["t"] == was["t"]                                                             # every placement, bit for bit
    assert now["maps"] == was["maps"]                                                       # the scanner pins put back exactly
    assert _metres(cal) == metres
    for p, q in zip(now["points"], was["points"]):                                          # calibration pins re-derived, not copied
        assert p["x_frac"] == pytest.approx(q["x_frac"], abs=1e-4) and p["y_frac"] == pytest.approx(q["y_frac"], abs=1e-4)
    assert A.lineup_undo_info(store) is None
    # Applied again: an undone item is good again where the plan is as it was read.
    out = _commit(h, conn, ["place_m1"])
    assert out["ok"] is True and {k: mdl.data["map_transforms"]["m1"][k] for k in prop} == prop
    c = _counters(h)
    assert c["plan_build_commit:done"] == 2 and c["plan_build_item:place_accepted"] == 2 and c["plan_build_undo:session"] == 1
    assert c["plan_build_item:place_undone"] == 1 and c["plan_build_preflight:checked"] == 2


def test_a_group_saves_only_what_shifts_nothing_and_a_refile_keeps_the_record(monkeypatch, tmp_path, disk):
    h, conn, store, mdl, ms, cal = _ready(monkeypatch, tmp_path, disk)
    was = _house_now(mdl, ms, cal)
    out = _commit(h, conn, ["place_m2", "place_m1"], group=True)
    assert out["ok"] is False and out["code"] == "group_refused" and out["items"] == ["place_m1"]
    assert _house_now(mdl, ms, cal) == was and _stops(h)[-1] == "group_refused"
    out = _commit(h, conn, ["place_m2", "refile_r1"], group=True)
    assert out["ok"] is True
    r1 = mdl.data["map_transforms"]["r1"]
    assert ms.get_map("r1")["floor_id"] == "upper" and r1["floor_id"] == "upper" and r1["origin_anchored"] is True
    assert A.placement_of(r1) == A.placement_of(was["t"]["r1"])                            # the placement stays: one footprint
    c = _counters(h)
    assert c["plan_build_item:place_accepted_group"] == 1 and c["plan_build_item:refile_accepted_group"] == 1 and c["plan_build_refile:accepted"] == 1
    assert c["plan_build_stop:group_refused"] == 1 and c["plan_build_commit:group_refused"] == 1
    out = _undo(h, conn)
    assert out["undone"] == 2
    now = _house_now(mdl, ms, cal)
    assert now["t"] == was["t"] and ms.get_map("r1")["floor_id"] == "basement"
    assert {k: v for k, v in ms.get_map("r1").items() if k != "updated"} == {k: v for k, v in was["maps"][2].items() if k != "updated"}


# An Upper plan already stacked where the readers put Upper (his Electrical-2 and -4: z_level 2).
_U1 = {"id": "u1", "name": "Electrical-2", "floor_id": "upper", "image": {"filename": "other.png", "width": 640, "height": 480, "sha256": "u1"},
       "updated": "2026-11-09", "room_bounds": {}, "receivers": [], "beacons": [], "lights": [], "_t": dict(_T_MOVING)}


def _storeys(ms, mdl) -> dict:
    """What the panel's level readers make of the maps: traceback.js:104-133
    (sorted by z_level, a floor's first map sets its Z), radio_map.js:803 and
    maps.js:7548/7723 (a floor's or level's first map gives its level and
    height), calibration.js:5732 (the floor named from a map's level)."""
    maps = sorted(ms.list_maps(), key=lambda m: (m.get("stack") or {}).get("z_level") or 0)
    floor_z, levels_of, height_at = {}, {}, {}
    for m in maps:
        stk = m.get("stack") or {}
        fid = str(stk.get("floor_id") or m.get("floor_id"))
        floor_z.setdefault(fid, stk.get("z_level") or 0)
        levels_of.setdefault(m["floor_id"], set()).add(stk.get("z_level") or 0)
        height_at.setdefault(stk.get("z_level") or 0, set()).add(stk.get("ceiling_height_m"))
    named = {m["id"]: next((f["id"] for f in mdl.data["floors"] if f.get("level") == ((m.get("stack") or {}).get("z_level") or 0)), None) for m in maps}
    return {"floor_z": floor_z, "levels_of": levels_of, "height_at": height_at, "named": named,
            "t_floor": {m["id"]: (mdl.data["map_transforms"].get(m["id"]) or {}).get("floor_id") for m in maps}}


@pytest.mark.parametrize("upper_has_plans", [True, False])
def test_a_refile_moves_the_plan_to_its_new_storey_in_every_reader_and_undo_brings_it_back(monkeypatch, tmp_path, disk, upper_has_plans):
    """Review M2, his "Screenshot 2026-03-16": filed on Basement at stack
    level 0, it shows Upper (level 2). The refile writes the floor, the
    stack's floor, level and height in one update, so every reader puts it
    on Upper's slab; the undo puts them all back."""
    h, conn, store, mdl, ms, cal = _ready(monkeypatch, tmp_path, disk, extra=(_M2, _U1) if upper_has_plans else (_M2,))
    ms.get_map("r1")["stack"] = {"z_level": 0, "ceiling_height_m": 2.4, "floor_id": "basement"}
    if upper_has_plans:
        ms.get_map("u1")["stack"] = {"z_level": 2, "ceiling_height_m": 2.7}
    _run(ms.store.async_save(ms.data))
    assert next(f["level"] for f in mdl.data["floors"] if f["id"] == "upper") == 2
    was, before = _house_now(mdl, ms, cal), _storeys(ms, mdl)
    assert before["named"]["r1"] == "basement"
    out = _commit(h, conn, ["refile_r1"])
    assert out["ok"] is True
    stk = ms.get_map("r1")["stack"]
    assert stk == {"z_level": 2, "ceiling_height_m": 2.7 if upper_has_plans else 2.4, "floor_id": "upper"}
    now = _storeys(ms, mdl)
    assert now["floor_z"]["upper"] == 2 and now["levels_of"]["upper"] == {2} and now["named"]["r1"] == "upper"
    assert now["t_floor"]["r1"] == "upper" and len(now["height_at"][2]) == 1                  # one height for Upper's slab
    assert now["levels_of"]["basement"] == {0} and now["floor_z"]["basement"] == 0             # the basement's own storey untouched
    out = _undo(h, conn)
    assert out["ok"] is True and out["undone"] == 1
    assert _storeys(ms, mdl) == before
    assert {k: v for k, v in ms.get_map("r1").items() if k != "updated"} == {k: v for k, v in was["maps"][2].items() if k != "updated"}
    assert _house_now(mdl, ms, cal)["t"] == was["t"]


def test_a_refile_undone_can_be_accepted_again_and_undone_again(monkeypatch, tmp_path, disk):
    """A refile writes the map record, which moves its `updated`; the
    picture's signature must not move with it, or the undone refile reads as
    a new picture and can't be accepted again."""
    h, conn, store, mdl, ms, cal = _ready(monkeypatch, tmp_path, disk)
    was = _house_now(mdl, ms, cal)
    for _ in range(2):
        out = _commit(h, conn, ["refile_r1"])
        assert out["ok"] is True, out
        assert ms.get_map("r1")["floor_id"] == "upper" and mdl.data["map_transforms"]["r1"]["floor_id"] == "upper"
        out = _undo(h, conn)
        assert out["ok"] is True and out["undone"] == 1 and out["items"]["refile_r1"]["state"] == "undone"
        assert ms.get_map("r1")["floor_id"] == "basement" and _house_now(mdl, ms, cal)["t"] == was["t"]
    assert _counters(h)["plan_build_refile:accepted"] == 2 and _counters(h)["plan_build_refile:undone"] == 2


def test_a_refile_to_a_floor_removed_since_is_refused_by_name(monkeypatch, tmp_path, disk):
    """Review S5: Upper deleted in Home Assistant after the proposal."""
    h, conn, store, mdl, ms, cal = _ready(monkeypatch, tmp_path, disk)
    mdl.data["floors"] = [f for f in mdl.data["floors"] if f["id"] != "upper"]
    was = _house_now(mdl, ms, cal)
    out = _commit(h, conn, ["refile_r1"])
    _refused(h, conn, mdl, ms, cal, disk, out, "floor_gone", "floor_gone")
    assert out["changed"] == [{"item_id": "refile_r1", "why": "floor_gone"}]
    assert ms.get_map("r1")["floor_id"] == "basement" and _house_now(mdl, ms, cal) == was and _backups(tmp_path) == []
    st = _call(W.ws_plan_build_status, h, conn, session="pb_t")["session"]
    assert st["items"]["refile_r1"]["state"] == "stale"


def test_a_refile_cut_between_its_two_writes_settles_with_both_floor_records_agreeing(monkeypatch, tmp_path, disk):
    """Review S6: the restart fell after the maps record and before the
    placement record's floor (presence_coordinator.py reads that one)."""
    h, conn, store, mdl, ms, cal = _ready(monkeypatch, tmp_path, disk)
    real = mdl.async_set_map_floor

    async def cut(map_id, floor_id):
        raise asyncio.CancelledError
    monkeypatch.setattr(mdl, "async_set_map_floor", cut)
    with pytest.raises(asyncio.CancelledError):
        _run(C.lineup_commit(h, store, "pb_t", _rev(h), ["refile_r1"], False))
    monkeypatch.setattr(mdl, "async_set_map_floor", real)
    assert ms.get_map("r1")["floor_id"] == "upper" and mdl.data["map_transforms"]["r1"]["floor_id"] == "basement"
    _restart(h)
    st = _call(W.ws_plan_build_status, h, conn, session="pb_t")["session"]
    assert st["items"]["refile_r1"]["state"] == "committed"
    assert ms.get_map("r1")["floor_id"] == "upper" and mdl.data["map_transforms"]["r1"]["floor_id"] == "upper"
    assert ms.get_map("r1")["stack"]["z_level"] == 2
    assert _undo(h, conn)["undone"] == 1
    assert ms.get_map("r1")["floor_id"] == "basement" and mdl.data["map_transforms"]["r1"]["floor_id"] == "basement"


def test_undo_takes_every_save_of_the_session_back_and_leaves_a_plan_moved_since(monkeypatch, tmp_path, disk):
    h, conn, store, mdl, ms, cal = _ready(monkeypatch, tmp_path, disk)
    was = _house_now(mdl, ms, cal)
    assert _commit(h, conn, ["place_m1"])["ok"] and _commit(h, conn, ["place_m2", "refile_r1"], group=True)["ok"]
    assert A.lineup_undo_info(store)["saves"] == 2
    _run(mdl.async_reanchor_map("m2", ms.get_map("m2"), cal, origin_x_m=0.7))             # moved by hand in Mapping since
    moved = copy.deepcopy(mdl.data["map_transforms"]["m2"])
    out = _undo(h, conn)
    assert out["undone"] == 2 and [s["item_id"] for s in out["skipped"]] == ["place_m2"]
    assert mdl.data["map_transforms"]["m2"] == moved                                       # left as the person put it
    assert mdl.data["map_transforms"]["m1"] == was["t"]["m1"] and ms.get_map("r1")["floor_id"] == "basement"
    assert _counters(h)["plan_build_undo:item_skipped"] == 1
    assert _undo(h, conn)["error"] == "nothing_to_undo"


# ═══ refusals: nothing written, each stop named and counted ═════════════════

def _refused(h, conn, mdl, ms, cal, disk, out, code, stop=None):
    assert out.get("code", out.get("error")) == code, out
    assert "experimental" in out["message"]
    if stop:
        assert _stops(h)[-1] == stop and _counters(h)[f"plan_build_stop:{stop}"] >= 1 and A.STOPS[stop][0]
    assert not set(disk.writes) & set(_HOUSE_KEYS), disk.writes                             # the house wasn't written


def test_the_measured_plan_is_never_saved_or_refiled(monkeypatch, tmp_path, disk):
    h, conn, store, mdl, ms, cal = _ready(monkeypatch, tmp_path, disk)
    sess = store.lineup("pb_t")
    sess["items"]["place_g1"] = {**copy.deepcopy(sess["items"]["place_m2"]), "map_id": "g1"}   # a forged item on the measured plan
    out = _commit(h, conn, ["place_g1"])
    _refused(h, conn, mdl, ms, cal, disk, out, "measured_plan_protected", "measured_plan_protected")
    monkeypatch.setattr(A, "house_snapshot", lambda hass, _f=A.house_snapshot: {**_f(hass), "gauge_map": "a1"})
    out = _call(W.ws_plan_build_refile, h, conn, session="pb_t", rev=_rev(h), map_id="a1", to_floor_id="upper")
    assert out["ok"] is False and out["code"] == "measured_plan_protected"
    _refused(h, conn, mdl, ms, cal, disk, out, "measured_plan_protected", "measured_plan_protected")


def test_the_calibration_preflight_blocks_a_save_and_writes_nothing(monkeypatch, tmp_path, disk):
    h, conn, store, mdl, ms, cal = _ready(monkeypatch, tmp_path, disk)
    it = store.lineup("pb_t")["items"]["place_m1"]
    it["proposal"] = {**it["proposal"], "origin_x_m": it["proposal"]["origin_x_m"] + 40.0}    # its calibration pin would fall off the picture
    it["flags"] = A.effects(A.house_snapshot(h), "m1", it["proposal"])[0]
    was = _house_now(mdl, ms, cal)
    out = _commit(h, conn, ["place_m1"])
    _refused(h, conn, mdl, ms, cal, disk, out, "points_out_of_range", "preflight_blocked")
    assert _house_now(mdl, ms, cal) == was and _backups(tmp_path) == []                       # checked before the backup
    c = _counters(h)
    assert c["plan_build_preflight:blocked"] == 1 and c["plan_build_commit:points_out_of_range"] == 1
    assert store.lineup("pb_t")["items"]["place_m1"]["refused"]["why"] == "points_out_of_range"


def test_a_refile_of_a_plan_with_things_on_it_is_refused_by_hand_and_at_save(monkeypatch, tmp_path, disk):
    h, conn, store, mdl, ms, cal = _ready(monkeypatch, tmp_path, disk)
    was = _house_now(mdl, ms, cal)
    out = _call(W.ws_plan_build_refile, h, conn, session="pb_t", rev=_rev(h), map_id="m1", to_floor_id="upper")
    assert out["ok"] is False and out["code"] == "refile_refused" and out["item"]["state"] == "refused" and out["item"]["drawn"]["rooms"] == 1
    _refused(h, conn, mdl, ms, cal, disk, out, "refile_refused", "refile_refused")
    out = _call(W.ws_plan_build_refile, h, conn, session="pb_t", rev=_rev(h), map_id="m2", to_floor_id="upper")
    assert out["ok"] is True and out["item"]["state"] == "open" and out["item"]["by_hand"] is True
    assert _call(W.ws_plan_build_refile, h, conn, session="pb_t", rev=_rev(h), map_id="m2", to_floor_id="basement")["error"] == "invalid"
    assert _call(W.ws_plan_build_refile, h, conn, session="pb_t", rev=_rev(h), map_id="m2", to_floor_id="__outside__")["error"] == "invalid"
    # Something drawn on the empty plan since: the save refuses it.
    ms.get_map("r1")["receivers"] = [{"source": "CC:DD", "x": 0.5, "y": 0.5, "label": "new"}]
    disk.writes.clear()
    out = _commit(h, conn, ["refile_r1"])
    _refused(h, conn, mdl, ms, cal, disk, out, "refile_refused", "refile_refused")
    assert ms.get_map("r1")["floor_id"] == "basement" and mdl.data["map_transforms"] == was["t"]
    assert _counters(h)["plan_build_refile:by_hand"] == 2


def test_a_plan_changed_since_is_stale_and_nothing_is_saved(monkeypatch, tmp_path, disk):
    h, conn, store, mdl, ms, cal = _ready(monkeypatch, tmp_path, disk)
    _run(mdl.async_reanchor_map("m1", ms.get_map("m1"), cal, origin_x_m=1.2))              # the Align editor moved it meanwhile
    disk.writes.clear()
    was = _house_now(mdl, ms, cal)
    out = _commit(h, conn, ["place_m1"])
    _refused(h, conn, mdl, ms, cal, disk, out, "changed_since")
    assert out["changed"] == [{"item_id": "place_m1", "why": "moved"}] and store.lineup("pb_t")["items"]["place_m1"]["state"] == "stale"
    assert _house_now(mdl, ms, cal) == was
    st = _call(W.ws_plan_build_status, h, conn, session="pb_t")["session"]
    assert st["items"]["place_m1"]["state"] == "stale" and st["items"]["place_m2"]["state"] == "open"


def test_an_align_save_during_the_backup_is_never_written_over(monkeypatch, tmp_path, disk):
    """Review M1: the person's own Align save lands while the line-up's backup
    is written (the event loop is free there). The save is refused, named, and
    the hand placement stands."""
    h, conn, store, mdl, ms, cal = _ready(monkeypatch, tmp_path, disk)
    real, hand = C._backup, {}                                                                # noqa: SLF001

    async def slow_backup(hass, note):
        bid = await real(hass, note)
        t = dict(mdl.data["map_transforms"]["m1"])                                            # ws_fabric_map_reanchor's writer, no plan-store lock
        res = await mdl.async_reanchor_map("m1", ms.get_map("m1"), cal, origin_x_m=t["origin_x_m"] + 0.5, origin_y_m=t["origin_y_m"],
                                           rotation_rad=t.get("rotation_rad", 0.0), scale_x_m=t["scale_x_m"], scale_y_m=t["scale_y_m"])
        hand.update(ok=res.get("ok"), t=A.placement_of(mdl.data["map_transforms"]["m1"]))
        return bid
    monkeypatch.setattr(C, "_backup", slow_backup)
    out = _commit(h, conn, ["place_m1"])
    assert hand["ok"] is True
    assert out["ok"] is False and out["code"] == "changed_since" and out["changed"] == [{"item_id": "place_m1", "why": "moved"}]
    assert "experimental" in out["message"] and A.STOPS["changed_while_saving"][0] in out["message"]
    assert A.placement_of(mdl.data["map_transforms"]["m1"]) == hand["t"]                      # the hand save stands
    assert _stops(h)[-1] == "changed_while_saving" and _counters(h)["plan_build_stop:changed_while_saving"] == 1
    assert store.data["lineup_batches"] == {} and store.lineup("pb_t")["items"]["place_m1"]["state"] == "stale"


@pytest.mark.parametrize("hand_moves", ["second", "first_after_write"])
def test_a_hand_change_between_two_writes_is_never_written_over(monkeypatch, tmp_path, disk, hand_moves):
    """Review M1, the gaps after the ledger: a plan changed by hand before its
    own write is not written; a plan written and then changed by hand isn't
    put back over the change."""
    h, conn, store, mdl, ms, cal = _ready(monkeypatch, tmp_path, disk)
    was = _house_now(mdl, ms, cal)
    real = C._write_place                                                                     # noqa: SLF001

    async def then_by_hand(hass, map_id, to_t, pins=None):
        got = await real(hass, map_id, to_t, pins)
        if map_id == "m2" and not pins:
            if hand_moves == "second":                                                        # 3D Stack files r1 on Main meanwhile
                await ms.async_update_map("r1", floor_id="main")
            else:                                                                             # Align moves m2 again, and r1 changes too
                await mdl.async_reanchor_map("m2", ms.get_map("m2"), cal, origin_x_m=3.3)
                await ms.async_update_map("r1", floor_id="main")
        return got
    monkeypatch.setattr(C, "_write_place", then_by_hand)
    out = _commit(h, conn, ["place_m2", "refile_r1"], group=True)
    assert out["ok"] is False and out["code"] == "changed_since" and _stops(h)[-1] == "changed_while_saving"
    assert ms.get_map("r1")["floor_id"] == "main" and mdl.data["map_transforms"]["r1"]["floor_id"] == "basement"   # r1 not refiled over it
    if hand_moves == "second":
        assert mdl.data["map_transforms"]["m2"] == was["t"]["m2"]                             # m2 put back: still as the save left it
    else:
        assert mdl.data["map_transforms"]["m2"]["origin_x_m"] == 3.3                          # the hand move stands
    assert all(not b.get("pending") for b in store.data["lineup_batches"].values())


def test_no_backup_no_save_and_no_undo(monkeypatch, tmp_path, disk):
    h, conn, store, mdl, ms, cal = _ready(monkeypatch, tmp_path, disk)
    was = _house_now(mdl, ms, cal)
    disk.fail = ["swallowed"]                                       # the backup list's write is lost, as HA's Store loses one
    out = _commit(h, conn, ["place_m2"])
    _refused(h, conn, mdl, ms, cal, disk, out, "backup_failed", "backup_failed")
    assert _house_now(mdl, ms, cal) == was and _counters(h)["plan_build_commit:backup_failed"] == 1
    assert _commit(h, conn, ["place_m2"])["ok"] is True
    disk.writes.clear()
    disk.fail = ["swallowed"]
    saved = _house_now(mdl, ms, cal)
    out = _undo(h, conn)
    _refused(h, conn, mdl, ms, cal, disk, out, "backup_failed", "backup_failed")
    assert _house_now(mdl, ms, cal) == saved and _counters(h)["plan_build_undo:failed"] == 1


def test_a_backup_before_each_save_and_undo_in_its_own_slot_the_last_six_kept(monkeypatch, tmp_path, disk):
    h, conn, store, mdl, ms, cal = _ready(monkeypatch, tmp_path, disk)
    from custom_components.padspan_ha.ws_backup import _auto_backup
    other = _run(_auto_backup(h, "Before something else", [MODEL_STORE_KEY]))               # another operation's net, in the shared cap
    for _ in range(4):
        assert _commit(h, conn, ["place_m2"])["ok"] and _undo(h, conn)["ok"]
    mine = [b for b in _backups(tmp_path) if b.get("slot") == C.LINEUP_SLOT]
    assert len(mine) == A.S1_BACKUPS_KEPT == 6 and all(b["note"].startswith(("Before plan line-up (experimental): Basement",
                                                                             "Before undoing a plan line-up (experimental): Basement")) for b in mine)
    assert any(b["id"] == other for b in _backups(tmp_path))                                 # never pushes out another's
    assert set(mine[-1]["stores"]) == set(_HOUSE_KEYS) and mine[-1]["map_images"] == {}
    # Each holds the house as it was just before: the last one, before the last undo, has the plan where the save put it.
    prop = store.lineup("pb_t")["items"]["place_m2"]["proposal"]
    last = mine[-1]["stores"][MODEL_STORE_KEY]["map_transforms"]["m2"]
    assert mine[-1]["note"].startswith("Before undoing") and {k: last[k] for k in prop} == prop
    assert mine[-2]["stores"][MODEL_STORE_KEY]["map_transforms"]["m2"] == mdl.data["map_transforms"]["m2"]


# ═══ a write that fails; a restart in the middle ═════════════════════════════

def test_a_write_that_fails_puts_back_the_plans_already_written(monkeypatch, tmp_path, disk):
    h, conn, store, mdl, ms, cal = _ready(monkeypatch, tmp_path, disk)
    was = _house_now(mdl, ms, cal)
    real = C._write_refile                                                                    # noqa: SLF001

    async def broken(hass, map_id, side):
        raise OSError(28, "No space left on device")
    monkeypatch.setattr(C, "_write_refile", broken)
    out = _commit(h, conn, ["place_m2", "refile_r1"], group=True)
    assert out["ok"] is False and out["code"] == "save_failed" and "nothing was changed" in out["message"]
    now = _house_now(mdl, ms, cal)
    assert now["t"] == was["t"] and now["maps"] == was["maps"]
    assert store.data["lineup_batches"] == {} and store.lineup("pb_t")["items"]["place_m2"]["state"] == "open"
    c = _counters(h)
    assert c["plan_build_commit:rolled_back"] == 1 and c["plan_build_commit:save_failed"] == 1
    monkeypatch.setattr(C, "_write_refile", real)
    assert _commit(h, conn, ["place_m2", "refile_r1"], group=True)["ok"] is True


def _restart(h):
    """Home Assistant restarted: the plan store is read again from its file."""
    h.data[DOMAIN].pop(DATA_PLAN_AI, None)


@pytest.mark.parametrize("cut", ["after_first_write", "after_every_write"])
def test_a_restart_in_the_middle_of_a_save_finishes_it_or_takes_it_back(monkeypatch, tmp_path, disk, cut):
    h, conn, store, mdl, ms, cal = _ready(monkeypatch, tmp_path, disk)
    was = _house_now(mdl, ms, cal)
    prop = store.lineup("pb_t")["items"]["place_m2"]["proposal"]
    real, n = C._write_side, {"n": 0}                                                          # noqa: SLF001

    async def cut_short(hass, e, side, pins=None, from_side=None):
        got = await real(hass, e, side, pins, from_side)
        n["n"] += 1
        if cut == "after_first_write" or n["n"] == 2:
            raise asyncio.CancelledError                                                      # Home Assistant stopping: nothing after this runs
        return got
    monkeypatch.setattr(C, "_write_side", cut_short)
    with pytest.raises(asyncio.CancelledError):
        _run(C.lineup_commit(h, store, "pb_t", _rev(h), ["place_m2", "refile_r1"], True))
    on_disk = json.loads((tmp_path / ".storage" / PLAN_AI_STORE_KEY).read_text(encoding="utf-8"))["data"]
    assert [b.get("pending") is not None for b in on_disk["lineup_batches"].values()] == [True]
    monkeypatch.setattr(C, "_write_side", real)
    _restart(h)
    st = _call(W.ws_plan_build_status, h, conn, session="pb_t")["session"]                    # the first command settles it
    store = h.data[DOMAIN][DATA_PLAN_AI]
    batches = store.data["lineup_batches"]
    if cut == "after_first_write":                                                            # m2 written, r1 not: m2 put back, no batch
        assert batches == {} and _house_now(mdl, ms, cal)["t"] == was["t"] and ms.get_map("r1")["floor_id"] == "basement"
        assert ms.get_map("m2")["receivers"] == was["maps"][4]["receivers"]
        assert st["items"]["place_m2"]["state"] == "open" and _counters(h)["plan_build_settled:put_back"] == 1
    else:                                                                                     # both written: the batch stands
        assert len(batches) == 1 and not next(iter(batches.values())).get("pending")
        assert {k: mdl.data["map_transforms"]["m2"][k] for k in prop} == prop and ms.get_map("r1")["floor_id"] == "upper"
        assert st["items"]["place_m2"]["state"] == "committed" and st["items"]["refile_r1"]["state"] == "committed"
        assert _counters(h)["plan_build_settled:finished"] == 1
        assert _undo(h, conn)["undone"] == 2 and _house_now(mdl, ms, cal)["t"] == was["t"]


@pytest.mark.parametrize("what", ["save", "undo"])
def test_a_cut_short_batch_that_cannot_be_put_back_is_settled_once_and_said(monkeypatch, tmp_path, disk, what):
    """Review S7: the put-back after a restart is refused (the reanchor's
    preflight, say). Settled once: what couldn't be put back stands, the
    session says so, Undo still takes it back; no retry on every command."""
    h, conn, store, mdl, ms, cal = _ready(monkeypatch, tmp_path, disk)
    was = _house_now(mdl, ms, cal)
    if what == "undo":
        assert _commit(h, conn, ["place_m2", "refile_r1"], group=True)["ok"]
    real, n = C._write_side, {"n": 0}                                                          # noqa: SLF001

    async def cut_short(hass, e, side, pins=None, from_side=None):
        got = await real(hass, e, side, pins, from_side)
        raise asyncio.CancelledError                                                          # after the first write
    monkeypatch.setattr(C, "_write_side", cut_short)
    with pytest.raises(asyncio.CancelledError):
        _run(C.lineup_commit(h, store, "pb_t", _rev(h), ["place_m2", "refile_r1"], True) if what == "save" else C.lineup_undo(h, store, "pb_t"))
    monkeypatch.setattr(C, "_write_side", real)
    tries = {"n": 0}
    kind = "_write_place" if what == "save" else "_write_refile"
    stuck = getattr(C, kind)

    async def refused(*a, **k):
        tries["n"] += 1
        return "points_out_of_range"
    monkeypatch.setattr(C, kind, refused)
    _restart(h)
    for _ in range(3):                                                                        # every command after: settled the first time only
        st = _call(W.ws_plan_build_status, h, conn, session="pb_t")["session"]
    store = h.data[DOMAIN][DATA_PLAN_AI]
    assert tries["n"] == 1 and all(not b.get("pending") for b in store.data["lineup_batches"].values())
    stop = st["stops"][-1]
    assert stop["reason"] == f"{what}_stands" and stop["say"] and "Undo this line-up session" in stop["next"]
    assert _counters(h)["plan_build_settled:stood"] == 1 and _counters(h)[f"plan_build_stop:{what}_stands"] == 1
    if what == "save":                                                                        # m2 written, couldn't be put back: it stands, saved
        assert st["items"]["place_m2"]["state"] == "committed" and st["items"]["refile_r1"]["state"] == "open"
        assert A.lineup_undo_info(store)["items"] == 1
    else:                                                                                     # r1 undone, couldn't be redone: m2 still to undo
        (ub,) = [b for b in store.data["lineup_batches"].values() if b.get("undo_of")]
        (sb,) = [b for b in store.data["lineup_batches"].values() if not b.get("undo_of")]
        assert ub["stood"] and [e["item_id"] for e in ub["items"]] == ["refile_r1"] and [e["item_id"] for e in sb["items"]] == ["place_m2"]
        assert st["items"]["place_m2"]["state"] == "committed" and not sb.get("undone_at")
        assert ms.get_map("r1")["floor_id"] == "basement" and A.lineup_undo_info(store)["items"] == 1
    monkeypatch.setattr(C, kind, stuck)
    assert _undo(h, conn)["undone"] == 1
    assert _house_now(mdl, ms, cal)["t"] == was["t"] and ms.get_map("r1")["floor_id"] == "basement" and A.lineup_undo_info(store) is None


def test_the_anchors_scale_is_refused_while_a_plan_saved_lined_up_to_it_stands(monkeypatch, tmp_path, disk):
    """Review S4: the Furnace placement saved first, then the anchor's own
    scale accepted: it would leave the saved plan off its drawing."""
    h, conn, store, mdl, ms, cal = _ready(monkeypatch, tmp_path, disk)
    items = store.lineup("pb_t")["items"]
    items["anchor_a1"]["state"] = "not_now"                                                   # as a 3 % error or more leaves it (form q7)
    assert items["anchor_a1"]["state"] == "not_now" and items["place_m1"]["evidence"]["anchor"] == "a1"
    assert _commit(h, conn, ["place_m1"])["ok"] is True
    saved = _house_now(mdl, ms, cal)
    disk.writes.clear()
    out = _commit(h, conn, ["anchor_a1"])
    _refused(h, conn, mdl, ms, cal, disk, out, "anchor_after_fit", "anchor_after_fit")
    assert out["message"].startswith("Line up plans (experimental): Scan is saved lined up to this plan as it is.")
    assert _house_now(mdl, ms, cal) == saved and _counters(h)["plan_build_commit:anchor_after_fit"] == 1
    assert _undo(h, conn)["ok"] is True                                                       # the plans lined up to it taken back: then it may
    assert _commit(h, conn, ["anchor_a1"])["ok"] is True


def test_an_undo_that_fails_changes_nothing_and_says_so(monkeypatch, tmp_path, disk):
    h, conn, store, mdl, ms, cal = _ready(monkeypatch, tmp_path, disk)
    assert _commit(h, conn, ["place_m2", "refile_r1"], group=True)["ok"]
    saved = _house_now(mdl, ms, cal)
    real = C._write_refile                                                                    # noqa: SLF001

    async def broken(hass, map_id, side):
        return "error"
    monkeypatch.setattr(C, "_write_refile", broken)
    disk.writes.clear()
    out = _undo(h, conn)
    assert out["ok"] is False and out["code"] == "undo_failed"
    assert _stops(h)[-1] == "undo_failed" and _counters(h)["plan_build_stop:undo_failed"] == 1 and _counters(h)["plan_build_undo:failed"] == 1
    now = _house_now(mdl, ms, cal)
    assert now["t"] == saved["t"] and ms.get_map("r1")["floor_id"] == "upper"                # what the undo wrote first was put back
    assert A.lineup_undo_info(store)["items"] == 2                                            # and the session can still be undone
    monkeypatch.setattr(C, "_write_refile", real)
    assert _undo(h, conn)["undone"] == 2


# ═══ who may: undo stays reachable when the AI stops qualifying ══════════════

def test_undo_and_info_answer_while_locked_and_saving_does_not(monkeypatch, tmp_path, disk):
    h, conn, store, mdl, ms, cal = _ready(monkeypatch, tmp_path, disk)
    was = _house_now(mdl, ms, cal)
    assert _commit(h, conn, ["place_m2"])["ok"]
    monkeypatch.setattr(A, "model_sources", lambda hass, eid: ["Claude Sonnet 5.5"])         # another model picked since
    h.data[DOMAIN][DATA_SETTINGS].data["ai_plan_build_enabled"] = False
    info = _call(W.ws_plan_build_info, h, conn)
    assert info["on"] is False and info["unlock"]["ok"] is False
    assert info["undo"]["session"] == "pb_t" and info["undo"]["items"] == 1 and info["undo"]["floor_name"] == "Basement"
    assert _commit(h, conn, ["place_m1"])["error"] == W.BUILD_OFF_CODE
    h.data[DOMAIN][DATA_SETTINGS].data["ai_plan_build_enabled"] = True
    assert _commit(h, conn, ["place_m1"])["error"] == W.LOCKED_CODE
    h.data[DOMAIN][DATA_SETTINGS].data["atlas_3d_enabled"] = False                            # Live Aboard off too
    out = _undo(h, conn)
    assert out["ok"] is True and _house_now(mdl, ms, cal)["t"] == was["t"]
    assert _call(W.ws_plan_build_info, h, conn)["undo"] is None
    h.data[DOMAIN][DATA_SETTINGS].data["ai_plans_enabled"] = False                            # under the master switch, as the row is
    assert _undo(h, conn)["error"] == "ai_plans_off"


def test_a_saved_item_takes_no_verdict_and_one_by_one_means_one(monkeypatch, tmp_path, disk):
    h, conn, store, mdl, ms, cal = _ready(monkeypatch, tmp_path, disk)
    assert _commit(h, conn, ["place_m1", "place_m2"])["error"] == "invalid"                    # one by one unless a group
    assert _commit(h, conn, ["place_m2"])["ok"]
    out = _call(W.ws_plan_build_verdict, h, conn, session="pb_t", rev=_rev(h), item_id="place_m2", v="back")
    assert out["error"] == "not_open"
    assert _commit(h, conn, ["place_m2"])["code"] == "not_open"
    assert _commit(h, conn, ["anchor_a1"])["code"] == "not_open"                              # under 3 %: information only


# ═══ the one writer ══════════════════════════════════════════════════════════

def _line_up_calls() -> tuple[dict[str, int], list[str], list[str]]:
    """Every call made in plan_ai_write.py's line-up section, by name; every
    `x.y.name(` chain; every subscript it assigns to."""
    import ast
    src = inspect.getsource(C)
    start = src[:src.index("# ══ Build from plans: line up (Stage 1b")].count("\n") + 1
    tree = ast.parse(src)
    calls: dict[str, int] = {}
    chains: list[str] = []
    stored: list[str] = []
    for node in ast.walk(tree):
        if getattr(node, "lineno", 0) < start:
            continue
        if isinstance(node, ast.Call):
            f = node.func
            name = f.attr if isinstance(f, ast.Attribute) else f.id if isinstance(f, ast.Name) else ""
            calls[name] = calls.get(name, 0) + 1
            chains.append(ast.unparse(f))
        if isinstance(node, (ast.Assign, ast.AugAssign)):
            for t in (node.targets if isinstance(node, ast.Assign) else [node.target]):
                if isinstance(t, ast.Subscript) and isinstance(t.slice, ast.Constant):
                    stored.append(str(t.slice.value))
    return calls, chains, stored


def test_the_line_up_writes_only_through_its_two_writes_in_the_one_writer():
    """The writer is the only path that writes: the placement through
    async_reanchor_map and the refile, once each, in plan_ai_write.py's
    line-up section; nothing else of the house is reachable from it."""
    calls, chains, stored = _line_up_calls()
    assert calls.get("async_reanchor_map") == 1 and calls.get("async_set_map_floor") == 1 and calls.get("async_update_map") == 1
    for name in ("fabric_correct_room", "async_set_rf_barrier_m", "async_set_scanner_position_m", "async_set_beacon_position_m",
                 "async_set_light_position_m", "async_set_map_transform", "async_ensure_world_gauge", "_put_map_transform",
                 "async_spatial_update", "apply_edit", "async_write", "async_add_point", "async_recompute_transform_for_map",
                 "async_replace_image", "async_set_room_height", "async_reset", "async_restore_data"):
        assert name not in calls, name
    assert not any("fabric_map_transform_set" in c or c.split(".")[0] in ("house", "H") for c in chains), chains
    # It assigns no metres, no room outline, no calibration list, no gauge: only its own ledger's and items' fields.
    for key in ("x_m", "y_m", "points", "room_bounds", "world_gauge", "map_transforms", "floor_id", "points_m"):
        assert key not in stored, key
    # The calibration and pin files are written only by the stores' own re-derivations, and the maps record only when they moved.
    assert calls.get("async_remap_from_metres") == 1 and chains.count("ms.store.async_save") == 2
    # No other module of the plan AI or the line-up calls a house writer; the writes run only from the commands that hold the lock.
    for mod in (A, W):
        src = inspect.getsource(mod)
        for word in ("async_reanchor_map", "async_set_map_floor", "async_update_map", "async_remap_from_metres", "_put_map_transform"):
            assert word not in src, (mod.__name__, word)
    callers = {p.name for p in _PKG.glob("*.py") if re.search(r"\bC\.(lineup_commit|lineup_undo|settle_lineups)\(", p.read_text(encoding="utf-8"))}
    assert callers == {"ws_plan_ai.py"}, callers


def test_the_model_method_keeps_the_whole_record():
    """async_set_map_floor copies the record, changes floor_id, through the one mutator (origin_anchored kept)."""
    from unittest.mock import AsyncMock, MagicMock
    s = ModelStore.__new__(ModelStore)
    s.hass, s.store = MagicMock(), AsyncMock()
    rec = {"origin_x_m": 1.0, "origin_y_m": 2.0, "scale_x_m": 10.0, "scale_y_m": 8.0, "rotation_rad": 0.1, "floor_id": "basement",
           "origin_anchored": True, "reference_measurements": [{"distance_m": 3.0}]}
    s.data = {"map_transforms": {"m": dict(rec)}}
    assert _run(s.async_set_map_floor("m", "upper")) is True
    assert s.data["map_transforms"]["m"] == {**rec, "floor_id": "upper"}
    assert _run(s.async_set_map_floor("nope", "upper")) is False


# ═══ the report still identifies nothing ═════════════════════════════════════

def test_saves_and_undos_report_counts_only(monkeypatch, tmp_path, disk):
    h, conn, store, mdl, ms, cal = _ready(monkeypatch, tmp_path, disk)
    assert _commit(h, conn, ["place_m1"])["ok"] and _undo(h, conn)["ok"]
    from custom_components.padspan_ha.telemetry import _DATA_COUNTERS
    from tests.test_telemetry import _hass
    hh = _hass()
    hh.data[DOMAIN][_DATA_COUNTERS] = _counters(h)
    payload = T.build_payload(hh)
    T.assert_shareable(payload)
    ours = {k: v for k, v in payload["usage"].items() if k.startswith("plan_build_")}
    assert {"plan_build_commit:done", "plan_build_undo:session", "plan_build_item:place_undone"} <= set(ours) <= T.PLAN_BUILD_EVENTS
    text = json.dumps(payload)
    for s in ("Scan", "Shop", "basement", "Basement", "pb_t", "lb_", "bk_", "m1\"", "Den", "AA:BB"):
        assert s not in text, s
    assert not re.search(r"\d\.\d", json.dumps(payload["usage"]))

# ═══ Settings → AI keeps the undo; the help says it ══════════════════════════

def test_settings_keeps_the_undo_reachable_when_the_ai_stops_qualifying():
    src = (_ROOT / "www" / "padspan-ha" / "views" / "settings.js").read_text(encoding="utf-8")
    row = src[src.index("function _planBuildRow("):src.index("function _planAiLastRow(")]
    assert "const undo = info && info.master && info.undo ? info.undo : null;" in row and 'box.style.display = ok || undo ? "" : "none";' in row
    assert "if (!ok) { if (undo) box.appendChild(undoRow(undo, false)); return; }" in row          # drawn while locked
    assert 'wsCall("padspan_ha/plan_build_undo", { session: u.session })' in row and row.count("Undo this line-up session (experimental)") >= 2
    assert "In this version it proposes only" not in row


def test_the_help_topic_says_experimental_and_is_in_the_manual():
    help_src = (_ROOT / "www" / "padspan-ha" / "help_content.js").read_text(encoding="utf-8")
    topic = help_src[help_src.index("  plan_build: {"):help_src.index("  settings_atlas: {")]
    assert "(experimental)" in topic and "Undo this line-up session" in topic and "Show me the dimension" in topic and "the last six are kept" in topic
    assert '"plans_ai", "plan_build"' in (_ROOT / "www" / "padspan-ha" / "views" / "training.js").read_text(encoding="utf-8")
    for lang in ("de", "fr", "nl"):
        data = json.loads((_ROOT / "www" / "padspan-ha" / "i18n" / lang / "help.json").read_text(encoding="utf-8"))
        assert "Line up plans — Claude lines up your floor plans (experimental)" in data
