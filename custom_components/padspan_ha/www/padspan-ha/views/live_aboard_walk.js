// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
// See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
//
// Walk-through in the 3D house (the owner's item 21, approved 2026-11-23):
// walk the house at eye height. On a keyboard W A S D or the arrow keys
// (← → turn), on a touch screen a stick; drag to look. Walls, railings and
// closed doors stop you, stairs carry you between floors, and one button
// (or Esc) goes back to the 3D view you came from.
//
// The view (live_aboard.js) enters and leaves, hands in the house as it is
// drawn (its floors, their wall pieces with each part's height, the doors'
// leaves as they stand now, the stairs' steps) and puts its camera where the
// walker's eyes are. This file has the rules, as numbers (node runs them in
// tests/js/live_aboard_walk.mjs), and the few controls over the view while
// walking: Stop walking, the stick and a line saying how. It asks for no
// frame itself: the view draws while a key or the stick is held or the eyes
// are still settling on a step, and nothing at all while you stand still.
//
// Plan metres as everywhere in Live Aboard: (x, y) on the plan, y down; the
// view puts plan (x, y) at world (x, ·, y). Heights are world heights.

const _fill = (s, v) => s.replace(/\{(\w+)\}/g, (m, k) => (v && Object.prototype.hasOwnProperty.call(v, k) ? String(v[k]) : m));
const { t } = await import(`./i18n.js${new URL(import.meta.url).search}`).catch(() => ({ t: _fill }));

export const EYE_M = 1.6;            // eyes over the floor
export const BODY_R = 0.2;           // never nearer a wall than this (its middle to the wall's face)
export const WALK_MS = 1.3;          // metres a second
export const HURRY_MS = 2.6;         // with Shift
export const TURN_RS = 1.7;          // ← → turn this many radians a second
export const STEP_M = 0.4;           // the highest step taken up (a stair's riser is about 0.18; a raised room's 0.75 is no step)
export const DROP_M = 0.4;           // a step down deeper than this is a fall: not taken
export const KNEE_M = 0.35;          // a wall's part lower than this over the feet is stepped over (a sill, a threshold)
export const HEAD_M = 1.85;          // a part higher than this is overhead (a door's lintel)
export const EDGE_M = 0.3;           // this near a room's outline is still its floor (rooms drawn with a wall's gap between them)
export const SUB_M = 0.05;           // a move is taken in steps this long: no wall is ever stepped through
export const PITCH_MAX = 1.3;        // look up or down this far at most (radians)
export const LOOK_PER_H = 2.4;       // a drag the view's height turns the eyes this far (radians)
export const STICK_DEAD = 0.12;      // the stick's middle this far out does nothing
export const FOV_DEG = 60;           // the field of view while walking, top to bottom (the orbit view's is 40°)
export const SETTLE_K = 12;          // the eyes follow a step up or down this fast (per second)
export const GROUND_FLOOR_M = 0.6;   // a floor this near the ground stands on it: inside its rooms there is no ground

// The usage report's words are live_aboard_house.js WALK_WAYS (house3d_walk:<way>).

const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

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
  const u = L2 ? clamp(((x - ax) * dx + (y - ay) * dy) / L2, 0, 1) : 0;
  return [Math.hypot(x - ax - dx * u, y - ay - dy * u), u];
}
const nearPoly = (x, y, P, d) => inPoly(x, y, P) || P.some((a, i) => { const b = P[(i + 1) % P.length]; return segDist(x, y, a[0], a[1], b[0], b[1])[0] <= d; });

