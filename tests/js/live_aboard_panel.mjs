// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
//
// Live Aboard on the wall panel, and the people in it
// (views/live_aboard_panel.js, live_aboard_tracked.js, atlas_aboard.js,
// live_aboard_people.js), run for real inside the real 3D view under the DOM
// shim with a stub GL, on a house shaped like Garry's (a basement of five
// rooms under a main floor of eleven, five rooms upstairs over part of it):
//
//   homefloor  with no home set, the floor with the most rooms of its own:
//              the main floor here, never All
//   home       the sidebar opens on it; Views ▾ → Set as home keeps the
//              camera and floor in this browser, and a new view opens there
//   idle       untouched for the setting's time (60 s), it flies back home,
//              closing the menu and a card; touched, the wait starts again;
//              off (0), never
//   hold       never while Edit or Furnish is open, a card or sheet the Atlas
//              opened is up, or full screen was asked for by hand; it goes
//              once they are gone
//   carries    what is picked for a person places them, whatever the names
//              say; a thing picked for two stays with the first, and the
//              other is told (the People & devices screen too, which saves
//              it at once in the settings)
//   roomonly   someone known only by their room stands in its middle,
//              nudged apart from another there, dimmed, "room only" on their
//              card, in Live Aboard and on the flat map alike
//   pinned     a tag pinned on the map stands at its pin whatever it reads
//   switches   Show people and Show tags & scanners in Views ▾: an admin's
//              tap saves the setting; anyone else sees it on or off
//   follow     Follow keeps the camera on someone as they walk, on the
//              capped clock; a touch lets go
//   chip       "4 home", each tap the next person, their floor at the top
//   rest       nothing moving: no frames, no timer
//
// usage: live_aboard_panel.mjs <www/padspan-ha dir>
// prints one JSON line: { cases: {name: result}, failures: [...] }

import { pathToFileURL } from "node:url";
import { join } from "node:path";
import * as shim from "./dom_shim.mjs";
import { installStubGL } from "./stub_gl.mjs";

const WWW = process.argv[2];
if (!WWW) { console.error("usage: live_aboard_panel.mjs <www/padspan-ha dir>"); process.exit(2); }
shim.install();
{
  const NP = globalThis.Node.prototype, ap = NP.appendChild, ib = NP.insertBefore, rc = NP.removeChild;
  const leave = (c) => { const p = c && c.parentNode; if (p && p.children) { const i = p.children.indexOf(c); if (i >= 0) p.children.splice(i, 1); } };
  NP.appendChild = function(c){ leave(c); return ap.call(this, c); };
  NP.insertBefore = function(c, ref){ leave(c); return ib.call(this, c, ref); };
  NP.removeChild = function(c){ const r = rc.call(this, c); if (c && c.parentNode === this) c.parentNode = null; return r; };
}
const lists = { window: {}, document: {} };
const listen = (key) => ({
  add: (t, fn) => { (lists[key][t] ||= []).push(fn); },
  remove: (t, fn) => { lists[key][t] = (lists[key][t] || []).filter(f => f !== fn); },
});
const W = listen("window"), Dc = listen("document");
globalThis.addEventListener = W.add; globalThis.removeEventListener = W.remove;
document.addEventListener = Dc.add; document.removeEventListener = Dc.remove;
const fire = (key, type, e) => { for (const fn of [...(lists[key][type] || [])]) fn({ type, ...e }); };
installStubGL();

let clockOff = 0;
const clock0 = performance.now(), date0 = Date.now();
performance.now = () => clock0 + clockOff;
Date.now = () => date0 + clockOff;
const shimRaf = globalThis.requestAnimationFrame;
globalThis.requestAnimationFrame = (fn) => shimRaf(() => fn(performance.now()));
const pendingFrames = () => shim.rafQueue.filter(Boolean).length;

const url = (p) => pathToFileURL(join(WWW, p)).href;
const LA = await import(url("views/live_aboard.js"));
const PANEL = await import(url("views/live_aboard_panel.js"));
const TR = await import(url("views/live_aboard_tracked.js"));
const AB = await import(url("views/atlas_aboard.js"));
const ISO = await import(url("views/iso_lights.js"));
const PEOPLE = await import(url("views/live_aboard_people.js"));

