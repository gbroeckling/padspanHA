// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
//
// Live Aboard's Look on this screen (views/live_aboard_looks.js) and its rooms
// by name (views/live_aboard_rooms.js), run for real inside the real 3D view
// under the DOM shim with a stub GL, on a small two-floor house:
//
//   look    Views ▾ → Look: Same as Settings, Live Aboard's own (Classic,
//           Studio), the Showcase themes dark and light with a swatch, and By
//           the sun; a pick is this screen's (prefs look_<screen>) and draws
//           that look, another screen keeps Settings'; Same as Settings
//           forgets it; Classic and Studio switch without building the house;
//           by the sun the night's look after sunset (sun.sun), nothing built
//           on a poll that changes nothing; below a Showcase tier Classic,
//           Studio and one plain line (a theme picked before is kept, not
//           drawn); Settings' own still decides with Same as Settings; a theme
//           picked ticks the screen's Theme colours back on; a wall has it too
//   chips   the map's named rooms along the top under their floors' labels,
//           top floor first (one name once, none without a name); a chip
//           shows its floor, flies to the room, tints it, opens its panel and
//           is marked; a narrow screen and a wall: one Rooms ▾, the list
//           grouped; none in Furnish; they step aside with the bars
//   panel   a tap on a room's name opens its panel in the view, not the
//           host's sheet: its devices, then More devices of the area (n);
//           every button works there, each switch said with Undo; the room
//           framed in what the panel leaves clear; ✕, Escape, Furnish and
//           leaving close it; the flight home waits while it is open
//   taps    a light's tap still switches it with Undo, a hold its controls,
//           a double-tap on a room's floor still flies in with no panel
//
// usage: live_aboard_looks_rooms.mjs <www/padspan-ha dir>
// prints one JSON line: { cases: {name: result}, failures: [...] }

import { pathToFileURL } from "node:url";
import { join } from "node:path";
import * as shim from "./dom_shim.mjs";
import { installStubGL } from "./stub_gl.mjs";

const WWW = process.argv[2];
if (!WWW) { console.error("usage: live_aboard_looks_rooms.mjs <www/padspan-ha dir>"); process.exit(2); }
shim.install();
{
  const NP = globalThis.Node.prototype, ap = NP.appendChild, ib = NP.insertBefore, rc = NP.removeChild;
  const leave = (c) => { const p = c && c.parentNode; if (p && p.children) { const i = p.children.indexOf(c); if (i >= 0) p.children.splice(i, 1); } };
  NP.appendChild = function(c){ leave(c); return ap.call(this, c); };
  NP.insertBefore = function(c, ref){ leave(c); return ib.call(this, c, ref); };
  NP.removeChild = function(c){ const r = rc.call(this, c); if (c && c.parentNode === this) c.parentNode = null; return r; };
  NP.remove = function(){ if (this.parentNode) this.parentNode.removeChild(this); };
  // Studio lays its vignette after the canvas (as tests/js/live_aboard_studio.mjs lets it).
  if (!NP.insertAdjacentElement) NP.insertAdjacentElement = function(where, el){ return this.parentNode ? this.parentNode.insertBefore(el, this.nextSibling || null) : null; };
}
{
  const NP = globalThis.Node.prototype, rect = NP.getBoundingClientRect;
  NP.getBoundingClientRect = function(){
    if (this.classList && this.classList.contains("la3d-room")) {
      return this.parentNode && this.parentNode.classList.contains("la3d-narrow") ? { x: 0, y: 330, left: 0, top: 330, right: 800, bottom: 600, width: 800, height: 270 }
        : { x: 440, y: 10, left: 440, top: 10, right: 790, bottom: 540, width: 350, height: 530 };
    }
    return rect.call(this);
  };
}
const lists = { window: {} };
globalThis.addEventListener = (t, fn) => { (lists.window[t] ||= []).push(fn); };
globalThis.removeEventListener = (t, fn) => { lists.window[t] = (lists.window[t] || []).filter(f => f !== fn); };
const fire = (type, e) => { for (const fn of [...(lists.window[type] || [])]) fn({ type, ...e }); };
installStubGL();

let clockOff = 0;
const clock0 = performance.now(), date0 = Date.now();
performance.now = () => clock0 + clockOff;
Date.now = () => date0 + clockOff;
const shimRaf = globalThis.requestAnimationFrame;
globalThis.requestAnimationFrame = (fn) => shimRaf(() => fn(performance.now()));

const url = (p) => pathToFileURL(join(WWW, p)).href;
const LA = await import(url("views/live_aboard.js"));
const LM = await import(url("views/lights_map.js"));
const LOOK = await import(url("views/live_aboard_looks.js"));
const ROOMS = await import(url("views/live_aboard_rooms.js"));
const { SHOWCASE_THEMES } = await import(url("views/iso_lights.js"));

const failures = [];
const cases = {};
const check = (name, ok, detail) => { cases[name] = !!ok; if (!ok) failures.push({ name, detail: detail === undefined ? null : detail }); };
const tryCase = async (name, fn) => {
  try { await fn(); } catch (e) { failures.push({ name, detail: String(e && e.stack || e).slice(0, 900) }); cases[name] = false; }
};
const settle = async (rounds = 14) => { await shim.flush(rounds); await new Promise(r => globalThis._realSetTimeout(r, 0)); };
async function later(ms, rounds = 8){ clockOff += ms; await settle(rounds); }
const J = JSON.stringify;

