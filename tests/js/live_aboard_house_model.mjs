// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
//
// Live Aboard, the house itself (views/live_aboard_storey.js, the stairs
// builder, the doorway and the doors with no sensor), run for real: the
// numbers under node, then the view (views/live_aboard.js) under the DOM
// shim with a stub GL (tests/js/stub_gl.mjs).
//
//   storey   the solid floor under a storey fills a hall never drawn as a
//            room (not a wide gap); its outline runs along the walls, one
//            slanted wall does not tilt it; a room less a convex hole
//   roof     hips over the part of a storey with nothing above it, faces
//            out, eaves past the walls, a fascia; when it shows (Roof on
//            Auto, zoomed out past the whole house, every floor, walls Up or
//            Cut, not Top, not Edit or Furnish) and its fade
//   stairs   the floor reached and the rise; the opening keyed by that
//            floor; the steps reach it, for straight, L and U
//   door     how a door with no sensor stands; a doorway is a gap under a
//            lintel, in the draft and the walls
//   view     stairs reach the floor above, drawn as high as the gap, and
//            cut their opening from its tiles and its storey's floor; the
//            storey's floor under an undrawn hall; a doorway drawn; doors
//            with no sensor ajar inside and shut outside, and their sheet's
//            Shown; the roof shown and hidden by the camera, the floor, the
//            view and the tool, fading then still: 0 frames at rest
//   types    every door type shut in its opening and open its own way;
//            PadSpan's first guess; a cover's position; in the view each
//            type drawn, a cover followed (and still at rest), a sensor
//            followed, and a tap on a cover's door sending nothing
//
// usage: live_aboard_house_model.mjs <www/padspan-ha dir>
// prints one JSON line: { cases: {name: result}, failures: [...] }

import { pathToFileURL } from "node:url";
import { join } from "node:path";
import * as shim from "./dom_shim.mjs";
import { installStubGL } from "./stub_gl.mjs";

const WWW = process.argv[2];
if (!WWW) { console.error("usage: live_aboard_house_model.mjs <www/padspan-ha dir>"); process.exit(2); }
const S = await import(pathToFileURL(join(WWW, "views", "live_aboard_storey.js")).href);
const H = await import(pathToFileURL(join(WWW, "views", "live_aboard_house.js")).href);
const DR = await import(pathToFileURL(join(WWW, "views", "live_aboard_draft.js")).href);
const FU = await import(pathToFileURL(join(WWW, "views", "live_aboard_furniture.js")).href);

const failures = [];
const cases = {};
const check = (name, ok, detail) => { cases[name] = !!ok; if (!ok) failures.push({ name, detail: detail === undefined ? null : detail }); };
const tryCase = async (name, fn) => {
  try { await fn(); } catch (e) { failures.push({ name, detail: String(e && e.stack || e).slice(0, 900) }); cases[name] = false; }
};
const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;
const rect = (floor_id, x0, y0, x1, y1) => ({ type: "poly", floor_id, points_m: [[x0, y0], [x1, y0], [x1, y1], [x0, y1]] });
const houseOf = (model) => H.readHouse(model, model.floors, {}, new Set(), {});
const inStorey = (st, x, y) => st.shapes.some(sh => S.inside(x, y, sh.outer) && !sh.holes.some(h => S.inside(x, y, h)));

// ── storey ──────────────────────────────────────────────────────────────────
await tryCase("storey: a hall never drawn as a room is floor; a wide gap is not", () => {
  const model = { floors: [{ id: "main", name: "Main" }],
    room_geometry_m: { A: rect("main", 0, 0, 4, 4), B: rect("main", 5.2, 0, 9, 4), C: rect("main", 12.5, 0, 15, 4) } };
  const m = S.houseModel(houseOf(model));
  const st = m.storeys[0];
  check("storey: a hall never drawn as a room is floor; a wide gap is not",
    m.storeys.length === 1 && inStorey(st, 4.6, 2) && inStorey(st, 2, 2) && inStorey(st, 8, 1) && !inStorey(st, 11, 2)
    && inStorey(st, 13, 2) && !inStorey(st, 4.6, 5) && st.shapes.length === 2, { shapes: st.shapes.length });
});
await tryCase("storey: the outline runs along the walls, and one slanted wall does not tilt it", () => {
  const model = { floors: [{ id: "main", name: "Main" }],
    room_geometry_m: { L1: rect("main", 0, 0, 10, 4), L2: rect("main", 0, 4, 4, 9),
                       Bay: { type: "poly", floor_id: "main", points_m: [[10, 0], [12, 2], [10, 4]] } } };
  const h = houseOf(model), m = S.houseModel(h), outer = m.storeys[0].shapes[0].outer;
  const axis = S.houseAxis(h.rooms);
  // Every point of the outline within a cell or so of a room's edge; an L with a bay: few corners.
  const off = Math.max(...outer.map(([x, y]) => Math.min(...h.rooms.flatMap(r => r.pts.map((p, i) => {
    const q = r.pts[(i + 1) % r.pts.length];
    return H.segDist(x, y, p[0], p[1], q[0], q[1])[0];
  })))));
  check("storey: the outline runs along the walls, and one slanted wall does not tilt it",
    axis === 0 && outer.length <= 10 && off <= 0.13, { axis, n: outer.length, off });
});
await tryCase("storey: a room less a convex hole keeps all but the hole", () => {
  const P = [[0, 0], [6, 0], [6, 4], [0, 4]];
  const mid = S.minusConvex(P, [[2, 1], [4, 1], [4, 3], [2, 3]]), edge = S.minusConvex(P, [[5, 1], [7, 1], [7, 3], [5, 3]]);
  const away = S.minusConvex(P, [[10, 10], [11, 10], [11, 11]]);
  const area = (list) => list.reduce((a, Q) => a + Math.abs(S.areaOf(Q)), 0);
  const covers = (list, x, y) => list.some(Q => S.inside(x, y, Q));
  check("storey: a room less a convex hole keeps all but the hole",
    near(area(mid), 24 - 4, 1e-6) && near(area(edge), 24 - 2, 1e-6) && away.length === 1 && away[0] === P
    && !covers(mid, 3, 2) && covers(mid, 1, 2) && covers(mid, 3, 0.5) && !covers(edge, 5.5, 2) && covers(edge, 5.5, 3.5),
    { mid: area(mid), edge: area(edge) });
});

