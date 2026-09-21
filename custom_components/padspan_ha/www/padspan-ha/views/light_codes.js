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
// A real fan.* entity is never overridden either way (gatherLights never
// attaches a type_override to one — see its own comment). "fan" IS a valid
// override for a light.*, though (Garry, 2026-09-07: "some light switches
// are fan switches") — cosmetic only: it changes the marker's shape, code
// bucket and filter grouping, never which HA services get called. Every
// control this map actually offers a fan (speed, oscillate, direction —
// see openControlCard) already gates on the entity's OWN real attributes
// (percentage_step, oscillating, ...), which a light.* entity simply does
// not have, so an overridden light safely falls back to plain on/off.
export function isFan(l) {
  if (l.type_override) return l.type_override === "fan";
  return String(l.entity_id || "").startsWith("fan.");
}

// A motion (or occupancy — HA's other PIR presence class) sensor on the
// same ceiling. gatherLights admits binary_sensor entities of TWO distinct
// device_class families now (motion/occupancy here, door/window below), so
// the domain prefix alone is no longer sufficient to tell them apart —
// device_class (captured onto l by gatherLights) is the real test. Read-
// only: no toggle, no popup — its job on the map is the blue pulse while
// triggered.
export function isMotionSensor(l) {
  return String(l.entity_id || "").startsWith("binary_sensor.")
    && ["motion", "occupancy"].includes(l.device_class);
}

// A door or window sensor (door/window barrier project, step 1, Garry
// 2026-09-08: "add that device type to the list of devices in mapping,
// lighting"). Read-only, same reasoning as motion above — its job on the
// map is a static "open or closed" glyph, not a toggle.
export function isDoorSensor(l) {
  return String(l.entity_id || "").startsWith("binary_sensor.")
    && ["door", "window"].includes(l.device_class);
}

// A water-leak/flood sensor (Garry, 2026-09-18: "add flood sensors to the
// list"). HA's own device_class for this is "moisture" ("Wet"/"Dry"), not
// "flood" or "leak" — same admission shape as door/window above: a binary
// state, read-only on this map. Its job is a bright red ring radiating out
// from where it's placed while wet (floodRingSvg in iso_lights.js), the
// same "make the room itself react" idea air quality's rising bars use, for
// an alarm rather than a gradual reading — so unlike air quality there's no
// badness scale, just on/off.
export function isFloodSensor(l) {
  return String(l.entity_id || "").startsWith("binary_sensor.")
    && l.device_class === "moisture";
}

// A sensor.* entity reporting device_class "temperature" — "same as WLED or
// any other object... devices telling the temperature can also act like a
// motion sensor" (Garry): a THIRD read-only status class riding the same
// ceiling map, admitted by gatherLights the same way motion is (by device
// class, past the domain gate), so the domain prefix is sufficient here too.
export function isTempSensor(l) {
  // By device_class, not the bare domain, since 2026-09-14: air-quality
  // sensors are sensor.* too (below), so "any sensor.* is a thermometer"
  // stopped being true the moment a second sensor class was admitted — a
  // device_class-less null fallback survived that change by mistake and,
  // once isAtlasEntity (2026-09-19) started reusing this SAME test as the
  // live admission gate, silently swept every device-class-less sensor.*
  // in a real install (template/diagnostic/uptime sensors, common) onto
  // the map as a fake, permanently-blank thermometer. Strict, no fallback.
  return String(l.entity_id || "").startsWith("sensor.") && l.device_class === "temperature";
}

// A sensor.* entity reporting device_class "humidity" — Garry, 2026-09-15:
// "set it up like temperature". A FIFTH read-only class, admitted and
// placed/moved/selected exactly like temperature; unlike temperature it
// requires the EXPLICIT device_class (no null fallback) — null already
// belongs to temperature (its historical no-device_class catch-all above),
// and a humidity sensor is a plain sensor.* too, so it must never be
// claimed by that fallback.
export function isHumiditySensor(l) {
  return String(l.entity_id || "").startsWith("sensor.") && l.device_class === "humidity";
}

