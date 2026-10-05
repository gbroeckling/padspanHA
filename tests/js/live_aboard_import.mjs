// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
//
// Live Aboard's Import flow (views/live_aboard_import.js), run for real: the
// page it draws (on the DOM shim), the person's choices, and what Add hands
// the Furnish tab. The previews are the server's own answers
// (ws_house3d_import.preview over synthetic .sh3d files, made by
// tests/test_live_aboard_import.py); the house is read by
// views/live_aboard_house.js and its walls by views/live_aboard_draft.js.
//
//   flow      Cancel before or after the preview resolves null; only the
//             read commands are ever called (preview, model_get,
//             house3d_get); an error is said in the page; Cancel while the
//             file is read drops the late answer; a file over the limit is
//             refused before any call
//   floors    by height with several levels; the floor being furnished with
//             one, or with none; Leave out takes a level's things out
//   walls     a door or window goes on the nearest wall of its floor (on the
//             run, as parallel, its width kept); a corner moves it along;
//             a door or window already there (the 3D file's or another
//             import) is never overlapped; too little wall is said; a
//             narrow stretch cuts it; no wall near leaves it out
//   kinds     the builder's recipe at the file's size, kept to its range;
//             re-mapping in the list changes it; a kind no builder has is a
//             box; a ceiling light starts unticked
//   result    ticked and placed only; origin "import"; the floor chosen;
//             ids never already in the 3D file; the contracts' shapes
//
// usage: live_aboard_import.mjs <www/padspan-ha dir> <previews.json> [<builders module>]
// prints one JSON line: { cases: {name: result}, failures: [...], payloads: [...], pieces: [...] }
// payloads: what Add handed over, as house3d_edit sections (the server's own
// apply_edit must keep every opening); pieces: every piece handed over.

import { pathToFileURL } from "node:url";
import { join } from "node:path";
import { readFileSync } from "node:fs";
import * as shim from "./dom_shim.mjs";

const WWW = process.argv[2], PREVIEWS = process.argv[3], REAL = process.argv[4] || "";
if (!WWW || !PREVIEWS) { console.error("usage: live_aboard_import.mjs <www dir> <previews.json> [<builders>]"); process.exit(2); }
shim.install();
const IM = await import(pathToFileURL(join(WWW, "views", "live_aboard_import.js")).href);
const H = await import(pathToFileURL(join(WWW, "views", "live_aboard_house.js")).href);
const D = await import(pathToFileURL(join(WWW, "views", "live_aboard_draft.js")).href);
const P = JSON.parse(readFileSync(PREVIEWS, "utf-8"));

const failures = [], cases = {}, payloads = [], piecesOut = [];
const check = (name, ok, detail) => { cases[name] = !!ok; if (!ok) failures.push({ name, detail: detail === undefined ? null : detail }); };
const tryCase = async (name, fn) => {
  try { await fn(); } catch (e) { failures.push({ name, detail: String(e && e.stack || e).slice(0, 900) }); cases[name] = false; }
};
const clone = (x) => JSON.parse(JSON.stringify(x));
const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;
const turn = () => new Promise(r => globalThis._realSetTimeout(r, 0));
const settle = async (n = 6) => { for (let i = 0; i < n; i++) await turn(); };

// A file read as the browser would.
globalThis.FileReader = class {
  readAsDataURL(f){ Promise.resolve().then(() => { this.result = `data:application/octet-stream;base64,${f._b64}`; if (this.onload) this.onload(); }); }
};
const fileOf = (name, b64 = "UEsDBA==", size = 2048) => ({ name, size, _b64: b64 });

