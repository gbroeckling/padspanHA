"""Start with a rough house from your Home Assistant rooms (starter_house.py, ws_maps.ws_maps_starter_house).

The owner's gap pick 1 (2026-11-23): with no drawing, one box room per Home Assistant area, laid out per floor, named
as its area, sized by a guess from its devices, on a blank floor marked as a rough start. The layout is pure and tested
as such; the command runs in the REAL maps, model, fabric and calibration stores, on disk, with a synthetic house (no
real house's areas or plans are in the repo). Never calibration; never a room or a plan that is already there; a second
press makes nothing.
"""
from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path
from types import SimpleNamespace

import pytest

from custom_components.padspan_ha import ai_wizard as W
from custom_components.padspan_ha import starter_house as S
from custom_components.padspan_ha import telemetry as T
from custom_components.padspan_ha import ws_maps as WM
from custom_components.padspan_ha.calibration_store import CalibrationStore
from custom_components.padspan_ha.const import (CALIBRATION_STORE_KEY, DATA_CALIBRATION, DATA_FABRIC, DATA_MAPS, DATA_MODEL,
                                                DATA_SETTINGS, DOMAIN, FABRIC_STORE_KEY, MAPS_STORE_KEY, MODEL_STORE_KEY)
from custom_components.padspan_ha.fabric_store import FabricStore
from custom_components.padspan_ha.maps_store import MapsStore
from custom_components.padspan_ha.model_store import ModelStore
from tests.test_house3d_edit import disk  # noqa: F401  (the on-disk store fixture)
from tests.test_house3d_store import _run

_ROOT = Path(__file__).resolve().parents[1]
_WWW = _ROOT / "custom_components" / "padspan_ha" / "www" / "padspan-ha"
_NODE = shutil.which("node")

FLOORS = [{"id": "ground", "name": "Ground floor", "level": 0}, {"id": "upper", "name": "Upstairs", "level": 1},
          {"id": "__outside__", "name": "Outside", "level": None}]
AREAS = [{"id": "a_k", "name": "Kitchen", "floor_id": "ground"}, {"id": "a_l", "name": "Living room", "floor_id": "ground"},
         {"id": "a_h", "name": "Hall", "floor_id": "ground"}, {"id": "a_b", "name": "Bedroom", "floor_id": "upper"},
         {"id": "a_t", "name": "Bathroom", "floor_id": "upper"}, {"id": "a_g", "name": "Garage", "floor_id": None},
         {"id": "a_y", "name": "Yard", "floor_id": "__outside__"}]
DEVICES = {"a_k": 9, "a_l": 30, "a_h": 1}


def _boxes(p):
    return {r["name"]: r for f in p["floors"] for r in f["rooms"]}


def _overlap(a, b) -> bool:
    (ax0, ay0), (ax1, ay1) = a[0], a[2]
    (bx0, by0), (bx1, by1) = b[0], b[2]
    return ax0 < bx1 and bx0 < ax1 and ay0 < by1 and by0 < ay1


# ═══ the layout (pure) ═══════════════════════════════════════════════════════

def test_a_box_is_sized_from_its_devices_and_capped():
    assert S.box_side_m(0) == S.box_side_m(4) == 3.5
    assert S.box_side_m(5) == 3.75 and S.box_side_m(8) == 4.5
    assert S.box_side_m(14) == S.box_side_m(200) == S.BOX_MAX_M == 6.0
    assert S.box_side_m(None) == 3.5 and S.box_side_m(-3) == 3.5


