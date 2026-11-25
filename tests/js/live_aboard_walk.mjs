// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
//
// Walk-through in the 3D house (views/live_aboard_walk.js, inside
// views/live_aboard.js): its rules as numbers on a house read the way the
// view reads it, then the real view under the DOM shim with a stub GL.
//
//   num      walls stop you (sliding along them), a closed door stops you
//            and an open one doesn't, a window's sill and a railing stop
//            you, an open gap doesn't; a raised room is no step; straight
//            and L stairs carry you up to the floor above and back down;
//            the stair's opening upstairs is a drop from its side; the keys,
//            the stick and a drag; the camera at the eyes
//   start    just inside the front door, facing in; else the biggest room;
//            nothing drawn: nowhere
//   enter    Walk on the bar (View ▾ on a narrow screen): eye height, every
//            floor, none pulled apart, the walls up, the bars aside, counted
//   keys     W walks, ← turns, Shift hurries; held against a wall, it stays
//   door     a closed door stops you; opened by its sensor, you walk through
//   stairs   up the stairs to the floor above, and down again
//   stick    on a touch screen the stick shows and walks; a drag looks
//   tablet   from the front door to the room upstairs with the stick and a
//            drag only; on a PC with the keys only
//   stop     Stop walking (or Esc) puts back the camera, the floors pulled
//            apart and the walls as they were
//   rest     standing still, no frame is drawn
//
// usage: live_aboard_walk.mjs <www/padspan-ha dir>
// prints one JSON line: { cases: {name: result}, failures: [...] }

import { pathToFileURL } from "node:url";
import { join } from "node:path";
import * as shim from "./dom_shim.mjs";
import { installStubGL } from "./stub_gl.mjs";

const WWW = process.argv[2];
if (!WWW) { console.error("usage: live_aboard_walk.mjs <www/padspan-ha dir>"); process.exit(2); }
const url = (p) => pathToFileURL(join(WWW, p)).href;
const WK = await import(url("views/live_aboard_walk.js"));
const H = await import(url("views/live_aboard_house.js"));
const S = await import(url("views/live_aboard_storey.js"));
const FU = await import(url("views/live_aboard_furniture.js"));
const PI = await import(url("views/live_aboard_pieces.js"));

const failures = [];
const cases = {};
const check = (name, ok, detail) => { cases[name] = !!ok; if (!ok) failures.push({ name, detail: detail === undefined ? null : detail }); };
const tryCase = async (name, fn) => {
  try { await fn(); } catch (e) { failures.push({ name, detail: String(e && e.stack || e).slice(0, 900) }); cases[name] = false; }
};
const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;
const rect = (floor_id, x0, y0, x1, y1) => ({ type: "poly", floor_id, points_m: [[x0, y0], [x1, y0], [x1, y1], [x0, y1]] });

// ── a house read the way the view reads it (buildShell), as numbers ─────────
/** {floors (walkWorld's), world}: the model's walls as the view draws them; open: {barrier id: 0…1 open}. */
function houseOf(model, pieces = {}, open = {}){
  const h = H.readHouse(model, model.floors, {}, new Set(), {});
  const cuts = S.stairCuts(pieces, h.floors, h.canon);
  const floors = h.floors.map(fl => {
    const per = h.perFloor.get(fl) || { rooms: [], pieces: [] };
    return { id: fl.id, elev: fl.elev, outdoor: !!fl.outdoor, rooms: per.rooms, holes: cuts.get(fl.id) || [],
             pieces: per.pieces.map(pc => ({ pc, els: H.wallElements(pc, fl.h), open: pc.barrier && pc.barrier.id in open ? { at: open[pc.barrier.id] } : undefined })) };
  });
  const stairs = Object.values(pieces).filter(S.isStairs).map(p => {
    const r = S.stairReach(h.canon(p.floor_id), p.recipe.params && p.recipe.params.to_floor, h.floors, S.footprint(p));
    const rec = { ...p.recipe, height_m: r.rise }, sz = PI.sizeOf(rec), L = FU.stairFlights(sz, rec.params || {});
    const F = h.floors.find(f => f.id === h.canon(p.floor_id));
    return { x: p.x_m, y: p.y_m, rot: p.rotation, base: F.elev, from: F.id, w: sz.w, d: sz.d, boxes: [...L.steps, ...L.landings] };
  });
  return { floors, world: WK.walkWorld(floors, stairs, { ground: h.ground - H.SLAB_T }) };
}
/** Walk w with input inp for ms milliseconds, in 16 ms frames; stop early once until(w) says so. */
function walkFor(world, w, inp, ms, until = null){
  for (let t = 0; t < ms; t += 16) { WK.walkStep(world, w, inp, 0.016); if (until && until(w)) break; }
  return w;
}
const FWD = { fwd: 1, side: 0, turn: 0 };
const yawFacing = (dx, dy) => Math.atan2(-dx, -dy);           // forwardOf(yaw) = (dx, dy)