// ── roof ────────────────────────────────────────────────────────────────────
await tryCase("roof: over the part of each storey with nothing above it, faces out, eaves and fascia", () => {
  const model = { floors: [{ id: "main", name: "Main" }, { id: "upper", name: "Upper" }], floor_elevations: { main: 0, upper: 2.8 },
    room_geometry_m: { Big: rect("main", 0, 0, 12, 6), Loft: rect("upper", 0, 0, 5, 6) } };
  const m = S.houseModel(houseOf(model)), [lo, up] = m.storeys;
  const ok = (part, x, y) => x >= part.u0 && x <= part.u1 && y >= part.v0 && y <= part.v1;
  const r = S.hipRoof(up.roof[0], m.frame);
  // The 3D view puts plan (x, y, up) at (x, up, y): each face's normal there points up, each band's out.
  const n3 = (t) => { const [a, b, c] = t.map(p => [p[0], p[2], p[1]]); const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
                      return [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]]; };
  const up3 = r.roof.every(t => n3(t)[1] > 0);
  const mid = [2.5, 3];
  const outs = r.fascia.every(t => { const n = n3(t), c = [(t[0][0] + t[1][0] + t[2][0]) / 3, (t[0][1] + t[1][1] + t[2][1]) / 3];
                                     return n[0] * (c[0] - mid[0]) + n[2] * (c[1] - mid[1]) > 0; });
  const xs = r.roof.flat().map(p => p[0]), top = Math.max(...r.roof.flat().map(p => p[2]));
  check("roof: over the part of each storey with nothing above it, faces out, eaves and fascia",
    lo.roof.length >= 1 && lo.roof.every(p => !ok(p, 2.5, 3)) && lo.roof.some(p => ok(p, 9, 3)) && up.roof.length === 1 && ok(up.roof[0], 2.5, 3)
    && up3 && outs && r.fascia.length === 8 && near(Math.min(...xs), -S.EAVE_M, 0.11) && near(Math.max(...xs), 5 + S.EAVE_M, 0.11)
    && top > 1 && top <= S.ROOF_MAX_H, { lo: lo.roof, up: up.roof, up3, outs, top });
});
await tryCase("roof: shown only from outside, with every floor, walls Up or Cut, not Top, not editing", () => {
  const base = { setting: "auto", editing: false, furnish: false, topElev: null, topStorey: 2.8, wallMode: "cut", phi: 0.9, radius: 40, fitR: 30 };
  const R = (o) => S.roofShown({ ...base, ...o });
  check("roof: shown only from outside, with every floor, walls Up or Cut, not Top, not editing",
    R({}) && R({ wallMode: "up" }) && R({ topElev: 2.8 }) && !R({ radius: 30 }) && !R({ radius: 30 * S.ROOF_FIT_K - 0.01 })
    && R({ radius: 30 * S.ROOF_FIT_K }) && !R({ setting: "off" }) && !R({ editing: true }) && !R({ furnish: true })
    && !R({ topElev: 0 }) && !R({ wallMode: "down" }) && !R({ phi: 0.0015 }) && !R({ fitR: null }) && S.roofSetting("x") === "auto",
    {});
});
await tryCase("roof: it fades over 0.3 s, then is still", () => {
  let k = 0, steps = 0, moving = true;
  while (moving && steps < 100) { const r = S.roofFade(k, true, 16); k = r.k; moving = r.moving; steps++; }
  const back = S.roofFade(1, false, 150);
  check("roof: it fades over 0.3 s, then is still", k === 1 && steps >= 18 && steps <= 20 && near(back.k, 0.5) && back.moving
    && !S.roofFade(0, false, 16).moving, { steps, back });
});

// ── stairs ──────────────────────────────────────────────────────────────────
const FLOORS = [{ id: "basement", elev: 0, h: 3, outdoor: false }, { id: "main", elev: 3, h: 2.3, outdoor: false },
                { id: "outside", elev: 3, h: 2.8, outdoor: true }, { id: "upper", elev: 5.3, h: 2.8, outdoor: false }];
await tryCase("stairs: the floor reached and the rise", () => {
  const a = S.stairReach("main", null, FLOORS), b = S.stairReach("basement", "upper", FLOORS), c = S.stairReach("basement", "gone", FLOORS);
  const d = S.stairReach("upper", null, FLOORS), e = S.stairReach("basement", "basement", FLOORS);
  check("stairs: the floor reached and the rise",
    a.to.id === "upper" && near(a.rise, 2.3) && b.to.id === "upper" && near(b.rise, 5.3) && c.to.id === "main" && near(c.rise, 3)
    && d.to === null && near(d.rise, 2.8) && e.to.id === "main", { a, b, c, d });
});
await tryCase("stairs: the opening is the footprint, cut in the floor reached", () => {
  const p = { id: "fur_00000001", floor_id: "main", x_m: 2, y_m: 3, rotation: 90, recipe: { kind: "stairs", params: {}, width_m: 1, depth_m: 3 } };
  const sofa = { ...p, id: "fur_00000002", recipe: { ...p.recipe, kind: "sofa" } };
  const cuts = S.stairCuts({ [p.id]: p, [sofa.id]: sofa }, FLOORS);
  const C = (cuts.get("upper") || [])[0];
  check("stairs: the opening is the footprint, cut in the floor reached",
    cuts.size === 1 && C && near(Math.abs(S.areaOf(C)), 3, 1e-9) && S.inside(3.2, 3.2, C) && !S.inside(2, 3.8, C)
    && S.stairsSignature({ [p.id]: p }) !== S.stairsSignature({ [p.id]: { ...p, x_m: 2.1 } })
    && S.stairsSignature({ [sofa.id]: sofa }) === "[]", { C });
});
await tryCase("stairs: the steps reach the floor above, straight, L and U", () => {
  const bad = [];
  for (const shape of ["straight", "l", "u"]) for (const turn of ["left", "right"]) {
    const Sz = { w: shape === "straight" ? 1 : 2, d: 3.2, h: 2.3 }, L = FU.stairFlights(Sz, { shape, turn });
    const top = Math.max(...L.steps.map(s => s.h), ...L.landings.map(s => s.h));
    const inBox = [...L.steps, ...L.landings].every(b => b.x0 >= -Sz.w / 2 - 1e-9 && b.x1 <= Sz.w / 2 + 1e-9 && b.z0 >= -Sz.d / 2 - 1e-9 && b.z1 <= Sz.d / 2 + 1e-9);
    const onEdge = near(Math.abs(L.exit.x), Sz.w / 2, 1e-9) || near(Math.abs(L.exit.z), Sz.d / 2, 1e-9);
    if (!(near(top + L.riser, 2.3, 1e-9) && L.riser <= FU.STAIR_RISER_M + 1e-9 && inBox && onEdge && L.path.length >= 3)) bad.push({ shape, turn, top, riser: L.riser, inBox, onEdge });
  }
  check("stairs: the steps reach the floor above, straight, L and U", !bad.length, bad);
});

