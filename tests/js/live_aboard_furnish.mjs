// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
//
// Live Aboard's Furnish tool (views/live_aboard_furnish.js), run for real
// inside the real 3D view and editor (views/live_aboard.js) under the DOM
// shim, as Mapping → Furnish mounts it (furnish on). Only the GL is a stub.
//
//   open      Furnish opens the editor at the furniture tool by itself: no
//             Door / Window / Heights, Build listing the builders' kinds, a
//             flow whose module is not there has no button
//   add       on the top floor showing, in the room under the view's
//             centre, its bottom on the floor, picked, facing into the room
//   drag      one finger drags it across its floor at its height; near a
//             wall its back snaps flush, turned to it; one Undo takes the
//             whole drag back
//   turn      ⟲ / ⟳ in 15° steps
//   floor     Floor ▲ moves it to the floor above at the same x/y, under
//             that floor's ceiling, and the host's floor chips follow; ▼
//             brings it back; each is off at the top / bottom floor
//   height    Height in room: 0 up to the ceiling less its own height, in
//             0.01 m steps, drawn as it moves; On the floor puts it back
//   copy      Duplicate (a new id, not linked) and Delete, each one Undo
//   device    "This is a device…": an entity, its registry id from Home
//             Assistant, "linked"; Unlink
//   fit       a piece in another is a warning on its panel, never a block
//   save      one call with the whole draft, every piece whole; the file
//             then is what was saved
//   survive   a card rebuild mid-edit keeps the draft, the pick and the camera
//
// usage: live_aboard_furnish.mjs <www/padspan-ha dir>
// prints one JSON line: { cases: {name: result}, failures: [...], payloads: [...] }
// payloads: every Save sent; test_live_aboard_furnish.py feeds each through
// the server's own apply_edit.

import { pathToFileURL } from "node:url";
import { join } from "node:path";
import { existsSync } from "node:fs";
import * as shim from "./dom_shim.mjs";
import { installStubGL } from "./stub_gl.mjs";

const WWW = process.argv[2];
if (!WWW) { console.error("usage: live_aboard_furnish.mjs <www/padspan-ha dir>"); process.exit(2); }
shim.install();
const winL = {};
globalThis.addEventListener = (t, fn) => { (winL[t] ||= []).push(fn); };
globalThis.removeEventListener = (t, fn) => { winL[t] = (winL[t] || []).filter(f => f !== fn); };
installStubGL();

const LA = await import(pathToFileURL(join(WWW, "views", "live_aboard.js")).href);
const P_ = await import(pathToFileURL(join(WWW, "views", "live_aboard_pieces.js")).href);
const FURN = await import(pathToFileURL(join(WWW, "views", "live_aboard_furniture.js")).href).catch(() => null);

const failures = [];
const cases = {};
const payloads = [];
const check = (name, ok, detail) => { cases[name] = !!ok; if (!ok) failures.push({ name, detail: detail === undefined ? null : detail }); };
const tryCase = async (name, fn) => {
  try { await fn(); } catch (e) { failures.push({ name, detail: String(e && e.stack || e).slice(0, 900) }); cases[name] = false; }
};
const clone = (x) => JSON.parse(JSON.stringify(x));
const settle = async (rounds = 12) => { await shim.flush(rounds); await new Promise(r => globalThis._realSetTimeout(r, 0)); };
const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;

// ── the house, the 3D file, the server ──────────────────────────────────────
// Basement (Rec) under Main (Living and Den, their wall at x = 4.55), Upper
// (Loft) over Living. Ceilings: 2.8 m floor to floor less the slab.
const rect = (floor_id, x0, y0, x1, y1) => ({ type: "poly", floor_id, points_m: [[x0, y0], [x1, y0], [x1, y1], [x0, y1]] });
const MODEL = {
  floors: [{ id: "basement", name: "Basement" }, { id: "main", name: "Main" }, { id: "upper", name: "Upper" }],
  room_geometry_m: { Rec: rect("basement", 0, 0, 10, 8), Living: rect("main", 0, 0, 4.5, 8), Den: rect("main", 4.6, 0, 10, 8),
                     Loft: rect("upper", 0, 0, 4.5, 8) },
  light_positions_m: {},
};
const CEIL = 2.8 - 0.15;
const server = { file: { schema: 1, pieces: {}, openings: {}, lights: {}, devices: {}, figures: {} }, calls: 0 };
const editFn = async (changes) => {
  server.calls++;
  payloads.push(clone(changes));
  const next = clone(server.file);
  for (const [sec, entries] of Object.entries(changes)) for (const [k, v] of Object.entries(entries)) {
    if (v === null) delete next[sec][k]; else next[sec][k] = clone(v);
  }
  server.file = next;
  return { data: clone(next), counts: {} };
};
const ws = [], tops = [];
const callWS = async (msg) => { ws.push(clone(msg)); return msg.type === "config/entity_registry/get" ? { id: "0123456789abcdef0123456789abcdef" } : {}; };
const states = { "media_player.lounge_tv": { entity_id: "media_player.lounge_tv", state: "off", attributes: { friendly_name: "Lounge TV" } },
                 "light.den": { entity_id: "light.den", state: "on", attributes: { friendly_name: "Den light" } },
                 "sensor.den_temp": { entity_id: "sensor.den_temp", state: "21", attributes: { friendly_name: "Den temperature" } } };

