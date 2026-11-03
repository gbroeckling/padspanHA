// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
// See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
//
// The trees of Showcase's West Coast Forest in Live Aboard, the flat Atlas's
// forest (atlas_forest.js) standing up: tall Douglas fir, western red cedar and
// western hemlock round the house, with long bare trunks and drooping boughs,
// on a near-black mossy floor with sword ferns, salal, logs and rocks, going
// back into cold mist under a dark overcast sky. live_aboard.js imports this
// file the first time it follows the Atlas (atlas_3d_look "atlas") with Showcase
// on and this theme; with any other look it is never fetched. Below Pro, Showcase
// is off, so the forest is too.
//
// Where everything stands is forestPlan: pure, seeded from the rooms' outlines
// (atlas_forest.js forestSeed), the same house the same forest. Nothing comes
// near a room, an outdoor room or a deck: a tree stands its margin plus its own
// crown away from every outline, so no crown ever reaches over the house.
//
// What it costs: one material, a handful of instanced draws and one painted
// texture; no lights, no shadows, nothing moving. A frame the view draws anyway
// sets a few uniforms (prepare); at rest nothing is drawn, as ever.
//
// What stands in the way: the vertex shader works out, per tree, whether it is
// between the camera and the house (or what the camera is looking at) and tall
// enough to reach the line of sight, or too close to the lens. Such a tree
// dissolves on a fine dither and then draws nothing, at any orbit, on any flight.
//
// THREE is handed in by the view (the bundled build it already holds): this file
// imports no three.js, so node runs the plan as it is.

const { cellRandom, forestSeed, houseShape, standOf } = await import(`./atlas_forest.js${new URL(import.meta.url).search}`);

export { forestSeed };
/** Metres kept clear of every outline: by a tree (plus its crown), and by what lies on the floor (plus its own size). */
export const TREE_MARGIN = 3, FLOOR_MARGIN = 1.2;
const TREE_MIN = 26, TREE_MAX = 50;        // metres: a two-storey house is about 7
const SPECIES = ["fir", "cedar", "hemlock"];
const TALL = { fir: 1, cedar: 0.82, hemlock: 0.8 };
const TREE_CELLS = 1500;                   // the grid trees stand on is no finer than this many cells across the forest
/** How far each thing goes, and how many at most. Low's forest is High's with some taken away. */
export const BUDGET = Object.freeze({
  high: Object.freeze({ depth: 118, trees: 0.82, near: 170, under: 42, ferns: 800, salal: 260, logs: 24, rocks: 46, variants: 2 }),
  low:  Object.freeze({ depth: 84,  trees: 0.46, near: 50,   under: 26, ferns: 260, salal: 90,  logs: 10, rocks: 18, variants: 1 }),
});
// A rain falling in the trees: this much farther out, and from this much higher (live_aboard_weather.js).
export const RAIN_REACH = Object.freeze({ reach: 12, rise: 14 });

// ── What stands where (pure: plan metres, x right, y down the plan) ─────────
/** The crown's reach of a tree of height h (metres), wr its width. */
const crownOf = (sp, h, wr) => SHAPE[sp].rmax * h * wr;
/** The forest for these rooms ([{pts: [[x, y], ...]}], every room of every
 *  floor, outdoor ones too): {cx, cy, R, out, trees, ferns, salal, logs, rocks},
 *  or null with no room. Pure: the same rooms and seed, the same forest. */
