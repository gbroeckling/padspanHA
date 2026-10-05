// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
//
// The flat Atlas gets what Live Aboard has (2026-10-05), run for real under
// the DOM shim with every module load recorded:
//
//   byte    buildIsoSVG's output is byte for byte what it was with the new
//           options off — no underlay, the sidebar's screen, people and tags
//           on (they lie over the drawing, never in it), Live Aboard on with
//           a file that sets no kind and Show furniture off — on a realistic
//           house, and on Garry's own when its export is on this PC
//   off     with Show people, Show tags & scanners and Live Aboard off (or
//           below Pro): atlas_aboard.js is never fetched and nothing is read
//   alone   the map alone on the flat map: zoomed in past the whole house the
//           bars step aside (the stage covers the panel), ☰ / Escape / zooming
//           back out bring them back, a new card keeps it; ⛶ full screen and
//           its way out; a screen that may not: the map alone; never while
//           Live Aboard shows; the emergency dial and the Vacation banner stay
//           above the cover
//   tap     a double-tap on a room's empty floor zooms there; on a marker, a
//           slow or a moved tap, a pinch: nothing; a double-tap on a light
//           switches it once
//   live    tags (name, a ring as wide as it is unsure), scanners and people
//           (initial, figure's top colour or neutral, a smooth move or a jump)
//           from the snapshot; Live Aboard's own card for a tag or a scanner;
//           a person's card; one read for both views, none while off
//   kinds   a Live Aboard kind draws as its Atlas shape; an Atlas shape the
//           person set wins; sensors keep theirs
//   furn    Show furniture draws footprints and door/window marks, none off
//
// usage: atlas_gets_la.mjs <www/padspan-ha dir> [house_export.json]
// prints one JSON line: { cases: {name: result}, failures: [...] }

import * as nodeModule from "node:module";
import { pathToFileURL } from "node:url";
import { join } from "node:path";
import { readFileSync, existsSync } from "node:fs";
import { install } from "./dom_shim.mjs";

const WWW = process.argv[2], HOUSE = process.argv[3] && existsSync(process.argv[3]) ? process.argv[3] : null;
if (!WWW) { console.error("usage: atlas_gets_la.mjs <www/padspan-ha dir> [house_export.json]"); process.exit(2); }
const loaded = [];
if (typeof nodeModule.registerHooks !== "function") {
  console.log(JSON.stringify({ cases: {}, failures: [{ name: "harness", detail: `node ${process.version} has no module.registerHooks` }] }));
  process.exit(1);
}
nodeModule.registerHooks({ load(url, context, nextLoad) { loaded.push(url); return nextLoad(url, context); } });
install(globalThis);
globalThis.sessionStorage = { _d: {}, getItem(k) { return this._d[k] ?? null; }, setItem(k, v) { this._d[k] = String(v); }, removeItem(k) { delete this._d[k]; } };
// Window listeners, kept so a test can fire them (Escape, resize).
const winL = {};
const realAdd = globalThis.addEventListener, realRemove = globalThis.removeEventListener;
globalThis.addEventListener = function(t, f, o){ (winL[t] ||= new Set()).add(f); return realAdd && realAdd.call(this, t, f, o); };
globalThis.removeEventListener = function(t, f, o){ if (winL[t]) winL[t].delete(f); return realRemove && realRemove.call(this, t, f, o); };
const docL = {};
document.addEventListener = (t, f) => { (docL[t] ||= new Set()).add(f); };
document.removeEventListener = (t, f) => { if (docL[t]) docL[t].delete(f); };
const fireWin = (t, e) => { for (const f of [...(winL[t] || [])]) f({ type: t, ...e }); };
const fireDoc = (t) => { for (const f of [...(docL[t] || [])]) f({ type: t }); };

