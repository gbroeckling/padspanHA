// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
//
// The Atlas's routing for WLED lights PadSpan runs (the exact look,
// wled_exact.py), RUN rather than read: a tap, the drag-dim, the light
// card, a room's "All lights off", a Whole House Preset and a map scene,
// each against a fake hass that records every websocket message and every
// service call. An exact device must go through padspan_ha/wled_power —
// once per device, or once per team PadSpan runs — and never through HA's
// light services; every other light must still get exactly the HA call it
// always got.
//
// usage: lights_exact_routing.mjs <views dir>
// prints one JSON line with what each surface sent.

import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { join } from "node:path";
import { install, flush } from "./dom_shim.mjs";

const VIEWS = process.argv[2];
if (!VIEWS) { console.error("usage: lights_exact_routing.mjs <views dir>"); process.exit(2); }

install(globalThis);
let now = 1_000_000;
globalThis.performance = { now: () => now };
// A per-browser "last dimmed level" for every light: an exact device must
// never use it (it comes on at its look's brightness everywhere).
localStorage.setItem("padspan_ha_last_bri", JSON.stringify({ "light.far_west": 20, "light.far_west_seg1": 20, "light.hall": 70 }));

const LM = await import(pathToFileURL(join(VIEWS, "lights_map.js")).href);

// Far West: a main light and two segment lights. Upper North + Upper South:
// one segment each (no main light), in a team PadSpan runs.
const DEVICES = [
  { device_id: "dFW", name: "Far West", main: "light.far_west", team_id: null, look_bri: 128, hold: true,
    lights: { "light.far_west": "main", "light.far_west_seg0": 0, "light.far_west_seg1": 1 } },
  { device_id: "dUN", name: "Upper North", main: null, team_id: "t1", look_bri: 150, hold: true, lights: { "light.upper_north": 0 } },
  { device_id: "dUS", name: "Upper South", main: null, team_id: "t1", look_bri: 180, hold: true, lights: { "light.upper_south": 0 } },
];
const st = (state, attributes = {}) => ({ state, attributes: { supported_color_modes: ["rgb"], friendly_name: "x", ...attributes } });
// The strip is dark (main off) while HA's segment lights read "on" from
// their segment flags — the lit-marker-on-a-dark-strip case.
const STATES = {
  "light.far_west": st("off"), "light.far_west_seg0": st("on", { brightness: 255 }), "light.far_west_seg1": st("on", { brightness: 255 }),
  "light.upper_north": st("off"), "light.upper_south": st("off"),
  "light.kitchen": st("on", { brightness: 90 }), "light.hall": st("off"),
};

// wled_power's answer: one result per device the command reached — the
// device, or every member of its PadSpan team.
function powerResults(devices, eid) {
  const d = devices.find(x => eid in x.lights);
  const reached = d && d.team_id ? devices.filter(x => x.team_id === d.team_id) : [d];
  return { handled: true, results: reached.map(x => ({ device_id: x.device_id, name: x.name, ok: true, tries: 1, diffs: [] })) };
}
function fakeHass(states = STATES, devices = DEVICES) {
  const ws = [], svc = [];
  return {
    ws, svc, states,
    callWS: async (m) => {
      ws.push(m);
      if (m.type === "padspan_ha/wled_exact_list") return { devices };
      if (m.type === "padspan_ha/wled_power") return powerResults(devices, m.entity_id);
      return {};
    },
    callService: async (domain, service, data) => { svc.push([domain, service, data]); },
  };
}
const power = (h) => h.ws.filter(m => m.type === "padspan_ha/wled_power").map(({ type, ...rest }) => rest);
const out = {};

