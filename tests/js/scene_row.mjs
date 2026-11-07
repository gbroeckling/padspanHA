// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
//
// The scene row (views/scene_row.js): its pure parts, the row itself under
// the DOM shim, and the row inside the real 3D view with the ⋯ list:
//
//   qualify   which scenes and presets make a tile: a scene that sets a
//             placed light (not one that can't run, is hidden, or sets none
//             placed); a preset whose lights that are on sit on one floor
//   state     on / mixed / off from the lights now (unavailable not
//             counted), and a tap: run unless all on, then off
//   map       the mini map fits the floor, the same scale both ways, turned
//             a quarter for a tall house; its own lights lit, the rest faint;
//             the floor with most of a scene's lights, the others named
//   row       a tap acts once (busy for a moment), ✎ for administrators
//             (never on a wall), a preset's ✎ for anyone, + New scene goes,
//             asks or says where; a tile is built again only when it changed
//   aboard    the row on Live Aboard's bottom bar, above its controls; the ⋯
//             list's Scene row hides it on this screen; no scenes: the line
//             says so and Yes › opens the new-scene editor (an administrator),
//             anyone else and a wall are told where; on a wall no link or
//             Yes › leads off the page
//   rails     Railings takes a stair's rails too (and makes the line ready)
//   report    every count is a word of the closed list
//
// usage: scene_row.mjs <www/padspan-ha dir>
// prints one JSON line: { cases: {name: result}, failures: [...], events }

import { pathToFileURL } from "node:url";
import { join } from "node:path";
import * as shim from "./dom_shim.mjs";
import { installStubGL } from "./stub_gl.mjs";

const WWW = process.argv[2];
if (!WWW) { console.error("usage: scene_row.mjs <www/padspan-ha dir>"); process.exit(2); }
shim.install();
{
  const NP = globalThis.Node.prototype, ap = NP.appendChild, ib = NP.insertBefore, rc = NP.removeChild;
  const leave = (c) => { const p = c && c.parentNode; if (p && p.children) { const i = p.children.indexOf(c); if (i >= 0) p.children.splice(i, 1); } };
  NP.appendChild = function(c){ leave(c); return ap.call(this, c); };
  NP.insertBefore = function(c, ref){ leave(c); return ib.call(this, c, ref); };
  NP.removeChild = function(c){ const r = rc.call(this, c); if (c && c.parentNode === this) c.parentNode = null; return r; };
}
const lists = { window: {}, document: {} };
const listen = (key) => ({
  add: (t, fn) => { (lists[key][t] ||= []).push(fn); },
  remove: (t, fn) => { lists[key][t] = (lists[key][t] || []).filter(f => f !== fn); },
});
const W = listen("window"), Dc = listen("document");
globalThis.addEventListener = W.add; globalThis.removeEventListener = W.remove;
document.addEventListener = Dc.add; document.removeEventListener = Dc.remove;
installStubGL();

const url = (p) => pathToFileURL(join(WWW, p)).href;
const SC = await import(url("views/scene_row.js"));
const LA = await import(url("views/live_aboard.js"));
const SHOW = await import(url("views/live_aboard_show.js"));
const HOUSE = await import(url("views/live_aboard_house.js"));
const LM = await import(url("views/lights_map.js"));
const FURN = await import(url("views/live_aboard_furniture.js"));
const THREE = await import(url("vendor/three/three.module.min.js"));

const failures = [];
const cases = {};
const check = (name, ok, detail) => { cases[name] = !!ok; if (!ok) failures.push({ name, detail: detail === undefined ? null : detail }); };
const tryCase = async (name, fn) => {
  try { await fn(); } catch (e) { failures.push({ name, detail: String(e && e.stack || e).slice(0, 900) }); cases[name] = false; }
};
const settle = async (rounds = 14) => { await shim.flush(rounds); await new Promise(r => globalThis._realSetTimeout(r, 0)); };

