// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
//
// "Put it on the map" (views/wizard_build.js), run for real with the real
// Tune planner (tune_save_plan.js) and conversions (stack_transform.js):
// what a traced floor plan has that the fabric lacks, and that only those
// pieces are written, the way Mapping → Rooms and Calibration → Tune write.
// maps.js reads the plan and plans the pins; here that part is a stand-in
// built from the same planner calls.
//
// usage: wizard_build.mjs <www/padspan-ha dir>
// prints one JSON line: { cases: {name: result}, failures: [...] }

import { pathToFileURL } from "node:url";
import { join } from "node:path";
import { install } from "./dom_shim.mjs";

const WWW = process.argv[2];
if (!WWW) { console.error("usage: wizard_build.mjs <www/padspan-ha dir>"); process.exit(2); }
install(globalThis);

const WB = await import(pathToFileURL(join(WWW, "views", "wizard_build.js")).href);
const TSP = await import(pathToFileURL(join(WWW, "views", "tune_save_plan.js")).href);
const ST = await import(pathToFileURL(join(WWW, "views", "stack_transform.js")).href);
TSP.tuneSavePlanInit({ mapFracToMetres: ST.mapFracToMetres, metresToMapFrac: ST.metresToMapFrac });

const failures = [];
const cases = {};
const check = (name, ok, detail) => { cases[name] = !!ok; if (!ok) failures.push({ name, detail: detail === undefined ? null : detail }); };

const tf = { origin_x_m: 1, origin_y_m: 2, scale_x_m: 12, scale_y_m: 9, rotation_rad: 0, shear_rad: 0,
             floor_id: "main", reference_measurements: [{ distance_m: 3 }] };
const map = {
  id: "m1", floor_id: "main", name: "Ground floor",
  room_bounds: { Kitchen: [[0, 0], [0.5, 0], [0.5, 0.5]], Hall: [[0.5, 0], [1, 0], [1, 0.5]], Den: [[0, 0.5], [0.5, 0.5], [0.5, 1]], Study: [[0, 0], [0.1, 0], [0.1, 0.1]] },
  receivers: [
    { id: "r1", label: "Kitchen proxy", x: 0.25, y: 0.25, room: "Kitchen", source: "AA:01" },   // already in the fabric
    { id: "r2", label: "Hall proxy", x: 0.75, y: 0.25, room: "Hall", source: "AA:02" },
    { id: "r2b", label: "Hall proxy again", x: 0.70, y: 0.20, room: "Hall", source: "AA:02" },   // same scanner twice
    { id: "r3", label: "Unbound pin", x: 0.5, y: 0.9, room: "Den", source: "" },              // no scanner behind it
  ],
};
const model = {
  room_geometry_m: { Kitchen: { floor_id: "main", type: "poly", points_m: [[1, 2], [7, 2], [7, 6.5]] } },
  scanner_positions_m: { "AA:01": { x_m: 4, y_m: 4.25, z_m: 2.1, floor_id: "main" } },
  map_transforms: { m1: tf },
};

// What maps.js reads off the plan (the editor's job) and hands in.
const tracedOf = (m, mdl) => ({
  mapId: m.id, floorId: m.floor_id || "main",
  rooms: Object.keys(m.room_bounds || {}),
  scanners: (m.receivers || []).map(r => r && r.source).filter(Boolean),
  readable: TSP.tunePlacementReadable(((mdl || {}).map_transforms || {})[m.id]),
});
// maps.js's planPins, over a list of plans, as it plans them.
const pinsOver = (maps, self, mdl) => (sources) => {
  const all = [], invalid = [];
  let refused = false;
  for (const m of maps) {
    const rows = (m.receivers || []).filter(r => r && sources.includes(r.source));
    if (!rows.length) continue;
    const base = Object.fromEntries(rows.map(r => [r.source, { x: r.x, y: r.y }]));
    const p = TSP.tuneDiffMapDraft(m, rows, mdl.scanner_positions_m || {}, mdl.map_transforms || {}, base, true);
    if (!p || p.refused) { if (m.id === self.id) refused = true; continue; }
    all.push(...p.writes.map(w => ({ ...w, _map: m.id })));
    invalid.push(...(p.invalid || []));
  }
  const bad = new Set(TSP.tuneConflictingSources(all));
  return { writes: all.filter(w => w._map === self.id && !bad.has(w.source)).map(({ _map, ...w }) => w), invalid: [...new Set([...invalid, ...bad])], refused };
};

// ── what is missing ──────────────────────────────────────────────────────────
const plan = WB.planHouse(tracedOf(map, model), model);
check("missing rooms: the ones the fabric lacks", JSON.stringify(plan.rooms) === JSON.stringify(["Hall", "Den", "Study"]), plan.rooms);
check("missing scanners: once each, only real ones the fabric lacks", JSON.stringify(plan.scanners) === JSON.stringify(["AA:02"]), plan.scanners);
check("a placement that converts", plan.readable === true);
check("one that doesn't (no placement, or zero width)", WB.planHouse(tracedOf(map, { map_transforms: {} }), model).readable === false
  && WB.planHouse(tracedOf(map, { map_transforms: { m1: { ...tf, scale_x_m: 0 } } }), model).readable === false);
check("nothing to plan from nothing", (() => { const p = WB.planHouse(null, null); return !p.readable && !p.rooms.length && !p.scanners.length; })());

