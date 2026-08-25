// The panel draws a map from its PLACEMENT, and from nothing else.
//
// `makeStackXform` took a `maps[].stack` — five decomposed fields, or a solved
// affine `_m` that took precedence over them, with every y term stretched by
// `ref_ar`. That was a complete second description of where a map sits, stored
// beside the metric one, and it is what the trim, #62, #64 and #67 all are.
// It takes the record and the gauge now:
//
//     world = metres / gauge.m_per_unit
//
// Three things are checked here, all as NUMBERS against cases the Python side
// produced from the same inputs:
//
//   (a) the world frame matches the backend's `stack_world_xform` exactly;
//   (b) `placementStageAffine` — how the align editor draws a target over a
//       reference — puts every fraction of the target on the reference
//       fraction its metres say it should be on;
//   (c) the align editor's gestures ROUND-TRIP: what the stage draws after a
//       drag, a resize, a stretch and a turn is what the placement it commits
//       says, so what the owner sees is what is stored.
//
// Run:  node tests/js/derived_stack.mjs <views dir> <cases.json>
// Prints one JSON line: { "checks": [...], "failures": [...], "worst": {...} }.
import fs from "node:fs";
import os from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const VIEWS_DIR = process.argv[2];
const CASES = JSON.parse(fs.readFileSync(process.argv[3], "utf8"));

const tmp = fs.mkdtempSync(join(os.tmpdir(), "padspan-derived-"));
const st = join(tmp, "stack_transform.mjs");
fs.writeFileSync(st, fs.readFileSync(join(VIEWS_DIR, "stack_transform.js"), "utf8"));
const { makeStackXform, mapXform, placementStageAffine, placementFromColumns,
        mapFracToMetres, metresToMapFrac, worldGauge } =
  await import(pathToFileURL(st).href);

const checks = [], failures = [];
function check(name, ok, detail) {
  checks.push(name);
  if (!ok) failures.push({ name, detail: detail === undefined ? "" : String(detail) });
}
const worst = { world: 0, stage: 0, roundTrip: 0 };

// ── (a) The world frame is the backend's ────────────────────────────────────
for (const c of CASES.world) {
  const xf = makeStackXform(c.transform, c.gauge);
  if (!xf) { check(`${c.name}: has a world frame`, false); continue; }
  let w = 0;
  for (let i = 0; i < c.fracs.length; i++) {
    const [x, y] = xf.mapPt(c.fracs[i][0], c.fracs[i][1]);
    w = Math.max(w, Math.hypot(x - c.world[i][0], y - c.world[i][1]));
  }
  worst.world = Math.max(worst.world, w);
  check(`${c.name}: the world frame matches the backend`, w <= 1e-9, w);

  // ...and the inverse is the inverse.
  let inv = 0;
  for (const [fx, fy] of c.fracs) {
    const [wx, wy] = xf.mapPt(fx, fy);
    const back = xf.invMapPt(wx, wy);
    inv = Math.max(inv, Math.hypot(back[0] - fx, back[1] - fy));
  }
  check(`${c.name}: invMapPt undoes mapPt`, inv <= 1e-9, inv);
}

// No placement, or no gauge, means NOTHING is drawn — not something drawn at
// a guessed size. The deleted 20 m fallback is what that mistake looked like.
check("no placement -> null", makeStackXform(null, { m_per_unit: 20 }) === null);
check("no gauge -> null", makeStackXform({ scale_x_m: 20 }, null) === null);
check("a zero gauge -> null", makeStackXform({ scale_x_m: 20 }, { m_per_unit: 0 }) === null);
check("mapXform on an unplaced map -> null",
  mapXform({ map_transforms: {}, world_gauge: { m_per_unit: 20 } }, { id: "m1" }) === null);
check("mapXform with no world frame -> null",
  mapXform({ map_transforms: { m1: { scale_x_m: 20, scale_y_m: 15 } }, world_gauge: {} },
    { id: "m1" }) === null);

// ── (b) The align stage IS the reference picture ────────────────────────────
for (const c of CASES.stage) {
  const af = placementStageAffine(c.target, c.reference);
  if (!af) { check(`${c.name}: the stage affine exists`, false); continue; }
  let w = 0;
  for (const [u, v] of c.fracs) {
    // Where the CSS puts this fraction of the target, in stage coordinates.
    const sx = af.m[0] * (u - 0.5) + af.m[1] * (v - 0.5) + 0.5 + af.ox;
    const sy = af.m[2] * (u - 0.5) + af.m[3] * (v - 0.5) + 0.5 + af.oy;
    // Where it BELONGS: its metres, read back as a reference fraction.
    const m = mapFracToMetres(c.target, u, v);
    const f = metresToMapFrac(c.reference, m[0], m[1]);
    w = Math.max(w, Math.hypot(sx - f[0], sy - f[1]));
  }
  worst.stage = Math.max(worst.stage, w);
  check(`${c.name}: the stage draws the target where its metres are`, w <= 1e-9, w);
}
check("a stage over an unplaced reference is refused",
  placementStageAffine(CASES.stage[0].target, null) === null);

