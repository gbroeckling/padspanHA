"""Plan files from other apps (plan_file_import.py): Easy Floorplan card YAML, DXF and Floorplanner's FML, read into
the room scan's contract and drawn by Mapping → Upload's scan path (ws_maps.ws_maps_scan_create) as a plan to scale
whose rooms are outlines a Home Assistant room can take.

Every file here is small and made for these tests in the structure each format documents (sources in
plan_file_import.py's docstring): a demo house, never anyone's real one. Each format: its rooms, its scale, what was
left out and said, and a malformed file. Then the websocket path: a plan saved to scale with its rooms kept, a file
with several floors asking which, a width typed for a file with no unit, a RoomPlan scan unchanged, and the panel's
words and counters.
"""
from __future__ import annotations

import base64
import io
import json
import re
import zipfile
from pathlib import Path

import pytest

from custom_components.padspan_ha import plan_file_import as PF
from custom_components.padspan_ha import telemetry as T
from custom_components.padspan_ha import ws_maps as WM
from tests.test_house3d_edit import disk  # noqa: F401  (the on-disk store fixture)
from tests.test_plan_build import _call
from tests.test_scale_nudge import _house

_WWW = Path(__file__).resolve().parents[1] / "custom_components" / "padspan_ha" / "www" / "padspan-ha"


def _skipped(parsed: dict) -> dict:
    return {s["what"]: s["n"] for s in parsed["skipped"]}


def _box(points: list) -> tuple[float, float]:
    xs, ys = [p[0] for p in points], [p[1] for p in points]
    return round(max(xs) - min(xs), 3), round(max(ys) - min(ys), 3)


# ── Easy Floorplan ────────────────────────────────────────────────────────────────────────────────────────────────

EFP = """\
type: custom:easy-floorplan-card
title: Demo house
width: 1000
height: 600
floors:
  - id: ground
    name: Ground
    haFloor: main
    walls:
      - { id: w1, x1: 100, y1: 100, x2: 900, y2: 100 }
      - { id: w2, x1: 900, y1: 100, x2: 900, y2: 500 }
      - { id: w3, x1: 900, y1: 500, x2: 100, y2: 500 }
      - { id: w4, x1: 100, y1: 500, x2: 100, y2: 100 }
      - { id: w5, x1: 500, y1: 100, x2: 500, y2: 500 }
      - { id: broken, x1: 100 }
    openings:
      - { id: d1, type: door, 'x': 500, 'y': 300, length: 80, angle: 90 }
      - { id: win1, type: window, 'x': 300, 'y': 100, length: 120, angle: 0 }
      - { id: sky1, type: skylight, 'x': 700, 'y': 300, length: 100, width: 60, angle: 0 }
    areas:
      - id: a1
        name: Cooking
        haArea: kitchen
        points: [{ 'x': 100, 'y': 100 }, { 'x': 500, 'y': 100 }, { 'x': 500, 'y': 500 }, { 'x': 100, 'y': 500 }]
      - id: a2
        name: Lounge
        points: [{ 'x': 500, 'y': 100 }, { 'x': 900, 'y': 100 }, { 'x': 900, 'y': 500 }, { 'true': 500, 'x': 500 }]
      - id: a3
        name: Nothing
        points: [{ 'x': 1, 'y': 1 }]
    items:
      - { id: i1, entity: light.demo_lamp, 'x': 240, 'y': 200, kind: light }
      - { id: i2, entity: sensor.demo_temperature, 'x': 700, 'y': 380 }
    furniture:
      - { id: f1, type: sofa, 'x': 250, 'y': 420, w: 170, h: 72 }
    texts:
      - { id: t1, 'x': 500, 'y': 60, text: Demo, size: 22 }
  - id: upper
    name: Upper
    walls:
      - { id: u1, x1: 100, y1: 100, x2: 600, y2: 100 }
      - { id: u2, x1: 600, y1: 100, x2: 600, y2: 400 }
"""