// ── the house to walk in ─────────────────────────────────────────────────────
/**
 * The house as the walker meets it.
 *   floors  [{id, elev, outdoor, rooms: [{pts, spot?, name?}], holes: [pts] (stair openings), pieces}],
 *           pieces as the view draws them: {pc: {x0, y0, x1, y1, thick, kind, cls, nx, ny, barrier},
 *           els: [{z0, z1, leaf}] (heights over its floor), open: {at} (a door: 0 shut … 1 open) or none}
 *   stairs  [{x, y, rot (degrees, as a piece's), base (the height it stands on), from (its floor's id),
 *           w, d, boxes: [{x0, z0, x1, z1, h, y0}] (its steps and landings, in its own frame: x across,
 *           z to the front, h their tops over its base)}]
 *   opts    {ground: the ground's height round the house (outside), or null;
 *           shut(P): is this door's leaf in the way now (default: open less than half way)}
 */
export function walkWorld(floors, stairs = [], opts = {}){
  const segs = [];
  const fl = (floors || []).map(F => ({ id: String(F.id), elev: num(F.elev) ?? 0, outdoor: !!F.outdoor,
    rooms: (F.rooms || []).filter(r => r && Array.isArray(r.pts) && r.pts.length >= 3),
    holes: (F.holes || []).filter(h => Array.isArray(h) && h.length >= 3) }));
  (floors || []).forEach((F, k) => {
    for (const P of F.pieces || []) {
      const pc = P && P.pc;
      if (!pc || ![pc.x0, pc.y0, pc.x1, pc.y1].every(v => num(v) !== null) || Math.hypot(pc.x1 - pc.x0, pc.y1 - pc.y0) < 0.02) continue;
      const solid = [], leaf = [];
      for (const e of P.els || []) {
        if (num(e.z0) === null || num(e.z1) === null) continue;
        // A door's leaf moves; any other part (a window's glass too) always stands.
        (e.leaf && pc.kind === "door" ? leaf : solid).push([fl[k].elev + e.z0, fl[k].elev + e.z1]);
      }
      if (!solid.length && !leaf.length) continue;
      const half = Math.max(0.01, (num(pc.thick) ?? 0.12) / 2);
      segs.push({ x0: pc.x0, y0: pc.y0, x1: pc.x1, y1: pc.y1, half, solid, leaf, P, floor: fl[k].id,
                  bx0: Math.min(pc.x0, pc.x1) - half, bx1: Math.max(pc.x0, pc.x1) + half,
                  by0: Math.min(pc.y0, pc.y1) - half, by1: Math.max(pc.y0, pc.y1) + half });
    }
  });
  const st = (stairs || []).filter(S => S && [S.x, S.y, S.base, S.w, S.d].every(v => num(v) !== null)).map(S => {
    const a = (num(S.rot) ?? 0) * Math.PI / 180;
    return { ...S, from: S.from === undefined || S.from === null ? null : String(S.from), u: [Math.cos(a), Math.sin(a)], v: [-Math.sin(a), Math.cos(a)],
             boxes: (S.boxes || []).filter(b => b && [b.x0, b.z0, b.x1, b.z1, b.h].every(q => num(q) !== null)) };
  });
  const shut = typeof opts.shut === "function" ? opts.shut : (P) => !(P && P.open && num(P.open.at) !== null && P.open.at >= 0.5);
  return { floors: fl, segs, stairs: st, ground: num(opts.ground), shut };
}

/** Does this wall piece stand in the way of someone whose feet are at `foot`? */
export function blocks(world, s, foot){
  const lo = foot + KNEE_M, hi = foot + HEAD_M, over = (r) => r[1] > lo && r[0] < hi;
  return s.solid.some(over) || (s.leaf.some(over) && !!world.shut(s.P));
}
/** The wall pieces in the way, within reach of (x, y), for feet at `foot`. */
function near(world, x, y, foot, r){
  return world.segs.filter(s => x >= s.bx0 - r && x <= s.bx1 + r && y >= s.by0 - r && y <= s.by1 + r && blocks(world, s, foot));
}
/** (x, y) moved out of every wall in the way (sliding along it), or null if it can't be. */
export function pushOut(world, x, y, foot, R = BODY_R){
  const list = near(world, x, y, foot, R + 0.3);
  for (let it = 0; it < 6; it++) {
    let moved = false;
    for (const s of list) {
      const [d, u] = segDist(x, y, s.x0, s.y0, s.x1, s.y1), need = R + s.half;
      if (d >= need - 1e-9) continue;
      const cx = s.x0 + (s.x1 - s.x0) * u, cy = s.y0 + (s.y1 - s.y0) * u;
      let nx = x - cx, ny = y - cy;
      if (d < 1e-6) { const L = Math.hypot(s.x1 - s.x0, s.y1 - s.y0) || 1; nx = -(s.y1 - s.y0) / L; ny = (s.x1 - s.x0) / L; }
      else { nx /= d; ny /= d; }
      x = cx + nx * (need + 1e-6); y = cy + ny * (need + 1e-6);
      moved = true;
    }
    if (!moved) return [x, y];
  }
  return list.every(s => segDist(x, y, s.x0, s.y0, s.x1, s.y1)[0] >= R + s.half - 1e-4) ? [x, y] : null;
}

