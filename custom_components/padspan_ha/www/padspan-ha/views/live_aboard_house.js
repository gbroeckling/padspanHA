// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
// See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
//
// Live Aboard, the 3D house (docs/IDEA_ATLAS_3D_HOUSE.md): the house read
// from the map people already drew, as plain numbers. Floors at their real
// heights, the rooms, walls derived from the room outlines with the barriers
// spliced in, the whole-house cut-away rule, the quality pick, and every
// light's fixture by its Atlas shape. Nothing here imports three.js: the 3D
// view (live_aboard.js) turns this into meshes, and the tests run it under
// node.
//
// Coordinates are PadSpan's: plan metres (x_m, y_m) on a floor, heights in
// metres above that floor's walking surface. The 3D view puts plan (x, y) at
// world (x, ·, y), so plan x runs right and plan y down, as on the flat plan.
// Nothing here writes anything: the map, the rooms, the walls and the light
// positions are read, never changed.
//
// The live parts (part B) read the house's states the way the flat Atlas
// does, with the Atlas's own functions wherever it has one: a linked door,
// window or lock (barrierNoReading and the barrier pass), motion and air
// (the Motion · Air colours and timing), and the readouts (stateWordOf).

const { isOutdoorFloorId, offsetPolygonInward, barrierNoReading, fabricFrame, floorIdAtLevel, floorNameAtLevel } =
  await import(`./iso_lights.js${new URL(import.meta.url).search}`);
const { castsLight, deviceClassOf, airQualityBadness, HUMIDITY_BORDER, AIR_BORDER, MOTION_PULSE: MOTION_BLUE, isWledLight, isPartitionLight } =
  await import(`./light_codes.js${new URL(import.meta.url).search}`);
// The shared Atlas card's readings: the state words and which floors share a plate.
const { stateWordOf, floorIdsOnSlab } =
  await import(`./lights_map.js${new URL(import.meta.url).search}`);
const { roomColor } =
  await import(`./room_color.js${new URL(import.meta.url).search}`);
// Which way north is (settings.fabric_bearing_deg, y-down): the one source.
const COMPASS = await import(`./fabric_compass.js${new URL(import.meta.url).search}`);
// The 3D editor's rules: the defaults and the limits a door, a window and a
// device are drawn within are theirs (the editor's sliders offer the same).
const DRAFT = await import(`./live_aboard_draft.js${new URL(import.meta.url).search}`);
export const { normBearing, fabricCompass, bearingOfNorth, compassDir, northArrowDeg } = COMPASS;

// ── The usage report's words (telemetry.py HOUSE3D_EVENTS holds the same) ────
// house3d_opened: the 3D view showed on a screen. house3d_fallback:<kind>: it
// could not, and the flat Atlas showed instead. Counted once per page load per
// name, and only ever while the feature is on (the host passes no sender
// otherwise). Words only: never an entity id, a room or a floor.
export const HOUSE3D_FALLBACK_KINDS = ["no_webgl", "slow_gpu", "context_lost", "error"];
export const HOUSE3D_EVENTS = ["house3d_opened", ...HOUSE3D_FALLBACK_KINDS.map(k => `house3d_fallback:${k}`)];
const _ALLOWED = new Set(HOUSE3D_EVENTS);
const _counted = new Set();
/** Count `name` once per page load, and only a name from the closed list. */
export function countHouse3dOnce(name, send){
  if (!_ALLOWED.has(name) || _counted.has(name)) return false;
  _counted.add(name);
  try { if (typeof send === "function") send(name); } catch (_) { /* the report must never be the error */ }
  return true;
}
export function _resetHouse3dCountsForTests(){ _counted.clear(); }

// ── Tunables (metres) ────────────────────────────────────────────────────────
export const FLOOR_TO_FLOOR_M = 2.8;      // the Floor Heights table's blank (maps.js)
export const SLAB_T = 0.15;               // the slab under every room tile
const SHARE_TOL = 0.65;                   // two facing room edges this close are ONE wall (the gap is its thickness)
const SHARE_COS = Math.cos(6 * Math.PI / 180);   // ...and no more than 6° apart
const BEHIND = 2.0;                       // a lone edge with an indoor room this close behind it is an inside wall
export const EXT_T = 0.14;                // outside wall thickness
const MIN_T = 0.10;                       // the thinnest shared wall
export const CUT_H = 0.42;                // what is left of a wall that is cut away
const BAR_TOL = 0.40, BAR_COS = Math.cos(8 * Math.PI / 180);   // a barrier this close to a wall's line replaces that stretch
export const DOOR_H = DRAFT.DOOR_HEAD_M, SILL_H = DRAFT.WINDOW_SILL_M, HEAD_H = DRAFT.WINDOW_HEAD_M, RAIL_H = 1.0;
// A room on an indoor floor that is really outdoors (no walls, a rail if raised).
const OUTDOOR_ROOM = /\b(deck|patio|porch|balcony|terrace|veranda|yard|garden|lawn|driveway|outside|outdoor)\b/i;
const WALL_EXT = "#d6cfc2", WALL_INT = "#ebe6dd", DOOR_COL = "#8b6a4f", GARAGE_DOOR_COL = "#c3c9d0";
const RAIL_COL = "#6a6157", RAIL_GLASS = "#c9d6de", WINDOW_GLASS = "#9fd2f2";
// rf_barriers_m materials that tint a solid wall (glass and open are openings).
const MAT_TINT = { metal: "#9eabb6", concrete: "#aaa69d", brick: "#a8644c", stone: "#9d978b", wood: "#a37c58", tile: "#b9b4aa" };

// ── Small helpers ────────────────────────────────────────────────────────────
const num = (v) => (v === null || v === undefined || v === "" || typeof v === "boolean" ? null
  : (Number.isFinite(Number(v)) ? Number(v) : null));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const unit = (v) => { const l = Math.hypot(v[0], v[1]) || 1; return [v[0] / l, v[1] / l]; };
const perp = (v) => [-v[1], v[0]];
/** A plan direction as a turn about the vertical (the 3D view's yaw). */
export const yawOf = (v) => Math.atan2(-v[1], v[0]);

export function signedArea(P){
  let s = 0;
  for (let i = 0; i < P.length; i++) { const a = P[i], b = P[(i + 1) % P.length]; s += a[0] * b[1] - b[0] * a[1]; }
  return s / 2;
}
export function inPoly(x, y, P){
  let c = false;
  for (let i = 0, j = P.length - 1; i < P.length; j = i++) {
    const a = P[i], b = P[j];
    if ((a[1] > y) !== (b[1] > y) && x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0]) c = !c;
  }
  return c;
}
/** [distance from (x, y) to the segment a-b, where along it (0..1)]. */
export function segDist(x, y, ax, ay, bx, by){
  const dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy;
  const t = L2 ? clamp(((x - ax) * dx + (y - ay) * dy) / L2, 0, 1) : 0;
  return [Math.hypot(x - ax - dx * t, y - ay - dy * t), t];
}
/** A hand-drawn outline made usable: numbers only, no doubled points, no
 *  closing point, and counter-clockwise, so each edge's outward normal is
 *  (dy, -dx). */
export function cleanPoly(raw){
  const out = [];
  for (const p of raw || []) {
    if (!Array.isArray(p) || num(p[0]) === null || num(p[1]) === null) continue;
    const q = [Number(p[0]), Number(p[1])];
    if (!out.length || dist(out[out.length - 1], q) > 0.02) out.push(q);
  }
  while (out.length > 3 && dist(out[0], out[out.length - 1]) < 0.2) out.pop();
  if (signedArea(out) < 0) out.reverse();
  return out;
}
/** Where a room's name goes: the inside point farthest from every edge, and
 *  that distance (so a long name in a small room can be drawn smaller). */
export function labelSpot(P){
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of P) { x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]); x1 = Math.max(x1, p[0]); y1 = Math.max(y1, p[1]); }
  const step = Math.max(0.1, Math.min(x1 - x0, y1 - y0) / 30);
  let best = { x: (x0 + x1) / 2, y: (y0 + y1) / 2, r: 0.3 };
  for (let x = x0 + step / 2; x < x1; x += step) {
    for (let y = y0 + step / 2; y < y1; y += step) {
      if (!inPoly(x, y, P)) continue;
      let r = Infinity;
      for (let i = 0; i < P.length; i++) { const a = P[i], b = P[(i + 1) % P.length]; r = Math.min(r, segDist(x, y, a[0], a[1], b[0], b[1])[0]); }
      if (r > best.r) best = { x, y, r };
    }
  }
  return best;
}
function circlePoly(cx, cy, r, n = 24){
  const out = [];
  for (let i = 0; i < n; i++) { const a = i / n * Math.PI * 2; out.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]); }
  return out;
}

// ── Floors ───────────────────────────────────────────────────────────────────
// Stacked at their real heights: the backend's floor_elevations (an explicit
// base_elevation_m wins there, else the running sum of floor_to_floor_m, and
// floors on one storey share a base — model_store.floor_base_elevations_m).
// A floor it does not know (an older backend, a floor only the fabric names)
// stacks on the ones before it; an outdoor one sits at the lowest indoor
// floor. The fabric's "__outside__" is the registry's "outside" when there
// is one (the same rule as fabricFrame and floorIdAtLevel).
export function floorCanon(floorList){
  const ids = new Set((floorList || []).map(f => String(f && f.id)));
  return (id) => {
    const s = String(id || "main");
    return s === "__outside__" && ids.has("outside") ? "outside" : s;
  };
}
export function readFloors(model, floorList){
  const reg = Array.isArray(floorList) && floorList.length ? floorList : ((model && model.floors) || []);
  const canon = floorCanon(reg);
  const elev = (model && model.floor_elevations) || {};
  const floors = [], byId = new Map();
  const add = (raw, id) => {
    if (!id || byId.has(id)) return;
    const f = {
      id, name: String((raw && raw.name) || id),
      elev: num(elev[id]) ?? num(raw && raw.base_elevation_m),
      h: num(raw && raw.floor_to_floor_m) ?? FLOOR_TO_FLOOR_M,
      outdoor: isOutdoorFloorId(id),
    };
    if (!(f.h > 0.5)) f.h = FLOOR_TO_FLOOR_M;
    floors.push(f); byId.set(id, f);
  };
  for (const f of reg) if (f && f.id !== undefined && f.id !== null) add(f, String(f.id));
  for (const g of Object.values((model && model.room_geometry_m) || {})) if (g && typeof g === "object") add({ id: canon(g.floor_id) }, canon(g.floor_id));
  for (const lp of Object.values((model && model.light_positions_m) || {})) if (lp && typeof lp === "object") add({ id: canon(lp.floor_id) }, canon(lp.floor_id));
  let run = 0;
  for (const f of floors) {
    if (f.outdoor) continue;
    if (f.elev === null) f.elev = run;
    run = Math.max(run, f.elev + f.h);
  }
  const indoor = floors.filter(f => !f.outdoor && f.elev !== null).map(f => f.elev);
  const ground = indoor.length ? Math.min(...indoor) : 0;
  for (const f of floors) if (f.elev === null) f.elev = ground;
  floors.sort((a, b) => a.elev - b.elev || Number(a.outdoor) - Number(b.outdoor));
  return { floors, byId, canon, ground };
}

/** The highest walking surface the floor chips leave showing: null for all
 *  floors, else the top of the chosen floor(s). Floors above it are hidden,
 *  as in The Sims. */
export function topFloorElev(floors, topIds){
  if (!topIds) return null;
  const ids = topIds instanceof Set ? topIds : new Set([].concat(topIds).map(String));
  let top = null;
  for (const f of floors || []) if (ids.has(f.id)) top = top === null ? f.elev : Math.max(top, f.elev);
  return top;
}
export function floorShown(floor, topElev){
  return topElev === null || floor.elev <= topElev + 1e-3;
}

