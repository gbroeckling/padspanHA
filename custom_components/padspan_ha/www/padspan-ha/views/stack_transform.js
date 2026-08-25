// Where things are, and how to draw them. One source of truth for every view
// that puts a floor plan, a room, a scanner or a wall on screen.
//
// EVERYTHING IS METRES. A map's placement is `model.map_transforms[id]`:
// origin, two scales, rho and sigma. World space — the shared frame the
// stacked views draw in — is those metres divided by ONE stored scalar, the
// world gauge. That is the whole coordinate system.
//
// There used to be a second one. `maps[].stack` held five decomposed fields,
// or a solved affine `_m` that took precedence over them, with every y term
// stretched by a `ref_ar` the maps on a floor shared. It was a complete
// description of where a map sits, stored beside the metric description, and
// two stored copies of one fact drift: the trim, #62, #64 and #67 are each
// two copies disagreeing. It is derived on read now and there is nothing left
// to disagree.

export function imageAr(map) {
  return ((map && map.image && map.image.height) || 600) /
         ((map && map.image && map.image.width) || 800);
}

// ── Fabric → shared world space ─────────────────────────────────────────────
// The room fabric (model.room_geometry_m, metres) is the ground truth once a
// floor is built; house-level views should render IT, not each photo's own
// hand-traced room_bounds. The bridge is the WORLD GAUGE: one stored scalar
// saying how many metres a world unit is, so fabric metres ÷ the gauge drop
// straight into the same world coordinates every stacked view already uses.

// ── The world gauge ─────────────────────────────────────────────────────────
//
// How many metres one unit of the shared stack world frame is: ONE scalar,
// stored on the model as `world_gauge`, read here.
//
// This was `metreAnchor`, and it MEASURED it — walked the maps, divided a
// measured map's `scale_x_m` by the world footprint of its picture, and took
// the first map whose two axis figures agreed within 2%. It was a second
// implementation of the same measurement the backend was doing, which is how
// the reader and the writer came to be able to choose different maps and
// disagree about how big the house is. There is one number and the backend
// stores it; the panel reads it.
//
// It is ISOTROPIC. The pair `m_per_world_x` / `m_per_world_y` was never two
// quantities — world space is a plane `makeStackXform` can rotate, and a
// rotation of two non-commensurable axes is not a rotation — so the pair was
// one quantity read twice off a record that could disagree with itself, and
// `isoError` was the disagreement. With one scalar the pair is
// unrepresentable, which is why `calibration.js` and `traceback.js` could
// stop being wrong about y rather than being fixed about it.
//
// Returns { m_per_unit, source_map_id } or null. Null means NO WORLD FRAME:
// nothing measured yet, or a stored gauge that is not usable as a scale. Every
// caller already refuses in that case and must keep refusing — inventing a
// number here is the deleted 20 m fallback, which put every position on an
// unmeasured plan at the wrong size with nothing to say it was happening.
export function worldGauge(model) {
  const g = model && model.world_gauge;
  if (!g || typeof g !== "object") return null;
  // The TYPE gate is not decoration. `Number([20])` is 20 in JavaScript
  // and `float([20])` raises in Python, so a one-element array on disk —
  // which is what a JSON round trip through a careless client produces —
  // would have given the panel a house 20 m to the unit and the backend
  // no house at all. Two implementations of one predicate disagreeing
  // about which records are readable is where this whole programme
  // started, so the two are held to the same table by
  // test_metre_anchor_axes.py. A numeric STRING is accepted by both.
  const raw = g.m_per_unit;
  if (typeof raw !== "number" && typeof raw !== "string") return null;
  const k = Number(raw);
  if (!Number.isFinite(k) || !(k > 0)) return null;
  return { m_per_unit: k, source_map_id: g.source_map_id || null };
}

// Metres → world. ONE number, because there is one.
//
// This was `_fabricScale`, returning a [kx, ky] pair "so a caller cannot use
// the x scale for y by accident — which is the whole of issue #62". The pair
// was the patch. There is no accident left to prevent: a metre is a metre in
// both directions. Exported so the two sites that open-coded
// `1 / anchor.m_per_world` and applied it to BOTH axes — the calibration
// overlay and the traceback replay, which put an object 10 m down the house
// 10.000 m out in y on a trimmed anchor — go through the same arithmetic as
// everything else.
export function metresToWorld(gauge) {
  return 1 / gauge.m_per_unit;
}

