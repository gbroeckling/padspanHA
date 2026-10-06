// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
// See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
//
// Live Aboard, the 3D house (docs/IDEA_ATLAS_3D_HOUSE.md): the 3D editor's
// rules, as plain numbers (P1 part C). No three.js, no page: the editor
// (live_aboard_edit.js) and the view (live_aboard.js) call these, and node
// runs them for real (tests/js/live_aboard_draft.mjs).
//
// What the 3D file holds for the editor (house3d_store.py, "Data"):
//   openings  "win_" / "door_" / "doorway_" + 8 hex digits: a door, window
//             or doorway (an opening with no door in it) drawn on a wall in
//             3D, a stretch of wall in fabric metres; any other key is a
//             barrier's id, and holds that barrier's hinge, swing, sill and
//             head in 3D only (the map is never written). A door with no
//             sensor is shown open, ajar or shut ("shown"; DOOR_SHOWN)
//   lights    {z_m, kind, run}: a light's height above its floor, what it
//             is (LIGHT_KIND: a pot, a valance, a lamp...) and where a strip
//             or a string of lights really goes (the Strip tool,
//             live_aboard_runs.js), in 3D only
//   devices   {z_m}: any other device's height (readouts, sensors); a
//             beacon's or scanner's recipe (P6) is passed through whole
//   pieces    furniture (P2 Furnish, "fur_" + 8 hex digits): each piece
//             whole, every key kept (live_aboard_pieces.js has its rules)
//   figures   people figures (P6), passed through whole
// The editor works on a draft of exactly these fields; nothing is stored
// until Save, which sends only what changed (an entry, or null to remove
// it) in one websocket command. Keys the editor does not own stay in the
// file: the server keeps them.
//
// The line tool. A wall is a "run": the wall pieces the 3D view draws that
// lie on one straight line, end to end (a wall split by a barrier, two
// rooms' edges in line). A line drawn on a run stays on it and stops at a
// corner — the run's ends, and where another wall meets it — and at any
// door or window already there, sensor ones included: openings never
// overlap. A window is 0.3 m or wider, a door 0.6 m.

export const WINDOW_MIN_M = 0.3, DOOR_MIN_M = 0.6;
export const WINDOW_SILL_M = 0.9, WINDOW_HEAD_M = 2.1, DOOR_HEAD_M = 2.03;
export const GAP_MIN_M = 0.1;              // a window's least height, head over sill (the server's too)
export const DOOR_LOW_M = 1.0;             // the lowest door the slider offers
export const DOOR_MIN_HEAD_M = 0.5;        // the lowest door the server keeps, however low the ceiling
export const OPENING_ID = /^(win|door|doorway)_[0-9a-f]{8}$/;
// How a door with no sensor is shown (house3d_store.py DOOR_SHOWN); none
// stored: ajar inside, shut on an outside wall (live_aboard_storey.js doorShown).
export const DOOR_SHOWN = ["open", "ajar", "shut"];
// What a door is and its options (house3d_store.py DOOR_TYPES and the rest;
// live_aboard_storey.js draws each): kept on an added door and a barrier's
// entry alike, each only when it is one the server keeps.
export const DOOR_TYPES = ["hinged", "double", "sliding", "barn", "pocket", "bifold", "overhead", "rollup", "tiltup", "gate"];
export const DOOR_SLIDES = ["left", "right", "both"], DOOR_FACES = ["in", "out"], DOOR_PANELS = [2, 4];
const ENTITY = /^(?!.+__)(?!_)[\da-z_]+(?<!_)\.(?!_)[\da-z_]+(?<!_)$/;
/** The door type keys of entry v the server would keep. */
export function doorTypeKeys(v){
  const o = {};
  if (!v || typeof v !== "object") return o;
  if (DOOR_TYPES.includes(v.type)) o.type = v.type;
  if (DOOR_SLIDES.includes(v.slide)) o.slide = v.slide;
  if (DOOR_FACES.includes(v.face)) o.face = v.face;
  if (Number.isInteger(v.panels) && v.panels >= DOOR_PANELS[0] && v.panels <= DOOR_PANELS[1]) o.panels = v.panels;
  if (typeof v.glass === "boolean") o.glass = v.glass;
  if (typeof v.link === "string" && v.link.length <= 255 && ENTITY.test(v.link)) o.link = v.link;
  return o;
}
const ID_OF = { door: "door", window: "win", doorway: "doorway" };
export const FILE_SCHEMA = 1;              // the 3D file this version writes (house3d_store.py SCHEMA)
export const SECTIONS = ["openings", "lights", "devices", "pieces", "figures"];
// A light's kind in the file (house3d_store.py _KIND): a short word. One this
// version does not draw is kept all the same (the view draws its guess).
export const LIGHT_KIND = /^[a-z0-9_]{1,40}$/;
const UNDO_MAX = 100;
const RUN_COS = Math.cos(3 * Math.PI / 180);    // pieces this parallel,
const RUN_OFF = 0.12;                            // this close to one line,
const RUN_GAP = 0.12;                            // and end to end, are one wall
const MEET_COS = Math.cos(20 * Math.PI / 180);   // a wall at least this far off the line meets it
const SPLICE_COS = Math.cos(8 * Math.PI / 180), SPLICE_TOL = 0.4;   // as a barrier is spliced in (applyBarriers)
const EPS = 1e-6;

