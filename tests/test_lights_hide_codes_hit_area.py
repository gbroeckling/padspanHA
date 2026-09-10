# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
""""Hide device codes" must hide the TEXT, not the place you tap.

Garry, 2026-09-09: "if i choose to not show the ID text in the map, some
of the functionality of clicking on the ID is removed... think thru on
how to put it back... making the entire shape [clickable]."

Traced to one real, live mechanism: codeChipSvg draws the code as its own
tap target (data-role="code", pointer-events="all") — the ONLY thing the
non-showcase marker ever draws with real pointer-events of its own; the
plain code <text> next to/on the glyph is pointer-events="none" even when
shown, so it never caught a tap either way, hidden or not. codeChip mode is
what the real sidebar always uses (lights_panel.js: codeChip: true) and what
the builder's own "Preview as sidebar" toggle turns on — so hiding codes
there was silently shrinking the tap target down to the glyph alone. Fixed
by keeping the SAME pill's hit region when codes are hidden, just without
the paint (codeChipSvg's own invisible=true branch).

Runs the real module under node; skipped, not failed, without node.
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
    for name in ("iso_lights", "light_codes", "room_color", "wall_geom"):
        src = (_VIEWS / f"{name}.js").read_text(encoding="utf-8")
        src = src.replace("./light_codes.js${new URL(import.meta.url).search}", "./light_codes.mjs")
        src = src.replace('"./room_color.js"', '"./room_color.mjs"')
        src = src.replace('"./wall_geom.js"', '"./wall_geom.mjs"')
        (tmp_path / f"{name}.mjs").write_text(src, encoding="utf-8")
    (tmp_path / "run.mjs").write_text(script, encoding="utf-8")
    res = subprocess.run([_NODE, str(tmp_path / "run.mjs")], capture_output=True,
                         text=True, encoding="utf-8", timeout=60)
    assert res.returncode == 0, f"node failed:\n{res.stderr}"
    return json.loads(res.stdout.strip().splitlines()[-1])


_MODEL = {
    "room_geometry_m": {
        "Kitchen": {"type": "poly", "floor_id": "main", "points_m": [[0, 0], [6, 0], [6, 4], [0, 4]]},
    },
    "light_positions_m": {
        "light.plain": {"x_m": 3.0, "y_m": 2.0, "floor_id": "main"},
        # A perimeter light hits a SEPARATE code path (iso_lights.js's own
        # l.shape==="perimeter" branch) that needed the identical fix.
        "light.frame": {"x_m": 1.0, "y_m": 1.0, "floor_id": "main", "shape": "perimeter"},
    },
}
_FLOORS = [{"id": "main", "name": "Main", "level": 0}]
_LIGHTS_BY_EID = {
    "light.plain": {"entity_id": "light.plain", "state": "on", "code": "A01", "shape": "circle", "isWled": False},
    "light.frame": {"entity_id": "light.frame", "state": "on", "code": "P01", "shape": "perimeter", "isWled": False},
}


def _harness(body: str) -> str:
    return (
        "import * as M from './iso_lights.mjs';\n"
        f"const MODEL={json.dumps(_MODEL)};\n"
        f"const FLOORS={json.dumps(_FLOORS)};\n"
        f"const LBE={json.dumps(_LIGHTS_BY_EID)};\n"
        "const out={};\n" + body + "\nconsole.log(JSON.stringify(out));\n"
    )


def _code_group(svg: str, eid: str) -> str | None:
    """The data-role="code" <g>...</g> that belongs to one marker, or None.

    Anchored on `<g class="lhex" data-eid="...">` specifically, not just any
    element carrying that eid — a shaped marker (perimeter) also draws its
    own outline `<polygon data-eid="...">` BEFORE the lhex group, which
    carries the same eid and would otherwise be matched instead.
    """
    marker_start = svg.index(f'<g class="lhex" data-eid="{eid}"')
    depth = 0
    i = marker_start
    end = None
    while i < len(svg):
        if svg.startswith("<g", i):
            depth += 1
            i += 2
        elif svg.startswith("</g>", i):
            depth -= 1
            i += 4
            if depth == 0:
                end = i
                break
        else:
            i += 1
    marker = svg[marker_start:end]
    if 'data-role="code"' not in marker:
        return None
    a = marker.index('<g data-role="code"')
    b = marker.index("</g>", a) + 4
    return marker[a:b]


def test_sidebar_mode_keeps_a_real_hit_target_when_codes_are_hidden(tmp_path):
    out = _run_js(tmp_path, _harness(
        "const shown=M.buildIsoSVG(MODEL,{},new Set(),null,150,0,LBE,false,FLOORS,{codeChip:true,hideCodes:false});\n"
        "const hidden=M.buildIsoSVG(MODEL,{},new Set(),null,150,0,LBE,false,FLOORS,{codeChip:true,hideCodes:true});\n"
        "out.shown=shown; out.hidden=hidden;\n"
    ))
    shown_g = _code_group(out["shown"], "light.plain")
    hidden_g = _code_group(out["hidden"], "light.plain")
    assert shown_g is not None, "sanity: the visible pill must exist with codes shown"
    assert hidden_g is not None, (
        "hiding codes removed the code-chip's <g data-role=\"code\"> entirely — "
        "the ONE real hit region that mode ever added is gone, not just its paint"
    )
    assert 'pointer-events="all"' in hidden_g, "the hidden pill must still take the tap"
    assert "A01" not in hidden_g, "the code text itself must not render when hidden"
    assert "<text" not in hidden_g, "no text node at all — not just invisible text"
    # Same footprint: same rect x/y/width/height in both, so the tap target
    # did not shrink even though the paint is gone.
    import re
    def rect_dims(g):
        m = re.search(r'<rect x="([-\d.]+)" y="([-\d.]+)" width="([\d.]+)" height="([\d.]+)"', g)
        return m.groups()
    assert rect_dims(shown_g) == rect_dims(hidden_g), (shown_g, hidden_g)


def test_perimeter_shape_keeps_its_own_chip_hit_target_when_hidden(tmp_path):
    """The l.shape==="perimeter" branch composes its label separately
    (pLbl) — same bug, same fix, a second call site."""
    out = _run_js(tmp_path, _harness(
        "const hidden=M.buildIsoSVG(MODEL,{},new Set(),null,150,0,LBE,false,FLOORS,{codeChip:true,hideCodes:true});\n"
        "out.hidden=hidden;\n"
    ))
    g = _code_group(out["hidden"], "light.frame")
    assert g is not None, "perimeter marker lost its code-chip hit target when codes are hidden"
    assert 'pointer-events="all"' in g
    assert "P01" not in g and "<text" not in g


def test_builder_mode_hides_the_label_with_no_hit_region_either_way(tmp_path):
    """codeChip:false (the plain builder view, not Preview-as-sidebar): the
    label was ALWAYS pointer-events="none" — hidden or shown, it never
    caught a tap. Confirms this fix did not invent a change in scope there:
    nothing to restore because nothing ever worked."""
    out = _run_js(tmp_path, _harness(
        "const shown=M.buildIsoSVG(MODEL,{},new Set(),null,150,0,LBE,false,FLOORS,{codeChip:false,hideCodes:false});\n"
        "const hidden=M.buildIsoSVG(MODEL,{},new Set(),null,150,0,LBE,false,FLOORS,{codeChip:false,hideCodes:true});\n"
        "out.shownHasCodeRole=shown.includes('data-role=\"code\"');\n"
        "out.hiddenHasCodeRole=hidden.includes('data-role=\"code\"');\n"
    ))
    assert out["shownHasCodeRole"] is False, "plain builder mode must never use the chip's own tap target"
    assert out["hiddenHasCodeRole"] is False
