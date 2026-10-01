// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
//
// Live Aboard's 3D editor (views/live_aboard_edit.js), run for real inside
// the real 3D view (views/live_aboard.js) under the DOM shim. Only the GL is
// a stub (it draws nothing): the walls as built, the camera, the view's own
// occlusion test, its pointer wiring, the editor's picking, Save and rebase
// are all the shipped code. Pointer events go window (capture) first, then
// the canvas when it is the target, as a browser sends them.
//
// The house: a basement (Rec, Gym and Store under Main, and a Shop out past
// it) and Main above (Living and Den). In the 3D file: a basement window
// under Main's floor, one on the Shop's far wall in plain view, and one on
// Main.
//
//   pick      drawing on Main never lands on a basement wall seen through
//             it from above, and the window drawn is saved on Main; a door
//             or window under the floor above is never picked, one on a
//             floor below in plain view still is
//   save      Save sends exactly the draft's changes in one call, the file
//             is then the saved one and the history starts again; a
//             refused save keeps the draft and says why
//
// usage: live_aboard_edit.mjs <www/padspan-ha dir>
// prints one JSON line: { cases: {name: result}, failures: [...], payloads: [...] }

import { pathToFileURL } from "node:url";
import { join } from "node:path";
import * as shim from "./dom_shim.mjs";

const WWW = process.argv[2];
if (!WWW) { console.error("usage: live_aboard_edit.mjs <www/padspan-ha dir>"); process.exit(2); }
shim.install();

// The window: a real listener list (the shim's is a no-op), run before the
// target's own, as the capture phase is.
const winL = {};
globalThis.addEventListener = (t, fn) => { (winL[t] ||= []).push(fn); };
globalThis.removeEventListener = (t, fn) => { winL[t] = (winL[t] || []).filter(f => f !== fn); };

// A WebGL2 context that answers what three.js asks and draws nothing.
function stubGL(canvas){
  const names = {}, nums = {};
  let n = 0x9000;
  const param = (name) => (name === "VERSION" ? "WebGL 2.0" : name === "SHADING_LANGUAGE_VERSION" ? "WebGL GLSL ES 3.00"
    : name === "SCISSOR_BOX" || name === "VIEWPORT" ? new Int32Array([0, 0, 300, 150]) : name.startsWith("MAX_") ? 4096 : 0);
  const gl = {
    canvas, drawingBufferWidth: 300, drawingBufferHeight: 150,
    getParameter: (p) => param(names[p] || ""),
    getShaderPrecisionFormat: () => ({ precision: 23, rangeMin: 127, rangeMax: 127 }),
    getContextAttributes: () => ({ alpha: false, antialias: false, depth: true, stencil: false, premultipliedAlpha: true, preserveDrawingBuffer: false }),
    getExtension: () => null, getSupportedExtensions: () => [],
    getShaderParameter: () => true, getProgramParameter: (_p, k) => (names[k] === "LINK_STATUS" ? true : 0),
    getShaderInfoLog: () => "", getProgramInfoLog: () => "", isContextLost: () => false, getError: () => 0,
    checkFramebufferStatus: () => nums.FRAMEBUFFER_COMPLETE, getUniformLocation: () => ({}), getAttribLocation: () => -1,
    getActiveUniform: () => null, getActiveAttrib: () => null,
  };
  return new Proxy(gl, {
    get(o, k){
      if (k in o) return o[k];
      if (typeof k === "string" && /^[A-Z][A-Z0-9_]*$/.test(k)) { if (!(k in nums)) { nums[k] = ++n; names[n] = k; } return nums[k]; }
      if (typeof k === "string" && k.startsWith("create")) return () => ({});
      return () => undefined;
    },
  });
}
const realGetContext = globalThis.Node.prototype.getContext;
globalThis.Node.prototype.getContext = function(kind, ...a){ return /webgl/i.test(String(kind)) ? stubGL(this) : realGetContext.call(this, kind, ...a); };

const LA = await import(pathToFileURL(join(WWW, "views", "live_aboard.js")).href);
const H = await import(pathToFileURL(join(WWW, "views", "live_aboard_house.js")).href);