const url = (p) => pathToFileURL(join(WWW, p)).href;
const LM = await import(url("views/lights_map.js"));
const SCREEN = await import(url("views/atlas_screen.js"));
const ISO = await import(url("views/iso_lights.js"));
const abLoaded = () => loaded.some(u => /\/views\/atlas_aboard\.js/.test(u));
const laLoaded = () => loaded.some(u => /\/views\/live_aboard\.js|\/vendor\/three\//.test(u));

const failures = [], cases = {};
const check = (name, ok, detail) => { cases[name] = !!ok; if (!ok) failures.push({ name, detail: detail === undefined ? null : detail }); };
const tryCase = async (name, fn) => { try { await fn(); } catch (e) { failures.push({ name, detail: String(e && e.stack || e).slice(0, 900) }); cases[name] = false; } };
const sleep = (ms) => new Promise(r => globalThis._realSetTimeout(r, ms));

// ── a three-storey house: rooms, lights of every family, sensors, a door ────
const rect = (floor_id, x0, y0, x1, y1) => ({ type: "poly", floor_id, points_m: [[x0, y0], [x1, y0], [x1, y1], [x0, y1]] });
const MODEL = {
  floors: [{ id: "basement", name: "Basement", level: -1 }, { id: "main", name: "Main", level: 0 }, { id: "upper", name: "Upper", level: 1 }],
  floor_elevations: { basement: -2.6, main: 0, upper: 2.8 },
  room_geometry_m: {
    Kitchen: rect("main", 0, 0, 5, 4), "Living Room": rect("main", 5.1, 0, 11, 6), Hall: rect("main", 0, 4.1, 5, 6),
    Office: rect("upper", 0, 0, 4, 4), Bedroom: rect("upper", 4.1, 0, 9, 5), Rec: rect("basement", 0, 0, 8, 5), Shop: rect("basement", 8.1, 0, 11, 5),
  },
  light_positions_m: {
    "light.kitchen_pots": { x_m: 2.5, y_m: 2, floor_id: "main", width_cm: 200, height_cm: 120 },
    "light.living_lamp": { x_m: 7, y_m: 3, floor_id: "main" },
    "light.living_valance": { x_m: 8, y_m: 0.3, floor_id: "main", width_cm: 300, height_cm: 5 },
    "light.hall_light": { x_m: 2, y_m: 5, floor_id: "main" },
    "light.office_ceiling": { x_m: 2, y_m: 2, floor_id: "upper" },
    "light.bedroom_light": { x_m: 6, y_m: 2.5, floor_id: "upper" },
    "light.rec_cans": { x_m: 4, y_m: 2.5, floor_id: "basement" },
    "fan.bedroom_fan": { x_m: 7, y_m: 3, floor_id: "upper" },
    "binary_sensor.hall_motion": { x_m: 1, y_m: 5, floor_id: "main" },
    "sensor.office_temperature": { x_m: 3, y_m: 3, floor_id: "upper" },
  },
  rf_barriers_m: [{ id: "bar_1", name: "Front door", material: "door", floor_id: "main", points_m: [[0, 5], [0, 6]], linked_entity_id: "binary_sensor.front_door" }],
  scanner_positions_m: { "AA:BB:CC:00:00:01": { x_m: 2, y_m: 1, z_m: 2.2, floor_id: "main" }, "AA:BB:CC:00:00:02": { x_m: 6, y_m: 2, floor_id: "upper" },
                         "AA:BB:CC:00:00:03": { x_m: 30, y_m: 30, floor_id: "outside" } },
  scanners: { "AA:BB:CC:00:00:01": { room: "Kitchen" }, "AA:BB:CC:00:00:02": { room: "Bedroom" } },
};
const FLOORS = MODEL.floors;
const T0 = new Date(Date.now() - 3600e3).toISOString();
const STATES = {
  "light.kitchen_pots": { state: "on", attributes: { friendly_name: "Kitchen pots", brightness: 200 }, last_changed: T0 },
  "light.living_lamp": { state: "off", attributes: { friendly_name: "Living lamp" }, last_changed: T0 },
  "light.living_valance": { state: "on", attributes: { friendly_name: "Living valance", effect_list: ["Solid"] }, last_changed: T0 },
  "light.hall_light": { state: "off", attributes: { friendly_name: "Hall light" }, last_changed: T0 },
  "light.office_ceiling": { state: "on", attributes: { friendly_name: "Office ceiling" }, last_changed: T0 },
  "light.bedroom_light": { state: "off", attributes: { friendly_name: "Bedroom light" }, last_changed: T0 },
  "light.rec_cans": { state: "on", attributes: { friendly_name: "Rec cans" }, last_changed: T0 },
  "fan.bedroom_fan": { state: "off", attributes: { friendly_name: "Bedroom fan" }, last_changed: T0 },
  "binary_sensor.hall_motion": { state: "off", attributes: { friendly_name: "Hall motion", device_class: "motion" }, last_changed: T0 },
  "sensor.office_temperature": { state: "21.5", attributes: { friendly_name: "Office temperature", device_class: "temperature", unit_of_measurement: "°C" }, last_changed: T0 },
  "binary_sensor.front_door": { state: "off", attributes: { friendly_name: "Front door", device_class: "door" }, last_changed: T0 },
  "person.alice": { state: "home", attributes: { friendly_name: "Alice", device_trackers: ["device_tracker.alice_phone"] }, last_changed: T0 },
  "person.bob": { state: "not_home", attributes: { friendly_name: "Bob", device_trackers: ["device_tracker.bob_phone"] }, last_changed: T0 },
};
const gather = (states, shapes = {}) => LM.gatherLights(states, {}, shapes, "pro", {}, {}, {}, {}, 1_700_000_000_000);
const LIGHTS = gather(STATES), LBE = Object.fromEntries(LIGHTS.map(l => [l.entity_id, l]));

function el(tag, attrs = {}, children = []) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (k === "class") n.className = v;
    else if (k === "style") n.setAttribute("style", v);
    else if (k.startsWith("on") && typeof v === "function") n.addEventListener(k.slice(2), v);
    else if (v !== undefined && v !== null) n.setAttribute(k, String(v));
  }
  for (const c of (Array.isArray(children) ? children : [children])) {
    if (c === null || c === undefined) continue;
    n.appendChild(typeof c === "string" || typeof c === "number" ? document.createTextNode(String(c)) : c);
  }
  return n;
}
// A snapshot: two tags (one sure, one not), one stale, Alice's phone, one outdoors.
const SNAP = (dx = 0, aliceRoom = "Kitchen") => ({ objects: { list: [
  { key: "ble:keys", kind: "ble", user_label: "Keys", identified: true, x_m: 2 + dx, y_m: 2, floor_id: "main", room: "Kitchen", age_s: 4, knn_confidence: 0.9,
    sources: [{ source: "AA:BB:CC:00:00:01", rssi: -60 }, { source: "AA:BB:CC:00:00:02", rssi: -80 }] },
  { key: "ble:bag", kind: "ble", user_label: "Gym bag", identified: true, x_m: 6, y_m: 2, floor_id: "upper", room: "Bedroom", age_s: 120, knn_confidence: null, sources: [] },
  { key: "ble:old", kind: "ble", user_label: "Old tag", identified: true, x_m: 1, y_m: 1, floor_id: "main", _stale: true },
  { key: "ble:shed", kind: "ble", user_label: "Shed tag", identified: true, x_m: 30, y_m: 30, floor_id: "outside", room: "Shed" },
  { key: "phone:alice", kind: "phone", name: "Alice's phone", linked_entities: ["device_tracker.alice_phone"],
    x_m: aliceRoom === "Kitchen" ? 3 + dx : 8, y_m: aliceRoom === "Kitchen" ? 3 : 3, floor_id: "main", room: aliceRoom, age_s: 2, knn_confidence: 0.7 },
] } });
let reads = 0, fileCalls = 0, fileData = {};
const PEOPLE = { read: () => { reads++; return Promise.resolve(SNAP()); }, everyMs: 5000 };
const H3 = (on, extra = {}, more = {}) => ({ slot: "atlas", settings: { atlas_3d_enabled: on, atlas_3d_quality: "auto", ...extra }, telemetry: () => {},
  states: STATES, people: PEOPLE, load: () => { fileCalls++; return Promise.resolve({ data: fileData }); }, ...more });
