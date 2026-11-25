// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
//
// Furnish's floors and walls (views/live_aboard_finish.js, the owner's item
// 22), run for real inside the real 3D view and editor under the DOM shim, as
// Mapping → Furnish mounts it. Only the GL is a stub.
//
//   none      nothing chosen: the walls one colour all round (their program
//             as before), no material lines, each floor the room's colour
//   open      a tap on a room's floor (nothing picked) opens its panel
//   floor     a material per room: its colour on the floor, its lines laid
//             on that floor, the report's word for it
//   walls     the room's walls inside: that face only, the right way round;
//             the next room's face and the outside as before
//   onewall   one wall a colour of its own, marked while its row is pointed at
//   outside   the floor's outside walls: their outside face, and their ends
//   undo      each choice is one Undo
//   save      one Save sends rooms and floors; the file is then the draft
//   reload    a view opened afresh draws them from the file
//   looks     Classic and Studio draw them; a Showcase theme (the Atlas's
//             look) keeps its own: the house exactly as with nothing chosen
//   cleared   "As drawn" on each: the house exactly as before
//
// usage: live_aboard_finish.mjs <www/padspan-ha dir>
// prints one JSON line: { cases: {name: result}, failures: [...], payloads: [...] }

import { pathToFileURL } from "node:url";
import { join } from "node:path";
import * as shim from "./dom_shim.mjs";
import { installStubGL } from "./stub_gl.mjs";

const WWW = process.argv[2];
if (!WWW) { console.error("usage: live_aboard_finish.mjs <www/padspan-ha dir>"); process.exit(2); }
shim.install();
// Studio puts its vignette beside the canvas (as tests/js/live_aboard_studio.mjs lets it).
{
  const NP = globalThis.Node.prototype;
  if (!NP.insertAdjacentElement) NP.insertAdjacentElement = function(where, el){ return this.parentNode ? this.parentNode.insertBefore(el, this.nextSibling || null) : null; };
}
const docL = {};
document.addEventListener = (t, fn) => { (docL[t] ||= []).push(fn); };
document.removeEventListener = (t, fn) => { docL[t] = (docL[t] || []).filter(f => f !== fn); };
const winL = {};
globalThis.addEventListener = (t, fn) => { (winL[t] ||= []).push(fn); };
globalThis.removeEventListener = (t, fn) => { winL[t] = (winL[t] || []).filter(f => f !== fn); };
installStubGL();

const LA = await import(pathToFileURL(join(WWW, "views", "live_aboard.js")).href);
const FIN = await import(pathToFileURL(join(WWW, "views", "live_aboard_finish.js")).href);

const failures = [], cases = {}, payloads = [];
const check = (name, ok, detail) => { cases[name] = !!ok; if (!ok) failures.push({ name, detail: detail === undefined ? null : detail }); };
const tryCase = async (name, fn) => {
  try { await fn(); } catch (e) { failures.push({ name, detail: String(e && e.stack || e).slice(0, 900) }); cases[name] = false; }
};
const clone = (x) => JSON.parse(JSON.stringify(x));
const settle = async (rounds = 12) => { await shim.flush(rounds); await new Promise(r => globalThis._realSetTimeout(r, 0)); };

