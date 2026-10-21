// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
//
// Trails (views/people_trails.js), drawn by the tracked layer in the real 3D
// view under the DOM shim with a stub GL.
//
//   runs      Traceback's frames become each thing's runs: only the last half
//             hour, broken on a floor change or a long silence, the same spot
//             kept once, a run of one point dropped, room-only things none
//   fade      newest opaque, oldest faint; colours in turn
//   off       Trails off (the default): Traceback is never read, nothing drawn
//   on        on: read once, each person and tag drawn has its own ribbon in
//             its own colour on the floor it was walked on, fading; a floor
//             not showing hides its trails; read again no sooner than TRAIL_MS;
//             people and tags off, the trails go and nothing more is read
//
// usage: people_trails.mjs <www/padspan-ha dir>
// prints one JSON line: { cases: {name: result}, failures: [...] }

import { pathToFileURL } from "node:url";
import { join } from "node:path";
import * as shim from "./dom_shim.mjs";
import { installStubGL } from "./stub_gl.mjs";

const WWW = process.argv[2];
if (!WWW) { console.error("usage: people_trails.mjs <www/padspan-ha dir>"); process.exit(2); }
shim.install();
globalThis.addEventListener = () => {};
globalThis.removeEventListener = () => {};
installStubGL();

const LA = await import(pathToFileURL(join(WWW, "views", "live_aboard.js")).href);
const PT = await import(pathToFileURL(join(WWW, "views", "people_trails.js")).href);

const failures = [];
const cases = {};
const check = (name, ok, detail) => { cases[name] = !!ok; if (!ok) failures.push({ name, detail: detail === undefined ? null : detail }); };
const tryCase = async (name, fn) => {
  try { await fn(); } catch (e) { failures.push({ name, detail: String(e && e.stack || e).slice(0, 900) }); cases[name] = false; }
};
const clone = (x) => JSON.parse(JSON.stringify(x));
const settle = async (rounds = 12) => { await shim.flush(rounds); await new Promise(r => globalThis._realSetTimeout(r, 0)); };
let clockOff = 0, dateOff = 0;
const clock0 = performance.now();
performance.now = () => clock0 + clockOff;
const date0 = Date.now();
Date.now = () => date0 + dateOff;
const shimRaf = globalThis.requestAnimationFrame;
globalThis.requestAnimationFrame = (fn) => shimRaf(() => fn(performance.now()));
async function later(ms, rounds = 6){ clockOff += ms; dateOff += ms; await settle(rounds); }
const nowS = () => Date.now() / 1000;

// ── frames as Traceback keeps them ──────────────────────────────────────────
const O = (k, x, y, f = "main") => ({ k, r: "Living", x_m: x, y_m: y, f });
function FRAMES(){
  const t = nowS(), out = [];
  out.push({ ts: t - 3000, o: [O("irk:pixel", 0, 0)] });                       // older than half an hour
  for (let i = 0; i < 10; i++) out.push({ ts: t - 1500 + i * 10, o: [O("irk:pixel", 1 + i * 0.5, 2), O("ble:keys", 4, 4 + i * 0.3)] });
  out.push({ ts: t - 1390, o: [O("irk:pixel", 5.5, 2)] });                      // the same spot: kept once
  // Unheard for ten minutes, then upstairs.
  for (let i = 0; i < 4; i++) out.push({ ts: t - 700 + i * 10, o: [O("irk:pixel", 2 + i, 6)] });
  for (let i = 0; i < 4; i++) out.push({ ts: t - 300 + i * 10, o: [O("irk:pixel", 2 + i, 6, "upper")] });
  out.push({ ts: t - 100, o: [O("ble:lone", 1, 1), { k: "ble:room", r: "Living" }] });
  return out;
}

await tryCase("runs: the last half hour, broken on a floor or a silence, the same spot once", async () => {
  const T = PT.trailsOf(FRAMES(), nowS()), px = T.get("irk:pixel") || [];
  check("runs: the last half hour, broken on a floor or a silence, the same spot once",
    px.length === 3 && px[0].pts.length === 10 && px[0].pts[0].x === 1 && px[0].floor_id === "main"
    && px[1].floor_id === "main" && px[1].pts.length === 4 && px[2].floor_id === "upper" && px[2].pts.length === 4
    && (T.get("ble:keys") || []).length === 1 && !T.has("ble:lone") && !T.has("ble:room")
    && PT.trailsOf(null, nowS()).size === 0 && PT.trailsOf([{ ts: "x" }], nowS()).size === 0,
    { px: px.map(r => [r.floor_id, r.pts.length]), keys: [...T.keys()] });
});
await tryCase("fade: newest opaque, oldest faint; colours in turn", async () => {
  const m = PT.trailRequest(1000);
  check("fade: newest opaque, oldest faint; colours in turn",
    PT.fadeOf(0) === PT.FADE[0] && Math.abs(PT.fadeOf(PT.TRAIL_S) - PT.FADE[1]) < 1e-9 && PT.fadeOf(99999) === PT.fadeOf(PT.TRAIL_S)
    && PT.fadeOf(900) < PT.fadeOf(60) && PT.trailColour(0) !== PT.trailColour(1) && PT.trailColour(PT.TRAIL_COLOURS.length) === PT.trailColour(0)
    && m.type === "padspan_ha/traceback_get" && m.start_ts === 1000 - PT.TRAIL_S && m.max_frames === PT.TRAIL_FRAMES, { m });
});

