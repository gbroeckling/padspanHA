// Shared stack transform: normalised map coords (0-1) <-> shared world space.
// Single source of truth for the per-map alignment transform previously
// duplicated across maps.js, calibration.js, overview.js, traceback.js and
// lights_panel.js (P2-5). Mirrors the backend pipeline in maps_store.py.
//
// World-space convention: scale -> rotate -> translate, with every y term
// carrying the reference aspect ratio `ar`, so world space is anisotropic in y.
//
// Two branches, selected by the stack contents:
//  - raw affine: `_m` is a length-4 [a,b,c,d] matrix (Point-Align-solved maps);
//    aspect ratio is `_m_ar || ref_ar || fallbackAr`.
//  - decomposed: x_offset / y_offset / scale / scale_x_adj / rotation;
//    aspect ratio is `ref_ar || fallbackAr`.
//
// `fallbackAr` is what a caller uses when the stack predates `ref_ar`; callers
// that have the map image pass imageAr(map), others pass nothing (-> 1).

export function imageAr(map) {
  return ((map && map.image && map.image.height) || 600) /
         ((map && map.image && map.image.width) || 800);
}

// ── Fabric → shared world space ─────────────────────────────────────────────
// The room fabric (model.room_geometry_m, metres) is the ground truth once a
// floor is built; house-level views should render IT, not each photo's own
// hand-traced room_bounds. The bridge is the metre anchor: the one genuinely
// measured map (real reference_measurements) pins the stack world frame to
// metres, so fabric metres ÷ m_per_world drop straight into the same world
// coordinates every stacked view already uses.

// Find the measured map that anchors the world frame. Returns
// {map_id, m_per_world} or null when nothing was ever really measured.
// How far the two axis scales may disagree before a map is considered unfit to
// anchor the house. Mirrors ANCHOR_ISO_TOL in fabric_truth.py — the two must
// pick the same map or the reader and the writer disagree about the fabric.
const ANCHOR_ISO_TOL = 0.02;

export function metreAnchor(mapsList, modelTransforms) {
  // Candidates are collected rather than returned on first sight: a map whose
  // two axis scales disagree is one whose stored metric extent no longer
  // describes its world footprint — the signature of a trim, which rewrites
  // map_transforms but leaves the stack alone (issue #62). Anchoring the whole
  // house to one of those skews every floor, including untrimmed ones. Prefer
  // a self-consistent map; fall back to the least-skewed so an install whose
  // only measured map is trimmed is never left worse off than before.
  const candidates = [];
  for (const m of (mapsList || [])) {
    const t = (modelTransforms || {})[m.id];
    if (!t || !(t.reference_measurements || []).length) continue;
    const sx = Number(t.scale_x_m), sy = Number(t.scale_y_m);
    if (!(sx > 0) || !(sy > 0)) continue;
    // World space is ANISOTROPIC in y — a map's image covers a different world
    // span across than it does down — so a measured map has two
    // metres-per-world-unit figures, not one.
    //
    // This used to read scale_y_m, validate it, and then return only the x
    // figure — which every consumer applied to BOTH axes. Rooms came out
    // correct across and wrong down by exactly the map's aspect error, and it
    // only looked right while a map's pixel aspect matched its metric one.
    // Trimming a map breaks that: the stored dimensions change, `ar` with
    // them, and the fabric is drawn through a scale that no longer describes
    // the picture it is being drawn on (issue #62 — rooms vertically
    // compressed in the overhead view while the radios, which never leave the
    // image's own 0-1 space, stayed put).
    //
    // Both spans come from worldFootprint(), which measures them through the
    // map's own transform; see its note for why they must not be read off the
    // stack fields.
    const [worldW, worldH] = worldFootprint(m);
    if (!(worldW > 0) || !(worldH > 0)) continue;
    const mpwx = sx / worldW, mpwy = sy / worldH;
    const isoError = mpwx ? Math.abs(mpwy - mpwx) / mpwx : 1;
    const cand = {
      map_id: m.id,
      // Kept as the x figure so existing readers are unchanged in meaning.
      m_per_world: mpwx,
      m_per_world_x: mpwx,
      m_per_world_y: mpwy,
      iso_error: isoError,
    };
    if (isoError <= ANCHOR_ISO_TOL) return cand;
    candidates.push(cand);
  }
  if (candidates.length) {
    let worst = candidates[0];
    for (const c of candidates) if (c.iso_error < worst.iso_error) worst = c;
    return { ...worst, degraded: true };
  }
  return null;
}

