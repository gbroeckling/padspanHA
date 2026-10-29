// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
//
// Live Aboard's split levels (live_aboard_house.js splitLevels, 0.38.190):
// a room whose floor is raised (or sunk) from the rest of its floor, run for
// real under node.
//
//   split    rooms raised alike share one level; what is placed in them moves
//            onto it; the ceiling stays level under a higher floor; a sunken
//            room; a model with none comes back as it was
//   floors   the level shows with its floor (its chip), knows its rooms, and
//            things standing in it are on it; Explode keeps it with its floor
//   stairs   a flight whose top is in a raised room climbs into it and cuts
//            its opening there
//   stem     a raised level stands on a wall down to its floor
//   big      a gigantic house: many floors, rooms, split levels and stairs,
//            read in good time, one storey per floor (not one per raised
//            room), and every stair reaching the right level
//
// usage: live_aboard_split_levels.mjs <www/padspan-ha dir>
// prints one JSON line: { cases: {name: result}, failures: [...], timing }

import { pathToFileURL } from "node:url";
import { join } from "node:path";

const WWW = process.argv[2];
if (!WWW) { console.error("usage: live_aboard_split_levels.mjs <www/padspan-ha dir>"); process.exit(2); }
const S = await import(pathToFileURL(join(WWW, "views", "live_aboard_storey.js")).href);
const H = await import(pathToFileURL(join(WWW, "views", "live_aboard_house.js")).href);
const D = await import(pathToFileURL(join(WWW, "views", "live_aboard_draft.js")).href);
const P = await import(pathToFileURL(join(WWW, "views", "live_aboard_pieces.js")).href);
const FU = await import(pathToFileURL(join(WWW, "views", "live_aboard_furniture.js")).href);

const failures = [];
const cases = {};
const timing = {};
const check = (name, ok, detail) => { cases[name] = !!ok; if (!ok) failures.push({ name, detail: detail === undefined ? null : detail }); };
const tryCase = async (name, fn) => {
  try { await fn(); } catch (e) { failures.push({ name, detail: String(e && e.stack || e).slice(0, 900) }); cases[name] = false; }
};
const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;
const rect = (floor_id, x0, y0, x1, y1) => ({ type: "poly", floor_id, points_m: [[x0, y0], [x1, y0], [x1, y1], [x0, y1]] });
const stair = (id, floor_id, x, y, w, d, rot, to) => ({ id, floor_id, x_m: x, y_m: y, rotation: rot,
  recipe: { kind: "stairs", width_m: w, depth_m: d, height_m: 2.8, params: { shape: "straight", to_floor: to } } });

// A house: Main at 0 (2.8 high), Upper at 2.8. Upstairs a hall, and an office
// and a den beside each other, both 0.75 m up. Downstairs a living room under
// the hall, and a step-down sunroom with nothing over it.
const house = () => ({
  floors: [{ id: "main", name: "Main", floor_to_floor_m: 2.8 }, { id: "upper", name: "Upper", floor_to_floor_m: 2.6 }],
  floor_elevations: { main: 0, upper: 2.8 },
  room_geometry_m: {
    Living: rect("main", 0, 0, 6, 5), Sun: rect("main", 6, 0, 10, 5),
    Hall: rect("upper", 0, 0, 4, 5), Office: rect("upper", 4, 0, 7, 5), Den: rect("upper", 7, 0, 10, 5),
  },
  room_meta: { Office: { floor_id: "upper", color: "#7c3aed", floor_raise_m: 0.75 }, Den: { floor_id: "upper", color: "#111111", floor_raise_m: 0.75 },
               Sun: { floor_id: "main", color: "#222222", floor_raise_m: -0.4 } },
  light_positions_m: { "light.office": { floor_id: "upper", x_m: 5, y_m: 2 }, "light.hall": { floor_id: "upper", x_m: 2, y_m: 2 },
                       "light.sun": { floor_id: "main", x_m: 8, y_m: 2 } },
  scanner_positions_m: { den: { floor_id: "upper", x_m: 8.5, y_m: 4 } },
});

// ── split ───────────────────────────────────────────────────────────────────
await tryCase("split: rooms raised alike share one level, and what is in them moves onto it", () => {
  const m = H.splitLevels(house());
  const up = m.floors.filter(f => f.parent_id === "upper");
  check("split: rooms raised alike share one level, and what is in them moves onto it",
    up.length === 1 && up[0].id === "upper~0.75" && near(m.floor_elevations["upper~0.75"], 3.55)
    && m.room_geometry_m.Office.floor_id === "upper~0.75" && m.room_geometry_m.Den.floor_id === "upper~0.75"
    && m.room_geometry_m.Hall.floor_id === "upper"
    && m.light_positions_m["light.office"].floor_id === "upper~0.75" && m.light_positions_m["light.hall"].floor_id === "upper"
    && m.scanner_positions_m.den.floor_id === "upper~0.75", { up, geo: m.room_geometry_m, lights: m.light_positions_m });
});
await tryCase("split: a ceiling stays level under a higher floor, and keeps its height under none", () => {
  const m = H.splitLevels(house());
  const office = m.floors.find(f => f.id === "upper~0.75"), sun = m.floors.find(f => f.id === "main~-0.4");
  // Nothing over Upper's office: its own full height. The den upstairs over the
  // sunroom: its ceiling stays put (0.4 m taller). With nothing over it, its own.
  const open = house(); delete open.room_geometry_m.Den; delete open.room_meta.Den;
  open.room_geometry_m.Office = rect("upper", 4, 0, 5.5, 5);
  const sun2 = H.splitLevels(open).floors.find(f => f.id === "main~-0.4");
  check("split: a ceiling stays level under a higher floor, and keeps its height under none",
    near(office.floor_to_floor_m, 2.6) && near(sun.floor_to_floor_m, 3.2) && near(sun2.floor_to_floor_m, 2.8)
    && near(m.floor_elevations["main~-0.4"], -0.4), { office, sun, sun2 });
});
await tryCase("split: a step-down room sits lower and stands on nothing", () => {
  const h = H.readHouse(H.splitLevels(house()), null, {}, new Set(), {});
  const sun = h.byId.get("main~-0.4");
  check("split: a step-down room sits lower and stands on nothing",
    sun && near(sun.elev0, -0.4) && sun.stem === 0 && sun.parent === "main" && h.rooms.find(r => r.name === "Sun").floor === sun, sun);
});
await tryCase("split: split twice is split once (the view redraws with the model it was given)", () => {
  const once = H.splitLevels(house()), twice = H.splitLevels(once);
  const h = H.readHouse(twice, null, {}, new Set(), {});
  check("split: split twice is split once (the view redraws with the model it was given)",
    twice === once && !twice.floors.some(f => /~.*~/.test(String(f.id))) && near(h.byId.get("upper~0.75").elev0, 3.55),
    twice.floors.map(f => f.id));
});
await tryCase("split: a model with no raised room comes back as it was", () => {
  const plain = house(); plain.room_meta = { Office: { floor_id: "upper", color: "#7c3aed" } };
  const tiny = house(); tiny.room_meta = { Office: { floor_id: "upper", color: "#7c3aed", floor_raise_m: 0.02 } };
  const unplaced = house(); delete unplaced.floor_elevations; unplaced.floors = unplaced.floors.map(f => ({ ...f }));
  const m3 = H.splitLevels(unplaced);
  check("split: a model with no raised room comes back as it was",
    H.splitLevels(plain) === plain && H.splitLevels(tiny) === tiny && H.splitLevels(null) === null
    && m3 === unplaced, { m3floors: m3 && m3.floors });
});

