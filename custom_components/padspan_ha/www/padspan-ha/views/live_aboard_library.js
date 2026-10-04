// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
// See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
//
// Live Aboard's shared furniture library, in the page (docs/IDEA_ATLAS_3D_HOUSE.md,
// "The shared furniture library" and "The details sheet"; P4). The Furnish tab
// loads it with import().catch(() => null) and calls (contracts §4):
//   libraryFlow(ctx)       browse, search, every filter and sort, "Fits here",
//                          place -> {recipe, library_id} | null
//   shareFlow(ctx, piece)  the terms (once per terms version), the details
//                          sheet, then share, or wait for the library
//                          -> {submission_id, details} | null
// Each draws its own UI in ctx.el, in the page (no alert, confirm or prompt),
// and reaches Home Assistant only through ctx.callWS (ws_house3d_library.py:
// house3d_library_search / _get / _report / _share, house3d_terms_accept; and
// house3d_get for the terms). With the "Shared library" switch off, or the
// library unreachable, browsing shows the starter set that ships with PadSpan
// (assets/furniture_starters.json): Furnish never needs the library.
//
// Thumbnails are drawn here from each recipe with the builders module
// (ctx.recipeTools, views/live_aboard_furniture.js) and the bundled three.js,
// on one small offscreen renderer that exists only while a flow is open; a
// screen without WebGL gets a flat sketch of the box. No image is uploaded or
// kept anywhere.
//
// The details sheet's rules are server/furniture_library.php's, with the same
// lists and patterns as house3d_library.py (tests/js/live_aboard_library.mjs
// and tests/test_live_aboard_library.py hold the three equal and run the shared
// fixtures in tests/fixtures/furniture_library/). ASCII rules, as the
// server's; a JavaScript \s also takes other kinds of space, so this copy can
// only be stricter than the server, never looser.

// ── The terms ────────────────────────────────────────────────────────────────
// DRAFT — UNDER REVIEW. The plan requires a lawyer's review before the library
// ships (Garry's choice 5: a licence to PadSpan only, not CC0, sharers keep
// their rights; choice 6: needed to share furniture, not to browse). Raising
// TERMS_VERSION (here and in house3d_library.py) asks everyone again before
// their next share.
export const TERMS_VERSION = 1;
export const TERMS = {
  status: "Draft — under review",
  title: "The PadSpan furniture library",
  points: [
    "Pieces you share go into the PadSpan furniture library, where other PadSpan houses can find them and place them.",
    "Only the piece's shape, sizes and colours and its details sheet are shared: what kind of thing it is, the rooms "
      + "and style it suits, its materials, and the title, brand and model if you add them. Never your photo, your "
      + "floor plan, where the piece sits, its name in your house, the device it is linked to, or anything that says "
      + "who you are or where you live. Don't put personal information in the title.",
    "By sharing a piece you give PadSpan (every edition, free and paid) a permanent licence to use, show, copy and "
      + "change it and its details, and to let other PadSpan users place it in their houses. You keep your own "
      + "rights to it. The library gives nobody a licence outside PadSpan.",
    "You can withdraw your pieces at any time: Settings → UI Structure → Atlas → 3D house → Withdraw my shared "
      + "furniture. Copies already placed in other houses stay there and can still be used.",
    "You don't need these terms to browse the library or to build furniture for your own house.",
  ],
};

// ── The details sheet: server/furniture_library.php's lists, in its order ────
export const CATEGORIES = ["seating", "sleeping", "tables", "storage", "lighting", "media", "decor", "outdoor",
  "appliance", "kids", "pets", "office", "bath", "kitchen", "device", "other"];
export const ROOMS = ["living", "bedroom", "kids-room", "kitchen", "dining", "office", "bathroom", "hallway",
  "garage", "patio", "any"];
export const STYLES = ["modern", "mid-century", "traditional", "rustic", "industrial", "scandinavian", "farmhouse",
  "minimalist", "boho", "coastal", "glam", "retro", "other"];
export const MATERIALS = ["wood", "fabric", "leather", "metal", "glass", "plastic", "stone", "rattan", "mixed"];
export const COLOR_FAMILIES = ["white", "cream", "beige", "brown", "black", "grey", "red", "orange", "yellow",
  "green", "teal", "blue", "purple", "pink"];
export const SIZE_CLASSES = ["small", "medium", "large", "extra-large"];
export const BED_SIZES = ["twin", "double", "queen", "king", "crib", "bunk"];
export const FEATURES = ["has_arms", "reclines", "sectional", "sofa_bed", "storage", "on_wheels", "foldable",
  "adjustable_height", "wall_mounted"];
export const FIXTURES = ["floor", "table", "desk", "pendant", "wall", "strip"];
export const FORMS = ["puck", "card", "fob", "phone", "box", "board"];
export const SORTS = ["placed", "newest", "size", "name", "fit"];
export const REASONS = ["details", "title"];
export const RECIPE_KEYS = ["kind", "params", "colors", "width_m", "depth_m", "height_m", "details"];
export const DETAIL_KEYS = ["category", "kind", "rooms", "style", "material", "color_family", "size_class",
  "seats", "bed_size", "features", "drawers", "doors", "shelves", "fixture", "shades",
  "form", "antenna", "outdoor", "title", "brand", "model", "checked"];
export const REQUIRED = ["category", "kind", "rooms", "style", "material", "color_family", "size_class"];
export const FILTER_KEYS = ["category", "kind", "room", "style", "material", "color_family", "size_class", "seats",
  "features", "outdoor", "fits"];
export const COUNTS = { seats: [1, 8], drawers: [0, 50], doors: [0, 50], shelves: [0, 50], shades: [0, 12] };
export const TEXT = { title: [3, 60], brand: [2, 40], model: [1, 60] };
export const FIT_MARGIN_M = 0.05;
const PAGE = 30;

