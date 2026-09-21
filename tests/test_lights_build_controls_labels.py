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
        f"const {{ install, flush }} = await import(pathToFileURL({json.dumps(str(_ROOT / 'tests' / 'js' / 'dom_shim.mjs'))}).href);\n"
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


def test_pan_position_survives_a_full_rebuild_of_the_card(tmp_path):
    """2026-09-17 finding, live: buildLightsMapCard creates a BRAND NEW
    isoDiv every time it's called — every poll-triggered re-render of the
    Atlas tab rebuilds the whole card from scratch, not just an in-place
    rebuildISO(). A fresh div starts at scrollLeft/scrollTop 0 regardless
    of where the user had just pinched-and-panned to, which reads as
    "the system auto-adjusts the placement" — the touch-action fix (styles.css)
    stopped the BROWSER's own pinch-zoom from fighting the app's, but did
    nothing about a poll landing right after a real pinch finished and
    silently resetting the pan a moment later. view (the same persistent
    object zoom already lives on) now carries the pan position across
    rebuilds too.

    2026-09-21 correction, still live despite this test passing: the
    restore ran synchronously inside buildLightsMapCard, before the
    caller's own appendChild puts the returned card into the real
    document — setting scrollLeft/scrollTop on an element with no layout
    box yet is a silent no-op in a real browser, so every poll rebuild was
    still dropping the pan back to 0,0. This shim doesn't model that
    attached-vs-detached distinction (a bare assignment "works" here
    either way), which is exactly how the original bug passed this test
    while still reproducing live. The fix defers the restore one
    requestAnimationFrame so it runs after attachment; card2 is now
    actually appended to the document, and the frame is flushed, to
    exercise the real order of operations as closely as this harness can."""
    out = _run(_EL_JS + (
        f"const MODEL={json.dumps(_MODEL)};\n"
        "const view = { floorGap: 150, horizGap: 0, focusIdx: 0, zoom: 1 };\n"
        "const host = {\n"
        "  el, floors: MODEL.floors, model: MODEL, tier: 'pro', byRoom: {}, lightsByEid: {}, lightsLoading: false,\n"
        "  hiddenEids: new Set(), view,\n"
        "  saveView: async () => {}, callWS: async () => ({}), toast: () => {},\n"
        "  onHexesBuilt: () => {}, onRowClick: () => {}, onToggleHidden: () => {}, afterAssign: () => {},\n"
        "};\n"
        "const card1 = LM.buildLightsMapCard(host);\n"
        "document.body.appendChild(card1);\n"
        "const stage1 = card1.querySelector('.lv-stage');\n"
        "stage1.scrollLeft = 123; stage1.scrollTop = 45;\n"
        "stage1.dispatchEvent({ type: 'scroll' });\n"
        "card1.remove();\n"
        "const card2 = LM.buildLightsMapCard(host);\n"
        "document.body.appendChild(card2);\n"
        "await flush();\n"
        "const stage2 = card2.querySelector('.lv-stage');\n"
        "out.sameNode = stage1 === stage2;\n"
        "out.scrollLeft = stage2.scrollLeft;\n"
        "out.scrollTop = stage2.scrollTop;\n"
    ))
    assert out["sameNode"] is False, "the rebuild must produce a genuinely fresh stage element, not reuse the old one"
    assert out["scrollLeft"] == 123 and out["scrollTop"] == 45, (
        "a fresh isoDiv from a card rebuild must restore the pan position the previous one had", out)


def test_pan_position_defaults_to_zero_on_the_very_first_mount(tmp_path):
    """No prior scroll to restore yet — must not throw, and must leave the
    stage at its natural 0,0 start."""
    out = _run(_base_host("") + (
        "const stage = card.querySelector('.lv-stage');\n"
        "out.scrollLeft = stage.scrollLeft; out.scrollTop = stage.scrollTop;\n"
    ))
    assert out["scrollLeft"] == 0 and out["scrollTop"] == 0, out


# ResizeObserver's real browser behaviour — firing once immediately on
# observe(), delivering the initial size — is what the dom shim's own
# no-op stub does not do, so these two tests install a minimal stand-in
# that does, purely to prove the WIRING (which element is observed, what
# its callback writes) rather than anything about layout math itself.
_RESIZE_OBSERVER_OVERRIDE = (
    "globalThis.__roObserved = [];\n"
    "globalThis.ResizeObserver = class {\n"
    "  constructor(cb) { this.cb = cb; }\n"
    "  observe(el) { globalThis.__roObserved.push(el); this.cb([{ target: el }]); }\n"
    "  unobserve() {} disconnect() {}\n"
    "};\n"
)


