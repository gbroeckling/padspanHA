// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
//
// Motion in Live Aboard (views/live_aboard_motion.js, with views/live_aboard.js
// and the shared card, views/lights_map.js), run for real under the DOM shim
// with a stub GL (tests/js/stub_gl.mjs):
//
//   ring      a rising edge (or a re-trigger the state shows) rings once,
//             rate-limited, on its room's own floor; never coming back from
//             no reading, never a restart's restored state
//   glow      the room's colour and strength at each of the Atlas's steps,
//             each fainter than the last, gone at six hours; the most recent
//             sensor in a room wins
//   boot      a restart's restored timestamp is quiet
//   presence  an occupancy or presence sensor on holds the room steady (a
//             flat fill, a solid line, no frames), then hands over to the
//             steps by age
//   pair      a motion + occupancy pair is one sensor, its occupancy half
//             holding the room
//   marker    lit size and tap target; a tap opens the activity calendar
//             through the use api; quiet ones hide at the whole house
//   cover     aimed by the marker's rotation or at the room's middle, its
//             reach from a range setting; shown only on a trigger's flash,
//             hovered, or under the motion lens
//   health    no reading: no glow, a dashed ring; stuck on: hatched, ⚠
//   chip      the newest rooms in their colours; a tap flies there
//   outside   on the ground under it, or nothing over nothing
//   frames    a ring plays on the capped clock, then the view rests
//
// usage: live_aboard_motion.mjs <www/padspan-ha dir>
// prints one JSON line: { cases: {name: result}, failures: [...] }

import { pathToFileURL } from "node:url";
import { join } from "node:path";
import * as shim from "./dom_shim.mjs";
import { installStubGL } from "./stub_gl.mjs";

const WWW = process.argv[2];
if (!WWW) { console.error("usage: live_aboard_motion.mjs <www/padspan-ha dir>"); process.exit(2); }
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
const H = await import(pathToFileURL(join(WWW, "views", "live_aboard_house.js")).href);
const MO = await import(pathToFileURL(join(WWW, "views", "live_aboard_motion.js")).href);
const { SHOWCASE_THEMES } = await import(pathToFileURL(join(WWW, "views", "iso_lights.js")).href);

const failures = [];
const cases = {};
const check = (name, ok, detail) => { cases[name] = !!ok; if (!ok) failures.push({ name, detail: detail === undefined ? null : detail }); };
const tryCase = async (name, fn) => {
  try { await fn(); } catch (e) { failures.push({ name, detail: String(e && e.stack || e).slice(0, 900) }); cases[name] = false; }
};
const settle = async (rounds = 14) => { await shim.flush(rounds); await new Promise(r => globalThis._realSetTimeout(r, 0)); };
const later = async (ms, rounds = 6) => { clockOff += ms; await settle(rounds); };
const pendingFrames = () => shim.rafQueue.filter(Boolean).length;

