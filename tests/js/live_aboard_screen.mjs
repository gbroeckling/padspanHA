// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
//
// Live Aboard as a screen (views/live_aboard.js), run for real under the DOM
// shim with a stub GL (tests/js/stub_gl.mjs):
//
//   maponly   on the sidebar (mapOnly), zooming in past the whole-house fit
//             (the wheel, a pinch) hides every bar and the view covers the
//             panel; the poll's new card leaves it there; ☰, Escape or
//             zooming back out to the fit brings the bars back; Mapping, and
//             Furnish, never hide them; switched off while covering, nothing
//             is kept
//   full      full screen takes the panel's own element (its bars stay until
//             zoomed in); leaving it (Escape) puts everything back; a screen
//             that may not, or a refusal, gets the map alone in the panel
//   floors    the floor stepper (▲ Main ▼ · All) drives the host's floor
//             chips a floor at a time; a tap on the name opens the floor's
//             sheet as the Atlas's badge did; the floating badges are gone
//   fly       a double-tap on a room's floor flies the camera in to frame it
//             (and, zoomed in, the map alone); a tap on a light never does
//   views     Whole house, and views saved from the camera through the
//             host's per-browser store, flown back to; forgotten with ×
//   night     at night the floors keep their colour, the outlines and wall
//             tops show, the grid fades, and a fixture that is off darkens
//             with the house
//   names     room names upright, over the fixtures, never under a floor
//             showing above, hidden when their room is too small on screen,
//             a size you can read; readouts one chip per room, a dash when
//             stale, named outside every room
//   phone     narrow, one compact row; held upright it opens at room scale
//             with the long side of the house up the screen
//   hint      a first-time card, once per browser
//
// usage: live_aboard_screen.mjs <www/padspan-ha dir>
// prints one JSON line: { cases: {name: result}, failures: [...] }

import { pathToFileURL } from "node:url";
import { join } from "node:path";
import * as shim from "./dom_shim.mjs";
import { installStubGL } from "./stub_gl.mjs";

const WWW = process.argv[2];
if (!WWW) { console.error("usage: live_aboard_screen.mjs <www/padspan-ha dir>"); process.exit(2); }
shim.install();
// The shim's tree, with the real DOM's moves: a node appended or inserted
// leaves its old parent, and one removed has none.
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
const fire = (key, type, e) => { for (const fn of [...(lists[key][type] || [])]) fn({ type, ...e }); };
const listenerCount = (key) => Object.values(lists[key]).reduce((a, l) => a + l.length, 0);
installStubGL();
// Text measured about as a browser would (the shim's is always 10 px wide),
// so a name too wide for its room is seen to be.
{
  const NP = globalThis.Node.prototype, gc = NP.getContext;
  NP.getContext = function(kind, ...a){
    const base = gc.call(this, kind, ...a);
    if (kind !== "2d") return base;
    let font = "10px sans-serif";
    const measureText = (t) => { const m = /(\d+(?:\.\d+)?)px/.exec(font); return { width: String(t).length * (m ? Number(m[1]) : 10) * 0.55 }; };
    return new Proxy({}, { get: (_o, k) => (k === "font" ? font : k === "measureText" ? measureText : base[k]),
                           set: (_o, k, v) => { if (k === "font") font = String(v); return true; } });
  };
}
let clockOff = 0;
const realNow = performance.now.bind(performance);
performance.now = () => realNow() + clockOff;
const shimRaf = globalThis.requestAnimationFrame;
globalThis.requestAnimationFrame = (fn) => shimRaf(() => fn(performance.now()));

const LA = await import(pathToFileURL(join(WWW, "views", "live_aboard.js")).href);

const failures = [];
const cases = {};
const check = (name, ok, detail) => { cases[name] = !!ok; if (!ok) failures.push({ name, detail: detail === undefined ? null : detail }); };
const tryCase = async (name, fn) => {
  try { await fn(); } catch (e) { failures.push({ name, detail: String(e && e.stack || e).slice(0, 900) }); cases[name] = false; }
};
const settle = async (rounds = 14) => { await shim.flush(rounds); await new Promise(r => globalThis._realSetTimeout(r, 0)); };

