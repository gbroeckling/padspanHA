// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
//
// Drawing rooms in Mapping → Edit and Layout (2026-11-18): a corner lands on another room's corner, else its edge,
// else the grid, Alt places it freely, a scanned wall end still comes first; Straighten edges makes an edge less than
// 5 cm off straight and moves a corner another room shares with it; rooms drawn over each other are named, from the
// server's one check. views/room_snap.js on its own, then both editors run through views/maps.js.
// The pytest wrapper is tests/test_mapping_aids.py.
//
// Run:  node tests/js/mapping_aids.mjs <views-dir>
import { pathToFileURL } from "node:url";
import { join } from "node:path";
import { install, flush } from "./dom_shim.mjs";

install(globalThis);
// The editors' drags listen on window and check their layer is still on the page.
const winL = {};
globalThis.addEventListener = (t, f) => { (winL[t] ||= []).push(f); };
globalThis.removeEventListener = (t, f) => { winL[t] = (winL[t] || []).filter(x => x !== f); };
Object.defineProperty(globalThis.Node.prototype, "isConnected", { get() { return true; }, configurable: true });

const results = {};
const check = (name, ok, detail) => { results[name] = { ok: !!ok, detail: ok ? undefined : detail }; };
const near = (a, b, e = 1e-9) => Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((v, i) => Math.abs(v - b[i]) < e);
const S = await import(pathToFileURL(join(process.argv[2], "room_snap.js")).href);
const maps = await import(pathToFileURL(join(process.argv[2], "maps.js")).href);

// ── room_snap.js on its own ──────────────────────────────────────────────────
{
  const kitchen = [[0, 0], [4, 0], [4, 3], [0, 3]];
  const T = { ...S.snapTargets([kitchen]), tol: 0.15, grid: 0.05 };
  const c = S.snapPoint([4.06, 2.95], T), e = S.snapPoint([4.08, 1.52], T), g = S.snapPoint([6.012, 1.537], T), f = S.snapPoint([6.012, 1.537], { ...T, grid: 0 });
  check("snap: a corner first", c.kind === "corner" && near(c.p, [4, 3]), c);
  check("snap: else the nearest point of an edge", e.kind === "edge" && near(e.p, [4, 1.52]), e);
  check("snap: else the grid", g.kind === "grid" && near(g.p, [6.0, 1.55]), g);
  check("snap: no grid, no room near: where it was put", f.kind === null && near(f.p, [6.012, 1.537]), f);
  check("snap: a corner further off than the reach is not taken", S.snapPoint([4.2, 3.2], { ...T, grid: 0 }).kind === null);
  check("snap: a corner within reach beats an edge nearer still; out of reach, the edge",
    S.snapPoint([3.9, 0.02], { ...T, grid: 0 }).kind === "corner" && S.snapPoint([3.9, 0.02], { ...T, grid: 0, tol: 0.1 }).kind === "edge");
  check("snap: the grid's points are clean numbers", S.snapPoint([7.549, 0.3], { tol: 0, grid: 0.05 }).p[0] === 7.55);

  // A corner clicked 2 cm off: Pantry's top edge runs 2 m with its far end 2 cm low. Hall shares that far corner.
  const rooms = { Kitchen: kitchen, Pantry: [[4, 0], [6, 0.02], [6, 3], [4, 3]], Hall: [[6, 0.02], [9, 0.02], [9, 3], [6, 3]] };
  const before = JSON.stringify(rooms);
  const r = S.straightenRooms(rooms);
  check("straighten: the crooked edge is straight, on the line more corners use", near(r.rooms.Pantry[1], [6, 0]), r.rooms.Pantry);
  check("straighten: the corner the next room shares moves with it, and that room's edge after it",
    near(r.rooms.Hall[0], [6, 0]) && near(r.rooms.Hall[1], [9, 0]), r.rooms.Hall);
  check("straighten: the rooms given are left as they were", JSON.stringify(rooms) === before);
  check("straighten: it says how many edges", r.fixed === 2, r.fixed);
  const keep = { A: [[0, 0], [3, 0.06], [3, 3], [0, 3]], B: [[0, 0], [0.3, 0.03], [0.3, 1], [0, 1]], C: [[0, 0], [2, 0.05], [2, 2], [0, 2]] };
  const k = S.straightenRooms(keep);
  check("straighten: 6 cm off is meant; a short slant is meant; 5 cm (two grid lines apart) is not less than 5 cm",
    k.fixed === 0 && JSON.stringify(k.rooms) === JSON.stringify(keep), k);
  const up = S.straightenRooms({ D: [[0, 0], [2, 0], [2.03, 3], [0, 3]] });
  check("straighten: upright edges too", up.fixed === 1 && near(up.rooms.D[2], [2, 3]), up.rooms.D);
}