const ROOMS = { floors: [{ id: "main", name: "Main" }, { id: "up", name: "Up" }], floor_elevations: { main: 0, up: 2.8 },
  room_geometry_m: { Living: rect("main", 0, 0, 5, 4), Den: rect("main", 5, 0, 9, 4), Loft: rect("up", 0, 0, 5, 4) },
  rf_barriers_m: [
    { id: "b_den", name: "Den door", material: "wood", floor_id: "main", points_m: [[5, 1], [5, 1.9]] },
    { id: "b_front", name: "Front door", material: "wood", floor_id: "main", points_m: [[3.6, 4], [4.5, 4]] },
    { id: "b_back", name: "Back door", material: "wood", floor_id: "main", points_m: [[8, 4], [8.9, 4]] },
    { id: "b_win", name: "Den window", material: "glass", floor_id: "main", points_m: [[9, 1], [9, 3]] },
    { id: "b_gap", name: "", material: "open", floor_id: "main", points_m: [[5, 2.6], [5, 3.6]] },
  ] };
const STAIRS = { id: "fur_5a1e0001", recipe: { kind: "stairs", params: { shape: "straight", to_floor: "up" }, width_m: 1, depth_m: 3, height_m: 2.8 },
  floor_id: "main", x_m: 2.5, y_m: 2, z_m: 0, rotation: 0 };

