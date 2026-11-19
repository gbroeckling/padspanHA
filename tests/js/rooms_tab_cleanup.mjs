// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
//
// Mapping → Rooms's clean-up tools (views/maps.js, 2026-11-10: rooms from plans
// are cleaned up in the old editor too): a corner added halfway along a side, a
// corner taken away (three kept), and which selections can merge into one.
// Save corrections taking Live Aboard's doors and windows with a room (2026-11-19): the draft's corners keep which
// saved corner each is, and _carryOpenings against a fake server (moved, refused, a newer file, a failed read).
// The pytest wrapper is tests/test_plan_build_rooms.py.
//
// Run:  node tests/js/rooms_tab_cleanup.mjs <views-dir>
import { pathToFileURL } from "node:url";
import { join } from "node:path";
import { install } from "./dom_shim.mjs";

install(globalThis);
const results = {};
const check = (name, ok, detail) => { results[name] = { ok: !!ok, detail: ok ? undefined : detail }; };
const maps = await import(pathToFileURL(join(process.argv[2], "maps.js")).href);

const sq = [[0, 0], [4, 0], [4, 3], [0, 3]];
const added = maps._roomCornerAdd(sq, 1);
check("add: a corner halfway along the side, the rest kept in order", JSON.stringify(added) === JSON.stringify([[0, 0], [4, 0], [4, 1.5], [4, 3], [0, 3]]), added);
const last = maps._roomCornerAdd(sq, 3);
check("add: along the closing side too", JSON.stringify(last) === JSON.stringify([[0, 0], [4, 0], [4, 3], [0, 3], [0, 1.5]]), last);
check("add: the room it came from is left as it was", sq.length === 4, sq);
const dropped = maps._roomCornerDrop(added, 2);
check("drop: a corner taken away", JSON.stringify(dropped) === JSON.stringify(sq), dropped);
const tri = [[0, 0], [1, 0], [0, 1]];
check("drop: a room keeps three corners", maps._roomCornerDrop(tri, 0) === tri, maps._roomCornerDrop(tri, 0));
const draft = { A: { type: "poly", points_m: sq }, B: { type: "poly", points_m: sq }, C: { type: "circle", cx_m: 0, cy_m: 0, r_m: 1 } };
const none = () => false;
check("merge: two outlined rooms", maps._roomsMergeable(new Set(["A", "B"]), draft, none).ok, maps._roomsMergeable(new Set(["A", "B"]), draft, none));
check("merge: one room isn't a merge", !maps._roomsMergeable(new Set(["A"]), draft, none).ok);
check("merge: a circle can't", /circle/.test(maps._roomsMergeable(new Set(["A", "C"]), draft, none).why));
check("merge: unsaved changes first", /Save or discard/.test(maps._roomsMergeable(new Set(["A", "B"]), draft, (r) => r === "B").why));
// After a merge (review B5): only the merged rooms change in the open draft; another room's unsaved edit stays.
const big = [[0, 0], [8, 0], [8, 3], [0, 3]], moved = [[9, 0], [12, 0], [12, 2], [9, 2]];
const d2 = { A: { type: "poly", points_m: sq, floor_id: "main" }, B: { type: "poly", points_m: sq }, D: { type: "poly", points_m: moved } };
const o2 = { A: { type: "poly", points_m: sq, floor_id: "main" }, B: { type: "poly", points_m: sq }, D: { type: "poly", points_m: [[9, 0], [11, 0], [11, 2], [9, 2]] } };
maps._roomsAfterMerge(d2, o2, "A", ["B"], { ok: true, removed: ["B"], points_m: big });
check("merge after: the kept room takes the merged outline in the draft and as saved", JSON.stringify(d2.A.points_m) === JSON.stringify(big)
  && JSON.stringify(o2.A.points_m) === JSON.stringify(big) && d2.A.floor_id === "main", [d2.A, o2.A]);
check("merge after: the merged room leaves the draft", !("B" in d2) && !("B" in o2), [d2, o2]);
check("merge after: another room's unsaved edit stays", JSON.stringify(d2.D.points_m) === JSON.stringify(moved) && o2.D.points_m[1][0] === 11, [d2.D, o2.D]);
const d3 = { A: { type: "poly", points_m: sq }, B: { type: "poly", points_m: sq } };
maps._roomsAfterMerge(d3, null, "A", ["B"], { ok: false, removed: [], failed: ["B"], points_m: big });
check("merge after: a room whose delete failed stays in the draft", "B" in d3, d3);
const d4 = { A: { type: "poly", points_m: sq, _was: [0, null, 1, 2] }, B: { type: "poly", points_m: sq } };
maps._roomsAfterMerge(d4, null, "A", ["B"], { ok: true, removed: ["B"], points_m: big });
check("merge after: the merged outline's corners aren't the old ones (no _was)", !("_was" in d4.A), d4.A);