// ── floors ──────────────────────────────────────────────────────────────────
await tryCase("floors: the level shows with its floor, knows its rooms, and holds what stands in it", () => {
  const m = H.splitLevels(house());
  const F = H.readFloors(m, house().floors);
  const lvl = F.byId.get("upper~0.75"), upper = F.byId.get("upper");
  const top = H.topFloorElev(F.floors, ["upper"]), main = H.topFloorElev(F.floors, ["main"]);
  check("floors: the level shows with its floor, knows its rooms, and holds what stands in it",
    lvl && near(lvl.elev, 3.55) && near(lvl.chipElev, upper.elev) && lvl.areas.length === 2 && near(lvl.stem, 0.75)
    && H.floorShown(lvl, top) && !H.floorShown(lvl, main)
    && F.canonAt("upper", 5, 2) === "upper~0.75" && F.canonAt("upper", 8, 2) === "upper~0.75"
    && F.canonAt("upper", 2, 2) === "upper" && F.canonAt("upper", null, null) === "upper" && F.canonAt("main", 5, 2) === "main",
    { lvl, top, main });
});
await tryCase("floors: Explode lifts a level with its floor, not as a storey of its own", () => {
  const F = H.readFloors(H.splitLevels(house()), house().floors, 2);
  const g = (id) => F.byId.get(id);
  check("floors: Explode lifts a level with its floor, not as a storey of its own",
    near(g("main").elev, 0) && near(g("upper").elev, 4.8) && near(g("upper~0.75").elev, 5.55) && near(g("upper~0.75").chipElev, 4.8)
    && near(g("main~-0.4").elev, -0.4) && near(g("upper~0.75").elev0, 3.55),
    F.floors.map(f => [f.id, f.elev, f.chipElev]));
});

// ── stairs ──────────────────────────────────────────────────────────────────
await tryCase("stairs: a flight topping out in a raised room climbs into it and cuts its opening there", () => {
  const h = H.readHouse(H.splitLevels(house()), null, {}, new Set(), {});
  const pieces = { a: stair("a", "main", 5.5, 2.5, 1, 3, 0, "upper"), b: stair("b", "main", 2, 2.5, 1, 3, 0, "upper") };
  const ra = S.stairReach("main", "upper", h.floors, S.footprint(pieces.a)), rb = S.stairReach("main", "upper", h.floors, S.footprint(pieces.b));
  const cuts = S.stairCuts(pieces, h.floors, h.canon);
  // Standing in the sunken sunroom, to Upper's den (raised): 0.4 + 2.8 + 0.75.
  const rc = S.stairReach("main", "upper", h.floors, S.footprint(stair("c", "main", 8.5, 2.5, 1, 3, 0, "upper")));
  // No floor named: the next whole floor up, never the next split level.
  const rd = S.stairReach("main", null, h.floors, S.footprint(pieces.b));
  check("stairs: a flight standing in a sunken room starts from it; with none named, the next whole floor",
    rc.from.id === "main~-0.4" && rc.to.id === "upper~0.75" && near(rc.rise, 3.95, 1e-3) && rd.to.id === "upper",
    { rc: [rc.from.id, rc.to && rc.to.id, rc.rise], rd: rd.to && rd.to.id });
  check("stairs: a flight topping out in a raised room climbs into it and cuts its opening there",
    ra.to && ra.to.id === "upper~0.75" && near(ra.rise, 3.55, 1e-3) && rb.to && rb.to.id === "upper" && near(rb.rise, 2.8, 1e-3)
    && (cuts.get("upper~0.75") || []).length === 1 && (cuts.get("upper") || []).length === 1,
    { ra: [ra.to && ra.to.id, ra.rise], rb: [rb.to && rb.to.id, rb.rise], cuts: [...cuts.keys()] });
});

await tryCase("stairs: a few steps within a floor: up out of a sunken room, or up to a raised one, opening nothing", () => {
  const h = H.readHouse(H.splitLevels(house()), null, {}, new Set(), {});
  // In the sunroom (0.4 m down), climbing west into the living room: rotation 270 puts its top on the -x side.
  const garage = stair("g", "main", 6.6, 2.5, 1, 0.9, 270, "main");
  // In Upper's hall, climbing east into the office (0.75 m up): rotation 90.
  const loft = stair("l", "upper", 3.4, 2.5, 1, 1.2, 90, "upper");
  const rg = S.stairReach("main", "main", h.floors, S.footprint(garage)), rl = S.stairReach("upper", "upper", h.floors, S.footprint(loft));
  const cuts = S.stairCuts({ g: garage, l: loft }, h.floors, h.canon);
  // An id 0.38.190 could store for where a stair goes: read as its whole floor.
  const old = S.stairReach("main", "upper~0.75", h.floors, S.footprint(stair("a", "main", 5.5, 2.5, 1, 3, 0, "upper")));
  check("stairs: a few steps within a floor: up out of a sunken room, or up to a raised one, opening nothing",
    rg.within && rg.from.id === "main~-0.4" && rg.to.id === "main" && near(rg.rise, 0.4, 1e-3)
    && rl.within && rl.from.id === "upper" && rl.to.id === "upper~0.75" && near(rl.rise, 0.75, 1e-3)
    && cuts.size === 0 && old.to && old.to.id === "upper~0.75" && near(old.rise, 3.55, 1e-3),
    { rg: [rg.from && rg.from.id, rg.to && rg.to.id, rg.rise], rl: [rl.from && rl.from.id, rl.to && rl.to.id, rl.rise], cuts: [...cuts.keys()], old: old.to && old.to.id });
});