// ── a small house: two floors, lights on both ──────────────────────────────
const rect = (floor_id, x0, y0, x1, y1) => ({ type: "poly", floor_id, points_m: [[x0, y0], [x1, y0], [x1, y1], [x0, y1]] });
const FLOORS = [{ id: "main", name: "Main", level: 0 }, { id: "up", name: "Upstairs", level: 1 }];
const MODEL = {
  floors: FLOORS, floor_elevations: { main: 0, up: 2.8 },
  room_geometry_m: { Kitchen: rect("main", 0, 0, 6, 4), Hall: rect("main", 6, 0, 10, 4), Loft: rect("up", 0, 0, 5, 4), Bed: rect("up", 5, 0, 10, 4) },
  light_positions_m: {
    "light.kitchen": { x_m: 3, y_m: 2, floor_id: "main" }, "light.hall": { x_m: 8, y_m: 2, floor_id: "main" },
    "light.island": { x_m: 2, y_m: 3, floor_id: "main" }, "light.loft": { x_m: 2, y_m: 2, floor_id: "up" },
    "light.bed": { x_m: 7, y_m: 2, floor_id: "up" }, "lock.back": { x_m: 0.2, y_m: 2, floor_id: "main" },
    "binary_sensor.hall_motion": { x_m: 9, y_m: 1, floor_id: "main" },
  },
  rf_barriers_m: [], scanner_positions_m: {}, scanners: {},
};
const st = (state, attrs = {}) => ({ state, attributes: attrs, last_changed: "", last_updated: "" });
const STATES = {
  "light.kitchen": st("on", { friendly_name: "Kitchen", rgb_color: [255, 0, 0] }), "light.hall": st("off", { friendly_name: "Hall" }),
  "light.island": st("on", { friendly_name: "Island" }), "light.loft": st("off", { friendly_name: "Loft" }), "light.bed": st("off", { friendly_name: "Bed" }),
  "light.porch": st("on", { friendly_name: "Porch (not placed)" }), "light.gone": st("unavailable", { friendly_name: "Gone" }),
  "lock.back": st("locked", { friendly_name: "Back lock" }), "binary_sensor.hall_motion": st("off", { friendly_name: "Hall motion", device_class: "motion" }),
  "scene.cooking": st("2026-11-06T20:00:00Z", { friendly_name: "Cooking", id: "111", entity_id: ["light.kitchen", "light.island"] }),
  "scene.evening": st("unknown", { friendly_name: "Evening", id: "222", entity_id: ["light.kitchen", "light.hall", "light.loft"] }),
  "scene.night": st("unknown", { friendly_name: "Night", entity_id: ["light.hall", "light.loft", "light.bed", "lock.back"] }),
  "scene.away": st("unknown", { friendly_name: "Away (no placed light)", entity_id: ["light.porch"] }),
  "scene.broken": st("unavailable", { friendly_name: "Broken", entity_id: ["light.kitchen"] }),
  "scene.hidden": st("unknown", { friendly_name: "Hidden", entity_id: ["light.kitchen"] }),
  "scene.locks": st("unknown", { friendly_name: "Lock up", entity_id: ["lock.back"] }),
};
const ENTITIES = { "scene.hidden": { hidden: true } };
const PRESETS = [
  { name: "Upstairs reading", entities: { "light.loft": { state: "on", rgb_color: [0, 0, 255] }, "light.bed": { state: "on" }, "light.kitchen": { state: "off" }, "light.hall": { state: "off" } } },
  { name: "Everywhere", entities: { "light.loft": { state: "on" }, "light.kitchen": { state: "on" } } },
  { name: "Porch only", entities: { "light.porch": { state: "on" } } },
  { name: "All off", entities: { "light.loft": { state: "off" } } },
];
const LBE = Object.fromEntries(LM.gatherLights(STATES, {}, {}, "pro", {}, {}, {}, {}, Date.now()).map(l => [l.entity_id, l]));
const placed = MODEL.light_positions_m;
const isLight = (e) => /^(light|fan)\./.test(e);
const floorOf = (e) => (placed[e] ? placed[e].floor_id : null);

