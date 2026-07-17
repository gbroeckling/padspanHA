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
