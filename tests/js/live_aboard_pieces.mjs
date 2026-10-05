// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
//
// Live Aboard's furniture rules (views/live_aboard_pieces.js), run for real
// against a house read by views/live_aboard_house.js, with a door drawn in
// 3D (views/live_aboard_draft.js).
//
//   ids      "fur_" + 8 hex digits; the file read tolerantly, every key kept
//   turn     15° steps, onto the steps from a slanted wall; [0, 360)
//   face     rotation 0 faces down the plan, 90 left; the 3D yaw is its mirror
//   height   0 up to the ceiling less the piece's height; never under 0
//   floors   Floor ▲ / ▼: the nearest floor higher / lower, none past the ends
//   place    in the room under the view's centre, else the nearest room's
//            name spot; facing into the room, away from its nearest wall
//   snap     within 0.25 m of a wall at any angle: back flush, turned to it;
//            only where the wall is solid for the piece's whole height
//   fit      into a wall; overlapping another piece (in 3D: a lamp on a table
//            is fine); in a door's swing; before a dresser's front or a bed's
//            side; taller than a window's sill in front of it; a rug never
//   exact    arrow keys step 1 cm (Shift 10 cm) the way the view is seen;
//            turned by any angle
//   gaps     from each side of a piece straight out to the first wall's face
//            (a door's or a window's line too), the nearer on each axis
//   stand    onto the top of the piece its middle is over, never onto what
//            hangs above it; nothing under it, the floor
//   hang     its middle at the height asked, its back flat on the nearest
//            wall solid there (never a window's glass or a doorway), facing
//            out, under the ceiling
//
// usage: live_aboard_pieces.mjs <www/padspan-ha dir>
// prints one JSON line: { cases: {name: result}, failures: [...], payloads: [...] }
// payloads: what Save would send for pieces these rules make at their edges,
// which the server's own apply_edit must take (test_live_aboard_pieces.py).

import { pathToFileURL } from "node:url";
import { join } from "node:path";

const WWW = process.argv[2];
if (!WWW) { console.error("usage: live_aboard_pieces.mjs <www/padspan-ha dir>"); process.exit(2); }
const P = await import(pathToFileURL(join(WWW, "views", "live_aboard_pieces.js")).href);
const H = await import(pathToFileURL(join(WWW, "views", "live_aboard_house.js")).href);
const D = await import(pathToFileURL(join(WWW, "views", "live_aboard_draft.js")).href);

const failures = [];
const cases = {};
const payloads = [];
const check = (name, ok, detail) => { cases[name] = !!ok; if (!ok) failures.push({ name, detail: detail === undefined ? null : detail }); };
const tryCase = (name, fn) => { try { fn(); } catch (e) { failures.push({ name, detail: String(e && e.stack || e).slice(0, 900) }); cases[name] = false; } };
const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;
const rect = (floor_id, x0, y0, x1, y1) => ({ type: "poly", floor_id, points_m: [[x0, y0], [x1, y0], [x1, y1], [x0, y1]] });

// Two rooms side by side (the shared wall at x = 4.05), a window on the
// kitchen's front wall (y = 3, x 1 to 2.2), a door drawn in 3D in the shared
// wall (y 1 to 1.9), a floor above and one below.
const MODEL = {
  floors: [{ id: "main", name: "Main", level: 0 }, { id: "up", name: "Up", level: 1 }, { id: "down", name: "Basement", level: -1 }],
  floor_elevations: { main: 0, up: 2.8, down: -2.6 },
  room_geometry_m: { Kitchen: rect("main", 0, 0, 4, 3), Hall: rect("main", 4.1, 0, 9, 3), Loft: rect("up", 0, 0, 6, 3) },
  rf_barriers_m: [{ id: "bar_win", name: "Kitchen window", material: "glass", floor_id: "main", points_m: [[1, 3], [2.2, 3]] }],
};
const CEIL = 2.8 - H.SLAB_T;
const DOOR = D.newOpening("door", "main", [4.05, 1.0], [4.05, 1.9], CEIL);
const house = H.readHouse(MODEL, MODEL.floors, {}, null);
D.applyOpenings(house, { door_0000000d: DOOR });
const main = house.byId.get("main");
const per = house.perFloor.get(main);
const walls = per.pieces.map(pc => ({ ...pc, els: H.wallElements(pc, main.h) }));
const doors = P.doorSwings(walls, (pc) => H.openingSwing(pc, per.rooms, pc.override || null));
const recipe = (kind, w, d, h, extra = {}) => ({ kind, params: {}, colors: ["#8a6f4e"], width_m: w, depth_m: d, height_m: h, ...extra });
const piece = (id, kind, w, d, h, at) => ({ id, recipe: recipe(kind, w, d, h), origin: "build", label: "", library_id: null, submission_id: null,
  floor_id: "main", x_m: at.x, y_m: at.y, z_m: at.z || 0, rotation: at.r || 0, entity_id: null, entity_reg_id: null });
