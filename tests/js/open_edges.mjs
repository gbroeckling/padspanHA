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
// room skips the edge already open. On a long edge along two rooms a tap opens
// only the stretch shared with one; a signal wall there is replaced only on a
// confirm, and only that stretch of it goes. The pytest wrapper is
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
const settle = async () => { for (let i = 0; i < 80; i++) await Promise.resolve(); };

// The house: Kitchen and Living share the edge x = 4 (Kitchen's 2nd edge,
// Living's 4th, drawn the other way round); the Loft stands on its own.
// The plan is 10 m by 10 m at the origin, so a fraction is a tenth of a metre.
const sq = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
const rooms = { Kitchen: sq(0, 0, 4, 3), Living: sq(4, 0, 8, 3), Loft: sq(0, 4, 4, 6) };
const G = await import(pathToFileURL(V + "views/wall_geom.js").href);
const H = await import(pathToFileURL(V + "views/live_aboard_house.js").href);
const geometry = Object.fromEntries(Object.entries(rooms).map(([r, pts]) => [r, { type: "poly", floor_id: "main", points_m: pts }]));
const bounds = Object.fromEntries(Object.entries(rooms).map(([r, pts]) => [r, { type: "poly", points: pts.map(p => [p[0] / 10, p[1] / 10]) }]));
const tf = { origin_x_m: 0, origin_y_m: 0, scale_x_m: 10, scale_y_m: 10, rotation_rad: 0, shear_rad: 0 };
const map = { id: "m1", name: "Main floor", floor_id: "main", image: { width: 800, height: 600 }, receivers: [], room_bounds: bounds };

// The server: fabric_rf_barrier_set stores the wall and gives it an id;
// modelRefresh is what the panel re-reads afterwards.
const server = []; const writes = []; const toasts = []; const applies = [];
let confirmsSeen = [], confirmAnswer = true, refuse = null, hold = null;
globalThis.confirm = (m) => { confirmsSeen.push(String(m)); return confirmAnswer; };
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
    if (m.type === "padspan_ha/fabric_open_edges_apply") {
      if (hold) await hold.until;
      if (refuse) throw new Error(refuse);
      applies.push(JSON.parse(JSON.stringify(m)));
      const barriers = [];
      for (const raw of m.set_barriers) {
        const b = JSON.parse(JSON.stringify(raw));
        if (!b.id) writes.push(JSON.parse(JSON.stringify(b)));
        b.id = b.id || `bar_${++seq}`;
        const at = server.findIndex(x => x.id === b.id);
        if (at >= 0) server[at] = b; else server.push(b);
        barriers.push(b);
      }
      for (const id of m.remove_barrier_ids) { const at = server.findIndex(x => x.id === id); if (at >= 0) server.splice(at, 1); }
      return { ok: true, barriers };
    }
    if (m.type === "padspan_ha/fabric_rf_barrier_set") { writes.push({ set: m.barrier }); return { ok: true, barrier: m.barrier }; }
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
check("tap: arming says so", /Tap a room edge on the map\. Only the stretch it shares with the room next door opens; an edge with no neighbour opens whole\. An edge two rooms share is marked once\./.test(text(root)) && !!button(root, "Open edge: tap a room edge"), text(root).slice(-300));
await tapAt(4.02, 1.5);
check("tap: one Open (0 dB) wall, the shared edge's own two vertices, on the map's floor, rail none",
  writes.length === 1 && JSON.stringify(writes[0]) === JSON.stringify({ name: "Open edge — Kitchen", material: "open", attenuation_dbm: 0, rail: "none", floor_id: "main", points_m: [[4, 0], [4, 3]] }),
  writes);
check("tap: the new wall is selected and named", state.maps._selectedBarrierId === "bar_1" && toasts.some(t => t[0] === "Open edge — Kitchen"), [state.maps._selectedBarrierId, toasts]);
check("tap: no confirm for an edge with no wall on it, one use counted", confirmsSeen.length === 0 && applies.length === 1 && applies[0].action === "tap", [confirmsSeen, applies.length]);
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
check("all: it asked first, naming the room and the count", confirmsSeen.length === 1 && /^Mark 4 edges of Loft open\?/.test(confirmsSeen[0]) && /Remove open edges takes them back/.test(confirmsSeen[0]), confirmsSeen);
check("all: one write for the whole room", applies.length === 2 && applies[1].action === "all" && applies[1].set_barriers.length === 4, applies.length);
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

