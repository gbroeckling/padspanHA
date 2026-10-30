// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
//
// Settings → Atlas (views/settings.js _settingsAtlas), RUN rather than read:
// draws the Atlas and UI Structure tabs and prints the start of each card's
// text, the tab bar's labels, and the Show people / Show tags & scanners rows
// with Live Aboard on and off. The pytest wrapper is tests/test_settings_atlas.py.
//
// Run:  node tests/js/settings_atlas.mjs <repo-root>
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
    else if (v !== undefined && v !== null) n.setAttribute(k, String(v));
  }
  if (!Array.isArray(children)) children = [children];
  for (const c of children) { if (c == null) continue; if (typeof c === "string" || typeof c === "number") n.appendChild(document.createTextNode(String(c))); else n.appendChild(c); }
  return n;
}
const recorder = () => new Proxy(() => document.createElement("span"), {
  get: (t, k) => k === "then" ? undefined : (k === Symbol.toPrimitive || k === "toString") ? () => "" : recorder() });
const isCard = (n) => !!(n && n.classList && n.classList.contains("card"));
const all = (n, out = []) => { for (const c of (n.children || [])) { out.push(c); all(c, out); } return out; };

function draw(tab, settings = {}) {
  const state = {
    dataMode: "live", _dataModeKnown: true, complexity: "advanced", view: "settings", _settingsTab: tab,
    settings: { tier: "pro", edition: "full", ...settings }, followedAddrs: new Set(), timing: {}, roomTagMap: {},
    model: { floors: [], areas: [], room_meta: {}, room_geometry_m: {} }, maps: [],
    live: { snapshot: { ble: { radios: [] }, objects: { list: [], summary: {} } } },
  };
  const helpers = new Proxy({ el, esc: (s) => String(s ?? ""), helpBtn: () => el("button", {}, "?"), radioShortId: () => "",
    isScanner: () => false, roomColor: () => "#fff", pill: (t) => el("span", {}, String(t ?? "")), HELP: {} },
    { get: (t, k) => k in t ? t[k] : recorder() });
  const actions = new Proxy({ renderRooms: () => {}, settingsSet: async () => ({}), callWS: async () => ({}), wsCall: async () => ({}) },
    { get: (t, k) => k in t ? t[k] : recorder() });
  const ctx = new Proxy({ hass: { states: {}, user: { is_admin: true }, connection: { sendMessagePromise: async () => ({}) } },
    state, helpers, actions, toast: () => {} }, { get: (t, k) => k in t ? t[k] : recorder() });
  const root = SET.render(ctx);
  const nodes = all(root);
  const tabs = nodes.filter(n => n.classList && n.classList.contains("tab")).map(n => (n.textContent || "").trim());
  // The tab's own cards: the top-level ones (a card's insides are not more cards).
  const cards = [];
  const walk = (n) => { for (const c of (n.children || [])) { if (isCard(c)) cards.push((c.textContent || "").trim().slice(0, 60)); else walk(c); } };
  walk(root);
  const keyed = (attr) => nodes.filter(n => n.getAttribute && n.getAttribute(attr) !== null).map(n => n.getAttribute(attr));
  // The pointer from UI Structure: pressing it opens the Atlas tab.
  const go = nodes.find(n => n.getAttribute && n.getAttribute("data-goto") === "settings-atlas");
  let wentTo = null;
  if (go) { go.dispatchEvent(new Event("click")); wentTo = state._settingsTab; }
  return { tabs, cards, inputs: keyed("data-la3d-key"), states: keyed("data-la3d-state"), wentTo,
           text: (root.textContent || "") };
}

const out = {
  atlasOn: draw("atlas", { atlas_3d_enabled: true }),
  atlasOff: draw("atlas", { atlas_3d_enabled: false }),
  atlasFree: draw("atlas", { tier: "free" }),
  ui: draw("ui"),
  presence: draw("presence"),
};
console.log(JSON.stringify(out));