// ── the house: a basement under two rooms, a closet, an outdoor sensor ──────
const rect = (floor_id, x0, y0, x1, y1) => ({ type: "poly", floor_id, points_m: [[x0, y0], [x1, y0], [x1, y1], [x0, y1]] });
const MODEL = {
  floors: [{ id: "basement", name: "Basement" }, { id: "main", name: "Main" }],
  room_geometry_m: { Rec: rect("basement", 0, 0, 6, 5), "Living room": rect("main", 0, 0, 4.5, 5), Den: rect("main", 4.6, 0, 9, 5),
                     Closet: rect("main", 9.1, 0, 9.3, 0.2) },
  rf_barriers_m: [],
  light_positions_m: { "light.den": { x_m: 6, y_m: 1, floor_id: "main" }, "light.hall": { x_m: 2, y_m: 1, floor_id: "main" },
                       "sensor.den_temp": { x_m: 6, y_m: 4, floor_id: "main" }, "sensor.den_humidity": { x_m: 6.2, y_m: 4, floor_id: "main" },
                       "sensor.rec_temp": { x_m: 3, y_m: 3, floor_id: "basement" },
                       "sensor.deck_temperature": { x_m: 14, y_m: 3, floor_id: "main" } },
};
const ago = (ms) => new Date(Date.now() - ms).toISOString();
const LBE = {
  "light.den": { entity_id: "light.den", friendly_name: "Den light", state: "on", brightness: 200, shape: "pendant" },
  "light.hall": { entity_id: "light.hall", friendly_name: "Hall light", state: "off", shape: "pot" },
  "sensor.den_temp": { entity_id: "sensor.den_temp", code: "T1", friendly_name: "Den temperature", isTemp: true, state: "21.5", temperature: 21.5,
                       device_class: "temperature", unit_of_measurement: "°C", last_changed: ago(60e3) },
  "sensor.den_humidity": { entity_id: "sensor.den_humidity", code: "H1", friendly_name: "Den humidity", isHumidity: true, state: "45", humidity: 45,
                           device_class: "humidity", unit_of_measurement: "%", last_changed: ago(60e3) },
  "sensor.rec_temp": { entity_id: "sensor.rec_temp", code: "T2", friendly_name: "Rec temperature", isTemp: true, state: "18", temperature: 18,
                       device_class: "temperature", unit_of_measurement: "°C", last_changed: ago(3 * 3600e3) },
  "sensor.deck_temperature": { entity_id: "sensor.deck_temperature", code: "T3", friendly_name: "Deck temperature", isTemp: true, state: "9",
                               temperature: 9, device_class: "temperature", unit_of_measurement: "°C", last_changed: ago(60e3) },
};
const calls = [];
const api = { toast(){}, toggle: (e) => calls.push(["toggle", e]), openRoom: (r) => calls.push(["openRoom", r]), openFloor: (z) => calls.push(["openFloor", z]),
              openControls(){}, openActivity(){}, controlsFor: () => null, lightsByEid: LBE, hass: null };
const NIGHT = { "sun.sun": { entity_id: "sun.sun", state: "below_horizon", attributes: { azimuth: 300, elevation: -12 } } };
const DAY = { "sun.sun": { entity_id: "sun.sun", state: "above_horizon", attributes: { azimuth: 160, elevation: 40 } } };
const store = new Map();
const prefs = { get: (k) => store.get(k) ?? null, set: (k, v) => store.set(k, String(v)) };
const steps = (over = {}) => ({ names: ["Basement", "Main"], zs: ["0", "1"], at: 1, all: true, go: (i) => calls.push(["go", i]), ...over });
const P = (over = {}) => ({ model: MODEL, floors: MODEL.floors, lightsByEid: LBE, hidden: new Set(), topFloorIds: null, quality: "low",
  telemetry: () => {}, onTouch: () => {}, states: NIGHT, config: {}, bearing: 0, saveNorth: async () => true, useApi: () => api,
  haStartedMs: 0, load: async () => ({ data: {} }), edit: null, mapOnly: true, floorSteps: steps(), prefs, ...over });
/** A fresh card, as the Atlas builds one every 5 s, inside the panel's
 *  stand-in shadow root (its host is the panel's element). */
