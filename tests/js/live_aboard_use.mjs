// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
//
// Live Aboard's taps and holds (views/live_aboard_use.js), run under the DOM
// shim side by side with the flat Atlas's own use surface (lights_map.js
// wireUseSurface): the same gesture on the same device, through two
// recording copies of the host's use api and two recording hass objects,
// must make the very same calls with the very same arguments.
//
//   parity    tap, hold, hold-and-drag, moved-before-held, a right button, on
//             a dimmable light, a plain switch, a fan, a motion sensor, a
//             read-only reading and a lock; a room's name, a floor's badge, a
//             door (the same card, from the same barrier)
//   ring      the Atlas's pressed ring: at 150 ms, filling to the hold, gold
//             once armed; none for what has no controls
//   hud       the Atlas's hover box: what a click lands on, what is under it,
//             an "Under" pick doing what the sidebar's does; it lingers over
//             nothing, then goes
//   piece     a piece of furniture linked to a light acts as the light
//             does; one linked to anything else opens Home Assistant's own
//             controls for it (P5)
//   quiet     no api, no press; a device the Atlas doesn't know, no press
//
// usage: live_aboard_use.mjs <www/padspan-ha dir>
// prints one JSON line: { cases: {name: result}, failures: [...] }

import { pathToFileURL } from "node:url";
import { join } from "node:path";
import { install, timerQueue, rafQueue } from "./dom_shim.mjs";

const WWW = process.argv[2];
if (!WWW) { console.error("usage: live_aboard_use.mjs <www/padspan-ha dir>"); process.exit(2); }
install(globalThis);
const LM = await import(pathToFileURL(join(WWW, "views", "lights_map.js")).href);
const LC = await import(pathToFileURL(join(WWW, "views", "light_codes.js")).href);
const H = await import(pathToFileURL(join(WWW, "views", "live_aboard_house.js")).href);
const U = await import(pathToFileURL(join(WWW, "views", "live_aboard_use.js")).href);

const failures = [];
const cases = {};
const check = (name, ok, detail) => { cases[name] = !!ok; if (!ok) failures.push({ name, detail: detail === undefined ? null : detail }); };
const tryCase = async (name, fn) => { try { await fn(); } catch (e) { failures.push({ name, detail: String(e && e.stack || e).slice(0, 900) }); cases[name] = false; } };
const NS = "http://www.w3.org/2000/svg";
const now = () => performance.now();

// ── the devices, as the Atlas gathers them ──────────────────────────────────
const STATES = {
  "light.dim": { state: "on", attributes: { friendly_name: "Dimmer", brightness: 180, supported_color_modes: ["brightness"] } },
  "light.plain": { state: "off", attributes: { friendly_name: "Plain switch", supported_color_modes: ["onoff"] } },
  "fan.ceiling": { state: "on", attributes: { friendly_name: "Ceiling fan", percentage: 50 } },
  "binary_sensor.hall_motion": { state: "on", attributes: { friendly_name: "Hall motion", device_class: "motion" } },
  "sensor.hall_temp": { state: "21", attributes: { friendly_name: "Hall temp", device_class: "temperature" } },
  "lock.front": { state: "unlocked", attributes: { friendly_name: "Front lock" } },
  "binary_sensor.back_door": { state: "on", attributes: { friendly_name: "Back door", device_class: "door" } },
};
for (const [eid, s] of Object.entries(STATES)) Object.assign(s, { entity_id: eid, last_changed: new Date().toISOString(), last_updated: new Date().toISOString() });
const LIGHTS = LM.gatherLights(STATES, { "light.dim": "Kitchen", "fan.ceiling": "Kitchen" }, {}, "pro", {}, {}, {}, {}, Date.now());
const LBE = Object.fromEntries(LIGHTS.map(l => [l.entity_id, l]));
const BARRIER = { id: "b1", name: "Back door", material: "wood", floor_id: "main", points_m: [[0, 0], [1, 0]],
                  linked_entity_id: "binary_sensor.back_door", invert_state: true, linked_lock_entity_id: "lock.front" };

