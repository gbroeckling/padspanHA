// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
//
// Live Aboard's house reading (views/live_aboard_house.js), run for real.
//
//   floors    real heights: floor_elevations, base_elevation_m, the 2.8 m
//             default, stacking, the outdoor floor at the ground
//   walls     shared walls built once between two rooms, outside and inside
//             walls, a hall's inside wall, deck rails, the barriers spliced
//             in (glass a window, open a gap, a door), a free barrier
//   cutaway   Cut / Up / Down, outside walls facing you, inside walls edge-on
//   quality   the Auto / Low / High pick and the frame-time median
//   lights    fixtures by the Atlas shape, mount heights by kind, the live
//             look, which devices are drawn at all
//   floorsTop the floor chips' top floor
//   telemetry closed words, once per page load
//
// usage: live_aboard_house.mjs <www/padspan-ha dir>
// prints one JSON line: { cases: {name: result}, lists: {...}, failures: [...] }

import { pathToFileURL } from "node:url";
import { join } from "node:path";

const WWW = process.argv[2];
if (!WWW) { console.error("usage: live_aboard_house.mjs <www/padspan-ha dir>"); process.exit(2); }
const H = await import(pathToFileURL(join(WWW, "views", "live_aboard_house.js")).href);
const LC = await import(pathToFileURL(join(WWW, "views", "light_codes.js")).href);
const DR = await import(pathToFileURL(join(WWW, "views", "live_aboard_draft.js")).href);
const ST = await import(pathToFileURL(join(WWW, "views", "live_aboard_storey.js")).href);
const RU = await import(pathToFileURL(join(WWW, "views", "live_aboard_runs.js")).href);

const failures = [];
const cases = {};
const check = (name, ok, detail) => { cases[name] = !!ok; if (!ok) failures.push({ name, detail: detail === undefined ? null : detail }); };
const tryCase = (name, fn) => { try { fn(); } catch (e) { failures.push({ name, detail: String(e && e.stack || e).slice(0, 900) }); cases[name] = false; } };
const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;
const rect = (floor_id, x0, y0, x1, y1) => ({ type: "poly", floor_id, points_m: [[x0, y0], [x1, y0], [x1, y1], [x0, y1]] });
const len = (p) => Math.hypot(p.x1 - p.x0, p.y1 - p.y0);

// ── floors ──────────────────────────────────────────────────────────────────
tryCase("floors: floor_elevations are the heights, floor_to_floor_m the storey", () => {
  const model = { floors: [{ id: "basement", name: "Basement", floor_to_floor_m: 3 }, { id: "main", name: "Main", floor_to_floor_m: 2.3 },
                           { id: "outside", name: "Outside" }, { id: "upper", name: "Upper" }],
                  floor_elevations: { basement: 0, main: 3, outside: 3, upper: 5.3 }, room_geometry_m: {} };
  const F = H.readFloors(model, model.floors);
  const got = Object.fromEntries(F.floors.map(f => [f.id, [f.elev, f.h, f.outdoor]]));
  check("floors: floor_elevations are the heights, floor_to_floor_m the storey",
    JSON.stringify(got) === JSON.stringify({ basement: [0, 3, false], main: [3, 2.3, false], outside: [3, 2.8, true], upper: [5.3, 2.8, false] })
    && F.floors.map(f => f.id).join() === "basement,main,outside,upper" && F.ground === 0, got);
});
tryCase("floors: without floor_elevations, base_elevation_m, else stacked at 2.8 m", () => {
  const model = { floors: [{ id: "a" }, { id: "b", base_elevation_m: 10 }, { id: "c" }],
                  room_geometry_m: { Hall: rect("d", 0, 0, 3, 3) } };
  const F = H.readFloors(model, model.floors);
  const got = Object.fromEntries(F.floors.map(f => [f.id, f.elev]));
  check("floors: without floor_elevations, base_elevation_m, else stacked at 2.8 m",
    got.a === 0 && got.b === 10 && near(got.c, 12.8) && near(got.d, 15.6) && F.floors.every(f => f.h === 2.8), got);
});
tryCase("floors: the fabric's __outside__ is the registry's outside, at the ground", () => {
  const withReg = H.readFloors({ floors: [{ id: "main" }, { id: "outside" }], floor_elevations: { main: 0, outside: 0 },
    room_geometry_m: { Yard: rect("__outside__", 0, 0, 5, 5) } }, [{ id: "main" }, { id: "outside" }]);
  const noReg = H.readFloors({ floors: [{ id: "basement" }, { id: "main" }], floor_elevations: { basement: 0, main: 3 },
    room_geometry_m: { Yard: rect("__outside__", 0, 0, 5, 5) } }, [{ id: "basement" }, { id: "main" }]);
  const o = noReg.byId.get("__outside__");
  check("floors: the fabric's __outside__ is the registry's outside, at the ground",
    withReg.floors.map(f => f.id).join() === "main,outside" && !withReg.byId.has("__outside__")
    && o && o.outdoor && o.elev === 0, { a: withReg.floors.map(f => f.id), o });
});
tryCase("explode: each indoor storey lifted one gap more than the one under it; floors sharing a storey stay together; outside stays", () => {
  const model = { floors: [{ id: "b" }, { id: "m" }, { id: "m2" }, { id: "u" }, { id: "outside" }],
                  floor_elevations: { b: -2.7, m: 0, m2: 0, u: 2.8, outside: -2.7 } };
  const at = (F) => Object.fromEntries(F.floors.map(f => [f.id, f.elev]));
  const flat = at(H.readFloors(model, model.floors)), ex = at(H.readFloors(model, model.floors, 4));
  check("explode: each indoor storey lifted one gap more than the one under it; floors sharing a storey stay together; outside stays",
    ex.b === -2.7 && ex.m === 4 && ex.m2 === 4 && ex.u === 10.8 && ex.outside === -2.7 && flat.m === 0 && flat.u === 2.8, { flat, ex });
});
tryCase("heat: blue cool, green at 21, red from 26, graded between; °F converted", () => {
  const c = { cold: H.heatColor(10), cool: H.heatColor(16), mid: H.heatColor(21), half: H.heatColor(18.5), hot: H.heatColor(26), hotter: H.heatColor(35) };
  const f = H.tempC({ temperature: 72, air_unit: "°F" }), cc = H.tempC({ temperature: 22, air_unit: "°C" }), none = H.tempC({ temperature: null });
  check("heat: blue cool, green at 21, red from 26, graded between; °F converted",
    c.cold === "#3b82f6" && c.cool === "#3b82f6" && c.mid === "#22c55e" && c.hot === "#ef4444" && c.hotter === "#ef4444"
    && c.half !== c.cool && c.half !== c.mid && Math.abs(f - 22.22) < 0.01 && cc === 22 && none === null, { c, f, cc, none });
});
tryCase("floorsTop: the chosen floor and below show, the floors above hide", () => {
  const F = H.readFloors({ floors: [{ id: "b" }, { id: "m" }, { id: "u" }], floor_elevations: { b: 0, m: 3, u: 5.8 } }, null);
  const t = H.topFloorElev(F.floors, new Set(["m"]));
  const shown = F.floors.filter(f => H.floorShown(f, t)).map(f => f.id).join();
  const all = F.floors.filter(f => H.floorShown(f, H.topFloorElev(F.floors, null))).map(f => f.id).join();
  check("floorsTop: the chosen floor and below show, the floors above hide", t === 3 && shown === "b,m" && all === "b,m,u", { t, shown, all });
});

// ── walls ───────────────────────────────────────────────────────────────────
// Two rooms side by side, 0.12 m apart: one wall between them, 0.12 thick.
const TWO = { floors: [{ id: "main" }], floor_elevations: { main: 0 },
  room_geometry_m: { Kitchen: rect("main", 0, 0, 4, 3), Lounge: rect("main", 4.12, 0, 9, 3) } };