const kinds = (list) => list.map(w => w.kind).sort();

// ── ids ─────────────────────────────────────────────────────────────────────
tryCase("ids: fur_ and 8 hex digits; the file read tolerantly, every key kept", () => {
  const ids = [P.newPieceId(), P.newPieceId(), P.newPieceId(() => 0.999)];
  // The draft reads the file (live_aboard_draft.js ownedOf): pieces whole.
  const got = D.ownedOf({ pieces: { fur_0000000a: { recipe: { kind: "sofa" }, floor_id: "main", future: { k: 1 } },
                                    fur_0000000b: { recipe: "sofa", floor_id: "main" }, fur_1: { recipe: {}, floor_id: "main" },
                                    fur_0000000c: { recipe: { kind: "lamp" } }, fur_0000000e: [1] } }).pieces;
  check("ids: fur_ and 8 hex digits; the file read tolerantly, every key kept",
    ids.every(i => P.PIECE_ID.test(i)) && ids[2] === "fur_ffffffff" && JSON.stringify(Object.keys(got)) === '["fur_0000000a"]'
    && got.fur_0000000a.future.k === 1 && Object.keys(D.ownedOf(null).pieces).length === 0
    && Object.keys(D.ownedOf({ pieces: [1] }).pieces).length === 0, { ids, got });
});

// ── turn and face ───────────────────────────────────────────────────────────
tryCase("turn: 15° steps, onto the steps from a slanted wall, kept in [0, 360)", () => {
  const got = [P.turned(0, 1), P.turned(0, -1), P.turned(7, 1), P.turned(7, -1), P.turned(345, 1), P.turned(352.5, 1),
               P.normRot(-15), P.normRot(360), P.normRot(359.9999), P.normRot(725.5), P.normRot(-0.0001)];
  check("turn: 15° steps, onto the steps from a slanted wall, kept in [0, 360)",
    JSON.stringify(got) === JSON.stringify([15, 345, 15, 0, 0, 0, 345, 0, 0, 5.5, 0]) && !Object.is(P.normRot(-0.0001), -0), got);
});
tryCase("face: 0 faces down the plan, 90 left; facing a way gives its rotation; the yaw mirrors it", () => {
  const f0 = P.frontOf(0), f90 = P.frontOf(90), a90 = P.acrossOf(90);
  const ok = near(f0[0], 0) && near(f0[1], 1) && near(f90[0], -1) && near(f90[1], 0) && near(a90[0], 0) && near(a90[1], 1)
    && P.rotFacing(0, 1) === 0 && P.rotFacing(-1, 0) === 90 && P.rotFacing(1, 0) === 270 && P.rotFacing(0, -1) === 180
    && near(P.yawOfRot(90), -Math.PI / 2);
  // three.js turning +z (a builder's front) by the yaw lands on the plan's front.
  const yaw = P.yawOfRot(30), fr = P.frontOf(30);
  check("face: 0 faces down the plan, 90 left; facing a way gives its rotation; the yaw mirrors it",
    ok && near(Math.sin(yaw), fr[0]) && near(Math.cos(yaw), fr[1]), { f0, f90, a90 });
});