// Two recording copies of the host's use api (lights_panel.js _useApi's shape).
function makeApi(){
  const log = [];
  const hass = {
    states: STATES, user: { is_admin: true },
    callService: async (domain, service, data) => { log.push(["callService", domain, service, JSON.parse(JSON.stringify(data))]); },
    callWS: async (msg) => { log.push(["callWS", msg.type]); return null; },
    callApi: async (method, path) => { log.push(["callApi", method, String(path).replace(/period\/[^?]+/, "period/<t>")]); return [[]]; },
  };
  const api = {
    hass, lightsByEid: LBE, lights: LIGHTS, controlsFor: LC.hasControlCard,
    // Resolves true once switched, as toggleEntity does: a tap is counted ok and ringed only then (review 2026-11-11).
    toggle: (eid) => { log.push(["toggle", eid]); return true; },
    openControls: (eid) => log.push(["openControls", eid]),
    openActivity: (eid) => log.push(["openActivity", eid]),
    setMany: (eids, on) => log.push(["setMany", eids, on]),
    toast: (m, e) => log.push(["toast", m, !!e]),
    rerender: () => log.push(["rerender"]),
    doorLockMap: {}, doorInvertByEid: { "binary_sensor.back_door": true }, floodLatches: {},
  };
  api.openRoom = (room, only) => log.push(["openRoom", room, only === undefined ? null : only]);
  api.openFloor = (z) => log.push(["openFloor", z]);
  return { api, log };
}

// ── the flat Atlas's stage, as wireUseSurface wires it ──────────────────────
const flat = makeApi();
const isoDiv = document.createElement("div");
const svg = document.createElementNS(NS, "svg");
isoDiv.appendChild(svg);
const node = (tag, cls, attrs) => {
  const n = document.createElementNS(NS, tag);
  n.setAttribute("class", cls);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  svg.appendChild(n);
  return n;
};
const marks = {};
for (const eid of Object.keys(STATES)) if (LBE[eid] && !LBE[eid].isDoor) marks[eid] = node("g", "lhex", { "data-eid": eid, "data-cx": "100", "data-cy": "100" });
const roomEl = node("g", "lroom", { "data-room": "Kitchen", "data-z": "0" });
const floorEl = node("g", "lfloor", { "data-role": "floor", "data-z": "1" });
// The hit-line exactly as buildIsoSVG writes its data-* fields.
const barEl = node("polyline", "lbarhit", { "data-eid": BARRIER.linked_entity_id, "data-invert": BARRIER.invert_state ? "1" : "0",
  "data-name": BARRIER.name || "", "data-opener": BARRIER.linked_opener_entity_id || "", "data-lock": BARRIER.linked_lock_entity_id || "" });
LM.wireUseSurface(isoDiv, flat.api);

// ── the 3D view's use surface, with a pick that answers what the test aims at
const d3 = makeApi();
let aim = null, apiOn = true;
// The ⋯ list's "Tap a light to switch it" (on unless a screen unticks it),
// what each switch by a press counted, and the pulse each one shows.
let tapsOn = true;
const SWITCHED = [], PULSES = [];
const root = document.createElement("div");
const use = U.createUseSurface({ root, pick: () => aim, screenOf: () => ({ x: 40, y: 50 }), api: () => (apiOn ? d3.api : null),
                                 frame() {}, cursor() {}, lightTaps: () => tapsOn, switched: (ok) => SWITCHED.push(ok) });
// The pulse is one Web Animation (the DOM shim has none): recorded here.
globalThis.Node.prototype.animate = function(frames, opts){ PULSES.push([this.getAttribute("class"), this.getAttribute("cx"), opts && opts.duration]);
  const self = this; return { set onfinish(fn){ self._finish = fn; } }; };
const device = (eid) => ({ kind: "device", key: "device:" + eid, eid, label: `${LBE[eid].code} · ${LBE[eid].friendly_name}` });
const TARGETS = {
  room: { kind: "room", key: "room:Kitchen", room: "Kitchen", label: "Kitchen — opens its 2 devices" },
  floor: { kind: "floor", key: "floor:1", z: "1", label: "Main — the whole floor" },
  door: { kind: "door", key: "door:binary_sensor.back_door@b1", eid: BARRIER.linked_entity_id, bar: H.barrierCardOf(BARRIER), label: "Back door — Closed" },
};

