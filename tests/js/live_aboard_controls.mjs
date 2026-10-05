// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
//
// The Atlas's drawers and its other devices in Live Aboard
// (views/live_aboard_marks.js, with views/live_aboard.js and the shared card,
// views/lights_map.js), run for real under the DOM shim with a stub GL
// (tests/js/stub_gl.mjs):
//
//   class    ☰'s class chips: with a class picked, every other class fades
//            (its glow, its readout chip, its room's tint) and takes no
//            taps, by the Atlas's own class test; "All" is as before
//   find     ◎ Find active flies to the device the Atlas picks (a tripped
//            motion sensor first), showing its floor first when the chips
//            hide it; from the card's own button too
//   zoom     ⚙'s − and + step the camera out and in, 100% is the
//            whole-house fit, and the label says the zoom against it; the
//            flat map's own zoom is left alone
//   layout   Mapping's Layout & view: Spacing and L / R step aside while
//            Live Aboard shows; Save view keeps the camera in its Views,
//            Reset view goes to the whole house; on the flat map, as today
//   flood    a leak sensor: a quiet puck dry; wet or latched, the Atlas's
//            alarm (rings across its room, the floor tinted, its word over
//            everything), moving only while it alarms
//   lock     a lock on the wall nearest its spot, coloured by state as the
//            Atlas's glyph; a tap and a hold go through the use api
//   door     a door sensor placed as a point draws nothing (as on the
//            Atlas); one linked to a barrier stays its opening
//   codes    the Atlas's code chips at room scale, in the theme's chip
//            colours; none at the whole house; none while codes are hidden
//   heights  a leak sensor and a lock at a default by kind, and at the 3D
//            file's stored height
//
// usage: live_aboard_controls.mjs <www/padspan-ha dir>
// prints one JSON line: { cases: {name: result}, failures: [...] }

import { pathToFileURL } from "node:url";
import { join } from "node:path";
import * as shim from "./dom_shim.mjs";
import { installStubGL } from "./stub_gl.mjs";

const WWW = process.argv[2];
if (!WWW) { console.error("usage: live_aboard_controls.mjs <www/padspan-ha dir>"); process.exit(2); }
shim.install();
{
  const NP = globalThis.Node.prototype, ap = NP.appendChild, ib = NP.insertBefore, rc = NP.removeChild;
  const leave = (c) => { const p = c && c.parentNode; if (p && p.children) { const i = p.children.indexOf(c); if (i >= 0) p.children.splice(i, 1); } };
  NP.appendChild = function(c){ leave(c); return ap.call(this, c); };
  NP.insertBefore = function(c, ref){ leave(c); return ib.call(this, c, ref); };
  NP.removeChild = function(c){ const r = rc.call(this, c); if (c && c.parentNode === this) c.parentNode = null; return r; };
}
globalThis.sessionStorage = { _d: {}, getItem(k) { return this._d[k] ?? null; }, setItem(k, v) { this._d[k] = String(v); },
  removeItem(k) { delete this._d[k]; }, clear() { this._d = {}; } };
installStubGL();
let clockOff = 0;
const realNow = performance.now.bind(performance);
performance.now = () => realNow() + clockOff;
const shimRaf = globalThis.requestAnimationFrame;
globalThis.requestAnimationFrame = (fn) => shimRaf(() => fn(performance.now()));

const LA = await import(pathToFileURL(join(WWW, "views", "live_aboard.js")).href);
const LM = await import(pathToFileURL(join(WWW, "views", "lights_map.js")).href);
const MK = await import(pathToFileURL(join(WWW, "views", "live_aboard_marks.js")).href);
const { SHOWCASE_THEMES } = await import(pathToFileURL(join(WWW, "views", "iso_lights.js")).href);

const failures = [];
const cases = {};
const check = (name, ok, detail) => { cases[name] = !!ok; if (!ok) failures.push({ name, detail: detail === undefined ? null : detail }); };
const tryCase = async (name, fn) => {
  try { await fn(); } catch (e) { failures.push({ name, detail: String(e && e.stack || e).slice(0, 900) }); cases[name] = false; }
};
const settle = async (rounds = 14) => { await shim.flush(rounds); await new Promise(r => globalThis._realSetTimeout(r, 0)); };
const sleep = (ms) => new Promise(r => globalThis._realSetTimeout(r, ms));