const host = document.createElement("padspan-lights-app");
const shadow = document.createElement("#shadow-root");
shadow.host = host;
document.body.appendChild(host);
host.appendChild(shadow);
function card(slot, over){
  const c = document.createElement("div"), stage = document.createElement("div");
  c.appendChild(stage);
  const content = shadow.children.find(n => n.className === "content") || shadow.appendChild(Object.assign(document.createElement("div"), { className: "content" }));
  content.replaceChildren(c);
  const ok = slot.attach(stage, P(over));
  return { ok, stage, c };
}
function rooted(slot){ const el = slot.element; if (el && !el.getRootNode) el.getRootNode = () => (inTree(el, shadow) ? shadow : el); return el; }
function inTree(n, top){ for (let x = n; x; x = x.parentNode) if (x === top) return true; return false; }
const S = (slot) => slot._state();
const canvasOf = (slot) => slot.element.querySelector("canvas");
const ev = (type, x, y, extra = {}) => ({ type, button: 0, pointerType: "mouse", pointerId: 1, clientX: x, clientY: y, deltaMode: 0,
  stopPropagation() {}, preventDefault() {}, composedPath: () => [], ...extra });
async function wheel(slot, n, x = 400, y = 300){
  const cv = canvasOf(slot);
  for (let i = 0; i < Math.abs(n); i++) cv.dispatchEvent(ev("wheel", x, y, { deltaY: n > 0 ? -160 : 160 }));
  await settle();
}
async function tapAt(slot, x, y, id = 1){
  const cv = canvasOf(slot);
  cv.dispatchEvent(ev("pointerdown", x, y, { pointerId: id }));
  cv.dispatchEvent(ev("pointerup", x, y, { pointerId: id }));
  await settle(2);
}
const btnByText = (slot, t) => slot.element.querySelectorAll("button").find(b => b.textContent === t) || null;
const click = (b) => b.dispatchEvent({ type: "click", detail: 1, stopPropagation() {}, preventDefault() {} });
async function newSlot(key, over){
  const slot = LA.liveAboardSlot(key);
  card(slot, over);
  rooted(slot);
  const first = card(slot, over);                       // now in the panel's tree: full screen can be offered
  await settle(30);
  return { slot, first };
}

