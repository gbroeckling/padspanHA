// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
// See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
/**
 * Radio Map & Distortion Map — SVG overlay generators for map views.
 *
 * Radio Map: RSSI heatmap from calibration data, interpolated across the map
 *   using barrier-aware IDW (Inverse Distance Weighting). RF barriers (walls)
 *   defined in the map editor are drawn on the overlay and penalize the IDW
 *   weights — signal from a calibration point that must pass through a wall
 *   contributes less to grid cells on the other side.
 *
 * Distortion Map: For each calibration point, computes the LOO k-NN predicted
 *   position vs actual position, rendering disagreement vectors as arrows.
 *   Reveals where walls/furniture/interference cause positioning errors.
 *
 * Both output SVG strings in viewBox="0 0 1 1" space for compositing into
 * any map overlay (2D Overview, Maps tab, 3D Stack).
 *
 * Gated behind: settings.radio_map_enabled / settings.distortion_map_enabled
 */

const GRID_RES = 42;       // 42x42 interpolation grid (1764 cells) for 2D
const IDW_POWER = 2.5;     // IDW exponent (higher = more local, sharper near barriers)
// dBm penalty per slab crossed. Tracks _SLAB_PENALTY_DB in presence_coordinator:
// the picture and the solver must model cross-floor loss the same way, or the
// heatmap shows a cross-floor reading the engine never believed.
const FLOOR_ATTEN_DB = 10;
const KNN_K = 3;           // k for LOO cross-validation
const BARRIER_PENALTY_DB_TO_DIST = 0.01; // each dB of barrier attenuation adds this much "virtual distance"

// ── Model-Based RF Propagation ───────────────────────────────────────────────
// Computes predicted RSSI at any point based on scanner positions + path-loss
// model. No calibration data needed — pure physics + wall attenuation.
const DEFAULT_REF_POWER = -59;   // dBm at 1 meter
const DEFAULT_PATH_LOSS_N = 2.5; // indoor path-loss exponent
const MAP_SCALE_M = 15;          // assumed map width in meters (for distance calc)

/**
 * Compute model-based RSSI at a world-space point from all scanners.
 * Returns the BEST (strongest) scanner's predicted RSSI.
 *
 * @param {number} wx - world X
 * @param {number} wy - world Y
 * @param {Array} scanners - [{wx, wy, source}] scanner world positions
 * @param {Array} barriers - [{points:[[wx,wy],...], attenuation_dbm}] in world coords
 * @param {number} refPower - reference RSSI at 1m
 * @param {number} pathLossN - path-loss exponent
 * @param {number} mapScaleM - map width in meters
 * @returns {number} predicted best RSSI in dBm
 */
function _modelRSSI(wx, wy, scanners, barriers, refPower, pathLossN, mapScaleM) {
  let bestRssi = -120;
  for (const sc of scanners) {
    const dx = wx - sc.wx, dy = wy - sc.wy;
    const distNorm = Math.sqrt(dx * dx + dy * dy); // normalized distance (0-1 ish)
    const distM = Math.max(0.3, distNorm * mapScaleM); // meters, floor at 30cm
    // Path-loss: RSSI = refPower - 10 * n * log10(distance)
    let rssi = refPower - 10 * pathLossN * Math.log10(distM);
    // Barrier attenuation: subtract dBm for each wall crossed
    for (const bar of barriers) {
      const pts = bar.points || [];
      for (let i = 0; i < pts.length - 1; i++) {
        if (_segmentsIntersect(wx, wy, sc.wx, sc.wy, pts[i][0], pts[i][1], pts[i+1][0], pts[i+1][1])) {
          rssi -= (bar.attenuation_dbm ?? 6);
        }
      }
    }
    if (rssi > bestRssi) bestRssi = rssi;
  }
  return bestRssi;
}

// ── Color Scales ─────────────────────────────────────────────────────────────

// ── Hatch Pattern System ─────────────────────────────────────────────────────
// 16 color buckets from -95 to -30 dBm. Each bucket gets a <pattern> with 45°
// diagonal lines in that color. Grid cells reference url(#rmh_N) instead of
// solid fills, letting the map image show through the gaps.

const HATCH_BUCKETS = 16;
// Data-adaptive scale: computed from actual calibration data at render time.
// These defaults are overridden by setHatchRange() before rendering.
let HATCH_WORST = -85;
let HATCH_BEST  = -55;
let HATCH_RANGE = HATCH_BEST - HATCH_WORST;

/**
 * Set the data-adaptive range for heatmap colors.
 * @param {number} worst - weakest RSSI in data
 * @param {number} best - strongest RSSI in data
 * @param {number} gain - user gain offset in dBm (shifts entire scale, default 0)
 * @param {number} contrast - user contrast offset (widens range when negative, narrows when positive, default 0)
 */
export function setHatchRange(worst, best, gain, contrast) {
  const g = gain || 0;
  const c = contrast || 0;
  // Use global range if set (ensures all floors share the same color scale)
  const w = _globalRangeSet ? _globalMinR : worst;
  const b = _globalRangeSet ? _globalMaxR : best;
  const pad = Math.max(2, (b - w) * 0.05);
  HATCH_WORST = w - pad + g - c;
  HATCH_BEST = b + pad + g + c;
  HATCH_RANGE = HATCH_BEST - HATCH_WORST;
  if (HATCH_RANGE < 5) { HATCH_WORST = HATCH_BEST - 20; HATCH_RANGE = HATCH_BEST - HATCH_WORST; }
}

// User gain/contrast stored module-level so all renderers pick them up
let _userGain = 0;
let _userContrast = 0;
/** Set user gain/contrast before rendering. Called from overview.js. */
export function setUserGainContrast(gain, contrast) {
  _userGain = gain || 0;
  _userContrast = contrast || 0;
}

// Global color range — set ONCE across all floors before rendering any of them.
// Prevents per-floor scaling that makes bad floors look green.
let _globalRangeSet = false;
let _globalMinR = -80, _globalMaxR = -40;

/** Pre-compute the global RSSI range across all floors. Call before the level loop. */
export function setGlobalRange(minR, maxR) {
  _globalMinR = minR;
  _globalMaxR = maxR;
  _globalRangeSet = true;
}
export function clearGlobalRange() { _globalRangeSet = false; }

// Compute opaque RGB for a bucket index (0 = worst, HATCH_BUCKETS-1 = best)
// Color gradient is pure visual — independent of dBm thresholds.
function _bucketRGB(idx) {
  const t = idx / (HATCH_BUCKETS - 1); // 0=worst, 1=best — LINEAR
  let r, g, b;
  if (t < 0.15) {
    // very dark maroon → dark red (-90 to -84 dBm)
    const u = t / 0.15;
    r = Math.round(30 + u * 100);   // 30→130
    g = Math.round(u * 8);          // 0→8
    b = Math.round(5 + u * 5);      // 5→10
  } else if (t < 0.35) {
    // dark red → bright red (-84 to -76 dBm)
    const u = (t - 0.15) / 0.20;
    r = Math.round(130 + u * 110);  // 130→240
    g = Math.round(8 + u * 35);     // 8→43
    b = 10;
  } else if (t < 0.55) {
    // bright red → orange-yellow (-76 to -68 dBm)
    const u = (t - 0.35) / 0.20;
    r = 240;
    g = Math.round(43 + u * 170);   // 43→213
    b = Math.round(10 + u * 15);    // 10→25
  } else if (t < 0.70) {
    // orange-yellow → bright lime green (-68 to -62 dBm)
    const u = (t - 0.55) / 0.15;
    r = Math.round(240 - u * 210);  // 240→30
    g = Math.round(213 + u * 42);   // 213→255
    b = Math.round(25 + u * 25);    // 25→50
  } else {
    // bright lime green → electric neon green (-62 to -50 dBm)
    const u = (t - 0.70) / 0.30;
    r = Math.round(30 - u * 30);    // 30→0
    g = 255;                         // full green channel
    b = Math.round(50 + u * 80);    // 50→130 (adds cyan punch at peak)
  }
  return `rgb(${r},${g},${b})`;
}

// Map RSSI → bucket index
function _rssiBucket(rssi) {
  if (rssi == null || isNaN(rssi)) return -1;
  return Math.max(0, Math.min(HATCH_BUCKETS - 1,
    Math.round((rssi - HATCH_WORST) / HATCH_RANGE * (HATCH_BUCKETS - 1))
  ));
}

/**
 * Generate <defs> block with 45° crosshatch patterns for heatmap cells.
 * @param {string} prefix - unique prefix to avoid SVG ID collisions (e.g. "rm2d", "rmiso", "rmfl")
 * @param {number} spacing - pattern tile size in the coordinate system (e.g. 0.012 for viewBox 0-1)
 * @param {number} lineW - stroke width of hatch lines
 * @returns {string} SVG <defs>...</defs> block
 */
export function hatchDefs(prefix, spacing, lineW) {
  let s = "<defs>";
  // Airy dotted pattern: short dot, long gap — mostly empty space
  const dotLen = (lineW * 1.2).toFixed(5);
  const gapLen = (lineW * 4.0).toFixed(5);
  const dash = `${dotLen} ${gapLen}`;
  for (let i = 0; i < HATCH_BUCKETS; i++) {
    const c = _bucketRGB(i);
    const sp = spacing.toFixed(5);
    // Line width grows with bucket index: weakest = base, strongest = 1.6× base
    const scale = 1.0 + (i / (HATCH_BUCKETS - 1)) * 0.6;
    const lw = (lineW * scale).toFixed(5);
    // Rotate from 45° (red/worst) to 185° (green/best) — 140° sweep
    const angle = 45 + (i / (HATCH_BUCKETS - 1)) * 140;
    // Gap is wider for red (more sparse/airy) and tighter for green (more solid/confident)
    const gapScale = 8.0 - (i / (HATCH_BUCKETS - 1)) * 4.5; // 8.0 (red, very sparse) → 3.5 (green, denser)
    const dotS = (lineW * scale * 1.2).toFixed(5);
    const gapS = (lineW * scale * gapScale).toFixed(5);
    s += `<pattern id="${prefix}_${i}" x="0" y="0" width="${sp}" height="${sp}" patternUnits="userSpaceOnUse" patternTransform="rotate(${angle.toFixed(1)})">`;
    s += `<line x1="0" y1="0" x2="0" y2="${sp}" stroke="${c}" stroke-width="${lw}" stroke-dasharray="${dotS} ${gapS}" stroke-linecap="round" opacity="0.8"/>`;
    s += `</pattern>`;
  }
  // Null bucket for no-data cells
  s += `<pattern id="${prefix}_null" x="0" y="0" width="${spacing.toFixed(5)}" height="${spacing.toFixed(5)}" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">`;
  s += `<line x1="0" y1="0" x2="0" y2="${spacing.toFixed(5)}" stroke="#333" stroke-width="${lineW.toFixed(5)}" stroke-dasharray="${dash}" stroke-linecap="round" opacity="0.1"/>`;
  s += `</pattern>`;
  s += "</defs>";
  return s;
}

/** Get fill attribute for a cell: url(#prefix_N) */
function _hatchFill(prefix, rssi) {
  const idx = _rssiBucket(rssi);
  return idx < 0 ? `url(#${prefix}_null)` : `url(#${prefix}_${idx})`;
}

// Legacy solid fill (used for iso 3D cells where patterns don't project well)
function _rssiColor(rssi) {
  if (rssi == null || isNaN(rssi)) return "rgba(60,60,60,0.15)";
  const idx = _rssiBucket(rssi);
  if (idx < 0) return "rgba(60,60,60,0.15)";
  // Reuse bucket RGB with alpha for solid fills
  return _bucketRGB(idx).replace("rgb(", "rgba(").replace(")", ",0.6)");
}

// Error magnitude → color: green (low) → yellow → red (high)
function _errorColor(errFrac) {
  const t = Math.max(0, Math.min(1, errFrac / 0.25)); // 0=accurate, 1=25%+ error
  const r = Math.round(t < 0.5 ? 80 + t * 2 * 168 : 248);
  const g = Math.round(t < 0.5 ? 183 : 183 - (t - 0.5) * 2 * 120);
  const b = 40;
  return `rgb(${r},${g},${b})`;
}

