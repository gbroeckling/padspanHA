// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
// See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
//
// Live Aboard, the 3D house (docs/IDEA_ATLAS_3D_HOUSE.md): furniture's rules,
// as plain numbers (P2 Furnish). No three.js, no page: the Furnish tool
// (live_aboard_furnish.js) and the view call these, and node runs them for
// real (tests/js/live_aboard_pieces.mjs).
//
// A piece (house3d_store.py, contracts §2) stands on a floor at x_m, y_m in
// fabric metres (y runs DOWN the plan, as drawn), z_m is its bottom above
// that floor, and rotation is degrees clockwise on the plan as drawn: 0 faces
// down the plan (+y), 90 faces left (-x). Its recipe's width runs across it,
// its depth from back to front.
//
// The walls here are the 3D view's own wall pieces (live_aboard_house.js
// deriveWalls, with the 3D file's doors and windows cut in), each with the
// parts it is drawn as (wallElements): {x0, y0, x1, y1, thick, kind, els:
// [{z0, z1, glass, leaf}]}. A door's leaf swings open, so it is no wall; a
// window's glass is.

export const PIECE_ID = /^fur_[0-9a-f]{8}$/;
export const ORIGINS = ["build", "photo", "library", "import"];
export const TURN_STEP = 15;               // Turn ⟲ / ⟳
export const SNAP_M = 0.25;                // a wall this near takes a dragged piece's back
export const CLEAR_M = 0.5;                // kept free before a wardrobe's doors, beside a bed
export const HEAD_END_M = 0.6;             // a bed's sides start this far from its head (bedside tables go there)
export const FLAT_M = 0.05;                // a piece this thin (a rug: the server's least height) overlaps nothing
export const TOL_M = 0.01;                 // touching is not overlapping
export const SIZE_MIN_M = 0.05, SIZE_MAX_M = 8, Z_MAX_M = 20;   // the server's ranges (house3d_store.py)
export const Z_STEP_M = 0.01;
const FRONT_KIND = /wardrobe|dresser|cabinet|drawer|armoire|chest/i;
const BED_KIND = /bed|crib|cot/i;

const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const mm = (v) => Math.round(v * 1000) / 1000;
const copy = (x) => JSON.parse(JSON.stringify(x));

/** A fresh id for a piece: "fur_" and 8 hex digits. */
export function newPieceId(rand){
  const r = typeof rand === "function" ? rand
    : (globalThis.crypto && globalThis.crypto.getRandomValues
      ? () => globalThis.crypto.getRandomValues(new Uint8Array(1))[0] / 256 : Math.random);
  let hex = "";
  for (let i = 0; i < 8; i++) hex += Math.floor(r() * 16).toString(16);
  return `fur_${hex}`;
}

// ── turning ──────────────────────────────────────────────────────────────────
/** Degrees in [0, 360), to the thousandth (as the server keeps it). */
export function normRot(deg){
  const d = num(deg) ?? 0;
  const r = mm(((d % 360) + 360) % 360);
  return r >= 360 ? 0 : r + 0;
}
/** Turned one step clockwise (dir 1) or anticlockwise (-1), onto the next
 *  multiple of 15° that way (a piece turned to a slanted wall comes back
 *  onto the steps). */
export function turned(rot, dir){
  const r = normRot(rot), s = dir < 0 ? -1 : 1, k = r / TURN_STEP;
  const onStep = Math.abs(k - Math.round(k)) < 1e-6;
  const next = onStep ? Math.round(k) + s : (s > 0 ? Math.ceil(k) : Math.floor(k));
  return normRot(next * TURN_STEP);
}
/** Which way the front faces on the plan, and the way across it (its width). */
export const frontOf = (rot) => { const t = normRot(rot) * Math.PI / 180; return [-Math.sin(t), Math.cos(t)]; };
export const acrossOf = (rot) => { const t = normRot(rot) * Math.PI / 180; return [Math.cos(t), Math.sin(t)]; };
/** The rotation whose front faces plan direction (fx, fy). */
export const rotFacing = (fx, fy) => normRot(Math.atan2(-fx, fy) * 180 / Math.PI);
/** The 3D view's yaw for a rotation (three.js turns anticlockwise seen from
 *  above; the plan's y runs down). */