// Free text, in the server's order. tester.php's secrets, then what would say
// who or where someone is, then a short word list (the report button is the
// backstop).
export const SECRETS = [
  ["a PadSpan licence key", /\b[Pp][Ss][Pp][Aa][Nn]-[A-Za-z0-9-]{8,}/],
  ["a long hex string (a key or an IRK)", /\b[0-9A-Fa-f]{32,}\b/],
  ["a login token", /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/],
  ["a long key or token", /(?=[A-Za-z0-9+=_]*[0-9])(?=[A-Za-z0-9+=_]*[A-Za-z])[A-Za-z0-9+=_]{40,}/],
];
export const PERSONAL = [
  ["email", /[A-Za-z0-9._%+'-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/],
  ["url", /(?:https?:\/\/|www\.)|\b[A-Za-z0-9-]{2,}\.(?:com|net|org|info|biz|io|co|ca|us|uk|de|fr|nl|eu|au|nz|app|dev|shop|store|online|site|xyz|me|tv|ly)\b/i],
  ["phone", /(?:\+?\d[\s.\/()-]*){9,}|\b\d{3}[\s.-]\d{4}\b/],
  ["address", /\b\d{1,6}[A-Za-z]?\s+(?:[A-Za-z][A-Za-z'.-]*\s+){1,4}(?:street|st|road|rd|avenue|ave|boulevard|blvd|drive|dr|lane|ln|way|court|ct|crescent|cres|place|pl|terrace|highway|hwy|close|parkway|pkwy|circle|cir|trail|square|sq)\b|\b[A-Za-z]+(?:strasse|straße|str\.|weg|allee|gasse|platz)\s*\d{1,5}\b|\b(?:p\.?\s?o\.?\s?box|apt)\.?\s*#?\s*\d+|\b[A-Za-z]\d[A-Za-z]\s?\d[A-Za-z]\d\b/i],
];
export const WORDS = ["fuck", "fucking", "fucker", "shit", "shitty", "cunt", "bitch", "bastard", "asshole",
  "dickhead", "cock", "pussy", "whore", "slut", "wank", "wanker", "twat", "porn", "nazi", "rape"];
const WORD_RX = new RegExp(`\\b(?:${WORDS.join("|")})\\b`, "i");
const CTRL = /[\x00-\x1f\x7f]/;

// ── Words on screen ──────────────────────────────────────────────────────────
export const LABELS = {
  category: { seating: "Seating", sleeping: "Beds", tables: "Tables", storage: "Storage", lighting: "Lighting",
    media: "TV and media", decor: "Decor", outdoor: "Outdoor", appliance: "Appliances", kids: "Kids", pets: "Pets",
    office: "Office", bath: "Bathroom", kitchen: "Kitchen", device: "Tags and scanners", other: "Other" },
  room: { living: "Living room", bedroom: "Bedroom", "kids-room": "Kids' room", kitchen: "Kitchen", dining: "Dining",
    office: "Office", bathroom: "Bathroom", hallway: "Hallway", garage: "Garage", patio: "Patio", any: "Any room" },
  style: { modern: "Modern", "mid-century": "Mid-century", traditional: "Traditional", rustic: "Rustic",
    industrial: "Industrial", scandinavian: "Scandinavian", farmhouse: "Farmhouse", minimalist: "Minimalist",
    boho: "Boho", coastal: "Coastal", glam: "Glam", retro: "Retro", other: "Other" },
  material: { wood: "Wood", fabric: "Fabric", leather: "Leather", metal: "Metal", glass: "Glass", plastic: "Plastic",
    stone: "Stone", rattan: "Rattan / wicker", mixed: "Mixed" },
  color_family: { white: "White", cream: "Cream", beige: "Beige", brown: "Brown", black: "Black", grey: "Grey",
    red: "Red", orange: "Orange", yellow: "Yellow", green: "Green", teal: "Teal", blue: "Blue", purple: "Purple",
    pink: "Pink" },
  size_class: { small: "Small", medium: "Medium", large: "Large", "extra-large": "Extra large" },
  bed_size: { twin: "Twin", double: "Double", queen: "Queen", king: "King", crib: "Crib", bunk: "Bunk" },
  feature: { has_arms: "Has arms", reclines: "Reclines", sectional: "Sectional / modular", sofa_bed: "Sofa bed",
    storage: "Storage inside", on_wheels: "On wheels", foldable: "Foldable", adjustable_height: "Adjustable height",
    wall_mounted: "Wall-mounted" },
  fixture: { floor: "Floor", table: "Table", desk: "Desk", pendant: "Pendant", wall: "Wall", strip: "Strip" },
  form: { puck: "Puck", card: "Card", fob: "Fob", phone: "Phone", box: "Box", board: "Board" },
  sort: { placed: "Most placed", newest: "Newest", size: "Size, small first", name: "Name", fit: "Best fit" },
};
const SWATCH = { white: "#f8fafc", cream: "#f1e6c3", beige: "#d6c3a0", brown: "#7a5230", black: "#141414",
  grey: "#8a8f98", red: "#d43c3c", orange: "#ef8a2b", yellow: "#efcf3a", green: "#4f9a52", teal: "#2aa198",
  blue: "#3b82f6", purple: "#8e5bd8", pink: "#e98bb9" };
const SAY = { control: "a control character", secret: "something that looks like a key or a token",
  email: "an email address", url: "a web address", phone: "a phone number", address: "a street address",
  word: "a word the library does not take" };
const FIELD_NAME = { color_family: "colour family", size_class: "size class", bed_size: "bed size",
  rooms: "rooms it suits", material: "main material" };

// ── The rules (the server's, in its order) ───────────────────────────────────
const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const isObj = (v) => !!v && typeof v === "object" && !Array.isArray(v);
const trimPhp = (s) => s.replace(/^[ \t\n\r\0\x0b]+|[ \t\n\r\0\x0b]+$/g, "");
const lowerAscii = (s) => String(s).replace(/[A-Z]/g, (c) => c.toLowerCase());
const finite = (v) => typeof v === "number" && Number.isFinite(v);

/** "" when free text may be shared, else what it looks like. */
export function textProblem(s){
  s = String(s);
  if (CTRL.test(s)) return "control";
  if (SECRETS.some(([, rx]) => rx.test(s))) return "secret";
  for (const [what, rx] of PERSONAL) if (rx.test(s)) return what;
  return WORD_RX.test(s) ? "word" : "";
}

function setOf(v, values, least){
  if (!Array.isArray(v) || v.length < least || v.length > values.length) return null;
  if (v.some(x => typeof x !== "string" || !values.includes(x)) || new Set(v).size !== v.length) return null;
  return values.filter(x => v.includes(x));
}

/** The details sheet: {details, field: "", problem: ""}, or {details: null,
 *  field, problem} for the first problem — not an object; a key outside the
 *  sheet; a required field missing; then each field in the sheet's order. */
export function checkDetails(d, kind){
  const bad = (field, problem) => ({ details: null, field, problem });
  if (!isObj(d)) return bad("details", "value");
  for (const k of Object.keys(d)) if (!DETAIL_KEYS.includes(k)) return bad(k, "key");
  for (const k of REQUIRED) {
    const v = d[k];
    if (v === undefined || v === null || v === "" || (Array.isArray(v) && !v.length) || (isObj(v) && !Object.keys(v).length)) {
      return bad(k, "missing");
    }
  }
  const lists = { category: CATEGORIES, style: STYLES, material: MATERIALS, color_family: COLOR_FAMILIES,
    size_class: SIZE_CLASSES, bed_size: BED_SIZES, fixture: FIXTURES, form: FORMS };
  const out = {};
  for (const k of DETAIL_KEYS) {
    if (!own(d, k)) continue;
    let v = d[k];
    if (lists[k]) {
      if (typeof v !== "string" || !lists[k].includes(v)) return bad(k, "value");
    } else if (k === "kind") {
      if (typeof v !== "string" || (v !== kind && v !== "other")) return bad(k, "value");
    } else if (k === "rooms" || k === "features") {
      v = setOf(v, k === "rooms" ? ROOMS : FEATURES, k === "rooms" ? 1 : 0);
      if (!v) return bad(k, "value");
    } else if (COUNTS[k]) {
      if (!Number.isInteger(v) || v < COUNTS[k][0] || v > COUNTS[k][1]) return bad(k, "value");
    } else if (TEXT[k]) {
      if (typeof v !== "string") return bad(k, "value");
      v = trimPhp(v);
      if (!v) continue;
      const n = [...v].length;
      if (n < TEXT[k][0] || n > TEXT[k][1]) return bad(k, "length");
      const p = textProblem(v);
      if (p) return bad(k, p);
    } else if (typeof v !== "boolean") {
      return bad(k, "value");
    }
    out[k] = v;
  }
  return { details: out, field: "", problem: "" };
}

/** A refusal in plain words. */
export function problemWords(field, problem){
  const name = FIELD_NAME[field] || String(field).replace(/_/g, " ");
  if (SAY[problem]) return `The ${name} looks like it has ${SAY[problem]} in it. Please take it out: everyone can see the library.`;
  if (problem === "missing") return field === "rooms" ? "Tick at least one room it suits." : `Please choose the ${name}.`;
  if (problem === "length") return `The ${name} must be ${TEXT[field][0]} to ${TEXT[field][1]} characters.`;
  if (COUNTS[field]) return `The ${name} must be a whole number from ${COUNTS[field][0]} to ${COUNTS[field][1]}.`;
  if (problem === "key") return `“${field}” is not part of a library piece.`;
  return `The ${name} is not one the library knows.`;
}

// ── Computed details ─────────────────────────────────────────────────────────

/** The main colour as one of the 14 colour families. */
export function colorFamily(hex){
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || "").trim());
  if (!m) return "grey";
  const n = parseInt(m[1], 16);
  const r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), c = max - min, l = (max + min) / 2;
  const s = c === 0 ? 0 : c / (1 - Math.abs(2 * l - 1));
  let h = 0;
  if (c) {
    h = max === r ? ((g - b) / c) % 6 : max === g ? (b - r) / c + 2 : (r - g) / c + 4;
    h = (h * 60 + 360) % 360;
  }
  if (l >= 0.85 && h >= 25 && h < 70 && c >= 0.035 && c < 0.6) return "cream";
  if (s < 0.18 || c < 0.06) return l >= 0.88 ? "white" : l <= 0.16 ? "black" : "grey";
  if (l >= 0.95) return "white";
  if (l <= 0.1) return "black";
  if (h < 20 || h >= 340) return l >= 0.75 ? "pink" : (h >= 10 && h < 20 && l < 0.45) ? "brown" : "red";
  if (h < 45) return l < 0.5 || (s < 0.45 && l < 0.6) ? "brown" : (s < 0.6 && l >= 0.6) ? "beige" : "orange";
  if (h < 70) return l < 0.3 ? "green" : (s < 0.55 && l >= 0.55) ? "beige" : "yellow";
  if (h < 160) return "green";
  if (h < 195) return "teal";
  if (h < 255) return "blue";
  if (h < 290) return "purple";
  return l < 0.35 ? "purple" : "pink";
}

/** Small / medium / large / extra large FOR ITS KIND (a large lamp isn't a
 *  large sofa): its volume against the builder's own default piece; a box,
 *  or a kind with no builder, goes by plain volume. */
export function sizeClass(recipe, tools){
  const v = ["width_m", "depth_m", "height_m"].reduce((p, k) => p * (finite(recipe && recipe[k]) ? recipe[k] : 1), 1);
  let ref = 0;
  try {
    if (tools && tools.FURNITURE && recipe && recipe.kind !== "other" && own(tools.FURNITURE, recipe.kind)) {
      const def = tools.defaultRecipe(recipe.kind);
      ref = def.width_m * def.depth_m * def.height_m;
    }
  } catch (_) { ref = 0; }
  if (!(ref > 0)) return v < 0.05 ? "small" : v < 0.4 ? "medium" : v < 1.5 ? "large" : "extra-large";
  const k = v / ref;
  return k < 0.55 ? "small" : k < 1.35 ? "medium" : k < 2.4 ? "large" : "extra-large";
}

// A sheet filled elsewhere (the photo step's AI, an older PadSpan) read
// tolerantly: close spellings become the library's values, the rest is left
// for the person.
const squash = (v) => lowerAscii(String(v)).replace(/[^a-z0-9]/g, "");
const SYNONYMS = { kids: "kids-room", kidsroom: "kids-room", nursery: "kids-room", livingroom: "living",
  lounge: "living", diningroom: "dining", hall: "hallway", bath: "bathroom", xl: "extra-large",
  wicker: "rattan", rattanwicker: "rattan", scandi: "scandinavian", modular: "sectional", wheels: "on_wheels",
  storageinside: "storage", arms: "has_arms" };
function canon(v, values){
  const s = squash(v);
  const hit = values.find(x => squash(x) === s);
  if (hit) return hit;
  return values.includes(SYNONYMS[s]) ? SYNONYMS[s] : null;
}
export function normalizeDetails(d){
  const out = {};
  if (!isObj(d)) return out;
  const one = { category: CATEGORIES, style: STYLES, material: MATERIALS, bed_size: BED_SIZES, fixture: FIXTURES,
    form: FORMS };
  for (const [k, values] of Object.entries(one)) if (d[k] != null) { const v = canon(d[k], values); if (v) out[k] = v; }
  for (const [k, values] of [["rooms", ROOMS], ["features", FEATURES]]) {
    const list = Array.isArray(d[k]) ? d[k] : (typeof d[k] === "string" ? d[k].split(/[,;]/) : []);
    const got = [...new Set(list.map(x => canon(x, values)).filter(Boolean))];
    if (got.length) out[k] = values.filter(x => got.includes(x));
  }
  for (const k of Object.keys(COUNTS)) {
    const n = Math.round(Number(d[k]));
    if (d[k] != null && d[k] !== "" && Number.isFinite(n) && n >= COUNTS[k][0] && n <= COUNTS[k][1]) out[k] = n;
  }
  for (const k of ["antenna", "outdoor"]) {
    if (typeof d[k] === "boolean") out[k] = d[k];
    else if (/^(yes|true)$/i.test(String(d[k]))) out[k] = true;
    else if (/^(no|false)$/i.test(String(d[k]))) out[k] = false;
  }
  for (const k of Object.keys(TEXT)) if (typeof d[k] === "string" && trimPhp(d[k])) out[k] = trimPhp(d[k]);
  if (typeof d.kind === "string") out.kind = d.kind;
  if (d.checked === true) out.checked = true;
  return out;
}

const NUMBER_WORDS = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight"];
/** A suggested library title, from the builder's own settings. */
export function suggestTitle(recipe, details, tools){
  const spec = tools && tools.FURNITURE && own(tools.FURNITURE, recipe.kind) ? tools.FURNITURE[recipe.kind] : null;
  const what = lowerAscii((spec && spec.name) || String(recipe.kind || "piece").replace(/_/g, " "));
  const colour = LABELS.color_family[details.color_family] ? lowerAscii(LABELS.color_family[details.color_family]) : "";
  const seats = details.category === "seating" && details.seats > 1 && details.seats <= 8 ? `${NUMBER_WORDS[details.seats]}-seat ` : "";
  const t = `${seats}${colour} ${what}`.trim().replace(/\s+/g, " ");
  const out = t.charAt(0).toUpperCase() + t.slice(1);
  return [...out].length >= TEXT.title[0] ? [...out].slice(0, TEXT.title[1]).join("") : `${out} piece`;
}

/** The sheet a piece starts with: what it already carries (normalised), the
 *  builder's own settings where they say it, and the computed fields. */
export function prefillDetails(recipe, tools){
  const kind = String(recipe && recipe.kind || "");
  const spec = tools && tools.FURNITURE && own(tools.FURNITURE, kind) ? tools.FURNITURE[kind] : null;
  const given = normalizeDetails(recipe && recipe.details);
  const p = isObj(recipe && recipe.params) ? recipe.params : {};
  const d = { ...given };
  d.category = given.category || (spec && CATEGORIES.includes(spec.category) ? spec.category : "other");
  d.kind = spec ? kind : "other";
  d.rooms = given.rooms || [];
  d.style = given.style || "";
  d.material = given.material || "";
  d.color_family = colorFamily((recipe && recipe.colors || [])[0]);
  d.size_class = sizeClass(recipe || {}, tools);
  const int = (v, k) => (Number.isInteger(v) && v >= COUNTS[k][0] && v <= COUNTS[k][1] ? v : undefined);
  if (d.seats === undefined) d.seats = int(p.seats, "seats");
  if (d.bed_size === undefined && BED_SIZES.includes(p.size)) d.bed_size = p.size;
  const sleeps = { twin: 1, double: 2, queen: 2, king: 2, crib: 1, bunk: 2 };
  if (d.seats === undefined && d.category === "sleeping" && sleeps[d.bed_size]) d.seats = sleeps[d.bed_size];
  for (const k of ["drawers", "doors", "shelves", "shades"]) if (d[k] === undefined) d[k] = int(p[k], k);
  if (d.category === "lighting") {
    if (d.fixture === undefined && FIXTURES.includes(p.style)) d.fixture = p.style;
    if (d.shades === undefined && typeof p.shade === "string") d.shades = 1;
  }
  if (d.category === "device") {   // a tag or a scanner: its form, and whether it has an antenna
    if (d.form === undefined && FORMS.includes(p.form)) d.form = p.form;
    if (d.antenna === undefined && typeof p.antenna === "boolean") d.antenna = p.antenna;
  }
  if (kind === "dresser" && Number.isInteger(p.columns)) {   // its fronts, counted
    if (d.drawers === undefined && p.fronts === "drawers" && Number.isInteger(p.rows)) d.drawers = Math.min(50, p.columns * p.rows);
    if (d.doors === undefined && p.fronts === "doors") d.doors = Math.min(50, p.columns);
  }
  if (!given.features) {
    const f = new Set();
    if (p.arms === true || (typeof p.arms === "string" && p.arms !== "none") || p.style === "armchair") f.add("has_arms");
    if (p.style === "office") { f.add("on_wheels"); f.add("adjustable_height"); }
    if (p.reclines === true) f.add("reclines");
    if (p.mount === "wall" || p.style === "wall") f.add("wall_mounted");
    if (d.category !== "storage" && typeof p.drawers === "string" && p.drawers !== "none") f.add("storage");
    d.features = FEATURES.filter(x => f.has(x));
  }
  if (d.outdoor === undefined) d.outdoor = d.category === "outdoor";
  for (const k of Object.keys(d)) if (d[k] === undefined) delete d[k];
  d.title = given.title || suggestTitle(recipe || {}, d, tools);
  return d;
}

// ── Finding pieces (the server's search, for the starter set) ────────────────
export function wordsOf(s){
  const t = trimPhp(lowerAscii(s).replace(/[-_]/g, " "));
  return t === "" ? [] : t.split(/[ \t\n\v\f\r]+/);
}
function haystack(e){
  const d = e.recipe.details || {};
  return wordsOf(["title", "brand", "model", "kind", "style", "material"].filter(k => d[k] != null).map(k => d[k]).join(" ")).join(" ");
}
/** Free floor left around a piece that fits (either way round, with a small
 *  margin), or null when it does not fit. */
export function leftover(r, fits){
  const w = r.width_m + FIT_MARGIN_M, d = r.depth_m + FIT_MARGIN_M, W = fits.width_m, D = fits.depth_m;
  return (w <= W && d <= D) || (d <= W && w <= D) ? W * D - r.width_m * r.depth_m : null;
}
export function matchEntry(e, f, words){
  const d = e.recipe.details || {};
  for (const k of ["category", "kind", "style", "material", "color_family", "size_class", "seats"]) {
    if (f[k] != null && (d[k] == null || d[k] !== f[k])) return false;
  }
  if (f.room != null) {
    const rooms = d.rooms || [];
    if (!rooms.includes(f.room) && !rooms.includes("any")) return false;
  }
  if (f.features != null && !f.features.every(x => (d.features || []).includes(x))) return false;
  if (f.outdoor != null && (d.outdoor != null ? d.outdoor : false) !== f.outdoor) return false;
  if (f.fits != null && leftover(e.recipe, f.fits) === null) return false;
  if (words.length) {
    const hay = ` ${haystack(e)} `;
    if (!words.every(w => hay.includes(w))) return false;
  }
  return true;
}
const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const nameOf = (e) => lowerAscii(e.recipe.details && e.recipe.details.title != null ? e.recipe.details.title : String(e.recipe.kind).replace(/_/g, " "));
export function compareEntries(a, b, sort, fits){
  let c;
  if (sort === "placed") c = cmp(b.houses, a.houses) || cmp(b.created, a.created);
  else if (sort === "newest") c = cmp(b.created, a.created);
  else if (sort === "size") c = cmp(a.recipe.width_m * a.recipe.depth_m, b.recipe.width_m * b.recipe.depth_m) || cmp(a.recipe.height_m, b.recipe.height_m);
  else if (sort === "name") c = cmp(nameOf(a), nameOf(b));
  else c = cmp(leftover(a.recipe, fits), leftover(b.recipe, fits));
  return c || cmp(b.checked ? 1 : 0, a.checked ? 1 : 0) || cmp(a.key, b.key);
}
/** The server's search over a list of entries: {total, entries}. */
export function searchEntries(entries, q = {}){
  const f = q.filters || {}, words = wordsOf(q.text || "");
  const sort = SORTS.includes(q.sort) && (q.sort !== "fit" || f.fits) ? q.sort : "placed";
  const list = entries.filter(e => matchEntry(e, f, words));
  list.sort((a, b) => compareEntries(a, b, sort, f.fits));
  const offset = q.offset || 0, limit = q.limit || PAGE;
  return { total: list.length, entries: list.slice(offset, offset + limit) };
}

// ── The starter set (assets/furniture_starters.json) ─────────────────────────
let startersP = null;
export function starterEntries(json){
  const pieces = json && Array.isArray(json.pieces) ? json.pieces : [];
  // Keyed by place in the file, so pieces that tie keep the set's own order.
  return pieces.filter(p => p && isObj(p.recipe) && typeof p.id === "string").map((p, i) => ({
    library_id: null, key: `starter:${String(i).padStart(3, "0")}:${p.id}`, starter: true, recipe: p.recipe, houses: 0, copies: 0,
    checked: true, created: "",
  }));
}
export function loadStarters(){
  if (!startersP) {
    startersP = fetch(new URL(`../assets/furniture_starters.json${new URL(import.meta.url).search}`, import.meta.url))
      .then(r => (r.ok ? r.json() : null)).then(starterEntries).catch(() => { startersP = null; return []; });
  }
  return startersP;
}
export function _setStartersForTests(json){ startersP = Promise.resolve(starterEntries(json)); }

// ── "Fits here" ──────────────────────────────────────────────────────────────
const pos = (v) => finite(Number(v)) && Number(v) > 0;
function bbox(points){
  const pts = (points || []).map(q => [Number(q[0]), Number(q[1])]).filter(q => finite(q[0]) && finite(q[1]));
  if (pts.length < 3) return null;
  const xs = pts.map(q => q[0]), ys = pts.map(q => q[1]);
  const w = Math.max(...xs) - Math.min(...xs), d = Math.max(...ys) - Math.min(...ys);
  return w > 0 && d > 0 ? { width_m: +w.toFixed(2), depth_m: +d.toFixed(2) } : null;
}
/** The space "Fits here" means: the free floor space the Furnish tab passed
 *  (ctx.space), else the room's size (ctx.room's own size or outline). */
export function fitSpace(ctx){
  const sp = ctx && ctx.space;
  if (sp && pos(sp.width_m) && pos(sp.depth_m)) return { width_m: +sp.width_m, depth_m: +sp.depth_m, what: "space" };
  const room = ctx && ctx.room;
  if (room && pos(room.width_m) && pos(room.depth_m)) return { width_m: +room.width_m, depth_m: +room.depth_m, what: "room" };
  const b = room && bbox(room.points_m);
  return b ? { ...b, what: "room" } : null;
}
async function roomSpace(ctx){
  const direct = fitSpace(ctx);
  if (direct || !(ctx && ctx.room && ctx.room.name)) return direct;
  try {   // only the room's name was passed: its outline, read once
    const m = await ctx.callWS({ type: "padspan_ha/model_get" });
    const g = m && m.room_geometry_m && m.room_geometry_m[ctx.room.name];
    const b = g && bbox(g.points_m);
    return b ? { ...b, what: "room" } : null;
  } catch (_) { return null; }
}

// ── Thumbnails ───────────────────────────────────────────────────────────────
const TW = 160, TH = 120;
function sketch(g, recipe, W, H){
  const w = finite(recipe.width_m) ? recipe.width_m : 1, d = finite(recipe.depth_m) ? recipe.depth_m : 0.5;
  const h = finite(recipe.height_m) ? recipe.height_m : 0.8;
  const cols = (recipe.colors || []).filter(c => /^#[0-9a-f]{6}$/i.test(c));
  const c0 = cols[0] || "#8a8f98";
  const k = Math.min((W * 0.78) / (w + d * 0.45), (H * 0.78) / (h + d * 0.3));
  const fw = w * k, fh = h * k, dx = d * k * 0.45, dy = d * k * 0.3;
  const x = (W - fw - dx) / 2, y = (H + fh - dy) / 2 + dy / 2;
  g.clearRect(0, 0, W, H);
  g.fillStyle = c0;
  g.fillRect(x, y - fh, fw, fh);
  g.globalAlpha = 0.75;
  g.beginPath(); g.moveTo(x, y - fh); g.lineTo(x + dx, y - fh - dy); g.lineTo(x + fw + dx, y - fh - dy); g.lineTo(x + fw, y - fh); g.closePath(); g.fill();
  g.globalAlpha = 0.55;
  g.beginPath(); g.moveTo(x + fw, y); g.lineTo(x + fw + dx, y - dy); g.lineTo(x + fw + dx, y - fh - dy); g.lineTo(x + fw, y - fh); g.closePath(); g.fill();
  g.globalAlpha = 1;
  if (cols[1]) { g.fillStyle = cols[1]; g.fillRect(x, y - fh * 0.62, fw, Math.max(2, fh * 0.1)); }
  g.strokeStyle = "rgba(0,0,0,.35)"; g.lineWidth = 1; g.strokeRect(x + 0.5, y - fh + 0.5, fw - 1, fh - 1);
}
/** One offscreen renderer for a flow's thumbnails; dispose() frees it. */
function thumbnailer(tools){
  let THREE = null, renderer = null, scene = null, camera = null, tried = false, gone = false, busy = false;
  const queue = [];
  async function start(){
    if (tried) return;
    tried = true;
    if (!tools || typeof tools.buildPiece !== "function") return;
    try {
      THREE = await import(`../vendor/three/three.module.min.js${new URL(import.meta.url).search}`);
      if (gone) return;
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "low-power" });
      renderer.setPixelRatio(1);
      renderer.setSize(TW * 2, TH * 2, false);
      scene = new THREE.Scene();
      scene.add(new THREE.HemisphereLight(0xffffff, 0x3a4a40, 1.7));
      const sun = new THREE.DirectionalLight(0xffffff, 1.5);
      sun.position.set(2, 4, 3);
      scene.add(sun);
      camera = new THREE.PerspectiveCamera(28, TW / TH, 0.01, 200);
    } catch (_) { renderer = null; }
  }
  function drawOne(recipe, canvas){
    const g = canvas.getContext && canvas.getContext("2d");
    if (!g) return;
    if (renderer) {
      let group = null;
      try {
        group = tools.buildPiece(THREE, recipe, { quality: "low" });
        scene.add(group);
        const s = typeof tools.pieceSize === "function" ? tools.pieceSize(recipe) : { w: recipe.width_m, d: recipe.depth_m, h: recipe.height_m };
        const r = Math.max(0.15, Math.hypot(s.w, s.d, s.h) / 2);
        const target = new THREE.Vector3(0, s.h / 2, 0);
        const dir = new THREE.Vector3(0.7, 0.55, 1).normalize();    // the front faces +z: front, right, a little above
        camera.position.copy(target).addScaledVector(dir, (r / Math.sin((camera.fov / 2) * Math.PI / 180)) * 1.02);
        camera.lookAt(target);
        renderer.render(scene, camera);
        g.clearRect(0, 0, canvas.width, canvas.height);
        g.drawImage(renderer.domElement, 0, 0, canvas.width, canvas.height);
        return;
      } catch (_) { /* the sketch below */ } finally {
        if (group) { scene.remove(group); try { tools.disposePiece(group); } catch (_) { /* best effort */ } }
      }
    }
    sketch(g, recipe, canvas.width, canvas.height);
  }
  async function pump(){
    if (busy) return;
    busy = true;
    await start();
    while (queue.length && !gone) {
      for (const [recipe, canvas] of queue.splice(0, 4)) if (canvas.isConnected !== false) drawOne(recipe, canvas);
      await new Promise(res => setTimeout(res, 0));
    }
    busy = false;
  }
  return {
    draw(recipe, canvas){ if (!gone) { queue.push([recipe, canvas]); pump(); } },
    dispose(){
      gone = true;
      queue.length = 0;
      try { if (renderer) { renderer.dispose(); renderer.forceContextLoss(); } } catch (_) { /* best effort */ }
      renderer = null; scene = null;
    },
  };
}

// ── The page ─────────────────────────────────────────────────────────────────
const CSS = `
.lal{font:14px/1.45 system-ui,-apple-system,"Segoe UI",sans-serif;color:#e2e8f0;background:#0b1410;border:1px solid rgba(120,190,155,.28);
  border-radius:14px;padding:12px;box-sizing:border-box;max-width:100%}
.lal *{box-sizing:border-box}
.lal-head{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin-bottom:10px}
.lal-head h3{margin:0;font-size:17px;color:#a7f3d0;flex:1 1 auto}
.lal button{font:inherit;color:#e2e8f0;background:#16241c;border:1px solid #2d4a37;border-radius:9px;padding:7px 12px;cursor:pointer;min-height:36px}
.lal button:hover{border-color:#52b788}
.lal button:disabled{opacity:.45;cursor:default}
.lal button.lal-go{background:#52b788;color:#06210f;border-color:#52b788;font-weight:700}
.lal button.lal-link{background:none;border:none;color:#7dd3fc;padding:4px 6px;min-height:0;text-decoration:underline}
.lal input[type=text],.lal input[type=search],.lal input[type=number],.lal select{font:inherit;color:#e2e8f0;background:#0a150e;
  border:1px solid #2d4a37;border-radius:8px;padding:7px 9px;min-height:36px;max-width:100%}
.lal-row{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin:6px 0}
.lal-row > label{display:flex;align-items:center;gap:6px;color:#cbd5e1}
.lal-search{flex:1 1 220px;min-width:0}
.lal-filters{display:none;padding:8px;border:1px solid #1e3a2a;border-radius:10px;margin:6px 0 4px;background:#0d1a13}
.lal-filters.on{display:block}
.lal-filters select{flex:1 1 140px;min-width:0}
.lal-chips{display:flex;flex-wrap:wrap;gap:6px;margin:6px 0}
.lal-chip{border-radius:999px!important;padding:5px 11px!important;min-height:32px!important;font-size:13px}
.lal-chip[aria-pressed=true]{background:rgba(82,183,136,.28)!important;border-color:#52b788!important;color:#ecfdf5!important}
.lal-status{font-size:12.5px;color:#94a3b8;margin:8px 2px}
.lal-status.warn{color:#fcd34d}
.lal-sec{margin-top:12px}
.lal-sec h4{margin:0 0 6px;font-size:14px;color:#cbd5e1}
.lal-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(168px,1fr));gap:10px}
.lal-card{display:flex;flex-direction:column;gap:4px;padding:8px;border-radius:12px;background:#101c15;border:1px solid #1f3a2a;min-width:0}
.lal-card canvas{width:100%;height:auto;aspect-ratio:4/3;border-radius:8px;background:radial-gradient(circle at 50% 35%,#1d3326,#0d1812)}
.lal-card .t{font-weight:600;color:#f1f5f9;overflow-wrap:anywhere}
.lal-card .m{font-size:12px;color:#94a3b8}
.lal-tags{display:flex;flex-wrap:wrap;gap:4px}
.lal-tag{font-size:11px;padding:1px 7px;border-radius:999px;background:#17291f;color:#cbd5e1;display:inline-flex;align-items:center;gap:4px}
.lal-dot{width:9px;height:9px;border-radius:50%;border:1px solid rgba(255,255,255,.4);display:inline-block}
.lal-ok{color:#86efac}
.lal-card .acts{display:flex;gap:6px;flex-wrap:wrap;margin-top:auto}
.lal-card .acts button{flex:1 1 auto}
.lal-report{font-size:12.5px;color:#cbd5e1}
.lal-terms{max-width:760px}
.lal-draft{display:inline-block;margin:0 0 8px;padding:3px 10px;border-radius:999px;background:#3b2a07;color:#fcd34d;font-size:12.5px;font-weight:600}
.lal-terms ul{margin:6px 0 10px;padding-left:20px}
.lal-terms li{margin:6px 0}
.lal-sheet{display:grid;grid-template-columns:minmax(0,190px) minmax(0,1fr);gap:12px}
.lal-sheet .lal-side canvas{width:100%;height:auto;aspect-ratio:4/3;border-radius:10px;background:radial-gradient(circle at 50% 35%,#1d3326,#0d1812)}
.lal-field{display:flex;flex-direction:column;gap:3px;margin:8px 0}
.lal-field > span{font-size:12.5px;color:#cbd5e1}
.lal-field > span b{color:#fca5a5;font-weight:600}
.lal-field.bad input,.lal-field.bad select{border-color:#ef4444}
.lal-field .why{font-size:12.5px;color:#fca5a5}
.lal-two{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:0 12px}
.lal-fixed{font-size:13px;color:#e2e8f0;padding:6px 0}
.lal-note{font-size:12px;color:#94a3b8}
.lal-msg{margin:8px 0;padding:8px 10px;border-radius:9px;background:#3a1212;color:#fecaca;font-size:13px;display:none}
.lal-msg.on{display:block}
.lal-msg.good{background:#0f2e1d;color:#bbf7d0}
@media (max-width:560px){.lal{padding:10px}.lal-sheet{grid-template-columns:1fr}.lal-sheet .lal-side canvas{max-width:220px}
  .lal-grid{grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}}
`;

function h(tag, attrs, kids){
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === "class") n.className = v;
    else if (k === "text") n.textContent = v;
    else if (k === "style") n.style.cssText = v;
    else if (k.startsWith("on") && typeof v === "function") n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v === true ? "" : String(v));
  }
  for (const c of [].concat(kids || [])) {
    if (c === null || c === undefined || c === false) continue;
    n.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
  }
  return n;
}
function mount(ctx, cls){
  const root = h("div", { class: `lal ${cls}` });
  const style = h("style");
  style.textContent = CSS;
  root.appendChild(style);
  ctx.el.replaceChildren(root);
  return root;
}
const wsCall = (ctx) => (ctx && (ctx.callWS || ctx.wsCall)) || (() => Promise.reject(new Error("no connection")));
const errText = (e) => String((e && (e.message || e.code)) || e || "error");
const metres = (v) => (finite(v) ? v.toFixed(2) : "?");
const kindName = (tools, kind) => {
  const spec = tools && tools.FURNITURE && own(tools.FURNITURE, kind) ? tools.FURNITURE[kind] : null;
  const word = String(kind || "piece").replace(/_/g, " ");
  return (spec && spec.name) || (word.length <= 2 ? word.toUpperCase() : word.charAt(0).toUpperCase() + word.slice(1));
};
function select(label, values, labels, value, anyLabel){
  const s = h("select", { "aria-label": label });
  if (anyLabel) s.appendChild(h("option", { value: "" }, anyLabel));
  for (const v of values) s.appendChild(h("option", { value: v }, labels ? labels[v] || v : v));
  s.value = value == null ? "" : String(value);
  return s;
}
function chips(values, labels, picked, onChange){
  const box = h("div", { class: "lal-chips" });
  for (const v of values) {
    const b = h("button", { type: "button", class: "lal-chip", "aria-pressed": picked.includes(v) ? "true" : "false", "data-v": v }, labels[v] || v);
    b.addEventListener("click", () => {
      const on = b.getAttribute("aria-pressed") !== "true";
      b.setAttribute("aria-pressed", on ? "true" : "false");
      onChange(v, on);
    });
    box.appendChild(b);
  }
  return box;
}