// ── the house: a kitchen and a den, a loft and a nook upstairs ──────────────
const rect = (floor_id, x0, y0, x1, y1) => ({ type: "poly", floor_id, points_m: [[x0, y0], [x1, y0], [x1, y1], [x0, y1]] });
const MODEL = {
  floors: [{ id: "main", name: "Main", level: 0 }, { id: "up", name: "Upstairs", level: 1 }],
  floor_elevations: { main: 0, up: 2.8 },
  room_geometry_m: { Kitchen: rect("main", 0, 0, 6, 4), Den: rect("main", 6.1, 0, 12, 4), Loft: rect("up", 0, 0, 5, 5), Nook: rect("up", 5.1, 0, 9, 5) },
  light_positions_m: {
    "light.kitchen": { x_m: 3, y_m: 2, floor_id: "main" },
    "light.den": { x_m: 11.5, y_m: 3.5, floor_id: "main" },
    "fan.den": { x_m: 6.6, y_m: 0.4, floor_id: "main" },
    "lock.den": { x_m: 11.9, y_m: 0.4, floor_id: "main" },
    "light.loft": { x_m: 2, y_m: 2, floor_id: "up" },
  },
};
const AREAS = { "light.kitchen": "Kitchen", "light.den": "Den", "fan.den": "Den", "lock.den": "Den", "light.loft": "Loft" };
const iso = (ms) => new Date(ms).toISOString();
const st = (state, name, more = {}) => ({ state, attributes: { friendly_name: name, ...more }, last_changed: iso(date0 - 600e3), last_updated: iso(date0 - 600e3) });
const DAY = { "sun.sun": { entity_id: "sun.sun", state: "above_horizon", attributes: { azimuth: 160, elevation: 40 } } };
const NIGHT = { "sun.sun": { entity_id: "sun.sun", state: "below_horizon", attributes: { azimuth: 300, elevation: -20 } } };
const STATES = {
  "light.kitchen": st("on", "Kitchen light", { brightness: 200 }), "light.den": st("off", "Den lamp", { supported_color_modes: ["brightness"] }), "fan.den": st("off", "Den fan"),
  "lock.den": st("locked", "Den door lock"), "light.loft": st("on", "Loft light", { brightness: 120 }),
  // What the map doesn't place, in the Den's area (and not).
  "media_player.den_tv": st("playing", "Den TV"), "cover.den_blind": st("open", "Den blind"), "scene.den_movie": st("scening", "Movie night"),
  "sensor.den_signal": st("-60", "Den TV signal", { unit_of_measurement: "dBm" }), "switch.den_hidden": st("off", "Den spare plug"),
  "media_player.kitchen_radio": st("idle", "Kitchen radio"),
};
const LBE = Object.fromEntries(LM.gatherLights(Object.fromEntries(Object.entries(STATES).map(([k, v]) => [k, { entity_id: k, ...v }])),
  AREAS, {}, "pro", {}, {}, {}, {}, date0).map(l => [l.entity_id, l]));
const ENTITIES = {
  "light.den": { entity_id: "light.den", area_id: "den" }, "fan.den": { entity_id: "fan.den", area_id: "den" }, "lock.den": { entity_id: "lock.den", area_id: "den" },
  "media_player.den_tv": { entity_id: "media_player.den_tv", area_id: null, device_id: "dev_tv" }, "cover.den_blind": { entity_id: "cover.den_blind", area_id: "den" },
  "scene.den_movie": { entity_id: "scene.den_movie", area_id: "den" },
  "sensor.den_signal": { entity_id: "sensor.den_signal", area_id: "den", entity_category: "diagnostic" },
  "switch.den_hidden": { entity_id: "switch.den_hidden", area_id: "den", hidden: true },
  "sensor.den_gone": { entity_id: "sensor.den_gone", area_id: "den" },
  "media_player.kitchen_radio": { entity_id: "media_player.kitchen_radio", area_id: "kitchen" },
};
const calls = [];
const HASS = { states: { ...STATES, ...DAY }, entities: ENTITIES, devices: { dev_tv: { id: "dev_tv", area_id: "den" } },
  areas: { den: { area_id: "den", name: "Den" }, kitchen: { area_id: "kitchen", name: "Kitchen" }, loft: { area_id: "loft", name: "Loft" } },
  callService: (d, s, data) => { calls.push(["service", d, s, data && data.entity_id]); return Promise.resolve(); }, callWS: async () => ({}) };
const api = { hass: HASS, lightsByEid: LBE, lights: Object.values(LBE), toast: (m) => calls.push(["hostToast", m]),
  toggle: (e) => { calls.push(["toggle", e]); return true; }, setMany: (eids, on) => calls.push(["setMany", [...eids].sort(), on]),
  openRoom: (r) => calls.push(["openRoom", r]), openLights: (e) => calls.push(["openLights", e]), openFloor: (z) => calls.push(["openFloor", z]),
  openControls: (e) => calls.push(["openControls", e]), openActivity: (e) => calls.push(["openActivity", e]),
  controlsFor: (l) => (l && (l.isLock || l.dimmable) ? {} : null), floodLatches: {} };