/** A plan point in a flight's own frame: [across, to the front]. */
const localOf = (S, x, y) => { const dx = x - S.x, dy = y - S.y; return [dx * S.u[0] + dy * S.u[1], dx * S.v[0] + dy * S.v[1]]; };
/** What there is to stand on at (x, y): [{y (its height), floor (id, or null outside), stair (or null)}]. */
export function supportsAt(world, x, y){
  const out = [], covered = new Set();
  let onStairs = false;
  for (const S of world.stairs) {
    const [lx, lz] = localOf(S, x, y);
    if (Math.abs(lx) > S.w / 2 + 1e-6 || Math.abs(lz) > S.d / 2 + 1e-6) continue;
    onStairs = true;
    let low = false;
    for (const b of S.boxes) {
      if (lx < b.x0 - 1e-6 || lx > b.x1 + 1e-6 || lz < b.z0 - 1e-6 || lz > b.z1 + 1e-6) continue;
      out.push({ y: S.base + b.h, floor: S.from, stair: S });
      if ((num(b.y0) ?? 0) < KNEE_M) low = true;                 // a block down to the floor: nobody stands under it
    }
    if (low) covered.add(`${S.from}@${S.base}`);
  }
  for (const F of world.floors) {
    if (covered.has(`${F.id}@${F.elev}`)) continue;
    if (F.holes.some(P => inPoly(x, y, P))) continue;            // a stair's opening: no floor there
    if (F.rooms.some(r => nearPoly(x, y, r.pts, EDGE_M))) out.push({ y: F.elev, floor: F.id, stair: null });
  }
  // The ground round the house: outside the rooms of the floors standing on it, and off the stairs.
  const g = world.ground;
  if (g !== null && !onStairs && !world.floors.some(F => F.elev <= g + GROUND_FLOOR_M && F.rooms.some(r => inPoly(x, y, r.pts)))) {
    out.push({ y: g, floor: null, stair: null });
  }
  return out;
}
/** Of what there is to stand on, what feet at `foot` step onto: the nearest in height within a step; none, null. */
export function pickSupport(list, foot){
  let best = null;
  for (const s of list) {
    if (s.y > foot + STEP_M + 1e-6 || s.y < foot - DROP_M - 1e-6) continue;
    if (!best || Math.abs(s.y - foot) < Math.abs(best.y - foot) - 1e-9) best = s;
  }
  return best;
}

