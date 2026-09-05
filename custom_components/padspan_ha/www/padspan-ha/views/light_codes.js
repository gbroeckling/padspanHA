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

// An explicit type override (Pro — settings.light_type_overrides, attached
// by gatherLights as l.type_override only at pro tier) fully decides a
// light's class: detection got it wrong, the user said so, the user wins.
// "wled" forces the W-series treatment onto a strip whose integration
// exposes no effect_list; "plain" strips it from a light that reports
// effects it doesn't meaningfully have; absent means detect as always.
export function isWledLight(l) {
  if (l.type_override) return l.type_override === "wled";
  return Array.isArray(l.effect_list) && l.effect_list.length > 0;
}

// platform comes from the entity registry (config/entity_registry/list),
// threaded through gatherLights — the only reliable signal, since naming is
// free-text and a partition can be silent about effects. "partition" is HA's
// own core light platform for splitting one strip into ranges.
export function isPartitionLight(l) {
  if (l.type_override) return l.type_override === "partition";
  return l.platform === "partition";
}

// A fan.* entity riding the lights pipeline — the map shows the whole
// ceiling, and half of what hangs from a ceiling that switches is a fan.
// Class comes from the entity domain alone; overrides don't apply (a light
// cannot become a fan by declaration — the services wouldn't exist).
export function isFan(l) {
  return String(l.entity_id || "").startsWith("fan.");
}

// A motion (or occupancy — HA's other PIR presence class) sensor on the
// same ceiling. gatherLights only admits binary_sensor entities whose
// device_class is "motion" or "occupancy", so the domain prefix is a
// sufficient test past that gate. Read-only: no toggle, no popup — its
// job on the map is the blue pulse while triggered.
export function isMotionSensor(l) {
  return String(l.entity_id || "").startsWith("binary_sensor.");
}

// A sensor.* entity reporting device_class "temperature" — "same as WLED or
// any other object... devices telling the temperature can also act like a
// motion sensor" (Garry): a THIRD read-only status class riding the same
// ceiling map, admitted by gatherLights the same way motion is (by device
// class, past the domain gate), so the domain prefix is sufficient here too.
export function isTempSensor(l) {
  return String(l.entity_id || "").startsWith("sensor.");
}

// Health — a device can be reachable and still not actually be DOING its
// job. What "healthy" means differs by class, so this isn't one check:
//
//  - Every class: HA itself says "unavailable" or "unknown" — the one
//    domain-agnostic failure signal every entity type can report.
//  - WLED strip: reachable, but its effect_list has gone empty — the whole
//    reason it's classed WLED rather than a plain light. Still turns on
//    and off; has quietly lost what made it a strip (a firmware update, an
//    ESPHome effects: block removed, a JSON API hiccup).
//  - Motion sensor: reachable, but stuck reporting "on" past the same
//    outer cutoff the map's own glow rendering already treats as "stuck
//    hardware, not continuous motion" (see iso_lights.js's
//    MOTION_RECENT_MS) — a real PIR trip does not last six hours.
//  - Temperature sensor: reachable, but its last reading is older than the
//    same freshness window the map's own display gate already requires
//    before showing a number at all (iso_lights.js's TEMP_FRESH_MS) — a
//    sensor that stopped updating a while ago, even if HA hasn't yet
//    flipped it to unavailable.
//  - Fan / partition segment / plain light: reachability is the whole
//    question — there's no established second signal for these the way
//    there is for the three above, so inventing one would just be noise.
//
// MOTION_STUCK_MS/TEMP_FRESH_MS are the SAME durations as iso_lights.js's
// own constants, not new numbers — kept local rather than imported since
// iso_lights.js scopes them inside buildIsoSVG.
const MOTION_STUCK_MS = 6 * 60 * 60 * 1000;
const TEMP_FRESH_MS = 60 * 60 * 1000;

