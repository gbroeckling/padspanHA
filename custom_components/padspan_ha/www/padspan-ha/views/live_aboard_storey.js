// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
// See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
//
// Live Aboard, the 3D house (docs/IDEA_ATLAS_3D_HOUSE.md): the house itself,
// as plain numbers (Garry, 2026-10-05: "Lots still missing on the sims
// view"). No three.js and no page: the view (live_aboard.js) turns these
// into meshes, and node runs them for real (tests/js/live_aboard_house_model.mjs).
//
//   storeys      the indoor floors at one height are one storey (Main and a
//                Garage beside it). Its outline is where its rooms are, with
//                the halls between them filled in (gaps up to HALL_M), found
//                on a grid laid along the house's own walls: the solid floor
//                under the whole storey, so a hall never drawn as a room is
//                no hole.
//   roof         over each storey, where no storey is above it: hips over
//                rectangles that cover that part (overlapping where it turns
//                a corner, as an L-shaped roof does), with eaves EAVE_M out
//                and a fascia band. When it shows (roofShown) and how it
//                fades (roofFade).
//   stairs       which floor a flight reaches and how far it rises
//                (stairReach), and the opening it cuts in that floor
//                (stairCuts: its footprint), cut from the rooms' tiles
//                (minusConvex) and from the storey's floor.
//   doors        door_types.js, re-exported: how a door stands with no
//                sensor (doorShown), its type (doorTypeOf: stored, else
//                PadSpan's guess), where each panel is as it opens
//                (doorPanels), and what drives it (a cover's position).
//
// Coordinates are PadSpan's plan metres (x, y down the plan); heights are
// metres. Nothing here writes anything. three.js is handed in (the layer);
// the only import is the doors' shared rules.
const DOORS = await import(`./door_types.js${new URL(import.meta.url).search}`);
export const { DOOR_SHOWN, DOOR_ANGLE_DEG, GARAGE_DOOR_M, doorShown, DOOR_TYPES, DOOR_TYPE_NAMES, DOOR_TYPE_OPTIONS, DOOR_SLIDES,
               DOOR_FACES, DOOR_PANELS, LIFT_AJAR, COVER_TRAVEL_MS, COVER_STEP_MS, guessDoorType, doorTypeOf, linkKind, coverAt,
               coverWords, movedWords, coverIsDoor, doorPanels, shownAt, PANEL_COLOURS, panelColour, moveMs } = DOORS;

export const CELL_M = 0.1;                 // the grid a storey's outline is found on
export const HALL_M = 1.8;                 // a gap between rooms this wide or less is floor (a hall)
export const EAVE_M = 0.4;                 // the roof's overhang past the walls
export const FASCIA_M = 0.18;              // the band along the roof's edge
export const ROOF_PITCH = 0.5;             // rise over run: about 27°
export const ROOF_MAX_H = 3.2;             // a roof is never taller than this
export const ROOF_MIN_M = 0.4;             // a part of a roof narrower than this is left off (a neighbour's eaves cover it)
export const ROOF_MAX_PARTS = 16;          // the most rectangles one storey's roof is made of
export const ROOF_FADE_MS = 300;           // the roof lifts away (or comes back) over this
export const LID_UP = 0.02;                // a flat lid sits this far over the walls' tops
// Zoomed out past the whole-house fit, a little: the view opens at the fit
// with the rooms and their lights in sight, and a step out shows the
// building, roof and all.
export const ROOF_FIT_K = 1.12;
export const TOP_PHI = 0.2;                // looking this near straight down is the Top view
export const ROOF_SETTINGS = ["auto", "off"];
export const STAIR_RISE_M = [0.3, 8];      // the rise kept (house3d_store.py STAIR_RISE_M)

const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// ── polygons ─────────────────────────────────────────────────────────────────
export function areaOf(P){
  let s = 0;
  for (let i = 0; i < P.length; i++) { const a = P[i], b = P[(i + 1) % P.length]; s += a[0] * b[1] - b[0] * a[1]; }
  return s / 2;
}
export function inside(x, y, P){
  let c = false;
  for (let i = 0, j = P.length - 1; i < P.length; j = i++) {
    const a = P[i], b = P[j];
    if ((a[1] > y) !== (b[1] > y) && x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0]) c = !c;
  }
  return c;
}
/** P kept on the side of the line through a → b where side(p) >= 0
 *  (Sutherland–Hodgman, one edge). */