// ── the house: Main (Living and Den, their wall at x = 4.55), Upper (Loft) ──
const rect = (floor_id, x0, y0, x1, y1) => ({ type: "poly", floor_id, points_m: [[x0, y0], [x1, y0], [x1, y1], [x0, y1]] });
const MODEL = {
  floors: [{ id: "main", name: "Main" }, { id: "upper", name: "Upper" }],
  room_geometry_m: { Living: rect("main", 0, 0, 4.5, 8), Den: rect("main", 4.6, 0, 10, 8), Loft: rect("upper", 0, 0, 4.5, 8) },
  light_positions_m: {},
};
const EMPTY = { schema: 1, pieces: {}, openings: {}, lights: {}, devices: {}, figures: {} };
const server = { file: clone(EMPTY), calls: 0 };
const editFn = async (changes) => {
  server.calls++;
  payloads.push(clone(changes));
  const next = clone(server.file);
  for (const [sec, entries] of Object.entries(changes)) {
    if (!entries || typeof entries !== "object") continue;
    next[sec] = next[sec] || {};
    for (const [k, v] of Object.entries(entries)) { if (v === null) delete next[sec][k]; else next[sec][k] = clone(v); }
  }
  server.file = next;
  return { data: clone(next), counts: {} };
};
const callWS = async (msg) => {
  if (msg.type === "padspan_ha/house3d_get") return { data: clone(server.file), writable: true, counts: {} };
  if (msg.type === "padspan_ha/model_get") return clone(MODEL);
  if (msg.type === "get_states") return [];
  return {};
};
const slot = LA.liveAboardSlot("finish-harness");
let topIds = new Set(["main"]);
let over = {};
const SENT = [];
const FURNISH = { callWS, toast: () => {}, settings: { atlas_3d_enabled: true }, entities: {} };
const P = () => ({ model: MODEL, floors: MODEL.floors, lightsByEid: {}, hidden: new Set(), topFloorIds: topIds, quality: "low",
  telemetry: (n) => { SENT.push(n); }, states: {}, config: {}, bearing: 0, saveNorth: null, useApi: () => null, haStartedMs: 0,
  load: async () => ({ data: clone(server.file) }), edit: editFn, furnish: FURNISH,
  setTopFloor: (fid) => { topIds = new Set([fid]); poll(); }, ...over });
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
const fin = () => st().finish;
const draft = () => ed().draft || {};
const buttonsIn = (cls) => (cls ? root().querySelectorAll("." + cls)[0] : root()).querySelectorAll("button");
const button = (label, cls) => buttonsIn(cls).find(b => b.textContent === label) || null;
const click = (label, cls) => { const b = button(label, cls); if (!b || b.disabled) return false; b.click(); return true; };
/** The first of several buttons of one label that is not greyed out. */
const clickAny = (label, cls) => { const b = buttonsIn(cls).find(x => x.textContent === label && !x.disabled); if (!b) return false; b.click(); return true; };
const sheetEl = () => root().querySelectorAll(".la3d-sheet")[0];
let seq = 0;
function fire(type, x, y){
  const ev = { type, pointerId: 1, pointerType: "mouse", clientX: x, clientY: y, button: 0, buttons: type === "pointerup" ? 0 : 1, isPrimary: true,
               shiftKey: false, ctrlKey: false, metaKey: false, timeStamp: ++seq, target: canvas(), preventDefault(){}, stopPropagation(){} };
  for (const fn of [...(winL[type] || [])]) fn(ev);
  ev.target.dispatchEvent(ev);
}
const tapAt = (xy) => { fire("pointerdown", xy[0], xy[1]); fire("pointerup", xy[0], xy[1]); };
const inputBy = (label) => sheetEl().querySelectorAll("input").find(i => i.getAttribute("aria-label") === label) || null;
const setColour = (inp, v) => { inp.value = v; inp.dispatchEvent({ type: "change" }); };
const living = (x, y) => x > 0 && x < 4.5 && y > 0 && y < 8, den = (x, y) => x > 4.6 && x < 10 && y > 0 && y < 8;
/** The colour a painted wall shows toward a point on the plan side its +z (fz) or -z faces. */
const faceToward = (w, inRoom) => {
  const fx = w.mx + w.fz[0] * 0.4, fy = w.my + w.fz[1] * 0.4, bx = w.mx - w.fz[0] * 0.4, by = w.my - w.fz[1] * 0.4;
  return inRoom(fx, fy) ? w.front : inRoom(bx, by) ? w.back : null;
};
const tops = () => Object.fromEntries(st().floorTops.map(t => [t.room, t.top]));
const look = () => ({ tops: tops(), cols: clone(fin().cols), program: clone(fin().program), laid: fin().laid.length, two: fin().two.some(x => x.on) });

