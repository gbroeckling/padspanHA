"""The control-from-a-map ergonomics strategy, exercised for real.

Garry: "Figure out a strategy for utilizing this concept better ergonomically
by looking at the competition's use of mapping for lights" — a Claude research
agent and a Codex pass converged on the same short list (split tap target,
room/floor aggregates, spread-in-room bulk placement, semantic zoom, per-class
filtering, a real touch pipeline, undo, provisional-placement honesty). This
file pins the PURE functions behind that work in views/lights_map.js — the
ones with no DOM and no renderer to lean on, so a regression here cannot hide
behind "the SVG still looked right in the browser".

Renderer-level assertions (codeChip/hideCodes/classFilter/hitHalo/
collapseUnplaced, the room/floor tap targets) live in test_lights_renderer.py
alongside the rest of buildIsoSVG's option surface.

Skipped (not failed) when node is unavailable.
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
_SHIM = Path(__file__).parent / "js" / "dom_shim.mjs"
_NODE = shutil.which("node")

pytestmark = pytest.mark.skipif(_NODE is None, reason="node is not installed")

_QUERY = "${new URL(import.meta.url).search}"


def _stage(tmp_path: Path) -> None:
    """Same staging as test_lights_free_gate.py — the shared pipeline and its
    imports, copied to .mjs with specifiers rewritten so node can run them."""
    for name in ("lights_map", "iso_lights", "light_codes", "room_color", "editions", "wall_geom"):
        src = (_VIEWS / f"{name}.js").read_text(encoding="utf-8")
        for dep in ("iso_lights", "light_codes", "editions"):
            src = src.replace(f"./{dep}.js{_QUERY}", f"./{dep}.mjs")
        src = src.replace('"./room_color.js"', '"./room_color.mjs"')
        src = src.replace('"./wall_geom.js"', '"./wall_geom.mjs"')
        (tmp_path / f"{name}.mjs").write_text(src, encoding="utf-8")
    shutil.copy(_SHIM, tmp_path / "dom_shim.mjs")


def _run(tmp_path: Path, script_body: str) -> dict:
    _stage(tmp_path)
    script = ("import { install } from './dom_shim.mjs';\ninstall(globalThis);\n"
              "const LM = await import('./lights_map.mjs');\n" + script_body)
    (tmp_path / "run.mjs").write_text(script, encoding="utf-8")
    res = subprocess.run([_NODE, str(tmp_path / "run.mjs")], capture_output=True,
                         text=True, encoding="utf-8", timeout=120)
    assert res.returncode == 0, f"node failed:\n{res.stderr[-4000:]}"
    return json.loads(res.stdout.strip().splitlines()[-1])


# ── The hold/tap/drag gesture ────────────────────────────────────────────────

def test_hold_tracker_distinguishes_tap_hold_and_drag(tmp_path):
    """Garry's own affordance problem, from the ergonomics research: a bare
    500ms hold is undiscoverable and, worse, a naive implementation can fire
    the toggle on release even after a hold — createHoldTracker is the one
    state machine both the sidebar and the builder's Preview drive, so this
    is the single place that bug can be fixed instead of twice."""
    out = _run(tmp_path, r"""
const results = {};

// A quick tap: released well before holdMs, no movement.
{
  const t = LM.createHoldTracker({holdMs: 500, slopPx: 8});
  t.down(100, 100, 0);
  results.quickTap = t.up(120);   // 120ms later
}

// A hold, released without moving: must OPEN, never toggle.
{
  const t = LM.createHoldTracker({holdMs: 500, slopPx: 8});
  t.down(100, 100, 0);
  t.tick(500);                    // the 500ms mark ticks over -> armed
  results.holdOpens = t.up(600);
}

// Movement BEFORE arming cancels to the map (pan) — never a toggle.
{
  const t = LM.createHoldTracker({holdMs: 500, slopPx: 8});
  t.down(100, 100, 0);
  results.earlyMoveCancels = t.move(150, 100);   // 50px, well past slop, before holdMs
}

// Movement after arming, on a draggable target: reports a drag delta.
{
  const t = LM.createHoldTracker({holdMs: 500, slopPx: 8, canDrag: true});
  t.down(100, 100, 0);
  t.tick(500);
  const r = t.move(100, 60);      // 40px up after arming
  results.dragReportsAction = r && r.action;
  results.dragDy = r && r.dy;
  results.dragEndsGesture = t.up(700);
}

// The SAME drag on a non-draggable target (canDrag: false) must not turn
// into a silent drag — the fan card has no relative-brightness gesture.
{
  const t = LM.createHoldTracker({holdMs: 500, slopPx: 8, canDrag: false});
  t.down(100, 100, 0);
  t.tick(500);
  results.nonDraggableMoveIsNull = t.move(100, 60);
}

// Small jitter under the slop, even before arming, is not a cancel — a
// stationary finger is never perfectly still.
{
  const t = LM.createHoldTracker({holdMs: 500, slopPx: 8});
  t.down(100, 100, 0);
  results.jitterIsFine = t.move(102, 101);
}

console.log(JSON.stringify(results));
""")
    assert out["quickTap"] == "tap", out
    assert out["holdOpens"] == "open", "a hold released without moving must OPEN, never toggle"
    assert out["earlyMoveCancels"] == "cancel", "movement before the hold arms must hand the gesture to the map"
    assert out["dragReportsAction"] == "drag" and out["dragDy"] == -40, out
    assert out["dragEndsGesture"] == "drag-end", out
    assert out["nonDraggableMoveIsNull"] is None, "a non-draggable target must never report a drag"
    assert out["jitterIsFine"] is None, "movement under the slop must be silently absorbed"


def test_drag_brightness_maps_a_vertical_sweep_to_the_full_range(tmp_path):
    out = _run(tmp_path, r"""
console.log(JSON.stringify({
  up:   LM.dragBrightness(128, -80),     // halfway up a 160px sweep
  down: LM.dragBrightness(128, 80),      // halfway down
  clampHigh: LM.dragBrightness(200, -500),
  clampLow:  LM.dragBrightness(50, 500),
  noStart:   LM.dragBrightness(undefined, 0),
}));
""")
    assert out["up"] > 128 and out["down"] < 128, out
    assert out["clampHigh"] == 255, "brightness must clamp at 255"
    assert out["clampLow"] == 1, "brightness must clamp at 1, never 0 (that would be off)"
    assert out["noStart"] == 128, "an unknown starting brightness must fall back to a sane midpoint"


def test_wire_use_surface_quick_tap_toggles_and_only_a_real_hold_opens(tmp_path):
    """Garry: "Tapping the code label was never meant to open the card...
    remove that. Quick tap only opens the calendar on the motion items, all
    other require the 500ms tap. quick taps turn things on or off." The code
    chip used to be its own always-open target (stopPropagation on its own
    pointerdown) — that carve-out is gone, so a marker's every pixel now goes
    through the SAME tracker: a quick release toggles, and only a hold that
    genuinely reaches HOLD_MS opens anything. Motion has nothing to switch,
    so its own quick tap opens the activity calendar instead of toggling."""
    out = _run(tmp_path, r"""
function elx(tag, attrs) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) n.setAttribute(k, String(v));
  return n;
}
const isoDiv = document.createElement("div");
const svg = document.createElement("svg");
isoDiv.appendChild(svg);
const lightG = elx("g", {class: "lhex", "data-eid": "light.a", "data-cx": "10", "data-cy": "10"});
const motionG = elx("g", {class: "lhex", "data-eid": "binary_sensor.m", "data-cx": "30", "data-cy": "30"});
svg.appendChild(lightG);
svg.appendChild(motionG);

