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
export function metreAnchor(mapsList, modelTransforms) {
  for (const m of (mapsList || [])) {
    const t = (modelTransforms || {})[m.id];
    if (!t || !(t.reference_measurements || []).length) continue;
    const sx = Number(t.scale_x_m), sy = Number(t.scale_y_m);
    if (!(sx > 0) || !(sy > 0)) continue;
    const stk = m.stack || {};
    // World space is ANISOTROPIC in y — makeStackXform spans the image across
    // `scale * scale_x_adj` in x and `scale * ar` in y (see its two branches).
    // A measured map therefore has two metres-per-world-unit figures, not one.
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
    const worldW = (Number(stk.scale) || 1) * (Number(stk.scale_x_adj) || 1);
    const ar = Number(stk.ref_ar) || imageAr(m) || 1;
    const worldH = (Number(stk.scale) || 1) * ar;
    if (!(worldW > 0) || !(worldH > 0)) continue;
    return {
      map_id: m.id,
      // Kept as the x figure so existing readers are unchanged in meaning.
      m_per_world: sx / worldW,
      m_per_world_x: sx / worldW,
      m_per_world_y: sy / worldH,
    };
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