def test_easy_floorplan_rooms_walls_doors_and_the_area_link():
    p = PF.parse_plan_file(EFP.encode(), across_m=8.0, floor_id="main", area_names={"kitchen": "Kitchen"})
    assert p["file"] == "easy_floorplan" and p["level"] == "ground" and p["scale"] == "typed"
    # The room linked to a Home Assistant area is named as that area; the other keeps its own name.
    assert [r["name"] for r in p["rooms"]] == ["Kitchen", "Lounge"]
    assert _box(p["rooms"][0]["points_m"]) == (4.0, 4.0), "800 canvas units typed as 8 m: 0.01 m a unit"
    assert len(p["walls"]) == 5 and p["walls"][0] == {"a_m": [1.0, 1.0], "b_m": [9.0, 1.0]}
    kinds = sorted(o["kind"] for o in p["openings"])
    assert kinds == ["door", "window"]
    door = next(o for o in p["openings"] if o["kind"] == "door")
    assert sorted([door["a_m"][1], door["b_m"][1]]) == [2.6, 3.4] and door["a_m"][0] == door["b_m"][0] == 5.0


def test_easy_floorplan_says_what_it_left_out():
    p = PF.parse_plan_file(EFP.encode(), across_m=8.0, floor_id="main")
    assert _skipped(p) == {"devices": 2, "furniture": 1, "annotations": 1, "bad": 2, "other": 1}
    assert [s["what"] for s in p["skipped"]] == [k for k in PF.SKIP_KINDS if k in _skipped(p)], "always in one order"


def test_easy_floorplan_scale_from_the_doors_or_asked_for():
    p = PF.parse_plan_file(EFP.encode(), floor_id="main")
    assert p["scale"] == "doors" and _box(p["rooms"][0]["points_m"]) == (4.25, 4.25), "an 80-unit door taken as 0.85 m"
    no_doors = EFP.replace("type: door", "type: passage")
    with pytest.raises(PF.PlanFileError) as e:
        PF.parse_plan_file(no_doors.encode(), floor_id="main")
    assert e.value.code == "need_size"


def test_easy_floorplan_with_several_floors_asks_which_unless_one_is_linked():
    with pytest.raises(PF.PlanFileError) as e:
        PF.parse_plan_file(EFP.encode(), across_m=8.0, floor_id="upstairs")
    assert e.value.code == "pick_level" and [lv["id"] for lv in e.value.levels] == ["ground", "upper"]
    p = PF.parse_plan_file(EFP.encode(), across_m=5.0, level="upper")
    assert p["level"] == "upper" and not p["rooms"] and len(p["walls"]) == 2
    assert p["warnings"] == ["No rooms with a usable outline were found in this file"]


def test_easy_floorplan_found_in_a_whole_dashboard_and_as_json():
    card = EFP.replace("\n", "\n        ")
    dash = "views:\n  - title: Home\n    cards:\n      - type: entities\n        entities: [light.demo_lamp]\n      - " + card
    assert PF.parse_plan_file(dash.encode(), across_m=8.0, floor_id="main")["level"] == "ground"
    import yaml
    as_json = json.dumps(yaml.safe_load(EFP)).encode()
    assert PF.parse_plan_file(as_json, across_m=8.0, floor_id="main")["file"] == "easy_floorplan"


def test_easy_floorplan_one_floor_at_the_top_level():
    one = "type: custom:easy-floorplan-card\nwalls:\n  - { x1: 0, y1: 0, x2: 400, y2: 0 }\n  - { x1: 400, y1: 0, x2: 400, y2: 300 }\n" \
          "areas:\n  - { name: Den, points: [{x: 0, y: 0}, {x: 400, y: 0}, {x: 400, y: 300}, {x: 0, y: 300}] }\n"
    p = PF.parse_plan_file(one.encode(), across_m=4.0)
    assert p["level"] == "plan" and [r["name"] for r in p["rooms"]] == ["Den"] and _box(p["rooms"][0]["points_m"]) == (4.0, 3.0)


@pytest.mark.parametrize("bad, code", [
    (b"walls: [ {x1: 1", "unreadable"),                         # broken YAML
    (b"not a plan at all", "unreadable"),                       # plain words
    (b"type: entities\nentities: [light.demo_lamp]\n", "not_scan"),  # YAML, but no Easy Floorplan card
    (b"type: custom:easy-floorplan-card\nwalls: []\n", "empty"),
])
def test_easy_floorplan_malformed(bad, code):
    with pytest.raises(PF.PlanFileError) as e:
        PF.parse_plan_file(bad, across_m=8.0)
    assert e.value.code == code


# ── DXF ───────────────────────────────────────────────────────────────────────────────────────────────────────────

