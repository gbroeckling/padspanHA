// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
//
// Wrong words on screen (visual check of 2026-11-01), RUN rather than read:
//   library, layout   the outside floor reads Outside, never its id
//   legend            3D Preview names each level from its plans' own floors;
//                     a long plan name stops short of the floor name
//   monitor, health   floors by Home Assistant's name, not their ids
//   problems          "Problems found" once
//   manage            "switch to Live" only in Sample; no debug line on Events
// The pytest wrapper is tests/test_visual_words.py.
//
// Run:  node tests/js/visual_words.mjs <repo-root>
import { pathToFileURL } from "node:url";
const ROOT = process.argv[2];
const { install, flush } = await import(pathToFileURL(ROOT + "/tests/js/dom_shim.mjs").href);
install(globalThis);
const V = ROOT + "/custom_components/padspan_ha/www/padspan-ha/views/";
const imp = (n) => import(pathToFileURL(V + n).href);
const MAPS = await imp("maps.js"), MON = await imp("monitor.js"), HEALTH = await imp("health.js"), MAN = await imp("manage.js");

const results = {};
const check = (name, ok, detail) => { results[name] = { ok: !!ok, detail: ok ? undefined : detail }; };

function el(tag, attrs = {}, children = []) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (k === "class") n.className = v; else if (k === "id") n.id = v; else if (k === "style") n.setAttribute("style", v);
    else if (k.startsWith("on") && typeof v === "function") n.addEventListener(k.slice(2), v);
    else if (v !== undefined && v !== null) n.setAttribute(k, String(v));
  }
  if (!Array.isArray(children)) children = [children];
  for (const c of children) { if (c == null) continue; n.appendChild(typeof c === "string" || typeof c === "number" ? document.createTextNode(String(c)) : c); }
  return n;
}
const quiet = () => new Proxy(() => document.createElement("span"), {
  get: (_t, k) => (k === "then" ? undefined : (k === Symbol.toPrimitive || k === "toString") ? () => "" : quiet()),
  apply: () => document.createElement("span"),
});
const all = (n, out = []) => { for (const c of (n.childNodes || n.children || [])) { out.push(c); all(c, out); } return out; };
const text = (n) => (n.textContent || "").replace(/\s+/g, " ").trim();
const count = (s, w) => s.split(w).length - 1;

// As a house with no levels set in HA: Basement, Main, Outside, Upper in name
// order, plans stacked Basement, Main, Upper, then the outside plan on top.
const FLOORS = [{ id: "basement", name: "Basement", level: null }, { id: "main", name: "Main", level: null },
                { id: "outside", name: "Outside", level: null }, { id: "upper", name: "Upper", level: null }];
const plan = (id, name, floor_id, z) => ({ id, name, floor_id, stack: { z_level: z, ceiling_height_m: 2.4 },
  image: { width: 800, height: 600, filename: id + ".png" }, receivers: [], room_bounds: {} });
const LONG = "Screenshot 2026-03-14 095453 + a very long plan name that would run right over the floor name.png";
const MAP_LIST = [plan("b", LONG, "basement", 0), plan("m", "Main plan", "main", 1), plan("u", "Upper plan", "upper", 2), plan("o", "Yard", "__outside__", 3)];
const GEO = { Shed: { floor_id: "__outside__", points_m: [[0, 0], [1, 0], [1, 1]], type: "poly" }, Kitchen: { floor_id: "main", points_m: [[0, 0], [2, 0], [2, 2]], type: "poly" } };