// ── Rooms ────────────────────────────────────────────────────────────────────
export function readRooms(model, F){
  const rooms = [];
  let i = 0;
  for (const [name, g] of Object.entries((model && model.room_geometry_m) || {})) {
    if (!g || typeof g !== "object") continue;
    const fl = F.byId.get(F.canon(g.floor_id));
    let raw = null;
    if (g.type === "circle") raw = circlePoly(num(g.cx_m) || 0, num(g.cy_m) || 0, num(g.r_m) || 0.5);
    else if (Array.isArray(g.points_m)) raw = g.points_m;
    const pts = raw ? cleanPoly(raw) : [];
    if (!fl || pts.length < 3) continue;
    rooms.push({ name, floor: fl, pts, idx: i++, color: roomColor(name, model),
                 outdoor: fl.outdoor || OUTDOOR_ROOM.test(name), spot: labelSpot(pts) });
  }
  return rooms;
}
export function roomAt(rooms, x, y){
  for (const r of rooms) if (inPoly(x, y, r.pts)) return r;
  return null;
}

// ── Walls from the room outlines ─────────────────────────────────────────────
// Every room edge is a wall. Two rooms' edges that run along each other,
// facing, within SHARE_TOL, are ONE wall between them: built once, as thick as
// the gap, centred in it. An edge with nothing beside it is an outside wall,
// unless an indoor room (or another wall's thickness — the stub left where two
// hand-drawn rooms meet) lies just behind it, which makes it an inside wall
// along an unmapped hall. Outdoor rooms have no walls of their own, only a
// rail round a raised deck.
function wallPiece(A, p, q, o0, o1, cls, thick, shared){
  return {
    x0: A.a[0] + A.ux * p + A.nx * o0, y0: A.a[1] + A.uy * p + A.ny * o0,
    x1: A.a[0] + A.ux * q + A.nx * o1, y1: A.a[1] + A.uy * q + A.ny * o1,
    nx: A.nx, ny: A.ny, cls, thick, shared, kind: cls === "rail" ? "rail" : "wall", mat: null, barrier: null,
  };
}
export function deriveWalls(floor, rooms, ground){
  const edges = [];
  for (const r of rooms) {
    const P = r.pts;
    for (let i = 0; i < P.length; i++) {
      const a = P[i], b = P[(i + 1) % P.length], dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy);
      if (L >= 0.03) edges.push({ room: r, a, b, L, ux: dx / L, uy: dy / L, nx: dy / L, ny: -dx / L });
    }
  }
  const out = [];
  for (const A of edges) {
    // Every stretch of A that another room's edge runs along, facing it.
    const ivs = [];
    for (const B of edges) {
      if (B.room === A.room || A.nx * B.nx + A.ny * B.ny > -SHARE_COS) continue;
      const rel = (p) => [(p[0] - A.a[0]) * A.ux + (p[1] - A.a[1]) * A.uy, (p[0] - A.a[0]) * A.nx + (p[1] - A.a[1]) * A.ny];
      const [ta, sa] = rel(B.a), [tb, sb] = rel(B.b);
      const lo = Math.max(0, Math.min(ta, tb)), hi = Math.min(A.L, Math.max(ta, tb));
      if (hi - lo < 0.05) continue;
      const sAt = (t) => sa + (sb - sa) * (t - ta) / (tb - ta);
      const s0 = sAt(lo), s1 = sAt(hi);
      if (Math.abs(s0) > SHARE_TOL || Math.abs(s1) > SHARE_TOL) continue;
      ivs.push({ lo, hi, B: B.room, sAt, d: Math.abs(s0) + Math.abs(s1) });
    }
    const cuts = [0, A.L];
    for (const v of ivs) cuts.push(v.lo, v.hi);
    cuts.sort((p, q) => p - q);
    const segs = [];
    for (let k = 0; k + 1 < cuts.length; k++) {
      const p = cuts[k], q = cuts[k + 1];
      if (q - p < 1e-4) continue;
      const m = (p + q) / 2;
      let best = null;
      for (const v of ivs) if (v.lo <= m && m <= v.hi && (!best || v.d < best.d)) best = v;
      const last = segs[segs.length - 1];
      if (last && last.v === best) last.q = q; else segs.push({ p, q, v: best });
    }
    for (const g of segs) {
      if (!g.v) {
        if (g.q - g.p < 0.12) continue;
        if (A.room.outdoor) { if (!floor.outdoor && floor.elev > ground + 0.5) out.push(wallPiece(A, g.p, g.q, 0, 0, "rail", 0.05, false)); }
        else out.push(wallPiece(A, g.p, g.q, EXT_T / 2, EXT_T / 2, "ext", EXT_T, false));
        continue;
      }
      // Shared: built once, by the lower-numbered indoor room.
      const R = A.room, B = g.v.B;
      const builder = !R.outdoor && !B.outdoor ? (R.idx < B.idx ? R : B) : !R.outdoor ? R : !B.outdoor ? B : null;
      if (builder !== R) continue;
      const s0 = g.v.sAt(g.p), s1 = g.v.sAt(g.q);
      out.push(wallPiece(A, g.p, g.q, s0 / 2, s1 / 2, B.outdoor ? "ext" : "int",
        clamp((Math.abs(s0) + Math.abs(s1)) / 2, MIN_T, SHARE_TOL), true));
    }
  }
  const inWall = (x, y, self) => out.some(q => q !== self && q.kind === "wall"
    && segDist(x, y, q.x0, q.y0, q.x1, q.y1)[0] < q.thick / 2 + 0.02);
  for (const pc of out) {
    if (pc.cls !== "ext" || pc.shared) continue;
    probe: for (const t of [0.2, 0.5, 0.8]) {
      for (const d of [0.25, 0.6, 1.0, 1.5, BEHIND]) {
        const x = pc.x0 + (pc.x1 - pc.x0) * t + pc.nx * d, y = pc.y0 + (pc.y1 - pc.y0) * t + pc.ny * d;
        if (rooms.some(r => !r.outdoor && inPoly(x, y, r.pts)) || inWall(x, y, pc)) { pc.cls = "int"; break probe; }
      }
    }
  }
  return out;
}

// ── The barriers (rf_barriers_m) spliced into the walls ──────────────────────
// Glass reads as a window, "open" as a gap, a barrier named door or gate as a
// door; any other material tints that stretch of wall. A barrier along no
// derived wall stands on its own.
export function barrierKind(b){
  const m = String((b && b.material) || "").toLowerCase(), n = String((b && b.name) || "");
  if (m === "open") return "open";
  if (m === "glass" || /window/i.test(n)) return "window";
  if (/\b(door|gate)\b/i.test(n) || /door/i.test(String((b && b.linked_entity_id) || ""))) return "door";
  return "wall";
}
/** A wall piece as the 3D view draws it: its middle and length. A wall or
 *  rail is lengthened by half its thickness at each end that is a corner
 *  of its wall, so corners close; an end cut beside a door, window or gap
 *  stays where it was cut. */
export function drawnSpan(pc){
  const L = Math.hypot(pc.x1 - pc.x0, pc.y1 - pc.y0);
  const ext = pc.kind === "wall" || pc.kind === "rail" ? pc.thick / 2 : 0;
  const e0 = pc.corner0 === false ? 0 : ext, e1 = pc.corner1 === false ? 0 : ext;
  const k = L > 0 ? (e1 - e0) / 2 / L : 0;              // the middle moves toward the longer end
  return { mx: (pc.x0 + pc.x1) / 2 + (pc.x1 - pc.x0) * k, my: (pc.y0 + pc.y1) / 2 + (pc.y1 - pc.y0) * k, len: L + e0 + e1 };
}
export function applyBarriers(floor, pieces, barriers, canon, kindOf = barrierKind){
  for (const b of barriers || []) {
    if (!b || typeof b !== "object" || canon(b.floor_id) !== floor.id) continue;
    const kind = kindOf(b), mat = String(b.material || "").toLowerCase();
    const pts = (b.points_m || []).filter(p => Array.isArray(p) && num(p[0]) !== null && num(p[1]) !== null).map(p => [Number(p[0]), Number(p[1])]);
    for (let i = 0; i + 1 < pts.length; i++) {
      const a = pts[i], c = pts[i + 1], L = dist(a, c);
      if (L < 0.03) continue;
      const ux = (c[0] - a[0]) / L, uy = (c[1] - a[1]) / L;
      let hit = false;
      for (let k = 0; k < pieces.length; k++) {
        const W = pieces[k];
        if (W.kind !== "wall" || W.barrier) continue;
        const WL = Math.hypot(W.x1 - W.x0, W.y1 - W.y0);
        if (WL < 0.03) continue;
        const wx = (W.x1 - W.x0) / WL, wy = (W.y1 - W.y0) / WL;
        if (Math.abs(ux * wx + uy * wy) < BAR_COS) continue;
        const off = (p) => Math.abs((p[0] - W.x0) * -wy + (p[1] - W.y0) * wx);
        const lim = W.thick / 2 + BAR_TOL;
        if (off(a) > lim || off(c) > lim) continue;
        const ta = (a[0] - W.x0) * wx + (a[1] - W.y0) * wy, tc = (c[0] - W.x0) * wx + (c[1] - W.y0) * wy;
        const t0 = Math.max(0, Math.min(ta, tc)), t1 = Math.min(WL, Math.max(ta, tc));
        if (t1 - t0 < 0.05) continue;
        const parts = DRAFT.splitPiece(W, WL, wx, wy, t0, t1, { kind, mat, barrier: b });
        pieces.splice(k, 1, ...parts);
        k += parts.length - 1;
        hit = true;
      }
      if (!hit) pieces.push({ x0: a[0], y0: a[1], x1: c[0], y1: c[1], nx: uy, ny: -ux, cls: "int", thick: 0.12,
                              shared: false, kind, mat, barrier: b, free: true });
    }
  }
  return pieces;
}

/** What a wall piece is drawn as, bottom to top, in metres above its floor
 *  (from under the slab to under the slab of the floor above). A window is
 *  wall, glass, wall; a door is the slab edge, the door, a lintel; an open
 *  barrier is a gap with only the slab edge under it. `cuttable`: the part
 *  the cut-away lowers. `leaf`: the part that opens (a door's leaf, a
 *  window's pane) when a sensor says so. A door's height and a window's sill
 *  and head are the defaults unless the 3D file sets them (pc.head_m,
 *  pc.sill_m: live_aboard_draft.js applyOpenings, part C). */
export function wallElements(pc, floorH){
  const top = floorH - SLAB_T, lim = DRAFT.heightLimits(top);
  const len = Math.hypot(pc.x1 - pc.x0, pc.y1 - pc.y0);
  const base = pc.cls === "ext" ? WALL_EXT : WALL_INT;
  const tint = (pc.kind === "wall" && MAT_TINT[pc.mat]) || base;
  const E = [];
  const solid = (z0, z1, col, thick = pc.thick) => E.push({ z0, z1, col, thick, glass: false, cuttable: true });
  switch (pc.kind) {
    case "rail":
      E.push({ z0: RAIL_H - 0.05, z1: RAIL_H, col: RAIL_COL, thick: 0.06, glass: false, cuttable: false });
      E.push({ z0: 0, z1: RAIL_H - 0.05, col: RAIL_GLASS, thick: 0.02, glass: true, cuttable: false });
      break;
    case "door": {
      const dh = Math.min(num(pc.head_m) ?? DOOR_H, lim.head);
      solid(-SLAB_T, 0, base);
      solid(0, dh, len > 1.8 ? GARAGE_DOOR_COL : DOOR_COL, Math.min(pc.thick, 0.07));
      E[E.length - 1].leaf = true;
      solid(dh, top, base);
      break;
    }
    case "window": {
      const sill = clamp(num(pc.sill_m) ?? SILL_H, 0, lim.sill);
      const head = Math.max(sill + 0.05, Math.min(num(pc.head_m) ?? HEAD_H, lim.head));
      solid(-SLAB_T, sill, base);
      E.push({ z0: sill, z1: head, col: WINDOW_GLASS, thick: 0.03, glass: true, cuttable: true, leaf: true });
      solid(head, top, base);
      break;
    }
    case "open": solid(-SLAB_T, 0, base); break;
    default: solid(-SLAB_T, top, tint);
  }
  return E;
}

