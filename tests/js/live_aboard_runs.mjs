// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
//
// Live Aboard's Strip tool, its runs as numbers (views/live_aboard_runs.js)
// and as drawn (views/live_aboard_house.js runParts), run for real on a
// synthetic house shaped like Garry's (an L-shaped living room with a door
// and a window, a galley kitchen, a raised deck with rails).
//
//   trace     a room's walls as one loop: in from the outline, round its
//             corners either way, across the seam, how far the next corner is
//   room      Round this room: closed, a gap (only wire) at each door lower
//             than the run, none over a door for a cove, windows only when asked
//   piece     a run on a piece moves and turns with it; removed, it stays put
//   string    the swag is a catenary (its ends fixed, its middle the sag down)
//             and a bulb every so often along the wire
//   build     one continuous tape per run (one box a stretch, mitred so the
//             corners close, no rows of dots), its light per face per stretch,
//             gaps unlit, hidden tape unseen when off, a string's bulbs and
//             glows; a light with no run is drawn exactly as before
//   check     the server's rules, here first (Save never fails on them); tidy
//   draft     the editor's draft carries the run, sends it whole, and a piece
//             removed leaves its runs in place in the same step
//
// usage: live_aboard_runs.mjs <www/padspan-ha dir>
// prints one JSON line: { cases: {name: result}, failures: [...], payloads: [...] }
// payloads: runs made here, fed through the server's own check by
// test_live_aboard_strip.py.

import { pathToFileURL } from "node:url";
import { join } from "node:path";

const WWW = process.argv[2];
if (!WWW) { console.error("usage: live_aboard_runs.mjs <www/padspan-ha dir>"); process.exit(2); }
const R = await import(pathToFileURL(join(WWW, "views", "live_aboard_runs.js")).href);
const H = await import(pathToFileURL(join(WWW, "views", "live_aboard_house.js")).href);
const D = await import(pathToFileURL(join(WWW, "views", "live_aboard_draft.js")).href);
const LC = await import(pathToFileURL(join(WWW, "views", "light_codes.js")).href);

const failures = [], cases = {}, payloads = [];
const check = (name, ok, detail) => { cases[name] = !!ok; if (!ok) failures.push({ name, detail: detail === undefined ? null : detail }); };
const tryCase = (name, fn) => { try { fn(); } catch (e) { failures.push({ name, detail: String(e && e.stack || e).slice(0, 900) }); cases[name] = false; } };
const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;
const nearPt = (p, q, eps = 1e-3) => p.length === q.length && p.every((v, i) => near(v, q[i], eps));
const keep = (what, entry) => payloads.push({ what, entry });

