# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""The sidebar Atlas's 5 s redraw patches the map instead of rebuilding it.

Every poll builds the sidebar's card afresh. The map's SVG is still made as
one string, but the last tick's <svg> moves into the new card and only the
parts whose markup changed (a marker switched, motion, a reading) are
replaced; the floor plates, rooms and walls stay. Another floor, the gaps,
zoom, a setting or a new map: a full rebuild, as before. The markup is always
what a full rebuild makes. The Mapping tab's builder does not patch.

tests/js/atlas_svg_patch.mjs runs the modules for real; the wiring is held here.
"""

from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path

import pytest

_ROOT = Path(__file__).resolve().parents[1]
_WWW = _ROOT / "custom_components" / "padspan_ha" / "www" / "padspan-ha"
_NODE = shutil.which("node")


def _read(rel: str) -> str:
    return (_WWW / rel).read_text(encoding="utf-8").replace("\r\n", "\n")


@pytest.fixture(scope="module")
def harness() -> dict:
    if _NODE is None:
        pytest.skip("node is not installed")
    res = subprocess.run([_NODE, str(Path(__file__).parent / "js" / "atlas_svg_patch.mjs"), str(_WWW)],
                         capture_output=True, text=True, encoding="utf-8", timeout=180)
    lines = [ln for ln in res.stdout.strip().splitlines() if ln.startswith("{")]
    assert lines, f"the harness itself failed:\n{res.stderr[-3000:]}"
    return json.loads(lines[-1])


def test_every_case_in_the_harness_passes(harness) -> None:
    assert not harness["failures"], json.dumps(harness["failures"][:6], indent=2, ensure_ascii=False)
    assert len(harness["cases"]) >= 12


def test_only_the_sidebar_host_patches() -> None:
    panel = _read("lights_panel.js")
    assert "patchSvg: true," in panel
    # The Mapping tab's builder (drag to place, its own DOM edits) rebuilds as ever.
    assert "patchSvg" not in _read("views/maps.js")


def test_the_card_draws_through_the_patch_only_when_asked() -> None:
    src = _read("views/lights_map.js")
    i = src.index("const rebuildISO = () => {")
    body = src[i:src.index("\n  };\n", i)]
    assert "if (host.patchSvg) {" in body
    assert "drawStageSvg(isoDiv, svgStr, view," in body
    assert "} else isoDiv.innerHTML = svgStr;" in body
    # The map itself is part of the key: the host's own model, not the tier's copy.
    assert "model: hostIn.model" in body


def test_a_kept_drawing_is_wired_once() -> None:
    src = _read("views/lights_map.js")
    i = src.index("export function wireUseSurface(isoDiv, api){")
    body = src[i:src.index("\n}\n", i)]
    assert "if (svg && svg._psUnwire) svg._psUnwire();" in body
    # Every listener on the drawing's parts goes through on(), so it can come off.
    assert body.count("addEventListener(") == 1
