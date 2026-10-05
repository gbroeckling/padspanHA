// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
//
// Live Aboard Edit → Strip (views/live_aboard_strip.js), run for real inside
// the real 3D view and editor (views/live_aboard.js, live_aboard_edit.js)
// under the DOM shim. Only the GL is a stub: the walls, the camera, the
// presses, the draft, Undo, Redo and Save are the shipped code.
//
// The house: Main, an L-shaped Living Room and a galley Kitchen with a door
// between them, a TV on the living room wall (a piece of furniture), and a
// raised Upper Deck outside.
//
//   tool      Edit has Strip; it lists the lights to lay out (strips first)
//   draw      press on a wall and drag: the run follows it round the corner,
//             the length and the next corner show as it goes; or tap points
//             and double-tap (a tap off any wall is a free point)
//   areas     Round this room (gaps at the door), Behind the TV piece, Along
//             a rail, Continue from another light's run
//   height    chips, typed cm for the run or a point, the middle handle and an
//             end's handle dragged (snapping to a chip), ↑/↓ 1 cm and 10 cm
//   face      which way it shines; a string's swag and bulb spacing
//   edit      tap the run to add a point, delete it, remove the run; Undo, Redo
//   piece     the TV moved by Furnish takes its run along; deleted, the run
//             stays where it was in the same Undo step
//   heights   Heights on a light laid out with Strip sends it there, and its
//             kind change keeps the run
//   save      one call, exactly the draft's changes (test_live_aboard_strip.py
//             feeds each through the server's own apply_edit)
//
// usage: live_aboard_strip.mjs <www/padspan-ha dir>
// prints one JSON line: { cases: {name: result}, failures: [...], payloads: [...], start: {...} }

import { pathToFileURL } from "node:url";
import { join } from "node:path";
import * as shim from "./dom_shim.mjs";
import { installStubGL } from "./stub_gl.mjs";

const WWW = process.argv[2];
if (!WWW) { console.error("usage: live_aboard_strip.mjs <www/padspan-ha dir>"); process.exit(2); }
shim.install();
const winL = {}, docL = {};
globalThis.addEventListener = (t, fn) => { (winL[t] ||= []).push(fn); };
globalThis.removeEventListener = (t, fn) => { winL[t] = (winL[t] || []).filter(f => f !== fn); };
document.addEventListener = (t, fn) => { (docL[t] ||= []).push(fn); };
document.removeEventListener = (t, fn) => { docL[t] = (docL[t] || []).filter(f => f !== fn); };
installStubGL();

const LA = await import(pathToFileURL(join(WWW, "views", "live_aboard.js")).href);
const R = await import(pathToFileURL(join(WWW, "views", "live_aboard_runs.js")).href);

const failures = [], cases = {}, payloads = [];
const check = (name, ok, detail) => { cases[name] = !!ok; if (!ok) failures.push({ name, detail: detail === undefined ? null : detail }); };
const tryCase = async (name, fn) => { try { await fn(); } catch (e) { failures.push({ name, detail: String(e && e.stack || e).slice(0, 900) }); cases[name] = false; } };
const clone = (x) => JSON.parse(JSON.stringify(x));
const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;
const settle = async (rounds = 12) => { await shim.flush(rounds); await new Promise(r => globalThis._realSetTimeout(r, 0)); };

