// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
// See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
//
// Live Aboard's Showcase look (docs/IDEA_ATLAS_3D_HOUSE.md, P8 atmosphere):
// with "Use the Atlas's Showcase look" on, the Showcase theme the Atlas is
// showing (iso_lights.js SHOWCASE_THEMES, only ever read) becomes the 3D
// house's lighting through this one small table, a row for every theme:
//   bg       the background, and the haze the far ground fades into
//   ground   what the house stands on (from the Atlas's angle, most of the
//            background you see)
//   sky      the colour the sky light leans toward, by skyMix (0: none)
//   ambient  how bright the sky light is (x today's)
//   tile     how far a floor tile's room colour is mixed toward the Atlas's
//            beige (lower: the room colours show more; a deck +0.12)
//   glow     how strongly a light's glow and its pool show (x today's)
//   weather  what falls, where the flat Atlas's own colour (the theme's
//            washStops) would not show on the ground: the light themes;
//            null keeps the flat Atlas's
// Classic is today's look exactly. Pure data: nothing here draws.

const row = (bg, ground, sky, skyMix, ambient, tile, glow, weather = null) => Object.freeze({ bg, ground, sky, skyMix, ambient, tile, glow, weather });
export const LOOK_FIELDS = Object.freeze(["bg", "ground", "sky", "skyMix", "ambient", "tile", "glow", "weather"]);
export const SHOWCASE_LOOKS = Object.freeze({
  //                          bg         ground     sky        mix   amb   tile  glow  weather
  classic:                row("#0c110f", "#18201c", "#e6edf6", 0,    1,    0.38, 1),
  cinematic_glass:        row("#070b14", "#111827", "#9fb8e8", 0.35, 0.95, 0.30, 1.25),
  neo_hud:                row("#020b10", "#04161d", "#4fe3ff", 0.3,  0.8,  0.55, 1.35),
  ambient_premium:        row("#0b090d", "#19141d", "#f4ead9", 0.3,  0.9,  0.42, 1.2),
  dataviz_precision:      row("#07080a", "#12141b", "#c9d6ff", 0.2,  1,    0.5,  1.15),
  organic_bioluminescent: row("#010810", "#06131f", "#8fdcff", 0.35, 0.7,  0.4,  1.6),
  material_you:           row("#14111a", "#221d2b", "#d9cdf5", 0.25, 1.05, 0.25, 1.15),
  neon_precision:         row("#05020b", "#0e0718", "#b026ff", 0.3,  0.7,  0.5,  1.5),
  luxury_realestate:      row("#e9ecf1", "#cfd4dc", "#ffffff", 0.5,  1.25, 0.6,  0.7, "#5d6b80"),
  wabi_sabi:              row("#e3dccb", "#cbc2ad", "#fbf8f0", 0.4,  1.2,  0.6,  0.75, "#6f6756"),
  hygge:                  row("#e6d6b8", "#cbb68f", "#ffe2b8", 0.4,  1.15, 0.35, 1.2, "#6e5a3d"),
  aurora:                 row("#050311", "#0b0a20", "#5eead4", 0.3,  0.85, 0.35, 1.4),
  automotive_hud:         row("#0b0d10", "#16191e", "#ffd9a3", 0.2,  0.9,  0.5,  1.3),
  art_deco:               row("#02050b", "#0a1324", "#f5e7b8", 0.3,  0.95, 0.28, 1.25),
  swiss_style:            row("#efefe9", "#d8d8d1", "#ffffff", 0.5,  1.25, 0.55, 0.7, "#555555"),
  bauhaus:                row("#ebe4d1", "#d4caae", "#fbf7ec", 0.35, 1.15, 0.15, 0.9, "#5b5649"),
  holographic:            row("#0a0810", "#161126", "#ff9ff3", 0.3,  0.9,  0.35, 1.45),
  retro_futurism:         row("#0d0521", "#180b35", "#ff5ab0", 0.35, 0.9,  0.32, 1.4),
  obsidian_noir:          row("#000000", "#0c0c0c", "#ffffff", 0,    0.75, 0.5,  1.3),
});
/** The look for a theme: its row, else Classic's (today's look). */
export function lookOf(key){
  return Object.prototype.hasOwnProperty.call(SHOWCASE_LOOKS, key) ? SHOWCASE_LOOKS[key] : SHOWCASE_LOOKS.classic;
}

// ── The same look as the Atlas (atlas_3d_look "atlas", the default) ─────────
// Live Aboard wears what the flat Atlas wears: with Showcase on, its theme
// (the row above for the page and the light, and the theme's own room rules,
// handed over by the host from iso_lights.js SHOWCASE_THEMES, only ever
// read); with Showcase off, the plain Atlas: Classic's page and the plain
// drawing's room rules below. Either way the slab edges and the code chips
// take the theme the Atlas reads them from even with Showcase off, as the
// flat drawing does.
//
// The plain Atlas's rooms (buildIsoSVG with Showcase off): a 0.16 fill, a
// 1.6 outline at full strength, the name at 0.78 in its own case, a dark
// fixture #374151. tests/js/live_aboard_one_look.mjs holds these to the flat
// drawing's own output.
export const PLAIN_ROOMS = Object.freeze({ fillOpacity: 0.16, strokeWidth: 1.6, strokeOpacity: 1, labelOpacity: 0.78,
                                           upper: false, spacing: 0, offFill: "#374151", ink: "#071008" });
