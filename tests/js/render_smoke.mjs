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
// It is not a rendering test. A view that throws is broken; a view that
// returns something is, for these purposes, fine. The one exception is the
// overview's composed svg, where a handful of contracts are checked because
// each has silently broken before with a clean console: the annotation-scale
// placeholder must be substituted, the Pure Live scale contract present, and
// the heat/warp overlays must actually draw on the fabric storey.

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
  // width_cm/rotation make this fixture "touched" (lights_map.js's
  // lightIsTouched) so the lights table's conditional Revert button
  // (Garry, 2026-09-06) actually renders in these smoke passes instead of
  // every light silently taking the "nothing to revert" branch.
  light_positions_m: { "light.kitchen": { x_m: 5, y_m: -3, floor_id: "main", shape: "circle", width_cm: 40, rotation: 30 } },
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

// The 3D Stack tab's maps. `_stack()` targets the SECOND alignable map, so the
// master goes there: that is the branch where the align is refused and the
// Point Align / Save Alignment / + Tie-in wiring is driven (#67).
const STACK_MAPS = [
  MAPS[0],
  { id: "upper", name: "Upper.png", floor_id: "upper",
    image: { width: 930, height: 850 },
    stack: { is_master: true, scale: 1, scale_x_adj: 1, ref_ar: 0.53, rotation: 0,
             x_offset: 0, y_offset: 0, z_level: 1, floor_id: "upper" },
    receivers: [], rooms: [], rf_barriers: [] },
];

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
      // Four on the storey: the warp grid needs more than k-NN's k to predict.
      { map_id: "ground", x_frac: 0.2, y_frac: 0.2, room: "Kitchen", x_m: 1, y_m: -12,
        floor_id: "main",
        scanner_readings: [{ source: "AA:01", mean_rssi: -60 }, { source: "AA:02", mean_rssi: -80 }] },
      { map_id: "ground", x_frac: 0.8, y_frac: 0.8, room: "Living", x_m: 12, y_m: 0,
        floor_id: "main",
        scanner_readings: [{ source: "AA:01", mean_rssi: -74 }, { source: "AA:02", mean_rssi: -66 }] },
    ],
  },
  // Both overlays on. The UI keeps them exclusive; the builder draws whatever
  // is asked, and both paths deserve to run.
  _overviewShowHeatmap: true,
  _overviewShowDistortion: true,
  _2dFocusIdx: 0,
  _ctx: {},
};

// ── run ──────────────────────────────────────────────────────────────────────

// The names panel.js actually calls on a view module.
const ENTRY_POINTS = new Set(["render", "render2DMap", "renderTags"]);

// Extra fixtures, merged over the base one and rendered as their own pass.
//
// `render(ctx)` draws ONE tab, so one fixture covers one tab's code and no
// more. maps.js is the extreme case: `_stack()` is 1700 lines behind
// `mapsTab === "stack"`, and with the fixture never setting mapsTab it was the
// LIBRARY tab being smoke-tested every time — a ReferenceError anywhere in the
// 3D Stack and Alignment wiring shipped green, which is exactly the failure
// mode this whole harness exists for.
// The full default shape calibration.js's own render() seeds ctx.state._calib
// with — a variant overriding just {tab} would leave duration/collecting/etc.
// undefined, and the real tabs read those unconditionally.
const CALIB_STATE = (over) => ({
  tab: "tune", deviceId: null, deviceLabel: null, mapId: null, duration: 15,
  pinX: null, pinY: null, pinRoom: null, pinLabel: "", collecting: false,
  stopFlag: false, readings: null, savedThisSession: 0, ...over,
});

// gap #12 (best-in-class roadmap): per-room accuracy scoreboard + confusion
// pairs. Shared between the Model tab's scoreboard/tinted-link variant and
// Roam's "collect more" priority-card variant so both exercise the SAME
// shape calibration_store.py's loo_accuracy() actually returns.
const ROOM_CONFUSION = {
  rooms: {
    Kitchen: { point_count: 5, correct: 3, accuracy: 0.6 },
    Living:  { point_count: 4, correct: 4, accuracy: 1.0 },
  },
  confusion_pairs: [{ true_room: "Kitchen", pred_room: "Living", count: 2 }],
  overall_accuracy: 0.78,
};

