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
//             sheet as the Atlas's badge did; the floating badges are gone;
//             each floor's activity (on, motion) beside its name; every
//             floor and All in Views ▾ (wide) and View ▾ (narrow); a camera
//             kept per floor through the 5 s rebuild; PgUp, PgDn and Home;
//             with the map alone, the floor's name in a corner for 2 s on a
//             change or a touch, a tap on it the floor list
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
//   opening   the sidebar opens on every floor pulled apart (Explode, its own
//             default), the house framed, the bars aside with ☰ to bring them
//             back; a browser that turned Explode off keeps it off; Mapping
//             and a wall keep Explode off and their bars
//   levels    labels by zoom level: the whole house one tag per floor (name,
//             lights on, open, people; a tap shows that floor) and no names,
//             readouts or codes; one floor its names and readouts; a room
//             opened by a double-tap its own codes, the other rooms faded,
//             closed again by zooming out
//   glass     Walls: Glass, the fourth choice: what Cut takes away stands as
//             glass over a solid stub, the far walls solid, nothing of it
//             drawn under Up, Down or Cut; picked by hand it is this screen's
//             (the ⋯ list's Glass walls line), and that line opens the screen
//             on Glass; a room open turns its floor's inside walls to glass
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
// The cases below test the view's ways on a screen whose person set it as it
// opened before 2026-11-18: Explode turned off (this browser's own), the bars
// brought back with ☰. The opening itself (every floor pulled apart, the bars
// aside) has its own cases (opening:), which pass { opening: true }.
async function newSlot(key, over, opts = {}){
  if (!opts.opening && !store.has("explode")) store.set("explode", "0");
  const slot = LA.liveAboardSlot(key);
  card(slot, over);
  rooted(slot);
  const first = card(slot, over);                       // now in the panel's tree: full screen can be offered
  await settle(30);
  if (!opts.opening && S(slot).screen.bare) { click(slot.element.querySelector(".la3d-solo")); await settle(2); }
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
  // The panel rebuilt whole while covering (the page left and came back):
  // the next card takes the view back, the bars with it.
  slot.element.isConnected = false;
  shadow.removeChild(slot.element);
  const again = card(slot);
  delete slot.element.isConnected;
  check("maponly: a panel rebuilt whole while covering puts the view back in its card",
    again.ok && slot.element.parentNode === again.c && !S(slot).screen.bare && !S(slot).screen.cover && !(lists.window.keydown || []).length,
    S(slot).screen);
  await wheel(slot, 3);
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

// A host's floor chips that answer as the Atlas's do: the choice made, the
// card is built again with it (at once, the way la3dFocus does).
const COUNTS = [{ on: 2, motion: 0 }, { on: 3, motion: 1 }];
function hostSteps(slot, at, all, over = {}){
  return steps({ at, all, counts: COUNTS, ...over,
    go: (i) => { calls.push(["go", i]); card(slot, { floorSteps: hostSteps(slot, i < 0 ? 1 : i, i < 0, over) }); } });
}
const keyOn = (slot, key) => canvasOf(slot).dispatchEvent({ type: "keydown", key, altKey: false, ctrlKey: false, metaKey: false,
  defaultPrevented: false, preventDefault(){ this.defaultPrevented = true; }, stopPropagation() {} });
const menuItems = (slot) => { const m = slot.element.querySelector(".la3d-menu"); return m ? m.querySelectorAll("button").map(b => b.textContent) : []; };
const camOf = (slot) => { const c = S(slot).cam; return [c.theta, c.phi, c.radius, ...c.target].map(v => Math.round(v * 1e4) / 1e4).join(","); };

await tryCase("floors: the stepper shows each floor's activity as the floor chips do: lights and fans on, and motion", async () => {
  calls.length = 0;
  const { slot } = await newSlot("scr-counts", { floorSteps: steps({ at: 1, all: false, counts: COUNTS }) });
  const name = slot.element.querySelector(".la3d-floor").querySelectorAll("button")[1];
  const parts = () => ({ text: (name.querySelector(".la3d-fn") || {}).textContent, dot: name.querySelector(".lv-dot"), title: name.title });
  const main = parts();
  card(slot, { floorSteps: steps({ at: 0, all: false, counts: COUNTS }) });
  const base = parts();
  card(slot, { floorSteps: steps({ at: 0, all: false, counts: [{ on: 0, motion: 0 }, { on: 0, motion: 0 }] }) });
  const quiet = parts();
  check("floors: the stepper shows each floor's activity as the floor chips do: lights and fans on, and motion",
    main.text === "Main" && main.dot && main.dot.textContent === "3" && main.dot.classList.contains("motion") && /3 on · 1 motion/.test(main.title)
    && base.text === "Basement" && base.dot && base.dot.textContent === "2" && !base.dot.classList.contains("motion")
    && quiet.text === "Basement" && !quiet.dot && /nothing on/.test(quiet.title)
    && JSON.stringify(S(slot).screen.floors.counts) === JSON.stringify([{ on: 0, motion: 0 }, { on: 0, motion: 0 }]),
    { main: { ...main, dot: main.dot && main.dot.textContent }, base: base.text, quiet: quiet.text });
  LA.releaseLiveAboardSlot("scr-counts");
});
await tryCase("floors: every floor and All, with their activity, in Views ▾ (wide) and View ▾ (narrow); a tap goes there", async () => {
  calls.length = 0;
  const { slot } = await newSlot("scr-flist", { floorSteps: hostSteps(null, 1, true) });
  card(slot, { floorSteps: hostSteps(slot, 1, true) });
  click(btnByText(slot, "Views ▾"));
  const wide = menuItems(slot), m = slot.element.querySelector(".la3d-menu");
  const dots = m.querySelectorAll(".lv-dot").map(d => [d.textContent, d.classList.contains("motion")]);
  const checked = m.querySelectorAll("button").filter(b => b.getAttribute("aria-checked") === "true").map(b => b.textContent);
  click(btnByText(slot, "Basement"));
  const went = { calls: [...calls], at: S(slot).screen.floors.at, all: S(slot).screen.floors.all };
  // A narrow screen: View ▾ has them, after the angles.
  const el = slot.element, cv = canvasOf(slot);
  for (const n of [el, cv]) { n.clientWidth = 390; n.clientHeight = 700; n.getBoundingClientRect = () => ({ x: 0, y: 0, left: 0, top: 0, right: 390, bottom: 700, width: 390, height: 700 }); }
  card(slot, { floorSteps: hostSteps(slot, 0, false) });
  await settle(10);
  click(btnByText(slot, "View ▾"));
  const narrowItems = menuItems(slot);
  click(btnByText(slot, "All floors"));
  check("floors: every floor and All, with their activity, in Views ▾ (wide) and View ▾ (narrow); a tap goes there",
    JSON.stringify(wide.slice(0, 3)) === JSON.stringify(["All floors", "Basement", "Main"]) && wide.includes("Whole house")
    && JSON.stringify(dots) === JSON.stringify([["2", false], ["3", true]]) && JSON.stringify(checked) === JSON.stringify(["All floors"])
    && went.calls.length === 1 && went.calls[0][1] === 0 && went.at === 0 && !went.all && S(slot).screen.narrow
    && JSON.stringify(narrowItems.slice(0, 7)) === JSON.stringify(["Iso", "Top", "⟳ 90°", "Fit", "All floors", "Basement", "Main"])
    && calls.length === 2 && calls[1][1] === -1 && S(slot).screen.floors.all,
    { wide, dots, checked, went, narrowItems, calls });
  LA.releaseLiveAboardSlot("scr-flist");
});
await tryCase("floors: each floor keeps its own camera, through the 5 s rebuild; back on a floor, its camera is back", async () => {
  calls.length = 0;
  const { slot } = await newSlot("scr-cams", { floorSteps: hostSteps(null, 1, true) });
  card(slot, { floorSteps: hostSteps(slot, 1, true) });
  slot._look(0.3, 0.7, [2, 3, 1], 20);
  const all = camOf(slot);
  keyOn(slot, "PageDown");                                // All → the Basement (none kept yet: it stays)
  const stayed = camOf(slot) === all;
  slot._look(1.1, 0.5, [1, 0, 1], 12);
  const basement = camOf(slot);
  card(slot, { floorSteps: hostSteps(slot, 0, false) });  // the 5 s rebuild
  card(slot, { floorSteps: hostSteps(slot, 0, false) });
  const kept = camOf(slot) === basement;
  click(slot.element.querySelector(".la3d-floor").querySelectorAll("button")[0]);   // ▲ Main
  slot._look(2.0, 0.9, [5, 3, 2], 25);
  const main = camOf(slot);
  click(btnByText(slot, "Views ▾"));
  click(btnByText(slot, "Basement"));                     // the menu: the Basement's camera is back
  const backBasement = camOf(slot);
  keyOn(slot, "PageUp");                                  // the key: Main's is back
  const backMain = camOf(slot);
  keyOn(slot, "Home");                                    // Home: every floor, All's camera back
  const backAll = camOf(slot);
  check("floors: each floor keeps its own camera, through the 5 s rebuild; back on a floor, its camera is back",
    stayed && kept && backBasement === basement && backMain === main && backAll === all && main !== basement
    && JSON.stringify(S(slot).screen.floorCams.sort()) === JSON.stringify(["all", "floor:Basement", "floor:Main"]),
    { all, basement, main, backBasement, backMain, backAll, cams: S(slot).screen.floorCams, calls });
  LA.releaseLiveAboardSlot("scr-cams");
  const again = await newSlot("scr-cams", { floorSteps: hostSteps(null, 1, true) });
  check("floors: a camera kept per floor is this screen's for this page load only (switched off, it is gone)",
    S(again.slot).screen.floorCams.length === 0, S(again.slot).screen.floorCams);
  LA.releaseLiveAboardSlot("scr-cams");
});
await tryCase("floors: opened on a floor, All keeps the house framed (no camera is kept from before the view was framed)", async () => {
  calls.length = 0;
  const slot = LA.liveAboardSlot("scr-camsopen");
  card(slot, { floorSteps: hostSteps(slot, 1, true) });   // the host's first card: All
  rooted(slot);
  card(slot, { floorSteps: hostSteps(slot, 1, false) });  // then the floor it keeps (Main), all before a frame
  await settle(30);
  const framed = camOf(slot), fitR = S(slot).screen.fitR;
  keyOn(slot, "Home");                                    // All
  const st = S(slot);
  check("floors: opened on a floor, All keeps the house framed (no camera is kept from before the view was framed)",
    st.screen.floors.all && camOf(slot) === framed && st.cam.radius >= fitR * 0.97 && !st.screen.floorCams.includes("all"),
    { framed, now: camOf(slot), fitR, cams: st.screen.floorCams });
  LA.releaseLiveAboardSlot("scr-camsopen");
});
await tryCase("floors: back on a floor kept zoomed out, with the map alone, the bars come back", async () => {
  calls.length = 0;
  const { slot } = await newSlot("scr-camsbare", { floorSteps: hostSteps(null, 1, true) });
  card(slot, { floorSteps: hostSteps(slot, 1, true) });
  keyOn(slot, "PageDown");                                // All → the Basement, kept as the whole house
  keyOn(slot, "PageUp");                                  // → Main
  await wheel(slot, 3);                                   // zoomed in on Main: the map alone
  const bareOnMain = S(slot).screen.bare;
  keyOn(slot, "PageDown");                                // the Basement's camera (the whole house) back
  const st = S(slot).screen;
  check("floors: back on a floor kept zoomed out, with the map alone, the bars come back",
    bareOnMain && !st.bare && S(slot).cam.radius >= st.fitR * 0.97, { bareOnMain, st, r: S(slot).cam.radius });
  LA.releaseLiveAboardSlot("scr-camsbare");
});
await tryCase("floors: a camera is kept by the floor's name, so a floor deleted elsewhere never hands it to another", async () => {
  calls.length = 0;
  const three = { names: ["Basement", "Main", "Upper"], zs: ["0", "1", "2"], counts: null };
  const { slot } = await newSlot("scr-camsname", { floorSteps: hostSteps(null, 2, false, three) });
  card(slot, { floorSteps: hostSteps(slot, 2, false, three) });   // Upper
  slot._look(2.0, 0.9, [5, 3, 2], 25);
  const upper = camOf(slot);
  keyOn(slot, "PageDown");                                // Main
  slot._look(1.1, 0.5, [1, 0, 1], 12);
  // The Basement deleted: Main and Upper are now levels 0 and 1.
  const two = { names: ["Main", "Upper"], zs: ["0", "1"], counts: null };
  card(slot, { floorSteps: hostSteps(slot, 0, false, two) });
  keyOn(slot, "PageUp");                                  // Upper: its own camera, not Main's
  check("floors: a camera is kept by the floor's name, so a floor deleted elsewhere never hands it to another",
    camOf(slot) === upper, { now: camOf(slot), upper, cams: S(slot).screen.floorCams });
  LA.releaseLiveAboardSlot("scr-camsname");
});
await tryCase("floors: PgUp and PgDn step a floor and Home is All, while the view has the keyboard", async () => {
  calls.length = 0;
  const { slot } = await newSlot("scr-keys", { floorSteps: hostSteps(null, 1, true) });
  card(slot, { floorSteps: hostSteps(slot, 1, true) });
  const cv = canvasOf(slot);
  keyOn(slot, "PageDown"); const a = { ...S(slot).screen.floors };
  keyOn(slot, "PageDown"); const b = { ...S(slot).screen.floors };       // the bottom floor: nowhere lower
  keyOn(slot, "PageUp"); const c = { ...S(slot).screen.floors };
  keyOn(slot, "Home"); const d = { ...S(slot).screen.floors };
  const n = calls.length;
  keyOn(slot, "ArrowUp"); keyOn(slot, "a");
  check("floors: PgUp and PgDn step a floor and Home is All, while the view has the keyboard",
    cv.tabIndex === 0 && a.at === 0 && !a.all && b.at === 0 && c.at === 1 && !c.all && d.all
    && JSON.stringify(calls.map(x => x[1])) === JSON.stringify([0, 1, -1]) && calls.length === n,
    { a, b, c, d, calls, tab: cv.tabIndex });
  LA.releaseLiveAboardSlot("scr-keys");
});
await tryCase("floors: the map alone shows the floor's name faintly in a corner for 2 s on a change or a touch; a tap on it lists the floors", async () => {
  calls.length = 0;
  const { slot } = await newSlot("scr-corner", { floorSteps: hostSteps(null, 1, false) });
  card(slot, { floorSteps: hostSteps(slot, 1, false) });
  const corner = slot.element.querySelector(".la3d-corner"), cv = canvasOf(slot);
  const st = () => ({ ...S(slot).screen.corner, cls: corner.classList.contains("on") });
  cv.dispatchEvent(ev("pointerdown", 300, 300)); cv.dispatchEvent(ev("pointerup", 300, 300));
  const barsShown = st();                                  // the bars show the stepper: nothing in the corner
  clockOff += 1000;                                        // no double-tap with the touch below
  await wheel(slot, 3);                                    // zoomed in: the map alone
  const bare0 = { bare: S(slot).screen.bare, ...st() };
  cv.dispatchEvent(ev("pointerdown", 300, 300, { pointerType: "touch", pointerId: 9 }));
  cv.dispatchEvent(ev("pointerup", 300, 300, { pointerType: "touch", pointerId: 9 }));
  const touched = st(), dot = corner.querySelector(".lv-dot");
  corner.dispatchEvent({ type: "animationend" });          // its 2 s fade ends
  const faded = st();
  click(corner);                                           // gone: a tap there is nothing
  const tapGone = S(slot).screen.menu;
  keyOn(slot, "PageDown");                                 // a floor change: the new floor's name
  const changed = st();
  click(corner);
  const m = slot.element.querySelector(".la3d-menu");
  const listed = { items: menuItems(slot), keep: !!(m && m.classList.contains("la3d-keep")) };
  click(btnByText(slot, "All floors"));
  const all = st();
  click(slot.element.querySelector(".la3d-solo"));         // ☰: the bars back, the corner empty
  const back = st();
  const css = slot.element.querySelectorAll("style").map(s => s.textContent).join("\n");
  check("floors: the map alone shows the floor's name faintly in a corner for 2 s on a change or a touch; a tap on it lists the floors",
    !barsShown.on && bare0.bare && !bare0.on && touched.on && touched.cls && touched.text === "Main3" && dot && dot.classList.contains("motion")
    && !faded.on && !faded.cls && !tapGone && changed.on && changed.text === "Basement2"
    && JSON.stringify(listed.items) === JSON.stringify(["All floors", "Basement", "Main"]) && listed.keep
    && all.on && all.text === "All floors" && !back.on && !back.cls
    && /\.la3d\.la3d-bare \.la3d-corner\.on\{[^}]*animation:la3d-corner 2s/.test(css)
    && /\.la3d\.la3d-bare \.la3d-menu\.la3d-keep\{opacity:1;visibility:visible/.test(css),
    { barsShown, bare0, touched, faded, tapGone, changed, listed, all, back });
  LA.releaseLiveAboardSlot("scr-corner");
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
  // In the menu: a room chip along the top has the room's name too.
  click(menu ? menu.querySelectorAll("button").find(b => b.textContent === (saved[0] ? saved[0].name : "?")) : null);
  clockOff += 800; await settle(30);
  const back = S(slot).cam;
  // Whole house: every floor (the host's All) and the fit.
  card(slot, { floorSteps: steps({ at: 0, all: false }) });
  click(views);
  click(btnByText(slot, "Whole house"));
  clockOff += 800; await settle(30);
  const whole = S(slot);
  click(views);
  const x = slot.element.querySelector(".la3d-menu").querySelectorAll("button").find(b => b.textContent === "✕");
  click(x);
  check("views: saved from the camera on this browser, flown back to, forgotten with ×",
    saved.length === 1 && saved[0].name === "Living room"
    && JSON.stringify(items) === JSON.stringify(["All floors", "Basement", "Main", "⇕ Explode", "Whole house", "Edgecut", "How it works", "Living room", "✕", "Save this view", "Look: Same as Settings ›", "Show on this screen ⋯", "Home view", "Set as home"])
    && Math.abs(back.radius - want.radius) < 1e-6 && Math.abs(back.theta - want.theta) < 1e-6
    && calls.some(c => c[0] === "go" && c[1] === -1) && Math.abs(whole.cam.radius - whole.screen.fitR) < 1e-6
    && JSON.parse(store.get("views_scr-views")).length === 0, { saved, items, want, back, calls, whole: whole.cam });
  LA.releaseLiveAboardSlot("scr-views");
});

// ── night ───────────────────────────────────────────────────────────────────
await tryCase("night: floors keep their colour, outlines and wall tops show, off fixtures are lit like the room (never darkened twice)", async () => {
  const { slot } = await newSlot("scr-night", { states: NIGHT });
  const n = S(slot).night, wall = S(slot).wallMat;
  const sh = { uniforms: {}, vertexShader: "void main(){\n#include <begin_vertex>\n}", fragmentShader: "void main(){\n#include <emissivemap_fragment>\n}" };
  if (wall && wall.onBeforeCompile) wall.onBeforeCompile(sh);
  card(slot, { states: DAY });
  await settle(10);
  const d = S(slot).night;
  check("night: floors keep their colour, outlines and wall tops show, off fixtures are lit like the room (never darkened twice)",
    n.k === 1 && n.floor.every(v => Math.abs(v - 0.3) < 1e-6) && n.edges.length && n.edges.every(v => v > 0.6) && Math.abs(n.top - 0.42) < 1e-6
    && n.offBulb && n.offLit && n.offBulb.every((v, i) => Math.abs(v - n.offLit[i]) < 1e-6)
    && sh.uniforms.uTopGlow && sh.uniforms.uTopGlow.value === 0 && /vTop = aTop/.test(sh.vertexShader)
    && /totalEmissiveRadiance \+= vec3\(vTop \* uTopGlow\)/.test(sh.fragmentShader)
    && Math.abs(n.grid - 0.4) < 1e-6 && d.grid === 1
    && d.k === 0 && d.floor.every(v => v === 0) && d.top === 0 && d.offBulb.every((v, i) => Math.abs(v - d.offLit[i]) < 1e-6),
    { n, d, sh: sh.fragmentShader });
  LA.releaseLiveAboardSlot("scr-night");
});

// ── names and chips ─────────────────────────────────────────────────────────
// Names and readouts show with a floor chosen (labels by zoom level: the whole
// house shows a tag per floor instead, the opening: cases); the floor under it still draws.
const ON_MAIN = { floorSteps: steps({ at: 1, all: false }) };
await tryCase("names: upright over the fixtures, never under a floor above, readable or hidden", async () => {
  const { slot } = await newSlot("scr-names", ON_MAIN);
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

// A sunken room (a split level, live_aboard_house.js splitLevels) is drawn
// under its own floor, which is open over it: that floor never hides its
// name or its chip (the demo's sunken garage, 2026-10-28).
await tryCase("names: a sunken room's name shows with its own floor, which is open over it", async () => {
  const SUNK = { ...MODEL, floors: [{ id: "basement", name: "Basement", floor_to_floor_m: 3 }, { id: "main", name: "Main", floor_to_floor_m: 2.8 }],
                 floor_elevations: { basement: -3, main: 0 }, room_meta: { Den: { floor_id: "main", color: "#3a6ea5", floor_raise_m: -0.55 } } };
  const { slot } = await newSlot("scr-sunk", { model: SUNK, floors: SUNK.floors, ...ON_MAIN });
  const st = S(slot), by = Object.fromEntries(st.names.map(n => [n.room, n])), den = st.chips.find(c => c.room === "Den");
  check("names: a sunken room's name shows with its own floor, which is open over it",
    by.Den && by.Den.shown && !by.Den.covered && by["Living room"] && by["Living room"].shown && den && den.shown,
    { names: st.names, den });
  LA.releaseLiveAboardSlot("scr-sunk");
});

// ── phone ───────────────────────────────────────────────────────────────────
await tryCase("phone: one compact row; upright, room scale with the long side up the screen", async () => {
  store.set("explode", "0");                              // one floor's room scale (pulled apart: opening:)
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

// ── opening ─────────────────────────────────────────────────────────────────
const yOf = (t) => { const m = /translate\(([-\d.]+)px, ([-\d.]+)px\)/.exec(t.at || ""); return m ? Number(m[2]) : NaN; };
await tryCase("opening: the sidebar opens on every floor pulled apart, the house framed, the bars aside; ☰ brings them back", async () => {
  store.delete("explode");
  const { slot } = await newSlot("scr-open", undefined, { opening: true });
  const st = S(slot), xp = slot.element.querySelector(".la3d-floor").querySelectorAll("button")[4];
  const opened = { bare: st.screen.bare, cover: st.screen.cover, explode: st.levels.explode, on: st.levels.explodeOn, fitR: st.screen.fitR,
                   r: st.cam.radius, cls: slot.element.classList.contains("la3d-bare"), xp: xp.getAttribute("aria-pressed") };
  click(slot.element.querySelector(".la3d-solo"));
  await settle(2);
  const back = { ...S(slot).screen };
  click(xp);                                               // ⇕ off: this browser keeps it off
  await settle(10);
  const off = { explode: S(slot).levels.explode, pref: store.get("explode") };
  LA.releaseLiveAboardSlot("scr-open");
  check("opening: the sidebar opens on every floor pulled apart, the house framed, the bars aside; ☰ brings them back",
    opened.bare && opened.cover && opened.cls && opened.explode === 4 && opened.on && opened.xp === "true" && opened.fitR > 0
    && Math.abs(opened.r - opened.fitR) < 1e-6 && !back.bare && !back.cover && off.explode === 0 && off.pref === "0", { opened, back, off });
});
await tryCase("opening: a browser that turned Explode off keeps it off; Mapping and a wall keep Explode off and their bars", async () => {
  store.set("explode", "0");
  const a = await newSlot("scr-open-off", undefined, { opening: true });
  const kept = { explode: S(a.slot).levels.explode, bare: S(a.slot).screen.bare };
  LA.releaseLiveAboardSlot("scr-open-off");
  store.delete("explode");
  const m = await newSlot("scr-open-map", { mapOnly: false }, { opening: true });
  const mapping = { explode: S(m.slot).levels.explode, bare: S(m.slot).screen.bare, on: S(m.slot).levels.explodeOn };
  LA.releaseLiveAboardSlot("scr-open-map");
  const w = await newSlot("scr-open-wall", { kiosk: true }, { opening: true });
  const wall = { explode: S(w.slot).levels.explode, bare: S(w.slot).screen.bare, on: S(w.slot).levels.explodeOn };
  LA.releaseLiveAboardSlot("scr-open-wall");
  check("opening: a browser that turned Explode off keeps it off; Mapping and a wall keep Explode off and their bars",
    kept.explode === 0 && kept.bare && mapping.explode === 0 && !mapping.on && !mapping.bare && wall.explode === 0 && !wall.on && !wall.bare,
    { kept, mapping, wall });
});

await tryCase("opening: a phone held upright frames every floor pulled apart whole, not a room's worth between them", async () => {
  store.delete("explode");
  const slot = LA.liveAboardSlot("scr-open-phone");
  card(slot);
  rooted(slot);
  const el = slot.element, cv = canvasOf(slot);
  for (const n of [el, cv]) { n.clientWidth = 390; n.clientHeight = 700; n.getBoundingClientRect = () => ({ x: 0, y: 0, left: 0, top: 0, right: 390, bottom: 700, width: 390, height: 700 }); }
  card(slot);
  await settle(30);
  const st = S(slot);
  LA.releaseLiveAboardSlot("scr-open-phone");
  check("opening: a phone held upright frames every floor pulled apart whole, not a room's worth between them",
    st.levels.explode === 4 && st.screen.fitR > 0 && Math.abs(st.cam.radius - st.screen.fitR) < 1e-6 && st.levels.level === "house",
    { cam: st.cam, fitR: st.screen.fitR, levels: st.levels });
});

// ── levels ──────────────────────────────────────────────────────────────────
const CODED = { ...LBE, "light.den": { ...LBE["light.den"], code: "A01" }, "light.hall": { ...LBE["light.hall"], code: "A02" } };
await tryCase("levels: the whole house shows one tag per floor and no room names, readouts or codes; a tap on a tag shows that floor", async () => {
  store.delete("explode"); calls.length = 0;
  const { slot } = await newSlot("scr-lv-house", { lightsByEid: CODED, codes: { showcase: false }, setTopFloor: (fid) => calls.push(["top", fid]) }, { opening: true });
  const st = S(slot), tags = Object.fromEntries(st.levels.tags.map(t => [t.floor, t]));
  const words = st.names.filter(n => n.shown).map(n => n.room), chipsOn = st.chips.filter(c => c.shown).length;
  click(slot.element.querySelector('[data-la3d-ftag="basement"]'));
  check("levels: the whole house shows one tag per floor and no room names, readouts or codes; a tap on a tag shows that floor",
    st.levels.level === "house" && st.levels.tags.length === 2 && tags.main && tags.main.shown && tags.main.text === "Main1 light on"
    && tags.basement && tags.basement.shown && tags.basement.text === "BasementNothing on" && yOf(tags.main) < yOf(tags.basement)
    && !words.length && chipsOn === 0 && st.codes && st.codes.shown === 0 && JSON.stringify(calls) === JSON.stringify([["top", "basement"]]),
    { level: st.levels.level, tags: st.levels.tags, words, chipsOn, codes: st.codes && st.codes.shown, calls });
  LA.releaseLiveAboardSlot("scr-lv-house");
});
await tryCase("levels: one floor shows its rooms' names and readouts, no floor tags and no codes", async () => {
  const { slot } = await newSlot("scr-lv-floor", { ...ON_MAIN, lightsByEid: CODED, codes: { showcase: false } }, { opening: true });
  const st = S(slot), by = Object.fromEntries(st.names.map(n => [n.room, n])), den = st.chips.find(c => c.room === "Den");
  check("levels: one floor shows its rooms' names and readouts, no floor tags and no codes",
    st.levels.level === "floor" && by.Den.shown && by["Living room"].shown && den && den.shown && !st.levels.tags.some(t => t.shown)
    && st.codes && st.codes.shown === 0, { level: st.levels.level, tags: st.levels.tags, names: st.names.map(n => [n.room, n.shown]), codes: st.codes });
  LA.releaseLiveAboardSlot("scr-lv-floor");
});
await tryCase("levels: a double-tap opens a room: its own codes, the other rooms faded; zoomed back out, it closes", async () => {
  const { slot } = await newSlot("scr-lv-room", { ...ON_MAIN, lightsByEid: CODED, codes: { showcase: false } });
  const at = slot._whereOf("main", 8.5, 0.6, 0);            // Den's floor, clear of its name, chip and light
  await tapAt(slot, at[0], at[1]);
  await tapAt(slot, at[0], at[1]);
  clockOff += 800;
  await settle(30);
  const st = S(slot), by = Object.fromEntries(st.names.map(n => [n.room, n])), code = Object.fromEntries(st.codes.chips.map(c => [c.eid, c.on]));
  const den = st.chips.find(c => c.room === "Den"), rec = st.chips.find(c => c.room === "Rec");
  const room = { level: st.levels.level, room: st.levels.room, faded: st.levels.faded, denOp: by.Den.opacity, livingOp: by["Living room"].opacity,
                 code, denChip: den && den.opacity, recChip: rec && rec.opacity };
  await wheel(slot, -12);
  const out = S(slot);
  check("levels: a double-tap opens a room: its own codes, the other rooms faded; zoomed back out, it closes",
    room.level === "room" && room.room && room.room.name === "Den" && room.code["light.den"] === true && room.code["light.hall"] === false
    && room.denOp === 1 && Math.abs(room.livingOp - 0.35) < 1e-6 && room.denChip === 1 && Math.abs(room.recChip - 0.35) < 1e-6
    && room.faded.some(v => Number.isInteger(v) && v >= 0) && room.faded.includes(-1)
    && out.levels.level === "floor" && !out.levels.room && out.levels.faded.every(v => v === null) && out.codes.shown === 0
    && out.names.find(n => n.room === "Living room").opacity === 1, { room, out: { levels: out.levels, codes: out.codes.shown } });
  LA.releaseLiveAboardSlot("scr-lv-room");
});

// ── glass ───────────────────────────────────────────────────────────────────
const ghostOf = (slot, fid) => S(slot).ghost.find(g => g.floor === fid) || null;
await tryCase("glass: Glass, the fourth Walls choice: what Cut takes away stands as glass over its stub, the far walls solid; Up, Down and Cut draw none", async () => {
  const { slot } = await newSlot("scr-glass", ON_MAIN);
  const cut = { ...ghostOf(slot, "main"), mode: S(slot).wallMode };
  const labels = slot.element.querySelector("[data-la3d-walls]").querySelectorAll("button").map(b => b.textContent);
  click(btnByText(slot, "Glass"));
  await settle(4);
  const glass = { ...ghostOf(slot, "main"), mode: S(slot).wallMode, pref: JSON.parse(store.get("show_scr-glass") || "{}").glass_walls };
  click(btnByText(slot, "Up"));
  await settle(4);
  const up = ghostOf(slot, "main");
  click(btnByText(slot, "Glass"));
  await settle(4);
  click(btnByText(slot, "Cut"));
  await settle(4);
  const back = { ...ghostOf(slot, "main"), mode: S(slot).wallMode, pref: JSON.parse(store.get("show_scr-glass") || "{}").glass_walls };
  LA.releaseLiveAboardSlot("scr-glass");
  check("glass: Glass, the fourth Walls choice: what Cut takes away stands as glass over its stub, the far walls solid; Up, Down and Cut draw none",
    JSON.stringify(labels) === JSON.stringify(["Cut", "Up", "Down", "Glass", "Roof"]) && cut.mode === "cut" && !cut.drawn && cut.placed === 0
    && glass.mode === "glass" && glass.drawn && glass.placed > 0 && glass.placed < glass.solid && glass.solid === cut.solid
    && glass.transparent === true && glass.depthWrite === false && glass.order > 0 && glass.pref === true
    && !up.drawn && back.mode === "cut" && !back.drawn && back.placed === 0 && back.pref === undefined, { labels, cut, glass, up, back });
});
await tryCase("glass: the ⋯ list's Glass walls line opens this screen on Glass; a room open turns its floor's inside walls to glass", async () => {
  store.set("show_scr-glass2", JSON.stringify({ glass_walls: true }));
  const { slot } = await newSlot("scr-glass2", ON_MAIN);
  // From the front (plan +y), the wall between the living room and the Den is edge-on: neither Cut nor Glass takes it.
  slot._look(0, 0.9, [6.8, 0, 2.5], 16);
  await settle(4);
  const opened = { mode: S(slot).wallMode, ...ghostOf(slot, "main") };
  const at = slot._whereOf("main", 8.5, 0.6, 0);            // Den's floor, clear of its name, chip and light
  await tapAt(slot, at[0], at[1]);
  await tapAt(slot, at[0], at[1]);
  clockOff += 800;
  await settle(30);
  const inRoom = { room: S(slot).levels.room, ...ghostOf(slot, "main") };
  store.delete("show_scr-glass2");
  LA.releaseLiveAboardSlot("scr-glass2");
  check("glass: the ⋯ list's Glass walls line opens this screen on Glass; a room open turns its floor's inside walls to glass",
    opened.mode === "glass" && opened.drawn && inRoom.room && inRoom.room.name === "Den" && inRoom.placed > opened.placed, { opened, inRoom });
});

process.stdout.write(JSON.stringify({ cases, failures }) + "\n", () => process.exit(0));   // exit only once the result is written (a pipe holds 64 KiB)
