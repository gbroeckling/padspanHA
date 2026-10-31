// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
//
// The maker lookup in the Objects list (overview.js), run: open the list from
// the Overview's "All objects" button, read every row's Maker cell, note what
// the panel asked the server, then flip the switch at the top of the list.
//
// usage: maker_lookup_switch.mjs <repo-root>
import { pathToFileURL } from "node:url";
const ROOT = process.argv[2];
if (!ROOT) { console.error("usage: maker_lookup_switch.mjs <repo-root>"); process.exit(2); }
const { install } = await import(pathToFileURL(ROOT + "/tests/js/dom_shim.mjs").href);
install(globalThis);
const OV = await import(pathToFileURL(ROOT + "/custom_components/padspan_ha/www/padspan-ha/views/overview.js").href);

const results = [];
let failed = 0;
function check(name, cond, detail = "") {
  results.push({ case: name, ok: !!cond });
  if (!cond) { failed++; console.error(`FAIL ${name}${detail ? ": " + detail : ""}`); }
}

function el(tag, attrs = {}, children = []) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (k === "class") n.className = v; else if (k === "id") n.id = v; else if (k === "style") n.setAttribute("style", v);
    else if (k === "value") n.value = v;  // a <select> reads its first <option>'s, as in a browser
    else if (k.startsWith("on") && typeof v === "function") n.addEventListener(k.slice(2), v);
    else if (v !== undefined && v !== null) n.setAttribute(k, String(v));
  }
  if (!Array.isArray(children)) children = [children];
  for (const c of children) { if (c == null) continue; if (typeof c === "string" || typeof c === "number") n.appendChild(document.createTextNode(String(c))); else n.appendChild(c); }
  return n;
}
const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const recorder = () => new Proxy(() => document.createElement("span"), {
  get: (t, k) => k === "then" ? undefined : (k === Symbol.toPrimitive || k === "toString") ? () => "" : recorder() });
const walk = (n, out = []) => { if (!n) return out; out.push(n); for (const c of (n.children || [])) walk(c, out); return out; };
const settle = async () => { for (let i = 0; i < 5; i++) await new Promise(r => globalThis._realSetTimeout(r, 5)); };
const label = (cell) => (cell.innerHTML ? cell.innerHTML.replace(/<[^>]+>/g, "") : cell.textContent).trim();

// What the server answers, per whole address: a maker, or "random" for an
// address a radio reported as random, though it shares Apple's first three bytes.
const ANSWERS = {
  "F0:18:98:12:34:56": { enabled: true, found: true, skipped: null, sources: { macvendors: "Apple, Inc.", maclookup: null } },
  "F0:18:98:AB:CD:EF": { enabled: true, found: false, skipped: "random", sources: { macvendors: null, maclookup: null } },
  "C4:11:22:33:44:55": { enabled: true, found: false, skipped: "random", sources: { macvendors: null, maclookup: null } },
};
const OBJECTS = [
  { key: "ble:F0:18:98:12:34:56", kind: "ble", address: "F0:18:98:12:34:56", name: "Speaker", age_s: 2 },
  { key: "ble:F0:18:98:AB:CD:EF", kind: "ble", address: "F0:18:98:AB:CD:EF", name: "Watch", age_s: 2 },
  { key: "ble:C4:11:22:33:44:55", kind: "ble", address: "C4:11:22:33:44:55", name: "Tag", age_s: 2 },
  { key: "ble:DA:11:22:33:44:55", kind: "ble", address: "DA:11:22:33:44:55", name: "Phone", age_s: 2 },
  { key: "irk:abc", kind: "private_ble", address: "5E:11:22:33:44:55", canonical_id: "irk:abc", name: "Nicole's phone", age_s: 2 },
  { key: "ibeacon:fda50693:1:2", kind: "ibeacon", address: "ibeacon:fda50693:1:2", all_addresses: ["F4:11:22:33:44:55"], name: "Beacon", age_s: 2 },
  { key: "entity:device_tracker.car", kind: "entity", entity_id: "device_tracker.car", address: "00:1A:7D:DA:71:13", name: "Car", identified: true },
];