// ── Line Segment Intersection ────────────────────────────────────────────────
// Returns true if segment (ax,ay)→(bx,by) intersects segment (cx,cy)→(dx,dy)

function _segmentsIntersect(ax, ay, bx, by, cx, cy, dx, dy) {
  const denom = (bx - ax) * (dy - cy) - (by - ay) * (dx - cx);
  if (Math.abs(denom) < 1e-12) return false;
  const t = ((cx - ax) * (dy - cy) - (cy - ay) * (dx - cx)) / denom;
  const u = ((cx - ax) * (by - ay) - (cy - ay) * (bx - ax)) / denom;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1;
}

/**
 * Compute total barrier attenuation (dBm) between two points.
 * Checks every barrier segment for intersections with the line (x1,y1)→(x2,y2).
 */
function _barrierAttenuation(x1, y1, x2, y2, barriers) {
  let totalDb = 0;
  for (const bar of barriers) {
    const pts = bar.points || [];
    const atten = bar.attenuation_dbm ?? 6;
    for (let i = 0; i < pts.length - 1; i++) {
      const [cx, cy] = pts[i];
      const [dx, dy] = pts[i + 1];
      if (_segmentsIntersect(x1, y1, x2, y2, cx, cy, dx, dy)) {
        totalDb += atten;
      }
    }
  }
  return totalDb;
}

// ── Barrier-aware IDW Interpolation ──────────────────────────────────────────

/**
 * Interpolate RSSI at (qx, qy) from calibration points using barrier-aware IDW.
 * Barriers between query point and calibration point add virtual distance,
 * reducing the weight of points on the other side of walls.
 */
function _idw(qx, qy, points, barriers) {
  if (!points.length) return null;
  let wSum = 0, vSum = 0;
  for (const p of points) {
    const dx = qx - p.x_frac;
    const dy = qy - p.y_frac;
    let dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < 0.001) return p.rssi; // exact match

    // Add virtual distance for barriers crossed
    if (barriers && barriers.length) {
      const attenDb = _barrierAttenuation(qx, qy, p.x_frac, p.y_frac, barriers);
      if (attenDb > 0) {
        dist += attenDb * BARRIER_PENALTY_DB_TO_DIST;
      }
    }

    const w = 1.0 / Math.pow(dist, IDW_POWER);
    wSum += w;
    vSum += w * p.rssi;
  }
  return wSum > 0 ? vSum / wSum : null;
}

// ── Barrier SVG Renderer ─────────────────────────────────────────────────────

/**
 * Render RF barriers as dashed lines on the overlay.
 */
function _barriersSVG(barriers) {
  if (!barriers || !barriers.length) return "";
  let s = "";
  const matColors = { metal: "#f87171", concrete: "#fb923c", brick: "#fbbf24", custom: "#94a3b8", open: "#38bdf8" };
  for (const bar of barriers) {
    const pts = bar.points || [];
    if (pts.length < 2) continue;
    const color = matColors[bar.material] || matColors.custom;
    const atten = bar.attenuation_dbm || 0;
    const d = pts.map((p, i) => `${i === 0 ? "M" : "L"}${p[0].toFixed(4)},${p[1].toFixed(4)}`).join(" ");
    if (bar.material === "open") {
      // Open/loft: thin dotted line to show boundary without implying a wall
      s += `<path d="${d}" fill="none" stroke="${color}" stroke-width="0.002" stroke-dasharray="0.004,0.008" opacity="0.5"/>`;
    } else {
      // Solid wall: thicker line for higher attenuation
      const sw = Math.max(0.003, Math.min(0.008, atten * 0.0006));
      s += `<path d="${d}" fill="none" stroke="${color}" stroke-width="${sw.toFixed(4)}" stroke-dasharray="0.012,0.006" opacity="0.7"/>`;
    }
  }
  return s;
}

// ── Radio Map SVG Generator ──────────────────────────────────────────────────

/**
 * Generate radio map heatmap SVG string for a specific map.
 * @param {Array} calPoints - calibration points from calibrationGet()
 * @param {string} mapId - which map to render
 * @param {string|null} scannerSource - specific scanner source, or null for combined
 * @param {Array} receivers - map receivers [{source, x, y, label}]
 * @param {Array} barriers - RF barriers [{points, attenuation_dbm, material}]
 * @returns {string} SVG string (viewBox 0 0 1 1), empty string if no data
 */
export function radioMapSVG(calPoints, mapId, scannerSource, receivers, barriers) {
  // Filter calibration points for this map
  const mapPts = (calPoints || []).filter(p => p.map_id === mapId);
  if (!mapPts.length) return "";

  // Extract per-point RSSI for the target scanner or combined
  const dataPoints = [];
  for (const pt of mapPts) {
    const readings = pt.scanner_readings || [];
    if (scannerSource) {
      const r = readings.find(rd => rd.source === scannerSource);
      if (r && r.mean_rssi != null) {
        dataPoints.push({ x_frac: pt.x_frac, y_frac: pt.y_frac, rssi: r.mean_rssi });
      }
    } else {
      // Combined: strongest single scanner RSSI at each point.
      // This is the most intuitive metric — "how close is the nearest scanner?"
      // Near a scanner = strong (-40), far from all = weak (-80).
      const rssis = readings.map(r => r.mean_rssi).filter(v => v != null);
      if (rssis.length) {
        const bestRssi = Math.max(...rssis);
        dataPoints.push({ x_frac: pt.x_frac, y_frac: pt.y_frac, rssi: bestRssi });
      }
    }
  }

  if (!dataPoints.length) return "";

  // Compute RSSI range for data-adaptive color scaling
  const allRssi = dataPoints.map(p => p.rssi);
  const minR = Math.min(...allRssi);
  const maxR = Math.max(...allRssi);
  setHatchRange(minR, maxR, _userGain, _userContrast);
  const mapBarriers = (barriers || []);

  // Build interpolation grid with barrier-aware IDW + 45° crosshatch patterns
  const cellW = 1.0 / GRID_RES;
  const cellH = 1.0 / GRID_RES;
  const _pfx = "rm2d";
  let s = hatchDefs(_pfx, 0.010, 0.004);

  for (let gy = 0; gy < GRID_RES; gy++) {
    for (let gx = 0; gx < GRID_RES; gx++) {
      const qx = (gx + 0.5) * cellW;
      const qy = (gy + 0.5) * cellH;
      const rssi = _idw(qx, qy, dataPoints, mapBarriers);
      const fill = _hatchFill(_pfx, rssi);
      s += `<rect x="${(gx * cellW).toFixed(4)}" y="${(gy * cellH).toFixed(4)}" width="${cellW.toFixed(4)}" height="${cellH.toFixed(4)}" fill="${fill}"/>`;
    }
  }

  // RF barrier overlay (dashed wall lines)
  s += _barriersSVG(mapBarriers);

  // Calibration point markers (small circles at actual positions)
  // Calibration point markers — colored by their own RSSI value for visual verification.
  // The number shown IS the value driving the heatmap at that point.
  for (const dp of dataPoints) {
    const dpBucket = _rssiBucket(dp.rssi);
    const dpColor = dpBucket >= 0 ? _bucketRGB(dpBucket) : "#e2e8f0";
    s += `<circle cx="${dp.x_frac.toFixed(4)}" cy="${dp.y_frac.toFixed(4)}" r="0.010" fill="${dpColor}" stroke="#071008" stroke-width="0.002" opacity="0.9"/>`;
    // Background rect for readability
    s += `<rect x="${(dp.x_frac + 0.010).toFixed(4)}" y="${(dp.y_frac - 0.008).toFixed(4)}" width="0.04" height="0.016" rx="0.003" fill="rgba(7,16,8,0.85)"/>`;
    s += `<text x="${(dp.x_frac + 0.014).toFixed(4)}" y="${(dp.y_frac + 0.004).toFixed(4)}" fill="${dpColor}" font-size="0.014" font-weight="700" font-family="monospace" opacity="0.95">${Math.round(dp.rssi)}</text>`;
  }

  // Scanner position marker (if single scanner + position known)
  if (scannerSource && receivers) {
    const rx = receivers.find(r => (r.source || r.id || "") === scannerSource || (r.label || "") === scannerSource);
    if (rx) {
      const px = rx.x != null ? rx.x : 0.5;
      const py = rx.y != null ? rx.y : 0.5;
      // Pulsing rings around scanner
      s += `<circle cx="${px}" cy="${py}" r="0.035" fill="none" stroke="#52b788" stroke-width="0.002" opacity="0.3"/>`;
      s += `<circle cx="${px}" cy="${py}" r="0.022" fill="none" stroke="#52b788" stroke-width="0.003" opacity="0.5"/>`;
      s += `<circle cx="${px}" cy="${py}" r="0.010" fill="#52b788" opacity="0.9"/>`;
    }
  }

  // RSSI legend (bottom-left corner) — absolute dBm scale
  const legendY = 0.90;
  s += `<rect x="0.02" y="${legendY - 0.01}" width="0.34" height="0.09" rx="0.008" fill="rgba(7,16,8,0.85)"/>`;
  s += `<text x="0.035" y="${legendY + 0.01}" fill="#e2e8f0" font-size="0.018" font-weight="600" font-family="system-ui,sans-serif">${scannerSource ? "Scanner" : "Combined"} Radio Map</text>`;
  const legSteps = 8;
  const barW = 0.03;
  for (let i = 0; i < legSteps; i++) {
    const bucketIdx = Math.round(i / (legSteps - 1) * (HATCH_BUCKETS - 1));
    s += `<rect x="${(0.035 + i * barW).toFixed(3)}" y="${legendY + 0.025}" width="${barW.toFixed(3)}" height="0.015" fill="${_bucketRGB(bucketIdx)}"/>`;
  }
  s += `<text x="0.035" y="${legendY + 0.06}" fill="#fca5a5" font-size="0.013" font-family="system-ui,sans-serif">${Math.round(minR)} dBm (weak)</text>`;
  s += `<text x="${(0.035 + (legSteps - 1) * barW).toFixed(3)}" y="${legendY + 0.06}" fill="#52b788" font-size="0.013" font-family="system-ui,sans-serif">${Math.round(maxR)} dBm</text>`;
  s += `<text x="0.035" y="${legendY + 0.075}" fill="#94a3b8" font-size="0.012" font-family="system-ui,sans-serif">${dataPoints.length} cal points \u2022 range ${Math.round(minR)} to ${Math.round(maxR)} dBm</text>`;
  // Wall legend
  if (mapBarriers.length) {
    s += `<line x1="0.22" y1="${legendY + 0.072}" x2="0.26" y2="${legendY + 0.072}" stroke="#f87171" stroke-width="0.003" stroke-dasharray="0.012,0.006" opacity="0.7"/>`;
    s += `<text x="0.265" y="${legendY + 0.076}" fill="#94a3b8" font-size="0.012" font-family="system-ui,sans-serif">RF wall</text>`;
  }

  return s;
}

/**
 * Get unique scanner sources from calibration points for a given map.
 * Returns [{source, name, pointCount}] sorted by point count descending.
 */
export function getMapScanners(calPoints, mapId) {
  const mapPts = (calPoints || []).filter(p => p.map_id === mapId);
  const scannerMap = {};
  for (const pt of mapPts) {
    for (const r of (pt.scanner_readings || [])) {
      if (!r.source) continue;
      if (!scannerMap[r.source]) scannerMap[r.source] = { source: r.source, name: r.name || r.source, pointCount: 0 };
      scannerMap[r.source].pointCount++;
    }
  }
  return Object.values(scannerMap).sort((a, b) => b.pointCount - a.pointCount);
}


// ── Distortion Map SVG Generator ─────────────────────────────────────────────
// Shows where calibration predictions disagree with reality:
//   1. Radio map heatmap underneath (signal context — where coverage is weak)
//   2. Walls drawn prominently with "danger zone" glow (walls = #1 error source)
//   3. LOO k-NN error vectors: actual → predicted position
//   4. Wall-crossing markers when an error vector crosses a barrier
// Tells you whether per-room correction is needed or if Gaussian + adjacency
// is already good enough.

