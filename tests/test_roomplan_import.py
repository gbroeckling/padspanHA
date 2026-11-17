"""Unit tests for roomplan_import.py (gap #7 tier 2 of the best-in-class
roadmap, docs/BEST_IN_CLASS_ROADMAP.md) and its websocket command.

No real RoomPlan export was available during development — these tests build
small hand-made CapturedRoom / CapturedStructure documents in the structure
Apple documents and JSONEncoder writes (sources in roomplan_import.py's
docstring): flat column-major 4x4 transforms, enum categories as
{"name": {}}, floors with polygonCorners, sections with label + center. No
real house data.

Held here too: with the setting off (the default) nothing changes — the
command refuses, and the Rooms tab's picker, button and .sh3d path are the
ones they were.
"""
from __future__ import annotations

import asyncio
import base64
import inspect
import io
import json
import math
import re
import zipfile
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest

from custom_components.padspan_ha import ws_floorplan_import as WFI
from custom_components.padspan_ha.const import DATA_SETTINGS, DOMAIN
from custom_components.padspan_ha.roomplan_import import LEVEL_ID, RoomPlanParseError, parse_roomplan
from custom_components.padspan_ha.settings_store import DEFAULT_SETTINGS
from custom_components.padspan_ha.sh3d_import import parse_sh3d

_CC = Path(__file__).resolve().parents[1] / "custom_components" / "padspan_ha"


# ── fixture builders ─────────────────────────────────────────────────────────

def _wall_tf(cx: float, cz: float, angle_deg: float, cy: float = 1.25) -> list[float]:
    """A vertical surface: right = (cos, 0, sin), up = +Y; column-major."""
    c, s = math.cos(math.radians(angle_deg)), math.sin(math.radians(angle_deg))
    return [c, 0, s, 0,  0, 1, 0, 0,  -s, 0, c, 0,  cx, cy, cz, 1]


def _floor_tf(cx: float, cz: float) -> list[float]:
    """A horizontal surface: local X → world X, local Y → world Z."""
    return [1, 0, 0, 0,  0, 0, 1, 0,  0, -1, 0, 0,  cx, 0, cz, 1]


def _surface(category, tf, dims, **extra):
    return {"identifier": "00000000-0000-0000-0000-000000000000", "category": category,
            "confidence": {"high": {}}, "dimensions": dims, "transform": tf,
            "completedEdges": [], "parentIdentifier": None, "curve": None, "story": 0, **extra}


def _walls(x0: float, z0: float, w: float, d: float) -> list[dict]:
    return [
        _surface({"wall": {}}, _wall_tf(x0 + w / 2, z0, 0), [w, 2.5, 0]),
        _surface({"wall": {}}, _wall_tf(x0 + w, z0 + d / 2, 90), [d, 2.5, 0]),
        _surface({"wall": {}}, _wall_tf(x0 + w / 2, z0 + d, 180), [w, 2.5, 0]),
        _surface({"wall": {}}, _wall_tf(x0, z0 + d / 2, 270), [d, 2.5, 0]),
    ]


def _floor(x0: float, z0: float, w: float, d: float, corners: bool = True) -> dict:
    hw, hd = w / 2, d / 2
    extra = {"polygonCorners": [[-hw, -hd, 0], [hw, -hd, 0], [hw, hd, 0], [-hw, hd, 0]]} if corners else {}
    return _surface({"floor": {}}, _floor_tf(x0 + hw, z0 + hd), [w, d, 0], **extra)


def _room(x0=0.0, z0=0.0, w=4.0, d=3.0, *, floors=True, corners=True, sections=None, story=0) -> dict:
    return {
        "identifier": "11111111-1111-1111-1111-111111111111",
        "story": story,
        "version": 2,
        "walls": _walls(x0, z0, w, d),
        "doors": [_surface({"door": {"isOpen": True}}, _wall_tf(x0 + 1, z0, 0, cy=1.0), [0.9, 2.0, 0])],
        "windows": [_surface({"window": {}}, _wall_tf(x0 + w, z0 + 1, 90, cy=1.5), [1.2, 1.0, 0])],
        "openings": [],
        "floors": [_floor(x0, z0, w, d, corners)] if floors else [],
        "objects": [{"identifier": "22222222-2222-2222-2222-222222222222", "category": {"table": {}},
                     "confidence": {"medium": {}}, "dimensions": [1.2, 0.75, 0.8],
                     "transform": _wall_tf(x0 + 2, z0 + 1.5, 0, cy=0.375), "parentIdentifier": None,
                     "attributes": {}, "story": story}],
        "sections": sections if sections is not None else [
            {"label": {"kitchen": {}}, "center": [x0 + w / 2, 0, z0 + d / 2], "story": story}],
    }


def _bytes(doc) -> bytes:
    return json.dumps(doc).encode("utf-8")


def _ring_set(points):
    return {tuple(p) for p in points}


# ── CapturedRoom ─────────────────────────────────────────────────────────────