// ── the house ───────────────────────────────────────────────────────────────
// Main (on the ground): Kitchen, Hall, Den, Study; upstairs a Loft. A PIR on
// the kitchen's wall and another in it; a presence sensor in the middle of the
// hall (a ceiling unit) and a radar on its wall with a range setting; a
// motion + occupancy pair in the loft; one with no reading in the den, one
// stuck on in the study; one out in the yard on the ground, one out past the
// loft over nothing.
const rect = (floor_id, x0, y0, x1, y1) => ({ type: "poly", floor_id, points_m: [[x0, y0], [x1, y0], [x1, y1], [x0, y1]] });
const MODEL = {
  floors: [{ id: "main", name: "Main", level: 0 }, { id: "up", name: "Upstairs", level: 1 }],
  floor_elevations: { main: 0, up: 2.8 },
  room_geometry_m: { Kitchen: rect("main", 0, 0, 6, 4), Hall: rect("main", 6.1, 0, 10, 4), Den: rect("main", 0, 4.1, 6, 8),
                     Study: rect("main", 6.1, 4.1, 10, 8), Loft: rect("up", 0, 0, 5, 5) },
  light_positions_m: {
    "binary_sensor.kitchen_motion": { x_m: 2, y_m: 0.4, floor_id: "main" },
    "binary_sensor.kitchen_pir2": { x_m: 5.6, y_m: 3.6, floor_id: "main" },
    "binary_sensor.hall_presence": { x_m: 8, y_m: 2, floor_id: "main" },
    "binary_sensor.radar_x_occupancy": { x_m: 9.7, y_m: 1, floor_id: "main", rotation: 90 },
    "binary_sensor.loft_motion": { x_m: 2.5, y_m: 0.3, floor_id: "up" },
    "binary_sensor.loft_occupancy": { x_m: 2.6, y_m: 0.3, floor_id: "up" },
    "binary_sensor.den_motion": { x_m: 1, y_m: 5, floor_id: "main" },
    "binary_sensor.stuck_motion": { x_m: 8, y_m: 7.7, floor_id: "main" },
    "binary_sensor.yard_motion": { x_m: -3, y_m: 2, floor_id: "main" },
    "binary_sensor.balcony_motion": { x_m: -3, y_m: 2, floor_id: "up" },
    "light.kitchen": { x_m: 3, y_m: 2, floor_id: "main" },
  },
};
const FLOORS = MODEL.floors;
const NOW = Date.now();
const iso = (ms) => new Date(ms).toISOString();
const ago = (min) => iso(Date.now() - min * 60e3);
const fixed = (min) => iso(NOW - min * 60e3);             // a timestamp that is the same on every poll
const M = (name, dc = "motion") => ({ attributes: { friendly_name: name, device_class: dc } });
const STATES0 = () => ({
  "light.kitchen": { state: "on", attributes: { friendly_name: "Kitchen light", brightness: 200 } },
  "binary_sensor.kitchen_motion": { ...M("Kitchen motion"), state: "off", last_changed: fixed(600) },
  "binary_sensor.kitchen_pir2": { ...M("Kitchen corner"), state: "off", last_changed: fixed(600) },
  "binary_sensor.hall_presence": { ...M("Hall presence", "occupancy"), state: "off", last_changed: fixed(600) },
  "binary_sensor.radar_x_occupancy": { ...M("Hall radar", "occupancy"), state: "off", last_changed: fixed(600) },
  "number.radar_x_maximum_range": { state: "450", attributes: { friendly_name: "Hall radar maximum range", unit_of_measurement: "cm" } },
  "sensor.radar_x_target_distance": { state: "1.2", attributes: { friendly_name: "Hall radar target distance", unit_of_measurement: "m" } },
  "binary_sensor.loft_motion": { ...M("Loft Motion"), state: "off", last_changed: fixed(600) },
  "binary_sensor.loft_occupancy": { ...M("Loft Occupancy", "occupancy"), state: "off", last_changed: fixed(600) },
  "binary_sensor.den_motion": { ...M("Den motion"), state: "unavailable", last_changed: fixed(30) },
  "binary_sensor.stuck_motion": { ...M("Study motion"), state: "on", last_changed: fixed(8 * 60) },
  "binary_sensor.yard_motion": { ...M("Yard motion"), state: "off", last_changed: fixed(600) },
  "binary_sensor.balcony_motion": { ...M("Balcony motion"), state: "off", last_changed: fixed(600) },
});
const AREAS = { "binary_sensor.kitchen_motion": "Kitchen", "binary_sensor.kitchen_pir2": "Kitchen", "binary_sensor.hall_presence": "Hall",
                "binary_sensor.loft_motion": "Loft", "light.kitchen": "Kitchen" };
// The registry: the loft's two halves are one device (the Atlas folds them).
const ENTITIES = { "binary_sensor.loft_motion": { entity_id: "binary_sensor.loft_motion", device_id: "dev-loft" },
                   "binary_sensor.loft_occupancy": { entity_id: "binary_sensor.loft_occupancy", device_id: "dev-loft" } };
function hass(over = {}){
  const st = STATES0();
  for (const [k, v] of Object.entries(over)) st[k] = { ...st[k], ...v, attributes: { ...(st[k] || {}).attributes, ...(v.attributes || {}) } };
  return Object.fromEntries(Object.entries(st).map(([k, v]) => [k, { entity_id: k, last_changed: v.last_changed || ago(10), last_updated: ago(1), ...v }]));
}
const PAIRS = LM.computeMotionOccupancyPairs(Object.values(ENTITIES), hass());
const records = (states) => Object.fromEntries(LM.gatherLights(states, AREAS, {}, "pro", {}, {}, PAIRS, {}, Date.now()).map(l => [l.entity_id, l]));
const calls = [];
const api = (lbe) => ({ toast(){}, toggle: (e) => calls.push(["toggle", e]), openRoom: (r) => calls.push(["openRoom", r]), openFloor(){},
                        openControls: (e) => calls.push(["openControls", e]), openActivity: (e) => calls.push(["openActivity", e]),
                        controlsFor: (l) => (l && (l.isLock || l.dimmable) ? {} : null), lightsByEid: lbe, hass: null });