const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
export const mm = (v) => Math.round(v * 1000) / 1000;
const copy = (x) => JSON.parse(JSON.stringify(x));
const canon = (o) => JSON.stringify(Object.keys(o).sort().map(k => [k, o[k]]));
export const minWidth = (kind) => (kind === "window" ? WINDOW_MIN_M : DOOR_MIN_M);   // a doorway: a door's
/** A length as the editor shows it. */
export const metres = (v) => `${(Math.round(v * 100) / 100).toFixed(2)} m`;

/** A fresh id for a door, window or doorway drawn in 3D. */
export function newOpeningId(kind, rand){
  const r = typeof rand === "function" ? rand
    : (globalThis.crypto && globalThis.crypto.getRandomValues
      ? () => globalThis.crypto.getRandomValues(new Uint8Array(1))[0] / 256 : Math.random);
  let hex = "";
  for (let i = 0; i < 8; i++) hex += Math.floor(r() * 16).toString(16);
  return `${ID_OF[kind] || "win"}_${hex}`;
}

// ── The file, as the editor owns it ──────────────────────────────────────────
/** A door, window or doorway drawn in 3D, with exactly the fields the file
 *  keeps for its kind (the kind is its id's), or null when the record is not one. */
export function addedOf(id, v){
  if (!OPENING_ID.test(String(id)) || !v || typeof v !== "object") return null;
  const pt = (p) => (Array.isArray(p) && p.length === 2 && num(p[0]) !== null && num(p[1]) !== null ? [p[0], p[1]] : null);
  const a = pt(v.a_m), b = pt(v.b_m);
  const fl = typeof v.floor_id === "string" && v.floor_id.trim() ? v.floor_id : null;
  if (!a || !b || !fl) return null;
  if (String(id).startsWith("win_")) {
    return { kind: "window", floor_id: fl, a_m: a, b_m: b,
             sill_m: num(v.sill_m) ?? WINDOW_SILL_M, head_m: num(v.head_m) ?? WINDOW_HEAD_M };
  }
  if (String(id).startsWith("doorway_")) return { kind: "doorway", floor_id: fl, a_m: a, b_m: b, head_m: num(v.head_m) ?? DOOR_HEAD_M };
  return { kind: "door", floor_id: fl, a_m: a, b_m: b, head_m: num(v.head_m) ?? DOOR_HEAD_M,
           hinge: v.hinge === "right" ? "right" : "left", swing: v.swing === "out" ? "out" : "in",
           ...(DOOR_SHOWN.includes(v.shown) ? { shown: v.shown } : null), ...doorTypeKeys(v) };
}
/** May this version write the file (house3d_store.py writable)? Only a
 *  schema that is a whole number up to FILE_SCHEMA, or none: a newer
 *  PadSpan's file is drawn as far as this version reads it, never written.
 *  `said`: the server's own answer (house3d_get's "writable"), which decides
 *  when given: JSON reads a schema of 1.0, which the server never writes, as
 *  the number 1. */
export function writable(data, said){
  if (typeof said === "boolean") return said;
  const s = data && typeof data === "object" && "schema" in data ? data.schema : FILE_SCHEMA;
  return Number.isInteger(s) && s >= 0 && s <= FILE_SCHEMA;
}
/** The file's data (house3d_get's "data"), cut down to what the editor owns:
 *  {openings, lights, devices, pieces, figures}. Reading is tolerant:
 *  anything it cannot read is left out of the view, and stays in the file. */