// ── the house, the 3D file, the server ──────────────────────────────────────
const MODEL = {
  floors: [{ id: "ground", name: "Ground", floor_to_floor_m: 3 }, { id: "main", name: "Main", floor_to_floor_m: 2.3 }],
  floor_elevations: { ground: 0, main: 3 },
  room_geometry_m: {
    "Living Room": { type: "poly", floor_id: "main", points_m: [[0.65, -8], [7.9, -8], [7.9, 1], [1.9, 1], [1.9, -3], [0.65, -3]] },
    Kitchen: { type: "poly", floor_id: "main", points_m: [[8.0, -6], [9.8, -6], [9.8, 0.4], [8.0, 0.4]] },
    "Upper Deck": { type: "poly", floor_id: "main", points_m: [[-3, -2], [0.5, -2], [0.5, 4], [-3, 4]] },
    Shed: { type: "poly", floor_id: "ground", points_m: [[20, 0], [24, 0], [24, 3], [20, 3]] },
  },
  rf_barriers_m: [{ id: "bar_kdoor", name: "Kitchen door", material: "custom", floor_id: "main", points_m: [[7.95, -2.0], [7.95, -1.1]] }],
  light_positions_m: {
    "light.under": { x_m: 9.5, y_m: -3, floor_id: "main", width_cm: 150, height_cm: 1, rotation: 150 },
    "light.cove": { x_m: 4, y_m: -5, floor_id: "main" },
    "light.tv": { x_m: 1.2, y_m: -5.5, floor_id: "main" },
    "light.deck": { x_m: -1, y_m: 1, floor_id: "main" },
    "light.pendant": { x_m: 5, y_m: -1, floor_id: "main" },
  },
};
const lt = (eid, name, extra = {}) => ({ entity_id: eid, friendly_name: name, state: "on", brightness: 200, rgb: [255, 170, 90], ...extra });
const LBE = { "light.under": lt("light.under", "Kitchen under cabinet strip"), "light.cove": lt("light.cove", "Living cove"),
              "light.tv": lt("light.tv", "TV backlight"), "light.deck": lt("light.deck", "Deck lights"),
              "light.pendant": lt("light.pendant", "Island pendant", { shape: "pendant" }) };
const TV = { id: "fur_000000aa", recipe: { kind: "tv", params: { screen_in: 55, unit: "none", mount: "wall" }, colors: ["#6e5039", "#1f2124"],
             width_m: 1.3, depth_m: 0.08, height_m: 0.8 }, origin: "build", label: "", library_id: null, submission_id: null,
             floor_id: "main", x_m: 0.71, y_m: -5.5, z_m: 0.95, rotation: 270, entity_id: null, entity_reg_id: null };
const FILE0 = { schema: 1, openings: {}, lights: {}, devices: {}, pieces: { [TV.id]: TV }, figures: {}, library: {} };
const server = { file: clone(FILE0) };
const editFn = async (changes) => {
  payloads.push(clone(changes));
  const next = clone(server.file);
  for (const [sec, entries] of Object.entries(changes)) for (const [k, v] of Object.entries(entries)) { if (v === null) delete next[sec][k]; else next[sec][k] = clone(v); }
  server.file = next;
  return { data: clone(next), counts: {} };
};
const api = { calls: [], toast(){}, toggle(){}, openRoom(){}, openFloor(){}, openControls(){}, openActivity(){}, controlsFor: () => null, lightsByEid: {}, hass: null };

// ── the view ────────────────────────────────────────────────────────────────
const slot = LA.liveAboardSlot("strip-harness");
let over = {};                                   // the card's data on another screen (furnish: Mapping → Furnish)
const P = () => ({ model: MODEL, floors: MODEL.floors, lightsByEid: LBE, hidden: new Set(), topFloorIds: null, quality: "low",
  telemetry: () => {}, states: {}, config: {}, bearing: 0, saveNorth: null, useApi: () => api, haStartedMs: 0,
  load: async () => ({ data: clone(server.file) }), edit: editFn, ...over });
