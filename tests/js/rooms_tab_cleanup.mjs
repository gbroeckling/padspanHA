// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
//
// Mapping → Rooms's clean-up tools (views/maps.js, 2026-11-10: rooms from plans
// are cleaned up in the old editor too): a corner added halfway along a side, a
// corner taken away (three kept), and which selections can merge into one.
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
console.log(JSON.stringify(results));
process.exit(0);