const calls = [];
const lightsByEid = {
  "light.a": { entity_id: "light.a", dimmable: true, isMotion: false },
  "binary_sensor.m": { entity_id: "binary_sensor.m", isMotion: true, dimmable: false },
};
const api = {
  hass: { states: {} }, lightsByEid,
  controlsFor: (l) => !!(l && l.dimmable),
  toggle: (eid) => calls.push(["toggle", eid]),
  openControls: (eid) => calls.push(["openControls", eid]),
  openActivity: (eid) => calls.push(["openActivity", eid]),
  toast: () => {}, rerender: () => {},
};
LM.wireUseSurface(isoDiv, api);

const noop = { stopPropagation(){}, preventDefault(){} };
function press(g) { g.dispatchEvent({ ...noop, type: "pointerdown", button: 0, pointerType: "mouse", clientX: 0, clientY: 0, pointerId: 1, target: g }); }
function release(g) { g.dispatchEvent({ ...noop, type: "pointerup", pointerId: 1, target: g }); }

// Quick tap on a light: released well inside HOLD_MS -> toggle, never open.
press(lightG); release(lightG);
// Quick tap on motion: opens its calendar, never toggles into the read-only refusal.
press(motionG); release(motionG);
const quickTaps = calls.slice();
// A REAL hold on the light: wait past HOLD_MS (500ms) for real before releasing.
calls.length = 0;
press(lightG);
await new Promise(r => globalThis._realSetTimeout(r, 550));
release(lightG);

console.log(JSON.stringify({ quickTaps, holdCalls: calls }));
""")
    assert out["quickTaps"][0] == ["toggle", "light.a"], f"a quick tap must toggle, not open: {out['quickTaps']}"
    assert out["quickTaps"][1] == ["openActivity", "binary_sensor.m"], \
        f"a quick tap on motion must open its calendar: {out['quickTaps']}"
    assert out["holdCalls"] == [["openControls", "light.a"]], \
        f"a genuine 500ms hold must still open the controls card: {out['holdCalls']}"


def test_wire_use_surface_a_click_on_a_barrier_hit_path_opens_its_card(tmp_path):
    """Garry, 2026-09-22: "the ability to click on the line... bring up a
    card that clearly says this door/window is open, and the ability to
    open/close it". The hit path (iso_lights.js, BARRIER_HIT) carries
    data-invert/data-name because the barrier's own invert_state has no
    home on the linked entity itself — wireUseSurface has to rebuild a
    barrier-shaped object from exactly those attributes to get the SAME
    open/closed reading the map just drew."""
    out = _run(tmp_path, r"""
function elx(tag, attrs) {
  const n = document.createElementNS("http://www.w3.org/2000/svg", tag);
  for (const [k, v] of Object.entries(attrs || {})) n.setAttribute(k, String(v));
  return n;
}
const isoDiv = document.createElement("div");
const svg = document.createElement("svg");
isoDiv.appendChild(svg);
const hb = elx("polyline", {
  class: "lbarhit", "data-eid": "binary_sensor.frontdoor",
  "data-cx": "10", "data-cy": "10", "data-invert": "1", "data-name": "Upper Garage Car Door Contact",
});
svg.appendChild(hb);
const api = {
  hass: { states: { "binary_sensor.frontdoor": { state: "off", attributes: {} } } },
  lightsByEid: {}, controlsFor: () => false,
  toggle: () => {}, openControls: () => {}, openActivity: () => {},
  toast: () => {}, rerender: () => {},
};
LM.wireUseSurface(isoDiv, api);
hb.dispatchEvent({ type: "click", stopPropagation(){}, preventDefault(){} });
console.log(JSON.stringify({ cardOpened: document.body.children.length > 0 }));
""")
    assert out["cardOpened"] is True, "a click on the barrier hit path must open its card"


def test_wire_use_surface_carries_the_hit_paths_opener_and_lock_into_the_card(tmp_path):
    """Found live, 2026-09-22, clicking a real linked opener on the Atlas
    sidebar: the hit path reconstructs a bar-shaped object from data
    attributes alone (no second model lookup from this shared function),
    and data-opener/data-lock were missing from that reconstruction — the
    click opened a card, but it silently showed the plain-sensor read-only
    note instead of the Trigger button, even though the real barrier record
    had a linked opener. Fixed alongside the renderer emitting those two
    attributes in the first place (test_lights_renderer.py)."""
    out = _run(tmp_path, r"""
function elx(tag, attrs) {
  const n = document.createElementNS("http://www.w3.org/2000/svg", tag);
  for (const [k, v] of Object.entries(attrs || {})) n.setAttribute(k, String(v));
  return n;
}
const isoDiv = document.createElement("div");
const svg = document.createElement("svg");
isoDiv.appendChild(svg);
const hb = elx("polyline", {
  class: "lbarhit", "data-eid": "binary_sensor.truck_door",
  "data-cx": "10", "data-cy": "10", "data-invert": "0", "data-name": "Truck Door",
  "data-opener": "switch.upper_garage_truck_door", "data-lock": "",
});
svg.appendChild(hb);
const api = {
  hass: { states: {
    "binary_sensor.truck_door": { state: "off", attributes: {} },
    "switch.upper_garage_truck_door": { state: "off", attributes: { friendly_name: "Upper Garage Truck Door" } },
  } },
  lightsByEid: {}, controlsFor: () => false,
  toggle: () => {}, openControls: () => {}, openActivity: () => {},
  toast: () => {}, rerender: () => {},
};
LM.wireUseSurface(isoDiv, api);
hb.dispatchEvent({ type: "click", stopPropagation(){}, preventDefault(){} });
const overlay = document.body.children[document.body.children.length - 1];
console.log(JSON.stringify({ buttons: [...overlay.querySelectorAll("button")].map(b => b.textContent) }));
""")
    assert "Trigger" in out["buttons"], \
        f"the opener carried through data-opener must render its Trigger button: {out['buttons']}"


def test_open_barrier_card_shows_a_paired_locks_control_and_leads_with_open(tmp_path):
    """Garry, 2026-09-22: "then the new card could have a lock control on
    it if the door has a smart lock" — the merge researched and built
    after the click-to-open feature above: computeDoorLockPairs finds the
    lock, openBarrierCard shows BOTH. State priority follows the research
    (Home Assistant community pattern for combining a lock + door sensor
    into one card): the LEAST secure fact leads — an open door says "Open"
    regardless of lock state, only a closed door lets the lock's own state
    lead the headline."""
    out = _run(tmp_path, r"""
const hass = {
  states: {
    "binary_sensor.front_door": { state: "on", attributes: { friendly_name: "Front Door" } },
    "lock.front_door_lock": { state: "locked", attributes: { friendly_name: "Front Door Lock" } },
  },
  callService: async () => {},
};
const api = { doorLockMap: { "binary_sensor.front_door": "lock.front_door_lock" }, toast: () => {}, rerender: () => {} };
const bar = { linked_entity_id: "binary_sensor.front_door", name: "Front Door" };
LM.openBarrierCard(hass, bar, api);
const openText = document.body.textContent;
const openButtons = document.body.querySelectorAll("button").map(b => b.textContent);
while (document.body.children.length) document.body.removeChild(document.body.children[0]);

hass.states["binary_sensor.front_door"].state = "off";
LM.openBarrierCard(hass, bar, api);
const closedLockedText = document.body.textContent;
while (document.body.children.length) document.body.removeChild(document.body.children[0]);

