// Change Master moves the whole house into the new master's frame — on the
// affine the renderer draws, for every map, whichever branch it is on.
//
// Run:  node tests/js/change_master.mjs <views dir>
// Prints one JSON line: { "checks": [...], "failures": [...] }.
import { pathToFileURL } from "node:url";
import { join } from "node:path";

const VIEWS_DIR = process.argv[2];
const st = await import(pathToFileURL(join(VIEWS_DIR, "stack_transform.js")).href);
const { makeStackXform, imageAr, changeMasterStacks, worldAffine, composeAffine,
        invertAffine, stackFieldsFromAffine } = st;

const checks = [], failures = [];
function check(name, ok, detail) {
  checks.push(name);
  if (!ok) failures.push({ name, detail: detail === undefined ? "" : String(detail) });
}

// ── The house ───────────────────────────────────────────────────────────────
// A rotated, sheared Point-Aligned new master whose decomposed fields are
// STALE (what a trim leaves behind), a hand-placed map, a Point-Aligned map
// that references the new master rather than the old one, and a map that
// references a third map. Only `_m` is in force on the affine maps.
const rot = 23 * Math.PI / 180;
const N_M = [0.92 * Math.cos(rot), -0.61 * Math.sin(rot) * 0.75 + 0.08,
             0.92 * Math.sin(rot) / 0.75, 0.61 * Math.cos(rot)];
const house = () => [
  { id: "old", image: { width: 800, height: 600 }, stack: { is_master: true, tie_ins: [{ ref_map_id: "n" }] } },
  { id: "n",   image: { width: 1000, height: 500 },
    stack: { x_offset: 0.11, y_offset: -0.04, _m: N_M.slice(), _m_ar: 0.75, ref_ar: 0.75,
             ref_map_id: "old", scale: 0.3, scale_x_adj: 2.2, rotation: -80, tie_ins: [{ ref_map_id: "old" }] } },
  { id: "p",   image: { width: 640, height: 480 },
    stack: { x_offset: 0.2, y_offset: 0.1, scale: 0.8, rotation: 17, scale_x_adj: 1.1, ref_ar: 0.75, ref_map_id: "old" } },
  { id: "q",   image: { width: 800, height: 800 },
    stack: { x_offset: -0.05, y_offset: 0.3, _m: [0.7, 0.1, -0.2, 0.65], _m_ar: 0.75, ref_ar: 0.75, ref_map_id: "n" } },
  { id: "r",   image: { width: 500, height: 400 },
    stack: { x_offset: 0.4, y_offset: -0.2, scale: 1.3, rotation: -40, ref_map_id: "p" } },
];
const SAMPLE = [[0, 0], [1, 0], [0, 1], [1, 1], [0.3, 0.7], [0.5, 0.5]];
const world = (m, stk) => SAMPLE.map(([x, y]) => makeStackXform(stk || m.stack, imageAr(m)).mapPt(x, y));
const applied = (maps, patches) => maps.map((m) => ({ ...m, stack: Object.assign({}, m.stack, patches[m.id]) }));
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const worst = (A, B) => Math.max(...A.map((a, i) => dist(a, B[i])));

const before = house();
const patches = changeMasterStacks(before, "n");
check("returns a patch for every map", patches && Object.keys(patches).length === before.length,
  JSON.stringify(patches && Object.keys(patches)));
const after = applied(before, patches);
const byId = Object.fromEntries(after.map((m) => [m.id, m]));

// The one frame change every map must share: fitted from the new master's
// own corners (old world -> [frac_x, arN * frac_y]), then applied to everyone.
const N0 = before.find((m) => m.id === "n"), N1 = byId.n;
const arN = imageAr(N0);
const fit = (() => {
  const src = world(N0).slice(0, 3), dst = world(N1, N1.stack).slice(0, 3);
  const M = src.map(([x, y]) => [x, y, 1]);
  const solve = (col) => {
    const a = M.map((r, i) => [...r, col[i]]);
    for (let i = 0; i < 3; i++) {
      let p = i;
      for (let k = i + 1; k < 3; k++) if (Math.abs(a[k][i]) > Math.abs(a[p][i])) p = k;
      [a[i], a[p]] = [a[p], a[i]];
      for (let k = 0; k < 3; k++) {
        if (k === i) continue;
        const f = a[k][i] / a[i][i];
        for (let j = i; j < 4; j++) a[k][j] -= f * a[i][j];
      }
    }
    return a.map((r, i) => r[3] / r[i]);
  };
  const ax = solve(dst.map((d) => d[0])), ay = solve(dst.map((d) => d[1]));
  return ([x, y]) => [ax[0] * x + ax[1] * y + ax[2], ay[0] * x + ay[1] * y + ay[2]];
})();

