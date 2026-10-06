// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
// See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
//
// Live Aboard's Strip tool (docs/IDEA_ATLAS_3D_HOUSE.md; Garry, 2026-10-05:
// "a step farther for Sims"): where an LED strip or a string of lights really
// goes, as plain numbers. No three.js, no page: the view's light builder
// (live_aboard_house.js runParts), the Strip tool (live_aboard_strip.js) and
// node (tests/js/live_aboard_runs.mjs) call these.
//
// A run, in the 3D file (house3d_store.py _run), lights[<entity id>].run:
//   pts        [[x, y, h], ...], 2 to 64: x and y in metres on the light's own
//              floor, h above that floor. On a piece of furniture ("piece"):
//              across it, to its front and above its bottom (the piece's own
//              frame, live_aboard_pieces.js boxOf), so it moves and turns
//              with the piece.
//   face       which way it shines: "up" (the wall above and the ceiling, a
//              cove), "down" (the counter or the floor, under the cabinets),
//              "room" (a pool in the room), "wall" (a halo behind a TV)
//   loop       the last point joins the first
//   sag_m, spacing_m   a string of lights: its swag between points and a bulb
//              every so often
//   gaps       the stretches that are only wire (a jump past a door), by
//              number from 0 (stretch i runs from point i to point i + 1)
// Every stretch is at least 5 cm, the whole at most 100 m (the server's
// rules, checked here first so Save never fails on them).

export const FACES = ["up", "down", "room", "wall"];
export const FACE_NAMES = [["up", "Up"], ["down", "Down"], ["room", "Into the room"], ["wall", "Onto the wall"]];
export const PTS_MAX = 64, SEG_MIN_M = 0.05, RUN_MAX_M = 100, HEIGHT_MAX_M = 10, COORD_MAX_M = 10000;
export const SAG_MAX_M = 1.5, SAG_M = 0.25, SPACING_MIN_M = 0.15, SPACING_MAX_M = 2.0, SPACING_M = 0.4;
// The kinds the Strip tool is for: what "Lights to lay out" puts first.
export const STRIP_KINDS = new Set(["strip", "valance", "cove", "undercab", "kick", "tv", "string", "perimeter"]);
// Which way a kind shines when nothing says otherwise.
export function faceOf(kind){
  return { cove: "up", valance: "up", undercab: "down", kick: "down", tv: "wall" }[kind] || "room";
}
// Hidden tape: unseen while off (as Wave A draws them).
export const HIDDEN_OFF = new Set(["undercab", "kick", "tv", "cove"]);
export const TAPE_M = 0.022;               // a strip's width and depth
export const RAIL_TOP_M = 1.03;            // on a deck rail: 3 cm over its top (the house's RAIL_H)
export const SNAP_M = 0.03;                // a height snaps to a chip this near

const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
export const mm = (v) => Math.round(v * 1000) / 1000;
const copy = (x) => JSON.parse(JSON.stringify(x));
const obj = (v) => !!v && typeof v === "object" && !Array.isArray(v);
const d2 = (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1]);
const d3 = (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1], (b[2] || 0) - (a[2] || 0));
const unit = (v) => { const l = Math.hypot(v[0], v[1]) || 1; return [v[0] / l, v[1] / l]; };
/** A length as the tool shows it, "3.42 m". */
export const metres = (v) => `${(Math.round(v * 100) / 100).toFixed(2)} m`;
/** A height as the tool shows it, "140 cm". */
export const cm = (v) => `${Math.round(v * 100)} cm`;

