// The sidebar Atlas's lights index, kept between polls (lights_map.js
// buildLightsTable with host.keepTable; lights_panel.js _render), run for real:
//   keep      the same card stays: only the rows whose device changed are
//             built again, the header only when its counts change, and the
//             result is always what a new card makes
//   rebuild   a filter, the sort, hidden lights, another map, a setting, a
//             card no longer on screen: a new card, as before
//   focus     on the poll's update a row or header holding the focused
//             control stays; any other update replaces it
//   wiring    a kept row is wired once, and its handlers reach the newest host
//   card      the map card (buildLightsMapCard with host.keepCard): the same
//             card and stage across ticks of lights, people and weather,
//             always what a new card makes; what it is built from changing
//             builds a new one; the layer bar comes again only when what it
//             shows changed; its controls reach the newest host; 500 ticks
//             leave the same listeners and observers
//   panel     lights_panel.js: the index and the map card stay on screen
//             across renders, everything else is built again, and the page
//             is what a full rebuild makes
//
// usage: atlas_keep_card.mjs <www/padspan-ha dir>
// prints one JSON line: { cases: {name: result}, failures: [...] }

import { pathToFileURL } from "node:url";
import { join } from "node:path";
import { install, flush, timerQueue } from "./dom_shim.mjs";

const WWW = process.argv[2];
if (!WWW) { console.error("usage: atlas_keep_card.mjs <www/padspan-ha dir>"); process.exit(2); }
install(globalThis);

const failures = [];
const cases = {};
const check = (name, ok, detail) => { cases[name] = !!ok; if (!ok) failures.push({ name, detail: detail === undefined ? null : detail }); };
const tryCase = async (name, fn) => { try { await fn(); } catch (e) { failures.push({ name, detail: String(e && e.stack || e).slice(0, 900) }); cases[name] = false; } };

// ── what the shim leaves out: on screen or not, and the focused control ─────
const proto = Object.getPrototypeOf(document.createElement("div"));
const top = (n) => { while (n.parentNode) n = n.parentNode; return n; };
Object.defineProperty(proto, "isConnected", { configurable: true, get() { const t = top(this); return t === document || t._screen === true; } });
proto.getRootNode = function () { return top(this); };
// A node taken out has no parent any more, as in a browser (the shim keeps the old one).
const _remove = proto.removeChild;
proto.removeChild = function (c) { const r = _remove.call(this, c); if (c && this.children.indexOf(c) < 0 && c.parentNode === this) c.parentNode = null; return r; };
const screen = () => { const s = document.createElement("#screen"); s._screen = true; s.activeElement = null; return s; };

// Everything a node shows and holds, as one string.
function ser(n) {
  if (n.localName === "#text") return JSON.stringify(n._text);
  const attrs = Object.entries(n.attributes || {}).sort(([a], [b]) => a < b ? -1 : 1);
  return `<${n.localName} ${JSON.stringify(attrs)} c=${n.className} s=${n.style.cssText} h=${JSON.stringify(n._html)} t=${JSON.stringify(n._text)}`
    + ` v=${n._value} sel=${n.selected} dis=${n.disabled}>` + n.childNodes.map(ser).join("") + "</>";
}

const LM = await import(pathToFileURL(join(WWW, "views", "lights_map.js")).href);

// ── the house ────────────────────────────────────────────────────────────────
const NOW = Date.now();
const S = (state, attributes, agoMs = 3600e3) => ({ state, attributes, last_changed: new Date(NOW - agoMs).toISOString(), last_updated: new Date(NOW - agoMs).toISOString() });
const BASE = {
  "light.kitchen":   S("on",  { friendly_name: "Kitchen pots", brightness: 200, supported_color_modes: ["brightness"] }),
  "light.hall":      S("off", { friendly_name: "Hall light" }),
  "light.den":       S("off", { friendly_name: "Den lamp", effect_list: ["Rainbow", "Solid"], supported_color_modes: ["rgb"] }),
  "light.office":    S("on",  { friendly_name: "Office light", brightness: 120 }),
  "light.porch":     S("off", { friendly_name: "Porch" }),
  "fan.great_room":  S("on",  { friendly_name: "Great room fan", percentage: 66 }),
  "lock.front":      S("locked", { friendly_name: "Front door" }),
  "binary_sensor.den_motion": S("off", { device_class: "motion", friendly_name: "Den motion" }),
  "sensor.kitchen_temperature": S("21.5", { device_class: "temperature", unit_of_measurement: "°C", friendly_name: "Kitchen temp" }, 60e3),
};
const AREAS = { "light.kitchen": "Kitchen", "light.hall": "Hall", "light.den": "Den", "light.office": "Office",
  "fan.great_room": "Den", "lock.front": "Hall", "binary_sensor.den_motion": "Den", "sensor.kitchen_temperature": "Kitchen" };
const mkModel = () => ({ areas: [{ id: "porch", name: "Porch" }, { id: "den", name: "Den" }], floors: [], light_positions_m: {} });
const MODEL = mkModel();
const lightsOf = (states, areas = AREAS) => LM.gatherLights(states, areas, undefined, "pro", undefined, undefined, undefined, undefined, NOW);
const set = (states, eid, state, extra) => ({ ...states, [eid]: S(state, { ...states[eid].attributes, ...(extra || {}) }) });
const flip = (states, eid) => set(states, eid, states[eid].state === "on" ? "off" : "on");

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
const calls = [];
const mkHost = (extra = {}) => ({ el, hiddenEids: new Set(), lightsLoading: false, model: MODEL, tableClassFilter: "all",
  tableSort: null, tableHealthFilter: false, floodLatches: {}, doorLinkedIds: new Set(), doorInvertByEid: {}, typeOverrides: {},
  onRowClick: (l) => calls.push(["click", extra.tag || "", l.entity_id]), onRowLongPress: () => {}, onRowMore: () => {},
  onToggleHidden: (eid) => calls.push(["hide", extra.tag || "", eid]), afterAssign: () => {}, callWS: async () => ({}), toast: () => {},
  onTableClassFilter: () => {}, onTableSort: () => {}, onTableHealthFilter: () => {}, onFloodReset: () => {}, ...extra });

