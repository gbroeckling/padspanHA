// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
//
// Quiet mode (a panel-only filter that hides untagged Bluetooth devices).
// Renders Bluetooth (radio map, scanner detail, advertisements), Objects,
// Monitor, Overview (Basic) and Settings with quiet mode on and off, and
// prints what each drew. With quiet mode off nothing may differ from before.
import { pathToFileURL } from "node:url";
const ROOT = process.argv[2];
const { install } = await import(pathToFileURL(ROOT + "/tests/js/dom_shim.mjs").href);
install(globalThis);
const V = (n) => import(pathToFileURL(ROOT + "/custom_components/padspan_ha/www/padspan-ha/views/" + n).href);
const BT = await V("bluetooth.js"), OBJ = await V("objects.js"), MON = await V("monitor.js"),
      OV = await V("overview.js"), SET = await V("settings.js");

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
const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const recorder = () => new Proxy(() => document.createElement("span"), {
  get: (t, k) => k === "then" ? undefined : (k === Symbol.toPrimitive || k === "toString") ? () => "" : recorder() });
const ser = (n) => {
  if (!n) return "";
  let out = (n._html || n.innerHTML || "") + (n._text || n.textContent || "") + " "
    + Object.entries(n.attributes || n._attrs || {}).map(([k, v]) => k + "=" + v).join(" ");
  for (const c of (n.children || n.childNodes || [])) out += " " + ser(c);
  return out;
};

// One scanner hearing 30 strangers, louder than the house's own three:
// a labelled one, an identified one and a followed one, all ranked past 24.
const hex = (i) => i.toString(16).toUpperCase().padStart(2, "0");
const strangers = Array.from({ length: 30 }, (_, i) => ({ address: `AA:00:00:00:00:${hex(i)}`, source: "kit", rssi: -40 - i, age_s: 1 }));
const own = [
  { address: "BB:00:00:00:00:01", source: "kit", rssi: -90, age_s: 1, name: "keys" },
  { address: "BB:00:00:00:00:02", source: "kit", rssi: -91, age_s: 1, name: "watch" },
  { address: "BB:00:00:00:00:03", source: "kit", rssi: -92, age_s: 1, name: "dog" },
];
const ADS = [...strangers, ...own];
const OBJECTS = [
  { key: "ble:BB:00:00:00:00:01", address: "BB:00:00:00:00:01", kind: "ble", name: "Keys", user_label: "Keys" },
  { key: "ble:BB:00:00:00:00:02", address: "BB:00:00:00:00:02", kind: "ble", name: "Watch", identified: true },
  { key: "ble:BB:00:00:00:00:03", address: "BB:00:00:00:00:03", kind: "ble", name: "Dog" },
  ...strangers.slice(0, 5).map(a => ({ key: "ble:" + a.address, address: a.address, kind: "ble", name: a.address })),
];
const FOLLOWED = new Set(["BB:00:00:00:00:03"]);

function draw(mod, quiet, extra = {}) {
  const state = {
    dataMode: "live", _dataModeKnown: true, complexity: "basic", view: "overview",
    settings: { quiet_mode: quiet, radio_map_enabled: true, telemetry_enabled: false },
    followedAddrs: FOLLOWED, timing: {}, wsCounts: {}, roomTagMap: {}, model: { floors: [], areas: [] }, maps: [],
    live: { snapshot: {
      ble: { radios: [{ source: "kit", name: "kit", display_name: "Kitchen proxy" }], advertisements: ADS, diag: { ok: true, errors: [] } },
      objects: { list: OBJECTS, summary: { total: 8, identified: 1, unidentified: 7, ble: 8, entities: 0 } },
    } },
    ...extra,
  };
  const helpers = new Proxy({ el, esc, helpBtn: () => el("button", {}, "?"), radioShortId: () => "", isScanner: () => false,
    roomColor: () => "#fff", pill: (t) => el("span", {}, String(t ?? "")), HELP: {} }, { get: (t, k) => k in t ? t[k] : recorder() });
  const actions = new Proxy({ followedHas: (a) => !!a && FOLLOWED.has(String(a).toUpperCase()), renderRooms: () => {},
    settingsSet: async () => ({}), callWS: async () => ({}), wsCall: async () => ({}) }, { get: (t, k) => k in t ? t[k] : recorder() });
  const ctx = new Proxy({ hass: { states: {}, connection: { sendMessagePromise: async () => ({}) } }, state, helpers, actions, toast: () => {} },
    { get: (t, k) => k in t ? t[k] : recorder() });
  try { return ser(mod.render(ctx)); } catch (e) { return "THREW " + (e && e.stack || e); }
}

const out = {};
for (const quiet of [false, true]) {
  const q = quiet ? "on" : "off";
  out[q] = {
    map: draw(BT, quiet, { btTab: "visualization" }),
    scanner: draw(BT, quiet, { btTab: "scanners", _scannerSel: "kit" }),
    adverts: draw(BT, quiet, { btTab: "monitor" }),
    objects: draw(OBJ, quiet),
    objectsAdv: draw(OBJ, quiet, { complexity: "advanced", view: "objects" }),
    monitor: draw(MON, quiet),
    overview: draw(OV, quiet),
    settings: draw(SET, quiet, { complexity: "advanced", _settingsTab: "presence" }),
  };
}
console.log(JSON.stringify(out));
