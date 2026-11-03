// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
//
// The Maker column in the Objects list (overview.js), run: open the list from
// the Overview's "All objects" button and read every row's Maker cell. The
// answers come with the objects, so nothing is asked and there is no switch.
//
// usage: maker_column.mjs <repo-root>
import { pathToFileURL } from "node:url";
const ROOT = process.argv[2];
if (!ROOT) { console.error("usage: maker_column.mjs <repo-root>"); process.exit(2); }
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

const OBJECTS = [
  { key: "ble:F0:18:98:12:34:56", kind: "ble", address: "F0:18:98:12:34:56", name: "Speaker", age_s: 2, company_name: "Apple", maker_source: "address", address_type: "public" },
  { key: "ble:4C:11:22:33:44:01", kind: "ble", address: "4C:11:22:33:44:01", name: "Phone A", age_s: 2, company_name: "Apple", maker_source: "company_id" },
  { key: "ble:4C:11:22:33:44:02", kind: "ble", address: "4C:11:22:33:44:02", name: "Phone B", age_s: 2, company_name: "Google", maker_source: "service_uuid" },
  { key: "ble:4C:11:22:33:44:03", kind: "ble", address: "4C:11:22:33:44:03", name: "Tag", age_s: 2, company_name: "Tile", maker_source: "espresense" },
  { key: "ble:A4:C1:38:00:00:01", kind: "ble", address: "A4:C1:38:00:00:01", name: "Sensor", age_s: 2, maker_guess: "Telink Semiconductor" },
  { key: "ble:C4:11:22:33:44:55", kind: "ble", address: "C4:11:22:33:44:55", name: "Watch", age_s: 2, address_type: "random" },
  { key: "ble:DA:11:22:33:44:55", kind: "ble", address: "DA:11:22:33:44:55", name: "Laptop", age_s: 2 },
  { key: "ble:80:11:22:33:44:55", kind: "ble", address: "80:11:22:33:44:55", name: "Unknown", age_s: 2 },
  { key: "irk:abc", kind: "private_ble", address: "5E:11:22:33:44:55", canonical_id: "irk:abc", name: "Nicole's phone", age_s: 2 },
  { key: "ibeacon:fda50693:1:2", kind: "ibeacon", address: "ibeacon:fda50693:1:2", all_addresses: ["F4:11:22:33:44:55"], name: "First Tag", age_s: 2, device_type: "iBeacon" },
  { key: "ibeacon:fda50693:1:3", kind: "ibeacon", address: "ibeacon:fda50693:1:3", all_addresses: ["F4:11:22:33:44:56"], name: "Second Tag", age_s: 2, company_name: "Texas Instruments", maker_source: "address", device_type: "iBeacon" },
  { key: "entity:device_tracker.car", kind: "entity", entity_id: "device_tracker.car", address: "00:1A:7D:DA:71:13", name: "Car", identified: true, age_s: 2 },
];

const asked = [], modals = [];
const state = {
  dataMode: "live", _dataModeKnown: true, complexity: "advanced", view: "overview",
  settings: {}, followedAddrs: new Set(), timing: {}, wsCounts: {}, roomTagMap: {},
  model: { floors: [], areas: [] }, maps: [],
  live: { snapshot: {
    ble: { radios: [], advertisements: [], diag: { ok: true, errors: [] } },
    objects: { list: OBJECTS, summary: { total: OBJECTS.length, identified: 1, unidentified: OBJECTS.length - 1 } },
  } },
};
const helpers = new Proxy({ el, esc, helpBtn: () => el("button", {}, "?"), radioShortId: () => "", radioName: () => "",
  isScanner: () => false, roomColor: () => "#fff", pill: (t) => el("span", {}, String(t ?? "")), HELP: {},
  awayTimeoutS: () => 600, isAway: () => false }, { get: (t, k) => k in t ? t[k] : recorder() });