// The sidebar's poll, one tick: a new host, the same keep; the card on a screen.
function tick(keep, scr, states, extra = {}) {
  const host = mkHost({ keepTable: keep, ...extra });
  const root = LM.buildLightsTable(host, lightsOf(states, extra.areas));
  if (root.parentNode !== scr) { while (scr.firstChild) scr.removeChild(scr.firstChild); scr.appendChild(root); }
  return root;
}
// What a new card (no keep) makes for the same inputs.
const fresh = (states, extra = {}) => ser(LM.buildLightsTable(mkHost(extra), lightsOf(states, extra.areas)));
const rowsOf = (root) => root._all().filter(n => n.localName === "tr" && n.getAttribute("data-eid"));
const rowOf = (root, eid) => rowsOf(root).find(r => r.getAttribute("data-eid") === eid);
const listeners = (n) => Object.values(n._listeners).reduce((t, l) => t + l.length, 0);

// ── keep ─────────────────────────────────────────────────────────────────────
await tryCase("keep: the same tick again replaces nothing", () => {
  const keep = {}, scr = screen();
  const a = tick(keep, scr, BASE);
  const nodes = new Set(a._all());
  const b = tick(keep, scr, BASE);
  check("keep: the same tick again replaces nothing", b === a && b._all().every(n => nodes.has(n)) && b._all().length === nodes.size
    && ser(b) === fresh(BASE));
});
await tryCase("keep: one light switched, only its row built again", () => {
  const keep = {}, scr = screen();
  const a = tick(keep, scr, BASE);
  const before = new Map(rowsOf(a).map(r => [r.getAttribute("data-eid"), r]));
  const head = a.childNodes.find(n => n.className === "lv-tbl-head");
  const st = flip(BASE, "light.hall");
  const b = tick(keep, scr, st);
  const changed = rowsOf(b).filter(r => before.get(r.getAttribute("data-eid")) !== r).map(r => r.getAttribute("data-eid"));
  check("keep: one light switched, only its row built again", b === a && JSON.stringify(changed) === '["light.hall"]'
    && b.childNodes.includes(head) && ser(b) === fresh(st), { changed, equal: ser(b) === fresh(st) });
});
await tryCase("keep: many ticks of changes, always what a new card makes", () => {
  const keep = {}, scr = screen();
  let st = BASE, ok = true, a = tick(keep, scr, st), bad = null;
  const first = a;
  const steps = [
    (s) => flip(s, "light.den"), (s) => set(s, "sensor.kitchen_temperature", "23.9"), (s) => set(s, "light.kitchen", "on", { brightness: 30 }),
    (s) => set(s, "light.office", "unavailable"), (s) => flip(s, "binary_sensor.den_motion"), (s) => set(s, "lock.front", "unlocked"),
    (s) => { const t = { ...s }; delete t["light.porch"]; return t; },
    (s) => ({ ...s, "light.attic": S("on", { friendly_name: "Attic" }) }),
    (s) => set(s, "fan.great_room", "on", { percentage: 33 }), (s) => s, (s) => flip(s, "light.hall"), (s) => set(s, "light.office", "on"),
  ];
  for (let i = 0; i < 60; i++) {
    st = steps[i % steps.length](st);
    a = tick(keep, scr, st);
    if (ser(a) !== fresh(st)) { ok = false; bad = bad ?? i; }
  }
  check("keep: many ticks of changes, always what a new card makes", ok && a === first
    && keep.rows.size === lightsOf(st).length, { bad, rows: keep.rows.size });
});
await tryCase("keep: a room assigned changes the note and that row", () => {
  const keep = {}, scr = screen();
  const a = tick(keep, scr, BASE);
  const note = a.childNodes.find(n => n.className === "lv-note");
  const areas = { ...AREAS, "light.porch": "Porch" };
  const b = tick(keep, scr, BASE, { areas });
  check("keep: a room assigned changes the note and that row", b === a && note && !b.childNodes.includes(note)
    && !b.childNodes.some(n => n.className === "lv-note") && ser(b) === fresh(BASE, { areas }));
});
await tryCase("keep: sorted by state, rows move with their lights", () => {
  const keep = {}, scr = screen(), sort = { column: "state", dir: "asc" };
  let st = BASE, a = tick(keep, scr, st, { tableSort: sort }), ok = true;
  const first = a;
  for (const eid of ["light.hall", "light.kitchen", "light.porch", "light.hall"]) {
    st = flip(st, eid);
    a = tick(keep, scr, st, { tableSort: { ...sort } });
    ok = ok && ser(a) === fresh(st, { tableSort: sort });
  }
  check("keep: sorted by state, rows move with their lights", ok && a === first);
});

