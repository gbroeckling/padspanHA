// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
// See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
//
// Canonical light codes — shared by the Mapping → Lights tab and the Lights
// sidebar panel so the SAME physical light wears the SAME code in both tools.
// Codes derive from the entity_id sort: stable across display sorts, hidden
// toggles, and entity-registry load races (each view previously numbered by
// its own display order, so the two tools disagreed).
//
// WLED-class lights (effect-capable) get the W-series (W01…); everything else
// runs A01…A99, B01… with the letter W skipped so the series never collide.

export function isWledLight(l) {
  return Array.isArray(l.effect_list) && l.effect_list.length > 0;
}

// Distinct marker border/stroke for WLED-class lights in both views.
export const WLED_BORDER = "#c084fc";

// ── Fixture shape ────────────────────────────────────────────────────────────
// The marker's OUTLINE answers "what kind of light is that" without reading
// the code. Derived from the entity by default so all of them are typed on
// first render; a per-light manual override (settings.light_shapes) wins when
// the guess is wrong. Every shape is drawn inscribed in the same radius so
// the cluster packing is unaffected — see shapePts() in iso_lights.js.
// The vocabulary follows the reflected-ceiling-plan symbols an electrician or
// lighting designer already reads — circle for a ceiling outlet, rectangle for
// a surface fixture, a run of dashes for a continuous strip, a half-round
// against the wall for a sconce, a suspended disc for a pendant. Anyone who has
// seen a lighting plan can decode this map without the key.
export const LIGHT_SHAPES = [
  ["auto",      "Auto (derived)"],
  ["hex",       "Fixture (default)"],
  ["circle",    "Pot / downlight"],
  ["bar",       "Strip / valance"],
  ["line",      "Run / track"],
  ["square",    "Fluorescent / tube"],
  ["fan",       "Ceiling fan"],
  ["pendant",   "Pendant / drop"],
  ["sconce",    "Wall sconce"],
  ["chandelier","Chandelier / decorative"],
  ["triangle",  "Spot / directional"],
  ["diamond",   "Indicator LED"],
];

// Name first, capability second: on a real install the friendly name carries
// far more fixture information than supported_color_modes does ("Dining Table
// Pots", "Kitchen Valance", "Lower Garage Flouresents", "…Status LED").
export function deriveLightShape(l) {
  const t = `${l.entity_id || ""} ${l.friendly_name || ""}`.toLowerCase();
  const has = (...words) => words.some(w => t.includes(w));

  // A fan exposed as a light entity is not a light at all — worth seeing.
  if (has("fan")) return "fan";
  if (has("chandelier")) return "chandelier";
  if (has("pendant", "hanging", "drop light")) return "pendant";
  if (has("sconce", "wall light", "wall lamp", "vanity")) return "sconce";
  // BEFORE the pot rule, and not only for tidiness: "spot" contains "pot", so
  // every spotlight in the house used to derive as a recessed downlight.
  if (has("spot", "flood", "wall wash", "washer")) return "triangle";
  if (has("status led", "status_led", "backlight", "indicator")) return "diamond";
  if (has("pot", "downlight", "down light", "recessed", "can light")) return "circle";
  // Track is a RUN of fixtures, which is what the dashed line already says.
  if (has("track")) return "line";
  // Addressable-LED chip names are an unambiguous strip signal even when the
  // entity exposes no effect list (a bare WS2812B run, for instance).
  if (has("valance", "strip", "cove", "tape", "rope", "under cab", "undercab",
          "wled", "led controller", "led-controller",
          "ws2812", "sk6812", "neopixel", "xmas", "christmas")) return "bar";
  if (has("flouresent", "fluorescent", "tube", "shop light")) return "square";
  // Addressable/effect-capable hardware is a strip far more often than not.
  if (isWledLight(l)) return "bar";
  return "hex";
}

// Resolved shape for rendering: manual override wins, else derived.
export function resolveLightShape(l, overrides) {
  const o = overrides && overrides[l.entity_id];
  if (o && o !== "auto" && LIGHT_SHAPES.some(([k]) => k === o)) return o;
  return deriveLightShape(l);
}

// Mutates each light in place: sets l.code and l.isWled. Pass EVERY light
// entity (including hidden ones) so codes stay stable when visibility changes.
export function assignLightCodes(lights) {
  const sorted = [...lights].sort((a, b) => a.entity_id.localeCompare(b.entity_id));
  let w = 0, n = 0;
  const seriesCode = (idx) => {
    let letter = Math.floor(idx / 99);
    if (letter >= 22) letter++;              // skip 'W' — reserved for WLED
    return String.fromCharCode(65 + letter) + String((idx % 99) + 1).padStart(2, "0");
  };
  for (const l of sorted) {
    if (isWledLight(l)) {
      l.isWled = true;
      l.code = "W" + String((w++ % 99) + 1).padStart(2, "0");
    } else {
      l.isWled = false;
      l.code = seriesCode(n++);
    }
  }
  return lights;
}