// ── the view ────────────────────────────────────────────────────────────────
const rect = (floor_id, x0, y0, x1, y1) => ({ type: "poly", floor_id, points_m: [[x0, y0], [x1, y0], [x1, y1], [x0, y1]] });
const MODEL = {
  floors: [{ id: "main", name: "Main" }, { id: "upper", name: "Upper" }],
  room_geometry_m: { Living: rect("main", 0, 0, 30, 10), Loft: rect("upper", 0, 0, 30, 10) },
  rf_barriers_m: [], light_positions_m: {}, scanner_positions_m: {}, scanners: {},
};
const FILE = { schema: 1, pieces: {}, lights: {}, openings: {}, devices: {}, figures: {} };
const SNAP = { objects: { list: [
  { key: "irk:pixel", kind: "private_ble", x_m: 3, y_m: 3, floor_id: "upper", private_ble_name: "Garry's Pixel", linked_entities: ["device_tracker.pixel"] },
  { key: "ble:keys", kind: "ble", x_m: 4, y_m: 6, floor_id: "main", user_label: "Keys", room: "Living" },
] } };
const STATES = { "person.garry": { state: "home", attributes: { friendly_name: "Garry", device_trackers: ["device_tracker.pixel"] } } };
const store = new Map();
let people = null, tags = null, reads = 0, topFloorIds = null;
const trails = { read: async (msg) => { reads++; return msg && msg.type === "padspan_ha/traceback_get" ? { frames: FRAMES() } : null; } };
const P = () => ({ model: MODEL, floors: MODEL.floors, lightsByEid: {}, hidden: new Set(), topFloorIds, quality: "low",
  telemetry: () => {}, onTouch: () => {}, states: STATES, config: {}, bearing: 0, saveNorth: null, useApi: () => null,
  haStartedMs: 0, load: async () => ({ data: clone(FILE) }), edit: null, people, tags, trails,
  prefs: { get: (k) => store.get(k) ?? null, set: (k, v) => store.set(k, v) } });
const slot = LA.liveAboardSlot("trails");
function poll(){
  const card = document.createElement("div"), stage = document.createElement("div");
  card.appendChild(stage);
  document.body.replaceChildren(card);
  return slot.attach(stage, P());
}
const st = () => slot._state();

await tryCase("off: Trails off by default, Traceback never read, nothing drawn", async () => {
  people = { snapshot: () => SNAP }; tags = { snapshot: () => SNAP };
  poll(); await later(1000, 40);
  const s = st();
  check("off: Trails off by default, Traceback never read, nothing drawn",
    s.profile && reads === 0 && s.trailReads === 0 && s.trails.length === 0 && s.tracked.some(x => x.key === "person.garry"),
    { reads, trails: s.trails, tracked: s.tracked.map(x => x.key) });
});
await tryCase("on: each person and tag its own fading ribbon on its floor, read no more often than TRAIL_MS", async () => {
  store.set("trails", "1");
  poll(); await settle(20);
  const s = st(), g = s.trails.filter(t => t.owner === "person.garry"), k = s.trails.filter(t => t.owner === "beacon:ble:keys");
  const first = reads;
  for (let i = 0; i < 3; i++) { await later(5000, 6); poll(); await settle(6); }
  const within = reads;
  await later(PT.TRAIL_MS, 6); poll(); await settle(10);
  const after = reads;
  check("on: each person and tag its own fading ribbon on its floor, read no more often than TRAIL_MS",
    first === 1 && within === 1 && after === 2 && g.length === 3 && k.length === 1
    && g.map(t => t.floor).sort().join() === "main,main,upper" && k[0].floor === "main" && k[0].segments === 9
    && g[0].colour.join() !== k[0].colour.join() && k[0].alpha[0] > k[0].alpha[1] && k[0].alpha[0] <= PT.FADE[0] + 1e-6
    && g.every(t => t.shown) && k[0].shown,
    { first, within, after, trails: s.trails });
});
await tryCase("on: only the floor showing shows its trails", async () => {
  topFloorIds = ["main"];
  poll(); await settle(10);
  const s = st(), up = s.trails.filter(t => t.floor === "upper"), main = s.trails.filter(t => t.floor === "main");
  check("on: only the floor showing shows its trails",
    up.length === 1 && up.every(t => !t.shown) && main.length === 3 && main.every(t => t.shown), { trails: s.trails });
  topFloorIds = null;
});
await tryCase("on: people and tags off, the trails go and nothing more is read", async () => {
  people = null; tags = null;
  const was = reads;
  poll(); await later(PT.TRAIL_MS * 2, 10); poll(); await settle(10);
  const s = st();
  store.set("trails", "0");
  check("on: people and tags off, the trails go and nothing more is read", s.trails.length === 0 && reads === was, { reads, was, trails: s.trails });
});

console.log(JSON.stringify({ cases, failures }));
process.exit(0);