// ── libraryFlow ──────────────────────────────────────────────────────────────
export function libraryFlow(ctx){
  return new Promise((resolve) => {
    const tools = ctx.recipeTools || null;
    const call = wsCall(ctx);
    const libraryOn = !!(ctx.settings && ctx.settings.atlas_3d_library === true);
    const root = mount(ctx, "lal-lib");
    const thumbs = thumbnailer(tools);
    let closed = false, seq = 0, timer = null, starters = [], space = null;
    const q = { text: "", filters: {}, sort: "placed" };
    const lib = { entries: [], total: 0, offset: 0, state: libraryOn ? "busy" : "off" };
    const finish = (value) => {
      if (closed) return;
      closed = true;
      if (timer) clearTimeout(timer);
      thumbs.dispose();
      try { ctx.el.replaceChildren(); } catch (_) { /* the host may have taken it already */ }
      resolve(value);
    };

    // Header
    const termsBtn = h("button", { type: "button", class: "lal-link", "data-lal": "terms" }, "How the library works");
    const closeBtn = h("button", { type: "button", "data-lal": "close" }, "Close");
    root.appendChild(h("div", { class: "lal-head" }, [h("h3", {}, "Library"), termsBtn, closeBtn]));
    closeBtn.addEventListener("click", () => finish(null));
    const main = h("div", { "data-lal": "main" });
    root.appendChild(main);

    // Search, sort, Fits here, Filters
    const search = h("input", { type: "search", class: "lal-search", placeholder: "Search: title, brand, model, kind, style…", "data-lal": "search", "aria-label": "Search the library" });
    const sortSel = select("Sort", SORTS.filter(s => s !== "fit"), LABELS.sort, "placed");
    sortSel.setAttribute("data-lal", "sort");
    const fitsBtn = h("button", { type: "button", class: "lal-chip", "aria-pressed": "false", "data-lal": "fits" }, "Fits here");
    const filtBtn = h("button", { type: "button", "aria-expanded": "false", "data-lal": "filters-toggle" }, "Filters");
    main.appendChild(h("div", { class: "lal-row" }, [search, sortSel, fitsBtn, filtBtn]));
    if (!(ctx.space || ctx.room)) fitsBtn.style.display = "none";   // no spot to fit: nothing to filter by
    const fitsNote = h("div", { class: "lal-note", style: "display:none" });
    main.appendChild(fitsNote);

    const panel = h("div", { class: "lal-filters", "data-lal": "filters" });
    const wide = ((ctx.el && ctx.el.clientWidth) || (typeof window !== "undefined" ? window.innerWidth : 0) || 0) >= 760;
    if (wide) { panel.classList.add("on"); filtBtn.setAttribute("aria-expanded", "true"); }
    filtBtn.addEventListener("click", () => {
      const on = !panel.classList.contains("on");
      panel.classList.toggle("on", on);
      filtBtn.setAttribute("aria-expanded", on ? "true" : "false");
    });
    const kinds = tools && Array.isArray(tools.FURNITURE_KINDS) ? tools.FURNITURE_KINDS : [];
    const fsel = {
      category: select("Category", CATEGORIES, LABELS.category, "", "Any category"),
      kind: select("Kind", kinds, Object.fromEntries(kinds.map(k => [k, kindName(tools, k)])), "", "Any kind"),
      room: select("Room", ROOMS, LABELS.room, "", "Any room"),
      style: select("Style", STYLES, LABELS.style, "", "Any style"),
      material: select("Material", MATERIALS, LABELS.material, "", "Any material"),
      color_family: select("Colour", COLOR_FAMILIES, LABELS.color_family, "", "Any colour"),
      size_class: select("Size", SIZE_CLASSES, LABELS.size_class, "", "Any size"),
      seats: select("Seats", ["1", "2", "3", "4", "5", "6", "7", "8"], null, "", "Any seats"),
      outdoor: select("Outdoor", ["yes", "no"], { yes: "Outdoor-rated", no: "Indoor" }, "", "Indoor or outdoor"),
    };
    for (const [k, s] of Object.entries(fsel)) {
      s.setAttribute("data-filter", k);
      s.addEventListener("change", () => {
        const v = s.value;
        if (!v) delete q.filters[k];
        else q.filters[k] = k === "seats" ? Number(v) : k === "outdoor" ? v === "yes" : v;
        refresh();
      });
    }
    panel.appendChild(h("div", { class: "lal-row" }, Object.values(fsel)));
    panel.appendChild(chips(FEATURES, LABELS.feature, [], (v, on) => {
      const f = new Set(q.filters.features || []);
      if (on) f.add(v); else f.delete(v);
      if (f.size) q.filters.features = FEATURES.filter(x => f.has(x)); else delete q.filters.features;
      refresh();
    }));
    const clearBtn = h("button", { type: "button", class: "lal-link", "data-lal": "clear" }, "Clear filters");
    clearBtn.addEventListener("click", () => {
      for (const s of Object.values(fsel)) s.value = "";
      for (const b of panel.querySelectorAll(".lal-chip")) b.setAttribute("aria-pressed", "false");
      const fits = q.filters.fits;
      q.filters = fits ? { fits } : {};
      refresh();
    });
    panel.appendChild(clearBtn);
    main.appendChild(panel);

    const status = h("div", { class: "lal-status", "data-lal": "status" });
    main.appendChild(status);
    const libSec = h("div", { class: "lal-sec", "data-lal": "shared" }, [h("h4", {}, "Shared by PadSpan houses")]);
    const libGrid = h("div", { class: "lal-grid" });
    const moreBtn = h("button", { type: "button", style: "display:none;margin-top:8px", "data-lal": "more" }, "More");
    libSec.append(libGrid, moreBtn);
    const stSec = h("div", { class: "lal-sec", "data-lal": "starters", style: "display:none" });
    const stHead = h("h4", {}, "Starter set");
    const stGrid = h("div", { class: "lal-grid" });
    stSec.append(stHead, stGrid);
    main.append(libSec, stSec);
    if (!libraryOn) libSec.style.display = "none";

    search.addEventListener("input", () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => { timer = null; q.text = search.value.slice(0, 60); refresh(); }, 300);
    });
    sortSel.addEventListener("change", () => { q.sort = sortSel.value; refresh(); });
    moreBtn.addEventListener("click", () => fetchLibrary(true));
    termsBtn.addEventListener("click", () => {   // read only: browsing needs no terms
      main.style.display = "none";
      termsBtn.style.display = "none";
      const box = showTerms(root, { onBack: () => { box.remove(); main.style.display = ""; termsBtn.style.display = ""; } });
    });

    fitsBtn.addEventListener("click", async () => {
      const on = fitsBtn.getAttribute("aria-pressed") !== "true";
      if (on && !space) {
        fitsBtn.disabled = true;
        space = await roomSpace(ctx);
        fitsBtn.disabled = false;
        if (closed) return;
        if (!space) {
          fitsNote.textContent = "This spot's free space isn't known, so Fits here can't filter.";
          fitsNote.style.display = "";
          return;
        }
      }
      fitsBtn.setAttribute("aria-pressed", on ? "true" : "false");
      const fitOpt = sortSel.querySelector("option[value=fit]");
      if (on) {
        q.filters.fits = { width_m: space.width_m, depth_m: space.depth_m };
        if (!fitOpt) sortSel.appendChild(h("option", { value: "fit" }, LABELS.sort.fit));
        sortSel.value = "fit";
        q.sort = "fit";
        fitsNote.textContent = `Only pieces that fit ${space.what === "space" ? "the free space here" : "this room"}: ${metres(space.width_m)} × ${metres(space.depth_m)} m.`;
        fitsNote.style.display = "";
      } else {
        delete q.filters.fits;
        if (fitOpt) fitOpt.remove();
        if (q.sort === "fit") { q.sort = "placed"; sortSel.value = "placed"; }
        fitsNote.textContent = "";
        fitsNote.style.display = "none";
      }
      refresh();
    });

    function card(e){
      const r = e.recipe, d = r.details || {};
      const cv = h("canvas", { width: String(TW * 2), height: String(TH * 2), "aria-hidden": "true" });
      thumbs.draw(r, cv);
      const title = d.title || kindName(tools, r.kind);
      const tags = h("div", { class: "lal-tags" });
      if (d.size_class) tags.appendChild(h("span", { class: "lal-tag" }, LABELS.size_class[d.size_class] || d.size_class));
      if (d.color_family) tags.appendChild(h("span", { class: "lal-tag" }, [h("span", { class: "lal-dot", style: `background:${SWATCH[d.color_family] || "#888"}` }), LABELS.color_family[d.color_family] || d.color_family]));
      if (d.style) tags.appendChild(h("span", { class: "lal-tag" }, LABELS.style[d.style] || d.style));
      if (e.checked && !e.starter) tags.appendChild(h("span", { class: "lal-tag lal-ok", title: "A person checked these details" }, "✓ details checked"));
      const meta = `${kindName(tools, r.kind)} · ${metres(r.width_m)} × ${metres(r.depth_m)} × ${metres(r.height_m)} m`;
      const place = h("button", { type: "button", class: "lal-go", "data-lal": "place" }, "Place");
      const acts = h("div", { class: "acts" }, [place]);
      const n = h("div", { class: "lal-card", "data-key": e.key }, [cv, h("div", { class: "t" }, title), h("div", { class: "m" }, meta),
        d.brand || d.model ? h("div", { class: "m" }, [d.brand, d.model].filter(Boolean).join(" ")) : null, tags,
        e.starter ? null : h("div", { class: "m" }, e.houses === 1 ? "In 1 house" : `In ${e.houses} houses`), acts]);
      place.addEventListener("click", () => placeIt(e, place));
      if (!e.starter) {
        const rep = h("button", { type: "button", "data-lal": "report" }, "Report");
        acts.appendChild(rep);
        rep.addEventListener("click", () => {
          const row = h("div", { class: "lal-report" }, ["What's wrong? "]);
          const done = (text) => { row.textContent = text; };
          for (const [reason, label] of [["details", "Wrong details"], ["title", "Bad title"]]) {
            const b = h("button", { type: "button", "data-reason": reason }, label);
            b.addEventListener("click", async () => {
              try {
                await call({ type: "padspan_ha/house3d_library_report", library_id: e.library_id, reason });
                done("Thanks, reported.");
              } catch (err) { done(`Could not report it: ${errText(err)}`); }
            });
            row.appendChild(b);
          }
          rep.style.display = "none";
          n.appendChild(row);
        });
      }
      return n;
    }
    const tidy = (r) => {
      let out = JSON.parse(JSON.stringify(r));
      try {
        if (tools && typeof tools.clampRecipe === "function") {
          const c = tools.clampRecipe(out);
          if (isObj(c)) out = { ...c, details: out.details };
        }
      } catch (_) { /* placed as it came */ }
      return out;
    };
    async function placeIt(e, btn){
      btn.disabled = true;
      let recipe = e.recipe;
      if (e.library_id) {
        try {   // counts the placing; the piece is placed even if the library has gone quiet
          const r = await call({ type: "padspan_ha/house3d_library_get", library_id: e.library_id, placed: true });
          if (r && r.entry && isObj(r.entry.recipe)) recipe = r.entry.recipe;
        } catch (_) { /* placed from what was shown */ }
      }
      finish({ recipe: tidy(recipe), library_id: e.library_id || null });
    }

    function renderStarters(){
      const found = searchEntries(starters, { ...q, offset: 0, limit: 1000 });
      stGrid.replaceChildren(...found.entries.map(card));
      stHead.textContent = found.total ? `Starter set (${found.total})` : "Starter set: nothing matches";
      stSec.style.display = starters.length ? "" : "none";
    }
    function setStatus(){
      const n = lib.total;
      const text = {
        off: "The shared library is off, so these are the starter pieces that come with PadSpan. An administrator can turn it on in Settings → UI Structure → Atlas → 3D house.",
        down: "Can't reach the shared library right now. The starter set below still works.",
        busy: "Searching the shared library…",
        ok: n ? `${n} shared piece${n === 1 ? "" : "s"} found.` : "No shared pieces match. Try fewer filters.",
      }[lib.state];
      status.textContent = text;
      status.classList.toggle("warn", lib.state === "down");
    }
    async function fetchLibrary(more){
      if (!libraryOn) { lib.state = "off"; setStatus(); return; }
      const mine = ++seq;
      lib.offset = more ? lib.offset + PAGE : 0;
      if (!more) { lib.state = "busy"; setStatus(); }
      moreBtn.disabled = true;
      const msg = { type: "padspan_ha/house3d_library_search", sort: q.sort, offset: lib.offset, limit: PAGE };
      if (q.text.trim()) msg.text = q.text.trim();
      if (Object.keys(q.filters).length) msg.filters = q.filters;
      try {
        const r = await call(msg);
        if (closed || mine !== seq) return;
        const got = (r && Array.isArray(r.entries) ? r.entries : []).map(x => ({ ...x, key: x.library_id }));
        lib.entries = more ? lib.entries.concat(got) : got;
        lib.total = r && Number.isInteger(r.total) ? r.total : lib.entries.length;
        lib.state = "ok";
        if (more) libGrid.append(...got.map(card)); else libGrid.replaceChildren(...got.map(card));
        libSec.style.display = "";
      } catch (err) {
        if (closed || mine !== seq) return;
        lib.state = err && err.code === "library_off" ? "off" : "down";
        if (!more) { lib.entries = []; libGrid.replaceChildren(); libSec.style.display = "none"; }
      }
      moreBtn.disabled = false;
      moreBtn.style.display = lib.state === "ok" && lib.entries.length < lib.total ? "" : "none";
      setStatus();
    }
    function refresh(){
      if (closed) return;
      renderStarters();
      fetchLibrary(false);
    }

    setStatus();
    loadStarters().then(list => { if (closed) return; starters = list; renderStarters(); });
    fetchLibrary(false);
  });
}

