// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
//
// A name is text, wherever it comes from. Scanner names (MQTT, the device
// registry), calibration point labels (a beacon's advertised name lands in
// one with nobody typing it) and room names are drawn into markup the panel
// builds as strings. This renders the Health and Calibration views with a
// hostile name in each of those places and reports every innerHTML the
// render produced, so the test can check the name arrived as text.
//
// panel.js's own esc() is used, read out of panel.js, so the check is of
// the helper the views are really handed.

import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { join } from "node:path";
import { install, flush } from "./dom_shim.mjs";

const WWW = process.argv[2];
const NAME = process.argv[3];
install(globalThis);

const src = readFileSync(join(WWW, "panel.js"), "utf-8");
const m = src.match(/function esc\(s\)\{[\s\S]*?\n\}/);
if (!m) { console.error("esc() not found in panel.js"); process.exit(2); }
const esc = new Function(`${m[0]}; return esc;`)();

function el(tag, attrs = {}, children = []) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (k === "class") n.className = v;
    else if (k === "style") n.setAttribute("style", v);
    else if (k.startsWith("on") && typeof v === "function") n.addEventListener(k.slice(2), v);
    else if (v !== undefined && v !== null) n.setAttribute(k, String(v));
  }
  for (const c of (Array.isArray(children) ? children : [children])) {
    if (c === null || c === undefined) continue;
    n.appendChild(typeof c === "string" || typeof c === "number" ? document.createTextNode(String(c)) : c);
  }
  return n;
}

function any(path) {
  const fn = () => document.createElement("span");
  return new Proxy(fn, {
    get(_t, k) {
      if (k === Symbol.toPrimitive || k === "toString") return () => "";
      if (k === "then") return undefined;
      return any(`${path}.${String(k)}`);
    },
  });
}
const loose = (o, path) => new Proxy(o, { get: (t, k) => (k in t ? t[k] : any(`${path}.${String(k)}`)) });

const MAP = { id: "ground", name: "Ground", floor_id: "main", image: { width: 1000, height: 710, filename: "g.png" },
              receivers: [], rooms: [], rf_barriers: [] };
const POINT = (x, y) => ({ id: `p${x}`, map_id: "ground", x_frac: x, y_frac: y, room: NAME, label: NAME,
                           floor_id: "main", scanner_readings: [{ source: "AA:01", mean_rssi: -60 }] });

const STATE = {
  dataMode: "live", timing: {}, settings: { data_mode: "live" },
  model: { floors: [{ id: "main", name: "Main", level: 0 }], areas: [], room_geometry_m: {} },
  maps: { list: [MAP] },
  calibration: { points: [POINT(0.3, 0.4), POINT(0.6, 0.7)], model: {} },
  _calib: { tab: "pin", deviceId: "AA:BB:CC:DD:EE:01", deviceLabel: NAME, mapId: "ground", duration: 15,
            pinX: null, pinY: null, pinRoom: null, pinLabel: "", collecting: false, stopFlag: false,
            readings: null, savedThisSession: 0 },
  live: { snapshot: {
    objects: { list: [] }, radios: [],
    ble: { radios: [{ source: "AA:01", name: NAME }, { source: "AA:02", name: NAME }], advertisements: [] },
    scanner_health: { "AA:01": { reliability: 0.4, agree_pct: 40, polls: 40, room: "Kitchen" },
                      "AA:02": { reliability: 0.5, agree_pct: 50, polls: 40, room: "Den" } },
  } },
};

const out = {};
for (const file of ["health.js", "calibration.js"]) {
  const made = [];
  const realCreate = document.createElement;
  document.createElement = (t) => { const n = realCreate(t); made.push(n); return n; };
  const ctx = loose({
    hass: { states: {}, user: { is_admin: true } },
    state: structuredClone(STATE),
    helpers: loose({ el, esc, mapImageUrl: () => "/x.png", radioShortId: (s) => String(s).slice(-3),
                     helpBtn: () => el("button", {}, "?"), isScanner: () => false,
                     scannerAddrs: () => new Set(), scannerStatus: () => "ok" }, "helpers"),
    actions: loose({ callWS: async () => ({}), wsCall: async () => ({}) }, "actions"),
    toast: () => {},
  }, "ctx");
  let error = null;
  try {
    const mod = await import(pathToFileURL(join(WWW, "views", file)).href);
    const r = mod.render(ctx);
    if (r && typeof r.then === "function") await r;
    await flush();
  } catch (e) { error = String(e && e.stack || e); }
  document.createElement = realCreate;
  out[file] = { error, html: made.map(n => n.innerHTML || "").filter(Boolean) };
}
console.log(JSON.stringify(out));
