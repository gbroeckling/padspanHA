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
//   panel     lights_panel.js: the index stays on screen across renders,
//             everything else is built again, and the page is what a full
//             rebuild makes
//
// usage: atlas_keep_card.mjs <www/padspan-ha dir>
// prints one JSON line: { cases: {name: result}, failures: [...] }

import { pathToFileURL } from "node:url";
import { join } from "node:path";
import { install, flush } from "./dom_shim.mjs";

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
await tryCase("panel: the index stays on screen, the rest is built again, the page as a full rebuild", async () => {
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
  // A full rebuild of the same: the keep dropped.
  p._tableKeep = {};
  p._render(); await flush();
  const t3 = find("lv-tablecard");
  const fullPage = ser(content);
  // Kept again from here; nothing in the house at all: the note alone, and back.
  p._render();
  const again = find("lv-tablecard") === t3;
  p.hass = mkHass({}); await flush(); p._render();
  const none = !find("lv-tablecard") && content.childNodes.length === 1;
  p.hass = mkHass(BASE); await flush(); p._render();
  const back = !!find("lv-tablecard") && find("lv-tablecard") !== t3;
  p.disconnectedCallback();
  check("panel: the index stays on screen, the rest is built again, the page as a full rebuild",
    t2 === t1 && onScreen && hero2 !== hero1 && card2 !== card1 && JSON.stringify(changed) === '["light.hall"]'
    && t3 !== t2 && keptPage === fullPage && again && none && back,
    { sameTable: t2 === t1, onScreen, changed, equal: keptPage === fullPage, again, none, back });
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
