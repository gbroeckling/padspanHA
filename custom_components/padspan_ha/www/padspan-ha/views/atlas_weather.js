// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
// See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
//
// Atlas outdoor weather (docs/IDEA_ATLAS_WEATHER.md): subtle rain or snow
// drawn everywhere OUTSIDE the floor plates, never over a room or a slab.
//
// It is an HTML overlay laid over the Atlas SVG, not part of it. The SVG is
// rebuilt from a string on every poll; the overlay is one persistent element
// per surface ("slot") that is moved into each new stage, so its tiles and
// mask are made once and its animations keep their phase (every animation
// delay is anchored to the clock, the way the emergency ring's pulse is).
// Nothing here reads anything the panel does not already hold — hass.states
// and the settings payload — and nothing is ever sent to Home Assistant but
// the opt-in usage report's closed-vocabulary counts, once per page load.
//
// The rules (the owner's, final):
//   setting off                                   -> nothing at all
//   rain sensor set, reading dry                  -> off
//   no rain sensor (or no reading from it)        -> wet = weather condition
//   wet, alone                                    -> light rain
//   wet + rainfall warning, or condition pouring  -> heavy rain
//   wet + condition snowy/snowy-rainy, or <= 1 °C -> light snow
//   wet + snowfall warning                        -> heavy snow + rim
// The rain sensor alone only ever means LIGHT rain; a numeric one is wet
// above 0 and never scales the intensity.

// ── Vocabulary ───────────────────────────────────────────────────────────────
export const WET_CONDITIONS = ["rainy", "pouring", "snowy", "snowy-rainy", "hail", "lightning-rainy"];
const SNOW_CONDITIONS = new Set(["snowy", "snowy-rainy"]);
export const SNOW_AT_OR_BELOW_C = 1;
// Where a weather warning can come from. Core: Environment Canada, MeteoAlarm
// (EU), DWD and NINA (DE), Météo-France. USA: core NWS has no alerts, only
// the custom weatheralerts / nws_alerts. UK and Australia: nothing standard.
export const WARNING_PLATFORMS = ["env_canada", "meteoalarm", "dwd_weather_warnings", "nina",
  "meteo_france", "weatheralerts", "nws_alerts"];
// The registry names an entity's integration by its DOMAIN: Environment
// Canada's is environment_canada (env_canada is its library, and this
// feature's word for it).
const PLATFORM_ALIASES = { environment_canada: "env_canada" };
export const STRENGTH_MIN = 0.5, STRENGTH_MAX = 1.5;

// The opt-in usage report's words for this feature (telemetry.py
// WEATHER_EVENTS holds the same lists; tests/test_atlas_weather.py keeps them
// equal). Names only: never an entity id, never alert text.
export const WEATHER_ERROR_KINDS = ["mask_build", "mask_unsupported", "tiles", "decision", "mount", "source"];
export const WEATHER_SHOWN_STATES = ["light_rain", "heavy_rain", "light_snow", "heavy_snow", "still"];
export const WEATHER_SOURCES = ["rain_sensor", "condition", "none",
  ...WARNING_PLATFORMS.map(p => `warning:${p}`), "warning:other"];
export const WEATHER_EVENTS = [
  ...WEATHER_ERROR_KINDS.map(k => `weather_error:${k}`),
  ...WEATHER_SHOWN_STATES.map(k => `weather_shown:${k}`),
  ...WEATHER_SOURCES.map(k => `weather_source:${k}`),
];
const _ALLOWED = new Set(WEATHER_EVENTS);
const _counted = new Set();
/** Count `name` once per page load, and only a name from the closed list. */
export function countWeatherOnce(name, send){
  if (!_ALLOWED.has(name) || _counted.has(name)) return false;
  _counted.add(name);
  try { if (typeof send === "function") send(name); } catch (_) { /* the report must never be the error */ }
  return true;
}
export function _resetWeatherCountsForTests(){ _counted.clear(); }

// ── Settings ─────────────────────────────────────────────────────────────────
// The five keys (settings_store.py). A setting that never arrived is not
// "off": the host only builds this once settings_get has answered.
export function weatherSettingsFrom(s){
  const src = s || {};
  const id = (v) => (typeof v === "string" ? v.trim() : "");
  const k = Number(src.atlas_weather_strength);
  return {
    enabled: src.atlas_weather_enabled !== false,
    rainEntity: id(src.atlas_weather_rain_entity),
    conditionEntity: id(src.atlas_weather_condition_entity),
    warningEntity: id(src.atlas_weather_warning_entity),
    strength: Math.max(STRENGTH_MIN, Math.min(STRENGTH_MAX, Number.isFinite(k) ? k : 1)),
  };
}

// ── Reading Home Assistant ───────────────────────────────────────────────────
// unknown / unavailable / missing is NO SIGNAL — never wet, never dry.
function reading(st){
  if (!st || typeof st !== "object") return null;
  const v = String(st.state ?? "").trim();
  if (!v || v === "unknown" || v === "unavailable") return null;
  return v;
}

/** true wet, false dry, null no signal. binary on/off, or numeric > 0. */
export function rainReading(st){
  const v = reading(st);
  if (v === null) return null;
  const lv = v.toLowerCase();
  if (lv === "on") return true;
  if (lv === "off") return false;
  const n = Number(v);
  return Number.isFinite(n) ? n > 0 : null;
}

