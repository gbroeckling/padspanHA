// Point Align's rigid solve places a map with its OWN image's aspect (#62).
//
// INVARIANT: a placed map's world footprint has its own image's aspect, so
// world pixels are square. `_solvePtAlignRigid` was handed ONE ratio — the
// REFERENCE image's — and used it for the TARGET's v terms too, so its
// reconstruction had m11 === m22 by construction and the placed footprint
// took the reference picture's shape whatever the target's was.
//
// The solver is a closure-local const inside `_stack()` with no export, so it
// is lifted out of maps.js by text and run exactly as it ships — the same
// string-surgery-then-node route tests/test_fabric_frame_contract.py uses on
// views/iso_lights.js. Nothing here re-implements it, and the footprint is
// measured THROUGH THE PLACEMENT THE APPLY PATH WRITES: the solve composed
// with the reference's own metre record and read off its two columns by
// `placementFromColumns`, which is exactly what maps.js does on Apply. It used
// to be measured through `worldAffine`'s `_m` branch, because a solved align
// was stored as a matrix on the stack; there is no stack, so the invariant is
// checked on the metres that are actually stored.
//
// Run:  node tests/js/point_align_solver.mjs <views dir>
// Prints one JSON line: { "checks": [...], "failures": [...] }.
import fs from "node:fs";
import { pathToFileURL } from "node:url";
import { join } from "node:path";

const VIEWS_DIR = process.argv[2];
const { placementFromColumns, mapFracToMetres } =
  await import(pathToFileURL(join(VIEWS_DIR, "stack_transform.js")).href);

// A reference map placed at the world origin, 100 m across, at the reference
// picture's own aspect — one world unit of the old frame per 100 m, so the
// numbers below stay comparable with the world-unit figures this used to
// assert. `arT` is the TARGET picture's aspect; if the composition below
// carries the reference's instead, this is where it shows.
const REF_M = 100.0;
function refPlacement(ar) {
  return { origin_x_m: 0, origin_y_m: 0, scale_x_m: REF_M, scale_y_m: REF_M * ar,
           rotation_rad: 0, shear_rad: 0 };
}

// ── The shipped solver, lifted out of maps.js ───────────────────────────────
const SRC = fs.readFileSync(join(VIEWS_DIR, "maps.js"), "utf8");
function grab(name) {
  const start = SRC.indexOf("  const " + name + " = (");
  if (start < 0) throw new Error("not found in maps.js: " + name);
  const rest = SRC.slice(start);
  const end = rest.search(/\r?\n {2}\};\r?\n/);   // the const's own closer
  if (end < 0) throw new Error("no terminator for " + name);
  return rest.slice(0, end) + "\n  };\n";
}
const { _gaussSolve, _solvePtAlignRigid } = new Function(
  grab("_gaussSolve") + grab("_solvePtAlignRigid") +
  "return { _gaussSolve, _solvePtAlignRigid };")();

// The model that shipped BEFORE the fix, transcribed from HEAD verbatim so
// "unchanged where the two pictures already agree" is asserted against the old
// code and not against the new code called twice. One ratio, used for both.
const _oneRatioRigid = (refPts, tgtPts, ar) => {
  ar = ar || 1;
  const n = Math.min(refPts.length, tgtPts.length);
  if (n < 2) return null;
  const cx = 0.5, cy = 0.5;
  const K = 4;
  const ATA = Array.from({ length: K }, () => Array(K).fill(0));
  const ATb = Array(K).fill(0);
  for (let i = 0; i < n; i++) {
    const u = tgtPts[i].x - cx, v = tgtPts[i].y - cy;
    const bx = refPts[i].x - cx, by = refPts[i].y - cy;
    const r1 = [u, -ar * v, 1, 0];   // x equation
    const r2 = [v, u / ar,  0, 1];   // y equation
    for (let j = 0; j < K; j++) {
      for (let k = 0; k < K; k++) ATA[j][k] += r1[j] * r1[k] + r2[j] * r2[k];
      ATb[j] += r1[j] * bx + r2[j] * by;
    }
  }
  const x = _gaussSolve(ATA, ATb);
  if (!x) return null;
  const a = x[0], b = x[1], dx = x[2], dy = x[3];
  const scale = Math.sqrt(a * a + b * b);
  const rotation = Math.atan2(b, a) * 180 / Math.PI;
  const m11 = a, m12 = -b * ar, m21 = b / ar, m22 = a;
  let res = 0;
  for (let i = 0; i < n; i++) {
    const u2 = tgtPts[i].x - cx, v2 = tgtPts[i].y - cy;
    const predX = m11 * u2 + m12 * v2 + cx + dx;
    const predY = m21 * u2 + m22 * v2 + cy + dy;
    res += (predX - refPts[i].x) ** 2 + (predY - refPts[i].y) ** 2;
  }
  return { x_offset: dx, y_offset: dy, scale, rotation, scaleX_adj: 1.0,
    residual: Math.sqrt(res / n), _m: [m11, m12, m21, m22] };
};

