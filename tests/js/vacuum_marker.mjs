// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
//
// The robot vacuum in the 3D house (views/live_aboard_tracked.js vacuumOf,
// wantedOf): a snapshot with no `vacuum` key draws exactly what it drew
// before; with one, a "Robot vacuum" marker stands where its map says.
//
// usage: vacuum_marker.mjs <www/padspan-ha dir>
// prints one JSON line: { cases: {name: result}, failures: [...] }

import { pathToFileURL } from "node:url";
import { join } from "node:path";

const WWW = process.argv[2];
const TR = await import(pathToFileURL(join(WWW, "views", "live_aboard_tracked.js")).href);
const cases = {}, failures = [];
const check = (name, ok, detail) => { cases[name] = !!ok; if (!ok) failures.push({ name, detail }); };

const snap = { objects: { list: [{ key: "AA", x_m: 1, y_m: 2, floor_id: "main", kind: "ble", user_label: "Keys", identified: true }] } };
const base = { model: {}, snapshot: snap, tags: true, people: false, states: {} };
const before = JSON.stringify(TR.wantedOf(base));
check("none:unchanged", JSON.stringify(TR.wantedOf({ ...base, snapshot: { ...snap } })) === before, before);
check("none:null", TR.vacuumOf(snap) === null && TR.vacuumOf(null) === null && TR.vacuumOf({ vacuum: { x_m: "x" } }) === null);
const withVac = TR.wantedOf({ ...base, snapshot: { ...snap, vacuum: { x_m: 3.5, y_m: 4.25, floor_id: "main", ts: Date.now() / 1000 } } });
const v = withVac.find(w => w.key === "vacuum");
check("vac:drawn", v && v.x === 3.5 && v.y === 4.25 && v.floor_id === "main" && v.name === "Robot vacuum", v);
check("vac:others-kept", JSON.stringify(withVac.filter(w => w.key !== "vacuum")) === before);
check("vac:card", v && v.card.title === "Robot vacuum" && v.card.lines.includes("Seen just now"), v && v.card);
const off = TR.wantedOf({ ...base, tags: false, snapshot: { ...snap, vacuum: { x_m: 3.5, y_m: 4.25 } } });
check("vac:tags-off", !off.some(w => w.key === "vacuum"));
console.log(JSON.stringify({ cases, failures }));
