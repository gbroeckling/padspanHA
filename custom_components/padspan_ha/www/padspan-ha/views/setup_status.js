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

export function hasRooms(state) {
  return hasFabricRooms(state)
    || (hasMaps(state) && state.maps.list.some(m => Object.keys(m.room_bounds || {}).length > 0));
}

/** At least one map has had its real-world scale set (a measurement taken). */
export function hasScale(state) {
  return !!(state.model && state.model.map_transforms
    && Object.values(state.model.map_transforms).some(t => t && t.reference_measurements && t.reference_measurements.length > 0));
}

/**
 * Calibration exists in some form — enough calibration points, a fitted
 * model, or scanners positioned in the fabric all count; there is more than
 * one legitimate way to arrive at a working model.
 */
export function hasCalibration(state) {
  const calPoints = (state.calibration && state.calibration.points) ? state.calibration.points.length : 0;
  const hasModel = !!(state.calibration && state.calibration.model && Object.keys(state.calibration.model).length > 0);
  const hasFabricScanners = !!(state.model && state.model.scanner_positions_m && Object.keys(state.model.scanner_positions_m).length > 0);
  return calPoints >= 5 || hasModel || hasFabricScanners;
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
