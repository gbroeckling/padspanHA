// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
//
// An Android phone's BLE Transmitter set too weak (views/iphone_irk.js
// transmitterAdvice), run for real: the rule on its own, then the shipped
// overview.js drawing Track Your Phone in Basic and Advanced with one phone on
// the app's out-of-the-box settings and one set right. And the Bluetooth
// view's IRK Manager never tells an Android owner to look for a key.
//
// Run: node tests/js/phone_transmitter.mjs <repo root>
// Prints one JSON line: { cases: {name: bool}, failures: [...] }.
import { pathToFileURL } from "node:url";

const ROOT = process.argv[2];
const { install } = await import(pathToFileURL(ROOT + "/tests/js/dom_shim.mjs").href);
install(globalThis);
const VIEWS = ROOT + "/custom_components/padspan_ha/www/padspan-ha/views/";
const IP = await import(pathToFileURL(VIEWS + "iphone_irk.js").href);
const OV = await import(pathToFileURL(VIEWS + "overview.js").href);
const BT = await import(pathToFileURL(VIEWS + "bluetooth.js").href);

const cases = {}, failures = [];
const check = (name, ok, info) => { cases[name] = !!ok; if (!ok) failures.push({ name, info }); };
const wait = () => new Promise(r => (globalThis._realSetTimeout || setTimeout)(r, 5));

function el(tag, attrs = {}, children = []) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (k === "class") n.className = v; else if (k === "style") n.setAttribute("style", v);
    else if (k.startsWith("on") && typeof v === "function") n.addEventListener(k.slice(2), v);
    else if (v !== undefined && v !== null) n.setAttribute(k, String(v));
  }
  if (!Array.isArray(children)) children = [children];
  for (const c of children) { if (c == null) continue; n.appendChild(typeof c === "string" || typeof c === "number" ? document.createTextNode(String(c)) : c); }
  return n;
}
const quiet = () => new Proxy(() => document.createElement("span"), { get: (t, k) => k === "then" ? undefined : quiet() });

// ── The rule ────────────────────────────────────────────────────────────────
const A = IP.transmitterAdvice;
const out = A({ "Transmitting power": "ultraLow", "Advertise mode": "lowPower" });
check("rule: out of the box, both settings and what to set them to",
  out.includes("Transmit power to High") && out.includes("Advertise mode to Low latency") && out.includes("BLE Transmitter"), out);
check("rule: low power alone", A({ "Transmitting power": "low", "Advertise mode": "lowLatency" }).includes("Transmit power to High")
  && !A({ "Transmitting power": "low", "Advertise mode": "lowLatency" }).includes("Advertise mode"));
check("rule: power-saving mode alone", A({ "Transmitting power": "high", "Advertise mode": "lowPower" }).includes("Advertise mode to Low latency")
  && !A({ "Transmitting power": "high", "Advertise mode": "lowPower" }).includes("Transmit power"));
check("rule: medium and balanced are left alone", A({ "Transmitting power": "medium", "Advertise mode": "balanced" }) === "");
check("rule: high and low latency say nothing", A({ "Transmitting power": "high", "Advertise mode": "lowLatency" }) === "");
check("rule: case, spaces and underscores do not matter",
  A({ transmitting_power: "Ultra Low", ADVERTISE_MODE: "low_power" }).includes("Transmit power to High and Advertise mode to Low latency"));
check("rule: nothing reported, nothing said (an iPhone, a disabled sensor)",
  A({}) === "" && A(null) === "" && A(undefined) === "" && A({ id: "x_1_2" }) === "");

// ── Track Your Phone on the Overview ────────────────────────────────────────
const PHONES = [
  { entity_id: "sensor.pixel_ble_transmitter", device_name: "Pixel", ibeacon_key: "ibeacon:x:1:2", is_transmitting: true, is_visible: true,
    state: "Transmitting", attributes: { id: "x_1_2", "Transmitting power": "ultraLow", "Advertise mode": "lowPower" } },
  { entity_id: "sensor.tab_ble_transmitter", device_name: "Tab", ibeacon_key: "ibeacon:y:1:2", is_transmitting: true, is_visible: true,
    state: "Transmitting", attributes: { id: "y_1_2", "Transmitting power": "high", "Advertise mode": "lowLatency" } },
  { entity_id: "", device_name: "Alex's iPhone", model: "iPhone 15", state: "sensor_not_registered", attributes: {} },
];
async function overview(complexity) {
  const state = { view: "overview", dataMode: "live", _dataModeKnown: true, complexity, settings: {}, maps: { list: [] }, model: {},
    followedAddrs: new Set(),
    live: { snapshot: { source: "live", rooms: [], ble: { radios: [], advertisements: [] }, objects: { list: [], summary: {} } } } };
  const helpers = new Proxy({ el, esc: s => String(s ?? ""), helpBtn: () => el("button", {}, "?"), radioShortId: s => String(s || ""),
    roomColor: () => "#fff", isAway: () => false, awayTimeoutS: () => 120, scannerAddrs: () => new Set(), isScanner: () => false,
    scannerStatus: () => "ok", mapImageUrl: () => "" }, { get: (t, k) => k in t ? t[k] : quiet() });
  const actions = new Proxy({ renderRooms: () => {}, callWS: async () => ({}),
    wsCall: async (type) => type === "padspan_ha/companion_discover" ? { phones: PHONES } : {} },
    { get: (t, k) => k in t ? t[k] : quiet() });
  const root = OV.render({ hass: { states: {} }, state, helpers, actions, toast: () => {} });
  for (let i = 0; i < 10; i++) await wait();
  return root;
}
for (const mode of ["basic", "advanced"]) {
  const root = await overview(mode);
  const weak = root.querySelectorAll("[data-phone-weak]");
  check(`${mode}: only the phone on weak settings is warned`, weak.length === 1, weak.map(n => n.textContent));
  const row = weak[0] && weak[0].parentNode;
  check(`${mode}: the warning sits on that phone's own row`, !!row && row.textContent.includes("Pixel") && !row.textContent.includes("Tab"),
    row && row.textContent);
  check(`${mode}: it says what to set`, !!weak[0] && weak[0].textContent.includes("High") && weak[0].textContent.includes("Low latency"));
}

// ── The IRK Manager never sends an Android owner looking for a key ──────────
{
  const state = { btTab: "irk_panel", dataMode: "live", settings: { phone_wizard_enabled: true },
    _irkPanelStatus: { devices: [], rpa_count: 3, total_ble_addresses: 9, mobile_apps: ["Pixel 8"], has_private_ble_integration: true },
    live: { snapshot: { ble: { radios: [], advertisements: [], diag: { ok: true, errors: [] } }, objects: { list: [] } } } };
  const helpers = new Proxy({ el, esc: s => String(s ?? ""), helpBtn: () => el("button", {}, "?"), radioShortId: s => s, isScanner: () => false, roomColor: () => "#fff" },
    { get: (t, k) => k in t ? t[k] : quiet() });
  const actions = new Proxy({ followedHas: () => false, renderRooms: () => {}, wsCall: async () => ({}) }, { get: (t, k) => k in t ? t[k] : quiet() });
  const t = BT.render({ hass: { states: {} }, state, helpers, actions, toast: () => {} }).textContent;
  check("irk manager: no Android key to look for", !/IRK attribute|look for the IRK|stores an IRK when BLE Transmitter/i.test(t), t.slice(0, 400));
  check("irk manager: Android needs none, by its BLE Transmitter", /Android phones don't need one/.test(t) && /None needed: the Companion app's BLE Transmitter/.test(t));
}

console.log(JSON.stringify({ cases, failures }));
