// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
//
// "Preview a finished house": Sample mode shows the estate (sample_house.js
// over estate.js), RUN rather than read.
//
// The real panel.js data-mode, refresh and Sample-mode gate methods are lifted
// out of panel.js (the same text extraction as demo_snapshot_live.mjs) and
// driven against a fake Home Assistant that records every message it gets.
// The real views render under dom_shim.mjs over the panel's own state:
//   - Live mode never loads the sample house (the import is counted);
//   - Sample mode loads it once and every view shows it (rooms by floor,
//     receivers, calibration results from its own walk, Setup finished);
//   - rendering every view in Sample mode sends Home Assistant no write at
//     all, nor any read about the house (only the "pass" messages);
//   - writes are refused with the Sample-mode message, through every door
//     (callWS, the connection, callService, callApi);
//   - back to Live, nothing of the sample house is left in the panel's state;
//   - Bright (settings.edition) renders the same way;
//   - the house could not load: the small demo house, writes still refused.
//
// Run:  node tests/js/sample_estate.mjs <www/padspan-ha dir>
// Prints "ok"/"FAIL" per case, then one JSON line {"cases": {...}}.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { install, flush as flushQueued } from "./dom_shim.mjs";

const WWW = process.argv[2];
if (!WWW) { console.error("usage: sample_estate.mjs <www/padspan-ha dir>"); process.exit(2); }
install(globalThis);
// A view that throws later, on an answer it was given (an awaited WS reply),
// is a view broken by Sample mode's answers: kept and reported, not a crash.
const lateErrors = [];
process.on("unhandledRejection", (e) => { lateErrors.push(String((e && e.stack) || e).split(/\r?\n/).slice(0, 3).join(" | ")); });
const FILE = (p) => pathToFileURL(join(WWW, p)).href;
// The shim's queued timers and frames, then the promise chains they started (a WS answer is several hops).
async function flush(rounds = 8) {
  for (let i = 0; i < 3; i++) {
    await flushQueued(rounds);
    await new Promise(r => globalThis._realSetTimeout(r, 5));
  }
}

const { SAMPLE_SNAPSHOT } = await import(FILE("sample_data.js"));

const cases = {};
async function run(label, check) {
  try { await check(); cases[label] = { ok: true }; console.log("ok   " + label); }
  catch (e) { cases[label] = { ok: false, detail: String((e && e.stack) || e) }; console.log("FAIL " + label + "\n     " + String(e && e.message || e)); }
}
function expect(cond, msg) { if (!cond) throw new Error(msg); }

// ── panel.js, lifted ─────────────────────────────────────────────────────────

const src = readFileSync(join(WWW, "panel.js"), "utf8").replace(/\r\n/g, "\n");

function extractBlock(re, name) {
  const m = re.exec(src);
  if (!m) throw new Error(`could not find ${name} in panel.js — renamed? update this test`);
  let p = src.indexOf("(", m.index), depth = 0, bodyStart = -1;
  for (let j = p; j < src.length; j++) {
    const c = src[j];
    if (c === "(") depth++;
    else if (c === ")") { depth--; if (!depth) { bodyStart = src.indexOf("{", j); break; } }
  }
  depth = 0;
  for (let j = bodyStart; j < src.length; j++) {
    const c = src[j];
    if (c === "{") depth++;
    else if (c === "}") { depth--; if (!depth) return src.slice(m.index, j + 1); }
  }
  throw new Error(`unbalanced braces reading ${name}`);
}
const method = (n) => extractBlock(new RegExp(`^\\s{2}(?:async\\s+)?${n}\\s*\\(`, "m"), n + "()");

const METHODS = ["_wsCount", "_logEvent", "_callWS", "_fetchSettings", "_loadSettings", "_applyDataMode", "_setDataMode",
  "_recomputeDerived", "_getRoomTags", "_getLiveSnapshot", "_refreshAll", "_getMapsList", "_getModel", "_getStatus",
  "_getVersionInfo", "_runAutoDiag", "_loadAlertConfigs",
  "_sampleGateOn", "_ensureSampleHouse", "_sampleBlocked", "_sampleCall", "_viewHass", "_syncSampleHass", "_dropHouseCaches",
  "_keepLiveFollow", "_restoreLiveFollow", "_telemetryEvent", "_telemetryFlush", "_sampleSettingsTick", "_updateEmergencyBanner"];
let bodies = METHODS.map(method).join("\n\n");
// The one import of the sample house: counted, and pointed at the file.
const IMPORT = "import(`./sample_house.js?b=${BUILD_ID}`)";
expect(bodies.split(IMPORT).length === 2, "panel.js should import sample_house.js exactly once, in _ensureSampleHouse");
bodies = bodies.replace(IMPORT, "__importHouse()");
// Module-level in panel.js, from SAMPLE_READONLY_MSG to the end of _sampleKind(): the
// refusal text, this browser's mode choice (localStorage) and the message sorter.
const KIND = (() => {
  const s0 = src.indexOf("\nconst SAMPLE_READONLY_MSG = ");
  const fn = extractBlock(/^function _sampleKind\(/m, "_sampleKind()");
  const end = src.indexOf(fn) + fn.length;
  expect(s0 > 0 && end > s0, "SAMPLE_READONLY_MSG / _sampleKind not found in panel.js");
  return src.slice(s0 + 1, end);
})();

/** A browser's own storage (panel.js keeps this browser's Sample / Live choice there). */
function storage(seed = {}) {
  const m = new Map(Object.entries(seed));
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)); },
           removeItem: (k) => { m.delete(k); }, clear: () => m.clear(), get size() { return m.size; }, map: m };
}

let houseImports = 0;
let failImport = false;
const __importHouse = () => { houseImports++; return failImport ? Promise.reject(new Error("offline")) : import(FILE("sample_house.js") + "?b=t"); };