// ── the house ───────────────────────────────────────────────────────────────
// Main (2.3 m floor to floor, as Garry's): an L-shaped Living Room, a galley
// Kitchen beside it, a door between them and a window in the living room's
// far wall; the Upper Deck outside, raised (rails).
const L_ROOM = [[0.65, -8.0], [7.9, -8.0], [7.9, 1.0], [1.9, 1.0], [1.9, -3.0], [0.65, -3.0]];
const MODEL = {
  floors: [{ id: "ground", floor_to_floor_m: 3 }, { id: "main", floor_to_floor_m: 2.3 }],
  floor_elevations: { ground: 0, main: 3 },
  room_geometry_m: {
    "Living Room": { type: "poly", floor_id: "main", points_m: L_ROOM },
    Kitchen: { type: "poly", floor_id: "main", points_m: [[8.0, -6.0], [9.8, -6.0], [9.8, 0.4], [8.0, 0.4]] },
    "Upper Deck": { type: "poly", floor_id: "main", points_m: [[-3.0, -2.0], [0.5, -2.0], [0.5, 4.0], [-3.0, 4.0]] },
    Shed: { type: "poly", floor_id: "ground", points_m: [[20, 0], [24, 0], [24, 3], [20, 3]] },
  },
  rf_barriers_m: [
    { id: "bar_kdoor", name: "Kitchen door", material: "custom", floor_id: "main", points_m: [[7.95, -2.0], [7.95, -1.1]] },
    { id: "bar_lwin", name: "Living window", material: "glass", floor_id: "main", points_m: [[3.0, -8.0], [4.5, -8.0]] },
  ],
  light_positions_m: {},
};
const dev = (entity_id, name) => { const l = { entity_id, friendly_name: name, state: "on", rgb: [255, 180, 120], bri: 255, ct: null }; LC.assignLightCodes([l]); l.shape = LC.resolveLightShape(l, {}); return l; };
function houseWith(lights){
  const model = { ...MODEL, light_positions_m: Object.fromEntries(Object.entries(lights).map(([eid, v]) => [eid, { floor_id: "main", ...v.at }])) };
  const lbe = Object.fromEntries(Object.entries(lights).map(([eid, v]) => [eid, v.l]));
  const h = H.readHouse(model, model.floors, lbe, null, {});
  const by = Object.fromEntries(h.lights.map(L => [L.eid, L]));
  const ctxOf = (L, furniture = []) => ({ ...h.perFloor.get(L.floor), ground: h.ground, furniture });
  return { h, by, ctxOf, per: h.perFloor.get(h.byId.get("main")) };
}
const T = houseWith({
  "light.cove": { l: dev("light.cove", "Living cove"), at: { x_m: 4, y_m: -5 } },
  "light.under": { l: dev("light.under", "Kitchen under cabinet strip"), at: { x_m: 9.5, y_m: -3, width_cm: 150, height_cm: 1, rotation: 150 } },
  "light.deck": { l: dev("light.deck", "Deck string"), at: { x_m: -1, y_m: 1 } },
  "light.tv": { l: dev("light.tv", "TV backlight"), at: { x_m: 1.0, y_m: -5.5 } },
});
const CEIL = 2.3 - H.SLAB_T;
const living = T.per.rooms.find(r => r.name === "Living Room"), kitchen = T.per.rooms.find(r => r.name === "Kitchen");
const LOOP = R.insetLoop(living.pts, 0.015);
const ops = T.per.pieces.filter(pc => pc.kind === "door" || pc.kind === "window" || pc.kind === "open")
  .map(pc => ({ kind: pc.kind, a: [pc.x0, pc.y0], b: [pc.x1, pc.y1], sill: pc.sill_m, head: pc.head_m }));

// ── trace ───────────────────────────────────────────────────────────────────
tryCase("trace: a room's walls as one loop, a strip's width in from its outline", () => {
  const sq = R.insetLoop([[0, 0], [4, 0], [4, 3], [0, 3]], 0.015), back = R.insetLoop([[0, 0], [0, 3], [4, 3], [4, 0]], 0.015);
  const want = [[0.015, 0.015], [3.985, 0.015], [3.985, 2.985], [0.015, 2.985]];
  check("trace: a room's walls as one loop, a strip's width in from its outline",
    sq.every((p, i) => nearPt(p, want[i])) && back.every((p, i) => nearPt(p, [want[0], want[3], want[2], want[1]][i]))
    && LOOP.length === 6 && LOOP.every(p => H.inPoly(p[0], p[1], living.pts)) && near(R.perimeter(LOOP).P, 2 * (7.25 + 9) - 0.12, 1e-6),
    { sq, back, P: R.perimeter(LOOP).P });
});
tryCase("trace: along the walls round the corners, either way, across the seam", () => {
  const sq = [[0, 0], [4, 0], [4, 3], [0, 3]], P = R.perimeter(sq).P;            // 14
  const fwd = R.pathAlong(sq, 2, 8), back = R.pathAlong(sq, 2, -2), seam = R.pathAlong(sq, 12, 16), whole = R.pathAlong(sq, 1, 1 + P);
  const step = R.stepRound(sq, 13.5, 0.5), dd = R.sOf(sq, 4.2, 1.0);
  check("trace: along the walls round the corners, either way, across the seam",
    JSON.stringify(fwd) === JSON.stringify([[2, 0], [4, 0], [4, 3], [3, 3]])
    && JSON.stringify(back) === JSON.stringify([[2, 0], [0, 0], [0, 2]])
    && JSON.stringify(seam) === JSON.stringify([[0, 2], [0, 0], [2, 0]])
    && whole.length === 6 && nearPt(whole[0], whole[5]) && near(step, 1) && near(dd.s, 5) && near(dd.d, 0.2),
    { fwd, back, seam, whole, step, dd });
});
tryCase("trace: how far the next corner is, the way it goes", () => {
  const sq = [[0, 0], [4, 0], [4, 3], [0, 3]];
  check("trace: how far the next corner is, the way it goes",
    near(R.toCorner(sq, 1, 1), 3) && near(R.toCorner(sq, 1, -1), 1) && near(R.toCorner(sq, 13.5, 1), 0.5) && near(R.toCorner(sq, 4, 1), 3),
    [R.toCorner(sq, 1, 1), R.toCorner(sq, 1, -1), R.toCorner(sq, 13.5, 1), R.toCorner(sq, 4, 1)]);
});