// ── the view, as Mapping → Furnish mounts it ────────────────────────────────
const slot = LA.liveAboardSlot("furnish-harness");
let topIds = null;                               // the host's floor chips (null: every floor)
const P = () => ({ model: MODEL, floors: MODEL.floors, lightsByEid: {}, hidden: new Set(), topFloorIds: topIds, quality: "low",
  telemetry: () => {}, states, config: {}, bearing: 0, saveNorth: null, useApi: () => null, haStartedMs: 0,
  load: async () => ({ data: clone(server.file) }), edit: editFn,
  furnish: { callWS, toast: () => {}, settings: { atlas_3d_enabled: true }, entities: {} },
  setTopFloor: (fid) => { tops.push(fid); topIds = new Set([fid]); poll(); } });
function poll(){
  const card = document.createElement("div"), stage = document.createElement("div");
  card.appendChild(stage);
  document.body.replaceChildren(card);
  return slot.attach(stage, P());
}
const st = () => slot._state();
const ed = () => st().edit;
const fur = () => ed().furnish;
const root = () => slot.element;
const canvas = () => st().canvas;
const draftPieces = () => (ed().draft || {}).pieces || {};
const buttonsIn = (cls) => (cls ? root().querySelectorAll("." + cls)[0] : root()).querySelectorAll("button");
const button = (label, cls) => buttonsIn(cls).find(b => b.textContent === label) || null;
const click = (label, cls) => { const b = button(label, cls); if (!b || b.disabled) return false; b.click(); return true; };
const shown = (b) => !!b && b.style.display !== "none" && !(b.parentNode && b.parentNode.style && b.parentNode.style.display === "none");
let seq = 0;
function fire(type, x, y, o = {}){
  const ev = { type, pointerId: o.id ?? 1, pointerType: o.kind ?? "mouse", clientX: x, clientY: y, button: 0,
               buttons: type === "pointerup" || type === "pointercancel" ? 0 : 1, isPrimary: true, shiftKey: false, ctrlKey: false,
               metaKey: false, timeStamp: ++seq, target: canvas(), preventDefault(){}, stopPropagation(){} };
  for (const fn of [...(winL[type] || [])]) fn(ev);
  ev.target.dispatchEvent(ev);
  return ev;
}
function drag(a, b, o = {}, steps = 8){
  fire("pointerdown", a[0], a[1], o);
  for (let i = 1; i <= steps; i++) fire("pointermove", a[0] + (b[0] - a[0]) * i / steps, a[1] + (b[1] - a[1]) * i / steps, o);
  fire("pointerup", b[0], b[1], o);
}
const slider = (name) => root().querySelectorAll(".la3d-sheet")[0].querySelectorAll("input").find(r => r.getAttribute("aria-label") === name) || null;
function slide(name, v){
  const r = slider(name);
  if (!r) return false;
  r.value = String(v);
  r.dispatchEvent({ type: "input" });
  r.dispatchEvent({ type: "change" });
  return true;
}
const sheetText = () => root().querySelectorAll(".la3d-sheet")[0].textContent;

poll();
await settle(40);

// ── open ────────────────────────────────────────────────────────────────────
const FLOW_FILES = [["photo", "From a photo", "live_aboard_photo.js"], ["library", "Library", "live_aboard_library.js"],
                    ["import", "Import", "live_aboard_import.js"], ["people", "People & devices", "live_aboard_people.js"]];