function poll(){
  const card = document.createElement("div"), stage = document.createElement("div");
  card.appendChild(stage);
  document.body.replaceChildren(card);
  return slot.attach(stage, P());
}
const st = () => slot._state();
const ed = () => st().edit;
const S = () => slot._strip();
const sst = () => ed().strip;
const root = () => slot.element;
const canvas = () => st().canvas;
const sheet = () => root().querySelectorAll(".la3d-sheet")[0];
function button(label, cls){
  const box = cls ? root().querySelectorAll("." + cls)[0] : root();
  return box ? box.querySelectorAll("button").find(b => b.textContent === label) || null : null;
}
const click = (label, cls) => { const b = button(label, cls); if (!b || b.disabled) return false; b.click(); return true; };
const inSheet = (tag, aria) => sheet().querySelectorAll(tag).find(x => x.getAttribute("aria-label") === aria) || null;
function pickKind(k){ const s = inSheet("select", "What is this?"); s.value = k; s.dispatchEvent({ type: "change" }); }
let seq = 0;
function fire(type, x, y, o = {}){
  const ev = { type, pointerId: o.id ?? 1, pointerType: o.kind ?? "mouse", clientX: x, clientY: y, button: 0,
               buttons: type === "pointerup" ? 0 : 1, isPrimary: true, shiftKey: false, ctrlKey: false, metaKey: false,
               timeStamp: ++seq, target: canvas(), preventDefault(){}, stopPropagation(){} };
  for (const fn of [...(winL[type] || [])]) fn(ev);
  ev.target.dispatchEvent(ev);
  return ev;
}
function dragPath(pts, o = {}){
  fire("pointerdown", pts[0][0], pts[0][1], o);
  for (let k = 1; k < pts.length; k++) for (let i = 1; i <= 6; i++) fire("pointermove", pts[k - 1][0] + (pts[k][0] - pts[k - 1][0]) * i / 6, pts[k - 1][1] + (pts[k][1] - pts[k - 1][1]) * i / 6, o);
}
const tap = (p, o = {}) => { fire("pointerdown", p[0], p[1], o); fire("pointerup", p[0], p[1], o); };
const key = (k, shift = false) => { const e = { type: "keydown", key: k, shiftKey: shift, ctrlKey: false, metaKey: false, altKey: false, defaultPrevented: false,
  target: document.body, composedPath: () => [document.body], preventDefault(){ this.defaultPrevented = true; } }; for (const fn of [...(docL.keydown || [])]) fn(e); return e; };
const run = (eid) => ((ed().draft.lights[eid] || {}).run) || null;
const w = (x, y, h) => S().whereOf(x, y, h);
const CEIL = 2.3 - 0.15;

poll();
await settle(40);
const start = clone(server.file);

await tryCase("tool: Edit has Strip, and it lists the lights to lay out first", async () => {
  click("Edit");
  await settle();
  const has = !!button("Strip", "la3d-tools");
  click("Strip", "la3d-tools");
  await settle();
  const heads = sheet().querySelectorAll("h5").map(h => h.textContent);
  const rows = sheet().querySelectorAll("button").filter(b => b.dataset && b.dataset.eid).map(b => b.dataset.eid);
  check("tool: Edit has Strip, and it lists the lights to lay out first", has && ed().tool === "strip" && sst().shown
    && heads[0] === "Lights to lay out" && rows[0] === "light.under" && rows.indexOf("light.pendant") > rows.indexOf("light.under"),
    { heads, rows, tool: ed().tool });
});

await tryCase("draw: press on the kitchen wall and drag: round the corner, the length and the corner as it goes", async () => {
  sheet().querySelectorAll("button").find(b => b.dataset && b.dataset.eid === "light.under").click();
  await settle();
  slot._look(-Math.PI / 2, 0.95, [8.9, 3.9, -3.2], 7);
  await settle();
  click("Draw", "la3d-sheet");
  const path = [[9.785, -1.2], [9.785, -3.5], [9.785, -5.5], [9.6, -5.985], [9.0, -5.985]].map(([x, y]) => w(x, y, 1.4));
  dragPath(path);
  const during = { len: sst().lenText, corner: sst().cornerText, gesture: sst().gesture };
  fire("pointerup", ...path[path.length - 1]);
  await settle();
  const r = run("light.under");
  check("draw: press on the kitchen wall and drag: round the corner, the length and the corner as it goes", !!r && r.pts.length === 3
    && near(r.pts[1][0], 9.785, 0.01) && near(r.pts[1][1], -5.985, 0.01) && r.pts.every(p => near(p[2], 1.4, 0.03)) && r.face === "down"
    && during.gesture === "draw" && /m$/.test(during.len || "") && /to the corner$/.test(during.corner || "") && sst().handles.mid,
    { r, during, path, hint: ed().hint });
});

