// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
//
// Atlas outdoor weather (views/atlas_weather.js), run for real.
//
//   decisions  every row of docs/IDEA_ATLAS_WEATHER.md's decision table, the
//              fallbacks, warning auto-detect for every listed integration,
//              the alert-text words, the temperature rule, numeric sensors,
//              unavailable = no signal, and inputs that must never crash
//   mask       from a real buildIsoSVG drawing: the plates it drew, an ALPHA
//              mask that is transparent exactly over them, outdoor plates left
//              out
//   contract   the Atlas SVG is byte-identical with the feature absent, off,
//              and raining (the overlay lives outside the drawing)
//   overlay    mounted after the SVG, the same element moved into each new
//              stage, its animation phase anchored to the clock, still on the
//              free map, removed when off or disabled, never a throw
//   telemetry  closed words only, once per page load, never an entity id
//
// usage: atlas_weather.mjs <www/padspan-ha dir>
// prints one JSON line: { cases: {name: result}, lists: {...}, failures: [...] }

import { pathToFileURL } from "node:url";
import { join } from "node:path";
import { install } from "./dom_shim.mjs";

const WWW = process.argv[2];
if (!WWW) { console.error("usage: atlas_weather.mjs <www/padspan-ha dir>"); process.exit(2); }
install(globalThis);

const WX = await import(pathToFileURL(join(WWW, "views", "atlas_weather.js")).href);
const ISO = await import(pathToFileURL(join(WWW, "views", "iso_lights.js")).href);
const LM = await import(pathToFileURL(join(WWW, "views", "lights_map.js")).href);

const failures = [];
const cases = {};
const check = (name, ok, detail) => { cases[name] = !!ok; if (!ok) failures.push({ name, detail: detail === undefined ? null : detail }); };
const tryCase = (name, fn) => { try { fn(); } catch (e) { failures.push({ name, detail: String(e && e.stack || e).slice(0, 900) }); cases[name] = false; } };

// ── helpers ─────────────────────────────────────────────────────────────────
const S = (state, attributes = {}) => ({ state: String(state), attributes });
const cfg = (o = {}) => WX.weatherSettingsFrom({ atlas_weather_enabled: true, ...o });
const decide = (o, states, entities) => WX.decideAtlasWeather(cfg(o), states, entities);
const is = (d, kind, heavy) => d.kind === kind && !!d.heavy === !!heavy;
const RAIN = "binary_sensor.rain", WEA = "weather.forecast_home";
const wx = (cond, temp = 10, unit = "°C") => ({ [WEA]: S(cond, { temperature: temp, temperature_unit: unit }) });
const ECW = "sensor.vancouver_warnings";
// The registry names Environment Canada by its domain, environment_canada.
const EC_ENT = { [ECW]: { platform: "environment_canada", translation_key: "warnings" },
  "sensor.vancouver_watches": { platform: "environment_canada", translation_key: "watches" } };
const ecRain = { [ECW]: S(1, { alert_1: "Rainfall Warning", alert_time_1: "4:00 AM" }) };
const ecSnow = { [ECW]: S(1, { alert_1: "Snowfall warning in effect", alert_time_1: "4:00 AM" }) };