// ── doors and doorways ──────────────────────────────────────────────────────
await tryCase("door: with no sensor, ajar inside and shut outside or as a garage door; as stored when set", () => {
  const pc = (o) => ({ x0: 0, y0: 0, x1: 0.9, y1: 0, cls: "int", ...o });
  check("door: with no sensor, ajar inside and shut outside or as a garage door; as stored when set",
    S.doorShown(pc()) === "ajar" && S.doorShown(pc({ cls: "ext" })) === "shut" && S.doorShown(pc({ x1: 2.4 })) === "shut"
    && S.doorShown(pc({ override: { shown: "open" } })) === "open" && S.doorShown(pc({ cls: "ext", override: { shown: "ajar" } })) === "ajar"
    && S.doorShown(pc({ override: { shown: "wide" } })) === "ajar" && S.DOOR_ANGLE_DEG.ajar === 70);
});
await tryCase("doorway: a gap under a lintel, drawn and kept as a doorway", () => {
  const els = H.wallElements({ x0: 0, y0: 0, x1: 1.2, y1: 0, kind: "doorway", cls: "int", thick: 0.12, head_m: 2.1 }, 2.8);
  const rec = DR.newOpening("doorway", "main", [0, 0], [1.2, 0], 2.65), id = DR.newOpeningId("doorway");
  const sw = DR.switchKind("door_0a1b2c3d", { ...DR.newOpening("door", "main", [0, 0], [1.2, 0], 2.65) }, 2.65, "doorway");
  const back = DR.switchKind(sw.id, sw.rec, 2.65, "door");
  const owned = DR.ownedOf({ openings: { doorway_0a1b2c3d: rec, bar_1: { hinge: "right", shown: "open" }, door_00000001: { ...DR.newOpening("door", "main", [0, 0], [1, 0], 2.65), shown: "shut" } } });
  check("doorway: a gap under a lintel, drawn and kept as a doorway",
    els.length === 2 && !els.some(e => e.leaf || e.glass) && near(els[0].z1, 0) && near(els[1].z0, 2.1)
    && rec.kind === "doorway" && JSON.stringify(Object.keys(rec).sort()) === JSON.stringify(["a_m", "b_m", "floor_id", "head_m", "kind"])
    && DR.OPENING_ID.test(id) && id.startsWith("doorway_") && sw.id === "doorway_0a1b2c3d" && sw.rec.kind === "doorway"
    && back.id === "door_0a1b2c3d" && back.rec.hinge === "left" && DR.minWidth("doorway") === DR.DOOR_MIN_M
    && owned.openings.doorway_0a1b2c3d.kind === "doorway" && owned.openings.bar_1.shown === "open" && owned.openings.door_00000001.shown === "shut",
    { els, rec, sw, owned });
});

// ── door types (door_types.js) ──────────────────────────────────────────────
const DT = await import(pathToFileURL(join(WWW, "views", "door_types.js")).href);
const W0 = 2.4, H0 = 2.1, T0 = { slide: "right", face: "in", panels: 3, glass: false };
const PN = (type, a, t = {}) => DT.doorPanels({ ...T0, type, ...t }, a, W0, H0, 0.14, 85 * Math.PI / 180, false, 2.65);
const inOpening = (list) => list.every(p => p.c[0] >= -1e-9 && p.c[0] <= W0 + 1e-9 && Math.abs(p.c[1]) <= 0.2 && Math.abs(p.pitch) < 1e-9);
await tryCase("types: every type shut stands in its opening; open, each moves its own way", () => {
  const bad = [];
  const ok = (name, cond, d) => { if (!cond) bad.push({ name, d }); };
  for (const type of DT.DOOR_TYPES) ok(`${type} shut`, inOpening(PN(type, 0).filter(p => p.kind !== "drum")), PN(type, 0));
  const deg = (r) => Math.round(r * 180 / Math.PI);
  ok("hinged: one leaf swung 85°", PN("hinged", 1).length === 1 && deg(PN("hinged", 1)[0].yaw) === 85);
  ok("double: two leaves, each half, swung", PN("double", 1).length === 2 && PN("double", 1).every(p => Math.abs(p.size[0] - W0 / 2) < 1e-9 && p.c[1] > 0.5));
  const sl = PN("sliding", 1, { glass: true }), sl0 = PN("sliding", 0, { glass: true });
  ok("sliding: one half slides behind the fixed one, glass", sl.length === 2 && sl.every(p => p.glass) && Math.abs(sl[1].c[0] - sl[0].c[0]) < 1e-9 && sl0[1].c[0] < sl0[0].c[0]);
  const both = PN("sliding", 1, { slide: "both" });
  ok("sliding both ways: the halves part past the ends", both[0].c[0] < 0 && both[1].c[0] > W0);
  ok("barn: along the wall's face past its end, on the side asked", PN("barn", 1)[0].c[0] > W0 && PN("barn", 1)[0].c[1] > 0.07 && PN("barn", 1, { face: "out" })[0].c[1] < -0.07
     && PN("barn", 1, { slide: "left" })[0].c[0] < 0);
  ok("pocket: into the wall", PN("pocket", 1)[0].c[1] === 0 && PN("pocket", 1)[0].c[0] > W0);
  const bf = PN("bifold", 1);
  ok("bifold: 3 panels folded in a zig-zag at the side", bf.length === 3 && bf.every(p => p.c[0] > W0 * 0.7 && p.c[1] > 0.2) && PN("bifold", 1, { slide: "both", panels: 4 }).length === 4);
  const oh = PN("overhead", 1), oh5 = PN("overhead", 0.5);
  ok("overhead: four sections, up and back under the ceiling, the lowest on the bend", oh.length === 4
     && oh.every(p => p.pitch > 0.5 && p.c[2] <= 2.65 && p.c[2] >= H0 && p.c[1] > 0) && oh.filter(p => Math.abs(p.pitch - Math.PI / 2) < 1e-9).length >= 3
     && oh5.some(p => p.pitch === 0) && oh5.some(p => p.pitch > 0));
  const ru = PN("rollup", 1), ru0 = PN("rollup", 0);
  ok("roll-up: a drum over it, the curtain shortened into it", ru.find(p => p.kind === "drum") && ru.find(p => p.kind === "curtain").size[1] < 0.05
     && Math.abs(ru0.find(p => p.kind === "curtain").size[1] - H0) < 1e-9);
  const tu = PN("tiltup", 1)[0];
  ok("tilt-up: one piece up and out", Math.abs(tu.pitch + Math.PI / 2) < 1e-9 && tu.c[1] < -1 && Math.abs(tu.c[2] - H0) < 1e-9);
  ok("gate: a single leaf, a double, or one sliding", PN("gate", 1, { panels: 1, slide: null }).length === 1 && PN("gate", 1, { panels: 2, slide: null }).length === 2
     && PN("gate", 1, { slide: "left" })[0].c[0] < 0 && PN("gate", 0, { slide: null, panels: 1 }).every(p => p.size[1] <= 1.5));
  check("types: every type shut stands in its opening; open, each moves its own way", !bad.length, bad);
});
await tryCase("types: PadSpan's first guess, and the stored type over it", () => {
  const room = (name, x0, y0, x1, y1, outdoor = false) => ({ name, outdoor, pts: [[x0, y0], [x1, y0], [x1, y1], [x0, y1]] });
  const rooms = [room("Garage", 0, 0, 6, 6), room("Hall", 6.1, 0, 9, 6), room("Bedroom Closet", 0, 6.1, 3, 8)];
  const pc = (o) => ({ x0: 1, y0: 0, x1: 3.6, y1: 0, nx: 0, ny: 1, cls: "ext", mat: null, barrier: null, ...o });
  const g = (o) => DT.guessDoorType(pc(o), rooms).type;
  const got = { garage: g({}), narrowGarage: g({ x1: 3 }), glass: g({ x0: 6.5, x1: 7.4, mat: "glass" }),
                patio: g({ x0: 6.5, x1: 7.4, barrier: { name: "Patio door" } }), closet: g({ x0: 0.5, x1: 1.7, y0: 6.05, y1: 6.05, cls: "int" }),
                double: g({ x0: 6.5, x1: 8.1, cls: "int" }), hinged: g({ x0: 6.5, x1: 7.4, cls: "int" }) };
  const stored = DT.doorTypeOf(pc({ override: { type: "barn", slide: "left", face: "out" } }), rooms);
  const guessed = DT.doorTypeOf(pc({}), rooms);
  check("types: PadSpan's first guess, and the stored type over it",
    got.garage === "overhead" && got.narrowGarage === "hinged" && got.glass === "sliding" && got.patio === "sliding" && got.closet === "bifold"
    && got.double === "double" && got.hinged === "hinged" && stored.type === "barn" && !stored.guessed && stored.guess === "overhead"
    && stored.slide === "left" && stored.face === "out" && guessed.guessed && guessed.type === "overhead"
    && DT.doorTypeOf(pc({ x0: 6.5, x1: 7.4, mat: "glass" }), rooms).glass === true, { got, stored, guessed });
});
await tryCase("types: a cover's position is how open it is; opening and closing move it", () => {
  const a = DT.coverAt({ state: "open", attributes: { current_position: 40 } }), b = DT.coverAt({ state: "opening", attributes: { current_position: 40 } });
  const c = DT.coverAt({ state: "closed", attributes: {} }), d = DT.coverAt({ state: "unavailable", attributes: {} }), e = DT.coverAt({ state: "closing", attributes: {} });
  check("types: a cover's position is how open it is; opening and closing move it",
    a.at === 0.4 && a.moving === 0 && b.at === 0.4 && b.moving === 1 && c.at === 0 && d.none && e.moving === -1
    && DT.linkKind("cover.garage_door") === "cover" && DT.linkKind("binary_sensor.patio") === "sensor"
    && DT.shownAt("overhead", "ajar") === DT.LIFT_AJAR && DT.shownAt("sliding", "ajar") === 0.5 && DT.shownAt("hinged", "ajar") === 1
    && DT.shownAt("bifold", "shut") === 0 && DT.coverIsDoor({ attributes: { device_class: "garage" } }), { a, b, c, d, e });
});