// ── the run, read and checked ───────────────────────────────────────────────
/** The stretches of a run: [{a, b, i}] (the closing one too, on a loop). */
export function stretches(pts, loop){
  const out = [];
  for (let i = 0; i + 1 < pts.length; i++) out.push({ a: pts[i], b: pts[i + 1], i });
  if (loop && pts.length >= 3) out.push({ a: pts[pts.length - 1], b: pts[0], i: pts.length - 1 });
  return out;
}
/** How long it is, every stretch (the wire's too), in metres. */
export const lengthOf = (pts, loop) => stretches(pts || [], !!loop).reduce((s, q) => s + d3(q.a, q.b), 0);
/** Why the server would refuse this run (house3d_store.py _run), or null. */
export function problem(run){
  if (!obj(run) || !Array.isArray(run.pts)) return "A run needs its points.";
  const p = run.pts;
  if (p.length < 2) return "A run needs two points or more.";
  if (p.length > PTS_MAX) return `A run has at most ${PTS_MAX} points.`;
  for (const q of p) {
    if (!Array.isArray(q) || q.length !== 3 || q.some(v => num(v) === null)) return "A run's points are numbers.";
    if (Math.abs(q[0]) > COORD_MAX_M || Math.abs(q[1]) > COORD_MAX_M) return "A point is too far away.";
    if (q[2] < 0 || q[2] > HEIGHT_MAX_M) return `A point's height is 0 to ${HEIGHT_MAX_M} m.`;
  }
  if (!FACES.includes(run.face)) return "Pick which way it shines.";
  if (typeof run.loop !== "boolean" || (run.loop && p.length < 3)) return "A loop needs three points or more.";
  const st = stretches(p, run.loop);
  if (st.some(q => d3(q.a, q.b) < SEG_MIN_M - 1e-9)) return "Points closer than 5 cm: move one or delete it.";
  if (lengthOf(p, run.loop) > RUN_MAX_M + 1e-9) return `A run is at most ${RUN_MAX_M} m long.`;
  if ("piece" in run && !/^fur_[0-9a-f]{8}$/.test(String(run.piece))) return "That piece can't hold a run.";
  if ("sag_m" in run && !(num(run.sag_m) !== null && run.sag_m >= 0 && run.sag_m <= SAG_MAX_M)) return "The swag is 0 to 150 cm.";
  if ("spacing_m" in run && !(num(run.spacing_m) !== null && run.spacing_m >= SPACING_MIN_M && run.spacing_m <= SPACING_MAX_M)) return "Bulbs are 15 to 200 cm apart.";
  if ("gaps" in run && !(Array.isArray(run.gaps) && run.gaps.length < st.length && new Set(run.gaps).size === run.gaps.length
      && run.gaps.every(i => Number.isInteger(i) && i >= 0 && i < st.length))) return "Some of its gaps are not stretches of it.";
  return null;
}
/** The run as this version reads it (light entry → run), or null. */
export function readRun(entry){
  const r = obj(entry) ? entry.run : null;
  return obj(r) && !problem(r) ? r : null;
}
/** A run made tidy before it is kept: every point to the millimetre,
 *  points closer than 5 cm merged (a loop's closing one too), gaps that
 *  still name stretches, only the keys it has. {run} or {error}. */
export function tidy(run){
  const loop = !!run.loop, gaps = new Set(run.gaps || []);
  const pts = [], keep = [];
  (run.pts || []).forEach((q, i) => {
    const p = [mm(q[0]), mm(q[1]), mm(clamp(q[2], 0, HEIGHT_MAX_M))];
    if (pts.length && d3(pts[pts.length - 1], p) < SEG_MIN_M) return;
    pts.push(p); keep.push(i);
  });
  while (loop && pts.length > 2 && d3(pts[pts.length - 1], pts[0]) < SEG_MIN_M) { pts.pop(); keep.pop(); }
  const out = { pts, face: FACES.includes(run.face) ? run.face : "room", loop: loop && pts.length >= 3 };
  if (run.piece) out.piece = run.piece;
  if (num(run.sag_m) !== null) out.sag_m = mm(clamp(run.sag_m, 0, SAG_MAX_M));
  if (num(run.spacing_m) !== null) out.spacing_m = mm(clamp(run.spacing_m, SPACING_MIN_M, SPACING_MAX_M));
  // A gap goes with the point it starts from.
  const n = stretches(pts, out.loop).length, g = [];
  keep.forEach((i, k) => { if (gaps.has(i) && k < n) g.push(k); });
  if (g.length && g.length < n) out.gaps = g;
  const why = problem(out);
  return why ? { error: why } : { run: out };
}