const CLASSIC = { key: "classic", theme: SHOWCASE_THEMES.classic };
const screenPrefs = (init = {}) => { const store = new Map(Object.entries(init)); return { store, get: (k) => store.get(k) ?? null, set: (k, v) => store.set(k, String(v)) }; };
const steps = (over = {}) => ({ names: ["Main", "Upstairs"], zs: ["0", "1"], at: 0, all: false, go: (i) => calls.push(["go", i]), ...over });
const P = (over = {}) => ({ model: MODEL, floors: MODEL.floors, lightsByEid: LBE, hidden: new Set(), topFloorIds: ["main"], quality: "low",
  telemetry: () => {}, onTouch: () => {}, states: { ...STATES, ...DAY }, config: {}, bearing: 0, saveNorth: async () => true, useApi: () => api,
  haStartedMs: 0, load: async () => ({ data: {} }), edit: null, mapOnly: true, prefs: screenPrefs(), showcase: CLASSIC,
  look3d: "atlas", atlasLook: { on: false, key: "classic", theme: SHOWCASE_THEMES.classic }, showcaseThemes: SHOWCASE_THEMES,
  floorSteps: steps(), classFilter: null, floodLatches: {}, codes: { showcase: false }, admin: true, goTo: () => {}, ...over });
const S = (slot) => slot._state();
const canvasOf = (slot) => slot.element.querySelector("canvas");
const ev = (type, x, y, extra = {}) => ({ type, button: 0, pointerType: "mouse", pointerId: 1, clientX: x, clientY: y, deltaMode: 0,
  stopPropagation() {}, preventDefault() {}, composedPath: () => [], timeStamp: performance.now(), ...extra });
const click = (b) => b && b.dispatchEvent({ type: "click", detail: 1, stopPropagation() {}, preventDefault() {}, composedPath: () => [b] });
async function tapAt(slot, p){
  const cv = canvasOf(slot);
  cv.dispatchEvent(ev("pointerdown", p[0], p[1], { timeStamp: performance.now() }));
  cv.dispatchEvent(ev("pointerup", p[0], p[1], { timeStamp: performance.now() + 40 }));
  await settle(4);
}
const cards = new Map();
function card(slot, key, over = {}){
  const c = document.createElement("div"), stage = document.createElement("div");
  c.appendChild(stage);
  document.body.appendChild(c);
  const p = P({ ...(cards.get(key) || {}), ...over });
  cards.set(key, { ...(cards.get(key) || {}), ...over });
  return slot.attach(stage, p);
}
async function newSlot(key, over = {}){
  cards.delete(key);
  const slot = LA.liveAboardSlot(key);
  card(slot, key, { prefs: screenPrefs({ explode: "0" }), ...over });
  await settle(30);
  return slot;
}
const btn = (slot, text, within = null) => (within || slot.element).querySelectorAll("button").find(b => b.textContent === text) || null;
const menuBtns = (slot) => { const m = slot.element.querySelector(".la3d-menu"); return m ? m.querySelectorAll("button") : []; };
const openViews = async (slot) => { click(slot.element.querySelector("[data-la3d-saved]").querySelector("button")); await settle(2); };
const openLook = async (slot) => { await openViews(slot); click(menuBtns(slot).find(b => b.textContent.startsWith("Look:"))); await settle(2); };
const pickLook = async (slot, words) => { await openLook(slot); click(menuBtns(slot).find(b => b.textContent === words)); await settle(6); };
const lookOf = (slot) => S(slot).look.key;

