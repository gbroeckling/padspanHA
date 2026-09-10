# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""The Lights builder's control row: every slider labelled, one help card.

Garry, 2026-09-09, looking at the actual row: "The three sliders for morph
are not labled, and all sliders need a ? to bring up a card that completely
describes their function." Two real gaps, both in lights_map.js's
buildLightsMapCard: the Automorph Room %/Hardness/Subtlety sliders had a
live numeric value but no name (Floor/Spacing/L-R, right next to them,
already did); and the whole row had no help button at all, unlike
Overview's matching row (overview_3d_controls).

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
    "floors": [{"id": "main", "name": "Main", "level": 0}, {"id": "upper", "name": "Upper", "level": 1}],
    # fabricFrame only counts a storey that actually has a room or a light on
    # it — a bare floor-registry entry alone renders no second level, and the
    # Floor slider (gated on more than one level existing) would silently
    # never appear, which is exactly the kind of thing this test exists to
    # catch, so the fixture has to be honest about it.
    "room_geometry_m": {
        "Kitchen": {"type": "poly", "floor_id": "main", "points_m": [[0, 0], [4, 0], [4, 4], [0, 4]]},
        "Bed":     {"type": "poly", "floor_id": "upper", "points_m": [[0, 0], [4, 0], [4, 4], [0, 4]]},
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


def test_automorph_sliders_are_all_three_labelled(tmp_path):
    # The shim's outerHTML only reflects nodes built by ASSIGNING a string to
    # .innerHTML (the iso_lights.js SVG-string pattern) — this card is built
    # by real appendChild() calls, so textContent (which the shim genuinely
    # walks children for) is the correct thing to read, not outerHTML.
    out = _run(_base_host(
        "  automorph: true,\n"
        "  onAutomorph: () => {}, automorphRoomPct: 28, onAutomorphRoomPct: () => {},\n"
        "  automorphHardness: 6, onAutomorphHardness: () => {},\n"
        "  automorphSubtlety: 16, onAutomorphSubtlety: () => {},\n"
        "  automorphStyle: 'nebula', onAutomorphStyle: () => {},\n"
    ) + (
        "out.text = card.textContent;\n"
        "out.rangeInputCount = card.querySelectorAll('input').filter(i => i.type === 'range').length;\n"
    ))
    text = out["text"]
    assert "Room %" in text, "the Automorph room-percent slider has no visible label"
    assert "Hardness" in text, "the Automorph hardness slider has no visible label"
    assert "Subtlety" in text, "the Automorph subtlety slider has no visible label"
    # Every label sits next to a real <input type="range"> — not just loose
    # text unconnected to a control.
    assert out["rangeInputCount"] >= 3, out


def test_related_sliders_are_visually_grouped_not_a_flat_run(tmp_path):
    """Garry, 2026-09-09: "put sliders in sets with a slight shading change
    to differentiate" — Automorph's own three (+ its style dropdown) sit in
    one shaded lv-ctrlgroup pill, Floor/Spacing/L-R sit in a second, so each
    set reads as one thing rather than eight loose controls in a row."""
    out = _run(_base_host(
        "  automorph: true,\n"
        "  onAutomorph: () => {}, automorphRoomPct: 28, onAutomorphRoomPct: () => {},\n"
        "  automorphHardness: 6, onAutomorphHardness: () => {},\n"
        "  automorphSubtlety: 16, onAutomorphSubtlety: () => {},\n"
        "  automorphStyle: 'nebula', onAutomorphStyle: () => {},\n"
    ) + (
        "const groups = [...card.querySelectorAll('.lv-ctrlgroup')];\n"
        "out.count = groups.length;\n"
        "out.texts = groups.map(g => g.textContent);\n"
    ))
    assert out["count"] >= 2, out
    automorphGroup = next((t for t in out["texts"] if "Room %" in t), None)
    layoutGroup = next((t for t in out["texts"] if "Spacing" in t), None)
    assert automorphGroup is not None, "no shaded group holds the Automorph sliders"
    for label in ("Room %", "Hardness", "Style", "Subtlety"):
        assert label in automorphGroup, (label, automorphGroup)
    assert layoutGroup is not None, "no shaded group holds the Floor/Spacing/L-R sliders"
    for label in ("Floor", "Spacing", "L / R"):
        assert label in layoutGroup, (label, layoutGroup)
    # The two sets are DIFFERENT groups, not one blob everything landed in.
    assert automorphGroup != layoutGroup, "Automorph and Floor/Spacing/L-R must be separate groups"


def test_sticky_control_row_is_opt_in_per_host(tmp_path):
    """Garry, 2026-09-09: "the scroll hides the controls, needs fixing for
    mapping area, but works better this way in lights and overview" — the
    Mapping builder host sets stickyToolbar; the Lights sidebar
    (lights_panel.js) never does, so this SAME shared card must default to
    its old, non-sticky behaviour when the flag is absent."""
    out = _run(_base_host("") + (
        "out.stickyByDefault = card.querySelector('.lv-toolbar').classList.contains('lv-toolbar-sticky');\n"
    ))
    assert out["stickyByDefault"] is False, "the control row must not be sticky unless the host asks for it"

    out = _run(_base_host("  stickyToolbar: true,\n") + (
        "out.sticky = card.querySelector('.lv-toolbar').classList.contains('lv-toolbar-sticky');\n"
    ))
    assert out["sticky"] is True, "host.stickyToolbar: true must add lv-toolbar-sticky"


def test_help_button_renders_when_the_host_provides_one(tmp_path):
    calls = []
    out = _run(_base_host(
        "  helpBtn: (key) => { const b = el('button', {class:'btn-help'}, '?'); b.dataset.key = key; return b; },\n"
    ) + (
        "const btn = card.querySelector('.btn-help');\n"
        "out.found = !!btn; out.key = btn ? btn.dataset.key : null;\n"
    ))
    assert out["found"], "the control row grew no help button even though the host provided helpBtn"
    assert out["key"] == "lights_build_controls"


def test_help_button_is_simply_absent_without_a_host_that_provides_one(tmp_path):
    """The sidebar (lights_panel.js) never sets host.helpBtn — confirms
    that absence degrades to nothing rendered, not a crash."""
    out = _run(_base_host("") + (
        "out.found = !!card.querySelector('.btn-help');\n"
    ))
    assert out["found"] is False


def test_help_content_has_a_complete_entry_for_every_control_in_the_row(tmp_path):
    """Cross-checks the help card's own body text against every label this
    row actually renders — catches the row growing a new control whose name
    never made it into the card, the same class of gap this whole fix is
    for."""
    html_out = _run(_base_host(
        "  showcase: false, onShowcase: () => {},\n"
        "  hideUntouched: false, untouchedCount: 3, onHideUntouched: () => {},\n"
        "  hideDeviceCodes: false, onHideDeviceCodes: () => {},\n"
        "  automorph: true, onAutomorph: () => {}, automorphRoomPct: 0, onAutomorphRoomPct: () => {},\n"
        "  automorphHardness: 0, onAutomorphHardness: () => {},\n"
        "  automorphSubtlety: 0, onAutomorphSubtlety: () => {},\n"
        "  automorphStyle: 'glow', onAutomorphStyle: () => {},\n"
    ) + "out.text = card.textContent;\n")
    row_text = html_out["text"]

    help_src = (_WWW / "help_content.js").read_text(encoding="utf-8")
    a = help_src.index("lights_build_controls: {")
    entry = help_src[a: help_src.index("\n  },", a)]

    row_labels = ["Room %", "Hardness", "Style", "Subtlety", "Floor", "Spacing", "L / R", "Zoom", "Save view", "Reset view"]
    for label in row_labels:
        assert label in row_text, f"test fixture sanity: {label!r} not even rendered"
    for label in ["ROOM %", "HARDNESS", "STYLE", "SUBTLETY", "FLOOR", "SPACING", "L / R", "ZOOM", "SAVE VIEW", "RESET VIEW",
                  "SHOWCASE", "UNTOUCHED", "CODES"]:
        assert label in entry, f"lights_build_controls never mentions {label!r}, but the row renders it"
