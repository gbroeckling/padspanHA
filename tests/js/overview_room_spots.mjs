// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
//
// The Overview's house map, run: devices known only by their room, in an
// L-shaped room whose corners' mean lies outside it (in the notch).
//
//   followed  three followed devices with a room and no position
//   named     two named devices with a room and no position (Persistent
//             pins on, so they are drawn)
//   placed    one named device the server placed, at the room's middle
//
// Each room-only marker must stand inside the room as the map draws it (its
// polygon in the svg), no two on one point and none on the placed one. They
// used to sit on the mean of the room's corners, all five on one point, in
// the notch outside the room.
//
// Traceback's playback (house_activity.js beaconsForFrame): a record with a
// room and no position stands at the room's middle, inside the L too.
//
// The rule itself (room_spot.js): an L whose corners' mean is outside it has
// its middle inside, and five known only by it stand inside, apart.
//
// The room's name: drawn at that same middle, inside the L (it sat at the
// corners' mean, in the notch).
//
// usage: overview_room_spots.mjs <www/padspan-ha dir>
// prints one JSON line: { cases: {name: result}, failures: [...], markers, room }

import { pathToFileURL } from "node:url";
import { join } from "node:path";
import { install, flush } from "./dom_shim.mjs";

const WWW = process.argv[2];
if (!WWW) { console.error("usage: overview_room_spots.mjs <www/padspan-ha dir>"); process.exit(2); }
install(globalThis);

const OV = await import(pathToFileURL(join(WWW, "views", "overview.js")).href);
const RS = await import(pathToFileURL(join(WWW, "views", "room_spot.js")).href);
const HA = await import(pathToFileURL(join(WWW, "views", "house_activity.js")).href);

const failures = [];
const cases = {};
const check = (name, ok, detail) => { cases[name] = !!ok; if (!ok) failures.push({ name, detail: detail === undefined ? null : detail }); };
const tryCase = (name, fn) => {
  try { fn(); } catch (e) { failures.push({ name, detail: String(e && e.stack || e).slice(0, 900) }); cases[name] = false; }
};

function recorder(){
  const fn = () => document.createElement("span");
  return new Proxy(fn, {
    get(_t, k){ if (k === Symbol.toPrimitive || k === "toString") return () => ""; if (k === "then") return undefined; return recorder(); },
    apply(){ return fn(); },
  });
}
function el(tag, attrs = {}, children = []){
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (k === "class") n.className = v; else if (k === "id") n.id = v; else if (k === "style") n.setAttribute("style", v);
    else if (k.startsWith("on") && typeof v === "function") n.addEventListener(k.slice(2), v);
    else if (v !== undefined && v !== null) n.setAttribute(k, String(v));
  }
  for (const c of Array.isArray(children) ? children : [children]) {
    if (c === null || c === undefined) continue;
    n.appendChild(typeof c === "string" || typeof c === "number" ? document.createTextNode(String(c)) : c);
  }
  return n;
}
const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// ── the house: an L and a hall ──────────────────────────────────────────────
const L = [[0, 0], [8, 0], [8, 3], [3, 3], [3, 8], [0, 8]];
const MID = RS.middleOf(L);
const MODEL = {
  floors: [{ id: "main", name: "Main", level: 0 }],
  room_geometry_m: { Ell: { type: "poly", floor_id: "main", points_m: L },
                     Hall: { type: "poly", floor_id: "main", points_m: [[9, 0], [12, 0], [12, 3], [9, 3]] } },
  room_meta: { Ell: {}, Hall: {} }, room_adjacency: {}, rf_barriers_m: [], light_positions_m: {}, beacon_positions_m: {},
  scanner_positions_m: {}, scanners: {}, map_transforms: {}, floor_elevations: { main: 0 },
};
const OBJ = (n, more) => ({ key: `ble:AA:00:00:00:00:0${n}`, address: `AA:00:00:00:00:0${n}`, kind: "ble", name: `Dev ${n}`,
                            room: "Ell", age_s: 3, rssi: -60, all_addresses: [`AA:00:00:00:00:0${n}`], sources: [], ...more });
const OBJECTS = [
  OBJ(1, {}), OBJ(2, {}), OBJ(3, {}),                                     // followed, room only
  OBJ(4, { user_label: "Keys" }), OBJ(5, { user_label: "Bag" }),          // named, room only
  OBJ(6, { user_label: "Phone", x_m: MID[0], y_m: MID[1], floor_id: "main", knn_confidence: 0.8 }),   // placed by the server
];
const ROOM_ONLY = OBJECTS.slice(0, 5).map(o => o.key);
const FOLLOWED = new Set(OBJECTS.slice(0, 3).flatMap(o => [o.key, o.address]));

const state = {
  view: "overview", dataMode: "live", _dataModeKnown: true, complexity: "advanced",
  timing: {}, buildId: "t", appVersion: "0.0.0-t",
  live: { snapshot: { objects: { list: OBJECTS, summary: { total: OBJECTS.length } }, ble: { radios: [], advertisements: [] }, rooms: [], tags: [], data_mode: "live" } },
  model: MODEL, maps: { list: [] },
  settings: { data_mode: "live", overview_persistent_pins: true, overview_2d_mode: false, hidden_map_ids: [], followed_addrs: [...FOLLOWED] },
  roomTagMap: {}, calibration: { points: [] }, _ctx: {},
};
const helpers = { el, esc, pill: (t) => el("span", {}, String(t ?? "")), HELP: {}, radioShortId: (s) => String(s || "").slice(-5),
  awayTimeoutS: () => 300, isAway: () => false, radioName: () => "", scannerStatus: () => "ok", roomColor: () => "#52b788",
  helpBtn: () => el("button", {}, "?"), scannerAddrs: () => new Set(), isScanner: () => false };
