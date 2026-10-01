// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
//
// Live Aboard's 3D view (views/live_aboard.js) over its life, run for real
// under the DOM shim with a stub GL (tests/js/stub_gl.mjs): three.js's own
// renderer, the view's own frames and teardown.
//
//   release   switched off (or the licence lapsing), nothing of the view
//             is kept: no listener on the window, the document or the
//             sprites' one shared geometry (three.js hangs one there for
//             every renderer that draws a sprite), none of the host's data;
//             over several off/on cycles the counts stay flat
//   frames    at rest the view asks for no frame at all: a room breathing
//             after motion and the air's bars are drawn still; a pulse just
//             started plays at full rate, then shows still; a door swings at
//             full rate and stops; a lock just unlocked flashes, then glows
//             still while it stays unlocked
//   gap       a gap (material "open") with a sensor keeps its reading and
//             its tap target, as the Atlas keeps its line and hit-line
//
// usage: live_aboard_view.mjs <www/padspan-ha dir>
// prints one JSON line: { cases: {name: result}, failures: [...] }

import { pathToFileURL } from "node:url";
import { join } from "node:path";
import * as shim from "./dom_shim.mjs";
import { installStubGL } from "./stub_gl.mjs";

const WWW = process.argv[2];
if (!WWW) { console.error("usage: live_aboard_view.mjs <www/padspan-ha dir>"); process.exit(2); }
shim.install();
// The window's and the document's listeners, as real lists (the shim's are no-ops).
const lists = { window: {}, document: {} };
const listen = (key) => ({
  add: (t, fn) => { (lists[key][t] ||= []).push(fn); },
  remove: (t, fn) => { lists[key][t] = (lists[key][t] || []).filter(f => f !== fn); },
});
const W = listen("window"), Dc = listen("document");
globalThis.addEventListener = W.add; globalThis.removeEventListener = W.remove;
document.addEventListener = Dc.add; document.removeEventListener = Dc.remove;
const listenerCount = (key) => Object.values(lists[key]).reduce((a, l) => a + l.length, 0);
installStubGL();

const LA = await import(pathToFileURL(join(WWW, "views", "live_aboard.js")).href);
const THREE = await import(pathToFileURL(join(WWW, "vendor", "three", "three.module.min.js")).href);

const failures = [];
const cases = {};
const check = (name, ok, detail) => { cases[name] = !!ok; if (!ok) failures.push({ name, detail: detail === undefined ? null : detail }); };
const tryCase = async (name, fn) => {
  try { await fn(); } catch (e) { failures.push({ name, detail: String(e && e.stack || e).slice(0, 900) }); cases[name] = false; }
};
const settle = async (rounds = 12) => { await shim.flush(rounds); await new Promise(r => globalThis._realSetTimeout(r, 0)); };

// ── the house: two floors (a badge each), a readout (a sprite) ──────────────
const rect = (floor_id, x0, y0, x1, y1) => ({ type: "poly", floor_id, points_m: [[x0, y0], [x1, y0], [x1, y1], [x0, y1]] });
const MODEL = {
  floors: [{ id: "basement", name: "Basement" }, { id: "main", name: "Main" }],
  room_geometry_m: { Rec: rect("basement", 0, 0, 6, 5), Living: rect("main", 0, 0, 4.5, 5), Den: rect("main", 4.6, 0, 8, 5) },
  rf_barriers_m: [{ id: "bar_k", name: "Living window", material: "glass", floor_id: "main", points_m: [[1, 5], [2.4, 5]] }],
  light_positions_m: { "light.den": { x_m: 6, y_m: 1, floor_id: "main" }, "sensor.den_temp": { x_m: 6, y_m: 4, floor_id: "main" } },
};
const LBE = {
  "light.den": { entity_id: "light.den", friendly_name: "Den light", state: "on", brightness: 200, shape: "pendant" },
  "sensor.den_temp": { entity_id: "sensor.den_temp", friendly_name: "Den temperature", isTemp: true, state: "21.5",
                       device_class: "temperature", unit_of_measurement: "°C" },
};
const api = { toast(){}, toggle(){}, openRoom(){}, openFloor(){}, openControls(){}, openActivity(){}, controlsFor: () => null, lightsByEid: {}, hass: null };
const P = (over = {}) => ({ model: MODEL, floors: MODEL.floors, lightsByEid: LBE, hidden: new Set(), topFloorIds: null, quality: "low",
  telemetry: () => {}, onTouch: () => {}, states: {}, config: {}, bearing: 0, saveNorth: async () => true, useApi: () => api,
  haStartedMs: 0, load: async () => ({ data: {} }), edit: async () => ({ data: {} }), ...over });
