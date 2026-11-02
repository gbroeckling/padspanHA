// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
//
// Open edges (Mapping → Edit → Signal walls), RUN rather than read: the Edit
// tab is rendered, Signal walls and "Open edge: tap a room edge" are clicked,
// and the map is tapped near the edge two rooms share. One Open (0 dB) wall
// is written with EXACTLY that edge's two vertices from room_geometry_m on
// the map's floor, with rail "none"; a second tap on the same edge writes
// nothing; "Open all edges" writes every edge of the loft, and for the other
// room skips the edge already open. The pytest wrapper is
// tests/test_open_edges.py.
//
// Run:  node tests/js/open_edges.mjs <repo-root>
import { pathToFileURL } from "node:url";
const ROOT = process.argv[2];
const { install } = await import(pathToFileURL(ROOT + "/tests/js/dom_shim.mjs").href);
install(globalThis);
const V = ROOT + "/custom_components/padspan_ha/www/padspan-ha/";
const MAPS = await import(pathToFileURL(V + "views/maps.js").href);

const results = {};
const check = (name, ok, detail) => { results[name] = { ok: !!ok, detail: ok ? undefined : detail }; };

function el(tag, attrs = {}, children = []) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (k === "class") n.className = v; else if (k === "id") n.id = v; else if (k === "style") n.setAttribute("style", v);
    else if (k === "value") { n.value = v; n.setAttribute(k, String(v)); }
    else if (k.startsWith("on") && typeof v === "function") n.addEventListener(k.slice(2), v);
    else if (v !== undefined && v !== null) n.setAttribute(k, String(v));
  }
  if (!Array.isArray(children)) children = [children];
  for (const c of children) { if (c == null) continue; n.appendChild(typeof c === "string" || typeof c === "number" ? document.createTextNode(String(c)) : c); }
  return n;
}
const quiet = () => new Proxy(() => document.createElement("span"), {
  get: (_t, k) => (k === "then" ? undefined : (k === Symbol.toPrimitive || k === "toString") ? () => "" : quiet()),
  apply: () => document.createElement("span"),
});
const all = (n, out = []) => { for (const c of (n.childNodes || n.children || [])) { out.push(c); all(c, out); } return out; };
const text = (n) => (n.textContent || "").replace(/\s+/g, " ").trim();
const tagged = (root, t) => all(root).filter(n => (n.tagName || "").toUpperCase() === t);
const button = (root, label) => tagged(root, "BUTTON").find(n => text(n) === label) || null;
const byClass = (root, c) => all(root).find(n => String(n.className || "").split(/\s+/).includes(c)) || null;
const click = (n) => n.dispatchEvent({ type: "click", stopPropagation() {}, preventDefault() {}, target: n });
const settle = async () => { for (let i = 0; i < 40; i++) await Promise.resolve(); };

// The house: Kitchen and Living share the edge x = 4 (Kitchen's 2nd edge,
// Living's 4th, drawn the other way round); the Loft stands on its own.
// The plan is 10 m by 10 m at the origin, so a fraction is a tenth of a metre.
const sq = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
const rooms = { Kitchen: sq(0, 0, 4, 3), Living: sq(4, 0, 8, 3), Loft: sq(0, 4, 4, 6) };
const geometry = Object.fromEntries(Object.entries(rooms).map(([r, pts]) => [r, { type: "poly", floor_id: "main", points_m: pts }]));
const bounds = Object.fromEntries(Object.entries(rooms).map(([r, pts]) => [r, { type: "poly", points: pts.map(p => [p[0] / 10, p[1] / 10]) }]));
const tf = { origin_x_m: 0, origin_y_m: 0, scale_x_m: 10, scale_y_m: 10, rotation_rad: 0, shear_rad: 0 };
const map = { id: "m1", name: "Main floor", floor_id: "main", image: { width: 800, height: 600 }, receivers: [], room_bounds: bounds };