const DAY = { "sun.sun": { entity_id: "sun.sun", state: "above_horizon", attributes: { azimuth: 160, elevation: 40 } } };
const tops = [];
const P = (over = {}, statesOver = {}) => {
  const st = { ...hass(statesOver), ...DAY }, lbe = records(st);
  return { model: MODEL, floors: FLOORS, lightsByEid: lbe, hidden: new Set(), topFloorIds: null, quality: "low",
    telemetry: () => {}, onTouch: () => {}, states: st, entities: ENTITIES, config: {}, bearing: 0, saveNorth: async () => true,
    useApi: () => api(lbe), haStartedMs: 0, load: async () => ({ data: {} }), edit: null, mapOnly: false, prefs: null,
    showcase: { key: "classic", theme: SHOWCASE_THEMES.classic }, classFilter: null, floodLatches: {}, codes: null,
    setTopFloor: (fid) => tops.push(fid), ...over };
};
let stageOf = new Map();
function attach(slot, over, statesOver){
  let st = stageOf.get(slot);
  if (!st) {
    const c = document.createElement("div"), stage = document.createElement("div");
    c.appendChild(stage); document.body.appendChild(c);
    st = stage; stageOf.set(slot, st);
  }
  return slot.attach(st, P(over, statesOver));
}
async function newSlot(key, over = {}, statesOver = {}){
  const slot = LA.liveAboardSlot(key);
  attach(slot, over, statesOver);
  await settle(30);
  await later(9000, 40);                                   // the quality check, then rest
  return slot;
}
const S = (slot) => slot._state();
const ML = (slot) => S(slot).motionLayer;
const sensor = (slot, eid) => ML(slot).sensors.find(x => x.eid === eid) || null;
const patch = (slot, room) => ML(slot).patches.find(p => p.room === room) || null;
const canvasOf = (slot) => slot.element.querySelector("canvas");
const ev = (type, x, y, extra = {}) => ({ type, button: 0, pointerType: "mouse", pointerId: 1, clientX: x, clientY: y, deltaMode: 0,
  stopPropagation() {}, preventDefault() {}, composedPath: () => [], ...extra });
const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;

// ── pure: the ring's rule ───────────────────────────────────────────────────
await tryCase("ring: a rising edge or a re-trigger the state shows rings; nothing else does; one per 10 s", async () => {
  const t = 100000, started = Date.parse(ago(60 * 24));
  const off = { state: "off", last_changed: ago(30) }, on = { state: "on", last_changed: ago(0) };
  const r = {
    edge: MO.ringDue(off, on, started, null, t),
    still: MO.ringDue(on, { ...on }, started, null, t),
    retrig: MO.ringDue(on, { state: "on", last_changed: ago(-0.01) }, started, null, t),
    first: MO.ringDue(null, on, started, null, t),
    offline: MO.ringDue({ state: "unavailable", last_changed: ago(5) }, on, started, null, t),
    unknown: MO.ringDue({ state: "unknown", last_changed: ago(5) }, on, started, null, t),
    falling: MO.ringDue(on, off, started, null, t),
    soon: MO.ringDue(off, on, started, t - 4000, t),
    later: MO.ringDue(off, on, started, t - 10001, t),
    boot: MO.ringDue(off, { state: "on", last_changed: ago(1) }, Date.now() - 3 * 60e3, null, t),
    stale: MO.ringDue(off, { state: "on", last_changed: ago(5) }, started, null, t),
    staleRetrig: MO.ringDue({ state: "on", last_changed: ago(480) }, { state: "on", last_changed: ago(479.9) }, started, null, t),
  };
  const a = MO.ringAt(0, 5), b = MO.ringAt(0.5, 5), c = MO.ringAt(1, 5);
  check("ring: a rising edge or a re-trigger the state shows rings; nothing else does; one per 10 s",
    r.edge && !r.still && r.retrig && !r.first && !r.offline && !r.unknown && !r.falling && !r.soon && r.later && !r.boot
    && !r.stale && !r.staleRetrig
    && MO.RING.ms >= 1000 && MO.RING.ms <= 1500 && MO.RING.everyMs === 10000
    && a.r < b.r && b.r < c.r && near(c.r, 5) && a.a > b.a && b.a > c.a && near(c.a, 0) && b.r > (a.r + c.r) / 2,
    { r, a, b, c });
});