function makeCtx(state, ws = {}) {
  const s = Object.assign({
    dataMode: "live", _dataModeKnown: true, complexity: "advanced", view: "maps", version: "0", buildId: "b",
    settings: { tier: "pro", edition: "full" }, followedAddrs: new Set(), timing: {}, roomTagMap: {}, wsCounts: {},
    model: { floors: FLOORS, areas: [{ id: "kitchen", name: "Kitchen", floor_id: "main" }, { id: "den", name: "Den", floor_id: "upper" }],
             room_meta: {}, room_geometry_m: GEO, map_transforms: {}, scanner_positions_m: {} },
    maps: { list: MAP_LIST },
    live: { snapshot: { rooms_discovered: ["Kitchen", "Den"], ble: { radios: [] }, objects: { list: [], summary: {} }, tags: [] } },
  }, state);
  const call = async (p) => (ws[p && p.type] !== undefined ? ws[p.type] : {});
  const actions = { renderRooms: () => {}, renderNav: () => {}, callWS: call, wsCall: (t, p) => call(Object.assign({ type: t }, p)),
    settingsSet: async () => ({ settings: s.settings }), openModal: () => {}, closeModal: () => {}, telemetryEvent: () => {},
    objectLabelList: async () => ({}), canOpen: () => true, calibrationGet: async () => ({}), showView: () => {}, setMapsTab: (t) => { s.mapsTab = t; },
    mapsSetActive: (id) => { s.activeMapId = id; } };
  const helpers = new Proxy({ el, esc: (x) => String(x ?? ""), helpBtn: () => el("button", {}, "?"), radioShortId: () => "",
    isScanner: () => false, roomColor: () => "#fff", pill: (t) => el("span", {}, String(t ?? "")), HELP: {}, mapImageUrl: () => "/x.png" },
    { get: (t, k) => (k in t ? t[k] : quiet()) });
  return new Proxy({ hass: { states: {}, user: { is_admin: true }, connection: { sendMessagePromise: call } },
    state: s, helpers, actions: new Proxy(actions, { get: (t, k) => (k in t ? t[k] : quiet()) }), toast: () => {} },
    { get: (t, k) => (k in t ? t[k] : quiet()) });
}

// ── library, layout ─────────────────────────────────────────────────────────
{
  const root = MAPS.render(makeCtx({ mapsTab: "library" })); await flush();
  const t = text(root);
  check("library: with an HA floor called Outside, the outside plan's heading is Outside (Exp.)", /Outside \(Exp\.\) \(1\)/.test(t) && !/__outside__ \(/i.test(t), t.slice(0, 300));

  const both = makeCtx({ mapsTab: "library", maps: { list: MAP_LIST.concat(plan("h", "HA yard", "outside", 4)) } });
  const t2 = text(MAPS.render(both)); await flush();
  check("library: an HA floor called Outside and the outside plan's floor read differently",
    /Outside \(1\)/.test(t2) && /Outside \(Exp\.\) \(1\)/.test(t2), t2.slice(0, 400));

  const none = makeCtx({ mapsTab: "library" });
  none.state.model = Object.assign({}, none.state.model, { floors: FLOORS.filter(f => f.id !== "outside") });
  const t3 = text(MAPS.render(none)); await flush();
  check("library: with no HA floor called that, it is just Outside", /Outside \(1\)/.test(t3) && !/Exp\.\) \(1\)/.test(t3), t3.slice(0, 300));

  const layout = MAPS.render(makeCtx({ mapsTab: "rooms" })); await flush();
  const buttons = all(layout).filter(n => (n.tagName || "").toUpperCase() === "BUTTON").map(text);
  check("layout: no floor button shows the id", !buttons.includes("__outside__"), buttons);
  check("layout: an HA floor called Outside and the outside plan's floor read differently",
    buttons.includes("Outside") && buttons.includes("Outside (Exp.)"), buttons);

  const alone = makeCtx({ mapsTab: "rooms" });
  alone.state.model = Object.assign({}, alone.state.model, { floors: FLOORS.filter(f => f.id !== "outside") });
  const b2 = all(MAPS.render(alone)).filter(n => (n.tagName || "").toUpperCase() === "BUTTON").map(text);
  await flush();
  check("layout: with no HA floor called that, it is just Outside", b2.includes("Outside") && !b2.includes("Outside (Exp.)") && !b2.includes("__outside__"), b2);
}

// ── legend ──────────────────────────────────────────────────────────────────
{
  const root = MAPS.render(makeCtx({ mapsTab: "stack" })); await flush();
  const svg = all(root).map(n => n.innerHTML || "").find(h => h.includes("3D Floor Stack Preview")) || "";
  const right = [...svg.matchAll(/text-anchor="end" fill="#94a3b8" font-size="15">([^<]*)</g)].map(m => m[1].split(" · ")[0]);
  check("legend: each level is named from its plans' own floors", JSON.stringify(right) === JSON.stringify(["Basement", "Main", "Upper", "Outside"]), right);
  const left = [...svg.matchAll(/font-size="18" font-weight="500"><title>([^<]*)<\/title>([^<]*)</g)];
  const first = left[0] || [];
  check("legend: a long plan name stops short of the floor name, with the whole name on hover",
    first[1] && first[1].includes("over the floor name") && first[2].endsWith("…") && first[2].length * 18 * 0.6 + 36 < 770 - "Basement · 2.4m".length * 15 * 0.6, first.slice(1));
  check("legend: a short plan name is left whole", left[1] && left[1][1] === "Main plan" && left[1][2] === "Main plan", left[1] && left[1].slice(1));
}