// ── Air quality ──────────────────────────────────────────────────────────────
// Garry, 2026-09-14: "next device to add in lights, air quality sensors.
// When placed in a room, and in poor state, make a very faded set of bars
// move from the bottom of the room to the top. Make it subtle but very
// noticable. Have it start at blue, and move thru to green, same as motion
// depending on how bad the air quality is." A FOURTH read-only sensor
// class on the ceiling map: sensor.* entities whose device_class is one of
// HA's air-quality classes. Q-series codes.
export const AIR_QUALITY_CLASSES = [
  "aqi", "pm25", "pm10", "pm1",
  "volatile_organic_compounds", "volatile_organic_compounds_parts",
  "carbon_dioxide", "carbon_monoxide",
  "nitrogen_dioxide", "nitrogen_monoxide", "ozone", "sulphur_dioxide",
];
// Two shapes of air-quality entity: a NUMERIC reading with one of the
// classes above, or an ENUM sensor whose id/name says "air quality" and
// whose state is a WORD — the Zigbee2MQTT convention for a device that
// grades its own air (Garry's bathroom outlets: sensor.invisoutlet_air_quality
// = "moderate"; "it's not picking up the outlet air quality sensors in the
// bathrooms"). The id/name test keeps every other enum sensor (power-on
// behaviour, modes) out.
const _AIR_NAME_RE = /air[_ ]?quality|\baqi\b/i;
export function isAirQualityEntity(eid, attrs) {
  if (!String(eid || "").startsWith("sensor.")) return false;
  const dc = attrs && attrs.device_class;
  if (AIR_QUALITY_CLASSES.includes(dc)) return true;
  return dc === "enum" && _AIR_NAME_RE.test(`${eid} ${(attrs && attrs.friendly_name) || ""}`);
}
export function isAirQualitySensor(l) {
  return isAirQualityEntity(l.entity_id, { device_class: l.device_class, friendly_name: l.friendly_name });
}
// Teal — its own hue: #34d399 is the fan's, and a Q tile must not read as an F.
export const AIR_BORDER = "#2dd4bf";

// The graded words an enum air-quality sensor reports, to badness. Placed
// on the same 0..1 scale the numeric bands use, so the bars step the motion
// colours the same way: moderate is the first visible band (blue), poor is
// green, unhealthy red, hazardous magenta; good/excellent draw nothing.
const _AQ_WORDS = {
  excellent: 0, good: 0, fair: 0.05, moderate: 0.05, poor: 0.4, very_poor: 0.6,
  unhealthy: 0.75, severe: 0.9, hazardous: 1,
};

