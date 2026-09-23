// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
// See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
/**
 * Full house activity — Traceback's PadSpan Pro option (Garry, 2026-09-23).
 *
 * Turning it on swaps Traceback's 3D stack for the Atlas map and plays the
 * whole house back, not just the beacons: every light, door, window, lock and
 * motion sensor as it was at the frame's moment, with the beacons on top in
 * Traceback's own marker style. Traceback's controls drive it unchanged.
 *
 * Nothing new is recorded. Beacon positions are TracebackStore's frames; the
 * house is Home Assistant's own recorder, fetched once per loaded window with
 * history/history_during_period. The Atlas drawing (buildIsoSVG) is a pure
 * function of entity states and a "now", so a frame is drawn by handing it
 * the states rebuilt for that moment and that moment as its now — the same
 * map, fed from history instead of live.
 *
 * The pure helpers are exported for tests; renderHouseFrame is the only
 * piece that needs a browser.
 */

const _q = new URL(import.meta.url).search;
const { buildIsoSVG, fabricFrame } = await import(`./iso_lights.js${_q}`);
const { gatherLights, ensureLightsRegistry } = await import(`./lights_map.js${_q}`);

/** Normalise one HA history row (compressed WS or full REST shape) to ms times. */
function _row(r) {
  if (!r) return null;
  if ("s" in r) {
    const lu = Number(r.lu) * 1000;
    return { t: lu, state: r.s, attributes: r.a, lc: r.lc != null ? Number(r.lc) * 1000 : lu };
  }
  const lu = Date.parse(r.last_updated || r.last_changed);
  return { t: lu, state: r.state, attributes: r.attributes, lc: Date.parse(r.last_changed || r.last_updated) };
}

/**
 * {entity_id: rows[]} → {entity_id: [{t, state, attributes, lc}]} sorted by t.
 * A row without attributes inherits the previous row's (HA omits unchanged ones).
 */
export function buildStateTimeline(history) {
  const out = {};
  for (const [eid, rows] of Object.entries(history || {})) {
    const list = (rows || []).map(_row).filter(r => r && Number.isFinite(r.t)).sort((a, b) => a.t - b.t);
    let attrs = {};
    for (const r of list) {
      if (r.attributes && typeof r.attributes === "object") attrs = r.attributes;
      else r.attributes = attrs;
    }
    if (list.length) out[eid] = list;
  }
  return out;
}

