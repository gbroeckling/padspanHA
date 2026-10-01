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

console.log(JSON.stringify({ cases, failures }));