export function ownedOf(data){
  const d = data && typeof data === "object" ? data : {};
  const out = { openings: {}, lights: {}, devices: {}, pieces: {}, figures: {} };
  const obj = (v) => !!v && typeof v === "object" && !Array.isArray(v);
  const ops = d.openings && typeof d.openings === "object" ? d.openings : {};
  for (const k of Object.keys(ops)) {
    const v = ops[k];
    if (!v || typeof v !== "object") continue;
    if (OPENING_ID.test(k)) { const o = addedOf(k, v); if (o) out.openings[k] = o; continue; }
    const o = {};
    if (v.hinge === "left" || v.hinge === "right") o.hinge = v.hinge;
    if (v.swing === "in" || v.swing === "out") o.swing = v.swing;
    if (DOOR_SHOWN.includes(v.shown)) o.shown = v.shown;
    Object.assign(o, doorTypeKeys(v));
    for (const f of ["sill_m", "head_m"]) if (num(v[f]) !== null) o[f] = v[f];
    if (Object.keys(o).length) out.openings[k] = o;
  }
  for (const s of ["lights", "devices"]) {
    const m = d[s] && typeof d[s] === "object" ? d[s] : {};
    for (const k of Object.keys(m)) { const z = num(m[k] && m[k].z_m); if (z !== null) out[s][k] = { z_m: z }; }
  }
  // What a light is, set in Live Aboard; a light can have a kind and no height.
  const ls = obj(d.lights) ? d.lights : {};
  for (const k of Object.keys(ls)) {
    const kind = obj(ls[k]) ? ls[k].kind : null;
    if (typeof kind === "string" && LIGHT_KIND.test(kind)) out.lights[k] = { ...(out.lights[k] || {}), kind };
    // Its run, whole (a run this version cannot read is sent back as it is:
    // the server refuses it plainly rather than lose it).
    const run = obj(ls[k]) ? ls[k].run : null;
    if (obj(run)) out.lights[k] = { ...(out.lights[k] || {}), run: copy(run) };
  }
  // A beacon's or scanner's recipe (P6), whole, so a flow can change or remove
  // it; a key that also has a height keeps both.
  const dv = obj(d.devices) ? d.devices : {};
  for (const k of Object.keys(dv)) if (obj(dv[k]) && obj(dv[k].recipe)) out.devices[k] = { ...copy(dv[k]), ...(out.devices[k] || {}) };
  // Furniture: each piece whole, every key kept (the server keeps what this
  // version does not know); the id is live_aboard_pieces.js PIECE_ID.
  const ps = obj(d.pieces) ? d.pieces : {};
  for (const k of Object.keys(ps)) {
    const v = ps[k];
    if (/^fur_[0-9a-f]{8}$/.test(k) && obj(v) && obj(v.recipe) && typeof v.floor_id === "string") out.pieces[k] = copy(v);
  }
  const fg = obj(d.figures) ? d.figures : {};
  for (const k of Object.keys(fg)) if (obj(fg[k])) out.figures[k] = copy(fg[k]);
  return out;
}
/** What Save sends: per section, each key whose owned fields changed (the
 *  entry) or went (null). Only sections with something in them; null when
 *  nothing changed. */
export function changesOf(base, cur){
  const out = {};
  for (const s of SECTIONS) {
    const a = (base && base[s]) || {}, b = (cur && cur[s]) || {}, sec = {};
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
      if (b[k] === undefined) { if (a[k] !== undefined) sec[k] = null; }
      else if (a[k] === undefined || canon(a[k]) !== canon(b[k])) sec[k] = copy(b[k]);
    }
    if (Object.keys(sec).length) out[s] = sec;
  }
  return Object.keys(out).length ? out : null;
}

// ── The draft, with Undo and Redo ───────────────────────────────────────────
/** A draft of `base` (ownedOf). change(fn, group) is one undoable step (fn
 *  edits the draft in place); a run of changes with the same group — one
 *  slider's drag — is one step. Discard is a step too, so Undo brings the
 *  work back. */
export function createDraft(base){
  const d = { base: copy(base || ownedOf(null)), cur: null, undo: [], redo: [], group: null };
  d.cur = copy(d.base);
  return {
    get cur(){ return d.cur; },
    get base(){ return d.base; },
    change(fn, group = null){
      const before = JSON.stringify(d.cur);
      fn(d.cur);
      if (JSON.stringify(d.cur) === before) return false;
      if (!(group && group === d.group)) {
        d.undo.push(before);
        if (d.undo.length > UNDO_MAX) d.undo.shift();
      }
      d.group = group;
      d.redo = [];
      return true;
    },
    undo(){
      if (!d.undo.length) return false;
      d.redo.push(JSON.stringify(d.cur));
      d.cur = JSON.parse(d.undo.pop());
      d.group = null;
      return true;
    },
    redo(){
      if (!d.redo.length) return false;
      d.undo.push(JSON.stringify(d.cur));
      d.cur = JSON.parse(d.redo.pop());
      d.group = null;
      return true;
    },
    get canUndo(){ return d.undo.length > 0; },
    get canRedo(){ return d.redo.length > 0; },
    discard(){ return this.change((c) => { for (const s of SECTIONS) c[s] = copy(d.base[s]); }); },
    changes(){ return changesOf(d.base, d.cur); },
    get dirty(){ return changesOf(d.base, d.cur) !== null; },
    /** Saved: what was saved is the new base, and the history starts again. */
    rebase(b){ d.base = copy(b); d.cur = copy(b); d.undo = []; d.redo = []; d.group = null; },
    /** Part of it saved: the starting copy becomes `b`; the draft, Undo and
     *  Redo stay, so what is still unsaved is still there to save. */
    setBase(b){ d.base = copy(b); },
    /** Entries gone from the file (removed elsewhere): out of the base, the
     *  draft and every Undo and Redo step, so no step brings one back. */
    forget(section, ids){
      if (!ids.length) return;
      const out = (c) => { for (const id of ids) if (c && c[section]) delete c[section][id]; return c; };
      out(d.base); out(d.cur);
      d.undo = d.undo.map(x => JSON.stringify(out(JSON.parse(x))));
      d.redo = d.redo.map(x => JSON.stringify(out(JSON.parse(x))));
    },
  };
}