await tryCase("height: chips, typed cm, a point's own height", async () => {
  click("Valance 210 cm", "la3d-sheet");
  const a = run("light.under").pts.map(p => p[2]);
  const inp = inSheet("input", "Height in cm");
  inp.value = "150"; inp.dispatchEvent({ type: "change" });
  const b = run("light.under").pts.map(p => p[2]);
  S().pickPoint(2);
  const inp2 = inSheet("input", "Height in cm");
  inp2.value = "120"; inp2.dispatchEvent({ type: "change" });
  const c = run("light.under").pts.map(p => p[2]);
  S().pickPoint(null);
  check("height: chips, typed cm, a point's own height", a.every(h => h === 2.1) && b.every(h => h === 1.5) && JSON.stringify(c) === "[1.5,1.5,1.2]",
    { a, b, c });
});

await tryCase("height: the middle handle raises it all and snaps to a chip; an end's handle tilts it", async () => {
  click("Under cabinets 140 cm", "la3d-sheet");
  const mid = S().handleAt("mid"), up1 = w(9.785, -3.985, 1.52), up2 = w(9.785, -3.985, 2.2);
  const dy = up2[1] - up1[1];
  dragPath([mid, [mid[0], mid[1] + dy]]);
  const during = sst().gesture;
  fire("pointerup", mid[0], mid[1] + dy);
  await settle();
  const a = run("light.under").pts.map(p => p[2]);                    // 2.08 is within 3 cm of Valance 2.10
  const e0 = S().handleAt("end0"), lift = w(9.785, -1.2, 1.7)[1] - w(9.785, -1.2, 2.1)[1];      // down the screen: lower
  dragPath([e0, [e0[0], e0[1] + lift]]);
  fire("pointerup", e0[0], e0[1] + lift);
  await settle();
  const b = run("light.under").pts.map(p => p[2]);
  check("height: the middle handle raises it all and snaps to a chip; an end's handle tilts it", during === "height"
    && a.every(h => h === 2.1) && b[0] < 1.95 && b[1] === 2.1 && b[2] === 2.1, { a, b });
});

await tryCase("height: ↑/↓ 1 cm, Shift 10 cm, for the run or the point picked", async () => {
  S().pickPoint(null);
  click("Under cabinets 140 cm", "la3d-sheet");
  key("ArrowUp"); key("ArrowUp", true);
  const a = run("light.under").pts.map(p => p[2]);
  S().pickPoint(0);
  key("ArrowDown", true);
  const b = run("light.under").pts.map(p => p[2]);
  S().pickPoint(null);
  check("height: ↑/↓ 1 cm, Shift 10 cm, for the run or the point picked", a.every(h => near(h, 1.51)) && near(b[0], 1.41) && near(b[1], 1.51), { a, b });
  click("Under cabinets 140 cm", "la3d-sheet");
});

await tryCase("face: which way it shines", async () => {
  click("Onto the wall", "la3d-sheet");
  const a = run("light.under").face;
  click("Down", "la3d-sheet");
  check("face: which way it shines", a === "wall" && run("light.under").face === "down", a);
});

await tryCase("edit: tap the run to add a point, delete it; Undo and Redo", async () => {
  const n0 = run("light.under").pts.length, at = w(9.785, -3.0, 1.4);
  tap(at);
  await settle();
  const added = run("light.under").pts.length, sel = sst().ptSel;
  click("Delete point", "la3d-sheet");
  const after = run("light.under").pts.length;
  click("Undo", "la3d-tools"); await settle();
  const undone = run("light.under").pts.length;
  click("Redo", "la3d-tools"); await settle();
  check("edit: tap the run to add a point, delete it; Undo and Redo", added === n0 + 1 && sel === 1 && after === n0 && undone === n0 + 1
    && run("light.under").pts.length === n0, { n0, added, sel, after, undone });
});