// ── decisions: the table ────────────────────────────────────────────────────
tryCase("table: setting off draws nothing whatever the sensors say", () => {
  const d = WX.decideAtlasWeather(WX.weatherSettingsFrom({ atlas_weather_enabled: false, atlas_weather_rain_entity: RAIN }),
    { [RAIN]: S("on"), ...wx("pouring"), ...ecRain }, EC_ENT);
  check("table: setting off draws nothing whatever the sensors say", d.kind === "off" && d.why === "disabled", d);
});
tryCase("table: rain sensor set, reading dry -> off", () => {
  const d = decide({ atlas_weather_rain_entity: RAIN }, { [RAIN]: S("off"), ...wx("pouring"), ...ecRain }, EC_ENT);
  check("table: rain sensor set, reading dry -> off", d.kind === "off" && d.why === "dry" && d.source === "rain_sensor", d);
});
tryCase("table: no rain sensor -> wet from the weather condition", () => {
  const got = {};
  for (const c of ["rainy", "pouring", "snowy", "snowy-rainy", "hail", "lightning-rainy", "cloudy", "sunny", "fog", "windy", "clear-night", "partlycloudy", "exceptional"]) {
    const d = decide({}, wx(c));
    got[c] = d.kind !== "off";
    if (d.kind !== "off" && d.source !== "condition") got[c] = "wrong source";
  }
  const want = { rainy: true, pouring: true, snowy: true, "snowy-rainy": true, hail: true, "lightning-rainy": true,
    cloudy: false, sunny: false, fog: false, windy: false, "clear-night": false, partlycloudy: false, exceptional: false };
  check("table: no rain sensor -> wet from the weather condition", JSON.stringify(got) === JSON.stringify(want), got);
});
tryCase("table: wet alone -> light rain", () => {
  const a = decide({ atlas_weather_rain_entity: RAIN }, { [RAIN]: S("on"), ...wx("cloudy") });
  const b = decide({}, wx("rainy"));
  const c = decide({}, wx("lightning-rainy"));
  const h = decide({}, wx("hail"));
  check("table: wet alone -> light rain", is(a, "rain", false) && a.source === "rain_sensor" && is(b, "rain", false)
    && is(c, "rain", false) && is(h, "rain", false) && !a.rim, { a, b, c, h });
});
tryCase("table: wet + rainfall warning -> heavy rain", () => {
  const d = decide({ atlas_weather_rain_entity: RAIN }, { [RAIN]: S("on"), ...wx("cloudy"), ...ecRain }, EC_ENT);
  check("table: wet + rainfall warning -> heavy rain", is(d, "rain", true) && d.warning === "warning:env_canada" && !d.rim, d);
});
tryCase("table: wet + condition pouring -> heavy rain", () => {
  const a = decide({}, wx("pouring"));
  const b = decide({ atlas_weather_rain_entity: RAIN }, { [RAIN]: S("on"), ...wx("pouring") });
  check("table: wet + condition pouring -> heavy rain", is(a, "rain", true) && a.warning === null && is(b, "rain", true), { a, b });
});
tryCase("table: wet + snowy/snowy-rainy or <= 1 C -> light snow", () => {
  const a = decide({}, wx("snowy"));
  const b = decide({}, wx("snowy-rainy"));
  const c = decide({}, wx("rainy", 1));
  const d = decide({}, wx("rainy", 0.5));
  const e = decide({ atlas_weather_rain_entity: RAIN }, { [RAIN]: S("on"), ...wx("cloudy", -4) });
  const f = decide({}, wx("rainy", 1.1));
  const g = decide({}, wx("rainy", 33, "°F"));    // 0.56 °C
  const h = decide({}, wx("rainy", 35, "°F"));    // 1.67 °C
  check("table: wet + snowy/snowy-rainy or <= 1 C -> light snow",
    [a, b, c, d, e, g].every(x => is(x, "snow", false) && !x.rim) && is(f, "rain", false) && is(h, "rain", false), { a, b, c, d, e, f, g, h });
});
tryCase("table: wet + snowfall warning -> heavy snow + rim (forces snow)", () => {
  const a = decide({ atlas_weather_rain_entity: RAIN }, { [RAIN]: S("on"), ...wx("rainy", 6), ...ecSnow }, EC_ENT);
  const b = decide({}, { ...wx("snowy", -2), ...ecSnow }, EC_ENT);
  check("table: wet + snowfall warning -> heavy snow + rim (forces snow)",
    is(a, "snow", true) && a.rim && a.warning === "warning:env_canada" && is(b, "snow", true) && b.rim, { a, b });
});
tryCase("table: snow is heavy only on a snowfall warning", () => {
  const a = decide({}, { ...wx("snowy"), ...ecRain }, EC_ENT);          // a RAINFALL warning while snowing
  const b = decide({}, wx("snowy"));
  const c = decide({}, { ...wx("pouring", 0) }, EC_ENT);               // pouring at 0 °C is snow — light
  check("table: snow is heavy only on a snowfall warning", is(a, "snow", false) && !a.rim && is(b, "snow", false) && is(c, "snow", false), { a, b, c });
});
tryCase("table: the rain sensor alone only ever means light", () => {
  const a = decide({ atlas_weather_rain_entity: "sensor.rain_rate" }, { "sensor.rain_rate": S("48.2", { unit_of_measurement: "mm/h" }), ...wx("cloudy") });
  const b = decide({ atlas_weather_rain_entity: "sensor.rain_rate" }, { "sensor.rain_rate": S("0.2"), ...wx("cloudy") });
  const c = decide({ atlas_weather_rain_entity: "sensor.rain_rate" }, { "sensor.rain_rate": S("0"), ...wx("rainy") });
  const d = decide({ atlas_weather_rain_entity: "sensor.rain_rate" }, { "sensor.rain_rate": S("0.0"), ...wx("rainy") });
  check("table: the rain sensor alone only ever means light", is(a, "rain", false) && is(b, "rain", false)
    && c.kind === "off" && c.why === "dry" && d.kind === "off", { a, b, c, d });
});
tryCase("table: a snowfall warning without wet is still off", () => {
  const a = decide({}, { ...wx("cloudy", -5), ...ecSnow }, EC_ENT);
  const b = decide({ atlas_weather_rain_entity: RAIN }, { [RAIN]: S("off"), ...wx("snowy"), ...ecSnow }, EC_ENT);
  check("table: a snowfall warning without wet is still off", a.kind === "off" && b.kind === "off", { a, b });
});