// ── pure: glow by age ───────────────────────────────────────────────────────
await tryCase("glow: each Atlas step in its colour, each fainter than the last; gone at six hours", async () => {
  const now = Date.now(), stops = H.MOTION_COLOR_STOPS, rows = [];
  for (let i = 0; i < stops.length; i++) {
    const at = i === 0 ? 0 : stops[i][0] + 30e3;
    const l = { entity_id: "binary_sensor.x", isMotion: true, device_class: "motion", state: i === 0 ? "on" : "off", last_changed: iso(now - at) };
    const g = MO.glowOf(l, now, 0), look = H.motionLook(l, now, 0);
    rows.push({ i, step: g && g.step, color: g && g.color, want: H.motionFill(look), k: g && g.k });
  }
  const hold = MO.glowOf({ entity_id: "binary_sensor.x", isMotion: true, device_class: "motion", state: "off", last_changed: iso(now - 4 * 60e3) }, now, 0);
  const gone = MO.glowOf({ entity_id: "binary_sensor.x", isMotion: true, device_class: "motion", state: "off", last_changed: iso(now - 6 * 3600e3 - 1000) }, now, 0);
  const hues = rows.slice(1).map(r => r.color);
  check("glow: each Atlas step in its colour, each fainter than the last; gone at six hours",
    rows.every(r => r.step === r.i && r.color === r.want) && rows.every((r, i) => !i || r.k < rows[i - 1].k) && rows.every(r => r.k > 0)
    && rows[0].color === "#3b82f6" && JSON.stringify(hues) === JSON.stringify(stops.slice(1).map(s => `hsl(${s[1]},75%,58%)`))
    && hold && hold.active && hold.step === 0 && hold.k === 1 && gone === null
    && MO.COLOUR_KEY.map(([, i]) => MO.stepColor(i)).join() === [rows[0].color, ...hues].join(), { rows, hold, gone });
});
await tryCase("boot: a restart's restored timestamp is quiet; really on after it still shows", async () => {
  const now = Date.now(), up = now - 2 * 60e3, restored = iso(up + 30e3);
  const quiet = MO.glowOf({ entity_id: "binary_sensor.x", isMotion: true, device_class: "motion", state: "off", last_changed: restored }, now, up);
  const on = MO.glowOf({ entity_id: "binary_sensor.x", isMotion: true, device_class: "motion", state: "on", last_changed: restored }, now, up);
  const ring = MO.ringDue({ state: "off", last_changed: restored }, { state: "on", last_changed: restored }, up, null, 1e6);
  check("boot: a restart's restored timestamp is quiet; really on after it still shows", quiet === null && on && on.active && !ring, { quiet, on, ring });
});
await tryCase("glow: several sensors in a room, the most recent wins; real motion before a stuck sensor; no reading counts for nothing", async () => {
  const a = { active: false, elapsed: 25 * 60e3, step: 2 }, b = { active: true, elapsed: 3 * 60e3, step: 0 }, c = { active: false, elapsed: 70 * 60e3, step: 4 };
  const stuck = { active: true, stuck: true, elapsed: 9 * 3600e3 }, none = { none: true };
  check("glow: several sensors in a room, the most recent wins; real motion before a stuck sensor; no reading counts for nothing",
    MO.roomGlow([a, b, c]) === b && MO.roomGlow([c, a]) === a && MO.roomGlow([stuck, c]) === c && MO.roomGlow([none, a]) === a
    && MO.roomGlow([none]) === null && MO.roomGlow([stuck]) === stuck, null);
});

