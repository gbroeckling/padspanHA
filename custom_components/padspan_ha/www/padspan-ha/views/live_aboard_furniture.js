// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
// See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
//
// Live Aboard, the 3D house (docs/IDEA_ATLAS_3D_HOUSE.md): the furniture
// builders. Every piece is a recipe, plain data —
//   {kind, params, colors: ["#rrggbb", …], width_m, depth_m, height_m, details?}
// — and a builder here, PadSpan's own code, draws it. The look is
// deliberately simple and Sims-like: boxes, rounded boxes, cylinders and
// bevels, flat colours on Low and finishes made in code on High (wood grain,
// fabric weave, brushed metal, gloss). No model files, no texture files.
//
// The recipe's width × depth × height is always the piece's whole box (what
// the plan, the fit checks, a photo's one real measurement and the library
// use); a kind's params are its style and never restate a size. So a sofa's
// "back height" is its Height and its "seat depth" its Depth, and a bed's
// headboard height is the bed's Height. A choice that implies a size (a king
// bed, a 4-seat sofa) carries `sizes`, the sizes Build may set when that
// choice is picked; the recipe's own numbers always win when drawing.
// Params whose key ends in _m are metres.
//
// Reading is tolerant, as everywhere in the 3D file: unknown kinds, params
// and keys are kept, numbers are clamped, a bad choice becomes the default,
// and an unknown kind is drawn as a coloured box of its size. Nothing is
// ever refused.
//
// three.js is handed in by the caller (the view already holds the bundled
// build), so this file imports nothing and runs under node in the tests.
// Each piece's local frame: the origin on the floor under the centre of its
// footprint, width along x, depth along z with the FRONT toward +z, up +y,
// and all of it inside width × depth × height.
//
// Each piece's geometry is merged per look (one draw call per colour and
// finish) by this file's own small merge. Materials and finish textures are
// shared between pieces by colour + finish and counted: disposing a piece
// never frees one another piece still uses, and once no piece uses one it
// is freed, so nothing here outlives the pieces (or keeps an old renderer
// alive). A live part — a lamp's glow, a TV's screen, a radiator's warmth —
// has a material of its own, so changing it changes only that piece.

const TILE = 0.5;                       // a finish repeats every half metre
const BOX_COLOR = "#9aa3ab";
const BOX_SIZE = { width_m: [0.05, 6, 0.6], depth_m: [0.05, 6, 0.6], height_m: [0.02, 4, 0.6] };
const DIMS = ["width_m", "depth_m", "height_m"];

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const isObj = (v) => !!v && typeof v === "object" && !Array.isArray(v);
const toNum = (v) => (typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN);

// A JSON-safe deep copy: recipes are plain data, so anything else is dropped.
function plain(v, depth = 0){
  if (v === null || typeof v === "string" || typeof v === "boolean") return v;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (depth > 24) return null;
  if (Array.isArray(v)) return v.map((x) => { const c = plain(x, depth + 1); return c === undefined ? null : c; });
  if (isObj(v)) {
    const o = {};
    for (const [k, x] of Object.entries(v)) {
      if (k === "__proto__") continue;
      const c = plain(x, depth + 1);
      if (c !== undefined) o[k] = c;
    }
    return o;
  }
  return undefined;
}
function hexOf(v){
  if (typeof v !== "string") return null;
  let s = v.trim().toLowerCase();
  if (/^#[0-9a-f]{3}$/.test(s)) s = "#" + s[1] + s[1] + s[2] + s[2] + s[3] + s[3];
  return /^#[0-9a-f]{6}$/.test(s) ? s : null;
}
function mix(a, b, t){
  const pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16);
  const ch = (s) => Math.round(((pa >> s) & 255) + (((pb >> s) & 255) - ((pa >> s) & 255)) * t);
  return "#" + ((ch(16) << 16) | (ch(8) << 8) | ch(0)).toString(16).padStart(6, "0");
}
const lighten = (c, t) => mix(c, "#ffffff", t);
const darken = (c, t) => mix(c, "#000000", t);

// ── the kinds ────────────────────────────────────────────────────────────────
const int = (key, label, min, max, def, more) => ({ key, label, type: "int", min, max, step: 1, def, ...more });
const num = (key, label, min, max, step, def, more) => ({ key, label, type: "num", min, max, step, def, ...more });
const choice = (key, label, choices, def, more) => ({ key, label, type: "choice", choices, def, ...more });
const bool = (key, label, def, more) => ({ key, label, type: "bool", def, ...more });
const kind = (name, group, category, live, colorNames, colors, size, params) =>
  ({ name, group, category, params, colorNames, colors, size, live });
const sz = (w, d, h) => ({ width_m: w, depth_m: d, height_m: h });

export const FURNITURE = {
  sofa: kind("Sofa", "furniture", "seating", null, ["Body", "Cushions"], ["#5b6b7a", "#c8b89a"],
    sz([0.6, 3.6, 2.1], [0.6, 1.2, 0.9], [0.55, 1.1, 0.82]), [
      int("seats", "Seats", 1, 4, 3, { sizes: { 1: { width_m: 0.95 }, 2: { width_m: 1.55 }, 3: { width_m: 2.1 }, 4: { width_m: 2.7 } } }),
      choice("arms", "Arms", ["none", "slim", "wide", "rolled"], "slim"),
      num("seat_h_m", "Seat height", 0.3, 0.55, 0.01, 0.44),
      choice("legs", "Legs", ["none", "block", "tapered", "metal"], "tapered"),
      int("cushions", "Back cushions", 0, 4, 3),
    ]),
  bed: kind("Bed", "furniture", "sleeping", null, ["Frame", "Bedding"], ["#6b4f3a", "#7f97ad"],
    sz([0.6, 2.3, 1.66], [1.0, 2.4, 2.2], [0.35, 2.0, 1.1]), [
      choice("size", "Size", ["twin", "double", "queen", "king", "crib", "bunk"], "queen", { sizes: {
        twin: { width_m: 1.13, depth_m: 2.1, height_m: 1.0 }, double: { width_m: 1.51, depth_m: 2.1, height_m: 1.05 },
        queen: { width_m: 1.66, depth_m: 2.2, height_m: 1.1 }, king: { width_m: 2.07, depth_m: 2.2, height_m: 1.15 },
        crib: { width_m: 0.8, depth_m: 1.42, height_m: 0.95 }, bunk: { width_m: 1.13, depth_m: 2.1, height_m: 1.7 } } }),
      choice("headboard", "Headboard", ["none", "panel", "slatted", "padded"], "padded", { sizes: {
        none: { height_m: 0.65 }, panel: { height_m: 1.1 }, slatted: { height_m: 1.1 }, padded: { height_m: 1.15 } } }),
      bool("footboard", "Footboard", false),
      choice("base", "Base", ["frame", "platform"], "frame"),
    ]),
  table: kind("Table", "furniture", "tables", null, ["Top", "Legs"], ["#9b7653", "#7a5a40"],
    sz([0.4, 3.0, 1.6], [0.4, 1.4, 0.9], [0.35, 1.1, 0.75]), [
      choice("shape", "Shape", ["rectangle", "rounded", "round"], "rectangle", { sizes: { round: { width_m: 1.1, depth_m: 1.1 } } }),
      choice("legs", "Legs", ["four", "pedestal", "trestle"], "four"),
      num("top_t_m", "Top thickness", 0.015, 0.08, 0.005, 0.035),
      bool("apron", "Rail under the top", true),
    ]),
  chair: kind("Chair", "furniture", "seating", null, ["Frame", "Seat"], ["#7a5a40", "#b5a48a"],
    sz([0.35, 1.1, 0.48], [0.35, 1.0, 0.52], [0.4, 1.3, 0.9]), [
      choice("style", "Style", ["dining", "armchair", "office", "stool"], "dining", { sizes: {
        dining: { width_m: 0.48, depth_m: 0.52, height_m: 0.9 }, armchair: { width_m: 0.85, depth_m: 0.85, height_m: 0.85 },
        office: { width_m: 0.66, depth_m: 0.66, height_m: 1.05 }, stool: { width_m: 0.4, depth_m: 0.4, height_m: 0.65 } } }),
      num("seat_h_m", "Seat height", 0.3, 0.8, 0.01, 0.46),
      bool("cushion", "Cushioned seat", false),
      bool("arms", "Arms", false),
    ]),
  desk: kind("Desk", "furniture", "office", null, ["Top", "Frame"], ["#b08a63", "#3c3f44"],
    sz([0.6, 2.4, 1.4], [0.4, 1.0, 0.7], [0.5, 1.2, 0.75]), [
      choice("legs", "Legs", ["four", "panel", "metal"], "four"),
      choice("drawers", "Drawers", ["none", "left", "right", "both"], "right"),
      bool("back", "Back panel", true),
    ]),
  dresser: kind("Dresser / cabinet", "furniture", "storage", null, ["Body", "Fronts"], ["#7a5a40", "#8e6c4f"],
    sz([0.3, 2.4, 1.2], [0.25, 0.8, 0.5], [0.3, 2.2, 0.85]), [
      choice("fronts", "Fronts", ["drawers", "doors", "both"], "drawers"),
      int("columns", "Columns", 1, 4, 2),
      int("rows", "Drawers in a column", 1, 6, 3),
      choice("base", "Base", ["plinth", "feet", "legs"], "plinth"),
      choice("handles", "Handles", ["bar", "knob", "none"], "bar"),
    ]),
  tv: kind("TV + media unit", "furniture", "media", "screen", ["Unit", "TV"], ["#6e5039", "#1f2124"],
    sz([0.5, 3.0, 1.6], [0.2, 0.7, 0.42], [0.35, 2.4, 1.27]), [
      int("screen_in", "Screen size (inches)", 24, 98, 55),
      choice("unit", "Unit", ["low", "cabinet", "none"], "low"),
      choice("mount", "TV on", ["stand", "wall"], "stand"),
    ]),
  lamp: kind("Lamp", "furniture", "lighting", "glow", ["Shade", "Base"], ["#efe6d2", "#4a4f55"],
    sz([0.12, 1.0, 0.45], [0.12, 1.0, 0.45], [0.2, 2.2, 1.6]), [
      choice("style", "Style", ["floor", "table"], "floor", { sizes: {
        floor: { width_m: 0.45, depth_m: 0.45, height_m: 1.6 }, table: { width_m: 0.32, depth_m: 0.32, height_m: 0.55 } } }),
      choice("shade", "Shade", ["drum", "cone", "globe"], "drum"),
      choice("base", "Base", ["round", "square", "tripod"], "round"),
    ]),
  rug: kind("Rug", "furniture", "decor", null, ["Main", "Border"], ["#a85d4a", "#e8dcc6"],
    sz([0.4, 5.0, 2.0], [0.4, 5.0, 1.4], [0.004, 0.05, 0.012]), [
      choice("shape", "Shape", ["rectangle", "round"], "rectangle", { sizes: { round: { width_m: 1.6, depth_m: 1.6 } } }),
      choice("pattern", "Pattern", ["plain", "border", "stripes"], "border"),
      bool("fringe", "Fringe", false),
    ]),
  shelf: kind("Shelf", "furniture", "storage", null, ["Wood", "Books"], ["#c9b79c", "#8a4f3c"],
    sz([0.3, 3.0, 0.9], [0.15, 0.6, 0.32], [0.2, 2.5, 1.8]), [
      choice("style", "Style", ["bookcase", "open", "wall"], "bookcase"),
      int("shelves", "Shelves", 1, 8, 5),
      choice("books", "Books", ["none", "some", "full"], "some"),
      bool("back", "Back panel", true),
    ]),
  wardrobe: kind("Wardrobe", "furniture", "storage", null, ["Body", "Doors"], ["#e8e2d6", "#d8d0c0"],
    sz([0.4, 3.6, 1.2], [0.4, 0.8, 0.6], [1.0, 2.6, 2.0]), [
      choice("style", "Doors", ["hinged", "sliding"], "hinged"),
      int("doors", "Number of doors", 1, 4, 2),
      int("drawers", "Drawers below", 0, 3, 0),
      choice("handles", "Handles", ["bar", "knob", "none"], "bar"),
      bool("mirror", "Mirror", false),
    ]),
  plant: kind("Plant", "furniture", "decor", null, ["Leaves", "Pot"], ["#4f7a3a", "#b5653d"],
    sz([0.12, 2.0, 0.5], [0.12, 2.0, 0.5], [0.15, 3.0, 0.9]), [
      choice("style", "Plant", ["bush", "tree", "palm", "cactus"], "bush", { sizes: {
        bush: { height_m: 0.8 }, tree: { height_m: 1.6 }, palm: { height_m: 1.5 }, cactus: { height_m: 0.7 } } }),
      choice("pot", "Pot", ["round", "square", "none"], "round"),
    ]),
  washer: kind("Washer", "device", "appliance", "run", ["Body", "Trim"], ["#f2f2f0", "#9aa5ad"],
    sz([0.45, 0.8, 0.6], [0.4, 0.85, 0.62], [0.6, 1.1, 0.85]), [
      choice("loading", "Loading", ["front", "top"], "front"),
    ]),
  dryer: kind("Dryer", "device", "appliance", "run", ["Body", "Trim"], ["#f2f2f0", "#9aa5ad"],
    sz([0.45, 0.8, 0.6], [0.4, 0.85, 0.62], [0.6, 1.1, 0.85]), [
      choice("door", "Door", ["glass", "solid"], "glass"),
    ]),
  vacuum_dock: kind("Robot vacuum dock", "device", "appliance", "dock", ["Dock", "Robot"], ["#2b2d31", "#e9e9e6"],
    sz([0.2, 0.6, 0.38], [0.3, 0.9, 0.55], [0.06, 0.6, 0.12]), [
      choice("dock", "Dock", ["small", "tower"], "small", { sizes: { small: { height_m: 0.12 }, tower: { height_m: 0.45 } } }),
      choice("robot", "Robot", ["round", "d-shape"], "round"),
    ]),
  mower_dock: kind("Mower dock", "device", "outdoor", "dock", ["Dock", "Mower"], ["#3a3d40", "#e2611a"],
    sz([0.4, 1.2, 0.65], [0.6, 1.6, 1.0], [0.2, 1.0, 0.35]), [
      bool("roof", "Roof", false, { sizes: { true: { height_m: 0.6 }, false: { height_m: 0.35 } } }),
    ]),
  car: kind("Car", "device", "outdoor", "charge", ["Body", "Windows"], ["#8a1f1f", "#2a3540"],
    sz([1.5, 2.2, 1.85], [3.2, 6.2, 4.7], [1.2, 2.1, 1.45]), [
      choice("body", "Body", ["sedan", "hatch", "suv", "pickup"], "sedan", { sizes: {
        sedan: { width_m: 1.85, depth_m: 4.7, height_m: 1.45 }, hatch: { width_m: 1.78, depth_m: 4.1, height_m: 1.48 },
        suv: { width_m: 1.92, depth_m: 4.75, height_m: 1.72 }, pickup: { width_m: 2.0, depth_m: 5.6, height_m: 1.9 } } }),
    ]),
  charger: kind("Car charger", "device", "outdoor", "charge", ["Body", "Cable"], ["#e8eaec", "#222426"],
    sz([0.15, 0.5, 0.25], [0.08, 0.5, 0.15], [0.2, 1.6, 0.4]), [
      choice("mount", "Mount", ["wall", "post"], "wall", { sizes: { wall: { depth_m: 0.15, height_m: 0.4 }, post: { depth_m: 0.3, height_m: 1.3 } } }),
      bool("cable", "Cable", true),
    ]),
  radiator: kind("Radiator", "device", "appliance", "warm", ["Colour"], ["#f0f0ee"],
    sz([0.3, 2.4, 0.8], [0.04, 0.3, 0.1], [0.15, 1.8, 0.6]), [
      choice("style", "Style", ["panel", "column"], "panel"),
    ]),
  fan: kind("Fan", "device", "appliance", "spin", ["Body", "Blades"], ["#e8e8e6", "#cfd6dc"],
    sz([0.2, 1.6, 0.45], [0.15, 1.6, 0.35], [0.2, 1.6, 1.25]), [
      choice("style", "Style", ["pedestal", "desk", "ceiling"], "pedestal", { sizes: {
        pedestal: { width_m: 0.45, depth_m: 0.35, height_m: 1.25 }, desk: { width_m: 0.3, depth_m: 0.22, height_m: 0.4 },
        ceiling: { width_m: 1.3, depth_m: 1.3, height_m: 0.45 } } }),
      int("blades", "Blades", 3, 6, 5),
    ]),
  speaker: kind("Speaker", "device", "media", "run", ["Body", "Grille"], ["#2a2a2c", "#3a3a3d"],
    sz([0.08, 1.4, 0.2], [0.08, 0.5, 0.25], [0.05, 1.3, 0.32]), [
      choice("style", "Style", ["bookshelf", "floor", "smart", "soundbar"], "bookshelf", { sizes: {
        bookshelf: { width_m: 0.2, depth_m: 0.25, height_m: 0.32 }, floor: { width_m: 0.25, depth_m: 0.32, height_m: 1.05 },
        smart: { width_m: 0.12, depth_m: 0.12, height_m: 0.18 }, soundbar: { width_m: 0.95, depth_m: 0.1, height_m: 0.07 } } }),
    ]),
  other: kind("Box", "furniture", "other", null, ["Colour"], [BOX_COLOR], BOX_SIZE, []),
};

