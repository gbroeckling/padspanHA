# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""Live Aboard P7: a Sweet Home 3D file's doors, windows and furniture
(sh3d_import.parse_sh3d_furniture).

Plan: docs/IDEA_ATLAS_3D_HOUSE.md ("P7 Import"). Synthetic .sh3d fixtures
(a ZIP with a Home.xml), as tests/test_sh3d_import.py builds them. Held here:
- doors, windows and furniture read in metres and degrees, at their levels,
  through the same plain cm → m the room import uses (pieces land where the
  rooms land);
- groups read piece by piece; unknown levels, bad numbers, no size: left
  out or unassigned, each with a reason, never silently;
- the room import's caps and refusals refuse here the same way, and only
  Home.xml is ever read from the archive;
- the room import itself is unchanged by any of it.
"""

from __future__ import annotations

import io
import math
import zipfile

import pytest

from custom_components.padspan_ha import sh3d_import as S
from custom_components.padspan_ha.sh3d_import import Sh3dParseError, parse_sh3d, parse_sh3d_furniture


def _make_sh3d(home_xml: str, extra: dict[str, bytes] | None = None) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("Home.xml", home_xml)
        for name, data in (extra or {}).items():
            zf.writestr(name, data)
    return buf.getvalue()


_ROOMS = """
  <level id="lvl0" name="Ground Floor" elevation="0" floorThickness="12" height="250"/>
  <level id="lvl1" name="Upstairs" elevation="262" floorThickness="12" height="250"/>
  <room name="Living" level="lvl0">
    <point x="0" y="0"/><point x="500" y="0"/><point x="500" y="400"/><point x="0" y="400"/>
  </room>
  <room name="Bedroom" level="lvl1">
    <point x="0" y="0"/><point x="400" y="0"/><point x="400" y="300"/><point x="0" y="300"/>
  </room>"""

_FURNISHED = """
  <doorOrWindow level="lvl0" name="Front door" catalogId="eTeks#frontDoor" x="250" y="400"
                elevation="0" angle="0" width="91.5" depth="20" height="208"/>
  <doorOrWindow level="lvl1" name="Window" x="0" y="150" elevation="90" angle="1.5707963267948966"
                width="120" depth="15" height="120"/>
  <pieceOfFurniture level="lvl0" name="Corner sofa" catalogId="Scopia#sofa" x="200" y="150" elevation="0"
                    angle="3.141592653589793" width="220" depth="90" height="80"/>
  <light level="lvl0" name="Ceiling light" x="250" y="200" elevation="240" width="30" depth="30" height="10"/>
  <pieceOfFurniture level="lvl1" name="Thingamajig" x="120.5" y="80.4" elevation="74" angle="-1.5707963267948966"
                    width="40" depth="30" height="20"/>
  <furnitureGroup name="Dining set" level="lvl1" x="300" y="280" width="160" depth="140" height="90">
    <pieceOfFurniture name="Table" x="300" y="300" width="160" depth="90" height="74"/>
    <pieceOfFurniture name="Chair" level="lvl0" x="300" y="250" width="45" depth="50" height="90"/>
  </furnitureGroup>"""


def _home(body: str) -> str:
    return f'<?xml version="1.0" encoding="UTF-8"?>\n<home version="7000">{body}\n</home>'


def _by_name(items: list[dict], name: str) -> dict:
    return next(i for i in items if i["name"] == name)


# ═══ read in metres and degrees ══════════════════════════════════════════════

def test_doors_windows_and_furniture_in_metres_and_degrees():
    r = parse_sh3d_furniture(_make_sh3d(_home(_ROOMS + _FURNISHED)))
    assert r["warnings"] == [] and r["skipped"] == []
    assert [o["name"] for o in r["openings"]] == ["Front door", "Window"]
    assert [p["name"] for p in r["pieces"]] == ["Corner sofa", "Ceiling light", "Thingamajig", "Table", "Chair"]
    door = _by_name(r["openings"], "Front door")
    assert door == {"tag": "doorOrWindow", "name": "Front door", "catalog": "eTeks#frontDoor", "category": "",
                    "level_id": "lvl0", "x_m": 2.5, "y_m": 4.0, "width_m": 0.915, "depth_m": 0.2, "height_m": 2.08,
                    "elevation_m": 0.0, "angle_deg": 0.0}
    win = _by_name(r["openings"], "Window")
    assert (win["level_id"], win["elevation_m"], win["height_m"], win["angle_deg"]) == ("lvl1", 0.9, 1.2, 90.0)
    sofa = _by_name(r["pieces"], "Corner sofa")
    assert (sofa["tag"], sofa["catalog"], sofa["x_m"], sofa["y_m"]) == ("pieceOfFurniture", "Scopia#sofa", 2.0, 1.5)
    assert (sofa["width_m"], sofa["depth_m"], sofa["height_m"], sofa["angle_deg"]) == (2.2, 0.9, 0.8, 180.0)
    light = _by_name(r["pieces"], "Ceiling light")
    assert (light["tag"], light["elevation_m"]) == ("light", 2.4)
    odd = _by_name(r["pieces"], "Thingamajig")
    assert (odd["x_m"], odd["y_m"], odd["elevation_m"], odd["angle_deg"]) == (1.205, 0.804, 0.74, 270.0)


def test_the_levels_are_the_room_imports_own():
    data = _make_sh3d(_home(_ROOMS + _FURNISHED))
    assert parse_sh3d_furniture(data)["levels"] == parse_sh3d(data)["levels"] == [
        {"id": "lvl0", "name": "Ground Floor", "elevation_m": 0.0},
        {"id": "lvl1", "name": "Upstairs", "elevation_m": 2.62}]


def test_pieces_go_through_the_same_transform_as_the_rooms():
    """A piece at a room's corner lands on that corner's metres: the same
    plain division by 100, no offset, no flip (both plans run y-down)."""
    body = _ROOMS + """
      <pieceOfFurniture level="lvl0" name="At the corner" x="500" y="400" width="10" depth="10" height="10"/>
      <doorOrWindow level="lvl0" name="At the origin" x="0" y="0" width="80" depth="10" height="200"/>"""
    data = _make_sh3d(_home(body))
    living = next(rm for rm in parse_sh3d(data)["rooms"] if rm["name"] == "Living")
    f = parse_sh3d_furniture(data)
    assert [f["pieces"][0]["x_m"], f["pieces"][0]["y_m"]] == living["points_m"][2] == [5.0, 4.0]
    assert [f["openings"][0]["x_m"], f["openings"][0]["y_m"]] == living["points_m"][0] == [0.0, 0.0]


@pytest.mark.parametrize("angle,deg", [
    ("0", 0.0), ("1.5707963267948966", 90.0), ("3.141592653589793", 180.0), ("-1.5707963267948966", 270.0),
    ("6.283185307179586", 0.0), ("6.2831", 0.0), ("0.7853981633974483", 45.0), ("12.566370614359172", 0.0),
    ("nan", 0.0), ("inf", 0.0), ("abc", 0.0), (None, 0.0),
])
def test_angles_are_degrees_from_0_up_to_360(angle, deg):
    attr = "" if angle is None else f' angle="{angle}"'
    r = parse_sh3d_furniture(_make_sh3d(_home(f'<pieceOfFurniture name="P" x="0" y="0" width="1" depth="1" height="1"{attr}/>')))
    got = r["pieces"][0]["angle_deg"]
    assert 0.0 <= got < 360.0
    assert got == pytest.approx(deg % 360.0, abs=0.05), (angle, got)


def test_elevation_is_the_bottom_above_its_level_and_defaults_to_the_floor():
    body = """<level id="l" name="L" elevation="300" floorThickness="12" height="250"/>
      <pieceOfFurniture level="l" name="Shelf" x="0" y="0" width="80" depth="30" height="20" elevation="150"/>
      <pieceOfFurniture level="l" name="Rug" x="0" y="0" width="200" depth="140" height="1"/>
      <pieceOfFurniture level="l" name="Odd" x="0" y="0" width="1" depth="1" height="1" elevation="high"/>"""
    r = parse_sh3d_furniture(_make_sh3d(_home(body)))
    assert [p["elevation_m"] for p in r["pieces"]] == [1.5, 0.0, 0.0]


# ═══ groups, levels and what is left out ═════════════════════════════════════

def test_a_groups_pieces_come_in_one_by_one_in_its_level():
    r = parse_sh3d_furniture(_make_sh3d(_home(_ROOMS + _FURNISHED)))
    assert "Dining set" not in [p["name"] for p in r["pieces"]]
    table, chair = _by_name(r["pieces"], "Table"), _by_name(r["pieces"], "Chair")
    assert (table["level_id"], table["x_m"], table["y_m"], table["width_m"]) == ("lvl1", 3.0, 3.0, 1.6)
    assert chair["level_id"] == "lvl0", "a piece's own level wins over its group's"


def test_groups_inside_groups_are_read_and_too_deep_is_left_out_with_a_reason():
    inner = '<pieceOfFurniture name="Deep" x="0" y="0" width="10" depth="10" height="10"/>'
    nested = inner
    for i in range(3):
        nested = f'<furnitureGroup name="G{i}" x="0" y="0" width="1" depth="1" height="1">{nested}</furnitureGroup>'
    assert [p["name"] for p in parse_sh3d_furniture(_make_sh3d(_home(nested)))["pieces"]] == ["Deep"]
    deep = inner
    for i in range(S.MAX_GROUP_DEPTH + 1):
        deep = f'<furnitureGroup name="G{i}" x="0" y="0" width="1" depth="1" height="1">{deep}</furnitureGroup>'
    r = parse_sh3d_furniture(_make_sh3d(_home(deep)))
    assert r["pieces"] == [] and len(r["skipped"]) == 1 and "deeper than" in r["skipped"][0]["why"]


def test_an_unknown_level_is_kept_unassigned_with_a_warning_like_a_rooms():
    body = """<level id="l0" name="Main" elevation="0" floorThickness="12" height="250"/>
      <pieceOfFurniture level="ghost" name="Lost sofa" x="0" y="0" width="200" depth="90" height="80"/>
      <doorOrWindow name="No level" x="0" y="0" width="80" depth="10" height="200"/>"""
    r = parse_sh3d_furniture(_make_sh3d(_home(body)))
    assert r["pieces"][0]["level_id"] is None and r["openings"][0]["level_id"] is None
    assert len(r["warnings"]) == 1 and "Lost sofa" in r["warnings"][0] and "unknown level 'ghost'" in r["warnings"][0]


@pytest.mark.parametrize("attrs,why", [
    ('x="abc" y="0" width="1" depth="1" height="1"', "its position is not a number"),
    ('y="0" width="1" depth="1" height="1"', "it has no position"),
    ('x="0" y="0" depth="1" height="1"', "it has no width"),
    ('x="0" y="0" width="nan" depth="1" height="1"', "its width is not a number"),
    ('x="0" y="0" width="1" depth="-1" height="1"', "it has no size"),
    ('x="0" y="0" width="1" depth="1" height="0"', "it has no size"),
    ('x="2000000" y="0" width="1" depth="1" height="1"', "it is too far from the rest of the plan"),
])
def test_one_that_cannot_be_read_is_left_out_with_its_reason(attrs, why):
    body = f'<pieceOfFurniture name="Broken" {attrs}/><doorOrWindow name="Broken door" {attrs}/>'
    r = parse_sh3d_furniture(_make_sh3d(_home(body)))
    assert r["pieces"] == [] and r["openings"] == []
    assert r["skipped"] == [{"name": "Broken", "why": why}, {"name": "Broken door", "why": why}]


def test_names_are_one_printable_line_of_at_most_60_characters():
    long = "Sofa\twith\nnewlines " + "x" * 200
    r = parse_sh3d_furniture(_make_sh3d(_home(
        f'<pieceOfFurniture name="{long}" x="0" y="0" width="1" depth="1" height="1"/>'
        '<pieceOfFurniture x="0" y="0" width="1" depth="1" height="1"/>')))
    assert r["pieces"][0]["name"].startswith("Sofa with newlines x") and len(r["pieces"][0]["name"]) == 60
    assert r["pieces"][1]["name"] == ""


def test_other_elements_are_ignored():
    body = _ROOMS + """
      <wall xStart="0" yStart="0" xEnd="500" yEnd="0" thickness="10" height="250"/>
      <label x="10" y="10"><text>Hi</text></label>
      <camera attribute="topCamera" x="0" y="0" z="1000" yaw="0" pitch="1" fieldOfView="1"/>"""
    r = parse_sh3d_furniture(_make_sh3d(_home(body)))
    assert r["pieces"] == [] and r["openings"] == []
    assert r["warnings"] == ["No doors, windows or furniture were found in this file"]


def test_the_caps_leave_the_rest_out_in_one_line_each():
    body = "".join(f'<pieceOfFurniture name="P{i}" x="{i}" y="0" width="10" depth="10" height="10"/>' for i in range(7))
    body += "".join(f'<doorOrWindow name="W{i}" x="{i}" y="0" width="100" depth="10" height="100"/>' for i in range(4))
    r = parse_sh3d_furniture(_make_sh3d(_home(body)), max_pieces=5, max_openings=3)
    assert [p["name"] for p in r["pieces"]] == ["P0", "P1", "P2", "P3", "P4"] and len(r["openings"]) == 3
    assert r["skipped"] == [{"name": "1 more doors and windows", "why": "at most 3 come in at once"},
                            {"name": "2 more pieces", "why": "at most 5 come in at once"}]
    assert (S.MAX_IMPORT_PIECES, S.MAX_IMPORT_OPENINGS) == (1000, 500)


# ═══ the room import's caps and refusals, and nothing but Home.xml ═══════════

def test_not_a_zip_raises_the_room_imports_error():
    with pytest.raises(Sh3dParseError, match="not a ZIP"):
        parse_sh3d_furniture(b"definitely not a zip")


def test_a_zip_with_no_home_xml_or_a_legacy_home_raises():
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        zf.writestr("Home", b"\xac\xed\x00\x05")
    with pytest.raises(Sh3dParseError, match="predates Sweet Home 3D 5.3"):
        parse_sh3d_furniture(buf.getvalue())
    with pytest.raises(Sh3dParseError, match="no Home.xml entry"):
        parse_sh3d_furniture(_make_sh3d("<home/>").replace(b"Home.xml", b"Away.xml"))


def test_a_doctype_is_refused_before_any_entity_is_expanded():
    laughs = ('<?xml version="1.0"?><!DOCTYPE home [<!ENTITY a "aaaaaaaaaa"><!ENTITY b "&a;&a;&a;&a;&a;&a;">]>'
              '<home><pieceOfFurniture name="&b;" x="0" y="0" width="1" depth="1" height="1"/></home>')
    with pytest.raises(Sh3dParseError, match="DOCTYPE"):
        parse_sh3d_furniture(_make_sh3d(laughs))


def test_malformed_xml_and_the_wrong_root_are_refused():
    with pytest.raises(Sh3dParseError, match="not valid XML"):
        parse_sh3d_furniture(_make_sh3d('<home><pieceOfFurniture name="open"'))
    with pytest.raises(Sh3dParseError, match="expected <home>"):
        parse_sh3d_furniture(_make_sh3d('<house><pieceOfFurniture x="0" y="0" width="1" depth="1" height="1"/></house>'))


def test_an_oversized_home_xml_is_refused_before_it_is_read():
    """The room import's zip-bomb cap: Home.xml's own size (50 MB) is read
    from the archive's directory before any of it is inflated."""
    big = "<home>" + " " * (50 * 1024 * 1024) + "</home>"
    with pytest.raises(Sh3dParseError, match="implausibly large"):
        parse_sh3d_furniture(_make_sh3d(big))