// ── look ────────────────────────────────────────────────────────────────────
await tryCase("look: Views ▾ has a Look line; its list is By the sun, Same as Settings, Classic and Studio, then the Showcase themes dark and light, each with a swatch", async () => {
  const slot = await newSlot("lk-list");
  await openViews(slot);
  const line = menuBtns(slot).find(b => b.textContent.startsWith("Look:"));
  click(line); await settle(2);
  const m = slot.element.querySelector(".la3d-menu");
  const heads = m.querySelectorAll(".la3d-mhead").map(h => h.textContent);
  const rows = m.querySelectorAll("button").map(b => b.textContent);
  const sw = m.querySelectorAll(".la3d-sw").length;
  const themes = Object.keys(SHOWCASE_THEMES).filter(k => k !== "classic").length;
  const ticked = m.querySelectorAll("button").filter(b => b.getAttribute("aria-checked") === "true").map(b => b.textContent);
  LA.releaseLiveAboardSlot("lk-list");
  check("look: Views ▾ has a Look line; its list is By the sun, Same as Settings, Classic and Studio, then the Showcase themes dark and light, each with a swatch",
    line && line.textContent === "Look: Same as Settings ›" && rows[0] === "By the sun: another look after sunset" && rows[1] === "Same as Settings (the Atlas's look)"
    && J(heads) === J(["Live Aboard", "Showcase themes, dark", "Showcase themes, light"]) && rows.includes("Classic") && rows.includes("Studio")
    && rows.includes("Aurora") && rows.includes("Swiss International") && !rows.includes("Classic", rows.indexOf("Classic") + 1)
    && sw === 2 + themes && rows.length === 2 + 2 + themes && J(ticked) === J(["Same as Settings (the Atlas's look)"]),
    { line: line && line.textContent, heads, rows, sw, themes, ticked });
});
await tryCase("look: a pick is this screen's own (look_<screen>) and draws that look; another screen keeps Settings'; Same as Settings forgets it", async () => {
  const a = await newSlot("lk-a"), b = await newSlot("lk-b");
  const before = { a: lookOf(a), b: lookOf(b) };
  await pickLook(a, "Aurora");
  const pa = cards.get("lk-a").prefs;
  const picked = { a: lookOf(a), b: lookOf(b), pref: pa.get("look_lk-a"), atlas: S(a).look.atlas, line: null };
  await openViews(a);
  picked.line = menuBtns(a).find(x => x.textContent.startsWith("Look:")).textContent;
  fire("keydown", { key: "Escape" }); await settle(2);
  // A poll with nothing new: still Aurora, read from the screen's own pref.
  card(a, "lk-a"); await settle(4);
  const polled = lookOf(a);
  await pickLook(a, "Same as Settings (the Atlas's look)");
  const back = { a: lookOf(a), pref: pa.get("look_lk-a") };
  LA.releaseLiveAboardSlot("lk-a"); LA.releaseLiveAboardSlot("lk-b");
  check("look: a pick is this screen's own (look_<screen>) and draws that look; another screen keeps Settings'; Same as Settings forgets it",
    before.a === "atlas:plain:classic" && before.b === "atlas:plain:classic"
    && picked.a === "atlas:aurora" && picked.b === "atlas:plain:classic" && picked.pref === J({ day: "theme:aurora" })
    && picked.atlas && picked.atlas.on && picked.atlas.theme === "aurora" && picked.line === "Look: Aurora ›" && polled === "atlas:aurora"
    && back.a === "atlas:plain:classic" && back.pref === "", { before, picked, polled, back });
});
await tryCase("look: Classic and Studio switch without building the house again; a theme builds it once; at rest no frame", async () => {
  const slot = await newSlot("lk-work");
  await pickLook(slot, "Classic");
  const w0 = S(slot).work.shells;
  await pickLook(slot, "Studio");
  const studio = { key: lookOf(slot), shells: S(slot).work.shells, on: !!S(slot).studio, pad: S(slot).studio && S(slot).studio.pad };
  await pickLook(slot, "Classic");
  const classic = { key: lookOf(slot), shells: S(slot).work.shells, on: !!S(slot).studio };
  await pickLook(slot, "Neo HUD");
  const hud = { key: lookOf(slot), shells: S(slot).work.shells };
  card(slot, "lk-work"); card(slot, "lk-work"); await settle(30);
  const polls = S(slot).work.shells, f0 = S(slot).frames;
  await settle(30);
  const rest = S(slot).frames - f0;
  LA.releaseLiveAboardSlot("lk-work");
  check("look: Classic and Studio switch without building the house again; a theme builds it once; at rest no frame",
    studio.key === "studio" && studio.on && studio.pad && studio.shells === w0
    && classic.key === "classic" && !classic.on && classic.shells === w0
    && hud.key === "atlas:neo_hud" && hud.shells === w0 + 1 && polls === hud.shells && rest === 0,
    { w0, studio, classic, hud, polls, rest });
});
await tryCase("look: by the sun, the day's look by day and the night's after sunset (sun.sun), switched as the card comes in, built once each way", async () => {
  const slot = await newSlot("lk-sun");
  await openLook(slot);
  click(slot.element.querySelector("[data-la3d-bysun]")); await settle(4);
  // The list opens again on After sunset, its tabs on top.
  const segOf = () => { const g = slot.element.querySelector(".la3d-mseg"); return g ? g.querySelectorAll("button") : []; };
  const tabs = segOf().map(b => [b.textContent, b.getAttribute("aria-pressed")]);
  click(menuBtns(slot).find(b => b.textContent === "Aurora")); await settle(6);
  await openLook(slot);
  click(segOf().find(b => b.textContent === "By day")); await settle(2);
  click(menuBtns(slot).find(b => b.textContent === "Studio")); await settle(6);
  const pref = cards.get("lk-sun").prefs.get("look_lk-sun");
  const day = { key: lookOf(slot), shells: S(slot).work.shells };
  card(slot, "lk-sun", { states: { ...STATES, ...NIGHT } }); await settle(6);
  const night = { key: lookOf(slot), shells: S(slot).work.shells, now: S(slot).look.pick.now };
  card(slot, "lk-sun", { states: { ...STATES, ...DAY } }); await settle(6);
  const again = { key: lookOf(slot), shells: S(slot).work.shells };
  card(slot, "lk-sun"); await settle(6);
  const still = S(slot).work.shells;
  // No sun.sun: the view's own sun (hass.config, else its default by day).
  const noSun = LOOK.afterSunset({}, () => -5) && !LOOK.afterSunset({}, () => 3) && !LOOK.afterSunset({}, () => NaN);
  await openViews(slot);
  const line = menuBtns(slot).find(b => b.textContent.startsWith("Look:")).textContent;
  fire("keydown", { key: "Escape" }); await settle(2);
  LA.releaseLiveAboardSlot("lk-sun");
  check("look: by the sun, the day's look by day and the night's after sunset (sun.sun), switched as the card comes in, built once each way",
    J(tabs) === J([["By day", "false"], ["After sunset", "true"]]) && pref === J({ day: "studio", night: "theme:aurora" })
    && day.key === "studio" && night.key === "atlas:aurora" && night.now === "theme:aurora" && night.shells === day.shells + 1
    && again.key === "studio" && again.shells === night.shells + 1 && still === again.shells && noSun
    && line === "Look: Studio, Aurora after sunset ›", { tabs, pref, day, night, again, still, noSun, line });
});
await tryCase("look: below a Showcase tier, Classic, Studio and one plain line; a theme picked before is kept and not drawn", async () => {
  const prefs = screenPrefs({ explode: "0", "look_lk-free": J({ day: "theme:aurora" }) });
  const slot = await newSlot("lk-free", { prefs, showcaseThemes: null });
  const key = lookOf(slot);
  await openLook(slot);
  const m = slot.element.querySelector(".la3d-menu");
  const rows = m.querySelectorAll("button").map(b => b.textContent), note = m.querySelectorAll(".la3d-mnote").map(n => n.textContent);
  const heads = m.querySelectorAll(".la3d-mhead").map(h => h.textContent);
  fire("keydown", { key: "Escape" }); await settle(2);
  // The key back: the theme the screen picked shows again.
  card(slot, "lk-free", { showcaseThemes: SHOWCASE_THEMES }); await settle(6);
  const back = lookOf(slot);
  LA.releaseLiveAboardSlot("lk-free");
  check("look: below a Showcase tier, Classic, Studio and one plain line; a theme picked before is kept and not drawn",
    key === "atlas:plain:classic" && J(heads) === J(["Live Aboard"]) && rows.includes("Classic") && rows.includes("Studio") && !rows.includes("Aurora")
    && J(note) === J(["Showcase themes come with PadSpan Bright Pro or PadSpan Pro."]) && prefs.get("look_lk-free") === J({ day: "theme:aurora" })
    && back === "atlas:aurora", { key, rows, note, heads, back });
});
await tryCase("look: Same as Settings follows Settings (the Atlas's look, Live Aboard's own, Studio) and the Atlas's Showcase theme; a pick sits over it", async () => {
  const slot = await newSlot("lk-set", { look3d: "studio" });
  const studio = lookOf(slot);
  card(slot, "lk-set", { look3d: "own" }); await settle(6);
  const own = lookOf(slot);
  card(slot, "lk-set", { look3d: "atlas", atlasLook: { on: true, key: "hygge", theme: SHOWCASE_THEMES.hygge } }); await settle(6);
  const atlas = lookOf(slot);
  await openLook(slot);
  const same = menuBtns(slot).find(b => b.getAttribute("data-la3d-look-settings") !== null);
  const words = same && same.textContent;
  fire("keydown", { key: "Escape" }); await settle(2);
  await pickLook(slot, "Classic");
  const over = lookOf(slot);
  LA.releaseLiveAboardSlot("lk-set");
  check("look: Same as Settings follows Settings (the Atlas's look, Live Aboard's own, Studio) and the Atlas's Showcase theme; a pick sits over it",
    studio === "studio" && own === "classic" && atlas === "atlas:hygge" && words === "Same as Settings (the Atlas's look, Hygge Warmth)" && over === "classic",
    { studio, own, atlas, words, over });
});
await tryCase("look: a theme picked ticks this screen's Theme colours (⋯) back on; a wall has the Look too", async () => {
  const prefs = screenPrefs({ explode: "0", "show_lk-theme": J({ theme: false }) });
  const slot = await newSlot("lk-theme", { prefs });
  const off = lookOf(slot);
  await pickLook(slot, "Obsidian Noir");
  const on = { key: lookOf(slot), show: prefs.get("show_lk-theme") };
  const wall = await newSlot("lk-wall", { kiosk: true });
  await openViews(wall);
  const wallLine = menuBtns(wall).some(b => b.textContent.startsWith("Look:"));
  fire("keydown", { key: "Escape" }); await settle(2);
  LA.releaseLiveAboardSlot("lk-theme"); LA.releaseLiveAboardSlot("lk-wall");
  check("look: a theme picked ticks this screen's Theme colours (⋯) back on; a wall has the Look too",
    off === "classic" && on.key === "atlas:obsidian_noir" && !("theme" in JSON.parse(on.show)) && wallLine, { off, on, wallLine });
});

