// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
//
// What stands on a line keeps clear of the words (views/live_aboard_raised.js,
// inside views/live_aboard.js), run for real under the DOM shim with a stub GL:
//
//   pick      the nearest spot that clears, a margin to move to one, none to
//             stay; nothing clears: the least overlap, only for a real gain
//   steps     the heights along a line stay within their reach
//   clears    looking down on a ceiling sensor over its room's name, it moves
//             clear of the name, within its bounds, its ring on its true spot
//   real      nothing about the sensor changes but where its marker is drawn;
//             asked for real heights, it stands at its real height
//   still     while the camera moves nothing is worked out; once it stops, once
//   rest      at rest: no timer and no frame; a poll that changes nothing moves
//             nothing, and draws nothing of its own
//   none      with nothing on a line and the words apart, a stop is looked at
//             once and nothing moves; with nothing at all, not even the timer
//   spread    names and chips on each other: the first stays, the next moves
//             up or down to the nearest clear spot; it stays where it clears,
//             and goes home once nothing is in its way
//   words     a room's name with an outdoor chip on it ("Pantry" on "Entry
//             outside"): once the camera stops they stand apart, both shown,
//             neither moving while the camera moves
//
// usage: live_aboard_raised.mjs <www/padspan-ha dir>
// prints one JSON line: { cases: {name: result}, failures: [...] }

import { pathToFileURL } from "node:url";
import { join } from "node:path";
import * as shim from "./dom_shim.mjs";
import { installStubGL } from "./stub_gl.mjs";

const WWW = process.argv[2];
if (!WWW) { console.error("usage: live_aboard_raised.mjs <www/padspan-ha dir>"); process.exit(2); }
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
let clockOff = 0;                            // this harness's clock alone: a busy machine must not look like time passing
const clock0 = performance.now();
performance.now = () => clock0 + clockOff;
const shimRaf = globalThis.requestAnimationFrame;
globalThis.requestAnimationFrame = (fn) => shimRaf(() => fn(performance.now()));

const LA = await import(pathToFileURL(join(WWW, "views", "live_aboard.js")).href);
const LM = await import(pathToFileURL(join(WWW, "views", "lights_map.js")).href);
const RA = await import(pathToFileURL(join(WWW, "views", "live_aboard_raised.js")).href);
const { SHOWCASE_THEMES } = await import(pathToFileURL(join(WWW, "views", "iso_lights.js")).href);

const failures = [];
const cases = {};
const check = (name, ok, detail) => { cases[name] = !!ok; if (!ok) failures.push({ name, detail: detail === undefined ? null : detail }); };
const tryCase = async (name, fn) => {
  try { await fn(); } catch (e) { failures.push({ name, detail: String(e && e.stack || e).slice(0, 900) }); cases[name] = false; }
};
const settle = async (rounds = 14) => { await shim.flush(rounds); await new Promise(r => globalThis._realSetTimeout(r, 0)); };
const later = async (ms, rounds = 8) => { clockOff += ms; await settle(rounds); };
const pendingFrames = () => shim.rafQueue.filter(Boolean).length;

