// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
// See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
//
// Where something PadSpan knows only by its room stands in that room: one
// rule for every view that draws one (Live Aboard and the flat Atlas through
// their tracked layer, the Overview's house map, Traceback's playback).
//
//   the middle  the mean of the room's corners when that is inside it, else
//               the point furthest from its walls (an L or a U whose mean
//               falls in a wall or the room next door)
//   the spread  the first one there stands at the middle; each next one steps
//               out round it (roomStagger), to the first step that is inside
//               the room and APART_M from everyone standing on that floor
//               already, so two in one room never sit on one point
//
// Metres in, metres out; each view projects the spot itself. No imports.

// A step out from the middle for each one there before (m, growing to the
// second), and how far apart two must stand (m).
export const ROOM_FAN_M = [0.3, 1.2], APART_M = 0.5;

/** Is (x, y) inside the outline P ([[x, y], ...])? */
export function insideRoom(x, y, P){
  let c = false;
  for (let i = 0, j = P.length - 1; i < P.length; j = i++) {
    const a = P[i], b = P[j];
    if ((a[1] > y) !== (b[1] > y) && x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0]) c = !c;
  }
  return c;
}
/** How far (x, y) is from the nearest side of P. */
function clearance(x, y, P){
  let best = Infinity;
  for (let i = 0, j = P.length - 1; i < P.length; j = i++) {
    const [ax, ay] = P[j], [bx, by] = P[i], dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy;
    const t = L2 ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / L2)) : 0;
    best = Math.min(best, Math.hypot(x - ax - t * dx, y - ay - t * dy));
  }
  return best;
}
/** The point of P furthest from its sides (searched on a grid, then a finer
 *  one round the best): always inside it, whatever its shape. */
function deepest(P){
  const xs = P.map(p => p[0]), ys = P.map(p => p[1]);
  let x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys), best = null;
  for (let round = 0; round < 2; round++) {
    const N = 24, sx = (x1 - x0) / N, sy = (y1 - y0) / N;
    for (let i = 0; i <= N; i++) for (let j = 0; j <= N; j++) {
      const x = x0 + i * sx, y = y0 + j * sy;
      if (!insideRoom(x, y, P)) continue;
      const c = clearance(x, y, P);
      if (!best || c > best.c) best = { x, y, c };
    }
    if (!best) break;
    x0 = best.x - sx; x1 = best.x + sx; y0 = best.y - sy; y1 = best.y + sy;
  }
  return best;
}
/** A room's middle, from its outline in metres: [x, y], or null for fewer
 *  than three usable corners. */
export function middleOf(pts){
  const P = Array.isArray(pts) ? pts.map(p => [Number(p && p[0]), Number(p && p[1])]) : [];
  if (P.length < 3 || P.some(p => !Number.isFinite(p[0]) || !Number.isFinite(p[1]))) return null;
  const x = P.reduce((a, p) => a + p[0], 0) / P.length, y = P.reduce((a, p) => a + p[1], 0) / P.length;
  if (insideRoom(x, y, P)) return [x, y];
  const d = deepest(P);
  return d ? [d.x, d.y] : [x, y];
}
/** The i-th one known only by a room stands this far (m) and this way from
 *  its middle: the first at the middle, the next stepping out round it (2.4
 *  rad a step, a little further each time). */
export function roomStagger(i){
  if (!i) return [0, 0];
  const r = Math.min(ROOM_FAN_M[1], ROOM_FAN_M[0] * (1 + i));
  return [Math.cos(i * 2.4) * r, Math.sin(i * 2.4) * r];
}
/** Where in a room someone (or something) known only by it stands. mid =
 *  {x, y, floor_id, pts (its outline, or null: a round room, any step
 *  counts)}; stands = [{x, y, floor_id}], who stands already. Its middle,
 *  else the first step out round it that is inside the room and APART_M
 *  from everyone on that floor; every step taken: the first inside. */
export function spotIn(mid, stands){
  const near = (x, y) => (stands || []).some(s => s.floor_id === mid.floor_id && Math.hypot(s.x - x, s.y - y) < APART_M);
  let first = null;
  for (let i = 0; i < 24; i++) {
    const [dx, dy] = roomStagger(i), x = mid.x + dx, y = mid.y + dy;
    if (mid.pts && !insideRoom(x, y, mid.pts)) continue;
    if (!first) first = { x, y, floor_id: mid.floor_id };
    if (!near(x, y)) return { x, y, floor_id: mid.floor_id };
  }
  return first || { x: mid.x, y: mid.y, floor_id: mid.floor_id };
}