// ── rebuild ──────────────────────────────────────────────────────────────────
await tryCase("rebuild: a filter, the sort, hidden lights, another map, loading, a setting", () => {
  const keep = {}, scr = screen(), out = [];
  const model2 = mkModel();
  for (const extra of [{ tableClassFilter: "light" }, { tableSort: { column: "name", dir: "desc" } }, { tableHealthFilter: true },
    { hiddenEids: new Set(["light.den"]) }, { model: model2 }, { lightsLoading: true }, { onTypeOverride: () => {} },
    { classFilter: "motion" }, { floodLatches: { "x": 1 } }, { typeOverrides: { "light.den": "fan" } }]) {
    const a = tick(keep, scr, BASE);                 // kept from here
    const b = tick(keep, scr, BASE, extra);          // one thing changed: a new card
    const c = tick(keep, scr, BASE, extra);          // and kept again
    out.push(b !== a && c === b && ser(b) === fresh(BASE, extra));
  }
  check("rebuild: a filter, the sort, hidden lights, another map, loading, a setting", out.every(Boolean), out);
});
await tryCase("rebuild: a card no longer on screen", () => {
  const keep = {}, scr = screen();
  const a = tick(keep, scr, BASE);
  scr.removeChild(a);
  const gone = !a.isConnected;
  const b = tick(keep, scr, BASE);
  check("rebuild: a card no longer on screen", gone && b !== a && ser(b) === fresh(BASE));
});
await tryCase("rebuild: the Mapping tab's host (no keepTable) as before", () => {
  const a = LM.buildLightsTable(mkHost(), lightsOf(BASE)), b = LM.buildLightsTable(mkHost(), lightsOf(BASE));
  check("rebuild: the Mapping tab's host (no keepTable) as before", a !== b && ser(a) === ser(b));
});
await tryCase("rebuild: every host key the table reads is in TABLE_HOST_KEYS", async () => {
  const { readFileSync } = await import("node:fs");
  const src = readFileSync(join(WWW, "views", "lights_map.js"), "utf8").replace(/\r\n/g, "\n");
  const i = src.indexOf("export function buildLightsTable(");
  const body = src.slice(i, src.indexOf("\n}\n", i));
  const used = [...new Set([...body.matchAll(/\bhost(?:In)?\.([A-Za-z_]\w*)/g)].map(m => m[1]))].filter(k => k !== "el");
  const missing = used.filter(k => !LM.TABLE_HOST_KEYS.includes(k));
  check("rebuild: every host key the table reads is in TABLE_HOST_KEYS", used.length > 30 && !missing.length, missing);
});

// ── focus ────────────────────────────────────────────────────────────────────
await tryCase("focus: the poll keeps the row holding the focused control", () => {
  const keep = {}, scr = screen();
  const a = tick(keep, scr, BASE);
  const row = rowOf(a, "light.porch");
  const sel = row._all().find(n => n.localName === "select");     // its "Assign room…"
  sel.value = "den";
  scr.activeElement = sel;
  const st = flip(BASE, "light.porch");
  const b = tick(keep, scr, st, { keepFocused: true });
  const held = rowOf(b, "light.porch") === row && row._all().includes(sel) && sel._value === "den";
  // Another light changing meanwhile still updates.
  const st2 = flip(st, "light.hall");
  const c = tick(keep, scr, st2, { keepFocused: true });
  const hallNew = ser(rowOf(c, "light.hall")) === ser(rowOf(LM.buildLightsTable(mkHost(), lightsOf(st2)), "light.hall"));
  scr.activeElement = null;
  const d = tick(keep, scr, st2, { keepFocused: true });
  check("focus: the poll keeps the row holding the focused control", held && hallNew && rowOf(d, "light.porch") !== row && ser(d) === fresh(st2),
    { held, hallNew });
});
await tryCase("focus: any other update replaces it", () => {
  const keep = {}, scr = screen();
  const a = tick(keep, scr, BASE);
  const row = rowOf(a, "light.porch");
  scr.activeElement = row._all().find(n => n.localName === "button");
  const st = flip(BASE, "light.porch");
  const b = tick(keep, scr, st);
  check("focus: any other update replaces it", rowOf(b, "light.porch") !== row && ser(b) === fresh(st));
});
await tryCase("focus: the header holding the focused filter stays", () => {
  const keep = {}, scr = screen();
  const a = tick(keep, scr, BASE);
  const head = a.childNodes.find(n => n.className === "lv-tbl-head");
  scr.activeElement = head._all().find(n => n.localName === "select");
  const st = { ...BASE, "light.attic": S("on", { friendly_name: "Attic" }) };   // the count goes up
  const b = tick(keep, scr, st, { keepFocused: true });
  const held = b.childNodes.includes(head);
  scr.activeElement = null;
  const c = tick(keep, scr, st, { keepFocused: true });
  check("focus: the header holding the focused filter stays", held && !c.childNodes.includes(head) && ser(c) === fresh(st));
});

// ── wiring ───────────────────────────────────────────────────────────────────
await tryCase("wiring: a kept row is wired once, to the newest host", () => {
  const keep = {}, scr = screen();
  const a = tick(keep, scr, BASE, { tag: "t0" });
  const row = rowOf(a, "light.kitchen");
  const btns = row._all().filter(n => n.localName === "button");
  const n0 = listeners(row) + btns.reduce((t, b) => t + listeners(b), 0);
  let st = BASE;
  for (let i = 1; i <= 12; i++) { st = flip(st, "light.hall"); tick(keep, scr, st, { tag: "t" + i }); }
  const n1 = listeners(row) + btns.reduce((t, b) => t + listeners(b), 0);
  calls.length = 0;
  row.click();
  btns.find(b => b.textContent === "Hide").click();
  check("wiring: a kept row is wired once, to the newest host", rowOf(a, "light.kitchen") === row && n0 > 0 && n1 === n0
    && JSON.stringify(calls) === JSON.stringify([["click", "t12", "light.kitchen"], ["hide", "t12", "light.kitchen"]]), { n0, n1, calls });
});

