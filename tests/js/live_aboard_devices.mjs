// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
//
// Live Aboard P5: furniture that is a device behaves like it
// (views/live_aboard_devices.js), read from fake states, then run for real
// inside the real 3D view (views/live_aboard.js) under the DOM shim with a
// stub GL.
//
//   look      each behaviour from its states: a lamp with its light (on,
//             off, colour, level; a plug behind it), a TV with its media
//             player, a fan with its speed, a washer running (on, a word,
//             watts), a robot vacuum or mower cleaning vs docked, a radiator
//             heating, a car or charger charging
//   link      a renamed entity followed by its registry id (the Atlas's
//             registry, or hass.entities); a deleted one unlinked
//   view      in the house: the lamp glows in its light's colour and its
//             fixture steps aside (its real light comes from the lamp); the
//             TV lights; the radiator warms; the charger glows; the robot
//             goes round on High and waits beside its dock on Low; the
//             washer shakes on High only; a gone entity wears "Unlinked" and
//             stays; while the emergency test runs, its lights are outlined
//   frames    at rest, 0 frames; a fan turning draws on its capped clock,
//             and stops when the fan does; a floor the chips hide costs none
//   taps      a press on a linked piece is its device: the Atlas's own
//             target for a light (and the same calls as tapping the light
//             on the flat Atlas, tap and hold); Home Assistant's own
//             controls for a device the Atlas has no marker for
//
// usage: live_aboard_devices.mjs <www/padspan-ha dir>
// prints one JSON line: { cases: {name: result}, failures: [...] }

import { pathToFileURL } from "node:url";
import { join } from "node:path";
import * as shim from "./dom_shim.mjs";
import { installStubGL } from "./stub_gl.mjs";

const WWW = process.argv[2];
if (!WWW) { console.error("usage: live_aboard_devices.mjs <www/padspan-ha dir>"); process.exit(2); }
shim.install();
const winL = {};
globalThis.addEventListener = (t, fn) => { (winL[t] ||= []).push(fn); };
globalThis.removeEventListener = (t, fn) => { winL[t] = (winL[t] || []).filter(f => f !== fn); };
installStubGL();

const LA = await import(pathToFileURL(join(WWW, "views", "live_aboard.js")).href);
const DV = await import(pathToFileURL(join(WWW, "views", "live_aboard_devices.js")).href);
const LM = await import(pathToFileURL(join(WWW, "views", "lights_map.js")).href);
const LC = await import(pathToFileURL(join(WWW, "views", "light_codes.js")).href);

const failures = [];
const cases = {};
const check = (name, ok, detail) => { cases[name] = !!ok; if (!ok) failures.push({ name, detail: detail === undefined ? null : detail }); };
const tryCase = async (name, fn) => {
  try { await fn(); } catch (e) { failures.push({ name, detail: String(e && e.stack || e).slice(0, 900) }); cases[name] = false; }
};
const clone = (x) => JSON.parse(JSON.stringify(x));
const settle = async (rounds = 12) => { await shim.flush(rounds); await new Promise(r => globalThis._realSetTimeout(r, 0)); };
const S = (state, attributes = {}) => ({ state, attributes });