// ── A contract-shaped builders module (contracts §3), or the real one ────────
const sz = (w, d, h) => ({ width_m: w, depth_m: d, height_m: h });
const FAKE_F = {
  sofa: { name: "Sofa", group: "furniture", category: "seating", params: [{ key: "seats", label: "Seats", type: "int", min: 1, max: 4, step: 1, def: 3 }],
          colors: ["#5b6b7a", "#c8b89a"], colorNames: ["Body", "Legs"], size: sz([0.7, 3, 2], [0.7, 1.2, 0.9], [0.6, 1.1, 0.8]), live: null },
  bed: { name: "Bed", group: "furniture", category: "sleeping", params: [{ key: "size", label: "Size", type: "choice", choices: ["twin", "double", "queen", "king"], def: "queen" }],
         colors: ["#8b6b4a", "#e8e0d0"], colorNames: ["Frame", "Bedding"], size: sz([0.6, 2.2, 1.6], [1.2, 2.4, 2.1], [0.3, 1.4, 1.0]), live: null },
  table: { name: "Table", group: "furniture", category: "tables", params: [], colors: ["#9a7b5a"], colorNames: ["Top"],
           size: sz([0.4, 3, 1.4], [0.4, 1.5, 0.8], [0.3, 1.1, 0.75]), live: null },
  chair: { name: "Chair", group: "furniture", category: "seating", params: [], colors: ["#7a6a5a"], colorNames: ["Body"],
           size: sz([0.35, 1, 0.45], [0.35, 1, 0.5], [0.4, 1.3, 0.9]), live: null },
  lamp: { name: "Lamp", group: "furniture", category: "lighting", params: [{ key: "style", label: "Style", type: "choice", choices: ["floor", "table"], def: "floor" }],
          colors: ["#333333", "#f5e6c8"], colorNames: ["Stand", "Shade"], size: sz([0.1, 0.8, 0.4], [0.1, 0.8, 0.4], [0.1, 2.2, 1.6]), live: "glow" },
  other: { name: "Box", group: "furniture", category: "other", params: [], colors: ["#9aa3ab"], colorNames: ["Colour"],
           size: sz([0.05, 6, 0.6], [0.05, 6, 0.6], [0.02, 4, 0.6]), live: null },
  tag: { name: "Tag", group: "tag", category: "device", params: [], colors: ["#ffffff"], colorNames: ["Body"], size: sz([0.02, 0.2, 0.04], [0.02, 0.2, 0.04], [0.005, 0.05, 0.01]), live: null },
};
const FAKE = {
  FURNITURE_KINDS: ["sofa", "bed", "table", "chair", "lamp", "other", "tag"],
  FURNITURE: FAKE_F,
  defaultRecipe(kind){
    const d = FAKE_F[kind];
    const params = {};
    for (const p of (d ? d.params : [])) params[p.key] = p.def;
    return d ? { kind, params, colors: [...d.colors], width_m: d.size.width_m[2], depth_m: d.size.depth_m[2], height_m: d.size.height_m[2] }
      : { kind, params: {}, colors: ["#a0a0a0"], width_m: 0.5, depth_m: 0.5, height_m: 0.5 };
  },
  clampRecipe(r){
    const d = FAKE_F[r.kind], out = clone(r);
    if (d) for (const k of ["width_m", "depth_m", "height_m"]) out[k] = Math.max(d.size[k][0], Math.min(d.size[k][1], Number(r[k]) || d.size[k][2]));
    return out;
  },
  pieceSize(r){ const c = FAKE.clampRecipe(r); return { w: c.width_m, d: c.depth_m, h: c.height_m }; },
};
const REAL_TOOLS = REAL ? await import(pathToFileURL(REAL).href).catch((e) => { failures.push({ name: "real builders load", detail: String(e) }); return null; }) : null;

// ── The house: Living (main) and Bedroom (upstairs), where the file's rooms are
const rect = (floor_id, x0, y0, x1, y1) => ({ type: "poly", floor_id, points_m: [[x0, y0], [x1, y0], [x1, y1], [x0, y1]] });
const MODEL = {
  floors: [{ id: "main", name: "Main", level: 0 }, { id: "up", name: "Upstairs", level: 1 }],
  room_geometry_m: { Living: rect("main", 0, 0, 5, 4), Bedroom: rect("up", 0, 0, 4, 3) },
  rf_barriers_m: [],
};
// The 3D file: a window on the Living's front wall and one on its left wall
// (the walls outside the room outline by half the outside thickness).
const EXT = H.EXT_T / 2;
const FILE3D = { schema: 1, pieces: { fur_aaaaaaaa: { id: "fur_aaaaaaaa", recipe: { kind: "sofa" }, floor_id: "main", x_m: 1, y_m: 1 } },
  openings: {
    win_00000001: { kind: "window", floor_id: "main", a_m: [3.0, 4 + EXT], b_m: [4.0, 4 + EXT], sill_m: 0.9, head_m: 2.1 },
    win_00000002: { kind: "window", floor_id: "main", a_m: [-EXT, 0.5], b_m: [-EXT, 3.8], sill_m: 0.9, head_m: 2.1 },
  } };