// ── the house: a kitchen and a hall, a loft upstairs ────────────────────────
const rect = (floor_id, x0, y0, x1, y1) => ({ type: "poly", floor_id, points_m: [[x0, y0], [x1, y0], [x1, y1], [x0, y1]] });
const MODEL = {
  floors: [{ id: "main", name: "Main", level: 0 }, { id: "up", name: "Upstairs", level: 1 }],
  floor_elevations: { main: 0, up: 2.8 },
  room_geometry_m: { Kitchen: rect("main", 0, 0, 6, 4), Hall: rect("main", 6.1, 0, 10, 4), Loft: rect("up", 0, 0, 5, 5) },
  rf_barriers_m: [{ id: "bar_front", name: "Front door", material: "wood", floor_id: "main", points_m: [[7, 0], [8, 0]],
                    linked_entity_id: "binary_sensor.front_door" }],
  light_positions_m: {
    "light.kitchen": { x_m: 3, y_m: 2, floor_id: "main" },
    "light.loft": { x_m: 2, y_m: 2, floor_id: "up" },
    "binary_sensor.hall_motion": { x_m: 8, y_m: 2, floor_id: "main" },
    "binary_sensor.loft_motion": { x_m: 3, y_m: 3, floor_id: "up" },
    "sensor.kitchen_temp": { x_m: 4, y_m: 3, floor_id: "main" },
    "binary_sensor.kitchen_leak": { x_m: 1, y_m: 1, floor_id: "main" },
    "binary_sensor.hall_leak": { x_m: 9, y_m: 3, floor_id: "main" },
    "binary_sensor.loft_leak": { x_m: 1, y_m: 4, floor_id: "up" },
    "lock.back": { x_m: 9.7, y_m: 2, floor_id: "main" },
    "binary_sensor.side_door": { x_m: 5, y_m: 0.3, floor_id: "main" },
  },
};
const FLOORS = MODEL.floors;
const NOW = Date.now();
const iso = (ms) => new Date(ms).toISOString();
const STATES0 = {
  "light.kitchen": { state: "on", attributes: { friendly_name: "Kitchen light", brightness: 220, rgb_color: [255, 200, 120] } },
  "light.loft": { state: "on", attributes: { friendly_name: "Loft light", brightness: 200 } },
  "binary_sensor.hall_motion": { state: "off", attributes: { friendly_name: "Hall motion", device_class: "motion" }, last_changed: iso(NOW - 3 * 3600e3) },
  "binary_sensor.loft_motion": { state: "on", attributes: { friendly_name: "Loft motion", device_class: "motion" }, last_changed: iso(NOW - 10e3) },
  "sensor.kitchen_temp": { state: "21", attributes: { friendly_name: "Kitchen temperature", device_class: "temperature", unit_of_measurement: "°C" },
                           last_changed: iso(NOW - 60e3) },
  "binary_sensor.kitchen_leak": { state: "off", attributes: { friendly_name: "Kitchen sink leak", device_class: "moisture" } },
  "binary_sensor.hall_leak": { state: "off", attributes: { friendly_name: "Hall leak", device_class: "moisture" } },
  "binary_sensor.loft_leak": { state: "off", attributes: { friendly_name: "Loft leak", device_class: "moisture" } },
  "lock.back": { state: "locked", attributes: { friendly_name: "Back door lock" } },
  "binary_sensor.side_door": { state: "on", attributes: { friendly_name: "Side door", device_class: "door" } },
  "binary_sensor.front_door": { state: "off", attributes: { friendly_name: "Front door", device_class: "door" } },
};
const AREAS = { "light.kitchen": "Kitchen", "light.loft": "Loft", "binary_sensor.hall_motion": "Hall", "binary_sensor.loft_motion": "Loft",
                "sensor.kitchen_temp": "Kitchen", "binary_sensor.kitchen_leak": "Kitchen", "binary_sensor.hall_leak": "Hall", "lock.back": "Hall" };
const records = (over = {}) => {
  const st = { ...STATES0 };
  for (const [k, v] of Object.entries(over)) st[k] = { ...st[k], ...v, attributes: { ...(st[k] || {}).attributes, ...(v.attributes || {}) } };
  const L = LM.gatherLights(Object.fromEntries(Object.entries(st).map(([k, v]) => [k, { entity_id: k, last_changed: v.last_changed || iso(NOW - 600e3), ...v }])),
    AREAS, {}, "pro", {}, {}, {}, {}, NOW);
  return Object.fromEntries(L.map(l => [l.entity_id, l]));
};
const LBE = records();
const calls = [];
const api = { toast(){}, toggle: (e) => calls.push(["toggle", e]), openRoom: (r) => calls.push(["openRoom", r]), openFloor(){},
              openControls: (e) => calls.push(["openControls", e]), openActivity: (e) => calls.push(["openActivity", e]),
              controlsFor: (l) => (l && (l.isLock || l.dimmable) ? {} : null), lightsByEid: LBE, hass: null };