await tryCase("types: the flat Atlas swings a map door the way Live Aboard does", () => {
  const model = { floors: [{ id: "main", name: "Main" }],
    room_geometry_m: { Hall: rect("main", 0, 0, 4, 4), Den: rect("main", 4.1, 0, 8, 4),
                       Back: { type: "poly", floor_id: "main", points_m: [[8, 4.1], [0, 4.1], [0, 6], [8, 6]] } },
    rf_barriers_m: [{ id: "b1", name: "Den door", material: "wood", floor_id: "main", points_m: [[4.05, 1], [4.05, 1.9]], linked_entity_id: "binary_sensor.x" },
                    { id: "b2", name: "Back door", material: "wood", floor_id: "main", points_m: [[2, 4.05], [1.1, 4.05]], linked_entity_id: "binary_sensor.y" },
                    { id: "b3", name: "Front door", material: "wood", floor_id: "main", points_m: [[1, 0], [1.9, 0]], linked_entity_id: "binary_sensor.z" },
                    { id: "b4", name: "Den side door", material: "wood", floor_id: "main", points_m: [[8, 2.9], [8, 2]], linked_entity_id: "binary_sensor.w" }] };
  const h = H.readHouse(model, model.floors, {}, new Set(), {});
  const per = h.perFloor.get(h.byId.get("main"));
  const rooms = Object.entries(model.room_geometry_m).map(([name, g]) => ({ name, pts: g.points_m }));
  const bad = [];
  for (const b of model.rf_barriers_m) {
    const pc = per.pieces.find(p => p.barrier && p.barrier.id === b.id);
    if (!pc) { bad.push({ id: b.id, missing: true }); continue; }
    const la = H.openingSwing(pc, per.rooms, null);
    const laDir = [pc.nx * la.side, pc.ny * la.side], laHinge = la.hinge === "a" ? [pc.x0, pc.y0] : [pc.x1, pc.y1];
    const a = b.points_m[0], e = b.points_m[1], n = DT.barrierNormal(a, e, rooms);
    const fl = DT.doorSwing({ x0: a[0], y0: a[1], x1: e[0], y1: e[1], nx: n[0], ny: n[1] }, rooms, null);
    const flDir = [n[0] * fl.side, n[1] * fl.side], flHinge = fl.hinge === "a" ? a : e;
    // (An outside wall stands half its thickness out from the room's edge.)
    if (Math.hypot(laDir[0] - flDir[0], laDir[1] - flDir[1]) > 1e-6 || Math.hypot(laHinge[0] - flHinge[0], laHinge[1] - flHinge[1]) > 0.1) {
      bad.push({ id: b.id, laDir, flDir, laHinge, flHinge });
    }
  }
  check("types: the flat Atlas swings a map door the way Live Aboard does", !bad.length, bad);
});

