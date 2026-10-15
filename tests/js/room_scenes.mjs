// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
//
// The room sheet's scenes (views/lights_map.js roomScenes + openRoomSheet):
// the room's own scenes and scripts, by the entity's area or its device's,
// named, sorted, at most six; hidden, disabled or unavailable ones never; a
// tap runs it through Home Assistant and closes the sheet.
//
// Run:  node tests/js/room_scenes.mjs <www/padspan-ha dir>

import { pathToFileURL } from "node:url";
import { join } from "node:path";
import { install } from "./dom_shim.mjs";

const WWW = process.argv[2];
if (!WWW) { console.error("usage: room_scenes.mjs <www/padspan-ha dir>"); process.exit(2); }
install(globalThis);
const LM = await import(pathToFileURL(join(WWW, "views", "lights_map.js")).href);

const cases = {}, failures = [];
const check = (name, ok, detail) => { cases[name] = !!ok; if (!ok) failures.push({ name, detail: detail ?? null }); };
const st = (name, state = "scening") => ({ state, attributes: { friendly_name: name } });
const calls = [];
const hass = {
  areas: { kit: { area_id: "kit", name: "Kitchen" }, den: { area_id: "den", name: "Den" } },
  devices: { d1: { id: "d1", area_id: "kit" } },
  entities: {
    "scene.kitchen_bright": { entity_id: "scene.kitchen_bright", area_id: "kit" },
    "scene.cooking": { entity_id: "scene.cooking", device_id: "d1" },              // its device's area
    "script.kitchen_dim": { entity_id: "script.kitchen_dim", area_id: "kit" },
    "scene.kitchen_hidden": { entity_id: "scene.kitchen_hidden", area_id: "kit", hidden: true },
    "scene.kitchen_gone": { entity_id: "scene.kitchen_gone", area_id: "kit" },
    "scene.den_movie": { entity_id: "scene.den_movie", area_id: "den" },
    "light.kitchen": { entity_id: "light.kitchen", area_id: "kit" },
  },
  states: {
    "scene.kitchen_bright": st("Bright"), "scene.cooking": st("Cooking"), "script.kitchen_dim": st("Dim", "off"),
    "scene.kitchen_hidden": st("Hidden"), "scene.kitchen_gone": st("Gone", "unavailable"), "scene.den_movie": st("Movie"),
  },
  callService: (d, s, data) => { calls.push([d, s, data.entity_id]); return Promise.resolve(); },
};

const k = LM.roomScenes(hass, "kitchen");
check("scenes: the room's own (entity or device area), by name; never hidden or unavailable, never another room's",
  JSON.stringify(k.map(x => x.name)) === JSON.stringify(["Bright", "Cooking", "Dim"]), k);
check("scenes: none for a room with none, or no registry", LM.roomScenes(hass, "Laundry").length === 0 && LM.roomScenes({}, "Kitchen").length === 0
  && LM.roomScenes(null, "Kitchen").length === 0);
const many = { ...hass, entities: { ...hass.entities }, states: { ...hass.states } };
for (let i = 0; i < 9; i++) { many.entities[`scene.k${i}`] = { area_id: "kit" }; many.states[`scene.k${i}`] = st(`K${i}`); }
check("scenes: at most six", LM.roomScenes(many, "Kitchen").length === 6);

// The sheet: a ▶ button per scene; a tap runs it and closes the sheet.
const toasts = [];
const api = { hass, setMany() {}, toast: (m) => toasts.push(m), floodLatches: {}, doorInvertByEid: {} };
LM.openRoomSheet(api, [], "Kitchen");
const btns = document.body._all ? document.body._all().filter(n => n.tagName === "BUTTON") : [...document.querySelectorAll("button")];
const play = btns.find(b => b.textContent === "▶ Cooking");
if (play) play.dispatchEvent({ type: "click", stopPropagation() {}, preventDefault() {} });
await new Promise(r => (globalThis._realSetTimeout || setTimeout)(r, 5));
check("sheet: ▶ per scene; a tap runs it through Home Assistant",
  !!play && JSON.stringify(calls) === JSON.stringify([["scene", "turn_on", "scene.cooking"]]) && toasts.includes("Cooking"),
  { labels: btns.map(b => b.textContent), calls, toasts });

console.log(JSON.stringify({ cases, failures }));
process.exit(failures.length ? 1 : 0);
