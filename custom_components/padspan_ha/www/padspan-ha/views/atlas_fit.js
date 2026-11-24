// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
// See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
//
// How big the house is drawn on a screen, as one rule and one measure.
//
// THE RULE (2026-11-19, after the wall opened "very small, with tons of space
// around it" for the sixth time): on a screen that shows the whole house, the
// floors are arranged FOR THAT SCREEN'S SHAPE so the house is drawn as large
// as it can be with every room in sight. The spacing is worked out here from
// the screen, never read from a saved number.
//
// Why every earlier fix came undone: the two numbers that decide the size
// (how far apart the floors stand, and how far each is set sideways) were ONE
// saved setting shared by every screen and by two views, the Overview tab's
// small map and the Atlas. Saved for one, they were wrong for all the others:
// a spacing that suits a narrow column stacks the floors into a tall, thin
// tower on a wide wall, which then has to shrink to fit its height. Tuning the
// number fixed whichever screen was being looked at and broke the rest.
//
// THE MEASURE: shortfall() compares the size the house IS drawn at with the
// size this screen allows. The wall checks it after every drawing
// (lights_map.js) and moves in if it is far back; tests hold it for sample
// houses on every screen shape (tests/js/atlas_fit.mjs), so a change that
// brings the far-back view home again fails before it ships.
//
// Pure: no DOM, no settings. The geometry comes from iso_lights.fabricFrame at
// spacing 0, where a floor's place is base + storey * (sideways, -spacing).

/** Drawing units around the house inside its box: room strokes, floor badges and marker halos reach a little past a room's own corners. */
export const PAD = { x: 30, top: 50, bottom: 70 };
/** The spacings a layout may use, in drawing units. Below 60 the plates' own thickness (18) and the floor badges crowd; past 420 nothing is gained on any screen. */
export const SPACING = { min: 60, max: 420, step: 10 };
export const SIDEWAYS = { max: 520, step: 20 };
/** How much of the rooms below a floor may sit under that floor's plate. A sliver of a far corner reads as depth; more hides rooms. */
export const HIDDEN_MAX = 0.02;
/** And how much of any ONE room: 2% of a whole house can be a third of one deck (seen on the first real wall). */
export const ROOM_HIDDEN_MAX = 0.06;

const inPoly = (x, y, poly) => {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
};

/**
 * Each drawn floor at spacing 0: its storey, its rooms' corners and sample
 * points inside them, and its plate (the slab under the rooms, top face and
 * the bottom face 18 units lower), all in drawing units.
 * `frame` is fabricFrame(model, floors, FG, HG) for ANY FG/HG: the storey's
 * own shift is taken back out.
 */
export function floorShapes(frame, FG = 0, HG = 0) {
  const shapes = [];
  if (!frame || !Array.isArray(frame.levels)) return shapes;
  const at = (x, y, z) => { const k = frame.rankOf(z), p = frame.iso(x, y, z); return [p[0] - k * HG, p[1] + k * FG]; };
  let pad = 0;
  const boxes = new Map();
  for (const z of frame.levels) {
    let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity;
    for (const r of frame.rooms) if (r.z === z) for (const p of r.pts) { a = Math.min(a, p[0]); c = Math.max(c, p[0]); b = Math.min(b, p[1]); d = Math.max(d, p[1]); }
    for (const l of frame.lights) if (l.z === z) { a = Math.min(a, l.x); c = Math.max(c, l.x); b = Math.min(b, l.y); d = Math.max(d, l.y); }
    if (Number.isFinite(a)) { boxes.set(z, [a, b, c, d]); pad = Math.max(pad, (c - a) / 2, (d - b) / 2); }
  }
  pad = Math.max(0.4, pad * 0.08);          // iso_lights.buildIsoSVG's slabPad
  for (const z of frame.levels) {
    const box = boxes.get(z);
    if (!box) continue;
    const [a, b, c, d] = [box[0] - pad, box[1] - pad, box[2] + pad, box[3] + pad];
    const top = [at(a, b, z), at(c, b, z), at(c, d, z), at(a, d, z)];
    const rooms = [], samples = [], byRoom = [];
    for (const r of frame.rooms) {
      if (r.z !== z || !r.pts || r.pts.length < 3) continue;
      const poly = r.pts.map(p => at(p[0], p[1], z));
      rooms.push(poly);
      const first = samples.length;
      // Sample points inside the room, on a grid in metres (its corners too): what a plate above could hide.
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const p of r.pts) { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]); }
      const step = Math.max(0.25, Math.max(x1 - x0, y1 - y0) / 8);
      for (let x = x0 + step / 2; x < x1; x += step) for (let y = y0 + step / 2; y < y1; y += step) {
        if (inPoly(x, y, r.pts)) samples.push(at(x, y, z));
      }
      for (const p of poly) samples.push(p);
      byRoom.push([first, samples.length]);       // this room's samples: [from, to)
    }
    shapes.push({ z, k: frame.rankOf(z), rooms, samples, byRoom, plate: top, thick: 18 });
  }
  return shapes;
}

