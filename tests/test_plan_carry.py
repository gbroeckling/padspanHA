"""Carry-along (plan_carry.py, 2026-11-16): what was placed on a floor plan, moved with it when the plan is.

A plan's place in the house is corrected now and then, and everything put on it is stored in metres, so it stays where
the plan used to be (the owner's basement, 2026-11: two receivers 1.1 m off and four devices outside their room, put
right by hand). Held here: where a plan stood is noted the first time it is moved and never on its first placing; the
list says what would move and moves nothing; only the kinds asked for move, each to the same spot on the picture, after
a backup; a dismissal forgets it; nothing of a calibration point but its place changes. No real house data.
"""
from __future__ import annotations

import copy
import json

import pytest

from custom_components.padspan_ha import plan_carry as C
from custom_components.padspan_ha import ws_maps as WM
from custom_components.padspan_ha.const import DATA_FABRIC, DOMAIN
from tests.test_fabric_store import _make_fabric
from tests.test_house3d_edit import disk  # noqa: F401
from tests.test_house3d_store import _run
from tests.test_plan_build import _call
from tests.test_plan_build_scale import _setup

_ACROSS = {"p1": [0.1, 0.5], "p2": [0.6, 0.5], "text": "5 m"}       # the 1000 x 800 plan "n1": 10 m across, 8 m down


def _house(monkeypatch, tmp_path, disk):  # noqa: F811
    h, conn, mdl, ms, cal = _setup(monkeypatch, tmp_path, disk)
    out = _call(WM.ws_maps_scale_measure, h, conn, map_id="n1", measures=[dict(_ACROSS)], save=True)
    assert out["ok"] is True and (out["scale_x_m"], out["scale_y_m"]) == (10.0, 8.0)
    fab = _make_fabric()                                    # the house's metres, in the real store (the fixture's is read-only)
    mdl.fabric = fab
    h.data[DOMAIN][DATA_FABRIC] = fab
    m = ms.get_map("n1")
    # On the plan: a room traced on it, a receiver pinned on it; in that room a light; elsewhere a light and a receiver.
    m["room_bounds"] = {"Kitchen": {"type": "poly", "points": [[0.1, 0.125], [0.5, 0.125], [0.5, 0.5], [0.1, 0.5]]}}
    m["receivers"] = [{"id": "r1", "source": "AA:BB", "x": 0.2, "y": 0.25, "room": "Kitchen"}]
    _run(fab.async_correct_room("main", "Kitchen", {"type": "poly", "points_m": [[1, 1], [5, 1], [5, 4], [1, 4]]}))
    _run(fab.async_correct_room("main", "Hall", {"type": "poly", "points_m": [[6, 1], [9, 1], [9, 7], [6, 7]]}))
    _run(mdl.async_set_scanner_position_m("AA:BB", 2.0, 2.0, 2.2, "main"))
    _run(mdl.async_set_scanner_position_m("CC:DD", 8.0, 6.0, 2.4, "main"))            # not pinned on this plan
    _run(mdl.async_set_light_position_m("light.kitchen", 3.0, 3.0, "main", label="Kitchen light"))
    _run(mdl.async_set_light_position_m("light.hall", 8.0, 2.0, "main"))               # in a room not traced on this plan
    _run(mdl.async_set_rf_barrier_m({"name": "Kitchen north", "floor_id": "main", "points_m": [[1, 1], [5, 1]], "attenuation_dbm": 6}))
    _run(mdl.async_set_rf_barrier_m({"name": "Hall wall", "floor_id": "main", "points_m": [[6, 1], [6, 7]], "attenuation_dbm": 6}))
    _run(mdl.async_set_beacon_position_m("bk", 2.0, 3.5, "main", room="Kitchen", kind="tag", label="Fridge tag"))
    _run(mdl.async_set_beacon_position_m("bh", 8.0, 5.0, "main", room="Hall"))
    for pid, label, x, y, mid in (("cp_a", "Phone", 2.0, 3.0, "n1"), ("cp_b", "[auto] tag", 4.0, 2.0, "n1"), ("cp_c", "Phone", 7.0, 5.0, "other")):
        cal.data.setdefault("points", []).append({"id": pid, "label": label, "room": "Kitchen", "map_id": mid, "floor_id": "main",
                                                  "x_m": x, "y_m": y, "x_frac": x / 10, "y_frac": y / 8, "scanner_readings": {"AA:BB": -60},
                                                  "collected_at": "2026-01-01T00:00:00+00:00"})
    C.attach(h)                                             # as websocket registration does
    return h, conn, mdl, ms, cal