// ── the writes ───────────────────────────────────────────────────────────────
const mkCtx = (mdl, cands, opts = {}) => {
  const calls = [];
  const ctx = {
    state: { model: mdl },
    actions: { wsCall: async (type, data) => {
      calls.push([type, data]);
      if (opts.failOn && opts.failOn(type, data)) throw new Error("refused");
      if (type === "padspan_ha/fabric_truth_candidates") return { floor_id: data.floor_id, transforms: { rooms: cands }, fabric: { rooms: opts.serverFabric || {} } };
      return { ok: true };
    } },
  };
  return { calls, ctx };
};
const cands = {
  Kitchen: { type: "poly", points_m: [[9, 9], [10, 9], [10, 10]], source_map_id: "m1" },   // in the fabric: must not be written
  Hall: { type: "poly", points_m: [[7, 2], [13, 2], [13, 6.5]], source_map_id: "m1", floor_id: "main" },
  Den: { type: "poly", points_m: [[1, 6.5]], source_map_id: "m1" },                             // two points short of a room
  Study: { type: "poly", points_m: [[0, 0], [2, 0], [2, 2]], source_map_id: "m0" },            // the floor's OLDER plan wins this name
};
const build = (ctx, m, deps = {}) => WB.buildHouse(ctx, tracedOf(m, ctx.state.model),
  { planPins: pinsOver([m], m, ctx.state.model), ...deps });

{
  const { calls, ctx } = mkCtx(model, cands);
  let refreshed = 0;
  const r = await build(ctx, map, { refresh: async () => { refreshed++; } });
  const rooms = calls.filter(c => c[0] === "padspan_ha/fabric_correct_room");
  const scans = calls.filter(c => c[0] === "padspan_ha/fabric_scanner_position_set");
  check("the model is re-read first", refreshed === 1);
  check("one candidates read, for this floor", calls.filter(c => c[0] === "padspan_ha/fabric_truth_candidates").length === 1
    && calls[0][1].floor_id === "main", calls);
  check("Hall written with this plan's geometry and stamp", rooms.length === 1 && rooms[0][1].room === "Hall"
    && rooms[0][1].floor_id === "main" && rooms[0][1].source_map_id === "m1"
    && JSON.stringify(rooms[0][1].geometry) === JSON.stringify({ type: "poly", points_m: cands.Hall.points_m }), rooms);
  check("a room already in the fabric is never written", !rooms.some(c => c[1].room === "Kitchen"));
  check("a room with no usable shape is reported, not written", r.notConvertible.includes("Den") && !rooms.some(c => c[1].room === "Den"), r);
  check("a room the floor takes from another plan is left alone, and said", r.otherPlan.includes("Study") && !rooms.some(c => c[1].room === "Study"), r);
  const want = ST.mapFracToMetres(tf, 0.75, 0.25);
  check("the missing scanner, once, at the placement's metres", scans.length === 1 && scans[0][1].source === "AA:02"
    && Math.abs(scans[0][1].x_m - want[0]) < 0.001 && Math.abs(scans[0][1].y_m - want[1]) < 0.001 && scans[0][1].floor_id === "main", { scans, want });
  check("a new scanner leaves its height to the backend default", !("z_m" in scans[0][1]));
  check("a scanner already in the fabric is never written", !scans.some(c => c[1].source === "AA:01"));
  check("the counts", r.rooms === 1 && r.scanners === 1 && r.failed.length === 0, r);
}

{
  // The server already has Hall (the page's model was stale): not rewritten.
  const { calls, ctx } = mkCtx(model, cands, { serverFabric: { Hall: { type: "poly" } } });
  const r = await build(ctx, map);
  check("a room the server already has is skipped", !calls.some(c => c[0] === "padspan_ha/fabric_correct_room" && c[1].room === "Hall") && r.rooms === 0, r);
}

{
  // Unreadable: nothing at all is asked or written.
  const { calls, ctx } = mkCtx({ ...model, map_transforms: { m1: { ...tf, scale_x_m: 0 } } }, cands);
  const r = await build(ctx, map);
  check("no usable scale: nothing written, and said", r.notReadable === true && calls.length === 0, { r, calls });
}

{
  // A refused write is reported by name; the others still go.
  const { calls, ctx } = mkCtx(model, cands, { failOn: (type, d) => type === "padspan_ha/fabric_correct_room" && d.room === "Hall" });
  const r = await build(ctx, map);
  check("a failed room is named and the scanner still goes", r.failed.includes("Hall") && r.rooms === 0 && r.scanners === 1, r);
  check("nothing is retried behind the owner's back", calls.filter(c => c[0] === "padspan_ha/fabric_correct_room").length === 1);
}

{
  // A scanner pinned at different spots on two plans: refused on both, as Tune refuses it.
  const other = { id: "m2", floor_id: "main", room_bounds: {}, receivers: [{ id: "x", x: 0.1, y: 0.9, source: "AA:02" }] };
  const mdl = { ...model, map_transforms: { m1: tf, m2: tf } };
  const { calls, ctx } = mkCtx(mdl, {});
  const r = await WB.buildHouse(ctx, { ...tracedOf(map, mdl), rooms: [] }, { planPins: pinsOver([map, other], map, mdl) });
  check("a scanner two plans disagree about is refused", !calls.some(c => c[0] === "padspan_ha/fabric_scanner_position_set")
    && r.notConvertible.includes("AA:02"), { r, calls });
}

{
  // Everything already there: nothing to do, nothing asked.
  const full = { ...model, room_geometry_m: { Kitchen: {}, Hall: {}, Den: {}, Study: {} }, scanner_positions_m: { "AA:01": {}, "AA:02": {} } };
  const { calls, ctx } = mkCtx(full, cands);
  const r = await build(ctx, map);
  check("a house already built is left alone", calls.length === 0 && r.rooms === 0 && r.scanners === 0, { r, calls });
}

console.log(JSON.stringify({ cases, failures }));