// ── The whole-house cut-away ─────────────────────────────────────────────────
// Walls: Cut (the default), Up or Down. Cut drops the walls between you and
// the rooms: an outside wall when its outside faces you, an inside wall
// unless you see it nearly edge-on. Looking straight down nothing is cut (the
// plan is already open). Deck rails never drop. (camX, camY) is the camera's
// plan position; a cut wall keeps CUT_H of itself.
export const WALL_MODES = ["cut", "up", "down"];
export function wallCut(pc, camX, camY, mode, topDown){
  if (pc.kind === "rail") return false;
  if (mode === "down") return true;
  if (mode !== "cut" || topDown) return false;
  const mx = (pc.x0 + pc.x1) / 2, my = (pc.y0 + pc.y1) / 2;
  const vx = camX - mx, vy = camY - my, vl = Math.hypot(vx, vy);
  if (vl <= 0.3) return false;
  const d = (pc.nx * vx + pc.ny * vy) / vl;
  return pc.cls === "ext" ? d > 0.15 : Math.abs(d) > 0.25;
}

// ── Quality ──────────────────────────────────────────────────────────────────
// The plan's two profiles. Auto starts High and steps down to Low when a short
// frame-time check (the median frame interval while drawing the house) misses
// HIGH_MS; any profile slower than SLOW_MS is a slow GPU, and the flat Atlas
// shows instead. A chosen Low or High is measured too, never stepped.
export const QUALITY_PROFILES = {
  low:  { dpr: "one", shadows: false, lamps: 4, pbr: false, ao: false },
  high: { dpr: "device", shadows: true, lamps: 8, pbr: true, ao: true },
};
export const HIGH_MS = 34;                // about 30 frames a second
export const SLOW_MS = 67;                // under about 15: not usable to turn the house
export function qualitySetting(v){
  const s = String(v || "").trim().toLowerCase();
  return s === "low" || s === "high" ? s : "auto";
}
/** One step of the pick: {measure: profile} to time a profile next, {use:
 *  profile} when settled, or {fallback: "no_webgl" | "slow_gpu"}. `ms` holds
 *  what has been measured so far ({high, low}, median ms per frame). */
export function qualityStep(setting, webgl, ms){
  if (!webgl) return { fallback: "no_webgl" };
  const m = ms || {};
  const ok = (v) => Number.isFinite(v) && v <= SLOW_MS;
  const s = qualitySetting(setting);
  if (s !== "auto") {
    if (m[s] === undefined) return { measure: s };
    return ok(m[s]) ? { use: s } : { fallback: "slow_gpu" };
  }
  if (m.high === undefined) return { measure: "high" };
  if (Number.isFinite(m.high) && m.high <= HIGH_MS) return { use: "high" };
  if (m.low === undefined) return { measure: "low" };
  return ok(m.low) ? { use: "low" } : { fallback: "slow_gpu" };
}
/** The median of frame intervals, the first few (shaders compiling) dropped. */
export function frameMs(intervals, skip = 3){
  const s = (intervals || []).slice(skip).filter(Number.isFinite).sort((a, b) => a - b);
  if (!s.length) return Infinity;
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
}

// ── Lights: what each one is ─────────────────────────────────────────────────
// The Atlas's shapes (its override, else what the name says) name a family;
// Live Aboard draws a light as the real thing (docs: section 4 of the
// viewing review). Light first: what shows is where the light lands, a pool
// on the floor and a wash on the wall; the fixture is a small detail. A light
// PadSpan is not sure of is only its pool and a small plain point ("glow"),
// never an invented fixture. Sensors, readouts and locks are not lights; fans
// are drawn (a ceiling has fans on it).
export const KIND_OF_SHAPE = {
  hex: "fixture", circle: "pot", bar: "strip", line: "track", square: "tube", fan: "fan",
  pendant: "pendant", sconce: "sconce", chandelier: "chandelier", triangle: "spot", diamond: "led",
  perimeter: "perimeter",
};
// What a person can say a light is, in Live Aboard's Heights tool (stored as
// lights[<entity id>].kind in the 3D file; the map is never written).
export const LIGHT_KINDS = [
  ["glow", "Just its light"], ["fixture", "Ceiling light"], ["pot", "Pot lights"],
  ["pot_ring", "Pot lights round the room"], ["pendant", "Pendant"], ["chandelier", "Chandelier"],
  ["fan", "Ceiling fan"], ["track", "Track lights"], ["tube", "Tube or shop light"], ["spot", "Spotlight"],
  ["sconce", "Wall light"], ["vanity", "Vanity light"], ["strip", "LED strip on a wall"], ["valance", "Valance"],
  ["cove", "Cove round the room"], ["undercab", "Under the cabinets"], ["kick", "Toe-kick or stairs"],
  ["tv", "Behind the TV"], ["lamp", "Lamp"], ["panel", "Panel or display"], ["accent", "Small accent light"],
  ["led", "Status light"],
];
const KINDS = new Set(LIGHT_KINDS.map(([k]) => k));
// Where each kind hangs when nothing says otherwise: metres below the ceiling
// ("ceiling") or above the floor ("floor"). A per-light height is the store's
// job (P5), never the map's.
export const MOUNT = {
  pot:        { ceiling: 0.012 },
  pot_ring:   { ceiling: 0.012 },
  fixture:    { ceiling: 0 },
  glow:       { ceiling: 0.25 },
  spot:       { ceiling: 0.02 },
  tube:       { ceiling: 0.03 },
  cove:       { ceiling: 0.012 },
  track:      { ceiling: 0.08 },
  strip:      { ceiling: 0.12 },
  perimeter:  { ceiling: 0.12 },
  fan:        { ceiling: 0.36 },
  chandelier: { ceiling: 0.55 },
  pendant:    { ceiling: 0.6 },
  valance:    { floor: 2.1 },
  vanity:     { floor: 2.0 },
  sconce:     { floor: 1.7 },
  panel:      { floor: 1.5 },
  undercab:   { floor: 1.4 },
  led:        { floor: 1.35 },
  tv:         { floor: 1.2 },
  accent:     { floor: 0.9 },
  lamp:       { floor: 0.75 },
  kick:       { floor: 0.1 },
};
/** The default mount height of a kind, above its floor, under a ceiling at
 *  `ceil` metres. */
export function mountHeight(kind, ceil){
  const m = MOUNT[kind] || MOUNT.fixture;
  return m.floor !== undefined ? Math.min(m.floor, ceil - 0.2) : ceil - m.ceiling;
}
// The words a name gives away (whole words of the entity id and the name).
const words = (...w) => new RegExp(`\\b(${w.join("|")})\\b`);
const POTS = words("pots?", "pot ?lights?", "potlights?", "downlights?", "down lights?", "recessed", "can lights?", "cans");
const NAME_KIND = [
  ["fan", words("fans?")], ["chandelier", words("chandeliers?")], ["pendant", words("pendants?", "hanging", "drop lights?")],
  ["vanity", words("vanity")], ["sconce", words("sconces?", "wall lights?", "wall lamps?")],
  // Before pots: "spot" holds "pot".
  ["spot", words("spots?", "spotlights?", "spot lights?", "floods?", "floodlights?", "flood lights?", "wall wash", "washers?")],
  ["tv", words("tv", "bias")],
  ["led", words("status led", "indicator", "backlight")],
  ["pot", POTS],
  ["track", words("track")],
  ["strip", words("valances?", "strips?", "coves?", "tape", "rope", "under ?cab\\w*", "ws2812\\w*", "sk6812\\w*", "neopixels?",
    "xmas", "christmas")],
  ["tube", words("flouresents?", "fluorescents?", "tubes?", "shop lights?")],
  ["fixture", words("ceiling lights?", "flush ?mounts?", "fixtures?", "dome lights?")],
];
// A strip's place, by name: a valance over a window, under the cabinets (a
// band on the counter), near the floor, behind a TV.
const STRIP_KIND = [
  ["valance", words("valances?", "windows?")], ["undercab", words("under ?cab\\w*", "counters?")],
  ["kick", words("kick\\w*", "plinths?", "stairs?", "steps?")], ["tv", words("tv", "bias", "backlights?")],
];
const STRIPS = new Set(["strip", "valance", "undercab", "kick", "tv"]);
// A WLED light that is not a strip, by the start of a word in its name.
const WLED_KIND = [["lamp", /\blamp/], ["panel", /\b(matrix|display|panel)/], ["accent", /\b(ring|pill|orb)/]];
/** What PadSpan draws a light as, in this order: (1) the kind set in Live
 *  Aboard (storedKind, the caller's); (2) the Atlas shape the person set
 *  (`override`, settings.light_shapes); (3) words in its name; (4) a
 *  footprint under 0.4 m is never a strip, whatever its name; (5) a WLED
 *  light named a lamp, matrix, display, panel, ring, pill or orb; (6) only
 *  then a WLED light is a strip. "perimeter" is a family the room settles
 *  (drawnKind). Nothing sure: "glow". */
export function guessKind(l, fp, override){
  const text = ` ${(l && l.entity_id) || ""} ${(l && l.friendly_name) || ""} `.toLowerCase().replace(/[^a-z0-9]+/g, " ");
  const named = (rules) => { const r = rules.find(([, re]) => re.test(text)); return r ? r[0] : null; };
  const strip = () => named(STRIP_KIND) || "strip";
  if (l && deviceClassOf(l).key === "fan") return "fan";
  const o = override && override !== "auto" ? KIND_OF_SHAPE[override] : null;
  if (o) return o === "strip" ? strip() : o === "perimeter" && POTS.test(text) ? "pot_ring" : o;
  const long = !!fp && fp.la >= 0.4, byName = named(NAME_KIND), k = byName === "strip" ? strip() : byName;
  if (k && (long || !STRIPS.has(k))) return k;
  if (l && (isWledLight(l) || isPartitionLight(l))) {
    const w = named(WLED_KIND);
    if (w) return w;
    if (long) return strip();
  }
  return "glow";
}
/** The kind the 3D file sets for a light ({kind}), if it is one this
 *  version draws. */
export function storedKind(stored){
  const k = stored && typeof stored === "object" ? stored.kind : null;
  return typeof k === "string" && KINDS.has(k) ? k : null;
}
// width_cm / height_cm / rotation are drawn in the Atlas's isometric screen
// frame (x' = (x - y)·cos 30°, y' = (x + y)·sin 30°), so the footprint's two
// axes are mapped back into plan metres. Markers under 30 cm carry no size.
const C30 = Math.cos(Math.PI / 6);
const isoToPlan = (sx, sy) => [sx / (2 * C30) + sy, -sx / (2 * C30) + sy];
export function footprint(lp){
  const w = (num(lp && lp.width_cm) || 0) / 100, h = (num(lp && lp.height_cm) || 0) / 100;
  if (Math.max(w, h) < 0.3) return null;
  const t = (num(lp.rotation) || 0) * Math.PI / 180;
  const e1 = isoToPlan(Math.cos(t), Math.sin(t)), e2 = isoToPlan(-Math.sin(t), Math.cos(t));
  const p1 = [e1[0] * w / 2, e1[1] * w / 2], p2 = [e2[0] * h / 2, e2[1] * h / 2];
  const l1 = 2 * Math.hypot(p1[0], p1[1]), l2 = 2 * Math.hypot(p2[0], p2[1]);
  return l1 >= l2 ? { a: p1, b: p2, la: l1, lb: l2 } : { a: p2, b: p1, la: l2, lb: l1 };
}
/** Is this Atlas device drawn as a light fixture in 3D? */
export function isFixture(l){
  return !!l && (castsLight(l) || deviceClassOf(l).key === "fan");
}
/** The lights to draw: placed (light_positions_m), known to the card, not
 *  hidden, and a fixture. Each carries the Atlas device record `l` it is
 *  painted from on every poll, and its kind as guessed (guessKind; the
 *  Atlas shapes the person set: `overrides`, settings.light_shapes). */