await tryCase("open: Furnish opens at the furniture tool; Build lists the builders' kinds; a missing flow has no button", async () => {
  await settle(20);
  click("Build ▾", "la3d-tools");
  const menu = root().querySelectorAll(".la3d-furmenu")[0].querySelectorAll("button").map(b => b.textContent);
  // Grouped, furniture then devices, in the builders' order; the Box last on its own.
  const of = (g) => (FURN ? FURN.FURNITURE_KINDS.filter(k => k !== "other" && FURN.FURNITURE[k].group === g).map(k => FURN.FURNITURE[k].name) : []);
  const want = [...of("furniture"), ...of("device"), "Box"];
  check("open: Furnish opens at the furniture tool; Build lists the builders' kinds; a missing flow has no button",
    !st().failed && ed().editing && ed().tool === "furnish" && ed().furnishOn && !shown(button("Door", "la3d-tools"))
    && JSON.stringify(menu) === JSON.stringify(want)
    // A flow shows only when its module is there (each lands from its own phase).
    && FLOW_FILES.every(([id, label, file]) => shown(button(label, "la3d-tools")) === existsSync(join(WWW, "views", file)))
    && fur().flows && JSON.stringify(fur().flows) === JSON.stringify(FLOW_FILES.filter(f => existsSync(join(WWW, "views", f[2]))).map(f => f[0]))
    && st().furnish === true && st().split === "3d",
    { edit: { editing: ed().editing, tool: ed().tool }, menu, want, flows: fur().flows, split: st().split });
});

// ── add ─────────────────────────────────────────────────────────────────────
let sofa = null;
await tryCase("add: on the top floor showing, in the room under the view's centre, on the floor, picked, facing into the room", async () => {
  topIds = new Set(["main"]); poll(); await settle();
  slot._look(0.8, 0.9, [2.2, 0, 4], 18);             // looking at Living
  click("Build ▾", "la3d-tools");
  click(FURN ? "Sofa" : "Box", "la3d-furmenu");
  await settle();
  sofa = fur().sel;
  const p = draftPieces()[sofa] || {};
  const facing = P_.frontOf(p.rotation);
  check("add: on the top floor showing, in the room under the view's centre, on the floor, picked, facing into the room",
    P_.PIECE_ID.test(String(sofa)) && p.floor_id === "main" && p.z_m === 0 && near(p.x_m, 2.2, 1e-3) && near(p.y_m, 4, 1e-3)
    && Math.abs(facing[0]) + Math.abs(facing[1]) > 0.99 && ed().dirty && st().pieces.some(d => d.id === sofa && d.floor === "main"),
    { sofa, p, drawn: st().pieces });
});

// ── drag ────────────────────────────────────────────────────────────────────
await tryCase("drag: across its floor at its height; its back snaps flush to the wall; one Undo takes the drag back", async () => {
  const before = clone(draftPieces()[sofa]);
  const a = slot._wherePiece(sofa, 0.05), b = slot._whereOf("main", 2.2, 0.62, 0.05);   // near Living's back wall (y = 0)
  drag(a, b);
  await settle();
  const p = draftPieces()[sofa], s = P_.sizeOf(p.recipe), last = fur().lastDrag;
  const backGap = p.y_m - s.d / 2;                                                        // the wall's inner face is near y = 0
  const ok1 = last && last.snapped && p.rotation === 0 && backGap > -0.02 && backGap < 0.12 && p.z_m === 0;
  click("Undo", "la3d-tools");
  await settle();
  const back = draftPieces()[sofa];
  check("drag: across its floor at its height; its back snaps flush to the wall; one Undo takes the drag back",
    ok1 && back.x_m === before.x_m && back.y_m === before.y_m && back.rotation === before.rotation,
    { p, last, backGap, back, before });
  click("Redo", "la3d-tools");
  await settle();
});

// ── turn ────────────────────────────────────────────────────────────────────
await tryCase("turn: ⟲ / ⟳ in 15° steps", async () => {
  const r0 = draftPieces()[sofa].rotation;
  click("⟳ 15°", "la3d-sheet"); await settle();
  const r1 = draftPieces()[sofa].rotation;
  click("⟲ 15°", "la3d-sheet"); click("⟲ 15°", "la3d-sheet"); await settle();
  const r2 = draftPieces()[sofa].rotation;
  check("turn: ⟲ / ⟳ in 15° steps", r1 === P_.turned(r0, 1) && r2 === P_.turned(P_.turned(r1, -1), -1) && r1 % 15 === 0, [r0, r1, r2]);
});