// ── Walls as runs, corners and openings ─────────────────────────────────────
/** A point on a run at t (metres along it). */
export const pointOf = (run, t) => [run.ux * t + run.nx * run.c, run.uy * t + run.ny * run.c];
const along = (run, x, y) => x * run.ux + y * run.uy;
/** The runs of one floor's wall pieces (the 3D view's, as drawn): every
 *  piece but deck rails. {ux, uy, nx, ny, c, t0, t1, thick, pcs}: the line
 *  n·p = c, from t0 to t1 along u. Two pieces this parallel (either way
 *  along), this close to one line and end to end are one wall, on the
 *  longer one's line. One pass: the pieces sorted by direction, then along
 *  it, each joined to a run still open beside it. */
export function wallRuns(pieces){
  const items = [], own = new Map();         // each piece as a run of its own
  for (const pc of pieces || []) {
    if (!pc || pc.kind === "rail") continue;
    const dx = pc.x1 - pc.x0, dy = pc.y1 - pc.y0, L = Math.hypot(dx, dy);
    if (!(L >= 0.03)) continue;
    let ux = dx / L, uy = dy / L;
    if (ux < -EPS || (Math.abs(ux) <= EPS && uy < 0)) { ux = -ux; uy = -uy; }
    const nx = -uy, ny = ux, ta = pc.x0 * ux + pc.y0 * uy, tb = pc.x1 * ux + pc.y1 * uy;
    const deg = (Math.atan2(uy, ux) * 180 / Math.PI + 180) % 180;          // its direction, either way along: 0 to 180
    const run = { ux, uy, nx, ny, c: ((pc.x0 + pc.x1) * nx + (pc.y0 + pc.y1) * ny) / 2,
                  t0: Math.min(ta, tb), t1: Math.max(ta, tb), thick: num(pc.thick) || 0.12, pcs: [pc] };
    own.set(pc, run);
    items.push({ deg, run });
  }
  if (!items.length) return [];
  // Directions a few degrees apart go together (round past 180 too).
  items.sort((a, b) => a.deg - b.deg);
  const STEP = Math.acos(RUN_COS) * 180 / Math.PI + 1e-9, groups = [[items[0]]];
  for (let i = 1; i < items.length; i++) {
    if (items[i].deg - items[i - 1].deg <= STEP) groups[groups.length - 1].push(items[i]);
    else groups.push([items[i]]);
  }
  if (groups.length > 1 && items[0].deg + 180 - items[items.length - 1].deg <= STEP) groups[0].push(...groups.pop());
  const runs = [];
  for (const g of groups) {
    // Along one direction for the group, start to end; a run is open until
    // the pieces still to come start past its end.
    const rx = g[0].run.ux, ry = g[0].run.uy, sOf = (pc) => [pc.x0 * rx + pc.y0 * ry, pc.x1 * rx + pc.y1 * ry];
    for (const it of g) { const [a, b] = sOf(it.run.pcs[0]); it.s0 = Math.min(a, b); it.s1 = Math.max(a, b); }
    g.sort((a, b) => a.s0 - b.s0);
    let open = [];
    for (const it of g) {
      open = open.filter(R => R.s1 + RUN_GAP + 0.5 >= it.s0);
      const B = it.run, R = open.find(A => joins(A, B) || joins(B, A));
      if (!R) { const A = { ...B, pcs: [...B.pcs], s1: it.s1 }; open.push(A); runs.push(A); continue; }
      // One wall, on the longer one's line.
      const thick = Math.max(R.thick, B.thick), s1 = Math.max(R.s1, it.s1);
      if (B.t1 - B.t0 > R.t1 - R.t0) {
        const pcs = R.pcs;
        Object.assign(R, B, { pcs: [...B.pcs] });
        for (const pc of pcs) grow(R, own.get(pc));
      } else grow(R, B);
      R.thick = thick; R.s1 = s1;
    }
  }
  for (const R of runs) delete R.s1;
  return runs;
}
// Is B one wall with A: as parallel, its middle near A's line, end to end.
function joins(A, B){
  if (Math.abs(A.ux * B.ux + A.uy * B.uy) < RUN_COS) return false;
  const m = pointOf(B, (B.t0 + B.t1) / 2);
  if (Math.abs(m[0] * A.nx + m[1] * A.ny - A.c) > RUN_OFF) return false;
  const b0 = along(A, ...pointOf(B, B.t0)), b1 = along(A, ...pointOf(B, B.t1));
  return !(Math.min(b0, b1) > A.t1 + RUN_GAP || Math.max(b0, b1) < A.t0 - RUN_GAP);
}
// A piece (as a run of its own, O) joins run R: R's stretch covers its ends.
function grow(R, O){
  const a = along(R, ...pointOf(O, O.t0)), b = along(R, ...pointOf(O, O.t1));
  R.t0 = Math.min(R.t0, a, b); R.t1 = Math.max(R.t1, a, b);
  for (const pc of O.pcs) if (!R.pcs.includes(pc)) R.pcs.push(pc);
}
/** Where a line on the run must stop: its two ends, and every wall that
 *  meets or crosses it (a T or a cross; `pieces` are the floor's). */
