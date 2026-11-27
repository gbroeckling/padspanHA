// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
//
// Energy on the Atlas (views/energy_map.js), RUN: the chip only by the name of a room with metering at or over the
// quiet threshold, beside the room's readouts and the speaker, never on them; a placed device's watts by its marker;
// with nothing passed, the drawing and the room's sheet are exactly as without Energy; the room's sheet gains its
// Energy part (each device's watts now, kWh and cost today, the room's total, the empty-room line); a room without
// metering gains nothing; the figures are asked for through the host only, and not again within REFRESH_MS; the
// report's words; German.
//
// usage: energy_map.mjs <www/padspan-ha dir>
// prints one JSON line: { cases: {name: result}, failures: [...] }

import { pathToFileURL } from "node:url";
import { join } from "node:path";
import { readFileSync } from "node:fs";
import { install } from "./dom_shim.mjs";

const WWW = process.argv[2];
if (!WWW) { console.error("usage: energy_map.mjs <www/padspan-ha dir>"); process.exit(2); }
install(globalThis);

const failures = [], cases = {};
const check = (name, ok, detail) => { if (cases[name] !== false) cases[name] = !!ok; if (!ok) failures.push({ name, detail: detail === undefined ? null : detail }); };
const tryCase = async (name, fn) => { try { await fn(); } catch (e) { check(name, false, String(e && e.stack || e).slice(0, 1500)); } };
globalThis.fetch = async (url) => {
  const key = new URL(String(url)).pathname.split("/i18n/")[1];
  try { return { ok: true, json: async () => JSON.parse(readFileSync(join(WWW, "i18n", key), "utf-8")) }; }
  catch (_) { return { ok: false, json: async () => ({}) }; }
};
const url = (...p) => pathToFileURL(join(WWW, ...p)).href;
const I = await import(url("views", "i18n.js"));
const EN = await import(url("views", "energy_map.js"));
const LM = await import(url("views", "lights_map.js"));
const ISO = await import(url("views", "iso_lights.js"));
const tick = () => new Promise(r => (globalThis._realSetTimeout || setTimeout)(r, 0));