const checks = [], failures = [];
function check(name, ok, detail) {
  checks.push(name);
  if (!ok) failures.push({ name, detail: detail === undefined ? "" : String(detail) });
}

// ── The two pictures ────────────────────────────────────────────────────────
// rjbutler's own: Main Floor 1600x853 point-aligned onto Upstairs 930x850.
const RJ  = { name: "1600x853 onto 930x850", arT: 853 / 1600, ar: 850 / 930 };
// And the other way round, so a target TALLER than its reference is covered.
const REV = { name: "930x850 onto 1600x853", arT: 850 / 930, ar: 853 / 1600 };

// A placement that is rigid in the TARGET's own square pixels — rotate by θ
// and scale by s there, then drop the result into the REFERENCE's frac frame,
// which is the space the solver is asked to hit. "Rigid" can only mean this;
// anything else distorts the target's picture.
function plant(ar, arT, s, thetaDeg, dx, dy) {
  const th = thetaDeg * Math.PI / 180, c = Math.cos(th), sn = Math.sin(th);
  return (x, y) => {
    const u = x - 0.5, v = y - 0.5;
    const X = s * (c * u - sn * arT * v);
    const Y = s * (sn * u + c * arT * v);
    return { x: X + 0.5 + dx, y: Y / ar + 0.5 + dy };
  };
}

// Six pairs, well spread and not collinear: more than the 4 unknowns, so a
// model that cannot express the placement cannot hide in an exact fit.
const TGT = [{ x: 0.18, y: 0.22 }, { x: 0.81, y: 0.19 }, { x: 0.47, y: 0.83 },
             { x: 0.29, y: 0.61 }, { x: 0.73, y: 0.68 }, { x: 0.55, y: 0.36 }];

// The footprint as the STORE holds it: the solve composed with the
// reference's placement and read off its two metre columns — the Apply path,
// with the metres divided back by REF_M so the figures are the world units
// this file has always quoted.
function applied(r, ar) {
  const R = refPlacement(ar);
  const toRefFrac = (u, v) => [
    r._m[0]*(u-0.5) + r._m[1]*(v-0.5) + 0.5 + r.x_offset,
    r._m[2]*(u-0.5) + r._m[3]*(v-0.5) + 0.5 + r.y_offset,
  ];
  const at = (u, v) => { const f = toRefFrac(u, v); return mapFracToMetres(R, f[0], f[1]); };
  const o = at(0, 0), ex = at(1, 0), ey = at(0, 1);
  return placementFromColumns(o, [ex[0]-o[0], ex[1]-o[1]], [ey[0]-o[0], ey[1]-o[1]]);
}

function footprint(r, ar) {
  const p = applied(r, ar);
  const w = p.scale_x_m / REF_M, h = p.scale_y_m / REF_M;
  return { w, h, ar: h / w, shear: Math.abs(Math.sin(p.shear_rad)) };
}

// ── (a) The footprint keeps the TARGET's aspect ─────────────────────────────
for (const G of [RJ, REV]) {
  for (const theta of [0, 12, -37, 90]) {
    const S = 1.4231, DX = 0.031, DY = -0.019;
    const f = plant(G.ar, G.arT, S, theta, DX, DY);
    const ref = TGT.map((p) => f(p.x, p.y));
    const r = _solvePtAlignRigid(ref, TGT, G.ar, G.arT);
    const tag = `${G.name} @${theta}deg`;
    check(`${tag}: solves`, !!r);
    if (!r) continue;
    const fp = footprint(r, G.ar);
    check(`${tag}: the footprint has the TARGET's aspect`, Math.abs(fp.ar - G.arT) <= 1e-9,
      `footprint ${fp.ar} — target ${G.arT}, reference ${G.ar}`);
    check(`${tag}: the footprint is the planted size`,
      Math.abs(fp.w - S) <= 1e-9 && Math.abs(fp.h - S * G.arT) <= 1e-9,
      `${fp.w} x ${fp.h}, planted ${S} x ${S * G.arT}`);
    check(`${tag}: the footprint is square-cornered`, fp.shear <= 1e-9, fp.shear);
    check(`${tag}: it reproduces the pairs it was given`, r.residual <= 1e-12,
      `residual ${r.residual}`);
    check(`${tag}: the offsets are the planted ones`,
      Math.abs(r.x_offset - DX) <= 1e-9 && Math.abs(r.y_offset - DY) <= 1e-9,
      `${r.x_offset}, ${r.y_offset}`);
    // The defect itself, on the same pairs: one ratio has no term that can
    // carry the target's aspect, so its footprint is the REFERENCE's shape.
    const old = _oneRatioRigid(ref, TGT, G.ar);
    check(`${tag}: the one-ratio model gave the REFERENCE's shape`,
      old._m[0] === old._m[3] && Math.abs(footprint(old, G.ar).ar - G.ar) <= 1e-9,
      `${footprint(old, G.ar).ar}`);
  }
}

