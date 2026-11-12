// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
//
// An outdoor room's surface (room_meta[name].surface, "pavers_2ft": grey
// landscaping tiles 2 ft square), run for real.
//
//   frame    outdoor_space.js: the tiles are laid from the corner of the
//            room's longest edge, along it, 0.6096 m a tile
//   map      the flat Map (iso_lights.js buildIsoSVG): with no paved room the
//            markup is byte for byte what it is without the surface module
//            (the drawing before it existed), Showcase on and off; one paved
//            patio adds one <pattern> and changes that room's fill and nothing
//            else; the pattern's tile is 0.6096 m on the drawing; an indoor
//            room with the value set is drawn as before
//   view     Live Aboard (live_aboard.js under the DOM shim and a stub GL): a
//            paved patio gets one joints mesh on its floor, clipped to its
//            L-shaped outline, at its level, uv in tiles true to scale, drawn
//            after the tiles; rooms without it (an indoor room with the value
//            set, a deck without it) get nothing new and the same floor colours
//   rooms    the Rooms page offers Surface only for an outdoor room (by name,
//            or on an outdoor floor), sends room_height_set {room, surface},
//            and changes nothing in Sample mode
//
// usage: room_surface.mjs <www/padspan-ha dir>
// prints one JSON line: { cases: {name: ok}, failures: [...] }

import * as nodeModule from "node:module";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { join } from "node:path";
import * as shim from "./dom_shim.mjs";
import { installStubGL } from "./stub_gl.mjs";

const WWW = process.argv[2];
if (!WWW) { console.error("usage: room_surface.mjs <www/padspan-ha dir>"); process.exit(2); }
// The drawing as it was before the surface existed: iso_lights.js loaded a
// second time (?nosurf) with outdoor_space.js refusing to load, as an older
// file set would have it (its import is optional: missing, nothing changes).
nodeModule.registerHooks({ load(url, context, nextLoad) {
  if (url.includes("outdoor_space.js?nosurf")) throw new Error("no surface module (the drawing before it)");
  return nextLoad(url, context);
} });
shim.install();
const lists = {};
globalThis.addEventListener = (t, fn) => { (lists[t] ||= []).push(fn); };
globalThis.removeEventListener = (t, fn) => { lists[t] = (lists[t] || []).filter(f => f !== fn); };
document.addEventListener = () => {}; document.removeEventListener = () => {};
installStubGL();

const url = (rel) => pathToFileURL(join(WWW, rel)).href;
const SURF = await import(url("views/outdoor_space.js"));
const ISO = await import(url("views/iso_lights.js"));
const ISO_BEFORE = await import(url("views/iso_lights.js") + "?nosurf");
const LA = await import(url("views/live_aboard.js"));
const THREE = await import(url("vendor/three/three.module.min.js"));
const R = await import(url("views/rooms.js") + "?t=1");

const cases = {}, failures = [];
const check = (name, ok, detail) => { cases[name] = !!ok; if (!ok) failures.push({ name, detail: detail === undefined ? null : detail }); };
const tryCase = async (name, fn) => {
  try { await fn(); } catch (e) { failures.push({ name, detail: String(e && e.stack || e).slice(0, 900) }); cases[name] = false; }
};
const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;
const clone = (o) => JSON.parse(JSON.stringify(o));
const T = SURF.PAVER_M;

// ── the house: Living and an L-shaped Deck upstairs on Main, a Patio below ──
const rect = (floor_id, x0, y0, x1, y1) => ({ type: "poly", floor_id, points_m: [[x0, y0], [x1, y0], [x1, y1], [x0, y1]] });
// The deck: an L, its longest edge the first (0,6) -> (10,6), 10 m.
const L_PTS = [[0, 6], [10, 6], [10, 9], [4, 9], [4, 11], [0, 11]];
const L_AREA = 10 * 3 + 4 * 2;
const HOUSE = {
  floors: [{ id: "basement", name: "Basement", floor_to_floor_m: 2.6 }, { id: "main", name: "Main", floor_to_floor_m: 2.8 }],
  floor_elevations: { basement: 0, main: 2.6 },
  room_geometry_m: {
    Rec: rect("basement", 0, 0, 6, 5),
    // 10 tiles by 5: (0,5) -> (6.096,5) is its longest edge.
    Patio: rect("basement", 0, 5, 10 * T, 5 + 5 * T),
    Living: rect("main", 0, 0, 6, 5),
    Deck: { type: "poly", floor_id: "main", points_m: L_PTS },
  },
  room_meta: { Rec: { floor_id: "basement", color: "#3b82f6" }, Patio: { floor_id: "basement", color: "#22c55e" },
               Living: { floor_id: "main", color: "#f59e0b" }, Deck: { floor_id: "main", color: "#a855f7" } },
  light_positions_m: {},
};
const withSurface = (rooms) => { const m = clone(HOUSE); for (const n of rooms) m.room_meta[n].surface = "pavers_2ft"; return m; };