tryCase("walls: a shared wall is built once, in the gap, as thick as the gap", () => {
  const h = H.readHouse(TWO, TWO.floors, {}, null);
  const pieces = h.perFloor.get(h.byId.get("main")).pieces;
  const shared = pieces.filter(p => p.shared);
  const s = shared[0];
  check("walls: a shared wall is built once, in the gap, as thick as the gap",
    shared.length === 1 && s.cls === "int" && near(s.thick, 0.12, 1e-6) && near(s.x0, 4.06, 1e-6) && near(s.x1, 4.06, 1e-6)
    && near(len(s), 3, 1e-6), shared);
});
tryCase("walls: the rest of each outline is an outside wall, its inner face on the line", () => {
  const h = H.readHouse(TWO, TWO.floors, {}, null);
  const pieces = h.perFloor.get(h.byId.get("main")).pieces;
  const ext = pieces.filter(p => p.cls === "ext");
  const total = ext.reduce((a, p) => a + len(p), 0);
  // 2 rooms x 3 outside sides: 4+3+4 and 4.88+3+4.88; each centred EXT_T/2 outside the room.
  const kitchenBottom = ext.find(p => near(p.y0, -H.EXT_T / 2, 1e-6) && p.x1 <= 4.01 && p.x0 <= 4.01);
  check("walls: the rest of each outline is an outside wall, its inner face on the line",
    ext.length === 6 && near(total, 4 + 3 + 4 + 4.88 + 3 + 4.88, 1e-6) && !!kitchenBottom && ext.every(p => p.kind === "wall"),
    { n: ext.length, total });
});
tryCase("walls: an outline with a room close behind it is an inside wall (an unmapped hall)", () => {
  const m = { floors: [{ id: "main" }], floor_elevations: { main: 0 },
    room_geometry_m: { Bed: rect("main", 0, 0, 4, 3), Bath: rect("main", 0, 4.2, 4, 7) } };   // a 1.2 m hall between, not drawn
  const h = H.readHouse(m, m.floors, {}, null);
  const pieces = h.perFloor.get(h.byId.get("main")).pieces;
  const facing = pieces.filter(p => (near(p.y0, 3 + H.EXT_T / 2, 1e-6) || near(p.y0, 4.2 - H.EXT_T / 2, 1e-6)) && near(p.y0, p.y1, 1e-6));
  check("walls: an outline with a room close behind it is an inside wall (an unmapped hall)",
    facing.length === 2 && facing.every(p => p.cls === "int" && !p.shared), facing.map(p => [p.y0, p.cls]));
});
tryCase("walls: an outdoor room has no walls; a raised deck gets a rail", () => {
  const ground = { floors: [{ id: "main" }], floor_elevations: { main: 0 },
    room_geometry_m: { House: rect("main", 0, 0, 5, 5), "Back Deck": rect("main", 5.1, 0, 8, 5) } };
  const raised = { floors: [{ id: "base" }, { id: "main" }], floor_elevations: { base: 0, main: 3 },
    room_geometry_m: { Down: rect("base", 0, 0, 5, 5), House: rect("main", 0, 0, 5, 5), "Back Deck": rect("main", 5.1, 0, 8, 5) } };
  const g = H.readHouse(ground, ground.floors, {}, null), r = H.readHouse(raised, raised.floors, {}, null);
  const gp = g.perFloor.get(g.byId.get("main")).pieces, rp = r.perFloor.get(r.byId.get("main")).pieces;
  const between = gp.find(p => p.shared);
  check("walls: an outdoor room has no walls; a raised deck gets a rail",
    !gp.some(p => p.kind === "rail") && rp.filter(p => p.kind === "rail").length === 3
    && between && between.cls === "ext" && gp.filter(p => p.x0 > 5.2 && p.x1 > 5.2).length === 0,
    { rails: rp.filter(p => p.kind === "rail").length, between });
});
tryCase("walls: barriers splice in — glass a window, open a gap, a door, a tint", () => {
  const m = { ...TWO, rf_barriers_m: [
    { name: "Front window", material: "glass", floor_id: "main", points_m: [[1, 0], [3, 0]] },
    { name: "Arch", material: "open", floor_id: "main", points_m: [[4.06, 0.5], [4.06, 1.5]] },
    { name: "Back door", material: "wood", floor_id: "main", points_m: [[6, 3], [7, 3]] },
    { name: "Barrier 1", material: "metal", floor_id: "main", points_m: [[0, 1], [0, 2]] },
    { name: "Fence", material: "wood", floor_id: "main", points_m: [[20, 20], [24, 20]] },
    { name: "Upstairs", material: "glass", floor_id: "upper", points_m: [[1, 0], [3, 0]] },
  ] };
  const h = H.readHouse(m, m.floors, {}, null);
  const pieces = h.perFloor.get(h.byId.get("main")).pieces;
  const by = (n) => pieces.filter(p => p.barrier && p.barrier.name === n);
  const win = by("Front window"), arch = by("Arch"), door = by("Back door"), metal = by("Barrier 1"), fence = by("Fence");
  const winEl = H.wallElements(win[0], 2.8), archEl = H.wallElements(arch[0], 2.8), doorEl = H.wallElements(door[0], 2.8);
  const metalEl = H.wallElements(metal[0], 2.8);
  const glass = winEl.find(e => e.glass);
  // The window's wall keeps the rest of its length on either side.
  const bottom = pieces.filter(p => !p.shared && near(p.y0, -H.EXT_T / 2, 1e-6) && p.x1 <= 4.01 && p.x0 <= 4.01);
  check("walls: barriers splice in — glass a window, open a gap, a door, a tint",
    win.length === 1 && win[0].kind === "window" && near(len(win[0]), 2, 1e-6) && glass && glass.z0 === H.SILL_H && glass.z1 === H.HEAD_H
    && arch.length === 1 && arch[0].kind === "open" && archEl.length === 1 && archEl[0].z1 === 0
    && door.length === 1 && door[0].kind === "door" && doorEl.some(e => e.z0 === 0 && near(e.z1, H.DOOR_H))
    && metal.length === 1 && metalEl[0].col === "#9eabb6"
    && fence.length === 1 && fence[0].free && bottom.length === 3 && !pieces.some(p => p.barrier && p.barrier.name === "Upstairs"),
    { win: win.length, arch: arch.map(p => p.kind), archEl, door: door.map(p => p.kind), metalEl, fence: fence.length, bottom: bottom.length });
});
tryCase("walls: a plain wall runs from under the slab to under the floor above", () => {
  const h = H.readHouse(TWO, TWO.floors, {}, null);
  const pc = h.perFloor.get(h.byId.get("main")).pieces[0];
  const el = H.wallElements(pc, 2.8);
  check("walls: a plain wall runs from under the slab to under the floor above",
    el.length === 1 && el[0].z0 === -H.SLAB_T && near(el[0].z1, 2.8 - H.SLAB_T) && el[0].cuttable, el);
});

// ── the cut-away ────────────────────────────────────────────────────────────
// The clear width of an opening piece O as drawn: its length less whatever
// of the wall pieces in line with it, as drawn (drawnSpan), reaches into it.
const clearOf = (O, pieces) => {
  const L = len(O), ux = (O.x1 - O.x0) / L, uy = (O.y1 - O.y0) / L;
  let lost = 0;
  for (const W of pieces) {
    if (W === O || W.kind !== "wall" || Math.abs((W.x1 - W.x0) * ux + (W.y1 - W.y0) * uy) < 0.99 * len(W)) continue;
    const s = H.drawnSpan(W), c = (s.mx - O.x0) * ux + (s.my - O.y0) * uy;
    if (Math.abs((s.mx - O.x0) * -uy + (s.my - O.y0) * ux) > 0.3) continue;      // another wall, not this one
    lost += Math.max(0, Math.min(L, c + s.len / 2) - Math.max(0, c - s.len / 2));
  }
  return L - lost;
};
tryCase("walls: a door, window or gap keeps its drawn width; only a wall's own corners are lengthened", () => {
  // An outside wall (0.14 m) with a 0.9 m door and a 1 m gap; a 0.5 m
  // shared wall with a 0.3 m window (thinner than the wall is thick); and a
  // 0.9 m door drawn in 3D into that thick wall.
  const model = { floors: [{ id: "main" }], room_geometry_m: { Kitchen: rect("main", 0, 0, 6, 4), Hall: rect("main", 6.5, 0, 10, 4) },
    rf_barriers_m: [{ id: "bar_door", name: "Front door", material: "wood", floor_id: "main", points_m: [[2, 0], [2.9, 0]] },
                    { id: "bar_gap", name: "Arch", material: "open", floor_id: "main", points_m: [[1, 4], [2, 4]] },
                    { id: "bar_win", name: "Pass", material: "glass", floor_id: "main", points_m: [[6.25, 1], [6.25, 1.3]] }] };
  const h = H.readHouse(model, model.floors, {}, null), pcs = h.perFloor.get(h.byId.get("main")).pieces;
  DR.spliceOpening(pcs, "door_00000001", { kind: "door", a_m: [6.25, 2.2], b_m: [6.25, 3.1], head_m: 2.03, hinge: "left", swing: "in" });
  const ops = pcs.filter(p => p.kind === "door" || p.kind === "window" || p.kind === "open");
  const got = ops.map(O => ({ id: O.added || O.barrier.id, drawn: +len(O).toFixed(3), clear: +clearOf(O, pcs).toFixed(3) }));
  // The Kitchen's corner at (0, 0): both walls still reach past it by half
  // their thickness, so the corner closes.
  const corner = pcs.filter(p => p.kind === "wall" && p.cls === "ext" && (near(p.x0, 0, 0.08) && near(p.y0, -0.07, 0.08) || near(p.x1, 0, 0.08) && near(p.y1, -0.07, 0.08)
    || near(p.x0, -0.07, 0.08) && near(p.y0, 0, 0.08) || near(p.x1, -0.07, 0.08) && near(p.y1, 0, 0.08)));
  const closes = corner.length === 2 && corner.every(p => near(H.drawnSpan(p).len, len(p) + (p.corner0 === false || p.corner1 === false ? 0.07 : 0.14), 1e-9));
  check("walls: a door, window or gap keeps its drawn width; only a wall's own corners are lengthened",
    ops.length === 4 && got.every(o => near(o.clear, o.drawn, 1e-6)) && closes, { got, corner: corner.map(p => [p.corner0, p.corner1, len(p)]) });
});
tryCase("cutaway: Cut drops what is between you and the rooms; Up none; Down all", () => {
  // A room 0..4 x 0..3. Its bottom wall's outward normal is (0, -1).
  const ext = { kind: "wall", cls: "ext", x0: 0, y0: 0, x1: 4, y1: 0, nx: 0, ny: -1 };
  const intW = { kind: "wall", cls: "int", x0: 2, y0: 0, x1: 2, y1: 3, nx: 1, ny: 0 };
  const rail = { kind: "rail", cls: "rail", x0: 0, y0: 0, x1: 4, y1: 0, nx: 0, ny: -1 };
  const c = (pc, x, y, mode = "cut", top = false) => H.wallCut(pc, x, y, mode, top);
  const got = {
    extFacing: c(ext, 2, -10), extAway: c(ext, 2, 10), extEdge: c(ext, 40, 0.5),
    intFacing: c(intW, 12, 1.5), intEdgeOn: c(intW, 2.3, 40), topDown: c(ext, 2, -10, "cut", true),
    up: c(ext, 2, -10, "up"), down: c(ext, 2, 10, "down"), downInt: c(intW, 2.3, 40, "down"),
    railCut: c(rail, 2, -10), railDown: c(rail, 2, -10, "down"), above: c(ext, 2, 0.1),
  };
  const want = { extFacing: true, extAway: false, extEdge: false, intFacing: true, intEdgeOn: false, topDown: false,
    up: false, down: true, downInt: true, railCut: false, railDown: false, above: false };
  check("cutaway: Cut drops what is between you and the rooms; Up none; Down all",
    JSON.stringify(got) === JSON.stringify(want) && H.WALL_MODES.join() === "cut,up,down", got);
});