const failures = [];
const cases = {};
const payloads = [];
const check = (name, ok, detail) => { cases[name] = !!ok; if (!ok) failures.push({ name, detail: detail === undefined ? null : detail }); };
const tryCase = async (name, fn) => {
  try { await fn(); } catch (e) { failures.push({ name, detail: String(e && e.stack || e).slice(0, 900) }); cases[name] = false; }
};
const clone = (x) => JSON.parse(JSON.stringify(x));
const settle = async (rounds = 12) => { await shim.flush(rounds); await new Promise(r => globalThis._realSetTimeout(r, 0)); };

// ── the house, the 3D file, the server ──────────────────────────────────────
const rect = (floor_id, x0, y0, x1, y1) => ({ type: "poly", floor_id, points_m: [[x0, y0], [x1, y0], [x1, y1], [x0, y1]] });
// Main: Living and Den, their wall at x = 4.55. Under it the basement's Rec
// and Gym share a wall at x = 4.55 too (from above it shows some 10 px
// inside Main's), the Gym and the Store one at x = 7.55 (under Main's
// floor), and the Shop reaches out past Main.
const MODEL = {
  floors: [{ id: "basement", name: "Basement" }, { id: "main", name: "Main" }],
  room_geometry_m: {
    Rec: rect("basement", 0, 0, 4.5, 8), Gym: rect("basement", 4.6, 0, 7.5, 8), Store: rect("basement", 7.6, 0, 10, 8),
    Shop: rect("basement", 10.1, 0, 14, 8),
    Living: rect("main", 0, 0, 4.5, 8), Den: rect("main", 4.6, 0, 10, 8),
  },
  rf_barriers_m: [],
};
const win = (floor_id, a, b) => ({ kind: "window", floor_id, a_m: a, b_m: b, sill_m: 0.9, head_m: 2.1 });
const FILE0 = { schema: 1, openings: {
  win_0000b001: win("basement", [7.55, 3], [7.55, 4.5]),       // under Main's floor
  win_0000b002: win("basement", [14, 3], [14, 4.5]),           // the Shop's far wall, nothing above it
  win_0000a001: win("main", [0, 3], [0, 4.5]),
}, lights: {}, devices: {} };
const server = { file: clone(FILE0), calls: 0, fail: null, hold: null };
const editFn = async (changes) => {
  server.calls++;
  payloads.push(clone(changes));
  if (server.hold) await server.hold;
  if (server.fail) { const f = server.fail; server.fail = null; throw f; }
  const next = clone(server.file);
  for (const [sec, entries] of Object.entries(changes)) for (const [k, v] of Object.entries(entries)) {
    if (v === null) delete next[sec][k]; else next[sec][k] = clone(v);
  }
  server.file = next;
  return { data: clone(next), counts: {} };
};
const api = { calls: [], toast(){}, toggle(...a){ api.calls.push(["toggle", ...a]); }, openRoom(r){ api.calls.push(["room", r]); },
              openFloor(){}, openControls(){}, openActivity(){}, controlsFor: () => null, lightsByEid: {}, hass: null };

// ── the view ────────────────────────────────────────────────────────────────
const slot = LA.liveAboardSlot("edit-harness");
let card = null;
const P = () => ({ model: MODEL, floors: MODEL.floors, lightsByEid: {}, hidden: new Set(), topFloorIds: null, quality: "low",
  telemetry: () => {}, states: {}, config: {}, bearing: 0, saveNorth: null, useApi: () => api, haStartedMs: 0,
  load: async () => ({ data: clone(server.file) }), edit: editFn });
/** A fresh card, as the Atlas builds one every 5 s: the view moves into it. */
function poll(){
  card = document.createElement("div");
  const stage = document.createElement("div");
  card.appendChild(stage);
  document.body.replaceChildren(card);
  return slot.attach(stage, P());
}
const st = () => slot._state();
const ed = () => st().edit;
const root = () => slot.element;
const canvas = () => st().canvas;
function button(label, cls){
  const box = cls ? root().querySelectorAll("." + cls)[0] : root();
  return box ? box.querySelectorAll("button").find(b => b.textContent === label) || null : null;
}
const click = (label, cls) => { const b = button(label, cls); if (!b || b.disabled) return false; b.click(); return true; };

let seq = 0;
/** A pointer event sent as a browser does: the window's capture listeners,
 *  then the target's own (the canvas, or something else on the page). */