/** A fresh card, as the Atlas builds one every 5 s; the view moves into it. */
function card(slot, over){
  const c = document.createElement("div"), stage = document.createElement("div");
  c.appendChild(stage);
  document.body.replaceChildren(c);
  return { ok: slot.attach(stage, P(over)), stage };
}
// The one geometry three.js gives every sprite, and the listeners on it.
const spriteGeo = new THREE.Sprite().geometry;
const spriteListeners = () => (((spriteGeo._listeners || {}).dispose) || []).length;

// ── release ─────────────────────────────────────────────────────────────────
await tryCase("release: switched off, nothing of the view is kept", async () => {
  const w0 = listenerCount("window"), d0 = listenerCount("document"), g0 = spriteListeners();
  const slot = LA.liveAboardSlot("view-release");
  const { ok } = card(slot);
  await settle(30);
  const on = { ok, frames: slot._state().frames, sprites: spriteListeners(), w: listenerCount("window"), d: listenerCount("document") };
  LA.releaseLiveAboardSlot("view-release");
  const st = slot._state();
  const off = { sprites: spriteListeners(), w: listenerCount("window"), d: listenerCount("document"), held: st.held,
                inPage: document.body.contains(slot.element), gl: !!st.gl };
  check("release: switched off, nothing of the view is kept",
    on.ok && on.frames > 0 && on.sprites === g0 + 1 && on.d > d0
    && off.sprites === g0 && off.w === w0 && off.d === d0 && !off.inPage && !off.gl
    && off.held && Object.values(off.held).every(v => v === false), { w0, d0, g0, on, off });
});
await tryCase("release: over several off/on cycles the counts stay flat", async () => {
  const counts = [];
  for (let i = 0; i < 4; i++) {
    const slot = LA.liveAboardSlot("view-cycle");
    card(slot);
    await settle(30);
    LA.releaseLiveAboardSlot("view-cycle");
    counts.push([spriteListeners(), listenerCount("window"), listenerCount("document")]);
  }
  check("release: over several off/on cycles the counts stay flat",
    counts.every(c => JSON.stringify(c) === JSON.stringify(counts[0])), counts);
});

// ── frames ──────────────────────────────────────────────────────────────────
// The browser hands each frame its time; the shim's queue is driven here, on
// a clock the cases can move on.
let clockOff = 0;
const realNow = performance.now.bind(performance);
performance.now = () => realNow() + clockOff;
const shimRaf = globalThis.requestAnimationFrame;
globalThis.requestAnimationFrame = (fn) => shimRaf(() => fn(performance.now()));
const pendingFrames = () => shim.rafQueue.filter(Boolean).length;
const pendingTimers = () => shim.timerQueue.filter(Boolean).map(t => t.ms);
const ago = (ms) => new Date(Date.now() - ms).toISOString();
const LIVE = (over = {}) => ({
  ...LBE,
  "binary_sensor.den_motion": { entity_id: "binary_sensor.den_motion", friendly_name: "Den motion", isMotion: true, device_class: "motion",
                                state: "off", last_changed: ago(30 * 60e3) },
  "sensor.den_co2": { entity_id: "sensor.den_co2", friendly_name: "Den CO2", isAir: true, device_class: "carbon_dioxide", state: "900",
                      air_value: 900, unit_of_measurement: "ppm" },
  "lock.front": { entity_id: "lock.front", friendly_name: "Front lock", isLock: true, state: "locked" },
  "binary_sensor.back_door": { entity_id: "binary_sensor.back_door", friendly_name: "Back door", device_class: "door", state: "off" },
  ...over,
});
const LIVE_MODEL = { ...MODEL,
  rf_barriers_m: [...MODEL.rf_barriers_m,
    { id: "bar_front", name: "Front door", material: "wood", floor_id: "main", points_m: [[5.5, 5], [6.4, 5]], linked_entity_id: "lock.front" },
    { id: "bar_back", name: "Back door", material: "wood", floor_id: "main", points_m: [[1, 0], [1.9, 0]], linked_entity_id: "binary_sensor.back_door" }],
  light_positions_m: { ...MODEL.light_positions_m, "binary_sensor.den_motion": { x_m: 7, y_m: 2, floor_id: "main" },
                       "sensor.den_co2": { x_m: 7, y_m: 3, floor_id: "main" } } };