// ── quality ─────────────────────────────────────────────────────────────────
tryCase("quality: Auto measures High, steps to Low, then gives up to the flat Atlas", () => {
  const s = (setting, webgl, ms) => JSON.stringify(H.qualityStep(setting, webgl, ms));
  const rows = [
    [s("auto", false, {}), { fallback: "no_webgl" }],
    [s("high", false, {}), { fallback: "no_webgl" }],
    [s("auto", true, {}), { measure: "high" }],
    [s("auto", true, { high: 16.7 }), { use: "high" }],
    [s("auto", true, { high: 34 }), { use: "high" }],
    [s("auto", true, { high: 40 }), { measure: "low" }],
    [s("auto", true, { high: 40, low: 33 }), { use: "low" }],
    [s("auto", true, { high: 90, low: 70 }), { fallback: "slow_gpu" }],
    [s("auto", true, { high: Infinity, low: Infinity }), { fallback: "slow_gpu" }],
    [s("low", true, {}), { measure: "low" }],
    [s("low", true, { low: 60 }), { use: "low" }],
    [s("low", true, { low: 80 }), { fallback: "slow_gpu" }],
    [s("high", true, { high: 50 }), { use: "high" }],
    [s("high", true, { high: 68 }), { fallback: "slow_gpu" }],
    [s("ultra", true, {}), { measure: "high" }],
    [s(undefined, true, { high: 20 }), { use: "high" }],
  ];
  const bad = rows.filter(([g, w]) => g !== JSON.stringify(w));
  check("quality: Auto measures High, steps to Low, then gives up to the flat Atlas", !bad.length, bad);
});
tryCase("quality: the profiles are the plan's table", () => {
  const { low, high } = H.QUALITY_PROFILES;
  check("quality: the profiles are the plan's table", low.lamps === 4 && high.lamps === 8 && !low.shadows && high.shadows
    && low.dpr === "one" && high.dpr === "device" && !low.pbr && high.pbr && !low.ao && high.ao
    && H.qualitySetting("HIGH") === "high" && H.qualitySetting("") === "auto" && H.qualitySetting(null) === "auto", { low, high });
});
tryCase("quality: the frame time is the median, shader compiles dropped", () => {
  const a = H.frameMs([400, 300, 200, 16, 17, 18, 50]);
  const b = H.frameMs([400, 300, 200, 16, 17, 18, 50, 20]);
  const c = H.frameMs([1, 2]);
  check("quality: the frame time is the median, shader compiles dropped", a === 17.5 && b === 18 && c === Infinity, { a, b, c });
});

// ── lights ──────────────────────────────────────────────────────────────────
const dev = (entity_id, extra = {}) => {
  const l = { entity_id, friendly_name: entity_id, state: "on", rgb: null, bri: 255, ct: null, ...extra };
  LC.assignLightCodes([l]);
  l.shape = extra.shape || LC.resolveLightShape(l, {});
  return l;
};
const LIGHTS_MODEL = {
  floors: [{ id: "main", floor_to_floor_m: 2.8 }], floor_elevations: { main: 0 },
  room_geometry_m: { Kitchen: rect("main", 0, 0, 6, 4) },
  light_positions_m: {
    "light.kitchen_pots": { x_m: 3, y_m: 2, floor_id: "main" },
    "light.island_pendant": { x_m: 2, y_m: 2, floor_id: "main" },
    "light.wall_sconce": { x_m: 0.3, y_m: 2, floor_id: "main" },
    "light.under_cab_strip": { x_m: 5.7, y_m: 2, floor_id: "main", width_cm: 120, height_cm: 1, rotation: 150 },
    "light.cove": { x_m: 3, y_m: 1, floor_id: "main", margin_cm: 20 },
    "fan.ceiling": { x_m: 4, y_m: 2, floor_id: "main" },
    "binary_sensor.kitchen_motion": { x_m: 1, y_m: 1, floor_id: "main" },
    "light.hidden_one": { x_m: 1, y_m: 3, floor_id: "main" },
    "light.not_in_ha": { x_m: 1, y_m: 2, floor_id: "main" },
  },
};
// The Atlas shapes the person set (settings.light_shapes).
const SHAPES = { "light.cove": "perimeter" };
const LBE = {
  "light.kitchen_pots": dev("light.kitchen_pots"), "light.island_pendant": dev("light.island_pendant"),
  "light.wall_sconce": dev("light.wall_sconce"), "light.under_cab_strip": dev("light.under_cab_strip"),
  "light.cove": dev("light.cove", { shape: "perimeter" }), "fan.ceiling": dev("fan.ceiling"),
  "binary_sensor.kitchen_motion": dev("binary_sensor.kitchen_motion", { device_class: "motion" }),
  "light.hidden_one": dev("light.hidden_one"),
};
tryCase("lights: placed fixtures and fans, by the Atlas shape; never sensors, hidden or unknown", () => {
  const h = H.readHouse(LIGHTS_MODEL, LIGHTS_MODEL.floors, LBE, new Set(["light.hidden_one"]), SHAPES);
  const got = Object.fromEntries(h.lights.map(L => [L.eid, L.kind]));
  check("lights: placed fixtures and fans, by the Atlas shape; never sensors, hidden or unknown",
    JSON.stringify(got) === JSON.stringify({ "fan.ceiling": "fan", "light.cove": "perimeter", "light.island_pendant": "pendant",
      "light.kitchen_pots": "pot", "light.under_cab_strip": "undercab", "light.wall_sconce": "sconce" }), got);
});
tryCase("lights: each kind hangs at its own default height", () => {
  const ceil = 2.8 - H.SLAB_T;
  const m = (k) => H.mountHeight(k, ceil);
  const ok = near(m("pot"), ceil - 0.012) && near(m("pendant"), ceil - 0.6) && near(m("strip"), ceil - 0.12) && m("sconce") === 1.7
    && m("led") === 1.35 && near(m("fan"), ceil - 0.36) && near(m("fixture"), ceil) && m("pendant") < m("fan") && m("fan") < m("pot")
    && Object.keys(H.MOUNT).sort().join() === "accent,chandelier,cove,fan,fixture,glow,kick,lamp,led,panel,pendant,perimeter,pot,pot_ring,"
      + "sconce,spot,string,strip,track,tube,tv,undercab,valance,vanity"
    && H.LIGHT_KINDS.every(([k]) => k in H.MOUNT)
    && Object.values(H.KIND_OF_SHAPE).every(k => k in H.MOUNT)
    && LC.LIGHT_SHAPES.filter(([k]) => H.KIND_OF_SHAPE[k]).length === 12;
  check("lights: each kind hangs at its own default height", ok, Object.fromEntries(Object.keys(H.MOUNT).map(k => [k, m(k)])));
});
tryCase("lights: the fixture parts sit where the kind says", () => {
  const h = H.readHouse(LIGHTS_MODEL, LIGHTS_MODEL.floors, LBE, null, SHAPES);
  const fl = h.byId.get("main"), ctx = { ...h.perFloor.get(fl), ground: h.ground };
  const parts = Object.fromEntries(h.lights.map(L => [L.eid, H.fixtureParts(L, ctx)]));
  const ceil = 2.8 - H.SLAB_T;
  const pot = parts["light.kitchen_pots"], pend = parts["light.island_pendant"], sc = parts["light.wall_sconce"];
  const strip = parts["light.under_cab_strip"], cove = parts["light.cove"], fan = parts["fan.ceiling"];
  const inRoom = (b) => b.x > 0 && b.x < 6 && b.y > 0 && b.y < 4;
  const ok = pot.bulbs.length === 1 && pot.bulbs[0].prim === "puck" && near(pot.bulbs[0].h, ceil - 0.012) && pot.where === "in"
    && pend.bulbs[0].prim === "dome" && near(pend.bulbs[0].h, ceil - 0.6) && pend.housings.length === 1
    && sc.wall && sc.bulbs[0].h === 1.7 && near(sc.bulbs[0].x, H.EXT_T / 2 * 0 + 0.012, 0.05)
    && strip.wall && strip.kind === "undercab" && near(strip.bulbs[0].h, 1.4) && near(strip.bulbs[0].x, 6 - 0.012, 0.05)
    && cove.kind === "cove" && cove.bulbs.length === 4 && cove.bulbs.every(b => inRoom(b) && near(b.h, ceil - 0.012) && b.hideOff)
    && fan.housings.length === 6 && fan.bulbs[0].prim === "dome" && fan.kf === 1 && fan.spin.blades.length === 4
    && [pot, pend, sc, fan].every(p => p.halos.length >= 1) && [pot, pend, sc, cove, fan].every(p => p.pools.length >= 1)
    && strip.washes.length >= 1 && cove.washes.length === 4;
  check("lights: the fixture parts sit where the kind says", ok, {
    pot: pot.bulbs, pend: pend.bulbs, sc: sc.bulbs, strip: strip.bulbs, cove: cove.bulbs.map(b => [b.x, b.y]), fan: fan.housings.length });
});
tryCase("lights: the look is the live state — on, colour, brightness; unavailable is off", () => {
  const a = H.lightLook({ state: "on", rgb: [255, 0, 0], bri: 255 });
  const b = H.lightLook({ state: "on", rgb: null, ct: 2700, bri: 0 });
  const c = H.lightLook({ state: "off", rgb: [0, 255, 0], bri: null });
  const d = H.lightLook({ state: "unavailable" });
  const e = H.lightLook(null);
  const warm = b.rgb[0] === 1 && b.rgb[2] < b.rgb[1] && b.rgb[1] < 1;
  check("lights: the look is the live state — on, colour, brightness; unavailable is off",
    a.on && JSON.stringify(a.rgb) === "[1,0,0]" && a.f === 1 && b.on && near(b.f, 0.3) && warm && !c.on && c.f === 1
    && !d.on && d.unavailable && !e.on && e.unavailable && H.lookKey(a) !== H.lookKey(c), { a, b, c, d });
});
tryCase("lights: the drawing is rebuilt for a move, never for a switch", () => {
  const sig = (lbe, hidden, model = LIGHTS_MODEL) => H.lightsSignature(model, lbe, hidden);
  const off = { ...LBE, "light.kitchen_pots": { ...LBE["light.kitchen_pots"], state: "off", bri: null } };
  const moved = { ...LIGHTS_MODEL, light_positions_m: { ...LIGHTS_MODEL.light_positions_m, "light.kitchen_pots": { x_m: 3.5, y_m: 2, floor_id: "main" } } };
  const base = sig(LBE, null);
  const shell = H.shellSignature(LIGHTS_MODEL, LIGHTS_MODEL.floors);
  const shell2 = H.shellSignature({ ...LIGHTS_MODEL, room_geometry_m: { Kitchen: rect("main", 0, 0, 6, 5) } }, LIGHTS_MODEL.floors);
  check("lights: the drawing is rebuilt for a move, never for a switch",
    sig(off, null) === base && sig(LBE, null, moved) !== base && sig(LBE, new Set(["light.cove"])) !== base
    && H.shellSignature(moved, LIGHTS_MODEL.floors) === shell && shell2 !== shell, null);
});