// The Build menu, in order. Tags and scanners (groups "tag" and "scanner")
// are in FURNITURE for the beacon screen, not here.
export const FURNITURE_KINDS = ["sofa", "bed", "table", "chair", "desk", "dresser", "tv", "lamp", "rug", "shelf", "wardrobe", "plant",
                                "washer", "dryer", "vacuum_dock", "mower_dock", "car", "charger", "radiator", "fan", "speaker", "other"];

const defOf = (k) => (typeof k === "string" && Object.prototype.hasOwnProperty.call(FURNITURE, k) ? FURNITURE[k] : null);

// ── recipes ──────────────────────────────────────────────────────────────────
function clampParam(s, v){
  if (s.type === "choice") {
    if (s.choices.includes(v)) return v;
    const t = typeof v === "string" ? v.trim().toLowerCase() : null;
    return t !== null && s.choices.includes(t) ? t : s.def;
  }
  if (s.type === "bool") {
    if (v === true || v === false) return v;
    if (v === "true" || v === 1 || v === "1") return true;
    if (v === "false" || v === 0 || v === "0") return false;
    return s.def;
  }
  const n = toNum(v);
  if (!Number.isFinite(n)) return s.def;
  const c = clamp(n, s.min, s.max);
  return s.type === "int" ? Math.round(c) : c;
}
function clampSize(v, range){
  const n = toNum(v);
  return Number.isFinite(n) ? clamp(n, range[0], range[1]) : range[2];
}
function clampColors(want, v){
  const src = Array.isArray(v) ? v : [];
  const out = want.map((c, i) => hexOf(src[i]) || c);
  for (let i = want.length; i < src.length; i++) { const c = hexOf(src[i]); if (c) out.push(c); }
  if (!out.length) out.push(BOX_COLOR);
  return out;
}

export function defaultRecipe(kind){
  const def = defOf(kind);
  if (!def) return clampRecipe({ kind });
  const params = {};
  for (const s of def.params) params[s.key] = s.def;
  return { kind, params, colors: def.colors.slice(), width_m: def.size.width_m[2], depth_m: def.size.depth_m[2],
           height_m: def.size.height_m[2] };
}

export function clampRecipe(recipe){
  const src = isObj(recipe) ? recipe : {};
  const out = plain(src);
  const raw = typeof src.kind === "string" && src.kind.trim() ? src.kind.trim() : "other";
  const def = defOf(raw.toLowerCase());
  out.kind = def ? raw.toLowerCase() : raw;
  const given = isObj(src.params) ? src.params : {};
  const params = plain(given);
  if (def) for (const s of def.params) params[s.key] = clampParam(s, given[s.key]);
  out.params = params;
  out.colors = clampColors(def ? def.colors : [], src.colors);
  const size = def ? def.size : BOX_SIZE;
  for (const k of DIMS) out[k] = clampSize(src[k], size[k]);
  return out;
}

export function pieceSize(recipe){
  const r = clampRecipe(recipe);
  return { w: r.width_m, d: r.depth_m, h: r.height_m };
}

