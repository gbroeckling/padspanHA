# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""The Atlas builder's own marker gesture (maps.js's _wireLightsBuild) — root
cause #1 from the 2026-09-17 touch-interface investigation (confidence 0.93),
deferred pending Garry's decision, then settled the same day: "if I click
anywhere on a shape created to represent a device, most cases a light, the
primary should always be to turn on that light/device. Secondary features
should be more difficult to activate."

Before this fix a plain tap in the builder's Editing mode SELECTED the light
(the inspector's job) and never toggled it at all — the one surface in the
whole app where tapping a device did not switch it, which is what "list of
options are constantly popping up when a single press to turn something on
is pressed" was actually describing: users pressing, getting no toggle,
pressing again or holding longer, which is exactly what fires the browser's
native long-press context menu (_wireLightsPicker's own trigger).

Now: a plain quick tap toggles (matching wireUseSurface, the sidebar's own
already-correct engine); a genuine 500ms+ still hold, or an explicit
Shift/Alt modifier, selects the light for editing instead — the SECONDARY,
harder-to-reach action. A real drag (>8px) still repositions the marker,
unchanged.

Runs the real module under node; skipped, not failed, without node.
"""

from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path

import pytest

_ROOT = Path(__file__).resolve().parents[1]
_VIEWS = _ROOT / "custom_components" / "padspan_ha" / "www" / "padspan-ha" / "views"
_NODE = shutil.which("node")

pytestmark = pytest.mark.skipif(_NODE is None, reason="node is not installed")

_MODEL = {
    "floors": [{"id": "main", "name": "Main", "level": 0}],
    "room_geometry_m": {
        "Kitchen": {"type": "poly", "floor_id": "main", "points_m": [[0, 0], [10, 0], [10, 8], [0, 8]]},
    },
    "light_positions_m": {
        "light.a": {"x_m": 5.0, "y_m": 4.0, "floor_id": "main"},
    },
}


def _run(script: str) -> dict:
    src = (
        "import { pathToFileURL } from 'node:url';\n"
        f"const {{ install, flush }} = await import(pathToFileURL({json.dumps(str(_ROOT / 'tests' / 'js' / 'dom_shim.mjs'))}).href);\n"
        "install(globalThis);\n"
        f"const M = await import(pathToFileURL({json.dumps(str(_VIEWS / 'maps.js'))}).href);\n"
        f"const IL = await import(pathToFileURL({json.dumps(str(_VIEWS / 'iso_lights.js'))}).href);\n"
        f"const MODEL = {json.dumps(_MODEL)};\n"
        "const frame = IL.fabricFrame(MODEL, MODEL.floors, 150, 0);\n"
        "const renderCalls = [];\n"
        "const toggleCalls = [];\n"
        "function el(tag, attrs, children) {\n"
        "  const n = document.createElement(tag);\n"
        "  for (const [k, v] of Object.entries(attrs || {})) {\n"
        "    if (k === 'class') n.className = v;\n"
        "    else if (k.startsWith('on') && typeof v === 'function') n.addEventListener(k.slice(2), v);\n"
        "    else if (v !== undefined && v !== null) n.setAttribute(k, String(v));\n"
        "  }\n"
        "  for (const c of (Array.isArray(children) ? children : [children === undefined ? [] : children])) {\n"
        "    if (c === null || c === undefined) continue;\n"
        "    n.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);\n"
        "  }\n"
        "  return n;\n"
        "}\n"
        "const ctx = { state: { model: MODEL }, hass: {}, toast: () => {}, helpers: { el },\n"
        "  actions: { renderRooms: () => renderCalls.push(1) } };\n"
        "const o = { mapState: {}, view: { floorGap: 150, horizGap: 0 }, lightsByEid: {}, model: MODEL,\n"
        "  onDropPlace: () => {}, toggle: (eid) => toggleCalls.push(eid) };\n"
        "const NS = 'http://www.w3.org/2000/svg';\n"
        "const isoDiv = document.createElement('div');\n"
        "const svg = document.createElementNS(NS, 'svg');\n"
        "isoDiv.appendChild(svg);\n"
        # toVB() needs a real SVGPoint/getScreenCTM the node shim does not
        # implement (same limitation test_lights_door_circle.py documents
        # for _wireDoorCircle) — an identity stub is enough here since these
        # tests only need clientX/clientY deltas to arm/not-arm the drag
        # threshold, never real projected coordinates.
        "svg.createSVGPoint = () => { const p = { x: 0, y: 0 }; p.matrixTransform = () => ({ x: p.x, y: p.y }); return p; };\n"
        "svg.getScreenCTM = () => ({ inverse: () => ({}) });\n"
        "const g = document.createElementNS(NS, 'g');\n"
        "g.setAttribute('class', 'lhex');\n"
        "g.setAttribute('data-eid', 'light.a');\n"
        "const [hx, hy] = frame.iso(5.0, 4.0, frame.levelOf('main'));\n"
        "g.setAttribute('data-cx', String(hx));\n"
        "g.setAttribute('data-cy', String(hy));\n"
        "g.setAttribute('data-z', String(frame.levelOf('main')));\n"
        "svg.appendChild(g);\n"
        "M._wireLightsBuild(ctx, isoDiv, o);\n"
        "const out = { renderCalls, toggleCalls };\n" + script + "\nconsole.log(JSON.stringify(out));\n"
    )
    res = subprocess.run([_NODE, "--input-type=module", "-e", src], capture_output=True,
                         text=True, encoding="utf-8", timeout=60, cwd=str(_VIEWS))
    assert res.returncode == 0, f"node failed:\n{res.stderr}"
    return json.loads(res.stdout.strip().splitlines()[-1])


def test_a_plain_quick_tap_toggles_the_device():
    out = _run("""
g.dispatchEvent({ type: 'pointerdown', button: 0, pointerType: 'mouse', pointerId: 1,
  clientX: 0, clientY: 0, preventDefault(){}, stopPropagation(){} });
g.dispatchEvent({ type: 'pointerup', pointerId: 1, clientX: 0, clientY: 0 });
out.selLight = o.mapState._selLight || null;
""")
    assert out["toggleCalls"] == ["light.a"], (
        "a plain quick tap must toggle the device, not select it", out)
    assert out["selLight"] is None, "a quick tap must not also select the light for editing"


def test_a_genuine_hold_selects_instead_of_toggling():
    """The secondary action, now gated behind a real still hold — the SAME
    HOLD_MS this handler already tracked for the table-jump, just repointed
    at select instead of toggle. dom_shim queues timers rather than firing
    them on a real clock (so a render that defers work cannot silently skip
    it); flush() runs the queued HOLD_MS callback directly, which is exactly
    what a real 500ms still hold does to `longPressed` — no real wait needed."""
    out = _run("""
g.dispatchEvent({ type: 'pointerdown', button: 0, pointerType: 'mouse', pointerId: 1,
  clientX: 0, clientY: 0, preventDefault(){}, stopPropagation(){} });
await flush();
g.dispatchEvent({ type: 'pointerup', pointerId: 1, clientX: 0, clientY: 0 });
out.selLight = o.mapState._selLight || null;
""")
    assert out["toggleCalls"] == [], ("a genuine hold must never toggle", out)
    assert out["selLight"] and out["selLight"]["eid"] == "light.a", (
        "a genuine hold must select the light for editing", out)


def test_shift_click_still_multiselects_without_toggling():
    """An explicit modifier is already a deliberate, harder-to-reach input —
    it keeps selecting/multi-selecting immediately, same as before, never
    toggling underneath it."""
    out = _run("""
g.dispatchEvent({ type: 'pointerdown', button: 0, pointerType: 'mouse', pointerId: 1,
  clientX: 0, clientY: 0, shiftKey: true, preventDefault(){}, stopPropagation(){} });
g.dispatchEvent({ type: 'pointerup', pointerId: 1, clientX: 0, clientY: 0, shiftKey: true });
out.selLight = o.mapState._selLight || null;
""")
    assert out["toggleCalls"] == [], out
    assert out["selLight"] and out["selLight"]["eid"] == "light.a", out


def test_a_pointercancel_neither_toggles_nor_selects():
    """A cancelled gesture (the OS yanking the touch away) does nothing at
    all — matching every sibling drag handler's own pointercancel discipline
    on this tab, extended here to the tap/toggle path too."""
    out = _run("""
g.dispatchEvent({ type: 'pointerdown', button: 0, pointerType: 'mouse', pointerId: 1,
  clientX: 0, clientY: 0, preventDefault(){}, stopPropagation(){} });
g.dispatchEvent({ type: 'pointercancel', pointerId: 1, clientX: 0, clientY: 0 });
out.selLight = o.mapState._selLight || null;
""")
    assert out["toggleCalls"] == [], out
    assert out["selLight"] is None, out
    assert out["renderCalls"] == [], "a cancelled tap must not even trigger a re-render"


def test_a_real_drag_still_repositions_not_toggle_or_select():
    out = _run("""
g.dispatchEvent({ type: 'pointerdown', button: 0, pointerType: 'mouse', pointerId: 1,
  clientX: 0, clientY: 0, preventDefault(){}, stopPropagation(){} });
g.dispatchEvent({ type: 'pointermove', pointerId: 1, clientX: 40, clientY: 40 });
g.dispatchEvent({ type: 'pointerup', pointerId: 1, clientX: 40, clientY: 40 });
out.draft = o.mapState._lightsDraftM || null;
""")
    assert out["toggleCalls"] == [], "a real drag must never toggle"
    assert out["draft"] and "light.a" in out["draft"], "a real drag must still reposition the light"


# ── Slop is screen pixels, never viewBox units (Garry, 2026-09-19: "press and
# hold doesn't work for all devices") ───────────────────────────────────────
# toVB() deltas scale with how the drawing is fitted/zoomed. On a big house
# shown small, one screen pixel is several viewBox units, so the old
# "3 viewBox units cancels the hold / 8 arms the drag" tripped on sub-pixel
# jitter: a hold never completed and a plain tap could count as a drag and
# nudge the fixture. _ZOOMED_OUT makes 1 screen px = 6 viewBox units.
_ZOOMED_OUT = "svg.createSVGPoint = () => { const p = { x: 0, y: 0 }; p.matrixTransform = () => ({ x: p.x * 6, y: p.y * 6 }); return p; };\n"


def test_a_jittery_tap_on_a_zoomed_out_map_still_toggles_and_never_moves_the_light():
    out = _run(_ZOOMED_OUT + """
g.dispatchEvent({ type: 'pointerdown', button: 0, pointerType: 'mouse', pointerId: 1,
  clientX: 100, clientY: 100, preventDefault(){}, stopPropagation(){} });
g.dispatchEvent({ type: 'pointermove', pointerId: 1, clientX: 102, clientY: 101 });
g.dispatchEvent({ type: 'pointerup', pointerId: 1, clientX: 102, clientY: 101 });
out.draft = o.mapState._lightsDraftM || null;
""")
    assert out["toggleCalls"] == ["light.a"], ("2px of mouse jitter is a tap, whatever the zoom", out)
    assert not out["draft"], ("a tap must never reposition the fixture", out)


def test_a_finger_hold_that_rolls_a_few_pixels_still_arms_and_jumps_to_the_row():
    out = _run(_ZOOMED_OUT + """
g.dispatchEvent({ type: 'pointerdown', button: 0, pointerType: 'touch', pointerId: 1,
  clientX: 100, clientY: 100, preventDefault(){}, stopPropagation(){} });
g.dispatchEvent({ type: 'pointermove', pointerId: 1, clientX: 104, clientY: 103 });
await flush();
g.dispatchEvent({ type: 'pointerup', pointerId: 1, clientX: 105, clientY: 104 });
out.selLight = o.mapState._selLight || null;
out.focusRow = o.mapState._focusRow || null;
out.draft = o.mapState._lightsDraftM || null;
""")
    assert out["toggleCalls"] == [], ("a genuine hold must never toggle", out)
    assert out["selLight"] and out["selLight"]["eid"] == "light.a", out
    assert out["focusRow"] == "light.a", ("the hold is what jumps the index to the row", out)
    assert not out["draft"], out


def test_a_mouse_that_slides_off_before_the_hold_arms_cancels_the_jump():
    """The 2026-09-11 rule survives: only a STILL press arms — a slow careful
    drag that is released short of the drag threshold does nothing at all."""
    out = _run("""
g.dispatchEvent({ type: 'pointerdown', button: 0, pointerType: 'mouse', pointerId: 1,
  clientX: 100, clientY: 100, preventDefault(){}, stopPropagation(){} });
g.dispatchEvent({ type: 'pointermove', pointerId: 1, clientX: 106, clientY: 100 });
await flush();
g.dispatchEvent({ type: 'pointerup', pointerId: 1, clientX: 106, clientY: 100 });
out.focusRow = o.mapState._focusRow || null;
""")
    assert out["focusRow"] is None, out


# ── A linked door/window/lock section can be held too ───────────────────────
_BARHIT = """
const hb = document.createElementNS(NS, 'polyline');
hb.setAttribute('class', 'lbarhit');
hb.setAttribute('data-eid', 'binary_sensor.frontdoor');
hb.setAttribute('data-cx', '10'); hb.setAttribute('data-cy', '10');
svg.appendChild(hb);
o.model = { ...MODEL, rf_barriers_m: [{ id: 'b1', floor_id: 'main', linked_entity_id: 'binary_sensor.frontdoor', name: 'Front Door' }] };
ctx.hass = { states: { 'binary_sensor.frontdoor': { state: 'off', attributes: {} } } };
M._wireLightsBuild(ctx, isoDiv, o);
"""


def test_a_hold_on_a_door_section_jumps_the_index_to_its_row():
    out = _run(_BARHIT + """
hb.dispatchEvent({ type: 'pointerdown', button: 0, pointerType: 'touch', pointerId: 2,
  clientX: 50, clientY: 50, preventDefault(){}, stopPropagation(){} });
await flush();
hb.dispatchEvent({ type: 'pointerup', pointerId: 2, clientX: 52, clientY: 51 });
out.focusRow = o.mapState._focusRow || null;
""")
    assert out["focusRow"] == "binary_sensor.frontdoor", out
    assert out["toggleCalls"] == [], out


def test_a_tap_on_a_door_or_lock_section_opens_its_card_not_the_index_row():
    """A door has nothing to switch and a lock must never be one stray tap
    from unlocking — so a plain tap must never toggle anything or select
    the row for editing (that's the HOLD's job, tested above). Garry,
    2026-09-22: it should instead open the same open/closed card the Atlas
    sidebar offers — a tap is safe because the card itself changes nothing;
    only a button pressed INSIDE it would."""
    out = _run(_BARHIT + """
hb.dispatchEvent({ type: 'pointerdown', button: 0, pointerType: 'mouse', pointerId: 2,
  clientX: 50, clientY: 50, preventDefault(){}, stopPropagation(){} });
hb.dispatchEvent({ type: 'pointerup', pointerId: 2, clientX: 50, clientY: 50 });
out.focusRow = o.mapState._focusRow || null;
out.cardOpened = document.body.children.length > 0;
""")
    assert out["focusRow"] is None, "a tap must not select the row for editing"
    assert out["toggleCalls"] == [] and out["renderCalls"] == [], "a tap must never itself change anything"
    assert out["cardOpened"] is True, "a tap must open the barrier's own card"


def test_a_second_touch_on_the_same_door_section_does_not_hijack_the_first():
    """A second pointerdown on the same lbarhit before the first pointer's
    up/cancel (two fingers, or a rapid re-press) must not overwrite the
    first gesture's timers/capture — found in the Phase 2a press-and-hold
    audit, 2026-09-19."""
    out = _run(_BARHIT + """
hb.dispatchEvent({ type: 'pointerdown', button: 0, pointerType: 'touch', pointerId: 2,
  clientX: 50, clientY: 50, preventDefault(){}, stopPropagation(){} });
hb.dispatchEvent({ type: 'pointerdown', button: 0, pointerType: 'touch', pointerId: 3,
  clientX: 80, clientY: 80, preventDefault(){}, stopPropagation(){} });
await flush();
hb.dispatchEvent({ type: 'pointerup', pointerId: 2, clientX: 51, clientY: 50 });
out.focusRow = o.mapState._focusRow || null;
""")
    assert out["focusRow"] == "binary_sensor.frontdoor", (
        "the first pointer's hold must still complete — a second pointerdown must be ignored, not take over", out)