// ── which qualify ───────────────────────────────────────────────────────────
await tryCase("qualify: scenes with a placed light, presets lit on one floor", async () => {
  const sc = SC.haScenesOf(STATES, { placed, isLight, entities: ENTITIES });
  const pr = SC.presetScenesOf(PRESETS, { placed, isLight, floorOf });
  check("qualify: scenes with a placed light, presets lit on one floor",
    JSON.stringify(sc.map(s => s.eid)) === JSON.stringify(["scene.cooking", "scene.evening", "scene.night"])
    && sc[0].id === "111" && sc[2].id === null && !sc[2].lights.includes("lock.back")
    && pr.length === 1 && pr[0].name === "Upstairs reading" && pr[0].floor === "up" && pr[0].lights.join() === "light.loft,light.bed",
    { sc, pr: pr.map(p => p.name) });
});
await tryCase("qualify: a preset with an on light whose floor isn't known is judged by the rest; outdoor names its floor", async () => {
  const pr = SC.presetScenesOf([{ name: "Mixed", entities: { "light.loft": { state: "on" }, "light.porch": { state: "on" } } }], { placed, isLight, floorOf });
  check("qualify: a preset with an on light whose floor isn't known is judged by the rest; outdoor names its floor",
    pr.length === 1 && pr[0].all.length === 2 && pr[0].lights.length === 1
    && SC.canonFloor("__outside__", [{ id: "outside" }]) === "outside" && SC.floorName("outside", []) === "Outside", pr);
});

await tryCase("qualify: a preset tile applies only its own floor", async () => {
  const pr = SC.presetScenesOf(PRESETS, { placed, isLight, floorOf });
  const ap = pr[0] && pr[0].applyPreset && pr[0].applyPreset.entities;
  check("qualify: a preset tile applies only its own floor",
    !!ap && Object.keys(ap).every(e => floorOf(e) === "up" || pr[0].all.includes(e)) && ap["light.loft"] && ap["light.bed"]
    && Object.keys(PRESETS[0].entities).some(e => floorOf(e) && floorOf(e) !== "up" && !(e in ap))
    && pr[0].preset === PRESETS[0], { ap });
});

// ── on / mixed / off ────────────────────────────────────────────────────────
await tryCase("state: on, mixed, off; unavailable not counted; the tap runs unless all are on", async () => {
  const on = (m) => (e) => (e in m ? m[e] : null);
  const a = SC.sceneStateOf(["a", "b"], on({ a: true, b: true })), b = SC.sceneStateOf(["a", "b"], on({ a: true, b: false }));
  const c = SC.sceneStateOf(["a", "b"], on({ a: false, b: false })), d = SC.sceneStateOf(["a", "b"], on({ a: true }));
  const e = SC.sceneStateOf(["a"], on({}));
  check("state: on, mixed, off; unavailable not counted; the tap runs unless all are on",
    a === "on" && b === "mixed" && c === "off" && d === "on" && e === "off"
    && SC.tapOf("on") === "off" && SC.tapOf("mixed") === "run" && SC.tapOf("off") === "run", { a, b, c, d, e });
});