function fakeHA(previewOf){
  const calls = [];
  const callWS = (msg) => {
    calls.push(clone(msg));
    if (msg.type === IM.PREVIEW_TYPE) {
      const ans = previewOf(msg);
      return ans && ans.error ? Promise.reject(ans.error) : Promise.resolve(clone(ans));
    }
    if (msg.type === "padspan_ha/model_get") return Promise.resolve(clone(MODEL));
    if (msg.type === "padspan_ha/house3d_get") return Promise.resolve({ enabled: true, data: clone(FILE3D), writable: true, counts: {} });
    return Promise.reject({ code: "unexpected", message: `unexpected ${msg.type}` });
  };
  return { calls, callWS };
}
function walk(n, out = []){ for (const c of n.children || []) { out.push(c); walk(c, out); } return out; }
const textOf = (n) => n.textContent || "";
const buttons = (el) => walk(el).filter(n => n.localName === "button");
const button = (el, start) => buttons(el).find(b => textOf(b).startsWith(start));
const rowOf = (el, id) => walk(el).find(n => n.dataset && n.dataset.id === id);
const inRow = (row, tag) => walk(row).filter(n => n.localName === tag);
const fire = (n, type) => n.dispatchEvent({ type, target: n, stopPropagation(){}, preventDefault(){} });
/** Pick an option of a select as a person would, then tell the page. */
function choose(sel, value){
  for (const o of walk(sel)) if (o.localName === "option") o.selected = o.value === value;
  sel.value = value;
  fire(sel, "change");
}

/** Open the flow, pick a file, and come back with the page showing the preview. */
async function opened(previewKey, opts = {}){
  const el = document.createElement("div");
  const ha = fakeHA(() => (opts.error ? { error: opts.error } : P[previewKey]));
  const toasts = [];
  const ctx = { el, callWS: ha.callWS, wsCall: ha.callWS, toast: (t, bad) => toasts.push({ t, bad }), settings: {},
                floor: opts.floor || { id: "main", name: "Main" }, room: null, recipeTools: opts.tools === undefined ? FAKE : opts.tools };
  let result;
  const p = IM.importFlow(ctx).then(v => { result = v; return v; });
  const input = walk(el).find(n => n.localName === "input");
  input.files = [opts.file || fileOf("house.sh3d")];
  fire(input, "change");
  await settle();
  return { el, ha, toasts, p, get result(){ return result; } };
}
const idsBy = (prev, sec, name) => Object.keys(prev[sec]).filter(id => prev.report[sec][id].name === name);
async function add(f){ button(f.el, "Add").click(); await settle(); return f.result; }

// ── flow ────────────────────────────────────────────────────────────────────
await tryCase("flow: Cancel before a file resolves null, calls nothing and leaves the container empty", async () => {
  const el = document.createElement("div"), ha = fakeHA(() => P.house);
  const p = IM.importFlow({ el, callWS: ha.callWS, toast(){}, floor: { id: "main", name: "Main" }, recipeTools: FAKE });
  check("flow: the first screen asks for a .sh3d file", button(el, "Choose a .sh3d file") && walk(el).some(n => n.localName === "input"
    && n.getAttribute("accept") === ".sh3d"), textOf(el));
  button(el, "Cancel").click();
  const v = await p;
  check("flow: Cancel before a file resolves null, calls nothing and leaves the container empty", v === null && ha.calls.length === 0 && el.children.length === 0, { v, calls: ha.calls });
});
await tryCase("flow: the preview calls only the read commands, and Cancel after it resolves null", async () => {
  const f = await opened("house");
  const types = f.ha.calls.map(c => c.type).sort();
  check("flow: the preview calls only the read commands, and Cancel after it resolves null",
    JSON.stringify(types) === JSON.stringify([IM.PREVIEW_TYPE, "padspan_ha/house3d_get", "padspan_ha/model_get"].sort())
      && f.ha.calls.find(c => c.type === IM.PREVIEW_TYPE).sh3d_base64 === "UEsDBA==", types);
  button(f.el, "Cancel").click();
  await settle();
  check("flow: declining after the preview writes nothing", f.result === null && f.ha.calls.length === 3 && f.el.children.length === 0, f.ha.calls.length);
});
await tryCase("flow: an error is said in the page and in a toast; Cancel still works", async () => {
  const f = await opened("house", { error: { code: "parse_failed", message: "Home.xml is not valid XML: oops" } });
  const said = textOf(f.el);
  check("flow: an error is said in the page and in a toast; Cancel still works", said.includes("not valid XML") && f.toasts.length === 1
    && f.toasts[0].bad === true && !!button(f.el, "Choose a .sh3d file"), { said, toasts: f.toasts });
  button(f.el, "Cancel").click();
  await settle();
  check("flow: Cancel after an error resolves null", f.result === null);
});
await tryCase("flow: a file over the limit is refused before any call", async () => {
  const f = await opened("house", { file: fileOf("huge.sh3d", "UEsDBA==", IM.MAX_FILE_BYTES + 1) });
  check("flow: a file over the limit is refused before any call", f.ha.calls.length === 0 && textOf(f.el).includes("10 MB"), textOf(f.el));
  button(f.el, "Cancel").click();
  await settle();
});
await tryCase("flow: Cancel while the file is read drops the late answer", async () => {
  const el = document.createElement("div");
  let release;
  const gate = new Promise(r => { release = r; });
  const callWS = (msg) => (msg.type === IM.PREVIEW_TYPE ? gate.then(() => clone(P.house))
    : Promise.resolve(msg.type === "padspan_ha/model_get" ? clone(MODEL) : { data: clone(FILE3D) }));
  let v = "pending";
  IM.importFlow({ el, callWS, toast(){}, floor: { id: "main", name: "Main" }, recipeTools: FAKE }).then(x => { v = x; });
  const input = walk(el).find(x => x.localName === "input");
  input.files = [fileOf("slow.sh3d")]; fire(input, "change");
  await settle();
  const reading = textOf(el).includes("Reading slow.sh3d");
  button(el, "Cancel").click();
  await settle();
  release();
  await settle();
  check("flow: Cancel while the file is read drops the late answer", reading && v === null && el.children.length === 0, { reading, v, text: textOf(el) });
});