// ── frame ──────────────────────────────────────────────────────────────────
await tryCase("frame: laid from the corner of the longest edge, along it, a tile 0.6096 m", () => {
  const f = SURF.paverFrame(L_PTS);
  const [u1, v1] = SURF.paverUv(f, 10, 6), [u2, v2] = SURF.paverUv(f, 0, 6 + T);
  check("frame: laid from the corner of the longest edge, along it, a tile 0.6096 m",
    T === 0.6096 && f.ox === 0 && f.oy === 6 && near(f.ex, 1) && near(f.ey, 0) && near(u1, 10 / T) && near(v1, 0) && near(u2, 0) && near(v2, 1)
    && SURF.paved(true, "pavers_2ft") && !SURF.paved(false, "pavers_2ft") && !SURF.paved(true, null)
    && SURF.roomSurface({ room_meta: { A: { surface: "gravel" } } }, "A") === null, { f, u1, v1, u2, v2 });
});
await tryCase("frame: a slanted room's tiles run along its slant", () => {
  const a = Math.PI / 6, P = [[1, 1], [1 + 8 * Math.cos(a), 1 + 8 * Math.sin(a)], [1 + 8 * Math.cos(a) - 2 * Math.sin(a), 1 + 8 * Math.sin(a) + 2 * Math.cos(a)], [1 - 2 * Math.sin(a), 1 + 2 * Math.cos(a)]];
  const f = SURF.paverFrame(P), [u, v] = SURF.paverUv(f, P[2][0], P[2][1]);
  check("frame: a slanted room's tiles run along its slant", near(u, 8 / T, 1e-9) && near(v, 2 / T, 1e-9), { f, u, v });
});

// ── map ────────────────────────────────────────────────────────────────────
const FLOORS = HOUSE.floors;
const svg = (M, model, show) => M.buildIsoSVG(model, {}, new Set(), null, 150, 0, {}, false, FLOORS, show ? { showcase: "classic" } : {});
for (const show of [false, true]) {
  const tag = show ? "Showcase" : "working map";
  await tryCase(`map: ${tag}: no paved room, the markup is byte for byte the drawing before`, () => {
    const now = svg(ISO, clone(HOUSE), show), before = svg(ISO_BEFORE, clone(HOUSE), show);
    // An indoor room given the value is not paved: as before too.
    const indoor = svg(ISO, withSurface(["Living", "Rec"]), show);
    // ...and the drawing before really has no surface: a paved patio is plain there.
    const blind = svg(ISO_BEFORE, withSurface(["Patio"]), show) === before && svg(ISO, withSurface(["Patio"]), show) !== before;
    check(`map: ${tag}: no paved room, the markup is byte for byte the drawing before`,
      now.length > 2000 && now === before && indoor === before && !now.includes("pspave") && blind,
      { now: now.length, before: before.length, indoor: indoor === before, blind });
  });
  await tryCase(`map: ${tag}: a paved patio adds one pattern, changes its fill and lays its colour over the tiles, nothing else`, () => {
    const base = svg(ISO, clone(HOUSE), show), paved = svg(ISO, withSurface(["Patio"]), show);
    const pats = paved.match(/<pattern id="pspave_\d+"[^]*?<\/pattern>/g) || [];
    const fills = paved.match(/fill="url\(#pspave_\d+\)" fill-opacity="0\.5"/g) || [];
    // Its fill polygon's points, and the same polygon in the plain drawing.
    const el = paved.match(/<polygon points="([^"]+)" fill="url\(#pspave_\d+\)"/);
    const plainEl = el && base.match(new RegExp(`<polygon points="${el[1].replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}" (fill="#[0-9a-fA-F]{6}" fill-opacity="[0-9.]+")`));
    // ...and its colour (a lit room's tint) laid over the tiles at the plain fill's strength: one polygon, right after it.
    const tint = el && plainEl && `<polygon points="${el[1]}" ${plainEl[1]} stroke="none" pointer-events="none"/>`;
    const back = pats.length === 1 && fills.length === 1 && plainEl && paved.split(tint).length === 2
      ? paved.replace(pats[0], "").replace(tint, "").replace(fills[0], plainEl[1]) : null;
    check(`map: ${tag}: a paved patio adds one pattern, changes its fill and lays its colour over the tiles, nothing else`,
      back === base && pats[0].includes(SURF.PAVER_GREY) && pats[0].includes(SURF.PAVER_JOINT),
      { pats: pats.length, fills: fills.length, plain: !!plainEl, same: back === base });
  });
}
await tryCase("map: one tile of the pattern is 0.6096 m on the drawing, square to the patio", () => {
  const paved = svg(ISO, withSurface(["Patio"]), false);
  const m = paved.match(/patternTransform="matrix\(([^)]+)\)"/)[1].split(" ").map(Number);
  const el = paved.match(/<polygon points="([^"]+)" fill="url\(#pspave_\d+\)"/)[1].split(" ").map(p => p.split(",").map(Number));
  // Patio's corners: (0,5) (10 tiles, 5) (10 tiles, 5 + 5 tiles) (0, 5 + 5 tiles).
  const d = (a, b) => [b[0] - a[0], b[1] - a[1]];
  const e = d(el[0], el[1]), n = d(el[0], el[3]);
  check("map: one tile of the pattern is 0.6096 m on the drawing, square to the patio",
    // The room's corners are written to the pixel, the pattern to a thousandth.
    near(m[0] * 10, e[0], 1.2) && near(m[1] * 10, e[1], 1.2) && near(m[2] * 5, n[0], 1.2) && near(m[3] * 5, n[1], 1.2)
    && near(m[4], el[0][0], 0.6) && near(m[5], el[0][1], 0.6), { m, el });
});