// ── geometry: PadSpan's own rounded box, placing and merging ─────────────────
// Each face of the box: its normal axis and sign, then the two in-plane axes
// (axis, sign) with u × v = the normal, so every quad winds outward.
const FACES = [
  [0, 1, 2, -1, 1, 1], [0, -1, 2, 1, 1, 1], [1, 1, 0, 1, 2, -1],
  [1, -1, 0, 1, 2, 1], [2, 1, 0, 1, 1, 1], [2, -1, 0, -1, 1, 1],
];
// The grid lines along one axis: flat in the middle, and m steps on each
// rounded edge spaced so the steps turn by equal angles once rounded.
function gridLines(half, r, m){
  if (!(r > 0) || m === 0) return [-half, half];
  const inner = half - r, out = [];
  for (let k = m; k >= 1; k--) out.push(-inner - r * Math.tan(k * Math.PI / 4 / m));
  out.push(-inner);
  if (inner > 1e-6) out.push(inner);
  for (let k = 1; k <= m; k++) out.push(inner + r * Math.tan(k * Math.PI / 4 / m));
  return out;
}
// A box w × h × d centred on the origin with its edges rounded to r in m
// steps a half-arc (m = 0: sharp). UVs are metres along each face's longer
// side, so a wood grain runs along a board whatever its size.
function boxGeo(THREE, w, h, d, r, m){
  const half = [w / 2, h / 2, d / 2];
  r = m > 0 ? Math.min(r, half[0], half[1], half[2]) : 0;
  if (r < 1e-4) { r = 0; m = 0; }
  const inner = half.map((v) => v - r);
  const lines = half.map((v) => gridLines(v, r, m));
  const pos = [], nor = [], uv = [], idx = [];
  const p = [0, 0, 0], q = [0, 0, 0];
  for (const [na, ns, ua, us, va, vs] of FACES) {
    const lu = lines[ua], lv = lines[va], base = pos.length / 3;
    const swap = half[ua] < half[va];
    for (let j = 0; j < lv.length; j++) {
      for (let i = 0; i < lu.length; i++) {
        p[na] = ns * half[na]; p[ua] = us * lu[i]; p[va] = vs * lv[j];
        if (r > 0) {
          for (let k = 0; k < 3; k++) q[k] = clamp(p[k], -inner[k], inner[k]);
          const dx = p[0] - q[0], dy = p[1] - q[1], dz = p[2] - q[2], len = Math.hypot(dx, dy, dz) || 1;
          pos.push(q[0] + dx / len * r, q[1] + dy / len * r, q[2] + dz / len * r);
          nor.push(dx / len, dy / len, dz / len);
        } else {
          pos.push(p[0], p[1], p[2]);
          nor.push(na === 0 ? ns : 0, na === 1 ? ns : 0, na === 2 ? ns : 0);
        }
        const a = lu[i] / TILE, b = lv[j] / TILE;
        uv.push(swap ? b : a, swap ? a : b);
      }
    }
    const nu = lu.length;
    for (let j = 0; j < lv.length - 1; j++) {
      for (let i = 0; i < nu - 1; i++) {
        const a = base + j * nu + i, b = a + 1, c = a + nu + 1, e = a + nu;
        idx.push(a, b, c, a, c, e);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}
function scaleUv(g, su, sv){
  const a = g.attributes.uv;
  for (let i = 0; i < a.count; i++) a.setXY(i, a.getX(i) * su, a.getY(i) * sv);
  return g;
}
function place(THREE, g, x, y, z, rot, scl){
  const m = new THREE.Matrix4();
  const quat = new THREE.Quaternion();
  if (rot && rot.isQuaternion) quat.copy(rot);
  else if (rot) quat.setFromEuler(new THREE.Euler(rot[0] || 0, rot[1] || 0, rot[2] || 0));
  m.compose(new THREE.Vector3(x, y, z), quat, scl ? new THREE.Vector3(scl[0], scl[1], scl[2]) : new THREE.Vector3(1, 1, 1));
  g.applyMatrix4(m);
  return g;
}
// A plan shape's outline: a rectangle with rounded corners, counter-clockwise.
function roundRect(shape, w, d, r){
  const x0 = -w / 2, x1 = w / 2, y0 = -d / 2, y1 = d / 2;
  if (r < 1e-4) { shape.moveTo(x0, y0); shape.lineTo(x1, y0); shape.lineTo(x1, y1); shape.lineTo(x0, y1); shape.lineTo(x0, y0); return; }
  shape.moveTo(x0 + r, y0); shape.lineTo(x1 - r, y0); shape.absarc(x1 - r, y0 + r, r, -Math.PI / 2, 0, false);
  shape.lineTo(x1, y1 - r); shape.absarc(x1 - r, y1 - r, r, 0, Math.PI / 2, false);
  shape.lineTo(x0 + r, y1); shape.absarc(x0 + r, y1 - r, r, Math.PI / 2, Math.PI, false);
  shape.lineTo(x0, y0 + r); shape.absarc(x0 + r, y0 + r, r, Math.PI, Math.PI * 1.5, false);
}
// Scaled and moved so its bounds are exactly w × h × d about the origin.
function fitBox(g, w, h, d){
  g.computeBoundingBox();
  const b = g.boundingBox, sx = b.max.x - b.min.x, sy = b.max.y - b.min.y, sz = b.max.z - b.min.z;
  g.translate(-(b.min.x + b.max.x) / 2, -(b.min.y + b.max.y) / 2, -(b.min.z + b.max.z) / 2);
  g.scale(w / (sx || 1), h / (sy || 1), d / (sz || 1));
  return g;
}
// One geometry from many, each already placed (position, normal, uv).
function merge(THREE, geos){
  let nv = 0, ni = 0;
  for (const g of geos) { nv += g.attributes.position.count; ni += g.index ? g.index.count : g.attributes.position.count; }
  const pos = new Float32Array(nv * 3), nor = new Float32Array(nv * 3), uv = new Float32Array(nv * 2);
  const idx = nv > 65535 ? new Uint32Array(ni) : new Uint16Array(ni);
  let vo = 0, io = 0;
  for (const g of geos) {
    const n = g.attributes.position.count;
    pos.set(g.attributes.position.array, vo * 3);
    nor.set(g.attributes.normal.array, vo * 3);
    uv.set(g.attributes.uv.array, vo * 2);
    if (g.index) { const a = g.index.array; for (let i = 0; i < a.length; i++) idx[io++] = a[i] + vo; }
    else for (let i = 0; i < n; i++) idx[io++] = vo + i;
    vo += n;
    g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  out.setAttribute("normal", new THREE.BufferAttribute(nor, 3));
  out.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  out.computeBoundingBox();
  out.computeBoundingSphere();
  return out;
}

// ── looks: shared, counted materials and finishes ────────────────────────────
// A look is {c: "#rrggbb", f: finish}. Low draws flat colours; High a
// physically based material with the finish's pattern as a small greyscale
// texture made here, tinted by the colour.
const FINISH = {
  plain:  { r: 0.85, m: 0 },
  wood:   { r: 0.6, m: 0, tex: "wood" },
  fabric: { r: 0.97, m: 0, tex: "fabric" },
  metal:  { r: 0.36, m: 0.55, tex: "metal" },
  gloss:  { r: 0.22, m: 0 },
  soft:   { r: 0.75, m: 0 },
};
const CACHES = new WeakMap();           // per three.js instance: {mats, texs}
function cacheOf(THREE){
  let c = CACHES.get(THREE);
  if (!c) CACHES.set(THREE, c = { mats: new Map(), texs: new Map() });
  return c;
}
function release(e){
  if (--e.refs > 0) return;
  e.cache.delete(e.key);
  e.res.dispose();
  if (e.dep) release(e.dep);
}
// A small hash and periodic value noise: a pattern that tiles seamlessly.
function hash2(i, j, seed){ const s = Math.sin(i * 127.1 + j * 311.7 + seed * 74.7) * 43758.5453; return s - Math.floor(s); }
function noise(x, y, period, seed){
  const xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi;
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  const at = (i, j) => hash2(((i % period) + period) % period, ((j % period) + period) % period, seed);
  const a = at(xi, yi), b = at(xi + 1, yi), c = at(xi, yi + 1), d = at(xi + 1, yi + 1);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}
function finishTexture(THREE, name){
  const N = 64, data = new Uint8Array(N * N * 4);
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const u = x / N, v = y / N;
      let t;
      if (name === "wood") {
        // Grain lines along u, wavering, with a few darker rings.
        const ring = v * 7 + 0.9 * noise(u * 4, v * 4, 4, 1) + 0.15 * noise(u * 16, v * 2, 16, 2);
        const band = Math.pow(0.5 + 0.5 * Math.cos(2 * Math.PI * ring), 3);
        t = 0.8 + 0.12 * (1 - band) + 0.08 * noise(u * 32, v * 8, 32, 3);
      } else if (name === "fabric") {
        // A fine weave over a soft mottle.
        const wx = 0.5 + 0.5 * Math.sin(2 * Math.PI * u * 32), wy = 0.5 + 0.5 * Math.sin(2 * Math.PI * v * 32);
        t = 0.84 + 0.07 * ((x + y) % 2 ? wx : wy) + 0.09 * noise(u * 8, v * 8, 8, 4);
      } else {
        // Brushed metal: thin streaks along u.
        t = 0.8 + 0.14 * noise(u * 2, v * 64, 64, 5) + 0.06 * noise(u * 8, v * 16, 16, 6);
      }
      const g = Math.round(255 * clamp(t, 0, 1)), i = (y * N + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = g; data[i + 3] = 255;
    }
  }
  const tex = new THREE.DataTexture(data, N, N, THREE.RGBAFormat);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
}
function sharedTex(THREE, name){
  const C = cacheOf(THREE);
  let e = C.texs.get(name);
  if (!e) C.texs.set(name, e = { key: name, cache: C.texs, res: finishTexture(THREE, name), refs: 0, dep: null });
  e.refs++;
  return e;
}
function sharedMat(THREE, hi, look, held){
  const C = cacheOf(THREE), f = FINISH[look.f] ? look.f : "plain", F = FINISH[f];
  const key = (hi ? "h|" : "l|") + look.c + "|" + f;
  let e = C.mats.get(key);
  if (!e) {
    const dep = hi && F.tex ? sharedTex(THREE, F.tex) : null;
    const res = hi ? new THREE.MeshStandardMaterial({ color: look.c, roughness: F.r, metalness: F.m, map: dep ? dep.res : null })
      : new THREE.MeshLambertMaterial({ color: look.c });
    C.mats.set(key, e = { key, cache: C.mats, res, refs: 0, dep });
  }
  if (!held.has(e)) { held.add(e); e.refs++; }
  return e.res;
}
// A live part's own material: never shared, freed with its piece. Both kinds
// carry an emissive colour, so a glow or a warm screen is one number.
function ownMat(THREE, hi, look){
  const F = FINISH[look.f] || FINISH.plain;
  const m = hi ? new THREE.MeshStandardMaterial({ color: look.c, roughness: F.r, metalness: F.m, emissive: 0x000000 })
    : new THREE.MeshLambertMaterial({ color: look.c, emissive: 0x000000 });
  m.userData.ownPart = true;
  return m;
}

// ── the kit a builder draws with ─────────────────────────────────────────────
// Every primitive is placed in its target's frame and collected by look; at
// the end each look becomes one mesh. kit.at(obj) draws into a moving part
// (a fan's blades, a robot), kit.own(look, fn) makes one mesh with a
// material of its own (a live part).
function stepsFor(r, hi){ return r < 0.006 ? 0 : hi ? (r >= 0.03 ? 2 : 1) : (r >= 0.03 ? 1 : 0); }
function makeKit(THREE, quality, root){
  const hi = quality === "high";
  const sinks = new Map(), owns = [], held = new Set(), geos = [];
  const push = (target, look, g) => {
    const key = target.id + "|" + look.c + "|" + (look.f || "plain");
    let s = sinks.get(key);
    if (!s) sinks.set(key, s = { target, look, geos: [] });
    s.geos.push(g);
  };
  const api = (target, add) => ({
    hi,
    box(w, h, d, x, y, z, look, r = 0, rot = null){
      add(look, place(THREE, boxGeo(THREE, w, h, d, r, stepsFor(r, hi)), x, y, z, rot));
    },
    cyl(rt, rb, h, x, y, z, look, seg = 12, rot = null){
      const n = Math.max(5, Math.round(hi ? seg : seg * 0.6));
      const g = scaleUv(new THREE.CylinderGeometry(rt, rb, h, n, 1, false), 2 * Math.PI * Math.max(rt, rb) / TILE, h / TILE);
      g.clearGroups();
      add(look, place(THREE, g, x, y, z, rot));
    },
    ball(rad, x, y, z, look, scl = null, rot = null, seg = 14, cap = Math.PI){
      const ws = Math.max(6, Math.round(hi ? seg : seg * 0.6)), hs = Math.max(4, Math.round(ws * 0.7));
      const g = scaleUv(new THREE.SphereGeometry(rad, ws, hs, 0, Math.PI * 2, 0, cap), 2 * Math.PI * rad / TILE, Math.PI * rad / TILE);
      add(look, place(THREE, g, x, y, z, rot, scl));
    },
    // A flat plan shape (a "rect" with rounded corners, or an "ellipse") w × d,
    // t thick, its bottom at y, its edges softened by a small bevel.
    slab(form, w, t, d, x, y, z, look, corner = 0.01, bevel = 0.006){
      const shape = new THREE.Shape();
      if (form === "ellipse") shape.absellipse(0, 0, w / 2, d / 2, 0, Math.PI * 2, false, 0);
      else roundRect(shape, w, d, Math.min(corner, w / 2 - 1e-3, d / 2 - 1e-3));
      const bt = Math.min(bevel, t / 3, w / 4, d / 4);
      const g = new THREE.ExtrudeGeometry(shape, { depth: Math.max(t - 2 * bt, 1e-4), bevelEnabled: bt > 1e-4, bevelThickness: bt,
        bevelSize: bt, bevelSegments: 1, curveSegments: form === "ellipse" ? (hi ? 16 : 8) : (hi ? 4 : 2) });
      g.rotateX(-Math.PI / 2);
      g.clearGroups();
      add(look, place(THREE, scaleUv(fitBox(g, w, t, d), 1 / TILE, 1 / TILE), x, y + t / 2, z));
    },
    // A round bar of radius r from point a to point b.
    rod(a, b, r, look, seg = 8){
      const v = new THREE.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]), len = v.length();
      const n = Math.max(5, Math.round(hi ? seg : seg * 0.6));
      const g = scaleUv(new THREE.CylinderGeometry(r, r, len, n, 1, false), 2 * Math.PI * r / TILE, len / TILE);
      g.clearGroups();
      const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), v.normalize());
      add(look, place(THREE, g, (a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2, q));
    },
    // A ring of radius rad around its own z axis, its tube tube thick.
    torus(rad, tube, x, y, z, look, rot = null){
      const g = scaleUv(new THREE.TorusGeometry(rad, tube, hi ? 10 : 6, hi ? 32 : 16), 2 * Math.PI * tube / TILE, 2 * Math.PI * rad / TILE);
      add(look, place(THREE, g, x, y, z, rot));
    },
    // A part of its own (one that moves, or a stretch): a group under this one.
    child(pos = null, scl = null, rot = null){
      const obj = new THREE.Group();
      if (pos) obj.position.set(pos[0], pos[1], pos[2]);
      if (scl) obj.scale.set(scl[0], scl[1], scl[2]);
      if (rot) obj.rotation.set(rot[0], rot[1], rot[2]);
      target.add(obj);
      const k = api(obj, (look, g) => push(obj, look, g));
      k.obj = obj;
      return k;
    },
    at(obj){ return api(obj, (look, g) => push(obj, look, g)); },
    own(look, fn, parent = target){
      const list = [];
      fn(api(parent, (_l, g) => list.push(g)));
      const mesh = new THREE.Mesh(merge(THREE, list), ownMat(THREE, hi, look));
      mesh.castShadow = mesh.receiveShadow = true;
      parent.add(mesh);
      owns.push(mesh);
      return mesh;
    },
  });
  const kit = api(root, (look, g) => push(root, look, g));
  kit.finish = () => {
    for (const s of sinks.values()) {
      const mesh = new THREE.Mesh(merge(THREE, s.geos), sharedMat(THREE, hi, s.look, held));
      mesh.castShadow = mesh.receiveShadow = true;
      s.target.add(mesh);
      geos.push(mesh.geometry);
    }
    for (const m of owns) geos.push(m.geometry);
    return { held: [...held], geos, own: owns.map((m) => m.material), done: false };
  };
  return kit;
}

// ── the builders ─────────────────────────────────────────────────────────────
// Each draws one clamped recipe inside its box S = {w, d, h}: p its params,
// C its colours, parts the live parts it fills in.
const L = (c, f = "plain") => ({ c, f });
const LEG_WOOD = "#5e4431", LEG_DARK = "#2f2621", METAL = "#b9bec3";

function buildBox(K, S, p, C){
  K.box(S.w, S.h, S.d, 0, S.h / 2, 0, L(C[0]), Math.min(0.015, S.w / 4, S.d / 4, S.h / 4));
}

// Sofa: seats across the width between its arms, the back at −z.
function buildSofa(K, S, p, C){
  const { w: W, d: D, h: H } = S;
  const body = L(C[0], "fabric"), cush = L(C[1], "fabric");
  const armW = Math.min({ none: 0, slim: 0.1, wide: 0.22, rolled: 0.16 }[p.arms], W * 0.18);
  const legH = p.legs === "none" ? 0 : Math.min({ block: 0.07, tapered: 0.13, metal: 0.14 }[p.legs], H * 0.2);
  const backT = clamp(D * 0.22, 0.12, 0.26), seatD = D - backT;
  const cushT = clamp(H * 0.15, 0.08, 0.14);
  const baseTop = Math.max(Math.min(p.seat_h_m, H - 0.12) - cushT, legH + 0.05), seatTop = baseTop + cushT;
  const innerW = W - 2 * armW;
  K.box(W, baseTop - legH, D, 0, legH + (baseTop - legH) / 2, 0, body, 0.03);
  K.box(armW ? innerW + 0.02 : W, H - baseTop, backT, 0, baseTop + (H - baseTop) / 2, -D / 2 + backT / 2, body, 0.045);
  const cw = innerW / p.seats;
  for (let i = 0; i < p.seats; i++) {
    K.box(cw - 0.014, cushT, seatD - 0.01, -innerW / 2 + cw * (i + 0.5), baseTop + cushT / 2, backT / 2, cush, Math.min(0.05, cushT / 2));
  }
  const bh = Math.min(H - seatTop - 0.04, 0.55);
  if (p.cushions > 0 && bh > 0.1) {
    const bw = innerW / p.cushions;
    for (let i = 0; i < p.cushions; i++) {
      K.box(bw - 0.024, bh, 0.13, -innerW / 2 + bw * (i + 0.5), seatTop + bh / 2, -D / 2 + backT + 0.068, cush, 0.055, [-0.1, 0, 0]);
    }
  }
  if (armW) {
    const armTop = Math.min(seatTop + 0.2, H - 0.02);
    for (const s of [-1, 1]) {
      const ax = s * (W / 2 - armW / 2);
      if (p.arms === "rolled") {
        const rr = Math.min(armW * 0.62, (armTop - legH) / 2);
        K.box(armW, armTop - rr - legH, D, ax, legH + (armTop - rr - legH) / 2, 0, body, 0.03);
        K.cyl(rr, rr, D, s * (W / 2 - rr), armTop - rr, 0, body, 20, [Math.PI / 2, 0, 0]);
      } else {
        K.box(armW, armTop - legH, D, ax, legH + (armTop - legH) / 2, 0, body, p.arms === "wide" ? 0.07 : 0.035);
      }
    }
  }
  if (legH) {
    const lx = W / 2 - 0.06, lz = D / 2 - 0.06;
    for (const sx of [-1, 1]) for (const sz2 of [-1, 1]) {
      if (p.legs === "block") K.box(0.07, legH, 0.07, sx * lx, legH / 2, sz2 * lz, L(LEG_DARK, "wood"));
      else if (p.legs === "tapered") K.cyl(0.025, 0.013, legH, sx * lx, legH / 2, sz2 * lz, L(LEG_WOOD, "wood"), 10);
      else K.cyl(0.011, 0.011, legH, sx * lx, legH / 2, sz2 * lz, L(METAL, "metal"), 8);
    }
  }
}

