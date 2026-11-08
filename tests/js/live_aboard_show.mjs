// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
//
// Live Aboard's ⋯ list, "Show on this screen" (views/live_aboard_show.js),
// run for real inside the real 3D view under the DOM shim with a stub GL, on
// a small house with one of everything the list names:
//
//   button    ⋯ beside the compass, clear of it; the list opens grouped, the
//             alarms ticked and greyed; it closes on ✕, Escape, a tap
//             elsewhere and the idle flight home
//   prefs     a tick is this screen's (prefs, show_<screen>); back at the
//             house's own it is forgotten; nothing of the house is written
//   hide      each line hides what it names and nothing else: lights,
//             strips, fans, readouts, locks, motion's three parts, doors,
//             windows, garage doors, railings, names, outlines, receivers,
//             tags, people, codes, rain, the theme; an alarm never
//   setup     a line this house hasn't set up says so, and "Set it up" goes
//             there through the host (Settings → Atlas → Outdoor weather);
//             ready, a line never says so; no way there, it names the place
//   people    people off for the house: ticking them takes an administrator
//             to the switch (Views ▾ → Show people, marked); anyone else is
//             told an administrator turns it on
//   reset     Back to house defaults forgets every tick, trails and roof too
//   report    each count is a word of the closed list, sent as it happens
//   rest      a poll rebuilds nothing because of the list; at rest no frames
//
// usage: live_aboard_show.mjs <www/padspan-ha dir>
// prints one JSON line: { cases: {name: result}, failures: [...], lists }

import { pathToFileURL } from "node:url";
import { join } from "node:path";
import * as shim from "./dom_shim.mjs";
import { installStubGL } from "./stub_gl.mjs";

const WWW = process.argv[2];
if (!WWW) { console.error("usage: live_aboard_show.mjs <www/padspan-ha dir>"); process.exit(2); }
shim.install();
{
  const NP = globalThis.Node.prototype, ap = NP.appendChild, ib = NP.insertBefore, rc = NP.removeChild;
  const leave = (c) => { const p = c && c.parentNode; if (p && p.children) { const i = p.children.indexOf(c); if (i >= 0) p.children.splice(i, 1); } };
  NP.appendChild = function(c){ leave(c); return ap.call(this, c); };
  NP.insertBefore = function(c, ref){ leave(c); return ib.call(this, c, ref); };
  NP.removeChild = function(c){ const r = rc.call(this, c); if (c && c.parentNode === this) c.parentNode = null; return r; };
}
const lists = { window: {}, document: {} };
const listen = (key) => ({
  add: (t, fn) => { (lists[key][t] ||= []).push(fn); },
  remove: (t, fn) => { lists[key][t] = (lists[key][t] || []).filter(f => f !== fn); },
});
const W = listen("window"), Dc = listen("document");
globalThis.addEventListener = W.add; globalThis.removeEventListener = W.remove;
document.addEventListener = Dc.add; document.removeEventListener = Dc.remove;
const fire = (key, type, e) => { for (const fn of [...(lists[key][type] || [])]) fn({ type, ...e }); };
installStubGL();

let clockOff = 0;
const clock0 = performance.now(), date0 = Date.now();
performance.now = () => clock0 + clockOff;
Date.now = () => date0 + clockOff;
const shimRaf = globalThis.requestAnimationFrame;
globalThis.requestAnimationFrame = (fn) => shimRaf(() => fn(performance.now()));
const pendingFrames = () => shim.rafQueue.filter(Boolean).length;

const url = (p) => pathToFileURL(join(WWW, p)).href;
const LA = await import(url("views/live_aboard.js"));
const SHOW = await import(url("views/live_aboard_show.js"));
const HOUSE = await import(url("views/live_aboard_house.js"));
const LM = await import(url("views/lights_map.js"));

