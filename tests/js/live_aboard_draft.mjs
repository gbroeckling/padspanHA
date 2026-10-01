// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
//
// Live Aboard's 3D editor rules (views/live_aboard_draft.js), run for real
// against houses read by views/live_aboard_house.js.
//
//   draft     a change is one Undo step, a slider's drag one step, Discard
//             undoable, Redo cleared by a new change; Save sends only what
//             changed (an entry, or null), and nothing when nothing did
//   file      the file read tolerantly: what the editor cannot read is left
//             out of the view (and stays in the file)
//   runs      a wall split by a barrier, two rooms' edges in line: one run;
//             a corner ends it
//   snap      a point is taken onto its run, never past an end
//   stops     a line stops at a corner and where another wall meets it
//   overlap   a line stops at a door or window already there (sensor ones
//             included); a start inside one is refused; dragging an end
//             skips its own opening
//   widths    a window 0.3 m or wider, a door 0.6 m; a switch to door that
//             is too narrow is refused
//   heights   0 up to the floor's ceiling; a fixture moves whole; a window's
//             head stays above its sill
//   walls     a 3D window is a real gap in the wall, its glass between sill
//             and head; a barrier's override reaches the drawing and the swing
//
// usage: live_aboard_draft.mjs <www/padspan-ha dir>
// prints one JSON line: { cases: {name: result}, failures: [...] }

import { pathToFileURL } from "node:url";
import { join } from "node:path";

const WWW = process.argv[2];
if (!WWW) { console.error("usage: live_aboard_draft.mjs <www/padspan-ha dir>"); process.exit(2); }
const D = await import(pathToFileURL(join(WWW, "views", "live_aboard_draft.js")).href);
const H = await import(pathToFileURL(join(WWW, "views", "live_aboard_house.js")).href);

const failures = [];
const cases = {};
const check = (name, ok, detail) => { cases[name] = !!ok; if (!ok) failures.push({ name, detail: detail === undefined ? null : detail }); };
const tryCase = (name, fn) => { try { fn(); } catch (e) { failures.push({ name, detail: String(e && e.stack || e).slice(0, 900) }); cases[name] = false; } };
const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;
const rect = (floor_id, x0, y0, x1, y1) => ({ type: "poly", floor_id, points_m: [[x0, y0], [x1, y0], [x1, y1], [x0, y1]] });

// Two rooms side by side on one floor, their back walls in line (y = 0),
// the shared wall between them at x = 4; a glass barrier (a window) on the
// kitchen's front wall and a plain barrier wall (the map's own) on the hall's.
const MODEL = {
  floors: [{ id: "main", name: "Main", level: 0 }],
  room_geometry_m: { Kitchen: rect("main", 0, 0, 4, 3), Hall: rect("main", 4.1, 0, 9, 3) },
  rf_barriers_m: [
    { id: "bar_win", name: "Kitchen window", material: "glass", floor_id: "main", points_m: [[1, 3], [2.2, 3]] },
    { id: "bar_wall", name: "Barrier 1", material: "metal", floor_id: "main", points_m: [[5, 3], [8, 3]] },
  ],
};
const house = (openings) => {
  const h = H.readHouse(MODEL, MODEL.floors, {}, null);
  if (openings) D.applyOpenings(h, openings);
  return h;
};
const piecesOf = (h) => h.perFloor.get(h.byId.get("main")).pieces;
const ceil = 2.8 - H.SLAB_T;
// The run along y = c (horizontal), the one nearest x.
const runAtY = (runs, y, x) => runs.filter(r => Math.abs(r.uy) < 1e-6 && Math.abs(D.pointOf(r, x)[1] - y) < 0.2)
  .sort((a, b) => D.runDist(a, x, y) - D.runDist(b, x, y))[0];