// ── the editors, run ─────────────────────────────────────────────────────────
function el(tag, attrs = {}, children = []) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (k === "class") n.className = v;
    else if (k === "style") n.setAttribute("style", v);
    else if (k.startsWith("on") && typeof v === "function") n.addEventListener(k.slice(2), v);
    else if (v !== undefined && v !== null) n.setAttribute(k, String(v));
  }
  for (const c of (Array.isArray(children) ? children : [children])) {
    if (c === null || c === undefined) continue;
    n.appendChild(typeof c === "string" || typeof c === "number" ? document.createTextNode(String(c)) : c);
  }
  return n;
}
const quiet = () => new Proxy(() => document.createElement("span"), {
  get: (_t, k) => (k === "then" ? undefined : k === Symbol.toPrimitive || k === "toString" ? () => "" : quiet()),
  apply: () => document.createElement("span"),
});
function walk(node, visit) { visit(node); for (const c of node.childNodes || []) walk(c, visit); }
function all(node, pred) { const out = []; walk(node, (n) => { if (pred(n)) out.push(n); }); return out; }
const attr = (root, a, v) => all(root, (n) => n.getAttribute && n.getAttribute(a) === v)[0];
const textOf = (n) => (n.textContent || "").trim();
const answered = () => new Promise(r => globalThis._realSetTimeout(r, 0));   // the server's answer, as in a browser: later

// The plan: 800 x 1200 pixels placed 10 m across and 15 m down. Kitchen at 9-10 m across, 1.5-4.5 m down.
const PLAN = () => ({
  id: "m1", name: "Main floor", floor_id: "main", image: { width: 800, height: 1200 }, receivers: [],
  room_bounds: { Kitchen: { type: "poly", points: [[0.9, 0.1], [1, 0.1], [1, 0.3], [0.9, 0.3]] } },
});
const TF = { origin_x_m: 0, origin_y_m: 0, scale_x_m: 10, scale_y_m: 15 };
function makeCtx({ tab = "edit", plan = PLAN(), tf = TF, geo = {}, pairs = [] } = {}) {
  const calls = [], toasts = [];
  const state = {
    complexity: "advanced", mapsTab: tab, settings: {}, dataMode: "live", _dataModeKnown: true, view: "maps", activeMapId: "m1",
    maps: { list: tab === "edit" ? [plan] : [] },
    model: { floors: [{ id: "main", name: "Main", level: 0 }], map_transforms: tf ? { m1: tf } : {}, room_geometry_m: geo,
             areas: [{ name: "Kitchen", floor_id: "main" }, { name: "Pantry", floor_id: "main" }] },
  };
  const wsCall = async (type, data) => { calls.push([type, data]); return type === "padspan_ha/rooms_overlap" ? { pairs } : {}; };
  return {
    calls, toasts, state,
    hass: { states: {}, user: { is_admin: true } },
    helpers: new Proxy({ el, esc: (s) => String(s ?? ""), helpBtn: () => el("button", {}, "?"), roomColor: () => "#52b788",
      mapImageUrl: () => "/x.png", pill: (t) => el("span", {}, String(t ?? "")) },
      { get: (t, k) => (k in t ? t[k] : quiet()) }),
    actions: new Proxy({ renderRooms: () => {}, wsCall, callWS: async (m) => wsCall(m.type, m), mapsSetActive: () => {} },
      { get: (t, k) => (k in t ? t[k] : quiet()) }),
    toast: (m) => toasts.push(String(m)),
  };
}
const edit = async (opts) => {
  const ctx = makeCtx(opts);
  const root = maps.render(ctx); await flush();
  attr(root, "data-edit-tool", "rooms").click(); await flush();
  ctx.state.maps._selectedRoom = "Pantry";
  const stage = all(root, (n) => n.classList && n.classList.contains("mapstage"))[0];
  // The shim's stage is 800 x 600 on screen: a click at (px, py) is (px / 800, py / 600) of the plan.
  const click = (px, py, altKey = false) => stage.dispatchEvent({ type: "click", clientX: px, clientY: py, altKey, target: stage,
    stopPropagation() {}, preventDefault() {} });
  const pts = () => ctx.state.maps._drawing.points;
  return { ctx, root, click, pts };
};