// ── gestures ────────────────────────────────────────────────────────────────
const ev = (type, x, y, t, extra = {}) => ({ type, button: 0, pointerType: "touch", pointerId: 7, clientX: x, clientY: y, timeStamp: t,
  stopPropagation() {}, preventDefault() {}, ...extra });
const runTimers = () => { for (const t of timerQueue.splice(0, timerQueue.length)) if (t) t.fn(...t.a); };
const settle = () => new Promise(r => globalThis._realSetTimeout(r, 5));
// moves: [[dx, dy], ...] after the hold; held: ms held before the moves/up
async function flatGesture(el, { held = 60, moves = [], right = false, cancelMove = null } = {}){
  timerQueue.length = 0;
  const t0 = now() - held;
  const x = 100, y = 100, extra = right ? { button: 2, pointerType: "mouse" } : {};
  el.dispatchEvent(ev("pointerdown", x, y, t0, extra));
  if (cancelMove) el.dispatchEvent(ev("pointermove", x + cancelMove[0], y + cancelMove[1], t0 + 30, extra));
  if (held >= 500) runTimers();                                // the ring, then the arming
  for (const [dx, dy] of moves) el.dispatchEvent(ev("pointermove", x + dx, y + dy, now(), extra));
  el.dispatchEvent(ev("pointerup", x + (moves.length ? moves[moves.length - 1][0] : 0), y + (moves.length ? moves[moves.length - 1][1] : 0), now(), extra));
  await settle();
  runTimers();                                                 // the redraw after a dim
  await settle();
}
async function d3Gesture(t, { held = 60, moves = [], right = false, cancelMove = null } = {}){
  aim = { hit: t, under: [] };
  const t0 = now() - held;
  const x = 100, y = 100, extra = right ? { button: 2, pointerType: "mouse" } : {};
  const pressed = use.down(ev("pointerdown", x, y, t0, extra));
  if (cancelMove) use.move(ev("pointermove", x + cancelMove[0], y + cancelMove[1], t0 + 30, extra));
  if (held >= 500) use.tick(now());
  for (const [dx, dy] of moves) use.move(ev("pointermove", x + dx, y + dy, now(), extra));
  use.up(ev("pointerup", x, y, now(), extra));
  await settle();
  use.tick(now() + 600);                                       // the redraw after a dim
  await settle();
  return pressed;
}
const bodyCards = () => document.body.children.filter(n => n && n.localName === "div").map(n => n.textContent);
async function both(name, flatEl, target, g){
  flat.log.length = 0; d3.log.length = 0;
  document.body.children.length = 0;
  await flatGesture(flatEl, g);
  const flatCards = bodyCards();
  document.body.children.length = 0;
  await d3Gesture(target, g);
  const d3Cards = bodyCards();
  document.body.children.length = 0;
  const a = JSON.stringify(flat.log), b = JSON.stringify(d3.log);
  return { name, same: a === b && JSON.stringify(flatCards) === JSON.stringify(d3Cards), flat: flat.log.slice(), d3: d3.log.slice(), flatCards, d3Cards };
}