hass.states["lock.front_door_lock"].state = "unlocked";
LM.openBarrierCard(hass, bar, api);
const closedUnlockedText = document.body.textContent;
const closedUnlockedButtons = document.body.querySelectorAll("button").map(b => b.textContent);

console.log(JSON.stringify({ openText, openButtons, closedLockedText, closedUnlockedText, closedUnlockedButtons }));
""")
    assert "Open" in out["openText"], out["openText"]
    assert "Closed" not in out["openText"], "an open door must not also claim to be closed"
    assert any("Lock" in b or "Unlock" in b for b in out["openButtons"]), \
        "the lock control must still show even while the door is open"
    assert "Closed" in out["closedLockedText"] and "Locked" in out["closedLockedText"], out["closedLockedText"]
    assert "Closed" in out["closedUnlockedText"] and "Unlocked" in out["closedUnlockedText"], out["closedUnlockedText"]
    assert "Lock" in out["closedUnlockedButtons"], "closed-and-unlocked must offer a Lock button"


def test_open_barrier_card_explicit_opener_gets_real_open_close(tmp_path):
    """Garry, 2026-09-22: "three things need a logical link... all of these
    sit on the opening" — bar.linked_opener_entity_id is a SEPARATE field
    from the sensor now, not just the barrier's own link being a cover. A
    cover opener gets the real open_cover/close_cover control, same as
    before, just sourced from the new field."""
    out = _run(tmp_path, r"""
const hass = {
  states: {
    "binary_sensor.side_door": { state: "off", attributes: { friendly_name: "Side Door" } },
    "cover.side_gate": { state: "closed", attributes: { friendly_name: "Side Gate Motor" } },
  },
  callService: async () => {},
};
const bar = { linked_entity_id: "binary_sensor.side_door", linked_opener_entity_id: "cover.side_gate", name: "Side Door" };
LM.openBarrierCard(hass, bar, { toast: () => {}, rerender: () => {} });
const text = document.body.textContent;
const buttons = document.body.querySelectorAll("button").map(b => b.textContent);
console.log(JSON.stringify({ text, buttons }));
""")
    assert "Closed" in out["text"], out["text"]
    assert "Open" in out["buttons"], "a cover opener must show a real Open button, not a generic Trigger"


def test_open_barrier_card_switch_opener_gets_a_generic_trigger_with_context(tmp_path):
    """A relay switch's own on/off does not reliably mean the door is open
    or closed (usually a momentary pulse toggling direction each press),
    so it must never be labelled Open/Close — just "Trigger", with the
    real sensor reading shown as context. Garry's own real case:
    switch.upper_garage_truck_door next to its already-linked sensor."""
    out = _run(tmp_path, r"""
const hass = {
  states: {
    "binary_sensor.truck_door": { state: "on", attributes: { friendly_name: "Truck Door" } },
    "switch.upper_garage_truck_door": { state: "off", attributes: { friendly_name: "Upper Garage Truck Door" } },
  },
  callService: async () => {},
};
const bar = { linked_entity_id: "binary_sensor.truck_door", linked_opener_entity_id: "switch.upper_garage_truck_door", name: "Truck Door" };
LM.openBarrierCard(hass, bar, { toast: () => {}, rerender: () => {} });
const text = document.body.textContent;
const buttons = document.body.querySelectorAll("button").map(b => b.textContent);
console.log(JSON.stringify({ text, buttons }));
""")
    assert "Trigger" in out["buttons"], out["buttons"]
    assert "Open" not in out["buttons"] and "Close" not in out["buttons"], \
        "a relay opener must never be labelled Open/Close — its own state doesn't reliably mean either"
    assert "open" in out["text"].lower() and "relay" in out["text"].lower(), \
        "the current sensor reading must be shown as context next to a relay's Trigger button"


def test_open_barrier_card_script_opener_triggers_via_script_turn_on(tmp_path):
    """Garry, 2026-09-22: "there is a garage door controller in HA, can you
    find it" — script.garage_door_car/_truck, a wrapped controller rather
    than the raw relay underneath it. Same generic Trigger as a switch
    (its own on/off means running/idle, not open/closed — never Open/
    Close), but calls script.turn_on, not switch.toggle, and the caption
    must not claim it presses a relay when it might not."""
    out = _run(tmp_path, r"""
