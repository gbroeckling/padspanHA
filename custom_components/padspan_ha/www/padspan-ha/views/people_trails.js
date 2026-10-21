// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
// See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
//
// Trails: where each person and tag went in the last half hour, from the
// history PadSpan already keeps for Traceback (traceback_store.py: a frame
// about every 10 s of each identified or followed thing, in metres, with its
// floor). Nothing new is recorded for them: they are read back through
// padspan_ha/traceback_get, never more often than TRAIL_MS, only while a
// screen has Trails on (off by default, kept on that browser alone).
//
// A trail breaks where its thing changed floor or went unheard for more than
// GAP_S (no line drawn through a wall it never walked through); each point
// keeps its time so the drawing can fade it by age. Pure: no DOM, no three.js.

/** How far back a trail reaches (s). */
export const TRAIL_S = 1800;
/** How often a screen with Trails on reads them again (ms). */
export const TRAIL_MS = 60000;
/** Frames asked for: half an hour at Traceback's ~10 s is ~180; more is thinned evenly. */
export const TRAIL_FRAMES = 360;
/** Unheard for longer than this (s): the trail breaks. */
export const GAP_S = 120;
/** Closer than this to the last point (m): the same spot, not kept again. */
const SAME_M = 0.05;
/** Each person's or tag's own colour, in turn (the newest first picked). */
export const TRAIL_COLOURS = ["#fbbf24", "#f472b6", "#a78bfa", "#34d399", "#60a5fa", "#fb923c", "#f87171", "#22d3ee"];
/** The newest end's opacity, and the oldest's. */
export const FADE = [0.85, 0.06];

const fin = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** What to ask Traceback for (nowS: seconds since 1970). */
export function trailRequest(nowS){
  return { type: "padspan_ha/traceback_get", start_ts: nowS - TRAIL_S, max_frames: TRAIL_FRAMES };
}

/**
 * Traceback's frames ({ts, o: [{k, x_m, y_m, f}]}) → Map(key → runs), each
 * run {floor_id, pts: [{x, y, ts}]} oldest first, of two points or more.
 * Only the last TRAIL_S before nowS; a thing with no spot (room only) has
 * no trail.
 */
export function trailsOf(frames, nowS, windowS = TRAIL_S){
  const out = new Map(), from = nowS - windowS;
  const list = (Array.isArray(frames) ? frames : []).filter(f => f && fin(f.ts) !== null && f.ts >= from && f.ts <= nowS + 5)
    .sort((a, b) => a.ts - b.ts);
  const open = new Map();                       // key -> the run being drawn, and its last time
  for (const f of list) {
    for (const o of Array.isArray(f.o) ? f.o : []) {
      const k = o && typeof o.k === "string" ? o.k : "", x = fin(o && o.x_m), y = fin(o && o.y_m);
      if (!k || x === null || y === null || !o.f) continue;
      const fl = String(o.f);
      let cur = open.get(k);
      if (!cur || cur.run.floor_id !== fl || f.ts - cur.ts > GAP_S) {
        cur = { run: { floor_id: fl, pts: [] }, ts: f.ts };
        open.set(k, cur);
        if (!out.has(k)) out.set(k, []);
        out.get(k).push(cur.run);
      }
      cur.ts = f.ts;
      const last = cur.run.pts[cur.run.pts.length - 1];
      if (last && Math.hypot(x - last.x, y - last.y) < SAME_M) { last.ts = f.ts; continue; }
      cur.run.pts.push({ x, y, ts: f.ts });
    }
  }
  for (const [k, runs] of out) {
    const kept = runs.filter(r => r.pts.length >= 2);
    if (kept.length) out.set(k, kept); else out.delete(k);
  }
  return out;
}

/** How opaque a point that old is (ageS: seconds before now): FADE[0] new, FADE[1] at TRAIL_S. */
export function fadeOf(ageS, windowS = TRAIL_S){
  const t = Math.max(0, Math.min(1, (Number(ageS) || 0) / windowS));
  return FADE[0] + (FADE[1] - FADE[0]) * t;
}

/** The i-th trail's colour. */
export function trailColour(i){
  const n = TRAIL_COLOURS.length;
  return TRAIL_COLOURS[((Number(i) || 0) % n + n) % n];
}
