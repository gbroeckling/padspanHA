// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
//
// Room controls (views/room_controls.js), RUN: the systems it knows and no
// others (Home Assistant's own speakers only when ticked); the map's speaker
// only beside rooms with a player on, slashed while the first is muted,
// nothing while they are off; the room sheet (lights_map.js openRoomSheet)
// with them off is the sheet as it was, and with them on gains its status
// line, Room off, Audio above the lights and Shades and Climate below; each
// button one Home Assistant call; buttons hidden or greyed by what the player
// supports; two players in a room in the chosen order; the matching card's
// guesses, its order, its save, its first opening and an administrator's
// only; the report's words.
//
// usage: room_controls.mjs <www/padspan-ha dir>
// prints one JSON line: { cases: {name: result}, failures: [...] }

import { pathToFileURL } from "node:url";
import { join } from "node:path";
import { readFileSync } from "node:fs";
import { install, flush } from "./dom_shim.mjs";

const WWW = process.argv[2];
if (!WWW) { console.error("usage: room_controls.mjs <www/padspan-ha dir>"); process.exit(2); }
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
const RC = await import(url("views", "room_controls.js"));
const LM = await import(url("views", "lights_map.js"));
const ISO = await import(url("views", "iso_lights.js"));
const tick = () => new Promise(r => (globalThis._realSetTimeout || setTimeout)(r, 0));

// ── a house: a great room with Control4 and a Denon zone, an office, a kitchen speaker, a garage ──
const ST = (entity_id, state, attributes = {}) => ({ entity_id, state, attributes: { friendly_name: entity_id.split(".")[1].replace(/_/g, " "), ...attributes } });
const F = { SET: 4, MUTE: 8, OFF: 256, STEP: 1024 };
const FULL = F.SET | F.MUTE | F.OFF | F.STEP;
// A Control4 room as Home Assistant has it (1288): it steps itself, mutes and turns off; it never sets a level.
const C4 = F.MUTE | F.OFF | F.STEP;
function house(over = {}) {
  const states = {
    "media_player.c4_great_room": ST("media_player.c4_great_room", "on", { friendly_name: "Great Room", volume_level: 0.35, is_volume_muted: false, supported_features: C4 }),
    "media_player.denon_zone_2": ST("media_player.denon_zone_2", "on", { friendly_name: "Zone 2", volume_level: 0.5, is_volume_muted: false, supported_features: FULL }),
    "media_player.c4_office": ST("media_player.c4_office", "off", { friendly_name: "Alex’s office", supported_features: C4 }),
    "media_player.kitchen_speaker": ST("media_player.kitchen_speaker", "playing", { friendly_name: "Kitchen speaker", volume_level: 0.2, supported_features: F.SET | F.MUTE }),
    "media_player.kitchen_tv": ST("media_player.kitchen_tv", "off", { friendly_name: "Kitchen TV", supported_features: 0 }),
    "light.great_room_pots": ST("light.great_room_pots", "on", { supported_color_modes: ["brightness"], brightness: 200 }),
    "light.great_room_lamp": ST("light.great_room_lamp", "on", { supported_color_modes: ["onoff"] }),
    "light.great_room_cove": ST("light.great_room_cove", "off", { supported_color_modes: ["onoff"] }),
    "lock.great_room_patio": ST("lock.great_room_patio", "locked"),
    "climate.great_room": ST("climate.great_room", "heat", { friendly_name: "Great Room thermostat", current_temperature: 20.4, temperature: 22, target_temp_step: 0.5,
      min_temp: 7, max_temp: 30, supported_features: 1, hvac_modes: ["off", "heat"] }),
    "cover.great_room_left": ST("cover.great_room_left", "open", { friendly_name: "Left blind", current_position: 100, supported_features: 1 | 2 | 4 | 8 }),
    "cover.great_room_right": ST("cover.great_room_right", "closed", { friendly_name: "Right blind", current_position: 0, supported_features: 1 | 2 }),
    "cover.garage_door": ST("cover.garage_door", "closed", { device_class: "garage", supported_features: 3 }),
    "sensor.great_room_temperature": ST("sensor.great_room_temperature", "21.5", { device_class: "temperature" }),
    "sensor.great_room_wall_temperature": ST("sensor.great_room_wall_temperature", "21.3", { device_class: "temperature" }),
    "sensor.great_room_floor_temperature": ST("sensor.great_room_floor_temperature", "22.9", { device_class: "temperature" }),
    "sensor.great_room_humidity": ST("sensor.great_room_humidity", "45.2", { device_class: "humidity" }),
    ...over,
  };
  const platform = { "media_player.c4_great_room": "control4", "media_player.denon_zone_2": "denonavr", "media_player.c4_office": "control4",
    "media_player.kitchen_speaker": "cast", "media_player.kitchen_tv": "webostv" };
  const area = { "media_player.denon_zone_2": "great_room", "climate.great_room": "great_room", "cover.great_room_left": "great_room",
    "cover.great_room_right": null, "cover.garage_door": "garage", "sensor.great_room_temperature": "great_room",
    "sensor.great_room_wall_temperature": "great_room", "sensor.great_room_floor_temperature": null, "sensor.great_room_humidity": "great_room",
    "light.great_room_pots": "great_room", "light.great_room_lamp": "great_room", "light.great_room_cove": "great_room", "lock.great_room_patio": "great_room" };
  const entities = {}, devices = { dev_right: { id: "dev_right", area_id: "great_room" }, dev_floor: { id: "dev_floor", area_id: "great_room" } };
  for (const eid of Object.keys(states)) entities[eid] = { entity_id: eid, platform: platform[eid] || eid.split(".")[0], area_id: area[eid] || null,
    device_id: eid === "cover.great_room_right" ? "dev_right" : eid === "sensor.great_room_floor_temperature" ? "dev_floor" : null };
  const calls = [];
  const hass = { states, entities, devices, areas: { great_room: { area_id: "great_room", name: "Great Room" } },
    user: { is_admin: true }, config: { unit_system: { temperature: "°C" } },
    callService: async (domain, service, data) => { calls.push({ domain, service, ...data }); if (hass.refuse) throw { code: "home_assistant_error", message: hass.refuse }; } };
  return { hass, calls };
}
const MODEL = {
  floors: [{ id: "main", name: "Main", level: 0 }],
  areas: [{ id: "great_room", name: "Great Room", floor_id: "main" }, { id: "office", name: "Alex's Office", floor_id: "main" },
          { id: "kitchen", name: "Kitchen", floor_id: "main" }, { id: "garage", name: "Garage", floor_id: "main" }],
  room_geometry_m: {
    "Great Room": { type: "poly", floor_id: "main", points_m: [[0, 0], [8, 0], [8, 6], [0, 6]] },
    "Alex's Office": { type: "poly", floor_id: "main", points_m: [[8, 0], [12, 0], [12, 4], [8, 4]] },
    "Kitchen": { type: "poly", floor_id: "main", points_m: [[0, 6], [6, 6], [6, 10], [0, 10]] },
    "Garage": { type: "poly", floor_id: "main", points_m: [[6, 6], [12, 6], [12, 10], [6, 10]] },
  },
  light_positions_m: {}, rf_barriers_m: [],
};

// The room controls as lights_panel.js makes them.
function controls(h, { matches = {}, ha = false, admin = true, openers = null, sources = undefined, limits = undefined } = {}) {
  const rec = { counts: [], toasts: [], saved: [], redraws: 0, settings: { room_audio_matches: matches, room_audio_ha_speakers: ha,
    ...(sources ? { room_audio_sources: sources } : {}), ...(limits ? { room_audio_limits: limits } : {}) } };
  h.hass.user.is_admin = admin;
  rec.rc = RC.createRoomControls({
    hass: () => h.hass, model: () => MODEL, settings: () => rec.settings, admin: () => h.hass.user.is_admin,
    // As lights_panel.js keeps them: a key the save did not carry keeps what it was.
    save: async (patch) => { rec.saved.push(patch); rec.settings = { ...rec.settings, ...patch }; return true; },
    toast: (m, e) => rec.toasts.push([m, !!e]), errorText: (e) => e.message, count: (w) => rec.counts.push(w), redraw: () => { rec.redraws++; },
    ...(openers ? { openers: () => new Set(openers) } : {}),
  });
  return rec;
}
const lightsOf = (h) => LM.gatherLights(h.hass.states, Object.fromEntries(Object.entries(h.hass.entities)
  .filter(([eid, e]) => /^(light|lock)\./.test(eid) && e.area_id).map(([eid]) => [eid, "Great Room"])), {}, "pro");
function apiOf(h, rc, setMany = []) {
  return { hass: h.hass, lightsByEid: {}, controlsFor: () => false, toggle: async () => true, setMany: (eids, on) => setMany.push([eids.slice(), on]),
    toast: () => {}, floodLatches: {}, doorInvertByEid: {}, peopleShown: false, rerender: () => {}, roomControls: rc || null };
}
const tree = (n) => (n ? { tag: n.localName, style: n.style ? n.style.cssText : "", text: n._text || "", a: n.attributes, kids: (n.children || []).map(tree) } : null);
const sheetNow = () => document.body.children.filter(n => n.style && /position:fixed/.test(n.style.cssText) && /z-index:10000/.test(n.style.cssText)).pop();
const reset = () => { document.body.children.length = 0; };
const all = (n) => (n ? n._all() : []);
const btn = (root, pred) => all(root).find(n => n.localName === "button" && pred(n));
// The glyphs carry U+FE0E (drawn as text, not as colour emoji): read without it.
const FE0E = String.fromCharCode(0xFE0E);
const plain = (x) => String(x).split(FE0E).join("");
const byText = (root, text) => btn(root, b => plain(b.textContent) === text);
const byAria = (root, text) => btn(root, b => b.attributes["aria-label"] === text);
const section = (root, key) => all(root).find(n => n.attributes && n.attributes["data-room-controls"] === key);
const rowOf = (root, eid) => all(root).find(n => n.attributes && n.attributes["data-eid"] === eid && n.localName === "div");
const press = async (b) => { if (!b) throw new Error("no such button"); b.click(); await tick(); await tick(); };
const words = (n) => all(n).filter(x => x.localName === "button").map(x => plain(x.textContent));

// ── systems: the integrations it knows, and Home Assistant's own speakers only when ticked ──
await tryCase("systems", async () => {
  const want = ["control4", "crestron", "savant", "savantaudio", "russound_rio", "russound_rnet", "nuvo_serial", "monoprice", "xantech",
    "triad-audio-matrix", "denonavr", "yamaha_musiccast", "yamaha", "anthemav"];
  check("systems", JSON.stringify(Object.keys(RC.ROOM_AUDIO_SYSTEMS)) === JSON.stringify(want), Object.keys(RC.ROOM_AUDIO_SYSTEMS));
  check("systems", RC.ROOM_AUDIO_SYSTEMS.control4 === "Control4" && RC.ROOM_AUDIO_SYSTEMS.denonavr === "Denon" && RC.ROOM_AUDIO_SYSTEMS.russound_rnet === "Russound");
  const h = house();
  const ids = (ha) => RC.audioPlayers(h.hass, ha).map(p => p.eid).sort().join();
  check("systems", ids(false) === "media_player.c4_great_room,media_player.c4_office,media_player.denon_zone_2", ids(false));
  // With the option: the Cast speaker (it has a volume) joins; the TV with no volume never does.
  check("systems", ids(true) === "media_player.c4_great_room,media_player.c4_office,media_player.denon_zone_2,media_player.kitchen_speaker", ids(true));
  const cast = RC.audioPlayers(h.hass, true).find(p => p.ha);
  check("systems", cast && cast.system === "Cast", cast);
  // A hidden one is never offered.
  h.hass.entities["media_player.c4_office"].hidden = true;
  check("systems", !ids(false).includes("c4_office"), ids(false));
});

// ── prefill: by Home Assistant's area, else by the name, normalised ──
await tryCase("prefill", async () => {
  check("prefill", RC.norm("Alex’s office") === RC.norm("Alex's Office") && RC.norm(" Great-Room ") === "greatroom", RC.norm("Alex’s office"));
  const h = house();
  const got = RC.prefill(RC.audioPlayers(h.hass, false), RC.mapRooms(MODEL), h.hass);
  check("prefill", JSON.stringify(got.great_room) === JSON.stringify(["media_player.c4_great_room", "media_player.denon_zone_2"])
    && JSON.stringify(got.office) === JSON.stringify(["media_player.c4_office"]) && Object.keys(got).length === 2, got);
  check("prefill", JSON.stringify(RC.cleanMatches({ a: ["media_player.x", "light.y", "media_player.x"], b: ["media_player.x"], c: "no" })) === JSON.stringify({ a: ["media_player.x"] }));
});

// ── looks: the map's speaker only beside rooms with a player on; slashed while the first is muted ──
await tryCase("looks", async () => {
  const h = house();
  const r = controls(h, { matches: { great_room: ["media_player.c4_great_room", "media_player.denon_zone_2"], office: ["media_player.c4_office"] } });
  check("looks", JSON.stringify(r.rc.looks()) === JSON.stringify({ "Great Room": "on" }), r.rc.looks());     // the office's player is off: nothing
  h.hass.states["media_player.denon_zone_2"].attributes.is_volume_muted = true;
  check("looks", r.rc.looks()["Great Room"] === "on", r.rc.looks());                                         // the second muted: not slashed
  h.hass.states["media_player.c4_great_room"].attributes.is_volume_muted = true;
  check("looks", r.rc.looks()["Great Room"] === "muted", r.rc.looks());
  h.hass.states["media_player.c4_great_room"].state = "off"; h.hass.states["media_player.denon_zone_2"].state = "standby";
  check("looks", JSON.stringify(r.rc.looks()) === "{}", r.rc.looks());                                       // all off: nothing at all
  check("looks", r.counts.filter(w => w === "on").length === 1, r.counts);                                   // counted once per page load
});