// ── north and the sun ───────────────────────────────────────────────────────
const LM = await import(pathToFileURL(join(WWW, "views", "lights_map.js")).href);
tryCase("compass: the y-down fabric — north and east by the bearing of +Y", () => {
  // fabric_compass.js: north = (sin b, cos b), east = (-cos b, sin b), +Y down the plan.
  const v = (a) => a.map(n => Math.round(n * 1e9) / 1e9 + 0);
  const c = (b) => { const r = H.fabricCompass(b); return { north: v(r.north), east: v(r.east) }; };
  const got = { 180: c(180), 0: c(0), 90: c(90), 270: c(270) };
  const want = {
    180: { north: [0, -1], east: [1, 0] },   // a plan drawn north-up: north is the top, east the right
    0:   { north: [0, 1], east: [-1, 0] },   // b = 0: north is +Y
    90:  { north: [1, 0], east: [0, 1] },    // b = 90: north is +X
    270: { north: [-1, 0], east: [0, -1] },
  };
  check("compass: the y-down fabric — north and east by the bearing of +Y", JSON.stringify(got) === JSON.stringify(want), got);
});
tryCase("sun: the light comes from the sun's side of the plan", () => {
  const d = (az, el, b) => { const r = H.sunDirection(az, el, b); return [r.x, r.y, r.up].map(n => Math.round(n * 1e9) / 1e9 + 0); };
  const c30 = Math.round(Math.cos(Math.PI / 6) * 1e9) / 1e9;
  const rows = {
    "b180 sun due east: from +X": [d(90, 0, 180), [1, 0, 0]],
    "b180 sun due south: from +Y": [d(180, 0, 180), [0, 1, 0]],
    "b180 sun due north: from -Y": [d(0, 0, 180), [0, -1, 0]],
    "b180 sun due west: from -X": [d(270, 0, 180), [-1, 0, 0]],
    "b0 sun due north: from +Y": [d(0, 0, 0), [0, 1, 0]],
    "b0 sun due east: from -X": [d(90, 0, 0), [-1, 0, 0]],
    "b90 sun due north: from +X": [d(0, 0, 90), [1, 0, 0]],
    "b90 sun due east: from +Y": [d(90, 0, 90), [0, 1, 0]],
    "b180 east, 30 up": [d(90, 30, 180), [c30, 0, 0.5]],
    "overhead": [d(123, 90, 37), [0, 0, 1]],
  };
  const bad = Object.entries(rows).filter(([, [g, w]]) => g.some((x, i) => Math.abs(x - w[i]) > 1e-6)).map(([k, [g]]) => [k, g]);
  check("sun: the light comes from the sun's side of the plan", !bad.length, bad);
});
tryCase("sun: the solar fallback against known dates and places, within 1°", () => {
  const day = (iso, lat, lon) => {
    const t0 = Date.parse(iso);
    let best = null, rise = null, prev = null;
    for (let m = 0; m < 1440; m++) {
      const t = t0 + m * 60000, p = H.solarPosition(lat, lon, t);
      if (!best || p.elevation > best.elevation) best = { ...p, t };
      if (prev && prev.elevation < 0 && p.elevation >= 0 && !rise) rise = p;
      prev = p;
    }
    return { best, rise };
  };
  const greenwich = day("2026-06-21T00:00:00Z", 51.4779, -0.0015);       // summer solstice
  const equator = day("2026-03-20T00:00:00Z", 0, 0);                     // March equinox
  const vancouver = day("2026-09-22T07:00:00Z", 49.2827, -123.1207);    // September equinox
  const sydney = day("2026-12-21T00:00:00Z", -33.8688, 151.2093).best;  // December solstice
  // Noon height = 90 - |latitude - declination|, declination ±23.44 at a
  // solstice, 0 at an equinox; noon is due south (due north from Sydney, where
  // the summer sun is north of the zenith); an equinox sunrise is due east.
  const az = (a, b) => Math.abs(((a - b) % 360 + 540) % 360 - 180);
  const ok = Math.abs(greenwich.best.elevation - (90 - 51.4779 + 23.44)) < 1 && az(greenwich.best.azimuth, 180) < 1
    && equator.best.elevation > 89 && vancouver.rise && az(vancouver.rise.azimuth, 90) < 1
    && Math.abs(sydney.elevation - (90 - (-23.44 + 33.8688))) < 1 && az(sydney.azimuth, 0) < 1;
  check("sun: the solar fallback against known dates and places, within 1°", ok,
    { greenwich: greenwich.best, equator: equator.best.elevation, rise: vancouver.rise, sydney });
});
tryCase("sun: the fallback's height is the Atlas's own (sunElevationDeg)", () => {
  let worst = 0;
  for (const [lat, lon] of [[49.28, -123.12], [-33.87, 151.21], [64.1, -21.9], [0, 0]]) {
    for (let h = 0; h < 48; h++) {
      const t = Date.parse("2026-09-30T00:00:00Z") + h * 1800000;
      worst = Math.max(worst, Math.abs(H.solarPosition(lat, lon, t).elevation - LM.sunElevationDeg(lat, lon, t)));
    }
  }
  check("sun: the fallback's height is the Atlas's own (sunElevationDeg)", worst < 1e-9, worst);
});
tryCase("sun: sun.sun first, then hass.config, then due south 45°", () => {
  const t = Date.parse("2026-06-21T20:00:00Z");
  const a = H.readSun({ "sun.sun": { state: "above_horizon", attributes: { azimuth: 200.5, elevation: 61.2 } } }, { latitude: 1, longitude: 2 }, t);
  const b = H.readSun({ "sun.sun": { state: "unavailable", attributes: {} } }, { latitude: 49.28, longitude: -123.12 }, t);
  const c = H.readSun({}, {}, t), e = H.readSun(null, null, NaN);
  const want = H.solarPosition(49.28, -123.12, t);
  check("sun: sun.sun first, then hass.config, then due south 45°",
    a.source === "sun" && a.azimuth === 200.5 && a.elevation === 61.2
    && b.source === "computed" && b.azimuth === want.azimuth && b.elevation === want.elevation
    && c.source === "default" && c.azimuth === 180 && c.elevation === 45 && e.source === "default", { a, b, c });
});
tryCase("sun: day, twilight and night by elevation, the Atlas's own bounds", () => {
  const at = (e) => H.sunLight(e);
  const rows = [[-20, "night"], [-6, "night"], [-5.9, "twilight"], [0, "twilight"], [5.9, "twilight"], [6, "day"], [60, "day"]];
  const phases = rows.every(([e, p]) => at(e).phase === p);
  const off = at(-6).sun === 0 && at(-30).sun === 0 && at(-6).night === 1;
  const blend = at(0).night === 0.5 && at(0).sun > 0 && at(0).sun < at(6).sun && at(6).night === 0;
  const lowWarm = at(3).warm > at(20).warm && at(30).warm === 0 && at(10).sun < at(50).sun && at(50).sun === 1;
  const parity = [-12, -6, -3, 0, 2.5, 6, 12].every(e => Math.abs(at(e).night - (1 - LM.ambientFromElevation(e))) < 1e-12);
  check("sun: day, twilight and night by elevation, the Atlas's own bounds", phases && off && blend && lowWarm && parity && H.DAY_ABOVE === 6 && H.NIGHT_BELOW === -6,
    { phases, off, blend, lowWarm, parity });
});
tryCase("north: north up, the Settings arrow, and the bearing kept to 0-359", () => {
  const nu = (b) => H.northUpTheta(b);
  // The camera looks along -(sin theta, cos theta): north up means that is north.
  const fwd = (b) => [-Math.sin(nu(b)), -Math.cos(nu(b))], north = (b) => H.fabricCompass(b).north;
  const up = [0, 90, 180, 270, 33].every(b => fwd(b).every((x, i) => Math.abs(x - north(b)[i]) < 1e-9));
  // The 3D view's Top preset (theta 0) is the plan as drawn: north up there for b = 180.
  const top = Math.abs(nu(180)) < 1e-9;
  // An arrow drawn up the plan, turned clockwise, points north.
  const arrow = [[180, 0], [0, 180], [90, 90], [270, 270], [45, 135]].every(([b, a]) => Math.abs(H.northArrowDeg(b) - a) < 1e-9);
  const norm = H.normBearing(370) === 10 && H.normBearing(-90) === 270 && H.normBearing("45") === 45 && H.normBearing("x") === 0
    && H.normBearing(null) === 0 && H.normBearing(360) === 0 && H.normBearing("") === 0;
  check("north: north up, the Settings arrow, and the bearing kept to 0-359", up && top && arrow && norm,
    { up, top, arrow: [0, 90, 180, 270, 45].map(b => [b, H.northArrowDeg(b)]), norm });
});