// ── map only ────────────────────────────────────────────────────────────────
await tryCase("maponly: zoomed in past the fit, the bars step aside and the view covers the panel", async () => {
  const { slot } = await newSlot("scr-solo");
  const fitR = S(slot).screen.fitR;
  const before = { ...S(slot).screen };
  await wheel(slot, 3);
  const st = S(slot).screen, el = slot.element;
  const r = S(slot).cam.radius;
  check("maponly: zoomed in past the fit, the bars step aside and the view covers the panel",
    fitR > 0 && !before.bare && !before.cover && r < fitR * 0.8 && st.bare && st.cover
    && el.classList.contains("la3d-bare") && el.style.position === "fixed" && el.parentNode === shadow
    && Number(el.style.zIndex) >= 40, { fitR, r, before, st, pos: el.style.position });
  // The poll's next card: the view stays over the panel, the new stage hidden.
  const next = card(slot);
  check("maponly: the poll's new card leaves the map alone where it is",
    next.ok && slot.element.parentNode === shadow && next.stage.style.display === "none" && S(slot).screen.bare, null);
  // ☰ brings the bars back; the same zoom does not hide them again at once.
  click(slot.element.querySelector(".la3d-solo"));
  const back = { ...S(slot).screen, parentIsCard: slot.element.parentNode === next.c, pos: slot.element.style.position };
  await wheel(slot, -1);
  await wheel(slot, 1);
  const stillBack = S(slot).screen.bare;
  await wheel(slot, 3);
  const deeper = S(slot).screen.bare;
  // Back out to the fit: the bars return by themselves.
  await wheel(slot, -12);
  const out = S(slot).screen;
  check("maponly: ☰ brings the bars back, zooming further in hides them again, zooming out to the fit brings them back",
    !back.bare && !back.cover && back.parentIsCard && back.pos === "" && !stillBack && deeper && !out.bare && !out.cover,
    { back, stillBack, deeper, out });
  // Escape (the panel, not full screen) brings them back too.
  click(btnByText(slot, "Fit"));
  await wheel(slot, 3);
  const inAgain = S(slot).screen.bare;
  fire("window", "keydown", { key: "Escape" });
  check("maponly: Escape brings the bars back", inAgain && !S(slot).screen.bare && !S(slot).screen.cover, S(slot).screen);
  // A pinch in does the same, once the fingers lift.
  click(btnByText(slot, "Fit"));
  const cv = canvasOf(slot);
  cv.dispatchEvent(ev("pointerdown", 300, 300, { pointerId: 5, pointerType: "touch" }));
  cv.dispatchEvent(ev("pointerdown", 500, 300, { pointerId: 6, pointerType: "touch" }));
  cv.dispatchEvent(ev("pointermove", 100, 300, { pointerId: 5, pointerType: "touch" }));
  cv.dispatchEvent(ev("pointermove", 700, 300, { pointerId: 6, pointerType: "touch" }));
  const midPinch = S(slot).screen.bare;
  cv.dispatchEvent(ev("pointerup", 100, 300, { pointerId: 5, pointerType: "touch" }));
  cv.dispatchEvent(ev("pointerup", 700, 300, { pointerId: 6, pointerType: "touch" }));
  await settle();
  check("maponly: a pinch in hides the bars once the fingers lift, never mid-pinch", !midPinch && S(slot).screen.bare,
    { midPinch, after: S(slot).screen, r: S(slot).cam.radius, fitR: S(slot).screen.fitR });
  // Switched off while covering: nothing kept, no listener left.
  const w0 = listenerCount("window");
  LA.releaseLiveAboardSlot("scr-solo");
  check("maponly: switched off while covering, nothing of it is kept",
    !inTree(slot.element, document.body) && listenerCount("window") < w0 && !(lists.window.keydown || []).length
    && !(lists.window.resize || []).length, { w0, w: listenerCount("window") });
});
await tryCase("maponly: Mapping (no mapOnly) and Furnish never hide the bars", async () => {
  const { slot } = await newSlot("scr-builder", { mapOnly: false });
  await wheel(slot, 5);
  const mapping = S(slot).screen;
  const fullShown = slot.element.querySelectorAll("button").some(b => b.getAttribute("aria-label") === "Full screen");
  LA.releaseLiveAboardSlot("scr-builder");
  const f = await newSlot("scr-furnish", { furnish: { callWS: null, toast: null, settings: {}, entities: null } });
  await wheel(f.slot, 5);
  const furnish = S(f.slot).screen;
  LA.releaseLiveAboardSlot("scr-furnish");
  check("maponly: Mapping (no mapOnly) and Furnish never hide the bars",
    !mapping.mapOnly && !mapping.bare && !mapping.cover && !furnish.bare && !furnish.cover, { mapping, furnish, fullShown });
});

// ── full screen ─────────────────────────────────────────────────────────────
await tryCase("full: the panel's own element goes full screen; Escape puts everything back", async () => {
  const asked = [];
  host.requestFullscreen = function(opts){ asked.push(opts); document.fullscreenElement = this; fire("document", "fullscreenchange", {}); return Promise.resolve(); };
  document.exitFullscreen = () => { document.fullscreenElement = null; fire("document", "fullscreenchange", {}); return Promise.resolve(); };
  document.fullscreenEnabled = true;
  const { slot } = await newSlot("scr-full");
  const fb = slot.element.querySelectorAll("button").find(b => b.getAttribute("aria-label") === "Full screen");
  click(fb);
  await settle(2);
  const on = { ...S(slot).screen };
  await wheel(slot, 4);
  const zoomed = { ...S(slot).screen };
  click(slot.element.querySelector(".la3d-solo"));
  const shown = { ...S(slot).screen };
  // Escape: the browser leaves full screen and says so.
  document.fullscreenElement = null;
  fire("document", "fullscreenchange", {});
  const out = { ...S(slot).screen, parent: slot.element.parentNode && slot.element.parentNode.className };
  check("full: the panel's own element goes full screen; Escape puts everything back",
    fb && asked.length === 1 && on.full && on.cover && !on.bare && zoomed.full && zoomed.bare && shown.full && shown.cover && !shown.bare
    && !out.full && !out.cover && !out.bare, { asked, on, zoomed, shown, out });
  LA.releaseLiveAboardSlot("scr-full");
  delete host.requestFullscreen; delete document.exitFullscreen; document.fullscreenElement = null;
});
await tryCase("full: a screen that may not go full screen gets the map alone in the panel", async () => {
  const { slot } = await newSlot("scr-nofull");
  const fb = slot.element.querySelectorAll("button").find(b => b.getAttribute("aria-label") === "Only the map");
  click(fb);
  const st = S(slot).screen;
  click(slot.element.querySelector(".la3d-solo"));
  const back = S(slot).screen;
  LA.releaseLiveAboardSlot("scr-nofull");
  host.requestFullscreen = () => Promise.reject(new Error("not allowed"));
  document.fullscreenEnabled = true;
  const r = await newSlot("scr-refused");
  click(r.slot.element.querySelectorAll("button").find(b => b.getAttribute("aria-label") === "Full screen"));
  await settle(4);
  const refused = S(r.slot).screen;
  LA.releaseLiveAboardSlot("scr-refused");
  delete host.requestFullscreen;
  check("full: a screen that may not go full screen gets the map alone in the panel",
    !!fb && st.bare && st.cover && !st.full && !back.bare && !back.cover && refused.bare && refused.cover && !refused.full,
    { st, back, refused });
});