// ── num ─────────────────────────────────────────────────────────────────────
await tryCase("num: a wall stops you a body's width from its face (an outside wall stands outside the room), and you slide along it", async () => {
  const { world } = houseOf(ROOMS);
  const w = WK.walker({ x: 1, y: 1, foot: 0, yaw: yawFacing(0, -1), floor: "main" });
  walkFor(world, w, FWD, 3000);
  const stopped = w.y;
  // Turned 45° into the same wall: it slides along it, westward.
  w.yaw = yawFacing(-1, -1);
  const x0 = w.x;
  walkFor(world, w, FWD, 400);
  check("num: a wall stops you a body's width from its face (an outside wall stands outside the room), and you slide along it",
    near(stopped, WK.BODY_R, 0.02) && w.x < x0 - 0.2 && near(w.y, stopped, 0.02) && w.floor === "main", { stopped, x0, w });
});
await tryCase("num: a closed door stops you, a half-open one too; open, you walk through to the next room", async () => {
  const run = (at) => { const { world } = houseOf(ROOMS, {}, { b_den: at }); const w = WK.walker({ x: 4, y: 1.45, foot: 0, yaw: yawFacing(1, 0), floor: "main" });
    return walkFor(world, w, FWD, 2500); };
  const shut = run(0), half = run(0.3), open = run(1);
  check("num: a closed door stops you, a half-open one too; open, you walk through to the next room",
    shut.x < 5 - WK.BODY_R + 0.01 && half.x < 5 - WK.BODY_R + 0.01 && open.x > 6.5 && open.floor === "main", { shut, half, open });
});
await tryCase("num: a window's sill stops you; an open gap in a wall doesn't", async () => {
  const { world } = houseOf(ROOMS);
  const win = walkFor(world, WK.walker({ x: 8, y: 2, foot: 0, yaw: yawFacing(1, 0), floor: "main" }), FWD, 2500);
  const gap = walkFor(world, WK.walker({ x: 4, y: 3.1, foot: 0, yaw: yawFacing(1, 0), floor: "main" }), FWD, 2500);
  check("num: a window's sill stops you; an open gap in a wall doesn't", win.x < 9 - WK.BODY_R + 0.01 && gap.x > 6.5, { win, gap });
});
await tryCase("num: out through an open outside door you step down onto the ground; a closed one keeps you in", async () => {
  const out = walkFor(houseOf(ROOMS, {}, { b_front: 1 }).world, WK.walker({ x: 4.05, y: 3, foot: 0, yaw: yawFacing(0, 1), floor: "main" }), FWD, 2500);
  const kept = walkFor(houseOf(ROOMS, {}, { b_front: 0 }).world, WK.walker({ x: 4.05, y: 3, foot: 0, yaw: yawFacing(0, 1), floor: "main" }), FWD, 2500);
  check("num: out through an open outside door you step down onto the ground; a closed one keeps you in",
    out.y > 5 && near(out.foot, -H.SLAB_T, 1e-6) && kept.y < 4 - WK.BODY_R + 0.01 && kept.foot === 0, { out, kept });
});
await tryCase("num: straight stairs carry you up to the floor above and back down", async () => {
  const { world } = houseOf(ROOMS, { [STAIRS.id]: STAIRS });
  const w = WK.walker({ x: 2.5, y: 3.7, foot: 0, yaw: yawFacing(0, -1), floor: "main" });
  const climb = [];
  walkFor(world, w, FWD, 6000, (q) => { climb.push(q.foot); return false; });
  const up = { ...w };
  w.yaw = yawFacing(0, 1);
  walkFor(world, w, FWD, 6000);
  const steps = climb.every((f, i) => i === 0 || f >= climb[i - 1] - 1e-9 && f - climb[i - 1] <= WK.STEP_M);
  check("num: straight stairs carry you up to the floor above and back down",
    up.floor === "up" && near(up.foot, 2.8, 1e-6) && up.y < 0.5 && steps && w.floor === "main" && w.foot === 0 && w.y > 3.5, { up, w, top: climb.slice(-3) });
});
await tryCase("num: L stairs with a landing carry you up too", async () => {
  const L = { ...STAIRS, recipe: { ...STAIRS.recipe, params: { shape: "l", turn: "left", to_floor: "up" }, width_m: 2, depth_m: 3 }, x_m: 2.5, y_m: 2 };
  const { world } = houseOf(ROOMS, { [L.id]: L });
  // Up the right side (+x), then along the back to the left: forward, then turn left.
  const w = WK.walker({ x: 3, y: 3.7, foot: 0, yaw: yawFacing(0, -1), floor: "main" });
  walkFor(world, w, FWD, 4000, (q) => q.y < 1.1);
  const landing = w.foot;
  w.yaw = yawFacing(-1, 0);
  walkFor(world, w, FWD, 4000, (q) => q.floor === "up" && q.x < 1);
  check("num: L stairs with a landing carry you up too", landing > 0.8 && landing < 2 && w.floor === "up" && near(w.foot, 2.8, 1e-6), { landing, w });
});
await tryCase("num: upstairs, the stairs' opening is a drop from its side: you stop at its edge", async () => {
  const { world } = houseOf(ROOMS, { [STAIRS.id]: STAIRS });
  const w = WK.walker({ x: 4.5, y: 2, foot: 2.8, yaw: yawFacing(-1, 0), floor: "up" });
  walkFor(world, w, FWD, 3000);
  check("num: upstairs, the stairs' opening is a drop from its side: you stop at its edge", w.x > 3 - 0.01 && w.floor === "up" && w.foot === 2.8, w);
});
await tryCase("num: the side of a flight is no step from the floor", async () => {
  const { world } = houseOf(ROOMS, { [STAIRS.id]: STAIRS });
  const w = WK.walker({ x: 0.8, y: 1.5, foot: 0, yaw: yawFacing(1, 0), floor: "main" });
  walkFor(world, w, FWD, 3000);
  check("num: the side of a flight is no step from the floor", w.x <= 2 && w.foot === 0, w);
});
await tryCase("num: a room raised 0.75 m above its floor is no step", async () => {
  const model = { floors: [{ id: "main", name: "Main" }, { id: "dais", name: "Dais", parent_id: "main" }], floor_elevations: { main: 0, dais: 0.75 },
    room_geometry_m: { Hall: rect("main", 0, 0, 4, 4), Stage: rect("dais", 4, 0, 8, 4) },
    rf_barriers_m: [{ id: "b_o", name: "", material: "open", floor_id: "main", points_m: [[4, 0.5], [4, 3.5]] }] };
  const { world } = houseOf(model);
  const w = walkFor(world, WK.walker({ x: 2, y: 2, foot: 0, yaw: yawFacing(1, 0), floor: "main" }), FWD, 3000);
  check("num: a room raised 0.75 m above its floor is no step", w.x < 4.3 && w.foot === 0, w);
});
await tryCase("num: the keys, the stick and a drag", async () => {
  const k = WK.keysInput(new Set(["KeyW", "KeyD", "ArrowLeft"]), true), back = WK.keysInput(new Set(["ArrowDown", "KeyA", "ArrowRight", "KeyQ"]));
  const both = WK.keysInput(new Set(["KeyW", "ArrowUp"]));
  const dead = WK.stickInput(5, -5, 60), full = WK.stickInput(0, -200, 60), half = WK.stickInput(30, 0, 60);
  const w = WK.walker({ x: 0, y: 0, foot: 0, yaw: 0 });
  WK.lookBy(w, 100, 0, 600);
  const yaw = w.yaw;
  WK.lookBy(w, 0, -100000, 600);
  check("num: the keys, the stick and a drag",
    k.fwd === 1 && k.side === 1 && k.turn === 1 && k.hurry && back.fwd === -1 && back.side === -1 && back.turn === -1 && !back.hurry && both.fwd === 1
    && WK.isWalkKey("KeyW") && !WK.isWalkKey("KeyQ") && dead.fwd === 0 && dead.side === 0 && near(full.fwd, 1) && near(full.side, 0)
    && half.side > 0.3 && half.side < 0.5 && near(yaw, 100 * WK.LOOK_PER_H / 600) && near(w.pitch, -WK.PITCH_MAX),
    { k, back, dead, full, half, yaw, w });
});
await tryCase("num: the camera sits at the eyes and looks where the walker does", async () => {
  const w = WK.walker({ x: 3, y: 2, foot: 2.8, yaw: 0.7 });
  w.pitch = 0.3;
  const c = WK.camOf(w), s = Math.sin(c.phi);
  // live_aboard.js applyCam: the camera at target + radius·(sinφ sinθ, cosφ, sinφ cosθ).
  const pos = [c.target[0] + c.radius * s * Math.sin(c.theta), c.target[1] + c.radius * Math.cos(c.phi), c.target[2] + c.radius * s * Math.cos(c.theta)];
  const f = WK.forwardOf(0.7);
  check("num: the camera sits at the eyes and looks where the walker does",
    pos.every((v, i) => near(v, [3, 2.8 + WK.EYE_M, 2][i], 1e-9)) && c.target[1] > pos[1] && (c.target[0] - pos[0]) * f[0] + (c.target[2] - pos[2]) * f[1] > 0,
    { c, pos });
});

