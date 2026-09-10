# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""The Lights map's arrow-key nudge only fires while the pointer is over it.

Garry, 2026-09-09: "some of the motion sensors on the lights tab are
beginning to wander from their locations." Root cause, by code review: the
map stage keeps DOM keyboard focus for as long as nothing else takes it —
clicking non-interactive page content (reading something, say) never moves
focus away — so a selection made minutes earlier could still silently absorb
an arrow key pressed for an unrelated reason and nudge it a step, with
nothing on screen to notice by. maps.js's _wireLightsBuild now refuses a
nudge unless the pointer is actually over the stage right now — the same
gate map/canvas tools everywhere use for keyboard shortcuts.

The flag lives on mapState, not on isoDiv itself, and that placement is
load-bearing, not incidental: isoDiv is a brand-new DOM element on every
full ctx.actions.renderRooms() (selecting a light IS such a render), so a
flag on the node would silently reset to "not hovering" on the very next
render even while the pointer never left the stage — an adversarial review
pass caught this on the first version, which tracked it on isoDiv and broke
the single most common sequence: click a light, then immediately press an
arrow key without moving the mouse again. mapState survives across renders,
so a real pointerenter stays true through any number of rebuilds until an
actual pointerleave.

_wireLightsBuild itself needs a real SVGPoint/getScreenCTM the dom_shim does
not implement (see tests/test_lights_door_circle.py's own note on this), so
this is a source-level pin of the wiring, not a dispatched-keydown behaviour
test — the same tradeoff several other maps.js wiring tests in this suite
already make.

Runs against the real file directly; nothing here needs node.
"""

from __future__ import annotations

from pathlib import Path

_VIEWS = (Path(__file__).resolve().parents[1] / "custom_components" / "padspan_ha"
          / "www" / "padspan-ha" / "views")


def _src() -> str:
    return (_VIEWS / "maps.js").read_text(encoding="utf-8", errors="replace")


def _wire_lights_build_block() -> str:
    src = _src()
    start = src.index("function _wireLightsBuild(ctx, isoDiv, o) {")
    block = src[start:]
    return block[:block.index("\nfunction ", 1)]


def test_hover_flag_lives_on_mapstate_not_the_dom_node():
    """The load-bearing part of the fix: isoDiv is recreated on every full
    render, mapState is not."""
    block = _wire_lights_build_block()
    assert "mapState._stageHovering" in block, block
    assert "isoDiv._hovering" not in block, (
        "a flag on isoDiv itself resets on every re-render even while the "
        "pointer never left the stage — this must stay on mapState"
    )


def test_hover_state_is_tracked_by_hand_not_the_css_pseudo_class():
    block = _wire_lights_build_block()
    assert 'isoDiv.addEventListener("pointerenter"' in block, block
    assert 'isoDiv.addEventListener("pointerleave"' in block, block
    assert "mapState._stageHovering = true" in block, block
    assert "mapState._stageHovering = false" in block, block
    assert "if (!ms._stageHovering) return;" in block, (
        "the nudge gate must read the hand-tracked flag, not "
        "Element.matches(':hover') — the node test harness's dom_shim has no "
        "CSS engine to resolve that against"
    )


def test_the_flag_is_only_initialized_once_not_reset_every_wiring_pass():
    """_wireLightsBuild also re-runs on every rebuildISO() (a slider drag,
    say) within a SINGLE full render, reusing the same isoDiv — the flag
    must not be stomped back to false on those, only ever set the first
    time it's undefined."""
    block = _wire_lights_build_block()
    assert "if (mapState._stageHovering === undefined) mapState._stageHovering = false;" in block, block


def test_touch_never_arms_the_hover_gate():
    """A touch device has no physical arrow keys to send in the first
    place, but a stray touch-originated pointerenter must not arm the gate
    for whatever keyboard IS attached (a tablet with a paired keyboard,
    say) — hover is a mouse/trackpad concept."""
    block = _wire_lights_build_block()
    idx = block.index('addEventListener("pointerenter"')
    snippet = block[idx: idx + 160]
    assert 'ev.pointerType !== "touch"' in snippet, snippet


def test_nudge_is_gated_on_hover_but_escape_and_undo_are_not():
    """Escape and Ctrl+Z/Ctrl+Y never write a new position — only the
    directional nudge itself needs the hover gate; requiring it for undo/
    escape too would make them randomly unavailable."""
    block = _wire_lights_build_block()
    hover_check = block.index("if (!ms._stageHovering) return;")
    escape_idx = block.index('ev.key === "Escape"')
    undo_idx = block.index('ev.key.toLowerCase() === "z"')
    d_lookup_idx = block.index("const d = { ArrowLeft:")
    assert escape_idx < hover_check, "Escape must not require the hover gate"
    assert undo_idx < hover_check, "Undo/redo must not require the hover gate"
    assert d_lookup_idx < hover_check, (
        "the hover check must come after the arrow-key lookup, so a non-arrow "
        "key (already handled or ignored above) never even reaches it"
    )


def test_pointerenter_and_pointerleave_are_wired_exactly_once_per_isodiv():
    """These listeners must stay inside the _keysWired guard — moving them
    out would re-attach a fresh pointerenter/pointerleave listener on every
    rebuildISO() within one render, accumulating duplicates on the same
    isoDiv instance."""
    block = _wire_lights_build_block()
    guard_idx = block.index("if (!isoDiv._keysWired) {")
    enter_idx = block.index('isoDiv.addEventListener("pointerenter"')
    leave_idx = block.index('isoDiv.addEventListener("pointerleave"')
    keydown_idx = block.index('isoDiv.addEventListener("keydown"')
    assert guard_idx < enter_idx < keydown_idx, "pointerenter must be wired inside the _keysWired guard"
    assert guard_idx < leave_idx < keydown_idx, "pointerleave must be wired inside the _keysWired guard"
