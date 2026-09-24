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
const { buildIsoSVG, fabricFrame, floorIdAtLevel } = await import(`./iso_lights.js${_q}`);
const { gatherLights, ensureLightsRegistry, lightIsTouched, atlasLookFromSettings, atlasIsoLookOpts,
        sunElevationDeg, ambientFromElevation, sunAmbient } = await import(`./lights_map.js${_q}`);

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
 *
 * The start-of-window row is not a change. HA builds it with lu = the window
 * start and no lc (recorder/history: the start state's timestamps are 0), so
 * taking its lc at face value made every quiet motion sensor read "just
 * triggered" at the start of every playback (review 2026-09-23). Its real
 * last_changed is only known when the entity has not changed since: then the
 * live last_changed is it. Otherwise an "on" row is dated to the window start
 * (it was on then) and anything else to 0 — unknown, drawn as long ago.
 */
export function buildStateTimeline(history, { startMs = null, live = {} } = {}) {
  const out = {};
  for (const [eid, rows] of Object.entries(history || {})) {
    const list = (rows || []).map(_row).filter(r => r && Number.isFinite(r.t)).sort((a, b) => a.t - b.t);
    let attrs = {};
    for (const r of list) {
      if (r.attributes && typeof r.attributes === "object") attrs = r.attributes;
      else r.attributes = attrs;
    }
    const first = list[0];
    if (first && startMs != null && first.t <= startMs + 1) {
      const lv = live[eid];
      const liveLc = lv ? Date.parse(lv.last_changed) : NaN;
      if (lv && lv.state === first.state && Number.isFinite(liveLc) && liveLc <= startMs) {
        first.lc = liveLc;
        // Its last REPORT too, when that was also before the window — the
        // start row is dated to the window start, and a sensor that last
        // reported an hour earlier read as fresh (live check 2026-09-24).
        const liveLu = Date.parse(lv.last_updated);
        if (Number.isFinite(liveLu) && liveLu <= startMs) first.lu = liveLu;
      } else first.lc = first.state === "on" ? startMs : 0;
      first.start = true;
    }
    // Back from an offline gap unchanged: its last real change is still the
    // one before the gap — a reconnect is not motion (live check 2026-09-24:
    // ESPHome reconnects read as "just triggered" for hours).
    let real = null, gap = false;
    for (const r of list) {
      if (r.state === "unavailable" || r.state === "unknown") { gap = real !== null; continue; }
      if (gap && real && r.state === real.state) r.lc = real.lc;
      gap = false;
      real = r;
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
// Attributes that describe what a device IS, not what it was doing: HA has
// not recorded a light's colour, brightness or effect list since 2024.8, so
// a replayed light kept only its name — every WLED lost its class, strips
// their shape, and the codes shifted (live check 2026-09-24). These come from
// the live entity; what it was DOING (colour, brightness) is never borrowed
// from today.
const _WHAT_IT_IS = ["friendly_name", "effect_list", "supported_color_modes", "supported_features",
  "min_color_temp_kelvin", "max_color_temp_kelvin", "min_mireds", "max_mireds", "device_class",
  "unit_of_measurement", "state_class", "icon", "entity_id", "group_entities"];

export function statesAt(timeline, liveStates, eids, tMs) {
  const out = {};
  for (const eid of eids) {
    const list = timeline[eid];
    const r = list ? _rowAt(list, tMs) : null;
    if (!r) {
      // Not recorded (excluded from the recorder), or no row yet at tMs:
      // what it was then is unknown — drawn as unknown, never as today's
      // state under a past timestamp, and never silently missing.
      const lv = liveStates[eid];
      if (lv) out[eid] = { entity_id: eid, state: "unknown", attributes: lv.attributes || {},
        last_changed: new Date(0).toISOString(), last_updated: new Date(0).toISOString() };
      continue;
    }
    const liveA = liveStates[eid]?.attributes || {};
    const recorded = r.attributes && Object.keys(r.attributes).length ? r.attributes : null;
    let attrs;
    if (recorded || eid.startsWith("light.") || eid.startsWith("fan.")) {
      attrs = {};
      for (const k of _WHAT_IT_IS) if (k in liveA) attrs[k] = liveA[k];
      Object.assign(attrs, recorded || {});
    } else attrs = liveA;          // recorded without attributes: they don't change
    out[eid] = {
      entity_id: eid,
      state: r.state,
      attributes: attrs,
      last_changed: new Date(r.lc).toISOString(),
      last_updated: new Date(r.lu ?? r.t).toISOString(),
    };
  }
  return out;
}

/**
 * Every real state change inside [startMs, endMs] — the side list's events.
 * The first row of each entity is its start-of-window state, not a change.
 */
const _NOT_A_CHANGE = new Set(["unavailable", "unknown"]);
export function isEventEntity(eid) {
  // A numeric sensor's every reading is a "state change" — thousands a week
  // that buried every door and light in the list (review 2026-09-23).
  return !String(eid).startsWith("sensor.");
}
export function activityEvents(timeline, nameOf, startMs, endMs) {
  const ev = [];
  for (const [eid, list] of Object.entries(timeline)) {
    if (!isEventEntity(eid)) continue;
    // Compare each real state with the last REAL state before it, so an
    // "off → unavailable → on" still reads as the off → on it was
    // (re-review 2026-09-23: skipping both sides of a gap lost the change).
    let prev = null;
    for (let i = 0; i < list.length; i++) {
      const r = list[i];
      if (_NOT_A_CHANGE.has(r.state)) continue;
      if (i > 0 && prev !== null && r.state !== prev && r.t >= startMs && r.t <= endMs) {
        ev.push({ t: r.t, eid, name: nameOf(eid), from: prev, to: r.state });
      }
      prev = r.state;
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

/**
 * Traceback only records a frame while a tracked object is home, so playback
 * over beacon frames alone could never show the house while it was empty —
 * the very case the 🌴 marking exists for. With house activity on, every
 * house event gets a frame of its own, at the event's exact moment (a frame
 * rounded to the second could land before the change and draw the old
 * state — re-review 2026-09-23).
 *
 * A synthetic frame carries the beacons of the last real frame while the gap
 * is no longer than the beacon cadence itself — beacon frames arrive ~10 s
 * apart, but a long range comes back evenly thinned (get_frames), so a fixed
 * 30 s made everyone vanish on every event of a week's replay. Past that
 * bound nobody is drawn: nobody was recorded.
 */
export function mergeHouseFrames(rawFrames, events, thinFactor = 1) {
  const have = new Set(rawFrames.map(f => f.ts));
  const extra = [];
  for (const e of events || []) {
    const ts = e.t / 1000;
    if (have.has(ts)) continue;
    have.add(ts);
    extra.push({ ts, o: null, house: true });
  }
  if (!extra.length) return rawFrames.slice();
  // Beacons are recorded at the presence poll (1-60 s, the coordinator's
  // clamp), so 1.5 x the typical gap bounds "still there" — but never more
  // than 1.5 x 60 s times however much the backend THINNED the list: a tag
  // seen twice an hour apart has a one-hour "gap" that is really an absence
  // (rounds 3 and 4).
  const gaps = [];
  for (let k = 1; k < rawFrames.length; k++) gaps.push(rawFrames[k].ts - rawFrames[k - 1].ts);
  gaps.sort((a, b) => a - b);
  const median = gaps.length ? gaps[gaps.length >> 1] : 0;
  const cap = 90 * Math.max(1, Number(thinFactor) || 1);
  const carryS = Math.max(30, Math.min(1.5 * median, cap));
  const all = [...rawFrames, ...extra].sort((a, b) => a.ts - b.ts);
  let last = null;
  for (const f of all) {
    if (!f.house) { last = f; continue; }
    f.o = last && f.ts - last.ts <= carryS ? last.o : [];
  }
  return all;
}

/**
 * The Atlas's own floor-focus positions (All, each floor, each adjacent
 * pair) and labels — the same list lights_map.js builds. Traceback's slider
 * indexes photo z_levels; the Atlas drawn in house mode has fabric floors,
 * which can differ (review 2026-09-23: "Floor 1" focused the basement).
 */
export function atlasFocusPositions(model, floorGap = 150, horizGap = 0) {
  const floors = (model && model.floors) || [];
  const frame = fabricFrame(model || {}, floors, floorGap, horizGap);
  const levels = frame.levels;
  const positions = [null];
  for (let i = 0; i < levels.length; i++) {
    positions.push(levels[i]);
    if (i < levels.length - 1) positions.push([levels[i], levels[i + 1]]);
  }
  const labelOf = (idx) => {
    const pos = positions[Math.max(0, Math.min(idx, positions.length - 1))];
    if (pos === null) return "All floors";
    return (Array.isArray(pos) ? pos : [pos])
      .map(z => { const fid = floorIdAtLevel(frame, model, floors, z); const f = floors.find(x => String(x.id) === fid);
        return f ? (f.name || `L${z}`) : `L${z}`; }).join(" + ");
  };
  return { positions, labelOf };
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
 * store the timeline on `hs` (Traceback's per-tab state). hs.pending is the
 * in-flight promise, so a Traceback re-mounted mid-fetch can wait on it too.
 *
 * Two requests (review 2026-09-23: one full-attribute request over every
 * Atlas entity for 7 days ran to tens of MB): lights and fans with their
 * attributes (colour, brightness), everything else state-only — its
 * attributes (device_class, unit) do not change and come from the live
 * entity in statesAt.
 */
export function loadHouseHistory(ctx, hs, startS, endS) {
  const live = ctx.hass?.states || {};
  const eids = hs.eids || [];
  const rich = eids.filter(e => e.startsWith("light.") || e.startsWith("fan."));
  const lean = eids.filter(e => !(e.startsWith("light.") || e.startsWith("fan.")));
  const base = {
    type: "history/history_during_period",
    start_time: new Date(startS * 1000).toISOString(),
    end_time: new Date(endS * 1000).toISOString(),
    include_start_time_state: true,
  };
  const call = (ids, extra) => ids.length ? ctx.hass.callWS({ ...base, entity_ids: ids, ...extra }) : Promise.resolve({});
  // A new window starts empty: the old window's timeline would draw live
  // states (before its first row) and list the old events meanwhile.
  hs.timeline = null; hs.events = []; hs.vacationPeriods = [];
  hs.loading = true; hs.error = null; hs.window = [startS, endS];
  hs.pending = (async () => {
    try {
      const [a, b] = await Promise.all([
        call(rich, { significant_changes_only: false, minimal_response: false, no_attributes: false }),
        call(lean, { significant_changes_only: true, minimal_response: true, no_attributes: true }),
      ]);
      hs.timeline = buildStateTimeline({ ...a, ...b }, { startMs: startS * 1000, live });
      const nameOf = (eid) => live[eid]?.attributes?.friendly_name || eid;
      hs.events = activityEvents(hs.timeline, nameOf, startS * 1000, endS * 1000);
      // Vacation Mode's own switching and spans — a missing log (older
      // backend) just means nothing is marked.
      const vac = await ctx.actions.wsCall("padspan_ha/vacation_log_get", { start_ts: startS - 60, end_ts: endS })
        .catch(() => ({ actions: [], periods: [] }));
      markVacationEvents(hs.events, vac.actions);
      hs.vacationPeriods = vac.periods || [];
    } catch (e) {
      // No timeline: the map draws no device states rather than today's
      // under a past timestamp. The status line offers a retry.
      hs.error = String((e && (e.message || e.code)) || e);
      hs.timeline = null; hs.events = [];
    }
    hs.loading = false;
    hs.version = (hs.version || 0) + 1;
  })();
  return hs.pending;
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
  // Both gathers are side-effect free: this is a replay, not the house now.
  const liveLights = gatherLights(live, reg.areaMap, shapeOverrides, settings.tier, reg.platformMap, typeOverrides, reg.pairMap, reg.manufacturerMap, undefined, true);
  hs.eids = liveLights.map(l => l.entity_id);
  hs.regLoading = !!reg.loading;

  const frame = frames[frameIdx];
  const tMs = frame ? frame.ts * 1000 : Date.now();
  // Until history is in (or when it failed), no device states at all —
  // never today's states under a past timestamp.
  const states = hs.timeline ? statesAt(hs.timeline, live, hs.eids, tMs) : {};
  const lights = gatherLights(states, reg.areaMap, shapeOverrides, settings.tier, reg.platformMap, typeOverrides, reg.pairMap, reg.manufacturerMap, tMs, true);
  const lightsByEid = {};
  for (const l of lights) lightsByEid[l.entity_id] = l;
  const hidden = new Set(Array.isArray(settings.lights_hidden) ? settings.lights_hidden : []);
  const byRoom = {};
  for (const l of lights) if (l.area_name && !hidden.has(l.entity_id)) (byRoom[l.area_name] = byRoom[l.area_name] || []).push(l);
  // The Atlas tab's own look (Garry, 2026-09-23: "should match the atlas tab
  // settings and look") — the same reading the Atlas panel makes. Its
  // "hide untouched" filter hides on the drawing only, as there. Daylight is
  // the replayed moment's sun, from the house's own location.
  const look = atlasLookFromSettings(settings);
  const hiddenOnMap = look.hideUntouched
    ? new Set([...hidden, ...lights.filter(l => !lightIsTouched(l, shapeOverrides, model.light_positions_m || {})).map(l => l.entity_id)])
    : hidden;
  const lat = Number(ctx.hass?.config?.latitude), lon = Number(ctx.hass?.config?.longitude);
  const ambient = Number.isFinite(lat) && Number.isFinite(lon) && ctx.hass?.config?.latitude != null
    ? ambientFromElevation(sunElevationDeg(lat, lon, tMs)) : sunAmbient(ctx.hass);

  const floorGap = ctx.state._overviewFloorGap ?? settings.overview_iso_floor_gap ?? 150;
  const horizGap = ctx.state._overviewHorizGap ?? settings.overview_iso_horiz_gap ?? 0;
  const { positions } = atlasFocusPositions(model, floorGap, horizGap);
  const focusZ = positions[Math.max(0, Math.min(hs.focusIdx ?? 0, positions.length - 1))];
  // The boot moment only explains a last_changed in frames after that boot;
  // earlier frames get no boot gate (it would silence their real motion).
  const startedMs = Date.parse(model.ha_started_at) || 0;

  return buildIsoSVG(model, byRoom, hiddenOnMap, focusZ, floorGap, horizGap, lightsByEid, !!reg.loading, floors, {
    ...atlasIsoLookOpts(look, ambient),
    beacons: beaconsForFrame(frames, frameIdx, model, beaconOpts),
    nowMs: tMs,
    haStartedMs: tMs >= startedMs ? startedMs : 0,
    floodLatches: settings.flood_latches || {},
  });
}