// ── icon: beside the room's name, inside its tap target; no roomAudio, the same drawing ──
await tryCase("icon", async () => {
  const draw = (opts) => ISO.buildIsoSVG(MODEL, {}, new Set(), null, 150, 0, {}, false, MODEL.floors, { codeChip: true, hitHalo: true, ...opts });
  const plain = draw({});
  check("icon", plain === draw({ roomAudio: undefined }) && plain === draw({ roomAudio: {} }) && !plain.includes("lroom-audio"), "an empty roomAudio changed the drawing");
  const on = draw({ roomAudio: { "Great Room": "on" } });
  const g = on.match(/<g class="lroom" data-role="room" data-room="Great Room"[\s\S]*?<\/text>(<g opacity[^>]*>)?(<g class="lroom-audio"[\s\S]*?<\/g>)?/);
  check("icon", (on.match(/class="lroom-audio"/g) || []).length === 1 && (on.match(/class="lroom-audio-hit"/g) || []).length === 1, "one speaker, one tap circle");
  check("icon", !!g && !!g[2] && g[2].includes('data-look="on"') && (g[2].match(/<path/g) || []).length === 3, g && g[0].slice(-400));
  // Beside the name: just right of the name's middle, on its line.
  const tx = on.match(/<g class="lroom" data-role="room" data-room="Great Room"[\s\S]*?<text x="([\d.]+)" y="([\d.]+)"/);
  const hit = on.match(/class="lroom-audio-hit" cx="([\d.]+)" cy="([\d.]+)" r="([\d.]+)"/);
  check("icon", tx && hit && Number(hit[1]) > Number(tx[1]) && Math.abs(Number(hit[2]) - Number(tx[2])) < 1.5 && Number(hit[3]) >= 9, [tx && tx.slice(1), hit && hit.slice(1)]);
  // The tap circle is in the room name's own group (its tap opens the room's sheet, as the name's does).
  const grp = on.slice(on.indexOf('<g class="lroom" data-role="room" data-room="Great Room"'));
  check("icon", grp.indexOf("lroom-audio-hit") < grp.indexOf("</g>"), "the tap circle is outside the name's group");
  // Only that room changed.
  check("icon", on.replace(/<circle class="lroom-audio-hit"[^>]*\/>/, "").replace(/<g opacity="[^"]*"><g class="lroom-audio"[\s\S]*?<\/g><\/g>/, "") === plain, "more than the Great Room changed");
  const muted = draw({ roomAudio: { "Great Room": "muted" } });
  check("icon", muted.includes('data-look="muted"') && (muted.match(/<g class="lroom-audio"[\s\S]*?<\/g>/)[0].match(/<path/g) || []).length === 5, "the muted look has its slash");
});

// ── icon-clear: the speaker is a round badge of its own, never on a live reading's digits (the owner, 2026-11-25: over the
// humidity, "the humidity looks like a volume indicator") ──
await tryCase("icon-clear", async () => {
  const h = house(), now = new Date().toISOString();
  const states = { ...h.hass.states, "sensor.great_room_humidity": { ...h.hass.states["sensor.great_room_humidity"], last_changed: now, last_updated: now } };
  const lbe = Object.fromEntries(LM.gatherLights(states, {}, {}, "pro").map(l => [l.entity_id, l]));
  const model = (x, y) => ({ ...MODEL, light_positions_m: x === null ? {} : { "sensor.great_room_humidity": { x_m: x, y_m: y, floor_id: "main" } } });
  const draw = (m, ra) => ISO.buildIsoSVG(m, {}, new Set(), null, 150, 0, lbe, false, MODEL.floors, { codeChip: true, hitHalo: true, roomAudio: ra });
  const reading = (svg) => { const m = svg.match(/<text x="([\d.]+)" y="([\d.]+)"[^>]*font-size="([\d.]+)"[^>]*>([\d.]+%)<\/text>/); return m ? m.slice(1, 4).map(Number).concat(m[4]) : null; };
  const badge = (svg) => { const m = svg.match(/<g class="lroom-audio"[^>]*><circle cx="([\d.-]+)" cy="([\d.-]+)" r="([\d.]+)"/); return m ? m.slice(1).map(Number) : null; };
  // Where a reading lands for a sensor at (x, y) m is affine: three draws find it, and the reading goes where the speaker
  // would otherwise be.
  const o = reading(draw(model(1, 1))), ex = reading(draw(model(2, 1))), ey = reading(draw(model(1, 2)));
  const want = badge(draw(model(null), { "Great Room": "on" }));
  const a = ex[0] - o[0], b = ey[0] - o[0], c = ex[1] - o[1], d = ey[1] - o[1], det = a * d - b * c;
  const dx = want[0] - o[0], dy = want[1] - o[1];
  const svg = draw(model(1 + (d * dx - b * dy) / det, 1 + (a * dy - c * dx) / det), { "Great Room": "on" });
  const r = reading(svg), g = badge(svg);
  const onIt = r && Math.hypot(r[0] - want[0], r[1] - want[1]) < 1;          // the reading is where the speaker was
  // The digits' box (markerSvg: monospace, centred on the sensor) against the badge's circle: apart, with a gap.
  const hw = String(r[3]).length * r[2] * 0.32, hh = r[2] * 0.45;
  const apart = g && (Math.abs(g[0] - r[0]) >= hw + g[2] || Math.abs(g[1] - r[1]) >= hh + g[2]);
  check("icon-clear", onIt && g && (g[0] !== want[0] || g[1] !== want[1]) && apart, { want, reading: r, badge: g });
  // Round, dark, edged in the name's colour, the speaker inside it.
  check("icon-clear", /<g class="lroom-audio"[^>]*stroke="(#[0-9a-f]{6}|hsl[^"]*)"[^>]*><circle [^>]*fill="#071008"/.test(svg), svg.match(/<g class="lroom-audio"[^>]*>[^]*?<\/g>/));
});

// ── off: the sheet with no room controls is the sheet as it was ──
await tryCase("off", async () => {
  const h = house(), lights = lightsOf(h);
  reset();
  const a = LM.openRoomSheet(apiOf(h, null), lights, "Great Room");
  const was = JSON.stringify(tree(sheetNow()));
  a.close(); reset();
  const api = apiOf(h, null); delete api.roomControls;
  const b = LM.openRoomSheet(api, lights, "Great Room");
  check("off", was === JSON.stringify(tree(sheetNow())), "a sheet without roomControls differs from one with null");
  check("off", !all(sheetNow()).some(n => n.attributes && n.attributes["data-room-controls"]) && !words(sheetNow()).some(w => /Room off/.test(w)), words(sheetNow()));
  b.close(); reset();
});

// ── sheet: status line, Room off first, Audio above the lights, Shades then Climate below ──
// The sheet's three parts, each only while the host has it on (the owner, 2026-11-26: "Shades should go with doors and
// Windows", "Thermostats in climate and air quality"): Audio with Room off; Shades; Thermostats with the status line.
await tryCase("parts", async () => {
  const h = house();
  const r = controls(h, { matches: { great_room: ["media_player.c4_great_room", "media_player.denon_zone_2"] } });
  const kinds = (p) => (p ? Array.from(p.draw().children || []).map(c => c.attributes["data-room-controls"]).join() : null);
  const on = ["light.great_room_pots"];
  const shades = r.rc.sheet("Great Room", { lightsOn: on, parts: { audio: false, shades: true, climate: false } });
  check("parts", shades.status === null && shades.roomOff === null && shades.before === null && kinds(shades.after) === "shades", shades);
  const climate = r.rc.sheet("Great Room", { lightsOn: on, parts: { audio: false, shades: false, climate: true } });
  check("parts", climate.status === "21.5° · 45 %" && climate.roomOff === null && climate.before === null && kinds(climate.after) === "climate", climate);
  const audio = r.rc.sheet("Great Room", { lightsOn: on, parts: { audio: true, shades: false, climate: false } });
  check("parts", audio.status === null && audio.roomOff && audio.roomOff.label === "Room off (3)" && audio.before && audio.after === null, audio);
  const none = r.rc.sheet("Great Room", { lightsOn: on, parts: { audio: false, shades: false, climate: false } });
  check("parts", none.status === null && none.roomOff === null && none.before === null && none.after === null, none);
  check("parts", h.calls.length === 0, h.calls);
  // An opener (a door's or a gate's: a wall's link, Devices → Door Openers) is never a shade, whatever its device class.
  const blinds = (rc) => { const p = rc.sheet("Great Room", { parts: { audio: false, shades: true, climate: false } }).after;
    return p ? Array.from(p.draw().children[0].children || []).map(r => all(r).map(n => n._text).filter(Boolean).join("|")).join() : ""; };
  const r2 = controls(h, { openers: ["cover.great_room_left"] });
  check("parts", blinds(r.rc) === ",Left blind|100 % open|Open|Stop|Close,Right blind|0 % open|Open|Close,All shades|Open|Stop|Close"
    && blinds(r2.rc) === ",Right blind|0 % open|Open|Close", [blinds(r.rc), blinds(r2.rc)]);
});

await tryCase("sheet", async () => {
  const h = house(), lights = lightsOf(h);
  const r = controls(h, { matches: { great_room: ["media_player.c4_great_room", "media_player.denon_zone_2"] } });
  reset();
  const setMany = [];
  const s = LM.openRoomSheet(apiOf(h, r.rc, setMany), lights, "Great Room");
  const sh = sheetNow().children[0];
  const kids = sh.children;
  // head, the action row, Audio, the list's rows, then Shades and Climate (in one block).
  check("sheet", kids[2] && kids[2].attributes["data-room-controls"] === "audio", kids.map(k => k.attributes && k.attributes["data-room-controls"]));
  const last = kids[kids.length - 1];
  check("sheet", last && last.children.map(c => c.attributes["data-room-controls"]).join() === "shades,climate", last && last.children.length);
  // The status line: the median of the room's temperature sensors (its own area or its device's) and humidity.
  const head = all(kids[0]).map(n => n._text).filter(Boolean);
  check("sheet", head.includes("21.5° · 45 %"), head);
  // Room off: 2 lights on + 2 players on, first in the row; the existing buttons follow as they were.
  const row = words(kids[1]);
  check("sheet", row[0] === "Room off (4)" && row.includes("All lights off") && row.includes("All lights on"), row);
  check("sheet", r.redraws === 0 && h.calls.length === 0, "opening the sheet moved something");
  // The lights' list is the one it was (the lock, the lights), between Audio and Shades.
  check("sheet", kids[3] && kids[3].attributes["data-room-lights"] !== undefined && kids[3].textContent === "Lights", kids[3] && kids[3].textContent);
  const listRows = kids.slice(4, kids.length - 1).map(k => all(k).map(n => n._text).filter(Boolean).join("|"));
  check("sheet", listRows.length === 4, listRows);
  // Room off: the lights through the sheet's own switch, each player turned off; never the lock, the blinds, the thermostat.
  await press(byText(kids[1], "Room off (4)"));
  check("sheet", JSON.stringify(setMany.map(([e, o]) => [e.slice().sort(), o])) === JSON.stringify([[["light.great_room_lamp", "light.great_room_pots"], false]]), setMany);
  check("sheet", h.calls.map(c => `${c.domain}.${c.service}:${c.entity_id}`).join() === "media_player.turn_off:media_player.c4_great_room,media_player.turn_off:media_player.denon_zone_2", h.calls);
  check("sheet", r.counts.filter(w => w !== "on").join() === "room_off", r.counts);
  s.close(); reset();
  // Nothing on: no Room off.
  for (const e of ["light.great_room_pots", "light.great_room_lamp"]) h.hass.states[e].state = "off";
  for (const e of ["media_player.c4_great_room", "media_player.denon_zone_2"]) h.hass.states[e].state = "off";
  const s2 = LM.openRoomSheet(apiOf(h, r.rc), lightsOf(h), "Great Room");
  check("sheet", !words(sheetNow()).some(w => /Room off/.test(w)), words(sheetNow()));
  s2.close(); reset();
});

// ── audio: each button one call, in the room's order; two players ──
await tryCase("audio", async () => {
  const h = house(), lights = lightsOf(h);
  const r = controls(h, { matches: { great_room: ["media_player.denon_zone_2", "media_player.c4_great_room"] } });
  reset();
  const s = LM.openRoomSheet(apiOf(h, r.rc), lights, "Great Room");
  const audio = section(sheetNow(), "audio");
  const rows = audio.children.slice(1).filter(n => n.attributes["data-eid"]);
  check("audio", rows.map(n => n.attributes["data-eid"]).join() === "media_player.denon_zone_2,media_player.c4_great_room", rows.map(n => n.attributes["data-eid"]));
  const label = (n) => n.children[0].textContent;
  check("audio", label(rows[0]) === "Denon · Zone 2" && label(rows[1]) === "Control4 · Great Room", [label(rows[0]), label(rows[1])]);
  check("audio", words(rows[1]).join() === "Mute,−,+,⏻" && all(rows[1]).find(n => n.attributes["data-level"] !== undefined).textContent === "35", words(rows[1]));
  check("audio", rows[1].children[1].textContent === "On", rows[1].children[1].textContent);
  // Mute, −, level, + and ⏻ in one group that never wraps (the 3D room panel on a wall put the last three on a second
  // line): a narrow panel moves the group under the name as one line.
  const ctl = rows[1].children[2];
  check("audio", rows[1].children.length === 3 && /flex-wrap:nowrap/.test(ctl.style.cssText) && /flex:0 0 auto/.test(ctl.style.cssText)
    && words(ctl).join() === "Mute,−,+,⏻" && ctl.children.some(n => n.attributes["data-level"] !== undefined), ctl && ctl.style.cssText);
  const one = async (b) => { const n = h.calls.length; await press(b); return h.calls.slice(n); };
  const c4 = () => rowOf(section(sheetNow(), "audio"), "media_player.c4_great_room");
  let got = await one(byAria(c4(), "Great Room volume up"));
  check("audio", JSON.stringify(got) === JSON.stringify([{ domain: "media_player", service: "volume_up", entity_id: "media_player.c4_great_room" }]), got);
  // A player that steps itself (a Control4 room: 1 in 100 a press) shows the pressed level at once, one step, never
  // in tens (the quick presses themselves: "quick").
  s.update(apiOf(h, r.rc), lights);
  const lvlNow = () => all(c4()).find(n => n.attributes["data-level"] !== undefined).textContent;
  check("audio", lvlNow() === "36", lvlNow());
  got = await one(byAria(c4(), "Great Room volume down"));
  check("audio", JSON.stringify(got) === JSON.stringify([{ domain: "media_player", service: "volume_down", entity_id: "media_player.c4_great_room" }]), got);
  got = await one(byAria(c4(), "Mute Great Room"));
  check("audio", JSON.stringify(got) === JSON.stringify([{ domain: "media_player", service: "volume_mute", entity_id: "media_player.c4_great_room", is_volume_muted: true }]), got);
  got = await one(byAria(c4(), "Turn Great Room off"));
  check("audio", JSON.stringify(got) === JSON.stringify([{ domain: "media_player", service: "turn_off", entity_id: "media_player.c4_great_room" }]), got);
  check("audio", r.counts.filter(w => w !== "on").join() === "up,down,mute,off", r.counts);
  // Pressed, the sheet shows the new level and mute at once (redrawn by the host), until Home Assistant says.
  s.update(apiOf(h, r.rc), lights);
  check("audio", c4().children[1].textContent === "Muted" && words(c4())[0] === "Unmute", words(c4()));
  // Muted now in Home Assistant: one press unmutes.
  h.hass.states["media_player.denon_zone_2"].attributes.is_volume_muted = true;
  s.update(apiOf(h, r.rc), lights);
  const dz = rowOf(section(sheetNow(), "audio"), "media_player.denon_zone_2");
  got = await one(byAria(dz, "Unmute Zone 2"));
  check("audio", JSON.stringify(got) === JSON.stringify([{ domain: "media_player", service: "volume_mute", entity_id: "media_player.denon_zone_2", is_volume_muted: false }]), got);
  // Home Assistant refuses: its own words in a toast, and the level goes back.
  h.hass.refuse = "Control4 controller did not answer";
  await one(byAria(c4(), "Great Room volume up"));
  await tick();
  check("audio", r.toasts.some(([m, e]) => e && m === "Great Room: Control4 controller did not answer"), r.toasts);
  s.close(); reset();
});

// ── features: − / + only where it steps; no Mute or ⏻ the player can't do; an off player: nothing to press, no level ──
await tryCase("features", async () => {
  const h = house({
    "media_player.c4_great_room": ST("media_player.c4_great_room", "off", { friendly_name: "Great Room", supported_features: F.SET }),
    "media_player.denon_zone_2": ST("media_player.denon_zone_2", "on", { friendly_name: "Zone 2", supported_features: F.STEP }),
  });
  const r = controls(h, { matches: { great_room: ["media_player.c4_great_room", "media_player.denon_zone_2"] } });
  reset();
  const s = LM.openRoomSheet(apiOf(h, r.rc), lightsOf(h), "Great Room");
  const c4 = rowOf(section(sheetNow(), "audio"), "media_player.c4_great_room"), dz = rowOf(section(sheetNow(), "audio"), "media_player.denon_zone_2");
  check("features", words(c4).join() === "" && !all(c4).some(n => n.attributes["data-level"] !== undefined) && c4.children[1].textContent === "Off", words(c4));
  check("features", !all(section(sheetNow(), "audio")).some(n => n.attributes && n.attributes["data-slider"] === "media_player.c4_great_room"), "an off player's slider");
  check("features", words(dz).join() === "−,+" && all(dz).filter(n => n.localName === "button").every(b => !b.disabled), words(dz));
  await press(byText(dz, "+"));
  check("features", h.calls.length === 1 && h.calls[0].service === "volume_up", h.calls);
  s.close(); reset();
});