const shift = (p, s, FG, HG) => [p[0] + s.k * HG, p[1] - s.k * FG];

/** The house's box at this spacing: every room corner and plate corner, both faces. {x0,y0,x1,y1} or null with nothing drawn. */
export function houseBox(shapes, FG, HG, only = null) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const grow = (p) => { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]); };
  for (const s of shapes) {
    if (only && !only(s.z)) continue;
    for (const p of s.plate) { const q = shift(p, s, FG, HG); grow(q); grow([q[0], q[1] + s.thick]); }
    for (const r of s.rooms) for (const p of r) grow(shift(p, s, FG, HG));
  }
  return Number.isFinite(x0) ? { x0, y0, x1, y1 } : null;
}

/**
 * The box the drawing itself takes at this spacing, before its pads: as wide as the house with its plates, as tall as
 * the ROOMS (iso_lights.buildIsoSVG measures its height from the rooms alone; a plate's corners sit inside the pads).
 * tests/js/atlas_fit.mjs holds this equal to the drawing's own viewBox.
 */
export function drawingBox(shapes, FG, HG) {
  const all = houseBox(shapes, FG, HG);
  if (!all) return null;
  let y0 = Infinity, y1 = -Infinity;
  for (const s of shapes) for (const r of s.rooms) for (const p of r) { const y = p[1] - s.k * FG; y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  return Number.isFinite(y0) ? { x0: all.x0, x1: all.x1, y0, y1 } : all;
}

/**
 * What the higher floors' plates hide at this spacing: {share, worst}. `share` is the part of ALL the rooms' sample
 * points under a plate (0 to 1); `worst` is the same for the one room that loses most.
 */
export function hiddenAt(shapes, FG, HG) {
  let all = 0, hidden = 0, worst = 0;
  for (const low of shapes) {
    const above = shapes.filter(s => s.k > low.k).map(s => {
      const top = s.plate.map(p => shift(p, s, FG, HG));
      // The plate with its thickness: the top face swept 18 units down.
      const ys = top.map(p => p[1]), xs = top.map(p => p[0]);
      const left = top[xs.indexOf(Math.min(...xs))], right = top[xs.indexOf(Math.max(...xs))];
      const high = top[ys.indexOf(Math.min(...ys))], lowp = top[ys.indexOf(Math.max(...ys))];
      return [high, right, [right[0], right[1] + s.thick], [lowp[0], lowp[1] + s.thick], [left[0], left[1] + s.thick], left];
    });
    if (!above.length) { all += low.samples.length; continue; }
    const under = low.samples.map(p => { const q = shift(p, low, FG, HG); return above.some(poly => inPoly(q[0], q[1], poly)); });
    all += under.length;
    for (const u of under) if (u) hidden++;
    for (const [from, to] of low.byRoom || []) {
      let n = 0;
      for (let i = from; i < to; i++) if (under[i]) n++;
      if (to > from) worst = Math.max(worst, n / (to - from));
    }
  }
  return { share: all ? hidden / all : 0, worst };
}
/** The share of the rooms' sample points that sit under a higher floor's plate at this spacing (0 to 1). */
export const hiddenShare = (shapes, FG, HG) => hiddenAt(shapes, FG, HG).share;

/** Screen pixels per drawing unit when a box is shown whole inside a stage ("contain"), with the pads and the key's row. */
export function unitPx(box, stageW, stageH, extra = 0) {
  if (!box || !(stageW > 0) || !(stageH > 0)) return 0;
  const w = box.x1 - box.x0 + 2 * PAD.x, h = box.y1 - box.y0 + PAD.top + PAD.bottom + extra;
  return Math.min(stageW / w, stageH / h);
}

/**
 * The arrangement that draws the whole house largest on a stage of this
 * shape with (nearly) every room in sight: {floorGap, horizGap, px, hidden}.
 * One floor, or nothing drawn: the spacing does not matter, the defaults come
 * back. `extra` is the height the floor key takes under the house, in units.
 *
 * Largest first; then, among the arrangements within 3% of the largest, the
 * one whose box is nearest the stage's own shape, so the room left over is
 * shared out between the floors and not left as an empty band along one
 * edge. A last tie goes to the more upright stack, so the answer never
 * flickers between two equals.
 */
export function bestLayout(shapes, stageW, stageH, { extra = 32, hiddenMax = HIDDEN_MAX, roomHiddenMax = ROOM_HIDDEN_MAX } = {}) {
  const fallback = { floorGap: 150, horizGap: 0, px: unitPx(drawingBox(shapes || [], 150, 0), stageW, stageH, extra), hidden: 0 };
  if (!shapes || shapes.length < 2 || !(stageW > 0) || !(stageH > 0)) return fallback;
  const seen = [];
  let top = 0;
  for (let FG = SPACING.min; FG <= SPACING.max; FG += SPACING.step) {
    for (let HG = -SIDEWAYS.max; HG <= SIDEWAYS.max; HG += SIDEWAYS.step) {
      const box = drawingBox(shapes, FG, HG), px = unitPx(box, stageW, stageH, extra);
      if (px < top * 0.97) continue;                       // cannot be chosen: skip the costlier check
      const hid = hiddenAt(shapes, FG, HG), hidden = hid.share;
      if (hidden > hiddenMax || hid.worst > roomHiddenMax) continue;
      const w = (box.x1 - box.x0 + 2 * PAD.x) * px, h = (box.y1 - box.y0 + PAD.top + PAD.bottom + extra) * px;
      seen.push({ floorGap: FG, horizGap: HG, px, hidden, used: (w * h) / (stageW * stageH) });
      if (px > top) top = px;
    }
  }
  let best = null;
  for (const c of seen) {
    if (c.px < top * 0.97) continue;
    if (!best || c.used > best.used + 0.004
        || (Math.abs(c.used - best.used) <= 0.004 && Math.abs(c.horizGap) < Math.abs(best.horizGap))) best = c;
  }
  return best ? { floorGap: best.floorGap, horizGap: best.horizGap, px: best.px, hidden: best.hidden } : fallback;
}

/**
 * How much of a stage a drawn house takes: {w, h, area} as shares (0 to 1).
 * Boxes are {x0,y0,x1,y1} or DOMRect-like {left,top,right,bottom}, in the
 * same units as each other. For saying it; `shortfall` is the judge.
 */
export function fillOf(house, stage) {
  const n = (b) => (b && Number.isFinite(b.x0 ?? b.left)
    ? { x0: b.x0 ?? b.left, y0: b.y0 ?? b.top, x1: b.x1 ?? b.right, y1: b.y1 ?? b.bottom } : null);
  const a = n(house), s = n(stage);
  if (!a || !s || !(s.x1 > s.x0) || !(s.y1 > s.y0)) return { w: 0, h: 0, area: 0, known: false };
  const w = Math.max(0, Math.min(a.x1, s.x1) - Math.max(a.x0, s.x0)) / (s.x1 - s.x0);
  const h = Math.max(0, Math.min(a.y1, s.y1) - Math.max(a.y0, s.y0)) / (s.y1 - s.y0);
  return { w, h, area: w * h, known: true };
}

/** A whole-house view drawn at under this share of the size its screen allows is the far-back view nobody accepts. */
export const FAR_BACK = 0.85;

/**
 * The judge: how the size a house IS drawn at compares with the size this
 * screen allows (both in screen pixels per drawing unit): {ratio, low}.
 * A long low house on a tall screen fills little of it and is still as large
 * as it can be: that is not far back. A house at 70% of what the screen
 * allows is, whatever shares of the screen it happens to cover.
 */
export function shortfall(drawnPx, bestPx) {
  if (!(drawnPx > 0) || !(bestPx > 0)) return { ratio: 0, low: false, known: false };
  const ratio = drawnPx / bestPx;
  return { ratio, low: ratio < FAR_BACK, known: true };
}

/**
 * Edgecut (a screen's ⋯ list, off unless ticked; Garry 2026-11-24: "Cut the edges left to right. Minimize empty
 * space"; "In the multi floor view, it is assumed the floors at the top and bottom can be cut off"). The zoom at
 * which the rooms cover the whole stage, edge to edge both ways: no empty ground shows beside the house, and the
 * house runs off the screen the other way (a tall stack of floors on a wide wall loses its top and bottom floors'
 * far parts). Boxes {x0,y0,x1,y1} in screen pixels, measured at zoom z0: the rooms' and the stage's. Never below 100%
 * (the whole house), never past EDGE.max; floored to a hundredth, so the same screen gives the same zoom every drawing.
 */
export const EDGE = { max: 4 };
export function edgeZoom(z0, rooms, stage) {
  const w = (b) => b.x1 - b.x0, h = (b) => b.y1 - b.y0;
  if (!(z0 > 0) || !rooms || !stage || !(w(rooms) > 0) || !(h(rooms) > 0) || !(w(stage) > 0) || !(h(stage) > 0)) return 1;
  const kCover = Math.max(w(stage) / w(rooms), h(stage) / h(rooms));
  return Math.max(1, Math.min(EDGE.max, Math.floor(z0 * kCover * 100) / 100));
}

/** The box round some rooms' outlines ([[x, y], ...] each, screen pixels), or null. */
export function roomsBox(polys) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const poly of polys || []) for (const [x, y] of poly || []) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
  }
  return Number.isFinite(x0) && x1 > x0 && y1 > y0 ? { x0, y0, x1, y1 } : null;
}