export function healthOf(l, nowMs) {
  if (l.state === "unavailable" || l.state === "unknown") {
    return { healthy: false, reason: `Entity is ${l.state}` };
  }
  const now = Number(nowMs) || Date.now();
  if (l.isMotion) {
    const changed = l.last_changed ? Date.parse(l.last_changed) : NaN;
    if (l.state === "on" && Number.isFinite(changed) && (now - changed) > MOTION_STUCK_MS) {
      const hrs = Math.round((now - changed) / 3600000);
      return { healthy: false, reason: `Stuck "on" for ~${hrs}h — likely a hardware fault, not continuous motion` };
    }
    return { healthy: true, reason: "" };
  }
  if (l.isTemp) {
    const updated = l.last_changed ? Date.parse(l.last_changed) : NaN;
    if (!Number.isFinite(updated)) return { healthy: false, reason: "No reading timestamp" };
    if ((now - updated) > TEMP_FRESH_MS) {
      const hrs = Math.round((now - updated) / 3600000);
      return { healthy: false, reason: `No reading in over ${hrs}h` };
    }
    return { healthy: true, reason: "" };
  }
  if (isWledLight(l)) {
    if (!Array.isArray(l.effect_list) || !l.effect_list.length) {
      return { healthy: false, reason: "No effects reported — this WLED strip may have lost its effect list" };
    }
    return { healthy: true, reason: "" };
  }
  return { healthy: true, reason: "" };
}

// The type-override chooser's vocabulary — the UI's copy of const.py's
// LIGHT_TYPE_OVERRIDE_KINDS ("auto" = no override, expressed by omitting
// the entity, never stored). A test holds the two equal.
export const LIGHT_TYPE_OVERRIDES = [
  ["auto",      "Auto (detected)"],
  ["wled",      "WLED / effect strip"],
  ["partition", "ESPHome partition"],
  ["plain",     "Plain light"],
];

// Distinct marker border/stroke per class, in both views.
export const WLED_BORDER = "#c084fc";
export const PARTITION_BORDER = "#38bdf8";
export const FAN_BORDER = "#34d399";
export const MOTION_BORDER = "#3b82f6";
// The pulse a motion sensor throws while active — visibly bluer than any
// room hue so a triggered sensor reads at a glance across the whole map.
export const MOTION_PULSE = "#3b82f6";
export const TEMP_BORDER = "#fb923c";

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
  ["motion",    "Motion sensor"],
  ["tempreadout", "Temperature readout"],
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

  // Real fan.* and motion binary_sensor.* entities are typed by DOMAIN —
  // no name needed.
  if (isFan(l)) return "fan";
  if (isMotionSensor(l)) return "motion";
  if (isTempSensor(l)) return "tempreadout";
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

// Letters reserved for a class series, skipped as the generic series counts
// past them — precomputed once so another reserved letter is a one-line
// change here, not new arithmetic.
const _SERIES_LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("").filter(c => c !== "F" && c !== "M" && c !== "P" && c !== "T" && c !== "W");

// Mutates each light in place: sets l.code, l.isWled, l.isPartition,
// l.isFan, l.isMotion and l.isTemp. Pass EVERY entity (including hidden ones) so
// codes stay stable when visibility changes. Domain classes first — a fan
// is a fan, a sensor is a sensor, whatever they advertise; then WLED before
// partition: a partition segment that ALSO carries effects reads as
// WLED-class — the more capable identity wins.
export function assignLightCodes(lights) {
  const sorted = [...lights].sort((a, b) => a.entity_id.localeCompare(b.entity_id));
  let f = 0, m = 0, w = 0, p = 0, t = 0, n = 0;
  const seriesCode = (idx) =>
    _SERIES_LETTERS[Math.floor(idx / 99)] + String((idx % 99) + 1).padStart(2, "0");
  for (const l of sorted) {
    l.isFan = isFan(l);
    l.isMotion = isMotionSensor(l);
    l.isTemp = isTempSensor(l);
    if (l.isFan) {
      l.isWled = false; l.isPartition = false;
      l.code = "F" + String((f++ % 99) + 1).padStart(2, "0");
    } else if (l.isMotion) {
      l.isWled = false; l.isPartition = false;
      l.code = "M" + String((m++ % 99) + 1).padStart(2, "0");
    } else if (l.isTemp) {
      l.isWled = false; l.isPartition = false;
      l.code = "T" + String((t++ % 99) + 1).padStart(2, "0");
    } else if (isWledLight(l)) {
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
