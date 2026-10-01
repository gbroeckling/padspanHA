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
//             is too narrow is refused; ends kept to the millimetre never
//             take one drawn at least that wide under it (the server
//             measures between the rounded ends), however the wall slopes
//   heights   0 up to the floor's ceiling; a fixture moves whole; a window's
//             head stays above its sill; a door never under the server's
//             0.5 m, however low the ceiling
//   limits    what the editor offers is what the view draws (heightLimits,
//             the one place): a window's sill and head, a door's head and a
//             device's height at their tops, and anything over them drawn
//             at them; a door is 2.03 m by default, from the map or new
//   walls     a 3D window is a real gap in the wall, its glass between sill
//             and head; a barrier's override reaches the drawing and the swing
//
// usage: live_aboard_draft.mjs <www/padspan-ha dir>
// prints one JSON line: { cases: {name: result}, failures: [...], payloads: [...] }
// payloads: what Save would send for records these rules build at their
// edges, which the server's own apply_edit must take (test_live_aboard_draft.py).

import { pathToFileURL } from "node:url";
import { join } from "node:path";

const WWW = process.argv[2];
if (!WWW) { console.error("usage: live_aboard_draft.mjs <www/padspan-ha dir>"); process.exit(2); }
const D = await import(pathToFileURL(join(WWW, "views", "live_aboard_draft.js")).href);
const H = await import(pathToFileURL(join(WWW, "views", "live_aboard_house.js")).href);