export function readLights(model, F, lightsByEid, hidden, overrides){
  const out = [];
  const pos = (model && model.light_positions_m) || {};
  for (const eid of Object.keys(pos).sort()) {
    const lp = pos[eid], l = lightsByEid && lightsByEid[eid];
    if (!lp || typeof lp !== "object" || !isFixture(l)) continue;
    if (hidden && typeof hidden.has === "function" && hidden.has(eid)) continue;
    const fl = F.byId.get(F.canon(lp.floor_id)), x = num(lp.x_m), y = num(lp.y_m);
    if (!fl || x === null || y === null) continue;
    const fp = footprint(lp);
    out.push({ eid, l, floor: fl, x, y, kind: guessKind(l, fp, overrides && overrides[eid]), fp,
               rot: num(lp.rotation) || 0, marginM: num(lp.margin_cm) === null ? null : Math.max(0, num(lp.margin_cm) / 100) });
  }
  return out;
}

// What a light is throwing right now, from the Atlas's device record (its
// effective state, rgb, brightness and colour temperature): on, its colour as
// sRGB 0..1, and a 0.3..1 strength from brightness. Unavailable reads as off,
// dimmer — a bulb switching changes these, never what is drawn.
export function kelvinRGB(k){
  const t = clamp(Number(k) || 2900, 1000, 40000) / 100;
  let r, g, b;
  if (t <= 66) { r = 255; g = 99.4708 * Math.log(t) - 161.1196; b = t <= 19 ? 0 : 138.5177 * Math.log(t - 10) - 305.0448; }
  else { r = 329.6987 * Math.pow(t - 60, -0.1332); g = 288.1222 * Math.pow(t - 60, -0.0755); b = 255; }
  return [clamp(r, 0, 255), clamp(g, 0, 255), clamp(b, 0, 255)];
}
export function lightLook(l){
  const st = String((l && l.state) || "unknown");
  const rgb = Array.isArray(l && l.rgb) && l.rgb.length >= 3 && l.rgb.slice(0, 3).every(v => Number.isFinite(Number(v)))
    ? l.rgb.slice(0, 3).map(Number) : kelvinRGB(l && l.ct);
  const bri = num(l && l.bri);
  return { on: st === "on", unavailable: st === "unavailable" || st === "unknown",
           rgb: rgb.map(v => clamp(v, 0, 255) / 255), f: 0.3 + 0.7 * clamp(bri === null ? 255 : bri, 0, 255) / 255 };
}
export const lookKey = (k) => `${k.on ? 1 : 0}${k.unavailable ? 1 : 0}|${k.rgb.map(v => v.toFixed(3)).join(",")}|${k.f.toFixed(3)}`;

/** The wall piece nearest (x, y) within maxD: where a wall light hangs.
 *  align: a long light only hangs on a wall running its way. */
const ALIGN_COS = Math.cos(25 * Math.PI / 180);
export function nearestWall(pieces, x, y, maxD, rails = false, align = null){
  let best = null;
  for (const pc of pieces) {
    if ((pc.kind === "rail" && !rails) || pc.kind === "open") continue;
    if (align) { const d = unit([pc.x1 - pc.x0, pc.y1 - pc.y0]); if (Math.abs(d[0] * align[0] + d[1] * align[1]) < ALIGN_COS) continue; }
    const [d, t] = segDist(x, y, pc.x0, pc.y0, pc.x1, pc.y1);
    if (d < maxD && (!best || d < best.d)) best = { d, t, pc };
  }
  if (!best) return null;
  const pc = best.pc, px = pc.x0 + (pc.x1 - pc.x0) * best.t, py = pc.y0 + (pc.y1 - pc.y0) * best.t;
  let n = [x - px, y - py];
  n = Math.hypot(n[0], n[1]) < 1e-3 ? [pc.nx, pc.ny] : unit(n);
  const off = pc.thick / 2 + 0.012;
  return { x: px + n[0] * off, y: py + n[1] * off, n, dir: unit([pc.x1 - pc.x0, pc.y1 - pc.y0]), rail: pc.kind === "rail", pc };
}
/** The wall of `room` a light inside it runs along, at any distance: the
 *  nearest running `align`'s way, else the nearest. Where on it: square
 *  across from (x, y), on the room's side (as nearestWall gives it). */
export function roomWall(pieces, room, x, y, align = null){
  const find = (al) => {
    let best = null;
    for (const pc of pieces) {
      if (pc.kind === "rail" || pc.kind === "open") continue;
      const dir = unit([pc.x1 - pc.x0, pc.y1 - pc.y0]);
      if (al && Math.abs(dir[0] * al[0] + dir[1] * al[1]) < ALIGN_COS) continue;
      const [d, t] = segDist(x, y, pc.x0, pc.y0, pc.x1, pc.y1);
      if (best && d >= best.d) continue;
      // Its face toward the room: the side (x, y) is on, a few cm in.
      const px = pc.x0 + (pc.x1 - pc.x0) * t, py = pc.y0 + (pc.y1 - pc.y0) * t, off = pc.thick / 2 + 0.012;
      let n = Math.hypot(x - px, y - py) < 1e-3 ? [pc.nx, pc.ny] : unit([x - px, y - py]);
      if (!inPoly(px + n[0] * (off + 0.05), py + n[1] * (off + 0.05), room.pts)) {
        n = [-n[0], -n[1]];
        if (!inPoly(px + n[0] * (off + 0.05), py + n[1] * (off + 0.05), room.pts)) continue;
      }
      // Square across from (x, y) on the wall's line, even past this piece.
      const s = (x - pc.x0) * dir[0] + (y - pc.y0) * dir[1], lx = pc.x0 + dir[0] * s, ly = pc.y0 + dir[1] * s;
      best = { d, pc, dir, n, x: lx + n[0] * off, y: ly + n[1] * off };
    }
    return best;
  };
  const w = (align && find(align)) || find(null);
  return w ? { x: w.x, y: w.y, n: w.n, dir: w.dir, rail: false, pc: w.pc } : null;
}
function grid(fp, spacing, maxN){
  if (!fp) return [[0, 0]];
  const n1 = clamp(Math.round(fp.la / spacing), 1, maxN), n2 = clamp(Math.round(fp.lb / spacing), 1, maxN), out = [];
  for (let i = 0; i < n1; i++) {
    for (let j = 0; j < n2; j++) {
      const s = (i + 0.5) / n1 * 2 - 1, t = (j + 0.5) / n2 * 2 - 1;
      out.push([fp.a[0] * s + fp.b[0] * t, fp.a[1] * s + fp.b[1] * t]);
    }
  }
  return out;
}
function growPara(fp, g){
  const ua = unit(fp.a), ub = fp.lb > 0.02 ? unit(fp.b) : perp(ua);
  return { a: [fp.a[0] + ua[0] * g, fp.a[1] + ua[1] * g], b: [fp.b[0] + ub[0] * g, fp.b[1] + ub[1] * g] };
}
const ring = (r) => ({ a: [r, 0], b: [0, r] });
// A switched-off fixture is shaded like the rest of the room: a white trim,
// a dark strip, a dark screen or body.
const OFF = { white: "#a3a9af", strip: "#646b72", screen: "#262b31", body: "#3a4047", diffuser: "#d9dcdf" };
// Pots round a room: one per corner of the loop, then evenly along each side
// about `every` metres apart, none closer than half a metre to another.
function ringSpots(loop, every){
  const P = loop.filter((p, i) => {                        // only real corners
    const a = loop[(i + loop.length - 1) % loop.length], b = loop[(i + 1) % loop.length];
    const u = unit([p[0] - a[0], p[1] - a[1]]), v = unit([b[0] - p[0], b[1] - p[1]]);
    return Math.abs(u[0] * v[1] - u[1] * v[0]) > 0.34 || u[0] * v[0] + u[1] * v[1] < 0;
  });
  const C = P.length >= 3 ? P : loop, out = [];
  const add = (p) => { if (!out.some(q => dist(q, p) < 0.5)) out.push(p); };
  for (let i = 0; i < C.length; i++) {
    const a = C[i], b = C[(i + 1) % C.length], k = Math.max(1, Math.round(dist(a, b) / every));
    add(a);
    for (let j = 1; j < k; j++) add([a[0] + (b[0] - a[0]) * j / k, a[1] + (b[1] - a[1]) * j / k]);
  }
  return out;
}
const GARAGE = /\b(garage|shop|workshop)\b/i;
/** The kind a light is drawn as: its own (L.kind), with the perimeter family
 *  settled by its room — pots on a deck or patio (at floor level, along its
 *  edge), else a cove — and a run round no room only its light. */
export function drawnKind(L, ctx){
  const k = KINDS.has(L.kind) || L.kind === "perimeter" ? L.kind : "glow";
  if (k !== "perimeter" && k !== "pot_ring" && k !== "cove") return k;
  const room = roomAt((ctx && ctx.rooms) || [], L.x, L.y);
  if (!room) return "glow";
  return k === "perimeter" ? (room.outdoor || L.floor.outdoor ? "pot_ring" : "cove") : k;
}

/** The parts of one fixture, by kind (drawnKind): bulbs (lit when on, shaded
 *  when off; `hideOff`: hidden while off, as a hidden tape is), housings
 *  (never lit), halos (a small glow), washes (light on a wall, a counter or
 *  the floor: a quad from a line, `a` half its length and `b` how far the
 *  light spreads from it, both [x, up, y]; `fixed` ones stay where the light
 *  lands when the fixture is raised), pools of light on the floor below and
 *  the points a press finds it by — plain numbers in plan metres, heights
 *  above its floor. `wall`: the wall piece it hangs on (it hides while that
 *  wall is cut away, as wall things do in the Sims; a bulb or wash can carry
 *  its own). kf: how much real lamp light it throws (0 = glow only). spin: a
 *  fan's blades (housings), turned while it runs. */