export const yawOfRot = (rot) => -normRot(rot) * Math.PI / 180;

// ── size and height ─────────────────────────────────────────────────────────
/** A recipe's width, depth and height, kept in the server's range. */
export function sizeOf(recipe){
  const r = recipe && typeof recipe === "object" ? recipe : {};
  const one = (v, d) => clamp(num(v) ?? d, SIZE_MIN_M, SIZE_MAX_M);
  return { w: one(r.width_m, 0.5), d: one(r.depth_m, 0.5), h: one(r.height_m, 0.5) };
}
/** The highest a piece's bottom may go in a room `ceil` metres tall, so its
 *  top stays under the ceiling (0 when it is taller than the room). */
export const zMax = (ceil, h) => mm(Math.max(0, Math.min(Z_MAX_M, (num(ceil) ?? 2.65) - (num(h) ?? 0))));
export const clampZ = (z, ceil, h) => mm(clamp(num(z) ?? 0, 0, zMax(ceil, h)));

// ── floors ───────────────────────────────────────────────────────────────────
/** The floor above (dir 1) or below (-1) floor `fid`: the nearest by height
 *  among floors higher (lower) than it, an indoor one before an outdoor one
 *  at the same height. null at the top (bottom), or for a floor not there. */
export function floorStep(floors, fid, dir){
  const list = (floors || []).filter(f => f && f.id !== undefined && num(f.elev) !== null);
  const cur = list.find(f => String(f.id) === String(fid));
  if (!cur) return null;
  const s = dir < 0 ? -1 : 1;
  const cands = list.filter(f => s * (f.elev - cur.elev) > 1e-3)
    .sort((a, b) => Math.abs(a.elev - cur.elev) - Math.abs(b.elev - cur.elev) || Number(!!a.outdoor) - Number(!!b.outdoor));
  return cands.length ? String(cands[0].id) : null;
}

// ── the footprint ────────────────────────────────────────────────────────────
/** A piece's footprint on the plan: centre, its two axes, half its width and depth. */
export function boxOf(p, size){
  const s = size || sizeOf(p && p.recipe);
  return { c: [num(p && p.x_m) ?? 0, num(p && p.y_m) ?? 0], u: acrossOf(p && p.rotation), v: frontOf(p && p.rotation),
           hu: s.w / 2, hv: s.d / 2, z0: num(p && p.z_m) ?? 0, z1: (num(p && p.z_m) ?? 0) + s.h };
}
/** Its four corners: back left, back right, front right, front left. */
export function cornersOf(b){
  const at = (a, c) => [b.c[0] + b.u[0] * a + b.v[0] * c, b.c[1] + b.u[1] * a + b.v[1] * c];
  return [at(-b.hu, -b.hv), at(b.hu, -b.hv), at(b.hu, b.hv), at(-b.hu, b.hv)];
}
/** A wall piece as a box on the plan (its centre line, half its thickness). */
function wallBox(w){
  const dx = w.x1 - w.x0, dy = w.y1 - w.y0, len = Math.hypot(dx, dy) || 1e-9;
  return { c: [(w.x0 + w.x1) / 2, (w.y0 + w.y1) / 2], u: [dx / len, dy / len], v: [-dy / len, dx / len],
           hu: len / 2, hv: (num(w.thick) ?? 0.1) / 2, len };
}
/** Do two boxes on the plan overlap by more than `tol` (separating axes)? */
export function boxesOverlap(a, b, tol = TOL_M){
  const d = [b.c[0] - a.c[0], b.c[1] - a.c[1]];
  const dot = (p, q) => p[0] * q[0] + p[1] * q[1];
  for (const ax of [a.u, a.v, b.u, b.v]) {
    const ra = a.hu * Math.abs(dot(a.u, ax)) + a.hv * Math.abs(dot(a.v, ax));
    const rb = b.hu * Math.abs(dot(b.u, ax)) + b.hv * Math.abs(dot(b.v, ax));
    if (Math.abs(dot(d, ax)) >= ra + rb - tol) return false;
  }
  return true;
}
const spansOverlap = (a0, a1, b0, b1, tol = TOL_M) => Math.min(a1, b1) - Math.max(a0, b0) > tol;
/** Is plan point q inside box b (shrunk by tol)? */
function inBox(b, q, tol = TOL_M){
  const d = [q[0] - b.c[0], q[1] - b.c[1]];
  return Math.abs(d[0] * b.u[0] + d[1] * b.u[1]) < b.hu - tol && Math.abs(d[0] * b.v[0] + d[1] * b.v[1]) < b.hv - tol;
}
const isFlat = (b) => b.z1 - b.z0 <= FLAT_M + 1e-9;
/** The solid parts of a wall piece (a door's leaf opens: not solid). */
const solidParts = (w) => (w.els || []).filter(e => !(e.leaf && !e.glass));