// ── floors ──────────────────────────────────────────────────────────────────
await tryCase("floors", async () => {
  const floors = IM.floorsOf(MODEL, { id: "main" });
  check("floors: the house's floors, lowest first", floors.map(f => f.id).join() === "main,up", floors);
  const levels = [{ id: "a", name: "Basement", elevation_m: -2.5 }, { id: "b", name: "Ground", elevation_m: 0 }, { id: "c", name: "First", elevation_m: 2.6 }];
  const two = IM.defaultFloors(["b", "c"], levels, floors, { id: "up" });
  check("floors: several levels go to the floors at the nearest height", two.b === "main" && two.c === "up", two);
  const three = IM.defaultFloors(["a", "b", "c"], levels, floors, { id: "main" });
  check("floors: counted from each side's lowest", three.a === "main" && three.b === "up" && three.c === "up", three);
  const one = IM.defaultFloors(["b"], levels, floors, { id: "up", name: "Upstairs" });
  check("floors: one level goes to the floor being furnished", one.b === "up", one);
  const none = IM.defaultFloors([""], [], floors, { id: "up" });
  check("floors: a file with no levels goes to the floor being furnished", none[""] === "up", none);
  const mixed = IM.defaultFloors(["", "b", "c"], levels, floors, { id: "up" });
  check("floors: what is on no level of a file with levels goes to the floor being furnished", mixed[""] === "up" && mixed.b === "main", mixed);
  const empty = IM.floorsOf({}, { id: "solo", name: "Solo" });
  check("floors: a house with no floors offers the floor being furnished", empty.length === 1 && empty[0].id === "solo", empty);

  const f = await opened("house");
  const sels = walk(f.el).filter(n => n.localName === "select" && n.getAttribute("aria-label")?.startsWith("Floor for"));
  check("floors: the list asks which floor each level goes on, by height to start", sels.length === 2
    && sels[0].value === "main" && sels[1].value === "up" && textOf(f.el).includes("Ground Floor") && textOf(f.el).includes("Leave out"),
    sels.map(s => s.value));
  // Leave out the upstairs: its window, table and thing are not handed over.
  const up = sels[1];
  choose(up, IM.LEAVE_OUT);
  await settle();
  const r = await add(f);
  const upIds = new Set([...idsBy(P.house, "pieces", "Table"), ...idsBy(P.house, "pieces", "Thingamajig"), ...idsBy(P.house, "openings", "Window")]);
  check("floors: Leave out takes a level's things out", r && Object.keys(r.pieces).length === 3 && Object.keys(r.openings).length === 1
    && ![...Object.keys(r.pieces), ...Object.keys(r.openings)].some(id => upIds.has(id))
    && Object.values(r.pieces).every(pc => pc.floor_id === "main"), r && { p: Object.keys(r.pieces), o: Object.keys(r.openings) });
});