/** The last row at or before tMs (the start-state row covers the window's start). */
function _rowAt(list, tMs) {
  let lo = 0, hi = list.length - 1, best = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (list[mid].t <= tMs) { best = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return best < 0 ? null : list[best];
}

/**
 * hass.states-shaped map for the moment tMs. Entities with no recorder rows
 * (excluded from the recorder) keep their live state — nothing else to show.
 */
export function statesAt(timeline, liveStates, eids, tMs) {
  const out = {};
  for (const eid of eids) {
    const list = timeline[eid];
    const r = list ? _rowAt(list, tMs) : null;
    if (!r) { if (liveStates[eid]) out[eid] = liveStates[eid]; continue; }
    out[eid] = {
      entity_id: eid,
      state: r.state,
      attributes: r.attributes || {},
      last_changed: new Date(r.lc).toISOString(),
      last_updated: new Date(r.t).toISOString(),
    };
  }
  return out;
}

/**
 * Every real state change inside [startMs, endMs] — the side list's events.
 * The first row of each entity is its start-of-window state, not a change.
 */
export function activityEvents(timeline, nameOf, startMs, endMs) {
  const ev = [];
  for (const [eid, list] of Object.entries(timeline)) {
    for (let i = 1; i < list.length; i++) {
      const r = list[i];
      if (r.t < startMs || r.t > endMs) continue;
      if (r.state === list[i - 1].state) continue;      // attribute-only update
      ev.push({ t: r.t, eid, name: nameOf(eid), from: list[i - 1].state, to: r.state });
    }
  }
  return ev.sort((a, b) => a.t - b.t);
}

/**
 * Mark the events Vacation Mode caused (Garry, 2026-09-23): the recorder can't
 * tell its switching from a person's, so vacation_mode.py logs its own. An
 * event is Vacation Mode's when a logged action for the same entity, to the
 * same on/off, came at most `slackMs` before the state change landed.
 * `actions` rows are [epoch_s, entity_id, 1|0]. Mutates and returns `events`.
 */
export function markVacationEvents(events, actions, slackMs = 60000) {
  const byEid = {};
  for (const [ts, eid, on] of actions || []) (byEid[eid] = byEid[eid] || []).push([ts * 1000, on ? "on" : "off"]);
  for (const e of events) {
    const acts = byEid[e.eid];
    e.vacation = !!acts && acts.some(([t, to]) => to === e.to && t <= e.t + 1000 && e.t - t <= slackMs);
  }
  return events;
}

/** True when tMs falls inside a Vacation Mode span ([start_s, end_s|null]). */
export function inVacation(periods, tMs) {
  const t = tMs / 1000;
  return (periods || []).some(([s, e]) => s != null && t >= s && (e == null || t < e));
}

/** Metre centroid of a room, from the fabric's own room geometry. */
function _roomCentroidM(model, room) {
  const g = (model && model.room_geometry_m) || {};
  const key = g[room] ? room : Object.keys(g).find(k => k.toLowerCase() === String(room || "").toLowerCase());
  const r = key && g[key];
  if (!r || !Array.isArray(r.points_m) || r.points_m.length < 3) return null;
  const n = r.points_m.length;
  return {
    x: r.points_m.reduce((a, p) => a + p[0], 0) / n,
    y: r.points_m.reduce((a, p) => a + p[1], 0) / n,
    floor_id: r.floor_id || null,
  };
}

/**
 * One frame's beacons for buildIsoSVG, in Traceback's style: colour, label,
 * room and the last few positions as a trail. A room-only record (no metre
 * fix) sits at its room's centroid, as Traceback's own map places it.
 */
export function beaconsForFrame(frames, idx, model, { keep, colorOf, labelOf, trailLen = 12 } = {}) {
  const f = frames[idx];
  if (!f) return [];
  const posOf = (o) => {
    if (typeof o.x_m === "number" && typeof o.y_m === "number") return { x: o.x_m, y: o.y_m, floor_id: o.f || null };
    return o.r ? _roomCentroidM(model, o.r) : null;
  };
  const out = [];
  for (const o of (f.o || [])) {
    if (!o.k || (keep && !keep(o))) continue;
    const p = posOf(o);
    if (!p) continue;
    const trail = [];
    for (let i = Math.max(0, idx - trailLen); i < idx; i++) {
      const prev = (frames[i].o || []).find(x => x.k === o.k);
      const pp = prev && posOf(prev);
      if (pp && String(pp.floor_id || "") === String(p.floor_id || "")) trail.push([pp.x, pp.y]);
    }
    out.push({
      key: o.k, label: labelOf ? labelOf(o) : (o.n || o.k), room: o.r || "",
      x_m: p.x, y_m: p.y, floor_id: p.floor_id, color: colorOf ? colorOf(o.k) : "#fbbf24", trail,
    });
  }
  return out;
}

/**
 * Fetch the recorder history for every Atlas entity over [startS, endS] and
 * store the timeline on `hs` (Traceback's per-tab state). Resolves when done.
 */
export async function loadHouseHistory(ctx, hs, startS, endS) {
  const live = ctx.hass?.states || {};
  const eids = hs.eids || [];
  hs.loading = true; hs.error = null;
  try {
    const res = eids.length ? await ctx.hass.callWS({
      type: "history/history_during_period",
      start_time: new Date(startS * 1000).toISOString(),
      end_time: new Date(endS * 1000).toISOString(),
      entity_ids: eids,
      include_start_time_state: true,
      significant_changes_only: false,
      minimal_response: false,
      no_attributes: false,
    }) : {};
    hs.timeline = buildStateTimeline(res);
    const nameOf = (eid) => live[eid]?.attributes?.friendly_name || eid;
    hs.events = activityEvents(hs.timeline, nameOf, startS * 1000, endS * 1000);
    // Vacation Mode's own switching and spans — a missing log (older
    // backend) just means nothing is marked.
    const vac = await ctx.actions.wsCall("padspan_ha/vacation_log_get", { start_ts: startS - 60, end_ts: endS })
      .catch(() => ({ actions: [], periods: [] }));
    markVacationEvents(hs.events, vac.actions);
    hs.vacationPeriods = vac.periods || [];
    hs.window = [startS, endS];
  } catch (e) {
    hs.error = String((e && (e.message || e.code)) || e);
    hs.timeline = {}; hs.events = [];
  }
  hs.loading = false;
}

/**
 * The Atlas SVG for one Traceback frame. `hs` carries the registry-derived
 * entity list (hs.eids, filled here on first call) and the loaded timeline.
 */
export function renderHouseFrame(ctx, hs, frames, frameIdx, beaconOpts, onRegistry) {
  const model = ctx.state.model || {};
  const settings = ctx.state.settings || {};
  const floors = model.floors || [];
  if (!ctx.state._lightsRegStore) ctx.state._lightsRegStore = {};
  const reg = ctx.state._modelLoaded
    ? ensureLightsRegistry(ctx.state._lightsRegStore, ctx.hass, model.areas || [], onRegistry)
    : { areaMap: {}, platformMap: {}, loading: true };
  const shapeOverrides = (settings.light_shapes && typeof settings.light_shapes === "object") ? settings.light_shapes : {};
  const typeOverrides = (settings.light_type_overrides && typeof settings.light_type_overrides === "object") ? settings.light_type_overrides : {};
  const live = ctx.hass?.states || {};

  // The Atlas entity set comes from the live house; history fills its states.
  const liveLights = gatherLights(live, reg.areaMap, shapeOverrides, settings.tier, reg.platformMap, typeOverrides, reg.pairMap, reg.manufacturerMap);
  hs.eids = liveLights.map(l => l.entity_id);

  const frame = frames[frameIdx];
  const tMs = frame ? frame.ts * 1000 : Date.now();
  const states = hs.timeline ? statesAt(hs.timeline, live, hs.eids, tMs) : live;
  const lights = gatherLights(states, reg.areaMap, shapeOverrides, settings.tier, reg.platformMap, typeOverrides, reg.pairMap, reg.manufacturerMap, tMs);
  const lightsByEid = {};
  for (const l of lights) lightsByEid[l.entity_id] = l;
  const hidden = new Set(Array.isArray(settings.lights_hidden) ? settings.lights_hidden : []);
  const byRoom = {};
  for (const l of lights) if (l.area_name && !hidden.has(l.entity_id)) (byRoom[l.area_name] = byRoom[l.area_name] || []).push(l);

  const floorGap = ctx.state._overviewFloorGap ?? settings.overview_iso_floor_gap ?? 150;
  const horizGap = ctx.state._overviewHorizGap ?? settings.overview_iso_horiz_gap ?? 0;
  const levels = fabricFrame(model, floors, floorGap, horizGap).levels;
  const isoPos = [null];
  for (let i = 0; i < levels.length; i++) {
    isoPos.push(levels[i]);
    if (i < levels.length - 1) isoPos.push([levels[i], levels[i + 1]]);
  }
  const focusZ = isoPos[Math.max(0, Math.min(ctx.state._overviewIsoFocusIdx ?? 0, isoPos.length - 1))];

  return buildIsoSVG(model, byRoom, hidden, focusZ, floorGap, horizGap, lightsByEid, !!reg.loading, floors, {
    beacons: beaconsForFrame(frames, frameIdx, model, beaconOpts),
    nowMs: tMs,
    haStartedMs: Date.parse(model.ha_started_at) || 0,
    floodLatches: settings.flood_latches || {},
    hideCodes: !!settings.lights_hide_device_codes,
  });
}