// ── fallbacks and no-signal ─────────────────────────────────────────────────
tryCase("fallback: no weather entity and no sensor -> off", () => {
  const a = decide({}, {});
  const b = decide({}, { "sensor.x": S(1) });
  check("fallback: no weather entity and no sensor -> off", a.kind === "off" && a.why === "no_source" && a.source === "none" && b.kind === "off", { a, b });
});
tryCase("fallback: the first weather.* with a reading is used", () => {
  const st = { "weather.zzz": S("rainy"), "weather.aaa": S("unavailable"), "weather.home": S("sunny") };
  const first = WX.firstWeatherEntity(st);
  const d = decide({}, st);
  const e = WX.firstWeatherEntity({ "weather.b": S("unknown"), "weather.a": S("unavailable") });
  check("fallback: the first weather.* with a reading is used", first === "weather.home" && d.kind === "off" && e === "weather.a", { first, d, e });
});
tryCase("fallback: a chosen weather entity wins over the first", () => {
  const st = { "weather.aaa": S("sunny"), "weather.owm": S("rainy") };
  const d = decide({ atlas_weather_condition_entity: "weather.owm" }, st);
  check("fallback: a chosen weather entity wins over the first", is(d, "rain", false), d);
});
tryCase("no signal: unavailable/unknown never counts as wet or dry", () => {
  const a = decide({ atlas_weather_rain_entity: RAIN }, { [RAIN]: S("unavailable"), ...wx("rainy") });   // falls back to the condition
  const b = decide({ atlas_weather_rain_entity: RAIN }, { [RAIN]: S("unknown"), ...wx("sunny") });
  const c = decide({ atlas_weather_rain_entity: RAIN }, { ...wx("unavailable") });                        // sensor missing, weather down
  const d = decide({}, { [WEA]: S("unknown") });
  const e = decide({ atlas_weather_rain_entity: "sensor.rain_rate" }, { "sensor.rain_rate": S("n/a"), ...wx("rainy") });
  const f = decide({ atlas_weather_condition_entity: "weather.gone" }, { "weather.other": S("rainy") });
  check("no signal: unavailable/unknown never counts as wet or dry",
    is(a, "rain", false) && a.source === "condition" && a.missing.includes("rain")
    && b.kind === "off" && b.why === "dry" && b.source === "condition"
    && c.kind === "off" && c.why === "no_source" && d.kind === "off" && d.why === "no_source"
    && is(e, "rain", false) && e.source === "condition"
    && f.kind === "off" && f.why === "no_source" && f.missing.includes("condition"), { a, b, c, d, e, f });
});
tryCase("no signal: garbage in never throws", () => {
  const bad = [null, undefined, {}, { [WEA]: null }, { [WEA]: { attributes: null } }, { [WEA]: S("rainy", { temperature: "cold" }) },
    { [WEA]: { state: 5 } }, { [ECW]: { state: "1", attributes: { alert_1: null, deep: { a: { b: { c: { d: "Rainfall warning" } } } } } }, ...wx("rainy") }];
  let ok = true;
  for (const st of bad) for (const ent of [null, undefined, {}, EC_ENT]) {
    try { WX.decideAtlasWeather(cfg({ atlas_weather_rain_entity: RAIN, atlas_weather_warning_entity: ECW }), st, ent); }
    catch (e) { ok = false; failures.push({ name: "garbage", detail: String(e) }); }
  }
  try { WX.decideAtlasWeather(null, null, null); WX.decideAtlasWeather(undefined, undefined); } catch (e) { ok = false; }
  check("no signal: garbage in never throws", ok);
});
tryCase("no signal: a vanished reading holds what was showing, for a while", () => {
  const rain = { kind: "rain", heavy: true, rim: false };
  const gone = { kind: "off", heavy: false, rim: false, why: "no_source" };
  const dry = { kind: "off", heavy: false, rim: false, why: "dry" };
  const a = WX.holdVisual(rain, 1000, gone, 1000 + 30000);
  const b = WX.holdVisual(rain, 1000, gone, 1000 + WX.HOLD_MS + 1);
  const c = WX.holdVisual(rain, 1000, dry, 1000 + 1);
  check("no signal: a vanished reading holds what was showing, for a while", a === rain && b.kind === "off" && c.kind === "off", { a, b, c });
});

// ── warnings: auto-detect by integration, text match ───────────────────────
tryCase("warnings: auto-detect across the listed integrations", () => {
  const H = (eid, st, platform, tk) => ({ st: { [eid]: st }, ent: { [eid]: { platform, translation_key: tk } } });
  const cases2 = {
    env_canada: H("sensor.x_warnings", S(1, { alert_1: "Rainfall Warning" }), "environment_canada", "warnings"),
    meteoalarm: H("binary_sensor.meteoalarm", S("on", { event: "Moderate rain warning", awareness_type: "10; Rain", senderName: "KNMI" }), "meteoalarm"),
    dwd_weather_warnings: H("sensor.koeln_current_warning_level", S(2, { warning_1_name: "DAUERREGEN", warning_1_headline: "Amtliche WARNUNG vor DAUERREGEN", region_name: "Stadt Köln" }), "dwd_weather_warnings", "current_warning_level"),
    nina: H("binary_sensor.warning_berlin_1", S("on", { headline: "Amtliche WARNUNG vor STARKREGEN", sender: "DWD" }), "nina"),
    meteo_france: H("sensor.75_weather_alert", S("Jaune", { "Vent violent": "Vert", "Pluie-inondation": "Jaune", "Orages": "Vert" }), "meteo_france"),
    weatheralerts: H("sensor.weatheralerts_1", S(1, { alerts: [{ event: "Flood Watch", headline: "Flood Watch", description: "Heavy rain expected tonight." }] }), "weatheralerts"),
    nws_alerts: H("sensor.nws_alerts", S(1, { Alerts: [{ Event: "Flood Advisory", Headline: "...", Description: "Rainfall rates of 1 inch per hour", AreasAffected: "Rains County" }] }), "nws_alerts"),
  };
  const got = {};
  for (const [p, c] of Object.entries(cases2)) {
    const d = decide({}, { ...wx("rainy"), ...c.st }, c.ent);
    got[p] = is(d, "rain", true) ? d.warning : JSON.stringify(d);
  }
  const want = Object.fromEntries(Object.keys(cases2).map(p => [p, `warning:${p}`]));
  check("warnings: auto-detect across the listed integrations", JSON.stringify(got) === JSON.stringify(want), got);
});
tryCase("warnings: detected by entity id when there is no registry", () => {
  const got = {};
  const ids = {
    meteoalarm: ["binary_sensor.meteoalarm", S("on", { event: "Yellow Snow-ice warning" })],
    dwd_weather_warnings: ["sensor.bonn_current_warning_level", S(1, { warning_1_name: "SCHNEEFALL" })],
    nina: ["binary_sensor.warning_hamburg_2", S("on", { headline: "Warnung vor Schneefall" })],
    meteo_france: ["sensor.38_weather_alert", S("Orange", { "Neige-verglas": "Orange", "Pluie-inondation": "Vert" })],
    weatheralerts: ["sensor.weatheralerts_1", S(2, { alerts: [{ event: "Winter Storm Warning", description: "Heavy snow, 8 to 14 inches." }] })],
    nws_alerts: ["sensor.nws_alerts", S(1, { Alerts: [{ Event: "Winter Storm Warning", Description: "Snowfall totals 10 inches" }] })],
    env_canada: ["sensor.calgary_warnings", S(1, { alert_1: "Snowfall warning", attribution: "Data provided by Environment Canada" })],
  };
  for (const [p, [eid, st]] of Object.entries(ids)) {
    const d = decide({}, { ...wx("rainy", 4), [eid]: st }, undefined);
    got[p] = is(d, "snow", true) && d.rim ? d.warning : JSON.stringify(d);
  }
  const want = Object.fromEntries(Object.keys(ids).map(p => [p, `warning:${p}`]));
  check("warnings: detected by entity id when there is no registry", JSON.stringify(got) === JSON.stringify(want), got);
});
tryCase("warnings: quiet sources and the wrong sensors are ignored", () => {
  const a = decide({}, { ...wx("rainy"), [ECW]: S(0, {}) }, EC_ENT);
  const b = decide({}, { ...wx("rainy"), "binary_sensor.meteoalarm": S("off", { event: "Moderate rain warning" }) }, { "binary_sensor.meteoalarm": { platform: "meteoalarm" } });
  const c = decide({}, { ...wx("rainy"), "sensor.75_weather_alert": S("Vert", { "Pluie-inondation": "Vert" }) }, { "sensor.75_weather_alert": { platform: "meteo_france" } });
  const d = decide({}, { ...wx("rainy"), "sensor.vancouver_watches": S(1, { alert_1: "Rainfall watch" }) }, EC_ENT);    // a watch is not a warning
  const e = decide({}, { ...wx("rainy"), "sensor.bonn_advance_warning_level": S(2, { warning_1_name: "DAUERREGEN" }) }, { "sensor.bonn_advance_warning_level": { platform: "dwd_weather_warnings", translation_key: "advance_warning_level" } });
  const f = decide({}, { ...wx("rainy"), "sensor.x_warnings": S(1, { alert_1: "Rainfall Warning" }) }, { "sensor.x_warnings": { platform: "some_other" } });
  const g = decide({}, { ...wx("rainy"), [ECW]: S("unavailable", { alert_1: "Rainfall Warning" }) }, EC_ENT);
  check("warnings: quiet sources and the wrong sensors are ignored",
    [a, b, c, d, e, f, g].every(x => is(x, "rain", false)), { a, b, c, d, e, f, g });
});
tryCase("warnings: a chosen warning entity is the only one read", () => {
  const st = { ...wx("rainy"), ...ecRain, "sensor.mine": S("on", { title: "Heavy Rainfall Statement" }) };
  const a = decide({ atlas_weather_warning_entity: "sensor.mine" }, st, EC_ENT);
  const b = decide({ atlas_weather_warning_entity: "sensor.mine" }, { ...wx("rainy"), ...ecRain }, EC_ENT);     // chosen one missing
  check("warnings: a chosen warning entity is the only one read", is(a, "rain", true) && a.warning === "warning:other"
    && is(b, "rain", false) && b.missing.includes("warning"), { a, b });
});
tryCase("warnings: the words, case-insensitive, and not the look-alikes", () => {
  const yes = ["RAINFALL WARNING", "rain", "Heavy Rain", "Freezing rain warning", "Snowfall warning", "SNOW SQUALL", "Snow-ice",
    "Amtliche WARNUNG vor STARKREGEN", "Dauerregen", "Pluie-inondation", "Neige-verglas", "Schneefall", "sneeuw", "lluvias", "nieve", "piogge", "neve"];
  const no = ["Terrain", "Mount Rainier", "Regensburg", "Brainstorm", "Snowdonia"];
  const bad = yes.filter(t => !(WX.textSaysRain(t) || WX.textSaysSnow(t))).concat(no.filter(t => WX.textSaysRain(t) || WX.textSaysSnow(t)).map(t => "matched " + t));
  const texts = WX.alertTexts({ region_name: "Kreis Regen", AreasAffected: "Rains County", friendly_name: "Rain Warnings", attribution: "rain", event: "Wind Warning" });
  check("warnings: the words, case-insensitive, and not the look-alikes", !bad.length && !texts.some(t => WX.textSaysRain(t)), { bad, texts });
});