// ── the view ────────────────────────────────────────────────────────────────
shim.install();
const lists = { window: {}, document: {} };
const listen = (key) => ({ add: (t, fn) => { (lists[key][t] ||= []).push(fn); }, remove: (t, fn) => { lists[key][t] = (lists[key][t] || []).filter(f => f !== fn); } });
const W = listen("window"), Dc = listen("document");
globalThis.addEventListener = W.add; globalThis.removeEventListener = W.remove;
document.addEventListener = Dc.add; document.removeEventListener = Dc.remove;
installStubGL();
const LA = await import(pathToFileURL(join(WWW, "views", "live_aboard.js")).href);
const settle = async (rounds = 12) => { await shim.flush(rounds); await new Promise(r => globalThis._realSetTimeout(r, 0)); };
let clockOff = 0;
const realNow = performance.now.bind(performance);
performance.now = () => realNow() + clockOff;
const shimRaf = globalThis.requestAnimationFrame;
globalThis.requestAnimationFrame = (fn) => shimRaf(() => fn(performance.now()));
const pendingFrames = () => shim.rafQueue.filter(Boolean).length;
async function later(ms, rounds = 6){ clockOff += ms; await settle(rounds); }
/** Long enough for the roof's fade, on frames the clock moves between. */
async function fade(){ for (let i = 0; i < 12; i++) await later(50, 3); }

// Main: Living and Den with a hall between them never drawn as a room, the
// Back across them; Upper: the Loft over Living. Stairs in Living up to the
// Loft; a doorway from Living to the Back; a door from the Den into the Back
// (inside: ajar), one on the Den's outside wall (shut), and one set open.
const MODEL = {
  floors: [{ id: "main", name: "Main" }, { id: "upper", name: "Upper" }], floor_elevations: { main: 0, upper: 2.8 },
  room_geometry_m: { Living: rect("main", 0, 0, 5, 4), Den: rect("main", 6.2, 0, 10, 4), Back: rect("main", 0, 4.1, 10, 8),
                     Loft: rect("upper", 0, 0, 5, 4) },
};
const STAIRS = { id: "fur_5a1e0001", recipe: { kind: "stairs", params: { shape: "straight", turn: "left", to_floor: "upper" },
  colors: ["#8b6a4f", "#e8e2d6", "#3d3a36"], width_m: 1, depth_m: 3, height_m: 2.8 }, origin: "build", label: "",
  library_id: null, submission_id: null, floor_id: "main", x_m: 2.5, y_m: 2, z_m: 0, rotation: 0, entity_id: null, entity_reg_id: null };
const FILE = { schema: 1, pieces: { [STAIRS.id]: STAIRS }, lights: {}, devices: {}, figures: {}, openings: {
  doorway_5a1e0001: { kind: "doorway", floor_id: "main", a_m: [1, 4.05], b_m: [2.4, 4.05], head_m: 2.1 },
  door_5a1e0002: { kind: "door", floor_id: "main", a_m: [7, 4.05], b_m: [7.9, 4.05], head_m: 2.03, hinge: "left", swing: "in" },
  door_5a1e0003: { kind: "door", floor_id: "main", a_m: [10, 1], b_m: [10, 1.9], head_m: 2.03, hinge: "left", swing: "in" },
  door_5a1e0004: { kind: "door", floor_id: "main", a_m: [8.5, 4.05], b_m: [9.4, 4.05], head_m: 2.03, hinge: "left", swing: "in", shown: "open" },
} };
const clone = (x) => JSON.parse(JSON.stringify(x));
const server = { file: clone(FILE) };
const api = { toast(){}, toggle(){}, openRoom(){}, openFloor(){}, openControls(){}, openActivity(){}, controlsFor: () => null, lightsByEid: {}, hass: null };
let topIds = null;
const prefStore = new Map();
const P = () => ({ model: MODEL, floors: MODEL.floors, lightsByEid: {}, hidden: new Set(), topFloorIds: topIds, quality: "low",
  telemetry: () => {}, onTouch: () => {}, states: {}, config: {}, bearing: 0, saveNorth: async () => true, useApi: () => api, haStartedMs: 0,
  prefs: { get: (k) => (prefStore.has(k) ? prefStore.get(k) : null), set: (k, v) => prefStore.set(k, v) },
  load: async () => ({ data: clone(server.file) }),
  edit: async (ch) => { for (const [s, e] of Object.entries(ch)) for (const [k, v] of Object.entries(e)) { if (v === null) delete server.file[s][k]; else server.file[s][k] = clone(v); } return { data: clone(server.file) }; } });
const slot = LA.liveAboardSlot("house-model");
let stage = null;
function poll(){ const c = document.createElement("div"); stage = document.createElement("div"); c.appendChild(stage); document.body.replaceChildren(c); return slot.attach(stage, P()); }
const st = () => slot._state();
const root = () => slot.element;
const button = (label, cls) => { const box = cls ? root().querySelectorAll("." + cls)[0] : root(); return box ? box.querySelectorAll("button").find(b => b.textContent === label) || null : null; };
poll();
await later(10000, 60);                                    // the file read, the quality check, then rest