await tryCase("stairs: how a flight comes out, one rule for Furnish's warnings and the report", () => {
  const h = H.readHouse(H.splitLevels(house()), null, {}, new Set(), {});
  const floors = h.floors.map(f => ({ elev: f.elev, outdoor: f.outdoor, rooms: h.rooms.filter(r => r.floor === f) }));
  const out = (q) => P.stairOutcome(q, S.stairReach(h.canon(q.floor_id), q.recipe.params.to_floor, h.floors, S.footprint(q)), floors, FU, H.inPoly);
  // Into the raised office (top past y 1, inside it); into the hall; out past the house's edge; up from the sunroom.
  const office = out(stair("o", "main", 5.5, 2.5, 1, 3, 0, "upper"));
  const hall = out(stair("h", "main", 2, 2.5, 1, 3, 0, "upper"));
  const outside = out(stair("x", "main", 2, 0.4, 1, 3, 180, "upper"));     // its top past y = 5... turned to face out: lands beyond the rooms
  const sun = out(stair("g", "main", 6.6, 2.5, 1, 0.9, 270, "main"));
  const top = out(stair("t", "upper", 2, 2.5, 1, 3, 0, null));              // Upper is the top floor
  check("stairs: how a flight comes out, one rule for Furnish's warnings and the report",
    office === "ok" && hall === "ok" && sun === "ok" && top === "nofloor" && ["landing", "ok"].includes(outside)
    && P.stairOutcome(stair("n", "nowhere", 0, 0, 1, 1, 0, null), { from: null, to: null }, floors, FU, H.inPoly) === null,
    { office, hall, outside, sun, top });
});
await tryCase("stairs: a top that comes out in no room is a landing miss", () => {
  // One floor above with a single small room far from the flight.
  const m = { floors: [{ id: "main", name: "Main", floor_to_floor_m: 2.8 }, { id: "up", name: "Up", floor_to_floor_m: 2.6 }],
              floor_elevations: { main: 0, up: 2.8 }, room_geometry_m: { A: rect("main", 0, 0, 10, 10), B: rect("up", 8, 8, 10, 10) } };
  const h = H.readHouse(m, null, {}, new Set(), {});
  const floors = h.floors.map(f => ({ elev: f.elev, outdoor: f.outdoor, rooms: h.rooms.filter(r => r.floor === f) }));
  const q = stair("q", "main", 2, 5, 1, 3, 0, "up");
  const r = S.stairReach("main", "up", h.floors, S.footprint(q));
  check("stairs: a top that comes out in no room is a landing miss", P.stairOutcome(q, r, floors, FU, H.inPoly) === "landing", r);
});

// ── doors and windows ───────────────────────────────────────────────────────
// They go with their rooms: a raised room's windows and a sunken room's
// outside door are cut into the level's own walls; a door between a sunken
// room and a room of its floor stays a door in the floor's wall, and the
// level's wall gets a gap there (never a piece of its own); a barrier
// anywhere else stays where it was.
const barred = () => {
  const m = house();
  m.rf_barriers_m = [
    { id: "w1", floor_id: "upper", name: "Office window", material: "glass", points_m: [[4.6, 0], [6.2, 0]] },
    { id: "d1", floor_id: "main", name: "Garden door", material: "wood", points_m: [[10, 1.5], [10, 2.5]] },
    { id: "d2", floor_id: "main", name: "Sun door", material: "wood", points_m: [[6, 2], [6, 3]] },
    { id: "w2", floor_id: "main", name: "Living window", material: "glass", points_m: [[1, 0], [3, 0]] },
  ];
  return m;
};
await tryCase("doors: a raised room's windows and a sunken room's outside door are cut into the level's walls", () => {
  const m = H.splitLevels(barred()), by = Object.fromEntries(m.rf_barriers_m.map(b => [b.id, b]));
  const h = H.readHouse(m, null, {}, new Set(), {});
  const on = (fid, id) => h.perFloor.get(h.byId.get(fid)).pieces.filter(pc => pc.barrier && pc.barrier.id === id);
  const w1 = on("upper~0.75", "w1"), d1 = on("main~-0.4", "d1");
  check("doors: a raised room's windows and a sunken room's outside door are cut into the level's walls",
    by.w1.floor_id === "upper~0.75" && by.d1.floor_id === "main~-0.4" && by.w2.floor_id === "main"
    && w1.length >= 1 && w1.every(pc => pc.kind === "window" && !pc.free) && on("upper", "w1").length === 0
    && d1.length >= 1 && d1.every(pc => pc.kind === "door" && !pc.free) && on("main", "d1").length === 0
    && on("main", "w2").some(pc => pc.kind === "window" && !pc.free),
    { by, w1: w1.map(pc => [pc.kind, pc.free]), d1: d1.map(pc => [pc.kind, pc.free]) });
});
await tryCase("doors: a door between a sunken room and its floor stays a door, and the level's wall opens there", () => {
  const m = H.splitLevels(barred()), h = H.readHouse(m, null, {}, new Set(), {});
  const all = (fid) => h.perFloor.get(h.byId.get(fid)).pieces;
  const door = all("main").filter(pc => pc.barrier && pc.barrier.id === "d2");
  const gap = all("main~-0.4").filter(pc => pc.barrier && pc.barrier.split_of === "d2");
  const free = [...h.perFloor.values()].flatMap(v => v.pieces).filter(pc => pc.free && pc.barrier && pc.barrier.split_of);
  check("doors: a door between a sunken room and its floor stays a door, and the level's wall opens there",
    door.length >= 1 && door.every(pc => pc.kind === "door") && gap.length >= 1 && gap.every(pc => pc.kind === "doorway" && !pc.free)
    && gap.every(pc => near(pc.head_m, H.DOOR_H + 0.4, 1e-9))
    && free.length === 0 && m.rf_barriers_m.filter(b => b.split_of).length === 1 && barred().rf_barriers_m.length === 4
    && H.splitLevels(m) === m && H.splitLevels(m).rf_barriers_m.length === 5,
    { door: door.map(pc => pc.kind), gap: gap.map(pc => [pc.kind, pc.free]), free: free.length });
});