def test_a_captured_room_becomes_one_named_room_on_one_level():
    result = parse_roomplan(_bytes(_room()))
    assert result["warnings"] == []
    assert result["levels"] == [{"id": LEVEL_ID, "name": "RoomPlan scan", "elevation_m": 0.0}]
    assert len(result["rooms"]) == 1
    room = result["rooms"][0]
    assert room["name"] == "Kitchen" and room["level_id"] == LEVEL_ID
    assert _ring_set(room["points_m"]) == {(0.0, 0.0), (4.0, 0.0), (4.0, 3.0), (0.0, 3.0)}


def test_the_result_keeps_parse_sh3ds_contract():
    sh3d_buf = io.BytesIO()
    with zipfile.ZipFile(sh3d_buf, "w") as zf:
        zf.writestr("Home.xml", '<home><level id="l" name="L" elevation="0"/><room name="A" level="l">'
                                '<point x="0" y="0"/><point x="100" y="0"/><point x="100" y="100"/></room></home>')
    sh3d = parse_sh3d(sh3d_buf.getvalue())
    rp = parse_roomplan(_bytes(_room()))
    assert set(sh3d) <= set(rp)
    assert set(sh3d["levels"][0]) == set(rp["levels"][0])
    assert set(sh3d["rooms"][0]) == set(rp["rooms"][0])


def test_the_transforms_position_column_moves_the_room():
    room = parse_roomplan(_bytes(_room(x0=10.0, z0=-5.0)))["rooms"][0]
    assert _ring_set(room["points_m"]) == {(10.0, -5.0), (14.0, -5.0), (14.0, -2.0), (10.0, -2.0)}


def test_an_ios16_floor_without_polygon_corners_uses_its_dimensions():
    result = parse_roomplan(_bytes(_room(corners=False)))
    assert result["warnings"] == []
    assert _ring_set(result["rooms"][0]["points_m"]) == {(0.0, 0.0), (4.0, 0.0), (4.0, 3.0), (0.0, 3.0)}


def test_no_floor_the_shape_is_inferred_from_the_walls_and_said_so():
    result = parse_roomplan(_bytes(_room(floors=False)))
    assert len(result["rooms"]) == 1
    assert _ring_set(result["rooms"][0]["points_m"]) == {(0.0, 0.0), (4.0, 0.0), (4.0, 3.0), (0.0, 3.0)}
    assert any("inferred from its walls" in w for w in result["warnings"])


def test_walls_that_dont_close_are_skipped_with_a_warning_not_guessed():
    doc = _room(floors=False)
    doc["walls"] = doc["walls"][:2] + [_surface({"wall": {}}, _wall_tf(40, 40, 0), [2, 2.5, 0])]
    result = parse_roomplan(_bytes(doc))
    assert result["rooms"] == []
    assert any("don't close" in w for w in result["warnings"])
    assert any("No rooms" in w for w in result["warnings"])


def test_section_labels_become_words_and_unidentified_is_no_name():
    multi = _room(sections=[
        {"label": {"livingRoom": {}}, "center": [1, 0, 1], "story": 0},
        {"label": "diningRoom", "center": [3, 0, 2], "story": 0},
    ])
    assert parse_roomplan(_bytes(multi))["rooms"][0]["name"] == "Living room / Dining room"
    unnamed = _room(sections=[{"label": {"unidentified": {}}, "center": [1, 0, 1], "story": 0}])
    assert parse_roomplan(_bytes(unnamed))["rooms"][0]["name"] is None


def test_doors_windows_and_objects_come_along_for_other_uses():
    result = parse_roomplan(_bytes(_room()))
    assert len(result["walls"]) == 4
    kinds = {o["kind"]: o for o in result["openings"]}
    assert kinds["door"]["is_open"] is True and kinds["window"]["is_open"] is None
    assert kinds["door"]["a_m"] == [0.55, 0.0] and kinds["door"]["b_m"] == [1.45, 0.0]
    obj = result["objects"][0]
    assert obj["category"] == "table" and obj["center_m"] == [2.0, 1.5] and obj["size_m"] == [1.2, 0.8]


# ── CapturedStructure ────────────────────────────────────────────────────────

def test_a_captured_structure_puts_every_room_on_one_level():
    doc = {"identifier": "33333333-3333-3333-3333-333333333333", "version": 1,
           "rooms": [_room(sections=[]), _room(x0=4.0, sections=[])],
           "walls": [], "doors": [], "windows": [], "openings": [], "objects": [], "floors": [],
           "sections": [{"label": {"kitchen": {}}, "center": [2, 0, 1.5], "story": 0},
                        {"label": {"bedroom": {}}, "center": [6, 0, 1.5], "story": 0}]}
    result = parse_roomplan(_bytes(doc))
    assert result["warnings"] == []
    assert len(result["levels"]) == 1
    assert [r["name"] for r in result["rooms"]] == ["Kitchen", "Bedroom"]
    assert {r["level_id"] for r in result["rooms"]} == {LEVEL_ID}
    assert len(result["walls"]) == 8 and len(result["objects"]) == 2


