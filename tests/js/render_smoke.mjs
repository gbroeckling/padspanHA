// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
//
// Import every view module and actually RUN its exports.
//
// `node --check` proves a file parses. Four view modules shipped in one week
// that parsed cleanly and threw the moment they rendered — an undeclared
// `liveSnap`, a bare `helpBtn()`, a `fmtAgo` that was a local of a different
// method, a `_wpRssis` belonging to a different function. panel.js loads views
// with `.catch(console.warn)`, so each one produced a BLANK VIEW WITH A CLEAN
// CONSOLE, which is the most expensive failure mode this project has.
//
// Only calling the function finds those. So this does.
//
// It is deliberately not a rendering test: it asserts nothing about output.
// A view that throws is broken; a view that returns something is, for these
// purposes, fine.

import { readdirSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { join } from "node:path";
import { install, flush } from "./dom_shim.mjs";

const VIEWS_DIR = process.argv[2];
if (!VIEWS_DIR) { console.error("usage: render_smoke.mjs <views-dir>"); process.exit(2); }

install(globalThis);

// ── the context a view is handed ─────────────────────────────────────────────
// Real data where a view branches on it; a recording Proxy for the long tail.
// The Proxy is what stops this harness rotting every time panel.js grows a
// helper — the harness does not need to know the API surface, only the DATA,
// because the data is what the render logic actually reads.

const unknown = new Set();

function recorder(path) {
  const fn = (...args) => {
    unknown.add(path);
    // A helper is usually asked for a DOM node or a string; a node satisfies
    // both appendChild and template interpolation, so it is the safer answer.
    return document.createElement("span");
  };
  return new Proxy(fn, {
    get(_t, k) {
      if (k === Symbol.toPrimitive || k === "toString") return () => "";
      if (k === "then") return undefined;              // must not look thenable
      return recorder(`${path}.${String(k)}`);
    },
    apply(_t, _this, args) { return fn(...args); },
  });
}

function el(tag, attrs = {}, children = []) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (k === "class") n.className = v;
    else if (k === "id") n.id = v;
    else if (k === "style") n.setAttribute("style", v);
    else if (k.startsWith("on") && typeof v === "function") n.addEventListener(k.slice(2), v);
    else if (v !== undefined && v !== null) n.setAttribute(k, String(v));
  }
  if (!Array.isArray(children)) children = [children];
  for (const c of children) {
    if (c === null || c === undefined) continue;
    if (typeof c === "string" || typeof c === "number") n.appendChild(document.createTextNode(String(c)));
    else n.appendChild(c);
  }
  return n;
}

const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;")
  .replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function makeCtx(fixture) {
  const helpers = {
    el, esc,
    pill: (t) => el("span", {}, String(t ?? "")),
    HELP: {},
    mapImageUrl: (m) => `/local/padspan_ha/maps/${(m && m.id) || "x"}.png?v=1`,
    radioShortId: (s) => String(s || "").slice(-5),
    awayTimeoutS: () => 120,
    isAway: () => false,
    radioName: () => "",
    scannerStatus: () => "ok",
    roomColor: () => "#52b788",
    helpBtn: () => el("button", {}, "?"),
    scannerAddrs: () => new Set(),
    isScanner: () => false,
  };
  const actions = {
    renderRooms: () => {}, renderNav: () => {}, renderTags: () => {}, renderDiag: () => {},
    openModal: () => {}, closeModal: () => {},
    callWS: async () => ({}),
    wsCall: async () => ({}),
    modelRefresh: async () => {},
    refreshSnapshot: async () => {},
    settingsSet: async () => ({}),
  };
  return new Proxy({
    hass: { states: {}, connection: { sendMessagePromise: async () => ({}) } },
    state: fixture,
    helpers: new Proxy(helpers, {
      get: (t, k) => (k in t ? t[k] : recorder(`helpers.${String(k)}`)),
    }),
    actions: new Proxy(actions, {
      get: (t, k) => (k in t ? t[k] : recorder(`actions.${String(k)}`)),
    }),
    toast: () => {},
  }, {
    get: (t, k) => (k in t ? t[k] : recorder(`ctx.${String(k)}`)),
  });
}