await tryCase("parity: every gesture on every kind of device makes the Atlas's own calls", async () => {
  const runs = [];
  const gestures = {
    tap: {}, hold: { held: 700 }, dim: { held: 700, moves: [[0, 40], [0, 80]] }, moved: { cancelMove: [20, 0] }, right: { right: true },
  };
  for (const eid of Object.keys(marks)) {
    for (const [g, opts] of Object.entries(gestures)) runs.push(await both(`${eid} ${g}`, marks[eid], device(eid), opts));
  }
  const bad = runs.filter(r => !r.same);
  const did = (n) => (runs.find(r => r.name === n) || {}).d3 || [];
  // And they are the Atlas's actions, not merely equal to each other.
  const want = {
    "light.dim tap": [["toggle", "light.dim"]],
    "light.dim hold": [["openControls", "light.dim"]],
    "light.dim dim": [["callService", "light", "turn_on", { entity_id: "light.dim", brightness: 116 }],
                      ["callService", "light", "turn_on", { entity_id: "light.dim", brightness: 53 }], ["rerender"]],
    "light.dim moved": [], "light.dim right": [],
    "light.plain hold": [["toggle", "light.plain"]],
    "fan.ceiling hold": [["openControls", "fan.ceiling"]], "fan.ceiling dim": [["openControls", "fan.ceiling"]],
    "binary_sensor.hall_motion tap": [["openActivity", "binary_sensor.hall_motion"]],
    "binary_sensor.hall_motion hold": [["openActivity", "binary_sensor.hall_motion"]],
    "sensor.hall_temp tap": [["toggle", "sensor.hall_temp"]], "sensor.hall_temp hold": [["toggle", "sensor.hall_temp"]],
    "lock.front tap": [["toggle", "lock.front"]], "lock.front hold": [["openControls", "lock.front"]],
  };
  const wrong = Object.entries(want).filter(([n, w]) => JSON.stringify(did(n)) !== JSON.stringify(w)).map(([n]) => ({ n, got: did(n) }));
  check("parity: every gesture on every kind of device makes the Atlas's own calls", runs.length === 30 && !bad.length && !wrong.length,
    { bad: bad.slice(0, 4), wrong });
});
// A finger rolls as it lands (a wall screen, 2026-11-12): 12 px is still the tap; a mouse moved that far is a drag.
await tryCase("a finger that rolls a little still taps", async () => {
  const run = async (move, extra) => {
    d3.log.length = 0; aim = { hit: device("light.dim"), under: [] };
    const t0 = now() - 60;
    use.down(ev("pointerdown", 100, 100, t0, extra));
    const r = use.move(ev("pointermove", 100 + move, 100, t0 + 30, extra));
    if (r !== "cancel") use.up(ev("pointerup", 100 + move, 100, now(), extra));
    await settle();
    return JSON.stringify(d3.log);
  };
  const tapped = JSON.stringify([["toggle", "light.dim"]]);
  const got = { finger12: await run(12, {}), finger20: await run(20, {}), mouse12: await run(12, { pointerType: "mouse" }) };
  check("a finger that rolls a little still taps", got.finger12 === tapped && got.finger20 === "[]" && got.mouse12 === "[]", got);
});
// A room's name, a floor's badge and a door's line take a click on the flat
// Atlas (whether the press was short or long); the 3D view's press makes the
// same call, from a tap or a hold. A drag across one clicks on the flat map;
// in 3D a drag turns the house instead — the one difference, the camera's.
await tryCase("parity: a room's name, a floor's badge and a door, tapped or held", async () => {
  const runs = [];
  const clickRun = async (name, el, target, held) => {
    flat.log.length = 0; d3.log.length = 0; document.body.children.length = 0;
    el.dispatchEvent({ type: "click", stopPropagation() {}, preventDefault() {} });
    const fc = bodyCards();
    document.body.children.length = 0;
    await d3Gesture(target, { held });
    const dc = bodyCards();
    document.body.children.length = 0;
    return { name, held, same: JSON.stringify(fc) === JSON.stringify(dc) && JSON.stringify(flat.log) === JSON.stringify(d3.log),
             flat: flat.log.slice(), d3: d3.log.slice(), fc, dc };
  };
  for (const held of [60, 700]) {
    runs.push(await clickRun("room", roomEl, TARGETS.room, held));
    runs.push(await clickRun("floor", floorEl, TARGETS.floor, held));
    runs.push(await clickRun("door", barEl, TARGETS.door, held));
  }
  d3.log.length = 0;
  await d3Gesture(TARGETS.room, { cancelMove: [30, 0] });
  const dragged = d3.log.slice();
  check("parity: a room's name, a floor's badge and a door, tapped or held",
    runs.every(r => r.same) && JSON.stringify(runs[0].d3) === JSON.stringify([["openRoom", "Kitchen", null]])
    && JSON.stringify(runs[1].d3) === JSON.stringify([["openFloor", "1"]]) && runs[2].dc.length === 1 && /Back door/.test(runs[2].dc[0])
    && JSON.stringify(dragged) === "[]", { bad: runs.filter(r => !r.same), dragged });
});

