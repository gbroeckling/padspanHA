"""evidence_diagram.js — the object detail modal's "why is it here" diagram
and room-probability bars (gap #2 of the best-in-class roadmap,
docs/BEST_IN_CLASS_ROADMAP.md).

Both exports are pure string/data builders with no DOM dependency at all —
deliberately not the iso map's isometric projection, so there is nothing
here that needs tests/js/dom_shim.mjs.

Skipped (not failed) when node is unavailable.
"""
from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path

import pytest

_ROOT = Path(__file__).resolve().parents[1]
_VIEWS = _ROOT / "custom_components" / "padspan_ha" / "www" / "padspan-ha" / "views"
_NODE = shutil.which("node")

pytestmark = pytest.mark.skipif(_NODE is None, reason="node is not installed")


def _run(tmp_path: Path, script_body: str) -> dict:
    shutil.copy(_VIEWS / "evidence_diagram.js", tmp_path / "evidence_diagram.mjs")
    script = "const ED = await import('./evidence_diagram.mjs');\n" + script_body
    (tmp_path / "run.mjs").write_text(script, encoding="utf-8")
    res = subprocess.run([_NODE, str(tmp_path / "run.mjs")], capture_output=True,
                         text=True, encoding="utf-8", timeout=60)
    assert res.returncode == 0, f"node failed:\n{res.stderr[-4000:]}"
    return json.loads(res.stdout.strip().splitlines()[-1])


# ── buildEvidenceSvg ─────────────────────────────────────────────────────────

def test_a_ring_is_drawn_for_every_scanner_with_a_position_and_a_distance(tmp_path):
    out = _run(tmp_path, (
        "const svg = ED.buildEvidenceSvg({"
        "objXY: [1, 1],"
        "scanners: ["
        "  {source:'s1', name:'Kitchen RX', x_m:0, y_m:0, distance_m:2.0},"
        "  {source:'s2', name:'Hall RX', x_m:3, y_m:0, distance_m:1.5},"
        "]});\n"
        "console.log(JSON.stringify({"
        "  ringCount: (svg.match(/stroke-dasharray=\"5,4\"/g)||[]).length,"
        "  hasKitchen: svg.includes('Kitchen RX'), hasHall: svg.includes('Hall RX'),"
        "  hasSvg: svg.startsWith('<svg'),"
        "}));\n"
    ))
    assert out["ringCount"] == 2, out
    assert out["hasKitchen"] and out["hasHall"], out
    assert out["hasSvg"], out


def test_a_scanner_with_no_position_is_skipped_not_placed_at_origin(tmp_path):
    out = _run(tmp_path, (
        "const svg = ED.buildEvidenceSvg({"
        "objXY: null,"
        "scanners: ["
        "  {source:'s1', name:'Known', x_m:0, y_m:0, distance_m:2.0},"
        "  {source:'s2', name:'Unknown position'},"  # no x_m/y_m at all
        "]});\n"
        "console.log(JSON.stringify({"
        "  hasKnown: svg.includes('Known'), hasUnknown: svg.includes('Unknown position'),"
        "}));\n"
    ))
    assert out["hasKnown"], out
    assert not out["hasUnknown"], "a scanner with no known position has nothing to draw and must not appear"


def test_no_placeable_scanner_and_no_object_position_returns_empty(tmp_path):
    out = _run(tmp_path, (
        "const svg = ED.buildEvidenceSvg({objXY: null, scanners: [{source:'s1', name:'x'}]});\n"
        "console.log(JSON.stringify({svg}));\n"
    ))
    assert out["svg"] == "", "nothing placeable means nothing to draw, not an empty/broken svg shell"


def test_missing_scanners_array_does_not_throw(tmp_path):
    out = _run(tmp_path, (
        "const svg1 = ED.buildEvidenceSvg({});\n"
        # No scanners at all, but the object's own position is still one
        # placeable point — drawing just its dot is correct, not empty.
        "const svg2 = ED.buildEvidenceSvg({objXY: [0, 0]});\n"
        "console.log(JSON.stringify({svg1, svg2startsWithSvg: svg2.startsWith('<svg')}));\n"
    ))
    assert out["svg1"] == "", out
    assert out["svg2startsWithSvg"], out


def test_scanner_names_are_xml_escaped(tmp_path):
    out = _run(tmp_path, (
        "const svg = ED.buildEvidenceSvg({"
        "objXY: null,"
        "scanners: [{source:'s1', name:'A & B <rx>', x_m:0, y_m:0, distance_m:1}]});\n"
        "console.log(JSON.stringify({hasRaw: svg.includes('A & B <rx>'), hasEscaped: svg.includes('A &amp; B &lt;rx&gt;')}));\n"
    ))
    assert not out["hasRaw"] and out["hasEscaped"], out


# ── roomScoreBars ────────────────────────────────────────────────────────────

def test_room_scores_sort_highest_first_as_whole_percent(tmp_path):
    out = _run(tmp_path, (
        "const bars = ED.roomScoreBars({Kitchen: 0.7, Hallway: 0.2, Office: 0.1});\n"
        "console.log(JSON.stringify(bars));\n"
    ))
    assert out == [
        {"room": "Kitchen", "pct": 70},
        {"room": "Hallway", "pct": 20},
        {"room": "Office", "pct": 10},
    ]


def test_room_scores_empty_or_missing_input_yields_no_bars(tmp_path):
    out = _run(tmp_path, (
        "console.log(JSON.stringify({"
        "  a: ED.roomScoreBars({}), b: ED.roomScoreBars(null), c: ED.roomScoreBars(undefined),"
        "}));\n"
    ))
    assert out == {"a": [], "b": [], "c": []}


def test_room_scores_clamps_out_of_range_fractions(tmp_path):
    out = _run(tmp_path, (
        "const bars = ED.roomScoreBars({Over: 1.4, Under: -0.2});\n"
        "console.log(JSON.stringify(bars));\n"
    ))
    assert out == [{"room": "Over", "pct": 100}, {"room": "Under", "pct": 0}]