export function forestPlan(rooms, seed, profile = "high"){
  const polys = (rooms || []).map(r => r && r.pts).filter(P => Array.isArray(P) && P.length >= 3);
  if (!polys.length) return null;
  const B = profile === "high" ? BUDGET.high : BUDGET.low;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const P of polys) for (const q of P) { x0 = Math.min(x0, q[0]); y0 = Math.min(y0, q[1]); x1 = Math.max(x1, q[0]); y1 = Math.max(y1, q[1]); }
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, R = Math.hypot(x1 - x0, y1 - y0) / 2, out = R + B.depth;
  const shape = houseShape(polys);
  const toBox = (x, y) => Math.hypot(Math.max(x0 - x, 0, x - x1), Math.max(y0 - y, 0, y - y1));
  const cells = (size, salt, reach, fn) => {
    const ax = Math.floor((x0 - reach) / size), bx = Math.ceil((x1 + reach) / size), ay = Math.floor((y0 - reach) / size), by = Math.ceil((y1 + reach) / size);
    for (let iy = ay; iy <= by; iy++) for (let ix = ax; ix <= bx; ix++) { const r = cellRandom(seed, ix, iy, salt); fn(r, (ix + r()) * size, (iy + r()) * size); }
  };
  const byNear = (a, b) => a.d - b.d;

  // Trees: High's cell size whatever the budget, so Low's stand where High's do.
  const trees = [], cell = Math.max(7, Math.sqrt((2 * R + 2 * BUDGET.high.depth) ** 2 / TREE_CELLS));
  cells(cell, 31, BUDGET.high.depth, (r, x, y) => {
    const on = r(), kind = r(), tall = r(), wide = r(), rot = r(), tone = r(), hue = r(), old = r();
    const dc = Math.hypot(x - cx, y - cy);
    if (dc > out || on > B.trees * (1 - 0.2 * dc / out)) return;
    const st = standOf(seed, x * 4, y * 4) + (kind - 0.5) * 0.28;
    const sp = SPECIES[st < 0.42 ? 0 : st < 0.56 ? 1 : 2];
    const h = (TREE_MIN + tall * (TREE_MAX - TREE_MIN)) * TALL[sp] * (old > 0.92 ? 1.2 : 1);
    const wr = 0.85 + wide * 0.35, crown = crownOf(sp, h, wr);
    if (shape.near(x, y, TREE_MARGIN + crown)) return;
    trees.push({ sp, x, y, h, wr, crown, rot: rot * Math.PI * 2, tone: 0.82 + tone * 0.36, hue: hue * 2 - 1, v: hue > 0 ? 1 : 0, d: toBox(x, y) });
  });
  trees.sort(byNear);
  trees.forEach((t, i) => { t.near = i < B.near; });

  const floorThings = (size, salt, reach, chance, fn) => {
    const list = [];
    cells(size, salt, reach, (r, x, y) => {
      const on = r(), a = r(), b = r();
      const d = toBox(x, y);
      if (d > reach || on > chance(x, y)) return;
      const it = fn(x, y, a, b);
      if (it) { it.d = d; list.push(it); }
    });
    return list.sort(byNear);
  };
  const ferns = floorThings(3, 32, B.under, (x, y) => 0.2 + standOf(seed ^ 0x51ed, x * 12, y * 12) * 0.85, (x, y, a, b) => {
    const s = 0.95 + a * 0.85;
    return shape.near(x, y, FLOOR_MARGIN + s * 0.75) ? null : { x, y, s, r: s * 0.75, rot: b * Math.PI * 2, tone: 0.75 + a * 0.5, hue: b * 2 - 1 };
  }).slice(0, B.ferns);
  const salal = floorThings(4.6, 33, B.under, (x, y) => (standOf(seed ^ 0x2b7e, x * 9, y * 9) > 0.46 ? 0.55 : 0.08), (x, y, a, b) => {
    const s = 0.9 + a * 1.1;
    return shape.near(x, y, FLOOR_MARGIN + s * 0.7) ? null : { x, y, s, r: s * 0.7, rot: b * Math.PI * 2, tone: 0.8 + b * 0.4, hue: a * 2 - 1 };
  }).slice(0, B.salal);
  const rocks = floorThings(12, 34, Math.max(B.under, 36), () => 0.36, (x, y, a, b) => {
    const s = 0.7 + a * a * 1.9;
    return shape.near(x, y, FLOOR_MARGIN + s * 0.6) ? null : { x, y, s, r: s * 0.6, rot: b * Math.PI * 2, tone: 0.8 + b * 0.4, hue: 0 };
  }).slice(0, B.rocks);
  // Logs lie clear of the house along their whole length, and clear of the trunks.
  const logs = floorThings(19, 35, Math.max(B.under, 40), () => 0.62, (x, y, a, b) => {
    const len = 7 + a * 11, ang = b * Math.PI * 2, c = Math.cos(ang), s = Math.sin(ang), r = len * LOG_R;
    for (let k = -3; k <= 3; k++) {
      const px = x + c * len * k / 6, py = y + s * len * k / 6;
      if (shape.near(px, py, FLOOR_MARGIN + r)) return null;
      for (const t of trees) if (Math.hypot(t.x - px, t.y - py) < t.h * 0.034 + r + 0.5) return null;
    }
    return { x, y, s: len, r, rot: ang, tone: 0.8 + a * 0.4, hue: 0 };
  }).slice(0, B.logs);
  return { cx, cy, R, out, trees, ferns, salal, logs, rocks };
}

// ── The shapes (a tree 1 high, its width in the same units) ─────────────────
const LOG_R = 0.042;
// base: where the crown starts (the bare trunk below); rmax: the crown's reach;
// cards: boughs near and far; slot: its bough in the atlas; bark, leaf, tip: colours as shown.
const SHAPE = Object.freeze({
  fir:     Object.freeze({ base: 0.44, rmax: 0.135, pow: 0.82, slot: 0, trunk: 0.024, flare: 1.35, bark: [0.17, 0.135, 0.11], leaf: [0.052, 0.112, 0.082], tip: [0.13, 0.235, 0.19] }),
  cedar:   Object.freeze({ base: 0.2,  rmax: 0.17,  pow: 0.72, slot: 1, trunk: 0.03,  flare: 1.9,  bark: [0.2, 0.125, 0.09],  leaf: [0.06, 0.125, 0.07],  tip: [0.16, 0.27, 0.15] }),
  hemlock: Object.freeze({ base: 0.26, rmax: 0.145, pow: 0.92, slot: 2, trunk: 0.022, flare: 1.3,  bark: [0.15, 0.135, 0.125], leaf: [0.05, 0.105, 0.09],  tip: [0.13, 0.225, 0.2] }),
});
const CARDS = { near: { whorls: 20, per: 3, wide: 0.8 }, far: { whorls: 11, per: 3, wide: 1 } };
const MOSS = [0.1, 0.17, 0.075];

// The atlas: four across, four down. Row 0 fir, cedar, hemlock, bark; row 1 fern,
// salal, a plain mottled patch (rock, log, a crown's dark heart); rows 2 and 3
// the far treelines, the whole width (they wrap).
const ATLAS = 1024, CELL = 256, PAD = 7;
const slotUv = (c, r) => ({ u0: (c * CELL + PAD) / ATLAS, u1: ((c + 1) * CELL - PAD) / ATLAS, v0: 1 - ((r + 1) * CELL - PAD) / ATLAS, v1: 1 - (r * CELL + PAD) / ATLAS });
const SLOT = { boughs: [slotUv(0, 0), slotUv(1, 0), slotUv(2, 0)], bark: slotUv(3, 0), fern: slotUv(0, 1), salal: slotUv(1, 1), plain: slotUv(2, 1) };

function newGeo(){ return { p: [], t: [], c: [], i: [], n: 0 }; }
function vert(G, x, y, z, u, v, col, k = 1){
  G.p.push(x, y, z); G.t.push(u, v); G.c.push(col[0] * k, col[1] * k, col[2] * k);
  return G.n++;
}
const mixCol = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
/** A bough: a strip from the trunk out along az, falling by drops[i] at each
 *  row; rolled about its spine, so that from any side some of them show their face. */