const VARIANTS = {
  "maps.js": [
    null,
    { name: "stack", state: { mapsTab: "stack", maps: { list: STACK_MAPS } } },
    { name: "upload", state: { mapsTab: "upload" } },
    { name: "edit", state: { mapsTab: "edit" } },
    // Rooms tab was never smoke-tested at all before gap #7 (best-in-class
    // roadmap) added floorplan import to it — the default fixture's
    // mapsTab lands on "library", same trap the comment above already
    // describes for "stack".
    { name: "rooms", state: { mapsTab: "rooms" } },
    // Same tab with an imported candidate active, so the level-picker,
    // import-notes line, and the "imported" entry in the truth selector
    // all get exercised too, not just the empty/no-import state.
    { name: "rooms-imported", state: { mapsTab: "rooms", maps: { list: MAPS,
      // _roomsFloorId/_roomsDraftFloorId pinned to match so the Rooms tab's
      // own floor-switch reset (which nulls _roomsImportedRaw whenever
      // _roomsDraftFloorId !== the resolved floorId) does not immediately
      // wipe the fixture before the imported-candidate code ever sees it.
      _roomsFloorId: "main", _roomsDraftFloorId: "main",
      _roomsImportedRaw: {
        levels: [{ id: "l1", name: "Ground", elevation_m: 0 }, { id: "l2", name: "Upper", elevation_m: 3 }],
        rooms: [{ name: "Den", level_id: "l1", points_m: [[0, 0], [3, 0], [3, 3], [0, 3]] }],
        warnings: ["Skipped room 'Sliver': fewer than 3 usable points"],
      },
      _roomsImportedLevelId: "l1",
    } } },
    // Ghost scanner active (gap #9, best-in-class roadmap) — exercises the
    // live score readout and the draggable ghost pin, not just the toggle
    // button's off state every other "rooms" variant leaves untouched.
    { name: "rooms-whatif", state: { mapsTab: "rooms", maps: { list: MAPS,
      _roomsFloorId: "main", _roomsDraftFloorId: "main",
      _whatIfGhost: { x_m: 2, y_m: -2 },
    } } },
    // BLE + motion fusion badges (gap #14, best-in-class roadmap) — all
    // three agreement states, so _occupancyBadge's full branch coverage
    // actually renders, not just the "toggle off, nothing drawn" default.
    { name: "rooms-occupancy", state: { mapsTab: "rooms", maps: { list: MAPS,
      _roomsFloorId: "main", _roomsDraftFloorId: "main",
      _roomsShowOccupancy: true,
    },
      _occupancyEstimate: { rooms: [
        { room: "Kitchen", people: ["Garry"], phones: 1, occupancy: true, motion: false, agreement: "agree" },
        { room: "Living", people: [], phones: 2, occupancy: false, motion: false, agreement: "ble_only" },
      ] },
    } },
    // The Setup Wizard short-circuits render() entirely — each step is its
    // own code path (_wizardUpload/_wizardScale/_wizardRooms/
    // _wizardScanners/_wizardFinish), all otherwise unreached by the plain
    // "library"/"stack" passes above.
    { name: "wizard-upload",   state: { _mapsWizard: { step: 1, mapId: null } } },
    { name: "wizard-scale",    state: { _mapsWizard: { step: 2, mapId: "ground" } } },
    { name: "wizard-rooms",    state: { _mapsWizard: { step: 3, mapId: "ground" } } },
    { name: "wizard-scanners", state: { _mapsWizard: { step: 4, mapId: "ground" } } },
    { name: "wizard-finish",   state: { _mapsWizard: { step: 5, mapId: "ground" } } },
    // Lights builder + its guided tour, both tiers (free draws the locked
    // banner and a different tour step 5; paid draws the full toolkit).
    { name: "lights-free", state: { mapsTab: "lights", settings: { tier: "free" } } },
    { name: "lights-paid", state: { mapsTab: "lights", settings: { tier: "pro" } } },
    { name: "lights-tour-free", state: { mapsTab: "lights", settings: { tier: "free" }, _lightsTour: { step: 1 } } },
    { name: "lights-tour-paid-step5", state: { mapsTab: "lights", settings: { tier: "pro" }, _lightsTour: { step: 5 } } },
    { name: "lights-tour-paid-step6", state: { mapsTab: "lights", settings: { tier: "pro" }, _lightsTour: { step: 6 } } },
  ],
  "calibration.js": [
    null, // default cs.tab === "tune"
    { name: "setup",  state: { view: "calibration", _calib: CALIB_STATE({ tab: "setup" }) } },
    { name: "pin-unguarded",  state: { view: "calibration", _calib: CALIB_STATE({ tab: "pin" }) } },
    { name: "pin-ready",      state: { view: "calibration", _calib: CALIB_STATE({ tab: "pin", deviceId: "AA:BB:CC:DD:EE:01", mapId: "ground" }) } },
    { name: "roam-unguarded", state: { view: "calibration", _calib: CALIB_STATE({ tab: "roam" }) } },
    { name: "roam-ready",     state: { view: "calibration", _calib: CALIB_STATE({ tab: "roam", deviceId: "AA:BB:CC:DD:EE:01", mapId: "ground" }) } },
    // Roam's directed "collect more" priority card (gap #12) — otherwise
    // only the purely-geometric coverage-gap crosshair ever renders.
    { name: "roam-priority", state: { view: "calibration",
      _calib: CALIB_STATE({ tab: "roam", deviceId: "AA:BB:CC:DD:EE:01", mapId: "ground" }),
      calibration: {
        points: [
          { map_id: "ground", x_frac: 0.3, y_frac: 0.4, room: "Kitchen", x_m: 4, y_m: -3,
            floor_id: "main", scanner_readings: [{ source: "AA:01", mean_rssi: -55 }] },
          { map_id: "ground", x_frac: 0.6, y_frac: 0.7, room: "Living", x_m: 7, y_m: -6,
            floor_id: "main", scanner_readings: [{ source: "AA:01", mean_rssi: -68 }] },
        ],
        model: { coverage_by_map: { ground: { loo_accuracy: { room_confusion: ROOM_CONFUSION } } } },
      },
    } },
    { name: "model", state: { view: "calibration", _calib: CALIB_STATE({ tab: "model" }) } },
    // Per-room scoreboard + tinted confusion links on the mini floor plan
    // (gap #12) — needs room_confusion on BOTH the global loo_accuracy (the
    // scoreboard card) and the per-map coverage_by_map entry (the SVG
    // links), plus room_bounds on the map so _roomCentroid resolves.
    { name: "model-room-confusion", state: { view: "calibration", _calib: CALIB_STATE({ tab: "model" }),
      calibration: {
        points: [
          { map_id: "ground", x_frac: 0.3, y_frac: 0.4, room: "Kitchen", x_m: 4, y_m: -3,
            floor_id: "main", scanner_readings: [{ source: "AA:01", mean_rssi: -55 }, { source: "AA:02", mean_rssi: -78 }] },
          { map_id: "ground", x_frac: 0.6, y_frac: 0.7, room: "Living", x_m: 7, y_m: -6,
            floor_id: "main", scanner_readings: [{ source: "AA:01", mean_rssi: -68 }, { source: "AA:02", mean_rssi: -71 }] },
        ],
        model: {
          loo_accuracy: { mean_error_m: 1.4, median_error_m: 1.1, max_error_m: 3.0, point_count: 9,
            algorithm: "knn", room_confusion: ROOM_CONFUSION },
          coverage_by_map: { ground: { loo_accuracy: { mean_error_m: 1.4, max_error_m: 3.0,
            room_confusion: ROOM_CONFUSION } } },
        },
      },
      maps: { list: [{ ...MAPS[0], room_bounds: {
        Kitchen: { type: "poly", points: [[0.1, 0.1], [0.4, 0.1], [0.4, 0.4], [0.1, 0.4]] },
        Living:  { type: "poly", points: [[0.5, 0.5], [0.9, 0.5], [0.9, 0.9], [0.5, 0.9]] },
      } }] },
    } },
    { name: "beacon", state: { view: "calibration", _calib: CALIB_STATE({ tab: "beacon" }) } },
    // Matrix tab needs its own calibration override (state merge is shallow —
    // a variant's `calibration` key replaces FIXTURE's, not deep-merges) with
    // BOTH points and model.path_loss set, or the grid-building code (the
    // part actually worth smoke-testing) never runs and only the empty state
    // does.
    { name: "matrix", state: { view: "calibration", _calib: CALIB_STATE({ tab: "matrix" }),
      calibration: {
        points: [
          { map_id: "ground", x_frac: 0.3, y_frac: 0.4, room: "Kitchen", x_m: 4, y_m: -3,
            floor_id: "main",
            scanner_readings: [{ source: "AA:01", mean_rssi: -55 }, { source: "AA:02", mean_rssi: -78 }] },
          { map_id: "ground", x_frac: 0.6, y_frac: 0.7, room: "Living", x_m: 7, y_m: -6,
            floor_id: "main",
            scanner_readings: [{ source: "AA:01", mean_rssi: -68 }] },  // AA:02 silent — grey cell
        ],
        model: {
          path_loss: {
            "AA:01": { rssi_1m: -50, n: 2.2, r_squared: 0.8, point_count: 6, units: "m", scanner_name: "kitchen-esp" },
            "AA:02": { rssi_1m: -55, n: 2.6, r_squared: 0.5, point_count: 5, units: "m", scanner_name: "upper-esp" },
          },
        },
      },
    } },
    // Guided Calibration Wizard — each step its own code path
    // (_calibWizardTune/Setup/Roam/Model/Finish), otherwise unreached.
    { name: "wizard-tune",   state: { view: "calibration", _calibWizard: { step: 1 }, _calib: CALIB_STATE({}) } },
    { name: "wizard-setup",  state: { view: "calibration", _calibWizard: { step: 2 }, _calib: CALIB_STATE({}) } },
    { name: "wizard-roam",   state: { view: "calibration", _calibWizard: { step: 3 }, _calib: CALIB_STATE({ deviceId: "AA:BB:CC:DD:EE:01", mapId: "ground" }) } },
    { name: "wizard-model",  state: { view: "calibration", _calibWizard: { step: 4 }, _calib: CALIB_STATE({ deviceId: "AA:BB:CC:DD:EE:01", mapId: "ground" }) } },
    { name: "wizard-finish", state: { view: "calibration", _calibWizard: { step: 5 }, _calib: CALIB_STATE({ deviceId: "AA:BB:CC:DD:EE:01", mapId: "ground" }) } },
  ],
};

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