// A slow screen: no frame came during the hold, and the drag starts. The
// Atlas's timer would have armed it at 500 ms, so it dims, it is not a pan.
await tryCase("parity: a held drag dims even when no frame came during the hold", async () => {
  flat.log.length = 0; d3.log.length = 0;
  await flatGesture(marks["light.dim"], { held: 700, moves: [[0, 40]] });
  aim = { hit: device("light.dim"), under: [] };
  const t0 = now() - 700;
  use.down(ev("pointerdown", 100, 100, t0));
  const r = use.move(ev("pointermove", 100, 140, now()));      // no tick in between
  use.up(ev("pointerup", 100, 140, now()));
  await settle();
  use.tick(now() + 600);
  await settle();
  check("parity: a held drag dims even when no frame came during the hold",
    r === "dim" && JSON.stringify(flat.log) === JSON.stringify(d3.log) && d3.log.filter(x => x[0] === "callService").length === 2,
    { r, flat: flat.log, d3: d3.log });
});

// ── "Tap a light to switch it" (the ⋯ list's light_taps) ────────────────────
// On (the default): a tap on a light is the Atlas's toggle, counted, and a
// ring opens out from it. Unticked on a screen: a tap (or a hold on a light
// with no controls) on a light or a strip switches nothing; a fan, a lock and
// a reading do what they always did; a hold still opens a light's controls.
await tryCase("switches: on, a tap on a light is the Atlas's toggle, counted, with a pulse; unticked, no light switches, fans and locks as ever", async () => {
  const run = async (eid, g = {}) => { d3.log.length = 0; await d3Gesture(device(eid), g); return d3.log.slice(); };
  tapsOn = true; SWITCHED.length = 0; PULSES.length = 0;
  const on = { dim: await run("light.dim"), plain: await run("light.plain"), fan: await run("fan.ceiling"), lock: await run("lock.front") };
  await settle();
  on.counted = SWITCHED.slice(); on.pulses = PULSES.slice();
  tapsOn = false; SWITCHED.length = 0; PULSES.length = 0;
  const off = { dim: await run("light.dim"), plain: await run("light.plain"), plainHold: await run("light.plain", { held: 700 }),
                dimHold: await run("light.dim", { held: 700 }), fan: await run("fan.ceiling"), lock: await run("lock.front"),
                temp: await run("sensor.hall_temp") };
  off.counted = SWITCHED.length; off.pulses = PULSES.length;
  tapsOn = true;
  check("switches: on, a tap on a light is the Atlas's toggle, counted, with a pulse; unticked, no light switches, fans and locks as ever",
    JSON.stringify(on.dim) === JSON.stringify([["toggle", "light.dim"]]) && JSON.stringify(on.plain) === JSON.stringify([["toggle", "light.plain"]])
    && JSON.stringify(on.fan) === JSON.stringify([["toggle", "fan.ceiling"]]) && JSON.stringify(on.lock) === JSON.stringify([["toggle", "lock.front"]])
    && JSON.stringify(on.counted) === "[true,true]" && on.pulses.length === 2 && on.pulses.every(x => x[0] === "la3d-tapped" && x[1] === "40.0" && x[2] > 0)
    && JSON.stringify(off.dim) === "[]" && JSON.stringify(off.plain) === "[]" && JSON.stringify(off.plainHold) === "[]"
    && JSON.stringify(off.dimHold) === JSON.stringify([["openControls", "light.dim"]])
    && JSON.stringify(off.fan) === JSON.stringify([["toggle", "fan.ceiling"]]) && JSON.stringify(off.lock) === JSON.stringify([["toggle", "lock.front"]])
    && JSON.stringify(off.temp) === JSON.stringify([["toggle", "sensor.hall_temp"]]) && off.counted === 0 && off.pulses === 0, { on, off });
  // Each ring goes when its animation ends.
  const rings = () => root.children.find(n => n.localName === "svg").children.filter(n => n.getAttribute && n.getAttribute("class") === "la3d-tapped");
  const had = rings().length;
  for (const c of rings()) c._finish && c._finish();
  check("switches: each pulse's ring is gone once its animation ends", had > 0 && rings().length === 0, { had, left: rings().length });
});
// The switch itself is lights_map.js toggleEntity, as the hosts' toggle is:
// on → turn_off, off → turn_on, the look flipped at once (effectiveState)
// and put back, with the Atlas's "Could not toggle", when Home Assistant refuses.
await tryCase("switches: the Atlas's own toggle: on → turn_off, off → turn_on, flipped at once, put back and counted on a failure", async () => {
  const calls = [], toasts = [];
  let refuse = false;
  const hass = { states: STATES, callService: async (d, s, data) => { calls.push([d, s, data.entity_id]); if (refuse) throw new Error("refused"); } };
  const was = d3.api.toggle;
  d3.api.toggle = (eid) => LM.toggleEntity(hass, eid, { render() {}, toast: (m, e) => toasts.push([m, !!e]) });
  tapsOn = true;
  SWITCHED.length = 0;
  try {
    await d3Gesture(device("light.dim"));
    const dimNow = LM.effectiveState("light.dim", "on");
    await d3Gesture(device("light.plain"));
    const plainNow = LM.effectiveState("light.plain", "off");
    LM.clearOptimistic("light.dim"); LM.clearOptimistic("light.plain");
    refuse = true;
    aim = { hit: device("light.dim"), under: [] };
    use.down(ev("pointerdown", 100, 100, now()));
    use.up(ev("pointerup", 100, 100, now()));
    const during = LM.effectiveState("light.dim", "on");          // flipped before Home Assistant answers
    await settle();
    const after = LM.effectiveState("light.dim", "on");
    check("switches: the Atlas's own toggle: on → turn_off, off → turn_on, flipped at once, put back and counted on a failure",
      JSON.stringify(calls) === JSON.stringify([["light", "turn_off", "light.dim"], ["light", "turn_on", "light.plain"], ["light", "turn_off", "light.dim"]])
      && dimNow.state === "off" && dimNow.optimistic && plainNow.state === "on" && plainNow.optimistic
      && during.state === "off" && during.optimistic && after.state === "on" && !after.optimistic
      && JSON.stringify(toasts) === JSON.stringify([["Could not toggle light.dim", true]]) && JSON.stringify(SWITCHED) === "[true,true,false]",
      { calls, dimNow, plainNow, during, after, toasts, SWITCHED });
  } finally {
    d3.api.toggle = was;
    LM.clearOptimistic("light.dim"); LM.clearOptimistic("light.plain");
  }
});