def _move(mdl, ms, cal, **pose):
    res = _run(mdl.async_reanchor_map("n1", ms.get_map("n1"), cal, **pose))
    assert res.get("ok"), res
    return res


# The plan moved a metre east and made a fifth wider: a spot at fraction f of its width goes from 10 f to 1 + 12 f.
_POSE = {"origin_x_m": 1.0, "origin_y_m": 0.0, "scale_x_m": 12.0, "scale_y_m": 8.0}
_to = lambda x, y: [round(1 + x / 10 * 12, 3), y]  # noqa: E731


def test_a_first_placing_notes_nothing_and_a_move_notes_where_the_plan_stood(monkeypatch, tmp_path, disk):  # noqa: F811
    h, conn, mdl, ms, cal = _house(monkeypatch, tmp_path, disk)
    assert not mdl.data.get(C.MOVED_KEY), "measured for the first time: there was nowhere it stood before"
    assert _run(C.carry_list(h)) == []
    _move(mdl, ms, cal, **_POSE)
    was = mdl.data[C.MOVED_KEY]["n1"]
    assert (was["origin_x_m"], was["scale_x_m"], was["scale_y_m"]) == (0.0, 10.0, 8.0) and was["at"]
    _move(mdl, ms, cal, origin_x_m=1.5)                       # moved again: still where the things were put
    assert mdl.data[C.MOVED_KEY]["n1"]["scale_x_m"] == 10.0 and mdl.data[C.MOVED_KEY]["n1"]["origin_x_m"] == 0.0


def test_the_list_says_what_would_move_and_moves_nothing(monkeypatch, tmp_path, disk):  # noqa: F811
    h, conn, mdl, ms, cal = _house(monkeypatch, tmp_path, disk)
    _move(mdl, ms, cal, **_POSE)
    before = json.dumps([mdl.room_geometry_m(), mdl.scanner_positions_m(), mdl.light_positions_m(), cal.data], sort_keys=True, default=str)
    got = _call(C.ws_plan_carry_list, h, conn)["plans"]
    assert len(got) == 1
    p = got[0]
    assert (p["map_id"], p["rooms"], p["receivers"], p["points"], p["points_hand"], p["devices"]) == ("n1", ["Kitchen"], 1, 2, 1, 1), p
    assert p["shift_m"] == pytest.approx(2.0, abs=0.01), "the room's far corner: 5 m across goes to 7 m"
    assert json.dumps([mdl.room_geometry_m(), mdl.scanner_positions_m(), mdl.light_positions_m(), cal.data], sort_keys=True, default=str) == before
    plan = C.carry_plan(h, "n1")
    assert plan["receivers"] == {"AA:BB": _to(2.0, 2.0)} and plan["devices"] == {"light.kitchen": _to(3.0, 3.0)}
    assert plan["points"] == {"cp_a": _to(2.0, 3.0), "cp_b": _to(4.0, 2.0)}
    assert plan["rooms"]["Kitchen"] == [_to(1, 1), _to(5, 1), _to(5, 4), _to(1, 4)]


def test_only_what_is_ticked_moves_after_a_backup_and_the_rest_is_untouched(monkeypatch, tmp_path, disk):  # noqa: F811
    h, conn, mdl, ms, cal = _house(monkeypatch, tmp_path, disk)
    _move(mdl, ms, cal, **_POSE)
    assert _call(C.ws_plan_carry_apply, h, conn, map_id="n1", kinds=[])["code"] == "none_chosen"
    pts0, rooms0, lights0 = copy.deepcopy(cal.data["points"]), copy.deepcopy(mdl.room_geometry_m()), copy.deepcopy(mdl.light_positions_m())
    out = _call(C.ws_plan_carry_apply, h, conn, map_id="n1", kinds=["receivers"])
    assert out["ok"] is True and out["moved"] == {**dict.fromkeys(C.KINDS, 0), "receivers": 1} and out["backup_id"]
    pos = mdl.scanner_positions_m()
    assert [pos["AA:BB"]["x_m"], pos["AA:BB"]["y_m"], pos["AA:BB"]["z_m"]] == [*_to(2.0, 2.0), 2.2], "its height kept"
    assert (pos["CC:DD"]["x_m"], pos["CC:DD"]["y_m"]) == (8.0, 6.0), "a receiver not pinned on the plan stays"
    assert cal.data["points"] == pts0 and mdl.room_geometry_m() == rooms0 and mdl.light_positions_m() == lights0
    assert _run(C.carry_list(h)) == [] and "n1" not in (mdl.data.get(C.MOVED_KEY) or {}), "answered: no longer listed"