// Live Aboard's doors and windows go with a room Layout saved (2026-11-19): the draft keeps which saved corner each
// corner is, and Save carries them through house3d_edit, saying how many moved and how many were left.
const g = { type: "poly", points_m: sq.map(p => [...p]) };
maps._roomCornerAddIn(g, 1);
check("corners: one added is new (null), the rest keep their saved corner", JSON.stringify(g._was) === "[0,1,null,2,3]" && g.points_m.length === 5, g);
maps._roomCornerDropIn(g, 0);
check("corners: one taken away leaves with its saved corner", JSON.stringify(g._was) === "[1,null,2,3]" && g.points_m.length === 4, g);
const tri2 = { type: "poly", points_m: tri.map(p => [...p]) };
maps._roomCornerDropIn(tri2, 0);
check("corners: a room keeps three, and its corners are as they were", tri2.points_m.length === 3 && !("_was" in tri2), tri2);
const rep = { type: "poly", points_m: sq.map(p => [...p]), _was: false };
maps._roomCornerAddIn(rep, 0);
check("corners: a replaced outline stays unmatched (false)", rep._was === false && rep.points_m.length === 5, rep);

const before = { Kitchen: { type: "poly", points_m: [[0, 0], [4, 0], [4, 3], [0, 3]] }, Hall: { type: "poly", points_m: [[4.1, 0], [9, 0], [9, 3], [4.1, 3]] } };
const after = { ...before, Kitchen: { type: "poly", points_m: [[0, 2], [4, 2], [4, 5], [0, 5]] } };
const FILE = { schema: 1, openings: {
  door_000000a1: { kind: "door", floor_id: "main", a_m: [0.5, -0.07], b_m: [1.4, -0.07], head_m: 2.03, hinge: "left", swing: "in" },
  win_000000a2: { kind: "window", floor_id: "main", a_m: [1, 3.07], b_m: [2.2, 3.07], sill_m: 0.9, head_m: 2.1 },
  door_000000a3: { kind: "door", floor_id: "main", a_m: [4.05, 1], b_m: [4.05, 1.9], head_m: 2.03, hinge: "left", swing: "in" },
} };
const fakeCtx = (answers) => {
  const calls = [];
  return { calls, actions: { wsCall: async (type, msg) => {
    calls.push({ type, msg });
    const a = answers[type];
    if (a instanceof Error) throw a;
    return typeof a === "function" ? a(msg) : a;
  } } };
};
{
  const ctx = fakeCtx({ "padspan_ha/house3d_get": { data: FILE, writable: true }, "padspan_ha/house3d_edit": { data: {} } });
  const r = await maps._carryOpenings(ctx, "main", before, after);
  const sent = ctx.calls.filter(c => c.type === "padspan_ha/house3d_edit");
  check("carry: the moved room's door and window go through house3d_edit once, whole, nothing removed",
    sent.length === 1 && Object.keys(sent[0].msg).join() === "openings" && Object.keys(sent[0].msg.openings).sort().join() === "door_000000a1,win_000000a2"
    && JSON.stringify(sent[0].msg.openings.door_000000a1.a_m) === "[0.5,1.93]" && sent[0].msg.openings.win_000000a2.sill_m === 0.9
    && Object.values(sent[0].msg.openings).every(v => v !== null), ctx.calls);
  check("carry: Save's words say how many moved and how many were left, and why",
    r.text === "1 door and 1 window in Live Aboard moved with their rooms. 1 door in Live Aboard was left where it was: a room that didn't move the same way shares its wall. Check it in Live Aboard's Edit."
    && r.bad === false, r);
}
{
  const ctx = fakeCtx({ "padspan_ha/house3d_get": { data: FILE, writable: true }, "padspan_ha/house3d_edit": new Error("Live Aboard is off. Turn it on in Settings → Atlas → Live Aboard.") });
  const r = await maps._carryOpenings(ctx, "main", before, after);
  check("carry: a refused write leaves them where they were, and says why",
    r.text === "1 door and 1 window in Live Aboard were left where they were: Live Aboard is off. Turn it on in Settings → Atlas → Live Aboard. "
      + "1 door in Live Aboard was left where it was: a room that didn't move the same way shares its wall. Check it in Live Aboard's Edit." && r.bad === true, r);
}
{
  const ctx = fakeCtx({ "padspan_ha/house3d_get": { data: { ...FILE, schema: 2 }, writable: false } });
  const r = await maps._carryOpenings(ctx, "main", before, after);
  check("carry: a newer PadSpan's file is never written", !ctx.calls.some(c => c.type === "padspan_ha/house3d_edit")
    && /were left where they were: Live Aboard's file was saved by a newer PadSpan\./.test(r.text) && r.bad, r);
}
{
  const ctx = fakeCtx({ "padspan_ha/house3d_get": new Error("Could not read Live Aboard's file. Nothing was changed; try again.") });
  const r = await maps._carryOpenings(ctx, "main", before, after);
  check("carry: a failed read is said, and nothing is written", ctx.calls.length === 1 && r.bad && /weren't checked/.test(r.text), r);
}
{
  const ctx = fakeCtx({ "padspan_ha/house3d_get": { data: { schema: 1, openings: {} }, writable: true } });
  const r = await maps._carryOpenings(ctx, "main", before, after);
  check("carry: nothing on those walls: no write and no words", ctx.calls.length === 1 && r.text === "" && !r.bad, r);
}
process.stdout.write(JSON.stringify(results) + "\n", () => process.exit(0));   // exit only once the result is written (a pipe holds 64 KiB)