/**
 * Generate enhanced distortion map SVG.
 * @param {Array} calPoints - calibration points from calibrationGet()
 * @param {string} mapId - which map to render
 * @param {Array} barriers - RF barriers [{points, attenuation_dbm, material}]
 * @param {Array} receivers - map receivers (for radio map underlay)
 * @returns {string} SVG string (viewBox 0 0 1 1)
 */
export function distortionMapSVG(calPoints, mapId, barriers, receivers) {
  const mapPts = (calPoints || []).filter(p => p.map_id === mapId);
  if (mapPts.length < KNN_K + 1) return "";

  const vectors = [];
  let maxErr = 0;

  for (let i = 0; i < mapPts.length; i++) {
    const pt = mapPts[i];
    const query = {};
    for (const r of (pt.scanner_readings || [])) {
      if (r.source && r.mean_rssi != null) query[r.source] = r.mean_rssi;
    }
    if (!Object.keys(query).length) continue;

    const scored = [];
    for (let j = 0; j < mapPts.length; j++) {
      if (j === i) continue;
      const p2 = mapPts[j];
      const fp = {};
      for (const r of (p2.scanner_readings || [])) {
        if (r.source && r.mean_rssi != null) fp[r.source] = r.mean_rssi;
      }
      const shared = Object.keys(query).filter(s => fp[s] != null);
      if (!shared.length) continue;
      let distSq = 0;
      for (const s of shared) distSq += (query[s] - fp[s]) ** 2;
      // Penalty 1: missing scanners — query sees scanners that the candidate doesn't
      const missingPenalty = 1.0 + 0.3 * Math.max(0, Object.keys(query).length - shared.length);
      // Penalty 2: low scanner diversity — with only 1-2 shared scanners the RSSI
      // distance is unreliable (one scanner can't distinguish spatial positions).
      // Scale distSq DOWN (make candidates look more similar = larger error vectors)
      // so sparse areas don't appear artificially well-covered.
      const diversityPenalty = shared.length >= 3 ? 1.0 : shared.length === 2 ? 0.5 : 0.15;
      scored.push({ distSq: distSq * missingPenalty * diversityPenalty, p: p2, sharedCount: shared.length });
    }

    if (scored.length < KNN_K) continue;
    scored.sort((a, b) => a.distSq - b.distSq);
    const topK = scored.slice(0, KNN_K);

    let wTotal = 0, wx = 0, wy = 0;
    for (const { distSq, p } of topK) {
      const w = 1.0 / (Math.sqrt(distSq) + 0.001);
      wx += w * p.x_frac;
      wy += w * p.y_frac;
      wTotal += w;
    }
    if (wTotal < 1e-10) continue;

    const predX = wx / wTotal;
    const predY = wy / wTotal;
    const errFrac = Math.sqrt((predX - pt.x_frac) ** 2 + (predY - pt.y_frac) ** 2);
    maxErr = Math.max(maxErr, errFrac);

    // Check if the error vector crosses any barrier
    const wallsCrossed = _barrierAttenuation(pt.x_frac, pt.y_frac, predX, predY, barriers || []);

    // Track scanner diversity: how many unique scanners the top-K neighbors shared
    const avgShared = topK.reduce((a, t) => a + (t.sharedCount || 0), 0) / topK.length;
    const scannerCount = Object.keys(query).length;
    const lowConfidence = scannerCount < 2 || avgShared < 2;

    vectors.push({
      actualX: pt.x_frac, actualY: pt.y_frac,
      predX, predY,
      errFrac,
      room: pt.room || "",
      wallsCrossed: wallsCrossed > 0,
      wallDb: wallsCrossed,
      lowConfidence,
      scannerCount,
    });
  }

  if (!vectors.length) return "";

  let s = "";

  // ── Layer 1: Radio map heatmap underneath (signal context) ──────────────
  const rmSvg = radioMapSVG(calPoints, mapId, null, receivers || [], barriers || []);
  if (rmSvg) s += rmSvg;

  // ── Layer 2: Walls with danger zone glow ────────────────────────────────
  // Walls are the primary source of positioning error. Draw them prominently
  // with a glowing red halo to mark "danger zones" where errors concentrate.
  const mapBarriers = barriers || [];
  const matColors = { metal: "#ff4444", concrete: "#ff6633", brick: "#ff8844", custom: "#ff6666" };
  for (const bar of mapBarriers) {
    const pts = bar.points || [];
    if (pts.length < 2) continue;
    const color = matColors[bar.material] || matColors.custom;
    const atten = bar.attenuation_dbm ?? 6;
    const sw = Math.max(0.005, Math.min(0.012, atten * 0.001));
    const d = pts.map((p, i) => `${i === 0 ? "M" : "L"}${p[0].toFixed(4)},${p[1].toFixed(4)}`).join(" ");
    // Glow layer (wider, semi-transparent)
    s += `<path d="${d}" fill="none" stroke="${color}" stroke-width="${(sw * 4).toFixed(4)}" stroke-linecap="round" stroke-linejoin="round" opacity="0.12"/>`;
    s += `<path d="${d}" fill="none" stroke="${color}" stroke-width="${(sw * 2).toFixed(4)}" stroke-linecap="round" stroke-linejoin="round" opacity="0.25"/>`;
    // Solid wall line
    s += `<path d="${d}" fill="none" stroke="${color}" stroke-width="${sw.toFixed(4)}" stroke-linecap="round" stroke-linejoin="round" opacity="0.9"/>`;
    // Attenuation label at midpoint
    if (pts.length >= 2) {
      const mx = (Number(pts[0][0]) + Number(pts[pts.length-1][0])) / 2;
      const my = (Number(pts[0][1]) + Number(pts[pts.length-1][1])) / 2;
      s += `<text x="${mx.toFixed(4)}" y="${(my - 0.012).toFixed(4)}" text-anchor="middle" fill="${color}" font-size="0.012" font-family="system-ui,sans-serif" font-weight="600" opacity="0.8">${atten}dB</text>`;
    }
  }

  // ── Layer 3: Error vectors (actual → predicted) ─────────────────────────
  let wallCrossCount = 0;
  for (const v of vectors) {
    const color = _errorColor(v.errFrac);
    const opacity = Math.max(0.5, Math.min(1.0, v.errFrac / 0.12));
    const sw = Math.max(0.003, Math.min(0.008, v.errFrac * 0.05));

    if (v.errFrac > 0.005) {
      // Arrow line — dashed if it crosses a wall
      const dashAttr = v.wallsCrossed ? ` stroke-dasharray="0.008,0.004"` : "";
      s += `<line x1="${v.actualX.toFixed(4)}" y1="${v.actualY.toFixed(4)}" x2="${v.predX.toFixed(4)}" y2="${v.predY.toFixed(4)}" stroke="${color}" stroke-width="${sw.toFixed(4)}"${dashAttr} opacity="${opacity.toFixed(2)}"/>`;

      // Arrowhead
      const dx = v.predX - v.actualX, dy = v.predY - v.actualY;
      const len = Math.sqrt(dx * dx + dy * dy);
      if (len > 0.01) {
        const ux = dx / len, uy = dy / len;
        const headLen = Math.min(0.015, len * 0.4);
        const headW = headLen * 0.6;
        const tipX = v.predX, tipY = v.predY;
        const baseX = tipX - ux * headLen, baseY = tipY - uy * headLen;
        const lx = baseX - uy * headW, ly = baseY + ux * headW;
        const rx = baseX + uy * headW, ry = baseY - ux * headW;
        s += `<polygon points="${tipX.toFixed(4)},${tipY.toFixed(4)} ${lx.toFixed(4)},${ly.toFixed(4)} ${rx.toFixed(4)},${ry.toFixed(4)}" fill="${color}" opacity="${opacity.toFixed(2)}"/>`;
      }

      // Wall-crossing marker: small X where vector intersects a wall
      if (v.wallsCrossed) {
        wallCrossCount++;
        const midX = (v.actualX + v.predX) / 2, midY = (v.actualY + v.predY) / 2;
        const cr = 0.006;
        s += `<line x1="${(midX-cr).toFixed(4)}" y1="${(midY-cr).toFixed(4)}" x2="${(midX+cr).toFixed(4)}" y2="${(midY+cr).toFixed(4)}" stroke="#ff4444" stroke-width="0.003" opacity="0.9"/>`;
        s += `<line x1="${(midX+cr).toFixed(4)}" y1="${(midY-cr).toFixed(4)}" x2="${(midX-cr).toFixed(4)}" y2="${(midY+cr).toFixed(4)}" stroke="#ff4444" stroke-width="0.003" opacity="0.9"/>`;
      }
    }

    // Dot at actual position — outlined with wall-crossing color if applicable
    const dotStroke = v.wallsCrossed ? "#ff4444" : "#071008";
    const dotSW = v.wallsCrossed ? "0.003" : "0.002";
    s += `<circle cx="${v.actualX.toFixed(4)}" cy="${v.actualY.toFixed(4)}" r="0.007" fill="${color}" stroke="${dotStroke}" stroke-width="${dotSW}" opacity="0.9"/>`;

    // Low-confidence marker: dashed ring around points with < 2 scanners.
    // These points have unreliable k-NN predictions because a single scanner
    // can't distinguish spatial positions — the error looks low but is meaningless.
    if (v.lowConfidence) {
      s += `<circle cx="${v.actualX.toFixed(4)}" cy="${v.actualY.toFixed(4)}" r="0.014" fill="none" stroke="#f59e0b" stroke-width="0.002" stroke-dasharray="0.004,0.004" opacity="0.8"/>`;
    }
  }

  // ── Layer 4: Summary stats & legend ─────────────────────────────────────
  const lowConfCount = vectors.filter(v => v.lowConfidence).length;
  // Only include high-confidence points in error stats so sparse areas
  // don't drag the average down with misleadingly low "error" values.
  const hcVectors = vectors.filter(v => !v.lowConfidence);
  const meanErr = hcVectors.length ? hcVectors.reduce((a, v) => a + v.errFrac, 0) / hcVectors.length : 0;
  const meanErrM = (meanErr * 15).toFixed(1);
  const maxErrM = (maxErr * 15).toFixed(1);

  const ly = 0.84;
  const boxH = lowConfCount ? 0.17 : 0.15;
  s += `<rect x="0.58" y="${ly - 0.01}" width="0.40" height="${boxH}" rx="0.008" fill="rgba(7,16,8,0.9)"/>`;
  s += `<text x="0.60" y="${ly + 0.012}" fill="#e2e8f0" font-size="0.018" font-weight="700" font-family="system-ui,sans-serif">Distortion Map</text>`;
  s += `<text x="0.60" y="${ly + 0.032}" fill="#94a3b8" font-size="0.014" font-family="system-ui,sans-serif">Mean: ${meanErrM}m (${(meanErr * 100).toFixed(1)}%) \u2022 Max: ${maxErrM}m</text>`;
  s += `<text x="0.60" y="${ly + 0.050}" fill="#94a3b8" font-size="0.013" font-family="system-ui,sans-serif">${vectors.length} points \u2022 ${wallCrossCount} cross wall${wallCrossCount !== 1 ? "s" : ""}</text>`;
  if (lowConfCount) {
    s += `<text x="0.60" y="${ly + 0.066}" fill="#f59e0b" font-size="0.012" font-family="system-ui,sans-serif">\u26A0 ${lowConfCount} point${lowConfCount !== 1 ? "s" : ""} low confidence (&lt;2 scanners)</text>`;
  }
  // Error color scale — shift down when low-confidence warning is shown
  const _lOff = lowConfCount ? 0.016 : 0;
  const scaleSteps = 5;
  const scaleW = 0.03;
  for (let i = 0; i < scaleSteps; i++) {
    const t = i / (scaleSteps - 1);
    s += `<rect x="${(0.60 + i * scaleW).toFixed(3)}" y="${(ly + 0.060 + _lOff).toFixed(4)}" width="${scaleW.toFixed(3)}" height="0.010" fill="${_errorColor(t * 0.25)}"/>`;
  }
  s += `<text x="0.60" y="${(ly + 0.085 + _lOff).toFixed(4)}" fill="#52b788" font-size="0.011" font-family="system-ui,sans-serif">0m</text>`;
  s += `<text x="${(0.60 + (scaleSteps-1) * scaleW).toFixed(3)}" y="${(ly + 0.085 + _lOff).toFixed(4)}" fill="#f87171" font-size="0.011" font-family="system-ui,sans-serif">\u22653.8m</text>`;
  // Wall legend
  if (mapBarriers.length) {
    s += `<line x1="0.60" y1="${(ly + 0.098 + _lOff).toFixed(4)}" x2="0.64" y2="${(ly + 0.098 + _lOff).toFixed(4)}" stroke="#ff4444" stroke-width="0.004" opacity="0.9"/>`;
    s += `<text x="0.65" y="${(ly + 0.101 + _lOff).toFixed(4)}" fill="#ff6666" font-size="0.011" font-family="system-ui,sans-serif">Wall (error source)</text>`;
    s += `<text x="0.60" y="${(ly + 0.118 + _lOff).toFixed(4)}" fill="#ff4444" font-size="0.010" font-family="system-ui,sans-serif">\u2716 = prediction crosses wall</text>`;
    s += `<line x1="0.60" y1="${(ly + 0.128 + _lOff).toFixed(4)}" x2="0.64" y2="${(ly + 0.128 + _lOff).toFixed(4)}" stroke="#fb923c" stroke-width="0.003" stroke-dasharray="0.008,0.004"/>`;
    s += `<text x="0.65" y="${(ly + 0.131 + _lOff).toFixed(4)}" fill="#94a3b8" font-size="0.010" font-family="system-ui,sans-serif">Dashed = wall-crossing vector</text>`;
  }
  // Low-confidence legend
  if (lowConfCount) {
    const lcY = ly + 0.098 + _lOff + (mapBarriers.length ? 0.042 : 0);
    s += `<circle cx="0.62" cy="${lcY.toFixed(4)}" r="0.006" fill="none" stroke="#f59e0b" stroke-width="0.002" stroke-dasharray="0.004,0.004"/>`;
    s += `<text x="0.65" y="${(lcY + 0.003).toFixed(4)}" fill="#f59e0b" font-size="0.010" font-family="system-ui,sans-serif">Low confidence (&lt;2 scanners)</text>`;
  }

  return s;
}


