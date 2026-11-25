// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
//
// Edgecut in the 3D house (views/live_aboard_edgecut.js, inside
// views/live_aboard.js): its numbers on their own, then the real view under
// the DOM shim with a stub GL, on a two-floor house of five rooms:
//
//   math     every ray through the view lands in a room (no background at
//            any edge), as far out as that holds: a step farther, the view
//            shows background; filled at the whole house, the whole house;
//            too thin to fill, four times nearer and no more; two floors
//            fill together; centred on the rooms; bad numbers never hang
//   off      a screen without it: framed as ever; Views ▾ lists it unticked
//   views    Views ▾ → Edgecut ticks the ⋯ list's line for this screen (the
//            same pref), counted; it frames: rooms to every edge, nearer
//            than the whole house, the angle as it was; picked again it
//            goes off and back to the whole house
//   list     ticked in the ⋯ list, it frames and Views ▾ shows it ticked
//   other    the whole house, a saved view or an angle turns it off and does
//            what it always did
//   always   a floor chosen frames it again; a new size at once
//   hand     moved by hand it is left alone (a poll, a resize); the flight
//            home after a minute is Edgecut again
//   builder  Mapping's builder has no Edgecut and a tick does nothing there
//   wall     a wall opens on it and goes nowhere
//   rest     nothing moving: no frames
//
// usage: live_aboard_edgecut.mjs <www/padspan-ha dir>
// prints one JSON line: { cases: {name: result}, failures: [...] }

import { pathToFileURL } from "node:url";
import { join } from "node:path";
import * as shim from "./dom_shim.mjs";
import { installStubGL } from "./stub_gl.mjs";

const WWW = process.argv[2];
if (!WWW) { console.error("usage: live_aboard_edgecut.mjs <www/padspan-ha dir>"); process.exit(2); }
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
const Wn = listen("window"), Dc = listen("document");
globalThis.addEventListener = Wn.add; globalThis.removeEventListener = Wn.remove;
document.addEventListener = Dc.add; document.removeEventListener = Dc.remove;
installStubGL();

let clockOff = 0;
const clock0 = performance.now(), date0 = Date.now();
performance.now = () => clock0 + clockOff;
Date.now = () => date0 + clockOff;
const shimRaf = globalThis.requestAnimationFrame;
globalThis.requestAnimationFrame = (fn) => shimRaf(() => fn(performance.now()));
const pendingFrames = () => shim.rafQueue.filter(Boolean).length;

const url = (p) => pathToFileURL(join(WWW, p)).href;
const EDGE = await import(url("views/live_aboard_edgecut.js"));
const LA = await import(url("views/live_aboard.js"));
const SHOW = await import(url("views/live_aboard_show.js"));
const LM = await import(url("views/lights_map.js"));

const failures = [];
const cases = {};
const check = (name, ok, detail) => { cases[name] = !!ok; if (!ok) failures.push({ name, detail: detail === undefined ? null : detail }); };
const tryCase = async (name, fn) => {
  try { await fn(); } catch (e) { failures.push({ name, detail: String(e && e.stack || e).slice(0, 900) }); cases[name] = false; }
};
const settle = async (rounds = 14) => { await shim.flush(rounds); await new Promise(r => globalThis._realSetTimeout(r, 0)); };
async function later(ms, rounds = 8){ clockOff += ms; await settle(rounds); }
const near = (a, b, e = 1e-3) => Array.isArray(a) ? a.every((v, i) => Math.abs(v - b[i]) < e) : Math.abs(a - b) < e;

// ── what the view shows, worked out here on its own ─────────────────────────
const TV = Math.tan(20 * Math.PI / 180);
const inPoly = (x, y, P) => {
  let c = false;
  for (let i = 0, j = P.length - 1; i < P.length; j = i++) {
    const a = P[i], b = P[j];
    if ((a[1] > y) !== (b[1] > y) && x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0]) c = !c;
  }
  return c;
};
/** The share of an n × m grid over the view (its edges and corners included) whose rays pass through a room: 1 is filled.
 *  cam: {theta, phi, radius, target}; aspect: the view's width over its height. */
