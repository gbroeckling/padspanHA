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
