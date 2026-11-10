// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
// See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
//
// The trees of Showcase's West Coast Forest (iso_lights.js SHOWCASE_THEMES
// west_coast_forest): a dark Pacific Northwest forest in the flat Atlas's
// outside, from the map's own angle. Douglas fir, western red cedar and western
// hemlock on a near-black mossy floor with sword ferns, salal, fallen logs and
// rocks, going back into mist. All of it is drawn here, no picture is fetched.
// lights_map.js imports this file the first time the theme is on; with any
// other theme it is never fetched.
//
// Painted once on a canvas of its own and shown as the background of one plain
// box first in the stage, so it goes down before the drawing: everything in the
// drawing (rooms, markers, names, lights) is over it, and the rain
// (atlas_weather.js, positioned) is over both. No layer of its own: as part of
// the page it costs nothing per frame, where a live canvas under the rain cost
// the Wall PC's UHD 630 a frame in three. It is painted again only when the
// picture would differ: the plates, the stage's size, the zoom. A poll's redraw
// finds the same plates and does nothing. Where the rain's mask
// keeps the weather off the house (the plates and the space between stacked
// floors, atlas_weather.js), these trees are cut out too, and a garden's plate
// with them: nothing shows through a translucent floor.
//
// Where a tree stands comes from one small random number per cell of a grid
// fixed in the drawing's units, seeded from the rooms' outlines: the same house
// always has the same forest, and another floor or spacing only takes away or
// shortens what would now meet the house. A tree in front of the house (lower on
// the screen) stops below it, so nothing looks cut off by a floor it stands
// before; one behind it may rise past.

const WX = await import(`./atlas_weather.js${new URL(import.meta.url).search}`);

export const FOREST_THEME = "west_coast_forest";
/** Drawing units kept clear of the house round a trunk, a fern, a log. */
export const FOREST_MARGIN = 7;
export const TREE_H = 178;                 // the tallest tree the sprites are drawn for, in the drawing's units
const MIN_TREE = 38;                       // a tree the house would leave shorter than this is not drawn
const MAX_PX = 4.2e6;                      // the most pixels the picture takes (a 4K wall: a little under its own)
const MIN_SCALE = 0.75, MAX_SCALE = 3;     // sprite pixels per unit
const SAME_PAINT = 0.04;                   // how much the scale may move before it is painted again
const PICTURE = "image/webp", PICTURE_Q = 0.92;   // what the browser keeps of it (a browser without WebP gives a PNG)
const BAND = 62;                           // how often the mist lies between rows of trees, units
const PAINT_WAIT_MS = 160;                 // a zoom settles this long before the picture is painted for it
const SOON_MS = 500;                       // painted this lately: wait for things to settle

// ── Numbers from a place ────────────────────────────────────────────────────
function mix32(h){ h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b); h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); return (h ^ (h >>> 16)) >>> 0; }
/** A generator for one cell: the same seed and cell, the same numbers, whatever else is drawn. */
export function cellRandom(seed, ix, iy, salt){
  let s = mix32((seed ^ Math.imul(ix + 7919, 0x9e3779b1) ^ Math.imul(iy + 104729, 0x7f4a7c15) ^ Math.imul(salt + 13, 0x94d049bb)) >>> 0) || 1;
  return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
/** The seed for a house: its rooms' outlines, to 10 cm, whatever they are called. */
export function forestSeed(model){
  const geo = (model && model.room_geometry_m) || {}, parts = [];
  for (const g of Object.values(geo)) {
    if (g && Array.isArray(g.points_m)) parts.push(g.points_m.map(q => `${Math.round(Number(q[0]) * 10)},${Math.round(Number(q[1]) * 10)}`).join(" "));
  }
  let h = 2166136261;
  for (const c of parts.sort().join(";")) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
// Which kind of tree grows here: stands, not a mix of single trees.
export function standOf(seed, x, y){
  const n = (cx, cy, salt) => {
    const gx = Math.floor(x / cx), gy = Math.floor(y / cy), fx = x / cx - gx, fy = y / cy - gy;
    const at = (a, b) => cellRandom(seed, a, b, salt)();
    const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
    return (at(gx, gy) * (1 - sx) + at(gx + 1, gy) * sx) * (1 - sy) + (at(gx, gy + 1) * (1 - sx) + at(gx + 1, gy + 1) * sx) * sy;
  };
  return n(150, 90, 91) * 0.7 + n(60, 36, 92) * 0.3;
}

// ── The house, as far as the trees care ─────────────────────────────────────
/** Every plate's polygons and the space between stacked floors, in drawing
 *  units: the rain's mask (atlas_weather.js), and a garden's plate as well.
 *  polys: where nothing may stand (plates and the space between floors);
 *  plates: the plates alone, all that is cut out of the picture: the forest
 *  floor and its mist run on between the floors, as every other theme's ground
 *  does (cutting the space between floors out too hung dark, treeless
 *  curtains from the upper floors, 2026-11-09). */
export function forestKeepOut(svg, outdoorZ, offsets){
  const geo = WX.atlasPlatesFromSvg(svg);
  if (!geo) return null;
  const outZ = outdoorZ instanceof Set ? outdoorZ : new Set();
  const plates = geo.plates.flatMap(pl => pl.polys);
  return { viewBox: geo.viewBox, polys: [...plates, ...WX.stackJoins(geo.plates, outZ, offsets)], plates };
}
const inPoly = (P, x, y) => {
  let c = false;
  for (let i = 0, j = P.length - 1; i < P.length; j = i++) {
    const a = P[i], b = P[j];
    if ((a[1] > y) !== (b[1] > y) && x < ((b[0] - a[0]) * (y - a[1])) / (b[1] - a[1]) + a[0]) c = !c;
  }
  return c;
};
const toEdge = (P, x, y) => {
  let best = Infinity;
  for (let i = 0, j = P.length - 1; i < P.length; j = i++) {
    const a = P[j], b = P[i], dx = b[0] - a[0], dy = b[1] - a[1], l = dx * dx + dy * dy;
    const t = l > 0 ? Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / l)) : 0;
    const ex = a[0] + dx * t - x, ey = a[1] + dy * t - y, d = ex * ex + ey * ey;
    if (d < best) best = d;
  }
  return Math.sqrt(best);
};
/** {inside(x, y), near(x, y, m), under(x, y)}: on the house; within m of it; and
 *  the nearest edge of it straight up the screen from a point outside it. */