const NAME_EDGE = "#071008";               // the Atlas's dark edge round every room name
const CARD = "#071008";                    // the Atlas's own ground, under a theme's vignette
const LIT = 0.7;                            // the ground as painted: the sun and the sky light it up to what the Atlas shows
const FLOOR_K = 0.8;                       // a floor: the vignette's centre, nearly all of it (the flat plates sit there)
const isHex = (v) => /^#[0-9a-f]{6}$/i.test(String(v));
const hex3 = (v) => (/^#[0-9a-f]{3}$/i.test(String(v)) ? "#" + String(v).slice(1).split("").map(c => c + c).join("") : String(v));
const colour = (v, d) => (isHex(hex3(v)) ? hex3(v).toLowerCase() : d);
const num = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
/** a over b by t (0: b, 1: a), as "#rrggbb". */
export function mixHex(a, b, t){
  const pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16);
  const ch = (s) => Math.round(((pb >> s) & 255) + (((pa >> s) & 255) - ((pb >> s) & 255)) * t);
  return "#" + [ch(16), ch(8), ch(0)].map(v => v.toString(16).padStart(2, "0")).join("");
}
/** How light a colour is, 0..1 (Rec. 709 weights). */
export const lightness = (h) => { const p = parseInt(h.slice(1), 16); return (0.2126 * (p >> 16 & 255) + 0.7152 * (p >> 8 & 255) + 0.0722 * (p & 255)) / 255; };
/** The look for the Atlas as it is drawn: a = { on (Showcase on), key (the
 *  theme it reads), theme (that SHOWCASE_THEMES entry) }. Pure numbers and
 *  colours; the view draws them. Raised from the flat drawing's own where a
 *  house standing up needs it (a floor is seen at a slant, under walls):
 *    floorMix   how much of its room colour a floor takes over the theme's floor
 *    lineOp     the outline's strength, lineW its width (m)
 *    nameOp     the name's strength */
export function atlasLook(a){
  const on = !!(a && a.on), key = a && typeof a.key === "string" && a.key ? a.key : "classic";
  const t = a && a.theme && typeof a.theme === "object" ? a.theme : {};
  // The page: what the flat Atlas paints, its theme's vignette over its own
  // dark ground (the far haze its middle stop, the ground under the house
  // its centre, lit); the light and the glow are the row's. Showcase off: Classic.
  const row = lookOf(on ? key : "classic"), vg = Array.isArray(t.vignetteStops) ? t.vignetteStops.filter(s => Array.isArray(s) && isHex(hex3(s[1]))) : [];
  const stop = (s, k) => mixHex(colour(s[1], CARD), CARD, clamp(num(s[2], 0) * k, 0, 1));
  const page = on && vg.length ? Object.freeze({ ...row, bg: stop(vg[Math.min(1, vg.length - 1)], 1), ground: mixHex(stop(vg[0], 1), "#000000", LIT) }) : row;
  const r = on ? { fillOpacity: num(t.roomFillOpacity, 0.1), strokeWidth: num(t.roomStrokeWidth, 1.3),
                   strokeOpacity: num(t.roomStrokeOpacity, 0.8), labelOpacity: num(t.roomLabelOpacity, 0.8),
                   upper: t.roomLabelUppercase === true, spacing: clamp(parseFloat(t.roomLabelLetterSpacing) || 0, 0, 0.4),
                   offFill: colour(t.fixtureOffFill, PLAIN_ROOMS.offFill), ink: colour(t.roomEdgeStroke, NAME_EDGE) }
    : PLAIN_ROOMS;
  const light = lightness(page.bg) > 0.5;
  const sideOf = (s, d) => (s && typeof s === "object" ? { fill: colour(s.fill, d), op: clamp(num(s.fillOpacity, 0.3), 0, 1) } : { fill: d, op: 0.3 });
  const front = sideOf(t.slabSideFront, "#0a1a12");
  return Object.freeze({
    key: on ? `atlas:${key}` : "atlas:plain", on, theme: on ? key : "classic", page, light, ...r,
    // A floor: where the flat plates sit (the vignette's centre; Showcase
    // off, the ground lifted a little), its room colour mixed in.
    floor: on && vg.length ? stop(vg[0], FLOOR_K) : mixHex("#ffffff", page.ground, 0.05),
    floorMix: clamp(r.fillOpacity + 0.05, 0.14, 0.3),
    lineOp: clamp(0.4 + r.strokeOpacity * 0.6, 0.55, 1), lineW: clamp(0.055 * r.strokeWidth, 0.05, 0.1),
    nameOp: clamp(0.6 + r.labelOpacity * 0.45, 0.8, 1), nameEdge: NAME_EDGE,
    // The slab's edge: the theme's front face over the page, as the flat
    // drawing lays it, kept visible.
    side: mixHex(front.fill, page.bg, Math.max(front.op, 0.6)),
    // The code chip's face (codeChipBg, at its strength), its digits edged dark.
    chipBg: colour(t.codeChipBg, "#050d09"), chipOp: clamp(num(t.codeChipBgOpacity, 0.72), 0.5, 1), chipEdge: "#050d09",
  });
}
