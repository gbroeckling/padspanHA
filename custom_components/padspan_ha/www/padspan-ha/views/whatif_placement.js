// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
// See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
//
// What-if scanner placement (gap #9, best-in-class roadmap): scores a
// HYPOTHETICAL scanner position by how much it would help — or hurt —
// telling adjacent rooms apart. Verified first that nothing else answers
// this question: calibration_store.py's LOO cross-validation (loo_accuracy)
// only ever evaluates scanners that already exist and already have
// recorded calibration readings; there is no path to score a scanner that
// was never placed and never heard.
//
// Reuses radio_map.js's OWN exported physics (FLOOR_ATTEN_DB,
// DEFAULT_REF_POWER, DEFAULT_PATH_LOSS_N, barrierAttenuation) rather than
// re-deriving the path-loss + wall-crossing formula a second time.
// _modelRssiAt in that file keeps only the STRONGEST scanner's reading —
// right for a coverage heatmap, wrong here: telling two rooms apart
// depends on the whole fingerprint SHAPE a k-NN-style matcher would
// actually see, not just the best signal, so fingerprintAt below computes
// every scanner's own reading instead.
//
// Pure — no DOM, no live-drag/UI code (that lives in maps.js, calling
// this on drag move with the existing runDrag primitive).

import { FLOOR_ATTEN_DB, DEFAULT_REF_POWER, DEFAULT_PATH_LOSS_N, barrierAttenuation } from "./radio_map.js";

const NO_SIGNAL_DBM = -120; // radio_map.js's own "nothing to hear" floor

/**
 * Modelled per-scanner RSSI vector at a point.
 * scanners: [{x_m, y_m, dz, source, floorDist}] — radio_map.js's own shape.
 * barriers: [{points: [[x,y],...], attenuation_dbm}].
 */
export function fingerprintAt(x, y, scanners, barriers, opts = {}) {
  const refPower = opts.refPower ?? DEFAULT_REF_POWER;
  const pathLossN = opts.pathLossN ?? DEFAULT_PATH_LOSS_N;
  const quality = opts.quality || {};
  const vec = {};
  for (const sc of (scanners || [])) {
    const horiz = Math.hypot(x - sc.x_m, y - sc.y_m);
    const distM = Math.max(0.3, Math.hypot(horiz, sc.dz || 0));
    let rssi = (refPower + (quality[sc.source] || 0)) - 10 * pathLossN * Math.log10(distM);
    if (sc.floorDist > 0) rssi -= sc.floorDist * FLOOR_ATTEN_DB;
    rssi -= barrierAttenuation(x, y, sc.x_m, sc.y_m, barriers || []);
    vec[sc.source] = rssi;
  }
  return vec;
}

/**
 * Vertex-average centroid — a deliberate simplification (not the true
 * area-weighted polygon centroid), good enough for "roughly where in the
 * room" as a single sample point. Not used for anything but this score.
 */
export function polygonCentroid(pts) {
  if (!pts || !pts.length) return null;
  let sx = 0, sy = 0;
  for (const [x, y] of pts) { sx += x; sy += y; }
  return [sx / pts.length, sy / pts.length];
}

/**
 * Euclidean distance between two fingerprint vectors, over the UNION of
 * scanners either mentions. A scanner missing from one vector reads as
 * NO_SIGNAL_DBM there rather than being skipped — a scanner that only
 * reaches one of two rooms is real evidence separating them, not a gap
 * to ignore.
 */
export function fingerprintDistance(a, b) {
  const sources = new Set([...Object.keys(a || {}), ...Object.keys(b || {})]);
  let sumSq = 0;
  for (const s of sources) {
    const av = (a && a[s] != null) ? a[s] : NO_SIGNAL_DBM;
    const bv = (b && b[s] != null) ? b[s] : NO_SIGNAL_DBM;
    sumSq += (av - bv) ** 2;
  }
  return Math.sqrt(sumSq);
}

/**
 * Room-discrimination score: mean fingerprint separation across every
 * ADJACENT room pair — not every pair. Two rooms far apart are already
 * trivially told apart; the useful signal is about currently-confusable
 * NEIGHBOURS. Higher is better. Score 0 / empty pairs when there is
 * nothing to score (no adjacency data, or a single-room floor).
 *
 * rooms: {roomName: {pts: [[x,y],...]}} — fabric room_geometry_m shape.
 * adjacency: {roomName: [neighbourName, ...]} — fabric room_adjacency,
 *   symmetric (each side lists the other); pairs are de-duplicated.
 */
export function roomDiscriminationScore(rooms, adjacency, scanners, barriers, opts = {}) {
  const centroids = {};
  for (const [name, geo] of Object.entries(rooms || {})) {
    centroids[name] = polygonCentroid(geo && geo.pts);
  }
  const seen = new Set();
  const pairNames = [];
  for (const [room, neighbours] of Object.entries(adjacency || {})) {
    for (const nb of (neighbours || [])) {
      const key = [room, nb].sort().join("|");
      if (seen.has(key)) continue;
      seen.add(key);
      if (centroids[room] && centroids[nb]) pairNames.push([room, nb]);
    }
  }
  if (!pairNames.length) return { score: 0, pairs: [] };
  const pairs = pairNames.map(([a, b]) => {
    const fa = fingerprintAt(centroids[a][0], centroids[a][1], scanners, barriers, opts);
    const fb = fingerprintAt(centroids[b][0], centroids[b][1], scanners, barriers, opts);
    return { rooms: [a, b], distance: Math.round(fingerprintDistance(fa, fb) * 100) / 100 };
  });
  const score = pairs.reduce((s, p) => s + p.distance, 0) / pairs.length;
  return { score: Math.round(score * 100) / 100, pairs };
}

/**
 * The what-if delta: room-discrimination score WITH a hypothetical ghost
 * scanner appended, minus WITHOUT it. Positive means the candidate
 * position would help tell adjacent rooms apart; negative (rare, but
 * possible if it sits somewhere that makes two rooms look MORE alike)
 * means it would hurt.
 */
export function whatIfDelta(rooms, adjacency, realScanners, ghostScanner, barriers, opts = {}) {
  const baseline = roomDiscriminationScore(rooms, adjacency, realScanners, barriers, opts);
  const withGhost = roomDiscriminationScore(rooms, adjacency, [...(realScanners || []), ghostScanner], barriers, opts);
  return {
    baseline: baseline.score,
    withGhost: withGhost.score,
    delta: Math.round((withGhost.score - baseline.score) * 100) / 100,
    pairs: withGhost.pairs,
  };
}