// ── the house: two big rooms, a ceiling sensor in the middle of the first ──
const rect = (floor_id, x0, y0, x1, y1) => ({ type: "poly", floor_id, points_m: [[x0, y0], [x1, y0], [x1, y1], [x0, y1]] });
const MODEL = (positions) => ({
  floors: [{ id: "main", name: "Main", level: 0 }],
  floor_elevations: { main: 0 },
  room_geometry_m: { Kitchen: rect("main", 0, 0, 7, 7), Hall: rect("main", 7.1, 0, 14, 7) },
  light_positions_m: positions,
});
const WITH = MODEL({ "binary_sensor.kitchen_presence": { x_m: 3.5, y_m: 3.5, floor_id: "main" } });
const WITHOUT = MODEL({ "light.kitchen": { x_m: 3, y_m: 2, floor_id: "main" } });
// A pantry with an outdoor temperature sensor just past its wall: the chip
// outside ("Entry outside 21°") stands where the room's name does.
const CROWD = {
  floors: [{ id: "main", name: "Main", level: 0 }],
  floor_elevations: { main: 0 },
  room_geometry_m: { Pantry: rect("main", 0, 0, 3, 1) },
  light_positions_m: { "sensor.entry_outside_temperature": { x_m: 1.5, y_m: 1.25, floor_id: "main" } },
};
const iso = (ms) => new Date(ms).toISOString();
const NOW = Date.now();
const STATES = () => ({
  "sun.sun": { entity_id: "sun.sun", state: "above_horizon", attributes: { azimuth: 160, elevation: 40 } },
  "light.kitchen": { entity_id: "light.kitchen", state: "on", last_changed: iso(NOW - 6e5), attributes: { friendly_name: "Kitchen light", brightness: 200 } },
  "binary_sensor.kitchen_presence": { entity_id: "binary_sensor.kitchen_presence", state: "on", last_changed: iso(NOW - 6e4), attributes: { friendly_name: "Kitchen presence", device_class: "occupancy" } },
  "sensor.entry_outside_temperature": { entity_id: "sensor.entry_outside_temperature", state: "21.5", last_changed: iso(NOW - 6e4), last_updated: iso(NOW - 6e4),
    attributes: { friendly_name: "Entry outside temperature", device_class: "temperature", unit_of_measurement: "°C" } },
});
const AREAS = { "binary_sensor.kitchen_presence": "Kitchen", "light.kitchen": "Kitchen" };
const records = (states) => Object.fromEntries(LM.gatherLights(states, AREAS, {}, "pro", {}, {}, {}, {}, Date.now()).map(l => [l.entity_id, l]));
const P = (model) => {
  const st = STATES(), lbe = records(st);
  return { model, floors: model.floors, lightsByEid: lbe, hidden: new Set(), topFloorIds: null, quality: "low",
    telemetry: () => {}, onTouch: () => {}, states: st, entities: {}, config: {}, bearing: 0, saveNorth: async () => true,
    useApi: () => ({ toast(){}, toggle(){}, openRoom(){}, openFloor(){}, openControls(){}, openActivity(){}, controlsFor: () => null, lightsByEid: lbe, hass: null }),
    haStartedMs: 0, load: async () => ({ data: {} }), edit: null, mapOnly: false, prefs: null,
    showcase: { key: "classic", theme: SHOWCASE_THEMES.classic }, classFilter: null, floodLatches: {}, codes: null, setTopFloor: () => {} };
};
const stages = new Map();
function attach(slot, model){
  let st = stages.get(slot);
  if (!st) {
    const c = document.createElement("div");
    st = document.createElement("div");
    c.appendChild(st); document.body.appendChild(c);
    stages.set(slot, st);
  }
  return slot.attach(st, P(model));
}
async function newSlot(key, model){
  const slot = LA.liveAboardSlot(key);
  attach(slot, model);
  await settle(30);
  await later(9000, 40);                                   // the quality check, then rest
  await later(1000, 20);
  return slot;
}
const R = (slot) => slot._state().raised;
const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;
const box = (x0, y0, x1, y1, text = true) => ({ x0, y0, x1, y1, text });
const spot = (d, b) => ({ d, parts: [b] });

// ── pure ────────────────────────────────────────────────────────────────────
await tryCase("pick: nearest clear, a margin to move, none to stay, least overlap only for a gain", async () => {
  const word = box(100, 100, 200, 120);
  const at = (y) => box(140, y, 170, y + 30, false);          // an icon, 30 px, its top at y
  const spots = [spot(0, at(95)), spot(0.2, at(60)), spot(0.4, at(30)), spot(0.6, at(0))];
  const covered = RA.chooseSpot(spots, 0, [word]);            // the real spot lies on the word: the nearest that clears
  const stays = RA.chooseSpot([spot(0, at(95)), spot(0.2, at(66))], 1, [word]);       // 4 px clear: enough to stay
  const home = RA.chooseSpot([spot(0, at(50)), spot(0.2, at(10))], 1, [word]);        // the real spot is clear by plenty: back
  const notHome = RA.chooseSpot([spot(0, at(66)), spot(0.2, at(10))], 1, [word]);     // clear by a little: it stays out
  const hair = RA.chooseSpot([spot(0, at(95)), spot(0.5, at(40)), spot(0.51, at(10))], 2, [word]);    // clear, and only a hair nearer: it stays
  const big = box(0, 0, 400, 400);
  const least = RA.chooseSpot([spot(0, box(390, 390, 420, 420)), spot(0.2, box(395, 395, 425, 425))], 0, [big]);
  const tiny = RA.chooseSpot([spot(0, box(398, 100, 428, 130)), spot(0.2, box(399, 100, 429, 130))], 0, [box(0, 0, 400, 400)]);
  const icons = RA.chooseSpot([spot(0, at(95)), spot(0.2, at(0))], 0, [box(100, 100, 200, 120, false)]);    // two icons cover no word
  check("pick: nearest clear, a margin to move, none to stay, least overlap only for a gain",
    covered === 1 && stays === 1 && home === 0 && notHome === 1 && hair === 2 && least === 1 && tiny === 0 && icons === 0,
    { covered, stays, home, notHome, hair, least, tiny, icons });
});
await tryCase("steps: nearest first, within reach either way", async () => {
  const a = RA.heightSteps(-0.6, 0.2, 0.2), b = RA.heightSteps(0, 0, 0.2), c = RA.heightSteps(0, 0.4, 0.2);
  check("steps: nearest first, within reach either way",
    a.length === 5 && a[0] === 0 && Math.min(...a) >= -0.6 - 1e-9 && Math.max(...a) <= 0.2 + 1e-9 && a.every((v, i) => !i || Math.abs(v) >= Math.abs(a[i - 1]) - 1e-9)
    && b.length === 1 && c.length === 3 && c.every(v => v >= 0), { a, b, c });
});

