// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0

// ── Wall/polyline geometry — pure, metric, no photo machinery ───────────────
// Deliberately its OWN file, not stack_transform.js: that file is map
// placement, image aspect ratio and the measured-photo anchor, and the
// lights render path (iso_lights.js) is architecturally barred from ever
// reaching for it (tests/test_lights_renderer.py's
// test_no_lights_file_touches_the_photo_machinery) — "lights read the
// metric fabric and nothing else". These functions are pure polyline/circle
// math with no photo or map-placement concept in them at all, so they live
// here instead, importable by both the lights path and maps.js's Rooms-tab
// and Lights-tab wall editors (stack_transform.js re-exports them for the
// latter, so nothing there had to change).
//
// A door is authored by carving a short section out of an existing wall's
// own polyline, at EDIT time (docs/IDEA_DOOR_WINDOW_BARRIERS.md, step 3) —
// not by inventing a new "door" object, and not by computing a gap live on
// every render. These functions do that carving; nothing here touches HA,
// the fabric store, or the DOM.

// The closest point ON a polyline to an arbitrary (px,py) — used to snap a
// click to the wall being marked, so a door's endpoints always lie exactly on
// the line rather than near it. Returns {segIdx, t, x, y, distSq}: segIdx is
// which segment the point falls on, t is 0..1 along that segment, (x,y) is
// the snapped point itself, and distSq is how far the raw click was from it
// (unused by the split itself, useful for a caller's own snap-tolerance
// check). Degenerate (zero-length) segments are skipped rather than
// producing a division by zero.
export function nearestPointOnPolyline(points, px, py) {
  let best = null;
  for (let i = 0; i < points.length - 1; i++) {
    const [x0, y0] = points[i], [x1, y1] = points[i + 1];
    const dx = x1 - x0, dy = y1 - y0;
    const len2 = dx * dx + dy * dy;
    if (len2 <= 0) continue;
    let t = ((px - x0) * dx + (py - y0) * dy) / len2;
    t = Math.max(0, Math.min(1, t));
    const x = x0 + t * dx, y = y0 + t * dy;
    const distSq = (px - x) * (px - x) + (py - y) * (py - y);
    if (!best || distSq < best.distSq) best = { segIdx: i, t, x, y, distSq };
  }
  return best;
}

// A polyline position's own arc-length ordering key — segIdx dominates, t
// breaks the tie within one segment. Lets the split accept its two positions
// in whichever order they were clicked.
function _polylinePosKey(pos) { return pos.segIdx + pos.t; }

// Splits a polyline into up to three pieces at two positions already snapped
// onto it (from nearestPointOnPolyline). Handles a wall of ANY point count,
// not just a straight 2-point segment — a multi-point wall keeps every
// original vertex that falls outside the carved section.
//
// Returns {before, middle, after}: `middle` is the door/window section;
// `before`/`after` are the wall's own remaining pieces, or null when the
// section reaches all the way to that end (nothing left to keep there) OR
// collapses to a single point (the door spans the WHOLE original wall) — in
// either case there is no degenerate one-point "wall" left behind. `middle`
// is null too when posA and posB snap to the same point — a zero-width
// door is the caller's job to prevent before ever reaching this function,
// not something to paper over here with a fake 2-point line.
export function splitPolylineAtTwoPositions(points, posA, posB) {
  let a = posA, b = posB;
  if (_polylinePosKey(a) > _polylinePosKey(b)) { const t = a; a = b; b = t; }

  const dedupe = (pts) => pts.filter((p, i) =>
    i === 0 || Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1]) > 1e-9);

  const beforeRaw = [];
  for (let i = 0; i <= a.segIdx; i++) beforeRaw.push(points[i]);
  beforeRaw.push([a.x, a.y]);

  const middleRaw = [[a.x, a.y]];
  for (let i = a.segIdx + 1; i <= b.segIdx; i++) middleRaw.push(points[i]);
  middleRaw.push([b.x, b.y]);

  const afterRaw = [[b.x, b.y]];
  for (let i = b.segIdx + 1; i < points.length; i++) afterRaw.push(points[i]);

  const before = dedupe(beforeRaw), middle = dedupe(middleRaw), after = dedupe(afterRaw);
  return {
    before: before.length >= 2 ? before : null,
    middle: middle.length >= 2 ? middle : null,
    after: after.length >= 2 ? after : null,
  };
}