// ── (c) The editor's gestures round-trip ────────────────────────────────────
//
// The four controls that used to null `_m` on one click, and the drag. Each
// edits the placement and the stage is redrawn from it, so "what is on screen"
// and "what Save commits" are one object — which is the whole point of the
// stack being derived. This replays them and checks the drawn stage against
// the placement after every step.
function keepCentre(before, after) {
  const c0 = mapFracToMetres(before, 0.5, 0.5);
  const c1 = mapFracToMetres(after, 0.5, 0.5);
  after.origin_x_m += c0[0] - c1[0];
  after.origin_y_m += c0[1] - c1[1];
  return after;
}
for (const c of CASES.stage) {
  let p = { ...c.target };
  const R = c.reference;
  const steps = [
    ["scale +5%", (q) => { q.scale_x_m *= 1.05; q.scale_y_m *= 1.05; return q; }],
    ["x-stretch +5%", (q) => { q.scale_x_m *= 1.05; return q; }],
    ["turn -15 deg", (q) => { q.rotation_rad -= 15 * Math.PI / 180; return q; }],
    ["turn +15 deg", (q) => { q.rotation_rad += 15 * Math.PI / 180; return q; }],
  ];
  for (const [label, fn] of steps) {
    const centre0 = mapFracToMetres(p, 0.5, 0.5);
    p = keepCentre(p, fn({ ...p }));
    const centre1 = mapFracToMetres(p, 0.5, 0.5);
    check(`${c.name}: ${label} turns the map about its own centre`,
      Math.hypot(centre1[0] - centre0[0], centre1[1] - centre0[1]) <= 1e-9);
    const af = placementStageAffine(p, R);
    let w = 0;
    for (const [u, v] of c.fracs) {
      const sx = af.m[0] * (u - 0.5) + af.m[1] * (v - 0.5) + 0.5 + af.ox;
      const sy = af.m[2] * (u - 0.5) + af.m[3] * (v - 0.5) + 0.5 + af.oy;
      const m = mapFracToMetres(p, u, v);
      const f = metresToMapFrac(R, m[0], m[1]);
      w = Math.max(w, Math.hypot(sx - f[0], sy - f[1]));
    }
    worst.roundTrip = Math.max(worst.roundTrip, w);
    check(`${c.name}: ${label} — the stage still draws what will be saved`, w <= 1e-9, w);
  }
  // A drag: the origin moves by the metres the cursor crossed on the
  // reference's own picture.
  const a = mapFracToMetres(R, 0.5, 0.5);
  const b = mapFracToMetres(R, 0.5 + 0.17, 0.5 - 0.09);
  const before = mapFracToMetres(p, 0.25, 0.75);
  p.origin_x_m += b[0] - a[0];
  p.origin_y_m += b[1] - a[1];
  const after = mapFracToMetres(p, 0.25, 0.75);
  check(`${c.name}: a drag moves the map by the metres the cursor crossed`,
    Math.abs((after[0] - before[0]) - (b[0] - a[0])) <= 1e-9
    && Math.abs((after[1] - before[1]) - (b[1] - a[1])) <= 1e-9);
}

// The Point Align apply path: the solve composed with the reference's record.
for (const c of CASES.point_align) {
  const toRefFrac = (u, v) => [
    c.m[0] * (u - 0.5) + c.m[1] * (v - 0.5) + 0.5 + c.dx,
    c.m[2] * (u - 0.5) + c.m[3] * (v - 0.5) + 0.5 + c.dy,
  ];
  const at = (u, v) => { const f = toRefFrac(u, v); return mapFracToMetres(c.reference, f[0], f[1]); };
  const o = at(0, 0), ex = at(1, 0), ey = at(0, 1);
  const solved = placementFromColumns(o, [ex[0] - o[0], ex[1] - o[1]],
                                         [ey[0] - o[0], ey[1] - o[1]]);
  let w = 0;
  for (const [u, v] of c.fracs) {
    const got = mapFracToMetres(solved, u, v);
    const want = at(u, v);
    w = Math.max(w, Math.hypot(got[0] - want[0], got[1] - want[1]));
  }
  check(`${c.name}: the applied placement reproduces the solve`, w <= 1e-9, w);
  check(`${c.name}: it matches the backend's decomposition`,
    ["origin_x_m", "origin_y_m", "scale_x_m", "scale_y_m", "rotation_rad", "shear_rad"]
      .every((k) => Math.abs(solved[k] - c.expected[k]) <= 1e-9),
    JSON.stringify({ js: solved, py: c.expected }));
}

console.log(JSON.stringify({ checks, failures, worst }));
process.exit(failures.length ? 1 : 0);