/** What the rain-sensor setting offers: sensors that say it is raining NOW,
 *  since any reading above 0 is wet — a rain rate, a rain or moisture
 *  switch, a gauge's latest reading. Not a running total (state class
 *  total / total_increasing: "Daily rain" stays above 0 long after it
 *  stopped), and not a chance of rain (%: above 0 nearly all the time).
 *  Device class precipitation is ACCUMULATED rain in Home Assistant, so it
 *  counts only when the sensor says it is a live measurement (Netatmo's
 *  gauge does; Buienradar's "rain last 24h" says nothing and is a total). */
export function rainSensorIds(states){
  const st = states || {};
  const a = (eid, k) => String((st[eid] && st[eid].attributes && st[eid].attributes[k]) || "").trim();
  return Object.keys(st).filter(eid => {
    if (!/^(binary_sensor|sensor)\./.test(eid)) return false;
    const dc = a(eid, "device_class"), sc = a(eid, "state_class");
    if (/^total/.test(sc) || a(eid, "unit_of_measurement") === "%") return false;
    if (dc === "precipitation" && sc !== "measurement") return false;
    return ["moisture", "precipitation", "precipitation_intensity"].includes(dc)
      || /rain|precip|regen|pluie|lluvia|pioggia/i.test(`${a(eid, "friendly_name")} ${eid}`);
  }).sort();
}

/** The weather entity used when none is chosen: the first weather.* (by id)
 *  with a reading, else the first at all. Onboarding makes Met.no's
 *  weather.forecast_home, so nearly every install has one. */
export function firstWeatherEntity(states){
  const ids = Object.keys(states || {}).filter(e => e.startsWith("weather.")).sort();
  return ids.find(e => reading(states[e]) !== null) || ids[0] || "";
}

/** The weather entity's temperature in °C, or null. */
export function temperatureC(st){
  const a = (st && st.attributes) || {};
  const t = Number(a.temperature);
  if (a.temperature === null || a.temperature === undefined || a.temperature === "" || !Number.isFinite(t)) return null;
  return /F/i.test(String(a.temperature_unit || "")) ? (t - 32) * 5 / 9 : t;
}

// Which integration an entity comes from: the entity registry's platform
// (hass.entities), else what its id says.
export function platformOf(eid, states, entities){
  const reg = entities && entities[eid];
  if (reg && reg.platform) { const p = String(reg.platform); return PLATFORM_ALIASES[p] || p; }
  const e = String(eid || "");
  if (/^binary_sensor\.meteoalarm/.test(e)) return "meteoalarm";
  if (/^sensor\..*_(current|advance)_warning_level$/.test(e)) return "dwd_weather_warnings";
  if (/^binary_sensor\.warning_.+_\d+$/.test(e)) return "nina";
  if (/^sensor\..*_weather_alert$/.test(e)) return "meteo_france";
  if (/^sensor\.weatheralerts/.test(e)) return "weatheralerts";
  if (/^sensor\.nws_alerts/.test(e)) return "nws_alerts";
  const attrib = String((states && states[e] && states[e].attributes && states[e].attributes.attribution) || "");
  if (/_warnings$/.test(e) && /environment canada|eccc/i.test(attrib)) return "env_canada";
  return "";
}

// Environment Canada makes warnings/watches/advisories/statements/endings
// sensors (only the first is warnings); DWD a current and an advance level.
// Météo-France makes forecast sensors beside its one alert sensor — "Next
// rain" carries "Pluie faible" whenever rain is due, which is no warning —
// so only "<dept> Weather alert" counts: its id, or its state, which is
// always a vigilance colour (Vert / Jaune / Orange / Rouge).
function isWarningSensor(eid, platform, entities, states){
  const tk = String((entities && entities[eid] && entities[eid].translation_key) || "");
  if (platform === "env_canada") return tk === "warnings" || /_warnings$/.test(eid);
  if (platform === "dwd_weather_warnings") return tk === "current_warning_level" || /current_warning_level/.test(eid);
  if (platform === "meteo_france") {
    const v = reading(states && states[eid]);
    return /_weather_alert$/.test(eid) || (v !== null && /^(vert|jaune|orange|rouge)$/i.test(v));
  }
  return eid.startsWith("sensor.") || eid.startsWith("binary_sensor.");
}

/** The warning entities to read: the chosen one, else every detected one. */
export function warningEntities(cfg, states, entities){
  if (cfg && cfg.warningEntity) return [cfg.warningEntity];
  const out = [];
  for (const eid of Object.keys(states || {})) {
    if (!eid.startsWith("sensor.") && !eid.startsWith("binary_sensor.")) continue;
    const p = platformOf(eid, states, entities);
    if (WARNING_PLATFORMS.includes(p) && isWarningSensor(eid, p, entities, states)) out.push(eid);
  }
  return out.sort();
}

// An alert sensor is quiet at 0 / off / Vert (Météo-France's green).
function alertActive(st){
  const v = reading(st);
  if (v === null) return false;
  const lv = v.toLowerCase();
  if (["off", "0", "none", "no", "false", "vert", "green", "inactive", "clear"].includes(lv)) return false;
  const n = Number(v);
  return Number.isFinite(n) ? n > 0 : true;
}