// Where a polyline crosses a circle's own boundary — the door/window opening
// tool (Garry, 2026-09-09, after the wall-click picker turned out "impossible
// to use"): place a circle over the opening, size and drag it to fit, and
// "the two places the line intersects with the room line[/wall]... will be
// the edges of the opening. The part in the circle will be the opening."
//
// Returns positions in the SAME {segIdx, t, x, y} shape nearestPointOnPolyline
// does, sorted by arc-length position along the polyline, so the two EXTREME
// entries are exactly the two args splitPolylineAtTwoPositions wants — a
// wall that crosses the circle's edge twice (the ordinary case), a wall that
// only reaches one edge before ending inside the circle (one boundary
// crossing plus that endpoint, itself inside), and a short wall swallowed
// entirely by the circle (both endpoints inside, zero crossings) all resolve
// the same way, with no special-casing at the call site.
export function circlePolylineIntersections(points, cx, cy, r) {
  const inside = (x, y) => (x - cx) * (x - cx) + (y - cy) * (y - cy) < r * r;
  const hits = [];
  for (let i = 0; i < points.length - 1; i++) {
    const [x0, y0] = points[i], [x1, y1] = points[i + 1];
    const dx = x1 - x0, dy = y1 - y0;
    const fx = x0 - cx, fy = y0 - cy;
    const a = dx * dx + dy * dy;
    if (a > 1e-12) {
      const b = 2 * (fx * dx + fy * dy);
      const c = fx * fx + fy * fy - r * r;
      const disc = b * b - 4 * a * c;
      if (disc >= 0) {
        const sq = Math.sqrt(disc);
        for (const t of [(-b - sq) / (2 * a), (-b + sq) / (2 * a)]) {
          if (t >= -1e-9 && t <= 1 + 1e-9) {
            const ct = Math.max(0, Math.min(1, t));
            hits.push({ segIdx: i, t: ct, x: x0 + ct * dx, y: y0 + ct * dy });
          }
        }
      }
    }
    // A vertex strictly inside the circle is a real edge of the opening even
    // though it is not a crossing of the circle's own boundary — the wall
    // simply ends (or has a corner) before it would have crossed out again.
    if (i === 0 && inside(x0, y0)) hits.push({ segIdx: 0, t: 0, x: x0, y: y0 });
    if (inside(x1, y1)) hits.push({ segIdx: i, t: 1, x: x1, y: y1 });
  }
  const key = (h) => h.segIdx + h.t;
  const dedup = [];
  for (const h of hits.sort((p, q) => key(p) - key(q))) {
    if (!dedup.length || key(h) - key(dedup[dedup.length - 1]) > 1e-6) dedup.push(h);
  }
  return dedup;
}

// Which wall a door/window opening circle actually matches — the ONE piece
// of "which barrier is this" logic, shared by the live preview (drawn every
// render while positioning) and the final commit, so they can never name a
// different wall than what the user was looking at when they clicked Done.
// barriers: [{ id, points_m, linked_entity_id, ... }] on the circle's own
// floor only (the caller filters by floor_id before calling this).
// Returns { bar, hits } for whichever unlinked barrier's own nearest point
// to the circle's centre is closest, among those the circle actually
// crosses (>= 2 positions from circlePolylineIntersections) — or null.
export function bestCircleWall(barriers, cx, cy, r) {
  let best = null;
  for (const bar of barriers || []) {
    if (bar.linked_entity_id) continue;
    const pts = (bar.points_m || []).map(p => [Number(p[0]), Number(p[1])]);
    if (pts.length < 2) continue;
    const hits = circlePolylineIntersections(pts, cx, cy, r);
    if (hits.length < 2) continue;
    const near = nearestPointOnPolyline(pts, cx, cy);
    if (!near) continue;
    if (!best || near.distSq < best.distSq) best = { bar, hits, distSq: near.distSq };
  }
  return best ? { bar: best.bar, hits: best.hits } : null;
}