// ── Isometric Heatmap Generator ──────────────────────────────────────────────
// For 3D isometric views: generates heatmap polygons projected through the
// caller's mapPt + iso transform chain.

const ISO_GRID = 36; // 36x36 interpolation grid for 3D (1296 cells per map)

/**
 * Compute heatmap grid data for a map (not yet projected).
 * Returns {grid: Float32Array, minR, maxR, res} or null if no data.
 */
export function computeHeatmapGrid(calPoints, mapId, scannerSource, barriers) {
  const mapPts = (calPoints || []).filter(p => p.map_id === mapId);
  if (!mapPts.length) return null;

  const dataPoints = [];
  for (const pt of mapPts) {
    const readings = pt.scanner_readings || [];
    if (scannerSource) {
      const r = readings.find(rd => rd.source === scannerSource);
      if (r && r.mean_rssi != null) {
        dataPoints.push({ x_frac: pt.x_frac, y_frac: pt.y_frac, rssi: r.mean_rssi });
      }
    } else {
      const rssis = readings.map(r => r.mean_rssi).filter(v => v != null);
      if (rssis.length) {
        dataPoints.push({ x_frac: pt.x_frac, y_frac: pt.y_frac, rssi: Math.max(...rssis) });
      }
    }
  }
  if (!dataPoints.length) return null;

  const allRssi = dataPoints.map(p => p.rssi);
  const minR = Math.min(...allRssi);
  const maxR = Math.max(...allRssi);
  setHatchRange(minR, maxR, _userGain, _userContrast);
  const res = ISO_GRID;
  const cellW = 1.0 / res;
  const grid = new Float32Array(res * res);
  const mapBarriers = barriers || [];

  for (let gy = 0; gy < res; gy++) {
    for (let gx = 0; gx < res; gx++) {
      const qx = (gx + 0.5) * cellW;
      const qy = (gy + 0.5) * cellW;
      const rssi = _idw(qx, qy, dataPoints, mapBarriers);
      grid[gy * res + gx] = rssi != null ? rssi : NaN;
    }
  }

  return { grid, minR, maxR, res, dataPoints };
}

/**
 * Generate isometric heatmap SVG fragment for one map.
 * The caller provides mapPt (normalized → world) and iso (world → screen) functions.
 *
 * @param {Object} heatData - from computeHeatmapGrid()
 * @param {Function} mapPt - (x_frac, y_frac) → [wx, wy]
 * @param {Function} iso - (wx, wy, z) → [sx, sy]
 * @param {number} z - z-level for this map
 * @returns {string} SVG polygon elements
 */
/**
 * Generate <defs> block for 3D iso heatmap patterns. Call ONCE before
 * rendering any isoHeatmapSVG cells (not per-map).
 */
export function isoHatchDefs() {
  return hatchDefs("rmiso", 6, 2.5);
}

export function isoHeatmapSVG(heatData, mapPt, iso, z) {
  if (!heatData) return "";
  const { grid, minR, maxR, res } = heatData;
  const cellW = 1.0 / res;
  const _pfx = "rmiso";
  let s = "";

  // Slight overlap prevents hairline gaps between cells in iso projection
  const pad = cellW * 0.08;
  for (let gy = 0; gy < res; gy++) {
    for (let gx = 0; gx < res; gx++) {
      const rssi = grid[gy * res + gx];
      if (isNaN(rssi)) continue;

      const fill = _hatchFill(_pfx, rssi);
      // Project 4 corners of the grid cell (with slight padding) through the iso transform
      const x0 = gx * cellW - pad, y0 = gy * cellW - pad;
      const x1 = x0 + cellW + pad * 2, y1 = y0 + cellW + pad * 2;
      const [w0x, w0y] = mapPt(x0, y0);
      const [w1x, w1y] = mapPt(x1, y0);
      const [w2x, w2y] = mapPt(x1, y1);
      const [w3x, w3y] = mapPt(x0, y1);
      const p0 = iso(w0x, w0y, z);
      const p1 = iso(w1x, w1y, z);
      const p2 = iso(w2x, w2y, z);
      const p3 = iso(w3x, w3y, z);

      // Sub-pixel precision (1 decimal) prevents cells from collapsing to lines
      const f = v => v.toFixed(1);
      s += `<polygon points="${f(p0[0])},${f(p0[1])} ${f(p1[0])},${f(p1[1])} ${f(p2[0])},${f(p2[1])} ${f(p3[0])},${f(p3[1])}" fill="${fill}"/>`;
    }
  }

  // Calibration point markers projected to iso
  for (const dp of heatData.dataPoints) {
    const [wx, wy] = mapPt(dp.x_frac, dp.y_frac);
    const [sx, sy] = iso(wx, wy, z);
    s += `<circle cx="${Math.round(sx)}" cy="${Math.round(sy)}" r="3" fill="#e2e8f0" stroke="#071008" stroke-width="0.8" opacity="0.7"/>`;
  }

  return s;
}

/**
 * Unified world-space iso heatmap for a z-level group (multiple maps merged).
 * Merges calibration data from all maps on the level, interpolates in world
 * space, projects through iso. One heatmap per level, not per map.
 *
 * @param {Array} calPoints - ALL calibration points
 * @param {Array} groupMaps - maps on this z-level [{id, rf_barriers, ...}]
 * @param {Object} mapTransforms - {mapId: {z, mapPt}} transform per map
 * @param {Function} iso - (wx, wy, z) → [sx, sy]
 * @param {number} z - z-level
 * @returns {string} SVG polygon elements
 */
/**
 * Model-based 3D iso heatmap — scanner positions + path-loss physics.
 */
export function modelIsoHeatmapSVG(groupMaps, mapTransforms, iso, z, settings, allMaps, liveSnap) {
  if (!groupMaps.length) return "";

  const refPower = settings?.ref_power ?? DEFAULT_REF_POWER;
  const pathLossN = settings?.path_loss_exp ?? DEFAULT_PATH_LOSS_N;
  const _mapZ = {};
  for (const [mid, tf] of Object.entries(mapTransforms)) { if (tf) _mapZ[mid] = tf.z; }

  // Per-scanner quality from live data
  const scannerQuality = {};
  const _isoAds = (liveSnap?.ble?.advertisements) || [];
  if (_isoAds.length) {
    const _scBest = {};
    for (const ad of _isoAds) {
      if (!ad.source || ad.rssi == null || (ad.age_s||0) > 30) continue;
      if (!_scBest[ad.source] || ad.rssi > _scBest[ad.source]) _scBest[ad.source] = ad.rssi;
    }
    const _bv = Object.values(_scBest); _bv.sort((a,b)=>a-b);
    if (_bv.length > 1) {
      const _fm = _bv[Math.floor(_bv.length/2)];
      for (const [src,best] of Object.entries(_scBest)) scannerQuality[src] = Math.max(-10, Math.min(10, best - _fm));
    }
  }

  // Collect scanner world positions
  const scanners = [];
  for (const m of (allMaps || groupMaps)) {
    const tf = mapTransforms[m.id]; if (!tf || !tf.mapPt) continue;
    const mZ = tf.z;
    const floorDist = Math.abs(mZ - z);
    if (floorDist > 2) continue;
    for (const r of (m.receivers || [])) {
      if (r.x == null || r.y == null) continue;
      const [wx, wy] = tf.mapPt(r.x, r.y);
      const src = r.source || r.id || "";
      scanners.push({ wx, wy, floorDist, qualityOffset: scannerQuality[src] || 0 });
    }
  }
  if (!scanners.length) return "";

  // Collect barriers
  const worldBarriers = [];
  for (const m of groupMaps) {
    const tf = mapTransforms[m.id]; if (!tf || !tf.mapPt) continue;
    for (const bar of (m.rf_barriers || [])) {
      const pts = bar.points || [];
      if (pts.length < 2) continue;
      worldBarriers.push({
        points: pts.map(p => { const [wx, wy] = tf.mapPt(Number(p[0]), Number(p[1])); return [wx, wy]; }),
        attenuation_dbm: bar.attenuation_dbm ?? 6,
      });
    }
  }

  // Room bounds in world coords for adaptive data lookup — fabric-first
  const _isoRoomBoundsW = [];
  if (_sourceBlend > 0 && _adaptiveFingerprints) {
    const _fab = _fabricRoomPolysW(groupMaps);
    if (_fab) {
      _isoRoomBoundsW.push(..._fab);
    } else {
    for (const m of groupMaps) {
      const tf = mapTransforms[m.id]; if (!tf || !tf.mapPt) continue;
      for (const [room, b] of Object.entries(m.room_bounds || {})) {
        if (!b || b.type !== "poly" || !b.points || b.points.length < 3) continue;
        _isoRoomBoundsW.push({ room, polyW: b.points.map(p => tf.mapPt(Number(p[0]), Number(p[1]))) });
      }
    }
    }
  }

  // World bounding box
  let bb = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  for (const m of groupMaps) {
    const tf = mapTransforms[m.id]; if (!tf || !tf.mapPt) continue;
    for (const [cx, cy] of [[0,0],[1,0],[1,1],[0,1]]) {
      const [wx, wy] = tf.mapPt(cx, cy);
      bb.minX = Math.min(bb.minX, wx); bb.minY = Math.min(bb.minY, wy);
      bb.maxX = Math.max(bb.maxX, wx); bb.maxY = Math.max(bb.maxY, wy);
    }
  }
  if (!isFinite(bb.minX)) return "";
  const wW = bb.maxX - bb.minX, wH = bb.maxY - bb.minY;
  if (wW < 1e-6 || wH < 1e-6) return "";

  const res = ISO_GRID;
  const cellW = wW / res, cellH = wH / res;
  const f = v => v.toFixed(1);

  // Compute grid
  let minR = 0, maxR = -120;
  const gridRssi = new Float32Array(res * res);
  for (let gy = 0; gy < res; gy++) {
    for (let gx = 0; gx < res; gx++) {
      const qwx = bb.minX + (gx + 0.5) * cellW;
      const qwy = bb.minY + (gy + 0.5) * cellH;
      let best = -120;
      for (const sc of scanners) {
        const dx = qwx - sc.wx, dy = qwy - sc.wy;
        const distM = Math.max(0.3, Math.sqrt(dx*dx + dy*dy) * MAP_SCALE_M);
        let rssi = (refPower + (sc.qualityOffset || 0)) - 10 * pathLossN * Math.log10(distM);
        if (sc.floorDist > 0) rssi -= sc.floorDist * FLOOR_ATTEN_DB;
        for (const bar of worldBarriers) {
          const bpts = bar.points;
          for (let i = 0; i < bpts.length - 1; i++) {
            if (_segmentsIntersect(qwx, qwy, sc.wx, sc.wy, bpts[i][0], bpts[i][1], bpts[i+1][0], bpts[i+1][1])) {
              rssi -= (bar.attenuation_dbm ?? 6);
            }
          }
        }
        if (rssi > best) best = rssi;
      }
      // Blend model + adaptive
      let finalRssi = best;
      if (_sourceBlend > 0 && _adaptiveFingerprints && _isoRoomBoundsW.length) {
        const aOff = _adaptiveOffset(qwx, qwy, _isoRoomBoundsW);
        if (aOff != null) finalRssi = best + aOff * (_sourceBlend / 100);
      }
      gridRssi[gy * res + gx] = finalRssi;
      if (finalRssi > maxR) maxR = finalRssi;
      if (finalRssi < minR) minR = finalRssi;
    }
  }

  setHatchRange(minR, maxR, _userGain, _userContrast);
  const _pfx = "rmiso";
  let s = "";

  const pad = cellW * 0.08;
  for (let gy = 0; gy < res; gy++) {
    for (let gx = 0; gx < res; gx++) {
      const rssi = gridRssi[gy * res + gx];
      const fill = _hatchFill(_pfx, rssi);
      const x0 = bb.minX + gx * cellW - pad, y0 = bb.minY + gy * cellH - pad;
      const x1 = x0 + cellW + pad*2, y1 = y0 + cellH + pad*2;
      const p0 = iso(x0, y0, z), p1 = iso(x1, y0, z), p2 = iso(x1, y1, z), p3 = iso(x0, y1, z);
      s += `<polygon points="${f(p0[0])},${f(p0[1])} ${f(p1[0])},${f(p1[1])} ${f(p2[0])},${f(p2[1])} ${f(p3[0])},${f(p3[1])}" fill="${fill}"/>`;
    }
  }

  // Scanner markers
  for (const sc of scanners.filter(sc => sc.floorDist === 0)) {
    const [sx, sy] = iso(sc.wx, sc.wy, z);
    s += `<circle cx="${f(sx)}" cy="${f(sy)}" r="4" fill="#52b788" stroke="#071008" stroke-width="1" opacity="0.9"/>`;
  }

  return s;
}