// ── start ───────────────────────────────────────────────────────────────────
await tryCase("start: just inside the front door, facing in, on the main floor over a basement; else the biggest room; nothing drawn: nowhere", async () => {
  const { floors, world } = houseOf(ROOMS);
  const s = WK.startSpot(world, floors, null, 0);
  const f = WK.forwardOf(s.yaw);
  // No door: the biggest room, the Living room (20 m²) over the Den (16 m²).
  const noDoor = { ...ROOMS, rf_barriers_m: [] }, nd = houseOf(noDoor), s2 = WK.startSpot(nd.world, nd.floors, null, 1.2);
  const pref = WK.startSpot(world, floors, { floor: "main", x: 7, y: 2 }, 0.5);
  const none = WK.startSpot(WK.walkWorld([], []), [], null, 0);
  // A basement under it: the main floor's front door still (the floor at 0 m first), and with no door the main floor's biggest room.
  const base = { ...ROOMS, floors: [{ id: "base", name: "Basement" }, ...ROOMS.floors], floor_elevations: { ...ROOMS.floor_elevations, base: -2.7 },
                 room_geometry_m: { ...ROOMS.room_geometry_m, Rec: rect("base", 0, 0, 12, 10) } };
  const bh = houseOf(base), sb = WK.startSpot(bh.world, bh.floors, null, 0);
  const bnd = houseOf({ ...base, rf_barriers_m: [] }), sbn = WK.startSpot(bnd.world, bnd.floors, null, 0);
  check("start: just inside the front door, facing in, on the main floor over a basement; else the biggest room; nothing drawn: nowhere",
    s && s.floor === "main" && near(s.x, 4.05, 1e-6) && s.y > 3 && s.y < 3.5 && near(f[1], -1, 1e-9)
    && s2 && s2.floor === "main" && s2.x > 0 && s2.x < 5 && s2.yaw === 1.2 && pref && near(pref.x, 7) && near(pref.y, 2) && none === null
    && sb && sb.floor === "main" && near(sb.x, 4.05, 1e-6) && sbn && sbn.floor === "main" && sbn.x < 5,
    { s, s2, pref, none, sb, sbn });
});

