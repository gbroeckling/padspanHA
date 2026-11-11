// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
// See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
//
// Rooms from plans' outlines as one flat list, shared by Live Aboard's Plans
// tool (live_aboard_plans.js) and the rooms helper (ai_wizard.js), so the two
// can't drift. Pure; no imports, so the helper loads nothing of Live Aboard.

/** {id, kind, pts, name} for each outline: his room as it is ("his"), the
 *  room as read ("ready" where the reads agree, "look" where they don't, "dim"
 *  with read 1 and 2 beside it while `both` is that room), and each space not
 *  joined into another. */
export function roomShapes(prop, opts = {}) {
  const p = prop || {}, out = [], both = opts.both;
  for (const r of Object.values(p.rooms || {})) {
    out.push({ id: r.id, kind: "his", pts: r.now_m });
    out.push({ id: r.id, kind: both === r.room ? "dim" : (r.ready ? "ready" : "look"), pts: r.outline_m, name: r.room });
    if (both === r.room) (r.reads_m || []).forEach((q, i) => { if (q) out.push({ id: r.id, kind: i ? "r2" : "r1", pts: q }); });
  }
  for (const s of Object.values(p.spaces || {})) if (!s.merged_into) out.push({ id: s.id, kind: "space", pts: s.outline_m, name: s.new || s.name });
  return out;
}