// All fabric rooms converted into stack-world coordinates:
// { room: { floor_id, type, pts: [[wx,wy],...] } }   (circles become 16-gons
// so every consumer can stay polygon-only). Returns null when the fabric is
// empty or unanchored — callers then fall back to per-map room_bounds.
export function fabricWorldRooms(model) {
  const geo = (model && model.room_geometry_m) || {};
  const names = Object.keys(geo);
  if (!names.length) return null;
  const gauge = worldGauge(model);
  if (!gauge) return null;
  const k = metresToWorld(gauge);
  const out = {};
  for (const room of names) {
    const g = geo[room];
    if (!g || typeof g !== "object") continue;
    if (g.type === "poly" && Array.isArray(g.points_m) && g.points_m.length >= 3) {
      out[room] = {
        floor_id: String(g.floor_id || "main"), type: "poly",
        pts: g.points_m.map(p => [p[0] * k, p[1] * k]),
      };
    } else if (g.type === "circle") {
      // A circle in metres is a CIRCLE in world space. It used to be an
      // ellipse — two axis scales made world y not world x, so a room's
      // edge landed in the wrong place on exactly the maps that fix
      // existed for. One gauge is a similarity and preserves the ratio,
      // so the 16-gon below is regular again. It stays a polygon because
      // every consumer here is polygon-only.
      const cx = (g.cx_m || 0) * k, cy = (g.cy_m || 0) * k;
      const r = (g.r_m || 0.5) * k;
      const pts = [];
      for (let i = 0; i < 16; i++) {
        const a = i * Math.PI / 8;
        pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
      }
      out[room] = { floor_id: String(g.floor_id || "main"), type: "circle", pts };
    }
  }
  return Object.keys(out).length ? out : null;
}

// All fabric scanners converted into stack-world coordinates:
//   { scanners: [{ source, wx, wy, floor_id, level, z_m, abs_z }, ...],
//     m_per_unit }    <- the stored world gauge, so consumers convert world
//                        distance to metres from the fabric instead of
//                        assuming how wide the floor plan is
//
// The fabric is the only source of a scanner position. A receiver pinned on a
// photo is an input gesture that has already been committed to metres; reading
// r.x/r.y back out at render time re-derives a physical position from a
// picture, which is how a re-measured or trimmed map used to move scanners
// that had not moved.
//
// z_m is the mounting height above the scanner's own floor and abs_z adds that
// floor's base elevation, so consumers can do real 3D geometry instead of
// treating every radio as if it sat on the floor.
//
// Returns null when the fabric is empty or ungauged. Callers must render
// nothing in that case — there is no photo fallback, because an unmeasured
// photo has no scale to fall back to.
export function fabricWorldScanners(model) {
  const pos = (model && model.scanner_positions_m) || {};
  const sources = Object.keys(pos);
  if (!sources.length) return null;
  const gauge = worldGauge(model);
  if (!gauge) return null;
  const k = metresToWorld(gauge);

  const bases = (model && model.floor_elevations) || {};
  const levels = {};
  for (const f of (model && model.floors) || []) {
    if (f && f.id != null && f.level != null) levels[String(f.id)] = Number(f.level);
  }

  const out = [];
  for (const source of sources) {
    const p = pos[source];
    if (!p || p.x_m == null || p.y_m == null) continue;
    const floor_id = String(p.floor_id || "main");
    const z_m = Number(p.z_m != null ? p.z_m : 2.4);
    out.push({
      source,
      wx: Number(p.x_m) * k,
      wy: Number(p.y_m) * k,
      floor_id,
      level: levels[floor_id],
      z_m,
      abs_z: (Number(bases[floor_id]) || 0) + z_m,
    });
  }
  return out.length ? { scanners: out, m_per_unit: gauge.m_per_unit } : null;
}