// ── the spun compass: needle angle <-> bearing, in any view ─────────────────
const angDiff = (a, b) => Math.abs((((a - b) % 360) + 540) % 360 - 180);
const YAWS = [0, 0.7, 2.0, -2.5, Math.PI, 5.5], TILTS = [0.0015, 0.5, 0.98, 1.4], NEEDLES = [0, 30, 90, 137, 200, 270, 350];
tryCase("spin: bearingOfNorth is fabricCompass's inverse", () => {
  const bad = [0, 0.5, 45, 90, 137.25, 180, 270, 359.5].filter(b => angDiff(H.bearingOfNorth(H.fabricCompass(b).north), b) > 1e-9);
  check("spin: bearingOfNorth is fabricCompass's inverse", !bad.length && H.bearingOfNorth([0, 0]) === 0 && H.bearingOfNorth(null) === 0, bad);
});
tryCase("spin: a needle angle and its bearing round-trip across yaws, tilts and angles", () => {
  const bad = [];
  for (const th of YAWS) for (const ph of TILTS) {
    for (const a of NEEDLES) {
      const b = H.bearingFromNeedle(a, th, ph), back = H.needleAngle(b, th, ph);
      if (angDiff(back, a) > 1e-6) bad.push({ th, ph, a, b, back });
    }
    for (const b of [0, 33, 90, 180, 251.5]) {
      const a = H.needleAngle(b, th, ph), back = H.bearingFromNeedle(a, th, ph);
      if (angDiff(back, b) > 1e-6) bad.push({ th, ph, b, a, back });
    }
  }
  check("spin: a needle angle and its bearing round-trip across yaws, tilts and angles", !bad.length, bad.slice(0, 5));
});
tryCase("spin: north up puts the needle straight up", () => {
  const bad = [];
  for (const b of [0, 33, 90, 180, 270]) for (const ph of TILTS) {
    const a = H.needleAngle(b, H.northUpTheta(b), ph);
    if (angDiff(a, 0) > 1e-6) bad.push({ b, ph, a });
  }
  check("spin: north up puts the needle straight up", !bad.length, bad);
});
const THREE = await import(pathToFileURL(join(WWW, "vendor", "three", "three.module.min.js")).href);
tryCase("spin: the needle angle is what a real camera draws at the middle of the view", () => {
  // The 3D view's camera: on a sphere round the target, looking at it.
  const W = 1600, Hh = 1000, bad = [];
  const cam = new THREE.PerspectiveCamera(40, W / Hh, 0.1, 700);
  const T = new THREE.Vector3(4, 3, -2), a = new THREE.Vector3(), b2 = new THREE.Vector3();
  for (const th of YAWS) for (const ph of TILTS) {
    cam.position.set(T.x + 30 * Math.sin(ph) * Math.sin(th), T.y + 30 * Math.cos(ph), T.z + 30 * Math.sin(ph) * Math.cos(th));
    cam.lookAt(T); cam.updateMatrixWorld();
    for (const deg of [0, 40, 95, 180, 260, 333]) {
      const d = [Math.sin(deg * Math.PI / 180), Math.cos(deg * Math.PI / 180)];
      a.copy(T).project(cam);
      b2.set(T.x + d[0] * 1e-3, T.y, T.z + d[1] * 1e-3).project(cam);
      const px = (b2.x - a.x) * W / 2, pyUp = (b2.y - a.y) * Hh / 2;
      const drawn = ((Math.atan2(px, pyUp) * 180 / Math.PI) % 360 + 360) % 360;
      const ours = H.screenAngleOfPlanDir(d, th, ph);
      if (angDiff(drawn, ours) > 0.01) bad.push({ th, ph, deg, drawn, ours });
    }
  }
  check("spin: the needle angle is what a real camera draws at the middle of the view", !bad.length, bad.slice(0, 5));
});

// ── open edges over a drop: railings (2026-10-20) ───────────────────────────
// A gym: a 20 x 10 m hall, a mezzanine 3 m up over its first 4 m, split into
// a gallery and a walkway. Open (Loft) edges: the gallery's edge over the hall
// (a drop into the house: a railing), between the gallery and the walkway (one
// floor: a gap), the hall's own outside edge (the ground: a gap), and the
// walkway's far end, which stands past the hall (nothing under it: a gap).
const GYM = { floors: [{ id: "hall", floor_to_floor_m: 7.5 }, { id: "mezz", floor_to_floor_m: 3 }], floor_elevations: { hall: 0, mezz: 3 },
  room_geometry_m: { Hall: rect("hall", 0, 0, 20, 10), Gallery: rect("mezz", 0, 0, 12, 4), Walkway: rect("mezz", 12.12, 0, 23, 4) },
  rf_barriers_m: [
    { id: "edge", material: "open", floor_id: "mezz", points_m: [[0, 4], [12, 4]] },
    { id: "between", material: "open", floor_id: "mezz", points_m: [[12.06, 0.5], [12.06, 3.5]] },
    { id: "hallside", material: "open", floor_id: "hall", points_m: [[20, 2], [20, 8]] },
    { id: "pastit", material: "open", floor_id: "mezz", points_m: [[23, 0.5], [23, 3.5]] },
  ] };
tryCase("open edges: a railing where an open edge looks down into the house, a gap everywhere else", () => {
  const h = H.readHouse(GYM, GYM.floors, {}, null);
  const at = (fl, id) => h.perFloor.get(h.byId.get(fl)).pieces.filter(p => p.barrier && p.barrier.id === id);
  const edge = at("mezz", "edge"), between = at("mezz", "between"), hallside = at("hall", "hallside"), past = at("mezz", "pastit");
  const glass = (pc) => H.wallElements(pc, 3).some(e => e.glass && e.z1 <= H.RAIL_H + 1e-9);
  check("open edges: a railing where an open edge looks down into the house, a gap everywhere else",
    edge.length && edge.every(p => p.kind === "open" && p.loftRail && glass(p))
    && between.length && between.every(p => p.kind === "open" && !p.loftRail && !glass(p))
    && hallside.length && hallside.every(p => !p.loftRail)
    && past.length && past.every(p => !p.loftRail),
    { edge, between, hallside, past });
});
tryCase("open edges: a railing edge is still an opening, never a wall a light hangs on", () => {
  const h = H.readHouse(GYM, GYM.floors, {}, null);
  const pieces = h.perFloor.get(h.byId.get("mezz")).pieces;
  const hung = H.nearestWall(pieces, 6, 3.9, 0.5);
  check("open edges: a railing edge is still an opening, never a wall a light hangs on",
    !hung || !(hung.pc.barrier && hung.pc.barrier.id === "edge"), hung && hung.pc);
});

// The same house's other cases: one change each to the gym.
const gymWith = (patch) => JSON.parse(JSON.stringify({ ...GYM, ...patch }));
const railOf = (h, fl, id) => h.perFloor.get(h.byId.get(fl)).pieces.filter(p => p.barrier && p.barrier.id === id);
tryCase("open edges: over a deck below a railing; over a step under the guard drop (0.76 m) a gap", () => {
  const deck = gymWith({ floor_elevations: { hall: 0, mezz: 3 }, room_meta: { Hall: { outdoor: true } } });
  const step = gymWith({ floor_elevations: { hall: 0, mezz: 0.6 } });
  const d = railOf(H.readHouse(deck, deck.floors, {}, null), "mezz", "edge");
  const st = railOf(H.readHouse(step, step.floors, {}, null), "mezz", "edge");
  check("open edges: over a deck below a railing; over a step under the guard drop (0.76 m) a gap",
    H.GUARD_DROP_M === 0.76 && d.length && d.every(p => p.loftRail) && st.length && st.every(p => !p.loftRail), { d, st });
});
tryCase("open edges: over a plain storey (an upstairs doorway onto an undrawn landing) a gap, not a railing", () => {
  // The hall only 3 m tall: the mezzanine is the floor above, not inside it.
  const stacked = gymWith({ floors: [{ id: "hall", floor_to_floor_m: 3 }, { id: "mezz", floor_to_floor_m: 3 }] });
  const ps = ["edge", "pastit"].flatMap(id => railOf(H.readHouse(stacked, stacked.floors, {}, null), "mezz", id));
  check("open edges: over a plain storey (an upstairs doorway onto an undrawn landing) a gap, not a railing",
    ps.length && ps.every(p => p.kind === "open" && !p.loftRail), { ps });
});
tryCase("open edges: Explode never changes which edges get a railing", () => {
  const plain = H.readHouse(GYM, GYM.floors, {}, null), exploded = H.readHouse(GYM, GYM.floors, {}, null, null, 2.6);
  const flags = (h) => ["edge", "between", "pastit"].map(id => railOf(h, "mezz", id).map(p => !!p.loftRail).join(",")).join("|");
  // A step (0.6 m) stays a step when Explode lifts the mezzanine 2.6 m apart.
  const step = gymWith({ floor_elevations: { hall: 0, mezz: 0.6 } });
  const sPlain = H.readHouse(step, step.floors, {}, null), sExp = H.readHouse(step, step.floors, {}, null, null, 2.6);
  check("open edges: Explode never changes which edges get a railing", flags(plain) === flags(exploded) && flags(plain).startsWith("true")
    && flags(sPlain) === flags(sExp) && !flags(sExp).includes("true"),
    { plain: flags(plain), exploded: flags(exploded), step: flags(sPlain), stepExploded: flags(sExp) });
});
tryCase("open edges: part of an edge open: the railing on that part only, the rest stays wall", () => {
  const part = gymWith({ rf_barriers_m: [{ id: "edge", material: "open", floor_id: "mezz", points_m: [[2, 4], [7, 4]] }] });
  const hp = H.readHouse(part, part.floors, {}, null), pieces = hp.perFloor.get(hp.byId.get("mezz")).pieces;
  const front = pieces.filter(p => near(p.y0, p.y1, 1e-6) && Math.abs(p.y0 - 4) < 0.2 && Math.max(p.x0, p.x1) <= 12.01);
  const rails = front.filter(p => p.loftRail), walls = front.filter(p => p.kind === "wall");
  const span = rails.reduce((a, p) => a + len(p), 0);
  check("open edges: part of an edge open: the railing on that part only, the rest stays wall",
    rails.length >= 1 && near(span, 5, 0.02) && walls.length >= 2 && walls.every(w => !w.loftRail), { front });
});
tryCase("open edges: one barrier round a corner: a railing where it drops, a gap where it meets a room", () => {
  const multi = gymWith({ rf_barriers_m: [{ id: "edge", material: "open", floor_id: "mezz", points_m: [[0, 4], [12, 4], [12, 0.5]] }] });
  const ps = railOf(H.readHouse(multi, multi.floors, {}, null), "mezz", "edge");
  const front = ps.filter(p => near(p.y0, p.y1, 1e-6)), side = ps.filter(p => !near(p.y0, p.y1, 1e-6));
  check("open edges: one barrier round a corner: a railing where it drops, a gap where it meets a room",
    front.length && front.every(p => p.loftRail) && side.length && side.every(p => !p.loftRail), { front, side });
});
tryCase("open edges: a railing's ends close the gap between two rooms, as a wall's do", () => {
  const h = H.readHouse(GYM, GYM.floors, {}, null);
  const pc = railOf(h, "mezz", "edge")[0];
  const sp = H.drawnSpan(pc), gap = H.drawnSpan({ ...pc, loftRail: false });
  check("open edges: a railing's ends close the gap between two rooms, as a wall's do",
    sp && gap && sp.len > gap.len + pc.thick * 0.99, { sp, gap, thick: pc.thick });
});
tryCase("roof: a mezzanine inside a taller hall is under the hall's roof, roofed only past it", () => {
  const m = ST.houseModel(H.readHouse(GYM, GYM.floors, {}, null));
  const hall = m.storeys.find(s => s.elev === 0), mezz = m.storeys.find(s => s.elev === 3);
  const stacked = gymWith({ floors: [{ id: "hall", floor_to_floor_m: 3 }, { id: "mezz", floor_to_floor_m: 3 }] });
  const ms = ST.houseModel(H.readHouse(stacked, stacked.floors, {}, null));
  const sHall = ms.storeys.find(s => s.elev === 0), sMezz = ms.storeys.find(s => s.elev === 3);
  const cells = (s) => s.roofCells.reduce((a, v) => a + v, 0);
  check("roof: a mezzanine inside a taller hall is under the hall's roof, roofed only past it",
    // the hall: all of it roofed; the mezzanine: roofed only where it stands
    // past the hall (the walkway's last 3 m), never over the hall
    cells(hall) === hall.cells.reduce((a, v) => a + v, 0)
    && cells(mezz) > 0 && mezz.roofCells.every((v, i) => !v || !hall.cells[i])
    && ST.underRoof(m, 6, 2, 3) && ST.underRoof(m, 6, 8, 0) && ST.underRoof(m, 22, 2, 3)
    // the opt-in report's word for it: the gym has one, a stacked house none
    && H.hasNestedFloor(H.readHouse(GYM, GYM.floors, {}, null)) && !H.hasNestedFloor(H.readHouse(stacked, stacked.floors, {}, null))
    // floors stacked one on another, as before: the upper one roofed, the hall only where it isn't
    && cells(sMezz) > 0 && cells(sHall) < sHall.cells.reduce((a, v) => a + v, 0),
    { hall: cells(hall), mezz: cells(mezz), sHall: cells(sHall), sMezz: cells(sMezz) });
});
tryCase("strip: along a mezzanine's railing, on the rail's top; the rest of the room is wire", () => {
  const h = H.readHouse(GYM, GYM.floors, {}, null);
  const mezz = h.perFloor.get(h.byId.get("mezz"));
  const rails = mezz.pieces.filter(p => p.kind === "rail" || p.loftRail).map(p => ({ a: [p.x0, p.y0], b: [p.x1, p.y1] }));
  const gallery = mezz.rooms.find(r => r.name === "Gallery");
  const r = RU.alongRail(RU.insetLoop(gallery.pts, 0.03), rails, {});
  const run = r.run || r;
  check("strip: along a mezzanine's railing, on the rail's top; the rest of the room is wire",
    !r.error && rails.length && run.pts.every(q => near(q[2], RU.RAIL_TOP_M, 1e-9)) && run.gaps && run.gaps.length === 3, r);
});