// Legacy calibration-based heatmap
export function isoLevelHeatmapSVG(calPoints, groupMaps, mapTransforms, iso, z) {
  if (!calPoints || !groupMaps.length) return "";

  const groupIds = new Set(groupMaps.map(m => m.id));
  const _pfx = "rmiso";

  // Build z-level lookup for all maps (to find adjacent floors)
  const _mapZ = {};
  for (const [mid, tf] of Object.entries(mapTransforms)) { if (tf) _mapZ[mid] = tf.z; }

  // 1. Collect cal points from this level AND adjacent levels → world coords
  // Adjacent-floor points get an attenuation penalty per floor of separation.
  const worldPoints = [];
  for (const pt of calPoints) {
    const tf = mapTransforms[pt.map_id];
    if (!tf || !tf.mapPt) continue;
    const ptZ = tf.z;
    const floorDist = Math.abs(ptZ - z);
    if (floorDist > 2) continue; // skip floors more than 2 levels away
    const readings = pt.scanner_readings || [];
    const rssis = readings.map(r => r.mean_rssi).filter(v => v != null);
    if (!rssis.length) continue;
    let bestRssi = Math.max(...rssis);
    if (floorDist > 0) bestRssi -= floorDist * FLOOR_ATTEN_DB;
    const [wx, wy] = tf.mapPt(pt.x_frac, pt.y_frac);
    worldPoints.push({ wx, wy, rssi: bestRssi });
  }
  if (!worldPoints.length) return "";

  // Data-adaptive color range
  const _wpRssis = worldPoints.map(p => p.rssi);
  setHatchRange(Math.min(..._wpRssis), Math.max(..._wpRssis), _userGain, _userContrast);

  // 2. Collect barriers from all maps → world coords
  const worldBarriers = [];
  for (const m of groupMaps) {
    const tf = mapTransforms[m.id];
    if (!tf || !tf.mapPt) continue;
    for (const bar of (m.rf_barriers || [])) {
      const pts = bar.points || [];
      if (pts.length < 2) continue;
      worldBarriers.push({
        points: pts.map(p => { const [wx, wy] = tf.mapPt(Number(p[0]), Number(p[1])); return [wx, wy]; }),
        attenuation_dbm: bar.attenuation_dbm ?? 6,
      });
    }
  }

  // 3. World bounding box from all maps on this level
  let bb = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  for (const m of groupMaps) {
    const tf = mapTransforms[m.id];
    if (!tf || !tf.mapPt) continue;
    for (const [cx, cy] of [[0,0],[1,0],[1,1],[0,1]]) {
      const [wx, wy] = tf.mapPt(cx, cy);
      bb.minX = Math.min(bb.minX, wx); bb.minY = Math.min(bb.minY, wy);
      bb.maxX = Math.max(bb.maxX, wx); bb.maxY = Math.max(bb.maxY, wy);
    }
  }
  if (!isFinite(bb.minX)) return "";
  const wW = bb.maxX - bb.minX, wH = bb.maxY - bb.minY;
  if (wW < 1e-6 || wH < 1e-6) return "";

  // 4. IDW grid in world space
  const res = ISO_GRID;
  const cellW = wW / res, cellH = wH / res;
  const idwPts = worldPoints.map(p => ({ x_frac: p.wx, y_frac: p.wy, rssi: p.rssi }));
  const f = v => v.toFixed(1);
  let s = "";

  for (let gy = 0; gy < res; gy++) {
    for (let gx = 0; gx < res; gx++) {
      const qwx = bb.minX + (gx + 0.5) * cellW;
      const qwy = bb.minY + (gy + 0.5) * cellH;
      const rssi = _idw(qwx, qwy, idwPts, worldBarriers);
      const fill = _hatchFill(_pfx, rssi);

      // Cell corners: world → iso screen
      const c00 = iso(bb.minX + gx * cellW, bb.minY + gy * cellH, z);
      const c10 = iso(bb.minX + (gx+1) * cellW, bb.minY + gy * cellH, z);
      const c11 = iso(bb.minX + (gx+1) * cellW, bb.minY + (gy+1) * cellH, z);
      const c01 = iso(bb.minX + gx * cellW, bb.minY + (gy+1) * cellH, z);

      s += `<polygon points="${f(c00[0])},${f(c00[1])} ${f(c10[0])},${f(c10[1])} ${f(c11[0])},${f(c11[1])} ${f(c01[0])},${f(c01[1])}" fill="${fill}"/>`;
    }
  }

  // 5. Cal point markers
  for (const wp of worldPoints) {
    const [sx, sy] = iso(wp.wx, wp.wy, z);
    s += `<circle cx="${Math.round(sx)}" cy="${Math.round(sy)}" r="3" fill="#e2e8f0" stroke="#071008" stroke-width="0.8" opacity="0.7"/>`;
  }

  return s;
}


// ═══════════════════════════════════════════════════════════════════════════════
// World-Space Floor Heatmap
// ═══════════════════════════════════════════════════════════════════════════════
// Merges calibration data from ALL maps on a floor into a single unified
// interpolation in world coordinates. No per-map isolation — a calibration
// point on Map A contributes to the heatmap in Map B's territory if they
// share the same floor. Barriers from all maps are also combined.

const FLOOR_GRID = 42; // 42x42 grid in world space

/**
 * Generate a unified floor heatmap in view-normalized coordinates.
 *
 * @param {Array} calPoints - ALL calibration points from calibrationGet()
 * @param {Array} floorMaps - maps on this floor [{id, rf_barriers, ...}]
 * @param {Object} mapPtFns - {mapId: (lx,ly)=>[wx,wy]} transform per map
 * @param {Function} w2v - (wx,wy)=>[vx,vy] world→view transform
 * @param {Object} wBB - {minX,minY,maxX,maxY} world bounding box
 * @param {string|null} scannerSource - specific scanner or null for combined
 * @returns {string} SVG content (rects + markers in view coords)
 */
/**
 * Model-based RF heatmap — uses scanner positions + path-loss physics.
 * No calibration data needed. Shows predicted signal coverage from known
 * scanner locations, attenuated by walls.
 */