poll();
await settle(40);
slot._look(0.8, 0.9, [2.2, 0, 4], 18);
await settle();

// ── none ────────────────────────────────────────────────────────────────────
let plain = null;
await tryCase("none: nothing chosen, the walls one colour all round and each floor its room's colour", async () => {
  plain = look();
  check("none: nothing chosen, the walls one colour all round and each floor its room's colour",
    !st().failed && fin().shown && fin().rooms === 0 && fin().walls.length === 0 && plain.laid === 0 && !plain.two
    && plain.program.every(k => k === null || k === "la3d-walltop") && plain.tops.Living && plain.tops.Living !== FIN.MATERIALS.wood.base
    && ed().editing && ed().tool === "furnish", { plain, failed: st().failed });
});

// ── open ────────────────────────────────────────────────────────────────────
await tryCase("open: a tap on a room's floor opens its floor and walls; a tap on another room switches to it", async () => {
  tapAt(slot._whereOf("main", 7.3, 4, 0.0));
  await settle();
  const den1 = fur().room;
  tapAt(slot._whereOf("main", 2.2, 4, 0.0));
  await settle();
  const r = fur().room, text = sheetEl().textContent;
  check("open: a tap on a room's floor opens its floor and walls; a tap on another room switches to it",
    den1 && den1.name === "Den" && r && r.name === "Living" && r.fid === "main" && text.includes("Living: floor and walls")
    && text.includes("Classic and Studio") && sheetEl().querySelectorAll("select").length === 1 && !ed().dirty,
    { den1, r, text: text.slice(0, 200) });
});

// ── floor ───────────────────────────────────────────────────────────────────
await tryCase("floor: wood on Living's floor, its colour and its planks, Den as it was; the report says wood", async () => {
  const sel = sheetEl().querySelectorAll("select")[0];
  const opts = sel.querySelectorAll("option").map(o => o.value);
  sel.value = "wood"; sel.dispatchEvent({ type: "change" });
  await settle();
  const t = tops();
  check("floor: wood on Living's floor, its colour and its planks, Den as it was; the report says wood",
    JSON.stringify(opts) === JSON.stringify(["", ...FIN.FLOOR_MATERIALS]) && draft().rooms.Living.floor === "wood" && ed().dirty
    && t.Living === FIN.MATERIALS.wood.base && t.Den === plain.tops.Den
    && fin().laid.length === 1 && fin().laid[0].floor === "main" && fin().laid[0].material === "wood" && fin().laid[0].inGroup
    && fin().laid[0].joint === FIN.MATERIALS.wood.joint && SENT.includes("house3d_finish:floor:wood") && SENT.includes("house3d_finish:drawn"),
    { opts, rooms: draft().rooms, t, laid: fin().laid, sent: SENT });
});

// ── walls ───────────────────────────────────────────────────────────────────
await tryCase("walls: Living's walls inside, that face only and the right way round; Den's and the outside as before", async () => {
  setColour(inputBy("The colour of its walls"), "#3f6e8c");
  await settle();
  const W = fin().walls.filter(w => w.floor === "main");
  const inside = W.map(w => faceToward(w, living)), other = W.map(w => faceToward(w, (x, y) => !living(x, y)));
  check("walls: Living's walls inside, that face only and the right way round; Den's and the outside as before",
    draft().rooms.Living.wall === "#3f6e8c" && W.length >= 4 && inside.every(c => c === "#3f6e8c")
    && other.every(c => c !== "#3f6e8c") && W.some(w => w.cls === "int" && faceToward(w, den) === "#ebe6dd")
    && fin().two.find(x => x.floor === "main").on && fin().program[0] === "la3d-walltop-two"
    && !fin().two.find(x => x.floor === "upper").on && SENT.includes("house3d_finish:wall"),
    { W, inside, other });
});