// When no RF Barrier crosses the circle, a ROOM's own polygon edge might —
// Garry, 2026-09-10, after the room-outline-vs-barrier distinction was
// explained instead of fixed, rightly rejected: "I draw the circle, it is
// visually perfect over the wall I need the door in... fix that error, not
// I should see things the way you do in the background." The room boundary
// the user sees on screen already IS the wall; requiring it to also exist
// as a separately hand-traced rf_barriers_m entry was the actual defect.
// Returns the two room-polygon vertices bounding whichever edge the circle
// crosses, closest first, PLUS `hits` against that same 2-point segment (in
// the shape splitPolylineAtTwoPositions/bestCircleWall already use) — the
// exact geometry a new barrier is created from, with nothing invented.
// Shared by the live preview (iso_lights.js) and the commit (maps.js's
// _commitDoorCircle) for the same reason bestCircleWall itself is: they can
// never disagree about what will happen on Done. `roomGeometry` is
// model.room_geometry_m: {room: {type,floor_id,points_m}} — circle-shaped
// rooms have no discrete edges and are skipped.
export function roomEdgeForCircle(roomGeometry, floorId, cx, cy, r) {
  let best = null;
  for (const [room, g] of Object.entries(roomGeometry || {})) {
    if (!g || g.type !== "poly" || String(g.floor_id || "main") !== String(floorId)) continue;
    const pts = (g.points_m || []).map(p => [Number(p[0]), Number(p[1])]);
    if (pts.length < 3) continue;
    const first = pts[0], last = pts[pts.length - 1];
    const closed = (first[0] === last[0] && first[1] === last[1]) ? pts : [...pts, first];
    const hits = circlePolylineIntersections(closed, cx, cy, r);
    if (hits.length < 2) continue;
    const near = nearestPointOnPolyline(closed, cx, cy);
    if (!near) continue;
    if (!best || near.distSq < best.distSq) {
      const segIdx = Math.min(near.segIdx, closed.length - 2);
      const points = [closed[segIdx], closed[segIdx + 1]];
      // Re-run against just this one segment: the hits above carry segIdx
      // values relative to the WHOLE closed polygon, not this 2-point pair.
      const segHits = circlePolylineIntersections(points, cx, cy, r);
      if (segHits.length < 2) continue;
      best = { room, distSq: near.distSq, points, hits: segHits };
    }
  }
  return best;
}

// ── Open edges (an open-plan room, a loft) ───────────────────────────────────
// A room edge with no wall on it: the tool in Mapping → Edit → Signal walls
// marks the stretch it shares with the room next door (the whole edge, its own
// vertices from model.room_geometry_m, where it has no neighbour) with an Open
// (0 dB) barrier, so the 3D house's openAt finds it on the derived wall and
// nothing is re-traced by hand. All of it pure: metres in, metres out.
//
// The 3D house's own numbers (live_aboard_house.js), so the tool and the walls
// it opens agree on what an edge shares; tests/test_open_edges.py holds them.
const SHARE_M = 0.65;                            // SHARE_TOL: two facing room edges this close are one wall...
const SHARE_COS = Math.cos(6 * Math.PI / 180);   // SHARE_COS: ...and no more than this far apart
const ALONG_COS = Math.cos(8 * Math.PI / 180);   // BAR_COS: a barrier this parallel to a wall...
const WALL_M = 0.47;                             // EXT_T / 2 + BAR_TOL: ...and this close replaces that stretch
const STUB_M = 0.3;                              // STUB_M: shorter than this is a needle, not a stretch

// The room edge nearest (px, py) among the polygon rooms of one floor.
// Returns {room, points: [a, b], segIdx, x, y, distSq} or null; the caller
// decides how near is near enough. Circle rooms have no edges.
export function nearestRoomEdge(roomGeometry, floorId, px, py) {
  let best = null;
  for (const [room, g] of Object.entries(roomGeometry || {})) {
    if (!g || g.type !== "poly" || String(g.floor_id || "main") !== String(floorId)) continue;
    const closed = closedOutline(g.points_m);
    if (!closed) continue;
    const near = nearestPointOnPolyline(closed, px, py);
    if (!near) continue;
    if (!best || near.distSq < best.distSq) {
      const segIdx = Math.min(near.segIdx, closed.length - 2);
      best = { room, points: [closed[segIdx], closed[segIdx + 1]], segIdx, x: near.x, y: near.y, distSq: near.distSq };
    }
  }
  return best;
}

