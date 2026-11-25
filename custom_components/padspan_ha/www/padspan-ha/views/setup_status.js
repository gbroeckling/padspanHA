// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
// See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
//
// "Is this map-setup step done yet?" — one answer, read off the live state,
// shared by the Overview onboarding checklist AND the Setup Wizard (maps.js).
// Both used to ask this question with their own copy of the logic; two
// copies of a completion check is exactly the LIGHT_SHAPES defect class
// (two lists, one gets updated, the other quietly goes stale) applied to
// "have you finished this step" instead of "what shape is this light" — so
// it lives here once, pure functions over `state`, nothing else.

// Which floors are indoors: Outside (a garden, a yard) is never a storey (iso_lights' one rule).
const { isOutdoorFloorId } = await import(`./iso_lights.js${new URL(import.meta.url).search}`);
// The steps' names and words in the panel's language (views/i18n.js; English is the key).
const { t } = await import(`./i18n.js${new URL(import.meta.url).search}`);

/** At least one map has been uploaded. */
export function hasMaps(state) {
  return !!(state.maps && state.maps.list && state.maps.list.length);
}

/** At least one map has at least one scanner/receiver placed on it. */
export function hasReceivers(state) {
  return hasMaps(state) && state.maps.list.some(m => (m.receivers || []).length > 0);
}

/**
 * At least one room has real boundary geometry. Checked against the FABRIC
 * (model.room_geometry_m) first — that is the one true record a room's
 * shape is judged by — falling back to any per-map room_bounds so a house
 * that drew rooms without ever having built a fabric still reads as started.
 * The rooms that count for the plan path (planRooms): a starter house's box
 * still as made is a placeholder, not a drawn room (ai_wizard.has_fabric_rooms).
 */
export function hasFabricRooms(state) {
  return Object.keys(planRooms(state)).length > 0;
}

/** The rooms that count for the plan path (upload, scale, trace, Setup, the rooms helper; ai_wizard.plan_rooms is this
 *  rule): the house's rooms but the starter house's boxes still as made (starterBoxes). Those are placeholders here and
 *  nowhere else: positioning, devices in their rooms and every other screen read model.room_geometry_m whole. */
export function planRooms(state) {
  const boxes = starterBoxes(state);
  return Object.fromEntries(Object.entries((state.model && state.model.room_geometry_m) || {}).filter(([r]) => !boxes[r]));
}

/** Any room at all on the house or traced on a plan, a starter house's boxes too (whether the starter house is offered,
 *  and "Put my receivers in their rooms", which a box serves as any room does). */
export function hasAnyRooms(state) {
  return Object.keys((state.model && state.model.room_geometry_m) || {}).length > 0
    || (hasMaps(state) && state.maps.list.some(m => Object.keys(m.room_bounds || {}).length > 0));
}

/** hasFabricRooms first (the one true record), OR any per-map room_bounds — a
 * house that only ever drew rooms on a photo, never building a fabric, still
 * reads as started. */
export function hasRooms(state) {
  return hasFabricRooms(state)
    || (hasMaps(state) && state.maps.list.some(m => Object.keys(m.room_bounds || {}).length > 0));
}

/** Whether a plan's floor has rooms already (ai_wizard.plan_roomed is this rule; the rooms helper and Mapping → Edit read
 *  it): rooms drawn on the plan itself, or on its floor (the house's rooms too: Mapping → Layout, the rooms helper, a
 *  vacuum import, Rooms from plans); a plan with no floor never takes another floor's rooms, only those drawn on it (its
 *  room_bounds, or a room whose outline was made from it). */
export function planRoomed(state, m) {
  if (!m) return false;
  if (Object.keys(m.room_bounds || {}).length) return true;
  const geo = Object.values(planRooms(state));             // a starter house's untouched box is no room here
  if (!m.floor_id) return geo.some(r => r && r.source_map_id === m.id);
  return geo.some(r => r && r.floor_id === m.floor_id)
    || ((state.maps && state.maps.list) || []).some(o => o && o.floor_id === m.floor_id && Object.keys(o.room_bounds || {}).length);
}

/** At least one plan has a real-world size: planHasScale, the Library's and the first-scale routing's one rule (review
 *  2026-11-11: a vacuum import's scale has no measurement on record, and a measurement record was asked for here, so
 *  that house kept Setup in its menu for ever). ai_wizard.has_scale is this rule. */
export function hasScale(state) {
  return Object.keys((state.model && state.model.map_transforms) || {}).some(id => planHasScale(state, id));
}

/** This plan has a real-world size (the Library's "not placed" is the opposite): what "No scale yet" asks about. */
export function planHasScale(state, mapId) {
  const t = state.model && state.model.map_transforms && state.model.map_transforms[mapId];
  return !!(t && Number(t.scale_x_m) > 0 && Number(t.scale_y_m) > 0);
}