// ── settings ────────────────────────────────────────────────────────────────
tryCase("settings: defaults and clamping", () => {
  const a = WX.weatherSettingsFrom({});
  const b = WX.weatherSettingsFrom({ atlas_weather_enabled: false, atlas_weather_strength: 9, atlas_weather_rain_entity: "  binary_sensor.r  " });
  const c = WX.weatherSettingsFrom({ atlas_weather_strength: "x" });
  const d = WX.weatherSettingsFrom({ atlas_weather_strength: 0.1, atlas_weather_rain_entity: 42 });
  check("settings: defaults and clamping", a.enabled === true && a.strength === 1 && a.rainEntity === "" && b.enabled === false
    && b.strength === 1.5 && b.rainEntity === "binary_sensor.r" && c.strength === 1 && d.strength === 0.5 && d.rainEntity === "", { a, b, c, d });
});

// ── mask: from a real drawing ───────────────────────────────────────────────
const MODEL = {
  floors: [{ id: "main", name: "Main", level: 0 }, { id: "up", name: "Upstairs", level: 1 }, { id: "garden", name: "Garden", level: 2 }],
  room_geometry_m: {
    Kitchen: { type: "poly", floor_id: "main", points_m: [[0, 0], [6, 0], [6, 4], [0, 4]] },
    Hall:    { type: "poly", floor_id: "main", points_m: [[6, 0], [10, 0], [10, 4], [6, 4]] },
    Loft:    { type: "poly", floor_id: "up",   points_m: [[0, 0], [5, 0], [5, 5], [0, 5]] },
    Shed:    { type: "poly", floor_id: "garden", points_m: [[12, 0], [15, 0], [15, 3], [12, 3]] },
    Drive:   { type: "poly", floor_id: "__outside__", points_m: [[20, 0], [25, 0], [25, 3], [20, 3]] },
  },
  light_positions_m: {},
};
const FLOORS = MODEL.floors;
let svgStr = "";
tryCase("mask: the plates the renderer drew", () => {
  svgStr = ISO.buildIsoSVG(MODEL, {}, new Set(), null, 150, 0, {}, false, FLOORS, {});
  const geo = WX.atlasPlatesFromSvg(svgStr);
  const vb = /viewBox="([^"]+)"/.exec(svgStr)[1].split(" ").map(Number);
  const zs = geo.plates.map(p => p.z).sort();
  // Every plate: two sides and a top, straight from its floorslab group.
  const groups = [...svgStr.matchAll(/<g data-role="floorslab" data-z="([^"]*)"[^>]*>([\s\S]*?)<\/g>/g)];
  const same = geo.plates.every(p => {
    const g = groups.find(m => Number(m[1]) === p.z);
    return g && p.polys.every(q => g[2].includes(q.map(xy => xy.join(",")).join(" ")));
  });
  check("mask: the plates the renderer drew", JSON.stringify(geo.viewBox) === JSON.stringify(vb) && JSON.stringify(zs) === "[0,1,2]"
    && geo.plates.every(p => p.polys.length === 3) && same, { viewBox: geo.viewBox, zs, n: geo.plates.map(p => p.polys.length) });
});
tryCase("mask: an ALPHA mask, transparent over every indoor plate", () => {
  const geo = WX.atlasPlatesFromSvg(svgStr);
  const frame = ISO.fabricFrame(MODEL, FLOORS, 150, 0);
  const outZ = WX.outdoorPlateLevels(frame, ISO.isOutdoorFloorId);
  const polys = geo.plates.filter(p => !outZ.has(p.z)).flatMap(p => p.polys);
  const m = WX.buildWeatherMaskSvg(geo.viewBox, polys, 2);
  const [x, y, w, h] = geo.viewBox;
  const box = `x="${x}" y="${y}" width="${w}" height="${h}"`;
  const inner = /<mask id="m" maskUnits="userSpaceOnUse" ([^>]*)><rect ([^>]*) fill="#fff"\/><g fill="#000" filter="url\(#f\)">([\s\S]*?)<\/g><\/mask>/.exec(m);
  const black = inner ? [...inner[3].matchAll(/<polygon points="([^"]+)"\/>/g)].map(q => q[1]) : [];
  const ok = m.startsWith(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${x} ${y} ${w} ${h}" preserveAspectRatio="none">`)
    && /<feMorphology operator="dilate" radius="2"\/><feGaussianBlur stdDeviation="2"\/>/.test(m)
    && inner && inner[1] === box && inner[2] === box
    && m.endsWith(`<rect ${box} fill="#fff" mask="url(#m)"/></svg>`)
    && black.length === 6                                   // Main + Upstairs, 3 each — never the Garden plate
    && JSON.stringify([...outZ]) === "[2]";
  check("mask: an ALPHA mask, transparent over every indoor plate", ok, { outZ: [...outZ], black: black.length, head: m.slice(0, 200) });
});
tryCase("mask: nothing to read, nothing built", () => {
  check("mask: nothing to read, nothing built", WX.atlasPlatesFromSvg("") === null && WX.atlasPlatesFromSvg("<svg viewBox=\"0 0 0 10\"></svg>") === null
    && WX.atlasPlatesFromSvg("<svg viewBox=\"0 0 10 10\"></svg>").plates.length === 0);
});
tryCase("tiles: made once per colour, the same every time", () => {
  const a = WX.weatherTiles("#fff"), b = WX.weatherTiles("#fff"), c = WX.weatherTiles("#dceeff");
  const ids = Object.keys(a).sort().join(",");
  const r1 = WX.rainTileSvg(WX.RAIN_LAYERS[0], "#fff", 7), r2 = WX.rainTileSvg(WX.RAIN_LAYERS[0], "#fff", 7);
  check("tiles: made once per colour, the same every time", a === b && a !== c && ids === "r0,r1,r2,r3,s0,s1,s2,s3" && r1 === r2
    && a.r0.startsWith('url("data:image/svg+xml,') && c.s0.includes(encodeURIComponent("#dceeff")), ids);
});
tryCase("colour: Classic white, Cinematic Glass blue-white", () => {
  const a = WX.weatherColourOf(ISO.SHOWCASE_THEMES.classic), b = WX.weatherColourOf(ISO.SHOWCASE_THEMES.cinematic_glass);
  check("colour: Classic white, Cinematic Glass blue-white", a === "#fff" && b === "#dceeff" && WX.weatherColourOf(null) === "#fff", { a, b });
});

// ── the card: byte-identical drawing, the overlay's life ────────────────────
const sent = [];
const telemetry = (n) => sent.push(n);
function el(tag, attrs = {}, children = []) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (k === "class") n.className = v;
    else if (k === "style") n.setAttribute("style", v);
    else if (k.startsWith("on") && typeof v === "function") n.addEventListener(k.slice(2), v);
    else if (v !== undefined && v !== null) n.setAttribute(k, String(v));
  }
  for (const c of (Array.isArray(children) ? children : [children])) {
    if (c === null || c === undefined) continue;
    n.appendChild(typeof c === "string" || typeof c === "number" ? document.createTextNode(String(c)) : c);
  }
  return n;
}
const view = { floorGap: 150, horizGap: 0, focusIdx: 0, zoom: 1 };
const RAINING = { ...wx("rainy") };
function card({ tier = "pro", weather, layoutV2 = false, showcase = false, theme = "classic", zoom = 1 } = {}) {
  view.zoom = zoom;
  const host = { el, view, floors: FLOORS, model: MODEL, byRoom: {}, hiddenEids: new Set(), lightsByEid: {}, lightsLoading: false,
    tier, layoutV2, displayMode: layoutV2, showcase, showcaseTheme: theme, saveView: async () => {}, onHexesBuilt() {}, weather };
  const c = LM.buildLightsMapCard(host);
  const stage = c._all().find(n => n.className === "lv-stage");
  return { c, stage, svg: stage && stage.innerHTML };
}
const W = (settings, states = RAINING, slot = "t") => ({ slot, settings: { atlas_weather_enabled: true, ...settings }, states, entities: {}, telemetry });
const overlayIn = (stage) => stage.children.find(n => n.classList && n.classList.contains("lv-wx")) || null;