// One class per browser: its module scope (the in-page mode choice) and its
// storage are its own. The views below share the shim's localStorage, so the
// main browser is given that one.
// eslint-disable-next-line no-new-func
const browser = (store) => new Function("SAMPLE_SNAPSHOT", "__importHouse", "localStorage", `
const BUILD_ID = "t", APP_VERSION = "0.0.0";
let _mapImageUrls = {};
${KIND}
return class Panel {
  constructor(){
    this._hass = null; this._realHass = null; this._sampleHouse = null;
    this.state = {
      dataMode: "sample", view: "overview", settings: null, complexity: "advanced",
      live: { snapshot: null, sources: null, error: null }, maps: { list: [] }, model: {},
      timing: {}, wsCounts: {}, _sessionEvents: [], roomTagMap: {}, savedRoomTagMap: {},
    };
    this.toasts = [];
  }
  // set hass, as panel.js does it (the setter itself is not lifted: it boots the page).
  setHass(h){ this._realHass = h; this._hass = this._viewHass(h); }
  get mapImageUrls(){ return _mapImageUrls; }
  $(){ return null; }
  _toast(m){ this.toasts.push(String(m)); }
  _updateBadges(){} _checkBuild(){} _scheduleRender(){} _applyTheme(){} _applySkin(){} _renderNav(){}
  _countViewLink(){} _startPolling(){} _stopPolling(){} _startDataPoll(){}
${bodies}
}`)(SAMPLE_SNAPSHOT, __importHouse, store);
const Panel = browser(globalThis.localStorage);

// ── a real Home Assistant (fake), and its own small house ────────────────────

const REAL_MODEL = {
  floors: [{ id: "ground", name: "Ground", level: 0 }],
  areas: [{ id: "den", name: "Den", floor_id: "ground" }, { id: "bedroom", name: "Bedroom", floor_id: "ground" }],
  room_geometry_m: { Den: { type: "poly", floor_id: "ground", points_m: [[0, 0], [4, 0], [4, 4], [0, 4]] },
                     Bedroom: { type: "poly", floor_id: "ground", points_m: [[4, 0], [8, 0], [8, 4], [4, 4]] } },
  scanner_positions_m: { "real-proxy-den": { x_m: 2, y_m: 2, z_m: 2.4, floor_id: "ground" } },
};
const REAL_SNAP = { source: "live", objects: { list: [{ key: "real:phone", name: "Real phone", room: "Den", identified: true }], summary: { total: 1 } },
                    ble: { radios: [{ source: "real-proxy-den", name: "Den proxy", area_name: "Den" }], advertisements: [] } };
// The opt-in report's counts are not among them: nothing is counted from Sample mode.
const PASS = new Set(["padspan_ha/settings_get", "padspan_ha/version", "padspan_ha/telemetry_preview"]);

function realHass(server) {
  const log = [];
  const answer = (m) => {
    switch (m.type) {
      case "padspan_ha/settings_get": return { settings: { ...server } };
      case "padspan_ha/settings_set": { const { type, ...rest } = m; Object.assign(server, rest); return { settings: { ...server } }; }
      case "padspan_ha/model_get": return JSON.parse(JSON.stringify(REAL_MODEL));
      case "padspan_ha/maps_list": return { maps: [{ id: "real_plan", name: "Ground.png", floor_id: "ground", image: { filename: "g.png", width: 800, height: 400 }, receivers: [] }],
                                            image_urls: { real_plan: "/api/padspan_ha/maps/real_plan.png?v=1" } };
      case "padspan_ha/live_snapshot": return { snapshot: REAL_SNAP };
      case "padspan_ha/calibration_get": return { points: [{ id: "p1", room: "Den" }], model: {} };
      case "padspan_ha/room_tags": return { room_tag_map: { Den: ["device_tracker.real_phone"] } };
      default: return {};
    }
  };
  const rec = (kind) => (m, ...rest) => { log.push({ kind, type: m && m.type, msg: m, rest }); return Promise.resolve(answer(m || {})); };
  return {
    log,
    states: { "light.real_den": { state: "on", attributes: { friendly_name: "Den light" } }, "sun.sun": { state: "below_horizon", attributes: {} } },
    user: { is_admin: true, name: "Owner", id: "u1" }, language: "en", locale: { language: "en" }, themes: { darkMode: true },
    config: { unit_system: { temperature: "°C" }, time_zone: "UTC", version: "2026.10.0" },
    callWS: rec("callWS"),
    callService: (d, s, data) => { log.push({ kind: "callService", type: `${d}.${s}`, msg: data }); return Promise.resolve({}); },
    callApi: (method, path) => { log.push({ kind: "callApi", type: `${method} ${path}` }); return Promise.resolve({}); },
    connection: { connected: true, sendMessagePromise: rec("sendMessagePromise"),
                  subscribeMessage: (cb, m) => { log.push({ kind: "subscribeMessage", type: m && m.type }); return Promise.resolve(() => {}); },
                  subscribeEvents: () => { log.push({ kind: "subscribeEvents" }); return Promise.resolve(() => {}); },
                  addEventListener(){}, removeEventListener(){} },
  };
}

/** What reached Home Assistant that a Sample mode must never send: anything not "pass". */
function forbidden(log) {
  return log.filter(e => !(e.kind === "callWS" || e.kind === "sendMessagePromise") || !PASS.has(e.type)
    && !(e.type === "padspan_ha/settings_set" && Object.keys(e.msg).every(k => k === "type" || k === "data_mode")));
}

async function bootPanel(server, P = null) {
  const hass = realHass(server);
  if (!P) { globalThis.localStorage.clear(); P = browser(globalThis.localStorage); }
  const p = new P();
  p.setHass(hass);
  await p._refreshAll(false);
  await flush();
  return { p, hass };
}

// ── the views, over the panel's own state ────────────────────────────────────