// How bad the air is, 0 (good — nothing drawn) to 1 (hazardous), from the
// reading and its class. Breakpoints are the usual public scales in the
// units HA reports these classes in: US EPA AQI bands; EPA PM2.5 / PM10
// µg/m³ bands; CO₂ ppm by the common indoor-air guidance (800 fresh,
// 1000 acceptable, 1500 stuffy, 2000+ bad); CO ppm (EPA 8-hour 9 ppm);
// VOC µg/m³ (German UBA classes) and VOC ppb for the "_parts" class; NO₂,
// O₃, SO₂ µg/m³ (WHO/EU limit values). Piecewise-linear between points;
// at or under the first point is 0. NaN for a non-numeric reading or an
// unknown class — callers draw nothing for NaN.
const _AQ_BANDS = {
  aqi:                              [[50, 0], [100, .2], [150, .4], [200, .6], [300, .8], [500, 1]],
  pm25:                             [[12, 0], [35.4, .2], [55.4, .4], [150.4, .6], [250.4, .8], [500, 1]],
  pm1:                              [[12, 0], [35.4, .2], [55.4, .4], [150.4, .6], [250.4, .8], [500, 1]],
  pm10:                             [[54, 0], [154, .2], [254, .4], [354, .6], [424, .8], [604, 1]],
  carbon_dioxide:                   [[800, 0], [1000, .2], [1500, .4], [2000, .6], [3000, .8], [5000, 1]],
  carbon_monoxide:                  [[9, 0], [35, .4], [100, .7], [200, 1]],
  volatile_organic_compounds:       [[220, 0], [660, .3], [2200, .6], [5500, .8], [11000, 1]],
  volatile_organic_compounds_parts: [[250, 0], [500, .3], [1000, .6], [3000, .8], [10000, 1]],
  nitrogen_dioxide:                 [[40, 0], [100, .3], [200, .6], [400, 1]],
  nitrogen_monoxide:                [[40, 0], [100, .3], [200, .6], [400, 1]],
  ozone:                            [[100, 0], [180, .5], [240, 1]],
  sulphur_dioxide:                  [[100, 0], [350, .5], [500, 1]],
};
export function airQualityBadness(l) {
  // A graded word (enum sensor) — banded by the table above; a word the
  // table doesn't know (unknown, unavailable) is no reading.
  if (l && typeof l.air_level === "string" && l.air_level) {
    const w = l.air_level.toLowerCase().replace(/[\s-]+/g, "_");
    return Object.prototype.hasOwnProperty.call(_AQ_WORDS, w) ? _AQ_WORDS[w] : NaN;
  }
  const bands = _AQ_BANDS[l && l.device_class];
  // null/undefined is "no reading", not zero — Number(null) is 0, which
  // would read an unavailable sensor as Good.
  const v = (l && l.air_value != null) ? Number(l.air_value) : NaN;
  if (!bands || !Number.isFinite(v)) return NaN;
  if (v <= bands[0][0]) return 0;
  for (let i = 1; i < bands.length; i++) {
    const [x0, b0] = bands[i - 1], [x1, b1] = bands[i];
    if (v <= x1) return b0 + (b1 - b0) * (v - x0) / (x1 - x0);
  }
  return 1;
}
// The word for a badness, for the index and room sheet.
export function airQualityWord(badness) {
  if (!Number.isFinite(badness)) return "—";
  if (badness <= 0) return "Good";
  if (badness < .2) return "Moderate";
  if (badness < .4) return "Poor";
  if (badness < .6) return "Bad";
  if (badness < .8) return "Very bad";
  return "Hazardous";
}

// A lock.* entity riding the lights pipeline (gap #8, best-in-class
// roadmap: generalizing this pipeline beyond light.* to other HA domains).
// Chosen as the FIRST domain to generalize to because its shape already
// matches everything this pipeline assumes: one glyph, a small closed set
// of states (locked/unlocked/jammed) rather than a numeric range, and one
// unambiguous tap action — the same shape a light's on/off already has.
// Class comes from the entity domain alone, like fan/motion/temp above.
export function isLock(l) {
  return String(l.entity_id || "").startsWith("lock.");
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
  const OK = { healthy: true, reason: "" };
  // Which second signal applies is the class's own row (DEVICE_CLASSES.health)
  // — null means reachability is the whole question.
  const kind = deviceClassOf(l).health;
  // Motion stuck "on", or a door/window left open: the SAME stuck-state
  // shape and the SAME threshold (Garry, 2026-09-09: "I want the lighting
  // map to clearly show when a door or window is left open") — "left open"
  // and "stuck on" are the same real-world event, only the wording differs.
  if (kind === "stuck_on" || kind === "left_open") {
    const changed = l.last_changed ? Date.parse(l.last_changed) : NaN;
    if (l.state === "on" && Number.isFinite(changed) && (now - changed) > MOTION_STUCK_MS) {
      const hrs = Math.round((now - changed) / 3600000);
      return { healthy: false, reason: kind === "left_open"
        ? `Open for ~${hrs}h`
        : `Stuck "on" for ~${hrs}h — likely a hardware fault, not continuous motion` };
    }
    return OK;
  }
  // A temperature, air-quality or humidity sensor is healthy while it keeps reporting.
  if (kind === "fresh") {
    const updated = l.last_changed ? Date.parse(l.last_changed) : NaN;
    if (!Number.isFinite(updated)) return { healthy: false, reason: "No reading timestamp" };
    if ((now - updated) > TEMP_FRESH_MS) {
      const hrs = Math.round((now - updated) / 3600000);
      return { healthy: false, reason: `No reading in over ${hrs}h` };
    }
    return OK;
  }
  // Flood deliberately has NO stuck-state kind (health: null in its row),
  // unlike motion/door: "on" held for hours might be exactly correct — an
  // actual ongoing leak, which should keep alarming until someone fixes it,
  // not get silently marked "probably a hardware fault" and dismissed.
  if (kind === "effects") {
    if (!Array.isArray(l.effect_list) || !l.effect_list.length) {
      return { healthy: false, reason: "No effects reported — this WLED strip may have lost its effect list" };
    }
    return OK;
  }
  if (kind === "jammed") {
    return l.state === "jammed" ? { healthy: false, reason: "Lock is jammed" } : OK;
  }
  return OK;
}