// ── a building, in the shapes the views expect ───────────────────────────────

const RECT = (fid, x0, y0, x1, y1) => ({
  type: "poly", floor_id: fid, points_m: [[x0, y0], [x1, y0], [x1, y1], [x0, y1]],
});

const MODEL = {
  floors: [
    { id: "basement", name: "Basement", level: -1 },
    { id: "main", name: "Main", level: 0 },
    { id: "upper", name: "Upper", level: 1 },
  ],
  areas: [{ id: "kitchen", name: "Kitchen", floor_id: "main" }],
  room_geometry_m: {
    Shop: RECT("basement", -4, -18, 11, 12),
    Kitchen: RECT("main", -3, -16, 16, 12),
    Living: RECT("main", 0, -9, 8, 1),
    Bed: RECT("upper", 3, -21, 12, 6),
    Garden: RECT("__outside__", 6, 4, 19, 30),
  },
  room_meta: { Kitchen: {}, Living: {}, Bed: {}, Shop: {} },
  room_adjacency: { Kitchen: ["Living"], Living: ["Kitchen"] },
  scanner_positions_m: {
    "AA:01": { x_m: 2, y_m: -4, z_m: 2.4, floor_id: "main" },
    "AA:02": { x_m: 8, y_m: -12, z_m: 2.2, floor_id: "upper" },
    "AA:03": { x_m: 4, y_m: -14, z_m: 2.2, floor_id: "basement" },
  },
  light_positions_m: { "light.kitchen": { x_m: 5, y_m: -3, floor_id: "main", shape: "circle" } },
  beacon_positions_m: {},
  rf_barriers_m: [{ name: "w1", floor_id: "main", points_m: [[0, 0], [4, 0]], attenuation_dbm: 6 }],
  floor_elevations: { basement: 0, main: 3.0, upper: 5.3 },
  map_transforms: {
    ground: { scale_x_m: 20, scale_y_m: 14.2, reference_measurements: [{ m: 20 }] },
  },
  scanners: { "AA:01": { room: "Kitchen", floor_id: "main" } },
};

const MAPS = [{
  id: "ground", name: "Ground.png", floor_id: "main",
  image: { width: 1000, height: 710 },
  stack: { scale: 1, scale_x_adj: 1, ref_ar: 0.71, rotation: 0, x_offset: 0, y_offset: 0, z_level: 0, floor_id: "main" },
  receivers: [{ id: "r1", source: "AA:01", label: "Kitchen", x: 0.4, y: 0.5 }],
  rooms: [], rf_barriers: [],
}];

const OBJECTS = [
  { key: "ble:AA:BB:CC:DD:EE:01", address: "AA:BB:CC:DD:EE:01", kind: "ble", name: "Phone",
    user_label: "Phone", identified: true, room: "Kitchen", room_confidence: 0.8,
    x_m: 4, y_m: -3, floor_id: "main", rssi: -62, age_s: 3, all_addresses: ["AA:BB:CC:DD:EE:01"],
    sources: [{ source: "AA:01", rssi: -62, age_s: 3 }] },
  { key: "ibeacon:uuid:1:2", kind: "ibeacon", name: "Tag", room: "Bed", room_confidence: 0.5,
    age_s: 12, all_addresses: ["11:22:33:44:55:66"], sources: [] },
];