def test_boxes_are_packed_in_rows_apart_inside_the_floor():
    sides = {f"Room {i:02d}": S.box_side_m(i) for i in range(23)}
    boxes, across, down = S.pack(sides)
    assert set(boxes) == set(sides)
    names = list(boxes)
    for i, a in enumerate(names):
        pts = boxes[a]
        assert len(pts) == 4 and pts[2][0] - pts[0][0] == pytest.approx(sides[a]) and pts[2][1] - pts[0][1] == pytest.approx(sides[a])
        assert pts[0][0] >= S.EDGE_M - 1e-9 and pts[0][1] >= S.EDGE_M - 1e-9
        assert pts[2][0] <= across - S.EDGE_M + 1e-9 and pts[2][1] <= down - S.EDGE_M + 1e-9
        for b in names[i + 1:]:
            q = boxes[b]
            assert not _overlap(pts, q), (a, b)
            # Half a metre apart at least, one way or the other.
            gap = max(q[0][0] - pts[2][0], pts[0][0] - q[2][0], q[0][1] - pts[2][1], pts[0][1] - q[2][1])
            assert gap >= S.GAP_M - 1e-9, (a, b, gap)
    assert 1.0 <= across / down <= 2.5, "a floor a little wider than deep, not one long row"
    assert S.pack({}) == ({}, 0.0, 0.0)
    one, w, h = S.pack({"Only": 3.5})
    assert one["Only"][0] == [1.0, 1.0] and (w, h) == (5.5, 5.5)


def test_one_box_per_area_on_its_floor_named_as_the_area():
    p = S.plan(FLOORS, AREAS, DEVICES, set(), set())
    assert [f["floor_id"] for f in p["floors"]] == ["ground", "upper"], "indoor floors only, in the house's order"
    by = {f["floor_id"]: {r["name"] for r in f["rooms"]} for f in p["floors"]}
    assert by == {"ground": {"Kitchen", "Living room", "Hall", "Garage"}, "upper": {"Bedroom", "Bathroom"}}
    b = _boxes(p)
    assert (b["Kitchen"]["devices"], b["Kitchen"]["side_m"]) == (9, 4.75) and b["Living room"]["side_m"] == 6.0 and b["Hall"]["side_m"] == 3.5
    assert p["skipped"] == [{"room": "Yard", "why": "outdoor", "floor_id": "__outside__"}]
    # Garage has no floor in Home Assistant: on the first floor made, and said so.
    assert p["no_floor"] == {"to": "ground", "rooms": ["Garage"]}
    assert p["choices"] == [["ground", "Ground floor"], ["upper", "Upstairs"]]
    # A floor called Garden is the outdoors too, whatever its id.
    g = S.plan([*FLOORS, {"id": "floor_9", "name": "Garden"}], [*AREAS, {"id": "a_s", "name": "Shed", "floor_id": "floor_9"}], {}, set(), set())
    assert {"room": "Shed", "why": "outdoor", "floor_id": "floor_9"} in g["skipped"] and "floor_9" not in {f["floor_id"] for f in g["floors"]}
    for f in p["floors"]:
        pts = [r["points_m"] for r in f["rooms"]]
        assert all(not _overlap(a, c) for i, a in enumerate(pts) for c in pts[i + 1:])
        assert f["across_m"] >= max(q[2][0] for q in pts) + S.EDGE_M - 1e-9


def test_areas_with_no_floor_go_where_the_person_picks():
    p = S.plan(FLOORS, AREAS, {}, set(), set(), no_floor_to="upper")
    assert p["no_floor"] == {"to": "upper", "rooms": ["Garage"]} and "Garage" in {r["name"] for r in p["floors"][1]["rooms"]}
    # A floor that isn't offered (outdoors, unknown, taken): the default.
    for bad in ("__outside__", "nowhere"):
        assert S.plan(FLOORS, AREAS, {}, set(), set(), no_floor_to=bad)["no_floor"]["to"] == "ground"
    assert S.plan(FLOORS, AREAS, {}, {"ground"}, set())["no_floor"]["to"] == "upper", "the first floor being made"
    # A house with no floors in Home Assistant: everything on the main floor PadSpan has.
    main = S.plan([{"id": "main", "name": "Main Floor"}], [dict(a, floor_id=None) for a in AREAS[:3]], {}, set(), set())
    assert [f["floor_id"] for f in main["floors"]] == ["main"] and len(main["floors"][0]["rooms"]) == 3
    assert main["no_floor"]["rooms"] == ["Hall", "Kitchen", "Living room"]


