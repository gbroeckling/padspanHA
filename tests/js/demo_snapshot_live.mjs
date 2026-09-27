// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
//
// #88: the demo house's radios under a "Live" badge, RUN rather than read.
//
// A reporter on a live install opened Guided Calibration and was shown
// Living Room Hub / Bedroom Hub / Kitchen Hub — sample_data.js's demo radios —
// while the top bar read "Live", and was told "Switch to Live mode" while
// already in it. Mechanism: panel.js starts with dataMode "sample"; a failed
// first settings fetch left that default in place, _getLiveSnapshot read it as
// a real Sample answer and assigned SAMPLE_SNAPSHOT; the later successful
// settings fetch flipped the badge to Live without evicting it, and every
// failed live_snapshot kept it. Placing one of those demo radios and pressing
// Save then wrote a phantom scanner into the real model.
//
// Part A lifts the real data-mode / snapshot methods out of panel.js (same
// text extraction as poll_settings_throttle.mjs) and drives them against a
// fake websocket. Part B imports the real calibration.js under dom_shim.mjs,
// renders Guided Calibration step 1 (the Tune tab) and clicks it. Part C
// renders the real overview.js while the mode is still unknown.
//
// Follow-up: while the server has not said which mode (every settings_get so
// far failed), the top bar read "Sample" over an empty screen, and nothing
// re-asked on a page nobody touches (a wall kiosk). The real _updateBadges
// runs here against the badge text the panel.js HTML starts with, and the
// watchdog's re-ask (_retryDataMode) is driven to recovery.
//
// Run:  node tests/js/demo_snapshot_live.mjs <www/padspan-ha dir>
// Prints "ok"/"FAIL" per case, then one JSON line {"cases": {...}}.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const WWW = process.argv[2];
if (!WWW) { console.error("usage: demo_snapshot_live.mjs <www/padspan-ha dir>"); process.exit(2); }

const { SAMPLE_SNAPSHOT } = await import(pathToFileURL(join(WWW, "sample_data.js")).href);
const DEMO_NAMES = SAMPLE_SNAPSHOT.ble.radios.map(r => r.name);   // Living Room Hub, ...

const cases = {};
async function run(label, check) {
  try { await check(); cases[label] = { ok: true }; }
  catch (e) { cases[label] = { ok: false, detail: String(e && e.message || e) }; }
}
function expect(cond, msg) { if (!cond) throw new Error(msg); }

// ── Part A: panel.js ─────────────────────────────────────────────────────────

const src = readFileSync(join(WWW, "panel.js"), "utf8");

/** Source of a class method `name(...)`, optionally `async`; null if absent. */
function extractMethod(name) {
  const re = new RegExp(`^\\s{2}(?:async\\s+)?${name}\\s*\\(`, "m");
  const m = re.exec(src);
  if (!m) return null;
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
  throw new Error(`unbalanced braces reading ${name}()`);
}

const REQUIRED = ["_wsCount", "_logEvent", "_callWS", "_fetchSettings", "_loadSettings",
  "_setDataMode", "_recomputeDerived", "_getRoomTags", "_getLiveSnapshot", "_refreshAll", "_pollTick",
  "_updateBadges"];
// The fixes' own methods: taken when they exist, so this same harness also
// runs (and fails) against the pre-fix panel.js.
const OPTIONAL = ["_applyDataMode", "_dataModeLabel", "_retryDataMode", "_onDataModeClick", "_paintDataModeLabel"];
const bodies = [];
for (const n of REQUIRED) {
  const b = extractMethod(n);
  if (!b) throw new Error(`could not find method ${n}() in panel.js — renamed? update this test`);
  bodies.push(b);
}
for (const n of OPTIONAL) { const b = extractMethod(n); if (b) bodies.push(b); }

/** The text a panel.js HTML button starts with, by id. */
function initialText(id) {
  const m = new RegExp(`id="${id}"[^>]*>([^<]*)<`).exec(src);
  if (!m) throw new Error(`#${id} not found in panel.js HTML — renamed? update this test`);
  return m[1];
}
const BADGE_HTML = initialText("dataModeToggle");
const PILL_HTML = initialText("mobileDataPill");

// eslint-disable-next-line no-new-func
const Panel = new Function("SAMPLE_SNAPSHOT", "BADGE_HTML", `return class Panel {
  constructor(hass){
    this._hass = hass;
    // The constructor's own default: dataMode "sample" before settings land.
    this.state = {
      dataMode: "sample", view: "calibration", settings: null,
      live: { snapshot: null, sources: null, error: null },
      maps: { list: [{ id: "ground" }] }, model: { floors: [{ id: "main" }] },
      timing: {}, wsCounts: {}, _sessionEvents: [], roomTagMap: {}, savedRoomTagMap: {},
    };
    this.state.complexity = "advanced";
    // The top-bar elements the real _updateBadges writes; the data toggle
    // starts with the panel.js HTML's own text.
    this._els = {};
    for (const id of ["#scanBadge", "#statusBadge", "#cloudBadge", "#dataModeToggle", "#complexityToggle"])
      this._els[id] = { textContent: "", style: {} };
    this._els["#dataModeToggle"].textContent = BADGE_HTML;
    this.toasts = [];
    this.polls = 0;
  }
  get badge(){ return this._els["#dataModeToggle"].textContent; }
  $(sel){ return this._els[sel] || null; }
  _toast(m){ this.toasts.push(String(m)); }
  _updateEmergencyBanner(){}
  _scheduleRender(){} _applyTheme(){} _applySkin(){} _renderNav(){} _telemetryFlush(){}
  _startPolling(){} _stopPolling(){} _startDataPoll(){ this.polls++; this._pollTimer = 1; }
  async _getMapsList(){} async _getModel(){} async _getStatus(){} async _getVersionInfo(){}
  async _runAutoDiag(){} async _loadAlertConfigs(){}
${bodies.join("\n\n")}
}`)(SAMPLE_SNAPSHOT, BADGE_HTML);

