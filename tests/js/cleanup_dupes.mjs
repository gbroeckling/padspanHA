// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
//
// The interface review's duplicate clean-up (2026-10-30), RUN rather than read:
//   monitor   Monitor → Quick status: a line and Open Health (the tab id kept)
//   manage    Manage → History: a line and Open History → Movement (id kept);
//             Manage → Events keeps its alerts editor (what Events lacks); its
//             room log is a line and Open History too (tests/js/help_found_bugs.mjs)
//   wizard    the Live Aboard wizard: real switches on the first setup, each
//             setting's value and a link to its Settings tab afterwards
//   Basic's own links into Settings and Mapping open just their part: see
//             tests/js/basic_focus.mjs
// The pytest wrapper is tests/test_cleanup_dupes.py.
//
// Run:  node tests/js/cleanup_dupes.mjs <repo-root>
import { pathToFileURL } from "node:url";
const ROOT = process.argv[2];
const { install, flush } = await import(pathToFileURL(ROOT + "/tests/js/dom_shim.mjs").href);
install(globalThis);
const V = ROOT + "/custom_components/padspan_ha/www/padspan-ha/views/";
const imp = (n) => import(pathToFileURL(V + n).href);
const MON = await imp("monitor.js"), MAN = await imp("manage.js"), WIZ = await imp("aboard_wizard.js");
const SET = await imp("settings.js"), MAPS = await imp("maps.js");

const results = {};
const check = (name, ok, detail) => { results[name] = { ok: !!ok, detail: ok ? undefined : detail }; };

function el(tag, attrs = {}, children = []) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (k === "class") n.className = v; else if (k === "id") n.id = v; else if (k === "style") n.setAttribute("style", v);
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
const attr = (root, a, v) => all(root).find(n => n.getAttribute && n.getAttribute(a) !== null && (v === undefined || n.getAttribute(a) === v)) || null;
const button = (root, label) => all(root).find(n => (n.tagName || "").toUpperCase() === "BUTTON" && text(n).includes(label)) || null;
const tabsOf = (root) => all(root).filter(n => n.classList && n.classList.contains("tab")).map(text);

function makeCtx(state, calls = []) {
  const s = Object.assign({
    dataMode: "live", _dataModeKnown: true, complexity: "basic", view: "settings", version: "0", buildId: "b",
    settings: { tier: "pro", edition: "full" }, followedAddrs: new Set(), timing: {}, roomTagMap: {}, wsCounts: {},
    model: { floors: [{ id: "main", name: "Main" }], areas: [], room_meta: {}, room_geometry_m: {}, map_transforms: {} },
    maps: { list: [{ id: "m1", name: "Main floor", floor_id: "main", image: { width: 800, height: 600 }, receivers: [], room_bounds: {} }] },
    live: { snapshot: { ble: { radios: [] }, objects: { list: [], summary: {} }, tags: [] } },
  }, state);
  const actions = {
    renderRooms: () => calls.push(["renderRooms"]), renderNav: () => calls.push(["renderNav"]),
    showView: (id) => { calls.push(["showView", id]); s.view = id; },
    setMapsTab: (t) => { calls.push(["setMapsTab", t]); s.mapsTab = t; },
    mapsSetActive: (id) => { s.activeMapId = id; },
    setComplexity: (m) => { calls.push(["setComplexity", m]); s.complexity = m; },
    settingsSet: async (p) => { calls.push(["settingsSet", p]); Object.assign(s.settings, p); return { settings: s.settings }; },
    callWS: async (p) => (p && p.type === "padspan_ha/house3d_get" ? { data: { pieces: {}, lights: {}, openings: {}, devices: {} } } : {}),
    wsCall: async () => ({}), openModal: (t, body) => { calls.modal = body; }, closeModal: () => {},
    telemetryEvent: () => {}, objectLabelList: async () => ({}), canOpen: () => true, calibrationGet: async () => ({}),
  };
  const helpers = new Proxy({ el, esc: (x) => String(x ?? ""), helpBtn: () => el("button", {}, "?"), radioShortId: () => "",
    isScanner: () => false, roomColor: () => "#fff", pill: (t) => el("span", {}, String(t ?? "")), HELP: {}, mapImageUrl: () => "/x.png" },
    { get: (t, k) => (k in t ? t[k] : quiet()) });
  return new Proxy({ hass: { states: {}, user: { is_admin: true }, connection: { sendMessagePromise: async () => ({}) } },
    state: s, helpers, actions: new Proxy(actions, { get: (t, k) => (k in t ? t[k] : quiet()) }),
    toast: (m) => calls.push(["toast", String(m)]) }, { get: (t, k) => (k in t ? t[k] : quiet()) });
}