// ── look: each behaviour from its states ────────────────────────────────────
await tryCase("look: a lamp glows with its light: on, off, colour and level, and a plug behind it", async () => {
  const red = DV.deviceLook("glow", "lamp", "light.a", S("on", { rgb_color: [255, 0, 0], brightness: 255 }), null);
  const dim = DV.deviceLook("glow", "lamp", "light.a", S("on", { rgb_color: [255, 0, 0], brightness: 0 }), null);
  const off = DV.deviceLook("glow", "lamp", "light.a", S("off"), null);
  const gone = DV.deviceLook("glow", "lamp", "light.a", S("unavailable"), null);
  // The Atlas's record wins (its effective state: a tap's claim before HA catches up).
  const rec = DV.deviceLook("glow", "lamp", "light.a", S("off"), { state: "on", rgb: [0, 0, 255], bri: 255 });
  const plug = DV.deviceLook("glow", "lamp", "switch.lamp_plug", S("on"), null);
  const plugOff = DV.deviceLook("glow", "lamp", "switch.lamp_plug", S("off"), null);
  check("look: a lamp glows with its light: on, off, colour and level, and a plug behind it",
    red.on && red.rgb[0] === 1 && red.rgb[1] === 0 && red.f === 1 && dim.on && dim.f === 0.3 && !off.on && !gone.on
    && rec.on && rec.rgb[2] === 1 && rec.rgb[0] === 0 && plug.on && plug.rgb[0] === 1 && plug.rgb[2] < plug.rgb[0] && !plugOff.on,
    { red, dim, off, gone, rec, plug, plugOff });
});
await tryCase("look: a TV lights while its media player is on, brighter playing", async () => {
  const L = (s) => DV.deviceLook("screen", "tv", "media_player.tv", S(s), null);
  check("look: a TV lights while its media player is on, brighter playing",
    L("on").on && !L("on").playing && L("playing").on && L("playing").playing && L("idle").on && L("paused").on
    && !L("off").on && !L("standby").on && !L("unavailable").on && DV.deviceLook("screen", "tv", "remote.tv", S("on"), null).on,
    ["on", "playing", "idle", "paused", "off", "standby", "unavailable"].map(s => [s, L(s)]));
});
await tryCase("look: a fan turns with the fan, faster with its speed", async () => {
  const F = (s, a, rec) => DV.deviceLook("spin", "fan", "fan.c", S(s, a), rec || null);
  const slow = F("on", { percentage: 20 }), fast = F("on", { percentage: 100 }), off = F("off", { percentage: 100 });
  const none = F("on", {}), byRec = F("off", {}, { state: "on", pct: 50 }), plug = DV.deviceLook("spin", "fan", "switch.fan", S("on"), null);
  check("look: a fan turns with the fan, faster with its speed",
    slow.on && fast.rps > slow.rps && slow.rps > 0 && off.rps === 0 && !off.on && none.rps > slow.rps && none.rps < fast.rps
    && byRec.on && byRec.rps > 0 && plug.rps > 0, { slow, fast, off, none, byRec, plug });
});
await tryCase("look: a washer runs: on, a running word, or watts; a speaker plays", async () => {
  const R = (eid, s, a = {}) => DV.deviceLook("run", "washer", eid, S(s, a), null).on;
  const sp = DV.deviceLook("run", "speaker", "media_player.sp", S("playing"), null);
  check("look: a washer runs: on, a running word, or watts; a speaker plays",
    R("switch.washer", "on") && !R("switch.washer", "off") && R("sensor.washer_state", "Running") && R("sensor.washer_state", "rinse")
    && !R("sensor.washer_state", "Finished") && !R("sensor.washer_state", "idle")
    && R("sensor.washer_power", "450", { unit_of_measurement: "W" }) && !R("sensor.washer_power", "2.1", { unit_of_measurement: "W" })
    && R("sensor.washer_power", "0.2", { unit_of_measurement: "kW" }) && R("binary_sensor.washer", "on")
    && !R("switch.washer", "unavailable") && sp.on && sp.pulse && !DV.deviceLook("run", "speaker", "media_player.sp", S("on"), null).on,
    { sp });
});
await tryCase("look: a robot vacuum or mower: docked on its dock, out while cleaning, beside it otherwise", async () => {
  const D = (eid, s) => DV.deviceLook("dock", "vacuum_dock", eid, S(s), null).at;
  check("look: a robot vacuum or mower: docked on its dock, out while cleaning, beside it otherwise",
    D("vacuum.r", "docked") === "dock" && D("vacuum.r", "cleaning") === "out" && D("vacuum.r", "returning") === "out"
    && D("vacuum.r", "paused") === "beside" && D("vacuum.r", "error") === "beside" && D("vacuum.r", "unavailable") === "dock"
    && D("lawn_mower.m", "mowing") === "out" && D("lawn_mower.m", "docked") === "dock", null);
});
await tryCase("look: a radiator warms while heating; a car or charger glows while charging", async () => {
  const W = (s, a) => DV.deviceLook("warm", "radiator", "climate.r", S(s, a), null).on;
  const C = (eid, s, a) => DV.deviceLook("charge", "charger", eid, S(s, a), null).on;
  check("look: a radiator warms while heating; a car or charger glows while charging",
    W("heat", { hvac_action: "heating" }) && !W("heat", { hvac_action: "idle" }) && !W("off", { hvac_action: "off" })
    && W("heat", {}) && !W("cool", {}) && W("on", {}) && !W("unavailable", {})
    && C("sensor.car", "Charging") && !C("sensor.car", "Complete") && C("binary_sensor.car_charging", "on")
    && !C("binary_sensor.car_charging", "off") && C("sensor.wallbox", "ready", { charging: true }), null);
});

