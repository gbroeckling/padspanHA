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
//   typed     X, Y, Height and Angle typed on its panel: there exactly, each
//             one Undo; a blank changes nothing
//   keys      arrows move the picked piece 1 cm (Shift 10 cm) the way the view
//             is seen, [ and ] turn it 15° (Shift 1°); a run of keys is one
//             Undo; keys typed into a box are the box's
//   gaps      while it is dragged, two short lines to the nearest walls with
//             how far they are; let go, they go; a nudge shows them
//   stand     Stand on what's under it: a lamp onto the table it is over
//   hang      Hang on wall: its back on the nearest wall, its middle at the
//             height asked, facing out; saved as the server keeps it
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
// The page's keys (Furnish's arrows and [ ]), dispatched as the page would.
const docL = {};
document.addEventListener = (t, fn) => { (docL[t] ||= []).push(fn); };
document.removeEventListener = (t, fn) => { docL[t] = (docL[t] || []).filter(f => f !== fn); };
function key(k, o = {}){
  const target = o.target || document.body;
  const ev = { type: "keydown", key: k, code: o.code || "", shiftKey: !!o.shift, ctrlKey: false, metaKey: false, altKey: false,
               defaultPrevented: false, target, composedPath: () => [target], preventDefault(){ this.defaultPrevented = true; }, stopPropagation(){} };
  for (const fn of [...(docL.keydown || [])]) fn(ev);
  return ev;
}
const winL = {};
globalThis.addEventListener = (t, fn) => { (winL[t] ||= []).push(fn); };
globalThis.removeEventListener = (t, fn) => { winL[t] = (winL[t] || []).filter(f => f !== fn); };
installStubGL();

const LA = await import(pathToFileURL(join(WWW, "views", "live_aboard.js")).href);
const P_ = await import(pathToFileURL(join(WWW, "views", "live_aboard_pieces.js")).href);
const FURN = await import(pathToFileURL(join(WWW, "views", "live_aboard_furniture.js")).href).catch(() => null);
const LIB = await import(pathToFileURL(join(WWW, "views", "live_aboard_library.js")).href).catch(() => null);

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
// What the flows read through the host: Home Assistant's states, the house,
// the saved 3D file, and an Import preview (one wall cabinet, high on its wall).
const PREVIEW = { levels: [], openings: {},
  pieces: { fur_0000c0de: { id: "fur_0000c0de", recipe: { kind: "other", width_m: 0.8, depth_m: 0.35, height_m: 0.7 }, label: "Wall cabinet",
                            x_m: 7, y_m: 2, z_m: 2.3, rotation: 0 } },
  report: { pieces: { fur_0000c0de: { name: "Wall cabinet", level_id: null } }, openings: {}, skipped: [], warnings: [] } };
const callWS = async (msg) => {
  ws.push(clone(msg));
  if (msg.type === "config/entity_registry/get") return { id: "0123456789abcdef0123456789abcdef" };
  if (msg.type === "get_states") return Object.values(clone(states));
  if (msg.type === "padspan_ha/model_get") return clone(MODEL);
  if (msg.type === "padspan_ha/house3d_get") return { data: clone(server.file), writable: true, counts: {} };
  if (msg.type === "padspan_ha/house3d_import_preview") return clone(PREVIEW);
  return {};
};
const states = { "media_player.lounge_tv": { entity_id: "media_player.lounge_tv", state: "off", attributes: { friendly_name: "Lounge TV" } },
                 "light.den": { entity_id: "light.den", state: "on", attributes: { friendly_name: "Den light" } },
                 "sensor.den_temp": { entity_id: "sensor.den_temp", state: "21", attributes: { friendly_name: "Den temperature" } },
                 "person.alice": { entity_id: "person.alice", state: "home", attributes: { friendly_name: "Alice" } },
                 "sensor.washer_power": { entity_id: "sensor.washer_power", state: "350", attributes: { friendly_name: "Washer power", unit_of_measurement: "W" } },
                 "binary_sensor.washer_running": { entity_id: "binary_sensor.washer_running", state: "on", attributes: { friendly_name: "Washer running" } } };
