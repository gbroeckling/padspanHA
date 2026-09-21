// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
// See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
//
// THE shared Lights view — data pipeline, map card (controls + iso SVG) and
// light index table used by BOTH the Lights sidebar panel and the
// Mapping → Lights tab. The sidebar DISPLAYS the house-lights representation;
// the Mapping tab BUILDS it — so the two must show the identical map: same
// maps, same rooms, same hexes, same codes, same controls, same table.
// Everything either view renders comes from here; the hosts differ only in
// what an interaction does (sidebar: control the light — tab: place it).

const { buildIsoSVG, shapeSvg, fabricFrame, sampleSceneField, pointInPolygon, offsetPolygonInward,
        lightClassOf, SHOWCASE_THEMES, AUTOMORPH_STYLE_LABELS, floodLatchActive } =
  await import(`./iso_lights.js${new URL(import.meta.url).search}`);
const { assignLightCodes, resolveLightShape, LIGHT_SHAPES, LIGHT_TYPE_OVERRIDES,
        TEMP_BORDER, healthOf,
        AIR_QUALITY_CLASSES, AIR_BORDER, airQualityBadness, airQualityWord, isAirQualityEntity,
        classBorder, isControllable, hasFixedGlyph, isAtlasEntity, inWholeHousePresets } =
  await import(`./light_codes.js${new URL(import.meta.url).search}`);
const { tierAtLeast } =
  await import(`./editions.js${new URL(import.meta.url).search}`);

// ── What a tier is shown ─────────────────────────────────────────────────────
// Below `bright` — PadSpan HA with no key, PadSpan Bright with no key — the
// lights map is rooms, floors and one default marker per light, clustered at
// its room centre. Placement, fixture shape, size and rotation, the W-series
// (WLED) distinction, Showcase, Fit room and Hide untouched are what a key
// buys: PadSpan Bright Pro or PadSpan Pro, one ladder (editions.js).
//
// This is a READ-TIME override of the inputs the renderer is handed. It
// copies; it never writes. Every placement a house already built stays in the
// fabric byte for byte and comes straight back the moment a key is entered —
// tests/test_lights_free_gate.py holds both functions below to that. Built as
// a filter on STORED data instead, a lapsed licence would delete a weekend's
// work; that is the one way this must never be done.
//
// An unknown or missing tier is free — the safe side. Both hosts pass the
// tier the backend computed (settings.tier); nothing here re-derives it.
export const LIGHTING_TIER = "bright";
export const lightingUnlocked = (tier) => tierAtLeast(tier, LIGHTING_TIER);

/**
 * The host as the tier sees it. Paid: the host untouched. Free: the fabric's
 * light positions withheld (every light clusters in its room), the
 * presentation modes off and their controls absent, the untouched filter off.
 * The host's own objects are never mutated — the model is shallow-copied
 * with a fresh, empty light_positions_m.
 */
export function lightsHostForTier(host){
  if (lightingUnlocked(host.tier)) return host;
  return {
    ...host,
    model: host.model ? { ...host.model, light_positions_m: {} } : host.model,
    showcase: false, onShowcase: null,
    fitRooms: false, onFitRooms: null,
    hideUntouched: false, untouchedCount: 0, onHideUntouched: null,
    onTypeOverride: null, typeOverrides: {},
    isolux: false, onIsolux: null,
    automorph: false, onAutomorph: null, automorphRoomPct: 0, onAutomorphRoomPct: null,
    automorphHardness: 0, onAutomorphHardness: null,
    automorphStyle: "glow", onAutomorphStyle: null,
    automorphSubtlety: 0, onAutomorphSubtlety: null,
    sceneName: null, onScene: null, onSceneAngle: null, onSceneApply: null,
    rippleArmed: false, onRipple: null, onRippleFire: null,
    // Placement is paid, so the placement queue is too. And at free EVERY
    // light is unplaced by construction — collapsing the piles would turn
    // the free map into a row of "N unplaced" chips with no lights on it.
    onPlaceRow: null, placeQueue: null, collapseUnplaced: false,
    hiddenEidsMap: host.hiddenEids,
  };
}

// ── Spatial scenes ───────────────────────────────────────────────────────────
// A scene is a colour FIELD across the floor, not a list: each fixture takes
// the field's colour at its own metres (sampleSceneField in iso_lights.js —
// preview and apply share it, so the map never promises a colour the lights
// don't get). Stops run along the field's angle, whole-floor.
export const SCENE_FIELDS = {
  Sunset: { stops: [[255,147,41],[255,94,58],[64,78,160]] },
  Dusk:   { stops: [[120,140,255],[70,80,160],[25,30,70]] },
  Ember:  { stops: [[255,120,30],[210,60,25],[120,20,40]] },
  Ocean:  { stops: [[40,200,190],[30,120,200],[20,60,140]] },
};
export const SCENE_NAMES = Object.keys(SCENE_FIELDS);
export function sceneFieldFor(name, angleDeg){
  const f = SCENE_FIELDS[name];
  return f ? { stops: f.stops, angleDeg: Number(angleDeg)||0 } : null;
}

// ── Last dimmed level ────────────────────────────────────────────────────────
// HA drops the `brightness` attribute the moment a light turns off, so "turn
// it back on at the level it was dimmed to" needs a memory. gatherLights
// records every ON light's brightness as it passes; the toggle paths read it
// back when switching off→on. Best-effort persisted so it survives a reload;
// everything is guarded because this module also runs under node in tests
// and localStorage can be absent or full.
const _LAST_BRI_KEY = "padspan_ha_last_bri";
let _lastBri = null;
function _briStore(){
  if (_lastBri) return _lastBri;
  _lastBri = {};
  try { Object.assign(_lastBri, JSON.parse(localStorage.getItem(_LAST_BRI_KEY) || "{}")); } catch (_) {}
  return _lastBri;
}
function _recordBrightness(eid, bri){
  const s = _briStore();
  if (s[eid] === bri) return;
  s[eid] = bri;
  try { localStorage.setItem(_LAST_BRI_KEY, JSON.stringify(s)); } catch (_) {}
}
export function lastBrightness(eid){
  const v = _briStore()[eid];
  return typeof v === "number" && v >= 1 && v <= 255 ? v : null;
}

// ── Optimistic state ─────────────────────────────────────────────────────────
// A tap flips the marker NOW and the map reconciles on the next state. Waiting
// for HA's round-trip (Zigbee, Z-Wave, a cloud bulb) reads as a missed tap and
// invites a second one that undoes the first. The overlay is a short-lived
// claim: it wins over the reported state until HA agrees with it or it times
// out, whichever first — so a bulb that never answered falls back to the
// truth by itself, and a host that saw the service call FAIL clears it at
// once (and shakes the marker). Module-level like the brightness memory, so
// both views agree on what was just pressed.
const _optimistic = new Map();   // eid -> { state, until }
export const OPTIMISTIC_TTL_MS = 2500;
export function setOptimistic(eid, state, now = Date.now()){
  _optimistic.set(eid, { state, until: now + OPTIMISTIC_TTL_MS });
}
export function clearOptimistic(eid){ _optimistic.delete(eid); }
// The state a light should be DRAWN in: the claim while it stands, otherwise
// what HA reports. Reconciles (drops the claim) the moment HA catches up.
export function effectiveState(eid, reported, now = Date.now()){
  const o = _optimistic.get(eid);
  if (!o) return { state: reported, optimistic: false };
  if (o.until < now || reported === o.state) { _optimistic.delete(eid); return { state: reported, optimistic: false }; }
  return { state: o.state, optimistic: true };
}

// The primary tap action — flip a light/fan/strip on or off, lock/unlock a
// lock, refuse a read-only sensor — shared by both hosts (the sidebar's own
// _toggle and the builder's Preview-as-sidebar/marker-tap toggle used to be
// two independently hand-maintained copies; the builder's had never grown
// the lock branch, so a lock's Turn On/Off button called `lock.turn_on` —
// not a real HA service — and always failed). One copy, one lock branch,
// one read-only-sensor message.
export async function toggleEntity(hass, eid, { render, toast, shake } = {}){
  if (!hass) return;
  // Service domain is the entity's own: light.* -> light, fan.* -> fan.
  const domain = String(eid).split(".")[0];
  if (domain === "binary_sensor") { if (toast) toast("Sensors are read-only"); return; }
  if (domain === "sensor") { if (toast) toast("Temperature, humidity and air quality sensors are read-only"); return; }
  // lock.* has no on/off at all — "locked" is its normal state, lock/unlock
  // its services.
  const isLockDomain = domain === "lock";
  // The EFFECTIVE state, not the raw HA one (Garry, 2026-09-11: a second tap
  // inside the same optimistic window re-decided from state that hadn't
  // caught up yet, so it silently repeated the first command instead of
  // reversing it) — prefers the standing optimistic claim over a reported
  // state that hasn't reconciled, so each tap toggles relative to what the
  // marker is ACTUALLY showing.
  const eff = effectiveState(eid, hass.states[eid]?.state).state;
  const on = isLockDomain ? eff === "locked" : eff === "on";
  // Optimistic: the marker flips NOW (this claim is read by both views, so
  // the index row flips with it), and HA's next state reconciles it.
  setOptimistic(eid, isLockDomain ? (on ? "unlocked" : "locked") : (on ? "off" : "on"));
  if (render) render();
  try {
    // Off->on restores the level it was dimmed to — HA drops `brightness`
    // while a light is off, so this comes from the shared memory above; a
    // light that never reported one (or a switch, or a fan) sends none.
    const data = { entity_id: eid };
    if (!on && domain === "light") {
      const bri = lastBrightness(eid);
      if (bri !== null) data.brightness = bri;
    }
    const svc = isLockDomain ? (on ? "unlock" : "lock") : (on ? "turn_off" : "turn_on");
    await hass.callService(domain, svc, data);
    setTimeout(() => { if (render) render(); }, 600);
  } catch (e) {
    clearOptimistic(eid);
    if (render) render();
    if (shake) shake(eid);
    if (toast) toast("Could not toggle " + eid, true);
  }
}

// ── Device classes on the map ────────────────────────────────────────────────
// The layer chips: the map keeps every class in view and DIMS the others,
// because a fan's place on the ceiling is context for the light beside it.
export const LIGHT_CLASSES = [["all","All"],["light","Lights"],["strip","Strips"],["fan","Fans"],["motion","Motion"],["temp","Temps"],["humidity","Humidity"],["air","Air"],["lock","Locks"],["door","Doors/Windows"],["flood","Emergency"]];

// Automorph's style dropdown vocabulary — derived from AUTOMORPH_STYLE_LABELS
// itself (iso_lights.js) rather than a hand-copied list. A style added there
// used to also need updating here AND in the validation array iso_lights.js
// checked opts.automorphStyle against — miss either and the new style's
// if-block became unreachable with no error, exactly what happened while
// building the 9 shape styles below "glow"/"pulse". One registry now feeds
// both.
export const AUTOMORPH_STYLES = Object.entries(AUTOMORPH_STYLE_LABELS);
// Showcase's theme dropdown vocabulary — derived from SHOWCASE_THEMES itself
// (iso_lights.js) rather than a hand-copied list, so a theme added there
// shows up here for free and can never drift out of sync on the name/label.
export const SHOWCASE_THEME_OPTIONS = Object.entries(SHOWCASE_THEMES).map(([key, t]) => [key, t.label]);
export { lightClassOf };
export function classMatches(l, cls){ return !cls || cls === "all" || lightClassOf(l) === cls; }

// The index/room-sheet text for an air-quality reading: "1450 ppm · Poor".
export function airQualityLabel(l){
  // An enum sensor's own word, as it grades itself: "Moderate".
  if (typeof l.air_level === "string" && l.air_level && !/^(unknown|unavailable|none)$/.test(l.air_level)) {
    const w = l.air_level.replace(/_/g, " ");
    return w.charAt(0).toUpperCase() + w.slice(1);
  }
  if (!Number.isFinite(l.air_value)) return "—";
  const v = Math.abs(l.air_value) >= 100 ? Math.round(l.air_value) : Math.round(l.air_value * 10) / 10;
  return `${v}${l.air_unit ? " " + l.air_unit : ""} · ${airQualityWord(airQualityBadness(l))}`;
}

// ── Room and floor aggregates ────────────────────────────────────────────────
// What a room sheet says: lights and fans counted SEPARATELY (so "all off"
// is never ambiguous about the fan), motion summarised. The eids handed back
// are what the aggregate actions act on.
// The counting pass roomAggregate and floorAggregate both need — they used
// to independently hand-filter by flag (l.isFan, l.isMotion, l.isAir,
// l.isFlood) with different code computing the same five numbers two ways
// (found in the Phase 2a registry audit, 2026-09-19; the direct root cause
// of the openFloorSheet item-list bug fixed the same day — floorAggregate's
// OWN copy never grew door/temp/humidity/lock at all). One pass, one
// source of the field names every consumer (openRoomSheet, openFloorSheet)
// already reads.
function _aggregateCounts(here, floodLatches){
  const lightsHere = here.filter(l => lightClassOf(l) === "light" || lightClassOf(l) === "strip");
  const fansHere = here.filter(l => l.isFan);
  const motionHere = here.filter(l => l.isMotion);
  const airHere = here.filter(l => l.isAir);
  const floodHere = here.filter(l => l.isFlood);
  return {
    lightsOn: lightsHere.filter(l => l.state === "on").length, lightsTotal: lightsHere.length,
    fansOn: fansHere.filter(l => l.state === "on").length, fansTotal: fansHere.length,
    motionActive: motionHere.filter(l => l.state === "on").length, motionTotal: motionHere.length,
    // Air quality: the worst reading (NaN = none reporting).
    airTotal: airHere.length, airWorst: airWorstOf(airHere),
    // Flood: binary, not a badness scale — how many are actively alarming
    // right now, live OR latched (flood_latch.py) — a sensor that dried out
    // but is still within its 2-day window must keep counting here, the
    // same reasoning as the ALARM label stateWordOf gives it.
    floodTotal: floodHere.length, floodActive: floodHere.filter(l => floodIsAlarming(l, floodLatches)).length,
    lightEids: lightsHere.map(l => l.entity_id), fanEids: fansHere.map(l => l.entity_id),
  };
}
export function roomAggregate(lights, roomName, floodLatches){
  const here = (lights || []).filter(l => l.area_name === roomName);
  return { room: roomName, ..._aggregateCounts(here, floodLatches), all: here };
}
// Mirrors const.OUTDOOR_FLOOR_NAMES / presence_rules.is_outdoor_floor: the
// fabric's "__outside__" sentinel, the registry's "outside", and the plain
// names people give a garden. An outdoor "floor" is not a storey.
export function isOutdoorFloorId(fid){
  const k = String(fid || "").trim().toLowerCase().replace(/\s+/g, "_");
  return k === "__outside__" || k === "outside" || k === "outdoor" || k === "outdoors"
      || k === "exterior" || k === "garden" || k === "yard";
}
// A device's floor: the room it is in (the fabric's room → floor), else the
// floor it was placed on. A device with neither is on no floor.
//
// An OUTDOOR room does not anchor (Garry, 2026-09-14: devices "registered to
// the outside level" could not be placed "on a floor, just outside a room").
// Outdoors is not a storey and the Lights stack never draws it (fabricFrame
// drops outdoor rooms and lights before the levels are built), so a device
// whose only claim to a floor was "Shed" had no marker to grab and every
// placement path wrote it straight back onto __outside__ — it could never
// reach the map at all. Its stored placement wins instead: drop it on a real
// floor's plate beside the room it lives outside of, and that is where it
// draws. Never placed, it stays on the outside level exactly as before, so
// nothing already saved moves.
export function lightFloorId(l, model){
  const geo = (model && model.room_geometry_m) || {};
  const g = l.area_name && geo[l.area_name];
  const roomFid = g && g.floor_id ? String(g.floor_id) : null;
  if (roomFid && !isOutdoorFloorId(roomFid)) return roomFid;
  const p = ((model && model.light_positions_m) || {})[l.entity_id];
  if (p && p.floor_id) return String(p.floor_id);
  return roomFid;
}
export function floorAggregate(lights, model, floorId, floodLatches){
  const here = (lights || []).filter(l => lightFloorId(l, model) === String(floorId));
  return { floorId: String(floorId), ..._aggregateCounts(here, floodLatches) };
}
// The worst air-quality badness among these sensors, NaN when none reports.
export function airWorstOf(airLights){
  let worst = NaN;
  for (const l of airLights || []) {
    const b = airQualityBadness(l);
    if (Number.isFinite(b) && !(worst >= b)) worst = b;
  }
  return worst;
}
// ── Whole House Presets ─────────────────────────────────────────────────────────────
// Garry, 2026-09-21: "a pull down like presets, but call whole house presets.
// There will be a set, and a name on it. It will remember every setting in
// the house when set is hit, and bring all settings back when selected."
// A named snapshot of real DEVICE state — not the map's look (that is the
// Showcase Presets bar). Shared here so the Mapping tab and the sidebar
// capture and restore identically. Entities are kept in exactly the shape
// HA's own scene.apply takes, so restoring is ONE native service call and
// HA, not PadSpan, works out how to get each light/fan back there.
const _WHP_DOMAIN = /^(?:light|fan)\./;
// A light's colour lives under whichever attribute its CURRENT color_mode
// names; saving the others too would hand scene.apply a contradiction.
const _WHP_COLOR_ATTR = { hs: "hs_color", xy: "xy_color", rgb: "rgb_color", rgbw: "rgbw_color",
                          rgbww: "rgbww_color", color_temp: "color_temp_kelvin" };

// What Set remembers: every eligible device (DEVICE_CLASSES.inPresets — real
// lights and fans, never a lock) that is plainly on or off right now. An
// unavailable device has no state worth restoring and is counted, not stored.
export function captureWholeHouse(lights, states){
  const entities = {}; let skipped = 0;
  for (const l of lights || []) {
    const eid = l && l.entity_id;
    if (!eid || !inWholeHousePresets(l) || !_WHP_DOMAIN.test(eid)) continue;
    const st = states && states[eid];
    if (!st || (st.state !== "on" && st.state !== "off")) { skipped++; continue; }
    if (st.state === "off") { entities[eid] = { state: "off" }; continue; }
    const a = st.attributes || {}, e = { state: "on" };
    if (eid.startsWith("light.")) {
      if (typeof a.brightness === "number") e.brightness = a.brightness;
      if (typeof a.color_mode === "string") {
        e.color_mode = a.color_mode;
        const k = _WHP_COLOR_ATTR[a.color_mode];
        if (k && a[k] != null) e[k] = a[k];
      }
      // Only an effect the light itself lists can be asked for again.
      if (typeof a.effect === "string" && Array.isArray(a.effect_list) && a.effect_list.includes(a.effect)) e.effect = a.effect;
    } else {
      if (typeof a.percentage === "number") e.percentage = a.percentage;
      if (typeof a.preset_mode === "string" && a.preset_mode) e.preset_mode = a.preset_mode;
      if (typeof a.oscillating === "boolean") e.oscillating = a.oscillating;
      if (a.direction === "forward" || a.direction === "reverse") e.direction = a.direction;
    }
    entities[eid] = e;
  }
  return { entities, count: Object.keys(entities).length, skipped };
}

// Bring a saved preset back. The light./fan. test is the client-side twin of
// the backend sanitizer's allowlist — a preset can never drive any other
// domain even from hand-edited storage. A device that is gone or unavailable
// right now is skipped and counted rather than failing the whole call.
export async function applyWholeHouse(hass, preset){
  const entities = {}; let skipped = 0;
  for (const [eid, s] of Object.entries((preset && preset.entities) || {})) {
    if (!_WHP_DOMAIN.test(eid) || !s || (s.state !== "on" && s.state !== "off")) continue;
    const live = hass && hass.states && hass.states[eid];
    if (!live || live.state === "unavailable") { skipped++; continue; }
    entities[eid] = s;
  }
  const applied = Object.keys(entities).length;
  if (applied) await hass.callService("scene", "apply", { entities });
  return { applied, skipped };
}

// ── Layout v2 (Garry, 2026-09-21) ──────────────────────────────────────────────
// "the left to right use of space was often empty due to bad planning, the
// program should read the resolution of the monitor, and stack more in a
// row so less scrolling is needed." Driven by the panel's MEASURED width
// (ResizeObserver), not screen.width: the HA sidebar, PadSpan's own sidebar
// and a non-maximised window all take width the monitor's resolution never
// mentions. Reversible as a whole: settings.atlas_layout_v2 (host.layoutV2)
// — off, and every line below is skipped and the classic layout is
// byte-for-byte what it was.
export function layoutTierFor(widthPx){
  const w = Number(widthPx) || 0;
  return w < 900 ? "narrow" : w < 1500 ? "medium" : w < 2300 ? "wide" : "ultra";
}
// The drawing is taller than it is wide, and classic sizing pins it to the
// stage's WIDTH — so the wider the monitor, the taller the map and the more
// there is to scroll. v2 fits the whole house in the space actually on
// screen: the width at which the drawing is no taller than availH, never
// wider than the stage. Zoom multiplies from there, so "100%" means "the
// whole house, no scrolling".
export function fitWidthPx(stageW, availH, vbW, vbH){
  if (!(stageW > 0) || !(availH > 0) || !(vbW > 0) || !(vbH > 0)) return 0;
  return Math.max(160, Math.min(stageW, availH * vbW / vbH));
}
// Which folds are open is a per-browser habit, not a house setting.
const _foldOpen = (name) => { try { return localStorage.getItem("padspan_lv_fold_" + name) === "1"; } catch (_) { return false; } };
const _foldSave = (name, open) => { try { localStorage.setItem("padspan_lv_fold_" + name, open ? "1" : "0"); } catch (_) {} };

// One flood sensor's alarm state — live wet, OR still within its
// flood_latch.py latch window. The single place this "live OR latched"
// check lives, so the aggregate counts, the row labels and the Reset
// button's visibility can never quietly disagree with each other.
export function floodIsAlarming(l, floodLatches){
  if (l.state === "on") return true;
  const latch = (floodLatches || {})[l.entity_id];
  return floodLatchActive(latch && latch.triggered_at, Date.now());
}