// ── a room's own height (room_meta[room].height_m) ──────────────────────────
// What the 3D house is drawn from, with the room objects left out (they are
// shared, not copied): the walls as drawn, the railings, the storeys' roofs.
const drawnOf = (model) => {
  const h = H.readHouse(model, model.floors, {}, null);
  const walls = [];
  for (const [fl, per] of h.perFloor) for (const pc of per.pieces) walls.push([fl.id, { ...pc, barrier: pc.barrier && pc.barrier.id }, H.wallElements(pc, fl.h)]);
  const m = ST.houseModel(h);
  return JSON.stringify({ walls, rooms: h.rooms.map(r => [r.name, r.h]), nested: H.hasNestedFloor(h),
    storeys: m.storeys.map(s => ({ elev: s.elev, top: s.top, shapes: s.shapes, roof: s.roof, lids: s.lids, roofCells: Array.from(s.roofCells).join("") })) });
};
// A two-storey house: a living room on a ground floor of normal height,
// a kitchen beside it, a hall behind it; upstairs a gallery over the kitchen
// whose open edge overlooks the living room, and a study over nothing but
// the kitchen's back whose open edge looks onto the hall's roof.
const TALL = { floors: [{ id: "g", name: "Ground" }, { id: "u", name: "Upstairs" }], floor_elevations: { g: 0, u: 2.8 },
  room_geometry_m: { Living: rect("g", 0, 0, 6, 8), Kitchen: rect("g", 6.1, 0, 12, 8), Hall: rect("g", 0, 8.1, 6, 10),
    Gallery: rect("u", 6.1, 0, 12, 8), Study: rect("u", 6.1, 8.1, 12, 10) },
  rf_barriers_m: [{ id: "gal", material: "open", floor_id: "u", points_m: [[6.1, 0], [6.1, 8]] },
    { id: "st", material: "open", floor_id: "u", points_m: [[6.1, 8.1], [6.1, 10]] }] };
const tallWith = (meta) => JSON.parse(JSON.stringify({ ...TALL, room_meta: meta }));
tryCase("room height: none set is exactly as before, and so is the floor's own", () => {
  const same = (m, metas) => metas.map(x => drawnOf({ ...JSON.parse(JSON.stringify(m)), room_meta: x })).every((d, i, a) => d === a[0]);
  const gymMeta = [undefined, {}, { Hall: { floor_id: "hall", color: "#123456" } }, { Hall: { height_m: null } }, { Hall: { height_m: "7" } }, { Hall: { height_m: 7.5 } }];
  const tallMeta = [undefined, { Living: { height_m: null } }, { Living: { height_m: 2.8 } }, { Living: { height_m: 0.2 } }, { Kitchen: { color: "#abcdef" } }];
  const h = H.readHouse(TALL, TALL.floors, {}, null);
  const pieces = [...h.perFloor.values()].flatMap(per => per.pieces);
  check("room height: none set is exactly as before, and so is the floor's own",
    same(GYM, gymMeta) && same(TALL, tallMeta) && pieces.every(pc => !("wallH" in pc)) && h.rooms.every(r => r.h === r.floor.h)
    && ST.houseModel(h).storeys.every(s => s.tiers.length === 1 && s.tiers[0].top === s.top), null);
});
tryCase("room height: a double-height living room: its walls rise, no other room's do", () => {
  const h = H.readHouse(tallWith({ Living: { height_m: 5.6 } }), TALL.floors, {}, null);
  const g = h.byId.get("g"), u = h.byId.get("u");
  const top = (pc, fl) => Math.max(...H.wallElements(pc, fl.h).map(e => e.z1));
  const ground = h.perFloor.get(g).pieces, up = h.perFloor.get(u).pieces;
  const onLine = (pc, f) => f((pc.x0 + pc.x1) / 2, (pc.y0 + pc.y1) / 2);
  const living = ground.filter(pc => onLine(pc, (x, y) => x < 6.2 && y < 8.2));            // round the living room
  const toKitchen = living.filter(pc => onLine(pc, (x) => x > 5.9)), toHall = living.filter(pc => onLine(pc, (x, y) => y > 7.9));
  const outside = living.filter(pc => !toKitchen.includes(pc) && !toHall.includes(pc));
  const others = ground.filter(pc => !living.includes(pc));
  check("room height: a double-height living room: its walls rise, no other room's do",
    outside.length === 2 && outside.every(pc => near(top(pc, g), 5.6 - H.SLAB_T))
    // up past the hall's roof (nothing upstairs stands on the hall) ...
    && toHall.length === 1 && near(top(toHall[0], g), 5.6 - H.SLAB_T)
    // ... but not past the kitchen's: the gallery stands on it, its own edge takes over
    && toKitchen.length === 1 && near(top(toKitchen[0], g), 2.8 - H.SLAB_T) && !("wallH" in toKitchen[0])
    && others.length > 3 && others.every(pc => near(top(pc, g), 2.8 - H.SLAB_T) && !("wallH" in pc))
    && up.filter(pc => pc.kind === "wall").every(pc => near(top(pc, u), 2.8 - H.SLAB_T)),
    { outside: outside.map(pc => top(pc, g)), toHall: toHall.map(pc => top(pc, g)), toKitchen: toKitchen.map(pc => top(pc, g)),
      others: others.map(pc => [pc.x0, pc.y0, pc.x1, pc.y1, top(pc, g)]) });
});
// A gallery upstairs along the back and side of the double-height living
// room: both rooms have an outside wall on those lines.
const GALLERY = { floors: [{ id: "g", name: "Ground" }, { id: "u", name: "Upstairs" }], floor_elevations: { g: 0, u: 2.8 },
  room_geometry_m: { Living: rect("g", 0, 0, 6, 8), Kitchen: rect("g", 6.1, 0, 12, 8),
    Gallery: rect("u", 0, 0, 6, 3), Bed: rect("u", 6.1, 0, 12, 8) },
  rf_barriers_m: [{ id: "gal", material: "open", floor_id: "u", points_m: [[0, 3], [6, 3]] }] };
