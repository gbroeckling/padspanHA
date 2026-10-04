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
    toggle: (eid) => log.push(["toggle", eid]),
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
const root = document.createElement("div");
const use = U.createUseSurface({ root, pick: () => aim, screenOf: () => ({ x: 40, y: 50 }), api: () => (apiOn ? d3.api : null),
                                 frame() {}, cursor() {} });
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

void rafQueue;
console.log(JSON.stringify({ cases, failures }));
process.exit(failures.length ? 1 : 0);
