// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
//
// RUN Settings → UI Structure → the Atlas card (views/settings.js).
//
// Two switches on one card, with different rules: "Show the Atlas in the
// Home Assistant sidebar" is registered at setup (panel.py), so it saves with
// Save and takes a restart; "Show the Test emergency lighting button" is read
// by the Atlas on its next refresh, so it saves the moment it changes, alone.
// Before 2026-09-28 one Save sent both and always said "restart Home
// Assistant", and ticking the emergency box did nothing until that Save.
//
// usage: atlas_settings_card.mjs <views-dir>
// prints one JSON line: { title, blurb, emergencySaves, saveSends, restartNotes, failures }

import { pathToFileURL } from "node:url";
import { join } from "node:path";
import { install, flush } from "./dom_shim.mjs";

const VIEWS = process.argv[2];
if (!VIEWS) { console.error("usage: atlas_settings_card.mjs <views-dir>"); process.exit(2); }
install(globalThis);

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
const noop = () => el("span");
const failures = [];
const sent = [];
let rerenders = 0;   // settingsSet re-renders the whole Settings view in panel.js
const S = await import(pathToFileURL(join(VIEWS, "settings.js")).href);
const ctx = {
  hass: { user: { is_admin: true }, states: {} },
  state: { view: "settings", complexity: "advanced", _settingsTab: "ui", model: { floors: [], areas: [] },
    settings: { lights_panel_enabled: true, atlas_emergency_button: true, advanced_extra_tabs: [] } },
  helpers: new Proxy({ el, esc: (s) => String(s), roomColor: () => "#52b788", helpBtn: noop },
    { get: (t, k) => (k in t ? t[k] : noop) }),
  actions: new Proxy({ settingsSet: async (p) => { sent.push(p); rerenders++; return {}; },
    wsCall: async (type, data = {}) => { if (type === "padspan_ha/settings_set") sent.push(data);
      return { settings: { ...ctx.state.settings, ...data } }; },
    renderRooms() {}, renderNav() {} },
    { get: (t, k) => (k in t ? t[k] : () => {}) }),
  toast() {},
};

const out = { title: null, blurb: null, emergencySaves: null, emergencyRerenders: null, saveSends: null, restartNotes: null, failures };
try {
  const root = S.render(ctx);
  const all = root._all();
  const card = all.find(n => (n.className || "") === "card" && /emergency lighting button/.test(n.textContent || ""));
  if (!card) throw new Error("no Atlas card on Settings → UI Structure");
  const kids = card._all();
  out.title = kids.find(n => /font-weight:700;font-size:14px/.test(n.getAttribute && n.getAttribute("style") || ""))?.textContent || null;
  out.blurb = card.children[1] && card.children[1].textContent;
  const boxes = kids.filter(n => n.localName === "input" && n.getAttribute("type") === "checkbox");
  const [atlasBox, emergBox] = boxes;
  // Untick the emergency box: saved at once, on its own.
  emergBox.checked = false;
  emergBox.dispatchEvent({ type: "change" });
  await flush();
  out.emergencySaves = sent.splice(0);
  out.emergencyRerenders = rerenders;
  // Untick the sidebar box and press Save: only that setting goes.
  atlasBox.checked = false;
  kids.find(n => n.localName === "button" && n.textContent === "Save" && card.contains(n)).click();
  await flush();
  out.saveSends = sent.splice(0);
  out.restartNotes = kids.filter(n => /restart/i.test(n._text || "")).map(n => n._text);
} catch (e) { failures.push(String(e && e.stack || e).slice(0, 800)); }

console.log(JSON.stringify(out));
process.exit(failures.length ? 1 : 0);