// ── on a piece of furniture ─────────────────────────────────────────────────
// The piece's own frame (live_aboard_pieces.js boxOf): across it (u), to its
// front (v), above its bottom; rotation in degrees.
const frame = (p) => {
  const t = ((num(p && p.rotation) ?? 0) % 360) * Math.PI / 180;
  return { c: [num(p && p.x_m) ?? 0, num(p && p.y_m) ?? 0], z: num(p && p.z_m) ?? 0, u: [Math.cos(t), Math.sin(t)], v: [-Math.sin(t), Math.cos(t)] };
};
/** A point on a piece, as a point on its floor (house3d_store.py piece_point). */
export function piecePoint(p, q){
  const f = frame(p);
  return [mm(f.c[0] + f.u[0] * q[0] + f.v[0] * q[1]), mm(f.c[1] + f.u[1] * q[0] + f.v[1] * q[1]), mm(Math.min(HEIGHT_MAX_M, f.z + q[2]))];
}
/** A point on the floor, in a piece's own frame. */
export function onPieceFrame(p, q){
  const f = frame(p), dx = q[0] - f.c[0], dy = q[1] - f.c[1];
  return [mm(dx * f.u[0] + dy * f.u[1]), mm(dx * f.v[0] + dy * f.v[1]), mm(Math.max(0, q[2] - f.z))];
}
/** The run where it is drawn: its points on its floor (a run on a piece,
 *  where that piece stands now in `pieces`); null when its piece is gone
 *  (an older PadSpan removed it: the light is drawn as guessed, and the
 *  Strip tool asks for it to be laid out again). */
export function placed(run, pieces){
  if (!run) return null;
  if (!run.piece) return run;
  const p = pieces && pieces[run.piece];
  return obj(p) ? { ...run, pts: run.pts.map(q => piecePoint(p, q)) } : null;
}
/** The same run, off its piece, where it is now (the piece is being removed). */
export function detached(run, piece){
  const out = { ...copy(run), pts: run.pts.map(q => piecePoint(piece, q)) };
  delete out.piece;
  return out;
}
/** In a draft (DRAFT.ownedOf's shape), every run on a piece that `before`
 *  had and the draft no longer has stays where it was (the same Undo step).
 *  The ids it touched. */
export function keepRunsOf(cur, before){
  const out = [];
  for (const [eid, e] of Object.entries((cur && cur.lights) || {})) {
    const r = obj(e) ? e.run : null;
    if (!obj(r) || !r.piece || (cur.pieces && cur.pieces[r.piece]) || !obj(before && before[r.piece])) continue;
    e.run = detached(r, before[r.piece]);
    out.push(eid);
  }
  return out;
}
/** What the view draws runs from: each light's run, and where the piece a
 *  run is on stands (a piece moved, the run moves with it). */
export function runsSignature(vd){
  const L = (vd && vd.lights) || {}, P = (vd && vd.pieces) || {};
  return JSON.stringify(Object.keys(L).sort().filter(k => obj(L[k]) && obj(L[k].run)).map(k => {
    const r = L[k].run, p = r.piece ? P[r.piece] : null;
    return [k, r, p ? [p.x_m, p.y_m, p.z_m, p.rotation] : null];
  }));
}