// ── height ──────────────────────────────────────────────────────────────────
tryCase("height: 0 up to the ceiling less the piece's height", () => {
  const got = [P.zMax(CEIL, 0.8), P.clampZ(5, CEIL, 0.8), P.clampZ(-1, CEIL, 0.8), P.clampZ(1.2049, CEIL, 0.6), P.zMax(CEIL, 3.5),
               P.clampZ(0.5, CEIL, 3.5), P.clampZ(NaN, CEIL, 1)];
  check("height: 0 up to the ceiling less the piece's height", JSON.stringify(got) === JSON.stringify([1.85, 1.85, 0, 1.205, 0, 0, 0]), got);
});
tryCase("height: the sizes are the server's, and a recipe without one is half a metre", () => {
  const s = P.sizeOf({ width_m: 0.0005, depth_m: 99, height_m: "2" }), e = P.sizeOf(null), rug = P.sizeOf({ height_m: 0.012 });
  check("height: the sizes are the server's, and a recipe without one is half a metre",
    s.w === 0.001 && s.d === 8 && s.h === 0.5 && e.w === 0.5 && e.d === 0.5 && e.h === 0.5 && rug.h === 0.012, { s, e, rug });
});

// ── floors ──────────────────────────────────────────────────────────────────
tryCase("floors: ▲ the nearest floor higher, ▼ lower; none past the top or the bottom", () => {
  const fl = [{ id: "down", elev: -2.6 }, { id: "main", elev: 0 }, { id: "outside", elev: 0, outdoor: true }, { id: "up", elev: 2.8 },
              { id: "attic", elev: 5.6 }];
  const got = [P.floorStep(fl, "main", 1), P.floorStep(fl, "main", -1), P.floorStep(fl, "up", 1), P.floorStep(fl, "attic", 1),
               P.floorStep(fl, "down", -1), P.floorStep(fl, "outside", 1), P.floorStep(fl, "gone", 1), P.floorStep(house.floors, "main", 1)];
  check("floors: ▲ the nearest floor higher, ▼ lower; none past the top or the bottom",
    JSON.stringify(got) === JSON.stringify(["up", "down", "attic", null, null, "up", null, "up"]), got);
});
// Two indoor floors on one storey (Main and Garage share a base): ▲/▼ step
// through them in list order, so every floor can be reached.
tryCase("floors: two indoor floors at the same height are both reached, in list order", () => {
  const fl = [{ id: "main", elev: 0 }, { id: "garage", elev: 0 }, { id: "yard", elev: 0, outdoor: true }, { id: "up", elev: 2.8 }];
  const got = [P.floorStep(fl, "main", 1), P.floorStep(fl, "garage", 1), P.floorStep(fl, "up", -1), P.floorStep(fl, "garage", -1),
               P.floorStep(fl, "main", -1), P.floorStep(fl, "yard", 1)];
  check("floors: two indoor floors at the same height are both reached, in list order",
    JSON.stringify(got) === JSON.stringify(["garage", "up", "main", "main", null, "up"]), got);
});

// ── place ───────────────────────────────────────────────────────────────────
tryCase("place: in the room under the view's centre, facing away from its nearest wall", () => {
  const s = P.spotFor(per.rooms, 1.0, 0.6);           // in the kitchen, nearest its back wall (y = 0)
  const t = P.spotFor(per.rooms, 3.6, 1.5);           // nearest the shared wall (x = 4): faces -x
  check("place: in the room under the view's centre, facing away from its nearest wall",
    s.room && s.room.name === "Kitchen" && s.x === 1 && s.y === 0.6 && s.rotation === 0 && t.rotation === 90, { s, t: { ...t, room: t.room && t.room.name } });
});
tryCase("place: outside every room, the nearest room's name spot", () => {
  const s = P.spotFor(per.rooms, 20, 1.5), none = P.spotFor([], 3, 4);
  const hall = per.rooms.find(r => r.name === "Hall");
  check("place: outside every room, the nearest room's name spot",
    s.room === hall && near(s.x, Math.round(hall.spot.x * 1000) / 1000) && near(s.y, Math.round(hall.spot.y * 1000) / 1000)
    && none.room === null && none.x === 3 && none.y === 4, { s: { ...s, room: s.room && s.room.name }, spot: hall.spot });
});
tryCase("place: a new piece and its copy", () => {
  const r = recipe("sofa", 2.2, 0.9, 0.8);
  const p = P.makePiece(r, "main", { x: 1.23456, y: 2, rotation: -90 }, "library");
  const c = P.duplicateOf({ ...p, entity_id: "light.a", entity_reg_id: "abc", submission_id: "sub_1", updated_at: "x" });
  r.width_m = 9;                                        // the piece holds its own copy
  check("place: a new piece and its copy",
    P.PIECE_ID.test(p.id) && p.x_m === 1.235 && p.rotation === 270 && p.origin === "library" && p.z_m === 0 && p.recipe.width_m === 2.2
    && c.id !== p.id && c.x_m === 1.535 && c.y_m === 2.3 && c.entity_id === null && c.entity_reg_id === null && c.submission_id === null
    && !("updated_at" in c) && JSON.stringify(c.recipe) === JSON.stringify(p.recipe), { p, c });
  payloads.push({ pieces: { [p.id]: p, [c.id]: c } });
});