tryCase("contract: the SVG is byte-identical with weather absent, off and raining", () => {
  const a = card({}).svg, b = card({ weather: W({ atlas_weather_enabled: false }) }).svg, c = card({ weather: W({}) }).svg;
  const d = card({ showcase: true, theme: "cinematic_glass" }).svg, e = card({ showcase: true, theme: "cinematic_glass", weather: W({}, { ...wx("snowy"), ...ecSnow }) }).svg;
  const direct = ISO.buildIsoSVG(MODEL, {}, new Set(), null, 150, 0, {}, false, FLOORS, {});
  check("contract: the SVG is byte-identical with weather absent, off and raining",
    a && a === b && a === c && d === e && !/lv-wx|weather/i.test(a) && direct.length > 1000, { a: a && a.length, b: b && b.length, c: c && c.length });
});
tryCase("overlay: mounted after the SVG, pointer-free, sized like it", () => {
  WX._resetWeatherSlotsForTests();
  const { stage } = card({ weather: W({}), layoutV2: true });
  const o = overlayIn(stage);
  const geo = WX.atlasPlatesFromSvg(stage.innerHTML);
  const a = (geo.viewBox[3] / geo.viewBox[2]).toFixed(6);
  check("overlay: mounted after the SVG, pointer-free, sized like it", o && stage.children[stage.children.length - 1] === o
    && o.getAttribute("aria-hidden") === "true" && o.style["--wxz"] === "100%" && o.style["--wxa"] === a
    && o.style.marginLeft === "auto" && o.style.marginRight === "auto" && String(o.style["mask-image"]).startsWith('url("data:image/svg+xml,')
    && String(o.style["-webkit-mask-image"]) === String(o.style["mask-image"]) && !o.classList.contains("still"),
    o && { z: o.style["--wxz"], a: o.style["--wxa"], want: a, ml: o.style.marginLeft });
});
tryCase("overlay: follows the zoom, classic layout left-aligned", () => {
  WX._resetWeatherSlotsForTests();
  const { stage } = card({ weather: W({}), zoom: 1.6 });
  const o = overlayIn(stage);
  check("overlay: follows the zoom, classic layout left-aligned", o && o.style["--wxz"] === "160%" && o.style.marginLeft === "0", o && o.style["--wxz"]);
});
tryCase("overlay: one element, moved into every new stage", () => {
  WX._resetWeatherSlotsForTests();
  const one = card({ weather: W({}) });
  const o1 = overlayIn(one.stage);
  const two = card({ weather: W({}) });
  const o2 = overlayIn(two.stage);
  const three = card({ weather: W({}, RAINING, "other-slot") });
  check("overlay: one element, moved into every new stage", o1 && o1 === o2 && !overlayIn(one.stage) && overlayIn(three.stage) !== o2, null);
});
tryCase("overlay: the animation phase is anchored to the clock", () => {
  WX._resetWeatherSlotsForTests();
  const slot = WX.atlasWeatherSlot("clock");
  const stage = document.createElement("div");
  const p = (nowMs, states = RAINING) => ({ settings: cfg({}), states, svg: svgStr, animate: true, colour: "#fff", zoom: 1, nowMs, telemetry });
  const T0 = 1_700_000_000_000;
  slot.attach(stage, p(T0));
  const layer = () => slot.element._all().find(n => n.className === "lv-wx-layer" && n.style.display === "block");
  const a1 = layer().style.animation;
  slot.attach(stage, p(T0 + 500));
  const a2 = layer().style.animation;
  slot.attach(stage, p(T0 + 5000));
  const a3 = layer().style.animation;
  const delay = (s) => Number(/lv-wx-fall [\d.]+s linear (-?[\d.]+)s/.exec(s)[1]);
  const dur = WX.RAIN_LAYERS[0].dur;
  const step = ((delay(a1) - delay(a2)) % dur + dur) % dur;
  check("overlay: the animation phase is anchored to the clock", Math.abs(step - 0.5) < 0.002
    && /lv-wx-in 3s ease -?0\.00s both/.test(a1) && /lv-wx-in 3s ease -0\.50s both/.test(a2) && !/lv-wx-in/.test(a3), { a1, a2, a3, step });
});
tryCase("overlay: heavier = more layers fading in, off = a fade then nothing", () => {
  WX._resetWeatherSlotsForTests();
  const slot = WX.atlasWeatherSlot("fade");
  const stage = document.createElement("div");
  const T0 = 1_700_000_000_000;
  const p = (nowMs, states) => ({ settings: cfg({}), states, svg: svgStr, animate: true, colour: "#fff", zoom: 1, nowMs, telemetry });
  const shownLayers = () => slot.element._all().filter(n => n.className === "lv-wx-layer" && n.style.display === "block").length;
  slot.attach(stage, p(T0, wx("rainy")));
  const light = shownLayers();
  slot.attach(stage, p(T0 + 10000, wx("pouring")));
  const heavy = shownLayers();
  const fadingIn = slot.element._all().filter(n => n.className === "lv-wx-layer" && /lv-wx-in/.test(n.style.animation)).length;
  const tilt = slot.element._all().find(n => n.className === "lv-wx-tilt");
  const wind = tilt.style.animation, windTo = tilt.style["--a1"], windFrom = tilt.style["--a0"];
  slot.attach(stage, p(T0 + 20000, wx("sunny")));
  const fadingOut = slot.element._all().filter(n => n.className === "lv-wx-layer" && /lv-wx-out/.test(n.style.animation)).length;
  const stillThere = overlayIn(stage) === slot.element;
  slot.attach(stage, p(T0 + 26000, wx("sunny")));
  const gone = overlayIn(stage) === null;
  check("overlay: heavier = more layers fading in, off = a fade then nothing", light === 1 && heavy === 4 && fadingIn === 3
    && /lv-wx-wind 6s/.test(wind) && windFrom === "3deg" && windTo === "17deg" && fadingOut === 4 && stillThere && gone,
    { light, heavy, fadingIn, wind, windFrom, windTo, fadingOut, stillThere, gone });
});
tryCase("overlay: snow has its rim only on a snowfall warning", () => {
  WX._resetWeatherSlotsForTests();
  const slot = WX.atlasWeatherSlot("rim");
  const stage = document.createElement("div");
  const p = (states) => ({ settings: cfg({}), states, entities: EC_ENT, svg: svgStr, animate: true, colour: "#fff", zoom: 1, nowMs: 5e12, telemetry });
  slot.attach(stage, p(wx("snowy")));
  const rim = () => slot.element._all().find(n => n.className === "lv-wx-rim");
  const light = rim().style.display;
  const sway = slot.element._all().filter(n => n.className === "lv-wx-sway" && n.style.display === "block").length;
  slot.attach(stage, p({ ...wx("snowy"), ...ecSnow }));
  const heavy = rim().style.display, rimSvg = rim().innerHTML;
  const sway2 = slot.element._all().filter(n => n.className === "lv-wx-sway" && n.style.display === "block").length;
  const ripples = slot.element._all().find(n => n.className === "lv-wx-ripples").style.display;
  check("overlay: snow has its rim only on a snowfall warning", light === "none" && heavy === "block" && sway === 2 && sway2 === 4
    && /<polygon points=/.test(rimSvg) && /lv-wx-rimin|lv-wx-in 8s/.test(rim().style.animation) && ripples === "none",
    { light, heavy, sway, sway2, anim: rim().style.animation, ripples });
});
tryCase("overlay: free is still, paid animates", () => {
  WX._resetWeatherSlotsForTests();
  const free = overlayIn(card({ tier: "free", weather: W({}) }).stage);
  const stillFree = free && free.classList.contains("still");
  WX._resetWeatherSlotsForTests();
  const bright = overlayIn(card({ tier: "bright", weather: W({}) }).stage);
  const pro = overlayIn(card({ tier: "pro", weather: W({}) }).stage);
  check("overlay: free is still, paid animates", stillFree && bright && !bright.classList.contains("still") && pro && !pro.classList.contains("still"), null);
});
tryCase("overlay: reduced motion is still too", () => {
  WX._resetWeatherSlotsForTests();
  const real = globalThis.matchMedia;
  globalThis.matchMedia = (q) => ({ matches: /reduce/.test(q), addEventListener() {}, removeEventListener() {} });
  try {
    const o = overlayIn(card({ weather: W({}) }).stage);
    check("overlay: reduced motion is still too", o && o.classList.contains("still"));
  } finally { globalThis.matchMedia = real; }
});
tryCase("overlay: off and disabled mean no element at all", () => {
  WX._resetWeatherSlotsForTests();
  const a = card({ weather: W({ atlas_weather_enabled: false }) }).stage;
  const b = card({ weather: W({}, wx("sunny")) }).stage;
  const c = card({ weather: null }).stage;
  const d = card({ weather: W({}, {}) }).stage;
  check("overlay: off and disabled mean no element at all", !overlayIn(a) && !overlayIn(b) && !overlayIn(c) && !overlayIn(d)
    && a.children.length === 0 && b.children.length === 0, null);
});