function openList({ settings, admin = true }) {
  const asked = [], saved = [], modals = [];
  const state = {
    dataMode: "live", _dataModeKnown: true, complexity: "advanced", view: "overview",
    settings, followedAddrs: new Set(), timing: {}, wsCounts: {}, roomTagMap: {},
    model: { floors: [], areas: [] }, maps: [],
    live: { snapshot: {
      ble: { radios: [], advertisements: [], diag: { ok: true, errors: [] } },
      objects: { list: OBJECTS, summary: { total: OBJECTS.length, identified: 1, unidentified: 6 } },
    } },
  };
  const helpers = new Proxy({ el, esc, helpBtn: () => el("button", {}, "?"), radioShortId: () => "", radioName: () => "",
    isScanner: () => false, roomColor: () => "#fff", pill: (t) => el("span", {}, String(t ?? "")), HELP: {},
    awayTimeoutS: () => 600, isAway: () => false }, { get: (t, k) => k in t ? t[k] : recorder() });
  const actions = new Proxy({
    vendorLookup: async (mac) => { asked.push(mac); return ANSWERS[mac] || { enabled: true, found: false, skipped: null, sources: {} }; },
    openModal: (title, body, subtitle) => modals.push({ title, body, subtitle }),
    settingsSet: async (patch) => { saved.push(patch); Object.assign(state.settings, patch); return {}; },
    followedHas: () => false, renderRooms: () => {}, callWS: async () => ({}), wsCall: async () => ({}),
  }, { get: (t, k) => k in t ? t[k] : recorder() });
  const ctx = new Proxy({ hass: { states: {}, user: { is_admin: admin }, connection: { sendMessagePromise: async () => ({}) } },
    state, helpers, actions, toast: () => {} }, { get: (t, k) => k in t ? t[k] : recorder() });
  const root = OV.renderClassic(ctx);
  const btn = walk(root).find(n => n.tagName === "BUTTON" && n.textContent === "All objects");
  if (!btn) { console.error("no \"All objects\" button in the Advanced overview — moved? update this harness"); process.exit(2); }
  btn.click();
  return { asked, saved, modals, reopen: () => btn.click() };
}

function read(modal) {
  const nodes = walk(modal.body);
  const rows = {};
  for (const tr of nodes.filter(n => n.tagName === "TR" && n.getAttribute("data-kind"))) {
    const key = tr.getAttribute("data-kind") === "ble" ? tr.getAttribute("data-mac") : tr.getAttribute("data-kind");
    rows[key] = label(tr._vendorCell);
  }
  const toggle = nodes.find(n => n.tagName === "BUTTON" && n.getAttribute("data-maker-lookup"));
  return { rows, toggle };
}