const hass = {
  states: {
    "binary_sensor.car_door": { state: "off", attributes: { friendly_name: "Car Door" } },
    "script.garage_door_car": { state: "off", attributes: { friendly_name: "Garage Door - Car" } },
  },
  callService: async (domain, svc, data) => { window.__lastCall = [domain, svc, data.entity_id]; },
};
const bar = { linked_entity_id: "binary_sensor.car_door", linked_opener_entity_id: "script.garage_door_car", name: "Car Door" };
LM.openBarrierCard(hass, bar, { toast: () => {}, rerender: () => {} });
const text = document.body.textContent;
const buttons = [...document.body.querySelectorAll("button")].map(b => b.textContent);
const btn = buttons.includes("Trigger") ? [...document.body.querySelectorAll("button")].find(b => b.textContent === "Trigger") : null;
if (btn) btn.dispatchEvent({ type: "click", stopPropagation(){}, preventDefault(){} });
console.log(JSON.stringify({ text, buttons, lastCall: window.__lastCall }));
""")
    assert "Trigger" in out["buttons"], out["buttons"]
    assert "Open" not in out["buttons"] and "Close" not in out["buttons"], out["buttons"]
    assert "relay" not in out["text"].lower(), "a script's caption must not claim it presses a relay"
    assert out["lastCall"] == ["script", "turn_on", "script.garage_door_car"], out["lastCall"]


def test_open_barrier_card_running_script_opener_shows_busy_and_wont_retrigger(tmp_path):
    """A script's own state IS meaningful, unlike a switch's — "on" means
    it is currently running. While running, retriggering it must be
    refused client-side (mirrors the cover's opening/closing busy state)."""
    out = _run(tmp_path, r"""
const hass = {
  states: {
    "script.garage_door_car": { state: "on", attributes: { friendly_name: "Garage Door - Car" } },
  },
  callService: async () => { window.__called = true; },
};
const bar = { linked_opener_entity_id: "script.garage_door_car", name: "Car Door" };
LM.openBarrierCard(hass, bar, { toast: () => {}, rerender: () => {} });
const btn = [...document.body.querySelectorAll("button")].find(b => b.textContent === "Running…");
if (btn) btn.dispatchEvent({ type: "click", stopPropagation(){}, preventDefault(){} });
console.log(JSON.stringify({ foundRunningBtn: !!btn, called: !!window.__called }));
""")
    assert out["foundRunningBtn"], "a running script opener must show 'Running…', not 'Trigger'"
    assert out["called"] is False, "clicking while running must not fire a second call"


def test_open_barrier_card_opener_only_with_no_sensor_reads_honestly(tmp_path):
    """Garry, 2026-09-22: "we need logic for this to work on an opening
    without a sensor." A barrier with only an opener and no sensor at all
    (a relay with nothing self-reporting) has no way to know open or
    closed — the card must say so rather than guess, while the Trigger
    button still works."""
    out = _run(tmp_path, r"""
const hass = {
  states: { "switch.gate_relay": { state: "off", attributes: { friendly_name: "Gate Relay" } } },
  callService: async () => {},
};
const bar = { linked_opener_entity_id: "switch.gate_relay", name: "Side Gate" };
LM.openBarrierCard(hass, bar, { toast: () => {}, rerender: () => {} });
const text = document.body.textContent;
const buttons = document.body.querySelectorAll("button").map(b => b.textContent);
console.log(JSON.stringify({ text, buttons }));
""")
    assert "No reading" in out["text"], out["text"]
    assert "Trigger" in out["buttons"], "the opener must still be controllable with no sensor present"


def test_open_barrier_card_cover_opener_alone_self_reports_open_closed(tmp_path):
    """The older, simpler shape still works: a barrier linked STRAIGHT to a
    cover, nothing else — the cover self-reports, so it substitutes for a
    sensor without needing a separate linked_entity_id at all."""
    out = _run(tmp_path, r"""
const hass = {
  states: { "cover.garage_main": { state: "open", attributes: { friendly_name: "Main Garage Door" } } },
  callService: async () => {},
};
const bar = { linked_entity_id: "cover.garage_main", name: "Main Garage" };
LM.openBarrierCard(hass, bar, { toast: () => {}, rerender: () => {} });
const text = document.body.textContent;
console.log(JSON.stringify({ text }));
""")
    assert "Open" in out["text"] and "Closed" not in out["text"], out["text"]


# ── Weekly activity calendar (motion) ────────────────────────────────────────

def test_motion_weekly_grid_buckets_intervals_into_local_hours(tmp_path):
    """Garry: "a calendar saying when the room last saw activity in the last
    week... fully filled by the hour." motionWeeklyGrid is the pure bucketing
    underneath it: an "on" interval marks every local hour it touches, a
    still-open interval (no closing event yet) is bounded by "now" rather
    than running forever, and anything entirely outside the 7-day window
    must be invisible — a stray "on" from ten days ago must never make
    today's calendar look busier than it was."""
    out = _run(tmp_path, r"""
// A fixed reference "now": Wednesday 2026-09-02, 15:30 local.
const end = new Date(2026, 8, 2, 15, 30, 0, 0);
const endMs = end.getTime();
function at(daysAgo, hour, min) {
  const d = new Date(end);
  d.setDate(d.getDate() - daysAgo);
  d.setHours(hour, min || 0, 0, 0);
  return d.getTime();
}

const history = [
  // Oldest displayed day (6 days ago): on 02:15 -> off 04:45. Hours 2,3,4.
  { state: "on",  ts: at(6, 2, 15) },
  { state: "off", ts: at(6, 4, 45) },
  // Crosses midnight: on at 23:30 yesterday (1 day ago), off 01:15 today.
  { state: "on",  ts: at(1, 23, 30) },
  { state: "off", ts: at(0, 1, 15) },
  // Entirely outside the 7-day window (10 days ago) -- must be invisible.
  { state: "on",  ts: at(10, 12, 0) },
  { state: "off", ts: at(10, 13, 0) },
  // Still "on" right now, no closing event -- bounded by endMs (15:30).
  { state: "on",  ts: at(0, 14, 0) },
];

const { dayStarts, days, grid } = LM.motionWeeklyGrid(history, endMs, 7);
console.log(JSON.stringify({
  days, dayCount: dayStarts.length,
  oldestDayHours: grid[0],
  yesterdayHour22: grid[5][22], yesterdayHour23: grid[5][23],
  todayHour0: grid[6][0], todayHour1: grid[6][1], todayHour2: grid[6][2],
  todayHour13: grid[6][13], todayHour14: grid[6][14], todayHour15: grid[6][15], todayHour16: grid[6][16],
  anyMarkOutsideExpected: grid.flat().filter(Boolean).length,
}));
""")
    assert out["days"] == 7 and out["dayCount"] == 7, out
    assert out["oldestDayHours"][2] and out["oldestDayHours"][3] and out["oldestDayHours"][4], \
        f"a 02:15-04:45 interval must mark hours 2, 3 and 4: {out['oldestDayHours']}"
    assert not out["oldestDayHours"][1] and not out["oldestDayHours"][5], \
        f"the hour just before and just after the interval must stay unmarked: {out['oldestDayHours']}"
    assert out["yesterdayHour23"] and not out["yesterdayHour22"], \
        "a midnight-crossing interval must mark hour 23 on the day it started"
    assert out["todayHour0"] and out["todayHour1"] and not out["todayHour2"], \
        "the same midnight-crossing interval must mark hours 0 and 1 on the day it ended, not hour 2"
    assert out["todayHour14"] and out["todayHour15"] and not out["todayHour16"] and not out["todayHour13"], \
        "a still-open interval must be bounded by \"now\" (15:30), marking 14 and 15 but never 16"
    # 3 (oldest day) + 1 (hour 23 yesterday) + 2 (hours 0-1 today) + 2 (hours 14-15 today) = 8.
    # The stray ten-days-ago event contributes zero — if it leaked in, this count would be wrong.
    assert out["anyMarkOutsideExpected"] == 8, \
        f"a stray on/off from 10 days ago (outside the 7-day window) must never appear: {out}"


# ── Optimistic state ─────────────────────────────────────────────────────────

def test_optimistic_state_wins_until_reconciled_or_expired(tmp_path):
    """A tap flips the marker now; HA's next reported state either agrees
    (the claim quietly steps aside) or a failed call clears it explicitly
    (the revert-shake path) — and an abandoned claim expires so a bulb that
    genuinely never answers does not lie forever."""
    out = _run(tmp_path, r"""
const eid = 'light.x';
const results = {};
LM.setOptimistic(eid, 'on', 1000);
results.claimWins = LM.effectiveState(eid, 'off', 1100).state;         // HA still says off, claim stands
results.claimFlagsOptimistic = LM.effectiveState(eid, 'off', 1100).optimistic;
results.reconciles = LM.effectiveState(eid, 'on', 1200).state;          // HA now agrees
results.reconciledFlag = LM.effectiveState(eid, 'on', 1200).optimistic;
// After reconciling, the claim is gone — a STALE report can't resurrect it.
results.staysReconciled = LM.effectiveState(eid, 'off', 1300).state;

LM.setOptimistic(eid, 'on', 2000);
results.expires = LM.effectiveState(eid, 'off', 2000 + LM.OPTIMISTIC_TTL_MS + 1).state;

LM.setOptimistic(eid, 'on', 3000);
LM.clearOptimistic(eid);
results.clearedImmediately = LM.effectiveState(eid, 'off', 3001).state;
console.log(JSON.stringify(results));
""")
    assert out["claimWins"] == "on" and out["claimFlagsOptimistic"] is True, out
    assert out["reconciles"] == "on" and out["reconciledFlag"] is False, out
    assert out["staysReconciled"] == "off", "a reconciled claim must not be replayed against a later report"
    assert out["expires"] == "off", "an abandoned claim must expire, not lie forever"
    assert out["clearedImmediately"] == "off", "clearOptimistic must take the claim back at once (the revert-shake path)"


# ── Room / floor aggregates ──────────────────────────────────────────────────

_AGG_LIGHTS = [
    {"entity_id": "light.a", "area_name": "Kitchen", "state": "on",  "isFan": False, "isMotion": False},
    {"entity_id": "light.b", "area_name": "Kitchen", "state": "off", "isFan": False, "isMotion": False},
    {"entity_id": "fan.k",   "area_name": "Kitchen", "state": "on",  "isFan": True,  "isMotion": False},
    {"entity_id": "binary_sensor.k", "area_name": "Kitchen", "state": "on", "isFan": False, "isMotion": True},
    {"entity_id": "light.c", "area_name": "Loft", "state": "on", "isFan": False, "isMotion": False},
]


def test_room_aggregate_counts_lights_and_fans_separately(tmp_path):
    """The single most-used action in every competitor's map (Alexa, SmartThings)
    — and Garry's stated worry about ambiguity: "All off" must never also
    silently kill a fan, so the aggregate hands them back as separate lists."""
    out = _run(tmp_path, r"""
const LIGHTS = __LIGHTS__;
const agg = LM.roomAggregate(LIGHTS, 'Kitchen');
console.log(JSON.stringify(agg));
""".replace("__LIGHTS__", json.dumps(_AGG_LIGHTS)))
    assert out["lightsOn"] == 1 and out["lightsTotal"] == 2, out
    assert out["fansOn"] == 1 and out["fansTotal"] == 1, out
    assert out["motionActive"] == 1 and out["motionTotal"] == 1, out
    assert set(out["lightEids"]) == {"light.a", "light.b"}, "fans and sensors must not leak into the light list"
    assert out["fanEids"] == ["fan.k"], out


def test_room_aggregate_on_an_empty_room_is_all_zero(tmp_path):
    out = _run(tmp_path, r"""
const LIGHTS = __LIGHTS__;
console.log(JSON.stringify(LM.roomAggregate(LIGHTS, 'Nonexistent')));
""".replace("__LIGHTS__", json.dumps(_AGG_LIGHTS)))
    assert out["lightsTotal"] == 0 and out["fansTotal"] == 0 and out["motionTotal"] == 0
    assert out["lightEids"] == [] and out["fanEids"] == []


def test_room_and_floor_aggregates_summarise_air_quality_by_the_worst_reading(tmp_path):
    """The room sheet's sub-line says what the air is like when the room has
    an air-quality sensor (numeric or graded-word), by its WORST reading —
    a room the map is painting with bars must not read "Motion clear" alone.
    Nothing reporting → NaN → the sheet says "—"."""
    model = {"room_geometry_m": {"Bath": {"floor_id": "main"}}, "light_positions_m": {}}
    lights = [
        {"entity_id": "sensor.bath_co2",  "area_name": "Bath", "isAir": True, "device_class": "carbon_dioxide", "air_value": 1450, "state": "1450"},
        {"entity_id": "sensor.bath_air",  "area_name": "Bath", "isAir": True, "device_class": "enum", "air_level": "poor", "air_value": None, "state": "poor"},
        {"entity_id": "sensor.bath_dead", "area_name": "Bath", "isAir": True, "device_class": "enum", "air_level": "unknown", "air_value": None, "state": "unknown"},
        {"entity_id": "light.bath",       "area_name": "Bath", "state": "on"},
    ]
    out = _run(tmp_path, r"""
const MODEL = __MODEL__, LIGHTS = __LIGHTS__;
const room = LM.roomAggregate(LIGHTS, 'Bath');
const floor = LM.floorAggregate(LIGHTS, MODEL, 'main');
console.log(JSON.stringify({roomAirTotal: room.airTotal, roomAirWorst: room.airWorst, floorAirTotal: floor.airTotal, floorAirWorst: floor.airWorst,
  none: LM.airWorstOf([LIGHTS[2]]), noneIsNaN: Number.isNaN(LM.airWorstOf([LIGHTS[2]]))}));
""".replace("__MODEL__", json.dumps(model)).replace("__LIGHTS__", json.dumps(lights)))
    assert out["roomAirTotal"] == 3 and out["floorAirTotal"] == 3, out
    assert abs(out["roomAirWorst"] - 0.4) < 1e-9 and abs(out["floorAirWorst"] - 0.4) < 1e-9, \
        f"the WORST reading wins: 'poor' (0.4) over 1450 ppm (0.38); the unknown one is ignored: {out}"
    assert out["noneIsNaN"], f"no reporting sensor → NaN, not 0 (0 would read as Good): {out}"


def test_floor_aggregate_derives_the_floor_from_room_then_placement(tmp_path):
    """lightFloorId: a device's floor is its ROOM's floor first (the fabric's
    room_geometry_m), and only when it has no room does its own stored
    placement's floor_id count — so a light dropped in a room keeps the
    room's storey even if it was once placed somewhere else."""
    model = {
        "room_geometry_m": {"Kitchen": {"floor_id": "main"}, "Loft": {"floor_id": "up"}},
        "light_positions_m": {
            "light.a": {"floor_id": "up"},        # has a room -> room wins over this
            "light.orphan": {"floor_id": "main"},  # no room -> its own placement decides
        },
    }
    lights = [
        {"entity_id": "light.a", "area_name": "Kitchen"},
        {"entity_id": "light.orphan", "area_name": None},
        {"entity_id": "light.nowhere", "area_name": None},
    ]
    out = _run(tmp_path, r"""
const MODEL = __MODEL__, LIGHTS = __LIGHTS__;
console.log(JSON.stringify({
  a: LM.lightFloorId(LIGHTS[0], MODEL),
  orphan: LM.lightFloorId(LIGHTS[1], MODEL),
  nowhere: LM.lightFloorId(LIGHTS[2], MODEL),
  floorAgg: LM.floorAggregate(LIGHTS.map((l,i)=>({...l, state: i<2 ? 'on':'off', isFan:false})), MODEL, 'main'),
}));
""".replace("__MODEL__", json.dumps(model)).replace("__LIGHTS__", json.dumps(lights)))
    assert out["a"] == "main", "the room's floor must win over a stale stored placement"
    assert out["orphan"] == "main", out
    assert out["nowhere"] is None, "a device with neither a room nor a placement has no floor"
    assert out["floorAgg"]["lightsTotal"] == 2 and "light.nowhere" not in out["floorAgg"]["lightEids"], out["floorAgg"]


def test_an_outdoor_room_never_anchors_a_devices_floor(tmp_path):
    """Garry, 2026-09-14: a temperature sensor whose HA area is the Shed (an
    area on the Outside floor) could not be placed "on a floor, just outside a
    room" — its room's floor (__outside__) won over everything, and the Lights
    stack never draws outdoor floors (fabricFrame drops them), so it had no
    marker and every placement wrote it straight back off the map.

    An outdoor room is not a storey, so it does not anchor: the device's own
    stored placement decides its floor. Never placed, it stays on the outside
    level exactly as before — nothing already saved moves. An INDOOR room
    still wins over a stale placement (the test above), and the registry's
    "outside" spelling counts the same as the fabric's "__outside__"."""
    model = {
        "room_geometry_m": {
            "Shed": {"floor_id": "__outside__"},
            "Garden": {"floor_id": "outside"},
            "Kitchen": {"floor_id": "main"},
        },
        "light_positions_m": {
            "sensor.shed_placed": {"floor_id": "main"},       # dropped on the main plate
            "sensor.shed_stale": {"floor_id": "__outside__"},  # existing data: saved on outside
            "sensor.kitchen": {"floor_id": "__outside__"},     # indoor room still wins
        },
    }
    lights = [
        {"entity_id": "sensor.shed_placed", "area_name": "Shed"},
        {"entity_id": "sensor.shed_stale", "area_name": "Shed"},
        {"entity_id": "sensor.shed_never", "area_name": "Shed"},
        {"entity_id": "sensor.garden_never", "area_name": "Garden"},
        {"entity_id": "sensor.kitchen", "area_name": "Kitchen"},
    ]
    out = _run(tmp_path, r"""
const MODEL = __MODEL__, LIGHTS = __LIGHTS__;
console.log(JSON.stringify({
  placed: LM.lightFloorId(LIGHTS[0], MODEL),
  stale: LM.lightFloorId(LIGHTS[1], MODEL),
  never: LM.lightFloorId(LIGHTS[2], MODEL),
  gardenNever: LM.lightFloorId(LIGHTS[3], MODEL),
  kitchen: LM.lightFloorId(LIGHTS[4], MODEL),
  outdoor: ["__outside__", "outside", "Outside", "garden", "yard", "main", "upper", "basement", "", null]
    .map(f => LM.isOutdoorFloorId(f)),
}));
""".replace("__MODEL__", json.dumps(model)).replace("__LIGHTS__", json.dumps(lights)))
    assert out["placed"] == "main", "an outdoor room must not override where the device was actually placed"
    assert out["stale"] == "__outside__", "existing outdoor placements stay exactly where they are"
    assert out["never"] == "__outside__", "never placed: still on the outside level, as before"
    assert out["gardenNever"] == "outside", "the registry's own 'outside' floor id behaves the same"
    assert out["kitchen"] == "main", "an INDOOR room still wins over a stale stored placement"
    assert out["outdoor"] == [True, True, True, True, True, False, False, False, False, False], out["outdoor"]


# ── Spread in room ───────────────────────────────────────────────────────────

def test_spread_in_room_places_every_light_inside_the_polygon(tmp_path):
    """Fast bulk placement without dragging a pile apart — the #3-ranked item
    in both models' lists. Every returned point must land inside the room
    (never on top of a wall) and the count must match what was asked for,
    across a plain rectangle and an L-shaped room."""
    rect = [[0, 0], [6, 0], [6, 4], [0, 4]]
    # An L-shaped room (Garry's own Bedroom shape from the perimeter saga,
    # simplified) — the harder case: a naive bounding-box grid would place a
    # point in the missing corner.
    l_shape = [[0, 0], [4, 0], [4, 2], [2, 2], [2, 4], [0, 4]]
    out = _run(tmp_path, r"""
const {pointInPolygon} = await import('./iso_lights.mjs');
const RECT = __RECT__, L = __L__;
const rectPts = LM.spreadInRoom(RECT, 6, 0.3);
const lPts = LM.spreadInRoom(L, 4, 0.3);
console.log(JSON.stringify({
  rectCount: rectPts.length,
  rectAllInside: rectPts.every(p => pointInPolygon(RECT, p[0], p[1])),
  rectAllUnique: new Set(rectPts.map(p=>p.join(','))).size === rectPts.length,
  lCount: lPts.length,
  lAllInside: lPts.every(p => pointInPolygon(L, p[0], p[1])),
  zeroForNoRoom: LM.spreadInRoom([], 3, 0.3).length,
  zeroForNoCount: LM.spreadInRoom(RECT, 0, 0.3).length,
}));
""".replace("__RECT__", json.dumps(rect)).replace("__L__", json.dumps(l_shape)))
    assert out["rectCount"] == 6, out
    assert out["rectAllInside"], "every spread point must land inside the room, never on or past a wall"
    assert out["rectAllUnique"], "spread points must not collapse onto each other"
    assert out["lCount"] == 4, out
    assert out["lAllInside"], "the L-shaped room's missing corner must never receive a point"
    assert out["zeroForNoRoom"] == 0 and out["zeroForNoCount"] == 0, "degenerate inputs must return nothing, not throw"


# ── Undo / redo ──────────────────────────────────────────────────────────────

def test_undo_stack_round_trips_and_a_new_edit_clears_redo(tmp_path):
    out = _run(tmp_path, r"""
const st = LM.createUndoStack(3);
const results = {};
results.emptyUndo = st.canUndo;
st.push('A');
st.push('B');
results.peekIsB = st.peekUndo();
const afterUndo = st.undo('current-after-B');   // hands back 'B', current goes to redo
results.undoReturns = afterUndo;
results.canRedoNow = st.canRedo;
const afterRedo = st.redo('current-after-undo');
results.redoReturns = afterRedo;
// A fresh edit after an undo must drop the redo history — the standard
// editor contract (undo, then do something new: redo is gone).
st.undo('x');
st.push('C');
results.redoGoneAfterNewEdit = st.canRedo;
// The limit evicts the OLDEST entry, not the newest.
const st2 = LM.createUndoStack(2);
st2.push('1'); st2.push('2'); st2.push('3');
results.oldestEvicted = st2.undo('cur');   // should be '3' (the newest of the kept two)
st2.undo('cur2');
results.secondOldestEvicted = st2.canUndo; // '1' should have been evicted, so this is now false
console.log(JSON.stringify(results));
""")
    assert out["emptyUndo"] is False
    assert out["peekIsB"] == "B", out
    assert out["undoReturns"] == "B", out
    assert out["canRedoNow"] is True
    assert out["redoReturns"] == "current-after-B", out
    assert out["redoGoneAfterNewEdit"] is False, "a new edit after undo must clear the redo stack"
    assert out["oldestEvicted"] == "3", out
    assert out["secondOldestEvicted"] is False, "a stack of size 2 must have evicted the oldest push"


# ── Pinch zoom ────────────────────────────────────────────────────────────────

def test_pinch_zoom_scales_with_finger_distance_and_clamps(tmp_path):
    out = _run(tmp_path, r"""
console.log(JSON.stringify({
  doublesOnDoubleDistance: LM.pinchZoom(1.0, 100, 200),
  halvesOnHalfDistance: LM.pinchZoom(1.0, 200, 100),
  clampsHigh: LM.pinchZoom(2.0, 100, 1000),
  clampsLow: LM.pinchZoom(1.0, 1000, 10),
  ignoresZeroDist: LM.pinchZoom(1.5, 0, 200),
  ignoresNoop: LM.pinchZoom(1.5, 100, 100),
}));
""")
    assert out["doublesOnDoubleDistance"] == 2.0, out
    assert out["halvesOnHalfDistance"] == 0.5, out
    assert out["clampsHigh"] == 2.5, out
    assert out["clampsLow"] == 0.4, out
    assert out["ignoresZeroDist"] == 1.5, "a degenerate (zero) prior distance must not divide by zero"
    assert out["ignoresNoop"] == 1.5, out


# ── Brand column resolution ──────────────────────────────────────────────────

def test_resolve_brand_precedence_and_the_control4_case(tmp_path):
    """Garry (2026-09-08): "why are you not seeing the control4 lights as
    brand control4, sloppy... better logic for the search. Blanks in the
    brand column should be rare." Root cause verified live: the ~60
    Control4 devices behind an HC800 have NO manufacturer in HA's device
    registry at all, but every one carries identifiers[0][0]=="control4" —
    resolveBrand falls back to the owning integration, stylized or
    title-cased, so blanks become rare without special-casing Control4."""
    out = _run(tmp_path, r"""
console.log(JSON.stringify({
  manufacturerWins: LM.resolveBrand("QuinLED", "wled", "wled"),
  rawTuyaStringWins: LM.resolveBrand("_TZE204_ex3rcdha", "zha", "zha"),
  theLiveControl4Case: LM.resolveBrand(null, "control4", "control4"),
  platformFallbackNoDevice: LM.resolveBrand(null, null, "wled"),
  styledTable_hue: LM.resolveBrand(null, "hue", "hue"),
  styledTable_zwave: LM.resolveBrand(null, "zwave_js", "zwave_js"),
  titleCaseUnlisted: LM.resolveBrand(null, "some_vendor_x", "some_vendor_x"),
  transportsStayNull_mqtt: LM.resolveBrand(null, "mqtt", "mqtt"),
  transportsStayNull_template: LM.resolveBrand(null, null, "template"),
  allNullIsSafe: LM.resolveBrand(null, null, null),
  emptyManufacturerFallsThrough: LM.resolveBrand("", "wled", "wled"),
}));
""")
    assert out["manufacturerWins"] == "QuinLED", out
    assert out["rawTuyaStringWins"] == "_TZE204_ex3rcdha", (
        "a raw firmware manufacturer string is what HA itself knows — show it as-is, not stylized", out
    )
    assert out["theLiveControl4Case"] == "Control4", out
    assert out["platformFallbackNoDevice"] == "WLED", "no device at all must still fall back to the entity's own platform"
    assert out["styledTable_hue"] == "Philips Hue", out
    assert out["styledTable_zwave"] == "Z-Wave", out
    assert out["titleCaseUnlisted"] == "Some Vendor X", "an unlisted integration must title-case, not stay blank"
    assert out["transportsStayNull_mqtt"] is None, "a pure transport carries no brand identity of its own"
    assert out["transportsStayNull_template"] is None, out
    assert out["allNullIsSafe"] is None, out
    assert out["emptyManufacturerFallsThrough"] == "WLED", "a falsy-but-present manufacturer must still fall through to the domain"


# ── stateWordOf: the one per-class state-word/sort answer ──────────────────
# Phase 2a follow-up (docs/PHASE2_STRATEGIC_REVIEW.md #80), 2026-09-19:
# openAggregateSheet's render chain, buildLightsTable's render chain and its
# own separate sort-key chain each used to answer "what does this entity's
# state read as" with independent hand-written per-class if/else — two live
# bugs already shipped from the three copies disagreeing before this test
# existed (a locked lock read "Off" in one chain with no lock branch; the
# flood latch was invisible to the sort key in another). These pin the one
# shared function all three now read from.

def test_state_word_of_every_read_only_and_lock_class(tmp_path):
    out = _run(tmp_path, r"""
const NOW = new Date('2026-09-19T12:00:00Z').getTime();
const cases = {
  motionOn:    LM.stateWordOf({ isMotion: true, state: "on" }, {}),
  motionOff:   LM.stateWordOf({ isMotion: true, state: "off" }, {}),
  lockLocked:  LM.stateWordOf({ isLock: true, state: "locked" }, {}),
  lockUnlocked:LM.stateWordOf({ isLock: true, state: "unlocked" }, {}),
  lockJammed:  LM.stateWordOf({ isLock: true, state: "jammed" }, {}),
  tempReading: LM.stateWordOf({ isTemp: true, temperature: 21.5 }, {}),
  tempNoReading: LM.stateWordOf({ isTemp: true, temperature: null }, {}),
  humidity:    LM.stateWordOf({ isHumidity: true, humidity: 61 }, {}),
  doorOpen:    LM.stateWordOf({ isDoor: true, state: "on" }, {}),
  doorClosed:  LM.stateWordOf({ isDoor: true, state: "off" }, {}),
  plainLight:  LM.stateWordOf({ state: "on" }, {}),
  wled:        LM.stateWordOf({ isWled: true, state: "on" }, {}),
  fan:         LM.stateWordOf({ isFan: true, state: "on" }, {}),
};
console.log(JSON.stringify(cases));
""")
    assert out["motionOn"] == {"text": "MOTION", "lit": True, "sortValue": 1}
    assert out["motionOff"] == {"text": "clear", "lit": False, "sortValue": 0}
    assert out["lockLocked"] == {"text": "LOCKED", "lit": True, "sortValue": 1, "locked": True}
    assert out["lockUnlocked"] == {"text": "UNLOCKED", "lit": False, "sortValue": 0, "locked": False}
    assert out["lockJammed"] == {"text": "JAMMED", "lit": False, "sortValue": 0, "locked": False}
    assert out["tempReading"] == {"text": "21.5°", "lit": False, "sortValue": 21.5}
    assert out["tempNoReading"]["text"] == "—" and out["tempNoReading"]["sortValue"] is None  # -Infinity -> null over JSON
    assert out["humidity"] == {"text": "61%", "lit": False, "sortValue": 61}
    assert out["doorOpen"] == {"text": "OPEN", "lit": True, "sortValue": 1}
    assert out["doorClosed"] == {"text": "CLOSED", "lit": False, "sortValue": 0}
    # Controllable classes without a special word: null, so callers keep
    # their own generic On/Off (+ optional Controls) button.
    assert out["plainLight"] is None
    assert out["wled"] is None
    assert out["fan"] is None


def test_state_word_of_flood_latched_beats_live_and_matches_floodisalarming(tmp_path):
    # floodIsAlarming (lights_map.js) checks the latch against the REAL
    # Date.now(), not a value this script controls — so the fixture's
    # expires_at has to be built off the actual current time too, or the
    # "still latched" case silently expires and starts failing days after
    # whenever this was written (found the hard way: a hardcoded literal
    # date here rotted exactly like that within 48 hours).
    out = _run(tmp_path, r"""
const NOW_S = Date.now() / 1000;
const latches = { "binary_sensor.dried_but_latched": { triggered_at: NOW_S - 3600, expires_at: NOW_S + 3600 } };
const wet    = LM.stateWordOf({ isFlood: true, state: "on", entity_id: "binary_sensor.wet" }, latches);
const alarm  = LM.stateWordOf({ isFlood: true, state: "off", entity_id: "binary_sensor.dried_but_latched" }, latches);
const dry    = LM.stateWordOf({ isFlood: true, state: "off", entity_id: "binary_sensor.never_tripped" }, latches);
console.log(JSON.stringify({
  wet, alarm, dry,
  alarmMatchesFloodIsAlarming: LM.floodIsAlarming({ state: "off", entity_id: "binary_sensor.dried_but_latched" }, latches) === alarm.lit,
}));
""")
    assert out["wet"] == {"text": "WET", "lit": True, "sortValue": 1, "latched": False}
    assert out["alarm"] == {"text": "ALARM", "lit": True, "sortValue": 1, "latched": True}
    assert out["dry"] == {"text": "DRY", "lit": False, "sortValue": 0, "latched": False}
    assert out["alarmMatchesFloodIsAlarming"] is True


# ── Whole House Presets (2026-09-21) ─────────────────────────────────────────
# Garry: "a pull down like presets, but call whole house presets. There will
# be a set, and a name on it. It will remember every setting in the house
# when set is hit, and bring all settings back when selected." Real DEVICE
# state (not the map's own look, which is the Showcase Presets bar above) —
# captureWholeHouse/applyWholeHouse are the shared pipeline both the Mapping
# tab and the sidebar drive.

def test_capture_whole_house_keeps_only_lights_and_fans_never_a_lock(tmp_path):
    out = _run(tmp_path, """
const lights = [
  { entity_id: "light.kitchen", isTemp: false },
  { entity_id: "fan.ceiling" },
  { entity_id: "lock.front_door", isLock: true },
  { entity_id: "binary_sensor.motion", isMotion: true },
  { entity_id: "binary_sensor.leak", isFlood: true },
];
const states = {
  "light.kitchen": { state: "on", attributes: {} },
  "fan.ceiling": { state: "on", attributes: {} },
  "lock.front_door": { state: "locked", attributes: {} },
  "binary_sensor.motion": { state: "on", attributes: {} },
  "binary_sensor.leak": { state: "off", attributes: {} },
};
const cap = LM.captureWholeHouse(lights, states);
console.log(JSON.stringify({ keys: Object.keys(cap.entities).sort(), count: cap.count, skipped: cap.skipped }));
""")
    assert out["keys"] == ["fan.ceiling", "light.kitchen"], out
    assert out["count"] == 2 and out["skipped"] == 0


def test_capture_whole_house_an_off_light_stores_only_off_no_stale_attributes(tmp_path):
    out = _run(tmp_path, """
const lights = [{ entity_id: "light.hall" }];
const states = { "light.hall": { state: "off", attributes: { brightness: 200, color_mode: "rgb", rgb_color: [1,2,3] } } };
console.log(JSON.stringify(LM.captureWholeHouse(lights, states).entities));
""")
    assert out == {"light.hall": {"state": "off"}}


def test_capture_whole_house_a_light_keeps_brightness_and_only_its_own_color_mode(tmp_path):
    out = _run(tmp_path, """
const lights = [{ entity_id: "light.a" }, { entity_id: "light.b" }];
const states = {
  "light.a": { state: "on", attributes: { brightness: 180, color_mode: "rgb", rgb_color: [10,20,30], hs_color: [999,999], effect: "Rainbow", effect_list: ["Rainbow", "Chase"] } },
  "light.b": { state: "on", attributes: { brightness: 90, color_mode: "color_temp", color_temp_kelvin: 3200, effect: "Not Offered", effect_list: ["Something Else"] } },
};
console.log(JSON.stringify(LM.captureWholeHouse(lights, states).entities));
""")
    assert out["light.a"] == {"state": "on", "brightness": 180, "color_mode": "rgb", "rgb_color": [10, 20, 30], "effect": "Rainbow"}, out
    assert "hs_color" not in out["light.a"], "must not carry an attribute belonging to a DIFFERENT color_mode"
    assert out["light.b"] == {"state": "on", "brightness": 90, "color_mode": "color_temp", "color_temp_kelvin": 3200}, out
    assert "effect" not in out["light.b"], "an effect the light does not currently list must not be captured"


def test_capture_whole_house_a_fan_keeps_its_own_fields(tmp_path):
    out = _run(tmp_path, """
const lights = [{ entity_id: "fan.loft" }];
const states = { "fan.loft": { state: "on", attributes: { percentage: 66, preset_mode: "breeze", oscillating: true, direction: "reverse" } } };
console.log(JSON.stringify(LM.captureWholeHouse(lights, states).entities));
""")
    assert out == {"fan.loft": {"state": "on", "percentage": 66, "preset_mode": "breeze", "oscillating": True, "direction": "reverse"}}


def test_capture_whole_house_skips_and_counts_an_unavailable_device(tmp_path):
    out = _run(tmp_path, """
const lights = [{ entity_id: "light.a" }, { entity_id: "light.b" }];
const states = { "light.a": { state: "unavailable", attributes: {} } };  // light.b entirely missing from states
console.log(JSON.stringify(LM.captureWholeHouse(lights, states)));
""")
    assert out["entities"] == {} and out["count"] == 0 and out["skipped"] == 2


def test_apply_whole_house_calls_scene_apply_with_only_the_stored_entities(tmp_path):
    out = _run(tmp_path, """
const calls = [];
const hass = { callService: async (d, s, data) => { calls.push([d, s, data]); },
                states: { "light.a": { state: "on" }, "fan.b": { state: "off" } } };
const preset = { entities: { "light.a": { state: "on", brightness: 5 }, "fan.b": { state: "off" } } };
const r = await LM.applyWholeHouse(hass, preset);
console.log(JSON.stringify({ calls, r }));
""")
    assert out["calls"] == [["scene", "apply", {"entities": {"light.a": {"state": "on", "brightness": 5}, "fan.b": {"state": "off"}}}]]
    assert out["r"] == {"applied": 2, "skipped": 0}


def test_apply_whole_house_skips_a_device_thats_unavailable_or_gone_now(tmp_path):
    out = _run(tmp_path, """
const calls = [];
const hass = { callService: async (d, s, data) => { calls.push([d, s, data]); },
                states: { "light.here": { state: "on" }, "light.now_unavailable": { state: "unavailable" } } };
// light.deleted is in the preset but no longer in hass.states at all.
const preset = { entities: { "light.here": { state: "on" }, "light.now_unavailable": { state: "on" }, "light.deleted": { state: "on" } } };
const r = await LM.applyWholeHouse(hass, preset);
console.log(JSON.stringify({ calls, r }));
""")
    assert out["calls"] == [["scene", "apply", {"entities": {"light.here": {"state": "on"}}}]]
    assert out["r"] == {"applied": 1, "skipped": 2}


def test_apply_whole_house_refuses_a_non_light_fan_domain_even_from_hand_edited_storage(tmp_path):
    """Defense in depth on the client side too — the backend sanitizer already
    refuses this at save time, but a preset object built by hand (or from an
    older/foreign storage copy) must not be trusted at apply time either."""
    out = _run(tmp_path, """
const calls = [];
const hass = { callService: async (d, s, data) => { calls.push([d, s, data]); },
                states: { "lock.front_door": { state: "locked" }, "light.ok": { state: "on" } } };
const preset = { entities: { "lock.front_door": { state: "unlocked" }, "light.ok": { state: "on" } } };
const r = await LM.applyWholeHouse(hass, preset);
console.log(JSON.stringify({ calls, r }));
""")
    assert out["calls"] == [["scene", "apply", {"entities": {"light.ok": {"state": "on"}}}]]
    assert "lock.front_door" not in str(out["calls"])


def test_apply_whole_house_calls_nothing_when_everything_is_skipped(tmp_path):
    out = _run(tmp_path, """
const calls = [];
const hass = { callService: async (d, s, data) => { calls.push([d, s, data]); }, states: {} };
const r = await LM.applyWholeHouse(hass, { entities: { "light.gone": { state: "on" } } });
console.log(JSON.stringify({ calls, r }));
""")
    assert out["calls"] == []
    assert out["r"] == {"applied": 0, "skipped": 1}


def test_open_barrier_card_says_no_reading_for_an_offline_sensor_or_lock(tmp_path):
    """Review round 5: the Atlas draws an offline door or lock as a quiet
    'no data' line; the card that opens from it said 'Open' (an inverted
    door) or a red 'Unlocked'. One rule, barrierNoReading, for both."""
    out = _run(tmp_path, r"""
const hass = { states: {
  "binary_sensor.garage": { state: "unavailable", attributes: { friendly_name: "Garage" } },
  "lock.front": { state: "unknown", attributes: { friendly_name: "Front Lock" } },
}, callService: async () => {} };
const api = { toast: () => {}, rerender: () => {} };
LM.openBarrierCard(hass, { linked_entity_id: "binary_sensor.garage", invert_state: true, name: "Garage" }, api);
const door = document.body.textContent;
while (document.body.children.length) document.body.removeChild(document.body.children[0]);
LM.openBarrierCard(hass, { linked_entity_id: "lock.front", name: "Front" }, api);
const lock = document.body.textContent;
while (document.body.children.length) document.body.removeChild(document.body.children[0]);
hass.states["binary_sensor.garage"].state = "off";
LM.openBarrierCard(hass, { linked_entity_id: "binary_sensor.garage", linked_lock_entity_id: "lock.front", name: "Garage" }, api);
const closedLockOffline = document.body.textContent;
console.log(JSON.stringify({ door, lock, closedLockOffline }));
""")
    assert "No reading" in out["door"] and "Open" not in out["door"], out["door"]
    assert "No reading" in out["lock"] and "Unlocked" not in out["lock"], out["lock"]
    assert "Closed" in out["closedLockOffline"] and "Unlocked" not in out["closedLockOffline"], out["closedLockOffline"]