// Bed: the head at −z (pillows and headboard), the foot toward +z.
function bedding(K, x, zc, mw, ml, base, mattH, C, pillows){
  const top = base + mattH;
  K.box(mw, mattH, ml, x, base + mattH / 2, zc, L("#efece4", "fabric"), Math.min(0.05, mattH / 2));
  const duvL = ml * 0.72, drape = Math.min(0.17, mattH * 0.8);
  K.box(mw + 0.05, drape + 0.04, duvL, x, top + 0.04 - (drape + 0.04) / 2, zc + ml / 2 - duvL / 2 + 0.02, L(C[1], "fabric"), 0.03);
  K.box(mw + 0.055, 0.045, 0.2, x, top + 0.025, zc + ml / 2 - duvL + 0.12, L(lighten(C[1], 0.35), "fabric"), 0.02);
  if (!pillows) return;
  const pw = (mw - 0.12) / pillows - 0.03;
  for (let i = 0; i < pillows; i++) {
    K.box(pw, 0.12, 0.4, x - mw / 2 + 0.06 + (pw + 0.03) * (i + 0.5) + 0.015 * (pillows - 1), top + 0.055, zc - ml / 2 + 0.27,
          L(lighten(C[1], 0.55), "fabric"), 0.055);
  }
}
function buildBed(K, S, p, C){
  if (p.size === "crib") return buildCrib(K, S, p, C);
  if (p.size === "bunk") return buildBunk(K, S, p, C);
  const { w: W, d: D, h: H } = S;
  const frame = L(C[0], "wood");
  const hbD = Math.min({ none: 0, panel: 0.05, slatted: 0.06, padded: 0.1 }[p.headboard], D * 0.08);
  const fbD = p.footboard ? 0.05 : 0;
  const zb = -D / 2 + hbD, zf = D / 2 - fbD, Lz = zf - zb, zc = (zb + zf) / 2;
  const rim = clamp(W * 0.04, 0.03, 0.06), mw = W - 2 * rim, ml = Lz - 2 * rim;
  // The mattress top at its usual height under a headboard (which takes the
  // rest of the Height); with none, the bed itself is the Height.
  const platform = p.base === "platform", usual = platform ? 0.5 : 0.56;
  const mattTop = p.headboard === "none" ? H - 0.12 : Math.min(usual, H - 0.12);
  const mattH = 0.22 * Math.min(1, mattTop / usual), baseTop = mattTop - mattH;
  if (platform) {
    const toe = Math.min(0.08, baseTop * 0.3);
    K.box(W, baseTop - toe, Lz, 0, toe + (baseTop - toe) / 2, zc, frame, 0.02);
    K.box(W - 0.2, toe, Lz - 0.2, 0, toe / 2, zc, L("#26211d"));
  } else {
    const railH = Math.min(0.16, baseTop * 0.5), legH = baseTop - railH;
    K.box(W, railH, Lz, 0, legH + railH / 2, zc, frame, 0.015);
    for (const sx of [-1, 1]) for (const sz2 of [-1, 1]) K.box(0.07, legH, 0.07, sx * (W / 2 - 0.05), legH / 2, zc + sz2 * (Lz / 2 - 0.05), frame);
  }
  bedding(K, 0, zc, mw, ml, baseTop, mattH, C, p.size === "twin" ? 1 : 2);
  const zh = -D / 2 + hbD / 2;
  if (p.headboard === "panel") K.box(W, H, hbD, 0, H / 2, zh, frame, 0.015);
  else if (p.headboard === "padded") {
    // Upholstered in channels, on two short feet.
    const n = clamp(Math.round(W / 0.4), 2, 6), cw = W / n, padded = L(lighten(C[0], 0.12), "fabric");
    for (let i = 0; i < n; i++) K.box(cw - 0.006, H - 0.06, hbD, -W / 2 + cw * (i + 0.5), 0.06 + (H - 0.06) / 2, zh, padded, 0.04);
    for (const s of [-1, 1]) K.box(0.05, 0.06, hbD * 0.6, s * (W / 2 - 0.08), 0.03, zh, L(LEG_DARK, "wood"));
  } else if (p.headboard === "slatted") {
    for (const s of [-1, 1]) K.box(0.06, H, hbD, s * (W / 2 - 0.03), H / 2, zh, frame, 0.01);
    K.box(W, 0.06, hbD, 0, H - 0.03, zh, frame, 0.01);
    const ns = Math.max(3, Math.round(W / 0.17)), top = H - 0.06, sh = top - baseTop;
    if (sh > 0.05) for (let i = 0; i < ns; i++) K.box(0.045, sh, hbD * 0.5, -(W - 0.12) / 2 + (W - 0.12) * (i + 0.5) / ns, baseTop + sh / 2, zh, frame);
  }
  if (p.footboard) { const fh = Math.min(mattTop + 0.12, H); K.box(W, fh, fbD, 0, fh / 2, D / 2 - fbD / 2, frame, 0.015); }
}
// A crib: bars all round, a low mattress, no pillow.
function buildCrib(K, S, p, C){
  const { w: W, d: D, h: H } = S;
  const frame = L(C[0], "wood"), post = 0.05;
  for (const sx of [-1, 1]) for (const sz2 of [-1, 1]) K.box(post, H, post, sx * (W / 2 - post / 2), H / 2, sz2 * (D / 2 - post / 2), frame, 0.008);
  const baseTop = clamp(H * 0.32, 0.12, 0.42), mattH = Math.min(0.1, baseTop * 0.5);
  K.box(W - 0.06, 0.04, D - 0.06, 0, baseTop - 0.02, 0, frame);
  bedding(K, 0, 0, W - 0.12, D - 0.12, baseTop, mattH, C, 0);
  const lo = baseTop - 0.04, hi = H - 0.04, barH = hi - lo;
  for (const sz2 of [-1, 1]) {
    K.box(W - 2 * post, 0.04, 0.035, 0, H - 0.02, sz2 * (D / 2 - post / 2), frame, 0.008);
    K.box(W - 2 * post, 0.04, 0.035, 0, lo, sz2 * (D / 2 - post / 2), frame);
    const n = clamp(Math.round((W - 2 * post) / 0.09), 3, 16);
    for (let i = 0; i < n; i++) K.box(0.022, barH, 0.022, -(W / 2 - post) + (W - 2 * post) * (i + 0.5) / n, lo + barH / 2, sz2 * (D / 2 - post / 2), frame);
  }
  for (const sx of [-1, 1]) {
    K.box(0.035, 0.04, D - 2 * post, sx * (W / 2 - post / 2), H - 0.02, 0, frame, 0.008);
    K.box(0.035, 0.04, D - 2 * post, sx * (W / 2 - post / 2), lo, 0, frame);
    const n = clamp(Math.round((D - 2 * post) / 0.09), 3, 16);
    for (let i = 0; i < n; i++) K.box(0.022, barH, 0.022, sx * (W / 2 - post / 2), lo + barH / 2, -(D / 2 - post) + (D - 2 * post) * (i + 0.5) / n, frame);
  }
}
// A bunk bed: two beds on four posts, the ladder up the right side at the foot.
function buildBunk(K, S, p, C){
  const { w: W, d: D, h: H } = S;
  const frame = L(C[0], "wood"), post = 0.07;
  for (const sx of [-1, 1]) for (const sz2 of [-1, 1]) K.box(post, H, post, sx * (W / 2 - post / 2), H / 2, sz2 * (D / 2 - post / 2), frame, 0.01);
  const mattH = Math.min(0.16, H * 0.1), railH = Math.min(0.1, H * 0.08);
  const lowBase = clamp(H * 0.18, railH, 0.3);
  const upTop = H - Math.max(0.12, Math.min(0.28, H * 0.18)), upBase = Math.max(upTop - mattH, lowBase);
  const ml = D - 2 * post - 0.06, mw = W - 2 * post - 0.02;
  for (const base of [lowBase, upBase]) {
    K.box(W - 2 * post, railH, D - 2 * post, 0, base - railH / 2, 0, frame, 0.01);
    bedding(K, 0, -0.02, mw, ml, base, mattH, C, 1);
    const bh = Math.min(0.16, H - base - 0.005);
    for (const sz2 of [-1, 1]) K.box(W - 2 * post, bh, 0.03, 0, base + bh / 2, sz2 * (D / 2 - post / 2), frame, 0.008);
  }
  // The top bunk's guard rails, left open on the right where the ladder comes up.
  const gy = H - 0.03, ladW = Math.min(0.42, (D - 2 * post) * 0.4);
  K.box(0.04, 0.06, D - 2 * post, -(W / 2 - post / 2), gy, 0, frame, 0.01);
  const openL = D - 2 * post - ladW - 0.06;
  if (openL > 0.1) K.box(0.04, 0.06, openL, W / 2 - post / 2, gy, -(D / 2 - post) + openL / 2, frame, 0.01);
  const lx = W / 2 - 0.02, z0 = D / 2 - post - ladW;
  for (const z of [z0 + 0.015, z0 + ladW - 0.015]) K.box(0.03, upTop, 0.03, lx, upTop / 2, z, frame);
  const rungs = Math.max(2, Math.floor((upTop - 0.2) / 0.28));
  for (let i = 1; i <= rungs; i++) K.cyl(0.014, 0.014, ladW - 0.03, lx, i * (upTop / (rungs + 1)), z0 + ladW / 2, L(METAL, "metal"), 8, [Math.PI / 2, 0, 0]);
}

// ── fronts, doors and handles (dressers, desks, wardrobes, units) ───────────
// A handle on a front whose face is at zFace, reaching at most 28 mm out:
// a bar on two posts or a knob (one small block each on Low).
const HANDLE_D = 0.028;
function handle(K, kind, x, y, zFace, along, look, len){
  if (kind === "none") return;
  const up = along === "y";
  if (!K.hi) {
    if (kind === "knob") K.box(0.026, 0.026, HANDLE_D, x, y, zFace + HANDLE_D / 2, look);
    else K.box(up ? 0.016 : len, up ? len : 0.016, HANDLE_D, x, y, zFace + HANDLE_D / 2, look);
    return;
  }
  if (kind === "knob") { K.cyl(0.011, 0.015, HANDLE_D, x, y, zFace + HANDLE_D / 2, look, 10, [Math.PI / 2, 0, 0]); return; }
  K.cyl(0.006, 0.006, len, x, y, zFace + HANDLE_D - 0.006, look, 8, up ? null : [0, 0, Math.PI / 2]);
  for (const s of [-1, 1]) {
    K.cyl(0.004, 0.004, HANDLE_D - 0.006, up ? x : x + s * (len / 2 - 0.012), up ? y + s * (len / 2 - 0.012) : y,
          zFace + (HANDLE_D - 0.006) / 2, look, 6, [Math.PI / 2, 0, 0]);
  }
}
// Fronts stand on a dark backing, so the gaps between them read as lines;
// the carcass behind stops GAP_T short of zFace to make room for it.
const GAP_T = 0.003, GAP = "#1f1b18";
// n drawer fronts stacked from y0 to y1 on a carcass whose face is at zFace.
function drawers(K, x, w, y0, y1, n, zFace, look, kind, hl){
  const rowH = (y1 - y0) / n;
  K.box(w, y1 - y0, GAP_T, x, (y0 + y1) / 2, zFace - GAP_T / 2, L(GAP));
  for (let i = 0; i < n; i++) {
    const cy = y0 + rowH * (i + 0.5);
    K.box(w - 0.006, rowH - 0.006, 0.02, x, cy, zFace + 0.01, look, 0.004);
    handle(K, kind, x, cy, zFace + 0.02, "x", hl, Math.min(0.14, w * 0.45));
  }
}
// A door from y0 to y1, hinged on the left (hinge −1) or the right (+1).
function door(K, x, w, y0, y1, zFace, look, kind, hl, hinge){
  K.box(w, y1 - y0, GAP_T, x, (y0 + y1) / 2, zFace - GAP_T / 2, L(GAP));
  K.box(w - 0.006, y1 - y0 - 0.006, 0.02, x, (y0 + y1) / 2, zFace + 0.01, look, 0.004);
  const hy = Math.min(y0 + (y1 - y0) * 0.55, y0 + 1.05);
  handle(K, kind, x - hinge * (w / 2 - Math.min(0.05, w * 0.2)), hy, zFace + 0.02, "y", hl, Math.min(0.16, (y1 - y0) * 0.3));
}

// Table: a top (rectangle, rounded or round) on four legs, a pedestal or trestles.
function buildTable(K, S, p, C){
  const { w: W, d: D, h: H } = S;
  const top = L(C[0], "wood"), leg = L(C[1], "wood");
  const t = Math.min(p.top_t_m, H * 0.25), under = H - t, round = p.shape === "round";
  K.slab(round ? "ellipse" : "rect", W, t, D, 0, under, 0, top, p.shape === "rounded" ? Math.min(W, D) * 0.25 : 0.01);
  if (p.legs === "pedestal") {
    const two = W > D * 1.8, xs = two ? [-W / 4, W / 4] : [0];
    const footR = Math.min(D * 0.32, (two ? W / 4 : W / 2) * 0.9, 0.35);
    const colR = clamp(Math.min(W, D) * 0.06, 0.03, 0.08);
    for (const x of xs) {
      K.cyl(colR * 0.75, colR, under - 0.035, x, 0.035 + (under - 0.035) / 2, 0, leg, 16);
      K.slab("ellipse", footR * 2, 0.035, footR * 2, x, 0, 0, leg, 0, 0.01);
    }
  } else if (p.legs === "trestle") {
    const tx = W / 2 - Math.min(0.15, W * 0.12);
    for (const s of [-1, 1]) {
      K.box(0.06, under - 0.05, D * 0.5, s * tx, 0.05 + (under - 0.05) / 2, 0, leg, 0.008);
      K.box(0.08, 0.05, D * 0.8, s * tx, 0.025, 0, leg, 0.01);
      K.box(0.07, 0.04, D * 0.7, s * tx, under - 0.02, 0, leg, 0.008);
    }
    K.box(2 * tx, 0.05, 0.05, 0, Math.max(0.08, under * 0.35), 0, leg, 0.008);
  } else {
    const lw = clamp(Math.min(W, D) * 0.05, 0.035, 0.07);
    const fx = round ? W * 0.3 : W / 2 - lw / 2 - 0.03, fz = round ? D * 0.3 : D / 2 - lw / 2 - 0.03;
    for (const sx of [-1, 1]) for (const sz2 of [-1, 1]) K.box(lw, under, lw, sx * fx, under / 2, sz2 * fz, leg, 0.006);
    if (p.apron && under > 0.2) {
      const ah = Math.min(0.08, under * 0.2), ay = under - ah / 2;
      for (const s of [-1, 1]) {
        K.box(2 * fx - lw, ah, 0.02, 0, ay, s * fz, leg);
        K.box(0.02, ah, 2 * fz - lw, s * fx, ay, 0, leg);
      }
    }
  }
}