export function runStops(run, pieces){
  const stops = [run.t0, run.t1];
  for (const pc of pieces || []) {
    if (!pc || pc.kind === "rail" || run.pcs.includes(pc)) continue;
    const dx = pc.x1 - pc.x0, dy = pc.y1 - pc.y0, L = Math.hypot(dx, dy);
    if (!(L >= 0.03)) continue;
    const vx = dx / L, vy = dy / L;
    if (Math.abs(vx * run.ux + vy * run.uy) > MEET_COS) continue;
    const s = (run.c - (pc.x0 * run.nx + pc.y0 * run.ny)) / (vx * run.nx + vy * run.ny);
    const tol = run.thick / 2 + (num(pc.thick) || 0.12) / 2 + 0.08;
    if (s < -tol || s > L + tol) continue;
    const t = along(run, pc.x0 + vx * s, pc.y0 + vy * s);
    if (t > run.t0 + 0.05 && t < run.t1 - 0.05) stops.push(t);
  }
  return [...new Set(stops.map(mm))].sort((a, b) => a - b);
}
/** The doors, windows, doorways and gaps already on the run, sensor ones
 *  included: [{lo, hi, id, kind}] in metres along it. id: a 3D one's id,
 *  else its barrier's id. */
export function runOpenings(run){
  const out = [];
  for (const pc of run.pcs) {
    if (pc.kind !== "door" && pc.kind !== "window" && pc.kind !== "open" && pc.kind !== "doorway") continue;
    const a = along(run, pc.x0, pc.y0), b = along(run, pc.x1, pc.y1);
    out.push({ lo: Math.min(a, b), hi: Math.max(a, b), id: pc.added || (pc.barrier && pc.barrier.id) || null, kind: pc.kind });
  }
  return out.sort((p, q) => p.lo - q.lo);
}
/** t on the run nearest the plan point, kept between its ends. */
export const tOn = (run, x, y) => clamp(along(run, x, y), run.t0, run.t1);
/** How far the plan point is from the run (metres). */
export function runDist(run, x, y){
  const t = tOn(run, x, y), p = pointOf(run, t);
  return Math.hypot(x - p[0], y - p[1]);
}
/** Is t inside a door or window already there (not counting `skip`)? */
export const insideOpening = (openings, t, skip = null) =>
  (openings || []).some(o => o.id !== skip && t > o.lo + EPS && t < o.hi - EPS);
/** The line from `from` toward `to` on the run, stopped at the first corner
 *  or opening in its way. {t0, t1, len, stop: null | "corner" | "opening"}. */
export function spanOf(run, stops, openings, from, to, skip = null){
  const f = clamp(from, run.t0, run.t1);
  const dir = to >= f ? 1 : -1;
  let end = to, stop = null;
  const ahead = (stops || []).filter(s => (dir > 0 ? s > f + EPS : s < f - EPS));
  const corner = ahead.length ? (dir > 0 ? Math.min(...ahead) : Math.max(...ahead)) : (dir > 0 ? run.t1 : run.t0);
  // At the corner or past it (a pointer past a wall's end is held at it).
  if (dir > 0 ? end >= corner - EPS : end <= corner + EPS) { end = corner; stop = "corner"; }
  for (const o of openings || []) {
    if (o.id === skip && skip !== null) continue;
    if (dir > 0 && o.hi > f + EPS && o.lo < end - EPS) { end = Math.max(f, o.lo); stop = "opening"; }
    if (dir < 0 && o.lo < f - EPS && o.hi > end + EPS) { end = Math.min(f, o.hi); stop = "opening"; }
  }
  return { t0: Math.min(f, end), t1: Math.max(f, end), len: Math.abs(end - f), stop };
}

// ── How high, under a ceiling ───────────────────────────────────────────────
// The one place for it: the 3D view draws within these (live_aboard_house.js
// wallElements and deviceZ) and the editor's sliders offer exactly these, so
// what a slider says is what is drawn.
export const LINTEL_M = 0.1;               // a door's or window's head stays this far under the ceiling
export const DEVICE_GAP_M = 0.08;          // a sensor or a readout, this far under it
/** Heights above the floor under a ceiling `ceil` metres up: head, the
 *  highest a door's or window's head goes; sill, a window's highest sill
 *  (its least height under that); doorLow to doorHigh, a door's head
 *  (never under the server's least, however low the ceiling); device, a
 *  sensor's or a readout's highest; light, a light's (the ceiling). */
export function heightLimits(ceil){
  const c = num(ceil) ?? 2.65;
  const head = Math.max(GAP_MIN_M, c - LINTEL_M);
  const doorLow = Math.max(DOOR_MIN_HEAD_M, Math.min(DOOR_LOW_M, head));
  return { head, sill: head - GAP_MIN_M, doorLow, doorHigh: Math.max(doorLow, head),
           device: Math.max(0.1, c - DEVICE_GAP_M), light: Math.max(0.1, c) };
}

// ── New, switched, and their heights ────────────────────────────────────────
/** A door or window's two ends as the file keeps them, to the millimetre.
 *  The server checks the width between the rounded ends, and rounding each
 *  end can take up to 1.4 mm off it on a sloped wall: so when that would
 *  take one drawn `least` wide or wider under `least`, `b` is first pushed
 *  1.6 mm on along the line (more than rounding can take). */