// ── The list: loaded once, cached, re-rendered only on a change ──
{
  const hass = fakeHass();
  let renders = 0;
  await LM.ensureExactDevices(hass, () => { renders++; });
  LM.ensureExactDevices(hass, () => { renders++; });            // inside the TTL: no second fetch
  await LM.ensureExactDevices(hass, () => { renders++; }, { force: true });   // same list: no re-render
  out.list = { fetches: hass.ws.filter(m => m.type === "padspan_ha/wled_exact_list").length, renders,
    exact: ["light.far_west_seg1", "light.upper_south", "light.kitchen"].map(e => LM.isExactEntity(e)) };
}

// ── Markers: drawn as the device is; no remembered brightness ──
{
  const lights = LM.gatherLights(STATES, {}, {}, "pro", {}, {}, {}, {}, Date.now());
  out.markers = Object.fromEntries(lights.map(l => [l.entity_id, l.state]));
  const lit = { ...STATES, "light.far_west": st("on", { brightness: 50 }), "light.kitchen": st("on", { brightness: 91 }) };
  LM.gatherLights(lit, {}, {}, "pro", {}, {}, {}, {}, Date.now());
  out.remembered = { farWest: LM.lastBrightness("light.far_west"), kitchen: LM.lastBrightness("light.kitchen") };
}

// ── A tap ──
{
  const hass = fakeHass();
  await LM.toggleEntity(hass, "light.far_west_seg1", { render: () => {}, toast: () => {} });
  await LM.toggleEntity(hass, "light.upper_north", { render: () => {}, toast: () => {} });
  const teamMateDrawn = LM.effectiveState("light.upper_south", "off").state;
  await LM.toggleEntity(hass, "light.hall", { render: () => {}, toast: () => {} });
  out.tap = { power: power(hass), svc: hass.svc, teamMateDrawn };
  for (const e of Object.keys(STATES)) LM.clearOptimistic(e);
}

// ── A failed exact command is said out loud (and only then) ──
{
  const hass = fakeHass();
  hass.callWS = async (m) => (m.type === "padspan_ha/wled_power"
    ? { handled: true, results: [{ name: "Far West", ok: false, tries: 3, diffs: ["part 2: colour"], message: "part 2: colour didn't take after 3 tries" },
                                  { name: "Upper South", ok: false, waiting: true }] } : {});
  const toasts = [];
  await LM.toggleEntity(hass, "light.far_west", { render: () => {}, toast: (m, e) => toasts.push([m, !!e]) });
  out.failToast = toasts;
  for (const e of Object.keys(STATES)) LM.clearOptimistic(e);
}

// ── The drag-dim (hold, then drag up 40 px) ──
async function drag(hass, eid) {
  const isoDiv = document.createElement("div");
  const svg = document.createElement("svg");
  isoDiv.appendChild(svg);
  const g = document.createElement("g");
  g.setAttribute("class", "lhex"); g.setAttribute("data-eid", eid); g.setAttribute("data-cx", "10"); g.setAttribute("data-cy", "10");
  svg.appendChild(g);
  const toasts = [];
  LM.wireUseSurface(isoDiv, { hass, lightsByEid: { [eid]: { entity_id: eid, dimmable: true } }, controlsFor: () => true,
    toggle: () => {}, openControls: () => {}, openActivity: () => {}, rerender: () => {}, toast: (m) => toasts.push(m) });
  const ev = (type, y, t) => ({ type, button: 0, pointerType: "touch", pointerId: 1, clientX: 100, clientY: y, timeStamp: t,
    stopPropagation() {}, preventDefault() {} });
  now = 0;
  g.dispatchEvent(ev("pointerdown", 100, 0));
  now = 600;
  await flush();                                   // the hold arms
  g.dispatchEvent(ev("pointermove", 60, 650));      // 40 px up
  g.dispatchEvent(ev("pointerup", 60, 700));
  await flush();
  return toasts;
}
{
  const hass = fakeHass();
  await drag(hass, "light.far_west_seg1");
  const plain = fakeHass();
  await drag(plain, "light.kitchen");
  out.drag = { power: power(hass), svc: hass.svc, plainSvc: plain.svc, plainWs: plain.ws.length };
}