// ── On (the default: the key isn't saved) ────────────────────────────────────
{
  const s = openList({ settings: {} });
  await settle();
  check("on: one list opened", s.modals.length === 1 && s.modals[0].title === "Objects");
  check("on: the subtitle says what is sent", s.modals[0].subtitle === "Filter + maker lookup (first three bytes only)", s.modals[0].subtitle);
  const { rows, toggle } = read(s.modals[0]);
  check("on: a public address shows its maker", rows["F0:18:98:12:34:56"] === "Apple, Inc.", JSON.stringify(rows));
  check("on: a random address sharing that prefix never shows the maker",
    rows["F0:18:98:AB:CD:EF"] === "random address", JSON.stringify(rows));
  check("on: an address a radio reported as random says so", rows["C4:11:22:33:44:55"] === "random address", JSON.stringify(rows));
  check("on: a locally administered address says so", rows["DA:11:22:33:44:55"] === "random address", JSON.stringify(rows));
  check("on: a private BLE row is a random address", rows.private_ble === "random address", JSON.stringify(rows));
  check("on: an iBeacon row has no one address to look up", rows.ibeacon === "n/a", JSON.stringify(rows));
  check("on: an entity row is not a Bluetooth row", rows.entity === "n/a", JSON.stringify(rows));
  check("on: only addresses whose bits are clear are asked about, each once",
    JSON.stringify([...s.asked].sort()) === JSON.stringify(["C4:11:22:33:44:55", "F0:18:98:12:34:56", "F0:18:98:AB:CD:EF"]),
    JSON.stringify(s.asked));
  check("on: the switch says On and an administrator can use it",
    toggle && toggle.textContent === "Look up makers online: On" && toggle.getAttribute("data-maker-lookup") === "on" && !toggle.disabled,
    toggle && toggle.textContent);

  // Opened again: the panel kept answers by prefix until 0.38.208, so one of
  // the two F0:18:98 rows showed the other's answer.
  s.reopen();
  await settle();
  const second = read(s.modals[1]).rows;
  check("reopened: each address shows its own answer, not one cached for its prefix",
    second["F0:18:98:12:34:56"] === "Apple, Inc." && second["F0:18:98:AB:CD:EF"] === "random address", JSON.stringify(second));

  // Switch it off: saved, the list reopens, every Bluetooth row says so, nothing is asked.
  const before = s.asked.length;
  read(s.modals[1]).toggle.click();
  await settle();
  check("off: the switch saves off", JSON.stringify(s.saved) === JSON.stringify([{ vendor_lookup_enabled: false }]), JSON.stringify(s.saved));
  check("off: the list reopened", s.modals.length === 3, String(s.modals.length));
  const off = read(s.modals[2]);
  const bt = ["F0:18:98:12:34:56", "F0:18:98:AB:CD:EF", "C4:11:22:33:44:55", "DA:11:22:33:44:55", "private_ble", "ibeacon"];
  check("off: every Bluetooth row says Lookup off", bt.every(k => off.rows[k] === "Lookup off"), JSON.stringify(off.rows));
  check("off: an entity row stays n/a", off.rows.entity === "n/a", JSON.stringify(off.rows));
  check("off: nothing is asked", s.asked.length === before, JSON.stringify(s.asked.slice(before)));
  check("off: the subtitle drops the lookup", s.modals[2].subtitle === "Filter", s.modals[2].subtitle);
  check("off: the switch says Off", off.toggle && off.toggle.textContent === "Look up makers online: Off"
    && off.toggle.getAttribute("data-maker-lookup") === "off", off.toggle && off.toggle.textContent);

  // And on again.
  off.toggle.click();
  await settle();
  check("on again: the switch saves on", JSON.stringify(s.saved[1]) === JSON.stringify({ vendor_lookup_enabled: true }), JSON.stringify(s.saved));
  const again = read(s.modals[3]);
  check("on again: the maker is back and the random row stays random",
    again.rows["F0:18:98:12:34:56"] === "Apple, Inc." && again.rows["F0:18:98:AB:CD:EF"] === "random address", JSON.stringify(again.rows));
}

// ── Off, saved ───────────────────────────────────────────────────────────────
{
  const s = openList({ settings: { vendor_lookup_enabled: false } });
  await settle();
  const { rows } = read(s.modals[0]);
  check("saved off: every Bluetooth row says Lookup off, nothing asked",
    Object.entries(rows).every(([k, v]) => k === "entity" ? v === "n/a" : v === "Lookup off") && s.asked.length === 0,
    JSON.stringify({ rows, asked: s.asked }));
}

// ── Not an administrator ─────────────────────────────────────────────────────
{
  const s = openList({ settings: {}, admin: false });
  await settle();
  const { toggle } = read(s.modals[0]);
  check("non-admin: the switch is disabled and says why",
    toggle && toggle.disabled === true && toggle.title === "Only an administrator can change this", toggle && toggle.title);
}

for (const r of results) console.log(JSON.stringify(r));
console.log(JSON.stringify({ summary: true, cases: results.length, failed }));
process.exit(failed ? 1 : 0);