// ── pure: presence, pairs, coverage ─────────────────────────────────────────
await tryCase("presence: on holds steady; cleared, the hold and the steps by age", async () => {
  const now = Date.now(), l = (state, min) => ({ entity_id: "binary_sensor.p", isMotion: true, device_class: "occupancy", state, last_changed: iso(now - min * 60e3) });
  const on = MO.glowOf(l("on", 90), now, 0, true), hold = MO.glowOf(l("off", 3), now, 0, true), later8 = MO.glowOf(l("off", 8), now, 0, true);
  const motionOn = MO.glowOf({ ...l("on", 1), device_class: "motion" }, now, 0, false);
  check("presence: on holds steady; cleared, the hold and the steps by age",
    on.steady && on.active && on.k === 1 && on.color === "#3b82f6" && !hold.steady && hold.active && hold.step === 0
    && !later8.steady && later8.step === 1 && !motionOn.steady
    && MO.sensorModelOf({ entity_id: "binary_sensor.p", device_class: "occupancy" }) === "presence"
    && MO.sensorModelOf({ entity_id: "binary_sensor.k", device_class: "motion" }) === "pir"
    && MO.sensorModelOf({ entity_id: "binary_sensor.garage_radar", device_class: "motion" }) === "presence"
    && MO.sensorModelOf({ entity_id: "binary_sensor.k", device_class: "motion" }, true) === "pair", { on, hold, later8 });
});
await tryCase("pair: the Atlas's pairs fold into one; its occupancy half is read as a record of its own", async () => {
  const st = hass({ "binary_sensor.loft_occupancy": { state: "on", last_changed: ago(12) } });
  const halves = MO.pairHalves(ENTITIES, st), rec = MO.halfRecord("binary_sensor.loft_occupancy", st["binary_sensor.loft_occupancy"]);
  const lbe = records(st);
  check("pair: the Atlas's pairs fold into one; its occupancy half is read as a record of its own",
    JSON.stringify(halves) === JSON.stringify({ "binary_sensor.loft_motion": "binary_sensor.loft_occupancy" })
    && rec.state === "on" && rec.device_class === "occupancy" && MO.glowOf(rec, Date.now(), 0, true).steady
    && lbe["binary_sensor.loft_motion"] && !lbe["binary_sensor.loft_occupancy"] && JSON.stringify(MO.pairHalves(null, st)) === "{}",
    { halves, rec });
});
await tryCase("cover: aimed by the marker's rotation or at the room's middle; reach from a range setting, else the kind's", async () => {
  const room = { pts: [[0, 0], [6, 0], [6, 4], [0, 4]], spot: { x: 3, y: 2 } };
  const mid = MO.aimOf(3, 0, room, 0), rot = MO.aimOf(3, 0, room, 90), none = MO.aimOf(3, 2, room, null, [0, 1]);
  const st = hass();
  const range = MO.rangeOf("binary_sensor.radar_x_occupancy", st, {}), noRange = MO.rangeOf("binary_sensor.hall_presence", st, {});
  const byDevice = MO.rangeOf("binary_sensor.r", { "number.other_name_detection_distance": { state: "5.5", attributes: { unit_of_measurement: "m" } } },
    { "binary_sensor.r": { device_id: "d1" }, "number.other_name_detection_distance": { device_id: "d1" } });
  const pir = MO.coverOf("pir", false, null), mm = MO.coverOf("presence", false, range), mm0 = MO.coverOf("presence", false, null), ceil = MO.coverOf("pir", true, null);
  const fan = MO.coverOf("pir", false, null);
  check("cover: aimed by the marker's rotation or at the room's middle; reach from a range setting, else the kind's",
    near(mid[0], 0) && near(mid[1], 1) && rot[0] > 0.7 && rot[1] < -0.7 && near(none[1], 1)
    && range === 4.5 && noRange === null && byDevice === 5.5
    && pir.deg === 100 && pir.m === 7 && mm.deg === 120 && mm.m === 4.5 && mm0.m === 6 && ceil.circle && ceil.m === 3.5
    && MO.inCover(fan, 3, 0, mid, 3, 5) && !MO.inCover(fan, 3, 0, mid, 3, -1) && !MO.inCover(fan, 3, 0, mid, 3, 7.5)
    && !MO.inCover(fan, 3, 0, mid, 6.5, 0.5), { mid, rot, none, range, noRange, byDevice, mm, ceil });
});
await tryCase("chip: the newest rooms first, in their colours and words; never a stuck sensor or one with no reading", async () => {
  const g = (o) => ({ active: false, on: false, steady: false, stuck: false, color: "c", ...o });
  const rows = [{ name: "Hall", eid: "h", glow: g({ elapsed: 4 * 60e3, active: true }) }, { name: "Den", eid: "d", glow: g({ elapsed: 30e3, active: true }) },
                { name: "Kitchen", eid: "k", glow: g({ elapsed: 20 * 60e3, on: true, active: true }) }, { name: "Study", eid: "s", glow: g({ stuck: true, elapsed: 0 }) },
                { name: "Attic", eid: "a", glow: { none: true } }, { name: "Loft", eid: "l", glow: g({ elapsed: 150 * 60e3 }) }];
  const out = MO.chipRooms(rows, 3);
  check("chip: the newest rooms first, in their colours and words; never a stuck sensor or one with no reading",
    JSON.stringify(out.map(r => [r.name, r.words])) === JSON.stringify([["Kitchen", "now"], ["Den", "just now"], ["Hall", "4 min"]])
    && MO.ageWords(g({ elapsed: 150 * 60e3 })) === "3 h" && MO.chipRooms(rows, 2).length === 2
    && MO.hoverWords("pir", "Kitchen", g({ elapsed: 3 * 60e3 })) === "Motion · Kitchen · 3 min ago"
    && MO.hoverWords("presence", "Hall", g({ on: true, steady: true })) === "Presence · Hall · someone here"
    && MO.hoverWords("pir", "Den", { none: true }) === "Motion · Den · no reading", out);
});