// ── chips ───────────────────────────────────────────────────────────────────
await tryCase("chips: the map's named rooms along the top under their floors' labels, top floor first; one name once, none without a name", async () => {
  const pure = ROOMS.roomChipGroups([
    { id: "main", name: "Main", elev: 0, rooms: [{ name: "Kitchen" }, { name: "" }, { name: "Den" }, { name: "kitchen" }] },
    { id: "main~0.5", name: "Main", elev: 0.5, parent: "main", rooms: [{ name: "Study" }] },
    { id: "up", name: "Upstairs", elev: 2.8, rooms: [{ name: "Loft" }, { name: "  " }] },
    { id: "__outside__", name: "Outside", elev: 0, outdoor: true, rooms: [{ name: "Shed" }] },
    { id: "empty", name: "Attic", elev: 6, rooms: [{ name: "" }] }]);
  const slot = await newSlot("ch-row");
  const st = S(slot).rooms.chips, row = slot.element.querySelector("[data-la3d-rchips]"), roomrow = slot.element.classList.contains("la3d-roomrow");
  LA.releaseLiveAboardSlot("ch-row");
  check("chips: the map's named rooms along the top under their floors' labels, top floor first; one name once, none without a name",
    J(pure.map(g => [g.words, g.rooms.map(c => c.name)])) === J([["Upstairs", ["Loft"]], ["Main", ["Den", "Kitchen", "Study"]], ["Outside", ["Shed"]]])
    && pure[1].rooms.find(c => c.name === "Study").fid === "main~0.5" && pure[1].rooms.find(c => c.name === "Study").top === "main"
    && st.shown && !st.compact && J(st.floors) === J(["Upstairs", "Main"]) && J(st.chips) === J(["up|Loft", "up|Nook", "main|Den", "main|Kitchen"])
    && row && row.getAttribute("role") === "toolbar" && roomrow,
    { pure, st });
});
await tryCase("chips: a chip shows its room's floor, flies to the room, tints it, opens its panel and is marked", async () => {
  let slot = null;
  slot = await newSlot("ch-go", { setTopFloor: (fid) => { calls.push(["top", fid]); if (slot) card(slot, "ch-go", { topFloorIds: [fid], floorSteps: steps({ at: fid === "up" ? 1 : 0 }) }); } });
  calls.length = 0;
  const r0 = S(slot).cam.radius;
  click(slot.element.querySelector('[data-la3d-rchip="up|Loft"]'));
  await settle(6);
  const flying = S(slot).screen.flying;
  await later(900, 30);
  const s = S(slot), loft = MODEL.room_geometry_m.Loft.points_m;
  const tile = s.levels.roomTile;
  const t = [0x52 / 255, 0xb7 / 255, 0x88 / 255].map(v => (v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)));
  const dist = (c) => Math.hypot(c[0] - t[0], c[1] - t[1], c[2] - t[2]);
  // A chip on the floor already showing: no floor change, the same flight.
  calls.length = 0;
  click(slot.element.querySelector('[data-la3d-rchip="up|Nook"]'));
  await later(900, 30);
  const nook = { calls: calls.slice(), room: S(slot).levels.room, panel: S(slot).rooms.panel.room, pressed: S(slot).rooms.chips.pressed };
  LA.releaseLiveAboardSlot("ch-go");
  check("chips: a chip shows its room's floor, flies to the room, tints it, opens its panel and is marked",
    flying && s.levels.level === "room" && s.levels.room && s.levels.room.name === "Loft" && s.levels.room.floor === "up"
    && s.rooms.panel.open && s.rooms.panel.room === "Loft" && J(s.rooms.chips.pressed) === J(["up|Loft"]) && s.cam.radius < r0
    && s.cam.target[0] > -1 && s.cam.target[0] < 7 && tile && dist(tile.now) < dist(tile.was)
    && s.levels.faded.some(v => Number.isInteger(v) && v >= 0) && !s.rooms.go
    && nook.calls.every(c => c[0] !== "top") && nook.room && nook.room.name === "Nook" && nook.panel === "Nook" && J(nook.pressed) === J(["up|Nook"]),
    { level: s.levels, panel: s.rooms.panel, chips: s.rooms.chips, cam: s.cam, r0, loft, tile, nook, flying });
});
await tryCase("chips: a narrow screen and a wall have one Rooms ▾ with the same list, grouped; Furnish has none; they step aside with the bars", async () => {
  const slot = await newSlot("ch-narrow");
  slot.element.clientWidth = 390;
  card(slot, "ch-narrow"); await settle(6);
  const narrow = S(slot).rooms.chips;
  const b = slot.element.querySelector("[data-la3d-rooms]");
  click(b); await settle(2);
  const m = slot.element.querySelector(".la3d-menu");
  const list = m ? m.children.map(n => (n.className === "la3d-mhead" ? `# ${n.textContent}` : n.textContent)) : [];
  click(menuBtns(slot).find(x => x.textContent === "Kitchen")); await later(900, 30);
  const went = { room: S(slot).levels.room, panel: S(slot).rooms.panel.room };
  LA.releaseLiveAboardSlot("ch-narrow");
  const wall = await newSlot("ch-wall", { kiosk: true });
  const onWall = S(wall).rooms.chips;
  card(wall, "ch-wall", { furnish: { callWS: null, toast: null, settings: {}, entities: null } }); await settle(6);
  const furnish = S(wall).rooms.chips;
  LA.releaseLiveAboardSlot("ch-wall");
  // The map alone: the row steps aside with the bars (the view's la3d-bare), as the bar does.
  const css = (wall.element.querySelector("style[data-la3d-rooms-css]") || { textContent: "" }).textContent;
  check("chips: a narrow screen and a wall have one Rooms ▾ with the same list, grouped; Furnish has none; they step aside with the bars",
    narrow.shown && narrow.compact && J(narrow.chips) === "[]" && b && b.textContent === "Rooms ▾"
    && J(list) === J(["# Upstairs", "Loft", "Nook", "# Main", "Den", "Kitchen"])
    && went.room && went.room.name === "Kitchen" && went.panel === "Kitchen"
    && onWall.shown && onWall.compact && !furnish.shown
    && css.includes(".la3d.la3d-bare .la3d-rchips{opacity:0;visibility:hidden;pointer-events:none}"),
    { narrow, list, went, onWall, furnish });
});

