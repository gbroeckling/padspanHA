// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
// See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
//
// Drawing rooms (Mapping → Edit and Layout, 2026-11-18). A corner put down or dragged lands on another room's corner,
// else on another room's edge, else on a grid (Alt places it freely: the caller's choice). "Straighten edges" makes an
// edge less than 5 cm off level or upright straight, and a corner another room shares moves with it, so a corner
// clicked 2 cm off is no slanted wall in 3D. Pure: points in, points out, in the frame the caller works in (metres;
// screen pixels for snapping on a plan with no scale, and then no grid). No photo, no store.

export const SNAP_PX = 12;           // how near, on screen, a corner must come to another room's corner or edge to land on it
export const GRID_M = 0.05;          // the grid a corner lands on when no room is near (half a click's error on most plans)
export const STRAIGHT_M = 0.05;      // an edge less than this off level or upright is made straight
export const STRAIGHT_MIN_M = 0.5;   // ...when it runs at least this far the other way: a short slant may be meant
const SAME_M = 0.001;                // two corners this close are one corner, shared by the rooms it belongs to

/** The corners and edges of the outlines given ([[x, y], ...] each), for snapPoint. */
export function snapTargets(outlines) {
  const corners = [], edges = [];
  for (const pts of outlines || []) {
    if (!Array.isArray(pts) || pts.length < 2) continue;
    pts.forEach((p, i) => { corners.push(p); edges.push([p, pts[(i + 1) % pts.length]]); });
  }
  return { corners, edges };
}

/** Where a corner put down at `p` lands: on the nearest corner within `tol`, else on the nearest point of an edge within
 *  `tol`, else on the nearest grid point (`grid` > 0), else where it was put. { p, kind: "corner" | "edge" | "grid" | null } */
export function snapPoint(p, { corners = [], edges = [], tol = 0, grid = 0 } = {}) {
  let best = null, bd = tol;
  for (const q of corners) {
    const d = Math.hypot(q[0] - p[0], q[1] - p[1]);
    if (d < bd) { bd = d; best = q; }
  }
  if (best) return { p: [best[0], best[1]], kind: "corner" };
  for (const [a, b] of edges) {
    const dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy;
    if (!(l2 > 0)) continue;
    const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2));
    const q = [a[0] + t * dx, a[1] + t * dy], d = Math.hypot(q[0] - p[0], q[1] - p[1]);
    if (d < bd) { bd = d; best = q; }
  }
  if (best) return { p: best, kind: "edge" };
  if (grid > 0) return { p: p.map(v => Math.round(Math.round(v / grid) * grid * 1e6) / 1e6), kind: "grid" };
  return { p: [p[0], p[1]], kind: null };
}

/** Every edge of the outlines given ({room: [[x, y], ...]}, metres) that is less than STRAIGHT_M off level or upright,
 *  over STRAIGHT_MIN_M or more the other way, made straight. Of its two ends the one on the line more corners already
 *  use stays (NeonPlan's rule: a wall's corners line up with the walls beside it); the other moves, and so does every
 *  corner at the same point, in any room. Edges a move bends are looked at again, a few rounds at most.
 *  { rooms: {room: new outline} (all of them, copies), fixed: how many edges were made straight } */
export function straightenRooms(rooms, { maxOff = STRAIGHT_M, minLen = STRAIGHT_MIN_M } = {}) {
  const out = Object.fromEntries(Object.entries(rooms || {}).map(([r, pts]) => [r, (pts || []).map(p => [p[0], p[1]])]));
  const all = Object.values(out).flat();
  const count = (axis, v) => all.filter(p => Math.abs(p[axis] - v) < SAME_M).length;
  const off = (d) => d > 1e-6 && d < maxOff - 1e-9;          // 5 cm exactly (two grid lines apart) is not "less than"
  let fixed = 0;
  for (let round = 0; round < 4; round++) {
    let changed = false;
    for (const pts of Object.values(out)) {
      if (pts.length < 3) continue;
      for (let i = 0; i < pts.length; i++) {
        const a = pts[i], b = pts[(i + 1) % pts.length];
        const dx = Math.abs(b[0] - a[0]), dy = Math.abs(b[1] - a[1]);
        const axis = off(dy) && dx >= minLen ? 1 : off(dx) && dy >= minLen ? 0 : -1;   // 1: nearly level, 0: nearly upright
        if (axis < 0) continue;
        const [keep, move] = count(axis, a[axis]) >= count(axis, b[axis]) ? [a, b] : [b, a];
        const [mx, my] = move, v = keep[axis];
        for (const p of all) if (Math.abs(p[0] - mx) < SAME_M && Math.abs(p[1] - my) < SAME_M) p[axis] = v;
        fixed++; changed = true;
      }
    }
    if (!changed) break;
  }
  return { rooms: out, fixed };
}
