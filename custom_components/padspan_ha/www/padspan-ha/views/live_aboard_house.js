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

const { isOutdoorFloorId, offsetPolygonInward } =
  await import(`./iso_lights.js${new URL(import.meta.url).search}`);
const { castsLight, deviceClassOf } =
  await import(`./light_codes.js${new URL(import.meta.url).search}`);
const { roomColor } =
  await import(`./room_color.js${new URL(import.meta.url).search}`);
// Which way north is (settings.fabric_bearing_deg, y-down): the one source.
const COMPASS = await import(`./fabric_compass.js${new URL(import.meta.url).search}`);
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
export const DOOR_H = 2.05, SILL_H = 0.9, HEAD_H = 2.1, RAIL_H = 1.0;
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
export function applyBarriers(floor, pieces, barriers, canon){
  for (const b of barriers || []) {
    if (!b || typeof b !== "object" || canon(b.floor_id) !== floor.id) continue;
    const kind = barrierKind(b), mat = String(b.material || "").toLowerCase();
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
        const at = (t) => [W.x0 + wx * t, W.y0 + wy * t];
        const parts = [];
        if (t0 > 0.03) { const e = at(t0); parts.push({ ...W, x1: e[0], y1: e[1] }); }
        { const s = at(t0), e = at(t1); parts.push({ ...W, x0: s[0], y0: s[1], x1: e[0], y1: e[1], kind, mat, barrier: b }); }
        if (WL - t1 > 0.03) { const s = at(t1); parts.push({ ...W, x0: s[0], y0: s[1] }); }
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
 *  the cut-away lowers. */
export function wallElements(pc, floorH){
  const top = floorH - SLAB_T;
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
      const dh = Math.min(DOOR_H, top - 0.1);
      solid(-SLAB_T, 0, base);
      solid(0, dh, len > 1.8 ? GARAGE_DOOR_COL : DOOR_COL, Math.min(pc.thick, 0.07));
      solid(dh, top, base);
      break;
    }
    case "window": {
      const head = Math.min(HEAD_H, top - 0.1);
      solid(-SLAB_T, SILL_H, base);
      E.push({ z0: SILL_H, z1: head, col: WINDOW_GLASS, thick: 0.03, glass: true, cuttable: true });
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

// ── Lights: by the Atlas's own shape ─────────────────────────────────────────
// The shape a light wears on the Atlas (resolveLightShape — its override, else
// what its name says) picks the fixture. Sensors, readouts and locks are not
// lights; fans are drawn (a ceiling has fans on it).
export const KIND_OF_SHAPE = {
  hex: "fixture", circle: "pot", bar: "strip", line: "track", square: "tube", fan: "fan",
  pendant: "pendant", sconce: "sconce", chandelier: "chandelier", triangle: "spot", diamond: "led",
  perimeter: "perimeter",
};
// Where each kind hangs when nothing says otherwise: metres below the ceiling
// ("ceiling") or above the floor ("floor"). A per-light height is the store's
// job (P5), never the map's.
export const MOUNT = {
  pot:        { ceiling: 0.012 },
  fixture:    { ceiling: 0 },
  spot:       { ceiling: 0.02 },
  tube:       { ceiling: 0.03 },
  track:      { ceiling: 0.08 },
  strip:      { ceiling: 0.12 },
  perimeter:  { ceiling: 0.12 },
  fan:        { ceiling: 0.36 },
  chandelier: { ceiling: 0.55 },
  pendant:    { ceiling: 0.6 },
  sconce:     { floor: 1.8 },
  led:        { floor: 1.35 },
};
/** The default mount height of a kind, above its floor, under a ceiling at
 *  `ceil` metres. */
export function mountHeight(kind, ceil){
  const m = MOUNT[kind] || MOUNT.fixture;
  return m.floor !== undefined ? Math.min(m.floor, ceil - 0.2) : ceil - m.ceiling;
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
 *  painted from on every poll. */
export function readLights(model, F, lightsByEid, hidden){
  const out = [];
  const pos = (model && model.light_positions_m) || {};
  for (const eid of Object.keys(pos).sort()) {
    const lp = pos[eid], l = lightsByEid && lightsByEid[eid];
    if (!lp || typeof lp !== "object" || !isFixture(l)) continue;
    if (hidden && typeof hidden.has === "function" && hidden.has(eid)) continue;
    const fl = F.byId.get(F.canon(lp.floor_id)), x = num(lp.x_m), y = num(lp.y_m);
    if (!fl || x === null || y === null) continue;
    out.push({ eid, l, floor: fl, x, y, kind: KIND_OF_SHAPE[l.shape] || "fixture", fp: footprint(lp),
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
const OFF = { white: "#a3a9af", strip: "#646b72", screen: "#262b31" };   // a switched-off fixture stays quiet

/** The parts of one fixture, by kind: bulbs (lit when on), housings (never
 *  lit), halos (the glow) and a pool of light on the floor below — plain
 *  numbers in plan metres, heights above its floor. `wall`: the wall piece it
 *  hangs on (it hides while that wall is cut away, as wall things do in the
 *  Sims). kf: how much real lamp light it throws (0 = glow only). */
export function fixtureParts(L, ctx){
  const fl = L.floor, ceil = fl.h - SLAB_T, rooms = ctx.rooms || [], pieces = ctx.pieces || [];
  const room = roomAt(rooms, L.x, L.y);
  // in: inside an indoor room. out: on a deck, patio or outdoor floor. none:
  // in no room, i.e. on the outside of the building.
  const where = fl.outdoor ? "out" : !room ? "none" : room.outdoor ? "out" : "in";
  const outdoor = where !== "in";
  const align = L.fp && L.fp.la >= 0.9 ? unit(L.fp.a) : null;
  const snap = outdoor ? nearestWall(pieces, L.x, L.y, where === "none" ? 2.5 : 1.5, true, align) : null;
  const onGround = fl.elev <= (ctx.ground || 0) + 0.5;
  const P = { where, bulbs: [], housings: [], halos: [], pool: null, poolAt: [L.x, L.y], poolH: 0.014, kf: 1, wall: null };
  // Nothing out there to light, unless it is the ground (just above the
  // ground plane, which lies under the lowest slab).
  if (where === "none") P.poolH = onGround ? (ctx.ground || 0) - SLAB_T - 0.008 - fl.elev : null;
  const bulb = (prim, x, y, h, sx, sy, sz, yaw = 0, off = OFF.white) => P.bulbs.push({ prim, x, y, h, sx, sy, sz, yaw, off });
  const house = (x, y, h, sx, sy, sz, yaw, col) => P.housings.push({ x, y, h, sx, sy, sz, yaw, col });
  const halo = (x, y, h, cls) => P.halos.push({ x, y, h, cls });
  const along = (x, y, h, dir, len, every, cls) => {
    const n = Math.max(1, Math.round(len / every));
    for (let i = 0; i < n; i++) { const t = ((i + 0.5) / n - 0.5) * len; halo(x + dir[0] * t, y + dir[1] * t, h, cls); }
  };
  const { x, y, fp } = L;
  const at = (kind) => mountHeight(kind, ceil);
  switch (L.kind) {
    case "pot": {
      if (where === "none" && snap && !snap.rail) {          // soffit pots: a row just outside the wall, under the eave
        const len = fp ? fp.la : 0, n = clamp(Math.round(len / 1.25), 1, 6);
        for (let i = 0; i < n; i++) {
          const t = ((i + 0.5) / n - 0.5) * len, px = snap.x + snap.dir[0] * t + snap.n[0] * 0.35, py = snap.y + snap.dir[1] * t + snap.n[1] * 0.35;
          bulb("puck", px, py, at("pot"), 0.075, 0.024, 0.075); halo(px, py, ceil - 0.07, "m");
        }
        P.pool = { a: [snap.dir[0] * (len / 2 + 0.6), snap.dir[1] * (len / 2 + 0.6)], b: [snap.n[0] * 0.9, snap.n[1] * 0.9] };
        P.poolAt = [snap.x + snap.n[0] * 0.6, snap.y + snap.n[1] * 0.6];
      } else {
        const h = outdoor ? 0.015 : at("pot");               // decks and patios have no ceiling: set into the floor
        for (const [dx, dy] of grid(fp, 1.25, 5)) { bulb("puck", x + dx, y + dy, h, 0.075, 0.024, 0.075); halo(x + dx, y + dy, outdoor ? 0.07 : h - 0.06, "m"); }
        P.pool = fp ? growPara(fp, 0.55) : ring(1.15);
      }
      P.kf = 1.25;
      break;
    }
    case "strip": case "track": case "tube": {
      let dir, len = 0, cx = x, cy = y, h;
      if (fp && fp.la >= 0.5) { dir = unit(fp.a); len = fp.la; }
      else {
        const w = nearestWall(pieces, x, y, 1.2);
        dir = w ? w.dir : unit(isoToPlan(Math.cos(L.rot * Math.PI / 180), Math.sin(L.rot * Math.PI / 180)));
      }
      if (L.kind === "tube") len = len ? clamp(len, 0.6, 2.4) : 1.2;
      else len = Math.max(len, L.kind === "track" ? 1.5 : 0.6);
      if (!outdoor) {
        h = at(L.kind);
        const w = L.kind === "strip" ? nearestWall(pieces, x, y, 1.2, false, align) : null;   // a valance or cove runs along its wall
        if (w) { dir = w.dir; cx = w.x; cy = w.y; P.wall = w.pc; }
      } else if (snap) {                                       // along the deck rail, or the outside of the wall
        dir = snap.dir; cx = snap.x; cy = snap.y;
        if (!snap.rail) P.wall = snap.pc;
        h = snap.rail ? RAIL_H + 0.03 : where === "none" ? ceil - 0.15 : 2.2;
      } else h = 0.05;                                         // nothing to hang it on: a ground strip
      const yaw = yawOf(dir);
      if (L.kind === "track" && !outdoor) {
        house(cx, cy, ceil - 0.02, len, 0.03, 0.04, yaw, "#2f343a");
        const n = Math.max(2, Math.round(len / 0.6));
        for (let i = 0; i < n; i++) { const t = ((i + 0.5) / n - 0.5) * len; bulb("sphere", cx + dir[0] * t, cy + dir[1] * t, h, 0.045, 0.045, 0.045); halo(cx + dir[0] * t, cy + dir[1] * t, h - 0.04, "m"); }
      } else if (L.kind === "tube") {
        bulb("box", cx, cy, h, len, 0.05, 0.16, yaw);
        along(cx, cy, h - 0.04, dir, len, 0.4, "m");
      } else {
        bulb("box", cx, cy, h, len, 0.035, 0.035, yaw, OFF.strip);
        along(cx, cy, h, dir, len, 0.38, "m");
        P.kf = 0.8;
      }
      P.pool = { a: [dir[0] * (len / 2 + 0.5), dir[1] * (len / 2 + 0.5)], b: [-dir[1] * 0.8, dir[0] * 0.8] };
      P.poolAt = [cx, cy];
      break;
    }
    case "perimeter": {                                        // a cove round the whole room, in from the walls
      const r = room && !room.outdoor ? room : null;
      if (!r) { bulb("box", x, y, at("strip"), 0.6, 0.035, 0.035, 0, OFF.strip); halo(x, y, at("strip"), "m"); P.pool = ring(1.2); P.kf = 0.8; break; }
      // Never more than most of the room's half-width (its label spot's
      // clearance), so a big margin cannot fold the loop back on itself.
      const loop = offsetPolygonInward(r.pts, Math.min(L.marginM === null ? 0.15 : L.marginM, r.spot.r * 0.85));
      const h = at("perimeter");
      for (let i = 0; i < loop.length; i++) {
        const a = loop[i], b = loop[(i + 1) % loop.length], len = dist(a, b);
        if (len < 0.05) continue;
        const d = unit([b[0] - a[0], b[1] - a[1]]), mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
        bulb("box", mx, my, h, len, 0.035, 0.035, yawOf(d), OFF.strip);
        along(mx, my, h, d, len, 0.6, "m");
      }
      P.pool = ring(Math.min(3, Math.max(1.2, r.spot.r * 1.6))); P.poolAt = [r.spot.x, r.spot.y];
      P.kf = 0.8;
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
      const bl = span / 2 - 0.11;
      for (let k = 0; k < 4; k++) {
        const a = -yaw0 + k * Math.PI / 2, d = [Math.cos(a), Math.sin(a)], r = 0.11 + bl / 2;
        house(x + d[0] * r, y + d[1] * r, ceil - 0.31, bl, 0.012, 0.13, yawOf(d), "#a88560");
      }
      bulb("dome", x, y, at("fan"), 0.11, 0.09, 0.11);
      halo(x, y, at("fan") - 0.06, "l");
      P.pool = ring(1.8);
      break;
    }
    case "pendant": {
      house(x, y, ceil - 0.3, 0.012, 0.6, 0.012, 0, "#2f343a");
      bulb("dome", x, y, at("pendant"), 0.2, 0.16, 0.2);
      halo(x, y, at("pendant") - 0.12, "l");
      P.pool = ring(1.6);
      break;
    }
    case "chandelier": {
      const h = at("chandelier");
      house(x, y, ceil - 0.25, 0.015, 0.5, 0.015, 0, "#2f343a");
      bulb("sphere", x, y, h, 0.07, 0.07, 0.07);
      for (let k = 0; k < 6; k++) { const a = k * Math.PI / 3; bulb("sphere", x + Math.cos(a) * 0.32, y + Math.sin(a) * 0.32, h - 0.05, 0.045, 0.06, 0.045); }
      halo(x, y, h - 0.05, "l");
      P.pool = ring(2.2);
      break;
    }
    case "sconce": {
      const w = nearestWall(pieces, x, y, 1.5);
      const px = w ? w.x : x, py = w ? w.y : y, h = at("sconce");
      if (w) P.wall = w.pc;
      bulb("sphere", px, py, h, 0.09, 0.13, 0.09, w ? yawOf(w.dir) : 0);
      halo(px, py, h, "m");
      P.pool = ring(1.3); P.poolAt = [px, py];
      break;
    }
    case "spot": {
      const h = outdoor ? 0.3 : at("spot");
      bulb("dome", x, y, h, 0.08, 0.1, 0.08);
      halo(x, y, h - 0.1, "m");
      P.pool = ring(1.1);
      break;
    }
    case "led": {   // an indicator or a screen's backlight: on the nearest wall, else on a small stand
      const w = nearestWall(pieces, x, y, 1.6), h = at("led");
      if (w) {
        P.wall = w.pc;
        bulb("box", w.x, w.y, h, 0.17, 0.11, 0.016, yawOf(w.dir), OFF.screen);
        halo(w.x + w.n[0] * 0.04, w.y + w.n[1] * 0.04, h, "s");
      } else {
        house(x, y, 0.45, 0.02, 0.9, 0.02, 0, "#3a4047");
        bulb("sphere", x, y, 0.93, 0.035, 0.035, 0.035, 0, OFF.screen);
        halo(x, y, 0.93, "s");
      }
      P.kf = 0;
      break;
    }
    default: {   // "fixture": the Atlas's default hexagon
      if (outdoor) {
        const long = fp && fp.la >= 0.9 && fp.la / Math.max(fp.lb, 0.05) >= 3.2;
        if (snap && !snap.rail) {                            // on the outside of the wall: a porch light, or a bar under the eave
          const hh = long ? (where === "none" ? ceil - 0.15 : 2.2) : 2.0;
          P.wall = snap.pc;
          if (long) { bulb("box", snap.x, snap.y, hh, fp.la, 0.05, 0.06, yawOf(snap.dir)); along(snap.x, snap.y, hh, snap.dir, fp.la, 0.45, "m"); }
          else { bulb("sphere", snap.x, snap.y, hh, 0.08, 0.11, 0.08, yawOf(snap.dir)); halo(snap.x, snap.y, hh, "m"); }
          P.pool = long ? { a: [snap.dir[0] * (fp.la / 2 + 0.5), snap.dir[1] * (fp.la / 2 + 0.5)], b: [snap.n[0] * 1.0, snap.n[1] * 1.0] } : ring(1.4);
          P.poolAt = [snap.x + snap.n[0] * 0.5, snap.y + snap.n[1] * 0.5];
        } else if (snap) {                                   // a post light on the deck rail
          house(snap.x, snap.y, RAIL_H + 0.12, 0.05, 0.24, 0.05, 0, "#3a4047");
          bulb("sphere", snap.x, snap.y, RAIL_H + 0.3, 0.07, 0.07, 0.07); halo(snap.x, snap.y, RAIL_H + 0.3, "m");
          P.pool = ring(1.4); P.poolAt = [snap.x, snap.y];
        } else {                                             // free-standing: a bollard
          house(x, y, 0.3, 0.06, 0.6, 0.06, 0, "#3a4047"); bulb("sphere", x, y, 0.65, 0.07, 0.07, 0.07); halo(x, y, 0.65, "m");
          P.pool = ring(1.4);
        }
      } else if (fp && fp.la >= 0.9 && fp.la / Math.max(fp.lb, 0.05) >= 3.2) {   // a long fixture: a linear bar
        const dir = unit(fp.a);
        bulb("box", x, y, ceil - 0.03, fp.la, 0.05, clamp(fp.lb, 0.08, 0.3), yawOf(dir));
        along(x, y, ceil - 0.08, dir, fp.la, 0.45, "m");
        P.pool = growPara(fp, 0.55);
      } else if (fp && fp.lb >= 0.9) {                                           // an area: a few fixtures across it
        for (const [dx, dy] of grid(fp, 2.0, 3)) { bulb("dome", x + dx, y + dy, at("fixture"), 0.15, 0.08, 0.15); halo(x + dx, y + dy, ceil - 0.12, "l"); }
        P.pool = growPara(fp, 0.55);
      } else {
        bulb("dome", x, y, at("fixture"), 0.16, 0.09, 0.16);
        halo(x, y, ceil - 0.12, "l");
        P.pool = ring(1.8);
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

// ── Reading it all ───────────────────────────────────────────────────────────
/** The whole house from the card's own data. floors: the registry the card
 *  holds (else model.floors); lightsByEid: the Atlas's device records (live
 *  state); hidden: the Atlas's hidden lights (a Set). Per floor: its rooms
 *  and its wall pieces, barriers spliced in. */
export function readHouse(model, floorList, lightsByEid, hidden){
  const F = readFloors(model, floorList);
  const rooms = readRooms(model, F);
  const barriers = Array.isArray(model && model.rf_barriers_m) ? model.rf_barriers_m : [];
  const perFloor = new Map();
  for (const fl of F.floors) {
    const mine = rooms.filter(r => r.floor === fl);
    const pieces = applyBarriers(fl, deriveWalls(fl, mine, F.ground), barriers, F.canon);
    perFloor.set(fl, { rooms: mine, pieces });
  }
  return { floors: F.floors, byId: F.byId, canon: F.canon, ground: F.ground, rooms, perFloor,
           lights: readLights(model, F, lightsByEid, hidden) };
}

/** What the house shell is drawn from — floors, rooms and their colours,
 *  barriers — as one string: the same string, nothing to rebuild. */
export function shellSignature(model, floorList){
  const m = model || {};
  return JSON.stringify([floorList || m.floors || [], m.floor_elevations || {}, m.room_geometry_m || {},
    m.room_meta || {}, m.rf_barriers_m || []]);
}
/** What the fixtures are drawn from — which lights, where, how big, their
 *  shapes — but not their state, which is painted on every poll instead. */
export function lightsSignature(model, lightsByEid, hidden){
  const pos = (model && model.light_positions_m) || {};
  const rows = [];
  for (const eid of Object.keys(pos).sort()) {
    const l = lightsByEid && lightsByEid[eid];
    if (!isFixture(l) || (hidden && typeof hidden.has === "function" && hidden.has(eid))) continue;
    const p = pos[eid] || {};
    rows.push([eid, p.x_m, p.y_m, p.floor_id, p.width_cm, p.height_cm, p.rotation, p.margin_cm, l.shape]);
  }
  return JSON.stringify(rows);
}
