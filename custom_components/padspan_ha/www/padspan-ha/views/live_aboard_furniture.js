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
  sofa: kind("Sofa", "furniture", "seating", null, ["Body", "Cushions"], ["#7f8489", "#959a9f"],
    sz([0.6, 3.6, 2.1], [0.6, 1.2, 0.9], [0.55, 1.1, 0.82]), [
      int("seats", "Seats", 1, 4, 3, { sizes: { 1: { width_m: 0.95 }, 2: { width_m: 1.55 }, 3: { width_m: 2.1 }, 4: { width_m: 2.7 } } }),
      choice("arms", "Arms", ["none", "slim", "wide", "rolled"], "slim"),
      num("seat_h_m", "Seat height", 0.3, 0.55, 0.01, 0.44),
      choice("legs", "Legs", ["none", "block", "tapered", "metal"], "tapered"),
      int("cushions", "Back cushions", 0, 4, 3),
    ]),
  bed: kind("Bed", "furniture", "sleeping", null, ["Frame", "Bedding"], ["#9a7656", "#b7c0c8"],
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
  table: kind("Table", "furniture", "tables", null, ["Top", "Legs"], ["#b58e66", "#9c7752"],
    sz([0.4, 3.0, 1.6], [0.4, 1.4, 0.9], [0.35, 1.1, 0.75]), [
      choice("shape", "Shape", ["rectangle", "rounded", "round"], "rectangle", { sizes: { round: { width_m: 1.1, depth_m: 1.1 } } }),
      choice("legs", "Legs", ["four", "pedestal", "trestle"], "four"),
      num("top_t_m", "Top thickness", 0.015, 0.08, 0.005, 0.035),
      bool("apron", "Rail under the top", true),
    ]),
  chair: kind("Chair", "furniture", "seating", null, ["Frame", "Seat"], ["#9c7752", "#c9bba4"],
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
  // The kitchen (2026-11): base units carry their own worktop, so a run of
  // them side by side reads as one; the sink and the hob sit in it. A
  // sink's and a basin's height is up to the top of the tap: the worktop or
  // the rim is lower by the tap (1.2 m of sink is a 0.9 m worktop).
  base_cabinet: kind("Base cabinet", "furniture", "kitchen", null, ["Fronts", "Body", "Worktop"], ["#eae8e3", "#dedbd4", "#8c8780"],
    sz([0.15, 3.0, 0.6], [0.3, 0.9, 0.62], [0.5, 1.1, 0.9]), [
      choice("fronts", "Fronts", ["doors", "drawers", "mixed"], "doors"),
      bool("worktop", "Worktop", true),
      choice("handles", "Handles", ["bar", "knob", "none"], "bar"),
    ]),
  wall_cabinet: kind("Wall cabinet", "furniture", "kitchen", null, ["Fronts", "Body"], ["#eae8e3", "#dedbd4"],
    sz([0.2, 2.4, 0.6], [0.2, 0.6, 0.35], [0.2, 1.2, 0.7]), [
      choice("fronts", "Fronts", ["doors", "glass", "lift-up", "open"], "doors"),
      choice("handles", "Handles", ["bar", "knob", "none"], "bar"),
    ]),
  tall_cabinet: kind("Tall cabinet", "furniture", "kitchen", null, ["Fronts", "Body"], ["#eae8e3", "#dedbd4"],
    sz([0.3, 1.2, 0.6], [0.3, 0.8, 0.62], [1.2, 2.6, 2.1]), [
      choice("fronts", "Fronts", ["doors", "oven", "oven and microwave"], "doors"),
      choice("handles", "Handles", ["bar", "knob", "none"], "bar"),
    ]),
  fridge: kind("Fridge", "furniture", "kitchen", null, ["Body", "Handles"], ["#e9e9e7", "#9aa3ab"],
    sz([0.45, 1.2, 0.6], [0.5, 0.9, 0.66], [0.75, 2.1, 1.85]), [
      choice("style", "Style", ["tall", "double", "under"], "tall", { sizes: {
        tall: { width_m: 0.6, depth_m: 0.66, height_m: 1.85 }, double: { width_m: 0.9, depth_m: 0.72, height_m: 1.78 },
        under: { width_m: 0.6, depth_m: 0.6, height_m: 0.85 } } }),
    ]),
  stove: kind("Stove / hob", "furniture", "kitchen", null, ["Body", "Hob", "Worktop"], ["#eae8e3", "#1b1c1f", "#8c8780"],
    sz([0.3, 1.2, 0.6], [0.45, 0.8, 0.62], [0.6, 1.1, 0.9]), [
      // hob: a hob in the worktop over a built-in oven, in the run's fronts;
      // cooker: a freestanding range with its own top.
      choice("style", "Style", ["hob", "cooker"], "hob"),
      choice("hob", "Hob", ["induction", "gas"], "induction"),
    ]),
  sink: kind("Sink", "furniture", "kitchen", null, ["Fronts", "Body", "Worktop"], ["#eae8e3", "#dedbd4", "#8c8780"],
    sz([0.4, 2.4, 0.8], [0.4, 0.8, 0.62], [0.8, 1.5, 1.2]), [
      int("bowls", "Bowls", 1, 2, 1, { sizes: { 1: { width_m: 0.8 }, 2: { width_m: 1.2 } } }),
      choice("handles", "Handles", ["bar", "knob", "none"], "bar"),
    ]),
  dishwasher: kind("Dishwasher", "furniture", "kitchen", null, ["Front", "Body", "Worktop"], ["#eae8e3", "#dedbd4", "#8c8780"],
    sz([0.45, 0.6, 0.6], [0.5, 0.7, 0.62], [0.75, 1.0, 0.9]), [
      choice("style", "Front", ["built-in", "steel"], "built-in"),
      bool("worktop", "Worktop", true),
    ]),
  // The bathroom (2026-11).
  wc: kind("Toilet", "furniture", "bath", null, ["Ceramic", "Seat"], ["#f5f5f3", "#f5f5f3"],
    sz([0.3, 0.6, 0.38], [0.45, 0.9, 0.68], [0.35, 1.3, 0.8]), [
      // floor: a cistern on the back; wall: hung from a boxed-in frame with a flush plate.
      choice("mount", "Mount", ["floor", "wall"], "floor", { sizes: { floor: { depth_m: 0.68, height_m: 0.8 }, wall: { depth_m: 0.58, height_m: 1.1 } } }),
    ]),
  basin: kind("Basin", "furniture", "bath", null, ["Ceramic", "Cabinet"], ["#f5f5f3", "#b58e66"],
    sz([0.35, 2.0, 0.6], [0.3, 0.65, 0.48], [0.6, 1.3, 1.05]), [
      choice("style", "Style", ["vanity", "pedestal", "wall"], "vanity", { sizes: {
        vanity: { width_m: 0.8, depth_m: 0.48 }, pedestal: { width_m: 0.6, depth_m: 0.46 }, wall: { width_m: 0.55, depth_m: 0.42 } } }),
      int("basins", "Basins", 1, 2, 1, { sizes: { 1: { width_m: 0.8 }, 2: { width_m: 1.4 } } }),
    ]),
  bath: kind("Bath", "furniture", "bath", null, ["Bath", "Panel"], ["#f5f5f3", "#f5f5f3"],
    sz([1.2, 2.2, 1.7], [0.6, 1.2, 0.75], [0.4, 0.8, 0.62]), [
      choice("style", "Style", ["built-in", "freestanding"], "built-in", { sizes: {
        "built-in": { width_m: 1.7, depth_m: 0.75, height_m: 0.62 }, freestanding: { width_m: 1.7, depth_m: 0.8, height_m: 0.68 } } }),
    ]),
  shower: kind("Shower", "furniture", "bath", null, ["Tray", "Frame"], ["#f2f2f0", "#2a2b2e"],
    sz([0.7, 2.0, 0.9], [0.7, 2.0, 0.9], [1.8, 2.5, 2.1]), [
      // enclosure: glass on the front and one side, a door; walk-in: one glass screen.
      choice("style", "Style", ["enclosure", "walk-in"], "enclosure", { sizes: {
        enclosure: { width_m: 0.9, depth_m: 0.9 }, "walk-in": { width_m: 1.4, depth_m: 0.9 } } }),
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
  // Tags and scanners: drawn true to size, lying as they sit (a tag flat,
  // its face up). At house scale they are small; the view may draw the
  // group larger, and their shapes stay readable when it does.
  tag: kind("Tag", "tag", "device", null, ["Body", "Accent"], ["#f4f4f2", "#9aa3ab"],
    sz([0.015, 0.2, 0.032], [0.015, 0.2, 0.032], [0.002, 0.04, 0.008]), [
      choice("form", "Form", ["puck", "card", "fob", "phone"], "puck", { sizes: {
        puck: { width_m: 0.032, depth_m: 0.032, height_m: 0.008 }, card: { width_m: 0.054, depth_m: 0.086, height_m: 0.003 },
        fob: { width_m: 0.035, depth_m: 0.05, height_m: 0.01 }, phone: { width_m: 0.075, depth_m: 0.155, height_m: 0.009 } } }),
    ]),
  scanner: kind("Scanner", "scanner", "device", null, ["Case", "Light"], ["#1f2225", "#3a7bd5"],
    sz([0.02, 0.3, 0.07], [0.01, 0.3, 0.05], [0.004, 0.25, 0.03]), [
      choice("form", "Form", ["box", "board"], "box", { sizes: {
        box: { width_m: 0.07, depth_m: 0.05, height_m: 0.03 }, board: { width_m: 0.055, depth_m: 0.028, height_m: 0.01 } } }),
      bool("antenna", "Antenna", false, { sizes: { true: { height_m: 0.11 } } }),
    ]),
  other: kind("Box", "furniture", "other", null, ["Colour"], [BOX_COLOR], BOX_SIZE, []),
  // Stairs (group "house": Furnish's Build ▾ lists them under House, not the
  // furniture; the photo and import flows never offer them): straight, L, U,
  // two landings (l2) or three (l3); closed, open, treads only or floating. Width and depth
  // are the footprint; the height is the rise, which the view always draws
  // as the gap up to the floor reached (params.to_floor: that floor's id,
  // kept with the shape and the turn; stairFlights lays the steps out).
  // Up to 8 m each way, as the 3D file keeps them (SIZE_MAX_M): an L or a U
  // round a hall can be wider than 4 m (the test home's entrance stairs are
  // 4.09 m), and the floor above is cut at the width they are drawn.
  stairs: kind("Stairs", "house", "other", null, ["Treads", "Sides", "Rail"], ["#8b6a4f", "#e8e2d6", "#3d3a36"],
    sz([0.6, 8, 0.95], [0.6, 8, 3.6], [0.3, 8, 2.8]), [
      choice("shape", "Shape", ["straight", "l", "u", "l2", "l3"], "straight", { sizes: {
        straight: { width_m: 0.95, depth_m: 3.6 }, l: { width_m: 2.0, depth_m: 3.0 }, u: { width_m: 2.0, depth_m: 2.9 },
        l2: { width_m: 2.8, depth_m: 3.0 }, l3: { width_m: 3.0, depth_m: 3.0 } } }),
      choice("turn", "Turns", ["left", "right"], "left"),
      // Closed (solid steps), open (treads on a board each side, nothing
      // between them), treads only (nothing under them, fixed into a wall) or
      // floating (open treads on one steel spine down the middle, fixed at
      // the bottom and the top, nothing on a wall).
      // A style a newer version made (a short lowercase word) is kept as it is
      // and drawn closed (stairFlights), never turned closed by an edit here.
      choice("style", "Style", ["closed", "open", "treads", "floating"], "closed", { keepWord: true }),
      // A new stair has no rail until one is chosen (2026-11-02). auto, what
      // every stair had before, is stamped on read with the rail it drew
      // (house3d_store.stamp_stair_rail), so the file never hands one here;
      // it still draws as it always did (the plain rods closed straight, L
      // and U stairs had, a balustrade on the open side for the rest) for a
      // piece that has not been through the server yet.
      choice("rail", "Rail", ["auto", "both", "inner", "outer", "none"], "none"),
      // Its style: a balustrade (a handrail on spindles, a post at each
      // end), topless (the spindles and posts, no top rail) or a single bar
      // (one bar and nothing under it). A newer version's word is kept and
      // drawn as a balustrade.
      choice("rail_style", "Rail style", ["balustrade", "topless", "single_bar"], "balustrade", { keepWord: true }),
    ]),
};

// The Build menu, in order. Tags and scanners (groups "tag" and "scanner")
// are in FURNITURE for the beacon screen, not here.
export const FURNITURE_KINDS = ["sofa", "bed", "table", "chair", "desk", "dresser", "tv", "lamp", "rug", "shelf", "wardrobe", "plant",
                                "base_cabinet", "wall_cabinet", "tall_cabinet", "sink", "stove", "dishwasher", "fridge",
                                "wc", "basin", "bath", "shower",
                                "washer", "dryer", "vacuum_dock", "mower_dock", "car", "charger", "radiator", "fan", "speaker", "other"];

const defOf = (k) => (typeof k === "string" && Object.prototype.hasOwnProperty.call(FURNITURE, k) ? FURNITURE[k] : null);

// ── recipes ──────────────────────────────────────────────────────────────────
export const STAIR_STYLE_WORD = /^[a-z][a-z_]{0,23}$/;
function clampParam(s, v){
  if (s.type === "choice") {
    if (s.choices.includes(v)) return v;
    if (s.keepWord && typeof v === "string" && STAIR_STYLE_WORD.test(v)) return v;
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
// A sink's and a basin's box goes up to the top of its tap: how far the tap
// stands above the worktop (a basin's rim) in a box H tall. 0 for any other kind.
function tapOf(kind, H){
  if (kind === "sink") return Math.min(0.3, Math.max(0.08, H - 0.8));
  if (kind === "basin") return Math.min(0.2, Math.max(0.06, H - 0.65));
  return 0;
}
/** A sink's worktop or a basin's rim, in metres above its bottom: its Height
 *  less its tap, as drawn. What a window's sill is measured against (the tap
 *  stands in front of the glass; live_aboard_pieces.js sillTop). null for
 *  every other kind. */
export function worktopOf(recipe){
  const r = clampRecipe(recipe);
  return r.kind === "sink" || r.kind === "basin" ? r.height_m - tapOf(r.kind, r.height_m) : null;
}

// ── the starter set ──────────────────────────────────────────────────────────
// Ready-made pieces at the top of Furnish's Build menu (Garry, 2026-10-04:
// "give me some base items to start with, try to recreate what I saw in the
// preview as a starter set"; "I can place, just the tools"). The first two
// are the P0 preview's: its three-seat sofa with rolled arms, and its queen
// bed with a slatted headboard 1.30 m high and a footboard (1.70 × 2.29 m).
// Each is a builder's defaults with a few changes, kept by clampRecipe.
function starter(name, kind, params = {}, size = {}, colors = null){
  const r = defaultRecipe(kind);
  return { name, recipe: clampRecipe({ ...r, params: { ...r.params, ...params }, ...size, colors: colors || r.colors }) };
}
export const STARTER_SET = [
  starter("Sofa, three seats", "sofa", { seats: 3, arms: "rolled" }),
  starter("Queen bed", "bed", { size: "queen", headboard: "slatted", footboard: true, base: "frame" },
    { width_m: 1.7, depth_m: 2.29, height_m: 1.3 }),
  starter("Coffee table", "table", { shape: "rounded", legs: "four", apron: false }, { width_m: 1.1, depth_m: 0.6, height_m: 0.45 }),
  starter("TV and media unit", "tv", { screen_in: 55, unit: "low", mount: "stand" }),
  starter("Floor lamp", "lamp", { style: "floor", shade: "drum", base: "round" }),
  starter("Rug", "rug", { shape: "rectangle", pattern: "border" }, { width_m: 2.4, depth_m: 1.6 }),
  starter("Dining table", "table", { shape: "rectangle", legs: "four" }, { width_m: 1.6, depth_m: 0.9, height_m: 0.75 }),
  starter("Dining chair", "chair", { style: "dining", cushion: true }),
  starter("Bedside table", "dresser", { fronts: "drawers", columns: 1, rows: 2, base: "feet", handles: "knob" },
    { width_m: 0.45, depth_m: 0.4, height_m: 0.55 }),
  starter("Table lamp", "lamp", { style: "table", shade: "drum", base: "round" }, { width_m: 0.3, depth_m: 0.3, height_m: 0.5 }),
  starter("Dresser", "dresser", { fronts: "drawers", columns: 2, rows: 3 }),
  starter("Wardrobe", "wardrobe", { style: "hinged", doors: 2 }),
  starter("Desk", "desk", { legs: "four", drawers: "right" }),
  starter("Office chair", "chair", { style: "office", cushion: true, arms: true }),
  starter("Plant", "plant", { style: "bush", pot: "round" }),
];

// ── room sets ────────────────────────────────────────────────────────────────
// One tap in Furnish's Build ▾ furnishes the room in the middle of the view
// (item 28, after NeonPlan's room packages): rows of pieces along its walls,
// and pieces about the room or beside one of the set. live_aboard_pieces.js
// layoutSet lays them out (inside the room, backs to the walls, past doors
// and windows); this is only what goes in. Plain data: every piece a recipe
// clampRecipe keeps as it is.
const rec = (kind, params = {}, size = {}, colors = null) => starter("", kind, params, size, colors).recipe;
const WALL_UNIT_Z = 1.45;                      // a wall cabinet's bottom, over a 0.9 m worktop
const setRow = (wall, from, items, z = 0) => ({ wall, from, ...(z ? { z } : {}), items: items.map((it) => (it && it.r ? it : { r: it })) });
const wallUnits = (n) => Array.from({ length: n }, () => rec("wall_cabinet"));
const bedside = () => rec("dresser", { fronts: "drawers", columns: 1, rows: 2, base: "feet", handles: "knob" }, { width_m: 0.45, depth_m: 0.4, height_m: 0.55 });
const tableLamp = () => rec("lamp", { style: "table", shade: "drum", base: "round" }, { width_m: 0.3, depth_m: 0.3, height_m: 0.5 });
const bookcase = () => rec("shelf", { style: "bookcase", shelves: 5, books: "some" }, { width_m: 0.8, depth_m: 0.32, height_m: 1.8 });
export const ROOM_SETS = [
  { id: "kitchen_row", name: "Kitchen, one wall", about: "tall units, cabinets, sink, dishwasher and hob in a row, wall cabinets over them",
    rows: [setRow("back", "start", [rec("fridge"), rec("tall_cabinet", { fronts: "oven" }), rec("base_cabinet", { fronts: "drawers" }),
                                    rec("sink"), rec("dishwasher"), rec("stove"), rec("base_cabinet"), rec("base_cabinet")]),
           setRow("back", "start", wallUnits(6), WALL_UNIT_Z)], free: [] },
  { id: "kitchen_l", name: "Kitchen, L-shaped", about: "a run along one wall and round the corner, wall cabinets over them",
    rows: [setRow("back", "end", [rec("base_cabinet", { fronts: "drawers" }), rec("sink"), rec("dishwasher"), rec("tall_cabinet", { fronts: "oven" }), rec("fridge")]),
           setRow("left", "start", [rec("base_cabinet"), rec("stove"), rec("base_cabinet", { fronts: "drawers" }), rec("base_cabinet")]),
           setRow("back", "end", wallUnits(5), WALL_UNIT_Z), setRow("left", "start", wallUnits(4), WALL_UNIT_Z)], free: [] },
  { id: "bathroom", name: "Bathroom", about: "a toilet and a basin on one wall, a bath (or a shower) across from them",
    rows: [setRow("back", "center", [rec("wc"), rec("basin")]),
           setRow("front", "start", [{ r: rec("bath"), alt: [rec("shower")] }])], free: [] },
  { id: "bedroom", name: "Bedroom", about: "a bed between bedside tables with lamps, a wardrobe, a dresser and a rug",
    rows: [setRow("back", "center", [{ r: bedside(), key: "left" }, { r: rec("bed"), key: "bed" }, { r: bedside(), key: "right" }]),
           setRow("left", "center", [rec("wardrobe")]), setRow("front", "center", [rec("dresser")])],
    free: [{ r: tableLamp(), rel: "left", on: true }, { r: tableLamp(), rel: "right", on: true },
           { r: rec("rug", { pattern: "plain" }, { width_m: 2.0, depth_m: 1.4 }), rel: "bed", off: [0, 0.8] }] },
  { id: "living", name: "Living room", about: "a TV unit, a sofa across from it with a coffee table and a rug, an armchair, a lamp, shelves and a plant",
    rows: [setRow("back", "center", [{ r: rec("tv"), key: "tv" }]),
           setRow("front", "center", [rec("lamp"), { r: rec("sofa"), key: "sofa" }, rec("plant")]),
           setRow("left", "center", [rec("chair", { style: "armchair", arms: true }, { width_m: 0.85, depth_m: 0.85, height_m: 0.85 })]),
           setRow("right", "center", [bookcase()])],
    free: [{ r: rec("table", { shape: "rounded", legs: "four", apron: false }, { width_m: 1.1, depth_m: 0.6, height_m: 0.42 }), rel: "sofa", off: [0, 1.15] },
           { r: rec("rug", { pattern: "border" }, { width_m: 2.4, depth_m: 1.6 }), rel: "sofa", off: [0, 1.2] }] },
  { id: "dining", name: "Dining room", about: "a table for four or six with its chairs, and a sideboard",
    rows: [setRow("back", "center", [rec("dresser", { fronts: "doors", columns: 3, rows: 1, base: "legs", handles: "knob" }, { width_m: 1.6, depth_m: 0.45, height_m: 0.75 })])],
    free: [{ r: rec("table", { shape: "rectangle", legs: "four" }, { width_m: 1.6, depth_m: 0.9, height_m: 0.75 }), key: "table", at: [0.5, 0.55], face: "front" },
           ...[-0.4, 0.4].flatMap((x) => [{ r: rec("chair", { cushion: true }), rel: "table", off: [x, 0.72], face: "away" },
                                          { r: rec("chair", { cushion: true }), rel: "table", off: [x, -0.72], face: "same" }]),
           { r: rec("chair", { cushion: true }), rel: "table", off: [-1.1, 0], face: "anchor" },
           { r: rec("chair", { cushion: true }), rel: "table", off: [1.1, 0], face: "anchor" }] },
  { id: "office", name: "Office", about: "a desk and its chair, two bookcases and a plant",
    rows: [setRow("back", "center", [{ r: rec("desk"), key: "desk" }]), setRow("left", "center", [bookcase(), bookcase()]),
           setRow("right", "end", [rec("plant")])],
    free: [{ r: rec("chair", { style: "office", cushion: true, arms: true }), rel: "desk", off: [0, 0.72], face: "away" }] },
];

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
// A plan shape's outline as points, counter-clockwise, never repeating a
// point (a near-repeat where an outline closes makes a crumpled bevel): an
// ellipse in n points, or a rectangle with corners rounded in m steps.
function outline(THREE, form, w, d, r, n, m){
  const pts = [];
  if (form === "ellipse") {
    for (let i = 0; i < n; i++) pts.push(new THREE.Vector2(Math.cos(i * 2 * Math.PI / n) * w / 2, Math.sin(i * 2 * Math.PI / n) * d / 2));
    return pts;
  }
  const cx = w / 2 - r, cy = d / 2 - r;
  for (const [sx, sy, a0] of [[1, -1, -Math.PI / 2], [1, 1, 0], [-1, 1, Math.PI / 2], [-1, -1, Math.PI]]) {
    if (r < 1e-4) { pts.push(new THREE.Vector2(sx * w / 2, sy * d / 2)); continue; }
    for (let k = 0; k <= m; k++) {
      const a = a0 + k * Math.PI / 2 / m;
      pts.push(new THREE.Vector2(sx * cx + Math.cos(a) * r, sy * cy + Math.sin(a) * r));
    }
  }
  return pts;
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

// A closed outline with its corners rounded: pts [[a, b, r], ...], r that
// corner's radius (0 or none: sharp), each rounded in n steps. Never repeats
// a point (a repeat makes a crumpled bevel).
function roundedPath(pts, n){
  const out = [], N = pts.length;
  const add = (x, y) => { const l = out[out.length - 1]; if (!l || Math.hypot(l[0] - x, l[1] - y) > 1e-4) out.push([x, y]); };
  for (let i = 0; i < N; i++) {
    const a = pts[(i + N - 1) % N], b = pts[i], c = pts[(i + 1) % N];
    const ab = Math.hypot(b[0] - a[0], b[1] - a[1]), bc = Math.hypot(c[0] - b[0], c[1] - b[1]);
    const r = Math.min(b[2] || 0, ab * 0.45, bc * 0.45);
    if (!(r > 1e-4) || n < 1) { add(b[0], b[1]); continue; }
    const p0 = [b[0] + (a[0] - b[0]) / ab * r, b[1] + (a[1] - b[1]) / ab * r], p1 = [b[0] + (c[0] - b[0]) / bc * r, b[1] + (c[1] - b[1]) / bc * r];
    for (let k = 0; k <= n; k++) {
      const u = k / n, v = 1 - u;
      add(v * v * p0[0] + 2 * v * u * b[0] + u * u * p1[0], v * v * p0[1] + 2 * v * u * b[1] + u * u * p1[1]);
    }
  }
  return out;
}
// Normals for a faceted shape (an extrusion, which has none shared): faces
// that meet at less than deg blend into one curve, a sharper edge stays an
// edge. Bigger faces weigh more.
function creaseNormals(THREE, g, deg){
  const p = g.attributes.position, n = p.count, cosT = Math.cos(deg * Math.PI / 180);
  const fn = new Float32Array(n * 3), un = new Float32Array(n * 3);
  for (let i = 0; i + 2 < n; i += 3) {
    const ax = p.getX(i), ay = p.getY(i), az = p.getZ(i);
    const ux = p.getX(i + 1) - ax, uy = p.getY(i + 1) - ay, uz = p.getZ(i + 1) - az;
    const vx = p.getX(i + 2) - ax, vy = p.getY(i + 2) - ay, vz = p.getZ(i + 2) - az;
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx, len = Math.hypot(nx, ny, nz) || 1;
    for (let k = 0; k < 3; k++) {
      const o = (i + k) * 3;
      fn[o] = nx; fn[o + 1] = ny; fn[o + 2] = nz;
      un[o] = nx / len; un[o + 1] = ny / len; un[o + 2] = nz / len;
    }
  }
  const at = new Map();
  for (let i = 0; i < n; i++) {
    const key = Math.round(p.getX(i) * 1e4) + "," + Math.round(p.getY(i) * 1e4) + "," + Math.round(p.getZ(i) * 1e4);
    let l = at.get(key);
    if (!l) at.set(key, l = []);
    l.push(i);
  }
  const out = new Float32Array(n * 3);
  for (const l of at.values()) for (const i of l) {
    let x = 0, y = 0, z = 0;
    for (const j of l) {
      if (un[i * 3] * un[j * 3] + un[i * 3 + 1] * un[j * 3 + 1] + un[i * 3 + 2] * un[j * 3 + 2] < cosT) continue;
      x += fn[j * 3]; y += fn[j * 3 + 1]; z += fn[j * 3 + 2];
    }
    const len = Math.hypot(x, y, z) || 1;
    out[i * 3] = x / len; out[i * 3 + 1] = y / len; out[i * 3 + 2] = z / len;
  }
  g.setAttribute("normal", new THREE.BufferAttribute(out, 3));
  return g;
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
  satin:  { r: 0.5, m: 0 },
  soft:   { r: 0.75, m: 0 },
  glass:  { r: 0.08, m: 0, op: 0.28 },  // a shower's screen: see-through, on Low too
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
function noise(x, y, period, seed, periodY = period){
  const xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi;
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  const at = (i, j) => hash2(((i % period) + period) % period, ((j % periodY) + periodY) % periodY, seed);
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
        // A fine, straight grain along u that wanders a little, low in
        // contrast, like a sanded oak board (2026-11: the wide wavy rings
        // there were read as cardboard on a wardrobe's doors).
        const ring = v * 18 + 0.45 * noise(u * 2, v * 3, 2, 1, 3) + 0.12 * noise(u * 8, v * 8, 8, 2);
        const band = Math.pow(0.5 + 0.5 * Math.cos(2 * Math.PI * ring), 4);
        t = 0.87 + 0.06 * (1 - band) + 0.07 * noise(u * 4, v * 32, 4, 3, 32);
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
    if (F.op) { res.transparent = true; res.opacity = F.op; res.depthWrite = false; }
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
      const r = Math.max(0, Math.min(corner, w / 2 - 1e-3, d / 2 - 1e-3));
      const shape = new THREE.Shape(outline(THREE, form, w, d, r, hi ? 32 : 16, hi ? 6 : 3));
      const bt = Math.min(bevel, t / 3, w / 4, d / 4);
      const g = new THREE.ExtrudeGeometry(shape, { depth: Math.max(t - 2 * bt, 1e-4), bevelEnabled: bt > 1e-4, bevelThickness: bt,
        bevelSize: bt, bevelSegments: 1 });
      g.rotateX(-Math.PI / 2);
      g.clearGroups();
      add(look, place(THREE, scaleUv(fitBox(g, w, t, d), 1 / TILE, 1 / TILE), x, y + t / 2, z));
    },
    // A round bar of radius r from point a to point b (r2 at b: a tapered
    // leg, thinner at its foot).
    rod(a, b, r, look, seg = 8, r2 = r){
      const v = new THREE.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]), len = v.length();
      const n = Math.max(5, Math.round(hi ? seg : seg * 0.6));
      const g = scaleUv(new THREE.CylinderGeometry(r2, r, len, n, 1, false), 2 * Math.PI * Math.max(r, r2) / TILE, len / TILE);
      g.clearGroups();
      const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), v.normalize());
      add(look, place(THREE, g, (a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2, q));
    },
    // A ring of radius rad around its own z axis, its tube tube thick.
    torus(rad, tube, x, y, z, look, rot = null){
      const g = scaleUv(new THREE.TorusGeometry(rad, tube, hi ? 10 : 6, hi ? 32 : 16), 2 * Math.PI * tube / TILE, 2 * Math.PI * rad / TILE);
      add(look, place(THREE, g, x, y, z, rot));
    },
    // A side view pulled across the width: pts [[z, y], ...] the outline seen
    // from the side, w wide, centred on x, its long edges softened by bevel.
    // taper(y, z) is the share of the width kept at that point (a cabin
    // narrower at the roof, a nose narrower than the doors).
    prism(pts, w, x, y, z, look, bevel = 0.02, taper = null, crease = 42){
      const bt = Math.max(0, Math.min(bevel, w / 4)), depth = Math.max(w - 2 * bt, 1e-4);
      let g = new THREE.ExtrudeGeometry(new THREE.Shape(pts.map((q) => new THREE.Vector2(q[0], q[1]))), { depth, bevelEnabled: bt > 1e-4,
        bevelThickness: bt, bevelSize: bt, bevelOffset: -bt, bevelSegments: hi ? 3 : 1, curveSegments: 1 });
      if (g.index) g = g.toNonIndexed();
      g.translate(0, 0, -depth / 2);
      g.rotateY(-Math.PI / 2);
      g.clearGroups();
      if (taper) { const a = g.attributes.position; for (let i = 0; i < a.count; i++) a.setX(i, a.getX(i) * taper(a.getY(i), a.getZ(i))); }
      creaseNormals(THREE, g, crease);
      add(look, place(THREE, scaleUv(g, 1 / TILE, 1 / TILE), x, y, z));
    },
    // A turned shape: prof [[radius, y], ...] from the bottom up, round its
    // own y axis, drawn as one smooth curve through those points and closed
    // on the axis at both ends. scl flattens it (a body is wider than deep).
    lathe(prof, x, y, z, look, seg = 12, scl = null, rot = null){
      const n = Math.max(6, Math.round(hi ? seg : seg * 0.6));
      const curve = new THREE.SplineCurve(prof.map((q) => new THREE.Vector2(q[0], q[1]))).getPoints(hi ? Math.round(prof.length * 1.6) : prof.length - 1);
      const y0 = prof[0][1], y1 = prof[prof.length - 1][1];
      const pts = [new THREE.Vector2(1e-5, y0), ...curve.map((v) => new THREE.Vector2(Math.max(v.x, 1e-5), clamp(v.y, y0, y1))), new THREE.Vector2(1e-5, y1)];
      let r = 0;
      for (const v of pts) r = Math.max(r, v.x);
      const g = scaleUv(new THREE.LatheGeometry(pts, n), 2 * Math.PI * r / TILE, Math.max(y1 - y0, 1e-3) / TILE);
      add(look, place(THREE, g, x, y, z, rot, scl));
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

// ── the modern look (2026-11) ────────────────────────────────────────────────
// One language for every piece (2026-11-18: "improve the default
// furniture, more modern"): low and slim; thin round legs that taper to the
// floor, set in from the corners, or a dark plinth set back under the front
// so a cabinet seems to float; thin tops with softly rounded edges; fronts
// flush, with thin dark gaps between them, and slim pulls.
const BLACK = "#2a2b2e", PLINTH = "#1c1b1a";
/** A slim round leg from the floor up to y at (x, z): r at the top, k × r
 *  at the foot, the foot pushed out by `out` m toward (sx, sz) (a splay).
 *  Its foot's rim stays on the floor and inside where it stands. */
function leg(K, x, z, y, r, look, k = 0.6, out = 0, sx = 0, sz = 0){
  const fx = x + sx * out, fz = z + sz * out, tilt = Math.atan2(Math.hypot(sx * out, sz * out), y);
  const lift = r * k * Math.sin(tilt) + 1e-4;
  K.rod([fx, lift, fz], [x, y, z], r * k, look, 10, r);
}
/** A plinth set back under a carcass whose front is at zFront and back at
 *  zBack: `y` high, `back` m in from the front, `side` m in at each end. */
function plinth(K, w, zBack, zFront, y, back = 0.05, side = 0.015){
  const d = zFront - back - zBack - 0.01;
  if (y > 0.004 && d > 0.02 && w > 2 * side + 0.02) K.box(w - 2 * side, y, d, 0, y / 2, zBack + 0.01 + d / 2, L(PLINTH));
}

// ── stairs ───────────────────────────────────────────────────────────────────
// Climbing from the front (+z) toward the back (−z) of the footprint. A
// straight flight fills it; an L runs up one side, across a landing in the
// back corner and along the back toward its turn; a U runs up one half,
// across a landing the whole width, and back down the plan on the other
// half. Two landings (l2): up one side, a landing in the back corner, across
// the back, a landing in the other corner, and down the other side to the
// front. Three landings (l3): the same, then a landing in the front corner
// and along the front, over the start of the first flight (high enough to
// walk under), off at the side it started from: a flight round an open well.
// Each riser at most STAIR_RISER_M; the last one steps onto the floor above,
// at the footprint's edge (where the view cuts its opening).
export const STAIR_RISER_M = 0.19, STAIR_RAIL_M = 0.9;
export const STAIR_SHAPES = ["straight", "l", "u", "l2", "l3"];
export const STAIR_STYLES = ["closed", "open", "treads", "floating"];
export const STAIR_RAILS = ["auto", "both", "inner", "outer", "none"];
export const STAIR_RAIL_STYLES = ["balustrade", "topless", "single_bar"];
/** The steps, as numbers, in the piece's own frame (x across, z to the
 *  front, y up; metres): {risers, riser, steps: [{x0, z0, x1, z1, h, y0}]
 *  (each a block from y0, the floor unless a flight below runs under it, up
 *  to h), landings (the same), flights: [{s, d, L, w, b, top, n}] (each run's
 *  middle at the bottom, its direction, length, width, its first and last
 *  tread's heights, its risers), rails: [[a, b]] ([x, y, z] each; none for
 *  a topless rail), balusters ([[a, b]], spindles and posts, with rails a
 *  proper balustrade, or [] for the plain rods closed stairs have always had
 *  and a single bar), look (the rail_style drawn), exit: {x, z, dx, dz} (where
 *  you step off at the top, and which way), path: [[x, y, z]] (up the
 *  middle, bottom to top)}. */
export function stairFlights(S, p){
  const W = Math.max(0.3, S.w), D = Math.max(0.3, S.d), R = Math.max(0.05, S.h);
  const shape = p && STAIR_SHAPES.includes(p.shape) ? p.shape : "straight", sx = p && p.turn === "right" ? -1 : 1;
  const style = p && STAIR_STYLES.includes(p.style) ? p.style : "closed";
  const railP = p && STAIR_RAILS.includes(p.rail) ? p.rail : "auto";
  const look = p && STAIR_RAIL_STYLES.includes(p.rail_style) ? p.rail_style : "balustrade";
  const many = shape === "l2" || shape === "l3";
  const nFl = shape === "straight" ? 1 : shape === "l2" ? 3 : shape === "l3" ? 4 : 2;
  const N = Math.max(2 * nFl, Math.ceil(R / STAIR_RISER_M - 1e-9)), r = R / N;
  // The plain rods (one rod each side, a post at each end) stay what closed
  // straight, L and U stairs have always drawn on auto, and are what a
  // single bar is (2026-11-02); a balustrade or a topless rail stands its
  // full height on spindles.
  const plain = look === "single_bar" || (look === "balustrade" && style === "closed" && !many && railP === "auto");
  // Which sides get a rail, +1 right of the way up, −1 left. The inside of a
  // turn (the well) is the side it turns to: −sx. Auto on a floating stair:
  // both sides, as on a straight flight (it stands clear of any wall).
  const rs = shape === "straight" ? 1 : sx;                // a straight flight: inner is its left, whichever way "turn" says
  const sides = railP === "none" ? [] : railP === "both" ? [1, -1] : railP === "inner" ? [-rs] : railP === "outer" ? [rs]
    : shape === "straight" || style === "floating" ? [1, -1] : plain ? [sx] : [-sx];
  const steps = [], landings = [], rails = [], balusters = [], path = [], flights = [];
  // One flight: from s (its middle at the bottom) along d for L metres, w
  // wide, n risers from height b; the last riser at its far end.
  const flight = (s, d, L, w, n, b) => {
    const across = [-d[1], d[0]], at = (t, a) => [s[0] + d[0] * t + across[0] * a, s[1] + d[1] * t + across[1] * a];
    const ts = n >= 2 ? Array.from({ length: n }, (_, j) => L * j / (n - 1)) : [0, L];
    const treads = n >= 2 ? n - 1 : 1;
    for (let j = 0; j < treads; j++) {
      const p0 = at(ts[j], -w / 2), p1 = at(ts[j + 1] ?? L, w / 2);
      steps.push({ x0: Math.min(p0[0], p1[0]), z0: Math.min(p0[1], p1[1]), x1: Math.max(p0[0], p1[0]), z1: Math.max(p0[1], p1[1]), h: b + (j + 1) * r, y0: 0, ax: d[0] === 0 ? "z" : "x" });
    }
    const top = b + treads * r;
    flights.push({ s, d, L, w, b, top, n, at });
    const s0 = at(0, 0), s1 = at(L, 0);
    path.push([s0[0], b, s0[1]], [s1[0], top, s1[1]]);
    return top;
  };
  // Risers shared out by each flight's length, at least two each.
  const share = (Ls) => {
    const tot = Ls.reduce((a, x) => a + x, 0), n = Ls.map((x) => Math.max(2, Math.round(N * x / tot)));
    let diff = N - n.reduce((a, x) => a + x, 0);
    for (let i = 0; diff !== 0 && i < 400; i++) {
      const k = i % n.length;
      if (diff > 0) { n[k]++; diff--; } else if (n[k] > 2) { n[k]--; diff++; }
    }
    return n;
  };
  const corner = (side, back, f, h) => {
    // The f × f square in a corner: side +sx (where it starts) or −sx, back or front.
    const xa = side > 0 ? W / 2 - f : -W / 2, za = back ? -D / 2 : D / 2 - f;
    landings.push({ x0: xa, z0: za, x1: xa + f, z1: za + f, h, y0: 0 });
  };
  let exit;
  if (shape === "straight") {
    flight([0, D / 2], [0, -1], D, W, N, 0);
    exit = { x: 0, z: -D / 2, dx: 0, dz: -1 };
  } else if (shape === "l") {
    const f = Math.min(W, D) / 2, L1 = D - f, L2 = W - f;
    const n1 = Math.min(N - 1, Math.max(1, Math.round(N * L1 / (L1 + L2)))), n2 = N - n1;
    // Turning left (sx 1): up the right side, then along the back to the left.
    flight([sx * (W / 2 - f / 2), D / 2], [0, -1], L1, f, n1, 0);
    landings.push({ x0: sx > 0 ? W / 2 - f : -W / 2, z0: -D / 2, x1: sx > 0 ? W / 2 : -W / 2 + f, z1: -D / 2 + f, h: n1 * r, y0: 0 });
    path.push([sx * (W / 2 - f / 2), n1 * r, -D / 2 + f / 2]);
    flight([sx * (W / 2 - f), -D / 2 + f / 2], [-sx, 0], L2, f, n2, n1 * r);
    exit = { x: -sx * W / 2, z: -D / 2 + f / 2, dx: -sx, dz: 0 };
  } else if (shape === "u") {
    const f = Math.min(W / 2, D / 2), L1 = D - f;
    const n1 = Math.min(N - 1, Math.max(1, Math.round(N / 2))), n2 = N - n1;
    // Turning left (sx 1): up the right half, across the back, down the plan on the left half.
    flight([sx * W / 4, D / 2], [0, -1], L1, W / 2, n1, 0);
    landings.push({ x0: -W / 2, z0: -D / 2, x1: W / 2, z1: -D / 2 + f, h: n1 * r, y0: 0 });
    path.push([sx * W / 4, n1 * r, -D / 2 + f / 2], [-sx * W / 4, n1 * r, -D / 2 + f / 2]);
    flight([-sx * W / 4, -D / 2 + f], [0, 1], L1, W / 2, n2, n1 * r);
    exit = { x: -sx * W / 4, z: D / 2, dx: 0, dz: 1 };
  } else {
    // Two or three landings, each a square in a corner, the flights f wide
    // round the edge of the footprint (the middle left open: the well).
    const f = Math.min(1.1, shape === "l2" ? Math.min(W / 3, D / 2) : Math.min(W, D) / 3);
    const Ls = shape === "l2" ? [D - f, W - 2 * f, D - f] : [D - f, W - 2 * f, D - 2 * f, W - f];
    const n = share(Ls.map((x) => Math.max(0.2, x)));
    let h = 0;
    h = flight([sx * (W / 2 - f / 2), D / 2], [0, -1], Ls[0], f, n[0], h) + r;
    corner(sx, true, f, h); path.push([sx * (W / 2 - f / 2), h, -D / 2 + f / 2]);
    h = flight([sx * (W / 2 - f), -D / 2 + f / 2], [-sx, 0], Ls[1], f, n[1], h) + r;
    corner(-sx, true, f, h); path.push([-sx * (W / 2 - f / 2), h, -D / 2 + f / 2]);
    h = flight([-sx * (W / 2 - f / 2), -D / 2 + f], [0, 1], Ls[2], f, n[2], h) + r;
    if (shape === "l2") {
      exit = { x: -sx * (W / 2 - f / 2), z: D / 2, dx: 0, dz: 1 };
    } else {
      corner(-sx, false, f, h); path.push([-sx * (W / 2 - f / 2), h, D / 2 - f / 2]);
      flight([-sx * (W / 2 - f), D / 2 - f / 2], [sx, 0], Ls[3], f, n[3], h);
      exit = { x: sx * W / 2, z: D / 2 - f / 2, dx: sx, dz: 0 };
      // The last flight passes over the first one's start: there its steps
      // are a slab under the tread, not a block down to the floor.
      const lowSteps = steps.slice(0, n[0] - 1);
      for (const st of steps) {
        const under = lowSteps.filter((q) => q !== st && q.h < st.h - 0.6 && q.x0 < st.x1 - 1e-6 && q.x1 > st.x0 + 1e-6 && q.z0 < st.z1 - 1e-6 && q.z1 > st.z0 + 1e-6);
        if (under.length) st.y0 = Math.max(st.h - 0.28, ...under.map((q) => q.h + 0.05));
      }
    }
  }
  path.push([exit.x, R, exit.z]);
  // ── rails ──
  // The plain rods stay under the top (inside the stairs' box), as always.
  // A balustrade stands its full height: on the upper flights that is above
  // the floor reached, in its opening, as a real one does.
  const Rr = plain ? R - 0.03 : Infinity;
  const nos = 0.03;
  for (const F of flights) {
    const y0 = F.b + r + STAIR_RAIL_M, y1 = F.top + STAIR_RAIL_M, t1 = F.L - nos;
    const tEnd = y1 > Rr ? Math.max(nos, nos + (t1 - nos) * (Rr - y0) / Math.max(1e-6, y1 - y0)) : t1;
    if (y0 >= Rr || F.L < 0.1) continue;
    const yAt = (t) => y0 + (y1 - y0) * (t - nos) / Math.max(1e-6, t1 - nos);
    for (const side of sides) {
      const off = side * (F.w / 2 - 0.04);
      const a = F.at(nos, off), e = F.at(tEnd, off);
      rails.push([[a[0], y0, a[1]], [e[0], yAt(tEnd), e[1]]]);
      if (plain) continue;
      // A spindle on each tread under the rail, and a post at each end of the flight.
      const nT = F.n >= 2 ? F.n - 1 : 1;
      for (let j = 0; j < nT; j++) {
        const t = F.L * (j + 0.5) / nT;
        if (t > tEnd) break;
        const q = F.at(t, off), yb = F.b + (j + 1) * r;
        balusters.push([[q[0], yb, q[1]], [q[0], yAt(t), q[1]], 0.011]);
      }
      // (Posts 7 cm square, set in so they stay inside the footprint.) A
      // flight after a landing has its own at its foot too: its rail starts
      // a riser above the landing's, and no rail ends in the air.
      const pa = F.at(0.045, off), te = Math.min(tEnd, F.L - 0.045), pe = F.at(te, off);
      balusters.push([[pa[0], F.b, pa[1]], [pa[0], Math.min(Rr, yAt(0.045) + 0.08), pa[1]], 0.035]);
      balusters.push([[pe[0], F.b + (te / F.L) * (F.top - F.b), pe[1]], [pe[0], Math.min(Rr, yAt(te) + 0.08), pe[1]], 0.035]);
    }
  }
  // Round each landing: its outside edges get a rail when the outside does
  // (the well side's corner already has the flight's end post).
  if (!plain) {
    for (const Lg of landings) {
      const yR = Lg.h + STAIR_RAIL_M;
      if (yR <= Lg.h + 0.1) continue;
      if (sides.includes(sx)) {
        // Outside edges: the two that are the footprint's own sides.
        const cx = (Lg.x0 + Lg.x1) / 2, cz = (Lg.z0 + Lg.z1) / 2;
        const ex = cx > 0 ? Lg.x1 - 0.04 : Lg.x0 + 0.04, ez = cz > 0 ? Lg.z1 - 0.04 : Lg.z0 + 0.04;
        const other = cx > 0 ? Lg.x0 + 0.04 : Lg.x1 - 0.04, otherZ = cz > 0 ? Lg.z0 + 0.04 : Lg.z1 - 0.04;
        if (shape === "u") {
          rails.push([[Lg.x0 + 0.04, yR, ez], [Lg.x1 - 0.04, yR, ez]]);
        } else {
          rails.push([[ex, yR, otherZ], [ex, yR, ez]], [[other, yR, ez], [ex, yR, ez]]);
          balusters.push([[ex, Lg.h, ez], [ex, Math.min(Rr, yR + 0.08), ez], 0.035]);
        }
        const mine = rails.slice(-(shape === "u" ? 1 : 2));
        for (const [a, b] of mine) {
          const len = Math.hypot(b[0] - a[0], b[2] - a[2]), k = Math.max(1, Math.round(len / 0.12));
          for (let j = 1; j < k; j++) balusters.push([[a[0] + (b[0] - a[0]) * j / k, Lg.h, a[2] + (b[2] - a[2]) * j / k], [a[0] + (b[0] - a[0]) * j / k, yR, a[2] + (b[2] - a[2]) * j / k], 0.011]);
        }
        // Each end meets a post, as the corner's does: a flight's post at
        // its head or foot, a few cm on (the rail runs on to it, the post
        // rises to it), else one of its own. The rail stopped short of the
        // flight's post, a riser above its top, a loose end in the air.
        for (const R of mine) for (const k of [0, 1]) {
          const q = R[k], near = balusters.filter(B => B[2] >= 0.03).map(B => ({ B, d: Math.hypot(B[0][0] - q[0], B[0][2] - q[2]) })).sort((u, v) => u.d - v.d)[0];
          if (near && near.d <= 0.15) {
            R[k] = [near.B[0][0], q[1], near.B[0][2]];
            near.B[1] = [near.B[1][0], Math.max(near.B[1][1], Math.min(Rr, yR + 0.08)), near.B[1][2]];
          } else balusters.push([[q[0], Lg.h, q[2]], [q[0], Math.min(Rr, yR + 0.08), q[2]], 0.035]);
        }
      }
    }
  }
  const wallSide = sides.includes(rs) && !sides.includes(-rs) ? -rs : rs;
  if (look === "topless") rails.length = 0;                 // the spindles and posts stand with no top rail
  return { risers: N, riser: r, rise: R, shape, style, look, wallSide, plain, steps, landings, flights: flights.map(({ at, ...F }) => F), rails, balusters, exit, path };
}
function buildStairs(K, S, p, C){
  const L0 = stairFlights(S, p), tread = L(C[0], "wood"), side = L(C[1]), rail = L(C[2] || "#3d3a36", "metal");
  if (L0.style === "closed") {
    const T = Math.min(0.035, L0.riser * 0.4);
    for (const b of [...L0.steps, ...L0.landings]) {
      const w = b.x1 - b.x0, d = b.z1 - b.z0, y0 = b.y0 || 0;
      if (w < 1e-3 || d < 1e-3 || b.h - y0 < 1e-3) continue;
      K.box(w, Math.max(0.002, b.h - T - y0), d, (b.x0 + b.x1) / 2, y0 + (b.h - T - y0) / 2, (b.z0 + b.z1) / 2, side);
      K.box(w, T, d, (b.x0 + b.x1) / 2, b.h - T / 2, (b.z0 + b.z1) / 2, tread);
    }
  } else {
    // Open: the treads alone with a gap under each (open risers), on a board
    // each side of every flight. Treads only: no boards, nothing under them.
    // Floating: the treads alone on one spine down the middle (stairSpine).
    const T = Math.min(0.045, L0.riser * 0.35);
    for (const b of L0.steps) {
      const w = b.x1 - b.x0, d = b.z1 - b.z0;
      if (w < 1e-3 || d < 1e-3) continue;
      // A tread, a little in from the boards at its ends.
      const inset = L0.style === "open" ? 0.05 : 0.01;
      K.box(b.ax === "z" ? w - 2 * inset : w, T, b.ax === "z" ? d : d - 2 * inset, (b.x0 + b.x1) / 2, b.h - T / 2, (b.z0 + b.z1) / 2, tread);
    }
    for (const b of L0.landings) {
      const w = b.x1 - b.x0, d = b.z1 - b.z0, LT = Math.max(T, 0.06);
      K.box(w, LT, d, (b.x0 + b.x1) / 2, b.h - LT / 2, (b.z0 + b.z1) / 2, tread);
      // An open stair's landing stands on a post in its outside corner.
      if (L0.style === "open" && b.h > LT + 0.05) {
        const cx = (b.x0 + b.x1) / 2, cz = (b.z0 + b.z1) / 2;
        const px = cx > 0 ? b.x1 - 0.05 : b.x0 + 0.05, pz = cz > 0 ? b.z1 - 0.05 : b.z0 + 0.05;
        K.box(0.08, b.h - LT, 0.08, px, (b.h - LT) / 2, pz, side);
      }
    }
    if (L0.style === "floating") stairSpine(K, L0, T, rail);
    else {
      // The boards (stringers): along each side of an open flight, from the
      // floor or landing at its foot up to the landing or floor at its head.
      // Treads only: one thin board on the wall side, what they're fixed to.
      const open = L0.style === "open", wall = L0.wallSide;
      for (const F of L0.flights) {
        // Foot to head: the flight's risers (its last one steps onto the landing or floor).
        const rise = Math.max(1, F.n) * L0.riser, run = F.L, ang = Math.atan2(rise, run), sn = Math.sin(ang), cs = Math.cos(ang);
        const hB = Math.min(0.22, rise * 0.6), tB = open ? 0.04 : 0.02;
        if (run < 0.1 || rise < 0.05) continue;
        // Long enough to reach from foot to head, short enough to stay inside the box.
        const len = Math.max(0.1, Math.min((rise - hB * cs) / sn, (run - hB * sn) / cs));
        const midT = run / 2, midY = F.b + rise / 2;
        const across = [-F.d[1], F.d[0]];
        for (const sd of open ? [1, -1] : [wall]) {
          const off = sd * (F.w / 2 - tB / 2);
          const cx = F.s[0] + F.d[0] * midT + across[0] * off, cz = F.s[1] + F.d[1] * midT + across[1] * off;
          if (F.d[0] === 0) K.box(tB, hB, len, cx, midY, cz, side, 0, [F.d[1] < 0 ? ang : -ang, 0, 0]);
          else K.box(len, hB, tB, cx, midY, cz, side, 0, [0, 0, F.d[0] > 0 ? ang : -ang]);
        }
      }
    }
  }
  // Railings hidden on this screen (Live Aboard's ⋯ list, p.rails_shown false): no rail, spindle or post.
  if (p && p.rails_shown === false) return;
  for (const [a, b] of L0.rails) {
    K.rod(a, b, L0.balusters.length ? 0.025 : 0.02, rail);
    if (!L0.balusters.length) for (const q of [a, b]) K.rod([q[0], q[1] - STAIR_RAIL_M, q[2]], q, 0.015, rail);
  }
  // At low quality every second spindle (every third on a long flight); posts all.
  const stride = K.hi ? 1 : L0.risers > 14 ? 3 : 2;
  let nth = 0;
  for (const [a, b, rad] of L0.balusters) {
    if (b[1] - a[1] < 0.02) continue;
    if (rad < 0.02 && nth++ % stride) continue;
    K.box(rad * 2, b[1] - a[1], rad * 2, a[0], (a[1] + b[1]) / 2, a[2], rail);
  }
}

// Floating stairs: one steel spine under the middle of each flight, sloped
// as the treads climb, a bracket under each tread (high quality; a post to
// the floor under any the spine has not reached yet, always), a beam under
// each landing from where the flight below ends to where the next one
// leaves, reaching down to meet the spine, and a plate on the floor where
// the first flight stands: fixed at the bottom and the top, nothing on a
// wall. Nothing shows through a tread from above. All of it inside the
// stairs' box, none of it under the floor they stand on.
function stairSpine(K, L0, T, mat){
  const r = L0.riser, LT = Math.max(T, 0.06), FL = L0.flights;
  const bH = Math.min(0.1, Math.max(0.02, r * 0.55));            // the spine's depth
  const gap = Math.max(0.01, r / 2 - T + 0.01);                  // its top to a tread's middle: clear of the tread's back edge
  const ends = [];
  for (const [i, F] of FL.entries()) {
    const bW = Math.min(0.12, Math.max(0.05, F.w * 0.12));
    const nT = F.n >= 2 ? F.n - 1 : 1, run = F.L / nT, slope = nT >= 2 ? r / run : 0;
    const ang = Math.atan(slope), cs = Math.cos(ang), sn = Math.sin(ang);
    const tc = (j) => run * (j + 0.5), under = (j) => F.b + (j + 1) * r - T;
    const top = (t) => under(0) - gap + slope * (t - tc(0));
    // The level it stands on: the floor, or under the landing it leaves.
    const footY = i === 0 ? F.b : F.b - LT;
    const P = (t, y) => [F.s[0] + F.d[0] * t, y, F.s[1] + F.d[1] * t];
    const bar = (q, len, w, h, rot) => F.d[0] === 0 ? K.box(w, h, len, q[0], q[1], q[2], mat, 0, rot ? [F.d[1] < 0 ? rot : -rot, 0, 0] : null)
      : K.box(len, h, w, q[0], q[1], q[2], mat, 0, rot ? [0, 0, F.d[0] > 0 ? rot : -rot] : null);
    // The spine: its lowest corner on the foot's level, its top end inside the run (under the last tread).
    let ta = slope > 0 ? Math.max(0, tc(0) + (footY + bH * cs - top(tc(0))) / slope) : 0;
    const tb = F.L - bH * sn - 0.002;
    let drawn = false;
    if (slope > 0 && tb - ta > 0.05) {
      const tm = (ta + tb) / 2;
      bar(P(tm + (bH / 2) * sn, top(tm) - (bH / 2) * cs), (tb - ta) / cs, bW, bH, ang);
      drawn = true;
    } else if (slope === 0) {
      const h = Math.min(bH, top(0) - footY);
      if (h > 0.01) { bar(P(F.L / 2, top(0) - h / 2), Math.max(0.01, F.L - 0.004), bW, h, 0); drawn = true; }
    }
    if (!drawn) ta = F.L;                                         // no spine: a post under every tread
    // A bracket under each tread on the spine (high quality), and a post down
    // to the foot under any the spine has not reached (always).
    for (let j = 0; j < nT; j++) {
      const t = tc(j), post = t < ta;
      if (!post && !K.hi) continue;
      const y0 = post ? footY : top(t) - 0.01, y1 = under(j) + 0.002;
      if (y1 - y0 > 0.005) bar(P(t, (y0 + y1) / 2), Math.min(0.12, run * 0.5), bW * 0.8, y1 - y0, 0);
    }
    // The spine's top end under the last tread, held by it (a short hanger,
    // never past the tread's underside).
    const yLo = top(tb) - (bH / 2) * cs, yHi = under(nT - 1) + 0.002;
    if (drawn && yHi - yLo > 0.01 && tb > 0.03) bar(P(tb - 0.015, (yLo + yHi) / 2), 0.03, bW, yHi - yLo, 0);
    ends.push({ ta, bW, sn, F, endTop: drawn ? top(tb) : under(nT - 1) });
  }
  // On the floor at the foot: a plate where the spine stands.
  if (ends.length) {
    const { ta, bW, sn, F } = ends[0], t = Math.min(Math.max(ta + bH * sn, 0.08), Math.max(0.08, F.L - 0.08));
    if (F.L > 0.16 && ta < F.L) {
      const q = [F.s[0] + F.d[0] * t, F.b + 0.006, F.s[1] + F.d[1] * t];
      if (F.d[0] === 0) K.box(bW * 1.8, 0.012, 0.16, q[0], q[1], q[2], mat); else K.box(0.16, 0.012, bW * 1.8, q[0], q[1], q[2], mat);
    }
  }
  // Under each landing: from where the flight below ends (never back over its
  // last tread), round its middle, to past where the next one leaves (its
  // spine starts on it); deep enough to meet the spine arriving.
  for (const [i, Lg] of L0.landings.entries()) {
    const A = FL[i], B = FL[i + 1];
    if (!A || !B) continue;
    const bW = Math.min(0.12, Math.max(0.05, Math.min(A.w, B.w) * 0.12));
    const yTop = Lg.h - LT, yBot = Math.max(0, Math.min(yTop - bH, ends[i].endTop - 0.02));
    if (yTop - yBot < 0.01) continue;
    const C = [(Lg.x0 + Lg.x1) / 2, (Lg.z0 + Lg.z1) / 2];
    const H = [A.s[0] + A.d[0] * A.L, A.s[1] + A.d[1] * A.L], S = [B.s[0], B.s[1]];
    const on = (o, d) => { const k = (C[0] - o[0]) * d[0] + (C[1] - o[1]) * d[1]; return [o[0] + d[0] * k, o[1] + d[1] * k]; };
    const ext = Math.min(0.4, Math.max(0.1, B.L * 0.25));
    const pts = [H, on(H, A.d), on(S, B.d), [S[0] + B.d[0] * ext, S[1] + B.d[1] * ext]];
    for (let k = 0; k + 1 < pts.length; k++) {
      const [a, b] = [pts[k], pts[k + 1]], dx = b[0] - a[0], dz = b[1] - a[1], len = Math.hypot(dx, dz);
      if (len < 1e-3) continue;
      // Corners closed by half a width; never past the flight's end at H.
      const e0 = k === 0 ? 0 : bW / 2, e1 = bW / 2, ux = dx / len, uz = dz / len;
      const cx = (a[0] - ux * e0 + b[0] + ux * e1) / 2, cz = (a[1] - uz * e0 + b[1] + uz * e1) / 2, L = len + e0 + e1;
      if (Math.abs(dx) >= Math.abs(dz)) K.box(L, yTop - yBot, bW, cx, (yTop + yBot) / 2, cz, mat);
      else K.box(bW, yTop - yBot, L, cx, (yTop + yBot) / 2, cz, mat);
    }
  }
}

function buildBox(K, S, p, C){
  K.box(S.w, S.h, S.d, 0, S.h / 2, 0, L(C[0]), Math.min(0.015, S.w / 4, S.d / 4, S.h / 4));
}

// Sofa: seats across the width between its arms, the back at −z. Modern: a
// slim upholstered shell up on thin legs (tapered wood or black metal), short
// block feet, or none (a dark plinth set back under it, so it floats); one
// cushion a seat, soft back cushions leaning on a thin back, and arms a slim
// track, a wider block or a soft roll.
function buildSofa(K, S, p, C){
  const { w: W, d: D, h: H } = S;
  const body = L(C[0], "fabric"), cush = L(C[1], "fabric");
  const armW = Math.min({ none: 0, slim: 0.08, wide: 0.17, rolled: 0.15 }[p.arms], W * 0.16);
  const legH = Math.min({ none: 0.03, block: 0.06, tapered: 0.15, metal: 0.15 }[p.legs], H * 0.22);
  const backT = clamp(D * 0.17, 0.1, 0.18), seatD = D - backT;
  const cushT = clamp(H * 0.16, 0.08, 0.15);
  const seatTop = Math.max(Math.min(p.seat_h_m, H - 0.12), legH + 0.06 + cushT), baseTop = seatTop - cushT;
  const innerW = W - 2 * armW;
  // The shell: a base under the seat cushions and the back behind them.
  K.box(W, baseTop - legH, D, 0, legH + (baseTop - legH) / 2, 0, body, 0.025);
  K.box(armW ? innerW + 0.04 : W, H - baseTop, backT, 0, baseTop + (H - baseTop) / 2, -D / 2 + backT / 2, body, Math.min(0.05, backT / 2));
  const cw = innerW / p.seats;
  for (let i = 0; i < p.seats; i++) {
    K.box(cw - 0.012, cushT, seatD - 0.005, -innerW / 2 + cw * (i + 0.5), baseTop + cushT / 2, -D / 2 + backT + (seatD - 0.005) / 2, cush, Math.min(0.045, cushT / 2));
  }
  // Back cushions, plump and leaning back against it.
  const bh = Math.min(H - seatTop - 0.02, 0.52), bt = clamp(seatD * 0.2, 0.1, 0.17), lean = 0.16;
  if (p.cushions > 0 && bh > 0.1) {
    const bw = innerW / p.cushions;
    const zc = -D / 2 + backT + bt / 2 + bh / 2 * Math.sin(lean) - 0.01, yc = seatTop + bh / 2 * Math.cos(lean);
    for (let i = 0; i < p.cushions; i++) {
      K.box(bw - 0.02, bh, bt, -innerW / 2 + bw * (i + 0.5), yc, zc, cush, Math.min(0.075, bt * 0.48), [-lean, 0, 0]);
    }
  }
  if (armW) {
    const armTop = Math.min(seatTop + 0.2, H - 0.02);
    for (const s of [-1, 1]) {
      const ax = s * (W / 2 - armW / 2);
      if (p.arms === "rolled") {
        const rr = Math.min(armW * 0.6, (armTop - legH) / 2);
        K.box(armW, armTop - rr - legH, D, ax, legH + (armTop - rr - legH) / 2, 0, body, 0.025);
        K.cyl(rr, rr, D - 0.01, s * (W / 2 - rr), armTop - rr, 0.005, body, 20, [Math.PI / 2, 0, 0]);
      } else {
        K.box(armW, armTop - legH, D, ax, legH + (armTop - legH) / 2, 0, body, p.arms === "wide" ? 0.06 : 0.035);
      }
    }
  }
  const lx = W / 2 - Math.min(0.08, W * 0.1), lz = D / 2 - Math.min(0.08, D * 0.12);
  if (p.legs === "none") plinth(K, W - 0.08, -D / 2 + 0.04, D / 2, legH, 0.05, 0);
  else for (const sx of [-1, 1]) for (const sz2 of [-1, 1]) {
    if (p.legs === "block") K.box(0.05, legH, 0.05, sx * lx, legH / 2, sz2 * lz, L(LEG_DARK, "wood"), 0.006);
    else if (p.legs === "tapered") leg(K, sx * lx, sz2 * lz, legH, 0.021, L(LEG_WOOD, "wood"), 0.55, 0.02, sx * 0.7, sz2 * 0.7);
    else leg(K, sx * lx, sz2 * lz, legH, 0.009, L(BLACK, "metal"), 1);
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
  const hbD = Math.min({ none: 0, panel: 0.04, slatted: 0.05, padded: 0.09 }[p.headboard], D * 0.08);
  const fbD = p.footboard ? 0.035 : 0;
  const zb = -D / 2 + hbD, zf = D / 2 - fbD, Lz = zf - zb, zc = (zb + zf) / 2;
  const rim = clamp(W * 0.025, 0.03, 0.04), mw = W - 2 * rim, ml = Lz - 2 * rim;
  // The mattress top at its usual height under a headboard (which takes the
  // rest of the Height); with none, the bed itself is the Height. Modern
  // beds sit low.
  const platform = p.base === "platform", usual = platform ? 0.44 : 0.5;
  const mattTop = p.headboard === "none" ? H - 0.12 : Math.min(usual, H - 0.12);
  const mattH = 0.22 * Math.min(1, mattTop / usual), baseTop = mattTop - mattH;
  if (platform) {
    // A low base on a dark plinth set well back: it seems to float.
    const toe = Math.min(0.07, baseTop * 0.3);
    K.box(W, baseTop - toe, Lz, 0, toe + (baseTop - toe) / 2, zc, frame, 0.02);
    K.box(W - 0.2, toe, Lz - 0.2, 0, toe / 2, zc, L(PLINTH));
  } else {
    // A slim frame on four tapered legs set in from the corners.
    const railH = Math.min(0.12, baseTop * 0.45), legH = baseTop - railH;
    K.box(W, railH, Lz, 0, legH + railH / 2, zc, frame, 0.012);
    const lx = W / 2 - Math.min(0.1, W * 0.1), lz = Lz / 2 - Math.min(0.1, Lz * 0.08);
    if (legH > 0.02) for (const sx of [-1, 1]) for (const sz2 of [-1, 1]) leg(K, sx * lx, zc + sz2 * lz, legH + 0.002, 0.024, frame, 0.6);
  }
  bedding(K, 0, zc, mw, ml, baseTop, mattH, C, p.size === "twin" ? 1 : 2);
  const zh = -D / 2 + hbD / 2;
  if (p.headboard === "panel") K.box(W, H, hbD, 0, H / 2, zh, frame, 0.015);
  else if (p.headboard === "padded") {
    // Upholstered in soft channels, on two short dark feet.
    const n = clamp(Math.round(W / 0.3), 3, 8), cw = W / n, padded = L(lighten(C[0], 0.12), "fabric");
    for (let i = 0; i < n; i++) K.box(cw - 0.004, H - 0.05, hbD, -W / 2 + cw * (i + 0.5), 0.05 + (H - 0.05) / 2, zh, padded, Math.min(0.045, cw / 2 - 0.002, hbD / 2));
    for (const s of [-1, 1]) K.box(0.04, 0.05, hbD * 0.6, s * (W / 2 - 0.1), 0.025, zh, L(PLINTH));
  } else if (p.headboard === "slatted") {
    // Thin battens between two slim posts under a thin top rail.
    for (const s of [-1, 1]) K.box(0.045, H, hbD, s * (W / 2 - 0.0225), H / 2, zh, frame, 0.008);
    K.box(W, 0.035, hbD, 0, H - 0.0175, zh, frame, 0.008);
    const ns = Math.max(4, Math.round(W / 0.11)), top = H - 0.035, sh = top - baseTop, inner = W - 0.09;
    if (sh > 0.05) for (let i = 0; i < ns; i++) K.box(0.032, sh, hbD * 0.55, -inner / 2 + inner * (i + 0.5) / ns, baseTop + sh / 2, zh, frame, 0.004);
  }
  if (p.footboard) { const fh = Math.min(mattTop + 0.06, H); K.box(W, fh, fbD, 0, fh / 2, D / 2 - fbD / 2, frame, 0.012); }
}
// A crib: bars all round, a low mattress, no pillow.
function buildCrib(K, S, p, C){
  const { w: W, d: D, h: H } = S;
  const frame = L(C[0], "wood"), post = 0.04;
  for (const sx of [-1, 1]) for (const sz2 of [-1, 1]) K.box(post, H, post, sx * (W / 2 - post / 2), H / 2, sz2 * (D / 2 - post / 2), frame, 0.008);
  const baseTop = clamp(H * 0.32, 0.12, 0.42), mattH = Math.min(0.1, baseTop * 0.5);
  K.box(W - 0.06, 0.04, D - 0.06, 0, baseTop - 0.02, 0, frame);
  bedding(K, 0, 0, W - 0.12, D - 0.12, baseTop, mattH, C, 0);
  const lo = baseTop - 0.04, hi = H - 0.04, barH = hi - lo;
  for (const sz2 of [-1, 1]) {
    K.box(W - 2 * post, 0.04, 0.035, 0, H - 0.02, sz2 * (D / 2 - post / 2), frame, 0.008);
    K.box(W - 2 * post, 0.04, 0.035, 0, lo, sz2 * (D / 2 - post / 2), frame);
    const n = clamp(Math.round((W - 2 * post) / 0.09), 3, 16);
    for (let i = 0; i < n; i++) K.box(0.018, barH, 0.018, -(W / 2 - post) + (W - 2 * post) * (i + 0.5) / n, lo + barH / 2, sz2 * (D / 2 - post / 2), frame);
  }
  for (const sx of [-1, 1]) {
    K.box(0.035, 0.04, D - 2 * post, sx * (W / 2 - post / 2), H - 0.02, 0, frame, 0.008);
    K.box(0.035, 0.04, D - 2 * post, sx * (W / 2 - post / 2), lo, 0, frame);
    const n = clamp(Math.round((D - 2 * post) / 0.09), 3, 16);
    for (let i = 0; i < n; i++) K.box(0.018, barH, 0.018, sx * (W / 2 - post / 2), lo + barH / 2, -(D / 2 - post) + (D - 2 * post) * (i + 0.5) / n, frame);
  }
}
// A bunk bed: two beds on four posts, the ladder up the right side at the foot.
function buildBunk(K, S, p, C){
  const { w: W, d: D, h: H } = S;
  const frame = L(C[0], "wood"), post = 0.055;
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
    else K.box(up ? 0.012 : len, up ? len : 0.012, HANDLE_D, x, y, zFace + HANDLE_D / 2, look);
    return;
  }
  if (kind === "knob") { K.cyl(0.011, 0.015, HANDLE_D, x, y, zFace + HANDLE_D / 2, look, 10, [Math.PI / 2, 0, 0]); return; }
  K.cyl(0.005, 0.005, len, x, y, zFace + HANDLE_D - 0.005, look, 8, up ? null : [0, 0, Math.PI / 2]);
  for (const s of [-1, 1]) {
    K.cyl(0.0035, 0.0035, HANDLE_D - 0.005, up ? x : x + s * (len / 2 - 0.01), up ? y + s * (len / 2 - 0.01) : y,
          zFace + (HANDLE_D - 0.005) / 2, look, 6, [Math.PI / 2, 0, 0]);
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
    handle(K, kind, x, cy, zFace + 0.02, "x", hl, Math.min(0.18, w * 0.5));
  }
}
// A door from y0 to y1, hinged on the left (hinge −1) or the right (+1).
function door(K, x, w, y0, y1, zFace, look, kind, hl, hinge){
  K.box(w, y1 - y0, GAP_T, x, (y0 + y1) / 2, zFace - GAP_T / 2, L(GAP));
  K.box(w - 0.006, y1 - y0 - 0.006, 0.02, x, (y0 + y1) / 2, zFace + 0.01, look, 0.004);
  const hy = Math.min(y0 + (y1 - y0) * 0.55, y0 + 1.05);
  handle(K, kind, x - hinge * (w / 2 - Math.min(0.045, w * 0.2)), hy, zFace + 0.02, "y", hl, Math.min(0.2, (y1 - y0) * 0.3));
}

// Table: a top (rectangle, rounded or round) on four legs, a pedestal or trestles.
function buildTable(K, S, p, C){
  const { w: W, d: D, h: H } = S;
  const top = L(C[0], "wood"), legL = L(C[1], "wood");
  const t = Math.min(p.top_t_m, H * 0.25), under = H - t, round = p.shape === "round";
  K.slab(round ? "ellipse" : "rect", W, t, D, 0, under, 0, top, p.shape === "rounded" ? Math.min(W, D) * 0.25 : 0.012, Math.min(0.008, t / 3));
  if (p.legs === "pedestal") {
    // A tulip foot: a slim stem flaring into a low round foot.
    const two = W > D * 1.8, xs = two ? [-W / 4, W / 4] : [0];
    const footR = Math.min(D * 0.32, (two ? W / 4 : W / 2) * 0.88, 0.32);
    const colR = clamp(Math.min(W, D) * 0.035, 0.025, 0.05), hh = Math.max(0.05, under);
    const footT = Math.min(0.022, hh * 0.08), y0 = footT - 0.002;
    for (const x of xs) {
      // A thin round foot, a cone rising off it into the stem, a flare under the top.
      const rise = (hh - y0) * 0.3, cap = Math.min(0.05, (hh - y0) * 0.12), stem = hh - y0 - rise - cap;
      K.slab("ellipse", footR * 2, footT, footR * 2, x, 0, 0, legL, 0, Math.min(0.008, footT / 3));
      K.cyl(colR, Math.min(footR * 0.5, colR * 2.8), rise, x, y0 + rise / 2, 0, legL, 20);
      if (stem > 0.005) K.cyl(colR, colR, stem, x, y0 + rise + stem / 2, 0, legL, 16);
      K.cyl(colR * 1.7, colR, cap, x, hh - cap / 2, 0, legL, 20);
    }
  } else if (p.legs === "trestle") {
    // A slim sled at each end, a thin stretcher between them.
    const tx = W / 2 - Math.min(0.12, W * 0.1), bw = 0.035, zd = D / 2 - Math.min(0.09, D * 0.12);
    for (const s of [-1, 1]) {
      for (const sz2 of [-1, 1]) K.box(bw, under, bw, s * tx, under / 2, sz2 * (zd - bw / 2), legL, 0.004);
      K.box(bw, bw, 2 * zd, s * tx, bw / 2, 0, legL, 0.004);
      K.box(bw, bw * 0.8, 2 * zd, s * tx, under - bw * 0.4, 0, legL, 0.004);
    }
    K.box(2 * tx - bw, bw * 0.7, bw * 0.7, 0, Math.max(0.08, under * 0.3), 0, legL, 0.004);
  } else {
    // Four slim legs that taper to the floor, set in from the edge, a little splayed.
    const r = clamp(Math.min(W, D) * 0.028, 0.017, 0.03), inset = clamp(Math.min(W, D) * 0.07, 0.05, 0.1);
    const fx = round ? W * 0.3 : W / 2 - inset, fz = round ? D * 0.3 : D / 2 - inset, out = Math.min(0.025, inset - r);
    for (const sx of [-1, 1]) for (const sz2 of [-1, 1]) leg(K, sx * fx, sz2 * fz, under + 0.002, r, legL, 0.55, out, sx * 0.7, sz2 * 0.7);
    if (p.apron && under > 0.2) {
      const ah = Math.min(0.06, under * 0.15), ay = under - ah / 2;
      for (const s of [-1, 1]) {
        K.box(2 * fx - r, ah, 0.018, 0, ay, s * fz, legL);
        K.box(0.018, ah, 2 * fz - r, s * fx, ay, 0, legL);
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
  // A thin seat shell; cushioned, a soft pad on it.
  const shellT = 0.022, padT = p.cushion ? 0.035 : 0, seatT = shellT + padT, legTop = seatTop - seatT;
  const r = clamp(Math.min(W, D) * 0.035, 0.012, 0.02);
  const shell = p.cushion ? L(C[0], "wood") : seat;
  if (stool) {
    // Four slim splayed legs under a round seat, a thin foot ring between them.
    K.slab("ellipse", W, shellT, D, 0, legTop, 0, shell, 0, 0.006);
    if (padT) K.slab("ellipse", W * 0.92, padT, D * 0.92, 0, legTop + shellT, 0, seat, 0, Math.min(0.014, padT / 3));
    // Leg tops a from the middle (along the diagonals), feet spread further out, inside the box.
    const c = Math.SQRT1_2, half = Math.min(W, D) / 2, a = half * 0.6;
    const spread = clamp((half - r * 0.6 - 0.003) / c - a, 0, half * 0.25), ry = Math.max(0.05, legTop * 0.32);
    for (const sx of [-1, 1]) for (const sz2 of [-1, 1]) leg(K, sx * a * c, sz2 * a * c, legTop + 0.002, r, frame, 0.6, spread, sx * c, sz2 * c);
    const ringR = a + spread * (1 - ry / legTop), tube = Math.min(0.007, r * 0.45);
    if (ringR > 0.04 && ringR + tube < half) K.torus(ringR, tube, 0, ry, 0, frame, [Math.PI / 2, 0, 0]);
    return;
  }
  // Four slim legs that taper to the floor; the back legs rise as slim posts
  // to a curved-looking back rest, leaning a little back.
  const lx = W / 2 - r - 0.012, lz = D / 2 - r - 0.012, out = 0.012;
  for (const sx of [-1, 1]) leg(K, sx * lx, lz, legTop + 0.002, r, frame, 0.6, out, sx * 0.6, 0.8);
  const backH = H - seatTop;
  for (const sx of [-1, 1]) {
    leg(K, sx * lx, -lz, legTop + 0.002, r, frame, 0.6, out, sx * 0.6, -0.8);
    if (backH > 0.08) K.rod([sx * lx, legTop, -lz], [sx * lx, H - 0.02, -D / 2 + r * 0.8], r * 0.8, frame, 8, r * 0.7);
  }
  K.box(W - 0.01, shellT, D - 0.01, 0, legTop + shellT / 2, 0, shell, 0.01);
  if (padT) K.box(W - 0.03, padT, D - 0.04, 0, legTop + shellT + padT / 2, 0.005, seat, Math.min(0.015, padT / 2));
  if (backH > 0.08) {
    const rh = clamp(backH * 0.42, 0.06, 0.2), rt = 0.02, tilt = 0.12;
    K.box(W - 0.02, rh, rt, 0, H - rh / 2 - 0.004, -D / 2 + rt / 2 + rh / 2 * Math.sin(tilt) + 0.002, frame, 0.01, [-tilt, 0, 0]);
  }
  if (p.arms) {
    const ay = Math.min(seatTop + 0.21, H - 0.03), aw = Math.min(0.04, r * 2.2);
    for (const s of [-1, 1]) {
      K.box(aw, 0.022, D * 0.82, s * (W / 2 - aw / 2), ay, -D * 0.06, frame, 0.008);
      K.rod([s * lx, seatTop, lz - 0.02], [s * lx, ay, lz - 0.04], r * 0.75, frame, 8);
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
  const t = Math.min(0.026, H * 0.1), under = H - t;
  K.slab("rect", W, t, D, 0, under, 0, top, 0.01, 0.006);
  const pedW = Math.min(0.42, W * 0.32), pedD = D - 0.04;
  const peds = { none: [], left: [-1], right: [1], both: [-1, 1] }[p.drawers];
  for (const s of peds) {
    // A drawer unit on a dark plinth set back under its fronts, slim pulls.
    const x = s * (W / 2 - pedW / 2 - 0.005), cD = pedD - 0.02 - HANDLE_D, toe = Math.min(0.05, under * 0.08);
    K.box(pedW, under - toe, cD - GAP_T, x, toe + (under - toe) / 2, -pedD / 2 + (cD - GAP_T) / 2, top, 0.006);
    K.box(pedW - 0.03, toe, cD - 0.06, x, toe / 2, -pedD / 2 + (cD - 0.06) / 2 + 0.01, L(PLINTH));
    drawers(K, x, pedW - 0.01, toe + 0.005, under - 0.008, 3, -pedD / 2 + cD, L(lighten(C[0], 0.08), "wood"), "bar", L(METAL, "metal"));
  }
  for (const s of [-1, 1]) {
    if (peds.includes(s)) continue;
    if (p.legs === "panel") K.box(0.025, under, D - 0.04, s * (W / 2 - 0.0125), under / 2, 0, frame, 0.006);
    else if (p.legs === "metal") {
      // A slim sled: two posts on a foot bar, a bar under the top.
      const x = s * (W / 2 - 0.035), bw = 0.03;
      for (const sz2 of [-1, 1]) K.box(bw, under, bw, x, under / 2, sz2 * (D / 2 - 0.06), frame, 0.004);
      K.box(bw, 0.025, D - 0.06, x, 0.0125, 0, frame, 0.004);
      K.box(bw, 0.03, D - 0.1, x, under - 0.015, 0, frame, 0.004);
    } else for (const sz2 of [-1, 1]) leg(K, s * (W / 2 - 0.045), sz2 * (D / 2 - 0.045), under + 0.002, 0.022, frame, 0.55, 0.018, s * 0.7, sz2 * 0.7);
  }
  if (p.back) { const bh = under * 0.42; K.box(W - 0.12, bh, 0.016, 0, under - bh / 2, -D / 2 + 0.07, frame, 0.004); }
}

// Dresser or cabinet: drawers, doors or both on the front (+z), on a plinth, feet or legs.
function buildDresser(K, S, p, C){
  const { w: W, d: D, h: H } = S;
  const body = L(C[0], "wood"), front = L(C[1], "wood"), hl = L(METAL, "metal");
  const hd = p.handles === "none" ? 0 : HANDLE_D;
  const cD = D - 0.02 - hd, cz = -D / 2 + cD / 2, zf = -D / 2 + cD;
  // On a dark plinth set back under the fronts (it seems to float), on
  // small round feet, or up on slim splayed legs.
  const footH = Math.min({ plinth: 0.06, feet: 0.07, legs: 0.2 }[p.base], H * 0.25);
  K.box(W, H - footH, cD - GAP_T, 0, footH + (H - footH) / 2, cz - GAP_T / 2, body, 0.008);
  if (p.base === "plinth") plinth(K, W, -D / 2, zf, footH, 0.04, 0.02);
  else {
    const ix = Math.min(0.06, W * 0.12), iz = Math.min(0.06, cD * 0.15);
    for (const sx of [-1, 1]) for (const sz2 of [-1, 1]) {
      const x = sx * (W / 2 - ix), z = cz + sz2 * (cD / 2 - iz);
      if (p.base === "feet") K.cyl(0.026, 0.02, footH, x, footH / 2, z, L(BLACK, "satin"), 12);
      else leg(K, x, z, footH + 0.002, 0.02, L(LEG_WOOD, "wood"), 0.55, clamp(ix - 0.025, 0, 0.02), sx * 0.7, sz2 * 0.7);
    }
  }
  const y0 = footH + 0.01, y1 = H - 0.015, colW = (W - 0.02) / p.columns;
  for (let c = 0; c < p.columns; c++) {
    const x = -W / 2 + 0.01 + colW * (c + 0.5), hinge = c % 2 ? 1 : -1;
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
// The media unit under a TV: open shelves (low) or doors (cabinet). Modern:
// a long low body up on slim tapered legs, flush fronts with thin gaps.
function mediaUnit(K, W, D, H, kind, look, c){
  const legs = Math.min(0.1, H * 0.22), body = H - legs, face = D / 2 - 0.008;
  K.box(W, body, D - 0.008, 0, legs + body / 2, -0.004, look, 0.01);
  const lx = W / 2 - Math.min(0.08, W * 0.1), lz = D / 2 - Math.min(0.06, D * 0.18);
  for (const sx of [-1, 1]) for (const sz2 of [-1, 1]) leg(K, sx * lx, sz2 * lz, legs + 0.002, Math.min(0.016, D * 0.08), L(LEG_DARK, "wood"), 0.6);
  if (kind === "cabinet") {
    const n = W > 1.4 ? 3 : 2, dw = (W - 0.02) / n;
    K.box(W - 0.02, body - 0.02, 0.003, 0, legs + body / 2, face + 0.0015, L(GAP));
    for (let i = 0; i < n; i++) K.box(dw - 0.005, body - 0.025, 0.008, -W / 2 + 0.01 + dw * (i + 0.5), legs + body / 2, face + 0.004, L(lighten(c, 0.06), "wood"), 0.002);
  } else {
    // An open shelf the length of it, a thin divider at each third.
    const sh = body * 0.56, sy = legs + body * 0.5, dark = L(darken(c, 0.55));
    K.box(W - 0.05, sh, 0.004, 0, sy, face + 0.002, dark);
    for (const x of [-W / 6, W / 6]) K.box(0.016, sh, 0.008, x, sy, face + 0.004, look);
  }
}

// Lamp: a floor or table lamp; the shade and the bulb glow (parts of their own, for a light).
function buildLamp(K0, S, p, C, parts){
  const { w: W, d: D, h: H } = S;
  const R = Math.min(W, D) / 2, shade = L(C[0], "fabric"), base = L(C[1], "metal");
  const K = K0.child(null, [W / 2 / R, 1, D / 2 / R]);
  const table = p.style === "table", globe = p.shade === "globe";
  const shH = globe ? Math.min(2 * R, H * 0.45) : clamp(H * (table ? 0.42 : 0.26), 0.06, 0.55);
  const shBot = H - shH, baseT = Math.min(0.02, shBot * 0.1);
  if (p.base === "tripod") {
    const hubY = shBot * (table ? 0.55 : 0.4);
    for (let i = 0; i < 3; i++) {
      const a = Math.PI / 2 + i * Math.PI * 2 / 3;
      K.rod([Math.cos(a) * (R * 0.9 - 0.012), 0.012, Math.sin(a) * (R * 0.9 - 0.012)], [0, hubY, 0], 0.012, base, 8);
    }
    K.cyl(0.012, 0.012, shBot - hubY + 0.02, 0, hubY + (shBot - hubY + 0.02) / 2, 0, base, 8);
  } else {
    const bR = R * (table ? 0.5 : 0.62);
    if (p.base === "round") K.cyl(bR, bR * 1.02, baseT, 0, baseT / 2, 0, base, 24);
    else K.box(bR * 1.7, baseT, bR * 1.7, 0, baseT / 2, 0, base, 0.004);
    if (table) {
      // A turned ceramic body, round and tapering to the neck.
      const bodyH = (shBot - baseT) * 0.72, bw = R * 0.42;
      K.lathe([[bw * 0.55, 0], [bw * 0.9, bodyH * 0.25], [bw, bodyH * 0.5], [bw * 0.75, bodyH * 0.82], [bw * 0.3, bodyH]], 0, baseT, 0, L(C[1], "satin"), 20);
      K.cyl(0.008, 0.008, shBot - baseT - bodyH + 0.02, 0, baseT + bodyH + (shBot - baseT - bodyH) / 2, 0, base, 8);
    } else K.cyl(0.01, 0.01, shBot - baseT + 0.02, 0, baseT + (shBot - baseT) / 2, 0, base, 10);
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
const BOOKS = ["#46576a", "#8a5a4c", "#c9b48c", "#5d6b58", "#e6e0d4", "#2f3236"];   // muted, as a modern shelf is styled
function buildShelf(K, S, p, C){
  const { w: W, d: D, h: H } = S;
  const frame = L(C[0], "wood"), n = p.shelves, t = Math.min(0.018, H / (n + 1) / 3), style = p.style;
  const back = p.back && style !== "wall" ? 0.006 : 0, side = style === "bookcase" ? t : style === "open" ? 0.02 : 0;
  const base = style === "bookcase" ? Math.min(0.06, H * 0.1) : style === "wall" ? Math.min(0.05, H * 0.12) : 0;
  const ys = [];
  for (let i = 0; i <= n; i++) ys.push(base + t / 2 + (H - base - t) * i / n);
  const bw = W - 2 * side;
  for (const y of ys) K.box(bw, t, D - back, 0, y, back / 2, frame, 0.004);
  if (style === "bookcase") {
    for (const s of [-1, 1]) K.box(t, H, D, s * (W / 2 - t / 2), H / 2, 0, frame, 0.004);
    plinth(K, bw, -D / 2 + back, D / 2, base, 0.03, 0);
  } else if (style === "open") {
    // A slim black frame.
    for (const sx of [-1, 1]) for (const sz2 of [-1, 1]) K.box(0.02, H, 0.02, sx * (W / 2 - 0.01), H / 2, sz2 * (D / 2 - 0.01), L(BLACK, "metal"), 0.003);
  } else {
    // Slim black brackets under each board, against the wall.
    const bh = Math.min(0.04, base), bd = Math.min(0.06, D * 0.5);
    for (const y of ys) for (const s of [-1, 1]) K.box(0.012, bh, bd, s * bw * 0.35, y - t / 2 - bh / 2, -D / 2 + bd / 2, L(BLACK, "metal"));
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
  // On a dark plinth set back under the doors.
  const ph = Math.min(0.07, H * 0.05), y0 = ph + 0.008, y1 = H - 0.015;
  K.box(W, H - ph, cD - GAP_T, 0, ph + (H - ph) / 2, cz - GAP_T / 2, body, 0.008);
  plinth(K, W, -D / 2, zf, ph, 0.05, 0.02);
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
  const leaf = L(C[0], "soft"), pot = L(C[1], "satin"), soil = L("#3b2a1e");
  const potH = p.pot === "none" ? 0 : clamp(H * 0.3, 0.04, 0.45), potR = R * (p.style === "tree" || p.style === "palm" ? 0.6 : 0.75);
  if (p.pot === "round") {
    K.cyl(potR, potR * 0.86, potH, 0, potH / 2, 0, pot, 20);
    K.cyl(potR * 0.9, potR * 0.9, 0.008, 0, potH - 0.003, 0, soil, 20);
  } else if (p.pot === "square") {
    K.box(potR * 1.75, potH, potR * 1.75, 0, potH / 2, 0, pot, 0.02);
    K.box(potR * 1.6, 0.008, potR * 1.6, 0, potH - 0.003, 0, soil);
  }
  const fh = H - potH, y0 = potH, ball = (x, y, z, r, look = leaf, scl = null) => K.ball(r, x, y, z, look, scl, null, 12);
  if (p.style === "bush") {
    // Long leaves rising from the pot and arching out, the inner ones
    // upright and darker, the outer ones leaning further: a leafy houseplant.
    // A plant taller than its leaves reach grows a stem, its leaves up it.
    const n = K.hi ? 13 : 9, inner = L(darken(C[0], 0.18), "soft");
    let stemTop = 0;
    for (let i = 0; i < n; i++) {
      const tier = i % 3, a = i * 2.39996 + 0.3, lean = [0.2, 0.5, 0.85][tier], lf = [1, 0.84, 0.66][tier];
      const b = R * [0.06, 0.14, 0.22][tier], sl = Math.sin(lean), cl = Math.cos(lean), ca = Math.cos(a), sa = Math.sin(a);
      const ax = [[sl * ca, cl, sl * sa], [cl * ca * 0.16, -sl * 0.16, cl * sa * 0.16], [-sa * 0.42, 0, ca * 0.42]];
      const ext = (k) => Math.hypot(ax[0][k], ax[1][k], ax[2][k]);
      // As long as it can be and still stay inside the plant's box.
      let rl = fh * lf / (ax[0][1] + ext(1)) * 0.98;
      for (const [k, c0] of [[0, b * ca], [2, b * sa]]) for (const s2 of [-1, 1]) {
        const den = s2 * ax[0][k] + ext(k);
        if (den > 1e-6) rl = Math.min(rl, (R * 0.98 - s2 * c0) / den);
      }
      const reach = rl * (ax[0][1] + ext(1)), yb = y0 + Math.max(0, fh * lf - reach) * [0.95, 0.62, 0.3][tier];
      stemTop = Math.max(stemTop, yb - y0);
      if (rl > 0.01) K.ball(rl, b * ca + ax[0][0] * rl, yb + ax[0][1] * rl, b * sa + ax[0][2] * rl, tier === 0 ? inner : leaf,
                            [0.16, 1, 0.42], [0, -a, -lean], 10);
    }
    if (stemTop > 0.02) K.cyl(Math.min(0.012, R * 0.08), Math.min(0.016, R * 0.1), stemTop + 0.02, 0, y0 + (stemTop + 0.02) / 2, 0, L(darken(C[0], 0.35), "soft"), 8);
  } else if (p.style === "tree") {
    // A slim trunk under a loose crown of soft, flattened clusters.
    const tr = clamp(R * 0.07, 0.008, 0.04), crownH = Math.min(fh * 0.55, R * 1.7), rc = Math.min(R * 0.42, crownH * 0.62), fy = 0.66;
    const yc = H - crownH / 2;
    K.cyl(tr * 0.7, tr, yc - y0, 0, (y0 + yc) / 2, 0, L("#6b4a32", "wood"), 8);
    const dark = L(darken(C[0], 0.15), "soft"), ring = R - rc;
    ball(0, H - rc * fy, 0, rc, leaf, [1, fy, 1]);
    for (let i = 0; i < 5; i++) {
      const a = i * Math.PI * 2 / 5 + 0.4, y = Math.max(yc - crownH * 0.18 + (i % 2) * crownH * 0.16, y0 + rc * fy);
      ball(Math.cos(a) * ring, y, Math.sin(a) * ring, rc * 0.92, i % 2 ? leaf : dark, [1, fy, 1]);
    }
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

// ── the kitchen ─────────────────────────────────────────────────────────────
// Base units stand on a dark kick set back under their fronts and carry a
// worktop that overhangs the fronts a little; fronts are flush, matt, with
// thin gaps; pulls are slim bars (near the top of a base unit's doors, near
// the bottom of a wall unit's). Taps are chrome and stand at the back.
const CHROME = "#c8ccd0", OVEN = "#17191c", STEEL = "#b4b9be", SINK = "#8f969c", BOWL = "#dfe2e4", KICK_M = 0.1;
/** A kitchen base unit's carcass, its kick and its worktop (unless none).
 *  hole {w, d, z}: a cut-out in the worktop (a sink's bowls, a hob).
 *  → {y0, y1, zf, front, hl}: the fronts go from y0 up to y1 on a face at zf. */
function kitchenBase(K, S, C, worktop, handles, hole = null){
  const { w: W, d: D, h: H } = S;
  const top = worktop ? Math.min(0.038, H * 0.06) : 0, hd = handles === "none" ? 0 : HANDLE_D;
  const kick = Math.min(KICK_M, H * 0.14), lip = worktop ? Math.min(0.025, D * 0.05) : 0;
  const cD = D - lip - 0.02 - hd, zb = -D / 2, zf = zb + cD;
  const body = L(C[1] || C[0], "satin"), wt = L(C[2] || "#8c8780", "satin");
  K.box(W, H - top - kick, cD - GAP_T, 0, kick + (H - top - kick) / 2, zb + (cD - GAP_T) / 2, body, 0.004);
  plinth(K, W, zb, zf, kick, 0.05, 0);
  if (worktop) {
    if (!hole) K.box(W, top, D, 0, H - top / 2, 0, wt, 0.004);
    else {
      // Around the cut-out: a strip behind it, one in front, one each side.
      const hx = hole.w / 2, z0 = hole.z - hole.d / 2, z1 = hole.z + hole.d / 2, y = H - top / 2;
      K.box(W, top, z0 + D / 2, 0, y, (-D / 2 + z0) / 2, wt, 0.003);
      K.box(W, top, D / 2 - z1, 0, y, (z1 + D / 2) / 2, wt, 0.003);
      for (const s of [-1, 1]) K.box(W / 2 - hx, top, z1 - z0, s * (W / 2 + hx) / 2, y, hole.z, wt);
    }
  }
  return { y0: kick + 0.004, y1: H - top - 0.004, zf, top, front: L(C[0], "satin"), hl: L(METAL, "metal") };
}
/** Kitchen fronts across w at x, from y0 to y1, on a face at zf: "doors"
 *  (one each 60 cm or less), "drawers" (two deep under a shallow one),
 *  "mixed" (a drawer over doors). pulls: "top" (a base unit) or "bottom". */
function kFronts(K, kind, x, w, y0, y1, zf, look, handles, hl, pulls = "top"){
  const fT = 0.02, H = y1 - y0;
  if (H < 0.02 || w < 0.02) return;
  K.box(w, H, GAP_T, x, (y0 + y1) / 2, zf - GAP_T / 2, L(GAP));
  const front = (cx, cw, a, b, py) => {
    K.box(cw - 0.004, b - a - 0.004, fT, cx, (a + b) / 2, zf + fT / 2, look, 0.003);
    handle(K, handles, cx, py, zf + fT, "x", hl, Math.min(0.22, cw * 0.5));
  };
  const doors = (a, b) => {
    const n = Math.max(1, Math.ceil(w / 0.61 - 1e-6)), dw = w / n;
    for (let i = 0; i < n; i++) front(x - w / 2 + dw * (i + 0.5), dw, a, b, pulls === "top" ? b - Math.min(0.05, (b - a) / 4) : a + Math.min(0.05, (b - a) / 4));
  };
  const drawer = (a, b) => front(x, w, a, b, b - Math.min(0.045, (b - a) / 3));
  if (kind === "drawers") {
    const t = y1 - Math.min(0.16, H * 0.22), m = y0 + (t - y0) / 2;
    drawer(y0, m); drawer(m, t); drawer(t, y1);
  } else if (kind === "mixed") {
    const t = y1 - Math.min(0.16, H * 0.22);
    doors(y0, t); drawer(t, y1);
  } else doors(y0, y1);
}
function buildBaseCabinet(K, S, p, C){
  const k = kitchenBase(K, S, C, p.worktop, p.handles);
  kFronts(K, p.fronts, 0, S.w, k.y0, k.y1, k.zf, k.front, p.handles, k.hl, "top");
}
// A wall cabinet: hung by its back (its height in the room sets where), the
// pulls near the bottom; glass doors show its shelves, open has none.
function buildWallCabinet(K, S, p, C){
  const { w: W, d: D, h: H } = S;
  const body = L(C[1], "satin"), front = L(C[0], "satin"), hl = L(METAL, "metal");
  const open = p.fronts === "open", hd = open || p.handles === "none" ? 0 : HANDLE_D;
  const cD = D - (open ? 0 : 0.02) - hd, zb = -D / 2, zf = zb + cD, t = Math.min(0.018, W / 8, H / 8);
  if (open || p.fronts === "glass") {
    // A box open at the front: its sides, top, bottom and back, a shelf inside.
    const inner = L(lighten(C[1], 0.12), "satin");
    for (const s of [-1, 1]) K.box(t, H, cD, s * (W / 2 - t / 2), H / 2, zb + cD / 2, body, 0.003);
    for (const y of [t / 2, H - t / 2]) K.box(W - 2 * t, t, cD, 0, y, zb + cD / 2, body, 0.003);
    K.box(W - 2 * t, H - 2 * t, 0.006, 0, H / 2, zb + 0.003, body);
    K.box(W - 2 * t, H - 2 * t, 0.002, 0, H / 2, zb + 0.007, inner);
    if (H > 0.3) K.box(W - 2 * t, t * 0.8, cD - 0.03, 0, H / 2, zb + 0.008 + (cD - 0.03) / 2, inner);
    if (open) return;
    // Glass doors: thin frames round clear glass.
    const n = Math.max(1, Math.ceil(W / 0.61 - 1e-6)), dw = W / n, f = Math.min(0.04, dw / 5, H / 6);
    const glass = L("#dfeaee", "glass");
    for (let i = 0; i < n; i++) {
      const x = -W / 2 + dw * (i + 0.5);
      for (const s of [-1, 1]) K.box(f, H - 0.004, 0.02, x + s * (dw / 2 - 0.002 - f / 2), H / 2, zf + 0.01, front, 0.002);
      for (const y of [f / 2 + 0.002, H - f / 2 - 0.002]) K.box(dw - 2 * f - 0.004, f, 0.02, x, y, zf + 0.01, front, 0.002);
      K.box(dw - 2 * f, H - 2 * f - 0.004, 0.004, x, H / 2, zf + 0.01, glass);
      handle(K, p.handles, x, f + Math.min(0.04, H / 6), zf + 0.02, "x", hl, Math.min(0.2, dw * 0.45));
    }
    return;
  }
  K.box(W, H, cD - GAP_T, 0, H / 2, zb + (cD - GAP_T) / 2, body, 0.004);
  if (p.fronts === "lift-up") {
    // One or two flaps across the width that lift up, pulls along their bottoms.
    const n = H > 0.6 ? 2 : 1;
    K.box(W, H, GAP_T, 0, H / 2, zf - GAP_T / 2, L(GAP));
    for (let i = 0; i < n; i++) {
      const a = H * i / n, b = H * (i + 1) / n;
      K.box(W - 0.004, b - a - 0.004, 0.02, 0, (a + b) / 2, zf + 0.01, front, 0.003);
      handle(K, p.handles, 0, a + Math.min(0.04, (b - a) / 4), zf + 0.02, "x", hl, Math.min(0.3, W * 0.4));
    }
  } else kFronts(K, "doors", 0, W, 0, H, zf, front, p.handles, hl, "bottom");
}
// A tall unit: on the kick, doors (a short one over a long one), or a
// built-in oven at eye height (and a microwave over it) between doors.
function buildTallCabinet(K, S, p, C){
  const { w: W, d: D, h: H } = S;
  // (An oven's bar reaches out as a pull does, handles or none.)
  const k = kitchenBase(K, S, C, false, p.fronts === "doors" ? p.handles : "bar"), y0 = k.y0, y1 = k.y1, dark = L(OVEN, "gloss"), steel = L(STEEL, "metal");
  if (p.fronts === "doors") {
    const split = y0 + (y1 - y0) * 0.62;
    kFronts(K, "doors", 0, W, y0, split, k.zf, k.front, p.handles, k.hl, "top");
    kFronts(K, "doors", 0, W, split, y1, k.zf, k.front, p.handles, k.hl, "bottom");
    return;
  }
  // The oven at a comfortable height, a microwave over it when asked.
  const two = p.fronts === "oven and microwave", ovH = Math.min(0.6, (y1 - y0) * 0.32), mwH = two ? Math.min(0.38, (y1 - y0) * 0.2) : 0;
  const a = clamp(0.85, y0 + 0.15, y1 - ovH - mwH - 0.1), b = a + ovH, c = b + mwH;
  kFronts(K, "drawers", 0, W, y0, a, k.zf, k.front, p.handles, k.hl, "top");
  kFronts(K, "doors", 0, W, c, y1, k.zf, k.front, p.handles, k.hl, "bottom");
  const app = (lo, hi, glassH) => {
    K.box(W - 0.006, hi - lo - 0.006, 0.02, 0, (lo + hi) / 2, k.zf + 0.01, dark, 0.003);
    K.box((W - 0.006) * 0.82, (hi - lo) * glassH, 0.004, 0, (lo + hi) / 2 - (hi - lo) * 0.05, k.zf + 0.0215, L("#2a2e33", "gloss"));
    K.box(Math.min(0.4, W * 0.7), 0.012, 0.012, 0, hi - Math.min(0.04, (hi - lo) / 5), k.zf + 0.026, steel);
  };
  app(a, b, 0.55);
  if (two) app(b, c, 0.5);
}
// Sink: one or two steel bowls in the worktop, a chrome tap behind them,
// doors under it.
function buildSink(K, S, p, C){
  const { w: W, d: D, h: H } = S;
  const tapH = tapOf("sink", H), wtop = H - tapH;
  const bw = Math.min(W - 0.16, p.bowls === 2 ? 0.86 : 0.5), bd = Math.max(0.12, Math.min(0.42, D - 0.22)), hz = Math.min(0.03, D * 0.05);
  const k = kitchenBase(K, { w: W, d: D, h: wtop }, C, true, p.handles, { w: bw, d: bd, z: hz });
  kFronts(K, "doors", 0, W, k.y0, k.y1, k.zf, k.front, p.handles, k.hl, "top");
  // The bowls: steel walls and floors down into the worktop, a drain in each.
  const steel = L(SINK, "metal"), deep = Math.min(0.18, wtop - k.y0 - 0.06), yb = wtop - deep, n = p.bowls, wall = 0.008;
  const one = (bw - wall * (n + 1)) / n;
  for (let i = 0; i < n; i++) {
    const x = -bw / 2 + wall + one / 2 + i * (one + wall);
    K.box(one, 0.006, bd - 2 * wall, x, yb + 0.003, hz, steel);
    K.cyl(0.025, 0.025, 0.004, x, yb + 0.008, hz, L("#3a3d41", "metal"), 14);
  }
  for (let i = 0; i <= n; i++) K.box(wall, deep, bd, -bw / 2 + wall / 2 + i * (one + wall), wtop - deep / 2, hz, steel);
  for (const s of [-1, 1]) K.box(bw, deep, wall, 0, wtop - deep / 2, hz + s * (bd / 2 - wall / 2), steel);
  // A gooseneck tap at the back, its spout over the bowl, under the box's top.
  const chrome = L(CHROME, "metal"), r = 0.011, zt = Math.max(-D / 2 + 0.035, hz - bd / 2 - 0.045), xt = 0;
  const reach = Math.min(0.16, (hz - zt) * 0.9 + bd * 0.3), top = H - r - 0.004;
  K.cyl(0.024, 0.026, 0.02, xt, wtop + 0.01, zt, chrome, 14);
  K.rod([xt, wtop + 0.02, zt], [xt, top, zt], r, chrome, 10);
  K.ball(r, xt, top, zt, chrome, null, null, 8);
  K.rod([xt, top, zt], [xt, top, zt + reach], r, chrome, 10);
  K.rod([xt, top, zt + reach], [xt, Math.max(wtop + 0.02, top - Math.min(0.06, tapH * 0.3)), zt + reach], r * 0.9, chrome, 10);
}
// Stove: a hob in the worktop over a built-in oven, or a freestanding cooker.
function buildStove(K, S, p, C){
  const { w: W, d: D, h: H } = S;
  const hobL = L(C[1], "gloss"), dark = L(OVEN, "gloss"), steel = L(STEEL, "metal"), gas = p.hob === "gas";
  // The hob's glass a little under the top (its zones on it), a gas hob's lower, under its pan stands.
  const hobTop = H - (gas ? 0.02 : 0.002);
  let zf, y0, y1, hobW, hobD, hobZ, front;
  if (p.style === "cooker") {
    // A range on a dark kick: a steel-trimmed control strip, the oven door, a drawer.
    const kick = Math.min(0.08, H * 0.1), cD = D - 0.02 - HANDLE_D, zb = -D / 2;
    zf = zb + cD; front = L(C[0], "satin");
    K.box(W, H - kick - 0.012, cD - GAP_T, 0, kick + (H - kick - 0.012) / 2, zb + (cD - GAP_T) / 2, front, 0.008);
    plinth(K, W, zb, zf, kick, 0.04, 0.02);
    hobW = W - 0.02; hobD = D - 0.04; hobZ = -0.01;
    K.box(hobW, 0.012, hobD, 0, hobTop - 0.006, hobZ, hobL, 0.004);
    y0 = kick + 0.004; y1 = H - 0.012 - 0.004;
    const strip = Math.min(0.1, (y1 - y0) * 0.14);
    K.box(W - 0.01, strip, 0.012, 0, y1 - strip / 2, zf + 0.006, steel, 0.003);
    for (let i = 0; i < 4; i++) K.cyl(0.016, 0.016, 0.02, -W * 0.3 + W * 0.2 * i, y1 - strip / 2, zf + 0.012 + 0.01, L(BLACK, "satin"), 12, [Math.PI / 2, 0, 0]);
    y1 -= strip + 0.004;
  } else {
    hobW = Math.max(0.1, Math.min(W - 0.08, 0.58)); hobD = Math.max(0.1, Math.min(D - 0.12, 0.5)); hobZ = 0;
    const k = kitchenBase(K, S, [C[0], C[0], C[2]], true, "bar", { w: hobW, d: hobD, z: hobZ });
    zf = k.zf; y0 = k.y0; y1 = k.y1; front = k.front;
    // The hob fills its cut-out, its top level with the worktop (a gas hob's a little lower, under its pan stands).
    const t = k.top || 0.03;
    K.box(hobW, t, hobD, 0, hobTop - t / 2, hobZ, hobL, 0.003);
  }
  // A drawer under the oven, the oven's dark door with a window and a bar.
  const dr = Math.min(0.16, (y1 - y0) * 0.22);
  kFronts(K, "drawers", 0, W, y0, y0 + dr, zf, front, "bar", L(METAL, "metal"), "top");
  const ov0 = y0 + dr + 0.004;
  if (y1 - ov0 > 0.05) {
    K.box(W - 0.006, y1 - ov0, 0.02, 0, (ov0 + y1) / 2, zf + 0.01, dark, 0.003);
    K.box(W * 0.7, (y1 - ov0) * 0.5, 0.004, 0, (ov0 + y1) / 2 - (y1 - ov0) * 0.05, zf + 0.0215, L("#2a2e33", "gloss"));
    K.box(Math.min(0.45, W * 0.75), 0.012, 0.012, 0, y1 - Math.min(0.04, (y1 - ov0) / 5), zf + 0.026, steel);
  }
  // Four cooking zones: rings on glass, or burners under black pan stands.
  const zr = Math.min(hobW, hobD) * 0.17, top = hobTop;
  for (const [fx, fz, k] of [[-1, -1, 1], [1, -1, 0.8], [-1, 1, 0.8], [1, 1, 1]]) {
    const x = fx * hobW / 4, z = hobZ + fz * hobD / 4, r = zr * k;
    if (gas) {
      K.cyl(r * 0.5, r * 0.55, 0.012, x, top + 0.006, z, L("#3a3d41", "metal"), 14);
      K.box(r * 2.2, 0.008, 0.008, x, H - 0.004, z, L(BLACK, "satin"));
      K.box(0.008, 0.008, r * 2.2, x, H - 0.004, z, L(BLACK, "satin"));
    } else K.cyl(r, r, 0.0015, x, top + 0.00075, z, L(lighten(C[1], 0.22), "gloss"), 20);
  }
}
// Dishwasher: one full front (the run's, or steel with a dark strip), a pull near its top.
function buildDishwasher(K, S, p, C){
  const k = kitchenBase(K, S, C, p.worktop, "bar"), W = S.w, steel = p.style === "steel";
  const face = steel ? L(STEEL, "metal") : k.front;
  K.box(W, k.y1 - k.y0, GAP_T, 0, (k.y0 + k.y1) / 2, k.zf - GAP_T / 2, L(GAP));
  K.box(W - 0.004, k.y1 - k.y0 - 0.004, 0.02, 0, (k.y0 + k.y1) / 2, k.zf + 0.01, face, 0.003);
  const strip = steel ? Math.min(0.07, (k.y1 - k.y0) * 0.12) : 0;
  if (strip) K.box(W - 0.01, strip, 0.003, 0, k.y1 - strip / 2 - 0.004, k.zf + 0.0215, L(OVEN, "gloss"));
  handle(K, "bar", 0, k.y1 - strip - Math.min(0.05, (k.y1 - k.y0) / 6), k.zf + 0.02, "x", k.hl, Math.min(0.4, W * 0.6));
}
// Fridge: a tall fridge-freezer (the freezer below), a double (two doors over
// a freezer drawer) or an under-counter one; long pulls toward +z.
function buildFridge(K, S, p, C){
  const { w: W, d: D, h: H } = S;
  const body = L(C[0], "satin"), hl = L(C[1], "metal"), cD = D - 0.025 - HANDLE_D, zb = -D / 2, zf = zb + cD;
  const foot = Math.min(0.02, H * 0.02);
  K.box(W, H - foot, cD - GAP_T, 0, foot + (H - foot) / 2, zb + (cD - GAP_T) / 2, body, 0.012);
  plinth(K, W, zb, zf, foot, 0.04, 0.03);
  K.box(W, H - foot, GAP_T, 0, foot + (H - foot) / 2, zf - GAP_T / 2, L(GAP));
  const door = (x, w, a, b, hx, along, hy) => {
    K.box(w - 0.006, b - a - 0.006, 0.025, x, (a + b) / 2, zf + 0.0125, body, 0.006);
    const len = along === "y" ? Math.min(0.45, (b - a) * 0.6) : Math.min(0.45, w * 0.6);
    handle(K, "bar", hx, hy, zf + 0.025, along, hl, len);
  };
  const y0 = foot, y1 = H;
  if (p.style === "double") {
    const m = y0 + (y1 - y0) * 0.36;
    door(0, W, y0, m, 0, "x", m - Math.min(0.06, (m - y0) / 4));
    for (const s of [-1, 1]) door(s * W / 4, W / 2, m, y1, s * 0.04, "y", m + (y1 - m) * 0.42);
  } else if (p.style === "under") {
    door(0, W, y0, y1, W / 2 - Math.min(0.06, W * 0.12), "y", y0 + (y1 - y0) * 0.62);
  } else {
    const m = y0 + (y1 - y0) * 0.34, hx = W / 2 - Math.min(0.06, W * 0.12);
    door(0, W, y0, m, hx, "y", m - Math.min(0.22, (m - y0) * 0.45));
    door(0, W, m, y1, hx, "y", m + Math.min(0.28, (y1 - m) * 0.3));
  }
}

// ── the bathroom ────────────────────────────────────────────────────────────
// Toilet: the bowl toward +z; a cistern on the back, or (wall) hung from a
// boxed-in frame with a flush plate.
function buildWc(K, S, p, C){
  const { w: W, d: D, h: H } = S;
  const cer = L(C[0], "gloss"), seat = L(C[1], "gloss"), chrome = L(CHROME, "metal"), wall = p.mount === "wall";
  const tankD = Math.min(wall ? 0.16 : 0.2, D * 0.3), bowlTop = Math.max(0.12, Math.min(0.42, H - (wall ? 0.2 : 0.22)));
  const bl = D - tankD - 0.005, bz = -D / 2 + tankD + bl / 2, bw = Math.min(W * 0.92, 0.4);
  if (wall) {
    K.box(W, H, tankD, 0, H / 2, -D / 2 + tankD / 2, L(lighten(C[0], 0.02), "satin"), 0.008);
    const py = Math.min(H - 0.08, Math.max(bowlTop + 0.12, 0.95));
    K.box(Math.min(0.24, W * 0.6), Math.min(0.15, (H - bowlTop) * 0.4), 0.008, 0, py, -D / 2 + tankD + 0.004, chrome, 0.004);
  } else {
    const th = H - bowlTop + 0.02;
    K.box(W * 0.92, th, tankD - 0.01, 0, H - th / 2, -D / 2 + 0.005 + (tankD - 0.01) / 2, cer, Math.min(0.03, tankD / 3));
    K.cyl(0.02, 0.02, 0.006, 0, H - 0.003, -D / 2 + tankD / 2, chrome, 12);
  }
  // The bowl: a rounded pan (half an egg) under the seat, stretched to its
  // length; on the floor it stands on a slim foot, on the wall it hangs.
  const B = K.child([0, 0, bz], [1, 1, bl / bw]);
  const lid = 0.045, under = bowlTop - lid, dep = Math.min(0.2, under * 0.55, bw * 0.55);
  B.ball(bw / 2, 0, under, 0, cer, [1, dep / (bw / 2), 1], [Math.PI, 0, 0], 18, Math.PI / 2);
  if (!wall && under - dep * 0.6 > 0.01) B.cyl(bw * 0.27, bw * 0.31, under - dep * 0.6, 0, (under - dep * 0.6) / 2, -bw * 0.06, cer, 18);
  B.slab("ellipse", bw, lid, bw, 0, under, 0, seat, 0, Math.min(0.012, lid / 3));
}
// Basin: on a floating vanity (drawers under a top), on a pedestal, or on the
// wall; the tap at the back rises to the box's top.
function buildBasin(K, S, p, C){
  const { w: W, d: D, h: H } = S;
  const cer = L(C[0], "gloss"), cab = L(C[1], "wood"), chrome = L(CHROME, "metal"), inner = L(BOWL, "gloss");
  const tapH = tapOf("basin", H), rim = H - tapH, n = p.basins;
  const xs = n === 2 ? [-W / 4, W / 4] : [0], each = W / n;
  const bowl = (x, w, d, t, z) => {
    K.slab("rect", w, t, d, x, rim - t, z, cer, Math.min(w, d) * 0.22, Math.min(0.01, t / 3));
    K.slab("ellipse", w * 0.74, 0.002, d * 0.66, x, rim, z + d * 0.04, inner, 0, 0.0005);
  };
  const tap = (x, z, base = rim) => {
    const r = 0.012, top = H - r - 0.003, reach = Math.min(0.12, D * 0.22);
    K.cyl(0.02, 0.022, 0.016, x, base + 0.008, z, chrome, 12);
    K.rod([x, base + 0.016, z], [x, top, z], r, chrome, 10);
    K.ball(r, x, top, z, chrome, null, null, 8);
    K.rod([x, top, z], [x, top, z + reach], r * 0.9, chrome, 10);
  };
  const zt = -D / 2 + Math.min(0.05, D * 0.14);
  if (p.style === "vanity") {
    // A cabinet hung off the floor, drawers under each basin, a slim top
    // with the basins sitting on it.
    const bh = Math.min(0.13, rim * 0.16), ct = 0.025, top = rim - bh, cy0 = Math.min(0.3, top * 0.4), cD = D - 0.03 - HANDLE_D;
    K.box(W, top - ct - cy0, cD - GAP_T, 0, cy0 + (top - ct - cy0) / 2, -D / 2 + (cD - GAP_T) / 2, cab, 0.006);
    for (const x of xs) kFronts(K, "drawers", x, each - 0.004, cy0, top - ct - 0.004, -D / 2 + cD, cab, "bar", L(METAL, "metal"), "top");
    K.slab("rect", W, ct, D, 0, top - ct, 0, cer, 0.01, 0.004);
    for (const x of xs) { bowl(x, Math.min(0.5, each - 0.1), D * 0.68, bh, 0.03); tap(x, zt, top); }
    return;
  }
  for (const x of xs) {
    const bwid = Math.min(0.6, each - 0.02), t = Math.min(0.16, rim * 0.25);
    bowl(x, bwid, D, t, 0);
    if (p.style === "pedestal") K.cyl(Math.min(0.08, bwid * 0.18), Math.min(0.1, bwid * 0.22), rim - t, x, (rim - t) / 2, -D * 0.12, cer, 18);
    else {
      // A chrome trap under it, back into the wall.
      const yt = Math.max(0.02, Math.min(rim - t - 0.15, H * 0.45));
      K.rod([x, rim - t, 0], [x, yt, 0], 0.016, chrome, 10);
      K.rod([x, yt, 0], [x, yt, -D / 2 + 0.01], 0.016, chrome, 10);
    }
    tap(x, zt);
  }
}
// Bath: a built-in bath behind a panel, or a freestanding tub; the spout at
// the back of one end.
function buildBath(K, S, p, C){
  const { w: W, d: D, h: H } = S;
  const tub = L(C[0], "gloss"), panel = L(C[1], "satin"), inner = L(BOWL, "gloss"), chrome = L(CHROME, "metal");
  const tapH = Math.min(0.1, H * 0.16), rim = H - tapH, edge = Math.min(0.08, D * 0.11);
  if (p.style === "freestanding") {
    // One soft-cornered tub standing on the floor, its rim a little rolled.
    K.box(W, rim, D, 0, rim / 2, 0, tub, Math.min(0.16, D * 0.22, rim * 0.45));
  } else {
    const kick = Math.min(0.05, rim * 0.1);
    K.box(W, rim - 0.02 - kick, D, 0, kick + (rim - 0.02 - kick) / 2, 0, panel, 0.006);
    plinth(K, W, -D / 2, D / 2, kick, 0.02, 0);
    K.slab("rect", W, 0.02, D, 0, rim - 0.02, 0, tub, 0.01, 0.004);
  }
  K.slab("rect", W - 2 * edge, 0.002, D - 2 * edge, 0, rim, 0, inner, Math.min(0.22, (D - 2 * edge) * 0.45), 0.0005);
  // The spout at the back of the left end (as seen from the front), its handles beside it.
  const x = -W / 2 + Math.min(0.2, W * 0.12), z = -D / 2 + edge * 0.55, r = 0.012, top = H - r - 0.002;
  K.rod([x, rim, z], [x, top, z], r, chrome, 10);
  K.rod([x, top, z], [x, top, z + Math.min(0.12, D * 0.16)], r * 0.9, chrome, 10);
  for (const s of [-1, 1]) K.cyl(0.018, 0.018, Math.min(0.05, tapH * 0.6), x + s * 0.09, rim + Math.min(0.025, tapH * 0.3), z, chrome, 12);
}
// Shower: a low tray, a riser and a round head at the back; an enclosure has
// clear glass on the front and the right with a door, a walk-in one screen.
function buildShower(K, S, p, C){
  const { w: W, d: D, h: H } = S;
  const tray = L(C[0], "gloss"), frame = L(C[1], "metal"), glass = L("#dfeaee", "glass"), chrome = L(CHROME, "metal");
  const walk = p.style === "walk-in", tt = walk ? 0.015 : 0.04, f = 0.02;
  K.slab("rect", W, tt, D, 0, 0, 0, tray, 0.02, Math.min(0.006, tt / 3));
  K.box(Math.min(0.5, W * 0.4), 0.002, 0.04, 0, tt + 0.001, -D * 0.2, L("#3a3d41", "metal"));
  const gH = Math.min(2.0, H - 0.02) - tt, gy = tt + gH / 2;
  if (walk) {
    // One fixed screen from the left wall along the front, a bar back to the wall at its top.
    const sw = Math.min(W - 0.3, Math.max(0.6, W * 0.65)), sx = -W / 2 + sw / 2;
    K.box(sw, gH, 0.008, sx, gy, D / 2 - 0.004, glass);
    K.box(f * 0.6, gH, f, -W / 2 + f * 0.3, gy, D / 2 - f / 2, frame);
    K.box(sw, f * 0.6, f * 0.6, sx, tt + gH - f * 0.3, D / 2 - f * 0.3, frame);
    K.rod([sx + sw / 2 - 0.02, tt + gH - 0.02, D / 2 - 0.02], [sx + sw / 2 - 0.02, tt + gH - 0.02, -D / 2 + 0.01], 0.008, frame, 8);
  } else {
    // Glass on the front and the right, a slim frame round them; a door in the front.
    K.box(W - 0.01, gH, 0.008, -0.005, gy, D / 2 - 0.004, glass);
    K.box(0.008, gH, D - 0.01, W / 2 - 0.004, gy, -0.005, glass);
    K.box(W, f, f, 0, tt + gH - f / 2, D / 2 - f / 2, frame);
    K.box(f, f, D, W / 2 - f / 2, tt + gH - f / 2, 0, frame);
    for (const [x, z] of [[-W / 2 + f / 2, D / 2 - f / 2], [W / 2 - f / 2, D / 2 - f / 2], [W / 2 - f / 2, -D / 2 + f / 2]]) K.box(f, gH, f, x, gy, z, frame);
    K.box(0.012, Math.min(0.4, gH * 0.2), 0.03, -W * 0.02, tt + gH * 0.5, D / 2 - 0.015, frame);
  }
  // At the back wall: a mixer, a riser and a round head on an arm.
  const x = walk ? W * 0.18 : 0, z = -D / 2 + 0.03, hy = H - 0.035;
  K.box(0.16, 0.07, 0.04, x, Math.min(1.05, H * 0.5), -D / 2 + 0.02, chrome, 0.01);
  K.rod([x, Math.min(1.05, H * 0.5), z], [x, hy, z], 0.011, chrome, 10);
  const arm = Math.min(0.28, D * 0.3);
  K.rod([x, hy, z], [x, hy, z + arm], 0.01, chrome, 10);
  K.cyl(Math.min(0.12, W * 0.14), Math.min(0.12, W * 0.14), 0.012, x, hy - 0.016, z + arm, chrome, 24);
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

// Car: the nose toward +z, its charge-port light (parts.glow). Two characters, few details, satin paint:
//   sedan, hatch   a low sports coupe: round lamps on raised front wings, a
//                  low nose, one sweep of roof down to the tail, wide hips,
//                  a light bar across the tail
//   suv, pickup    a boxy 4x4: a flat hood, round lamps in a dark grille,
//                  flared arches over big tyres, a dark top, a spare on the
//                  back (the pickup: a bed)
function buildCar(K, S, p, C, parts){
  return (p.body === "suv" || p.body === "pickup" ? buildCarRugged : buildCarSleek)(K, S, p, C, parts);
}
const carSoft = (u) => { u = clamp(u, 0, 1); return u * u * (3 - 2 * u); };
// A wheel arch of radius r round (cz, cy), cut off at height `floor`: its points front to back over the top.
function carArch(cz, cy, r, floor, m){
  const dx = Math.sqrt(Math.max(r * r - (cy - floor) * (cy - floor), 1e-6)), a0 = Math.atan2(floor - cy, dx), a1 = Math.PI - a0, out = [];
  for (let i = 0; i <= m; i++) { const a = a0 + (a1 - a0) * i / m; out.push([cz + r * Math.cos(a), cy + r * Math.sin(a)]); }
  return out;
}

function buildCarSleek(K, S, p, C, parts){
  const { w: W, d: D, h: H } = S, hi = K.hi, hatch = p.body === "hatch";
  const body = L(C[0], "satin"), glass = L(C[1], "gloss"), tyre = L("#141517", "soft"), rim = L("#b9bfc5", "satin"), dark = L("#17191c", "soft"), lamp = L("#f4f1e6", "gloss");
  const wr = clamp(Math.min(H * 0.235, D * 0.074), 0.16, 0.42), ww = Math.min(0.27, W * 0.14);
  const clear = wr * 0.42;
  const belt = clamp(H * 0.585, clear + wr * 1.85, H * 0.74), bh = belt - clear, top = H - belt;
  const side = W / 2 - 0.004, zr = -D / 2, zf = D / 2;
  const wzf = zf - Math.max(wr * 1.55, D * 0.165), wzr = zr + Math.max(wr * 1.5, D * 0.16), ra = wr * 1.1;
  // Seen from above: widest over the back wheels, narrower along the doors, narrower again at the nose and the tail.
  const plan = (z) => z >= wzr ? 1 - 0.085 * carSoft((z - wzr) / (D * 0.26)) - 0.07 * carSoft((z - D * 0.3) / (D * 0.2))
    : 1 - 0.08 * carSoft((wzr - z) / Math.max(wzr - zr, 1e-3));
  const tumble = (y) => 1 - 0.045 * carSoft((y - (belt - bh * 0.4)) / (bh * 0.4));
  const n = hi ? 6 : 2, m = hi ? 12 : 6, r1 = Math.min(0.13, bh * 0.3);
  const z1 = D * (hatch ? 0.17 : 0.2), z0 = D * (hatch ? -0.44 : -0.42), span = z1 - z0;
  K.prism(roundedPath([
    [zr + D * 0.03, clear, r1 * 0.6], [zr, clear + bh * 0.36, r1 * 1.2], [zr + D * 0.012, belt - bh * 0.05, r1 * 1.2], [zr + D * 0.075, belt, r1 * 2],
    [z1, belt, 0], [zf - D * 0.085, belt - bh * 0.13, r1 * 3], [zf, belt - bh * 0.4, r1 * 1.6],
    [zf - D * 0.006, clear + bh * 0.16, r1], [zf - D * 0.035, clear, r1 * 0.6],
  ], n).concat(carArch(wzf, wr, ra, clear, m), carArch(wzr, wr, ra, clear, m)), side * 2, 0, 0, 0, body, Math.min(0.075, W * 0.042), (y, z) => plan(z) * tumble(y));
  // The cabin: glass under one sweep of roof, narrower toward the tail.
  const rf = Math.min(top * 1.25, span * 0.32), roofT = Math.min(0.04, top * 0.11), gw = side * 2 * 0.8;
  const lean = (y) => 1 - 0.2 * clamp((y - belt) / top, 0, 1), tear = (z) => 1 - (hatch ? 0.05 : 0.15) * carSoft((z1 - rf - z) / (span * 0.8));
  const peak = [z1 - rf - span * 0.1, H - roofT], fall = hatch ? [z0 + top * 0.5, H - roofT - top * 0.1] : [z0 + span * 0.46, H - roofT - top * 0.24];
  K.prism(roundedPath([[z0, belt - 0.02, 0], [fall[0], fall[1], span * 0.3], [peak[0], peak[1], span * 0.2], [z1 - rf, H - roofT, Math.min(0.12, top * 0.3)], [z1, belt - 0.02, 0]], n),
    gw, 0, 0, 0, glass, 0.035, (y, z) => lean(y) * tear(z));
  K.prism(roundedPath([[fall[0] + 0.02, fall[1] - 0.004, 0], [peak[0], peak[1] - 0.004, 0], [z1 - rf - 0.01, H - roofT - 0.004, 0],
                       [z1 - rf - 0.05, H, roofT * 2], [peak[0], H, span * 0.2], [fall[0] + 0.06, fall[1] + roofT, 0]], n),
    gw * 0.8, 0, 0, 0, body, roofT * 0.3, (y, z) => tear(z));
  const pr = Math.min(0.024, W * 0.013);
  for (const s of [-1, 1]) {
    K.rod([s * (gw / 2 - pr * 0.3), belt, z1], [s * (gw / 2 * 0.8 - pr * 0.3) * tear(z1 - rf), H - roofT * 0.7, z1 - rf], pr, body, 8);
    K.box(0.075, 0.055, 0.1, s * (gw / 2 + 0.03), belt + 0.035, z1 - 0.05, body, 0.02);
  }
  // Wheels: a tyre, an alloy with five spokes.
  const turn = [0, 0, Math.PI / 2];
  for (const cz of [wzf, wzr]) {
    K.box(side * 1.7, wr + ra * 0.98 - clear, ra * 1.96, 0, (clear + wr + ra * 0.98) / 2, cz, dark);
    for (const s of [-1, 1]) {
      const x = s * (side * plan(cz) * 0.975 - ww / 2), face = x + s * ww / 2;
      K.cyl(wr, wr, ww, x, wr, cz, tyre, hi ? 24 : 20, turn);
      K.cyl(wr * 0.72, wr * 0.72, 0.012, face, wr, cz, rim, hi ? 20 : 16, turn);
      if (hi) {
        K.cyl(wr * 0.62, wr * 0.62, 0.016, face, wr, cz, dark, 18, turn);
        for (let i = 0; i < 5; i++) {
          const a = i * 2 * Math.PI / 5;
          K.box(0.012, wr * 0.56, wr * 0.17, face + s * 0.007, wr + Math.cos(a) * wr * 0.32, cz + Math.sin(a) * wr * 0.32, rim, 0, [a, 0, 0]);
        }
      }
      K.cyl(wr * 0.17, wr * 0.17, 0.03, face, wr, cz, hi ? rim : dark, 10, turn);
    }
  }
  // Round lamps set in the nose, a dark intake under it, one red bar across the tail.
  const nose = side * plan(zf), tail = side * plan(zr), rl = Math.min(bh * 0.1, W * 0.045);
  for (const s of [-1, 1]) K.cyl(rl, rl, 0.03, s * nose * 0.66, clear + bh * 0.42, zf - 0.016, lamp, 18, [Math.PI / 2, 0, 0]);
  K.box(nose * 1.3, bh * 0.13, 0.02, 0, clear + bh * 0.2, zf - D * 0.006 - 0.004, dark, 0.008);
  K.box(tail * 1.6, bh * 0.05, 0.03, 0, clear + bh * 0.76, zr + D * 0.012 + 0.004, L("#c3202a", "gloss"), 0.012);
  const py = belt - Math.min(0.16, bh * 0.3), pz = D * 0.02;
  parts.glow = [K.own(L("#2f3a33", "gloss"), (k) => k.box(0.012, 0.05, 0.08, -side * plan(pz) * tumble(py), py, pz, L("#2f3a33")))];
}

function buildCarRugged(K, S, p, C, parts){
  const { w: W, d: D, h: H } = S, hi = K.hi, pickup = p.body === "pickup";
  const body = L(C[0], "satin"), glass = L(C[1], "gloss"), tyre = L("#141517", "soft"), steel = L("#42474d", "satin"), dark = L("#17191c", "soft"), lamp = L("#f4f1e6", "gloss");
  const wr = clamp(Math.min(H * 0.235, D * 0.088), 0.18, 0.46), ww = Math.min(0.3, W * 0.155);
  const clear = wr * 0.72;
  const belt = clamp(H * 0.6, clear + wr * 1.82, H * 0.75), bh = belt - clear, top = H - belt;
  const flare = 0.024, side = W / 2 - flare - 0.004;
  const spare = pickup ? 0 : Math.min(ww * 0.8, D * 0.05), zr = -D / 2 + (pickup ? 0.03 : spare + 0.01), zf = D / 2 - 0.05;
  const wzf = zf - Math.max(wr * 1.4, D * 0.15), wzr = zr + Math.max(wr * 1.4, D * 0.15), ra = wr * 1.12;
  const plan = (z) => 1 - 0.035 * carSoft((Math.abs(z) / (D / 2) - 0.6) / 0.4);
  const tumble = (y) => 1 - 0.02 * carSoft((y - (belt - bh * 0.3)) / (bh * 0.3));
  const n = hi ? 4 : 2, m = hi ? 12 : 6, r1 = Math.min(0.06, bh * 0.14);
  K.prism(roundedPath([
    [zr + 0.03, clear, r1], [zr, clear + bh * 0.16, r1], [zr, belt, r1],
    [zf - 0.012, belt - bh * 0.03, r1 * 1.6], [zf, belt - bh * 0.14, r1], [zf, clear + bh * 0.18, r1], [zf - 0.04, clear, r1],
  ], n).concat(carArch(wzf, wr, ra, clear, m), carArch(wzr, wr, ra, clear, m)), side * 2, 0, 0, 0, body, Math.min(0.045, W * 0.025), (y, z) => plan(z) * tumble(y));
  // Flares round the arches, and a step between them.
  for (const cz of [wzf, wzr]) {
    K.prism(carArch(cz, wr, ra * 1.2, clear, m).concat(carArch(cz, wr, ra * 1.005, clear, m).reverse()), (side + flare) * 2, 0, 0, 0, dark, 0.012);
    K.box(side * 1.7, wr + ra * 0.98 - clear, ra * 1.96, 0, (clear + wr + ra * 0.98) / 2, cz, dark);
  }
  for (const s of [-1, 1]) K.box(0.07, 0.05, wzf - wzr - ra * 2.5, s * (side - 0.012), clear + 0.03, (wzf + wzr) / 2, dark, 0.015);
  // The cabin: upright glass under a dark top.
  const z1 = D * (pickup ? 0.16 : 0.14), z0 = pickup ? -D * 0.06 : zr + 0.03, rf = top * 0.4, rr = top * (pickup ? 0.08 : 0.1);
  const roofT = Math.min(0.06, top * 0.14), gw = side * 2 * 0.94, lean = (y) => 1 - 0.075 * clamp((y - belt) / top, 0, 1), gr = Math.min(0.06, top * 0.14);
  K.prism(roundedPath([[z0, belt - 0.02, 0], [z0 + rr, H - roofT, gr], [z1 - rf, H - roofT, gr], [z1, belt - 0.02, 0]], n), gw, 0, 0, 0, glass, 0.025,
    (y, z) => lean(y) * plan(z));
  K.prism(roundedPath([[z0 + rr - 0.03, H - roofT, 0], [z0 + rr - 0.01, H, roofT], [z1 - rf - 0.05, H, roofT * 1.5], [z1 - rf + 0.03, H - roofT, 0]], n),
    gw * 0.955, 0, 0, 0, dark, roofT * 0.3, (y, z) => plan(z));
  const pr = Math.min(0.034, W * 0.018), xb = gw / 2 - pr * 0.3, xt = gw / 2 * 0.925 - pr * 0.3, yt = H - roofT * 0.8, zm = (z0 + rr + z1 - rf) / 2 + (pickup ? 0 : (z1 - z0) * 0.12);
  for (const s of [-1, 1]) {
    K.rod([s * xb * plan(z1), belt, z1], [s * xt * plan(z1 - rf), yt, z1 - rf], pr, body, 8);
    K.rod([s * xb * plan(z0), belt, z0], [s * xt * plan(z0 + rr), yt, z0 + rr], pr * 1.3, dark, 8);
    if (!pickup && hi) K.rod([s * xb * plan(zm), belt, zm], [s * xt * plan(zm), yt, zm], pr, dark, 8);
    K.box(0.064, 0.09, 0.05, s * (W / 2 - 0.036), belt + 0.06, z1 - 0.04, dark, 0.015);
  }
  if (pickup) {
    // The bed: a dark floor between the sides and a tailgate.
    const b0 = zr + 0.02, b1 = z0 - 0.04, railH = Math.min(0.14, top * 0.26), bx = side * 0.97;
    K.box(bx * 2 - 0.16, 0.02, b1 - b0 - 0.1, 0, belt + 0.004, (b0 + b1) / 2, dark);
    for (const s of [-1, 1]) K.box(0.07, railH, b1 - b0, s * (bx - 0.035), belt + railH / 2 - 0.01, (b0 + b1) / 2, body, 0.02);
    K.box(bx * 2 - 0.07, railH, 0.06, 0, belt + railH / 2 - 0.01, b0 + 0.03, body, 0.02);
  }
  // Big tyres on plain steel wheels.
  const turn = [0, 0, Math.PI / 2], flat = [Math.PI / 2, 0, 0];
  for (const cz of [wzf, wzr]) for (const s of [-1, 1]) {
    const x = s * (side + flare - 0.006 - ww / 2), face = x + s * ww / 2;
    K.cyl(wr, wr, ww, x, wr, cz, tyre, hi ? 24 : 20, turn);
    K.cyl(wr * 0.54, wr * 0.54, 0.014, face - s * 0.004, wr, cz, steel, hi ? 20 : 16, turn);
    K.cyl(wr * 0.16, wr * 0.16, 0.024, face - s * 0.004, wr, cz, L("#b9bfc5", "satin"), 10, turn);
  }
  // The face: round lamps at the ends of a dark grille, a bar of light between them, a bumper.
  const gy = belt - bh * 0.3, rl = Math.min(bh * 0.12, W * 0.06);
  K.box(side * 1.84, bh * 0.3, 0.03, 0, gy, zf + 0.002, dark, 0.01);
  for (const s of [-1, 1]) K.cyl(rl, rl, 0.03, s * (side * 0.92 - rl * 1.25), gy, zf + 0.008, lamp, 20, flat);
  K.box(side * 1.84 - rl * 5.2, bh * 0.035, 0.02, 0, gy, zf + 0.012, lamp);
  K.box(side * 1.96, bh * 0.16, 0.085, 0, clear + bh * 0.1, zf + 0.006, dark, 0.02);
  // Behind: upright lamps, a bumper, and the spare.
  for (const s of [-1, 1]) K.box(0.06, bh * 0.3, 0.02, s * side * 0.88, belt - bh * 0.3, zr - 0.004, L("#c3202a", "gloss"), 0.008);
  K.box(side * 1.96, bh * 0.14, 0.05, 0, clear + bh * 0.09, zr - 0.002, dark, 0.015);
  if (!pickup) {
    const sy = clamp(clear + bh * 0.7, wr * 0.95, H - wr * 0.95 - 0.01);
    K.cyl(wr * 0.94, wr * 0.94, spare * 0.9, 0, sy, zr - spare * 0.5, tyre, 24, flat);
    K.cyl(wr * 0.5, wr * 0.5, 0.02, 0, sy, zr - spare * 0.93, steel, 18, flat);
  }
  const py = belt - Math.min(0.16, bh * 0.3), pz = D * 0.02;
  parts.glow = [K.own(L("#2f3a33", "gloss"), (k) => k.box(0.012, 0.05, 0.08, -side * plan(pz) * tumble(py), py, pz, L("#2f3a33")))];
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

// ── tags and scanners: small, lying as they sit ─────────────────────────────
// Tag: a puck, a card, a key fob or a phone, lying flat, its accent on top.
function buildTag(K, S, p, C){
  const { w: W, d: D, h: H } = S;
  const body = L(C[0], "gloss"), accent = L(C[1], "gloss");
  if (p.form === "puck") {
    K.slab("ellipse", W, H * 0.8, D, 0, 0, 0, body, 0, H * 0.25);
    K.slab("ellipse", W * 0.62, H, D * 0.62, 0, 0, 0, accent, 0, H * 0.15);
  } else if (p.form === "card") {
    K.slab("rect", W, H * 0.85, D, 0, 0, 0, body, Math.min(W, D) * 0.08, H * 0.2);
    K.box(W * 0.9, H * 0.3, D * 0.14, 0, H * 0.85, -D * 0.25, accent);
  } else if (p.form === "fob") {
    K.slab("rect", W, H, D * 0.78, 0, 0, D * 0.11, body, Math.min(W, D) * 0.3, H * 0.25);
    const m = Math.min(W, D * 0.22), tube = Math.min(m * 0.12, H * 0.45);
    K.torus(m * 0.44 - tube, tube, 0, H / 2, -D / 2 + m * 0.44, accent, [Math.PI / 2, 0, 0]);
  } else {
    K.slab("rect", W, H * 0.92, D, 0, 0, 0, body, Math.min(W, D) * 0.14, H * 0.2);
    K.slab("rect", W * 0.9, H, D * 0.93, 0, 0, 0, L("#10151b", "gloss"), Math.min(W, D) * 0.1, H * 0.1);
  }
}

// Scanner: a small box or a bare board, with or without an antenna standing up.
function buildScanner(K, S, p, C){
  const { w: W, d: D, h: H } = S;
  const caseL = L(C[0], "gloss"), led = L(C[1], "gloss"), dark = L("#141517", "gloss");
  const antH = p.antenna ? H * 0.7 : 0, bodyH = H - antH;
  let foot = bodyH;                                 // where an antenna stands: on the box, or on the board itself
  if (p.form === "box") {
    K.box(W, bodyH, D - 0.002, 0, bodyH / 2, -0.001, caseL, Math.min(0.006, W / 6, D / 6, bodyH / 4));
    K.box(Math.min(0.006, W * 0.12), Math.min(0.004, bodyH * 0.25), 0.002, W * 0.3, bodyH * 0.7, D / 2 - 0.001, led);
  } else {
    const pcb = Math.min(0.0016, bodyH * 0.25);
    foot = pcb;
    K.box(W, pcb, D, 0, pcb / 2, 0, caseL);
    const can = bodyH - pcb;
    K.box(W * 0.4, can, D * 0.55, -W * 0.18, pcb + can / 2, 0, L(METAL, "metal"));
    K.box(W * 0.16, can * 0.5, D * 0.3, W * 0.22, pcb + can * 0.25, -D * 0.15, dark);
    K.box(Math.min(0.004, W * 0.1), can * 0.4, Math.min(0.004, D * 0.15), W * 0.38, pcb + can * 0.2, D * 0.3, led);
  }
  if (antH) {
    const ar = Math.min(0.005, W * 0.08, D * 0.08), stick = H - foot, bh = Math.min(0.012, stick * 0.15);
    K.box(ar * 3, bh, ar * 3, W / 2 - ar * 1.5, foot + bh / 2, -D / 2 + ar * 1.5, dark);
    K.cyl(ar, ar * 0.8, stick, W / 2 - ar * 1.5, foot + stick / 2, -D / 2 + ar * 1.5, dark, 10);
  }
}

const BUILDERS = { sofa: buildSofa, bed: buildBed, table: buildTable, chair: buildChair, desk: buildDesk, dresser: buildDresser,
                   tv: buildTv, lamp: buildLamp, rug: buildRug, shelf: buildShelf, wardrobe: buildWardrobe, plant: buildPlant,
                   base_cabinet: buildBaseCabinet, wall_cabinet: buildWallCabinet, tall_cabinet: buildTallCabinet, sink: buildSink,
                   stove: buildStove, dishwasher: buildDishwasher, fridge: buildFridge,
                   wc: buildWc, basin: buildBasin, bath: buildBath, shower: buildShower,
                   washer: (K, S, p, C, parts) => buildLaundry(K, S, p, C, parts, false),
                   dryer: (K, S, p, C, parts) => buildLaundry(K, S, p, C, parts, true),
                   vacuum_dock: buildVacuumDock, mower_dock: buildMowerDock, car: buildCar, charger: buildCharger,
                   radiator: buildRadiator, fan: buildFan, speaker: buildSpeaker, tag: buildTag, scanner: buildScanner,
                   stairs: buildStairs, other: buildBox };

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
// A token, never a likeness: height, build (how wide), hair, colours, and
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

// One smooth body in two colours (the top over the bottom) and a head. No
// arms or legs: a figure on a plan says who and where, not what they do.
function drawFigure(K, S, p){
  const H = p.height_m, c = p.colors;
  const skin = L(c.skin, "soft"), top = L(c.top, "fabric"), bottom = L(c.bottom, "fabric"), hair = L(c.hair, "soft"), dark = L("#1d1d1f", "gloss");
  const kid = clamp((1.6 - H) / 0.6, 0, 1), wide = 1 + 0.08 * kid;
  const hr = (0.1 + 0.02 * kid) * H, hy = H * 0.965 - hr, bodyTop = hy - hr - 0.012 * H, split = bodyTop * 0.44;
  const rb = { slim: 0.118, medium: 0.134, broad: 0.152 }[p.build] * H * wide, flat = [1, 1, 0.86];
  K.lathe([[rb * 0.9, 0], [rb, 0.022 * H], [rb * 0.975, split * 0.6], [rb * 0.955, split]], 0, 0, 0, bottom, 18, flat);
  K.lathe([[rb * 0.955, split], [rb * 0.9, split + (bodyTop - split) * 0.45], [rb * 0.76, bodyTop - 0.07 * H], [rb * 0.5, bodyTop - 0.016 * H],
           [rb * 0.2, bodyTop]], 0, 0, 0, top, 18, flat);
  drawHead(K, p, hr, hy, skin, hair, dark, c);
}

// The head every figure shares: two dots for eyes, which show which way it faces; no face beyond that.
function drawHead(K, p, hr, hy, skin, hair, dark, c){
  K.ball(hr, 0, hy, 0, skin, [0.93, 1.04, 0.98], null, 18);
  for (const s of [-1, 1]) K.ball(hr * 0.11, s * hr * 0.33, hy + hr * 0.08, hr * 0.9, dark, null, null, 8);
  if (p.hair !== "none") {
    K.ball(hr * 1.07, 0, hy + hr * 0.06, -hr * 0.04, hair, [0.95, 1.02, 1], [-0.5, 0, 0], 18, Math.PI * 0.56);
    if (p.hair === "long") K.ball(hr, 0, hy - hr * 0.62, -hr * 0.42, hair, [0.98, 1.3, 0.62], null, 12);
    if (p.hair === "bun") K.ball(hr * 0.42, 0, hy + hr * 0.62, -hr * 0.82, hair, null, null, 12);
  }
  if (p.glasses) K.box(hr * 1.5, hr * 0.26, hr * 0.08, 0, hy + hr * 0.08, hr * 0.95, dark);
  if (p.hat) {
    K.ball(hr * 1.1, 0, hy + hr * 0.1, 0, L(c.top, "fabric"), [1, 0.92, 1], [-0.25, 0, 0], 16, Math.PI * 0.48);
    K.box(hr * 1.3, hr * 0.1, hr * 0.5, 0, hy + hr * 0.42, hr * 0.95, L(c.top, "fabric"));
  }
}

export function buildFigure(THREE, params, opts){
  const p = clampFigure(params);
  const quality = opts && opts.quality === "high" ? "high" : "low";
  const H = p.height_m, S = { w: 0.44 * H, d: 0.32 * H, h: H };
  return build(THREE, quality, (K) => drawFigure(K, S, p), S, p, [], { kind: "figure", recipe: p, fallback: false });
}