export function modelFloorHeatmapSVG(floorMaps, mapPtFns, w2v, wBB, settings, allMaps, liveSnap) {
  if (!floorMaps.length) return "";

  const refPower = settings?.ref_power ?? DEFAULT_REF_POWER;
  const pathLossN = settings?.path_loss_exp ?? DEFAULT_PATH_LOSS_N;
  const _floorZ = (floorMaps[0].stack?.z_level) ?? 0;
  const _allMapZ = {};
  for (const m of (allMaps || floorMaps)) { _allMapZ[m.id] = (m.stack?.z_level) ?? 0; }

  // ── Per-scanner quality factor from live advertisement data ──
  // Computes effective ref_power per scanner based on actual observed signal strength.
  // Good scanners (strong antenna, good placement) get higher effective power.
  const scannerQuality = {}; // source → quality offset in dB
  const ads = (liveSnap?.ble?.advertisements) || [];
  if (ads.length) {
    const scannerBestRssi = {}; // source → best RSSI seen from any device
    const scannerDevCount = {}; // source → device count
    for (const ad of ads) {
      if (!ad.source || ad.rssi == null || (ad.age_s || 0) > 30) continue;
      if (!scannerBestRssi[ad.source] || ad.rssi > scannerBestRssi[ad.source]) {
        scannerBestRssi[ad.source] = ad.rssi;
      }
      scannerDevCount[ad.source] = (scannerDevCount[ad.source] || 0) + 1;
    }
    // Fleet best (median of per-scanner bests)
    const bestVals = Object.values(scannerBestRssi);
    if (bestVals.length > 1) {
      bestVals.sort((a, b) => a - b);
      const fleetMedianBest = bestVals[Math.floor(bestVals.length / 2)];
      for (const [src, best] of Object.entries(scannerBestRssi)) {
        // Quality offset: how much better/worse than fleet median
        // Capped at ±10 dB to prevent extreme distortion
        scannerQuality[src] = Math.max(-10, Math.min(10, best - fleetMedianBest));
      }
    }
  }

  // Collect scanner world positions from all floor maps + adjacent floors
  const scanners = [];
  for (const m of (allMaps || floorMaps)) {
    const mpt = mapPtFns[m.id]; if (!mpt) continue;
    const mZ = _allMapZ[m.id] ?? 0;
    const floorDist = Math.abs(mZ - _floorZ);
    if (floorDist > 2) continue;
    for (const r of (m.receivers || [])) {
      if (r.x == null || r.y == null) continue;
      const [wx, wy] = mpt(r.x, r.y);
      const src = r.source || r.id || "";
      const qOff = scannerQuality[src] || 0;
      scanners.push({ wx, wy, source: src, floorDist, qualityOffset: qOff });
    }
  }
  if (!scanners.length) return "";

  // Collect barriers from all floor maps → world coords
  const worldBarriers = [];
  for (const m of (allMaps || floorMaps)) {
    const mpt = mapPtFns[m.id]; if (!mpt) continue;
    const mZ = _allMapZ[m.id] ?? 0;
    if (Math.abs(mZ - _floorZ) > 1) continue;
    for (const bar of (m.rf_barriers || [])) {
      const pts = bar.points || [];
      if (pts.length < 2) continue;
      worldBarriers.push({
        points: pts.map(p => { const [wx, wy] = mpt(Number(p[0]), Number(p[1])); return [wx, wy]; }),
        attenuation_dbm: bar.attenuation_dbm ?? 6,
      });
    }
  }

  // Build room boundary polygons in world coords (for adaptive data lookup)
  // — fabric-first, per-photo bounds as fallback
  const roomBoundsWorld = [];
  if (_sourceBlend > 0 && _adaptiveFingerprints) {
    const _fab = _fabricRoomPolysW(floorMaps);
    if (_fab) {
      roomBoundsWorld.push(..._fab);
    } else {
    for (const m of floorMaps) {
      const mpt = mapPtFns[m.id]; if (!mpt) continue;
      for (const [room, b] of Object.entries(m.room_bounds || {})) {
        if (!b || b.type !== "poly" || !Array.isArray(b.points) || b.points.length < 3) continue;
        const polyW = b.points.map(p => mpt(Number(p[0]), Number(p[1])));
        roomBoundsWorld.push({ room, polyW });
      }
    }
    }
  }

  const wW = wBB.maxX - wBB.minX, wH = wBB.maxY - wBB.minY;
  if (wW < 1e-6 || wH < 1e-6) return "";

  const blend = _sourceBlend / 100; // 0 = model only, 1 = adaptive only
  let minR = 0, maxR = -120;
  const res = FLOOR_GRID;
  const cellW = wW / res, cellH = wH / res;
  const gridRssi = new Float32Array(res * res);
  for (let gy = 0; gy < res; gy++) {
    for (let gx = 0; gx < res; gx++) {
      const qwx = wBB.minX + (gx + 0.5) * cellW;
      const qwy = wBB.minY + (gy + 0.5) * cellH;
      // Adjust scanners on other floors with attenuation
      let best = -120;
      for (const sc of scanners) {
        const dx = qwx - sc.wx, dy = qwy - sc.wy;
        const distNorm = Math.sqrt(dx * dx + dy * dy);
        const distM = Math.max(0.3, distNorm * MAP_SCALE_M);
        // Per-scanner effective power: base ref_power + quality offset from live data
        let rssi = (refPower + (sc.qualityOffset || 0)) - 10 * pathLossN * Math.log10(distM);
        if (sc.floorDist > 0) rssi -= sc.floorDist * FLOOR_ATTEN_DB;
        // Barrier attenuation
        for (const bar of worldBarriers) {
          const bpts = bar.points;
          for (let i = 0; i < bpts.length - 1; i++) {
            if (_segmentsIntersect(qwx, qwy, sc.wx, sc.wy, bpts[i][0], bpts[i][1], bpts[i+1][0], bpts[i+1][1])) {
              rssi -= (bar.attenuation_dbm ?? 6);
            }
          }
        }
        if (rssi > best) best = rssi;
      }
      // Blend model + adaptive data
      let finalRssi = best;
      if (blend > 0 && roomBoundsWorld.length) {
        const aOff = _adaptiveOffset(qwx, qwy, roomBoundsWorld);
        if (aOff != null) finalRssi = best + aOff * blend;
      }
      gridRssi[gy * res + gx] = finalRssi;
      if (finalRssi > maxR) maxR = finalRssi;
      if (finalRssi < minR) minR = finalRssi;
    }
  }

  setHatchRange(minR, maxR, _userGain, _userContrast);

  const _pfx = "rmfl";
  const f = v => v.toFixed(5);
  let s = hatchDefs(_pfx, 0.008, 0.003);

  for (let gy = 0; gy < res; gy++) {
    for (let gx = 0; gx < res; gx++) {
      const rssi = gridRssi[gy * res + gx];
      const fill = _hatchFill(_pfx, rssi);
      const [v0x, v0y] = w2v(wBB.minX + gx * cellW, wBB.minY + gy * cellH);
      const [v1x, v1y] = w2v(wBB.minX + (gx+1) * cellW, wBB.minY + gy * cellH);
      const [v2x, v2y] = w2v(wBB.minX + (gx+1) * cellW, wBB.minY + (gy+1) * cellH);
      const [v3x, v3y] = w2v(wBB.minX + gx * cellW, wBB.minY + (gy+1) * cellH);
      s += `<polygon points="${f(v0x)},${f(v0y)} ${f(v1x)},${f(v1y)} ${f(v2x)},${f(v2y)} ${f(v3x)},${f(v3y)}" fill="${fill}"/>`;
    }
  }

  // Barrier lines — open/loft barriers render thin + dotted (no wall);
  // solid walls render thicker in proportion to their dB attenuation.
  const matColors = { metal: "#f87171", concrete: "#fb923c", brick: "#fbbf24", custom: "#94a3b8", open: "#38bdf8" };
  for (const bar of worldBarriers) {
    const color = matColors[bar.material] || matColors.custom;
    const d = bar.points.map((p, i) => { const [vx, vy] = w2v(p[0], p[1]); return `${i === 0 ? "M" : "L"}${f(vx)},${f(vy)}`; }).join(" ");
    if (bar.material === "open") {
      s += `<path d="${d}" fill="none" stroke="${color}" stroke-width="0.002" stroke-dasharray="0.004,0.008" opacity="0.5"/>`;
    } else {
      const sw = Math.max(0.003, Math.min(0.008, (bar.attenuation_dbm ?? 6) * 0.0006));
      s += `<path d="${d}" fill="none" stroke="${color}" stroke-width="${f(sw)}" stroke-dasharray="0.012,0.006" opacity="0.7"/>`;
    }
  }

  // Scanner position markers
  for (const sc of scanners.filter(sc => sc.floorDist === 0)) {
    const [vx, vy] = w2v(sc.wx, sc.wy);
    s += `<circle cx="${f(vx)}" cy="${f(vy)}" r="0.010" fill="#52b788" stroke="#071008" stroke-width="0.002" opacity="0.9"/>`;
  }

  // Legend
  const ly = 0.92;
  s += `<rect x="0.02" y="${ly - 0.01}" width="0.34" height="0.07" rx="0.006" fill="rgba(7,16,8,0.85)"/>`;
  s += `<text x="0.035" y="${ly + 0.008}" fill="#e2e8f0" font-size="0.014" font-weight="600" font-family="system-ui,sans-serif">Model RF Coverage</text>`;
  const flLegSteps = 8;
  const bw = 0.028;
  for (let i = 0; i < flLegSteps; i++) {
    const bucketIdx = Math.round(i / (flLegSteps - 1) * (HATCH_BUCKETS - 1));
    s += `<rect x="${(0.035 + i * bw).toFixed(3)}" y="${ly + 0.02}" width="${bw.toFixed(3)}" height="0.012" fill="${_bucketRGB(bucketIdx)}"/>`;
  }
  s += `<text x="0.035" y="${ly + 0.048}" fill="#fca5a5" font-size="0.01" font-family="system-ui,sans-serif">${Math.round(minR)}</text>`;
  s += `<text x="${(0.035 + (flLegSteps - 1) * bw).toFixed(3)}" y="${ly + 0.048}" fill="#52b788" font-size="0.01" font-family="system-ui,sans-serif">${Math.round(maxR)} dBm</text>`;
  s += `<text x="0.035" y="${ly + 0.058}" fill="#94a3b8" font-size="0.009" font-family="system-ui,sans-serif">${scanners.filter(sc=>sc.floorDist===0).length} scanners \u2022 path-loss n=${pathLossN}</text>`;

  return s;
}

// Legacy calibration-based heatmap (kept as fallback)
export function floorHeatmapSVG(calPoints, floorMaps, mapPtFns, w2v, wBB, scannerSource, allMaps) {
  if (!calPoints || !floorMaps.length) return "";

  const floorMapIds = new Set(floorMaps.map(m => m.id));
  // Determine this floor's z-level
  const _floorZ = (floorMaps[0].stack?.z_level) ?? 0;
  // Build map → z-level lookup from all maps (for cross-floor bleed)
  const _allMapZ = {};
  for (const m of (allMaps || floorMaps)) { _allMapZ[m.id] = (m.stack?.z_level) ?? 0; }

  // ── 1. Collect calibration points from this floor AND adjacent floors ──
  const worldPoints = [];
  for (const pt of calPoints) {
    const mpt = mapPtFns[pt.map_id];
    if (!mpt) continue;
    const ptZ = _allMapZ[pt.map_id];
    if (ptZ == null) continue;
    const floorDist = Math.abs(ptZ - _floorZ);
    if (floorDist > 2) continue; // skip floors more than 2 levels away

    const readings = pt.scanner_readings || [];
    let rssi;
    if (scannerSource) {
      const r = readings.find(rd => rd.source === scannerSource);
      if (!r || r.mean_rssi == null) continue;
      rssi = r.mean_rssi;
    } else {
      const rssis = readings.map(r => r.mean_rssi).filter(v => v != null);
      if (!rssis.length) continue;
      rssi = Math.max(...rssis);
    }
    // Attenuate cross-floor signal
    if (floorDist > 0) rssi -= floorDist * FLOOR_ATTEN_DB;

    const [wx, wy] = mpt(pt.x_frac, pt.y_frac);
    worldPoints.push({ wx, wy, rssi });
  }

  if (!worldPoints.length) return "";

  // Data-adaptive color range
  const _lvlRssis = worldPoints.map(p => p.rssi);
  setHatchRange(Math.min(..._lvlRssis), Math.max(..._lvlRssis), _userGain, _userContrast);

  // ── 2. Collect all barriers from all floor maps, transform to world coords ──
  const worldBarriers = [];
  for (const m of floorMaps) {
    const mpt = mapPtFns[m.id];
    if (!mpt) continue;
    for (const bar of (m.rf_barriers || [])) {
      const pts = bar.points || [];
      if (pts.length < 2) continue;
      worldBarriers.push({
        points: pts.map(p => { const [wx, wy] = mpt(Number(p[0]), Number(p[1])); return [wx, wy]; }),
        attenuation_dbm: bar.attenuation_dbm ?? 6,
        material: bar.material || "custom",
      });
    }
  }

  // ── 3. IDW interpolation in world space ────────────────────────────────────
  const wW = wBB.maxX - wBB.minX;
  const wH = wBB.maxY - wBB.minY;
  if (wW < 1e-6 || wH < 1e-6) return "";

  // Convert world points to IDW-compatible format (use world coords directly)
  const idwPoints = worldPoints.map(p => ({ x_frac: p.wx, y_frac: p.wy, rssi: p.rssi }));

  const cellW = wW / FLOOR_GRID;
  const cellH = wH / FLOOR_GRID;
  const f = v => v.toFixed(5);
  const _pfx = "rmfl";
  let s = hatchDefs(_pfx, 0.008, 0.003);

  for (let gy = 0; gy < FLOOR_GRID; gy++) {
    for (let gx = 0; gx < FLOOR_GRID; gx++) {
      const qwx = wBB.minX + (gx + 0.5) * cellW;
      const qwy = wBB.minY + (gy + 0.5) * cellH;
      const rssi = _idw(qwx, qwy, idwPoints, worldBarriers);
      const fill = _hatchFill(_pfx, rssi);

      // Convert cell corners from world → view coords
      const [v0x, v0y] = w2v(wBB.minX + gx * cellW, wBB.minY + gy * cellH);
      const [v1x, v1y] = w2v(wBB.minX + (gx+1) * cellW, wBB.minY + gy * cellH);
      const [v2x, v2y] = w2v(wBB.minX + (gx+1) * cellW, wBB.minY + (gy+1) * cellH);
      const [v3x, v3y] = w2v(wBB.minX + gx * cellW, wBB.minY + (gy+1) * cellH);

      s += `<polygon points="${f(v0x)},${f(v0y)} ${f(v1x)},${f(v1y)} ${f(v2x)},${f(v2y)} ${f(v3x)},${f(v3y)}" fill="${fill}"/>`;
    }
  }

  // ── 4. Barrier lines in view coords ────────────────────────────────────────
  // Open/loft: thin dotted (no wall). Solid walls: thickness ∝ attenuation dB.
  const matColors = { metal: "#f87171", concrete: "#fb923c", brick: "#fbbf24", custom: "#94a3b8", open: "#38bdf8" };
  for (const bar of worldBarriers) {
    const color = matColors[bar.material] || matColors.custom;
    const d = bar.points.map((p, i) => {
      const [vx, vy] = w2v(p[0], p[1]);
      return `${i === 0 ? "M" : "L"}${f(vx)},${f(vy)}`;
    }).join(" ");
    if (bar.material === "open") {
      s += `<path d="${d}" fill="none" stroke="${color}" stroke-width="0.002" stroke-dasharray="0.004,0.008" opacity="0.5"/>`;
    } else {
      const sw = Math.max(0.003, Math.min(0.008, (bar.attenuation_dbm ?? 6) * 0.0006));
      s += `<path d="${d}" fill="none" stroke="${color}" stroke-width="${f(sw)}" stroke-dasharray="0.012,0.006" opacity="0.7"/>`;
    }
  }

  // ── 5. Calibration point markers — colored + labeled for data verification ──
  for (const wp of worldPoints) {
    const [vx, vy] = w2v(wp.wx, wp.wy);
    const _wpB = _rssiBucket(wp.rssi);
    const _wpC = _wpB >= 0 ? _bucketRGB(_wpB) : "#e2e8f0";
    s += `<circle cx="${f(vx)}" cy="${f(vy)}" r="0.008" fill="${_wpC}" stroke="#071008" stroke-width="0.002" opacity="0.9"/>`;
    s += `<rect x="${f(vx + 0.008)}" y="${f(vy - 0.006)}" width="0.032" height="0.012" rx="0.002" fill="rgba(7,16,8,0.85)"/>`;
    s += `<text x="${f(vx + 0.012)}" y="${f(vy + 0.003)}" fill="${_wpC}" font-size="0.01" font-weight="700" font-family="monospace" opacity="0.95">${Math.round(wp.rssi)}</text>`;
  }

  // ── 6. Legend ──────────────────────────────────────────────────────────────
  const ly = 0.92;
  s += `<rect x="0.02" y="${ly - 0.01}" width="0.34" height="0.07" rx="0.006" fill="rgba(7,16,8,0.85)"/>`;
  s += `<text x="0.035" y="${ly + 0.008}" fill="#e2e8f0" font-size="0.014" font-weight="600" font-family="system-ui,sans-serif">${scannerSource ? "Scanner" : "Floor"} Radio Map</text>`;
  const flLegSteps = 8;
  const bw = 0.028;
  for (let i = 0; i < flLegSteps; i++) {
    const bucketIdx = Math.round(i / (flLegSteps - 1) * (HATCH_BUCKETS - 1));
    s += `<rect x="${(0.035 + i * bw).toFixed(3)}" y="${ly + 0.02}" width="${bw.toFixed(3)}" height="0.012" fill="${_bucketRGB(bucketIdx)}"/>`;
  }
  s += `<text x="0.035" y="${ly + 0.048}" fill="#fca5a5" font-size="0.01" font-family="system-ui,sans-serif">${Math.round(Math.min(..._wpRssis))}</text>`;
  s += `<text x="${(0.035 + (flLegSteps - 1) * bw).toFixed(3)}" y="${ly + 0.048}" fill="#52b788" font-size="0.01" font-family="system-ui,sans-serif">${Math.round(Math.max(..._wpRssis))} dBm</text>`;
  s += `<text x="0.035" y="${ly + 0.058}" fill="#94a3b8" font-size="0.009" font-family="system-ui,sans-serif">${worldPoints.length} points from ${floorMapIds.size} map${floorMapIds.size > 1 ? "s" : ""}</text>`;

  return s;
}