const failures = [];
const cases = {};
const check = (name, ok, detail) => { cases[name] = !!ok; if (!ok) failures.push({ name, detail: detail === undefined ? null : detail }); };
const tryCase = async (name, fn) => {
  try { await fn(); } catch (e) { failures.push({ name, detail: String(e && e.stack || e).slice(0, 900) }); cases[name] = false; }
};
const settle = async (rounds = 14) => { await shim.flush(rounds); await new Promise(r => globalThis._realSetTimeout(r, 0)); };
async function later(ms, rounds = 8){ clockOff += ms; await settle(rounds); }
const near = (a, b, e = 1e-3) => Array.isArray(a) ? a.every((v, i) => Math.abs(v - b[i]) < e) : Math.abs(a - b) < e;

// ── the house: like Garry's, by its numbers (no names of his) ────────────────
const rect = (floor_id, x0, y0, x1, y1) => ({ type: "poly", floor_id, points_m: [[x0, y0], [x1, y0], [x1, y1], [x0, y1]] });
const ROOMS = {};
// The main floor: eleven rooms across 22 × 10 m (the Den at its east end).
const MAIN = [[0, 0, 5.5, 5], [5.5, 0, 11, 5], [11, 0, 16.5, 5], [0, 5, 5.5, 10], [5.5, 5, 11, 10], [11, 5, 16.5, 10],
              [16.5, 0, 19, 5], [19, 0, 22, 5], [16.5, 5, 19, 10], [19, 5, 22, 7.5], [19, 7.5, 22, 10]];
MAIN.forEach((r, i) => { ROOMS[i === 10 ? "Den" : i === 0 ? "Kitchen" : `Main ${i + 1}`] = rect("main", ...r); });
// Upstairs: five rooms over the west half; the basement: five under it all.
[[0, 0, 5.5, 5], [5.5, 0, 11, 5], [0, 5, 4, 10], [4, 5, 8, 10], [8, 5, 11, 10]].forEach((r, i) => { ROOMS[`Up ${i + 1}`] = rect("upper", ...r); });
[[0, 0, 5, 10], [5, 0, 10, 10], [10, 0, 15, 10], [15, 0, 19, 10], [19, 0, 22, 10]].forEach((r, i) => { ROOMS[`Low ${i + 1}`] = rect("basement", ...r); });
const MODEL = {
  floors: [{ id: "basement", name: "Basement", level: 0, floor_to_floor_m: 3 }, { id: "main", name: "Main", level: 1, floor_to_floor_m: 2.3 },
           { id: "upper", name: "Upper", level: 2 }],
  room_geometry_m: ROOMS, rf_barriers_m: [], light_positions_m: {}, scanner_positions_m: {}, scanners: {},
  // A tag pinned on the map (fabric_beacon_position_set): the fridge's.
  beacon_positions_m: { "ble:fridge": { x_m: 2, y_m: 2, floor_id: "main", room: "Kitchen", kind: "ble", label: "Fridge tag" } },
};
const STATES = {
  "person.alice": { state: "home", last_changed: new Date(date0 - 3600e3).toISOString(), attributes: { friendly_name: "Alice", device_trackers: ["device_tracker.alice_phone"] } },
  "person.bob": { state: "home", attributes: { friendly_name: "Bob", device_trackers: ["device_tracker.bob"] } },
  "person.cara": { state: "home", attributes: { friendly_name: "Cara", device_trackers: ["device_tracker.cara"] } },
  "person.dan": { state: "home", attributes: { friendly_name: "Dan", device_trackers: [] } },
  "person.eve": { state: "home", attributes: { friendly_name: "Eve", device_trackers: [] } },
};
const OBJ = (key, kind, x, y, floor_id, more = {}) => ({ key, kind, x_m: x, y_m: y, floor_id, ...more });
const SNAP = (over = {}) => ({ objects: { list: [
  OBJ("irk:alice", "private_ble", 3, 2, "main", { private_ble_name: "Alice's phone", linked_entities: ["device_tracker.alice_phone"], room: "Kitchen", age_s: 2, ...(over.alice || {}) }),
  OBJ("entity:device_tracker.bob", "entity", null, null, null, { name: "Bob's phone", room: "Den", linked_entities: ["device_tracker.bob"], identified: true }),
  OBJ("entity:device_tracker.cara", "entity", null, null, null, { name: "Cara's phone", room: "Den", linked_entities: ["device_tracker.cara"], identified: true }),
  OBJ("ble:keys", "ble", 4, 4, "upper", { user_label: "Keys", room: "Up 1", age_s: 5 }),
  OBJ("ble:fridge", "ble", 5, 5, "main", { user_label: "Fridge tag", room: "Kitchen", age_s: 1, knn_confidence: 0.2, ...(over.fridge || {}) }),
  OBJ("ble:watch", "ble", 8, 2, "main", { user_label: "Watch", room: "Main 2", age_s: 9 }),
  OBJ("ble:plug", "ble", 9, 9, "main", {}),
] } });
const CARRIES = { "person.dan": ["ble:keys"], "person.eve": ["ble:keys"] };