// ── quick: each − / + moves the number one step at once, in place; presses add up; Home Assistant's word after ──
// (the owner, 2026-11-25: "The volume doesn't update fast enough")
await tryCase("quick", async () => {
  const realNow = Date.now;
  let clk = 0;
  Date.now = () => realNow() + clk;
  try {
    const h = house({ "media_player.kitchen_speaker": ST("media_player.kitchen_speaker", "playing", { friendly_name: "Kitchen speaker", volume_level: 0.2, supported_features: F.SET | F.MUTE }) });
    const r = controls(h, { matches: { great_room: ["media_player.c4_great_room", "media_player.kitchen_speaker"] }, ha: true });
    reset();
    const lights = lightsOf(h);
    const s = LM.openRoomSheet(apiOf(h, r.rc), lights, "Great Room");
    const c4 = () => rowOf(section(sheetNow(), "audio"), "media_player.c4_great_room");
    const num = (row) => all(row).find(n => n.attributes["data-level"] !== undefined);
    const row0 = c4(), num0 = num(row0), plus = byAria(row0, "Great Room volume up"), minus = byAria(row0, "Great Room volume down");
    const seen = [];
    for (let i = 0; i < 3; i++) { await press(plus); seen.push(num0.textContent); }
    // 35 → 36, 37, 38: one in 100 a press, at once, in the same node; nothing drawn again, three calls.
    check("quick", seen.join() === "36,37,38", seen);
    check("quick", h.calls.length === 3 && h.calls.every(c => c.service === "volume_up" && c.entity_id === "media_player.c4_great_room") && r.redraws === 0, [h.calls, r.redraws]);
    s.update(apiOf(h, r.rc), lights);
    check("quick", c4() === row0 && num(c4()) === num0 && num0.textContent === "38", "the row was drawn again");
    // Home Assistant catching up (36: on its way to 38): still 38, the row still the same; then a 4th press adds up.
    h.hass.states["media_player.c4_great_room"].attributes.volume_level = 0.36;
    s.update(apiOf(h, r.rc), lights);
    check("quick", c4() === row0 && num0.textContent === "38", num0.textContent);
    await press(plus);
    check("quick", num0.textContent === "39", num0.textContent);
    // Home Assistant says the pressed level: shown, and still after the window.
    h.hass.states["media_player.c4_great_room"].attributes.volume_level = 0.39;
    s.update(apiOf(h, r.rc), lights);
    clk += 3500; s.update(apiOf(h, r.rc), lights);
    check("quick", c4() === row0 && num0.textContent === "39", num0.textContent);
    // A press Home Assistant never answers: the pressed level until the window ends, then Home Assistant's own again.
    await press(minus);
    check("quick", num0.textContent === "38", num0.textContent);
    clk += 2000; s.update(apiOf(h, r.rc), lights);
    check("quick", num0.textContent === "38", num0.textContent);
    clk += 1200;
    await flush(4);                                                    // the window's own timer, nothing else needed
    check("quick", num0.textContent === "39", num0.textContent);
    // Changed elsewhere (a keypad: 20, not on the way): Home Assistant's level at once.
    await press(plus);
    h.hass.states["media_player.c4_great_room"].attributes.volume_level = 0.2;
    s.update(apiOf(h, r.rc), lights);
    check("quick", num0.textContent === "20", num0.textContent);
    clk += 3500;
    // A player with its own volume_step steps by it.
    h.hass.states["media_player.c4_great_room"].attributes.volume_step = 0.02;
    s.update(apiOf(h, r.rc), lights);
    await press(byAria(c4(), "Great Room volume up"));
    check("quick", num(c4()).textContent === "22", num(c4()).textContent);
    // A VOLUME_SET player has no − or +: its slider (the "slider" case), its number in the row.
    const ks = rowOf(section(sheetNow(), "audio"), "media_player.kitchen_speaker");
    check("quick", !byAria(ks, "Kitchen speaker volume up") && num(ks).textContent === "20", words(ks));
    // Refused: the number goes back to Home Assistant's.
    clk += 3500;
    h.hass.refuse = "Control4 controller did not answer";
    await press(byAria(c4(), "Great Room volume down"));
    await tick();
    check("quick", num(c4()).textContent === "20", num(c4()).textContent);
    s.close(); reset();
  } finally { Date.now = realNow; }
});

// ── climate and shades ──
await tryCase("climate", async () => {
  const h = house();
  const r = controls(h, { matches: {} });
  reset();
  const s = LM.openRoomSheet(apiOf(h, r.rc), lightsOf(h), "Great Room");
  const cl = section(sheetNow(), "climate");
  const row = rowOf(cl, "climate.great_room");
  check("climate", all(row).map(n => n._text).filter(Boolean).join("|") === "Great Room thermostat|Heat|−|22°|+", all(row).map(n => n._text).filter(Boolean));
  // −, the setpoint and + as one group that never wraps; the section says Thermostats.
  const grp = all(row).find(n => n.attributes && n.attributes["data-setpoint"] === "target");
  check("climate", grp && /flex-wrap:nowrap/.test(grp.style.cssText) && words(grp).join() === "−,+" && cl.children[0].textContent === "Thermostats", grp && grp.style.cssText);
  await press(byAria(row, "Great Room thermostat cooler"));
  check("climate", JSON.stringify(h.calls) === JSON.stringify([{ domain: "climate", service: "set_temperature", entity_id: "climate.great_room", temperature: 21.5 }]), h.calls);
  h.hass.states["climate.great_room"].attributes.target_temp_step = 1;
  s.update(apiOf(h, r.rc), lightsOf(h));
  await press(byAria(rowOf(section(sheetNow(), "climate"), "climate.great_room"), "Great Room thermostat warmer"));
  // From what the − showed (21.5) until Home Assistant says otherwise, by the new step.
  check("climate", h.calls[1] && h.calls[1].temperature === 22.5, h.calls);
  check("climate", r.counts.filter(w => w === "climate").length === 2, r.counts);
  s.close(); reset();
});
await tryCase("covers", async () => {
  const h = house();
  const r = controls(h, { matches: {} });
  reset();
  const s = LM.openRoomSheet(apiOf(h, r.rc), lightsOf(h), "Great Room");
  const sh = section(sheetNow(), "shades");
  // A row per blind (the right one is in the room through its device), then All; the garage door is never a shade.
  check("covers", sh.children.length === 4 && all(sh).map(n => n._text).filter(Boolean).join("|")
    === "Shades|Left blind|100 % open|Open|Stop|Close|Right blind|0 % open|Open|Close|All shades|Open|Stop|Close", all(sh).map(n => n._text).filter(Boolean));
  const allRow = all(sh).find(n => n.attributes && n.attributes["data-shades-all"] !== undefined);
  await press(byText(rowOf(sh, "cover.great_room_right"), "Open"));
  await press(byText(allRow, "Open"));
  await press(byText(allRow, "Stop"));
  await press(byText(allRow, "Close"));
  check("covers", JSON.stringify(h.calls) === JSON.stringify([
    { domain: "cover", service: "open_cover", entity_id: "cover.great_room_right" },
    { domain: "cover", service: "open_cover", entity_id: ["cover.great_room_left", "cover.great_room_right"] },
    { domain: "cover", service: "stop_cover", entity_id: "cover.great_room_left" },
    { domain: "cover", service: "close_cover", entity_id: ["cover.great_room_left", "cover.great_room_right"] }]), h.calls);
  check("covers", r.counts.filter(w => w === "cover").length === 4, r.counts);
  // Open, Stop and Close stay together on one line (a narrow panel wrapped Close onto its own).
  check("covers", all(sh).filter(n => n.attributes && (n.attributes["data-eid"] || n.attributes["data-shades-all"] !== undefined) && n.localName === "div")
    .every(rw => { const g = rw.children[rw.children.length - 1]; return /flex-wrap:nowrap/.test(g.style.cssText) && g.children.every(b => b.localName === "button"); }), "the buttons split");
  // One shade: its own row, no All; no position: its state in words.
  delete h.hass.states["cover.great_room_right"];
  h.hass.states["cover.great_room_left"] = ST("cover.great_room_left", "closed", { friendly_name: "Left blind", supported_features: 1 | 2 });
  const one = r.rc.sheet("Great Room", { parts: { audio: false, shades: true, climate: false } }).after.draw();
  check("covers", all(one).map(n => n._text).filter(Boolean).join("|") === "Shades|Left blind|closed|Open|Close", all(one).map(n => n._text).filter(Boolean));
  s.close(); reset();
  // The garage: its door is no shade, so the sheet has none.
  const g = LM.openRoomSheet(apiOf(h, r.rc), lightsOf(h), "Garage");
  check("covers", !section(sheetNow(), "shades") && !section(sheetNow(), "climate"), "the garage got a section");
  g.close(); reset();
});

// ── matching: the card's guesses, its order, its save; first opening; an administrator's only ──
await tryCase("match", async () => {
  const h = house();
  const r = controls(h, { matches: {} });
  reset();
  // Match rooms is never in a room's card (the ⋯ list's Set up › opens it): a room with no player has no Audio part.
  const s = LM.openRoomSheet(apiOf(h, r.rc), lightsOf(h), "Kitchen");
  check("match", !section(sheetNow(), "audio") && !all(sheetNow()).some(n => n.attributes && n.attributes["data-room-match"] !== undefined), "Match rooms in the card");
  const card = () => document.body.children.find(n => all(n).some(x => x.attributes && x.attributes["data-room-match-card"] !== undefined));
  {
    // Control4 and Denon here: "Match rooms"; a house with Control4 alone says so.
    const h4 = house(); delete h4.hass.states["media_player.denon_zone_2"];
    const r4 = controls(h4, { matches: {} });
    r4.rc.openMatch();
    check("match", all(card()).map(x => x._text).filter(Boolean)[0] === "Match Control4 to HA", all(card()).map(x => x._text).filter(Boolean).slice(0, 2));
    r4.rc.close();
  }
  r.rc.openMatch(); await tick();
  check("match", !!card() && r.counts.includes("match_open"), r.counts);
  const sel = (eid) => all(card()).find(n => n.localName === "select" && rowOf(card(), eid) && rowOf(card(), eid).contains(n));
  // Its guesses: Denon by its Home Assistant area, Control4's "Alex’s office" by name.
  check("match", sel("media_player.c4_great_room").value === "great_room" && sel("media_player.denon_zone_2").value === "great_room" && sel("media_player.c4_office").value === "office",
    ["c4_great_room", "denon_zone_2", "c4_office"].map(e => sel("media_player." + e).value));
  check("match", all(card()).filter(n => n.localName === "select")[0].children.map(o => o.textContent).join() === "Not on the map,Alex's Office,Garage,Great Room,Kitchen");
  // Two in the great room: the first is marked, and ▼ on it puts the Denon first.
  const c4row = rowOf(card(), "media_player.c4_great_room");
  check("match", all(c4row).some(n => n._text === "First in this room"), all(c4row).map(n => n._text));
  await press(byAria(c4row, "Later in this room"));
  check("match", all(rowOf(card(), "media_player.denon_zone_2")).some(n => n._text === "First in this room"), "▼ did not move it");
  // The office's player to the kitchen; the HA speakers option stays off.
  const so = sel("media_player.c4_office"); so.value = "kitchen"; so.dispatchEvent({ type: "change" }); await tick();
  // Every pick is kept as it is made (no Save to forget): its guesses as it opened, then ▼, then the office's room.
  check("match", r.saved.length === 3 && JSON.stringify(r.saved[2]) === JSON.stringify({ room_audio_matches: { great_room: ["media_player.denon_zone_2", "media_player.c4_great_room"], kitchen: ["media_player.c4_office"] }, room_audio_ha_speakers: false, room_audio_matched: true }), r.saved);
  { const m0 = r.saved[0].room_audio_matches;
    check("match", Object.keys(m0).length === 2 && m0.great_room.join() === "media_player.c4_great_room,media_player.denon_zone_2" && m0.office.join() === "media_player.c4_office", r.saved[0]); }
  const stat = () => all(card()).find(n => n.attributes && n.attributes["data-room-match-status"] !== undefined).textContent;
  check("match", stat() === "Saved" && r.counts.filter(w => w === "match_saved").length === 1, [stat(), r.counts]);
  check("match", !all(card()).some(n => n.localName === "button" && (n.textContent === "Save" || n.textContent === "Cancel")), "a Save or Cancel is still there");
  await press(btn(card(), b => b.attributes["data-room-match-done"] !== undefined));
  check("match", !card(), "Done left the card open");
  s.close(); reset();
  // Saved: the card opens on what was saved, not on guesses; a room without a player has no Audio now.
  const k = LM.openRoomSheet(apiOf(h, r.rc), lightsOf(h), "Garage");
  check("match", !section(sheetNow(), "audio"), "an empty room kept its Audio");
  k.close(); reset();
  r.rc.openMatch();
  check("match", sel("media_player.c4_office").value === "kitchen", sel("media_player.c4_office").value);
  // Home Assistant's speakers: ticked, the Cast speaker is offered too, under their own heading.
  const cb = all(card()).find(n => n.attributes && n.attributes["data-ha-speakers"] !== undefined);
  cb.checked = true; cb.dispatchEvent({ type: "change" }); await tick();
  check("match", !!rowOf(card(), "media_player.kitchen_speaker") && all(card()).some(n => n._text === "Home Assistant speakers"), "no HA speaker row");
  r.rc.close();
  check("match", !card(), "the card stayed");
  reset();
});
await tryCase("first-time", async () => {
  const h = house();
  let r = controls(h, { matches: {} });
  reset();
  r.rc.switched(true);
  check("first-time", document.body.children.length === 1 && r.counts.join() === "match_open", r.counts);
  r.rc.close(); reset();
  r.rc.switched(false);
  check("first-time", document.body.children.length === 0, "turning it off opened the card");
  r = controls(h, { matches: { great_room: ["media_player.c4_great_room"] } });
  r.rc.switched(true);
  check("first-time", document.body.children.length === 0, "a house with matches got the card again");
  r = controls(h, { matches: {}, admin: false });
  r.rc.switched(true);
  r.rc.openMatch();
  check("first-time", document.body.children.length === 0 && r.counts.length === 0, "a non-administrator got the card");
  reset();
});
// ── cleared: every player taken off the map stays so: no guesses again, no card by itself, no button in every room ──
await tryCase("cleared", async () => {
  const h = house();
  const r = controls(h, { matches: {} });
  reset();
  r.rc.openMatch(); await tick();
  const card = () => document.body.children.find(n => all(n).some(x => x.attributes && x.attributes["data-room-match-card"] !== undefined));
  const sels = () => all(card()).filter(n => n.localName === "select");
  check("cleared", r.saved.length === 1 && r.saved[0].room_audio_matched === true && Object.keys(r.saved[0].room_audio_matches).length === 2, r.saved);
  for (const sl of sels()) { sl.value = ""; sl.dispatchEvent({ type: "change" }); await tick(); }
  const last = r.saved[r.saved.length - 1];
  check("cleared", JSON.stringify(last) === JSON.stringify({ room_audio_matches: {}, room_audio_ha_speakers: false, room_audio_matched: true }), last);
  r.rc.close();
  const n = r.saved.length;
  r.rc.openMatch(); await tick();
  check("cleared", r.saved.length === n && sels().every(sl => sl.value === ""), [r.saved.length - n, sels().map(sl => sl.value)]);
  r.rc.close(); reset();
  r.rc.switched(true);
  check("cleared", document.body.children.length === 0 && JSON.stringify(r.rc.looks()) === "{}", "the card opened by itself, or a speaker is back");
  const sh = r.rc.sheet("Kitchen");
  check("cleared", sh.before === null, "a cleared house shows the match button in every room again");
  // A house from before the flag with matches kept is set up too: never the guesses.
  const old = controls(house(), { matches: { great_room: ["media_player.c4_great_room"] } });
  old.rc.openMatch(); await tick();
  check("cleared", old.saved.length === 0, old.saved);
  old.rc.close(); reset();
});
// ── kept: a pick never drops a match the card can't show now (a player gone for now, a hidden one, a Home Assistant
// speaker while those are not offered, a room whose map name differs) ──
await tryCase("kept", async () => {
  const h = house();
  h.hass.entities["media_player.c4_office"].hidden = true;
  delete h.hass.states["media_player.denon_zone_2"];
  const was = { great_room: ["media_player.c4_great_room", "media_player.denon_zone_2"], office: ["media_player.c4_office"],
                kitchen: ["media_player.kitchen_speaker"], den_renamed: ["media_player.c4_den"] };
  const r = controls(h, { matches: was });
  r.settings.room_audio_matched = true;
  reset();
  r.rc.openMatch(); await tick();
  const card = document.body.children.find(n => all(n).some(x => x.attributes && x.attributes["data-room-match-card"] !== undefined));
  const sl = all(card).find(n => n.localName === "select" && rowOf(card, "media_player.c4_great_room") && rowOf(card, "media_player.c4_great_room").contains(n));
  sl.value = "kitchen"; sl.dispatchEvent({ type: "change" }); await tick();
  const got = r.saved[r.saved.length - 1].room_audio_matches;
  check("kept", JSON.stringify(got) === JSON.stringify({ great_room: ["media_player.denon_zone_2"], office: ["media_player.c4_office"],
    kitchen: ["media_player.kitchen_speaker", "media_player.c4_great_room"], den_renamed: ["media_player.c4_den"] }), got);
  r.rc.close(); reset();
  // A player matched to an area no room on the map is: its list says "Not on the map", never blank.
  const h2 = house();
  const r2 = controls(h2, { matches: { den_renamed: ["media_player.c4_office"] } });
  r2.rc.openMatch(); await tick();
  const c2 = document.body.children.find(n => all(n).some(x => x.attributes && x.attributes["data-room-match-card"] !== undefined));
  const s2 = all(c2).find(n => n.localName === "select" && rowOf(c2, "media_player.c4_office").contains(n));
  check("kept", s2.value === "" && s2.children[0].textContent === "Not on the map", s2.value);
  r2.rc.close(); reset();
});
await tryCase("non-admin", async () => {
  const h = house();
  const r = controls(h, { matches: { great_room: ["media_player.c4_great_room"] }, admin: false });
  reset();
  const s = LM.openRoomSheet(apiOf(h, r.rc), lightsOf(h), "Great Room");
  const a = section(sheetNow(), "audio");
  check("non-admin", !btn(a, b => b.attributes["data-room-match"] !== undefined), "Match rooms in the card");
  // The ⋯ line's Set up › is offered by this (lights_map.js audioSetup): an administrator's only.
  check("non-admin", r.rc.canMatch() === false && controls(house()).rc.canMatch() === true, "canMatch is not the administrator's");
  // The controls themselves are for everyone, as the lights are.
  await press(byAria(rowOf(a, "media_player.c4_great_room"), "Great Room volume up"));
  check("non-admin", h.calls.length === 1, h.calls);
  s.close(); reset();
});