// ── the view ────────────────────────────────────────────────────────────────
shim.install();
{
  const NP = globalThis.Node.prototype, ap = NP.appendChild, ib = NP.insertBefore, rc = NP.removeChild;
  const leave = (c) => { const p = c && c.parentNode; if (p && p.children) { const i = p.children.indexOf(c); if (i >= 0) p.children.splice(i, 1); } };
  NP.appendChild = function(c){ leave(c); return ap.call(this, c); };
  NP.insertBefore = function(c, ref){ leave(c); return ib.call(this, c, ref); };
  NP.removeChild = function(c){ const r = rc.call(this, c); if (c && c.parentNode === this) c.parentNode = null; return r; };
}
const lists = { window: {}, document: {} };
const listen = (key) => ({ add: (t, fn) => { (lists[key][t] ||= []).push(fn); }, remove: (t, fn) => { lists[key][t] = (lists[key][t] || []).filter(f => f !== fn); } });
const Wn = listen("window"), Dc = listen("document");
globalThis.addEventListener = Wn.add; globalThis.removeEventListener = Wn.remove;
document.addEventListener = Dc.add; document.removeEventListener = Dc.remove;
installStubGL();
// The frames' clock is this harness's own: each frame is 16 ms, and it moves between frames only when a case moves it.
let clockOff = 0;
const clockAt = performance.now();
performance.now = () => clockAt + clockOff;
const shimRaf = globalThis.requestAnimationFrame;
let frameClock = false;                                       // on: each frame drawn is 16 ms after the last
globalThis.requestAnimationFrame = (fn) => shimRaf(() => { if (frameClock) clockOff += 16; return fn(performance.now()); });
const pendingFrames = () => shim.rafQueue.filter(Boolean).length;
const settle = async (rounds = 12) => { await shim.flush(rounds); await new Promise(r => globalThis._realSetTimeout(r, 0)); };
async function later(ms, rounds = 8){ clockOff += ms; await settle(rounds); }
/** ms of frames, one at a time (each 16 ms on the clock); stop early once until() says so. */
async function frames(ms, until = null){
  frameClock = true;
  try {
    for (let t = 0; t < ms; t += 16) { await shim.flush(1); if (until && until()) break; if (!pendingFrames()) clockOff += 16; }
  } finally { frameClock = false; }
}

const LA = await import(url("views/live_aboard.js"));
const MODEL = { ...ROOMS, rf_barriers_m: ROOMS.rf_barriers_m.map(b => (b.id === "b_den" ? { ...b, linked_entity_id: "binary_sensor.den_door" }
  : b.id === "b_front" ? { ...b, linked_entity_id: "binary_sensor.front_door" } : b)) };
const sensor = (eid, name, state) => ({ entity_id: eid, friendly_name: name, state, device_class: "door" });
const H2 = { den: "off", front: "off", top: null, sent: [], mapOnly: true };
const LBE = () => ({ "binary_sensor.den_door": sensor("binary_sensor.den_door", "Den door", H2.den),
                     "binary_sensor.front_door": sensor("binary_sensor.front_door", "Front door", H2.front) });
const FILE = { schema: 1, pieces: { [STAIRS.id]: { ...STAIRS, recipe: { ...STAIRS.recipe, colors: ["#8b6a4f", "#e8e2d6", "#3d3a36"] }, origin: "build", label: "",
  library_id: null, submission_id: null, entity_id: null, entity_reg_id: null } }, lights: {}, devices: {}, figures: {}, openings: {} };
const store = new Map();
const prefs = { get: (k) => store.get(k) ?? null, set: (k, v) => store.set(k, String(v)) };
const IDS = ["main", "up"];
const steps = () => ({ names: ["Main", "Up"], zs: ["0", "1"], at: H2.top === null ? 1 : IDS.indexOf(H2.top), all: H2.top === null,
  go: (i) => { H2.top = i < 0 ? null : IDS[i]; poll(); } });
const api = { toast(){}, toggle(){}, openRoom(){}, openFloor(){}, openControls(){}, openActivity(){}, controlsFor: () => null, lightsByEid: {}, hass: null };
const P = () => ({ model: MODEL, floors: MODEL.floors, lightsByEid: LBE(), hidden: new Set(), topFloorIds: H2.top === null ? null : [H2.top], quality: "low",
  telemetry: (name) => H2.sent.push(name), onTouch: () => {}, states: {}, config: {}, bearing: 0, saveNorth: null, useApi: () => api, haStartedMs: 0,
  load: async () => ({ data: JSON.parse(JSON.stringify(FILE)) }), edit: null, furnish: null, mapOnly: H2.mapOnly, kiosk: false, floorSteps: steps(), prefs,
  setTopFloor: (fid) => { H2.top = fid; poll(); }, people: null, tags: null, settings3d: { atlas_3d_enabled: true, atlas_3d_home_idle_s: 60 }, admin: true,
  saveSetting: async () => true, goTo: () => {} });
let slot = null;
function poll(){ const c = document.createElement("div"), stage = document.createElement("div"); c.appendChild(stage); document.body.replaceChildren(c); return slot.attach(stage, P()); }
const st = () => slot._state();
const q = (sel) => slot.element.querySelector(sel);
const qa = (sel) => slot.element.querySelectorAll(sel);
const ev = (type, o = {}) => ({ type, stopPropagation() {}, preventDefault() {}, ...o });
const click = (b) => b && b.dispatchEvent(ev("click", { detail: 1 }));
const key = (code, down = true, o = {}) => slot.element.dispatchEvent(ev(down ? "keydown" : "keyup", { code, key: code, target: q("canvas"), ...o }));
const sent = (name) => H2.sent.filter(n => n === name).length;
const camPos = () => { const c = st().cam, s = Math.sin(c.phi);
  return [c.target[0] + c.radius * s * Math.sin(c.theta), c.target[1] + c.radius * Math.cos(c.phi), c.target[2] + c.radius * s * Math.cos(c.theta)]; };
