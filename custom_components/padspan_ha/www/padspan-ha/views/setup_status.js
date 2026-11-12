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
 */
export function hasFabricRooms(state) {
  return !!(state.model && state.model.room_geometry_m
    && Object.keys(state.model.room_geometry_m).length > 0);
}

/** hasFabricRooms first (the one true record), OR any per-map room_bounds — a
 * house that only ever drew rooms on a photo, never building a fabric, still
 * reads as started. */
export function hasRooms(state) {
  return hasFabricRooms(state)
    || (hasMaps(state) && state.maps.list.some(m => Object.keys(m.room_bounds || {}).length > 0));
}

/** At least one map has had its real-world scale set (a measurement taken). */
export function hasScale(state) {
  return !!(state.model && state.model.map_transforms
    && Object.values(state.model.map_transforms).some(t => t && t.reference_measurements && t.reference_measurements.length > 0));
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

/**
 * The HA areas that don't yet have a drawn room boundary on ANY map, in
 * fabric-room_geometry_m terms first (rooms are per-house, not per-photo),
 * falling back to per-map room_bounds the same way hasRooms does. Used by
 * the wizard's Rooms step to show "3 of 7 rooms drawn" instead of a bare
 * yes/no.
 */
export function undrawnAreaNames(state) {
  const areaNames = ((state.model && state.model.areas) || []).map(a => a.name).filter(Boolean);
  const fabricDrawn = new Set(Object.keys((state.model && state.model.room_geometry_m) || {}));
  const perMapDrawn = new Set();
  if (hasMaps(state)) {
    for (const m of state.maps.list) {
      for (const room of Object.keys(m.room_bounds || {})) perMapDrawn.add(room);
    }
  }
  return areaNames.filter(name => !fabricDrawn.has(name) && !perMapDrawn.has(name));
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
  const floors = ((state.model && state.model.floors) || []).filter(f => f && typeof f === "object");
  const zs = new Set(placed.map(v => v.z_m).filter(_isNum).map(z => Math.round(z * 100) / 100));
  return !(floors.length > 1 && placed.length > 1 && zs.size <= 1);
}

/** The receivers step is done: a receiver placed, and their heights say something. */
export function receiversDone(state) {
  return placedReceivers(state).size > 0 && receiverHeightsOk(state);
}