// ── the mini map ────────────────────────────────────────────────────────────
await tryCase("map: fits the floor at one scale, a tall house turned a quarter, lights kept inside", async () => {
  const m = SC.miniMap([[[0, 0], [10, 0], [10, 4], [0, 4]]], [{ eid: "x", x: 5, y: 2 }, { eid: "far", x: 50, y: 50 }], { w: 140, h: 80, pad: 6 });
  const t = SC.miniMap([[[0, 0], [4, 0], [4, 10], [0, 10]]], [{ eid: "x", x: 2, y: 9 }], { w: 140, h: 80, pad: 6, turn: true });
  const flat = SC.miniMap([[[0, 0], [4, 0], [4, 10], [0, 10]]], [], { w: 140, h: 80, pad: 6 });
  const svg = SC.miniMapSvg({ ...m, lights: [{ x: 70, y: 40, mine: true, on: true, colour: "rgb(255,0,0)" }, { x: 10, y: 10, mine: false }] });
  check("map: fits the floor at one scale, a tall house turned a quarter, lights kept inside",
    m.k === 12.8 && m.lights[0].x === 70 && m.lights[0].y === 40 && m.lights[1].x === 138 && m.lights[1].y === 78
    && t.k > flat.k * 1.5 && /<path d="M/.test(svg) && (svg.match(/<circle/g) || []).length === 3 && svg.includes("rgb(255,0,0)")
    && svg.includes('fill-opacity=".32"'), { m, tk: t.k, fk: flat.k });
});
await tryCase("map: tiles name the floor with most lights and the others, colours where known, a sig per look", async () => {
  const isOn = (e) => { const s = STATES[e]; return !s || s.state === "unavailable" ? null : s.state === "on"; };
  const tiles = SC.sceneTiles({ states: STATES, entities: ENTITIES, model: MODEL, floors: FLOORS, presets: PRESETS, isLight, isOn, floorOf });
  const by = Object.fromEntries(tiles.map(t => [t.name, t]));
  const ck = by.Cooking, ev = by.Evening, nt = by.Night, pr = by["Upstairs reading"];
  const lit = (t) => t.map.lights.filter(l => l.mine);
  check("map: tiles name the floor with most lights and the others, colours where known, a sig per look",
    tiles.length === 4 && ck.state === "on" && ev.state === "mixed" && nt.state === "off" && pr.state === "off"
    && ev.floor === "main" && ev.others.join() === "Upstairs" && ev.floorName === "Main" && nt.floor === "up" && nt.others.join() === "Main"
    && lit(ck).length === 2 && lit(ck).find(l => l.eid === "light.kitchen").colour === "rgb(255,0,0)" && lit(ck).every(l => l.on)
    && ck.map.lights.some(l => !l.mine && l.eid === "light.hall") && !ck.map.lights.some(l => l.eid === "lock.back")
    && lit(pr).find(l => l.eid === "light.loft").colour === "rgb(0,0,255)" && pr.offEids.join() === "light.loft,light.bed"
    && ck.offEids.join() === "light.kitchen,light.island" && ck.sig !== ev.sig
    && SC.colourOfAttrs({ hs_color: [120, 100] }) === "hsl(120,100%,50%)" && SC.colourOfAttrs({ color_temp_kelvin: 2700 }) === "#ffc46b"
    && SC.colourOfAttrs({}) === null && SC.sceneEditPath("111") === "/config/scene/edit/111" && SC.sceneEditPath(null) === SC.SCENE_LIST_PATH,
    tiles.map(t => [t.name, t.state, t.floor, t.others]));
});