def test_rooms_and_floors_that_exist_are_left_alone_and_listed():
    p = S.plan(FLOORS, AREAS, {}, {"upper"}, {"Kitchen"})
    assert [f["floor_id"] for f in p["floors"]] == ["ground"]
    assert {r["name"] for r in p["floors"][0]["rooms"]} == {"Living room", "Hall", "Garage"}
    why = {s["room"]: s["why"] for s in p["skipped"]}
    assert why == {"Kitchen": "drawn", "Bedroom": "floor_has_plan", "Bathroom": "floor_has_plan", "Yard": "outdoor"}
    assert set(why.values()) <= set(S.SKIPPED)
    # Every floor taken: nothing to make, every area said why.
    none = S.plan(FLOORS, AREAS, {}, {"ground", "upper"}, set())
    assert none["floors"] == [] and none["choices"] == [] and {s["room"] for s in none["skipped"]} == {a["name"] for a in AREAS}
    # One floor only: its areas, and those with no floor go on it unless the person picks another.
    one = S.plan(FLOORS, AREAS, {}, set(), set(), only="upper")
    assert [f["floor_id"] for f in one["floors"]] == ["upper"] and one["no_floor"] == {"to": "upper", "rooms": ["Garage"]} and one["skipped"] == []
    assert {r["name"] for r in one["floors"][0]["rooms"]} == {"Bedroom", "Bathroom", "Garage"}
    # A floor too big for a blank floor is left out, its rooms listed.
    big = S.plan(FLOORS, AREAS, {}, set(), set(), max_m=6.0)
    assert big["floors"] == [] and {s["why"] for s in big["skipped"]} == {"too_big", "outdoor"}


# ═══ the command, in the real stores ═════════════════════════════════════════

class _Settings:
    def __init__(self):
        self.data = {"telemetry_enabled": True}

    async def async_save(self):
        return None

    async def async_set(self, **kw):
        self.data.update(kw)


def _house(monkeypatch, tmp_path, disk, *, maps=(), rooms=None):  # noqa: F811
    h = SimpleNamespace(states=SimpleNamespace(get=lambda eid: None), bus=SimpleNamespace(async_fire=lambda *a, **k: None))

    async def _exec(fn, *a):
        return fn(*a)
    h.async_add_executor_job = _exec
    h.async_create_task = lambda coro: _run(coro) if hasattr(coro, "send") else None
    h.data = {DOMAIN: {DATA_SETTINGS: _Settings()}}
    fab = FabricStore(h)
    fab.store = disk(h, 1, FABRIC_STORE_KEY)
    for fid, rs in (rooms or {}).items():
        fab.data["floors"][fid] = {"committed": False, "committed_at": None, "frame_offset_m": {"dx_m": 0.0, "dy_m": 0.0, "rotation_rad": 0.0},
                                   "rooms": {r: {"type": "poly", "points_m": [[0, 0], [2, 0], [2, 2], [0, 2]], "floor_id": fid,
                                                 "committed_by": "correction", "revision": 1} for r in rs}}
    mdl = ModelStore.__new__(ModelStore)
    mdl.hass, mdl.store = h, disk(h, 1, MODEL_STORE_KEY)
    mdl.data = {"map_transforms": {}, "floors": [dict(f) for f in FLOORS], "room_meta": {"Kitchen": {"floor_id": "ground", "color": "#123456"}},
                "room_adjacency": {}, "world_gauge": {"m_per_unit": None, "source_map_id": None}, "scanners": {}}
    mdl.fabric = fab
    ms = MapsStore.__new__(MapsStore)
    ms.hass, ms.data, ms.store, ms.maps_dir = h, {"maps": [dict(m) for m in maps]}, disk(h, 1, MAPS_STORE_KEY), tmp_path
    cal = CalibrationStore.__new__(CalibrationStore)
    cal.hass, cal.store, cal._model = h, disk(h, 1, CALIBRATION_STORE_KEY), mdl
    cal.data = {"points": [{"id": "p1", "map_id": "old", "x": 0.5, "y": 0.5, "room": "Kitchen", "samples": [{"AA": -60}]}], "model": {}}
    h.data[DOMAIN].update({DATA_FABRIC: fab, DATA_MODEL: mdl, DATA_MAPS: ms, DATA_CALIBRATION: cal})
    for st in (mdl, ms, cal, fab):
        _run(st.store.async_save(st.data))
    monkeypatch.setattr(S, "house_floors", lambda hass: [dict(f) for f in FLOORS])
    monkeypatch.setattr(W, "ha_areas", lambda hass: [dict(a) for a in AREAS])
    monkeypatch.setattr(S, "_devices_per_area", lambda hass: dict(DEVICES))
    conn = SimpleNamespace(user=SimpleNamespace(is_admin=True), result=None, error=None)
    conn.send_result = lambda _id, r: setattr(conn, "result", r)
    conn.send_error = lambda _id, code, text: setattr(conn, "error", (code, text))
    return h, conn, fab, mdl, ms, cal


