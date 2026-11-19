// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
//
// The Install Base view's "Following phones" card (views/installbase.js),
// drawn under the DOM shim from a stats.php answer: its irk-capture rows read
// stats.php's identity counts (capture_installs, capture_keys,
// capture_keys_resolving) and show them as counts with their shares.
//
// Run: node tests/js/installbase_identity.mjs <repo root>
// Prints one JSON line: { cases: {name: bool}, failures: [...] }.
import { pathToFileURL } from "node:url";

const ROOT = process.argv[2];
const { install, flush } = await import(pathToFileURL(ROOT + "/tests/js/dom_shim.mjs").href);
install(globalThis);
const _ss = new Map();
globalThis.sessionStorage = { getItem: k => (_ss.has(k) ? _ss.get(k) : null), setItem: (k, v) => _ss.set(k, String(v)), removeItem: k => _ss.delete(k) };
sessionStorage.setItem("padspan_installbase_unlocked", "1");
const IB = await import(pathToFileURL(ROOT + "/custom_components/padspan_ha/www/padspan-ha/views/installbase.js").href);

const cases = {}, failures = [];
const check = (name, ok, info) => { cases[name] = !!ok; if (!ok) failures.push({ name, info }); };

function el(tag, attrs = {}, children = []) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (k === "class") n.className = v; else if (k === "style") n.setAttribute("style", v);
    else if (v !== undefined && v !== null) n.setAttribute(k, String(v));
  }
  if (!Array.isArray(children)) children = [children];
  for (const c of children) { if (c == null) continue; n.appendChild(typeof c === "string" || typeof c === "number" ? document.createTextNode(String(c)) : c); }
  return n;
}

const STATS = {
  generated: "2026-11-19T12:00:00", window_days: 30, installs: { reporting_window: 10 }, pings: {},
  dist: { version: { "0.38.261": 10 } },
  identity: { with_irks: 6, resolving: 5, silent: 1, private_ble_device: 3,
              capture_installs: 4, capture_keys: 8, capture_keys_resolving: 6 },
};
const ctx = {
  state: { dataMode: "live", settings: { tier: "pro" } },
  helpers: { el, esc: s => String(s ?? ""), helpBtn: () => el("button", {}, "?") },
  actions: { wsCall: async () => ({ stats: STATS, cached: false }), renderRooms: () => {} },
  toast: () => {},
};
let root = null;
try {
  root = IB.render(ctx);
  await flush(12);
  check("render: draws without throwing", true);
} catch (e) {
  check("render: draws without throwing", false, String(e && e.stack || e));
}
const rows = root ? root.querySelectorAll(".ib-kv-row").map(r => r.children.map(c => c.textContent)) : [];
const row = (label) => rows.find(r => r[0] === label);
check("render: the Following phones card is drawn", !!row("Installs with phone keys added"), rows.slice(0, 8));
const boards = row("Installs with an irk-capture ESP32");
check("card: homes with an irk-capture ESP32, as a share of homes", !!boards && boards[1] === "4" && boards[2] === "40%", boards);
const keys = row("Phone keys saved from an irk-capture ESP32");
check("card: the keys saved from one, a count only", !!keys && keys[1] === "8" && keys[2] === "", keys);
const i = rows.indexOf(keys);
const ok = i >= 0 ? rows[i + 1] : null;
check("card: and how many of those recognise a phone", !!ok && ok[0] === "…recognising a phone" && ok[1] === "6" && ok[2] === "75%", ok);

console.log(JSON.stringify({ cases, failures }));