// ── view ───────────────────────────────────────────────────────────────────
const settle = async (rounds = 30) => { await shim.flush(rounds); await new Promise(r => globalThis._realSetTimeout(r, 0)); };
const api = { toast(){}, toggle(){}, openRoom(){}, openFloor(){}, openControls(){}, openActivity(){}, controlsFor: () => null, lightsByEid: {}, hass: null };
const props = (model) => ({ model, floors: model.floors, lightsByEid: {}, hidden: new Set(), topFloorIds: null, quality: "low",
  telemetry: () => {}, onTouch: () => {}, states: {}, config: {}, bearing: 0, saveNorth: async () => true, useApi: () => api,
  haStartedMs: 0, load: async () => ({ data: {} }), edit: async () => ({ data: {} }) });
async function drawn(key, model){
  const slot = LA.liveAboardSlot(key);
  const c = document.createElement("div"), stage = document.createElement("div");
  c.appendChild(stage); document.body.replaceChildren(c);
  slot.attach(stage, props(model));
  await settle();
  const s = slot._state();
  const out = { paving: s.paving, tiles: s.look && s.look.tiles, ok: !!s.frames };
  LA.releaseLiveAboardSlot(key);
  await settle(4);
  return out;
}
const inPoly = (x, y, P) => { let c = false; for (let i = 0, j = P.length - 1; i < P.length; j = i++) { const a = P[i], b = P[j];
  if ((a[1] > y) !== (b[1] > y) && x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0]) c = !c; } return c; };
await tryCase("view: a paved L-shaped deck gets one joints mesh, clipped to its outline, at its level, true to scale", async () => {
  const s = await drawn("surface-deck", withSurface(["Deck"]));
  const P = s.paving, pos = P[0] && P[0].pos, uv = P[0] && P[0].uv;
  let area = 0, inside = true, level = true, scale = true;
  for (let t = 0; pos && t < pos.length; t += 9) {
    const a = [pos[t], pos[t + 2]], b = [pos[t + 3], pos[t + 5]], c = [pos[t + 6], pos[t + 8]];
    area += Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1])) / 2;
    if (!inPoly((a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3, L_PTS)) inside = false;
  }
  for (let i = 0; pos && i < pos.length / 3; i++) {
    // Main is at 2.6 m; the joints just over the tiles (2 mm, plus the tiles' own anti-z-fight step).
    const y = pos[i * 3 + 1];
    if (!(y > 2.6 + 0.0019 && y < 2.6 + 0.0061)) level = false;
    // uv: tiles from (0,6) along +x, and across it.
    if (!near(uv[i * 2], pos[i * 3] / T, 1e-4) || !near(uv[i * 2 + 1], (pos[i * 3 + 2] - 6) / T, 1e-4)) scale = false;
  }
  check("view: a paved L-shaped deck gets one joints mesh, clipped to its outline, at its level, true to scale",
    s.ok && P.length === 1 && P[0].floor === "main" && P[0].inGroup && P[0].order === 1 && near(area, L_AREA, 1e-6) && inside && level && scale
    && P[0].mat.transparent && !P[0].mat.depthWrite && P[0].mat.map && P[0].mat.map.wrapS === 1000            // RepeatWrapping
    && P[0].mat.color.equals(new THREE.Color(SURF.PAVER_JOINT)),
    { n: P.length, area, inside, level, scale, floor: P[0] && P[0].floor });
});
await tryCase("view: rooms without it get nothing new: no mesh, the same floor colours", async () => {
  const plain = await drawn("surface-plain", clone(HOUSE));
  const indoor = await drawn("surface-indoor", withSurface(["Living", "Rec"]));
  const deck = await drawn("surface-deck2", withSurface(["Deck"]));
  check("view: rooms without it get nothing new: no mesh, the same floor colours",
    plain.ok && plain.paving.length === 0 && indoor.paving.length === 0 && indoor.tiles === plain.tiles
    && deck.tiles !== plain.tiles && deck.paving.length === 1, { plain: plain.tiles, indoor: indoor.tiles, deck: deck.tiles });
});

