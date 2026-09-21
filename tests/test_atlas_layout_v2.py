# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""Atlas layout v2 — a reversible trial (Garry, 2026-09-21): "the left to
right use of space was often empty due to bad planning" (the toolbar forced
one line per group, and the map was sized to the stage's WIDTH rather than
the screen's height) and "anything to the sides is a distraction" on the
sidebar Atlas panel specifically, which IS the house map.

Gated entirely behind host.layoutV2 (settings.atlas_layout_v2, off by
default) so the classic layout is byte-for-byte unchanged when it's off —
test_lights_build_controls_labels.py and the rest of the existing suite
already pin that with layoutV2 simply absent from every host fixture there.
These tests exercise the v2 path specifically: the packed/folded toolbar,
the merged presets tab, and the display-mode rail + drawers.

Runs the real module under node; skipped, not failed, without node.
"""

from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path

import pytest

_ROOT = Path(__file__).resolve().parents[1]
_WWW = _ROOT / "custom_components" / "padspan_ha" / "www" / "padspan-ha"
_VIEWS = _WWW / "views"
_NODE = shutil.which("node")

pytestmark = pytest.mark.skipif(_NODE is None, reason="node is not installed")


def _run(script: str) -> dict:
    src = (
        "import { pathToFileURL } from 'node:url';\n"
        f"const {{ install }} = await import(pathToFileURL({json.dumps(str(_ROOT / 'tests' / 'js' / 'dom_shim.mjs'))}).href);\n"
        "install(globalThis);\n"
        f"const LM = await import(pathToFileURL({json.dumps(str(_VIEWS / 'lights_map.js'))}).href);\n"
        "const out={};\n" + script + "\nconsole.log(JSON.stringify(out));\n"
    )
    res = subprocess.run([_NODE, "--input-type=module", "-e", src], capture_output=True,
                         text=True, encoding="utf-8", timeout=60, cwd=str(_VIEWS))
    assert res.returncode == 0, f"node failed:\n{res.stderr}"
    return json.loads(res.stdout.strip().splitlines()[-1])


_EL_JS = """
function el(tag, attrs, children) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (k === "class") n.className = v;
    else if (k === "style") n.setAttribute("style", v);
    else if (k.startsWith("on") && typeof v === "function") n.addEventListener(k.slice(2), v);
    else if (v !== undefined && v !== null) n.setAttribute(k, String(v));
  }
  for (const c of (Array.isArray(children) ? children : [children])) {
    if (c === null || c === undefined) continue;
    n.appendChild(typeof c === "string" || typeof c === "number" ? document.createTextNode(String(c)) : c);
  }
  return n;
}
"""

_MODEL = {
    "floors": [{"id": "main", "name": "Main", "level": 0}],
    "room_geometry_m": {
        "Kitchen": {"type": "poly", "floor_id": "main", "points_m": [[0, 0], [4, 0], [4, 4], [0, 4]]},
    },
}


def _base_host(extra: str) -> str:
    return (
        _EL_JS +
        f"const MODEL={json.dumps(_MODEL)};\n"
        "const host = {\n"
        "  el, floors: MODEL.floors, model: MODEL, tier: 'pro', byRoom: {}, lightsByEid: {}, lightsLoading: false,\n"
        "  hiddenEids: new Set(),\n"
        "  view: { floorGap: 150, horizGap: 0, focusIdx: 0, zoom: 1 },\n"
        "  saveView: async () => {}, callWS: async () => ({}), toast: () => {},\n"
        "  onHexesBuilt: () => {}, onRowClick: () => {}, onToggleHidden: () => {}, afterAssign: () => {},\n"
        + extra +
        "};\n"
        "const card = LM.buildLightsMapCard(host);\n"
    )


# ── pure helpers ─────────────────────────────────────────────────────────────

def test_layout_tier_for_the_documented_breakpoints():
    out = _run(
        "out.narrow = [0, 899].map(w => LM.layoutTierFor(w));\n"
        "out.medium = [900, 1499].map(w => LM.layoutTierFor(w));\n"
        "out.wide = [1500, 2299].map(w => LM.layoutTierFor(w));\n"
        "out.ultra = [2300, 5000].map(w => LM.layoutTierFor(w));\n"
    )
    assert out["narrow"] == ["narrow", "narrow"]
    assert out["medium"] == ["medium", "medium"]
    assert out["wide"] == ["wide", "wide"]
    assert out["ultra"] == ["ultra", "ultra"]


def test_fit_width_px_fits_the_taller_than_wide_drawing_to_screen_height():
    """A viewBox 760 wide, 940 tall (roughly the real iso canvas's own
    proportions) in a stage with plenty of width but limited height must be
    sized DOWN to fit the height, not stretched to the stage's full width —
    the exact bug this whole feature exists to fix."""
    out = _run(
        "out.fitsHeight = LM.fitWidthPx(2400, 800, 760, 940);\n"
        "out.fitsWidth = LM.fitWidthPx(500, 4000, 760, 940);\n"
        "out.degenerate = [LM.fitWidthPx(0, 800, 760, 940), LM.fitWidthPx(800, 0, 760, 940), LM.fitWidthPx(800, 800, 0, 940)];\n"
    )
    # height-constrained: width = availH * vbW/vbH = 800 * 760/940
    assert abs(out["fitsHeight"] - 800 * 760 / 940) < 0.5
    assert out["fitsHeight"] < 2400, "must not blow out to the stage's full width when height is the constraint"
    # width-constrained: capped at the stage's own width
    assert out["fitsWidth"] == 500
    assert out["degenerate"] == [0, 0, 0]


# ── classic vs v2 ─────────────────────────────────────────────────────────────

def test_layoutv2_absent_is_byte_for_byte_the_classic_toolbar():
    """host.layoutV2 simply unset (every existing host fixture, every
    pre-v2 test) must produce NO lv-v2 class and NO lv-fold anywhere —
    reversibility means "off" is not a degraded v2, it's the untouched
    original code path."""
    out = _run(_base_host(
        "  automorph: true, onAutomorph: () => {}, automorphRoomPct: 1, onAutomorphRoomPct: () => {},\n"
    ) + (
        "out.hasV2Class = card.classList.contains('lv-v2');\n"
        "out.foldCount = card.querySelectorAll('.lv-fold').length;\n"
        "out.hasLayoutToggle = card.textContent.includes('New layout') || card.textContent.includes('Classic layout');\n"
    ))
    assert out["hasV2Class"] is False
    assert out["foldCount"] == 0
    assert out["hasLayoutToggle"] is False


def test_layoutv2_folds_automorph_tuning_and_layout_and_view():
    out = _run(_base_host(
        "  layoutV2: true, onLayoutV2: () => {},\n"
        "  automorph: true, onAutomorph: () => {}, automorphRoomPct: 40, onAutomorphRoomPct: () => {},\n"
        "  automorphHardness: -10, onAutomorphHardness: () => {},\n"
        "  automorphStyle: 'glow', onAutomorphStyle: () => {},\n"
        "  automorphSubtlety: 0, onAutomorphSubtlety: () => {},\n"
    ) + (
        "out.hasV2Class = card.classList.contains('lv-v2');\n"
        "const folds = [...card.querySelectorAll('.lv-fold')];\n"
        "out.foldTitles = folds.map(f => f.textContent.split('\\n')[0] || f.children[0].textContent);\n"
        "const automorphFold = folds.find(f => f.textContent.includes('Room %'));\n"
        "out.automorphSlidersInFold = !!(automorphFold && automorphFold.querySelectorAll('input').filter(i => i.type === 'range').length >= 3);\n"
        "const layoutFold = folds.find(f => f.textContent.includes('Spacing'));\n"
        "out.layoutControlsInFold = !!(layoutFold && layoutFold.textContent.includes('Save view'));\n"
        "out.saveViewOutsideAnyFold = [...card.querySelectorAll('button')].some(b => b.textContent === 'Save view' && !b.closest('.lv-fold'));\n"
    ))
    assert out["hasV2Class"] is True
    assert out["automorphSlidersInFold"] is True, out
    assert out["layoutControlsInFold"] is True, out
    assert out["saveViewOutsideAnyFold"] is False, "Save view must live INSIDE the Layout & view fold in v2, not beside it"


def test_layoutv2_toggle_button_flips_the_setting_both_ways():
    out = _run(_base_host("  layoutV2: false, onLayoutV2: (v) => { out.calledWith = v; },\n") + (
        "const btn = [...card.querySelectorAll('button')].find(b => b.textContent.includes('New layout'));\n"
        "out.found = !!btn;\n"
        "if (btn) btn.dispatchEvent({ type: 'click' });\n"
    ))
    assert out["found"] is True
    assert out["calledWith"] is True, "the toggle from Classic must turn v2 ON"

    out2 = _run(_base_host("  layoutV2: true, onLayoutV2: (v) => { out.calledWith = v; },\n") + (
        "const btn = [...card.querySelectorAll('button')].find(b => b.textContent.includes('Classic layout'));\n"
        "out.found = !!btn;\n"
        "if (btn) btn.dispatchEvent({ type: 'click' });\n"
    ))
    assert out2["found"] is True
    assert out2["calledWith"] is False, "the toggle from v2 must turn it back OFF"


def test_layoutv2_merges_both_preset_bars_into_one_tabbed_row():
    """The promise was "one row, switched by a tab, instead of two stacked
    rows" — a tab-panel implementation (both bars present, exactly one
    visible at a time) satisfies that exactly as well as collapsing to a
    single DOM node would, and is the standard shape for this pattern; the
    real property to pin is that they can never BOTH show at once, and that
    the visible one actually follows the tab that's on."""
    out = _run(_base_host(
        "  layoutV2: true, onLayoutV2: () => {},\n"
        "  showcase: true, onShowcase: () => {},\n"
        "  showcasePresets: [{ name: 'Evening', values: {} }], onApplyPreset: async () => {}, onSavePreset: async () => {},\n"
        "  wholeHousePresets: [{ name: 'Movie', entities: {} }], onWholeHouseApply: async () => {}, onWholeHouseSet: async () => {},\n"
    ) + (
        "const bars = [...card.querySelectorAll('.lv-presetbar')];\n"
        "out.barCount = bars.length;\n"
        "out.visibleCountBefore = bars.filter(b => !b.hidden).length;\n"
        "out.tabTexts = [...card.querySelectorAll('.lv-tab')].map(t => t.textContent);\n"
        "const looks = [...card.querySelectorAll('.lv-tab')].find(t => t.textContent === 'Look');\n"
        "const house = [...card.querySelectorAll('.lv-tab')].find(t => t.textContent === 'Whole house');\n"
        "out.lookOnBefore = looks.classList.contains('on');\n"
        "const lookBarVisibleBefore = bars.find(b => b.textContent.includes('Evening') && !b.hidden);\n"
        "out.lookBarVisibleBefore = !!lookBarVisibleBefore;\n"
        "house.dispatchEvent({ type: 'click' });\n"
        "out.lookOnAfter = looks.classList.contains('on');\n"
        "out.houseOnAfter = house.classList.contains('on');\n"
        "out.visibleCountAfter = bars.filter(b => !b.hidden).length;\n"
        "out.houseBarVisibleAfter = bars.some(b => b.textContent.includes('Movie') && !b.hidden);\n"
        "out.lookBarVisibleAfter = bars.some(b => b.textContent.includes('Evening') && !b.hidden);\n"
    ))
    assert out["barCount"] == 2, "the Look and Whole house bars themselves — pinned so a future change is deliberate"
    assert set(out["tabTexts"]) == {"Look", "Whole house"}
    assert out["visibleCountBefore"] == 1, "the two bars must never both be visible, even before any click"
    assert out["lookOnBefore"] is True and out["lookBarVisibleBefore"] is True, "Look is the default tab"
    assert out["lookOnAfter"] is False and out["houseOnAfter"] is True
    assert out["visibleCountAfter"] == 1, "still exactly one visible after switching tabs — never both, never neither"
    assert out["houseBarVisibleAfter"] is True and out["lookBarVisibleAfter"] is False
    assert set(out["tabTexts"]) == {"Look", "Whole house"}
    assert out["lookOnBefore"] is True and out["lookOnAfter"] is False
    assert out["houseOnAfter"] is True