// ── the pressed ring ────────────────────────────────────────────────────────
await tryCase("ring: at 150 ms, filling to the hold, gold once armed; none without controls", async () => {
  const ov = root.children.find(n => n.localName === "svg");
  const rings = () => ov.children.filter(n => n.localName === "circle" && n.classList.contains("lpress"));
  aim = { hit: device("light.dim"), under: [] };
  const t0 = now();
  use.down(ev("pointerdown", 100, 100, t0));
  use.tick(t0 + 100);
  const before = rings().length;
  use.tick(t0 + 160);
  const r = rings()[0];
  const filling = !!r && !r.classList.contains("armed") && r.style.getPropertyValue("--lv-ring-ms") === `${LM.HOLD_MS - LM.PRESS_RING_MS}ms`
    && r.getAttribute("stroke-dasharray") === r.getAttribute("stroke-dashoffset");
  use.tick(t0 + 520);
  const armed = !!rings()[0] && rings()[0].classList.contains("armed") && use.state().press.armed;
  use.up(ev("pointerup", 100, 100, t0 + 600));
  const gone = rings().length === 0;
  d3.log.length = 0;
  // A motion sensor has no controls: no ring, ever.
  aim = { hit: device("binary_sensor.hall_motion"), under: [] };
  use.down(ev("pointerdown", 100, 100, t0));
  use.tick(t0 + 700);
  const noRing = rings().length === 0 && !use.state().press.armed;
  use.up(ev("pointerup", 100, 100, t0 + 800));
  // The flat Atlas's ring, for the same press: the same element.
  timerQueue.length = 0;
  marks["light.dim"].dispatchEvent(ev("pointerdown", 100, 100, now() - 700));
  runTimers();
  const flatRing = svg.children.find(n => n.localName === "circle" && n.classList.contains("lpress"));
  const sameRing = !!flatRing && flatRing.classList.contains("armed") && flatRing.style.getPropertyValue("--lv-ring-ms") === `${LM.HOLD_MS - LM.PRESS_RING_MS}ms`
    && flatRing.getAttribute("stroke") === r.getAttribute("stroke");
  marks["light.dim"].dispatchEvent(ev("pointercancel", 100, 100, now()));
  flat.log.length = 0; d3.log.length = 0;
  check("ring: at 150 ms, filling to the hold, gold once armed; none without controls",
    before === 0 && filling && armed && gone && noRing && sameRing, { before, filling, armed, gone, noRing, sameRing });
});