export function fixtureParts(L, ctx){
  const fl = L.floor, ceil = fl.h - SLAB_T, rooms = ctx.rooms || [], pieces = ctx.pieces || [];
  const room = roomAt(rooms, L.x, L.y), kind = drawnKind(L, ctx);
  // in: inside an indoor room. out: on a deck, patio or outdoor floor. none:
  // in no room, i.e. on the outside of the building.
  const where = fl.outdoor ? "out" : !room ? "none" : room.outdoor ? "out" : "in";
  const outdoor = where !== "in";
  const align = L.fp && L.fp.la >= 0.9 ? unit(L.fp.a) : null;
  const snap = outdoor ? nearestWall(pieces, L.x, L.y, where === "none" ? 2.5 : 1.5, true, align) : null;
  const onGround = fl.elev <= (ctx.ground || 0) + 0.5;
  const P = { kind, where, bulbs: [], housings: [], halos: [], washes: [], pools: [], picks: [], poolH: 0.014, kf: 1, wall: null, spin: null };
  // Nothing out there to light, unless it is the ground (just above the
  // ground plane, which lies under the lowest slab).
  if (where === "none") P.poolH = onGround ? (ctx.ground || 0) - SLAB_T - 0.008 - fl.elev : null;
  const bulb = (prim, x, y, h, sx, sy, sz, yaw = 0, off = OFF.white, more = null) => P.bulbs.push({ prim, x, y, h, sx, sy, sz, yaw, off, ...more });
  const house = (x, y, h, sx, sy, sz, yaw, col) => P.housings.push({ x, y, h, sx, sy, sz, yaw, col });
  const halo = (x, y, h, cls) => P.halos.push({ x, y, h, cls });
  const pool = (at, shape) => P.pools.push({ at, ...shape });
  const wash = (x, y, h, a, b, tex, more = null) => P.washes.push({ x, y, h, a, b, tex, fixed: false, wall: null, ...more });
  // A run: pressed anywhere along it.
  const along = (x, y, h, dir, len) => {
    const n = Math.max(1, Math.round(len / 0.6));
    for (let i = 0; i < n; i++) { const t = ((i + 0.5) / n - 0.5) * len; P.picks.push({ x: x + dir[0] * t, y: y + dir[1] * t, h }); }
  };
  // Light down (span > 0) or up a wall face, from a line on it.
  const wallWash = (w, cx, cy, h, dir, len, span, tex = "fade", more = null) =>
    wash(cx + w.n[0] * 0.006, cy + w.n[1] * 0.006, h, [dir[0] * len / 2, 0, dir[1] * len / 2], [0, -span, 0], tex, { wall: w.pc, ...more });
  const { x, y, fp } = L;
  const at = (k) => mountHeight(k, ceil);
  // How wide a light's pool is, from how high it hangs.
  const poolR = (h, k = 0.38) => ring(clamp(h * k, 0.55, 1.6));
  switch (kind) {
    case "pot": {
      if (where === "none" && snap && !snap.rail) {          // soffit pots: a row just outside the wall, under the eave
        const len = fp ? fp.la : 0, n = clamp(Math.round(len / 1.25), 1, 6);
        for (let i = 0; i < n; i++) {
          const t = ((i + 0.5) / n - 0.5) * len, px = snap.x + snap.dir[0] * t + snap.n[0] * 0.35, py = snap.y + snap.dir[1] * t + snap.n[1] * 0.35;
          bulb("puck", px, py, at("pot"), 0.075, 0.024, 0.075); halo(px, py, ceil - 0.05, "s");
          pool([px + snap.n[0] * 0.4, py + snap.n[1] * 0.4], ring(0.9));
        }
      } else {
        const h = outdoor ? 0.015 : at("pot");               // decks and patios have no ceiling: set into the floor
        for (const [dx, dy] of grid(fp, 1.25, 5)) {
          bulb("puck", x + dx, y + dy, h, 0.075, 0.024, 0.075); halo(x + dx, y + dy, outdoor ? 0.05 : h - 0.04, "s");
          pool([x + dx, y + dy], outdoor ? ring(0.5) : poolR(h));
        }
      }
      P.kf = 1.25;
      break;
    }
    case "pot_ring": {                                       // pots round the room, each its own; no bar between them
      const deck = room.outdoor || fl.outdoor;
      const want = deck ? 0.25 : L.marginM !== null && L.marginM >= 0.3 ? Math.min(L.marginM, 1.2) : 0.6;
      const loop = offsetPolygonInward(room.pts, Math.min(want, room.spot.r * 0.85));
      const h = deck ? 0.012 : at("pot_ring");
      for (const [px, py] of ringSpots(loop, deck ? 1.3 : 1.35)) {
        bulb("puck", px, py, h, deck ? 0.05 : 0.07, 0.022, deck ? 0.05 : 0.07);
        halo(px, py, deck ? 0.05 : h - 0.04, "s");
        pool([px, py], deck ? ring(0.5) : poolR(h));
        // A pot near a wall: a soft scallop of light down it.
        const w = deck ? null : nearestWall(pieces, px, py, 0.7);
        if (w) wallWash(w, w.x, w.y, ceil - 0.01, w.dir, 0.8, 1.2, "scallop");
      }
      P.kf = deck ? 0.6 : 1.25;
      break;
    }
    case "cove": {                                           // tape hidden at the top of the walls: no bulbs, no dots
      const deck = room.outdoor || fl.outdoor;               // on a deck: along its edge, at floor level
      const loop = offsetPolygonInward(room.pts, deck ? 0.12 : 0.02);
      const h = deck ? 0.03 : ceil - 0.012;
      for (let i = 0; i < loop.length; i++) {
        const a = loop[i], b = loop[(i + 1) % loop.length], len = dist(a, b);
        if (len < 0.05) continue;
        const d = unit([b[0] - a[0], b[1] - a[1]]), mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
        const w = deck ? null : nearestWall(pieces, mx, my, 0.5);
        bulb("box", mx, my, h, len, 0.018, 0.018, yawOf(d), OFF.strip, { hideOff: true, wall: w ? w.pc : null });
        if (deck) {                                          // a glow on the deck, inward
          const n = perp(d), into = inPoly(mx + n[0] * 0.3, my + n[1] * 0.3, room.pts) ? n : [-n[0], -n[1]];
          wash(mx, my, 0.016, [d[0] * len / 2, 0, d[1] * len / 2], [into[0] * 0.55, 0, into[1] * 0.55], "fade", { fixed: true });
        } else wash(mx, my, ceil - 0.006, [d[0] * len / 2, 0, d[1] * len / 2], [0, -0.45, 0], "fade", { wall: w ? w.pc : null });
        along(mx, my, h, d, len);
      }
      if (!deck) pool([room.spot.x, room.spot.y], ring(Math.min(3, Math.max(1.2, room.spot.r * 1.6))));
      P.kf = 0.8;
      break;
    }
    case "strip": case "valance": case "undercab": case "kick": case "tv": {
      let dir = fp && fp.la >= 0.4 ? unit(fp.a) : null, len = fp && fp.la >= 0.4 ? fp.la : kind === "tv" ? 1.0 : 0.6;
      let cx = x, cy = y, h, n = null, w = null;
      if (!outdoor) {
        // On the wall of its room it runs along, however far: never mid-room.
        w = roomWall(pieces, room, x, y, dir);
        h = at(kind);
      } else if (snap) {                                       // along the deck rail, or the outside of the wall
        w = snap;
        h = kind === "kick" ? 0.1 : snap.rail ? RAIL_H + 0.03 : where === "none" ? ceil - 0.15 : 2.2;
      } else h = kind === "kick" ? 0.1 : 0.05;                 // nothing to hang it on: a ground strip
      if (w) { dir = w.dir; cx = w.x; cy = w.y; n = w.n; if (!w.rail) P.wall = w.pc; }
      dir = dir || unit(isoToPlan(Math.cos(L.rot * Math.PI / 180), Math.sin(L.rot * Math.PI / 180)));
      n = n || perp(dir);
      const hideOff = kind !== "strip" && kind !== "valance";  // tape under a cabinet, at the floor, behind a TV: unseen when off
      bulb("box", cx, cy, h, len, 0.022, 0.022, yawOf(dir), OFF.strip, { hideOff });
      const flat = (hh, span) => wash(cx, cy, hh, [dir[0] * len / 2, 0, dir[1] * len / 2], [n[0] * span, 0, n[1] * span], "fade", { fixed: true });
      if (w && !w.rail) {
        if (kind === "strip" || kind === "valance") {
          wallWash(w, cx, cy, h, dir, len, Math.min(kind === "valance" ? 1.1 : 0.9, h - 0.05));
          if (ceil - h > 0.05) wallWash(w, cx, cy, h, dir, len, -(ceil - h - 0.01));
        } else if (kind === "undercab") { wallWash(w, cx, cy, h, dir, len, Math.max(0.1, h - 0.9)); flat(0.91, 0.6); }
        else if (kind === "tv") wash(cx + n[0] * 0.006, cy + n[1] * 0.006, h - 0.5, [dir[0] * (len / 2 + 0.4), 0, dir[1] * (len / 2 + 0.4)], [0, 1.0, 0], "round", { wall: w.pc });
      }
      if (kind === "kick") flat(0.016, 0.6);
      else if (kind === "strip" || kind === "valance" || (w && w.rail) || !w) {
        pool([cx + n[0] * 0.5, cy + n[1] * 0.5], { a: [dir[0] * (len / 2 + 0.4), dir[1] * (len / 2 + 0.4)], b: [n[0] * 0.8, n[1] * 0.8] });
      }
      along(cx, cy, h, dir, len);
      P.kf = { strip: 0.8, valance: 0.8, undercab: 0.45, kick: 0.3, tv: 0.35 }[kind];
      break;
    }
    case "track": {                                          // a dark rail, small heads, each aimed into the room
      const dir = fp && fp.la >= 0.5 ? unit(fp.a) : unit(isoToPlan(Math.cos(L.rot * Math.PI / 180), Math.sin(L.rot * Math.PI / 180)));
      const len = Math.max(fp ? fp.la : 0, 1.5), h = outdoor ? 2.2 : at("track"), top = outdoor ? 2.3 : ceil - 0.02;
      house(x, y, top, len, 0.03, 0.04, yawOf(dir), "#2f343a");
      const n = Math.max(2, Math.round(len / 0.6));
      for (let i = 0; i < n; i++) {
        const t = ((i + 0.5) / n - 0.5) * len, hx = x + dir[0] * t, hy = y + dir[1] * t;
        bulb("dome", hx, hy, h, 0.035, 0.08, 0.035, 0, OFF.body);
        halo(hx, hy, h - 0.08, "s");
        const to = room ? [room.spot.x - hx, room.spot.y - hy] : [0, 0], d = Math.hypot(to[0], to[1]);
        const aim = d > 0.3 ? unit(to) : null, reach = aim ? Math.min(0.9, d) : 0;
        pool([hx + (aim ? aim[0] * reach : 0), hy + (aim ? aim[1] * reach : 0)],
          aim ? { a: [aim[0] * 0.6, aim[1] * 0.6], b: [-aim[1] * 0.42, aim[0] * 0.42] } : ring(0.5));
      }
      P.kf = 0.9;
      break;
    }
    case "tube": {                                           // a long box, a white underside; in a garage, hung on chains
      const dir = fp && fp.la >= 0.5 ? unit(fp.a) : unit(isoToPlan(Math.cos(L.rot * Math.PI / 180), Math.sin(L.rot * Math.PI / 180)));
      const len = fp ? clamp(fp.la, 0.6, 2.4) : 1.2, yaw = yawOf(dir);
      const hung = !outdoor && room && GARAGE.test(room.name), h = outdoor ? 2.3 : hung ? ceil - 0.3 : at("tube");
      house(x, y, h + 0.035, len, 0.07, 0.14, yaw, "#9aa1a8");
      if (hung) for (const s of [-0.35, 0.35]) house(x + dir[0] * len * s, y + dir[1] * len * s, ceil - 0.15, 0.01, 0.3, 0.01, 0, "#5b6168");
      bulb("box", x, y, h - 0.006, len * 0.97, 0.012, 0.11, yaw, OFF.diffuser);
      pool([x, y], { a: [dir[0] * (len / 2 + 0.6), dir[1] * (len / 2 + 0.6)], b: [-dir[1] * 1.1, dir[0] * 1.1] });
      along(x, y, h, dir, len);
      break;
    }
    case "fan": {
      if (where === "none" && snap && !snap.rail) {          // a fan entity inside a wall (a fireplace blower): a grille
        bulb("box", snap.x, snap.y, 0.45, 0.32, 0.18, 0.03, yawOf(snap.dir), OFF.screen);
        halo(snap.x + snap.n[0] * 0.05, snap.y + snap.n[1] * 0.05, 0.45, "s");
        P.wall = snap.pc; P.kf = 0;
        break;
      }
      const span = fp && fp.la >= 0.9 ? clamp(fp.la, 0.9, 1.6) : 1.3;
      const yaw0 = fp ? yawOf(fp.a) : 0;
      house(x, y, ceil - 0.12, 0.03, 0.24, 0.03, 0, "#e7e3dc");                          // downrod
      house(x, y, ceil - 0.3, 0.22, 0.12, 0.22, yaw0, "#e7e3dc");                       // motor
      const bl = span / 2 - 0.11, r = 0.11 + bl / 2, blades = [];
      for (let k = 0; k < 4; k++) {
        const a = -yaw0 + k * Math.PI / 2, d = [Math.cos(a), Math.sin(a)];
        blades.push({ i: P.housings.length, a, r });
        house(x + d[0] * r, y + d[1] * r, ceil - 0.31, bl, 0.012, 0.13, yawOf(d), "#a88560");
      }
      P.spin = { x, y, blades };
      bulb("dome", x, y, at("fan"), 0.11, 0.09, 0.11);
      halo(x, y, at("fan") - 0.06, "m");
      pool([x, y], poolR(at("fan"), 0.6));
      break;
    }
    case "pendant": {
      house(x, y, ceil - 0.3, 0.012, 0.6, 0.012, 0, "#2f343a");
      bulb("dome", x, y, at("pendant"), 0.2, 0.16, 0.2);
      halo(x, y, at("pendant") - 0.12, "m");
      pool([x, y], ring(1.2));
      break;
    }
    case "chandelier": {
      const h = at("chandelier");
      house(x, y, ceil - 0.25, 0.015, 0.5, 0.015, 0, "#2f343a");
      bulb("sphere", x, y, h, 0.07, 0.07, 0.07);
      for (let k = 0; k < 6; k++) { const a = k * Math.PI / 3; bulb("sphere", x + Math.cos(a) * 0.32, y + Math.sin(a) * 0.32, h - 0.05, 0.045, 0.06, 0.045); }
      halo(x, y, h - 0.05, "l");
      pool([x, y], ring(2.2));
      break;
    }
    case "sconce": case "vanity": {                          // a plate on the wall, light fanning up and down it
      const w = room && !outdoor ? roomWall(pieces, room, x, y) : nearestWall(pieces, x, y, 1.5);
      const px = w ? w.x : x, py = w ? w.y : y, h = at(kind), dir = w ? w.dir : [1, 0];
      if (w) P.wall = w.pc;
      if (kind === "vanity") bulb("box", px, py, h, 0.6, 0.08, 0.06, yawOf(dir));
      else bulb("sphere", px, py, h, 0.09, 0.13, 0.05, yawOf(dir));
      halo(px, py, h, "s");
      if (w) {
        wallWash(w, px, py, h, dir, kind === "vanity" ? 0.9 : 0.6, kind === "vanity" ? 1.0 : 0.7, "scallop");
        if (kind === "sconce") wallWash(w, px, py, h, dir, 0.6, -Math.min(0.7, ceil - h - 0.01), "scallop");
      }
      pool(w ? [px + w.n[0] * 0.5, py + w.n[1] * 0.5] : [px, py], ring(kind === "vanity" ? 0.9 : 1.0));
      break;
    }
    case "spot": {
      if (outdoor && snap && !snap.rail) {                   // on the outside wall, aimed out
        const h = where === "none" ? Math.min(2.5, ceil - 0.1) : 2.5;
        P.wall = snap.pc;
        bulb("dome", snap.x, snap.y, h, 0.06, 0.09, 0.06, yawOf(snap.dir), OFF.body);
        halo(snap.x, snap.y, h - 0.09, "s");
        pool([snap.x + snap.n[0] * 2.5, snap.y + snap.n[1] * 2.5], { a: [snap.n[0] * 1.6, snap.n[1] * 1.6], b: [snap.dir[0] * 1.1, snap.dir[1] * 1.1] });
      } else {
        const h = outdoor ? 0.3 : at("spot");
        bulb("dome", x, y, h, 0.06, 0.09, 0.06, 0, OFF.body);
        halo(x, y, h - 0.1, "s");
        pool([x, y], ring(0.9));
      }
      break;
    }
    case "led": {   // a status light on a device: a pin-head dot, only while lit; it lights nothing
      const w = nearestWall(pieces, x, y, 0.6), h = at("led");
      if (w) P.wall = w.pc;
      bulb("sphere", w ? w.x : x, w ? w.y : y, h, 0.022, 0.022, 0.022, 0, OFF.screen, { hideOff: true });
      halo(w ? w.x : x, w ? w.y : y, h, "s");
      P.kf = 0;
      break;
    }
    case "lamp": {  // a glowing body standing on a stand, a small pool round it
      const h = at("lamp");
      house(x, y, 0.01, 0.22, 0.02, 0.22, 0, OFF.body);
      house(x, y, h / 2, 0.025, h, 0.025, 0, OFF.body);
      bulb("puck", x, y, h + 0.13, 0.13, 0.26, 0.13, 0, OFF.body);
      halo(x, y, h + 0.13, "s");
      pool([x, y], ring(1.1));
      P.kf = 0.6;
      break;
    }
    case "panel": { // a flat panel on its wall, its face glowing
      const w = room && !outdoor ? roomWall(pieces, room, x, y) : nearestWall(pieces, x, y, 1.6);
      const wide = fp ? clamp(fp.la, 0.3, 2) : 0.5, h = at("panel");
      if (w) {
        P.wall = w.pc;
        bulb("box", w.x, w.y, h, wide, 0.32, 0.025, yawOf(w.dir), OFF.screen);
        wash(w.x + w.n[0] * 0.008, w.y + w.n[1] * 0.008, h - 0.45, [w.dir[0] * (wide / 2 + 0.35), 0, w.dir[1] * (wide / 2 + 0.35)], [0, 0.9, 0], "round", { wall: w.pc });
      } else {
        house(x, y, 0.5, 0.025, 1.0, 0.025, 0, OFF.body);
        bulb("box", x, y, 1.15, wide, 0.32, 0.025, 0, OFF.screen);
        halo(x, y, 1.15, "s");
      }
      P.kf = 0.25;
      break;
    }
    case "accent": {  // a few LEDs in an object: a small puck that glows, lighting nothing else
      bulb("puck", x, y, at("accent"), 0.05, 0.03, 0.05, 0, OFF.body);
      halo(x, y, at("accent"), "s");
      P.kf = 0;
      break;
    }
    case "glow": {  // not sure what it is: a small plain point and its pool, nothing invented
      const h = where === "in" ? at("glow") : where === "out" ? 2.0 : Math.min(2.2, ceil - 0.1);
      bulb("sphere", x, y, h, 0.035, 0.035, 0.035);
      halo(x, y, h, "s");
      pool([x, y], fp ? growPara(fp, 0.35) : poolR(h, 0.45));
      P.kf = 0.9;
      break;
    }
    default: {   // "fixture": a ceiling light the person or its name says it is
      if (outdoor) {
        const long = fp && fp.la >= 0.9 && fp.la / Math.max(fp.lb, 0.05) >= 3.2;
        if (snap && !snap.rail) {                            // on the outside of the wall: a porch light, or a bar under the eave
          const hh = long ? (where === "none" ? ceil - 0.15 : 2.2) : 2.0;
          P.wall = snap.pc;
          if (long) {
            bulb("box", snap.x, snap.y, hh, fp.la, 0.05, 0.06, yawOf(snap.dir));
            wallWash(snap, snap.x, snap.y, hh, snap.dir, fp.la, Math.min(1.2, hh - 0.1));
            along(snap.x, snap.y, hh, snap.dir, fp.la);
          } else { bulb("sphere", snap.x, snap.y, hh, 0.08, 0.11, 0.08, yawOf(snap.dir)); halo(snap.x, snap.y, hh, "m"); }
          pool([snap.x + snap.n[0] * 0.5, snap.y + snap.n[1] * 0.5],
            long ? { a: [snap.dir[0] * (fp.la / 2 + 0.5), snap.dir[1] * (fp.la / 2 + 0.5)], b: [snap.n[0] * 1.0, snap.n[1] * 1.0] } : ring(1.4));
        } else if (snap) {                                   // a post light on the deck rail
          house(snap.x, snap.y, RAIL_H + 0.12, 0.05, 0.24, 0.05, 0, "#3a4047");
          bulb("sphere", snap.x, snap.y, RAIL_H + 0.3, 0.07, 0.07, 0.07); halo(snap.x, snap.y, RAIL_H + 0.3, "m");
          pool([snap.x, snap.y], ring(1.4));
        } else {                                             // free-standing: a bollard
          house(x, y, 0.3, 0.06, 0.6, 0.06, 0, "#3a4047"); bulb("sphere", x, y, 0.65, 0.07, 0.07, 0.07); halo(x, y, 0.65, "m");
          pool([x, y], ring(1.4));
        }
      } else if (fp && fp.la >= 0.9 && fp.la / Math.max(fp.lb, 0.05) >= 3.2) {   // a long fixture: a linear bar
        const dir = unit(fp.a);
        bulb("box", x, y, ceil - 0.03, fp.la, 0.05, clamp(fp.lb, 0.08, 0.3), yawOf(dir));
        along(x, y, ceil - 0.03, dir, fp.la);
        pool([x, y], growPara(fp, 0.55));
      } else if (fp && fp.lb >= 0.9) {                                           // an area: a few fixtures across it
        for (const [dx, dy] of grid(fp, 2.0, 3)) { bulb("dome", x + dx, y + dy, at("fixture"), 0.15, 0.08, 0.15); halo(x + dx, y + dy, ceil - 0.12, "m"); }
        pool([x, y], growPara(fp, 0.55));
      } else {
        bulb("dome", x, y, at("fixture"), 0.16, 0.09, 0.16);
        halo(x, y, ceil - 0.12, "m");
        pool([x, y], poolR(ceil, 0.65));
      }
    }
  }
  return P;
}

