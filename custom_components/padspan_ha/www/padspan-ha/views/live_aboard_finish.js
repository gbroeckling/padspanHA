// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
// See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
//
// Live Aboard's floors and walls (the owner's item 22, 2026-11-23): per room a
// floor material from a short list and a wall colour, one wall a colour of its
// own, and per floor the colour of its outside walls. Chosen in Furnish (a tap
// on a room's floor, live_aboard_furnish.js), kept in the 3D file
// (house3d_store.py "rooms" and "floors", so a PadSpan backup carries them),
// drawn by the view (live_aboard.js) in Live Aboard's own looks, Classic and
// Studio. A Showcase theme, or the Atlas's look, draws the house its own way
// and keeps it: the theme wins. No three.js, no page, no picture files: the
// materials are a colour and a few lines the view paints in code, as the
// paving (outdoor_space.js) is. Node runs this for real
// (tests/js/live_aboard_finish.mjs).
//
// In the 3D file:
//   rooms   {"<room name>": {floor, wall, walls}}: floor one of FLOOR_MATERIALS
//           (another short word, a newer version's, is kept and drawn as the
//           room's colour); wall "#rrggbb", its walls inside; walls {"<n>":
//           "#rrggbb"}, wall n of its outline (from its first corner, as the
//           view reads the outline) a colour of its own
//   floors  {"<floor id>": {outside: "#rrggbb"}}: that floor's outside walls
// Nothing set: nothing here changes a thing (wallSides answers null, floorOf
// null), so a house looks exactly as before until someone picks.

export const FLOOR_MATERIALS = ["wood", "light_wood", "tile", "stone", "carpet", "concrete"];
// Each material as drawn: its colour (base), and what is laid over it, one
// repeat tile_m metres square from the room's longest wall (pattern: planks
// with their joints and grain, a grid of joints, or nothing), the lines'
// colour (joint), and flecks (cast stone and concrete).
export const MATERIALS = Object.freeze({
  wood:       Object.freeze({ base: "#8a5d3b", pattern: "planks", tile_m: 1.2, joint: "#2e1d10" }),
  light_wood: Object.freeze({ base: "#c9a77c", pattern: "planks", tile_m: 1.2, joint: "#6e5134" }),
  tile:       Object.freeze({ base: "#dcd8cf", pattern: "grid", tile_m: 0.3, joint: "#8c877d" }),
  stone:      Object.freeze({ base: "#a09a8e", pattern: "grid", tile_m: 0.6, joint: "#4a4640", flecks: true }),
  carpet:     Object.freeze({ base: "#8b8274", pattern: null }),
  concrete:   Object.freeze({ base: "#a8a59e", pattern: "grid", tile_m: 1.2, joint: "#5a5751", flecks: true }),
});
// The opt-in report's words (telemetry.py HOUSE3D_FINISH_EVENTS holds the
// same): a floor chosen, by its material only; a room's walls, one wall, a
// floor's outside walls; and once per page load a house drawn with any of it
// showing. Never which room, floor or colour.
export const FINISH_EVENTS = [...["drawn", "wall", "one_wall", "outside"].map(w => `house3d_finish:${w}`),
                              ...FLOOR_MATERIALS.map(m => `house3d_finish:floor:${m}`)];
export const WALLS_MAX = 200;              // the server's too (house3d_store.py)
const HEX = /^#[0-9a-f]{6}$/i;
const WORD = /^[a-z][a-z_]{0,23}$/;
const obj = (v) => !!v && typeof v === "object" && !Array.isArray(v);
const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** A room's entry as the file keeps it, cut to what this version reads, or null. */
function roomEntry(v){
  if (!obj(v)) return null;
  const o = {};
  if (typeof v.floor === "string" && WORD.test(v.floor)) o.floor = v.floor;
  if (typeof v.wall === "string" && HEX.test(v.wall)) o.wall = v.wall.toLowerCase();
  if (obj(v.walls)) {
    const w = {};
    for (const [k, c] of Object.entries(v.walls)) if (/^(0|[1-9][0-9]{0,2})$/.test(k) && Number(k) < WALLS_MAX && typeof c === "string" && HEX.test(c)) w[k] = c.toLowerCase();
    if (Object.keys(w).length) o.walls = w;
  }
  return Object.keys(o).length ? o : null;
}
/** The file's (or the draft's) rooms and floors, as this version reads them:
 *  {rooms: {name: {floor, wall, walls}}, floors: {id: {outside}}}. */
export function readFinish(data){
  const d = obj(data) ? data : {}, out = { rooms: {}, floors: {} };
  for (const [k, v] of Object.entries(obj(d.rooms) ? d.rooms : {})) { const e = roomEntry(v); if (e) out.rooms[k] = e; }
  for (const [k, v] of Object.entries(obj(d.floors) ? d.floors : {})) {
    if (obj(v) && typeof v.outside === "string" && HEX.test(v.outside)) out.floors[k] = { outside: v.outside.toLowerCase() };
  }
  return out;
}
/** Anything chosen at all? */
export const hasFinish = (fin) => !!fin && (Object.keys(fin.rooms || {}).length > 0 || Object.keys(fin.floors || {}).length > 0);
/** Any wall colour chosen (a room's, one wall's, a floor's outside)? */
export const hasWalls = (fin) => !!fin && (Object.keys(fin.floors || {}).length > 0 || Object.values(fin.rooms || {}).some(e => e.wall || e.walls));
/** What the house is drawn from, as one string: the same string, nothing to draw again. */
export function finishSignature(data){
  const f = readFinish(data);
  return hasFinish(f) ? JSON.stringify([Object.keys(f.rooms).sort().map(k => [k, f.rooms[k]]), Object.keys(f.floors).sort().map(k => [k, f.floors[k]])]) : "";
}
/** A room's floor material, when it is one this version draws; else null (the room's colour, as before). */
export function floorOf(fin, name){
  const e = fin && fin.rooms ? fin.rooms[name] : null;
  return e && Object.prototype.hasOwnProperty.call(MATERIALS, e.floor) ? e.floor : null;
}