// ── A map's placement, drawn ────────────────────────────────────────────────
//
// makeStackXform(tf, gauge) -> { mapPt, invMapPt }
//   mapPt(px, py)   : map-fraction -> world
//   invMapPt(wx, wy): world -> map-fraction (inverse of mapPt)
//
// World is metres divided by the gauge, so this is the placement record and a
// division. It took `(stk, fallbackAr)` and read five decomposed fields, or a
// solved affine `_m` that took precedence over them, with every y term
// stretched by `ref_ar` — a whole second description of where a map sits,
// stored beside the metric one, which is what generated issues #62, #64, #67
// and the trim. There is one description now.
//
// `ar` went with it. A picture's aspect is `scale_y_m / scale_x_m`: the record
// says how wide and how tall the map is in metres, which is the same fact and
// one the owner can measure. World space was already isotropic — `ar` was in
// the old frac->world step precisely so that world pixels came out square —
// and this says so instead of arranging it.
//
// Returns null when there is no placement or no gauge. Callers must draw
// nothing in that case: inventing a size is the deleted 20 m fallback.
export function makeStackXform(tf, gauge) {
  const k = gauge && Number(gauge.m_per_unit);
  if (!tf || !Number.isFinite(k) || !(k > 0)) return null;
  return {
    mapPt: (px, py) => {
      const m = mapFracToMetres(tf, px, py);
      return m ? [m[0] / k, m[1] / k] : null;
    },
    invMapPt: (wx, wy) => metresToMapFrac(tf, wx * k, wy * k),
  };
}

// The same thing for a view that has the model and a map: one lookup, so no
// caller has to remember that a map's placement is not on the map. Null when
// the map has no placement or the house has no gauge, and a caller that gets
// null must draw NOTHING — an unplaced picture has no position and no size,
// and the last thing this codebase did with a guessed size cost a release.
export function mapXform(model, m) {
  const id = m && (m.id != null ? String(m.id) : "");
  return makeStackXform(((model && model.map_transforms) || {})[id], worldGauge(model));
}

// The six-field placement whose two axes are these metre columns. Mirror of
// fabric_truth.placement_from_columns — keep the two in sync, including the
// wrap: `atan2` reports each column's bearing in (-PI, PI], so past a quarter
// turn the raw difference lands near -2PI and a square map with a 0.3 degree
// lean would record sigma = -359.7 degrees. The same placement, and refused by
// everything that asks whether sigma is small.
export function placementFromColumns(origin, colX, colY) {
  const sx = Math.hypot(colX[0], colX[1]);
  const sy = Math.hypot(colY[0], colY[1]);
  if (!(sx > 0) || !(sy > 0)) return null;
  const rot = Math.atan2(colX[1], colX[0]);
  const rotY = Math.atan2(colY[1], colY[0]);
  const TAU = 2 * Math.PI;
  return {
    origin_x_m: origin[0], origin_y_m: origin[1],
    scale_x_m: sx, scale_y_m: sy,
    rotation_rad: rot,
    shear_rad: ((rotY - rot - Math.PI / 2) + Math.PI + TAU) % TAU - Math.PI,
  };
}

// Where a map's placement puts it ON ANOTHER MAP'S PICTURE, as the affine the
// align editor's CSS draws: { m: [m11,m12,m21,m22], ox, oy } in the same
// centred convention the Point Align solver produces, so a hand drag and a
// solved align are the same numbers.
//
// The align stage IS the reference picture — sized to its shape, drawn
// untransformed — so "stage coordinates" and "the reference's own fraction"
// are the same thing, and the bridge between the two placements is METRES.
// The reference layer used to be drawn through its own stack transform on top
// of that, which meant the stage was neither picture and every gesture was
// measured in a frame nothing else used.
//
// Null when either map has no placement, or the reference's is singular —
// there is no such thing as "where is this map on a map that is nowhere".
export function placementStageAffine(tf, refTf) {
  const at = (u, v) => {
    const m = mapFracToMetres(tf, u, v);
    return m ? metresToMapFrac(refTf, m[0], m[1]) : null;
  };
  const o = at(0.5, 0.5), x0 = at(0, 0.5), x1 = at(1, 0.5), y0 = at(0.5, 0), y1 = at(0.5, 1);
  if (!o || !x0 || !x1 || !y0 || !y1) return null;
  return {
    m: [x1[0] - x0[0], y1[0] - y0[0], x1[1] - x0[1], y1[1] - y0[1]],
    ox: o[0] - 0.5, oy: o[1] - 0.5,
  };
}

// ── Walls in the fabric, for the views that still draw on a photograph ──────
//
// A barrier is stored in metres with an id (fabric rf_barriers_m). The 2D
// floor views draw in the stack's world frame and the plan editor draws on
// one photo, so each needs the walls handed over in its own coordinates. Both
// conversions live HERE, next to the scanner one, so a wall and the scanner
// beside it go through the same numbers.

