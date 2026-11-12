// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
// See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
//
// Outdoor spaces, for every view of the house: what kind of space a room is
// (indoors, an open deck or patio, a covered patio or porch, or ground on an
// Outside floor: room_meta[name].space, else worked out), and what is drawn
// on an outdoor room's floor (room_meta[name].surface). Both are set on the
// Rooms page. Live Aboard (live_aboard_house.js, live_aboard.js), the doors'
// rules (door_types.js), the flat Map (iso_lights.js) and the Rooms page read
// these; nothing else keeps its own copy. presence_rules.outdoor_kind is the
// same rule for the server (tests/test_outdoor_kind.py holds them alike).
//
// Imports nothing and draws nothing; node runs it as it is.

// ── what kind of space ──────────────────────────────────────────────────────
/** A room outdoors by its name: the guess when nothing is stored. */
export const OUTDOOR_NAME = /\b(deck|patio|porch|balcony|terrace|veranda|yard|garden|lawn|driveway|outside|outdoor)\b/i;
/** A name that says the room belongs to a floor of the house, not the Outside floor. */
export const FLOOR_SPACE_NAME = /\b(deck|patio|porch|balcony)\b/i;
// model_store.ROOM_SPACES holds the same list. No key: worked out.
export const SPACES = ["indoor", "open", "covered"];

/** A room's stored kind of space, or null (worked out). */
export function storedSpace(model, name){
  const m = model && model.room_meta && model.room_meta[name];
  return m && SPACES.includes(m.space) ? m.space : null;
}

/** The one rule: what kind of space a room is. "ground" on an Outside floor
 *  (ground: its floor is outdoors), else the kind stored for it, else worked
 *  out: indoors unless its name says outdoors (OUTDOOR_NAME), and indoors too
 *  where it stands within a lower floor's room that rises past it (within: a
 *  gallery called "Deck A" in a hall); an outdoor room with a room of a
 *  higher floor over most of it (over) is covered, else open. */
export function outdoorKind({ name, ground = false, stored = null, within = false, over = false }){
  if (ground) return "ground";
  if (SPACES.includes(stored)) return stored;
  if (!OUTDOOR_NAME.test(String(name || "")) || within) return "indoor";
  return over ? "covered" : "open";
}

/** The facts the rule works from, for each of `rooms` [{name, pts (plan
 *  metres), elev (its floor's real level, m), h (its height), ground (on an
 *  Outside floor), stored (its stored kind or null)}], in order:
 *  {within, over, coverH}. within: its name says outdoors but it stands in a
 *  lower floor's indoor room that rises a railing's height past it (overlap:
 *  two rooms share area on the plan; Live Aboard hands in its own). over: a
 *  room of a higher floor (0.5 m up or more, indoor or a deck) over most of
 *  it; coverH: how far above it the lowest such floor is. Live Aboard
 *  (readRooms) and the Rooms page both read the house through this. */
export function spaceFacts(rooms, overlap = shareArea){
  const named = (r) => !r.ground && OUTDOOR_NAME.test(String(r.name || ""));
  const outdoor = rooms.map(r => outdoorKind({ name: r.name, ground: r.ground, stored: r.stored }) !== "indoor");
  const out = rooms.map(() => ({ within: false, over: false, coverH: null }));
  rooms.forEach((r, i) => {
    out[i].within = named(r) && rooms.some((R, j) => !outdoor[j] && !R.ground && R.elev < r.elev - 1e-3
                                            && R.elev + R.h >= r.elev + RAIL_M && overlap(R, r));
    if (out[i].within && !r.stored) outdoor[i] = false;
  });
  const boxes = rooms.map(r => boxOf(r.pts));
  const meet = (a, b) => a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];
  rooms.forEach((r, i) => {
    if (r.ground || !(outdoor[i] || named(r))) return;
    const ups = rooms.filter((R, j) => j !== i && !R.ground && R.elev > r.elev + 0.5 && meet(boxes[j], boxes[i]));
    out[i].over = underShare(r.pts, ups.map(R => R.pts)) > 0.5;
    if (out[i].over) out[i].coverH = Math.min(...ups.map(R => R.elev - r.elev));
  });
  return out;
}
// A railing's height (the 3D house's RAIL_H, the same metre).
const RAIL_M = 1.0;
function boxOf(P){
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of P) { x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]); x1 = Math.max(x1, p[0]); y1 = Math.max(y1, p[1]); }
  return [x0, y0, x1, y1];
}
/** How much of polygon P (plan metres) is under the polygons in `above`,
 *  0..1: a grid of points over P, those inside it counted, then those also
 *  inside one of `above`. */
function underShare(P, above){
  if (!Array.isArray(P) || P.length < 3 || !above || !above.length) return 0;
  const [x0, y0, x1, y1] = boxOf(P), N = 16, dx = (x1 - x0) / N, dy = (y1 - y0) / N;
  let n = 0, under = 0;
  for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
    const x = x0 + (i + 0.5) * dx, y = y0 + (j + 0.5) * dy;
    if (!inside(x, y, P)) continue;
    n++;
    if (above.some(Q => inside(x, y, Q))) under++;
  }
  return n ? under / n : 0;
}
const shareArea = (A, B) => underShare(A.pts, [B.pts]) > 0 || underShare(B.pts, [A.pts]) > 0;
function inside(x, y, P){
  let c = false;
  for (let i = 0, j = P.length - 1; i < P.length; j = i++) {
    const a = P[i], b = P[j];
    if ((a[1] > y) !== (b[1] > y) && x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0]) c = !c;
  }
  return c;
}

// ── surfaces ─────────────────────────────────────────────────────────────────
// model_store.ROOM_SURFACES holds the same list. No key: the standard floor,
// drawn as before.
export const SURFACES = ["pavers_2ft"];
/** One grey landscaping tile, 2 ft square, in metres; its grey and its
 *  joints' darker one (a mid grey: it reads as concrete in the Night and Day
 *  themes, and inverted in Light, as a drawing keeps its colours in each). */
export const PAVER_M = 0.6096, PAVER_GREY = "#98968f", PAVER_JOINT = "#45443f";
/** True for an outdoor room (by the look's own rule) paved with tiles. */
export const paved = (outdoor, surface) => !!outdoor && surface === "pavers_2ft";

/** A room's stored surface, or null (standard). */
export function roomSurface(model, name){
  const m = model && model.room_meta && model.room_meta[name];
  return m && SURFACES.includes(m.surface) ? m.surface : null;
}

/** Where a room's tiles are laid from: its longest edge's first corner (o),
 *  running along that edge (e, a unit vector). So the grid sits square to
 *  the room and stays put whatever the camera does. pts: plan metres. */
export function paverFrame(pts){
  let best = null;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length], l = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (!best || l > best.l + 1e-9) best = { a, b, l };
  }
  const l = best && best.l > 0 ? best.l : 1;
  return best ? { ox: best.a[0], oy: best.a[1], ex: (best.b[0] - best.a[0]) / l, ey: (best.b[1] - best.a[1]) / l } : { ox: 0, oy: 0, ex: 1, ey: 0 };
}

/** A plan point in tiles from that corner: [along the edge, across it]. */
export function paverUv(f, x, y){
  const dx = x - f.ox, dy = y - f.oy;
  return [(dx * f.ex + dy * f.ey) / PAVER_M, (dy * f.ex - dx * f.ey) / PAVER_M];
}