// ── the walker ───────────────────────────────────────────────────────────────
/** A walker {x, y, foot (the height the feet stand at), eyeFoot (where the eyes follow it), yaw, pitch, floor}. */
export function walker(spot){
  const foot = num(spot.foot) ?? 0;
  return { x: spot.x, y: spot.y, foot, eyeFoot: foot, yaw: num(spot.yaw) ?? 0, pitch: 0, floor: spot.floor ?? null };
}
function tryAt(world, w, x, y){
  const p = pushOut(world, x, y, w.foot);
  if (!p) return false;
  const s = pickSupport(supportsAt(world, p[0], p[1]), w.foot);
  if (!s) return false;
  // At the new height, a wall that is in the way there (the floor above's, near the top of a flight).
  if (Math.abs(s.y - w.foot) > 1e-6 && !pushOut(world, p[0], p[1], s.y)) return false;
  w.x = p[0]; w.y = p[1]; w.foot = s.y;
  if (!s.stair && s.floor !== null) w.floor = s.floor;
  return true;
}
/** Move the walker by (dx, dy) on the plan, as far as walls, closed doors and the floor let it. True if it moved. */
export function moveBy(world, w, dx, dy){
  const n = Math.max(1, Math.ceil(Math.hypot(dx, dy) / SUB_M)), sx = dx / n, sy = dy / n, x0 = w.x, y0 = w.y;
  for (let i = 0; i < n; i++) {
    if (!(tryAt(world, w, w.x + sx, w.y + sy) || tryAt(world, w, w.x + sx, w.y) || tryAt(world, w, w.x, w.y + sy))) break;
  }
  return Math.hypot(w.x - x0, w.y - y0) > 1e-6;
}
/** Where the walker looks along, on the plan: forward and to the right. yaw is the orbit camera's theta. */
export const forwardOf = (yaw) => [-Math.sin(yaw), -Math.cos(yaw)];
export const rightOf = (yaw) => [Math.cos(yaw), -Math.sin(yaw)];

/** One frame: turn and move by `inp` ({fwd, side, turn: -1…1, hurry}) over dt seconds; the eyes follow the feet.
 *  {moved, turned, settling (the eyes still on their way), eyes (they moved), floorFrom (the floor left for another, or null)}. */
export function walkStep(world, w, inp, dt){
  const d = clamp(num(dt) ?? 0, 0, 0.1), was = w.floor;
  const turn = clamp(num(inp && inp.turn) ?? 0, -1, 1), fwd = clamp(num(inp && inp.fwd) ?? 0, -1, 1), side = clamp(num(inp && inp.side) ?? 0, -1, 1);
  if (turn) w.yaw += turn * TURN_RS * d;
  let moved = false;
  const m = Math.hypot(fwd, side);
  if (m > 1e-6) {
    const k = (inp.hurry ? HURRY_MS : WALK_MS) * d / Math.max(1, m), f = forwardOf(w.yaw), r = rightOf(w.yaw);
    moved = moveBy(world, w, (f[0] * fwd + r[0] * side) * k, (f[1] * fwd + r[1] * side) * k);
  }
  const gap = w.foot - w.eyeFoot, eye0 = w.eyeFoot;
  w.eyeFoot = Math.abs(gap) < 0.003 ? w.foot : w.eyeFoot + gap * Math.min(1, SETTLE_K * d);
  return { moved, turned: !!turn, settling: w.eyeFoot !== w.foot, eyes: w.eyeFoot !== eye0, floorFrom: was !== null && w.floor !== was ? was : null };
}
/** A drag of (dx, dy) px on a view h px high: the eyes turn with it (the house follows the finger, as in orbit). */
export function lookBy(w, dx, dy, h){
  const k = LOOK_PER_H / Math.max(200, num(h) ?? 600);
  w.yaw += (num(dx) ?? 0) * k;
  w.pitch = clamp(w.pitch + (num(dy) ?? 0) * k, -PITCH_MAX, PITCH_MAX);
}
/** The orbit camera that puts the eyes there: {theta, phi, radius, target: [x, y, z]}: the view's camera
 *  stands radius from the target, at (sinφ sinθ, cosφ, sinφ cosθ) from it. */
export function camOf(w, r = 1){
  const c = Math.cos(w.pitch), eye = [w.x, w.eyeFoot + EYE_M, w.y];
  const f = forwardOf(w.yaw), d = [f[0] * c, Math.sin(w.pitch), f[1] * c];
  return { theta: w.yaw, phi: Math.PI / 2 + w.pitch, radius: r, target: eye.map((v, i) => v + d[i] * r), eye };
}