const wallBands = (h) => {
  const out = [];
  for (const [fl, per] of h.perFloor) for (const pc of per.pieces) {
    if (pc.kind === "rail" || pc.kind === "open" || pc.loftRail) continue;
    const E = H.wallElements(pc, fl.h), L = Math.hypot(pc.x1 - pc.x0, pc.y1 - pc.y0);
    if (!E.length || L < 0.03) continue;
    const ux = (pc.x1 - pc.x0) / L, uy = (pc.y1 - pc.y0) / L;
    out.push({ pc, fl: fl.id, ux, uy, z0: fl.elev0 + Math.min(...E.map(e => e.z0)), z1: fl.elev0 + Math.max(...E.map(e => e.z1)) });
  }
  return out;
};
// Two pieces in one plane (parallel, on one line) over one stretch and one height band.
const overlaps = (B) => {
  const bad = [];
  for (let i = 0; i < B.length; i++) for (let j = i + 1; j < B.length; j++) {
    const a = B[i], b = B[j];
    if (Math.abs(a.ux * b.ux + a.uy * b.uy) < Math.cos(2 * Math.PI / 180)) continue;
    const off = (p) => (p[0] - a.pc.x0) * -a.uy + (p[1] - a.pc.y0) * a.ux, at = (p) => (p[0] - a.pc.x0) * a.ux + (p[1] - a.pc.y0) * a.uy;
    const p0 = [b.pc.x0, b.pc.y0], p1 = [b.pc.x1, b.pc.y1];
    if (Math.abs(off(p0)) > 0.03 || Math.abs(off(p1)) > 0.03) continue;
    const La = Math.hypot(a.pc.x1 - a.pc.x0, a.pc.y1 - a.pc.y0);
    const along = Math.min(La, Math.max(at(p0), at(p1))) - Math.max(0, Math.min(at(p0), at(p1)));
    const up = Math.min(a.z1, b.z1) - Math.max(a.z0, b.z0);
    if (along > 0.05 && up > 0.01) bad.push([a.fl, [a.pc.x0, a.pc.y0, a.pc.x1, a.pc.y1, a.z0, a.z1], b.fl, [b.pc.x0, b.pc.y0, b.pc.x1, b.pc.y1, b.z0, b.z1]]);
  }
  return bad;
};
// What covers the facade at (x, y) on the line with direction (ux, uy): the merged height bands.
const coverAt = (B, x, y, ux, uy) => {
  const bands = B.filter(b => Math.abs(b.ux * ux + b.uy * uy) > 0.999 && segDistTo(b.pc, x, y) < 0.1).map(b => [b.z0, b.z1]).sort((p, q) => p[0] - q[0]);
  const m = [];
  for (const [z0, z1] of bands) { const l = m[m.length - 1]; if (l && z0 <= l[1] + 0.01) l[1] = Math.max(l[1], z1); else m.push([z0, z1]); }
  return m;
};
const segDistTo = (pc, x, y) => H.segDist(x, y, pc.x0, pc.y0, pc.x1, pc.y1)[0];
const EXT = H.EXT_T / 2;
tryCase("room height: a gallery along the tall room's facade: one wall per plane and height, no gap", () => {
  const res = {};
  for (const [name, hm] of [["reaches", 5.6], ["below", 7]]) {
    const h = H.readHouse(JSON.parse(JSON.stringify({ ...GALLERY, room_meta: { Living: { height_m: hm } } })), GALLERY.floors, {}, null);
    const B = wallBands(h);
    // The back (y = 0) and the side (x = 0) of the living room, under the gallery and past it.
    const spots = [[1.5, -EXT, 1, 0], [4.5, -EXT, 1, 0], [-EXT, 1.5, 0, 1], [-EXT, 5, 0, 1]];
    const cover = spots.map(([x, y, ux, uy]) => coverAt(B, x, y, ux, uy));
    res[name] = { bad: overlaps(B), cover };
  }
  const whole = (c, top) => c.length === 1 && near(c[0][0], -H.SLAB_T) && c[0][1] >= top - 1e-6;
  check("room height: a gallery along the tall room's facade: one wall per plane and height, no gap",
    res.reaches.bad.length === 0 && res.below.bad.length === 0
    // under the gallery, up to the gallery's own top; past it, the living room's
    && res.reaches.cover.every(c => whole(c, 5.6 - H.SLAB_T))
    && whole(res.below.cover[0], 7 - H.SLAB_T) && whole(res.below.cover[2], 7 - H.SLAB_T) && whole(res.below.cover[3], 7 - H.SLAB_T),
    res);
});
tryCase("room height: a room lower than its floor is drawn as its floor", () => {
  const low = drawnOf(tallWith({ Living: { height_m: 2.0 } })), none = drawnOf(tallWith({}));
  const h = H.readHouse(tallWith({ Living: { height_m: 2.0 } }), TALL.floors, {}, null);
  check("room height: a room lower than its floor is drawn as its floor",
    low === none && h.rooms.every(r => r.h === r.floor.h), null);
});
tryCase("room height: a light in the tall room hangs from its own ceiling; none set, nothing moves", () => {
  const partsOf = (meta) => {
    const h = H.readHouse({ ...JSON.parse(JSON.stringify(LIGHTS_MODEL)), room_meta: meta }, LIGHTS_MODEL.floors, LBE, null, SHAPES);
    const fl = h.byId.get("main"), ctx = { ...h.perFloor.get(fl), ground: h.ground };
    return { h, fl, parts: Object.fromEntries(h.lights.map(L => [L.eid, H.fixtureParts(L, ctx)])) };
  };
  const a = partsOf(undefined), low = partsOf({ Kitchen: { height_m: 2.0 } }), tall = partsOf({ Kitchen: { height_m: 5 } });
  const pot = tall.parts["light.kitchen_pots"], sc = tall.parts["light.wall_sconce"];
  check("room height: a light in the tall room hangs from its own ceiling; none set, nothing moves",
    JSON.stringify(a.parts) === JSON.stringify(low.parts)
    && near(H.ceilAt(a.h.rooms, a.fl, 3, 2), 2.8) && near(H.ceilAt(tall.h.rooms, tall.fl, 3, 2), 5)
    && near(H.ceilAt(tall.h.rooms, tall.fl, 30, 2), 2.8) && near(H.ceilAt(tall.h.rooms, tall.fl, null, null), 2.8)
    && near(pot.bulbs[0].h, 5 - H.SLAB_T - 0.012) && sc.bulbs[0].h === 1.7,
    { pot: pot.bulbs[0].h });
});
tryCase("room height: a mezzanine is counted only where the upper floor stands over the tall room", () => {
  const nested = (m) => H.hasNestedFloor(H.readHouse(m, m.floors, {}, null));
  const galleryOver = JSON.parse(JSON.stringify({ ...GALLERY, room_meta: { Living: { height_m: 5.6 } } }));
  check("room height: a mezzanine is counted only where the upper floor stands over the tall room",
    // two storeys, a double-height living room, nothing upstairs over it: no mezzanine
    !nested(tallWith({ Living: { height_m: 5.6 } })) && nested(galleryOver) && !nested(tallWith({}))
    && !nested(JSON.parse(JSON.stringify({ ...GALLERY, room_meta: {} }))), null);
});
tryCase("room height: the gallery gets its railing only where it overlooks the tall room", () => {
  const rails = (meta) => { const h = H.readHouse(tallWith(meta), TALL.floors, {}, null);
    return ["gal", "st"].map(id => railOf(h, "u", id).map(p => !!p.loftRail).join(",")).join("|"); };
  // Without the living room's height the floor below is a plain storey: no railing anywhere.
  check("room height: the gallery gets its railing only where it overlooks the tall room",
    rails({ Living: { height_m: 5.6 } }) === "true|false" && rails({}) === "false|false"
    // a room 3.5 m high is no drop past a railing (2.8 + RAIL_H)
    && rails({ Living: { height_m: 3.5 } }) === "false|false" && rails({ Hall: { height_m: 5.6 } }) === "false|true",
    { tall: rails({ Living: { height_m: 5.6 } }), none: rails({}), low: rails({ Living: { height_m: 3.5 } }), hall: rails({ Hall: { height_m: 5.6 } }) });
});
tryCase("room height: the tall room is roofed at its own height, the rest of its floor at the floor's", () => {
  const m = ST.houseModel(H.readHouse(tallWith({ Living: { height_m: 5.6 } }), TALL.floors, {}, null));
  const g0 = m.storeys.find(s => s.elev === 0), u = m.storeys.find(s => near(s.elev, 2.8));
  check("room height: the tall room is roofed at its own height, the rest of its floor at the floor's",
    JSON.stringify(g0.tiers.map(t => t.top)) === "[5.6,2.8]" && g0.tiers.every(t => t.roof.length >= 1) && g0.reach === 5.6
    && u.tiers.length === 1 && near(u.tiers[0].top, 5.6)
    && ST.underRoofAt(m, 3, 4, 5.3) && !ST.underRoofAt(m, 3, 9.5, 5.3) && ST.underRoofAt(m, 3, 9.5, 2.5)   // living room 5.3 m up; over the hall
    && ST.underRoofAt(m, 9, 4, 5.3) && ST.underRoof(m, 3, 4, 0) && ST.underRoof(m, 9, 4, 2.8)
    // the kitchen, under the gallery, has no roof of its own
    && !g0.tiers.some(t => { const [uu, vv] = m.frame.toLocal([9, 4]); const i = Math.floor((uu - m.grid.u0) / m.grid.cell), j = Math.floor((vv - m.grid.v0) / m.grid.cell); return t.roofCells[j * m.grid.nx + i]; }),
    { tiers: g0.tiers.map(t => [t.top, t.roof.length]), up: u.tiers.map(t => [t.top, t.roof.length]) });
});
tryCase("room height: a mezzanine in a hall room of its own height, on floors of normal height", () => {
  // The gym with both floors 3 m: the hall's height is the room's, not its floor's.
  const gym = gymWith({ floors: [{ id: "hall", floor_to_floor_m: 3 }, { id: "mezz", floor_to_floor_m: 3 }], room_meta: { Hall: { height_m: 7.5 } } });
  const h = H.readHouse(gym, gym.floors, {}, null), m = ST.houseModel(h);
  const hall = m.storeys.find(s => s.elev === 0), mezz = m.storeys.find(s => s.elev === 3);
  const cells = (s) => s.roofCells.reduce((a, v) => a + v, 0);
  const hallWalls = h.perFloor.get(h.byId.get("hall")).pieces.filter(pc => pc.kind === "wall");
  check("room height: a mezzanine in a hall room of its own height, on floors of normal height",
    ["edge", "between", "pastit"].map(id => railOf(h, "mezz", id).map(p => !!p.loftRail).join(",")).join("|") === "true|false|false"
    && cells(hall) === hall.cells.reduce((a, v) => a + v, 0) && hall.tiers.length === 1 && near(hall.tiers[0].top, 7.5)
    && cells(mezz) > 0 && mezz.roofCells.every((v, i) => !v || !hall.cells[i]) && H.hasNestedFloor(h)
    // all the hall's walls at its height, but where the walkway runs out over its east wall (settleWalls, 0.38.164)
    && hallWalls.length && hallWalls.every(pc => near(Math.max(...H.wallElements(pc, 3).map(e => e.z1)),
      (pc.x0 > 19.9 && Math.max(pc.y0, pc.y1) <= 4.01 ? 3 : 7.5) - H.SLAB_T))
    && hallWalls.some(pc => pc.x0 > 19.9 && pc.capped && !("wallH" in pc)),
    { hall: cells(hall), mezz: cells(mezz), tiers: hall.tiers.map(t => t.top) });
});