def _call(h, conn, **msg):
    conn.result = conn.error = None
    _run(WM.ws_maps_starter_house(h, conn, {"id": 3, "type": "padspan_ha/maps_starter_house", **msg}))
    return conn.result if conn.error is None else {"error": conn.error}


def _bytes(tmp_path, key):
    p = tmp_path / ".storage" / key
    return p.read_bytes() if p.is_file() else b""


def test_the_preview_writes_nothing(monkeypatch, tmp_path, disk):  # noqa: F811
    h, conn, fab, mdl, ms, cal = _house(monkeypatch, tmp_path, disk)
    disk.writes.clear()
    out = _call(h, conn, dry_run=True)
    assert out["ok"] is True and out["dry_run"] is True and [f["floor_id"] for f in out["floors"]] == ["ground", "upper"]
    assert disk.writes == [] and ms.data["maps"] == [] and fab.rooms_flat() == {}


def test_a_press_makes_a_plan_per_floor_and_a_box_per_area_and_never_touches_calibration(monkeypatch, tmp_path, disk):  # noqa: F811
    h, conn, fab, mdl, ms, cal = _house(monkeypatch, tmp_path, disk)
    cal_before = _bytes(tmp_path, CALIBRATION_STORE_KEY)
    cal_data = json.dumps(cal.data, sort_keys=True)
    out = _call(h, conn, label="rough start", no_floor_to="upper")
    assert out["ok"] is True and sorted(out["rooms"]) == ["Bathroom", "Bedroom", "Garage", "Hall", "Kitchen", "Living room"]
    assert out["no_floor"] == {"to": "upper", "rooms": ["Garage"]}
    plans = {m["floor_id"]: m for m in ms.data["maps"]}
    assert set(plans) == {"ground", "upper"} and [m["name"] for m in out["maps"]] == ["Ground floor (rough start)", "Upstairs (rough start)"]
    rooms = fab.rooms_flat()
    for fid, m in plans.items():
        assert m["kind"] == "blank" and set(m["starter"]["rooms"]) == {r for r, g in rooms.items() if g["floor_id"] == fid}
        assert (tmp_path / m["image"]["filename"]).read_bytes()[:4] == b"\x89PNG"
        t = mdl.map_transform(m["id"])
        f = next(x for x in out["floors"] if x["floor_id"] == fid)
        assert (t["scale_x_m"], t["scale_y_m"]) == (f["across_m"], f["down_m"]) and t["reference_measurements"][0]["source"] == "blank"
        # The boxes on the house are the ones the plan's record keeps: in metres, inside the plan, on its floor.
        for room, pts in m["starter"]["rooms"].items():
            g = rooms[room]
            assert g["points_m"] == pts and g["committed_by"] == "external_import" and g["source_map_id"] is None
            assert all(0 < x < t["scale_x_m"] and 0 < y < t["scale_y_m"] for x, y in pts)
    # Linked by name to its area; settings as fabric_room_add makes them, an area's own colour kept.
    assert mdl.data["room_meta"]["Kitchen"] == {"floor_id": "ground", "color": "#123456"}
    assert mdl.data["room_meta"]["Garage"]["floor_id"] == "upper" and mdl.data["room_adjacency"]["Garage"] == []
    # Calibration: not a byte.
    assert _bytes(tmp_path, CALIBRATION_STORE_KEY) == cal_before and json.dumps(cal.data, sort_keys=True) == cal_data
    c = h.data[DOMAIN].get("telemetry_counters") or {}
    assert c.get("starter_house:made") == 1 and c.get("starter_house:rooms_4_6") == 1 and c.get("starter_house:no_floor") == 1


