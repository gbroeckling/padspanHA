// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
// See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
//
// A self-contained "why is it here" diagram for the object detail modal
// (gap #2, docs/BEST_IN_CLASS_ROADMAP.md): a dashed ring around each
// contributing scanner at its estimated distance for this object — where
// the rings overlap is the evidence behind the solved position, the same
// idea multilateration uses, made visible.
//
// Deliberately NOT the iso map's isometric projection (overview.js's
// iso()). This is a small diagnostic diagram inside a modal, not part of
// the live map or its 5s poll/glide machinery — a flat top-down scale
// keeps it a pure, easily-tested string builder with no dependency on the
// map's floor/elevation model.

function _esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/**
 * scanners: [{source, name, x_m, y_m, distance_m}] — x_m/y_m/distance_m
 *   may be missing (a scanner with no known position, or no live reading);
 *   such entries are skipped.
 * objXY: [x_m, y_m] | null — the object's own solved position, if any.
 * Returns "" when there is nothing placeable (no scanner has a position).
 */
export function buildEvidenceSvg(opts) {
  const objXY = opts && opts.objXY;
  const scanners = (opts && opts.scanners) || [];
  const width = (opts && opts.width) || 260;
  const height = (opts && opts.height) || 200;
  const margin = 22;

  const placeable = scanners.filter(s => typeof s.x_m === "number" && typeof s.y_m === "number");
  const pts = [];
  if (objXY && typeof objXY[0] === "number" && typeof objXY[1] === "number") pts.push(objXY);
  for (const s of placeable) {
    pts.push([s.x_m, s.y_m]);
    if (typeof s.distance_m === "number" && s.distance_m > 0) {
      pts.push([s.x_m - s.distance_m, s.y_m - s.distance_m]);
      pts.push([s.x_m + s.distance_m, s.y_m + s.distance_m]);
    }
  }
  if (!pts.length) return "";

  const padM = 0.5;
  const minX = Math.min(...pts.map(p => p[0])) - padM;
  const maxX = Math.max(...pts.map(p => p[0])) + padM;
  const minY = Math.min(...pts.map(p => p[1])) - padM;
  const maxY = Math.max(...pts.map(p => p[1])) + padM;
  const spanX = Math.max(0.1, maxX - minX);
  const spanY = Math.max(0.1, maxY - minY);
  const scale = Math.min((width - margin * 2) / spanX, (height - margin * 2) / spanY);
  // Flip Y: metre-space Y grows away from the origin, screen-space Y grows
  // downward — without the flip the diagram reads upside down against
  // every other view in this codebase.
  const toPx = (x, y) => [
    margin + (x - minX) * scale,
    height - margin - (y - minY) * scale,
  ];

  let s = `<svg viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg" width="100%" `
    + `style="max-width:${width}px;display:block;background:#0b1710;border-radius:6px">`;

  // Rings first, so markers and labels draw on top of them.
  for (const sc of placeable) {
    if (typeof sc.distance_m !== "number" || sc.distance_m <= 0) continue;
    const [cx, cy] = toPx(sc.x_m, sc.y_m);
    const r = sc.distance_m * scale;
    s += `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${r.toFixed(1)}" fill="none" `
      + `stroke="#38bdf8" stroke-width="1.3" stroke-dasharray="5,4" opacity="0.55"/>`;
  }
  for (const sc of placeable) {
    const [cx, cy] = toPx(sc.x_m, sc.y_m);
    s += `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="4" fill="#52b788" stroke="#071008" stroke-width="1"/>`;
    const lbl = sc.name + (typeof sc.distance_m === "number" ? ` · ${sc.distance_m.toFixed(1)}m` : "");
    s += `<text x="${cx.toFixed(1)}" y="${(cy - 8).toFixed(1)}" text-anchor="middle" fill="#94a3b8" `
      + `font-size="9">${_esc(lbl)}</text>`;
  }
  if (objXY && typeof objXY[0] === "number" && typeof objXY[1] === "number") {
    const [ox, oy] = toPx(objXY[0], objXY[1]);
    s += `<circle cx="${ox.toFixed(1)}" cy="${oy.toFixed(1)}" r="6" fill="#fbbf24" stroke="#071008" stroke-width="1.5"/>`;
  }
  s += `</svg>`;
  return s;
}

/**
 * Normalised {room: fraction} → sorted [{room, pct}] for a probability bar
 * list, highest first. Empty input returns [].
 */
export function roomScoreBars(roomScores) {
  const entries = Object.entries(roomScores || {});
  if (!entries.length) return [];
  return entries
    .map(([room, frac]) => ({ room, pct: Math.round(Math.max(0, Math.min(1, frac)) * 100) }))
    .sort((a, b) => b.pct - a.pct);
}