// ── walls ───────────────────────────────────────────────────────────────────
// Every placed opening: on a wall run of its floor (both ends on the line,
// within the run, parallel), not over any other opening on that run.
function onAWall(rec, file3dOpenings, others){
  const reading = IM.readingOf(MODEL, { data: { openings: file3dOpenings } });
  const W = IM.wallsOf(reading, rec.floor_id);
  const hit = W && W.runs.find(R => [rec.a_m, rec.b_m].every(p => Math.abs(p[0] * R.run.nx + p[1] * R.run.ny - R.run.c) < 2e-3
    && D.tOn(R.run, p[0], p[1]) >= R.run.t0 - 2e-3 && D.tOn(R.run, p[0], p[1]) <= R.run.t1 + 2e-3));
  if (!hit) return "not on a wall";
  const t0 = Math.min(D.tOn(hit.run, ...rec.a_m), D.tOn(hit.run, ...rec.b_m)), t1 = Math.max(D.tOn(hit.run, ...rec.a_m), D.tOn(hit.run, ...rec.b_m));
  const spans = [...hit.ops.map(o => [o.lo, o.hi]), ...others.filter(o => o !== rec && o.floor_id === rec.floor_id).map(o => {
    const a = D.tOn(hit.run, ...o.a_m), b = D.tOn(hit.run, ...o.b_m);
    const onRun = [o.a_m, o.b_m].every(p => Math.abs(p[0] * hit.run.nx + p[1] * hit.run.ny - hit.run.c) < 2e-3);
    return onRun ? [Math.min(a, b), Math.max(a, b)] : null;
  }).filter(Boolean)];
  if (spans.some(([lo, hi]) => t0 < hi - 1e-3 && t1 > lo + 1e-3)) return "overlaps";
  return "ok";
}
await tryCase("walls: the house file", async () => {
  const f = await opened("house");
  const r = await add(f);
  payloads.push({ openings: r.openings });
  const door = r.openings[idsBy(P.house, "openings", "Front door")[0]];
  const win = r.openings[idsBy(P.house, "openings", "Window")[0]];
  check("walls: a door goes on the nearest wall of its floor, its width kept", door && door.floor_id === "main"
    && onAWall(door, FILE3D.openings, Object.values(r.openings)) === "ok"
    && near(Math.hypot(door.b_m[0] - door.a_m[0], door.b_m[1] - door.a_m[1]), 0.915, 0.003) && near(door.a_m[1], 4 + EXT, 1e-3), door);
  check("walls: a door keeps the file's height, hinged left, swinging in", door && door.head_m === 2.08 && door.hinge === "left" && door.swing === "in"
    && door.kind === "door", door);
  check("walls: a window goes on its floor's wall with the file's sill and head", win && win.floor_id === "up"
    && onAWall(win, FILE3D.openings, Object.values(r.openings)) === "ok" && win.sill_m === 0.9 && win.head_m === 2.1
    && near(win.a_m[0], -EXT, 1e-3), win);
});
await tryCase("walls: the edges file", async () => {
  const f = await opened("edges");
  const prev = P.edges, one = (n) => idsBy(prev, "openings", n)[0];
  const text = (n) => textOf(rowOf(f.el, one(n)) || { textContent: "" });
  check("walls: a door or window already in the 3D file is never overlapped", text("Window over a window").includes("already there")
    && inRow(rowOf(f.el, one("Window over a window")), "input")[0].disabled === true, text("Window over a window"));
  check("walls: one imported never overlaps another imported", text("Door over the corner door").includes("already there"), text("Door over the corner door"));
  check("walls: too little wall is said", text("Squeezed door").includes("too little wall there for a door"), text("Squeezed door"));
  check("walls: no wall near leaves it out with its reason", text("Far window").includes(`no wall within ${IM.SNAP_M} m`), text("Far window"));
  check("walls: a narrow stretch cuts it, and says so", text("Cut window").includes("cut to 1.00 m"), text("Cut window"));
  const r = await add(f);
  payloads.push({ openings: r.openings });
  const all = Object.values(r.openings);
  const corner = r.openings[one("Corner door")], moved = r.openings[one("Moved door")], cut = r.openings[one("Cut window")];
  const len = (o) => Math.hypot(o.b_m[0] - o.a_m[0], o.b_m[1] - o.a_m[1]);
  check("walls: a corner moves it along the wall, its width kept", corner && near(len(corner), 0.9, 0.003)
    && near(Math.min(corner.a_m[0], corner.b_m[0]), 0, 2e-3) && onAWall(corner, FILE3D.openings, all) === "ok", corner);
  check("walls: an opening there moves it along, its width kept", moved && near(len(moved), 0.9, 0.003)
    && near(Math.max(moved.a_m[0], moved.b_m[0]), 3.0, 2e-3) && onAWall(moved, FILE3D.openings, all) === "ok", moved);
  check("walls: the cut one fills the free stretch", cut && near(len(cut), 1.0, 0.003) && onAWall(cut, FILE3D.openings, all) === "ok", cut);
  check("walls: only the placed ones are handed over", Object.keys(r.openings).length === 3
    && [one("Corner door"), one("Moved door"), one("Cut window")].every(id => id in r.openings), Object.keys(r.openings));
});
await tryCase("walls: a floor change places them again", async () => {
  const f = await opened("house");
  const sels = walk(f.el).filter(n => n.localName === "select" && n.getAttribute("aria-label")?.startsWith("Floor for"));
  // The upstairs level onto Main: the window at x = 0 finds the Living's left wall,
  // where the 3D file already has a window from 0.5 to 3.8 m: already there.
  choose(sels[1], "main");
  await settle();
  const winRow = rowOf(f.el, idsBy(P.house, "openings", "Window")[0]);
  check("walls: a floor change places them again", textOf(winRow).includes("already there"), textOf(winRow));
  button(f.el, "Cancel").click();
  await settle();
});