// A live snapshot as snapshot_builder.py builds it (source:"live").
const REAL = { source: "live", ble: { radios: [
  { source: "aa:bb:cc:00:00:01", name: "proxy-den", area_name: "Den" },
  { source: "aa:bb:cc:00:00:02", name: "proxy-bed", area_name: "Bedroom" } ], advertisements: [] } };

// behaviour per WS type: "ok" | "fail" | fn(msg) => result
function fakeHass(beh, server = { data_mode: "live" }) {
  return {
    callWS: async (msg) => {
      const b = beh[msg.type] ?? "ok";
      if (b === "fail") throw { code: 3, message: "Connection lost" };
      if (typeof b === "function") return b(msg);
      switch (msg.type) {
        case "padspan_ha/settings_get": return { settings: { data_mode: server.data_mode } };
        case "padspan_ha/settings_set": server.data_mode = msg.data_mode; return { settings: { data_mode: server.data_mode } };
        case "padspan_ha/live_snapshot": return { snapshot: REAL };
        default: return {};
      }
    },
  };
}

const radioNames = (p) => ((p.state.live.snapshot || {}).ble?.radios || []).map(r => r.name);
const demoOnScreen = (p) => p.state.live.snapshot === SAMPLE_SNAPSHOT
  || radioNames(p).some(n => DEMO_NAMES.includes(n));
function noDemoUnderLive(p, when) {
  expect(p.badge === "Live" && p.state.dataMode === "live", `${when}: expected the Live badge, got ${p.badge}`);
  expect(!demoOnScreen(p), `${when}: badge reads Live over the demo radios ${JSON.stringify(radioNames(p))}`);
}
async function tick(p) { p._pollInFlight = false; p._settingsPollTs = Date.now(); await p._pollTick(); }

let condCState = null;

await run("normal path: settings and live_snapshot succeed -> Live with the real radios", async () => {
  const p = new Panel(fakeHass({}));
  await p._refreshAll(false);
  noDemoUnderLive(p, "after refresh");
  expect(p.state.live.snapshot === REAL, "the live snapshot did not land");
});

await run("unknown mode (settings_get failed twice) shows no demo data", async () => {
  const p = new Panel(fakeHass({ "padspan_ha/settings_get": "fail", "padspan_ha/live_snapshot": "fail" }));
  await p._refreshAll(false);
  expect(!demoOnScreen(p), "the constructor's 'sample' default was taken as the server's answer: demo radios on screen");
});

await run("condition C: settings fail then succeed, live_snapshot failing -> Live with NO demo radios", async () => {
  const beh = { "padspan_ha/settings_get": "fail", "padspan_ha/live_snapshot": "fail" };
  const p = new Panel(fakeHass(beh));
  await p._refreshAll(false);                  // boot: settings fail twice
  beh["padspan_ha/settings_get"] = "ok";
  await p._refreshAll(false);                  // wake-up / focus / sidebar re-entry
  // What is on screen at this moment, for the wizard case below — copied,
  // the polls move on.
  condCState = { dataMode: p.state.dataMode, _dataModeKnown: p.state._dataModeKnown,
    live: { snapshot: p.state.live.snapshot } };
  noDemoUnderLive(p, "after the wake-up refresh");
  for (let i = 0; i < 3; i++) await tick(p);   // live polls, live_snapshot still failing
  noDemoUnderLive(p, "after 3 failing live polls");
  beh["padspan_ha/live_snapshot"] = "ok";
  await tick(p);
  expect(p.state.live.snapshot === REAL, "the first successful live_snapshot did not replace it");
});

await run("condition C2: only _loadSettings lands the live mode -> Live with NO demo radios", async () => {
  const beh = { "padspan_ha/settings_get": "fail", "padspan_ha/live_snapshot": "fail" };
  const p = new Panel(fakeHass(beh));
  await p._refreshAll(false);
  beh["padspan_ha/settings_get"] = "ok";
  await p._loadSettings();                     // connectedCallback / radioReset / scannerOffsetSet path
  noDemoUnderLive(p, "after _loadSettings");
});

await run("deliberate switch to Sample still shows the demo; switching back evicts it", async () => {
  const p = new Panel(fakeHass({ "padspan_ha/live_snapshot": "fail" }));
  await p._refreshAll(false);
  await p._setDataMode("sample");              // the toggle's own handler
  expect(p.badge === "Sample" && p.state.live.snapshot === SAMPLE_SNAPSHOT,
    `Sample mode lost its demo: badge=${p.badge}`);
  expect(p.toasts.includes("Data mode: SAMPLE"), `no mode toast: ${JSON.stringify(p.toasts)}`);
  await p._setDataMode("live");
  noDemoUnderLive(p, "after switching back to Live");
});

await run("a Sample-mode install (server data_mode=sample) shows the demo", async () => {
  const p = new Panel(fakeHass({}, { data_mode: "sample" }));
  await p._refreshAll(false);
  expect(p.badge === "Sample" && p.state.live.snapshot === SAMPLE_SNAPSHOT,
    `expected the demo snapshot under Sample, got badge=${p.badge}`);
});