def _dxf(entities: list[list], units: int | None = 4) -> bytes:
    """An ASCII DXF: a header with $INSUNITS (None: no header) and these entities, each a list of (code, value)."""
    out = ["999", "demo drawing"]
    if units is not None:
        out += ["0", "SECTION", "2", "HEADER", "9", "$INSUNITS", "70", str(units), "0", "ENDSEC"]
    out += ["0", "SECTION", "2", "ENTITIES"]
    for ent in entities:
        for code, value in ent:
            out += [str(code), str(value)]
    out += ["0", "ENDSEC", "0", "EOF"]
    return ("\r\n".join(out) + "\r\n").encode()


def _lw(points, closed=True, **extra):
    ent = [(0, "LWPOLYLINE"), (8, "ROOMS"), (90, len(points)), (70, 1 if closed else 0)]
    for x, y in points:
        ent += [(10, x), (20, y)]
    return ent + list(extra.items())


def _text(x, y, words, kind="TEXT"):
    return [(0, kind), (8, "NAMES"), (10, x), (20, y), (1, words)]


DXF_HOUSE = [
    _lw([(0, 0), (4000, 0), (4000, 3000), (0, 3000)]),            # 4 m x 3 m
    _lw([(4000, 0), (7000, 0), (7000, 3000), (4000, 3000)]),      # 3 m x 3 m
    _text(2000, 1500, "Kitchen"), _text(2000, 1200, "12.0 m²"),
    [(0, "MTEXT"), (8, "NAMES"), (10, 5500), (20, 1500), (1, "{\\fArial;Living}\\Proom")],
    [(0, "LINE"), (8, "WALLS"), (10, 0), (20, 3000), (11, 0), (21, 5000)],
    _lw([(100, 100), (400, 100), (400, 400), (100, 400)]),        # 0.09 m²: no room
    _lw([(0, -300), (7000, -300), (7000, -100), (0, -100)]),      # 7 m x 0.2 m: a wall drawn as an outline
    [(0, "CIRCLE"), (8, "FURN"), (10, 1000), (20, 1000), (40, 300)],
    _text(9000, 9000, "Title block"),
    [(0, "POLYLINE"), (8, "WALLS"), (66, 1), (70, 0), (0, "VERTEX"), (10, 7000), (20, 0), (0, "VERTEX"), (10, 9000), (20, 0), (42, 0.5), (0, "SEQEND")],
]


def test_dxf_closed_polylines_are_rooms_named_by_their_text():
    p = PF.parse_plan_file(_dxf(DXF_HOUSE))
    assert p["file"] == "dxf" and p["scale"] == "file"
    assert [r["name"] for r in p["rooms"]] == ["Kitchen", "Living room"]
    assert _box(p["rooms"][0]["points_m"]) == (4.0, 3.0) and _box(p["rooms"][1]["points_m"]) == (3.0, 3.0), "millimetres"
    # Turned over: a DXF's y runs up, a plan's down, so the line drawn upward from the rooms' top runs to y = -5.
    assert {"a_m": [0.0, -3.0], "b_m": [0.0, -5.0]} in p["walls"]
    # The two rooms' shared edge is one wall, not two: 4 + 4 - 1 room edges, the line, the outline's 4, the polyline.
    assert len(p["walls"]) == 7 + 1 + 4 + 1


def test_dxf_says_what_it_left_out():
    p = PF.parse_plan_file(_dxf(DXF_HOUSE))
    assert _skipped(p) == {"small_shapes": 1, "thin_shapes": 1, "curves": 1, "annotations": 1, "other": 1}


@pytest.mark.parametrize("units, per_m", [(6, 1.0), (5, 100.0), (4, 1000.0), (2, 1 / 0.3048), (1, 1 / 0.0254)])
def test_dxf_units_from_the_header(units, per_m):
    w, d = 4 * per_m, 3 * per_m
    p = PF.parse_plan_file(_dxf([_lw([(0, 0), (w, 0), (w, d), (0, d)])], units=units))
    assert _box(p["rooms"][0]["points_m"]) == (4.0, 3.0)