// A room outline closed back to its first vertex (each vertex [x, y] in
// metres), or null when it has fewer than three.
// The corners are the 3D house's (cleanPoly): no doubled point, and a last corner
// beside the first is the first, so a hand-drawn room has no edge of a centimetre.
export function closedOutline(points_m) {
  const pts = [];
  for (const p of points_m || []) {
    const q = [Number(p[0]), Number(p[1])];
    if (!Number.isFinite(q[0]) || !Number.isFinite(q[1])) continue;
    if (!pts.length || _gap(pts[pts.length - 1], q) > 0.02) pts.push(q);
  }
  while (pts.length > 3 && _gap(pts[0], pts[pts.length - 1]) < 0.2) pts.pop();
  if (pts.length < 3) return null;
  return [...pts, pts[0]];
}
const _gap = (u, v) => Math.hypot(u[0] - v[0], u[1] - v[1]);
const _mm = (v) => Math.round(v * 1000) / 1000;

// 1 where a closed outline runs counter-clockwise, else -1: an edge's outward
// normal is (dy, -dx) times this.
function _turn(closed) {
  let s = 0;
  for (let i = 0; i + 1 < closed.length; i++) s += closed[i][0] * closed[i + 1][1] - closed[i + 1][0] * closed[i][1];
  return s >= 0 ? 1 : -1;
}

// Edge a-b of a room cut where its neighbours start and stop: [{p, q, with}],
// p and q in metres along it, `with` the room next door or null (nothing shares
// that stretch). What shares is what the 3D house builds as one wall
// (deriveWalls): another room's edge facing it, within SHARE_M. A stretch under
// STUB_M joins the longer one beside it, and a neighbour's edges in a row count
// as one stretch.
function _stretches(a, b, turn, others) {
  const L = _gap(a, b);
  const ux = (b[0] - a[0]) / L, uy = (b[1] - a[1]) / L, nx = uy * turn, ny = -ux * turn;
  const ivs = [];
  for (const o of others) {
    for (let i = 0; i + 1 < o.closed.length; i++) {
      const c = o.closed[i], d = o.closed[i + 1], LB = _gap(c, d);
      if (LB < 0.03) continue;
      const bnx = (d[1] - c[1]) / LB * o.turn, bny = -(d[0] - c[0]) / LB * o.turn;
      if (nx * bnx + ny * bny > -SHARE_COS) continue;
      const rel = (P) => [(P[0] - a[0]) * ux + (P[1] - a[1]) * uy, (P[0] - a[0]) * nx + (P[1] - a[1]) * ny];
      const [tc, sc] = rel(c), [td, sd] = rel(d);
      const lo = Math.max(0, Math.min(tc, td)), hi = Math.min(L, Math.max(tc, td));
      if (hi - lo < 0.05) continue;
      const sAt = (t) => sc + (sd - sc) * (t - tc) / (td - tc), s0 = sAt(lo), s1 = sAt(hi);
      if (Math.abs(s0) > SHARE_M || Math.abs(s1) > SHARE_M) continue;
      ivs.push({ lo, hi, room: o.room, d: Math.abs(s0) + Math.abs(s1) });
    }
  }
  const cuts = [0, L, ...ivs.flatMap(v => [v.lo, v.hi])].sort((x, y) => x - y);
  let segs = [];
  const join = () => { segs = segs.reduce((out, g) => {
    const last = out[out.length - 1];
    if (last && last.with === g.with) last.q = g.q; else out.push({ ...g });
    return out;
  }, []); };
  for (let k = 0; k + 1 < cuts.length; k++) {
    const p = cuts[k], q = cuts[k + 1], m = (p + q) / 2;
    if (q - p < 1e-4) continue;
    let best = null;
    for (const v of ivs) if (v.lo <= m && m <= v.hi && (!best || v.d < best.d)) best = v;
    segs.push({ p, q, with: best ? best.room : null });
  }
  join();
  for (;;) {
    let k = -1;
    segs.forEach((g, i) => { if (segs.length > 1 && g.q - g.p < STUB_M && (k < 0 || g.q - g.p < segs[k].q - segs[k].p)) k = i; });
    if (k < 0) break;
    const before = segs[k - 1], after = segs[k + 1];
    if (before && (!after || before.q - before.p >= after.q - after.p)) before.q = segs[k].q; else after.p = segs[k].p;
    segs.splice(k, 1);
    join();
  }
  return segs;
}