// ── the host: the sidebar's, its floor chips, its settings ──────────────────
const IDS = ["basement", "main", "upper"], NAMES = ["Basement", "Main", "Upper"];
const H = { top: null, calls: [], saved: [], snap: SNAP(), settings: null, admin: true, furnish: null, edit: null };
const store = new Map();
const prefs = { get: (k) => store.get(k) ?? null, set: (k, v) => store.set(k, String(v)) };
const host = document.createElement("padspan-lights-app");
const shadow = document.createElement("#shadow-root");
shadow.host = host;
document.body.appendChild(host);
host.appendChild(shadow);
const steps = () => ({ names: NAMES, zs: ["0", "1", "2"], at: H.top === null ? 2 : IDS.indexOf(H.top), all: H.top === null,
  go: (i) => { H.calls.push(["go", i]); H.top = i < 0 ? null : IDS[i]; poll(); } });
const P = () => ({ model: MODEL, floors: MODEL.floors, lightsByEid: {}, hidden: new Set(), topFloorIds: H.top === null ? null : [H.top], quality: "low",
  telemetry: () => {}, onTouch: () => {}, states: STATES, config: {}, bearing: 0, saveNorth: null, useApi: () => null,
  haStartedMs: 0, load: async () => ({ data: { schema: 1, pieces: {}, lights: {}, openings: {}, devices: {}, figures: {} } }),
  edit: H.edit, furnish: H.furnish, mapOnly: true, floorSteps: steps(), prefs,
  setTopFloor: (fid) => { H.calls.push(["top", fid]); H.top = fid; poll(); },
  people: { snapshot: () => H.snap }, tags: { snapshot: () => H.snap },
  settings3d: H.settings, admin: H.admin, saveSetting: async (k, v) => { H.saved.push([k, v]); return true; } });
let slot = null;
function poll(){
  const c = document.createElement("div"), stage = document.createElement("div");
  c.appendChild(stage);
  const content = shadow.children.find(n => n.className === "content") || shadow.appendChild(Object.assign(document.createElement("div"), { className: "content" }));
  content.replaceChildren(c);
  return slot.attach(stage, P());
}
function inTree(n, top){ for (let x = n; x; x = x.parentNode) if (x === top) return true; return false; }
async function open(key){
  slot = LA.liveAboardSlot(key);
  poll();
  const el = slot.element;
  if (el && !el.getRootNode) el.getRootNode = () => (inTree(el, shadow) ? shadow : el);
  poll();
  await settle(30);
  return slot;
}
const S = () => slot._state();
const btnByText = (t) => slot.element.querySelectorAll("button").find(b => b.textContent === t) || null;
const click = (b) => b && b.dispatchEvent({ type: "click", detail: 1, stopPropagation() {}, preventDefault() {} });
const touch = () => slot.element.dispatchEvent({ type: "pointerdown", stopPropagation() {}, preventDefault() {} });
const item = (k) => S().tracked.find(x => x.key === k) || null;
async function wheel(n){
  const cv = slot.element.querySelector("canvas");
  touch();
  for (let i = 0; i < Math.abs(n); i++) cv.dispatchEvent({ type: "wheel", clientX: 400, clientY: 300, deltaY: n > 0 ? -160 : 160, deltaMode: 0, stopPropagation() {}, preventDefault() {} });
  await settle();
}
const SET = (over = {}) => ({ atlas_3d_enabled: true, atlas_3d_people: true, atlas_3d_tags: true, atlas_3d_home_idle_s: 60, atlas_3d_carries: CARRIES, ...over });