// ── the full card (the owner, 2026-11-26: "full audio control in a room ... source and audio mode control, and surround
// and eq options"): each part only where the player supports it ──
Object.assign(F, { PAUSE: 1, PREV: 16, NEXT: 32, ON: 128, SRC: 2048, STOP: 4096, PLAY: 16384, MODE: 65536, GROUP: 524288 });
function addPlayer(h, eid, platform, state, attributes, device_id = null) {
  h.hass.states[eid] = ST(eid, state, attributes);
  h.hass.entities[eid] = { entity_id: eid, platform, area_id: null, device_id };
}
function addEntity(h, eid, platform, device_id, state, attributes = {}, reg = {}) {
  h.hass.states[eid] = ST(eid, state, attributes);
  h.hass.entities[eid] = { entity_id: eid, platform, area_id: null, device_id, ...reg };
}
const AUDIO_ONLY = { audio: true, shades: false, climate: false };
const drawAudio = (r, room = "Great Room") => r.rc.sheet(room, { parts: AUDIO_ONLY }).before.draw();
const q = (root, attr, val) => all(root).find(n => n.attributes && n.attributes[attr] !== undefined && (val === undefined || n.attributes[attr] === val));
const dlg = (attr) => document.body.children.find(n => all(n).some(x => x.attributes && x.attributes[attr] !== undefined));
const texts = (n) => all(n).map(x => x._text).filter(Boolean);
const sent = (h, from) => h.calls.slice(from).map(c => `${c.domain}.${c.service}`).join();
const fire = async (n, type) => { n.dispatchEvent({ type, stopPropagation() {}, preventDefault() {} }); await tick(); await tick(); };

await tryCase("transport", async () => {
  const h = house();
  const T = F.PLAY | F.PAUSE | F.PREV | F.NEXT | F.SET | F.MUTE | F.OFF;
  addPlayer(h, "media_player.sonos_great", "sonos", "playing", { friendly_name: "Sonos", volume_level: 0.3, supported_features: T,
    media_title: "So What", media_artist: "Miles Davis", entity_picture: "/api/media_player_proxy/media_player.sonos_great?token=abc" });
  const r = controls(h, { matches: { great_room: ["media_player.c4_great_room", "media_player.sonos_great"] }, ha: true });
  const son = h.hass.states["media_player.sonos_great"];
  const now = () => q(drawAudio(r), "data-audio-now", "media_player.sonos_great");
  const tr = () => q(drawAudio(r), "data-audio-transport", "media_player.sonos_great");
  // What is playing: the picture as it is (same-origin, relative), the title, the artist.
  const n0 = now(), img = all(n0).find(n => n.localName === "img");
  check("transport", img && img.src === "/api/media_player_proxy/media_player.sonos_great?token=abc", img && img.src);
  check("transport", texts(n0).slice(0, 2).join("|") === "So What|Miles Davis", texts(n0));
  await fire(img, "error");
  check("transport", img.style.display === "none", "a picture that fails stays");
  // Playing with play and pause: one toggle.
  check("transport", words(tr()).join() === "⏮,⏸,⏭", words(tr()));
  let n = h.calls.length; await press(byText(tr(), "⏸"));
  check("transport", sent(h, n) === "media_player.media_play_pause" && h.calls[n].entity_id === "media_player.sonos_great", h.calls.slice(n));
  n = h.calls.length; await press(byText(tr(), "⏭")); await press(byText(tr(), "⏮"));
  check("transport", sent(h, n) === "media_player.media_next_track,media_player.media_previous_track", sent(h, n));
  son.state = "paused";
  check("transport", words(tr()).join() === "⏮,▶,⏭", words(tr()));
  n = h.calls.length; await press(byText(tr(), "▶"));
  check("transport", sent(h, n) === "media_player.media_play_pause", sent(h, n));
  // Only "on" (or idle) with both: ▶ and ⏸ apart, as a toggle would always send play.
  son.state = "on";
  check("transport", words(tr()).join() === "⏮,▶,⏸,⏭", words(tr()));
  n = h.calls.length; await press(byText(tr(), "▶")); await press(byText(tr(), "⏸"));
  check("transport", sent(h, n) === "media_player.media_play,media_player.media_pause", sent(h, n));
  check("transport", !q(now(), "src") && !all(now()).some(x => x.localName === "img"), "a picture while not playing");
  // Play alone, and stop where there is no pause.
  son.attributes.supported_features = F.PLAY | F.STOP | F.SET; son.state = "idle";
  check("transport", words(tr()).join() === "▶,⏹", words(tr()));
  n = h.calls.length; await press(byText(tr(), "⏹"));
  check("transport", sent(h, n) === "media_player.media_stop", sent(h, n));
  son.state = "playing";
  check("transport", words(tr()).join() === "⏹", words(tr()));
  // No artist: the app's name under the title.
  son.attributes.supported_features = T; delete son.attributes.media_artist; delete son.attributes.entity_picture; son.attributes.app_name = "Spotify";
  check("transport", texts(now()).slice(0, 2).join("|") === "So What|Spotify", texts(now()));
  // Off: neither (its attributes are gone too).
  son.state = "off";
  check("transport", !now() && !tr(), "an off player kept its now playing");
  // A Control4 room (only ever on or off) with play, pause and stop: ▶, ⏸ and ⏹ apart.
  h.hass.states["media_player.c4_great_room"].attributes.supported_features = C4 | F.PLAY | F.PAUSE | F.STOP;
  const c4 = q(drawAudio(r), "data-audio-transport", "media_player.c4_great_room");
  check("transport", words(c4).join() === "▶,⏸,⏹", words(c4));
  check("transport", r.counts.filter(w => ["play", "pause", "next", "previous"].includes(w)).join() === "pause,next,previous,play,play,pause,pause", r.counts);
});

await tryCase("scan", async () => {
  const h = house();
  h.hass.states["media_player.c4_great_room"].attributes.supported_features = C4 | F.PREV | F.NEXT;
  const r = controls(h, { matches: { great_room: ["media_player.c4_great_room", "media_player.denon_zone_2"] } });
  const tr = (eid) => q(drawAudio(r), "data-audio-transport", eid);
  h.hass.services = { control4: { media_scan: {} }, media_player: {} };
  // A room that doesn't play (no play, no pause): no ⏪ or ⏩, whatever the service.
  check("scan", words(tr("media_player.c4_great_room")).join() === "⏮,⏭", words(tr("media_player.c4_great_room")));
  h.hass.states["media_player.c4_great_room"].attributes.supported_features = C4 | F.PREV | F.NEXT | F.PLAY | F.PAUSE;
  // No control4.media_scan in this Home Assistant: no ⏪ or ⏩.
  delete h.hass.services.control4;
  check("scan", words(tr("media_player.c4_great_room")).join() === "⏮,▶,⏸,⏭", words(tr("media_player.c4_great_room")));
  h.hass.services.control4 = { media_scan: {} };
  check("scan", words(tr("media_player.c4_great_room")).join() === "⏮,⏪,▶,⏸,⏩,⏭", words(tr("media_player.c4_great_room")));
  // Drawn as text: every transport glyph ends in U+FE0E.
  check("scan", all(tr("media_player.c4_great_room")).filter(x => x.localName === "button").every(b => b.textContent.endsWith(FE0E)), "a glyph drawn as emoji");
  const n = h.calls.length;
  await press(byAria(tr("media_player.c4_great_room"), "Great Room rewind"));
  await press(byAria(tr("media_player.c4_great_room"), "Great Room fast-forward"));
  check("scan", JSON.stringify(h.calls.slice(n)) === JSON.stringify([
    { domain: "control4", service: "media_scan", entity_id: "media_player.c4_great_room", direction: "back" },
    { domain: "control4", service: "media_scan", entity_id: "media_player.c4_great_room", direction: "forward" }]), h.calls.slice(n));
  check("scan", r.counts.filter(w => w === "scan").length === 2, r.counts);
  // Never a player of another integration, and never a room that is off.
  h.hass.states["media_player.denon_zone_2"].attributes.supported_features = FULL | F.NEXT;
  check("scan", words(tr("media_player.denon_zone_2")).join() === "⏭", words(tr("media_player.denon_zone_2")));
  h.hass.states["media_player.c4_great_room"].state = "off";
  check("scan", !tr("media_player.c4_great_room"), "an off room has ⏪ ⏩");
});

// ── the slider: a plain range input; at most every 250 ms while dragged, the last value on letting go; never drawn
// again under the finger; capped by the limit ──
await tryCase("slider", async () => {
  const realNow = Date.now;
  let clk = 0;
  Date.now = () => realNow() + clk;
  try {
    const h = house();
    const r = controls(h, { matches: { great_room: ["media_player.denon_zone_2"] } });
    reset();
    const lights = lightsOf(h);
    const s = LM.openRoomSheet(apiOf(h, r.rc), lights, "Great Room");
    const sec0 = section(sheetNow(), "audio"), row = rowOf(sec0, "media_player.denon_zone_2");
    const sl = q(sec0, "data-slider", "media_player.denon_zone_2"), num = all(row).find(n => n.attributes["data-level"] !== undefined);
    check("slider", sl && sl.localName === "input" && sl.type === "range" && sl.min === "0" && sl.max === "100" && sl.value === "50", sl && [sl.type, sl.max, sl.value]);
    check("slider", /touch-action:pan-y/.test(sl.style.cssText) && /min-height:36px|height:36px/.test(sl.style.cssText), sl.style.cssText);
    // A Denon sets and steps: its slider, and − and + beside the number.
    check("slider", words(row).join() === "Mute,−,+,⏻" && num.textContent === "50", words(row));
    const sets = () => h.calls.filter(c => c.service === "volume_set").map(c => c.volume_level);
    await fire(sl, "pointerdown");
    sl.value = "60"; await fire(sl, "input");
    check("slider", num.textContent === "60" && sets().join() === "0.6", [num.textContent, sets()]);
    clk += 100; sl.value = "65"; await fire(sl, "input");
    clk += 50; sl.value = "70"; await fire(sl, "input");
    check("slider", num.textContent === "70" && sets().join() === "0.6", [num.textContent, sets()]);       // held back
    // Home Assistant says something new meanwhile (another level, a new source): nothing is drawn again, the number
    // keeps the dragged level.
    h.hass.states["media_player.denon_zone_2"].attributes.volume_level = 0.3;
    h.hass.states["media_player.denon_zone_2"].attributes.source = "TV";
    s.update(apiOf(h, r.rc), lights);
    check("slider", section(sheetNow(), "audio") === sec0 && num.textContent === "70" && sl.value === "70", "drawn again under the finger");
    await flush(4, 300);                                                    // the 250 ms one: the latest level
    check("slider", sets().join() === "0.6,0.7", sets());
    clk += 300; sl.value = "72"; await fire(sl, "input");
    check("slider", sets().join() === "0.6,0.7,0.72", sets());
    sl.value = "75"; await fire(sl, "change"); await fire(sl, "pointerup");
    check("slider", sets().join() === "0.6,0.7,0.72,0.75" && r.counts.filter(w => w === "slider").length === 1, [sets(), r.counts]);
    check("slider", r.counts.filter(w => w !== "on" && w !== "slider").length === 0, r.counts);
    // Let go, still the let-go level for a while (Home Assistant still says 0.3), and the same sheet.
    s.update(apiOf(h, r.rc), lights);
    check("slider", section(sheetNow(), "audio") === sec0 && num.textContent === "75", num.textContent);
    // After the window: drawn again, Home Assistant's level.
    clk += 3500;
    s.update(apiOf(h, r.rc), lights);
    const sec1 = section(sheetNow(), "audio");
    check("slider", sec1 !== sec0 && all(rowOf(sec1, "media_player.denon_zone_2")).find(n => n.attributes["data-level"] !== undefined).textContent === "30"
      && q(sec1, "data-slider").value === "30", "not drawn again after the window");
    s.close(); reset();
    // A press that changes nothing sends nothing.
    const n = h.calls.length;
    const sl2 = q(drawAudio(r), "data-slider");
    await fire(sl2, "pointerdown"); await fire(sl2, "pointerup");
    check("slider", h.calls.length === n, h.calls.slice(n));
    // Off (no level): no slider.
    clk += 3500;
    h.hass.states["media_player.denon_zone_2"].state = "off"; delete h.hass.states["media_player.denon_zone_2"].attributes.volume_level;
    check("slider", !q(drawAudio(r), "data-slider"), "an off player has a slider");
  } finally { Date.now = realNow; }
});