function _floorOutlines(roomGeometry, floorId) {
  const out = [];
  for (const [room, g] of Object.entries(roomGeometry || {})) {
    if (!g || g.type !== "poly" || String(g.floor_id || "main") !== String(floorId)) continue;
    const closed = closedOutline(g.points_m);
    if (closed) out.push({ room, closed, turn: _turn(closed) });
  }
  return out;
}

// A stretch's two ends: the edge's own vertices where it reaches them, else to
// the millimetre.
function _ends(a, b, g) {
  const L = _gap(a, b), at = (t) => [_mm(a[0] + (b[0] - a[0]) * t / L), _mm(a[1] + (b[1] - a[1]) * t / L)];
  return [g.p <= 0 ? a : at(g.p), g.q >= L ? b : at(g.q)];
}

// The stretch a tap at (px, py) means: on the nearest edge of a room in
// `tappable`, the part shared with one neighbouring room of `roomGeometry`, on
// this plan or not (or with none: the whole edge, if nothing shares it).
// {room, with, points: [p, q], x, y, distSq}, or null.
export function stretchAt(tappable, roomGeometry, floorId, px, py) {
  const hit = nearestRoomEdge(tappable, floorId, px, py);
  if (!hit) return null;
  const all = _floorOutlines(roomGeometry, floorId), me = all.find(o => o.room === hit.room);
  const [a, b] = hit.points;
  if (_gap(a, b) < 0.03) return { ...hit, with: null };
  const segs = _stretches(a, b, me.turn, all.filter(o => o.room !== hit.room));
  const t = _gap(a, [hit.x, hit.y]);
  const g = segs.find(s => t <= s.q) || segs[segs.length - 1];
  return { room: hit.room, with: g.with, points: _ends(a, b, g), x: hit.x, y: hit.y, distSq: hit.distSq };
}

// Every such stretch round one room: [{room, with, points: [p, q]}], or null
// when it has no outline.
export function roomStretches(roomGeometry, floorId, room) {
  const all = _floorOutlines(roomGeometry, floorId), me = all.find(o => o.room === room);
  if (!me) return null;
  const others = all.filter(o => o.room !== room), out = [];
  for (let i = 0; i + 1 < me.closed.length; i++) {
    const a = me.closed[i], b = me.closed[i + 1];
    if (_gap(a, b) < 0.03) continue;
    for (const g of _stretches(a, b, me.turn, others)) out.push({ room, with: g.with, points: _ends(a, b, g) });
  }
  return out;
}

// Where a polyline runs along the segment p-q: each leg parallel within BAR_COS
// and within `tol` of its line over the part they share. [{leg, lo, hi, u0, u1}]:
// lo..hi in metres along p-q, u0..u1 the same part as 0..1 along the leg, in the
// leg's own direction.
function _legsAlong(points, p, q, tol) {
  const L = _gap(p, q), out = [];
  if (L < 0.03) return out;
  const ux = (q[0] - p[0]) / L, uy = (q[1] - p[1]) / L, pts = points || [];
  for (let i = 0; i + 1 < pts.length; i++) {
    const c = [Number(pts[i][0]), Number(pts[i][1])], d = [Number(pts[i + 1][0]), Number(pts[i + 1][1])], LB = _gap(c, d);
    if (!(LB >= 0.03) || Math.abs((d[0] - c[0]) * ux + (d[1] - c[1]) * uy) / LB < ALONG_COS) continue;
    const tc = (c[0] - p[0]) * ux + (c[1] - p[1]) * uy, td = (d[0] - p[0]) * ux + (d[1] - p[1]) * uy;
    const lo = Math.max(0, Math.min(tc, td)), hi = Math.min(L, Math.max(tc, td));
    if (hi - lo < 0.05) continue;
    const sOf = (P) => (P[0] - p[0]) * -uy + (P[1] - p[1]) * ux, sc = sOf(c), sd = sOf(d);
    const sAt = (t) => sc + (sd - sc) * (t - tc) / (td - tc);
    if (Math.abs(sAt(lo)) > tol || Math.abs(sAt(hi)) > tol) continue;
    const u = (t) => (t - tc) / (td - tc), a0 = u(lo), a1 = u(hi);
    out.push({ leg: i, lo, hi, u0: Math.min(a0, a1), u1: Math.max(a0, a1) });
  }
  return out;
}