await tryCase("view: stairs reach the floor above, as high as the gap, and cut their opening", async () => {
  const s = st(), piece = (s.pieces || []).find(p => p.id === STAIRS.id);
  const inHole = slot._floorAt("upper", 2.5, 2), beside = slot._floorAt("upper", 4.2, 2), below = slot._floorAt("main", 2.5, 2);
  const slab = s.house && s.house.slabs.find(q => near(q.elev, 2.8));
  check("view: stairs reach the floor above, as high as the gap, and cut their opening",
    !s.failed && piece && near(piece.h, 2.8, 1e-6) && inHole && !inHole.tile && !inHole.slab && beside.tile && beside.slab && below.tile
    && slab && slab.holes === 1, { piece, inHole, beside, below, slab });
});
await tryCase("view: the storey's own floor under a hall never drawn as a room", async () => {
  const hall = slot._floorAt("main", 5.6, 2), room = slot._floorAt("main", 2, 6), out = slot._floorAt("main", 14, 2);
  check("view: the storey's own floor under a hall never drawn as a room", hall && !hall.tile && hall.slab && room.tile && room.slab && !out.slab,
    { hall, room, out });
});
await tryCase("view: a doorway is drawn as a gap with no door in it", async () => {
  const d = slot._piece("doorway_5a1e0001");
  check("view: a doorway is drawn as a gap with no door in it", d && d.kind === "doorway" && d.els.length === 2 && !d.els.some(e => e[2])
    && near(d.els[1][0], 2.1), d);
});
await tryCase("view: a door with no sensor stands ajar inside, shut outside, open when set", async () => {
  const doors = Object.fromEntries((st().doors || []).map(d => [d.id, d]));
  const a = doors.door_5a1e0002, b = doors.door_5a1e0003, c = doors.door_5a1e0004;
  check("view: a door with no sensor stands ajar inside, shut outside, open when set",
    a && a.shown === "ajar" && a.deg === 70 && a.at === 1 && b && b.shown === "shut" && b.at === 0 && c && c.shown === "open" && c.deg === 85
    && st().openings.length === 0, { doors });
});
// The roof: the whole house, then a step out.
const R = () => st().house;
await tryCase("view: the roof shows a step out past the whole house, fading, then still: 0 frames at rest", async () => {
  slot.wholeHouse();
  await later(2000, 30);
  const atFit = { k: R().k, walls: st().wallMode };
  const f0 = st().frames;
  slot.zoom("out");
  await settle(3);
  const fading = { liveMs: st().liveMs, moving: R().moving, frames: pendingFrames() };
  for (let i = 0; i < 12; i++) await later(50, 3);
  const shown = { k: R().k, moving: R().moving, roofs: R().roofs, liveMs: st().liveMs, frames: st().frames - f0 };
  const f1 = st().frames;
  await later(30000);
  check("view: the roof shows a step out past the whole house, fading, then still: 0 frames at rest",
    atFit.k === 0 && fading.moving && fading.liveMs > 0 && shown.k === 1 && !shown.moving && shown.liveMs === 0
    && shown.roofs.length >= 2 && shown.roofs.every(r => r.visible && r.opacity === 1 && r.tris > 0) && shown.frames >= 3
    && st().frames === f1 && pendingFrames() === 0, { atFit, fading, shown, after: st().frames - f1 });
});
await tryCase("view: zoomed in, a floor below the top, Top, walls Down, Edit or Roof Off: the roof lifts away", async () => {
  const out = async () => { slot.wholeHouse(); await later(1500, 20); slot.zoom("out"); await fade(); return R().k; };
  const res = {};
  res.base = await out();
  slot.zoom("in"); slot.zoom("in"); await fade(); res.zoomIn = R().k;
  res.again = await out();
  topIds = ["main"]; poll(); await fade(); res.floor = R().k; topIds = null; poll(); await later(300, 10);
  res.again2 = await out();
  button("Top", null).click(); await fade(); res.top = R().k;
  res.again3 = await out();
  button("Down", null).click(); await fade(); res.down = R().k; button("Cut", null).click();
  res.again4 = await out();
  button("Edit", null).click(); await fade(); res.edit = R().k;
  if (button("Done", null)) button("Done", null).click();
  res.again5 = await out();
  button("Roof", null).click(); await fade(); res.off = R().k; res.pick = R().roofPick;
  button("Roof", null).click(); await fade(); res.on = R().k;
  check("view: zoomed in, a floor below the top, Top, walls Down, Edit or Roof Off: the roof lifts away",
    res.base === 1 && res.zoomIn === 0 && res.again === 1 && res.floor === 0 && res.again2 === 1 && res.top === 0 && res.again3 === 1
    && res.down === 0 && res.again4 === 1 && res.edit === 0 && res.again5 === 1 && res.off === 0 && res.pick === "off" && res.on === 1, res);
});
await tryCase("view: a door's sheet sets Shown: open, ajar or shut", async () => {
  slot.zoom("fit"); await later(500, 10);
  if (!st().edit.editing) button("Edit", null).click();
  await later(300, 10);
  slot._look(0, 0.0015, [7.45, 0, 4.05], 8);
  await later(300, 10);
  const at = slot._whereOf("main", 7.45, 4.05, 1);
  const c = st().canvas;
  const ev = (type) => ({ type, pointerId: 1, pointerType: "mouse", clientX: at[0], clientY: at[1], button: 0, buttons: type === "pointerup" ? 0 : 1,
                          isPrimary: true, timeStamp: performance.now(), target: c, preventDefault(){}, stopPropagation(){} });
  for (const t of ["pointerdown", "pointerup"]) { for (const fn of [...(lists.window[t] || [])]) fn(ev(t)); c.dispatchEvent(ev(t)); }
  await later(100, 6);
  const sheet = root().querySelectorAll(".la3d-sheet")[0];
  const shownBtns = sheet ? sheet.querySelectorAll("button").filter(b => /^Shown: /.test(b.title || "")) : [];
  const was = shownBtns.filter(b => b.getAttribute("aria-pressed") === "true").map(b => b.textContent);
  const open = shownBtns.find(b => b.textContent === "Open");
  if (open) open.click();
  await later(100, 6);
  const draft = st().edit.draft, sel = st().edit.sel;
  check("view: a door's sheet sets Shown: open, ajar or shut",
    sel && sel.opening && sel.opening.id === "door_5a1e0002" && shownBtns.map(b => b.textContent).join() === "Open,Ajar,Shut"
    && was.join() === "Ajar" && draft && draft.openings.door_5a1e0002.shown === "open", { sel, was, btns: shownBtns.map(b => b.textContent), d: draft && draft.openings.door_5a1e0002 });
  if (button("Discard", "la3d-tools")) button("Discard", "la3d-tools").click();
  if (button("Done", null)) button("Done", null).click();
  await later(100, 6);
});
await tryCase("view: a door's sheet: Type, PadSpan's guess, only that type's options, and what it follows", async () => {
  if (!st().edit.editing) button("Edit", null).click();
  await later(300, 10);
  slot._look(0, 0.0015, [7.45, 0, 4.05], 8);
  await later(300, 10);
  const at = slot._whereOf("main", 7.45, 4.05, 1), c = st().canvas;
  const ev = (type) => ({ type, pointerId: 1, pointerType: "mouse", clientX: at[0], clientY: at[1], button: 0, buttons: type === "pointerup" ? 0 : 1,
                          isPrimary: true, timeStamp: performance.now(), target: c, preventDefault(){}, stopPropagation(){} });
  for (const t of ["pointerdown", "pointerup"]) { for (const fn of [...(lists.window[t] || [])]) fn(ev(t)); c.dispatchEvent(ev(t)); }
  await later(100, 6);
  const sheet = () => root().querySelectorAll(".la3d-sheet")[0];
  const typeSel = () => sheet().querySelectorAll("select").find(s => s.getAttribute("aria-label") === "Type");
  const labels = () => sheet().querySelectorAll("span").map(s => s.textContent);
  const s0 = typeSel(), first = s0 ? s0.querySelectorAll("option").map(o => o.textContent) : [];
  const hinged = labels();
  s0.value = "sliding";
  s0.dispatchEvent({ type: "change" });
  await later(100, 6);
  const slid = labels(), d1 = st().edit.draft.openings.door_5a1e0002;
  check("view: a door's sheet: Type, PadSpan's guess, only that type's options, and what it follows",
    first[0] === "PadSpan's guess: Hinged" && first.length === 11 && hinged.includes("Hinge") && hinged.includes("Swing") && hinged.includes("Follows")
    && hinged.includes("Shown") && d1.type === "sliding" && slid.includes("Slides") && slid.includes("Glass") && !slid.includes("Hinge"),
    { first, hinged, slid, d1 });
  if (button("Discard", "la3d-tools")) button("Discard", "la3d-tools").click();
  if (button("Done", null)) button("Done", null).click();
  await later(100, 6);
});
LA.releaseLiveAboardSlot("house-model");