tryCase("overlay: the tilted field covers any shape of drawing at 20 degrees", () => {
  // Corners of a drawing w=1, h=a must sit inside the field rotated 20°.
  const covered = (a, lr, tb) => {
    const W = 1 + 2 * lr, H = a * (1 + 2 * tb), t = 20 * Math.PI / 180;
    return [[-0.5, -a / 2], [0.5, -a / 2], [0.5, a / 2], [-0.5, a / 2]].every(([x, y]) =>
      Math.abs(x * Math.cos(t) + y * Math.sin(t)) <= W / 2 && Math.abs(-x * Math.sin(t) + y * Math.cos(t)) <= H / 2);
  };
  const got = {};
  for (const [w, h] of [[800, 250], [800, 800], [760, 2400], [760, 4200]]) {
    WX._resetWeatherSlotsForTests();
    const slot = WX.atlasWeatherSlot("tilt");
    slot.attach(document.createElement("div"), { settings: cfg({}), states: RAINING, svg: `<svg viewBox="0 0 ${w} ${h}"></svg>`,
      animate: true, colour: "#fff", zoom: 1, telemetry });
    const o = slot.element;
    const lr = parseFloat(o.style["--wxlr"]) / 100, tb = parseFloat(o.style["--wxtb"]) / 100;
    got[`${w}x${h}`] = covered(h / w, lr, tb) ? "ok" : `uncovered lr=${lr} tb=${tb}`;
  }
  check("overlay: the tilted field covers any shape of drawing at 20 degrees", Object.values(got).every(v => v === "ok"), got);
});
tryCase("overlay: a finished fade-out leaves the compositor, and the page when it stopped", () => {
  WX._resetWeatherSlotsForTests();
  const slot = WX.atlasWeatherSlot("end");
  const stage = document.createElement("div");
  const T0 = 1_700_000_000_000;
  const p = (nowMs, states) => ({ settings: cfg({}), states, svg: svgStr, animate: true, colour: "#fff", zoom: 1, nowMs, telemetry });
  slot.attach(stage, p(T0, wx("pouring")));
  slot.attach(stage, p(T0 + 10000, wx("rainy")));             // heavy -> light: three layers fade out
  const out = slot.element._all().filter(n => n.className === "lv-wx-layer" && /lv-wx-out/.test(n.style.animation));
  out.forEach(t => slot.element.dispatchEvent({ type: "animationend", animationName: "lv-wx-out", target: t }));
  const hidden = out.every(t => t.style.display === "none");
  const base = slot.element._all().find(n => n.className === "lv-wx-layer" && n.style.display === "block");
  slot.element.dispatchEvent({ type: "animationend", animationName: "lv-wx-in", target: base });   // not a fade-out: nothing
  const kept = base && base.style.display === "block";
  slot.attach(stage, p(T0 + 20000, wx("sunny")));             // stopped: everything fades out
  const was = overlayIn(stage) === slot.element;
  const last = slot.element._all().find(n => n.className === "lv-wx-layer" && /lv-wx-out/.test(n.style.animation));
  slot.element.dispatchEvent({ type: "animationend", animationName: "lv-wx-out", target: last });
  check("overlay: a finished fade-out leaves the compositor, and the page when it stopped",
    out.length === 3 && hidden && kept && was && overlayIn(stage) === null, { n: out.length, hidden, kept, was });
});