// ── map card ─────────────────────────────────────────────────────────────────
// buildLightsMapCard with host.keepCard, the sidebar's tick: the card and its
// stage stay, and the card, its drawing and what is on the stage are always
// what a new card makes. Each pair has slots of its own (its own rain, people
// layer and screen state), the comparison card too, both read back as
// "atlas", and both see every tick, so the rain and the people have the same
// past in each.
// The drawing is parsed one level, as atlas_svg_patch.mjs does, so the patch
// in place runs for real.
const SVG_NS = "http://www.w3.org/2000/svg";
const _ih = Object.getOwnPropertyDescriptor(proto, "innerHTML");
let parsing = false;
const leaf = (markup) => { const n = document.createElementNS(SVG_NS, "part"); n._leaf = markup; return n; };
Object.defineProperty(proto, "innerHTML", {
  configurable: true,
  get() { return _ih.get.call(this); },
  set(v) {
    _ih.set.call(this, v);
    const s = String(v ?? "");
    if (!parsing || !s) return;
    if (s.startsWith("<svg")) {
      const p = LM.svgParts(s);
      if (!p) return;
      const svg = document.createElementNS(SVG_NS, "svg");
      svg._open = p.open;
      for (const k of p.kids) svg.appendChild(leaf(k));
      this.appendChild(svg);
    } else if (this.localName === "svg") {
      const p = LM.svgParts(`<svg>${s}</svg>`);
      if (p) for (const k of p.kids) this.appendChild(leaf(k));
    }
  },
});
// What the shim leaves out, counted: window and document listeners, observers.
const winL = {}, docL = {};
globalThis.addEventListener = (t, f) => { (winL[t] ||= new Set()).add(f); };
globalThis.removeEventListener = (t, f) => { if (winL[t]) winL[t].delete(f); };
document.addEventListener = (t, f) => { (docL[t] ||= new Set()).add(f); };
document.removeEventListener = (t, f) => { if (docL[t]) docL[t].delete(f); };
const observing = { n: 0 };
for (const name of ["ResizeObserver", "IntersectionObserver", "MutationObserver"]) {
  globalThis[name] = class { constructor() { this.on = false; } observe() { if (!this.on) { this.on = true; observing.n++; } }
    unobserve() {} disconnect() { if (this.on) { this.on = false; observing.n--; } } takeRecords() { return []; } };
}
globalThis.sessionStorage = globalThis.sessionStorage || { _d: {}, getItem(k) { return this._d[k] ?? null; }, setItem(k, v) { this._d[k] = String(v); }, removeItem(k) { delete this._d[k]; } };

const sortedStyle = (n) => n.style.cssText.split(";").filter(d => d && !/:\s*$/.test(d)).sort().join(";");
// The card as markup, attributes and classes in order, a parsed part as its markup.
function serC(n) {
  if (n.localName === "#text") return JSON.stringify(n._text);
  if (n._leaf !== undefined) return n._leaf;
  const attrs = Object.entries(n.attributes || {}).filter(([k]) => k !== "class" && k !== "style").sort(([a], [b]) => a < b ? -1 : 1);
  const cls = String(n.className || "").split(/\s+/).filter(Boolean).sort().join(" ");
  const h = n.childNodes.length || n.localName === "svg" ? "" : n._html;
  return `<${n.localName} ${JSON.stringify(attrs)} c=${cls} s=${sortedStyle(n)} h=${JSON.stringify(h)} o=${n._open || ""} t=${JSON.stringify(n._text)}`
    + ` v=${n._value} dis=${n.disabled} hid=${!!n.hidden}>` + n.childNodes.map(serC).join("") + "</>";
}
const asAtlas = (s) => s.replace(/[kc]slot\d+/g, "atlas");

const crect = (floor_id, x0, y0, x1, y1) => ({ type: "poly", floor_id, points_m: [[x0, y0], [x1, y0], [x1, y1], [x0, y1]] });
const mkCModel = () => ({
  floors: [{ id: "main", name: "Main", level: 0 }, { id: "upper", name: "Upper", level: 1 }],
  room_geometry_m: { Kitchen: crect("main", 0, 0, 6, 4), Hall: crect("main", 6, 0, 10, 4), Den: crect("main", 0, 4.1, 10, 8), Office: crect("upper", 0, 0, 10, 8) },
  rf_barriers_m: [{ id: "w1", name: "Kitchen window", material: "glass", floor_id: "main", points_m: [[0, 1], [0, 2]], linked_entity_id: "binary_sensor.kitchen_window" }],
  light_positions_m: {
    "light.kitchen": { x_m: 3, y_m: 2, floor_id: "main" }, "light.hall": { x_m: 8, y_m: 2, floor_id: "main" },
    "light.den": { x_m: 2, y_m: 6, floor_id: "main" }, "light.office": { x_m: 5, y_m: 4, floor_id: "upper" },
    "binary_sensor.den_motion": { x_m: 8, y_m: 6, floor_id: "main" }, "sensor.kitchen_temperature": { x_m: 1, y_m: 1, floor_id: "main" },
  },
  scanner_positions_m: { "AA:BB:CC:00:00:01": { x_m: 2, y_m: 1, floor_id: "main" } },
});
let CMODEL = mkCModel();
const CAREAS = { "light.kitchen": "Kitchen", "light.hall": "Hall", "light.den": "Den", "light.office": "Office", "binary_sensor.den_motion": "Den",
  "sensor.kitchen_temperature": "Kitchen", "binary_sensor.kitchen_window": "Kitchen" };