// ── placing ──────────────────────────────────────────────────────────────────
function inPoly(x, y, P){
  let c = false;
  for (let i = 0, j = P.length - 1; i < P.length; j = i++) {
    const [xi, yi] = P[i], [xj, yj] = P[j];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c;
  }
  return c;
}
function segFoot(x, y, a, b){
  const dx = b[0] - a[0], dy = b[1] - a[1], L2 = dx * dx + dy * dy;
  const t = L2 ? clamp(((x - a[0]) * dx + (y - a[1]) * dy) / L2, 0, 1) : 0;
  const fx = a[0] + dx * t, fy = a[1] + dy * t;
  return { d: Math.hypot(x - fx, y - fy), fx, fy, ux: dx / (Math.sqrt(L2) || 1), uy: dy / (Math.sqrt(L2) || 1) };
}
/** Where a new piece goes on a floor whose rooms are `rooms` ({pts, spot:
 *  {x, y}, outdoor}), with the view centred on (x, y): there when that is
 *  in a room, else at the nearest indoor room's name spot. It faces into
 *  the room: away from the room's nearest wall. {x, y, rotation, room}. */
export function spotFor(rooms, x, y){
  const list = (rooms || []).filter(r => r && Array.isArray(r.pts) && r.pts.length >= 3);
  const indoor = list.filter(r => !r.outdoor);
  let room = indoor.find(r => inPoly(x, y, r.pts)) || list.find(r => inPoly(x, y, r.pts)) || null;
  let at = [x, y];
  if (!room) {
    const pool = indoor.length ? indoor : list;
    let best = Infinity;
    for (const r of pool) {
      const s = r.spot || { x: r.pts[0][0], y: r.pts[0][1] };
      const dd = Math.hypot(s.x - x, s.y - y);
      if (dd < best) { best = dd; room = r; at = [s.x, s.y]; }
    }
  }
  if (!room) return { x: mm(x), y: mm(y), rotation: 0, room: null };
  // The nearest edge, and its normal into the room.
  let near = null;
  for (let i = 0; i < room.pts.length; i++) {
    const f = segFoot(at[0], at[1], room.pts[i], room.pts[(i + 1) % room.pts.length]);
    if (!near || f.d < near.d) near = f;
  }
  let n = [-near.uy, near.ux];
  if (!inPoly(near.fx + n[0] * 0.05, near.fy + n[1] * 0.05, room.pts)) n = [-n[0], -n[1]];
  return { x: mm(at[0]), y: mm(at[1]), rotation: rotFacing(n[0], n[1]), room };
}
/** A new piece of `recipe` on floor `floorId` at a spot (spotFor). */
export function makePiece(recipe, floorId, spot, origin = "build", rand){
  return { id: newPieceId(rand), recipe: copy(recipe), origin: ORIGINS.includes(origin) ? origin : "build", label: "",
           library_id: null, submission_id: null, floor_id: String(floorId), x_m: mm(num(spot && spot.x) ?? 0),
           y_m: mm(num(spot && spot.y) ?? 0), z_m: 0, rotation: normRot(spot && spot.rotation), entity_id: null, entity_reg_id: null };
}
/** A copy beside the piece: a new id, a little along and down the plan,
 *  bound to no device and shared nowhere (it is not the shared one). */