// ── the limit: the slider stops at it, + is greyed at it, a level set is capped ──
await tryCase("limit", async () => {
  const realNow = Date.now;
  let clk = 0;
  Date.now = () => realNow() + clk;
  try {
    const h = house();
    h.hass.states["media_player.c4_great_room"].attributes.volume_level = 0.49;
    const r = controls(h, { matches: { great_room: ["media_player.c4_great_room", "media_player.denon_zone_2"] },
      limits: { "media_player.c4_great_room": 0.5, "media_player.denon_zone_2": 0.4 } });
    const sec = drawAudio(r);
    const sl = q(sec, "data-slider", "media_player.denon_zone_2");
    // 0 to 100 whatever the limit (the knob sits at the level, never stretched); the part past 40 marked; 0.5 now: at 40.
    const mark = all(sec).find(n => n.attributes && n.attributes["data-limit-mark"] !== undefined);
    check("limit", sl.max === "100" && sl.value === "40" && mark && mark.attributes["data-limit-mark"] === "40" && /left:calc\(8px \+ \(100% - 16px\) \* 0\.4\)/.test(mark.style.cssText),
      [sl.max, sl.value, mark && mark.style.cssText]);
    sl.value = "90"; await fire(sl, "input");
    check("limit", sl.value === "40", sl.value);                                                // the knob stops at the limit
    await fire(sl, "change");
    check("limit", h.calls.filter(c => c.service === "volume_set").every(c => c.volume_level <= 0.4) && h.calls.some(c => c.volume_level === 0.4), h.calls);
    // − and + (Control4): one press to the limit, then + is greyed and asks nothing.
    const c4 = rowOf(sec, "media_player.c4_great_room"), plus = byAria(c4, "Great Room volume up");
    const lvl = all(c4).find(n => n.attributes["data-level"] !== undefined);
    check("limit", !plus.disabled, "greyed below the limit");
    await press(plus);
    check("limit", lvl.textContent === "50" && plus.disabled === true, [lvl.textContent, plus.disabled]);
    const n = h.calls.length;
    await press(plus);
    check("limit", h.calls.length === n && lvl.textContent === "50", h.calls.slice(n));
    // Drawn at the limit: greyed from the start; − still steps.
    clk += 3500;
    h.hass.states["media_player.c4_great_room"].attributes.volume_level = 0.5;
    const c4b = rowOf(drawAudio(r), "media_player.c4_great_room");
    check("limit", byAria(c4b, "Great Room volume up").disabled === true && byAria(c4b, "Great Room volume down").disabled === false, "not greyed at the limit");
    check("limit", JSON.stringify(RC.cleanLimits({ "media_player.a": 0.456, "media_player.b": 0.05, "media_player.c": "0.5", "light.d": 0.5, "media_player.e": 1 }))
      === JSON.stringify({ "media_player.a": 0.46, "media_player.e": 1 }), RC.cleanLimits({ "media_player.a": 0.456 }));
  } finally { Date.now = realNow; }
});

await tryCase("onoff", async () => {
  const h = house();
  addPlayer(h, "media_player.cast_great", "cast", "off", { friendly_name: "Nest", supported_features: F.SET | F.ON | F.OFF });
  h.hass.states["media_player.c4_great_room"].state = "off";
  h.hass.states["media_player.c4_great_room"].attributes.supported_features = C4 | F.ON;
  const r = controls(h, { matches: { great_room: ["media_player.c4_great_room", "media_player.cast_great"] }, ha: true });
  let cast = rowOf(drawAudio(r), "media_player.cast_great");
  check("onoff", words(cast).join() === "On", words(cast));                 // off: On alone
  const n = h.calls.length;
  await press(byAria(cast, "Turn Nest on"));
  check("onoff", JSON.stringify(h.calls.slice(n)) === JSON.stringify([{ domain: "media_player", service: "turn_on", entity_id: "media_player.cast_great" }]), h.calls.slice(n));
  // On: ⏻, no On.
  h.hass.states["media_player.cast_great"].state = "idle";
  cast = rowOf(drawAudio(r), "media_player.cast_great");
  check("onoff", words(cast).join() === "−,+,⏻", words(cast));
  const c4 = rowOf(drawAudio(r), "media_player.c4_great_room");
  // Off: nothing but On, and a Control4 room has no On (nor a greyed ⏻): its sources start it.
  check("onoff", words(c4).join() === "", words(c4));
});

await tryCase("sources", async () => {
  const h = house();
  const den = h.hass.states["media_player.denon_zone_2"];
  den.attributes.supported_features = FULL | F.SRC; den.attributes.source_list = ["TV", "Bluray", "Phono"]; den.attributes.source = "TV";
  let r = controls(h, { matches: { great_room: ["media_player.denon_zone_2"] } });
  const line = () => q(drawAudio(r), "data-audio-source", "media_player.denon_zone_2");
  // Up to four: chips, the current one marked.
  check("sources", words(line()).join() === "TV,Bluray,Phono" && byText(line(), "TV").attributes["aria-pressed"] === "true"
    && byText(line(), "Bluray").attributes["aria-pressed"] === "false", words(line()));
  let n = h.calls.length;
  await press(byText(line(), "TV"));                                          // the current one: nothing
  await press(byText(line(), "Bluray"));
  check("sources", JSON.stringify(h.calls.slice(n)) === JSON.stringify([{ domain: "media_player", service: "select_source", entity_id: "media_player.denon_zone_2", source: "Bluray" }]), h.calls.slice(n));
  check("sources", byText(line(), "Bluray").attributes["aria-pressed"] === "true", "the pick is not shown at once");
  check("sources", r.counts.filter(w => w === "source").length === 1, r.counts);
  // The owner's names, hidden ones and order.
  r = controls(h, { matches: { great_room: ["media_player.denon_zone_2"] }, sources: { "media_player.denon_zone_2": { names: { TV: "Television" }, hidden: ["Phono"], order: ["Bluray"] } } });
  check("sources", words(line()).join() === "Bluray,Television" && byText(line(), "Television").attributes["aria-pressed"] === "true", words(line()));
  // More than four: one button with the current one's name, opening the list; a filter box past eight.
  den.attributes.source_list = ["TV", "Bluray", "Phono", "CD", "Tuner", "AUX"];
  reset();
  const b = btn(line(), x => x.attributes["data-audio-list"] === "source");
  check("sources", b && b.textContent === "Television ›", b && b.textContent);
  await press(b);
  let card = dlg("data-audio-picker");
  check("sources", card && !q(card, "data-audio-filter") && all(card).filter(x => x.attributes && x.attributes["data-value"]).map(x => x.attributes["data-value"]).join() === "Bluray,TV,CD,Tuner,AUX", card && words(card));
  n = h.calls.length;
  await press(btn(card, x => x.attributes["data-value"] === "CD"));
  check("sources", !dlg("data-audio-picker") && h.calls.slice(n).map(c => c.source).join() === "CD", h.calls.slice(n));
  den.attributes.source_list = ["TV", "Bluray", "Phono", "CD", "Tuner", "AUX", "Net Radio", "Spotify", "Bluetooth", "USB"];
  await press(btn(line(), x => x.attributes["data-audio-list"] === "source"));
  card = dlg("data-audio-picker");
  const f = q(card, "data-audio-filter");
  f.value = "blu"; await fire(f, "input");
  check("sources", f && all(card).filter(x => x.attributes && x.attributes["data-value"]).map(x => x.attributes["data-value"]).join() === "Bluray,Bluetooth", words(card));
  r.rc.close();
  check("sources", !dlg("data-audio-picker"), "the picker stayed after close");
  // A Control4 room off offers its sources: picking one starts the room.
  h.hass.states["media_player.c4_great_room"].state = "off";
  Object.assign(h.hass.states["media_player.c4_great_room"].attributes, { supported_features: C4 | F.SRC, source_list: ["Apple TV", "Sonos"] });
  r = controls(h, { matches: { great_room: ["media_player.c4_great_room"] } });
  check("sources", words(q(drawAudio(r), "data-audio-source", "media_player.c4_great_room")).join() === "Apple TV,Sonos", "an off Control4 room has no sources");
  check("sources", JSON.stringify(RC.tidySources(["A", "B", "C"], { names: { C: "See" }, hidden: ["A"], order: ["C", "X"] })) === JSON.stringify([{ raw: "C", label: "See", hidden: false }, { raw: "B", label: "B", hidden: false }]));
  reset();
});

const DENON_MODES = ["DIRECT", "PURE DIRECT", "STEREO", "MCH STEREO", "ALL ZONE STEREO", "AUTO", "STANDARD", "MOVIE", "MUSIC", "GAME",
  "DOLBY DIGITAL", "DTS SURROUND", "AURO3D", "AURO2DSURR", "MATRIX", "VIRTUAL", "ROCK ARENA", "JAZZ CLUB", "SUPER STADIUM", "CLASSIC CONCERT",
  "WIDE SCREEN", "MONO MOVIE", "VIDEO GAME"];