// ── kinds ───────────────────────────────────────────────────────────────────
await tryCase("kinds", async () => {
  const f = await opened("house");
  const sofaId = idsBy(P.house, "pieces", "Corner sofa")[0], oddId = idsBy(P.house, "pieces", "Thingamajig")[0];
  const lightId = idsBy(P.house, "pieces", "Ceiling light")[0], washId = idsBy(P.house, "pieces", "Washing machine")[0];
  const kindSel = (id) => inRow(rowOf(f.el, id), "select")[0];
  check("kinds: each piece starts as the kind its words matched; no builder or no match is a box",
    kindSel(sofaId).value === "sofa" && kindSel(oddId).value === IM.BOX && kindSel(washId).value === IM.BOX
      && textOf(rowOf(f.el, washId)).includes("no builder for a washer yet") && textOf(rowOf(f.el, oddId)).includes("no match"),
    [kindSel(sofaId).value, kindSel(oddId).value, kindSel(washId).value, textOf(rowOf(f.el, washId))]);
  const opts = walk(kindSel(sofaId)).filter(n => n.localName === "option").map(o => o.value);
  check("kinds: the choices are the builders' furniture and devices, then Box", opts.join() === "sofa,bed,table,chair,lamp,other", opts);
  check("kinds: a ceiling light starts unticked, and says why", inRow(rowOf(f.el, lightId), "input")[0].checked === false
    && textOf(rowOf(f.el, lightId)).includes("ceiling or wall light"), textOf(rowOf(f.el, lightId)));
  // Re-map the sofa (2.2 m in the file) to a bed: the bed's own recipe, kept to its range.
  const sel = kindSel(sofaId);
  choose(sel, "bed");
  await settle();
  check("kinds: re-mapping shows the new kind's size at once", textOf(rowOf(f.el, sofaId)).includes("2.20 × 1.20 × 0.80 m")
    && textOf(rowOf(f.el, sofaId)).includes("the file has 2.20 × 0.90 × 0.80 m"), textOf(rowOf(f.el, sofaId)));
  const r = await add(f);
  const bed = r.pieces[sofaId], odd = r.pieces[oddId], wash = r.pieces[washId];
  check("kinds: re-mapped, it is the builder's recipe at the file's size, kept to the range", bed && bed.recipe.kind === "bed"
    && bed.recipe.params.size === "queen" && bed.recipe.colors.length === 2 && bed.recipe.width_m === 2.2 && bed.recipe.depth_m === 1.2
    && bed.recipe.height_m === 0.8 && bed.label === "Corner sofa", bed);
  check("kinds: a box keeps the file's size and is the builders' own box", odd && odd.recipe.kind === IM.BOX && odd.recipe.width_m === 0.4
    && odd.recipe.depth_m === 0.3 && odd.recipe.height_m === 0.2 && JSON.stringify(odd.recipe.colors) === JSON.stringify(FAKE_F.other.colors)
    && wash.recipe.kind === IM.BOX, odd);
  check("kinds: the unticked ceiling light is not handed over", !(lightId in r.pieces));
  const sofaAt = P.house.pieces[sofaId];
  check("kinds: the file's place, height and turn come through", bed.x_m === sofaAt.x_m && bed.y_m === sofaAt.y_m && bed.z_m === 0
    && bed.rotation === 180 && bed.floor_id === "main" && r.pieces[oddId].rotation === 270 && r.pieces[oddId].z_m === 0.74
    && r.pieces[oddId].floor_id === "up", [bed, r.pieces[oddId]]);
  piecesOut.push(...Object.values(r.pieces));
  // A recipe outside every range: kept to what the 3D file keeps.
  const big = IM.recipeFor(IM.BOX, { w: 12, d: 0.001, h: 3 }, null);
  check("kinds: sizes stay within what the 3D file keeps", big.width_m === IM.SIZE_MAX_M && big.depth_m === IM.SIZE_MIN_M && big.height_m === 3, big);
  const bad = IM.recipeFor("sofa", { w: 2, d: 0.9, h: 0.8 }, { ...FAKE, clampRecipe(){ throw new Error("builder bug"); } });
  check("kinds: a builder that throws gives a box, never an error", bad.kind === IM.BOX && bad.width_m === 2
    && JSON.stringify(bad.colors) === JSON.stringify([IM.BOX_COLOR]), bad);
  const builtBox = IM.recipeFor(IM.BOX, { w: 7, d: 0.5, h: 5 }, FAKE);
  check("kinds: with builders the box is theirs, kept to its range", builtBox.kind === IM.BOX && builtBox.width_m === 6
    && builtBox.height_m === 4 && JSON.stringify(builtBox.colors) === JSON.stringify(FAKE_F.other.colors), builtBox);
  const noTools = IM.kindChoices(null);
  check("kinds: with no builders module every piece can still come in as a box", noTools.length === 1 && noTools[0].kind === IM.BOX
    && noTools[0].name === "Box", noTools);
  check("kinds: the builders' box is offered once, by its own name", IM.kindChoices(FAKE).filter(c => c.kind === IM.BOX).length === 1, IM.kindChoices(FAKE));
});
if (REAL_TOOLS) {
  await tryCase("kinds: the real builders", async () => {
    const choices = IM.kindChoices(REAL_TOOLS);
    const furn = REAL_TOOLS.FURNITURE;
    check("kinds: the real builders' furniture and devices are offered, then Box", choices.length >= 2 && choices.at(-1).kind === IM.BOX
      && choices.filter(c => c.kind === IM.BOX).length === 1
      && choices.slice(0, -1).every(c => furn[c.kind] && ["furniture", "device"].includes(furn[c.kind].group)), choices.map(c => c.kind));
    const bad = [];
    for (const c of choices) {
      const r = IM.recipeFor(c.kind, { w: 1.0, d: 0.6, h: 0.9 }, REAL_TOOLS);
      const ok = r.kind === c.kind && ["width_m", "depth_m", "height_m"].every(k => r[k] >= IM.SIZE_MIN_M && r[k] <= IM.SIZE_MAX_M)
        && Array.isArray(r.colors) && r.colors.length <= 6 && r.colors.every(x => /^#[0-9a-f]{6}$/i.test(x)) && r.params && typeof r.params === "object";
      if (!ok) bad.push({ kind: c.kind, r });
      piecesOut.push(IM.pieceFor({ id: "fur_0000000" + (bad.length % 10), recipe: { kind: c.kind, width_m: 1, depth_m: 0.6, height_m: 0.9 },
                                   x_m: 1, y_m: 2, z_m: 0, rotation: 15 }, c.kind, "main", REAL_TOOLS));
    }
    check("kinds: every real builder gives its own recipe at the file's size", !bad.length, bad.slice(0, 3));
    const f = await opened("house", { tools: REAL_TOOLS });
    const r = await add(f);
    check("kinds: the real builders take the house file", Object.keys(r.pieces).length >= 4, Object.keys(r.pieces).length);
    piecesOut.push(...Object.values(r.pieces));
  });
}

// ── result ──────────────────────────────────────────────────────────────────
await tryCase("result", async () => {
  // The preview's ids collide with the 3D file's: they are given new ones.
  const prev = clone(P.house);
  const pid = idsBy(prev, "pieces", "Table")[0], oid = idsBy(prev, "openings", "Front door")[0];
  prev.pieces.fur_aaaaaaaa = { ...prev.pieces[pid], id: "fur_aaaaaaaa" }; delete prev.pieces[pid];
  prev.report.pieces.fur_aaaaaaaa = prev.report.pieces[pid]; delete prev.report.pieces[pid];
  prev.openings.win_00000001 = prev.openings[oid]; delete prev.openings[oid];
  prev.report.openings.win_00000001 = prev.report.openings[oid]; delete prev.report.openings[oid];
  P.collide = prev;
  const f = await opened("collide");
  // None: nothing ticked, Add can't be pressed; All: everything placeable again.
  const heads = buttons(f.el).filter(b => textOf(b) === "None");
  heads.forEach(b => b.click());
  await settle();
  check("result: None unticks all, and Add then has nothing to add", button(f.el, "Add").disabled === true);
  buttons(f.el).filter(b => textOf(b) === "All").forEach(b => b.click());
  await settle();
  const addText = textOf(button(f.el, "Add"));
  const r = await add(f);
  const ids = [...Object.keys(r.pieces), ...Object.keys(r.openings)];
  check("result: All ticks every one again, the ceiling light too", Object.keys(r.pieces).length === 6 && addText === `Add ${ids.length} to the house`, { addText, n: ids.length });
  check("result: ids are never already in the 3D file", !ids.includes("fur_aaaaaaaa") && !ids.includes("win_00000001")
    && new Set(ids).size === ids.length, ids);
  check("result: a door given a new id is still a door", Object.entries(r.openings).every(([id, o]) => id.startsWith(o.kind === "door" ? "door_" : "win_")), Object.keys(r.openings));
  const pieceKeys = ["id", "recipe", "origin", "label", "library_id", "submission_id", "floor_id", "x_m", "y_m", "z_m", "rotation", "entity_id", "entity_reg_id"];
  check("result: pieces are the contracts' shape, origin import, on a chosen floor", Object.entries(r.pieces).every(([id, pc]) =>
    pc.id === id && /^fur_[0-9a-f]{8}$/.test(id) && JSON.stringify(Object.keys(pc).sort()) === JSON.stringify([...pieceKeys].sort())
      && pc.origin === "import" && ["main", "up"].includes(pc.floor_id) && pc.entity_id === null && pc.library_id === null
      && pc.rotation >= 0 && pc.rotation < 360 && pc.z_m >= 0 && pc.z_m <= 20 && pc.label.length <= 60), Object.values(r.pieces)[0]);
  payloads.push({ openings: r.openings });
  piecesOut.push(...Object.values(r.pieces));
});

// ── what one Save takes ───────────────────────────────────────────────────
// The 3D file already holds a piece and two windows (FILE3D); Save takes at
// most 1000 changes, 1000 pieces and 500 doors and windows (house3d_store.py).
let big = null;
await tryCase("save: a file bigger than one Save starts with what one Save takes ticked, says so, and never adds more", async () => {
  const prev = clone(P.house), [pid] = Object.keys(prev.pieces);
  for (let i = 0; i < 1200; i++) {
    const id = `fur_${(0x10000000 + i).toString(16)}`;
    prev.pieces[id] = { ...clone(prev.pieces[pid]), id };
    prev.report.pieces[id] = clone(prev.report.pieces[pid]);
  }
  P.big = prev;
  const f = await opened("big");
  const said = textOf(f.el), addText = textOf(button(f.el, "Add"));
  const r = await add(f);
  const np = Object.keys(r.pieces).length, no = Object.keys(r.openings).length;
  big = r;
  check("save: a file bigger than one Save starts with what one Save takes ticked, says so, and never adds more",
    np + no === IM.MAX_CHANGES && np <= IM.MAX_PIECES - 1 && no <= IM.MAX_OPENINGS - 2 && said.includes("start unticked")
      && addText === `Add ${np + no} to the house`, { np, no, addText, said: said.slice(0, 400) });
  const g = await opened("big");
  buttons(g.el).filter(b => textOf(b) === "All").forEach(b => b.click());
  await settle();
  const over = button(g.el, "Add") || buttons(g.el).find(b => textOf(b).startsWith("Too many"));
  over.click(); await settle();
  check("save: ticking more than one Save takes is said on the button, and nothing is added", over.disabled === true
    && textOf(over).startsWith("Too many for one Save") && g.result === undefined, textOf(over));
});

console.log(JSON.stringify({ cases, failures, payloads, pieces: piecesOut, big }));
