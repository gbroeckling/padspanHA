// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
//
// A small Traceback harness: a ctx with a three-floor fabric, one photo, a
// recording wsCall/callWS, and the real views/traceback.js. Written by the
// 2026-09-23 adversarial review to reproduce Traceback mode/house bugs; kept
// so tests/test_traceback_house_modes.py can pin the fixes.
import { install, flush, rafQueue, timerQueue } from "./dom_shim.mjs";
const VIEWS = new URL("../../custom_components/padspan_ha/www/padspan-ha/views/", import.meta.url).href;
install(globalThis);
globalThis.performance = globalThis.performance || { now: () => Date.now() };

export function el(tag, attrs = {}, children = []) {
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
const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const RECT = (fid, x0, y0, x1, y1) => ({ type: "poly", floor_id: fid, points_m: [[x0, y0], [x1, y0], [x1, y1], [x0, y1]] });
export const MODEL = {
  floors: [ { id: "basement", name: "Basement", level: -1 }, { id: "main", name: "Main", level: 0 }, { id: "upper", name: "Upper", level: 1 } ],
  areas: [{ id: "kitchen", name: "Kitchen", floor_id: "main" }],
  room_geometry_m: { Shop: RECT("basement", -4, -18, 11, 12), Kitchen: RECT("main", -3, -16, 16, 12), Living: RECT("main", 0, -9, 8, 1), Bed: RECT("upper", 3, -21, 12, 6) },
  room_meta: {}, light_positions_m: { "light.kitchen": { x_m: 5, y_m: -3, floor_id: "main" } },
  beacon_positions_m: {}, rf_barriers_m: [], floor_elevations: { basement: 0, main: 3.0, upper: 5.3 },
  map_transforms: { ground: { scale_x_m: 20, scale_y_m: 14.2, reference_measurements: [{ m: 20 }] } },
  scanners: {},
};
export const MAPS = [{ id: "ground", name: "Ground.png", floor_id: "main", image: { width: 1000, height: 710 },
  stack: { scale: 1, scale_x_adj: 1, ref_ar: 0.71, rotation: 0, x_offset: 0, y_offset: 0, z_level: 0, floor_id: "main" },
  receivers: [], rooms: [], rf_barriers: [] }];

export function makeCtx({ state = {}, wsCall, callWS, states = {} } = {}) {
  const calls = [];
  const helpers = { el, esc, roomColor: () => "#52b788", helpBtn: () => el("button", {}, "?") };
  const actions = {
    wsCall: async (type, data) => { calls.push({ type, data }); return wsCall ? wsCall(type, data) : {}; },
    settingsSet: async () => ({}), showObjectDetail: () => {},
  };
  const ctx = {
    hass: { states, callWS: async (msg) => { calls.push({ type: msg.type, data: msg }); return callWS ? callWS(msg) : {}; } },
    state: { model: MODEL, maps: { list: MAPS }, settings: { tier: "pro" }, live: { snapshot: { ble: { radios: [] }, objects: { list: [] } } }, _modelLoaded: true, ...state },
    helpers, actions, toast: () => {},
  };
  return { ctx, calls };
}
export const TB = await import(VIEWS + "traceback.js?b=1");
export const HA = await import(VIEWS + "house_activity.js?b=1");
export { flush, rafQueue, timerQueue };