// The words, case-insensitive. English is the rule (rain / rainfall / snow /
// snowfall); the German, French, Dutch, Spanish and Italian words are there
// because DWD and NINA write only German, Météo-France only French, and
// MeteoAlarm often the local language — the fallbacks have to work outside
// Canada. "Rainier", "Regensburg" and "Rains County" are not rain: place
// names are skipped by key and the words end where a word ends.
const RAIN_WORDS = [/\brain(?:fall|s?storms?|y|s)?\b/i, /regen(?![a-zäöüß])/i, /\bpluie/i, /\blluvi/i, /\bpiogg/i];
const SNOW_WORDS = [/\bsnow(?:fall|s?storms?|y|s|squalls?)?\b/i, /schnee/i, /\bsneeuw/i, /\bneige/i, /\bnieve/i, /\bnevicat/i, /\bneve\b/i];
const SKIP_KEY = /area|region|location|sender|zone|count(y|ies)|city|place|url|link|web|instruction|^id$|friendly_name|icon|attribution|unit_of_measurement|device_class|entity_picture|state_class/i;
const LEVEL_QUIET = /^(vert|green)$/i;
const LEVEL_ON = /^(jaune|orange|rouge|yellow|red|amber)$/i;

/** Every piece of text an alert entity carries, hazard fields only. */
export function alertTexts(attrs, depth = 0, out = []){
  if (!attrs || typeof attrs !== "object" || depth > 3) return out;
  for (const [k, v] of Object.entries(attrs)) {
    if (SKIP_KEY.test(String(k))) continue;
    if (typeof v === "string") {
      const t = v.trim();
      if (LEVEL_QUIET.test(t)) continue;
      // Météo-France: {"Pluie-inondation": "Jaune"} — the KEY is the hazard.
      out.push(LEVEL_ON.test(t) ? String(k) : t);
    } else if (v && typeof v === "object") {
      alertTexts(v, depth + 1, out);
    }
  }
  return out;
}

export function textSaysRain(t){ return RAIN_WORDS.some(r => r.test(String(t || ""))); }
export function textSaysSnow(t){ return SNOW_WORDS.some(r => r.test(String(t || ""))); }

/** {rain, snow, platform, missing} from the warning source(s). */
export function activeWarning(cfg, states, entities){
  const st = states || {};
  const out = { rain: false, snow: false, platform: null, missing: false };
  for (const eid of warningEntities(cfg, st, entities)) {
    const s = st[eid];
    if (reading(s) === null) { if (cfg && cfg.warningEntity) out.missing = true; continue; }
    if (!alertActive(s)) continue;
    const texts = alertTexts(s.attributes || {});
    const rain = texts.some(textSaysRain), snow = texts.some(textSaysSnow);
    if (!rain && !snow) continue;
    const p = platformOf(eid, st, entities);
    if (snow && !out.snow) { out.snow = true; out.platform = p; }
    if (rain && !out.rain) { out.rain = true; if (!out.snow) out.platform = p; }
  }
  return out;
}

// ── THE decision (pure: settings + hass.states [+ hass.entities]) ────────────
// {kind:"off"|"rain"|"snow", heavy, rim, source, warning, why, missing[]}
//   source   what made it wet (rain_sensor | condition), or none
//   warning  "warning:<platform>" when a warning made it heavy, else null
//   why      disabled | dry | no_source | wet
//   missing  configured entities that are missing or unavailable (the
//            warning one only while wet: warnings are read only then)
export function decideAtlasWeather(cfg, states, entities){
  const s = cfg || {};
  const st = states || {};
  const missing = [];
  const off = (why, source) => ({ kind: "off", heavy: false, rim: false, source, warning: null, why, missing });
  if (!s.enabled) return off("disabled", "none");
  let wet = null, source = "none";
  if (s.rainEntity) {
    const r = rainReading(st[s.rainEntity]);
    if (r === null) missing.push("rain");
    else { wet = r; source = "rain_sensor"; }
  }
  const condEid = s.conditionEntity || firstWeatherEntity(st);
  const condSt = condEid ? st[condEid] : null;
  const condRaw = reading(condSt);
  const cond = condRaw === null ? null : condRaw.toLowerCase();
  if (s.conditionEntity && cond === null) missing.push("condition");
  if (wet === null && cond !== null) { wet = WET_CONDITIONS.includes(cond); source = "condition"; }
  if (wet === null) return off("no_source", "none");
  if (!wet) return off("dry", source);
  // A warning only ever makes it heavier, so warnings are read only while it
  // is wet — not a scan of every sensor on every dry poll.
  const warn = activeWarning(s, st, entities);
  if (warn.missing) missing.push("warning");
  const tC = cond === null ? null : temperatureC(condSt);
  // A snowfall warning forces snow; HA has no heavy-snow condition.
  const kind = (warn.snow || SNOW_CONDITIONS.has(cond) || (tC !== null && tC <= SNOW_AT_OR_BELOW_C)) ? "snow" : "rain";
  const byWarning = kind === "snow" ? warn.snow : warn.rain;
  const heavy = kind === "snow" ? warn.snow : (warn.rain || cond === "pouring");
  const plat = WARNING_PLATFORMS.includes(warn.platform) ? warn.platform : "other";
  return { kind, heavy, rim: kind === "snow" && heavy, source,
           warning: heavy && byWarning ? `warning:${plat}` : null, why: "wet", missing };
}

/** The usage-report state name for what is drawn, or null. */
export function shownStateOf(v){
  if (!v || v.kind === "off") return null;
  return `${v.heavy ? "heavy" : "light"}_${v.kind}`;
}