// Chair: a dining chair, an armchair, an office chair or a stool; the back at −z.
function buildChair(K, S, p, C){
  if (p.style === "armchair") {
    return buildSofa(K, S, { seats: 1, arms: p.arms ? "wide" : "none", seat_h_m: p.seat_h_m, legs: "tapered", cushions: 1 },
                     [C[1], lighten(C[1], 0.15)]);
  }
  const { w: W, d: D, h: H } = S;
  const frame = L(C[0], "wood"), seat = L(C[1], p.cushion ? "fabric" : "wood");
  if (p.style === "office") return buildOfficeChair(K, S, p, C);
  const stool = p.style === "stool";
  const seatTop = stool ? H : Math.min(p.seat_h_m, H - 0.12);
  const seatT = p.cushion ? 0.06 : 0.035, legTop = seatTop - seatT;
  const lw = clamp(Math.min(W, D) * 0.08, 0.03, 0.05);
  if (stool) {
    K.slab("ellipse", W, seatT, D, 0, legTop, 0, seat, 0, p.cushion ? 0.02 : 0.008);
    const fx = W * 0.3, fz = D * 0.3, ry = Math.max(0.05, legTop * 0.35);
    for (const sx of [-1, 1]) for (const sz2 of [-1, 1]) K.box(lw, legTop, lw, sx * fx, legTop / 2, sz2 * fz, frame, 0.005);
    for (const s of [-1, 1]) {
      K.box(2 * fx, 0.022, 0.022, 0, ry, s * fz, frame);
      K.box(0.022, 0.022, 2 * fz, s * fx, ry, 0, frame);
    }
    return;
  }
  const lx = W / 2 - lw / 2, lz = D / 2 - lw / 2;
  for (const sx of [-1, 1]) for (const sz2 of [-1, 1]) {
    const top = sz2 < 0 ? H : legTop;
    K.box(lw, top, lw, sx * lx, top / 2, sz2 * lz, frame, 0.005);
  }
  K.box(W, seatT, D, 0, legTop + seatT / 2, 0, seat, p.cushion ? 0.025 : 0.006);
  const backH = H - seatTop;
  if (backH > 0.08) {
    const railH = Math.min(0.1, backH * 0.35), sh = backH - railH;
    K.box(W - 2 * lw, railH, 0.025, 0, H - railH / 2, -lz, frame, 0.006);
    if (sh > 0.04) {
      for (let i = 0; i < 3; i++) K.box(0.03, sh, 0.018, -(W / 2 - lw) + (W - 2 * lw) * (i + 0.5) / 3, seatTop + sh / 2, -lz, frame);
    }
  }
  if (p.arms) {
    const ay = Math.min(seatTop + 0.22, H - 0.03);
    for (const s of [-1, 1]) {
      K.box(lw, 0.03, D, s * lx, ay, 0, frame, 0.008);
      K.box(lw * 0.8, ay - seatTop, lw * 0.8, s * lx, seatTop + (ay - seatTop) / 2, lz, frame);
    }
  }
}
// An office chair: five spokes on casters, a column, the seat, the backrest at −z.
function buildOfficeChair(K, S, p, C){
  const { w: W, d: D, h: H } = S;
  const dark = L("#2b2d31", "metal"), seat = L(C[1], "fabric"), frame = L(C[0], "metal");
  const caster = 0.025, R = Math.min(W, D) / 2 - caster, baseY = 0.07;
  for (let i = 0; i < 5; i++) {
    const a = Math.PI / 2 + i * Math.PI * 2 / 5, ca = Math.cos(a), sa = Math.sin(a);
    K.box(R, 0.03, 0.045, ca * R / 2, baseY, sa * R / 2, dark, 0.008, [0, -a, 0]);
    K.ball(caster, ca * (R - 0.012), caster, sa * (R - 0.012), L("#1d1d1f", "gloss"), null, null, 10);
  }
  const seatTop = Math.min(p.seat_h_m, H * 0.58), seatT = Math.min(0.08, seatTop * 0.3);
  K.cyl(0.025, 0.03, seatTop - seatT - baseY, 0, baseY + (seatTop - seatT - baseY) / 2, 0, frame, 12);
  K.box(W * 0.82, seatT, D * 0.8, 0, seatTop - seatT / 2, D * 0.05, seat, 0.035);
  const bh = H - seatTop - 0.06, bz = -D / 2 + 0.04;
  if (bh > 0.03) {
    K.box(W * 0.72, bh, 0.06, 0, seatTop + 0.06 + bh / 2, bz, seat, 0.03);
    K.box(0.05, 0.12, 0.03, 0, seatTop + 0.02, bz + 0.02, frame);
  }
  if (p.arms) {
    const ay = Math.min(seatTop + 0.2, H - 0.02);
    for (const s of [-1, 1]) {
      K.box(0.025, ay - seatTop + 0.04, 0.04, s * (W / 2 - 0.03), seatTop - 0.04 + (ay - seatTop + 0.04) / 2, 0, frame);
      K.box(0.05, 0.025, Math.min(0.26, D * 0.45), s * (W / 2 - 0.03), ay, 0, L("#1d1d1f", "soft"), 0.01);
    }
  }
}

// Desk: a top over drawer pedestals (fronts toward +z, where you sit), legs or
// panels on the other sides, and a back panel at −z.
function buildDesk(K, S, p, C){
  const { w: W, d: D, h: H } = S;
  const top = L(C[0], "wood"), frame = L(C[1], p.legs === "metal" ? "metal" : "wood");
  const t = Math.min(0.03, H * 0.1), under = H - t;
  K.slab("rect", W, t, D, 0, under, 0, top, 0.01);
  const pedW = Math.min(0.42, W * 0.32), pedD = D - 0.04;
  const peds = { none: [], left: [-1], right: [1], both: [-1, 1] }[p.drawers];
  for (const s of peds) {
    const x = s * (W / 2 - pedW / 2 - 0.005), cD = pedD - 0.02 - HANDLE_D;
    K.box(pedW, under, cD - GAP_T, x, under / 2, -pedD / 2 + (cD - GAP_T) / 2, top, 0.006);
    drawers(K, x, pedW - 0.02, 0.03, under - 0.01, 3, -pedD / 2 + cD, L(lighten(C[0], 0.08), "wood"), "bar", L(METAL, "metal"));
  }
  for (const s of [-1, 1]) {
    if (peds.includes(s)) continue;
    if (p.legs === "panel") K.box(0.03, under, D - 0.02, s * (W / 2 - 0.015), under / 2, 0, frame, 0.004);
    else if (p.legs === "metal") {
      const x = s * (W / 2 - 0.04);
      for (const sz2 of [-1, 1]) K.box(0.04, under, 0.04, x, under / 2, sz2 * (D / 2 - 0.06), frame, 0.004);
      K.box(0.04, 0.03, D - 0.08, x, 0.015, 0, frame);
      K.box(0.04, 0.04, D - 0.08, x, under - 0.02, 0, frame);
    } else for (const sz2 of [-1, 1]) K.box(0.05, under, 0.05, s * (W / 2 - 0.035), under / 2, sz2 * (D / 2 - 0.035), frame, 0.006);
  }
  if (p.back) { const bh = under * 0.5; K.box(W - 0.08, bh, 0.018, 0, under - bh / 2, -D / 2 + 0.06, frame); }
}

// Dresser or cabinet: drawers, doors or both on the front (+z), on a plinth, feet or legs.
function buildDresser(K, S, p, C){
  const { w: W, d: D, h: H } = S;
  const body = L(C[0], "wood"), front = L(C[1], "wood"), hl = L(METAL, "metal");
  const hd = p.handles === "none" ? 0 : HANDLE_D;
  const cD = D - 0.02 - hd, cz = -D / 2 + cD / 2, zf = -D / 2 + cD;
  const footH = Math.min({ plinth: 0.07, feet: 0.09, legs: 0.2 }[p.base], H * 0.25);
  K.box(W, H - footH, cD - GAP_T, 0, footH + (H - footH) / 2, cz - GAP_T / 2, body, 0.008);
  if (p.base === "plinth") K.box(W - 0.03, footH, cD - 0.03, 0, footH / 2, cz, L(darken(C[0], 0.25), "wood"));
  else {
    for (const sx of [-1, 1]) for (const sz2 of [-1, 1]) {
      const x = sx * (W / 2 - 0.05), z = cz + sz2 * (cD / 2 - 0.05);
      if (p.base === "feet") K.cyl(0.032, 0.026, footH, x, footH / 2, z, body, 10);
      else K.cyl(0.022, 0.013, footH, x, footH / 2, z, L(LEG_WOOD, "wood"), 10);
    }
  }
  const y0 = footH + 0.015, y1 = H - 0.02, colW = (W - 0.03) / p.columns;
  for (let c = 0; c < p.columns; c++) {
    const x = -W / 2 + 0.015 + colW * (c + 0.5), hinge = c % 2 ? 1 : -1;
    if (p.fronts === "drawers") drawers(K, x, colW, y0, y1, p.rows, zf, front, p.handles, hl);
    else if (p.fronts === "doors") door(K, x, colW, y0, y1, zf, front, p.handles, hl, hinge);
    else {
      const ym = y0 + (y1 - y0) * 0.55;
      door(K, x, colW, y0, ym, zf, front, p.handles, hl, hinge);
      drawers(K, x, colW, ym, y1, Math.min(p.rows, 3), zf, front, p.handles, hl);
    }
  }
}

// TV + media unit: the TV at the top of the box, its screen toward +z (a part
// of its own, for a media player), on a stand on the unit or on the wall.
function buildTv(K, S, p, C, parts){
  const { w: W, d: D, h: H } = S;
  const unit = L(C[0], "wood"), tv = L(C[1], "gloss");
  const diag = p.screen_in * 0.0254, bez = 0.012, tvD = 0.045, wall = p.mount === "wall", gap = wall ? 0.05 : 0.07;
  // The screen keeps its size unless the box is too small for it; the unit
  // keeps at least a low shelf's height under it.
  const minUnit = p.unit === "none" ? 0 : Math.min(0.15, H * 0.35);
  const fit = Math.min(1, (W - 2 * bez) / (diag * 16 / Math.hypot(16, 9)), (H - minUnit - gap - 2 * bez) / (diag * 9 / Math.hypot(16, 9)));
  const sw = diag * 16 / Math.hypot(16, 9) * fit, sh = diag * 9 / Math.hypot(16, 9) * fit;
  const tvW = sw + 2 * bez, tvH = sh + 2 * bez, tvY = H - tvH / 2, tvZ = wall ? -D / 2 + tvD / 2 : -D * 0.1;
  const room = H - tvH - gap;
  const unitH = p.unit === "none" ? 0 : wall ? clamp(p.unit === "cabinet" ? 0.6 : 0.42, minUnit, room) : room;
  if (unitH > 0.02) mediaUnit(K, W, D, unitH, p.unit, unit, C[0]);
  K.box(tvW, tvH, tvD, 0, tvY, tvZ, tv, 0.008);
  parts.screen = K.own(L("#0b0d10", "gloss"), (k) => k.box(sw, sh, 0.004, 0, tvY, tvZ + tvD / 2 + 0.002));
  if (!wall) {
    const footY = unitH > 0.02 ? unitH : 0, neckH = tvY - tvH / 2 - footY + 0.04;
    K.box(Math.min(0.08, tvW * 0.2), neckH, 0.03, 0, footY + neckH / 2, tvZ - tvD / 2 + 0.015, tv);
    K.box(Math.min(tvW * 0.45, W), 0.015, Math.min(0.24, D * 0.8), 0, footY + 0.0075, tvZ, tv, 0.004);
  }
}
// The media unit under a TV: open shelves (low) or doors (cabinet), on short legs.
function mediaUnit(K, W, D, H, kind, look, c){
  const legs = Math.min(0.06, H * 0.2), body = H - legs, face = D / 2 - 0.008;
  K.box(W, body, D - 0.008, 0, legs + body / 2, -0.004, look, 0.008);
  for (const sx of [-1, 1]) for (const sz2 of [-1, 1]) K.box(0.04, legs, 0.04, sx * (W / 2 - 0.05), legs / 2, sz2 * (D / 2 - 0.05), L(LEG_DARK, "wood"));
  if (kind === "cabinet") {
    const n = W > 1.4 ? 3 : 2, dw = (W - 0.03) / n;
    for (let i = 0; i < n; i++) K.box(dw - 0.006, body - 0.03, 0.008, -W / 2 + 0.015 + dw * (i + 0.5), legs + body / 2, face + 0.004, L(lighten(c, 0.08), "wood"), 0.002);
  } else {
    K.box(W - 0.06, body * 0.5, 0.008, 0, legs + body * 0.5, face + 0.004, L(darken(c, 0.55)));
  }
}