const failures = [];
const cases = {};
const check = (name, ok, detail) => { cases[name] = !!ok; if (!ok) failures.push({ name, detail: detail === undefined ? null : detail }); };
const tryCase = async (name, fn) => {
  try { await fn(); } catch (e) { failures.push({ name, detail: String(e && e.stack || e).slice(0, 900) }); cases[name] = false; }
};
const settle = async (rounds = 14) => { await shim.flush(rounds); await new Promise(r => globalThis._realSetTimeout(r, 0)); };
async function later(ms, rounds = 8){ clockOff += ms; await settle(rounds); }

// ── a small house with one of everything ────────────────────────────────────
const rect = (floor_id, x0, y0, x1, y1) => ({ type: "poly", floor_id, points_m: [[x0, y0], [x1, y0], [x1, y1], [x0, y1]] });
const ago = (min) => new Date(date0 - min * 60e3).toISOString();
const MODEL = {
  floors: [{ id: "main", name: "Main", level: 0 }, { id: "up", name: "Upstairs", level: 1 }],
  floor_elevations: { main: 0, up: 2.8 },
  room_geometry_m: { Kitchen: rect("main", 0, 0, 6, 4), Hall: rect("main", 6, 0, 10, 4), Loft: rect("up", 0, 0, 5, 4), Deck: rect("up", 5, 0, 8, 4) },
  light_positions_m: {
    "light.kitchen_ceiling": { x_m: 3, y_m: 2, floor_id: "main" },
    "light.kitchen_strip": { x_m: 1, y_m: 3.8, floor_id: "main", width_cm: 200, height_cm: 10 },
    "fan.hall_fan": { x_m: 8, y_m: 2, floor_id: "main" },
    "binary_sensor.hall_motion": { x_m: 9, y_m: 1, floor_id: "main" },
    "sensor.hall_temp": { x_m: 7, y_m: 3, floor_id: "main" },
    "lock.back": { x_m: 0.2, y_m: 2, floor_id: "main" },
    "binary_sensor.kitchen_leak": { x_m: 5, y_m: 3, floor_id: "main" },
  },
  rf_barriers_m: [
    { id: "b_door", name: "Back door", material: "wood", floor_id: "main", points_m: [[1, 0], [2, 0]], linked_entity_id: "binary_sensor.back_door" },
    { id: "b_win", name: "Kitchen window", material: "glass", floor_id: "main", points_m: [[3, 0], [5, 0]], linked_entity_id: "binary_sensor.kitchen_window" },
    { id: "b_plain", name: "Hall door", material: "wood", floor_id: "main", points_m: [[6, 1], [6, 2]] },
  ],
  scanner_positions_m: { "AA:BB:CC:DD:EE:01": { x_m: 2, y_m: 1, floor_id: "main", z_m: 2.2 } },
  scanners: {},
};
const BASE = {
  "binary_sensor.back_door": { state: "off", attributes: { friendly_name: "Back door", device_class: "door" } },
  "binary_sensor.kitchen_window": { state: "off", attributes: { friendly_name: "Kitchen window", device_class: "window" } },
  "light.kitchen_ceiling": { state: "on", attributes: { friendly_name: "Kitchen ceiling light", brightness: 200 } },
  "light.kitchen_strip": { state: "on", attributes: { friendly_name: "Kitchen LED strip", brightness: 200 } },
  "fan.hall_fan": { state: "off", attributes: { friendly_name: "Hall fan" } },
  "binary_sensor.hall_motion": { state: "on", attributes: { friendly_name: "Hall motion", device_class: "motion" }, last_changed: ago(1) },
  "sensor.hall_temp": { state: "21.4", attributes: { friendly_name: "Hall temp", device_class: "temperature", unit_of_measurement: "°C" }, last_updated: ago(5) },
  "lock.back": { state: "locked", attributes: { friendly_name: "Back lock" } },
  "binary_sensor.kitchen_leak": { state: "off", attributes: { friendly_name: "Kitchen leak", device_class: "moisture" } },
  "person.alex": { state: "home", attributes: { friendly_name: "Alex", device_trackers: [] } },
  "media_player.tv": { state: "playing", attributes: { friendly_name: "TV" } },
};
// Furniture (the 3D file): a sofa, a TV that is a device, and stairs up.
const piece = (id, kind, x, y, eid, params = {}) => ({ id, recipe: { kind, params, colors: [], width_m: 1, depth_m: 0.8, height_m: 0.9 },
  origin: "build", label: "", floor_id: "main", x_m: x, y_m: y, z_m: 0, rotation: 0, entity_id: eid, entity_reg_id: null });