// A reading that vanished (HA restarting, a sensor dropping off the network)
// is no signal, not "stopped raining": what was showing stays for a while
// instead of blinking out and back.
export const HOLD_MS = 120000;
export function holdVisual(shown, lastLiveMs, decision, nowMs){
  if (decision && decision.why === "no_source" && shown && shown.kind !== "off"
      && Number.isFinite(lastLiveMs) && nowMs - lastLiveMs < HOLD_MS) return shown;
  return { kind: decision ? decision.kind : "off", heavy: !!(decision && decision.heavy), rim: !!(decision && decision.rim) };
}

// ── Geometry: the floor plates the renderer drew ─────────────────────────────
// Read straight from buildIsoSVG's own output, so the mask is the drawing by
// construction: every <g data-role="floorslab" data-z> holds a plate's two
// visible sides and its top, in viewBox coordinates.
export function atlasPlatesFromSvg(svg){
  const s = String(svg || "");
  const vb = /<svg\b[^>]*\bviewBox="([^"]+)"/.exec(s);
  if (!vb) return null;
  const v = vb[1].trim().split(/[\s,]+/).map(Number);
  if (v.length !== 4 || v.some(n => !Number.isFinite(n)) || !(v[2] > 0) || !(v[3] > 0)) return null;
  const plates = [];
  for (const m of s.matchAll(/<g data-role="floorslab" data-z="([^"]*)"[^>]*>([\s\S]*?)<\/g>/g)) {
    const seen = new Set(), polys = [];
    for (const p of m[2].matchAll(/<polygon points="([^"]+)"/g)) {
      const key = p[1].trim();
      if (seen.has(key)) continue;
      seen.add(key);
      const pts = key.split(/\s+/).map(pair => pair.split(",").map(Number));
      if (pts.length >= 3 && pts.every(q => q.length === 2 && q.every(Number.isFinite))) polys.push(pts);
    }
    if (polys.length) plates.push({ z: Number(m[1]), polys });
  }
  return { viewBox: v, plates };
}

/** Plates whose every room and light is on an outdoor floor (a garden, a
 *  yard): rain falls on those. The fabric's own outside is on no plate. */
export function outdoorPlateLevels(frame, isOutdoor){
  const byZ = new Map();
  const add = (z, fid) => { if (!byZ.has(z)) byZ.set(z, []); byZ.get(z).push(!!isOutdoor(fid)); };
  for (const r of (frame && frame.rooms) || []) add(r.z, r.floor_id);
  for (const l of (frame && frame.lights) || []) add(l.z, l.floor_id);
  const out = new Set();
  for (const [z, flags] of byZ) if (flags.length && flags.every(Boolean)) out.add(z);
  return out;
}

const f1 = (n) => String(Math.round(n * 10) / 10);
const polyPts = (p) => p.map(q => `${f1(q[0])},${f1(q[1])}`).join(" ");

/** THE mask: an SVG image the size of the map. It must be an ALPHA mask — an
 *  inner <mask> leaves the image opaque everywhere and transparent over the
 *  plates. A plain black-and-white picture does not clip (both colours are
 *  opaque), and mask-mode:luminance is not there on older wall-tablet
 *  WebViews. gap: the feathered margin at every plate edge, viewBox units. */