// ── the walls of a room, as one loop ────────────────────────────────────────
// A room's outline is its walls' inside faces (live_aboard_house.js
// deriveWalls: an outside wall stands outside it, a shared one is centred in
// the gap): a strip on the wall is the outline drawn in a little.
const area2 = (P) => { let s = 0; for (let i = 0; i < P.length; i++) { const a = P[i], b = P[(i + 1) % P.length]; s += a[0] * b[1] - b[0] * a[1]; } return s / 2; };
/** The outline moved in by `d` metres (each side parallel, corners mitred). */
export function insetLoop(pts, d){
  const P = (pts || []).filter((p, i, a) => d2(p, a[(i + 1) % a.length]) > 1e-6);
  if (P.length < 3) return P.map(p => [p[0], p[1]]);
  const s = area2(P) > 0 ? 1 : -1, n = P.length, out = [];
  for (let i = 0; i < n; i++) {
    const a = P[(i + n - 1) % n], b = P[i], c = P[(i + 1) % n];
    const u1 = unit([b[0] - a[0], b[1] - a[1]]), u2 = unit([c[0] - b[0], c[1] - b[1]]);
    // Inward: to the left of travel on a counter-clockwise outline (y up).
    const n1 = [-u1[1] * s, u1[0] * s], n2 = [-u2[1] * s, u2[0] * s];
    const m = [n1[0] + n2[0], n1[1] + n2[1]], k = 1 + n1[0] * n2[0] + n1[1] * n2[1];
    const f = k > 0.05 ? d / (k / 2) / 2 : d;                     // a hairpin corner: no spike
    out.push(k > 0.05 ? [b[0] + m[0] * f, b[1] + m[1] * f] : [b[0] + n2[0] * d, b[1] + n2[1] * d]);
  }
  return out;
}
/** The loop's inward side of stretch i (from point i to i + 1). */
export function inwardOf(loop, i){
  const s = area2(loop) > 0 ? 1 : -1, a = loop[i], b = loop[(i + 1) % loop.length], u = unit([b[0] - a[0], b[1] - a[1]]);
  return [-u[1] * s, u[0] * s];
}
/** Distances along the loop: cum[i] is where corner i is; P all the way round. */
export function perimeter(loop){
  const cum = [0];
  for (let i = 0; i < loop.length; i++) cum.push(cum[i] + d2(loop[i], loop[(i + 1) % loop.length]));
  return { cum, P: cum[loop.length] };
}
const wrap = (s, P) => ((s % P) + P) % P;
/** The point s metres round the loop: {x, y, i (its stretch)}. */
export function atS(loop, s){
  const { cum, P } = perimeter(loop), t = wrap(s, P);
  let i = 0;
  while (i < loop.length - 1 && cum[i + 1] <= t) i++;
  const a = loop[i], b = loop[(i + 1) % loop.length], L = cum[i + 1] - cum[i] || 1, f = (t - cum[i]) / L;
  return { x: a[0] + (b[0] - a[0]) * f, y: a[1] + (b[1] - a[1]) * f, i };
}
/** The nearest point of the loop to (x, y): {s, d (metres away), i}. */
export function sOf(loop, x, y){
  const { cum } = perimeter(loop);
  let best = null;
  for (let i = 0; i < loop.length; i++) {
    const a = loop[i], b = loop[(i + 1) % loop.length], dx = b[0] - a[0], dy = b[1] - a[1], L2 = dx * dx + dy * dy;
    const t = L2 ? clamp(((x - a[0]) * dx + (y - a[1]) * dy) / L2, 0, 1) : 0;
    const d = Math.hypot(x - a[0] - dx * t, y - a[1] - dy * t);
    if (!best || d < best.d) best = { s: cum[i] + t * Math.sqrt(L2), d, i };
  }
  return best;
}
/** How far a moving pointer went round the loop since `from` (the shorter
 *  way across the seam), so a drag carries on round the corners. */
export function stepRound(loop, from, to){
  const { P } = perimeter(loop);
  let d = wrap(to, P) - wrap(from, P);
  if (d > P / 2) d -= P; else if (d < -P / 2) d += P;
  return d;
}
/** The loop from s0 to s1 (s1 below s0: the other way round), with every
 *  corner on the way: [[x, y], ...]. Once round or more: the whole loop. */
