// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
//
// Live Aboard's Map / 3D switch in the shared Atlas card (views/lights_map.js),
// run for real under the DOM shim, with every module load recorded.
//
//   off       the card is byte-identical with the feature absent and off; on
//             but showing Map, the drawing is too and the switch is the only
//             new thing — in every layout, on both screens
//   gate      Pro only (PadSpan Pro and Bright Pro: the effective tier "pro"
//             in either edition): on but at tier free or bright is exactly
//             off — byte-identical, no switch, nothing loaded, even with 3D
//             picked
//   noImport  absent, off, or on but showing Map: live_aboard.js and three.js
//             are never loaded (every module load is recorded)
//   file      nothing reads or writes the 3D file (house3d_get / _edit) while
//             the feature is off, below Pro, or on but showing Map
//   silent    nothing is sent to the usage report while the feature is off
//   switch    on: the switch beside the zoom buttons, and in the rail on the
//             edge-to-edge layout
//   pick      each screen remembers Map or 3D, per browser
//   fallback  on and 3D with no WebGL2: three.js is never downloaded, the
//             flat Atlas stays, house3d_fallback:no_webgl is sent once and
//             remembered for this build, and the greyed 3D button says why in
//             the page; a screen remembered too slow on this build stays flat
//             with nothing loaded or sent, and a new build tries again; a GL
//             that throws is house3d_fallback:error
//   pending   a 3D view still loading never mounts on a card from before the
//             feature was switched off
//
// usage: live_aboard_card.mjs <www/padspan-ha dir>
// prints one JSON line: { cases: {name: result}, loaded: [...], failures: [...] }

import * as nodeModule from "node:module";
import { pathToFileURL } from "node:url";
import { join } from "node:path";
import { install } from "./dom_shim.mjs";

const WWW = process.argv[2];
if (!WWW) { console.error("usage: live_aboard_card.mjs <www/padspan-ha dir>"); process.exit(2); }
// Every module node loads from here on, by URL (the card's dynamic imports
// included). registerHooks runs the hook in this thread, synchronously.
const loaded = [];
if (typeof nodeModule.registerHooks !== "function") {
  console.log(JSON.stringify({ cases: {}, loaded: [], failures: [{ name: "harness", detail: `node ${process.version} has no module.registerHooks (22.15+ / 23.5+)` }] }));
  process.exit(1);
}
nodeModule.registerHooks({ load(url, context, nextLoad) { loaded.push(url); return nextLoad(url, context); } });
install(globalThis);
// Every listener, timer, frame and observer anything asks for, counted as it
// is asked for: absent, off and below Pro must build the card with exactly
// the same ones (a listener or a timer leaves nothing in the markup).
const asked = {};
const counted = (key, fn) => function(...a){ const k = typeof a[0] === "string" ? `${key}:${a[0]}` : key; asked[k] = (asked[k] || 0) + 1; return fn.apply(this, a); };
globalThis.Node.prototype.addEventListener = counted("listen", globalThis.Node.prototype.addEventListener);
globalThis.addEventListener = counted("window", globalThis.addEventListener);
document.addEventListener = counted("document", document.addEventListener);
for (const k of ["setTimeout", "setInterval", "requestAnimationFrame", "queueMicrotask"]) if (typeof globalThis[k] === "function") globalThis[k] = counted(k, globalThis[k]);
for (const k of ["ResizeObserver", "IntersectionObserver", "MutationObserver"]) {
  const C = globalThis[k];
  globalThis[k] = class extends C { constructor(...a){ super(...a); asked[k] = (asked[k] || 0) + 1; } };
}
/** What building with `fn` asked for: {listen:click: 3, setTimeout: 1, ...}. */
function askedBy(fn){
  const before = { ...asked };
  const r = fn();
  const d = {};
  for (const [k, v] of Object.entries(asked)) if (v !== (before[k] || 0)) d[k] = v - (before[k] || 0);
  return { r, d: JSON.stringify(Object.keys(d).sort().map(k => [k, d[k]])) };
}

const LM = await import(pathToFileURL(join(WWW, "views", "lights_map.js")).href);