// ── room ────────────────────────────────────────────────────────────────────
tryCase("room: round the living room at 1.4 m: closed, a gap at the door", () => {
  const r = R.roundRoom(LOOP, 1.4, ops, { doors: true, windows: false, face: "down" }), run = r.run;
  const gap = run.gaps || [], st = R.stretches(run.pts, true);
  const door = st.filter(q => gap.includes(q.i)).map(q => [q.a, q.b]);
  const onDoor = door.length === 1 && door[0].every(p => near(p[0], 7.885, 0.02) && p[1] >= -2.01 && p[1] <= -1.09);
  keep("room 1.4", { kind: "undercab", run });
  check("room: round the living room at 1.4 m: closed, a gap at the door", !r.error && run.loop && run.face === "down"
    && run.pts.length === 8 && run.pts.every(p => p[2] === 1.4) && gap.length === 1 && onDoor
    && near(R.lengthOf(run.pts, true), R.perimeter(LOOP).P, 0.01), { run, door });
});
tryCase("room: a cove over the doors needs no gap; windows only when asked", () => {
  const cove = R.roundRoom(LOOP, CEIL - 0.012, ops, { doors: true, windows: true, face: "up" }).run;
  const low = R.roundRoom(LOOP, 1.4, ops, { doors: true, windows: true }).run;
  const none = R.roundRoom(LOOP, 1.4, ops, { doors: false, windows: false }).run;
  keep("cove", { kind: "cove", run: cove });
  const under = R.roundRoom(LOOP, CEIL - 0.15, ops, { doors: true, windows: false }).run;      // 2.0 m: under the door's head
  check("room: a cove over the doors needs no gap; windows only when asked", !cove.gaps && under.gaps.length === 1 && cove.pts.length === 6 && cove.face === "up"
    && low.gaps.length === 2 && low.pts.length === 10 && !none.gaps && none.pts.length === 6, { cove, low: low.gaps, none: none.pts.length });
});
tryCase("room: too small, all doors or too many corners: said plainly", () => {
  const tiny = R.roundRoom([[0, 0], [0.04, 0], [0.04, 0.04]], 1, []);
  const ring = []; for (let i = 0; i < 80; i++) ring.push([Math.cos(i / 80 * 2 * Math.PI) * 5, Math.sin(i / 80 * 2 * Math.PI) * 5]);
  const many = R.roundRoom(ring, 1, []);
  check("room: too small, all doors or too many corners: said plainly", !!tiny.error && /64 points/.test(many.error || ""), { tiny, many });
});
tryCase("room: along a deck's rail, wire where there is none", () => {
  const deck = T.per.rooms.find(r => r.name === "Upper Deck"), rails = T.per.pieces.filter(pc => pc.kind === "rail").map(pc => ({ a: [pc.x0, pc.y0], b: [pc.x1, pc.y1] }));
  const r = R.alongRail(R.insetLoop(deck.pts, 0.03), rails), noRail = R.alongRail(R.insetLoop(deck.pts, 0.03), []);
  keep("rail", { kind: "strip", run: r.run });
  check("room: along a deck's rail, wire where there is none", rails.length >= 3 && r.run.loop && r.run.pts.every(p => p[2] === R.RAIL_TOP_M)
    && (r.run.gaps || []).length === 4 - rails.length && noRail.run.pts.every(p => p[2] === 0.03) && !noRail.run.gaps, { r, rails: rails.length });
});