await tryCase("doors: a driveway is not the house, and a window by a neighbour's corner still goes with its room", () => {
  const m0 = barred();
  m0.room_geometry_m.Driveway = rect("main", 10, 0, 13, 5);
  m0.rf_barriers_m.push({ id: "w3", floor_id: "upper", name: "Office window by the hall", material: "glass", points_m: [[4.1, 0], [5.5, 0]] });
  const m = H.splitLevels(m0), by = Object.fromEntries(m.rf_barriers_m.map(b => [b.id, b]));
  const h = H.readHouse(m, null, {}, new Set(), {});
  const d1 = h.perFloor.get(h.byId.get("main~-0.4")).pieces.filter(pc => pc.barrier && pc.barrier.id === "d1");
  check("doors: a driveway is not the house, and a window by a neighbour's corner still goes with its room",
    by.d1.floor_id === "main~-0.4" && !m.rf_barriers_m.some(b => b.split_of === "d1") && d1.length >= 1 && d1.every(pc => pc.kind === "door" && !pc.free)
    && by.w3.floor_id === "upper~0.75", { d1: by.d1, w3: by.w3 });
});
await tryCase("doors: between two levels of one floor, both walls are cut; a raised room's doorway is never railed", () => {
  const m0 = barred();
  m0.room_meta.Den = { floor_id: "upper", color: "#111111", floor_raise_m: 1.2 };
  m0.room_meta.Office = { floor_id: "upper", color: "#7c3aed", floor_raise_m: 1.2 };
  m0.room_meta.Den.floor_raise_m = 0.4;
  m0.rf_barriers_m.push({ id: "d3", floor_id: "upper", name: "Office to den door", material: "wood", points_m: [[7, 2], [7, 3]] },
                        { id: "d4", floor_id: "upper", name: "Hall to office door", material: "wood", points_m: [[4, 2], [4, 3]] });
  const m = H.splitLevels(m0), h = H.readHouse(m, null, {}, new Set(), {});
  const on = (fid, f) => h.perFloor.get(h.byId.get(fid)).pieces.filter(f);
  const d3 = ["upper~1.2", "upper~0.4"].map(fid => on(fid, pc => pc.barrier && (pc.barrier.id === "d3" || pc.barrier.split_of === "d3")).map(pc => pc.kind));
  const gap4 = on("upper~1.2", pc => pc.barrier && pc.barrier.split_of === "d4"), door4 = on("upper", pc => pc.barrier && pc.barrier.id === "d4");
  check("doors: between two levels of one floor, both walls are cut; a raised room's doorway is never railed",
    d3[0].length >= 1 && d3[1].length >= 1 && d3.flat().includes("door") && d3.flat().includes("doorway")
    // The hall's door into the office (raised 1.2 m): its gap runs from the door's sill (1.2 m down
    // the office's stem) to the door's top, measured from the hall (round 3 review, 2026-10-29).
    && gap4.length >= 1 && gap4.every(pc => pc.kind === "doorway" && !pc.loftRail && !pc.free
                                     && near(pc.head_m, H.DOOR_H - 1.2, 1e-9) && near(pc.foot_m, -1.2, 1e-9))
    && door4.some(pc => pc.kind === "door"),
    { d3, gap4: gap4.map(pc => [pc.kind, !!pc.loftRail]), door4: door4.map(pc => pc.kind) });
});
await tryCase("doors: doors and windows drawn in 3D go back onto their room's level after a save", () => {
  const h = H.readHouse(H.splitLevels(house()), null, {}, new Set(), {});
  D.applyOpenings(h, { win_0000abcd: { floor_id: "upper", a_m: [4.6, 0], b_m: [6.2, 0] },
                       door_0000abcd: { floor_id: "main", a_m: [10, 1.5], b_m: [10, 2.5] },
                       door_0000abce: { floor_id: "main", a_m: [6, 2], b_m: [6, 3] } });
  const on = (fid, f) => h.perFloor.get(h.byId.get(fid)).pieces.filter(f);
  const win = on("upper~0.75", pc => pc.added === "win_0000abcd"), garden = on("main~-0.4", pc => pc.added === "door_0000abcd");
  const sunDoor = on("main", pc => pc.added === "door_0000abce"), sunGap = on("main~-0.4", pc => pc.gap && pc.kind === "doorway");
  const loose = [...h.perFloor.values()].flatMap(v => v.pieces).filter(pc => pc.free && (pc.added || pc.gap));
  check("doors: doors and windows drawn in 3D go back onto their room's level after a save",
    win.length >= 1 && win.every(pc => pc.kind === "window") && garden.length >= 1 && garden.every(pc => pc.kind === "door")
    && sunDoor.some(pc => pc.kind === "door") && sunGap.length >= 1 && sunGap.every(pc => !pc.added) && loose.length === 0
    && on("upper", pc => pc.added === "win_0000abcd").length === 0,
    { win: win.length, garden: garden.length, sunDoor: sunDoor.map(pc => pc.kind), sunGap: sunGap.length, loose: loose.length });
});
await tryCase("split: the doors and windows split once per list; positions and raises changed in place are read again", () => {
  const m0 = barred(), a = H.splitLevels(m0), b = H.splitLevels(m0);
  // A scanner moved in place (calibration.js does): read again, not kept.
  m0.scanner_positions_m.den.x_m = 9.5;
  const c = H.splitLevels(m0);
  m0.room_meta.Office.floor_raise_m = 1.0;
  const d = H.splitLevels(m0);
  m0.rf_barriers_m[0].points_m = [[4.7, 0], [6.1, 0]];
  const e = H.splitLevels(m0);
  check("split: the doors and windows split once per list; positions and raises changed in place are read again",
    a.rf_barriers_m === b.rf_barriers_m && c.scanner_positions_m.den.x_m === 9.5 && c.rf_barriers_m === a.rf_barriers_m
    && d.room_geometry_m.Office.floor_id === "upper~1" && d.rf_barriers_m.find(x => x.id === "w1").floor_id === "upper~1"
    && e.rf_barriers_m !== d.rf_barriers_m && e.rf_barriers_m.find(x => x.id === "w1").points_m[0][0] === 4.7,
    { c: c.scanner_positions_m.den, d: d.rf_barriers_m.find(x => x.id === "w1").floor_id });
});
await tryCase("doors: a door with one end past its room's corner is placed by its middle; an Open edge to a raised room keeps its rail", () => {
  const m0 = barred();
  // The sunroom (sunk) and the living room meet along x = 6, y 0..5; a door from y 4.3 to 5.35 runs 0.35 m past that corner.
  m0.rf_barriers_m.push({ id: "d5", floor_id: "main", name: "Mudroom door", material: "wood", points_m: [[6, 4.3], [6, 5.35]] });
  m0.room_meta.Office = { floor_id: "upper", color: "#7c3aed", floor_raise_m: 1.2 };
  m0.room_meta.Den = { floor_id: "upper", color: "#111111", floor_raise_m: 1.2 };
  m0.rf_barriers_m.push({ id: "o1", floor_id: "upper", name: "Gallery", material: "open", points_m: [[4, 0.5], [4, 4.5]] });
  const m = H.splitLevels(m0), h = H.readHouse(m, null, {}, new Set(), {});
  const on = (fid, f) => h.perFloor.get(h.byId.get(fid)).pieces.filter(f);
  const d5 = on("main", pc => pc.barrier && pc.barrier.id === "d5"), g5 = on("main~-0.4", pc => pc.barrier && pc.barrier.split_of === "d5");
  const o1 = on("upper~1.2", pc => pc.barrier && pc.barrier.split_of === "o1");
  check("doors: a door with one end past its room's corner is placed by its middle; an Open edge to a raised room keeps its rail",
    d5.some(pc => pc.kind === "door") && g5.length >= 1 && g5.every(pc => pc.kind === "doorway")
    && o1.length >= 1 && o1.every(pc => pc.kind === "open") && o1.some(pc => pc.loftRail),
    { d5: d5.map(pc => pc.kind), g5: g5.map(pc => pc.kind), o1: o1.map(pc => [pc.kind, !!pc.loftRail]) });
});
await tryCase("doors: a door drawn on a level's wall before a save opens the floor's wall too; the gap is as high as the door", () => {
  const h = H.readHouse(H.splitLevels(house()), null, {}, new Set(), {});
  D.applyOpenings(h, { door_0000abcf: { floor_id: "main~-0.4", a_m: [6, 2], b_m: [6, 3] } });
  const on = (fid, f) => h.perFloor.get(h.byId.get(fid)).pieces.filter(f);
  const door = on("main", pc => pc.added === "door_0000abcf"), gap = on("main~-0.4", pc => pc.gap);
  const lvl = h.byId.get("main~-0.4"), els = gap.length ? H.wallElements(gap[0], lvl.h) : [];
  check("doors: a door drawn on a level's wall before a save opens the floor's wall too; the gap is as high as the door",
    door.some(pc => pc.kind === "door") && gap.length >= 1 && gap.every(pc => pc.kind === "doorway" && near(pc.head_m, H.DOOR_H + 0.4, 1e-9))
    && els.some(e => near(e.z0, Math.min(H.DOOR_H + 0.4, e.z0), 1e-9) && e.z0 >= H.DOOR_H + 0.4 - 1e-6),
    { door: door.map(pc => pc.kind), gap: gap.map(pc => [pc.kind, pc.head_m]), els: els.map(e => [e.z0, e.z1]) });
});