function bough(G, S, y, az, L, W, drops, roll, colIn, colOut, k){
  const c = Math.cos(az), s = Math.sin(az), lx = -s * Math.cos(roll), lz = c * Math.cos(roll), ly = Math.sin(roll);
  const rows = drops.length, first = G.n;
  for (let i = 0; i < rows; i++) {
    const t = i / (rows - 1), r = L * t + 0.004, sy = y - drops[i], w = W / 2, col = mixCol(colIn, colOut, t);
    const v = S.v0 + (S.v1 - S.v0) * t;
    vert(G, c * r + lx * w, sy + ly * w, s * r + lz * w, S.u0, v, col, k);
    vert(G, c * r - lx * w, sy - ly * w, s * r - lz * w, S.u1, v, col, k);
  }
  for (let i = 0; i < rows - 1; i++) { const a = first + i * 2; G.i.push(a, a + 1, a + 3, a, a + 3, a + 2); }
}
/** Faces up a pole: rings [[y, radius, colour]]. */
function pole(G, rings, sides, S){
  const first = G.n;
  for (let j = 0; j < rings.length; j++) {
    const [y, r, col] = rings[j];
    for (let i = 0; i <= sides; i++) {
      const a = (i / sides) * Math.PI * 2, nx = Math.cos(a), nz = Math.sin(a);
      const lit = 0.62 + 0.38 * Math.max(0, nx * 0.5 + nz * 0.7 + 0.35);
      const wob = 1 + 0.07 * Math.sin(a * 3 + j);
      vert(G, nx * r * wob, y, nz * r * wob, S.u0 + (S.u1 - S.u0) * (i / sides), S.v0 + (S.v1 - S.v0) * (j / (rings.length - 1)), col, lit);
    }
  }
  const w = sides + 1;
  for (let j = 0; j < rings.length - 1; j++) for (let i = 0; i < sides; i++) {
    const a = first + j * w + i;
    G.i.push(a, a + w, a + 1, a + 1, a + w, a + w + 1);
  }
}
function treeGeo(sp, lod, rnd){
  const Sh = SHAPE[sp], G = newGeo(), near = lod === "near", C = CARDS[lod];
  const slot = SLOT.boughs[Sh.slot], rt = Sh.trunk;
  const barkAt = (y) => mixCol(MOSS, Sh.bark, Math.min(1, y / 0.16));
  // The trunk, bare up to the crown, flaring into the ground, mossy at its foot.
  const rings = near ? [[0, rt * Sh.flare], [0.02, rt * (1 + (Sh.flare - 1) * 0.3)], [0.09, rt * 0.93], [0.5, rt * 0.55], [0.97, rt * 0.05]]
    : [[0, rt * Sh.flare * 0.9], [0.1, rt * 0.9], [0.97, rt * 0.05]];
  pole(G, rings.map(([y, r]) => [y, r, barkAt(y)]), near ? 7 : 4, SLOT.bark);
  // The crown's dark heart: what shows through the boughs is shade, not sky.
  const heart = mixCol(Sh.leaf, [0, 0, 0], 0.55), hb = Sh.base + 0.05, hr = Sh.rmax * 0.46;
  pole(G, [[hb, hr * 0.6, heart], [hb + (0.97 - hb) * 0.2, hr, heart], [0.97, hr * 0.03, heart]], near ? 6 : 4, SLOT.plain);
  // The boughs, a golden angle apart, whorl on whorl.
  let az = rnd() * 6.28;
  for (let w = 0; w < C.whorls; w++) {
    const eta = (w + 0.35 * rnd()) / C.whorls, y = Sh.base + (0.985 - Sh.base) * eta;
    const reach = Sh.rmax * Math.pow(1 - eta, Sh.pow) * (0.72 + 0.28 * Math.min(1, eta * 7)) + 0.008;
    for (let q = 0; q < C.per; q++) {
      az += 2.39996;
      const L = reach * (0.82 + rnd() * 0.36), W = L * C.wide * (0.85 + rnd() * 0.3);
      const low = 1 - eta, top = eta > 0.8;
      let d1, d2;
      if (sp === "fir") { d1 = L * (top ? -0.28 : 0.06 + 0.2 * low); d2 = L * (top ? -0.42 : 0.2 + 0.46 * low); }
      else if (sp === "cedar") { d1 = L * (0.3 + 0.32 * low); d2 = L * (0.2 + 0.3 * low); }           // the J: down, then the tip turns up
      else { d1 = L * (0.14 + 0.2 * low); d2 = L * (0.56 + 0.34 * low); }                               // hemlock: soft, hanging
      const drops = near ? [0, d1, d2] : [0, d2 * 0.8];
      const roll = (rnd() - 0.5) * 1.5;
      const k = (0.62 + 0.62 * eta) * (0.85 + rnd() * 0.3);
      bough(G, slot, y, az, L, W, drops, roll, mixCol(Sh.leaf, [0, 0, 0], 0.3), Sh.tip, k);
    }
  }
  // Its leader; a hemlock's nods over.
  bough(G, slot, 0.965, az, 0.05, 0.02, near ? [0, sp === "hemlock" ? -0.02 : -0.03, sp === "hemlock" ? -0.018 : -0.05] : [0, -0.04], 0.4, Sh.leaf, Sh.tip, 1.05);
  return G;
}
function fernGeo(rnd){
  const G = newGeo(), n = 14, base = [0.02, 0.05, 0.03], tip = [0.09, 0.2, 0.115];
  for (let i = 0; i < n; i++) {
    const az = (i / n) * 6.283 + rnd() * 0.5, L = 0.6 + rnd() * 0.34, rise = 0.18 + rnd() * 0.36;
    bough(G, SLOT.fern, 0, az, L, 0.3, [-rise * 0.8, -rise, -rise * 0.3], (rnd() - 0.5) * 0.7, base, tip, 0.8 + rnd() * 0.45);
  }
  return G;
}
function salalGeo(rnd){
  const G = newGeo(), base = [0.03, 0.06, 0.04], tip = [0.11, 0.21, 0.135];
  for (let i = 0; i < 7; i++) {
    const az = i * 2.39996, L = 0.5 + rnd() * 0.3, up = 0.1 + (i / 7) * 0.5;
    bough(G, SLOT.salal, 0, az, L, 0.55, [-up, -up - 0.16, -up * 0.8], (rnd() - 0.5) * 1, base, tip, 0.8 + rnd() * 0.4);
  }
  return G;
}
function logGeo(){
  const G = newGeo(), S = SLOT.plain, sides = 7, bark = [0.095, 0.075, 0.06], moss = [0.105, 0.185, 0.08];
  const xs = [-0.5, -0.15, 0.2, 0.5], w = sides + 1;
  for (let j = 0; j < xs.length; j++) for (let i = 0; i <= sides; i++) {
    const a = (i / sides) * Math.PI * 2, ny = Math.sin(a), nz = Math.cos(a), r = LOG_R * (j === 3 ? 0.75 : 1 - j * 0.05) * (1 + 0.1 * Math.sin(a * 2 + j));
    vert(G, xs[j], LOG_R * 0.55 + ny * r, nz * r, S.u0 + (S.u1 - S.u0) * (i / sides), S.v0 + (S.v1 - S.v0) * (j / 3), mixCol(bark, moss, Math.max(0, ny * 1.5 - 0.05)), 0.65 + Math.max(0, ny) * 0.5);
  }
  for (let j = 0; j < xs.length - 1; j++) for (let i = 0; i < sides; i++) { const a = j * w + i; G.i.push(a, a + 1, a + w, a + 1, a + w + 1, a + w); }
  return G;
}
function rockGeo(rnd){
  const G = newGeo(), S = SLOT.plain, lat = 4, lon = 7, stone = [0.12, 0.13, 0.125], moss = [0.11, 0.195, 0.085], w = lon + 1, bump = [];
  for (let i = 0; i < lon; i++) bump.push(0.85 + rnd() * 0.32);
  for (let j = 0; j <= lat; j++) for (let i = 0; i <= lon; i++) {
    const ph = (j / lat) * Math.PI / 2, a = (i / lon) * Math.PI * 2, b = j === lat ? 1 : bump[i % lon] * (1 - (j % 2) * 0.06), ny = Math.sin(ph);
    vert(G, Math.cos(a) * Math.cos(ph) * b * 0.56, ny * 0.5 * b - 0.04, Math.sin(a) * Math.cos(ph) * b * 0.5,
         S.u0 + (S.u1 - S.u0) * (i / lon), S.v0 + (S.v1 - S.v0) * (j / lat), mixCol(stone, moss, Math.min(1, ny * 1.3)), 0.6 + ny * 0.5);
  }
  for (let j = 0; j < lat; j++) for (let i = 0; i < lon; i++) { const a = j * w + i; G.i.push(a, a + w, a + 1, a + 1, a + w, a + w + 1); }
  return G;
}
/** The two far treelines: bands facing in, wrapping the atlas's rows 2 and 3. */
function bandsGeo(r1, h1, r2, h2){
  const G = newGeo(), segs = 56;
  const band = (r, h, row, rep, col) => {
    const first = G.n, v0 = 1 - ((row + 1) * CELL - PAD) / ATLAS, v1 = 1 - (row * CELL + PAD) / ATLAS;
    for (const t of [0, 0.45, 1]) for (let i = 0; i <= segs; i++) {
      const a = (i / segs) * Math.PI * 2;
      vert(G, Math.cos(a) * r, t * h, Math.sin(a) * r, (i / segs) * rep, v0 + (v1 - v0) * t, col);
    }
    const w = segs + 1;
    for (let j = 0; j < 2; j++) for (let i = 0; i < segs; i++) { const a = first + j * w + i; G.i.push(a, a + 1, a + w + 1, a, a + w + 1, a + w); }
  };
  band(r2, h2, 3, 3, [0.05, 0.085, 0.08]);
  band(r1, h1, 2, 4, [0.03, 0.055, 0.048]);
  return G;
}