export function endsMm(a, b, least){
  const p = (q) => [mm(q[0]), mm(q[1])];
  const ra = p(a), L = Math.hypot(b[0] - a[0], b[1] - a[1]);
  let rb = p(b);
  if (L >= least - EPS && Math.hypot(rb[0] - ra[0], rb[1] - ra[1]) < least - EPS) {
    const k = 0.0016 / L;
    rb = p([b[0] + (b[0] - a[0]) * k, b[1] + (b[1] - a[1]) * k]);
  }
  return [ra, rb];
}
/** A new door or window between plan points a and b on floor `floorId`,
 *  under a ceiling `ceil` metres up: the defaults (a window's sill 0.9 m and
 *  head 2.1 m, a door to 2.03 m, hinged left, swinging in), kept within
 *  heightLimits; its ends to the millimetre (endsMm). */
export function newOpening(kind, floorId, a, b, ceil){
  const [pa, pb] = endsMm(a, b, minWidth(kind));
  if (kind === "doorway") return { kind, floor_id: floorId, a_m: pa, b_m: pb, ...openingHeights({ kind, head_m: DOOR_HEAD_M }, ceil) };
  if (kind === "door") {
    return { kind: "door", floor_id: floorId, a_m: pa, b_m: pb, ...openingHeights({ kind, head_m: DOOR_HEAD_M }, ceil),
             hinge: "left", swing: "in" };
  }
  return { kind: "window", floor_id: floorId, a_m: pa, b_m: pb, ...openingHeights({ kind, sill_m: WINDOW_SILL_M, head_m: WINDOW_HEAD_M }, ceil) };
}
/** Door ↔ window (or `to`: a door, a window or a doorway): the same stretch
 *  of wall under a new id of that kind (the id says the kind), with that
 *  kind's defaults; {error} when it is too narrow to be one. */
export function switchKind(id, rec, ceil, to = rec.kind === "door" ? "window" : "door"){
  const w = Math.hypot(rec.b_m[0] - rec.a_m[0], rec.b_m[1] - rec.a_m[1]);
  if (w < minWidth(to) - EPS) return { error: `A ${to} is at least ${minWidth(to).toFixed(1)} m wide` };
  return { id: `${ID_OF[to] || "win"}_${String(id).split("_").pop()}`, rec: newOpening(to, rec.floor_id, rec.a_m, rec.b_m, ceil) };
}
/** A window's sill and head, or a door's head, kept in order within
 *  heightLimits: what a slider may set. */
export function openingHeights(rec, ceil){
  const lim = heightLimits(ceil);
  if (rec.kind === "door" || rec.kind === "doorway") return { head_m: mm(clamp(num(rec.head_m) ?? DOOR_HEAD_M, lim.doorLow, lim.doorHigh)) };
  const sill = mm(clamp(num(rec.sill_m) ?? WINDOW_SILL_M, 0, lim.sill));
  const head = mm(clamp(num(rec.head_m) ?? WINDOW_HEAD_M, sill + GAP_MIN_M, lim.head));
  return { sill_m: sill, head_m: head };
}
/** A device's height range, from its floor: up to the ceiling for a light,
 *  just under it for anything else (section "devices": heightLimits). */
export const heightRange = (ceil, section = "lights") => {
  const lim = heightLimits(ceil);
  return { min: 0, max: mm(section === "devices" ? lim.device : lim.light) };
};
export function clampHeight(z, ceil, section = "lights"){
  const r = heightRange(ceil, section);
  return mm(clamp(num(z) ?? 0, r.min, r.max));
}
/** A fixture's height: its bulbs' mean height above its floor (where the
 *  3D view hangs its lamp from), or null for one with no bulbs. */
export function fixtureZ(parts){
  const b = (parts && parts.bulbs) || [];
  return b.length ? b.reduce((a, q) => a + q.h, 0) / b.length : null;
}
/** A fixture's parts moved up or down, whole, to the height stored for it
 *  (lights[<entity id>].z_m), kept under the ceiling: its bulbs, housings,
 *  glows, the light on its wall and where a press finds it (not the light
 *  where it lands: a `fixed` wash, a pool). {parts, z, zDefault}. */
export function liftParts(parts, stored, ceil){
  const z0 = fixtureZ(parts), want = num(stored && stored.z_m);
  if (z0 === null || want === null) return { parts, z: z0, zDefault: z0 };
  const z = clampHeight(want, ceil), d = z - z0;
  for (const list of [parts.bulbs, parts.housings, parts.halos, parts.washes, parts.picks]) for (const q of list || []) if (!q.fixed) q.h += d;
  return { parts, z, zDefault: z0 };
}

// ── Into the walls the 3D view draws ────────────────────────────────────────
/** Wall piece W split round [t0, t1] (metres along it) into what is before,
 *  `mid` (a door, window, gap or tint), and what is after. An end made by
 *  the split is no corner (corner0 / corner1 false): the 3D view lengthens
 *  only a wall's own ends to close its corners (drawnSpan), so the opening
 *  keeps the width it was drawn. */
