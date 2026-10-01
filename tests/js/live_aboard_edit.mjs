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
//             refused save keeps the draft and says why; while a save is in
//             flight nothing changes the draft (nothing is dropped when it
//             is in), Save then go on waits for it, and leaving Edit then is
//             no failure
//   leave     Map picked in another tab (a poll that detaches the view)
//             keeps unsaved work, Edit open with it, for the return to 3D
//   widths    drawn or dragged to just over its least width on a 45° wall,
//             what Save sends has ends the server keeps
//   limits    each Height, Sill and Head slider reaches exactly as high as
//             the view draws (a window, a map window, a door, a readout and
//             a light), and a door is 2.03 m when new
//   pointer   a poll moving the view mid-gesture (its pointer capture goes
//             with the move), then a lift off the view: the gesture ends,
//             and the next tap, click, line or compass tap still works, for
//             touch and for the mouse; a lost capture is taken back, a
//             pointer that is gone ends; leaving 3D lets go of what is down
//
// usage: live_aboard_edit.mjs <www/padspan-ha dir>
// prints one JSON line: { cases: {name: result}, failures: [...], payloads: [...], start: {...} }
// payloads: every Save the editor sent, made over `start` (the file as the
// harness began): test_live_aboard_edit.py feeds each through the server's
// own apply_edit.

import { pathToFileURL } from "node:url";
import { join } from "node:path";
import * as shim from "./dom_shim.mjs";
import { installStubGL } from "./stub_gl.mjs";

const WWW = process.argv[2];
if (!WWW) { console.error("usage: live_aboard_edit.mjs <www/padspan-ha dir>"); process.exit(2); }
shim.install();

// The window: a real listener list (the shim's is a no-op), run before the
// target's own, as the capture phase is.
const winL = {};
globalThis.addEventListener = (t, fn) => { (winL[t] ||= []).push(fn); };
globalThis.removeEventListener = (t, fn) => { winL[t] = (winL[t] || []).filter(f => f !== fn); };