function filled(floors, cam, aspect, n = 41, m = 31){
  const { dir, right, up } = EDGE.cameraAxes(cam.theta, cam.phi), eye = cam.target.map((v, i) => v + dir[i] * cam.radius);
  let hit = 0;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < m; j++) {
      const u = (2 * i / (n - 1) - 1) * TV * aspect, v = (2 * j / (m - 1) - 1) * TV, ray = [0, 1, 2].map(k => -dir[k] + right[k] * u + up[k] * v);
      // Through a room between its floor and its walls' tops (the far wall is the house; the ground past it is not).
      if (floors.some(f => [...Array(17).keys()].some(k => { const t = (f.y + (f.h || 0) * k / 16 - eye[1]) / ray[1];
        return t > 0 && f.polys.some(P => inPoly(eye[0] + t * ray[0], eye[2] + t * ray[2], P)); }))) hit++;
    }
  }
  return hit / (n * m);
}
/** Do the rooms (their floors and wall tops) reach past every edge of the view, as the camera sees them? The rule
 *  (the owner, 2026-11-24: "Cut the edges left to right"): the house spans the view left to right and top to bottom. */
function reaches(floors, cam, aspect){
  const { dir, right, up } = EDGE.cameraAxes(cam.theta, cam.phi), eye = cam.target.map((v, i) => v + dir[i] * cam.radius);
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
  for (const f of floors) for (const P of f.polys) for (const [x, z] of P) for (const y of [f.y, f.y + (f.h || 0)]) {
    const q = [x - eye[0], y - eye[1], z - eye[2]], d = -dot(q, dir);
    if (!(d > 1e-6)) return true;
    const u = dot(q, right) / (d * TV * aspect), v = dot(q, up) / (d * TV);
    u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v);
  }
  return u0 <= -1 + 1e-6 && u1 >= 1 - 1e-6 && v0 <= -1 + 1e-6 && v1 >= 1 - 1e-6;
}
const box = (x0, z0, x1, z1) => [[x0, z0], [x1, z0], [x1, z1], [x0, z1]];
/** One floor of rooms at height y, and the corners the view frames (floor and wall top). */
const floorOf = (y, polys, h = 2.5) => ({ floor: { y, h, polys }, pts: polys.flatMap(P => P.flatMap(([x, z]) => [[x, y, z], [x, y + h, z]])) });
const fit = (o) => EDGE.edgecutFit({ tanH: TV * 4 / 3, tanV: TV, rMin: 1.5, ...o });
const camOf = (f, theta, phi) => ({ theta, phi, radius: f.r, target: f.target });