const DAY = { "sun.sun": { entity_id: "sun.sun", state: "above_horizon", attributes: { azimuth: 160, elevation: 40 } } };
const CLASSIC = { key: "classic", theme: SHOWCASE_THEMES.classic };
const P = (over = {}) => ({ model: MODEL, floors: FLOORS, lightsByEid: LBE, hidden: new Set(), topFloorIds: null, quality: "low",
  telemetry: () => {}, onTouch: () => {}, states: DAY, config: {}, bearing: 0, saveNorth: async () => true, useApi: () => api,
  haStartedMs: 0, load: async () => ({ data: {} }), edit: null, mapOnly: false, prefs: null, showcase: CLASSIC,
  classFilter: null, floodLatches: {}, codes: null, ...over });
function card(slot, over){
  const c = document.createElement("div"), stage = document.createElement("div");
  c.appendChild(stage);
  document.body.appendChild(c);
  const ok = slot.attach(stage, P(over));
  return { ok, stage, c };
}
const S = (slot) => slot._state();
const canvasOf = (slot) => slot.element.querySelector("canvas");
const ev = (type, x, y, extra = {}) => ({ type, button: 0, pointerType: "mouse", pointerId: 1, clientX: x, clientY: y, deltaMode: 0,
  stopPropagation() {}, preventDefault() {}, composedPath: () => [], ...extra });
async function newSlot(key, over){
  const slot = LA.liveAboardSlot(key);
  card(slot, over);
  await settle(30);
  return slot;
}
const markOf = (slot, eid) => S(slot).marks.find(m => m.eid === eid) || null;
const pickAt = (slot, eid) => { const at = slot._where({ eid }); return at ? slot._pick(at[0], at[1]) : null; };
const hitOf = (r) => (r && r.hit ? r.hit : null);

// ── class chips ─────────────────────────────────────────────────────────────
await tryCase("class: a picked class fades the rest and only its own take taps; All is as before", async () => {
  // Main alone: nothing upstairs stands over its devices.
  const slot = await newSlot("ctl-class", { topFloorIds: ["main"] });
  const atLight = slot._where({ eid: "light.kitchen" }), atLock = slot._where({ eid: "lock.back" });
  const all = { dimmed: S(slot).dimmed.length, halos: S(slot).look.halos, light: hitOf(slot._pick(...atLight)), lock: hitOf(slot._pick(...atLock)),
                faded: S(slot).chipsFaded.length, lockBody: markOf(slot, "lock.back").body };
  card(slot, { classFilter: "motion", topFloorIds: ["main"] });
  await settle();
  const st = S(slot);
  const motion = { dimmed: st.dimmed, halos: st.look.halos, light: hitOf(slot._pick(...atLight)), lock: hitOf(slot._pick(...atLock)),
                   hall: hitOf(pickAt(slot, "binary_sensor.hall_motion")), faded: st.chipsFaded,
                   leak: markOf(slot, "binary_sensor.kitchen_leak").dim, lockDim: markOf(slot, "lock.back").dim,
                   lockBody: markOf(slot, "lock.back").body };
  card(slot, { classFilter: "lock", topFloorIds: ["main"] });
  await settle();
  const lock = { light: hitOf(slot._pick(...atLight)), lock: hitOf(slot._pick(...atLock)), lockDim: markOf(slot, "lock.back").dim,
                 lockBody: markOf(slot, "lock.back").body, dimmed: S(slot).dimmed.length };
  card(slot, { classFilter: "all", topFloorIds: ["main"] });
  await settle();
  const back = { dimmed: S(slot).dimmed.length, halos: S(slot).look.halos, light: hitOf(slot._pick(...atLight)), faded: S(slot).chipsFaded.length,
                 lockBody: markOf(slot, "lock.back").body };
  LA.releaseLiveAboardSlot("ctl-class");
  check("class: a picked class fades the rest and only its own take taps; All is as before",
    all.dimmed === 0 && all.light === "device:light.kitchen" && all.lock === "device:lock.back" && all.faded === 0
    && motion.dimmed.includes("light.kitchen") && motion.dimmed.includes("light.loft") && motion.halos < all.halos * 0.3
    && motion.light !== "device:light.kitchen" && motion.lock !== "device:lock.back" && motion.hall === "device:binary_sensor.hall_motion"
    && motion.faded.includes("Kitchen") && motion.leak && motion.lockDim && motion.lockBody !== all.lockBody
    && lock.lock === "device:lock.back" && !lock.lockDim && lock.light !== "device:light.kitchen" && lock.lockBody === "#fbbf24"
    && back.dimmed === 0 && Math.abs(back.halos - all.halos) < 1e-6 && back.light === "device:light.kitchen" && back.faded === 0
    && back.lockBody === all.lockBody, { all, motion, lock, back });
});