// ── walls under a floor above (settleWalls, 0.38.164) ───────────────────────
// Synthetic: a 12 x 8 m ground floor of two rooms (A, B), its floor 6 m tall,
// and at 3 m an upper floor whose room U stands over the wall between them.
const topOf = (pc, h) => Math.max(...H.wallElements(pc, h).map(e => e.z1));
const wallsOf = (h, fl) => h.perFloor.get(h.byId.get(fl)).pieces.filter(pc => pc.kind === "wall");
const SPLIT = (extra = {}) => ({ floors: [{ id: "g", floor_to_floor_m: 6 }, { id: "u", floor_to_floor_m: 3 }], floor_elevations: { g: 0, u: 3 },
  room_geometry_m: { A: rect("g", 0, 0, 6, 8), B: rect("g", 6.1, 0, 12, 8), U: rect("u", 3, 0, 9, 4), ...(extra.rooms || {}) },
  room_meta: extra.meta || {}, rf_barriers_m: extra.barriers || [] });
tryCase("walls: a shared wall of two rooms the same height stops under the room above it", () => {
  const h = H.readHouse(SPLIT(), SPLIT().floors, {}, null);
  const mid = wallsOf(h, "g").filter(pc => pc.shared && Math.abs(pc.x0 - 6.05) < 0.05);
  const under = mid.filter(pc => Math.max(pc.y0, pc.y1) <= 4.01), past = mid.filter(pc => Math.min(pc.y0, pc.y1) >= 3.99);
  check("walls: a shared wall of two rooms the same height stops under the room above it",
    under.length && under.every(pc => pc.capped && near(topOf(pc, 6), 3 - H.SLAB_T))
    && past.length && past.every(pc => !pc.capped && near(topOf(pc, 6), 6 - H.SLAB_T)), { mid });
});
tryCase("walls: a tall room's wall stops under an upper room that stands over it", () => {
  // Floors of normal height (3 m), room A rises to 6 m; U overhangs A's east wall by 1 m.
  const m = SPLIT({ meta: { A: { height_m: 6 } } }); m.floors[0].floor_to_floor_m = 3;
  m.room_geometry_m.U = rect("u", 5, 0, 7, 4);
  const h = H.readHouse(m, m.floors, {}, null);
  const east = wallsOf(h, "g").filter(pc => Math.abs(pc.x0 - 6.05) < 0.05);
  check("walls: a tall room's wall stops under an upper room that stands over it",
    east.length && east.every(pc => topOf(pc, 3) <= (Math.max(pc.y0, pc.y1) <= 4.01 ? 3 : 6) - H.SLAB_T + 1e-9)
    && east.some(pc => pc.capped) && east.some(pc => near(topOf(pc, 3), 6 - H.SLAB_T)), { east });
});
tryCase("walls: under a walkway's Open (Loft) edge the wall stops at the walkway", () => {
  // U along B's west wall, its west edge open over the tall A: the wall between A and B stops at 3 m there.
  const m = SPLIT({ barriers: [{ id: "o", material: "open", floor_id: "u", points_m: [[6.05, 0], [6.05, 4]] }] });
  m.room_geometry_m.U = rect("u", 6.05, 0, 9, 4);
  const h = H.readHouse(m, m.floors, {}, null);
  const mid = wallsOf(h, "g").filter(pc => pc.shared && Math.abs(pc.x0 - 6.05) < 0.05);
  const m2 = SPLIT(); m2.room_geometry_m.U = rect("u", 6.05, 0, 9, 4); m2.floors[1].floor_to_floor_m = 2;   // a solid edge, the room not up to the top: left alone
  const h2 = H.readHouse(m2, m2.floors, {}, null), mid2 = wallsOf(h2, "g").filter(pc => pc.shared && Math.abs(pc.x0 - 6.05) < 0.05);
  check("walls: under a walkway's Open (Loft) edge the wall stops at the walkway",
    mid.some(pc => pc.capped && near(topOf(pc, 6), 3 - H.SLAB_T) && Math.max(pc.y0, pc.y1) <= 4.01)
    && mid2.length && mid2.every(pc => !pc.capped && near(topOf(pc, 6), 6 - H.SLAB_T)), { mid, mid2 });
});
tryCase("walls: a hall's outside wall under a gallery keeps its height; stacked floors are untouched", () => {
  const hall = { floors: [{ id: "hall", floor_to_floor_m: 7.5 }, { id: "m", floor_to_floor_m: 4.3 }], floor_elevations: { hall: 0, m: 3.2 },
    room_geometry_m: { Hall: rect("hall", 0, 0, 20, 12), G1: rect("m", 0, 0, 6, 6), G2: rect("m", 0, 6.12, 6, 12) } };
  const a = wallsOf(H.readHouse(hall, hall.floors, {}, null), "hall");
  // A plain two-storey house, the lower floor stacked 0.1 m into the upper (a slab's worth): nothing changes.
  const two = { floors: [{ id: "g", floor_to_floor_m: 2.9 }, { id: "u", floor_to_floor_m: 2.8 }], floor_elevations: { g: 0, u: 2.8 },
    room_geometry_m: { K: rect("g", 0, 0, 5, 5), L: rect("g", 5.1, 0, 10, 5), Bed: rect("u", 0, 0, 10, 5) } };
  const b = H.readHouse(two, two.floors, {}, null).perFloor;
  check("walls: a hall's outside wall under a gallery keeps its height; stacked floors are untouched",
    a.length === 4 && a.every(pc => !pc.capped && !("wallH" in pc))
    && [...b.values()].every(per => per.pieces.every(pc => !pc.capped && !("wallH" in pc))), { a });
});
tryCase("walls: a tall stretch shorter than 0.3 m joined to no other keeps its floor's height", () => {
  // A 6 m room's walls on a 3 m floor: a 0.1 m stub on its own, and a 0.1 m end joined to a 1 m stretch.
  const pc = (x0, x1) => ({ x0, y0: 0, x1, y1: 0, nx: 0, ny: -1, thick: 0.14, kind: "wall", cls: "int", wallH: 6 });
  const s = H.settleWalls({ id: "g", h: 3, elev0: 0, outdoor: false }, [pc(0, 0.1), pc(3, 4), pc(4, 4.1)], []);
  check("walls: a tall stretch shorter than 0.3 m joined to no other keeps its floor's height",
    s.length === 3 && s[0].capped && !("wallH" in s[0]) && !s[1].capped && s[1].wallH === 6 && !s[2].capped && s[2].wallH === 6, { s });
});

tryCase("walls: a mezzanine named Deck in a hall is indoors; a deck on a plain storey is not", () => {
  const hall = { floors: [{ id: "hall", floor_to_floor_m: 7.5 }, { id: "m", floor_to_floor_m: 4.3 }], floor_elevations: { hall: 0, m: 3.2 },
    room_geometry_m: { Hall: rect("hall", 0, 0, 20, 12), "Deck A": rect("m", 0, 0, 6, 12) } };
  const two = { floors: [{ id: "g", floor_to_floor_m: 2.8 }, { id: "u", floor_to_floor_m: 2.8 }], floor_elevations: { g: 0, u: 2.8 },
    room_geometry_m: { Garage: rect("g", 0, 0, 6, 6), "Roof Deck": rect("u", 0, 0, 6, 6), Patio: rect("g", 6.1, 0, 10, 6) } };
  const a = H.readHouse(hall, hall.floors, {}, null).rooms, b = H.readHouse(two, two.floors, {}, null).rooms;
  const of = (R, n) => R.find(r => r.name === n);
  check("walls: a mezzanine named Deck in a hall is indoors; a deck on a plain storey is not",
    !of(a, "Deck A").outdoor && !of(a, "Hall").outdoor && of(b, "Roof Deck").outdoor && of(b, "Patio").outdoor && !of(b, "Garage").outdoor,
    { a: a.map(r => [r.name, r.outdoor]), b: b.map(r => [r.name, r.outdoor]) });
});

// ── telemetry ───────────────────────────────────────────────────────────────
tryCase("telemetry: closed words, once per page load", () => {
  H._resetHouse3dCountsForTests();
  const sent = [];
  const s = (n) => sent.push(n);
  const r = [H.countHouse3dOnce("house3d_opened", s), H.countHouse3dOnce("house3d_opened", s),
    H.countHouse3dOnce("house3d_fallback:no_webgl", s), H.countHouse3dOnce("house3d_fallback:light.kitchen", s),
    H.countHouse3dOnce("house3d_fallback:", s), H.countHouse3dOnce("tab:maps", s)];
  check("telemetry: closed words, once per page load", JSON.stringify(r) === "[true,false,true,false,false,false]"
    && JSON.stringify(sent) === JSON.stringify(["house3d_opened", "house3d_fallback:no_webgl"]), { r, sent });
});

console.log(JSON.stringify({ cases, failures, lists: { fallbacks: H.HOUSE3D_FALLBACK_KINDS, events: H.HOUSE3D_EVENTS } }));
process.exit(failures.length ? 1 : 0);