export function pathAlong(loop, s0, s1){
  const { cum, P } = perimeter(loop), dir = s1 >= s0 ? 1 : -1, len = Math.min(Math.abs(s1 - s0), P);
  const at = (s) => { const q = atS(loop, s); return [q.x, q.y]; };
  const out = [at(s0)];
  // Corners strictly between, in the order met.
  const marks = [];
  for (let k = -1; k <= Math.ceil(len / P) + 1; k++) {
    for (let i = 0; i < loop.length; i++) {
      const c = cum[i] + k * P, off = (c - s0) * dir;
      if (off > 1e-6 && off < len - 1e-6) marks.push({ off, p: loop[i] });
    }
  }
  marks.sort((a, b) => a.off - b.off);
  for (const m of marks) out.push([m.p[0], m.p[1]]);
  out.push(at(s0 + dir * len));
  return out;
}
/** From s, the way `dir` goes (1 or -1), metres to the next corner. */
export function toCorner(loop, s, dir){
  const { cum, P } = perimeter(loop), t = wrap(s, P);
  let best = P;
  for (const c of cum) for (const k of [-1, 0, 1]) {
    const off = (c + k * P - t) * (dir >= 0 ? 1 : -1);
    if (off > 1e-6 && off < best) best = off;
  }
  return best;
}
/** Is the loop's corner at point i a real one (not a straight join)? */
const realCorner = (loop, i) => {
  const n = loop.length, a = loop[(i + n - 1) % n], b = loop[i], c = loop[(i + 1) % n];
  const u = unit([b[0] - a[0], b[1] - a[1]]), v = unit([c[0] - b[0], c[1] - b[1]]);
  return Math.abs(u[0] * v[1] - u[1] * v[0]) > 0.02 || u[0] * v[0] + u[1] * v[1] < 0;
};
/** "Round this room": the room's walls at height h as one closed loop, with
 *  the stretches past each door (and window, if asked) only wire. A door
 *  is a gap only where the run is lower than its head; a window only where
 *  the run crosses its glass. openings: [{kind: "door" | "window" | "open" | "doorway",
 *  a: [x, y], b: [x, y], sill, head}] (the floor's wall pieces).
 *  {run} or {error}. */
export function roundRoom(loop, h, openings, opts = {}){
  if (!loop || loop.length < 3) return { error: "That room has no walls to go round." };
  const { cum, P } = perimeter(loop), cuts = [];
  for (const o of openings || []) {
    const door = o.kind === "door" || o.kind === "open" || o.kind === "doorway";
    if (door ? !(opts.doors ?? true) || h >= (num(o.head) ?? 2.03) : o.kind !== "window" || !opts.windows
        || h <= (num(o.sill) ?? 0.9) || h >= (num(o.head) ?? 2.1)) continue;
    const A = sOf(loop, o.a[0], o.a[1]), B = sOf(loop, o.b[0], o.b[1]);
    if (A.d > 0.35 || B.d > 0.35) continue;                       // not on this room's walls
    let lo = A.s, hi = B.s;
    if (Math.abs(stepRound(loop, lo, hi)) < 0.05) continue;
    if (hi < lo) [lo, hi] = [hi, lo];
    if (hi - lo > P / 2) { const t = lo; lo = hi; hi = t + P; }   // across the seam
    cuts.push([lo, hi]);
  }
  // Every corner and every opening's ends, round the loop from the first corner.
  let marks = [];
  for (let i = 0; i < loop.length; i++) if (realCorner(loop, i)) marks.push(cum[i]);
  for (const [lo, hi] of cuts) marks.push(wrap(lo, P), wrap(hi, P));
  marks = [...new Set(marks.map(v => mm(v)))].sort((a, b) => a - b);
  const kept = [];
  for (const m of marks) if (!kept.length || m - kept[kept.length - 1] >= SEG_MIN_M) kept.push(m);
  while (kept.length > 2 && P - kept[kept.length - 1] + kept[0] < SEG_MIN_M) kept.pop();
  if (kept.length < 3) return { error: "That room is too small to go round." };
  if (kept.length > PTS_MAX) return { error: `That room has too many corners and doors for one run (${PTS_MAX} points at most).` };
  const inCut = (s) => cuts.some(([lo, hi]) => (s >= lo && s <= hi) || (s + P >= lo && s + P <= hi));
  const pts = kept.map(s => { const q = atS(loop, s); return [q.x, q.y, h]; });
  const gaps = [];
  kept.forEach((s, i) => { const e = i + 1 < kept.length ? kept[i + 1] : kept[0] + P; if (inCut((s + e) / 2)) gaps.push(i); });
  if (gaps.length >= kept.length) return { error: "It would be all doors: nothing left to light." };
  return tidy({ pts, face: opts.face || "up", loop: true, ...(gaps.length ? { gaps } : null) });
}
/** "Along this rail": the deck's edge at the rail's top (or at the deck
 *  itself with no rail), the stretches with no rail only wire. rails: the
 *  rail pieces ([{a, b}]); none at all: the whole edge at deck level. */