// Lamp: a floor or table lamp; the shade and the bulb glow (parts of their own, for a light).
function buildLamp(K0, S, p, C, parts){
  const { w: W, d: D, h: H } = S;
  const R = Math.min(W, D) / 2, shade = L(C[0], "fabric"), base = L(C[1], "metal");
  const K = K0.child(null, [W / 2 / R, 1, D / 2 / R]);
  const table = p.style === "table", globe = p.shade === "globe";
  const shH = globe ? Math.min(2 * R, H * 0.45) : clamp(H * (table ? 0.42 : 0.26), 0.06, 0.55);
  const shBot = H - shH, baseT = Math.min(0.03, shBot * 0.12);
  if (p.base === "tripod") {
    const hubY = shBot * (table ? 0.55 : 0.4);
    for (let i = 0; i < 3; i++) {
      const a = Math.PI / 2 + i * Math.PI * 2 / 3;
      K.rod([Math.cos(a) * (R * 0.9 - 0.012), 0.012, Math.sin(a) * (R * 0.9 - 0.012)], [0, hubY, 0], 0.012, base, 8);
    }
    K.cyl(0.012, 0.012, shBot - hubY + 0.02, 0, hubY + (shBot - hubY + 0.02) / 2, 0, base, 8);
  } else {
    const bR = R * (table ? 0.55 : 0.7);
    if (p.base === "round") K.cyl(bR, bR, baseT, 0, baseT / 2, 0, base, 24);
    else K.box(bR * 1.8, baseT, bR * 1.8, 0, baseT / 2, 0, base, 0.004);
    if (table) {
      const bodyH = (shBot - baseT) * 0.7;
      K.cyl(R * 0.3, R * 0.42, bodyH, 0, baseT + bodyH / 2, 0, L(C[1], "gloss"), 20);
      K.cyl(0.01, 0.01, shBot - baseT - bodyH + 0.02, 0, baseT + bodyH + (shBot - baseT - bodyH) / 2, 0, base, 8);
    } else K.cyl(0.013, 0.013, shBot - baseT + 0.02, 0, baseT + (shBot - baseT) / 2, 0, base, 10);
  }
  const shadeMesh = K.own(shade, (k) => (globe ? k.ball(shH / 2, 0, shBot + shH / 2, 0, shade, null, null, 20)
    : k.cyl(p.shade === "cone" ? R * 0.5 : R * 0.96, R, shH, 0, shBot + shH / 2, 0, shade, 24)));
  const br = Math.min(0.03, shH * 0.2, R * 0.3);
  const bulb = K.own(L("#fff4dc", "gloss"), (k) => k.ball(br, 0, globe ? shBot + shH / 2 : shBot + br * 0.4, 0, L("#fff4dc"), null, null, 10));
  parts.glow = [shadeMesh, bulb];
}

// Rug: a thin mat on the floor, plain, bordered or striped (a round one in
// rings), fringed at its short ends.
function buildRug(K, S, p, C){
  const { w: W, d: D, h: H } = S;
  const main = L(C[0], "fabric"), edge = L(C[1], "fabric"), round = p.shape === "round", form = round ? "ellipse" : "rect";
  const fr = p.fringe && !round ? Math.min(0.06, W * 0.08) : 0, bw = W - 2 * fr;
  if (p.pattern === "plain") K.slab(form, bw, H, D, 0, 0, 0, main, 0.02, 0.002);
  else if (p.pattern === "border" || round) {
    // Rings, each a little higher than the one around it.
    const looks = p.pattern === "border" ? [edge, main] : [edge, main, edge, main];
    const b = Math.min(0.12, Math.min(bw, D) * 0.1);
    looks.forEach((look, i) => K.slab(form, bw - 2 * b * i, H * (0.55 + 0.45 * i / (looks.length - 1)), D - 2 * b * i, 0, 0, 0, look, 0.02, 0.002));
  } else {
    const lo = H * 0.7, n = clamp(Math.round(bw / 0.4), 2, 8), band = bw / (2 * n + 1);
    K.slab(form, bw, lo, D, 0, 0, 0, main, 0.02, 0.002);
    for (let i = 0; i < n; i++) K.box(band, H - lo + 0.0005, D - 0.06, -bw / 2 + band * (2 * i + 1.5), (lo - 0.0005 + H) / 2, 0, edge);
  }
  if (fr) for (const s of [-1, 1]) K.box(fr, H * 0.4, D * 0.94, s * (W / 2 - fr / 2), H * 0.2, 0, L(lighten(C[1], 0.3), "fabric"));
}

// Shelf: a bookcase, an open frame or boards on the wall; the back at −z and
// any books standing toward it.
const BOOKS = ["#2f4f6f", "#7a2e2e", "#c9a227", "#3d5a3d", "#e8e0d0"];
function buildShelf(K, S, p, C){
  const { w: W, d: D, h: H } = S;
  const frame = L(C[0], "wood"), n = p.shelves, t = Math.min(0.02, H / (n + 1) / 3), style = p.style;
  const back = p.back && style !== "wall" ? 0.008 : 0, side = style === "bookcase" ? t : style === "open" ? 0.025 : 0;
  const base = style === "bookcase" ? Math.min(0.06, H * 0.1) : style === "wall" ? Math.min(0.05, H * 0.12) : 0;
  const ys = [];
  for (let i = 0; i <= n; i++) ys.push(base + t / 2 + (H - base - t) * i / n);
  const bw = W - 2 * side;
  for (const y of ys) K.box(bw, t, D - back, 0, y, back / 2, frame, 0.004);
  if (style === "bookcase") {
    for (const s of [-1, 1]) K.box(t, H, D, s * (W / 2 - t / 2), H / 2, 0, frame, 0.004);
    K.box(bw, base, D - back - 0.03, 0, base / 2, back / 2 - 0.015, L(darken(C[0], 0.2), "wood"));
  } else if (style === "open") {
    for (const sx of [-1, 1]) for (const sz2 of [-1, 1]) K.box(0.025, H, 0.025, sx * (W / 2 - 0.0125), H / 2, sz2 * (D / 2 - 0.0125), L(METAL, "metal"));
  } else {
    // Brackets under each board, against the wall.
    const bh = Math.min(0.05, base), bd = Math.min(0.06, D * 0.5);
    for (const y of ys) for (const s of [-1, 1]) K.box(0.02, bh, bd, s * bw * 0.35, y - t / 2 - bh / 2, -D / 2 + bd / 2, L(METAL, "metal"));
  }
  if (back) K.box(W - side, H - base, back, 0, base + (H - base) / 2, -D / 2 + back / 2, frame);
  if (p.books === "none") return;
  // Books stand at the back of each shelf in a few colours: one by one on
  // High (unless there would be too many), in runs on Low.
  const R = (seed) => { const v = Math.sin(seed * 12.9898 + 78.233) * 43758.5453; return v - Math.floor(v); };
  const fill = p.books === "full" ? 0.86 : 0.45, bd = Math.min(D - back - 0.02, 0.22);
  const single = K.hi && n * (bw * fill) / 0.0425 <= 240;
  for (let i = 0; i < n; i++) {
    const gap = ys[i + 1] - ys[i] - t;
    if (gap < 0.08 || bd < 0.03) continue;
    const end = -bw / 2 + 0.01 + (bw - 0.02) * fill;
    for (let x = -bw / 2 + 0.01, k = 0; x < end - 0.02; k++) {
      const r1 = R(i * 97 + k * 13 + n), r2 = R(i * 31 + k * 7 + 5);
      const bwid = Math.min(end - x, single ? 0.025 + r1 * 0.035 : 0.15 + r1 * 0.2), bh = Math.min(gap - 0.01, 0.16 + r2 * 0.14);
      K.box(bwid - 0.002, bh, bd, x + bwid / 2, ys[i] + t / 2 + bh / 2, -D / 2 + back + 0.005 + bd / 2,
            L(k % 3 === 0 ? C[1] : BOOKS[(i + k) % BOOKS.length]));
      x += bwid + (p.books === "some" && r2 > 0.8 ? 0.06 : 0);
    }
  }
}

// Wardrobe: hinged or sliding doors toward +z, any drawers below them, a mirror.
function buildWardrobe(K, S, p, C){
  const { w: W, d: D, h: H } = S;
  const body = L(C[0], "wood"), front = L(C[1], "wood"), hl = L(METAL, "metal"), glass = L("#c9d3d8", "gloss");
  const sliding = p.style === "sliding", hd = p.handles === "none" ? 0 : HANDLE_D, ft = sliding ? 0.05 : 0.024;
  const cD = D - ft - hd, cz = -D / 2 + cD / 2, zf = -D / 2 + cD;
  const plinth = Math.min(0.08, H * 0.06), y0 = plinth + 0.01, y1 = H - 0.02;
  K.box(W, H - plinth, cD - GAP_T, 0, plinth + (H - plinth) / 2, cz - GAP_T / 2, body, 0.008);
  K.box(W - 0.02, plinth, cD - 0.02, 0, plinth / 2, cz, L(darken(C[0], 0.25), "wood"));
  const drH = p.drawers ? Math.min(0.2 * p.drawers, (y1 - y0) * 0.35) : 0;
  if (p.drawers) {
    // Under sliding doors the drawers come forward to the front track.
    const zd = sliding ? zf + ft - 0.025 : zf;
    if (sliding) K.box(W - 0.02, drH, zd - GAP_T - zf, 0, y0 + drH / 2, (zf + zd - GAP_T) / 2, body);
    drawers(K, 0, W - 0.02, y0, y0 + drH, p.drawers, zd, front, p.handles, hl);
  }
  const dy0 = y0 + drH, dh = y1 - dy0;
  if (sliding) {
    const n = Math.max(2, p.doors), dw = (W - 0.02) / n;
    for (let i = 0; i < n; i++) {
      const x = -W / 2 + 0.01 + dw * (i + 0.5), z = zf + (i % 2 ? 0.035 : 0.01), face = z + 0.01;
      K.box(dw, dh, 0.02, x, dy0 + dh / 2, z, front, 0.004);
      K.box(0.012, Math.min(0.3, dh * 0.3), 0.003, x + (i % 2 ? -1 : 1) * (dw / 2 - 0.03), dy0 + dh * 0.5, face + 0.0015, L(darken(C[1], 0.45)));
      if (p.mirror && i === 0) K.box(dw * 0.7, dh * 0.8, 0.003, x, dy0 + dh / 2, face + 0.0015, glass);
    }
  } else {
    const n = p.doors, dw = (W - 0.02) / n;
    for (let i = 0; i < n; i++) {
      const x = -W / 2 + 0.01 + dw * (i + 0.5), hinge = n === 1 || i % 2 === 0 ? -1 : 1;
      door(K, x, dw, dy0, y1, zf, front, p.handles, hl, hinge);
      if (p.mirror && i === 0) K.box(dw * 0.55, dh * 0.75, 0.003, x + hinge * dw * 0.1, dy0 + dh / 2, zf + 0.0215, glass);
    }
  }
}

// Plant: a pot and a bush, a tree, a palm or a cactus. It is drawn round,
// in metres, then stretched along the longer side, so a long planter is a row.
function buildPlant(K0, S, p, C){
  const { w: W, d: D, h: H } = S;
  const R = Math.min(W, D) / 2, K = K0.child(null, [W / 2 / R, 1, D / 2 / R]);
  const leaf = L(C[0], "soft"), pot = L(C[1], "gloss"), soil = L("#3b2a1e");
  const potH = p.pot === "none" ? 0 : clamp(H * 0.3, 0.04, 0.45), potR = R * (p.style === "tree" || p.style === "palm" ? 0.6 : 0.75);
  if (p.pot === "round") {
    K.cyl(potR, potR * 0.78, potH, 0, potH / 2, 0, pot, 20);
    K.cyl(potR * 0.9, potR * 0.9, 0.008, 0, potH - 0.003, 0, soil, 20);
  } else if (p.pot === "square") {
    K.box(potR * 1.75, potH, potR * 1.75, 0, potH / 2, 0, pot, 0.02);
    K.box(potR * 1.6, 0.008, potR * 1.6, 0, potH - 0.003, 0, soil);
  }
  const fh = H - potH, y0 = potH, ball = (x, y, z, r) => K.ball(r, x, y, z, leaf, null, null, 12);
  if (p.style === "bush") {
    // A ring of leaves on the pot, a crown at the top, and leaves between.
    const r1 = Math.min(R * 0.42, fh * 0.32), r0 = Math.min(R * 0.6, fh * 0.42), rm = Math.min(R * 0.55, fh * 0.4);
    for (let i = 0; i < 6; i++) { const a = Math.PI / 6 + i * Math.PI / 3; ball(Math.cos(a) * (R - r1), y0 + r1, Math.sin(a) * (R - r1), r1); }
    ball(0, H - r0, 0, r0);
    for (let y = y0 + r1 * 1.7 + rm * 0.6, i = 0; y < H - r0 * 1.7 - rm * 0.2; y += rm * 1.2, i++) {
      const a = i * 2.4;
      ball(Math.cos(a) * R * 0.15, y, Math.sin(a) * R * 0.15, rm);
    }
  } else if (p.style === "tree") {
    const tr = clamp(R * 0.08, 0.008, 0.05), rt = Math.min(R * 0.55, fh * 0.22), rr = Math.min(R * 0.45, fh * 0.2);
    K.cyl(tr * 0.8, tr, fh * 0.6, 0, y0 + fh * 0.3, 0, L("#6b4a32", "wood"), 8);
    ball(0, H - rt, 0, rt);
    for (let i = 0; i < 3; i++) { const a = i * Math.PI * 2 / 3; ball(Math.cos(a) * (R - rr), H - rt * 2.1, Math.sin(a) * (R - rr), rr); }
  } else if (p.style === "palm") {
    // Arching fronds: each rises from the top of the trunk, then droops.
    const l1 = R * 0.5, l2 = R * 0.46, up = 0.6, down = -0.35, wid = Math.min(0.14, R * 0.3);
    const top = Math.max(y0 + fh * 0.3, H - 0.02 - l1 * Math.sin(up)), tr = clamp(R * 0.08, 0.008, 0.05);
    K.cyl(tr * 0.8, tr, top - y0, 0, (y0 + top) / 2, 0, L("#7a6044", "wood"), 8);
    const rise = Math.asin(clamp((H - top - 0.02) / l1, 0, Math.sin(up))), droop = Math.max(down, -Math.asin(clamp((top + l1 * Math.sin(rise) - y0) / l2, 0, 1)));
    const reach = l1 * Math.cos(rise), peak = top + l1 * Math.sin(rise);
    for (let i = 0; i < 9; i++) {
      const a = i * Math.PI * 2 / 9, ca = Math.cos(a), sa = Math.sin(a);
      K.box(l1, 0.012, wid, ca * reach / 2, top + (peak - top) / 2, -sa * reach / 2, leaf, 0, [0, a, rise]);
      const c2 = reach + l2 * Math.cos(droop) / 2;
      K.box(l2, 0.012, wid * 0.8, ca * c2, peak + l2 * Math.sin(droop) / 2, -sa * c2, leaf, 0, [0, a, droop]);
    }
  } else {
    const rc = Math.max(0.006, Math.min(R * 0.24, fh * 0.3)), colTop = H - rc, ra = rc * 0.62;
    K.cyl(rc, rc, colTop - y0, 0, (y0 + colTop) / 2, 0, leaf, 12);
    ball(0, colTop, 0, rc);
    // Three arms around the column, each out and then up.
    const out = Math.min(R - ra, rc + ra * 2.2);
    [[0, 0.32], [2.3, 0.48], [4.2, 0.4]].forEach(([a, f]) => {
      const ay = y0 + fh * f, armTop = Math.min(colTop - 0.01, ay + fh * 0.28), ex = Math.cos(a) * out, ez = Math.sin(a) * out;
      if (out - rc * 0.5 <= ra || armTop - ay < 0.01) return;
      K.rod([Math.cos(a) * rc * 0.5, ay, Math.sin(a) * rc * 0.5], [ex, ay, ez], ra, leaf, 10);
      ball(ex, ay, ez, ra);
      K.cyl(ra, ra, armTop - ay, ex, (ay + armTop) / 2, ez, leaf, 10);
      ball(ex, armTop, ez, ra);
    });
  }
}