// Metres → world, per axis. One place, so a caller cannot use the x scale for
// y by accident — which is the whole of issue #62.
function _fabricScale(anchor) {
  const kx = 1 / (anchor.m_per_world_x || anchor.m_per_world);
  const ky = 1 / (anchor.m_per_world_y || anchor.m_per_world);
  return [kx, ky];
}

// All fabric rooms converted into stack-world coordinates:
// { room: { floor_id, type, pts: [[wx,wy],...] } }   (circles become 16-gons
// so every consumer can stay polygon-only). Returns null when the fabric is
// empty or unanchored — callers then fall back to per-map room_bounds.
export function fabricWorldRooms(mapsList, model) {
  const geo = (model && model.room_geometry_m) || {};
  const names = Object.keys(geo);
  if (!names.length) return null;
  const anchor = metreAnchor(mapsList, model && model.map_transforms);
  if (!anchor) return null;
  const [kx, ky] = _fabricScale(anchor);
  const out = {};
  for (const room of names) {
    const g = geo[room];
    if (!g || typeof g !== "object") continue;
    if (g.type === "poly" && Array.isArray(g.points_m) && g.points_m.length >= 3) {
      out[room] = {
        floor_id: String(g.floor_id || "main"), type: "poly",
        pts: g.points_m.map(p => [p[0] * kx, p[1] * ky]),
      };
    } else if (g.type === "circle") {
      // A circle in metres is an ELLIPSE in world space whenever the two
      // scales differ, because world y is not world x. Drawing it as a circle
      // on the mean of the two would put the room's edge in the wrong place on
      // exactly the maps this fix exists for.
      const cx = (g.cx_m || 0) * kx, cy = (g.cy_m || 0) * ky;
      const rx = (g.r_m || 0.5) * kx, ry = (g.r_m || 0.5) * ky;
      const pts = [];
      for (let i = 0; i < 16; i++) {
        const a = i * Math.PI / 8;
        pts.push([cx + rx * Math.cos(a), cy + ry * Math.sin(a)]);
      }
      out[room] = { floor_id: String(g.floor_id || "main"), type: "circle", pts };
    }
  }
  return Object.keys(out).length ? out : null;
}

// All fabric scanners converted into stack-world coordinates:
//   { scanners: [{ source, wx, wy, floor_id, level, z_m, abs_z }, ...],
//     m_per_world }   <- the measured scale, so consumers convert world
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
// Returns null when the fabric is empty or unanchored. Callers must render
// nothing in that case — there is no photo fallback, because an unmeasured
// photo has no scale to fall back to.
export function fabricWorldScanners(mapsList, model) {
  const pos = (model && model.scanner_positions_m) || {};
  const sources = Object.keys(pos);
  if (!sources.length) return null;
  const anchor = metreAnchor(mapsList, model && model.map_transforms);
  if (!anchor) return null;
  const [kx, ky] = _fabricScale(anchor);

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
      wx: Number(p.x_m) * kx,
      wy: Number(p.y_m) * ky,
      floor_id,
      level: levels[floor_id],
      z_m,
      abs_z: (Number(bases[floor_id]) || 0) + z_m,
    });
  }
  return out.length ? { scanners: out, m_per_world: anchor.m_per_world } : null;
}

// makeStackXform(stk, fallbackAr) -> { ar, mapPt, invMapPt }
//   mapPt(px, py)   : map-fraction -> world
//   invMapPt(wx, wy): world -> map-fraction (inverse of mapPt)
export function makeStackXform(stk, fallbackAr) {
  stk = stk || {};
  const ox = stk.x_offset || 0, oy = stk.y_offset || 0;
  const refAr = stk.ref_ar || fallbackAr || 1;

  if (stk._m && stk._m.length === 4) {
    const m = stk._m;
    const ar = stk._m_ar || refAr;
    const det = m[0] * m[3] - m[1] * m[2];
    return {
      ar,
      mapPt: (px, py) => {
        const u = px - 0.5, v = py - 0.5;
        return [m[0] * u + m[1] * v + 0.5 + ox, ar * (m[2] * u + m[3] * v + 0.5 + oy)];
      },
      invMapPt: (wx, wy) => {
        if (Math.abs(det) < 1e-12) return [0.5, 0.5];
        const rx = wx - 0.5 - ox;
        const ry = wy / ar - 0.5 - oy;
        return [(m[3] * rx - m[1] * ry) / det + 0.5, (-m[2] * rx + m[0] * ry) / det + 0.5];
      },
    };
  }

  const sc = stk.scale || 1, sx = stk.scale_x_adj || 1;
  const ar = refAr;
  const r = (stk.rotation || 0) * Math.PI / 180;
  const cosR = Math.cos(r), sinR = Math.sin(r);
  return {
    ar,
    mapPt: (px, py) => {
      const dx = (px - 0.5) * sc * sx, dy = (py - 0.5) * sc * ar;
      return [(0.5 + ox) + dx * cosR - dy * sinR, ar * (0.5 + oy) + dx * sinR + dy * cosR];
    },
    invMapPt: (wx, wy) => {
      const rx = wx - (0.5 + ox), ry = wy - ar * (0.5 + oy);
      const dx = rx * cosR + ry * sinR;
      const dy = -rx * sinR + ry * cosR;
      return [dx / (sc * sx || 1e-9) + 0.5, dy / (sc * ar || 1e-9) + 0.5];
    },
  };
}