export function houseShape(polys){
  const list = (polys || []).filter(P => Array.isArray(P) && P.length >= 3).map((P) => {
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const q of P) { x0 = Math.min(x0, q[0]); x1 = Math.max(x1, q[0]); y0 = Math.min(y0, q[1]); y1 = Math.max(y1, q[1]); }
    return { P, x0, x1, y0, y1 };
  });
  const inside = (x, y) => list.some(p => x >= p.x0 && x <= p.x1 && y >= p.y0 && y <= p.y1 && inPoly(p.P, x, y));
  const near = (x, y, m) => list.some(p => x >= p.x0 - m && x <= p.x1 + m && y >= p.y0 - m && y <= p.y1 + m && (inPoly(p.P, x, y) || toEdge(p.P, x, y) < m));
  const under = (x, y) => {
    let best = -Infinity;
    for (const p of list) {
      if (x < p.x0 || x > p.x1 || p.y0 >= y) continue;
      const P = p.P;
      for (let i = 0, j = P.length - 1; i < P.length; j = i++) {
        const a = P[j], b = P[i];
        if ((a[0] > x) === (b[0] > x)) continue;
        const cy = a[1] + ((x - a[0]) * (b[1] - a[1])) / (b[0] - a[0]);
        if (cy <= y && cy > best) best = cy;
      }
    }
    return best;
  };
  // The plate corners in a span of columns: between them its edges are straight,
  // so these and the span's own ends are the only columns that can be the nearest.
  const corners = (x0, x1) => { const out = []; for (const p of list) if (p.x1 >= x0 && p.x0 <= x1) for (const q of p.P) if (q[0] > x0 && q[0] < x1) out.push(q[0]); return out; };
  return { inside, near, under, corners };
}
/** How tall something at (x, y), hw wide each way, may stand: to the house
 *  straight above it, in every column it covers (a column already beside the
 *  house at its foot stands behind that wall, and may rise past it). */
export function roomAbove(shape, x, y, hw, margin){
  let room = Infinity;
  for (const cx of [x - hw, x, x + hw, ...shape.corners(x - hw, x + hw)]) {
    if (shape.inside(cx, y)) continue;
    const b = shape.under(cx, y);
    if (b > -Infinity) room = Math.min(room, y - b - margin);
  }
  return room;
}

// ── What stands where ───────────────────────────────────────────────────────
const SPECIES = ["fir", "cedar", "hemlock"];
const CLEARING = 42, GLADE = 0.3;           // units of open floor round the house; how much of the forest is a glade
const WIDTH = { fir: 0.3, cedar: 0.38, hemlock: 0.3 };      // the sprite's half-width x its height, roughly
/** Everything in the picture, back to front. area: {x0, y0, x1, y1} in units;
 *  polys: forestKeepOut's (nothing stands there); seed: forestSeed's; cut: what
 *  is cut out of the picture (forestKeepOut's plates; else polys). Pure. */