function clipHalf(P, a, b, keepLeft){
  const s = (p) => ((b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0])) * (keepLeft ? 1 : -1);
  const out = [];
  for (let i = 0; i < P.length; i++) {
    const p = P[i], q = P[(i + 1) % P.length], sp = s(p), sq = s(q);
    if (sp >= 0) out.push(p);
    if ((sp >= 0) !== (sq >= 0)) {
      const t = sp / (sp - sq);
      out.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]);
    }
  }
  return out;
}
/** A simple polygon cut into triangles (ear clipping); [] when it cannot be. */
function triangles(P){
  const ccw = areaOf(P) > 0, idx = P.map((_, i) => i), out = [];
  const cross = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  const inTri = (p, a, b, c) => { const s = ccw ? 1 : -1; return s * cross(a, b, p) >= -1e-12 && s * cross(b, c, p) >= -1e-12 && s * cross(c, a, p) >= -1e-12; };
  while (idx.length > 3) {
    let cut = false;
    for (let k = 0; k < idx.length && !cut; k++) {
      const i0 = idx[(k + idx.length - 1) % idx.length], i1 = idx[k], i2 = idx[(k + 1) % idx.length], a = P[i0], b = P[i1], c = P[i2];
      const cr = (ccw ? 1 : -1) * cross(a, b, c);
      if (Math.abs(cr) <= 1e-12) { idx.splice(k, 1); cut = true; continue; }    // a point on a straight run: no corner
      if (cr < 0 || idx.some(j => j !== i0 && j !== i1 && j !== i2 && inTri(P[j], a, b, c))) continue;
      out.push([a, b, c]); idx.splice(k, 1); cut = true;
    }
    if (!cut) return [];
  }
  if (idx.length === 3) out.push(idx.map(i => P[i]));
  return out;
}
const isConvex = (P) => { const s = Math.sign(areaOf(P)); return P.every((a, i) => { const b = P[(i + 1) % P.length], c = P[(i + 2) % P.length];
  return s * ((b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0])) >= -1e-12; }); };
/** Polygon P with the convex polygon C taken out of it: a list of polygons,
 *  each inside P (P itself when they do not meet). The outside of C is cut
 *  into one convex strip per edge of C, and P is clipped to each. Clipping
 *  (Sutherland–Hodgman) is exact for a convex P only — a concave one (a U
 *  or an L room) can come out as pieces joined by a zero-width bridge
 *  outside it — so a concave P is cut into triangles first. */
export function minusConvex(P, C){
  if (!C || C.length < 3 || !P || P.length < 3) return [P];
  const xs = (Q) => [Math.min(...Q.map(p => p[0])), Math.max(...Q.map(p => p[0])), Math.min(...Q.map(p => p[1])), Math.max(...Q.map(p => p[1]))];
  const bp = xs(P), bc = xs(C);
  if (bp[1] <= bc[0] || bc[1] <= bp[0] || bp[3] <= bc[2] || bc[3] <= bp[2]) return [P];
  if (!isConvex(P)) { const T = triangles(P); if (T.length) return T.flatMap(Q => minusConvex(Q, C)); }
  const ccw = areaOf(C) > 0;                               // inside C is to the left of each edge when its area is positive
  const out = [];
  for (let i = 0; i < C.length; i++) {
    let Q = clipHalf(P, C[i], C[(i + 1) % C.length], !ccw);   // outside this edge
    for (let j = 0; j < i && Q.length >= 3; j++) Q = clipHalf(Q, C[j], C[(j + 1) % C.length], ccw);   // inside the ones before
    if (Q.length >= 3 && Math.abs(areaOf(Q)) > 1e-4) out.push(Q);
  }
  return out;
}
/** P with every convex polygon of `holes` taken out. */
export function minusAll(P, holes){
  let parts = [P];
  for (const C of holes || []) parts = parts.flatMap(Q => minusConvex(Q, C));
  return parts;
}

// ── the grid along the house's walls ─────────────────────────────────────────
/** The way most of the house's walls run (radians, -45° to 45°; a quarter
 *  turn apart is the same): the most common direction of the indoor room
 *  edges by length (to the degree), then the length-weighted mean of the
 *  edges within 3° of it, so one slanted wall does not tilt the grid. */