// ── the hover box ───────────────────────────────────────────────────────────
await tryCase("hud: what a click lands on and what is under it; Under does what the sidebar's does", async () => {
  const hudBox = root.children.find(n => n.className === "la3d-hud"), hud = hudBox.children[0];
  aim = { hit: device("light.dim"), under: [device("binary_sensor.hall_motion"), device("fan.ceiling"), device("light.plain")] };
  use.hover(ev("pointermove", 100, 100, now(), { pointerType: "mouse" }));
  const text = hud.textContent, shown = !hud.hidden;
  const unders = hud.children.filter(n => n.className === "lv-hoverhud-under");
  d3.log.length = 0;
  for (const b of unders) b.dispatchEvent({ type: "click", stopPropagation() {}, preventDefault() {} });
  const picks = d3.log.slice();
  // Over nothing it lingers, then goes (the Atlas's 450 ms grace).
  aim = null;
  const t = now();
  use.hover(ev("pointermove", 300, 300, t, { pointerType: "mouse" }));
  const lingers = !hud.hidden;
  use.tick(t + 200);
  const still = !hud.hidden;
  use.tick(t + 460);
  const gone = hud.hidden;
  check("hud: what a click lands on and what is under it; Under does what the sidebar's does",
    shown && unders.length === 3 && text.startsWith("Click" + device("light.dim").label) && text.includes("Under" + device("fan.ceiling").label)
    && JSON.stringify(picks) === JSON.stringify([["openActivity", "binary_sensor.hall_motion"], ["openControls", "fan.ceiling"], ["toggle", "light.plain"]])
    && lingers && still && gone && unders[0].title === "Act on this one instead — it's under the marker on top",
    { text, picks, lingers, still, gone });
});

// ── a piece of furniture that is a device (P5) ──────────────────────────────
// A piece linked to a light the Atlas knows is that light's own target (the
// view picks it as it picks the marker): every gesture makes the Atlas's
// calls. One linked to a device the Atlas has no marker for (a TV, a washer)
// opens Home Assistant's own controls for it, tap or hold, and switches
// nothing; "Under" does the same.
await tryCase("piece: a lamp linked to a light makes the Atlas's calls; any other device opens Home Assistant's controls", async () => {
  const runs = [];
  for (const [g, opts] of Object.entries({ tap: {}, hold: { held: 700 }, dim: { held: 700, moves: [[0, 40], [0, 80]] } })) {
    runs.push(await both(`piece light.dim ${g}`, marks["light.dim"], { ...device("light.dim"), anchor: { x: 1, y: 2, z: 3 } }, opts));
  }
  const seen = [];
  const prev = root.dispatchEvent;
  root.dispatchEvent = (e) => { if (e && e.type === "hass-more-info") seen.push([e.detail.entityId, !!e.bubbles, !!e.composed]); return true; };
  const tv = { kind: "entity", key: "entity:media_player.tv", eid: "media_player.tv", label: "Lounge TV" };
  d3.log.length = 0;
  const pressed = await d3Gesture(tv);
  await d3Gesture(tv, { held: 700 });
  aim = { hit: device("light.dim"), under: [tv] };
  use.hover(ev("pointermove", 100, 100, now(), { pointerType: "mouse" }));
  const hud = root.children.find(n => n.className === "la3d-hud").children[0];
  for (const b of hud.children.filter(n => n.className === "lv-hoverhud-under")) b.dispatchEvent({ type: "click", stopPropagation() {}, preventDefault() {} });
  aim = null;
  root.dispatchEvent = prev;
  check("piece: a lamp linked to a light makes the Atlas's calls; any other device opens Home Assistant's controls",
    runs.every(r => r.same && r.d3.length) && pressed === true && d3.log.length === 0
    && JSON.stringify(seen) === JSON.stringify([["media_player.tv", true, true], ["media_player.tv", true, true], ["media_player.tv", true, true]]),
    { bad: runs.filter(r => !r.same), seen, log: d3.log });
});