export function alongRail(loop, rails, opts = {}){
  if (!loop || loop.length < 3) return { error: "That deck has no edge to run along." };
  const has = (rails || []).length > 0, h = has ? RAIL_TOP_M : 0.03;
  const pts = loop.map(p => [p[0], p[1], h]), gaps = [];
  if (has) {
    loop.forEach((a, i) => {
      const b = loop[(i + 1) % loop.length], m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      const near = rails.some(r => segDist(m, r.a, r.b) < 0.3);
      if (!near) gaps.push(i);
    });
  }
  if (gaps.length >= loop.length) return { error: "No rail along that deck." };
  return tidy({ pts, face: opts.face || "room", loop: true, ...(gaps.length ? { gaps } : null) });
}
function segDist(p, a, b){
  const dx = b[0] - a[0], dy = b[1] - a[1], L2 = dx * dx + dy * dy;
  const t = L2 ? clamp(((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L2, 0, 1) : 0;
  return Math.hypot(p[0] - a[0] - dx * t, p[1] - a[1] - dy * t);
}

// ── round a piece ───────────────────────────────────────────────────────────
/** "Round this piece", in its own frame (it moves with it): "under" (a
 *  raised piece — wall cabinets, a shelf — along its underside front edge;
 *  one on the floor — a bed, a sofa — round its underside, just above the
 *  floor), "behind" (round its back, a TV or a headboard: a halo on the
 *  wall), "top" (along its top front edge, washing up). size {w, d, h}. */
export function roundPiece(piece, size, mode){
  const hu = size.w / 2, hv = size.d / 2, H = size.h, z = num(piece && piece.z_m) ?? 0;
  const inset = (v, by) => Math.max(0.01, v - by);
  let pts, face, loop = false;
  if (mode === "under") {
    if (z >= 0.3) { pts = [[-inset(hu, 0.02), inset(hv, 0.04), 0], [inset(hu, 0.02), inset(hv, 0.04), 0]]; face = "down"; }
    else {
      const a = inset(hu, 0.06), b = inset(hv, 0.06), hh = Math.min(0.06, H / 3);
      pts = [[-a, -b, hh], [a, -b, hh], [a, b, hh], [-a, b, hh]]; face = "down"; loop = true;
    }
  } else if (mode === "behind") {
    const a = inset(hu, 0.05), y = -hv + 0.004;                    // on its back (a flush-mounted TV: between it and the wall)
    if (H < 0.2) { pts = [[-a, y, H * 0.7], [a, y, H * 0.7]]; }
    else { const lo = Math.min(0.06, H / 4), hi = H - lo; pts = [[-a, y, lo], [a, y, lo], [a, y, hi], [-a, y, hi]]; loop = true; }
    face = "wall";
  } else {
    pts = [[-inset(hu, 0.02), inset(hv, 0.03), H + 0.012], [inset(hu, 0.02), inset(hv, 0.03), H + 0.012]];
    face = "up";
  }
  return tidy({ pts, face, loop, piece: piece.id });
}
/** The nearest edge of a piece's box to a point in its own frame (snapping a
 *  drawn point onto a cabinet's front edge, a TV's back, a shelf's top):
 *  the point moved onto that edge. size {w, d, h}. */
export function nearestBoxEdge(q, size){
  const hu = size.w / 2, hv = size.d / 2, H = size.h;
  const xs = [-hu, hu], ys = [-hv, hv], zs = [0, H];
  let best = null;
  const take = (p) => { const d = d3(p, q); if (!best || d < best.d) best = { d, p }; };
  for (const y of ys) for (const zz of zs) take([clamp(q[0], -hu, hu), y, zz]);          // edges across it
  for (const x of xs) for (const zz of zs) take([x, clamp(q[1], -hv, hv), zz]);          // edges front to back
  for (const x of xs) for (const y of ys) take([x, y, clamp(q[2], 0, H)]);               // upright edges
  return best.p.map(mm);
}

// ── heights ─────────────────────────────────────────────────────────────────
/** The height chips under a ceiling `ceil` metres up: [key, label, h]. */
export function chips(ceil){
  const c = num(ceil) ?? 2.65;
  return [["kick", "Toe-kick 10 cm", 0.1], ["counter", "Counter 91 cm", 0.91], ["undercab", "Under cabinets 140 cm", 1.4],
          ["valance", "Valance 210 cm", Math.min(2.1, c - 0.05)], ["cove", "Cove", mm(c - 0.15)], ["ceiling", "Ceiling edge", mm(c - 0.012)]];
}
/** A height kept between the floor and the ceiling, snapped to a chip, a
 *  piece's edge (`edges`, heights) or the ceiling when within 3 cm.
 *  {h, snap: null | label}. */
export function snapHeight(h, ceil, edges = []){
  const c = num(ceil) ?? 2.65, v = clamp(num(h) ?? 0, 0, c);
  let best = null;
  for (const [, label, at] of chips(c)) if (Math.abs(at - v) <= SNAP_M && (!best || Math.abs(at - v) < best.d)) best = { d: Math.abs(at - v), h: at, snap: label };
  for (const e of edges || []) if (num(e.h) !== null && Math.abs(e.h - v) <= SNAP_M && (!best || Math.abs(e.h - v) < best.d)) best = { d: Math.abs(e.h - v), h: e.h, snap: e.label };
  return best ? { h: mm(best.h), snap: best.snap } : { h: mm(v), snap: null };
}
/** The run raised or lowered by dh (all of it, or point k), kept between
 *  the floor and `top`; null when nothing moves. */
export function raised(run, dh, k = null, top = HEIGHT_MAX_M){
  const pts = run.pts.map((q, i) => (k === null || k === i ? [q[0], q[1], mm(clamp(q[2] + dh, 0, top))] : q.slice()));
  return pts.every((q, i) => q[2] === run.pts[i][2]) ? null : { ...run, pts };
}

// ── a string of lights: bulbs on a swag ─────────────────────────────────────
/** a with sag s over a level span L: a·(cosh(L / 2a) − 1) = s. */
function catA(L, s){
  let lo = 1e-3, hi = 1e6;
  for (let k = 0; k < 80; k++) { const a = Math.sqrt(lo * hi); if (a * (Math.cosh(L / (2 * a)) - 1) > s) lo = a; else hi = a; }
  return Math.sqrt(lo * hi);
}
/** The wire from a to b ([x, y, h]) hanging `sag` metres below the straight
 *  line at its middle (a catenary, the shape a hanging wire takes): n + 1
 *  points from a to b. */
export function catenary(a, b, sag, n = 16){
  const L = d2(a, b), s = Math.max(0, num(sag) ?? 0), out = [];
  const A = s > 1e-4 && L > 1e-3 ? catA(L, s) : null;
  for (let k = 0; k <= n; k++) {
    const t = k / n, x = t * L;
    const drop = A ? s - A * (Math.cosh((x - L / 2) / A) - 1) : 0;
    out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t - drop]);
  }
  return out;
}
/** A string's wire and bulbs: the wire hangs in a swag between each two
 *  points (not over a gap), a bulb every `spacing` metres along it, the
 *  first half that from where it starts. {wire: [[a, b], ...], bulbs:
 *  [[x, y, h], ...]}, bulbs at most `most`. */