def test_dxf_with_no_unit_asks_for_the_width():
    rooms = [_lw([(0, 0), (40, 0), (40, 30), (0, 30)]), _lw([(40, 0), (100, 0), (100, 30), (40, 30)])]
    for units in (None, 0):
        with pytest.raises(PF.PlanFileError) as e:
            PF.parse_plan_file(_dxf(rooms, units=units))
        assert e.value.code == "need_size"
    p = PF.parse_plan_file(_dxf(rooms, units=0), across_m=10.0)
    assert p["scale"] == "typed" and _box(p["rooms"][0]["points_m"]) == (4.0, 3.0)


@pytest.mark.parametrize("data", [
    b"0\r\nSECTION\r\n2\r\nENTITIES\r\nnot a code\r\nLINE\r\n",      # a value where a group code belongs
    b"AutoCAD Binary DXF\r\n\x1a\x00rest",                         # binary DXF
    b"AC1032\x00\x00rest of a dwg",                                # a DWG
])
def test_dxf_malformed(data):
    with pytest.raises(PF.PlanFileError) as e:
        PF.parse_plan_file(data)
    assert e.value.code == "unreadable" and ("DXF" in str(e.value) or "DWG" in str(e.value))


def test_dxf_with_nothing_to_draw():
    with pytest.raises(PF.PlanFileError) as e:
        PF.parse_plan_file(_dxf([_text(0, 0, "Only words")]))
    assert e.value.code == "empty"


# ── Floorplanner ─────────────────────────────────────────────────────────────────────────────────────────────────

def _fml() -> dict:
    """An FML v3.0 project in its persistent JSON: centimetres, y down."""
    def wall(ax, ay, bx, by, **kw):
        return {"a": {"x": ax, "y": ay}, "b": {"x": bx, "y": by}, "az": {"z": 0, "h": 250}, "bz": {"z": 0, "h": 250},
                "thickness": 15, "balance": 0.5, "openings": [], "decor": {}, **kw}
    ground = {"id": 501, "name": "Demo design", "walls": [
        wall(0, 0, 600, 0, openings=[{"refid": "w1", "type": "window", "t": 0.5, "width": 120, "z": 90, "z_height": 120}]),
        wall(600, 0, 600, 400),
        wall(600, 400, 0, 400, openings=[{"refid": "d1", "type": "door", "t": 0.25, "width": 90, "z": 0, "z_height": 210}]),
        wall(0, 400, 0, 0),
        wall(300, 0, 300, 400, c={"x": 320, "y": 200}),
        {"a": {"x": 1}},
    ], "areas": [
        {"poly": [{"x": 0, "y": 0}, {"x": 300, "y": 0}, {"x": 300, "y": 400}, {"x": 0, "y": 400}], "name": "Kitchen", "color": "#ffffff", "showAreaLabel": True},
        {"poly": [{"x": 300, "y": 0}, {"x": 600, "y": 0}, {"x": 600, "y": 400}, {"x": 300, "y": 400}], "name": "Living room", "customName": "Lounge", "color": "#ffffff", "showAreaLabel": True},
    ], "surfaces": [{"poly": [{"x": 0, "y": 0, "z": 0}]}], "dimensions": [{}], "items": [{"refid": "sofa", "x": 100, "y": 100, "z": 0}] * 3,
        "labels": [{"x": 10, "y": 10, "text": "Demo"}], "lines": []}
    return {"id": 9, "name": "Demo project", "public": False, "floors": [
        {"id": 11, "name": "Ground floor", "level": 0, "height": 250, "designs": [ground, {"id": 502, "name": "Variant", "walls": [], "areas": []}], "cameras": []},
        {"id": 12, "name": "Attic", "level": 1, "height": 250, "designs": [], "cameras": []},
    ]}


def _zip(name: str, data: bytes) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("images/plan.png", b"\x89PNG not really")
        z.writestr(name, data)
    return buf.getvalue()


def test_floorplanner_rooms_walls_and_openings_in_centimetres():
    for data in (json.dumps(_fml()).encode(), _zip("Demo project.fml", json.dumps(_fml()).encode())):
        p = PF.parse_plan_file(data)
        assert p["file"] == "floorplanner" and p["level"] == "11", "the one floor with anything on it"
        assert [r["name"] for r in p["rooms"]] == ["Kitchen", "Lounge"]
        assert _box(p["rooms"][0]["points_m"]) == (3.0, 4.0)
        assert len(p["walls"]) == 5
        win = next(o for o in p["openings"] if o["kind"] == "window")
        assert win == {"kind": "window", "a_m": [2.4, 0.0], "b_m": [3.6, 0.0]}
        door = next(o for o in p["openings"] if o["kind"] == "door")
        assert door == {"kind": "door", "a_m": [4.95, 4.0], "b_m": [4.05, 4.0]}