// ── floors ──────────────────────────────────────────────────────────────────
await tryCase("floors: the stepper drives the floor chips; its name opens the floor's sheet; no badges", async () => {
  calls.length = 0;
  const { slot } = await newSlot("scr-floors");
  const seg = slot.element.querySelector(".la3d-floor"), [up, name, down, all] = seg.querySelectorAll("button");
  const shown = { seg: seg.style.display, up: up.disabled, down: down.disabled, name: name.textContent, all: all.getAttribute("aria-pressed") };
  click(down); click(all); click(name);
  card(slot, { floorSteps: steps({ at: 0, all: false }) });
  const low = { up: up.disabled, down: down.disabled, name: name.textContent, all: all.getAttribute("aria-pressed") };
  click(up); click(all);
  card(slot, { floorSteps: null });
  const none = seg.style.display;
  const st = S(slot);
  check("floors: the stepper drives the floor chips; its name opens the floor's sheet; no badges",
    shown.seg === "" && shown.up && !shown.down && shown.name === "Main" && shown.all === "true"
    && JSON.stringify(calls) === JSON.stringify([["go", 0], ["openFloor", "1"], ["go", 1], ["go", -1]])
    && low.down && !low.up && low.name === "Basement" && low.all === "false" && none === "none"
    && st.badges === undefined && !slot.element.querySelectorAll("canvas").some(c => c !== canvasOf(slot)), { shown, low, calls, none });
  LA.releaseLiveAboardSlot("scr-floors");
});

// ── fly ─────────────────────────────────────────────────────────────────────
await tryCase("fly: a double-tap on a room's floor flies in to frame it; a light's tap never flies", async () => {
  const { slot } = await newSlot("scr-fly");
  const r0 = S(slot).cam.radius;
  const at = slot._whereOf("main", 1.0, 4.2, 0);
  const pick = slot._pick(at[0], at[1]);
  await tapAt(slot, at[0], at[1]);
  await tapAt(slot, at[0], at[1]);
  const flying = S(slot).screen.flying;
  clockOff += 800;
  await settle(30);
  const st = S(slot);
  const target = st.cam.target;
  check("fly: a double-tap on a room's floor flies in to frame it; a light's tap never flies",
    !pick && flying && !st.screen.flying && st.cam.radius < r0 * 0.8 && target[0] > -0.2 && target[0] < 4.7 && target[2] > -0.2 && target[2] < 5.2
    && st.screen.bare, { r0, at, pick, flying, cam: st.cam, screen: st.screen });
  // Two taps far apart, or slow, are no double-tap.
  click(slot.element.querySelector(".la3d-solo"));
  await wheel(slot, -14);
  const r1 = S(slot).cam.radius;
  const b = slot._whereOf("main", 7.5, 4.0, 0);
  await tapAt(slot, b[0], b[1]);
  clockOff += 900;
  await tapAt(slot, b[0], b[1]);
  await settle(4);
  const slow = S(slot).screen.flying || Math.abs(S(slot).cam.radius - r1) > 1e-6;
  // A tap on a light switches it, twice: never a flight.
  calls.length = 0;
  const L = slot._where({ eid: "light.den" });
  await tapAt(slot, L[0], L[1]); clockOff += 100;
  await tapAt(slot, L[0], L[1]);
  for (let i = 0; i < 6; i++) { clockOff += 120; await settle(3); }
  check("fly: slow or far-apart taps, and taps on a light, never fly", !slow && !S(slot).screen.flying
    && Math.abs(S(slot).cam.radius - r1) < 1e-6, { slow, calls, r1, r: S(slot).cam.radius });
  LA.releaseLiveAboardSlot("scr-fly");
});

