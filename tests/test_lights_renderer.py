"""The lights map renderer, exercised for real.

Every lights defect in this feature's history shipped because the frontend had
no test at all: the map is JavaScript, the suite is Python, so nothing ever ran
it. These tests execute the actual module under node and assert the behaviours
that were broken — the fabric-only frame, render/drag agreement, and physical
size and rotation, which sat in the storage schema and the save command for
weeks while nothing drew them and nothing could set them.

Skipped (not failed) when node is unavailable, so the suite still runs on a
box without it.
"""

from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path

import pytest

_WWW = Path(__file__).resolve().parents[1] / "custom_components" / "padspan_ha" / "www" / "padspan-ha"
_VIEWS = _WWW / "views"
_NODE = shutil.which("node")

pytestmark = pytest.mark.skipif(_NODE is None, reason="node is not installed")


def _run_js(tmp_path: Path, script: str) -> dict:
    """Load iso_lights.js in node and return whatever the script prints.

    The module imports its sibling with a cache-busting query built from
    import.meta.url; copying to .mjs and rewriting that one specifier is all
    node needs to run the real file rather than a reimplementation of it.
    """
    for name in ("iso_lights", "light_codes"):
        src = (_VIEWS / f"{name}.js").read_text(encoding="utf-8")
        src = src.replace("./light_codes.js${new URL(import.meta.url).search}", "./light_codes.mjs")
        (tmp_path / f"{name}.mjs").write_text(src, encoding="utf-8")
    (tmp_path / "run.mjs").write_text(script, encoding="utf-8")
    # encoding is explicit: text=True decodes with the locale codepage, which
    # on Windows mangles the module's UTF-8 arrows and dashes into mojibake.
    res = subprocess.run([_NODE, str(tmp_path / "run.mjs")], capture_output=True,
                         text=True, encoding="utf-8", timeout=60)
    assert res.returncode == 0, f"node failed:\n{res.stderr}"
    return json.loads(res.stdout.strip().splitlines()[-1])


# A house with NO maps, NO map_transforms and NO photos of any kind.
_MODEL = {
    "room_geometry_m": {
        "Kitchen": {"type": "poly", "floor_id": "main", "points_m": [[0, 0], [6, 0], [6, 4], [0, 4]]},
        "Loft":    {"type": "poly", "floor_id": "up",   "points_m": [[0, 0], [5, 0], [5, 5], [0, 5]]},
    },
    "light_positions_m": {
        "light.plain":  {"x_m": 3.0, "y_m": 2.0, "floor_id": "main"},
        "light.strip":  {"x_m": 4.0, "y_m": 1.0, "floor_id": "main",
                         "width_cm": 240, "height_cm": 5, "rotation": 30},
    },
}
_FLOORS = [{"id": "main", "name": "Main", "level": 0}, {"id": "up", "name": "Upper", "level": 1}]
_LIGHTS_BY_EID = {
    "light.plain": {"entity_id": "light.plain", "state": "on", "code": "A01", "shape": "circle", "isWled": False},
    "light.strip": {"entity_id": "light.strip", "state": "on", "code": "W01", "shape": "bar", "isWled": True},
}


def _harness(body: str) -> str:
    return (
        "import * as M from './iso_lights.mjs';\n"
        f"const MODEL={json.dumps(_MODEL)};\n"
        f"const FLOORS={json.dumps(_FLOORS)};\n"
        f"const LBE={json.dumps(_LIGHTS_BY_EID)};\n"
        "const out={};\n" + body + "\nconsole.log(JSON.stringify(out));\n"
    )


def test_the_renderer_never_imports_the_photo_machinery():
    """A static guard on the rule: lights read the fabric and nothing else.

    stack_transform is where map placement, image aspect ratio and the
    measured-photo anchor live. The lights view must not be able to reach them
    even by accident.
    """
    src = (_VIEWS / "iso_lights.js").read_text(encoding="utf-8")
    code = "\n".join(l for l in src.splitlines() if not l.strip().startswith("//"))
    for forbidden in ("stack_transform", "metreAnchor", "makeStackXform", "imageAr", "room_bounds"):
        assert forbidden not in code, f"the lights renderer reaches for {forbidden}"