// ── The picture every bough is cut from ─────────────────────────────────────
function makeCanvas(w, h){ const c = document.createElement("canvas"); c.width = w; c.height = h; return c; }
const grey = (v, a = 1) => { const n = Math.round(Math.max(0, Math.min(1, v)) * 255); return `rgba(${n},${n},${n},${a})`; };
function needles(g, rnd, x0, y0, ang, len, n, nl, lum){
  const ca = Math.cos(ang), sa = Math.sin(ang);
  g.beginPath();
  g.strokeStyle = grey(lum);
  for (let i = 0; i < n; i++) {
    const t = i / n, x = x0 + ca * len * t, y = y0 + sa * len * t, l = nl * (1.15 - t * 0.6);
    for (const side of [-1, 1]) {
      const a = ang + side * (0.75 + rnd() * 0.25);
      g.moveTo(x, y); g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l);
    }
  }
  g.stroke();
}
/** A spray on a stem from the slot's foot to its tip. */
function spray(g, rnd, s, o){
  const cx = s / 2;
  // Its body, dark, under the needles: seen from far off this is the bough.
  g.fillStyle = grey(0.34);
  g.beginPath(); g.moveTo(cx, s);
  for (let i = 0; i <= 10; i++) { const t = i / 10; g.lineTo(cx - o.body * s * Math.pow(Math.sin(Math.PI * Math.min(1, t * 0.92 + 0.08)), 0.7) * (0.82 + rnd() * 0.3), s * (1 - t * 0.97)); }
  for (let i = 10; i >= 0; i--) { const t = i / 10; g.lineTo(cx + o.body * s * Math.pow(Math.sin(Math.PI * Math.min(1, t * 0.92 + 0.08)), 0.7) * (0.82 + rnd() * 0.3), s * (1 - t * 0.97)); }
  g.closePath(); g.fill();
  g.lineCap = "round";
  for (let i = 0; i < o.twigs; i++) {
    const t = (i + 0.4) / o.twigs, y = s * (1 - t * 0.95), reach = o.reach * s * Math.pow(Math.sin(Math.PI * Math.min(1, t * 0.88 + 0.12)), 0.8);
    for (const side of [-1, 1]) {
      const ang = -Math.PI / 2 + side * (o.angle + rnd() * 0.15), lum = 0.5 + rnd() * 0.5;
      g.lineWidth = o.nw + 0.5; g.strokeStyle = grey(0.3);
      g.beginPath(); g.moveTo(cx, y); g.lineTo(cx + Math.cos(ang) * reach, y + Math.sin(ang) * reach); g.stroke();
      g.lineWidth = o.nw; needles(g, rnd, cx, y, ang, reach, o.n, o.nl, lum);
    }
  }
  g.strokeStyle = grey(0.22); g.lineWidth = 3.5;
  g.beginPath(); g.moveTo(cx, s); g.lineTo(cx, s * 0.05); g.stroke();
}
/** Cedar's flat lace: every branch splits, alternately, into smaller ones. */
function lace(g, rnd, x, y, ang, len, depth){
  const ex = x + Math.cos(ang) * len, ey = y + Math.sin(ang) * len;
  g.strokeStyle = grey(0.42 + (3 - depth) * 0.14 + rnd() * 0.3); g.lineWidth = 1.3 + depth * 1.05;
  g.beginPath(); g.moveTo(x, y); g.lineTo(ex, ey); g.stroke();
  if (depth <= 0) return;
  const n = 3 + depth;
  for (let i = 1; i <= n; i++) {
    const t = i / (n + 0.4), px = x + (ex - x) * t, py = y + (ey - y) * t, l = len * 0.5 * (1.1 - t * 0.55);
    lace(g, rnd, px, py, ang + 0.72, l, depth - 1);
    lace(g, rnd, px, py, ang - 0.72, l, depth - 1);
  }
}
function barkPatch(g, rnd, s){
  g.fillStyle = grey(0.62); g.fillRect(0, 0, s, s);
  for (let i = 0; i < 130; i++) {
    const x = rnd() * s, w = 1.5 + rnd() * 7, y = rnd() * s, l = s * (0.2 + rnd() * 0.7), dark = rnd() < 0.6;
    g.strokeStyle = dark ? `rgba(0,0,0,${0.25 + rnd() * 0.45})` : `rgba(255,255,255,${0.08 + rnd() * 0.2})`;
    g.lineWidth = w;
    g.beginPath(); g.moveTo(x, y - l / 2); g.quadraticCurveTo(x + (rnd() - 0.5) * 14, y, x + (rnd() - 0.5) * 8, y + l / 2); g.stroke();
  }
}
function plainPatch(g, rnd, s){
  g.fillStyle = grey(0.72); g.fillRect(0, 0, s, s);
  for (let i = 0; i < 500; i++) {
    const r = 2 + rnd() * 13; g.fillStyle = rnd() < 0.5 ? `rgba(0,0,0,${0.07 + rnd() * 0.15})` : `rgba(255,255,255,${0.05 + rnd() * 0.14})`;
    g.beginPath(); g.arc(rnd() * s, rnd() * s, r, 0, 6.3); g.fill();
  }
}
function fernPatch(g, rnd, s){
  // A sword fern's frond: narrow, its leaflets separate and pointing toward the tip.
  const cx = s / 2, n = 21;
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n, y = s * (1 - t * 0.97), l = s * 0.46 * Math.pow(Math.sin(Math.PI * Math.min(1, 0.14 + t * 0.85)), 0.62), w = s * 0.015;
    for (const side of [-1, 1]) {
      g.fillStyle = grey(0.6 + rnd() * 0.4);
      g.beginPath(); g.moveTo(cx, y + w); g.quadraticCurveTo(cx + side * l * 0.5, y - s * 0.002, cx + side * l, y - s * 0.05); g.quadraticCurveTo(cx + side * l * 0.45, y - w * 2, cx, y - w); g.closePath(); g.fill();
    }
  }
  g.strokeStyle = grey(0.3); g.lineWidth = 2; g.beginPath(); g.moveTo(cx, s); g.lineTo(cx, s * 0.02); g.stroke();
}
function salalPatch(g, rnd, s){
  for (let i = 0; i < 15; i++) {
    const x = s * (0.2 + rnd() * 0.6), y = s * (0.14 + rnd() * 0.72), a = rnd() * 6.3, L = s * (0.16 + rnd() * 0.08), W = L * 0.56;
    g.save(); g.translate(x, y); g.rotate(a);
    g.fillStyle = grey(0.55 + rnd() * 0.45);
    g.beginPath(); g.moveTo(-L, 0); g.quadraticCurveTo(0, -W * 1.3, L, 0); g.quadraticCurveTo(0, W * 1.3, -L, 0); g.fill();
    g.strokeStyle = grey(0.25); g.lineWidth = 1.5; g.beginPath(); g.moveTo(-L, 0); g.lineTo(L, 0); g.stroke();
    g.restore();
  }
}
/** A wall of tree tops across the whole row, solid below; wraps left to right. */
function treeline(g, rnd, W, H, n){
  g.fillStyle = "#fff";
  g.fillRect(0, H * 0.62, W, H * 0.38);
  for (let i = 0; i < n; i++) {
    const x = rnd() * W, top = H * (0.03 + rnd() * rnd() * 0.5), w = 14 + rnd() * 22;
    for (const ox of [-W, 0, W]) {
      g.beginPath(); g.moveTo(x + ox, top);
      const steps = 11;
      for (let j = 1; j <= steps; j++) { const t = j / steps, y = top + (H * 0.75 - top) * t, hw = w * t * (0.85 + rnd() * 0.45); g.lineTo(x + ox + hw, y); g.lineTo(x + ox + hw * 0.62, y - 2); }
      for (let j = steps; j >= 1; j--) { const t = j / steps, y = top + (H * 0.75 - top) * t, hw = w * t * (0.85 + rnd() * 0.45); g.lineTo(x + ox - hw * 0.62, y - 2); g.lineTo(x + ox - hw, y); }
      g.closePath(); g.fill();
    }
  }
}
function paintAtlas(){
  const c = makeCanvas(ATLAS, ATLAS), g = c.getContext("2d"), rnd = cellRandom(0x5eed, 1, 2, 3);
  const inSlot = (col, row, fn) => {
    g.save(); g.translate(col * CELL + PAD, row * CELL + PAD);
    g.beginPath(); g.rect(0, 0, CELL - 2 * PAD, CELL - 2 * PAD); g.clip();
    fn(CELL - 2 * PAD); g.restore();
  };
  inSlot(0, 0, s => spray(g, rnd, s, { twigs: 11, reach: 0.44, angle: 0.72, n: 15, nl: 11, nw: 2, body: 0.26 }));      // fir: stiff, sparse
  inSlot(1, 0, s => { g.lineCap = "round"; g.fillStyle = grey(0.3); g.beginPath(); g.ellipse(s / 2, s * 0.55, s * 0.26, s * 0.42, 0, 0, 6.3); g.fill(); lace(g, rnd, s / 2, s, -Math.PI / 2, s * 0.94, 3); });   // cedar: flat lace
  inSlot(2, 0, s => spray(g, rnd, s, { twigs: 15, reach: 0.4, angle: 0.95, n: 13, nl: 7, nw: 1.5, body: 0.28 }));      // hemlock: fine, feathery
  inSlot(3, 0, s => barkPatch(g, rnd, s));
  inSlot(0, 1, s => fernPatch(g, rnd, s));
  inSlot(1, 1, s => salalPatch(g, rnd, s));
  inSlot(2, 1, s => plainPatch(g, rnd, s));
  g.save(); g.translate(0, 2 * CELL + PAD); treeline(g, rnd, ATLAS, CELL - 2 * PAD, 90); g.restore();
  g.save(); g.translate(0, 3 * CELL + PAD); treeline(g, rnd, ATLAS, CELL - 2 * PAD, 130); g.restore();
  return c;
}
function paintMoss(){
  const S = 256, c = makeCanvas(S, S), g = c.getContext("2d"), rnd = cellRandom(0x5eed, 4, 5, 6);
  g.fillStyle = "#0c140f"; g.fillRect(0, 0, S, S);
  // Clumps of moss: many fine dabs in drifts, no one of them seen.
  const COLS = ["rgba(30,46,26,.42)", "rgba(20,32,20,.5)", "rgba(6,10,8,.55)", "rgba(38,52,28,.26)", "rgba(26,23,16,.38)"];
  for (let i = 0; i < 90; i++) {
    const cx = rnd() * S, cy = rnd() * S, r = 5 + rnd() * 22, col = COLS[Math.floor(rnd() * COLS.length)];
    g.fillStyle = col;
    for (let j = 0; j < 90; j++) {
      const a = rnd() * 6.3, d = r * Math.sqrt(rnd()), x = (cx + Math.cos(a) * d + S) % S, y = (cy + Math.sin(a) * d + S) % S;
      g.fillRect(x, y, 1 + rnd() * 1.6, 1 + rnd() * 1.6);
    }
  }
  // Fallen needles and twigs.
  g.lineWidth = 1;
  for (let i = 0; i < 520; i++) {
    const x = rnd() * S, y = rnd() * S, a = rnd() * 6.3, l = 2 + rnd() * 6;
    g.strokeStyle = rnd() < 0.5 ? "rgba(54,41,26,.45)" : "rgba(44,56,34,.38)";
    g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); g.stroke();
  }
  return c;
}