// ── The terms screen ─────────────────────────────────────────────────────────
function showTerms(root, { onAccept, onBack, onLater }){
  const box = h("div", { class: "lal-terms", "data-lal": "terms-screen" });
  box.appendChild(h("h3", { style: "margin:0 0 6px;color:#a7f3d0" }, TERMS.title));
  box.appendChild(h("div", { class: "lal-draft" }, TERMS.status));
  box.appendChild(h("ul", {}, TERMS.points.map(p => h("li", {}, p))));
  const msg = h("div", { class: "lal-msg" });
  box.appendChild(msg);
  const row = h("div", { class: "lal-row" });
  if (onAccept) {
    const yes = h("button", { type: "button", class: "lal-go", "data-lal": "accept" }, "Accept and continue");
    yes.addEventListener("click", async () => {
      yes.disabled = true;
      const err = await onAccept();
      if (err) { msg.textContent = err; msg.classList.add("on"); yes.disabled = false; }
    });
    row.appendChild(yes);
  }
  if (onLater) {
    const no = h("button", { type: "button", "data-lal": "later" }, "Not now");
    no.addEventListener("click", onLater);
    row.appendChild(no);
  }
  if (onBack) {
    const back = h("button", { type: "button", "data-lal": "back" }, "Back to the library");
    back.addEventListener("click", onBack);
    row.appendChild(back);
  }
  box.appendChild(row);
  root.appendChild(box);
  return box;
}