const PIECES = { fur_00000001: piece("fur_00000001", "sofa", 2, 2, null), fur_00000002: piece("fur_00000002", "tv", 4, 3.5, "media_player.tv"),
                 fur_00000003: piece("fur_00000003", "stairs", 8.5, 2.5, null, { to_floor: "up" }) };
const STATES = Object.fromEntries(Object.entries(BASE).map(([eid, s]) => [eid, { entity_id: eid, last_changed: ago(600), last_updated: ago(600), ...s }]));
const LBE = Object.fromEntries(LM.gatherLights(STATES, {}, {}, "pro", {}, {}, {}, {}, date0).map(l => [l.entity_id, l]));

// ── the host: the sidebar's, with its settings ──────────────────────────────
const SENT = [];
const H = { sent: [], went: [], toasts: [], settings: null, admin: true, weather: null, saved: [] };
const store = new Map();
const prefs = { get: (k) => store.get(k) ?? null, set: (k, v) => store.set(k, String(v)) };
const host = document.createElement("padspan-lights-app");
const shadow = document.createElement("#shadow-root");
shadow.host = host;
document.body.appendChild(host);
host.appendChild(shadow);
const SNAP = { objects: { list: [{ key: "ble:keys", kind: "ble", x_m: 4, y_m: 2, floor_id: "main", user_label: "Keys", room: "Kitchen", age_s: 3 }] } };
const SET = (over = {}) => ({ atlas_3d_enabled: true, atlas_3d_people: true, atlas_3d_tags: true, atlas_3d_home_idle_s: 60, ...over });
const P = () => ({ model: MODEL, floors: MODEL.floors, lightsByEid: LBE, hidden: new Set(), topFloorIds: null, quality: "low",
  telemetry: (name) => { H.sent.push(name); SENT.push(name); }, onTouch: () => {}, states: STATES, config: {}, bearing: 0, saveNorth: null, useApi: () => null,
  haStartedMs: 0, load: async () => ({ data: { schema: 1, pieces: PIECES, lights: {}, openings: {}, devices: {}, figures: {} } }),
  edit: null, furnish: null, mapOnly: true, floorSteps: null, prefs,
  weather: H.weather, weather3d: H.settings && H.settings.atlas_3d_weather,
  showcase: { key: "classic", theme: {} }, look3d: "atlas", atlasLook: { on: false, key: "classic", theme: {} },
  codes: { showcase: false },
  people: H.settings && H.settings.atlas_3d_people ? { snapshot: () => SNAP } : null,
  tags: H.settings && H.settings.atlas_3d_tags ? { snapshot: () => SNAP } : null,
  settings3d: H.settings, admin: H.admin, saveSetting: async (k, v) => { H.saved.push([k, v]); return true; },
  goTo: (t) => H.went.push(t) });