// ── the input ────────────────────────────────────────────────────────────────
// By the key's place (e.code), so a French or German keyboard walks with the keys in the same place.
const KEYMAP = { KeyW: ["fwd", 1], ArrowUp: ["fwd", 1], KeyS: ["fwd", -1], ArrowDown: ["fwd", -1],
                 KeyA: ["side", -1], KeyD: ["side", 1], ArrowLeft: ["turn", 1], ArrowRight: ["turn", -1] };
export const isWalkKey = (code) => Object.prototype.hasOwnProperty.call(KEYMAP, code);
/** The keys held (a Set of e.code), as {fwd, side, turn, hurry}. */
export function keysInput(held, hurry = false){
  const o = { fwd: 0, side: 0, turn: 0, hurry: !!hurry };
  for (const c of held || []) { const k = KEYMAP[c]; if (k) o[k[0]] += k[1]; }
  o.fwd = clamp(o.fwd, -1, 1); o.side = clamp(o.side, -1, 1); o.turn = clamp(o.turn, -1, 1);
  return o;
}
/** The stick pushed (dx, dy) px from its middle, r px its reach: {fwd, side}, nothing inside its dead middle. */
export function stickInput(dx, dy, r){
  const R = Math.max(1, num(r) ?? 1), x = (num(dx) ?? 0) / R, y = (num(dy) ?? 0) / R, m = Math.hypot(x, y);
  if (m <= STICK_DEAD) return { fwd: 0, side: 0 };
  const k = Math.min(1, (m - STICK_DEAD) / (1 - STICK_DEAD)) / m;
  return { fwd: -y * k, side: x * k };
}

// ── where a walk starts ──────────────────────────────────────────────────────
const FRONT = /front|entr|main|haupt|eingang|vorder|voordeur|entrée/i;
/** Where a walk starts: just inside the front door (an outside door; one named Front, Entry, Main… first, a
 *  garage door last; on the floor at 0 m, the usual main floor, before a basement's or an upper floor's),
 *  facing in; else the middle of that floor's biggest room.
 *  prefer: {floor, x, y} (a room open in the view: its middle). yaw: which way to face when no door says.
 *  {x, y, foot, yaw, floor}, or null with nowhere to stand. */
export function startSpot(world, floors, prefer = null, yaw = 0){
  const ok = (s) => { if (!s) return null; const p = pushOut(world, s.x, s.y, s.foot); return p && pickSupport(supportsAt(world, p[0], p[1]), s.foot) ? { ...s, x: p[0], y: p[1] } : null; };
  if (prefer) {
    const F = world.floors.find(f => f.id === String(prefer.floor));
    const s = F ? ok({ x: prefer.x, y: prefer.y, foot: F.elev, yaw, floor: F.id }) : null;
    if (s) return s;
  }
  // The floors, the one nearest 0 m first (the lower of two as near): the main floor before a basement.
  const rank = (F) => Math.abs(num(F.elev) ?? 0) * 2 + ((num(F.elev) ?? 0) > 0 ? 1 : 0);
  const indoor = (floors || []).filter(F => !F.outdoor && (F.rooms || []).length).sort((a, b) => rank(a) - rank(b));
  if (!indoor.length) return null;
  const doors = [];
  for (const F of indoor) {
    for (const P of F.pieces || []) {
      const pc = P && P.pc;
      if (!pc || pc.cls !== "ext" || pc.loftRail || !["door", "doorway", "open"].includes(pc.kind)) continue;
      const len = Math.hypot(pc.x1 - pc.x0, pc.y1 - pc.y0), name = String((pc.barrier && pc.barrier.name) || "");
      doors.push({ F, pc, score: (FRONT.test(name) ? 0 : 2) + (pc.kind === "door" ? 0 : 1) + (len > 1.8 ? 4 : 0) });
    }
  }
  doors.sort((a, b) => a.score - b.score || rank(a.F) - rank(b.F));
  for (const { F, pc } of doors) {
    const mx = (pc.x0 + pc.x1) / 2, my = (pc.y0 + pc.y1) / 2, n = [num(pc.nx) ?? 0, num(pc.ny) ?? 0];
    for (const side of [1, -1]) {
      if (!F.rooms.some(r => inPoly(mx + n[0] * side * 0.5, my + n[1] * side * 0.5, r.pts))) continue;
      for (const dIn of [0.7, 0.9, 1.2]) {
        const s = ok({ x: mx + n[0] * side * dIn, y: my + n[1] * side * dIn, foot: num(F.elev) ?? 0, yaw: Math.atan2(-n[0] * side, -n[1] * side), floor: String(F.id) });
        if (s) return s;
      }
    }
  }
  const area = (P) => Math.abs(P.reduce((a, p, i) => { const q = P[(i + 1) % P.length]; return a + p[0] * q[1] - q[0] * p[1]; }, 0)) / 2;
  const rooms = indoor.flatMap(F => F.rooms.map(r => ({ F, r }))).sort((a, b) => rank(a.F) - rank(b.F) || area(b.r.pts) - area(a.r.pts));
  for (const { F, r } of rooms) {
    const c = r.spot && num(r.spot.x) !== null ? [r.spot.x, r.spot.y] : [r.pts.reduce((a, p) => a + p[0], 0) / r.pts.length, r.pts.reduce((a, p) => a + p[1], 0) / r.pts.length];
    const s = ok({ x: c[0], y: c[1], foot: num(F.elev) ?? 0, yaw, floor: String(F.id) });
    if (s) return s;
  }
  return null;
}