// ── snap ────────────────────────────────────────────────────────────────────
const backWall = walls.find(w => w.kind === "wall" && Math.abs(w.y0 - w.y1) < 1e-6 && Math.max(w.y0, w.y1) < 0.2 && Math.min(w.x0, w.x1) < 2 && Math.max(w.x0, w.x1) > 2);
tryCase("snap: within 0.25 m of a wall, its back flush and turned away from it", () => {
  const sofa = piece("fur_00000001", "sofa", 2.2, 0.9, 0.8, { x: 2, y: 0.65, r: 37 });
  const s = P.snapToWall(sofa, null, walls), far = P.snapToWall({ ...sofa, y_m: 1.2 }, null, walls);
  const flush = backWall.y0 + backWall.thick / 2 + 0.45;
  check("snap: within 0.25 m of a wall, its back flush and turned away from it",
    s && near(s.y_m, Math.round(flush * 1000) / 1000) && s.x_m === 2 && s.rotation === 0 && far === null, { s, far, flush });
});
tryCase("snap: a slanted wall turns the piece to it", () => {
  const a = [0, 0], b = [Math.cos(Math.PI / 6) * 4, Math.sin(Math.PI / 6) * 4];          // 30° down the plan
  const w = { x0: a[0], y0: a[1], x1: b[0], y1: b[1], thick: 0.1, kind: "wall", els: [{ z0: -0.15, z1: CEIL, glass: false }] };
  const n = [-Math.sin(Math.PI / 6), Math.cos(Math.PI / 6)];                               // its side down the plan
  const mid = [(a[0] + b[0]) / 2 + n[0] * 0.5, (a[1] + b[1]) / 2 + n[1] * 0.5];
  const s = P.snapToWall(piece("fur_00000002", "dresser", 1.0, 0.5, 0.9, { x: mid[0], y: mid[1], r: 0 }), null, [w]);
  const fr = s && P.frontOf(s.rotation), back = s && [s.x_m - fr[0] * 0.25, s.y_m - fr[1] * 0.25];
  const gap = back && (back[0] - (a[0] + b[0]) / 2) * n[0] + (back[1] - (a[1] + b[1]) / 2) * n[1];
  check("snap: a slanted wall turns the piece to it", s && near(fr[0], n[0], 1e-3) && near(fr[1], n[1], 1e-3) && near(gap, 0.05, 2e-3),
    { s, fr, n, gap });
});
tryCase("snap: only where the wall is solid for the piece's whole height", () => {
  const under = P.snapToWall(piece("fur_00000003", "sofa", 1.0, 0.8, 0.8, { x: 1.6, y: 2.4, r: 0 }), null, walls);
  const tall = P.snapToWall(piece("fur_00000004", "wardrobe", 1.0, 0.6, 2.0, { x: 1.6, y: 2.45, r: 0 }), null, walls);
  const doorway = P.snapToWall({ ...piece("fur_00000005", "chair", 0.5, 0.5, 0.9, { x: 3.6, y: 1.45, r: 0 }) }, null, walls);
  const winWall = (s) => s && walls[s.wall].kind;
  check("snap: only where the wall is solid for the piece's whole height",
    under && winWall(under) === "window" && near(under.rotation, 180) && (!tall || winWall(tall) !== "window") && (!doorway || winWall(doorway) !== "door"),
    { under, tall, doorway, kinds: [winWall(under), winWall(tall), winWall(doorway)] });
});