// ── the row ─────────────────────────────────────────────────────────────────
const click = (b) => b && b.dispatchEvent({ type: "click", detail: 1, stopPropagation() {}, preventDefault() {}, composedPath: () => [b] });
const isOnNow = (e) => { const s = STATES[e]; return !s || s.state === "unavailable" ? null : s.state === "on"; };
const tilesNow = () => SC.sceneTiles({ states: STATES, entities: ENTITIES, model: MODEL, floors: FLOORS, presets: PRESETS, isLight, isOn: isOnNow, floorOf });
await tryCase("row: a tap acts once, ✎ for administrators only and never on a wall, + New scene goes, asks or says where", async () => {
  const did = [], counted = [];
  const row = SC.createSceneRow({ doc: document, place: "atlas" });
  document.body.appendChild(row.el);
  const M = (o) => ({ tiles: tilesNow(), admin: true, kiosk: false, editPresets: true, act: (t) => did.push(["act", t.key, t.state]),
                      edit: (t, r) => did.push(["edit", t.key, !!(r && r.note)]), add: (f) => did.push(["add", f]), count: (n, once) => counted.push([n, !!once]), ...o });
  row.update(M());
  const s0 = row.state();
  const go = row.el.querySelectorAll(".psc-tile").find(n => n.getAttribute("data-scene") === "scene.cooking").querySelector(".psc-go");
  click(go); click(go);
  const ed = row.el.querySelectorAll(".psc-tile").find(n => n.getAttribute("data-scene") === "scene.evening").querySelector(".psc-edit");
  click(ed);
  click(row.el.querySelector("[data-scene-new]"));
  const tileBefore = row.el.querySelectorAll(".psc-tile").find(n => n.getAttribute("data-scene") === "scene.night");
  row.update(M());
  const kept = row.el.querySelectorAll(".psc-tile").find(n => n.getAttribute("data-scene") === "scene.night") === tileBefore;
  row.update(M({ admin: false }));
  const s1 = row.state();
  row.update(M({ kiosk: true }));
  const s2 = row.state(), kioskText = row.el.querySelector("[data-scene-new]").textContent;
  row.hide(true);
  const hid = !row.state().shown;
  row.hide(false); row.update(M({ tiles: [] }));
  const none = !row.state().shown;
  check("row: a tap acts once, ✎ for administrators only and never on a wall, + New scene goes, asks or says where",
    s0.shown && s0.tiles.length === 4 && s0.edits === 4 && s0.add === "go"
    && JSON.stringify(did) === JSON.stringify([["act", "scene.cooking", "on"], ["edit", "scene.evening", true], ["add", "row"]])
    && kept && s1.edits === 1 && s1.add === "ask" && s2.edits === 1 && s2.add === "kiosk"
    && /from another screen/.test(kioskText) && /Automations & scenes/.test(kioskText) && hid && none
    && counted.length === 1 && counted[0][0] === "house3d_show:scene_row:atlas" && counted[0][1] === true,
    { s0, s1, s2, did, counted, kioskText });
  row.dispose();
});
await tryCase("row: a note says why with one button, and goes away", async () => {
  const row = SC.createSceneRow({ doc: document, place: "atlas" });
  let went = 0;
  row.update({ tiles: tilesNow(), admin: true, act() {}, edit() {}, add() {}, count() {} });
  row.note("Night wasn't made in Home Assistant's scene editor", "Scene list ›", () => { went++; });
  const n0 = row.state().note;
  click(row.el.querySelectorAll(".psc-ok")[0]);
  check("row: a note says why with one button, and goes away", /scene editor/.test(n0) && went === 1 && row.state().note === null, { n0 });
  row.dispose();
});

// ── in Live Aboard ──────────────────────────────────────────────────────────
const SENT = [];
const H = { went: [], added: [], acts: [], admin: true, kiosk: false, goTo: true, tiles: true };
const store = new Map();
const prefs = { get: (k) => store.get(k) ?? null, set: (k, v) => store.set(k, String(v)) };
const host = document.createElement("padspan-lights-app");
const shadow = document.createElement("#shadow-root");
shadow.host = host;
document.body.appendChild(host);
host.appendChild(shadow);
const PIECES = { fur_00000003: { id: "fur_00000003", recipe: { kind: "stairs", params: { to_floor: "up", rail: "both" }, colors: [], width_m: 1, depth_m: 3, height_m: 2.8 },
  origin: "build", label: "", floor_id: "main", x_m: 8.5, y_m: 2, z_m: 0, rotation: 0, entity_id: null, entity_reg_id: null } };
const scenesP = () => ({ tiles: H.tiles ? tilesNow() : [], admin: H.admin, kiosk: H.kiosk, editPresets: true,
  act: (t) => H.acts.push(t.key), edit: () => {}, add: H.admin && !H.kiosk ? (from) => H.added.push(from) : null,
  count: (n) => SENT.push(n) });
const P = () => ({ model: MODEL, floors: FLOORS, lightsByEid: LBE, hidden: new Set(), topFloorIds: null, quality: "low",
  telemetry: (name) => SENT.push(name), onTouch: () => {}, states: STATES, config: {}, bearing: 0, saveNorth: null, useApi: () => null,
  haStartedMs: 0, load: async () => ({ data: { schema: 1, pieces: PIECES, lights: {}, openings: {}, devices: {}, figures: {} } }),
  edit: null, furnish: null, mapOnly: true, floorSteps: null, prefs, weather: null, showcase: { key: "classic", theme: {} }, look3d: "atlas",
  atlasLook: { on: false, key: "classic", theme: {} }, codes: { showcase: false }, people: null, tags: null,
  settings3d: { atlas_3d_enabled: true }, admin: H.admin, saveSetting: null, kiosk: H.kiosk,
  goTo: H.goTo ? (t) => H.went.push(t) : null, scenes: scenesP() });