// ── math ────────────────────────────────────────────────────────────────────
await tryCase("math: at an angle the rooms reach every edge of the view, and a step farther they don't", async () => {
  // A 20 × 12 m house seen from a corner, tilted: spanning the view cuts its corners off.
  const { floor, pts } = floorOf(0, [box(0, 0, 10, 12), box(10, 0, 20, 12)]), theta = 0.3, phi = 0.6;
  const f = fit({ floors: [floor], pts, theta, phi, rMax: 30 });
  const at = reaches([floor], camOf(f, theta, phi), 4 / 3), out = reaches([floor], { ...camOf(f, theta, phi), radius: f.r * 1.03 }, 4 / 3);
  check("math: at an angle the rooms reach every edge of the view, and a step farther they don't",
    f && at && !out && f.r > 30 / 4 && f.r < 30, { f, at, out });
});
await tryCase("math: a steep view spans the view too, well short of the cap, and fuller than the whole house", async () => {
  // The first build asked every corner of a tilted view to show a room: the top corners look past the far wall, so it
  // always went to the cap (four times nearer, a room or two). Spanning the view is the rule, as on the flat map.
  const { floor, pts } = floorOf(0, [box(0, 0, 20, 12)]), theta = Math.PI / 4, phi = 0.98;
  const f = fit({ floors: [floor], pts, theta, phi, rMax: 40 });
  const at = reaches([floor], camOf(f, theta, phi), 4 / 3), out = reaches([floor], { ...camOf(f, theta, phi), radius: f.r * 1.03 }, 4 / 3);
  const fuller = filled([floor], camOf(f, theta, phi), 4 / 3) > filled([floor], { ...camOf(f, theta, phi), radius: 40 }, 4 / 3) + 0.2;
  check("math: a steep view spans the view too, well short of the cap, and fuller than the whole house",
    f && at && !out && f.r > 40 / 4 + 1 && f.r < 40 && fuller, { f, at, out, fuller });
});
await tryCase("math: straight down on a long house, the ends are cut, the middle is in the middle", async () => {
  const { floor, pts } = floorOf(0, [box(0, 0, 24, 6)]), theta = 0, phi = 0.0015;
  const f = fit({ floors: [floor], pts, theta, phi, rMax: 20 });
  const at = reaches([floor], camOf(f, theta, phi), 4 / 3), out = reaches([floor], { ...camOf(f, theta, phi), radius: f.r * 1.03 }, 4 / 3);
  check("math: straight down on a long house, the ends are cut, the middle is in the middle",
    f && at && !out && filled([floor], camOf(f, theta, phi), 4 / 3) === 1 && near(f.target[0], 12, 1e-6) && near(f.target[2], 3, 0.05), { f, at, out });
});
await tryCase("math: filled already at the whole house: the whole house; too thin to fill: four times nearer, no more", async () => {
  const big = floorOf(0, [box(-100, -100, 100, 100)]);
  const a = fit({ floors: [big.floor], pts: big.pts, theta: 0.6, phi: 0.9, rMax: 20 });
  const thin = floorOf(0, [box(0, 0, 20, 0.4)]);
  const b = fit({ floors: [thin.floor], pts: thin.pts, theta: 0.6, phi: 0.9, rMax: 40 });
  check("math: filled already at the whole house: the whole house; too thin to fill: four times nearer, no more",
    a && near(a.r, 20, 1e-9) && b && near(b.r, 40 / EDGE.ZOOM_MAX, 1e-9) && EDGE.ZOOM_MAX === 4, { a, b });
});
await tryCase("math: two floors span the view together; a courtyard is framed as the house round it", async () => {
  // The lower floor's east half under an upper floor's west half: from above they span the view as one.
  const lo = floorOf(0, [box(10, 0, 20, 10)]), hi = floorOf(3, [box(0, 0, 10, 10)]), theta = 0, phi = 0.0015;
  const f = fit({ floors: [lo.floor, hi.floor], pts: [...lo.pts, ...hi.pts], theta, phi, rMax: 20 });
  const both = reaches([lo.floor, hi.floor], camOf(f, theta, phi), 4 / 3), one = reaches([hi.floor], camOf(f, theta, phi), 4 / 3);
  // A courtyard in the middle: framed as the house round it is (the hole shows, as on the flat map), not by a room or two.
  const ring = floorOf(0, [box(0, 0, 20, 4), box(0, 4, 8, 12), box(12, 4, 20, 12), box(0, 12, 20, 16)]);
  const solid = floorOf(0, [box(0, 0, 20, 16)]);
  const g = fit({ floors: [ring.floor], pts: ring.pts, theta, phi, rMax: 20 }), h = fit({ floors: [solid.floor], pts: solid.pts, theta, phi, rMax: 20 });
  check("math: two floors span the view together; a courtyard is framed as the house round it",
    f && both && !one && g && h && near(g.r, h.r, 1e-6) && g.r > 20 / 4 + 1, { f, both, one, g, h });
});
await tryCase("math: bad numbers: nothing to frame, no view, NaN: null, at once", async () => {
  const t0 = Date.now(), { floor, pts } = floorOf(0, [box(0, 0, 4, 4)]);
  const a = fit({ floors: [floor], pts: [], theta: 0, phi: 1, rMax: 30 }), b = fit({ floors: [floor], pts, theta: 0, phi: 1, tanV: 0, rMax: 30 });
  const c = fit({ floors: [floor], pts, theta: NaN, phi: 1, rMax: 30 }), d = fit({ floors: [floor], pts: [[NaN, 0, 0]], theta: 0, phi: 1, rMax: 30 });
  check("math: bad numbers: nothing to frame, no view, NaN: null, at once",
    a === null && b === null && c === null && d === null && Date.now() - t0 < 1000, { a, b, c, d });
});

