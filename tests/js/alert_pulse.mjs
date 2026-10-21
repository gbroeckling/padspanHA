// Alert pulse (Settings → UI Structure → Atlas, off by default), run for real:
//   alerts    lights_map.js safetyAlerts — worst first (smoke/gas/CO, leak,
//             open in the rain, left open), its words and where
//   rings     iso_lights.js: a flagged opening rings its room in amber, the
//             leak ring's own drawing; nothing asked, not one byte changes
//   card      buildLightsMapCard: off, the card is byte-identical; on, the
//             openings ring; on a wall, the banner names the worst alert
//
// usage: alert_pulse.mjs <www/padspan-ha dir>
// prints one JSON line: { cases: {name: result}, failures: [...] }

import { pathToFileURL } from "node:url";
import { join } from "node:path";
import { install } from "./dom_shim.mjs";

const WWW = process.argv[2];
if (!WWW) { console.error("usage: alert_pulse.mjs <www/padspan-ha dir>"); process.exit(2); }
install(globalThis);

const ISO = await import(pathToFileURL(join(WWW, "views", "iso_lights.js")).href);
const LM = await import(pathToFileURL(join(WWW, "views", "lights_map.js")).href);

const failures = [];
const cases = {};
const check = (name, ok, detail) => { cases[name] = !!ok; if (!ok) failures.push({ name, detail: detail === undefined ? null : detail }); };
const tryCase = (name, fn) => { try { fn(); } catch (e) { failures.push({ name, detail: String(e && e.stack || e).slice(0, 900) }); cases[name] = false; } };

const NOW = Date.now();
const ago = (h) => new Date(NOW - h * 3600000).toISOString();
const S = (state, attributes, hoursAgo = 0.1) => ({ state, attributes, last_changed: ago(hoursAgo), last_updated: ago(hoursAgo) });
const STATES = {
  "binary_sensor.hall_door":      S("on", { device_class: "door", friendly_name: "Hall door" }, 10),
  "binary_sensor.kitchen_window": S("on", { device_class: "window", friendly_name: "Kitchen window" }),
  "cover.hall_blind":             S("open", { device_class: "blind", friendly_name: "Hall blind", current_position: 40 }),
  "binary_sensor.laundry_leak":   S("on", { device_class: "moisture", friendly_name: "Laundry leak" }),
  "binary_sensor.hall_smoke":     S("on", { device_class: "smoke", friendly_name: "Hall smoke" }),
};
const AREAS = { "binary_sensor.hall_door": "Hall", "binary_sensor.kitchen_window": "Kitchen", "cover.hall_blind": "Hall",
                "binary_sensor.laundry_leak": "Laundry", "binary_sensor.hall_smoke": "Hall" };
const RAIN = { "weather.home": { state: "rainy", attributes: { temperature: 12, temperature_unit: "°C" } } };
// The covers here are linked to walls (a cover is on the Atlas only once it is).
const gather = (states) => Object.fromEntries(LM.gatherLights(states, AREAS, undefined, undefined, undefined, undefined, undefined, undefined, undefined, false, null,
  new Set(Object.keys(states).filter(e => e.startsWith("cover.")))).map(l => [l.entity_id, l]));
const LIGHTS = gather(STATES);

const MODEL = {
  floors: [{ id: "main", name: "Main", level: 0 }],
  room_geometry_m: {
    Kitchen: { type: "poly", floor_id: "main", points_m: [[0, 0], [6, 0], [6, 4], [0, 4]] },
    Hall:    { type: "poly", floor_id: "main", points_m: [[6, 0], [10, 0], [10, 4], [6, 4]] },
  },
  rf_barriers_m: [
    // Between the Kitchen and the Hall: the door's own area (Hall) wins.
    { id: "b_door", name: "Hall door", floor_id: "main", points_m: [[6, 1], [6, 2]], linked_entity_id: "binary_sensor.hall_door" },
    // An outside wall: only the Kitchen is beside it.
    { id: "b_win", name: "Kitchen window", material: "glass", floor_id: "main", points_m: [[0, 1], [0, 2]], linked_entity_id: "binary_sensor.kitchen_window" },
  ],
  light_positions_m: { "binary_sensor.laundry_leak": { x_m: 2, y_m: 2, floor_id: "main" } },
};
const FLOORS = MODEL.floors;

// ── alerts ───────────────────────────────────────────────────────────────────
tryCase("alerts: worst first, in words, with where", () => {
  const a = LM.safetyAlerts(Object.values(LIGHTS), { wet: "rain", nowMs: NOW });
  const got = a.map(x => `${x.kind}|${x.what}|${x.where}`);
  check("alerts: worst first, in words, with where", JSON.stringify(got) === JSON.stringify([
    "smoke|Smoke|Hall", "water|Leak|Laundry", "rain_open|Blind open in the rain|Hall",
    "rain_open|Window open in the rain|Kitchen", "left_open|Door left open|Hall"]), got);
  check("alerts: the banner's line", LM.alertBannerText(a) === "Smoke · Hall (and 4 more)" && LM.alertBannerText([]) === ""
    && LM.alertBannerText([a[1]]) === "Leak · Laundry", LM.alertBannerText(a));
});
tryCase("alerts: dry, a window just opened is nothing; snow says so", () => {
  const dry = LM.safetyAlerts(Object.values(LIGHTS), { wet: null, nowMs: NOW }).map(x => x.eid);
  const snow = LM.safetyAlerts([LIGHTS["binary_sensor.kitchen_window"]], { wet: "snow", nowMs: NOW }).map(x => x.what);
  check("alerts: dry, a window just opened is nothing; snow says so",
    JSON.stringify(dry) === JSON.stringify(["binary_sensor.hall_smoke", "binary_sensor.laundry_leak", "binary_sensor.hall_door"])
    && snow[0] === "Window open in the snow", { dry, snow });
});
tryCase("alerts: latched leak, inverted door, no reading", () => {
  const L = gather({
    "binary_sensor.laundry_leak": S("off", { device_class: "moisture" }),
    "binary_sensor.hall_door": S("off", { device_class: "door" }, 10),
    "binary_sensor.kitchen_window": S("unavailable", { device_class: "window" }, 10),
  });
  const latch = { "binary_sensor.laundry_leak": { triggered_at: NOW / 1000 - 600 } };
  const a = LM.safetyAlerts(Object.values(L), { wet: "rain", floodLatches: latch, nowMs: NOW,
    doorInvert: { "binary_sensor.hall_door": true, "binary_sensor.kitchen_window": true } });
  const quiet = LM.safetyAlerts(Object.values(L), { wet: "rain", nowMs: NOW });
  check("alerts: latched leak, inverted door, no reading",
    a.map(x => x.what).join("/") === "Leak earlier/Door left open" && quiet.length === 0, { a, quiet });
});