// ── fit ─────────────────────────────────────────────────────────────────────
const scene = (others = []) => ({ walls, doors, others });
tryCase("fit: into a wall; snapped flush is not", () => {
  const across = piece("fur_00000010", "table", 1.0, 0.8, 0.75, { x: 4.05, y: 2.5 });
  const sofa = piece("fur_00000011", "sofa", 2.2, 0.9, 0.8, { x: 2, y: 0.65 });
  const s = P.snapToWall(sofa, null, walls), flush = { ...sofa, ...s };
  check("fit: into a wall; snapped flush is not",
    kinds(P.fitChecks(across, scene())).includes("wall") && P.fitChecks(flush, scene()).length === 0,
    { across: P.fitChecks(across, scene()), flush: P.fitChecks(flush, scene()) });
});
tryCase("fit: overlapping another piece, in 3D: a lamp on a table is fine, in it is not", () => {
  const table = piece("fur_00000020", "table", 1.2, 0.8, 0.75, { x: 2, y: 1.5 });
  const onTop = piece("fur_00000021", "lamp", 0.3, 0.3, 0.6, { x: 2, y: 1.5, z: 0.75 });
  const inside = piece("fur_00000022", "lamp", 0.3, 0.3, 0.6, { x: 2.3, y: 1.5, z: 0.2 });
  const rug = piece("fur_00000023", "rug", 2, 1.5, 0.02, { x: 2, y: 1.5 });
  const a = P.fitChecks(onTop, scene([table, rug])), b = P.fitChecks(inside, scene([table, rug])), c = P.fitChecks(rug, scene([table]));
  const d = P.fitChecks(table, scene([rug, inside]));
  check("fit: overlapping another piece, in 3D: a lamp on a table is fine, in it is not",
    a.length === 0 && b.length === 1 && b[0].kind === "overlap" && b[0].with === "fur_00000020" && c.length === 0
    && d.length === 1 && d[0].with === "fur_00000022", { a, b, c, d });
});
tryCase("fit: in a door's swing", () => {
  const sw = doors[0];
  const inIt = piece("fur_00000030", "chair", 0.5, 0.5, 0.9, { x: sw.hx + (sw.ux + sw.sx) * 0.35, y: sw.hy + (sw.uy + sw.sy) * 0.35 });
  const behind = piece("fur_00000031", "chair", 0.5, 0.5, 0.9, { x: sw.hx - sw.sx * 0.6 + sw.ux * 0.4, y: sw.hy - sw.sy * 0.6 + sw.uy * 0.4 });
  const above = { ...inIt, z_m: 2.2, recipe: recipe("shelf", 0.5, 0.3, 0.3) };
  check("fit: in a door's swing",
    doors.length === 1 && kinds(P.fitChecks(inIt, scene())).includes("door") && !kinds(P.fitChecks(behind, scene())).includes("door")
    && !kinds(P.fitChecks(above, scene())).includes("door"),
    { doors, inIt: P.fitChecks(inIt, scene()), behind: P.fitChecks(behind, scene()), above: P.fitChecks(above, scene()) });
});
tryCase("fit: before a dresser's front, beside a bed; a TV hung above the dresser is not", () => {
  const dresser = piece("fur_00000040", "dresser", 1.2, 0.5, 0.9, { x: 6, y: 0.4 });
  const stool = piece("fur_00000041", "chair", 0.4, 0.4, 0.5, { x: 6, y: 0.9 });
  const tv = piece("fur_00000042", "tv", 1.0, 0.1, 0.6, { x: 6, y: 0.75, z: 1.2 });
  const bed = piece("fur_00000043", "bed", 1.6, 2.0, 0.6, { x: 6.5, y: 1.2, r: 0 });
  const bySide = piece("fur_00000044", "chair", 0.4, 0.4, 0.5, { x: 7.6, y: 1.6 });
  const atHead = piece("fur_00000045", "nightstand", 0.4, 0.4, 0.5, { x: 7.55, y: 0.4 });
  const a = P.fitChecks(stool, scene([dresser])), b = P.fitChecks(dresser, scene([stool])), c = P.fitChecks(tv, scene([dresser]));
  const e = P.fitChecks(bySide, scene([bed])), f = P.fitChecks(atHead, scene([bed]));
  check("fit: before a dresser's front, beside a bed; a TV hung above the dresser is not",
    a.some(w => w.kind === "blocks" && w.what === "front") && b.some(w => w.kind === "blocked" && w.with === "fur_00000041")
    && c.length === 0 && e.some(w => w.kind === "blocks" && w.what === "side") && !f.some(w => w.kind === "blocks"), { a, b, c, e, f });
});
tryCase("fit: taller than a window's sill in front of it; under it is fine", () => {
  const tall = piece("fur_00000050", "wardrobe", 1.0, 0.6, 2.0, { x: 1.6, y: 2.6, r: 180 });
  const low = piece("fur_00000051", "sofa", 1.0, 0.8, 0.8, { x: 1.6, y: 2.5, r: 180 });
  const elsewhere = piece("fur_00000052", "wardrobe", 1.0, 0.6, 2.0, { x: 3.2, y: 1.5, r: 90 });
  check("fit: taller than a window's sill in front of it; under it is fine",
    kinds(P.fitChecks(tall, scene())).includes("window") && !kinds(P.fitChecks(low, scene())).includes("window")
    && !kinds(P.fitChecks(elsewhere, scene())).includes("window"),
    { tall: P.fitChecks(tall, scene()), low: P.fitChecks(low, scene()), elsewhere: P.fitChecks(elsewhere, scene()) });
});