function fire(type, x, y, o = {}){
  const ev = { type, pointerId: o.id ?? 1, pointerType: o.kind ?? "mouse", clientX: x, clientY: y, button: o.button ?? 0,
               buttons: o.buttons ?? (type === "pointerup" || type === "pointercancel" ? 0 : 1), isPrimary: true,
               shiftKey: false, ctrlKey: false, metaKey: false, timeStamp: ++seq, target: o.target || canvas(),
               preventDefault(){}, stopPropagation(){} };
  for (const fn of [...(winL[type] || [])]) fn(ev);
  if (ev.target === canvas()) canvas().dispatchEvent(ev);
  return ev;
}
function drag(a, b, o = {}, steps = 8){
  fire("pointerdown", a[0], a[1], o);
  for (let i = 1; i <= steps; i++) fire("pointermove", a[0] + (b[0] - a[0]) * i / steps, a[1] + (b[1] - a[1]) * i / steps, o);
  fire("pointerup", b[0], b[1], o);
}
const tap = (p, o = {}) => { fire("pointerdown", p[0], p[1], o); fire("pointerup", p[0], p[1], o); };
function segPx(p, a, b){
  const dx = b[0] - a[0], dy = b[1] - a[1], L2 = dx * dx + dy * dy;
  const t = L2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L2)) : 0;
  return Math.hypot(p[0] - a[0] - dx * t, p[1] - a[1] - dy * t);
}
const where = (fid, x, y, z) => slot._whereOf(fid, x, y, z);
const H0 = H.readHouse(MODEL, MODEL.floors, {}, null);
const piecesOn = (fid) => H0.perFloor.get(H0.byId.get(fid)).pieces.filter(pc => pc.kind !== "rail");
const CEIL = 2.8 - H.SLAB_T, WALL_Z = Math.min(1.2, CEIL * 0.45);

async function openEdit(){
  if (!ed().editing) click("Edit");
  await settle();
}
async function closeEdit(){
  if (ed().dirty) click("Discard", "la3d-tools");
  if (ed().editing) click("Done");
  await settle();
}
async function pickTool(t){
  if (ed().tool !== t) click(t === "window" ? "Window" : t === "door" ? "Door" : "Heights", "la3d-tools");
  await settle();
}

poll();
await settle(40);

await tryCase("pick: the view runs here", async () => {
  check("pick: the view runs here", !st().failed && st().frames > 0 && st().floors === 2 && st().file && st().file.openings === 3,
    { failed: st().failed, frames: st().frames, file: st().file });
});