// ── flood ───────────────────────────────────────────────────────────────────
await tryCase("flood: quiet dry; wet or latched, the Atlas's alarm, moving only while it alarms", async () => {
  // Nobody moving (a motion pulse draws for its first seconds too).
  const QUIET = { "binary_sensor.loft_motion": { state: "off", last_changed: iso(NOW - 3 * 3600e3) } };
  const slot = await newSlot("ctl-flood", { lightsByEid: records(QUIET) });
  await settle();
  const dry = { m: markOf(slot, "binary_sensor.kitchen_leak"), live: S(slot).liveMs, f0: S(slot).frames };
  await settle(20);
  dry.f1 = S(slot).frames;
  const wetLbe = records({ ...QUIET, "binary_sensor.kitchen_leak": { state: "on" } });
  card(slot, { lightsByEid: wetLbe });
  await settle(4);
  const wet = { m: markOf(slot, "binary_sensor.kitchen_leak"), live: S(slot).liveMs };
  const ph0 = wet.m.ripple.ph;
  clockOff += 700;
  await settle(6);
  wet.ph1 = markOf(slot, "binary_sensor.kitchen_leak").ripple.ph;
  // Dried, but its latch (flood_latch.py) is an hour old: still the alarm, one slower ripple.
  const latches = { "binary_sensor.hall_leak": { triggered_at: (Date.now() - 3600e3) / 1000 } };
  card(slot, { lightsByEid: records(QUIET), floodLatches: latches });
  await settle(4);
  const latched = { m: markOf(slot, "binary_sensor.hall_leak"), kitchen: markOf(slot, "binary_sensor.kitchen_leak"), live: S(slot).liveMs };
  // Three days old: over.
  card(slot, { lightsByEid: records(QUIET), floodLatches: { "binary_sensor.hall_leak": { triggered_at: (Date.now() - 3 * 86400e3) / 1000 } } });
  await settle(4);
  const old = { m: markOf(slot, "binary_sensor.hall_leak"), live: S(slot).liveMs, f0: S(slot).frames };
  await settle(20);
  old.f1 = S(slot).frames;
  // Wet on a floor the chips hide (upstairs, Main picked): no frames for it.
  const upOnly = card(slot, { lightsByEid: records({ ...QUIET, "binary_sensor.loft_leak": { state: "on" } }), topFloorIds: ["main"] });
  await settle(4);
  const hiddenFloor = { live: S(slot).liveMs, ok: upOnly.ok, alarm: markOf(slot, "binary_sensor.loft_leak").look.alarm,
                        shown: markOf(slot, "binary_sensor.loft_leak").shown };
  LA.releaseLiveAboardSlot("ctl-flood");
  check("flood: quiet dry; wet or latched, the Atlas's alarm, moving only while it alarms",
    dry.m && dry.m.kind === "flood" && dry.m.body === "#cfd8d3" && !dry.m.ripple.on && !dry.m.badge.on && dry.live === 0 && dry.f1 === dry.f0
    && dry.m.room === "Kitchen" && Math.abs(dry.m.at[1] - 0.02) < 0.02
    && wet.m.look.wet && wet.m.body === "#ef4444" && wet.m.ripple.on && wet.m.ripple.n === 3 && wet.m.badge.on && wet.m.badge.word === "WET"
    && wet.m.badge.onTop && wet.live > 0 && wet.ph1 !== ph0
    && latched.m.look.latched && latched.m.ripple.on && latched.m.ripple.n === 1 && latched.m.badge.word === "ALARM" && latched.live > 0
    && !latched.kitchen.look.alarm
    && !old.m.look.alarm && !old.m.ripple.on && old.live === 0 && old.f1 === old.f0
    && hiddenFloor.live === 0 && hiddenFloor.alarm && !hiddenFloor.shown, { dry, wet, latched, old, hiddenFloor });
});
await tryCase("flood: the Atlas's own rule — live wet or latched within two days", async () => {
  const now = Date.now(), l = { entity_id: "binary_sensor.x", state: "off", isFlood: true };
  const at = (ago) => ({ "binary_sensor.x": { triggered_at: (now - ago) / 1000 } });
  const a = MK.floodLook(l, at(3600e3), now), b = MK.floodLook(l, at(47.9 * 3600e3), now), c = MK.floodLook(l, at(48.1 * 3600e3), now);
  const d = MK.floodLook({ ...l, state: "on" }, {}, now), e = MK.floodLook({ ...l, state: "unavailable" }, at(3600e3), now);
  const words = [LM.stateWordOf({ ...l, state: "on" }, {}).text, LM.stateWordOf(l, at(3600e3)).text, LM.stateWordOf(l, {}).text];
  check("flood: the Atlas's own rule — live wet or latched within two days",
    a.alarm && a.latched && a.word === "ALARM" && b.alarm && !c.alarm && c.word === "DRY" && d.alarm && d.wet && d.word === "WET"
    && d.ripple.n === 3 && a.ripple.n === 1 && e.alarm && e.none && JSON.stringify(words) === JSON.stringify([d.word, a.word, c.word]),
    { a, b, c, d, e, words });
});