const MODEL = {
  floors: [{ id: "main", name: "Main", level: 0 }],
  areas: [{ id: "kitchen", name: "Kitchen", floor_id: "main" }, { id: "office", name: "Office", floor_id: "main" },
          { id: "hall", name: "Hall", floor_id: "main" }],
  room_geometry_m: {
    "Kitchen": { type: "poly", floor_id: "main", points_m: [[0, 0], [8, 0], [8, 6], [0, 6]] },
    "Office": { type: "poly", floor_id: "main", points_m: [[8, 0], [12, 0], [12, 4], [8, 4]] },
    "Hall": { type: "poly", floor_id: "main", points_m: [[0, 6], [6, 6], [6, 10], [0, 10]] },
  },
  light_positions_m: {}, rf_barriers_m: [],
};
// energy_get's answer, as energy.py makes it.
const SUMMARY = () => ({
  on: true, allowed: true, set_up: true, currency: "CAD", price: 0.12, quiet_w: 1, stale_after_s: 1800,
  house: { w: 2000, source: "home", stale: false, metered_w: 230, rest_w: 1770 },
  rooms: [
    { room: "Kitchen", on_map: true, metered: 2, w: 180, kwh: 2.4, cost: 0.288, devices: ["sensor.fridge_energy", "sensor.kettle_energy"],
      empty: { since: 0, for_s: 7200, w: 80, kwh: 0.2, cost: 0.024 } },
    { room: "Office", on_map: true, metered: 1, w: 0.4, kwh: 0.01, cost: 0.0012, devices: ["sensor.charger_energy"], empty: null },
    { room: "Den", on_map: false, metered: 1, w: 50, kwh: 0.5, cost: 0.06, devices: ["sensor.tv_energy"], empty: null },
  ],
  devices: [
    { id: "sensor.fridge_energy", rate: "sensor.fridge_power", name: "Fridge", room: "Kitchen", device_id: "dev_fridge", w: 80, own_w: 80, kwh: 1.2, own_kwh: 1.2, cost: 0.144, stale: false, always_on: false },
    { id: "sensor.kettle_energy", rate: "sensor.kettle_power", name: "Kettle", room: "Kitchen", device_id: "dev_kettle", w: 100, own_w: 100, kwh: 1.2, own_kwh: 1.2, cost: 0.144, stale: false, always_on: false },
    { id: "sensor.charger_energy", rate: "sensor.charger_power", name: "Charger", room: "Office", device_id: "dev_charger", w: 0.4, own_w: 0.4, kwh: 0.01, own_kwh: 0.01, cost: 0.0012, stale: false, always_on: false },
    { id: "sensor.tv_energy", rate: "sensor.tv_power", name: "TV", room: "Den", device_id: "dev_tv", w: null, own_w: null, kwh: 0.5, own_kwh: 0.5, cost: 0.06, stale: true, always_on: false },
  ],
  empty: { w: 80, rooms: [], after_min: 15, source: "padspan" }, standby: null, issues: [],
});
const HASS = { states: {}, entities: {
  "switch.fridge_plug": { entity_id: "switch.fridge_plug", device_id: "dev_fridge", area_id: "kitchen" },
  "sensor.fridge_power": { entity_id: "sensor.fridge_power", device_id: "dev_fridge", area_id: "kitchen" },
  "switch.charger_plug": { entity_id: "switch.charger_plug", device_id: "dev_charger", area_id: "office" },
  "light.kitchen": { entity_id: "light.kitchen", device_id: "dev_light", area_id: "kitchen" },
} };
function energy(answer = SUMMARY()) {
  const rec = { asked: 0, counts: [], redraws: 0 };
  rec.en = EN.createEnergy({ fetch: async () => { rec.asked++; return answer; }, hass: () => HASS,
    count: (w) => rec.counts.push(w), redraw: () => { rec.redraws++; } });
  return rec;
}
const all = (n) => (n ? n._all() : []);
const tree = (n) => (n ? { tag: n.localName, style: n.style ? n.style.cssText : "", text: n._text || "", a: n.attributes, kids: (n.children || []).map(tree) } : null);
const sheetNow = () => document.body.children.filter(n => n.style && /position:fixed/.test(n.style.cssText) && /z-index:10000/.test(n.style.cssText)).pop();
const reset = () => { document.body.children.length = 0; };
const apiOf = (en) => ({ hass: { states: {}, entities: {}, devices: {}, areas: {} }, lightsByEid: {}, controlsFor: () => false, toggle: async () => true,
  setMany: () => {}, toast: () => {}, floodLatches: {}, doorInvertByEid: {}, peopleShown: false, rerender: () => {}, ...(en === undefined ? {} : { energy: en }) });

// ── format: watts, kWh, money, a stretch of time ──
await tryCase("format", async () => {
  check("format", EN.fmtW(120.4) === "120 W" && EN.fmtW(1234) === "1.2 kW" && EN.fmtW(15000) === "15 kW" && EN.fmtW(null) === "—", [EN.fmtW(120.4), EN.fmtW(1234)]);
  check("format", EN.fmtKwh(0.4167) === "0.42 kWh" && EN.fmtKwh(12.34) === "12.3 kWh");
  check("format", EN.fmtMoney(0.4, "CAD").includes("0.40") && EN.fmtMoney(0.4, null) === "" && EN.fmtMoney(0.4, "XXX1").includes("0.40"));
  check("format", EN.fmtFor(2400) === "40 min" && EN.fmtFor(7200) === "2 h" && EN.fmtFor(7800) === "2 h 10 min" && EN.fmtFor(3 * 86400) === "3 d",
    [EN.fmtFor(2400), EN.fmtFor(7200), EN.fmtFor(7800), EN.fmtFor(3 * 86400)]);
});

