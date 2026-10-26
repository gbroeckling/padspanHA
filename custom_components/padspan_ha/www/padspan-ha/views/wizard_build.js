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
 *  traced: {mapId, floorId, rooms: [name], scanners: [source], readable}
 *  from maps.js — readable: the plan's placement converts to metres
 *  (tune_save_plan.js tunePlacementReadable, the backend's own test);
 *  scanners: only those Home Assistant hears now, never the demo house's.
 *  Returns {readable, rooms, scanners}: each room and scanner once. */
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
  return { readable: !!t.readable, rooms: once(t.rooms, fabRooms), scanners: once(t.scanners, fabScanners) };
}

const geomPayload = (g) => g.type === "circle"
  ? { type: "circle", cx_m: g.cx_m, cy_m: g.cy_m, r_m: g.r_m }
  : { type: "poly", points_m: g.points_m };

/** Put the missing rooms and scanners into the fabric.
 *  traced: as planHouse's. deps.refresh(): re-reads the model first, so
 *  "missing" is today's, not the page's. deps.planPins(sources): the Tune
 *  planner's answer for those pins across every plan ({writes, invalid,
 *  refused}; a scanner pinned differently on two plans comes back invalid),
 *  from maps.js. Returns {rooms, scanners, failed, notConvertible,
 *  otherPlan}; {notReadable: true} and nothing asked or written for a plan
 *  that doesn't convert to metres. */
export async function buildHouse(ctx, traced, deps){
  if (deps.refresh) await deps.refresh();
  const plan = planHouse(traced, ctx.state.model);
  const out = { rooms: 0, scanners: 0, failed: [], notConvertible: [], otherPlan: [] };
  if (!plan.readable) return { ...out, notReadable: true };
  const floor_id = traced.floorId || "main";

  if (plan.rooms.length) {
    const res = await ctx.actions.wsCall("padspan_ha/fabric_truth_candidates", { floor_id });
    const cand = (res && res.transforms && res.transforms.rooms) || {};
    const have = (res && res.fabric && res.fabric.rooms) || {};   // the server's, as of now
    for (const room of plan.rooms) {
      if (have[room]) continue;                                   // already on the map: never rewritten
      const g = cand[room];
      // The floor's layout takes each room name from one plan (the oldest
      // that has it): a room it takes from ANOTHER plan of this floor is not
      // what was just traced, and is left to Mapping → Rooms.
      if (g && g.source_map_id && g.source_map_id !== traced.mapId) { out.otherPlan.push(room); continue; }
      const usable = g && g.source_map_id === traced.mapId
        && (g.type === "circle" ? Number.isFinite(g.r_m) : Array.isArray(g.points_m) && g.points_m.length >= 3);
      if (!usable) { out.notConvertible.push(room); continue; }
      try {
        await ctx.actions.wsCall("padspan_ha/fabric_correct_room", {
          floor_id, room, geometry: geomPayload(g), source_map_id: traced.mapId,
        });
        out.rooms++;
      } catch (e) { out.failed.push(room); }
    }
  }

  if (plan.scanners.length) {
    const p = deps.planPins(plan.scanners);
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