export function houseAxis(rooms){
  const edges = [], bins = new Float64Array(90);
  for (const r of rooms || []) {
    const P = r.pts || [];
    for (let i = 0; i < P.length; i++) {
      const a = P[i], b = P[(i + 1) % P.length], L = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (L < 0.05) continue;
      const d = ((Math.atan2(b[1] - a[1], b[0] - a[0]) * 180 / Math.PI) % 90 + 90) % 90;   // 0 to 90
      edges.push([d, L]);
      bins[Math.round(d) % 90] += L;
    }
  }
  if (!edges.length) return 0;
  let peak = 0;
  for (let i = 1; i < 90; i++) if (bins[i] > bins[peak]) peak = i;
  let sw = 0, sd = 0;
  for (const [d, L] of edges) {
    const off = ((d - peak + 45) % 90 + 90) % 90 - 45;
    if (Math.abs(off) <= 3) { sw += L; sd += L * (peak + off); }
  }
  let deg = sw ? sd / sw : peak;
  if (deg > 45) deg -= 90;
  return Math.abs(deg) < 1e-4 ? 0 : deg * Math.PI / 180;
}
function frameOf(a){
  const c = Math.cos(a), s = Math.sin(a);
  return { a, c, s, toLocal: (p) => [p[0] * c + p[1] * s, -p[0] * s + p[1] * c], toPlan: (u, v) => [u * c - v * s, u * s + v * c] };
}
function gridFor(frame, rooms, pad){
  let u0 = Infinity, v0 = Infinity, u1 = -Infinity, v1 = -Infinity;
  for (const r of rooms) for (const p of r.pts) { const [u, v] = frame.toLocal(p); u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v); }
  if (!Number.isFinite(u0)) return null;
  const c = CELL_M, m = (pad + 2) * c;
  u0 = Math.floor((u0 - m) / c) * c; v0 = Math.floor((v0 - m) / c) * c;
  const nx = Math.ceil((u1 + m - u0) / c), ny = Math.ceil((v1 + m - v0) / c);
  return { ...frame, u0, v0, nx, ny, cell: c };
}
/** The cells (1: in) whose middles lie in any of the rooms. */
function raster(g, rooms, cutsLocal){
  const out = new Uint8Array(g.nx * g.ny), c = g.cell;
  for (const r of rooms) {
    const L = r.pts.map(g.toLocal);
    let a = Infinity, b = -Infinity, e = Infinity, f = -Infinity;
    for (const [u, v] of L) { a = Math.min(a, u); b = Math.max(b, u); e = Math.min(e, v); f = Math.max(f, v); }
    const i0 = Math.max(0, Math.floor((a - g.u0) / c)), i1 = Math.min(g.nx - 1, Math.ceil((b - g.u0) / c));
    const j0 = Math.max(0, Math.floor((e - g.v0) / c)), j1 = Math.min(g.ny - 1, Math.ceil((f - g.v0) / c));
    for (let j = j0; j <= j1; j++) {
      const v = g.v0 + (j + 0.5) * c;
      for (let i = i0; i <= i1; i++) if (!out[j * g.nx + i] && inside(g.u0 + (i + 0.5) * c, v, L)) out[j * g.nx + i] = 1;
    }
  }
  for (const C of cutsLocal || []) {
    for (let j = 0; j < g.ny; j++) {
      for (let i = 0; i < g.nx; i++) if (out[j * g.nx + i] && inside(g.u0 + (i + 0.5) * c, g.v0 + (j + 0.5) * c, C)) out[j * g.nx + i] = 0;
    }
  }
  return out;
}
// A square window of 2r + 1 cells: grown (any in it) or shrunk (all in it),
// along the rows and then the columns.
function sweep(src, g, r, grow){
  const { nx, ny } = g, w = 2 * r + 1;
  const pass = (A, n, m, at) => {
    const B = new Uint8Array(A.length);
    for (let k = 0; k < m; k++) {
      let run = 0;
      const val = (i) => (i < 0 || i >= n ? 0 : A[at(k, i)]);
      for (let i = -r; i <= r; i++) run += val(i);
      for (let i = 0; i < n; i++) {
        B[at(k, i)] = grow ? (run > 0 ? 1 : 0) : (run === w ? 1 : 0);
        run += val(i + r + 1) - val(i - r);
      }
    }
    return B;
  };
  return pass(pass(src, nx, ny, (k, i) => k * nx + i), ny, nx, (k, i) => i * nx + k);
}
const close = (A, g, r) => (r > 0 ? sweep(sweep(A, g, r, true), g, r, false) : A);
const open = (A, g, r) => (r > 0 ? sweep(sweep(A, g, r, false), g, r, true) : A);

// ── outlines from the grid ───────────────────────────────────────────────────
/** The edges round the cells that are in, joined into loops in plan metres:
 *  [{pts, area}] (area > 0 an outline, < 0 a hole in one). Straight runs
 *  are one edge; a slant's stair-steps are straightened (within `eps`, 1.2
 *  cells; 0 keeps every cell's edge). */
export function loopsOf(A, g, eps = 1.2 * g.cell){
  const { nx, ny } = g, at = (i, j) => (i < 0 || j < 0 || i >= nx || j >= ny ? 0 : A[j * nx + i]);
  const from = new Map(), edges = [];
  const key = (i, j) => j * (nx + 1) + i;
  const add = (i0, j0, i1, j1) => { const e = { i0, j0, i1, j1, used: false }; edges.push(e); const k = key(i0, j0); (from.get(k) || from.set(k, []).get(k)).push(e); };
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      if (!at(i, j)) continue;
      if (!at(i, j - 1)) add(i, j, i + 1, j);
      if (!at(i + 1, j)) add(i + 1, j, i + 1, j + 1);
      if (!at(i, j + 1)) add(i + 1, j + 1, i, j + 1);
      if (!at(i - 1, j)) add(i, j + 1, i, j);
    }
  }
  const loops = [];
  for (const e0 of edges) {
    if (e0.used) continue;
    const pts = [];
    let e = e0;
    while (e && !e.used) {
      e.used = true;
      pts.push([e.i0, e.j0]);
      const di = e.i1 - e.i0, dj = e.j1 - e.j0, nexts = (from.get(key(e.i1, e.j1)) || []).filter(n => !n.used);
      // Where two cells touch only at a corner, keep them apart: turn toward the cell.
      e = nexts.find(n => n.i1 - n.i0 === -dj && n.j1 - n.j0 === di) || nexts[0] || null;
    }
    if (pts.length < 4) continue;
    const local = straighten(pts.map(([i, j]) => [g.u0 + i * g.cell, g.v0 + j * g.cell]), eps);
    if (local.length < 3) continue;
    const plan = local.map(([u, v]) => g.toPlan(u, v));
    loops.push({ pts: plan, area: areaOf(plan) });
  }
  return loops;
}
function straighten(P, eps){
  // Corners only, then the stair-steps of a slant pulled straight (Douglas-Peucker).
  const keep = [];
  for (let i = 0; i < P.length; i++) {
    const a = P[(i + P.length - 1) % P.length], b = P[i], c = P[(i + 1) % P.length];
    if (Math.abs((b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0])) > 1e-12) keep.push(b);
  }
  if (keep.length < 4) return keep;
  let far = 0, fd = -1;
  for (let i = 1; i < keep.length; i++) { const d = Math.hypot(keep[i][0] - keep[0][0], keep[i][1] - keep[0][1]); if (d > fd) { fd = d; far = i; } }
  const dp = (Q) => {
    if (Q.length < 3) return Q;
    const a = Q[0], b = Q[Q.length - 1], L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1e-9;
    let k = -1, dmax = -1;
    for (let i = 1; i < Q.length - 1; i++) {
      const d = Math.abs((b[0] - a[0]) * (a[1] - Q[i][1]) - (a[0] - Q[i][0]) * (b[1] - a[1])) / L;
      if (d > dmax) { dmax = d; k = i; }
    }
    if (dmax <= eps) return [a, b];
    const l = dp(Q.slice(0, k + 1)), r = dp(Q.slice(k));
    return l.slice(0, -1).concat(r);
  };
  const one = dp(keep.slice(0, far + 1)), two = dp(keep.slice(far).concat([keep[0]]));
  return one.slice(0, -1).concat(two.slice(0, -1));
}
/** Loops as shapes: each outline with the holes inside it. */
export function shapesOf(loops){
  const outs = loops.filter(l => l.area > 0).map(l => ({ outer: l.pts, holes: [], area: l.area }));
  for (const h of loops.filter(l => l.area < 0)) {
    const o = outs.filter(s => inside(h.pts[0][0], h.pts[0][1], s.outer)).sort((p, q) => p.area - q.area)[0];
    if (o) o.holes.push(h.pts);
  }
  return outs;
}