// ── piece ───────────────────────────────────────────────────────────────────
const TV = { id: "fur_000000aa", floor_id: "main", x_m: 0.71, y_m: -5.5, z_m: 0.95, rotation: 270, recipe: { kind: "tv", width_m: 1.3, depth_m: 0.08, height_m: 0.8 } };
tryCase("piece: its own frame, both ways, as the server has it", () => {
  const p = [0.4, -0.05, 0.3], q = R.piecePoint(TV, p), back = R.onPieceFrame(TV, q);
  // At 270°: across is (0, -1), its front (1, 0) (live_aboard_pieces.js acrossOf, frontOf).
  check("piece: its own frame, both ways, as the server has it", nearPt(q, [0.66, -5.9, 1.25]) && nearPt(back, p), { q, back });
});
tryCase("piece: behind, under and along the top, on the piece", () => {
  const behind = R.roundPiece(TV, { w: 1.3, d: 0.08, h: 0.8 }, "behind").run;
  const cab = { ...TV, id: "fur_000000bb", z_m: 1.45, rotation: 90 }, under = R.roundPiece(cab, { w: 2.4, d: 0.35, h: 0.7 }, "under").run;
  const bed = { ...TV, id: "fur_000000cc", z_m: 0, rotation: 0 }, glow = R.roundPiece(bed, { w: 1.7, d: 2.2, h: 1.1 }, "under").run;
  const top = R.roundPiece(cab, { w: 2.4, d: 0.35, h: 0.7 }, "top").run;
  for (const [w, run] of [["behind", behind], ["under", under], ["glow", glow], ["top", top]]) keep(w, { kind: "strip", run });
  check("piece: behind, under and along the top, on the piece", behind.piece === TV.id && behind.loop && behind.face === "wall"
    && behind.pts.every(p => near(p[1], -0.036)) && under.face === "down" && !under.loop && under.pts.every(p => p[2] === 0)
    && glow.loop && glow.pts.length === 4 && glow.face === "down" && top.face === "up" && top.pts.every(p => near(p[2], 0.712)),
    { behind, under, glow, top });
});
tryCase("piece: the run moves and turns with its piece", () => {
  const run = R.roundPiece(TV, { w: 1.3, d: 0.08, h: 0.8 }, "behind").run;
  const at0 = R.placed(run, { [TV.id]: TV }).pts;
  const moved = { ...TV, x_m: 5.0, y_m: -2.0, z_m: 1.2, rotation: 0 };
  const at1 = R.placed(run, { [TV.id]: moved }).pts;
  // Turned 90° and moved: each point the same distance from the piece's middle, raised with it.
  const r0 = at0.map(p => Math.hypot(p[0] - TV.x_m, p[1] - TV.y_m)), r1 = at1.map(p => Math.hypot(p[0] - 5, p[1] + 2));
  const gone = R.placed(run, {});
  check("piece: the run moves and turns with its piece", r0.every((v, i) => near(v, r1[i], 2e-3)) && at1.every((p, i) => near(p[2] - at0[i][2], 0.25, 2e-3))
    && near(at1[0][1], -2.036) && gone === null && R.placed({ ...run, piece: undefined }, {}) !== null, { at0, at1 });
});
tryCase("piece: removed, its run stays where it was (one step)", () => {
  const run = R.roundPiece(TV, { w: 1.3, d: 0.08, h: 0.8 }, "behind").run, before = R.placed(run, { [TV.id]: TV }).pts;
  const cur = { lights: { "light.tv": { kind: "tv", run }, "light.x": { run: { ...run, piece: "fur_000000ff" } } }, pieces: {} };
  const ids = R.keepRunsOf(cur, { [TV.id]: TV });
  const after = cur.lights["light.tv"].run;
  keep("detached", { kind: "tv", run: after });
  check("piece: removed, its run stays where it was (one step)", JSON.stringify(ids) === '["light.tv"]' && !after.piece
    && after.pts.every((p, i) => nearPt(p, before[i])) && cur.lights["light.x"].run.piece === "fur_000000ff", { ids, after });
});