// The type-override chooser's vocabulary — the UI's copy of const.py's
// LIGHT_TYPE_OVERRIDE_KINDS ("auto" = no override, expressed by omitting
// the entity, never stored). A test holds the two equal.
export const LIGHT_TYPE_OVERRIDES = [
  ["auto",      "Auto (detected)"],
  ["wled",      "WLED / effect strip"],
  ["partition", "ESPHome partition"],
  ["plain",     "Plain light"],
  ["fan",       "Fan (switch only)"],
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
export const LOCK_BORDER = "#a78bfa";
export const DOOR_BORDER = "#fb7185";
// Indigo — its own hue, clear of both existing blues (motion, partition)
// and both existing purples (WLED, lock).
export const HUMIDITY_BORDER = "#818cf8";
// Bright, saturated red — deliberately louder than DOOR_BORDER's soft rose
// or MOTION_BORDER's blue: a flood alarm should read as urgent at a glance,
// not blend in as just another sensor colour.
export const FLOOD_BORDER = "#ef4444";

// ── Device-class registry (Phase 2a, docs/PHASE2_STRATEGIC_REVIEW.md §5) ───
// ONE row per class, in PRECEDENCE order (first match wins — a light.*
// overridden to "fan" is a fan even if it also reports effects; a partition
// segment that also carries effects is WLED, the more capable identity).
// Every "which classes does X apply to" question reads this table instead of
// hand-listing the classes again — adding the flood class cost ~25 edit sites
// across 4 files because no such table existed, and two of the hand copies
// had already drifted (locks aura'd by Automorph; a lock's code painted
// default green in the room sheet; a pointless Controls button on door rows).
//
//   key          the class name
//   flagKey      the l.isX boolean assignLightCodes sets (null for a plain light)
//   test         the classifier — raw entity → is it this class
//   code         the code-series letter (F01, M01…); null = the generic A01… run
//   border       marker border / code-chip / swatch colour; null = the default
//   shape        the fixed glyph a domain-typed class always derives to
//   filterClass  the layer-chip / aggregate bucket (wled+partition = "strip")
//   castsLight   draws a light aura / pool / glow / wall spill
//   controllable has a real action (toggle, lock/unlock) — false = read-only
//   fixedGlyph   one fixed glyph, no size/rotation/colour of its own to edit —
//                a bare placement is the whole placement (see lightIsTouched).
//                A door is NOT this: it is never a point marker at all, it is
//                a linked section of wall.
//   controlCard  the class itself has a detail card behind a hold / the ⋯
//                button (speed, effects, lock/unlock). A plain light earns one
//                only by being dimmable — see hasControlCard.
//   inPresets    a Whole House Preset captures and restores its state — real
//                lights and fans only. NEVER a lock: a saved preset that could
//                unlock a door is the hole the Phase 2i security pass closed
//                (the backend sanitizer refuses it too, independently).
//   health       which healthOf() strategy applies beyond plain reachability
export const DEVICE_CLASSES = [
  { key: "fan",       flagKey: "isFan",       test: isFan,              code: "F", border: FAN_BORDER,       shape: "fan",             filterClass: "fan",      castsLight: false, controllable: true,  fixedGlyph: false, controlCard: true, inPresets: true ,  health: null },
  { key: "motion",    flagKey: "isMotion",    test: isMotionSensor,     code: "M", border: MOTION_BORDER,    shape: "motion",          filterClass: "motion",   castsLight: false, controllable: false, fixedGlyph: true,  controlCard: false, inPresets: false, health: "stuck_on" },
  { key: "door",      flagKey: "isDoor",      test: isDoorSensor,       code: "D", border: DOOR_BORDER,      shape: "door",            filterClass: "door",     castsLight: false, controllable: false, fixedGlyph: false, controlCard: false, inPresets: false, health: "left_open" },
  { key: "flood",     flagKey: "isFlood",     test: isFloodSensor,      code: "K", border: FLOOD_BORDER,     shape: "flood",           filterClass: "flood",    castsLight: false, controllable: false, fixedGlyph: true,  controlCard: false, inPresets: false, health: null },
  { key: "air",       flagKey: "isAir",       test: isAirQualitySensor, code: "Q", border: AIR_BORDER,       shape: "airquality",      filterClass: "air",      castsLight: false, controllable: false, fixedGlyph: true,  controlCard: false, inPresets: false, health: "fresh" },
  { key: "humidity",  flagKey: "isHumidity",  test: isHumiditySensor,   code: "H", border: HUMIDITY_BORDER,  shape: "humidityreadout", filterClass: "humidity", castsLight: false, controllable: false, fixedGlyph: true,  controlCard: false, inPresets: false, health: "fresh" },
  { key: "temp",      flagKey: "isTemp",      test: isTempSensor,       code: "T", border: TEMP_BORDER,      shape: "tempreadout",     filterClass: "temp",     castsLight: false, controllable: false, fixedGlyph: true,  controlCard: false, inPresets: false, health: "fresh" },
  { key: "lock",      flagKey: "isLock",      test: isLock,             code: "L", border: LOCK_BORDER,      shape: "lock",            filterClass: "lock",     castsLight: false, controllable: true,  fixedGlyph: true,  controlCard: true, inPresets: false,  health: "jammed" },
  { key: "wled",      flagKey: "isWled",      test: isWledLight,        code: "W", border: WLED_BORDER,      shape: null,              filterClass: "strip",    castsLight: true,  controllable: true,  fixedGlyph: false, controlCard: true, inPresets: true ,  health: "effects" },
  { key: "partition", flagKey: "isPartition", test: isPartitionLight,   code: "P", border: PARTITION_BORDER, shape: null,              filterClass: "strip",    castsLight: true,  controllable: true,  fixedGlyph: false, controlCard: true, inPresets: true ,  health: null },
  { key: "light",     flagKey: null,          test: null,               code: null, border: null,            shape: null,              filterClass: "light",    castsLight: true,  controllable: true,  fixedGlyph: false, controlCard: false, inPresets: true , health: null },
];
const _PLAIN_LIGHT = DEVICE_CLASSES[DEVICE_CLASSES.length - 1];

// The row for an entity whose l.isX flags are set (assignLightCodes, or a
// hand-built record carrying just the one flag that matters). Flags are
// winner-takes-all, so at most one is ever true.
export function deviceClassOf(l) {
  if (l) for (const c of DEVICE_CLASSES) if (c.flagKey && l[c.flagKey]) return c;
  return _PLAIN_LIGHT;
}
// Does this fixture cast a light aura/pool/glow at all? (iso_lights.js — 7 sites.)
export function castsLight(l) { return deviceClassOf(l).castsLight; }
// Does it have a real action to offer — a toggle, a lock/unlock? False for
// the read-only sensor classes: no Turn On/Off, no Controls button.
export function isControllable(l) { return deviceClassOf(l).controllable; }
// Is there a control card to open for it? By class, or — for any light — by
// being dimmable. This rule used to be typed out four times across the two
// hosts, and the builder's "Preview as sidebar" copy had drifted from the
// sidebar it previews (no lock), so a lock's hold opened its card in one and
// not the other.
export function hasControlCard(l) { return !!(l && (l.dimmable || deviceClassOf(l).controlCard)); }
// One fixed glyph with nothing to size, turn or tint (see the table's note).
export function hasFixedGlyph(l) { return deviceClassOf(l).fixedGlyph; }
// Does a Whole House Preset remember and restore this device? (see the table's note)
export function inWholeHousePresets(l) { return deviceClassOf(l).inPresets; }
// The class colour — marker border, code chip, index swatch — or `fallback`
// for a plain light, which has none of its own.
export function classBorder(l, fallback = null) { return deviceClassOf(l).border || fallback; }

// Whole domains admitted unconditionally — a real fan.*/light.* entity is
// relevant regardless of its attributes; WLED/partition are subtypes of
// light distinguished later (assignLightCodes), not separate admission
// cases here.
const _WHOLE_DOMAINS = ["light.", "fan."];
// The read-only sensor + lock rows — admitted by their OWN classifier
// (isMotionSensor, isFloodSensor, ...), run against a lightweight stub
// built straight from the raw entity_id/attrs, the exact shape those
// functions already expect (they only ever read .entity_id/.device_class/
// .friendly_name). light/wled/partition are excluded (castsLight: true):
// they're admitted by domain above, and their own classifiers need real
// light attributes (effect_list, platform) a bare HA-state stub can never
// carry. fan is NOT excluded by this filter (its castsLight is false, same
// as every read-only sensor class) — it stays harmless only because
// _WHOLE_DOMAINS above already admits every fan.* entity first, so
// isFan's stub-reachable branch (bare "fan." prefix; type_override can
// never reach it from a bare stub) is never actually consulted here.
const _TESTABLE_CLASSES = DEVICE_CLASSES.filter(c => c.test && !c.castsLight);
// Is this entity one Atlas admits at all? The single predicate gatherLights'
// own admission filter and ensureLightsRegistry's separate areaMap filter
// (lights_map.js) both used to hand-repeat, one class at a time — the
// pattern that cost a lock its room assignment (found in the Phase 2a
// registry audit, 2026-09-19: gap #8 added lock.* to gatherLights, but the
// SEPARATE areaMap copy never grew a matching clause). `attrs` is the raw
// HA state's `.attributes` object (or undefined).
export function isAtlasEntity(eid, attrs) {
  if (_WHOLE_DOMAINS.some(d => eid.startsWith(d))) return true;
  const stub = { entity_id: eid, device_class: attrs && attrs.device_class, friendly_name: attrs && attrs.friendly_name };
  return _TESTABLE_CLASSES.some(c => c.test(stub));
}

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
  ["humidityreadout", "Humidity readout"],
  ["airquality", "Air quality sensor"],
  ["lock",      "Door lock"],
  ["door",      "Door/window sensor"],
  ["flood",     "Emergency (flood) sensor"],
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
  // The table's fixed-glyph rows, in its precedence order. This runs ahead
  // of every name heuristic below on purpose — a real binary_sensor.* leak
  // detector must never reach the has("flood") FLOODLIGHT-name match: the
  // two "flood"s are unrelated (one is a spotlight naming convention, the
  // other a water sensor).
  for (const c of DEVICE_CLASSES) if (c.shape && c.test(l)) return c.shape;
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
const _CLASS_LETTERS = new Set(DEVICE_CLASSES.map(c => c.code).filter(Boolean));
const _SERIES_LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("").filter(c => !_CLASS_LETTERS.has(c));

// Mutates each light in place: sets l.code and every class flag in
// DEVICE_CLASSES (l.isFan, l.isMotion, … l.isWled, l.isPartition). Pass
// EVERY entity (including hidden ones) so codes stay stable when visibility
// changes. Precedence is the table's row order.
export function assignLightCodes(lights) {
  const sorted = [...lights].sort((a, b) => a.entity_id.localeCompare(b.entity_id));
  const counts = new Map();
  let n = 0;
  const seriesCode = (idx) =>
    _SERIES_LETTERS[Math.floor(idx / 99)] + String((idx % 99) + 1).padStart(2, "0");
  for (const l of sorted) {
    // First row whose classifier claims the entity wins; every other flag
    // is false, so no consumer ever has to ask "fan AND wled?".
    const cls = DEVICE_CLASSES.find(c => c.test && c.test(l)) || _PLAIN_LIGHT;
    for (const c of DEVICE_CLASSES) if (c.flagKey) l[c.flagKey] = (c === cls);
    if (cls.code) {
      const i = counts.get(cls.code) || 0;
      counts.set(cls.code, i + 1);
      l.code = cls.code + String((i % 99) + 1).padStart(2, "0");
    } else {
      l.code = seriesCode(n++);
    }
  }
  return lights;
}