// ── monitor ─────────────────────────────────────────────────────────────────
{
  const root = MON.render(makeCtx({ view: "monitor", _monitorTab: "zones" })); await flush();
  const heads = all(root).filter(n => n.getAttribute && /border-bottom/.test(n.getAttribute("style") || "") && /font-size:14px/.test(n.getAttribute("style") || "")).map(text);
  check("monitor: Zones heads each floor with its name", heads.includes("Main") && heads.includes("Upper") && !heads.includes("main") && !heads.includes("upper"), heads);
}

// ── health ──────────────────────────────────────────────────────────────────
{
  const fabric = { summary: { total: 0, passed: 0, failed: 0, healthy: true }, checks: [], adjacency: {},
    fabric_floors: { __outside__: { rooms: 1 }, main: { rooms: 1 } },
    scanner_positions_m: [{ source: "AA", x_m: 1, y_m: 1, z_m: 2, floor_id: "__outside__", origin: "manual" }],
    room_geometry_m: [{ room: "Kitchen", type: "poly", centroid_m: [1, 1], floor_id: "main", origin: "manual" }],
    scanners: [{ source: "BB", room: "Kitchen", floor_id: "upper", source_type: "manual" }],
    maps: [{ name: "P", width: 1, height: 1, has_receivers: 0, has_room_bounds: 0, has_rf_barriers: 0, floor_id: "basement" }] };
  const critics = { summary: { total: 1, critical: 1, warning: 0, info: 0, healthy: false }, critics: [], confusion_matrix: null, per_map_quality: [] };
  const root = HEALTH.render(makeCtx({ view: "health" }, { "padspan_ha/fabric_health": fabric, "padspan_ha/system_critics": critics }));
  await flush(16);
  const t = text(root), cells = all(root).map(text);
  check("health: layout tables show floors by name", ["Main", "Upper", "Basement", "Outside"].every(w => cells.includes(w)), t.slice(0, 400));
  check("health: no floor id in the tables", !t.includes("__outside__") && !["main", "upper", "basement"].some(w => cells.includes(w)), t.slice(0, 400));
  check("problems: the heading is there once", count(t, "Problems found") === 1 && t.includes("1 ISSUE"), t.slice(-300));
}

// ── manage ──────────────────────────────────────────────────────────────────
{
  const noSnap = { snapshot: { rooms: [], ble: { radios: [] }, objects: { list: [], summary: {} }, tags: [], ha_entities: [] } };
  for (const mode of ["live", "sample"]) {
    const data = MAN.render(makeCtx({ view: "manage", manageTab: "ha_entities", dataMode: mode, live: noSnap }, { "padspan_ha/ha_entities_audit": { entities: [] } }));
    await flush();
    const t = text(data);
    check(`manage: ${mode}: HA Entities says switch to Live only in Sample`, t.includes("No PadSpan entities found") && /switch to Live/i.test(t) === (mode === "sample"), t.slice(0, 400));
    const d = MAN.render(makeCtx({ view: "manage", manageTab: "data", dataMode: mode, live: noSnap }));
    await flush();
    const td = text(d);
    check(`manage: ${mode}: Data's "no entities" line says switch to Live only in Sample`,
      td.includes("No HA entities found in snapshot.") && td.includes("Switch to Live mode to see real entities.") === (mode === "sample"), td.slice(0, 400));
  }
  const ev = MAN.render(makeCtx({ view: "manage", manageTab: "events" }, { "padspan_ha/notify_services_list": { services: [] } }));
  await flush();
  const te = text(ev);
  check("manage: Events has its no-services help and no debug line", te.includes("No notification services found") && !te.includes("Debug:") && !te.includes("Backend: v"), te.slice(0, 400));
}

console.log(JSON.stringify(results));