// ── string ──────────────────────────────────────────────────────────────────
tryCase("string: a catenary: its ends fixed, its middle the sag below the line", () => {
  const a = [0, 0, 2.4], b = [4, 0, 2.2], c = R.catenary(a, b, 0.3, 16), mid = c[8];
  // A catenary is flatter than a parabola near its middle and steeper at its ends; symmetric about the middle.
  const sym = [2, 5].every(k => near(c[k][2] - (2.4 - 0.2 * k / 16), c[16 - k][2] - (2.4 - 0.2 * (16 - k) / 16), 1e-9));
  check("string: a catenary: its ends fixed, its middle the sag below the line", nearPt(c[0], a) && nearPt(c[16], b)
    && near(mid[2], 2.3 - 0.3, 1e-9) && sym && c.every(p => p[2] <= 2.4 + 1e-9), { mid, c4: c[4] });
});
tryCase("string: a bulb every so often along the wire", () => {
  const run = { pts: [[0, 0, 2.4], [6, 0, 2.4], [6, 4, 2.2]], face: "room", loop: false, sag_m: 0.3, spacing_m: 0.4 };
  const S = R.stringOf(run), d = [];
  for (let i = 1; i < S.bulbs.length; i++) d.push(Math.hypot(...S.bulbs[i].map((v, k) => v - S.bulbs[i - 1][k])));
  const wireLen = S.wire.reduce((s, [p, q]) => s + Math.hypot(q[0] - p[0], q[1] - p[1], q[2] - p[2]), 0);
  const gapRun = R.stringOf({ ...run, gaps: [1] }), dense = R.stringOf({ ...run, spacing_m: 0.15 });
  keep("string", { kind: "string", run });
  check("string: a bulb every so often along the wire", Math.abs(S.bulbs.length - Math.round(wireLen / 0.4)) <= 1
    && d.filter(v => v < 0.3 || v > 0.401).length <= 1 && gapRun.bulbs.length < S.bulbs.length * 0.7
    && dense.bulbs.length > S.bulbs.length * 2.4 && S.bulbs.every(p => p[2] <= 2.4 + 1e-9), { n: S.bulbs.length, wireLen, dmin: Math.min(...d), dmax: Math.max(...d) });
});

