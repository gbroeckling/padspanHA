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
    (b"PK\x03\x04usdz", "USDZ"),
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
    assert 'fileInput.accept = roomplanOn ? ".sh3d,.json" : ".sh3d";' in js
    assert 'roomplanOn ? "📐 Import floorplan (.sh3d, RoomPlan .json)" : "📐 Import floorplan (.sh3d)"' in js
    # only a .json file, and only while on, goes to the RoomPlan command
    assert ('const parsed = roomplanOn && /\\.json$/i.test(file.name || "")\n'
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
