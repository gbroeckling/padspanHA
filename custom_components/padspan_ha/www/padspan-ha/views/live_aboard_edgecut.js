// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
// See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
//
// Edgecut in the 3D house (Garry, 2026-11-24: "zoom in so almost all the
// screen shows rooms"; then, the same day, "Cut the edges left to right.
// Minimize empty space": the rooms fill the screen edge to edge, the house's
// outer edges cut off in whichever direction overflows; a light or a button
// out at an edge does not hold it back). The ⋯ list's line, per screen
// (live_aboard_show.js); the view (live_aboard.js) hands in the rooms and the
// camera's angle, and this works out where it looks and how near it comes.
// Numbers only: nothing here imports three.js or reads the page.
//
//   fill      the rooms, as the camera sees them (floors and wall tops),
//             reach every edge of the view: the house spans it left to right
//             and top to bottom, as the flat map's rooms do (atlas_fit.js
//             edgeZoom). Not every corner: a tilted view's top corners look
//             past the far wall, and filling those too took the camera to a
//             room or two (2026-11-24, the first build)
//   centre    it looks at the middle of the rooms as they show from that angle
//   limits    never farther than the whole-house view, never nearer than
//             ZOOM_MAX times it (a house too thin to fill the view stops there)
//   angle     the turn and tilt are the person's: only the distance moves

export const ZOOM_MAX = 4;       // never nearer than this many times the whole-house view

/** The camera's way of looking from (theta, phi), as the view's orbit and three.js's lookAt make it:
 *  dir (from the point looked at toward the camera), right and up. */
export function cameraAxes(theta, phi){
  const dir = [Math.sin(phi) * Math.sin(theta), Math.cos(phi), Math.sin(phi) * Math.cos(theta)];
  const right = [Math.cos(theta), 0, -Math.sin(theta)];
  const up = [dir[1] * right[2] - dir[2] * right[1], dir[2] * right[0] - dir[0] * right[2], dir[0] * right[1] - dir[1] * right[0]];
  return { dir, right, up };
}

/**
 * Edgecut's camera. floors: [{y, h, polys: [[[x, z], …], …]}], each floor
 * showing at its height (world y), its walls' height and its rooms'
 * outlines (world x, z);
 * pts: the rooms' corners ([x, y, z], floor and wall top) whose middle it
 * looks at; theta, phi: the camera's angle; tanH, tanV: the tangents of
 * half the field of view; rMin: the nearest the camera comes; rMax: the
 * whole-house view's distance.
 *
 * Returns {target: [x, y, z], r}, or null with nothing to frame. The
 * distance is the farthest at which the rooms' corners, as the camera sees
 * them, reach past every edge of the view; reaching already at the whole
 * house, the whole house; not even ZOOM_MAX times nearer, that near.
 */
export function edgecutFit(o){
  const { pts, theta, phi, tanH, tanV, rMin = 0, rMax } = o || {};
  if (!pts || !pts.length || !(tanH > 0 && tanV > 0 && rMax > 0) || !Number.isFinite(theta + phi)) return null;
  const { dir, right, up } = cameraAxes(theta, phi);
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  // The middle of the rooms as they show from here: the box's middle, moved to the middle of their spread across and up.
  const lo = [0, 1, 2].map(i => Math.min(...pts.map(p => p[i]))), hi = [0, 1, 2].map(i => Math.max(...pts.map(p => p[i])));
  const c = lo.map((v, i) => (v + hi[i]) / 2);
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const p of pts) {
    const q = [p[0] - c[0], p[1] - c[1], p[2] - c[2]], a = dot(q, right), b = dot(q, up);
    x0 = Math.min(x0, a); x1 = Math.max(x1, a); y0 = Math.min(y0, b); y1 = Math.max(y1, b);
  }
  const target = c.map((v, i) => v + right[i] * (x0 + x1) / 2 + up[i] * (y0 + y1) / 2);
  if (!target.every(Number.isFinite)) return null;
  /** Do the rooms' corners, the camera r from the target, reach past every edge of the view? */
  const fills = (r) => {
    const eye = target.map((v, i) => v + dir[i] * r);
    let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
    for (const p of pts) {
      const q = [p[0] - eye[0], p[1] - eye[1], p[2] - eye[2]], depth = -dot(q, dir);
      if (!(depth > 1e-6)) return true;                       // a corner level with the camera or behind it: the house is all round
      const u = dot(q, right) / (depth * tanH), v = dot(q, up) / (depth * tanV);
      u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v);
    }
    return u0 <= -1 && u1 >= 1 && v0 <= -1 && v1 >= 1;
  };
  const rLo = Math.min(rMax, Math.max(rMin, rMax / ZOOM_MAX));
  if (fills(rMax)) return { target, r: rMax };
  if (!fills(rLo)) return { target, r: rLo };
  let a = rLo, b = rMax;                                    // fills at a, not at b (bounded steps: bad numbers never hang a wall)
  for (let i = 0; i < 40; i++) { const m = (a + b) / 2; if (fills(m)) a = m; else b = m; }
  return { target, r: a };
}
