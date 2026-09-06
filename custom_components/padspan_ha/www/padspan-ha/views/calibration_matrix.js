// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
// See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
//
// The calibration error matrix (gap #3, docs/BEST_IN_CLASS_ROADMAP.md):
// for every (calibration point, scanner) pair with a reading, compare the
// GEOMETRIC distance (from the fabric — both positions are known) against
// the distance that scanner's own path-loss fit would derive from the
// point's measured RSSI. A scanner whose fit is good agrees with geometry
// everywhere; one cell far off the diagonal is exactly the "this fit /
// this point is suspect" signal a raw R² number cannot localise.
//
// "TX×RX" in the roadmap's own phrasing does not exist literally in this
// codebase — scanners never hear each other's advertisements, verified by
// reading fit_path_loss()/path_loss_by_source() in calibration_store.py.
// The real pairwise data is calibration-point × scanner, which is exactly
// what fit_path_loss() already regresses over; this just keeps the
// per-pair residual that regression normally discards.
//
// measured_m reuses path_loss.js's estimateDistanceM — the ONE frontend
// RSSI→distance implementation — rather than a second copy. expected_m has
// no existing helper (it's geometry, not RSSI math): the same slant-range
// calc calibration_store.py's fit_path_loss() uses server-side (2D when a
// floor's elevation is unresolvable, 3D otherwise), so a cell's residual
// means the same thing here as it does in the fit it is checking.

import { estimateDistanceM } from "./path_loss.js";

/**
 * points: calibration points ({x_m, y_m, floor_id, room, label, id,
 *   scanner_readings: [{source, mean_rssi}]})
 * pathLoss: model.path_loss — {source: {rssi_1m, n, units, scanner_name?}}
 * scannerPositions: model.scanner_positions_m — {source: {x_m, y_m, floor_id, z_m}}
 * floorElevations: model.floor_elevations — {floor_id: base_elevation_m}
 * deviceHeightM: settings.assumed_device_height_m (walk height above floor)
 *
 * Returns {scanners: [source,...], rows: [{pointId, room, label, cells}]}
 * where cells[source] is {expected_m, measured_m, error_m, rssi} or null
 * when that scanner never heard this point (grey/silent).
 */
export function buildCalibrationMatrix(opts) {
  const points = (opts && opts.points) || [];
  const pathLoss = (opts && opts.pathLoss) || {};
  const scannerPositions = (opts && opts.scannerPositions) || {};
  const floorElevations = (opts && opts.floorElevations) || {};
  const settings = (opts && opts.settings) || {};
  const deviceHeightM = typeof settings.assumed_device_height_m === "number"
    ? settings.assumed_device_height_m : 1.0;

  const scanners = Object.keys(pathLoss).filter(src => {
    const fit = pathLoss[src];
    const pos = scannerPositions[src];
    return fit && fit.units === "m" && typeof fit.rssi_1m === "number" && typeof fit.n === "number"
      && pos && typeof pos.x_m === "number" && typeof pos.y_m === "number";
  });

  const metrePoints = points.filter(p => typeof p.x_m === "number" && typeof p.y_m === "number");
  const round1 = (n) => Math.round(n * 10) / 10;

  const rows = metrePoints.map((p, idx) => {
    const cells = {};
    for (const src of scanners) {
      const reading = (p.scanner_readings || []).find(r => r.source === src);
      if (!reading || typeof reading.mean_rssi !== "number") { cells[src] = null; continue; }
      const sp = scannerPositions[src];
      const dx = p.x_m - sp.x_m;
      const dy = p.y_m - sp.y_m;
      let dSq = dx * dx + dy * dy;
      const pBase = floorElevations[String(p.floor_id || "")];
      const sBase = floorElevations[String(sp.floor_id || "")];
      // No resolvable floor stays 2D, same as fit_path_loss() — guessing an
      // elevation for an unresolved floor injects false vertical range.
      if (typeof pBase === "number" && typeof sBase === "number") {
        const sAbsZ = sBase + (typeof sp.z_m === "number" ? sp.z_m : 2.4);
        const pAbsZ = pBase + deviceHeightM;
        dSq += (sAbsZ - pAbsZ) ** 2;
      }
      const expected_m = Math.sqrt(dSq);
      const measured_m = estimateDistanceM(reading.mean_rssi, pathLoss[src], null, settings);
      cells[src] = {
        expected_m: round1(expected_m),
        measured_m: measured_m == null ? null : round1(measured_m),
        error_m: measured_m == null ? null : round1(measured_m - expected_m),
        rssi: reading.mean_rssi,
      };
    }
    return {
      pointId: p.id || `pt${idx}`,
      room: p.room || "",
      label: p.label || "",
      cells,
    };
  });

  return { scanners, rows };
}

const ERROR_CAP_M = 3.0;

/**
 * Diverging heat colour for a signed error in metres: blue (the fit reports
 * this point FARTHER than geometry says — an underestimate of RSSI-implied
 * closeness), green (accurate), red (the fit reports it CLOSER than
 * geometry says). Null (no reading — grey) is the caller's job, since grey
 * needs to read as "no data" rather than a valid low-magnitude color.
 */
export function errorColor(errorM) {
  if (typeof errorM !== "number" || !isFinite(errorM)) return null;
  const e = Math.max(-ERROR_CAP_M, Math.min(ERROR_CAP_M, errorM));
  const hue = e <= 0
    ? 210 + (140 - 210) * ((e + ERROR_CAP_M) / ERROR_CAP_M)
    : 140 - 140 * (e / ERROR_CAP_M);
  return `hsl(${Math.round(hue)}, 65%, 50%)`;
}
