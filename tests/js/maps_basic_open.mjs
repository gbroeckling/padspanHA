// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
//
// Mapping → Library → Open in Basic mode (Jay, 2026-10-04). Basic mode has
// only the Library and Upload tabs and render() puts any other tab straight
// back to Library, so Open used to do nothing at all, with no sign why. It
// switched to Advanced for a while. Since 2026-10-30 Basic's Open opens the
// plan in the Setup Wizard at its scale step, Basic's own way through a plan
// (scale, rooms, scanners), each step with only its tool; Basic stays Basic.
// In Advanced it just opens the plan in Edit, as before.

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
    check("basic: Open opens the plan in the Setup Wizard at its scale step; the mode stays Basic",
      !switched && !told && !tab && ctx.state._mapsWizard && ctx.state._mapsWizard.step === 2 && ctx.state._mapsWizard.mapId === "m1"
      && ctx.state.complexity === "basic", [calls, ctx.state._mapsWizard]);
    // Each step's editor has only its tool: no Signal walls, Sub-zones or the others beside it.
    const toolsAt = async (step) => {
      ctx.state._mapsWizard.step = step;
      const r = maps.render(ctx); await flush();
      const t = [];
      (function walk(n){ if (n.getAttribute && n.getAttribute("data-edit-tool")) t.push(n.getAttribute("data-edit-tool")); for (const c of n.childNodes || []) walk(c); })(r);
      return { t, r };
    };
    const sc = await toolsAt(2), ro = await toolsAt(3), rx = await toolsAt(4);
    check("basic: the wizard's steps have one tool each (Measure, Rooms, Radios)",
      JSON.stringify(sc.t) === '["measure"]' && JSON.stringify(ro.t) === '["rooms"]' && JSON.stringify(rx.t) === '["receivers"]', [sc.t, ro.t, rx.t]);
    check("basic: no Signal walls anywhere in the wizard", ![sc.r, ro.r, rx.r].some(r => /Signal walls|Enclose \(3dB walls\)/.test(textOf(r))), null);
    // A remembered Edit tab without a link (the menu forgot it): Library, as before.
    ctx.state._mapsWizard = null;
    ctx.state.mapsTab = "edit"; ctx.state._focus = null;
    maps.render(ctx);
    check("basic: without a link Edit still falls back to Library", ctx.state.mapsTab === "library", ctx.state.mapsTab);
  } else {
    check("advanced: Open just opens the Edit tab", !switched && !told && tab && tab[1] === "edit" && !ctx.state._mapsWizard, calls);
    // Advanced's wizard keeps every tool.
    ctx.state._mapsWizard = { step: 3, mapId: "m1" };
    const r = maps.render(ctx); await flush();
    const t = [];
    (function walk(n){ if (n.getAttribute && n.getAttribute("data-edit-tool")) t.push(n.getAttribute("data-edit-tool")); for (const c of n.childNodes || []) walk(c); })(r);
    check("advanced: the wizard's Rooms step still has every tool", ["receivers", "rooms", "barriers", "measure"].every(x => t.includes(x)), t);
  }
  check(`${mode}: Open makes the plan the active one`, calls.some(c => c[0] === "mapsSetActive" && c[1] === "m1"), calls);
}

console.log(JSON.stringify(results));
