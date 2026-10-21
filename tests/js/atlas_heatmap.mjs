// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
//
// The Atlas heatmap (views/atlas_heatmap.js), run for real.
//
//   contract  buildIsoSVG is byte-identical with the heatmap absent, null,
//             false or an unknown kind, and the card's drawing with no chip
//             handler equals the one with the chip off
//   readings  the class each kind reads, the one-hour freshness rule, °F
//   colours   the comfort bands and the CO2 scale's ends
//   sources   placed sensors where placed, a room's own at its centre where not
//   drawing   clipped per room, a handful of paths, the legend, cheap
//   chip      offered for the kinds present, cycles, absent without a handler
//
// usage: atlas_heatmap.mjs <www/padspan-ha dir>
// prints one JSON line: { cases: {name: result}, failures: [...] }

import { pathToFileURL } from "node:url";
import { join } from "node:path";
import { install } from "./dom_shim.mjs";

const WWW = process.argv[2];
if (!WWW) { console.error("usage: atlas_heatmap.mjs <www/padspan-ha dir>"); process.exit(2); }
install(globalThis);

const HM = await import(pathToFileURL(join(WWW, "views", "atlas_heatmap.js")).href);
const ISO = await import(pathToFileURL(join(WWW, "views", "iso_lights.js")).href);
const LM = await import(pathToFileURL(join(WWW, "views", "lights_map.js")).href);

const failures = [];
const cases = {};
const check = (name, ok, detail) => { cases[name] = !!ok; if (!ok) failures.push({ name, detail: detail === undefined ? null : detail }); };
const tryCase = (name, fn) => { try { fn(); } catch (e) { failures.push({ name, detail: String(e && e.stack || e).slice(0, 900) }); cases[name] = false; } };

const NOW = Date.parse("2026-10-21T12:00:00Z");
const fresh = new Date(NOW - 5 * 60 * 1000).toISOString();
const stale = new Date(NOW - 2 * 60 * 60 * 1000).toISOString();
const temp = (eid, t, extra = {}) => ({ entity_id: eid, state: String(t), isTemp: true, temperature: t, last_changed: fresh, air_unit: "°C", ...extra });
const hum = (eid, h) => ({ entity_id: eid, state: String(h), isHumidity: true, humidity: h, last_changed: fresh, air_unit: "%" });
const co2 = (eid, v) => ({ entity_id: eid, state: String(v), isAir: true, device_class: "carbon_dioxide", air_value: v, last_changed: fresh, air_unit: "ppm" });

const MODEL = {
  floors: [{ id: "main", name: "Main", level: 0 }],
  room_geometry_m: {
    Kitchen: { type: "poly", floor_id: "main", points_m: [[0, 0], [6, 0], [6, 4], [0, 4]] },
    Hall:    { type: "poly", floor_id: "main", points_m: [[6, 0], [10, 0], [10, 4], [6, 4]] },
  },
  light_positions_m: {
    "sensor.kitchen_temp": { x_m: 1, y_m: 1, floor_id: "main" },
    "sensor.kitchen_temp2": { x_m: 5, y_m: 3, floor_id: "main" },
  },
};
const FLOORS = MODEL.floors;
const BY_EID = {
  "sensor.kitchen_temp": temp("sensor.kitchen_temp", 18),
  "sensor.kitchen_temp2": temp("sensor.kitchen_temp2", 26),
  "sensor.hall_temp": temp("sensor.hall_temp", 21),
  "sensor.hall_humidity": hum("sensor.hall_humidity", 55),
};
const BY_ROOM = { Hall: [BY_EID["sensor.hall_temp"], BY_EID["sensor.hall_humidity"]] };
const draw = (opts, byEid = BY_EID, byRoom = BY_ROOM, hidden = new Set()) =>
  ISO.buildIsoSVG(MODEL, byRoom, hidden, null, 150, 0, byEid, false, FLOORS, { nowMs: NOW, ...opts });