// One class-driven answer to "what does this entity's state read as, and is
// it lit/active" — openAggregateSheet's render chain, buildLightsTable's
// render chain, and buildLightsTable's own separate sort-key chain each
// used to answer this with their own hand-written per-class if/else (found
// in the Phase 2a registry audit, 2026-09-19 — two live bugs already
// shipped from the three copies disagreeing: a locked lock read "Off" in
// one chain that had no lock branch, and the flood latch was invisible to
// the sort key in another).
//
// Returns null for the CONTROLLABLE classes without their own special word
// (light/wled/partition/fan) — those keep building their own generic
// On/Off (+ optional Controls "⋯") button, unchanged; lock IS controllable
// but has its own word (LOCKED/UNLOCKED/JAMMED) and its own Lock/Unlock
// button, so it's handled here like the read-only classes are.
//
// `locked`/`latched` are handed back, not baked into a button, because the
// two hosts build that button in genuinely different DOM idioms (mk() vs
// el()) — unifying the WORD and the SORT VALUE retires the actual
// duplicated logic; the markup stays each host's own.
export function stateWordOf(l, floodLatches){
  if (l.isMotion) {
    const on = l.state === "on";
    return { text: on ? "MOTION" : "clear", lit: on, sortValue: on ? 1 : 0 };
  }
  if (l.isLock) {
    const jammed = l.state === "jammed";
    const locked = l.state === "locked";
    return { text: jammed ? "JAMMED" : (locked ? "LOCKED" : "UNLOCKED"), lit: !jammed && locked, sortValue: locked ? 1 : 0, locked };
  }
  if (l.isTemp) {
    const v = Number.isFinite(l.temperature) ? l.temperature : null;
    return { text: v !== null ? `${v}°` : "—", lit: false, sortValue: v !== null ? v : -Infinity };
  }
  if (l.isHumidity) {
    const v = Number.isFinite(l.humidity) ? l.humidity : null;
    return { text: v !== null ? `${v}%` : "—", lit: false, sortValue: v !== null ? v : -Infinity };
  }
  if (l.isAir) {
    const b = airQualityBadness(l);
    return { text: airQualityLabel(l), lit: false, sortValue: Number.isFinite(b) ? b : -Infinity };
  }
  if (l.isDoor) {
    const on = l.state === "on";
    return { text: on ? "OPEN" : "CLOSED", lit: on, sortValue: on ? 1 : 0 };
  }
  if (l.isFlood) {
    // Latched (flood_latch.py) beats live state — a sensor that's dried
    // out but is still within its 2-day alarm window reads ALARM, not DRY;
    // the whole point of latching is not to look clear the moment it isn't.
    const on = l.state === "on";
    const latch = (floodLatches || {})[l.entity_id];
    const latched = floodLatchActive(latch && latch.triggered_at, Date.now());
    return { text: on ? "WET" : (latched ? "ALARM" : "DRY"), lit: on || latched, sortValue: (on || latched) ? 1 : 0, latched };
  }
  return null;
}

// ── Spread in room ───────────────────────────────────────────────────────────
// Bulk placement without dragging a pile apart: n evenly-spaced metre points
// inside a room polygon, inset from its walls, row-major from the top-left —
// the order the index lists them in, so a room of six pots lands as two rows
// of three. Pure geometry so it can be proven on real room polygons; the
// caller turns each point into a fabric_light_position_set.
export function spreadInRoom(pts, n, insetM = 0.5){
  if (!Array.isArray(pts) || pts.length < 3 || !(n > 0)) return [];
  const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  const inset = offsetPolygonInward(pts, Math.min(insetM, Math.min(x1 - x0, y1 - y0) * 0.3));
  const inside = (x, y) => pointInPolygon(inset, x, y);
  // Find the coarsest grid whose interior points can hold n devices; then
  // take the first n in reading order. Starting coarse keeps them spread.
  for (let cells = Math.max(1, Math.ceil(Math.sqrt(n))); cells <= 40; cells++) {
    const sx = (x1 - x0) / cells, sy = (y1 - y0) / cells;
    const cand = [];
    for (let j = 0; j < cells; j++) for (let i = 0; i < cells; i++) {
      const x = x0 + sx * (i + 0.5), y = y0 + sy * (j + 0.5);
      if (inside(x, y)) cand.push([Math.round(x * 1000) / 1000, Math.round(y * 1000) / 1000]);
    }
    if (cand.length >= n) {
      // Pick n of them evenly along the reading order, not the first n, so
      // a 3-of-9 spread is the diagonal-ish spread and not one crowded row.
      const out = [];
      for (let k = 0; k < n; k++) out.push(cand[Math.floor((k + 0.5) * cand.length / n)]);
      return out;
    }
  }
  // A sliver of a room: stack them at the centroid rather than refuse.
  const cx = xs.reduce((a, b) => a + b, 0) / xs.length, cy = ys.reduce((a, b) => a + b, 0) / ys.length;
  return Array.from({ length: n }, () => [Math.round(cx * 1000) / 1000, Math.round(cy * 1000) / 1000]);
}

// ── Hold / tap / drag gesture ────────────────────────────────────────────────
// One state machine for every pressable thing on the use surface, so a tap,
// a hold and a hold-then-drag can never fire two actions for one gesture:
//   tap    — released before HOLD_MS, moved less than SLOP: the switch
//   hold   — HOLD_MS elapsed without moving: "armed" (the pressed ring
//            completes); releasing without moving OPENS the controls —
//            never on the way down, so an accidental hold can be abandoned
//            by sliding off, and the toggle never fires on the way up
//   drag   — moved past SLOP after arming (dimmables only): relative
//            brightness, no card; the release commits it
// Movement past SLOP BEFORE arming cancels the gesture and hands it to the
// map (pan). Pure: the host feeds it events and acts on what comes back.
export const HOLD_MS = 500, PRESS_RING_MS = 150, SLOP_PX = 8;
// `t` throughout is a timestamp, not wall-clock time — callers must pass
// e.timeStamp (down/up, from the real event the browser captured) or
// performance.now() (tick, called from a setTimeout with no event of its
// own); both share one epoch. Garry, 2026-09-16, live: "a single press...
// options are constantly popping up" — Date.now() sampled INSIDE the
// handler measures when the handler finally ran, not when the finger
// actually lifted; a busy main thread (this map is a large live SVG) can
// delay a queued pointerup handler well past the real release, inflating
// the measured hold past HOLD_MS for what was, physically, a clean fast
// tap. e.timeStamp is captured by the browser at the real event, immune to
// that delay.
export function createHoldTracker({ holdMs = HOLD_MS, slopPx = SLOP_PX, canDrag = false } = {}){
  let st = null;
  return {
    down(x, y, t){ st = { x, y, t, armed: false, dragging: false, moved: false }; return "pressed"; },
    // Returns "cancel" (pan takes over), "arm" (hold reached), "drag" with a
    // dy, or null. The caller decides when holdMs has elapsed by calling
    // tick(t); move() reports geometry only.
    tick(t){
      if (!st || st.armed || st.moved) return null;
      if (t - st.t >= holdMs) { st.armed = true; return "arm"; }
      return null;
    },
    move(x, y){
      if (!st) return null;
      const d = Math.hypot(x - st.x, y - st.y);
      if (!st.armed) {
        if (d > slopPx) { st.moved = true; const r = "cancel"; st = null; return r; }
        return null;
      }
      if (d > slopPx || st.dragging) {
        if (!canDrag) return null;
        st.dragging = true;
        return { action: "drag", dy: y - st.y, dx: x - st.x };
      }
      return null;
    },
    up(t){
      if (!st) return null;
      const r = st.dragging ? "drag-end" : (st.armed ? "open" : ((t - st.t) < holdMs ? "tap" : "open"));
      st = null;
      return r;
    },
    cancel(){ st = null; return "cancel"; },
    get armed(){ return !!(st && st.armed); },
    get active(){ return !!st; },
  };
}
// Relative brightness from a vertical drag: a full 160 px sweep is the whole
// range, so a thumb's reach covers 0-100% without lifting.
export function dragBrightness(startBri, dy, pxFullRange = 160){
  const b = Math.round((Number(startBri) || 128) - dy * (255 / pxFullRange));
  return Math.max(1, Math.min(255, b));
}

// ── Undo / redo for the builder ──────────────────────────────────────────────
// Snapshots of placement entries, oldest first. push() records the state
// BEFORE an edit; undo() hands back what to restore and moves it to redo.
export function createUndoStack(limit = 50){
  const past = [], future = [];
  return {
    push(entry){ past.push(entry); if (past.length > limit) past.shift(); future.length = 0; },
    undo(current){ if (!past.length) return null; const e = past.pop(); future.push(current); return e; },
    redo(current){ if (!future.length) return null; const e = future.pop(); past.push(current); return e; },
    peekUndo(){ return past.length ? past[past.length - 1] : null; },
    peekRedo(){ return future.length ? future[future.length - 1] : null; },
    clear(){ past.length = 0; future.length = 0; },
    get canUndo(){ return past.length > 0; },
    get canRedo(){ return future.length > 0; },
  };
}

// Semantic zoom: codes are for the builder and the zoomed-in viewer; at
// overview zoom the glyph and the room name carry identity.
export function codesVisibleAtZoom(zoom){ return !(Number(zoom) < 0.999); }

// Pinch-zoom math: the zoom that keeps the point under the fingers' midpoint
// where it is. Pure so the gesture wiring below stays thin.
export function pinchZoom(zoom, prevDist, dist, min = 0.4, max = 2.5){
  if (!(prevDist > 0) || !(dist > 0)) return zoom;
  return Math.max(min, Math.min(max, Math.round(zoom * (dist / prevDist) * 100) / 100));
}

// Touch pipeline for the drawing stage: two fingers pinch the zoom about
// their midpoint; one finger on the ground pans (the stage scrolls). Markers
// set touch-action:none on themselves so a finger on a fixture is a gesture
// on that fixture, not a pan. onZoom(next, cx, cy) applies the zoom; the
// stage's own scroll does the panning.
export function wireStageTouch(stage, view, onZoom){
  if (!stage || stage._touchWired) return;
  stage._touchWired = true;
  const pts = new Map();
  let prevDist = 0;
  stage.addEventListener("pointerdown", (e) => {
    if (e.pointerType !== "touch") return;
    pts.set(e.pointerId, [e.clientX, e.clientY]);
    if (pts.size === 2) { const [a, b] = [...pts.values()]; prevDist = Math.hypot(a[0]-b[0], a[1]-b[1]); }
  });
  stage.addEventListener("pointermove", (e) => {
    if (e.pointerType !== "touch" || !pts.has(e.pointerId)) return;
    pts.set(e.pointerId, [e.clientX, e.clientY]);
    if (pts.size === 2) {
      const [a, b] = [...pts.values()];
      const d = Math.hypot(a[0]-b[0], a[1]-b[1]);
      const next = pinchZoom(view.zoom, prevDist, d);
      if (next !== view.zoom) {
        const r = stage.getBoundingClientRect();
        onZoom(next, (a[0]+b[0])/2 - r.left, (a[1]+b[1])/2 - r.top);
      }
      prevDist = d;
      e.preventDefault();
    }
  });
  const lift = (e) => { pts.delete(e.pointerId); if (pts.size < 2) prevDist = 0; };
  stage.addEventListener("pointerup", lift);
  stage.addEventListener("pointercancel", lift);
}

// ── The use surface (shared by the sidebar and the builder's Preview) ───────
// Everything a finger does on the drawing when the map is being USED rather
// than built. One implementation, so "Preview as sidebar" in the builder is
// the sidebar's behaviour by construction, not a copy of it.
//
// api = {
//   lightsByEid, lights           the pipeline's output for this render
//   toggle(eid)                   the switch (optimistic in both hosts)
//   openControls(eid)             the control card
//   controlsFor(l) → bool         does this device have more than on/off
//   openRoom(room, onlyEids?)     the room sheet (onlyEids: the unplaced chip)
//   openFloor(z)                  the storey sheet
//   hass                          for the live brightness at drag start
//   toast(msg, isErr)
//   rerender()
// }
// ── The hover HUD ─────────────────────────────────────────────────────────────
// Pinned to the upper-left of the stage's visible area: what a click on the
// map would land on, and what's stacked underneath it (Garry, 2026-09-12:
// "add a mouse over in the upper left so I can clearly see the device a
// click would have me work on... make it so the device underneath can also
// be selected somehow, and showing in the mouseover text"). A true hit-test,
// not a bounding-box guess — elementsFromPoint returns exactly what the
// browser would give the click, topmost first, so "Click" is never wrong
// about which marker wins. Shared by BOTH hosts (Garry, 2026-09-14: "the
// mouse over works in mapping, lights, but not in lights tab" — it had been
// builder-only glue in maps.js); what an "Under" pick DOES is the host's
// (opts.onPickUnder — the builder selects it for the inspector, the sidebar
// acts on it the way a tap would). Returns stackAt for the builder's
// Alt+click cycle.
//   opts.lightsByEid   eid -> light (for the labels)
//   opts.isDragging()  true while a marker drag is in flight: no HUD churn
//   opts.onPickUnder(eid)  the "Under" button
//   opts.underTitle / opts.stackHint (null = none) / opts.roomLine(room, n)
export function wireHoverHud(isoDiv, opts){
  const svg = isoDiv.querySelector("svg");
  if (!svg) return () => [];
  const lightsByEid = opts.lightsByEid || {};
  const mk = (tag, cls, kids) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    for (const k of (Array.isArray(kids) ? kids : [kids])) if (k != null) n.appendChild(typeof k === "string" ? document.createTextNode(k) : k);
    return n;
  };
  // The panel lives in shadow DOM: document.elementsFromPoint stops at the
  // shadow HOST and never sees the SVG. The stage's own root does — but
  // isoDiv is wired (this function runs) BEFORE it is necessarily inserted
  // into that shadow tree, so getRootNode() called once here can capture
  // isoDiv itself (a disconnected node is its own root) instead of the real
  // ShadowRoot, permanently — the fallback below then silently uses
  // `document`, which finds nothing every time (2026-09-13, live: "no
  // working mouse over" — the hover HUD's stack was always empty). Resolve
  // the root FRESH on every call instead of caching it once.
  const fromPoint = (x, y) => {
    const root = isoDiv.getRootNode();
    return (root && root.elementsFromPoint ? root : document).elementsFromPoint(x, y);
  };
  const stackAt = (x, y) => {
    const seen = new Set(), out = [];
    for (const n of fromPoint(x, y)) {
      const g = n.closest ? n.closest("g.lhex[data-eid]") : null;
      if (!g || !svg.contains(g)) continue;
      const eid = g.getAttribute("data-eid");
      if (!seen.has(eid)) { seen.add(eid); out.push(eid); }
    }
    return out;
  };
  const roomAt = (x, y) => {
    for (const n of fromPoint(x, y)) {
      const g = n.closest ? n.closest("g.lroom[data-room]") : null;
      if (g && svg.contains(g)) return g.getAttribute("data-room");
    }
    return null;
  };

  // A zero-height sticky anchor rides the stage's own scroll (both axes)
  // without pushing the drawing down; the box hangs off it.
  const anchor = mk("div", "lv-hoverhud-anchor");
  const hud = mk("div", "lv-hoverhud");
  hud.hidden = true;
  anchor.appendChild(hud);
  isoDiv.insertBefore(anchor, svg);

  const label = (eid) => {
    const l = lightsByEid[eid];
    return l ? `${l.code ? l.code + " · " : ""}${l.friendly_name || eid}` : eid;
  };
  // Pin the box to the top-left of the VISIBLE part of the stage. The anchor
  // is sticky within the stage's own scroll box, but the PAGE scrolls too,
  // and once the stage's top edge is above the viewport — the ordinary way
  // to look at the map under the toolbar — the anchor, and the box with it,
  // sits off-screen (Garry, 2026-09-14: "mouse over no longer works"; live,
  // the box was filling correctly 291px above the window). Re-measured on
  // every hover, before the same-content early return, so a page scroll
  // mid-hover moves the box too.
  // …and below a sticky toolbar (.lv-toolbar-sticky, the builder's, z-index
  // 20, above this box's 5): pinned to the viewport top alone, the box landed
  // exactly under that bar — on-screen by the numbers, invisible in fact.
  // A host without that bar (the sidebar) measures 0 and pins to the top.
  const place = () => {
    const a = anchor.getBoundingClientRect();
    const root = isoDiv.getRootNode();
    const bar = root && root.querySelector ? root.querySelector(".lv-toolbar-sticky") : null;
    const barBottom = bar ? bar.getBoundingClientRect().bottom : 0;
    const visibleTop = Math.max(0, barBottom);
    hud.style.top = `${Math.max(visibleTop, a.top) - a.top + 6}px`;
    hud.style.left = `${Math.max(0, -a.left) + 6}px`;
  };
  let lastKey = "";
  // The HUD is pinned at the top-left; a marker it names can be anywhere on
  // the map. Every pointermove event on the way there — crossing empty
  // canvas between the marker and the box — used to call show([], null),
  // which hid the HUD on the very first such event, before the cursor could
  // ever arrive (Garry, 2026-09-19: "how can I click on the mouse over???
  // ...the message needs to linger so it can be clicked on when the mouse
  // is moved"). A real "nothing at all" (crossing dead canvas, or genuinely
  // leaving the stage) now gets a short grace window instead of an instant
  // hide, cancelled the moment anything real — a device, a room, or the HUD
  // itself — is back under the cursor.
  const HIDE_GRACE_MS = 450;
  let hideTimer = null;
  const cancelHide = () => { if (hideTimer != null) { clearTimeout(hideTimer); hideTimer = null; } };
  const hideNow = () => { cancelHide(); lastKey = ""; hud.hidden = true; };
  const show = (stack, room) => {
    place();
    const key = stack.join("|") + "#" + (room || "");
    if (!stack.length && !room) {
      if (hud.hidden) return;                       // already hidden — nothing to debounce
      cancelHide();
      hideTimer = setTimeout(() => { hideTimer = null; lastKey = ""; hud.hidden = true; }, HIDE_GRACE_MS);
      return;
    }
    cancelHide();
    if (key === lastKey) return;
    lastKey = key;
    hud.innerHTML = "";
    hud.hidden = false;
    if (stack.length) {
      hud.appendChild(mk("div", "lv-hoverhud-hit", [mk("span", "lv-hoverhud-k", "Click"), label(stack[0])]));
      for (const eid of stack.slice(1)) {
        const b = mk("button", "lv-hoverhud-under", [mk("span", "lv-hoverhud-k", "Under"), label(eid)]);
        b.title = opts.underTitle || "This one is under the marker on top";
        b.addEventListener("click", () => { if (opts.onPickUnder) opts.onPickUnder(eid); });
        hud.appendChild(b);
      }
      if (stack.length > 1 && opts.stackHint) hud.appendChild(mk("div", "lv-hoverhud-hint", opts.stackHint));
    } else {
      const n = Object.values(lightsByEid).filter(l => l.area_name === room).length;
      const line = opts.roomLine ? opts.roomLine(room, n) : `${room} — ${n} device${n === 1 ? "" : "s"}`;
      hud.appendChild(mk("div", "lv-hoverhud-hit", [mk("span", "lv-hoverhud-k", "Click"), line]));
    }
  };
  isoDiv.addEventListener("pointermove", (ev) => {
    if (ev.pointerType === "touch") return;
    if (hud.contains(ev.target)) { cancelHide(); return; }   // reading the HUD must not clear it
    if (opts.isDragging && opts.isDragging()) return;
    show(stackAt(ev.clientX, ev.clientY), roomAt(ev.clientX, ev.clientY));
  });
  // Genuinely leaving the stage IS an unambiguous "done" — no grace needed,
  // unlike the mid-transit case show() itself now debounces.
  isoDiv.addEventListener("pointerleave", hideNow);
  return stackAt;
}

// The pressed ring: appears at PRESS_RING_MS, fills over the rest of the
// hold, and turns gold (the .armed CSS class) when the hold is armed — the
// affordance a bare setTimeout-driven long press never has on its own.
// Exported so every long-press site on the map — not just wireUseSurface's
// own marker taps — can show the SAME ring instead of each growing its own.
export function pressRing(svg, cx, cy, r){
  if (!svg) return null;
  const NS = "http://www.w3.org/2000/svg";
  const c = document.createElementNS(NS, "circle");
  c.setAttribute("class", "lpress"); c.setAttribute("cx", cx); c.setAttribute("cy", cy); c.setAttribute("r", r);
  c.setAttribute("fill", "none"); c.setAttribute("stroke", "#fbbf24"); c.setAttribute("stroke-width", "1.6");
  c.setAttribute("pointer-events", "none");
  const circ = (2 * Math.PI * r).toFixed(1);
  c.setAttribute("stroke-dasharray", circ); c.setAttribute("stroke-dashoffset", circ);
  c.style.setProperty("--lv-ring-ms", `${HOLD_MS - PRESS_RING_MS}ms`);
  svg.appendChild(c);
  return c;
}
export function wireUseSurface(isoDiv, api){
  const q = (sel) => isoDiv.querySelectorAll(sel);
  const svg = isoDiv.querySelector("svg");
  const ringAt = (cx, cy, r) => pressRing(svg, cx, cy, r);
  const wirePress = (g, eid, cx, cy, ringR = 12) => {
    const l0 = api.lightsByEid[eid];
    if (!l0) return;
    g.style.touchAction = "none";
    const holdable = api.controlsFor(l0);
    const tracker = createHoldTracker({ canDrag: !!l0.dimmable && String(eid).startsWith("light.") });
    let ring = null, ringT = null, armT = null, dragBri = null, readout = null, lastSend = 0;
    const clearAll = () => {
      if (ringT) { clearTimeout(ringT); ringT = null; }
      if (armT) { clearTimeout(armT); armT = null; }
      if (ring) { try { ring.remove(); } catch (_) {} ring = null; }
      if (readout) { try { readout.remove(); } catch (_) {} readout = null; }
    };
    g.addEventListener("pointerdown", (e) => {
      if (e.button !== undefined && e.button !== 0 && e.pointerType === "mouse") return;
      e.stopPropagation();
      try { g.setPointerCapture(e.pointerId); } catch (_) {}
      tracker.down(e.clientX, e.clientY, Number.isFinite(e.timeStamp) ? e.timeStamp : performance.now());
      if (holdable) {
        ringT = setTimeout(() => { if (tracker.active) ring = ringAt(cx, cy, ringR); }, PRESS_RING_MS);
        armT = setTimeout(() => {
          if (tracker.tick(performance.now()) === "arm") { if (ring) ring.classList.add("armed"); dragBri = null; }
        }, HOLD_MS);
      }
    });
    g.addEventListener("pointermove", (e) => {
      if (!tracker.active) return;
      const r = tracker.move(e.clientX, e.clientY);
      if (r === "cancel") { clearAll(); return; }
      if (r && r.action === "drag") {
        e.preventDefault();
        if (dragBri === null) {
          const st = api.hass && api.hass.states ? api.hass.states[eid] : null;
          dragBri = typeof st?.attributes?.brightness === "number" ? st.attributes.brightness : (lastBrightness(eid) || 128);
          if (ring) { ring.remove(); ring = null; }
          readout = document.createElement("div");
          readout.style.cssText = "position:fixed;z-index:10001;padding:4px 10px;border-radius:999px;font-size:13px;font-weight:800;"
            + "font-variant-numeric:tabular-nums;color:#111827;background:linear-gradient(135deg,#f59e0b,#fbbf24);"
            + "box-shadow:0 0 18px rgba(251,191,36,.6);pointer-events:none;font-family:Inter,system-ui,sans-serif";
          document.body.appendChild(readout);
        }
        const b = dragBrightness(dragBri, r.dy);
        readout.textContent = `${Math.round(b / 255 * 100)}%`;
        readout.style.left = `${e.clientX + 16}px`; readout.style.top = `${e.clientY - 14}px`;
        g._dragTarget = b;
        const now = Date.now();
        if (now - lastSend > 180 && api.hass) {
          lastSend = now;
          api.hass.callService("light", "turn_on", { entity_id: eid, brightness: b }).catch(() => {});
        }
      }
    });
    const finish = (e) => {
      if (!tracker.active) return;
      const r = e.type === "pointercancel" ? tracker.cancel() : tracker.up(Number.isFinite(e.timeStamp) ? e.timeStamp : performance.now());
      clearAll();
      try { g.releasePointerCapture(e.pointerId); } catch (_) {}
      // Motion has nothing to switch — holdable is false for it, so it can
      // never arm below and every real tap (quick or long) opens its own
      // activity history instead of toggling into the read-only refusal.
      if (l0.isMotion) { if (r === "tap" || r === "open") api.openActivity(eid); return; }
      if (r === "tap") { api.toggle(eid); return; }
      if (r === "open") { if (holdable) api.openControls(eid); else api.toggle(eid); return; }
      if (r === "drag-end") {
        const b = g._dragTarget;
        if (typeof b === "number" && api.hass) api.hass.callService("light", "turn_on", { entity_id: eid, brightness: b }).catch(() => api.toast("Could not set brightness", true));
        setTimeout(() => api.rerender(), 500);
      }
    };
    g.addEventListener("pointerup", finish);
    g.addEventListener("pointercancel", finish);
    g.addEventListener("contextmenu", e => e.preventDefault());
    // Click is swallowed: the tracker already decided what the release meant.
    g.addEventListener("click", e => { e.stopPropagation(); e.preventDefault(); });
  };
  q(".lhex").forEach(g => {
    wirePress(g, g.dataset.eid, Number(g.dataset.cx), Number(g.dataset.cy));
    g.addEventListener("mouseover", () => { g.style.opacity = String(Math.max(0.2, (parseFloat(g.getAttribute("opacity")) || 1) * 0.75)); });
    g.addEventListener("mouseout", () => { g.style.opacity = ""; });
  });
  q(".lhalo").forEach(c => wirePress(c, c.dataset.eid, Number(c.getAttribute("cx")), Number(c.getAttribute("cy")), Number(c.getAttribute("r")) + 2));
  // The code chip is drawn INSIDE the marker's own group (see codeChipSvg in
  // iso_lights.js) and has no wiring of its own any more — a tap there
  // bubbles to the SAME pointerdown/up pair wirePress just attached to the
  // marker, so it is identical to tapping the glyph: quick switches, a
  // genuine 500ms hold opens the controls. It used to be its own always-open
  // target; Garry never asked for that split and it is gone.
  q(".lroom").forEach(r => r.addEventListener("click", (e) => { e.stopPropagation(); api.openRoom(r.dataset.room); }));
  q(".lstack").forEach(st => st.addEventListener("click", (e) => { e.stopPropagation(); api.openRoom(st.dataset.room, String(st.dataset.eids || "").split(",").filter(Boolean)); }));
  q(".lfloor").forEach(f => f.addEventListener("click", (e) => { e.stopPropagation(); api.openFloor(f.dataset.z); }));
}

