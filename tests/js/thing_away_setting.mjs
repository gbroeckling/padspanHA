// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
//
// Settings → Presence → Home/Away Timeout: the "Things keep their room" row
// (settings.thing_away_timeout_h), RUN rather than read. Draws the card with
// and without a saved value, types into the hours box, presses Save and
// prints what reached settings_set. The pytest wrapper is
// tests/test_thing_away.py.
//
// Run:  node tests/js/thing_away_setting.mjs <repo-root>
import { pathToFileURL } from "node:url";
const ROOT = process.argv[2];
const { install } = await import(pathToFileURL(ROOT + "/tests/js/dom_shim.mjs").href);
install(globalThis);
const SET = await import(pathToFileURL(ROOT + "/custom_components/padspan_ha/www/padspan-ha/views/settings.js").href);

function el(tag, attrs = {}, children = []) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (k === "class") n.className = v; else if (k === "id") n.id = v; else if (k === "style") n.setAttribute("style", v);
    else if (k.startsWith("on") && typeof v === "function") n.addEventListener(k.slice(2), v);
    else if (v !== undefined && v !== null) { n.setAttribute(k, String(v)); if (k === "value") n.value = String(v); }
  }
  if (!Array.isArray(children)) children = [children];
  for (const c of children) { if (c == null) continue; if (typeof c === "string" || typeof c === "number") n.appendChild(document.createTextNode(String(c))); else n.appendChild(c); }
  return n;
}
const recorder = () => new Proxy(() => document.createElement("span"), {
  get: (t, k) => k === "then" ? undefined : (k === Symbol.toPrimitive || k === "toString") ? () => "" : recorder() });

function draw(settings, sent, toasts) {
  const state = {
    dataMode: "live", _dataModeKnown: true, complexity: "advanced", view: "settings", _settingsTab: "presence",
    settings: { telemetry_enabled: false, ...settings }, followedAddrs: new Set(), timing: {}, roomTagMap: {},
    model: { floors: [], areas: [], room_meta: {} }, maps: [],
    live: { snapshot: { ble: { radios: [], advertisements: [] }, objects: { list: [], summary: {} } } },
  };
  const helpers = new Proxy({ el, esc: (s) => String(s ?? ""), helpBtn: () => el("button", {}, "?"), radioShortId: () => "",
    isScanner: () => false, roomColor: () => "#fff", pill: (t) => el("span", {}, String(t ?? "")), HELP: {} },
    { get: (t, k) => k in t ? t[k] : recorder() });
  const actions = new Proxy({ renderRooms: () => {}, settingsSet: async (p) => { sent.push(p); return {}; },
    callWS: async () => ({}), wsCall: async () => ({}) }, { get: (t, k) => k in t ? t[k] : recorder() });
  const ctx = new Proxy({ hass: { states: {}, user: { is_admin: true }, connection: { sendMessagePromise: async () => ({}) } },
    state, helpers, actions, toast: (m) => toasts.push(m) }, { get: (t, k) => k in t ? t[k] : recorder() });
  return SET.render(ctx);
}

// The shim holds timers; the handler awaits only settingsSet, so a few microtasks settle it.
const tick = async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); };
const out = {};
for (const [name, settings] of [["unset", {}], ["saved", { thing_away_timeout_h: 2 }], ["zero", { thing_away_timeout_h: 0 }]]) {
  const sent = [], toasts = [];
  const root = draw(settings, sent, toasts);
  const row = root.querySelector("[data-thing-away]");
  const card = row ? row.parentNode : null;
  out[name] = {
    found: !!row,
    value: row ? row.querySelector("input").value : null,
    card: card ? (card.textContent || "") : "",
  };
}
// Typed values and what Save sends for each.
out.saves = [];
for (const typed of ["3", "0", "100", "0.1", "", "-2"]) {
  const sent = [], toasts = [];
  const row = draw({}, sent, toasts).querySelector("[data-thing-away]");
  row.querySelector("input").value = typed;
  row.querySelector("button").click();
  await tick();
  out.saves.push({ typed, sent, toast: toasts[0] || null });
}
console.log(JSON.stringify(out));
