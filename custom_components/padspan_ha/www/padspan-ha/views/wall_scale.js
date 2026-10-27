// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
//
// How big a wall screen draws PadSpan (the sidebar Atlas on ?kiosk=1,
// lights_panel.js _wallOn; Settings → UI Structure → Wall screens shows the
// same numbers). One place, so the card's preview and the wall agree.
//
// Without a size for the screen, the scale is the screen against 1080p (a 4K
// wall is 2) times the chosen text size against 20 arcmin. With one, it is
// worked from what the eye sees, the way control rooms size their text (ISO
// 9241-303, MIL-PRF-87268D): text should have a capital height of `arcmin`
// of visual angle (16 the minimum, 20-22 preferred, 24 for far walls). The
// panel's 13 px text on a 24" 1080p monitor at 0.6 m is 14.4 arcmin; a
// wall's pixels are bigger and further away. Never under 1: nothing gets
// smaller than it is on a desk.

export const WALL_UI_MAX = 6;
export const REF_PITCH_MM = 0.2767, REF_DIST_M = 0.6, REF_ARCMIN = 14.4, BASE_PX = 13, CAP = 0.7;
export const TEXT_STEPS = [[16, "Small"], [20, "Comfortable"], [24, "Large"], [28, "Very large"]];

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/** How much bigger a screen is than 1080p, either way up: its long side
 *  against 1920 and its short side against 1080. A portrait 4K wall
 *  (2160 x 3840) is 2, like a landscape one; against w/1920 and h/1080 it
 *  came out 1.13 and drew its text at about half the size. */
export function screenRatio(w, h){
  const W = Number(w), H = Number(h);
  if (!(W > 0) || !(H > 0)) return 1;
  return Math.min(Math.max(W, H) / 1920, Math.min(W, H) / 1080);
}

/** A wall's turn, from its link (?wall_rotate=90 | 270): for a screen hung
 *  on its side whose TV or stick can't turn its picture. 0: as it comes. */
export const ROTATIONS = [[0, "As the screen shows it"], [90, "Portrait: turn the picture clockwise"], [270, "Portrait: turn the picture anticlockwise"]];
export function rotationOf(v){
  const n = parseInt(v, 10);
  return n === 90 || n === 270 ? n : 0;
}

/** mm per device pixel of a screen `inches` across the diagonal. */
export function pitchMm(inches, w, h, dpr = 1){
  return 25.4 * inches / Math.hypot(w * dpr, h * dpr);
}

/** The scale for a window w x h (CSS px), with {inches, meters, arcmin, dpr}. */
export function wallScale(w, h, o = {}){
  const arcmin = Number(o.arcmin) > 0 ? clamp(Number(o.arcmin), 14, 36) : 20;
  const inches = Number(o.inches), meters = Number(o.meters), dpr = Number(o.dpr) > 0 ? Number(o.dpr) : 1;
  let s;
  if (inches > 0 && meters > 0 && w > 0 && h > 0) {
    s = (meters / REF_DIST_M) * (REF_PITCH_MM / pitchMm(inches, w, h, dpr)) * (arcmin / REF_ARCMIN) / dpr;
  } else {
    s = screenRatio(w, h) * (arcmin / 20);
  }
  return Number.isFinite(s) ? clamp(Math.round(s * 100) / 100, 1, WALL_UI_MAX) : 1;
}

/** The controls' scale: the text's, but no bigger than a finger needs. Text
 *  is sized for whoever reads it from across the room; whoever touches a
 *  wall stands at arm's length, so its buttons stop at about CTL_MM on the
 *  glass (kiosk practice, ISO 9241-411: 19 mm for public touch screens).
 *  BASE_CTL_PX is the rail's button at scale 1. Without the screen's size
 *  there is nothing to measure against: the text's scale, as before. */
