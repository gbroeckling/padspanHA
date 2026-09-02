// What "delete an orphan room polygon" actually POSTS.
//
// Both delete paths in manage.js rebuild the map's room_bounds and push the
// whole map back through `padspan_ha/maps_update`. What the payload does NOT
// contain is the load-bearing part: it used to carry `stack: map.stack || {}`,
// the CLIENT's copy of the placement, so deleting a ghost polygon in a stale
// tab wrote that tab's idea of the alignment back over whatever another tab
// had since realigned.
//
// The same guard now covers the geometry itself: the payloads are built from
// `fresh` — the map re-fetched from the server inside the click handler —
// never from the render-time copy, so a tab left open across an image op
// (whose renormalization rewrote every fraction server-side) can no longer
// push old-space receivers and room_bounds back over the corrected ones.
//
// The object literals are lifted out of manage.js and EVALUATED, the same
// string-surgery route tests/js/save_scale_payload.mjs uses on the Save Scale
// payload: the shipped expression producing a real object, not a grep over its
// source.
//
// Run:  node tests/js/orphan_delete_payload.mjs <views dir>
// Prints one JSON line: { "payloads": [...] }.
import fs from "node:fs";
import { join } from "node:path";

const SRC = fs.readFileSync(join(process.argv[2], "manage.js"), "utf8");

const CALL = "ctx.actions.mapsUpdate({";
const literals = [];
let from = 0;
for (;;) {
  const i = SRC.indexOf(CALL, from);
  if (i < 0) break;
  const open = i + CALL.length - 1;
  let depth = 0, end = -1;
  for (let j = open; j < SRC.length; j++) {
    if (SRC[j] === "{") depth++;
    else if (SRC[j] === "}") { depth--; if (depth === 0) { end = j; break; } }
  }
  if (end < 0) throw new Error("unterminated orphan-delete payload in manage.js");
  literals.push(SRC.slice(open, end + 1));
  from = end;
}
if (literals.length !== 2) {
  throw new Error(`expected the single and the bulk delete, found ${literals.length}`);
}

// The map as the handler's re-fetch returns it — the SERVER's copy, which
// is the whole point: the literals read `fresh`, never the render-time
// `map`. `newBounds` is what the handler computed: the orphan stripped out.
const FRESH = {
  id: "m1", name: "Ground",
  receivers: [{ source: "esp1", x: 0.2, y: 0.3 }],
  room_bounds: { Kitchen: { type: "poly", points: [[0, 0], [1, 0], [1, 1]] } },
  floor_id: "main",
  calibration: { mode: "none" },
  notes: "",
  // Present on the server copy; the payload must still not carry it.
  stack: { is_master: true, scale: 1.0, scale_x_adj: 1.0, ref_ar: 0.75,
           rotation: 0, x_offset: 0, y_offset: 0 },
};
const NEW_BOUNDS = { Kitchen: FRESH.room_bounds.Kitchen };

const payloads = literals.map(
  (lit) => new Function("fresh", "newBounds", "return " + lit + ";")(FRESH, NEW_BOUNDS));
console.log(JSON.stringify({ payloads }));
