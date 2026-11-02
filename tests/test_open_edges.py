# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""Open edges: rooms with no wall between them (a loft, one big open space).

An open edge, or no barrier at all, already lets signal through: the solver
and the coverage map add up the attenuation of the barriers a ray crosses
and nothing else. What was missing was the tool, and one rule:

  store   _norm_barrier: material open means attenuation_dbm 0.0, so an
          open wall an old path saved at 6 dB reads as open
  tool    Mapping → Edit → Signal walls: "Open edge: tap a room edge" writes
          an Open (0 dB) barrier with exactly that edge's two vertices from
          room_geometry_m on the map's floor, rail "none"; a shared edge is
          marked once; "Open all edges" does a room (tests/js/open_edges.mjs)
  help    the barrier help and the Live Aboard editor say so, in four languages
"""

from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path

import pytest

from custom_components.padspan_ha.fabric_store import FabricStore

ROOT = Path(__file__).resolve().parents[1]
WWW = ROOT / "custom_components" / "padspan_ha" / "www" / "padspan-ha"


def _bar(**kw):
    return {"name": "Open edge — Loft", "floor_id": "upper", "points_m": [[0, 0], [4, 0]], **kw}


def test_an_open_barrier_saved_at_6_db_reads_as_open():
    out = FabricStore._norm_barrier(_bar(material="open", attenuation_dbm=6))
    assert out["attenuation_dbm"] == 0.0


def test_an_open_barrier_with_no_attenuation_reads_as_open():
    out = FabricStore._norm_barrier(_bar(material="open"))
    assert out["attenuation_dbm"] == 0.0
    assert FabricStore._norm_barrier(_bar(material="Open "))["attenuation_dbm"] == 0.0


def test_other_materials_keep_their_attenuation():
    assert FabricStore._norm_barrier(_bar(material="metal", attenuation_dbm=12))["attenuation_dbm"] == 12
    assert FabricStore._norm_barrier(_bar(material="custom", attenuation_dbm=3))["attenuation_dbm"] == 3
    assert "attenuation_dbm" not in FabricStore._norm_barrier(_bar(material="brick"))


def test_the_tool_s_rail_and_points_survive_the_store():
    """The per-edge rail key is kept as written (none until one is chosen);
    the edge's own vertices are stored as they came, on the floor given."""
    out = FabricStore._norm_barrier(_bar(material="open", attenuation_dbm=0, rail="none"))
    assert out["rail"] == "none"
    assert out["points_m"] == [[0.0, 0.0], [4.0, 0.0]]
    assert out["floor_id"] == "upper"


@pytest.fixture(scope="module")
def got() -> dict:
    node = shutil.which("node")
    if not node:
        pytest.skip("node not installed")
    r = subprocess.run([node, str(ROOT / "tests" / "js" / "open_edges.mjs"), str(ROOT).replace("\\", "/")],
                       capture_output=True, text=True, encoding="utf-8", timeout=120)
    assert r.returncode == 0, r.stderr[-2000:]
    return json.loads(r.stdout.strip().splitlines()[-1])


@pytest.mark.parametrize("prefix", ["render:", "tools:", "stage:", "tap:", "all:"])
def test_the_tool_writes_the_edge_itself_once(got, prefix) -> None:
    mine = {k: v for k, v in got.items() if k.startswith(prefix)}
    assert mine, (prefix, sorted(got))
    bad = {k: v for k, v in mine.items() if not v["ok"]}
    assert not bad, json.dumps(bad, indent=2, ensure_ascii=False)


def test_the_help_says_an_open_edge_already_lets_signal_through() -> None:
    line = "An open edge, or no wall drawn at all, already lets signal through for positioning and coverage"
    assert line in (WWW / "help_content.js").read_text(encoding="utf-8")
    assert line in (WWW / "views" / "maps.js").read_text(encoding="utf-8")
    hint = "No wall between two rooms? Mark that edge open in Mapping → Edit → Signal walls"
    assert hint in (WWW / "help_content.js").read_text(encoding="utf-8")
    assert hint in (WWW / "views" / "live_aboard_edit.js").read_text(encoding="utf-8")
    for lang in ("de", "fr", "nl"):
        keys = json.loads((WWW / "i18n" / lang / "help.json").read_text(encoding="utf-8"))
        assert any(line in k for k in keys), lang
        assert any(hint in k for k in keys), lang