// ── the controls over the view while walking ─────────────────────────────────
export const WALK_CSS = `.la3d.la3d-walking > :not(canvas):not(style):not(.la3d-walkui):not(.la3d-toast):not(.la3d-fps){display:none!important}
.la3d-walkui{position:absolute;inset:0;z-index:4;pointer-events:none;display:none}
.la3d.la3d-walking .la3d-walkui{display:block}
.la3d-walkui button{pointer-events:auto}
.la3d-walkstop{all:unset;box-sizing:border-box;position:absolute;right:12px;top:12px;padding:9px 16px;border-radius:999px;cursor:pointer;
  font:700 14px/1.2 system-ui,"Segoe UI",Roboto,sans-serif;color:#e2e8f0;background:rgba(6,14,9,.86);border:1px solid rgba(120,190,155,.4);
  box-shadow:0 4px 14px rgba(0,0,0,.35);min-height:44px}
.la3d-walkstop:hover,.la3d-walkstop:focus-visible{border-color:#52b788;background:rgba(20,48,34,.92)}
.la3d-walktip{position:absolute;left:50%;top:12px;transform:translateX(-50%);max-width:calc(100% - 220px);padding:5px 12px;border-radius:999px;
  background:rgba(6,14,9,.6);color:#cbd5e1;font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.la3d.la3d-narrow .la3d-walktip{left:12px;transform:none;max-width:calc(100% - 190px)}
.la3d-walkstick{position:absolute;left:24px;bottom:24px;width:132px;height:132px;border-radius:50%;box-sizing:border-box;pointer-events:auto;
  touch-action:none;background:rgba(6,14,9,.42);border:2px solid rgba(203,213,225,.45);display:none}
.la3d-walkstick.on{display:block}
.la3d-walkknob{position:absolute;left:50%;top:50%;width:56px;height:56px;margin:-28px 0 0 -28px;border-radius:50%;
  background:rgba(226,232,240,.82);box-shadow:0 2px 8px rgba(0,0,0,.45);pointer-events:none}`;

/**
 * The walk's own controls and input. ctx: {root, canvas, guard, world() (walkWorld's, as drawn now),
 * apply(cam) (the view puts its camera there), render() (one frame), stop() (the view goes back to orbit),
 * countOnce(name) (the report, once per page load), coarse() (a touch screen: the stick shows at once)}.
 * {on, open(spot), close(), tick(now) → true when the eyes moved, moving(), key(e, down), lookDown(e),
 *  lookMove(e), lookUp(e), state(), dispose()}.
 */