let shown = 1;
/** The sidebar's card (layout v2, edge to edge), as lights_panel.js builds it. */
function card({ screen = true, house3d, tier = "pro", model = MODEL, floors = FLOORS, lbe = LBE, view, more = {} } = {}) {
  const v = view || { floorGap: 150, horizGap: 0, focusIdx: 0, zoom: 1 };
  const host = { el, view: v, floors, model, byRoom: {}, hiddenEids: new Set(), lightsByEid: lbe, lightsLoading: false, tier,
    layoutV2: true, displayMode: true, codeChip: true, hitHalo: true, collapseUnplaced: true, saveView: async () => {}, onHexesBuilt() {}, ...more };
  if (screen) host.screen = { slot: "atlas", shownAt: shown };
  if (house3d !== undefined) host.house3d = house3d;
  const c = LM.buildLightsMapCard(host);
  const stage = c._all().find(n => n.classList && n.classList.contains("lv-stage"));
  return { c, stage, svg: stage && stage.innerHTML, view: v };
}
const settle = async () => { for (let i = 0; i < 6; i++) await sleep(0); };
localStorage.setItem("padspan_lv_3d_atlas", "0");               // Live Aboard on means Map picked, unless a case says

// ── off: nothing fetched, nothing read (first: atlas_aboard.js loads once) ──
await tryCase("off: with the switches off, below Pro, or Mapping's host, atlas_aboard.js is never fetched and nothing is read", async () => {
  const a = card({ screen: false });
  card({ house3d: H3(false) });
  card({ house3d: H3(false, { atlas_3d_people: false, atlas_3d_tags: false }) });
  card({ house3d: H3(false, { atlas_3d_people: true, atlas_3d_tags: true }), tier: "bright" });   // below Pro
  card({ screen: false, house3d: H3(true, { atlas_3d_people: true, atlas_3d_tags: true }) });   // Mapping's host: no screen
  await settle(); await sleep(20);
  check("off: with the switches off, below Pro, or Mapping's host, atlas_aboard.js is never fetched and nothing is read",
    !abLoaded() && !laLoaded() && reads === 0 && fileCalls === 0 && a.svg.length > 1000, { ab: abLoaded(), la: laLoaded(), reads, fileCalls });
});

// ── byte: the drawing as it was ─────────────────────────────────────────────
async function bytes(model, floors, lbe, label) {
  const out = {};
  const mk = (o) => ISO.buildIsoSVG(model, {}, new Set(), null, 150, 0, lbe, false, floors, { codeChip: true, hitHalo: true, ...o });
  const bare = mk({});
  out.renderer = bare.length > 1000 && mk({ underlay: null }) === bare && mk({ underlay: [] }) === bare && mk({ underlay: undefined }) === bare;
  const absent = card({ screen: false, model, floors, lbe }).svg;
  fileData = { lights: {}, pieces: {} };
  const runs = {
    screen: () => card({ model, floors, lbe }).svg,
    screenOff: () => card({ model, floors, lbe, house3d: H3(false) }).svg,
    people: () => card({ model, floors, lbe, house3d: H3(false, { atlas_3d_people: true, atlas_3d_tags: true }) }).svg,
    laNoKinds: () => card({ model, floors, lbe, house3d: H3(true) }).svg,
  };
  for (const [k, f] of Object.entries(runs)) { f(); await settle(); await sleep(5); out[k] = f() === absent; }   // a second card once everything is in
  localStorage.setItem("padspan_lv_furniture_atlas", "1");
  fileData = { lights: {}, pieces: {} };
  const emptyFurn = card({ model, floors, lbe, house3d: H3(true) }).svg;
  out.furnitureOnEmpty = emptyFurn === absent;
  localStorage.removeItem("padspan_lv_furniture_atlas");
  out.label = label;
  return out;
}
await tryCase("byte: buildIsoSVG is byte-identical with every new option off, on a realistic house", async () => {
  const o = await bytes(MODEL, FLOORS, LBE, "house");
  check("byte: buildIsoSVG is byte-identical with every new option off, on a realistic house", Object.entries(o).every(([k, v]) => k === "label" || v === true), o);
});
let houseRan = false;
if (HOUSE) {
  await tryCase("byte: the same on Garry's own house", async () => {
    const exp = JSON.parse(readFileSync(HOUSE, "utf-8"));
    const st = {};
    for (const [eid, s] of Object.entries(exp.light_states || {})) {
      const attrs = { friendly_name: s.name };
      if (s.rgb_color) attrs.rgb_color = s.rgb_color;
      if (s.brightness !== null && s.brightness !== undefined) attrs.brightness = s.brightness;
      if (s.device_class) attrs.device_class = s.device_class;
      st[eid] = { entity_id: eid, state: s.state, attributes: attrs, last_changed: T0 };
    }
    const lbe = Object.fromEntries(gather(st).map(l => [l.entity_id, l]));
    const o = await bytes(exp.model, exp.model.floors || [], lbe, "garry");
    houseRan = true;
    check("byte: the same on Garry's own house", Object.entries(o).every(([k, v]) => k === "label" || v === true), o);
  });
}