// ── link: renames and deleted entities ──────────────────────────────────────
await tryCase("link: a renamed entity is followed by its registry id; a deleted one is unlinked", async () => {
  const states = { "light.new": S("on"), "light.same": S("on") };
  const piece = (eid, reg) => ({ entity_id: eid, entity_reg_id: reg });
  const a = DV.resolveLink(piece("light.same", "r1"), states, {}, {});
  const b = DV.resolveLink(piece("light.old", "r2"), states, { r2: "light.new" }, null);
  const c = DV.resolveLink(piece("light.old", "r2"), states, null, { "light.new": { entity_id: "light.new", id: "r2" } });
  const d = DV.resolveLink(piece("light.old", "r9"), states, { r2: "light.new" }, {});
  const e = DV.resolveLink(piece("light.old", null), states, null, null);
  const f = DV.resolveLink({ entity_id: null }, states, null, null);
  const g = DV.resolveLink(piece("light.booting", "r3"), states, {}, { "light.booting": { entity_id: "light.booting" } });
  check("link: a renamed entity is followed by its registry id; a deleted one is unlinked",
    a.how === "linked" && a.eid === "light.same" && b.how === "renamed" && b.eid === "light.new" && c.how === "renamed" && c.eid === "light.new"
    && d.how === "unlinked" && d.eid === null && d.was === "light.old" && e.how === "unlinked" && f.how === "none" && g.how === "linked",
    { a, b, c, d, e, f, g });
});

// ── the house ───────────────────────────────────────────────────────────────
const rect = (floor_id, x0, y0, x1, y1) => ({ type: "poly", floor_id, points_m: [[x0, y0], [x1, y0], [x1, y1], [x0, y1]] });
const MODEL = {
  floors: [{ id: "main", name: "Main" }, { id: "upper", name: "Upper" }],
  room_geometry_m: { Living: rect("main", 0, 0, 6, 5), Den: rect("main", 6.1, 0, 11, 5), Loft: rect("upper", 0, 0, 6, 5) },
  rf_barriers_m: [],
  light_positions_m: { "light.dim": { x_m: 2, y_m: 2, floor_id: "main" }, "light.kitchen": { x_m: 8, y_m: 1, floor_id: "main" } },
};
const T0 = new Date().toISOString();
const STATES0 = {
  "light.dim": { state: "on", attributes: { friendly_name: "Reading lamp", brightness: 200, rgb_color: [255, 40, 0], supported_color_modes: ["rgb"] } },
  "light.kitchen": { state: "on", attributes: { friendly_name: "Kitchen", brightness: 255, supported_color_modes: ["brightness"] } },
  "light.den2": { state: "on", attributes: { friendly_name: "Den lamp", brightness: 255, rgb_color: [0, 255, 0], supported_color_modes: ["rgb"] } },
  "fan.ceiling": { state: "off", attributes: { friendly_name: "Ceiling fan", percentage: 50 } },
  "fan.upper": { state: "off", attributes: { friendly_name: "Loft fan", percentage: 50 } },
  "media_player.tv": { state: "off", attributes: { friendly_name: "Lounge TV" } },
  "media_player.speaker": { state: "idle", attributes: { friendly_name: "Speaker" } },
  "switch.washer": { state: "off", attributes: { friendly_name: "Washer plug" } },
  "vacuum.robo": { state: "docked", attributes: { friendly_name: "Robo" } },
  "lawn_mower.mow": { state: "docked", attributes: { friendly_name: "Mower" } },
  "climate.lounge": { state: "heat", attributes: { friendly_name: "Lounge", hvac_action: "idle" } },
  "sensor.car_charging": { state: "Complete", attributes: { friendly_name: "Car charger" } },
  "binary_sensor.car_charging": { state: "off", attributes: { friendly_name: "Car charging", device_class: "battery_charging" } },
};
for (const [eid, s] of Object.entries(STATES0)) Object.assign(s, { entity_id: eid, last_changed: T0, last_updated: T0 });
const lbeOf = (states) => Object.fromEntries(LM.gatherLights(states, { "light.dim": "Living", "light.kitchen": "Den", "fan.ceiling": "Den" },
  {}, {}, "pro", {}, {}, {}, {}, Date.now()).map(l => [l.entity_id, l]));