// ── the floor with the most rooms ───────────────────────────────────────────
await tryCase("homefloor: the floor with the most rooms of its own, not All; a tie goes to the one that shows more", async () => {
  const fl = (id, elev) => ({ id, elev, outdoor: false });
  const F = { basement: fl("basement", 0), main: fl("main", 3), upper: fl("upper", 5.3) };
  const rooms = Object.values(ROOMS).map(g => ({ floor: F[g.floor_id], pts: g.points_m }));
  const got = PANEL.homeFloorOf(rooms);
  // A tie: two floors of two rooms; the upper one covers only half the lower.
  const tie = PANEL.homeFloorOf([{ floor: fl("a", 0), pts: rect("a", 0, 0, 4, 4).points_m }, { floor: fl("a", 0), pts: rect("a", 4, 0, 8, 4).points_m },
                                 { floor: fl("b", 3), pts: rect("b", 0, 0, 2, 4).points_m }, { floor: fl("b", 3), pts: rect("b", 2, 0, 4, 4).points_m }]);
  const outdoorOnly = PANEL.homeFloorOf([{ floor: { id: "out", elev: 0, outdoor: true }, pts: rect("out", 0, 0, 4, 4).points_m }]);
  check("homefloor: the floor with the most rooms of its own, not All; a tie goes to the one that shows more",
    got && got.id === "main" && got.own === 11 && tie && tie.id === "b" && tie.shows === 3 && outdoorOnly === null, { got, tie });
});

// ── home: the sidebar opens on it; Set as home keeps it ─────────────────────
await tryCase("home: the sidebar opens on the home floor (main), the whole house, without being touched", async () => {
  H.settings = SET(); H.top = null; H.calls.length = 0;
  await open("panel-home");
  const s = S();
  check("home: the sidebar opens on the home floor (main), the whole house, without being touched",
    H.top === "main" && H.calls.some(c => c[0] === "top" && c[1] === "main") && s.panel && s.panel.atHome && !s.panel.armed
    && s.screen.fitR > 0 && near(s.cam.radius, s.screen.fitR, 1e-6) && !s.cam.moved, { calls: H.calls, panel: s.panel, cam: s.cam, fitR: s.screen.fitR });
});
await tryCase("home: Views ▾ → Set as home keeps the camera and floor in this browser; a new view opens there", async () => {
  await wheel(3);
  H.calls.length = 0;
  steps().go(2);                                              // the floor chips: Upper on top
  await settle();
  const cam = { ...S().cam };
  click(btnByText("Views ▾"));
  const items = slot.element.querySelector(".la3d-menu").querySelectorAll("button").map(b => b.textContent);
  click(btnByText("Set as home"));
  const saved = JSON.parse(store.get("home_panel-home") || "null");
  const after = S().panel;
  LA.releaseLiveAboardSlot("panel-home");
  H.top = null;
  await open("panel-home");
  const again = S();
  check("home: Views ▾ → Set as home keeps the camera and floor in this browser; a new view opens there",
    items.includes("Home view") && items.includes("Set as home") && saved && saved.floor === "upper" && near(saved.radius, cam.radius)
    && near(saved.target, cam.target) && after.atHome && H.top === "upper" && near(again.cam.radius, cam.radius) && near(again.cam.theta, cam.theta)
    && near(again.cam.target, cam.target), { items, saved, cam, again: again.cam, top: H.top });
  // Forgotten with ×: the default home again.
  click(btnByText("Views ▾"));
  const x = slot.element.querySelector(".la3d-menu").querySelectorAll("button").find(b => b.title === 'Forget "Home view"');
  click(x);
  check("home: × beside Home view forgets it: back to the floor with the most rooms", x && JSON.parse(store.get("home_panel-home")) === null, null);
});