export function forestPlan(area, polys, seed, cut = polys){
  const shape = houseShape(polys), items = [], dabs = [], mist = [];
  const cells = (cx, cy, salt, fn) => {
    for (let iy = Math.floor(area.y0 / cy) - 1; iy <= Math.ceil(area.y1 / cy) + 1; iy++) {
      for (let ix = Math.floor(area.x0 / cx) - 1; ix <= Math.ceil(area.x1 / cx) + 1; ix++) {
        const r = cellRandom(seed, ix, iy, salt);
        fn(r, (ix + r()) * cx, (iy + r()) * cy);
      }
    }
  };
  // Trees: taller toward the viewer, so the rows above read as farther back.
  const yFar = area.y0, ySpan = Math.max(1, area.y1 - area.y0);
  const nearOf = (y) => Math.max(0, Math.min(1, (y - yFar) / ySpan));
  const gladeAt = (x, y) => standOf(seed ^ 0x6a1d, x, y) < GLADE;
  const clearAt = (x, y) => shape.near(x, y, CLEARING * (0.7 + standOf(seed ^ 0x33c1, x * 2, y * 2) * 0.6));
  cells(27, 14.5, 1, (r, x, y) => {
    const on = r(), kind = r(), tall = r(), v = r(), flip = r(), wide = r();
    const near = nearOf(y);
    // Dense, thinner close to the viewer where each tree is bigger; only a few
    // old trees stand out in the clearing round the house and in the glades.
    const open = clearAt(x, y) || gladeAt(x, y);
    if (on > (open ? 0.14 : 0.9 - near * 0.3)) return;
    const st = standOf(seed, x, y) + (kind - 0.5) * 0.28;
    const sp = st < 0.42 ? "fir" : st < 0.56 ? "cedar" : "hemlock";
    let h = (0.6 + tall * 0.4) * (0.58 + near * 0.66) * TREE_H * (sp === "fir" ? 1 : sp === "cedar" ? 0.86 : 0.8);
    const hwk = WIDTH[sp] * (0.85 + wide * 0.3);
    if (shape.near(x, y, FOREST_MARGIN)) return;
    const room = roomAbove(shape, x, y, Math.min(h * hwk, 26), FOREST_MARGIN);
    if (room < MIN_TREE) return;
    if (h > room) h = room;
    if (y - h > area.y1 || y < area.y0) return;
    items.push({ k: "tree", sp, v: Math.floor(v * 3), x, y, h, w: h * hwk * 2, flip: flip < 0.5 });
  });
  cells(11, 6.2, 2, (r, x, y) => {                          // sword ferns, in drifts
    const on = r(), v = r(), s = r(), flip = r();
    const drift = standOf(seed ^ 0x51ed, x * 2.2, y * 2.2);
    if (!(clearAt(x, y) || gladeAt(x, y) || shape.near(x, y, CLEARING * 1.5))) return;    // under the canopy nothing of it would show
    if (on > 0.2 + drift * 0.75) return;
    const w = (10 + s * 11) * (0.8 + nearOf(y) * 0.5);
    if (shape.near(x, y, FOREST_MARGIN * 0.5) || roomAbove(shape, x, y, w / 2, 2) < w * 0.6) return;
    items.push({ k: "fern", v: Math.floor(v * 3), x, y, w, flip: flip < 0.5 });
  });
  cells(15, 8.4, 3, (r, x, y) => {                          // salal, low and leathery
    const on = r(), v = r(), s = r();
    if (on > 0.34 || standOf(seed ^ 0x2b7e, x * 1.7, y * 1.7) < 0.46) return;
    if (!(clearAt(x, y) || gladeAt(x, y))) return;
    const w = (11 + s * 13) * (0.8 + nearOf(y) * 0.5);
    if (shape.near(x, y, FOREST_MARGIN * 0.5) || roomAbove(shape, x, y, w / 2, 2) < w * 0.5) return;
    items.push({ k: "salal", v: Math.floor(v * 2), x, y, w });
  });
  cells(130, 72, 4, (r, x, y) => {                          // fallen logs, along the map's own lines
    const on = r(), s = r(), dir = r(), v = r();
    if (on > 0.5) return;
    const w = 54 + s * 52, a = dir < 0.5 ? Math.atan(0.5) : -Math.atan(0.5);
    const ex = Math.cos(a) * w / 2, ey = Math.sin(a) * w / 2;
    for (const u of [-1, -0.5, 0, 0.5, 1]) {
      if (shape.near(x + ex * u, y + ey * u, FOREST_MARGIN)) return;
      if (roomAbove(shape, x + ex * u, y + ey * u, 5, 2) < 9) return;
    }
    items.push({ k: "log", v: Math.floor(v * 2), x, y, w, a });
  });
  cells(70, 40, 5, (r, x, y) => {                           // mossy rocks
    const on = r(), s = r(), v = r();
    if (on > 0.4) return;
    const w = 8 + s * 14;
    if (shape.near(x, y, FOREST_MARGIN) || roomAbove(shape, x, y, w / 2, 2) < w * 0.8) return;
    items.push({ k: "rock", v: Math.floor(v * 2), x, y, w });
  });
  items.sort((a, b) => a.y - b.y || a.x - b.x);
  cells(46, 25, 6, (r, x, y) => { const m = r(), s = r(), w = r(); dabs.push({ x, y, w: 26 + s * 60, kind: w < 0.62 ? 0 : 1, a: 0.28 + m * 0.5 }); });
  cells(170, 58, 7, (r, x, y) => { const m = r(), s = r(); if (m < 0.72) mist.push({ x, y, w: 150 + s * 240, a: (0.05 + m * 0.13) * (gladeAt(x, y) ? 1.8 : 1) }); });
  return { area: { ...area }, polys: cut || [], items, dabs, mist };
}

// ── Colours ─────────────────────────────────────────────────────────────────
const hexRgb = (h) => { const v = parseInt(h.slice(1), 16); return [(v >> 16) & 255, (v >> 8) & 255, v & 255]; };
const mixRgb = (a, b, t) => { const A = hexRgb(a), B = hexRgb(b); return `rgb(${Math.round(A[0] + (B[0] - A[0]) * t)},${Math.round(A[1] + (B[1] - A[1]) * t)},${Math.round(A[2] + (B[2] - A[2]) * t)})`; };
const TREE = {
  fir:     { dark: "#050d09", light: "#14261c", tip: "#25392b", bark: "#100c09", barkLit: "#2a2118", bare: 0.46, R: 0.135, whorls: 24, droop: 0.34, lift: 0.3,  girth: 4.3, per: 7 },
  cedar:   { dark: "#06100b", light: "#172a1e", tip: "#2a4030", bark: "#1a110b", barkLit: "#3d2a1c", bare: 0.24, R: 0.185, whorls: 26, droop: 0.72, lift: 0.46, girth: 5.4, per: 8 },
  hemlock: { dark: "#040c0b", light: "#112422", tip: "#1f3a37", bark: "#120f0c", barkLit: "#27231d", bare: 0.32, R: 0.14,  whorls: 30, droop: 0.58, lift: 0.08, girth: 3.2, per: 7 },
};
const FLOOR_FAR = "#101a19", FLOOR_NEAR = "#050a07";