export const CTL_MM = 22, BASE_CTL_PX = 32;
export function controlScale(scale, inches, w, h, dpr = 1){
  const s = Number(scale) > 1 ? Number(scale) : 1;
  if (!(inches > 0) || !(w > 0) || !(h > 0)) return s;
  const cssMm = pitchMm(inches, w, h, dpr) * (dpr > 0 ? dpr : 1);   // mm per CSS pixel
  const cap = CTL_MM / (BASE_CTL_PX * cssMm);
  return clamp(Math.round(Math.min(s, Math.max(1, cap)) * 100) / 100, 1, WALL_UI_MAX);
}

/** The capital height of PadSpan's text on that screen, in mm (or null without a size). */
export function textMm(scale, inches, w, h, dpr = 1){
  if (!(inches > 0)) return null;
  return BASE_PX * scale * CAP * dpr * pitchMm(inches, w, h, dpr);
}

/** The settings a wall goes by: a screen's own link wins over the house's
 *  (?wall_in=55&wall_m=2.5&wall_text=20). */
export function wallParams(search, house){
  let q; try { q = new URLSearchParams(search); } catch (_) { q = new URLSearchParams(""); }
  const num = (k) => { const v = parseFloat(q.get(k)); return Number.isFinite(v) ? v : null; };
  const h = house || {};
  return {
    inches: num("wall_in") ?? (Number(h.wall_screen_in) || 0),
    meters: num("wall_m") ?? (Number(h.wall_distance_m) || 2.5),
    arcmin: num("wall_text") ?? (Number(h.wall_text_arcmin) || 20),
    dim: clamp(Number(h.wall_night_dim) || 0, 0, 0.7),
    shift: !!h.wall_pixel_shift,
    // Seconds between floors while nobody touches the wall (0: it stays put).
    cycle: Number(h.wall_floor_cycle_s) >= 10 ? Math.min(600, Math.round(Number(h.wall_floor_cycle_s))) : 0,
    fully: !!h.wall_fully,
    // This screen's own turn, from its link only (each wall hangs its own way).
    rotate: rotationOf(q.get("wall_rotate")),
  };
}

/** A screen's own link for these values (the card's "link for one screen").
 *  `full`: it says everything, so nothing of the house's setting gets in
 *  (wall_in=0 is "size from the screen", wall_text even at 20). */
export function wallLink(o, full = false){
  const p = ["kiosk=1"];
  if (o.inches > 0) p.push(`wall_in=${Math.round(o.inches)}`, `wall_m=${(Math.round(o.meters * 10) / 10)}`);
  else if (full) p.push("wall_in=0");
  if (o.arcmin && (full || Math.round(o.arcmin) !== 20)) p.push(`wall_text=${Math.round(o.arcmin)}`);
  if (rotationOf(o.rotate)) p.push(`wall_rotate=${rotationOf(o.rotate)}`);
  return `/padspan-lights?${p.join("&")}`;
}

/** The word for a text size (TEXT_STEPS): the nearest step's name. */
export function textWord(arcmin){
  let best = TEXT_STEPS[0];
  for (const t of TEXT_STEPS) if (Math.abs(t[0] - arcmin) < Math.abs(best[0] - arcmin)) best = t;
  return best[1];
}

/** The floor a wall shows next when it cycles: `stops` the focus positions
 *  that are one floor or All (lights_map.js view.wallStops), `now` the one
 *  showing. A position that isn't a stop (a pair of floors) starts from All. */
export function nextFloorStop(stops, now){
  if (!Array.isArray(stops) || stops.length < 2) return null;
  const i = stops.indexOf(now);
  return stops[(i + 1) % stops.length];
}

/** Fully Kiosk's screen brightness (0-255) for a night dim of `dim` (0-0.7)
 *  from the day's `day` level; never fully black. */
export function fullyBrightness(day, dim){
  const d = Number(day) > 0 ? Math.min(255, Number(day)) : 255;
  return Math.max(1, Math.round(d * (1 - clamp(Number(dim) || 0, 0, 0.7))));
}