// ── lock ────────────────────────────────────────────────────────────────────
await tryCase("lock: on the wall nearest its spot, coloured by state; a tap and a hold go through the use api", async () => {
  const slot = await newSlot("ctl-lock");
  const looks = {};
  for (const st of ["locked", "unlocked", "jammed", "unavailable"]) {
    card(slot, { lightsByEid: records({ "lock.back": { state: st } }) });
    await settle(4);
    const m = markOf(slot, "lock.back");
    looks[st] = { state: m.look.state, body: m.body, wall: m.wall, at: m.at };
  }
  card(slot, {});
  await settle();
  const at = slot._where({ eid: "lock.back" }), cv = canvasOf(slot);
  calls.length = 0;
  cv.dispatchEvent(ev("pointerdown", at[0], at[1], { timeStamp: performance.now() }));
  cv.dispatchEvent(ev("pointerup", at[0], at[1], { timeStamp: performance.now() + 40 }));
  await settle(4);
  const tap = calls.slice();
  calls.length = 0;
  const t0 = performance.now();
  cv.dispatchEvent(ev("pointerdown", at[0], at[1], { timeStamp: t0 }));
  clockOff += 800;
  await settle(6);
  cv.dispatchEvent(ev("pointerup", at[0], at[1], { timeStamp: performance.now() }));
  await settle(4);
  const hold = calls.slice();
  LA.releaseLiveAboardSlot("ctl-lock");
  check("lock: on the wall nearest its spot, coloured by state; a tap and a hold go through the use api",
    looks.locked.body === "#fbbf24" && looks.unlocked.body === "#374151" && looks.jammed.body === "#374151" && looks.jammed.state === "jammed"
    && looks.unavailable.body === "#64748b" && looks.unavailable.state === "none" && looks.locked.wall
    && Math.abs(looks.locked.at[0] - 9.92) < 0.08 && Math.abs(looks.locked.at[1] - 1.0) < 0.01
    && JSON.stringify(tap) === JSON.stringify([["toggle", "lock.back"]]) && JSON.stringify(hold) === JSON.stringify([["openControls", "lock.back"]]),
    { looks, tap, hold });
});

// ── door ────────────────────────────────────────────────────────────────────
await tryCase("door: a door sensor placed as a point draws nothing, as on the Atlas; a linked one stays its opening", async () => {
  const slot = await newSlot("ctl-door");
  const st = S(slot);
  const out = { point: slot._where({ eid: "binary_sensor.side_door" }), marks: st.marks.map(m => m.eid),
                sensors: st.motion.map(m => m.eid), opening: st.openings.map(o => o.eid) };
  LA.releaseLiveAboardSlot("ctl-door");
  check("door: a door sensor placed as a point draws nothing, as on the Atlas; a linked one stays its opening",
    out.point === null && !out.marks.includes("binary_sensor.side_door") && !out.sensors.includes("binary_sensor.side_door")
    && out.opening.includes("binary_sensor.front_door") && !out.opening.includes("binary_sensor.side_door"), out);
});

// ── codes ───────────────────────────────────────────────────────────────────
await tryCase("codes: the Atlas's chips at room scale, in its theme's colours; none at the whole house, none while hidden", async () => {
  const slot = await newSlot("ctl-codes", { codes: { showcase: false }, topFloorIds: ["main"] });
  const whole = S(slot).codes;
  slot._look(Math.PI / 4, 0.9, [3, 1, 2], 7);
  await settle();
  const near = S(slot).codes;
  const byEid = Object.fromEntries(near.chips.map(c => [c.eid, c]));
  card(slot, { codes: null, topFloorIds: ["main"] });
  await settle();
  const hidden = S(slot).codes;
  const span = (r, fit = null) => MK.codesAt(r, 16 / 9, 40, fit);
  LA.releaseLiveAboardSlot("ctl-codes");
  const leak = byEid["binary_sensor.kitchen_leak"], light = byEid["light.kitchen"];
  check("codes: the Atlas's chips at room scale, in its theme's colours; none at the whole house, none while hidden",
    whole.shown === 0 && whole.chips.length >= 6 && near.shown > 0 && light && light.on && light.text === LBE["light.kitchen"].code
    && leak && leak.on && leak.text === LBE["binary_sensor.kitchen_leak"].code
    && light.key.bg === SHOWCASE_THEMES.classic.codeChipBg && light.key.bgOp === SHOWCASE_THEMES.classic.codeChipBgOpacity && light.key.ink === "#e2e8f0"
    && !byEid["sensor.kitchen_temp"] && hidden.chips.length === 0 && hidden.shown === 0 && span(8) && !span(40) && span(8, 20) && !span(8, 9),
    { whole, near: near.chips.map(c => [c.eid, c.text, c.on]), hidden });
});