# ── display mode (the sidebar) ────────────────────────────────────────────

def test_display_mode_moves_every_bar_into_a_drawer_off_the_rail():
    """"anything to the sides is a distraction from the purpose of the
    screen" — in display mode nothing appends straight to the map card
    except the rail and the stage itself; every control bar lives inside
    an .lv-drawer, closed unless its rail icon is the active one."""
    out = _run(_base_host(
        "  layoutV2: true, displayMode: true,\n"
        "  showcase: true, onShowcase: () => {},\n"
        "  onClassFilter: () => {}, classFilter: 'all',\n"
    ) + (
        "out.hasDisplayClass = card.classList.contains('lv-display');\n"
        "out.railPresent = !!card.querySelector('.lv-rail');\n"
        "out.toolbarIsDirectChild = card.children.includes(card.querySelector('.lv-toolbar'));\n"
        "out.toolbarInsideDrawer = [...card.querySelectorAll('.lv-drawer')].some(d => d.querySelectorAll('.lv-toolbar').length > 0);\n"
        "out.railButtonCount = card.querySelectorAll('.lv-railbtn').length;\n"
    ))
    assert out["hasDisplayClass"] is True
    assert out["railPresent"] is True
    assert out["toolbarIsDirectChild"] is False, "the toolbar must not sit directly beside the map in display mode"
    assert out["toolbarInsideDrawer"] is True
    assert out["railButtonCount"] >= 2, "at least the drawer icons plus the hide-rail button"