// ── the one draft ───────────────────────────────────────────────────────────
tryCase("draft: furniture is in the editor's one draft: a slider's drag one step, Discard undoable, Save whole or null", () => {
  const sofa = piece("fur_0000000a", "sofa", 2.2, 0.9, 0.8, { x: 1, y: 1 });
  const d = D.createDraft(D.ownedOf({ pieces: { fur_0000000a: sofa }, lights: { "light.a": { z_m: 2 } },
                                      devices: { "aa:bb": { recipe: { kind: "tag" } }, "sensor.t": { z_m: 1 } }, figures: { "person.a": { params: {} } } }));
  const lamp = P.makePiece(recipe("lamp", 0.4, 0.4, 0.6), "main", { x: 2, y: 2, rotation: 0 });
  d.change(c => { c.pieces[lamp.id] = lamp; });
  for (const z of [0.2, 0.5, 0.75]) d.change(c => { c.pieces.fur_0000000a.z_m = z; }, "slide:height");
  d.change(c => { c.pieces.fur_0000000a.floor_id = "up"; c.lights["light.a"] = { z_m: 1.5 }; });
  const ch = d.changes();
  const sent = ch && JSON.stringify(Object.keys(ch).sort()) === '["lights","pieces"]' && ch.pieces[lamp.id].recipe.kind === "lamp"
    && ch.pieces.fur_0000000a.z_m === 0.75 && ch.pieces.fur_0000000a.floor_id === "up" && ch.pieces.fur_0000000a.recipe.width_m === 2.2;
  d.undo();
  const oneStep = d.cur.pieces.fur_0000000a.z_m === 0.75 && d.cur.pieces.fur_0000000a.floor_id === "main";
  d.undo();
  const dragGone = d.cur.pieces.fur_0000000a.z_m === 0;
  d.redo(); d.redo();
  d.discard();
  const discarded = !d.dirty && !d.cur.pieces[lamp.id];
  d.undo();
  const back = d.cur.pieces[lamp.id] && d.cur.pieces.fur_0000000a.floor_id === "up";
  d.change(c => { delete c.pieces.fur_0000000a; delete c.devices["aa:bb"]; c.figures["person.a"] = { params: { height_m: 1.8 } }; });
  const ch2 = d.changes();
  const removed = ch2.pieces.fur_0000000a === null && ch2.devices["aa:bb"] === null && ch2.figures["person.a"].params.height_m === 1.8
    && !("sensor.t" in ch2.devices);
  check("draft: furniture is in the editor's one draft: a slider's drag one step, Discard undoable, Save whole or null",
    sent && oneStep && dragGone && discarded && back && removed, { ch, ch2, oneStep, dragGone, discarded, back });
  payloads.push({ pieces: { [lamp.id]: ch.pieces[lamp.id], fur_0000000a: ch.pieces.fur_0000000a } });
});