// ── idle: back home by itself ───────────────────────────────────────────────
await tryCase("idle: untouched for a minute it flies home, closing the menu and a card; touched, the wait starts again", async () => {
  await later(2000);
  click(btnByText("Views ▾"));
  click(btnByText("Home view"));
  await later(1000, 40);
  const home = { ...S().cam, top: H.top };
  await wheel(4);                                             // someone zooms in
  const moved = { ...S().cam };
  await later(40000);
  touch();                                                    // ...and touches it again 40 s later
  await later(40000);
  const notYet = { returns: S().panel.returns, armed: S().panel.armed };
  click(btnByText("Views ▾"));                                // a menu left open
  slot._panel().nextPerson();                                 // and a person's card
  const open1 = { menu: S().screen.menu, card: !!(S().use && S().use.card) };
  H.calls.length = 0;
  await later(61000, 20);
  await later(1000, 60);                                      // the flight
  const back = S();
  check("idle: untouched for a minute it flies home, closing the menu and a card; touched, the wait starts again",
    home.top === "main" && moved.radius < home.radius && notYet.returns === 0 && notYet.armed && open1.card
    && back.panel.returns === 1 && back.panel.atHome && !back.panel.armed && near(back.cam.radius, home.radius, 1e-3)
    && near(back.cam.target, home.target, 1e-3) && H.top === "main" && !back.screen.menu && !(back.use && back.use.card) && !back.screen.flying,
    { home, moved: moved.radius, notYet, open1, back: { panel: back.panel, cam: back.cam, use: back.use, menu: back.screen.menu }, calls: H.calls });
});
await tryCase("idle: Off (0) never goes back; 5 min waits five minutes", async () => {
  H.settings = SET({ atlas_3d_home_idle_s: 0 }); poll();
  await wheel(3);
  await later(400000);
  const off = S().panel;
  H.settings = SET({ atlas_3d_home_idle_s: 300 }); poll();
  touch();
  await later(120000);
  const two = S().panel.returns;
  await later(181000); await later(1000, 60);
  const five = S().panel;
  H.settings = SET(); poll();
  check("idle: Off (0) never goes back; 5 min waits five minutes",
    off.returns === 1 && !off.armed && off.idleMs === 0 && two === 1 && five.returns === 2 && five.atHome, { off, two, five });
});

// ── hold: never while someone is busy with it ───────────────────────────────
async function heldBy(name, on, off){
  await wheel(3);
  const r0 = S().panel.returns;
  on();
  await later(70000);
  const held = S().panel.returns === r0 && !S().panel.atHome;
  off();
  await later(11000, 20); await later(1000, 60);
  const went = S().panel.returns === r0 + 1 && S().panel.atHome;
  return { name, held, went };
}
await tryCase("hold: never while Edit, Furnish, a card the Atlas opened or full screen by hand; once they are gone, it goes", async () => {
  const out = [];
  // A card or sheet the Atlas opened (they cover the page).
  const sheet = document.createElement("div");
  sheet.style.position = "fixed"; sheet.style.inset = "0";
  out.push(await heldBy("card", () => document.body.appendChild(sheet), () => sheet.remove()));
  // Furnish (Mapping → Furnish is open on this screen).
  out.push(await heldBy("furnish", () => { H.furnish = { callWS: async () => ({}), toast: () => {}, settings: H.settings, entities: {} }; poll(); },
                        () => { H.furnish = null; poll(); }));
  // Edit.
  H.edit = async () => ({ data: {} }); poll(); await settle();
  out.push(await heldBy("edit", () => { click(btnByText("Edit")); }, () => { click(btnByText("Done")); }));
  H.edit = null; poll();
  // Full screen, asked for by hand (the corners button).
  host.requestFullscreen = function(){ document.fullscreenElement = this; fire("document", "fullscreenchange", {}); return Promise.resolve(); };
  document.exitFullscreen = () => { document.fullscreenElement = null; fire("document", "fullscreenchange", {}); return Promise.resolve(); };
  document.fullscreenEnabled = true;
  poll();
  out.push(await heldBy("full", () => click(slot.element.querySelectorAll("button").find(b => b.getAttribute("aria-label") === "Full screen")),
                        () => { document.fullscreenElement = null; fire("document", "fullscreenchange", {}); }));
  delete host.requestFullscreen; delete document.exitFullscreen;
  check("hold: never while Edit, Furnish, a card the Atlas opened or full screen by hand; once they are gone, it goes",
    out.length === 4 && out.every(o => o.held && o.went), out);
});