// ── The room / floor sheet ───────────────────────────────────────────────────
// The aggregate control: every device in a room (or on a storey) with one
// button each, plus "All lights off/on" — and, separately, the fans. Mounted
// on document.body, outside both hosts' shadow roots, so it is styled inline
// (the same reason the control card is). A bottom sheet on a phone, a
// centred card on a desktop.
const _S = {
  overlay: "position:fixed;inset:0;z-index:10000;background:rgba(3,8,5,.58);backdrop-filter:blur(6px);"
    + "-webkit-backdrop-filter:blur(6px);display:flex;justify-content:center;align-items:flex-end",
  sheet: "width:100%;max-width:520px;max-height:78vh;overflow:auto;padding:14px 16px 18px;box-sizing:border-box;"
    + "background:linear-gradient(180deg,#101f15,#0b1710);border:1px solid rgba(120,190,155,.28);"
    + "border-radius:18px 18px 0 0;color:#e2e8f0;font-family:Inter,system-ui,sans-serif;box-shadow:0 -12px 50px rgba(0,0,0,.6)",
  head: "display:flex;justify-content:space-between;align-items:flex-start;gap:10px;margin-bottom:10px",
  title: "font-weight:800;font-size:16px;letter-spacing:-.01em",
  sub: "font-size:11.5px;color:rgba(226,240,232,.5);margin-top:2px",
  act: "font-size:12px;font-weight:600;padding:6px 14px;border-radius:8px;cursor:pointer;min-height:34px;"
    + "background:rgba(255,255,255,.03);border:1px solid rgba(120,190,155,.18);color:rgba(226,240,232,.75)",
  actPrimary: "font-size:12px;font-weight:600;padding:6px 14px;border-radius:8px;cursor:pointer;min-height:34px;"
    + "color:#f0fdf4;background:linear-gradient(135deg,#166534,#22c55e);border:1px solid rgba(134,239,172,.6)",
  actions: "display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px",
  row: "display:flex;align-items:center;gap:10px;padding:8px 2px;border-bottom:1px solid rgba(120,190,155,.08)",
  code: "font-family:ui-monospace,monospace;font-weight:700;font-size:12px;min-width:34px",
  name: "flex:1;font-size:13px",
  onoff: (on) => "min-width:54px;min-height:32px;font-size:11px;font-weight:700;letter-spacing:.04em;padding:4px 13px;border-radius:999px;cursor:pointer;"
    + (on ? "background:linear-gradient(135deg,#f59e0b,#fbbf24);color:#111827;border:1px solid rgba(255,255,255,.25);box-shadow:0 0 14px rgba(251,191,36,.3)"
          : "background:rgba(255,255,255,.05);color:#fbbf24;border:1px solid rgba(251,191,36,.35)"),
  state: (on) => "display:inline-flex;align-items:center;gap:5px;padding:2px 9px;border-radius:999px;font-size:10px;font-weight:700;letter-spacing:.06em;"
    + (on ? "color:#3b82f6;background:rgba(59,130,246,.14);border:1px solid rgba(59,130,246,.5)"
          : "color:rgba(226,240,232,.4);background:rgba(255,255,255,.03);border:1px solid rgba(120,190,155,.14)"),
};
export function openAggregateSheet(api, { title, sub, items, actions }){
  const mk = (tag, style, text) => { const n = document.createElement(tag); if (style) n.style.cssText = style; if (text !== undefined) n.textContent = text; return n; };
  const overlay = mk("div", _S.overlay);
  const desktop = typeof window !== "undefined" && window.innerWidth > 768;
  if (desktop) overlay.style.alignItems = "center";
  const close = () => { try { document.body.removeChild(overlay); } catch (_) {} };
  overlay.addEventListener("click", e => { if (e.target === overlay) close(); });
  const sheet = mk("div", _S.sheet + (desktop ? ";border-radius:16px" : ""));
  const head = mk("div", _S.head);
  const hl = mk("div"); hl.appendChild(mk("div", _S.title, title)); hl.appendChild(mk("div", _S.sub, sub || ""));
  head.appendChild(hl);
  const x = mk("button", _S.act, "✕"); x.addEventListener("click", close); head.appendChild(x);
  sheet.appendChild(head);
  if (actions && actions.length) {
    const row = mk("div", _S.actions);
    for (const a of actions) {
      const b = mk("button", a.primary ? _S.actPrimary : _S.act, a.label);
      b.addEventListener("click", () => { a.run(); close(); });
      row.appendChild(b);
    }
    sheet.appendChild(row);
  }
  for (const l of items) {
    const row = mk("div", _S.row);
    const col = classBorder(l, "#52b788");
    row.appendChild(mk("span", _S.code + `;color:${col}`, l.code));
    row.appendChild(mk("span", _S.name, l.friendly_name));
    const sw = stateWordOf(l, api.floodLatches);
    if (sw) {
      row.appendChild(mk("span", _S.state(sw.lit), sw.text));
      if (l.isLock) {
        const b = mk("button", _S.onoff(sw.locked), sw.locked ? "Unlock" : "Lock");
        b.addEventListener("click", (e) => {
          e.stopPropagation();
          const wasLocked = b.textContent === "Unlock";
          api.toggle(l.entity_id);
          b.style.cssText = _S.onoff(!wasLocked); b.textContent = wasLocked ? "Lock" : "Unlock";
        });
        row.appendChild(b);
      } else if (l.isFlood && sw.latched && api.onFloodReset) {
        const wrap = mk("span");
        const makeResetBtn = () => {
          const b = mk("button", _S.act + ";padding:3px 10px;min-height:26px;font-size:10px", "Reset");
          b.addEventListener("click", (e) => {
            e.stopPropagation();
            wrap.innerHTML = "";
            const yes = mk("button", _S.act + ";padding:3px 10px;min-height:26px;font-size:10px;background:#7f1d1d;border-color:#dc2626;color:#fecaca", "Yes, clear it");
            const no = mk("button", _S.act + ";padding:3px 10px;min-height:26px;font-size:10px", "No");
            yes.addEventListener("click", (e2) => { e2.stopPropagation(); wrap.innerHTML = ""; api.onFloodReset(l.entity_id); });
            no.addEventListener("click", (e2) => { e2.stopPropagation(); wrap.innerHTML = ""; wrap.appendChild(makeResetBtn()); });
            wrap.appendChild(yes); wrap.appendChild(no);
          });
          return b;
        };
        wrap.appendChild(makeResetBtn());
        row.appendChild(wrap);
      }
    } else {
      // Controllable, no special word — light/wled/partition/fan's plain
      // generic On/Off (+ optional Controls "⋯") button.
      const on = l.state === "on";
      const b = mk("button", _S.onoff(on), on ? "On" : "Off");
      b.addEventListener("click", (e) => {
        e.stopPropagation();
        const nowOn = b.textContent === "On";
        api.toggle(l.entity_id);
        b.style.cssText = _S.onoff(!nowOn); b.textContent = nowOn ? "Off" : "On";
      });
      row.appendChild(b);
      if (api.controlsFor(l)) {
        const more = mk("button", _S.act + ";min-height:30px;padding:3px 10px", "⋯");
        more.title = "Controls";
        more.addEventListener("click", () => { close(); api.openControls(l.entity_id); });
        row.appendChild(more);
      }
    }
    sheet.appendChild(row);
  }
  overlay.appendChild(sheet);
  document.body.appendChild(overlay);
}
// The two sheets the map opens. setMany(eids, on) is the host's aggregate
// action (optimistic, batched per domain).
export function openRoomSheet(api, lights, room, onlyEids){
  const agg = roomAggregate(lights, room, api.floodLatches);
  const only = onlyEids ? new Set(onlyEids) : null;
  const items = agg.all.filter(l => !only || only.has(l.entity_id));
  const lightEids = agg.lightEids.filter(e => !only || only.has(e));
  const fanEids = agg.fanEids.filter(e => !only || only.has(e));
  const parts = [];
  if (agg.lightsTotal) parts.push(`Lights ${agg.lightsOn}/${agg.lightsTotal}`);
  if (agg.fansTotal) parts.push(`Fans ${agg.fansOn}/${agg.fansTotal}`);
  if (agg.motionTotal) parts.push(agg.motionActive ? `Motion ×${agg.motionActive}` : "Motion clear");
  if (agg.airTotal) parts.push(`Air ${airQualityWord(agg.airWorst)}`);
  if (agg.floodActive) parts.push(`⚠ Emergency ×${agg.floodActive}`);
  const actions = [];
  if (lightEids.length) {
    actions.push({ label: "All lights off", run: () => api.setMany(lightEids, false) });
    actions.push({ label: "All lights on", primary: true, run: () => api.setMany(lightEids, true) });
  }
  if (fanEids.length) {
    actions.push({ label: "Fans off", run: () => api.setMany(fanEids, false) });
    actions.push({ label: "Fans on", run: () => api.setMany(fanEids, true) });
  }
  openAggregateSheet(api, { title: only ? `Unplaced in ${room}` : room, sub: parts.join(" · "), items, actions });
}
// Read-only info classes the floor sheet always lists — not already counted
// via lightEids/fanEids, and not conditional the way motion/air/flood are
// just above (those earn their own clause because they also drive the
// summary line's word). By class key, so a new always-show class is one
// entry here, not another hand-typed flag on the filter line.
const _FLOOR_SHEET_ALWAYS = new Set(["door", "temp", "humidity", "lock"]);
export function openFloorSheet(api, lights, model, z){
  const floors = (model && model.floors) || [];
  const f = floors.find(x => Number(x.level) === Number(z));
  const fid = f ? String(f.id) : null;
  if (!fid) { api.toast("No floor record for this storey"); return; }
  const agg = floorAggregate(lights, model, fid, api.floodLatches);
  // The room sheet shows every class via agg.all; this hand-typed inclusion
  // list only ever named lights/fans/active-motion/air/alarming-flood, so a
  // door, temp, humidity or lock on this floor never appeared here at all —
  // found in the Phase 2a registry audit, 2026-09-19. By class KEY, not by
  // flag, so this stays one line however many classes end up in the set.
  const items = lights.filter(l => agg.lightEids.includes(l.entity_id) || agg.fanEids.includes(l.entity_id) || (l.isMotion && l.state === "on")
    || (l.isAir && lightFloorId(l, model) === String(fid)) || (l.isFlood && floodIsAlarming(l, api.floodLatches) && lightFloorId(l, model) === String(fid))
    || (_FLOOR_SHEET_ALWAYS.has(lightClassOf(l)) && lightFloorId(l, model) === String(fid)));
  const parts = [`Lights ${agg.lightsOn}/${agg.lightsTotal}`];
  if (agg.fansTotal) parts.push(`Fans ${agg.fansOn}/${agg.fansTotal}`);
  if (agg.motionActive) parts.push(`Motion ×${agg.motionActive}`);
  // Like motion: only worth a word on the floor line when something is up.
  if (agg.airTotal && agg.airWorst > 0) parts.push(`Air ${airQualityWord(agg.airWorst)}`);
  if (agg.floodActive) parts.push(`⚠ Emergency ×${agg.floodActive}`);
  const actions = [];
  if (agg.lightEids.length) {
    actions.push({ label: "All lights off", run: () => api.setMany(agg.lightEids, false) });
    actions.push({ label: "All lights on", primary: true, run: () => api.setMany(agg.lightEids, true) });
  }
  if (agg.fanEids.length) actions.push({ label: "Fans off", run: () => api.setMany(agg.fanEids, false) });
  openAggregateSheet(api, { title: f.name || `Floor ${z}`, sub: parts.join(" · "), items, actions });
}

// ── Weekly activity calendar (motion sensors) ────────────────────────────────
// Garry: motion sensors have nothing to switch, so a quick tap opens this
// instead of the read-only toast — "a calendar saying when the room last saw
// activity in the last week... fully filled by the hour." Bucketing is pure
// (motionWeeklyGrid) so the day/hour maths is tested without a browser; the
// fetch + render sit next to it, same split as roomAggregate/openRoomSheet.
//
// Scoped to the ONE entity tapped — a paired motion+occupancy primary (see
// computeMotionOccupancyPairs) shows only its own half's history, not its
// secondary's too. Good enough for how most houses are wired; merging both
// halves is a real extension, just not this one.

// history: [{state, ts}], ts in ms, any order — "on" holds until the next
// entry (or endMs for the last one). dayStarts is local midnight, oldest
// first; grid[d][h] is true if the entity was "on" for any moment of that
// local hour on day d.
export function motionWeeklyGrid(history, endMs, days = 7) {
  const endDay = new Date(endMs);
  endDay.setHours(0, 0, 0, 0);
  const startDay = new Date(endDay);
  startDay.setDate(startDay.getDate() - (days - 1));

  const dayStarts = [];
  for (let d = 0; d < days; d++) {
    const ds = new Date(startDay);
    ds.setDate(ds.getDate() + d);
    dayStarts.push(ds.getTime());
  }
  const windowEnd = dayStarts[days - 1] + 86400000;

  const grid = dayStarts.map(() => new Array(24).fill(false));
  const events = (history || [])
    .filter(e => e && Number.isFinite(e.ts))
    .slice()
    .sort((a, b) => a.ts - b.ts);

  for (let i = 0; i < events.length; i++) {
    if (events[i].state !== "on") continue;
    const stop = Math.min(i + 1 < events.length ? events[i + 1].ts : endMs, windowEnd);
    let cur = Math.max(events[i].ts, dayStarts[0]);
    // Walk the "on" interval one local hour at a time — Date arithmetic
    // (not a fixed 3600000ms step) so a DST-shortened or -lengthened day
    // still lands each moment in the hour a wall clock would show.
    while (cur < stop) {
      const dt = new Date(cur);
      const dayIdx = Math.round(
        (new Date(dt.getFullYear(), dt.getMonth(), dt.getDate()).getTime() - dayStarts[0]) / 86400000
      );
      if (dayIdx >= 0 && dayIdx < days) grid[dayIdx][dt.getHours()] = true;
      const nextHour = new Date(dt.getFullYear(), dt.getMonth(), dt.getDate(), dt.getHours() + 1, 0, 0, 0).getTime();
      cur = Math.min(nextHour, stop);
    }
  }
  return { dayStarts, days, grid };
}

const _CAL_S = {
  wrap: "display:grid;grid-template-columns:26px repeat(7,1fr);gap:2px;margin-top:6px",
  hourLbl: "font-size:9px;color:rgba(226,240,232,.4);text-align:right;padding-right:4px;line-height:14px",
  dayLbl: "font-size:10px;color:rgba(226,240,232,.65);text-align:center;font-weight:700;padding-bottom:3px",
  cellOff: "width:100%;aspect-ratio:1;border-radius:3px;background:rgba(255,255,255,.04)",
  cellOn: "width:100%;aspect-ratio:1;border-radius:3px;background:#3b82f6;box-shadow:0 0 5px rgba(59,130,246,.6)",
};
// hass.callApi is the standard authenticated REST helper every HA frontend
// panel already has (the same connection object as callWS) — plain history
// isn't cleanly a websocket command, so this is the one place this file
// reaches for it instead.
export async function openActivityCalendar(hass, eid) {
  if (!hass) return;
  const st = hass.states[eid];
  const name = (st && st.attributes && st.attributes.friendly_name) || eid;
  const now = Date.now();
  const days = 7;
  const startOfWindow = new Date(now);
  startOfWindow.setDate(startOfWindow.getDate() - (days - 1));
  startOfWindow.setHours(0, 0, 0, 0);

  const mk = (tag, style, text) => { const n = document.createElement(tag); if (style) n.style.cssText = style; if (text !== undefined) n.textContent = text; return n; };
  const overlay = mk("div", _S.overlay);
  const desktop = typeof window !== "undefined" && window.innerWidth > 768;
  if (desktop) overlay.style.alignItems = "center";
  const close = () => { try { document.body.removeChild(overlay); } catch (_) {} };
  overlay.addEventListener("click", e => { if (e.target === overlay) close(); });
  const sheet = mk("div", _S.sheet + (desktop ? ";border-radius:16px" : ""));
  const head = mk("div", _S.head);
  const hl = mk("div"); hl.appendChild(mk("div", _S.title, name)); hl.appendChild(mk("div", _S.sub, "Activity — last 7 days"));
  head.appendChild(hl);
  const x = mk("button", _S.act, "✕"); x.addEventListener("click", close); head.appendChild(x);
  sheet.appendChild(head);
  const body = mk("div", "font-size:12px;color:rgba(226,240,232,.5)", "Loading…");
  sheet.appendChild(body);
  overlay.appendChild(sheet);
  document.body.appendChild(overlay);

  try {
    const raw = await hass.callApi(
      "GET",
      `history/period/${encodeURIComponent(startOfWindow.toISOString())}?filter_entity_id=${encodeURIComponent(eid)}&minimal_response&no_attributes`
    );
    const history = ((raw && raw[0]) || [])
      .map(r => ({ state: r.state, ts: Date.parse(r.last_changed) }))
      .filter(r => Number.isFinite(r.ts));
    const { dayStarts, grid } = motionWeeklyGrid(history, now, days);

    body.textContent = "";
    const totalOnHours = grid.reduce((a, row) => a + row.filter(Boolean).length, 0);
    body.appendChild(mk("div", "font-size:11.5px;color:rgba(226,240,232,.5);margin-bottom:6px",
      totalOnHours ? `Tripped in ${totalOnHours} hour${totalOnHours === 1 ? "" : "s"} this week.` : "No activity in the last 7 days."));

    const gridEl = mk("div", _CAL_S.wrap);
    gridEl.appendChild(mk("div"));
    for (const ds of dayStarts) gridEl.appendChild(mk("div", _CAL_S.dayLbl, new Date(ds).toLocaleDateString(undefined, { weekday: "short" })));
    for (let h = 0; h < 24; h++) {
      gridEl.appendChild(mk("div", _CAL_S.hourLbl, h % 3 === 0 ? String(h) : ""));
      for (let d = 0; d < dayStarts.length; d++) {
        const on = grid[d][h];
        const cell = mk("div", on ? _CAL_S.cellOn : _CAL_S.cellOff);
        cell.title = `${new Date(dayStarts[d]).toLocaleDateString()} ${String(h).padStart(2, "0")}:00 — ${on ? "activity" : "quiet"}`;
        gridEl.appendChild(cell);
      }
    }
    body.appendChild(gridEl);
  } catch (_err) {
    body.textContent = "Could not load history.";
  }
}