// ── rooms ──────────────────────────────────────────────────────────────────
const panelSrc = readFileSync(join(WWW, "panel.js"), "utf-8").replace(/\r\n/g, "\n");
const elSrc = panelSrc.slice(panelSrc.indexOf("function el(tag, attrs={}, children=[]){"));
const el = new Function(elSrc.slice(0, elSrc.indexOf("\n}\n") + 3) + "\nreturn el;")();
function roomsCtx(over = {}){
  const calls = [];
  const model = {
    floors: [{ id: "ground", name: "Ground" }, { id: "outside", name: "Outside" }],
    areas: [{ id: "k", name: "Kitchen", floor_id: "ground" }, { id: "p", name: "Back Patio", floor_id: "ground" },
            { id: "s", name: "Shed", floor_id: "outside" }],
    room_meta: { Kitchen: { floor_id: "ground", color: "#112233" }, "Back Patio": { floor_id: "ground", color: "#223344", surface: "pavers_2ft" },
                 Shed: { floor_id: "outside", color: "#334455" } },
    room_geometry_m: {},
  };
  const ctx = {
    hass: { user: { is_admin: true } },
    state: { complexity: "advanced", view: "rooms", settings: {}, model, live: { snapshot: null }, maps: { list: [] }, ...over },
    helpers: { el, helpBtn: () => el("button", {}, "?"), esc: (s) => String(s ?? ""), roomColor: () => "#888888" },
    actions: { modelUpdate: async () => {}, wsCall: async (type, data) => { calls.push({ type, ...data }); return { ok: true }; },
               modelRefresh: async () => {}, telemetryEvent: () => {}, renderRooms: () => {}, followedHas: () => false },
    toast: () => {},
  };
  return { ctx, calls };
}
const all = (n, out = []) => { for (const c of n.children || []) { out.push(c); all(c, out); } return out; };
const roomNode = (root, name) => all(root).find(n => n.getAttribute && n.getAttribute("data-room") === name);
const surfOf = (root, name) => all(roomNode(root, name)).find(n => n.getAttribute && n.getAttribute("data-edit") === "surface") || null;
await tryCase("rooms: Surface is offered for an outdoor room only, with its stored value", async () => {
  const { ctx } = roomsCtx();
  const root = R.render(ctx);
  const p = surfOf(root, "Back Patio"), s = surfOf(root, "Shed"), k = surfOf(root, "Kitchen");
  const rows = R.roomGroups(ctx).flatMap(g => g.rooms);
  check("rooms: Surface is offered for an outdoor room only, with its stored value",
    p && s && !k && p.value === "pavers_2ft" && s.value === "" && p.children.length === 2
    && rows.find(r => r.name === "Kitchen").outdoor === false && rows.find(r => r.name === "Shed").outdoor === true,
    { p: !!p, s: !!s, k: !!k, pv: p && p.value });
});
await tryCase("rooms: a choice is saved with room_height_set {room, surface}", async () => {
  const { ctx, calls } = roomsCtx();
  const root = R.render(ctx);
  const p = surfOf(root, "Back Patio");
  p.value = ""; p.dispatchEvent({ type: "change" });
  await shim.flush();
  const s = surfOf(root, "Shed");
  s.value = "pavers_2ft"; s.dispatchEvent({ type: "change" });
  await shim.flush();
  check("rooms: a choice is saved with room_height_set {room, surface}",
    JSON.stringify(calls) === JSON.stringify([{ type: "padspan_ha/room_height_set", room: "Back Patio", surface: null },
                                              { type: "padspan_ha/room_height_set", room: "Shed", surface: "pavers_2ft" }]), calls);
});
await tryCase("rooms: in Sample mode it shows but is switched off, and sends nothing", async () => {
  const { ctx, calls } = roomsCtx({ dataMode: "sample", _dataModeKnown: true });
  const root = R.render(ctx);
  const p = surfOf(root, "Back Patio");
  p.value = ""; p.dispatchEvent({ type: "change" });
  await shim.flush();
  check("rooms: in Sample mode it shows but is switched off, and sends nothing", p.disabled && calls.length === 0, calls);
});

console.log(JSON.stringify({ cases, failures }));
process.exit(0);