// A file picked in the page, read as the browser would (Import).
globalThis.FileReader = class {
  readAsDataURL(f){ Promise.resolve().then(() => { this.result = `data:application/octet-stream;base64,${f._b64}`; if (this.onload) this.onload(); }); }
};

// ── the view, as Mapping → Furnish mounts it ────────────────────────────────
const slot = LA.liveAboardSlot("furnish-harness");
let topIds = null;                               // the host's floor chips (null: every floor)
let over = {};                                   // the card's data on another screen (furnish: null is Mapping → Atlas)
const P = () => ({ ...P0(), ...over });
const P0 = () => ({ model: MODEL, floors: MODEL.floors, lightsByEid: {}, hidden: new Set(), topFloorIds: topIds, quality: "low",
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
  // The starter set first (ready-made pieces), then each builder.
  const starters = FURN && Array.isArray(FURN.STARTER_SET) ? FURN.STARTER_SET.map(st => st.name) : [];
  // The house itself (stairs) after them, under House; the Box last.
  const want = [...starters, ...of("furniture"), ...of("device"), ...(FURN && FURN.FURNITURE.stairs ? ["Stairs"] : []), "Box"];
  check("open: Furnish opens at the furniture tool; Build lists the builders' kinds; a missing flow has no button",
    !st().failed && ed().editing && ed().tool === "furnish" && ed().furnishOn && !shown(button("Door", "la3d-tools"))
    && JSON.stringify(menu) === JSON.stringify(want)
    // A flow shows only when its module is there (each lands from its own phase).
    && FLOW_FILES.every(([id, label, file]) => shown(button(label, "la3d-tools")) === existsSync(join(WWW, "views", file)))
    // (the flows load side by side: in whatever order they arrive)
    && fur().flows && JSON.stringify([...fur().flows].sort()) === JSON.stringify(FLOW_FILES.filter(f => existsSync(join(WWW, "views", f[2]))).map(f => f[0]).sort())
    && st().furnish === true && st().split === "3d",
    { edit: { editing: ed().editing, tool: ed().tool }, menu, want, flows: fur().flows, split: st().split });
});