def test_a_second_press_makes_nothing(monkeypatch, tmp_path, disk):  # noqa: F811
    h, conn, fab, mdl, ms, cal = _house(monkeypatch, tmp_path, disk)
    assert _call(h, conn)["ok"] is True
    maps, rooms = json.dumps(ms.data, sort_keys=True), json.dumps(fab.rooms_flat(), sort_keys=True)
    again = _call(h, conn)
    assert again["ok"] is False and again["code"] == "nothing" and again["floors"] == []
    assert {s["why"] for s in again["skipped"]} <= {"drawn", "outdoor"} and len(again["skipped"]) == len(AREAS)
    assert json.dumps(ms.data, sort_keys=True) == maps and json.dumps(fab.rooms_flat(), sort_keys=True) == rooms


def test_existing_rooms_and_plans_are_never_overwritten(monkeypatch, tmp_path, disk):  # noqa: F811
    plan = {"id": "p_up", "name": "Upstairs plan", "floor_id": "upper", "image": {"filename": "u.png", "width": 10, "height": 10},
            "room_bounds": {"Bedroom": {"type": "poly", "points": [[0.1, 0.1], [0.5, 0.1], [0.5, 0.5]]}}, "receivers": [], "beacons": []}
    h, conn, fab, mdl, ms, cal = _house(monkeypatch, tmp_path, disk, maps=[plan], rooms={"ground": ["Hall"]})
    hall = json.dumps(fab.rooms_flat()["Hall"], sort_keys=True)
    out = _call(h, conn)
    why = {s["room"]: s["why"] for s in out["skipped"]}
    # Ground has a room already and Upstairs a plan: both floors taken, nothing made, each area said why.
    assert out["ok"] is False and out["code"] == "nothing" and len(ms.data["maps"]) == 1
    assert why["Hall"] == "drawn" and why["Bedroom"] == "drawn" and why["Kitchen"] == "floor_has_plan" and why["Bathroom"] == "floor_has_plan"
    assert json.dumps(fab.rooms_flat()["Hall"], sort_keys=True) == hall and set(fab.rooms_flat()) == {"Hall"}
    # The writer itself refuses a room that appeared meanwhile: it is listed, and kept out of the plan's record.
    (tmp_path / "b").mkdir()
    h2, conn2, fab2, mdl2, ms2, cal2 = _house(monkeypatch, tmp_path / "b", disk)
    got = S.plan(FLOORS, AREAS, {}, set(), set())
    _run(fab2.async_correct_room("loft", "Bedroom", {"type": "poly", "points_m": [[0, 0], [1, 0], [1, 1]]}))
    made = _run(S.async_make(h2, got, "rough start"))
    up = next(m for m in ms2.data["maps"] if m["floor_id"] == "upper")
    assert "Bedroom" not in made["rooms"] and "Bedroom" not in up["starter"]["rooms"] and {"room": "Bedroom", "why": "drawn", "floor_id": "upper"} in made["skipped"]
    assert fab2.rooms_flat()["Bedroom"]["points_m"] == [[0, 0], [1, 0], [1, 1]] and "Bathroom" in up["starter"]["rooms"]
    # A floor that got a room meanwhile (another tab) is left out whole: no plan, no boxes, its areas listed.
    (tmp_path / "c").mkdir()
    h3, conn3, fab3, mdl3, ms3, cal3 = _house(monkeypatch, tmp_path / "c", disk)
    _run(fab3.async_correct_room("upper", "Study", {"type": "poly", "points_m": [[0, 0], [1, 0], [1, 1]]}))
    made = _run(S.async_make(h3, got, "rough start"))
    assert [m["floor_id"] for m in ms3.data["maps"]] == ["ground"] and "Bedroom" not in fab3.rooms_flat()
    assert {"room": "Bedroom", "why": "floor_has_plan", "floor_id": "upper"} in made["skipped"]