// ── storeys, their floors and their roofs ────────────────────────────────────
/** The storeys of a house as the view reads it (h: floors, rooms): the
 *  indoor floors at one height, lowest first: {elev, h (the tallest of
 *  them), floors, rooms (indoor rooms only)}. */
export function storeysOf(h){
  const out = [];
  for (const fl of (h && h.floors) || []) {
    if (fl.outdoor) continue;
    let s = out.find(q => Math.abs(q.elev - fl.elev) <= 1e-3);
    if (!s) out.push(s = { elev: fl.elev, h: fl.h, floors: [], rooms: [] });
    s.floors.push(fl);
    s.h = Math.max(s.h, fl.h);
  }
  for (const r of (h && h.rooms) || []) {
    if (r.outdoor || !r.pts || r.pts.length < 3) continue;
    const s = out.find(q => q.floors.includes(r.floor));
    if (s) s.rooms.push(r);
  }
  out.sort((a, b) => a.elev - b.elev);
  return out.filter(s => s.rooms.length);
}
/** Everything the house itself needs drawn, worked out once per shell:
 *  per storey, its floor's shapes (with the stair openings cut out) and its
 *  roof's parts. `cuts`: Map floor id → [convex polygons] (stairCuts). */
export function houseModel(h, cuts = null){
  const st = storeysOf(h);
  const rooms = st.flatMap(s => s.rooms);
  if (!rooms.length) return { axis: 0, storeys: [] };
  const axis = houseAxis(rooms), frame = frameOf(axis);
  const rHall = Math.round(HALL_M / 2 / CELL_M), rRoof = Math.round(ROOF_MIN_M / 2 / CELL_M);
  const g = gridFor(frame, rooms, rHall + rRoof);
  const filled = st.map(s => close(raster(g, s.rooms, null), g, rHall));
  // Top down: what the roofs higher up already cover, with their eaves.
  const roofed = new Uint8Array(g.nx * g.ny), out = new Array(st.length);
  for (let k = st.length - 1; k >= 0; k--) {
    const s = st[k];
    const holes = s.floors.flatMap(fl => (cuts && cuts.get(fl.id)) || []);
    const floorCells = holes.length ? (() => { const A = filled[k].slice(), cut = raster(g, holes.map(C => ({ pts: C })), null); for (let i = 0; i < A.length; i++) if (cut[i]) A[i] = 0; return A; })() : filled[k];
    // The roof: where no storey is above this one. Every bit of it is under
    // a roof — a hipped part, a higher storey's eaves, or where neither
    // reaches (a slanted wall's wedge, a sliver) a flat lid at the walls' tops.
    const roofCells = filled[k].slice();
    for (let m = k + 1; m < st.length; m++) for (let i = 0; i < roofCells.length; i++) if (filled[m][i]) roofCells[i] = 0;
    const parts = rectsOf(close(roofCells, g, 2), g, roofed);
    const bare = roofCells.map((v, i) => (v && !roofed[i] ? 1 : 0));
    out[k] = { elev: s.elev, h: s.h, top: s.elev + s.h, floors: s.floors.map(f => f.id), shapes: shapesOf(loopsOf(floorCells, g)), roof: parts,
               lids: shapesOf(loopsOf(bare, g, 0)), cells: filled[k], roofCells };
  }
  return { axis, grid: { u0: g.u0, v0: g.v0, nx: g.nx, ny: g.ny, cell: g.cell }, frame, storeys: out };
}
/** Is plan point (x, y) under a roof shown over storey `s` or one above it? */
export function underRoof(model, x, y, elev){
  const g = model && model.grid;
  if (!g) return false;
  const [u, v] = model.frame.toLocal([x, y]), i = Math.floor((u - g.u0) / g.cell), j = Math.floor((v - g.v0) / g.cell);
  if (i < 0 || j < 0 || i >= g.nx || j >= g.ny) return false;
  return model.storeys.some(s => s.elev >= elev - 1e-3 && s.roofCells[j * g.nx + i]);
}
/** Is the point at plan (x, y), `h` metres up, under a roof: in a roofed
 *  part of a storey whose roof is no lower than it? */