// ── views ───────────────────────────────────────────────────────────────────
await tryCase("views: saved from the camera on this browser, flown back to, forgotten with ×", async () => {
  store.clear(); calls.length = 0;
  const { slot } = await newSlot("scr-views");
  await wheel(slot, 2);
  click(slot.element.querySelector(".la3d-solo"));
  const want = { ...S(slot).cam };
  const views = btnByText(slot, "Views ▾");
  click(views);
  click(btnByText(slot, "Save this view"));
  const saved = JSON.parse(store.get("views_scr-views") || "[]");
  await wheel(slot, -6);
  click(views);
  const menu = slot.element.querySelector(".la3d-menu");
  const items = menu ? menu.querySelectorAll("button").map(b => b.textContent) : [];
  click(btnByText(slot, saved[0] ? saved[0].name : "?"));
  clockOff += 800; await settle(30);
  const back = S(slot).cam;
  // Whole house: every floor (the host's All) and the fit.
  card(slot, { floorSteps: steps({ at: 0, all: false }) });
  click(views);
  click(btnByText(slot, "Whole house"));
  clockOff += 800; await settle(30);
  const whole = S(slot);
  click(views);
  const x = slot.element.querySelector(".la3d-menu").querySelectorAll("button").find(b => b.textContent === "×");
  click(x);
  check("views: saved from the camera on this browser, flown back to, forgotten with ×",
    saved.length === 1 && saved[0].name === "Living room" && JSON.stringify(items) === JSON.stringify(["Whole house", "Living room", "×", "Save this view"])
    && Math.abs(back.radius - want.radius) < 1e-6 && Math.abs(back.theta - want.theta) < 1e-6
    && calls.some(c => c[0] === "go" && c[1] === -1) && Math.abs(whole.cam.radius - whole.screen.fitR) < 1e-6
    && JSON.parse(store.get("views_scr-views")).length === 0, { saved, items, want, back, calls, whole: whole.cam });
  LA.releaseLiveAboardSlot("scr-views");
});

// ── night ───────────────────────────────────────────────────────────────────
await tryCase("night: floors keep their colour, outlines and wall tops show, off fixtures darken", async () => {
  const { slot } = await newSlot("scr-night", { states: NIGHT });
  const n = S(slot).night, wall = S(slot).wallMat;
  const sh = { uniforms: {}, vertexShader: "void main(){\n#include <begin_vertex>\n}", fragmentShader: "void main(){\n#include <emissivemap_fragment>\n}" };
  if (wall && wall.onBeforeCompile) wall.onBeforeCompile(sh);
  card(slot, { states: DAY });
  await settle(10);
  const d = S(slot).night;
  check("night: floors keep their colour, outlines and wall tops show, off fixtures darken",
    n.k === 1 && n.floor.every(v => Math.abs(v - 0.3) < 1e-6) && n.edges.length && n.edges.every(v => v > 0.6) && Math.abs(n.top - 0.42) < 1e-6
    && n.offBulb && n.offLit && n.offBulb.every((v, i) => v <= n.offLit[i] * 0.3 + 1e-6)
    && sh.uniforms.uTopGlow && sh.uniforms.uTopGlow.value === 0 && /vTop = aTop/.test(sh.vertexShader)
    && /totalEmissiveRadiance \+= vec3\(vTop \* uTopGlow\)/.test(sh.fragmentShader)
    && Math.abs(n.grid - 0.4) < 1e-6 && d.grid === 1
    && d.k === 0 && d.floor.every(v => v === 0) && d.top === 0 && d.offBulb.every((v, i) => Math.abs(v - d.offLit[i]) < 1e-6),
    { n, d, sh: sh.fragmentShader });
  LA.releaseLiveAboardSlot("scr-night");
});