export function stringOf(run, most = 800){
  const sag = num(run.sag_m) ?? SAG_M, spacing = clamp(num(run.spacing_m) ?? SPACING_M, SPACING_MIN_M, SPACING_MAX_M);
  const gaps = new Set(run.gaps || []), wire = [], bulbs = [];
  let carry = spacing / 2;                                         // to the next bulb
  for (const st of stretches(run.pts, run.loop)) {
    if (gaps.has(st.i)) { carry = spacing / 2; continue; }
    const c = catenary(st.a, st.b, Math.min(sag, d2(st.a, st.b) * 0.45), Math.max(8, Math.min(48, Math.ceil(d2(st.a, st.b) / 0.15))));
    for (let k = 0; k + 1 < c.length; k++) {
      const p = c[k], q = c[k + 1], L = d3(p, q);
      wire.push([p, q]);
      let at = carry;
      while (at <= L + 1e-9 && bulbs.length < most) {
        const f = L ? at / L : 0;
        bulbs.push([p[0] + (q[0] - p[0]) * f, p[1] + (q[1] - p[1]) * f, p[2] + (q[2] - p[2]) * f]);
        at += spacing;
      }
      carry = at - L;
    }
  }
  return { wire, bulbs };
}

// ── the tape, drawn ─────────────────────────────────────────────────────────
/** A box from a to b ([x, y, h]: plan metres and height), `w` wide and
 *  deep, lengthened `e0` and `e1` past its ends (mitred into the next
 *  stretch): its 16 matrix numbers, column by column, in the floor's own
 *  frame (x, up, y; the view adds the floor's height). side: the way across
 *  it when it runs straight up ([x, y]). */