// The server: fabric_rf_barrier_set stores the wall and gives it an id;
// modelRefresh is what the panel re-reads afterwards.
const server = []; const writes = []; const toasts = [];
let seq = 0;
const state = {
  dataMode: "live", _dataModeKnown: true, complexity: "advanced", view: "maps", mapsTab: "edit", activeMapId: "m1", version: "0", buildId: "b",
  settings: { tier: "pro", edition: "full" }, followedAddrs: new Set(), timing: {}, roomTagMap: {}, wsCounts: {},
  model: { floors: [{ id: "main", name: "Main" }], areas: Object.keys(rooms), room_meta: {}, room_geometry_m: geometry, map_transforms: { m1: tf }, rf_barriers_m: [] },
  maps: { list: [map] },
  live: { snapshot: { ble: { radios: [] }, objects: { list: [], summary: {} }, tags: [] } },
};
const actions = {
  renderRooms() {}, renderNav() {}, showView() {}, setMapsTab(t) { state.mapsTab = t; }, mapsSetActive(id) { state.activeMapId = id; },
  settingsSet: async (p) => ({ settings: Object.assign(state.settings, p) }),
  callWS: async (m) => {
    if (m.type === "padspan_ha/fabric_rf_barrier_set") {
      const b = JSON.parse(JSON.stringify(m.barrier)); writes.push(JSON.parse(JSON.stringify(b)));
      b.id = b.id || `bar_${++seq}`; server.push(b);
      return { ok: true, barrier: b };
    }
    return {};
  },
  wsCall: async () => ({}), modelRefresh: async () => { state.model.rf_barriers_m = JSON.parse(JSON.stringify(server)); },
  openModal() {}, closeModal() {}, telemetryEvent() {}, canOpen: () => true, followedHas: () => false,
};
const helpers = new Proxy({ el, esc: (x) => String(x ?? ""), helpBtn: () => el("button", {}, "?"), radioShortId: (x) => String(x || ""),
  isScanner: () => false, roomColor: () => "#fff", pill: (t) => el("span", {}, String(t ?? "")), HELP: {}, mapImageUrl: () => "/x.png" },
  { get: (t, k) => (k in t ? t[k] : quiet()) });
const ctx = new Proxy({ hass: { states: {}, user: { is_admin: true }, connection: { sendMessagePromise: async () => ({}) } },
  state, helpers, actions: new Proxy(actions, { get: (t, k) => (k in t ? t[k] : quiet()) }),
  toast: (m, err) => toasts.push([String(m), !!err]) }, { get: (t, k) => (k in t ? t[k] : quiet()) });

let root;
try { root = MAPS.render(ctx); } catch (e) { check("render: the Edit tab renders", false, "threw: " + (e && e.stack || e)); console.log(JSON.stringify(results)); process.exit(0); }
check("render: the Edit tab renders", !!root);
const walls = button(root, "Signal walls");
check("tools: Signal walls is there", !!walls);
if (walls) click(walls);
const tap = button(root, "Open edge: tap a room edge");
const allBtn = button(root, "Open all edges");
check("tools: Open edge: tap a room edge and Open all edges are in Signal walls", !!tap && !!allBtn && /Open edges/.test(text(root)), text(root).slice(0, 300));
check("tools: the help says signal already passes where no wall is drawn", /signal already passes where no wall is drawn/.test(text(root)), null);

// The stage's click handler reads the overlay's box (the shim's is 800 by 600).
const stage = byClass(root, "mapstage");
check("stage: the map stage is there", !!stage);
const tapAt = async (xm, ym) => {
  stage.dispatchEvent({ type: "click", clientX: (xm / 10) * 800, clientY: (ym / 10) * 600, stopPropagation() {}, preventDefault() {}, target: stage });
  await settle();
};