// ── floor ───────────────────────────────────────────────────────────────────
await tryCase("floor: ▲ to the floor above at the same x/y and the view follows; ▼ back; off at the ends", async () => {
  const p0 = clone(draftPieces()[sofa]);
  slide("Height in room", 1.2); await settle();
  click("Floor ▲", "la3d-sheet"); await settle(20);
  const up = clone(draftPieces()[sofa]), topUp = st().topElev, upLabel = sheetText();
  const offUp = button("Floor ▲", "la3d-sheet").disabled;
  click("Floor ▼", "la3d-sheet"); await settle(20);
  const down = clone(draftPieces()[sofa]);
  click("Floor ▼", "la3d-sheet"); await settle(20);
  const base = clone(draftPieces()[sofa]), offDown = button("Floor ▼", "la3d-sheet").disabled;
  click("Floor ▲", "la3d-sheet"); await settle(20);
  check("floor: ▲ to the floor above at the same x/y and the view follows; ▼ back; off at the ends",
    up.floor_id === "upper" && up.x_m === p0.x_m && up.y_m === p0.y_m && up.z_m === 1.2 && near(topUp, 5.6, 1e-6) && /On Upper/.test(upLabel)
    && offUp && down.floor_id === "main" && base.floor_id === "basement" && offDown
    && JSON.stringify(tops) === JSON.stringify(["upper", "main", "basement", "main"]) && draftPieces()[sofa].floor_id === "main",
    { up, down, base, topUp, tops, offUp, offDown });
});

// ── height ──────────────────────────────────────────────────────────────────
await tryCase("height: 0 up to the ceiling less its height, in 0.01 m steps, drawn as it moves; On the floor puts it back", async () => {
  const h = P_.sizeOf(draftPieces()[sofa].recipe).h, r = slider("Height in room");
  const max = Number(r.max), step = Number(r.step);
  slide("Height in room", 0.73); await settle();
  const z1 = draftPieces()[sofa].z_m, drawn = st().pieces.find(d => d.id === sofa);
  slide("Height in room", 99); await settle();
  const z2 = draftPieces()[sofa].z_m;
  click("On the floor", "la3d-sheet"); await settle();
  const z3 = draftPieces()[sofa].z_m;
  check("height: 0 up to the ceiling less its height, in 0.01 m steps, drawn as it moves; On the floor puts it back",
    near(max, P_.zMax(CEIL, h), 1e-9) && step === 0.01 && z1 === 0.73 && drawn && near(drawn.at[1], 2.8 + 0.73, 1e-3)
    && z2 === P_.zMax(CEIL, h) && z3 === 0 && /\d\.\d\d m/.test(sheetText()), { max, step, z1, z2, z3, drawn });
});

// ── copy ────────────────────────────────────────────────────────────────────
await tryCase("copy: Duplicate makes a new piece beside it, not linked; Delete takes it out; each one Undo", async () => {
  const n0 = Object.keys(draftPieces()).length;
  click("Duplicate", "la3d-sheet"); await settle();
  const twin = fur().sel, t = draftPieces()[twin], o = draftPieces()[sofa];
  const dup = twin !== sofa && t && t.recipe.kind === o.recipe.kind && near(t.x_m, o.x_m + 0.3, 1e-3) && t.entity_id === null;
  click("Delete", "la3d-sheet"); await settle();
  const gone = !draftPieces()[twin] && fur().sel === null && Object.keys(draftPieces()).length === n0;
  click("Undo", "la3d-tools"); await settle();
  const back = !!draftPieces()[twin];
  click("Undo", "la3d-tools"); await settle();
  check("copy: Duplicate makes a new piece beside it, not linked; Delete takes it out; each one Undo",
    dup && gone && back && !draftPieces()[twin] && Object.keys(draftPieces()).length === n0, { dup, gone, back });
  slot._furnish().select(sofa); await settle();
});