def test_several_stories_are_one_level_with_a_note():
    doc = {"rooms": [_room(story=0), _room(x0=4.0, story=1)], "sections": []}
    result = parse_roomplan(_bytes(doc))
    assert len(result["rooms"]) == 2 and len(result["levels"]) == 1
    assert any("2 stories" in w for w in result["warnings"])


# ── refusals ─────────────────────────────────────────────────────────────────

@pytest.mark.parametrize("data,words", [
    (b"PK\x03\x04usdz", "could not be opened"),
    (b"{not json", "could not read it as JSON"),
    (b"\xff\xfe\x00", "could not read it as JSON"),
    (b"[1, 2]", "expected a JSON object"),
    (b'{"hello": "world"}', "no rooms, walls or floors"),
    (b"[" * 100000 + b"]" * 100000, "could not read it as JSON"),
], ids=["usdz", "bad-json", "not-utf8", "a-list", "no-keys", "deep-nesting"])
def test_what_is_not_a_roomplan_export_is_refused_plainly(data, words):
    with pytest.raises(RoomPlanParseError, match=re.escape(words)):
        parse_roomplan(data)


def test_garbage_inside_a_valid_document_is_skipped_not_crashed_on():
    doc = _room()
    doc["walls"].append({"transform": "nope", "dimensions": [1]})
    doc["floors"].append({"transform": [float("nan")] * 16, "polygonCorners": []})
    doc["objects"].append("not a dict")
    result = parse_roomplan(_bytes(doc))
    assert len(result["rooms"]) == 1 and len(result["walls"]) == 4


# ── the websocket command, and nothing changes while it's off ───────────────

def _hass(on: bool | None):
    data = {} if on is None else {"roomplan_import_enabled": on}

    async def _job(fn, *args):
        return fn(*args)
    return SimpleNamespace(data={DOMAIN: {DATA_SETTINGS: SimpleNamespace(data=data)}},
                           async_add_executor_job=_job)


def _call(handler, h, msg):
    conn = MagicMock()
    asyncio.new_event_loop().run_until_complete(handler(h, conn, {"id": 5, **msg}))
    if conn.send_error.called:
        return {"error": conn.send_error.call_args[0][1], "message": conn.send_error.call_args[0][2]}
    return conn.send_result.call_args[0][1]


def _rp(h, b64):
    return _call(WFI.ws_floorplan_import_roomplan, h,
                 {"type": "padspan_ha/floorplan_import_roomplan", "roomplan_base64": b64})


_B64 = base64.b64encode(_bytes(_room())).decode("ascii")


def test_off_by_default_and_refused_while_off():
    assert DEFAULT_SETTINGS["roomplan_import_enabled"] is False
    for on in (None, False):
        out = _rp(_hass(on), _B64)
        assert out["error"] == WFI.ROOMPLAN_OFF_CODE


def test_on_it_parses_the_upload():
    out = _rp(_hass(True), _B64)
    assert out["source"] == "roomplan" and out["rooms"][0]["name"] == "Kitchen"