// ── draft ───────────────────────────────────────────────────────────────────
tryCase("draft: change, undo, redo; a new change clears redo", () => {
  const d = D.createDraft(D.ownedOf({ lights: { "light.a": { z_m: 2 } } }));
  const ok1 = d.change(c => { c.lights["light.a"] = { z_m: 1.5 }; });
  const same = d.change(c => { c.lights["light.a"] = { z_m: 1.5 }; });
  d.change(c => { c.devices["sensor.t"] = { z_m: 1.2 }; });
  const two = d.canUndo && d.cur.devices["sensor.t"].z_m === 1.2;
  d.undo();
  const back = d.cur.devices["sensor.t"] === undefined && d.cur.lights["light.a"].z_m === 1.5 && d.canRedo;
  d.redo();
  const fwd = d.cur.devices["sensor.t"].z_m === 1.2;
  d.undo(); d.change(c => { c.lights["light.a"] = { z_m: 1.0 }; });
  check("draft: change, undo, redo; a new change clears redo", ok1 && !same && two && back && fwd && !d.canRedo,
    { ok1, same, two, back, fwd, redo: d.canRedo });
});
tryCase("draft: one slider drag is one step; Discard is undoable", () => {
  const d = D.createDraft(D.ownedOf(null));
  for (const z of [1.1, 1.2, 1.3, 1.4]) d.change(c => { c.lights["light.a"] = { z_m: z }; }, "slider:light.a");
  d.change(c => { c.lights["light.b"] = { z_m: 0.5 }; });
  d.undo();
  const afterOne = d.cur.lights["light.a"].z_m === 1.4 && !d.cur.lights["light.b"];
  d.undo();
  const allGone = !d.cur.lights["light.a"] && !d.canUndo;
  d.redo(); d.redo();
  const dirty = d.dirty;
  d.discard();
  const clean = !d.dirty && d.changes() === null;
  d.undo();
  const backAgain = d.dirty && d.cur.lights["light.b"].z_m === 0.5;
  check("draft: one slider drag is one step; Discard is undoable", afterOne && allGone && dirty && clean && backAgain,
    { afterOne, allGone, dirty, clean, backAgain });
});
tryCase("draft: Save sends only what changed, an entry or null", () => {
  const base = D.ownedOf({ lights: { "light.a": { z_m: 2, glow: "x" }, "light.b": { z_m: 1 } },
                           openings: { bar_1: { hinge: "left", lean: 3 }, win_0000000a: { kind: "window", floor_id: "main", a_m: [0, 0], b_m: [1, 0], sill_m: 0.9, head_m: 2.1 } } });
  const d = D.createDraft(base);
  const none = d.changes() === null && !d.dirty;
  d.change(c => {
    c.lights["light.a"] = { z_m: 2 };                 // the same value: not a change
    delete c.lights["light.b"];
    c.openings.bar_1 = { hinge: "right" };
    c.openings.door_0000000b = D.newOpening("door", "main", [3, 0], [3.9, 0], ceil);
    c.openings.win_0000000a = { ...c.openings.win_0000000a, sill_m: 1.0 };
  });
  const ch = d.changes();
  const want = { lights: { "light.b": null },
                 openings: { bar_1: { hinge: "right" }, door_0000000b: { kind: "door", floor_id: "main", a_m: [3, 0], b_m: [3.9, 0], head_m: 2.03, hinge: "left", swing: "in" },
                             win_0000000a: { kind: "window", floor_id: "main", a_m: [0, 0], b_m: [1, 0], sill_m: 1.0, head_m: 2.1 } } };
  const sameShape = JSON.stringify(ch, Object.keys(ch).sort()) !== undefined && JSON.stringify(ch.lights) === JSON.stringify(want.lights)
    && JSON.stringify(ch.openings.bar_1) === JSON.stringify(want.openings.bar_1)
    && JSON.stringify(ch.openings.door_0000000b) === JSON.stringify(want.openings.door_0000000b)
    && ch.openings.win_0000000a.sill_m === 1.0 && !("devices" in ch);
  d.rebase(d.cur);
  check("draft: Save sends only what changed, an entry or null", none && sameShape && d.changes() === null && !d.canUndo,
    { none, ch, after: d.changes() });
});
tryCase("draft: new ids are win_ or door_ and 8 hex digits", () => {
  const ids = [D.newOpeningId("window"), D.newOpeningId("door"), D.newOpeningId("door", () => 0.999)];
  check("draft: new ids are win_ or door_ and 8 hex digits",
    ids.every(i => D.OPENING_ID.test(i)) && ids[0].startsWith("win_") && ids[1].startsWith("door_") && ids[2] === "door_ffffffff", ids);
});