let pid = 0;
const piece = (kind, x, y, eid, over = {}) => {
  const id = "fur_" + (++pid).toString(16).padStart(8, "0");
  return [id, { id, recipe: { kind, params: {}, colors: [], width_m: over.w ?? 0.6, depth_m: over.d ?? 0.6, height_m: over.h ?? 1 },
    origin: "build", label: "", library_id: null, submission_id: null, floor_id: over.floor || "main", x_m: x, y_m: y, z_m: over.z ?? 0,
    rotation: 0, entity_id: eid, entity_reg_id: over.reg ?? null, updated_at: T0 }];
};
const PIECES = Object.fromEntries([
  piece("lamp", 2, 2, "light.dim", { w: 0.4, d: 0.4, h: 1.5 }),
  piece("tv", 3.5, 4.4, "media_player.tv", { w: 1.4, d: 0.45, h: 1.1 }),
  piece("fan", 8, 3, "fan.ceiling", { w: 0.5, d: 0.35, h: 1.2 }),
  piece("washer", 10.3, 4.3, "switch.washer", { w: 0.6, d: 0.6, h: 0.85 }),
  piece("vacuum_dock", 7, 4.5, "vacuum.robo", { w: 0.4, d: 0.5, h: 0.12 }),
  piece("radiator", 0.2, 3, "climate.lounge", { w: 1, d: 0.1, h: 0.6 }),
  piece("charger", 10.7, 0.3, "sensor.car_charging", { w: 0.3, d: 0.15, h: 0.4 }),
  piece("lamp", 1, 1, "light.den_old", { w: 0.4, d: 0.4, h: 1.5, reg: "reg_den2" }),
  piece("sofa", 4, 1, "light.gone", { w: 2, d: 0.9, h: 0.8 }),
  piece("speaker", 5.6, 4.6, "media_player.speaker", { w: 0.2, d: 0.2, h: 0.35 }),
  piece("mower_dock", 1, 4.4, "lawn_mower.mow", { w: 0.6, d: 0.7, h: 0.2 }),
  piece("car", 3, 2.5, "binary_sensor.car_charging", { w: 1.8, d: 4.4, h: 1.5, floor: "upper" }),
  piece("fan", 5, 2, "fan.upper", { w: 0.5, d: 0.35, h: 1.2, floor: "upper" }),
]);
const ID = Object.fromEntries(Object.entries(PIECES).map(([id, p]) => [`${p.recipe.kind}:${p.entity_id}`, id]));

// The browser hands each frame its time; the shim's queue on a clock only the
// cases move (so a slow test machine draws no extra frames).
let clockOff = 0;
const clock0 = performance.now();
performance.now = () => clock0 + clockOff;
const shimRaf = globalThis.requestAnimationFrame;
globalThis.requestAnimationFrame = (fn) => shimRaf(() => fn(performance.now()));
const pendingFrames = () => shim.rafQueue.filter(Boolean).length;
async function later(ms, rounds = 6){ clockOff += ms; await settle(rounds); }

// A recording copy of the host's use api (lights_panel.js _useApi's shape).
function makeApi(states, lbe){
  const log = [];
  const hass = {
    states, user: { is_admin: true },
    callService: async (domain, service, data) => { log.push(["callService", domain, service, clone(data)]); },
    callWS: async (msg) => { log.push(["callWS", msg.type]); return null; },
    callApi: async (method, path) => { log.push(["callApi", method]); return [[]]; },
  };
  const api = {
    hass, lightsByEid: lbe, lights: Object.values(lbe), controlsFor: LC.hasControlCard,
    toggle: (eid) => log.push(["toggle", eid]), openControls: (eid) => log.push(["openControls", eid]),
    openActivity: (eid) => log.push(["openActivity", eid]), setMany: (eids, on) => log.push(["setMany", eids, on]),
    toast: (m, e) => log.push(["toast", m, !!e]), rerender: () => log.push(["rerender"]),
    doorLockMap: {}, doorInvertByEid: {}, floodLatches: {},
  };
  api.openRoom = (room) => log.push(["openRoom", room]);
  api.openFloor = (z) => log.push(["openFloor", z]);
  return { api, log };
}

