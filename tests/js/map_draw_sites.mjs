// The Rooms tab draws a map's placement in TWO places, and both were 4-DOF.
//
// `_mapFootprintM` built the dashed outline from origin/scale/rotation, and
// the ghosted `<image>` beside it was x/y/width/height + rotate(). The record
// has SIX degrees of freedom — a Point Align full transform, a mirror, or any
// rotated placement on an anchor whose axis scales disagree leans the y axis
// off square — so a sheared map drew square in the one panel whose whole job
// is to show two placements disagreeing.
//
// Both now read the placement off `mapFracToMetres`, the function every pin
// converts through, so the picture and the pins cannot disagree. This checks
// the numbers they produce against the backend's, not the source text that
// produces them: the two functions are lifted out of maps.js and run exactly
// as they ship, the way tests/js/align_master_refusal.mjs runs performSave.
//
// Run:  node tests/js/map_draw_sites.mjs <views dir> <cases.json>
// Prints one JSON line: { "checks": [...], "failures": [...], "worst": {...} }.
import fs from "node:fs";
import os from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const VIEWS_DIR = process.argv[2];
const CASES = JSON.parse(fs.readFileSync(process.argv[3], "utf8"));
const SRC = fs.readFileSync(join(VIEWS_DIR, "maps.js"), "utf8");

const checks = [], failures = [];
function check(name, ok, detail) {
  checks.push(name);
  if (!ok) failures.push({ name, detail: detail === undefined ? "" : String(detail) });
}

// maps.js is a .js file with top-level `await import`, so node will only load
// it as a module through an .mjs copy. Only stack_transform is needed whole —
// the two draw helpers come out of maps.js by text.
const tmp = fs.mkdtempSync(join(os.tmpdir(), "padspan-draw-"));
const st = join(tmp, "stack_transform.mjs");
fs.writeFileSync(st, fs.readFileSync(join(VIEWS_DIR, "stack_transform.js"), "utf8"));
const { mapFracToMetres } = await import(pathToFileURL(st).href);

function grabFn(name) {                       // top-level `function name(...)`
  const start = SRC.indexOf("function " + name + "(");
  if (start < 0) throw new Error("not found in maps.js: " + name);
  const rest = SRC.slice(start);
  const end = rest.search(/\r?\n\}\r?\n/);    // the function's own closer
  if (end < 0) throw new Error("no terminator for " + name);
  return rest.slice(0, end) + "\n}\n";
}

const { _mapAffineM, _mapFootprintM } = new Function(
  "mapFracToMetres",
  grabFn("_mapAffineM") + grabFn("_mapFootprintM") +
  "return { _mapAffineM, _mapFootprintM };")(mapFracToMetres);

// The `<image>` site is the affine and nothing else: it sets the unit square
// and hands the whole placement to matrix(). Read the shipped call so this
// cannot pass while the element is wired to something other than _mapAffineM.
const IMG = SRC.slice(SRC.indexOf('const img = document.createElementNS("http://www.w3.org/2000/svg", "image")'),
                      SRC.indexOf("svg.insertBefore(img, svg.firstChild)"));
check("the ghost image is the unit square", /setAttribute\("width", "1"\)/.test(IMG)
  && /setAttribute\("height", "1"\)/.test(IMG) && /setAttribute\("x", "0"\)/.test(IMG)
  && /setAttribute\("y", "0"\)/.test(IMG), IMG.slice(0, 400));
// Not arithmetic this harness can run: `preserveAspectRatio` is what the SVG
// renderer does with an <image> whose box does not match its intrinsic aspect,
// and the default ("xMidYMid meet") FITS the photo inside the box instead of
// filling it. Under the unit square + matrix() drawing that box is the whole
// placement, so the default letterboxes a 4:3 photo on a 20 x 15 m map to
// 11.25 m tall — 1.875 m of blank at each horizontal edge, on the ghost whose
// job is to show where the photo sits. The attribute is read from the shipped
// element for the same reason the four geometry attributes above are.
check("the ghost image fills its box rather than fitting inside it",
  /setAttribute\("preserveAspectRatio", "none"\)/.test(IMG), IMG.slice(0, 600));
check("the ghost image is placed by the map's own affine",
  /setAttribute\("transform", `matrix\(\$\{_mapAffineM\(rect\.t\)\.join\(" "\)\}\)`\)/.test(IMG),
  IMG.slice(0, 600));

let worstFoot = 0, worstAffine = 0, worstControl = Infinity;
for (const c of CASES) {
  const [a, b, cc, d, e, f] = _mapAffineM(c.t);
  for (const g of c.grid) {
    const [fx, fy] = g.f;
    const got = [a * fx + cc * fy + e, b * fx + d * fy + f];
    worstAffine = Math.max(worstAffine, Math.hypot(got[0] - g.m[0], got[1] - g.m[1]));
  }
  const foot = _mapFootprintM(c.t);
  for (let i = 0; i < 4; i++) {
    worstFoot = Math.max(worstFoot,
      Math.hypot(foot[i][0] - c.corners[i][0], foot[i][1] - c.corners[i][1]));
  }
  // The control: with sigma dropped from the record — which is what four
  // degrees of freedom could say — the same corners move metres.
  const five = { ...c.t };
  delete five.shear_rad;
  const flat = _mapFootprintM(five);
  let moved = 0;
  for (let i = 0; i < 4; i++) {
    moved = Math.max(moved, Math.hypot(flat[i][0] - c.corners[i][0], flat[i][1] - c.corners[i][1]));
  }
  worstControl = Math.min(worstControl, moved);
}

check("the footprint outline is the placement", worstFoot < 1e-3, worstFoot);
check("the ghost image's matrix is the placement", worstAffine < 1e-9, worstAffine);
check("every case is actually sheared", worstControl > 1.0, worstControl);

console.log(JSON.stringify({ checks, failures, n: CASES.length,
  worst: { foot: worstFoot, affine: worstAffine, control: worstControl } }));