// ── build ───────────────────────────────────────────────────────────────────
const parts = (eid, kind, run, furniture = []) => { const L = T.by[eid]; return H.fixtureParts({ ...L, kind, run }, T.ctxOf(L, furniture)); };
const tapes = (P) => P.bulbs.filter(b => b.prim === "box" && b.mat);
tryCase("build: one continuous tape round a room, a box a stretch, no dots", () => {
  const run = R.roundRoom(LOOP, CEIL - 0.012, ops, { face: "up" }).run, P = parts("light.cove", "cove", run);
  // Each stretch's box reaches the next one's outer edge (a closed mitre): its
  // length grows by half the tape's width × tan(half the turn) at a corner.
  const st = R.stretches(run.pts, true), ok = tapes(P).every((b, i) => {
    const q = st[i], L = Math.hypot(q.b[0] - q.a[0], q.b[1] - q.a[1]), len = Math.hypot(b.mat[0], b.mat[1], b.mat[2]);
    return near(len, L + 2 * R.TAPE_M / 2, 1e-6);                                  // every corner here is square
  });
  check("build: one continuous tape round a room, a box a stretch, no dots", P.bulbs.length === st.length && tapes(P).length === st.length
    && P.halos.length === 0 && ok && P.kind === "cove" && P.bulbs.every(b => b.hideOff), { bulbs: P.bulbs.length, halos: P.halos.length });
});
tryCase("build: its light per face, per stretch", () => {
  const strip = { pts: [[9.785, -0.8, 1.4], [9.785, -5.985, 1.4]], loop: false };
  const count = (face) => { const P = parts("light.under", "undercab", { ...strip, face }); return { washes: P.washes.length, pools: P.pools.length, tex: P.washes.map(w => w.tex).join(), up: P.washes.map(w => Math.sign(w.b[1])).join() }; };
  const got = { up: count("up"), down: count("down"), room: count("room"), wall: count("wall") };
  check("build: its light per face, per stretch", got.up.washes === 1 && got.up.up === "1"
    && got.down.washes === 2 && got.down.up === "-1,0" && got.room.washes === 2 && got.room.pools === 1
    && got.wall.washes === 1 && got.wall.tex === "round", got);
});
tryCase("build: under the cabinets, light lands on the counter (a piece) or at counter height", () => {
  const run = { pts: [[9.785, -0.8, 1.4], [9.785, -5.985, 1.4]], loop: false, face: "down" };
  const counter = { id: "fur_00000c01", floor_id: "main", x_m: 9.5, y_m: -3.4, z_m: 0, rotation: 90, recipe: { kind: "box", width_m: 5, depth_m: 0.6, height_m: 0.95 } };
  const flatOf = (P) => P.washes.find(w => w.fixed);
  const a = flatOf(parts("light.under", "undercab", run)), b = flatOf(parts("light.under", "undercab", run, [counter])), c = flatOf(parts("light.under", "strip", run));
  check("build: under the cabinets, light lands on the counter (a piece) or at counter height", near(a.h, 0.926) && near(b.h, 0.966) && near(c.h, 0.016), [a.h, b.h, c.h]);
});
tryCase("build: the wire past a door is never lit", () => {
  const run = R.roundRoom(LOOP, 1.4, ops, { face: "down" }).run, P = parts("light.cove", "undercab", run);
  check("build: the wire past a door is never lit", tapes(P).length === run.pts.length - run.gaps.length
    && P.picks.every(p => !(near(p.x, 7.885, 0.03) && p.y > -1.99 && p.y < -1.11)), { tapes: tapes(P).length, pts: run.pts.length });
});
tryCase("build: a sloped stretch (stairs) tilts its tape", () => {
  const run = { pts: [[1, -7.985, 0.3], [4, -7.985, 1.8]], loop: false, face: "room" }, b = tapes(parts("light.cove", "kick", run))[0];
  const ux = b.mat[0], uy = b.mat[1], len = Math.hypot(b.mat[0], b.mat[1], b.mat[2]);
  check("build: a sloped stretch (stairs) tilts its tape", near(uy / len, 1.5 / Math.hypot(3, 1.5), 1e-6) && near(ux / len, 3 / Math.hypot(3, 1.5), 1e-6)
    && near(b.mat[13], 1.05), b.mat);
});
tryCase("build: string lights: the wire, a bulb and a glow every so often, shaded when off", () => {
  const run = { pts: [[0.3, -1.8, 2.4], [-2.8, -1.0, 2.2], [0.3, 0.5, 2.4], [-2.8, 2.0, 2.2]], loop: false, face: "room", sag_m: 0.25, spacing_m: 0.4 };
  const P = parts("light.deck", "string", run), n = R.stringOf(run).bulbs.length;
  check("build: string lights: the wire, a bulb and a glow every so often, shaded when off", P.kind === "string" && P.bulbs.length === n
    && P.halos.length === n && P.bulbs.every(b => b.prim === "sphere" && !b.hideOff) && P.housings.length > 20 && P.housings.every(h => h.mat)
    && P.pools.length === 3 && P.where === "out", { bulbs: P.bulbs.length, halos: P.halos.length, wire: P.housings.length });
});
tryCase("build: a string with no run yet hangs one swag along its marker", () => {
  const P = H.fixtureParts({ ...T.by["light.deck"], kind: "string" }, T.ctxOf(T.by["light.deck"]));
  check("build: a string with no run yet hangs one swag along its marker", P.kind === "string" && P.bulbs.length >= 4 && P.halos.length === P.bulbs.length,
    { bulbs: P.bulbs.length });
});
tryCase("build: a light with no run is drawn exactly as before", () => {
  const same = ["light.cove", "light.under", "light.deck", "light.tv"].every(eid => {
    const L = T.by[eid], ctx = T.ctxOf(L);
    return JSON.stringify(H.fixtureParts(L, ctx)) === JSON.stringify(H.fixtureParts({ ...L, run: null }, ctx));
  });
  check("build: a light with no run is drawn exactly as before", same && !("run" in H.fixtureParts(T.by["light.under"], T.ctxOf(T.by["light.under"]))));
});
tryCase("build: a run whose piece is gone is drawn as guessed", () => {
  const own = R.readRun({ run: R.roundPiece(TV, { w: 1.3, d: 0.08, h: 0.8 }, "behind").run });
  check("build: a run whose piece is gone is drawn as guessed", own && R.placed(own, {}) === null && R.placed(own, { [TV.id]: TV }) !== null);
});