/**
 * The house has been calibrated: five calibration points or more (the
 * number calibration_store fits a model from), or a fitted model. One rule
 * for the Overview's Getting started "Calibrate" and the guided Setup's
 * "Calibrate" step (views/setup.js). Receivers placed in the layout
 * (model.scanner_positions_m) used to count here too; they are the
 * Receivers step's, not calibration. A house whose checklist was already
 * finished keeps settings.onboarding_completed, so it never comes back.
 */
export function hasCalibration(state) {
  const calPoints = (state.calibration && state.calibration.points) ? state.calibration.points.length : 0;
  const hasModel = !!(state.calibration && state.calibration.model && Object.keys(state.calibration.model).length > 0);
  return calPoints >= 5 || hasModel;
}

/** Whether a room is drawn, the one rule for every "is this room drawn" (review 2026-11-11, C3): its outline is on the
 *  map of your house (room_geometry_m) → {house: true, map: null}; else it is traced on a floor plan that has a scale
 *  (what "Put my receivers in their rooms" counts, ws_fabric.plan_rooms_m) → {house: false, map} (the first such plan:
 *  "Put it on the map" copies it to the house); else null. A room traced only on a plan with no scale is not drawn yet. */
export function roomDrawn(state, name) {
  const m = (hasMaps(state) ? state.maps.list : []).find(p => p && (p.room_bounds || {})[name] && planHasScale(state, p.id));
  // A box of the starter house still as made is a placeholder, not drawn: once traced on a plan, the traced outline is
  // what goes on the map ("Put it on the map" replaces the box).
  if (planRooms(state)[name]) return { house: true, map: null };
  return m ? { house: false, map: m } : null;
}

/** The starter house's boxes still as it made them ("Start with a rough house from your Home Assistant rooms",
 *  rough_plan.js; starter_house.py): {room: corners in metres}. The plan it made keeps each box as made
 *  (map.starter.rooms); a box reshaped since (Mapping → Layout), or replaced by a traced outline, is a room someone
 *  drew, and is not listed. Only these may be replaced by "Put it on the map" (wizard_build.js). */
export function starterBoxes(state) {
  const geo = (state.model && state.model.room_geometry_m) || {}, out = {};
  const same = (a, b) => Array.isArray(a) && Array.isArray(b) && a.length === b.length
    && a.every((p, i) => Array.isArray(p) && Array.isArray(b[i]) && Math.abs(p[0] - b[i][0]) < 0.002 && Math.abs(p[1] - b[i][1]) < 0.002);
  for (const m of hasMaps(state) ? state.maps.list : []) {
    const rooms = m && m.starter && m.starter.rooms;
    if (!rooms || typeof rooms !== "object") continue;
    for (const [room, pts] of Object.entries(rooms)) {
      const g = geo[room];
      if (g && g.type !== "circle" && String(g.floor_id || "main") === String(m.floor_id || "main") && same(g.points_m, pts)) out[room] = pts;
    }
  }
  return out;
}

/**
 * The HA areas that don't yet have a drawn room (roomDrawn). Used by the
 * wizard's Rooms step to show "3 of 7 rooms drawn" instead of a bare
 * yes/no.
 */
export function undrawnAreaNames(state) {
  const areaNames = ((state.model && state.model.areas) || []).map(a => a.name).filter(Boolean);
  return areaNames.filter(name => !roomDrawn(state, name));
}

// ── Receivers: one rule for "this receiver is placed" and "the receivers step is done" (review 2026-11-13, break 4) ──
// Setup, the Setup Wizard's receivers step, Getting started and Mapping → Edit all read these. A receiver is placed
// when it is a pin on a floor plan, or has a position on the map of your house (scanner_positions_m: "Put my receivers
// in their rooms", Calibration → Tune, Mapping → Layout), which the plan's own pins never showed.
const _isNum = (v) => typeof v === "number" && Number.isFinite(v);
const _housePlaced = (state) => Object.entries((state.model && state.model.scanner_positions_m) || {})
  .filter(([, v]) => v && typeof v === "object" && !Array.isArray(v));

/** The receivers placed, by source (a pin with none: its own key); `floorId`: only that floor's. */
export function placedReceivers(state, floorId = null) {
  const out = new Set();
  const on = (f) => !floorId || String(f || "main") === String(floorId);
  for (const m of hasMaps(state) ? state.maps.list : []) {
    if (!m || !on(m.floor_id)) continue;
    (m.receivers || []).forEach((r, i) => out.add((r && (r.source || r.id)) || `${m.id}#${i}`));
  }
  for (const [src, p] of _housePlaced(state)) if (on(p.floor_id)) out.add(src);
  return out;
}

/** The receivers' heights say something: setup_checks' receiver_heights tip does not apply (a house of two floors or
 * more, two receivers with a position or more, all at one height or none given). */
export function receiverHeightsOk(state) {
  const placed = _housePlaced(state).map(([, v]) => v);
  const zs = new Set(placed.map(v => v.z_m).filter(_isNum).map(z => Math.round(z * 100) / 100));
  return !(indoorFloors(state).length > 1 && placed.length > 1 && zs.size <= 1);
}

