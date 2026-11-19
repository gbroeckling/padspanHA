// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
//
// The phone wizard's "I have an IRK Capture ESP32" (views/iphone_irk.js
// renderCaptureSteps, drawn by bluetooth.js), run for real under the DOM
// shim: name and person first, iPhone and Apple Watch each their own
// pairing words, the key saved under the name typed (never "Auto-detected"),
// labelled and given to the person, then remove the pairing and refresh the
// ESP32 before the next device; Android told this is not its way. And the
// IRK Manager's Auto-detect never saves a board's key under the board's name.
//
// Run: node tests/js/irk_capture_steps.mjs <repo root>
// Prints one JSON line: { cases: {name: bool}, failures: [...] }.
import { pathToFileURL } from "node:url";

const ROOT = process.argv[2];
const { install } = await import(pathToFileURL(ROOT + "/tests/js/dom_shim.mjs").href);
install(globalThis);
const VIEWS = ROOT + "/custom_components/padspan_ha/www/padspan-ha/views/";
const BT = await import(pathToFileURL(VIEWS + "bluetooth.js").href);
const IP = await import(pathToFileURL(VIEWS + "iphone_irk.js").href);

const cases = {}, failures = [];
const check = (name, ok, info) => { cases[name] = !!ok; if (!ok) failures.push({ name, info }); };
const wait = async (n = 6) => { for (let i = 0; i < n; i++) await new Promise(r => (globalThis._realSetTimeout || setTimeout)(r, 2)); };

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
const quiet = () => new Proxy(() => document.createElement("span"), { get: (t, k) => k === "then" ? undefined : quiet() });
const find = (root, sel) => root.querySelector(sel);
const KEY = "00112233445566778899aabbccddeeff";

// The IRK Manager with the wizard on, and every WS call it makes.
function screen(answers = {}) {
  const calls = [];
  const state = { btTab: "irk_panel", dataMode: "live", settings: { phone_wizard_enabled: true, atlas_3d_carries: { "person.kim": ["irk:aa"] } },
    _irkPanelStatus: { devices: [], rpa_count: 3, total_ble_addresses: 9, mobile_apps: [], has_private_ble_integration: true },
    live: { snapshot: { ble: { radios: [], advertisements: [], diag: { ok: true, errors: [] } }, objects: { list: [] } } } };
  const hass = { states: {
    "person.sam": { entity_id: "person.sam", state: "home", attributes: { friendly_name: "Sam" } },
    "person.kim": { entity_id: "person.kim", state: "home", attributes: { friendly_name: "Kim" } },
    "light.x": { entity_id: "light.x", state: "on", attributes: {} } } };
  const helpers = new Proxy({ el, esc: s => String(s ?? ""), helpBtn: () => el("button", {}, "?"), radioShortId: s => s, isScanner: () => false, roomColor: () => "#fff" },
    { get: (t, k) => k in t ? t[k] : quiet() });
  const actions = new Proxy({ followedHas: () => false, renderRooms: () => {},
    wsCall: async (type, msg) => {
      calls.push([type, msg]);
      if (type in answers) return typeof answers[type] === "function" ? answers[type](msg) : answers[type];
      return {};
    } }, { get: (t, k) => k in t ? t[k] : quiet() });
  const ctx = { hass, state, helpers, actions, toast: () => {} };
  const draw = () => {
    const root = BT.render(ctx);
    let path = null;
    (function walk(n) { if (path || !n) return; const kids = n.children || [];
      if (kids[0] && kids[0].textContent === "I have an IRK Capture ESP32") { path = n; return; } kids.forEach(walk); })(root);
    return { root, path };
  };
  return { ctx, state, calls, draw };
}

const DETECT = {
  "padspan_ha/irk_auto_detect": { found: [{ name: "IRK Capture 1", irk_hex: KEY, source: "irk_capture", already_registered: false, verified: true }],
    capture_devices: [{ name: "IRK Capture 1", has_key: true, profile: "Keyboard", refresh: "IRK Capture 1 Refresh BLE Identity" }] },
  "padspan_ha/irk_add": (m) => ({ ok: true, name: m.name, irk_hex: KEY, canonical_id: `irk:${KEY}`, verified: true, matched_count: 2 }),
  "padspan_ha/settings_set": (m) => ({ settings: { atlas_3d_carries: m.atlas_3d_carries } }),
  "padspan_ha/private_ble_status": { devices: [], rpa_count: 3, total_ble_addresses: 9, mobile_apps: [], has_private_ble_integration: true },
};

