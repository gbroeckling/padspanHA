# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""Live Aboard as a screen: the map alone, full screen, the floor stepper,
double-tap to fly, saved views, the readable night, names and chips, the
phone, the first-time card.

tests/js/live_aboard_screen.mjs runs views/live_aboard.js for real under the
DOM shim with a stub GL (tests/js/stub_gl.mjs). The checks here hold the
hosts' side: only the sidebar asks for the map alone, the view keeps nothing
in the browser itself, and full screen takes the panel's own element.
"""

from __future__ import annotations

import json
import re
import shutil
import subprocess
from pathlib import Path

import pytest

_ROOT = Path(__file__).resolve().parents[1]
_WWW = _ROOT / "custom_components" / "padspan_ha" / "www" / "padspan-ha"
_VIEWS = _WWW / "views"
_NODE = shutil.which("node")


def _js(p: Path) -> str:
    return p.read_text(encoding="utf-8").replace("\r\n", "\n")


def _code(p: Path) -> str:
    """The file without its // comments (strings keep theirs)."""
    return "\n".join(re.sub(r"(^|\s)//.*$", "", ln) for ln in _js(p).splitlines())


@pytest.fixture(scope="module")
def screen() -> dict:
    if _NODE is None:
        pytest.skip("node is not installed")
    res = subprocess.run([_NODE, str(Path(__file__).parent / "js" / "live_aboard_screen.mjs"), str(_WWW)],
                         capture_output=True, text=True, encoding="utf-8", timeout=240)
    lines = [ln for ln in res.stdout.strip().splitlines() if ln.startswith("{")]
    assert lines, f"the harness itself failed:\n{res.stderr[-3000:]}"
    return json.loads(lines[-1])


@pytest.mark.parametrize("prefix,least", [("maponly:", 8), ("full:", 2), ("floors:", 1), ("fly:", 2), ("views:", 1),
                                          ("night:", 1), ("names:", 3), ("phone:", 1), ("hint:", 1)])
def test_the_screen_harness_covers_each_part(screen, prefix, least) -> None:
    got = [k for k in screen["cases"] if k.startswith(prefix)]
    assert len(got) >= least, (prefix, got)
    bad = [f for f in screen["failures"] if f["name"].startswith(prefix)]
    assert all(screen["cases"][k] for k in got) and not bad, json.dumps(bad[:4], indent=2, ensure_ascii=False)


def test_every_screen_case_passes(screen) -> None:
    assert not screen["failures"], json.dumps(screen["failures"][:6], indent=2, ensure_ascii=False)


def test_only_the_sidebar_asks_for_the_map_alone() -> None:
    """The sidebar Atlas is the house map (mapOnly); Mapping's never is."""
    lp = _js(_WWW / "lights_panel.js")
    block = lp[lp.index("house3d: this.state._house3d ?"):]
    block = block[:block.index("} : null,")]
    assert "mapOnly: true," in block
    maps = _js(_VIEWS / "maps.js")
    mblock = maps[maps.index("house3d: ctx.state.settings && ctx.state.settings.atlas_3d_enabled !== undefined ?"):]
    assert "mapOnly" not in mblock[:mblock.index("} : null,")]
    lm = _js(_VIEWS / "lights_map.js")
    assert "mapOnly: h3.mapOnly === true," in lm and "prefs: _laPrefs," in lm
    assert "floorSteps: sortedLevels.length > 1 ? {" in lm and "go: (i) => la3dFocus(i < 0 ? 0 :" in lm
    la = _js(_VIEWS / "live_aboard.js")
    assert "mapOnly = p.mapOnly === true;" in la


def test_the_view_keeps_nothing_in_the_browser_itself() -> None:
    """Saved views and the first-time card go through the card's store,
    under Live Aboard's own prefix; the view has no timers of its own."""
    la = _code(_VIEWS / "live_aboard.js")
    for bad in ("localStorage", "sessionStorage", "setTimeout", "setInterval", "indexedDB"):
        assert bad not in la, bad
    lm = _js(_VIEWS / "lights_map.js")
    prefs = lm[lm.index("const _laPrefs = {"):lm.index("let _LA = null;")]
    assert prefs.count('"padspan_la3d_" + k') == 2 and prefs.count("try {") == 2


def test_full_screen_takes_the_panel_and_lets_go() -> None:
    """Full screen is asked of the panel's own element (it outlives every card
    the poll builds); its change is heard on the document and let go of with
    the view; switched off or leaving, the screen ends first."""
    la = _js(_VIEWS / "live_aboard.js")
    tog = la[la.index("  function toggleFull(){"):la.index("  function leaveFull(){")]
    assert "const h = hostEl();" in tog and "(h.requestFullscreen || h.webkitRequestFullscreen).call(h" in tog
    assert "setBare(true, false); return; }" in tog, "a screen that may not: the map alone in the panel"
    obs = la[la.index("  function wireObservers(){"):la.index("  // ── the 3D file (part C)")]
    assert 'document.addEventListener("fullscreenchange", onFull);' in obs
    assert 'document.removeEventListener("fullscreenchange", onFull);' in obs
    td = la[la.index("  function teardown(){"):la.index("  function fail(kind){")]
    assert "endScreen();" in td
    for api in ("detach(){", "release(){"):
        line = la[la.index(f"    {api}"):]
        assert "endScreen();" in line[:line.index("\n")], api


def test_the_flat_atlas_is_untouched_while_live_aboard_is_away() -> None:
    """What Live Aboard hides of the page (the flat legend, the sidebar's flat
    hint) is in a sheet inside its own element: in the page only while it
    shows. styles.css and the renderer know nothing of it."""
    la = _js(_VIEWS / "live_aboard.js")
    assert "const CSS_SHOWING = `.lv-legend{display:none}`;" in la
    assert "showCss.textContent = CSS_SHOWING;" in la and "root.appendChild(showCss);" in la
    assert 'panelCss.textContent = mapOnly ? CSS_PANEL : "";' in la
    css = (_WWW / "styles.css").read_text(encoding="utf-8")
    assert "la3d" not in css