// ── the starter set ─────────────────────────────────────────────────────────
// Garry, 2026-10-04: "try to recreate what I saw in the preview as a starter
// set"; the first two are the preview's sofa and bed. Each places like any
// piece, with its ready-made recipe, and Undo takes it away again.
await tryCase("starters: the preview's sofa and bed lead the starter set, and each places with its recipe", async () => {
  if (!FURN || !Array.isArray(FURN.STARTER_SET)) { check("starters: the preview's sofa and bed lead the starter set, and each places with its recipe", false, "no STARTER_SET"); return; }
  const [sofaS, bedS] = FURN.STARTER_SET;
  const preview = sofaS.recipe.kind === "sofa" && sofaS.recipe.params.arms === "rolled" && sofaS.recipe.params.seats === 3
    && bedS.recipe.kind === "bed" && bedS.recipe.params.headboard === "slatted" && bedS.recipe.params.footboard === true
    && bedS.recipe.params.size === "queen" && bedS.recipe.width_m === 1.7 && bedS.recipe.depth_m === 2.29 && bedS.recipe.height_m === 1.3;
  const placed = [];
  for (const st of FURN.STARTER_SET) {
    click("Build ▾", "la3d-tools");
    click(st.name, "la3d-furmenu");
    await settle();
    const p = draftPieces()[fur().sel] || {};
    placed.push({ name: st.name, same: JSON.stringify(p.recipe) === JSON.stringify(st.recipe), floor: p.floor_id });
    click("Undo", "la3d-tools"); await settle();
  }
  check("starters: the preview's sofa and bed lead the starter set, and each places with its recipe",
    preview && placed.length === FURN.STARTER_SET.length && placed.every(x => x.same && x.floor) && !ed().dirty,
    { preview, placed: placed.filter(x => !x.same || !x.floor), dirty: ed().dirty });
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

// A washer tells whether it runs through a sensor (its power, a running
// state): "This is a device…" offers those for it, and not for a sofa.
await tryCase("device: a washer can be linked to the sensor that says it runs", async () => {
  if (!FURN) { check("device: a washer can be linked to the sensor that says it runs", true); return; }
  click("Build ▾", "la3d-tools");
  click("Washer", "la3d-furmenu");
  await settle();
  const washer = fur().sel;
  click("This is a device…", "la3d-sheet"); await settle();
  const list = root().querySelectorAll(".la3d-ents")[0].querySelectorAll("button").map(b => b.textContent);
  click("Cancel", "la3d-sheet"); await settle();
  click("Undo", "la3d-tools"); await settle();
  check("device: a washer can be linked to the sensor that says it runs",
    draftPieces()[washer] === undefined && list.some(t => /Washer power/.test(t)) && list.some(t => /Washer running/.test(t)),
    { washer, list });
});

// With every floor showing, the sofa in Living is under the Loft's floor: a
// press there is on the Loft, not on the sofa, and a drag pans.
await tryCase("drag: a piece hidden under the floor above is not picked; a press there pans", async () => {
  const press = (a) => { fire("pointerdown", a[0], a[1]); fire("pointerup", a[0], a[1]); };
  slot._furnish().select(null); await settle();
  topIds = new Set(["main"]); poll(); await settle();
  slot._look(0.8, 0.3, [2.2, 0, 4], 18);              // steeply down: the Loft is between the eye and the sofa
  const a = slot._wherePiece(sofa, 0.05);
  press(a); await settle();
  const seen = fur().sel;
  slot._furnish().select(null); await settle();
  topIds = null; poll(); await settle();
  slot._look(0.8, 0.3, [2.2, 0, 4], 18);
  const before = clone(draftPieces()[sofa]), b = slot._wherePiece(sofa, 0.05);
  press(b); await settle();
  const hidden = fur().sel;
  drag(b, [b[0] + 60, b[1] + 40]); await settle();
  const after = clone(draftPieces()[sofa]);
  topIds = new Set(["main"]); poll(); await settle();
  slot._furnish().select(sofa); await settle();
  check("drag: a piece hidden under the floor above is not picked; a press there pans",
    seen === sofa && hidden !== sofa && after.x_m === before.x_m && after.y_m === before.y_m,
    { seen, hidden, a, b, before: [before.x_m, before.y_m], after: [after.x_m, after.y_m] });
});

// Main and Garage on one storey share a height: Build puts a piece on the
// one under the view's centre, and Floor ▲/▼ reach both.
await tryCase("add: with two floors at the same height, on the one under the view's centre; ▲/▼ reach both", async () => {
  MODEL.floors.splice(2, 0, { id: "garage", name: "Garage", base_elevation_m: 2.8 });
  MODEL.room_geometry_m.Garage = rect("garage", 10.2, 0, 15, 8);
  topIds = new Set(["main"]); poll(); await settle(20);
  slot._look(0.8, 0.9, [12.6, 0, 4], 18);             // looking at the garage
  click("Build ▾", "la3d-tools");
  click(FURN ? "Sofa" : "Box", "la3d-furmenu");
  await settle();
  const id = fur().sel, p = clone(draftPieces()[id] || {});
  const steps = [];
  for (const b of ["Floor ▲", "Floor ▼", "Floor ▲"]) { click(b, "la3d-sheet"); await settle(20); steps.push(draftPieces()[id].floor_id); }
  const text = sheetText(), hint = ed().hint;
  for (let i = 0; i < 4; i++) { click("Undo", "la3d-tools"); await settle(); }
  const gone = !draftPieces()[id];
  MODEL.floors.splice(2, 1);
  delete MODEL.room_geometry_m.Garage;
  topIds = new Set(["main"]); poll(); await settle(20);
  slot._furnish().select(sofa); await settle();
  check("add: with two floors at the same height, on the one under the view's centre; ▲/▼ reach both",
    p.floor_id === "garage" && near(p.x_m, 12.6, 1e-3) && near(p.y_m, 4, 1e-3) && JSON.stringify(steps) === '["upper","main","garage"]'
    && /On Garage/.test(text) && hint === "Moved to Garage." && gone, { p: { floor_id: p.floor_id, x_m: p.x_m, y_m: p.y_m }, steps, text, hint, gone });
});


// ── share ───────────────────────────────────────────────────────────────────
const LIVE = !!(LIB && LIB.LIBRARY_SERVER_LIVE);
await tryCase("share: a piece's panel offers Share only while the shared library's server is live", async () => {
  slot._furnish().select(sofa); await settle();
  check("share: a piece's panel offers Share only while the shared library's server is live",
    !!button("Duplicate", "la3d-sheet") && !!button("Share…", "la3d-sheet") === LIVE, { LIVE, buttons: buttonsIn("la3d-sheet").map(b => b.textContent) });
});

// ── the flows, in Furnish's own box ─────────────────────────────────────────
const flowBox = () => root().querySelectorAll(".la3d-flow")[0] || null;
const flowBody = () => { const b = flowBox(); return b ? b.children[0].children[1] : null; };
const inFlow = (label) => { const b = flowBox(); return b ? b._all().find(n => n.localName === "button" && n.textContent.startsWith(label)) || null : null; };
async function openFlowNamed(label){ click(label, "la3d-tools"); await settle(30); return flowBody(); }
async function closeX(){
  const b = flowBox(), x = b ? b.children[0].children[0].querySelectorAll("button").find(n => n.textContent === "×") : null;
  if (x) x.click();
  await settle(20);
}
await tryCase("flowcss: From a photo and People & devices draw with their own styles in Furnish's box, none in the page's head, and their boxes are not Furnish's", async () => {
  const head0 = document.head.children.length, seen = {};
  for (const label of ["From a photo", "People & devices"]) {
    const body = await openFlowNamed(label);
    const top = body ? body.children.find(c => c.localName !== "style") : null;
    seen[label] = { open: !!top, styles: flowBox() ? flowBox()._all().filter(n => n.localName === "style").length : 0,
                    cls: top ? top.className : null, head: document.head.children.length - head0 };
    await closeX();
  }
  check("flowcss: From a photo and People & devices draw with their own styles in Furnish's box, none in the page's head, and their boxes are not Furnish's",
    Object.values(seen).every(v => v.open && v.styles >= 1 && v.head === 0 && !String(v.cls).split(/\s+/).includes("la3d-flow")), seen);
});
await tryCase("flowclose: × and leaving Furnish end a flow, so it lets go of what it holds", async () => {
  const res = {};
  for (const label of ["Library", "People & devices"]) {
    const body = await openFlowNamed(label);
    const had = !!body && body.children.length > 0;
    await closeX();
    res[label] = { had, left: body ? body.children.length : -1, box: !!flowBox() };
  }
  // Mapping → Atlas with the Library open: it ends too.
  const body = await openFlowNamed("Library");
  over = { furnish: null }; poll(); await settle(20);
  res.leave = { had: !!body, left: body ? body.children.length : -1, box: !!flowBox() };
  over = {}; poll(); await settle(20);
  check("flowclose: × and leaving Furnish end a flow, so it lets go of what it holds",
    ["Library", "People & devices"].every(k => res[k].had && res[k].left === 0 && !res[k].box) && res.leave.had && res.leave.left === 0 && !res.leave.box, res);
});

// ── the flows start from the draft ─────────────────────────────────────────
await tryCase("draft: People & devices starts from Furnish's draft: a figure made and not yet saved is there, with Remove", async () => {
  const aliceRow = () => (flowBox() ? flowBox()._all().find(n => n.className === "item" && /Alice/.test(n.textContent)) : null) || null;
  await openFlowNamed("People & devices");
  const r0 = aliceRow();
  const byHand = r0 ? r0.querySelectorAll("button").find(b => b.textContent === "By hand") : null;
  if (byHand) byHand.click();
  await settle(30);
  if (inFlow("Keep")) inFlow("Keep").click();
  await settle(20);
  if (inFlow("Done")) inFlow("Done").click();
  await settle(20);
  const inDraft = !!((ed().draft || {}).figures || {})["person.alice"];
  await openFlowNamed("People & devices");
  const row = aliceRow(), said = row ? row.textContent : "";
  const remove = !!row && row.querySelectorAll("button").some(b => b.textContent === "Remove");
  if (inFlow("Cancel")) inFlow("Cancel").click();
  await settle(20);
  check("draft: People & devices starts from Furnish's draft: a figure made and not yet saved is there, with Remove",
    inDraft && /Figure made by hand/.test(said) && remove && !(server.file.figures || {})["person.alice"], { inDraft, said, remove });
});
await tryCase("import: Import fits to Furnish's draft (it never reads the saved file), and what comes in sits under its floor's ceiling", async () => {
  const n0 = ws.length;
  await openFlowNamed("Import");
  const input = flowBox() ? flowBox()._all().find(n => n.localName === "input" && n.getAttribute("accept") === ".sh3d") : null;
  if (input) { input.files = [{ name: "cabinet.sh3d", size: 8, _b64: "UEsDBA==" }]; input.dispatchEvent({ type: "change", target: input }); }
  await settle(30);
  if (inFlow("Add 1")) inFlow("Add 1").click();
  await settle(30);
  const id = fur().sel, p = draftPieces()[id] || {}, h = P_.sizeOf(p.recipe || {}).h, top = P_.zMax(CEIL, h);
  const reads = ws.slice(n0).map(m => m.type);
  check("import: Import fits to Furnish's draft (it never reads the saved file)",
    reads.includes("padspan_ha/house3d_import_preview") && !reads.includes("padspan_ha/house3d_get"), reads);
  check("import: what comes in sits under its floor's ceiling",
    p.origin === "import" && p.floor_id === "main" && near(p.z_m, top, 1e-6) && p.z_m < 2.3, { z: p.z_m, floor: p.floor_id, h, top });
  if (p.origin === "import") { click("Delete", "la3d-sheet"); await settle(); }
});

// ── Build with the plan alone ───────────────────────────────────────────────
await tryCase("planbuild: Build with only the plan showing puts the piece in the middle of the plan, where it was moved to", async () => {
  slot._look(0.8, 0.9, [2.2, 0, 4], 18);              // the 3D view (hidden next) looks at Living
  click("Plan"); await settle(20);
  const split = st().split;
  const a = slot._whereOf("main", 7.5, 4, 0.05, true), b = slot._whereOf("main", 5, 4, 0.05, true);
  drag(a, b); await settle(20);
  const plan = st().plan;
  click("Build ▾", "la3d-tools");
  click("Box", "la3d-furmenu");
  await settle();
  const p = draftPieces()[fur().sel] || {};
  check("planbuild: Build with only the plan showing puts the piece in the middle of the plan, where it was moved to",
    split === "plan" && plan.cx > 4.7 && near(p.x_m, plan.cx, 0.02) && near(p.y_m, plan.cy, 0.02), { split, plan, at: [p.x_m, p.y_m] });
  if (p.id) { click("Delete", "la3d-sheet"); await settle(); }
  click("3D"); await settle(20);
});

// ── leaving Furnish ─────────────────────────────────────────────────────────
await tryCase("leave: Furnish left with nothing unsaved ends Edit; back in Furnish the Build bar is there again; unsaved work stays", async () => {
  click("Save", "la3d-tools"); await settle(30);
  const clean = ed().editing && !ed().dirty;
  // Mapping → Atlas with Live Aboard picked: Edit does not come along.
  over = { furnish: null }; poll(); await settle(20);
  const atlas = { editing: ed().editing, tool: ed().tool };
  over = {}; poll(); await settle(20);
  const back1 = { editing: ed().editing, tool: ed().tool, build: shown(button("Build ▾", "la3d-tools")) };
  // Mapping → Atlas with Map picked, then Furnish again.
  slot.detach(); await settle(10);
  poll(); await settle(20);
  const back2 = { editing: ed().editing, tool: ed().tool, build: shown(button("Build ▾", "la3d-tools")) };
  // With unsaved work, Edit and the work stay for Save, as before.
  slot._furnish().select(sofa); click("⟳ 15°", "la3d-sheet"); await settle();
  over = { furnish: null }; poll(); await settle(20);
  const dirtyAtlas = { editing: ed().editing, dirty: ed().dirty };
  over = {}; poll(); await settle(20);
  const back3 = { editing: ed().editing, tool: ed().tool, dirty: ed().dirty };
  click("Save", "la3d-tools"); await settle(30);
  check("leave: Furnish left with nothing unsaved ends Edit; back in Furnish the Build bar is there again; unsaved work stays",
    clean && !atlas.editing && back1.editing && back1.tool === "furnish" && back1.build && back2.editing && back2.tool === "furnish" && back2.build
    && dirtyAtlas.editing && dirtyAtlas.dirty && back3.editing && back3.tool === "furnish" && back3.dirty && !ed().dirty,
    { clean, atlas, back1, back2, dirtyAtlas, back3 });
});

// ── Settings → Remove all furniture ─────────────────────────────────────────
// What settings.js sends once house3d_clear has removed every piece.
const FILE_CHANGED = "padspan-ha-house3d-changed";
function removeAll(){
  server.file = { ...clone(server.file), pieces: {} };
  for (const fn of [...(winL[FILE_CHANGED] || [])]) fn({ type: FILE_CHANGED });
}
await tryCase("cleared: Remove all furniture reaches an open view: its pieces go, and a removed one is never saved back", async () => {
  const had = Object.keys(server.file.pieces).length;
  removeAll(); await settle(30);
  const a = { drawn: st().pieces.length, draft: Object.keys(draftPieces()).length, dirty: ed().dirty, editing: ed().editing };
  // With unsaved work: the removed pieces leave the draft, Undo too; what was added since stays.
  const kept = slot._furnish().build("box"); await settle();
  click("Save", "la3d-tools"); await settle(30);
  const fresh = slot._furnish().build("box"); await settle();
  slot._furnish().select(kept); click("⟳ 15°", "la3d-sheet"); await settle();
  removeAll(); await settle(30);
  const b = { draft: Object.keys(draftPieces()).sort(), dirty: ed().dirty };
  const seen = [];
  for (let i = 0; i < 6 && ed().canUndo; i++) { click("Undo", "la3d-tools"); await settle(); seen.push(...Object.keys(draftPieces())); }
  for (let i = 0; i < 6 && ed().canRedo; i++) { click("Redo", "la3d-tools"); await settle(); seen.push(...Object.keys(draftPieces())); }
  const n = payloads.length;
  click("Save", "la3d-tools"); await settle(30);
  const sent = payloads.slice(n).map(c => Object.keys(c.pieces || {})).flat();
  check("cleared: Remove all furniture reaches an open view: its pieces go, and a removed one is never saved back",
    had > 0 && a.drawn === 0 && a.draft === 0 && !a.dirty && a.editing
    && JSON.stringify(b.draft) === JSON.stringify([fresh]) && b.dirty && !seen.includes(kept)
    && !sent.includes(kept) && !server.file.pieces[kept] && !!server.file.pieces[fresh],
    { had, a, b, kept, fresh, seen, sent });
});

// ── placing exactly ─────────────────────────────────────────────────────────
const typeIn = (name, v) => { const r = slider(name); if (!r) return false; r.value = String(v); r.dispatchEvent({ type: "change" }); return true; };
// A press on the bare floor of Living (the view the keys then follow), then the piece picked.
const pressOn = async (id) => { const a = slot._whereOf("main", 0.6, 7.4, 0); fire("pointerdown", a[0], a[1]); fire("pointerup", a[0], a[1]); await settle(); slot._furnish().select(id); await settle(); };
let table = null;
await tryCase("typed: X, Y, Height and Angle typed on the panel put it there exactly, each one Undo; a blank changes nothing", async () => {
  slot._look(0, 0.9, [2.2, 0, 4], 18);
  for (const id of Object.keys(draftPieces())) { slot._furnish().select(id); click("Delete", "la3d-sheet"); await settle(); }   // a clear room
  table = slot._furnish().build("table"); await settle();
  const boxes = ["X on the plan", "Y on the plan", "Height above the floor", "Angle"].map(n => !!slider(n));
  typeIn("X on the plan", 2.345); await settle();
  typeIn("Y on the plan", 4.5); await settle();
  typeIn("Angle", 37.5); await settle();
  typeIn("Height above the floor", 9); await settle();               // kept under the ceiling
  const p = clone(draftPieces()[table]);
  typeIn("X on the plan", ""); await settle();
  const blank = { x: draftPieces()[table].x_m, box: slider("X on the plan").value };
  click("Undo", "la3d-tools"); await settle();
  const undone = clone(draftPieces()[table]);
  click("Redo", "la3d-tools"); await settle();
  typeIn("Height above the floor", 0); await settle();
  check("typed: X, Y, Height and Angle typed on the panel put it there exactly, each one Undo; a blank changes nothing",
    boxes.every(Boolean) && p.x_m === 2.345 && p.y_m === 4.5 && p.rotation === 37.5 && near(p.z_m, CEIL - 0.75, 1e-9)
    && blank.x === 2.345 && blank.box === "2.345" && near(undone.z_m, 0) && undone.rotation === 37.5 && undone.x_m === 2.345
    && draftPieces()[table].z_m === 0 && sheetText().includes("Arrow keys move it 1 cm"), { boxes, p, blank, undone });
});
await tryCase("keys: arrows move it 1 cm (Shift 10 cm) the way the view is seen, [ and ] turn it 15° (Shift 1°); a run is one Undo; never while typing", async () => {
  await pressOn(table);                                               // the 3D view pressed: the keys go its way
  const r0 = fur().right, p0 = clone(draftPieces()[table]);
  const evs = [key("ArrowRight"), key("ArrowRight"), key("ArrowRight", { shift: true })];
  await settle();
  const p1 = clone(draftPieces()[table]), want = P_.arrowStep("ArrowRight", r0, 0.12);
  click("Undo", "la3d-tools"); await settle();
  const undone = clone(draftPieces()[table]);
  click("Redo", "la3d-tools"); await settle();
  key("["); await settle();
  const t1 = draftPieces()[table].rotation;
  key("]", { shift: true }); await settle();
  const t2 = draftPieces()[table].rotation;
  key("}", { shift: true, code: "BracketRight" }); await settle();
  const t3 = draftPieces()[table].rotation;
  const box = slider("X on the plan"), x0 = draftPieces()[table].x_m;
  const typing = key("ArrowLeft", { target: box }); await settle();
  const typed = { moved: draftPieces()[table].x_m !== x0, prevented: typing.defaultPrevented };
  // The view turned a quarter: Right moves it another way on the plan.
  slot._look(Math.PI / 2, 0.9, [2.2, 0, 4], 18);
  await pressOn(table);
  const r1 = fur().right, q0 = clone(draftPieces()[table]);
  key("ArrowRight"); await settle();
  const q1 = clone(draftPieces()[table]), want1 = P_.arrowStep("ArrowRight", r1, 0.01);
  check("keys: arrows move it 1 cm (Shift 10 cm) the way the view is seen, [ and ] turn it 15° (Shift 1°); a run is one Undo; never while typing",
    evs.every(e => e.defaultPrevented) && near(p1.x_m - p0.x_m, want[0], 1e-6) && near(p1.y_m - p0.y_m, want[1], 1e-6) && near(Math.hypot(...want), 0.12, 1e-9)
    && undone.x_m === p0.x_m && undone.y_m === p0.y_m && t1 === 30 && t2 === 31 && t3 === 32 && !typed.moved && !typed.prevented
    && Math.abs(r0[0] * r1[0] + r0[1] * r1[1]) < 0.1 * Math.hypot(...r0) * Math.hypot(...r1)
    && near(q1.x_m - q0.x_m, want1[0], 1e-6) && near(q1.y_m - q0.y_m, want1[1], 1e-6) && fur().keys === true,
    { r0, r1, p0, p1, want, undone, t: [t1, t2, t3], typed, q0, q1, want1 });
});
await tryCase("gaps: while it is dragged, two short lines say how far the nearest walls are; let go, they go; a nudge shows them", async () => {
  click("Plan"); await settle(20);                                   // on the plan, nothing stands in front of it
  const a = slot._wherePiece(table, 0.3, true);
  fire("pointerdown", a[0], a[1]);
  for (let i = 1; i <= 6; i++) fire("pointermove", a[0] + i * 4, a[1] + i * 3);
  await settle();
  const during = clone(fur().gaps);
  fire("pointerup", a[0] + 24, a[1] + 18); await settle();
  const after = clone(fur().gaps);
  key("ArrowDown"); await settle();
  const nudged = clone(fur().gaps);
  click("3D"); await settle(20);
  const axis = (g) => (g.side === "back" || g.side === "front" ? "depth" : "width");
  check("gaps: while it is dragged, two short lines say how far the nearest walls are; let go, they go; a nudge shows them",
    during.length === 2 && during.every(g => g.shown && g.d >= 0 && g.d < 8 && g.label === `${g.d.toFixed(2)} m`) && new Set(during.map(axis)).size === 2
    && after.length === 0 && nudged.length === 2 && nudged.every(g => g.shown), { during, after, nudged });
});
await tryCase("stand: Stand on what's under it puts a lamp onto the table it is over, one Undo; nothing under it, the floor", async () => {
  const t = clone(draftPieces()[table]);
  const lamp = slot._furnish().build("lamp"); await settle();
  typeIn("X on the plan", t.x_m + 0.1); await settle();
  typeIn("Y on the plan", t.y_m); await settle();
  click("Stand on what's under it", "la3d-sheet"); await settle();
  const on = clone(draftPieces()[lamp]), hint1 = ed().hint;
  click("Undo", "la3d-tools"); await settle();
  const undone = draftPieces()[lamp].z_m;
  click("Redo", "la3d-tools"); await settle();
  typeIn("X on the plan", t.x_m + 3); await settle();
  click("Stand on what's under it", "la3d-sheet"); await settle();
  const off = clone(draftPieces()[lamp]), hint2 = ed().hint;
  check("stand: Stand on what's under it puts a lamp onto the table it is over, one Undo; nothing under it, the floor",
    near(on.z_m, 0.75, 1e-9) && hint1 === "On the table." && undone === 0 && off.z_m === 0 && hint2 === "On the floor: nothing is under it.",
    { on, hint1, undone, off, hint2 });
  click("Delete", "la3d-sheet"); await settle();
});
await tryCase("hang: Hang on wall puts its back flat on the nearest wall with its middle at the height asked, facing out, one Undo", async () => {
  const tv = slot._furnish().build("tv"); await settle();
  typeIn("X on the plan", 2.2); await settle();
  typeIn("Y on the plan", 0.9); await settle();
  typeIn("Angle", 120); await settle();
  typeIn("Hang height", 1.5); await settle();
  click("Hang on wall", "la3d-sheet"); await settle();
  const p = clone(draftPieces()[tv]), s = P_.sizeOf(p.recipe), hint = ed().hint;
  const backGap = p.y_m - s.d / 2;                                   // Living's back wall: its face near y = 0
  click("Undo", "la3d-tools"); await settle();
  const undone = clone(draftPieces()[tv]);
  click("Redo", "la3d-tools"); await settle();
  click("Save", "la3d-tools"); await settle(30);                     // what was placed exactly, as the server takes it
  check("hang: Hang on wall puts its back flat on the nearest wall with its middle at the height asked, facing out, one Undo",
    p.rotation === 0 && backGap > -0.02 && backGap < 0.12 && near(p.z_m + s.h / 2, 1.5, 1e-3) && near(p.x_m, 2.2, 1e-3) && /^On the wall, its middle 1\.50 m up\.$/.test(hint)
    && undone.y_m === 0.9 && undone.rotation === 120 && undone.z_m === 0 && !!server.file.pieces[tv] && server.file.pieces[tv].rotation === 0,
    { p, backGap, hint, undone });
});

await tryCase("hang: Enter in the height box hangs it at the height just typed (no change event first)", async () => {
  const tv = slot._furnish().build("tv"); await settle();
  typeIn("X on the plan", 2.2); await settle();
  typeIn("Y on the plan", 0.9); await settle();
  const box = slider("Hang height");
  box.value = "1.8";
  box.dispatchEvent({ type: "keydown", key: "Enter", stopPropagation(){}, preventDefault(){} });
  await settle();
  const p = clone(draftPieces()[tv]), s = P_.sizeOf(p.recipe), hint = ed().hint;
  check("hang: Enter in the height box hangs it at the height just typed (no change event first)",
    near(p.z_m + s.h / 2, 1.8, 1e-3) && /^On the wall, its middle 1\.80 m up\.$/.test(hint), { p, hint });
  click("Delete", "la3d-sheet"); await settle();
});

console.log(JSON.stringify({ cases, failures, payloads, live: LIVE }));