const CBASE = {
  ...Object.fromEntries(["light.kitchen", "light.hall", "light.den", "light.office"].map((e, i) => [e, S(i % 2 ? "off" : "on", { friendly_name: e.slice(6) })])),
  "binary_sensor.den_motion": S("off", { device_class: "motion", friendly_name: "Den motion" }),
  "sensor.kitchen_temperature": S("21.5", { device_class: "temperature", unit_of_measurement: "°C", friendly_name: "Kitchen temp" }),
  "binary_sensor.kitchen_window": S("off", { device_class: "window", friendly_name: "Kitchen window" }),
  "weather.home": S("partlycloudy", { friendly_name: "Home" }),
};
// People and tags: the snapshot moves a little every tick.
let dx = 0, preads = 0;
const SNAPC = () => ({ objects: { list: [
  { key: "ble:keys", kind: "ble", user_label: "Keys", identified: true, x_m: 2 + dx, y_m: 2, floor_id: "main", room: "Kitchen", age_s: 4, knn_confidence: 0.9, sources: [] },
  { key: "ble:bag", kind: "ble", user_label: "Gym bag", identified: true, x_m: 6, y_m: 2 + dx / 2, floor_id: "upper", room: "Office", age_s: 9, knn_confidence: 0.6, sources: [] },
] } });
const PEOPLE = { read: () => { preads++; return Promise.resolve(SNAPC()); }, everyMs: 5000 };
let clock = Date.now();
const realNow = Date.now;
const settle = async () => { for (let i = 0; i < 6; i++) await new Promise(r => globalThis._realSetTimeout(r, 0)); };
const ccalls = [];
// One tick's host, as lights_panel.js builds it.
function cardHost(states, { slot = "atlas", view, keep = null, shapes = {}, extra = {}, tag = "" } = {}) {
  localStorage.setItem("padspan_lv_3d_" + slot, "0");    // Live Aboard on, the flat map picked
  const lights = LM.gatherLights(states, CAREAS, shapes, extra.tier || "pro", undefined, undefined, undefined, undefined, clock);
  const lightsByEid = Object.fromEntries(lights.map(l => [l.entity_id, l]));
  const byRoom = {};
  for (const l of lights) if (l.area_name) (byRoom[l.area_name] = byRoom[l.area_name] || []).push(l);
  return { el, view, floors: CMODEL.floors, model: CMODEL, byRoom, hiddenEids: new Set(), lightsByEid, lightsLoading: false, tier: "pro",
    layoutV2: true, displayMode: true, codeChip: true, hitHalo: true, collapseUnplaced: true, patchSvg: true, alertPulse: true,
    saveView: async () => {}, toast: (m) => ccalls.push(["toast", tag, m]),
    classFilter: "all", onClassFilter: (c) => ccalls.push(["class", tag, c]),
    weather: { slot, settings: { atlas_weather_enabled: true, atlas_weather_condition_entity: "weather.home" }, states, entities: undefined, telemetry() {} },
    screen: { slot, shownAt: 1 },
    house3d: { slot, settings: { atlas_3d_enabled: true, atlas_3d_people: true, atlas_3d_tags: true, atlas_3d_quality: "auto" }, states, people: PEOPLE,
      mapOnly: true, load: () => Promise.resolve({ data: {} }), telemetry() {}, liveStates: () => states, useApi: () => ({}) },
    onHexesBuilt: (isoDiv) => LM.wireHoverHud(isoDiv, { lightsByEid }),
    keepCard: keep, ...extra };
}
const stageOf = (c) => c._all().find(n => n.classList && n.classList.contains("lv-stage"));
// A pair: the sidebar's kept card on its screen, and a new card for the same
// inputs on its own slots and screen. tick() → the kept card and the new one as markup.
let slots = 0;
const cmpView = (view) => ({ floorGap: view.floorGap, horizGap: view.horizGap, focusIdx: view.focusIdx, zoom: view.zoom,
  drawer: view.drawer, railHidden: view.railHidden });
function pair() {
  const n = ++slots, keep = {}, scr = screen(), cmpScr = screen(), view = cviewOf();
  return { keep, scr, view, async tick(states, o = {}) {
    const c = LM.buildLightsMapCard(cardHost(states, { view, keep, slot: "kslot" + n, ...o }));
    if (c.parentNode !== scr) { while (scr.firstChild) scr.removeChild(scr.firstChild); scr.appendChild(c); }
    await settle();
    const f = LM.buildLightsMapCard(cardHost(states, { view: cmpView(view), slot: "cslot" + n, ...o }));
    while (cmpScr.firstChild) cmpScr.removeChild(cmpScr.firstChild);
    cmpScr.appendChild(f);
    await settle();
    return [c, asAtlas(serC(f))];
  } };
}
const cviewOf = () => ({ floorGap: 150, horizGap: 0, focusIdx: 0, zoom: 1 });
const allListeners = (c) => [c, ...c._all()].reduce((t, n) => t + Object.values(n._listeners || {}).reduce((a, l) => a + l.length, 0), 0)
  + Object.values(winL).reduce((t, s) => t + s.size, 0) + Object.values(docL).reduce((t, s) => t + s.size, 0);
const CSTEPS = [
  (s) => flip(s, "light.hall"), (s) => set(s, "sensor.kitchen_temperature", "23.1"), (s) => set(s, "binary_sensor.den_motion", "on"),
  (s) => set(s, "weather.home", "rainy"), (s) => set(s, "light.kitchen", "on", { brightness: 40 }), (s) => s,
  (s) => set(s, "binary_sensor.den_motion", "off"), (s) => flip(s, "light.office"), (s) => set(s, "weather.home", "cloudy"),
  (s) => set(s, "light.den", "unavailable"), (s) => set(s, "light.den", "off"), (s) => set(s, "weather.home", "snowy"),
];
const kser = (n) => asAtlas(serC(n));
Date.now = () => clock;
parsing = true;
// atlas_aboard.js (the people layer) loads on the first card that asks for it.
await pair().tick(CBASE);