// ── one wall ────────────────────────────────────────────────────────────────
await tryCase("onewall: one wall of Living its own colour, marked while pointed at; the rest keep the room's", async () => {
  click("One wall a colour of its own ▾", "la3d-sheet");
  await settle();
  const rows = sheetEl().querySelectorAll("[data-la3d-wall]");
  const row0 = rows.find(r => r.getAttribute("data-la3d-wall") === "0");
  row0.dispatchEvent({ type: "pointerenter" });
  await settle();
  const mark = fur().wallMark;
  setColour(row0.querySelectorAll("input")[0], "#aa3322");
  await settle();
  const W = fin().walls.filter(w => w.floor === "main"), own = W.filter(w => faceToward(w, living) === "#aa3322");
  // Wall 1 (number 0) runs from Living's first corner (0, 0) to its second (4.5, 0).
  const inLine = own.length > 0 && own.every(w => Math.abs(w.my) < 0.2 && w.mx > 0 && w.mx < 4.6);
  check("onewall: one wall of Living its own colour, marked while pointed at; the rest keep the room's",
    rows.length === 4 && mark && mark.name === "Living" && mark.i === 0 && JSON.stringify(draft().rooms.Living.walls) === '{"0":"#aa3322"}'
    && inLine && W.filter(w => faceToward(w, living) === "#3f6e8c").length >= 3 && SENT.includes("house3d_finish:one_wall"),
    { rows: rows.length, mark, walls: draft().rooms.Living.walls, own });
});

// ── outside ─────────────────────────────────────────────────────────────────
await tryCase("outside: Main's outside walls, their outside face and their ends; the inside faces keep theirs", async () => {
  setColour(inputBy("The colour of the outside walls on Main"), "#c8b89a");
  await settle();
  const outside = (x, y) => !living(x, y) && !den(x, y) && !(x >= 4.5 && x <= 4.6 && y > 0 && y < 8);
  const ext = fin().walls.filter(w => w.floor === "main" && w.cls === "ext");
  const capOf = (w) => (w.cap === 0 ? w.front : w.cap === 1 ? w.back : null);
  check("outside: Main's outside walls, their outside face and their ends; the inside faces keep theirs",
    JSON.stringify(draft().floors) === '{"main":{"outside":"#c8b89a"}}' && ext.length >= 6
    && ext.every(w => faceToward(w, outside) === "#c8b89a" && capOf(w) === "#c8b89a")
    && ext.filter(w => faceToward(w, den)).every(w => faceToward(w, den) === "#d6cfc2")
    && SENT.includes("house3d_finish:outside"),
    { ext: ext.map(w => ({ ...w, out: faceToward(w, outside), cap: capOf(w) })) });
});

// ── undo ────────────────────────────────────────────────────────────────────
await tryCase("undo: each choice is one Undo, and Redo brings it back", async () => {
  click("Undo", "la3d-tools"); await settle();
  const a = clone(draft().floors);
  click("Redo", "la3d-tools"); await settle();
  check("undo: each choice is one Undo, and Redo brings it back",
    JSON.stringify(a) === "{}" && draft().floors.main && draft().floors.main.outside === "#c8b89a" && fur().room && fur().room.name === "Living",
    { a, b: draft().floors });
});

// ── save ────────────────────────────────────────────────────────────────────
let drawn = null;
await tryCase("save: one Save sends the rooms and floors; the file is then the draft", async () => {
  drawn = look();
  const n = server.calls;
  click("Save", "la3d-tools");
  await settle(30);
  const sent = payloads[payloads.length - 1] || {};
  check("save: one Save sends the rooms and floors; the file is then the draft",
    server.calls === n + 1 && JSON.stringify(Object.keys(sent)) === '["rooms","floors"]' && !ed().dirty
    && JSON.stringify(server.file.rooms) === JSON.stringify({ Living: { floor: "wood", wall: "#3f6e8c", walls: { 0: "#aa3322" } } })
    && JSON.stringify(server.file.floors) === '{"main":{"outside":"#c8b89a"}}',
    { sent, file: server.file });
});