export function duplicateOf(p, rand){
  const out = copy(p);
  out.id = newPieceId(rand);
  out.x_m = mm((num(p.x_m) ?? 0) + 0.3); out.y_m = mm((num(p.y_m) ?? 0) + 0.3);
  out.entity_id = null; out.entity_reg_id = null; out.submission_id = null;
  delete out.updated_at;
  return out;
}

// ── snapping to walls ───────────────────────────────────────────────────────
/** Held within SNAP_M of a wall, at any angle, a dragged piece goes back
 *  flush against it, turned to face away from it: only a wall that is solid
 *  for the piece's whole height there (a low sofa under a window's sill
 *  snaps; nothing snaps into a doorway). {x_m, y_m, rotation, wall} or null. */
export function snapToWall(p, size, walls, reach = SNAP_M){
  const b = boxOf(p, size);
  let best = null;
  for (let i = 0; i < (walls || []).length; i++) {
    const w = walls[i], wb = wallBox(w);
    if (!(wb.len > 0.2)) continue;
    const solid = solidParts(w).filter(e => !e.glass);
    if (!solid.some(e => e.z0 <= b.z0 + TOL_M && e.z1 >= b.z1 - TOL_M)) continue;
    const d = [b.c[0] - wb.c[0], b.c[1] - wb.c[1]];
    const along = d[0] * wb.u[0] + d[1] * wb.u[1], off = d[0] * wb.v[0] + d[1] * wb.v[1];
    if (Math.abs(along) > wb.hu) continue;                       // its centre beside the wall's length
    const side = off >= 0 ? 1 : -1, gap = Math.abs(off) - wb.hv - b.hv;
    if (gap > reach || gap < -b.hv - wb.hv) continue;
    if (!best || Math.abs(gap) < Math.abs(best.gap)) best = { i, wb, side, along, gap };
  }
  if (!best) return null;
  const { wb, side, along } = best, n = [wb.v[0] * side, wb.v[1] * side], o = wb.hv + b.hv;
  return { x_m: mm(wb.c[0] + wb.u[0] * along + n[0] * o), y_m: mm(wb.c[1] + wb.u[1] * along + n[1] * o),
           rotation: rotFacing(n[0], n[1]), wall: best.i };
}

// ── fit checks: warnings, never blocks ───────────────────────────────────────
/** The doors among a floor's wall pieces, as the quarter circle each sweeps
 *  (the editor draws the same arcs): swingOf(pc) is the view's own
 *  HOUSE.openingSwing for it ({hinge: "a" | "b", side}). A door over 1.8 m
 *  is a garage's, which rolls up. */
export function doorSwings(walls, swingOf){
  const out = [];
  for (const w of walls || []) {
    if (w.kind !== "door") continue;
    const len = Math.hypot(w.x1 - w.x0, w.y1 - w.y0);
    if (len < 0.3 || len > 1.8) continue;
    const sw = swingOf(w) || { hinge: "a", side: 1 }, hb = sw.hinge === "b";
    const hx = hb ? w.x1 : w.x0, hy = hb ? w.y1 : w.y0;
    const leaf = (w.els || []).find(e => e.leaf && !e.glass);
    out.push({ hx, hy, ux: ((hb ? w.x0 : w.x1) - hx) / len, uy: ((hb ? w.y0 : w.y1) - hy) / len,
               sx: w.nx * sw.side, sy: w.ny * sw.side, r: len, head: leaf ? leaf.z1 : 2.03 });
  }
  return out;
}
function inSwing(dr, q){
  const d = [q[0] - dr.hx, q[1] - dr.hy];
  return Math.hypot(d[0], d[1]) < dr.r - TOL_M && d[0] * dr.ux + d[1] * dr.uy > TOL_M && d[0] * dr.sx + d[1] * dr.sy > TOL_M;
}
function swingHits(dr, b){
  const pts = cornersOf(b);
  for (let i = 0; i < 4; i++) { const a = pts[i], c = pts[(i + 1) % 4]; pts.push([(a[0] + c[0]) / 2, (a[1] + c[1]) / 2]); }
  pts.push(b.c);
  if (pts.some(q => inSwing(dr, q))) return true;
  const arc = [[dr.hx, dr.hy]];
  for (let k = 0; k <= 8; k++) {
    const t = k / 8 * Math.PI / 2, cx = Math.cos(t), sx = Math.sin(t);
    for (const f of [0.5, 0.97]) arc.push([dr.hx + (dr.ux * cx + dr.sx * sx) * dr.r * f, dr.hy + (dr.uy * cx + dr.sy * sx) * dr.r * f]);
  }
  return arc.some(q => inBox(b, q));
}
/** Where a piece must leave room: before a wardrobe's or a dresser's front,
 *  beside a bed (from its foot to HEAD_END_M short of its head). */
