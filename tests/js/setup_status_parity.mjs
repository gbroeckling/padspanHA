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
// Setup's own list (views/setup.js deriveSetup), and the Setup Wizard's chips (views/maps.js), for "next" and the count.
const { install, flush } = await import(pathToFileURL(join(VIEWS_DIR, "..", "..", "..", "..", "..", "tests", "js", "dom_shim.mjs")).href);
install(globalThis);
const SETUP = await import(pathToFileURL(join(VIEWS_DIR, "setup.js")).href);

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
// Changed in review 2026-11-11 (C8): the lifted block now runs to the card's count and its ▶ (_setupRows, _nextStep).
const b = SRC.indexOf("      // Setup is the map-building steps.");
check("panel.js's card reads SETUP_STATUS", a > 0 && b > a);
if (a > 0 && b > a) {
  const body = SRC.slice(a, b).replace(/this\.state/g, "state");
  const card = new Function("state", "SETUP_STATUS", "SAMPLE_SNAPSHOT", body + "\nreturn { _steps, _setupRows, _completedCount, _nextStep };");
  const rows = (...a) => card(...a)._steps;
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
    // One count and one "next" (review 2026-11-11, C8): the card counts the set-up steps only, as Setup does ("See
    // someone on the map" comes after them, not counted), and its ▶ is Setup's "Next", the first step not done.
    const c = card(state, STATUS, null), d = SETUP.deriveSetup({ ...state, _mapsLoaded: true, _modelLoaded: true }, { at: null, skipped: [], done: false });
    check(`one count — ${name}`, c._setupRows.length === d.steps.length && c._completedCount === d.doneCount
      && c._steps.length === d.steps.length + 1 && c._steps[c._steps.length - 1].id === "positioned", [c._completedCount, c._setupRows.length, d.doneCount, d.steps.length]);
    check(`one "next" — ${name}`, c._nextStep === d.current, [c._nextStep, d.current]);
    check(`skipped steps: one "next" — ${name}`, (() => {
      const sk = d.current ? [d.current] : [];
      const st2 = { ...state, settings: { setup_progress: { skipped: sk } } };
      return card(st2, STATUS, null)._nextStep === SETUP.deriveSetup({ ...st2, _mapsLoaded: true, _modelLoaded: true }).current;
    })());
  }
}

// After Skip setup (review 2026-11-11, item 10): one quiet line back to Setup where the card was, for a house skipped but
// not finished; none for a finished house, a wall, Sample mode, or once hidden. The block run as panel.js has it.
{
  const i0 = SRC.indexOf("        // Set-up skipped but not finished"), i1 = SRC.indexOf("        // Setup is done or was skipped", i0);
  check("skip line: panel.js has it", i0 > 0 && i1 > i0);
  const el = (tag, attrs = {}, kids = []) => { const n = document.createElement(tag); for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
    for (const c of [].concat(kids)) n.appendChild(typeof c === "string" ? document.createTextNode(c) : c); return n; };
  const run = (st, allDone, onboarded) => {
    const frag = document.createElement("div"), self = { state: st, _renderNav() {}, _scheduleRender() {} };
    new Function("el", "frag", "_setupKnown", "_ss", "_allDone", "_onboardingDone", "_completedCount", "_setupRows", "VIEWS", "_loadView",
      SRC.slice(i0, i1)).call(self, el, frag, true, STATUS, allDone, onboarded, 2, [1, 2, 3, 4, 5], { setup: {} }, async () => null);
    return frag.children[0] || null;
  };
  try { localStorage.removeItem("padspan_setup_line"); } catch (e) {}
  // Calibration's points read, and too few: known to be not done (2026-11-14: the line shows only then).
  const CAL0 = { points: [] };
  const live = { dataMode: "live", settings: {}, calibration: CAL0 };
  const line = run(live, false, true);
  check("skip line: skipped, not finished: Set-up n of m done · Open Setup", line && /^Set-up: 2 of 5 done · Open Setup/.test(line.textContent), line && line.textContent);
  check("skip line: Setup's own Finish counts as skipped", !!run({ dataMode: "live", settings: { setup_progress: { done: true } }, calibration: CAL0 }, false, false));
  // A house in use is never asked back (review 2026-11-14): calibration not read yet says nothing (the line used to
  // flash, or stay, on a finished house), and a calibrated house has none even with an older step open.
  check("skip line: none while calibration is not known yet", !run({ dataMode: "live", settings: {} }, false, true));
  check("skip line: none for a calibrated house", !run({ dataMode: "live", settings: {},
    calibration: { points: [1, 2, 3, 4, 5].map(i => ({ id: "p" + i })) } }, false, true));
  check("skip line: none for a finished house, a wall, Sample mode, or a house still in set-up", !run(live, true, true)
    && !run({ ...live, kioskMode: true }, false, true) && !run({ dataMode: "sample", settings: {}, calibration: CAL0 }, false, true) && !run(live, false, false));
  const st2 = { dataMode: "live", settings: {}, calibration: CAL0 }, l2 = run(st2, false, true);
  l2.querySelector('[data-setup-line="open"]').dispatchEvent(new Event("click"));
  check("skip line: Open Setup opens Setup", st2.view === "setup");
  l2.querySelector('[data-setup-line="hide"]').dispatchEvent(new Event("click"));
  check("skip line: hidden stays hidden in this browser", !run(live, false, true));
  try { localStorage.removeItem("padspan_setup_line"); } catch (e) {}
}

process.stdout.write(JSON.stringify({ checks, failures }) + "\n", () => process.exit(failures.length ? 1 : 0));   // exit only once the result is written (a pipe holds 64 KiB)