def test_only_home_xml_is_ever_read_from_the_archive(monkeypatch):
    """Never a model, a texture, an icon or any other file in the .sh3d."""
    read: list[str] = []
    real = zipfile.ZipFile.read

    def spy(self, name, *a, **kw):
        read.append(name if isinstance(name, str) else name.filename)
        return real(self, name, *a, **kw)

    monkeypatch.setattr(zipfile.ZipFile, "read", spy)
    data = _make_sh3d(_home(_ROOMS + _FURNISHED), extra={"0": b"OBJ model", "icon.png": b"\x89PNG", "tex/oak.jpg": b"\xff\xd8"})
    r = parse_sh3d_furniture(data)
    assert read and set(read) == {"Home.xml"}
    assert len(r["pieces"]) == 5
    flat = repr(r)
    for other in ("OBJ model", "PNG", "oak"):
        assert other not in flat


# ═══ the room import itself is unchanged ═════════════════════════════════════

def test_the_room_import_reads_a_furnished_file_exactly_as_one_without_furniture():
    plain = parse_sh3d(_make_sh3d(_home(_ROOMS)))
    furnished = parse_sh3d(_make_sh3d(_home(_ROOMS + _FURNISHED)))
    assert furnished == plain
    assert set(furnished) == {"levels", "rooms", "warnings"}


def test_the_numbers_out_are_plain_finite_floats():
    r = parse_sh3d_furniture(_make_sh3d(_home(_ROOMS + _FURNISHED)))
    for item in r["openings"] + r["pieces"]:
        for k in ("x_m", "y_m", "width_m", "depth_m", "height_m", "elevation_m", "angle_deg"):
            assert isinstance(item[k], float) and math.isfinite(item[k]), (item["name"], k)