// ── pick ────────────────────────────────────────────────────────────────────
await tryCase("pick: drawing on Main never lands on the floor below", async () => {
  await openEdit();
  await pickTool("window");
  const landed = { main: 0, basement: 0, none: 0 }, wrong = [];
  // Presses just off each of Main's walls, and right on each basement wall
  // under Main as it would show through Main's floor: each drags 40 px along.
  const under = piecesOn("basement").filter(pc => Math.max(pc.x0, pc.x1) <= 10.06);
  for (const [fid, pcs, offsets] of [["main", piecesOn("main"), [0, 4, 8, 12]], ["basement", under, [0]]]) {
    for (const pc of pcs) {
      for (const t of [0.25, 0.5, 0.75]) {
        const at = (u) => [pc.x0 + (pc.x1 - pc.x0) * u, pc.y0 + (pc.y1 - pc.y0) * u];
        const m = at(t), p0 = where(fid, m[0], m[1], WALL_Z), p1 = where(fid, ...at(t < 0.5 ? 0.75 : 0.25), WALL_Z);
        const q = where(fid, m[0] + pc.nx * 0.3, m[1] + pc.ny * 0.3, WALL_Z);
        if (!p0 || !p1 || !q) continue;
        const nx = q[0] - p0[0], ny = q[1] - p0[1], nl = Math.hypot(nx, ny) || 1;
        const ux = p1[0] - p0[0], uy = p1[1] - p0[1], ul = Math.hypot(ux, uy) || 1;
        for (const side of offsets.length > 1 ? [-1, 1] : [1]) for (const px of offsets) {
          const a = [p0[0] + nx / nl * px * side, p0[1] + ny / nl * px * side];
          const before = Object.keys(ed().draft.openings);
          drag(a, [a[0] + ux / ul * 40, a[1] + uy / ul * 40]);
          const added = Object.keys(ed().draft.openings).filter(k => !before.includes(k));
          if (!added.length) { landed.none++; continue; }
          const fl = ed().draft.openings[added[0]].floor_id;
          landed[fl] = (landed[fl] || 0) + 1;
          if (fl !== "main" && wrong.length < 4) wrong.push({ pressedNear: fid, wall: [pc.x0, pc.y0, pc.x1, pc.y1], t, side, px, floor: fl });
          click("Undo", "la3d-tools");
        }
      }
    }
  }
  check("pick: drawing on Main never lands on the floor below", landed.main >= 40 && !landed.basement, { landed, wrong });
  await closeEdit();
});
await tryCase("pick: a window drawn on Main is saved on Main", async () => {
  await openEdit();
  await pickTool("window");
  const n0 = payloads.length;
  // Right on the basement's wall under Living | Den, as it shows through
  // Main's floor: a few px inside Main's own wall, within reach of it.
  const a = where("basement", 4.55, 2, WALL_Z), b = where("basement", 4.55, 3.5, WALL_Z);
  const m0 = where("main", 4.55, 0, WALL_Z), m1 = where("main", 4.55, 8, WALL_Z);
  drag(a, b);
  click("Save", "la3d-tools");
  await settle();
  const sent = payloads.slice(n0), ops = sent.length === 1 ? Object.values(sent[0].openings || {}) : [];
  check("pick: a window drawn on Main is saved on Main", ops.length === 1 && ops[0].floor_id === "main" && ops[0].kind === "window",
    { sent, offMainWallPx: segPx(a, m0, m1) });
  await closeEdit();
});
await tryCase("pick: under the floor above is never picked; on a floor below in plain view still is", async () => {
  await openEdit();
  if (ed().tool) await pickTool(ed().tool);                 // no tool: a tap picks what to change
  slot._look(0, 0, [7, 2.8, 4], 36);
  await settle();
  const pickOf = (fid, x, y) => {
    const p = where(fid, x, y, 1.5);
    tap(p);
    const s = ed().sel;
    return s && s.opening ? s.opening.id : null;
  };
  const under = pickOf("basement", 7.55, 3.75);
  click("×", "la3d-sheet");
  const shop = pickOf("basement", 14, 3.75);
  click("×", "la3d-sheet");
  const mine = pickOf("main", 0, 3.75);
  click("×", "la3d-sheet");
  check("pick: under the floor above is never picked; on a floor below in plain view still is",
    under === null && shop === "win_0000b002" && mine === "win_0000a001", { under, shop, mine });
  await closeEdit();
});

// ── save ────────────────────────────────────────────────────────────────────
await tryCase("save: one call with exactly the changes; the file is the saved one; history starts again", async () => {
  await openEdit();
  await pickTool("window");
  const n0 = payloads.length, calls0 = server.calls;
  const a = where("main", 10, 2, WALL_Z), b = where("main", 10, 3.2, WALL_Z);
  drag(a, b);
  const id = Object.keys(ed().draft.openings).find(k => !(k in server.file.openings));
  const want = id ? clone(ed().draft.openings[id]) : null;
  click("Save", "la3d-tools");
  await settle();
  const sent = payloads.slice(n0), e = ed();
  check("save: one call with exactly the changes; the file is the saved one; history starts again",
    id && server.calls === calls0 + 1 && sent.length === 1 && JSON.stringify(sent[0]) === JSON.stringify({ openings: { [id]: want } })
    && !e.dirty && !e.canUndo && !e.canRedo && JSON.stringify(e.draft.openings[id]) === JSON.stringify(want)
    && st().file.openings === Object.keys(server.file.openings).length && e.hint === "Saved.",
    { id, sent, e: { dirty: e.dirty, canUndo: e.canUndo, hint: e.hint }, file: st().file });
  await closeEdit();
});
await tryCase("save: a refused save keeps the draft and says why", async () => {
  await openEdit();
  await pickTool("window");
  const a = where("main", 10, 5, WALL_Z), b = where("main", 10, 6.4, WALL_Z);
  drag(a, b);
  const before = JSON.stringify(ed().draft);
  server.fail = { code: "invalid_format", message: "nope" };
  click("Save", "la3d-tools");
  await settle();
  const e = ed();
  check("save: a refused save keeps the draft and says why",
    e.dirty && e.canUndo && JSON.stringify(e.draft) === before && /^Not saved: nope/.test(e.hint) && e.hintBad, { hint: e.hint, dirty: e.dirty });
  await closeEdit();
});

check("the view never failed", !st().failed, { failed: st().failed });
console.log(JSON.stringify({ cases, failures, payloads }));