// ── monitor ──────────────────────────────────────────────────────────────────
{
  const calls = [];
  const ctx = makeCtx({ view: "monitor", complexity: "development", _monitorTab: "health" }, calls);
  const root = MON.render(ctx);
  const tabs = tabsOf(root);
  check("monitor: the Quick status tab is still there (old links land on it)", tabs.includes("Quick status"), tabs);
  const card = attr(root, "data-monitor-quick");
  check("monitor: Quick status is a line and a button, no copy of Health's cards",
    !!card && !/UI v|Discovery|Problems found|Checking for problems/.test(text(root)), text(root).slice(0, 300));
  const b = card && button(card, "Open Health");
  if (b) b.dispatchEvent(new Event("click"));
  check("monitor: Open Health opens the Health page", ctx.state.view === "health" && calls.some(c => c[0] === "showView" && c[1] === "health"), calls);
}

// ── manage ───────────────────────────────────────────────────────────────────
{
  const calls = [];
  const ctx = makeCtx({ view: "manage", complexity: "advanced", manageTab: "history" }, calls);
  const root = MAN.render(ctx);
  check("manage: the History tab is still there", tabsOf(root).includes("History"), tabsOf(root));
  const card = attr(root, "data-manage-history");
  check("manage: History is a line and a button", !!card && !/room transitions \(persisted\)/.test(text(root)), text(root).slice(0, 300));
  const b = card && button(card, "Open History");
  if (b) b.dispatchEvent(new Event("click"));
  check("manage: Open History opens History → Movement", ctx.state.view === "history" && ctx.state._historyTab === "movement", [ctx.state.view, ctx.state._historyTab]);
  const ev = makeCtx({ view: "manage", complexity: "advanced", manageTab: "events" });
  const evRoot = MAN.render(ev);
  check("manage: Events keeps its own content (alerts editor, a way to History → Movement)",
    /Saved Alerts/.test(text(evRoot)) && !!attr(evRoot, "data-manage-events-history") && !attr(evRoot, "data-manage-events"), text(evRoot).slice(0, 200));
}