// ── walls ────────────────────────────────────────────────────────────────────
/** A room's walls, round its outline from its first corner: [{i, a, b, len}]
 *  (what Furnish lists, and what walls["<i>"] names). pts: the outline as the view reads it. */
export function roomEdges(pts){
  const P = Array.isArray(pts) ? pts : [], out = [];
  for (let i = 0; i < P.length; i++) {
    const a = P[i], b = P[(i + 1) % P.length];
    out.push({ i, a, b, len: Math.hypot(b[0] - a[0], b[1] - a[1]) });
  }
  return out;
}
/** Which wall of a room's outline a drawn wall piece (the house module's
 *  deriveWalls: x0, y0, x1, y1, thick) stands on: the edge in line with it
 *  (within 5°) and nearest it, along whose length its middle lies; -1 if none. */
export function edgeOf(pts, pc){
  const L = Math.hypot(pc.x1 - pc.x0, pc.y1 - pc.y0);
  if (!(L > 0.01)) return -1;
  const ux = (pc.x1 - pc.x0) / L, uy = (pc.y1 - pc.y0) / L, mx = (pc.x0 + pc.x1) / 2, my = (pc.y0 + pc.y1) / 2;
  const tol = (num(pc.thick) ?? 0.12) / 2 + 0.25;
  let best = -1, bestD = Infinity;
  for (const e of roomEdges(pts)) {
    if (e.len < 0.01) continue;
    const ex = (e.b[0] - e.a[0]) / e.len, ey = (e.b[1] - e.a[1]) / e.len;
    if (Math.abs(ux * ey - uy * ex) > 0.088) continue;                  // sin 5°
    const t = (mx - e.a[0]) * ex + (my - e.a[1]) * ey;
    if (t < -0.05 || t > e.len + 0.05) continue;
    const d = Math.abs((mx - e.a[0]) * ey - (my - e.a[1]) * ex);
    if (d <= tol && d < bestD) { best = e.i; bestD = d; }
  }
  return best;
}
function inPoly(x, y, P){
  let c = false;
  for (let i = 0, j = P.length - 1; i < P.length; j = i++) {
    const a = P[i], b = P[j];
    if ((a[1] > y) !== (b[1] > y) && x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0]) c = !c;
  }
  return c;
}
/** The colours of a wall piece's two faces, or null to draw it as before:
 *  {pos, neg, out}. pos: the face toward its normal (pc.nx, pc.ny), neg: the
 *  other; either null keeps the wall's own colour on that face. A face toward
 *  an indoor room takes that room's colour for this wall (walls["<n>"]), else
 *  its walls' (wall); a face toward no room, on an outside wall, its floor's
 *  outside colour. out: which face is the outside one (1 pos, -1 neg, 0
 *  neither), whose colour the wall's ends and top take, so a corner reads as
 *  one colour from outside. rooms: the floor's rooms as the view reads them
 *  ({name, pts, outdoor}); floorId: the floor as stored (a split level's is its floor's). */
export function wallSides(pc, rooms, fin, floorId){
  if (!pc || !hasWalls(fin) || pc.kind === "rail") return null;
  const L = Math.hypot(pc.x1 - pc.x0, pc.y1 - pc.y0);
  if (!(L > 0.02)) return null;
  let nx = num(pc.nx), ny = num(pc.ny);
  if (nx === null || ny === null || Math.hypot(nx, ny) < 1e-6) { nx = (pc.y1 - pc.y0) / L; ny = -(pc.x1 - pc.x0) / L; }
  const mx = (pc.x0 + pc.x1) / 2, my = (pc.y0 + pc.y1) / 2, d = (num(pc.thick) ?? 0.12) / 2 + 0.15;
  const roomOn = (s) => (rooms || []).find(r => r && !r.outdoor && Array.isArray(r.pts) && r.pts.length >= 3 && inPoly(mx + nx * d * s, my + ny * d * s, r.pts)) || null;
  const outside = (fin.floors[floorId] && fin.floors[floorId].outside) || null;
  const colourOf = (r) => {
    const e = fin.rooms[r.name];
    if (!e) return null;
    if (e.walls) { const k = edgeOf(r.pts, pc); if (k >= 0 && e.walls[String(k)]) return e.walls[String(k)]; }
    return e.wall || null;
  };
  const A = roomOn(1), B = roomOn(-1);
  const pos = A ? colourOf(A) : pc.cls === "ext" ? outside : null;
  const neg = B ? colourOf(B) : pc.cls === "ext" ? outside : null;
  if (!pos && !neg) return null;
  return { pos, neg, out: !A && B ? 1 : A && !B ? -1 : 0 };
}