let slot = null;
function poll(){
  const c = document.createElement("div"), stage = document.createElement("div");
  c.appendChild(stage);
  const content = shadow.children.find(n => n.className === "content") || shadow.appendChild(Object.assign(document.createElement("div"), { className: "content" }));
  content.replaceChildren(c);
  return slot.attach(stage, P());
}
function inTree(n, top){ for (let x = n; x; x = x.parentNode) if (x === top) return true; return false; }
async function open(key){
  slot = LA.liveAboardSlot(key);
  poll();
  const el = slot.element;
  if (el && !el.getRootNode) el.getRootNode = () => (inTree(el, shadow) ? shadow : el);
  poll();
  await settle(30);
  return slot;
}
const S = () => slot._state();
const q = (sel) => slot.element.querySelector(sel);
const qa = (sel) => slot.element.querySelectorAll(sel);
const click = (b) => b && b.dispatchEvent({ type: "click", detail: 1, stopPropagation() {}, preventDefault() {}, composedPath: () => [b] });
const more = () => q("[data-la3d-more]");
const row = (key) => qa(".la3d-srow").find(r => r.getAttribute("data-show") === key) || null;
const tick = (key) => { const r = row(key); return r ? r.querySelector(".la3d-stick") : null; };
const ticked = (key) => { const t = tick(key); return t ? t.getAttribute("aria-checked") === "true" : null; };
const setupOf = (key) => qa(".la3d-setup").find(r => r.getAttribute("data-setup") === key) || null;
const showPref = () => JSON.parse(store.get("show_show-a") || "{}");
async function toggle(key){ click(tick(key)); await settle(); }

H.settings = SET();
await open("show-a");