/**
 * Get unique scanner sources across all maps on a floor.
 */
export function getFloorScanners(calPoints, floorMapIds) {
  const idSet = new Set(floorMapIds);
  const scannerMap = {};
  for (const pt of (calPoints || [])) {
    if (!idSet.has(pt.map_id)) continue;
    for (const r of (pt.scanner_readings || [])) {
      if (!r.source) continue;
      if (!scannerMap[r.source]) scannerMap[r.source] = { source: r.source, name: r.name || r.source, pointCount: 0 };
      scannerMap[r.source].pointCount++;
    }
  }
  return Object.values(scannerMap).sort((a, b) => b.pointCount - a.pointCount);
}


// ═══════════════════════════════════════════════════════════════════════════════
// Deformation Grid — Distortion visualization
// ═══════════════════════════════════════════════════════════════════════════════
// Draws a regular grid where each intersection is warped to where the k-NN
// positioning system predicts it should be. Grid cells are colored with the
// same heatmap colors as the radio map. Distorted cells show where the system
// confuses physical space.

const DISTORTION_GRID = 30; // 30x30 deformation grid — finer for smoother lines

// Distortion intensity: 0 = no warp (regular grid), 100 = full warp. User-adjustable.
let _distortionIntensity = 50; // default 50%
export function setDistortionIntensity(v) { _distortionIntensity = Math.max(0, Math.min(100, v || 50)); }

// Source blend: 0 = pure model (physics), 100 = pure historical (adaptive data)
let _sourceBlend = 0; // default: model only
let _adaptiveFingerprints = null; // { room: { scanner: mean_rssi } }
export function setSourceBlend(v) { _sourceBlend = Math.max(0, Math.min(100, v ?? 0)); }
export function setAdaptiveData(fps) { _adaptiveFingerprints = fps; }

// Fabric room shapes in world coords (from stack_transform.fabricWorldRooms),
// set by the caller before rendering. When present, adaptive point-in-room
// hit-testing uses the committed fabric instead of per-photo room_bounds.
let _fabricWorld = null; // { room: { floor_id, pts: [[wx,wy],...] } } | null
export function setFabricWorld(fw) { _fabricWorld = fw || null; }
function _fabricRoomPolysW(maps) {
  if (!_fabricWorld) return null;
  const fids = new Set((maps || []).map(m => String(m.stack?.floor_id || m.floor_id || "main")));
  const out = [];
  for (const [room, fr] of Object.entries(_fabricWorld)) {
    if (fids.has(fr.floor_id)) out.push({ room, polyW: fr.pts });
  }
  return out.length ? out : null;
}

/**
 * Get adaptive correction for a world point.
 * Returns a dBm OFFSET (positive = real coverage is better than model,
 * negative = worse) based on the mean observed RSSI vs fleet average.
 * Returns null if no data.
 */
function _adaptiveOffset(wx, wy, roomBoundsWorld) {
  if (!_adaptiveFingerprints || !roomBoundsWorld) return null;
  for (const { room, polyW } of roomBoundsWorld) {
    let inside = false;
    for (let i = 0, j = polyW.length - 1; i < polyW.length; j = i++) {
      const [xi, yi] = polyW[i], [xj, yj] = polyW[j];
      if (((yi > wy) !== (yj > wy)) && (wx < (xj - xi) * (wy - yi) / (yj - yi) + xi)) inside = !inside;
    }
    if (!inside) continue;
    const roomFp = _adaptiveFingerprints[room];
    if (!roomFp) return null;
    const vals = Object.values(roomFp);
    if (!vals.length) return null;
    // Mean across all scanners for this room (not max — mean represents overall coverage quality)
    const roomMean = vals.reduce((a, b) => a + b, 0) / vals.length;
    // Compare to fleet average: how does this room compare to the typical room?
    // Fleet average from all rooms' means
    let fleetSum = 0, fleetN = 0;
    for (const rFp of Object.values(_adaptiveFingerprints)) {
      const rv = Object.values(rFp);
      if (rv.length) { fleetSum += rv.reduce((a,b)=>a+b,0)/rv.length; fleetN++; }
    }
    const fleetMean = fleetN > 0 ? fleetSum / fleetN : roomMean;
    // Offset: ONLY negative (can reveal problems, never boost).
    // If room is worse than fleet average → negative offset → redder.
    // If room is better than average → 0 (model already shows it as green).
    const raw = roomMean - fleetMean;
    return Math.max(-15, Math.min(0, raw));
  }
  return null;
}

/**
 * At a world-space query point, build a synthetic RSSI fingerprint by IDW from
 * nearby calibration points, then run k-NN to predict where the system thinks
 * this point is. Returns the predicted world position.
 */
function _predictPosition(qwx, qwy, calWorldPts) {
  if (calWorldPts.length < KNN_K) return [qwx, qwy];

  // Build synthetic fingerprint at (qwx,qwy) by IDW from nearby cal points
  const allSources = new Set();
  for (const p of calWorldPts) for (const src of Object.keys(p.query)) allSources.add(src);
  const synthFp = {};
  for (const src of allSources) {
    // IDW interpolation of this source's RSSI at the query point
    let wSum = 0, vSum = 0;
    for (const p of calWorldPts) {
      if (p.query[src] == null) continue;
      const dx = qwx - p.wx, dy = qwy - p.wy;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < 0.001) { wSum = 1; vSum = p.query[src]; break; }
      const w = 1.0 / Math.pow(dist, 2.0);
      wSum += w; vSum += w * p.query[src];
    }
    if (wSum > 0) synthFp[src] = vSum / wSum;
  }

  // k-NN: find closest calibration points by RSSI distance
  const scored = [];
  for (const p of calWorldPts) {
    const shared = Object.keys(synthFp).filter(s => p.query[s] != null);
    if (!shared.length) continue;
    let distSq = 0;
    for (const s of shared) distSq += (synthFp[s] - p.query[s]) ** 2;
    scored.push({ distSq, p });
  }
  if (scored.length < KNN_K) return [qwx, qwy];
  scored.sort((a, b) => a.distSq - b.distSq);
  const topK = scored.slice(0, KNN_K);
  let wT = 0, pwx = 0, pwy = 0;
  for (const { distSq, p } of topK) {
    const w = 1.0 / (Math.sqrt(distSq) + 0.001);
    pwx += w * p.wx; pwy += w * p.wy; wT += w;
  }
  if (wT < 1e-10) return [qwx, qwy];
  let predX = pwx / wT, predY = pwy / wT;
  // Clamp displacement to prevent wild extrapolation at grid edges.
  // Max displacement = 20% of the distance to the nearest calibration point.
  const dists = calWorldPts.map(p => Math.sqrt((qwx - p.wx)**2 + (qwy - p.wy)**2));
  const nearestDist = Math.min(...dists);
  const maxDisp = Math.max(nearestDist * 0.3, 0.01);
  const dx = predX - qwx, dy = predY - qwy;
  const disp = Math.sqrt(dx * dx + dy * dy);
  if (disp > maxDisp) {
    const scale = maxDisp / disp;
    predX = qwx + dx * scale;
    predY = qwy + dy * scale;
  }
  return [predX, predY];
}

/**
 * 3D Iso deformation grid for one z-level.
 * Regular square grid that WARPS where positioning predictions disagree with reality.
 * Grid lines colored with same heatmap colors. Square = accurate, warped = error.
 */