// ── file ────────────────────────────────────────────────────────────────────
tryCase("file: read tolerantly, only what the editor owns", () => {
  const v = D.ownedOf({ future: 1, openings: { win_00000001: { kind: "window", floor_id: "main", a_m: [0, 0] },
                                               win_00000002: { floor_id: "up", a_m: [0, 0], b_m: [1, 0] },
                                               door_00000003: { floor_id: "main", a_m: [0, 0], b_m: [1, 0], hinge: "sideways", tint: 1 },
                                               bar_1: { hinge: "right", lean: 2 }, bar_2: { colour: "red" }, bar_3: "x" },
                        lights: { "light.a": { z_m: "1.5" }, "light.b": { z_m: 1.2, glow: 1 } }, devices: [] });
  check("file: read tolerantly, only what the editor owns",
    !v.openings.win_00000001 && v.openings.win_00000002.sill_m === 0.9 && v.openings.win_00000002.kind === "window"
    && v.openings.door_00000003.hinge === "left" && !("tint" in v.openings.door_00000003) && v.openings.door_00000003.head_m === 2.03
    && JSON.stringify(v.openings.bar_1) === '{"hinge":"right"}' && !v.openings.bar_2 && !v.openings.bar_3
    && !v.lights["light.a"] && JSON.stringify(v.lights["light.b"]) === '{"z_m":1.2}' && Object.keys(v.devices).length === 0, v);
});

// ── runs, snap, stops ───────────────────────────────────────────────────────
tryCase("runs: a wall split by a barrier is one run; corners end it", () => {
  // The front: the kitchen's wall, its glass barrier, wall, then the hall's
  // wall in line with it (the map's own barrier wall in it): one run from
  // corner to corner, stopped where the shared wall meets it.
  const h = house(), pcs = piecesOf(h), runs = D.wallRuns(pcs);
  const front = runAtY(runs, 3, 1.5), stops = front ? D.runStops(front, pcs) : [];
  check("runs: a wall split by a barrier is one run; corners end it",
    front && front.pcs.some(p => p.kind === "window") && front.pcs.some(p => p.barrier && p.barrier.id === "bar_wall")
    && near(front.t0, 0, 0.1) && near(front.t1, 9, 0.1) && stops.some(s => s > 3.9 && s < 4.2),
    front && { pcs: front.pcs.map(p => p.kind), t0: front.t0, t1: front.t1, stops });
});
tryCase("runs: two rooms' back walls in line are one run, stopped where the shared wall meets", () => {
  const h = house(), pcs = piecesOf(h), runs = D.wallRuns(pcs);
  const back = runAtY(runs, 0, 2);
  const stops = back ? D.runStops(back, pcs) : [];
  const meet = stops.find(s => s > 3.5 && s < 4.6);
  check("runs: two rooms' back walls in line are one run, stopped where the shared wall meets",
    back && back.t1 - back.t0 > 8.5 && meet !== undefined, back && { t0: back.t0, t1: back.t1, stops });
});
tryCase("snap: a point goes onto its run, never past an end", () => {
  const runs = D.wallRuns(piecesOf(house())), back = runAtY(runs, 0, 2);
  const t = D.tOn(back, 2.5, 0.3), p = D.pointOf(back, t), past = D.tOn(back, -3, 0.2);
  check("snap: a point goes onto its run, never past an end",
    near(p[0], 2.5, 0.02) && Math.abs(p[1]) < 0.1 && near(past, back.t0, 1e-9) && near(D.runDist(back, 2.5, 0.3), 0.3 - p[1], 1e-6),
    { t, p, past });
});
tryCase("stops: a line stops at the corner and at a wall that meets it", () => {
  const pcs = piecesOf(house()), runs = D.wallRuns(pcs), back = runAtY(runs, 0, 2), stops = D.runStops(back, pcs);
  const toCorner = D.spanOf(back, stops, D.runOpenings(back), D.tOn(back, 1, 0), D.tOn(back, -5, 0));
  const toT = D.spanOf(back, stops, D.runOpenings(back), D.tOn(back, 1, 0), D.tOn(back, 7, 0));
  const meet = stops.find(s => s > 3.5 && s < 4.6);
  check("stops: a line stops at the corner and at a wall that meets it",
    toCorner.stop === "corner" && near(toCorner.t0, back.t0, 1e-9) && toT.stop === "corner" && near(toT.t1, meet, 1e-9),
    { toCorner, toT, stops });
});