let slot = null;
function poll(){
  const c = document.createElement("div"), stage = document.createElement("div");
  c.appendChild(stage);
  const content = shadow.children.find(n => n.className === "content") || shadow.appendChild(Object.assign(document.createElement("div"), { className: "content" }));
  content.replaceChildren(c);
  return slot.attach(stage, P());
}
function inTree(n, top){ for (let x = n; x; x = x.parentNode) if (x === top) return true; return false; }
slot = LA.liveAboardSlot("scenes-a");
poll();
{ const el = slot.element; if (el && !el.getRootNode) el.getRootNode = () => (inTree(el, shadow) ? shadow : el); }
poll();
await settle(30);
const S = () => slot._state();
const q = (sel) => slot.element.querySelector(sel);
const qa = (sel) => slot.element.querySelectorAll(sel);
const more = () => q("[data-la3d-more]");
const srow = (key) => qa(".la3d-srow").find(r => r.getAttribute("data-show") === key) || null;
const tick = (key) => { const r = srow(key); return r ? r.querySelector(".la3d-stick") : null; };
const setupOf = (key) => qa(".la3d-setup").find(r => r.getAttribute("data-setup") === key) || null;
const openList = async () => { if (!S().show.menu.open) { click(more()); await settle(); } };
const closeList = async () => { if (S().show.menu.open) { click(q(".la3d-sx")); await settle(); } };