// ── The control card ─────────────────────────────────────────────────────────
// Capability-driven: on/off always; brightness, RGB colour and effect each
// appear only when the light offers them; a fan gets speed, preset,
// oscillate and direction, each only when the entity offers it. Reached
// from the code chip, the "⋯" on an index row, or a hold, on strip-class
// lights (WLED, ESPHome partition), plain dimmables and fans alike. Mounted
// on document.body so it isn't clipped by a panel's scroll container —
// outside every shadow root, so it is styled inline.
// api = { toast(msg, isErr), rerender(), onEdit(eid)? (admin: the pencil) }
function _mkEl(tag, attrs = {}, children = []){
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (k === "style") n.setAttribute("style", v);
    else if (k.startsWith("on") && typeof v === "function") n.addEventListener(k.slice(2), v);
    else if (v !== undefined && v !== null) n.setAttribute(k, String(v));
  }
  if (!Array.isArray(children)) children = [children];
  for (const c of children) {
    if (c === null || c === undefined) continue;
    n.appendChild(typeof c === "string" || typeof c === "number" ? document.createTextNode(String(c)) : c);
  }
  return n;
}
export function openControlCard(hass, eid, api){
  if (!hass) return;
  const st = hass.states[eid];
  if (!st) return;
  const el = _mkEl;
  const toast = api && api.toast ? api.toast : () => {};
  const rerender = api && api.rerender ? api.rerender : () => {};
  const attrs = st.attributes || {};
  const effectList = Array.isArray(attrs.effect_list) ? attrs.effect_list : [];
  const rgb = Array.isArray(attrs.rgb_color) ? attrs.rgb_color : [255, 255, 255];
  const toHex = (c) => "#" + c.map(v => Math.max(0, Math.min(255, v | 0)).toString(16).padStart(2, "0")).join("");
  const fromHex = (hex) => { const n = parseInt(hex.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };

  const overlay = document.createElement("div");
  overlay.style.cssText = "position:fixed;inset:0;background:rgba(3,8,5,.62);z-index:10000;"
    + "display:flex;align-items:center;justify-content:center;"
    + "backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px)";
  const close = () => { try { document.body.removeChild(overlay); } catch (_) {} };
  overlay.addEventListener("click", e => { if (e.target === overlay) close(); });

  const box = el("div", { style:
    "background:linear-gradient(180deg,#101f15,#0b1710);border:1px solid rgba(120,190,155,.28);"
    + "border-radius:16px;padding:20px;width:300px;max-width:90vw;"
    + "color:#e2e8f0;font-family:Inter,system-ui,sans-serif;"
    + "box-shadow:0 20px 60px rgba(0,0,0,.65),0 0 30px rgba(82,183,136,.08),inset 0 1px 0 rgba(255,255,255,.05)" });

  const smallBtn = "background:rgba(255,255,255,.04);border:1px solid rgba(120,190,155,.18);border-radius:8px;"
    + "color:#94a3b8;font-size:13px;cursor:pointer;padding:3px 8px;line-height:1;flex-shrink:0";
  box.appendChild(el("div", { style: "display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;gap:10px" }, [
    el("div", { style: "font-weight:700;font-size:15px;letter-spacing:-.01em" }, attrs.friendly_name || eid),
    // Admin only: the pencil jumps to Mapping → Lights with THIS light
    // selected — the build ↔ use loop closed from the use side.
    ...(api && api.onEdit ? [el("button", { title: "Edit this light in Mapping → Lights", style: smallBtn + ";margin-left:auto",
      onclick: () => { close(); api.onEdit(eid); } }, "✎")] : []),
    el("button", { style: smallBtn + (api && api.onEdit ? "" : ";margin-left:auto"), onclick: close }, "✕"),
  ]));

  // The service domain is the entity's own — this card serves fans too.
  const domain = String(eid).split(".")[0];
  // lock.* has no on/off at all (gap #8, best-in-class roadmap: the first
  // domain generalized beyond light/fan) — "locked" is its lit/normal
  // state, lock/unlock are its services, and a jammed lock is neither, so
  // it reads as "not locked" (offers Lock as the recovery action) with its
  // own warning line below rather than a misleading Turn On/Off button.
  const isLockDomain = domain === "lock";
  const on = isLockDomain ? st.state === "locked" : st.state === "on";
  const onBtn = el("button", {
    style: "width:100%;margin-bottom:14px;padding:10px;font-weight:700;font-size:13px;border-radius:10px;cursor:pointer;"
      + "letter-spacing:.02em;transition:filter .15s ease;"
      + (on ? "background:linear-gradient(135deg,#f59e0b,#fbbf24);color:#111827;border:1px solid rgba(255,255,255,.25);box-shadow:0 0 18px rgba(251,191,36,.35);"
            : "background:rgba(255,255,255,.05);color:#fbbf24;border:1px solid rgba(251,191,36,.35);"),
    onclick: async () => {
      const data = { entity_id: eid };
      if (!on && domain === "light") {
        const bri = lastBrightness(eid);
        if (bri !== null) data.brightness = bri;
      }
      const svc = isLockDomain ? (on ? "unlock" : "lock") : (on ? "turn_off" : "turn_on");
      setOptimistic(eid, isLockDomain ? (on ? "unlocked" : "locked") : (on ? "off" : "on"));
      try { await hass.callService(domain, svc, data); } catch (e) { clearOptimistic(eid); }
      close();
      setTimeout(rerender, 400);
    },
  }, isLockDomain ? (on ? "Unlock" : "Lock") : (on ? "Turn Off" : "Turn On"));
  box.appendChild(onBtn);
  if (isLockDomain && st.state === "jammed") {
    box.appendChild(el("div", { style: "font-size:12px;color:#f87171;margin:-8px 0 12px" }, "⚠ Lock is jammed"));
  }

  // ── Fan card ─────────────────────────────────────────────────────────
  if (domain === "fan") {
    const lblStyle = "font-size:12px;color:#94a3b8;margin-bottom:4px";
    const selStyle = "width:100%;background:#1a2e1e;color:#52b788;border:1px solid #2d4a36;border-radius:8px;padding:6px";
    const pillStyle = (active) => "flex:1;padding:8px;border-radius:8px;cursor:pointer;font-weight:700;font-size:12px;"
      + (active ? "background:rgba(52,211,153,.18);color:#6ee7b7;border:1px solid rgba(52,211,153,.45);"
                : "background:rgba(255,255,255,.04);color:#94a3b8;border:1px solid rgba(120,190,155,.18);");
    const call = async (svc, data) => {
      try { await hass.callService("fan", svc, { entity_id: eid, ...data }); }
      catch (e) { toast("Could not set fan " + svc, true); }
      setTimeout(rerender, 400);
    };
    if (typeof attrs.percentage === "number" || Number.isFinite(Number(attrs.percentage))) {
      const cur = Math.max(0, Math.min(100, Number(attrs.percentage) || 0));
      const step = Math.max(1, Math.round(Number(attrs.percentage_step) || 1));
      const pctLbl = el("div", { style: lblStyle }, `Speed: ${cur}%`);
      const pct = document.createElement("input");
      pct.type = "range"; pct.min = "0"; pct.max = "100"; pct.step = String(step); pct.value = String(cur);
      pct.style.cssText = "width:100%;accent-color:#34d399";
      pct.addEventListener("input", () => { pctLbl.textContent = `Speed: ${pct.value}%`; });
      pct.addEventListener("change", () => call("set_percentage", { percentage: parseInt(pct.value, 10) }));
      box.appendChild(el("div", { style: "margin-bottom:12px" }, [pctLbl, pct]));
    }
    if (Array.isArray(attrs.preset_modes) && attrs.preset_modes.length) {
      const sel = document.createElement("select");
      sel.style.cssText = selStyle;
      for (const m of attrs.preset_modes) {
        const o = document.createElement("option"); o.value = m; o.textContent = m;
        if (m === attrs.preset_mode) o.selected = true;
        sel.appendChild(o);
      }
      sel.addEventListener("change", () => call("set_preset_mode", { preset_mode: sel.value }));
      box.appendChild(el("div", { style: "margin-bottom:12px" }, [el("div", { style: lblStyle }, "Preset"), sel]));
    }
    const row = el("div", { style: "display:flex;gap:8px" });
    if (typeof attrs.oscillating === "boolean") {
      row.appendChild(el("button", { style: pillStyle(attrs.oscillating),
        onclick: () => call("oscillate", { oscillating: !attrs.oscillating }) }, attrs.oscillating ? "Oscillating ✓" : "Oscillate"));
    }
    if (attrs.direction === "forward" || attrs.direction === "reverse") {
      const nxt = attrs.direction === "forward" ? "reverse" : "forward";
      row.appendChild(el("button", { style: pillStyle(false), title: `Currently ${attrs.direction}`,
        onclick: () => call("set_direction", { direction: nxt }) }, attrs.direction === "forward" ? "⟳ Forward" : "⟲ Reverse"));
    }
    if (row.childNodes.length) box.appendChild(row);
    overlay.appendChild(box);
    document.body.appendChild(overlay);
    return;
  }

  // Dimmability is a CAPABILITY, not a current value: Home Assistant drops
  // the brightness attribute entirely while a light is off, so testing the
  // attribute hid the slider on every light that was off — which is exactly
  // when you open this card to set a level. supported_color_modes is
  // present in both states; every mode except onoff/unknown carries
  // brightness. ...and supported_color_modes is NOT stable for WLED: the
  // same unit reports ['rgb'] in one state and ['onoff'] in another as
  // segments and effects change. Three independent kinds of evidence, any
  // one of which is enough: the modes say so, the light is reporting a
  // brightness right now, or it is effect-capable (that hardware dims).
  const modes = Array.isArray(attrs.supported_color_modes) ? attrs.supported_color_modes : [];
  const dimmable = modes.some(m => m !== "onoff" && m !== "unknown")
    || typeof attrs.brightness === "number"
    || effectList.length > 0;
  const capLbl = "font-size:11px;color:#94a3b8;margin-bottom:5px;text-transform:uppercase;letter-spacing:.06em";
  if (dimmable) {
    const pct = (v) => Math.round((v / 255) * 100);
    const cur = typeof attrs.brightness === "number" ? attrs.brightness : 255;
    const briText = (v) => `Brightness: ${pct(v)}%` + (on ? "" : " · turns the light on");
    const briLbl = el("div", { style: capLbl }, briText(cur));
    const bri = document.createElement("input");
    bri.type = "range"; bri.min = "1"; bri.max = "255"; bri.value = String(cur);
    bri.style.cssText = "width:100%;accent-color:#fbbf24;height:20px;cursor:pointer";
    bri.addEventListener("input", () => { briLbl.textContent = briText(bri.value); });
    bri.addEventListener("change", async () => {
      try { await hass.callService("light", "turn_on", { entity_id: eid, brightness: parseInt(bri.value, 10) }); }
      catch (e) { toast("Could not set brightness", true); }
      setTimeout(rerender, 400);
    });
    box.appendChild(el("div", { style: "margin-bottom:12px" }, [briLbl, bri]));
  }

  // Colour has the same instability: a currently reported rgb_color is
  // proof on its own, so either kind of evidence keeps the control.
  if (modes.some(m => ["rgb", "rgbw", "rgbww", "hs", "xy"].includes(m)) || Array.isArray(attrs.rgb_color)) {
    const colorInput = document.createElement("input");
    colorInput.type = "color";
    colorInput.value = toHex(rgb);
    colorInput.style.cssText = "width:52px;height:32px;border:1px solid rgba(120,190,155,.25);border-radius:8px;"
      + "background:rgba(255,255,255,.04);cursor:pointer;padding:2px";
    colorInput.addEventListener("change", async () => {
      try { await hass.callService("light", "turn_on", { entity_id: eid, rgb_color: fromHex(colorInput.value) }); }
      catch (e) { toast("Could not set colour", true); }
      setTimeout(rerender, 400);
    });
    box.appendChild(el("div", { style: "margin-bottom:12px;display:flex;align-items:center;gap:10px" }, [
      el("span", { style: capLbl.replace("margin-bottom:5px;", "") }, "Color"), colorInput,
    ]));
  }

  if (effectList.length) {
    const effSel = document.createElement("select");
    effSel.style.cssText = "width:100%;background:rgba(15,26,18,.9);color:#8ee5b4;border:1px solid rgba(120,190,155,.28);"
      + "border-radius:8px;padding:7px;font-size:12px;cursor:pointer";
    for (const eff of effectList) {
      const o = document.createElement("option");
      o.value = eff; o.textContent = eff;
      if (eff === attrs.effect) o.selected = true;
      effSel.appendChild(o);
    }
    effSel.addEventListener("change", async () => {
      try { await hass.callService("light", "turn_on", { entity_id: eid, effect: effSel.value }); } catch (e) {}
    });
    box.appendChild(el("div", {}, [el("div", { style: capLbl }, "Effect"), effSel]));
    // The device registry's own configuration_url — WLED (and most ESPHome
    // devices) set this to the unit's local web UI, so it's already known
    // from the same registry fetch gatherLights uses for Brand, no extra
    // round trip. Only shown here, in the WLED-specific block, per the ask
    // ("when drilling into the wled controls") — a plain light has no
    // per-device web UI worth surfacing.
    if (api && api.ip) {
      box.appendChild(el("div", { style: "font-size:11px;color:#64748b;margin-top:8px;text-align:center" }, [
        "IP: ",
        el("a", {
          href: `http://${api.ip}`, target: "_blank", rel: "noopener noreferrer",
          style: "color:#8ee5b4;text-decoration:underline;cursor:pointer",
          onclick: (e) => e.stopPropagation(),
        }, api.ip),
      ]));
    }
  }

  overlay.appendChild(box);
  document.body.appendChild(overlay);
}

// Aggregate action: every light (and, separately, every fan) in a room or
// on a floor — optimistic per device, one service call per domain. Fans are
// never swept up by "all lights off": the sheet gives them their own button.
export async function setManyStates(hass, eids, turnOn, { toast, rerender } = {}){
  if (!hass || !eids.length) return;
  for (const eid of eids) setOptimistic(eid, turnOn ? "on" : "off");
  if (rerender) rerender();
  const byDomain = {};
  for (const eid of eids) (byDomain[eid.split(".")[0]] = byDomain[eid.split(".")[0]] || []).push(eid);
  let fail = 0;
  for (const [domain, ids] of Object.entries(byDomain)) {
    try { await hass.callService(domain, turnOn ? "turn_on" : "turn_off", { entity_id: ids }); }
    catch (e) { fail += ids.length; for (const eid of ids) clearOptimistic(eid); }
  }
  if (fail && toast) toast(`${fail} did not respond`, true);
  if (rerender) setTimeout(rerender, 700);
}

// Daylight for the Showcase ground, from the sun HA already tracks: 0 at
// civil-twilight end and below, 1 from +6° elevation up. Both hosts call
// this so the builder and the sidebar agree on what time it is.
export function sunAmbient(hass){
  const e = Number(hass?.states?.["sun.sun"]?.attributes?.elevation);
  return isFinite(e) ? Math.max(0, Math.min(1, (e + 6) / 12)) : 0;
}

// Ripple: fire-order for a tap — each fixture's delay is its real screen
// distance over a wave speed. Pure computation so it can be tested without
// timers; the caller owns the service calls.
export function rippleDelays(items, tap, pxPerMs){
  const v = Math.max(0.05, Number(pxPerMs)||0.35);
  return items
    .map(it=>({ eid: it.eid, delayMs: Math.round(Math.hypot(it.x-tap.x, it.y-tap.y)/v) }))
    .sort((a,b)=>a.delayMs-b.delayMs);
}

// ── Motion + occupancy pairing ───────────────────────────────────────────────
// Garry: "some of the sensors have two elements, motion and presence ...
// merge into one in a logical way" — a single mmWave/radar unit commonly
// exposes BOTH a momentary "motion" reading and a sustained "occupancy"
// reading (occupancy stays on through stillness a pure motion algorithm
// would clear) — same physical sensor, same room, two facets. Two
// INDEPENDENT signals must both hold before folding them into one marker,
// because "shares a device_id" alone is not safe: an alarm panel's
// expander module is ALSO one device_id across several DIFFERENT rooms'
// PIR zones (Garry: "think about what an alarm panel is, and how it
// works" — the device_id groups by the INTEGRATION POINT, not by physical
// sensing location).
//   1. STRUCTURE: the device reports EXACTLY one motion entity and
//      EXACTLY one occupancy entity — never more of either. A one-unit
//      radar sensor can only ever report one of each; a multi-zone hub
//      can report any count of either class, so this alone rules out a
//      hub whose zones happen to split across both classes, which "has
//      both classes present" would have wrongly merged.
//   2. NAMING: the two entities' names must reduce to the same root once
//      the class words are stripped ("Living Room Motion"/"Living Room
//      Occupancy" -> "livingroom" both). A hub's unrelated zone names
//      (Garry's real alarm panel: "Utility Room", "Nicole's Office",
//      "Spare Bedroom", "Master Bedroom Entry" — all one device_id, all
//      filed under the panel's OWN area "Utility") never coincide.
// Exported and pure so it is testable against synthetic registries.
function _nameRoot(name){
  return String(name || "").toLowerCase()
    .replace(/\b(motion|occupancy|presence|sensor)\b/g, "")
    .replace(/[^a-z0-9]/g, "");
}
export function computeMotionOccupancyPairs(entReg, states){
  const byDevice = {};
  for (const e of (entReg || [])) {
    if (!e.entity_id.startsWith("binary_sensor.") || !e.device_id) continue;
    const st = states && states[e.entity_id];
    const cls = st && st.attributes && st.attributes.device_class;
    if (cls !== "motion" && cls !== "occupancy") continue;
    (byDevice[e.device_id] = byDevice[e.device_id] || [])
      .push({ eid: e.entity_id, cls, name: st.attributes.friendly_name || e.entity_id });
  }
  const pairMap = {};   // secondary (occupancy) eid -> primary (motion) eid
  for (const group of Object.values(byDevice)) {
    const motionEnts = group.filter(g => g.cls === "motion");
    const occEnts = group.filter(g => g.cls === "occupancy");
    if (motionEnts.length !== 1 || occEnts.length !== 1) continue;
    const [m] = motionEnts, [o] = occEnts;
    const root = _nameRoot(m.name);
    if (!root || root !== _nameRoot(o.name)) continue;
    pairMap[o.eid] = m.eid;
  }
  return pairMap;
}

// Brand column resolution (Garry, 2026-09-08: "why are you not seeing the
// control4 lights as brand control4, sloppy... better logic for the search.
// Blanks in the brand column should be rare"). Root cause, verified live:
// manufacturer alone left ~60 Control4 devices behind an HC800 blank — HA's
// device registry genuinely has no manufacturer string for them — while a
// few C4 outlet modules DID report one, making the column read as
// inconsistently sloppy rather than uniformly empty. Every device still
// carries its OWNING INTEGRATION (identifiers[0][0], or the entity's own
// platform when no device exists at all), so that becomes the fallback
// brand — stylized for the integrations with a real retail name, title-
// cased for everything else so a future integration resolves with no code
// change ("control4" → "Control4" automatically). A small set of pure
// transport/container domains stay honestly blank — they carry no brand
// identity of their own to report.
const _BRAND_STYLED = {
  wled: "WLED", esphome: "ESPHome", hue: "Philips Hue", lifx: "LIFX",
  tplink: "TP-Link", tradfri: "IKEA", wiz: "WiZ", flux_led: "Magic Home",
  zha: "Zigbee", zwave_js: "Z-Wave", deconz: "deCONZ",
  lutron_caseta: "Lutron", homekit_controller: "HomeKit",
};
const _BRAND_BLANK = new Set([
  "mqtt", "template", "group", "light_group", "switch_as_x", "demo",
  "homeassistant", "input_boolean", "adaptive_lighting", "scene",
]);
export function resolveBrand(manufacturer, identDomain, platform){
  if (manufacturer) return manufacturer;
  const domain = identDomain || platform || null;
  if (!domain || _BRAND_BLANK.has(domain)) return null;
  if (_BRAND_STYLED[domain]) return _BRAND_STYLED[domain];
  return domain.split("_").map(w => w ? w[0].toUpperCase() + w.slice(1) : w).join(" ");
}

// ── Registry: entity_id → area name for every light ──────────────────────────
// One implementation with ONE staleness rule so the two views can never
// disagree about which room a light is in. `store` is a host-owned plain
// object ({reg, loading}); the map renders from the cached copy immediately
// and a background refresh (60s staleness) re-renders via onLoaded. The
// stale copy keeps serving while a refresh is in flight — the tab previously
// dropped every room assignment to "loading" placeholders during each
// refetch, so the two maps went visibly different for seconds at a time.
export function ensureLightsRegistry(store, hass, areas, onLoaded){
  const stale = !store.reg || Date.now() - store.reg.ts > 60000;
  const backoff = store.retryAfter && Date.now() < store.retryAfter;
  if (stale && hass && !store.loading && !backoff){
    store.loading = true;
    (async () => {
      try {
        // Multi-MB whole-house dump; bound it so a stale/half-open websocket
        // can't wedge `loading` true forever (both views already had this).
        const [reg, devReg] = await Promise.race([
          Promise.all([
            hass.callWS({ type: "config/entity_registry/list" }),
            hass.callWS({ type: "config/device_registry/list" }),
          ]),
          new Promise((_, rej) => setTimeout(() => rej(new Error("registry fetch timed out")), 30000)),
        ]);
        const areaIdToName = {};
        for (const a of (areas || [])) areaIdToName[a.id] = a.name;
        // device_id → area_id (entities commonly inherit area from device)
        const devAreaId = {};
        // device_id → manufacturer, for the index's Brand column. Many
        // Zigbee/Tuya devices report their manufacturer as a raw firmware
        // string (e.g. "_TZE204_ex3rcdha") rather than the name on the box
        // — that is what HA itself knows, so it is what this shows too;
        // sold-as branding for a white-label device is not something the
        // device registry has ever known. When a device has NO manufacturer
        // at all (every Control4 device behind an HC800, live-verified),
        // devIdentDomain below carries its owning integration instead —
        // resolveBrand is what turns either into the column's final text.
        const devManufacturer = {};
        // device_id → owning integration domain, from the device's own
        // identifiers (a list of [domain, unique_id] pairs — defensively
        // guarded, since a malformed/third-party entry could ship a bare
        // string or an empty tuple instead of the documented shape).
        const devIdentDomain = {};
        // device_id → IP/hostname, for the WLED control card. WLED (and most
        // ESPHome devices) set the device registry's own configuration_url
        // to the device's local web UI — http://<ip>/ — so this is already
        // in hand from the SAME fetch, no separate network call per device.
        const devHost = {};
        for (const d of (devReg || [])) {
          if (d.area_id) devAreaId[d.id] = d.area_id;
          if (d.manufacturer) devManufacturer[d.id] = d.manufacturer;
          const firstIdent = Array.isArray(d.identifiers) ? d.identifiers[0] : null;
          if (Array.isArray(firstIdent) && typeof firstIdent[0] === "string") devIdentDomain[d.id] = firstIdent[0];
          if (d.configuration_url) {
            try { devHost[d.id] = new URL(d.configuration_url).hostname || null; }
            catch (_) { devHost[d.id] = null; }
          }
        }
        const areaMap = {}, platformMap = {}, manufacturerMap = {}, ipMap = {};
        for (const e of (reg || [])) {
          // Fans and motion sensors ride the lights pipeline now, so their
          // room assignment resolves the same way a light's does. Temperature
          // sensors too — same sensor.* + device_class=="temperature" test
          // gatherLights itself uses. Missing this meant "Assign room…" in
          // the index visibly saved (HA's own registry had it) but the light
          // never left the "no room" list: this areaMap is the ONLY source
          // gatherLights reads area_name from, so a sensor.* this loop never
          // touched could never cluster onto the map or be placed at all —
          // found live, 2026-09-03 (Garry: "don't see any way to move the
          // temp in mapping, lights").
          // Air-quality sensors (2026-09-14) ride the same admission — the
          // same class set gatherLights uses — or "Assign room…" would save
          // in HA and never move the Q-tile, the 2026-09-03 bug all over again.
          // Humidity (2026-09-15): same reasoning, same fix. Lock (found in
          // the Phase 2a registry audit, 2026-09-19): the SAME bug, a fourth
          // time — lock.* has ridden gatherLights' own admission since gap
          // #8, but this SEPARATE copy never grew a lock clause, so a lock's
          // "Assign room…" visibly saved (HA's own registry had it) and the
          // lock never left "no room" — this areaMap is the only source
          // gatherLights reads area_name from. Now the SAME predicate
          // gatherLights itself uses (isAtlasEntity, light_codes.js), not a
          // second hand-typed copy that can drift from it again.
          if (!isAtlasEntity(e.entity_id, hass.states[e.entity_id]?.attributes)) continue;
          const aid = e.area_id || devAreaId[e.device_id] || null;
          areaMap[e.entity_id] = aid ? (areaIdToName[aid] || null) : null;
          // The platform that CREATED the entity — "partition" for an
          // ESPHome-style split strip, whatever ELSE reports it is not our
          // business. Same registry fetch, no extra round trip.
          platformMap[e.entity_id] = e.platform || null;
          manufacturerMap[e.entity_id] = resolveBrand(devManufacturer[e.device_id], devIdentDomain[e.device_id], e.platform);
          ipMap[e.entity_id] = devHost[e.device_id] || null;
        }
        // Same registry fetch, no extra round trip — hass.states is already
        // in hand for the device_class/name each pairing decision needs.
        const pairMap = computeMotionOccupancyPairs(reg, hass.states);
        store.reg = { ts: Date.now(), areaMap, platformMap, manufacturerMap, ipMap, pairMap };
        store.retryAfter = 0;
      } catch (_) {
        // A failed fetch must never become the authoritative answer. With a
        // previous copy, keep serving it and back the retry off; with none,
        // stay in the loading state (the map keeps its placeholder) instead of
        // caching an empty areaMap for 60s, which would tell the user every
        // light in the house has no room.
        if (store.reg) store.reg = { ts: Date.now(), areaMap: store.reg.areaMap, platformMap: store.reg.platformMap, manufacturerMap: store.reg.manufacturerMap, ipMap: store.reg.ipMap, pairMap: store.reg.pairMap };
        else store.retryAfter = Date.now() + 10000;
      } finally {
        store.loading = false;
        if (onLoaded) onLoaded();
      }
    })();
  }
  return {
    areaMap: store.reg ? store.reg.areaMap : {},
    platformMap: store.reg ? store.reg.platformMap : {},
    manufacturerMap: store.reg ? store.reg.manufacturerMap || {} : {},
    ipMap: store.reg ? store.reg.ipMap || {} : {},
    pairMap: store.reg ? store.reg.pairMap || {} : {},
    loading: !store.reg,
  };
}

// ── Light list: every light entity, canonical codes, display sort ────────────
// shapeOverrides = settings.light_shapes ({entity_id: shape}); a light with no
// override wears its derived shape, so the whole house is typed on first paint.
// tier = settings.tier: below `bright` every light is the default marker in
// the plain series — no shape, no override, no WLED/partition (see
// lightsHostForTier). platformMap = registry platformMap from
// ensureLightsRegistry, entity_id → the integration that created it.
// typeOverrides = settings.light_type_overrides — a PRO control: below pro
// the stored map is ignored entirely (detection rules), at pro it decides a
// light's class outright (see isWledLight/isPartitionLight).
// fan.* entities ride the same pipeline: same codes discipline (F-series),
// same rooms, same table, same map — a ceiling has fans on it.
// manufacturerMap = registry manufacturerMap from ensureLightsRegistry,
// entity_id → the device registry's manufacturer string. Informational
// only (identifying hardware, not a placement or styling control), so it
// is ungated — free tier sees it same as everyone else.
export function gatherLights(states, areaMap, shapeOverrides, tier, platformMap, typeOverrides, pairMap, manufacturerMap, nowMs){
  const paid = lightingUnlocked(tier);
  const pro = tierAtLeast(tier, "pro");
  // A verified motion+occupancy pair (see computeMotionOccupancyPairs) rides
  // the map as ONE marker on the motion entity — the occupancy half never
  // gets its own row. Garry: every motion-class marker should look and act
  // the same to a viewer, so the merged marker reads its OWN state and
  // last_changed only, below — an occupancy half that stays "on" after the
  // motion signal itself clears no longer holds the glow open. Without
  // this, a room with a dual-report sensor pulsed far longer than a room
  // with a plain PIR, for no difference a viewer looking at the map could
  // ever see (2026-09-04, live: G7TG and Living Room's paired occupancy
  // halves were both still "on" minutes after their own motion entities
  // had cleared, keeping those two markers lit while every unpaired PIR
  // in the house had already gone quiet).
  // primaryFor: secondary eid -> primary eid, used only to exclude the
  // occupancy half of a verified motion+occupancy pair from getting its own
  // row — it is not a separate device on this map, it is folded into its
  // motion partner (2026-09-04 finding: an unfolded occupancy half stayed
  // "on", and lit, minutes after its own motion entity had cleared).
  const primaryFor = pairMap || {};
  // isAtlasEntity (light_codes.js) is the one place "which entities does
  // Atlas admit at all" is declared — replaces a hand-typed OR-chain, one
  // clause per class, that used to live here AND, separately, in
  // ensureLightsRegistry's own areaMap filter above; the two had already
  // drifted once (lock admitted here since gap #8, never added to the
  // other copy — found in the Phase 2a registry audit, 2026-09-19).
  const lights = Object.keys(states || {})
    .filter(eid => isAtlasEntity(eid, states[eid].attributes) && !primaryFor[eid])
    .map(eid => ({
      entity_id:     eid,
      friendly_name: states[eid].attributes?.friendly_name || eid,
      state:         states[eid].state,   // "on" | "off" | "unavailable"
      // Captured now that binary_sensor. admits TWO distinct device_class
      // families (motion/occupancy and door/window) — isMotionSensor and
      // isDoorSensor (light_codes.js) both need this to tell their own
      // class apart post-gather; a bare domain-prefix check stopped being
      // sufficient the moment a second binary_sensor family was admitted.
      device_class:  states[eid].attributes?.device_class || null,
      area_name:     areaMap[eid] || null,
      // The user's word beats detection, at pro: forced class from
      // settings.light_type_overrides. Never applies to a fan or a lock
      // (the domain is the class) and never below pro.
      type_override: pro && !eid.startsWith("fan.") && !eid.startsWith("lock.") && typeOverrides ? (typeOverrides[eid] || null) : null,
      // The fan card's inputs, present only on fan.* entities.
      pct:           eid.startsWith("fan.") ? (Number.isFinite(Number(states[eid].attributes?.percentage)) ? Number(states[eid].attributes.percentage) : null) : null,
      preset_modes:  eid.startsWith("fan.") && Array.isArray(states[eid].attributes?.preset_modes) ? states[eid].attributes.preset_modes : null,
      preset_mode:   eid.startsWith("fan.") ? (states[eid].attributes?.preset_mode || null) : null,
      oscillating:   eid.startsWith("fan.") ? (typeof states[eid].attributes?.oscillating === "boolean" ? states[eid].attributes.oscillating : null) : null,
      direction:     eid.startsWith("fan.") ? (states[eid].attributes?.direction || null) : null,
      // When a motion/occupancy sensor last flipped state — while it is OFF
      // that IS when it last stopped tripping. The renderer fades a purple
      // "recently active" pulse over the 6h after this, past which it draws
      // nothing. For a temperature sensor this is instead "when did it last
      // REPORT" (last_updated, not last_changed — a steady room repeats the
      // same reading every poll, and last_changed would go stale even
      // though the device is actively still reporting), gating the "gave
      // the temperature in the last hour" rule before the number shows.
      // Either way it is HA's own top-level field, not an attribute. A
      // paired primary reads its OWN last_changed only — see the fold
      // comment above "state" for why the occupancy half is never
      // consulted, here or there.
      last_changed:  eid.startsWith("sensor.") ? (states[eid].last_updated || null)
                     : eid.startsWith("binary_sensor.") ? (states[eid].last_changed || null)
                     : null,
      // The reading itself, rounded — "inside is simply the temperature, 3
      // digit, and larger". Only sensor.* entities carry one; everything
      // else is null, same gating convention as the fan card's own fields.
      temperature:   eid.startsWith("sensor.") && states[eid].attributes?.device_class === "temperature"
                       && Number.isFinite(Number(states[eid].state))
                       ? Math.round(Number(states[eid].state)) : null,
      // The same reading, one class down — humidity, rounded the same way.
      humidity:      eid.startsWith("sensor.") && states[eid].attributes?.device_class === "humidity"
                       && Number.isFinite(Number(states[eid].state))
                       ? Math.round(Number(states[eid].state)) : null,
      // An air-quality reading, unrounded (airQualityBadness bands it), and
      // its unit for the index — only for the air-quality classes.
      air_value:     eid.startsWith("sensor.") && AIR_QUALITY_CLASSES.includes(states[eid].attributes?.device_class)
                       && Number.isFinite(Number(states[eid].state)) ? Number(states[eid].state) : null,
      air_unit:      eid.startsWith("sensor.") ? (states[eid].attributes?.unit_of_measurement || "") : "",
      // The graded WORD an enum air-quality sensor reports ("moderate") —
      // airQualityBadness bands it; the index shows the word itself.
      air_level:     states[eid].attributes?.device_class === "enum" && isAirQualityEntity(eid, states[eid].attributes)
                       ? String(states[eid].state).toLowerCase() : null,
      // The effect list is what makes a light WLED-class (W-series code,
      // purple border, effects dialog). Free tier: every light is a light.
      effect_list:   paid && Array.isArray(states[eid].attributes?.effect_list) ? states[eid].attributes.effect_list : null,
      // Which integration created the entity — "partition" is the P-series
      // signal (see isPartitionLight). Gated like effect_list: free tier
      // never sees a strip class at all.
      platform:      paid ? ((platformMap && platformMap[eid]) || null) : null,
      // The device registry's manufacturer string — identifying hardware,
      // never gated. Often a raw Zigbee/Tuya firmware signature rather than
      // a retail brand name; that is what HA itself knows, so it is what
      // this shows.
      brand:         (manufacturerMap && manufacturerMap[eid]) || null,
      // What the fixture is actually throwing right now. Showcase draws and
      // glows each light in its OWN colour at its OWN brightness; the working
      // map ignores both.
      rgb:           Array.isArray(states[eid].attributes?.rgb_color) ? states[eid].attributes.rgb_color : null,
      bri:           Number(states[eid].attributes?.brightness) || null,
      // Kelvin, ungated like rgb/bri: a white-only bulb's pool should read
      // warm or cool as the bulb actually is, not default amber.
      ct:            Number(states[eid].attributes?.color_temp_kelvin) || null,
      // Dimmable is a CAPABILITY and ungated like rgb/bri — it gates whether
      // a long-press has anything to offer, which is control, not a paid map
      // feature. Same evidence rule the popup itself uses: the modes say so,
      // or the light is reporting a brightness right now.
      dimmable:      (Array.isArray(states[eid].attributes?.supported_color_modes)
                        && states[eid].attributes.supported_color_modes.some(m => m !== "onoff" && m !== "unknown"))
                     || typeof states[eid].attributes?.brightness === "number",
    }))
    .sort((a, b) =>
      (a.area_name || "\xff").localeCompare(b.area_name || "\xff") ||
      a.friendly_name.localeCompare(b.friendly_name));
  assignLightCodes(lights);
  for (const l of lights) {
    // A pressed switch shows pressed until HA agrees or the claim times out.
    const eff = effectiveState(l.entity_id, l.state);
    l.state = eff.state; l.optimistic = eff.optimistic;
    l.shape = paid ? resolveLightShape(l, shapeOverrides) : "hex";
    // The last dimmed level is only visible while a light is on — remember
    // it here, on the pass both views already make, so off→on can restore it.
    if (l.state === "on" && typeof l.bri === "number" && l.bri >= 1) _recordBrightness(l.entity_id, l.bri);
    // Computed fresh on every gather (states poll), not cached on the
    // object across polls — a device recovering or going stale needs the
    // dot to move without waiting for something else to invalidate it.
    // nowMs is injectable (same pattern as buildIsoSVG's opts.nowMs) so a
    // test can pin elapsed time instead of racing the real clock.
    const h = healthOf(l, Number(nowMs) || Date.now());
    l.healthy = h.healthy; l.healthReason = h.reason;
  }
  return lights;
}

// Has this fixture actually been WORKED ON?
//
// Deliberately not "has a position": dropping a light where it really is is the
// baseline act of building the map, and on a finished house nearly every light
// has been dropped — so counting a move would leave the filter hiding nothing.
// Work means the fixture was described: given a size, an angle, a colour, or a
// shape of its own. The default amber every drop stamps is not a colour choice.
const _DROP_COLOR = "#fbbf24";
export function lightIsTouched(l, shapeOverrides, placements, linkedDoorEids) {
  // A door/window has no size, rotation or colour of its own to have
  // touched — that whole concept belonged to point-placement, which a door
  // stopped using in the step 1 correction (docs/IDEA_DOOR_WINDOW_BARRIERS.md).
  // Left unguarded, a door carrying a leftover light_positions_m entry from
  // BEFORE that correction (width_cm/rotation/colour, from when it still
  // drew as a draggable point) read as "touched": the Untouched count and
  // filter were both wrong, and its row offered a "Revert" that would have
  // re-written that same stale entry right back into the draft.
  //
  // Garry, 2026-09-10, live report: linking a door to a wall (the ONLY real
  // "work" a door has) still left it reading as untouched — "Hide untouched"
  // hid it right back, including the wall segment itself, with no way to
  // tell from the map that the link had actually worked. A door IS touched
  // once it is actually linked to a wall (rf_barriers_m.linked_entity_id) —
  // linkedDoorEids is that set, built by the caller from the fabric.
  if (l.isDoor) return !!(linkedDoorEids && linkedDoorEids.has(l.entity_id));
  const eid = l.entity_id;
  if (shapeOverrides && shapeOverrides[eid]) return true;
  const p = placements && placements[eid];
  if (!p) return false;
  // The same shape of problem as a door, for the same reason: a motion,
  // temperature, humidity, air-quality or lock sensor draws its class's
  // fixed glyph and border colour (TEMP_BORDER, AIR_BORDER, ...) — there is
  // no size, rotation or colour of its own to have touched, so the checks
  // below can never be satisfied by anything short of the undocumented
  // "bump the width to fake it" workaround every currently-visible one of
  // these was given by hand. Placement is the only real work these classes
  // have. Garry, 2026-09-15, live: "I did place the air sensors, the
  // placing tools don't work" — a fresh drop (draft or saved) sets x_m/y_m
  // alone, so it read as untouched and Hide-untouched hid it right back,
  // both while dragging and forever after, with no marker left to see or
  // save. Humidity is included pre-emptively — it draws the exact same
  // fixed glyph shape, so it would hit the identical trap the moment
  // anyone placed one. Flood joins the same list for the same reason
  // (2026-09-18) — its whole "reading" is the ring it draws while wet, no
  // shape/size/colour of its own either.
  if (hasFixedGlyph(l)) return true;
  if (Number(p.width_cm) > 0 || Number(p.height_cm) > 0) return true;
  if (Number(p.rotation)) return true;
  if (p.color && String(p.color).toLowerCase() !== _DROP_COLOR) return true;
  return false;
}

// Legend for the shape vocabulary — the map is only readable at a glance if
// the outlines are decodable. Only the kinds actually present are listed, so
// a house with no fans never shows a fan key.
function buildShapeLegend(el, lights){
  // "door" is deliberately never in this set: a door/window sensor never
  // draws a point marker on this map (see the barrier-drawing pass in
  // iso_lights.js) — a legend entry for a glyph that never appears would be
  // its own small case of "doesn't make sense" (Garry, 2026-09-08).
  const present = new Set(lights.map(l => l.shape).filter(k => k !== "door"));
  const row = el("div", { class: "lv-legend" });
  for (const [kind, label] of LIGHT_SHAPES) {
    if (kind === "auto" || !present.has(kind)) continue;
    const cell = el("span", { class: "lv-legend-chip" });
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("width", "16"); svg.setAttribute("height", "16");
    svg.setAttribute("viewBox", "0 0 18 18");
    svg.innerHTML = shapeSvg(kind, 9, 9, 6.5, 'fill="none" stroke="#94a3b8" stroke-width="1.6"');
    cell.appendChild(svg);
    cell.appendChild(el("span", {}, label));
    row.appendChild(cell);
  }
  return row.childNodes.length ? row : null;
}

// ── The map card: control row + iso map ──────────────────────────────────────
// host = {
//   el(tag,attrs,children)            DOM builder
//   floors, model, byRoom, hiddenEids, lightsByEid, lightsLoading
//   view                              live {floorGap, horizGap, focusIdx, zoom}
//                                     object owned by the host (persists across
//                                     host re-renders)
//   saveView() → Promise              persist floorGap/horizGap/focusIdx
//   onHexesBuilt(isoDiv, rebuild)     wire hex interactions after every build
// }
export function buildLightsMapCard(hostIn){
  // The tier decides what is drawn, whatever the host asked for. One place,
  // for both hosts — see lightsHostForTier.
  const host = lightsHostForTier(hostIn);
  const { el, view } = host;
  const floors = host.floors || [];
  const mapCard = el("div", { class: "card lv-mapcard" });
  // Layout v2 — see layoutTierFor's note. DISPLAY is the sidebar panel's
  // variant: that screen IS the house map, so nothing sits beside it but a
  // slim icon rail, and every bar below opens OVER the map as a drawer.
  const V2 = !!host.layoutV2;
  const DISPLAY = V2 && !!host.displayMode;
  if (V2) mapCard.classList.add("lv-v2");
  if (DISPLAY) mapCard.classList.add("lv-display");

  // Vacation Mode banner — pinned dead-center of the screen, on both Atlas
  // surfaces (this shared card) and nowhere else (Garry, 2026-09-21: "I
  // wanted the banner to show in the two atlas screens, and pinned dead
  // center until it is turned off"). Built fresh into the DOM only while
  // on, rather than toggled with a CSS class — panel.js's old top-bar
  // version used a bare `.hidden{display:none}` that a same-specificity
  // `.vacation-banner{display:flex}` declared later in the stylesheet
  // always beat, so the banner never actually hid or showed correctly.
  // Independent of V2/DISPLAY: it must show on the classic layout too.
  if (host.vacationModeEnabled) {
    const pctLbl = el("span", { style: "font-variant-numeric:tabular-nums" }, `${host.vacationModeIntensity || 100}%`);
    const slider = document.createElement("input");
    slider.type = "range"; slider.min = "5"; slider.max = "100"; slider.step = "5";
    slider.className = "lv-vacation-slider";
    slider.value = String(host.vacationModeIntensity || 100);
    slider.addEventListener("input", () => { pctLbl.textContent = `${slider.value}%`; });
    slider.addEventListener("change", () => host.onVacationModeIntensity && host.onVacationModeIntensity(parseInt(slider.value, 10)));
    const disableBtn = el("button", {
      class: "btn inline",
      onclick: async () => {
        disableBtn.disabled = true;
        const ok = host.onVacationModeDisable && await host.onVacationModeDisable();
        if (!ok) disableBtn.disabled = false;
      },
    }, "Disable");
    mapCard.appendChild(el("div", { class: "lv-vacation" }, [
      el("span", {}, "🌴"),
      el("span", { class: "lv-vacation-label" }, "Vacation mode on"),
      el("span", { class: "lv-vacation-slider-wrap" }, [
        el("span", { class: "muted", style: "font-size:11px" }, "Energy saving"),
        slider,
        pctLbl,
      ]),
      disableBtn,
    ]));
  }
  const fold = (name, title) => {
    const d = document.createElement("details");
    d.className = "lv-fold";
    if (_foldOpen(name)) d.open = true;
    const sum = document.createElement("summary");
    sum.textContent = title;
    d.appendChild(sum);
    const body = el("div", { class: "lv-fold-body" });
    d.appendChild(body);
    d.addEventListener("toggle", () => _foldSave(name, !!d.open));
    return { d, body };
  };
  const drawers = {};
  const mount = (node, name) => {
    if (!DISPLAY) { mapCard.appendChild(node); return; }
    if (!drawers[name]) {
      drawers[name] = el("div", { class: "lv-drawer" + (view.drawer === name ? " open" : "") });
      mapCard.appendChild(drawers[name]);
    }
    drawers[name].appendChild(node);
  };

  // Floors come from the FABRIC (which floors actually contain rooms/lights),
  // never from which photos happen to be uploaded. A floor with no plan image
  // is still a floor; a plan image is not a floor.
  const sortedLevels = fabricFrame(host.model, floors, view.floorGap, view.horizGap).levels;

  // Focus positions: All, each floor, each adjacent pair
  const isoPos = [null];
  for (let fi = 0; fi < sortedLevels.length; fi++) {
    isoPos.push(sortedLevels[fi]);
    if (fi < sortedLevels.length - 1) isoPos.push([sortedLevels[fi], sortedLevels[fi + 1]]);
  }
  const getFocusZ = (idx) => isoPos[Math.max(0, Math.min(idx, isoPos.length - 1))];
  const getFocusLbl = (idx) => {
    const pos = getFocusZ(idx);
    if (pos === null) return "All floors";
    const zArr = Array.isArray(pos) ? pos : [pos];
    return zArr.map(z => { const f = floors.find(x => x.level === z); return f ? (f.name || `L${z}`) : `L${z}`; }).join(" + ");
  };
  view.focusIdx = Math.max(0, Math.min(view.focusIdx, isoPos.length - 1));

  // The container is always the full width of the panel. Zoom scales the
  // DRAWING inside it and scrolls — resizing this box instead just slid the
  // map from side to side, because the SVG was pinned to its natural size.
  const isoDiv = document.createElement("div");
  isoDiv.className = "lv-stage";
  // Pan position, mirrored into view (the same persistent object zoom
  // already lives on) so it survives a full rebuild of this card, not just
  // an in-place rebuildISO() — the whole card (this isoDiv included) is
  // recreated FRESH on every poll-triggered re-render, and a fresh div
  // starts at scrollLeft/scrollTop 0 regardless of where the user had
  // panned to (2026-09-17 finding: this raced against a pinch-zoom just
  // finishing — the touch-action fix stopped the browser's own pinch from
  // fighting the app's, but a poll landing right after a real pinch could
  // still rebuild the card and silently reset the pan a second later,
  // reading as the exact same "placement auto-corrects" symptom through a
  // completely different mechanism). Restored once below, after the
  // initial rebuildISO() gives the stage something to scroll.
  isoDiv.addEventListener("scroll", () => {
    view.scrollLeft = isoDiv.scrollLeft;
    view.scrollTop = isoDiv.scrollTop;
  });

  // Semantic zoom (use surface): the codes leave the drawing below 100% and
  // come back above it, so a zoom change across that line is a rebuild, not
  // just a CSS width. The builder always shows codes (host.codeChip unset).
  let codesShown = null;
  const applyZoom = () => {
    const svg = isoDiv.querySelector("svg");
    if (!svg) return;
    if (V2) {
      // Not laid out yet (the host appends this card after it is built):
      // leave the SVG at its own width="100%" — the ResizeObserver below
      // calls back here the moment the stage has a real size.
      if (!(isoDiv.clientWidth > 0)) return;
      const vb = String(svg.getAttribute("viewBox") || "").trim().split(/\s+/).map(Number);
      const top = isoDiv.getBoundingClientRect().top;
      const availH = Math.max(260, (window.innerHeight || 800) - Math.max(0, top) - (DISPLAY ? 10 : 22));
      const fit = fitWidthPx(isoDiv.clientWidth - 22, availH - 22, vb[2], vb[3]);
      const wPx = `${Math.round(fit * (view.zoom || 1))}px`;
      if (fit > 0 && svg.style.width !== wPx) svg.style.width = wPx;
      svg.style.display = "block";
      svg.style.margin = "0 auto";
      const mh = `${Math.round(availH)}px`;
      if (isoDiv.style.maxHeight !== mh) isoDiv.style.maxHeight = mh;
      if (DISPLAY && isoDiv.style.minHeight !== mh) isoDiv.style.minHeight = mh;
    } else {
      svg.style.width = `${Math.round(view.zoom * 100)}%`;
    }
    if (host.codeChip && codesShown !== null && codesShown !== codesVisibleAtZoom(view.zoom)) rebuildISO();
  };
  // Zoom about a point (pinch midpoint / wheel): keep what is under the
  // fingers where it is by moving the stage's scroll with the size change.
  const zoomAbout = (next, cx, cy) => {
    const prev = view.zoom || 1;
    const bx = (isoDiv.scrollLeft + cx) / prev, by = (isoDiv.scrollTop + cy) / prev;
    view.zoom = next;
    applyZoom();
    isoDiv.scrollLeft = bx * next - cx;
    isoDiv.scrollTop = by * next - cy;
  };

  const rebuildISO = () => {
    // The map may hide MORE than the index does — "Hide untouched" is a view
    // filter on the drawing, not the persisted hidden set, so the table still
    // lists every light and stays the way to reach one that is filtered out.
    codesShown = host.codeChip ? codesVisibleAtZoom(view.zoom) : true;
    isoDiv.innerHTML = buildIsoSVG(host.model, host.byRoom, host.hiddenEidsMap || host.hiddenEids, getFocusZ(view.focusIdx),
      view.floorGap, view.horizGap, host.lightsByEid, host.lightsLoading, floors,
      { showcase: !!host.showcase, showcaseTheme: host.showcaseTheme || "classic",
        fitRooms: !!host.showcase && !!host.fitRooms,
        ambient: host.ambient, isolux: !!host.showcase && !!host.isolux,
        sceneField: host.showcase ? sceneFieldFor(host.sceneName, host.sceneAngle) : null,
        // The use-surface ergonomics — see buildIsoSVG for each. hideCodes
        // combines the existing zoom-driven auto-hide (preview/sidebar only)
        // with an explicit, persisted user preference (Garry, 2026-09-08:
        // "turn off the device identifier text") that applies everywhere,
        // build mode included — the two never fight, either one hiding is enough.
        codeChip: !!host.codeChip, hideCodes: !codesShown || !!host.hideDeviceCodes,
        classFilter: host.classFilter || null, hitHalo: !!host.hitHalo,
        collapseUnplaced: !!host.collapseUnplaced,
        locateEid: host.locateEid || null, dropMarker: !!host.onDropPlace,
        // When HA came up (model_get's ha_started_at) — a motion sensor whose
        // last_changed is just the restart's restored timestamp draws quiet.
        haStartedMs: Date.parse(host.model && host.model.ha_started_at) || 0,
        // In-progress door/window circle (see maps.js's _wireLightsBuild
        // click handler and _wireDoorCircle's drag handlers): drawn with a
        // live wall-gap preview so positioning it is visible feedback, not
        // a guess.
        barrierHit: !!host.barrierHit,
        doorCircleArmedEid: host.doorCircleArmedEid || null,
        doorCircleM: host.doorCircleM || null,
        // Working, proven beacons (Garry, 2026-09-09) — read-only, host
        // provides the already-filtered list or nothing at all. Off by
        // default (Garry, 2026-09-09: "should be selectable, and off by
        // default") — showBeacons is the opt-in.
        beacons: host.showBeacons ? (host.beacons || null) : null,
        // {entity_id: epoch-s of its most recent "on"} — flood_latch.py.
        // Ungated: a flood alarm is safety-relevant, not a paid convenience.
        floodLatches: host.floodLatches || {},
        automorph: !!host.automorph,
        automorphRoomPct: view.automorphLivePct !== undefined ? view.automorphLivePct : (host.automorphRoomPct || 0),
        automorphHardness: view.automorphLiveHardness !== undefined ? view.automorphLiveHardness : (host.automorphHardness || 0),
        automorphStyle: host.automorphStyle || "glow",
        automorphSubtlety: view.automorphLiveSubtlety !== undefined ? view.automorphLiveSubtlety : (host.automorphSubtlety || 0) });
    applyZoom();
    host.onHexesBuilt(isoDiv, rebuildISO);
  };
  // Pinch on the drawing zooms about the fingers; one finger pans (the stage
  // scrolls). Wired once per card — the stage element outlives rebuilds.
  wireStageTouch(isoDiv, view, zoomAbout);

  // Ripple: while armed, one tap anywhere on the drawing (a fixture hex
  // included — the wave starts THERE) hands the caller each placed fixture's
  // fire delay from its real distance to the tap. Coordinates go through the
  // SVG's own screen matrix so zoom and scroll cannot skew the wave.
  if (host.rippleArmed && host.onRippleFire) {
    isoDiv.addEventListener("click", (e) => {
      const svg = isoDiv.querySelector("svg");
      if (!svg || !svg.createSVGPoint) return;
      const p = svg.createSVGPoint(); p.x = e.clientX; p.y = e.clientY;
      const ctm = svg.getScreenCTM && svg.getScreenCTM();
      if (!ctm) return;
      const tap = p.matrixTransform(ctm.inverse());
      const items = [...isoDiv.querySelectorAll('.lhex[data-placed="1"]')].map(g => ({
        eid: g.dataset.eid, x: Number(g.dataset.cx), y: Number(g.dataset.cy),
      }));
      if (items.length) host.onRippleFire(rippleDelays(items, tap, 0.35));
    }, { once: true });
  }

  // Grouped, not a flat run of controls: view shaping, then saving, then zoom.
  // A single undifferentiated row of eight things reads as clutter and gives
  // no clue which control affects what. Everything here wears the lv-
  // vocabulary from styles.css (both hosts load that sheet) — the toggles are
  // quiet glass at rest and light up in their own tone when on, so which
  // modes are active reads at a glance.
  // Sticky only where the host asks for it (Garry, 2026-09-09: "the scroll
  // hides the controls, needs fixing for mapping area, but works better
  // this way in lights and overview") — the builder tab is long enough to
  // scroll the controls out of reach; the sidebar card (host.stickyToolbar
  // unset) already stays reachable as it is, so it is left untouched.
  const ctrlRow = el("div", { class: "lv-toolbar" + (host.stickyToolbar ? " lv-toolbar-sticky" : "") });
  const SEP = () => el("span", { class: "lv-sep" }, "");
  // A GROUP header (see .lv-grouplbl) — "everything until the next one of
  // these is the same topic," not a value label for the one control beside
  // it. One per logical cluster: Presentation, Filters, Automorph, Layout &
  // view — the same clusters the SEP()s already split the row into, now
  // named so the split reads as intentional instead of just whitespace.
  const groupLbl = (text) => el("span", { class: "lv-grouplbl" }, text);

  // Showcase — first in the row because it changes everything to its right.
  // Only the Mapping tab offers it (the sidebar host passes no handler), and it
  // is a VIEW: every fixture stays exactly where it was put and stays editable.
  if (host.onShowcase) {
    ctrlRow.appendChild(groupLbl("Presentation"));
    ctrlRow.appendChild(el("button", {
      class: "lv-tgl tone-violet" + (host.showcase ? " on" : ""),
      title: "Presentation rendering — real fixture colour, light pools, contact shadows",
      onclick: () => host.onShowcase(!host.showcase),
    }, host.showcase ? "✦ Showcase ✓" : "✦ Showcase"));

    // v2: Theme / Fit room / Isolux / Scene / Ripple only exist while
    // Showcase is on — five more controls the moment it is. Folded.
    let presTarget = ctrlRow;
    if (V2 && host.showcase) {
      const pf = fold("showcase", "Showcase options");
      ctrlRow.appendChild(pf.d);
      presTarget = pf.body;
    }
    // Theme — which of 21 distinct palettes Showcase paints with (Garry,
    // 2026-09-10: "let's build all 20" — one design bake-off, judged live,
    // turned into a real dropdown the same way Automorph's Style pulldown
    // already works). "Classic" reproduces today's look exactly; every
    // other entry is a full re-skin of the same fixtures, rooms and floor
    // stack — nothing about WHAT draws changes, only the palette it draws
    // with.
    if (host.showcase && host.onShowcaseTheme) {
      const themeSel = document.createElement("select");
      themeSel.className = "lv-select";
      themeSel.title = "Showcase's colour palette and material treatment";
      for (const [kind, label] of SHOWCASE_THEME_OPTIONS) {
        const o = el("option", { value: kind }, label);
        if (kind === (host.showcaseTheme || "classic")) o.selected = true;
        themeSel.appendChild(o);
      }
      themeSel.addEventListener("change", () => host.onShowcaseTheme(themeSel.value));
      presTarget.appendChild(el("span", { class: "lv-lbl" }, "Theme"));
      presTarget.appendChild(themeSel);
    }

    // Fit to room — only offered while Showcase is on, because it is a
    // constraint on the presentation, not an edit. Stored measurements are
    // never rewritten: turn it off and the typed sizes come straight back.
    if (host.showcase && host.onFitRooms) {
      presTarget.appendChild(el("button", {
        class: "lv-tgl tone-ember" + (host.fitRooms ? " on" : ""),
        title: "No fixture is drawn larger than the room it is in, with a small "
          + "gap to the walls. Stored measurements are not changed.",
        onclick: () => host.onFitRooms(!host.fitRooms),
      }, host.fitRooms ? "⊞ Fit room ✓" : "⊞ Fit room"));
    }

    // Isolux — the engineer's overlay: relative-illuminance contours computed
    // on a metre grid from the fixtures' real positions and brightness.
    if (host.showcase && host.onIsolux) {
      presTarget.appendChild(el("button", {
        class: "lv-tgl tone-green" + (host.isolux ? " on" : ""),
        title: "Relative illuminance contours on a real-metre grid — three bands "
          + "at fractions of this floor's own peak.",
        onclick: () => host.onIsolux(!host.isolux),
      }, host.isolux ? "☼ Isolux ✓" : "☼ Isolux"));
    }

    // Spatial scene — a colour field across the floor; each fixture PREVIEWS
    // the colour it would take at its own metres. Apply sends exactly the
    // previewed colours; nothing changes until then.
    if (host.showcase && host.onScene) {
      const cur = host.sceneName || null;
      presTarget.appendChild(el("button", {
        class: "lv-tgl tone-pink" + (cur ? " on" : ""),
        title: "Cycle spatial scene previews — the field's colour at each fixture's "
          + "own position. Nothing is applied until you press Apply.",
        onclick: () => {
          const i = SCENE_NAMES.indexOf(cur);
          host.onScene(i >= SCENE_NAMES.length - 1 ? null : SCENE_NAMES[i + 1]);
        },
      }, cur ? `✨ ${cur}` : "✨ Scene"));
      if (cur && host.onSceneAngle) {
        presTarget.appendChild(el("button", {
          class: "lv-act",
          title: "Rotate the scene's axis 45°",
          onclick: () => host.onSceneAngle(((Number(host.sceneAngle)||0) + 45) % 360),
        }, "↻"));
      }
      if (cur && host.onSceneApply) {
        presTarget.appendChild(el("button", {
          class: "lv-act primary",
          title: "Send every lit fixture the colour it is previewing",
          onclick: () => host.onSceneApply(sceneFieldFor(cur, host.sceneAngle)),
        }, "Apply"));
      }
    }

    // Ripple — arm, then tap the map: a wave lights outward from the tap at
    // real-distance timing. A brightness pulse only, and only on lights that
    // are already on.
    if (host.showcase && host.onRipple) {
      presTarget.appendChild(el("button", {
        class: "lv-tgl tone-blue" + (host.rippleArmed ? " on" : ""),
        title: "Arm, then tap the map — lights pulse outward from the tap in "
          + "real-distance order. Only lights already on take part.",
        onclick: () => host.onRipple(!host.rippleArmed),
      }, host.rippleArmed ? "◉ Tap the map…" : "◉ Ripple"));
    }
  }

  // A rendering mode (Showcase and its family) reads as one thing; "Hide
  // untouched" is an independent filter, not part of that family — split so
  // the row groups by what a button actually DOES, not just where it sits.
  if (host.onHideUntouched || host.onHideDeviceCodes || host.onShowBeacons) ctrlRow.appendChild(groupLbl("Filters"));

  // Hide untouched — show only the fixtures that have actually been worked on.
  // MOVING a light is not work on the light: dropping it where it really is is
  // the baseline, and on a full house nearly everything has been dropped, so
  // counting a move as "touched" would hide nothing.
  if (host.onHideUntouched) {
    const n = host.untouchedCount || 0;
    ctrlRow.appendChild(el("button", {
      class: "lv-tgl tone-teal" + (host.hideUntouched ? " on" : ""),
      title: "Show only lights that have been resized, rotated, recoloured or "
        + "given a shape. Moving a light does not count as touching it.",
      onclick: () => host.onHideUntouched(!host.hideUntouched),
    }, host.hideUntouched ? `◫ Untouched (${n})` : "◫ Hide untouched"));
  }
  // Hide device codes (Garry, 2026-09-08: "turn off the device identifier
  // text") — a persisted preference, independent of the existing zoom-driven
  // auto-hide in preview/sidebar mode (codesVisibleAtZoom in rebuildISO
  // above); this toggle applies everywhere, build mode included, and either
  // mechanism hiding is enough — see the hideCodes line in rebuildISO.
  if (host.onHideDeviceCodes) {
    ctrlRow.appendChild(el("button", {
      class: "lv-tgl tone-teal" + (host.hideDeviceCodes ? " on" : ""),
      title: "Hide the A01/M08-style code label on every marker, everywhere "
        + "this map renders — a decluttered view when you just want the shapes.",
      onclick: () => host.onHideDeviceCodes(!host.hideDeviceCodes),
    }, host.hideDeviceCodes ? "▤ Codes hidden" : "▤ Hide codes"));
  }
  // Working, proven beacons (Garry, 2026-09-09) — read-only overlay, off by
  // default: "Show beacons on lighting page should be selectable, and off
  // by default." Their name text follows the Hide codes toggle above (see
  // the HIDECODES check beside the beacon label in buildIsoSVG).
  if (host.onShowBeacons) {
    ctrlRow.appendChild(el("button", {
      class: "lv-tgl tone-teal" + (host.showBeacons ? " on" : ""),
      title: "Show working, identified beacons on the map — a read-only dot "
        + "at each one's last known position, same as Overview. Nothing to place.",
      onclick: () => host.onShowBeacons(!host.showBeacons),
    }, host.showBeacons ? "◉ Beacons shown" : "◉ Show beacons"));
  }
  // Automorph (Garry, 2026-09-07) — its own family, independent of Showcase:
  // it works the same in either rendering mode, so it is not nested under
  // the Showcase gate above. An aesthetic-only aura for now (see
  // automorphAuraSvg in iso_lights.js): the icon itself is untouched.
  if (host.onAutomorph) {
    ctrlRow.appendChild(groupLbl("Automorph"));
    ctrlRow.appendChild(el("button", {
      class: "lv-tgl tone-pink" + (host.automorph ? " on" : ""),
      title: "Grows a soft aura behind each placed fixture toward its own room's "
        + "shape — an aesthetic overlay, the fixture's own icon is unchanged.",
      onclick: () => host.onAutomorph(!host.automorph),
    }, host.automorph ? "◈ Automorph ✓" : "◈ Automorph"));
    // The four Automorph tuning controls read as one cluster — a faint
    // shaded pill (lv-ctrlgroup, styles.css) sets them apart from the mode
    // toggles beside them, the same way lv-zoomseg already set the zoom
    // trio apart. Garry, 2026-09-09: "put sliders in sets with a slight
    // shading change to differentiate."
    const automorphGroup = host.automorph ? el("span", { class: "lv-ctrlgroup" }) : null;
    if (host.automorph && host.onAutomorphRoomPct) {
      // Live while dragging (rebuildISO directly, no network — same "fast
      // local preview" the Floor gap slider below uses), persisted only on
      // release, so a drag does not spam settingsSet.
      const pctLbl = el("span", { class: "lv-val", style: "min-width:34px" }, `${host.automorphRoomPct || 0}%`);
      const pctSlider = document.createElement("input");
      pctSlider.type = "range"; pctSlider.min = "0"; pctSlider.max = "100";
      pctSlider.className = "lv-range";
      pctSlider.style.width = "90px";
      pctSlider.value = String(host.automorphRoomPct || 0);
      pctSlider.addEventListener("input", () => {
        view.automorphLivePct = parseInt(pctSlider.value, 10);
        pctLbl.textContent = `${view.automorphLivePct}%`;
        rebuildISO();
      });
      pctSlider.addEventListener("change", () => host.onAutomorphRoomPct(parseInt(pctSlider.value, 10)));
      automorphGroup.appendChild(el("span", { class: "lv-lbl" }, "Room %"));
      automorphGroup.appendChild(pctSlider);
      automorphGroup.appendChild(pctLbl);
    }
    // Slider 2 — hardness, centered at 0 ("this slider starts in the
    // center" — Garry, 2026-09-06): negative sharpens the aura's edges
    // outward into a spikier silhouette, positive smooths them into a
    // closed spline. Same live-preview-then-persist pattern as room_pct.
    if (host.automorph && host.onAutomorphHardness) {
      const hardLbl = el("span", { class: "lv-val", style: "min-width:34px" }, String(host.automorphHardness || 0));
      const hardSlider = document.createElement("input");
      hardSlider.type = "range"; hardSlider.min = "-100"; hardSlider.max = "100";
      hardSlider.className = "lv-range";
      hardSlider.style.width = "90px";
      hardSlider.title = "Edge hardness — left sharpens, right softens, centre is unchanged";
      hardSlider.value = String(host.automorphHardness || 0);
      hardSlider.addEventListener("input", () => {
        view.automorphLiveHardness = parseInt(hardSlider.value, 10);
        hardLbl.textContent = String(view.automorphLiveHardness);
        rebuildISO();
      });
      hardSlider.addEventListener("change", () => host.onAutomorphHardness(parseInt(hardSlider.value, 10)));
      automorphGroup.appendChild(el("span", { class: "lv-lbl" }, "Hardness"));
      automorphGroup.appendChild(hardSlider);
      automorphGroup.appendChild(hardLbl);
    }
    // Style — which of several distinct visual treatments paints the same
    // morphed ring (Garry, 2026-09-07: "add a style pulldown to build more
    // morph concepts into the build, I can always remove them later").
    if (host.automorph && host.onAutomorphStyle) {
      const styleSel = document.createElement("select");
      styleSel.className = "lv-select";
      styleSel.title = "Automorph's visual treatment";
      for (const [kind, label] of AUTOMORPH_STYLES) {
        const o = el("option", { value: kind }, label);
        if (kind === (host.automorphStyle || "glow")) o.selected = true;
        styleSel.appendChild(o);
      }
      styleSel.addEventListener("change", () => host.onAutomorphStyle(styleSel.value));
      automorphGroup.appendChild(el("span", { class: "lv-lbl" }, "Style"));
      automorphGroup.appendChild(styleSel);
    }
    // Subtlety, 0-100 (Garry, 2026-09-07: "a slider for subtlety, so you
    // can dial from objects looking full, to almost completely lost in
    // background... with shades, thinner lines"). Same live-preview-then-
    // persist pattern as the other two sliders.
    if (host.automorph && host.onAutomorphSubtlety) {
      const subLbl = el("span", { class: "lv-val", style: "min-width:34px" }, `${host.automorphSubtlety || 0}%`);
      const subSlider = document.createElement("input");
      subSlider.type = "range"; subSlider.min = "0"; subSlider.max = "100";
      subSlider.className = "lv-range";
      subSlider.style.width = "90px";
      subSlider.title = "Subtlety — how much the aura fades toward the background";
      subSlider.value = String(host.automorphSubtlety || 0);
      subSlider.addEventListener("input", () => {
        view.automorphLiveSubtlety = parseInt(subSlider.value, 10);
        subLbl.textContent = `${view.automorphLiveSubtlety}%`;
        rebuildISO();
      });
      subSlider.addEventListener("change", () => host.onAutomorphSubtlety(parseInt(subSlider.value, 10)));
      automorphGroup.appendChild(el("span", { class: "lv-lbl" }, "Subtlety"));
      automorphGroup.appendChild(subSlider);
      automorphGroup.appendChild(subLbl);
    }
    if (automorphGroup && automorphGroup.children.length) {
      if (V2) {
        const af = fold("automorph", "Automorph tuning");
        af.body.appendChild(automorphGroup);
        ctrlRow.appendChild(af.d);
      } else ctrlRow.appendChild(automorphGroup);
    }
  }
  if (!V2) ctrlRow.appendChild(groupLbl("Layout & view"));

  // Reset needs to put the focus control back too — see resetFocusCtl below.
  let resetFocusCtl = () => {};

  // Floor / Spacing / L-R are the other slider set — where the storeys sit,
  // not what's drawn on them — grouped in their own shaded pill for the
  // same reason Automorph's own three are (Garry, 2026-09-09: "put sliders
  // in sets with a slight shading change to differentiate").
  const layoutGroup = el("span", { class: "lv-ctrlgroup" });

  // Floor focus slider
  if (sortedLevels.length > 1) {
    const focusLbl = el("span", { class: "lv-val", style: "min-width:80px" }, getFocusLbl(view.focusIdx));
    const focusSlider = document.createElement("input");
    focusSlider.type = "range"; focusSlider.min = "0"; focusSlider.max = String(isoPos.length - 1);
    focusSlider.className = "lv-range";
    focusSlider.style.width = "96px";
    focusSlider.value = String(view.focusIdx);
    focusSlider.addEventListener("input", () => {
      view.focusIdx = parseInt(focusSlider.value, 10);
      focusLbl.textContent = getFocusLbl(view.focusIdx);
      rebuildISO();
      // The floor chips below mirror the slider.
      for (const b of mapCard.querySelectorAll("button")) if (b._floorIdx !== undefined) b.classList.toggle("on", b._floorIdx === view.focusIdx);
    });
    layoutGroup.appendChild(el("span", { class: "lv-lbl" }, "Floor"));
    layoutGroup.appendChild(focusSlider);
    layoutGroup.appendChild(focusLbl);
    resetFocusCtl = (idx = 0) => { focusSlider.value = String(idx); focusLbl.textContent = getFocusLbl(idx); };
  }

  // Floor gap slider
  const gapLbl = el("span", { class: "lv-val" }, String(view.floorGap));
  const gapSlider = document.createElement("input");
  // 60–340 matches the backend's clamp exactly. A wider slider silently stored
  // a different spacing than the one on screen.
  gapSlider.type = "range"; gapSlider.min = "60"; gapSlider.max = "340"; gapSlider.step = "10";
  gapSlider.className = "lv-range";
  gapSlider.style.width = "78px";
  gapSlider.value = String(view.floorGap);
  gapSlider.addEventListener("input", () => {
    view.floorGap = parseInt(gapSlider.value, 10);
    gapLbl.textContent = String(view.floorGap);
    rebuildISO();
  });
  layoutGroup.appendChild(el("span", { class: "lv-lbl" }, "Spacing"));
  layoutGroup.appendChild(gapSlider);
  layoutGroup.appendChild(gapLbl);

  // L/R horizontal offset slider
  const horizLbl = el("span", { class: "lv-val" }, String(view.horizGap));
  const horizSlider = document.createElement("input");
  horizSlider.type = "range"; horizSlider.min = "-120"; horizSlider.max = "120"; horizSlider.step = "10";
  horizSlider.className = "lv-range";
  horizSlider.style.width = "78px";
  horizSlider.value = String(view.horizGap);
  horizSlider.addEventListener("input", () => {
    view.horizGap = parseInt(horizSlider.value, 10);
    horizLbl.textContent = String(view.horizGap);
    rebuildISO();
  });
  layoutGroup.appendChild(el("span", { class: "lv-lbl" }, "L / R"));
  layoutGroup.appendChild(horizSlider);
  layoutGroup.appendChild(horizLbl);
  // v2: set once when the floors are first stacked, so folded — and not on
  // the display panel at all: Save view writes EVERYONE's default, which
  // makes these setup controls, and setup lives in Mapping -> Atlas.
  const layoutFold = V2 && !DISPLAY ? fold("layout", "Layout & view") : null;
  const layoutTarget = layoutFold ? layoutFold.body : ctrlRow;
  if (!V2) { ctrlRow.appendChild(SEP()); ctrlRow.appendChild(layoutGroup); }
  else if (layoutFold) layoutFold.body.appendChild(layoutGroup);

  // Save / Reset view buttons + status label
  const saveLbl = el("span", { class: "lv-status" }, "");
  const saveBtn = el("button", { class: "lv-act", style: "margin-left:4px",
    onclick: async () => {
      saveBtn.disabled = true;
      try {
        await host.saveView();
        saveLbl.textContent = "Saved ✓";
        setTimeout(() => { saveLbl.textContent = ""; }, 2000);
      } catch (e) { saveLbl.textContent = "Error"; }
      saveBtn.disabled = false;
    },
  }, "Save view");
  const resetBtn = el("button", { class: "lv-act",
    onclick: async () => {
      view.floorGap = 150; view.horizGap = 0; view.focusIdx = 0; view.zoom = 1.0;
      gapSlider.value = "150"; gapLbl.textContent = "150";
      horizSlider.value = "0"; horizLbl.textContent = "0";
      resetFocusCtl();          // the map goes back to All floors — say so
      rebuildISO();
      resetBtn.disabled = true;
      try {
        await host.saveView();
        saveLbl.textContent = "Reset ✓";
        setTimeout(() => { saveLbl.textContent = ""; resetBtn.disabled = false; }, 2000);
      } catch (e) { saveLbl.textContent = "Error"; resetBtn.disabled = false; }
    },
  }, "Reset view");
  if (!DISPLAY) {
    layoutTarget.appendChild(saveBtn);
    layoutTarget.appendChild(resetBtn);
    layoutTarget.appendChild(saveLbl);
  }
  if (layoutFold) ctrlRow.appendChild(layoutFold.d);

  // Zoom controls — one segmented cluster rather than three loose buttons
  ctrlRow.appendChild(SEP());
  ctrlRow.appendChild(el("span", { class: "lv-lbl" }, "Zoom"));
  ctrlRow.appendChild(el("span", { class: "lv-zoomseg" }, [
    el("button", { title: "Zoom out", onclick: () => {
      view.zoom = Math.max(0.4, Math.round((view.zoom - 0.1) * 10) / 10);
      applyZoom();
    } }, "−"),
    el("button", { title: "Reset zoom", onclick: () => {
      view.zoom = 1.0; applyZoom();
    } }, "100%"),
    el("button", { title: "Zoom in", onclick: () => {
      view.zoom = Math.min(2.5, Math.round((view.zoom + 0.1) * 10) / 10);
      applyZoom();
    } }, "+"),
  ]));

  // Garry, 2026-09-09: "all sliders need a ? to bring up a card that
  // completely describes their function" — this row had none at all
  // (Overview's matching row does, via overview_3d_controls). Builder
  // only: the sidebar never sets host.helpBtn, since it never sets the
  // Automorph/Gap/Floor/L-R controls this card explains either.
  if (host.helpBtn) ctrlRow.appendChild(host.helpBtn("lights_build_controls"));
  // Layout v2 is a trial (Garry: "let's try it, make it reversable") — one
  // click back to the classic layout, and one click forward again.
  if (host.onLayoutV2) {
    ctrlRow.appendChild(el("button", {
      class: "lv-act",
      title: V2 ? "Go back to the classic Atlas layout" : "Try the new Atlas layout — packed toolbar, the map fitted to the screen, the table beside it on a wide monitor",
      onclick: () => host.onLayoutV2(!V2),
    }, V2 ? "▦ Classic layout" : "▦ New layout"));
  }

  mount(ctrlRow, "view");

  // Presets — a saved snapshot of the whole Showcase "look" bundle (Theme +
  // Automorph + Fit room/Isolux/Beacons/Codes/Untouched). Garry, 2026-09-10: "we now
  // have thousands of combinations in the mapping, lights setup, we need to
  // build a preset system... clearly separate from all other settings on
  // that tab." Deliberately its OWN box below the toolbar (see .lv-presetbar
  // in styles.css) rather than one more control folded into the row above —
  // applying a preset changes several unrelated settings at once, a bigger
  // action than any single toggle beside it, and it reads that way too.
  // Everyday panels (Garry, 2026-09-11: "a small preset button in the lights
  // tab for quick changes") get quick-apply only — no Save/Delete, the same
  // read-only-for-modes line this card draws for showcase/automorph/etc.
  // elsewhere: editing the underlying looks stays in Mapping -> Lights.
  const presetBars = [];
  if (host.showcase && (host.onSavePreset || host.onApplyPreset)) {
    const presets = host.showcasePresets || [];
    const presetBar = el("div", { class: "lv-presetbar" });
    presetBar.appendChild(el("span", { class: "lv-lbl" }, "Presets"));

    const presetSel = document.createElement("select");
    presetSel.className = "lv-select";
    presetSel.title = "A saved combination of Theme, Automorph, the other Showcase controls, and the Floor / Spacing / L-R layout";
    // "▾" in the option text, because this select and the name box beside it
    // are styled as the same dark pill (lv-select / lv-preset-name) and read
    // as two typing fields — Garry, 2026-09-16: "you are asking for typing in
    // two places, one works, other not". The one that "didn't" was this
    // dropdown eating keystrokes. The chevron says which is which.
    presetSel.appendChild(el("option", { value: "" }, presets.length ? "▾ Choose a saved look" : "▾ No saved looks yet"));
    for (const p of presets) presetSel.appendChild(el("option", { value: p.name }, p.name));
    presetBar.appendChild(presetSel);

    const presetStatus = el("span", { class: "lv-status" }, "");
    const flashPreset = (msg) => { presetStatus.textContent = msg; setTimeout(() => { presetStatus.textContent = ""; }, 2000); };

    presetBar.appendChild(el("button", {
      class: "lv-act primary",
      title: "Apply this preset's Theme, Automorph, other Showcase settings and layout (Floor / Spacing / L-R)",
      onclick: async () => {
        const p = presets.find((x) => x.name === presetSel.value);
        if (!p) { flashPreset("Pick a preset first"); return; }
        await host.onApplyPreset(p.values);
        flashPreset("Applied ✓");
      },
    }, "Apply"));

    if (host.onSavePreset) {
      const nameInput = document.createElement("input");
      nameInput.type = "text";
      nameInput.className = "lv-preset-name";
      nameInput.placeholder = "Type a name to save as…";
      nameInput.maxLength = 60;
      presetBar.appendChild(nameInput);

      presetBar.appendChild(el("button", {
        class: "lv-act",
        title: "Save the current Theme, Automorph, other Showcase settings and layout (Floor / Spacing / L-R) under this name — overwrites a saved look with the same name",
        onclick: async () => {
          const name = nameInput.value.trim();
          if (!name) { flashPreset("Type a name first"); return; }
          await host.onSavePreset(name);
          nameInput.value = "";
          flashPreset("Saved ✓");
        },
      }, "Save current"));
    }

    if (host.onDeletePreset) {
      const delBtn = el("button", { class: "lv-act", title: "Delete the selected preset" }, "Delete");
      delBtn.disabled = !presetSel.value;
      delBtn.addEventListener("click", async () => {
        if (!presetSel.value) return;
        const name = presetSel.value;
        await host.onDeletePreset(name);
        flashPreset("Deleted");
      });
      presetSel.addEventListener("change", () => { delBtn.disabled = !presetSel.value; });
      presetBar.appendChild(delBtn);
    }
    presetBar.appendChild(presetStatus);

    presetBars.push({ key: "look", label: "Look", node: presetBar });
  }

  // Whole House Presets — its own box, like the Showcase Presets bar above,
  // but about the HOUSE rather than the map's look, so it shows whether or
  // not Showcase is on. Apply changes every light and fan at once, so it is
  // a two-click confirm (the same pattern as the flood Reset and untag).
  if (host.onWholeHouseApply && tierAtLeast(host.tier, "pro")) {
    const whp = host.wholeHousePresets || [];
    const whBar = el("div", { class: "lv-presetbar" });
    whBar.appendChild(el("span", { class: "lv-lbl" }, "Whole house"));
    const whSel = document.createElement("select");
    whSel.className = "lv-select";
    whSel.title = "A saved state of every light and fan in the house — on/off, brightness, colour, effect, speed";
    // Vacation Mode (Garry, 2026-09-21: "a permanent option, vacation") — a
    // fixed entry, always first, never deleted: it isn't a saved snapshot
    // like everything else in this list, it turns on the ongoing
    // average-day pattern from vacation_mode.py until disabled (from the
    // banner — see panel.js's _updateVacationBanner). Reserved value, never
    // a real preset name (60-char cap, plain text — can't collide).
    const VACATION_VALUE = "__vacation__";
    if (host.onVacationModeEnable) {
      whSel.appendChild(el("option", { value: VACATION_VALUE }, "🌴 Vacation Mode"));
    }
    whSel.appendChild(el("option", { value: "" }, whp.length ? "▾ Choose a whole house preset" : "▾ No whole house presets yet"));
    for (const p of whp) whSel.appendChild(el("option", { value: p.name }, `${p.name} (${Object.keys(p.entities || {}).length})`));
    whBar.appendChild(whSel);
    const whStatus = el("span", { class: "lv-status" }, "");
    const whFlash = (msg, ms = 2600) => { whStatus.textContent = msg; setTimeout(() => { whStatus.textContent = ""; }, ms); };

    const whApply = el("button", { class: "lv-act primary", title: "Put every light and fan back the way this preset remembers it — including turning OFF what was off" }, "Apply");
    let whArmed = null;
    const whDisarm = () => { whArmed = null; whApply.textContent = "Apply"; };
    whApply.addEventListener("click", async () => {
      if (whSel.value === VACATION_VALUE) {
        if (whArmed !== VACATION_VALUE) { whArmed = VACATION_VALUE; whApply.textContent = "Yes, turn on Vacation Mode"; return; }
        whDisarm();
        const ok = await host.onVacationModeEnable();
        if (ok) whFlash("Vacation Mode on ✓", 4000);
        return;
      }
      const p = whp.find((x) => x.name === whSel.value);
      if (!p) { whFlash("Pick a preset first"); return; }
      if (whArmed !== p.name) { whArmed = p.name; whApply.textContent = "Yes, change the whole house"; return; }
      whDisarm();
      const r = await host.onWholeHouseApply(p);
      if (r) whFlash(r.skipped ? `Applied ${r.applied} of ${r.applied + r.skipped} — ${r.skipped} unavailable` : `Applied to ${r.applied} ✓`, 4000);
    });
    whSel.addEventListener("change", whDisarm);
    whBar.appendChild(whApply);

    if (host.onWholeHouseSet) {
      const whName = document.createElement("input");
      whName.type = "text";
      whName.className = "lv-preset-name";
      whName.placeholder = "Type a name to set…";
      whName.maxLength = 60;
      whBar.appendChild(whName);
      whBar.appendChild(el("button", {
        class: "lv-act",
        title: "Remember how every light and fan is set right now, under this name — overwrites a preset with the same name",
        onclick: async () => {
          const name = whName.value.trim();
          if (!name) { whFlash("Type a name first"); return; }
          const r = await host.onWholeHouseSet(name);
          if (r) { whName.value = ""; whFlash(`Set ✓ — ${r.count} devices` + (r.skipped ? `, ${r.skipped} unavailable` : ""), 4000); }
        },
      }, "Set"));
    }
    if (host.onWholeHouseDelete) {
      const whDel = el("button", { class: "lv-act", title: "Delete the selected whole house preset" }, "Delete");
      whDel.disabled = true;
      whDel.addEventListener("click", async () => { if (whSel.value && whSel.value !== VACATION_VALUE) { await host.onWholeHouseDelete(whSel.value); whFlash("Deleted"); } });
      whSel.addEventListener("change", () => { whDel.disabled = !whSel.value || whSel.value === VACATION_VALUE; });
      whBar.appendChild(whDel);
    }
    whBar.appendChild(whStatus);
    presetBars.push({ key: "house", label: "Whole house", node: whBar });
  }
  // Classic: each bar is its own full-width row. v2 with both present: ONE
  // row, switched by a two-way tab that takes the place of each bar's own
  // label — they are the same shape and do different jobs, so they share
  // the space instead of stacking.
  if (V2 && presetBars.length === 2) {
    const active = presetBars.some((b) => b.key === view.presetTab) ? view.presetTab : "look";
    const strips = [];
    const show = (key) => {
      view.presetTab = key;
      for (const b of presetBars) b.node.hidden = b.key !== key;
      for (const st of strips) for (const btn of st.children) btn.classList.toggle("on", btn._tabKey === key);
    };
    for (const b of presetBars) {
      const strip = el("span", { class: "lv-tabs" });
      for (const t of presetBars) {
        const btn = el("button", { class: "lv-tab", onclick: () => show(t.key) }, t.label);
        btn._tabKey = t.key;
        strip.appendChild(btn);
      }
      strips.push(strip);
      b.node.replaceChild(strip, b.node.firstChild);
    }
    show(active);
  }
  for (const b of presetBars) mount(b.node, "presets");

  // ── Layers + navigation bar ─────────────────────────────────────────────
  // Separate from the view-shaping toolbar above: this row is about WHAT you
  // are looking at (which device classes, which storey), not how it is drawn.
  // Class chips dim the other classes rather than removing them. Floor chips
  // are the thumb-reach floor switcher — each carries an activity dot (how
  // many devices are on / sensors tripped up there) — and each floor keeps
  // its own camera (zoom + scroll), restored when you come back to it.
  const allLights = Object.values(host.lightsByEid || {});
  if (host.onClassFilter || sortedLevels.length > 1) {
    const bar = el("div", { class: "lv-layerbar" });
    if (host.onClassFilter) {
      const present = new Set(allLights.map(l => lightClassOf(l)));
      const cur = host.classFilter || "all";
      for (const [cls, label] of LIGHT_CLASSES) {
        if (cls !== "all" && !present.has(cls)) continue;
        const n = cls === "all" ? allLights.length : allLights.filter(l => lightClassOf(l) === cls).length;
        bar.appendChild(el("button", {
          class: "lv-chipbtn" + (cur === cls ? " on" : ""),
          title: cls === "all" ? "Every device class" : `Show ${label.toLowerCase()} — the rest dim and stop taking taps`,
          onclick: () => host.onClassFilter(cls === cur && cls !== "all" ? "all" : cls),
        }, [label, el("span", { class: "lv-chipn" }, String(n))]));
      }
    }
    if (sortedLevels.length > 1) {
      if (host.onClassFilter) bar.appendChild(SEP());
      const floorIdx = (z) => isoPos.findIndex(p => p === z);
      const switchTo = (idx) => {
        // Per-floor camera: remember where this storey was left, restore the
        // next one's if it has been visited.
        view.cameras = view.cameras || {};
        view.cameras[view.focusIdx] = { zoom: view.zoom, sl: isoDiv.scrollLeft, st: isoDiv.scrollTop };
        view.focusIdx = idx;
        const cam = view.cameras[idx];
        if (cam) view.zoom = cam.zoom;
        resetFocusCtl(view.focusIdx);
        rebuildISO();
        if (cam) { isoDiv.scrollLeft = cam.sl; isoDiv.scrollTop = cam.st; }
        for (const b of bar.querySelectorAll("button")) if (b._floorIdx !== undefined) b.classList.toggle("on", b._floorIdx === idx);
      };
      const mk = (label, idx, act) => {
        const b = el("button", {
          class: "lv-chipbtn floor" + (view.focusIdx === idx ? " on" : ""),
          title: idx === 0 ? "Every floor" : `Only this floor · ${act.on} on${act.motion ? ` · ${act.motion} motion` : ""}`,
          onclick: () => switchTo(idx),
        }, [label]);
        b._floorIdx = idx;
        if (act && (act.on || act.motion)) b.appendChild(el("span", { class: "lv-dot" + (act.motion ? " motion" : "") }, act.on ? String(act.on) : ""));
        return b;
      };
      bar.appendChild(mk("All", 0, null));
      for (const z of sortedLevels) {
        const f = floors.find(x => Number(x.level) === z);
        const fid = f ? String(f.id) : null;
        const agg = fid ? floorAggregate(allLights, host.model, fid) : { lightsOn: 0, fansOn: 0, motionActive: 0 };
        bar.appendChild(mk(f ? (f.name || `L${z}`) : `L${z}`, floorIdx(z),
          { on: agg.lightsOn + agg.fansOn, motion: agg.motionActive }));
      }
      // Find active — scroll the drawing to the first device that is doing
      // something (a tripped sensor first, then a lit light).
      bar.appendChild(el("button", { class: "lv-act", title: "Scroll to the first tripped sensor or lit light",
        onclick: () => {
          const pick = allLights.find(l => l.isMotion && l.state === "on") || allLights.find(l => l.state === "on");
          if (!pick) { if (host.toast) host.toast("Nothing is on"); return; }
          const g = isoDiv.querySelector(`.lhex[data-eid="${String(pick.entity_id).replace(/"/g, '\\"')}"]`);
          const svg = isoDiv.querySelector("svg");
          if (!g || !svg || !g.getBoundingClientRect) return;
          const gr = g.getBoundingClientRect(), sr = isoDiv.getBoundingClientRect();
          isoDiv.scrollLeft += (gr.left + gr.width / 2) - (sr.left + sr.width / 2);
          isoDiv.scrollTop += (gr.top + gr.height / 2) - (sr.top + sr.height / 2);
        } }, "◎ Find active"));
    }
    mount(bar, "layers");
  }

  // 2026-09-16 live finding: the sticky toolbar (host.stickyToolbar, above)
  // is a SIBLING of isoDiv, not a child of it — position:sticky pins it to
  // the top of whatever scrolls, which on this tab is the outer page, not
  // isoDiv's own internal pan/zoom scroll. So scrolling the PAGE (not
  // panning the map) can bring the map's markers up underneath the
  // toolbar's own opaque backdrop — which exists specifically so scrolled
  // content never shows through it (see its own CSS comment), so a marker
  // there isn't just unreachable, it is genuinely hidden, not merely
  // mis-hit. Live reproduction: 3 of 5 sampled markers near the top of the
  // stage resolved to the toolbar itself at their own drawn centre.
  // A spacer sized to the toolbar's REAL rendered height (ResizeObserver,
  // not a guessed constant — the row wraps to a different number of lines
  // depending on viewport width and which panels are open) reserves that
  // space instead, so the map's own content never starts high enough to
  // reach that band in the first place. Sidebar host (stickyToolbar unset)
  // gets no spacer — it never had the overlap to begin with.
  if (host.stickyToolbar) {
    const spacer = el("div", { style: "flex:0 0 auto" });
    mapCard.appendChild(spacer);
    if (typeof ResizeObserver !== "undefined") {
      const ro = new ResizeObserver(() => {
        spacer.style.height = ctrlRow.getBoundingClientRect().height + "px";
      });
      ro.observe(ctrlRow);
    } else {
      // No ResizeObserver (very old WebView) — a one-shot measurement
      // after layout settles beats no protection at all, even though it
      // won't track a later reflow (a window resize, say).
      setTimeout(() => { spacer.style.height = ctrlRow.getBoundingClientRect().height + "px"; }, 0);
    }
  }
  if (DISPLAY) {
    // The slim rail — the only thing allowed beside the house map. Each icon
    // opens its bar OVER the map; tapping the map (or the icon again) puts
    // it away. view.drawer / view.railHidden live on the persistent view
    // object, so the 5s re-render neither closes an open drawer nor brings
    // a hidden rail back.
    const rail = el("div", { class: "lv-rail" + (view.railHidden ? " hidden" : "") });
    const drawerBtns = [];
    const setDrawer = (name) => {
      view.drawer = view.drawer === name ? null : name;
      for (const k of Object.keys(drawers)) drawers[k].classList.toggle("open", k === view.drawer);
      for (const b of drawerBtns) b.classList.toggle("on", b._drawer === view.drawer);
    };
    const railBtn = (icon, title, onclick) => el("button", { class: "lv-railbtn", title, onclick }, icon);
    for (const [name, icon, title] of [["layers", "☰", "Floors and device types"],
                                        ["presets", "★", "Presets — looks and whole house"],
                                        ["view", "⚙", "Zoom and view options"]]) {
      if (!drawers[name]) continue;
      const b = railBtn(icon, title, () => setDrawer(name));
      b._drawer = name;
      if (view.drawer === name) b.classList.add("on");
      drawerBtns.push(b);
      rail.appendChild(b);
    }
    for (const a of host.railActions || []) rail.appendChild(railBtn(a.icon, a.title, a.onclick));
    rail.appendChild(railBtn(view.railHidden ? "›" : "‹", view.railHidden ? "Show the controls" : "Hide the controls", () => {
      view.railHidden = !view.railHidden;
      if (view.railHidden && view.drawer) setDrawer(view.drawer);
      rail.classList.toggle("hidden", !!view.railHidden);
    }));
    mapCard.appendChild(rail);
    isoDiv.addEventListener("pointerdown", () => { if (view.drawer) setDrawer(view.drawer); });
  }
  mapCard.appendChild(isoDiv);
  if (V2 && typeof ResizeObserver !== "undefined") new ResizeObserver(() => applyZoom()).observe(isoDiv);
  const legend = buildShapeLegend(el, Object.values(host.lightsByEid));
  if (legend) mapCard.appendChild(legend);
  rebuildISO();
  // Restore the pan position a previous rebuild of this same card saved
  // (see the scroll listener above) — skipped on the very first-ever
  // mount, where there is nothing to restore yet and 0,0 is already
  // correct. Real browsers clamp an out-of-range scrollLeft/scrollTop to
  // the content's own current bounds, so this is safe even if the drawing
  // shrank since the value was saved.
  //
  // mapCard is still DETACHED here — the caller appends the div this
  // function returns into the live document only after it gets it back.
  // Setting scrollLeft/scrollTop on an element with no layout box yet is a
  // silent no-op, so every poll-driven rebuild (both Atlas hosts rebuild
  // the whole card from scratch on their ~5s timer) was quietly dropping
  // the user's pan position back to 0,0 the moment it redrew — "the
  // position of the map keeps resetting after 5-10 seconds." Deferred one
  // frame so it runs after the caller's synchronous appendChild.
  //
  // V2 also fits the drawing to the screen via a ResizeObserver, which
  // only gets real numbers once isoDiv is attached — same frame this
  // restore runs in, order unspecified between the two. If that fit lands
  // AFTER this restore, its width change can shrink scrollWidth out from
  // under the position just set, clamping it down — a slow drift toward
  // 0,0 across repeated poll rebuilds ("keeps getting moved to some
  // useless position"), and each rebuild both re-fitting AND re-clamping
  // is exactly what reads as the map "getting smaller" over time too.
  // Calling applyZoom() explicitly, synchronously, right before restoring
  // — rather than trusting the observer to have already run — makes the
  // fit settle first in EVERY case, so the restore always lands on final,
  // stable bounds instead of racing whichever happens to fire second.
  //
  // setTimeout, not requestAnimationFrame: this Atlas panel is often a
  // wall-kiosk tab that is not always the OS's frontmost/focused window,
  // and Chrome fully suspends rAF (indefinitely, not just throttled) in a
  // backgrounded tab — the restore would then silently never run at all,
  // which reproduces as this exact bug. setTimeout still fires there.
  if (view.scrollLeft !== undefined || view.scrollTop !== undefined) {
    setTimeout(() => {
      applyZoom();
      if (view.scrollLeft !== undefined) isoDiv.scrollLeft = view.scrollLeft;
      if (view.scrollTop !== undefined) isoDiv.scrollTop = view.scrollTop;
    }, 0);
  }
  return mapCard;
}

// ── The light index table (+ unassigned/loading notice) ──────────────────────
// Extra host fields used here:
//   callWS(msg) → Promise             for the Assign-room dropdown
//   toast(msg, isError)
//   onRowClick(l)                     sidebar: toggle — tab: select
//   onSelectForPlacement(l)           optional; the code column's own click —
//                                     always arms for map placement, bypassing
//                                     onRowClick's per-type rules (tab only)
//   onRowLongPress(l)                 optional; sidebar: effects popup (500ms hold)
//   onToggleHidden(eid)               persist + re-render
//   afterAssign()                     invalidate registry cache + re-render
export function buildLightsTable(host, lights){
  const { el } = host;
  const hidden = host.hiddenEids;
  // The card wrapper lives HERE, not in the hosts — same objects AND same
  // layout in both views.
  const root = el("div", { class: "card lv-tablecard" });

  const unassigned = lights.filter(l => !l.area_name && !hidden.has(l.entity_id));
  if (host.lightsLoading) {
    root.appendChild(el("div", { class: "lv-note" }, "Loading room assignments…"));
  } else if (unassigned.length) {
    root.appendChild(el("div", { class: "lv-note" },
      `${unassigned.length} light(s) not assigned to a room — shown in index only.`));
  }

  const hiddenCount = lights.filter(l => hidden.has(l.entity_id)).length;
  // The filter pulldown and sort are LIST controls — independent of the
  // map's own layer chips (host.classFilter dims the map; this hides rows
  // in the table instead, the standard meaning of "filter" for a list) so
  // picking a class here never has the side effect of changing what the
  // map shows, which nothing asked for.
  const tableFilter = host.tableClassFilter || "all";
  const healthFilter = !!host.tableHealthFilter;
  const byClass = tableFilter === "all" ? lights : lights.filter(l => lightClassOf(l) === tableFilter);
  const filtered = healthFilter ? byClass.filter(l => !l.healthy) : byClass;
  const unhealthyCount = lights.filter(l => !l.healthy).length;
  root.appendChild(el("div", { class: "lv-tbl-head" }, [
    el("span", { class: "lv-tbl-title" }, "Light Index"),
    el("span", { class: "lv-count" }, (tableFilter === "all" && !healthFilter) ? String(lights.length) : `${filtered.length} / ${lights.length}`),
    hiddenCount ? el("span", { class: "lv-hint" }, `${hiddenCount} hidden from map`) : null,
    ...(host.onTableHealthFilter ? [(() => {
      const btn = el("button", {
        class: "lv-act" + (healthFilter ? " primary" : ""),
        title: unhealthyCount
          ? `${unhealthyCount} device(s) test unhealthy right now`
          : "Every device is healthy right now",
        onclick: () => host.onTableHealthFilter(!healthFilter),
      }, healthFilter ? "Showing unhealthy only ✕" : `Show unhealthy only${unhealthyCount ? ` (${unhealthyCount})` : ""}`);
      return btn;
    })()] : []),
    ...(host.onTableClassFilter ? [(() => {
      const present = new Set(lights.map(l => lightClassOf(l)));
      // No auto right-margin: this card can be far wider than the viewport
      // (it matches the isometric map beside it), and a control shoved to
      // the far edge of a 1700px row is invisible without scrolling. It
      // sits right next to the title instead, so it is always on-screen.
      const sel = document.createElement("select");
      sel.className = "lv-select";
      sel.title = "Filter the list by device type";
      for (const [cls, label] of LIGHT_CLASSES) {
        if (cls !== "all" && !present.has(cls)) continue;
        const o = el("option", { value: cls }, cls === "all" ? "All types" : label);
        if (cls === tableFilter) o.selected = true;
        sel.appendChild(o);
      }
      sel.addEventListener("change", () => host.onTableClassFilter(sel.value));
      return sel;
    })()] : []),
  ]));

  // Sortable headers, the standard three-state cycle: click an unsorted
  // column to sort it ascending, click again for descending, a third click
  // returns to the natural (room, then name) order. The cycling logic
  // lives here, once, so both hosts' onTableSort is a plain setter.
  const sortState = host.tableSort || null;
  const COLUMNS = [
    ["code", "Code", (l) => l.code || ""],
    ["name", "Light", (l) => (l.friendly_name || "").toLowerCase()],
    ["room", "Room", (l) => (l.area_name || "").toLowerCase()],
    ["health", "Health", (l) => (l.healthy ? 1 : 0)],
    ["brand", "Brand", (l) => (l.brand || "").toLowerCase()],
    // Sorted on exactly what the State column DISPLAYS — a temperature
    // reading numerically (so 105° sorts above 68°, not alphabetically),
    // everything else by its actual on/off. stateWordOf's sortValue IS that
    // displayed value (Phase 2a follow-up, 2026-09-19) — this used to be a
    // fourth independent hand-written copy of the same per-class chain as
    // openAggregateSheet and this table's own render chain below; one of
    // those three had already drifted (the flood latch was invisible to
    // this exact sort key until fixed by hand, separately, the same day).
    ["state", "State", (l) => { const sw = stateWordOf(l, host.floodLatches); return sw ? sw.sortValue : (l.state === "on" ? 1 : 0); }],
  ];
  const th = (key, label, extraStyle) => {
    if (!key || !host.onTableSort) return el("th", { style: extraStyle || "" }, label);
    const active = sortState && sortState.column === key;
    const arrow = active ? (sortState.dir === "asc" ? " ▲" : " ▼") : "";
    return el("th", {
      style: `cursor:pointer;user-select:none;${extraStyle || ""}`,
      title: "Sort by " + label,
      onclick: () => {
        const next = !active ? { column: key, dir: "asc" }
          : sortState.dir === "asc" ? { column: key, dir: "desc" }
          : null;
        host.onTableSort(next);
      },
    }, label + arrow);
  };
  const tbl = el("table", { class: "table lv-table", style: "width:100%" });
  tbl.appendChild(el("thead", {}, el("tr", {}, [
    th("code", "Code"),
    th("name", "Light"),
    th("room", "Room"),
    th("health", "Health", "text-align:center"),
    th("brand", "Brand"),
    th("state", "State"),
    th(null, "Type", "text-align:center"),
    th(null, "Map", "width:60px;text-align:center"),
  ])));
  const tbody = el("tbody");
  const placements = (host.model && host.model.light_positions_m) || {};
  if (sortState) {
    const key = COLUMNS.find(([k]) => k === sortState.column)[2];
    const dir = sortState.dir === "asc" ? 1 : -1;
    lights = [...filtered].sort((a, b) => {
      const av = key(a), bv = key(b);
      return av < bv ? -dir : av > bv ? dir : 0;
    });
  } else {
    lights = filtered;
  }
  const selected = host.selectedEids || null;
  const queued = host.placeQueue || null;
  for (const l of lights) {
    const on = l.isLock ? l.state === "locked" : l.state === "on";
    const isHidden = hidden.has(l.entity_id);
    // A row filtered out by the layer chips dims like its marker does; a
    // selected row (builder multi-select) is lit so the map and the index
    // point at the same things.
    const dimmed = !classMatches(l, host.classFilter);
    const isSel = !!(selected && selected.has(l.entity_id));
    // Captured from the code cell's own swatch icon below, so the row's
    // long-press ring (see onRowLongPress wiring, further down) has an
    // existing SVG to draw into instead of needing one of its own.
    let codeSwatchSvg = null;
    const row = el("tr", { "data-eid": l.entity_id,
      class: isSel ? "lv-row-sel" : "",
      style: `cursor:pointer;opacity:${isHidden ? "0.45" : (dimmed ? "0.4" : "1")}` }, [
      // Code + the same outline the map draws, so a row and its marker are
      // recognisably the same object. W-series purple = WLED-class,
      // P-series blue = an ESPHome-style partition segment, F green = fan,
      // M blue = motion sensor, T orange = temperature, Q teal = air quality.
      // Its own click target, separate from the row's: the row click carries
      // a per-type action (motion opens its activity history, free tier
      // toggles), which for motion means there is otherwise NO way to
      // re-select an already-placed sensor for map placement at all — this
      // column exists specifically to arm a device for placement and must
      // not be redirected by those per-type rules.
      el("td", {
        // A door/window has no point on the map to select FOR — it is a
        // section of wall, configured in Rooms (see the Map column below),
        // so this column's "arm for placement" click is switched off for it
        // rather than arming a placement that can never mean anything.
        style: "white-space:nowrap" + (host.onSelectForPlacement && !l.isDoor ? ";cursor:pointer" : ""),
        title: host.onSelectForPlacement && !l.isDoor ? "Select for map placement" : undefined,
        onclick: host.onSelectForPlacement && !l.isDoor ? (e) => { e.stopPropagation(); host.onSelectForPlacement(l); } : undefined,
      }, (() => {
        const swatch = classBorder(l, "#52b788");
        const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
        svg.setAttribute("width", "15"); svg.setAttribute("height", "15");
        svg.setAttribute("viewBox", "0 0 15 15");
        svg.setAttribute("style", "vertical-align:-2px;margin-right:5px");
        svg.innerHTML = shapeSvg(l.shape, 7.5, 7.5, 5.6, `fill="none" stroke="${swatch}" stroke-width="1.6"`);
        codeSwatchSvg = svg;
        return [svg, el("span", { style: `font-family:monospace;font-weight:700;color:${swatch};font-size:12px` }, l.code)];
      })()),
      el("td", {}, l.friendly_name),
      el("td", { class: "muted" }, l.area_name
        ? el("span", {}, l.area_name)
        : host.lightsLoading
        ? el("span", {}, "…")
        : (() => {
            const areas = host.model?.areas || [];
            if (!areas.length) return "—";
            const sel = document.createElement("select");
            sel.className = "lv-select";
            sel.appendChild(el("option", { value: "" }, "Assign room…"));
            for (const a of [...areas].sort((x, y) => x.name.localeCompare(y.name))) {
              sel.appendChild(el("option", { value: a.id }, a.name));
            }
            sel.addEventListener("click", e => e.stopPropagation());
            sel.addEventListener("change", async () => {
              if (!sel.value) return;
              sel.disabled = true;
              try {
                await host.callWS({ type: "config/entity_registry/update", entity_id: l.entity_id, area_id: sel.value });
                host.toast(`Assigned ${l.friendly_name} to room`);
                host.afterAssign();
              } catch (e) {
                host.toast("Failed to assign room: " + (e.message || e), true);
                sel.disabled = false;
              }
            });
            return sel;
          })()
      ),
      el("td", { style: "text-align:center" }, el("span", {
        title: l.healthy ? "Healthy" : (l.healthReason || "Unhealthy"),
        style: `display:inline-block;width:9px;height:9px;border-radius:50%;` +
               `background:${l.healthy ? "#52b788" : "#f87171"};` +
               (l.healthy ? "" : "box-shadow:0 0 4px #f87171bb"),
      })),
      el("td", { class: "muted", style: "font-size:11px" }, l.brand || "—"),
      el("td", {}, (() => {
        // stateWordOf (Phase 2a follow-up, 2026-09-19) — was four
        // independent hand-written chains across this file (this one, the
        // room/floor sheet's, and this table's own separate sort key);
        // two had already drifted into live bugs (a locked lock read "Off"
        // here once, the flood latch was invisible to the sort key).
        const sw = stateWordOf(l, host.floodLatches);
        if (!sw) return el("span", { class: `lv-state ${on ? "on" : "off"}` }, on ? "ON" : "OFF");
        const stateSpan = el("span", { class: `lv-state ${sw.lit ? "on" : "off"}` }, sw.text);
        if (l.isFlood && sw.latched && host.onFloodReset) {
          const wrap = el("span", { style: "margin-left:6px;display:inline-block" });
          const makeResetBtn = () => {
            const b = el("button", { class: "btn tiny", style: "font-size:10px;padding:2px 8px" }, "Reset");
            b.addEventListener("click", (e) => {
              e.stopPropagation();
              wrap.innerHTML = "";
              const yes = el("button", { class: "btn tiny", style: "font-size:10px;padding:2px 8px;background:#7f1d1d;border-color:#dc2626;color:#fecaca" }, "Yes, clear it");
              const no = el("button", { class: "btn tiny", style: "font-size:10px;padding:2px 8px" }, "No");
              yes.addEventListener("click", (e2) => { e2.stopPropagation(); wrap.innerHTML = ""; host.onFloodReset(l.entity_id); });
              no.addEventListener("click", (e2) => { e2.stopPropagation(); wrap.innerHTML = ""; wrap.appendChild(makeResetBtn()); });
              wrap.appendChild(yes); wrap.appendChild(no);
            });
            return b;
          };
          wrap.appendChild(makeResetBtn());
          return el("span", {}, [stateSpan, wrap]);
        }
        return stateSpan;
      })()),
      // Its own column, next to State (Garry, 2026-09-07: "we still need
      // another option next to state... a reassign to another device type
      // pulldown" — it used to be buried in the far-right actions column,
      // easy to miss among Place/Revert/Hide). Pro only (the Mapping tab
      // passes onTypeOverride only at pro; the sidebar and every lower tier
      // pass none): force the class when detection got it wrong. light.*
      // entities only — checked on the DOMAIN, not l.isFan/isMotion/isTemp:
      // a genuine fan./binary_sensor. entity's class really is its domain,
      // nothing to override, but a light.* already overridden to "fan"
      // (Garry, 2026-09-07: "some light switches are fan switches") now
      // reads l.isFan===true too — gating on the derived flag would hide
      // the only way to revert it.
      el("td", { style: "text-align:center" },
        (host.onTypeOverride && l.entity_id.startsWith("light.")) ? (() => {
          const sel = document.createElement("select");
          sel.className = "lv-select";
          sel.title = "Override how PadSpan classes this light (Pro)";
          const cur = (host.typeOverrides || {})[l.entity_id] || "auto";
          for (const [kind, label] of LIGHT_TYPE_OVERRIDES) {
            const o = el("option", { value: kind }, label);
            if (kind === cur) o.selected = true;
            sel.appendChild(o);
          }
          sel.addEventListener("click", e => e.stopPropagation());
          sel.addEventListener("change", (e) => { e.stopPropagation(); sel.disabled = true; host.onTypeOverride(l.entity_id, sel.value); });
          return sel;
        })() : el("span", { class: "muted" }, "—")
      ),
      el("td", { style: "text-align:center;white-space:nowrap" }, [
        // The visible way to the controls (sidebar): a "⋯" that opens the
        // card — the same card the hold opens, offered in plain sight.
        ...(host.onRowMore && isControllable(l) ? [el("button", {
          class: "lv-act", title: "Controls", style: "margin-right:6px",
          onclick: (e) => { e.stopPropagation(); host.onRowMore(l); },
        }, "⋯")] : []),
        // A door/window is never dragged to a point — it is a section of an
        // existing wall. This column shows its link status instead of a
        // Place button: the same information "placed" conveys for everything
        // else, in the terms that actually apply to a door (Garry,
        // 2026-09-08: the point-marker "placement" here "is not making any
        // sense"). Linking happens right here on the Lights map — click
        // Place, then click the map to drop a circle over the wall section,
        // drag it to fit (Garry, 2026-09-09, from scratch: the earlier
        // wall-then-two-points picker "was never visible" and "impossible to
        // use"). Committing it is the SAME unsaved-changes bar every other
        // draft edit on this map already uses (Garry, 2026-09-09: "the done
        // should be the commit normally used at the top, not it's own unique
        // thing") — this column only arms/cancels the gesture, it never
        // itself commits. Rooms → RF Barriers still works too — same
        // fabric, same fields, either surface.
        ...(l.isDoor ? (() => {
          if (host.doorLinkedIds && host.doorLinkedIds.has(l.entity_id)) {
            const isSteel = (host.doorMaterialByEid || {})[l.entity_id] === "metal";
            return [
              el("span", { class: "lv-hint", title: "Shows open/closed on the map at the wall section it's linked to" }, "🔗 Linked"),
              ...(host.onToggleDoorSteel ? [el("button", {
                class: "lv-act" + (isSteel ? " primary" : ""), style: "margin-left:6px",
                title: isSteel
                  ? "Steel (12 dB) — click to change to a lighter material (6 dB)"
                  : "Set this door/window itself to steel (12 dB), independent of the wall it's cut from",
                onclick: (e) => { e.stopPropagation(); host.onToggleDoorSteel(l); },
              }, isSteel ? "Steel ✓" : "Steel")] : []),
              ...(host.onUnlinkDoor ? [el("button", {
                class: "lv-act", style: "margin-left:6px",
                title: "Unlink from that wall section — the wall itself is left in place; Place then reappears here",
                onclick: (e) => { e.stopPropagation(); host.onUnlinkDoor(l); },
              }, "Unlink")] : []),
            ];
          }
          if (!host.onConfigureDoor) return [el("span", { class: "lv-hint" }, "Not linked")];
          if (host.doorCircleArmedEid !== l.entity_id) {
            return [el("button", {
              class: "lv-act", style: "margin-right:6px",
              title: "Click, then click the map to place a circle over the wall section",
              onclick: (e) => { e.stopPropagation(); host.onConfigureDoor(l); },
            }, "Place")];
          }
          return [el("button", {
            class: "lv-act", style: "margin-right:6px",
            title: host.doorCircleM
              ? "Discard the circle — Esc does this too"
              : "Click the map to place a circle, then drag it to fit — Esc cancels",
            onclick: (e) => { e.stopPropagation(); host.onConfigureDoor(null); },
          }, "Cancel")];
        })() : [
          ...(host.onPlaceRow && !placements[l.entity_id] ? [(() => {
            // The placement queue (builder): arm this light, then tap the map
            // where it is. Only offered while it has no position of its own.
            // Garry, 2026-09-15: "use the placement + symbol that is there
            // for other placements" — the SAME "+ " prefix this app already
            // uses for "+ Add room" / "+ Add a floor", not an invented bare
            // glyph. Queued reuses the SAME "◎ " prefix "◎ Queue all
            // unplaced" and "◎ N queued — tap the map" already use for
            // "armed, tap the map now" — one vocabulary, not two.
            const q = !!(queued && queued.has(l.entity_id));
            return el("button", {
              class: "lv-act" + (q ? " primary" : ""), style: "margin-right:6px",
              title: q ? "Queued — tap the map to place it" : "Place on the map — then tap where it is",
              onclick: (e) => { e.stopPropagation(); host.onPlaceRow(l.entity_id); },
            }, q ? "◎ Queued" : "+ Place");
          })()] : []),
          // A lock keeps its ordinary point marker above (it still has a
          // real physical spot, unlike a door/window sensor) — this is
          // ADDITIONAL: optionally link the SAME lock to the wall section
          // it's mounted in, so unlocked flashes red there too. Garry,
          // 2026-09-09: "use the same logic as the open door to build a
          // break in the wall that has the lock... use the basic
          // infrastructure for the open door build." Labelled "Link wall",
          // not "Place" — a lock row can show both buttons at once, and two
          // buttons both saying "Place" would be meaningless.
          ...(l.isLock && host.onConfigureDoor ? (() => {
            if (host.doorLinkedIds && host.doorLinkedIds.has(l.entity_id)) {
              const isSteel = (host.doorMaterialByEid || {})[l.entity_id] === "metal";
              return [
                el("span", { class: "lv-hint", title: "Flashes red on the map, on the wall section it's linked to, whenever unlocked" }, "🔗 Linked"),
                ...(host.onToggleDoorSteel ? [el("button", {
                  class: "lv-act" + (isSteel ? " primary" : ""), style: "margin-left:6px",
                  title: isSteel
                    ? "Steel (12 dB) — click to change to a lighter material (6 dB)"
                    : "Set this door/window itself to steel (12 dB), independent of the wall it's cut from",
                  onclick: (e) => { e.stopPropagation(); host.onToggleDoorSteel(l); },
                }, isSteel ? "Steel ✓" : "Steel")] : []),
                ...(host.onUnlinkDoor ? [el("button", {
                  class: "lv-act", style: "margin-left:6px",
                  title: "Unlink from that wall section — the wall itself is left in place; Link wall then reappears here",
                  onclick: (e) => { e.stopPropagation(); host.onUnlinkDoor(l); },
                }, "Unlink")] : []),
              ];
            }
            if (host.doorCircleArmedEid !== l.entity_id) {
              return [el("button", {
                class: "lv-act", style: "margin-right:6px",
                title: "Click, then click the map to place a circle over the wall section it's mounted in",
                onclick: (e) => { e.stopPropagation(); host.onConfigureDoor(l); },
              }, "Link wall")];
            }
            return [el("button", {
              class: "lv-act", style: "margin-right:6px",
              title: host.doorCircleM
                ? "Discard the circle — Esc does this too"
                : "Click the map to place a circle, then drag it to fit — Esc cancels",
              onclick: (e) => { e.stopPropagation(); host.onConfigureDoor(null); },
            }, "Cancel")];
          })() : []),
        ]),
        // Undoes exactly what "touched" means above: a fixture with no size,
        // rotation, colour or forced class of its own has nothing to revert,
        // so the button only appears once there is something to step out of.
        ...(host.onRevertUntouched && lightIsTouched(l, host.typeOverrides, placements) ? [el("button", {
          class: "lv-act", style: "margin-right:6px",
          title: "Clear this fixture's size, rotation, colour and class override — its position is kept",
          onclick: (e) => { e.stopPropagation(); host.onRevertUntouched(l.entity_id); },
        }, "Revert")] : []),
        el("button", {
          class: "lv-act",
          style: isHidden ? "opacity:0.5" : "",
          onclick: (e) => {
            e.stopPropagation();
            host.onToggleHidden(l.entity_id);
          },
        }, isHidden ? "Show" : "Hide"),
      ]),
    ]);
    row.addEventListener("click", () => {
      if (row._lpFired) { row._lpFired = false; return; }
      host.onRowClick(l);
    });
    // Optional long-press (HOLD_MS) — the sidebar hangs the effects popup on
    // it so the plain tap stays the light switch; a host that passes no
    // handler (the Mapping tab) keeps plain clicks only. 2026-09-17 finding:
    // this was the one hold gesture in the app with no gold press-ring, no
    // touch-action of its own and no pointer capture — every marker hold
    // (wireUseSurface, the Atlas builder, the room-name long-press) already
    // has all three, so this looked scattered next to them: the same
    // "open effects" action gave a visual warning on the map and none at
    // all in the list. Reuses the code cell's own swatch icon as the ring's
    // canvas instead of adding a second SVG just for this.
    if (host.onRowLongPress) {
      row.style.touchAction = "none";
      let lpTimer = null, ringT = null, ring = null, capturedId = null;
      row.addEventListener("pointerdown", (ev) => {
        row._lpFired = false;
        try { row.setPointerCapture(ev.pointerId); capturedId = ev.pointerId; } catch (_) {}
        if (codeSwatchSvg) ringT = setTimeout(() => { ring = pressRing(codeSwatchSvg, 7.5, 7.5, 5.6); }, PRESS_RING_MS);
        lpTimer = setTimeout(() => {
          row._lpFired = true;
          if (ring) ring.classList.add("armed");
          host.onRowLongPress(l);
        }, HOLD_MS);
      });
      const lpCancel = () => {
        if (lpTimer) { clearTimeout(lpTimer); lpTimer = null; }
        if (ringT) { clearTimeout(ringT); ringT = null; }
        if (ring) { try { ring.remove(); } catch (_) {} ring = null; }
        if (capturedId !== null) { try { row.releasePointerCapture(capturedId); } catch (_) {} capturedId = null; }
      };
      row.addEventListener("pointerup", lpCancel);
      row.addEventListener("pointerleave", lpCancel);
      row.addEventListener("pointercancel", lpCancel);
      row.addEventListener("contextmenu", (e) => e.preventDefault());
    }
    tbody.appendChild(row);
  }
  tbl.appendChild(tbody);
  root.appendChild(tbl);
  // Map → index: selecting a marker brings its row into view (the builder
  // sets focusRowEid for the render right after a map selection, only).
  if (host.focusRowEid) {
    const want = host.focusRowEid;
    // Two frames, not one: this table is built while its card is still
    // DETACHED (the host appends it after this returns, then the panel
    // swaps the whole view in), so the first frame is the swap itself and
    // only the second has real layout to measure against.
    const jump = () => {
      const r = [...tbody.querySelectorAll("tr")].find(t => t.getAttribute("data-eid") === want);
      if (!r || !r.scrollIntoView) return;
      // CENTRE, not "nearest" (Garry, 2026-09-19: the hold "is missing the
      // right spot"). "nearest" parks the row flush against whichever edge
      // it came from — under the sticky toolbar/toast when it was above,
      // on the very bottom edge (behind a phone's browser chrome) when it
      // was below — and nothing marked WHICH row it was. inline:"nearest"
      // keeps a table wider than the screen from also jumping sideways.
      r.scrollIntoView({ block: "center", inline: "nearest", behavior: "smooth" });
      r.classList.add("lv-row-flash");
      setTimeout(() => { try { r.classList.remove("lv-row-flash"); } catch (_) {} }, 2400);
    };
    requestAnimationFrame(() => requestAnimationFrame(jump));
  }
  return root;
}