// ── North and the sun ────────────────────────────────────────────────────────
// Directions come from fabric_compass.js (the bearing of the y-down fabric's
// +Y axis); the 3D view maps the fabric to the scene exactly as it maps the
// walls, plan (x, y) to world (x, ·, y).
/** Toward the sun: fabric (x, y) and up, a unit vector. */
export function sunDirection(azimuthDeg, elevationDeg, bearingDeg){
  const e = Number(elevationDeg) * Math.PI / 180, [x, y] = compassDir(azimuthDeg, bearingDeg);
  return { x: x * Math.cos(e), y: y * Math.cos(e), up: Math.sin(e) };
}
/** The camera turn (the 3D view's theta) that puts true north at the top of
 *  the screen: the camera looks along -(sin θ, cos θ) in the plan. */
export function northUpTheta(bearingDeg){
  const [x, y] = fabricCompass(bearingDeg).north;
  return Math.atan2(-x, -y);
}

// ── The compass on screen ────────────────────────────────────────────────────
// The 3D view's camera looks at its target from a yaw theta (0 = from plan +y)
// and a tilt phi (0 = straight down). At the middle of the view a level plan
// direction (x, y) shows on screen at the angle below, clockwise from
// straight up: the projection's own slope there, so the compass rose, a spun
// needle and the drawing agree in any view, not only Top.
export function screenAngleOfPlanDir(dir, theta, phi){
  const x = dir[0], y = dir[1], c = Math.cos(phi);
  const right = x * Math.cos(theta) - y * Math.sin(theta);
  const up = -c * (x * Math.sin(theta) + y * Math.cos(theta));
  return ((Math.atan2(right, up) * 180 / Math.PI) % 360 + 360) % 360;
}
/** Its inverse: the level plan direction (a unit vector) that shows on
 *  screen at alphaDeg, clockwise from straight up. */
