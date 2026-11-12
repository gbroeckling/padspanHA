// The Overview's Getting started and views/setup_status.js must never disagree about the steps.
//
// Getting started kept its own inline copy of "is this step done" (lifted by text and run against
// setup_status.js here). Since 2026-11-13 (review: one order, one vocabulary) it has no copy: it reads
// setup_status.js's steps, names, numbers, words and "done", as Setup and the Setup Wizard do. This lifts
// the card's step list from panel.js by text, runs it with the real module in scope on a battery of
// houses, and fails the moment a row's name, number, order or "done" is not setup_status.js's — or an
// inline copy comes back.
//
// Run:  node tests/js/setup_status_parity.mjs <panel.js path> <views dir>
// Prints one JSON line: { "checks": [...], "failures": [...] }.
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { join } from "node:path";

const PANEL_PATH = process.argv[2];
const VIEWS_DIR = process.argv[3];
const SRC = readFileSync(PANEL_PATH, "utf8").replace(/\r\n/g, "\n");
const STATUS = await import(pathToFileURL(join(VIEWS_DIR, "setup_status.js")).href);

const checks = [], failures = [];
const check = (name, ok, detail) => {
  checks.push(name);
  if (!ok) failures.push({ name, detail: detail === undefined ? "" : String(detail) });
};

// No inline copy of a step's "done" is left in the card.
for (const v of ["_hasReceivers", "_hasRooms", "_hasScale", "_hasCal", "_hasFabricRooms"]) {
  check(`panel.js has no inline ${v} any more`, !new RegExp(`const\\s+${v}\\s*=`).test(SRC));
}

const a = SRC.indexOf("      const _ss = SETUP_STATUS;");
const b = SRC.indexOf("      const _completedCount = _steps.filter(s => s.done).length;");
check("panel.js's card reads SETUP_STATUS", a > 0 && b > a);
if (a > 0 && b > a) {
  const body = SRC.slice(a, b).replace(/this\.state/g, "state");
  const rows = new Function("state", "SETUP_STATUS", "SAMPLE_SNAPSHOT", body + "\nreturn _steps;");
  const F1 = [{ id: "main", name: "Main" }];
  const F3 = [{ id: "g", name: "Ground" }, { id: "u", name: "Upstairs" }, { id: "a", name: "Attic" }];
  const battery = [
    { name: "nothing yet", state: { maps: { list: [] }, model: { floors: F1 } } },
    { name: "one bare map", state: { maps: { list: [{ id: "m1", receivers: [], room_bounds: {} }] }, model: { floors: F1 } } },
    { name: "scale set", state: { maps: { list: [{ id: "m1", receivers: [], room_bounds: {} }] }, model: { floors: F1, map_transforms: { m1: { reference_measurements: [{}] } } } } },
    { name: "a room on a plan", state: { maps: { list: [{ id: "m1", receivers: [], room_bounds: { Kitchen: {} } }] }, model: { floors: F1 } } },
    { name: "a receiver only on the house map", state: { maps: { list: [] }, model: { floors: F1, scanner_positions_m: { s1: { x_m: 1, y_m: 2, z_m: 2.4 } } } } },
    { name: "three floors, receivers at one height", state: { maps: { list: [] }, model: { floors: F3,
        scanner_positions_m: { s1: { x_m: 1, y_m: 2, z_m: 2.4 }, s2: { x_m: 3, y_m: 2, z_m: 2.4 } } } } },
    { name: "three floors, one with a height", state: { maps: { list: [] }, model: { floors: [{ ...F3[0], floor_to_floor_m: 2.7 }, F3[1], F3[2]] } } },
    { name: "two floors and Outside, no heights", state: { maps: { list: [] }, model: { floors: [{ id: "g" }, { id: "u" }, { id: "__outside__", name: "Outside" }] } } },
    { name: "one floor and Outside", state: { maps: { list: [] }, model: { floors: [{ id: "g" }, { id: "__outside__", name: "Outside" }] } } },
    { name: "calibration not read yet", state: { maps: { list: [] }, model: { floors: F1 } } },
    { name: "five calibration points", state: { maps: { list: [] }, model: { floors: F1 }, calibration: { points: [1, 2, 3, 4, 5] } } },
    { name: "everything done", state: {
        maps: { list: [{ id: "m1", receivers: [{ id: "r1" }], room_bounds: { Kitchen: {} } }] },
        model: { floors: F1, room_geometry_m: { Kitchen: {} }, map_transforms: { m1: { reference_measurements: [{}] } } },
        calibration: { points: [1, 2, 3, 4, 5] } } },
  ];
  for (const { name, state } of battery) {
    state.dataMode = "live";
    const got = rows(state, STATUS, null).filter(r => r.step);
    const want = STATUS.setupSteps(state);
    check(`same steps, same order — ${name}`, JSON.stringify(got.map(r => r.step)) === JSON.stringify(want.map(s => s.id)),
      JSON.stringify([got.map(r => r.step), want.map(s => s.id)]));
    check(`same numbers and names — ${name}`, got.every((r, i) => want[i] && r.label === `${want[i].n}. ${want[i].label}`), got.map(r => r.label).join(" | "));
    check(`same "done" — ${name}`, got.every(r => r.done === (STATUS.stepDone(state, r.step) === true)), got.map(r => `${r.step}:${r.done}`).join(" "));
    check(`Setup's words as each step's hint — ${name}`, got.every(r => r.hint === STATUS.STEP_ABOUT[r.step]));
  }
}

console.log(JSON.stringify({ checks, failures }));
process.exit(failures.length ? 1 : 0);