function el(tag, attrs = {}, children = []) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (k === "class") n.className = v;
    else if (k === "id") n.id = v;
    else if (k === "style") n.setAttribute("style", v);
    else if (k.startsWith("on") && typeof v === "function") n.addEventListener(k.slice(2), v);
    else if (v !== undefined && v !== null && v !== false) n.setAttribute(k, String(v));
  }
  if (!Array.isArray(children)) children = [children];
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    if (typeof c === "string" || typeof c === "number") n.appendChild(document.createTextNode(String(c)));
    else n.appendChild(c);
  }
  return n;
}
const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function ctxFor(p) {
  const call = (m) => p._callWS(m);
  const helpers = {
    el, esc, pill: (t) => el("span", {}, String(t ?? "")), HELP: {}, helpNote: () => "",
    mapImageUrl: (m) => (m && m.image && m.image.filename) ? (p.mapImageUrls[m.id] || null) : null,
    radioShortId: (s) => String(s || "").slice(-5), awayTimeoutS: () => 300, isAway: () => false,
    radioName: () => "", scannerStatus: () => "ok", roomColor: () => "#52b788",
    helpBtn: () => el("button", {}, "?"), scannerAddrs: () => new Set(), isScanner: () => false,
  };
  const actions = {
    renderRooms: () => {}, renderNav: () => {}, renderTags: () => {}, renderDiag: () => {}, openModal: () => {}, closeModal: () => {},
    callWS: call, wsCall: (type, data = {}) => call({ type, ...data }),
    calibrationGet: () => call({ type: "padspan_ha/calibration_get" }),
    settingsSet: (payload) => call({ type: "padspan_ha/settings_set", ...payload }),
    modelUpdate: (payload) => call({ type: "padspan_ha/model_update", ...payload }),
    modelRefresh: () => p._getModel(), mapsRefresh: () => p._getMapsList(), mapsRefreshQuiet: () => p._getMapsList(),
    refreshSnapshot: () => p._getLiveSnapshot(), setDataMode: (m) => p._setDataMode(m),
    telemetryEvent: (name) => call({ type: "padspan_ha/telemetry_event", event: name }),
    canOpen: () => true, showView: (v) => { p.state.view = v; }, followedHas: () => false,
  };
  const quiet = () => () => undefined;
  return {
    hass: p._hass, state: p.state, toast: (m) => p._toast(m),
    helpers: new Proxy(helpers, { get: (t, k) => (k in t ? t[k] : quiet()) }),
    actions: new Proxy(actions, { get: (t, k) => (k in t ? t[k] : (() => Promise.resolve(undefined))) }),
  };
}

const VIEW_PATHS = Object.fromEntries([...src.matchAll(/^\s{2}(\w+):\s+"\.\/views\/([\w.]+)",?$/gm)].map(m => [m[1], m[2]]));
expect(Object.keys(VIEW_PATHS).length > 20, "could not read _VIEW_PATHS from panel.js");

async function renderView(p, id, extra = {}) {
  const mod = await import(FILE("views/" + VIEW_PATHS[id]) + "?b=t");
  Object.assign(p.state, { view: id }, extra);
  const node = await mod.render(ctxFor(p));
  await flush(40);
  // A view that fetched on its first draw (Calibration, Setup) is drawn again, as the panel's re-render does.
  const again = await mod.render(ctxFor(p));
  await flush(40);
  return again || node;
}
const text = (n) => (n && n.textContent) || "";
const all = (n, sel) => (n && n.querySelectorAll) ? [...n.querySelectorAll(sel)] : [];

// ── the cases ────────────────────────────────────────────────────────────────

await run("Live mode never loads the sample house", async () => {
  const before = houseImports;
  const { p, hass } = await bootPanel({ data_mode: "live" });
  for (const id of ["overview", "rooms", "receivers", "calibration", "setup"]) await renderView(p, id);
  expect(houseImports === before, `the sample house was imported ${houseImports - before} time(s) in Live mode`);
  expect(p._hass === hass, "Live mode's views were not handed Home Assistant itself");
  expect(p.state.model.room_geometry_m.Den, "Live mode did not show the real house");
});

let S = null;   // the Sample-mode panel, shared by the cases below
await run("Sample mode loads the sample house once and shows it: 3 floors, 22 rooms, 3 plans, 19 receivers", async () => {
  const before = houseImports;
  S = await bootPanel({ data_mode: "sample" });
  const { p } = S;
  expect(houseImports - before === 1, `expected one import of the sample house, got ${houseImports - before}`);
  const byFloor = {};
  for (const g of Object.values(p.state.model.room_geometry_m)) byFloor[g.floor_id] = (byFloor[g.floor_id] || 0) + 1;
  expect(JSON.stringify(byFloor) === JSON.stringify({ lower: 5, main: 12, upper: 5 }), "rooms by floor: " + JSON.stringify(byFloor));
  expect(p.state.model.floors.length === 3, "floors");
  expect(p.state.maps.list.length === 3 && p.state.maps.list.every(m => p.mapImageUrls[m.id].startsWith("data:image/svg+xml")), "floor plans");
  const snap = p.state.live.snapshot;
  expect(snap !== SAMPLE_SNAPSHOT && snap.source === "sample", "the snapshot is not the sample house's");
  expect(snap.ble.radios.length === 19, "receivers in the snapshot: " + snap.ble.radios.length);
  const people = snap.objects.list.filter(o => o.entity_id).map(o => o.entity_id).sort();
  expect(JSON.stringify(people) === JSON.stringify(["device_tracker.alex_phone", "device_tracker.sam_phone"]), "people: " + people);
  expect(p._hass.states["person.alex"] && !p._hass.states["light.real_den"], "the views get the sample house's states, not the real ones");
  expect(p._hass.states["sun.sun"].state === "below_horizon", "the real sun is kept (a theme that follows it)");
});

