// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
//
// A covered patio's ceiling lights in Live Aboard (views/live_aboard.js),
// run for real under the DOM shim with a stub GL: the owner's house has a
// patio on a lower floor under a deck on the floor above, and its lights must
// stay switchable from the wall.
//
//   taps     with every floor showing, a ceiling pot hangs under the deck's
//            slab, so from above it shows only on the patio's floor, past the
//            deck's edge: a tap there switches it; from straight above (the
//            spot under the deck) nothing is pressed for it
//   mark     the pot, off, has a small ring on the floor under it; on, the
//            ring goes (its pool shows instead)
//   same     an open deck's light and an indoor room's light have no floor
//            spot and no ring: exactly as before
//
// usage: covered_patio.mjs <www/padspan-ha dir>
// prints one JSON line: { cases: {name: result}, failures: [...] }

import { pathToFileURL } from "node:url";
import { join } from "node:path";
import * as shim from "./dom_shim.mjs";
import { installStubGL } from "./stub_gl.mjs";

const WWW = process.argv[2];
if (!WWW) { console.error("usage: covered_patio.mjs <www/padspan-ha dir>"); process.exit(2); }
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
const shimRaf = globalThis.requestAnimationFrame;
globalThis.requestAnimationFrame = (fn) => shimRaf(() => fn(performance.now()));

const LA = await import(pathToFileURL(join(WWW, "views", "live_aboard.js")).href);
const LM = await import(pathToFileURL(join(WWW, "views", "lights_map.js")).href);

const failures = [], cases = {};
const check = (name, ok, detail) => { cases[name] = !!ok; if (!ok) failures.push({ name, detail: detail === undefined ? null : detail }); };
const tryCase = async (name, fn) => {
  try { await fn(); } catch (e) { failures.push({ name, detail: String(e && e.stack || e).slice(0, 900) }); cases[name] = false; }
};
const settle = async (rounds = 14) => { await shim.flush(rounds); await new Promise(r => globalThis._realSetTimeout(r, 0)); };

// ── the house: a patio on Lower under a deck on Main; a den indoors ─────────
const rect = (floor_id, x0, y0, x1, y1) => ({ type: "poly", floor_id, points_m: [[x0, y0], [x1, y0], [x1, y1], [x0, y1]] });
const MODEL = {
  floors: [{ id: "lower", name: "Lower", floor_to_floor_m: 2.6 }, { id: "main", name: "Main", floor_to_floor_m: 2.8 }],
  floor_elevations: { lower: 0, main: 2.6 },
  room_geometry_m: { Rec: rect("lower", 0, 0, 6, 5), Patio: rect("lower", 0, 5, 6, 9), Den: rect("main", 0, 0, 6, 5), Deck: rect("main", 0, 5, 6, 9) },
  room_meta: {},
  light_positions_m: {
    "light.patio_pots": { x_m: 3, y_m: 8.4, floor_id: "lower" },
    "light.deck_pots": { x_m: 3, y_m: 7, floor_id: "main" },
    "light.den_pots": { x_m: 3, y_m: 2, floor_id: "main" },
  },
};
const NOW = Date.now();
const records = (st) => Object.fromEntries(LM.gatherLights(Object.fromEntries(Object.entries(st).map(([k, v]) => [k, { entity_id: k, last_changed: new Date(NOW - 600e3).toISOString(), ...v }])),
  { "light.patio_pots": "Patio", "light.deck_pots": "Deck", "light.den_pots": "Den" }, {}, "pro", {}, {}, {}, {}, NOW).map(l => [l.entity_id, l]));
const STATES = (patio = "off") => ({
  "light.patio_pots": { state: patio, attributes: { friendly_name: "Patio pot lights", brightness: 200 } },
  "light.deck_pots": { state: "off", attributes: { friendly_name: "Deck pot lights" } },
  "light.den_pots": { state: "off", attributes: { friendly_name: "Den pot lights" } },
});
const calls = [];
const api = (lbe) => ({ toast(){}, toggle: (e) => { calls.push(["toggle", e]); return true; }, openRoom: (r) => calls.push(["openRoom", r]), openFloor(){},
  openControls: (e) => calls.push(["openControls", e]), openActivity(){}, controlsFor: () => null, lightsByEid: lbe, hass: null });