def test_sticky_toolbar_gets_a_spacer_sized_to_its_real_height(tmp_path):
    """2026-09-17 finding: ctrlRow and isoDiv are SIBLINGS under mapCard, and
    isoDiv is .lv-stage — its OWN internally-scrollable box — so a sticky
    ctrlRow (position:sticky pins to the nearest ANCESTOR scroll context,
    not a sibling's own scroll) pins against the outer PAGE scroll and can
    float over the map's markers instead of reserving room above them. A
    spacer sibling, kept at the toolbar's live rendered height via
    ResizeObserver (never a guessed constant — the row wraps differently by
    viewport width and which panels are open), holds that space open."""
    out = _run(_RESIZE_OBSERVER_OVERRIDE + _base_host("  stickyToolbar: true,\n") + (
        "const ctrlRow = card.querySelector('.lv-toolbar');\n"
        "const isoDiv = card.querySelector('.lv-stage');\n"
        "const kids = [...card.children];\n"
        "const spacer = kids.find(c => c.getAttribute && c.getAttribute('style') === 'flex:0 0 auto');\n"
        "out.hasSpacer = !!spacer;\n"
        "out.spacerBeforeIsoDiv = !!spacer && kids.indexOf(spacer) < kids.indexOf(isoDiv);\n"
        "out.observedCtrlRow = globalThis.__roObserved.includes(ctrlRow);\n"
        "out.spacerHeight = spacer ? spacer.style.height : null;\n"
        "out.rectHeight = ctrlRow.getBoundingClientRect().height;\n"
    ))
    assert out["hasSpacer"] is True, "a sticky toolbar must get a spacer sibling"
    assert out["spacerBeforeIsoDiv"] is True, "the spacer must sit above isoDiv, not below it"
    assert out["observedCtrlRow"] is True, "the ResizeObserver must observe the real control row, not a guess"
    assert out["spacerHeight"] == f'{out["rectHeight"]}px', (
        "the spacer's height must track the control row's actual rendered height", out)


def test_no_stray_spacer_when_the_toolbar_is_not_sticky(tmp_path):
    """The sidebar host (lights_panel.js, stickyToolbar unset) never had the
    sticky-overlap problem — it must get no spacer and no ResizeObserver at
    all, not just an invisible/zero-height one."""
    out = _run(_RESIZE_OBSERVER_OVERRIDE + _base_host("") + (
        "const kids = [...card.children];\n"
        "out.hasSpacer = kids.some(c => c.getAttribute && c.getAttribute('style') === 'flex:0 0 auto');\n"
        "out.observedAnything = globalThis.__roObserved.length > 0;\n"
    ))
    assert out["hasSpacer"] is False, "a non-sticky host must get no spacer div at all"
    assert out["observedAnything"] is False, "a non-sticky host must never even construct a ResizeObserver"


def test_show_beacons_toggle_is_opt_in_and_off_by_default(tmp_path):
    """Garry, 2026-09-09: "Show beacons on lighting page should be
    selectable, and off by default." The button itself only exists when the
    host wires onShowBeacons (the Mapping builder does; the sidebar never
    passed beacons in the first place), and even then starts unchecked."""
    out = _run(_base_host("") + (
        "out.found = !!card.querySelector('.lv-tgl.tone-teal')"
        " && [...card.querySelectorAll('button')].some(b => b.textContent.includes('Show beacons'));\n"
    ))
    assert out["found"] is False, "no onShowBeacons on the host must render no beacons toggle at all"

    out = _run(_base_host("  showBeacons: false, onShowBeacons: () => {},\n") + (
        "const btns = [...card.querySelectorAll('button')].filter(b => b.textContent.includes('Beacons') || b.textContent.includes('beacons'));\n"
        "out.count = btns.length;\n"
        "out.text = btns[0] ? btns[0].textContent : null;\n"
        "out.on = btns[0] ? btns[0].classList.contains('on') : null;\n"
    ))
    assert out["count"] == 1, out
    assert out["text"] == "◉ Show beacons", out
    assert out["on"] is False, "must not default to the 'on' visual state"

    out = _run(_base_host("  showBeacons: true, onShowBeacons: () => {},\n") + (
        "const btn = [...card.querySelectorAll('button')].find(b => b.textContent.includes('Beacons'));\n"
        "out.text = btn.textContent; out.on = btn.classList.contains('on');\n"
    ))
    assert out["text"] == "◉ Beacons shown", out
    assert out["on"] is True


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