const actions = new Proxy({
  openModal: (title, body, subtitle) => modals.push({ title, body, subtitle }),
  followedHas: () => false, renderRooms: () => {},
  callWS: async (m) => { asked.push(m); return {}; }, wsCall: async (m) => { asked.push(m); return {}; },
}, { get: (t, k) => k in t ? t[k] : recorder() });
const ctx = new Proxy({ hass: { states: {}, user: { is_admin: true }, connection: { sendMessagePromise: async () => ({}) } },
  state, helpers, actions, toast: () => {} }, { get: (t, k) => k in t ? t[k] : recorder() });
const root = OV.renderClassic(ctx);
const btn = walk(root).find(n => n.tagName === "BUTTON" && n.textContent === "All objects");
if (!btn) { console.error("no \"All objects\" button in the Advanced overview — moved? update this harness"); process.exit(2); }
const askedBefore = asked.length;
btn.click();
await new Promise(r => globalThis._realSetTimeout(r, 20));

check("one list opened", modals.length === 1 && modals[0].title === "All objects");
check("the subtitle no longer mentions a lookup", modals[0].subtitle === "Filter", modals[0].subtitle);
const nodes = walk(modals[0].body);
const heads = nodes.filter(n => n.tagName === "TH").map(n => n.textContent);
const col = heads.indexOf("Maker");
check("there is a Maker column", col >= 0, JSON.stringify(heads));
const rows = {}, titles = {};
for (const tr of nodes.filter(n => n.tagName === "TR" && n.getAttribute("data-kind"))) {
  const hay = tr.getAttribute("data-search") || "";
  const o = OBJECTS.find(x => hay.includes(String(x.key.startsWith("ble:") ? x.address : x.name).toLowerCase()));
  if (!o) continue;
  const cell = tr.children[col];
  rows[o.name] = String(cell.textContent).trim();
  titles[o.name] = cell.children[0] ? cell.children[0].getAttribute("title") : null;
}
check("every row was read", Object.keys(rows).length >= OBJECTS.length - 1, JSON.stringify(rows));
check("a confirmed address shows its maker", rows.Speaker === "Apple", JSON.stringify(rows));
check("how it is known is in the hover text", /confirmed this address is fixed/.test(titles.Speaker || ""), titles.Speaker);
check("from the broadcast's company number", rows["Phone A"] === "Apple" && /company number/.test(titles["Phone A"] || ""), JSON.stringify(rows));
check("from a service's owner", rows["Phone B"] === "Google" && /service/.test(titles["Phone B"] || ""), JSON.stringify(rows));
check("from ESPresense's id", rows.Tag === "Tile" && /ESPresense/.test(titles.Tag || ""), JSON.stringify(rows));
check("no receiver's word: probably", rows.Sensor === "Probably Telink Semiconductor", JSON.stringify(rows));
check("and the hover text says why", /No receiver has confirmed/.test(titles.Sensor || ""), titles.Sensor);
check("a radio's random says so", rows.Watch === "random address", JSON.stringify(rows));
check("bits IEEE doesn't assign say so", rows.Laptop === "random address", JSON.stringify(rows));
check("nothing known says so", rows.Unknown === "maker unknown", JSON.stringify(rows));
check("a private BLE row is a random address", rows["Nicole's phone"] === "random address", JSON.stringify(rows));
check("an iBeacon with no maker isn't Apple", rows["First Tag"] === "maker unknown", JSON.stringify(rows));
check("an iBeacon can have a maker", rows["Second Tag"] === "Texas Instruments", JSON.stringify(rows));
check("an entity row is not a Bluetooth row", rows.Car === "n/a", JSON.stringify(rows));
check("nothing is asked about any row", asked.slice(askedBefore).filter(m => /vendor|lookup/i.test(JSON.stringify(m))).length === 0, JSON.stringify(asked));
check("no switch for a lookup in the list", !nodes.some(n => n.tagName === "BUTTON" && /look up makers/i.test(n.textContent)));

for (const r of results) console.log(JSON.stringify(r));
console.log(JSON.stringify({ summary: true, cases: results.length, failed }));
process.exit(failed ? 1 : 0);