// ── The steps as drawn ──────────────────────────────────────────────────────
{
  const s = screen(DETECT);
  let { path } = s.draw();
  const t = path ? path.textContent : "";
  check("steps: the path is drawn", !!path);
  check("steps: Android is told this is not its way", /Android phones can't be added this way/.test(t) && /BLE Transmitter/.test(t), t);
  check("steps: name and person come first", t.indexOf("1. Its name, and whose it is") >= 0
    && t.indexOf("1. Its name") < t.indexOf("2. Pair it") && !!find(path, '[data-capture="name"]') && !!find(path, '[data-capture="person"]'));
  const opts = find(path, '[data-capture="person"]').children.map(o => o.textContent);
  check("steps: the people to pick from are Home Assistant's", JSON.stringify(opts) === JSON.stringify(["Nobody in particular", "Kim", "Sam"]), opts);
  check("steps: an iPhone pairs under Settings → Bluetooth", /On the iPhone, open Settings → Bluetooth/.test(find(path, '[data-capture="pair"]').textContent));
  check("steps: then remove the pairing, and refresh before the next device",
    /Forget This Device/.test(find(path, '[data-capture="forget"]').textContent) && /4\. Once it's saved, remove the pairing/.test(t)
    && /5\. Before the next device/.test(t) && /Refresh BLE Identity/.test(find(path, '[data-capture="next"]').textContent));
  find(path, '[data-capture-kind="watch"]').click();
  ({ path } = s.draw());
  check("steps: an Apple Watch pairs under Health Devices, and is removed from the watch",
    /On the watch, open Settings → Bluetooth and tap the ESP32 under Health Devices/.test(find(path, '[data-capture="pair"]').textContent)
    && /On the watch: Settings → Bluetooth/.test(find(path, '[data-capture="forget"]').textContent)
    && find(path, '[data-capture-kind="watch"]').attributes["aria-pressed"] === "true");
  check("steps: no Scan-for-devices button that never read the ESP32", !/Scan for IRK Capture devices/.test(t));
}

// ── Find, name, save ────────────────────────────────────────────────────────
{
  const s = screen(DETECT);
  let { path } = s.draw();
  find(path, '[data-capture="find"]').click();
  await wait();
  const row = find(path, '[data-capture-key="irk_capture"]');
  check("save: the key the ESP32 holds is offered", !!row && /A key from “IRK Capture 1”, heard right now/.test(row.textContent), row && row.textContent);
  row.querySelector("button").click();
  await wait();
  check("save: no name, no save", !s.calls.some(c => c[0] === "padspan_ha/irk_add") && /Type its name first/.test(row.textContent), row.textContent);
  s.state._irkCapture.name = "Sam's iPhone";
  s.state._irkCapture.person = "person.sam";
  ({ path } = s.draw());
  find(path, '[data-capture-key="irk_capture"]').querySelector("button").click();
  await wait(12);
  const add = s.calls.find(c => c[0] === "padspan_ha/irk_add");
  check("save: under the name typed, never the board's or Auto-detected", !!add && add[1].name === "Sam's iPhone" && add[1].irk_hex === KEY, add);
  const label = s.calls.find(c => c[0] === "padspan_ha/object_label_set");
  check("save: the device gets that name", !!label && label[1].address === `irk:${KEY}` && label[1].label === "Sam's iPhone", label);
  const carries = s.calls.find(c => c[0] === "padspan_ha/settings_set");
  check("save: and goes to the person picked, keeping what others carry",
    !!carries && JSON.stringify(carries[1].atlas_3d_carries) === JSON.stringify({ "person.kim": ["irk:aa"], "person.sam": [`irk:${KEY}`] }), carries);
  s.draw(); await wait();          // the saved key reloads the IRK Manager's status first
  ({ path } = s.draw());
  check("save: it says so, and what comes next", /✓ Saved “Sam's iPhone”\. Now do steps 4 and 5\./.test(find(path, '[data-capture="msg"]').textContent),
    find(path, '[data-capture="msg"]').textContent);
  check("save: the name and person are cleared for the next device", s.state._irkCapture.name === "" && s.state._irkCapture.person === "");
  check("save: the next device's step names the ESP32's own button", /“IRK Capture 1 Refresh BLE Identity”/.test(find(path, '[data-capture="next"]').textContent));
}
{
  // The paste route, nobody picked.
  const s = screen(DETECT);
  s.state._irkCapture = { name: "Hall tablet", person: "", kind: "iphone", found: null, devices: [], done: "" };
  const { path } = s.draw();
  find(path, '[data-capture="paste"]').value = KEY;
  find(path, '[data-capture="paste-save"]').click();
  await wait(12);
  check("save: a pasted key, nobody picked: saved and named, no one's things changed",
    s.calls.some(c => c[0] === "padspan_ha/irk_add" && c[1].name === "Hall tablet")
    && s.calls.some(c => c[0] === "padspan_ha/object_label_set") && !s.calls.some(c => c[0] === "padspan_ha/settings_set"), s.calls.map(c => c[0]));
}

// ── Why there is nothing to save ────────────────────────────────────────────
{
  const F = IP.captureFindings;
  check("findings: a new key is offered", F([{ name: "B", irk_hex: KEY, source: "irk_capture" }], []).keys.length === 1);
  check("findings: a key PadSpan has already says whose, and to refresh first",
    /already has \(“Sam's iPhone”\)\. Do step 5/.test(F([{ name: "B", irk_hex: KEY, source: "irk_capture", already_registered: true, registered_as: "Sam's iPhone" }], []).note));
  check("findings: a board with no key yet says to pair", /“B” has no key yet\. Pair the device/.test(F([], [{ name: "B", has_key: false }]).note));
  check("findings: no board says where to add it, and the paste box", /No irk-capture ESP32 found/.test(F([], []).note) && /paste the key/.test(F([], []).note));
}

// ── The IRK Manager's Auto-detect ───────────────────────────────────────────
{
  const s = screen(DETECT);
  const { root } = s.draw();
  const btn = root.querySelectorAll("button").find(b => b.textContent === "Auto-detect IRKs");
  btn.click();
  await wait(12);
  check("manager: a board's key is never saved under the board's name", !s.calls.some(c => c[0] === "padspan_ha/irk_add"), s.calls.map(c => c[0]));
  const box = root.querySelectorAll("input").find(i => (i.attributes.placeholder || "").startsWith("IRK (hex, base64"));
  check("manager: it goes in the box, to be named", !!box && box.value === KEY && /type the name of the iPhone or watch/.test(root.textContent), box && box.value);
}

// ── The IRK Capture tool card ───────────────────────────────────────────────
{
  const s = screen({});
  s.state.btTab = "esphome_configs";
  const t = BT.render(s.ctx).textContent;
  check("card: for iPhones and Apple Watches, not Android phones", /For iPhones and Apple Watches\. Not for Android phones/.test(t) && !/Android \(keyboard profile\)/.test(t));
}

console.log(JSON.stringify({ cases, failures }));