// ── device pieces: each one's live part is its own child or material ────────
// Washer or dryer: the whole machine is parts.run (running = a gentle shake);
// a front-loader's door toward +z, a top-loader's lid on top and its controls
// raised at the back.
function buildLaundry(K, S, p, C, parts, dryer){
  const { w: W, d: D, h: H } = S;
  const body = L(C[0], "gloss"), trim = L(C[1], "metal"), dark = L("#24272b", "gloss");
  const run = K.child();
  parts.run = run.obj;
  const feet = Math.min(0.02, H * 0.03);
  for (const sx of [-1, 1]) for (const sz2 of [-1, 1]) run.box(0.04, feet, 0.04, sx * (W / 2 - 0.05), feet / 2, sz2 * (D / 2 - 0.08), dark);
  if (dryer || p.loading === "front") {
    const bodyD = D - 0.035, face = D / 2 - 0.035, panelH = Math.min(0.12, H * 0.14);
    run.box(W, H - feet, bodyD, 0, feet + (H - feet) / 2, -D / 2 + bodyD / 2, body, 0.02);
    run.box(W * 0.9, panelH * 0.7, 0.004, 0, H - panelH / 2, face + 0.002, L(lighten(C[0], 0.05), "gloss"));
    run.cyl(panelH * 0.25, panelH * 0.25, 0.016, W * 0.3, H - panelH / 2, face + 0.008, trim, 16, [Math.PI / 2, 0, 0]);
    run.box(W * 0.3, panelH * 0.35, 0.003, -W * 0.15, H - panelH / 2, face + 0.0055, dark);
    const r = Math.min(W * 0.36, (H - feet - panelH) * 0.4), dy = feet + (H - feet - panelH) * 0.48;
    run.cyl(r, r, 0.03, 0, dy, face + 0.015, trim, 28, [Math.PI / 2, 0, 0]);
    run.cyl(r * 0.74, r * 0.74, 0.034, 0, dy, face + 0.017,
            dryer && p.door === "solid" ? L(lighten(C[0], 0.06), "gloss") : L("#36424c", "gloss"), 24, [Math.PI / 2, 0, 0]);
  } else {
    const back = Math.min(0.14, H * 0.16), top = H - back * 0.6, sd = Math.min(0.12, D * 0.2);
    run.box(W, top - feet, D, 0, feet + (top - feet) / 2, 0, body, 0.02);
    run.box(W, H - top + 0.02, sd, 0, top - 0.02 + (H - top + 0.02) / 2, -D / 2 + sd / 2, body, 0.015);
    run.box(W * 0.5, (H - top) * 0.5, 0.003, 0, top + (H - top) * 0.5, -D / 2 + sd + 0.0015, dark);
    run.box(W * 0.84, 0.01, D * 0.6, 0, top + 0.005, D * 0.1, L(lighten(C[0], 0.05), "gloss"), 0.004);
  }
}

// Robot vacuum dock: the dock at −z, the robot (parts.dock) parked in front of it.
function buildVacuumDock(K, S, p, C, parts){
  const { w: W, d: D, h: H } = S;
  const dockL = L(C[0], "gloss"), robotL = L(C[1], "gloss"), dark = L("#1d1f22", "gloss");
  const dd = clamp(D * 0.32, 0.06, 0.3), rr = Math.max(0.03, Math.min(W / 2, (D - dd) / 2) - 0.004);
  const tower = p.dock === "tower", dockH = H, bd = tower ? dd : dd * 0.55;
  K.box(tower ? W : W * 0.8, dockH, bd, 0, dockH / 2, -D / 2 + bd / 2, dockL, Math.min(0.02, bd / 3));
  if (tower) K.box(W * 0.9, 0.006, dd * 0.8, 0, dockH - 0.004, -D / 2 + dd / 2, L(darken(C[0], 0.35), "gloss"));
  K.box(W * 0.9, 0.008, D - dd, 0, 0.004, dd / 2, dark);
  K.box(W * 0.3, Math.min(0.02, dockH * 0.2), 0.004, 0, Math.min(dockH * 0.6, 0.08), -D / 2 + bd + 0.002, L("#3b82c4", "gloss"));
  const robot = K.child([0, 0.008, D / 2 - rr - 0.002]);
  parts.dock = robot.obj;
  const rh = Math.max(0.02, Math.min(0.095, H - 0.03)), turret = Math.min(0.02, H - 0.008 - rh);
  if (p.robot === "d-shape") {
    robot.box(rr * 2, rh - 0.002, rr, 0, (rh - 0.002) / 2, rr / 2, robotL, Math.min(0.03, rh / 3));   // under the round top, not level with it
    robot.cyl(rr, rr, rh, 0, rh / 2, 0, robotL, 28);
  } else robot.cyl(rr, rr, rh, 0, rh / 2, 0, robotL, 28);
  robot.cyl(rr * 0.96, rr * 0.96, 0.004, 0, rh + 0.002, 0, L(darken(C[1], 0.3), "gloss"), 28);
  if (turret > 0.004) robot.cyl(rr * 0.24, rr * 0.24, turret, 0, rh + turret / 2, -rr * 0.3, dark, 16);
}

// Mower dock: a plate with the charging post at −z, the mower (parts.dock) on it, a roof if asked.
function buildMowerDock(K, S, p, C, parts){
  const { w: W, d: D, h: H } = S;
  const dockL = L(C[0], "gloss"), mowerL = L(C[1], "gloss"), dark = L("#1d1f22");
  const postD = Math.min(0.14, D * 0.18), postH = p.roof ? Math.min(H, 0.32) : H;
  K.box(W, 0.025, D, 0, 0.0125, 0, dockL, 0.01);
  K.box(Math.min(W, 0.36), postH, postD, 0, postH / 2, -D / 2 + postD / 2, dockL, 0.02);
  const roofH = p.roof ? Math.min(0.04, H * 0.1) : 0;
  if (p.roof) {
    for (const sx of [-1, 1]) for (const sz2 of [-1, 1]) K.box(0.03, H - roofH, 0.03, sx * (W / 2 - 0.015), (H - roofH) / 2, sz2 * (D / 2 - 0.015), dockL);
    K.box(W, roofH, D, 0, H - roofH / 2, 0, dockL, 0.01);
  }
  const mw = W * 0.82, ml = (D - postD) * 0.86, mh = Math.max(0.05, Math.min(0.3, H - roofH - 0.04)), wr = Math.min(0.1, mh * 0.4);
  const mower = K.child([0, 0.025, -D / 2 + postD + ml / 2 + 0.01]);
  parts.dock = mower.obj;
  mower.box(mw - 0.04, mh - wr * 0.6, ml, 0, wr * 0.6 + (mh - wr * 0.6) / 2, 0, mowerL, Math.min(0.05, mh / 4));
  for (const sx of [-1, 1]) for (const sz2 of [-1, 1]) mower.cyl(wr, wr, 0.04, sx * (mw / 2 - 0.02), wr, sz2 * (ml / 2 - wr), dark, 16, [0, 0, Math.PI / 2]);
  mower.box(mw * 0.4, 0.01, ml * 0.3, 0, mh + 0.005, -ml * 0.1, dark);
}

// Car: the nose toward +z, a cabin by body style, its charge-port light (parts.glow).
function buildCar(K, S, p, C, parts){
  const { w: W, d: D, h: H } = S;
  const body = L(C[0], "gloss"), glass = L(C[1], "gloss"), tyre = L("#1c1c1e"), rim = L("#9ba3ab", "metal");
  const wr = clamp(Math.min(H * 0.22, D * 0.075), 0.2, 0.4), ww = Math.min(0.24, W * 0.13);
  const clear = wr * 0.45, belt = Math.min(H * 0.55, clear + wr * 1.9);
  K.box(W - 0.04, belt - clear, D - 0.024, 0, clear + (belt - clear) / 2, 0, body, 0.09);
  const cab = { sedan: [-0.24, 0.18], hatch: [-0.42, 0.14], suv: [-0.42, 0.2], pickup: [-0.06, 0.22] }[p.body];
  const z0 = cab[0] * D, z1 = cab[1] * D, roofT = Math.min(0.06, (H - belt) * 0.15);
  K.box(W * 0.84, H - belt - roofT + 0.02, z1 - z0, 0, belt + (H - belt - roofT) / 2 - 0.01, (z0 + z1) / 2, glass, 0.08);
  K.box(W * 0.84, roofT, (z1 - z0) * 0.9, 0, H - roofT / 2, (z0 + z1) / 2, body, Math.min(0.03, roofT / 2));
  if (p.body === "pickup") {
    const bz0 = -D / 2 + 0.05, bz1 = z0 - 0.06, wallH = Math.min(0.32, (H - belt) * 0.5);
    for (const s of [-1, 1]) K.box(0.05, wallH, bz1 - bz0, s * (W / 2 - 0.045), belt + wallH / 2, (bz0 + bz1) / 2, body, 0.01);
    K.box(W - 0.09, wallH, 0.05, 0, belt + wallH / 2, bz0 + 0.025, body, 0.01);
  }
  const wz = D / 2 - Math.max(wr * 1.6, D * 0.17);
  for (const sx of [-1, 1]) for (const sz2 of [-1, 1]) {
    const x = sx * (W / 2 - ww / 2 - 0.003);
    K.cyl(wr, wr, ww, x, wr, sz2 * wz, tyre, 22, [0, 0, Math.PI / 2]);
    K.cyl(wr * 0.55, wr * 0.55, ww + 0.004, x, wr, sz2 * wz, rim, 16, [0, 0, Math.PI / 2]);
  }
  const ly = belt - Math.min(0.12, (belt - clear) * 0.35);
  for (const s of [-1, 1]) {
    K.box(W * 0.2, 0.07, 0.02, s * W * 0.32, ly, D / 2 - 0.012, L("#f4f1e6", "gloss"), 0.01);
    K.box(W * 0.2, 0.06, 0.02, s * W * 0.32, ly, -D / 2 + 0.012, L("#9b1c1c", "gloss"), 0.01);
  }
  parts.glow = [K.own(L("#2f3a33", "gloss"), (k) => k.box(0.006, 0.05, 0.08, -W / 2 + 0.023, belt - 0.08, D * 0.3, L("#2f3a33")))];
}

// Car charger: a wall box (or one on a post), its light ring toward +z (parts.glow).
function buildCharger(K, S, p, C, parts){
  const { w: W, d: D, h: H } = S;
  const body = L(C[0], "gloss"), cable = L(C[1], "soft"), dark = L("#202326", "gloss");
  const post = p.mount === "post";
  const uh = post ? Math.min(0.45, H * 0.4) : H, uy = H - uh / 2, ud = (post ? Math.min(D, 0.16) : D) * 0.72;
  const room = D - ud, uz = -D / 2 + ud / 2, face = -D / 2 + ud;
  if (post) {
    const pw = Math.min(0.12, W * 0.5), pd = Math.min(pw, ud);
    K.box(pw, H - uh + 0.02, pd, 0, (H - uh + 0.02) / 2, -D / 2 + pd / 2, dark, 0.01);
    K.box(Math.min(W, 0.3), 0.03, Math.min(D, 0.3), 0, 0.015, -D / 2 + Math.min(D, 0.3) / 2, dark);
  }
  K.box(W, uh, ud, 0, uy, uz, body, Math.min(0.03, W / 6, ud / 3, uh / 6));
  const ringR = Math.min(W, uh) * 0.18, rd = Math.min(0.008, room * 0.5);
  parts.glow = [K.own(L("#4a5560", "gloss"), (k) => k.cyl(ringR, ringR, rd + 0.002, 0, uy + uh * 0.18, face + rd / 2 - 0.001, L("#4a5560"), 24, [Math.PI / 2, 0, 0]))];
  const hd = Math.min(0.04, room * 0.9);
  if (hd > 0.008) K.box(W * 0.28, uh * 0.22, hd, W * 0.24, uy - uh * 0.2, face + hd / 2, dark, Math.min(0.01, hd / 3));
  if (p.cable && room > 0.04) {
    const cr = Math.min(W * 0.22, uh * 0.2), ct = Math.min(0.03, room * 0.4);
    K.torus(cr, ct / 2, -W * 0.12, uy - uh * 0.22, face + ct / 2 + 0.002, cable);
  }
}