// ── Edit: where a clicked corner lands ───────────────────────────────────────
{
  const { click, pts } = await edit();
  click(723, 62);                                   // 3.75 cm right of and 5 cm below Kitchen's top-left corner
  check("edit: a corner clicked near another room's corner lands on it", near(pts()[0], [0.9, 0.1]), pts()[0]);
  click(723, 62, true);
  check("edit: Alt held, exactly where clicked", near(pts()[1], [723 / 800, 62 / 600]), pts()[1]);
  click(716, 120);                                  // 5 cm left of Kitchen's left wall, halfway down it
  check("edit: else on another room's edge", near(pts()[2], [0.9, 0.2], 1e-9), pts()[2]);
  click(401, 300);                                  // 5.0125 m across, nothing near: the 5 cm grid
  check("edit: else on the grid, in the plan's metres", near(pts()[3], [0.5, 0.5]), pts()[3]);
}
{
  const { click, pts } = await edit({ tf: null });
  click(728, 64);                                   // 8 and 4 pixels from the corner
  click(401, 300);
  check("edit: a plan with no scale: corners still land on a room's, with no grid", near(pts()[0], [0.9, 0.1]) && near(pts()[1], [401 / 800, 0.5]), pts());
}
{
  const plan = { ...PLAN(), kind: "scan", scan: { rooms: [{ name: null, points: [[0.5, 0.5], [0.6, 0.5], [0.6, 0.6], [0.5, 0.6]] }] } };
  plan.room_bounds.Kitchen.points = [[0.505, 0.505], [0.7, 0.505], [0.7, 0.7], [0.505, 0.7]];
  const { click, pts } = await edit({ plan });
  click(402, 303);                                  // 8 cm from a scanned wall end, 2.5 cm from a drawn room's corner
  check("edit: on a scanned plan the scanned wall end still comes first", near(pts()[0], [0.5, 0.5]), pts()[0]);
}

// ── Edit: Straighten edges, and rooms drawn over each other ──────────────────
{
  const plan = PLAN();
  // Pantry: its top edge runs 1 m with its right end 2.25 cm low; Hall shares that corner.
  plan.room_bounds.Pantry = { type: "poly", points: [[0.5, 0.1], [0.6, 0.1015], [0.6, 0.3], [0.5, 0.3]] };
  plan.room_bounds.Hall = { type: "poly", points: [[0.6, 0.1015], [0.6, 0.3], [0.62, 0.3]] };
  const { ctx, root } = await edit({ plan, pairs: [["Kitchen", "Pantry"]] });
  const rb = ctx.state.maps._draftRoomBounds;
  const kitchenWas = rb.Kitchen.points;
  attr(root, "data-room-straighten", "edit").click(); await flush(); await answered();
  check("edit straighten: the crooked edge is straight", near(rb.Pantry.points[1], [0.6, 0.1]), rb.Pantry.points);
  check("edit straighten: the corner Hall shares moves with it", near(rb.Hall.points[0], [0.6, 0.1]), rb.Hall.points);
  check("edit straighten: a room it did not touch is kept as it was", rb.Kitchen.points === kitchenWas);
  check("edit straighten: it says what it did", ctx.toasts.some(t => /^Straightened 1 edge\. Save Layout keeps it/.test(t)), ctx.toasts);
  const ask = ctx.calls.filter(c => c[0] === "padspan_ha/rooms_overlap");
  check("edit overlap: the server's check is asked, in metres, drafts included",
    ask.length >= 1 && near(ask[0][1].rooms.Kitchen[0], [9, 1.5]) && "Pantry" in ask[0][1].rooms, ask);
  check("edit overlap: each pair named in plain words", textOf(root).includes("Kitchen and Pantry overlap, so the walls between them can't be drawn."), textOf(root).slice(-600));
  const n = ask.length;
  attr(root, "data-edit-tool", "rooms").click(); await flush();
  check("edit overlap: asked again only when the outlines change", ctx.calls.filter(c => c[0] === "padspan_ha/rooms_overlap").length === n);
}
{
  const plan = PLAN();
  plan.room_bounds.Pantry = { type: "poly", points: [[0.5, 0.1], [0.6, 0.1015], [0.6, 0.3], [0.5, 0.3]] };
  const { ctx, root } = await edit({ plan, tf: null, pairs: [["Kitchen", "Pantry"]] });
  const was = JSON.stringify(ctx.state.maps._draftRoomBounds);
  attr(root, "data-room-straighten", "edit").click(); await flush();
  check("edit, no scale: nothing is straightened and it says why", JSON.stringify(ctx.state.maps._draftRoomBounds) === was
    && ctx.toasts.some(t => /scale first/.test(t)), ctx.toasts);
  check("edit, no scale: no metres, so no overlap is asked", !ctx.calls.some(c => c[0] === "padspan_ha/rooms_overlap") && !/overlap, so/.test(textOf(root)));
}