function mount(slotKey, quality){
  const slot = LA.liveAboardSlot(slotKey);
  const h = { states: clone(STATES0), emergency: null, regIds: { reg_den2: "light.den2" }, topIds: null, file: { schema: 1, pieces: clone(PIECES) } };
  h.d3 = makeApi(h.states, lbeOf(h.states));
  h.P = () => ({ model: MODEL, floors: MODEL.floors, lightsByEid: lbeOf(h.states), hidden: new Set(), topFloorIds: h.topIds, quality,
    telemetry: () => {}, onTouch: () => {}, states: h.states, config: {}, bearing: 0, saveNorth: null, useApi: () => h.d3.api,
    haStartedMs: 0, load: async () => ({ data: clone(h.file) }), edit: null, entities: null, regIds: h.regIds, emergency: h.emergency });
  h.poll = () => {
    const card = document.createElement("div"), stage = document.createElement("div");
    card.appendChild(stage);
    document.body.replaceChildren(card);
    h.d3.api.hass.states = h.states;
    h.d3.api.lightsByEid = lbeOf(h.states);
    return slot.attach(stage, h.P());
  };
  h.set = (eid, state, attrs) => { h.states = { ...h.states, [eid]: { ...h.states[eid], state, attributes: { ...h.states[eid].attributes, ...(attrs || {}) } } }; };
  h.slot = slot;
  h.dev = (id) => slot._state().devices.find(d => d.id === id) || null;
  h.poll();
  return h;
}
const isBlack = (hex) => hex === "#000000";

// ── view ────────────────────────────────────────────────────────────────────
let H = null;
await tryCase("view: the lamp glows in its light's colour, and its fixture steps aside for it", async () => {
  H = mount("devices-low", "low");
  await later(10000, 60);
  const s = H.slot._state(), lamp = H.dev(ID["lamp:light.dim"]);
  const [r, g, b] = lamp.halo;
  // The real lamp light is the piece's bulb, not the ceiling fixture's.
  const fromLamp = s.lamps.some(p => Math.abs(p[0] - 2) < 0.3 && Math.abs(p[2] - 2) < 0.3 && p[1] < 1.7);
  H.set("light.dim", "off"); H.poll(); await settle();
  const off = H.dev(ID["lamp:light.dim"]), offLamps = H.slot._state().lamps;
  H.set("light.dim", "on"); H.poll(); await settle();
  check("view: the lamp glows in its light's colour, and its fixture steps aside for it",
    s.profile === "low" && lamp.eid === "light.dim" && lamp.how === "linked" && lamp.glow.length === 2 && !lamp.glow.some(isBlack)
    && r > g && r > b && s.swapped.includes("light.dim") && !s.swapped.includes("light.kitchen") && fromLamp
    && off.glow.every(isBlack) && off.halo.every(v => v === 0) && !offLamps.some(p => Math.abs(p[0] - 2) < 0.3 && Math.abs(p[2] - 2) < 0.3),
    { profile: s.profile, lamp, swapped: s.swapped, lamps: s.lamps, off, offLamps });
});
await tryCase("view: the TV lights, the radiator warms and the charger glows with their devices", async () => {
  const before = { tv: H.dev(ID["tv:media_player.tv"]), rad: H.dev(ID["radiator:climate.lounge"]), ch: H.dev(ID["charger:sensor.car_charging"]) };
  H.set("media_player.tv", "playing"); H.set("climate.lounge", "heat", { hvac_action: "heating" }); H.set("sensor.car_charging", "Charging");
  H.poll(); await settle();
  const after = { tv: H.dev(ID["tv:media_player.tv"]), rad: H.dev(ID["radiator:climate.lounge"]), ch: H.dev(ID["charger:sensor.car_charging"]) };
  check("view: the TV lights, the radiator warms and the charger glows with their devices",
    before.tv.screen.every(isBlack) && before.rad.warm.every(isBlack) && before.ch.glow.every(isBlack)
    && after.tv.screen.length === 1 && !after.tv.screen.some(isBlack) && !after.rad.warm.some(isBlack) && !after.ch.glow.some(isBlack)
    && before.ch.halo && before.ch.halo.every(v => v === 0) && after.ch.halo[1] > after.ch.halo[0] && after.ch.halo[1] > 0
    && H.slot._state().liveMs === 0, { before, after, liveMs: H.slot._state().liveMs });
});
await tryCase("view: a renamed entity is followed; a gone one is unlinked, with its badge, and stays", async () => {
  const ren = H.dev(ID["lamp:light.den_old"]), gone = H.dev(ID["sofa:light.gone"]);
  const drawn = H.slot._state().pieces.some(p => p.id === ID["sofa:light.gone"]);
  check("view: a renamed entity is followed; a gone one is unlinked, with its badge, and stays",
    ren.how === "renamed" && ren.eid === "light.den2" && !ren.glow.some(isBlack) && ren.halo[1] > ren.halo[0] && !ren.badge
    && gone.how === "unlinked" && gone.eid === null && gone.badge && drawn, { ren, gone, drawn });
});
await tryCase("view: on Low the robot waits beside its dock and the washer does not shake", async () => {
  const dock0 = H.dev(ID["vacuum_dock:vacuum.robo"]).dock;
  H.set("vacuum.robo", "cleaning"); H.set("switch.washer", "on"); H.poll(); await settle();
  const v = H.dev(ID["vacuum_dock:vacuum.robo"]), w = H.dev(ID["washer:switch.washer"]), s = H.slot._state();
  check("view: on Low the robot waits beside its dock and the washer does not shake",
    !v.circling && (v.dock[0] !== dock0[0] || v.dock[1] !== dock0[1]) && w.look.on && !w.shake && s.liveMs === 0,
    { dock0, v, w, liveMs: s.liveMs });
  H.set("vacuum.robo", "docked"); H.set("switch.washer", "off"); H.poll(); await settle();
});
await tryCase("view: while the emergency test runs, its lights are outlined (a piece's, and a fixture's)", async () => {
  H.emergency = ["light.dim", "light.kitchen"]; H.poll(); await settle();
  const on = { lamp: H.dev(ID["lamp:light.dim"]).outline, fixtures: H.slot._state().outlined };
  H.emergency = null; H.poll(); await settle();
  const off = { lamp: H.dev(ID["lamp:light.dim"]).outline, fixtures: H.slot._state().outlined };
  check("view: while the emergency test runs, its lights are outlined (a piece's, and a fixture's)",
    on.lamp && on.fixtures === 1 && !off.lamp && off.fixtures === 0, { on, off });
});

