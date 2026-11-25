// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
//
// RUN Settings → Tracking → Home Assistant and integrations → Lights follow people (views/lights_follow.js):
// off until ticked; a room added with its area's lights and sensors; people in or out; every change saved.
//
// usage: lights_follow.mjs <views-dir>
// prints one JSON line: { cases: {name: result}, failures: [...] }

import { pathToFileURL } from "node:url";
import { join } from "node:path";
import { install } from "./dom_shim.mjs";

const VIEWS = process.argv[2];
if (!VIEWS) { console.error("usage: lights_follow.mjs <views-dir>"); process.exit(2); }
install(globalThis);

function el(tag, attrs = {}, children = []) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (k === "class") n.className = v;
    else if (k === "value") n.value = v;
    else if (v !== undefined && v !== null) n.setAttribute(k, String(v));
  }
  for (const c of (Array.isArray(children) ? children : [children])) {
    if (c === null || c === undefined || c === false) continue;
    n.appendChild(typeof c === "string" || typeof c === "number" ? document.createTextNode(String(c)) : c);
  }
  return n;
}
const failures = [], cases = {};
const check = (name, ok, detail) => { cases[name] = !!ok; if (!ok) failures.push({ name, detail: detail === undefined ? null : detail }); };
const settle = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
const LF = await import(pathToFileURL(join(VIEWS, "lights_follow.js")).href);

const STATES = {
  "light.kitchen": { state: "off", attributes: { friendly_name: "Kitchen ceiling" } },
  "light.den": { state: "off", attributes: { friendly_name: "Den lamp" } },
  "switch.hall": { state: "off", attributes: { friendly_name: "Hall switch" } },
  "binary_sensor.kitchen_motion": { state: "off", attributes: { friendly_name: "Kitchen motion", device_class: "motion" } },
  "binary_sensor.door": { state: "off", attributes: { friendly_name: "Door", device_class: "door" } },
  "sensor.kitchen_lux": { state: "30", attributes: { friendly_name: "Kitchen lux", device_class: "illuminance" } },
  "sensor.temp": { state: "21", attributes: {} },
};
const INFO = {
  enabled: true, rooms: {}, now: {},
  room_names: ["Den", "Hall", "Kitchen"],
  area_lights: { Kitchen: ["light.kitchen"] }, area_sensors: { Kitchen: ["binary_sensor.kitchen_motion"] },
  people: [{ name: "Alex phone", guest: false, counts: true }, { name: "Guest tag 1", guest: true, counts: false }],
};
function page(settings) {
  const sent = [], reads = [], toasts = [];
  const ctx = {
    hass: { user: { is_admin: true }, states: STATES },
    state: { settings: { ...settings } },
    helpers: { errorText: (e) => String(e && e.message || e) },
    toast: (m, bad) => toasts.push([m, !!bad]),
    actions: {
      settingsSet: async (patch) => { sent.push(JSON.parse(JSON.stringify(patch))); },
      wsCall: async (type) => { reads.push(type); return { ...INFO, now: { Kitchen: { people: ["Alex phone"], held: true, lights_on: false } } }; },
    },
  };
  const card = LF.lightsFollowSection(ctx, el);
  return { card, sent, reads, toasts, ctx };
}
const all = (n) => n._all();
const find = (card, attr, val) => all(card).filter(n => n.getAttribute && (val === undefined ? n.getAttribute(attr) !== null : n.getAttribute(attr) === val));
const fire = (n, type) => n.dispatchEvent({ type, target: n });
const choose = async (sel, v) => { sel.value = v; fire(sel, "change"); await settle(); };