def test_everything_ticked_goes_to_the_same_spot_on_the_picture(monkeypatch, tmp_path, disk):  # noqa: F811
    h, conn, mdl, ms, cal = _house(monkeypatch, tmp_path, disk)
    _move(mdl, ms, cal, **_POSE)
    out = _call(C.ws_plan_carry_apply, h, conn, map_id="n1", kinds=list(C.KINDS))
    assert out["ok"] is True and out["moved"] == {"rooms": 1, "receivers": 1, "points": 2, "devices": 1, "walls": 1, "beacons": 1, "zones": 0}
    bars = {b["name"]: b["points_m"] for b in mdl.rf_barriers_m()}
    assert bars["Kitchen north"] == [_to(1, 1), _to(5, 1)] and bars["Hall wall"] == [[6.0, 1.0], [6.0, 7.0]], "a wall of another room stays"
    bp = mdl.beacon_positions_m()
    assert [bp["bk"]["x_m"], bp["bk"]["y_m"]] == _to(2.0, 3.5) and bp["bk"]["label"] == "Fridge tag" and (bp["bh"]["x_m"], bp["bh"]["y_m"]) == (8.0, 5.0)
    geo, lp = mdl.room_geometry_m(), mdl.light_positions_m()
    assert [list(p[:2]) for p in geo["Kitchen"]["points_m"]] == [_to(1, 1), _to(5, 1), _to(5, 4), _to(1, 4)]
    assert [list(p[:2]) for p in geo["Hall"]["points_m"]] == [[6, 1], [9, 1], [9, 7], [6, 7]], "a room not traced on the plan stays"
    assert [lp["light.kitchen"]["x_m"], lp["light.kitchen"]["y_m"]] == _to(3.0, 3.0) and lp["light.kitchen"]["label"] == "Kitchen light"
    assert (lp["light.hall"]["x_m"], lp["light.hall"]["y_m"]) == (8.0, 2.0)
    by = {p["id"]: p for p in cal.data["points"]}
    assert [by["cp_a"]["x_m"], by["cp_a"]["y_m"]] == _to(2.0, 3.0) and [by["cp_b"]["x_m"], by["cp_b"]["y_m"]] == _to(4.0, 2.0)
    assert (by["cp_c"]["x_m"], by["cp_c"]["y_m"]) == (7.0, 5.0), "a point recorded on another plan stays"
    assert all(by[k]["scanner_readings"] == {"AA:BB": -60} and by[k]["room"] == "Kitchen" for k in ("cp_a", "cp_b", "cp_c")), "only a point's place changes"
    assert by["cp_a"]["x_frac"] == pytest.approx(0.2, abs=1e-3), "back on the spot of the picture it was clicked on"


def test_a_dismissal_forgets_it_and_a_backup_that_fails_moves_nothing(monkeypatch, tmp_path, disk):  # noqa: F811
    from custom_components.padspan_ha import ws_backup
    h, conn, mdl, ms, cal = _house(monkeypatch, tmp_path, disk)
    _move(mdl, ms, cal, **_POSE)

    async def no_backup(*a, **k):
        return None

    real = ws_backup._auto_backup
    monkeypatch.setattr(ws_backup, "_auto_backup", no_backup)
    before = json.dumps([mdl.room_geometry_m(), mdl.scanner_positions_m(), cal.data], sort_keys=True, default=str)
    out = _call(C.ws_plan_carry_apply, h, conn, map_id="n1", kinds=list(C.KINDS))
    assert out["ok"] is False and out["code"] == "backup_failed"
    assert json.dumps([mdl.room_geometry_m(), mdl.scanner_positions_m(), cal.data], sort_keys=True, default=str) == before
    assert len(_run(C.carry_list(h))) == 1, "still offered"
    monkeypatch.setattr(ws_backup, "_auto_backup", real)
    assert _call(C.ws_plan_carry_dismiss, h, conn, map_id="n1") == {"ok": True}
    assert _run(C.carry_list(h)) == [] and json.dumps([mdl.room_geometry_m(), mdl.scanner_positions_m(), cal.data], sort_keys=True, default=str) == before
    assert _call(C.ws_plan_carry_apply, h, conn, map_id="n1", kinds=["rooms"])["code"] == "nothing"