// ── wizard ───────────────────────────────────────────────────────────────────
async function wizardAt(stepId, settings, complexity = "advanced") {
  const calls = [];
  const ctx = makeCtx({ view: "maps", complexity, settings: Object.assign({ tier: "pro", edition: "full" }, settings) }, calls);
  await WIZ.openLiveAboardWizard(ctx, stepId);
  return { ctx, calls, modal: () => calls.modal };
}
const inputsOf = (n) => all(n).filter(x => ["INPUT", "SELECT"].includes((x.tagName || "").toUpperCase()));
{
  // First setup: Live Aboard never switched on.
  const f = await wizardAt("extras", { atlas_3d_enabled: false, atlas_weather_enabled: true });
  check("wizard: first setup is detected (Live Aboard not yet on)", f.ctx.state._laWizard.firstSetup === true, f.ctx.state._laWizard);
  const fx = f.modal();
  check("wizard: first setup, the extras are real switches (quality, rain and snow, back to home view)",
    inputsOf(fx).length >= 3 && !attr(fx, "data-wiz-setting", "Quality"), inputsOf(fx).length);
  // Turned on in step 1 of the same run: still the first setup.
  f.ctx.state._laWizard.i = 0;
  button(fx, "Turn it on").dispatchEvent(new Event("click"));
  const on = all(f.modal()).find(n => (n.tagName || "").toUpperCase() === "INPUT");
  on.checked = true; on.dispatchEvent(new Event("change"));
  await flush();
  check("wizard: switching Live Aboard on mid-run keeps the run's switches", f.ctx.state.settings.atlas_3d_enabled === true
    && f.ctx.state._laWizard.firstSetup === true && !!all(f.modal()).find(n => text(n) === "Show the Atlas as Overview" && (n.tagName || "").toUpperCase() === "LABEL"), f.ctx.state._laWizard);
  button(f.modal(), "Furniture").dispatchEvent(new Event("click"));
  check("wizard: first setup, furniture has the library switch and the photo AI picker",
    inputsOf(f.modal()).length >= 2 && !attr(f.modal(), "data-wiz-setting"), inputsOf(f.modal()).length);
}
{
  // After setup: Live Aboard on, a fresh run.
  const settings = { atlas_3d_enabled: true, atlas_weather_enabled: true, atlas_3d_weather: false, atlas_3d_quality: "high",
                     atlas_3d_home_idle_s: 300, atlas_3d_library: true, atlas_3d_ai_task_entity: "ai_task.local", overview_atlas: true };
  const a = await wizardAt("extras", settings);
  const ax = a.modal();
  check("wizard: after setup is detected", a.ctx.state._laWizard.firstSetup === false, a.ctx.state._laWizard);
  const row = (label) => attr(a.modal(), "data-wiz-setting", label);
  check("wizard: after setup, extras show their values, no switches",
    inputsOf(ax).length === 0 && /High: sun shadows/.test(text(row("Quality"))) && /Off/.test(text(row("Rain and snow")))
    && /After 5 min/.test(text(row("Back to home view"))), [inputsOf(ax).length, text(ax).slice(0, 400)]);
  check("wizard: each value links to Settings → Atlas",
    ["Quality", "Rain and snow", "Back to home view"].every(l => row(l) && button(row(l), "Open Settings → Atlas")), null);
  button(ax, "Furniture").dispatchEvent(new Event("click"));
  check("wizard: after setup, the library and photo AI show values; the AI task links to Settings → AI",
    inputsOf(a.modal()).length === 0 && /On/.test(text(row("Use the shared furniture library")))
    && /ai_task\.local/.test(text(row("Make furniture from a photo"))) && !!button(row("Make furniture from a photo"), "Open Settings → AI"), text(a.modal()).slice(0, 400));
  button(a.modal(), "Make it your screen").dispatchEvent(new Event("click"));
  check("wizard: after setup, Show the Atlas as Overview is its value and a link",
    /On/.test(text(row("Show the Atlas as Overview"))) && inputsOf(a.modal()).length === 0, text(a.modal()).slice(0, 300));
  button(a.modal(), "Turn it on").dispatchEvent(new Event("click"));
  check("wizard: Turn it on keeps its own switch (the step itself)", inputsOf(a.modal()).length === 1, inputsOf(a.modal()).length);
}
{
  // The links, from Basic: a setting's Open Settings opens just the card it is on (views/focus.js), Basic stays Basic.
  const settings = { atlas_3d_enabled: true, atlas_3d_ai_task_entity: "" };
  const b = await wizardAt("furniture", settings, "basic");
  button(attr(b.modal(), "data-wiz-setting", "Make furniture from a photo"), "Open Settings → AI").dispatchEvent(new Event("click"));
  const f = b.ctx.state._focus || {};
  check("wizard (Basic): Open Settings → AI opens only the AI task card, the mode unchanged",
    b.ctx.state.view === "settings" && b.ctx.state._settingsTab === "ai" && f.view === "settings" && f.part === "ai_task"
    && b.ctx.state.complexity === "basic" && !b.calls.some(c => c[0] === "setComplexity"), [b.ctx.state.view, f]);
  const root = SET.render(b.ctx);
  check("wizard (Basic): Settings draws that card alone under a back bar",
    !!attr(root, "data-focus-part", "ai_task") && !!attr(root, "data-focus-bar") && tabsOf(root).length === 0
    && !/What it does for you/.test(text(root)), text(root).slice(0, 200));
  const a = await wizardAt("furniture", settings, "advanced");
  button(attr(a.modal(), "data-wiz-setting", "Make furniture from a photo"), "Open Settings → AI").dispatchEvent(new Event("click"));
  check("wizard (Basic): in Advanced the same link opens the whole AI tab, no focus",
    a.ctx.state.view === "settings" && a.ctx.state._settingsTab === "ai" && !a.ctx.state._focus, [a.ctx.state._settingsTab, a.ctx.state._focus]);
}

console.log(JSON.stringify(results));
