// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
// See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
//
// Outdoor spaces, for every view of the house: what is drawn on an outdoor
// room's floor (room_meta[name].surface, set on the Rooms page). Live Aboard
// (live_aboard.js), the flat Map (iso_lights.js) and the Rooms page read
// these; nothing else keeps its own copy.
//
// Imports nothing and draws nothing; node runs it as it is.

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