// ── placing exactly ─────────────────────────────────────────────────────────
// The kitchen's wall faces: back y = 0, left x = 0, the shared wall x = 4
// (its door y 1 to 1.9), front y = 3 (its window x 1 to 2.2).
tryCase("exact: arrow keys step 1 cm (Shift 10 cm) the way the view is seen; turns by any angle", () => {
  const plan = ["ArrowRight", "ArrowLeft", "ArrowUp", "ArrowDown"].map(k => P.arrowStep(k, [1, 0], P.NUDGE_M[0]));
  const turned = ["ArrowRight", "ArrowUp"].map(k => P.arrowStep(k, [0, 1], P.NUDGE_M[1]));   // the view's right is down the plan
  const slant = P.arrowStep("ArrowRight", [0.8, -0.6], 0.01), none = P.arrowStep("a", [1, 0], 0.01);
  check("exact: arrow keys step 1 cm (Shift 10 cm) the way the view is seen; turns by any angle",
    JSON.stringify(plan) === "[[0.01,0],[-0.01,0],[0,-0.01],[0,0.01]]" && JSON.stringify(turned) === "[[0,0.1],[0.1,0]]"
    && JSON.stringify(slant) === "[0.01,0]" && none === null && P.NUDGE_M[0] === 0.01 && P.NUDGE_M[1] === 0.1
    && P.turnedBy(350, 15) === 5 && P.turnedBy(10, -P.FINE_TURN) === 9 && P.turnedBy(0, -0.5) === 359.5 && P.turnedBy(37.5, 0) === 37.5,
    { plan, turned, slant, none });
});
tryCase("gaps: from each side straight out to the first wall's face, the nearer on each of its axes", () => {
  const box = piece("fur_00000020", "box", 0.6, 0.4, 0.5, { x: 1, y: 1.4 });
  const g = P.wallGaps(box, null, walls);
  // Turned to face left: its back (+x) towards the shared wall, its sides along y.
  const t = P.wallGaps({ ...box, x_m: 3.5, rotation: 90 }, null, walls);
  // Beside the doorway: the door's line is the wall there.
  const dr = P.wallGaps({ ...box, x_m: 3.5, y_m: 1.45 }, null, walls).find(x => x.side === "right");
  const far = P.wallGaps(box, null, walls, 0.5);
  check("gaps: from each side straight out to the first wall's face, the nearer on each of its axes",
    g.length === 2 && g[0].side === "back" && near(g[0].d, 1.2, 1e-3) && near(g[0].to[1], 0, 1e-3) && near(g[0].from[1], 1.2, 1e-3)
    && g[1].side === "left" && near(g[1].d, 0.7, 1e-3) && near(g[1].to[0], 0, 1e-3)
    && t.length === 2 && t[0].side === "back" && near(t[0].d, 0.3, 1e-3) && t[1].side === "left" && near(t[1].d, 1.1, 1e-3)
    && dr && near(dr.d, 0.2, 1e-3) && far.length === 0, { g, t, dr, far });
});
tryCase("stand: onto the top of the piece its middle is over; never onto what hangs above it; nothing, the floor", () => {
  const table = piece("fur_00000030", "table", 1.4, 0.9, 0.75, { x: 2, y: 1.5, r: 20 });
  const lamp = piece("fur_00000031", "lamp", 0.3, 0.3, 0.5, { x: 2.3, y: 1.6 });
  const unit = piece("fur_00000032", "tv_unit", 1.6, 0.45, 0.5, { x: 2, y: 0.3 });
  const tv = piece("fur_00000033", "tv", 1.2, 0.08, 0.7, { x: 2.1, y: 0.25, z: 1.1 });
  const rug = piece("fur_00000034", "rug", 2, 1.5, 0.01, { x: 2, y: 1.5 });
  const a = P.standOn(lamp, [table, unit, tv, rug]), b = P.standOn(tv, [table, unit]), c = P.standOn(unit, [tv]);
  const d = P.standOn({ ...lamp, x_m: 3.6 }, [table, unit]), e = P.standOn({ ...lamp, z_m: 1.2 }, [table]);
  check("stand: onto the top of the piece its middle is over; never onto what hangs above it; nothing, the floor",
    a.z_m === 0.75 && a.on === table.id && b.z_m === 0.5 && b.on === unit.id && c.z_m === 0 && c.on === null
    && d.z_m === 0 && d.on === null && e.z_m === 0.75 && e.on === table.id, { a, b, c, d, e });
  payloads.push({ pieces: { [lamp.id]: { ...lamp, z_m: a.z_m }, [tv.id]: { ...tv, z_m: b.z_m } } });
});
tryCase("hang: its middle at the height asked, its back flat on the nearest wall solid there, facing out; under the ceiling", () => {
  const tv = piece("fur_00000040", "tv", 1.2, 0.08, 0.7, { x: 2, y: 0.8, r: 120 });
  const h = P.hangOnWall(tv, null, walls, 1.2, CEIL);
  // In front of the window: its glass is no wall, so the nearest solid one.
  const pic = piece("fur_00000041", "other", 0.8, 0.03, 0.6, { x: 1.6, y: 2.6 });
  const w = P.hangOnWall(pic, null, walls, 1.5, CEIL);
  // Beside the doorway: never into the door.
  const shelf = piece("fur_00000042", "shelf", 0.6, 0.25, 0.3, { x: 3.7, y: 1.45 });
  const s = P.hangOnWall(shelf, null, walls, 1.0, CEIL);
  const top = P.hangOnWall(tv, null, walls, 2.6, CEIL), none = P.hangOnWall(tv, null, [], 1.2, CEIL);
  const kind = (r) => r && walls[r.wall].kind;
  check("hang: its middle at the height asked, its back flat on the nearest wall solid there, facing out; under the ceiling",
    h && near(h.y_m, 0.04, 1e-3) && h.x_m === 2 && h.rotation === 0 && near(h.z_m, 0.85, 1e-9)
    && w && kind(w) === "wall" && near(w.x_m, 0.015, 1e-3) && w.rotation === 270 && near(w.z_m, 1.2, 1e-9)
    && s && kind(s) !== "door" && top && near(top.z_m + 0.7, CEIL, 1e-9) && none === null,
    { h, w, s, top, kinds: [kind(h), kind(w), kind(s)] });
  payloads.push({ pieces: { [tv.id]: { ...tv, ...h }, [pic.id]: { ...pic, ...w } } });
});

// ── what Save sends at the edges ────────────────────────────────────────────
tryCase("edges: pieces at every limit, as Save would send them", () => {
  const out = {};
  let i = 0;
  for (const rot of [-720, -15, 0, 359.9999, 7.25, 1e4 - 1]) {
    for (const [w, d, h] of [[0.05, 0.05, 0.05], [8, 8, 8], [2.2, 0.9, 0.8]]) {
      const id = `fur_${(0xa000 + i++).toString(16).padStart(8, "0")}`;
      out[id] = { ...piece(id, i % 2 ? "sofa" : "a_kind_from_the_future", w, d, h, { x: -9999.9994, y: 9999.9994, r: P.normRot(rot) }),
                  z_m: P.clampZ(99, 19.9, h) };
    }
  }
  payloads.push({ pieces: out });
  check("edges: pieces at every limit, as Save would send them", Object.keys(out).length === 18 && Object.values(out).every(p => p.rotation >= 0 && p.rotation < 360), out);
});

console.log(JSON.stringify({ cases, failures, payloads }));