// ── heights ─────────────────────────────────────────────────────────────────
await tryCase("heights: a leak sensor and a lock at a default by kind, and at the 3D file's height", async () => {
  const slot = await newSlot("ctl-heights");
  const before = { leak: markOf(slot, "binary_sensor.kitchen_leak"), lock: markOf(slot, "lock.back") };
  const s2 = LA.liveAboardSlot("ctl-heights2");
  card(s2, { load: async () => ({ data: { devices: { "lock.back": { z_m: 1.6 }, "binary_sensor.kitchen_leak": { z_m: 0.4 } } } }) });
  await settle(30);
  const after = { leak: markOf(s2, "binary_sensor.kitchen_leak"), lock: markOf(s2, "lock.back"), heights: S(s2).heights.devices };
  LA.releaseLiveAboardSlot("ctl-heights"); LA.releaseLiveAboardSlot("ctl-heights2");
  check("heights: a leak sensor and a lock at a default by kind, and at the 3D file's height",
    before.leak.z === 0.02 && before.leak.zDefault === 0.02 && before.lock.z === 1 && before.lock.zDefault === 1
    && after.lock.z === 1.6 && Math.abs(after.lock.at[1] - 1.6) < 1e-6 && after.leak.z === 0.4 && after.lock.zDefault === 1
    && Math.abs(after.leak.at[1] - (0.4 + 0.0125)) < 1e-3, { before, after });
});

// ── zoom and find, on the view ──────────────────────────────────────────────
await tryCase("zoom: − and + step out and in about the middle (the bars stay), 100% is the whole-house fit, the label follows", async () => {
  const told = [];
  // The sidebar's screen (mapOnly): the buttons are on the bars, so the bars stay.
  const slot = await newSlot("ctl-zoom", { onZoom: (z) => told.push(z), mapOnly: true });
  const fit = { pct: slot.zoomPct(), r: S(slot).cam.radius, target: S(slot).cam.target };
  slot.zoom("in");
  const inn = { pct: slot.zoomPct(), r: S(slot).cam.radius, target: S(slot).cam.target };
  slot.zoom("in");
  const in2 = slot.zoomPct(), bare = S(slot).screen.bare;
  slot.zoom("fit");
  const back = { pct: slot.zoomPct(), r: S(slot).cam.radius };
  slot.zoom("out");
  const out = slot.zoomPct();
  LA.releaseLiveAboardSlot("ctl-zoom");
  check("zoom: − and + step out and in about the middle (the bars stay), 100% is the whole-house fit, the label follows",
    fit.pct === 100 && Math.abs(inn.r - fit.r / 1.25) < 1e-6 && inn.pct === 125 && JSON.stringify(inn.target) === JSON.stringify(fit.target)
    && in2 === 156 && !bare && back.pct === 100 && out === 80 && told.includes(125) && told.includes(156) && told[told.length - 1] === 80,
    { fit, inn, in2, back, out, told });
});
await tryCase("find: flies to the Atlas's pick, showing its floor first when the chips hide it", async () => {
  const tops = [];
  const slot = LA.liveAboardSlot("ctl-find");
  const over = { topFloorIds: ["main"], setTopFloor: (fid) => { tops.push(fid); card(slot, { ...over, topFloorIds: null }); } };
  card(slot, over);
  await settle(30);
  const hiddenBefore = !S(slot).floors || S(slot).topElev;
  const ok = slot.findDevice("binary_sensor.loft_motion");
  const flying = S(slot).screen.flying;
  clockOff += 2000;
  await settle(10);
  const t = S(slot).cam.target;
  const kitchen = slot.findDevice("binary_sensor.kitchen_leak");
  clockOff += 2000;
  await settle(10);
  const t2 = S(slot).cam.target;
  const none = slot.findDevice("light.nowhere");
  LA.releaseLiveAboardSlot("ctl-find");
  check("find: flies to the Atlas's pick, showing its floor first when the chips hide it",
    ok && flying && JSON.stringify(tops) === JSON.stringify(["up"]) && t[0] > 0 && t[0] < 5 && t[2] > 0 && t[2] < 5 && t[1] > 2.5
    && kitchen && tops.length === 1 && t2[0] > 0 && t2[0] < 6 && t2[1] < 2.5 && none === false, { tops, t, t2, hiddenBefore, flying });
});