// ── overlap ─────────────────────────────────────────────────────────────────
tryCase("overlap: a line stops at a window already there; a start inside one is refused", () => {
  const pcs = piecesOf(house()), runs = D.wallRuns(pcs), front = runAtY(runs, 3, 3), stops = D.runStops(front, pcs);
  const ops = D.runOpenings(front);
  const into = D.spanOf(front, stops, ops, D.tOn(front, 3.5, 3), D.tOn(front, 0.2, 3));
  const sensorWin = ops.find(o => o.id === "bar_win");
  check("overlap: a line stops at a window already there; a start inside one is refused",
    sensorWin && into.stop === "opening" && near(into.t0, sensorWin.hi, 1e-9) && D.insideOpening(ops, D.tOn(front, 1.5, 3))
    && !D.insideOpening(ops, D.tOn(front, 3.0, 3)), { ops, into });
});
tryCase("overlap: a 3D window is in the way of the next, and not of its own end", () => {
  const ops3 = { win_00000001: D.newOpening("window", "main", [0.5, 0], [1.5, 0], ceil) };
  const pcs = piecesOf(house(ops3)), runs = D.wallRuns(pcs), back = runAtY(runs, 0, 2), stops = D.runStops(back, pcs);
  const ops = D.runOpenings(back);
  const next = D.spanOf(back, stops, ops, D.tOn(back, 3, 0), D.tOn(back, 0, 0));
  const own = D.spanOf(back, stops, ops, D.tOn(back, 0.5, 0), D.tOn(back, 3, 0), "win_00000001");
  check("overlap: a 3D window is in the way of the next, and not of its own end",
    ops.some(o => o.id === "win_00000001") && next.stop === "opening" && near(next.t0, D.tOn(back, 1.5, 0), 0.01)
    && own.stop === null && near(own.len, 2.5, 0.01), { ops, next, own });
});

// ── widths ──────────────────────────────────────────────────────────────────
tryCase("widths: a window 0.3 m or wider, a door 0.6 m; a too-narrow switch is refused", () => {
  const w = D.newOpening("window", "main", [0, 0], [0.4, 0], ceil);
  const sw = D.switchKind("win_0000000a", w, ceil);
  const wide = D.newOpening("window", "main", [0, 0], [0.9, 0], ceil);
  const ok = D.switchKind("win_0000000a", wide, ceil);
  const back = D.switchKind(ok.id, ok.rec, ceil);
  check("widths: a window 0.3 m or wider, a door 0.6 m; a too-narrow switch is refused",
    D.minWidth("window") === 0.3 && D.minWidth("door") === 0.6 && sw.error && ok.id === "door_0000000a"
    && ok.rec.kind === "door" && ok.rec.head_m === 2.03 && ok.rec.hinge === "left" && ok.rec.swing === "in"
    && back.id === "win_0000000a" && back.rec.sill_m === 0.9 && back.rec.head_m === 2.1, { sw, ok, back });
});