// ── names and chips ─────────────────────────────────────────────────────────
await tryCase("names: upright over the fixtures, never under a floor above, readable or hidden", async () => {
  const { slot } = await newSlot("scr-names");
  const st = S(slot), by = Object.fromEntries(st.names.map(n => [n.room, n]));
  check("names: upright over the fixtures, never under a floor above, readable or hidden",
    by["Living room"] && by["Living room"].shown && by["Living room"].onTop && by.Den.shown && by.Den.px >= 12
    && by.Rec && by.Rec.covered && !by.Rec.shown && by.Closet && !by.Closet.shown
    && st.names.filter(n => n.shown).every(n => n.px >= 12 / 0.65 - 1e-6 && n.upright), st.names);
  const chips = st.chips, den = chips.find(c => c.room === "Den"), deck = chips.find(c => c.room === null), rec = chips.find(c => c.room === "Rec");
  check("names: one chip per room under its name, a dash when stale, named outside every room",
    chips.length === 3 && den && den.eids.length === 2 && /°/.test(den.text) && /%/.test(den.text) && den.text.includes(" · ") && den.shown
    && deck && deck.text.startsWith("Deck ") && deck.text.endsWith("°") && rec && rec.text === "–°" && !/T2/.test(rec.text) && !rec.shown,
    chips);
  // A press on a chip opens its sensors: the first on top, the rest under it.
  const at = slot._where({ eid: "sensor.den_humidity" }), p = at && slot._pick(at[0], at[1]);
  check("names: a press on a chip is its sensors", p && p.hit === "device:sensor.den_temp" && p.under.includes("device:sensor.den_humidity"), { at, p });
  LA.releaseLiveAboardSlot("scr-names");
});

// ── phone ───────────────────────────────────────────────────────────────────
await tryCase("phone: one compact row; upright, room scale with the long side up the screen", async () => {
  const slot = LA.liveAboardSlot("scr-phone");
  card(slot);
  rooted(slot);
  const el = slot.element, cv = canvasOf(slot);
  for (const n of [el, cv]) { n.clientWidth = 390; n.clientHeight = 700; n.getBoundingClientRect = () => ({ x: 0, y: 0, left: 0, top: 0, right: 390, bottom: 700, width: 390, height: 700 }); }
  card(slot);
  await settle(30);
  const st = S(slot);
  const narrowCls = el.classList.contains("la3d-narrow");
  // About 9 m across at the middle of the house, or the whole house if it is smaller.
  const r = st.cam.radius, fitR = st.screen.fitR, roomR = 9 / (2 * Math.tan(20 * Math.PI / 180) * (390 / 700));
  check("phone: one compact row; upright, room scale with the long side up the screen",
    st.screen.narrow && narrowCls && Math.abs(Math.sin(st.cam.theta)) > 0.97 && Math.abs(r - Math.min(fitR, roomR)) < 1e-6,
    { cam: st.cam, screen: st.screen, roomR });
  LA.releaseLiveAboardSlot("scr-phone");
});

// ── hint ────────────────────────────────────────────────────────────────────
await tryCase("hint: a first-time card, once per browser", async () => {
  store.clear();
  const a = await newSlot("scr-hint");
  const first = S(a.slot).screen.hint, card1 = a.slot.element.querySelector(".la3d-card");
  click(btnByText(a.slot, "Got it"));
  const gone = !a.slot.element.querySelector(".la3d-card") && store.get("hint_seen") === "1";
  LA.releaseLiveAboardSlot("scr-hint");
  const b = await newSlot("scr-hint2");
  const again = S(b.slot).screen.hint;
  LA.releaseLiveAboardSlot("scr-hint2");
  check("hint: a first-time card, once per browser", first && !!card1 && gone && !again, { first, gone, again });
});

console.log(JSON.stringify({ cases, failures }));
process.exit(0);