// Round 3 review (2026-10-29): a raised room's doorway as high as the door; a long
// gallery along the floor and a raised room; a door at an outside corner; a
// window with a sensor; a barrier renamed in place.
await tryCase("doors: a raised room's doorway runs from the door's sill to its top, down the wall it stands on", () => {
  const res = [];
  for (const raise of [0.75, 1.2, 2.3]) {        // 0.75: Garry's office; 2.3: raised past the door's top
    const m0 = barred();
    m0.room_meta.Office = { floor_id: "upper", color: "#7c3aed", floor_raise_m: raise };
    delete m0.room_meta.Den;
    m0.rf_barriers_m.push({ id: "d6", floor_id: "upper", name: "Hall to office door", material: "wood", points_m: [[4, 2], [4, 3]] });
    const m = H.splitLevels(m0), h = H.readHouse(m, null, {}, new Set(), {});
    const lvl = h.byId.get(`upper~${raise}`);
    const gap = lvl ? h.perFloor.get(lvl).pieces.filter(pc => pc.barrier && pc.barrier.split_of === "d6") : [];
    const door = h.perFloor.get(h.byId.get("upper")).pieces.filter(pc => pc.barrier && pc.barrier.id === "d6");
    const els = gap.length ? H.wallElements(gap[0], lvl.h) : [];
    // From the level's floor: the door's sill is at -raise, its top at DOOR_H - raise.
    const sill = -raise, topDoor = H.DOOR_H - raise;
    const blocked = els.some(e => e.z0 < topDoor - 1e-6 && e.z1 > sill + 1e-6);
    const over = els.some(e => near(e.z0, topDoor, 1e-6) && e.z1 > topDoor);
    const under = els.some(e => near(e.z1, sill, 1e-6) && e.z0 < sill);           // the hall's slab edge under the sill
    res.push({ raise, n: gap.length, door: door.map(pc => pc.kind), blocked, over, under, head: gap[0] && gap[0].head_m,
               foot: gap[0] && gap[0].foot_m, els: els.map(e => [+e.z0.toFixed(3), +e.z1.toFixed(3)]) });
  }
  check("doors: a raised room's doorway runs from the door's sill to its top, down the wall it stands on",
    res.every(r => r.n >= 1 && r.door.includes("door") && !r.blocked && r.over && r.under
                   && near(r.head, H.DOOR_H - r.raise, 1e-9) && near(r.foot, -r.raise, 1e-9)), res);
});
await tryCase("doors: a gallery along the floor and a raised room stays open along the floor, railed as before, and opens the raised room's wall", () => {
  const mk = (raised) => {
    const m0 = barred();
    if (raised) m0.room_meta.Office = { floor_id: "upper", color: "#7c3aed", floor_raise_m: 1.2 }; else delete m0.room_meta.Office;
    delete m0.room_meta.Den;
    // Along the north edge of the hall (x 0..4) and the office (x 4..7).
    m0.rf_barriers_m.push({ id: "o2", floor_id: "upper", name: "Gallery", material: "open", points_m: [[2, 5], [7, 5]] });
    const m = H.splitLevels(m0);
    return { m, h: H.readHouse(m, null, {}, new Set(), {}) };
  };
  const A = mk(true), B = mk(false);
  const on = (X, fid, f) => X.h.perFloor.get(X.h.byId.get(fid)).pieces.filter(f);
  const alongHall = (pc) => Math.abs(pc.y0 - 5) < 0.2 && Math.abs(pc.y1 - 5) < 0.2 && Math.min(pc.x0, pc.x1) < 3.9 && Math.max(pc.x0, pc.x1) > 2.1;
  const hallA = on(A, "upper", pc => alongHall(pc) && Math.min(pc.x0, pc.x1) >= 1.99 && Math.max(pc.x0, pc.x1) <= 4.01);
  const hallB = on(B, "upper", pc => alongHall(pc) && pc.barrier && pc.barrier.id === "o2" && Math.max(pc.x0, pc.x1) <= 4.01);
  const gapA = on(A, "upper~1.2", pc => pc.barrier && pc.barrier.split_of === "o2");
  const by = Object.fromEntries(A.m.rf_barriers_m.map(b => [b.id, b]));
  check("doors: a gallery along the floor and a raised room stays open along the floor, railed as before, and opens the raised room's wall",
    by.o2.floor_id === "upper" && hallA.length >= 1 && hallA.every(pc => pc.kind === "open")
    && gapA.length >= 1 && gapA.every(pc => pc.kind === "open")
    && hallA.map(pc => !!pc.loftRail).join() === hallB.map(pc => !!pc.loftRail).join(),
    { o2: by.o2.floor_id, hallA: hallA.map(pc => [pc.kind, !!pc.loftRail]), hallB: hallB.map(pc => [pc.kind, !!pc.loftRail]), gapA: gapA.map(pc => pc.kind) });
});
await tryCase("doors: a door at an outside corner goes whole with the room whose wall it is in", () => {
  const m0 = barred();
  // The sunroom (sunk 0.4 m) starts at x = 6 along the south wall; a side door from x 5.8 to 6.7 starts 0.2 m before it.
  m0.rf_barriers_m.push({ id: "d7", floor_id: "main", name: "Side door", material: "wood", points_m: [[5.8, 0], [6.7, 0]] });
  const m = H.splitLevels(m0), by = Object.fromEntries(m.rf_barriers_m.map(b => [b.id, b]));
  const h = H.readHouse(m, null, {}, new Set(), {});
  const on = (fid) => h.perFloor.get(h.byId.get(fid)).pieces.filter(pc => pc.barrier && (pc.barrier.id === "d7" || pc.barrier.split_of === "d7"));
  const lvl = on("main~-0.4"), floor = on("main");
  check("doors: a door at an outside corner goes whole with the room whose wall it is in",
    by.d7.floor_id === "main~-0.4" && !m.rf_barriers_m.some(b => b.split_of === "d7")
    && lvl.length >= 1 && lvl.every(pc => pc.kind === "door" && !pc.free) && floor.length === 0,
    { d7: by.d7.floor_id, lvl: lvl.map(pc => [pc.kind, pc.free]), floor: floor.map(pc => pc.kind) });
});
await tryCase("doors: a window with a sensor between a raised room and its floor stays a window; no doorway is cut", () => {
  const m0 = barred();
  m0.room_meta.Office = { floor_id: "upper", color: "#7c3aed", floor_raise_m: 1.2 };
  delete m0.room_meta.Den;
  m0.rf_barriers_m.push({ id: "w4", floor_id: "upper", name: "Office window", material: "glass", linked_entity_id: "binary_sensor.office_window",
                         points_m: [[4, 1], [4, 1.8]] });
  const m = H.splitLevels(m0), by = Object.fromEntries(m.rf_barriers_m.map(b => [b.id, b]));
  check("doors: a window with a sensor between a raised room and its floor stays a window; no doorway is cut",
    by.w4.floor_id === "upper" && !m.rf_barriers_m.some(b => b.split_of === "w4"), { w4: by.w4.floor_id, gaps: m.rf_barriers_m.filter(b => b.split_of === "w4").length });
});
await tryCase("doors: glass doors with a door sensor between a raised room and its floor are a door; the room's wall opens", () => {
  const m0 = barred();
  m0.room_meta.Office = { floor_id: "upper", color: "#7c3aed", floor_raise_m: 1.2 };
  delete m0.room_meta.Den;
  m0.rf_barriers_m.push({ id: "d8", floor_id: "upper", name: "Office French doors", material: "glass", linked_entity_id: "binary_sensor.office_french_door",
                         points_m: [[4, 1], [4, 2.4]] },
                        { id: "d9", floor_id: "upper", name: "Office slider", material: "glass", linked_entity_id: "lock.office_slider",
                         points_m: [[4, 3], [4, 4.2]] });
  const m = H.splitLevels(m0), by = Object.fromEntries(m.rf_barriers_m.map(b => [b.id, b]));
  const gaps = (id) => m.rf_barriers_m.filter(b => b.split_of === id);
  check("doors: glass doors with a door sensor between a raised room and its floor are a door; the room's wall opens",
    by.d8.floor_id === "upper" && gaps("d8").length === 1 && gaps("d8")[0].floor_id === "upper~1.2" && near(gaps("d8")[0].split_head_m, H.DOOR_H - 1.2, 1e-9)
    && by.d9.floor_id === "upper" && gaps("d9").length === 1,
    { d8: by.d8.floor_id, g8: gaps("d8").map(g => [g.floor_id, g.split_head_m]), g9: gaps("d9").length });
});
await tryCase("doors: a door drawn in 3D between a raised room and its floor: the room's wall opens from the door's sill to its top", () => {
  const h = H.readHouse(H.splitLevels(house()), null, {}, new Set(), {});
  // Drawn on the office's wall (upper~0.75) before a save: placed from its whole floor.
  D.applyOpenings(h, { door_0000abd0: { floor_id: "upper~0.75", a_m: [4, 2], b_m: [4, 3] } });
  const on = (fid, f) => h.perFloor.get(h.byId.get(fid)).pieces.filter(f);
  const door = on("upper", pc => pc.added === "door_0000abd0"), gap = on("upper~0.75", pc => pc.gap);
  const lvl = h.byId.get("upper~0.75"), els = gap.length ? H.wallElements(gap[0], lvl.h) : [];
  const sill = -0.75, top = H.DOOR_H - 0.75;
  check("doors: a door drawn in 3D between a raised room and its floor: the room's wall opens from the door's sill to its top",
    door.some(pc => pc.kind === "door") && gap.length >= 1
    && gap.every(pc => pc.kind === "doorway" && near(pc.head_m, H.DOOR_H - 0.75, 1e-9) && near(pc.foot_m, -0.75, 1e-9))
    && !els.some(e => e.z0 < top - 1e-6 && e.z1 > sill + 1e-6) && els.some(e => near(e.z0, top, 1e-6)),
    { door: door.map(pc => pc.kind), gap: gap.map(pc => [pc.kind, pc.head_m, pc.foot_m]), els: els.map(e => [+e.z0.toFixed(3), +e.z1.toFixed(3)]) });
});
await tryCase("split: a barrier renamed or given another material in place, even one as long, is split again", () => {
  const m0 = barred();
  m0.room_meta.Office = { floor_id: "upper", color: "#7c3aed", floor_raise_m: 1.2 };
  delete m0.room_meta.Den;
  m0.rf_barriers_m.push({ id: "x1", floor_id: "upper", name: "Hall to office", material: "brick", points_m: [[4, 2], [4, 3]] });
  const a = H.splitLevels(m0);
  m0.rf_barriers_m[m0.rf_barriers_m.length - 1].name = "Hall to office door";       // a wall becomes a door: a gap opens
  const b = H.splitLevels(m0);
  m0.rf_barriers_m[0].material = "brick";                                          // the office window, "glass" to "brick": as long
  const c = H.splitLevels(m0);
  check("split: a barrier renamed or given another material in place, even one as long, is split again",
    !a.rf_barriers_m.some(x => x.split_of === "x1") && b.rf_barriers_m !== a.rf_barriers_m && b.rf_barriers_m.some(x => x.split_of === "x1")
    && c.rf_barriers_m !== b.rf_barriers_m && c.rf_barriers_m.find(x => x.id === "w1").material === "brick",
    { a: a.rf_barriers_m.filter(x => x.split_of).map(x => x.id), b: b.rf_barriers_m.filter(x => x.split_of).map(x => x.id) });
});