// Fabric walls on a floor, in the stack world frame ({points:[[wx,wy]…],
// attenuation_dbm, id, name}). Null when there is no world gauge — the same
// rule as fabricWorldScanners: no gauge, no invented scale.
export function fabricWorldBarriers(model, floorId) {
  const bars = (model && model.rf_barriers_m) || [];
  if (!bars.length) return [];
  const gauge = worldGauge(model);
  if (!gauge) return null;
  const k = metresToWorld(gauge);
  const out = [];
  for (const b of bars) {
    if (floorId != null && String(b.floor_id || "main") !== String(floorId)) continue;
    const pts = (b.points_m || []).map(p => [Number(p[0]) * k, Number(p[1]) * k]);
    if (pts.length < 2) continue;
    out.push({ id: b.id, name: b.name, material: b.material,
               attenuation_dbm: b.attenuation_dbm ?? 6, points: pts });
  }
  return out;
}

// The model's map transform, in both directions. Mirrors ModelStore
// map_frac_to_metres / metres_to_map_frac exactly — keep the two in sync:
//
//   metres = origin + R(rho) . [[Sx, -Sy*sin(sigma)], [0, Sy*cos(sigma)]] . frac
//
// rho = rotation_rad aims the x axis; sigma = shear_rad is how far the y axis
// leans off perpendicular to it. Five fields could only describe a placement
// whose axes are square to each other, and the renderer can draw one whose
// axes are not — a Point Align full transform, or any rotated placement on an
// anchor whose two axis scales disagree — so those were recorded as the
// nearest square placement and every pin converted through them landed short.
// sigma = 0 is the five-field arithmetic unchanged; sigma = +/-PI is a mirror.
export function mapFracToMetres(tf, fx, fy) {
  if (!tf) return null;
  const ox = Number(tf.origin_x_m || 0), oy = Number(tf.origin_y_m || 0);
  const sx = Number(tf.scale_x_m ?? 1), sy = Number(tf.scale_y_m ?? 1);
  const rot = Number(tf.rotation_rad || 0), sig = Number(tf.shear_rad || 0);
  const dx = fx * sx, dy = fy * sy;
  if (Math.abs(rot) > 1e-9 || Math.abs(sig) > 1e-9) {
    const c = Math.cos(rot), s = Math.sin(rot);
    const cq = Math.cos(rot + sig), sq = Math.sin(rot + sig);
    return [ox + dx * c - dy * sq, oy + dx * s + dy * cq];
  }
  return [ox + dx, oy + dy];
}

export function metresToMapFrac(tf, xm, ym) {
  if (!tf) return null;
  const ox = Number(tf.origin_x_m || 0), oy = Number(tf.origin_y_m || 0);
  // `?? 1` and not `|| 1`: a ZERO scale is a placement with no width, which
  // is singular and is refused below. `|| 1` read it as "absent" and
  // substituted a 1-metre map, so the panel laid pins out on a placement the
  // backend refuses to convert through at all.
  const sx = Number(tf.scale_x_m ?? 1), sy = Number(tf.scale_y_m ?? 1);
  const rot = Number(tf.rotation_rad || 0), sig = Number(tf.shear_rad || 0);
  // How far the picture REACHES on each axis: `Sx` across, and `Sy*|cos sig|`
  // perpendicular to it, which is what a lean eats into. One millimetre, the
  // same number as fabric_truth.PLACEMENT_MIN_EXTENT_M and the same gate
  // `placement_is_readable` applies — three implementations of "is this record
  // usable" disagreeing is where this programme started. It was a bare cosine
  // bar of 1e-9, which let a quarter turn through: rounded to the store's 1
  // urad grid `cos sig` reads 3.3e-07.
  const cs = Math.cos(sig);
  if (!(Math.abs(sx) >= 1e-3) || !(Math.abs(sy) * Math.abs(cs) >= 1e-3)) return null;
  const rx = xm - ox, ry = ym - oy;
  if (Math.abs(rot) > 1e-9 || Math.abs(sig) > 1e-9) {
    const c = Math.cos(rot), s = Math.sin(rot);
    const cq = Math.cos(rot + sig), sq = Math.sin(rot + sig);
    return [(rx * cq + ry * sq) / (sx * cs), (ry * c - rx * s) / (sy * cs)];
  }
  return [rx / sx, ry / sy];
}