def test_only_what_stood_there_then_and_still_does_is_offered(monkeypatch, tmp_path, disk):  # noqa: F811
    """Review 2026-11-16: a room traced after the move, a receiver put right by hand, a point recorded afterwards and a
    room Reconcile had already fixed were each offered the move. Only what the note saw, untouched since, is."""
    h, conn, mdl, ms, cal = _house(monkeypatch, tmp_path, disk)
    fab = h.data[DOMAIN][DATA_FABRIC]
    _move(mdl, ms, cal, **_POSE)
    assert set(mdl.data[C.MOVED_KEY]["n1"]["stood"]) == {"rooms", "receivers", "devices", "walls", "beacons", "zones"}
    _run(mdl.async_set_scanner_position_m("AA:BB", 3.4, 2.0, 2.2, "main"))                       # put right by hand
    _run(fab.async_correct_room("main", "Kitchen", {"type": "poly", "points_m": [[2.2, 1], [7, 1], [7, 4], [2.2, 4]]}))   # fixed since
    ms.get_map("n1")["room_bounds"]["Hall"] = {"type": "poly", "points": [[0.5, 0.1], [0.7, 0.1], [0.7, 0.8], [0.5, 0.8]]}   # traced since
    cal.data["points"].append({"id": "cp_new", "label": "Phone", "room": "Kitchen", "map_id": "n1", "floor_id": "main", "x_m": 6.0, "y_m": 2.0,
                               "scanner_readings": {"AA:BB": -55}, "collected_at": "2099-01-01T00:00:00+00:00"})
    cal.data["points"].append({"id": "cp_undated", "label": "Phone", "room": "Kitchen", "map_id": "n1", "floor_id": "main", "x_m": 6.0, "y_m": 3.0,
                               "scanner_readings": {"AA:BB": -55}})
    plan = C.carry_plan(h, "n1")
    assert plan["rooms"] == {} and plan["receivers"] == {} and set(plan["points"]) == {"cp_a", "cp_b"}, plan
    assert plan["devices"] == {}, "its room is no longer where the note saw it, so what is in it is not guessed at"
    # A plan moved with nothing on it (a scan just placed) offers nothing, whatever is put on it afterwards.
    mdl.data[C.MOVED_KEY]["n1"]["stood"] = {"rooms": {}, "receivers": {}, "devices": {}}
    cal.data["points"] = [p for p in cal.data["points"] if p["id"] in ("cp_new", "cp_undated")]
    assert C.carry_plan(h, "n1") is None
    mdl.data[C.MOVED_KEY]["n1"].pop("stood")                    # a note with no picture of what stood: nothing offered
    assert C.carry_plan(h, "n1") is None


def test_a_picture_cut_or_extended_is_no_move_and_a_move_cut_short_is_never_made_twice(monkeypatch, tmp_path, disk):  # noqa: F811
    h, conn, mdl, ms, cal = _house(monkeypatch, tmp_path, disk)
    assert _run(mdl.async_rebase_placement("n1", -0.2, 0.0, 1.2, 1.0)) is True                  # the canvas padded on the left
    assert not mdl.data.get(C.MOVED_KEY) and _run(C.carry_list(h)) == [], "nothing moved in the house"
    _move(mdl, ms, cal, origin_x_m=1.0, origin_y_m=0.0, scale_x_m=14.0, scale_y_m=8.0)
    assert len(_run(C.carry_list(h))) == 1
    assert _run(mdl.async_rebase_placement("n1", 0.0, 0.0, 0.5, 1.0)) is True                   # then cut: the note described a picture that is gone
    assert not mdl.data.get(C.MOVED_KEY)
    mdl.data[C.MOVED_KEY] = "not a dict"                                                          # a damaged store never stops a placement
    _move(mdl, ms, cal, origin_x_m=3.0)
    assert isinstance(mdl.data[C.MOVED_KEY], dict)
    # A move that fails part-way has already been answered: asked again, nothing moves a second time.
    h2, conn2, mdl2, ms2, cal2 = _house(monkeypatch, tmp_path, disk)
    _move(mdl2, ms2, cal2, **_POSE)

    async def boom(*a, **k):
        raise RuntimeError("disk")

    monkeypatch.setattr(mdl2, "async_set_light_position_m", boom)
    with pytest.raises(RuntimeError):
        _run(C.carry_apply(h2, "n1", list(C.KINDS)))
    assert "n1" not in (mdl2.data.get(C.MOVED_KEY) or {}) and _call(C.ws_plan_carry_apply, h2, conn2, map_id="n1", kinds=["rooms"])["code"] == "nothing"