export function boxMatrix(a, b, w, e0 = 0, e1 = 0, side = null){
  const A = [a[0], a[2], a[1]], B = [b[0], b[2], b[1]];
  const D = [B[0] - A[0], B[1] - A[1], B[2] - A[2]], L = Math.hypot(...D) || 1e-6, u = D.map(v => v / L);
  let s = [-u[2], 0, u[0]];                                        // across, level: up × along
  let sl = Math.hypot(s[0], s[2]);
  if (sl < 1e-6) { s = side ? [side[0], 0, side[1]] : [1, 0, 0]; sl = Math.hypot(s[0], s[2]) || 1; }
  s = s.map(v => v / sl);
  const y = [s[1] * u[2] - s[2] * u[1], s[2] * u[0] - s[0] * u[2], s[0] * u[1] - s[1] * u[0]];
  const len = L + e0 + e1, mid = (e1 - e0) / 2;
  const c = [(A[0] + B[0]) / 2 + u[0] * mid, (A[1] + B[1]) / 2 + u[1] * mid, (A[2] + B[2]) / 2 + u[2] * mid];
  return [u[0] * len, u[1] * len, u[2] * len, 0, y[0] * w, y[1] * w, y[2] * w, 0, s[0] * w, s[1] * w, s[2] * w, 0, c[0], c[1], c[2], 1];
}
/** How far each stretch is lengthened at its two ends so the tape turns a
 *  corner closed and clean (a mitre): half its width × tan(half the turn).
 *  [[e0, e1], ...] by stretch. */
export function mitres(run, w = TAPE_M){
  const st = stretches(run.pts, run.loop), gaps = new Set(run.gaps || []), n = st.length;
  const dirOf = (q) => { const D = [q.b[0] - q.a[0], q.b[1] - q.a[1], q.b[2] - q.a[2]], L = Math.hypot(...D) || 1; return D.map(v => v / L); };
  const ext = (p, q) => {
    if (!p || !q || gaps.has(p.i) || gaps.has(q.i)) return 0;
    const a = dirOf(p), b = dirOf(q), cos = clamp(a[0] * b[0] + a[1] * b[1] + a[2] * b[2], -1, 1);
    const turn = Math.acos(cos);
    return turn < 1e-3 ? 0 : (w / 2) * Math.tan(Math.min(turn, 2.6) / 2);
  };
  return st.map((q, k) => {
    const prev = k > 0 ? st[k - 1] : run.loop ? st[n - 1] : null, next = k + 1 < n ? st[k + 1] : run.loop ? st[0] : null;
    return [ext(prev, q), ext(q, next)];
  });
}