// ── chips: rooms on the map with metering, at or over the quiet threshold; asked through the host, not again soon ──
await tryCase("chips", async () => {
  const r = energy();
  check("chips", JSON.stringify(r.en.chips()) === "{}", "nothing before the answer");
  await tick(); await tick();
  check("chips", JSON.stringify(r.en.chips()) === JSON.stringify({ Kitchen: "180 W" }), r.en.chips());     // the Office's 0.4 W, the Den off the map: none
  check("chips", r.asked === 1 && r.redraws === 1, [r.asked, r.redraws]);                                     // asked once, drawn again once
  r.en.chips(); r.en.deviceWatts(); r.en.sheet("Kitchen"); await tick();
  check("chips", r.asked === 1, r.asked);                                                                    // not again within REFRESH_MS
  check("chips", r.counts.filter(w => w === "on").length === 1, r.counts);
  check("chips", JSON.stringify(r.en.deviceWatts()) === JSON.stringify({ "switch.fridge_plug": "80 W" }), r.en.deviceWatts());
  const off = energy({ on: false, allowed: true });
  off.en.chips(); await tick(); await tick();
  check("chips", JSON.stringify(off.en.chips()) === "{}" && JSON.stringify(off.en.deviceWatts()) === "{}" && off.en.sheet("Kitchen") === null
    && !off.counts.length, off.counts);
});