const W = () => st().walk.walker;

slot = LA.liveAboardSlot("walk-a");
poll(); poll();
await later(10000, 60);                                       // the file read, the quality check, then rest
const orbit0 = st();

await tryCase("enter: Walk on the bar and in View ▾; eye height inside the front door, every floor, none pulled apart, walls up, bars aside, counted", async () => {
  const btn = q("[data-la3d-walk]");
  const b = btn && btn.querySelector("button");
  click(q("[data-la3d-view]").querySelector("button")); await settle();
  const inView = !!(q(".la3d-menu") && q(".la3d-menu").querySelectorAll("button").find(x => x.hasAttribute("data-la3d-walk") && x.textContent === "Walk"));
  click(q("[data-la3d-view]").querySelector("button")); await settle();
  const before = st();
  click(b); await settle(); await later(50, 20);
  const s = st(), pos = camPos();
  check("enter: Walk on the bar and in View ▾; eye height inside the front door, every floor, none pulled apart, walls up, bars aside, counted",
    !!b && b.textContent === "Walk" && inView && before.levels.explode > 0 && !before.walk
    && s.walk.on && s.walk.fov === WK.FOV_DEG && near(W().x, 4.05, 1e-6) && W().y > 3 && W().y < 3.5 && W().floor === "main"
    && near(pos[0], W().x, 1e-6) && near(pos[1], WK.EYE_M, 1e-6) && near(pos[2], W().y, 1e-6)
    && s.levels.explode === 0 && s.topElev === null && slot.element.classList.contains("la3d-walking")
    && s.show.walls.length >= 0 && s.ghost.length >= 0 && sent("house3d_walk:start") === 1
    && !!q("[data-la3d-walkstop]") && /W A S D/.test(s.walk.tip) && !s.walk.stickShown && near(s.walk.saved.radius, before.cam.radius, 1e-9),
    { walk: s.walk, explode: [before.levels.explode, s.levels.explode], topElev: s.topElev, pos, inView, sent: H2.sent });
});
await tryCase("enter: every wall stands while walking (none cut away)", async () => {
  const s = st();
  check("enter: every wall stands while walking (none cut away)", s.walls > 0 && s.wallMode === orbit0.wallMode, { walls: s.walls, mode: s.wallMode });
});
await tryCase("rest: standing still, no frame is drawn", async () => {
  await later(3000, 30);
  const f0 = st().frames;
  await later(3000, 30);
  check("rest: standing still, no frame is drawn", pendingFrames() === 0 && st().frames === f0, { pending: pendingFrames(), f0, f1: st().frames });
});
await tryCase("keys: W walks forward while held, frames only then; ← turns; Shift hurries; counted once", async () => {
  const y0 = W().y, f0 = st().frames;
  key("KeyW"); await frames(1000); key("KeyW", false);
  await settle(20);
  const walked = y0 - W().y, f1 = st().frames;
  await later(2000, 20);
  const restFrames = st().frames - f1;
  const yaw0 = W().yaw;
  key("ArrowLeft"); await frames(500); key("ArrowLeft", false); await settle(20);
  const turned = W().yaw - yaw0;
  const y1 = W().y;
  key("ArrowRight"); await frames(500); key("ArrowRight", false); await settle(20);
  key("KeyW", true, { shiftKey: true }); await frames(300); key("KeyW", false); await settle(20);
  const hurried = y1 - W().y;
  check("keys: W walks forward while held, frames only then; ← turns; Shift hurries; counted once",
    walked > 1.0 && walked < 1.6 && near(W().x, 4.05, 1e-3) && f1 - f0 > 30 && restFrames === 0 && pendingFrames() === 0
    && turned > 0.6 && turned < 1.0 && hurried > 0.6 && sent("house3d_walk:keys") === 1,
    { walked, frames: f1 - f0, restFrames, turned, hurried, w: W() });
});
await tryCase("keys: held against a wall it stays there, a body's width off it", async () => {
  key("KeyW"); await frames(3000); key("KeyW", false); await settle(20);
  check("keys: held against a wall it stays there, a body's width off it", near(W().y, WK.BODY_R, 0.02) && W().floor === "main", W());
});
await tryCase("door: the Den's door, closed, stops you; its sensor opens it and you walk through", async () => {
  slot._walk().place(4, 1.45, 0, yawFacing(1, 0));
  key("KeyD"); await frames(10); key("KeyD", false);           // (a key or two: the walker's own clock)
  key("KeyW"); await frames(2500); key("KeyW", false); await settle(20);
  const shut = W().x;
  H2.den = "on"; poll(); await settle(10);
  frameClock = true; await later(1500, 60); frameClock = false;   // the door swings open on its own clock
  const door = st().openings.find(o => o.eid === "binary_sensor.den_door");
  key("KeyW"); await frames(2500); key("KeyW", false); await settle(20);
  check("door: the Den's door, closed, stops you; its sensor opens it and you walk through",
    shut < 5 - WK.BODY_R + 0.01 && door && door.state === "open" && door.at === 1 && W().x > 6.5 && W().floor === "main", { shut, door, w: W() });
});
await tryCase("stairs: up the stairs to the floor above, and down again, counted once", async () => {
  slot._walk().place(2.5, 3.7, 0, yawFacing(0, -1));
  key("KeyW"); await frames(6000, () => W().floor === "up" && W().y < 0.5); key("KeyW", false); await frames(600);   // the eyes settle on the top step
  const up = { ...W() }, pos = camPos(), still = pendingFrames();
  slot._walk().place(2.5, 0.35, 2.8, yawFacing(0, 1));
  key("KeyW"); await frames(6000, () => W().floor === "main" && W().y > 3.6); key("KeyW", false); await frames(600);
  check("stairs: up the stairs to the floor above, and down again, counted once",
    up.floor === "up" && near(up.foot, 2.8, 1e-6) && near(pos[1], 2.8 + WK.EYE_M, 1e-6) && still === 0 && W().floor === "main" && W().foot === 0
    && sent("house3d_walk:stairs") === 1, { up, pos, w: W() });
});
await tryCase("stick: a touch on the view shows the stick; pushed up it walks forward; let go, it stops and draws nothing", async () => {
  slot._walk().place(1, 3, 0, yawFacing(0, -1));
  const cv = q("canvas");
  cv.dispatchEvent(ev("pointerdown", { pointerId: 7, pointerType: "touch", clientX: 300, clientY: 300, button: 0 }));
  cv.dispatchEvent(ev("pointerup", { pointerId: 7, pointerType: "touch", clientX: 300, clientY: 300 }));
  const shown = st().walk.stickShown, tip = st().walk.tip;
  const stick = q("[data-la3d-walkstick]"), y0 = W().y;
  stick.dispatchEvent(ev("pointerdown", { pointerId: 8, pointerType: "touch", clientX: 400, clientY: 300 }));
  stick.dispatchEvent(ev("pointermove", { pointerId: 8, pointerType: "touch", clientX: 400, clientY: -100 }));
  await frames(1000);
  stick.dispatchEvent(ev("pointerup", { pointerId: 8, pointerType: "touch", clientX: 400, clientY: -100 }));
  await settle(20);
  const walked = y0 - W().y, f1 = st().frames;
  await later(2000, 20);
  check("stick: a touch on the view shows the stick; pushed up it walks forward; let go, it stops and draws nothing",
    shown && /Stick/.test(tip) && walked > 1 && near(W().x, 1, 1e-3) && st().frames === f1 && pendingFrames() === 0 && sent("house3d_walk:stick") === 1
    && st().walk.stick.fwd === 0, { shown, tip, walked, w: W() });
});
await tryCase("stick: a drag on the view looks round (the house follows the finger), counted", async () => {
  const cv = q("canvas"), yaw0 = W().yaw;
  cv.dispatchEvent(ev("pointerdown", { pointerId: 9, pointerType: "mouse", clientX: 400, clientY: 300, button: 0 }));
  cv.dispatchEvent(ev("pointermove", { pointerId: 9, pointerType: "mouse", clientX: 500, clientY: 250 }));
  cv.dispatchEvent(ev("pointerup", { pointerId: 9, pointerType: "mouse", clientX: 500, clientY: 250 }));
  await settle(10);
  const s = st();
  check("stick: a drag on the view looks round (the house follows the finger), counted",
    near(W().yaw - yaw0, 100 * WK.LOOK_PER_H / 600, 1e-9) && W().pitch < 0 && near(s.cam.theta, W().yaw, 1e-9) && near(s.cam.phi, Math.PI / 2 + W().pitch, 1e-9)
    && sent("house3d_walk:drag") === 1 && !s.walk.looking, { w: W(), cam: s.cam });
});
await tryCase("stop: Stop walking puts back the camera, the floors pulled apart and the walls as they were; no frames after", async () => {
  click(q("[data-la3d-walkstop]")); await settle(20); await later(1000, 20);
  const s = st();
  check("stop: Stop walking puts back the camera, the floors pulled apart and the walls as they were; no frames after",
    !s.walk.on && s.walk.fov === 40
    && near(s.cam.theta, orbit0.cam.theta, 1e-9) && near(s.cam.phi, orbit0.cam.phi, 1e-9) && near(s.cam.radius, orbit0.cam.radius, 1e-9)
    && s.cam.target.every((v, i) => near(v, orbit0.cam.target[i], 1e-9)) && s.levels.explode === orbit0.levels.explode && s.wallMode === orbit0.wallMode
    && !slot.element.classList.contains("la3d-walking") && pendingFrames() === 0, { cam: s.cam, was: orbit0.cam, explode: s.levels.explode, walk: s.walk });
});
await tryCase("stop: Esc stops walking too", async () => {
  click(q("[data-la3d-walk]").querySelector("button")); await settle(20);
  const on = st().walk.on;
  key("Escape"); await settle(20);
  check("stop: Esc stops walking too", on && !st().walk.on && near(st().cam.radius, orbit0.cam.radius, 1e-9), st().walk);
});
await tryCase("tablet: from the front door to the room upstairs with the stick and a drag only", async () => {
  H2.den = "off"; poll(); await settle(10);
  navigator.maxTouchPoints = 5;                                // a tablet: the stick shows at once
  click(q("[data-la3d-walk]").querySelector("button")); await settle(20);
  const start = { ...W() }, shown = st().walk.stickShown;
  const stick = q("[data-la3d-walkstick]");
  const push = async (dx, dy, until) => {
    stick.dispatchEvent(ev("pointerdown", { pointerId: 11, pointerType: "touch", clientX: 400, clientY: 300 }));
    stick.dispatchEvent(ev("pointermove", { pointerId: 11, pointerType: "touch", clientX: 400 + dx, clientY: 300 + dy }));
    await frames(8000, until);
    stick.dispatchEvent(ev("pointerup", { pointerId: 11, pointerType: "touch", clientX: 400 + dx, clientY: 300 + dy }));
    await settle(10);
  };
  // Step left along the front wall to the foot of the stairs, then straight up them.
  await push(-400, 0, () => W().x <= 2.6);
  const foot = { ...W() };
  await push(0, -400, () => W().floor === "up" && W().y < 0.45);
  const up = { ...W() };
  // At the top, a drag turns round to look over the Loft; the stick walks into it.
  const cv = q("canvas");
  cv.dispatchEvent(ev("pointerdown", { pointerId: 12, pointerType: "touch", clientX: 300, clientY: 300 }));
  cv.dispatchEvent(ev("pointermove", { pointerId: 12, pointerType: "touch", clientX: 300 - Math.round(Math.PI / 2 * 600 / WK.LOOK_PER_H), clientY: 300 }));
  cv.dispatchEvent(ev("pointerup", { pointerId: 12, pointerType: "touch", clientX: 0, clientY: 300 }));
  await push(0, -400, () => W().x > 4);
  check("tablet: from the front door to the room upstairs with the stick and a drag only",
    shown && near(start.x, 4.05, 1e-6) && foot.x <= 2.6 && foot.x > 2 && up.floor === "up" && near(up.foot, 2.8, 1e-6)
    && W().floor === "up" && W().x > 4 && near(W().foot, 2.8, 1e-6), { start, foot, up, w: W() });
  key("Escape"); await settle(20);
  navigator.maxTouchPoints = 0;
});
await tryCase("tablet: on a PC, the same with the keys only (A to step aside, W up the stairs)", async () => {
  click(q("[data-la3d-walk]").querySelector("button")); await settle(20);
  key("KeyA"); await frames(8000, () => W().x <= 2.6); key("KeyA", false); await settle(10);
  key("KeyW"); await frames(8000, () => W().floor === "up" && W().y < 0.45); key("KeyW", false); await settle(10);
  check("tablet: on a PC, the same with the keys only (A to step aside, W up the stairs)", W().floor === "up" && near(W().foot, 2.8, 1e-6) && !st().walk.stickShown, W());
  key("Escape"); await settle(20);
});
await tryCase("rest: back in orbit, nothing moving: no frames", async () => {
  await later(4000, 30);
  check("rest: back in orbit, nothing moving: no frames", pendingFrames() === 0 && !st().walk.on && !st().failed, { pending: pendingFrames(), failed: st().failed });
});
LA.releaseLiveAboardSlot("walk-a");

process.stdout.write(JSON.stringify({ cases, failures }) + "\n", () => process.exit(0));   // exit only once the result is written (a pipe holds 64 KiB)