export function splitPiece(W, WL, wx, wy, t0, t1, mid){
  const at = (t) => [W.x0 + wx * t, W.y0 + wy * t];
  const before = t0 > 0.03, after = WL - t1 > 0.03, s = at(t0), e = at(t1);
  const parts = [];
  if (before) parts.push({ ...W, x1: s[0], y1: s[1], corner1: false });
  parts.push({ ...W, x0: s[0], y0: s[1], x1: e[0], y1: e[1], ...mid,
               corner0: before ? false : W.corner0, corner1: after ? false : W.corner1 });
  if (after) parts.push({ ...W, x0: e[0], y0: e[1], corner0: false });
  return parts;
}
/** One door or window drawn in 3D, cut into the floor's wall pieces: each
 *  wall piece it lies along is split round it, as a barrier is spliced in
 *  (any wall, the map's own walls included); along none, it stands on its
 *  own. Pieces that are already doors, windows or gaps are never split. */
export function spliceOpening(pieces, id, o){
  const a = o.a_m, b = o.b_m, L = Math.hypot(b[0] - a[0], b[1] - a[1]);
  if (L < 0.03) return pieces;
  const ux = (b[0] - a[0]) / L, uy = (b[1] - a[1]) / L;
  const mine = { kind: o.kind, mat: null, barrier: null, added: id, sill_m: o.sill_m, head_m: o.head_m,
                 override: o.kind === "door" ? { hinge: o.hinge, swing: o.swing, ...(o.shown ? { shown: o.shown } : null), ...doorTypeKeys(o) } : null };
  let hit = false;
  for (let k = 0; k < pieces.length; k++) {
    const W = pieces[k];
    if (W.kind !== "wall") continue;
    const WL = Math.hypot(W.x1 - W.x0, W.y1 - W.y0);
    if (WL < 0.03) continue;
    const wx = (W.x1 - W.x0) / WL, wy = (W.y1 - W.y0) / WL;
    if (Math.abs(ux * wx + uy * wy) < SPLICE_COS) continue;
    const off = (p) => Math.abs((p[0] - W.x0) * -wy + (p[1] - W.y0) * wx), lim = W.thick / 2 + SPLICE_TOL;
    if (off(a) > lim || off(b) > lim) continue;
    const ta = (a[0] - W.x0) * wx + (a[1] - W.y0) * wy, tb = (b[0] - W.x0) * wx + (b[1] - W.y0) * wy;
    const t0 = Math.max(0, Math.min(ta, tb)), t1 = Math.min(WL, Math.max(ta, tb));
    if (t1 - t0 < 0.05) continue;
    const parts = splitPiece(W, WL, wx, wy, t0, t1, mine);
    pieces.splice(k, 1, ...parts);
    k += parts.length - 1;
    hit = true;
  }
  if (!hit) pieces.push({ x0: a[0], y0: a[1], x1: b[0], y1: b[1], nx: uy, ny: -ux, cls: "int", thick: 0.12, shared: false,
                          free: true, ...mine });
  return pieces;
}
/** A map door or window as the 3D file has it (o: its openings[<barrier
 *  id>]): hinge and swing (pc.override), and a window's sill and head. */
export function overrideOpening(pc, o){
  pc.override = o;
  if (pc.kind === "window") {
    if (num(o.sill_m) !== null) pc.sill_m = o.sill_m;
    if (num(o.head_m) !== null) pc.head_m = o.head_m;
  }
  return pc;
}
/** The 3D file's openings into a house as the view reads it
 *  (live_aboard_house.js readHouse): a barrier's door or window takes its sill, head, hinge and
 *  swing (pc.override; sill_m and head_m on a window); each door or window
 *  drawn in 3D is cut into its floor's walls. A floor that no longer exists
 *  draws nothing (the file keeps it). */
export function applyOpenings(h, openings){
  const ops = openings || {};
  for (const per of h.perFloor.values()) {
    for (const pc of per.pieces) {
      const o = pc.barrier && pc.barrier.id ? ops[pc.barrier.id] : null;
      if (o && !OPENING_ID.test(String(pc.barrier.id)) && (pc.kind === "door" || pc.kind === "window")) overrideOpening(pc, o);
    }
  }
  for (const id of Object.keys(ops).sort()) {
    const o = addedOf(id, ops[id]);
    const fl = o ? h.byId.get(h.canon(o.floor_id)) : null;
    const per = fl ? h.perFloor.get(fl) : null;
    if (per) spliceOpening(per.pieces, id, o);
  }
  return h;
}
/** What the walls are drawn from, of the file: its openings. */
export const openingsSignature = (vd) => JSON.stringify(Object.keys((vd && vd.openings) || {}).sort().map(k => [k, vd.openings[k]]));
/** What the heights of one section are drawn from (and a light's kind). */
export const heightsSignature = (vd, section) => JSON.stringify(Object.keys((vd && vd[section]) || {}).sort()
  .map(k => [k, (vd[section][k] || {}).z_m, (vd[section][k] || {}).kind]));