// ── failures are counted, and never reach the Atlas ─────────────────────────
tryCase("errors: each failure drew no weather and was counted once", () => {
  WX._resetWeatherSlotsForTests(); WX._resetWeatherCountsForTests(); sent.length = 0;
  const slot = WX.atlasWeatherSlot("err");
  const stage = document.createElement("div");
  const base = { settings: cfg({}), states: RAINING, svg: svgStr, animate: true, colour: "#fff", zoom: 1, telemetry };
  const out = {};
  // A browser without mask support: an unmasked overlay would rain on rooms.
  globalThis.CSS = { supports: () => false };
  out.unsupported = slot.attach(stage, base) === false && !overlayIn(stage);
  slot.attach(stage, base);
  delete globalThis.CSS;
  // A drawing with no frame to mask against.
  out.maskBuild = slot.attach(stage, { ...base, svg: "<div>not a drawing</div>" }) === false && !overlayIn(stage);
  // The decision itself throwing (a hostile states object).
  const hostile = new Proxy({}, { ownKeys() { throw new Error("boom"); }, get() { throw new Error("boom"); } });
  out.decision = slot.attach(stage, { ...base, states: hostile }) === false;
  // Mounting into nothing.
  out.mount = slot.attach(null, base) === false;
  // A chosen entity that is not there.
  slot.attach(stage, { ...base, settings: cfg({ atlas_weather_rain_entity: "binary_sensor.gone" }) });
  slot.attach(stage, { ...base, settings: cfg({ atlas_weather_rain_entity: "binary_sensor.gone" }) });
  const errs = sent.filter(n => n.startsWith("weather_error:")).sort();
  check("errors: each failure drew no weather and was counted once", Object.values(out).every(Boolean)
    && JSON.stringify(errs) === JSON.stringify(["weather_error:decision", "weather_error:mask_build", "weather_error:mask_unsupported", "weather_error:mount", "weather_error:source"]),
    { out, errs });
});
tryCase("errors: the card still draws when weather cannot", () => {
  WX._resetWeatherSlotsForTests();
  const hostile = new Proxy({}, { ownKeys() { throw new Error("boom"); }, get() { throw new Error("boom"); } });
  const { stage, svg } = card({ weather: { slot: "x", settings: { atlas_weather_enabled: true }, states: hostile, telemetry } });
  check("errors: the card still draws when weather cannot", stage && /<svg/.test(svg) && !overlayIn(stage), null);
});