// ── panel ───────────────────────────────────────────────────────────────────
const panelEl = (slot) => slot.element.querySelector(".la3d-room");
const inPanel = (slot, text) => { const el = panelEl(slot); return el ? el.querySelectorAll("button").filter(b => b.textContent === text) : []; };
const rowBtn = (slot, name, text) => inPanel(slot, text).find(b => b.parentNode && b.parentNode.textContent.includes(name)) || null;
const toastNow = (slot) => { const t = slot.element.querySelector(".la3d-toast"); return t ? t.textContent : null; };
const undo = (slot) => { const t = slot.element.querySelector(".la3d-toast"); return t ? t.querySelectorAll("button").find(b => b.textContent === "Undo") : null; };
async function tapName(slot, room){
  const at = slot._where({ room });
  const pick = at ? slot._pick(at[0], at[1]) : null;
  if (at) await tapAt(slot, at);
  await later(900, 30);
  return pick;
}
await tryCase("panel: a tap on a room's name opens its panel in the view, not the host's sheet: its devices, then More devices of the area (n) from Home Assistant", async () => {
  const slot = await newSlot("pn-open");
  calls.length = 0;
  const pick = await tapName(slot, "Den");
  const p = S(slot).rooms.panel, text = p.text;
  const moreEl = panelEl(slot) ? panelEl(slot).querySelector(".la3d-rmore") : null;
  const mb = moreEl ? moreEl.querySelectorAll("button")[0] : null;
  const label = mb && mb.textContent;
  click(mb); await settle(2);
  const rows = S(slot).rooms.panel.rows;
  const asked = [];
  slot.element.addEventListener("hass-more-info", (e) => asked.push(e.detail.entityId));
  click(panelEl(slot).querySelectorAll("button").find(b => b.getAttribute("data-la3d-more-eid") === "media_player.den_tv")); await settle(2);
  const pure = ROOMS.areaExtras(HASS, "Den", ["light.den", "fan.den", "lock.den"]).map(d => [d.eid, d.state]);
  LA.releaseLiveAboardSlot("pn-open");
  check("panel: a tap on a room's name opens its panel in the view, not the host's sheet: its devices, then More devices of the area (n) from Home Assistant",
    pick && pick.hit === "room:Den" && !calls.some(c => c[0] === "openRoom") && p.open && p.room === "Den"
    && text.includes("Den lamp") && text.includes("Den fan") && text.includes("Den door lock") && !text.includes("Kitchen light")
    && p.more === 2 && label === "▸ More devices of the area (2)" && J(rows) === J(["cover.den_blind", "media_player.den_tv"])
    && J(asked) === J(["media_player.den_tv"]) && J(pure) === J([["cover.den_blind", "open"], ["media_player.den_tv", "playing"]]),
    { pick, p, label, rows, asked, pure, calls: calls.slice() });
});
await tryCase("panel: every button of the room sheet works there; each switch is said with Undo and Undo puts it back; a lock's never", async () => {
  const slot = await newSlot("pn-act");
  await tapName(slot, "Den");
  const out = {};
  calls.length = 0;
  click(inPanel(slot, "All lights on")[0]); await settle(4);
  out.allOn = { calls: calls.slice(), toast: toastNow(slot), open: S(slot).rooms.panel.open };
  calls.length = 0; click(undo(slot)); await settle(4);
  out.allOnUndo = calls.slice();
  calls.length = 0; click(inPanel(slot, "Fans on")[0]); await settle(4);
  out.fans = { calls: calls.slice(), toast: toastNow(slot) };
  calls.length = 0; click(rowBtn(slot, "Den fan", "Off")); await settle(6);
  out.fan = { calls: calls.slice(), toast: toastNow(slot) };
  calls.length = 0; click(undo(slot)); await settle(4);
  out.fanUndo = calls.slice();
  calls.length = 0; click(rowBtn(slot, "Den door lock", "Unlock")); await settle(6);
  out.lock = { calls: calls.slice(), toast: toastNow(slot) };
  calls.length = 0; click(inPanel(slot, "▶ Movie night")[0]); await settle(6);
  out.scene = calls.slice();
  calls.length = 0; click(rowBtn(slot, "Den lamp", "⋯")); await settle(2);
  out.controls = { calls: calls.slice(), open: S(slot).rooms.panel.open };
  LA.releaseLiveAboardSlot("pn-act");
  check("panel: every button of the room sheet works there; each switch is said with Undo and Undo puts it back; a lock's never",
    J(out.allOn.calls) === J([["setMany", ["light.den"], true]]) && out.allOn.toast === "Den: 1 light onUndo" && out.allOn.open
    && J(out.allOnUndo) === J([["setMany", ["light.den"], false]])
    && J(out.fans.calls) === J([["setMany", ["fan.den"], true]]) && out.fans.toast === "Den: 1 fan onUndo"
    && J(out.fan.calls) === J([["toggle", "fan.den"]]) && out.fan.toast === "Den fan onUndo" && J(out.fanUndo) === J([["toggle", "fan.den"]])
    && J(out.lock.calls) === J([["toggle", "lock.den"]]) && out.lock.toast === null
    && J(out.scene) === J([["service", "scene", "turn_on", "scene.den_movie"], ["hostToast", "Movie night"]])
    && J(out.controls.calls) === J([["openControls", "light.den"]]) && out.controls.open, out);
});
await tryCase("panel: the room is framed in what the panel leaves clear: left of it, or above the bottom sheet on a narrow screen", async () => {
  const slot = await newSlot("pn-frame");
  await tapName(slot, "Den");
  const wide = slot._where({ room: "Den" });
  LA.releaseLiveAboardSlot("pn-frame");
  const nar = await newSlot("pn-frame-n");
  nar.element.clientWidth = 390;
  card(nar, "pn-frame-n"); await settle(6);
  await tapName(nar, "Den");
  const narrow = { at: nar._where({ room: "Den" }), narrow: S(nar).screen.narrow, open: S(nar).rooms.panel.open };
  LA.releaseLiveAboardSlot("pn-frame-n");
  check("panel: the room is framed in what the panel leaves clear: left of it, or above the bottom sheet on a narrow screen",
    wide && wide[0] > 40 && wide[0] < 400 && narrow.narrow && narrow.open && narrow.at && narrow.at[1] > 20 && narrow.at[1] < 300,
    { wide, narrow });
});
await tryCase("panel: ✕ and Escape close it; Furnish, leaving the view and its floor hidden close it; the flight home waits while it is open", async () => {
  const out = {};
  let slot = null;                                       // the home view may pick its floor while the view is made
  slot = await newSlot("pn-close", { settings3d: { atlas_3d_home_idle_s: 60 },
    setTopFloor: (fid) => { if (slot) card(slot, "pn-close", { topFloorIds: [fid], floorSteps: steps({ at: fid === "up" ? 1 : 0 }) }); } });
  await tapName(slot, "Den");
  click(inPanel(slot, "✕")[0]); await settle(2);
  out.x = { open: S(slot).rooms.panel.open, el: !!panelEl(slot), room: S(slot).levels.room && S(slot).levels.room.name };
  await tapName(slot, "Den");
  fire("keydown", { key: "Escape" }); await settle(2);
  out.esc = S(slot).rooms.panel.open;
  await tapName(slot, "Den");
  card(slot, "pn-close", { furnish: { callWS: null, toast: null, settings: {}, entities: null } }); await settle(6);
  out.furnish = S(slot).rooms.panel.open;
  card(slot, "pn-close", { furnish: null }); await settle(6);
  // The Loft's panel (a chip), then the main floor chosen: the Loft hides, its panel goes.
  click(slot.element.querySelector('[data-la3d-rchip="up|Loft"]')); await later(900, 30);
  out.loft = S(slot).rooms.panel.room;
  card(slot, "pn-close", { topFloorIds: ["main"], floorSteps: steps({ at: 0 }) }); await settle(6);
  out.hidden = S(slot).rooms.panel.open;
  await tapName(slot, "Den");
  slot.detach(); await settle(2);
  out.detach = { open: S(slot).rooms.panel.open, el: !!panelEl(slot) };
  card(slot, "pn-close"); await settle(10);
  // The flight home waits while it is open, and goes once it is closed.
  const cv = canvasOf(slot);
  cv.dispatchEvent(ev("wheel", 400, 300, { deltaY: -160 })); await settle(4);
  await tapName(slot, "Den");
  const r0 = S(slot).panel.returns;
  await later(70000);
  out.held = S(slot).panel.returns === r0 && S(slot).rooms.panel.open;
  click(inPanel(slot, "✕")[0]); await settle(2);
  await later(11000, 20); await later(1000, 60);
  out.went = S(slot).panel.returns === r0 + 1;
  LA.releaseLiveAboardSlot("pn-close");
  check("panel: ✕ and Escape close it; Furnish, leaving the view and its floor hidden close it; the flight home waits while it is open",
    !out.x.open && !out.x.el && out.x.room === "Den" && !out.esc && !out.furnish && out.loft === "Loft" && !out.hidden
    && !out.detach.open && !out.detach.el && out.held && out.went, out);
});