await tryCase("modes", async () => {
  const h = house();
  const den = h.hass.states["media_player.denon_zone_2"];
  Object.assign(den.attributes, { supported_features: FULL | F.MODE, sound_mode_list: DENON_MODES, sound_mode: "MOVIE", sound_mode_raw: "Dolby Atmos" });
  const r = controls(h, { matches: { great_room: ["media_player.denon_zone_2"] } });
  reset();
  const line = () => q(drawAudio(r), "data-audio-mode", "media_player.denon_zone_2");
  check("modes", texts(line()).includes("Now: Dolby Atmos"), texts(line()));
  await press(btn(line(), x => x.attributes["data-audio-list"] === "mode"));
  const card = dlg("data-audio-picker");
  const heads = all(card).filter(x => x.style && /text-transform:uppercase/.test(x.style.cssText)).map(x => x._text);
  check("modes", heads.join() === "Direct,Stereo,Auto,\"Movie, music, game\",Decoders,DSP".replace(/"/g, "") && !!q(card, "data-audio-filter"), heads);
  const groups = Object.fromEntries(RC.groupModes(DENON_MODES).map(g => [g.label, g.items.join("|")]));
  check("modes", groups.Stereo === "STEREO|MCH STEREO|ALL ZONE STEREO" && groups["Movie, music, game"] === "MOVIE|MUSIC|GAME"
    && groups.Decoders === "DOLBY DIGITAL|DTS SURROUND|AURO3D|AURO2DSURR|MATRIX|VIRTUAL" && groups.DSP === "ROCK ARENA|JAZZ CLUB|SUPER STADIUM|CLASSIC CONCERT|WIDE SCREEN|MONO MOVIE|VIDEO GAME", groups);
  const n = h.calls.length;
  await press(btn(card, x => x.attributes["data-value"] === "STEREO"));
  check("modes", JSON.stringify(h.calls.slice(n)) === JSON.stringify([{ domain: "media_player", service: "select_sound_mode", entity_id: "media_player.denon_zone_2", sound_mode: "STEREO" }]), h.calls.slice(n));
  check("modes", r.counts.filter(w => w === "sound_mode").length === 1, r.counts);
  // A short list: chips, no groups.
  den.attributes.sound_mode_list = ["Music", "Movie", "Night"]; den.attributes.sound_mode = "Music"; delete den.attributes.sound_mode_raw;
  check("modes", words(line()).join() === "Music,Movie,Night", words(line()));
  // Off: no mode line.
  den.state = "off";
  check("modes", !line(), "an off player offers sound modes");
  reset();
});

await tryCase("sound", async () => {
  const h = house();
  addPlayer(h, "media_player.sonos_great", "sonos", "playing", { friendly_name: "Arc", volume_level: 0.3, supported_features: F.SET | F.MUTE }, "dev_arc");
  addEntity(h, "number.arc_bass", "sonos", "dev_arc", "3", { min: -10, max: 10, step: 1 }, { translation_key: "bass" });
  addEntity(h, "number.arc_treble", "sonos", "dev_arc", "0", { min: -10, max: 10, step: 1 }, { translation_key: "treble" });
  addEntity(h, "switch.arc_loudness", "sonos", "dev_arc", "on", {}, { translation_key: "loudness" });
  addEntity(h, "switch.arc_night_sound", "sonos", "dev_arc", "off", {}, { translation_key: "night_mode" });
  addEntity(h, "switch.arc_speech_enhancement", "sonos", "dev_arc", "off", {}, { translation_key: "dialog_level" });
  addEntity(h, "switch.arc_crossfade", "sonos", "dev_arc", "off", {}, { translation_key: "cross_fade" });          // not ours
  addEntity(h, "switch.arc_subwoofer", "sonos", "dev_arc", "on", {}, { translation_key: "sub_enabled", hidden: true }); // hidden
  addEntity(h, "number.other_bass", "sonos", "dev_other", "1", {}, { translation_key: "bass" });                      // another device
  addEntity(h, "number.arc_esphome_bass", "esphome", "dev_arc", "1", {}, { translation_key: "bass" });                // another integration
  const r = controls(h, { matches: { great_room: ["media_player.sonos_great", "media_player.c4_great_room", "media_player.denon_zone_2"] }, ha: true });
  check("sound", RC.soundControls(h.hass, "media_player.sonos_great").map(c => c.key).join() === "bass,treble,loudness,speech,night", RC.soundControls(h.hass, "media_player.sonos_great"));
  const sec = drawAudio(r);
  const sb = btn(sec, x => x.attributes["data-audio-sound-btn"] === "media_player.sonos_great");
  check("sound", sb && sb.textContent === "Sound ›" && !q(sec, "data-audio-sound"), "Sound is open before it is pressed");
  await press(sb);
  const part = q(sec, "data-audio-sound", "media_player.sonos_great");
  check("sound", part && sec.children.indexOf(part) === sec.children.indexOf(sb.parentNode) + 1 && sb.textContent === "Sound ⌄", "Sound did not open under its button");
  check("sound", part.children.map(x => x.attributes["data-sound"]).join() === "bass,treble,loudness,speech,night", part.children.map(x => x.attributes["data-sound"]));
  check("sound", texts(part.children[0]).join("|") === "Bass|−|3|+", texts(part.children[0]));
  let n = h.calls.length;
  await press(byAria(part, "Bass up"));
  await press(byText(part.children[2], "On"));                                // loudness on: off
  await press(byText(part.children[4], "Off"));                               // night off: on
  check("sound", JSON.stringify(h.calls.slice(n)) === JSON.stringify([
    { domain: "number", service: "set_value", entity_id: "number.arc_bass", value: 4 },
    { domain: "switch", service: "turn_off", entity_id: "switch.arc_loudness" },
    { domain: "switch", service: "turn_on", entity_id: "switch.arc_night_sound" }]), h.calls.slice(n));
  check("sound", r.counts.filter(w => w === "sound").length === 3, r.counts);
  // Kept open when drawn again; shown as pressed until Home Assistant says.
  const again = q(drawAudio(r), "data-audio-sound", "media_player.sonos_great");
  check("sound", again && texts(again.children[0]).includes("4"), again && texts(again.children[0]));
  // MusicCast: its numbers have no translation_key (by the end of their id), its selects do.
  addPlayer(h, "media_player.mc_great", "yamaha_musiccast", "on", { friendly_name: "RX-A", supported_features: F.SET }, "dev_mc");
  addEntity(h, "number.rx_a_main_tone_control_bass", "yamaha_musiccast", "dev_mc", "2", { min: -6, max: 6, step: 0.5 });
  addEntity(h, "select.rx_a_main_equalizer_mode", "yamaha_musiccast", "dev_mc", "auto", { options: ["manual", "auto", "bypass"] }, { translation_key: "zone_equalizer_mode" });
  addEntity(h, "switch.rx_a_main_pure_direct", "yamaha_musiccast", "dev_mc", "off");                                // not ours
  const mc = RC.soundControls(h.hass, "media_player.mc_great");
  check("sound", mc.map(c => `${c.key}:${c.eid}`).join() === "bass:number.rx_a_main_tone_control_bass,eq_mode:select.rx_a_main_equalizer_mode", mc);
  const r2 = controls(h, { matches: { great_room: ["media_player.mc_great"] }, ha: true });
  const s2 = drawAudio(r2);
  await press(btn(s2, x => x.attributes["data-audio-sound-btn"] === "media_player.mc_great"));
  const p2 = q(s2, "data-audio-sound");
  check("sound", texts(p2.children[0]).join("|") === "Bass|−|2.0|+", texts(p2.children[0]));
  const sel = all(p2).find(x => x.localName === "select");
  check("sound", sel.children.map(x => x.value).join() === "manual,auto,bypass" && sel.value === "auto", sel.value);
  n = h.calls.length;
  sel.value = "manual"; await fire(sel, "change");
  check("sound", JSON.stringify(h.calls.slice(n)) === JSON.stringify([{ domain: "select", service: "select_option", entity_id: "select.rx_a_main_equalizer_mode", option: "manual" }]), h.calls.slice(n));
  // A Denon: Dynamic EQ from its attribute, through denonavr.set_dynamic_eq.
  h.hass.states["media_player.denon_zone_2"].attributes.dynamic_eq = true;
  const s3 = drawAudio(r);
  await press(btn(s3, x => x.attributes["data-audio-sound-btn"] === "media_player.denon_zone_2"));
  const p3 = q(s3, "data-audio-sound", "media_player.denon_zone_2");
  check("sound", p3.children.map(x => x.attributes["data-sound"]).join() === "dynamic_eq", p3 && p3.children.length);
  n = h.calls.length;
  await press(byText(p3, "On"));
  check("sound", JSON.stringify(h.calls.slice(n)) === JSON.stringify([{ domain: "denonavr", service: "set_dynamic_eq", entity_id: "media_player.denon_zone_2", dynamic_eq: false }]), h.calls.slice(n));
  // Control4: nothing, no Sound button.
  check("sound", RC.soundControls(h.hass, "media_player.c4_great_room").length === 0 && !btn(drawAudio(r), x => x.attributes["data-audio-sound-btn"] === "media_player.c4_great_room"), "Control4 got a Sound");
  // Closed again in place.
  const s4 = drawAudio(r), sb4 = btn(s4, x => x.attributes["data-audio-sound-btn"] === "media_player.sonos_great");
  await press(sb4);
  check("sound", !q(s4, "data-audio-sound", "media_player.sonos_great") && sb4.textContent === "Sound ›", "Sound did not close");
});

await tryCase("share", async () => {
  const h = house();
  const G = F.SET | F.MUTE | F.GROUP;
  addPlayer(h, "media_player.sonos_great", "sonos", "playing", { friendly_name: "Arc", volume_level: 0.3, supported_features: G, group_members: ["media_player.sonos_great"] });
  addPlayer(h, "media_player.sonos_kitchen", "sonos", "idle", { friendly_name: "One", volume_level: 0.6, supported_features: G, group_members: ["media_player.sonos_kitchen"] });
  addPlayer(h, "media_player.cast_office", "cast", "idle", { friendly_name: "Nest", volume_level: 0.2, supported_features: G });            // another platform
  addPlayer(h, "media_player.sonos_garage", "sonos", "idle", { friendly_name: "Play:1", volume_level: 0.2, supported_features: F.SET });  // no grouping
  const r = controls(h, { matches: { great_room: ["media_player.sonos_great"], kitchen: ["media_player.sonos_kitchen"], office: ["media_player.cast_office"],
    garage: ["media_player.sonos_garage"] }, ha: true, limits: { "media_player.sonos_kitchen": 0.4 } });
  reset();
  const sb = btn(drawAudio(r), x => x.attributes["data-audio-share-btn"] === "media_player.sonos_great");
  check("share", !!sb && !btn(drawAudio(r, "Garage"), x => x.attributes["data-audio-share-btn"] !== undefined), "Share ›");
  await press(sb);
  const card = () => dlg("data-audio-share");
  check("share", all(card()).filter(x => x.localName === "div" && x.attributes["data-eid"]).map(x => x.attributes["data-eid"]).join() === "media_player.sonos_kitchen", texts(card()));
  let cb = all(card()).find(x => x.localName === "input" && x.type === "checkbox");
  check("share", cb.checked === false && cb.attributes["aria-label"] === "Play in Kitchen", cb.attributes);
  let n = h.calls.length;
  cb.checked = true; await fire(cb, "change");
  check("share", JSON.stringify(h.calls.slice(n)) === JSON.stringify([{ domain: "media_player", service: "join", entity_id: "media_player.sonos_great", group_members: ["media_player.sonos_kitchen"] }]), h.calls.slice(n));
  // Ticked: the room's own slider, capped by its limit.
  const ks = q(card(), "data-slider", "media_player.sonos_kitchen");
  check("share", ks && ks.max === "100" && ks.value === "40" && all(dlg("data-audio-share")).some(n => n.attributes && n.attributes["data-limit-mark"] === "40"), ks && [ks.max, ks.value]);
  // One line: the room's name, its slider and its level never wrap.
  check("share", /flex-wrap:nowrap/.test(rowOf(dlg("data-audio-share"), "media_player.sonos_kitchen").style.cssText), "the row wraps");
  n = h.calls.length;
  ks.value = "30"; await fire(ks, "input"); await fire(ks, "change");
  check("share", h.calls.slice(n).map(c => `${c.service}:${c.entity_id}:${c.volume_level}`).join() === "volume_set:media_player.sonos_kitchen:0.3", h.calls.slice(n));
  cb = all(card()).find(x => x.localName === "input" && x.type === "checkbox");
  n = h.calls.length;
  cb.checked = false; await fire(cb, "change");
  check("share", JSON.stringify(h.calls.slice(n)) === JSON.stringify([{ domain: "media_player", service: "unjoin", entity_id: "media_player.sonos_kitchen" }]), h.calls.slice(n));
  r.rc.close();
  // Grouped in Home Assistant: "with Kitchen" in the row; the card ticked; Leave group unjoins this one.
  h.hass.states["media_player.sonos_great"].attributes.group_members = ["media_player.sonos_great", "media_player.sonos_kitchen"];
  const sec = drawAudio(r);
  check("share", (q(sec, "data-audio-group", "media_player.sonos_great") || {}).textContent === "with Kitchen", texts(sec));
  await press(btn(sec, x => x.attributes["data-audio-share-btn"] === "media_player.sonos_great"));
  check("share", all(card()).find(x => x.localName === "input" && x.type === "checkbox").checked === true, "not ticked");
  n = h.calls.length;
  await press(btn(card(), x => x.attributes["data-audio-leave"] !== undefined));
  check("share", JSON.stringify(h.calls.slice(n)) === JSON.stringify([{ domain: "media_player", service: "unjoin", entity_id: "media_player.sonos_great" }]), h.calls.slice(n));
  check("share", r.counts.filter(w => w === "share" || w === "unshare").join() === "share,unshare,unshare", r.counts);
  r.rc.close(); reset();
});

await tryCase("all-off", async () => {
  const h = house();
  addPlayer(h, "media_player.sonos_kitchen", "sonos", "playing", { friendly_name: "One", supported_features: F.PLAY | F.PAUSE | F.SET });
  addPlayer(h, "media_player.dlna_office", "dlna_dmr", "playing", { friendly_name: "Radio", supported_features: F.PLAY | F.STOP | F.STEP });
  addPlayer(h, "media_player.cast_garage", "cast", "off", { friendly_name: "Nest", supported_features: F.SET | F.OFF });
  const r = controls(h, { matches: { great_room: ["media_player.c4_great_room", "media_player.denon_zone_2"], kitchen: ["media_player.sonos_kitchen"],
    office: ["media_player.dlna_office"], garage: ["media_player.cast_garage"] }, ha: true });
  const sec = drawAudio(r);
  const wrap = q(sec, "data-audio-all-off");
  check("all-off", wrap && words(wrap).join() === "Any audio in house off" && sec.children[sec.children.length - 1] === wrap, wrap && words(wrap));
  const n = h.calls.length;
  await press(byText(wrap, "Any audio in house off"));
  check("all-off", texts(wrap).includes("Turn off every room's audio?") && words(wrap).join() === "Turn off,Cancel" && h.calls.length === n, texts(wrap));
  await press(byText(wrap, "Cancel"));
  check("all-off", words(wrap).join() === "Any audio in house off" && h.calls.length === n, words(wrap));
  await press(byText(wrap, "Any audio in house off"));
  await press(byText(wrap, "Turn off"));
  check("all-off", h.calls.slice(n).map(c => `${c.service}:${c.entity_id}`).join() === "turn_off:media_player.c4_great_room,turn_off:media_player.denon_zone_2,"
    + "media_pause:media_player.sonos_kitchen,media_stop:media_player.dlna_office", h.calls.slice(n));
  check("all-off", r.counts.filter(w => w === "all_off").length === 1 && words(wrap).join() === "Any audio in house off", r.counts);
  // Everything off: no button.
  for (const e of ["media_player.c4_great_room", "media_player.denon_zone_2", "media_player.sonos_kitchen", "media_player.dlna_office"]) h.hass.states[e].state = "off";
  check("all-off", !q(drawAudio(r), "data-audio-all-off"), "Any audio in house off with everything off");
});

// ── the owner's tidy-up in the matching card: the volume limit, and each player's sources (names, hidden, order) ──
await tryCase("tidy", async () => {
  const h = house();
  Object.assign(h.hass.states["media_player.denon_zone_2"].attributes, { supported_features: FULL | F.SRC, source_list: ["TV", "CD", "Phono"], source: "TV" });
  const r = controls(h, { matches: { great_room: ["media_player.c4_great_room", "media_player.denon_zone_2"] } });
  r.settings.room_audio_matched = true;
  reset();
  r.rc.openMatch(); await tick();
  const card = () => dlg("data-room-match-card");
  const lim = q(card(), "data-audio-limit", "media_player.denon_zone_2");
  check("tidy", lim && lim.children.map(x => x.textContent).join() === "No limit,10 %,20 %,30 %,40 %,50 %,60 %,70 %,80 %,90 %,100 %" && lim.value === "", lim && lim.value);
  lim.value = "0.5"; await fire(lim, "change");
  check("tidy", JSON.stringify(r.saved[r.saved.length - 1]) === JSON.stringify({ room_audio_limits: { "media_player.denon_zone_2": 0.5 } }), r.saved);
  lim.value = "0.5"; await fire(lim, "change");                               // the same again: nothing written
  check("tidy", r.saved.length === 1, r.saved.length);
  // No source list (the Control4 room): no Sources ›; the Denon's opens its sources.
  check("tidy", !q(card(), "data-audio-sources", "media_player.c4_great_room"), "Sources › with no sources");
  await press(btn(card(), x => x.attributes["data-audio-sources"] === "media_player.denon_zone_2"));
  const sc = () => dlg("data-audio-sources-card");
  const rowS = (raw) => all(sc()).find(x => x.attributes && x.attributes["data-source"] === raw);
  check("tidy", all(sc()).filter(x => x.attributes && x.attributes["data-source"]).map(x => x.attributes["data-source"]).join() === "TV,CD,Phono", texts(sc()));
  const tickOf = (raw) => all(rowS(raw)).find(x => x.localName === "input" && x.type === "checkbox");
  const nameOf = (raw) => all(rowS(raw)).find(x => x.localName === "input" && x.type === "text");
  tickOf("Phono").checked = false; await fire(tickOf("Phono"), "change");
  nameOf("CD").value = "  Compact disc "; await fire(nameOf("CD"), "change");
  await press(byAria(rowS("TV"), "Later in the list"));
  const last = r.saved[r.saved.length - 1];
  check("tidy", JSON.stringify(last) === JSON.stringify({ room_audio_sources: { "media_player.denon_zone_2": { names: { CD: "Compact disc" }, hidden: ["Phono"], order: ["CD", "TV", "Phono"] } } }), last);
  check("tidy", r.counts.filter(w => w === "sources_saved").length === 1 && r.counts.filter(w => w === "limit_saved").length === 1, r.counts);
  // The matches were never touched by these saves; the room's card offers the tidied sources.
  check("tidy", r.saved.every(p => !("room_audio_matches" in p)) && JSON.stringify(r.settings.room_audio_matches.great_room) === JSON.stringify(["media_player.c4_great_room", "media_player.denon_zone_2"]), r.settings);
  r.rc.close();
  check("tidy", !card() && !sc(), "a card stayed");
  check("tidy", words(q(drawAudio(r), "data-audio-source", "media_player.denon_zone_2")).join() === "Compact disc,TV", words(q(drawAudio(r), "data-audio-source")));
  check("tidy", all(drawAudio(r)).some(n => n.attributes && n.attributes["data-limit-mark"] === "50"), "the limit is not held");
  // Cleaned as the server cleans: labels trimmed, a label that is its source dropped, a player with nothing left out.
  check("tidy", JSON.stringify(RC.cleanSources({ "media_player.a": { names: { TV: " TV ", CD: "Disc" }, hidden: ["X", "X", 3] }, "media_player.b": {}, "light.c": { hidden: ["Y"] } }))
    === JSON.stringify({ "media_player.a": { names: { CD: "Disc" }, hidden: ["X"], order: [] } }), "cleanSources");
  reset();
});

// ── the review's fixes (2026-11-26) ──
// Home Assistant core's own Control4 room: play, pause, stop, mute, set, step, on, off, source (1288 is one owner's
// override of it, the C4 fixture above).
const C4_CORE = F.PLAY | F.PAUSE | F.STOP | F.MUTE | F.SET | F.STEP | F.OFF | F.SRC;   // no turn_on
await tryCase("c4-core", async () => {
  const h = house();
  Object.assign(h.hass.states["media_player.c4_great_room"].attributes, { supported_features: C4_CORE, source_list: ["Apple TV", "Sonos"], source: "Sonos" });
  const r = controls(h, { matches: { great_room: ["media_player.c4_great_room"] } });
  let sec = drawAudio(r), row = rowOf(sec, "media_player.c4_great_room");
  // On, with a level: − and + as ever (it steps), its slider beside them; ▶ ⏸ ⏹ apart (it is only ever "on"); its sources.
  check("c4-core", words(row).join() === "Mute,−,+,⏻" && !!q(sec, "data-slider", "media_player.c4_great_room"), words(row));
  check("c4-core", words(q(sec, "data-audio-transport")).join() === "▶,⏸,⏹" && words(q(sec, "data-audio-source")).join() === "Apple TV,Sonos", words(sec));
  const n = h.calls.length;
  await press(byAria(row, "Great Room volume up"));
  check("c4-core", h.calls.slice(n).map(c => c.service).join() === "volume_up", h.calls.slice(n));
  check("c4-core", JSON.stringify(r.rc.looks()) === JSON.stringify({ "Great Room": "on" }), r.rc.looks());
  // Off, which Home Assistant core's Control4 says as "idle" (never "off"): off everywhere. No transport, no slider,
  // ⏻ greyed, no On; no speaker on the map; not in Room off; never in Any audio in house off. Its sources still: one
  // starts the room.
  const s = h.hass.states["media_player.c4_great_room"];
  s.state = "idle"; delete s.attributes.volume_level; delete s.attributes.source;
  sec = drawAudio(r); row = rowOf(sec, "media_player.c4_great_room");
  check("c4-core", row.children[1].textContent === "Off" && words(row).join() === "", words(row));
  check("c4-core", !q(sec, "data-audio-transport") && !q(sec, "data-slider") && !q(sec, "data-audio-now") && !q(sec, "data-audio-all-off"), words(sec));
  check("c4-core", words(q(sec, "data-audio-source")).join() === "Apple TV,Sonos", words(sec));
  check("c4-core", JSON.stringify(r.rc.looks()) === "{}" && r.rc.sheet("Great Room", { lightsOn: [], parts: AUDIO_ONLY }).roomOff === null, r.rc.looks());
  // Another platform's idle player is on, as before (a Sonos or a Cast speaker sits idle while on).
  check("c4-core", RC.playerOn({ state: "idle" }, "sonos") === true && RC.playerOn({ state: "idle" }, "control4") === false && RC.playerOn({ state: "on" }, "control4") === true, "idle");
  // Another player off with sources: only one that turns on offers them (a source starts it); else not until it is on.
  addPlayer(h, "media_player.tv_great", "samsungtv", "off", { friendly_name: "TV", supported_features: F.SRC | F.SET, source_list: ["HDMI 1", "HDMI 2"] });
  const r2 = controls(h, { matches: { great_room: ["media_player.tv_great"] }, ha: true });
  check("c4-core", !q(drawAudio(r2), "data-audio-source"), "an off player that can't turn on offers sources");
  h.hass.states["media_player.tv_great"].attributes.supported_features = F.SRC | F.SET | F.ON;
  check("c4-core", !!q(drawAudio(r2), "data-audio-source"), "an off player that turns on lost its sources");
});

// ── a player that sets its level but says none: − and + where it steps (greyed where it can't), never nothing ──
await tryCase("no-level", async () => {
  const h = house();
  addPlayer(h, "media_player.avr_great", "anthemav", "on", { friendly_name: "AVR", supported_features: F.SET | F.STEP | F.MUTE });
  addPlayer(h, "media_player.cast_great", "cast", "playing", { friendly_name: "Nest", supported_features: F.SET | F.MUTE });
  const r = controls(h, { matches: { great_room: ["media_player.avr_great", "media_player.cast_great"] }, ha: true });
  const sec = drawAudio(r), avr = rowOf(sec, "media_player.avr_great"), cast = rowOf(sec, "media_player.cast_great");
  check("no-level", words(avr).join() === "Mute,−,+" && byText(avr, "+").disabled === false && !q(sec, "data-slider"), words(avr));
  check("no-level", words(cast).join() === "Mute,−,+" && byText(cast, "+").disabled === true, words(cast));
  const n = h.calls.length;
  await press(byText(avr, "+"));
  check("no-level", h.calls.slice(n).map(c => `${c.service}:${c.entity_id}`).join() === "volume_up:media_player.avr_great", h.calls.slice(n));
});

// ── a slider held: a light changing mid-drag draws nothing again; a slider gone mid-drag never sticks ──
await tryCase("held", async () => {
  const realNow = Date.now;
  let clk = 0;
  Date.now = () => realNow() + clk;
  try {
    const h = house();
    const r = controls(h, { matches: { great_room: ["media_player.denon_zone_2"] } });
    reset();
    const s = LM.openRoomSheet(apiOf(h, r.rc), lightsOf(h), "Great Room");
    const sec0 = section(sheetNow(), "audio"), sl = q(sec0, "data-slider");
    await fire(sl, "pointerdown");
    sl.value = "70"; await fire(sl, "input");
    check("held", r.rc.held() === true, "not held while dragged");
    // The real trigger: a light switched elsewhere (the lights' list, the action row and its signature change).
    h.hass.states["light.great_room_cove"].state = "on";
    s.update(apiOf(h, r.rc), lightsOf(h));
    check("held", section(sheetNow(), "audio") === sec0 && sheetNow().contains(sl) && words(sheetNow()).includes("Room off (3)"), "a light drew the sheet again under the finger");
    // Let go: drawn again once the short window is over (the light shows then).
    await fire(sl, "change"); await fire(sl, "pointerup");
    clk += 3500;
    s.update(apiOf(h, r.rc), lightsOf(h));
    check("held", r.rc.held() === false && section(sheetNow(), "audio") !== sec0 && words(sheetNow()).includes("Room off (4)"), words(sheetNow()));
    // The sheet closed mid-drag: the drag is over (letGo), what was dragged to is sent, the number is Home Assistant's.
    const sec1 = section(sheetNow(), "audio"), sl1 = q(sec1, "data-slider");
    await fire(sl1, "pointerdown");
    sl1.value = "40"; await fire(sl1, "input");
    const n = h.calls.length;
    sl1.value = "42"; await fire(sl1, "input");                          // held back (under 250 ms)
    s.close(); reset();
    await tick();
    check("held", r.rc.held() === false && h.calls.slice(n).map(c => c.volume_level).join() === "0.42", h.calls.slice(n));
    // A slider let go of off it (no pointerup heard, no change): over after a few seconds with no input.
    const sec2 = drawAudio(r), sl2 = q(sec2, "data-slider");
    await fire(sl2, "pointerdown");
    sl2.value = "90"; await fire(sl2, "input");
    const num = () => all(rowOf(drawAudio(r), "media_player.denon_zone_2")).find(x => x.attributes["data-level"] !== undefined).textContent;
    check("held", r.rc.held() === true && num() === "90", num());
    clk += 4100;
    check("held", r.rc.held() === false && num() === "50", num());       // Home Assistant's own level again
  } finally { Date.now = realNow; }
});

// ── the limit, everywhere: never one step past it, never with no level known ──
await tryCase("limit-gaps", async () => {
  const h = house();
  Object.assign(h.hass.states["media_player.c4_great_room"].attributes, { volume_level: 0.25, volume_step: 0.1 });
  const r = controls(h, { matches: { great_room: ["media_player.c4_great_room", "media_player.c4_office"] },
    limits: { "media_player.c4_great_room": 0.3, "media_player.c4_office": 0.5 } });
  h.hass.states["media_player.c4_office"].state = "on";                  // on, its level not said
  const sec = drawAudio(r);
  const gr = byAria(rowOf(sec, "media_player.c4_great_room"), "Great Room volume up"), of = byAria(rowOf(sec, "media_player.c4_office"), "Alex’s office volume up");
  check("limit-gaps", gr.disabled === true && of.disabled === true, [gr.disabled, of.disabled]);
  const n = h.calls.length;
  await press(gr); await press(of);                                        // a disabled button pressed anyway: nothing
  check("limit-gaps", h.calls.length === n, h.calls.slice(n));
  // At 0.2 one step (0.3) is allowed; a player with no limit steps whatever its level.
  h.hass.states["media_player.c4_great_room"].attributes.volume_level = 0.2;
  const gr2 = byAria(rowOf(drawAudio(r), "media_player.c4_great_room"), "Great Room volume up");
  await press(gr2);
  check("limit-gaps", h.calls.slice(n).map(c => c.service).join() === "volume_up" && gr2.disabled === true, [h.calls.slice(n), gr2.disabled]);
  const r2 = controls(h, { matches: { office: ["media_player.c4_office"] } });
  check("limit-gaps", byAria(rowOf(drawAudio(r2, "Alex's Office"), "media_player.c4_office"), "Alex’s office volume up").disabled === false, "no limit, no level: greyed");
});

// ── Any audio in house off: only what is sounding ──
await tryCase("all-off-quiet", async () => {
  const h = house();
  h.hass.states["media_player.c4_great_room"].state = "off"; h.hass.states["media_player.denon_zone_2"].state = "off";
  addPlayer(h, "media_player.sonos_kitchen", "sonos", "idle", { friendly_name: "One", supported_features: F.PLAY | F.PAUSE | F.SET });
  addPlayer(h, "media_player.ma_office", "music_assistant", "paused", { friendly_name: "MA", supported_features: F.PLAY | F.PAUSE | F.SET | F.OFF });
  addPlayer(h, "media_player.esp_garage", "esphome", "playing", { friendly_name: "Speaker", supported_features: F.SET | F.MUTE });
  const r = controls(h, { matches: { great_room: ["media_player.c4_great_room", "media_player.denon_zone_2"], kitchen: ["media_player.sonos_kitchen"],
    office: ["media_player.ma_office"], garage: ["media_player.esp_garage"] }, ha: true });
  // The idle Sonos and the paused Music Assistant player are silent: the button is for the one playing speaker only.
  const wrap = q(drawAudio(r), "data-audio-all-off");
  await press(byText(wrap, "Any audio in house off"));
  const n = h.calls.length;
  await press(byText(wrap, "Turn off"));
  check("all-off-quiet", JSON.stringify(h.calls.slice(n)) === JSON.stringify([{ domain: "media_player", service: "volume_mute", entity_id: "media_player.esp_garage", is_volume_muted: true }]), h.calls.slice(n));
  h.hass.states["media_player.esp_garage"].state = "idle";
  check("all-off-quiet", !q(drawAudio(r), "data-audio-all-off"), "Any audio in house off with nothing sounding");
});

// ── Share from a player that follows a group: joined to its leader ──
await tryCase("share-leader", async () => {
  const h = house();
  const G = F.SET | F.GROUP;
  addPlayer(h, "media_player.sonos_great", "sonos", "playing", { friendly_name: "Arc", volume_level: 0.3, supported_features: G,
    group_members: ["media_player.sonos_den", "media_player.sonos_great"] });
  addPlayer(h, "media_player.sonos_den", "sonos", "playing", { friendly_name: "Den", volume_level: 0.3, supported_features: G });
  addPlayer(h, "media_player.sonos_kitchen", "sonos", "idle", { friendly_name: "One", volume_level: 0.6, supported_features: G });
  const r = controls(h, { matches: { great_room: ["media_player.sonos_great"], kitchen: ["media_player.sonos_kitchen"] }, ha: true });
  reset();
  await press(btn(drawAudio(r), x => x.attributes["data-audio-share-btn"] === "media_player.sonos_great"));
  const cb = all(dlg("data-audio-share")).find(x => x.localName === "input" && x.type === "checkbox");
  const n = h.calls.length;
  cb.checked = true; await fire(cb, "change");
  check("share-leader", JSON.stringify(h.calls.slice(n)) === JSON.stringify([{ domain: "media_player", service: "join", entity_id: "media_player.sonos_den", group_members: ["media_player.sonos_kitchen"] }]), h.calls.slice(n));
  r.rc.close(); reset();
});

// ── odd source names: a duplicate, an empty one, "constructor" and "__proto__" are sources like any other ──
await tryCase("odd-sources", async () => {
  const h = house();
  const den = h.hass.states["media_player.denon_zone_2"];
  Object.assign(den.attributes, { supported_features: FULL | F.SRC, source: "constructor",
    source_list: ["constructor", "__proto__", "TV", "TV", "", "toString", "hasOwnProperty", "valueOf", "CD", "Tuner", "AUX", "Phono"] });
  const names = JSON.parse('{"__proto__": "Proto", "constructor": "Builder"}');
  const r = controls(h, { matches: { great_room: ["media_player.denon_zone_2"] }, sources: { "media_player.denon_zone_2": { names, hidden: ["toString"], order: [] } } });
  reset();
  const cs = RC.cleanSources({ "media_player.denon_zone_2": { names, hidden: ["toString"] } })["media_player.denon_zone_2"];
  check("odd-sources", Object.prototype.hasOwnProperty.call(cs.names, "__proto__") && cs.names.__proto__ === "Proto" && cs.names.constructor === "Builder", JSON.stringify(cs));
  const labels = RC.tidySources(den.attributes.source_list, cs).map(x => x.label);
  check("odd-sources", labels.join() === "Builder,Proto,TV,hasOwnProperty,valueOf,CD,Tuner,AUX,Phono", labels);
  check("odd-sources", RC.tidySources(["constructor", "toString"], { names: {} }).map(x => x.label).join() === "constructor,toString", "a plain object's keys as names");
  const b = btn(drawAudio(r), x => x.attributes["data-audio-list"] === "source");
  check("odd-sources", b && plain(b.textContent) === "Builder ›", b && b.textContent);
  await press(b);
  const card = dlg("data-audio-picker"), f = q(card, "data-audio-filter");
  f.value = "pro"; await fire(f, "input");                                 // threw on a function label before
  check("odd-sources", all(card).filter(x => x.attributes && x.attributes["data-value"]).map(x => x.attributes["data-value"]).join() === "__proto__,hasOwnProperty", words(card));
  r.rc.close(); reset();
});

// ── the picture: Home Assistant's own path or https only, with no referrer ──
await tryCase("picture", async () => {
  const h = house();
  addPlayer(h, "media_player.sonos_great", "sonos", "playing", { friendly_name: "Arc", supported_features: F.PLAY | F.PAUSE | F.SET, media_title: "Song" });
  const r = controls(h, { matches: { great_room: ["media_player.sonos_great"] }, ha: true });
  const img = (pic) => { h.hass.states["media_player.sonos_great"].attributes.entity_picture = pic; return all(drawAudio(r)).find(x => x.localName === "img"); };
  const back = "/" + String.fromCharCode(92) + "evil.example/a.png";      // a browser reads it as //evil.example
  for (const bad of ["//evil.example/a.png", back, "http://cover.example/a.png", "javascript:alert(1)", "data:image/png;base64,AAAA"]) check("picture", !img(bad), bad);
  const a = img("/api/media_player_proxy/media_player.sonos_great?token=t"), b = img("https://i.scdn.co/image/abc");
  check("picture", a && b && b.src === "https://i.scdn.co/image/abc" && a.referrerPolicy === "no-referrer" && b.referrerPolicy === "no-referrer", [a && a.src, b && b.referrerPolicy]);
});

// ── the cards' selects say what they hold: a limit between the steps, a Sound select's state not among its options ──
await tryCase("selects", async () => {
  const h = house();
  Object.assign(h.hass.states["media_player.denon_zone_2"].attributes, { supported_features: FULL | F.SRC, source_list: ["TV", "CD"] });
  const r = controls(h, { matches: { great_room: ["media_player.denon_zone_2"] }, limits: { "media_player.denon_zone_2": 0.35 } });
  r.settings.room_audio_matched = true;
  reset();
  r.rc.openMatch(); await tick();
  const lim = q(dlg("data-room-match-card"), "data-audio-limit", "media_player.denon_zone_2");
  check("selects", lim.value === "0.35" && lim.children.map(x => x.textContent).slice(3, 6).join() === "30 %,35 %,40 %", [lim.value, lim.children.map(x => x.textContent)]);
  r.rc.close(); reset();
  addPlayer(h, "media_player.mc_great", "yamaha_musiccast", "on", { friendly_name: "RX-A", supported_features: F.SET }, "dev_mc");
  addEntity(h, "select.rx_a_main_equalizer_mode", "yamaha_musiccast", "dev_mc", "unknown", { options: ["manual", "auto"] }, { translation_key: "zone_equalizer_mode" });
  const r2 = controls(h, { matches: { great_room: ["media_player.mc_great"] } });
  const sec = drawAudio(r2);
  await press(btn(sec, x => x.attributes["data-audio-sound-btn"] === "media_player.mc_great"));
  let sel = all(q(sec, "data-audio-sound")).find(x => x.localName === "select");
  check("selects", sel.children[0].textContent === "Pick one" && sel.children[0].disabled === true && sel.value === "", sel.children.map(x => x.textContent));
  h.hass.states["select.rx_a_main_equalizer_mode"].state = "bypass";
  sel = all(q(drawAudio(r2), "data-audio-sound")).find(x => x.localName === "select");
  check("selects", sel.children.map(x => x.textContent).join() === "bypass,manual,auto" && sel.children[0].disabled === true, sel.children.map(x => x.textContent));
  const n = h.calls.length;
  sel.value = ""; await fire(sel, "change");
  check("selects", h.calls.length === n, "the shown state was picked");
});

// ── the Sources card: tick and name one 36 px label; a name kept as typed, on close too; as the server keeps them ──
await tryCase("sources-card", async () => {
  const h = house();
  const long = "L".repeat(101);
  const list = ["TV", long, ...Array.from({ length: 120 }, (_, i) => `In ${i}`)];
  Object.assign(h.hass.states["media_player.denon_zone_2"].attributes, { supported_features: FULL | F.SRC, source_list: list });
  const r = controls(h, { matches: { great_room: ["media_player.denon_zone_2"] } });
  r.settings.room_audio_matched = true;
  reset();
  r.rc.openMatch(); await tick();
  await press(btn(dlg("data-room-match-card"), x => x.attributes["data-audio-sources"] === "media_player.denon_zone_2"));
  const sc = dlg("data-audio-sources-card");
  const rows = all(sc).filter(x => x.attributes && x.attributes["data-source"] !== undefined);
  check("sources-card", rows.length === 99 && !rows.some(x => x.attributes["data-source"] === long), rows.length);   // the first 100, none over 100 long
  const lab = rows[0].children[0];
  check("sources-card", lab.localName === "label" && /min-height:36px/.test(lab.style.cssText) && all(lab).some(x => x.type === "checkbox"), lab && lab.localName);
  const name = all(rows[0]).find(x => x.localName === "input" && x.type === "text");
  name.value = "Telly"; await fire(name, "input");
  check("sources-card", r.saved.length === 0, "saved on the first key");
  r.rc.close();                                                            // Escape, or the panel gone: the name is kept
  await tick(); await tick();
  check("sources-card", JSON.stringify(r.saved[r.saved.length - 1]) === JSON.stringify({ room_audio_sources: { "media_player.denon_zone_2": { names: { TV: "Telly" }, hidden: [], order: [] } } }), r.saved);
  reset();
  // Kept after a pause in typing (RENAME_MS), and at once on leaving the field; never twice for the same name.
  r.rc.openMatch(); await tick();
  await press(btn(dlg("data-room-match-card"), x => x.attributes["data-audio-sources"] === "media_player.denon_zone_2"));
  const field = (raw) => all(all(dlg("data-audio-sources-card")).find(x => x.attributes && x.attributes["data-source"] === raw)).find(x => x.localName === "input" && x.type === "text");
  const n0 = r.saved.length;
  field("In 0").value = "Turntable"; await fire(field("In 0"), "input");
  check("sources-card", r.saved.length === n0, "saved before the pause");
  await flush(4, 700); await tick(); await tick();
  check("sources-card", r.saved.length === n0 + 1 && r.saved[n0].room_audio_sources["media_player.denon_zone_2"].names["In 0"] === "Turntable", r.saved.slice(n0));
  field("In 1").value = "Radio"; await fire(field("In 1"), "change"); await tick(); await tick();
  check("sources-card", r.saved.length === n0 + 2 && r.saved[n0 + 1].room_audio_sources["media_player.denon_zone_2"].names["In 1"] === "Radio", r.saved.slice(n0));
  await fire(field("In 1"), "change"); await tick();
  check("sources-card", r.saved.length === n0 + 2, "the same name saved twice");
  r.rc.close(); reset();
});

// ── one sheet reads Home Assistant's entities once, not once per player ──
await tryCase("memo", async () => {
  const h = house();
  for (const [i, room] of [["a", "great_room"], ["b", "great_room"], ["c", "great_room"]]) addPlayer(h, `media_player.sonos_${i}`, "sonos", "playing", { friendly_name: i, volume_level: 0.2, supported_features: F.SET | F.GROUP }, `dev_${i}`);
  const r = controls(h, { matches: { great_room: ["media_player.sonos_a", "media_player.sonos_b", "media_player.sonos_c"], kitchen: ["media_player.denon_zone_2"] }, ha: true });
  let keys = 0;
  const ents = h.hass.entities;
  h.hass.entities = new Proxy(ents, { ownKeys: (tg) => { keys++; return Reflect.ownKeys(tg); } });
  const sh = r.rc.sheet("Great Room", { parts: AUDIO_ONLY });
  sh.before.draw();
  check("memo", keys === 1, keys);
  h.hass.entities = ents;
});

// ── − and + right after a slider was let go of: they start from the dragged level, add up, and the limit holds ──
await tryCase("drag-then-step", async () => {
  const realNow = Date.now;
  let clk = 0;
  Date.now = () => realNow() + clk;
  try {
    const h = house();
    const r = controls(h, { matches: { great_room: ["media_player.denon_zone_2"] }, limits: { "media_player.denon_zone_2": 0.5 } });
    const sec = drawAudio(r), sl = q(sec, "data-slider"), row = rowOf(sec, "media_player.denon_zone_2");
    const num = all(row).find(x => x.attributes["data-level"] !== undefined), plus = byAria(row, "Zone 2 volume up");
    await fire(sl, "pointerdown"); sl.value = "47"; await fire(sl, "input"); await fire(sl, "change"); await fire(sl, "pointerup");
    check("drag-then-step", num.textContent === "47", num.textContent);
    const n = h.calls.length;
    for (let i = 0; i < 4; i++) { clk += 300; await press(plus); }
    // 48, 49, 50, then the limit: three calls, never a fourth; Home Assistant still says 0.5 from before the drag.
    check("drag-then-step", num.textContent === "50" && h.calls.slice(n).filter(c => c.service === "volume_up").length === 3 && plus.disabled === true,
      [num.textContent, h.calls.slice(n).map(c => c.service), plus.disabled]);
  } finally { Date.now = realNow; }
});

// ── the document's pointer: let go anywhere ends a drag; the panel gone, its listeners go too ──
await tryCase("doc-pointer", async () => {
  const realAdd = document.addEventListener, realRemove = document.removeEventListener, heard = new Map();
  document.addEventListener = (type, fn, capture) => { if (!heard.has(type)) heard.set(type, []); heard.get(type).push([fn, capture]); };
  document.removeEventListener = (type, fn, capture) => { heard.set(type, (heard.get(type) || []).filter(([f, c]) => !(f === fn && c === capture))); };
  try {
    const h = house();
    const r = controls(h, { matches: { great_room: ["media_player.denon_zone_2"] } });
    const sl = q(drawAudio(r), "data-slider");
    check("doc-pointer", (heard.get("pointerup") || []).length === 1 && (heard.get("pointercancel") || []).length === 1 && heard.get("pointerup")[0][1] === true, [...heard.keys()]);
    q(drawAudio(r), "data-slider");                                         // a second slider: still one listener
    check("doc-pointer", heard.get("pointerup").length === 1, heard.get("pointerup").length);
    await fire(sl, "pointerdown"); sl.value = "62"; await fire(sl, "input");
    check("doc-pointer", r.rc.held() === true, "not held");
    const n = h.calls.length;
    for (const [fn] of heard.get("pointerup")) fn({ type: "pointerup" });   // let go off the slider: only the document hears
    await tick(); await tick();
    check("doc-pointer", r.rc.held() === false && r.counts.filter(w => w === "slider").length === 1 && h.calls.slice(n).length === 0, [r.rc.held(), h.calls.slice(n)]);
    r.rc.close();
    check("doc-pointer", heard.get("pointerup").length === 0 && heard.get("pointercancel").length === 0, "the panel went, its listeners stayed");
  } finally { document.addEventListener = realAdd; document.removeEventListener = realRemove; }
});

// ── the whole-beta inspection (2026-11-26) ──
// Room off: a playing Sonos (no turn off) is paused and counted, as Any audio in house off does.
await tryCase("room-off-quiet", async () => {
  const h = house();
  h.hass.states["media_player.denon_zone_2"].state = "off";
  addPlayer(h, "media_player.sonos_great", "sonos", "playing", { friendly_name: "Arc", volume_level: 0.3, supported_features: F.PLAY | F.PAUSE | F.SET });
  addPlayer(h, "media_player.ma_great", "music_assistant", "idle", { friendly_name: "MA", supported_features: F.PLAY | F.PAUSE | F.SET });
  const r = controls(h, { matches: { great_room: ["media_player.c4_great_room", "media_player.denon_zone_2", "media_player.sonos_great", "media_player.ma_great"] }, ha: true });
  const sh = r.rc.sheet("Great Room", { lightsOn: ["light.great_room_pots"], parts: AUDIO_ONLY });
  // One light, the Control4 room (on, turns off) and the playing Sonos; never the off Denon or the idle player.
  check("room-off-quiet", sh.roomOff && sh.roomOff.label === "Room off (3)", sh.roomOff && sh.roomOff.label);
  const n = h.calls.length;
  sh.roomOff.run(); await tick(); await tick();
  check("room-off-quiet", h.calls.slice(n).map(c => `${c.service}:${c.entity_id}`).join() === "turn_off:media_player.c4_great_room,media_pause:media_player.sonos_great", h.calls.slice(n));
});

// ── what a shade is: one rule (isShade) for the card and the Shades tip ──
await tryCase("shade-rule", async () => {
  const h = house({
    "cover.great_room_damper": ST("cover.great_room_damper", "open", { friendly_name: "HVAC damper", device_class: "damper", supported_features: 3 }),
    "cover.great_room_window": ST("cover.great_room_window", "closed", { friendly_name: "Skylight", device_class: "window", supported_features: 3 }),
    "cover.great_room_side_door_opener": ST("cover.great_room_side_door_opener", "closed", { friendly_name: "Garage side door opener", supported_features: 3 }),
    "cover.great_room_curtain": ST("cover.great_room_curtain", "open", { friendly_name: "Curtain", device_class: "curtain", supported_features: 3 }),
  });
  for (const e of ["cover.great_room_damper", "cover.great_room_window", "cover.great_room_side_door_opener", "cover.great_room_curtain"]) h.hass.entities[e].area_id = "great_room";
  const is = (e, op) => RC.isShade(h.hass, e, op);
  check("shade-rule", is("cover.great_room_left") && is("cover.great_room_curtain") && !is("cover.great_room_damper") && !is("cover.great_room_window")
    && !is("cover.great_room_side_door_opener") && !is("cover.garage_door") && !is("light.great_room_pots") && !is("cover.nothing_here"), "isShade");
  check("shade-rule", !is("cover.great_room_left", new Set(["cover.great_room_left"])), "a linked opener is a shade");
  const r = controls(h, { matches: {} });
  const sec = r.rc.sheet("Great Room", { parts: { audio: false, shades: true, climate: false } }).after.draw();
  const rows = all(sec).filter(n => n.attributes && n.attributes["data-eid"]).map(n => n.attributes["data-eid"]);
  check("shade-rule", rows.join() === "cover.great_room_curtain,cover.great_room_left,cover.great_room_right", rows);
});

// ── an idle player: no speaker on the map, "Idle", ▶ alone ──
await tryCase("idle", async () => {
  const h = house();
  h.hass.states["media_player.c4_great_room"].state = "off"; h.hass.states["media_player.denon_zone_2"].state = "off";
  addPlayer(h, "media_player.sonos_great", "sonos", "idle", { friendly_name: "Arc", volume_level: 0.3, supported_features: F.PLAY | F.PAUSE | F.SET | F.MUTE });
  const r = controls(h, { matches: { great_room: ["media_player.sonos_great", "media_player.c4_great_room"] }, ha: true });
  check("idle", JSON.stringify(r.rc.looks()) === "{}", r.rc.looks());
  const sec = drawAudio(r), row = rowOf(sec, "media_player.sonos_great");
  check("idle", row.children[1].textContent === "Idle" && words(q(sec, "data-audio-transport", "media_player.sonos_great")).join() === "▶", [row.children[1].textContent, words(sec)]);
  check("idle", !q(sec, "data-audio-all-off"), "Any audio in house off with nothing playing");
  h.hass.states["media_player.sonos_great"].state = "playing";
  check("idle", JSON.stringify(r.rc.looks()) === JSON.stringify({ "Great Room": "on" }), r.rc.looks());
  h.hass.states["media_player.sonos_great"].state = "paused";
  check("idle", JSON.stringify(r.rc.looks()) === "{}", "a paused player keeps the speaker");
});

// ── a thermostat that holds a range: heat to and cool to, each with − and +, sent together ──
await tryCase("range", async () => {
  const h = house({ "climate.great_room": ST("climate.great_room", "heat_cool", { friendly_name: "Living Room range", current_temperature: 20.4, target_temp_low: 19,
    target_temp_high: 24, target_temp_step: 0.5, min_temp: 7, max_temp: 30, supported_features: 2, hvac_modes: ["off", "heat_cool"] }) });
  const r = controls(h, { matches: {} });
  const sec = () => r.rc.sheet("Great Room", { parts: { audio: false, shades: false, climate: true } }).after.draw();
  const row = () => rowOf(sec(), "climate.great_room");
  check("range", texts(row()).join("|") === "Living Room range|Heat and cool|Heat to|−|19°|+|Cool to|−|24°|+", texts(row()));
  const n = h.calls.length;
  await press(byAria(row(), "Living Room range: heat to, up"));
  await press(byAria(row(), "Living Room range: cool to, down"));
  check("range", JSON.stringify(h.calls.slice(n)) === JSON.stringify([
    { domain: "climate", service: "set_temperature", entity_id: "climate.great_room", target_temp_low: 19.5, target_temp_high: 24 },
    { domain: "climate", service: "set_temperature", entity_id: "climate.great_room", target_temp_low: 19.5, target_temp_high: 23.5 }]), h.calls.slice(n));
  // Heat to never passes cool to.
  const r2 = controls(house({ "climate.great_room": ST("climate.great_room", "heat_cool", { friendly_name: "Tight", target_temp_low: 22, target_temp_high: 22, supported_features: 2 }) }), { matches: {} });
  const row2 = rowOf(r2.rc.sheet("Great Room", { parts: { audio: false, shades: false, climate: true } }).after.draw(), "climate.great_room");
  check("range", texts(row2).includes("22°") && byAria(row2, "Tight: heat to, up"), texts(row2));
  // Its own current temperature only without the card's status line (no temperature sensor in the room).
  const h3 = house({ "climate.great_room": ST("climate.great_room", "heat", { friendly_name: "T", current_temperature: 20.4, temperature: 21, supported_features: 1 }) });
  for (const e of Object.keys(h3.hass.states)) if (e.startsWith("sensor.")) delete h3.hass.states[e];
  const r3 = controls(h3, { matches: {} });
  check("range", texts(rowOf(r3.rc.sheet("Great Room", { parts: { audio: false, shades: false, climate: true } }).after.draw(), "climate.great_room")).includes("20.4 °C"), "no status line, no current temperature");
});

// ── what the card's parts show, for "More devices of the area" to leave out ──
await tryCase("shown-in", async () => {
  const h = house();
  addPlayer(h, "media_player.sonos_great", "sonos", "playing", { friendly_name: "Arc", volume_level: 0.3, supported_features: F.SET }, "dev_arc");
  addEntity(h, "number.arc_bass", "sonos", "dev_arc", "3", { min: -10, max: 10, step: 1 }, { translation_key: "bass" });
  const r = controls(h, { matches: { great_room: ["media_player.c4_great_room", "media_player.sonos_great"] }, ha: true });
  const got = new Set(r.rc.shownIn("Great Room"));
  check("shown-in", ["media_player.c4_great_room", "media_player.sonos_great", "number.arc_bass", "cover.great_room_left", "cover.great_room_right", "climate.great_room",
    "sensor.great_room_temperature", "sensor.great_room_humidity"].every(e => got.has(e)) && !got.has("light.great_room_pots") && !got.has("cover.garage_door"), [...got]);
  const audioOnly = r.rc.shownIn("Great Room", { audio: true, shades: false, climate: false });
  check("shown-in", audioOnly.join() === "media_player.c4_great_room,media_player.sonos_great,number.arc_bass", audioOnly);
});

// ── the sheet: the room's temperature sensors are the status line's, not rows; a wall's card larger ──
await tryCase("sheet-tidy", async () => {
  const h = house();
  const r = controls(h, { matches: {} });
  const lights = LM.gatherLights(h.hass.states, { "light.great_room_pots": "Great Room", "sensor.great_room_temperature": "Great Room", "sensor.great_room_humidity": "Great Room" }, {}, "pro");
  reset();
  const api = { ...apiOf(h, r.rc), roomParts: { audio: false, shades: false, climate: true } };
  const s = LM.openRoomSheet(api, lights, "Great Room");
  check("sheet-tidy", !/great room temperature|great room humidity/.test(words(sheetNow()).join() + all(sheetNow()).map(n => n._text).join("|")), all(sheetNow()).map(n => n._text).filter(Boolean));
  s.close(); reset();
  const plain = LM.openRoomSheet(apiOf(h, null), lights, "Great Room");
  check("sheet-tidy", /great room temperature/.test(all(sheetNow()).map(n => n._text).join("|")), "the sensors' rows went without room controls");
  plain.close(); reset();
  const wall = LM.openRoomSheet({ ...apiOf(h, r.rc), kiosk: true }, lights, "Great Room");
  check("sheet-tidy", /zoom:1\.35/.test(sheetNow().children[0].style.cssText), sheetNow().children[0].style.cssText);
  wall.close(); reset();
  check("sheet-tidy", !/zoom/.test((() => { const x = LM.openRoomSheet(apiOf(h, r.rc), lights, "Great Room"); const c = sheetNow().children[0].style.cssText; x.close(); reset(); return c; })()), "zoom off a wall");
});

// ── German ──
await tryCase("german", async () => {
  await I.useLanguage({ language: "de", locale: { language: "de" } }, ["atlas1", "aboard2"]);
  const h = house();
  const r = controls(h, { matches: { great_room: ["media_player.c4_great_room"] } });
  reset();
  const s = LM.openRoomSheet(apiOf(h, r.rc), lightsOf(h), "Great Room");
  const w = words(sheetNow());
  check("german", w.includes("Stumm") && w.some(x => /^Raum aus \(\d\)$/.test(x)) && w.includes("Öffnen") && w.includes("Alle Audioquellen im Haus aus") && !w.includes("Räume zuordnen"), w);
  s.close(); reset();
  await I.useLanguage({ language: "en", locale: { language: "en" } }, ["atlas1", "aboard2"]);
});

process.stdout.write(JSON.stringify({ cases, failures }) + "\n", () => process.exit(0));