// ── stem ────────────────────────────────────────────────────────────────────
await tryCase("stem: a raised level stands on a wall down to its floor; a sunken one does not", () => {
  const h = H.readHouse(H.splitLevels(house()), null, {}, new Set(), {});
  const lvl = h.byId.get("upper~0.75"), sun = h.byId.get("main~-0.4");
  const pcs = h.perFloor.get(lvl).pieces.filter(pc => pc.kind !== "rail");
  const stems = pcs.map(pc => H.wallElements(pc, lvl.h).filter(e => near(e.z0, -H.SLAB_T - 0.75) && near(e.z1, -H.SLAB_T)).length);
  const sunStem = h.perFloor.get(sun).pieces.some(pc => pc.stem > 0);
  const hallStem = h.perFloor.get(h.byId.get("upper")).pieces.some(pc => pc.stem > 0);
  check("stem: a raised level stands on a wall down to its floor; a sunken one does not",
    pcs.length > 0 && stems.every(n => n === 1) && !sunStem && !hallStem, { n: pcs.length, stems, sunStem, hallStem });
});

await tryCase("stem: the storey's floor is open over a sunken room, and a raised room is roofed at its own top", () => {
  const top = house(); top.room_geometry_m = { Living: rect("main", 0, 0, 6, 5), Sun: rect("main", 6, 0, 10, 5), Loft: rect("main", 10, 0, 13, 5) };
  top.room_meta = { Sun: { floor_id: "main", color: "#222222", floor_raise_m: -0.4 }, Loft: { floor_id: "main", color: "#333333", floor_raise_m: 0.6 } };
  top.floors = [top.floors[0]]; top.floor_elevations = { main: 0 }; top.light_positions_m = {}; top.scanner_positions_m = {};
  const h = H.readHouse(H.splitLevels(top), null, {}, new Set(), {});
  const hm = S.houseModel(h), st = hm.storeys[0];
  const inFloor = (x, y) => st.shapes.some(sh => S.inside(x, y, sh.outer) && !sh.holes.some(q => S.inside(x, y, q)));
  check("stem: the storey's floor is open over a sunken room, and a raised room is roofed at its own top",
    hm.storeys.length === 1 && inFloor(3, 2.5) && !inFloor(8, 2.5) && near(st.reach, 0.6 + 2.8),
    { n: hm.storeys.length, reach: st.reach, tiers: st.tiers.map(t => t.top) });
});