const failures = [];
const cases = {};
const payloads = [];
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
// The server's own rule (house3d_store.py writable), case by case: the same
// table is held against it in test_live_aboard_draft.py.
export const WRITABLE_CASES = [[null, true], [{}, true], [{"schema": 0}, true], [{"schema": 1}, true], [{"schema": 2}, false], [{"schema": 1.5}, false], [{"schema": "1"}, false], [{"schema": true}, false], [{"schema": -1}, false]];
tryCase("file: this version writes only a file whose schema it knows, as the server says", () => {
  const got = WRITABLE_CASES.map(([d, want]) => D.writable(d) === want);
  check("file: this version writes only a file whose schema it knows, as the server says", got.every(Boolean) && D.FILE_SCHEMA === 1, got);
});
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
tryCase("runs: a near-upright wall's pieces leaning either way are one run", () => {
  // Hand-drawn: x drifts by millimetres, so one piece's x grows and the
  // next one's shrinks; they are still one wall.
  const pcs = [{ x0: 0.51, y0: 5.3, x1: 0.5, y1: 7.5, kind: "wall", thick: 0.14 },
               { x0: 0.5, y0: 7.5, x1: 0.52, y1: 10.5, kind: "wall", thick: 0.14 }];
  const runs = D.wallRuns(pcs);
  check("runs: a near-upright wall's pieces leaning either way are one run",
    runs.length === 1 && near(runs[0].t1 - runs[0].t0, 5.2, 0.02), runs.map(r => ({ u: [r.ux, r.uy], t0: r.t0, t1: r.t1 })));
});
tryCase("runs: a big floor's pieces, in any order, are joined in one pass", () => {
  // A 40 x 40 grid of 3 m rooms' walls, every wall in 3 m pieces, shuffled
  // (the order a hand-drawn map gives): 82 straight walls, each one run end
  // to end, worked out in milliseconds (it was cubic: over a second).
  const pcs = [];
  for (let i = 0; i <= 40; i++) for (let j = 0; j < 40; j++) {
    pcs.push({ x0: j * 3, y0: i * 3, x1: j * 3 + 3, y1: i * 3, kind: "wall", thick: 0.12 });
    pcs.push({ x0: i * 3, y0: j * 3 + 3, x1: i * 3, y1: j * 3, kind: "wall", thick: 0.14 });
  }
  let seed = 7;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let i = pcs.length - 1; i > 0; i--) { const k = Math.floor(rnd() * (i + 1)); [pcs[i], pcs[k]] = [pcs[k], pcs[i]]; }
  const t0 = performance.now(), runs = D.wallRuns(pcs), ms = performance.now() - t0;
  check("runs: a big floor's pieces, in any order, are joined in one pass",
    pcs.length === 3280 && runs.length === 82 && runs.every(r => r.pcs.length === 40 && near(r.t0, 0, 1e-9) && near(r.t1, 120, 1e-9))
    && ms < 300, { pieces: pcs.length, runs: runs.length, ms: Math.round(ms) });
});
tryCase("walls: the map as read is never changed by what the 3D file cuts into a copy of it", () => {
  // The 3D view keeps the map's reading and cuts the draft's doors and
  // windows into a copy of its walls on every draw (readingCopy).
  const h = H.readHouse(MODEL, MODEL.floors, {}, null), before = JSON.stringify([...h.perFloor.values()].map(p => p.pieces));
  const ops = { win_00000001: D.newOpening("window", "main", [0.5, 0], [1.5, 0], ceil), bar_win: { sill_m: 1.2, head_m: 2 } };
  const cut = D.applyOpenings(H.readingCopy(h), ops), pcs = piecesOf(cut);
  check("walls: the map as read is never changed by what the 3D file cuts into a copy of it",
    JSON.stringify([...h.perFloor.values()].map(p => p.pieces)) === before && pcs.some(p => p.added === "win_00000001")
    && pcs.some(p => p.barrier && p.barrier.id === "bar_win" && p.sill_m === 1.2) && cut.lights === h.lights, { n: pcs.length });
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

tryCase("widths: ends kept to the millimetre never take a door or window drawn at its least width under it", () => {
  // A seeded sweep of lines drawn up to 2 mm over the least width at every
  // slope, as Save sends them (newOpening), and the same with one end
  // dragged (endsMm, the other end held): the server measures the width
  // between the rounded ends. No end moves more than rounding needs.
  let seed = 20261001;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  let n = 0, bad = null, far = 0;
  const ops = {};
  for (let i = 0; i < 20000; i++) {
    const kind = i % 2 ? "window" : "door", least = D.minWidth(kind);
    const th = rnd() * 2 * Math.PI, len = least + rnd() * 0.002, x0 = rnd() * 20 - 10, y0 = rnd() * 20 - 10;
    const a = [x0, y0], b = [x0 + len * Math.cos(th), y0 + len * Math.sin(th)];
    const rec = D.newOpening(kind, "main", a, b, ceil);
    const [held, moved] = D.endsMm(b, a, least);
    for (const [p, q] of [[rec.a_m, rec.b_m], [held, moved]]) {
      n++;
      const w = Math.hypot(q[0] - p[0], q[1] - p[1]);
      if (!(w >= least - 1e-6) && !bad) bad = { kind, len, deg: +(th * 180 / Math.PI).toFixed(2), p, q, w };
    }
    far = Math.max(far, Math.hypot(rec.a_m[0] - a[0], rec.a_m[1] - a[1]), Math.hypot(rec.b_m[0] - b[0], rec.b_m[1] - b[1]),
                   Math.hypot(held[0] - b[0], held[1] - b[1]), Math.hypot(moved[0] - a[0], moved[1] - a[1]));
    if (i % 50 === 0) ops[D.newOpeningId(kind, rnd)] = rec;
  }
  payloads.push({ openings: ops });
  check("widths: ends kept to the millimetre never take a door or window drawn at its least width under it",
    n === 40000 && !bad && far <= 0.0016 + 0.00071, { n, bad, far });
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
    near(w.sill_m, 2.45) && near(w.head_m, 2.55) && w.head_m - w.sill_m >= 0.1 - 1e-9 && near(t.head_m, 2.55) && near(d.head_m, 1.0), { w, t, d });
});
tryCase("heights: a door is never under the server's 0.5 m, however low the ceiling", () => {
  const got = [0.36, 0.45, 0.6, 1.0, 1.4].map(c => {
    const win = D.newOpening("window", "main", [0, 0], [1, 0], c);
    return { c, slid: D.openingHeights({ kind: "door", head_m: 0.1 }, c).head_m, made: D.newOpening("door", "main", [0, 0], [1, 0], c).head_m,
             switched: D.switchKind("win_0000000c", win, c).rec.head_m, low: D.heightLimits(c).doorLow, win };
  });
  for (const g of got) payloads.push({ openings: { door_0000000d: D.newOpening("door", "main", [0, 0], [1, 0], g.c), win_0000000e: g.win,
                                                   door_0000000f: { ...D.newOpening("door", "main", [0, 0], [1, 0], g.c), head_m: g.slid } } });
  check("heights: a door is never under the server's 0.5 m, however low the ceiling",
    D.DOOR_MIN_HEAD_M === 0.5 && got.every(g => g.slid >= 0.5 && g.made >= 0.5 && g.switched >= 0.5 && g.low >= 0.5), { got });
});

// ── limits ──────────────────────────────────────────────────────────────────
tryCase("limits: what the editor offers is what the view draws, and nothing over it", () => {
  const pc = (kind, o) => ({ kind, x0: 0, y0: 0, x1: 1, y1: 0, nx: 0, ny: -1, cls: "int", thick: 0.12, ...o });
  const out = [];
  for (const c of [2.65, 2.2, 1.6, 0.9]) {
    const L = D.heightLimits(c), floorH = c + H.SLAB_T, top = (v) => D.mm(v);
    const glass = (o) => H.wallElements(pc("window", o), floorH).find(e => e.glass);
    const leaf = (o) => H.wallElements(pc("door", o), floorH).find(e => e.leaf);
    const at = glass({ sill_m: top(L.sill), head_m: top(L.head) }), over = glass({ sill_m: 9, head_m: 9 });
    const door = leaf({ head_m: top(L.doorHigh) }), doorOver = leaf({ head_m: 9 });
    const devTop = D.heightRange(c, "devices").max, lightTop = D.heightRange(c).max;
    const slidW = D.openingHeights({ kind: "window", sill_m: 9, head_m: 9 }, c), slidD = D.openingHeights({ kind: "door", head_m: 9 }, c);
    const r = {
      c, window: [at.z0, at.z1, top(L.sill), top(L.head)], over: [over.z0, over.z1], door: [door.z1, top(L.doorHigh), doorOver.z1],
      device: [H.deviceZ("temp", c, { z_m: devTop }), devTop, H.deviceZ("temp", c, { z_m: 9 })],
      light: [D.liftParts({ bulbs: [{ h: 1 }] }, { z_m: 9 }, c).z, lightTop], slid: [slidW.sill_m, slidW.head_m, slidD.head_m],
    };
    r.ok = near(at.z0, top(L.sill), 1e-9) && near(at.z1, top(L.head), 1e-9) && near(over.z0, L.sill, 1e-9) && near(over.z1, L.head, 1e-9)
      && near(door.z1, top(L.doorHigh), 1e-9) && near(doorOver.z1, L.head, 1e-9)
      && near(r.device[0], devTop, 1e-9) && near(r.device[2], devTop, 1e-6) && near(r.light[0], lightTop, 1e-9)
      && near(slidW.sill_m, top(L.sill), 1e-9) && near(slidW.head_m, top(L.head), 1e-9) && near(slidD.head_m, top(L.doorHigh), 1e-9)
      && devTop < c && lightTop === D.mm(c);
    out.push(r);
    payloads.push({ openings: { win_00000010: { ...D.newOpening("window", "main", [0, 0], [1, 0], c), ...slidW },
                                door_00000011: { ...D.newOpening("door", "main", [0, 0], [1, 0], c), ...slidD },
                                bar_win: slidW },
                    devices: { "sensor.den_temp": { z_m: devTop } }, lights: { "light.den": { z_m: lightTop } } });
  }
  check("limits: what the editor offers is what the view draws, and nothing over it", out.every(r => r.ok), out.filter(r => !r.ok));
});
tryCase("limits: a door is 2.03 m by default, drawn from the map or drawn new", () => {
  const leaf = H.wallElements({ kind: "door", x0: 0, y0: 0, x1: 1, y1: 0, nx: 0, ny: -1, cls: "int", thick: 0.12 }, 2.8).find(e => e.leaf);
  const made = D.newOpening("door", "main", [0, 0], [1, 0], ceil);
  check("limits: a door is 2.03 m by default, drawn from the map or drawn new",
    D.DOOR_HEAD_M === 2.03 && H.DOOR_H === 2.03 && near(leaf.z1, 2.03) && made.head_m === 2.03
    && H.SILL_H === D.WINDOW_SILL_M && H.HEAD_H === D.WINDOW_HEAD_M, { DOOR_H: H.DOOR_H, leaf: leaf.z1, made: made.head_m });
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

console.log(JSON.stringify({ cases, failures, payloads }));