export function underRoofAt(model, x, y, h){
  const g = model && model.grid;
  if (!g) return false;
  const [u, v] = model.frame.toLocal([x, y]), i = Math.floor((u - g.u0) / g.cell), j = Math.floor((v - g.v0) / g.cell);
  if (i < 0 || j < 0 || i >= g.nx || j >= g.ny) return false;
  return model.storeys.some(s => s.top >= h - 0.05 && s.roofCells[j * g.nx + i]);
}
// Rectangles that cover the cells that are in, each as big as it can be
// (overlapping one another where the shape turns), biggest first: each one
// only if some of it is not yet under a roof — a bigger part's, with its
// eaves, or a higher storey's. `covered`: the cells under a roof so far;
// each part kept adds itself and its eaves to it.
function rectsOf(A, g, covered){
  const { nx, ny } = g, at = (i, j) => i >= 0 && j >= 0 && i < nx && j < ny && A[j * nx + i] === 1;
  const taken = new Uint8Array(A.length), rects = [];
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      if (!at(i, j) || taken[j * nx + i]) continue;
      let i1 = i;
      while (at(i1 + 1, j) && !taken[j * nx + i1 + 1]) i1++;
      let j1 = j;
      const rowFree = (jj) => { for (let x = i; x <= i1; x++) if (!at(x, jj) || taken[jj * nx + x]) return false; return true; };
      while (rowFree(j1 + 1)) j1++;
      for (let y = j; y <= j1; y++) for (let x = i; x <= i1; x++) taken[y * nx + x] = 1;
      rects.push({ i0: i, j0: j, i1, j1 });
    }
  }
  const col = (r, x) => { for (let y = r.j0; y <= r.j1; y++) if (!at(x, y)) return false; return true; };
  const row = (r, y) => { for (let x = r.i0; x <= r.i1; x++) if (!at(x, y)) return false; return true; };
  for (const r of rects) {
    let grew = true;
    while (grew) {
      grew = false;
      if (col(r, r.i0 - 1)) { r.i0--; grew = true; }
      if (col(r, r.i1 + 1)) { r.i1++; grew = true; }
      if (row(r, r.j0 - 1)) { r.j0--; grew = true; }
      if (row(r, r.j1 + 1)) { r.j1++; grew = true; }
    }
  }
  const min = ROOF_MIN_M / g.cell - 1e-6;
  const area = (r) => (r.i1 - r.i0 + 1) * (r.j1 - r.j0 + 1);
  const keep = rects.filter(r => r.i1 - r.i0 + 1 >= min && r.j1 - r.j0 + 1 >= min).sort((a, b) => area(b) - area(a));
  // Biggest first, each only if it roofs what nothing yet does (a tenth of
  // a square metre: a jagged edge's near copies are left out, and its
  // eaves cover their steps).
  const out = [], e = Math.round(EAVE_M / g.cell);
  const least = 0.1 / (g.cell * g.cell);
  for (const r of keep) {
    let fresh = 0;
    for (let y = r.j0; y <= r.j1; y++) for (let x = r.i0; x <= r.i1; x++) if (!covered[y * nx + x]) fresh++;
    if (fresh < least) continue;
    for (let y = Math.max(0, r.j0 - e); y <= Math.min(ny - 1, r.j1 + e); y++) for (let x = Math.max(0, r.i0 - e); x <= Math.min(nx - 1, r.i1 + e); x++) covered[y * nx + x] = 1;
    out.push(r);
    if (out.length >= ROOF_MAX_PARTS) break;
  }
  return out.map(r => ({ u0: g.u0 + r.i0 * g.cell, v0: g.v0 + r.j0 * g.cell, u1: g.u0 + (r.i1 + 1) * g.cell, v1: g.v0 + (r.j1 + 1) * g.cell }));
}
/** A roof's flat lids as triangles, [[x, y] × 3] in plan metres, each
 *  facing up (three.js's ShapeUtils, handed in). */
export function lidTris(lids, THREE){
  const out = [];
  for (const sh of lids || []) {
    const outer = sh.outer.map(p => new THREE.Vector2(p[0], p[1])), holes = sh.holes.map(h => h.map(p => new THREE.Vector2(p[0], p[1])));
    const all = outer.concat(...holes);
    for (const [a, b, c] of THREE.ShapeUtils.triangulateShape(outer, holes)) {
      const A = all[a], B = all[b], C = all[c];
      const up = (B.x - A.x) * (C.y - A.y) - (B.y - A.y) * (C.x - A.x) < 0;   // clockwise on the plan faces up
      out.push(up ? [[A.x, A.y], [B.x, B.y], [C.x, C.y]] : [[A.x, A.y], [C.x, C.y], [B.x, B.y]]);
    }
  }
  return out;
}
/** One part of a roof as triangles, [[x, y, z] × 3] in plan metres with z
 *  above the walls' tops: a hip roof over the rectangle grown by the eaves
 *  (roof), and the band down its edge (fascia). Each triangle faces out. */