function clearZones(p, b){
  const kind = String((p.recipe && p.recipe.kind) || "");
  if (FRONT_KIND.test(kind)) {
    return [{ c: [b.c[0] + b.v[0] * (b.hv + CLEAR_M / 2), b.c[1] + b.v[1] * (b.hv + CLEAR_M / 2)], u: b.u, v: b.v, hu: b.hu, hv: CLEAR_M / 2, what: "front" }];
  }
  if (BED_KIND.test(kind)) {
    const len = Math.max(0.2, 2 * b.hv - HEAD_END_M), mid = b.hv - len / 2;   // towards the foot (the front)
    return [-1, 1].map(s => ({ c: [b.c[0] + b.u[0] * s * (b.hu + CLEAR_M / 2) + b.v[0] * mid, b.c[1] + b.u[1] * s * (b.hu + CLEAR_M / 2) + b.v[1] * mid],
                               u: b.u, v: b.v, hu: CLEAR_M / 2, hv: len / 2, what: "side" }));
  }
  return [];
}
/** What is wrong with where piece `p` stands, as a list of
 *  {kind, with?}: "wall" (into a wall), "overlap" (another piece, its box
 *  in 3D, height and all), "door" (in a door's swing), "blocks" (before a
 *  wardrobe's or dresser's front, or a bed's side: `with` is that piece,
 *  `what` "front" or "side"), "blocked" (the same, the other way round),
 *  "window" (taller than a window's sill, in front of it). scene = {walls,
 *  doors: [{hx, hy, ux, uy, sx, sy, r, head}] (hinge, along the shut door,
 *  towards the side it opens, its width), others: [pieces on the same floor]}. */
export function fitChecks(p, scene){
  const out = [], b = boxOf(p), sc = scene || {};
  if (isFlat(b)) return out;                                   // a rug lies under things
  for (const w of sc.walls || []) {
    const wb = wallBox(w);
    if (!boxesOverlap(b, wb)) continue;
    if (solidParts(w).some(e => spansOverlap(b.z0, b.z1, e.z0, e.z1))) { out.push({ kind: "wall" }); break; }
  }
  for (const o of sc.others || []) {
    if (!o || o.id === p.id) continue;
    const ob = boxOf(o);
    if (isFlat(ob)) continue;
    if (boxesOverlap(b, ob) && spansOverlap(b.z0, b.z1, ob.z0, ob.z1)) out.push({ kind: "overlap", with: o.id });
    for (const z of clearZones(o, ob)) {
      if (boxesOverlap(b, z) && spansOverlap(b.z0, b.z1, ob.z0, ob.z1)) { out.push({ kind: "blocks", with: o.id, what: z.what }); break; }
    }
    for (const z of clearZones(p, b)) {
      if (boxesOverlap(ob, z) && spansOverlap(ob.z0, ob.z1, b.z0, b.z1)) { out.push({ kind: "blocked", with: o.id, what: z.what }); break; }
    }
  }
  for (const dr of sc.doors || []) {
    if (b.z0 < (num(dr.head) ?? 2.03) && swingHits(dr, b)) { out.push({ kind: "door" }); break; }
  }
  for (const w of sc.walls || []) {
    if (w.kind !== "window") continue;
    const pane = (w.els || []).find(e => e.glass);
    if (!pane || !(b.z1 > pane.z0 + TOL_M && b.z0 < pane.z1)) continue;
    const wb = wallBox(w), zone = { ...wb, hv: wb.hv + 0.35 };
    if (boxesOverlap(b, zone)) { out.push({ kind: "window" }); break; }
  }
  return out;
}