// ── frames ──────────────────────────────────────────────────────────────────
await tryCase("frames: at rest, nothing is drawn", async () => {
  await later(10000, 30);
  const f0 = H.slot._state().frames;
  await later(60000, 12);
  H.poll(); await later(5000, 12);                         // a poll: nothing changed
  const s = H.slot._state();
  check("frames: at rest, nothing is drawn", s.frames === f0 && s.liveMs === 0 && pendingFrames() === 0, { frames: s.frames - f0, liveMs: s.liveMs });
});
await tryCase("frames: a fan turning draws on its capped clock, and stops with the fan", async () => {
  const id = ID["fan:fan.ceiling"];
  H.set("fan.ceiling", "on", { percentage: 100 }); H.poll(); await settle(4);
  const turning = { liveMs: H.slot._state().liveMs, rps: H.dev(id).rps }, a0 = H.dev(id).spin, f0 = H.slot._state().frames;
  for (let i = 0; i < 40; i++) await later(50, 3);         // two seconds
  const drawn = H.slot._state().frames - f0, a1 = H.dev(id).spin;
  H.set("fan.ceiling", "off"); H.poll(); await later(500, 12);
  const f1 = H.slot._state().frames;
  await later(30000, 12);
  const s = H.slot._state();
  check("frames: a fan turning draws on its capped clock, and stops with the fan",
    turning.liveMs === DV.DEVICE_MS.low && turning.rps > 1 && drawn >= 19 && drawn <= 21 && a1 !== a0
    && s.liveMs === 0 && s.frames === f1 && H.dev(id).rps === 0 && pendingFrames() === 0,
    { turning, drawn, a0, a1, liveMs: s.liveMs, after: s.frames - f1 });
});
await tryCase("frames: a floor the chips hide costs no frames for what turns on it", async () => {
  const id = ID["fan:fan.upper"];
  H.set("fan.upper", "on", { percentage: 60 }); H.topIds = null; H.poll(); await settle(4);
  const shownMs = H.slot._state().liveMs;
  H.topIds = ["main"]; H.poll(); await later(500, 12);      // Main on top: Upper, and its fan, hidden
  const f0 = H.slot._state().frames, hidden = { liveMs: H.slot._state().liveMs, shown: H.dev(id).shown };
  await later(5000, 12);
  check("frames: a floor the chips hide costs no frames for what turns on it",
    shownMs === DV.DEVICE_MS.low && hidden.liveMs === 0 && !hidden.shown && H.slot._state().frames === f0,
    { shownMs, hidden, after: H.slot._state().frames - f0 });
  H.set("fan.upper", "off"); H.topIds = null; H.poll(); await later(500, 12);
});