// ── (b) Same-shaped pictures are BIT-identical to the one-ratio model ───────
// The overwhelmingly common align, and it must be untouched — not close,
// identical. arT/ar is exactly 1.0 for any finite non-zero ar, so `arT * v`,
// `arR * v`, `a * arR` and `1 / arR` each collapse onto the old term. The
// second pair set does not come from a rigid placement, so the least-squares
// compromise path is compared too, not only an exact fit.
const NOISY = [{ x: 0.21, y: 0.19 }, { x: 0.77, y: 0.28 }, { x: 0.44, y: 0.91 },
               { x: 0.12, y: 0.55 }, { x: 0.69, y: 0.52 }, { x: 0.58, y: 0.31 }];
const FIELDS = ["scale", "scaleX_adj", "rotation", "x_offset", "y_offset", "residual"];
for (const ar of [853 / 1600, 850 / 930, 1.0, 1.7, 0.75]) {
  const planted = TGT.map((p) => plant(ar, ar, 1.1, 23, 0.04, -0.06)(p.x, p.y));
  for (const [what, ref] of [["a rigid placement", planted], ["points that do not fit", NOISY]]) {
    const a = _solvePtAlignRigid(ref, TGT, ar, ar), b = _oneRatioRigid(ref, TGT, ar);
    check(`ar=${ar}, ${what}: identical to the one-ratio model when the shapes agree`,
      FIELDS.every((k) => a[k] === b[k]) && a._m.every((v, i) => v === b._m[i]),
      JSON.stringify({ fixed: a, shipped: b }));
  }
}

// ── (c) The applied placement draws the map where the solve put it ─────────
// The solver's own preview uses the matrix; Apply stores metres. If the two
// disagreed the preview would draw one thing and the store hold another —
// which is precisely the split this release deletes, so it is checked rather
// than assumed. Every point the solve was given must land, in metres, where
// the reference's record puts the reference point it was matched to.
for (const G of [RJ, REV, { name: "same shape", ar: 0.75, arT: 0.75 }]) {
  for (const theta of [0, 12, -37]) {
    const f = plant(G.ar, G.arT, 0.87, theta, 0.02, 0.05);
    const ref = TGT.map((p) => f(p.x, p.y));
    const r = _solvePtAlignRigid(ref, TGT, G.ar, G.arT);
    const P = applied(r, G.ar), R = refPlacement(G.ar);
    let worst = 0;
    for (let i = 0; i < TGT.length; i++) {
      const a = mapFracToMetres(P, TGT[i].x, TGT[i].y);
      const b = mapFracToMetres(R, ref[i].x, ref[i].y);
      worst = Math.max(worst, Math.hypot(a[0] - b[0], a[1] - b[1]));
    }
    check(`${G.name} @${theta}deg: every matched pair lands on its reference point`,
      worst <= 1e-9 * REF_M, `worst ${worst} m over ${REF_M} m`);
  }
}

// ── The target's aspect has no default ──────────────────────────────────────
// A fallback to `ar` would put the one-ratio model back for any caller that
// forgets the argument, and put it back silently — the solve would succeed and
// write a placement of the wrong shape. There is nothing to solve without it.
const REF_OK = TGT.map((p) => plant(RJ.ar, RJ.arT, 1.0, 5, 0, 0)(p.x, p.y));
for (const [what, bad] of [["omitted", undefined], ["zero", 0], ["negative", -0.9],
                           ["NaN", NaN]]) {
  check(`a target aspect that is ${what} is refused`,
    _solvePtAlignRigid(REF_OK, TGT, RJ.ar, bad) === null);
}

console.log(JSON.stringify({ checks, failures }));
process.exit(failures.length ? 1 : 0);