const liveP = (lbe) => ({ model: LIVE_MODEL, floors: LIVE_MODEL.floors, lightsByEid: lbe });
const den = (s) => s.tints.find(T => T.room === "Den") || null;
/** Run what is queued, with the clock moved on `ms` first. */
async function later(ms, rounds = 6){ clockOff += ms; await settle(rounds); }
const withLive = (eid, patch) => LIVE({ [eid]: { ...LIVE()[eid], ...patch } });

await tryCase("frames: at rest the view asks for no frame at all", async () => {
  const slot = LA.liveAboardSlot("view-frames");
  const { stage } = card(slot, liveP(LIVE()));
  await later(10000, 60);                                  // the quality check, then rest
  const s = slot._state(), d = den(s), queued = { frames: pendingFrames(), timers: pendingTimers() };
  const f0 = s.frames;
  await later(60000);
  const rest = slot._state().frames - f0;
  slot.attach(stage, P(liveP(LIVE())));                    // a poll: nothing changed
  await later(5000);
  check("frames: at rest the view asks for no frame at all",
    s.profile && d && d.motion && !d.motion.active && d.air && s.liveMs === 0 && !s.animating
    && queued.frames === 0 && queued.timers.length === 0 && rest === 0 && slot._state().frames === f0
    && Math.abs(d.fill - 0.33 * 0.45) < 1e-9 && d.bars > 0, { liveMs: s.liveMs, den: d, queued, rest, after: slot._state().frames - f0 });
  LA.releaseLiveAboardSlot("view-frames");
  await settle();
});
await tryCase("frames: a pulse just started plays at full rate, then shows still", async () => {
  const slot = LA.liveAboardSlot("view-pulse");
  const { stage } = card(slot, liveP(LIVE()));
  await later(10000, 60);
  slot.attach(stage, P(liveP(withLive("binary_sensor.den_motion", { state: "on", last_changed: ago(0) }))));
  await settle(2);
  const playing = { liveMs: slot._state().liveMs, queued: pendingFrames() + pendingTimers().length, rings: den(slot._state()).rings };
  const f0 = slot._state().frames;
  for (let i = 0; i < 20; i++) await later(100, 3);         // two seconds of it
  const drawn = slot._state().frames - f0;
  await later(6000, 12);                                   // past its start
  const s = slot._state(), d = den(s), f1 = s.frames;
  await later(30000);
  check("frames: a pulse just started plays at full rate, then shows still",
    playing.liveMs === 66 && playing.queued > 0 && playing.rings === 1 && drawn >= 12 && s.liveMs === 0 && d.motion.active && d.ringsShown === 0
    && Math.abs(d.fill - 0.375 * 0.6) < 1e-9 && slot._state().frames === f1 && pendingFrames() === 0 && pendingTimers().length === 0,
    { playing, drawn, liveMs: s.liveMs, den: d, after: slot._state().frames - f1, frames: pendingFrames(), timers: pendingTimers() });
  LA.releaseLiveAboardSlot("view-pulse");
  await settle();
});
await tryCase("frames: a door swings at full rate and stops when it is open", async () => {
  const slot = LA.liveAboardSlot("view-swing");
  const { stage } = card(slot, liveP(LIVE()));
  await later(10000, 60);
  slot.attach(stage, P(liveP(withLive("binary_sensor.back_door", { state: "on" }))));
  await settle(2);
  const swinging = slot._state().liveMs;
  for (let i = 0; i < 10; i++) await later(100, 3);
  const s = slot._state(), door = s.openings.find(o => o.eid === "binary_sensor.back_door"), f1 = s.frames;
  await later(30000);
  check("frames: a door swings at full rate and stops when it is open",
    swinging === 66 && door && door.state === "open" && door.at === 1 && s.liveMs === 0 && slot._state().frames === f1
    && pendingFrames() === 0 && pendingTimers().length === 0, { swinging, door, liveMs: s.liveMs, after: slot._state().frames - f1 });
  LA.releaseLiveAboardSlot("view-swing");
  await settle();
});
await tryCase("frames: a lock just unlocked flashes, then glows still", async () => {
  const slot = LA.liveAboardSlot("view-lock");
  const { stage } = card(slot, liveP(LIVE()));
  await later(10000, 60);
  slot.attach(stage, P(liveP(withLive("lock.front", { state: "unlocked" }))));
  await settle(2);
  const fresh = slot._state().liveMs, looks = [], f0 = slot._state().frames;
  for (let i = 0; i < 10; i++) { await later(130, 3); looks.push(slot._state().flash.opacity); }
  const drawn = slot._state().frames - f0;
  await later(6000, 12);
  const s = slot._state(), f1 = s.frames, glow = s.flash;
  await later(60000);
  check("frames: a lock just unlocked flashes, then glows still",
    fresh === 66 && drawn >= 8 && new Set(looks.map(v => v.toFixed(2))).size >= 4 && s.liveMs === 0
    && Math.abs(glow.opacity - 0.775) < 1e-9 && slot._state().frames === f1 && pendingFrames() === 0 && pendingTimers().length === 0,
    { fresh, drawn, looks, liveMs: s.liveMs, glow, after: slot._state().frames - f1 });
  LA.releaseLiveAboardSlot("view-lock");
  await settle();
});