export function hipRoof(part, frame){
  const e = EAVE_M, u0 = part.u0 - e, v0 = part.v0 - e, u1 = part.u1 + e, v1 = part.v1 + e;
  const W = u1 - u0, D = v1 - v0, along = W >= D, half = Math.min(W, D) / 2;
  const H = Math.min(ROOF_PITCH * half, ROOF_MAX_H), uc = (u0 + u1) / 2, vc = (v0 + v1) / 2;
  const P = (u, v, z) => { const [x, y] = frame.toPlan(u, v); return [x, y, z]; };
  const roof = [], fascia = [];
  const tri = (list, a, b, c, up) => {
    // Facing out: up for the roof, away from the middle for the band.
    const n = [(b[1] - a[1]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[1] - a[1]), (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]),
               (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])];
    const m = [(a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3], [mx, my] = frame.toPlan(uc, vc);
    // n is worked out in (x, plan y, up) order, which is the 3D view's (x,
    // up, plan y) with two axes swapped: so it is the face's normal reversed,
    // and a face winding out (counter-clockwise seen from outside) has n
    // pointing in.
    const flip = up ? n[2] > 0 : n[0] * (m[0] - mx) + n[1] * (m[1] - my) > 0;
    list.push(flip ? [a, c, b] : [a, b, c]);
  };
  const quad = (list, a, b, c, d, up) => { tri(list, a, b, c, up); tri(list, a, c, d, up); };
  if (along) {
    const r0 = P(u0 + half, vc, H), r1 = P(u1 - half, vc, H);
    quad(roof, P(u0, v0, 0), P(u1, v0, 0), r1, r0, true);
    quad(roof, P(u1, v1, 0), P(u0, v1, 0), r0, r1, true);
    tri(roof, P(u0, v1, 0), P(u0, v0, 0), r0, true);
    tri(roof, P(u1, v0, 0), P(u1, v1, 0), r1, true);
  } else {
    const r0 = P(uc, v0 + half, H), r1 = P(uc, v1 - half, H);
    quad(roof, P(u1, v0, 0), P(u1, v1, 0), r1, r0, true);
    quad(roof, P(u0, v1, 0), P(u0, v0, 0), r0, r1, true);
    tri(roof, P(u0, v0, 0), P(u1, v0, 0), r0, true);
    tri(roof, P(u1, v1, 0), P(u0, v1, 0), r1, true);
  }
  const C = [[u0, v0], [u1, v0], [u1, v1], [u0, v1]];
  for (let i = 0; i < 4; i++) {
    const a = C[i], b = C[(i + 1) % 4];
    quad(fascia, P(a[0], a[1], 0), P(b[0], b[1], 0), P(b[0], b[1], -FASCIA_M), P(a[0], a[1], -FASCIA_M), false);
  }
  return { roof, fascia, height: H };
}

// ── when the roof shows ──────────────────────────────────────────────────────
/** Does the roof show? Only with Roof on Auto, outside Edit and Furnish,
 *  with no floor below the top one picked, the walls Up or Cut, not looking
 *  straight down (Top), and zoomed out past the whole-house fit (radius
 *  against fitR, ROOF_FIT_K). */
export function roofShown(s){
  if (!s || s.setting === "off") return false;
  if (s.editing || s.furnish) return false;
  if (num(s.topElev) !== null && num(s.topStorey) !== null && s.topElev < s.topStorey - 1e-3) return false;
  if (s.wallMode === "down") return false;
  if (!(num(s.phi) !== null && s.phi >= TOP_PHI)) return false;
  return num(s.fitR) !== null && s.fitR > 0 && num(s.radius) !== null && s.radius >= s.fitR * ROOF_FIT_K;
}
/** The fade toward `want` (0 or 1) from k, `dt` ms on: {k, moving}. */
export function roofFade(k, want, dt){
  const step = Math.max(0, num(dt) ?? 0) / ROOF_FADE_MS, to = want ? 1 : 0;
  const next = to > k ? Math.min(to, k + step) : Math.max(to, k - step);
  return { k: next, moving: next !== to };
}
export const roofSetting = (v) => (v === "off" ? "off" : "auto");

// ── stairs ───────────────────────────────────────────────────────────────────
export const isStairs = (p) => !!(p && p.recipe && p.recipe.kind === "stairs");
/** The floor a flight on floor `fromId` reaches, and how far it rises:
 *  the floor named (to_floor) when it is an indoor floor higher up, else the
 *  nearest indoor floor above; none, and it rises its own floor's height.
 *  floors: [{id, elev, h, outdoor}]. {from, to, rise} (to null: none above). */
export function stairReach(fromId, toId, floors){
  const list = (floors || []).filter(f => f && !f.outdoor && num(f.elev) !== null);
  const from = list.find(f => String(f.id) === String(fromId)) || null;
  if (!from) return { from: null, to: null, rise: clamp(2.8, ...STAIR_RISE_M) };
  const up = list.filter(f => f.elev > from.elev + 0.05);
  const named = toId ? up.find(f => String(f.id) === String(toId)) : null;
  const to = named || up.slice().sort((a, b) => a.elev - b.elev)[0] || null;
  const rise = to ? to.elev - from.elev : (num(from.h) ?? 2.8);
  return { from, to, rise: Math.round(clamp(rise, ...STAIR_RISE_M) * 1000) / 1000 };
}
/** The plan corners of a piece's footprint (rotation degrees clockwise on
 *  the plan, 0 facing down it; live_aboard_pieces.js boxOf). */