// Armed, a tap 2 cm from the shared edge writes that edge, once.
click(tap);
check("tap: arming says so", /Tap a room edge on the map\. An edge two rooms share is marked once\./.test(text(root)) && !!button(root, "Open edge: tap a room edge"), text(root).slice(-300));
await tapAt(4.02, 1.5);
check("tap: one Open (0 dB) wall, the shared edge's own two vertices, on the map's floor, rail none",
  writes.length === 1 && JSON.stringify(writes[0]) === JSON.stringify({ name: "Open edge — Kitchen", material: "open", attenuation_dbm: 0, rail: "none", floor_id: "main", points_m: [[4, 0], [4, 3]] }),
  writes);
check("tap: the new wall is selected and named", state.maps._selectedBarrierId === "bar_1" && toasts.some(t => t[0] === "Open edge — Kitchen"), [state.maps._selectedBarrierId, toasts]);
const lines = all(root).filter(n => String(n.tagName || "").toLowerCase() === "polyline" && n.getAttribute)
  .map(n => [n.getAttribute("stroke"), n.getAttribute("points"), n.getAttribute("stroke-dasharray")]);
check("tap: the wall is drawn open on the map", lines.some(l => l[0] === "#38bdf8" && l[1] === "0.4,0 0.4,0.3" && l[2] === "0.004 0.008"), lines);

// Tapped again from Living's side: the same edge, so nothing is written twice.
await tapAt(3.98, 2.0);
check("tap: a shared edge is marked once", writes.length === 1 && toasts.some(t => /already open/.test(t[0])), [writes.length, toasts.slice(-1)]);

// Far from any edge: nothing is written, and the panel says so.
await tapAt(2.0, 1.5);
check("tap: a tap away from every edge writes nothing", writes.length === 1 && toasts.some(t => /closer to a room's edge/.test(t[0]) && t[1]), toasts.slice(-1));

// Open all edges: the loft's four, in order round the outline.
const sel = all(root).find(n => n.getAttribute && n.getAttribute("data-open-edge") === "room");
check("all: the room list has the saved rooms of this floor", !!sel && tagged(sel, "OPTION").map(o => o.value).join() === "Kitchen,Living,Loft", sel && tagged(sel, "OPTION").map(o => o.value));
if (sel) sel.value = "Loft";
click(button(root, "Open all edges")); await settle();
const loft = writes.slice(1);
check("all: every edge of the loft, each exactly its two vertices",
  loft.length === 4 && loft.every(b => b.name === "Open edge — Loft" && b.material === "open" && b.attenuation_dbm === 0 && b.rail === "none" && b.floor_id === "main")
  && JSON.stringify(loft.map(b => b.points_m)) === JSON.stringify([[[0, 4], [4, 4]], [[4, 4], [4, 6]], [[4, 6], [0, 6]], [[0, 6], [0, 4]]]),
  loft);
check("all: the panel counts them", toasts.some(t => t[0] === "Loft: 4 edges marked open"), toasts.slice(-1));

// Living: the edge it shares with the Kitchen is open already, so three.
const sel2 = all(root).find(n => n.getAttribute && n.getAttribute("data-open-edge") === "room");
if (sel2) sel2.value = "Living";
click(button(root, "Open all edges")); await settle();
const living = writes.slice(5);
check("all: a room whose shared edge is open already gets the other three",
  living.length === 3 && living.every(b => b.name === "Open edge — Living") && !living.some(b => JSON.stringify(b.points_m) === JSON.stringify([[4, 3], [4, 0]]))
  && toasts.some(t => t[0] === "Living: 3 edges marked open (1 already open)"),
  [living.map(b => b.points_m), toasts.slice(-1)]);

// Leaving for another tool and coming back: the tap tool is disarmed.
click(button(root, "Rooms")); click(button(root, "Signal walls"));
check("tools: Signal walls comes back unarmed", state.maps._openEdgeTap === false && !/Tap a room edge on the map\./.test(text(root)), state.maps._openEdgeTap);

console.log(JSON.stringify(results));