// ── Layout: a dragged corner, Straighten edges, overlaps ─────────────────────
const poly = (pts) => ({ type: "poly", floor_id: "main", points_m: pts });
const GEO = () => ({ Kitchen: poly([[0, 0], [4, 0], [4, 3], [0, 3]]), Pantry: poly([[4, 0], [6, 0.02], [6, 3], [4, 3]]),
  Porch: poly([[6.5, 3.5], [8, 3.5], [8, 5], [6.5, 5]]) });
const layout = async (sel = [], pairs = []) => {
  const ctx = makeCtx({ tab: "rooms", geo: GEO(), pairs });
  let root = maps.render(ctx); await flush();
  if (sel.length) { ctx.state.maps._roomsSel = sel; root = maps.render(ctx); await flush(); }
  return { ctx, root };
};
{
  const { ctx, root } = await layout(["Pantry"]);
  const vb = all(root, (n) => n.getAttribute && n.getAttribute("class") === "mapvector" && n.getAttribute("viewBox"))[0].getAttribute("viewBox").split(" ").map(Number);
  const draft = ctx.state.maps._roomsDraft;
  const drag = (title, dxm, dym, altKey = false) => {
    const h = all(root, (n) => typeof n.title === "string" && n.title.startsWith(title))[0];
    for (const k of Object.keys(winL)) winL[k] = [];
    h.dispatchEvent({ type: "mousedown", button: 0, clientX: 0, clientY: 0, preventDefault() {}, stopPropagation() {} });
    const e = { clientX: dxm * 800 / vb[2], clientY: dym * 600 / vb[3], altKey };
    for (const f of winL.mousemove || []) f(e);
    for (const f of [...(winL.mouseup || [])]) f(e);
  };
  drag("Pantry corner 3", 0.47, 0.46);               // (6, 3) to (6.47, 3.46): 5 cm from Porch's corner
  check("layout drag: a corner lands on another room's corner", near(draft.Pantry.points_m[2], [6.5, 3.5]), draft.Pantry.points_m);
  drag("Pantry corner 3", -0.1, 0.33);               // now from (6.5, 3.5) to (6.4, 3.83): 10 cm off Porch's left wall
  check("layout drag: else on another room's edge", near(draft.Pantry.points_m[2], [6.5, 3.83], 2e-3), draft.Pantry.points_m);
  drag("Pantry corner 3", -0.5, -0.32, true);
  check("layout drag: Alt held, where it was dropped (to the millimetre), not on the grid", near(draft.Pantry.points_m[2], [6.0, 3.51], 1e-6), draft.Pantry.points_m);
  drag("Pantry corner 3", 0.012, -0.517);            // (6.012, 2.993): nothing near, the grid
  check("layout drag: else on the 5 cm grid", near(draft.Pantry.points_m[2], [6.0, 3.0], 1e-6), draft.Pantry.points_m);
}
{
  const { ctx, root } = await layout([], [["Kitchen", "Pantry"]]);
  const draft = ctx.state.maps._roomsDraft, orig = JSON.stringify(ctx.state.maps._roomsOrig);
  attr(root, "data-room-straighten", "layout").click(); await flush(); await answered();
  check("layout straighten: the crooked edge is straight, on the line Kitchen uses", near(draft.Pantry.points_m[1], [6, 0]), draft.Pantry.points_m);
  check("layout straighten: Porch, straight already, untouched; nothing saved", near(draft.Porch.points_m[0], [6.5, 3.5])
    && JSON.stringify(ctx.state.maps._roomsOrig) === orig, draft);
  check("layout straighten: it says what it did", ctx.toasts.some(t => /^Straightened 1 edge\. Save corrections keeps it/.test(t)), ctx.toasts);
  const ask = ctx.calls.filter(c => c[0] === "padspan_ha/rooms_overlap");
  check("layout overlap: asked about the floor's outlines in metres", ask.length >= 1 && JSON.stringify(ask[0][1].rooms.Kitchen) === "[[0,0],[4,0],[4,3],[0,3]]", ask);
  check("layout overlap: named in plain words", textOf(root).includes("Kitchen and Pantry overlap, so the walls between them can't be drawn."), textOf(root).slice(0, 400));
}
{
  const { root } = await layout([], []);
  check("layout overlap: nothing said where nothing overlaps", !/overlap, so/.test(textOf(root)));
}

process.stdout.write(JSON.stringify(results) + "\n", () => process.exit(0));