def test_floorplanner_says_what_it_left_out():
    p = PF.parse_plan_file(json.dumps(_fml()).encode())
    assert _skipped(p) == {"furniture": 3, "annotations": 2, "curves": 1, "other_designs": 1, "bad": 1, "other": 1}


def test_floorplanner_with_two_drawn_floors_asks_which():
    doc = _fml()
    doc["floors"][1]["designs"] = [{"walls": [{"a": {"x": 0, "y": 0}, "b": {"x": 500, "y": 0}}], "areas": []}]
    with pytest.raises(PF.PlanFileError) as e:
        PF.parse_plan_file(json.dumps(doc).encode())
    assert e.value.code == "pick_level" and [lv["name"] for lv in e.value.levels] == ["Ground floor", "Attic"]
    assert PF.parse_plan_file(json.dumps(doc).encode(), level="12")["walls"] == [{"a_m": [0.0, 0.0], "b_m": [5.0, 0.0]}]


def test_floorplanner_rooms_with_no_walls_draw_their_edges():
    doc = {"walls": [], "areas": [{"poly": [{"x": 0, "y": 0}, {"x": 400, "y": 0}, {"x": 400, "y": 300}, {"x": 0, "y": 300}], "name": "Den"}]}
    doc["walls"] = [{"a": {"x": 0, "y": 0}, "b": {"x": 0, "y": 0}}]           # one wall of no length: nothing of it drawn
    p = PF.parse_plan_file(json.dumps({"designs": [doc]}).encode())
    assert [r["name"] for r in p["rooms"]] == ["Den"] and len(p["walls"]) == 4
    doc["areas"][0]["poly"].append({"x": 0, "y": 0})                        # closed by repeating the first point
    p = PF.parse_plan_file(json.dumps({"designs": [doc]}).encode())
    assert len(p["walls"]) == 4 and len(p["rooms"][0]["points_m"]) == 4


@pytest.mark.parametrize("data, code", [
    (_zip("plan.fml", b"{ not json"), "unreadable"),
    (_zip("plan.fml", b"<?xml version='1.0'?><project><floors/></project>"), "unreadable"),
    (b"<?xml version='1.0'?>\n<project><floors><floor/></floors></project>", "unreadable"),
    (_zip("plan.fml", json.dumps({"floors": [{"designs": []}]}).encode()), "empty"),
])
def test_floorplanner_malformed(data, code):
    with pytest.raises(PF.PlanFileError) as e:
        PF.parse_plan_file(data)
    assert e.value.code == code


def test_a_sweet_home_3d_file_is_sent_to_its_own_import():
    with pytest.raises(PF.PlanFileError) as e:
        PF.parse_plan_file(_zip("Home.xml", b"<home/>"))
    assert e.value.code == "not_scan" and "Sweet Home 3D" in str(e.value)


def test_a_roomplan_scan_reads_as_before():
    from tests.test_roomplan_import import _room, _usdz
    from custom_components.padspan_ha import roomplan_import as RP
    raw = _usdz(_room(0.0, 0.0, 4.0, 3.0))
    p = PF.parse_plan_file(raw)
    assert p["file"] == "usdz" and p["skipped"] == [] and p["rooms"] == RP.parse_roomplan(raw)["rooms"]


# ── Down the scan's path: a plan saved to scale ─────────────────────────────────────────────────────────────────────

def _b64(data: bytes) -> str:
    return base64.b64encode(data).decode()


