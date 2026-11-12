// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
//
// The flat Map's own ⋯ "Show on this screen" (lights_map.js with
// live_aboard_show.js flatMenu: Live Aboard's list, its flat lines), run for
// real under the DOM shim on the sidebar's display card:
//
//   button   ⋯ in the rail, after ‹ on screen (nothing in the rail moves),
//            with Live Aboard on or off; none on Mapping's flat map
//   lines    only what the flat Map honours: Tap a light to switch it, Other
//            floors, faded, and the Scene row where the card has one
//   taps     "Tap a light to switch it" unticked here: a tap on a light on
//            the flat Map switches nothing; ticked again, it switches;
//            never touched, as ever
//   floors   "Other floors, faded" ticked here: one floor chosen, the others
//            are drawn faded at once
//   shared   a tick is this screen's pref, the 3D look's own key, both ways
//   report   the list opened on the flat Map counted apart (opened:flat)
//
// usage: atlas_flat_show.mjs <www/padspan-ha dir>
// prints one JSON line: { cases: {name: result}, failures: [...] }

import { pathToFileURL } from "node:url";
import { join } from "node:path";
import { install, timerQueue } from "./dom_shim.mjs";

const WWW = process.argv[2];
if (!WWW) { console.error("usage: atlas_flat_show.mjs <www/padspan-ha dir>"); process.exit(2); }
install(globalThis);
const kept = new Map();
globalThis.localStorage = { getItem: (k) => (kept.has(k) ? kept.get(k) : null), setItem: (k, v) => kept.set(k, String(v)), removeItem: (k) => kept.delete(k) };

const LM = await import(pathToFileURL(join(WWW, "views", "lights_map.js")).href);
const SHOW = await import(pathToFileURL(join(WWW, "views", "live_aboard_show.js")).href);

const failures = [];
const cases = {};
const check = (name, ok, detail) => { cases[name] = !!ok; if (!ok) failures.push({ name, detail: detail === undefined ? null : detail }); };
const tryCase = async (name, fn) => { try { await fn(); } catch (e) { failures.push({ name, detail: String(e && e.stack || e).slice(0, 900) }); cases[name] = false; } };
const later = () => new Promise(r => globalThis._realSetTimeout(r, 30));