// ── The light card: On/Off and brightness ──
{
  const hass = fakeHass();
  const texts = (n, acc = []) => { for (const c of n.children || []) { acc.push(c); texts(c, acc); } return acc; };
  LM.openControlCard(hass, "light.far_west_seg1", { toast: () => {}, rerender: () => {} });
  let overlay = document.body.children[document.body.children.length - 1];
  const onBtn = texts(overlay).find(n => n.tagName === "BUTTON" && (n.textContent === "Turn On" || n.textContent === "Turn Off"));
  const label = onBtn.textContent;
  onBtn.click();
  await flush();
  LM.openControlCard(hass, "light.far_west_seg1", { toast: () => {}, rerender: () => {} });
  overlay = document.body.children[document.body.children.length - 1];
  const range = texts(overlay).find(n => n.tagName === "INPUT" && n.type === "range");
  const startsAt = range.value;
  range.value = "100";
  range.dispatchEvent({ type: "change" });
  await flush();
  out.card = { label, startsAt, power: power(hass), svc: hass.svc };
  for (const e of Object.keys(STATES)) LM.clearOptimistic(e);
}

// ── A room's "All lights off": one command per device or team ──
{
  const hass = fakeHass();
  await LM.setManyStates(hass, ["light.far_west", "light.far_west_seg0", "light.far_west_seg1", "light.upper_north",
    "light.upper_south", "light.kitchen", "light.hall"], false, {});
  out.room = { power: power(hass), svc: hass.svc };
  for (const e of Object.keys(STATES)) LM.clearOptimistic(e);
}

// ── A Whole House Preset ──
{
  const hass = fakeHass();
  // A segment light first: the device still follows its MAIN light.
  const r = await LM.applyWholeHouse(hass, { entities: {
    "light.far_west_seg1": { state: "on", brightness: 255, color_mode: "rgb", rgb_color: [1, 2, 3] },
    "light.far_west": { state: "on", brightness: 90, color_mode: "rgb", rgb_color: [255, 160, 0] },
    "light.upper_north": { state: "on", brightness: 200 },
    "light.upper_south": { state: "on", brightness: 120 },
    "light.kitchen": { state: "on", brightness: 40 },
    "light.hall": { state: "off" },
  } });
  out.preset = { power: power(hass), svc: hass.svc, result: r, text: LM.wholeHouseText(r) };
}

// ── A Whole House Preset whose exact command didn't take, waited, or threw ──
{
  const entities = { "light.far_west": { state: "on", brightness: 90 }, "light.upper_north": { state: "on", brightness: 200 },
    "light.kitchen": { state: "on", brightness: 40 } };
  const run = async (answer) => {
    const hass = fakeHass();
    hass.callWS = async (m) => (m.type === "padspan_ha/wled_power" ? answer(m) : {});
    const r = await LM.applyWholeHouse(hass, { entities });
    return { ...r, text: LM.wholeHouseText(r) };
  };
  out.presetFails = {
    failed: await run((m) => m.entity_id === "light.far_west"
      ? { handled: true, results: [{ device_id: "dFW", name: "Far West", ok: false, tries: 3, diffs: ["part 2: colour"], message: "part 2: colour didn't take after 3 tries" }] }
      : powerResults(DEVICES, m.entity_id)),
    waiting: await run((m) => m.entity_id === "light.upper_north"
      ? { handled: true, results: [{ device_id: "dUN", name: "Upper North", ok: true, tries: 1 }, { device_id: "dUS", name: "Upper South", ok: false, waiting: true }] }
      : powerResults(DEVICES, m.entity_id)),
    threw: await run((m) => { if (m.entity_id === "light.far_west") throw { code: "failed", message: "boom" }; return powerResults(DEVICES, m.entity_id); }),
  };
}