// ── shareFlow ────────────────────────────────────────────────────────────────
/** Only the keys a recipe shares, and the sheet: the rest of the piece (where
 *  it sits, its name here, the device it is) never goes, from here either. */
export function shareRecipe(recipe, details){
  const out = {};
  for (const k of RECIPE_KEYS) if (k !== "details" && recipe && own(recipe, k)) out[k] = JSON.parse(JSON.stringify(recipe[k]));
  out.details = details;
  return out;
}

export function shareFlow(ctx, piece){
  return new Promise((resolve) => {
    const tools = ctx.recipeTools || null;
    const call = wsCall(ctx);
    const root = mount(ctx, "lal-share");
    let closed = false;
    const thumbs = thumbnailer(tools);
    const finish = (value) => {
      if (closed) return;
      closed = true;
      thumbs.dispose();
      try { ctx.el.replaceChildren(); } catch (_) { /* the host may have taken it already */ }
      resolve(value);
    };
    const recipe = piece && isObj(piece.recipe) ? piece.recipe : {};
    const head = (title) => {
      const close = h("button", { type: "button", "data-lal": "close" }, "Close");
      close.addEventListener("click", () => finish(null));
      return h("div", { class: "lal-head" }, [h("h3", {}, title), close]);
    };
    const clear = () => { for (const n of [...root.children]) if (n.tagName !== "STYLE") n.remove(); };

    async function start(){
      if (!(ctx.settings && ctx.settings.atlas_3d_library === true)) {
        root.appendChild(head("Share to the library"));
        root.appendChild(h("p", { "data-lal": "off" }, "The shared library is off. An administrator can turn it on in Settings → UI Structure → Atlas → 3D house → Shared library."));
        return;
      }
      let accepted = false;
      try {
        const r = await call({ type: "padspan_ha/house3d_get" });
        accepted = !!(r && r.data && r.data.library && r.data.library.terms_version === TERMS_VERSION);
      } catch (_) { accepted = false; }
      if (closed) return;
      if (accepted) { sheet(); return; }
      root.appendChild(head("Share to the library"));
      showTerms(root, {
        onAccept: async () => {
          try {
            await call({ type: "padspan_ha/house3d_terms_accept", version: TERMS_VERSION });
          } catch (e) { return `Could not save that: ${errText(e)}`; }
          if (!closed) { clear(); sheet(); }
          return "";
        },
        onLater: () => finish(null),
      });
    }

    function sheet(){
      const prefilled = prefillDetails(recipe, tools);
      const fromAi = isObj(recipe.details) && Object.keys(recipe.details).length > 0;
      const d = JSON.parse(JSON.stringify(prefilled));
      let changed = false;
      const kindForSheet = d.kind;
      root.appendChild(head(piece && piece.submission_id ? "Update its library details" : "Share to the library"));
      const grid = h("div", { class: "lal-sheet" });
      const side = h("div", { class: "lal-side" });
      const cv = h("canvas", { width: String(TW * 2), height: String(TH * 2), "aria-hidden": "true" });
      thumbs.draw(recipe, cv);
      side.append(cv, h("div", { class: "lal-fixed" }, `${kindName(tools, recipe.kind)} · ${metres(recipe.width_m)} × ${metres(recipe.depth_m)} × ${metres(recipe.height_m)} m`),
        h("div", { class: "lal-note" }, "Only its shape, sizes, colours and this sheet are shared. Never where it sits, its name in your house, a photo, or the device it is."));
      const main = h("div", {});
      grid.append(side, main);
      root.appendChild(grid);
      const fields = {};
      const field = (key, label, input, required) => {
        const why = h("div", { class: "why" });
        const f = h("label", { class: "lal-field", "data-field": key }, [h("span", {}, [label, required ? h("b", {}, " *") : null]), input, why]);
        fields[key] = { box: f, why };
        return f;
      };
      const touch = () => { changed = true; };
      const sel = (key, values, labels, anyLabel) => {
        const s = select(FIELD_NAME[key] || key.replace(/_/g, " "), values, labels, d[key], anyLabel || "Choose…");
        s.addEventListener("change", () => { if (s.value) d[key] = s.value; else delete d[key]; touch(); if (key === "category") conditional(); });
        return s;
      };
      const numIn = (key, lo, hi) => {
        const i = h("input", { type: "number", min: String(lo), max: String(hi), step: "1", inputmode: "numeric", style: "width:96px" });
        i.value = d[key] == null ? "" : String(d[key]);
        i.addEventListener("input", () => { if (i.value === "") delete d[key]; else d[key] = Number(i.value); touch(); });
        return i;
      };
      const textIn = (key, max, hint) => {
        const i = h("input", { type: "text", maxlength: String(max + 20), placeholder: hint || "" });
        i.value = d[key] || "";
        i.addEventListener("input", () => { d[key] = i.value; touch(); });
        return i;
      };

      const titleIn = textIn("title", TEXT.title[1], "A short name others will see");
      main.appendChild(field("title", "Library title (not its name in your house)", titleIn));
      main.appendChild(h("div", { class: "lal-two" }, [field("brand", "Brand", textIn("brand", TEXT.brand[1], "Optional")),
        field("model", "Model", textIn("model", TEXT.model[1], "Optional"))]));
      main.appendChild(h("div", { class: "lal-two" }, [
        field("category", "Category", sel("category", CATEGORIES, LABELS.category), true),
        field("kind", "Kind", h("div", { class: "lal-fixed" }, kindForSheet === "other" ? "Other" : kindName(tools, kindForSheet)), true),
      ]));
      const roomChips = chips(ROOMS, LABELS.room, d.rooms || [], (v, on) => {
        const s = new Set(d.rooms || []);
        if (on) s.add(v); else s.delete(v);
        d.rooms = ROOMS.filter(x => s.has(x));
        touch();
      });
      main.appendChild(field("rooms", "Rooms it suits", roomChips, true));
      main.appendChild(h("div", { class: "lal-two" }, [
        field("style", "Style", sel("style", STYLES, LABELS.style), true),
        field("material", "Main material", sel("material", MATERIALS, LABELS.material), true),
      ]));
      main.appendChild(h("div", { class: "lal-two" }, [
        field("color_family", "Colour family", h("div", { class: "lal-fixed" }, [h("span", { class: "lal-dot", style: `background:${SWATCH[d.color_family]};margin-right:6px` }), `${LABELS.color_family[d.color_family]} (from its main colour)`]), true),
        field("size_class", "Size", h("div", { class: "lal-fixed" }, `${LABELS.size_class[d.size_class]} for a ${lowerAscii(kindName(tools, recipe.kind))}`), true),
      ]));
      const cond = h("div", {});
      main.appendChild(cond);
      function conditional(){
        cond.replaceChildren();
        const cat = d.category;
        const row = [];
        if (["seating", "sleeping", "kids", "outdoor", "tables"].includes(cat)) row.push(field("seats", cat === "sleeping" ? "Sleeps" : "Seats", numIn("seats", 1, 8)));
        if (["sleeping", "kids"].includes(cat)) row.push(field("bed_size", "Bed size", sel("bed_size", BED_SIZES, LABELS.bed_size, "—")));
        if (cat === "lighting") row.push(field("fixture", "Fixture", sel("fixture", FIXTURES, LABELS.fixture, "—")), field("shades", "Shades", numIn("shades", 0, 12)));
        if (cat === "device") {
          const ant = h("input", { type: "checkbox" });
          ant.checked = d.antenna === true;
          ant.addEventListener("change", () => { d.antenna = ant.checked; touch(); });
          row.push(field("form", "Form", sel("form", FORMS, LABELS.form, "—")), field("antenna", "Antenna", ant));
        }
        row.push(field("drawers", "Drawers", numIn("drawers", 0, 50)), field("doors", "Doors", numIn("doors", 0, 50)), field("shelves", "Shelves", numIn("shelves", 0, 50)));
        cond.appendChild(h("div", { class: "lal-two" }, row));
      }
      conditional();
      main.appendChild(field("features", "Features", chips(FEATURES, LABELS.feature, d.features || [], (v, on) => {
        const s = new Set(d.features || []);
        if (on) s.add(v); else s.delete(v);
        d.features = FEATURES.filter(x => s.has(x));
        touch();
      })));
      const out = h("input", { type: "checkbox" });
      out.checked = d.outdoor === true;
      out.addEventListener("change", () => { d.outdoor = out.checked; touch(); });
      main.appendChild(h("div", { class: "lal-row" }, [h("label", {}, [out, "Outdoor-rated"])]));
      let confirm = null;
      if (fromAi) {
        confirm = h("input", { type: "checkbox", "data-lal": "confirm" });
        main.appendChild(h("div", { class: "lal-row" }, [h("label", {}, [confirm, "I checked these details"])]));
      }
      const msg = h("div", { class: "lal-msg", "data-lal": "msg" });
      main.appendChild(msg);
      const shareBtn = h("button", { type: "button", class: "lal-go", "data-lal": "share" }, piece && piece.submission_id ? "Update" : "Share");
      const cancel = h("button", { type: "button", "data-lal": "cancel" }, "Cancel");
      cancel.addEventListener("click", () => finish(null));
      main.appendChild(h("div", { class: "lal-row" }, [shareBtn, cancel]));
      main.appendChild(h("div", { class: "lal-note" }, "* needed to share. A title, brand or model with an email address, phone number, street address or web address can't be shared."));

      const say = (text, good) => { msg.textContent = text; msg.classList.add("on"); msg.classList.toggle("good", !!good); };
      const unmark = () => { for (const f of Object.values(fields)) { f.box.classList.remove("bad"); f.why.textContent = ""; } };
      shareBtn.addEventListener("click", async () => {
        unmark();
        msg.classList.remove("on");
        const sheetNow = { ...d };
        for (const k of Object.keys(sheetNow)) if (sheetNow[k] === "" && !TEXT[k]) delete sheetNow[k];
        // A real person filled or checked it: the library's "details checked" mark.
        sheetNow.checked = !fromAi || changed || !!(confirm && confirm.checked);
        const got = checkDetails(sheetNow, kindForSheet);
        if (!got.details) {
          let text = problemWords(got.field, got.problem);
          if (got.field === "title" && SAY[got.problem]) {   // the plan: a title that fails becomes the suggestion
            d.title = suggestTitle(recipe, { ...d }, tools);
            titleIn.value = d.title;
            text += " The suggested title is back in its place: check it, then press Share again.";
          }
          const f = fields[got.field];
          if (f) { f.box.classList.add("bad"); f.why.textContent = text; }
          say(text);
          return;
        }
        shareBtn.disabled = true;
        cancel.disabled = true;
        say("Sending…", true);
        try {
          const msgOut = { type: "padspan_ha/house3d_library_share", recipe: shareRecipe(recipe, got.details) };
          if (piece && typeof piece.submission_id === "string") msgOut.submission_id = piece.submission_id;
          const r = await call(msgOut);
          const words = r && r.status === "queued" ? "Saved. It goes to the library as soon as the library can be reached."
            : r && r.status === "updated" ? "Updated in the library." : "Shared. Thank you!";
          if (typeof ctx.toast === "function") ctx.toast(words, false);
          finish({ submission_id: r && r.submission_id, details: got.details });
        } catch (e) {
          shareBtn.disabled = false;
          cancel.disabled = false;
          say(e && e.code === "terms_required" ? "Please accept the library's terms first." : `Not shared: ${errText(e)}`);
        }
      });
    }

    start();
  });
}