await tryCase("card: kept across ticks of lights, people and weather, always what a new card makes", async () => {
  const P = pair();
  let st = CBASE, [c] = await P.tick(st), bad = null, sameCard = true, rained = false, live = false, f;
  const first = c, stage = stageOf(c), svg = stage.childNodes.find(n => n.localName === "svg");
  for (let i = 0; i < 36; i++) {
    clock += 6000; dx = (i % 5) * 0.3;
    st = CSTEPS[i % CSTEPS.length](st);
    [c, f] = await P.tick(st);
    sameCard = sameCard && c === first && stageOf(c) === stage && stage.childNodes.includes(svg);
    rained = rained || stage.childNodes.some(n => n.classList && n.classList.contains("lv-wx"));
    live = live || svg._all().some(n => n.getAttribute && n.getAttribute("data-live") !== null);
    if (bad === null && kser(c) !== f) bad = i;
  }
  check("card: kept across ticks of lights, people and weather, always what a new card makes",
    bad === null && sameCard && rained && live && preads > 20, { bad, sameCard, rained, live, preads });
});
await tryCase("card: zoom kept, the drawing patched where it is", async () => {
  const P = pair();
  const [a] = await P.tick(CBASE);
  P.view.zoom = 1.6;      // the zoom buttons and a pinch change it in place
  // Panned: the new drawing empties the stage a moment (a browser takes the
  // pan to 0 then); the pan is put back, as a new card puts it back.
  P.view.scrollLeft = 300; P.view.scrollTop = 120;
  const panned = () => stageOf(a).scrollLeft === 300 && stageOf(a).scrollTop === 120;
  const _ih2 = Object.getOwnPropertyDescriptor(proto, "innerHTML");
  Object.defineProperty(stageOf(a), "innerHTML", { configurable: true, get() { return _ih2.get.call(this); },
    set(v) { this.scrollLeft = 0; this.scrollTop = 0; _ih2.set.call(this, v); } });
  clock += 6000;
  const [b, f] = await P.tick(flip(CBASE, "light.hall"));
  const panKept = panned();
  const svg2 = stageOf(b).childNodes.find(n => n.localName === "svg"), eqB = kser(b) === f;
  clock += 6000;
  const [c, f2] = await P.tick(flip(CBASE, "light.den"));
  check("card: zoom kept, the drawing patched where it is", b === a && c === a && !!svg2 && eqB && kser(c) === f2 && panKept
    && stageOf(c).childNodes.includes(svg2) && stageOf(c).childNodes.filter(n => n.localName === "svg").length === 1,
    { kept: b === a, c: c === a, b: eqB, cc: kser(c) === f2, panKept });
});
await tryCase("card: what the card is built from changing builds a new one, kept again after", async () => {
  const out = {};
  const cases = {
    floor: (v) => { v.focusIdx = 1; }, spacing: (v) => { v.floorGap = 200; }, railHidden: (v) => { v.railHidden = true; },
    drawer: (v) => { v.drawer = "layers"; },
    classic: (v, o) => { o.extra = { layoutV2: false }; }, wall: (v, o) => { o.extra = { wall: true }; },
    tier: (v, o) => { o.extra = { tier: "bright" }; }, setting: (v, o) => { o.extra = { showcase: true }; },
    classFilter: (v, o) => { o.extra = { classFilter: "light" }; }, heatmap: (v, o) => { o.extra = { onHeatmap: () => {} }; },
    legend: (v, o) => { o.shapes = { "light.den": "pendant" }; },
    model: () => { CMODEL = mkCModel(); }, vacation: (v, o) => { o.extra = { vacationModeEnabled: true }; },
  };
  for (const [name, change] of Object.entries(cases)) {
    const P = pair();
    const [a] = await P.tick(CBASE);
    const [a2] = await P.tick(CBASE);
    const o = {};
    change(P.view, o);
    clock += 6000;
    const [b] = await P.tick(CBASE, o);
    const [c, f] = await P.tick(CBASE, o);
    out[name] = a2 === a && b !== a && c === b && !a.isConnected && kser(c) === f;
  }
  // An alert on a wall (rain, a window open): the bar comes, a new card.
  {
    const P = pair(), o = { extra: { wall: true } };
    const [a] = await P.tick(set(CBASE, "weather.home", "rainy"), o);
    const st = set(set(CBASE, "weather.home", "rainy"), "binary_sensor.kitchen_window", "on");
    clock += 6000;
    const [b] = await P.tick(st, o), [c, f] = await P.tick(st, o);
    out.alert = b !== a && c === b && b._all().some(n => n.classList && n.classList.contains("lv-alertbar")) && kser(c) === f;
  }
  // Off screen (the page left): a new card.
  {
    const P = pair();
    const [a] = await P.tick(CBASE);
    P.scr.removeChild(a);
    out.offScreen = (await P.tick(CBASE))[0] !== a;
  }
  check("card: what the card is built from changing builds a new one, kept again after", Object.values(out).every(Boolean), out);
});
await tryCase("card: the layer bar comes again when its counts do; the poll keeps one holding the focus", async () => {
  const P = pair();
  const [a] = await P.tick(CBASE);
  const bar = () => a._all().find(n => n.classList && n.classList.contains("lv-layerbar"));
  const b0 = bar();
  clock += 6000;
  await P.tick(CBASE);
  const untouched = bar() === b0;
  clock += 6000;
  let st = flip(CBASE, "light.hall");       // a floor's count changes
  await P.tick(st);
  const b1 = bar(), rebuilt = b1 !== b0 && !a._all().includes(b0);
  P.scr.activeElement = b1._all().find(n => n.localName === "button");
  st = flip(st, "light.office");
  clock += 6000;
  await P.tick(st, { extra: { keepFocused: true } });
  const held = bar() === b1;
  const [, f] = await P.tick(st);           // a click's update: replaced
  const replaced = bar() !== b1;
  P.scr.activeElement = null;
  check("card: the layer bar comes again when its counts do; the poll keeps one holding the focus",
    untouched && rebuilt && held && replaced && kser(a) === f, { untouched, rebuilt, held, replaced });
});
await tryCase("card: a kept card's controls reach the newest host", async () => {
  const P = pair();
  const [a] = await P.tick(CBASE, { tag: "t0" });
  let st = CBASE;
  for (let i = 1; i <= 5; i++) { clock += 6000; st = flip(st, "light.den"); await P.tick(st, { tag: "t" + i }); }
  // Every light off, nothing tripped: Find active says so, through the newest host.
  const dark = Object.fromEntries(Object.entries(st).map(([k, v]) => [k, k.startsWith("light.") ? { ...v, state: "off" } : v]));
  clock += 6000;
  const [b] = await P.tick(dark, { tag: "t6" });
  ccalls.length = 0;
  const btn = (pred) => b._all().find(n => n.localName === "button" && pred(n));
  btn(n => (n.className || "").includes("lv-chipbtn") && n.textContent.startsWith("Lights")).click();
  btn(n => n.textContent === "◎ Find active").click();
  check("card: a kept card's controls reach the newest host", b === a
    && JSON.stringify(ccalls) === JSON.stringify([["class", "t6", "light"], ["toast", "t6", "Nothing is on"]]), ccalls);
});
await tryCase("card: 500 ticks, the same listeners, observers, hover box and rain", async () => {
  const P = pair();
  let st = set(CBASE, "weather.home", "rainy"), [c] = await P.tick(st), f;
  for (let i = 0; i < 3; i++) { clock += 6000; st = set(CSTEPS[i % CSTEPS.length](st), "weather.home", "rainy"); [c] = await P.tick(st); }
  const count = () => ({ listeners: allListeners(c), observing: observing.n, nodes: c._all().length,
    huds: c._all().filter(n => n.className === "lv-hoverhud-anchor").length,
    wx: c._all().filter(n => n.classList && n.classList.contains("lv-wx")).length,
    win: Object.values(winL).reduce((t, s) => t + s.size, 0) });
  const at3 = count(), first = c;
  for (let i = 0; i < 500; i++) {
    clock += 6000; dx = (i % 4) * 0.2;
    st = set(CSTEPS[i % CSTEPS.length](st), "weather.home", "rainy");
    [c, f] = await P.tick(st);
  }
  const at503 = count();
  check("card: 500 ticks, the same listeners, observers, hover box and rain", c === first && at3.huds === 1 && at3.wx === 1
    && JSON.stringify(at503) === JSON.stringify(at3) && kser(c) === f, { same: c === first, at3, at503, equal: kser(c) === f });
});
await tryCase("card: a kept card's whole-house confirm goes back to Apply on its own", async () => {
  // Review 2026-10-30: the poll no longer resets it, so a timer does
  // (WH_ARM_MS): never an armed "Yes, change the whole house" left on a wall.
  const P = pair(), applied = [];
  const o = { extra: { wholeHousePresets: [{ name: "Night", entities: { "light.hall": {} } }],
    onWholeHouseApply: async (p) => { applied.push(p.name); return null; } } };
  const [a] = await P.tick(CBASE, o);
  const sel = a._all().find(n => n.localName === "select" && String(n.title || "").startsWith("A saved state"));
  const apply = sel.parentNode.childNodes.find(n => n.localName === "button" && n.textContent === "Apply");
  sel.value = "Night";
  timerQueue.length = 0;
  apply.click();
  const armed = apply.textContent === "Yes, change the whole house";
  clock += 6000;
  const [b] = await P.tick(flip(CBASE, "light.hall"), o);
  const kept = b === a && apply.textContent === "Yes, change the whole house";
  const t = timerQueue.find(x => x && x.ms === LM.WH_ARM_MS);
  if (t) t.fn();
  const back = apply.textContent === "Apply";
  apply.click();                              // armed again, nothing applied
  const again = apply.textContent === "Yes, change the whole house";
  apply.click();                              // the second tap applies
  await settle();
  check("card: a kept card's whole-house confirm goes back to Apply on its own",
    armed && kept && !!t && back && again && applied.join() === "Night" && apply.textContent === "Apply",
    { armed, kept, timer: !!t, back, again, applied, text: apply.textContent });
});
await tryCase("card: the Mapping tab's host (no keepCard) builds a new card every time", async () => {
  const view = cviewOf();
  const h = () => { const x = cardHost(CBASE, { view, slot: "builder" }); delete x.keepCard; delete x.screen; return x; };
  const a = LM.buildLightsMapCard(h()), b = LM.buildLightsMapCard(h());
  check("card: the Mapping tab's host (no keepCard) builds a new card every time", a !== b && kser(a) === kser(b));
});
parsing = false;
Date.now = realNow;