def test_a_plan_file_becomes_a_plan_to_scale_with_its_rooms_to_link(monkeypatch, tmp_path, disk):  # noqa: F811
    h, conn, mdl, ms, cal = _house(monkeypatch, tmp_path, disk)
    ms.maps_dir = tmp_path
    out = _call(WM.ws_maps_scan_create, h, conn, floor_id="main", file_base64=_b64(_dxf(DXF_HOUSE)), name="")
    m = out["map"]
    assert out["ok"] is True and out["file"] == "dxf" and out["rooms"] == 2 and out["scale"] == "file"
    assert m["kind"] == "scan" and m["name"] == "DXF plan" and m["scan"]["source"] == "dxf"
    assert {s["what"] for s in out["skipped"]} == {"small_shapes", "thin_shapes", "curves", "annotations", "other"} and m["scan"]["skipped"] == out["skipped"]
    assert [r["name"] for r in m["scan"]["rooms"]] == ["Kitchen", "Living room"]
    t = mdl.map_transform(m["id"])
    # The drawing is 9 m across (the polyline runs to 9 m) and 5.3 m down (the line's 5 m up, the outline 0.3 m
    # below), with half a metre round it.
    assert (t["scale_x_m"], t["scale_y_m"]) == (10.0, 6.3) and t["reference_measurements"][0]["source"] == "scan"
    # The Kitchen's outline on the picture is 4 m of the 10 across.
    k = m["scan"]["rooms"][0]["points"]
    assert round((max(p[0] for p in k) - min(p[0] for p in k)) * t["scale_x_m"], 2) == 4.0


def test_a_file_with_several_floors_asks_and_a_typed_width_scales_one_with_no_unit(monkeypatch, tmp_path, disk):  # noqa: F811
    h, conn, mdl, ms, cal = _house(monkeypatch, tmp_path, disk)
    ms.maps_dir = tmp_path
    n = len(ms.list_maps())
    out = _call(WM.ws_maps_scan_create, h, conn, floor_id="upstairs", file_base64=_b64(EFP.encode()), across="8 m", name="")
    assert out["ok"] is False and out["code"] == "pick_level" and out["levels"] == [{"id": "ground", "name": "Ground"}, {"id": "upper", "name": "Upper"}]
    assert len(ms.list_maps()) == n, "nothing written"
    assert _call(WM.ws_maps_scan_create, h, conn, floor_id="main", file_base64=_b64(EFP.encode()), across="lots", name="")["code"] == "need_size"
    out = _call(WM.ws_maps_scan_create, h, conn, floor_id="main", file_base64=_b64(EFP.encode()), across="8 m", level="ground", name="")
    assert out["ok"] is True and out["file"] == "easy_floorplan" and out["scale"] == "typed" and out["map"]["name"] == "Easy Floorplan plan"
    t = mdl.map_transform(out["map"]["id"])
    assert (t["scale_x_m"], t["scale_y_m"]) == (9.0, 5.0), "8 m of walls, half a metre round"
    unit = _dxf([_lw([(0, 0), (40, 0), (40, 30), (0, 30)])], units=0)
    assert _call(WM.ws_maps_scan_create, h, conn, floor_id="main", file_base64=_b64(unit), name="")["code"] == "need_size"
    assert _call(WM.ws_maps_scan_create, h, conn, floor_id="main", file_base64=_b64(unit), across="4 m", name="")["ok"] is True


# ── The panel: the way to a plan, its words and its counters ────────────────────────────────────────────────────────

def test_the_panel_offers_the_file_way_and_says_each_kind_left_out():
    rj = (_WWW / "views" / "rough_plan.js").read_text(encoding="utf-8")
    assert re.search(r'KINDS = Object\.freeze\(\["have", "file", "scan"', rj)
    assert 'type: "padspan_ha/maps_scan_create"' in rj and "level" in rj and "across" in rj
    # Every kind the server leaves out has its words in the panel, singular and plural.
    for what in PF.SKIP_KINDS:
        assert re.search(r"\b%s: \(n\) => tn\(n, " % what, rj), what
    mj = (_WWW / "views" / "maps.js").read_text(encoding="utf-8")
    assert "ROUGH.skippedLine" in mj and "ROUGH.scanRoomNamed" in mj


def test_the_counters_are_a_closed_list_of_words():
    words = set(T.ROUGH_PLAN_FILE)
    assert {"file", "file_made", "file_easy_floorplan", "file_dxf", "file_floorplanner", "file_levels", "file_skipped"} <= words
    assert all(T.event_allowed(f"rough_plan:{w}") for w in words)
    assert not T.event_allowed("rough_plan:file_some_name.dxf")
    rj = (_WWW / "views" / "rough_plan.js").read_text(encoding="utf-8")
    sent = set(re.findall(r'tel\(ctx, "(file[a-z_]*)"\)', rj)) | {"file"}
    assert sent == words, sorted(sent ^ words)
    ib = (_WWW / "views" / "installbase.js").read_text(encoding="utf-8")
    assert all(f"{w}:" in ib for w in words)