// ── the real view: a house of four rooms on the main floor, a loft over half ─
const rect = (floor_id, x0, y0, x1, y1) => ({ type: "poly", floor_id, points_m: [[x0, y0], [x1, y0], [x1, y1], [x0, y1]] });
const MODEL = {
  floors: [{ id: "main", name: "Main", level: 0 }, { id: "up", name: "Upstairs", level: 1 }],
  floor_elevations: { main: 0, up: 2.8 },
  room_geometry_m: { Kitchen: rect("main", 0, 0, 6, 4), Hall: rect("main", 6, 0, 12, 4), Den: rect("main", 0, 4, 6, 8), Office: rect("main", 6, 4, 12, 8),
                     Loft: rect("up", 0, 0, 6, 8) },
  light_positions_m: {
    "light.kitchen": { x_m: 0.4, y_m: 0.4, floor_id: "main" }, "light.hall": { x_m: 11.6, y_m: 1.5, floor_id: "main" },
    "light.den": { x_m: 1.5, y_m: 6.5, floor_id: "main" }, "light.office": { x_m: 10.5, y_m: 7.6, floor_id: "main" },
    "light.loft": { x_m: 3, y_m: 4, floor_id: "up" },
  },
  rf_barriers_m: [], scanner_positions_m: {}, scanners: {},
};
const LIGHT = (name) => ({ state: "on", attributes: { friendly_name: name, brightness: 200 } });
const BASE = { "light.kitchen": LIGHT("Kitchen"), "light.hall": LIGHT("Hall"), "light.den": LIGHT("Den"), "light.office": LIGHT("Office"), "light.loft": LIGHT("Loft") };
const ago = (min) => new Date(date0 - min * 60e3).toISOString();
const STATES = Object.fromEntries(Object.entries(BASE).map(([eid, s]) => [eid, { entity_id: eid, last_changed: ago(600), last_updated: ago(600), ...s }]));
const LBE = Object.fromEntries(LM.gatherLights(STATES, {}, {}, "pro", {}, {}, {}, {}, date0).map(l => [l.entity_id, l]));

const IDS = ["main", "up"], NAMES = ["Main", "Upstairs"];
const H = { top: "main", sent: [], went: [], mapOnly: true, kiosk: false };
const store = new Map([["explode", "0"]]);                   // every floor together: the home is the main floor
const prefs = { get: (k) => store.get(k) ?? null, set: (k, v) => store.set(k, String(v)) };
const host = document.createElement("padspan-lights-app");
const shadow = document.createElement("#shadow-root");
shadow.host = host;
document.body.appendChild(host);
host.appendChild(shadow);
const steps = () => ({ names: NAMES, zs: ["0", "1"], at: H.top === null ? 1 : IDS.indexOf(H.top), all: H.top === null,
  go: (i) => { H.top = i < 0 ? null : IDS[i]; poll(); } });
const P = () => ({ model: MODEL, floors: MODEL.floors, lightsByEid: LBE, hidden: new Set(), topFloorIds: H.top === null ? null : [H.top], quality: "low",
  telemetry: (name) => H.sent.push(name), onTouch: () => {}, states: STATES, config: {}, bearing: 0, saveNorth: null, useApi: () => null,
  haStartedMs: 0, load: async () => ({ data: { schema: 1, pieces: {}, lights: {}, openings: {}, devices: {}, figures: {} } }),
  edit: null, furnish: null, mapOnly: H.mapOnly, kiosk: H.kiosk, floorSteps: steps(), prefs,
  setTopFloor: (fid) => { H.top = fid; poll(); },
  people: null, tags: null, settings3d: { atlas_3d_enabled: true, atlas_3d_home_idle_s: 60 }, admin: true, saveSetting: async () => true,
  goTo: (where) => H.went.push(where) });