export function footprint(p, pad = 0){
  const t = (num(p.rotation) ?? 0) * Math.PI / 180, u = [Math.cos(t), Math.sin(t)], v = [-Math.sin(t), Math.cos(t)];
  const r = p.recipe || {}, hw = (num(r.width_m) ?? 1) / 2 + pad, hd = (num(r.depth_m) ?? 1) / 2 + pad;
  const c = [num(p.x_m) ?? 0, num(p.y_m) ?? 0];
  const at = (a, b) => [c[0] + u[0] * a + v[0] * b, c[1] + u[1] * a + v[1] * b];
  return [at(-hw, -hd), at(hw, -hd), at(hw, hd), at(-hw, hd)];
}
/** The openings stairs cut: Map floor id → [the footprints of the stairs
 *  reaching it]. A flight reaches a storey, so its opening is cut in every
 *  indoor floor at the height of the floor it reaches (storeysOf's one
 *  storey). floors: as stairReach; canon: a piece's floor id as the view names it. */
export function stairCuts(pieces, floors, canon = (x) => String(x)){
  const out = new Map();
  for (const p of Object.values(pieces || {})) {
    if (!isStairs(p)) continue;
    const r = stairReach(canon(p.floor_id), p.recipe.params && p.recipe.params.to_floor, floors);
    if (!r.to) continue;
    for (const fl of floors || []) {
      if (!fl || fl.outdoor || num(fl.elev) === null || Math.abs(fl.elev - r.to.elev) > 1e-3) continue;
      const list = out.get(fl.id) || [];
      list.push(footprint(p));
      out.set(fl.id, list);
    }
  }
  return out;
}
/** What of the stairs the walls and floors are drawn from (the shell is
 *  built again when it changes). */
export function stairsSignature(pieces){
  return JSON.stringify(Object.keys(pieces || {}).sort().filter(k => isStairs(pieces[k])).map(k => {
    const p = pieces[k], r = p.recipe;
    return [k, p.floor_id, p.x_m, p.y_m, p.rotation, r.width_m, r.depth_m, r.params && r.params.to_floor];
  }));
}

// ── drawn: the storeys' floors and roofs ─────────────────────────────────────
/**
 * ctx = {THREE (handed in: this file imports nothing), lit(geo, spec, cast,
 *        recv) (the view's own lit mesh, so the floor takes the view's
 *        materials and quality), quality() ("low" | "high"), slabT (the
 *        slab's thickness)}
 * build(h, floorsUi, cuts, look) draws each storey's floor and roof into its
 * first floor's group (so a floor hidden takes them with it) and returns the
 * geometries a rebuild frees; look = {slab, slabSide, roof, fascia} colours.
 * fade(want, now) moves the roof toward shown (or gone) over ROOF_FADE_MS:
 * {moving}; at rest nothing moves, so nothing asks for a frame.
 */
