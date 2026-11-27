// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
// See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
//
// Drawing rooms (Mapping → Edit and Layout, 2026-11-18). A corner put down or dragged lands on another room's corner,
// else on another room's edge, else on a grid (Alt places it freely: the caller's choice). "Straighten edges" makes an
// edge less than 5 cm off level or upright straight, and a corner another room shares moves with it, so a corner
// clicked 2 cm off is no slanted wall in 3D. Layout straightens square to the floor's own walls (floorDirection):
// a floor placed a degree or two turned is made straight to itself, not bent to the page. Pure: points in, points out, in the frame the caller works in (metres;
// screen pixels for snapping on a plan with no scale, and then no grid). No photo, no store.

export const SNAP_PX = 12;           // how near, on screen, a corner must come to another room's corner or edge to land on it
export const GRID_M = 0.05;          // the grid a corner lands on when no room is near (half a click's error on most plans)
export const STRAIGHT_M = 0.05;      // an edge less than this off level or upright is made straight
export const STRAIGHT_MIN_M = 0.5;   // ...when it runs at least this far the other way: a short slant may be meant
const SAME_M = 0.001;                // two corners this close are one corner, shared by the rooms it belongs to
const LINE_M = 0.002;                // an edge this little off is straight already (Layout keeps millimetres)

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

/** The direction a floor's walls run, in radians from level (-45° to 45°): the edges of the outlines given, half a
 *  metre or longer, each weighing its length; level and upright are one direction (angles taken mod 90°). The
 *  length-weighted median around their mean, so a few crooked edges do not move it; 0 (level and upright) wherever
 *  that leaves at least as much wall already straight, so a floor square to the page stays exactly so. */
export function floorDirection(outlines, { minLen = STRAIGHT_MIN_M } = {}) {
  const Q = Math.PI / 2, fold = (a, c) => a - Q * Math.round((a - c) / Q);   // into (c - 45°, c + 45°]
  const edges = [];
  for (const pts of outlines || []) {
    if (!Array.isArray(pts) || pts.length < 3) continue;
    pts.forEach((a, i) => {
      const b = pts[(i + 1) % pts.length], L = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (L >= minLen) edges.push({ a, b, L, ang: Math.atan2(b[1] - a[1], b[0] - a[0]) });
    });
  }
  if (!edges.length) return 0;
  const c = Math.atan2(edges.reduce((t, e) => t + e.L * Math.sin(4 * e.ang), 0), edges.reduce((t, e) => t + e.L * Math.cos(4 * e.ang), 0)) / 4;
  const by = edges.map(e => ({ L: e.L, ang: fold(e.ang, c) })).sort((x, y) => x.ang - y.ang);
  const half = by.reduce((t, e) => t + e.L, 0) / 2;
  let run = 0, theta = 0;
  for (const e of by) { run += e.L; if (run >= half) { theta = fold(e.ang, 0); break; } }
  const straight = (t) => edges.reduce((sum, { a, b, L }) => {
    const u = (b[0] - a[0]) * Math.cos(t) + (b[1] - a[1]) * Math.sin(t), v = (b[1] - a[1]) * Math.cos(t) - (b[0] - a[0]) * Math.sin(t);
    return sum + (Math.min(Math.abs(u), Math.abs(v)) < LINE_M ? L : 0);
  }, 0);
  return straight(0) >= straight(theta) ? 0 : theta;
}

/** Every edge of the outlines given ({room: [[x, y], ...]}, metres) that is less than STRAIGHT_M off level or upright,
 *  over STRAIGHT_MIN_M or more the other way, made straight; `angle` (radians, floorDirection's): off that direction
 *  and the one square to it instead. Of its two ends the one on the line more corners already use stays (the
 *  rule: a wall's corners line up with the walls beside it); the other moves, and so does every corner at the same
 *  point, in any room. Edges a move bends are looked at again, a few rounds at most. Corners that did not move come
 *  back exactly as given. { rooms: {room: new outline} (all of them, copies), fixed: how many edges were made straight } */
export function straightenRooms(rooms, { maxOff = STRAIGHT_M, minLen = STRAIGHT_MIN_M, angle = 0 } = {}) {
  const cs = Math.cos(angle), sn = Math.sin(angle);
  const given = Object.entries(rooms || {}).map(([r, pts]) => [r, (pts || []).map(p => [p[0], p[1]])]);
  // Into the floor's own frame (its walls level and upright there), and back for the corners that moved.
  const out = Object.fromEntries(given.map(([r, pts]) => [r, pts.map(([x, y]) => [x * cs + y * sn, y * cs - x * sn])]));
  const start = JSON.parse(JSON.stringify(out));
  const all = Object.values(out).flat();
  const count = (axis, v) => all.filter(p => Math.abs(p[axis] - v) < LINE_M).length;
  const off = (d) => d >= LINE_M && d < maxOff - 1e-9;          // 5 cm exactly (two grid lines apart) is not "less than"
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
  const back = Object.fromEntries(given.map(([r, pts]) => [r, pts.map((p, i) => {
    const q = out[r][i], q0 = start[r][i];
    return q[0] === q0[0] && q[1] === q0[1] ? p : [q[0] * cs - q[1] * sn, q[0] * sn + q[1] * cs];
  })]));
  return { rooms: back, fixed };
}