/** The receivers step is done: a receiver placed, and their heights say something. */
export function receiversDone(state) {
  return placedReceivers(state).size > 0 && receiverHeightsOk(state);
}

// ── The product's order, one list for every list (review 2026-11-13, break 6) ──
// Setup, the Overview's Getting started and the Setup Wizard name the same steps in the same order with the same
// numbers, from here. setup_checks.SETUP_STEPS holds the same ids (tests/test_guided_setup.py).
// Owner's D5 (2026-11-13): "After rooms, 2+ floors only": floor heights come after the rooms, and only a house of two
// indoor floors or more has the step (setupSteps). Nothing before it needs a height: rooms, the rooms helper, receivers'
// heights (above their own floor) and the 3D house use the default storey height until one is set.
// 2026-11-21: "Track your phone or watch" after the receivers and before calibration, which is walked with it (it was
// on the Overview's Track Your Phone card and the phone wizard only, never a step).
export const SETUP_STEPS = ["plan", "scale", "rooms", "floors", "receivers", "phone", "calibration"];
// Read when drawn, so each is in the panel's language at that moment.
export const STEP_LABELS = {
  get plan() { return t("Upload a floor plan"); },
  get scale() { return t("Set the scale"); },
  get floors() { return t("Floors and their heights"); },
  get rooms() { return t("Draw the rooms"); },
  get receivers() { return t("Place receivers and set their heights"); },
  get phone() { return t("Track your phone or watch"); },
  get calibration() { return t("Calibrate"); },
};
export const STEP_ABOUT = {
  get plan() { return t("A photo or scan of each floor. It doesn't need to be perfect. No floor plan? The next screen has other ways: a plan file from another app, a phone's room scan, your own sketch or a blank floor."); },
  get scale() { return t("Measure one distance you know, a doorway or a wall, so the map is to scale."); },
  get floors() { return t("How tall each floor is, so PadSpan can tell the floors apart."); },
  get rooms() { return t("Trace each Home Assistant room onto its floor plan."); },
  get receivers() { return t("Put each Bluetooth receiver where it is mounted, and say how high."); },
  get phone() { return t("Let PadSpan know the phone or watch you carry, so it can follow you and calibrate with it."); },
  get calibration() { return t("Walk around the house with your phone so PadSpan learns what each spot sounds like."); },
};

/** The house's indoor floors (Outside does not count). */
export const indoorFloors = (state) => ((state.model && state.model.floors) || [])
  .filter(f => f && typeof f === "object" && !isOutdoorFloorId(f.floor_id || f.id) && !isOutdoorFloorId(f.name));
/** setup_checks.floor_has_height: a real storey height or elevation. */
export const floorHasHeight = (f) => _isNum(f.floor_to_floor_m) || _isNum(f.base_elevation_m);

/** Each step's "done", from the house: true, false, or null (not known yet). */
const DONE = {
  plan: (s) => hasMaps(s),
  scale: (s) => hasScale(s),
  // One floor has nothing to set: the floor_heights tip's own rule.
  floors: (s) => indoorFloors(s).length <= 1 || indoorFloors(s).some(floorHasHeight),
  rooms: (s) => hasRooms(s),
  receivers: (s) => receiversDone(s),
  // A phone or watch PadSpan follows as someone's (setup_checks.phones_tracked); unknown until the server has said.
  phone: (s) => (Array.isArray(s.setupPhones) ? s.setupPhones.length > 0 : null),
  // The Overview checklist's own rule: five points or a fitted model; unknown until Calibration's points are read.
  calibration: (s) => (s.calibration ? hasCalibration(s) : null),
};
export function stepDone(state, id) { return DONE[id] ? DONE[id](state) : false; }

/** The steps this house has, in order, each with its number: [{id, n, label}]. Floor heights only with two indoor
 *  floors or more (D5). */
export function setupSteps(state) {
  const multi = indoorFloors(state).length > 1;
  return SETUP_STEPS.filter(id => id !== "floors" || multi).map((id, i) => ({ id, n: i + 1, label: STEP_LABELS[id] }));
}

/** Every step this house has is done (an unknown one is not): Setup leaves the menu, Mapping → Edit says no "Next:". */
export function setupDone(state) {
  return setupSteps(state).every(x => stepDone(state, x.id) === true);
}

/** The step to do next, the one rule for Setup's "Next", Getting started's ▶ and the Setup Wizard (review 2026-11-11,
 *  C8): the first step not done that wasn't skipped (`skipped`: setup_progress.skipped), else the first not done; null
 *  when every step is done. */
export function firstOpenStep(state, skipped = []) {
  const open = setupSteps(state).filter(x => stepDone(state, x.id) !== true);
  return ((open.find(x => !skipped.includes(x.id)) || open[0]) || {}).id || null;
}

/** The step after `id` in this house's order (null after the last). */
export function nextStep(state, id) {
  const steps = setupSteps(state), i = steps.findIndex(s => s.id === id);
  return i >= 0 && steps[i + 1] ? steps[i + 1].id : null;
}