// ── in the view ─────────────────────────────────────────────────────────────
const slot = await newSlot("raised", WITH);
const EID = "binary_sensor.kitchen_presence";
const item = () => R(slot).items.find(i => i.id === EID);
const marker = () => slot._state().motionLayer.sensors.find(s => s.eid === EID);
const down = () => { const c = slot._state().cam; slot._look(c.theta, 0.0015, [3.5, 0, 3.5], 12); };

await tryCase("clears: looking down, it moves clear of the room's name, within its bounds, its ring on its true spot", async () => {
  const c0 = marker();
  slot._raised.disable(true);
  down();
  await settle(14);
  const before = slot._raised.overlaps();
  slot._raised.disable(false);
  await later(300); await later(300);
  await later(600);
  const after = slot._raised.overlaps(), it = item(), m = marker();
  check("clears: looking down, it moves clear of the room's name, within its bounds, its ring on its true spot",
    before.count > 0 && after.count < before.count && after.area < before.area && it.shown
    && Math.hypot(...it.lift) > 0 && Math.hypot(it.lift[0], it.lift[2]) <= RA.LIFT.leanM + 1e-6 && it.lift[1] >= -RA.LIFT.downM - 1e-6 && it.lift[1] <= RA.LIFT.upM + 1e-6
    && near(m.home[0], c0.home[0], 1e-3) && near(m.home[1], c0.home[1], 1e-3) && near(m.home[2], c0.home[2], 1e-3)
    && near(m.at[0], m.home[0] + it.lift[0], 2e-3) && near(m.at[1], m.home[1] + it.lift[1], 2e-3) && near(m.at[2], m.home[2] + it.lift[2], 2e-3),
    { before, after, it, m, c0 });
});
await tryCase("real: drawing only; asked for real heights it stands at its real height", async () => {
  const moved = marker();
  slot._raised.disable(true);
  await settle(14);
  const m = marker(), it = item();
  slot._raised.disable(false);
  await later(1000);
  check("real: drawing only; asked for real heights it stands at its real height",
    Math.hypot(moved.at[0] - moved.home[0], moved.at[1] - moved.home[1], moved.at[2] - moved.home[2]) > 0
    && it.lift.every(v => v === 0) && near(m.at[0], m.home[0], 1e-3) && near(m.at[1], m.home[1], 1e-3) && near(m.at[2], m.home[2], 1e-3)
    && near(m.mount[0], 3.5, 1e-3) && near(m.mount[1], 3.5, 1e-3), { moved, m, it });
});
await tryCase("still: nothing is worked out while the camera moves; once when it stops", async () => {
  const runs0 = R(slot).runs, lift0 = JSON.stringify(item().lift), c = slot._state().cam, lifts = [];
  for (let i = 1; i <= 12; i++) {
    slot._look(c.theta + i * 0.1, 0.9, [3.5, 0, 3.5], 12);
    await later(60, 6);                                     // under restMs between moves
    lifts.push(JSON.stringify(item().lift));
  }
  const during = R(slot).runs;
  await later(RA.LIFT.restMs + 80, 8);
  const once = R(slot).runs;
  await later(1000, 8);
  await later(1000, 8);
  check("still: nothing is worked out while the camera moves; once when it stops",
    during === runs0 && lifts.every(v => v === lift0) && once === runs0 + 1 && R(slot).runs === once, { runs0, during, once, end: R(slot).runs, lifts });
});
await tryCase("rest: no timer and no frame; a poll that changes nothing moves nothing", async () => {
  down();
  await later(RA.LIFT.restMs + 80, 8); await later(1000, 8); await later(1000, 8);
  const a = R(slot), lift0 = JSON.stringify(item().lift), framesAt = slot._state().frames;
  const atRest = { armed: a.armed, easing: a.easing, frames: pendingFrames(), liveMs: slot._state().liveMs };
  await later(5000, 8);
  const quiet = slot._state().frames === framesAt;
  for (let i = 0; i < 4; i++) { attach(slot, WITH); await settle(10); await later(5000, 8); }
  const b = R(slot);
  check("rest: no timer and no frame; a poll that changes nothing moves nothing",
    !atRest.armed && !atRest.easing && atRest.frames === 0 && atRest.liveMs === 0 && quiet
    && b.runs === a.runs && b.moves === a.moves && JSON.stringify(item().lift) === lift0 && !b.armed && !b.easing,
    { atRest, quiet, a: { runs: a.runs, moves: a.moves }, b: { runs: b.runs, moves: b.moves, armed: b.armed, easing: b.easing }, lift0, lift1: item().lift });
});
await tryCase("none: with nothing on a line and the words apart, a stop is looked at once and nothing moves", async () => {
  const bare = await newSlot("raised-none", WITHOUT);
  const c = bare._state().cam, runs0 = bare._state().raised.runs;
  bare._look(c.theta + 0.5, 0.8, [3.5, 0, 3.5], 12);
  attach(bare, WITHOUT);
  await later(RA.LIFT.restMs + 80, 8); await later(1000, 8);
  const r = bare._state().raised, frames = bare._state().frames;
  await later(5000, 8);
  check("none: with nothing on a line and the words apart, a stop is looked at once and nothing moves",
    r.items.length === 0 && r.runs === runs0 + 1 && r.moves === 0 && !r.armed && !r.easing && r.words.length === 2 && r.words.every(w => w.dy === 0)
    && bare._state().frames === frames && pendingFrames() === 0, { r, runs0 });
  LA.releaseLiveAboardSlot("raised-none");
});
await tryCase("none: with one word and nothing on a line, not even the timer", async () => {
  const one = await newSlot("raised-one", { ...WITHOUT, room_geometry_m: { Kitchen: WITHOUT.room_geometry_m.Kitchen } });
  const c = one._state().cam, runs0 = one._state().raised.runs;
  one._look(c.theta + 0.5, 0.8, [3.5, 0, 3.5], 12);
  const r = one._state().raised;
  await later(1000, 8);
  check("none: with one word and nothing on a line, not even the timer", !r.armed && one._state().raised.runs === runs0 && r.items.length === 0, { r, runs0 });
  LA.releaseLiveAboardSlot("raised-one");
});

