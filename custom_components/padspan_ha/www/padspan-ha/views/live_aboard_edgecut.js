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
//   fill      every point of the view, out to its corners, looks onto a room
//             (on some floor showing, its floor or its walls up to their
//             tops): no background at any edge
//   centre    it looks at the middle of the rooms as they show from that angle
//   limits    never farther than the whole-house view, never nearer than
//             ZOOM_MAX times it (a house too thin to fill the view stops there)
//   angle     the turn and tilt are the person's: only the distance moves

export const ZOOM_MAX = 4;       // never nearer than this many times the whole-house view
const STEPS = [9, 7];            // the view looked at in a grid this fine, across and up, its edges and corners included
const LAYERS = 8;                // a floor's rooms looked through at this many heights between its floor and its walls' tops

const inPoly = (x, y, P) => {
  let c = false;
  for (let i = 0, j = P.length - 1; i < P.length; j = i++) {
    const a = P[i], b = P[j];
    if ((a[1] > y) !== (b[1] > y) && x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0]) c = !c;
  }
  return c;
};

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
 * distance is the farthest at which every ray through the grid of the view
 * passes through a room, between its floor and its walls' tops (the far
 * wall of a house seen from an angle is the house, the ground past it is
 * not); filled already at the whole house, the whole house; not filled even
 * ZOOM_MAX times nearer (the far edge of a steep view, a thin house), that
 * near.
 */
export function edgecutFit(o){
  const { floors, pts, theta, phi, tanH, tanV, rMin = 0, rMax } = o || {};
  if (!floors || !floors.length || !pts || !pts.length || !(tanH > 0 && tanV > 0 && rMax > 0) || !Number.isFinite(theta + phi)) return null;
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
  /** Does every ray through the grid pass through a room, the camera r from the target? */
  const fills = (r) => {
    const eye = target.map((v, i) => v + dir[i] * r);
    for (let i = 0; i < STEPS[0]; i++) {
      for (let j = 0; j < STEPS[1]; j++) {
        const u = (2 * i / (STEPS[0] - 1) - 1) * tanH, v = (2 * j / (STEPS[1] - 1) - 1) * tanV;
        const ray = [0, 1, 2].map(k => -dir[k] + right[k] * u + up[k] * v);
        const hit = Math.abs(ray[1]) > 1e-9 && floors.some(f => {
          for (let k = 0; k <= LAYERS; k++) {
            const t = (f.y + (f.h || 0) * k / LAYERS - eye[1]) / ray[1];
            if (t > 0 && f.polys.some(P => inPoly(eye[0] + t * ray[0], eye[2] + t * ray[2], P))) return true;
          }
          return false;
        });
        if (!hit) return false;
      }
    }
    return true;
  };
  const rLo = Math.min(rMax, Math.max(rMin, rMax / ZOOM_MAX));
  if (fills(rMax)) return { target, r: rMax };
  if (!fills(rLo)) return { target, r: rLo };
  let a = rLo, b = rMax;                                    // fills at a, not at b (bounded steps: bad numbers never hang a wall)
  for (let i = 0; i < 40; i++) { const m = (a + b) / 2; if (fills(m)) a = m; else b = m; }
  return { target, r: a };
}