const FIXTURE = {
  view: "overview",
  // panel.js always sets these; several views read them without a guard.
  dataMode: "live",
  timing: { lastRefreshMs: 42, lastSnapshotMs: 30 },
  buildId: "smoke",
  appVersion: "0.0.0-smoke",
  live: {
    snapshot: {
      rooms: [{ name: "Kitchen" }, { name: "Living" }, { name: "Bed" }],
      tags: [],
      radios: [{ source: "AA:01", name: "kitchen-esp", area_name: "Kitchen", rssi: -50 }],
      objects: { list: OBJECTS, summary: { total: OBJECTS.length, identified: 1 } },
      ble: {
        radios: [{ source: "AA:01", name: "kitchen-esp", area_name: "Kitchen" },
                 { source: "AA:02", name: "upper-esp", area_name: "Bed" }],
        advertisements: [{ address: "AA:BB:CC:DD:EE:01", source: "AA:01", rssi: -62, age_s: 2 }],
      },
      data_mode: "live",
    },
  },
  model: MODEL,
  maps: { list: MAPS },
  settings: {
    data_mode: "live", quiet_mode: false, lights_panel_enabled: true,
    rssi_capture_enabled: true, overview_show_outdoor: true, overview_2d_mode: false,
    // Feature flags ON. radio_map.js exports no render() of its own — it is
    // only reachable through the views that draw heatmaps, so leaving these
    // off meant a whole module went unexercised and its `_wpRssis` bug sat
    // there uncaught. Flags on is also the harder path, which is the one
    // worth smoke-testing.
    radio_map_enabled: true, distortion_map_enabled: true,
    trackability_rating_enabled: true, walk_to_identify_enabled: true,
    compass_ring_enabled: true, replay_timeline_enabled: true,
    ref_power: -59, path_loss_exp: 2.5, room_sigma_m: 4, kalman_q: 0.125, kalman_r: 8,
    hidden_map_ids: [], followed_addrs: [], scanner_offsets: {},
    presence_poll_interval_s: 10, room_change_delay_s: 20,
  },
  roomTagMap: { Kitchen: [], Living: [] },
  // Calibration points reach the heatmap builders in radio_map.js.
  calibration: {
    points: [
      { map_id: "ground", x_frac: 0.3, y_frac: 0.4, room: "Kitchen", x_m: 4, y_m: -3,
        floor_id: "main",
        scanner_readings: [{ source: "AA:01", mean_rssi: -55 }, { source: "AA:02", mean_rssi: -78 }] },
      { map_id: "ground", x_frac: 0.6, y_frac: 0.7, room: "Living", x_m: 7, y_m: -6,
        floor_id: "main",
        scanner_readings: [{ source: "AA:01", mean_rssi: -68 }, { source: "AA:02", mean_rssi: -71 }] },
    ],
  },
  _overviewShowHeatmap: true,
  _overviewShowDistortion: false,
  _2dFocusIdx: 0,
  _ctx: {},
};

// ── run ──────────────────────────────────────────────────────────────────────

// The names panel.js actually calls on a view module.
const ENTRY_POINTS = new Set(["render", "render2DMap", "renderTags"]);

// What overview.js passes render2DMap (views/overview.js renderIsoFloorStack).
const DEPS = () => ({
  esc,
  renderRoomGrid: () => document.createElement("div"),
  radios: FIXTURE.live.snapshot.ble.radios,
  sid: (src) => String(src || "").slice(-3),
  isScanner: () => false,
});

const failures = [];
const ran = [];

const files = readdirSync(VIEWS_DIR).filter(f => f.endsWith(".js")).sort();

for (const file of files) {
  let mod;
  try {
    mod = await import(pathToFileURL(join(VIEWS_DIR, file)).href);
  } catch (err) {
    failures.push({ file, fn: "<import>", error: String(err && err.message || err),
                    stack: String(err && err.stack || "").split("\n").slice(0, 4).join(" | ") });
    continue;
  }

  for (const [name, fn] of Object.entries(mod)) {
    if (typeof fn !== "function") continue;
    // ENTRY POINTS ONLY. A view's exported helpers take real arguments this
    // harness has no honest way to invent — calling roomColor(ctx) fails
    // because of the harness, not the code, and a guard that reports its own
    // noise is a guard people learn to ignore.
    if (!ENTRY_POINTS.has(name)) continue;
    const ctx = makeCtx(structuredClone(FIXTURE));
    try {
      const arg2 = name === "renderTags" ? document.createElement("div") : DEPS();
      const out = fn(ctx, arg2);
      if (out && typeof out.then === "function") await out;
      await flush();
      ran.push(`${file}:${name}`);
    } catch (err) {
      failures.push({
        file, fn: name,
        error: String(err && err.message || err),
        stack: String(err && err.stack || "").split("\n").slice(0, 4).join(" | "),
      });
    }
  }
}

console.log(JSON.stringify({ ran, failures, unknownHelpers: [...unknown].sort() }));