await tryCase("frames: a poll draws nothing; back from Map, the view draws once", async () => {
  const slot = LA.liveAboardSlot("view-return");
  const { stage } = card(slot, liveP(LIVE()));
  await later(10000, 60);
  const f0 = slot._state().frames;
  slot.attach(stage, P(liveP(LIVE())));                    // a poll: the same card size, nothing changed
  await later(1000);
  const poll = slot._state().frames - f0;
  slot.detach();                                           // Map
  await later(30000);
  const map = slot._state().frames - f0 - poll;
  const again = card(slot, liveP(LIVE()));                 // 3D again, in the next card
  await later(1000);
  const back = slot._state().frames - f0 - poll - map;
  check("frames: a poll draws nothing; back from Map, the view draws once",
    poll === 0 && map === 0 && back === 1 && again.ok, { poll, map, back });
  LA.releaseLiveAboardSlot("view-return");
  await settle();
});
// ── gap ─────────────────────────────────────────────────────────────────────
await tryCase("gap: a gap with a sensor keeps its reading and its tap target, as the Atlas does", async () => {
  // A barrier of material "open" linked to a sensor: a doorway with no leaf.
  const model = { ...LIVE_MODEL, rf_barriers_m: [...LIVE_MODEL.rf_barriers_m,
    { id: "bar_arch", name: "Arch", material: "open", floor_id: "main", points_m: [[0, 1.5], [0, 2.7]], linked_entity_id: "binary_sensor.arch" }] };
  const arch = (state) => ({ ...LIVE(), "binary_sensor.arch": { entity_id: "binary_sensor.arch", friendly_name: "Arch beam", device_class: "opening", state } });
  const slot = LA.liveAboardSlot("view-gap");
  const { stage } = card(slot, { model, floors: model.floors, lightsByEid: arch("off") });
  await later(10000, 60);
  slot._look(-Math.PI / 2, 1.1, [0, 3, 2.1], 12);          // looking at the gap from inside the Living room
  await settle();
  const seen = () => slot._state().openings.find(o => o.eid === "binary_sensor.arch") || null;
  const shut = seen(), at = slot._where({ door: "binary_sensor.arch" }), hit = at && slot._pick(at[0], at[1]);
  slot.attach(stage, P({ model, floors: model.floors, lightsByEid: arch("on") }));
  await settle(4);
  const open = seen(), liveMs = slot._state().liveMs;
  slot.attach(stage, P({ model, floors: model.floors, lightsByEid: arch("unavailable") }));
  await settle(4);
  const none = seen();
  check("gap: a gap with a sensor keeps its reading and its tap target, as the Atlas does",
    shut && shut.kind === "open" && shut.state === "closed" && !!at && hit && /^door:binary_sensor\.arch@/.test(hit.hit)
    && open && open.state === "open" && open.at === open.to && liveMs === 0 && none && none.state === "none",
    { shut, at, hit, open, liveMs, none });
  LA.releaseLiveAboardSlot("view-gap");
  await settle();
});

console.log(JSON.stringify({ cases, failures }));