const MODE_WORDS = ["Live", "Sample"];

await run("badge: before the server answers, neither the top bar nor the mobile pill claims Live or Sample", async () => {
  expect(!MODE_WORDS.includes(BADGE_HTML.trim()), `#dataModeToggle starts as "${BADGE_HTML}"`);
  expect(!MODE_WORDS.includes(PILL_HTML.trim()), `#mobileDataPill starts as "${PILL_HTML}"`);
});

await run("badge: unknown mode (settings_get failed twice) claims neither Live nor Sample", async () => {
  const p = new Panel(fakeHass({ "padspan_ha/settings_get": "fail", "padspan_ha/live_snapshot": "fail" }));
  await p._refreshAll(false);
  expect(!p.state._dataModeKnown, "harness: the mode should still be unknown");
  expect(!MODE_WORDS.includes(p.badge), `the top bar reads "${p.badge}" while the mode is unknown`);
});

await run("badge: the mobile pill uses the same label as the top bar", async () => {
  const nav = extractMethod("_renderNav");
  expect(nav && /mobileDataPill\.textContent\s*=\s*this\._dataModeLabel\(\)/.test(nav),
    "_renderNav writes its own Live/Sample guess into #mobileDataPill");
});

await run("unknown mode is asked again: once HA answers, the watchdog's retry lands Live with the real radios", async () => {
  const keepAlive = extractMethod("_startKeepAlive");
  expect(keepAlive && /this\._retryDataMode\(\)/.test(keepAlive), "the watchdog never re-asks for the data mode");
  const beh = { "padspan_ha/settings_get": "fail", "padspan_ha/live_snapshot": "fail" };
  const p = new Panel(fakeHass(beh));
  await p._refreshAll(false);
  expect(typeof p._retryDataMode === "function", "no _retryDataMode()");
  // Still down: the retry fails quietly and can run again.
  p._retryDataMode();
  await new Promise(r => setTimeout(r, 1000));
  expect(!p.state._dataModeKnown && !p._modeRetry, "a failed retry left the mode known or the retry stuck in flight");
  beh["padspan_ha/settings_get"] = "ok"; beh["padspan_ha/live_snapshot"] = "ok";
  p._retryDataMode();
  p._retryDataMode();                          // a second tick while the first is in flight: no-op
  await new Promise(r => setTimeout(r, 50));
  noDemoUnderLive(p, "after the retry");
  expect(p.state.live.snapshot === REAL, "the retry did not bring the live snapshot");
  expect(p.polls === 1, `the live poll was started ${p.polls} times`);
  // Known now: further ticks ask nothing.
  let calls = 0; const orig = p._hass.callWS; p._hass.callWS = (m) => { calls++; return orig(m); };
  p._retryDataMode();
  await new Promise(r => setTimeout(r, 20));
  expect(calls === 0, `the retry kept asking after the mode was known (${calls} calls)`);
});

await run("badge: a known mode still reads Live / Sample", async () => {
  const pl = new Panel(fakeHass({}));
  await pl._refreshAll(false);
  expect(pl.badge === "Live", `Live install reads "${pl.badge}"`);
  const ps = new Panel(fakeHass({}, { data_mode: "sample" }));
  await ps._refreshAll(false);
  expect(ps.badge === "Sample", `Sample install reads "${ps.badge}"`);
});

// ── Part B: calibration.js (Guided Calibration step 1 = the Tune tab) ────────
// Installed only now: the shim queues setTimeout, which Part A's retry and
// poll timeout need to be real.

const { install, flush } = await import(new URL("./dom_shim.mjs", import.meta.url).href);
install(globalThis);
const calib = await import(pathToFileURL(join(WWW, "views", "calibration.js")).href);