// The world span of a map's full image, measured THROUGH its transform:
// [width, height], the lengths of the image's two edges in world space, which
// is what "how much world does this picture cover" means under rotation as
// well as without it.
//
// Never re-derive this from `scale * scale_x_adj` and `scale * ref_ar`. Those
// are the inputs to ONE of makeStackXform's two branches, and it ignores them
// completely when Point Align has written a raw affine `_m`. A Point-Aligned
// map derived that way gets a footprint the renderer never draws, and every
// metre figure computed from it is skewed by whatever the stale fields happen
// to still say (issue #62). Asking the transform what it actually does is
// correct for both branches, correct under rotation, and stays correct if a
// third representation is ever added.
export function worldFootprint(m, stk) {
  const xf = makeStackXform(stk || m.stack || {}, imageAr(m));
  const [x0, y0] = xf.mapPt(0, 0);
  const [x1, y1] = xf.mapPt(1, 0);
  const [x2, y2] = xf.mapPt(0, 1);
  return [Math.hypot(x1 - x0, y1 - y0), Math.hypot(x2 - x0, y2 - y0)];
}

// ── Walls in the fabric, for the views that still draw on a photograph ──────
//
// A barrier is stored in metres with an id (fabric rf_barriers_m). The 2D
// floor views draw in the stack's world frame and the plan editor draws on
// one photo, so each needs the walls handed over in its own coordinates. Both
// conversions live HERE, next to the scanner one, so a wall and the scanner
// beside it go through the same numbers.

// Fabric walls on a floor, in the stack world frame ({points:[[wx,wy]…],
// attenuation_dbm, id, name}). Null when there is no metre anchor — the same
// rule as fabricWorldScanners: no anchor, no invented scale.
export function fabricWorldBarriers(mapsList, model, floorId) {
  const bars = (model && model.rf_barriers_m) || [];
  if (!bars.length) return [];
  const anchor = metreAnchor(mapsList, model && model.map_transforms);
  if (!anchor) return null;
  const [kx, ky] = _fabricScale(anchor);
  const out = [];
  for (const b of bars) {
    if (floorId != null && String(b.floor_id || "main") !== String(floorId)) continue;
    const pts = (b.points_m || []).map(p => [Number(p[0]) * kx, Number(p[1]) * ky]);
    if (pts.length < 2) continue;
    out.push({ id: b.id, name: b.name, material: b.material,
               attenuation_dbm: b.attenuation_dbm ?? 6, points: pts });
  }
  return out;
}

// The model's map transform, in both directions. Mirrors ModelStore
// map_frac_to_metres / metres_to_map_frac exactly: scale, rotate, offset.
export function mapFracToMetres(tf, fx, fy) {
  if (!tf) return null;
  const ox = Number(tf.origin_x_m || 0), oy = Number(tf.origin_y_m || 0);
  const sx = Number(tf.scale_x_m || 1), sy = Number(tf.scale_y_m || 1);
  const rot = Number(tf.rotation_rad || 0);
  const dx = fx * sx, dy = fy * sy;
  if (Math.abs(rot) > 1e-9) {
    const c = Math.cos(rot), s = Math.sin(rot);
    return [ox + dx * c - dy * s, oy + dx * s + dy * c];
  }
  return [ox + dx, oy + dy];
}

export function metresToMapFrac(tf, xm, ym) {
  if (!tf) return null;
  const ox = Number(tf.origin_x_m || 0), oy = Number(tf.origin_y_m || 0);
  const sx = Number(tf.scale_x_m || 1), sy = Number(tf.scale_y_m || 1);
  const rot = Number(tf.rotation_rad || 0);
  if (Math.abs(sx) < 1e-9 || Math.abs(sy) < 1e-9) return null;
  let rx = xm - ox, ry = ym - oy;
  if (Math.abs(rot) > 1e-9) {
    const c = Math.cos(-rot), s = Math.sin(-rot);
    const dx = rx * c - ry * s, dy = rx * s + ry * c;
    rx = dx; ry = dy;
  }
  return [rx / sx, ry / sy];
}