// ── device ──────────────────────────────────────────────────────────────────
await tryCase("device: This is a device… links an entity with its registry id, shows linked; Unlink", async () => {
  click("This is a device…", "la3d-sheet"); await settle();
  const list = root().querySelectorAll(".la3d-ents")[0].querySelectorAll("button").map(b => b.textContent);
  const tv = root().querySelectorAll(".la3d-ents")[0].querySelectorAll("button").find(b => /Lounge TV/.test(b.textContent));
  tv.click(); await settle(20);
  const p = draftPieces()[sofa];
  const badge = root().querySelectorAll(".la3d-badge").some(n => n.textContent === "linked");
  const text = root().querySelectorAll(".la3d-sub").map(n => n.textContent).join(" | ") + (badge ? " | linked" : "");
  click("Unlink", "la3d-sheet"); await settle();
  const q = draftPieces()[sofa];
  check("device: This is a device… links an entity with its registry id, shows linked; Unlink",
    list.length === 2 && !list.some(t => /temperature/i.test(t)) && p.entity_id === "media_player.lounge_tv"
    && p.entity_reg_id === "0123456789abcdef0123456789abcdef" && /linked/.test(text) && /This is Lounge TV/.test(text)
    && ws.some(m => m.type === "config/entity_registry/get" && m.entity_id === "media_player.lounge_tv")
    && q.entity_id === null && q.entity_reg_id === null, { text, q: { entity_id: q.entity_id, entity_reg_id: q.entity_reg_id }, list, ws });
  click("This is a device…", "la3d-sheet"); await settle();
  root().querySelectorAll(".la3d-ents")[0].querySelectorAll("button").find(b => /Den light/.test(b.textContent)).click();
  await settle(20);
});

// ── fit ─────────────────────────────────────────────────────────────────────
await tryCase("fit: a piece in another is a warning on its panel and an amber outline, never a block", async () => {
  const id = slot._furnish().build("box");
  await settle();
  const p = draftPieces()[id], s = draftPieces()[sofa];
  const a = slot._wherePiece(id, 0.05), b = slot._whereOf("main", s.x_m + 0.2, s.y_m, 0.05);
  drag(a, b);
  await settle();
  const warn = root().querySelectorAll(".la3d-warn")[0];
  const hintThen = ed().hint;
  // Raised clear of it (onto it, as a lamp onto a table): the warning goes, and the hint says so.
  slide("Height in room", Math.round((P_.sizeOf(s.recipe).h + 0.01) * 100) / 100); await settle();
  const after = { checks: fur().checks, hint: ed().hint, warn: root().querySelectorAll(".la3d-warn").length };
  check("fit: a piece in another is a warning on its panel and an amber outline, never a block; raised clear, it goes",
    !!p && after.checks.length === 0 && /overlaps the/i.test(hintThen) && warn && /overlaps the/i.test(warn.textContent)
    && after.hint === "It fits here now." && after.warn === 0 && draftPieces()[id].x_m !== p.x_m, { hintThen, after, warn: warn && warn.textContent });
  click("Delete", "la3d-sheet"); await settle();
  slot._furnish().select(sofa); await settle();
});

// ── save ────────────────────────────────────────────────────────────────────
await tryCase("save: one call with the whole draft, every piece whole; the file is then the saved one", async () => {
  const n = server.calls, draft = clone(draftPieces());
  click("Save", "la3d-tools");
  await settle(30);
  const sent = payloads[payloads.length - 1] || {};
  check("save: one call with the whole draft, every piece whole; the file is then the saved one",
    server.calls === n + 1 && JSON.stringify(Object.keys(sent)) === '["pieces"]' && Object.keys(sent.pieces).length === Object.keys(draft).length
    && Object.values(sent.pieces).every(v => v && v.recipe && typeof v.floor_id === "string") && !ed().dirty
    && JSON.stringify(server.file.pieces[sofa]) === JSON.stringify(draftPieces()[sofa]) && server.file.pieces[sofa].entity_id === "light.den",
    { calls: server.calls, keys: Object.keys(sent), dirty: ed().dirty });
});

// ── survive ─────────────────────────────────────────────────────────────────
await tryCase("survive: card rebuilds mid-edit keep the draft, the pick and the camera", async () => {
  click("⟳ 15°", "la3d-sheet"); await settle();
  slot._look(1.3, 0.7, [3, 0, 3], 15);
  const before = { draft: clone(ed().draft), sel: fur().sel, cam: clone(st().cam), dirty: ed().dirty };
  for (let i = 0; i < 3; i++) { poll(); await settle(); }
  const after = { draft: clone(ed().draft), sel: fur().sel, cam: clone(st().cam), dirty: ed().dirty };
  check("survive: card rebuilds mid-edit keep the draft, the pick and the camera",
    before.dirty && JSON.stringify(before) === JSON.stringify(after) && ed().editing && ed().tool === "furnish", { before, after });
});

console.log(JSON.stringify({ cases, failures, payloads }));
