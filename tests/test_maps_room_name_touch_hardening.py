# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""The Atlas builder's room-name long-press (maps.js, the `for (const rg of
isoDiv.querySelectorAll("g.lroom[data-room]"))` block) — 2026-09-16 finding:
the one gesture on this tab with no touch-action of its own and no pointer
capture, so a real finger's natural micro-drift during the hold could read to
the browser as the start of a scroll (.lv-stage is overflow:auto) and get
silently taken over for panning instead of completing the press.

This gesture is wired inline inside maps.js's render(ctx) — reaching it with
a real pointerdown/pointermove/pointerup sequence needs the WHOLE Atlas builder tab
built (ctx.state.mapsTab="lights", a real model, every render() dependency),
which is disproportionate to what a touch-target hardening fix needs proving
— the door-circle drag handler right next to this one (_wireDoorCircle) is
exercised the same limited way for the same reason (test_lights_door_circle.py).
So this pins the fix at the source level instead: the exact statements a
regression would have to remove or corrupt to reintroduce either bug this
session found — the missing touch-action/capture, and the self-caught
`longPressed` guard mistake (an early draft read `if (!lpTimer && !ring)
return;`, which is wrong because a FIRED setTimeout id stays truthy, so it
would have let post-arm movement cancel an already-armed hold; caught and
fixed before it ever ran).
"""

from __future__ import annotations

import re
from pathlib import Path

_WWW = Path(__file__).resolve().parents[1] / "custom_components" / "padspan_ha" / "www" / "padspan-ha"
_MAPS = (_WWW / "views" / "maps.js").read_text(encoding="utf-8")
_CSS = (_WWW / "styles.css").read_text(encoding="utf-8")


def _room_name_block() -> str:
    start = _MAPS.index('for (const rg of isoDiv.querySelectorAll("g.lroom[data-room]"))')
    # The next top-level loop/section in render() ends this block; the door
    # circle tool comment is the next thing in the file after it.
    end = _MAPS.index("Door/window circle tool: armed by", start)
    return _MAPS[start:end]


def test_room_name_press_sets_touch_action_and_pointer_capture():
    block = _room_name_block()
    assert 'rg.style.touchAction = "none"' in block, \
        "the room-name group must opt out of the browser's native touch scroll/callout"
    assert "rg.setPointerCapture(ev.pointerId)" in block, \
        "the hold must keep receiving pointer events even if the finger drifts off the room name"
    assert 'rg.addEventListener("pointercancel"' in block, \
        "an interrupted hold (OS yanks the touch away) must be cancelled, same as every sibling drag handler"


def test_movement_cancel_guard_checks_armed_not_timer_truthiness():
    """The exact bug: a fired setTimeout id is still truthy, so guarding on
    `!lpTimer` (instead of the `longPressed` boolean) would let movement
    AFTER the hold has already armed cancel it anyway — the one thing every
    other hold in this file guarantees never happens."""
    block = _room_name_block()
    assert "if (longPressed) return;" in block, \
        "the movement-cancel guard must check the armed boolean, not a timer id's truthiness"
    assert "if (!lpTimer && !ring) return;" not in block, \
        "regression: this guard lets post-arm movement cancel an already-armed hold"


def test_lv_stage_suppresses_the_native_long_press_menu_but_keeps_one_finger_pan():
    """-webkit-touch-callout on .lv-stage, never touch-action:none — the map
    relies on the browser's OWN native one-finger scroll to pan (wireStageTouch
    only implements 2-finger pinch-zoom itself), so touch-action:none here would
    silently break panning, not just long-press."""
    m = re.search(r"\.lv-stage\{([^}]*)\}", _CSS, re.S)
    assert m, "no .lv-stage rule found"
    rule = m.group(1)
    declarations = re.sub(r"/\*.*?\*/", "", rule, flags=re.S).replace("\n", "").replace(" ", "")
    assert "-webkit-touch-callout:none" in declarations, rule
    assert "touch-action:none" not in declarations, \
        "touch-action:none on .lv-stage would break native one-finger pan — regression"


def test_lv_stage_excludes_native_pinch_zoom_but_keeps_native_pan():
    """2026-09-17 finding: leaving touch-action entirely unset (the original
    fix) let the browser's OWN native two-finger pinch-zoom compete with
    wireStageTouch's own JS pinch handling for the same gesture — on a real
    touchscreen the OS/browser zoom quietly won, changing the whole page's
    zoom and resizing the stage out from under wherever the app had just
    scrolled it (Garry: "the system autoadjusts the placement... I think
    the zoom is the one built into windows"). touch-action:pan-x pan-y
    keeps native panning (what the fix above still needs) while excluding
    the browser's own pinch-zoom recognition specifically, leaving
    wireStageTouch as the only thing that can change zoom here."""
    m = re.search(r"\.lv-stage\{([^}]*)\}", _CSS, re.S)
    assert m, "no .lv-stage rule found"
    rule = m.group(1)
    declarations = re.sub(r"/\*.*?\*/", "", rule, flags=re.S).replace("\n", "").replace(" ", "")
    assert "touch-action:pan-xpan-y" in declarations, (
        "must explicitly exclude native pinch-zoom while keeping native pan", rule)
