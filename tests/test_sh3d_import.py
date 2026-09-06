"""Unit tests for sh3d_import.py (gap #7 tier 1 of the best-in-class
roadmap, docs/BEST_IN_CLASS_ROADMAP.md).

No real exported .sh3d file was available during development — these tests
build synthetic ZIP+XML fixtures against the VERIFIED official DTD
(https://www.sweethome3d.com/SweetHome3D.dtd), not a guessed schema. The
first real-world import is the true validation of this parser.
"""
from __future__ import annotations

import io
import zipfile

import pytest

from custom_components.padspan_ha.sh3d_import import Sh3dParseError, parse_sh3d


def _make_sh3d(home_xml: str, entry_name: str = "Home.xml") -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        zf.writestr(entry_name, home_xml)
    return buf.getvalue()


_TWO_ROOM_HOME = """<?xml version="1.0" encoding="UTF-8"?>
<home>
  <level id="lvl0" name="Ground Floor" elevation="0" floorThickness="12" height="250"/>
  <room name="Kitchen" level="lvl0">
    <point x="0" y="0"/>
    <point x="500" y="0"/>
    <point x="500" y="400"/>
    <point x="0" y="400"/>
  </room>
  <room name="Hallway" level="lvl0">
    <point x="500" y="0"/>
    <point x="700" y="0"/>
    <point x="700" y="400"/>
  </room>
</home>"""


def test_parses_rooms_and_converts_centimetres_to_metres():
    result = parse_sh3d(_make_sh3d(_TWO_ROOM_HOME))
    assert result["warnings"] == []
    assert len(result["rooms"]) == 2
    kitchen = next(r for r in result["rooms"] if r["name"] == "Kitchen")
    assert kitchen["points_m"] == [[0.0, 0.0], [5.0, 0.0], [5.0, 4.0], [0.0, 4.0]]
    assert kitchen["level_id"] == "lvl0"


def test_level_elevation_converts_centimetres_to_metres():
    xml = """<home><level id="l1" name="Upstairs" elevation="300" floorThickness="12" height="250"/></home>"""
    result = parse_sh3d(_make_sh3d(xml))
    assert result["levels"] == [{"id": "l1", "name": "Upstairs", "elevation_m": 3.0}]


def test_a_room_with_no_level_attribute_has_a_null_level_id():
    xml = """<home>
      <level id="l1" name="Main" elevation="0" floorThickness="12" height="250"/>
      <room name="Solo">
        <point x="0" y="0"/><point x="100" y="0"/><point x="100" y="100"/>
      </room>
    </home>"""
    result = parse_sh3d(_make_sh3d(xml))
    assert result["rooms"][0]["level_id"] is None
    assert result["warnings"] == []


def test_a_room_referencing_an_unknown_level_is_kept_but_warned_about():
    xml = """<home>
      <room name="Orphan" level="ghost">
        <point x="0" y="0"/><point x="100" y="0"/><point x="100" y="100"/>
      </room>
    </home>"""
    result = parse_sh3d(_make_sh3d(xml))
    assert len(result["rooms"]) == 1
    assert result["rooms"][0]["level_id"] is None
    assert any("unknown level" in w for w in result["warnings"])


def test_a_room_with_fewer_than_three_points_is_skipped_with_a_warning():
    xml = """<home>
      <room name="Sliver"><point x="0" y="0"/><point x="1" y="1"/></room>
    </home>"""
    result = parse_sh3d(_make_sh3d(xml))
    assert result["rooms"] == []
    assert any("Sliver" in w and "fewer than 3" in w for w in result["warnings"])


def test_a_room_with_non_numeric_coordinates_is_skipped_not_crashed_on():
    xml = """<home>
      <room name="Bad"><point x="abc" y="0"/><point x="1" y="1"/><point x="2" y="2"/></room>
    </home>"""
    result = parse_sh3d(_make_sh3d(xml))
    assert result["rooms"] == []
    assert any("Bad" in w for w in result["warnings"])


def test_a_file_with_no_rooms_warns_clearly():
    xml = """<home><level id="l1" name="Empty" elevation="0" floorThickness="12" height="250"/></home>"""
    result = parse_sh3d(_make_sh3d(xml))
    assert result["rooms"] == []
    assert any("No rooms" in w for w in result["warnings"])


def test_not_a_zip_raises_a_clear_error():
    with pytest.raises(Sh3dParseError, match="not a ZIP"):
        parse_sh3d(b"this is definitely not a zip file")


def test_a_zip_with_no_home_entry_at_all_raises():
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        zf.writestr("readme.txt", "hello")
    with pytest.raises(Sh3dParseError, match="no Home.xml entry"):
        parse_sh3d(buf.getvalue())


def test_a_legacy_pre_2016_file_raises_a_specific_unsupported_error():
    """A ZIP with only the old java-serialized "Home" entry (no extension)
    must not be silently mis-parsed as XML or deserialized as Java."""
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        zf.writestr("Home", b"\xac\xed\x00\x05not-really-java-but-not-xml-either")
    with pytest.raises(Sh3dParseError, match="predates Sweet Home 3D 5.3"):
        parse_sh3d(buf.getvalue())


def test_invalid_xml_content_raises_a_clear_error():
    with pytest.raises(Sh3dParseError, match="not valid XML"):
        parse_sh3d(_make_sh3d("<home><room>not closed"))


def test_an_unexpected_root_element_raises():
    with pytest.raises(Sh3dParseError, match="expected <home>"):
        parse_sh3d(_make_sh3d("<notahome/>"))


def test_points_are_kept_in_document_order():
    xml = """<home><room name="R">
      <point x="0" y="0"/><point x="300" y="0"/><point x="300" y="200"/><point x="0" y="200"/>
    </room></home>"""
    result = parse_sh3d(_make_sh3d(xml))
    assert result["rooms"][0]["points_m"] == [[0.0, 0.0], [3.0, 0.0], [3.0, 2.0], [0.0, 2.0]]