// ── Heights on the placement record (Garry, 2026-10-05) ─────────────────────
// "Same dataset, just extra info": a placed device's height above its floor
// lives on its one placement record (model.light_positions_m[eid].z_m: a
// number, or null for the default for its kind, chosen; none when never set),
// set with fabric_light_height_set, not in the 3D file. The view reads the
// record first, then the 3D file (an older install's, or a device with no
// record), then its kind's default; the editor's draft holds the records'
// heights too, and Save sends each to where it lives: the heights the draft
// changed to their records in one fabric_light_height_set, the rest to
// house3d_edit (splitSave). The 3D file's own copy of a placed device's
// height is left as it is: an older PadSpan reads its heights only there.
const hasOwn = (o, k) => !!o && typeof o === "object" && Object.prototype.hasOwnProperty.call(o, k);
/** {entity id: z_m, or null for Default chosen} for each placement record
 *  that has its height decided. */
export function recordHeights(model){
  const pos = model && model.light_positions_m && typeof model.light_positions_m === "object" ? model.light_positions_m : {};
  const out = {};
  for (const k of Object.keys(pos)) {
    if (!hasOwn(pos[k], "z_m")) continue;
    const z = pos[k].z_m;
    if (z === null) out[k] = null;
    else if (num(z) !== null) out[k] = z;
  }
  return out;
}
/** The 3D file (ownedOf) as the view draws it: each record's height in the
 *  entry of the section the view reads that device from (sectionOf(eid):
 *  "lights" for a fixture, "devices" for anything else), over the file's
 *  own; Default chosen on a record takes the file's height away. Nothing in
 *  `records`: the file itself, untouched. */
export function withRecordHeights(file, records, sectionOf){
  const ids = Object.keys(records || {});
  if (!ids.length) return file;
  const out = { ...file, lights: { ...(file.lights || {}) }, devices: { ...(file.devices || {}) } };
  for (const k of ids) {
    const s = sectionOf(k) === "lights" ? "lights" : "devices";
    const e = { ...(out[s][k] || {}) };
    if (records[k] === null) delete e.z_m; else e.z_m = records[k];
    if (Object.keys(e).length) out[s][k] = e; else delete out[s][k];
  }
  return out;
}
const withoutZ = (e) => { const o = { ...(e || {}) }; delete o.z_m; return o; };
/** Save, split by where each thing lives: {heights, file}. heights: {entity
 *  id: z_m, or null for the default} for each device with a placement record
 *  (`placed`) whose height the draft changed from where it started (`base`,
 *  the draft's starting copy): a height never touched is never sent, so a
 *  newer one set elsewhere meanwhile stays. file: the draft's changes (`ch`,
 *  changesOf) for house3d_edit, with a height the draft did not change left
 *  as the 3D file has it (`file`, as the view reads it): a light's entry
 *  keeps the file's own copy, a device's height entry is not sent. So a
 *  height the view only lays over a device with no record (Mapping's unsaved
 *  Height-row value for one dropped there and not yet saved) is drawn, never
 *  written. A device with no record whose height the draft did change: that
 *  height goes to the file, and file.heights_set names it (the newest height
 *  it has: ws_house3d, maps.js). Either is null with nothing in it. */
export function splitSave(file, ch, base, placed){
  const has = (id) => (placed instanceof Set ? placed.has(id) : !!(placed && placed[id]));
  const heights = {}, out = {}, mine = [];
  for (const s of SECTIONS) {
    const sec = ch && ch[s];
    if (!sec) continue;
    const keep = {};
    for (const k of Object.keys(sec)) {
      if (s !== "lights" && s !== "devices") { keep[k] = sec[k]; continue; }
      const e = sec[k], z = num(e && e.z_m), z0 = num(base && base[s] && base[s][k] && base[s][k].z_m);
      if (!has(k) && z !== z0) { keep[k] = sec[k]; mine.push(k); continue; }
      if (z !== z0) heights[k] = z;
      const was = (file && file[s] && file[s][k]) || null, fz = num(was && was.z_m);
      const want = { ...withoutZ(e), ...(fz !== null ? { z_m: fz } : null) };
      if (s === "devices") {
        // Anything a device's entry holds besides its height (a look) goes;
        // its height in the file stays as it is (the server keeps a key it
        // is not sent).
        const rest = withoutZ(e);
        if (Object.keys(rest).length && canon(withoutZ(was)) !== canon(rest)) keep[k] = rest;
        continue;
      }
      // A light's entry is the editor's whole: what it is, its run, and the file's own height.
      if (canon(was || {}) !== canon(want)) keep[k] = Object.keys(want).length ? want : null;
    }
    if (Object.keys(keep).length) out[s] = keep;
  }
  if (mine.length) out.heights_set = mine.sort();
  return { heights: Object.keys(heights).length ? heights : null, file: Object.keys(out).length ? out : null };
}
/** The draft's starting copy once `heights` ({entity id: z_m or null}, from
 *  `ch`) are saved and the rest of `ch` is not: those heights as the records
 *  now have them, everything else as it was. */
export function baseWithHeights(base, ch, heights){
  const out = copy(base || {});
  for (const s of ["lights", "devices"]) {
    for (const k of Object.keys((ch && ch[s]) || {})) {
      if (!hasOwn(heights, k)) continue;
      out[s] = out[s] || {};
      const e = { ...(out[s][k] || {}) };
      if (heights[k] === null) delete e.z_m; else e.z_m = heights[k];
      if (Object.keys(e).length) out[s][k] = e; else delete out[s][k];
    }
  }
  return out;
}
