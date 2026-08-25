// What Save Scale actually POSTS, built by the shipped expression.
//
// The button computes a whole `transform` record and sends it to
// `padspan_ha/fabric_map_transform_set`. The backend's rule is that a
// placement field is changed only by a payload that STATES it, so what this
// object does NOT contain is as load-bearing as what it does — and it used to
// contain `shear_rad: Number(_savedTx.shear_rad) || 0`, an explicit "square"
// whenever the panel's cached `map_transforms` lacked the map, and an explicit
// restatement of a possibly stale lean whenever it had it.
//
// The literal is lifted out of maps.js and EVALUATED, the same string-surgery
// route tests/js/align_master_refusal.mjs uses on performSave: it is the
// shipped expression producing a real object, not a grep over its source.
//
// Run:  node tests/js/save_scale_payload.mjs <views dir>
// Prints one JSON line: { "payloads": {...}, "keys": [...] }.
import fs from "node:fs";
import { join } from "node:path";

const SRC = fs.readFileSync(join(process.argv[2], "maps.js"), "utf8");

// The object literal, from `const transform = {` to its own closer at the
// same indent.
const HEAD = "          const transform = {";
const start = SRC.indexOf(HEAD);
if (start < 0) throw new Error("the Save Scale payload is not in maps.js any more");
const rest = SRC.slice(start);
const end = rest.search(/\r?\n {10}\};\r?\n/);
if (end < 0) throw new Error("no terminator for the Save Scale payload");
const TX = rest.slice(0, end) + "\n          };\n";

// Everything it closes over, as the click handler has it: a measured 20 x 15 m
// master on a stack with no rotation, and the two measurements just taken.
const build = new Function(
  "isMaster", "stk", "scale_x_m", "scale_y_m", "rotRad", "fl", "meas", "_savedTx",
  TX + "return transform;");

const MEAS = [
  { p1: [0.1, 0.5], p2: [0.6, 0.5], distance_m: 10.0, px_per_meter: 80.0, angle_deg: 0 },
  { p1: [0.2, 0.1], p2: [0.2, 0.6], distance_m: 7.5, px_per_meter: 80.0, angle_deg: 90 },
];

// The panel's cached model, in each of the three states it is really in:
// never loaded for this map, loaded and agreeing, and loaded but STALE (a
// Point Align has since written a lean this tab has not seen).
const CACHES = {
  "panel has no record": {},
  "panel agrees": { shear_rad: -0.1161 },
  "panel is stale": { shear_rad: 0.4 },
};

const payloads = {};
for (const [name, cache] of Object.entries(CACHES)) {
  payloads[name] = build(true, { rotation: 0, x_offset: 0, y_offset: 0 },
                         20.0, 15.0, 0.0, "main", MEAS, cache);
}
console.log(JSON.stringify({ payloads, keys: Object.keys(payloads["panel agrees"]) }));