// ── check ───────────────────────────────────────────────────────────────────
tryCase("check: the server's rules, here first", () => {
  const good = { pts: [[0, 0, 1], [1, 0, 1]], face: "up", loop: false };
  const bad = [{ ...good, pts: [[0, 0, 1]] }, { ...good, face: "x" }, { ...good, pts: [[0, 0, 1], [0.03, 0, 1]] }, { ...good, pts: [[0, 0, -1], [1, 0, 1]] },
    { ...good, loop: true }, { ...good, pts: [[0, 0, 1], [60, 0, 1], [60, 50, 1]] }, { ...good, sag_m: 2 }, { ...good, spacing_m: 0.1 },
    { ...good, gaps: [0] }, { ...good, piece: "sofa" }];
  check("check: the server's rules, here first", R.problem(good) === null && bad.every(r => typeof R.problem(r) === "string")
    && R.readRun({ run: bad[1] }) === null && R.readRun({ run: good }) === good, bad.map(r => R.problem(r)));
});
tryCase("check: tidy: to the millimetre, close points merged, gaps follow their points", () => {
  const t = R.tidy({ pts: [[0, 0, 1.00049], [0.02, 0, 1], [2, 0, 1], [2, 2, 1], [0, 2, 1], [0.01, 0.03, 1]], face: "up", loop: true, gaps: [2], piece: "fur_00000001" }).run;
  check("check: tidy: to the millimetre, close points merged, gaps follow their points", JSON.stringify(t.pts) === "[[0,0,1],[2,0,1],[2,2,1],[0,2,1]]"
    && JSON.stringify(t.gaps) === "[1]" && t.loop && t.piece === "fur_00000001" && !!R.tidy({ pts: [[0, 0, 1], [0.01, 0, 1]], face: "up", loop: false }).error, t);
});
tryCase("check: heights snap to a chip, a piece's edge or the ceiling within 3 cm", () => {
  const c = R.chips(CEIL), s = (h, e) => R.snapHeight(h, CEIL, e);
  check("check: heights snap to a chip, a piece's edge or the ceiling within 3 cm",
    c.map(x => x[0]).join() === "kick,counter,undercab,valance,cove,ceiling" && near(c[4][2], 2.0) && near(c[5][2], 2.138)
    && s(1.38).h === 1.4 && s(1.38).snap === "Under cabinets 140 cm" && s(1.2).h === 1.2 && s(1.2).snap === null
    && s(1.47, [{ h: 1.45, label: "the piece's underside" }]).h === 1.45 && s(3.5).h === 2.138 && s(-1).h === 0,
    { c, a: s(1.38), b: s(1.47, [{ h: 1.45, label: "u" }]) });
});

// ── draft ───────────────────────────────────────────────────────────────────
tryCase("draft: the run is the editor's, sent whole with the light's height and kind", () => {
  const run = { pts: [[0, 0, 1], [1, 0, 1]], face: "up", loop: false };
  const v = D.ownedOf({ lights: { "light.a": { z_m: 1, kind: "cove", run }, "light.b": { run: { future: 1 } }, "light.c": { kind: "tv" } } });
  const d = D.createDraft(v);
  d.change(c => { c.lights["light.a"] = { ...c.lights["light.a"], run: { ...run, face: "down" } }; c.lights["light.c"] = { kind: "tv", run }; });
  const ch = d.changes();
  check("draft: the run is the editor's, sent whole with the light's height and kind", JSON.stringify(v.lights["light.a"]) === JSON.stringify({ z_m: 1, kind: "cove", run })
    && JSON.stringify(v.lights["light.b"]) === '{"run":{"future":1}}' && JSON.stringify(ch.lights["light.a"]) === JSON.stringify({ z_m: 1, kind: "cove", run: { ...run, face: "down" } })
    && JSON.stringify(ch.lights["light.c"]) === JSON.stringify({ kind: "tv", run }) && Object.keys(ch.lights).length === 2, { v: v.lights, ch });
});
tryCase("draft: what the view rebuilds from takes in a run and its piece's place", () => {
  const run = { pts: [[0, 0, 1], [1, 0, 1]], face: "up", loop: false, piece: TV.id };
  const a = R.runsSignature({ lights: { "light.a": { run } }, pieces: { [TV.id]: TV } }), b = R.runsSignature({ lights: { "light.a": { run } }, pieces: { [TV.id]: { ...TV, x_m: 2 } } });
  const c = R.runsSignature({ lights: { "light.a": { z_m: 1 } }, pieces: {} });
  check("draft: what the view rebuilds from takes in a run and its piece's place", a !== b && c === "[]" && R.runsSignature(null) === "[]", { a, b });
});

console.log(JSON.stringify({ cases, failures, payloads }));