// ── the button and the list ─────────────────────────────────────────────────
await tryCase("button: ⋯ beside the compass, clear of it, and the list opens grouped with the alarms ticked and greyed", async () => {
  const b = more(), compass = q(".la3d-compass");
  click(b);
  await settle();
  const groups = qa(".la3d-sgrp").map(g => g.getAttribute("aria-label"));
  const keys = qa(".la3d-srow").map(r => r.getAttribute("data-show"));
  const alarm = tick("alarms");
  // This host hands in no scenes (Mapping's, say): no Scene row line (tests/js/scene_row.mjs has the sidebar's).
  const want = SHOW.SHOW_ITEMS.filter(it => !it.later && it.key !== "scenes").map(it => it.key);
  check("button: ⋯ beside the compass, clear of it, and the list opens grouped with the alarms ticked and greyed",
    b && compass && b.parentNode === compass.parentNode && b.textContent === "⋯" && b.getAttribute("aria-expanded") === "true"
    && S().show.menu.open && groups.length === SHOW.SHOW_GROUPS.length && want.every(k => keys.includes(k)) && !keys.includes("scenes")
    && alarm && alarm.getAttribute("aria-checked") === "true" && alarm.getAttribute("aria-disabled") === "true"
    && H.sent.includes("house3d_show:opened"),
    { groups, keys, sent: H.sent });
});
await tryCase("button: the list closes on ✕, Escape, a tap elsewhere, and the flight home", async () => {
  click(q(".la3d-sx")); await settle();
  const x = !S().show.menu.open;
  click(more()); await settle();
  fire("window", "keydown", { key: "Escape" }); await settle();
  const esc = !S().show.menu.open;
  click(more()); await settle();
  const canvas = q("canvas");
  fire("window", "pointerdown", { composedPath: () => [canvas, slot.element] }); await settle();
  const away = !S().show.menu.open;
  click(more()); await settle();
  slot._panel().goHome(); await settle();
  const home = !S().show.menu.open;
  check("button: the list closes on ✕, Escape, a tap elsewhere, and the flight home", x && esc && away && home, { x, esc, away, home });
});
await tryCase("button: an open list or menu sits over Vacation Mode's banner, which is on top again once it closes", async () => {
  // The banner (styles.css .lv-vacation) is pinned dead centre above the map
  // (z 40); while the list or Views ▾ is open the panel's element says so,
  // and the view's own rule puts the banner under its menus.
  const marked = () => host.hasAttribute("data-la3d-menu");
  const was = marked();
  click(more()); await settle();
  const list = marked();
  click(q(".la3d-sx")); await settle();
  const listShut = !marked();
  const views = qa("button").find(b => (b.textContent || "").startsWith("Views"));
  click(views); await settle();
  const menu = marked() && S().screen.menu;
  click(views); await settle();
  const menuShut = !marked() && !S().screen.menu;
  const css = qa("style").map(s => s.textContent).join("\n");
  const z = (re) => { const m = re.exec(css); return m ? Number(m[1]) : null; };
  const bannerZ = z(/:host\(\[data-la3d-menu\]\) \.lv-mapcard > \.lv-vacation\{z-index:(\d+)\}/);
  const menuZ = z(/\.la3d-menu\{position:absolute;z-index:(\d+)/), showZ = z(/\.la3d-show\{position:absolute;[^}]*?z-index:(\d+)/);
  check("button: an open list or menu sits over Vacation Mode's banner, which is on top again once it closes",
    !was && list && listShut && views && menu && menuShut && bannerZ !== null && bannerZ < menuZ && bannerZ < showZ,
    { was, list, listShut, views: !!views, menu, menuShut, bannerZ, menuZ, showZ });
});

// ── a tick is this screen's ─────────────────────────────────────────────────
await tryCase("prefs: a tick is this screen's; back at the house's own it is forgotten; nothing of the house is written", async () => {
  click(more()); await settle();
  await toggle("motion_sensors");
  const off = { pref: showPref(), on: S().show.on.motion_sensors, ticked: ticked("motion_sensors"), dot: S().show.menu.changed };
  await toggle("motion_sensors");
  const back = { pref: showPref(), on: S().show.on.motion_sensors, ticked: ticked("motion_sensors"), dot: S().show.menu.changed };
  // Another screen of this browser is not touched.
  check("prefs: a tick is this screen's; back at the house's own it is forgotten; nothing of the house is written",
    off.pref.motion_sensors === false && off.on === false && off.ticked === false && off.dot
    && !("motion_sensors" in back.pref) && back.on === true && back.ticked === true && !back.dot && H.saved.length === 0 && !store.has("show_show-b"),
    { off, back, saved: H.saved });
});

// ── what each line hides ────────────────────────────────────────────────────
const fixtures = () => S().fixtures.map(f => f.eid).sort();
await tryCase("hide: lights, LED strips and fans each hide only their own fixtures", async () => {
  const all = fixtures();
  await toggle("lights");
  const noLights = fixtures();
  await toggle("strips");
  const noStrips = fixtures();
  await toggle("fans");
  const none = fixtures();
  await toggle("lights"); await toggle("strips"); await toggle("fans");
  const again = fixtures();
  check("hide: lights, LED strips and fans each hide only their own fixtures",
    all.join() === "fan.hall_fan,light.kitchen_ceiling,light.kitchen_strip" && noLights.join() === "fan.hall_fan,light.kitchen_strip"
    && noStrips.join() === "fan.hall_fan" && none.length === 0 && again.join() === all.join(), { all, noLights, noStrips, none, again });
});
await tryCase("hide: Light glow leaves the bulbs and takes the glow, pools and lamps away", async () => {
  await later(500, 30);
  const before = { halos: S().look.halos, lamps: S().lamps.length };
  await toggle("glow");
  await later(500, 30);
  const after = { halos: S().look.halos, lamps: S().lamps.length, fixtures: fixtures().length };
  await toggle("glow");
  check("hide: Light glow leaves the bulbs and takes the glow, pools and lamps away",
    before.halos > 0 && after.halos === 0 && after.lamps === 0 && after.fixtures === 3, { before, after });
});
await tryCase("hide: readouts and locks go; the leak alarm never does", async () => {
  const chips0 = S().chips.length, marks0 = S().marks.map(m => m.eid || m.kind);
  await toggle("readouts"); await toggle("locks");
  const chips1 = S().chips.length, marks1 = S().marks.map(m => m.eid || m.kind);
  // The alarm's line can't be unticked.
  click(tick("alarms")); await settle();
  const marks2 = S().marks.map(m => m.eid || m.kind);
  await toggle("readouts"); await toggle("locks");
  check("hide: readouts and locks go; the leak alarm never does",
    chips0 === 1 && chips1 === 0 && marks0.length === 2 && marks1.length === 1 && JSON.stringify(marks1).includes("leak") && marks2.length === 1
    && !("alarms" in showPref()), { chips0, chips1, marks0, marks1, marks2 });
});
await tryCase("hide: motion's three parts, each on its own; the Motion chip goes with motion in rooms", async () => {
  const L = () => S().motionLayer;
  await toggle("motion_sensors");
  const a = L().parts, shown = L().sensors.some(s => s.shown);
  await toggle("motion_sensors"); await toggle("motion_rooms");
  const b = { parts: L().parts, fill: L().patches.map(p => p.fill), chip: S().motionChip.shown };
  await toggle("motion_rooms"); await toggle("motion_reach");
  const c = L().parts;
  await toggle("motion_reach");
  await later(200, 20);
  check("hide: motion's three parts, each on its own; the Motion chip goes with motion in rooms",
    a.sensor === false && a.room && a.reach && !shown && b.parts.room === false && b.parts.sensor && b.fill.every(f => f === 0) && b.chip === false
    && c.reach === false && c.sensor && c.room && L().parts.room && S().motionChip.shown, { a, shown, b, c, chip: S().motionChip });
});
await tryCase("hide: doors, windows and railings go from the walls; the doorway stays open", async () => {
  const kinds = (pred) => S().show.walls.filter(pred).map(w => w.drawn);
  const d0 = kinds(w => w.kind === "door"), w0 = kinds(w => w.kind === "window");
  await toggle("doors");
  const d1 = kinds(w => w.kind === "door"), w1 = kinds(w => w.kind === "window");
  await toggle("windows");
  const w2 = kinds(w => w.kind === "window");
  await toggle("doors"); await toggle("windows");
  const d3 = kinds(w => w.kind === "door"), w3 = kinds(w => w.kind === "window");
  check("hide: doors, windows and railings go from the walls; the doorway stays open",
    d0.length >= 2 && d0.every(Boolean) && w0.length === 1 && w0[0] && d1.every(v => !v) && w1[0] && !w2[0] && d3.every(Boolean) && w3[0],
    { d0, w0, d1, w1, w2, d3, w3 });
});
await tryCase("hide: room names and outlines, receivers, tags, people, codes, rain and the theme", async () => {
  const tracked = () => S().tracked.map(t => t.kind).sort();
  const t0 = tracked();
  await toggle("radios");
  const noRadios = tracked();
  await toggle("tags");
  const noTags = tracked();
  await toggle("people");
  await toggle("radios"); await toggle("tags"); await toggle("people");
  const t3 = tracked();
  await toggle("room_names");
  await later(200, 20);
  const names = S().names.filter(n => n.shown).length;
  await toggle("room_names");
  await later(200, 20);
  const namesBack = S().names.filter(n => n.shown).length;
  await toggle("theme");
  const theme = S().look.key, stillOpen = S().show.menu.open;
  await toggle("theme");
  const themeBack = S().look.key;
  const codesOn = S().codes;
  await toggle("codes");
  const codesOff = S().codes;
  await toggle("codes");
  check("hide: room names and outlines, receivers, tags, people, codes, rain and the theme",
    t0.includes("scanner") && t0.includes("beacon") && !noRadios.includes("scanner") && noRadios.includes("beacon") && !noTags.includes("beacon")
    && JSON.stringify(t3) === JSON.stringify(t0) && names === 0 && namesBack > 0 && theme === "classic" && stillOpen && themeBack !== "classic" && codesOn.chips.length > 0 && codesOff.chips.length === 0,
    { t0, noRadios, noTags, t3, names, namesBack, theme, themeBack, codesOn, codesOff, stillOpen });
});

await tryCase("hide: railings, furniture, devices in furniture and stairs, room and floor outlines", async () => {
  const rails = () => S().show.walls.filter(w => w.kind === "rail").map(w => w.drawn);
  const pieces = () => S().pieces.map(x => x.id || x.key || JSON.stringify(x).slice(0, 20)).sort();
  const r0 = rails(), p0 = pieces(), e0 = S().show.edges, pl0 = S().show.plates;
  await toggle("railings");
  const r1 = rails();
  await toggle("furniture");
  const p1 = pieces();
  await toggle("devices");
  const p2 = pieces();
  await toggle("stairs");
  const p3 = pieces();
  await toggle("room_outlines"); await toggle("floor_outlines");
  const e1 = S().show.edges, pl1 = S().show.plates;
  for (const k of ["railings", "furniture", "devices", "stairs", "room_outlines", "floor_outlines"]) await toggle(k);
  check("hide: railings, furniture, devices in furniture and stairs, room and floor outlines",
    r0.length > 0 && r0.every(Boolean) && r1.every(v => !v) && p0.length === 3 && p1.length === 2 && p2.length === 1 && p3.length === 0
    && rails().every(Boolean) && pieces().length === 3 && e0.some(Boolean) && e1.every(v => !v) && pl0.length > 0 && pl0.every(Boolean) && pl1.every(v => !v)
    && S().show.edges.some(Boolean) && S().show.plates.every(Boolean), { r0, r1, p0, p1, p2, p3, e0, e1, pl0, pl1 });
});

// ── not set up ──────────────────────────────────────────────────────────────
await tryCase("setup: rain with no weather source says so, and Set it up goes to Settings → Atlas → Outdoor weather", async () => {
  H.sent.length = 0;
  const line = setupOf("rain");
  const text = line ? line.textContent : "";
  const ready = ["lights", "strips", "fans", "motion_sensors", "readouts", "locks", "doors", "windows", "radios", "tags", "people", "codes", "room_names"]
    .filter(k => setupOf(k));
  const seen = H.sent.filter(n => n === "house3d_show:setup_seen:rain").length;
  click(line && line.querySelector("button"));
  await settle();
  check("setup: rain with no weather source says so, and Set it up goes to Settings → Atlas → Outdoor weather",
    /Rain and snow aren't set up yet/.test(text) && /Set it up/.test(text) && ticked("rain") === null && ready.length === 0
    && H.went.length === 1 && H.went[0].view === "settings" && H.went[0].tab === "atlas" && H.went[0].part === "atlas_weather"
    && H.sent.includes("house3d_show:setup_go:rain") && !S().show.menu.open,
    { text, ready, went: H.went, sent: H.sent, seen });
  // Seen again on another opening: counted once a page load.
  click(more()); await settle();
  check("setup: a line seen is counted once a page load", SENT.filter(n => n === "house3d_show:setup_seen:rain").length === 1, SENT);
});
await tryCase("setup: with a weather source rain is ready and says nothing; with no way there the line names the place", async () => {
  H.weather = { settings: { atlas_weather_enabled: true, atlas_weather_condition_entity: "weather.home" }, states: { "weather.home": { state: "sunny" } }, entities: {} };
  poll(); await settle();
  click(more()); click(more()); await settle();
  const ready = !setupOf("rain") && ticked("rain") === true;
  H.weather = null;
  const goTo = P.goTo;
  const P0 = P;
  // A host with no way there (Basic): the line names the place, with no button.
  const saved = H.admin;
  slot.attach(document.createElement("div"), { ...P0(), goTo: null });
  poll();
  const p1 = { ...P0(), goTo: null };
  const c = document.createElement("div"), stage = document.createElement("div"); c.appendChild(stage);
  shadow.children.find(n => n.className === "content").replaceChildren(c);
  slot.attach(stage, p1); await settle();
  click(more()); click(more()); await settle();
  const line = setupOf("rain");
  const named = line ? line.textContent : "";
  const button = line ? !!line.querySelector("button") : null;
  H.admin = saved; void goTo;
  poll(); await settle();
  check("setup: with a weather source rain is ready and says nothing; with no way there the line names the place",
    ready && /Settings → Atlas → Outdoor weather/.test(named) && button === false, { ready, named, button });
});

// ── people off for the house ────────────────────────────────────────────────
await tryCase("people: off for the house, ticking People takes an administrator to the switch in Views ▾", async () => {
  H.settings = SET({ atlas_3d_people: false }); poll(); await settle();
  H.sent.length = 0;
  click(more()); click(more()); await settle();
  const line = setupOf("people") ? setupOf("people").textContent : "";
  click(tick("people")); await settle();
  const menu = q(".la3d-menu");
  const sw = menu ? menu.querySelectorAll("button").find(b => b.textContent.startsWith("Show people")) : null;
  check("people: off for the house, ticking People takes an administrator to the switch in Views ▾",
    /People are off for the whole house/.test(line) && !S().show.menu.open && !!sw && /fbbf24/.test(sw.style.outline || "")
    && H.sent.includes("house3d_show:permission:people") && H.saved.length === 0, { line, sw: sw && sw.textContent, sent: H.sent });
});
await tryCase("people: anyone else is told an administrator turns it on, and nothing opens", async () => {
  H.admin = false; poll(); await settle();
  click(q("[data-la3d-saved]").querySelector("button")); await settle();      // close the Views menu
  click(more()); await settle();
  const line = setupOf("people") ? setupOf("people").textContent : "";
  const btn = setupOf("people") ? setupOf("people").querySelector("button") : "none";
  const links = qa(".la3d-slink").length;
  click(tick("people")); await settle();
  const toast = q(".la3d-toast");
  H.admin = true; H.settings = SET(); poll(); await settle();
  check("people: anyone else is told an administrator turns it on, and nothing opens",
    /an administrator turns them on \(Views ▾ → Show people\)/.test(line) && !btn && links === 0 && toast && /administrator/.test(toast.textContent)
    && !q(".la3d-menu"), { line, toast: toast && toast.textContent });
});

// ── back to house defaults ──────────────────────────────────────────────────
await tryCase("reset: Back to house defaults forgets every tick, trails and roof too", async () => {
  if (!S().show.menu.open) { click(more()); await settle(); }
  await toggle("doors"); await toggle("lights"); await toggle("roof");
  const had = { pref: showPref(), roof: store.get("roof_show-a") };
  H.sent.length = 0;
  click(q(".la3d-sreset")); await settle();
  check("reset: Back to house defaults forgets every tick, trails and roof too",
    had.pref.doors === false && had.pref.lights === false && had.roof === "off" && Object.keys(showPref()).length === 0
    && store.get("roof_show-a") === "auto" && fixtures().length === 3 && S().show.walls.filter(w => w.kind === "door").every(w => w.drawn)
    && H.sent.includes("house3d_show:reset") && !S().show.menu.changed, { had, sent: H.sent });
});

// ── the report ──────────────────────────────────────────────────────────────
await tryCase("report: every count sent is a word of the closed list", async () => {
  const all = new Set(HOUSE.HOUSE3D_EVENTS);
  const sent = [...new Set(SENT)];
  check("report: every count sent is a word of the closed list",
    SHOW.SHOW_EVENTS.every(e => all.has(e)) && SENT.every(n => all.has(n)) && SENT.length > 10, { bad: sent.filter(n => !all.has(n)) });
});

// ── at rest ─────────────────────────────────────────────────────────────────
await tryCase("rest: with lines hidden a poll rebuilds nothing, and at rest no frames", async () => {
  await toggle("lights"); await toggle("doors"); await toggle("motion_sensors"); await toggle("readouts");
  click(q(".la3d-sx")); await settle();
  await later(1000, 40);
  const w0 = { ...S().work }, f0 = S().frames;
  for (let i = 0; i < 4; i++) { poll(); await later(5000, 10); }
  const w1 = S().work;
  await later(60000, 30);
  const s = S();
  check("rest: with lines hidden a poll rebuilds nothing, and at rest no frames",
    w1.shells === w0.shells && w1.lights === w0.lights && w1.sensors === w0.sensors && w1.reads === w0.reads
    && s.frames - f0 <= 4 && pendingFrames() === 0, { w0, w1, frames: s.frames - f0, liveMs: s.liveMs });
});

LA.releaseLiveAboardSlot("show-a");
console.log(JSON.stringify({ cases, failures, lists: { events: SHOW.SHOW_EVENTS, keys: SHOW.SHOW_KEYS } }));
