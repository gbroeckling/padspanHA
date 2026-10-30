// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
//
// Settings → Presence in sections (views/settings.js PRESENCE_SECTIONS),
// RUN rather than read: draws the Presence tab and prints, per section, its
// key, whether it is open and the titles of the cards in it, plus any card
// left outside a section. Also draws it with a section folded in
// localStorage, with a link revealing it, and with "Become a tester" set.
// The pytest wrapper is tests/test_settings_sections.py.
//
// Run:  node tests/js/settings_sections.mjs <repo-root>
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
const text = (n) => (n && (n.textContent || "")) || "";

function draw(extra = {}, settings = {}) {
  const state = {
    dataMode: "live", _dataModeKnown: true, complexity: "advanced", view: "settings", _settingsTab: "presence",
    settings: { telemetry_enabled: false, ...settings }, followedAddrs: new Set(), timing: {}, roomTagMap: {},
    model: { floors: [], areas: [], room_meta: {} }, maps: [],
    live: { snapshot: { ble: { radios: [{ source: "kit", name: "kit", display_name: "Kitchen proxy" }], advertisements: [] },
      objects: { list: [], summary: {} } } },
    ...extra,
  };
  const helpers = new Proxy({ el, esc: (s) => String(s ?? ""), helpBtn: () => el("button", {}, "?"), radioShortId: () => "",
    isScanner: () => false, roomColor: () => "#fff", pill: (t) => el("span", {}, String(t ?? "")), HELP: {} },
    { get: (t, k) => k in t ? t[k] : recorder() });
  const actions = new Proxy({ renderRooms: () => {}, settingsSet: async () => ({}), callWS: async () => ({}), wsCall: async () => ({}) },
    { get: (t, k) => k in t ? t[k] : recorder() });
  const ctx = new Proxy({ hass: { states: {}, user: { is_admin: true }, connection: { sendMessagePromise: async () => ({}) } },
    state, helpers, actions, toast: () => {} }, { get: (t, k) => k in t ? t[k] : recorder() });
  const root = SET.render(ctx);
  const sections = [], loose = [];
  const walk = (n, sec) => {
    for (const c of (n.children || [])) {
      if (c.tagName && String(c.tagName).toLowerCase() === "details" && c.getAttribute("data-presence-section")) {
        const s = { key: c.getAttribute("data-presence-section"), open: c.open === true, cards: [] };
        sections.push(s); walk(c, s); continue;
      }
      if (isCard(c)) {
        const h = c.querySelector(".h2");
        const title = h ? text(h).trim() : text(c).trim().slice(0, 40);
        (sec ? sec.cards : loose).push(title);
        continue;   // a card's own insides are not more cards
      }
      walk(c, sec);
    }
  };
  walk(root, null);
  return { sections, loose, reveal: state._presenceReveal ?? null };
}

const out = {};
localStorage.clear();
out.plain = draw();
localStorage.setItem("padspan_settings_fold_rooms", "0");
out.folded = draw();
out.revealed = draw({ _presenceReveal: "rooms" });
out.afterReveal = draw();
localStorage.setItem("padspan_settings_fold_privacy", "0");
out.tester = draw({ _testerFocus: true, _testerScrolled: null });
localStorage.clear();
out.order = SET.PRESENCE_SECTIONS.map(([k]) => k);
console.log(JSON.stringify(out));