let slot = null;
function poll(){
  const c = document.createElement("div"), stage = document.createElement("div");
  c.appendChild(stage);
  const content = shadow.children.find(n => n.className === "content") || shadow.appendChild(Object.assign(document.createElement("div"), { className: "content" }));
  content.replaceChildren(c);
  return slot.attach(stage, P());
}
function inTree(n, top){ for (let x = n; x; x = x.parentNode) if (x === top) return true; return false; }
async function open(key){
  slot = LA.liveAboardSlot(key);
  poll();
  const el = slot.element;
  if (el && !el.getRootNode) el.getRootNode = () => (inTree(el, shadow) ? shadow : el);
  poll();
  await settle(30);
  return slot;
}
const S = () => slot._state();
const q = (sel) => slot.element.querySelector(sel);
const qa = (sel) => slot.element.querySelectorAll(sel);
const click = (b) => b && b.dispatchEvent({ type: "click", detail: 1, stopPropagation() {}, preventDefault() {}, composedPath: () => [b] });
const btnByText = (t) => qa("button").find(b => b.textContent === t) || null;
const menuBtns = () => { const m = q(".la3d-menu"); return m ? m.querySelectorAll("button") : []; };
/** Views ▾ opened: its Edgecut line ({on, role, text, title}), or null; the menu is closed again. */
async function viewsLine(){
  click(btnByText("Views ▾")); await settle();
  const b = menuBtns().find(x => x.hasAttribute("data-la3d-edgecut")) || null;
  const out = b ? { on: b.getAttribute("aria-checked") === "true", role: b.getAttribute("role"), text: b.textContent, title: b.title } : null;
  click(btnByText("Views ▾")); await settle();
  return out;
}
async function pickInViews(test){
  click(btnByText("Views ▾")); await settle();
  click(menuBtns().find(test)); await settle();
}
const flown = () => later(1000, 60);
const pref = (key) => JSON.parse(store.get(SHOW.prefKey(key)) || "{}");
const row = (key) => qa(".la3d-srow").find(r => r.getAttribute("data-show") === key) || null;
const ticked = (key) => { const r = row(key), t = r ? r.querySelector(".la3d-stick") : null; return t ? t.getAttribute("aria-checked") === "true" : null; };
const sameCam = (a, b) => near(a.radius, b.radius, 1e-6) && near(a.theta, b.theta, 1e-9) && near(a.phi, b.phi, 1e-9) && near(a.target, b.target, 1e-6);