// overview.js loads the overlay module lazily and re-renders when it lands;
// the harness runs one synchronous build, so hand it the module up front —
// otherwise the storey heat/warp path never executes here.
const RADIO_MAP_MOD = await import(pathToFileURL(join(VIEWS_DIR, "radio_map.js")).href);

for (const file of files) {
  let mod;
  try {
    mod = await import(pathToFileURL(join(VIEWS_DIR, file)).href);
  } catch (err) {
    failures.push({ file, fn: "<import>", error: String(err && err.message || err),
                    stack: String(err && err.stack || "").split("\n").slice(0, 4).join(" | ") });
    continue;
  }

  // One pass = one entry point rendered with one fixture.
  // ENTRY POINTS ONLY. A view's exported helpers take real arguments this
  // harness has no honest way to invent — calling roomColor(ctx) fails
  // because of the harness, not the code, and a guard that reports its own
  // noise is a guard people learn to ignore.
  const passes = [];
  for (const [name, fn] of Object.entries(mod)) {
    if (typeof fn !== "function") continue;
    if (!ENTRY_POINTS.has(name)) continue;
    for (const v of (VARIANTS[file] || [null])) passes.push([name, fn, v]);
  }

  for (const [name, fn, variant] of passes) {
    // A module cannot be structuredClone'd; attach it after the copy.
    const ctx = makeCtx(Object.assign(structuredClone(FIXTURE),
      structuredClone((variant && variant.state) || {}), { _2dRadioMapMod: RADIO_MAP_MOD }));
    // Every node the render creates, so its innerHTML can be inspected after
    // the deferred work has run.
    const made = [];
    const realCreate = document.createElement;
    document.createElement = (t) => { const n = realCreate(t); made.push(n); return n; };
    try {
      const arg2 = name === "renderTags" ? document.createElement("div") : DEPS();
      const out = fn(ctx, arg2);
      if (out && typeof out.then === "function") await out;
      await flush();
      // The one output assertion. The overview's iso map composes its
      // annotation scale by placeholder substitution at the very end; a
      // placeholder that survived would be an invalid transform on every
      // marker — a map with a clean console and no readable labels.
      if (file === "overview.js") {
        const svgs = made.map(n => n.innerHTML || "").filter(h => h.includes("<svg") && h.includes("viewBox"));
        if (!svgs.length) throw new Error("overview rendered no <svg viewBox> map");
        for (const h of svgs) {
          if (h.includes("__ANNK__")) throw new Error("annotation-scale placeholder left in the composed svg");
          if (!/scale\(\d\.\d{3}\)/.test(h)) throw new Error("no annotation scale applied in the composed svg");
          // The contract Pure Live's zoom composes with: k on the root,
          // an anchor on every annotation.
          if (!/<svg [^>]*data-ann-k="\d\.\d{3}"/.test(h)) throw new Error("svg root missing data-ann-k");
          if (!/data-ann="-?\d+ -?\d+"/.test(h)) throw new Error("no data-ann anchors in the composed svg");
          // The overlays draw from the fabric storey: hatched cells and a
          // warp grid must be present with heat and warp both on.
          if (!h.includes('fill="url(#rmiso')) throw new Error("heat overlay drew no cells on the fabric storey");
          if (!/<line [^>]*stroke-width="1.5" opacity="0.7"/.test(h)) throw new Error("warp overlay drew no grid on the fabric storey");
        }
      }
      ran.push(`${file}:${name}` + (variant ? `[${variant.name}]` : ""));
    } catch (err) {
      failures.push({
        file, fn: name + (variant ? `[${variant.name}]` : ""),
        error: String(err && err.message || err),
        stack: String(err && err.stack || "").split("\n").slice(0, 4).join(" | "),
      });
    } finally {
      document.createElement = realCreate;
    }
  }
}

console.log(JSON.stringify({ ran, failures, unknownHelpers: [...unknown].sort() }));