const P = (lbe) => ({ model: MODEL, floors: MODEL.floors, lightsByEid: lbe, hidden: new Set(), topFloorIds: null, quality: "low",
  telemetry: () => {}, onTouch: () => {}, states: {}, config: {}, bearing: 0, saveNorth: async () => true, useApi: () => api(lbe),
  haStartedMs: 0, load: async () => ({ data: {} }), edit: null, mapOnly: true, prefs: null });
function card(slot, lbe){
  const c = document.createElement("div"), stage = document.createElement("div");
  c.appendChild(stage); document.body.replaceChildren(c);
  return slot.attach(stage, P(lbe));
}
const ev = (type, x, y, extra = {}) => ({ type, button: 0, pointerType: "mouse", pointerId: 1, clientX: x, clientY: y, deltaMode: 0,
  stopPropagation() {}, preventDefault() {}, composedPath: () => [], ...extra });
async function tapAt(slot, p){
  const cv = slot.element.querySelector("canvas");
  cv.dispatchEvent(ev("pointerdown", p[0], p[1], { timeStamp: performance.now() }));
  cv.dispatchEvent(ev("pointerup", p[0], p[1], { timeStamp: performance.now() + 40 }));
  await settle(4);
}
const fx = (slot, eid) => slot._state().fixtures.find(f => f.eid === eid) || null;

await tryCase("taps: past the deck's edge a tap on the floor under the patio's pot switches it; from straight above, nothing", async () => {
  const slot = LA.liveAboardSlot("covered-taps");
  card(slot, records(STATES()));
  await settle(30);
  // From the patio's open side (+y), low: the patio floor shows under the deck's edge.
  slot._look(0, 78 * Math.PI / 180, [3, 1, 7], 9);
  await settle(4);
  const spot = slot._where({ floorOf: "light.patio_pots" }), hit = spot && slot._pick(spot[0], spot[1]);
  calls.length = 0; if (spot) await tapAt(slot, spot);
  const side = { hit: hit && hit.hit, calls: calls.slice() };
  // From straight above: the deck hides the spot under it.
  slot._look(0, 0.01, [3, 1, 7], 9);
  await settle(4);
  const top = slot._where({ floorOf: "light.patio_pots" }), hitTop = top && slot._pick(top[0], top[1]);
  calls.length = 0; if (top) await tapAt(slot, top);
  const above = { hit: hitTop && hitTop.hit, calls: calls.slice() };
  LA.releaseLiveAboardSlot("covered-taps"); await settle(4);
  check("taps: past the deck's edge a tap on the floor under the patio's pot switches it; from straight above, nothing",
    side.hit === "device:light.patio_pots" && JSON.stringify(side.calls) === JSON.stringify([["toggle", "light.patio_pots"]])
    && above.hit !== "device:light.patio_pots" && !above.calls.some(c => c[1] === "light.patio_pots"), { side, above });
});
await tryCase("mark: off, a small ring on the floor under the pot; on, none (its pool instead); it still hangs at the ceiling", async () => {
  const slot = LA.liveAboardSlot("covered-mark");
  card(slot, records(STATES("off")));
  await settle(30);
  const off = fx(slot, "light.patio_pots");
  card(slot, records(STATES("on")));
  await settle(14);
  const on = fx(slot, "light.patio_pots");
  LA.releaseLiveAboardSlot("covered-mark"); await settle(4);
  check("mark: off, a small ring on the floor under the pot; on, none (its pool instead); it still hangs at the ceiling",
    off && off.marks && off.marks.length === off.bulbs && off.marks.every(Boolean) && on.marks.every(m => !m) && on.pools > 0
    && off.bulbH.every(h => h > 2.3), { off, on });
});
await tryCase("same: an open deck's and an indoor room's lights have no floor spot and no ring", async () => {
  const slot = LA.liveAboardSlot("covered-same");
  card(slot, records(STATES()));
  await settle(30);
  const deck = fx(slot, "light.deck_pots"), den = fx(slot, "light.den_pots");
  const spots = [slot._where({ floorOf: "light.deck_pots" }), slot._where({ floorOf: "light.den_pots" })];
  LA.releaseLiveAboardSlot("covered-same"); await settle(4);
  check("same: an open deck's and an indoor room's lights have no floor spot and no ring",
    deck && den && !("marks" in deck) && !("marks" in den) && spots.every(s => s === null), { deck, den, spots });
});

console.log(JSON.stringify({ cases, failures }));
process.exit(0);