// Radiator: panels or columns that warm (parts.warm), on brackets at the back.
function buildRadiator(K, S, p, C, parts){
  const { w: W, d: D, h: H } = S;
  const look = L(C[0], "gloss"), feet = Math.min(0.06, H * 0.1), y0 = feet, rh = H - feet;
  const warm = K.own(look, (k) => {
    if (p.style === "column") {
      const n = Math.max(2, Math.floor(W / 0.06)), cw = W / n;
      for (let i = 0; i < n; i++) k.box(cw * 0.7, rh - 0.04, D * 0.9, -W / 2 + cw * (i + 0.5), y0 + rh / 2, 0, look, k.hi ? Math.min(0.012, cw * 0.3) : 0);
      for (const y of [y0 + 0.025, H - 0.025]) k.box(W, 0.05, D * 0.6, 0, y, 0, look, 0.01);
    } else {
      const panels = D >= 0.09 ? 2 : 1, pd = Math.min(0.03, D / (panels * 1.6)), gap = (D - panels * pd) / Math.max(1, panels);
      for (let i = 0; i < panels; i++) {
        const z = panels === 1 ? 0 : (i ? 1 : -1) * (gap / 2 + pd / 2);
        k.box(W, rh, pd, 0, y0 + rh / 2, z, look, 0.006);
        const n = Math.max(3, Math.floor(W / 0.05));
        for (let j = 0; j < n; j++) k.box(0.012, rh * 0.86, 0.004, -W / 2 + W * (j + 0.5) / n, y0 + rh / 2, z + (i || panels === 1 ? 1 : -1) * (pd / 2 + 0.002), look);
      }
      k.box(W, 0.012, D * 0.9, 0, H - 0.006, 0, look);
    }
  });
  parts.warm = [warm];
  for (const s of [-1, 1]) K.box(0.03, feet, Math.min(D, 0.05), s * (W / 2 - Math.min(0.12, W * 0.2)), feet / 2, 0, L(darken(C[0], 0.2), "gloss"));
  K.cyl(0.015, 0.015, Math.min(0.06, H * 0.2), W / 2 - 0.02, feet + 0.03, 0, L(METAL, "metal"), 10);
}

// Fan: the blades (parts.spin) turn about their own z axis: facing +z on a
// desk or a pedestal, flat under a ceiling fan.
function buildFan(K, S, p, C, parts, THREE){
  const pitch = (a) => new THREE.Quaternion().setFromEuler(new THREE.Euler(0.35, 0, a, "ZYX"));
  const { w: W, d: D, h: H } = S;
  const body = L(C[0], "gloss"), blade = L(C[1], "gloss");
  const nb = p.blades;
  if (p.style === "ceiling") {
    const R = Math.min(W, D) / 2, motorH = Math.min(0.12, H * 0.3), rod = Math.max(0.01, H - motorH - 0.05);
    K.cyl(Math.min(0.08, R * 0.8), Math.min(0.06, R * 0.6), 0.04, 0, H - 0.02, 0, body, 18);
    K.cyl(0.013, 0.013, rod, 0, H - 0.04 - rod / 2, 0, body, 10);
    K.cyl(Math.min(0.14, R * 0.3), Math.min(0.11, R * 0.25), motorH, 0, motorH / 2 + 0.008, 0, body, 22);
    const spin = K.child([0, Math.min(motorH * 0.4, 0.05), 0], null, [-Math.PI / 2, 0, 0]);
    parts.spin = spin.obj;
    for (let i = 0; i < nb; i++) {
      const a = i * Math.PI * 2 / nb, hub = Math.min(0.12, R * 0.28), len = R - hub - 0.01;
      spin.box(len, Math.min(0.14, R * 0.22), 0.01, Math.cos(a) * (hub + len / 2), Math.sin(a) * (hub + len / 2), 0, blade, 0.004, pitch(a));
    }
    return;
  }
  const desk = p.style === "desk";
  const R = Math.min(W / 2, (desk ? H * 0.42 : H * 0.22)), headY = H - R, headZ = Math.min(0.05, D * 0.15);
  K.slab("ellipse", W * (desk ? 0.7 : 0.85), 0.03, D * (desk ? 0.7 : 0.85), 0, 0, 0, body, 0, 0.008);
  K.cyl(0.016, 0.02, headY - 0.03, 0, 0.03 + (headY - 0.03) / 2, -headZ * 0.6, body, 10);
  const motorD = Math.min(0.12, D * 0.35);
  K.cyl(R * 0.3, R * 0.36, motorD, 0, headY, -headZ * 0.6, body, 18, [Math.PI / 2, 0, 0]);
  const rimT = Math.min(0.012, R * 0.08);
  K.torus(R - rimT, rimT, 0, headY, headZ, L(lighten(C[0], 0.1), "metal"), [0, 0, 0]);
  const spin = K.child([0, headY, headZ]);
  parts.spin = spin.obj;
  const len = R - rimT * 2 - R * 0.18 - 0.005;
  for (let i = 0; i < nb; i++) {
    const a = i * Math.PI * 2 / nb;
    spin.box(len, Math.min(0.12, R * 0.5), 0.006, Math.cos(a) * (R * 0.18 + len / 2), Math.sin(a) * (R * 0.18 + len / 2), 0, blade, 0.003, pitch(a));
  }
  spin.cyl(R * 0.18, R * 0.18, 0.03, 0, 0, 0, body, 16, [Math.PI / 2, 0, 0]);
}

// Speaker: a box (on a shelf or the floor), a smart speaker or a soundbar;
// its drivers (parts.run) toward +z, which pulse while it plays.
function buildSpeaker(K, S, p, C, parts){
  const { w: W, d: D, h: H } = S;
  const body = L(C[0], "wood"), grille = L(C[1], "fabric"), dark = L("#141517", "gloss");
  if (p.style === "smart") {
    const R = Math.min(W, D) / 2, O = K.child(null, [W / 2 / R, 1, D / 2 / R]);
    O.cyl(R * 0.97, R, H * 0.94, 0, H * 0.47, 0, grille, 28);
    O.cyl(R * 0.9, R * 0.97, H * 0.06, 0, H * 0.97, 0, body, 28);
    const ring = O.child([0, H - 0.002, 0]);
    parts.run = ring.obj;
    ring.cyl(R * 0.5, R * 0.5, 0.004, 0, 0, 0, L("#2c2f33", "gloss"), 24);
    return;
  }
  const fd = Math.min(0.02, D * 0.12), bodyD = D - fd, face = -D / 2 + bodyD;
  K.box(W, H, bodyD, 0, H / 2, -D / 2 + bodyD / 2, body, Math.min(0.015, W / 8, H / 8));
  const run = K.child([0, 0, face]);
  parts.run = run.obj;
  const driver = (x, y, r) => {
    run.cyl(r, r, fd * 0.5, x, y, fd * 0.25, dark, 20, [Math.PI / 2, 0, 0]);
    run.cyl(r * 0.8, r * 0.55, fd * 0.7, x, y, fd * 0.35, grille, 20, [Math.PI / 2, 0, 0]);
    run.ball(r * 0.22, x, y, fd * 0.55, dark, [1, 1, Math.min(0.6, fd * 0.4 / (r * 0.22))], null, 10);
  };
  if (p.style === "soundbar") {
    const r = Math.min(H * 0.32, W * 0.06), n = clamp(Math.round(W / 0.22), 2, 6);
    for (let i = 0; i < n; i++) driver(-W / 2 + W * (i + 0.5) / n, H / 2, r);
  } else {
    const r = Math.min(W * 0.36, H * 0.18), floor = p.style === "floor";
    driver(0, H * (floor ? 0.3 : 0.38), r);
    if (floor) driver(0, H * 0.55, r);
    driver(0, H * (floor ? 0.8 : 0.78), r * 0.42);
  }
}

const BUILDERS = { sofa: buildSofa, bed: buildBed, table: buildTable, chair: buildChair, desk: buildDesk, dresser: buildDresser,
                   tv: buildTv, lamp: buildLamp, rug: buildRug, shelf: buildShelf, wardrobe: buildWardrobe, plant: buildPlant,
                   washer: (K, S, p, C, parts) => buildLaundry(K, S, p, C, parts, false),
                   dryer: (K, S, p, C, parts) => buildLaundry(K, S, p, C, parts, true),
                   vacuum_dock: buildVacuumDock, mower_dock: buildMowerDock, car: buildCar, charger: buildCharger,
                   radiator: buildRadiator, fan: buildFan, speaker: buildSpeaker, other: buildBox };

// ── building and freeing ─────────────────────────────────────────────────────
function build(THREE, quality, fn, S, p, C, meta){
  const group = new THREE.Group();
  const parts = {};
  const kit = makeKit(THREE, quality, group);
  fn(kit, S, p, C, parts, THREE);
  const res = kit.finish();
  group.userData = { ...meta, size: S, quality, parts, pieceRes: res };
  return group;
}

export function buildPiece(THREE, recipe, opts){
  const r = clampRecipe(recipe);
  const quality = opts && opts.quality === "high" ? "high" : "low";
  const S = { w: r.width_m, d: r.depth_m, h: r.height_m };
  const fn = defOf(r.kind) ? BUILDERS[r.kind] || buildBox : buildBox;
  try {
    return build(THREE, quality, fn, S, r.params, r.colors, { kind: r.kind, recipe: r, fallback: fn === buildBox && r.kind !== "other" });
  } catch (e) {
    console.warn("Live Aboard: a piece drawn as a box", r.kind, e);
    return build(THREE, quality, buildBox, S, r.params, r.colors, { kind: r.kind, recipe: r, fallback: true });
  }
}

export function disposePiece(group){
  const res = group && group.userData && group.userData.pieceRes;
  if (!res || res.done) return;
  res.done = true;
  for (const g of res.geos) g.dispose();
  for (const m of res.own) m.dispose();
  for (const e of res.held) release(e);
  res.geos = []; res.own = []; res.held = [];
}

// ── the people figure ────────────────────────────────────────────────────────
// Stylised, Sims-like, never a likeness: height, build, hair, colours, and
// glasses or a cap. No face beyond two dots for eyes, which show where it faces.
export const FIGURE = {
  name: "Person",
  params: [
    num("height_m", "Height", 1.0, 2.1, 0.01, 1.75),
    choice("build", "Build", ["slim", "medium", "broad"], "medium"),
    choice("hair", "Hair", ["none", "short", "long", "bun"], "short"),
    bool("glasses", "Glasses", false),
    bool("hat", "Cap", false),
  ],
  colorNames: { hair: "Hair", skin: "Skin", top: "Top", bottom: "Bottom" },
  colors: { hair: "#3a2a1a", skin: "#c8956d", top: "#224466", bottom: "#333333" },
};

function clampFigure(params){
  const src = isObj(params) ? params : {};
  const out = {};
  for (const s of FIGURE.params) out[s.key] = clampParam(s, src[s.key]);
  const cols = isObj(src.colors) ? src.colors : {};
  out.colors = {};
  for (const [k, c] of Object.entries(FIGURE.colors)) out.colors[k] = hexOf(cols[k]) || c;
  return out;
}

function drawFigure(K, S, p){
  const H = p.height_m, c = p.colors;
  const skin = L(c.skin, "soft"), top = L(c.top, "fabric"), bottom = L(c.bottom, "fabric"), hair = L(c.hair, "soft");
  const shoe = L("#2a2624", "soft"), dark = L("#1d1d1f", "gloss");
  const tw = { slim: 0.2, medium: 0.23, broad: 0.27 }[p.build] * H, td = { slim: 0.12, medium: 0.13, broad: 0.15 }[p.build] * H;
  const legR = tw * 0.17, hip = 0.48 * H, ankle = 0.035 * H;
  for (const s of [-1, 1]) {
    K.cyl(legR, legR * 0.85, hip - ankle, s * tw * 0.24, ankle + (hip - ankle) / 2, 0, bottom, 12);
    K.box(legR * 2.1, ankle, legR * 2 + ankle, s * tw * 0.24, ankle / 2, ankle / 2, shoe, 0.012 * H);
  }
  K.box(tw, 0.08 * H, td, 0, 0.46 * H + 0.04 * H, 0, bottom, 0.03 * H);
  K.box(tw, 0.3 * H, td, 0, 0.5 * H + 0.15 * H, 0, top, 0.035 * H);
  const armR = 0.03 * H, ax = tw / 2 + armR + 0.004 * H;
  for (const s of [-1, 1]) {
    K.cyl(armR, armR * 0.9, 0.18 * H, s * ax, 0.69 * H, 0, top, 10);
    K.cyl(armR * 0.85, armR * 0.75, 0.15 * H, s * ax, 0.525 * H, 0, skin, 10);
    K.ball(0.03 * H, s * ax, 0.445 * H, 0, skin, null, null, 10);
  }
  K.cyl(0.035 * H, 0.04 * H, 0.05 * H, 0, 0.82 * H, 0, skin, 12);
  const hr = 0.075 * H, hy = 0.9 * H;
  K.ball(hr, 0, hy, 0, skin, null, null, 18);
  for (const s of [-1, 1]) K.ball(0.009 * H, s * 0.027 * H, hy + 0.008 * H, hr * 0.93, dark, null, null, 8);
  if (p.hair !== "none") {
    K.ball(hr * 1.07, 0, hy + 0.004 * H, -0.004 * H, hair, null, [-0.45, 0, 0], 18, Math.PI * 0.55);
    if (p.hair === "long") K.box(hr * 1.9, 0.15 * H, 0.035 * H, 0, hy - 0.06 * H, -hr * 0.78, hair, 0.015 * H);
    if (p.hair === "bun") K.ball(0.035 * H, 0, hy + hr * 0.75, -hr * 0.75, hair, null, null, 12);
  }
  if (p.glasses) {
    K.box(hr * 1.5, 0.022 * H, 0.006 * H, 0, hy + 0.008 * H, hr * 0.98, dark);
  }
  if (p.hat) {
    K.ball(hr * 1.1, 0, hy + 0.006 * H, 0, L(c.top, "fabric"), [1, 0.92, 1], [-0.25, 0, 0], 18, Math.PI * 0.48);
    K.box(hr * 1.3, 0.008 * H, hr * 0.8, 0, hy + hr * 0.42, hr * 1.1, L(c.top, "fabric"));
  }
}

export function buildFigure(THREE, params, opts){
  const p = clampFigure(params);
  const quality = opts && opts.quality === "high" ? "high" : "low";
  const H = p.height_m, S = { w: 0.42 * H, d: 0.24 * H, h: H };
  return build(THREE, quality, (K) => drawFigure(K, S, p), S, p, [], { kind: "figure", recipe: p, fallback: false });
}
