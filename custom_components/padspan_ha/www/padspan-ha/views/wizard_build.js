// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
// See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
//
// "Put it on the map": the Setup Wizard's last step builds the house the
// Overview, the Atlas and positioning draw from (the fabric, in metres) out
// of the floor plan just traced. Before this, finishing the wizard left the
// rooms and scanners on the picture alone: the Overview still had no house
// until someone found Mapping → Rooms → Commit and Calibration → Tune → Save.
//
// Only on that explicit click, and only what the fabric doesn't have yet. A
// floor plan is never written to the fabric as a side effect of another save
// (ws_fabric.py, the f3466fc incident), and a room or scanner the fabric
// already has is never touched here: changing those stays Mapping → Rooms'
// and Calibration → Tune's job. The writes are theirs, unchanged:
//   rooms     fabric_correct_room with the floor's map-placement layout
//             (fabric_truth_candidates' "transforms"), provenance-stamped as
//             Commit stamps an untouched room;
//   scanners  fabric_scanner_position_set, from the Tune planner
//             (tune_save_plan.js tuneDiffMapDraft), missing pins only.
//
// Photo-free (tests/test_photo_divorce.py): the plan editor, maps.js, reads
// the plan and hands in what was traced — the room names and the scanners
// pinned — and a planner for the pins. This module only ever sees the fabric.
// It imports nothing.

/** What was traced that the house (the fabric) doesn't have yet.
 *  traced: {rooms: [name], scanners: [source], measured} from maps.js.
 *  Returns {measured, rooms, scanners}: each room and scanner once. */
export function planHouse(traced, model){
  const t = traced || {}, mdl = model || {};
  const fabRooms = mdl.room_geometry_m || {};
  const fabScanners = mdl.scanner_positions_m || {};
  const once = (list, have) => {
    const seen = new Set(), out = [];
    for (const x of list || []) {
      if (!x || have[x] || seen.has(x)) continue;
      seen.add(x);
      out.push(x);
    }
    return out;
  };
  return { measured: !!t.measured, rooms: once(t.rooms, fabRooms), scanners: once(t.scanners, fabScanners) };
}

const geomPayload = (g) => g.type === "circle"
  ? { type: "circle", cx_m: g.cx_m, cy_m: g.cy_m, r_m: g.r_m }
  : { type: "poly", points_m: g.points_m };

/** Put the missing rooms and scanners into the fabric.
 *  traced: as planHouse's, plus floorId. planPins(sources): the Tune
 *  planner's answer for those pins ({writes, invalid, refused}), from
 *  maps.js. Returns {rooms, scanners, failed: [...], notConvertible: [...]};
 *  {notMeasured: true} and nothing asked or written for a plan with no scale. */
export async function buildHouse(ctx, traced, planPins){
  const plan = planHouse(traced, ctx.state.model);
  const out = { rooms: 0, scanners: 0, failed: [], notConvertible: [] };
  if (!plan.measured) return { ...out, notMeasured: true };
  const floor_id = traced.floorId || "main";

  if (plan.rooms.length) {
    const res = await ctx.actions.wsCall("padspan_ha/fabric_truth_candidates", { floor_id });
    const cand = (res && res.transforms && res.transforms.rooms) || {};
    for (const room of plan.rooms) {
      const g = cand[room];
      const usable = g && (g.type === "circle" ? Number.isFinite(g.r_m) : Array.isArray(g.points_m) && g.points_m.length >= 3);
      if (!usable) { out.notConvertible.push(room); continue; }
      try {
        await ctx.actions.wsCall("padspan_ha/fabric_correct_room", {
          floor_id, room, geometry: geomPayload(g),
          ...(g.source_map_id ? { source_map_id: g.source_map_id } : {}),
        });
        out.rooms++;
      } catch (e) { out.failed.push(room); }
    }
  }

  if (plan.scanners.length) {
    const p = planPins(plan.scanners);
    if (!p || p.refused) out.notConvertible.push(...plan.scanners);
    else {
      out.notConvertible.push(...(p.invalid || []));
      for (const w of p.writes || []) {
        if (!plan.scanners.includes(w.source)) continue;   // never one the fabric already has
        try {
          await ctx.actions.wsCall("padspan_ha/fabric_scanner_position_set", {
            source: w.source, x_m: w.x_m, y_m: w.y_m, floor_id: w.floor_id,
            ...(w.z_m !== undefined ? { z_m: w.z_m } : {}),
          });
          out.scanners++;
        } catch (e) { out.failed.push(w.source); }
      }
    }
  }
  return out;
}