// ── the card: the drawers' buttons drive Live Aboard while it shows ─────────
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
const H3 = (slot) => ({ slot, settings: { atlas_3d_enabled: true, atlas_3d_quality: "low" }, telemetry: () => {},
  load: () => Promise.resolve({ data: {} }), edit: null, states: DAY, config: {}, useApi: () => api });
const PICK = (slot) => `padspan_lv_3d_${slot}`;
let saves = 0;
function atlasCard(slot, more = {}) {
  const view = more.view || { floorGap: 150, horizGap: 0, focusIdx: 0, zoom: 1 };
  const host = { el, view, floors: FLOORS, model: MODEL, byRoom: {}, hiddenEids: new Set(), lightsByEid: LBE, lightsLoading: false,
    tier: "pro", layoutV2: false, displayMode: false, saveView: async () => { saves++; }, onHexesBuilt() {}, toast() {},
    classFilter: "all", onClassFilter() {}, floodLatches: {}, house3d: H3(slot), ...more };
  const c = LM.buildLightsMapCard(host);
  document.body.appendChild(c);
  return { c, view, host };
}
const all = (c) => c._all();
const btn = (c, text) => all(c).find(n => n.localName === "button" && n.textContent === text) || null;
const lbl = (c, text) => all(c).find(n => n.className === "lv-lbl" && n.textContent === text) || null;
async function waitFor(fn, ms = 3000){ const t0 = Date.now(); while (Date.now() - t0 < ms) { if (fn()) return true; await sleep(20); } return false; }

await tryCase("card: ⚙ Zoom, ◎ Find active and the layout bar drive Live Aboard while it shows; the flat map as today", async () => {
  localStorage.setItem(PICK("ctl-card"), "1");
  const view = { floorGap: 150, horizGap: 0, focusIdx: 0, zoom: 1 };
  let a = atlasCard("ctl-card", { view });
  const shown = await waitFor(() => all(a.c).some(n => n.classList && n.classList.contains("la3d")));
  await settle(20);
  a = atlasCard("ctl-card", { view });                              // the poll's next card, the view in it
  await settle(20);
  const slot = LA.liveAboardSlot("ctl-card");
  const r0 = S(slot).cam.radius, zoomBtns = all(a.c).find(n => n.className === "lv-zoomseg" && !("data-la3d-switch" in n.attributes));
  const mid = zoomBtns.children[1];
  const lbl0 = mid.textContent;
  zoomBtns.children[2].click();
  const plus = { r: S(slot).cam.radius, lbl: mid.textContent, flatZoom: view.zoom };
  mid.click();
  const fit = { pct: slot.zoomPct(), lbl: mid.textContent };
  zoomBtns.children[0].click();
  const minus = { pct: slot.zoomPct(), lbl: mid.textContent, flatZoom: view.zoom };
  const layout = { spacing: lbl(a.c, "Spacing").style.display, lr: lbl(a.c, "L / R").style.display, floor: (lbl(a.c, "Floor") || { style: {} }).style.display };
  const saves0 = saves;
  btn(a.c, "Save view").click();
  await settle();
  const kept = JSON.parse(localStorage.getItem("padspan_la3d_views_ctl-card") || "[]");
  btn(a.c, "Reset view").click();
  await settle();
  const reset = { saves: saves - saves0, gap: view.floorGap, flying: S(slot).screen.flying };
  // Find active: the Atlas's pick is the tripped Loft motion sensor; with Main picked on the chips, Upstairs shows first.
  view.focusIdx = 1;
  a = atlasCard("ctl-card", { view });
  await settle(10);
  const topBefore = S(slot).topElev;
  btn(a.c, "◎ Find active").click();
  await settle(4);
  const find = { focus: view.focusIdx, topBefore, top: S(slot).topElev, flying: S(slot).screen.flying };
  clockOff += 2000;
  await settle(10);
  find.target = S(slot).cam.target;
  // Map picked: the flat map's own controls, exactly as before.
  btn(a.c, "Map").click();
  await settle(4);
  const b = atlasCard("ctl-card", { view: { floorGap: 150, horizGap: 0, focusIdx: 0, zoom: 1 } });
  const flat = { spacing: lbl(b.c, "Spacing").style.display, lr: lbl(b.c, "L / R").style.display };
  const zb = all(b.c).find(n => n.className === "lv-zoomseg" && !("data-la3d-switch" in n.attributes));
  zb.children[2].click();
  flat.zoom = b.view.zoom; flat.lbl = zb.children[1].textContent;
  const s1 = saves;
  btn(b.c, "Save view").click();
  await settle();
  flat.saves = saves - s1;
  b.view.floorGap = 200;
  btn(b.c, "Reset view").click();
  await settle();
  flat.gap = b.view.floorGap; flat.saves2 = saves - s1;
  LA.releaseLiveAboardSlot("ctl-card");
  localStorage.removeItem(PICK("ctl-card"));
  check("card: ⚙ Zoom, ◎ Find active and the layout bar drive Live Aboard while it shows; the flat map as today",
    shown && lbl0 === "100%" && Math.abs(plus.r - r0 / 1.25) < 1e-6 && plus.lbl === "125%" && plus.flatZoom === 1
    && fit.pct === 100 && fit.lbl === "100%" && minus.pct === 80 && minus.lbl === "80%" && minus.flatZoom === 1
    && layout.spacing === "none" && layout.lr === "none" && layout.floor !== "none"
    && kept.length === 1 && reset.saves === 0 && reset.gap === 150 && reset.flying
    && find.focus !== 1 && find.topBefore === 0 && find.top === 2.8 && find.flying && find.target[1] > 2.5
    && flat.spacing !== "none" && flat.lr !== "none" && Math.abs(flat.zoom - 1.1) < 1e-9 && flat.lbl === "100%" && flat.saves === 1
    && flat.gap === 150 && flat.saves2 === 2,
    { shown, lbl0, plus, fit, minus, layout, kept: kept.length, reset, find, flat });
});