// ── map: the chip by the room's name, clear of its readouts and the speaker; nothing passed, the same drawing ──
await tryCase("map", async () => {
  const draw = (opts) => ISO.buildIsoSVG(MODEL, {}, new Set(), null, 150, 0, {}, false, MODEL.floors, { codeChip: true, hitHalo: true, ...opts });
  const plain = draw({});
  check("map", plain === draw({ roomEnergy: undefined, deviceWatts: undefined }) && plain === draw({ roomEnergy: {}, deviceWatts: {} })
    && !plain.includes("lroom-energy") && !plain.includes("ldev-watts"), "an empty Energy changed the drawing");
  const on = draw({ roomEnergy: { Kitchen: "180 W" } });
  check("map", (on.match(/class="lroom-energy"/g) || []).length === 1 && on.includes(">⚡ 180 W</text>"), "one chip, its words");
  // In the room name's own group (its tap is the room's), under the name.
  const grp = on.slice(on.indexOf('<g class="lroom" data-role="room" data-room="Kitchen"'));
  check("map", grp.indexOf("lroom-energy") > 0 && grp.indexOf("lroom-energy") < grp.indexOf("</g></g>") + 8, "the chip is not with its room's name");
  const name = on.match(/data-room="Kitchen"[\s\S]*?<text x="([\d.]+)" y="([\d.]+)"/), chip = on.match(/class="lroom-energy"[^>]*><rect x="([\d.-]+)" y="([\d.-]+)" width="([\d.]+)" height="([\d.]+)"/);
  check("map", name && chip && Number(chip[2]) > Number(name[2]), [name && name.slice(1), chip && chip.slice(1)]);
  // Only that room changed.
  check("map", on.replace(/<g opacity="[^"]*"><g class="lroom-energy"[\s\S]*?<\/g><\/g>/, "") === plain, "more than the Kitchen changed");
  // With the speaker too: the two never overlap.
  const both = draw({ roomEnergy: { Kitchen: "180 W" }, roomAudio: { Kitchen: "on" } });
  const spk = both.match(/<g class="lroom-audio"[^>]*><circle cx="([\d.-]+)" cy="([\d.-]+)" r="([\d.]+)"/).slice(1).map(Number);
  const ch = both.match(/class="lroom-energy"[^>]*><rect x="([\d.-]+)" y="([\d.-]+)" width="([\d.]+)" height="([\d.]+)"/).slice(1).map(Number);
  const apart = spk[0] + spk[2] <= ch[0] || spk[0] - spk[2] >= ch[0] + ch[2] || spk[1] + spk[2] <= ch[1] || spk[1] - spk[2] >= ch[1] + ch[3];
  check("map", apart, [spk, ch]);
  // A placed device's watts by its marker (a lamp that reports its own power); an unplaced one, nothing.
  const states = { "light.kitchen_lamp": { entity_id: "light.kitchen_lamp", state: "on", attributes: { friendly_name: "Kitchen lamp", supported_color_modes: ["onoff"] } } };
  const lbe = Object.fromEntries(LM.gatherLights(states, { "light.kitchen_lamp": "Kitchen" }, {}, "pro").map(l => [l.entity_id, l]));
  const placed = { ...MODEL, light_positions_m: { "light.kitchen_lamp": { x_m: 2, y_m: 2, floor_id: "main" } } };
  const dw = (m) => ISO.buildIsoSVG(m, { Kitchen: Object.values(lbe) }, new Set(), null, 150, 0, lbe, false, MODEL.floors, { codeChip: true, deviceWatts: { "light.kitchen_lamp": "80 W" } });
  check("map", Object.keys(lbe).length === 1 && (dw(placed).match(/class="ldev-watts"/g) || []).length === 1 && dw(placed).includes(">⚡80 W</text>"), "the placed lamp's watts");
  check("map", !dw(MODEL).includes("ldev-watts"), "an unplaced device got watts");
});

// ── sheet: the room's Energy part; a room without metering, and Energy not passed, gain nothing ──
await tryCase("sheet", async () => {
  reset();
  const bare = LM.openRoomSheet(apiOf(undefined), [], "Kitchen");
  const was = JSON.stringify(tree(sheetNow()));
  bare.close(); reset();
  const nul = LM.openRoomSheet(apiOf(null), [], "Kitchen");
  check("sheet", JSON.stringify(tree(sheetNow())) === was, "energy null changed the sheet");
  nul.close(); reset();
  const r = energy();
  r.en.chips(); await tick(); await tick();
  const s = LM.openRoomSheet(apiOf(r.en), [], "Kitchen");
  const part = all(sheetNow()).find(n => n.attributes && n.attributes["data-room-controls"] === "energy");
  check("sheet", !!part, "no Energy part");
  const rows = all(part).filter(n => n.attributes && n.attributes["data-energy-device"]).map(n => all(n).map(x => x._text).filter(Boolean).join("|"));
  check("sheet", rows.length === 2 && rows[0].startsWith("Fridge|80 W|1.20 kWh|") && rows[0].includes("0.14") && rows[1].startsWith("Kettle|100 W"), rows);
  const total = all(part).find(n => n.attributes && n.attributes["data-energy-total"] !== undefined);
  check("sheet", total && all(total).some(x => x._text === "180 W") && all(total).some(x => x._text === "2.40 kWh"), total && all(total).map(x => x._text));
  check("sheet", all(part).some(x => /^Empty for 2 h: 80 W \(about .*0\.02.* today\)$/.test(x._text || "")), all(part).map(x => x._text).filter(Boolean));
  check("sheet", r.counts.filter(w => w === "sheet").length === 1, r.counts);
  s.close(); reset();
  // A stale device says so; a room with no metering: no part at all, the sheet as it was.
  const den = r.en.sheet("Den");
  check("sheet", den && all(den.draw()).some(x => x._text === "No recent reading"), "the stale TV");
  check("sheet", r.en.sheet("Hall") === null, "a room without metering has a part");
  const hall = LM.openRoomSheet(apiOf(r.en), [], "Hall");
  check("sheet", !all(sheetNow()).some(n => n.attributes && n.attributes["data-room-controls"] === "energy"), "the Hall gained Energy");
  hall.close(); reset();
});

// ── the module asks Home Assistant only through its host ──
await tryCase("host-only", async () => {
  const src = readFileSync(join(WWW, "views", "energy_map.js"), "utf-8").split("\n").filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");
  check("host-only", !src.includes("callWS") && !src.includes("localStorage") && !/(?<![.\w])fetch\(/.test(src) && !src.includes("callService"), "talks to Home Assistant itself");
  const imports = [...src.matchAll(/import\(`\.\/([a-z0-9_]+)\.js/g)].map(m => m[1]);
  check("host-only", JSON.stringify(imports) === JSON.stringify(["i18n"]), imports);
});

// ── German ──
await tryCase("german", async () => {
  await I.useLanguage({ language: "de", locale: { language: "de" } }, ["atlas1"]);
  const r = energy();
  r.en.chips(); await tick(); await tick();
  const part = r.en.sheet("Kitchen").draw();
  const words = all(part).map(x => x._text).filter(Boolean);
  check("german", words.includes("Energie") && words.includes("Raum gesamt") && words.some(w => w.startsWith("Leer seit 2 Std.")), words);
  await I.useLanguage({ language: "en", locale: { language: "en" } }, ["atlas1"]);
});

process.stdout.write(JSON.stringify({ cases, failures }) + "\n", () => process.exit(0));
