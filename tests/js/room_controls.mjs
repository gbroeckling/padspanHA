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
import { install } from "./dom_shim.mjs";

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
function house(over = {}) {
  const states = {
    "media_player.c4_great_room": ST("media_player.c4_great_room", "on", { friendly_name: "Great Room", volume_level: 0.35, is_volume_muted: false, supported_features: FULL }),
    "media_player.denon_zone_2": ST("media_player.denon_zone_2", "on", { friendly_name: "Zone 2", volume_level: 0.5, is_volume_muted: false, supported_features: FULL }),
    "media_player.c4_office": ST("media_player.c4_office", "off", { friendly_name: "Alex’s office", supported_features: FULL }),
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
function controls(h, { matches = {}, ha = false, admin = true } = {}) {
  const rec = { counts: [], toasts: [], saved: [], redraws: 0, settings: { room_audio_matches: matches, room_audio_ha_speakers: ha } };
  h.hass.user.is_admin = admin;
  rec.rc = RC.createRoomControls({
    hass: () => h.hass, model: () => MODEL, settings: () => rec.settings, admin: () => h.hass.user.is_admin,
    save: async (patch) => { rec.saved.push(patch); rec.settings = { ...patch }; return true; },
    toast: (m, e) => rec.toasts.push([m, !!e]), errorText: (e) => e.message, count: (w) => rec.counts.push(w), redraw: () => { rec.redraws++; },
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
const byText = (root, text) => btn(root, b => b.textContent === text);
const byAria = (root, text) => btn(root, b => b.attributes["aria-label"] === text);
const section = (root, key) => all(root).find(n => n.attributes && n.attributes["data-room-controls"] === key);
const rowOf = (root, eid) => all(root).find(n => n.attributes && n.attributes["data-eid"] === eid && n.localName === "div");
const press = async (b) => { if (!b) throw new Error("no such button"); b.click(); await tick(); await tick(); };
const words = (n) => all(n).filter(x => x.localName === "button").map(x => x.textContent);

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
  const listRows = kids.slice(3, kids.length - 1).map(k => all(k).map(n => n._text).filter(Boolean).join("|"));
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
  // A player that steps itself (a Control4 room: 1 in 100 a press) shows only the level it reports, never a guess in
  // tens, so the row is not drawn again under the finger before the next press.
  s.update(apiOf(h, r.rc), lights);
  const lvlNow = () => all(c4()).find(n => n.attributes["data-level"] !== undefined).textContent;
  check("audio", lvlNow() === "35", lvlNow());
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

// ── features: −/+ greyed with no way to step; no Mute or ⏻ the player can't do; an off player's level is — ──
await tryCase("features", async () => {
  const h = house({
    "media_player.c4_great_room": ST("media_player.c4_great_room", "off", { friendly_name: "Great Room", supported_features: F.SET }),
    "media_player.denon_zone_2": ST("media_player.denon_zone_2", "on", { friendly_name: "Zone 2", supported_features: F.STEP }),
  });
  const r = controls(h, { matches: { great_room: ["media_player.c4_great_room", "media_player.denon_zone_2"] } });
  reset();
  const s = LM.openRoomSheet(apiOf(h, r.rc), lightsOf(h), "Great Room");
  const c4 = rowOf(section(sheetNow(), "audio"), "media_player.c4_great_room"), dz = rowOf(section(sheetNow(), "audio"), "media_player.denon_zone_2");
  check("features", words(c4).join() === "−,+" && all(c4).filter(n => n.localName === "button").every(b => b.disabled), words(c4));
  check("features", all(c4).find(n => n.attributes["data-level"] !== undefined).textContent === "—" && c4.children[1].textContent === "Off");
  check("features", words(dz).join() === "−,+" && all(dz).filter(n => n.localName === "button").every(b => !b.disabled), words(dz));
  await press(byText(dz, "+"));
  check("features", h.calls.length === 1 && h.calls[0].service === "volume_up", h.calls);
  s.close(); reset();
});

// ── climate and shades ──
await tryCase("climate", async () => {
  const h = house();
  const r = controls(h, { matches: {} });
  reset();
  const s = LM.openRoomSheet(apiOf(h, r.rc), lightsOf(h), "Great Room");
  const cl = section(sheetNow(), "climate");
  const row = rowOf(cl, "climate.great_room");
  check("climate", all(row).map(n => n._text).filter(Boolean).join("|") === "Great Room thermostat|20.4 °C|Heat|−|22°|+", all(row).map(n => n._text).filter(Boolean));
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
  // One row for both blinds (the right one is in the room through its device); the garage door is never a shade.
  check("covers", sh.children.length === 2 && all(sh).map(n => n._text).filter(Boolean).join("|") === "Shades|2 shades|50 % open|Open|Stop|Close", all(sh).map(n => n._text).filter(Boolean));
  await press(byText(sh, "Open"));
  await press(byText(sh, "Stop"));
  await press(byText(sh, "Close"));
  check("covers", JSON.stringify(h.calls) === JSON.stringify([
    { domain: "cover", service: "open_cover", entity_id: ["cover.great_room_left", "cover.great_room_right"] },
    { domain: "cover", service: "stop_cover", entity_id: "cover.great_room_left" },
    { domain: "cover", service: "close_cover", entity_id: ["cover.great_room_left", "cover.great_room_right"] }]), h.calls);
  check("covers", r.counts.filter(w => w === "cover").length === 3, r.counts);
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
  // Nothing matched yet: in every room the button alone, prominent.
  const s = LM.openRoomSheet(apiOf(h, r.rc), lightsOf(h), "Kitchen");
  const a = section(sheetNow(), "audio");
  const mb = a && btn(a, b => b.attributes["data-room-match"] !== undefined);
  // Control4 and Denon here: "Match rooms"; a house with Control4 alone says so.
  check("match", !!mb && mb.textContent === "Match rooms" && /#2d6a4f/.test(mb.style.cssText), mb && [mb.textContent, mb.style.cssText]);
  {
    const h4 = house(); delete h4.hass.states["media_player.denon_zone_2"];
    const r4 = controls(h4, { matches: {} });
    const p4 = r4.rc.sheet("Kitchen").before.draw();
    check("match", btn(p4, b => b.attributes["data-room-match"] !== undefined).textContent === "Match Control4 to HA", words(p4));
  }
  await press(mb);
  const card = () => document.body.children.find(n => all(n).some(x => x.attributes && x.attributes["data-room-match-card"] !== undefined));
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
  check("match", r.saved.length === 3 && JSON.stringify(r.saved[2]) === JSON.stringify({ room_audio_matches: { great_room: ["media_player.denon_zone_2", "media_player.c4_great_room"], kitchen: ["media_player.c4_office"] }, room_audio_ha_speakers: false }), r.saved);
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
await tryCase("non-admin", async () => {
  const h = house();
  const r = controls(h, { matches: { great_room: ["media_player.c4_great_room"] }, admin: false });
  reset();
  const s = LM.openRoomSheet(apiOf(h, r.rc), lightsOf(h), "Great Room");
  const a = section(sheetNow(), "audio");
  const mb = btn(a, b => b.attributes["data-room-match"] !== undefined);
  check("non-admin", mb && mb.disabled && all(a).some(n => n._text === "An administrator matches the players to the rooms."), mb && mb.disabled);
  // The ⋯ line's Set up › is offered by this (lights_map.js audioSetup): an administrator's only.
  check("non-admin", r.rc.canMatch() === false && controls(house()).rc.canMatch() === true, "canMatch is not the administrator's");
  // The controls themselves are for everyone, as the lights are.
  await press(byAria(rowOf(a, "media_player.c4_great_room"), "Great Room volume up"));
  check("non-admin", h.calls.length === 1, h.calls);
  s.close(); reset();
});

// ── German ──
await tryCase("german", async () => {
  await I.useLanguage({ language: "de", locale: { language: "de" } }, ["atlas1", "aboard2"]);
  const h = house();
  const r = controls(h, { matches: { great_room: ["media_player.c4_great_room"] } });
  reset();
  const s = LM.openRoomSheet(apiOf(h, r.rc), lightsOf(h), "Great Room");
  const w = words(sheetNow());
  check("german", w.includes("Stumm") && w.some(x => /^Raum aus \(\d\)$/.test(x)) && w.includes("Öffnen") && w.includes("Räume zuordnen"), w);
  s.close(); reset();
  await I.useLanguage({ language: "en", locale: { language: "en" } }, ["atlas1", "aboard2"]);
});

process.stdout.write(JSON.stringify({ cases, failures }) + "\n", () => process.exit(0));