check("new master is at the pristine origin",
  worst(world(N1, N1.stack), SAMPLE.map(([x, y]) => [x, arN * y])) < 1e-9
  && N1.stack._m === null && N1.stack.is_master === true && N1.stack.ref_map_id === null
  && N1.stack.ref_ar === arN && N1.stack.tie_ins.length === 0,
  JSON.stringify(N1.stack));

for (const m0 of before) {
  if (m0.id === "n") continue;
  const m1 = byId[m0.id];
  const err = worst(world(m1, m1.stack), world(m0).map(fit));
  check(`${m0.id} moved with the frame, not by its stale fields`, err < 1e-9, `worst corner ${err}`);
  // The written decomposition describes the same footprint as the matrix —
  // the agreement fabric_truth.stack_desync measures.
  const xf = makeStackXform(m1.stack, imageAr(m1));
  const [x0, y0] = xf.mapPt(0, 0), [x1, y1] = xf.mapPt(1, 0), [x2, y2] = xf.mapPt(0, 1);
  const liveW = Math.hypot(x1 - x0, y1 - y0), liveH = Math.hypot(x2 - x0, y2 - y0);
  const saidW = m1.stack.scale * m1.stack.scale_x_adj, saidH = m1.stack.scale * m1.stack.ref_ar;
  const desync = Math.max(Math.abs(saidW - liveW) / liveW, Math.abs(saidH - liveH) / liveH);
  check(`${m0.id} matrix and decomposition agree`, desync < 1e-3, `desync ${desync}`);
  check(`${m0.id} is not the master`, m1.stack.is_master === false);
}

// A map that referenced the NEW master, and one that referenced a third map,
// used to be skipped entirely — left behind in the old frame.
check("a map aligned to the new master was moved", worst(world(byId.q, byId.q.stack), world(before[3])) > 0.05);
check("a map aligned to a third map was moved", worst(world(byId.r, byId.r.stack), world(before[4])) > 0.05);
check("references follow the frame",
  byId.old.stack.ref_map_id === "n" && byId.p.stack.ref_map_id === "n"
  && byId.q.stack.ref_map_id === "n" && byId.r.stack.ref_map_id === "p",
  JSON.stringify(Object.fromEntries(after.map((m) => [m.id, m.stack.ref_map_id]))));
check("the old master's tie-ins are cleared, others' are kept",
  byId.old.stack.tie_ins.length === 0 && byId.n.stack.tie_ins.length === 0 && byId.q.stack.tie_ins === undefined);

// Going back is the inverse: every map lands where it started.
const back = applied(after, changeMasterStacks(after, "old"));
for (const m0 of before) {
  const m2 = back.find((m) => m.id === m0.id);
  const err = worst(world(m2, m2.stack), world(m0));
  check(`${m0.id} round-trips to its original placement`, err < 1e-9, `worst corner ${err}`);
}

// A new master whose matrix cannot be inverted is refused, not guessed at.
const singular = house();
singular[1].stack._m = [0.4, 0.2, 0.8, 0.4];
check("a singular new master is refused", changeMasterStacks(singular, "n") === null);
check("an unknown new master is refused", changeMasterStacks(house(), "nope") === null);

// The algebra itself: compose of inverse is the identity, both branches read
// back as the transform being drawn, and a stack written from an affine draws
// that affine — in ANY frame it is written against.
for (const m of house()) {
  const af = worldAffine(m.stack, imageAr(m));
  const inv = invertAffine(af);
  const id = composeAffine(inv, af);
  check(`${m.id}: affine composed with its inverse is the identity`,
    worst([[id.M[0], id.M[1]], [id.M[2], id.M[3]], id.c], [[1, 0], [0, 1], [0, 0]]) < 1e-9);
  const xf = makeStackXform(m.stack, imageAr(m));
  const viaAf = SAMPLE.map(([x, y]) => {
    const u = x - 0.5, v = y - 0.5;
    return [af.M[0] * u + af.M[1] * v + af.c[0], af.M[2] * u + af.M[3] * v + af.c[1]];
  });
  check(`${m.id}: worldAffine is what makeStackXform draws`,
    worst(viaAf, SAMPLE.map(([x, y]) => xf.mapPt(x, y))) < 1e-9);
  for (const ar of [0.75, 1, 1.6]) {
    const rewritten = Object.assign({}, m.stack, stackFieldsFromAffine(af, ar));
    check(`${m.id}: a stack written from its affine in frame ${ar} draws the same`,
      worst(world(m, rewritten), world(m)) < 1e-9);
  }
}

console.log(JSON.stringify({ checks, failures }));
process.exit(failures.length ? 1 : 0);
