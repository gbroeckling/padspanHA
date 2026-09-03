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
// WLED-class lights (effect-capable) get the W-series (W01…); ESPHome
// `light.partition` runs (a physical addressable strip split into HA light
// entities by LED range) get the P-series — same strip-class treatment, but
// distinct, because a partition often carries NO effect_list at all: many
// installs partition purely for independent colour zones, never touching
// ESPHome's `effects:` block. Deriving from effect_list alone would leave
// those invisible as strips. Everything else runs A01…A99, B01… with both
// letters skipped so no series ever collides.

export function isWledLight(l) {
  return Array.isArray(l.effect_list) && l.effect_list.length > 0;
}

// platform comes from the entity registry (config/entity_registry/list),
// threaded through gatherLights — the only reliable signal, since naming is
// free-text and a partition can be silent about effects. "partition" is HA's
// own core light platform for splitting one strip into ranges.
export function isPartitionLight(l) {
  return l.platform === "partition";
}

// Distinct marker border/stroke per strip class, in both views.
export const WLED_BORDER = "#c084fc";
export const PARTITION_BORDER = "#38bdf8";

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
  ["perimeter", "Room perimeter / cove"],
];

// "perimeter" is drawn once, structurally differently from every shape
// above: those are all a small icon inscribed at a point (see shapeSvg);
// this one traces the ACTUAL room polygon the light is placed in, inset by
// its own margin_cm, so it needs the room's real geometry at render time.
// buildIsoSVG does that directly (perimeterSvg) — resolveLightShape below
// only has to name it, same as any other kind. Still one point-icon
// (shapeSvg's "perimeter" case) for the drag handle and the working-mode
// code label, exactly like a WLED bar has both a small glyph AND a real
// physical footprint once placed.
//
// V1 always traces the FULL closed loop — no partial-segment coverage.
// That was flagged as a real follow-up (most physical cove runs don't wrap
// an entire room) but is a separate, harder problem than what was asked for.

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
  // Addressable/effect-capable hardware is a strip far more often than not —
  // and a partition entity IS one by construction, effects or not.
  if (isWledLight(l) || isPartitionLight(l)) return "bar";
  return "hex";
}

// Resolved shape for rendering: manual override wins, else derived.
export function resolveLightShape(l, overrides) {
  const o = overrides && overrides[l.entity_id];
  if (o && o !== "auto" && LIGHT_SHAPES.some(([k]) => k === o)) return o;
  return deriveLightShape(l);
}

// Letters reserved for a strip-class series, skipped as the generic series
// counts past them — precomputed once so a third reserved letter is a
// one-line change here, not new arithmetic.
const _SERIES_LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("").filter(c => c !== "P" && c !== "W");

// Mutates each light in place: sets l.code, l.isWled and l.isPartition. Pass
// EVERY light entity (including hidden ones) so codes stay stable when
// visibility changes. WLED is checked first: a partition entity that ALSO
// advertises effects (an ESPHome segment with its own effects: block) reads
// as WLED-class — the more specific, more capable identity wins.
export function assignLightCodes(lights) {
  const sorted = [...lights].sort((a, b) => a.entity_id.localeCompare(b.entity_id));
  let w = 0, p = 0, n = 0;
  const seriesCode = (idx) =>
    _SERIES_LETTERS[Math.floor(idx / 99)] + String((idx % 99) + 1).padStart(2, "0");
  for (const l of sorted) {
    if (isWledLight(l)) {
      l.isWled = true; l.isPartition = false;
      l.code = "W" + String((w++ % 99) + 1).padStart(2, "0");
    } else if (isPartitionLight(l)) {
      l.isWled = false; l.isPartition = true;
      l.code = "P" + String((p++ % 99) + 1).padStart(2, "0");
    } else {
      l.isWled = false; l.isPartition = false;
      l.code = seriesCode(n++);
    }
  }
  return lights;
}