export function planDirOfScreenAngle(alphaDeg, theta, phi){
  const a = Number(alphaDeg) * Math.PI / 180, c = Math.max(1e-6, Math.cos(phi));
  const right = Math.sin(a), along = -Math.cos(a) / c;
  const x = right * Math.cos(theta) + along * Math.sin(theta), y = -right * Math.sin(theta) + along * Math.cos(theta);
  const l = Math.hypot(x, y) || 1;
  return [x / l, y / l];
}
/** Where the compass needle points on screen for a bearing (degrees,
 *  clockwise from up)... */
export function needleAngle(bearingDeg, theta, phi){
  return screenAngleOfPlanDir(fabricCompass(bearingDeg).north, theta, phi);
}
/** ...and the bearing a needle turned to that angle means: north is the plan
 *  direction it points along (fabric_compass.js's inverse). */
export function bearingFromNeedle(alphaDeg, theta, phi){
  return bearingOfNorth(planDirOfScreenAngle(alphaDeg, theta, phi));
}

// Where the sun is, when Home Assistant has no sun.sun: the standard
// low-precision solar position (well under a degree), the same arithmetic as
// lights_map.js sunElevationDeg (the Showcase daylight), plus the azimuth.
export function solarPosition(latDeg, lonDeg, tMs){
  const r = Math.PI / 180;
  const d = tMs / 86400000 + 2440587.5 - 2451545.0;          // days since J2000
  const g = (357.529 + 0.98560028 * d) * r;                     // mean anomaly
  const q = 280.459 + 0.98564736 * d;                           // mean longitude
  const L = (q + 1.915 * Math.sin(g) + 0.020 * Math.sin(2 * g)) * r;
  const eps = (23.439 - 0.00000036 * d) * r;                    // obliquity
  const ra = Math.atan2(Math.cos(eps) * Math.sin(L), Math.cos(L));
  const dec = Math.asin(Math.sin(eps) * Math.sin(L));
  const gmst = ((18.697374558 + 24.06570982441908 * d) % 24) * 15 * r;
  const ha = gmst + lonDeg * r - ra;                            // the hour angle
  const lat = latDeg * r;
  const el = Math.asin(Math.sin(lat) * Math.sin(dec) + Math.cos(lat) * Math.cos(dec) * Math.cos(ha));
  const az = Math.atan2(-Math.sin(ha), Math.tan(dec) * Math.cos(lat) - Math.sin(lat) * Math.cos(ha));
  return { azimuth: ((az / r) % 360 + 360) % 360, elevation: el / r };
}
export const SUN_DEFAULT = Object.freeze({ azimuth: 180, elevation: 45 });
/** The sun from what Home Assistant already holds: sun.sun's azimuth and
 *  elevation; else worked out from hass.config's latitude and longitude and
 *  the time; else due south, 45° up. */
export function readSun(states, config, nowMs){
  const a = states && states["sun.sun"] && states["sun.sun"].attributes;
  const az = num(a && a.azimuth), el = num(a && a.elevation);
  if (az !== null && el !== null) return { azimuth: normBearing(az), elevation: el, source: "sun" };
  const lat = num(config && config.latitude), lon = num(config && config.longitude);
  if (lat !== null && lon !== null && Number.isFinite(Number(nowMs))) return { ...solarPosition(lat, lon, Number(nowMs)), source: "computed" };
  return { ...SUN_DEFAULT, source: "default" };
}
// Day and night by the sun's elevation, civil twilight either side of the
// horizon (the Showcase ground's ambientFromElevation uses the same bounds):
// day from +6°, night below -6°, a blend between. By day the sun lights the
// house, weaker and warmer when low; at night it is off and a dim, cool
// ambient leaves the house lights to carry the scene.
export const DAY_ABOVE = 6, NIGHT_BELOW = -6;
export function sunLight(elevationDeg){
  const e = Number.isFinite(Number(elevationDeg)) ? Number(elevationDeg) : SUN_DEFAULT.elevation;
  const night = clamp((DAY_ABOVE - e) / (DAY_ABOVE - NIGHT_BELOW), 0, 1);
  const high = clamp(Math.sin(Math.max(0, e) * Math.PI / 180) / Math.sin(Math.PI / 4), 0, 1);
  return { phase: e >= DAY_ABOVE ? "day" : e <= NIGHT_BELOW ? "night" : "twilight", night,
           sun: (1 - night) * (0.3 + 0.7 * high), warm: 1 - clamp(e / 25, 0, 1) };
}

// ── The live parts: doors, windows and locks (part B) ───────────────────────
// A barrier linked to a sensor (docs/IDEA_DOOR_WINDOW_BARRIERS.md) is an
// opening: what it is comes from the sensor's own class (a window sensor, a
// door, garage door or opening sensor, a lock), else from its name and
// material as for any barrier; a linked one never stays a plain wall.
export function openingKind(b, dl){
  const k = barrierKind(b);
  if (!b || !b.linked_entity_id || k === "open") return k;
  const dc = dl && dl.device_class;
  if ((dl && dl.isLock) || /^lock\./.test(String(b.linked_entity_id))) return "door";
  if (dc === "window") return "window";
  if (dc === "door" || dc === "garage_door" || dc === "opening") return "door";
  return k === "wall" ? "door" : k;
}
// What the Atlas draws for it, read the way its barrier pass reads it
// (iso_lights.js buildIsoSVG, the door/window/lock barriers): no reading
// (barrierNoReading — offline, unknown, or no device record) is neither open
// nor closed; a lock is locked, or anything else (unlocked, jammed) — the
// one that flashes; a door or window sensor is open when "on", flipped for
// this one barrier by its invert_state. The 3D house and the flat Atlas
// can never disagree: it is the same reading of the same record. One of
// "none", "open", "closed", "locked", "unlocked".
/** The Atlas's one "no reading" rule (offline, unknown, or no record). */
export const noReading = (dl) => barrierNoReading(dl);
export function openingState(bar, dl){
  if (barrierNoReading(dl)) return "none";
  if (dl.isLock) return dl.state === "locked" ? "locked" : "unlocked";
  const rawOn = dl.state === "on";
  return (bar && bar.invert_state ? !rawOn : rawOn) ? "open" : "closed";
}
/** Can it be pressed? Only a link to a device the Atlas knows: the Atlas
 *  draws no line to press for any other (its barrier pass's hit-line). */
export const openingPressable = (dl) => !!dl;
/** The barrier as the Atlas's own click hands it to its card
 *  (lights_map.js openBarrierCard, from the hit-line's data-* fields). */
export function barrierCardOf(b){
  return { linked_entity_id: b.linked_entity_id, invert_state: !!b.invert_state, name: b.name || null,
           linked_opener_entity_id: b.linked_opener_entity_id || null, linked_lock_entity_id: b.linked_lock_entity_id || null };
}
/** Which end of an opening hinges and which way it swings. Hinged on the
 *  left and swinging in, until the 3D file says otherwise (stored: its
 *  openings[<barrier id>] — {hinge: "left" | "right", swing: "in" | "out"},
 *  part C). "In" is the indoor side: the side an indoor room is on, and for
 *  a wall between two rooms (or a barrier standing on its own) the side its
 *  wall's normal points away from. "Left" is as you stand outside, facing
 *  in. side: +1 / -1, the leaf opens toward (nx, ny) × side. */
export function openingSwing(pc, rooms, stored){
  const dx = pc.x1 - pc.x0, dy = pc.y1 - pc.y0;
  const mx = (pc.x0 + pc.x1) / 2, my = (pc.y0 + pc.y1) / 2;
  const indoor = (s) => (rooms || []).some(r => !r.outdoor && inPoly(mx + pc.nx * s * 0.45, my + pc.ny * s * 0.45, r.pts));
  const inS = indoor(1) && !indoor(-1) ? 1 : -1;
  // Facing in, in the y-down plan: left of (fx, fy) is (fy, -fx).
  const fx = pc.nx * inS, fy = pc.ny * inS;
  let hingeB = dx * fy + dy * -fx > 0;                       // walking a → b goes left: b is the left end
  if (stored && stored.hinge === "right") hingeB = !hingeB;
  return { hinge: hingeB ? "b" : "a", side: stored && stored.swing === "out" ? -inS : inS };
}

// ── The live parts: motion and air (part B) ─────────────────────────────────
// The Motion · Air colours and timing are the flat Atlas's (iso_lights.js
// buildIsoSVG keeps them inside the function, so they are copied here, the
// way light_codes.js copies MOTION_STUCK_MS; tests/test_live_aboard_use.py
// holds every copy equal to the original). Motion: active (on, or within the
// hold of its last change) pulses the active blue on a 1.6 s clock; gone
// quiet, it breathes in the colour of how long ago on a 3 s clock, stepping
// round the wheel; past six hours, nothing. Air rides the same colours by
// how bad, in bars that rise through the room.
export const MOTION_HOLD_MS = 5 * 60 * 1000;
export const MOTION_RECENT_MS = 6 * 60 * 60 * 1000;
export const MOTION_BOOT_GRACE_MS = 5 * 60 * 1000;
export const MOTION_COLOR_STOPS = [
  [0, 240], [MOTION_HOLD_MS, 180], [20 * 60 * 1000, 120], [40 * 60 * 1000, 60],
  [65 * 60 * 1000, 30], [90 * 60 * 1000, 0], [120 * 60 * 1000, 300],
];
// The SVG's own clocks and values (linear, as SMIL animates a values list).
export const MOTION_PULSE = { ms: 1600, fill: [0.55, 0.2, 0.55], ringR: [0.7, 2.4], ringA: [0.8, 0] };
export const MOTION_RECENT = { ms: 3000, op: [0.5, 0.16, 0.5] };
// degSweep, as iso_lights.js names it: a step round the colour wheel by time
// or by how bad, never a room's own colour (room_color.js is the only one).
export const motionColor = (degSweep) => `hsl(${Number(degSweep).toFixed(0)},75%,58%)`;
export const airColor = (degSweep) => `hsl(${degSweep},80%,60%)`;
/** A room's floor while its motion shows: the active pulse's own blue (the
 *  Atlas's MOTION_PULSE disc), else the ring's colour of how long ago. */
export const motionFill = (look) => (look.active ? MOTION_BLUE : motionColor(look.hue));
/** Is it active now — the Atlas's one answer (buildIsoSVG motionActive),
 *  which lights the sensor's own marker: "on", or within the hold of its
 *  last change; never offline, never a restart's restored timestamp. */
export function motionActive(l, nowMs, haStartedMs){
  if (!l || !l.isMotion) return false;
  if (l.state === "on") return true;
  if (l.state === "unavailable" || l.state === "unknown") return false;
  const lastMs = l.last_changed ? Date.parse(l.last_changed) : NaN;
  if (haStartedMs && lastMs <= haStartedMs + MOTION_BOOT_GRACE_MS) return false;
  const e = nowMs - lastMs;
  return e >= 0 && e < MOTION_HOLD_MS;
}
/** What a motion sensor's room shows (the flat Atlas's motion pass): null —
 *  nothing (no reading, a restart's restored timestamp while quiet, past six
 *  hours, on or off) — or {active, hue, elapsed}. haStartedMs:
 *  model.ha_started_at. */