export function isoDistortionSVG(calPoints, groupMaps, mapTransforms, iso, z, settings, allMaps, liveSnap) {
  if (!calPoints || !groupMaps.length) return "";
  const groupIds = new Set(groupMaps.map(m => m.id));

  // Collect cal points on this level with world positions + RSSI fingerprints
  const calWorldPts = [];
  for (const pt of calPoints) {
    if (!groupIds.has(pt.map_id)) continue;
    const tf = mapTransforms[pt.map_id];
    if (!tf || !tf.mapPt) continue;
    const query = {};
    for (const r of (pt.scanner_readings || [])) {
      if (r.source && r.mean_rssi != null) query[r.source] = r.mean_rssi;
    }
    if (!Object.keys(query).length) continue;
    const [wx, wy] = tf.mapPt(pt.x_frac, pt.y_frac);
    const bestRssi = Math.max(...Object.values(query));
    calWorldPts.push({ wx, wy, query, rssi: bestRssi });
  }
  if (calWorldPts.length < KNN_K + 1) return "";

  const _rssis = calWorldPts.map(p => p.rssi);
  setHatchRange(Math.min(..._rssis), Math.max(..._rssis), _userGain, _userContrast);

  // World bounding box from ALL maps on this level (not just cal points)
  let bb = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  for (const m of groupMaps) {
    const tf = mapTransforms[m.id]; if (!tf || !tf.mapPt) continue;
    for (const [cx, cy] of [[0,0],[1,0],[1,1],[0,1]]) {
      const [wx, wy] = tf.mapPt(cx, cy);
      bb.minX = Math.min(bb.minX, wx); bb.minY = Math.min(bb.minY, wy);
      bb.maxX = Math.max(bb.maxX, wx); bb.maxY = Math.max(bb.maxY, wy);
    }
  }
  if (!isFinite(bb.minX)) return "";
  const wW = bb.maxX - bb.minX, wH = bb.maxY - bb.minY;
  if (wW < 1e-6 || wH < 1e-6) return "";

  // Square cells: use the same cell size for both dimensions
  const cellSize = Math.min(wW, wH) / DISTORTION_GRID;
  const resX = Math.max(2, Math.ceil(wW / cellSize));
  const resY = Math.max(2, Math.ceil(wH / cellSize));
  const cellW = wW / resX, cellH = wH / resY;
  const f = v => v.toFixed(1);

  // Collect scanners + barriers for model-based coloring (same as heatmap)
  const refPower = settings?.ref_power ?? DEFAULT_REF_POWER;
  const pathLossN = settings?.path_loss_exp ?? DEFAULT_PATH_LOSS_N;
  const _dScanners = [];
  const _dBarriers = [];
  // Scanner quality from live data
  const _dqMap = {};
  const _dAds = (liveSnap?.ble?.advertisements) || [];
  if (_dAds.length) {
    const _sb = {};
    for (const ad of _dAds) { if (ad.source && ad.rssi != null && (ad.age_s||0)<30) { if (!_sb[ad.source]||ad.rssi>_sb[ad.source]) _sb[ad.source]=ad.rssi; } }
    const _bv = Object.values(_sb); _bv.sort((a,b)=>a-b);
    if (_bv.length>1) { const fm=_bv[Math.floor(_bv.length/2)]; for (const [s,b] of Object.entries(_sb)) _dqMap[s]=Math.max(-10,Math.min(10,b-fm)); }
  }
  for (const m of (allMaps || groupMaps)) {
    const tf = mapTransforms[m.id]; if (!tf||!tf.mapPt) continue;
    const fd = Math.abs(tf.z-z); if (fd>2) continue;
    for (const r of (m.receivers||[])) { if (r.x==null||r.y==null) continue; const [wx,wy]=tf.mapPt(r.x,r.y); _dScanners.push({wx,wy,floorDist:fd,qualityOffset:_dqMap[r.source||r.id||""]||0}); }
    for (const bar of (m.rf_barriers||[])) { const pts=bar.points||[]; if(pts.length<2) continue; _dBarriers.push({points:pts.map(p=>{const[wx,wy]=tf.mapPt(Number(p[0]),Number(p[1]));return[wx,wy];}),attenuation_dbm:bar.attenuation_dbm||6}); }
  }
  // Room bounds for adaptive offset — fabric-first
  const _dRoomBW = [];
  if (_sourceBlend > 0 && _adaptiveFingerprints) {
    const _fab = _fabricRoomPolysW(groupMaps);
    if (_fab) _dRoomBW.push(..._fab);
    else for (const m of groupMaps) { const tf=mapTransforms[m.id]; if(!tf||!tf.mapPt) continue; for (const [room,b] of Object.entries(m.room_bounds||{})) { if(!b||b.type!=="poly"||!b.points||b.points.length<3) continue; _dRoomBW.push({room,polyW:b.points.map(p=>tf.mapPt(Number(p[0]),Number(p[1])))}); } }
  }

  // Build grid with warped positions + model-based RSSI coloring
  let minR=0, maxR=-120;
  const grid = [];
  for (let gy = 0; gy <= resY; gy++) {
    grid[gy] = [];
    for (let gx = 0; gx <= resX; gx++) {
      const wx = bb.minX + gx * cellW, wy = bb.minY + gy * cellH;
      const [pwx, pwy] = _predictPosition(wx, wy, calWorldPts);
      // Model RSSI (same as heatmap)
      let best = -120;
      for (const sc of _dScanners) {
        const dm = Math.max(0.3, Math.sqrt((wx-sc.wx)**2+(wy-sc.wy)**2)*MAP_SCALE_M);
        let rssi = (refPower+(sc.qualityOffset||0)) - 10*pathLossN*Math.log10(dm);
        if (sc.floorDist>0) rssi -= sc.floorDist*FLOOR_ATTEN_DB;
        for (const bar of _dBarriers) { for (let i=0;i<bar.points.length-1;i++) { if(_segmentsIntersect(wx,wy,sc.wx,sc.wy,bar.points[i][0],bar.points[i][1],bar.points[i+1][0],bar.points[i+1][1])) rssi-=bar.attenuation_dbm; } }
        if (rssi>best) best=rssi;
      }
      // Adaptive offset
      if (_sourceBlend>0 && _dRoomBW.length) {
        const aOff = _adaptiveOffset(wx, wy, _dRoomBW);
        if (aOff!=null) best += aOff * (_sourceBlend/100);
      }
      if (best>maxR) maxR=best; if (best<minR) minR=best;
      grid[gy][gx] = { wx, wy, pwx, pwy, rssi: best };
    }
  }
  setHatchRange(minR, maxR, _userGain, _userContrast);

  // Blend: 0.6 = moderate warp (readable but distortion visible)
  const blend = _distortionIntensity / 100;
  let s = "";

  // Horizontal grid lines
  for (let gy = 0; gy <= resY; gy++) {
    for (let gx = 0; gx < resX; gx++) {
      const a = grid[gy][gx], b = grid[gy][gx + 1];
      const ax = a.wx + (a.pwx - a.wx) * blend, ay = a.wy + (a.pwy - a.wy) * blend;
      const bx = b.wx + (b.pwx - b.wx) * blend, by = b.wy + (b.pwy - b.wy) * blend;
      const rssi = (a.rssi != null && b.rssi != null) ? (a.rssi + b.rssi) / 2 : a.rssi || b.rssi;
      const bucket = _rssiBucket(rssi);
      const color = bucket >= 0 ? _bucketRGB(bucket) : "#333";
      const [sx1, sy1] = iso(ax, ay, z), [sx2, sy2] = iso(bx, by, z);
      s += `<line x1="${f(sx1)}" y1="${f(sy1)}" x2="${f(sx2)}" y2="${f(sy2)}" stroke="${color}" stroke-width="1.5" opacity="0.7"/>`;
    }
  }
  // Vertical grid lines
  for (let gx = 0; gx <= resX; gx++) {
    for (let gy = 0; gy < resY; gy++) {
      const a = grid[gy][gx], b = grid[gy + 1][gx];
      const ax = a.wx + (a.pwx - a.wx) * blend, ay = a.wy + (a.pwy - a.wy) * blend;
      const bx = b.wx + (b.pwx - b.wx) * blend, by = b.wy + (b.pwy - b.wy) * blend;
      const rssi = (a.rssi != null && b.rssi != null) ? (a.rssi + b.rssi) / 2 : a.rssi || b.rssi;
      const bucket = _rssiBucket(rssi);
      const color = bucket >= 0 ? _bucketRGB(bucket) : "#333";
      const [sx1, sy1] = iso(ax, ay, z), [sx2, sy2] = iso(bx, by, z);
      s += `<line x1="${f(sx1)}" y1="${f(sy1)}" x2="${f(sx2)}" y2="${f(sy2)}" stroke="${color}" stroke-width="1.5" opacity="0.7"/>`;
    }
  }

  return s;
}

/**
 * 2D floor deformation grid. Square by default, warps where predictions differ.
 * Same colors as heatmap. Replaces crosshatch when distortion is on.
 */
export function floorDistortionSVG(calPoints, floorMaps, mapPtFns, w2v, wBB, allMaps) {
  if (!calPoints || !floorMaps.length) return "";
  const floorMapIds = new Set(floorMaps.map(m => m.id));
  const _floorZ = (floorMaps[0].stack?.z_level) ?? 0;
  const _allMapZ = {};
  for (const m of (allMaps || floorMaps)) { _allMapZ[m.id] = (m.stack?.z_level) ?? 0; }

  // Collect cal points with RSSI fingerprints (for prediction) + best RSSI (for coloring)
  const calWorldPts = [];
  for (const pt of calPoints) {
    const mpt = mapPtFns[pt.map_id]; if (!mpt) continue;
    const ptZ = _allMapZ[pt.map_id]; if (ptZ == null) continue;
    const floorDist = Math.abs(ptZ - _floorZ);
    if (floorDist > 2) continue;
    const query = {};
    for (const r of (pt.scanner_readings || [])) {
      if (r.source && r.mean_rssi != null) query[r.source] = r.mean_rssi;
    }
    if (!Object.keys(query).length) continue;
    const [wx, wy] = mpt(pt.x_frac, pt.y_frac);
    let bestRssi = Math.max(...Object.values(query));
    if (floorDist > 0) bestRssi -= floorDist * FLOOR_ATTEN_DB;
    calWorldPts.push({ wx, wy, query, rssi: bestRssi });
  }
  if (calWorldPts.length < KNN_K + 1) return "";

  const _rssis = calWorldPts.map(p => p.rssi);
  setHatchRange(Math.min(..._rssis), Math.max(..._rssis), _userGain, _userContrast);

  const wW = wBB.maxX - wBB.minX, wH = wBB.maxY - wBB.minY;
  if (wW < 1e-6 || wH < 1e-6) return "";

  // Square cells
  const _flCellSize = Math.min(wW, wH) / DISTORTION_GRID;
  const _flResX = Math.max(2, Math.ceil(wW / _flCellSize));
  const _flResY = Math.max(2, Math.ceil(wH / _flCellSize));
  const cellW = wW / _flResX, cellH = wH / _flResY;
  const idwPts = calWorldPts.map(p => ({ x_frac: p.wx, y_frac: p.wy, rssi: p.rssi }));
  const fv = v => v.toFixed(5);
  const blend = _distortionIntensity / 100;

  const grid = [];
  for (let gy = 0; gy <= _flResY; gy++) {
    grid[gy] = [];
    for (let gx = 0; gx <= _flResX; gx++) {
      const wx = wBB.minX + gx * cellW, wy = wBB.minY + gy * cellH;
      const [pwx, pwy] = _predictPosition(wx, wy, calWorldPts);
      const rssi = _idw(wx, wy, idwPts, []);
      grid[gy][gx] = { wx, wy, pwx, pwy, rssi };
    }
  }

  let s = "";
  // Horizontal grid lines
  for (let gy = 0; gy <= _flResY; gy++) {
    for (let gx = 0; gx < _flResX; gx++) {
      const a = grid[gy][gx], b = grid[gy][gx + 1];
      const ax = a.wx + (a.pwx - a.wx) * blend, ay = a.wy + (a.pwy - a.wy) * blend;
      const bx = b.wx + (b.pwx - b.wx) * blend, by = b.wy + (b.pwy - b.wy) * blend;
      const rssi = (a.rssi != null && b.rssi != null) ? (a.rssi + b.rssi) / 2 : a.rssi || b.rssi;
      const bucket = _rssiBucket(rssi);
      const color = bucket >= 0 ? _bucketRGB(bucket) : "#333";
      const [vx1, vy1] = w2v(ax, ay), [vx2, vy2] = w2v(bx, by);
      s += `<line x1="${fv(vx1)}" y1="${fv(vy1)}" x2="${fv(vx2)}" y2="${fv(vy2)}" stroke="${color}" stroke-width="0.003" opacity="0.75"/>`;
    }
  }
  // Vertical grid lines
  for (let gx = 0; gx <= _flResX; gx++) {
    for (let gy = 0; gy < _flResY; gy++) {
      const a = grid[gy][gx], b = grid[gy + 1][gx];
      const ax = a.wx + (a.pwx - a.wx) * blend, ay = a.wy + (a.pwy - a.wy) * blend;
      const bx = b.wx + (b.pwx - b.wx) * blend, by = b.wy + (b.pwy - b.wy) * blend;
      const rssi = (a.rssi != null && b.rssi != null) ? (a.rssi + b.rssi) / 2 : a.rssi || b.rssi;
      const bucket = _rssiBucket(rssi);
      const color = bucket >= 0 ? _bucketRGB(bucket) : "#333";
      const [vx1, vy1] = w2v(ax, ay), [vx2, vy2] = w2v(bx, by);
      s += `<line x1="${fv(vx1)}" y1="${fv(vy1)}" x2="${fv(vx2)}" y2="${fv(vy2)}" stroke="${color}" stroke-width="0.003" opacity="0.75"/>`;
    }
  }

  return s;
}