// ── Sprites: each kind drawn once for this scale ────────────────────────────
// All in memory: nothing here is ever drawn again by the GPU.
const SOFT = { willReadFrequently: true };
function sprite(w, h, scale, draw){
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.ceil(w * scale)); c.height = Math.max(1, Math.ceil(h * scale));
  const g = c.getContext("2d", SOFT);
  if (g) { g.scale(scale, scale); draw(g); }
  return c;
}
/** One bough: a feathered blade out from the trunk, drooping, seen from above. */
function bough(g, ax, ay, dx, dy, drop, lift, wid, col, tip, r){
  const S = 5, up = [], dn = [];
  for (let k = 0; k <= S; k++) {
    const u = k / S, sag = Math.sin(u * Math.PI * 0.72) * drop - u * u * lift;   // down, then the tip up a little
    const x = ax + dx * u, y = ay + dy * u + sag, w = wid * Math.sin(Math.min(1, u * 1.15 + 0.08) * Math.PI) ** 0.6;
    const jag = 0.75 + r() * 0.5;
    up.push([x - dy * 0.06, y - w * 0.5 * jag]);
    if (k < S) up.push([x + dx * 0.11, y - w * 0.14]);
    dn.push([x + dx * 0.06 * jag, y + w * 0.9 * jag + (k % 2 ? w * 0.5 : 0)]);
    if (k < S) dn.push([x + dx * 0.1, y + w * 0.25]);
  }
  g.beginPath();
  g.moveTo(ax, ay);
  for (const q of up) g.lineTo(q[0], q[1]);
  for (let i = dn.length - 1; i >= 0; i--) g.lineTo(dn[i][0], dn[i][1]);
  g.closePath();
  g.fillStyle = col;
  g.fill();
  // The upper side catches what light comes down through the canopy.
  g.beginPath();
  g.moveTo(up[1][0], up[1][1]);
  for (let i = 2; i < up.length; i++) g.lineTo(up[i][0], up[i][1]);
  g.strokeStyle = tip;
  g.lineWidth = 0.45;
  g.stroke();
}
function drawTree(g, spName, v){
  const T = TREE[spName], r = cellRandom(0x7ee5, SPECIES.indexOf(spName), v, 8), H = TREE_H;
  const top = spName === "hemlock" ? -H * 0.965 : -H, girth = T.girth * (0.9 + r() * 0.2);
  // The trunk, lit a little down one side, with long furrows.
  const grad = g.createLinearGradient(-girth, 0, girth, 0);
  grad.addColorStop(0, T.bark); grad.addColorStop(0.38, T.barkLit); grad.addColorStop(1, T.bark);
  g.fillStyle = grad;
  g.beginPath();
  const flare = spName === "cedar" ? 3.4 : 1.4;
  g.moveTo(-girth - flare, 0);
  g.quadraticCurveTo(-girth * 0.92, -H * 0.05, -girth * 0.72, -H * 0.16);
  g.lineTo(-0.5, top * 0.97);
  if (spName === "hemlock") g.quadraticCurveTo(1.5, top * 1.03, 6.5, top * 1.0);     // a hemlock's leader nods
  g.lineTo(0.5, top * 0.97);
  g.lineTo(girth * 0.72, -H * 0.16);
  g.quadraticCurveTo(girth * 0.92, -H * 0.05, girth + flare, 0);
  g.quadraticCurveTo(0, 2.2, -girth - flare, 0);
  g.closePath();
  g.fill();
  g.lineWidth = 0.34;
  for (let i = 0; i < 9; i++) {
    const x = (r() - 0.5) * girth * 1.5, y0 = -r() * H * T.bare * 1.05, l = 8 + r() * 28;
    g.strokeStyle = r() < 0.72 ? "rgba(0,0,0,.42)" : mixRgb(T.barkLit, "#6a5a44", 0.3);
    g.beginPath(); g.moveTo(x, y0); g.lineTo(x + (r() - 0.5) * 0.9, y0 - l); g.stroke();
  }
  // Moss up the foot of the trunk.
  const moss = g.createLinearGradient(0, 0, 0, -H * 0.12);
  moss.addColorStop(0, "rgba(58,86,42,.5)"); moss.addColorStop(1, "rgba(58,86,42,0)");
  g.fillStyle = moss;
  g.beginPath();
  g.moveTo(-girth - flare, 0); g.lineTo(-girth * 0.7, -H * 0.12); g.lineTo(girth * 0.1, -H * 0.1); g.lineTo(girth * 0.3, 0.8); g.closePath();
  g.fill();
  // Dead limbs on the bare trunk, the mark of an old tree.
  g.strokeStyle = T.bark;
  for (let i = 0; i < 7; i++) {
    const y = -H * (T.bare * (0.45 + r() * 0.55)), side = r() < 0.5 ? -1 : 1, l = 5 + r() * 10;
    g.lineWidth = 0.5 + r() * 0.5;
    g.beginPath(); g.moveTo(side * girth * 0.3, y); g.lineTo(side * (girth * 0.3 + l), y + 2 + r() * 4); g.stroke();
  }
  // The crown, from the lowest boughs up: each whorl over the one below it.
  const y0 = -H * T.bare, y1 = top * 0.985;
  for (let i = 0; i < T.whorls; i++) {
    const t = i / (T.whorls - 1), yw = y0 + (y1 - y0) * (t + (r() - 0.5) * 0.018);
    // Widest low in the crown, narrowing to the leader; a fir is more open and uneven.
    const prof = Math.pow(1 - t, spName === "cedar" ? 0.78 : 0.86) * (1 - Math.pow(1 - Math.min(1, t * 7), 2) * 0.32);
    const uneven = spName === "fir" ? 0.72 + r() * 0.56 : 0.88 + r() * 0.24;
    const R = Math.max(1.3, H * T.R * prof * uneven);
    const n = Math.max(3, Math.round(T.per * (0.42 + prof * 0.62) + r()));
    const list = [];
    for (let b = 0; b < n; b++) list.push((b + r() * 0.8) / n * Math.PI * 2 + i * 1.7);
    list.sort((a, c) => Math.sin(a) - Math.sin(c));
    for (const a of list) {
      if (spName === "fir" && t < 0.5 && r() < 0.14) continue;     // gaps low in a fir's crown
      const front = (Math.sin(a) + 1) / 2, len = R * (0.82 + r() * 0.3);
      const lit = Math.min(1, (0.12 + t * 0.72) * (0.55 + front * 0.6) * (0.7 + r() * 0.5));
      bough(g, Math.cos(a) * girth * (1 - t) * 0.3, yw, Math.cos(a) * len, Math.sin(a) * len * 0.42,
            len * T.droop * (0.9 + r() * 0.3), len * T.lift, 1.7 + R * 0.14 + r() * 0.8,
            mixRgb(T.dark, T.light, lit), mixRgb(T.light, T.tip, 0.2 + lit * 0.7), r);
      // A cedar's sprays hang in curtains from each bough.
      if (spName === "cedar" && t < 0.75 && r() < 0.4) {
        const ux = 0.55 + r() * 0.35, hx = Math.cos(a) * len * ux, hy = yw + Math.sin(a) * len * 0.42 * ux + len * T.droop * 0.72;
        g.strokeStyle = mixRgb(T.dark, T.light, lit * 0.8);
        g.lineWidth = 0.9 + r() * 0.5;
        g.beginPath(); g.moveTo(hx, hy); g.lineTo(hx + (r() - 0.5) * 1.5, hy + 3.5 + r() * 5.5); g.stroke();
      }
    }
  }
}
function drawFern(g, v){
  const r = cellRandom(0xfe27, v, 0, 9), n = 10 + v;
  const list = [];
  for (let i = 0; i < n; i++) list.push((i + r() * 0.7) / n * Math.PI * 2);
  list.sort((a, b) => Math.sin(a) - Math.sin(b));
  for (const a of list) {
    const front = (Math.sin(a) + 1) / 2, len = 8.5 + r() * 2.5, dx = Math.cos(a) * len, dy = Math.sin(a) * len * 0.42;
    const rise = 4.4 + r() * 2.4, S = 7, lit = 0.2 + front * 0.5 + r() * 0.3;
    g.fillStyle = mixRgb("#0a1a10", "#2c4a2a", Math.min(1, lit));
    g.beginPath();
    g.moveTo(0, 0);
    const side = [[], []];
    for (let k = 1; k <= S; k++) {
      const u = k / S, x = dx * u, y = dy * u - Math.sin(u * Math.PI * 0.82) * rise + u * u * 2.4, w = 1.05 * (1 - u * 0.8);
      side[0].push([x - dy * 0.03 * 0 + w * Math.sin(a) * 0.9, y - w * 0.55], [x + dx * 0.03, y]);
      side[1].push([x - w * Math.sin(a) * 0.9, y + w * 0.55], [x + dx * 0.03, y]);
    }
    for (const q of side[0]) g.lineTo(q[0], q[1]);
    for (let i = side[1].length - 1; i >= 0; i--) g.lineTo(side[1][i][0], side[1][i][1]);
    g.closePath();
    g.fill();
  }
}
function drawSalal(g, v){
  const r = cellRandom(0x5a1a, v, 0, 10);
  for (let i = 0; i < 26; i++) {
    const a = r() * Math.PI * 2, d = Math.sqrt(r()), x = Math.cos(a) * d * 6.2, y = Math.sin(a) * d * 2.8 - 1.2 - r() * 2.2;
    const lit = 0.1 + (1 - d) * 0.45 + r() * 0.3;
    g.fillStyle = mixRgb("#0a1812", "#2d4a33", Math.min(1, lit));
    g.save();
    g.translate(x, y); g.rotate(r() * Math.PI);
    g.beginPath(); g.ellipse(0, 0, 1.25, 0.72, 0, 0, Math.PI * 2); g.fill();
    g.restore();
  }
}
function drawLog(g, v){
  const r = cellRandom(0x106, v, 0, 11), R = 4.6;
  const body = g.createLinearGradient(0, -R, 0, R);
  body.addColorStop(0, "#2d2a1d"); body.addColorStop(0.42, "#1b1711"); body.addColorStop(1, "#060605");
  g.fillStyle = body;
  g.beginPath();
  g.moveTo(-50, -R * 0.82);
  for (let i = 1; i <= 8; i++) g.lineTo(-50 + i * 12.5, -R * (0.82 + (i / 8) * 0.18) + (r() - 0.5) * 0.5);
  g.lineTo(50, R);
  for (let i = 7; i >= 0; i--) g.lineTo(-50 + i * 12.5, R * (0.82 + (i / 8) * 0.18) + (r() - 0.5) * 0.4);
  g.closePath();
  g.fill();
  // Moss along its back.
  for (let i = 0; i < 30; i++) {
    const x = -48 + r() * 96, y = -R * (0.28 + r() * 0.62);
    g.fillStyle = mixRgb("#16280f", "#3d5c26", r());
    g.beginPath(); g.ellipse(x, y, 1.6 + r() * 3.4, 0.5 + r() * 0.8, 0, 0, Math.PI * 2); g.fill();
  }
  g.fillStyle = "#3a3123";                                   // the cut end
  g.beginPath(); g.ellipse(50, 0, 1.6, R, 0, 0, Math.PI * 2); g.fill();
  g.strokeStyle = "#17120c"; g.lineWidth = 0.3;
  g.beginPath(); g.ellipse(50, 0, 0.8, R * 0.5, 0, 0, Math.PI * 2); g.stroke();
}
function drawRock(g, v){
  const r = cellRandom(0x40c, v, 0, 12), pts = [];
  for (let i = 0; i < 11; i++) { const a = (i / 11) * Math.PI * 2, d = 0.78 + r() * 0.3; pts.push([Math.cos(a) * 7.6 * d, Math.sin(a) * 4.6 * d - 2.6]); }
  const fill = g.createLinearGradient(0, -7, 0, 2);
  fill.addColorStop(0, "#2b3128"); fill.addColorStop(1, "#080b09");
  g.fillStyle = fill;
  g.beginPath();
  pts.forEach((q, i) => (i ? g.lineTo(q[0], q[1]) : g.moveTo(q[0], q[1])));
  g.closePath();
  g.fill();
  for (let i = 0; i < 14; i++) {
    const a = r() * Math.PI * 2, d = Math.sqrt(r()) * 0.8;
    g.fillStyle = mixRgb("#16280f", "#3b5a25", r());
    g.beginPath(); g.ellipse(Math.cos(a) * 6 * d, Math.sin(a) * 2.2 * d - 4, 1.2 + r() * 1.4, 0.5 + r() * 0.6, 0, 0, Math.PI * 2); g.fill();
  }
}
function softDab(g, w, rgb){
  const k = w / 2, grad = g.createRadialGradient(k, k, 0, k, k, k);
  grad.addColorStop(0, `rgba(${rgb},1)`); grad.addColorStop(0.55, `rgba(${rgb},.5)`); grad.addColorStop(1, `rgba(${rgb},0)`);
  g.fillStyle = grad;
  g.fillRect(0, 0, w, w);
}
const SPR = { tree: { w: 120, h: TREE_H + 12, ax: 60, ay: TREE_H + 6 }, fern: { w: 26, h: 19, ax: 13, ay: 13 }, salal: { w: 16, h: 10, ax: 8, ay: 7 }, log: { w: 108, h: 13, ax: 54, ay: 6.5 }, rock: { w: 20, h: 13, ax: 10, ay: 9 } };
let _sprites = null, _spriteScale = 0;
/** Every sprite for a scale (pixels per unit), made once and kept for the next paint. */
function spritesFor(scale){
  if (_sprites && _spriteScale === scale) return _sprites;
  const on = (S, fn) => sprite(S.w, S.h, scale, (g) => { g.translate(S.ax, S.ay); fn(g); });
  const out = { tree: {}, fern: [], salal: [], log: [], rock: [] };
  for (const sp of SPECIES) out.tree[sp] = [0, 1, 2].map(v => on(SPR.tree, g => drawTree(g, sp, v)));
  for (const v of [0, 1, 2]) out.fern.push(on(SPR.fern, g => drawFern(g, v)));
  for (const v of [0, 1]) {
    out.salal.push(on(SPR.salal, g => drawSalal(g, v)));
    out.log.push(on(SPR.log, g => drawLog(g, v)));
    out.rock.push(on(SPR.rock, g => drawRock(g, v)));
  }
  // The mist and the floor's patches are soft and huge: a small picture does.
  out.mist = sprite(64, 64, 1, g => softDab(g, 64, "66,92,96"));
  out.moss = sprite(64, 64, 1, g => softDab(g, 64, "44,66,34"));
  out.duff = sprite(64, 64, 1, g => softDab(g, 64, "50,38,26"));
  _sprites = out; _spriteScale = scale;
  return out;
}