// ── the view ────────────────────────────────────────────────────────────────
let main = null;
await tryCase("marker: each kind on its wall facing in, or a ceiling unit; the pair is one sensor; quiet hides at the whole house", async () => {
  main = await newSlot("mo-main");
  const ml = ML(main), byEid = Object.fromEntries(ml.sensors.map(x => [x.eid, x]));
  const k = byEid["binary_sensor.kitchen_motion"], hall = byEid["binary_sensor.hall_presence"], radar = byEid["binary_sensor.radar_x_occupancy"];
  const loft = byEid["binary_sensor.loft_motion"];
  check("marker: each kind on its wall facing in, or a ceiling unit; the pair is one sensor; quiet hides at the whole house",
    k && k.model === "pir" && !k.ceiling && k.mount[1] < 0.2 && k.room === "Kitchen" && k.at[2] > k.mount[1] + 0.3
    && hall && hall.model === "presence" && hall.ceiling && hall.cover.circle && radar && !radar.ceiling && radar.range === 4.5 && radar.cover.m === 4.5
    && radar.aim[0] > 0.6 && radar.aim[1] < -0.6
    && loft && loft.model === "pair" && loft.half === "binary_sensor.loft_occupancy" && !byEid["binary_sensor.loft_occupancy"]
    && ml.sensors.length === 9 && !k.shown && !k.look.lit && k.look.size >= 20, { k, hall, radar, loft, n: ml.sensors.length });
});
await tryCase("ring: on the room's own floor, once per rising edge, rate-limited; then the view rests", async () => {
  const slot = main, t0 = ago(0);
  attach(slot, {}, { "binary_sensor.kitchen_motion": { state: "on", last_changed: t0 } });
  await settle(2);
  const s0 = S(slot), k0 = sensor(slot, "binary_sensor.kitchen_motion"), p0 = patch(slot, "Kitchen");
  await later(400, 3);
  const p1 = patch(slot, "Kitchen");
  const f0 = S(slot).frames;
  for (let i = 0; i < 12; i++) await later(100, 3);       // the rest of its 1.2 s, frame by frame
  const done = { k: sensor(slot, "binary_sensor.kitchen_motion"), p: patch(slot, "Kitchen"), live: S(slot).liveMs };
  const f1 = S(slot).frames;
  await later(20000);
  const rest = { frames: S(slot).frames - f1, pending: pendingFrames() };
  // A poll with the same state: no ring. Off and on again 3 s later: rate-limited.
  attach(slot, {}, { "binary_sensor.kitchen_motion": { state: "on", last_changed: t0 } });
  await settle(2);
  const same = sensor(slot, "binary_sensor.kitchen_motion").ring;
  // 21 s after the first ring (well past 10 s): a re-trigger the state shows rings.
  attach(slot, {}, { "binary_sensor.kitchen_motion": { state: "on", last_changed: ago(0) } });
  await settle(2);
  const again = sensor(slot, "binary_sensor.kitchen_motion").ring;
  await later(1600, 10);
  attach(slot, {}, { "binary_sensor.kitchen_motion": { state: "off", last_changed: ago(0) } });
  await settle(2);
  attach(slot, {}, { "binary_sensor.kitchen_motion": { state: "on", last_changed: ago(-0.01) } });
  await settle(2);
  const limited = sensor(slot, "binary_sensor.kitchen_motion").ring;
  await later(1600, 10);
  const geo = p0 && p0.room === "Kitchen";
  check("ring: on the room's own floor, once per rising edge, rate-limited; then the view rests",
    s0.liveMs > 0 && k0.ring && k0.flash && geo && p1.rings[0][3] > 0 && p1.rings[0][2] > 0.25 && p1.rings[0][0] === k0.mount[0]
    && p1.rings.slice(1).every(r => r[3] === 0) && !done.k.ring && done.p.rings[0][3] === 0 && done.live === 0
    && rest.frames === 0 && rest.pending === 0 && !same && again && !limited && f1 - f0 >= 3,
    { live: s0.liveMs, k0, p1: p1 && p1.rings, done, rest, same, again, limited, frames: f1 - f0 });
});
await tryCase("ring: drawn only on its room's floor — the patch is the room's own polygon", async () => {
  const ml = ML(main), kp = ml.patches.find(p => p.room === "Kitchen"), hp = ml.patches.find(p => p.room === "Hall");
  const k = sensor(main, "binary_sensor.kitchen_motion"), k2 = sensor(main, "binary_sensor.kitchen_pir2");
  check("ring: drawn only on its room's floor — the patch is the room's own polygon",
    kp && hp && kp !== hp && k.patch === ml.patches.indexOf(kp) && k2.patch === k.patch && !kp.ground && near(kp.y, 0.006, 1e-3)
    && sensor(main, "binary_sensor.hall_presence").patch === ml.patches.indexOf(hp), { kp, hp });
});
await tryCase("glow: the room by age at the Atlas's steps, in the view; the most recent sensor wins; gone at six hours", async () => {
  const at = async (over) => { attach(main, {}, over); await settle(4); return patch(main, "Kitchen"); };
  const g25 = await at({ "binary_sensor.kitchen_motion": { state: "off", last_changed: ago(25) } });
  const g70 = await at({ "binary_sensor.kitchen_motion": { state: "off", last_changed: ago(70) } });
  const both = await at({ "binary_sensor.kitchen_motion": { state: "off", last_changed: ago(70) }, "binary_sensor.kitchen_pir2": { state: "off", last_changed: ago(3) } });
  const gone = await at({ "binary_sensor.kitchen_motion": { state: "off", last_changed: ago(7 * 60) } });
  check("glow: the room by age at the Atlas's steps, in the view; the most recent sensor wins; gone at six hours",
    g25.glow.step === 2 && g25.color === "#" + new (await import(pathToFileURL(join(WWW, "vendor", "three", "three.module.min.js")).href)).Color(MO.stepColor(2)).getHexString()
    && g70.glow.step === 4 && g70.fill < g25.fill && g70.band.soft < g25.band.soft && g25.band.line === 0 && g25.visible
    && both.glow.active && both.color === "3b82f6".padStart(7, "#") && both.fill > g25.fill
    && gone.glow === null && !gone.visible && !gone.band.on, { g25, g70, both, gone });
});
await tryCase("presence: held steady, a flat fill and a solid line, no frames; cleared, it hands over to the steps", async () => {
  attach(main, {}, { "binary_sensor.hall_presence": { state: "on", last_changed: ago(30) } });
  await settle(4);
  await later(3000, 10);
  const held = patch(main, "Hall"), live = S(main).liveMs, f0 = S(main).frames;
  await later(30000);
  const f1 = S(main).frames;
  attach(main, {}, { "binary_sensor.hall_presence": { state: "off", last_changed: ago(1) } });
  await settle(4);
  const hold = patch(main, "Hall");
  attach(main, {}, { "binary_sensor.hall_presence": { state: "off", last_changed: ago(8) } });
  await settle(4);
  const step1 = patch(main, "Hall");
  check("presence: held steady, a flat fill and a solid line, no frames; cleared, it hands over to the steps",
    held.glow.steady && held.band.line > 0.9 && held.band.soft < hold.band.soft && held.fill < hold.fill && live === 0 && f1 === f0
    && !hold.glow.steady && hold.glow.active && hold.band.line === 0 && step1.glow.step === 1 && !step1.glow.steady,
    { held, hold, step1, live, frames: f1 - f0 });
});
await tryCase("pair: its occupancy half on holds the loft steady while the motion half is quiet; the marker lights with it", async () => {
  attach(main, {}, { "binary_sensor.loft_occupancy": { state: "on", last_changed: ago(12) } });
  await settle(4);
  const p = patch(main, "Loft"), s = sensor(main, "binary_sensor.loft_motion");
  attach(main, {}, {});
  await settle(4);
  const quiet = patch(main, "Loft");
  check("pair: its occupancy half on holds the loft steady while the motion half is quiet; the marker lights with it",
    p && p.glow && p.glow.steady && p.band.line > 0.9 && s.give.steady && !s.own && s.look.lit && s.look.steady
    && quiet.glow === null, { p, s, quiet });
});
await tryCase("health: no reading — no glow and a dashed ring; stuck on — hatched and a ⚠, never in the chip", async () => {
  attach(main, {}, {});
  await settle(4);
  const den = patch(main, "Den"), dead = sensor(main, "binary_sensor.den_motion");
  const study = patch(main, "Study"), stuck = sensor(main, "binary_sensor.stuck_motion");
  const chip = S(main).motionChip;
  check("health: no reading — no glow and a dashed ring; stuck on — hatched and a ⚠, never in the chip",
    den && den.glow === null && !den.visible && dead.own.none && dead.look.ring === "dashed" && !dead.look.lit
    && study && study.glow.stuck && study.hatch === 1 && study.visible && stuck.look.warn && stuck.look.lit
    && !chip.rows.some(r => r.name === "Study" || r.name === "Den"), { den, dead, study, stuck, chip });
});
await tryCase("marker: a tap target over its marker opens the activity calendar through the use api; the hover box says what and when", async () => {
  const slot = await newSlot("mo-tap", { topFloorIds: ["main"] }, { "binary_sensor.kitchen_motion": { state: "off", last_changed: ago(3) } });
  const k = sensor(slot, "binary_sensor.kitchen_motion");
  const at = slot._where({ eid: "binary_sensor.kitchen_motion" }), cv = canvasOf(slot);
  const hit = slot._pick(at[0], at[1]), off18 = slot._pick(at[0] + 18, at[1]);
  calls.length = 0;
  cv.dispatchEvent(ev("pointerdown", at[0], at[1], { timeStamp: performance.now() }));
  cv.dispatchEvent(ev("pointerup", at[0], at[1], { timeStamp: performance.now() + 40 }));
  await settle(4);
  const tap = calls.slice();
  cv.dispatchEvent(ev("pointermove", at[0], at[1]));
  await settle(4);
  const hud = S(slot).use.hud, fan = patch(slot, "Kitchen").fans[0], focus = ML(slot).focus;
  cv.dispatchEvent(ev("pointermove", 2, 2));
  await settle(4);
  const fanOff = patch(slot, "Kitchen").fans[0];
  LA.releaseLiveAboardSlot("mo-tap");
  check("marker: a tap target over its marker opens the activity calendar through the use api; the hover box says what and when",
    k.shown && k.look.lit && k.look.size >= 28 && hit && hit.hit === "device:binary_sensor.kitchen_motion" && off18 && off18.hit === "device:binary_sensor.kitchen_motion"
    && JSON.stringify(tap) === JSON.stringify([["openActivity", "binary_sensor.kitchen_motion"]])
    && hud && hud.includes("Motion · Kitchen · 3 min ago") && focus === "binary_sensor.kitchen_motion" && fan[3] > 0 && fanOff[3] === 0,
    { k, hit, off18, tap, hud, fan, fanOff });
});
await tryCase("cover: none at rest; every motion sensor's under the motion lens; a trigger flashes it for about 1.5 s; faded with another class", async () => {
  attach(main, {}, {});
  await settle(4);
  const rest = ML(main).patches.flatMap(p => p.fans).filter(f => f[3] > 0).length;
  attach(main, { classFilter: "motion" }, {});
  await settle(4);
  const lens = ML(main).patches.filter(p => p.fans.some(f => f[3] > 0)).map(p => p.room);
  attach(main, { classFilter: "light" }, {});
  await settle(4);
  const other = { dim: ML(main).sensors.every(x => x.dim), fans: ML(main).patches.flatMap(p => p.fans).filter(f => f[3] > 0).length,
                  study: patch(main, "Study").fill };
  attach(main, {}, {});
  await settle(4);
  const studyAll = patch(main, "Study").fill;
  attach(main, {}, { "binary_sensor.kitchen_pir2": { state: "on", last_changed: ago(0) } });
  await settle(2);
  await later(300, 3);
  const flash = patch(main, "Kitchen").fans[1];
  await later(1600, 10);
  const after = patch(main, "Kitchen").fans[1];
  check("cover: none at rest; every motion sensor's under the motion lens; a trigger flashes it for about 1.5 s; faded with another class",
    rest === 0 && ["Kitchen", "Hall", "Loft", "Study", "Den"].every(r => lens.includes(r)) && other.dim && other.fans === 0
    && other.study < studyAll * 0.3 && flash[3] > 0 && after[3] === 0 && MO.FLASH.ms >= 1200 && MO.FLASH.ms <= 1800,
    { rest, lens, other, studyAll, flash, after });
});
await tryCase("outside: the ring and glow on the ground under it; over nothing, the marker alone", async () => {
  attach(main, {}, { "binary_sensor.yard_motion": { state: "off", last_changed: ago(0) } });
  await settle(2);
  attach(main, {}, { "binary_sensor.yard_motion": { state: "on", last_changed: ago(-0.01) }, "binary_sensor.balcony_motion": { state: "off", last_changed: ago(2) } });
  await settle(2);
  await later(200, 3);
  const ml = ML(main), yard = sensor(main, "binary_sensor.yard_motion"), bal = sensor(main, "binary_sensor.balcony_motion");
  const gp = yard.patch >= 0 ? ml.patches[yard.patch] : null;
  const ground = -H.SLAB_T - 0.02 + 0.006;
  const chip = S(main).motionChip;
  await later(1600, 10);
  check("outside: the ring and glow on the ground under it; over nothing, the marker alone",
    gp && gp.ground && near(gp.y, ground, 1e-3) && gp.rings[0][3] > 0 && gp.visible && gp.fill > 0
    && bal.patch === -1 && bal.look.lit && bal.room === null && yard.room === null
    && chip.rows.some(r => r.eid === "binary_sensor.balcony_motion"), { gp, yard: { patch: yard.patch, ring: yard.ring }, bal, chip });
});
await tryCase("chip: the newest rooms in their colours; a tap flies there, showing a hidden floor first; ⓘ is the colour key", async () => {
  const slot = await newSlot("mo-chip", { topFloorIds: ["main"] }, { "binary_sensor.kitchen_motion": { state: "on", last_changed: ago(1) },
    "binary_sensor.hall_presence": { state: "off", last_changed: ago(4) }, "binary_sensor.loft_motion": { state: "off", last_changed: ago(25) } });
  const c = S(slot).motionChip;
  tops.length = 0;
  const loftAt = c.rows.findIndex(r => r.name === "Loft");
  const flew = S(slot).motionChip.rows.length ? slot.findDevice(c.rows[loftAt].eid) : false;
  await settle(4);
  const top = tops.slice();
  const keyText = c.keyText;
  attach(slot, { topFloorIds: ["main"] }, {});
  await settle(4);
  const quiet = S(slot).motionChip;
  LA.releaseLiveAboardSlot("mo-chip");
  check("chip: the newest rooms in their colours; a tap flies there, showing a hidden floor first; ⓘ is the colour key",
    c.shown && JSON.stringify(c.rows.map(r => [r.name, r.words])) === JSON.stringify([["Kitchen", "now"], ["Hall", "4 min"], ["Loft", "25 min"]])
    && c.rows[0].color === "#3b82f6" && c.rows[2].color === MO.stepColor(2) && c.text.startsWith("Motion:")
    && flew && top.includes("up") && /now.*5 min.*20 min.*40 min.*65 min.*90 min.*2 h/.test(keyText)
    && !quiet.shown, { c, flew, top, quiet });
});
await tryCase("frames: a room glowing for hours draws nothing; the age steps are redrawn once each, not animated", async () => {
  attach(main, {}, { "binary_sensor.kitchen_motion": { state: "off", last_changed: ago(19.9) } });
  await settle(4);
  await later(3000, 10);
  const f0 = S(main).frames, live = S(main).liveMs;
  await later(60000);
  const f1 = S(main).frames;
  attach(main, {}, { "binary_sensor.kitchen_motion": { state: "off", last_changed: ago(20.1) } });  // the next step
  await settle(6);
  const f2 = S(main).frames, step = patch(main, "Kitchen").glow.step;
  await later(30000);
  check("frames: a room glowing for hours draws nothing; the age steps are redrawn once each, not animated",
    live === 0 && f1 === f0 && f2 - f1 >= 1 && f2 - f1 <= 2 && S(main).frames === f2 && step === 2 && pendingFrames() === 0,
    { live, f0, f1, f2, step });
  LA.releaseLiveAboardSlot("mo-main");
});

console.log(JSON.stringify({ cases, failures }));
