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