// ── who carries what ────────────────────────────────────────────────────────
await tryCase("carries: picked, it places them whatever the names say; picked for two, the first keeps it and the other is told", async () => {
  const t = TR.trackedOf(SNAP());
  const none = Object.fromEntries(TR.peopleOf(STATES, t).map(p => [p.eid, p.at && p.at.key]));
  const P1 = TR.peopleOf(STATES, t, CARRIES), by = Object.fromEntries(P1.map(p => [p.eid, p]));
  // Picked over the matching: Alice's watch, not the phone behind her person.
  const P2 = Object.fromEntries(TR.peopleOf(STATES, t, { "person.alice": ["ble:watch"] }).map(p => [p.eid, p.at && p.at.key]));
  // Someone on the same tracker as one before is that same person (ws_occupancy's rule).
  const twin = TR.peopleOf({ ...STATES, "person.alice2": { state: "home", attributes: { friendly_name: "Alice's other", device_trackers: ["device_tracker.alice_phone"] } } }, t);
  check("carries: picked, it places them whatever the names say; picked for two, the first keeps it and the other is told",
    none["person.dan"] === null && none["person.alice"] === "irk:alice" && by["person.dan"].at.key === "ble:keys" && by["person.eve"].at === null
    && JSON.stringify(by["person.eve"].lost) === JSON.stringify([{ key: "ble:keys", keptBy: "person.dan" }]) && by["person.dan"].lost.length === 0
    && P2["person.alice"] === "ble:watch" && twin.find(p => p.eid === "person.alice2").at === null
    && TR.carriesOf({ "person.x": ["a", "a", 3], "light.y": ["b"], "person.z": [] })["person.x"].join() === "a"
    && Object.keys(TR.carriesOf({ "person.x": ["a"], "light.y": ["b"], "person.z": [] })).join() === "person.x",
    { none, by, P2 });
});
await tryCase("carries: People & devices picks from what PadSpan tracks, saves at once to the settings, and says who keeps a shared one", async () => {
  const sent = [], settings = { atlas_3d_carries: { ...CARRIES } };
  const callWS = async (m) => {
    if (m.type === "padspan_ha/live_snapshot") return { snapshot: SNAP() };
    if (m.type === "padspan_ha/model_get") return MODEL;
    if (m.type === "padspan_ha/house3d_get") return { data: { figures: {}, devices: {} }, writable: true };
    if (m.type === "padspan_ha/settings_set") { sent.push(m); return { settings: { atlas_3d_carries: m.atlas_3d_carries } }; }
    return { ready: false };
  };
  const m = PEOPLE.peopleMachine({ F: {}, callWS, hass: { states: STATES }, settings });
  await m.load(); await m.loadDevices();
  const things = m.things.map(x => x.id);
  const lost = m.lostOf("person.eve");
  m.editCarries("person.eve", "Eve");
  const picked = m.choices().map(x => x.id)[0];
  m.toggleCarry("ble:keys"); m.toggleCarry("ble:watch");
  m.setFilter("wat");
  const filtered = m.choices().map(x => x.id);
  const ok = await m.keepCarries();
  check("carries: People & devices picks from what PadSpan tracks, saves at once to the settings, and says who keeps a shared one",
    things.includes("ble:keys") && things.includes("entity:device_tracker.bob") && !things.includes("ble:plug")
    && lost.length === 1 && lost[0].name === "Dan" && lost[0].label === "Keys" && picked === "ble:keys"
    && JSON.stringify(filtered) === JSON.stringify(["ble:watch"]) && ok && sent.length === 1 && Object.keys(sent[0]).sort().join() === "atlas_3d_carries,type"
    && JSON.stringify(sent[0].atlas_3d_carries) === JSON.stringify({ "person.dan": ["ble:keys"], "person.eve": ["ble:watch"] })
    && settings.atlas_3d_carries["person.eve"][0] === "ble:watch" && m.lostOf("person.eve").length === 0 && m.step === "list",
    { things, lost, picked, filtered, sent, settings });
});