await tryCase("draw: points tapped one at a time, a double-tap ends it", async () => {
  S().select("light.deck");
  await settle();
  pickKind("string");
  await settle();
  slot._look(Math.PI, 0.7, [-1.2, 4, 1], 12);
  await settle();
  click("Draw", "la3d-sheet");
  const pts = [[0.3, -1.6], [-2.6, -0.8], [0.3, 0.8], [-2.6, 2.4]].map(([x, y]) => w(x, y, R.mm(Math.min(CEIL - 0.05, 2.3))));
  for (const p of pts.slice(0, -1)) { tap(p); await settle(2); }
  tap(pts[3]); tap(pts[3]);
  await settle();
  const r = run("light.deck");
  check("draw: points tapped one at a time, a double-tap ends it", !!r && r.pts.length === 4 && r.sag_m === 0.25 && r.spacing_m === 0.4
    && ed().draft.lights["light.deck"].kind === "string", { r, hint: ed().hint });
});

await tryCase("face: a string's swag and how far apart its bulbs are", async () => {
  const sag = inSheet("input", "Swag"), sp = inSheet("input", "Bulbs every, cm");
  sag.value = "0.6"; sag.dispatchEvent({ type: "input" });
  const sp2 = inSheet("input", "Bulbs every, cm") || sp;
  sp2.value = "25"; sp2.dispatchEvent({ type: "change" });
  const r = run("light.deck");
  check("face: a string's swag and how far apart its bulbs are", r.sag_m === 0.6 && r.spacing_m === 0.25, r);
});

await tryCase("areas: Along a rail: the deck's rail top all round", async () => {
  slot._look(Math.PI, 0.7, [-1.2, 4, 1], 12);
  await settle();
  click("Along a rail", "la3d-sheet");
  tap(w(-1.2, 1.0, 0));
  await settle();
  const r = run("light.deck");
  click("Undo", "la3d-tools"); await settle();
  check("areas: Along a rail: the deck's rail top all round", !!r && r.loop && r.pts.every(p => p[2] === R.RAIL_TOP_M)
    && !r.gaps && run("light.deck").pts.length === 4, { r, hint: ed().hint });
});

await tryCase("areas: Round this room leaves a gap at the door", async () => {
  S().select("light.cove");
  await settle();
  pickKind("cove");
  click("Round this room", "la3d-sheet");
  const ticks = sheet().querySelectorAll("input").filter(i => i.type === "checkbox").map(i => i.checked);
  slot._look(-Math.PI / 2, 0.6, [4.3, 3.6, -3.5], 16);
  await settle();
  tap(w(3.5, -5.5, 0));
  await settle();
  const r = run("light.cove");
  // The cove chip (2.00 m) is under the door's head (2.03 m): wire past it.
  check("areas: Round this room leaves a gap at the door", JSON.stringify(ticks) === "[true,false]" && !!r && r.loop && r.face === "up"
    && (r.gaps || []).length === 1 && r.pts.every(p => near(p[2], 2.0)), { r, ticks, hint: ed().hint });
});

await tryCase("areas: Behind the TV: a loop on its back, on the piece", async () => {
  S().select("light.tv");
  await settle();
  pickKind("tv");
  slot._look(Math.PI / 2, 1.1, [1.0, 4.3, -5.5], 5);
  await settle();
  click("Behind", "la3d-sheet");
  const ok = S().roundPieceId(TV.id, "behind");                      // the tap on the piece needs real picking (GL): straight to it
  const r = run("light.tv");
  check("areas: Behind the TV: a loop on its back, on the piece", ok && r.piece === TV.id && r.loop && r.face === "wall", r);
});

await tryCase("piece: moved, the run goes with it; deleted in Furnish, it stays where it was (one Undo)", async () => {
  const before = R.placed(run("light.tv"), ed().draft.pieces).pts;
  const now = R.placed(run("light.tv"), { [TV.id]: { ...TV, y_m: -4.5 } }).pts;
  over = { furnish: { callWS: async () => ({}), toast(){}, settings: { atlas_3d_enabled: true }, entities: {} } };
  poll(); await settle(20);
  slot._furnish().select(TV.id); await settle();
  const del = click("Delete", "la3d-sheet"); await settle();
  const after = run("light.tv"), pieceGone = !ed().draft.pieces[TV.id];
  click("Undo", "la3d-tools"); await settle();
  const back = run("light.tv");
  over = {}; poll(); await settle(20);
  check("piece: moved, the run goes with it; deleted in Furnish, it stays where it was (one Undo)", now.every((p, i) => near(p[1] - before[i][1], 1, 2e-3))
    && del && pieceGone && !!after && !after.piece && after.pts.every((p, i) => p.every((v, k) => near(v, before[i][k], 2e-3)))
    && back.piece === TV.id && !!ed().draft.pieces[TV.id], { after, back: back && back.piece, del, pieceGone, tool: ed().tool });
  if (ed().tool !== "strip") click("Strip", "la3d-tools");
  await settle();
});