// ── panel ────────────────────────────────────────────────────────────────────
// What lights_panel_lifecycle.mjs gives a custom element, the shadow root on a screen.
const defined = {};
globalThis.customElements = { define(name, cls) { defined[name] = cls; }, get(name) { return defined[name]; }, whenDefined: () => Promise.resolve() };
proto.attachShadow = function () {
  const root = document.createElement("#shadow-root");
  root._screen = true; root.activeElement = null;
  let html = "";
  Object.defineProperty(root, "innerHTML", {
    get: () => html,
    set: (v) => {
      html = String(v ?? ""); root.children.length = 0;
      if (html.includes('id="content"')) { const c = document.createElement("div"); c.id = "content"; c.setAttribute("id", "content"); root.appendChild(c); }
    },
  });
  this.shadowRoot = root;
  return root;
};
await import(pathToFileURL(join(WWW, "lights_panel.js")).href);
const Panel = defined["padspan-lights-app"];
const mkHass = (states) => ({
  states, user: { is_admin: true, name: "t" }, language: "en", config: { unit_system: { temperature: "°C" } },
  callWS: async (msg) => {
    switch (msg.type) {
      case "padspan_ha/settings_get": return { settings: { tier: "pro" } };
      case "padspan_ha/model_get": return { ...MODEL, floors: [{ id: "main", name: "Main", level: 0 }], room_geometry_m: {} };
      case "config/entity_registry/list": return Object.keys(states).map((entity_id, i) => ({ entity_id, area_id: null, device_id: "d" + i }));
      case "config/device_registry/list": return [];
      case "config/area_registry/list": return [];
      default: return {};
    }
  },
  callService: async () => {},
  connection: { subscribeEvents: async () => () => {}, subscribeMessage: async () => () => {}, addEventListener() {}, removeEventListener() {} },
});
await tryCase("panel: the index and the map card stay on screen, the rest is built again, the page as a full rebuild", async () => {
  if (!Panel) throw new Error("padspan-lights-app was not defined");
  const p = new Panel();
  p.connectedCallback();
  p.hass = mkHass(BASE);
  await p._boot(); await flush(); await flush();
  p._render(); await flush();
  const content = p.shadowRoot.querySelector("#content");
  const find = (cls) => content._all().find(n => (n.className || "").split(" ").includes(cls));
  const t1 = find("lv-tablecard"), hero1 = find("lv-hero"), card1 = find("lv-mapcard");
  const rows1 = new Set(rowsOf(t1));
  p.hass = mkHass(flip(BASE, "light.hall")); await flush();
  p._render(); await flush();
  const t2 = find("lv-tablecard"), hero2 = find("lv-hero"), card2 = find("lv-mapcard");
  const changed = rowsOf(t2).filter(r => !rows1.has(r)).map(r => r.getAttribute("data-eid"));
  const onScreen = t2.isConnected;
  const keptPage = ser(content);
  // A full rebuild of the same: the keeps dropped.
  p._tableKeep = {}; p._cardKeep = {};
  p._render(); await flush();
  const t3 = find("lv-tablecard"), card3 = find("lv-mapcard");
  const fullPage = ser(content);
  // Kept again from here; nothing in the house at all: the note alone, and back.
  p._render();
  const again = find("lv-tablecard") === t3 && find("lv-mapcard") === card3;
  p.hass = mkHass({}); await flush(); p._render();
  const none = !find("lv-tablecard") && content.childNodes.length === 1;
  p.hass = mkHass(BASE); await flush(); p._render();
  const back = !!find("lv-tablecard") && find("lv-tablecard") !== t3 && !!find("lv-mapcard") && find("lv-mapcard") !== card3;
  p.disconnectedCallback();
  check("panel: the index and the map card stay on screen, the rest is built again, the page as a full rebuild",
    t2 === t1 && onScreen && hero2 !== hero1 && card2 === card1 && JSON.stringify(changed) === '["light.hall"]'
    && t3 !== t2 && card3 !== card2 && keptPage === fullPage && again && none && back,
    { sameTable: t2 === t1, sameCard: card2 === card1, onScreen, changed, equal: keptPage === fullPage, again, none, back });
});
// The emergency button sits right before the stage; a kept card holds one, never two.
await tryCase("panel: a kept card holds one emergency button, right before the stage", async () => {
  const p = new Panel();
  p.connectedCallback();
  p.hass = mkHass(BASE);
  await p._boot(); await flush(); await flush();
  p.state._emerg = { available: true, members: [], test: { active: false } };
  p._render(); await flush();
  const content = p.shadowRoot.querySelector("#content");
  const card = () => content._all().find(n => (n.className || "").split(" ").includes("lv-mapcard"));
  const c1 = card();
  for (let i = 0; i < 4; i++) { p._render(); await flush(); }
  const anchors = () => card().childNodes.filter(n => n.className === "lv-emerg-anchor");
  const stage = card().childNodes.find(n => n.className === "lv-stage");
  const one = anchors().length === 1 && anchors()[0].nextSibling === stage;
  p.state._emerg = { available: false };
  p._render(); await flush();
  const gone = anchors().length === 0;
  p.disconnectedCallback();
  check("panel: a kept card holds one emergency button, right before the stage", card() === c1 && one && gone, { kept: card() === c1, one, gone });
});
// Sample mode's preview (panel.js _viewHass): the Atlas inside the panel can be
// handed another house's hass. Its kept index then holds that house's rows only.
await tryCase("panel: another house's hass, none of the last house's rows kept", async () => {
  const p = new Panel();
  p.connectedCallback();
  p.hass = mkHass(BASE);
  await p._boot(); await flush(); await flush();
  p._render(); await flush();
  const content = p.shadowRoot.querySelector("#content");
  const eids = () => rowsOf(content._all().find(n => (n.className || "").split(" ").includes("lv-tablecard"))).map(r => r.getAttribute("data-eid")).sort();
  const before = eids();
  const OTHER = { "light.games_room_cove_1": S("on", { friendly_name: "Games Room cove 1" }), "light.study_pot_1": S("off", { friendly_name: "Study pot 1" }) };
  p.hass = mkHass(OTHER); await flush();
  p._render(); await flush();
  const there = eids();
  p.hass = mkHass(BASE); await flush();
  p._render(); await flush();
  const back = eids();
  p.disconnectedCallback();
  check("panel: another house's hass, none of the last house's rows kept",
    JSON.stringify(there) === '["light.games_room_cove_1","light.study_pot_1"]' && JSON.stringify(back) === JSON.stringify(before),
    { before, there, back });
});
await tryCase("panel: the poll's update keeps a focused row, a click's does not", async () => {
  const p = new Panel();
  p.connectedCallback();
  p.hass = mkHass(BASE);
  await p._boot(); await flush(); await flush();
  p._render(); await flush();
  const content = p.shadowRoot.querySelector("#content");
  const row = () => rowsOf(content._all().find(n => (n.className || "").split(" ").includes("lv-tablecard"))).find(r => r.getAttribute("data-eid") === "light.hall");
  const r1 = row();
  p.shadowRoot.activeElement = r1._all().find(n => n.localName === "button");   // a button: the poll still runs
  p._settingsTs = Date.now(); p._emergTs = Date.now(); p._versionTs = Date.now();
  p.hass = mkHass(flip(BASE, "light.hall")); await flush();
  await p._poll(); await flush();
  const kept = row() === r1;
  p._render();
  const replaced = row() !== r1;
  p.disconnectedCallback();
  check("panel: the poll's update keeps a focused row, a click's does not", kept && replaced && !p._pollRender, { kept, replaced });
});

console.log(JSON.stringify({ cases, failures }));