// ── reload ──────────────────────────────────────────────────────────────────
await tryCase("reload: a view opened afresh draws them from the file", async () => {
  slot.detach();
  over = { furnish: undefined };
  poll(); await settle(40);
  const again = look();
  check("reload: a view opened afresh draws them from the file",
    !st().failed && !(ed() && ed().editing) && JSON.stringify(again.tops) === JSON.stringify(drawn.tops)
    && JSON.stringify(again.cols) === JSON.stringify(drawn.cols) && again.laid === 1 && again.two,
    { again, drawn });
});

// ── looks ───────────────────────────────────────────────────────────────────
await tryCase("looks: Classic and Studio draw them; a Showcase theme keeps its own, exactly as with nothing chosen", async () => {
  over = { furnish: undefined, look3d: "own", showcase3d: false };
  poll(); await settle();
  const classic = { ...look(), key: st().look.key, shown: fin().shown };
  over = { furnish: undefined, look3d: "studio" };
  poll(); await settle();
  const studio = { ...look(), key: st().look.key, shown: fin().shown };
  const themed = { furnish: undefined, look3d: "atlas", atlasLook: { on: true, key: "neo_hud", theme: {} } };
  over = themed;
  poll(); await settle();
  const theme = { ...look(), key: st().look.key, shown: fin().shown };
  // The same theme on the same house with nothing chosen.
  const kept = clone(server.file);
  server.file = clone(EMPTY);
  slot.detach(); poll(); await settle(40);
  const bare = { ...look(), key: st().look.key };
  server.file = kept;
  slot.detach(); poll(); await settle(40);
  const same = (a, b) => JSON.stringify([a.tops, a.cols, a.program, a.laid, a.two]) === JSON.stringify([b.tops, b.cols, b.program, b.laid, b.two]);
  check("looks: Classic and Studio draw them; a Showcase theme keeps its own, exactly as with nothing chosen",
    classic.key === "classic" && classic.shown && classic.tops.Living === FIN.MATERIALS.wood.base && classic.two && classic.laid === 1
    && studio.key === "studio" && studio.shown && same(studio, classic)
    && theme.key === "atlas:neo_hud" && !theme.shown && theme.tops.Living !== FIN.MATERIALS.wood.base && !theme.two && theme.laid === 0
    && same(theme, bare),
    { classic, studio, theme, bare });
});

// ── cleared ─────────────────────────────────────────────────────────────────
await tryCase("cleared: As drawn on each, and the house is exactly as before anything was chosen", async () => {
  over = {};
  slot.detach(); poll(); await settle(40);
  slot._look(0.8, 0.9, [2.2, 0, 4], 18); await settle();
  tapAt(slot._whereOf("main", 2.2, 4, 0.0)); await settle();
  const sel = sheetEl().querySelectorAll("select")[0];
  sel.value = ""; sel.dispatchEvent({ type: "change" }); await settle();
  if (!button("One wall a colour of its own ▴", "la3d-sheet")) { click("One wall a colour of its own ▾", "la3d-sheet"); await settle(); }
  for (let n = 0; n < 10 && clickAny("As drawn", "la3d-sheet"); n++) await settle();
  const now = look();
  click("Save", "la3d-tools"); await settle(30);
  check("cleared: As drawn on each, and the house is exactly as before anything was chosen",
    JSON.stringify(draft().rooms) === "{}" && JSON.stringify(draft().floors) === "{}"
    && JSON.stringify([now.tops, now.cols, now.program, now.laid, now.two]) === JSON.stringify([plain.tops, plain.cols, plain.program, plain.laid, plain.two])
    && JSON.stringify(server.file.rooms) === "{}" && JSON.stringify(server.file.floors) === "{}",
    { now, plain, rooms: draft().rooms, floors: draft().floors, file: server.file });
});

console.log(JSON.stringify({ cases, failures, payloads }));
process.exit(0);