await tryCase("heights: a light laid out with Strip opens there; its kind changed keeps its run", async () => {
  if (ed().tool !== "heights") click("Heights", "la3d-tools");
  await settle();
  const r0 = run("light.under");
  slot._look(-Math.PI / 2, 0.95, [8.9, 3.9, -3.2], 7);
  await settle();
  tap(w(9.785, -3.5, 1.4));
  await settle();
  const text = sheet().textContent;
  const kindSel = inSheet("select", "What is this?");
  kindSel.value = "strip"; kindSel.dispatchEvent({ type: "change" });
  await settle();
  const e = ed().draft.lights["light.under"];
  const go = button("Lay it out in Strip", "la3d-sheet");
  if (go) go.click();
  await settle();
  check("heights: a light laid out with Strip opens there; its kind changed keeps its run", /Laid out with Strip/.test(text) && e.kind === "strip"
    && JSON.stringify(e.run) === JSON.stringify(r0) && ed().tool === "strip" && sst().sel === "light.under", { text: text.slice(0, 200), e, tool: ed().tool });
});

await tryCase("edit: Remove run: back to PadSpan's guess (Undo brings it back)", async () => {
  click("Remove run", "la3d-sheet");
  const gone = run("light.under");
  click("Undo", "la3d-tools"); await settle();
  check("edit: Remove run: back to PadSpan's guess (Undo brings it back)", gone === null && !!run("light.under"), { gone });
});

await tryCase("areas: Continue from another light's run starts where it ends", async () => {
  S().select("light.pendant");
  await settle();
  const cont = inSheet("select", "Continue from");
  cont.value = "light.under"; cont.dispatchEvent({ type: "change" });
  const end = run("light.under").pts.at(-1);
  slot._look(-Math.PI / 2, 0.95, [8.9, 3.9, -3.2], 7);
  await settle();
  const p = w(8.4, -5.985, end[2]);
  tap(p); tap(p);
  await settle();
  const r = run("light.pendant");
  check("areas: Continue from another light's run starts where it ends", !!r && r.pts[0].every((v, i) => near(v, end[i], 2e-3)) && r.pts.length === 2
    && ed().draft.lights["light.pendant"].kind === "strip", { r, end });
});

await tryCase("save: one call, exactly the draft's changes, then the file is it", async () => {
  const n0 = payloads.length;
  click("Save", "la3d-tools");
  await settle();
  const sent = payloads.slice(n0);
  const L = server.file.lights;
  check("save: one call, exactly the draft's changes, then the file is it", sent.length === 1 && !ed().dirty
    && ["light.under", "light.deck", "light.cove", "light.tv", "light.pendant"].every(e => L[e] && L[e].run)
    && JSON.stringify(sent[0].lights["light.under"]) === JSON.stringify(L["light.under"]), { sent: sent.length, dirty: ed().dirty, L: Object.keys(L).map(e => [e, !!(L[e] || {}).run]) });
});

await tryCase("rest: drawn along their runs, nothing drawn at rest", async () => {
  click("Done");
  await settle(40);
  const fx = Object.fromEntries((st().fixtures || []).map(f => [f.eid, f]));
  const f0 = st().frames;
  await settle(10);
  check("rest: drawn along their runs, nothing drawn at rest", fx["light.deck"] && fx["light.deck"].kind === "string" && fx["light.deck"].halos > 10
    && fx["light.cove"].kind === "cove" && fx["light.cove"].halos === 0 && fx["light.under"].bulbs === 2 && st().frames === f0,
    { deck: fx["light.deck"], cove: fx["light.cove"], under: fx["light.under"], frames: [f0, st().frames] });
});

console.log(JSON.stringify({ cases, failures, payloads, start }));