export function motionLook(l, nowMs, haStartedMs){
  if (!l || !l.isMotion || l.state === "unavailable" || l.state === "unknown") return null;
  const lastMs = l.last_changed ? Date.parse(l.last_changed) : NaN;
  const boot = !!haStartedMs && lastMs <= haStartedMs + MOTION_BOOT_GRACE_MS;
  if (l.state !== "on" && boot) return null;
  const raw = nowMs - lastMs;
  const elapsed = l.state === "on" && !(raw >= 0) ? 0 : raw;
  if (!(elapsed >= 0) || elapsed >= MOTION_RECENT_MS) return null;
  const active = motionActive(l, nowMs, haStartedMs);
  let hue = MOTION_COLOR_STOPS[0][1];
  if (!active) for (const [atMs, h] of MOTION_COLOR_STOPS) { if (elapsed >= atMs) hue = h; else break; }
  return { active, hue, elapsed };
}
/** Air quality by the same colour steps, by how bad (airQualityBadness). */
export function airHue(badness){
  const hues = MOTION_COLOR_STOPS.map(s => s[1]);
  return hues[Math.min(hues.length - 1, Math.max(0, Math.floor(badness * (hues.length - 1) + 1e-9)))];
}
/** What an air-quality sensor shows: null (good, or no reading) or the
 *  rising bars — their hue, cycle (s) and opacity, as the flat Atlas draws. */
export function airLook(l){
  if (!l || !l.isAir) return null;
  const b = airQualityBadness(l);
  if (!(b > 0)) return null;
  const k = Math.min(1, b);
  return { badness: b, hue: airHue(b), dur: Number((4.5 - 2 * k).toFixed(2)), op: Number((0.14 + 0.10 * k).toFixed(2)) };
}
/** A values list played linearly over one cycle, at t ms. */
export function cycleAt(values, ms, t){
  const n = values.length - 1, p = ((Number(t) % ms) + ms) % ms / ms * n, i = Math.min(n - 1, Math.floor(p));
  return values[i] + (values[i + 1] - values[i]) * (p - i);
}
// An unlocked lock flashes (styles.css .lv-lockflash: 1 s, ease-in-out,
// #f87171 at .55 to #dc2626 at 1 and back): k 0..1, 1 at the flash's peak.
export const LOCK_FLASH = { ms: 1000, from: "#f87171", to: "#dc2626", op: [0.55, 1] };
export function lockFlashAt(t){
  const p = ((Number(t) % LOCK_FLASH.ms) + LOCK_FLASH.ms) % LOCK_FLASH.ms / LOCK_FLASH.ms, s = p < 0.5 ? p * 2 : (1 - p) * 2;
  return s * s * (3 - 2 * s);
}

// ── The live parts: sensors and readouts (part B) ───────────────────────────
// The placed sensors the 3D house draws: motion (a small sensor whose room
// pulses) and the readouts — the registry's placedReading classes, a reading
// the map draws only where the device is placed (temperature, humidity,
// air) — each at a height above its floor. Placed only, as on the Atlas
// ("only if placed like all others"); hidden ones draw nothing. The kind is
// the registry's own key (light_codes.js DEVICE_CLASSES).
export function sensorKindOf(l){
  if (!l) return null;
  const c = deviceClassOf(l);
  return c.key === "motion" || c.placedReading ? c.key : null;
}
export function readSensors(model, F, lightsByEid, hidden){
  const out = [];
  const pos = (model && model.light_positions_m) || {};
  for (const eid of Object.keys(pos).sort()) {
    const lp = pos[eid], l = lightsByEid && lightsByEid[eid], kind = sensorKindOf(l);
    if (!kind || !lp || typeof lp !== "object") continue;
    if (hidden && typeof hidden.has === "function" && hidden.has(eid)) continue;
    const fl = F.byId.get(F.canon(lp.floor_id)), x = num(lp.x_m), y = num(lp.y_m);
    if (!fl || x === null || y === null) continue;
    out.push({ eid, l, kind, floor: fl, x, y });
  }
  return out;
}
/** What the sensors are drawn from — which, where, what kind — not their state. */
export function sensorsSignature(model, lightsByEid, hidden){
  const pos = (model && model.light_positions_m) || {};
  const rows = [];
  for (const eid of Object.keys(pos).sort()) {
    const kind = sensorKindOf(lightsByEid && lightsByEid[eid]);
    if (!kind || (hidden && typeof hidden.has === "function" && hidden.has(eid))) continue;
    const p = pos[eid] || {};
    rows.push([eid, p.x_m, p.y_m, p.floor_id, kind]);
  }
  return JSON.stringify(rows);
}
// Each device's height above its floor: a default by its type. Part C keeps
// a per-device height in the 3D file (devices[<entity id>].z_m); `stored` is
// that record, and is the one place it replaces the default.
export const DEVICE_Z = { motion: 2.2, temp: 1.5, humidity: 1.5, air: 1.2 };
export function deviceZ(kind, ceil, stored){
  const z = num(stored && stored.z_m);
  return clamp(z !== null ? z : (DEVICE_Z[kind] ?? 1.5), 0, DRAFT.heightLimits(ceil).device);
}
// The temperature's tint (iso_lights.js TEMP_TINT, the digits' ink): over 34
// bright orange, from 20 a slight red, under 20 a slight blue. A reading
// counts while it is fresh — reported in the last hour (TEMP_FRESH_MS).
export const TEMP_WARM_AT = 20, TEMP_HOT_OVER = 34, TEMP_FRESH_MS = 60 * 60 * 1000;
export const TEMP_TINT = { hot: { wash: "#f97316", ink: "#fb923c" }, warm: { wash: "#ef4444", ink: "#fca5a5" },
                           cool: { wash: "#3b82f6", ink: "#93c5fd" } };
export const tempBand = (t) => (t > TEMP_HOT_OVER ? "hot" : t >= TEMP_WARM_AT ? "warm" : "cool");
export const STALE_INK = "#94a3b8";
/** A readout's words and colour: the Atlas's own state word (stateWordOf —
 *  "21°", "57%", "Fair", "409 ppm · Good") while it is live, in the Atlas's
 *  colours; stale or no reading, the device's code, quiet. */
export function readoutOf(l, nowMs){
  const kind = sensorKindOf(l);
  if (!kind || kind === "motion") return null;
  let live, color;
  if (kind === "air") {
    const b = airQualityBadness(l);
    live = Number.isFinite(b);
    color = !live ? STALE_INK : b > 0 ? airColor(airHue(b)) : AIR_BORDER;
  } else {
    const v = kind === "temp" ? l.temperature : l.humidity;
    const fresh = l.last_changed ? nowMs - Date.parse(l.last_changed) : NaN;
    live = Number.isFinite(v) && fresh >= 0 && fresh < TEMP_FRESH_MS;
    color = !live ? STALE_INK : kind === "temp" ? TEMP_TINT[tempBand(Number(v))].ink : HUMIDITY_BORDER;
  }
  const w = live ? stateWordOf(l) : null;
  return { kind, live, color, text: w ? w.text : String(l.code || "—") };
}

// ── The floor badges (part B) ───────────────────────────────────────────────
// The flat Atlas numbers each plate of its stack with a badge in the plate's
// colour (iso_lights.js LAYER_PAL, the same list); a tap opens that plate's
// floor sheet, handed the plate's storey as the badge's data-z. Here: one per
// plate, at the corner of its rooms the flat badge marks (least x, most y).
export const { LAYER_PAL } = await import(`./iso_lights.js${new URL(import.meta.url).search}`);
export function floorBadges(model, floorList, house){
  const floors = (floorList && floorList.length ? floorList : (model && model.floors)) || [];
  const frame = fabricFrame(model || {}, floors, 150, 0);
  const out = [];
  frame.levels.forEach((z, i) => {
    const ids = floorIdsOnSlab(frame, model, floors, z);
    const mine = (house.floors || []).filter(f => ids.has(f.id) && !f.outdoor);
    if (!mine.length) return;
    let x0 = Infinity, y1 = -Infinity;
    for (const r of house.rooms) if (mine.includes(r.floor)) for (const p of r.pts) { x0 = Math.min(x0, p[0]); y1 = Math.max(y1, p[1]); }
    if (!Number.isFinite(x0)) return;
    const fid = floorIdAtLevel(frame, model, floors, z);
    const fl = mine.find(f => f.id === fid) || mine[0];
    out.push({ z: String(z), n: i + 1, color: LAYER_PAL[i % LAYER_PAL.length], floor: fl, x: x0 - 0.6, y: y1 + 0.6,
               name: floorNameAtLevel(frame, model, floors, z) || fl.name });
  });
  return out;
}

// ── Reading it all ───────────────────────────────────────────────────────────
/** The whole house from the card's own data. floors: the registry the card
 *  holds (else model.floors); lightsByEid: the Atlas's device records (live
 *  state); hidden: the Atlas's hidden lights (a Set). Per floor: its rooms
 *  and its wall pieces, barriers spliced in (a linked one as an opening of
 *  its sensor's kind). */
export function readHouse(model, floorList, lightsByEid, hidden, overrides){
  const F = readFloors(model, floorList);
  const rooms = readRooms(model, F);
  const barriers = Array.isArray(model && model.rf_barriers_m) ? model.rf_barriers_m : [];
  const kindOf = (b) => openingKind(b, lightsByEid && b && lightsByEid[b.linked_entity_id]);
  const perFloor = new Map();
  for (const fl of F.floors) {
    const mine = rooms.filter(r => r.floor === fl);
    const pieces = applyBarriers(fl, deriveWalls(fl, mine, F.ground), barriers, F.canon, kindOf);
    perFloor.set(fl, { rooms: mine, pieces });
  }
  return { floors: F.floors, byId: F.byId, canon: F.canon, ground: F.ground, rooms, perFloor,
           lights: readLights(model, F, lightsByEid, hidden, overrides), sensors: readSensors(model, F, lightsByEid, hidden) };
}

/** A reading's walls to cut into: each floor's pieces copied, so what is
 *  cut in (live_aboard_draft.js applyOpenings) never changes the reading
 *  the 3D view keeps for its next draw. */
export function readingCopy(h){
  const perFloor = new Map();
  for (const [fl, per] of h.perFloor) perFloor.set(fl, { rooms: per.rooms, pieces: per.pieces.map(pc => ({ ...pc })) });
  return { ...h, perFloor };
}

/** What the house shell is drawn from — floors, rooms and their colours,
 *  barriers, and what each linked barrier's sensor is (it decides door or
 *  window) — as one string: the same string, nothing to rebuild. */
export function shellSignature(model, floorList, lightsByEid){
  const m = model || {};
  const linked = (Array.isArray(m.rf_barriers_m) ? m.rf_barriers_m : []).filter(b => b && b.linked_entity_id).map(b => {
    const dl = lightsByEid && lightsByEid[b.linked_entity_id];
    return dl ? (dl.isLock ? "lock" : String(dl.device_class || "")) : null;
  });
  return JSON.stringify([floorList || m.floors || [], m.floor_elevations || {}, m.room_geometry_m || {},
    m.room_meta || {}, m.rf_barriers_m || [], linked]);
}
/** What the fixtures are drawn from — which lights, where, how big, their
 *  shapes and the shapes the person set — but not their state, which is
 *  painted on every poll instead. */
export function lightsSignature(model, lightsByEid, hidden, overrides){
  const pos = (model && model.light_positions_m) || {};
  const rows = [];
  for (const eid of Object.keys(pos).sort()) {
    const l = lightsByEid && lightsByEid[eid];
    if (!isFixture(l) || (hidden && typeof hidden.has === "function" && hidden.has(eid))) continue;
    const p = pos[eid] || {};
    rows.push([eid, p.x_m, p.y_m, p.floor_id, p.width_cm, p.height_cm, p.rotation, p.margin_cm, l.shape, (overrides && overrides[eid]) || null]);
  }
  return JSON.stringify(rows);
}