installStubGL();

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
// floor), and the Shop reaches out past Main, as does the Bay, whose walls
// run at 45°. On Main: a glass barrier (a window from the map) in Living's
// far wall, and in the Den a pendant light and a temperature readout.
const MODEL = {
  floors: [{ id: "basement", name: "Basement" }, { id: "main", name: "Main" }],
  room_geometry_m: {
    Rec: rect("basement", 0, 0, 4.5, 8), Gym: rect("basement", 4.6, 0, 7.5, 8), Store: rect("basement", 7.6, 0, 10, 8),
    Shop: rect("basement", 10.1, 0, 14, 8), Bay: { type: "poly", floor_id: "basement", points_m: [[12, -5], [14, -3], [12, -1], [10, -3]] },
    Living: rect("main", 0, 0, 4.5, 8), Den: rect("main", 4.6, 0, 10, 8),
  },
  rf_barriers_m: [{ id: "bar_k", name: "Living window", material: "glass", floor_id: "main", points_m: [[1, 8], [2.4, 8]] }],
  light_positions_m: { "light.den": { x_m: 9.2, y_m: 0.9, floor_id: "main" }, "sensor.den_temp": { x_m: 9.2, y_m: 7.1, floor_id: "main" } },
};
const LBE = {
  "light.den": { entity_id: "light.den", friendly_name: "Den light", state: "on", brightness: 200, shape: "pendant" },
  "sensor.den_temp": { entity_id: "sensor.den_temp", friendly_name: "Den temperature", isTemp: true, state: "21.5",
                       device_class: "temperature", unit_of_measurement: "°C" },
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
let card = null, topIds = null;                  // topIds: the floor chips (null: every floor)
const P = () => ({ model: MODEL, floors: MODEL.floors, lightsByEid: LBE, hidden: new Set(), topFloorIds: topIds, quality: "low",
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
 *  then the target's own (the canvas, the compass, or anything else on the
 *  page: the one under the pointer, once the canvas has lost its capture). */
function fire(type, x, y, o = {}){
  const ev = { type, pointerId: o.id ?? 1, pointerType: o.kind ?? "mouse", clientX: x, clientY: y, button: o.button ?? 0,
               buttons: o.buttons ?? (type === "pointerup" || type === "pointercancel" ? 0 : 1), isPrimary: true,
               shiftKey: false, ctrlKey: false, metaKey: false, timeStamp: ++seq, target: o.target || canvas(),
               preventDefault(){}, stopPropagation(){} };
  for (const fn of [...(winL[type] || [])]) fn(ev);
  ev.target.dispatchEvent(ev);
  return ev;
}
function drag(a, b, o = {}, steps = 8){
  fire("pointerdown", a[0], a[1], o);
  for (let i = 1; i <= steps; i++) fire("pointermove", a[0] + (b[0] - a[0]) * i / steps, a[1] + (b[1] - a[1]) * i / steps, o);
  fire("pointerup", b[0], b[1], o);
}
const tap = (p, o = {}) => { fire("pointerdown", p[0], p[1], o); fire("pointerup", p[0], p[1], o); };
const sliderOf = (label) => root().querySelectorAll(".la3d-sheet")[0].querySelectorAll("input").find(r => r.getAttribute("aria-label") === label) || null;
/** Set a slider in the open sheet as a hand does (its input event). */
function slide(label, v){
  const r = sliderOf(label);
  if (!r) return false;
  r.value = String(v);
  r.dispatchEvent({ type: "input" });
  return true;
}
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

// ── errors ──────────────────────────────────────────────────────────────────
// The server's refusals (ws_house3d.py), each said plainly: a file that is
// there but unreadable (read_failed) or a newer PadSpan's (house3d_newer) is
// never treated as an empty house: the house draws from the map, Edit is
// unavailable with one line saying why; a refused Save keeps the draft.
/** Another screen's view on this page, with its own load. */
async function otherView(key, load){
  const s = LA.liveAboardSlot(key), c = document.createElement("div"), stage = document.createElement("div");
  c.appendChild(stage);
  document.body.replaceChildren(c);
  s.attach(stage, { ...P(), load });
  await settle(30);
  const editBtn = () => s.element.querySelectorAll("button").find(b => b.textContent === "Edit" || b.textContent === "Done");
  return { s, stage, editBtn };
}
await tryCase("errors: a 3D file that can't be read: drawn from the map, Edit unavailable and says why", async () => {
  let unreadable = true;
  const load = async () => {
    if (unreadable) throw { code: "read_failed", message: "Could not read the 3D house file. Nothing was changed; try again." };
    return { data: clone(FILE0) };
  };
  const v = await otherView("errors-unreadable", load);
  const s0 = v.s._state(), e0 = s0.edit;
  v.editBtn().click();
  await settle();
  const pressed = v.s._state().edit.editing;
  // The next showing reads it again: readable now, Edit is back.
  unreadable = false;
  v.s.detach();
  v.s.attach(v.stage, { ...P(), load });
  await settle(30);
  const e1 = v.s._state().edit;
  check("errors: a 3D file that can't be read: drawn from the map, Edit unavailable and says why",
    !s0.failed && s0.floors === 2 && s0.walls > 10 && s0.file === null && !e0.editAvailable && /couldn't be read/.test(e0.editWhy)
    && !pressed && e1.editAvailable && e1.editWhy === "" && v.s._state().file && v.s._state().file.openings === 3,
    { failed: s0.failed, file: s0.file, e0: { avail: e0.editAvailable, why: e0.editWhy }, pressed, e1: { avail: e1.editAvailable, why: e1.editWhy } });
  LA.releaseLiveAboardSlot("errors-unreadable");
  poll();
  await settle();
});
await tryCase("errors: a newer PadSpan's 3D file is drawn, and Edit is unavailable and says why", async () => {
  const newer = { ...clone(FILE0), schema: 2, pieces: { future: { what: "a newer thing" } } };
  const v = await otherView("errors-newer", async () => ({ data: newer }));
  const st2 = v.s._state(), e = st2.edit;
  v.editBtn().click();
  await settle();
  check("errors: a newer PadSpan's 3D file is drawn, and Edit is unavailable and says why",
    !st2.failed && st2.file && st2.file.openings === 3 && st2.added === 3 && !e.editAvailable && /newer PadSpan/.test(e.editWhy)
    && !v.s._state().edit.editing, { file: st2.file, added: st2.added, avail: e.editAvailable, why: e.editWhy });
  LA.releaseLiveAboardSlot("errors-newer");
  poll();
  await settle();
});
// A schema of 1.0 reads here as 1; the server never writes it, and its read
// says so (writable: false): that decides.
await tryCase("schema: a file the server says this version never writes (1.0, read here as 1) is drawn, and Edit is unavailable and says why", async () => {
  const data = JSON.parse(JSON.stringify(FILE0).replace('"schema":1', '"schema":1.0'));
  const v = await otherView("schema-float", async () => ({ data: clone(data), writable: false }));
  const s = v.s._state(), e = s.edit;
  v.editBtn().click();
  await settle();
  check("schema: a file the server says this version never writes (1.0, read here as 1) is drawn, and Edit is unavailable and says why",
    data.schema === 1 && !s.failed && s.file && s.file.openings === 3 && !e.editAvailable && /newer PadSpan/.test(e.editWhy)
    && !v.s._state().edit.editing, { schema: data.schema, file: s.file, avail: e.editAvailable, why: e.editWhy });
  LA.releaseLiveAboardSlot("schema-float");
  poll();
  await settle();
});
await tryCase("errors: a Save refused because the file can't be read or written keeps the draft and says so", async () => {
  const out = {};
  for (const [code, msg] of [["read_failed", "Could not read the 3D house file. Nothing was changed; try again."],
                             ["save_failed", "Could not save the 3D house. Nothing was changed."]]) {
    await openEdit();
    await pickTool("window");
    drag(where("main", 10, 5, WALL_Z), where("main", 10, 6.4, WALL_Z));
    const before = JSON.stringify(ed().draft);
    server.fail = { code, message: msg };
    click("Save", "la3d-tools");
    await settle();
    const e = ed(), saveBtn = button("Save", "la3d-tools");
    out[code] = { kept: e.dirty && JSON.stringify(e.draft) === before, hint: e.hint, bad: e.hintBad, canRetry: !!saveBtn && !saveBtn.disabled };
    await closeEdit();
  }
  check("errors: a Save refused because the file can't be read or written keeps the draft and says so",
    out.read_failed.kept && /^Not saved: the 3D file couldn't be read, so nothing was changed\. Your changes are still here/.test(out.read_failed.hint)
    && out.save_failed.kept && /^Not saved: the 3D file couldn't be written, so nothing was changed\. Your changes are still here/.test(out.save_failed.hint)
    && Object.values(out).every(o => o.bad && o.canRetry), out);
});
// Edit pressed before the file was read reads it first: what that read finds
// decides, as it would have before the press.
await tryCase("begin: Edit pressed before the file was read: a newer file found then opens no draft, and says why", async () => {
  let reads = 0;
  const newer = { ...clone(FILE0), schema: 2 };
  const v = await otherView("begin-newer", async () => { if (reads++ === 0) throw new Error("timed out"); return { data: clone(newer) }; });
  const e0 = v.s._state().edit;                            // the first read failed (not refused): Edit offered
  v.editBtn().click();
  await settle(30);
  const s1 = v.s._state(), e1 = s1.edit;
  check("begin: Edit pressed before the file was read: a newer file found then opens no draft, and says why",
    e0.editAvailable && reads === 2 && !!s1.file && !e1.editing && !e1.draft && !e1.editAvailable && /newer PadSpan/.test(e1.editWhy),
    { e0: e0.editAvailable, reads, file: s1.file, e1: { editing: e1.editing, draft: !!e1.draft, avail: e1.editAvailable, why: e1.editWhy } });
  LA.releaseLiveAboardSlot("begin-newer");
  poll();
  await settle();
});
/** A save held in flight until release() (the server answers late). */
function holdSaves(){
  let release = null;
  server.hold = new Promise(r => { release = r; });
  return async () => { server.hold = null; release(); await settle(); };
}
/** A window drawn on Main's back wall (Edit open, the Window tool on). */
async function drawOne(x0, x1){
  await openEdit();
  await pickTool("window");
  drag(where("main", x0, 0, WALL_Z), where("main", x1, 0, WALL_Z));
  await settle();
  return Object.keys(ed().draft.openings).find(k => !(k in server.file.openings)) || null;
}
await tryCase("save: nothing changes the draft while a save is in flight, so nothing is dropped when it is in", async () => {
  const id = await drawOne(1, 2.2);
  const release = holdSaves(), n0 = payloads.length;
  click("Save", "la3d-tools");
  await settle();
  const sent = JSON.stringify(ed().draft), during = { saving: ed().saving };
  // Mid-save: a slider, Undo, and a press that would draw.
  during.slid = slide("Head", 1.5);
  during.sameAfterSlider = JSON.stringify(ed().draft) === sent;
  during.undo = click("Undo", "la3d-tools");
  drag(where("main", 6, 0, WALL_Z), where("main", 7.5, 0, WALL_Z));
  during.same = during.sameAfterSlider && JSON.stringify(ed().draft) === sent;
  during.inert = root().querySelectorAll(".la3d-sheet")[0].inert === true;
  await release();
  const e = ed();
  check("save: nothing changes the draft while a save is in flight, so nothing is dropped when it is in",
    id && during.saving && during.same && during.inert && !during.undo && payloads.length === n0 + 1 && !e.saving && !e.dirty
    && JSON.stringify(e.draft) === sent && e.hint === "Saved.", { during, hint: e.hint, dirty: e.dirty });
  await closeEdit();
});
await tryCase("save: Save, then go on, asked while a save is in flight, goes on once it is in", async () => {
  const id = await drawOne(2.6, 3.8);
  const release = holdSaves(), n0 = payloads.length;
  let went = 0;
  click("Save", "la3d-tools");
  await settle();
  const held = slot.holdLeave(() => { went++; });
  const asking = ed().asking;
  click("Save", "la3d-ask");
  await settle();
  const before = went;
  await release();
  const e = ed();
  check("save: Save, then go on, asked while a save is in flight, goes on once it is in",
    id && held && asking && before === 0 && went === 1 && !e.editing && payloads.length === n0 + 1 && id in server.file.openings,
    { held, asking, before, went, editing: e.editing, calls: payloads.length - n0 });
});
await tryCase("save: leaving Edit while a save is in flight: the save still counts, never 'Not saved'", async () => {
  const id = await drawOne(5, 6.2);
  const release = holdSaves(), n0 = payloads.length;
  let went = 0;
  click("Save", "la3d-tools");
  await settle();
  slot.holdLeave(() => { went++; });
  click("Discard", "la3d-ask");                 // Edit ends while the save is still out
  await release();
  const e = ed();
  check("save: leaving Edit while a save is in flight: the save still counts, never 'Not saved'",
    id && went === 1 && !e.editing && !e.hintBad && e.hint === "Saved." && payloads.length === n0 + 1 && id in server.file.openings
    && st().file.openings === Object.keys(server.file.openings).length && !st().failed,
    { hint: e.hint, hintBad: e.hintBad, went, file: st().file, failed: st().failed });
});

// ── leave ───────────────────────────────────────────────────────────────────
await tryCase("leave: Map picked in another tab (a poll that detaches the view) keeps the unsaved draft for the return to 3D", async () => {
  const id = await drawOne(6.6, 7.8);
  const before = JSON.stringify(ed().draft);
  slot.detach();                                 // what mount3d does once this browser's pick says Map
  poll();
  await settle();
  const e = ed();
  let asked = false;
  if (e.editing) asked = slot.holdLeave(() => {}) && ed().asking;   // Map picked here now: the question
  check("leave: Map picked in another tab (a poll that detaches the view) keeps the unsaved draft for the return to 3D",
    id && e.editing && e.dirty && JSON.stringify(e.draft) === before && asked, { editing: e.editing, dirty: e.dirty, asked });
  click("Keep editing", "la3d-ask");
  await closeEdit();
});
await tryCase("leave: with nothing unsaved, leaving ends Edit", async () => {
  await openEdit();
  slot.detach();
  poll();
  await settle();
  check("leave: with nothing unsaved, leaving ends Edit", !ed().editing && !ed().draft, { editing: ed().editing });
});

// ── widths ──────────────────────────────────────────────────────────────────
// Drawn on the basement's Bay (its walls at 45°), with the floor chips on
// Basement so it is the floor the tool looks down on: lines drawn and ends
// dragged to just over the least width, found by watching the live length.
/** Move the pressed pointer from a toward b until the live length is
 *  within 2 µm over `want` (it grows from a to b). */
function reach(a, b, want, o){
  let lo = 0, hi = 1, got = null;
  for (let i = 0; i < 60; i++) {
    const s = (lo + hi) / 2;
    fire("pointermove", a[0] + (b[0] - a[0]) * s, a[1] + (b[1] - a[1]) * s, o);
    const g = ed().gesture, len = g && g.span ? g.span.len : 0;
    got = len;
    if (len < want) lo = s; else if (len > want + 2e-6) hi = s; else return len;
  }
  return got;
}
const width = (rec) => Math.hypot(rec.b_m[0] - rec.a_m[0], rec.b_m[1] - rec.a_m[1]);
await tryCase("widths: drawn or dragged to just over its least width on a sloped wall, Save sends ends the server keeps", async () => {
  topIds = ["basement"];
  poll();
  await settle();
  await openEdit();
  await pickTool("window");
  slot._look(0, 0, [12, 0, -3], 9);               // close over the Bay
  await settle();
  const n0 = payloads.length, made = [], dragged = [];
  // The Bay's two walls facing north-east and north-west, from their
  // southern corner: a window every 0.43 m along each, the first three
  // then dragged by an end.
  for (const [c0, c1] of [[[12, -1], [14, -3]], [[12, -1], [10, -3]]]) {
    const L = Math.hypot(c1[0] - c0[0], c1[1] - c0[1]), ux = (c1[0] - c0[0]) / L, uy = (c1[1] - c0[1]) / L;
    for (let k = 0; k < 6; k++) {
      const s0 = 0.2 + k * 0.43, want = 0.3 + k * 0.0002;
      const p = (s) => where("basement", c0[0] + ux * s, c0[1] + uy * s, WALL_Z);
      const a = p(s0), b = p(s0 + 0.34), before = Object.keys(ed().draft.openings);
      fire("pointerdown", a[0], a[1]);
      const len = reach(a, b, want, {});
      fire("pointerup", a[0], a[1]);              // the release adds what the line was at its last move
      const id = Object.keys(ed().draft.openings).find(k2 => !before.includes(k2));
      if (id) made.push({ id, len });
      await settle();                             // the walls drawn again, with it
      if (id && k < 3) {
        // Still picked: its far end dragged to just over 0.3 m.
        const r1 = ed().draft.openings[id], mid = (r1.sill_m + r1.head_m) / 2;
        const end = where("basement", r1.b_m[0], r1.b_m[1], mid), fixed = where("basement", r1.a_m[0], r1.a_m[1], mid);
        fire("pointerdown", end[0], end[1]);
        const g = ed().gesture;
        const out = [end[0] + (end[0] - fixed[0]) * 0.2, end[1] + (end[1] - fixed[1]) * 0.2];
        const len2 = g && g.kind === "drag" ? reach(fixed, out, 0.3 + dragged.length * 0.0003 + 0.00005, {}) : null;
        fire("pointerup", end[0], end[1]);
        dragged.push({ id, kind: g && g.kind, len: len2 });
        await settle();
      }
      click("×", "la3d-sheet");                   // its ends no longer grab the next press
    }
  }
  const mine = made.map(m => ed().draft.openings[m.id]).filter(Boolean);
  click("Save", "la3d-tools");
  await settle();
  const narrow = mine.filter(r => !(width(r) >= 0.3 - 1e-6)).map(width);
  check("widths: drawn or dragged to just over its least width on a sloped wall, Save sends ends the server keeps",
    made.length === 12 && dragged.filter(d => d.kind === "drag" && d.len >= 0.3 - 1e-6 && d.len < 0.302).length === 6 && !narrow.length
    && made.every(m => m.len >= 0.3 - 1e-6 && m.len < 0.302) && payloads.length === n0 + 1 && !ed().dirty,
    { made: made.length, dragged, narrow, lens: made.map(m => m.len), saved: payloads.length - n0, hint: ed().hint });
  await closeEdit();
  topIds = null;
  poll();
  await settle();
});

// ── limits ──────────────────────────────────────────────────────────────────
// Each slider's range is what the view draws: set to its top, the window,
// the door and the device are drawn there (heightLimits, the one place).
const range = (label) => { const r = sliderOf(label); return r ? [Number(r.min), Number(r.max)] : null; };
const glassOf = (o) => H.wallElements({ kind: "window", x0: 0, y0: 0, x1: 1, y1: 0, nx: 0, ny: -1, cls: "int", thick: 0.12, ...o }, 2.8).find(e => e.glass);
const leafOf = (o) => H.wallElements({ kind: "door", x0: 0, y0: 0, x1: 1, y1: 0, nx: 0, ny: -1, cls: "int", thick: 0.12, ...o }, 2.8).find(e => e.leaf);
await tryCase("limits: a window's Sill and Head sliders reach exactly as high as the view draws them", async () => {
  await openEdit();
  if (ed().tool) await pickTool(ed().tool);
  slot._look(0, 0, [5, 2.8, 4], 30);
  await settle();
  const out = {};
  for (const [key, fid, x, y] of [["drawn", "main", 0, 3.75], ["map", "main", 1.7, 8]]) {
    tap(where(fid, x, y, 1.5));
    const s = ed().sel, sill = range("Sill"), head = range("Head");
    const top = glassOf({ sill_m: 9, head_m: 9 });
    slide("Sill", sill ? sill[1] : 0);
    slide("Head", head ? head[1] : 0);
    const rec = ed().draft.openings[s && s.opening ? s.opening.id : ""] || {};
    const drawn = glassOf({ sill_m: rec.sill_m, head_m: rec.head_m });
    out[key] = { id: s && s.opening && s.opening.id, sill, head, top: [top.z0, top.z1], rec: [rec.sill_m, rec.head_m], drawn: [drawn.z0, drawn.z1],
                 ok: !!(sill && head) && Math.abs(sill[1] - top.z0) < 1e-9 && Math.abs(head[1] - top.z1) < 1e-9
                     && Math.abs(drawn.z0 - rec.sill_m) < 1e-9 && Math.abs(drawn.z1 - rec.head_m) < 1e-9 };
    click("×", "la3d-sheet");
  }
  click("Save", "la3d-tools");
  await settle();
  check("limits: a window's Sill and Head sliders reach exactly as high as the view draws them",
    out.drawn.ok && out.map.ok && out.drawn.id === "win_0000a001" && out.map.id === "bar_k" && !ed().dirty, out);
  await closeEdit();
});
await tryCase("limits: a door's Height slider reaches exactly as high as the view draws it; 2.03 m when new", async () => {
  await openEdit();
  await pickTool("door");
  drag(where("main", 10, 6.6, WALL_Z), where("main", 10, 7.7, WALL_Z));
  const s = ed().sel, id = s && s.opening ? s.opening.id : null, made = id ? ed().draft.openings[id].head_m : null;
  const h = range("Height"), top = leafOf({ head_m: 9 });
  slide("Height", h ? h[1] : 0);
  const rec = id ? ed().draft.openings[id] : {}, drawn = leafOf({ head_m: rec.head_m });
  click("Save", "la3d-tools");
  await settle();
  check("limits: a door's Height slider reaches exactly as high as the view draws it; 2.03 m when new",
    id && made === 2.03 && h && h[0] === 1 && Math.abs(h[1] - top.z1) < 1e-9 && Math.abs(drawn.z1 - rec.head_m) < 1e-9 && !ed().dirty,
    { id, made, h, top: top.z1, rec: rec.head_m, drawn: drawn.z1 });
  await closeEdit();
});
await tryCase("limits: a readout's and a light's Height sliders reach exactly as high as the view draws them", async () => {
  await openEdit();
  await pickTool("heights");
  slot._look(0.6, 0.7, [5, 2.8, 4], 26);
  await settle();
  const out = {};
  for (const eid of ["sensor.den_temp", "light.den"]) {
    tap(slot._where({ eid }));
    const s = ed().sel, h = range("Height");
    slide("Height", h ? h[1] : 0);
    await settle();
    const z = (st().heights[eid.startsWith("light.") ? "lights" : "devices"].find(x => x.eid === eid) || {}).z;
    out[eid] = { sel: s && s.eid, h, z };
    click("×", "la3d-sheet");
  }
  const ceilM = 2.8 - H.SLAB_T;
  click("Save", "la3d-tools");
  await settle();
  const t = out["sensor.den_temp"], l = out["light.den"];
  check("limits: a readout's and a light's Height sliders reach exactly as high as the view draws them",
    t.sel === "sensor.den_temp" && t.h && Math.abs(t.h[1] - H.deviceZ("temp", ceilM, { z_m: 99 })) < 1e-9 && Math.abs(t.z - t.h[1]) < 1e-9
    && l.sel === "light.den" && l.h && Math.abs(l.h[1] - ceilM) < 1e-9 && Math.abs(l.z - l.h[1]) < 1e-9 && !ed().dirty, out);
  await closeEdit();
});

// ── drag ────────────────────────────────────────────────────────────────────
// A slider being dragged moves only what it moves, in place: the house is
// never read again and nothing is rebuilt while it moves; let go, what it
// changed is built once, from the reading kept (the map has not changed).
const letGo = (label) => { const r = sliderOf(label); if (r) r.dispatchEvent({ type: "change" }); return !!r; };
const hitAt = (p, eid) => { const r = p && slot._pick(p[0], p[1]); return !!(r && String(r.hit).includes(eid)); };
const glassAt = (id) => { const p = slot._piece(id), g = p && p.els.find(e => e[2]); return g ? +g[0].toFixed(3) : null; };
await tryCase("drag: a window's Sill moves it in place, never reading or rebuilding; let go, the walls are built once", async () => {
  await openEdit();
  if (ed().tool) await pickTool(ed().tool);
  slot._look(0, 0, [5, 2.8, 4], 30);
  await settle();
  const out = {};
  for (const [id, x, y] of [["bar_k", 1.7, 8], ["win_0000a001", 0, 3.75]]) {
    tap(where("main", x, y, 1.5));
    const w0 = st().work, sel = ed().sel && ed().sel.opening && ed().sel.opening.id, drawn = [];
    for (const v of [0.52, 0.61, 0.73, 0.84]) { slide("Sill", v); await settle(2); drawn.push(glassAt(id)); }
    const w1 = st().work;
    letGo("Sill");
    await settle();
    const w2 = st().work;
    out[id] = { sel, drawn, after: glassAt(id), moving: [w1.reads - w0.reads, w1.shells - w0.shells, w1.lights - w0.lights, w1.sensors - w0.sensors],
                moves: w1.moves - w0.moves, letGo: [w2.reads - w1.reads, w2.shells - w1.shells] };
    click("×", "la3d-sheet");
  }
  await closeEdit();
  check("drag: a window's Sill moves it in place, never reading or rebuilding; let go, the walls are built once",
    Object.entries(out).every(([id, o]) => o.sel === id && JSON.stringify(o.drawn) === "[0.52,0.61,0.73,0.84]" && o.after === 0.84
      && o.moving.every(n => n === 0) && o.moves >= 4 && o.letGo[0] === 0 && o.letGo[1] === 1), out);
});
await tryCase("drag: a light's and a readout's Height move them in place; let go, each is built once", async () => {
  await openEdit();
  await pickTool("heights");
  slot._look(0.6, 0.7, [5, 2.8, 4], 26);
  await settle();
  const out = {};
  for (const eid of ["light.den", "sensor.den_temp"]) {
    const sec = eid.startsWith("light.") ? "lights" : "devices";
    tap(slot._where({ eid }));
    const w0 = st().work, sel = ed().sel && ed().sel.eid, zs = [];
    for (const v of [1.37, 1.53, 1.71, 1.89]) { slide("Height", v); await settle(2); zs.push((st().heights[sec].find(x => x.eid === eid) || {}).z); }
    const w1 = st().work, at = slot._where({ eid }), hitMoved = hitAt(at, eid);
    letGo("Height");
    await settle();
    const w2 = st().work, hitBuilt = hitAt(at, eid), zBuilt = (st().heights[sec].find(x => x.eid === eid) || {}).z;
    out[eid] = { sel, zs, moving: [w1.reads - w0.reads, w1.shells - w0.shells, w1.lights - w0.lights, w1.sensors - w0.sensors],
                 moves: w1.moves - w0.moves, letGo: [w2.reads - w1.reads, w2.shells - w1.shells, w2.lights - w1.lights, w2.sensors - w1.sensors],
                 // a press where it was moved to finds it, moved in place and built again
                 same: hitMoved && hitBuilt && zBuilt === 1.89 };
    click("×", "la3d-sheet");
  }
  await closeEdit();
  const L = out["light.den"], S = out["sensor.den_temp"];
  check("drag: a light's and a readout's Height move them in place; let go, each is built once",
    L.sel === "light.den" && S.sel === "sensor.den_temp" && [L, S].every(o => JSON.stringify(o.zs) === "[1.37,1.53,1.71,1.89]"
      && o.moving.every(n => n === 0) && o.moves >= 4 && o.letGo[0] === 0 && o.letGo[1] === 0 && o.same)
    && L.letGo[2] === 1 && L.letGo[3] === 0 && S.letGo[2] === 0 && S.letGo[3] === 1, out);
});
// A window across the gap between Living's and the Den's back walls is drawn
// in two wall pieces: a slider moves both, together, as it is dragged.
await tryCase("split: a window split over two walls moves whole as its Sill is dragged; let go, the walls are built once", async () => {
  const id = "win_0000c001";
  server.file.openings[id] = win("main", [3.9, 0], [5.3, 0]);
  slot.detach(); poll(); await settle(40);               // the file read again, with it
  await openEdit();
  if (ed().tool) await pickTool(ed().tool);
  slot._look(0, 0, [5, 2.8, 4], 30);
  await settle();
  const parts = slot._pieces(id).length;
  tap(where("main", 4.2, 0, 1.5));
  await settle();
  const sel = ed().sel && ed().sel.opening && ed().sel.opening.id;
  const glassOf = () => slot._pieces(id).map(p => { const g = p.els.find(e => e[2]); return g ? +g[0].toFixed(3) : null; });
  const w0 = st().work, drawn = [];
  for (const v of [0.52, 0.61, 0.73, 0.84]) { slide("Sill", v); await settle(2); drawn.push(glassOf()); }
  const w1 = st().work;
  letGo("Sill");
  await settle();
  const w2 = st().work, after = glassOf();
  click("×", "la3d-sheet");
  await closeEdit();
  delete server.file.openings[id];
  slot.detach(); poll(); await settle(40);
  check("split: a window split over two walls moves whole as its Sill is dragged; let go, the walls are built once",
    parts === 2 && sel === id && JSON.stringify(drawn) === "[[0.52,0.52],[0.61,0.61],[0.73,0.73],[0.84,0.84]]"
    && JSON.stringify(after) === "[0.84,0.84]" && w1.reads === w0.reads && w1.shells === w0.shells && w1.moves - w0.moves >= 4
    && w2.reads === w1.reads && w2.shells === w1.shells + 1 && !slot._pieces(id).length,
    { parts, sel, drawn, after, moving: [w1.reads - w0.reads, w1.shells - w0.shells, w1.moves - w0.moves], letGo: [w2.reads - w1.reads, w2.shells - w1.shells] });
});

// ── pointer ─────────────────────────────────────────────────────────────────
// A poll moving the view into a new card takes the canvas's pointer capture
// with it: a lift off the canvas then reaches the window alone (sent here as
// a browser sends it, to the page under the finger).
const roomAt = (name) => slot._where({ room: name });
function roomOpens(name, o){
  const n0 = api.calls.length;
  tap(roomAt(name), o);
  return api.calls.slice(n0).some(c => c[0] === "room" && c[1] === name);
}
/** Down on the house, a poll mid-drag, and the lift off the view. */
function strand(o){
  fire("pointerdown", 400, 300, o);
  fire("pointermove", 420, 300, o);
  poll();
  fire("pointermove", 440, 640, { ...o, target: document.body });
  fire("pointerup", 440, 640, { ...o, target: document.body });
}
await tryCase("pointer: a touch let go off the view after a poll ends there; taps and the compass still work", async () => {
  await closeEdit();
  slot._look(0.9, 0.9, [5, 2.8, 4], 30);
  await settle();
  strand({ kind: "touch", id: 11 });
  await settle();
  const room = roomOpens("Den", { kind: "touch", id: 12 });
  slot._look(0.9, 0.9, [5, 2.8, 4], 30);
  const comp = root().querySelectorAll(".la3d-compass")[0], o = { kind: "touch", id: 13, target: comp };
  fire("pointerdown", 30, 30, o);
  fire("pointerup", 30, 30, o);
  const north = Math.abs(st().cam.theta - H.northUpTheta(0)) < 1e-9;
  check("pointer: a touch let go off the view after a poll ends there; taps and the compass still work", room && north,
    { room, theta: st().cam.theta, north: H.northUpTheta(0) });
});
await tryCase("pointer: a mouse let go off the view after a poll ends there; no turning with no button held; clicks still work", async () => {
  slot._look(0.9, 0.9, [5, 2.8, 4], 30);
  await settle();
  strand({ kind: "mouse", id: 1 });
  await settle();
  const th0 = st().cam.theta;
  fire("pointermove", 300, 300, { kind: "mouse", id: 1, buttons: 0 });
  fire("pointermove", 360, 330, { kind: "mouse", id: 1, buttons: 0 });
  const still = st().cam.theta === th0;
  const room = roomOpens("Den", { kind: "mouse", id: 1 });
  check("pointer: a mouse let go off the view after a poll ends there; no turning with no button held; clicks still work",
    still && room, { th0, th: st().cam.theta, room });
});
await tryCase("pointer: in Edit, a line drawn across a poll and let go off the view is drawn; the next tap still marks an end", async () => {
  await openEdit();
  await pickTool("window");
  const n0 = Object.keys(ed().draft.openings).length, o = { kind: "touch", id: 21 };
  const a = where("main", 10, 4.4, WALL_Z), b = where("main", 10, 6, WALL_Z);
  fire("pointerdown", a[0], a[1], o);
  for (let i = 1; i <= 4; i++) fire("pointermove", a[0] + (b[0] - a[0]) * i / 8, a[1] + (b[1] - a[1]) * i / 8, o);
  poll();
  await settle();
  for (let i = 5; i <= 8; i++) fire("pointermove", a[0] + (b[0] - a[0]) * i / 8, a[1] + (b[1] - a[1]) * i / 8, { ...o, target: document.body });
  fire("pointerup", b[0], b[1], { ...o, target: document.body });
  const drawn = Object.keys(ed().draft.openings).length === n0 + 1 && !ed().gesture;
  tap(where("main", 0, 6.5, WALL_Z), { kind: "touch", id: 22 });
  const marked = ed().pending;
  check("pointer: in Edit, a line drawn across a poll and let go off the view is drawn; the next tap still marks an end",
    drawn && marked, { drawn, marked, gesture: ed().gesture, n: [n0, Object.keys(ed().draft.openings).length] });
  await closeEdit();
});
await tryCase("pointer: a capture lost to a poll is taken back; a pointer the browser says is gone ends there", async () => {
  const c = canvas(), held = new Set(), gone = new Set();
  c.setPointerCapture = (id) => { if (gone.has(id)) throw new DOMException("No active pointer", "NotFoundError"); held.add(id); };
  c.releasePointerCapture = (id) => { held.delete(id); };
  const lose = (id) => { held.delete(id); c.dispatchEvent({ type: "lostpointercapture", pointerId: id }); };
  try {
    fire("pointerdown", 400, 300, { kind: "touch", id: 31 });
    lose(31);
    const retaken = held.has(31);
    fire("pointerup", 400, 300, { kind: "touch", id: 31 });
    fire("pointerdown", 400, 300, { kind: "touch", id: 32 });
    gone.add(32);
    lose(32);                                              // no lift ever comes for it
    const room = roomOpens("Den", { kind: "touch", id: 33 });
    check("pointer: a capture lost to a poll is taken back; a pointer the browser says is gone ends there", retaken && room, { retaken, room });
  } finally {
    delete c.setPointerCapture; delete c.releasePointerCapture;
  }
});
await tryCase("pointer: a drag the canvas alone hears turns the house as one through the window does", async () => {
  // As a browser sends it (window, then the canvas), and sent to the canvas
  // alone (an event that never leaves its shadow root, as a page's own
  // synthetic ones): the same drag turns the house just as far.
  const turn = (send) => {
    slot._look(0.9, 0.9, [5, 2.8, 4], 30);
    const th0 = st().cam.theta;
    send("pointerdown", 300, 300); for (let i = 1; i <= 4; i++) send("pointermove", 300 + i * 10, 300); send("pointerup", 340, 300);
    return st().cam.theta - th0;
  };
  const both = turn((type, x, y) => fire(type, x, y, { kind: "touch", id: 51 }));
  const alone = turn((type, x, y) => canvas().dispatchEvent({ type, pointerId: 52, pointerType: "touch", clientX: x, clientY: y, button: 0,
    buttons: type === "pointerup" ? 0 : 1, isPrimary: true, timeStamp: ++seq, target: canvas(), preventDefault(){}, stopPropagation(){} }));
  check("pointer: a drag the canvas alone hears turns the house as one through the window does", Math.abs(both) > 0.01 && Math.abs(both - alone) < 1e-9,
    { both, alone });
});
await tryCase("pointer: leaving 3D lets go of whatever is down", async () => {
  fire("pointerdown", 400, 300, { kind: "touch", id: 41 });
  slot.detach();
  poll();
  await settle();
  const room = roomOpens("Den", { kind: "touch", id: 42 });
  check("pointer: leaving 3D lets go of whatever is down", room, { room });
});

// Near the end (from here until a read, this screen holds a newer PadSpan's
// file): a Save refused as house3d_newer keeps the draft, says why, and Save
// then waits.
await tryCase("errors: a Save refused for a newer PadSpan's file keeps the draft and says why", async () => {
  await openEdit();
  await pickTool("window");
  drag(where("main", 10, 5, WALL_Z), where("main", 10, 6.4, WALL_Z));
  const before = JSON.stringify(ed().draft);
  server.fail = { code: "house3d_newer", message: "This 3D house was saved by a newer PadSpan." };
  click("Save", "la3d-tools");
  await settle();
  const e = ed(), saveBtn = button("Save", "la3d-tools");
  const out = { kept: e.dirty && JSON.stringify(e.draft) === before, hint: e.hint, bad: e.hintBad, saveOff: !!saveBtn && saveBtn.disabled };
  click("Discard", "la3d-tools");
  click("Done");
  await settle();
  const after = ed();
  check("errors: a Save refused for a newer PadSpan's file keeps the draft and says why",
    out.kept && out.bad && /^Not saved: a newer PadSpan saved this 3D house/.test(out.hint) && out.saveOff
    && !after.editing && !after.editAvailable && /newer PadSpan/.test(after.editWhy), { ...out, after: { avail: after.editAvailable, why: after.editWhy } });
});
// That refusal is the file's own error, as a read of a newer file gives: the
// next read that finds the file this version's (Map, then 3D) clears it.
await tryCase("newer: after a Save refused for a newer PadSpan's file, the next good read brings Edit back", async () => {
  const e0 = ed();
  slot.detach(); poll(); await settle(40);               // Map, then 3D: the file read again
  const e1 = ed();
  click("Edit"); await settle();
  const editing = ed().editing;
  await closeEdit();
  check("newer: after a Save refused for a newer PadSpan's file, the next good read brings Edit back",
    !e0.editAvailable && /newer PadSpan/.test(e0.editWhy) && e1.editAvailable && e1.editWhy === "" && editing,
    { e0: { avail: e0.editAvailable, why: e0.editWhy }, e1: { avail: e1.editAvailable, why: e1.editWhy }, editing });
});
await tryCase("newer: a draft kept through that refusal saves once a read finds the file this version's", async () => {
  await openEdit();
  await pickTool("window");
  drag(where("main", 10, 5, WALL_Z), where("main", 10, 6.4, WALL_Z));
  await settle();
  server.fail = { code: "house3d_newer", message: "This 3D house was saved by a newer PadSpan." };
  click("Save", "la3d-tools");
  await settle();
  const refused = { dirty: ed().dirty, saveOff: button("Save", "la3d-tools").disabled };
  slot.detach(); poll(); await settle(40);               // Map in another tab, then 3D: the draft kept, the file read again
  const back = { editing: ed().editing, dirty: ed().dirty, saveOn: !button("Save", "la3d-tools").disabled };
  const n0 = server.calls;
  click("Save", "la3d-tools");
  await settle();
  const saved = { calls: server.calls - n0, dirty: ed().dirty, hint: ed().hint };
  await closeEdit();
  check("newer: a draft kept through that refusal saves once a read finds the file this version's",
    refused.dirty && refused.saveOff && back.editing && back.dirty && back.saveOn && saved.calls === 1 && !saved.dirty && saved.hint === "Saved.",
    { refused, back, saved });
});
await tryCase("newer: under an open draft, a read that finds a newer PadSpan's file holds Save and says why; this version's again, Save can go ahead", async () => {
  await openEdit();
  await pickTool("window");
  drag(where("main", 6, 8, WALL_Z), where("main", 7.4, 8, WALL_Z));   // the Den's far wall: nothing there yet
  await settle();
  server.file.schema = 2;
  slot.detach(); poll(); await settle(40);               // Map in another tab, then 3D: the draft kept, a newer file read
  const held = { editing: ed().editing, dirty: ed().dirty, saveOff: button("Save", "la3d-tools").disabled, hint: ed().hint, bad: ed().hintBad };
  server.file.schema = 1;
  slot.detach(); poll(); await settle(40);               // and again: this version's
  const back = { dirty: ed().dirty, saveOn: !button("Save", "la3d-tools").disabled, hint: ed().hint, bad: ed().hintBad };
  await closeEdit();
  check("newer: under an open draft, a read that finds a newer PadSpan's file holds Save and says why; this version's again, Save can go ahead",
    held.editing && held.dirty && held.saveOff && /^Not saved: a newer PadSpan saved this 3D house/.test(held.hint) && held.bad
    && back.dirty && back.saveOn && back.hint === "The 3D file can be saved again." && !back.bad, { held, back });
});

check("the view never failed", !st().failed, { failed: st().failed });
console.log(JSON.stringify({ cases, failures, payloads, start: FILE0 }));
