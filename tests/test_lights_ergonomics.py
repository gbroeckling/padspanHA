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
    for name in ("lights_map", "iso_lights", "light_codes", "room_color", "editions"):
        src = (_VIEWS / f"{name}.js").read_text(encoding="utf-8")
        for dep in ("iso_lights", "light_codes", "editions"):
            src = src.replace(f"./{dep}.js{_QUERY}", f"./{dep}.mjs")
        src = src.replace('"./room_color.js"', '"./room_color.mjs"')
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