// ── taps ────────────────────────────────────────────────────────────────────
let seq = 0;
function fire(canvas, type, x, y, t){
  const ev = { type, pointerId: 3, pointerType: "touch", clientX: x, clientY: y, button: 0, buttons: type === "pointerup" ? 0 : 1,
               isPrimary: true, shiftKey: false, ctrlKey: false, metaKey: false, timeStamp: t ?? ++seq, target: canvas,
               preventDefault(){}, stopPropagation(){} };
  for (const fn of [...(winL[type] || [])]) fn(ev);
  canvas.dispatchEvent(ev);
}
// The flat Atlas's stage, as wireUseSurface wires it, for the same light.
const NS = "http://www.w3.org/2000/svg";
function flatSurface(states, lbe){
  const rec = makeApi(states, lbe);
  const isoDiv = document.createElement("div"), svg = document.createElementNS(NS, "svg");
  isoDiv.appendChild(svg);
  const marks = {};
  for (const eid of Object.keys(lbe)) {
    const n = document.createElementNS(NS, "g");
    for (const [k, v] of Object.entries({ class: "lhex", "data-eid": eid, "data-cx": "100", "data-cy": "100" })) n.setAttribute(k, v);
    svg.appendChild(n);
    marks[eid] = n;
  }
  LM.wireUseSurface(isoDiv, rec.api);
  return { ...rec, marks };
}
const ev = (type, t, extra = {}) => ({ type, button: 0, pointerType: "touch", pointerId: 7, clientX: 100, clientY: 100, timeStamp: t,
  stopPropagation() {}, preventDefault() {}, ...extra });
const runTimers = () => { for (const t of shim.timerQueue.splice(0, shim.timerQueue.length)) if (t) t.fn(...t.a); };

await tryCase("taps: a press on a linked piece is its device, as the Atlas's own target", async () => {
  H.topIds = ["main"]; H.poll();                            // the Loft above off
  H.slot._look(0, 0.25, [5.5, 0, 2.5], 15);
  await settle();
  const at = (k) => H.slot._wherePiece(ID[k], 0.4);
  const lamp = at("lamp:light.dim"), tv = at("tv:media_player.tv"), sofa = at("sofa:light.gone");
  const hit = (p) => (p ? H.slot._pick(p[0], p[1]) : null);
  const kitchen = H.slot._where({ eid: "light.kitchen" });
  check("taps: a press on a linked piece is its device, as the Atlas's own target",
    hit(lamp) && hit(lamp).hit === "device:light.dim" && hit(tv) && hit(tv).hit === "entity:media_player.tv"
    && (!hit(sofa) || !/^(device|entity):/.test(hit(sofa).hit)) && kitchen && hit(kitchen).hit === "device:light.kitchen",
    { lamp, tv, sofa, hits: [hit(lamp), hit(tv), hit(sofa), kitchen && hit(kitchen)] });
});
await tryCase("taps: tap and hold on the lamp make the same calls as on the light on the flat Atlas", async () => {
  const canvas = H.slot._state().canvas, p = H.slot._wherePiece(ID["lamp:light.dim"], 0.4);
  const flat = flatSurface(H.states, lbeOf(H.states));
  const runs = {};
  // Tap.
  H.d3.log.length = 0;
  fire(canvas, "pointerdown", p[0], p[1], performance.now()); await settle(2);
  fire(canvas, "pointerup", p[0], p[1], performance.now() + 60); await settle(4);
  runs.tap3d = H.d3.log.slice();
  flat.marks["light.dim"].dispatchEvent(ev("pointerdown", performance.now() - 60));
  flat.marks["light.dim"].dispatchEvent(ev("pointerup", performance.now()));
  await settle(2); runTimers(); await settle(2);
  runs.tapFlat = flat.log.slice();
  // Hold: past the Atlas's hold, still.
  H.d3.log.length = 0; flat.log.length = 0;
  const t0 = performance.now();
  fire(canvas, "pointerdown", p[0], p[1], t0); await settle(2);
  for (let i = 0; i < 8; i++) await later(100, 3);
  fire(canvas, "pointerup", p[0], p[1], performance.now()); await settle(4);
  runs.hold3d = H.d3.log.slice();
  const f0 = performance.now() - 800;
  flat.marks["light.dim"].dispatchEvent(ev("pointerdown", f0));
  runTimers();
  flat.marks["light.dim"].dispatchEvent(ev("pointerup", performance.now()));
  await settle(2); runTimers(); await settle(2);
  runs.holdFlat = flat.log.slice();
  check("taps: tap and hold on the lamp make the same calls as on the light on the flat Atlas",
    runs.tap3d.length > 0 && JSON.stringify(runs.tap3d) === JSON.stringify(runs.tapFlat)
    && runs.hold3d.length > 0 && JSON.stringify(runs.hold3d) === JSON.stringify(runs.holdFlat), runs);
});
await tryCase("taps: a device the Atlas has no marker for opens Home Assistant's own controls", async () => {
  const canvas = H.slot._state().canvas, p = H.slot._wherePiece(ID["tv:media_player.tv"], 0.4);
  const seen = [];
  const root = H.slot.element, prev = root.dispatchEvent.bind(root);
  root.dispatchEvent = (e) => { if (e && e.type === "hass-more-info") seen.push(e.detail && e.detail.entityId); return prev(e); };
  H.d3.log.length = 0;
  fire(canvas, "pointerdown", p[0], p[1], performance.now()); await settle(2);
  fire(canvas, "pointerup", p[0], p[1], performance.now() + 60); await settle(4);
  root.dispatchEvent = prev;
  check("taps: a device the Atlas has no marker for opens Home Assistant's own controls",
    seen.length === 1 && seen[0] === "media_player.tv" && !H.d3.log.some(c => c[0] === "toggle" || c[0] === "callService"), { seen, log: H.d3.log });
});
LA.releaseLiveAboardSlot("devices-low");
await settle();