export function createStoreyLayer(ctx){
  const { THREE } = ctx, slabT = num(ctx.slabT) ?? 0.15;
  let model = null, slabs = [], roofs = [], k = null, want = false, last = 0, moving = false, nightK = 0;
  const mats = {}, roofCol = new THREE.Color("#6f6660");
  // Readable at night, as the rooms' floors are: the roof keeps a little of its own colour.
  const glow = (m) => { m.emissive.copy(roofCol).multiplyScalar(0.5 * nightK); };
  const roofMat = () => {
    const q = ctx.quality && ctx.quality() === "high" ? "high" : "low";
    if (!mats[q]) {
      // Its own material: it fades, so it is see-through, yet still writes depth
      // (its parts overlap where it turns a corner).
      const o = { vertexColors: true, transparent: true, depthWrite: true, side: THREE.DoubleSide, opacity: 1 };
      mats[q] = q === "high" ? new THREE.MeshStandardMaterial({ ...o, roughness: 0.92, metalness: 0 }) : new THREE.MeshLambertMaterial(o);
      glow(mats[q]);
    }
    return mats[q];
  };
  const coloured = (g, top, side) => {
    const n = g.attributes.position.count, col = new Float32Array(n * 3);
    const groups = g.groups.length ? g.groups : [{ start: 0, count: n, materialIndex: 0 }];
    for (const gr of groups) {
      const c = gr.materialIndex === 0 ? top : side;
      for (let v = gr.start; v < Math.min(n, gr.start + gr.count); v++) { col[v * 3] = c.r; col[v * 3 + 1] = c.g; col[v * 3 + 2] = c.b; }
    }
    g.setAttribute("color", new THREE.BufferAttribute(col, 3));
    g.clearGroups();
    return g;
  };
  function paint(){
    const m = roofMat();
    m.opacity = k ?? 0;
    for (const R of roofs) { R.mesh.material = m; R.mesh.visible = (k ?? 0) > 0.001; }
  }
  return {
    build(h, floorsUi, cuts, look){
      const free = [];
      slabs = []; roofs = [];
      model = houseModel(h, cuts);
      const L = look || {};
      const cTop = new THREE.Color(L.slab || "#cfc8b9"), cSide = new THREE.Color(L.slabSide || "#c8b18c");
      const cRoof = new THREE.Color(L.roof || "#6f6660"), cFascia = new THREE.Color(L.fascia || "#e6e0d6");
      roofCol.copy(cRoof);
      for (const m of Object.values(mats)) glow(m);
      for (const s of model.storeys) {
        const F = (floorsUi || []).find(G => s.floors.includes(G.fl.id) && G.group);
        if (!F) continue;
        // The floor under the whole storey: just under the rooms' tiles.
        const shapes = s.shapes.map(sh => {
          const S = new THREE.Shape(sh.outer.map(p => new THREE.Vector2(p[0], p[1])));
          for (const hole of sh.holes) S.holes.push(new THREE.Path(hole.map(p => new THREE.Vector2(p[0], p[1]))));
          return S;
        });
        if (shapes.length) {
          const g = coloured(new THREE.ExtrudeGeometry(shapes, { depth: slabT - 0.012, bevelEnabled: false }), cTop, cSide);
          g.rotateX(Math.PI / 2);                              // plan (x, y) -> world (x, ·, y); the extrusion goes down
          g.translate(0, s.elev - 0.006, 0);
          free.push(g);
          const mesh = ctx.lit(g, { vc: true, r: 0.95 }, true, true);
          mesh.name = "storey-floor";
          mesh.userData.storey = s.elev;
          F.group.add(mesh);
          slabs.push({ mesh, elev: s.elev, shapes: s.shapes.length, holes: s.shapes.reduce((a, q) => a + q.holes.length, 0) });
        }
        // Its roof, where no storey is above it: one mesh.
        const pos = [], col = [];
        const base = s.top - slabT;
        let tris = 0;
        for (const part of s.roof) {
          const r = hipRoof(part, model.frame);
          for (const [list, c] of [[r.roof, cRoof], [r.fascia, cFascia]]) {
            for (const t of list) for (const p of t) { pos.push(p[0], base + p[2], p[1]); col.push(c.r, c.g, c.b); }
            tris += list.length;
          }
        }
        for (const t of lidTris(s.lids, THREE)) { for (const p of t) { pos.push(p[0], base + LID_UP, p[1]); col.push(cRoof.r, cRoof.g, cRoof.b); } tris++; }
        if (pos.length) {
          const g = new THREE.BufferGeometry();
          g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
          g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
          g.computeVertexNormals();
          free.push(g);
          const mesh = new THREE.Mesh(g, roofMat());
          mesh.name = "roof";
          mesh.castShadow = true; mesh.receiveShadow = true;    // shadows are drawn on High only
          // It never takes a tap (every press is found in lists of its own);
          // only what hides under it asks it (roofs()).
          mesh.renderOrder = 3;
          F.group.add(mesh);
          roofs.push({ mesh, elev: s.elev, parts: s.roof.length, tris });
        }
      }
      paint();
      return free;
    },
    /** The roof's meshes while it shows (what hides a lit motion marker). */
    roofs(){ return (k ?? 0) >= 0.5 ? roofs.map(R => R.mesh).filter(m => m.parent && m.parent.visible) : []; },
    /** How dark it is (0 day, 1 night: the view's nightK). */
    night(n){ nightK = Math.max(0, Math.min(1, Number(n) || 0)); for (const m of Object.values(mats)) glow(m); },
    /** The highest storey's height (null: none). */
    topElev(){ return model && model.storeys.length ? model.storeys[model.storeys.length - 1].elev : null; },
    get moving(){ return moving; },
    get shown(){ return (k ?? 0) > 0.001; },
    fade(w, now){
      want = !!w;
      if (k === null) { k = want ? 1 : 0; moving = false; last = now; paint(); return { moving, crossed: want }; }   // the first look is how it is
      if (!moving) last = now - 16;                          // from rest: one frame's step
      const r = roofFade(k, want, now - last);
      last = now;
      const changed = r.k !== k, crossed = (r.k >= 0.5) !== (k >= 0.5);   // what it hides changes halfway
      k = r.k; moving = r.moving;
      if (changed) paint();
      return { moving, changed, crossed };
    },
    /** Is plan point (x, y) on floor F hidden by the roof showing? */
    covers(F, x, y){ return (k ?? 0) >= 0.5 && !!F && !F.fl.outdoor && underRoof(model, x, y, F.fl.elev); },
    /** Is the point at plan (x, y), `h` metres up, under the roof showing? */
    hides(x, y, h){ return (k ?? 0) >= 0.5 && underRoofAt(model, x, y, h); },
    state(){
      return { axis: model ? model.axis : null, k, want, moving,
               storeys: model ? model.storeys.map(s => ({ elev: s.elev, floors: s.floors, shapes: s.shapes.length, roofParts: s.roof.length, lids: s.lids.length })) : [],
               slabs: slabs.map(S => ({ elev: S.elev, shapes: S.shapes, holes: S.holes, shown: !!(S.mesh.parent && S.mesh.parent.visible) })),
               roofs: roofs.map(R => ({ elev: R.elev, parts: R.parts, tris: R.tris, visible: R.mesh.visible, opacity: R.mesh.material.opacity,
                                        shadow: R.mesh.castShadow })) };
    },
    /** The ground plan's own: is (x, y) inside storey `elev`'s floor? (tests, and the harness) */
    floorAt(elev, x, y){
      const s = model && model.storeys.find(q => Math.abs(q.elev - elev) <= 1e-3);
      return !!s && s.shapes.some(sh => inside(x, y, sh.outer) && !sh.holes.some(hh => inside(x, y, hh)));
    },
    dispose(){ for (const m of Object.values(mats)) m.dispose(); slabs = []; roofs = []; model = null; },
  };
}