// ── telemetry ───────────────────────────────────────────────────────────────
tryCase("telemetry: closed words, once per page load, never an id or text", () => {
  WX._resetWeatherSlotsForTests(); WX._resetWeatherCountsForTests(); sent.length = 0;
  const slot = WX.atlasWeatherSlot("tele");
  const stage = document.createElement("div");
  const run = (states, entities, settings = {}, animate = true) =>
    slot.attach(stage, { settings: cfg(settings), states, entities, svg: svgStr, animate, colour: "#fff", zoom: 1, telemetry });
  for (let i = 0; i < 3; i++) run(wx("rainy"));
  run({ ...wx("rainy"), ...ecRain }, EC_ENT);
  run({ ...wx("snowy"), "binary_sensor.warning_köln_1": S("on", { headline: "Warnung vor SCHNEEFALL in Köln" }) }, { "binary_sensor.warning_köln_1": { platform: "nina" } });
  run(wx("snowy"), {}, {}, false);
  run({ [RAIN]: S("on"), ...wx("cloudy") }, {}, { atlas_weather_rain_entity: RAIN });
  run({ "sensor.x": S(1) });
  run({ ...wx("rainy"), "sensor.custom_alert": S("on", { title: "Rainfall warning for Nicole's street" }) }, {}, { atlas_weather_warning_entity: "sensor.custom_alert" });
  const rejected = ["weather_error:Nicole", "weather_source:warning:binary_sensor.x", "weather_shown:drizzle", "tab:overview"]
    .map(n => WX.countWeatherOnce(n, telemetry));
  const dup = new Set(sent).size === sent.length;
  const leak = sent.filter(n => /\.|Nicole|köln|SCHNEE|Rainfall|street/i.test(n) || !WX.WEATHER_EVENTS.includes(n));
  const want = ["weather_shown:heavy_rain", "weather_shown:heavy_snow", "weather_shown:light_rain", "weather_shown:light_snow", "weather_shown:still",
    "weather_source:condition", "weather_source:none", "weather_source:rain_sensor", "weather_source:warning:env_canada",
    "weather_source:warning:nina", "weather_source:warning:other"];
  check("telemetry: closed words, once per page load, never an id or text", dup && !leak.length && rejected.every(r => r === false)
    && JSON.stringify([...sent].sort()) === JSON.stringify(want), { sent: [...sent].sort(), leak });
});

console.log(JSON.stringify({
  cases, failures,
  lists: { errors: WX.WEATHER_ERROR_KINDS, shown: WX.WEATHER_SHOWN_STATES, sources: WX.WEATHER_SOURCES,
           platforms: WX.WARNING_PLATFORMS, events: WX.WEATHER_EVENTS },
}));
process.exit(failures.length ? 1 : 0);