// ── off, below Pro, or Map: the flat card exactly as it was ─────────────────
function ser(n, skip) {
  if (!n) return "";
  if (skip && skip(n)) return "";
  if (n.localName === "#text") return JSON.stringify(n.textContent);
  const attrs = Object.entries(n.attributes || {}).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(" ");
  return `<${n.localName} .class=${JSON.stringify(n.className)} ${attrs} .style=${JSON.stringify(n.style.cssText)}`
    + ` .html=${JSON.stringify(n._html || "")} .text=${JSON.stringify(n._text || "")} .v=${JSON.stringify([n._value, !!n.checked, !!n.disabled])}>`
    + n.children.map(c => ser(c, skip)).join("") + `</${n.localName}>`;
}
const isSwitch = (n) => !!(n.attributes && "data-la3d-switch" in n.attributes);
await tryCase("off: with a class picked, latches and codes hidden, off and below Pro are the flat card; on but Map adds only the switch", async () => {
  localStorage.setItem(PICK("ctl-off"), "0");
  const more = { classFilter: "motion", floodLatches: { "binary_sensor.hall_leak": { triggered_at: Date.now() / 1000 } }, hideDeviceCodes: true };
  const out = {};
  for (const [name, layout] of Object.entries({ classic: {}, v2: { layoutV2: true }, display: { layoutV2: true, display: true } })) {
    const absent = atlasCard("ctl-off", { ...more, ...layout, house3d: undefined });
    const off = atlasCard("ctl-off", { ...more, ...layout, house3d: { ...H3("ctl-off"), settings: { atlas_3d_enabled: false } } });
    const free = atlasCard("ctl-off", { ...more, ...layout, tier: "free" });
    const onMap = atlasCard("ctl-off", { ...more, ...layout });
    const a = ser(absent.c);
    out[name] = { off: a === ser(off.c), free: ser(free.c) === ser(atlasCard("ctl-off", { ...more, ...layout, tier: "free", house3d: undefined }).c),
                  onMap: ser(onMap.c, isSwitch) === a, svg: a.length > 1000 };
  }
  localStorage.removeItem(PICK("ctl-off"));
  check("off: with a class picked, latches and codes hidden, off and below Pro are the flat card; on but Map adds only the switch",
    Object.values(out).every(o => Object.values(o).every(Boolean)), out);
});

// The copies this file keeps of the Atlas's (held equal to the originals by
// tests/test_live_aboard_controls.py, which reads iso_lights.js itself).
console.log(JSON.stringify({ cases, failures, copies: { FLOOD_RIPPLE: MK.FLOOD_RIPPLE, LOCK_LOOK: MK.LOCK_LOOK, DIM_K: MK.DIM_K } }));
process.exit(failures.length ? 1 : 0);