// ── rings ────────────────────────────────────────────────────────────────────
const draw = (opts) => ISO.buildIsoSVG(MODEL, {}, new Set(), null, 150, 0, LIGHTS, false, FLOORS, opts);
tryCase("rings: nothing asked, not one byte changes", () => {
  const a = draw({}), b = draw({ alertOpenings: null }), c = draw({ alertOpenings: {} });
  check("rings: nothing asked, not one byte changes", a === b && a === c && !a.includes("lalert") && a.length > 1000, { a: a.length, b: b.length });
});
tryCase("rings: amber, in the opening's room, the leak ring untouched", () => {
  const off = draw({});
  const on = draw({ alertOpenings: { "binary_sensor.hall_door": "left_open", "binary_sensor.kitchen_window": "rain_open" } });
  const rings = [...on.matchAll(/<g class="lalert" data-eid="([^"]+)" data-class="door" data-alert="([^"]+)" clip-path="url\(#(psclip_\d)\)"/g)]
    .map(m => `${m[1]}|${m[2]}|${m[3]}`);
  // psclip_0 Kitchen, psclip_1 Hall (room_geometry_m order).
  const want = ["binary_sensor.hall_door|left_open|psclip_1", "binary_sensor.kitchen_window|rain_open|psclip_0"];
  const flood = (s) => (s.match(/<g class="lflood"[\s\S]*?<\/g><\/g>/g) || []).join("");
  check("rings: amber, in the opening's room, the leak ring untouched",
    JSON.stringify(rings.sort()) === JSON.stringify(want) && on.includes('stroke="#f59e0b"')
    && flood(off).length > 0 && flood(off) === flood(on), { rings, floodOff: flood(off).length, floodOn: flood(on).length });
  const chip = draw({ classFilter: "flood", alertOpenings: { "binary_sensor.hall_door": "left_open" } });
  check("rings: the Doors/Windows class, not shown under another class chip", !chip.includes("lalert"));
});

// ── the card ─────────────────────────────────────────────────────────────────
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
function card(extra = {}) {
  const host = { el, view, floors: FLOORS, model: MODEL, byRoom: {}, hiddenEids: new Set(), lightsByEid: LIGHTS, lightsLoading: false,
    tier: "pro", layoutV2: true, displayMode: true, wall: true, saveView: async () => {}, onHexesBuilt() {},
    weather: { slot: "ap", settings: { atlas_weather_enabled: true }, states: { ...STATES, ...RAIN }, entities: {}, telemetry() {} },
    ...extra };
  const c = LM.buildLightsMapCard(host);
  const stage = c._all().find(n => n.className === "lv-stage");
  const bar = c._all().find(n => String(n.className || "").startsWith("lv-alertbar"));
  const shape = c._all().map(n => `${n.tagName || "#text"}.${n.className || ""}`).join(",");
  return { svg: stage && stage.innerHTML, bar, shape };
}
tryCase("card: off, byte-identical to before", () => {
  const a = card(), b = card({ alertPulse: false });
  check("card: off, byte-identical to before", a.svg && a.svg === b.svg && a.shape === b.shape && !a.bar && !b.bar
    && !a.svg.includes("lalert"), { a: a.svg && a.svg.length, b: b.svg && b.svg.length });
});
tryCase("card: on, the rings and the wall's banner", () => {
  const on = card({ alertPulse: true });
  const desk = card({ alertPulse: true, wall: false });
  check("card: on, the rings and the wall's banner",
    on.svg.includes('data-alert="left_open"') && on.svg.includes('data-alert="rain_open"')
    && on.bar && on.bar.textContent === "Smoke · Hall (and 4 more)" && on.bar.getAttribute("data-alert") === "smoke"
    && on.bar.getAttribute("role") === "alert" && !String(on.bar.className).includes("lv-alertbar-open")
    && desk.svg.includes("lalert") && !desk.bar, { bar: on.bar && on.bar.textContent, desk: !!desk.bar });
  const doorOnly = card({ alertPulse: true, lightsByEid: { "binary_sensor.hall_door": LIGHTS["binary_sensor.hall_door"] } });
  check("card: an opening alone, the amber banner", doorOnly.bar && doorOnly.bar.textContent === "Door left open · Hall"
    && String(doorOnly.bar.className) === "lv-alertbar lv-alertbar-open", doorOnly.bar && doorOnly.bar.textContent);
});

console.log(JSON.stringify({ cases, failures }));