export function createWalk(ctx){
  const { root, canvas, guard } = ctx;
  const d = (tag, cls) => { const n = document.createElement(tag); if (cls) n.className = cls; return n; };
  let ui = null, stickEl = null, knob = null, tipEl = null, w = null, last = 0, on = false;
  const held = new Set();
  let hurry = false, stick = null, stickIn = { fwd: 0, side: 0 }, look = null;
  function build(){
    ui = d("div", "la3d-walkui");
    ui.setAttribute("data-la3d-walkui", "");
    const css = d("style");
    css.textContent = WALK_CSS;
    const stop = d("button", "la3d-walkstop");
    stop.type = "button";
    stop.textContent = t("✕ Stop walking");
    stop.title = t("Back to the 3D view you came from (Esc)");
    stop.setAttribute("data-la3d-walkstop", "");
    stop.addEventListener("click", guard((e) => { e.stopPropagation(); ctx.stop(); }));
    tipEl = d("div", "la3d-walktip");
    tipEl.setAttribute("role", "note");
    stickEl = d("div", "la3d-walkstick");
    stickEl.setAttribute("data-la3d-walkstick", "");
    stickEl.setAttribute("role", "img");
    stickEl.setAttribute("aria-label", t("Walk: push the stick the way you want to go"));
    knob = d("div", "la3d-walkknob");
    stickEl.appendChild(knob);
    stickEl.addEventListener("pointerdown", guard((e) => {
      if (stick) return;
      const r = stickEl.getBoundingClientRect();
      stick = { id: e.pointerId, cx: r.left + r.width / 2, cy: r.top + r.height / 2, r: Math.max(20, r.width / 2) };
      try { stickEl.setPointerCapture(e.pointerId); } catch (_) { /* followed on the stick anyway */ }
      if (e.preventDefault) e.preventDefault();
      stickMove(e);
    }));
    stickEl.addEventListener("pointermove", guard((e) => stickMove(e)));
    const end = guard((e) => { if (!stick || e.pointerId !== stick.id) return; stick = null; stickIn = { fwd: 0, side: 0 }; knob.style.transform = ""; });
    stickEl.addEventListener("pointerup", end);
    stickEl.addEventListener("pointercancel", end);
    ui.append(css, tipEl, stickEl, stop);
    root.appendChild(ui);
    root.addEventListener("keydown", guard((e) => { if (on && key(e, true)) { if (e.preventDefault) e.preventDefault(); if (e.stopPropagation) e.stopPropagation(); } }));
    root.addEventListener("keyup", guard((e) => { if (on) key(e, false); }));
    // The keys go when the keyboard does (another window, a tap elsewhere): none stays held down.
    root.addEventListener("focusout", guard((e) => { if (!e || !e.relatedTarget || !root.contains(e.relatedTarget)) { held.clear(); hurry = false; } }));
  }
  function stickMove(e){
    if (!stick || e.pointerId !== stick.id) return;
    const dx = e.clientX - stick.cx, dy = e.clientY - stick.cy, m = Math.hypot(dx, dy), k = m > stick.r ? stick.r / m : 1;
    knob.style.transform = `translate(${Math.round(dx * k)}px,${Math.round(dy * k)}px)`;
    stickIn = stickInput(dx, dy, stick.r);
    if (stickIn.fwd || stickIn.side) { ctx.countOnce("house3d_walk:stick"); kick(); }
  }
  function showStick(){ if (stickEl && !stickEl.classList.contains("on")) { stickEl.classList.add("on"); paintTip(); } }
  function paintTip(){
    if (!tipEl) return;
    tipEl.textContent = stickEl && stickEl.classList.contains("on") ? t("Stick to walk · drag to look")
      : t("W A S D or ↑ ↓ to walk · ← → to turn · drag to look · Shift to hurry · Esc to stop");
  }
  /** Something to move: the clock starts from now, and a frame is asked for. */
  function kick(){ if (!last) last = performance.now(); ctx.render(); }
  function key(e, down){
    if (!e) return false;
    const tag = String((e.target && e.target.tagName) || "").toLowerCase();
    if (tag === "input" || tag === "textarea" || tag === "select") return false;
    if (e.key === "Shift") { hurry = down; return false; }
    if (down && e.key === "Escape") { ctx.stop(); return true; }
    if (e.altKey || e.ctrlKey || e.metaKey) return false;
    if (!isWalkKey(e.code)) return false;
    if (down) { held.add(e.code); hurry = !!e.shiftKey; ctx.countOnce("house3d_walk:keys"); kick(); }
    else held.delete(e.code);
    return true;
  }
  function input(){
    const k = keysInput(held, hurry);
    return { fwd: clamp(k.fwd + stickIn.fwd, -1, 1), side: clamp(k.side + stickIn.side, -1, 1), turn: k.turn, hurry: k.hurry };
  }
  const active = () => { const i = input(); return !!(i.fwd || i.side || i.turn); };
  return {
    get on(){ return on; },
    open(spot){
      if (!ui) build();
      w = walker(spot);
      held.clear(); hurry = false; stick = null; stickIn = { fwd: 0, side: 0 }; look = null; last = 0;
      if (knob) knob.style.transform = "";
      stickEl.classList.toggle("on", !!(ctx.coarse && ctx.coarse()));
      paintTip();
      on = true;
      try { canvas.focus({ preventScroll: true }); } catch (_) { /* the keys still reach the view once it is pressed */ }
    },
    close(){
      on = false; w = null; held.clear(); stick = null; stickIn = { fwd: 0, side: 0 }; look = null; last = 0;
      if (knob) knob.style.transform = "";
    },
    /** The walker, as it stands (the view's camera follows it). */
    walker(){ return w; },
    /** One frame at `now` (ms): true when the eyes moved or turned (the camera follows). */
    tick(now){
      if (!on || !w) return false;
      const dt = last ? (now - last) / 1000 : 0;
      last = now;
      const i = input();
      const r = walkStep(ctx.world(), w, i, dt);
      if (r.floorFrom !== null) ctx.countOnce("house3d_walk:stairs");
      if (!active() && !r.settling) last = 0;                    // still: the next move starts its own clock
      return r.moved || r.turned || r.eyes;
    },
    /** Another frame wanted: a key or the stick held, or the eyes still settling on a step. */
    moving(){ return on && !!w && (active() || w.eyeFoot !== w.foot); },
    key,
    lookDown(e){
      if (!on) return;
      if (e.pointerType === "touch" || e.pointerType === "pen") showStick();
      if (look) return;
      look = { id: e.pointerId, x: e.clientX, y: e.clientY };
      try { canvas.setPointerCapture(e.pointerId); } catch (_) { /* followed on the canvas anyway */ }
      try { canvas.focus({ preventScroll: true }); } catch (_) { /* a nicety */ }
    },
    lookMove(e){
      if (!on || !w || !look || e.pointerId !== look.id) return;
      const dx = e.clientX - look.x, dy = e.clientY - look.y;
      look.x = e.clientX; look.y = e.clientY;
      if (!dx && !dy) return;
      lookBy(w, dx, dy, canvas.clientHeight || 600);
      ctx.countOnce("house3d_walk:drag");
      ctx.apply(camOf(w));
    },
    lookUp(e){
      if (!look || (e && e.pointerId !== look.id)) return;
      try { canvas.releasePointerCapture(look.id); } catch (_) { /* fine */ }
      look = null;
    },
    state(){
      return { on, walker: w ? { ...w } : null, keys: [...held], hurry, stick: { ...stickIn }, stickShown: !!(stickEl && stickEl.classList.contains("on")),
               looking: !!look, tip: tipEl ? tipEl.textContent : "" };
    },
    dispose(){ this.close(); if (ui && ui.parentNode) ui.parentNode.removeChild(ui); ui = null; },
  };
}