// ── The picture ─────────────────────────────────────────────────────────────
function polyPath(g, polys){
  g.beginPath();
  for (const P of polys) { P.forEach((q, i) => (i ? g.lineTo(q[0], q[1]) : g.moveTo(q[0], q[1]))); g.closePath(); }
}
/** Paint a plan into g, whose transform takes drawing units to pixels. */
export function drawForest(g, plan, spr){
  const { area: A, items, dabs, mist, polys } = plan, W = A.x1 - A.x0, H = A.y1 - A.y0;
  // The floor: near-black, a little of the mist's colour far back.
  const floor = g.createLinearGradient(0, A.y0, 0, A.y1);
  floor.addColorStop(0, FLOOR_FAR); floor.addColorStop(1, FLOOR_NEAR);
  g.fillStyle = floor;
  g.fillRect(A.x0, A.y0, W, H);
  for (const d of dabs) {
    if (d.y < A.y0 - d.w || d.y > A.y1 + d.w) continue;
    g.globalAlpha = d.a;
    g.drawImage(d.kind ? spr.duff : spr.moss, d.x - d.w / 2, d.y - d.w * 0.24, d.w, d.w * 0.48);
  }
  g.globalAlpha = 1;
  // Back to front, row by row, with the mist lying between the rows: whatever is
  // farther back has more of it in front.
  const M = [...mist];
  let next = A.y0 + BAND, m = 0, i = 0;
  const veil = (y) => {
    // Haze over all that is farther back: it piles up, row on row.
    g.fillStyle = "rgba(26,42,46,.032)";
    g.fillRect(A.x0, A.y0, W, y - A.y0);
    // And a low bank of mist at the feet of this row.
    const lay = g.createLinearGradient(0, y - BAND * 1.5, 0, y);
    lay.addColorStop(0, "rgba(46,68,72,0)"); lay.addColorStop(1, "rgba(46,68,72,.2)");
    g.fillStyle = lay;
    g.fillRect(A.x0, y - BAND * 1.5, W, BAND * 1.5);
    for (; m < M.length && M[m].y <= y; m++) {
      const w = M[m].w;
      g.globalAlpha = M[m].a;
      g.drawImage(spr.mist, M[m].x - w / 2, M[m].y - w * 0.2, w, w * 0.34);
    }
    g.globalAlpha = 1;
  };
  M.sort((a, b) => a.y - b.y);
  for (; i < items.length; i++) {
    const t = items[i];
    while (t.y > next) { veil(next); next += BAND; }
    if (t.k === "tree") {
      const k = t.h / TREE_H, sw = SPR.tree.w * k * (t.w / (t.h * 2 * WIDTH[t.sp])), sh = SPR.tree.h * k, ax = SPR.tree.ax / SPR.tree.w;
      g.save();
      g.translate(t.x, t.y);
      if (t.flip) g.scale(-1, 1);
      g.drawImage(spr.tree[t.sp][t.v], -ax * sw, -(SPR.tree.ay / SPR.tree.h) * sh, sw, sh);
      g.restore();
    } else if (t.k === "log") {
      const k = t.w / 100;
      g.save();
      g.translate(t.x, t.y); g.rotate(t.a);
      g.drawImage(spr.log[t.v], -SPR.log.ax * k, -SPR.log.ay, SPR.log.w * k, SPR.log.h);
      g.restore();
    } else {
      const S = SPR[t.k], k = t.w / (S.w * 0.8), base = spr[t.k][t.v];
      if (t.flip) { g.save(); g.translate(t.x, t.y); g.scale(-1, 1); g.drawImage(base, -S.ax * k, -S.ay * k, S.w * k, S.h * k); g.restore(); }
      else g.drawImage(base, t.x - S.ax * k, t.y - S.ay * k, S.w * k, S.h * k);
    }
  }
  while (next < A.y1 + BAND) { veil(next); next += BAND; }
  // The floor darker hard against the house, then the house cut out, feathered
  // as the rain's mask is.
  if (polys.length) {
    g.lineJoin = "round";
    for (const [lw, a] of [[22, 0.2], [12, 0.26], [5, 0.3]]) {
      g.strokeStyle = `rgba(2,5,3,${a})`; g.lineWidth = lw;
      polyPath(g, polys); g.stroke();
    }
    g.globalCompositeOperation = "destination-out";
    for (const [lw, a] of [[5, 0.34], [2.5, 0.6]]) {
      g.strokeStyle = `rgba(0,0,0,${a})`; g.lineWidth = lw;
      polyPath(g, polys); g.stroke();
    }
    g.fillStyle = "#000";
    // One at a time: overlapping shapes in one path can cancel out and leave a hole.
    for (const P of polys) { polyPath(g, [P]); g.fill(); }
    g.globalCompositeOperation = "source-over";
  }
  // A soft edge, so the picture ends in the stage's own dark.
  const edge = Math.min(14, W * 0.03, H * 0.03);
  g.globalCompositeOperation = "destination-out";
  for (const [x0, y0, x1, y1, rx, ry, rw, rh] of [[A.x0, 0, A.x0 + edge, 0, A.x0, A.y0, edge, H], [A.x1, 0, A.x1 - edge, 0, A.x1 - edge, A.y0, edge, H],
                                                  [0, A.y0, 0, A.y0 + edge, A.x0, A.y0, W, edge], [0, A.y1, 0, A.y1 - edge, A.x0, A.y1 - edge, W, edge]]) {
    const f = g.createLinearGradient(x0, y0, x1, y1);
    f.addColorStop(0, "rgba(0,0,0,1)"); f.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = f;
    g.fillRect(rx, ry, rw, rh);
  }
  g.globalCompositeOperation = "source-over";
}