try {
  const c = LF.choices(STATES);
  check("choices: lights and switches, light sensors, motion sensors (a door is not one)",
    JSON.stringify(c.lights.map(r => r[0])) === JSON.stringify(["light.den", "light.kitchen", "switch.hall"])
    && JSON.stringify(c.lux.map(r => r[0])) === JSON.stringify(["sensor.kitchen_lux"])
    && JSON.stringify(c.sensors.map(r => r[0])) === JSON.stringify(["binary_sensor.kitchen_motion"]), c);

  // Off (a new or existing install): the switch only, unticked; nothing read, nothing saved.
  const off = page({});
  await settle();
  const tog = find(off.card, "data-lf-on")[0];
  check("off by default: one unticked switch, no rooms, nothing read or saved",
    tog && tog.checked === false && !find(off.card, "data-add-room").length && off.reads.length === 0 && off.sent.length === 0
    && off.card.textContent.includes("Lights follow people"), off.card.textContent.slice(0, 200));

  // Turned on: saved, then what the server knows is read and the rooms appear.
  tog.checked = true; fire(tog, "change"); await settle();
  check("turned on: the switch is saved and the rooms to add appear",
    JSON.stringify(off.sent[0]) === JSON.stringify({ lights_follow_enabled: true }) && off.reads.includes("padspan_ha/lights_follow_get")
    && find(off.card, "data-add-room").length === 1, { sent: off.sent, reads: off.reads });

  // A room added: its area's lights and motion sensor come with it, and it is saved at once.
  const p = page({ lights_follow_enabled: true });
  await settle();
  await choose(find(p.card, "data-add-room")[0], "Kitchen");
  const saved = p.sent.pop().lights_follow_rooms;
  check("add a room: it starts with its area's lights and sensors, two minutes, always, and is saved",
    JSON.stringify(saved) === JSON.stringify({ Kitchen: { lights: ["light.kitchen"], off_delay_s: 120, dark: "", lux_entity: "",
      lux_below: 50, quiet: "", sensors: ["binary_sensor.kitchen_motion"] } })
    && find(p.card, "data-room", "Kitchen").length === 1, saved);
  check("a room shows who is in it now, and a light turned off by hand",
    p.card.textContent.includes("Now: Alex phone") && p.card.textContent.includes("turned off by hand"), p.card.textContent.slice(0, 600));

  // A room whose area has no light: kept here until a light is picked, then saved.
  const before = p.sent.length;
  await choose(find(p.card, "data-add-room")[0], "Den");
  const waited = p.sent.length === before && p.card.textContent.includes("Pick a light: a room is saved once it has one.");
  await choose(find(p.card, "data-add-light", "Den")[0], "light.den");
  const den = p.sent.pop().lights_follow_rooms;
  check("a room with no light is saved once it has one", waited && den.Den && den.Den.lights[0] === "light.den" && den.Kitchen, den);

  // Options: the delay, the light sensor, quiet hours (half a range waits).
  await choose(find(p.card, "data-delay", "Kitchen")[0], "300");
  const d1 = p.sent.pop().lights_follow_rooms.Kitchen.off_delay_s;
  const nDark = p.sent.length;
  await choose(find(p.card, "data-dark", "Kitchen")[0], "lux");
  const luxWaited = p.sent.length === nDark;                 // no light sensor chosen yet: nothing to save
  await choose(find(p.card, "data-lux", "Kitchen")[0], "sensor.kitchen_lux");
  const k2 = p.sent.pop().lights_follow_rooms.Kitchen;
  const qf = find(p.card, "data-quiet-from", "Kitchen")[0], qt = find(p.card, "data-quiet-to", "Kitchen")[0];
  const nQuiet = p.sent.length;
  qf.value = "22:00"; fire(qf, "change"); await settle();
  const halfWaited = p.sent.length === nQuiet;
  qt.value = "07:00"; fire(qt, "change"); await settle();
  const k3 = p.sent.pop().lights_follow_rooms.Kitchen;
  check("options: off delay, a light sensor, quiet hours saved whole",
    d1 === 300 && luxWaited && k2.dark === "lux" && k2.lux_entity === "sensor.kitchen_lux"
    && halfWaited && k3.quiet === "22:00-07:00", { d1, luxWaited, k2, k3 });

  // People: a guest tag starts unticked; unticking someone is saved by name.
  const gcb = find(p.card, "data-person", "guest tag 1")[0], acb = find(p.card, "data-person", "alex phone")[0];
  const guestOff = gcb && gcb.checked === false && acb && acb.checked === true && p.card.textContent.includes("guest tag");
  acb.checked = false; fire(acb, "change"); await settle();
  check("people: everyone counts but guest tags; unticking someone is saved",
    guestOff && JSON.stringify(p.sent.pop()) === JSON.stringify({ lights_follow_people: { "alex phone": false } }), p.sent.slice(-2));

  // Removed: gone, and saved without it.
  find(p.card, "data-remove", "Den")[0].click(); await settle();
  const r = p.sent.pop().lights_follow_rooms;
  check("remove a room: saved without it", !("Den" in r) && "Kitchen" in r && !find(p.card, "data-room", "Den").length, r);

  // A refused save says so and leaves the switch as it was.
  const bad = page({});
  bad.ctx.actions.settingsSet = async () => { throw new Error("Only an admin can change this while Enhanced security is on"); };
  const bt = find(bad.card, "data-lf-on")[0];
  bt.checked = true; fire(bt, "change"); await settle();
  check("refused: the switch goes back and the reason is shown",
    bt.checked === false && bad.toasts.some(([m, b]) => b && m.includes("Enhanced security")), bad.toasts);

  check("delays read as words", LF.delayWords(30) === "30 s" && LF.delayWords(120) === "2 min" && LF.delayWords(3600) === "1 hour",
    [LF.delayWords(30), LF.delayWords(120), LF.delayWords(3600)]);
} catch (e) {
  failures.push({ name: "harness", detail: String((e && e.stack) || e) });
}
process.stdout.write(JSON.stringify({ cases, failures }) + "\n", () => process.exit(failures.length ? 1 : 0));