@pytest.mark.parametrize("b64,code", [
    ("A" * ((WFI.MAX_SH3D_BYTES * 4) // 3 + 8), "upload_too_large"),
    ("not base64!!", "bad_base64"),
    (base64.b64encode(b"{}").decode("ascii"), "parse_failed"),
], ids=["too-large", "bad-base64", "not-roomplan"])
def test_same_upload_cap_and_errors_as_the_sh3d_command(b64, code):
    assert _rp(_hass(True), b64)["error"] == code


def test_admin_gated_with_its_own_schema_and_registered_beside_sh3d():
    src = inspect.getsource(WFI)
    at = src.index("async def ws_floorplan_import_roomplan(")
    assert "@websocket_api.require_admin" in src[src.rindex("@websocket_api.websocket_command(", 0, at):at]
    schema = WFI.ws_floorplan_import_roomplan.ws_schema
    assert {str(k) for k in schema} == {"type", "roomplan_base64"}
    assert schema["type"] == "padspan_ha/floorplan_import_roomplan"
    ws = (_CC / "websocket.py").read_text(encoding="utf-8")
    assert ("async_register_command(hass, ws_floorplan_import_sh3d)\n"
            "    websocket_api.async_register_command(hass, ws_floorplan_import_roomplan)") in ws


def test_the_sh3d_command_is_unchanged_and_ignores_the_setting():
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        zf.writestr("Home.xml", '<home><room name="A"><point x="0" y="0"/><point x="100" y="0"/>'
                                '<point x="100" y="100"/></room></home>')
    b64 = base64.b64encode(buf.getvalue()).decode("ascii")
    for on in (None, False, True):
        out = _call(WFI.ws_floorplan_import_sh3d, _hass(on),
                    {"type": "padspan_ha/floorplan_import_sh3d", "sh3d_base64": b64})
        assert out == parse_sh3d(buf.getvalue())
    assert {str(k) for k in WFI.ws_floorplan_import_sh3d.ws_schema} == {"type", "sh3d_base64"}


def test_the_rooms_tab_is_the_sh3d_one_while_off():
    js = (_CC / "www" / "padspan-ha" / "views" / "maps.js").read_text(encoding="utf-8")
    assert 'const roomplanOn = ctx.state.settings?.roomplan_import_enabled === true;' in js
    assert 'fileInput.accept = roomplanOn ? ".sh3d,.json,.usdz" : ".sh3d";' in js
    assert 'roomplanOn ? "📐 Import floorplan (.sh3d, RoomPlan .usdz or .json)" : "📐 Import floorplan (.sh3d)"' in js
    # only a .json file, and only while on, goes to the RoomPlan command
    assert ('const parsed = roomplanOn && /\\.(json|usdz)$/i.test(file.name || "")\n'
            '          ? await ctx.actions.wsCall("padspan_ha/floorplan_import_roomplan", { roomplan_base64: b64 })\n'
            '          : await ctx.actions.wsCall("padspan_ha/floorplan_import_sh3d", { sh3d_base64: b64 });') in js
    # an .sh3d import keeps its label (parse_sh3d has no "source")
    assert 'label: raw.source === "roomplan" ? "Imported (RoomPlan)" : "Imported (SH3D)"' in js
    assert '"source"' not in inspect.getsource(parse_sh3d)


def test_nothing_new_in_the_usage_report():
    from custom_components.padspan_ha import telemetry as T
    assert "roomplan_import_enabled" not in T._FEATURE_FLAGS
    # 0.38.160: only whether it is turned on, sent only when it is (never a scan or its rooms).
    src = (_CC / "telemetry.py").read_text(encoding="utf-8")
    assert src.count("roomplan") == 1 and '"roomplan_import_enabled": "plan_scan_import"' in src


def test_the_nesting_limit_is_the_same_everywhere_and_ignores_text():
    # GitHub's Linux Python read 100,000 levels where Windows gave up, so the
    # refusal came out differently; the parser now refuses past _MAX_DEPTH itself.
    with pytest.raises(RoomPlanParseError, match="could not read it as JSON"):
        parse_roomplan(b"[" * 300 + b"]" * 300)
    with pytest.raises(RoomPlanParseError, match="no rooms, walls or floors"):
        parse_roomplan(json.dumps({"note": "[[[[[" * 100}).encode())


@pytest.mark.parametrize("data", [
    b'"a' * 500_000,                                    # quotes that never close: quadratic before
    b'{"a":"' + b'x\\"' * 330_000 + b'"}',              # escaped quotes inside one string
    b'["' * 500_000,
    b'"\\\n' * 330_000,                                # a backslash before a newline
], ids=["unclosed-quotes", "escaped-quotes", "bracket-quote", "backslash-newline"])
def test_a_megabyte_of_hostile_text_is_read_in_linear_time(data):
    import time
    assert len(data) >= 990_000
    t0 = time.perf_counter()
    with pytest.raises(RoomPlanParseError):
        parse_roomplan(data)
    assert time.perf_counter() - t0 < 1.0


def test_brackets_in_strings_still_do_not_count_toward_the_nesting_limit():
    doc = _room()
    doc["note"] = "[{" * 1000 + 'a \\" quote'
    assert parse_roomplan(_bytes(doc))["rooms"][0]["name"] == "Kitchen"
    with pytest.raises(RoomPlanParseError, match="could not read it as JSON"):
        parse_roomplan(b'{"a": "[[[", "b": ' + b"[" * 201 + b"]" * 201 + b"}")


# ── RoomPlan's USDZ (2026-11-16): the zip of text layers every RoomPlan app can share ───────────────────────────────
# Built here in the layout two real exports had (roomplan_import.py's note): a layer per element with its category and
# UUID in customData, the parametric form a unit cube scaled to its width and height, the mesh form its points, each
# with `matrix4d xformOp:transform` (rows right, up, normal, position), and a root layer naming the room.
def _usd_matrix(tf: list[float]) -> str:
    return "( " + ", ".join("(" + ", ".join(repr(float(v)) for v in tf[i:i + 4]) + ")" for i in (0, 4, 8, 12)) + " )"


def _usd_layer(name: str, category: str, uid: str, tf: list[float], dims: list[float], mesh: bool, grow: float = 0.0) -> str:
    head = (f'#usda 1.0\ndef Xform "{name}" (\n    customData = {{\n        string Category = "{category}"\n'
            f'        string UUID = "{uid}"\n    }}\n)\n{{\n')
    if not mesh:
        return head + (f'    def Cube "{name}"\n    {{\n        double size = 1\n        double3 xformOp:scale = ({dims[0]}, {dims[1]}, {dims[2] or 0.0001})\n'
                       f"        matrix4d xformOp:transform = {_usd_matrix(tf)}\n    }}\n}}\n")
    hw, hh = dims[0] / 2 + grow, dims[1] / 2
    dz = -(dims[2] or 0.16)
    pts = [(-hw, -hh, 0), (hw, -hh, 0), (hw, hh, 0), (-hw, hh, 0), (-hw, -hh, dz), (hw, -hh, dz), (hw, hh, dz), (-hw, hh, dz)]
    return head + (f'    def Mesh "{name}"\n    {{\n        int[] faceVertexIndices = [0, 1, 2, 0, 2, 3, 4, 6, 5, 4, 7, 6]\n'
                   f"        point3f[] points = [{', '.join(str(p) for p in pts)}]\n"
                   f"        matrix4d xformOp:transform = {_usd_matrix(tf)}\n    }}\n}}\n")


def _usdz(doc: dict, forms=("Parametric", "Mesh", "Model"), section="kitchen0") -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_STORED) as z:
        z.writestr("Room.usda", '#usda 1.0\ndef Xform "Room"\n{\n    def Xform "Section_grp" (\n        kind = "group"\n    )\n    {\n'
                   f'        def Xform "{section}" (\n            kind = "assembly"\n        )\n        {{\n'
                   "            matrix4d xformOp:transform = ( (1, 0, 0, 0), (0, 1, 0, 0), (0, 0, 1, 0), (2.0, 0.7, 1.5, 1) )\n        }\n    }\n}\n")
        n = 0
        for key, cat in (("walls", "Wall"), ("doors", "Door(Isopen: True)"), ("windows", "Window"), ("floors", "Floor"), ("objects", "Table")):
            for el in doc.get(key) or []:
                n += 1
                for form in forms:
                    mesh = form != "Parametric" or key == "floors"
                    grow = 0.16 if mesh and key == "walls" else 0.0
                    z.writestr(f"assets/{form}/{cat[:4]}/{cat[:4]}{n}.usda", _usd_layer(f"{cat[:4]}{n}", cat, f"UUID-{n}", el["transform"], el["dimensions"], mesh, grow))
        z.writestr("assets/Model/Table/Table.rooms.usdc", b"PXR-USDC binary, never read")
    return buf.getvalue()


def test_a_usdz_reads_as_the_same_rooms_walls_and_openings_as_its_json():
    from custom_components.padspan_ha.roomplan_import import parse_usdz
    doc = _room(1.0, 2.0, 4.0, 3.0)
    j, u = parse_roomplan(_bytes(doc)), parse_roomplan(_usdz(doc))        # the one door: a zip goes to parse_usdz
    assert u["rooms"] == j["rooms"] and u["rooms"][0]["name"] == "Kitchen"
    key = lambda xs: sorted(json.dumps(x, sort_keys=True) for x in xs)  # noqa: E731
    assert key(u["walls"]) == key(j["walls"]) and len(u["walls"]) == 4, "each element once, its exact form"
    assert key(u["openings"]) == key(j["openings"]) and {o["kind"] for o in u["openings"]} == {"door", "window"}
    assert [o["is_open"] for o in u["openings"] if o["kind"] == "door"] == [True]
    assert len(u["objects"]) == 1 and u["objects"][0]["category"] == "table" and u["heights_m"] == [2.5]
    # Only the mesh form in the file (an app that packs no parametric one): walls a thickness long at each end, the
    # room the same.
    m = parse_usdz(_usdz(doc, forms=("Mesh",)))
    assert len(m["walls"]) == 4 and sorted(round(math.dist(w["a_m"], w["b_m"]), 2) for w in m["walls"]) == [3.32, 3.32, 4.32, 4.32]
    assert _ring_set(m["rooms"][0]["points_m"]) == _ring_set(j["rooms"][0]["points_m"])


def test_a_zip_that_is_no_room_scan_is_refused_plainly():
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("model.usda", "#usda 1.0\ndef Mesh \"scan\"\n{\n}\n")
    with pytest.raises(RoomPlanParseError, match="No walls or floors"):
        parse_roomplan(buf.getvalue())


def test_a_scan_is_turned_to_its_walls_and_drawn_to_scale():
    from custom_components.padspan_ha import maps_store as MS
    from custom_components.padspan_ha.roomplan_import import plan_frame
    doc = _room(0.0, 0.0, 4.0, 3.0)
    # The phone pointed 25 degrees off the walls: every transform turned about the origin.
    c, s = math.cos(math.radians(25)), math.sin(math.radians(25))

    def turn(tf):
        out = list(tf)
        for i in (0, 4, 8, 12):
            x, z = tf[i], tf[i + 2]
            out[i], out[i + 2] = x * c - z * s, x * s + z * c
        return out

    for key in ("walls", "doors", "windows", "floors", "objects"):
        for el in doc[key]:
            el["transform"] = turn(el["transform"])
    f = plan_frame(parse_roomplan(_usdz(doc)))
    assert (f["across_m"], f["down_m"]) in ((5.0, 4.0), (4.0, 5.0)), "the room's 4 x 3 m and half a metre round it, whichever way up"
    assert all(abs(a[0] - b[0]) < 0.002 or abs(a[1] - b[1]) < 0.002 for a, b in f["walls"]), "every wall along an axis"
    assert len(f["rooms"]) == 1 and len(f["openings"]) == 2
    png, w, h = MS.scan_plan_png(f)
    assert (w, h) == (round(f["across_m"] * 100), round(f["down_m"] * 100)) and MS._decode_png_to_rgba(png, w, h) is not None
    assert plan_frame({"walls": [], "rooms": []}) is None


# ── Tuned against fourteen real exports (2026-11-16) ─────────────────────────────────────────────────────────────────
def _l_floor_layer(thick: float) -> str:
    """An L-shaped floor as RoomPlan's mesh has it: its top face at z = 0 as triangles, its underside `thick` below
    (0.0001 m in the parametric form: the underside must not be taken for the top), a corner repeated per triangle."""
    top = [(-2, -1.5), (2, -1.5), (2, 0.5), (0, 0.5), (0, 1.5), (-2, 1.5)]
    tris = [(0, 1, 2), (0, 2, 3), (0, 3, 4), (0, 4, 5)]
    pts, idx = [], []
    for z, flip in ((0.0, False), (-thick, True)):
        for a, b, c in tris:
            idx += [len(pts) + k for k in ((0, 2, 1) if flip else (0, 1, 2))]
            pts += [(top[a][0], top[a][1], z), (top[b][0], top[b][1], z), (top[c][0], top[c][1], z)]
    return ('#usda 1.0\ndef Xform "Floor0" (\n    customData = {\n        string Category = "Floor"\n        string UUID = "F-1"\n    }\n)\n{\n'
            f'    def Mesh "Floor0"\n    {{\n        int[] faceVertexIndices = [{", ".join(map(str, idx))}]\n'
            f"        point3f[] points = [{', '.join(str(p) for p in pts)}]\n"
            f"        matrix4d xformOp:transform = {_usd_matrix(_floor_tf(5.0, 5.0))}\n    }}\n}}\n")


@pytest.mark.parametrize("thick", [0.0001, 0.16], ids=["parametric", "mesh"])
def test_an_l_shaped_floor_keeps_its_six_corners_in_a_usdz(thick):
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("assets/Parametric/Floors/Floor0.usda", _l_floor_layer(thick))
    room = parse_roomplan(buf.getvalue())["rooms"][0]["points_m"]
    assert _ring_set(room) == {(3.0, 3.5), (7.0, 3.5), (7.0, 5.5), (5.0, 5.5), (5.0, 6.5), (3.0, 6.5)}, room


def test_the_walls_heights_come_with_either_file_and_say_a_sloped_ceiling():
    doc = _room()
    doc["walls"][1]["dimensions"][1] = 3.6            # one wall taller: a sloped or stepped ceiling
    assert parse_roomplan(_bytes(doc))["heights_m"] == [2.5, 3.6] == parse_roomplan(_usdz(doc))["heights_m"]


def test_a_file_with_nothing_to_draw_is_refused_as_no_room_scan():
    """Seen: another tool's own JSON, walls as size/position/rotation under the same key names."""
    other = {"format": "blueprint", "rooms": [{"name": "Hall", "center": {"x": 0, "y": 0}}], "walls": [{"id": "w1", "size": {"w": 3}, "transform": [1] * 16}]}
    with pytest.raises(RoomPlanParseError, match="isn't a RoomPlan export") as err:
        parse_roomplan(_bytes(other))
    assert err.value.code == "not_scan"
    with pytest.raises(RoomPlanParseError) as err:
        parse_roomplan(b"{not json")
    assert err.value.code == "unreadable"


def test_the_furniture_is_turned_with_the_plan_and_drawn_faintly():
    from custom_components.padspan_ha import maps_store as MS
    from custom_components.padspan_ha.roomplan_import import plan_frame
    f = plan_frame(parse_roomplan(_usdz(_room(0.0, 0.0, 4.0, 3.0))))
    assert len(f["objects"]) == 1 and f["objects"][0]["category"] == "table" and f["objects"][0]["center_m"] == [2.5, 2.0], f["objects"]
    png, w, h = MS.scan_plan_png(f)
    rgba = MS._decode_png_to_rgba(png, w, h)
    grey = lambda x, y: rgba[(y * w + x) * 4]  # noqa: E731
    cx, cy, half = 250, 200, 60                      # the table: 1.2 m across at 100 px a metre, round (2.5, 2.0)
    assert grey(cx - half, cy) == 0xB8 and grey(cx + half, cy) == 0xB8 and grey(cx + 10, cy + 13) == 0xFF, "its outline, not filled"
    assert grey(50, 200) == 0x28 or grey(51, 200) == 0x28, "a wall stays the darkest thing on the plan"


# ── A file from anywhere (review 2026-11-16) ─────────────────────────────────────────────────────────────────────────
def test_a_zip_that_lies_about_its_size_is_never_inflated_whole():
    """A member declaring 1,000 bytes and holding 60 MB: no more than a layer may hold is ever read."""
    import struct
    import tracemalloc
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("big.usda", b" " * 60_000_000)
    raw = bytearray(buf.getvalue())
    for sig, off in ((b"PK\x03\x04", 22), (b"PK\x01\x02", 24)):          # the local header's and the directory's size
        at = raw.index(sig)
        raw[at + off:at + off + 4] = struct.pack("<I", 1000)
    tracemalloc.start()
    with pytest.raises(RoomPlanParseError):
        parse_roomplan(bytes(raw))
    peak = tracemalloc.get_traced_memory()[1]
    tracemalloc.stop()
    assert peak < 20_000_000, peak
    # One honestly over a layer's size is refused by its declared size, unread.
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("big.usda", b" " * 2_100_000)
    with pytest.raises(RoomPlanParseError, match="too large"):
        parse_roomplan(buf.getvalue())


@pytest.mark.parametrize("text", [
    'string Category = "' + "a" * 300_000,
    "def Cube\n" + "double3 xformOp:scale = (" * 40_000,
    "matrix4d xformOp:transform = ( (" * 40_000,
    'string Category = "Wall"\nmatrix4d xformOp:transform = ( (1, 0, 0, 0), (0, 1, 0, 0), (0, 0, 1, 0), (0, 0, 0, 1) )\n' + "point3f[] points = [" * 60_000,
    "Section_grp " + 'def Xform "a" ' * 80_000,
], ids=["category", "scale", "matrix", "points", "sections"])
def test_hostile_layers_are_read_in_linear_time(text):
    import time
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("a.usda", text)
    t = time.perf_counter()
    with pytest.raises(RoomPlanParseError):
        parse_roomplan(buf.getvalue())
    assert time.perf_counter() - t < 2.0


def test_a_damaged_member_is_skipped_and_the_rest_still_read():
    good = _usdz(_room(0.0, 0.0, 4.0, 3.0), forms=("Parametric",))
    buf = io.BytesIO(good)
    with zipfile.ZipFile(buf, "a", zipfile.ZIP_DEFLATED) as z:
        z.writestr("assets/Parametric/Wall/broken.usda", "x" * 5000)
    raw = bytearray(buf.getvalue())
    body = raw.index(b"broken.usda") + len(b"broken.usda")   # the local header's name, then its stream
    raw[body:body + 8] = b"\xff" * 8                         # its compressed stream, spoiled
    out = parse_roomplan(bytes(raw))
    assert len(out["walls"]) == 4 and len(out["rooms"]) == 1


def test_furniture_with_no_walls_is_still_a_scan_for_the_3d_import():
    doc = _room()
    doc["walls"], doc["floors"] = [], []
    out = parse_roomplan(_bytes(doc))
    assert out["rooms"] == [] and len(out["objects"]) == 1 and out["walls"] == []


# ── Autoplace (2026-11-16): a scan put where its outline fits a floor's drawn rooms ──────────────────────────────────
def _scan_of(poly, turn_deg=0.0, shift=(0.0, 0.0), doors=()):
    """A scan of one room whose outline in the house is `poly`, as a phone that started elsewhere and pointed another
    way would have it, put through plan_frame (its own frame: walls along the axes, half a metre round it)."""
    from custom_components.padspan_ha.roomplan_import import plan_frame
    c, s = math.cos(math.radians(turn_deg)), math.sin(math.radians(turn_deg))
    mv = lambda p: [p[0] * c - p[1] * s + shift[0], p[0] * s + p[1] * c + shift[1]]  # noqa: E731
    q = [mv(p) for p in poly]
    return plan_frame({"walls": [{"a_m": q[i - 1], "b_m": q[i]} for i in range(len(q))], "rooms": [{"name": None, "points_m": q}],
                       "openings": [{"kind": "door", "a_m": mv(a), "b_m": mv(b)} for a, b in doors], "objects": []})


def _landed(frame, fit):
    c, s = math.cos(fit["rotation_rad"]), math.sin(fit["rotation_rad"])
    return [[fit["origin_x_m"] + p[0] * c - p[1] * s, fit["origin_y_m"] + p[0] * s + p[1] * c] for p in frame["rooms"][0]["points_m"]]


_HOUSE = {"Kitchen": [[10, 5], [14, 5], [14, 8], [10, 8]],                              # 4 x 3
          "Living": [[14, 5], [20.5, 5], [20.5, 9.5], [14, 9.5]],                       # 6.5 x 4.5
          "Den": [[10, 8], [13, 8], [13, 10], [12, 10], [12, 12], [10, 12]]}            # an L


@pytest.mark.parametrize("name,turn,shift", [("Kitchen", 25, (-30, 12)), ("Living", 200, (7, -40)), ("Den", 118, (55, 3))])
def test_a_scan_is_placed_on_the_drawn_room_it_fits(name, turn, shift):
    from custom_components.padspan_ha.roomplan_import import autoplace
    f = _scan_of(_HOUSE[name], turn, shift)
    fit = autoplace(f, _HOUSE)
    assert fit and fit["room"] == name and fit["score"] >= 0.9, fit
    land = _landed(f, fit)
    off = max(min(math.dist(l, p) for p in _HOUSE[name]) for l in land)
    if name == "Den":
        assert off < 0.2 and fit["fits_both_ways"] is False, (off, fit)          # an L fits one way only
    else:
        assert fit["fits_both_ways"] is True, fit                               # a plain rectangle fits turned round too
        assert sorted(fit["size_scan_m"]) == pytest.approx(sorted(fit["size_room_m"]), abs=0.05)


def test_the_doors_say_which_way_round_and_a_room_off_square_is_still_placed():
    from custom_components.padspan_ha.roomplan_import import autoplace
    door = ([10.5, 5], [11.4, 5])                                # the Kitchen's door, near one end of its long wall
    f = _scan_of(_HOUSE["Kitchen"], 25, (-30, 12), doors=[door])
    fit = autoplace(f, _HOUSE, [list(door)])
    assert fit and fit["room"] == "Kitchen" and fit["fits_both_ways"] is False
    c, s = math.cos(fit["rotation_rad"]), math.sin(fit["rotation_rad"])
    o = f["openings"][0]
    mid = [(o["a_m"][0] + o["b_m"][0]) / 2, (o["a_m"][1] + o["b_m"][1]) / 2]
    at = [fit["origin_x_m"] + mid[0] * c - mid[1] * s, fit["origin_y_m"] + mid[0] * s + mid[1] * c]
    assert math.dist(at, [10.95, 5]) < 0.3, at
    # A room drawn seven degrees off its plan's axes (a plan placed a little turned): still its own room, in place.
    t = math.radians(7)
    skew = {"Suite": [[30 + x * math.cos(t) - y * math.sin(t), 30 + x * math.sin(t) + y * math.cos(t)] for x, y in ((0, 0), (5, 0), (5, 2), (3, 2), (3, 4), (0, 4))],
            "Hall": [[40, 30], [42, 30], [42, 38], [40, 38]]}
    f2 = _scan_of(skew["Suite"], 140, (3, 3))
    fit2 = autoplace(f2, skew)
    assert fit2 and fit2["room"] == "Suite"
    assert max(min(math.dist(l, p) for p in skew["Suite"]) for l in _landed(f2, fit2)) < 0.25


def test_a_scan_that_fits_nowhere_or_two_rooms_alike_is_not_placed():
    from custom_components.padspan_ha.roomplan_import import autoplace
    twins = {"Bed 1": [[0, 0], [4, 0], [4, 3], [0, 3]], "Bed 2": [[10, 0], [14, 0], [14, 3], [10, 3]]}
    assert autoplace(_scan_of(twins["Bed 1"], 30, (9, 9)), twins) is None, "two rooms alike: it can't be told which"
    assert autoplace(_scan_of([[0, 0], [9, 0], [9, 7], [0, 7]]), _HOUSE) is None, "no drawn room of its size"
    assert autoplace(_scan_of([[0, 0], [2.5, 0], [2.5, 6], [0, 6]]), _HOUSE) is None, "about a room's area, not its shape"
    assert autoplace(_scan_of(_HOUSE["Kitchen"]), {}) is None and autoplace({"walls": [], "rooms": []}, _HOUSE) is None


def test_a_plan_is_fitted_to_another_floor_only_where_it_is_no_guess():
    """Align's "Suggest a fit" (fit_to_floor, 2026-11-16): a floor's rooms over the floor below share the outside
    walls; one room alone, or a floor smaller than the plan, is never suggested."""
    from custom_components.padspan_ha import roomplan_import as RP
    below = {"A": [[0, 0], [6, 0], [6, 5], [0, 5]], "B": [[6, 0], [11, 0], [11, 5], [6, 5]], "C": [[0, 5], [11, 5], [11, 9], [0, 9]]}
    # The floor above, in its plan's own metres from the plan's corner (a 1 m margin): the same outside walls, other rooms inside.
    above = {"X": [[1, 1], [5, 1], [5, 10], [1, 10]], "Y": [[5, 1], [12, 1], [12, 6], [5, 6]], "Z": [[5, 6], [12, 6], [12, 10], [5, 10]]}
    fit = RP.fit_to_floor(above, below)
    assert fit and abs(fit["origin_x_m"] + 1) <= 0.15 and abs(fit["origin_y_m"] + 1) <= 0.15 and fit["rotation_rad"] == 0, fit
    assert RP.fit_to_floor({"X": above["X"]}, below) is None, "one room is a guess"
    assert RP.fit_to_floor(above, {"A": below["A"], "B": below["B"]}) is None, "the other floor needs three rooms"
    assert RP.fit_to_floor(above, {k: [[p[0] / 3, p[1] / 3] for p in v] for k, v in below.items()}) is None, "a floor smaller than the plan"