// ── the house: two floors, a light on each ──────────────────────────────────
const NOW = Date.UTC(2026, 10, 12, 12);
const S = (state, attributes) => ({ state, attributes, last_changed: new Date(NOW - 3600e3).toISOString(), last_updated: new Date(NOW - 3600e3).toISOString() });
const STATES = {
  "light.kitchen": S("on", { friendly_name: "Kitchen pots", brightness: 200, supported_color_modes: ["brightness"] }),
  "light.hall":    S("off", { friendly_name: "Hall light", supported_color_modes: ["onoff"] }),
  "light.office":  S("on", { friendly_name: "Office light", brightness: 120 }),
};
const AREAS = { "light.kitchen": "Kitchen", "light.hall": "Hall", "light.office": "Office" };
const rect = (floor_id, x0, y0, x1, y1) => ({ type: "poly", floor_id, points_m: [[x0, y0], [x1, y0], [x1, y1], [x0, y1]] });
const MODEL = {
  floors: [{ id: "main", name: "Main", level: 0 }, { id: "upper", name: "Upper", level: 1 }],
  room_geometry_m: { Kitchen: rect("main", 0, 0, 6, 4), Hall: rect("main", 6, 0, 10, 4), Office: rect("upper", 0, 0, 10, 8) },
  light_positions_m: { "light.kitchen": { x_m: 3, y_m: 2, floor_id: "main" }, "light.hall": { x_m: 8, y_m: 2, floor_id: "main" },
                       "light.office": { x_m: 5, y_m: 4, floor_id: "upper" } },
};
const L = (() => {
  const all = LM.gatherLights(STATES, AREAS, undefined, "pro", undefined, undefined, undefined, undefined, NOW);
  const byEid = Object.fromEntries(all.map(l => [l.entity_id, l])), byRoom = {};
  for (const l of all) (byRoom[l.area_name] = byRoom[l.area_name] || []).push(l);
  return { byEid, byRoom };
})();
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
const SENT = [];
// The sidebar's card (lights_panel.js): the Atlas tab's screen, Live Aboard on or off; Mapping's: no display mode.
function card(view, { display = true, la = false, slot = "flat-a", ...extra } = {}) {
  const host = { el, view, floors: MODEL.floors, model: MODEL, byRoom: L.byRoom, hiddenEids: new Set(), lightsByEid: L.byEid, lightsLoading: false,
    tier: "pro", layoutV2: true, displayMode: display, codeChip: true, hitHalo: true, saveView: async () => {}, onHexesBuilt() {},
    ...(display ? { screen: { slot, shownAt: 1 } } : {}),
    ...(la ? { house3d: { slot, settings: { atlas_3d_enabled: true }, telemetry: (n) => SENT.push(n) } } : {}), ...extra };
  const c = LM.buildLightsMapCard(host);
  const all = c._all ? c._all() : [];
  const stage = all.find(n => n.className === "lv-stage");
  const rail = all.find(n => typeof n.className === "string" && n.className.startsWith("lv-rail"));
  return { c, all, stage, rail, more: all.find(n => typeof n.className === "string" && n.className.includes("la3d-flatmore")) || null };
}
const click = (b) => b && b.dispatchEvent({ type: "click", detail: 1, stopPropagation() {}, preventDefault() {}, composedPath: () => [b] });
// ⋯ on the flat Map loads the list at its first press (nothing new loads for a card nobody touches).
const openList = async (k) => { click(k.more); await later(); };
const rowsOf = (k) => k.c._all().filter(n => n.getAttribute && n.getAttribute("data-show")).map(n => n.getAttribute("data-show"));
const tickOf = (k, key) => {
  const row = k.c._all().find(n => n.getAttribute && n.getAttribute("data-show") === key);
  return row ? row.querySelector(".la3d-stick") : null;
};
const newView = () => ({ floorGap: 150, horizGap: 0, focusIdx: 0, zoom: 1 });
// A tap and a hold on the kitchen's marker, through the shared use surface (as lights_panel.js wires it).
function wiredHex(k){
  const log = [];
  const api = { lightsByEid: L.byEid, controlsFor: (l) => !!(l && l.dimmable), openRoom() {}, openFloor() {}, toggle: (e) => log.push(["toggle", e]),
                openControls: (e) => log.push(["openControls", e]), openActivity() {}, hass: null };
  const svg = k.stage.childNodes.find(n => n.localName === "svg") || k.stage;
  const g = document.createElementNS("http://www.w3.org/2000/svg", "g");
  g.setAttribute("class", "lhex"); g.className = "lhex"; g.dataset.eid = "light.hall"; g.dataset.cx = "1"; g.dataset.cy = "1";
  svg.appendChild(g);
  LM.wireUseSurface(k.stage, api);
  let t = 1000;
  const press = (held) => {
    const t0 = (t += 5000);
    g._listeners.pointerdown[0]({ type: "pointerdown", button: 0, pointerType: "touch", clientX: 5, clientY: 5, timeStamp: t0, pointerId: 1, stopPropagation() {} });
    if (held) for (const q of timerQueue.splice(0)) if (q) q.fn();
    g._listeners.pointerup[0]({ type: "pointerup", button: 0, pointerType: "touch", clientX: 5, clientY: 5, timeStamp: t0 + (held || 60), pointerId: 1, stopPropagation() {} });
    timerQueue.length = 0;
  };
  return { log, press };
}