await tryCase("floors: a split level is drawn, never stored: a save names its whole floor", () => {
  const ch = { pieces: { a: { floor_id: "upper~0.75", x_m: 5 }, b: { floor_id: "main" }, c: null },
               openings: { o: { floor_id: "main~-0.4" } }, heights_set: ["light.x"] };
  const out = H.wholeFloors(ch);
  check("floors: a split level is drawn, never stored: a save names its whole floor",
    out.pieces.a.floor_id === "upper" && out.pieces.a.x_m === 5 && out.pieces.b.floor_id === "main" && out.pieces.c === null
    && out.openings.o.floor_id === "main" && out.heights_set[0] === "light.x" && ch.pieces.a.floor_id === "upper~0.75"
    && H.wholeFloorId("upper~0.75") === "upper" && H.wholeFloorId("main") === "main", out);
});

// ── big ─────────────────────────────────────────────────────────────────────
// A gigantic house: 6 floors of 12 × 10 rooms (720 rooms, 3 m squares), a
// light in each, every fifth room raised or sunk (one of 4 amounts), and 60
// stairs, each topping out in a room whose level is known.
const gigantic = (withRaise) => {
  const floors = [], elev = {}, geo = {}, meta = {}, lights = {}, pieces = {}, want = {}, bars = [];
  const amounts = [0.45, 0.75, -0.3, 1.2];
  for (let k = 0; k < 6; k++) {
    const fid = `f${k}`;
    floors.push({ id: fid, name: `Floor ${k}`, floor_to_floor_m: 3 });
    elev[fid] = 3 * k;
    for (let i = 0; i < 12; i++) for (let j = 0; j < 10; j++) {
      const n = `R${k}_${i}_${j}`, x = i * 3, y = j * 3;
      geo[n] = rect(fid, x, y, x + 3, y + 3);
      lights[`light.${n}`] = { floor_id: fid, x_m: x + 1.5, y_m: y + 1.5 };
      // Four doors and windows each (2,880 in all), one on each side.
      bars.push({ id: `w_${n}_s`, floor_id: fid, name: "Window", material: "glass", points_m: [[x + 1, y], [x + 2, y]] },
                { id: `w_${n}_n`, floor_id: fid, name: "Window", material: "glass", points_m: [[x + 1, y + 3], [x + 2, y + 3]] },
                { id: `d_${n}_e`, floor_id: fid, name: "Door", material: "wood", points_m: [[x + 3, y + 1], [x + 3, y + 2]] },
                { id: `d_${n}_w`, floor_id: fid, name: "Door", material: "wood", points_m: [[x, y + 1], [x, y + 2]] });
      const a = amounts[(i + j + k) % 4];
      if (withRaise && (i * 10 + j) % 5 === 0) meta[n] = { floor_id: fid, color: "#335577", floor_raise_m: a };
    }
  }
  // Stairs from floor k to k+1, a 1 × 2.4 m flight inside room (i, j) of the floor above.
  for (let s = 0; s < 60; s++) {
    const k = s % 5, i = (s * 7) % 12, j = (s * 3) % 10, top = `R${k + 1}_${i}_${j}`;
    pieces[`st${s}`] = stair(`st${s}`, `f${k}`, i * 3 + 1.5, j * 3 + 1.5, 1, 2.4, 0, `f${k + 1}`);
    const r = meta[top] ? meta[top].floor_raise_m : 0;
    // It starts in room (i, j) of floor k: raised too, it starts that much higher.
    const r0 = meta[`R${k}_${i}_${j}`] ? meta[`R${k}_${i}_${j}`].floor_raise_m : 0;
    want[`st${s}`] = { to: r ? `f${k + 1}~${r}` : `f${k + 1}`, rise: 3 + r - r0 };
  }
  return { model: { floors, floor_elevations: elev, room_geometry_m: geo, room_meta: meta, light_positions_m: lights, rf_barriers_m: bars },
           pieces, want };
};
await tryCase("big: a gigantic house with split levels reads in good time, every stair to the right level", () => {
  const time = (fn, n = 3) => { let best = Infinity, out; for (let i = 0; i < n; i++) { const t = performance.now(); out = fn(); best = Math.min(best, performance.now() - t); } return [best, out]; };
  const plain = gigantic(false), split = gigantic(true);
  const [tPlain] = time(() => H.readHouse(H.splitLevels(plain.model), plain.model.floors, {}, new Set(), {}));
  const [tSplit, h] = time(() => H.readHouse(H.splitLevels(split.model), split.model.floors, {}, new Set(), {}));
  const [tCuts, cuts] = time(() => S.stairCuts(split.pieces, h.floors, h.canon));
  // The split alone, a fresh model each time (never the cache), and the same model again (the cache).
  const [tSplitOnly, sm] = time(() => H.splitLevels({ ...split.model, rf_barriers_m: split.model.rf_barriers_m.slice() }), 5);
  const [tAgain, again] = time(() => H.splitLevels(split.model), 5);
  const moved = sm.rf_barriers_m.filter(b => b.floor_id.includes("~")).length;
  // One storey (one floor, one roof) per whole floor, never one per raised room.
  const [tModel, hm] = time(() => S.houseModel(h, cuts), 1);
  const [tModel0] = time(() => S.houseModel(H.readHouse(plain.model, plain.model.floors, {}, new Set(), {})), 1);
  const levels = h.floors.filter(f => f.parent).length;
  const wrong = Object.entries(split.pieces).map(([k, p]) => {
    const r = S.stairReach(h.canon(p.floor_id), p.recipe.params.to_floor, h.floors, S.footprint(p));
    return [k, r.to && r.to.id, r.rise, split.want[k]];
  }).filter(([, to, rise, w]) => to !== w.to || !near(rise, w.rise, 1e-3));
  const m = H.splitLevels(split.model);
  const lightsOff = Object.entries(m.light_positions_m).filter(([eid, lp]) => {
    const n = eid.slice(6), r = split.model.room_meta[n];
    return lp.floor_id !== (r ? `${split.model.room_geometry_m[n].floor_id}~${r.floor_raise_m}` : split.model.room_geometry_m[n].floor_id);
  }).length;
  Object.assign(timing, { rooms: Object.keys(split.model.room_geometry_m).length, raised: Object.keys(split.model.room_meta).length,
                          levels, plain_ms: Math.round(tPlain), split_ms: Math.round(tSplit), cuts_ms: Math.round(tCuts),
                          shell_plain_ms: Math.round(tModel0), shell_split_ms: Math.round(tModel), storeys: hm.storeys.length,
                          barriers: split.model.rf_barriers_m.length, split_only_ms: +tSplitOnly.toFixed(2), split_again_ms: +tAgain.toFixed(2), moved });
  check("big: a gigantic house with split levels reads in good time, every stair to the right level",
    levels === 24 && hm.storeys.length === 6 && tModel < Math.max(3000, tModel0 * 2) && wrong.length === 0 && lightsOff === 0 && cuts.size > 0
    && tSplit < Math.max(4000, tPlain * 3) && tCuts < 500 && tSplitOnly < Math.max(12, tPlain / 5) && tAgain < tSplitOnly && moved > 0
    && again.rf_barriers_m === H.splitLevels(split.model).rf_barriers_m,
    { timing, wrong: wrong.slice(0, 5), lightsOff });
});

console.log(JSON.stringify({ cases, failures, timing }));
process.exit(0);