// ── taps ────────────────────────────────────────────────────────────────────
await tryCase("taps: a light's tap still switches it with Undo, a hold opens its controls, a double-tap on a room's floor flies in with no panel", async () => {
  const slot = await newSlot("tp-same");
  const out = {};
  calls.length = 0;
  await tapAt(slot, slot._where({ eid: "light.kitchen" }));
  out.tap = { calls: calls.slice(), toast: toastNow(slot) };
  calls.length = 0; click(undo(slot)); await settle(4);
  out.undo = calls.slice();
  calls.length = 0;
  const at = slot._where({ eid: "light.kitchen" }), cv = canvasOf(slot);
  cv.dispatchEvent(ev("pointerdown", at[0], at[1], { timeStamp: performance.now() }));
  await later(800, 6);
  cv.dispatchEvent(ev("pointerup", at[0], at[1], { timeStamp: performance.now() }));
  await settle(4);
  out.hold = calls.slice();
  await later(1000);
  const spot = slot._whereOf("main", 9, 3.7, 0), pick = slot._pick(spot[0], spot[1]);
  calls.length = 0;
  await tapAt(slot, spot); await tapAt(slot, spot);
  await later(900, 30);
  out.dbl = { pick, room: S(slot).levels.room, panel: S(slot).rooms.panel.open, calls: calls.slice() };
  LA.releaseLiveAboardSlot("tp-same");
  check("taps: a light's tap still switches it with Undo, a hold opens its controls, a double-tap on a room's floor flies in with no panel",
    J(out.tap.calls) === J([["toggle", "light.kitchen"]]) && out.tap.toast === "Kitchen light offUndo" && J(out.undo) === J([["toggle", "light.kitchen"]])
    && J(out.hold) === J([["openControls", "light.kitchen"]])
    && !out.dbl.pick && out.dbl.room && out.dbl.room.name === "Den" && !out.dbl.panel && !out.dbl.calls.length, out);
});

process.stdout.write(J({ cases, failures }) + "\n", () => process.exit(failures.length ? 1 : 0));