// ── alone: the map alone and full screen on the flat map ─────────────────────
await tryCase("alone: zoomed in the bars step aside; ☰, Escape and zooming out bring them back; a new card keeps it", async () => {
  const panel = el("div");
  panel.getBoundingClientRect = () => ({ left: 256, top: 56, right: 1280, bottom: 900, width: 1024, height: 844 });
  const mk = () => { const c = el("div", { class: "card lv-mapcard lv-display" }), s = el("div", { class: "lv-stage" }); s.getRootNode = () => ({ host: panel }); c.appendChild(s); return { c, s }; };
  let lit = true;
  const a = mk();
  const sc = SCREEN.flatScreen({ slot: "t-alone", card: a.c, stage: a.s, zoom: 1, shown: () => lit });
  a.c.appendChild(sc.anchor);
  const st = () => ({ ...sc.state(), cls: a.c.classList.contains("lv-alone"), pos: a.s.style.position, left: a.s.style.left, w: a.s.style.width, h: a.s.style.height });
  sc.zoomed(1.1, true); const notYet = st();
  sc.zoomed(1.3, true); const alone = st();
  const solo = a.c._all().find(n => n.className === "lv-alone-solo");
  solo.click(); const back = st();
  sc.zoomed(1.4, true); const sameStays = st();
  sc.zoomed(1.7, true); const further = st();
  fireWin("keydown", { key: "Escape" }); const esc = st();
  sc.zoomed(1.0, true); const out = st();
  sc.zoomed(1.3, true); const again = st();
  // The poll builds a new card: still alone, painted at once.
  const b = mk();
  SCREEN.flatScreen({ slot: "t-alone", card: b.c, stage: b.s, zoom: 1.3, shown: () => lit });
  const rebuilt = { cls: b.c.classList.contains("lv-alone"), pos: b.s.style.position, oldListening: sc.state().listening };
  // Live Aboard shows instead: the flat map is not alone, and zooming changes nothing.
  lit = false;
  const sc2 = SCREEN.flatScreen({ slot: "t-alone", card: b.c, stage: b.s, zoom: 1.3, shown: () => lit });
  sc2.zoomed(2.2, true);
  const laShows = { ...sc2.state(), cls: b.c.classList.contains("lv-alone"), anchor: sc2.anchor.style.display };
  SCREEN.dropFlatScreen("t-alone");
  check("alone: zoomed in the bars step aside; ☰, Escape and zooming out bring them back; a new card keeps it",
    !notYet.bare && alone.bare && alone.cls && alone.pos === "fixed" && alone.left === "256px" && alone.w === "1024px" && alone.h === "844px" && alone.listening
    && !back.bare && !back.cls && back.pos === "" && Math.abs(back.hold - 1 / 1.3) < 1e-9 && !sameStays.bare && further.bare
    && !esc.bare && !out.bare && out.hold === null && !out.listening && again.bare
    && rebuilt.cls && rebuilt.pos === "fixed" && !laShows.bare && !laShows.cls && laShows.anchor === "none",
    { notYet, alone, back, sameStays, further, esc, out, again, rebuilt, laShows });
});
await tryCase("alone: ⛶ takes the panel full screen, the map alone; Escape lets go; a screen that may not gets the map alone", async () => {
  const panel = el("div");
  panel.getBoundingClientRect = () => ({ left: 256, top: 56, right: 1280, bottom: 900, width: 1024, height: 844 });
  const asked = [];
  panel.requestFullscreen = function(o){ asked.push(o); document.fullscreenElement = this; fireDoc("fullscreenchange"); return Promise.resolve(); };
  document.exitFullscreen = () => { document.fullscreenElement = null; fireDoc("fullscreenchange"); return Promise.resolve(); };
  document.fullscreenEnabled = true;
  const c = el("div", { class: "card lv-mapcard" }), s = el("div", { class: "lv-stage" });
  s.getRootNode = () => ({ host: panel });
  c.appendChild(s);
  const sc = SCREEN.flatScreen({ slot: "t-full", card: c, stage: s, zoom: 1, shown: () => true });
  const full = sc.anchor.children.find(n => n.className === "lv-alone-full");
  const label0 = full.getAttribute("aria-label");
  full.click();
  const on = { ...sc.state(), w: s.style.width, h: s.style.height, left: s.style.left, label: full.getAttribute("aria-label") };
  sc.anchor.children.find(n => n.className === "lv-alone-solo").click();
  const barsBack = sc.state();
  full.click();                                                           // Leave full screen
  const left = { ...sc.state(), label: full.getAttribute("aria-label"), watching: sc.state().watchingFull };
  delete panel.requestFullscreen; delete document.exitFullscreen; document.fullscreenElement = null;
  const sc2 = SCREEN.flatScreen({ slot: "t-full", card: c, stage: s, zoom: 1, shown: () => true });
  const full2 = sc2.anchor.children.find(n => n.className === "lv-alone-full");
  const label2 = full2.getAttribute("aria-label");
  full2.click();
  const only = sc2.state();
  SCREEN.dropFlatScreen("t-full");
  check("alone: ⛶ takes the panel full screen, the map alone; Escape lets go; a screen that may not gets the map alone",
    label0 === "Full screen" && asked.length === 1 && on.full && on.bare && on.left === "0px" && on.w === `${innerWidth}px` && on.h === `${innerHeight}px`
    && on.label === "Leave full screen" && barsBack.full && !barsBack.bare && !left.full && !left.bare && left.label === "Full screen" && !left.watching
    && label2 === "Only the map" && only.bare && !only.full, { label0, asked, on, barsBack, left, label2, only });
});
await tryCase("alone: the emergency dial, the Vacation banner, ☰ and ⛶ stay above the covering map", async () => {
  const c = el("div", { class: "card lv-mapcard" }), s = el("div", { class: "lv-stage" });
  c.appendChild(s);
  SCREEN.flatScreen({ slot: "t-css", card: c, stage: s, zoom: 1 });
  const css = c._all().filter(n => n.localName === "style").map(n => n.textContent).join("\n");
  const z = (sel) => { const m = new RegExp(sel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\{[^}]*z-index:(\\d+)").exec(css); return m ? Number(m[1]) : null; };
  const zs = { emerg: z(".lv-mapcard.lv-alone > .lv-emerg-anchor"), vac: z(".lv-mapcard.lv-alone > .lv-vacation"), anchor: z(".lv-mapcard.lv-alone > .lv-alone-anchor") };
  SCREEN.dropFlatScreen("t-css");
  check("alone: the emergency dial, the Vacation banner, ☰ and ⛶ stay above the covering map",
    Object.values(zs).every(v => v > SCREEN.COVER_Z) && /\.lv-emerg-anchor\{position:fixed/.test(css) && /lv-alone:has\(\.lv-emerg\)/.test(css), zs);
});
await tryCase("alone: the sidebar card goes alone from its own Zoom +, keeps it on the next card, and Mapping's never does", async () => {
  const view = { floorGap: 150, horizGap: 0, focusIdx: 0, zoom: 1 };
  const a = card({ view });
  const zin = a.c._all().find(n => n.localName === "button" && n.getAttribute("title") === "Zoom in");
  for (let i = 0; i < 3; i++) zin.click();
  const first = { cls: a.c.classList.contains("lv-alone"), zoom: view.zoom, anchorNext: a.stage.nextSibling && a.stage.nextSibling.className };
  const b = card({ view });
  const second = b.c.classList.contains("lv-alone");
  const m = card({ screen: false, view });
  const mz = m.c._all().find(n => n.localName === "button" && n.getAttribute("title") === "Zoom in");
  mz.click();
  const mapping = { cls: m.c.classList.contains("lv-alone"), anchors: m.c._all().filter(n => n.className === "lv-alone-anchor").length };
  view.zoom = 1; card({ view }).c._all().find(n => n.localName === "button" && n.getAttribute("title") === "Reset zoom").click();
  SCREEN.dropFlatScreen("atlas");
  check("alone: the sidebar card goes alone from its own Zoom +, keeps it on the next card, and Mapping's never does",
    first.cls && first.zoom === 1.3 && first.anchorNext === "lv-alone-anchor" && second && !mapping.cls && mapping.anchors === 0, { first, second, mapping });
});

await tryCase("alone: a zoom not by hand never hides the bars: the saved zoom after the first card, a preset, a floor's", async () => {
  SCREEN.dropFlatScreen("atlas");
  const view = { floorGap: 150, horizGap: 0, focusIdx: 0, zoom: 1 };
  const first = card({ view }).c.classList.contains("lv-alone");     // the first card, before the settings
  view.zoom = 1.5;                                                   // the saved zoom arrives
  const saved = card({ view }).c.classList.contains("lv-alone");
  view.zoom = 2.0;                                                   // a preset's zoom
  const preset = card({ view }).c.classList.contains("lv-alone");
  // By hand, it still goes alone; and back out from outside, the bars come back.
  const b = card({ view });
  const zin = b.c._all().find(n => n.localName === "button" && n.getAttribute("title") === "Zoom in");
  zin.click();
  const byHand = b.c.classList.contains("lv-alone");
  view.zoom = 1;
  const outside = card({ view }).c.classList.contains("lv-alone");
  SCREEN.dropFlatScreen("atlas");
  check("alone: a zoom not by hand never hides the bars: the saved zoom after the first card, a preset, a floor's",
    !first && !saved && !preset && byHand && !outside, { first, saved, preset, byHand, outside });
});

// ── tap: a double-tap on a room; a light double-tapped switches once ────────
await tryCase("tap: a room under a point is the top floor's first, and a plate hides the rooms under it", async () => {
  // Floors well apart (Spacing 340): each room is its own on screen.
  const fr = ISO.fabricFrame(MODEL, FLOORS, 340, 0);
  const at = (room, z, x, y) => fr.iso(x, y, z);
  const up = fr.levelOf("upper"), main = fr.levelOf("main"), base = fr.levelOf("basement");
  const office = SCREEN.roomUnder(fr, at("Office", up, 2, 2), null, ISO.pointInPolygon);
  const kitchen = SCREEN.roomUnder(fr, at("Kitchen", main, 2.5, 2), null, ISO.pointInPolygon);
  const ghostUp = SCREEN.roomUnder(fr, at("Office", up, 2, 2), (z) => z !== up, ISO.pointInPolygon);
  const shop = SCREEN.roomUnder(fr, at("Shop", base, 9.5, 2.5), null, ISO.pointInPolygon);
  // Floors close (Spacing 60): the plate above hides the kitchen under it.
  const near = ISO.fabricFrame(MODEL, FLOORS, 60, 0);
  const hiddenKitchen = SCREEN.roomUnder(near, near.iso(2.5, 2, near.levelOf("main")), null, ISO.pointInPolygon);
  const nothing = SCREEN.roomUnder(fr, [-5000, -5000], null, ISO.pointInPolygon);
  const z = SCREEN.roomZoom({ x0: 0, y0: 0, x1: 76, y1: 40 }, 760, 1000, 800), big = SCREEN.roomZoom({ x0: 0, y0: 0, x1: 760, y1: 400 }, 760, 1000, 800);
  check("tap: a room under a point is the top floor's first, and a plate hides the rooms under it",
    office && office.room === "Office" && kitchen && kitchen.room === "Kitchen" && (!ghostUp || ghostUp.room !== "Office") && shop && shop.room === "Shop" && nothing === null
    && (!hiddenKitchen || hiddenKitchen.z !== near.levelOf("main"))
    && z.zoom === 2.5 && z.cx === 38 && z.cy === 20 && big.zoom === 1,
    { office, kitchen, ghostUp: ghostUp && ghostUp.room, shop: shop && shop.room, nothing, z, big });
});
await tryCase("tap: two taps on a room's floor go there; on a marker, slow, moved or a pinch, nothing", async () => {
  const stage = el("div");
  const went = [];
  SCREEN.flatDoubleTap(stage, { roomAt: (x, y) => ({ room: `R${x}`, x, y }), go: (r) => went.push(r.room) });
  const floor = { closest: () => null }, marker = { closest: (sel) => (sel.includes(".lhex") ? {} : null) };
  const L = (t) => stage._listeners[t] || [];
  const ev = (type, id, x, y, t, target = floor) => ({ type, pointerId: id, clientX: x, clientY: y, timeStamp: t, button: 0, pointerType: "touch", target });
  const tap = (id, x, y, t, target, hold = 60) => { for (const f of L("pointerdown")) f(ev("pointerdown", id, x, y, t, target)); for (const f of L("pointerup")) f(ev("pointerup", id, x, y, t + hold, target)); };
  tap(1, 100, 100, 1000); tap(2, 104, 102, 1200); const two = went.length;
  tap(3, 300, 300, 3000, marker); tap(4, 300, 300, 3200, marker); const onMarker = went.length;
  tap(5, 400, 400, 5000); tap(6, 400, 400, 5700); const slow = went.length;
  tap(7, 500, 500, 7000); tap(8, 580, 500, 7200); const moved = went.length;
  tap(9, 600, 600, 9000, floor, 600); tap(10, 600, 600, 9700); const longPress = went.length;
  // A pinch: two fingers down together.
  for (const f of L("pointerdown")) f(ev("pointerdown", 11, 700, 700, 11000));
  for (const f of L("pointerdown")) f(ev("pointerdown", 12, 760, 700, 11010));
  for (const f of L("pointerup")) f(ev("pointerup", 11, 700, 700, 11080));
  for (const f of L("pointerup")) f(ev("pointerup", 12, 760, 700, 11090));
  tap(13, 700, 700, 11200);
  const pinch = went.length;
  check("tap: two taps on a room's floor go there; on a marker, slow, moved or a pinch, nothing",
    two === 1 && went[0] === "R104" && onMarker === 1 && slow === 1 && moved === 1 && longPress === 1 && pinch === 1, { two, onMarker, slow, moved, longPress, pinch, went });
});
await tryCase("tap: a light double-tapped switches once; a tap after that switches again", async () => {
  const isoDiv = el("div"), g = el("g", { class: "lhex" });
  g.dataset.eid = "light.kitchen_pots"; g.dataset.cx = "10"; g.dataset.cy = "10";
  isoDiv.appendChild(g);
  const toggled = [];
  const api = { lightsByEid: LBE, lights: LIGHTS, toggle: (e) => toggled.push(e), openControls() {}, controlsFor: () => false, openRoom() {}, openFloor() {},
                openActivity() {}, hass: null, toast() {}, rerender() {} };
  LM.wireUseSurface(isoDiv, api);
  const fire = (t, ts, x = 50) => { for (const f of g._listeners[t] || []) f({ type: t, pointerId: 1, clientX: x, clientY: 50, timeStamp: ts, button: 0, pointerType: "touch", stopPropagation() {}, preventDefault() {} }); };
  const tap = (ts, x) => { fire("pointerdown", ts, x); fire("pointerup", ts + 70, x); };
  tap(20000); tap(20200);
  const double = toggled.length;
  tap(21500);
  const later = toggled.length;
  tap(30000); tap(30200, 200);                                // the second far off on the screen: its own tap
  check("tap: a light double-tapped switches once; a tap after that switches again", double === 1 && later === 2 && toggled.length === 4, { double, later, all: toggled.length });
});

// ── live: tags, scanners and people on the flat map ──────────────────────────
const AB = await import(url("views/atlas_aboard.js"));
const TRACKED = await import(url("views/live_aboard_tracked.js"));
const NS = "http://www.w3.org/2000/svg";
function layerDraw(L, over = {}, snap) {
  const svg = document.createElementNS(NS, "svg");
  const fr = ISO.fabricFrame(MODEL, FLOORS, 150, 0);
  L.draw({ stage: { querySelector: () => svg }, frame: fr, frameKey: "150|0", model: MODEL, states: STATES, file: null, people: true, tags: true,
           hideNames: false, focused: () => true, outdoor: ISO.isOutdoorFloorId, home: () => document.body, ...over }, snap);
  return { svg, fr };
}
await tryCase("live: tags with names and unsure rings, scanners, people with initials and colours, from the snapshot", async () => {
  const L = AB.liveLayer("t-live");
  const { fr } = layerDraw(L, { file: { figures: { "person.alice": { params: { colors: { top: "#c2410c" } } } } } }, SNAP());
  const s = L.state(), by = (k) => s.find(i => i.key === k);
  const keys = by("beacon:ble:keys"), bag = by("beacon:ble:bag"), alice = by("person.alice");
  const ring = (sure) => [Math.SQRT2 * Math.cos(Math.PI / 6) * fr.scale * TRACKED.haloOf(sure), Math.SQRT2 * 0.5 * fr.scale * TRACKED.haloOf(sure)].map(v => Number(v.toFixed(1)));
  const scanners = s.filter(i => i.kind === "scanner").map(i => i.key).sort();
  const first = { keys: !!keys && keys.name === "Keys" && keys.jump && JSON.stringify(keys.ring) === JSON.stringify(ring(0.9)),
    bag: !!bag && JSON.stringify(bag.ring) === JSON.stringify(ring(null)) && bag.ring[0] > keys.ring[0],
    staleAndOutdoorGone: !by("beacon:ble:old") && !by("beacon:ble:shed") && !by("person.bob"),
    scanners: JSON.stringify(scanners) === JSON.stringify(["scanner:AA:BB:CC:00:00:01", "scanner:AA:BB:CC:00:00:02"]),
    alice: !!alice && alice.initial === "A" && alice.color === "#c2410c",
    phoneIsAlice: !by("beacon:phone:alice") };
  // No figure: the neutral marker. People off: none; tags off: no tags, no scanners.
  L.clear();
  layerDraw(L, {}, SNAP());
  const neutral = L.state().find(i => i.key === "person.alice").color;
  L.clear(); layerDraw(L, { people: false }, SNAP());
  const noPeople = L.state().every(i => i.kind !== "person") && L.state().some(i => i.kind === "beacon");
  L.clear(); layerDraw(L, { tags: false }, SNAP());
  const noTags = L.state().every(i => i.kind === "person");
  // A floor not showing (the floor chips): there, but hidden.
  L.clear(); layerDraw(L, { focused: (z) => z === fr.levelOf("main") }, SNAP());
  const hidden = { bag: L.state().find(i => i.key === "beacon:ble:bag").shown, keys: L.state().find(i => i.key === "beacon:ble:keys").shown };
  L.clear(); layerDraw(L, { hideNames: true }, SNAP());
  const noNames = L.state().find(i => i.key === "beacon:ble:keys").name === "Keys";   // the name is kept for its card, not drawn
  L.clear();
  check("live: tags with names and unsure rings, scanners, people with initials and colours, from the snapshot",
    Object.values(first).every(Boolean) && neutral === "#7dd3fc" && noPeople && noTags && hidden.bag === false && hidden.keys === true && noNames,
    { first, neutral, noPeople, noTags, hidden, s: s.map(i => [i.key, i.ring, i.color]) });
});
await tryCase("live: a person moves smoothly; a far move, another floor or a new spacing is a jump", async () => {
  const L = AB.liveLayer("t-move");
  const svg = document.createElementNS(NS, "svg");
  const fr = ISO.fabricFrame(MODEL, FLOORS, 150, 0), fr2 = ISO.fabricFrame(MODEL, FLOORS, 220, 0);
  const d = (frame, key) => ({ stage: { querySelector: () => svg }, frame, frameKey: key, model: MODEL, states: STATES, file: null, people: true, tags: true,
                               hideNames: false, focused: () => true, outdoor: ISO.isOutdoorFloorId, home: () => document.body });
  L.draw(d(fr, "150|0"), SNAP(0));
  const a = L.state().find(i => i.key === "person.alice");
  L.draw(null, SNAP(0.6));
  const b = L.state().find(i => i.key === "person.alice");
  L.draw(null, SNAP(0.6, "Living Room"));                     // 5 m: still a walk
  const c = L.state().find(i => i.key === "person.alice");
  L.draw(null, { objects: { list: [{ ...SNAP(0).objects.list[4], x_m: 3, y_m: 3, floor_id: "upper", room: "Office" }] } });
  const e = L.state().find(i => i.key === "person.alice");
  L.draw(d(fr2, "220|0"));
  const f = L.state().find(i => i.key === "person.alice");
  L.clear();
  check("live: a person moves smoothly; a far move, another floor or a new spacing is a jump",
    a.jump && !b.jump && b.at[0] !== a.at[0] && !c.jump && e.jump && f.jump, { a, b, c, e, f });
});
await tryCase("live: a tapped tag or scanner shows Live Aboard's own card; a person's says who, where and since when", async () => {
  const L = AB.liveLayer("t-card");
  const { svg } = layerDraw(L, {}, SNAP());
  const s = L.state();
  const tracked = TRACKED.trackedOf(SNAP());
  const keys = s.find(i => i.key === "beacon:ble:keys"), scanner = s.find(i => i.key === "scanner:AA:BB:CC:00:00:01");
  const same = JSON.stringify(keys.card) === JSON.stringify(TRACKED.tagCard(tracked.find(o => o.key === "ble:keys"), MODEL))
    && JSON.stringify(scanner.card) === JSON.stringify(TRACKED.scannerCard("AA:BB:CC:00:00:01", MODEL, 2.2));
  const alice = s.find(i => i.key === "person.alice");
  const firstSeen = alice.card.lines.slice();
  L.draw(null, SNAP(0, "Living Room"));
  const moved = L.state().find(i => i.key === "person.alice").card.lines.slice();
  // A tap opens the card in the panel; a press anywhere else closes it.
  const g = svg._all().find(n => n.getAttribute && n.getAttribute("data-live-key") === "beacon:ble:keys");
  for (const f of g._listeners.click || []) f({ type: "click", stopPropagation() {} });
  const open = AB.cardOpen();
  fireWin("pointerdown", { target: document.body });
  const closed = AB.cardOpen();
  L.clear();
  check("live: a tapped tag or scanner shows Live Aboard's own card; a person's says who, where and since when",
    same && keys.card.lines.includes("In Kitchen") && keys.card.lines.some(l => l.startsWith("Heard by: Kitchen (00:01)"))
    && alice.card.title === "Alice" && firstSeen[0] === "In Kitchen" && firstSeen.some(l => /^Home since /.test(l)) && firstSeen.includes("Seen just now")
    && /^In Living Room since /.test(moved[0]) && open && open.key === "beacon:ble:keys" && /Keys/.test(open.text) && closed === null,
    { keys: keys.card, scanner: scanner.card, firstSeen, moved, open, closed });
});
await tryCase("live: on the sidebar, one read serves both views at Overview's interval, through the same reader; none while off", async () => {
  reads = 0;
  SCREEN.dropReads();
  const h = H3(false, { atlas_3d_people: true, atlas_3d_tags: true });
  card({ house3d: h });
  await settle(); await sleep(5);
  const one = reads;
  card({ house3d: h }); await settle();
  // Live Aboard's own read (lights_map hands it the same shared reader).
  await SCREEN.sharedReader("atlas", h.people).read();
  const shared = reads;
  const now = Date.now, later = now() + 6000;
  Date.now = () => later;
  card({ house3d: h }); await settle();
  Date.now = now;
  const next = reads;
  // Show people off and Show tags off: the layer goes, nothing is read.
  reads = 0;
  const off = card({ house3d: H3(false, { atlas_3d_people: false, atlas_3d_tags: false }) }); await settle();
  const offReads = reads, offLayer = AB.liveLayer("atlas").state().length;
  check("live: on the sidebar, one read serves both views at Overview's interval, through the same reader; none while off",
    one === 1 && shared === 1 && next === 2 && offReads === 0 && offLayer === 0 && !!off.svg, { one, shared, next, offReads, offLayer });
});

// ── kinds and furniture ──────────────────────────────────────────────────────
await tryCase("kinds: a Live Aboard kind draws as its Atlas shape, a shape the person set wins, sensors keep theirs", async () => {
  const want = { pot: "circle", strip: "bar", valance: "bar", undercab: "bar", kick: "bar", tv: "bar", fan: "fan", pendant: "pendant", sconce: "sconce",
                 chandelier: "chandelier", spot: "triangle", track: "line", tube: "square", led: "diamond", pot_ring: "perimeter", cove: "perimeter" };
  const table = Object.entries(want).every(([k, v]) => AB.SHAPE_OF_KIND[k] === v)
    && ["glow", "fixture", "vanity", "string", "lamp", "panel", "accent", "nonsense"].every(k => AB.SHAPE_OF_KIND[k] === undefined);
  const file = { lights: { "light.living_lamp": { kind: "pendant" }, "light.hall_light": { kind: "sconce" }, "light.office_ceiling": { kind: "lamp" },
                           "binary_sensor.hall_motion": { kind: "pot" }, "light.nowhere": { kind: "pot" } } };
  const ks = AB.kindShapes(file, LBE, { "light.hall_light": "triangle" });
  const kinds = JSON.stringify(ks) === JSON.stringify({ "light.living_lamp": "pendant" });
  // On the card: the drawing equals the one where the person had picked that shape themselves.
  fileData = file;
  shown++;                                                    // the panel opened again: the file is read again
  localStorage.removeItem("padspan_lv_furniture_atlas");
  card({ house3d: H3(true) }); await settle(); await sleep(5);
  const withKinds = card({ house3d: H3(true) }).svg;
  const lbeOf = (shapes) => Object.fromEntries(gather(STATES, shapes).map(l => [l.entity_id, l]));
  const picked = card({ screen: false, lbe: lbeOf({ "light.living_lamp": "pendant", "light.hall_light": "sconce" }) }).svg, plain = card({ screen: false }).svg;
  // The person set the living lamp's shape themselves: theirs stays; the hall's kind still draws.
  const personWins = card({ lbe: lbeOf({ "light.living_lamp": "square" }), house3d: H3(true, { light_shapes: { "light.living_lamp": "square" } }) }).svg
    === card({ screen: false, lbe: lbeOf({ "light.living_lamp": "square", "light.hall_light": "sconce" }) }).svg;
  check("kinds: a Live Aboard kind draws as its Atlas shape, a shape the person set wins, sensors keep theirs",
    table && kinds && withKinds === picked && withKinds !== plain && personWins && LBE["light.living_lamp"].shape !== "pendant",
    { table, ks, same: withKinds === picked, differs: withKinds !== plain, personWins });
});
await tryCase("furn: Show furniture draws each piece's footprint and Live Aboard's doors and windows; off, none", async () => {
  const file = { pieces: {
    fur_00000001: { id: "fur_00000001", recipe: { kind: "sofa", width_m: 2.2, depth_m: 0.9 }, floor_id: "main", x_m: 7, y_m: 3, rotation: 90 },
    fur_00000002: { id: "fur_00000002", recipe: { kind: "bed", width_m: 1.6, depth_m: 2.1 }, floor_id: "upper", x_m: 6, y_m: 2.5, rotation: 0 },
    fur_bad: { id: "fur_bad", recipe: {}, floor_id: "main" } },
    openings: { win_00000001: { kind: "window", floor_id: "main", a_m: [6, 0], b_m: [8, 0] }, door_00000001: { kind: "door", floor_id: "upper", a_m: [4, 1], b_m: [4, 2] },
                bar_1: { hinge: "right" } } };
  const u = AB.underlayOf(file);
  const shapes = u.filter(x => x.closed).length === 2 && u.filter(x => !x.closed).length === 2;
  const sofa = u.find(x => x.closed && x.floor_id === "main");
  const sofaW = Math.hypot(sofa.pts[1][0] - sofa.pts[0][0], sofa.pts[1][1] - sofa.pts[0][1]);
  fileData = file;
  shown++;
  localStorage.setItem("padspan_lv_furniture_atlas", "1");
  card({ house3d: H3(true) }); await settle(); await sleep(5);
  const on = card({ house3d: H3(true) }).svg;
  localStorage.setItem("padspan_lv_furniture_atlas", "0");
  const off = card({ house3d: H3(true) }).svg;
  fileData = {};
  shown++;
  card({ house3d: H3(true) }); await settle(); await sleep(5);
  const none = card({ house3d: H3(true) }).svg;
  localStorage.removeItem("padspan_lv_furniture_atlas");
  const polys = (on.match(/fill-opacity="0\.18"/g) || []).length;
  // The furniture lies under the markers: before the first marker of its floor.
  check("furn: Show furniture draws each piece's footprint and Live Aboard's doors and windows; off, none",
    shapes && Math.abs(sofaW - 2.2) < 1e-6 && polys === 2 && on.includes('stroke="#bae6fd"') && on.includes('stroke="#fde68a"') && off === none && on !== off
    && !off.includes('fill-opacity="0.18"'), { shapes, sofaW, polys, offIsNone: off === none });
});

console.log(JSON.stringify({ cases, failures, house: houseRan }));
process.exit(failures.length ? 1 : 0);