// ── quiet ───────────────────────────────────────────────────────────────────
await tryCase("quiet: no api, no press; a device the Atlas doesn't know, no press", async () => {
  apiOn = false;
  aim = { hit: device("light.dim"), under: [] };
  const a = use.down(ev("pointerdown", 1, 1, now()));
  apiOn = true;
  aim = { hit: { kind: "device", key: "device:light.nowhere", eid: "light.nowhere", label: "x" }, under: [] };
  const b = use.down(ev("pointerdown", 1, 1, now()));
  aim = null;
  const c = use.down(ev("pointerdown", 1, 1, now()));
  check("quiet: no api, no press; a device the Atlas doesn't know, no press", a === false && b === false && c === false && !use.pressing, { a, b, c });
});

// ── a tag's or a scanner's card (P6) ────────────────────────────────────────
await tryCase("card: a tapped tag or scanner says what it is beside it, calls nothing, and goes on the next press or ×", async () => {
  const tag = { kind: "tag", key: "tag:ble:keys", label: "Keys · tag",
                card: { title: "Keys", lines: ["In Kitchen", "Seen just now", "Heard by: Kitchen (0B:52), Hall (D7:1E)"] } };
  const scanner = { kind: "scanner", key: "scanner:AA:BB", label: "Kitchen scanner (AA:BB)", card: { title: "Kitchen scanner (AA:BB)", lines: ["In Kitchen", "2.20 m above the floor"] } };
  const cards = () => root.children.filter(n => n && n.className === "la3d-tagcard");
  d3.log.length = 0;
  const pressed = await d3Gesture(tag);
  const one = { n: cards().length, st: use.state().card, at: cards()[0] && [cards()[0].style.left, cards()[0].style.top] };
  await d3Gesture(scanner, { held: 700 });                   // a hold opens it too
  const two = { n: cards().length, st: use.state().card };
  aim = null;
  use.down(ev("pointerdown", 5, 5, now()));                 // a press anywhere: gone
  const gone = cards().length;
  await d3Gesture(tag);
  const x = cards()[0] && cards()[0].querySelector("button");
  if (x) x.click();
  check("card: a tapped tag or scanner says what it is beside it, calls nothing, and goes on the next press or ×",
    pressed === true && one.n === 1 && one.st && one.st.key === "tag:ble:keys" && one.st.text.includes("Keys") && one.st.text.includes("In Kitchen")
    && one.st.text.includes("Seen just now") && one.st.text.includes("Heard by: Kitchen (0B:52), Hall (D7:1E)") && one.at.every(v => /^\d+px$/.test(v))
    && two.n === 1 && two.st.key === "scanner:AA:BB" && two.st.text.includes("2.20 m above the floor")
    && gone === 0 && !!x && cards().length === 0 && use.state().card === null && d3.log.length === 0,
    { pressed, one, two, gone, log: d3.log });
});

void rafQueue;
process.stdout.write(JSON.stringify({ cases, failures }) + "\n", () => process.exit(failures.length ? 1 : 0));   // exit only once the result is written (a pipe holds 64 KiB)