await tryCase("aboard: the row on the bottom bar, its own line above the controls", async () => {
  const r = q(".psc-aboard"), bar = q(".la3d-bar");
  const s = S().scenes;
  check("aboard: the row on the bottom bar, its own line above the controls",
    r && r.parentNode === bar && bar.children[0] === r && bar.classList.contains("psc-has") && s.shown && s.tiles.length === 4
    && SENT.includes("house3d_show:scene_row:aboard"), { s, kids: bar && bar.children.map(c => c.className) });
  const go = r.querySelectorAll(".psc-go")[0];
  click(go); await settle();
  check("aboard: a tap goes to the host's act", H.acts.length === 1, H.acts);
});
await tryCase("aboard: the ⋯ list's Scene row hides the row on this screen, and back", async () => {
  await openList();
  const listed = !!srow("scenes") && srow("scenes").parentNode.getAttribute("aria-label") === "Lights" && !srow("scenes").querySelector(".la3d-slink");
  click(tick("scenes")); await settle();
  const hidden = !S().scenes.shown && JSON.parse(store.get("show_scenes-a") || "{}").scenes === false;
  click(tick("scenes")); await settle();
  const back = S().scenes.shown && !("scenes" in JSON.parse(store.get("show_scenes-a") || "{}"));
  await closeList();
  check("aboard: the ⋯ list's Scene row hides the row on this screen, and back",
    listed && hidden && back && SENT.includes("house3d_show:hide:scenes") && SENT.includes("house3d_show:show:scenes"), { listed, hidden, back });
});
await tryCase("aboard: no scenes: the line says so and Yes › opens the new-scene editor", async () => {
  H.tiles = false; poll(); await settle();
  await openList();
  const line = setupOf("scenes"), text = line ? line.textContent : "";
  const rowGone = !S().scenes.shown;
  click(line && line.querySelector("button")); await settle();
  check("aboard: no scenes: the line says so and Yes › opens the new-scene editor",
    rowGone && /No lighting scenes yet/.test(text) && /Make one\?/.test(text) && H.added.join() === "show"
    && SENT.includes("house3d_show:setup_go:scenes") && !S().show.menu.open, { text, added: H.added });
});
await tryCase("aboard: anyone else is told an administrator makes scenes, with no button", async () => {
  H.admin = false; poll(); await settle();
  await openList();
  const line = setupOf("scenes"), text = line ? line.textContent : "";
  check("aboard: anyone else is told an administrator makes scenes, with no button",
    /An administrator makes scenes in Home Assistant/.test(text) && !line.querySelector("button"), { text });
  await closeList();
  H.admin = true;
});
await tryCase("aboard: on a wall nothing leads off the page: set-up lines say where, from another screen", async () => {
  H.kiosk = true; H.goTo = false; poll(); await settle();
  await openList();
  const sc = setupOf("scenes") ? setupOf("scenes").textContent : "", rain = setupOf("rain") ? setupOf("rain").textContent : "";
  const buttons = qa(".la3d-setup").filter(l => l.getAttribute("data-setup") !== "people" && l.getAttribute("data-setup") !== "tags")
    .map(l => l.querySelector("button")).filter(Boolean).length;
  const links = qa(".la3d-slink").length, foot = !!q(".la3d-sset");
  await closeList();
  H.tiles = true; poll(); await settle();
  const st = S().scenes;
  check("aboard: on a wall nothing leads off the page: set-up lines say where, from another screen",
    /Make one from another screen, in Home Assistant → Settings → Automations & scenes → Scenes/.test(sc)
    && /Set it up from another screen, in PadSpan → Settings → Atlas → Outdoor weather/.test(rain)
    && buttons === 0 && links === 0 && !foot && st.shown && st.edits === 1 && st.add === "kiosk", { sc, rain, buttons, links, foot, st });
  H.kiosk = false; H.goTo = true; poll(); await settle();
});
await tryCase("rails: Railings takes the stair's rails too, and stair rails make the line ready", async () => {
  await openList();
  const ready = !setupOf("railings") && /stair rails/.test(srow("railings").textContent);
  const before = S().pieces.find(p => p.id === "fur_00000003");
  click(tick("railings")); await settle(); poll(); await settle();
  const after = S().pieces.find(p => p.id === "fur_00000003");
  click(tick("railings")); await settle(); poll(); await settle();
  const again = S().pieces.find(p => p.id === "fur_00000003");
  await closeList();
  // The builder: no rail, spindle or post when hidden; the steps the same.
  const S0 = { w: 1, d: 3, h: 2.8 };
  const g1 = FURN.buildPiece(THREE, { kind: "stairs", params: { rail: "both" }, width_m: 1, depth_m: 3, height_m: 2.8 }, { quality: "low" });
  const g0 = FURN.buildPiece(THREE, { kind: "stairs", params: { rail: "both", rails_shown: false }, width_m: 1, depth_m: 3, height_m: 2.8 }, { quality: "low" });
  const g2 = FURN.buildPiece(THREE, { kind: "stairs", params: { rail: "none" }, width_m: 1, depth_m: 3, height_m: 2.8 }, { quality: "low" });
  const count = (g) => { let n = 0; g.traverse(o => { if (o.isMesh) n += o.isInstancedMesh ? o.count : (o.geometry && o.geometry.attributes.position ? o.geometry.attributes.position.count : 1); }); return n; };
  void S0;
  check("rails: Railings takes the stair's rails too, and stair rails make the line ready",
    ready && before && !before.noRails && after && after.noRails && again && !again.noRails && count(g0) < count(g1) && count(g0) === count(g2),
    { ready, before, after, again, c: [count(g0), count(g1), count(g2)] });
});
await tryCase("report: every count sent is a word of the closed list, the row's own words too", async () => {
  const all = new Set(HOUSE.HOUSE3D_EVENTS);
  check("report: every count sent is a word of the closed list, the row's own words too",
    SC.SCENE_EVENTS.every(e => all.has(e) && SHOW.SHOW_EVENTS.includes(e)) && SENT.every(n => all.has(n)),
    { bad: [...new Set(SENT)].filter(n => !all.has(n)), missing: SC.SCENE_EVENTS.filter(e => !all.has(e)) });
});

LA.releaseLiveAboardSlot("scenes-a");
console.log(JSON.stringify({ cases, failures, events: SC.SCENE_EVENTS }));