// ── names and chips apart ───────────────────────────────────────────────────
await tryCase("spread: the first stays, the next moves to the nearest clear spot; it stays where it clears, and goes home", async () => {
  const name = box(100, 100, 160, 116), on = box(120, 104, 220, 120), away = box(300, 100, 360, 116);
  const U = (b, dy = 0, h = 20) => ({ parts: [b], dy, h });
  const a = RA.spreadWords([U(name), U(on), U(away)]);
  const step = 20 * RA.SPREAD.step;
  // moved down 12 px, it clears by 3 + 6 more: it stays there, though 1 step nearer would clear by a hair
  const held = RA.spreadWords([U(name), U(box(120, 124, 220, 140), 20)]);
  const home = RA.spreadWords([U(box(400, 100, 460, 116)), U(box(120, 124, 220, 140), 20)]);   // nothing in its way now
  const shifted = (b, dy) => box(b.x0, b.y0 + dy, b.x1, b.y1 + dy);
  const clear = (dys) => RA.costOf([shifted(on, dys[1])], [shifted(name, dys[0])], RA.LIFT.pad) === 0;
  check("spread: the first stays, the next moves to the nearest clear spot; it stays where it clears, and goes home",
    a[0] === 0 && a[2] === 0 && a[1] !== 0 && clear(a) && Math.abs(a[1]) <= RA.SPREAD.steps * step
    && !RA.spreadWords([U(name), U(on)]).some((d, i) => i && Math.abs(d) < Math.abs(a[1]))
    && held[0] === 0 && held[1] === 20 && home[1] === 0, { a, held, home, step });
});
await tryCase("words: a room's name and an outdoor chip on it stand apart once the camera stops, both shown, still while it moves", async () => {
  const s = await newSlot("raised-words", CROWD);
  const look = (t = 0) => s._look(0.3 + t, 0.0015, [1.5, 0, 0.8], 60);
  s._raised.disable(true);
  look();
  await settle(14);
  const before = s._raised.overlaps().crowd;
  s._raised.disable(false);
  await later(RA.LIFT.restMs + 80, 8); await later(600, 8); await later(600, 8);
  const after = s._raised.overlaps().crowd, w = s._state().raised.words, st = s._state();
  const shown = st.names.filter(n => n.room === "Pantry" && n.shown).length === 1 && st.chips.filter(c => c.room === null && c.shown).length === 1;
  const dys = JSON.stringify(s._state().raised.words), runs0 = s._state().raised.runs, during = [];
  for (let i = 1; i <= 6; i++) { look(i * 0.05); await later(60, 6); during.push(JSON.stringify(s._state().raised.words)); }
  const still = during.every(d => d === dys) && s._state().raised.runs === runs0;
  check("words: a room's name and an outdoor chip on it stand apart once the camera stops, both shown, still while it moves",
    before.length > 0 && after.length === 0 && shown && w.some(x => x.dy !== 0) && still, { before, after, w, shown, still, during });
  LA.releaseLiveAboardSlot("raised-words");
});

console.log(JSON.stringify({ cases, failures }));
process.exit(0);