function recorder() {
  const fn = () => document.createElement("span");
  return new Proxy(fn, {
    get(_t, k) {
      if (k === Symbol.toPrimitive || k === "toString") return () => "";
      if (k === "then") return undefined;
      return recorder();
    },
    apply() { return fn(); },
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

const MAPS = [{
  id: "ground", name: "Ground.png", floor_id: "main",
  image: { width: 1000, height: 710 },
  stack: { scale: 1, scale_x_adj: 1, ref_ar: 0.71, rotation: 0, x_offset: 0, y_offset: 0, z_level: 0, floor_id: "main" },
  receivers: [{ id: "r1", source: "AA:01", label: "Kitchen", x: 0.4, y: 0.5 }],
  rooms: [], rf_barriers: [],
}];
const MODEL = {
  floors: [{ id: "main", name: "Main", level: 0 }],
  scanner_positions_m: { "AA:01": { x_m: 2, y_m: 4, z_m: 2.4, floor_id: "main" } },
  map_transforms: { ground: { origin_x_m: 0, origin_y_m: 0, scale_x_m: 20, scale_y_m: 14.2,
    rotation_rad: 0, shear_rad: 0, floor_id: "main" } },
};
const LIVE_SNAP = { source: "live", ble: { radios: [
  { source: "AA:01", name: "kitchen-esp", area_name: "Kitchen" },
  { source: "AA:03", name: "hall-esp", area_name: "Hall" } ], advertisements: [] } };

/** Render step 1 for a panel state; returns what a test needs to look at and click. */
async function renderTune(stateOver) {
  const calls = [], toasts = [], made = [];
  const state = Object.assign({
    view: "calibration", _calibWizard: { step: 1 },
    calibration: { points: [], model: {} },
    maps: { list: structuredClone(MAPS) }, model: structuredClone(MODEL), settings: {},
  }, stateOver);
  const helpers = { el, esc: (s) => String(s ?? ""), roomColor: () => "#52b788",
    scannerStatus: () => ({ label: "scanning", cls: "badge", title: "" }),
    isScanner: () => false, scannerAddrs: () => new Set(), radioShortId: (s) => String(s || "").slice(-3),
    helpBtn: () => el("button", {}, "?"), HELP: {} };
  const actions = {
    callWS: async (p) => { calls.push(p); return { ok: true }; },
    wsCall: async (type, data) => { calls.push({ type, ...(data || {}) }); return { ok: true }; },
    radioResetQuiet: async (source) => { calls.push({ type: "padspan_ha/radio_reset", source }); return {}; },
    mapsRefresh: async () => {}, modelRefresh: async () => {}, renderRooms: () => {},
  };
  const ctx = {
    state,
    helpers: new Proxy(helpers, { get: (t, k) => (k in t ? t[k] : recorder()) }),
    actions: new Proxy(actions, { get: (t, k) => (k in t ? t[k] : recorder()) }),
    toast: (m) => { toasts.push(String(m)); },
  };
  const realCreate = document.createElement;
  document.createElement = (t) => { const n = realCreate(t); made.push(n); return n; };
  try { calib.render(ctx); await flush(); }
  finally { document.createElement = realCreate; }
  const radiosCard = made.find(n => n.className === "card" && /^Live Radios \(\d+\)/.test(n.textContent));
  if (!radiosCard) throw new Error("the Tune tab rendered no Live Radios card");
  const rowFor = (label) => {
    const span = made.find(n => n.tagName === "SPAN" && n.textContent === label);
    return span ? span.parentNode : null;
  };
  const saveBtn = made.find(n => n.tagName === "BUTTON" && n.title === "Save updated receiver positions to all modified maps");
  const settle = async () => { for (let i = 0; i < 6; i++) { await flush(); await new Promise(r => globalThis._realSetTimeout(r, 0)); } };
  return { ctx, calls, toasts, made, radiosCard, rowFor, saveBtn, settle, ts: () => state._calibTune };
}

const WAITING = "Waiting for live data from Home Assistant";
const NO_SCANNERS = "Home Assistant isn't reporting any Bluetooth scanners yet";
const SWITCH = "Switch to Live mode";

await run("wizard: Live with no snapshot yet says it is waiting, not 'Switch to Live mode'", async () => {
  const r = await renderTune({ dataMode: "live", _dataModeKnown: true, live: { snapshot: null } });
  const t = r.radiosCard.textContent;
  expect(t.includes(WAITING) && !t.includes(SWITCH), `got: ${t}`);
});

await run("wizard: a live snapshot with no radios says HA reports no scanners", async () => {
  const r = await renderTune({ dataMode: "live", _dataModeKnown: true,
    live: { snapshot: { source: "live", ble: { radios: [], advertisements: [] } } } });
  const t = r.radiosCard.textContent;
  expect(t.includes(NO_SCANNERS) && !t.includes(SWITCH), `got: ${t}`);
});

await run("wizard: mode not known yet says it is waiting, not 'Switch to Live mode'", async () => {
  const r = await renderTune({ dataMode: "sample", live: { snapshot: null } });
  const t = r.radiosCard.textContent;
  expect(t.includes(WAITING) && !t.includes(SWITCH), `got: ${t}`);
});

await run("wizard: 'Switch to Live mode' still shows in a real Sample mode", async () => {
  const r = await renderTune({ dataMode: "sample", _dataModeKnown: true,
    live: { snapshot: { source: "sample", ble: { radios: [], advertisements: [] } } } });
  expect(r.radiosCard.textContent.includes(SWITCH), `got: ${r.radiosCard.textContent}`);
});

await run("wizard: condition C's panel state lists no demo radios under Live", async () => {
  expect(condCState, "condition C did not run");
  const r = await renderTune({ dataMode: condCState.dataMode, _dataModeKnown: condCState._dataModeKnown,
    live: { snapshot: condCState.live.snapshot } });
  const t = r.radiosCard.textContent;
  for (const n of DEMO_NAMES) expect(!t.includes(n), `demo radio "${n}" listed as a Live radio: ${t}`);
  expect(t.includes(WAITING), `got: ${t}`);
});

await run("Sample mode still renders the demo radios in the list", async () => {
  const r = await renderTune({ dataMode: "sample", _dataModeKnown: true, live: { snapshot: SAMPLE_SNAPSHOT } });
  for (const n of DEMO_NAMES) expect(r.radiosCard.textContent.includes(n), `demo radio "${n}" missing in Sample mode`);
});

await run("placing a demo radio is refused (no pending placement, no Delete)", async () => {
  const r = await renderTune({ dataMode: "sample", _dataModeKnown: true, live: { snapshot: SAMPLE_SNAPSHOT } });
  const d = SAMPLE_SNAPSHOT.ble.radios[0];
  const row = r.rowFor(`${d.name} (${d.area_name})`);
  expect(row, "demo radio row not found");
  row.click();
  expect(!r.ts().pendingPlace, `demo radio armed for placement: ${JSON.stringify(r.ts().pendingPlace)}`);
  expect(r.toasts.some(t => t.includes("Live mode")), `no refusal toast: ${JSON.stringify(r.toasts)}`);
  const del = row.children.flatMap(c => c.children || []).find(b => b.tagName === "BUTTON" && b.textContent === "Delete");
  expect(!del, "a demo radio row offers Delete (radio_reset on the real model)");
});

await run("saving a placed demo radio is refused (no fabric write)", async () => {
  const r = await renderTune({ dataMode: "sample", _dataModeKnown: true, live: { snapshot: SAMPLE_SNAPSHOT } });
  const ts = r.ts();
  const d = SAMPLE_SNAPSHOT.ble.radios[0];
  ts.draftReceivers.ground.push({ id: "rx_demo", label: d.name, x: 0.5, y: 0.5, room: "", source: d.source });
  ts.dirtyMaps.ground = true;
  ts._tuneRev = (ts._tuneRev || 0) + 1;
  expect(r.saveBtn, "Save button not found");
  r.saveBtn.click();
  await r.settle();
  const writes = r.calls.filter(c => c.type === "padspan_ha/fabric_scanner_position_set");
  expect(!writes.length, `demo radio written to the real model: ${JSON.stringify(writes)}`);
});

await run("control: with live data, placing and saving a real radio still works", async () => {
  const r = await renderTune({ dataMode: "live", _dataModeKnown: true, live: { snapshot: LIVE_SNAP } });
  const row = r.rowFor("hall-esp (Hall)");
  expect(row, "live radio row not found");
  row.click();
  expect(r.ts().pendingPlace && r.ts().pendingPlace.source === "AA:03",
    `real radio not armed for placement: ${JSON.stringify(r.ts().pendingPlace)} ${JSON.stringify(r.toasts)}`);
  const ts = r.ts();
  ts.pendingPlace = null;
  ts.draftReceivers.ground.push({ id: "rx_hall", label: "hall-esp", x: 0.5, y: 0.5, room: "", source: "AA:03" });
  ts.dirtyMaps.ground = true;
  ts._tuneRev = (ts._tuneRev || 0) + 1;
  r.saveBtn.click();
  await r.settle();
  const writes = r.calls.filter(c => c.type === "padspan_ha/fabric_scanner_position_set");
  expect(writes.some(w => w.source === "AA:03"), `the real radio was not saved: ${JSON.stringify(r.calls)} ${JSON.stringify(r.toasts)}`);
});

// ── Guided Calibration's capture (Pin & Listen): demo radios never recorded ──
// The same #88 class as Tune: the capture loop records from the snapshot on
// screen, so Sample mode recorded the demo house's radios and Save Point
// stored them as real calibration readings.

// "Alice's iPhone" in sample_data.js: heard by living_room_hub and bedroom_hub.
const DEMO_DEVICE = "irk:aabbccddeeff00112233445566778899";
const DEMO_SOURCES = new Set(SAMPLE_SNAPSHOT.ble.radios.map(r => r.source));

/** Render the Pin & Listen tab with a pin dropped; `onRefresh(state)` runs
 *  on every refreshSnapshot the capture loop makes. */
async function renderPin(stateOver, onRefresh) {
  const calls = [], toasts = [], made = [];
  const state = Object.assign({
    view: "calibration",
    _calib: { tab: "pin", deviceId: DEMO_DEVICE, deviceLabel: "Alice's iPhone", mapId: "ground",
      duration: 1, pinX: 0.5, pinY: 0.5, pinRoom: "Kitchen", pinLabel: "", collecting: false,
      stopFlag: false, readings: null, savedThisSession: 0 },
    calibration: { points: [], model: {} },
    // Pin & Listen needs a floor-plan image to pin on.
    maps: { list: structuredClone(MAPS).map(m => ({ ...m, image: { ...m.image, filename: `${m.id}.png` } })) },
    model: structuredClone(MODEL), settings: {},
  }, stateOver);
  const helpers = { el, esc: (s) => String(s ?? ""), roomColor: () => "#52b788",
    scannerStatus: () => ({ label: "scanning", cls: "badge", title: "" }),
    isScanner: () => false, scannerAddrs: () => new Set(), radioShortId: (s) => String(s || "").slice(-3),
    helpBtn: () => el("button", {}, "?"), HELP: {} };
  const actions = {
    callWS: async (p) => { calls.push(p); return { ok: true }; },
    wsCall: async (type, data) => { calls.push({ type, ...(data || {}) }); return { ok: true }; },
    refreshSnapshot: async () => { if (onRefresh) onRefresh(state); },
    refreshSnapshotQuiet: async () => { if (onRefresh) onRefresh(state); },
    calibrationSavePoint: async (point) => { calls.push({ type: "padspan_ha/calibration_save_point", point }); return { ok: true }; },
    calibrationGet: async () => ({ points: [], model: {} }),
    renderRooms: () => {},
  };
  const ctx = {
    state,
    helpers: new Proxy(helpers, { get: (t, k) => (k in t ? t[k] : recorder()) }),
    actions: new Proxy(actions, { get: (t, k) => (k in t ? t[k] : recorder()) }),
    toast: (m) => { toasts.push(String(m)); },
  };
  const realCreate = document.createElement;
  document.createElement = (t) => { const n = realCreate(t); made.push(n); return n; };
  try { calib.render(ctx); await flush(); }
  finally { document.createElement = realCreate; }
  const startBtn = made.find(n => n.tagName === "BUTTON" && /Start Collecting/.test(n.textContent));
  if (!startBtn) throw new Error("the Pin & Listen tab rendered no Start Collecting button");
  // The capture loop polls on setTimeout(POLL_MS) and stops on Date.now():
  // run the queued timers until it has finished (duration 1 s).
  const finish = async () => {
    const until = Date.now() + 3000;
    while (state._calib.collecting && Date.now() < until) {
      await flush();
      await new Promise(r => globalThis._realSetTimeout(r, 50));
    }
  };
  return { state, calls, toasts, startBtn, finish, cs: () => state._calib };
}

const recordedDemo = (cs) => Object.keys(cs.readings || {}).filter(s => DEMO_SOURCES.has(s));

await run("Guided Calibration in Sample mode records no demo radios (Start refuses and says why)", async () => {
  const r = await renderPin({ dataMode: "sample", _dataModeKnown: true, live: { snapshot: SAMPLE_SNAPSHOT } },
    (st) => { st.live.snapshot = SAMPLE_SNAPSHOT; });
  r.startBtn.click();
  await r.finish();
  expect(!recordedDemo(r.cs()).length, `demo radios recorded: ${JSON.stringify(Object.keys(r.cs().readings || {}))}`);
  expect(r.toasts.some(t => t.includes("Live mode")), `no reason given: ${JSON.stringify(r.toasts)}`);
});

await run("Guided Calibration: a switch to Sample mid-capture records no demo radios", async () => {
  // Starts in Live on the real radios; the first refresh lands the demo
  // snapshot (the user flipped the top-bar toggle to Sample).
  const LIVE_WITH_DEVICE = { source: "live", objects: { list: [] }, ble: {
    radios: LIVE_SNAP.ble.radios, advertisements: [] } };
  const r = await renderPin({ dataMode: "live", _dataModeKnown: true, live: { snapshot: LIVE_WITH_DEVICE } },
    (st) => { st.dataMode = "sample"; st.live.snapshot = SAMPLE_SNAPSHOT; });
  r.startBtn.click();
  await r.finish();
  expect(!recordedDemo(r.cs()).length, `demo radios recorded: ${JSON.stringify(Object.keys(r.cs().readings || {}))}`);
});

await run("control: Guided Calibration in Live mode still records the real radios", async () => {
  const LIVE_HEARD = { source: "live",
    objects: { list: [{ key: "ble:AA:BB:CC:DD:EE:01", address: "AA:BB:CC:DD:EE:01", kind: "ble" }] },
    ble: { radios: LIVE_SNAP.ble.radios, advertisements: [
      { address: "AA:BB:CC:DD:EE:01", source: "AA:01", rssi: -61, age_s: 1 },
      { address: "AA:BB:CC:DD:EE:01", source: "AA:03", rssi: -74, age_s: 1 } ] } };
  const r = await renderPin({ dataMode: "live", _dataModeKnown: true, live: { snapshot: LIVE_HEARD },
    _calib: { tab: "pin", deviceId: "ble:AA:BB:CC:DD:EE:01", mapId: "ground", duration: 1,
      pinX: 0.5, pinY: 0.5, pinRoom: "Kitchen", pinLabel: "", collecting: false, stopFlag: false,
      readings: null, savedThisSession: 0 } },
    (st) => { st.live.snapshot = structuredClone(LIVE_HEARD); });
  r.startBtn.click();
  await r.finish();
  const got = Object.keys(r.cs().readings || {}).sort();
  expect(got.join(",") === "AA:01,AA:03", `real radios not recorded: ${JSON.stringify(got)} ${JSON.stringify(r.toasts)}`);
});

// ── Part C: overview.js while the mode is unknown ────────────────────────────

const overview = await import(pathToFileURL(join(WWW, "views", "overview.js")).href);

async function renderOverview(stateOver) {
  const helpers = { el, esc: (s) => String(s ?? ""), pill: (t) => el("span", {}, String(t ?? "")), HELP: {},
    helpBtn: () => el("button", {}, "?"), radioShortId: (s) => String(s || "").slice(-3),
    awayTimeoutS: () => 120, isAway: () => false, roomColor: () => "#52b788",
    scannerStatus: () => "ok", scannerAddrs: () => new Set(), isScanner: () => false };
  const state = Object.assign({ view: "overview", complexity: "basic", dataMode: "sample",
    live: { snapshot: null }, maps: { list: [] }, model: { floors: [] }, settings: {}, timing: {},
    // Real rooms from the server's saved map (room_tags answers without the mode).
    roomTagMap: { Kitchen: ["a"], Den: ["b"] }, savedRoomTagMap: {} }, stateOver);
  const ctx = { hass: { states: {}, connection: { sendMessagePromise: async () => ({}) } }, state,
    helpers: new Proxy(helpers, { get: (t, k) => (k in t ? t[k] : recorder()) }),
    actions: new Proxy({ callWS: async () => ({}), wsCall: async () => ({}) },
      { get: (t, k) => (k in t ? t[k] : recorder()) }),
    toast: () => {} };
  const out = overview.render(ctx);
  await flush();
  return out.textContent;
}

for (const complexity of ["basic", "advanced"]) {
  await run(`overview (${complexity}): unknown mode shows the loading state, not the Sample layout`, async () => {
    const t = await renderOverview({ complexity });
    expect(!t.includes("Sample data"), `says "Sample data" while the mode is unknown`);
    expect(t.includes("--"), "no loading placeholders while the mode is unknown");
  });
  await run(`overview (${complexity}): a known Sample mode still says Sample data`, async () => {
    const t = await renderOverview({ complexity, _dataModeKnown: true });
    expect(t.includes("Sample data"), "a real Sample mode lost its Sample line");
  });
}

// ── Part D: #88 follow-ups ───────────────────────────────────────────────────
// (1) Guided Calibration opened a minute into an HA restart, before its
// Bluetooth was up, kept saying "no scanners" after the radios arrived: the
// poll never redrew the calibration view. The real _pollTick runs here on
// the state the real calibration.js rendered; _scheduleRender re-renders it
// (or, with `hold`, stands in for a poll render a guard held back).
// (2) The top-bar Data button shows the CURRENT mode and a click switches
// it: the reporter pressed "Live" to get Live and landed in Sample. The real
// _onDataModeClick runs here; the shim's queued timers stand in for the 3 s.

const radiosSnap = (...ids) => ({ source: "live", ble: { advertisements: [],
  radios: ids.map((id, i) => ({ source: id, name: `proxy-${id}`, area_name: "Hall", rssi: -60 - i })) } });

/** Guided Calibration step 1 on `first`, with a panel whose poll reads `server.snap`. */
async function calibPoll(first) {
  const server = { snap: first };
  const r = await renderTune({ dataMode: "live", _dataModeKnown: true, live: { snapshot: structuredClone(first) } });
  const p = new Panel(fakeHass({ "padspan_ha/live_snapshot": () => ({ snapshot: structuredClone(server.snap) }) }));
  Object.assign(r.ctx.state, { timing: {}, wsCounts: {}, _sessionEvents: [], roomTagMap: {}, savedRoomTagMap: {} });
  p.state = r.ctx.state;
  const renders = [];
  let text = r.radiosCard.textContent;
  p.hold = false;
  p._scheduleRender = (fromPoll) => {
    renders.push(fromPoll);
    if (!p.hold) text = calib.render(r.ctx).textContent;
  };
  return { r, p, server, renders, text: () => text };
}

await run("calibration: radios arriving after the wizard opened redraw it once", async () => {
  const c = await calibPoll(radiosSnap());
  expect(c.text().includes(NO_SCANNERS), `harness: expected the no-scanners line first, got: ${c.text()}`);
  await tick(c.p);
  expect(c.renders.length === 0, `an unchanged empty radio list was redrawn ${c.renders.length} time(s)`);
  c.server.snap = radiosSnap("AA:01", "AA:05", "AA:06");     // HA's Bluetooth is up
  await tick(c.p);
  expect(c.renders.length === 1, `radios arrived: expected one redraw, got ${c.renders.length}`);
  expect(c.renders[0] === true, "the redraw skipped the poll-render guards (drag, confirm, focused field)");
  expect(c.text().includes("Live Radios (3)") && c.text().includes("proxy-AA:06"), `after the redraw: ${c.text()}`);
  expect(!c.text().includes(NO_SCANNERS), "still says no scanners after the radios arrived");
  await tick(c.p); await tick(c.p);
  expect(c.renders.length === 1, `the same three radios were redrawn again (${c.renders.length} redraws)`);
  c.server.snap = radiosSnap("AA:01", "AA:06");               // one went away
  await tick(c.p);
  expect(c.renders.length === 2 && c.text().includes("Live Radios (2)"), `a removed radio: ${c.renders.length} redraws, ${c.text()}`);
});

await run("calibration: the same radios on every poll are not redrawn", async () => {
  const c = await calibPoll(radiosSnap("AA:01", "AA:05"));
  for (let i = 0; i < 4; i++) {
    const s = radiosSnap("AA:05", "AA:01");                    // other order, other RSSI: same radios
    s.ble.radios.forEach(rd => { rd.rssi -= i; });
    c.server.snap = s;
    await tick(c.p);
  }
  expect(c.renders.length === 0, `redrawn ${c.renders.length} time(s) with nothing changed`);
});

await run("calibration: a radio waiting to be placed is not disturbed by radios arriving", async () => {
  const c = await calibPoll(radiosSnap("AA:01", "AA:05"));
  const row = c.r.rowFor("proxy-AA:05 (Hall)");
  expect(row, "unplaced radio row not found");
  row.click();
  const ts = c.r.ts();
  expect(ts.pendingPlace && ts.pendingPlace.source === "AA:05", `harness: not armed: ${JSON.stringify(ts.pendingPlace)}`);
  c.server.snap = radiosSnap("AA:01", "AA:05", "AA:07");
  await tick(c.p); await tick(c.p);
  expect(c.renders.length === 0, `redrawn ${c.renders.length} time(s) while a radio was waiting to be placed`);
  expect(ts.pendingPlace && ts.pendingPlace.source === "AA:05", `the pending placement was lost: ${JSON.stringify(ts.pendingPlace)}`);
  ts.pendingPlace = null;                                     // placed / cancelled
  await tick(c.p);
  expect(c.renders.length === 1 && c.text().includes("proxy-AA:07"), `after the placement: ${c.renders.length} redraws, ${c.text()}`);
});

await run("calibration: a redraw a guard held back is asked for again on the next poll", async () => {
  const c = await calibPoll(radiosSnap());
  c.p.hold = true;                                            // a drag / focused field / recent click
  c.server.snap = radiosSnap("AA:01", "AA:05");
  await tick(c.p); await tick(c.p);
  expect(c.renders.length === 2, `the held-back redraw was not asked for again (${c.renders.length} asks)`);
  c.p.hold = false;
  await tick(c.p);
  expect(c.text().includes("Live Radios (2)"), `after the guard let go: ${c.text()}`);
  await tick(c.p);
  expect(c.renders.length === 3, `kept redrawing once drawn (${c.renders.length})`);
});

await run("calibration: the poll leaves the other Guided Calibration steps alone", async () => {
  const c = await calibPoll(radiosSnap());
  c.r.ctx.state._calibWizard.step = 2;                        // Choose your device
  calib.render(c.r.ctx);
  expect(c.r.ctx.state._calibTuneRadiosChanged === null, "the Tune tab's redraw hook outlived it");
  c.server.snap = radiosSnap("AA:01", "AA:05");
  await tick(c.p);
  expect(c.renders.length === 0, `step 2 was rebuilt by the poll (${c.renders.length})`);
});

/** A panel whose mode the server already answered; records settings_set calls. */
async function modePanel(mode) {
  const sets = [];
  const p = new Panel(fakeHass({
    "padspan_ha/settings_set": (m) => { sets.push(m.data_mode); return { settings: { data_mode: m.data_mode } }; },
    "padspan_ha/settings_get": () => ({ settings: { data_mode: sets.length ? sets[sets.length - 1] : mode } }) }));
  p._els["#mobileDataPill"] = { textContent: PILL_HTML, style: {} };
  await p._refreshAll(false);
  await flush();
  expect(p.state.dataMode === mode && p.state._dataModeKnown, `harness: expected ${mode}, got ${p.state.dataMode}`);
  const pill = () => p._els["#mobileDataPill"].textContent;
  return { p, sets, pill };
}
const CONFIRM = "Show demo data?";

await run("data toggle: one click on Live does not switch to Sample; it asks first", async () => {
  expect(typeof Panel.prototype._onDataModeClick === "function", "no _onDataModeClick()");
  const { p, sets, pill } = await modePanel("live");
  expect(p.badge === "Live", `harness: badge ${p.badge}`);
  await p._onDataModeClick();
  expect(!sets.length && p.state.dataMode === "live", `one click switched to ${sets.join(",")}`);
  expect(p.badge === CONFIRM && pill() === CONFIRM, `first click reads "${p.badge}" / pill "${pill()}"`);
  p._updateBadges();                                          // a poll lands inside the 3 s
  expect(p.badge === CONFIRM, `a poll put back "${p.badge}" before the second click`);
});

await run("data toggle: two clicks within 3 s switch Live to Sample", async () => {
  const { p, sets, pill } = await modePanel("live");
  await p._onDataModeClick();
  await p._onDataModeClick();
  expect(sets.join(",") === "sample" && p.state.dataMode === "sample", `settings_set calls: ${JSON.stringify(sets)}`);
  expect(p.state.live.snapshot === SAMPLE_SNAPSHOT && p.badge === "Sample" && pill() === "Sample",
    `after the switch: badge "${p.badge}" / pill "${pill()}"`);
  await flush();                                              // the 3 s timer, cleared by the switch
  expect(p.badge === "Sample" && pill() === "Sample", `the stale timer rewrote the label: "${p.badge}" / pill "${pill()}"`);
});

await run("data toggle: after 3 s the label goes back and a click only asks again", async () => {
  const { p, sets, pill } = await modePanel("live");
  await p._onDataModeClick();
  await flush();                                              // 3 s pass
  expect(p.badge === "Live" && pill() === "Live", `after the timeout: "${p.badge}" / pill "${pill()}"`);
  await p._onDataModeClick();
  expect(!sets.length && p.badge === CONFIRM, `a click after the timeout switched (${JSON.stringify(sets)}) or did not ask`);
});

await run("data toggle: Sample to Live is still one click", async () => {
  const { p, sets, pill } = await modePanel("sample");
  await p._onDataModeClick();
  expect(sets.join(",") === "live" && p.state.dataMode === "live" && p.badge === "Live" && pill() === "Live",
    `settings_set calls: ${JSON.stringify(sets)}, badge "${p.badge}" / pill "${pill()}"`);
});

await run("data toggle: the '…' (mode not known) button does nothing", async () => {
  // Nothing from the server yet: the constructor's state, the button reads "…".
  const p = new Panel(fakeHass({}));
  expect(!p.state._dataModeKnown, "harness: the mode should still be unknown");
  let calls = 0; const orig = p._hass.callWS; p._hass.callWS = (m) => { calls++; return orig(m); };
  await p._onDataModeClick(); await p._onDataModeClick();
  expect(calls === 0 && p.badge !== CONFIRM, `the unknown-mode button acted: ${calls} call(s), "${p.badge}"`);
});

await run("data toggle: the top bar and the mobile pill both go through the confirm", async () => {
  for (const id of ["dataModeToggle", "mobileDataPill"]) {
    const re = new RegExp(`this\\.\\$\\("#${id}"\\)\\.addEventListener\\("click",[^\\n]*this\\._onDataModeClick\\(\\)`);
    expect(re.test(src), `#${id} does not click through _onDataModeClick()`);
  }
});

let failed = 0;
for (const [label, c] of Object.entries(cases)) {
  if (c.ok) console.log(`  ok   ${label}`);
  else { failed++; console.log(`  FAIL ${label}: ${c.detail}`); }
}
console.log(`${Object.keys(cases).length - failed} passed, ${failed} failed`);
console.log(JSON.stringify({ cases }));
// _pollTick's 15s race timer would otherwise hold the process open.
process.exit(failed ? 1 : 0);