// The sidebar's Atlas (mapOnly), the main floor chosen.
await open("edge-a");
await tryCase("off: a screen without it is framed as ever; Views ▾ lists it unticked", async () => {
  const s = S(), line = await viewsLine();
  check("off: a screen without it is framed as ever; Views ▾ lists it unticked",
    !s.edgecut.on && s.edgecut.at === null && near(s.cam.radius, s.screen.fitR, 1e-6) && line && line.on === false && line.role === "menuitemcheckbox"
    && line.text === "Edgecut" && /fill the screen/.test(line.title) && !("edgecut" in pref("edge-a")),
    { edgecut: s.edgecut, cam: s.cam, fitR: s.screen.fitR, line });
});
let framed = null;
await tryCase("views: Views ▾ → Edgecut ticks this screen's line, counted, and frames: rooms to every edge, nearer than the whole house, the angle kept", async () => {
  const was = S(), sent = H.sent.length;
  await pickInViews(b => b.hasAttribute("data-la3d-edgecut")); await flown();
  const s = S();
  framed = s;
  click(q("[data-la3d-more]")); await settle();
  const listed = ticked("edgecut");
  click(q(".la3d-sx")); await settle();
  const fill = filled(s.edgecut.floors, s.cam, 4 / 3), reach = reaches(s.edgecut.floors, s.cam, 4 / 3);
  const farther = reaches(s.edgecut.floors, { ...s.cam, radius: s.cam.radius * 1.03 }, 4 / 3);
  check("views: Views ▾ → Edgecut ticks this screen's line, counted, and frames: rooms to every edge, nearer than the whole house, the angle kept",
    pref("edge-a").edgecut === true && listed === true && H.sent.slice(sent).includes("house3d_show:show:edgecut") && s.edgecut.on && s.edgecut.holds
    && ((reach && !farther) || near(s.cam.radius, s.screen.fitR / 4, 1e-6)) && fill > filled(s.edgecut.floors, was.cam, 4 / 3) + 0.2
    && s.cam.radius < was.cam.radius * 0.9 && s.cam.radius >= s.screen.fitR / 4 - 1e-9
    && near(s.cam.theta, was.cam.theta, 1e-9) && near(s.cam.phi, was.cam.phi, 1e-9) && (await viewsLine()).on === true,
    { cam: s.cam, was: was.cam, fitR: s.screen.fitR, fill, farther, listed, pref: pref("edge-a") });
});
await tryCase("views: picked again it goes off, counted, back to the whole house at the same angle", async () => {
  const sent = H.sent.length;
  await pickInViews(b => b.hasAttribute("data-la3d-edgecut")); await flown();
  const s = S();
  check("views: picked again it goes off, counted, back to the whole house at the same angle",
    !("edgecut" in pref("edge-a")) && H.sent.slice(sent).includes("house3d_show:hide:edgecut") && !s.edgecut.on && s.edgecut.at === null
    && near(s.cam.radius, s.screen.fitR, 1e-3) && near(s.cam.theta, framed.cam.theta, 1e-9), { cam: s.cam, fitR: s.screen.fitR });
});
await tryCase("list: ticked in the ⋯ list it frames, and Views ▾ shows it ticked; unticked, the whole house", async () => {
  click(q("[data-la3d-more]")); await settle();
  click(row("edgecut").querySelector(".la3d-stick")); await settle(); await flown();
  const on = S(), line = await viewsLine();
  click(q("[data-la3d-more]")); await settle();
  click(row("edgecut").querySelector(".la3d-stick")); await settle(); await flown();
  const off = S();
  click(q(".la3d-sx")); await settle();
  check("list: ticked in the ⋯ list it frames, and Views ▾ shows it ticked; unticked, the whole house",
    on.edgecut.on && on.edgecut.holds && near(on.cam.radius, framed.cam.radius, 1e-6) && line.on === true
    && !off.edgecut.on && near(off.cam.radius, off.screen.fitR, 1e-3), { on: on.cam, line, off: off.cam });
});
await tryCase("other: the whole house or a saved view turns it off; an angle or Fit keeps it, framed from there", async () => {
  const on = async () => { await pickInViews(b => b.hasAttribute("data-la3d-edgecut")); await flown(); return S().edgecut.on; };
  const a = await on();
  await pickInViews(b => b.textContent === "Whole house"); await flown();
  const whole = S();
  store.set("views_edge-a", JSON.stringify([{ name: "Den corner", theta: 1, phi: 0.7, radius: 9, target: [2, 0, 6], floor: null }]));
  const b = await on();
  await pickInViews(x => x.textContent === "Den corner"); await flown();
  const saved = S();
  const c = await on();
  // The owner, 2026-11-24: moved, then Fit, and "it seems to completely forget it's in edgecut mode". An angle and Fit
  // keep it on: framed from the new angle; Fit is Edgecut's own frame.
  click(qa("button").find(x => x.textContent === "Top")); await settle(); await flown();
  const top = S();
  const cv = q("canvas");
  for (let i = 0; i < 3; i++) cv.dispatchEvent({ type: "wheel", clientX: 500, clientY: 300, deltaY: 160, deltaMode: 0, stopPropagation() {}, preventDefault() {} });
  await settle();
  const moved = S();
  click(qa("button").find(x => x.textContent === "Fit")); await settle(); await flown();
  const fit = S();
  store.delete("views_edge-a");
  await pickInViews(x => x.textContent === "Whole house"); await flown();   // off again, for the cases after
  check("other: the whole house or a saved view turns it off; an angle or Fit keeps it, framed from there",
    a && b && c && !whole.edgecut.on && whole.screen.floors.all && near(whole.cam.radius, whole.screen.fitR, 1e-3) && !saved.edgecut.on
    && near(saved.cam.radius, 9, 1e-6) && near(saved.cam.target, [2, 0, 6], 1e-6)
    && top.edgecut.on && top.edgecut.holds && top.cam.phi < 0.01 && top.cam.radius < top.screen.fitR * 0.95
    && !moved.edgecut.holds && fit.edgecut.on && fit.edgecut.holds && near(fit.cam.radius, top.cam.radius, 1e-3) && near(fit.cam.phi, top.cam.phi, 1e-9)
    && !S().edgecut.on && !("edgecut" in pref("edge-a")),
    { whole: whole.cam, saved: saved.cam, top: top.cam, moved: moved.cam, fit: fit.cam });
  steps().go(0); await settle();                               // the main floor again
});
await tryCase("top: straight down (the angle the person chose) it fills the view edge to edge, and a step farther it doesn't", async () => {
  click(qa("button").find(x => x.textContent === "Top")); await settle();
  await pickInViews(b => b.hasAttribute("data-la3d-edgecut")); await flown();
  const s = S(), fill = filled(s.edgecut.floors, s.cam, 4 / 3), farther = filled(s.edgecut.floors, { ...s.cam, radius: s.cam.radius * 1.03 }, 4 / 3);
  check("top: straight down (the angle the person chose) it fills the view edge to edge, and a step farther it doesn't",
    s.edgecut.on && s.cam.phi < 0.01 && fill === 1 && farther < 1 && s.cam.radius > s.screen.fitR / 4 && s.edgecut.floors.length === 1,
    { cam: s.cam, fill, farther, fitR: s.screen.fitR, floors: s.edgecut.floors });
});
await tryCase("always: a floor chosen frames it again; a new size at once", async () => {
  const main = S();                                            // straight down, framed (top:)
  steps().go(1); await settle(); await flown();                // the floor chips: Upstairs (the loft over the main floor)
  const up = S();
  steps().go(0); await settle(); await flown();
  const back = S();
  // The screen grows (a window made wider): at once, for the new shape.
  slot.element.clientWidth = 1000; q("canvas").clientWidth = 1000;
  poll(); await settle();
  const wide = S();
  check("always: a floor chosen frames it again; a new size at once",
    main.edgecut.holds && up.edgecut.holds && !near(up.edgecut.at.target, main.edgecut.at.target, 1e-3) && back.edgecut.holds && sameCam(back.cam, main.cam)
    && wide.edgecut.holds && !near(wide.cam.radius, main.cam.radius, 1e-3) && near(wide.cam.theta, main.cam.theta, 1e-9) && near(wide.cam.phi, main.cam.phi, 1e-9)
    && reaches(wide.edgecut.floors, wide.cam, 1000 / 600),
    { main: main.edgecut.at, up: up.edgecut.at, back: back.cam, wide: wide.cam });
});
await tryCase("hand: moved by hand it is left alone; the flight home after a minute is Edgecut again", async () => {
  const cv = q("canvas");
  slot.element.dispatchEvent({ type: "pointerdown", stopPropagation() {}, preventDefault() {} });
  for (let i = 0; i < 3; i++) cv.dispatchEvent({ type: "wheel", clientX: 500, clientY: 300, deltaY: 160, deltaMode: 0, stopPropagation() {}, preventDefault() {} });
  await settle();
  const hand = S();
  poll(); await later(3100, 30);
  slot.element.clientWidth = 900; q("canvas").clientWidth = 900;
  poll(); await settle();
  const left = S(), returns = left.panel.returns;
  await later(61000, 30); await flown();
  const home = S();
  check("hand: moved by hand it is left alone; the flight home after a minute is Edgecut again",
    hand.edgecut.on && !hand.edgecut.holds && sameCam(left.cam, hand.cam) && home.panel.returns === returns + 1 && home.edgecut.on && home.edgecut.holds
    && home.cam.radius < home.screen.fitR, { hand: hand.cam, left: left.cam, home: home.cam, fitR: home.screen.fitR, panel: home.panel });
});
await tryCase("rest: nothing moving, no frames", async () => {
  await later(4000, 30);
  check("rest: nothing moving, no frames", S().edgecut.holds && pendingFrames() === 0, { frames: pendingFrames() });
});
LA.releaseLiveAboardSlot("edge-a");

