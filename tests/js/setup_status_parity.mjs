// panel.js's onboarding checklist keeps its own inline copy of "is this
// step done" (deliberately — see the comment above it, and
// onboarding_gate.mjs, which needs that copy self-contained enough to lift
// by text). views/setup_status.js holds the same five checks as real
// exported functions, for the Setup Wizard (maps.js) to use directly.
//
// Two copies of the same question is exactly the defect class this repo
// already has a name for (LIGHT_SHAPES vs the backend whitelist): nothing
// stops them answering differently the day only one gets updated. This
// test is the thing that stops it — run both, on the same battery of
// fabricated states, and fail the moment they disagree.
//
// Run:  node tests/js/setup_status_parity.mjs <panel.js path> <views dir>
// Prints one JSON line: { "checks": [...], "failures": [...] }.
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { join } from "node:path";

const PANEL_PATH = process.argv[2];
const VIEWS_DIR = process.argv[3];
const SRC = readFileSync(PANEL_PATH, "utf8");
const STATUS = await import(pathToFileURL(join(VIEWS_DIR, "setup_status.js")).href);

const checks = [], failures = [];
const check = (name, ok, detail) => {
  checks.push(name);
  if (!ok) failures.push({ name, detail: detail === undefined ? "" : String(detail) });
};

// ── lift panel.js's five inline expressions by text, same technique as
// onboarding_gate.mjs ────────────────────────────────────────────────────
const PAIRS = [
  ["_hasMaps", "hasMaps"],
  ["_hasReceivers", "hasReceivers"],
  ["_hasRooms", "hasRooms"],
  ["_hasScale", "hasScale"],
  ["_hasCal", "hasCalibration"],
];

const lifted = {};
for (const [varName] of PAIRS) {
  const m = SRC.match(new RegExp(`const\\s+${varName}\\s*=\\s*([^;]+);`));
  check(`panel.js still defines ${varName}`, !!m);
  if (m) lifted[varName] = m[1].replace(/this\.state/g, "state");
}

if (Object.keys(lifted).length === PAIRS.length) {
  // _hasRooms and _hasCal reference a couple of helper consts panel.js
  // declares between the five (_hasFabricRooms, _calPoints, _hasModel,
  // _hasFabricScanners) — pull those in too so the reconstructed scope
  // actually has what the expressions reference.
  const helperNames = ["_hasFabricRooms", "_calPoints", "_hasModel", "_hasFabricScanners"];
  const helpers = {};
  for (const h of helperNames) {
    const hm = SRC.match(new RegExp(`const\\s+${h}\\s*=\\s*([^;]+);`));
    if (hm) helpers[h] = hm[1].replace(/this\.state/g, "state");
  }
  const helperSrc = Object.entries(helpers).map(([k, v]) => `const ${k} = ${v};`).join("\n");

  const panel = {};
  for (const [varName] of PAIRS) {
    panel[varName] = new Function("state", `
      ${helperSrc}
      const _hasMaps = ${lifted["_hasMaps"]};
      const _hasReceivers = ${lifted["_hasReceivers"]};
      const _hasRooms = ${lifted["_hasRooms"]};
      const _hasScale = ${lifted["_hasScale"]};
      const _hasCal = ${lifted["_hasCal"]};
      return !!${varName};
    `);
  }

  const battery = [
    { name: "nothing yet",       state: { maps: { list: [] }, model: {}, calibration: {} } },
    { name: "one bare map",      state: { maps: { list: [{ id: "m1", receivers: [], room_bounds: {} }] }, model: {}, calibration: {} } },
    { name: "map with scanner",  state: { maps: { list: [{ id: "m1", receivers: [{ id: "r1" }], room_bounds: {} }] }, model: {}, calibration: {} } },
    { name: "map with a room",   state: { maps: { list: [{ id: "m1", receivers: [], room_bounds: { Kitchen: { type: "poly", points: [] } } }] }, model: {}, calibration: {} } },
    { name: "fabric rooms only", state: { maps: { list: [{ id: "m1", receivers: [], room_bounds: {} }] }, model: { room_geometry_m: { Kitchen: {} } }, calibration: {} } },
    { name: "scale set",         state: { maps: { list: [{ id: "m1", receivers: [], room_bounds: {} }] }, model: { map_transforms: { m1: { reference_measurements: [{}] } } }, calibration: {} } },
    { name: "scale, empty measurements", state: { maps: { list: [{ id: "m1", receivers: [], room_bounds: {} }] }, model: { map_transforms: { m1: { reference_measurements: [] } } }, calibration: {} } },
    { name: "5 cal points",      state: { maps: { list: [] }, model: {}, calibration: { points: [1, 2, 3, 4, 5] } } },
    { name: "4 cal points",      state: { maps: { list: [] }, model: {}, calibration: { points: [1, 2, 3, 4] } } },
    { name: "fitted cal model",  state: { maps: { list: [] }, model: {}, calibration: { model: { a: 1 } } } },
    { name: "fabric scanners",   state: { maps: { list: [] }, model: { scanner_positions_m: { s1: [0, 0] } }, calibration: {} } },
    { name: "everything done",   state: {
        maps: { list: [{ id: "m1", receivers: [{ id: "r1" }], room_bounds: { Kitchen: {} } }] },
        model: { room_geometry_m: { Kitchen: {} }, map_transforms: { m1: { reference_measurements: [{}] } } },
        calibration: { points: [1, 2, 3, 4, 5] },
    } },
  ];

  for (const { name, state } of battery) {
    for (const [varName, fnName] of PAIRS) {
      const fromPanel = panel[varName](state);
      const fromModule = fnName === "hasCalibration" ? STATUS.hasCalibration(state) : STATUS[fnName](state);
      check(`${fnName} agrees with panel.js's ${varName} — ${name}`,
        fromPanel === fromModule,
        `panel.js=${fromPanel} setup_status.js=${fromModule}`);
    }
  }
}

console.log(JSON.stringify({ checks, failures }));
process.exit(failures.length ? 1 : 0);