// ── A map scene (maps.js onSceneApply, run from its own source) ──
{
  const src = readFileSync(join(VIEWS, "maps.js"), "utf8");
  const at = src.indexOf("onSceneApply: async (field) => {");
  if (at < 0) throw new Error("maps.js has no onSceneApply: async (field) => { — renamed? update this test");
  const start = src.indexOf("{", src.indexOf("=>", at));
  let depth = 0, end = -1;
  for (let j = start; j < src.length; j++) {
    if (src[j] === "{") depth++;
    else if (src[j] === "}") { depth--; if (!depth) { end = j; break; } }
  }
  const make = new Function("ctx", "sceneColours", "isExactEntity", "floors", "byRoom", "lightsByEid", "hiddenEids",
    `return async (field) => ${src.slice(start, end + 1)};`);
  const svc = [], toasts = [];
  const ctx = { hass: { states: {}, callService: async (d, s, data) => { svc.push([d, s, data]); } },
    state: { model: {} }, toast: (m) => toasts.push(m), actions: { renderRooms() {} } };
  const cols = [{ eid: "light.far_west_seg1", rgb: [1, 2, 3] }, { eid: "light.kitchen", rgb: [4, 5, 6] }, { eid: "light.upper_north", rgb: [7, 8, 9] }];
  await make(ctx, () => cols, LM.isExactEntity, [], {}, {}, new Set())({ stops: [] });
  out.scene = { svc, toasts };
}

// ── Without the licence the list is empty: every path is HA's own again ──
{
  const hass = fakeHass(STATES, []);
  await LM.ensureExactDevices(hass, () => {}, { force: true });
  await LM.toggleEntity(hass, "light.far_west_seg1", { render: () => {}, toast: () => {} });
  await LM.setManyStates(hass, ["light.far_west", "light.kitchen"], true, {});
  out.unlicensed = { power: power(hass), svc: hass.svc, exact: LM.isExactEntity("light.far_west") };
}

// ── Without the licence: a light PadSpan ran on its own can be given back ──
{
  const all = (n, acc = []) => { for (const c of n.children || []) { acc.push(c); all(c, acc); } return acc; };
  const sent = [];
  const records = { "light.far_west": { lapsed: true, join: "padspan", exact: true, team_id: null, team_mode: null },
    "light.upper_north": { lapsed: true, join: "padspan", exact: true, team_id: "t1", team_mode: "padspan" },
    "light.kitchen": { lapsed: true, join: "wled", exact: false, team_id: null, team_mode: null } };
  const hass = { states: STATES, callService: async () => {}, callWS: async (m) => {
    sent.push(m);
    if (m.type === "padspan_ha/wled_look_get") return records[m.entity_id];
    if (m.type === "padspan_ha/wled_exact_list") return { devices: [] };
    return { join: "wled", exact: false };
  } };
  const card = async (eid, wled) => {
    LM.openControlCard(hass, eid, { toast: () => {}, rerender: () => {}, wled });
    await flush(); await flush();
    const overlay = document.body.children[document.body.children.length - 1];
    const btn = all(overlay).find(n => n.tagName === "BUTTON" && n.textContent === "Give this light back to WLED sync");
    const tabs = all(overlay).filter(n => n.tagName === "BUTTON" && (n.textContent === "Advanced")).length;
    return { overlay, btn, tabs };
  };
  const solo = await card("light.far_west", { tier: "free", isAdmin: true });
  const shown = !!solo.btn;
  if (solo.btn) { solo.btn.click(); await flush(); await flush(); }
  out.lapsed = {
    shown, advancedTabs: solo.tabs,
    switched: sent.filter(m => m.type === "padspan_ha/wled_exact_set").map(({ type, ...rest }) => rest),
    teamMember: !!(await card("light.upper_north", { tier: "free", isAdmin: true })).btn,
    plainWled: !!(await card("light.kitchen", { tier: "free", isAdmin: true })).btn,
    notAdmin: !!(await card("light.far_west", { tier: "free", isAdmin: false })).btn,
    licensed: !!(await card("light.far_west", { tier: "pro", isAdmin: true })).btn,
  };
}

console.log(JSON.stringify(out));