// ── contract ────────────────────────────────────────────────────────────────
tryCase("contract: byte-identical with the heatmap absent, null, false or unknown", () => {
  const a = draw({}), b = draw({ heatmap: null }), c = draw({ heatmap: false }), d = draw({ heatmap: "pressure" });
  const e = draw({ showcase: true }), f = draw({ showcase: true, heatmap: null });
  check("contract: byte-identical with the heatmap absent, null, false or unknown",
    a.length > 1000 && a === b && a === c && a === d && e === f && !/lheat|Temperature/.test(a), { a: a.length, b: b.length, d: d.length });
});

// ── readings ────────────────────────────────────────────────────────────────
tryCase("readings: each kind reads its own class, fresh only, °F to °C", () => {
  const r = (li, k) => HM.heatReadingOf(li, k, NOW);
  const f = r(temp("sensor.f", 72, { air_unit: "°F" }), "temp");
  check("readings: each kind reads its own class, fresh only, °F to °C",
    r(BY_EID["sensor.hall_temp"], "temp") === 21 && Number.isNaN(r(BY_EID["sensor.hall_temp"], "humidity"))
    && r(BY_EID["sensor.hall_humidity"], "humidity") === 55 && r(co2("sensor.c", 900), "co2") === 900
    && Number.isNaN(r({ ...co2("sensor.pm", 30), device_class: "pm25" }, "co2"))
    && Number.isNaN(r({ ...BY_EID["sensor.hall_temp"], last_changed: stale }, "temp"))
    && Number.isNaN(r({ ...BY_EID["sensor.hall_temp"], last_changed: null }, "temp"))
    && Number.isNaN(r(null, "temp")) && Math.abs(f - 22.22) < 0.01, { f });
});

// ── colours ─────────────────────────────────────────────────────────────────
tryCase("colours: comfort is green, cold blue, hot red; CO2 400 good, 1500+ bad", () => {
  const c = HM.heatColourOf;
  check("colours: comfort is green, cold blue, hot red; CO2 400 good, 1500+ bad",
    c("temp", 22) === "#34d399" && c("temp", 10) === "#3b82f6" && c("temp", 35) === "#ef4444"
    && c("humidity", 50) === "#34d399" && c("humidity", 10) === "#f97316" && c("humidity", 95) === "#6366f1"
    && c("co2", 400) === "#34d399" && c("co2", 300) === "#34d399" && c("co2", 1500) === "#ef4444" && c("co2", 4000) === "#ef4444"
    && c("co2", 1000) !== c("co2", 400) && c("co2", 1000) !== c("co2", 1500), { t22: c("temp", 22), co1000: c("co2", 1000) });
});

// ── sources ─────────────────────────────────────────────────────────────────
tryCase("sources: placed where placed, a room's own at its centre where not", () => {
  const rooms = [{ room: "Kitchen", pts: [[0, 0], [6, 0], [6, 4], [0, 4]] }, { room: "Hall", pts: [[6, 0], [10, 0], [10, 4], [6, 4]] }];
  const placedHere = [{ eid: "sensor.kitchen_temp", x: 1, y: 1 }, { eid: "sensor.kitchen_temp2", x: 5, y: 3 }];
  const placed = { "sensor.kitchen_temp": true, "sensor.kitchen_temp2": true };
  const centre = (n) => n === "Hall" ? [8, 2] : [3, 2];
  const byRoom = { ...BY_ROOM, Kitchen: [temp("sensor.kitchen_extra", 30)], Hall: [...BY_ROOM.Hall, temp("sensor.hall_temp2", 23)] };
  const s = HM.heatSources("temp", placedHere, rooms, byRoom, BY_EID, new Set(), placed, centre, NOW, ISO.pointInPolygon);
  const hid = HM.heatSources("temp", placedHere, rooms, BY_ROOM, BY_EID, new Set(["sensor.kitchen_temp", "sensor.kitchen_temp2"]), placed, centre, NOW, ISO.pointInPolygon);
  check("sources: placed where placed, a room's own at its centre where not",
    s.length === 3 && s[2].x === 8 && s[2].y === 2 && s[2].v === 22 && !s.some(p => p.v === 30)
    && hid.length === 1 && hid[0].v === 21, { s, hid });
});