// ── The slot: one canvas per surface, moved into each new stage ─────────────
const _slots = new Map();
/** One forest per surface ("atlas": the sidebar and Overview; "builder": Mapping). */
export function atlasForestSlot(key){
  const k = String(key || "atlas");
  if (!_slots.has(k)) _slots.set(k, createSlot());
  return _slots.get(k);
}
/** The Light theme's own sum (panel.js: invert, then turn the hue half way),
 *  which undoes itself: pixels put through it here come out of the host's filter
 *  as they were. Alpha stays. A CSS filter on the canvas would do it too, and
 *  would lift the canvas over the drawing. */
export function negativePixels(d){
  for (let i = 0; i < d.length; i += 4) {
    const r = 255 - d[i], g = 255 - d[i + 1], b = 255 - d[i + 2];
    d[i] = -0.574 * r + 1.43 * g + 0.144 * b;
    d[i + 1] = 0.426 * r + 0.43 * g + 0.144 * b;
    d[i + 2] = 0.426 * r + 1.43 * g - 0.856 * b;
  }
  return d;
}
/** Under the panel's Light theme (Overview as the Atlas: the host inverts every
 *  colour), a picture stays itself as a photo does (styles.css data-invert).
 *  That rule cannot reach into this page's own shadow root, so it is asked here. */