def test_frame_builds_from_the_fabric_with_no_maps_at_all(tmp_path):
    out = _run_js(tmp_path, _harness(
        "const f=M.fabricFrame(MODEL,FLOORS,150,0);"
        "out.levels=f.levels; out.scale=f.scale; out.empty=f.empty;"
    ))
    assert out["empty"] is False
    assert out["levels"] == [0, 1], "floor levels come from the floor registry"
    assert out["scale"] > 0, "a metres-per-pixel scale is derived from the fabric extent"


def test_drag_inverts_exactly_what_the_renderer_drew(tmp_path):
    """Render and drag must share one projection, or a dropped light moves."""
    out = _run_js(tmp_path, _harness(
        "const f=M.fabricFrame(MODEL,FLOORS,150,0);"
        "out.rt=[[3,2,0],[0,0,0],[5,5,1],[-2,7,1]].map(([x,y,z])=>{"
        "const p=f.iso(x,y,z); const b=f.isoInv(p[0],p[1],z);"
        "return [Math.abs(b[0]-x),Math.abs(b[1]-y)];});"
    ))
    for dx, dy in out["rt"]:
        assert dx < 1e-9 and dy < 1e-9, "isoInv must be the exact inverse of iso"


def test_a_placed_light_renders_without_any_map(tmp_path):
    out = _run_js(tmp_path, _harness(
        "const svg=M.buildIsoSVG(MODEL,{},new Set(),null,150,0,LBE,false,FLOORS);"
        "out.svg=svg; out.placed=(svg.match(/data-placed=\"1\"/g)||[]).length;"
    ))
    assert out["placed"] == 2, "both placed lights draw, with no maps_list in play"
    assert "No floor plans uploaded yet" not in out["svg"], "must not blame a missing photo"


def test_physical_size_and_rotation_are_actually_drawn(tmp_path):
    """The defect: both sat in the schema while nothing rendered them."""
    out = _run_js(tmp_path, _harness(
        "const svg=M.buildIsoSVG(MODEL,{},new Set(),null,150,0,LBE,false,FLOORS);"
        "const strip=svg.split('data-eid=\"light.strip\"')[1].split('</g>')[0];"
        "const plain=svg.split('data-eid=\"light.plain\"')[1].split('</g>')[0];"
        "out.strip=strip; out.plain=plain;"
    ))
    assert "scale(" in out["strip"], "a 2.4 m fixture must be drawn at 2.4 m"
    assert "rotate(30" in out["strip"], "rotation must reach the SVG"
    # A light with no measurements keeps the plain, legible default marker.
    assert "scale(" not in out["plain"] and "rotate(" not in out["plain"]


def test_the_code_label_is_never_rotated_or_stretched(tmp_path):
    """Readability is the whole point of the view."""
    out = _run_js(tmp_path, _harness(
        "const svg=M.buildIsoSVG(MODEL,{},new Set(),null,150,0,LBE,false,FLOORS);"
        "const g=svg.split('data-eid=\"light.strip\"')[1];"
        "out.textAfterTransformClose = g.indexOf('</g>') < g.indexOf('W01');"
    ))
    assert out["textAfterTransformClose"] is True, "the label must sit outside the transformed group"


def test_empty_fabric_points_at_the_fabric_not_at_uploading_a_photo(tmp_path):
    out = _run_js(tmp_path, _harness(
        "const svg=M.buildIsoSVG({},{},new Set(),null,150,0,{},false,[]);"
        "out.svg=svg;"
    ))
    assert "Mapping → Rooms" in out["svg"]
    assert "uploaded" not in out["svg"], "no photo is involved in this view"
