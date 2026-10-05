// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
//
// Live Aboard P6, the live layer (views/live_aboard_tracked.js): beacons,
// scanners and people in the house, read from a fake live snapshot, then run
// for real inside the real 3D view under the DOM shim with a stub GL.
//
//   people    the snapshot's tracked things with a place (stale, ghosts and
//             placeless ones left out); each person found through their
//             phone or tag (its device tracker, or its name), each thing
//             someone's once
//   off       Show people off: the snapshot is never read, no beacon and no
//             person is drawn (a scanner with a look still stands)
//   on        a scanner with a look at its height on the map; a beacon with a
//             look where it is tracked; a person with a figure as their
//             figure, one without as a soft marker
//   walk      someone moving walks there (facing the way they go) on the
//             capped clock, and stops; at rest, 0 frames; far, or another
//             floor, they are there at once
//   reads     read through the host no more often than it says (and never
//             under 5 s); switched off, what was drawn goes
//
// usage: live_aboard_tracked.mjs <www/padspan-ha dir>
// prints one JSON line: { cases: {name: result}, failures: [...] }

import { pathToFileURL } from "node:url";
import { join } from "node:path";
import * as shim from "./dom_shim.mjs";
import { installStubGL } from "./stub_gl.mjs";

const WWW = process.argv[2];
if (!WWW) { console.error("usage: live_aboard_tracked.mjs <www/padspan-ha dir>"); process.exit(2); }
shim.install();
globalThis.addEventListener = () => {};
globalThis.removeEventListener = () => {};
installStubGL();

const LA = await import(pathToFileURL(join(WWW, "views", "live_aboard.js")).href);
const TR = await import(pathToFileURL(join(WWW, "views", "live_aboard_tracked.js")).href);

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
const realDate = Date.now.bind(Date);
Date.now = () => realDate() + dateOff;
const shimRaf = globalThis.requestAnimationFrame;
globalThis.requestAnimationFrame = (fn) => shimRaf(() => fn(performance.now()));
const pendingFrames = () => shim.rafQueue.filter(Boolean).length;
async function later(ms, rounds = 6){ clockOff += ms; dateOff += ms; await settle(rounds); }

// ── the snapshot and the people ─────────────────────────────────────────────
const OBJ = (key, kind, x, y, more = {}) => ({ key, kind, x_m: x, y_m: y, floor_id: "main", ...more });
const SNAP = (over = {}) => ({ objects: { list: [
  OBJ("ble:keys", "ble", 2, 2, { user_label: "Keys" }),
  OBJ("irk:pixel", "private_ble", 3, 3, { private_ble_name: "Garry's Pixel", linked_entities: ["device_tracker.pixel"], ...(over.pixel || {}) }),
  OBJ("ble:watch", "ble", 6, 1, { user_label: "Nicole's watch" }),
  OBJ("ble:stale", "ble", 1, 1, { user_label: "Old tag", _stale: true }),
  OBJ("ble:ghost", "ble", 1, 1, { user_label: "Ghost", _ghost: true }),
  OBJ("ble:nowhere", "ble", null, null, { user_label: "Nowhere" }),
  OBJ("ble:noise", "ble", 4, 4, {}),
] } });
const STATES = {
  "person.garry": { state: "home", attributes: { friendly_name: "Garry", device_trackers: ["device_tracker.pixel"] } },
  "person.nicole": { state: "home", attributes: { friendly_name: "Nicole", device_trackers: ["device_tracker.nicole_watch"] } },
  "person.visitor": { state: "not_home", attributes: { friendly_name: "Visitor", device_trackers: [] } },
  "device_tracker.nicole_watch": { state: "home", attributes: { friendly_name: "Nicole's watch" } },
};

await tryCase("people: tracked things with a place; each person through their phone or tag, once", async () => {
  const t = TR.trackedOf(SNAP());
  const P = TR.peopleOf(STATES, t);
  const by = Object.fromEntries(P.map(p => [p.eid, p.at && p.at.key]));
  // Two people on one thing: the first (by id) has it.
  const twin = TR.peopleOf({ ...STATES, "person.garry2": { state: "home", attributes: { friendly_name: "G2", device_trackers: ["device_tracker.pixel"] } } }, t);
  check("people: tracked things with a place; each person through their phone or tag, once",
    t.map(o => o.key).join() === "ble:keys,irk:pixel,ble:watch,ble:noise" && by["person.garry"] === "irk:pixel" && by["person.nicole"] === "ble:watch"
    && by["person.visitor"] === null && twin.filter(p => p.at && p.at.key === "irk:pixel").length === 1
    && TR.trackedOf(null).length === 0 && TR.trackedOf({ objects: {} }).length === 0, { t: t.map(o => o.key), by });
});

// ── the house and the view ──────────────────────────────────────────────────
const rect = (floor_id, x0, y0, x1, y1) => ({ type: "poly", floor_id, points_m: [[x0, y0], [x1, y0], [x1, y1], [x0, y1]] });
const MODEL = {
  floors: [{ id: "main", name: "Main" }, { id: "upper", name: "Upper" }],
  room_geometry_m: { Living: rect("main", 0, 0, 30, 10), Loft: rect("upper", 0, 0, 30, 10) },
  rf_barriers_m: [], light_positions_m: {},
  scanner_positions_m: { "AA:BB:CC:DD:EE:01": { x_m: 5, y_m: 5, z_m: 2.2, floor_id: "main" }, "AA:BB:CC:DD:EE:02": { x_m: 7, y_m: 5, z_m: 2.0, floor_id: "main" } },
};
const LOOK = (kind, w, d, h) => ({ recipe: { kind, params: {}, colors: ["#222222"], width_m: w, depth_m: d, height_m: h }, library_id: null, submission_id: null });
const FILE = { schema: 1, pieces: {}, lights: {}, openings: {},
  devices: { "AA:BB:CC:DD:EE:01": LOOK("scanner", 0.06, 0.03, 0.09), "ble:keys": LOOK("tag", 0.04, 0.04, 0.012) },
  figures: { "person.garry": { params: { height_m: 1.8, build: "medium", hair: "short", glasses: true, hat: false,
                                          colors: { hair: "#3a2a1a", skin: "#c8956d", top: "#224466", bottom: "#333333" } }, origin: "build" } } };