// ── people known only by their room, in both views ──────────────────────────
const FRAME = () => ISO.fabricFrame(MODEL, MODEL.floors, 150, 0);
function flat(slotKey, over = {}){
  const L = AB.liveLayer(slotKey), svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  L.draw({ stage: { querySelector: () => svg }, frame: FRAME(), frameKey: "150|0", model: MODEL, states: STATES, file: null, people: true, tags: true,
           hideNames: false, focused: () => true, outdoor: ISO.isOutdoorFloorId, home: () => document.body, carries: CARRIES, ...over }, H.snap);
  return L;
}
await tryCase("roomonly: in their room's middle, nudged apart from another there, dimmed, 'room only' on their card, in both views", async () => {
  H.snap = SNAP(); poll(); await settle();
  const want = TR.wantedOf({ model: MODEL, snapshot: H.snap, states: STATES, people: true, tags: true, carries: CARRIES });
  const w = Object.fromEntries(want.map(x => [x.key, x]));
  const bob = item("person.bob"), cara = item("person.cara"), alice = item("person.alice");
  const L = flat("panel-flat"), fs = Object.fromEntries(L.state().map(x => [x.key, x])), fr = FRAME();
  const iso = (k) => fr.iso(w[k].x, w[k].y, fr.levelOf(w[k].floor_id)).map(v => Number(v.toFixed(1)));
  const atOf = (k) => (fs[k] && fs[k].at ? fs[k].at.map(v => Number(v.toFixed(1))) : null);
  check("roomonly: in their room's middle, nudged apart from another there, dimmed, 'room only' on their card, in both views",
    w["person.bob"] && near([w["person.bob"].x, w["person.bob"].y], [20.5, 8.75]) && w["person.bob"].floor_id === "main" && w["person.bob"].dim
    && w["person.cara"].dim && near(Math.hypot(w["person.cara"].x - 20.5, w["person.cara"].y - 8.75), 0.6)
    && !w["person.alice"].dim && w["person.dan"] && !w["person.eve"]
    && bob && bob.dim && near(bob.opacity, TR.ROOM_ONLY_OPACITY) && near([bob.at[0], bob.at[2]], [20.5, 8.75]) && cara && cara.dim && !alice.dim && alice.opacity === 1
    && bob.card.lines.includes(TR.ROOM_ONLY_WORDS) && bob.card.lines[0] === "In Den" && !alice.card.lines.includes(TR.ROOM_ONLY_WORDS)
    && fs["person.bob"].dim && Number(fs["person.bob"].opacity) < 1 && fs["person.bob"].card.lines.includes(TR.ROOM_ONLY_WORDS) && !fs["person.alice"].dim
    && JSON.stringify(atOf("person.bob")) === JSON.stringify(iso("person.bob")) && JSON.stringify(atOf("person.cara")) === JSON.stringify(iso("person.cara"))
    && JSON.stringify(atOf("person.dan")) === JSON.stringify(iso("person.dan")),
    { want: want.filter(x => x.kind === "person").map(x => [x.key, x.x, x.y, x.floor_id, x.dim]), bob, cara, flat: L.state().filter(x => x.kind === "person") });
});

// ── a pinned tag stays put ──────────────────────────────────────────────────
await tryCase("pinned: a tag pinned on the map stands at its pin, reading after reading, in both views", async () => {
  H.snap = SNAP(); poll(); await settle();
  const a = item("beacon:ble:fridge");
  H.snap = SNAP({ fridge: { x_m: 7, y_m: 1, knn_confidence: 0.1 } }); poll(); await settle();
  const b = item("beacon:ble:fridge"), f0 = S().frames;
  await later(3000);
  const L = flat("panel-pin"), fl = L.state().find(x => x.key === "beacon:ble:fridge"), fr = FRAME();
  check("pinned: a tag pinned on the map stands at its pin, reading after reading, in both views",
    a && a.pinned && near([a.at[0], a.at[2]], [2, 2]) && !a.walking && b && near([b.at[0], b.at[2]], [2, 2]) && !b.walking && S().frames === f0
    && near(a.halo, TR.HALO_M[0]) && b.card.lines.includes("Pinned on the map: it stands at its pin") && b.card.lines.some(l => /reads it 5\.1 m from its pin/.test(l))
    && fl && JSON.stringify(fl.at.map(v => Number(v.toFixed(1)))) === JSON.stringify(fr.iso(2, 2, fr.levelOf("main")).map(v => Number(v.toFixed(1))))
    && item("beacon:ble:watch") && near([item("beacon:ble:watch").at[0], item("beacon:ble:watch").at[2]], [8, 2]), { a, b, fl });
});

// ── the switches in Views ▾ ─────────────────────────────────────────────────
await tryCase("switches: Show people and Show tags & scanners in Views ▾, saved by an admin, shown on or off to anyone else", async () => {
  H.settings = SET({ atlas_3d_tags: false }); H.admin = true; H.saved.length = 0; poll();
  click(btnByText("Views ▾"));
  const people = btnByText("Show people: On"), tags = btnByText("Show tags & scanners: Off");
  const admin = { people: !!people && people.getAttribute("aria-checked") === "true" && !people.disabled, tags: !!tags && tags.getAttribute("aria-checked") === "false" };
  click(tags);
  await settle();
  const saved = H.saved.slice();
  H.admin = false; H.saved.length = 0; poll();
  click(btnByText("Views ▾"));
  const ro = btnByText("Show people: On");
  if (ro && !ro.disabled) click(ro);
  await settle();
  H.admin = true; H.settings = SET(); poll();
  check("switches: Show people and Show tags & scanners in Views ▾, saved by an admin, shown on or off to anyone else",
    admin.people && admin.tags && JSON.stringify(saved) === JSON.stringify([["atlas_3d_tags", true]]) && ro && ro.disabled && H.saved.length === 0,
    { admin, saved, ro: ro && ro.disabled, after: H.saved });
});