// Open all edges, declined: nothing is written.
{
  const before = writes.length, sel3 = all(root).find(n => n.getAttribute && n.getAttribute("data-open-edge") === "room");
  sel3.value = "Kitchen"; confirmAnswer = false; click(button(root, "Open all edges")); await settle(); confirmAnswer = true;
  check("all: declined, nothing written", writes.length === before, writes.slice(before));
}

// Remove open edges: the room's, in one write; and a hand-drawn Open wall stays.
{
  const roomSel = () => all(root).find(n => n.getAttribute && n.getAttribute("data-open-edge") === "room");
  server.push({ id: "hand", name: "Wall 9", material: "open", attenuation_dbm: 0, floor_id: "main", points_m: [[0, 4], [4, 4]] });
  await actions.modelRefresh();
  roomSel().value = "Loft"; confirmsSeen = []; click(button(root, "Remove open edges")); await settle();
  const a = applies[applies.length - 1];
  check("remove: it asks, naming the room and the count, and says what it can't bring back", /^Remove 4 open edges of Loft\?/.test(confirmsSeen[0] || "") && /doesn't come back/.test(confirmsSeen[0] || ""), confirmsSeen);
  check("remove: one write, four gone, the hand-drawn wall stays", a.action === "removed" && a.remove_barrier_ids.length === 4 && !a.remove_barrier_ids.includes("hand") && server.some(b => b.id === "hand") && !server.some(b => b.name === "Open edge — Loft"), a);
  // Kitchen's shared edge, tapped from its side, comes off with Living too.
  roomSel().value = "Living"; confirmsSeen = []; click(button(root, "Remove open edges")); await settle();
  check("remove: an edge shared with this room comes off whichever side named it", !server.some(b => String(b.name).startsWith("Open edge — ")), server.map(b => b.name));
  roomSel().value = "Kitchen"; confirmsSeen = []; click(button(root, "Remove open edges")); await settle();
  check("remove: nothing left says so, with no confirm", confirmsSeen.length === 0 && toasts.some(t => t[0] === "Kitchen has no open edges to remove."), toasts.slice(-1));
  server.splice(0, server.length); await actions.modelRefresh();
}

// Decision 3: a long edge along two rooms opens only the stretch shared with the one tapped.
// Hall's x = 8 side runs along Den and Study; its top is an outside edge.
const useRooms = (next, floorBars = []) => {
  const geom = Object.fromEntries(Object.entries(next).map(([r, pts]) => [r, { type: "poly", floor_id: "main", points_m: pts }]));
  state.model.room_geometry_m = geom;
  state.model.areas = Object.keys(next);
  state.maps._draftRoomBounds = Object.fromEntries(Object.entries(next).map(([r, pts]) => [r, { type: "poly", points: pts.map(p => [p[0] / 10, p[1] / 10]) }]));
  server.splice(0, server.length, ...floorBars); writes.length = 0; applies.length = 0; confirmsSeen = [];
  return actions.modelRefresh();
};
const long = { Hall: sq(4, 0, 8, 9), Den: sq(8, 0, 10, 5), Study: sq(8, 5, 10, 9) };
await useRooms(long);
state.maps._openEdgeTap = true;
await tapAt(7.98, 2);
check("stretch: a tap on the long edge opens only the stretch shared with the room there",
  writes.length === 1 && JSON.stringify(writes[0].points_m) === JSON.stringify([[8, 0], [8, 5]]) && writes[0].name === "Open edge — Hall", writes);
await tapAt(7.98, 7);
check("stretch: the other room's stretch is its own tap",
  writes.length === 2 && JSON.stringify(writes[1].points_m) === JSON.stringify([[8, 5], [8, 9]]), writes);
await tapAt(6, 8.98);
check("stretch: an outside edge with no neighbour opens whole",
  writes.length === 3 && JSON.stringify(writes[2].points_m) === JSON.stringify([[8, 9], [4, 9]]), writes);
await tapAt(8.02, 2);
check("stretch: the same stretch from the other room is already open", writes.length === 3 && /already open/.test(toasts[toasts.length - 1][0]), toasts.slice(-1));
{
  // A neighbour on another plan of this floor still bounds the stretch.
  await useRooms(long);
  delete state.maps._draftRoomBounds.Study;
  state.maps._openEdgeTap = true;
  await tapAt(7.98, 7);
  check("stretch: a neighbour not on this plan still bounds the stretch",
    writes.length === 1 && JSON.stringify(writes[0].points_m) === JSON.stringify([[8, 5], [8, 9]]), writes);
}
{
  // Outlines that don't quite match: 30 cm apart, ends 40 cm off. Still one wall, still marked once.
  await useRooms({ Hall: sq(4, 0, 8, 5), Den: sq(8.3, 0.4, 10, 5.4) });
  state.maps._openEdgeTap = true;
  await tapAt(7.98, 2);
  const first = writes.length;
  await tapAt(8.32, 2.5);
  check("stretch: a neighbour's outline off by 30 cm is marked once", first === 1 && writes.length === 1, writes);
  check("stretch: the stretch stops where the neighbour stops",
    JSON.stringify(writes[0].points_m) === JSON.stringify([[8, 0.4], [8, 5]]), writes[0]);
}

// Decision 2: a signal wall on the stretch. A confirm says what changes; only that stretch goes.
const metal = () => ({ id: "m1", name: "Barrier 1", material: "metal", attenuation_dbm: 12, floor_id: "main", invert_state: true, keep_me: 7, points_m: [[8, -1], [8, 2], [8, 7]] });
{
  await useRooms(long, [metal()]);
  state.maps._openEdgeTap = true;
  confirmAnswer = false;
  await tapAt(7.98, 2);
  check("wall: declined, nothing written, the wall is selected", applies.length === 0 && writes.length === 0 && state.maps._selectedBarrierId === "m1", applies);
  const c = confirmsSeen[0] || "";
  check("wall: the confirm names the wall, its loss, what goes, that it continues, and that signal changes",
    confirmsSeen.length === 1 && /"Barrier 1" \(metal, 12 dB\)/.test(c) && /runs along 5\.00 m/.test(c) && /The wall continues past it: the other 3\.00 m stay as they are/.test(c)
    && /Signal changes: positioning/.test(c) && /shared with Den/.test(c) && /Remove open edges won't bring a wall back/.test(c), c);
  confirmAnswer = true; confirmsSeen = [];
  await tapAt(7.98, 2);
  const a = applies[0], m = server.find(b => b.id === "m1"), m2 = server.find(b => b.name === "Barrier 1 (2)"), o = server.find(b => b.material === "open");
  check("wall: one write, counted as replaced", applies.length === 1 && a.action === "replaced", applies);
  check("wall: before the stretch keeps the wall's id and every other field", !!m && JSON.stringify(m.points_m) === JSON.stringify([[8, -1], [8, 0]]) && m.keep_me === 7 && m.invert_state === true && m.attenuation_dbm === 12 && server.indexOf(m) === 0, m);
  check("wall: past the stretch it stays as it was, under its own id", !!m2 && JSON.stringify(m2.points_m) === JSON.stringify([[8, 5], [8, 7]]) && m2.id !== "m1" && m2.attenuation_dbm === 12 && m2.keep_me === 7, m2);
  check("wall: the open edge is the stretch, selected", !!o && JSON.stringify(o.points_m) === JSON.stringify([[8, 0], [8, 5]]) && state.maps._selectedBarrierId === o.id, o);
  check("wall: the toast says signal changes", /Signal changes here/.test(toasts[toasts.length - 1][0]), toasts.slice(-1));
  // Real 3D reading: the stretch has no wall; both ends of the wall still stand as metal.
  const model = { floors: [{ id: "main", name: "Main", level: 0, floor_to_floor_m: 3 }], floor_elevations: { main: 0 }, room_geometry_m: state.model.room_geometry_m, room_meta: {}, rf_barriers_m: server, light_positions_m: {}, scanner_positions_m: {} };
  const h = H.readHouse(model, model.floors, {}, null, null, 0);
  const pcs = [...h.perFloor.values()][0].pieces.filter(pc => Math.abs(pc.x0 - 8) < 0.2 && Math.abs(pc.x1 - 8) < 0.2);
  const atY = (y) => pcs.find(pc => Math.min(pc.y0, pc.y1) < y && y < Math.max(pc.y0, pc.y1));
  check("wall: in 3D the stretch is open and the rest of the wall is still metal", atY(2).kind === "open" && !atY(2).free && atY(6).kind === "wall" && atY(6).mat === "metal", pcs.map(pc => [pc.kind, pc.mat, pc.y0, pc.y1, !!pc.free]));
}
{
  // A wall wholly on the stretch goes; a Metal wall past no end says nothing of continuing.
  await useRooms(long, [{ id: "m1", name: "Short", material: "custom", attenuation_dbm: 3, floor_id: "main", points_m: [[8, 1], [8, 3]] }]);
  state.maps._openEdgeTap = true;
  await tapAt(7.98, 2);
  check("wall: a wall all on the stretch is removed, and the confirm says so",
    applies[0].remove_barrier_ids.join() === "m1" && !server.some(b => b.id === "m1") && /Nothing of the wall is left/.test(confirmsSeen[0]) && /\(custom, 3 dB\)/.test(confirmsSeen[0]), [applies[0], confirmsSeen]);
}
{
  // A door or window on the stretch stays as it is: no confirm, an opening in the open edge.
  await useRooms(long, [{ id: "d1", name: "Door — Barrier", material: "metal", attenuation_dbm: 12, floor_id: "main", linked_entity_id: "binary_sensor.door", points_m: [[8, 1], [8, 2]] },
                        { id: "g1", name: "Pane", material: "glass", attenuation_dbm: 2, floor_id: "main", points_m: [[8, 3], [8, 4]] }]);
  state.maps._openEdgeTap = true;
  await tapAt(7.98, 2);
  check("wall: a door or a window on the stretch stays, with no confirm", confirmsSeen.length === 0 && applies[0].action === "tap" && server.filter(b => b.material !== "open").length === 2, confirmsSeen);
}
{
  // Open all edges: an edge with a wall is left as it is and said so; no wall is ever replaced in bulk.
  await useRooms(long, [{ id: "m1", name: "Barrier 1", material: "metal", attenuation_dbm: 12, floor_id: "main", points_m: [[8, 0], [8, 5]] }]);
  state.maps._openEdgeTap = false;
  const s5 = all(root).find(n => n.getAttribute && n.getAttribute("data-open-edge") === "room");
  s5.innerHTML = ""; for (const r of ["Hall", "Den", "Study"]) { const o = document.createElement("option"); o.value = r; o.textContent = r; s5.appendChild(o); }
  s5.value = "Hall";
  click(button(root, "Open all edges")); await settle();
  check("wall: Open all leaves a walled edge as it is, in the confirm and the toast",
    /^Mark 4 edges of Hall open\?/.test(confirmsSeen[0] || "") && /1 with a signal wall on it left as it is/.test(confirmsSeen[0] || "") && server.some(b => b.id === "m1") && applies[0].remove_barrier_ids.length === 0
    && applies[0].set_barriers.length === 4 && /Hall: 4 edges marked open; 1 with a signal wall on it left as it is/.test(toasts[toasts.length - 1][0]), [confirmsSeen, applies, toasts.slice(-1)]);
}

// A double tap writes once and asks once.
{
  await useRooms(long, [metal()]);
  state.maps._openEdgeTap = true;
  const holding = () => { const h = {}; h.until = new Promise(r => { h.go = r; }); return h; };
  hold = holding();
  await tapAt(7.98, 2); await tapAt(7.98, 2);
  hold.go(); await settle();
  check("busy: a double tap on a walled edge asks once and writes once", confirmsSeen.length === 1 && applies.length === 1, [confirmsSeen.length, applies.length]);
  await useRooms(long);
  state.maps._openEdgeTap = false;
  const s6 = all(root).find(n => n.getAttribute && n.getAttribute("data-open-edge") === "room"); s6.value = "Hall";
  hold = holding();
  const b = button(root, "Open all edges"); click(b); click(b); await settle();
  hold.go(); await settle();
  check("busy: a double click on Open all edges writes once", applies.length === 1 && confirmsSeen.length === 1, [applies.length, confirmsSeen.length]);
  check("busy: the flag comes down", state.maps._openEdgeBusy === false, state.maps._openEdgeBusy);
  hold = null;
}

// The refusal stays on screen: nothing after it overwrites it.
{
  await useRooms(long);
  refuse = "Sample mode shows a sample house"; state.maps._openEdgeTap = true;
  const n0 = toasts.length;
  await tapAt(7.98, 2);
  check("refusal: a tap's refusal is the last word", toasts.length === n0 + 1 && /Sample mode shows a sample house/.test(toasts[n0][0]) && toasts[n0][1] === true && state.maps._openEdgeBusy === false, toasts.slice(n0));
  state.maps._openEdgeTap = false;
  const s7 = all(root).find(n => n.getAttribute && n.getAttribute("data-open-edge") === "room"); s7.value = "Hall";
  const n1 = toasts.length;
  click(button(root, "Open all edges")); await settle();
  check("refusal: Open all's refusal is not overwritten by a count", toasts.length === n1 + 1 && /Sample mode/.test(toasts[n1][0]) && !toasts.some(t => /0 edges marked open/.test(t[0])), toasts.slice(n1));
  refuse = null;
}

// One label per room's open edges, unless one is selected.
{
  await useRooms(long);
  const s8 = all(root).find(n => n.getAttribute && n.getAttribute("data-open-edge") === "room"); s8.value = "Hall";
  click(button(root, "Open all edges")); await settle();
  state.maps._selectedBarrierId = null;
  click(button(root, "Rooms")); click(button(root, "Signal walls"));
  // A name on the stage is a div over the plan (.maplabel, _stageLabel), not SVG text.
  const labels = () => all(root).filter(n => String(n.className || "").split(/\s+/).includes("maplabel") && n.textContent === "Open (Loft)").length;
  check("labels: one Open (Loft) label over all a room's open edges", server.length >= 4 && labels() === 1, [server.length, labels()]);
  // Wall names show only in the Signal walls tool, an open edge's too.
  click(button(root, "Rooms"));
  check("labels: none in another tool", labels() === 0, labels());
  click(button(root, "Signal walls"));
  state.maps._selectedBarrierId = server[server.length - 1].id;
  click(button(root, "Rooms")); click(button(root, "Signal walls"));
  check("labels: the selected edge shows its own too", labels() === 2, labels());
}

// A last corner 0 to 8 cm from the first is the first: no edge of a centimetre, as in the 3D house.
{
  const near = [[0, 0], [4, 0], [4, 3], [0, 3], [0.03, 0.04]];
  const closed = G.closedOutline(near);
  check("corners: a last corner beside the first makes no centimetre edge", closed.length === 5 && JSON.stringify(closed[4]) === JSON.stringify([0, 0]), closed);
  check("corners: the same corners as the 3D house", JSON.stringify(closed.slice(0, 4).map(String).sort()) === JSON.stringify(H.cleanPoly(near).map(String).sort()), [closed, H.cleanPoly(near)]);
  const doubled = G.closedOutline([[0, 0], [0.01, 0], [4, 0], [4, 3], [0, 3], [0, 0]]);
  check("corners: a doubled point and a closing point go too", doubled.length === 5, doubled);
  check("corners: under three corners is no outline", G.closedOutline([[0, 0], [1, 1]]) === null, null);
}

// The geometry alone.
{
  const pts = [[8, -1], [8, 2], [8, 7]];
  const c = G.cutWallAlong(pts, [8, 0], [8, 5]);
  check("geom: a wall cut keeps its corners outside the stretch", JSON.stringify(c.kept) === JSON.stringify([[[8, -1], [8, 0]], [[8, 5], [8, 7]]]) && Math.abs(c.cut_m - 5) < 1e-9 && Math.abs(c.kept_m - 3) < 1e-9, c);
  const around = G.cutWallAlong([[0, 0], [8, 0], [8, 5], [12, 5]], [8, 1], [8, 4]);
  check("geom: a wall round a corner keeps both its other legs", JSON.stringify(around.kept) === JSON.stringify([[[0, 0], [8, 0], [8, 1]], [[8, 4], [8, 5], [12, 5]]]), around);
  const stub = G.cutWallAlong([[8, -0.1], [8, 5.1]], [8, 0], [8, 5]);
  check("geom: a stub under 30 cm goes with the cut", stub.kept.length === 0, stub);
  const back = G.cutWallAlong([[8, 7], [8, -1]], [8, 0], [8, 5]);
  check("geom: drawn the other way round", JSON.stringify(back.kept) === JSON.stringify([[[8, 7], [8, 5]], [[8, 0], [8, -1]]]), back);
  const two = G.cutWallAlong([[8, 1], [8, 2], [9, 2], [9, 3], [8, 3], [8, 4]], [8, 0], [8, 5]);
  check("geom: a wall that leaves the line and comes back keeps the part away from it", JSON.stringify(two.kept) === JSON.stringify([[[8, 2], [9, 2], [9, 3], [8, 3]]]), two);
  const far = G.wallsAlong([8, 0], [8, 5], [{ material: "metal", name: "W", points_m: [[8.6, 0], [8.6, 5]] }, { material: "metal", name: "W", points_m: [[8.4, 0], [8.4, 5]] }, { material: "metal", name: "Cross", points_m: [[6, 2], [10, 2]] }]);
  check("geom: a wall counts within 0.47 m and parallel, not further or across", far.length === 1 && far[0].bar.points_m[0][0] === 8.4, far);
  const kinds = [{ material: "metal", name: "Wall 1" }, { material: "custom", name: "Enclose" }, { material: "glass", name: "Big" }, { material: "Open", name: "x" },
                 { material: "brick", name: "Front door" }, { material: "brick", name: "Garage gate" }, { material: "brick", name: "Bay window" }, { material: "brick", name: "Wall", linked_entity_id: "binary_sensor.x" }];
  check("geom: a plain wall is what the 3D house calls a wall, less anything tied to a sensor",
    kinds.map(k => G.isPlainWall(k)).join() === "true,true,false,false,false,false,false,false" && kinds.slice(0, 7).every(k => G.isPlainWall(k) === (H.barrierKind(k) === "wall")), kinds.map(k => [k, G.isPlainWall(k), H.barrierKind(k)]));
}

// The Railing button: only where Live Aboard is on (the Live Aboard gate), and a door cut keeps the word.
{
  await useRooms(long, [{ id: "o1", name: "Gallery", material: "open", attenuation_dbm: 0, floor_id: "main", rail: "none", points_m: [[4, 9], [8, 9]] }]);
  state.maps._openEdgeTap = false;
  const railBtn = () => tagged(root, "BUTTON").filter(n => /^(Railing|No railing|Railing: as before)$/.test(text(n)));
  state.settings.atlas_3d_enabled = false;
  click(button(root, "Rooms")); click(button(root, "Signal walls"));
  check("rail: no Railing button with Live Aboard off", railBtn().length === 0, railBtn().length);
  state.settings.atlas_3d_enabled = true; state.settings.tier = "free";
  click(button(root, "Rooms")); click(button(root, "Signal walls"));
  check("rail: no Railing button on the free tier", railBtn().length === 0, railBtn().length);
  state.settings.tier = "pro";
  click(button(root, "Rooms")); click(button(root, "Signal walls"));
  check("rail: the button is there with Live Aboard on", railBtn().length === 1 && text(railBtn()[0]) === "No railing", railBtn().length);
  const n0 = writes.length;
  click(railBtn()[0]); await settle();
  check("rail: the button still writes its one word", writes.length === n0 + 1 && writes[n0].set.rail === "glass" && writes[n0].set.id === "o1", writes.slice(n0));
  writes.length = 0;
  // Marking a door on the Open edge: its two remaining stretches keep their word.
  ctx.hass.states["binary_sensor.front"] = { attributes: { device_class: "door", friendly_name: "Front" } };
  click(tagged(root, "BUTTON").find(n => text(n) === "Door"));
  await tapAt(5, 9);
  state.maps._doorMarkEntity = "binary_sensor.front";
  await tapAt(6, 9);
  click(button(root, "Create door/window")); await settle();
  const pieces = writes.map(w => w.set).filter(b => b && !b.linked_entity_id);
  check("rail: a door cut on an edge with its word keeps the word on what is left",
    pieces.length === 2 && pieces.every(b => b.rail === "none"), writes);
  writes.length = 0;
  state.maps._doorMarkBarrierId = null; state.maps._doorMarkPts = null;
  delete state.settings.atlas_3d_enabled;
}

// Leaving for another tool and coming back: the tap tool is disarmed.
click(button(root, "Rooms")); click(button(root, "Signal walls"));
check("tools: Signal walls comes back unarmed", state.maps._openEdgeTap === false && !/Tap a room edge on the map\./.test(text(root)), state.maps._openEdgeTap);

console.log(JSON.stringify(results));