export function buildWeatherMaskSvg(viewBox, polys, gap = 2){
  const [x, y, w, h] = viewBox;
  const g = Math.max(0.5, Number(gap) || 2);
  const box = `x="${x}" y="${y}" width="${w}" height="${h}"`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${x} ${y} ${w} ${h}" preserveAspectRatio="none">`
    + `<defs><filter id="f" x="-5%" y="-5%" width="110%" height="110%">`
    + `<feMorphology operator="dilate" radius="${g}"/><feGaussianBlur stdDeviation="${g}"/></filter>`
    + `<mask id="m" maskUnits="userSpaceOnUse" ${box}><rect ${box} fill="#fff"/>`
    + `<g fill="#000" filter="url(#f)">${(polys || []).map(p => `<polygon points="${polyPts(p)}"/>`).join("")}</g>`
    + `</mask></defs><rect ${box} fill="#fff" mask="url(#m)"/></svg>`;
}
const svgUrl = (svg) => `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;

// ── Colour ───────────────────────────────────────────────────────────────────
/** A Showcase theme's washStops colour (#fff Classic, #dceeff Cinematic
 *  Glass); white for anything without one. */
export function weatherColourOf(theme){
  const c = theme && Array.isArray(theme.washStops) && theme.washStops[0] && theme.washStops[0][1];
  return /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(String(c || "")) ? String(c) : "#fff";
}
function rgba(hex, a){
  let h = String(hex).slice(1);
  if (h.length === 3) h = h.split("").map(c => c + c).join("");
  const v = parseInt(h, 16);
  return `rgba(${(v >> 16) & 255},${(v >> 8) & 255},${v & 255},${a})`;
}

// ── Particles: repeating tiles, made once per seed ───────────────────────────
// Streaks are 1 px, a gradient from nothing up to the layer's maximum, no
// drop heads; flakes are soft baked-blur dots. Opacities are baked at 1.5x
// (the top of the strength range) and the overlay's own opacity brings them
// back down, so the strength setting never regenerates a tile. The rim, the
// ripples and the haze (styles.css) are baked the same way.
const BAKE = STRENGTH_MAX;
export const RAIN_LAYERS = [
  { id: "r0", tier: "base",  w: 240, h: 280, n: 12, len: 16, op: 0.11, width: 1,   dur: 1.25 },   // drizzle, ~3°
  { id: "r1", tier: "heavy", w: 200, h: 240, n: 44, len: 26, op: 0.12, width: 1,   dur: 0.8 },    // far sheet
  { id: "r2", tier: "heavy", w: 260, h: 300, n: 26, len: 40, op: 0.18, width: 1,   dur: 0.6 },    // mid
  { id: "r3", tier: "heavy", w: 320, h: 360, n: 12, len: 64, op: 0.24, width: 1.3, dur: 0.42 },   // near streaks
];
export const SNOW_LAYERS = [
  { id: "s0", tier: "base",  w: 240, h: 240, n: 34, rad: 1.0, op: 0.42, blur: 0.35, dur: 26, sway: [7, 10] },
  { id: "s1", tier: "base",  w: 300, h: 300, n: 20, rad: 1.7, op: 0.5,  blur: 0.6,  dur: 17, sway: [5.5, 16] },
  { id: "s2", tier: "heavy", w: 260, h: 260, n: 40, rad: 1.1, op: 0.4,  blur: 0.4,  dur: 21, sway: [6.3, 12] },
  { id: "s3", tier: "heavy", w: 380, h: 380, n: 9,  rad: 2.8, op: 0.5,  blur: 1.3,  dur: 10, sway: [4.2, 24] },
];
const ALL_LAYERS = [...RAIN_LAYERS.map(l => ({ ...l, kind: "rain" })), ...SNOW_LAYERS.map(l => ({ ...l, kind: "snow" }))];

/** A Park–Miller generator: the same seed, the same tile, every time. */
export function seededRandom(seed){
  let s = (Math.abs(Math.floor(Number(seed) || 1)) % 2147483646) + 1;
  return () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646;
}
export function rainTileSvg(L, colour, seed){
  const rnd = seededRandom(seed);
  let r = "";
  for (let i = 0; i < L.n; i++) {
    const x = (rnd() * L.w).toFixed(1), y = rnd() * L.h, l = L.len * (0.7 + rnd() * 0.6);
    const o = (Math.min(1, L.op * BAKE) * (0.55 + rnd() * 0.45)).toFixed(3);
    for (const yy of [y, y - L.h]) if (yy + l > 0 && yy < L.h)
      r += `<rect x="${x}" y="${yy.toFixed(1)}" width="${L.width}" height="${l.toFixed(1)}" fill="url(#g)" opacity="${o}"/>`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${L.w}" height="${L.h}"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1">`
    + `<stop offset="0" stop-color="${colour}" stop-opacity="0"/><stop offset="1" stop-color="${colour}"/></linearGradient></defs>${r}</svg>`;
}
export function snowTileSvg(L, colour, seed){
  const rnd = seededRandom(seed);
  let r = "";
  for (let i = 0; i < L.n; i++) {
    const x = rnd() * L.w, y = rnd() * L.h, rr = L.rad * (0.6 + rnd() * 0.7);
    const o = (Math.min(1, L.op * BAKE) * (0.5 + rnd() * 0.5)).toFixed(3);
    for (const dx of [0, -L.w, L.w]) for (const dy of [0, -L.h, L.h]) {
      const X = x + dx, Y = y + dy;
      if (X > -8 && X < L.w + 8 && Y > -8 && Y < L.h + 8) r += `<circle cx="${X.toFixed(1)}" cy="${Y.toFixed(1)}" r="${rr.toFixed(2)}" opacity="${o}"/>`;
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${L.w}" height="${L.h}"><defs><filter id="b" x="-50%" y="-50%" width="200%" height="200%">`
    + `<feGaussianBlur stdDeviation="${L.blur}"/></filter></defs><g fill="${colour}" filter="url(#b)">${r}</g></svg>`;
}
const _tiles = new Map();
/** {layerId: css url(...)} for one colour — generated once, then cached. */
export function weatherTiles(colour){
  const key = String(colour);
  if (_tiles.has(key)) return _tiles.get(key);
  const out = {};
  ALL_LAYERS.forEach((L, i) => {
    const seed = 7 + i * 101;
    out[L.id] = svgUrl(L.kind === "rain" ? rainTileSvg(L, key, seed) : snowTileSvg(L, key, seed));
  });
  _tiles.set(key, out);
  return out;
}

// ── The overlay ──────────────────────────────────────────────────────────────
const OFF = Object.freeze({ kind: "off", heavy: false, rim: false });
const FADE_IN_S = 3, FADE_OUT_S = 2.5, WIND_S = 6, RIM_S = 8, HAZE_S = 4;
const RIPPLES_LIGHT = 4, RIPPLES_HEAVY = 20;
// Wind: near-vertical when light, 17° in heavy rain.
const angleOf = (v) => (v.kind === "snow" ? (v.heavy ? 9 : 3) : v.kind === "rain" ? (v.heavy ? 17 : 3) : 3);
const layerOn = (L, v) => v.kind === L.kind && (L.tier === "base" || v.heavy);
const same = (a, b) => a.kind === b.kind && !!a.heavy === !!b.heavy && !!a.rim === !!b.rim;

/** Can this browser clip an element with an image at all? No mask, no
 *  weather — an unmasked overlay would rain on every room. */
export function maskSupported(){
  const C = globalThis.CSS;
  if (!C || typeof C.supports !== "function") return true;
  try { return C.supports("mask-image", "url(#m)") || C.supports("-webkit-mask-image", "url(#m)"); }
  catch (_) { return true; }
}
function reducedMotion(){
  try { return !!(globalThis.matchMedia && globalThis.matchMedia("(prefers-reduced-motion: reduce)").matches); }
  catch (_) { return false; }
}

const _slots = new Map();
/** One overlay per surface ("atlas" — the sidebar; "builder" — Mapping). */
export function atlasWeatherSlot(key){
  const k = String(key || "atlas");
  if (!_slots.has(k)) _slots.set(k, createSlot(k));
  return _slots.get(k);
}

function createSlot(slotKey){
  let root = null, parts = null;
  let maskKey = null, rimKey = null, colourKey = null, aspect = null;
  let shown = OFF, prev = OFF, since = -Infinity, lastLive = -Infinity;

  const detach = () => { try { if (root) root.remove(); } catch (_) { /* already gone */ } };

  function build(){
    const d = (cls) => { const n = document.createElement("div"); n.className = cls; return n; };
    root = d("lv-wx");
    root.setAttribute("aria-hidden", "true");
    const haze = d("lv-wx-haze");
    const tilt = d("lv-wx-tilt");
    const layers = {};
    ALL_LAYERS.forEach((L, i) => {
      const layer = d("lv-wx-layer");
      layer.style.setProperty("--tw", `${L.w}px`);
      layer.style.setProperty("--th", `${L.h}px`);
      let host = layer;
      if (L.sway) { host = d("lv-wx-sway"); host.appendChild(layer); }
      host.style.display = "none";
      tilt.appendChild(host);
      layers[L.id] = { L, host, layer, phase: seededRandom(31 + i * 7)() * L.dur };
    });
    const ripples = d("lv-wx-ripples");
    const rp = [];
    const rnd = seededRandom(97);
    for (let i = 0; i < RIPPLES_HEAVY; i++) {
      const e = d("lv-wx-rp");
      const place = () => {
        e.style.left = `${(Math.random() * 100).toFixed(2)}%`;
        e.style.top = `${(8 + Math.random() * 90).toFixed(2)}%`;
      };
      e.style.left = `${(rnd() * 100).toFixed(2)}%`;
      e.style.top = `${(8 + rnd() * 90).toFixed(2)}%`;
      // Rounded once: the CSS duration and the clock's phase (paintLayers)
      // must use the very same period.
      const dur = Math.round((1.1 + rnd() * 0.4) * 100) / 100, off = rnd() * 1.25;
      // A new place each time the ring finishes; the mask drops any that
      // land on a plate. The listener lives and dies with this element.
      e.addEventListener("animationiteration", place);
      ripples.appendChild(e);
      rp.push({ e, dur, off });
    }
    const rim = d("lv-wx-rim");
    root.appendChild(haze); root.appendChild(tilt); root.appendChild(ripples); root.appendChild(rim);
    parts = { haze, tilt, layers, ripples, rp, rim };
    // A fade-out that has run its course takes its layer out of the
    // compositor (and the whole overlay out of the page once the weather
    // stopped), rather than leaving invisible layers falling until the next
    // re-render — which, in the builder, may be a long way off. One listener
    // on this one persistent element, never re-added.
    root.addEventListener("animationend", (e) => {
      try {
        if (!e || e.animationName !== "lv-wx-out") return;
        if (shown.kind === "off") { detach(); return; }
        const t = e.target;
        if (!t || !t.style || t.style.opacity !== "0") return;
        if (t.classList && t.classList.contains("lv-wx-layer")) {
          const host = t.parentNode && t.parentNode.classList && t.parentNode.classList.contains("lv-wx-sway") ? t.parentNode : t;
          host.style.display = "none";
        } else if (t === parts.ripples || t === parts.rim) t.style.display = "none";
      } catch (_) { /* tidy-up only */ }
    });
  }

  // `fade`: in | out | null — as a one-shot animation anchored to when the
  // change happened, so a re-render mid-fade carries on where it was.
  const fadeAnim = (fade, elapsed, dur) => (fade ? `lv-wx-${fade} ${dur}s ease ${(-elapsed).toFixed(2)}s both` : "");
  function paintLayers(nowMs){
    const t = nowMs / 1000, elapsed = Math.max(0, (nowMs - since) / 1000);
    for (const { L, host, layer, phase } of Object.values(parts.layers)) {
      const on = layerOn(L, shown), was = layerOn(L, prev);
      let fade = null;
      if (on && !was && elapsed < FADE_IN_S) fade = "in";
      else if (!on && was && elapsed < FADE_OUT_S) fade = "out";
      else if (!on) { host.style.display = "none"; continue; }
      host.style.display = "block";
      // The fall's phase is the clock's, so the new stage picks up the
      // streaks where the old one left them.
      const fall = `lv-wx-fall ${L.dur}s linear ${(-((t + phase) % L.dur)).toFixed(3)}s infinite`;
      const fd = fade === "in" ? FADE_IN_S : FADE_OUT_S;
      layer.style.animation = fade ? `${fall}, ${fadeAnim(fade, elapsed, fd)}` : fall;
      layer.style.opacity = on ? "1" : "0";
      if (L.sway) {
        const [sd, sa] = L.sway;
        host.style.setProperty("--sa", `${sa}px`);
        host.style.animation = `lv-wx-sway ${sd}s ease-in-out ${(-((t + phase) % (2 * sd))).toFixed(3)}s infinite alternate`;
      }
    }
    // Wind eases between angles over 6 s; speed never changes (that jumps).
    const a0 = angleOf(prev), a1 = angleOf(shown);
    parts.tilt.style.setProperty("--a0", `${a0}deg`);
    parts.tilt.style.setProperty("--a1", `${a1}deg`);
    parts.tilt.style.animation = a0 !== a1 && elapsed < WIND_S ? `lv-wx-wind ${WIND_S}s ease-in-out ${(-elapsed).toFixed(2)}s both` : "none";
    // Haze: heavy only, a faint cool edge.
    const hazeOn = !!shown.heavy, hazeWas = !!prev.heavy;
    parts.haze.style.opacity = hazeOn ? "1" : "0";
    parts.haze.style.animation = hazeOn !== hazeWas && elapsed < HAZE_S ? fadeAnim(hazeOn ? "in" : "out", elapsed, HAZE_S) : "none";
    // Ripples: rain only, 4 at a time light, ~20 heavy. Pro only (CSS .still).
    const rpOn = shown.kind === "rain", rpWas = prev.kind === "rain";
    parts.ripples.style.display = rpOn || (rpWas && elapsed < FADE_OUT_S) ? "block" : "none";
    parts.ripples.style.opacity = rpOn ? "1" : "0";
    parts.ripples.style.animation = rpOn !== rpWas && elapsed < FADE_IN_S ? fadeAnim(rpOn ? "in" : "out", elapsed, rpOn ? FADE_IN_S : FADE_OUT_S) : "none";
    const n = shown.heavy || (!rpOn && prev.heavy) ? RIPPLES_HEAVY : RIPPLES_LIGHT;
    // Each ring's phase is the clock's too: the overlay is re-inserted on
    // every poll, and a fixed delay would cut every ring back to the same
    // moment every few seconds.
    parts.rp.forEach(({ e, dur, off }, i) => {
      e.style.display = i < n ? "block" : "none";
      e.style.animation = `lv-wx-ripple ${dur}s ease-out ${(-((t + off) % dur)).toFixed(3)}s infinite`;
    });
    // The snow rim builds over ~8 s along the outside of the plates.
    const rimOn = !!shown.rim, rimWas = !!prev.rim;
    parts.rim.style.display = rimOn || (rimWas && elapsed < FADE_OUT_S) ? "block" : "none";
    parts.rim.style.opacity = rimOn ? "1" : "0";
    parts.rim.style.animation = rimOn !== rimWas ? (rimOn ? (elapsed < RIM_S ? fadeAnim("in", elapsed, RIM_S) : "none")
      : fadeAnim("out", elapsed, FADE_OUT_S)) : "none";
  }

  /** Line the overlay up with the drawing: the same width (the zoom, as a
   *  percentage of the stage, exactly as applyZoom sizes the SVG — capped
   *  where styles.css caps the SVG), the same centring, and the drawing's own
   *  aspect. styles.css turns these into a width, a padding-top and the same
   *  negative margin-top, all in % of the stage width, so the overlay sits
   *  over the SVG in flow, pans with it natively and adds nothing to the
   *  scroll area. */
  function fit(zoom, centred){
    if (!root || !aspect) return;
    const zp = Math.round((Number(zoom) || 1) * 100);
    root.style.setProperty("--wxz", `${zp}%`);
    root.style.setProperty("--wxa", aspect.toFixed(6));
    root.style.marginLeft = centred ? "auto" : "0";
    root.style.marginRight = centred ? "auto" : "0";
    // The tilted field must still cover the whole drawing at the steepest
    // wind (17°; sized for 20°), whatever its shape — a four-storey stack
    // is three times taller than wide, a bungalow wider than tall.
    const s = Math.sin(20 * Math.PI / 180), c = Math.cos(20 * Math.PI / 180), a = aspect;
    const lr = Math.max(10, Math.ceil(((s * a + c - 1) / 2) * 100) + 5);
    const tb = Math.max(10, Math.ceil(((s + c * a - a) / (2 * a)) * 100) + 5);
    root.style.setProperty("--wxlr", `${lr}%`);
    root.style.setProperty("--wxtb", `${tb}%`);
  }

  return {
    get element(){ return root; },
    get shown(){ return shown; },
    fit,
    detach(){ detach(); },
    /** Mount into a freshly built stage. Never throws: any failure is
     *  counted and the Atlas simply has no weather.
     *  p = {settings, states, entities, svg, animate, colour, outdoorZ,
     *       zoom, centred, stageWidth, telemetry, nowMs} */
    attach(isoDiv, p){
      const send = p && p.telemetry;
      const err = (k) => countWeatherOnce(`weather_error:${k}`, send);
      try {
        const cfg = p && p.settings;
        if (!cfg || !cfg.enabled) { shown = prev = OFF; since = -Infinity; detach(); return false; }
        const now = Number.isFinite(p.nowMs) ? p.nowMs : Date.now();
        let d;
        try { d = decideAtlasWeather(cfg, p.states || {}, p.entities); }
        catch (_) { err("decision"); detach(); return false; }
        // A chosen entity that no longer exists: deleted or renamed, so the
        // setting points at nothing. Unavailable is a sensor dropping off
        // for a while (a restart, the network), and one still in the entity
        // registry has only not loaded yet (Home Assistant starting): no
        // error. A fallback, where there is one, still draws: the one kind
        // that need not mean "no weather".
        const has = (o, e) => !!o && Object.prototype.hasOwnProperty.call(o, e);
        if ([cfg.rainEntity, cfg.conditionEntity, cfg.warningEntity]
          .some(e => e && !has(p.states, e) && !has(p.entities, e))) err("source");
        countWeatherOnce(`weather_source:${d.source}`, send);
        if (d.warning) countWeatherOnce(`weather_source:${d.warning}`, send);
        if (d.why !== "no_source") lastLive = now;
        const v = holdVisual(shown, lastLive, d, now);
        if (!same(v, shown)) { prev = shown; shown = v; since = now; }
        const fadingOut = shown.kind === "off" && prev.kind !== "off" && (now - since) / 1000 < FADE_OUT_S;
        if (shown.kind === "off" && !fadingOut) { detach(); return false; }
        if (!maskSupported()) { err("mask_unsupported"); detach(); return false; }
        // Geometry → mask, only when the drawing's plates or frame changed.
        let geo = null;
        try { geo = atlasPlatesFromSvg(p.svg); } catch (_) { geo = null; }
        if (!geo) { err("mask_build"); detach(); return false; }
        const outZ = p.outdoorZ instanceof Set ? p.outdoorZ : new Set();
        const polys = geo.plates.filter(pl => !outZ.has(pl.z)).flatMap(pl => pl.polys);
        // ~3 px of feathered gap at every wall, whatever the zoom: the
        // stage's width in screen px over the viewBox's width in units.
        const ppu = Math.max(0.2, ((Number(p.stageWidth) || globalThis.innerWidth || 1000) * (Number(p.zoom) || 1)) / geo.viewBox[2]);
        const gap = Math.max(0.5, Math.min(10, Math.round((3 / ppu) * 2) / 2));
        if (!root) {
          try { build(); } catch (_) { err("mount"); root = null; parts = null; return false; }
        }
        // A hex colour or white: it is written into SVG markup below.
        const colour = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(String(p.colour || "")) ? String(p.colour) : "#fff";
        const mk = `${geo.viewBox.join(",")}|${gap}|${polys.map(polyPts).join(";")}`;
        if (mk !== maskKey) {
          let url = null;
          try { url = svgUrl(buildWeatherMaskSvg(geo.viewBox, polys, gap)); } catch (_) { url = null; }
          if (!url) { err("mask_build"); detach(); return false; }
          root.style.setProperty("-webkit-mask-image", url);
          root.style.setProperty("mask-image", url);
          maskKey = mk;
        }
        aspect = geo.viewBox[3] / geo.viewBox[2];
        const rk = `${mk}|${colour}`;
        if (rk !== rimKey) {
          const [x, y, w, h] = geo.viewBox;
          const sw = (12 / ppu).toFixed(2), bl = (3.5 / ppu).toFixed(2), fid = `lvwx-rb-${slotKey}`;
          parts.rim.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${x} ${y} ${w} ${h}" preserveAspectRatio="none" width="100%" height="100%">`
            + `<defs><filter id="${fid}" x="-5%" y="-5%" width="110%" height="110%"><feGaussianBlur stdDeviation="${bl}"/></filter></defs>`
            + `<g filter="url(#${fid})" fill="none" stroke="${colour}" stroke-opacity="${(0.38 * BAKE).toFixed(3)}" stroke-width="${sw}" stroke-linejoin="round">`
            + polys.map(q => `<polygon points="${polyPts(q)}"/>`).join("") + `</g></svg>`;
          rimKey = rk;
        }
        if (colour !== colourKey) {
          let tiles = null;
          try { tiles = weatherTiles(colour); } catch (_) { tiles = null; }
          if (!tiles) { err("tiles"); detach(); return false; }
          for (const { L, layer } of Object.values(parts.layers)) layer.style.backgroundImage = tiles[L.id];
          root.style.setProperty("--rp", rgba(colour, Math.min(1, 0.55 * BAKE)));
          colourKey = colour;
        }
        const k = Number(cfg.strength);
        root.style.opacity = String(Math.round(((Number.isFinite(k) ? k : 1) / BAKE) * 1000) / 1000);
        // Free, and prefers-reduced-motion: the same weather, still — no
        // motion of any kind, no ripples.
        const still = !p.animate || reducedMotion();
        root.classList.toggle("still", still);
        paintLayers(now);
        // Out of the old stage (a removed element's animations restart —
        // the anchored delays above are what keep them continuous), into
        // the new one, right after the SVG.
        detach();
        isoDiv.appendChild(root);
        fit(p.zoom, p.centred);
        const st = shownStateOf(shown);
        if (st) countWeatherOnce(`weather_shown:${st}`, send);
        if (st && still) countWeatherOnce("weather_shown:still", send);
        return true;
      } catch (_) {
        err("mount");
        detach();
        return false;
      }
    },
    // Tests: where the slot believes it is.
    _state(){ return { shown, prev, since, lastLive, maskKey, colourKey }; },
  };
}
export function _resetWeatherSlotsForTests(){ for (const s of _slots.values()) s.detach(); _slots.clear(); _tiles.clear(); }