// ── doors of a type, in the view ────────────────────────────────────────────
// A garage with its overhead door on a cover, a hall with a sliding glass
// door on a contact sensor, a closet's bifold, a double door and a roll-up,
// none linked. On the map: a side gate linked straight to a cover, and a
// garage door as Garry's truck door is (a contact sensor that reads
// backwards, and a switch that opens it).
{
  const DMODEL = { floors: [{ id: "main", name: "Main" }],
    room_geometry_m: { Garage: rect("main", 0, 0, 6, 6), Hall: rect("main", 6.1, 0, 9, 6), "Bedroom Closet": rect("main", 0, 6.1, 3, 8) },
    rf_barriers_m: [
      { id: "bar_c0000001", name: "Side gate", material: "wood", floor_id: "main", points_m: [[7, 0], [8.2, 0]], linked_entity_id: "cover.side_gate" },
      { id: "bar_c0000002", name: "Door — Wall (Garage) (2)", material: "metal", floor_id: "main", points_m: [[0, 1.5], [0, 4.13]],
        linked_entity_id: "binary_sensor.truck_contact", invert_state: true, linked_opener_entity_id: "switch.truck_door" },
    ] };
  const door = (a, b, more = {}) => ({ kind: "door", floor_id: "main", a_m: a, b_m: b, head_m: 2.03, hinge: "left", swing: "in", ...more });
  const DFILE = { schema: 1, pieces: {}, lights: {}, devices: {}, figures: {}, openings: {
    door_d0000001: door([1, 0], [3.6, 0], { link: "cover.garage_door" }),
    door_d0000002: door([9, 1], [9, 2.8], { type: "sliding", glass: true, link: "binary_sensor.patio_door" }),
    door_d0000003: door([0.5, 6.05], [1.7, 6.05], { shown: "ajar" }),
    door_d0000004: door([6.05, 2], [6.05, 3.6], { shown: "ajar" }),
    door_d0000005: door([6.5, 6], [8.5, 6], { type: "rollup", shown: "ajar" }),
  } };
  const ago = (ms) => new Date(Date.now() - ms).toISOString();
  const states = {
    "cover.garage_door": { entity_id: "cover.garage_door", state: "open", attributes: { current_position: 40, device_class: "garage", friendly_name: "Garage door" }, last_changed: ago(60e3) },
    "binary_sensor.patio_door": { entity_id: "binary_sensor.patio_door", state: "off", attributes: { device_class: "door", friendly_name: "Patio door" }, last_changed: ago(60e3) },
    "cover.side_gate": { entity_id: "cover.side_gate", state: "closed", attributes: { current_position: 0, device_class: "gate", friendly_name: "Side gate" }, last_changed: ago(3 * 3600e3) },
    "binary_sensor.truck_contact": { entity_id: "binary_sensor.truck_contact", state: "on", attributes: { device_class: "garage_door", friendly_name: "Truck door contact" }, last_changed: ago(20 * 60e3) },
    "switch.truck_door": { entity_id: "switch.truck_door", state: "off", attributes: { friendly_name: "Upper garage truck door" }, last_changed: ago(20 * 60e3) },
  };
  const DLBE = { "binary_sensor.patio_door": { entity_id: "binary_sensor.patio_door", friendly_name: "Patio door", state: "off", device_class: "door" },
                 "binary_sensor.truck_contact": { entity_id: "binary_sensor.truck_contact", friendly_name: "Truck door contact", state: "on", device_class: "garage_door" } };
  const service = [], toggles = [];
  const dapi = { toast(){}, toggle: (...a) => toggles.push(a), openRoom(){}, openFloor(){}, openControls: (...a) => toggles.push(["controls", ...a]), openActivity(){},
                 controlsFor: () => null, lightsByEid: DLBE, hass: { states, callService: (...a) => { service.push(a); return Promise.resolve(); } } };
  const DP = (over = {}) => ({ model: DMODEL, floors: DMODEL.floors, lightsByEid: DLBE, hidden: new Set(), topFloorIds: null, quality: "low",
    telemetry: () => {}, onTouch: () => {}, states, config: {}, bearing: 0, saveNorth: async () => true, useApi: () => dapi, haStartedMs: 0,
    load: async () => ({ data: clone(DFILE) }), edit: null, ...over });
  const dslot = LA.liveAboardSlot("house-doors");
  let dstage = null;
  const dpoll = (over) => { const c = document.createElement("div"); dstage = document.createElement("div"); c.appendChild(dstage); document.body.replaceChildren(c); return dslot.attach(dstage, DP(over)); };
  dpoll();
  await later(10000, 60);
  const ds = () => dslot._state();
  const op = (eid) => ds().openings.find(o => o.eid === eid) || null;
  const still = (id) => (ds().doors || []).find(d => d.id === id) || null;

  await tryCase("view: each door drawn as its type, linked or as shown", async () => {
    const g = op("cover.garage_door"), p = op("binary_sensor.patio_door");
    const bf = still("door_d0000003"), db = still("door_d0000004"), ru = still("door_d0000005");
    check("view: each door drawn as its type, linked or as shown",
      !ds().failed && g && g.type === "overhead" && g.cover && g.panels === 4 && near(g.at, 0.4) && g.state === "open"
      && p && p.type === "sliding" && !p.cover && p.panels === 2 && p.at === 0 && p.state === "closed"
      && bf && bf.type === "bifold" && bf.guessed && bf.panels === 2 && bf.at === 0.5
      && db && db.type === "double" && db.panels === 2 && db.at === 1 && db.deg === 70
      && ru && ru.type === "rollup" && !ru.guessed && ru.at === 0.25 && ds().liveMs === 0, { g, p, bf, db, ru, failed: ds().failed });
  });
  await tryCase("view: a door on a cover follows its position, moves while it opens, then is still: 0 frames at rest", async () => {
    states["cover.garage_door"] = { ...states["cover.garage_door"], state: "opening", attributes: { ...states["cover.garage_door"].attributes, current_position: 40 } };
    dpoll();
    await settle(3);
    const going = { ...op("cover.garage_door"), liveMs: ds().liveMs };
    for (let i = 0; i < 40; i++) await later(200, 3);           // 8 s on the clock
    states["cover.garage_door"] = { ...states["cover.garage_door"], state: "open", attributes: { ...states["cover.garage_door"].attributes, current_position: 100 } };
    dpoll();
    await later(2000, 10);
    const up = { ...op("cover.garage_door"), liveMs: ds().liveMs }, f1 = ds().frames;
    await later(30000);
    const rest = ds().frames - f1;
    states["cover.garage_door"] = { ...states["cover.garage_door"], state: "closed", attributes: { ...states["cover.garage_door"].attributes, current_position: 0 } };
    dpoll();
    await settle(3);
    const shutting = op("cover.garage_door");
    check("view: a door on a cover follows its position, moves while it opens, then is still: 0 frames at rest",
      going.to === 1 && going.at < 0.5 && going.liveMs > 0 && near(going.ms, 0.6 * 12000, 1) && up.at === 1 && up.liveMs === 0
      && rest === 0 && shutting.to === 0 && shutting.ms >= 300, { going, up, shutting, rest });
    for (let i = 0; i < 20; i++) await later(200, 3);
  });
  await tryCase("view: a door on a contact sensor slides open with it", async () => {
    DLBE["binary_sensor.patio_door"] = { ...DLBE["binary_sensor.patio_door"], state: "on" };
    dpoll();
    await settle(3);
    const t0 = { ...op("binary_sensor.patio_door"), liveMs: ds().liveMs };
    for (let i = 0; i < 12; i++) await later(100, 3);
    const t1 = op("binary_sensor.patio_door");
    check("view: a door on a contact sensor slides open with it", t0.to === 1 && t0.ms === 1000 && t0.liveMs > 0 && t1.at === 1 && ds().liveMs === 0, { t0, t1 });
  });
  // A door something moves — on a cover by the 3D file's link, on the map
  // linked straight to a cover, or with an opener as Garry's truck door has
  // — never moves from a tap, nor from anything the tap shows: every button
  // the tap leaves in the page is pressed, and nothing is sent. Its card
  // says what it reads; a hold opens Home Assistant's own controls for what
  // moves it.
  await tryCase("view: a tap on a door on a cover sends nothing; a hold opens Home Assistant's own controls", async () => {
    states["cover.garage_door"] = { ...states["cover.garage_door"], state: "open", attributes: { ...states["cover.garage_door"].attributes, current_position: 40 }, last_changed: ago(60e3) };
    dpoll();
    await later(4000, 10);
    const cv = dslot.element.querySelector("canvas"), more = [];
    dslot.element.addEventListener("hass-more-info", (e) => more.push(e.detail && e.detail.entityId));
    const evp = (type, x, y) => ({ type, button: 0, pointerType: "mouse", pointerId: 1, clientX: x, clientY: y, deltaMode: 0, timeStamp: performance.now(),
                                   stopPropagation(){}, preventDefault(){}, composedPath: () => [] });
    const doors = [["cover.garage_door", [2.3, 1, 0], "cover.garage_door", ["Garage door", "Open 40%", "Last moved 1 min ago"]],
                   ["cover.side_gate", [7.6, 1, 0], "cover.side_gate", ["Side gate", "Closed", "Last moved 3 h ago"]],
                   ["binary_sensor.truck_contact", [0, 1, 2.8], "switch.truck_door", ["Door — Wall (Garage) (2)", "Closed", "Last moved 20 min ago"]]];
    const got = [];
    for (const [eid, target, mover, words] of doors) {
      let at = null, hit = null;
      for (const th of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
        dslot._look(th, 0.9, target, 7);
        await later(300, 10);
        at = dslot._where({ door: eid });
        hit = at ? dslot._pick(at[0], at[1]) : null;
        if (hit && hit.hit.startsWith(`door:${eid}@`)) break;
      }
      const before = new Set(document.body.querySelectorAll("button"));
      service.length = 0; toggles.length = 0; more.length = 0;
      cv.dispatchEvent(evp("pointerdown", at[0], at[1]));
      cv.dispatchEvent(evp("pointerup", at[0], at[1]));
      await later(100, 6);
      const card = ds().use && ds().use.card ? ds().use.card.text : "";
      const left = document.body.querySelectorAll("button").filter(b => !before.has(b));
      for (const b of left) b.click();
      await later(100, 6);
      const tap = { service: service.slice(), toggles: toggles.length, more: more.length, buttons: left.map(b => b.textContent) };
      cv.dispatchEvent(evp("pointerdown", at[0], at[1]));
      clockOff += 800;
      await settle(6);
      cv.dispatchEvent(evp("pointerup", at[0], at[1]));
      await later(100, 6);
      got.push({ eid, hit: hit && hit.hit, card, tap, held: more.slice(), service: service.slice(), ok:
        !!hit && hit.hit.startsWith(`door:${eid}@`) && words.every(w => card.includes(w)) && !tap.service.length && !tap.toggles && !tap.more
        && !service.length && !toggles.length && more.join() === mover });
    }
    check("view: a tap on a door on a cover sends nothing; a hold opens Home Assistant's own controls",
      got.every(g => g.ok) && !ds().failed, got);
  });
  // Which doors are "something moves it" is the barrier card's own opener
  // rule: a barrier whose card has an Open, Close or Trigger, and no other.
  await tryCase("view: a door something moves is one whose barrier card could move it", async () => {
    const LM = await import(pathToFileURL(join(WWW, "views", "lights_map.js")).href);
    const USE = await import(pathToFileURL(join(WWW, "views", "live_aboard_use.js")).href);
    const hs = { states: {
      "binary_sensor.c": { state: "off", attributes: {} }, "lock.f": { state: "locked", attributes: {} },
      "cover.g": { state: "closed", attributes: { current_position: 0 } }, "switch.s": { state: "off", attributes: {} },
      "script.r": { state: "off", attributes: {} }, "button.b": { state: "unknown", attributes: {} } }, callService: () => Promise.resolve() };
    const bars = [{ linked_entity_id: "binary_sensor.c" }, { linked_entity_id: "cover.g" }, { linked_entity_id: "lock.f" },
                  { linked_entity_id: "binary_sensor.c", linked_lock_entity_id: "lock.f" },
                  ...["cover.g", "switch.s", "script.r", "button.b"].map(op => ({ linked_entity_id: "binary_sensor.c", linked_opener_entity_id: op }))];
    const MOVES = ["Open", "Close", "Trigger", "Opening…", "Closing…", "Running…"];
    const bad = [];
    for (const bar of bars) {
      document.body.replaceChildren();
      LM.openBarrierCard(hs, { name: "D", invert_state: false, ...bar }, { toast(){}, rerender(){} });
      const moves = document.body.querySelectorAll("button").some(b => MOVES.includes(b.textContent));
      if (moves !== !!USE.doorMover(bar)) bad.push({ bar, moves, mover: USE.doorMover(bar) });
    }
    document.body.replaceChildren();
    check("view: a door something moves is one whose barrier card could move it", !bad.length, bad);
  });
  LA.releaseLiveAboardSlot("house-doors");
}

console.log(JSON.stringify({ cases, failures }));
process.exit(0);