// ── The shaders: the GPU fades, nothing per tree on the CPU per frame ───────
const VS = `
uniform vec3 uEye;
uniform vec4 uHouse, uAim;
uniform vec2 uFog;
attribute vec3 aCol;
attribute vec4 iA, iB;
attribute vec3 iC;
varying vec2 vUv;
varying vec3 vCol;
varying float vFog, vFade;
#ifndef STILL
// 1: stays. 0: it stands between the eye and a circle (c, R) and reaches the line of sight down to that circle's near edge.
float wedge(vec2 b, float top, float crown, vec2 c, float R){
  vec2 v = c - uEye.xz;
  float d = length(v);
  if (d <= R + 0.5) return 1.0;
  vec2 a = v / d, r = b - uEye.xz;
  float s = dot(r, a);
  if (s <= 0.0) return 1.0;
  float l = abs(r.x * a.y - r.y * a.x), hw = s * R / sqrt(d * d - R * R) + crown + 1.5;
  float side = max(smoothstep(hw, hw + 2.5, l), smoothstep(d, d + 2.5, s));
  float sight = uEye.y + (uHouse.w - uEye.y) * min(s / max(d - R, 1.0), 1.0);
  return max(side, smoothstep(1.0, 3.5, sight - top));
}
#endif
void main(){
  float w = iA.w * iB.z;
  vec3 world = vec3(iA.x + (iB.x * position.x - iB.y * position.z) * w, iA.y + position.y * iA.w, iA.z + (iB.y * position.x + iB.x * position.z) * w);
  vFade = 1.0;
#ifndef STILL
  float top = iA.y + iC.z, ey = min(max(uEye.y, iA.y), top);
  float lens = length(vec3(iA.x - uEye.x, uEye.y - ey, iA.z - uEye.z));
  vFade = min(smoothstep(iB.w + 9.0, iB.w + 14.0, lens),
              min(wedge(iA.xz, top, iB.w, uHouse.xy, uHouse.z), wedge(iA.xz, top, iB.w, uAim.xy, uAim.z)));
  if (vFade <= 0.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
#endif
  vUv = uv;
  vCol = aCol * iC.x * vec3(1.0 + iC.y * 0.1, 1.0, 1.0 - iC.y * 0.1);
  float d = max(distance(world, uEye) - uFog.x, 0.0);
  vFog = 1.0 - exp(-d * uFog.y * (0.5 + exp(-max(world.y - uHouse.w, 0.0) / 15.0)));
  gl_Position = projectionMatrix * modelViewMatrix * vec4(world, 1.0);
}`;
const FS = `
uniform sampler2D uMap;
uniform vec3 uMist;
uniform float uLight;
varying vec2 vUv;
varying vec3 vCol;
varying float vFog, vFade;
void main(){
  vec4 t = texture2D(uMap, vUv);
#ifdef A2C
  if (t.a < 0.3) discard;
  float a = smoothstep(0.3, 0.46, t.a);
#else
  if (t.a < 0.42) discard;
  float a = 1.0;
#endif
  if (vFade < 0.995 && fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715)))) > vFade) discard;
  gl_FragColor = vec4(mix(vCol * t.rgb * uLight, uMist, vFog), a);
}`;
const FLOOR_VS = `
varying vec3 vW;
void main(){ vW = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const FLOOR_FS = `
uniform sampler2D uMoss;
uniform vec3 uEye, uMist;
uniform vec4 uHouse;
uniform vec2 uFog, uEdge;
uniform float uLight;
varying vec3 vW;
void main(){
  vec3 a = texture2D(uMoss, vW.xz / 5.3).rgb, b = texture2D(uMoss, vW.zx / 41.0 + 0.37).rgb;
  float d = max(distance(vW, uEye) - uFog.x, 0.0);
  float f = max(1.0 - exp(-d * uFog.y * 1.5), smoothstep(uEdge.x, uEdge.y, distance(vW.xz, uHouse.xy)));
  gl_FragColor = vec4(mix(a * (0.5 + b * 4.5) * uLight, uMist, f), 1.0);
}`;
const SKY_VS = `
varying vec3 vD;
void main(){ vD = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const SKY_FS = `
uniform vec3 uMist, uSky;
varying vec3 vD;
void main(){ gl_FragColor = vec4(mix(uMist, uSky, smoothstep(0.0, 0.5, normalize(vD).y)), 1.0); }`;

// By day it is overcast under the canopy; by night nearly gone. Shown as written (no tone mapping, no lamp reaches them).
const MIST_DAY = "#2a3a3a", MIST_NIGHT = "#121e20", SKY_DAY = "#141d20", SKY_NIGHT = "#04080a", LIGHT_NIGHT = 0.72;
const FOG_DENSITY = 0.016;

/** The forest in a scene: {house({rooms, ground, seed}), prepare(camera, target,
 *  {on, night, profile}), state(), dispose()}. Everything here is its own: when
 *  it goes, the scene is as it found it. */
export function createForest({ THREE, scene, renderer }){
  const group = new THREE.Group();
  group.name = "forest";
  scene.add(group);
  const texOf = (canvas, repeat) => {
    const t = new THREE.CanvasTexture(canvas);
    t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter;
    if (repeat === "both") t.wrapS = t.wrapT = THREE.RepeatWrapping; else t.wrapS = THREE.RepeatWrapping;
    return t;
  };
  const map = texOf(paintAtlas()), moss = texOf(paintMoss(), "both");
  // Colours are written to the screen as they are: no colour-space step, no tone mapping.
  const shown = (hex) => new THREE.Color(hex).convertLinearToSRGB();
  const dayMist = shown(MIST_DAY), nightMist = shown(MIST_NIGHT), daySky = shown(SKY_DAY), nightSky = shown(SKY_NIGHT);
  const shared = { uEye: { value: new THREE.Vector3() }, uHouse: { value: new THREE.Vector4() }, uAim: { value: new THREE.Vector4() },
                   uFog: { value: new THREE.Vector2(0, FOG_DENSITY) }, uMist: { value: dayMist.clone() }, uSky: { value: daySky.clone() },
                   uEdge: { value: new THREE.Vector2(200, 300) }, uLight: { value: 1 }, uMap: { value: map }, uMoss: { value: moss } };
  const raw = (o) => new THREE.ShaderMaterial({ uniforms: shared, toneMapped: false, fog: false, lights: false, ...o });
  const a2c = !!(renderer && renderer.getContext && (renderer.getContext().getContextAttributes() || {}).antialias);
  const defines = a2c ? { A2C: 1 } : {};
  const mats = {
    tree: raw({ vertexShader: VS, fragmentShader: FS, side: THREE.DoubleSide, alphaToCoverage: a2c, defines }),
    band: raw({ vertexShader: VS, fragmentShader: FS, side: THREE.FrontSide, alphaToCoverage: a2c, defines: { ...defines, STILL: 1 } }),
    floor: raw({ vertexShader: FLOOR_VS, fragmentShader: FLOOR_FS }),
    sky: raw({ vertexShader: SKY_VS, fragmentShader: SKY_FS, side: THREE.BackSide, depthWrite: false }),
  };
  const sky = new THREE.Mesh(new THREE.SphereGeometry(600, 20, 10), mats.sky);
  sky.frustumCulled = false; sky.renderOrder = 9;
  group.add(sky);
  let meshes = [], houseIn = null, key = null, built = null, plan = null, lastNight = -1, broken = false;

  const instances = (G, list, order, topOf, material = mats.tree) => {
    if (!list.length) return null;
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(G.p, 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(G.t, 2));
    g.setAttribute("aCol", new THREE.Float32BufferAttribute(G.c, 3));
    g.setIndex(G.i);
    const a = new Float32Array(list.length * 4), b = new Float32Array(list.length * 4), c = new Float32Array(list.length * 3), y = houseIn.ground;
    list.forEach((t, i) => {
      a.set([t.x, y, t.y, t.h ?? t.s], i * 4);
      b.set([Math.cos(t.rot), Math.sin(t.rot), t.wr ?? 1, t.crown ?? t.r], i * 4);
      c.set([t.tone, t.hue, topOf(t)], i * 3);
    });
    g.setAttribute("iA", new THREE.InstancedBufferAttribute(a, 4));
    g.setAttribute("iB", new THREE.InstancedBufferAttribute(b, 4));
    g.setAttribute("iC", new THREE.InstancedBufferAttribute(c, 3));
    g.instanceCount = list.length;
    const m = new THREE.Mesh(g, material);
    m.frustumCulled = false; m.renderOrder = order;
    group.add(m);
    meshes.push(m);
    return m;
  };
  function clear(){
    for (const m of meshes) { group.remove(m); m.geometry.dispose(); }
    meshes = [];
  }
  function build(profile){
    clear();
    built = profile;
    plan = forestPlan(houseIn.rooms, houseIn.seed, profile);
    if (!plan) return;
    const { cx, cy, R, out } = plan, seed = houseIn.seed, y = houseIn.ground, B = profile === "high" ? BUDGET.high : BUDGET.low;
    shared.uHouse.value.set(cx, cy, R + 1, y);
    shared.uEdge.value.set(out + 6, out + 90);
    // Nearest first, the floor and the sky last: what is hidden costs least.
    const topOfTree = (t) => t.h;
    for (const sp of SPECIES) {
      const mine = plan.trees.filter(t => t.sp === sp);
      const nearOnes = mine.filter(t => t.near);
      for (let v = 0; v < B.variants; v++) {
        const list = B.variants > 1 ? nearOnes.filter(t => t.v === v) : nearOnes;
        if (list.length) instances(treeGeo(sp, "near", cellRandom(seed, SPECIES.indexOf(sp), v, 71)), list, 1, topOfTree);
      }
      instances(treeGeo(sp, "far", cellRandom(seed, SPECIES.indexOf(sp), 9, 72)), mine.filter(t => !t.near), 3, topOfTree);
    }
    const r = cellRandom(seed, 1, 1, 73);
    instances(fernGeo(r), plan.ferns, 2, (t) => t.s * 0.5);
    instances(salalGeo(r), plan.salal, 2, (t) => t.s * 0.6);
    instances(logGeo(), plan.logs, 2, (t) => t.r * 2);
    instances(rockGeo(r), plan.rocks, 2, (t) => t.s * 0.5);
    // The far treelines, past the last tree: seen only from inside the forest.
    instances(bandsGeo(out + 5, 64, out + 44, 92), [{ x: cx, y: cy, s: 1, r: 0, rot: 0, tone: 1, hue: 0 }], 5, () => 0, mats.band);
    const gg = new THREE.CircleGeometry(430, 64).rotateX(-Math.PI / 2).translate(cx, y, cy);
    const floor = new THREE.Mesh(gg, mats.floor);
    floor.frustumCulled = false; floor.renderOrder = 4;
    group.add(floor);
    meshes.push(floor);
  }
  return {
    /** The house changed, or came: rooms as the view reads them, the ground's height, forestSeed's seed. */
    house(h){
      const k = `${h.seed}|${Math.round(h.ground * 1000)}`;
      houseIn = h;
      if (k !== key) { key = k; built = null; }
    },
    /** For a frame about to be drawn. on false: none of it is drawn. */
    prepare(camera, target, o){
      group.visible = !!o.on;
      if (!o.on || !houseIn || broken) return;
      if (built !== o.profile) build(o.profile);
      const e = camera.position, h = shared.uHouse.value;
      shared.uEye.value.copy(e);
      // What is framed, however close: a narrow line of sight to it.
      shared.uAim.value.set(target.x, target.z, Math.min(10, 0.3 * e.distanceTo(target)), 0);
      shared.uFog.value.x = 0.6 * Math.hypot(e.x - h.x, e.z - h.y, e.y - h.w);
      sky.position.copy(e);
      if (o.night !== lastNight) {
        lastNight = o.night;
        shared.uMist.value.copy(dayMist).lerp(nightMist, o.night);
        shared.uSky.value.copy(daySky).lerp(nightSky, o.night);
        shared.uLight.value = 1 + (LIGHT_NIGHT - 1) * o.night;
      }
    },
    /** The harness reads what is drawn. */
    state(){
      return { shown: group.visible, profile: built, seed: houseIn ? houseIn.seed : null, draws: meshes.length + 1,
               trees: plan ? plan.trees.length : 0, ferns: plan ? plan.ferns.length : 0, salal: plan ? plan.salal.length : 0,
               logs: plan ? plan.logs.length : 0, rocks: plan ? plan.rocks.length : 0, near: plan ? plan.trees.filter(t => t.near).length : 0 };
    },
    dispose(){
      broken = true;
      clear();
      scene.remove(group);
      sky.geometry.dispose();
      for (const m of Object.values(mats)) m.dispose();
      map.dispose(); moss.dispose();
    },
  };
}