// ── High: the robot goes round, the washer shakes, the speaker pulses ───────
await tryCase("view: on High the robot goes round near its dock, the washer shakes, the speaker pulses; all stop", async () => {
  const h = mount("devices-high", "high");
  await later(10000, 60);
  const prof = h.slot._state().profile;
  h.set("vacuum.robo", "cleaning"); h.set("switch.washer", "on"); h.set("media_player.speaker", "playing"); h.set("lawn_mower.mow", "mowing");
  h.poll(); await settle(4);
  const a = { v: h.dev(ID["vacuum_dock:vacuum.robo"]), w: h.dev(ID["washer:switch.washer"]), s: h.dev(ID["speaker:media_player.speaker"]),
              m: h.dev(ID["mower_dock:lawn_mower.mow"]), liveMs: h.slot._state().liveMs };
  for (let i = 0; i < 20; i++) await later(50, 3);
  const b = { v: h.dev(ID["vacuum_dock:vacuum.robo"]), w: h.dev(ID["washer:switch.washer"]), s: h.dev(ID["speaker:media_player.speaker"]) };
  h.set("vacuum.robo", "docked"); h.set("switch.washer", "off"); h.set("media_player.speaker", "idle"); h.set("lawn_mower.mow", "docked");
  h.poll(); await later(500, 12);
  const f1 = h.slot._state().frames;
  await later(20000, 12);
  const c = { v: h.dev(ID["vacuum_dock:vacuum.robo"]), w: h.dev(ID["washer:switch.washer"]), liveMs: h.slot._state().liveMs, frames: h.slot._state().frames - f1 };
  check("view: on High the robot goes round near its dock, the washer shakes, the speaker pulses; all stop",
    prof === "high" && a.liveMs === DV.DEVICE_MS.high && a.v.circling && a.w.shake && a.s.pulse && a.m.circling
    && JSON.stringify(a.v.dock) !== JSON.stringify(b.v.dock) && JSON.stringify(a.w.run) !== JSON.stringify(b.w.run)
    && !c.v.circling && !c.w.shake && c.liveMs === 0 && c.frames === 0, { prof, a, b, c });
  LA.releaseLiveAboardSlot("devices-high");
  await settle();
});

console.log(JSON.stringify({ cases, failures }));