// The parts of stretch p-q no open barrier runs along yet, longest gaps only
// (STUB_M and up): [[p', q'], ...], or [[p, q]] with its own ends when none does.
// An open barrier within SHARE_M is on the same wall, drawn from the other room,
// so a shared edge is marked once even when the two outlines don't quite match.
export function openGaps(p, q, openPolylines) {
  const L = _gap(p, q);
  const ivs = (openPolylines || []).flatMap(pl => _legsAlong(pl, p, q, SHARE_M)).sort((x, y) => x.lo - y.lo);
  const at = (t) => (t <= 0 ? p : t >= L ? q : [_mm(p[0] + (q[0] - p[0]) * t / L), _mm(p[1] + (q[1] - p[1]) * t / L)]);
  const out = [];
  let from = 0;
  for (const v of ivs) {
    if (v.lo - from >= STUB_M) out.push([at(from), at(v.lo)]);
    from = Math.max(from, v.hi);
  }
  if (L - from >= STUB_M || (!ivs.length && L > 0)) out.push([at(from), at(L)]);
  return out;
}

// A signal wall: not an opening. The same words as the 3D house's barrierKind,
// plus anything tied to a sensor or a lock (it reads open and shut). Such a door
// or window stays as it is, an opening in the open edge.
export function isPlainWall(b) {
  const m = String((b && b.material) || "").trim().toLowerCase(), n = String((b && b.name) || "");
  return !!b && m !== "open" && m !== "glass" && !/window/i.test(n) && !/\b(door|gate)\b/i.test(n)
    && !b.linked_entity_id && !b.linked_lock_entity_id;
}

// The signal walls along stretch p-q, STUB_M of it or more:
// [{bar, along_m}], where along_m is how much of the stretch the wall covers.
export function wallsAlong(p, q, barriers) {
  const out = [];
  for (const bar of barriers || []) {
    if (!isPlainWall(bar)) continue;
    const along_m = _legsAlong(bar.points_m, p, q, WALL_M).reduce((s, v) => s + v.hi - v.lo, 0);
    if (along_m >= STUB_M) out.push({ bar, along_m });
  }
  return out;
}

// An open barrier running along a room's outline (Remove open edges takes it
// back with the room, whichever side it was tapped from).
export function runsAlongOutline(points, closed) {
  for (let i = 0; i + 1 < (closed || []).length; i++) {
    const along = _legsAlong(points, closed[i], closed[i + 1], SHARE_M).reduce((s, v) => s + v.hi - v.lo, 0);
    if (along >= STUB_M) return true;
  }
  return false;
}

const _lengthOf = (pts) => pts.reduce((s, P, i) => (i ? s + _gap(pts[i - 1], P) : 0), 0);

// A wall with stretch p-q taken out, through the door tool's own cut
// (splitPolylineAtTwoPositions): {kept: [polyline, ...], kept_m, cut_m}. Every
// corner outside the stretch stays as it was. A piece left over under STUB_M is
// a needle and goes with the cut.
export function cutWallAlong(points, p, q) {
  const kept = [];
  let rest = (points || []).map(P => [Number(P[0]), Number(P[1])]), cut_m = 0;
  while (rest) {
    const legs = _legsAlong(rest, p, q, WALL_M);
    if (!legs.length) { kept.push(rest); break; }
    let j = 0;
    while (j + 1 < legs.length && legs[j + 1].leg === legs[j].leg + 1 && legs[j].u1 > 1 - 1e-6 && legs[j + 1].u0 < 1e-6) j++;
    const pos = (v, t) => { const c = rest[v.leg], d = rest[v.leg + 1];
      return { segIdx: v.leg, t, x: _mm(c[0] + (d[0] - c[0]) * t), y: _mm(c[1] + (d[1] - c[1]) * t) }; };
    const s = splitPolylineAtTwoPositions(rest, pos(legs[0], legs[0].u0), pos(legs[j], legs[j].u1));
    cut_m += s.middle ? _lengthOf(s.middle) : 0;
    if (s.before) kept.push(s.before);
    rest = s.after;
  }
  const stay = kept.filter(pl => _lengthOf(pl) >= STUB_M);
  cut_m += kept.filter(pl => !stay.includes(pl)).reduce((sum, pl) => sum + _lengthOf(pl), 0);
  return { kept: stay, kept_m: stay.reduce((sum, pl) => sum + _lengthOf(pl), 0), cut_m };
}