let snap = SNAP(), people = null, fetches = 0;
const P = () => ({ model: MODEL, floors: MODEL.floors, lightsByEid: {}, hidden: new Set(), topFloorIds: null, quality: "low",
  telemetry: () => {}, onTouch: () => {}, states: STATES, config: {}, bearing: 0, saveNorth: null, useApi: () => null,
  haStartedMs: 0, load: async () => ({ data: clone(FILE) }), edit: null, people });
const slot = LA.liveAboardSlot("tracked");
function poll(){
  const card = document.createElement("div"), stage = document.createElement("div");
  card.appendChild(stage);
  document.body.replaceChildren(card);
  return slot.attach(stage, P());
}
const st = () => slot._state();
const item = (k) => st().tracked.find(x => x.key === k) || null;

await tryCase("off: Show people off, the snapshot is never read and no one is drawn", async () => {
  people = null;
  poll();
  await later(10000, 60);
  const s = st();
  check("off: Show people off, the snapshot is never read and no one is drawn",
    s.profile && s.peopleReads === 0 && s.tracked.length === 1 && s.tracked[0].key === "scanner:AA:BB:CC:DD:EE:01", { reads: s.peopleReads, tracked: s.tracked });
});
await tryCase("on: a scanner at its height, a beacon where it is, a figure, and a marker for someone with none", async () => {
  people = { snapshot: () => snap };
  poll();
  await settle();
  const s = st(), sc = item("scanner:AA:BB:CC:DD:EE:01"), keys = item("beacon:ble:keys"), g = item("person.garry"), n = item("person.nicole");
  check("on: a scanner at its height, a beacon where it is, a figure, and a marker for someone with none",
    s.tracked.length === 4 && sc && sc.at[1] > 1.9 && sc.at[1] < 2.2 && sc.at[0] === 5 && sc.at[2] === 5
    && keys && keys.at[0] === 2 && keys.at[2] === 2 && keys.at[1] > 0.85 && keys.at[1] < 0.9
    && g && !g.marker && g.at[0] === 3 && g.at[1] === 0 && g.at[2] === 3 && n && n.marker && n.at[0] === 6 && !item("person.visitor")
    && !item("beacon:ble:watch") && s.liveMs === 0, { tracked: s.tracked });
});
await tryCase("walk: someone moving walks there, facing the way, on the capped clock; then stops", async () => {
  snap = SNAP({ pixel: { x_m: 6, y_m: 3 } });                // three metres east
  poll();
  await settle(4);
  const start = { g: item("person.garry"), liveMs: st().liveMs }, f0 = st().frames;
  await later(1000, 12);
  const mid = item("person.garry");
  for (let i = 0; i < 30; i++) await later(100, 3);
  const end = item("person.garry"), f1 = st().frames;
  await later(20000, 12);
  check("walk: someone moving walks there, facing the way, on the capped clock; then stops",
    start.g.walking && start.liveMs === TR.WALK_MS.low && mid.at[0] > 3.2 && mid.at[0] < 5.8 && Math.abs(mid.yaw - Math.PI / 2) < 1e-3
    && !end.walking && end.at[0] === 6 && f1 - f0 >= 20 && f1 - f0 <= 42 && st().frames === f1 && st().liveMs === 0 && pendingFrames() === 0,
    { start, mid, end, frames: f1 - f0, after: st().frames - f1 });
});
await tryCase("walk: far away, or on another floor, they are there at once", async () => {
  snap = SNAP({ pixel: { x_m: 25, y_m: 8 } });
  poll(); await settle(4);
  const far = item("person.garry");
  snap = SNAP({ pixel: { x_m: 25, y_m: 8, floor_id: "upper" } });
  poll(); await settle(4);
  const up = item("person.garry");
  check("walk: far away, or on another floor, they are there at once",
    !far.walking && far.at[0] === 25 && !up.walking && up.floor === "upper" && up.at[1] > 2 && st().liveMs === 0, { far, up });
  snap = SNAP();
  poll(); await settle(4);
});
await tryCase("reads: through the host no more often than it says; off, what was drawn goes", async () => {
  people = { read: async () => { fetches++; return snap; }, everyMs: 8000 };
  poll(); await settle(6);
  const first = { fetches, drawn: st().tracked.length };
  for (let i = 0; i < 3; i++) { await later(2500, 6); poll(); await settle(4); }   // 7.5 s of polls
  const within = fetches;
  await later(1000, 6); poll(); await settle(4);                                  // past 8 s
  const after = fetches;
  people = null;
  poll(); await settle(4);
  const off = st().tracked.map(x => x.key);
  check("reads: through the host no more often than it says; off, what was drawn goes",
    first.fetches === 1 && first.drawn === 4 && within === 1 && after === 2 && off.length === 1 && off[0].startsWith("scanner:"),
    { first, within, after, off });
});
LA.releaseLiveAboardSlot("tracked");
await settle();

console.log(JSON.stringify({ cases, failures }));