// ── the People chip ─────────────────────────────────────────────────────────
await tryCase("chip: '4 home' by the Motion chip; each tap the next person, their floor at the top", async () => {
  H.top = "basement"; poll(); await settle();
  const chip = slot.element.querySelector("[data-la3d-people]"), row = chip && chip.parentNode;
  const text = S().panel.chip.text;
  // In turn by name, from whoever was gone to last (the idle case went to one).
  const ORDER = ["person.alice", "person.bob", "person.cara", "person.dan"], from = ORDER.indexOf(S().panel.visited);
  const want = [1, 2, 3, 4, 5].map(i => ORDER[(from + i) % 4]);
  const seen = [];
  for (let i = 0; i < 5; i++) {
    H.calls.length = 0;
    click(chip.querySelectorAll("button")[0]);
    await later(1000, 40);
    seen.push([S().panel.visited, H.top, H.calls.filter(c => c[0] === "top").map(c => c[1]).join(), !!(S().use && S().use.card)]);
  }
  check("chip: '4 home' by the Motion chip; each tap the next person, their floor at the top",
    text === "People:4 home" && row && row.className === "la3d-chiprow" && row.querySelector("[data-la3d-motion]")
    && JSON.stringify(seen.map(s => s[0])) === JSON.stringify(want)
    && JSON.stringify(seen.map(s => s[1])) === JSON.stringify(want.map(k => (k === "person.dan" ? "upper" : "main")))
    && seen[0][2] === "main" && seen.every((s, i) => s[2] === (i && seen[i - 1][1] === s[1] ? "" : s[1])) && seen.every(s => s[3]), { text, want, seen });
});

// ── follow ──────────────────────────────────────────────────────────────────
await tryCase("follow: the camera keeps someone in the middle as they walk, on the capped clock; a touch lets go", async () => {
  H.top = "main"; H.snap = SNAP(); poll(); await settle();
  touch();
  const T = slot._panel().cardOf("person.alice", { title: "Alice", lines: [] });
  T.buttons[0].act();
  await later(1000, 40);                                       // the flight to her room
  for (let i = 0; i < 40; i++) await later(100, 3);            // the glide
  const there = { target: S().cam.target, follow: S().panel.follow, chip: S().panel.chip.text };
  H.snap = SNAP({ alice: { x_m: 6, y_m: 2 } }); poll(); await settle(4);   // she walks three metres east
  const f0 = S().frames, rate = S().liveMs;
  for (let i = 0; i < 60; i++) await later(100, 3);
  const walked = { target: S().cam.target, frames: S().frames - f0, gliding: S().panel.gliding };
  const f1 = S().frames;
  await later(20000, 12);
  const still = S().frames - f1;
  touch();
  const off = S().panel;
  check("follow: the camera keeps someone in the middle as they walk, on the capped clock; a touch lets go",
    there.follow && there.follow.key === "person.alice" && near(there.target, [3, 3 + 0.8, 2], 0.05) && there.chip === "Following AliceStop"
    && rate === TR.WALK_MS.low && near(walked.target, [6, 3 + 0.8, 2], 0.05) && walked.frames >= 20 && walked.frames <= 70 && !walked.gliding
    && still === 0 && !off.follow && off.chip.text === "People:4 home",
    { there, rate, walked, still, off: off.follow, chip: off.chip });
});

// ── rest ────────────────────────────────────────────────────────────────────
await tryCase("rest: at home and nothing moving, no frames and no timer", async () => {
  slot._panel().goHome();
  await later(1000, 60);
  const f0 = S().frames;
  await later(120000, 30);
  const s = S();
  check("rest: at home and nothing moving, no frames and no timer",
    s.frames === f0 && s.liveMs === 0 && !s.panel.armed && s.panel.atHome && pendingFrames() === 0, { frames: s.frames - f0, liveMs: s.liveMs, panel: s.panel });
});

LA.releaseLiveAboardSlot("panel-home");
console.log(JSON.stringify({ cases, failures }));