const actions = { renderRooms: () => {}, renderNav: () => {}, callWS: async () => ({}), wsCall: async () => ({}),
  calibrationGet: async () => ({ points: [] }), followedHas: (k) => FOLLOWED.has(k), settingsSet: async () => ({}) };
const ctx = new Proxy({
  hass: { states: {}, connection: { sendMessagePromise: async () => ({}) } }, state,
  helpers: new Proxy(helpers, { get: (t, k) => (k in t ? t[k] : recorder()) }),
  actions: new Proxy(actions, { get: (t, k) => (k in t ? t[k] : recorder()) }),
  toast: () => {},
}, { get: (t, k) => (k in t ? t[k] : recorder()) });

const made = [];
const realCreate = document.createElement;
document.createElement = (t) => { const n = realCreate(t); made.push(n); return n; };
let svg = "";
try {
  OV.render(ctx);
  await flush();
  svg = made.map(n => n.innerHTML || "").filter(h => h.includes("<svg") && h.includes("data-obj-key")).pop() || "";
} catch (e) {
  failures.push({ name: "render", detail: String(e && e.stack || e).slice(0, 900) });
} finally {
  document.createElement = realCreate;
}

// ── what the map drew ───────────────────────────────────────────────────────
const markers = {};
for (const m of svg.matchAll(/<g data-obj-key="([^"]+)"[^>]*?data-ann="(-?\d+) (-?\d+)"/g)) markers[m[1]] = [Number(m[2]), Number(m[3])];
const roomM = /<g [^>]*data-room="Ell"[^>]*><polygon points="([^"]+)"/.exec(svg);
const room = roomM ? roomM[1].trim().split(/\s+/).map(p => p.split(",").map(Number)) : null;
const inPoly = (x, y, P) => { let c = false; for (let i = 0, j = P.length - 1; i < P.length; j = i++) { const a = P[i], b = P[j]; if ((a[1] > y) !== (b[1] > y) && x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0]) c = !c; } return c; };
const at = ROOM_ONLY.map(k => markers[k]);
const placed = markers[OBJECTS[5].key];
const all = at.concat([placed]).filter(Boolean).map(p => p.join());

check("drawn: the map has the L and all six devices", !!svg && !!room && room.length === L.length && at.every(Boolean) && !!placed,
      { room, markers, svgLen: svg.length });
check("inside: every device known only by its room stands inside the L as drawn",
      !!room && at.every(p => p && inPoly(p[0], p[1], room)), { room, at });
check("apart: no two on one point, none on the device the server placed", new Set(all).size === 6, { all });
// The room's name, at the room's middle: inside the L as drawn.
const labelM = /<text x="(-?\d+)" y="(-?\d+)"[^>]*>Ell<\/text>/.exec(svg);
const label = labelM ? [Number(labelM[1]), Number(labelM[2])] : null;
check("label: the L's name sits inside the L as drawn, where its room-only devices start",
      !!label && !!room && inPoly(label[0], label[1], room), { label, room });
// The corners' mean, where they all used to sit: in the notch, outside the L.
const mean = [L.reduce((a, p) => a + p[0], 0) / L.length, L.reduce((a, p) => a + p[1], 0) / L.length];
check("the old spot: the corners' mean of this L is outside it", !inPoly(mean[0], mean[1], L), mean);

// Traceback's playback: a room-only record in the L.
const frame = HA.beaconsForFrame([{ o: [{ k: "ble:x", n: "Keys", r: "Ell" }] }], 0, MODEL);
check("playback: a record known only by its room stands inside the L",
      frame.length === 1 && inPoly(frame[0].x_m, frame[0].y_m, L) && frame[0].x_m === MID[0] && frame[0].y_m === MID[1], frame);

// ── the rule itself, on a wider L ───────────────────────────────────────────
tryCase("rule: an L whose corners' mean is outside it: the middle inside, five there inside and apart", () => {
  const L = [[0, 0], [8, 0], [8, 3], [3, 3], [3, 8], [0, 8]];
  const mean = [L.reduce((a, p) => a + p[0], 0) / L.length, L.reduce((a, p) => a + p[1], 0) / L.length];
  const m = RS.middleOf(L);
  const stands = [], spots = [];
  for (let i = 0; i < 5; i++) { const s = RS.spotIn({ x: m[0], y: m[1], floor_id: "main", pts: L }, stands); stands.push(s); spots.push(s); }
  let apart = Infinity;
  for (let i = 0; i < spots.length; i++) for (let j = i + 1; j < spots.length; j++) apart = Math.min(apart, Math.hypot(spots[i].x - spots[j].x, spots[i].y - spots[j].y));
  const rect4 = RS.middleOf([[0, 0], [4, 0], [4, 2], [0, 2]]);
  check("rule: an L whose corners' mean is outside it: the middle inside, five there inside and apart",
    !inPoly(mean[0], mean[1], L) && m && inPoly(m[0], m[1], L) && spots.every(s => inPoly(s.x, s.y, L)) && apart >= RS.APART_M
    && rect4[0] === 2 && rect4[1] === 1 && RS.middleOf([[0, 0], [1, 1]]) === null,
    { mean, m, spots, apart });
});

console.log(JSON.stringify({ cases, failures, markers, room }));