await run("Rooms: the sample house's rooms by floor, read-only, with its people", async () => {
  const { p } = S;
  const node = await renderView(p, "rooms");
  const rows = all(node, "[data-room]").map(n => n.getAttribute("data-room"));
  expect(rows.length === 22, "rooms listed: " + rows.length);
  expect(rows.includes("Games Room") && rows.includes("Study") && !rows.includes("Den"), "the wrong house's rooms: " + rows.join(", "));
  const note = all(node, '[data-rooms-note="sample"]')[0];
  expect(note && /sample house's rooms, shown read-only/.test(text(note)), "no read-only note");
  expect(/Alex/.test(text(node)), "nobody shown in the rooms");
});

await run("Receivers: 19 rows, read-only", async () => {
  const { p } = S;
  const node = await renderView(p, "receivers");
  expect(/19 receivers/.test(text(node)), "count line: " + (text(node).match(/\d+ receivers?[^·]*/) || [""])[0]);
  expect(all(node, '[data-rx-note="sample"]').length === 1, "no Sample note");
  expect(/Workshop proxy 1/.test(text(node)), "receiver names missing");
});

await run("Calibration Results: the sample house's own walk, not the five sample rooms", async () => {
  const { p } = S;
  p.state._calib = null;
  const node = await renderView(p, "calibration");
  const t = text(node);
  expect(p.state.calibration && p.state.calibration.sample === true && p.state.calibration.points.length > 80, "calibration_get was not answered by the house");
  expect(all(node, '[data-cal-results="tab"]').length === 1, "the Results tab did not render");
  expect(/Games Room|Primary Bedroom|Loft|Bathroom/.test(t), "no room of the sample house in Results");
  expect(!/Master Bedroom|Guest Room/.test(t), "the small demo house's rooms are in Results");
  const next = all(node, '[data-cal-results="next"]')[0];
  expect(next && ["room_weak", "matrix"].includes(next.getAttribute("data-kind")), "next action: " + (next && next.getAttribute("data-kind")));
});

await run("Setup: a finished house, six of six", async () => {
  const { p } = S;
  const node = await renderView(p, "setup");
  expect(all(node, '[data-setup="all-done"]').length === 1, "Setup is not finished: " + text(all(node, '[data-setup="count"]')[0]));
  expect(/6 of 6 done/.test(text(node)), "count: " + text(all(node, '[data-setup="count"]')[0]));
});

await run("Mapping: the sample house's plans, read-only", async () => {
  const { p } = S;
  const node = await renderView(p, "maps", { mapsTab: "library" });
  expect(all(node, '[data-maps-note="sample"]').length === 1, "no read-only note");
  expect(!/Smith Residence/.test(text(node)), "the small demo house's drawing");
});

await run("rendering every view in Sample mode sends Home Assistant no write and nothing about the house", async () => {
  const { p, hass } = S;
  const failed = [];
  for (const id of Object.keys(VIEW_PATHS)) {
    try { await renderView(p, id); } catch (e) { failed.push(`${id}: ${e && e.message}`); }
  }
  for (const [id, extra] of [["maps", { mapsTab: "stack" }], ["maps", { mapsTab: "rooms" }], ["maps", { mapsTab: "lights" }],
                             ["calibration", { _calib: null, _calibWizard: { step: 1 } }], ["settings", { _settingsTab: "ui" }]]) {
    try { await renderView(p, id, extra); } catch (e) { failed.push(`${id} ${JSON.stringify(extra)}: ${e && e.message} ${process.env.DBG ? e.stack : ""}`); }
  }
  await flush(20);
  const bad = forbidden(hass.log);
  expect(!bad.length, "sent to Home Assistant in Sample mode: " + JSON.stringify(bad.map(e => `${e.kind} ${e.type}`)));
  expect(hass.log.some(e => e.type === "padspan_ha/settings_get"), "the settings were never read (the harness did not reach HA at all)");
  expect(!lateErrors.length, "a view threw on a Sample-mode answer: " + lateErrors.join(" || "));
  if (failed.length) console.log("     (views that threw over this harness's stubs: " + failed.join("; ") + ")");
});

// Basic's focused links (views/focus.js: a link opens just the part it is about, Basic staying
// Basic): in Sample mode the part is the sample house's, and still writes nothing.
await run("Basic focused links in Sample mode: the part opens, Basic stays Basic, and nothing reaches Home Assistant", async () => {
  const { p, hass } = S;
  const n = hass.log.length, was = p.state.complexity;
  const failed = [];
  const back = { view: "overview", label: "Overview", focus: null };
  for (const f of [{ view: "settings", tab: "presence", part: "usage_report", title: "Help improve PadSpan" },
                   { view: "settings", tab: "presence", part: "guest_tags", title: "Guest tags" },
                   { view: "settings", tab: "atlas", part: "la3d", title: "Live Aboard" },
                   { view: "settings", tab: "ai", part: "ai_task", title: "AI" },
                   { view: "maps", tab: "stack", part: "floor_heights", title: "Floor heights" }]) {
    const extra = { _focus: { ...f, item: null, back }, ...(f.view === "maps" ? { mapsTab: f.tab } : { _settingsTab: f.tab }) };
    try {
      const node = await renderView(p, f.view, { complexity: "basic", ...extra });
      expect(all(node, "[data-focus-bar]")[0], `${f.view}/${f.part}: not opened as a focused part`);
    } catch (e) { failed.push(`${f.view}/${f.part}: ${e && e.message}`); }
  }
  await flush(20);
  expect(!failed.length, failed.join("; "));
  expect(p.state.complexity === "basic" && p.state.dataMode === "sample", "the mode changed: " + p.state.complexity + " / " + p.state.dataMode);
  const bad = forbidden(hass.log.slice(n));
  expect(!bad.length, "sent to Home Assistant from a focused link: " + JSON.stringify(bad.map(e => `${e.kind} ${e.type}`)));
  let err = null;
  try { await p._callWS({ type: "padspan_ha/settings_set", away_timeout_s: 120 }); } catch (e) { err = e; }
  expect(err && err.code === "sample_mode", "a Tracking save from the focused link was not refused");
  Object.assign(p.state, { complexity: was, _focus: null, _settingsTab: "appearance", mapsTab: "library" });
});

await run("writes are refused with the Sample-mode message, through every door", async () => {
  const { p, hass } = S;
  const n = hass.log.length;
  const refused = async (f, what) => {
    let err = null;
    try { await f(); } catch (e) { err = e; }
    expect(err && err.code === "sample_mode", `${what} was not refused`);
  };
  await refused(() => p._callWS({ type: "padspan_ha/model_update", room_meta: {} }), "model_update");
  await refused(() => p._hass.callWS({ type: "padspan_ha/calibration_save_point", point: {} }), "calibration_save_point");
  await refused(() => p._hass.connection.sendMessagePromise({ type: "padspan_ha/house3d_edit", pieces: {} }), "house3d_edit");
  await refused(() => p._callWS({ type: "padspan_ha/settings_set", theme: "day" }), "a settings change");
  await refused(() => p._callWS({ type: "padspan_ha/settings_set", data_mode: "live", theme: "day" }), "a data-mode switch carrying another setting");
  await refused(() => p._callWS({ type: "padspan_ha/some_future_message" }), "a message nobody listed");
  await refused(() => p._hass.callService("light", "turn_on", { entity_id: "light.kitchen_ceiling" }), "callService");
  await refused(() => p._hass.callApi("POST", "config/automation/config/x", {}), "callApi POST");
  // The opt-in report: not refused (no message), and not counted either.
  await p._callWS({ type: "padspan_ha/telemetry_event", event: "stairs_drawn" });
  expect(hass.log.length === n, "a refused write reached Home Assistant: " + JSON.stringify(hass.log.slice(n).map(e => e.type)));
  expect(p.toasts.some(t => /Sample mode shows a sample house, so nothing can be changed/.test(t)), "the Sample-mode message was not shown");
});

await run("back to Live: the real house reloads and nothing of the sample one is left", async () => {
  const { p, hass } = S;
  const imports = houseImports;
  // The Atlas inside the panel (Overview as the Atlas) with its kept lights index: dropped at the
  // switch, so Live builds a new one and no sample-house row is left in it (lights_panel.js _tableKeep).
  const atlasHome = document.createElement("div");
  const atlas = document.createElement("padspan-lights-app");
  atlas._tableKeep = { rows: new Map([["light.games_room_cove_1", {}]]) };
  atlasHome.appendChild(atlas);
  p.state._overviewAtlas = atlas;
  await p._setDataMode("live");
  await flush();
  const sent = hass.log.filter(e => e.type === "padspan_ha/settings_set").pop();
  expect(sent && sent.msg.data_mode === "live", "the switch was not sent to Home Assistant");
  expect(p.state.dataMode === "live" && p._hass === hass && p._sampleHouse === null, "still behind the sample house");
  expect(houseImports === imports, "Live mode imported the house again");
  expect(p.state._overviewAtlas === null && !atlasHome.childNodes.includes(atlas), "the Atlas inside the panel (its kept lights index) outlived the switch");
  expect(p.state.model.room_geometry_m.Den && !p.state.model.room_geometry_m["Games Room"], "the real model did not reload");
  expect(p.state.live.snapshot === REAL_SNAP, "the real snapshot did not land");
  for (const id of ["overview", "rooms", "receivers", "calibration", "setup"]) await renderView(p, id);
  const seen = new WeakSet();
  const json = JSON.stringify(p.state, (k, v) => {
    if (v && typeof v === "object") { if (v.nodeType || seen.has(v)) return undefined; seen.add(v); }
    return typeof v === "function" ? undefined : v;
  });
  if (process.env.DBG) for (const [k, v] of Object.entries(p.state)) { let j = ""; try { j = JSON.stringify(v, (kk, vv) => (vv && vv.nodeType) ? undefined : vv) || ""; } catch (e) {} if (/demo-proxy|Games Room|estate_|Workshop/.test(j)) console.log("LEFT IN", k, j.slice(0, 200)); }
  const left = ["demo-proxy", "Games Room", "estate_", "demo:alex_phone", "person.alex", "Workshop"].filter(s => json.includes(s));
  expect(!left.length, "left in the panel's state after the switch: " + left.join(", "));
});

await run("Bright: Sample mode shows the sample house the same way, and writes nothing", async () => {
  const B = await bootPanel({ data_mode: "sample", edition: "bright", tier: "bright" });
  const { p, hass } = B;
  for (const id of ["overview", "purelive", "follow", "settings", "health"]) await renderView(p, id);
  expect(p.state.settings.edition === "bright", "the settings did not come from Home Assistant");
  expect(p.state.model.room_geometry_m["Games Room"], "Bright did not get the sample house");
  // Bright's Rooms page: the sample house's rooms with Bright's fields (its lights, as the Atlas counts them), no presence.
  // Drawn with real waits, not flush(): the shim runs every queued timer at once, which would fire the
  // Atlas registry read's 30 s time-out before the sample house's answer (a few promise hops) arrives.
  const roomsMod = await import(FILE("views/" + VIEW_PATHS.rooms) + "?b=t");
  p.state.view = "rooms";
  let node = null;
  for (let i = 0; i < 6; i++) { node = await roomsMod.render(ctxFor(p)); await new Promise(r => globalThis._realSetTimeout(r, 20)); }
  const rows = all(node, "[data-room]").map(n => n.getAttribute("data-room"));
  expect(rows.length === 22 && rows.includes("Games Room") && !rows.includes("Den"), "Bright Rooms: " + rows.join(", "));
  const living = all(node, "[data-room]").filter(n => n.getAttribute("data-room") === "Living Room").map(n => all(n, "[data-lights]")[0])[0];
  expect(living && /^\d+ lights?, /.test(text(living)), "Bright Rooms: Living Room's lights: " + text(living));
  expect(!all(node, "[data-now]").length && !/See receivers/.test(text(node)), "Bright Rooms shows presence");
  const note = all(node, '[data-rooms-note="sample"]')[0];
  expect(note && /sample house's rooms, shown read-only/.test(text(note)), "Bright Rooms: no sample-house note");
  const bad = forbidden(hass.log);
  expect(!bad.length, "sent to Home Assistant: " + JSON.stringify(bad.map(e => `${e.kind} ${e.type}`)));
});

await run("the house could not load: the small demo house, and writes still refused", async () => {
  failImport = true;
  const { p, hass } = await bootPanel({ data_mode: "sample" });
  failImport = false;
  expect(p.state.live.snapshot === SAMPLE_SNAPSHOT, "not the small demo house");
  let err = null;
  try { await p._callWS({ type: "padspan_ha/model_update" }); } catch (e) { err = e; }
  expect(err && err.code === "sample_mode", "a write went through");
  expect(!hass.log.some(e => e.type === "padspan_ha/model_update"), "the write reached Home Assistant");
});

await run("the website demo's fake Home Assistant (padspan_demo) is asked directly", async () => {
  const hass = realHass({ data_mode: "sample" });
  hass.padspan_demo = true;
  const p = new Panel();
  p.setHass(hass);
  const before = houseImports;
  await p._refreshAll(false);
  expect(p._hass === hass && houseImports === before, "the panel put its own sample house in front of the demo's");
  expect(p.state.live.snapshot === REAL_SNAP && p.state.live.fromSample, "the demo's own snapshot was not used");
});

// ── review follow-ups (M1-M3, L2-L5, theme) ──────────────────────────────────

await run("a Sample-mode page load sends none of the report's queued counts", async () => {
  const hass = realHass({ data_mode: "sample", telemetry_enabled: true, telemetry_asked: true });
  globalThis.localStorage.clear();
  const P = browser(globalThis.localStorage);
  const p = new P();
  // Counts made before the settings arrived wait in the queue (panel.js _telemetryEvent).
  p._telemetryQueue = ["client_screen_seen", "stairs_drawn", "tab:overview"];
  p.setHass(hass);
  await p._refreshAll(false);
  await flush();
  p._telemetryEvent("house3d_mezzanine");
  await flush();
  const sent = hass.log.filter(e => e.type === "padspan_ha/telemetry_event").map(e => e.msg.event);
  expect(p.state.dataMode === "sample", "not in Sample mode");
  expect(!sent.length, "counted from Sample mode: " + sent.join(", "));
  // The same queue on a Live page is sent, as before.
  const live = realHass({ data_mode: "live", telemetry_enabled: true, telemetry_asked: true });
  const q = new P();
  q._telemetryQueue = ["client_screen_seen"];
  q.setHass(live);
  await q._refreshAll(false);
  await flush();
  expect(live.log.some(e => e.type === "padspan_ha/telemetry_event" && e.msg.event === "client_screen_seen"), "a Live page lost its queued count");
});

await run("following in Sample mode never reaches the real follow list, and Live gets its own back", async () => {
  const LS = globalThis.localStorage;
  LS.clear();
  LS.setItem("padspan_followed", JSON.stringify(["IRK:REAL01"]));
  LS.setItem("padspan_followAddr", "irk:real01");
  const server = { data_mode: "live", followed_addrs: ["IRK:REAL01"] };
  const hass = realHass(server);
  const P = browser(LS);
  const p = new P();
  p.state.followedAddrs = new Set(JSON.parse(LS.getItem("padspan_followed")));
  p.state.followAddr = LS.getItem("padspan_followAddr");
  p.setHass(hass);
  await p._refreshAll(false);
  await p._setDataMode("sample");
  await flush();
  // What Follow (views/follow.js) and the Overview do on a click: state and localStorage.
  p.state.followedAddrs.add("DEMO:ALEX_PHONE");
  LS.setItem("padspan_followed", JSON.stringify([...p.state.followedAddrs]));
  p.state.followAddr = "demo:alex_phone";
  LS.setItem("padspan_followAddr", "demo:alex_phone");
  // And the panel's own save of the list: refused in Sample mode.
  let refused = false;
  try { await p._callWS({ type: "padspan_ha/settings_set", followed_addrs: [...p.state.followedAddrs] }); } catch (e) { refused = e.code === "sample_mode"; }
  expect(refused, "the follow list was saved from Sample mode");
  await p._setDataMode("live");
  await flush();
  expect(JSON.stringify(server.followed_addrs) === JSON.stringify(["IRK:REAL01"]), "the server's follow list changed: " + JSON.stringify(server.followed_addrs));
  expect(LS.getItem("padspan_followed") === JSON.stringify(["IRK:REAL01"]) && LS.getItem("padspan_followAddr") === "irk:real01",
    "this browser's follow choices were not given back: " + LS.getItem("padspan_followed") + " / " + LS.getItem("padspan_followAddr"));
  expect([...p.state.followedAddrs].join() === "IRK:REAL01" && p.state.followAddr === "irk:real01", "the panel still follows the sample house");
  expect(LS.getItem("padspan_follow_live") === null, "the kept copy was left behind");
});

await run("the preview is per browser: one screen's Sample never turns another, nor the server", async () => {
  const server = { data_mode: "live" };
  const hass = realHass(server);
  const wall = new (browser(storage()))();      // a wall display
  const phone = new (browser(storage()))();     // someone previewing on a phone
  wall.setHass(hass); phone.setHass(hass);
  await wall._refreshAll(false); await phone._refreshAll(false);
  await phone._setDataMode("sample");
  await flush();
  expect(phone.state.dataMode === "sample" && phone.state.model.room_geometry_m["Games Room"], "the phone is not previewing");
  expect(server.data_mode === "live", "the preview was saved to the server: " + server.data_mode);
  // The wall's 30 s settings re-read, and a full refresh.
  await wall._fetchSettings(); await wall._refreshAll(false);
  expect(wall.state.dataMode === "live" && wall.state.model.room_geometry_m.Den, "the wall display left its own house");
  // Back to Live on the phone: its own choice again; the wall never moved.
  await phone._setDataMode("live");
  expect(phone.state.dataMode === "live" && wall.state.dataMode === "live" && server.data_mode === "live", "modes after the switch back");
});

await run("no choice yet: the server's Sample from before is kept on load, and only a turn to Live follows later", async () => {
  const server = { data_mode: "sample" };
  const hass = realHass(server);
  const store = storage();
  const P = browser(store);
  const a = new P();
  a.setHass(hass);
  await a._refreshAll(false);
  expect(a.state.dataMode === "sample", "a house still in Sample from before did not open in Sample");
  // Another screen (an older panel, onboarding.py's first scanner) turns the server to Live: followed.
  server.data_mode = "live";
  await a._fetchSettings();
  expect(a.state.dataMode === "live", "the server's turn to Live was not followed");
  // ... and back to sample: not followed (no screen can push another into the preview).
  server.data_mode = "sample";
  await a._fetchSettings();
  expect(a.state.dataMode === "live", "the server's Sample flipped this screen");
  // A browser that chose: the server is not followed either way.
  const b = new (browser(storage({ padspan_data_mode: "sample" })))();
  b.setHass(realHass({ data_mode: "live" }));
  await b._refreshAll(false);
  expect(b.state.dataMode === "sample", "this browser's own Sample choice was overruled by the server");
});

await run("theme and look changes go through in Sample mode; other settings do not", async () => {
  const { p, hass } = await bootPanel({ data_mode: "sample" });
  const n = hass.log.length;
  for (const payload of [{ theme_palette: "ocean" }, { light_theme: true }, { day_theme: false }, { theme_follow_sun: true }, { ui_skin: "2025" }]) {
    await p._callWS({ type: "padspan_ha/settings_set", ...payload });
  }
  expect(hass.log.length - n === 5 && hass.log.slice(n).every(e => e.type === "padspan_ha/settings_set"), "a look change was refused");
  let err = null;
  try { await p._callWS({ type: "padspan_ha/settings_set", theme_palette: "ocean", presence_poll_interval_s: 2 }); } catch (e) { err = e; }
  expect(err && err.code === "sample_mode", "a look change carrying another setting went through");
  try { err = null; await p._callWS({ type: "padspan_ha/settings_set", data_mode: "sample" }); } catch (e) { err = e; }
  expect(err && err.code === "sample_mode", "Sample was saved to the server");
});

await run("reads that look like actions are answered empty, without the refusal", async () => {
  const { p, hass } = await bootPanel({ data_mode: "sample" });
  const n = hass.log.length, t = p.toasts.length;
  for (const m of [{ type: "history/history_during_period", entity_ids: ["light.x"] }, { type: "padspan_ha/house3d_from_photo", target: "furniture" },
                   { type: "padspan_ha/vacuum_import_preview" }, { type: "padspan_ha/irk_validate", irk: "x" }, { type: "padspan_ha/companion_discover" }]) {
    const r = await p._callWS(m);
    expect(r && typeof r === "object", m.type + " got no answer");
  }
  expect(hass.log.length === n && p.toasts.length === t, "a read reached Home Assistant or popped the refusal");
  let err = null;
  try { await p._callWS({ type: "padspan_ha/house3d_from_photo", target: "furniture", photo: "data:," }); } catch (e) { err = e; }
  expect(err && err.code === "sample_mode", "a photo was sent for the real house from Sample mode");
});

await run("the sample house's settings: no real Vacation Mode, even in what the Atlas reads", async () => {
  const server = { data_mode: "sample", vacation_mode_enabled: true, flood_latches: { "binary_sensor.real_leak": { triggered_at: 1 } }, theme_palette: "ocean" };
  const { p } = await bootPanel(server);
  expect(p.state.settings.vacation_mode_enabled === false, "the panel holds the real house's Vacation Mode");
  expect(p.state.settings.theme_palette === "ocean", "the look settings were lost");
  const r = await p._hass.callWS({ type: "padspan_ha/settings_get" });   // the embedded Atlas's own read
  expect(r.settings.vacation_mode_enabled === false, "the Atlas reads the real Vacation Mode");
});

await run("after the switch back, a view still holding the sample hass talks to the real house", async () => {
  const { p, hass } = await bootPanel({ data_mode: "sample" });
  const held = p._hass;
  await p._setDataMode("live");
  const n = hass.log.length;
  await held.callService("light", "turn_on", { entity_id: "light.real_den" });
  await held.callApi("POST", "services/script/reload", {});
  const r = await held.callWS({ type: "padspan_ha/model_get" });
  expect(hass.log.slice(n).map(e => e.kind).join() === "callService,callApi,callWS" && r.room_geometry_m.Den, "the held copy still refused or answered from the sample house");
  expect(p.state._modelLoaded === true && p.state.model.room_geometry_m.Den, "the real model did not reload");
});

// ── second review ────────────────────────────────────────────────────────────

await run("Back to my house refused (Enhanced security, no admin) or unanswered: the screen stays in Sample and says why", async () => {
  for (const [why, fail] of [["admin_only", () => { throw { code: "admin_only", message: "Only an admin can change this" }; }],
                             ["no answer", () => { throw { code: 3, message: "Connection lost" }; }]]) {
    const server = { data_mode: "sample" };
    const hass = realHass(server);
    const store = storage({ padspan_data_mode: "sample" });
    const p = new (browser(store))();
    p.setHass(hass);
    await p._refreshAll(false);
    const answer = hass.callWS;
    hass.callWS = (m) => m && m.type === "padspan_ha/settings_set" ? Promise.resolve().then(fail) : answer(m);
    await p._setDataMode("live");
    expect(p.state.dataMode === "sample" && store.getItem("padspan_data_mode") === "sample", `${why}: the screen went Live over a server in Sample`);
    expect(server.data_mode === "sample", `${why}: the server changed`);
    const said = p.toasts[p.toasts.length - 1] || "";
    expect(why === "admin_only" ? /Ask an admin/.test(said) : /didn't answer/.test(said), `${why}: said ${said}`);
  }
  // The server already Live (a preview never changes it): no request, straight back.
  const server = { data_mode: "live" };
  const hass = realHass(server);
  const store = storage({ padspan_data_mode: "sample" });
  const p = new (browser(store))();
  p.setHass(hass);
  await p._refreshAll(false);
  const n = hass.log.filter(e => e.type === "padspan_ha/settings_set").length;
  await p._setDataMode("live");
  expect(p.state.dataMode === "live" && store.getItem("padspan_data_mode") === "live", "did not go back to Live");
  expect(hass.log.filter(e => e.type === "padspan_ha/settings_set").length === n, "asked the server for what it already had");
});

await run("a real flood alarm still shows in Sample mode, with the way back instead of Reset", async () => {
  const soon = Date.now() / 1000 + 3600;
  const server = { data_mode: "sample", flood_latches: { "binary_sensor.real_leak": { triggered_at: 1, expires_at: soon } } };
  const { p, hass } = await bootPanel(server);
  hass.states["binary_sensor.real_leak"] = { state: "on", attributes: { friendly_name: "Laundry leak" } };
  expect(p.state.settings.flood_latches["binary_sensor.real_leak"], "Sample mode hid the real flood latch");
  const r = await p._hass.callWS({ type: "padspan_ha/settings_get" });
  expect(r.settings.flood_latches["binary_sensor.real_leak"], "the embedded Atlas lost the real flood latch");
  const els = {};
  for (const id of ["#emergencyBanner", "#emergencyBannerCount", "#emergencyBannerList", "#mobileEmergencyPill"]) els[id] = document.createElement("div");
  els["#emergencyBanner"].classList.add("hidden");
  p.$ = (sel) => els[sel] || null;
  p._updateEmergencyBanner();
  const list = els["#emergencyBannerList"];
  expect(!els["#emergencyBanner"].classList.contains("hidden"), "the banner is hidden");
  expect(/Laundry leak/.test(list.textContent), "the alarm's real name is missing: " + list.textContent);
  const buttons = [...list.querySelectorAll("button")].map(b => b.textContent);
  expect(buttons.join() === "Back to my house", "buttons: " + buttons.join());
});

await run("the preview's own counts: opened from Live and back, and nothing in between", async () => {
  const server = { data_mode: "live", telemetry_enabled: true, telemetry_asked: true };
  const { p, hass } = await bootPanel(server);
  const n = hass.log.length;
  await p._setDataMode("sample");
  for (const id of ["overview", "rooms", "calibration"]) await renderView(p, id);
  p._telemetryEvent("tab:rooms");
  await p._setDataMode("live");
  await flush();
  const sent = hass.log.slice(n).filter(e => e.type === "padspan_ha/telemetry_event").map(e => e.msg.event);
  expect(sent[0] === "preview_open" && sent.indexOf("preview_back") > 0, "the preview's counts: " + sent.join(", "));
  expect(!sent.slice(1, sent.indexOf("preview_back")).length, "counted from Sample mode: " + sent.slice(1, sent.indexOf("preview_back")).join(", "));
});

await run("a screen with no choice follows another screen's Back to my house within 30 s", async () => {
  const server = { data_mode: "sample" };
  const hass = realHass(server);
  const p = new (browser(storage()))();
  p.setHass(hass);
  await p._refreshAll(false);
  expect(p.state.dataMode === "sample", "did not open in Sample");
  server.data_mode = "live";                    // another screen pressed Back to my house
  p._settingsPollTs = Date.now() - 31000;
  await p._sampleSettingsTick();
  await flush();
  expect(p.state.dataMode === "live" && p.state.model.room_geometry_m.Den, "did not follow to Live with the real house");
});

await run("back to Live with the settings read failing: the real settings, not the sample copy", async () => {
  const server = { data_mode: "live", hidden_map_ids: ["real_plan_old"], scanner_offsets: { "real-proxy-den": 3 } };
  const hass = realHass(server);
  const p = new (browser(storage({ padspan_data_mode: "sample" })))();
  p.setHass(hass);
  await p._refreshAll(false);
  expect(JSON.stringify(p.state.settings.hidden_map_ids) === "[]", "the sample copy is not in use");
  const answer = hass.callWS;
  hass.callWS = (m) => m && m.type === "padspan_ha/settings_get" ? Promise.reject({ code: 3, message: "Connection lost" }) : answer(m);
  // The settings read retries after a timer (the shim's queue): run it along.
  let done = false;
  const going = p._setDataMode("live").finally(() => { done = true; });
  for (let i = 0; i < 50 && !done; i++) await flush();
  await going;
  expect(p.state.dataMode === "live", "not Live");
  expect(JSON.stringify(p.state.settings.hidden_map_ids) === '["real_plan_old"]' && p.state.settings.scanner_offsets["real-proxy-den"] === 3,
    "the sample copy's blanks are what a Live save would send: " + JSON.stringify(p.state.settings.hidden_map_ids));
});

console.log(JSON.stringify({ cases }));