def test_a_sub_zone_in_a_moved_room_goes_with_it_a_circle_by_its_centre(monkeypatch, tmp_path, disk):  # noqa: F811
    from custom_components.padspan_ha.const import DATA_SUBZONES
    h, conn, mdl, ms, cal = _house(monkeypatch, tmp_path, disk)

    class Zones:
        def __init__(self):
            self.z = {"sz_a": {"id": "sz_a", "name": "Desk", "floor_id": "main", "type": "poly", "points_m": [[2, 2], [3, 2], [3, 3]], "dwell_s": 5},
                      "sz_c": {"id": "sz_c", "name": "Sink", "floor_id": "main", "type": "circle", "cx_m": 4.0, "cy_m": 3.0, "r_m": 0.5},
                      "sz_h": {"id": "sz_h", "name": "Bench", "floor_id": "main", "type": "circle", "cx_m": 8.0, "cy_m": 3.0, "r_m": 0.5}}

        def zones(self):
            return self.z

        async def async_put(self, zid, zone):
            self.z[zid] = zone
            return zone

    zs = h.data[DOMAIN][DATA_SUBZONES] = Zones()
    C.attach(h)
    _move(mdl, ms, cal, **_POSE)
    assert _call(C.ws_plan_carry_list, h, conn)["plans"][0]["zones"] == 2
    out = _call(C.ws_plan_carry_apply, h, conn, map_id="n1", kinds=["zones"])
    assert out["ok"] is True and out["moved"]["zones"] == 2 and out["moved"]["rooms"] == 0
    assert zs.z["sz_a"]["points_m"] == [_to(2, 2), _to(3, 2), _to(3, 3)] and zs.z["sz_a"]["dwell_s"] == 5
    assert [zs.z["sz_c"]["cx_m"], zs.z["sz_c"]["cy_m"], zs.z["sz_c"]["r_m"]] == [*_to(4.0, 3.0), 0.5] and zs.z["sz_h"]["cx_m"] == 8.0


def test_the_commands_are_an_administrators_and_registered():
    from custom_components.padspan_ha import websocket as W
    src = (W.__file__ and open(W.__file__, encoding="utf-8").read()) or ""
    assert "from .plan_carry import WS_COMMANDS as _plan_carry_commands" in src
    assert C.WS_COMMANDS == (C.ws_plan_carry_list, C.ws_plan_carry_apply, C.ws_plan_carry_dismiss)
    assert DOMAIN and C.KINDS == ("rooms", "receivers", "points", "devices", "walls", "beacons", "zones")


def test_suggest_a_fit_answers_through_its_command(monkeypatch, tmp_path, disk):  # noqa: F811
    """0.38.256 shipped this command answering "no fit" always (a name it never imported, swallowed): held end to end."""
    h, conn, mdl, ms, cal = _house(monkeypatch, tmp_path, disk)
    fab = h.data[DOMAIN][DATA_FABRIC]
    # The floor below: three rooms filling 9 x 7 m, the outside walls the plan's rooms share. The plan "n1" (10 x 8 m of picture) is of the floor above them.
    for name, pts in (("A", [[0, 0], [5, 0], [5, 3], [0, 3]]), ("B", [[5, 0], [9, 0], [9, 3], [5, 3]]), ("Cc", [[0, 3], [9, 3], [9, 7], [0, 7]])):
        _run(fab.async_correct_room("below", name, {"type": "poly", "points_m": pts}))
    ms.data["maps"].append({"id": "ref", "name": "Below", "floor_id": "below", "image": {"width": 100, "height": 100}, "room_bounds": {}, "receivers": []})
    m = ms.get_map("n1")
    f = lambda pts: {"type": "poly", "points": [[x / 10, y / 8] for x, y in pts]}  # noqa: E731
    m["room_bounds"] = {"X": f([[0.5, 0.5], [4, 0.5], [4, 7.5], [0.5, 7.5]]), "Y": f([[4, 0.5], [9.5, 0.5], [9.5, 4], [4, 4]]), "Z": f([[4, 4], [9.5, 4], [9.5, 7.5], [4, 7.5]])}
    out = _call(WM.ws_maps_fit_suggest, h, conn, map_id="n1", ref_map_id="ref")
    assert out["fit"] and set(out["fit"]) == {"origin_x_m", "origin_y_m", "rotation_rad", "score"}, out
    assert abs(out["fit"]["origin_x_m"] + 0.5) <= 0.3 and abs(out["fit"]["origin_y_m"] + 0.5) <= 0.3 and out["fit"]["rotation_rad"] == 0, out
    assert _call(WM.ws_maps_fit_suggest, h, conn, map_id="n1", ref_map_id="nope") == {"fit": None}