// ── drawing ─────────────────────────────────────────────────────────────────
tryCase("drawing: clipped to each room, a handful of paths, its legend", () => {
  const svg = draw({ heatmap: "temp" });
  const layer = (svg.match(/<g class="lheat"[\s\S]*?<\/g><\/g>/) || [""])[0];
  const clips = [...layer.matchAll(/clip-path="url\(#(psclip_\d+)\)"/g)].map(m => m[1]);
  const paths = (layer.match(/<path /g) || []).length;
  const defsOk = clips.every(id => svg.includes(`<clipPath id="${id}">`));
  check("drawing: clipped to each room, a handful of paths, its legend",
    /data-heat="temp"/.test(layer) && clips.length === 2 && defsOk && paths >= 3 && paths <= 60
    && layer.includes('fill="#3b82f6"') === false && layer.includes('fill="#34d399"')
    && svg.includes(">Temperature</text>") && svg.indexOf('class="lheat"') < svg.indexOf("lroom"), { clips, paths, len: layer.length });
});
tryCase("drawing: each kind draws only from its own sensors", () => {
  const h = draw({ heatmap: "humidity" }), c = draw({ heatmap: "co2" });
  check("drawing: each kind draws only from its own sensors",
    /data-heat="humidity"/.test(h) && !/class="lheat"/.test(c) && c.includes(">CO₂</text>"), null);
});
tryCase("drawing: cheap enough for a 5 s rebuild", () => {
  const t0 = performance.now();
  for (let i = 0; i < 20; i++) draw({ heatmap: "temp" });
  const per = (performance.now() - t0) / 20;
  const base = draw({}).length, on = draw({ heatmap: "temp" }).length;
  check("drawing: cheap enough for a 5 s rebuild", per < 150 && on - base < 40000, { per, grew: on - base });
});

// ── the chip ────────────────────────────────────────────────────────────────
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
// The card draws at the real clock, so its readings are stamped now.
const NOW_EID = Object.fromEntries(Object.entries(BY_EID).map(([k, v]) => [k, { ...v, last_changed: new Date().toISOString() }]));
function card(extra = {}, byEid = NOW_EID) {
  const view = { floorGap: 150, horizGap: 0, focusIdx: 0, zoom: 1 };
  const host = { el, view, floors: FLOORS, model: MODEL, byRoom: BY_ROOM, hiddenEids: new Set(), lightsByEid: byEid, lightsLoading: false,
    tier: "pro", saveView: async () => {}, onHexesBuilt() {}, ...extra };
  const c = LM.buildLightsMapCard(host);
  const all = c._all();
  const stage = all.find(n => n.className === "lv-stage");
  const chip = all.find(n => n.tagName && n.tagName.toLowerCase() === "button" && /♨/.test(n.textContent || ""));
  return { svg: stage && stage.innerHTML, chip };
}
tryCase("chip: offered for the kinds present, cycles, absent without a handler", () => {
  const picked = [];
  const none = card({});
  const off = card({ heatmap: null, onHeatmap: (k) => picked.push(k) });
  off.chip && off.chip.click();
  const t = card({ heatmap: "temp", onHeatmap: (k) => picked.push(k) });
  t.chip && t.chip.click();
  const h = card({ heatmap: "humidity", onHeatmap: (k) => picked.push(k) });
  h.chip && h.chip.click();
  const noSensors = card({ onHeatmap: () => {} }, {});
  check("chip: offered for the kinds present, cycles, absent without a handler",
    !none.chip && off.chip && /Heatmap/.test(off.chip.textContent) && t.chip && /Temperature/.test(t.chip.textContent)
    && JSON.stringify(picked) === JSON.stringify(["temp", "humidity", null]) && !noSensors.chip,
    { picked, none: !!none.chip, noSensors: !!noSensors.chip });
});
tryCase("contract: the card's drawing is the same with no chip and the chip off", () => {
  const a = card({}).svg, b = card({ heatmap: null, onHeatmap: () => {} }).svg, c = card({ heatmap: "temp", onHeatmap: () => {} }).svg;
  check("contract: the card's drawing is the same with no chip and the chip off",
    a && a === b && !/lheat/.test(a) && /lheat/.test(c || ""), { a: a && a.length, b: b && b.length });
});

console.log(JSON.stringify({ cases, failures }));
process.exit(failures.length ? 1 : 0);