export function underInvert(node){
  for (let r = node && node.getRootNode ? node.getRootNode() : null; r && r.host; r = r.host.getRootNode ? r.host.getRootNode() : null) {
    if (r.host.hasAttribute && r.host.hasAttribute("data-invert")) return true;
  }
  return false;
}
/** The layer's size, the drawing's width and where the drawing sits in the layer,
 *  all as laid out. A wall turned by its link (?wall_rotate) rotates the whole page,
 *  and the boxes the browser reports are the turned ones: height for width, and the
 *  offsets along other edges. So there the sizes are the elements' own. */
export function laidOut(svg, layer, sr, cr){
  const rn = layer.getRootNode ? layer.getRootNode() : null, turn = rn && rn.host && rn.host.getAttribute ? rn.host.getAttribute("data-wall-rotate") : null;
  if (turn !== "90" && turn !== "270") return { svgW: sr.width, w: cr.width, h: cr.height, dx: sr.left - cr.left, dy: sr.top - cr.top };
  return { svgW: svg.clientWidth, w: layer.offsetWidth, h: layer.offsetHeight,
           dx: turn === "90" ? sr.top - cr.top : cr.bottom - sr.bottom,
           dy: turn === "90" ? cr.right - sr.right : sr.left - cr.left };
}
function createSlot(){
  let layer = null, stageNow = null, shapeKey = null, painted = null, last = null, seen = null, timer = null, paints = 0, ms = 0, ro = null, fitKey = null, paintedAt = -Infinity;
  let shownUrl = null, token = 0;

  function ensure(stage){
    if (!layer) {
      layer = document.createElement("div");
      layer.className = "lv-forest";
      layer.setAttribute("aria-hidden", "true");
      layer.setAttribute("data-forest", "");
    }
    if (layer.parentNode !== stage || stage.firstChild !== layer) stage.insertBefore(layer, stage.firstChild);
    if (stageNow !== stage) {
      stageNow = stage;
      if (ro) { ro.disconnect(); ro = null; }
      if (typeof ResizeObserver === "function") {
        ro = new ResizeObserver(() => { if (layer && layer.parentNode === stageNow) later(); });
        ro.observe(stage);
      }
    }
  }
  function later(){
    if (timer !== null) clearTimeout(timer);                // a slider still moving: once it has settled
    timer = setTimeout(() => { timer = null; try { paint(); } catch (_) { /* the map never sees it */ } }, PAINT_WAIT_MS);
  }
  /** The finished canvas on show: decoded first, so the old picture stays until the new one can take over at once. */
  function show(canvas){
    const mine = ++token;
    const take = (u, isBlob) => {
      const on = () => {
        if (mine !== token || !layer) { if (isBlob) URL.revokeObjectURL(u); return; }
        layer.style.backgroundImage = `url("${u}")`;
        if (shownUrl) URL.revokeObjectURL(shownUrl);
        shownUrl = isBlob ? u : null;
      };
      if (typeof Image !== "function") { on(); return; }
      const im = new Image();
      im.src = u;
      const d = im.decode ? im.decode() : Promise.resolve();
      d.then(on, on);
    };
    if (canvas.toBlob && typeof URL !== "undefined" && URL.createObjectURL) canvas.toBlob((b) => { if (b) take(URL.createObjectURL(b), true); }, PICTURE, PICTURE_Q);
    else take(canvas.toDataURL("image/png"), false);
  }
  /** Paint if the picture would differ from what is showing. */
  function paint(){
    if (!layer || !last || !stageNow || !layer.parentNode) return false;
    const svg = stageNow.querySelector("svg");
    if (!svg || !svg.getBoundingClientRect) return false;
    const sr = svg.getBoundingClientRect(), cr = layer.getBoundingClientRect(), [vx, vy, vw, vh] = last.viewBox;
    if (!(sr.width > 0) || !(cr.width > 0) || !(cr.height > 0)) return false;   // hidden (Live Aboard showing), or not on the page yet
    const box = laidOut(svg, layer, sr, cr);
    if (!(box.svgW > 0)) return false;
    const s = box.svgW / vw, dpr = Math.min(globalThis.devicePixelRatio || 1, 3);
    const area = { x0: vx - box.dx / s, y0: vy - box.dy / s };
    area.x1 = area.x0 + box.w / s; area.y1 = area.y0 + box.h / s;
    const W = area.x1 - area.x0, H = area.y1 - area.y0;
    // Pixel for pixel with the screen where the budget allows; the sprites in
    // quarter steps, so a small change of size draws them again only rarely.
    let exact = s * dpr;
    if (W * H * exact * exact > MAX_PX) exact = Math.sqrt(MAX_PX / (W * H));
    const px = Math.max(MIN_SCALE, Math.min(MAX_SCALE, Math.ceil(exact * 4) / 4));
    const inv = underInvert(layer);
    const key = `${shapeKey}|${[area.x0, area.y0, W, H].map(v => Math.round(v)).join(",")}|${(Math.round(exact / SAME_PAINT) * SAME_PAINT).toFixed(2)}|${inv ? "inv" : ""}`;
    if (key === painted) return false;
    const t0 = performance.now();
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(W * exact); canvas.height = Math.round(H * exact);
    const g = canvas.getContext("2d", SOFT);
    if (!g) return false;
    g.setTransform(canvas.width / W, 0, 0, canvas.height / H, -area.x0 * canvas.width / W, -area.y0 * canvas.height / H);
    const plan = forestPlan(area, last.polys, last.seed, last.plates);
    drawForest(g, plan, spritesFor(px));
    if (inv) {
      const img = g.getImageData(0, 0, canvas.width, canvas.height);
      negativePixels(img.data);
      g.putImageData(img, 0, 0);
    }
    show(canvas);
    painted = key; paints++; paintedAt = performance.now(); ms = paintedAt - t0;
    seen = { trees: plan.items.filter(i => i.k === "tree").length, items: plan.items.length, px: [canvas.width, canvas.height], scale: px };
    return true;
  }

  return {
    get element(){ return layer; },
    /** Into a freshly drawn stage. A poll's redraw finds the same plates and leaves the picture alone. */
    attach(stage, p){
      try {
        const ko = forestKeepOut(p.svg, p.outdoorZ, p.plateOffsets);
        if (!ko) { this.detach(); return false; }
        ensure(stage);
        shapeKey = `${ko.viewBox.join(",")}|${ko.polys.map(P => P.map(q => `${q[0]},${q[1]}`).join(" ")).join(";")}`;
        last = { viewBox: ko.viewBox, polys: ko.polys, plates: ko.plates, seed: forestSeed(p.model) };
        // The panel's theme may have changed (the key tells paint), or a new
        // card only now comes on the page.
        if (!stage.isConnected || underInvert(layer) !== !!(painted && painted.endsWith("|inv"))) later();
        return true;
      } catch (_) { this.detach(); return false; }
    },
    /** Line it up with the drawing: its width and centring, or on a wall all of
     *  the stage or all of the drawing, whichever is more (`width`: the
     *  drawing's own CSS width there). Painted now if the plates changed, a
     *  moment later if only the size did. */
    fit(zoom, centred, width){
      if (!layer || !last) return;
      const a = (last.viewBox[3] / last.viewBox[2]).toFixed(6), st = layer.style, zp = `${Math.round((Number(zoom) || 1) * 100)}%`;
      const fk = `${a}|${zp}|${!!centred}|${width || ""}`, sized = fk !== fitKey;
      fitKey = fk;
      st.setProperty("--fa", a);
      st.setProperty("--fz", zp);
      if (width) {
        const tall = `max(100cqh, calc(${width} * ${a}))`;
        st.width = `max(100cqw, ${width})`; st.height = tall; st.paddingTop = "0"; st.marginBottom = `calc(-1 * ${tall})`;
        st.marginLeft = st.marginRight = "0";
      } else {
        st.width = st.height = st.paddingTop = st.marginBottom = "";
        st.marginLeft = st.marginRight = centred ? "auto" : "0";
      }
      // A poll's redraw comes here too, with nothing changed: nothing is measured or painted.
      // A slider being dragged asks often: the first now, the rest once it has settled.
      if (!painted || !painted.startsWith(`${shapeKey}|`)) { if (performance.now() - paintedAt < SOON_MS || !paint()) later(); }
      else if (sized) later();
    },
    /** Off the page; its picture kept for when it comes back. */
    detach(){ try { if (layer) layer.remove(); } catch (_) { /* already gone */ } },
    /** The theme is off: nothing kept but the empty slot. */
    release(){
      if (timer !== null) { clearTimeout(timer); timer = null; }
      if (ro) { ro.disconnect(); ro = null; }
      token++;
      try { if (layer) layer.remove(); if (shownUrl) URL.revokeObjectURL(shownUrl); } catch (_) { /* already gone */ }
      layer = null; stageNow = null; shapeKey = painted = last = seen = fitKey = shownUrl = null;
    },
    _state(){ return { paints, ms, painted, seen, on: !!layer }; },
  };
}
