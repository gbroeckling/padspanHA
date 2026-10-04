// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
//
// Mapping → Library → Open in Basic mode (Jay, 2026-10-04). Basic mode has
// only the Library and Upload tabs and render() puts any other tab straight
// back to Library, so Open used to do nothing at all, with no sign why. It
// now switches to Advanced, says so, and opens the plan. In Advanced it just
// opens the plan, as before.

import { pathToFileURL } from "node:url";
import { join } from "node:path";
import { install, flush } from "./dom_shim.mjs";

const VIEWS_DIR = process.argv[2];
install(globalThis);

const results = {};
const check = (name, ok, detail) => { results[name] = { ok: !!ok, detail: ok ? undefined : detail }; };

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
// Anything the Library reaches for that this test does not care about.
const quiet = () => new Proxy(() => document.createElement("span"), {
  get: (_t, k) => (k === "then" ? undefined : k === Symbol.toPrimitive || k === "toString" ? () => "" : quiet()),
  apply: () => document.createElement("span"),
});

function makeCtx(complexity, calls){
  const state = {
    complexity, mapsTab: "library", settings: {}, dataMode: "live", view: "maps",
    maps: { list: [{ id: "m1", name: "Main floor", floor_id: "main", image: { width: 800, height: 600 }, receivers: [], room_bounds: {} }] },
    model: { floors: [{ id: "main", name: "Main", level: 0 }], map_transforms: {} },
  };
  const actions = {
    mapsSetActive: (id) => calls.push(["mapsSetActive", id]),
    setComplexity: (m) => { calls.push(["setComplexity", m]); state.complexity = m; },
    setMapsTab: (t) => { calls.push(["setMapsTab", t, state.complexity]); state.mapsTab = t; },
    renderRooms: () => {}, wsCall: async () => ({}), callWS: async () => ({}),
  };
  return {
    state,
    hass: { states: {} },
    helpers: new Proxy({ el, esc: (s) => String(s ?? ""), helpBtn: () => el("button", {}, "?"),
      mapImageUrl: () => "/x.png", pill: (t) => el("span", {}, String(t ?? "")) },
      { get: (t, k) => (k in t ? t[k] : quiet()) }),
    actions: new Proxy(actions, { get: (t, k) => (k in t ? t[k] : quiet()) }),
    toast: (m, isErr) => calls.push(["toast", String(m), !!isErr]),
  };
}

function find(node, pred){
  if (pred(node)) return node;
  for (const c of node.childNodes || []) { const hit = find(c, pred); if (hit) return hit; }
  return null;
}
const textOf = (n) => (n.textContent || "").trim();

const maps = await import(pathToFileURL(join(VIEWS_DIR, "maps.js")).href);

for (const mode of ["basic", "advanced"]) {
  const calls = [];
  const ctx = makeCtx(mode, calls);
  let root = null;
  try { root = maps.render(ctx); await flush(); }
  catch (e) { check(`${mode}: the Library renders`, false, String(e && e.stack || e)); continue; }
  const open = root && find(root, (n) => n.tagName === "BUTTON" && textOf(n) === "Open");
  check(`${mode}: the Library has an Open button`, !!open, root ? "no Open button" : "render returned nothing");
  if (!open) continue;
  open.click();
  const tab = calls.find(c => c[0] === "setMapsTab");
  const switched = calls.find(c => c[0] === "setComplexity");
  const told = calls.find(c => c[0] === "toast");
  if (mode === "basic") {
    check("basic: Open switches to Advanced before it opens the Edit tab",
      switched && switched[1] === "advanced" && tab && tab[1] === "edit" && tab[2] === "advanced"
      && calls.indexOf(switched) < calls.indexOf(tab), calls);
    check("basic: Open says why the mode changed", told && /Advanced mode/.test(told[1]) && !told[2], calls);
  } else {
    check("advanced: Open just opens the Edit tab", !switched && !told && tab && tab[1] === "edit", calls);
  }
  check(`${mode}: Open makes the plan the active one`, calls.some(c => c[0] === "mapsSetActive" && c[1] === "m1"), calls);
}

console.log(JSON.stringify(results));