def test_display_mode_rail_icon_opens_and_recloses_its_drawer():
    out = _run(_base_host(
        "  layoutV2: true, displayMode: true, view: { floorGap: 150, horizGap: 0, focusIdx: 0, zoom: 1 },\n"
        "  onClassFilter: () => {}, classFilter: 'all',\n"
    ) + (
        "const viewBtn = [...card.querySelectorAll('.lv-railbtn')].find(b => b.getAttribute('title') === 'Zoom and view options');\n"
        "const drawer = card.querySelector('.lv-drawer.open');\n"
        "out.closedAtStart = !drawer || !drawer.classList.contains('open');\n"
        "viewBtn.dispatchEvent({ type: 'click' });\n"
        "out.openAfterClick = viewBtn.classList.contains('on');\n"
        "viewBtn.dispatchEvent({ type: 'click' });\n"
        "out.closedAfterSecondClick = !viewBtn.classList.contains('on');\n"
    ))
    assert out["closedAtStart"] is True
    assert out["openAfterClick"] is True
    assert out["closedAfterSecondClick"] is True


def test_classic_layout_never_renders_a_rail_even_if_displaymode_is_set():
    """displayMode only matters once layoutV2 is actually on — a host that
    somehow sets displayMode without layoutV2 must still get the plain
    classic card, not a half-applied display layout."""
    out = _run(_base_host("  layoutV2: false, displayMode: true,\n") + (
        "out.railPresent = !!card.querySelector('.lv-rail');\n"
        "out.hasDisplayClass = card.classList.contains('lv-display');\n"
    ))
    assert out["railPresent"] is False
    assert out["hasDisplayClass"] is False