await tryCase("builder: Mapping's builder has no Edgecut, and a tick does nothing there", async () => {
  H.mapOnly = false;
  store.set(SHOW.prefKey("edge-b"), JSON.stringify({ edgecut: true }));
  await open("edge-b");
  const s = S(), line = await viewsLine();
  click(q("[data-la3d-more]")); await settle();
  const listed = !!row("edgecut");
  click(q(".la3d-sx")); await settle();
  check("builder: Mapping's builder has no Edgecut, and a tick does nothing there",
    !s.edgecut.on && line === null && !listed && near(s.cam.radius, s.screen.fitR, 1e-6), { edgecut: s.edgecut, line, listed });
  LA.releaseLiveAboardSlot("edge-b");
  H.mapOnly = true;
});
await tryCase("wall: a wall opens on it and goes nowhere", async () => {
  H.kiosk = true; H.went.length = 0;
  store.set(SHOW.prefKey("edge-c"), JSON.stringify({ edgecut: true }));
  await open("edge-c");
  const s = S();
  check("wall: a wall opens on it and goes nowhere",
    s.edgecut.on && s.edgecut.holds && s.cam.radius < s.screen.fitR && H.went.length === 0,
    { edgecut: s.edgecut, cam: s.cam, fitR: s.screen.fitR });
  LA.releaseLiveAboardSlot("edge-c");
  H.kiosk = false;
});

console.log(JSON.stringify({ cases, failures }));
