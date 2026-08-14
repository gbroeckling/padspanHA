// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
// See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
//
// THE RSSI → distance model, frontend side. Mirrors the log-distance path loss
// the presence coordinator solves with:
//
//     d = 10 ^ ((rssi_1m − rssi) / (10 · n))
//
// It used to be written out inline with n hard-coded to 2.5 and rssi_1m to
// −59, while positioning used the values from Settings and, where calibration
// had produced one, a per-scanner FITTED rssi_1m and n. So the distance the
// calibration screen showed you was not the distance the engine was working
// from, and tuning either one moved only half the system.
//
// One caveat, stated rather than hidden: the coordinator also applies RF
// barrier attenuation along the specific path between a scanner and a point.
// That needs the geometry, which this side does not have, so these figures are
// free-space estimates. Where a wall is in the way the engine's own distance
// will be shorter than the number shown here — see estimateDistanceM's return.

export const DEFAULT_REF_POWER = -59.0;   // const.py DEFAULT_REF_POWER
export const DEFAULT_PATH_LOSS_EXP = 2.5; // const.py DEFAULT_PATH_LOSS_EXP

/**
 * Reference power and exponent for one scanner, in the order the coordinator
 * resolves them: the per-scanner calibration fit, then the tag's own measured
 * power when it is a plausible dBm@1m, then the configured site defaults.
 *
 * @param fit     model.path_loss[source] — {rssi_1m, n} — or null
 * @param txPower the tag's advertised measured power, or null
 * @param settings settings object (ref_power, path_loss_exp)
 */
export function pathLossParams(fit, txPower, settings){
  const s = settings || {};
  let ref = typeof s.ref_power === "number" ? s.ref_power : DEFAULT_REF_POWER;
  let n = typeof s.path_loss_exp === "number" ? s.path_loss_exp : DEFAULT_PATH_LOSS_EXP;
  // A tag's own measured power beats the site default, but only when it IS a
  // dBm@1m figure. BLE AD 0x0A radiated power is 0..+12 dBm and is not one;
  // accepting it put every such tag kilometres away.
  if(typeof txPower === "number" && txPower >= -90 && txPower <= -30) ref = txPower;
  // A fit from this scanner's own calibration data beats both.
  if(fit){
    if(typeof fit.rssi_1m === "number") ref = fit.rssi_1m;
    if(typeof fit.n === "number" && fit.n > 0) n = fit.n;
  }
  return { ref, n };
}

/** Metres from one RSSI reading. Returns null when there is nothing to solve. */
export function estimateDistanceM(rssi, fit, txPower, settings){
  if(typeof rssi !== "number" || !isFinite(rssi)) return null;
  const { ref, n } = pathLossParams(fit, txPower, settings);
  if(!(n > 0)) return null;
  return Math.pow(10, (ref - rssi) / (10 * n));
}

/** "~3.4m" / "~12m" — one format, so the same distance reads the same way. */
export function formatDistanceM(d){
  if(d == null || !isFinite(d)) return null;
  return d < 10 ? `~${d.toFixed(1)}m` : `~${Math.round(d)}m`;
}
