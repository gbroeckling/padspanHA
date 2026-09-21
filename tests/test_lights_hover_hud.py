"""The Lights map hover HUD and the builder's Alt+click stack cycle, pinned at
the source level.

Garry (2026-09-12): "add a mouse over in the upper left so I can clearly see
the device a click would have me work on. Also make it so the device
underneath can also be selected somehow, and showing in the mouseover text."
Then (2026-09-14): "the mouse over works in mapping, lights, but not in lights
tab" — it had been builder-only glue in maps.js; the HUD now lives in the
shared views/lights_map.js (wireHoverHud) and BOTH hosts wire it, each giving
"Under" its own meaning. The wiring is UI glue (verified live, like the rest
of _wireLightsBuild); these tests pin the things that would silently break
it — the shadow-DOM-correct hit test, the box staying on screen, the
Alt+click cycle reading from that same hit test, and both hosts actually
wiring it.
"""

from __future__ import annotations

import re
from pathlib import Path

_WWW = Path(__file__).resolve().parents[1] / "custom_components" / "padspan_ha" / "www" / "padspan-ha"
_MAPS = (_WWW / "views" / "maps.js").read_text(encoding="utf-8")
_LM = (_WWW / "views" / "lights_map.js").read_text(encoding="utf-8")
_PANEL = (_WWW / "lights_panel.js").read_text(encoding="utf-8")
_CSS = (_WWW / "styles.css").read_text(encoding="utf-8")


def _block(src: str, start: str, end: str) -> str:
    i = src.index(start)
    return src[i:src.index(end, i)]


def _shared_hud() -> str:
    return _block(_LM, "export function wireHoverHud(", "export function wireUseSurface(")


def test_the_hud_hit_tests_through_the_panels_own_shadow_root():
    """document.elementsFromPoint stops at the shadow host and never sees the
    SVG — the panel lives in shadow DOM, so the stage's own root must do the
    hit test, topmost first, or "Click" names nothing at all."""
    hud = _shared_hud()
    assert "isoDiv.getRootNode()" in hud
    assert ".elementsFromPoint(x, y)" in hud
    assert 'closest("g.lhex[data-eid]")' in hud, "the stack is markers only"
    assert 'closest("g.lroom[data-room]")' in hud, "a bare room click is named too"
    # Reading the HUD (pointer over it) must not clear it.
    assert "hud.contains(ev.target)" in hud


def test_the_builder_wires_the_hud_and_alt_click_cycles_the_same_stack():
    """maps.js keeps a thin wrapper whose "Under" SELECTS the marker for the
    inspector; the Alt+click cycle in the marker handler reads from the same
    stackAt the HUD shows."""
    wrapper = _block(_MAPS, "function _wireHoverHud(", "function _wireLightsPicker(")
    assert "wireHoverHud(isoDiv, {" in wrapper, "the builder no longer uses the shared HUD"
    assert "o.mapState._selLight = { eid, mapId: null };" in wrapper, "the builder's Under must select"
    assert "isDragging: () => !!o.mapState._editDragging" in wrapper
    # No second, drifting copy of the hit test left behind in maps.js.
    assert ".elementsFromPoint(x, y)" not in wrapper
    build = _block(_MAPS, "function _wireLightsBuild(", "function _wireHoverHud(")
    assert "const stackAt = _wireHoverHud(ctx, isoDiv, svg, o);" in build
    click = _block(build, "let selEid = eid;", "ctx.actions.renderRooms();")
    assert "(e.altKey || ev.altKey) && stackAt" in click
    assert "stackAt(e.clientX, e.clientY)" in click
    assert "stack[i < 0 ? 1 : (i + 1) % stack.length]" in click
    assert "o.mapState._selLight = { eid: selEid, mapId: null };" in click


def test_the_sidebar_wires_the_same_hud():
    """Garry, 2026-09-14: "the mouse over works in mapping, lights, but not in
    lights tab". The sidebar has no selection, so its "Under" does what a
    tap on that marker does (motion -> activity, holdable -> controls, else
    toggle) — the SAME api wireUseSurface acts through."""
    import_block = _block(_PANEL, "const { ensureLightsRegistry", "await import(`./views/lights_map.js")
    assert re.search(r"\bwireHoverHud\b", import_block), import_block
    hooks = _block(_PANEL, "onHexesBuilt: (isoDiv)=>{", "onRowClick:")
    assert "wireUseSurface(isoDiv, api);" in hooks and "wireHoverHud(isoDiv, {" in hooks
    assert "api.openActivity(eid)" in hooks and "api.openControls(eid)" in hooks and "api.toggle(eid)" in hooks
    # The sidebar's shadow root loads the stylesheet the HUD classes live in.
    assert "styles.css" in _PANEL and ".lv-hoverhud{" in _CSS


def test_the_hud_rides_the_stages_scroll_without_pushing_the_drawing():
    assert ".lv-hoverhud-anchor{position:sticky;top:0;left:0;height:0;" in _CSS
    assert ".lv-hoverhud{position:absolute;top:0;left:0;" in _CSS


def test_the_hud_stays_inside_the_viewport_when_the_page_scrolls():
    """Garry, 2026-09-14: "mouse over no longer works on the lights tab". Live,
    it worked — the box filled correctly, 291px ABOVE the window. The anchor
    is sticky within the stage's own scroll box, but the page scrolls too,
    and once the stage's top edge is above the viewport the anchor and the
    box go with it. show() must re-measure the anchor on every hover and pin
    the box to the top-left of the VISIBLE part of the stage — before the
    same-content early return, so a page scroll mid-hover moves it too.
    And below a sticky toolbar (the builder's .lv-toolbar-sticky, z-index 20
    over the box's 5): pinned to the viewport top alone the box sat exactly
    under that bar — on-screen by the numbers, invisible in fact."""
    hud = _shared_hud()
    place = _block(hud, "const place = () => {", "};")
    assert "anchor.getBoundingClientRect()" in place
    assert "Math.max(0, -a.left)" in place
    assert "hud.style.top" in place and "hud.style.left" in place
    assert '.lv-toolbar-sticky' in place and "getBoundingClientRect().bottom" in place
    assert "Math.max(visibleTop, a.top) - a.top" in place
    assert ".lv-toolbar-sticky{position:sticky;top:0;z-index:20;" in _CSS
    show = _block(hud, "const show = (stack, room) => {", "};\n  isoDiv.addEventListener(\"pointermove\"")
    assert show.index("place();") < show.index("const key ="), (
        "the box must be repositioned even before content is evaluated at all"
    )