const failures = [];
const cases = {};
const check = (name, ok, detail) => { cases[name] = !!ok; if (!ok) failures.push({ name, detail: detail === undefined ? null : detail }); };
const tryCase = async (name, fn) => { try { await fn(); } catch (e) { failures.push({ name, detail: String(e && e.stack || e).slice(0, 900) }); cases[name] = false; } };
const sleep = (ms) => new Promise(r => globalThis._realSetTimeout(r, ms));
// Everything the 3D house brings: its modules (the view, the house, its
// use surface, the editor and its rules), the compass, three.js.
const threeLoads = () => loaded.filter(u => /\/views\/(live_aboard(_house|_use|_draft|_edit)?|fabric_compass)\.js|\/vendor\/three\//.test(u));

// ── a small two-storey house with lights ───────────────────────────────────
const rect = (floor_id, x0, y0, x1, y1) => ({ type: "poly", floor_id, points_m: [[x0, y0], [x1, y0], [x1, y1], [x0, y1]] });
const MODEL = {
  floors: [{ id: "main", name: "Main", level: 0 }, { id: "up", name: "Upstairs", level: 1 }],
  floor_elevations: { main: 0, up: 2.8 },
  room_geometry_m: { Kitchen: rect("main", 0, 0, 6, 4), Hall: rect("main", 6.1, 0, 10, 4), Loft: rect("up", 0, 0, 5, 5) },
  light_positions_m: {
    "light.kitchen_pots": { x_m: 3, y_m: 2, floor_id: "main", width_cm: 200, height_cm: 120 },
    "light.hall_pendant": { x_m: 8, y_m: 2, floor_id: "main" },
    "light.loft_strip": { x_m: 2, y_m: 0.3, floor_id: "up", width_cm: 300, height_cm: 5, rotation: 30 },
  },
  rf_barriers_m: [{ id: "bar_1", name: "Front window", material: "glass", floor_id: "main", points_m: [[1, 0], [3, 0]] }],
};
const FLOORS = MODEL.floors;
const STATES = {
  "light.kitchen_pots": { state: "on", attributes: { friendly_name: "Kitchen pots", brightness: 200, rgb_color: [255, 180, 90] } },
  "light.hall_pendant": { state: "off", attributes: { friendly_name: "Hall pendant" } },
  "light.loft_strip": { state: "on", attributes: { friendly_name: "Loft strip", brightness: 120 } },
};
const LIGHTS = LM.gatherLights(STATES, {}, {}, "pro", {}, {}, {}, {}, 1_700_000_000_000);
const LBE = Object.fromEntries(LIGHTS.map(l => [l.entity_id, l]));

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
const sent = [];
// Every read and write of the 3D file the hosts hand over (house3d_get, house3d_edit).
const fileCalls = [];
const H3 = (enabled, slot = "atlas", extra = {}) => ({ slot, settings: { atlas_3d_enabled: enabled, atlas_3d_quality: "auto", ...extra },
  telemetry: (n) => sent.push(n),
  load: () => { fileCalls.push(`load:${slot}`); return Promise.resolve({ data: {} }); },
  edit: (c) => { fileCalls.push(`edit:${slot}`); return Promise.resolve({ data: c }); } });
function card({ house3d, layoutV2 = false, display = false, tier = "pro", M = LM } = {}) {
  const view = { floorGap: 150, horizGap: 0, focusIdx: 0, zoom: 1 };
  const host = { el, view, floors: FLOORS, model: MODEL, byRoom: {}, hiddenEids: new Set(), lightsByEid: LBE, lightsLoading: false,
    tier, layoutV2, displayMode: display, saveView: async () => {}, onHexesBuilt() {} };
  if (house3d !== undefined) host.house3d = house3d;
  const c = M.buildLightsMapCard(host);
  const stage = c._all().find(n => n.classList && n.classList.contains("lv-stage"));
  return { c, stage, svg: stage && stage.innerHTML };
}
// The whole card as text: tags, classes, attributes, inline styles, text,
// markup, form state — everything the shim keeps of what was built.
function ser(n, skip) {
  if (!n) return "";
  if (skip && skip(n)) return "";
  if (n.localName === "#text") return JSON.stringify(n.textContent);
  const attrs = Object.entries(n.attributes || {}).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(" ");
  return `<${n.localName} .class=${JSON.stringify(n.className)} ${attrs} .style=${JSON.stringify(n.style.cssText)}`
    + ` .html=${JSON.stringify(n._html || "")} .text=${JSON.stringify(n._text || "")} .v=${JSON.stringify([n._value, !!n.checked, !!n.disabled])}>`
    + n.children.map(c => ser(c, skip)).join("") + `</${n.localName}>`;
}
const isSwitch = (n) => !!(n.attributes && "data-la3d-switch" in n.attributes);
const switchesIn = (c) => c._all().filter(isSwitch);
const PICK = (slot) => `padspan_lv_3d_${slot}`;

// ── off: nothing changes, nothing loads, nothing is sent ─────────────────────
await tryCase("off: absent and off are byte-identical; on but Map changes only the switch", async () => {
  localStorage.removeItem(PICK("atlas")); localStorage.removeItem(PICK("builder"));
  const out = {};
  for (const [name, layout] of Object.entries({ classic: {}, v2: { layoutV2: true }, display: { layoutV2: true, display: true } })) {
    const A = askedBy(() => card(layout)), O = askedBy(() => card({ ...layout, house3d: H3(false) }));
    const U = askedBy(() => card({ ...layout, house3d: { slot: "atlas", settings: {}, telemetry: (n) => sent.push(n) } }));
    const N = askedBy(() => card({ ...layout, house3d: null }));
    const absent = A.r, off = O.r, unset = U.r, nul = N.r;
    const onMap = card({ ...layout, house3d: H3(true) });
    localStorage.setItem(PICK("builder"), "0");
    const onMapBuilder = card({ ...layout, house3d: H3(true, "builder") });
    const a = ser(absent.c);
    out[name] = {
      absentIsOff: a === ser(off.c) && a === ser(unset.c) && a === ser(nul.c),
      // ...and asks for the same listeners, timers, frames and observers.
      sameAsks: A.d.length > 2 && O.d === A.d && U.d === A.d && N.d === A.d,
      svgSame: absent.svg.length > 1000 && [off, unset, nul, onMap, onMapBuilder].every(x => x.svg === absent.svg),
      onlySwitch: ser(onMap.c, isSwitch) === a && ser(onMapBuilder.c, isSwitch) === a,
      switchShown: switchesIn(onMap.c).length >= 1 && switchesIn(off.c).length === 0,
      stageShown: onMap.stage.style.display !== "none",
    };
  }
  check("off: absent and off are byte-identical; on but Map changes only the switch",
    Object.values(out).every(o => Object.values(o).every(Boolean)), out);
});
await tryCase("gate: on but below Pro (free, bright) is exactly off, even with 3D picked", async () => {
  localStorage.setItem(PICK("atlas"), "1"); localStorage.setItem(PICK("builder"), "1");
  const out = {};
  for (const tier of ["free", "bright"]) {
    for (const [name, layout] of Object.entries({ classic: {}, v2: { layoutV2: true }, display: { layoutV2: true, display: true } })) {
      const A = askedBy(() => card({ ...layout, tier })), On = askedBy(() => card({ ...layout, tier, house3d: H3(true) }));
      const OnB = askedBy(() => card({ ...layout, tier, house3d: H3(true, "builder") })), Off = askedBy(() => card({ ...layout, tier, house3d: H3(false) }));
      const absent = A.r, on = On.r, onB = OnB.r, off = Off.r;
      const a = ser(absent.c);
      out[`${tier}/${name}`] = { same: a === ser(on.c) && a === ser(onB.c) && a === ser(off.c),
        sameAsks: A.d.length > 2 && On.d === A.d && OnB.d === A.d && Off.d === A.d,
        noSwitch: switchesIn(on.c).length === 0 && switchesIn(onB.c).length === 0,
        flat: on.stage.style.display !== "none" && !on.c._all().some(n => n.classList && n.classList.contains("la3d")) };
    }
  }
  await sleep(30);
  localStorage.removeItem(PICK("atlas")); localStorage.removeItem(PICK("builder"));
  check("gate: on but below Pro (free, bright) is exactly off, even with 3D picked",
    Object.values(out).every(o => Object.values(o).every(Boolean)) && threeLoads().length === 0 && sent.length === 0
    && fileCalls.length === 0, { out, loaded: threeLoads(), sent, fileCalls });
});
await tryCase("gate: on at Pro shows the switch, on both screens", async () => {
  localStorage.removeItem(PICK("atlas")); localStorage.removeItem(PICK("builder"));
  const a = card({ tier: "pro", house3d: H3(true, "atlas") }), b = card({ tier: "pro", house3d: H3(true, "builder") });
  const d = card({ tier: "pro", layoutV2: true, display: true, house3d: H3(true, "atlas") });
  check("gate: on at Pro shows the switch, on both screens", switchesIn(a.c).length === 1 && switchesIn(b.c).length === 1
    && switchesIn(d.c).length === 2 && threeLoads().length === 0, { a: switchesIn(a.c).length, b: switchesIn(b.c).length, d: switchesIn(d.c).length });
});
await tryCase("noImport: off never loads the 3D module or three.js", async () => {
  await sleep(50);
  check("noImport: off never loads the 3D module or three.js", threeLoads().length === 0
    && loaded.some(u => /\/views\/lights_map\.js/.test(u)), threeLoads());
});
await tryCase("file: off, below Pro, or on but Map: the 3D file is never read or written", async () => {
  await sleep(30);
  check("file: off, below Pro, or on but Map: the 3D file is never read or written", fileCalls.length === 0, fileCalls);
});
await tryCase("silent: nothing is sent while the feature is off, or on but showing Map", async () => {
  await sleep(20);
  check("silent: nothing is sent while the feature is off, or on but showing Map", sent.length === 0, sent);
});

// ── the switch ──────────────────────────────────────────────────────────────
await tryCase("switch: beside the zoom buttons, and in the rail on the edge-to-edge layout", async () => {
  localStorage.removeItem(PICK("atlas"));
  const classic = card({ house3d: H3(true) }), display = card({ layoutV2: true, display: true, house3d: H3(true) });
  const zoom = (c) => c._all().find(n => n.className === "lv-zoomseg" && !isSwitch(n));
  const seg = (c) => c._all().find(n => isSwitch(n) && n.classList.contains("lv-zoomseg"));
  const z = zoom(classic.c), s = seg(classic.c);
  const nextToZoom = z && s && z.parentNode === s.parentNode && s.parentNode.children.indexOf(s) === s.parentNode.children.indexOf(z) + 1;
  const buttons = s ? s.children.filter(b => b.localName === "button").map(b => [b.textContent, b.getAttribute("aria-pressed")]) : [];
  const rail = display.c._all().find(n => n.classList && n.classList.contains("lv-rail"));
  const railBtn = rail && rail.children.find(isSwitch);
  const hideBtn = rail && rail.children[rail.children.length - 1];
  check("switch: beside the zoom buttons, and in the rail on the edge-to-edge layout",
    nextToZoom && JSON.stringify(buttons) === JSON.stringify([["Map", "true"], ["3D", "false"]])
    && railBtn && railBtn.classList.contains("lv-railbtn") && !railBtn.classList.contains("on") && railBtn !== hideBtn
    && !!seg(display.c), { nextToZoom, buttons, rail: !!railBtn });
});
await tryCase("pick: each screen remembers Map or 3D, per browser", async () => {
  localStorage.removeItem(PICK("atlas")); localStorage.removeItem(PICK("builder"));
  // Off in this process for the pick itself: no WebGL, and nothing loads
  // until a 3D view is wanted — so the click is checked by what it stores.
  const a = card({ house3d: H3(true, "atlas") });
  const seg = a.c._all().find(n => isSwitch(n) && n.classList.contains("lv-zoomseg"));
  const btn3d = seg.children.find(b => b.textContent === "3D"), btnMap = seg.children.find(b => b.textContent === "Map");
  btnMap.click();
  const afterMap = localStorage.getItem(PICK("atlas"));
  const b = card({ house3d: H3(true, "builder") });
  const builderStill = localStorage.getItem(PICK("builder"));
  const mapPressed = b.c._all().find(n => isSwitch(n) && n.classList.contains("lv-zoomseg")).children.find(x => x.textContent === "Map").getAttribute("aria-pressed");
  check("pick: each screen remembers Map or 3D, per browser", afterMap === "0" && builderStill === null && mapPressed === "true"
    && btn3d && threeLoads().length === 0, { afterMap, builderStill, mapPressed });
});

// ── fallback: on and 3D, in a place with no WebGL ───────────────────────────
const NodeCls = globalThis.Node;
const realGetContext = NodeCls.prototype.getContext;
async function waitFor(fn, ms = 8000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (fn()) return true; await sleep(20); }
  return false;
}
// A fresh copy of the card's module, as a reload gives (its own 3D state; the
// query is its build, as the panel's cache-busting query is).
const reload = (build) => import(pathToFileURL(join(WWW, "views", "lights_map.js")).href + build);
const FAILED = "padspan_la3d_failed";
const loadsOf = (build) => loaded.filter(u => u.endsWith("/views/live_aboard.js" + build) || u.includes("/vendor/three/three.module.min.js" + build));
const glNone = function (kind, ...a) { return /webgl/i.test(String(kind)) ? null : realGetContext.call(this, kind, ...a); };
const glThrows = function (kind, ...a) {
  return /webgl/i.test(String(kind)) ? new Proxy({}, { get: () => () => undefined }) : realGetContext.call(this, kind, ...a);
};
const why3d = (c) => { const w = c._all().find(n => n.attributes && "data-la3d-why" in n.attributes); return w && w.style.display !== "none" ? w.textContent : ""; };
const seg3d = (c) => c._all().find(n => isSwitch(n) && n.classList.contains("lv-zoomseg")).children.find(b => b.textContent === "3D");
await tryCase("fallback: no WebGL keeps the flat Atlas, downloads nothing, is counted once and says why", async () => {
  NodeCls.prototype.getContext = glNone;
  sent.length = 0;
  localStorage.removeItem(PICK("atlas")); localStorage.removeItem(FAILED);
  const M = await reload("?page=nogl");
  const one = card({ house3d: H3(true, "atlas"), M });
  seg3d(one.c).click();
  const stored = localStorage.getItem(PICK("atlas"));
  const counted = await waitFor(() => sent.includes("house3d_fallback:no_webgl"), 500);
  // The next poll's card: the stored pick is 3D; this screen cannot.
  const two = card({ house3d: H3(true, "atlas"), M });
  await sleep(30);
  const b3 = seg3d(two.c), kept = JSON.parse(localStorage.getItem(FAILED) || "null");
  const flat = [one, two].every(x => x.stage.style.display !== "none" && !x.c._all().some(n => n.classList && n.classList.contains("la3d")));
  check("fallback: no WebGL keeps the flat Atlas, downloads nothing, is counted once and says why", stored === "1" && counted && flat
    && loadsOf("?page=nogl").length === 0 && JSON.stringify(sent) === JSON.stringify(["house3d_fallback:no_webgl"])
    && b3.getAttribute("aria-disabled") === "true" && !b3.disabled && /WebGL/.test(b3.getAttribute("title") || "") && /WebGL/.test(why3d(two.c))
    && kept && kept.build === "?page=nogl" && kept.why === "no_webgl",
    { stored, counted, flat, loads: loadsOf("?page=nogl"), sent: [...sent], why: why3d(two.c), kept });
});
await tryCase("fallback: a screen too slow on this build stays flat on a reload: nothing loaded or sent, and it says why", async () => {
  NodeCls.prototype.getContext = glThrows;               // WebGL there: only the memory keeps it flat
  sent.length = 0;
  localStorage.setItem(PICK("atlas"), "1");
  localStorage.setItem(FAILED, JSON.stringify({ build: "?page=slow", why: "slow_gpu" }));
  const M = await reload("?page=slow");
  const a = card({ house3d: H3(true, "atlas"), M }), d = card({ house3d: H3(true, "atlas"), M, layoutV2: true, display: true });
  await sleep(60);
  // On the edge-to-edge layout a tap on the greyed rail button opens the
  // drawer where the switch says why.
  const rail = d.c._all().find(n => isSwitch(n) && n.classList.contains("lv-railbtn"));
  rail.click();
  const drawer = d.c._all().find(n => n.classList && n.classList.contains("lv-drawer") && n.classList.contains("open"));
  check("fallback: a screen too slow on this build stays flat on a reload: nothing loaded or sent, and it says why",
    loadsOf("?page=slow").length === 0 && sent.length === 0 && /too slow/.test(why3d(a.c)) && seg3d(a.c).getAttribute("aria-disabled") === "true"
    && a.stage.style.display !== "none" && rail.getAttribute("aria-disabled") === "true" && !rail.disabled && !!drawer && /too slow/.test(why3d(drawer)),
    { loads: loadsOf("?page=slow"), sent: [...sent], why: why3d(a.c), drawer: !!drawer });
});
await tryCase("fallback: a new build tries again", async () => {
  NodeCls.prototype.getContext = glThrows;
  sent.length = 0;
  localStorage.setItem(PICK("atlas"), "1");
  localStorage.setItem(FAILED, JSON.stringify({ build: "?page=slow", why: "slow_gpu" }));
  const M = await reload("?page=newer");
  card({ house3d: H3(true, "atlas"), M });
  const tried = await waitFor(() => loadsOf("?page=newer").length === 2);
  const counted = await waitFor(() => sent.includes("house3d_fallback:error"));
  check("fallback: a new build tries again", tried && counted, { loads: loadsOf("?page=newer"), sent: [...sent] });
});
await tryCase("pending: a 3D view still loading never mounts on a card from before the feature went off", async () => {
  // Its GL throws, so a mount anywhere would be counted as an error.
  NodeCls.prototype.getContext = glThrows;
  sent.length = 0;
  localStorage.setItem(PICK("atlas"), "1"); localStorage.removeItem(FAILED);
  const M = await reload("?page=pending");
  const on = card({ house3d: H3(true, "atlas"), M });   // 3D wanted: the module starts loading
  const off = card({ house3d: H3(false, "atlas"), M });  // the next poll: the feature is off
  const loadedIt = await waitFor(() => loadsOf("?page=pending").length === 2);
  await sleep(150);
  const mounted = [on, off].some(x => x.c._all().some(n => n.classList && n.classList.contains("la3d")) || x.stage.style.display === "none");
  check("pending: a 3D view still loading never mounts on a card from before the feature went off",
    loadedIt && !mounted && sent.length === 0, { loadedIt, mounted, sent: [...sent] });
  NodeCls.prototype.getContext = realGetContext;
  localStorage.removeItem(PICK("atlas")); localStorage.removeItem(FAILED);
});
await tryCase("fallback: a GL that throws is an error, and the card still draws", async () => {
  // A context that answers nothing: three.js throws while starting up.
  NodeCls.prototype.getContext = function (kind, ...a) {
    return /webgl/i.test(String(kind)) ? new Proxy({}, { get: () => () => undefined }) : realGetContext.call(this, kind, ...a);
  };
  sent.length = 0;
  localStorage.setItem(PICK("builder"), "1");
  const one = card({ house3d: H3(true, "builder") });
  const counted = await waitFor(() => sent.includes("house3d_fallback:error"));
  const two = card({ house3d: H3(true, "builder") });
  check("fallback: a GL that throws is an error, and the card still draws", counted && /<svg/.test(two.svg)
    && two.stage.style.display !== "none" && one.stage.style.display !== "none" && JSON.stringify(sent) === JSON.stringify(["house3d_fallback:error"]),
    { counted, sent: [...sent] });
  NodeCls.prototype.getContext = realGetContext;
});

console.log(JSON.stringify({ cases, failures, loaded: threeLoads().map(u => u.replace(/^.*\/padspan-ha\//, "")) }));
process.exit(failures.length ? 1 : 0);