await tryCase("button: ⋯ in the rail, after ‹ on screen (nothing in the rail moves), Live Aboard on or off; none on Mapping's flat map", async () => {
  const off = card(newView()), on = card(newView(), { la: true, slot: "flat-b" }), mapping = card(newView(), { display: false });
  const kids = off.rail ? off.rail.childNodes : [];
  const last = kids[kids.length - 1];
  check("button: ⋯ in the rail, after ‹ on screen (nothing in the rail moves), Live Aboard on or off; none on Mapping's flat map",
    !!off.more && off.more.parentNode === off.rail && kids.indexOf(off.more) === kids.length - 2 && /^[‹›]$/.test(last.textContent)
    && off.more.textContent === "⋯" && (off.more.title || off.more.getAttribute("title")) === "Show on this screen: pick what the map shows"
    && !!on.more && !mapping.more && !mapping.all.some(n => n.getAttribute && n.getAttribute("data-la3d-show") !== null),
    { off: !!off.more, on: !!on.more, mapping: !!mapping.more, kids: kids.map(n => n.textContent) });
});
await tryCase("lines: only what the flat Map honours, opened counted as the flat Map's", async () => {
  SENT.length = 0;
  const k = card(newView(), { la: true, slot: "flat-c" });
  await openList(k);
  const rows = rowsOf(k);
  check("lines: only what the flat Map honours, opened counted as the flat Map's",
    JSON.stringify(rows) === JSON.stringify(["light_taps", "other_floors"]) && SENT.includes("house3d_show:opened:flat") && !SENT.includes("house3d_show:opened")
    && rows.every(r => SHOW.FLAT_KEYS.includes(r)) && tickOf(k, "light_taps").getAttribute("aria-checked") === "true"
    && tickOf(k, "other_floors").getAttribute("aria-checked") === "false", { rows, SENT });
});
await tryCase("taps: never touched as ever; unticked here a tap on a light switches nothing; ticked again it switches", async () => {
  kept.clear();
  const k = card(newView(), { slot: "flat-d" });
  const h = wiredHex(k);
  h.press(0);
  const before = h.log.splice(0);
  await openList(k); click(tickOf(k, "light_taps"));
  const pref = JSON.parse(kept.get("padspan_la3d_" + SHOW.prefKey("flat-d")) || "{}");
  h.press(0);
  const off = h.log.splice(0);
  click(tickOf(k, "light_taps"));
  h.press(0);
  const back = h.log.splice(0);
  check("taps: never touched as ever; unticked here a tap on a light switches nothing; ticked again it switches",
    JSON.stringify(before) === JSON.stringify([["toggle", "light.hall"]]) && pref.light_taps === false && off.length === 0
    && JSON.stringify(back) === JSON.stringify([["toggle", "light.hall"]]) && !("light_taps" in JSON.parse(kept.get("padspan_la3d_show_flat-d") || "{}")),
    { before, pref, off, back });
});
await tryCase("floors: Other floors, faded ticked here: one floor chosen, the others drawn faded at once", async () => {
  kept.clear();
  const view = newView();
  view.focusIdx = 1;
  const k = card(view, { slot: "flat-e" });
  const ghosts = () => (k.stage.innerHTML.match(/data-role="floorghost"/g) || []).length;
  const alone = ghosts();
  await openList(k); click(tickOf(k, "other_floors"));
  const faded = ghosts();
  click(tickOf(k, "other_floors"));
  check("floors: Other floors, faded ticked here: one floor chosen, the others drawn faded at once", alone === 0 && faded > 0 && ghosts() === 0, { alone, faded, back: ghosts() });
});
await tryCase("shared: the 3D look's tick is the flat Map's, and the flat Map's is the 3D look's (one pref per screen)", async () => {
  kept.clear();
  // As Live Aboard's own list writes it (live_aboard.js toggleShow: SHOW.withTick into SHOW.prefKey(slot)).
  kept.set("padspan_la3d_" + SHOW.prefKey("flat-f"), JSON.stringify(SHOW.withTick({}, "light_taps", false, SHOW.houseOn({}, "light_taps"))));
  const k = card(newView(), { la: true, slot: "flat-f" });
  const h = wiredHex(k);
  h.press(0);
  const from3d = h.log.splice(0);
  await openList(k);
  const shown = tickOf(k, "light_taps").getAttribute("aria-checked");
  click(tickOf(k, "other_floors"));
  // What the 3D look reads back (live_aboard.js showOver: SHOW.readShown of the same key).
  const read = SHOW.resolveShown(SHOW.readShown(kept.get("padspan_la3d_" + SHOW.prefKey("flat-f"))), {});
  check("shared: the 3D look's tick is the flat Map's, and the flat Map's is the 3D look's (one pref per screen)",
    from3d.length === 0 && shown === "false" && read.other_floors === true && read.light_taps === false, { from3d, shown, read });
});
await tryCase("reset: Back to house defaults on the flat Map forgets its lines only", async () => {
  kept.clear();
  kept.set("padspan_la3d_show_flat-g", JSON.stringify({ light_taps: false, other_floors: true, roof: false }));
  const k = card(newView(), { slot: "flat-g" });
  await openList(k);
  const btn = k.c._all().find(n => n.className === "la3d-sreset");
  click(btn);
  check("reset: Back to house defaults on the flat Map forgets its lines only",
    JSON.stringify(JSON.parse(kept.get("padspan_la3d_show_flat-g"))) === JSON.stringify({ roof: false }), kept.get("padspan_la3d_show_flat-g"));
});

console.log(JSON.stringify({ cases, failures }));
process.exit(failures.length ? 1 : 0);