def test_the_command_is_an_administrators_and_free():
    import inspect
    src = inspect.getsource(WM)
    part = src[src.index('"type": "padspan_ha/maps_starter_house"'):src.index("async def ws_maps_starter_house")]
    assert "@websocket_api.require_admin" in part
    body = src[src.index("async def ws_maps_starter_house"):]
    body = body[:body.index("\n\n\n")]
    assert "tier" not in body and "licen" not in body, "plan creation is free"
    from custom_components.padspan_ha import websocket as WS
    assert "async_register_command(hass, ws_maps_starter_house)" in inspect.getsource(WS)


def test_the_counters_are_allowed_and_the_panel_sends_only_them():
    import re
    words = {"offered", "previewed", "nothing", "made", "no_floor", "reshape", "upload", "replaced",
             "rooms_1", "rooms_2_3", "rooms_4_6", "rooms_7_12", "rooms_gt12"}
    assert set(T.STARTER_HOUSE_WORDS) == words and all(T.event_allowed(f"starter_house:{w}") for w in words)
    assert not T.event_allowed("starter_house:rooms_0") and not T.event_allowed("starter_house:Kitchen")
    rj = (_WWW / "views" / "rough_plan.js").read_text(encoding="utf-8")
    wb = (_WWW / "views" / "wizard_build.js").read_text(encoding="utf-8")
    sent = set(re.findall(r'starterTel\(ctx, "([a-z_]+)"\)', rj)) | set(re.findall(r'telemetryEvent\("starter_house:([a-z_]+)"\)', wb))
    assert 'starterTel(ctx, r.ok ? "previewed" : "nothing")' in rj           # the preview's answer, either way
    sent |= {"previewed", "nothing"}
    server = {"made", "no_floor"} | {w for w in words if w.startswith("rooms_")}
    assert sent | server == words and not sent & server, sorted(sent)
    ib = (_WWW / "views" / "installbase.js").read_text(encoding="utf-8")
    assert 'a === "starter_house"' in ib and all(f"{w}:" in ib for w in words)
    if (_ROOT / "server" / "telemetry_summary.py").is_file():
        import importlib.util
        spec = importlib.util.spec_from_file_location("telemetry_summary", _ROOT / "server" / "telemetry_summary.py")
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        assert set(mod._STARTER_HOUSE) == T.STARTER_HOUSE_EVENTS


@pytest.mark.skipif(_NODE is None, reason="node is not installed")
def test_the_panel_harness():
    res = subprocess.run([_NODE, str(_ROOT / "tests" / "js" / "starter_house.mjs"), str(_WWW)], capture_output=True, text=True, timeout=180)
    lines = [ln for ln in res.stdout.splitlines() if ln.startswith("{")]
    assert lines, f"the harness itself failed:\n{res.stderr[-3000:]}"
    out = json.loads(lines[-1])
    assert out["cases"] and not out["failures"], json.dumps(out["failures"], indent=1)