// ── heights ─────────────────────────────────────────────────────────────────
tryCase("heights: 0 up to the floor's ceiling", () => {
  const r = D.heightRange(ceil);
  check("heights: 0 up to the floor's ceiling",
    r.min === 0 && r.max === 2.65 && D.clampHeight(-1, ceil) === 0 && D.clampHeight(9, ceil) === 2.65 && D.clampHeight(1.2345, ceil) === 1.235
    && D.clampHeight(NaN, ceil) === 0, { r });
});
tryCase("heights: a fixture moves whole to its stored height, kept under the ceiling", () => {
  const parts = { bulbs: [{ h: 2.6 }, { h: 2.6 }], housings: [{ h: 2.64 }], halos: [{ h: 2.55 }] };
  const a = D.liftParts(JSON.parse(JSON.stringify(parts)), { z_m: 1.6 }, ceil);
  const b = D.liftParts(JSON.parse(JSON.stringify(parts)), { z_m: 9 }, ceil);
  const c = D.liftParts(JSON.parse(JSON.stringify(parts)), null, ceil);
  check("heights: a fixture moves whole to its stored height, kept under the ceiling",
    near(a.z, 1.6) && near(a.zDefault, 2.6) && near(a.parts.housings[0].h, 1.64) && near(a.parts.halos[0].h, 1.55)
    && near(b.z, 2.65) && near(c.z, 2.6) && near(c.parts.bulbs[0].h, 2.6), { a, b, c });
});
tryCase("heights: a window's head stays above its sill; a door from its floor", () => {
  const w = D.openingHeights({ kind: "window", sill_m: 2.5, head_m: 1.0 }, ceil);
  const t = D.openingHeights({ kind: "window", sill_m: 0.2, head_m: 9 }, ceil);
  const d = D.openingHeights({ kind: "door", head_m: 0.2 }, ceil);
  check("heights: a window's head stays above its sill; a door from its floor",
    near(w.sill_m, 2.5) && near(w.head_m, 2.6) && w.head_m - w.sill_m >= 0.1 - 1e-9 && near(t.head_m, 2.65) && near(d.head_m, 1.0), { w, t, d });
});

// ── walls ───────────────────────────────────────────────────────────────────
tryCase("walls: a 3D window is a real gap with its glass between sill and head", () => {
  const ops3 = { win_00000001: { ...D.newOpening("window", "main", [5.5, 0], [7, 0], ceil), sill_m: 0.6, head_m: 1.8 } };
  const before = piecesOf(house()).length, pcs = piecesOf(house(ops3));
  const win = pcs.find(p => p.added === "win_00000001");
  const els = win ? H.wallElements(win, 2.8) : [];
  const glass = els.find(e => e.glass), below = els.find(e => !e.glass && e.z1 <= 0.6 + 1e-9);
  check("walls: a 3D window is a real gap with its glass between sill and head",
    pcs.length === before + 2 && win && win.kind === "window" && glass && near(glass.z0, 0.6) && near(glass.z1, 1.8)
    && below && near(below.z1, 0.6) && els.some(e => near(e.z0, 1.8)), { n: [before, pcs.length], els });
});
tryCase("walls: the map's own wall takes a 3D window too", () => {
  const ops3 = { win_00000002: D.newOpening("window", "main", [6, 3], [7, 3], ceil) };
  const pcs = piecesOf(house(ops3)), win = pcs.find(p => p.added === "win_00000002");
  const rest = pcs.filter(p => p.barrier && p.barrier.id === "bar_wall");
  check("walls: the map's own wall takes a 3D window too", win && !win.barrier && rest.length === 2, { rest: rest.length });
});
tryCase("walls: a barrier's override reaches its drawing and its swing", () => {
  const h = house({ bar_win: { sill_m: 1.1, head_m: 2.0 } }), pcs = piecesOf(h);
  const win = pcs.find(p => p.barrier && p.barrier.id === "bar_win");
  const glass = H.wallElements(win, 2.8).find(e => e.glass);
  const door = { x0: 0, y0: 0, x1: 1, y1: 0, nx: 0, ny: -1 };
  const rooms = [{ outdoor: false, pts: [[0, -3], [1, -3], [1, 0], [0, 0]] }];
  const a = H.openingSwing(door, rooms, null), b = H.openingSwing(door, rooms, { hinge: "right", swing: "out" });
  const gone = piecesOf(house({ win_00000003: { ...D.newOpening("window", "nowhere", [0, 0], [1, 0], ceil), floor_id: "nowhere" } }));
  check("walls: a barrier's override reaches its drawing and its swing",
    win.override && near(glass.z0, 1.1) && near(glass.z1, 2.0) && a.hinge !== b.hinge && a.side === -b.side
    && !gone.some(p => p.added), { glass, a, b });
});
tryCase("walls: with nothing in the file the house is as part B drew it", () => {
  const a = JSON.stringify(piecesOf(house())), b = JSON.stringify(piecesOf(house({})));
  check("walls: with nothing in the file the house is as part B drew it", a === b);
});

console.log(JSON.stringify({ cases, failures }));
