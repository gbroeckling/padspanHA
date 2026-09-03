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
        lightClassOf } =
  await import(`./iso_lights.js${new URL(import.meta.url).search}`);
const { assignLightCodes, resolveLightShape, LIGHT_SHAPES, LIGHT_TYPE_OVERRIDES,
        WLED_BORDER, PARTITION_BORDER, FAN_BORDER, MOTION_BORDER } =
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

// ── Device classes on the map ────────────────────────────────────────────────
// The layer chips: the map keeps every class in view and DIMS the others,
// because a fan's place on the ceiling is context for the light beside it.
export const LIGHT_CLASSES = [["all","All"],["light","Lights"],["strip","Strips"],["fan","Fans"],["motion","Motion"]];
export { lightClassOf };
export function classMatches(l, cls){ return !cls || cls === "all" || lightClassOf(l) === cls; }

// ── Room and floor aggregates ────────────────────────────────────────────────
// What a room sheet says: lights and fans counted SEPARATELY (so "all off"
// is never ambiguous about the fan), motion summarised. The eids handed back
// are what the aggregate actions act on.
export function roomAggregate(lights, roomName){
  const here = (lights || []).filter(l => l.area_name === roomName);
  const lightsHere = here.filter(l => lightClassOf(l) === "light" || lightClassOf(l) === "strip");
  const fansHere = here.filter(l => l.isFan);
  const motionHere = here.filter(l => l.isMotion);
  return {
    room: roomName,
    lightsOn: lightsHere.filter(l => l.state === "on").length, lightsTotal: lightsHere.length,
    fansOn: fansHere.filter(l => l.state === "on").length, fansTotal: fansHere.length,
    motionActive: motionHere.filter(l => l.state === "on").length, motionTotal: motionHere.length,
    lightEids: lightsHere.map(l => l.entity_id), fanEids: fansHere.map(l => l.entity_id),
    all: here,
  };
}
// A device's floor: the room it is in (the fabric's room → floor), else the
// floor it was placed on. A device with neither is on no floor.
export function lightFloorId(l, model){
  const geo = (model && model.room_geometry_m) || {};
  if (l.area_name && geo[l.area_name] && geo[l.area_name].floor_id) return String(geo[l.area_name].floor_id);
  const p = ((model && model.light_positions_m) || {})[l.entity_id];
  return p && p.floor_id ? String(p.floor_id) : null;
}
export function floorAggregate(lights, model, floorId){
  const here = (lights || []).filter(l => lightFloorId(l, model) === String(floorId));
  const lightsHere = here.filter(l => lightClassOf(l) === "light" || lightClassOf(l) === "strip");
  const fansHere = here.filter(l => l.isFan);
  return {
    floorId: String(floorId),
    lightsOn: lightsHere.filter(l => l.state === "on").length, lightsTotal: lightsHere.length,
    fansOn: fansHere.filter(l => l.state === "on").length, fansTotal: fansHere.length,
    motionActive: here.filter(l => l.isMotion && l.state === "on").length,
    lightEids: lightsHere.map(l => l.entity_id), fanEids: fansHere.map(l => l.entity_id),
  };
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
export function wireUseSurface(isoDiv, api){
  const q = (sel) => isoDiv.querySelectorAll(sel);
  const svg = isoDiv.querySelector("svg");
  const NS = "http://www.w3.org/2000/svg";
  // The pressed ring: appears at PRESS_RING_MS, fills over the rest of the
  // hold, and turns gold when the hold is armed — the affordance the bare
  // 500 ms hold never had.
  const ringAt = (cx, cy, r) => {
    if (!svg) return null;
    const c = document.createElementNS(NS, "circle");
    c.setAttribute("class", "lpress"); c.setAttribute("cx", cx); c.setAttribute("cy", cy); c.setAttribute("r", r);
    c.setAttribute("fill", "none"); c.setAttribute("stroke", "#fbbf24"); c.setAttribute("stroke-width", "1.6");
    c.setAttribute("pointer-events", "none");
    const circ = (2 * Math.PI * r).toFixed(1);
    c.setAttribute("stroke-dasharray", circ); c.setAttribute("stroke-dashoffset", circ);
    c.style.setProperty("--lv-ring-ms", `${HOLD_MS - PRESS_RING_MS}ms`);
    svg.appendChild(c);
    return c;
  };
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
      // The code chip is its own target; the group must not also start a
      // press underneath it.
      if (e.target && e.target.closest && e.target.closest('[data-role="code"]')) return;
      e.stopPropagation();
      try { g.setPointerCapture(e.pointerId); } catch (_) {}
      tracker.down(e.clientX, e.clientY, Date.now());
      if (holdable) {
        ringT = setTimeout(() => { if (tracker.active) ring = ringAt(cx, cy, ringR); }, PRESS_RING_MS);
        armT = setTimeout(() => {
          if (tracker.tick(Date.now()) === "arm") { if (ring) ring.classList.add("armed"); dragBri = null; }
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
      const r = e.type === "pointercancel" ? tracker.cancel() : tracker.up(Date.now());
      clearAll();
      try { g.releasePointerCapture(e.pointerId); } catch (_) {}
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
  // The split target: the code chip opens the controls, or for a plain
  // on/off light simply switches it (there is nothing else to open).
  q('[data-role="code"]').forEach(chip => {
    chip.addEventListener("click", (e) => {
      e.stopPropagation(); e.preventDefault();
      const g = chip.closest ? chip.closest(".lhex") : null;
      const eid = g && g.dataset.eid;
      if (!eid) return;
      if (api.controlsFor(api.lightsByEid[eid])) api.openControls(eid); else api.toggle(eid);
    });
    chip.addEventListener("pointerdown", e => e.stopPropagation());
  });
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
    const on = l.state === "on";
    const row = mk("div", _S.row);
    const col = l.isWled ? WLED_BORDER : (l.isPartition ? PARTITION_BORDER : (l.isFan ? FAN_BORDER : (l.isMotion ? MOTION_BORDER : "#52b788")));
    row.appendChild(mk("span", _S.code + `;color:${col}`, l.code));
    row.appendChild(mk("span", _S.name, l.friendly_name));
    if (l.isMotion) {
      row.appendChild(mk("span", _S.state(on), on ? "MOTION" : "clear"));
    } else {
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
  const agg = roomAggregate(lights, room);
  const only = onlyEids ? new Set(onlyEids) : null;
  const items = agg.all.filter(l => !only || only.has(l.entity_id));
  const lightEids = agg.lightEids.filter(e => !only || only.has(e));
  const fanEids = agg.fanEids.filter(e => !only || only.has(e));
  const parts = [];
  if (agg.lightsTotal) parts.push(`Lights ${agg.lightsOn}/${agg.lightsTotal}`);
  if (agg.fansTotal) parts.push(`Fans ${agg.fansOn}/${agg.fansTotal}`);
  if (agg.motionTotal) parts.push(agg.motionActive ? `Motion ×${agg.motionActive}` : "Motion clear");
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
export function openFloorSheet(api, lights, model, z){
  const floors = (model && model.floors) || [];
  const f = floors.find(x => Number(x.level) === Number(z));
  const fid = f ? String(f.id) : null;
  if (!fid) { api.toast("No floor record for this storey"); return; }
  const agg = floorAggregate(lights, model, fid);
  const items = lights.filter(l => agg.lightEids.includes(l.entity_id) || agg.fanEids.includes(l.entity_id) || (l.isMotion && l.state === "on"));
  const parts = [`Lights ${agg.lightsOn}/${agg.lightsTotal}`];
  if (agg.fansTotal) parts.push(`Fans ${agg.fansOn}/${agg.fansTotal}`);
  if (agg.motionActive) parts.push(`Motion ×${agg.motionActive}`);
  const actions = [];
  if (agg.lightEids.length) {
    actions.push({ label: "All lights off", run: () => api.setMany(agg.lightEids, false) });
    actions.push({ label: "All lights on", primary: true, run: () => api.setMany(agg.lightEids, true) });
  }
  if (agg.fanEids.length) actions.push({ label: "Fans off", run: () => api.setMany(agg.fanEids, false) });
  openAggregateSheet(api, { title: f.name || `Floor ${z}`, sub: parts.join(" · "), items, actions });
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

  const on = st.state === "on";
  // The service domain is the entity's own — this card serves fans too.
  const domain = String(eid).split(".")[0];
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
      setOptimistic(eid, on ? "off" : "on");
      try { await hass.callService(domain, on ? "turn_off" : "turn_on", data); } catch (e) { clearOptimistic(eid); }
      close();
      setTimeout(rerender, 400);
    },
  }, on ? "Turn Off" : "Turn On");
  box.appendChild(onBtn);

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
        for (const d of (devReg || [])) if (d.area_id) devAreaId[d.id] = d.area_id;
        const areaMap = {}, platformMap = {};
        for (const e of (reg || [])) {
          // Fans and motion sensors ride the lights pipeline now, so their
          // room assignment resolves the same way a light's does.
          if (!/^(light|fan|binary_sensor)\./.test(e.entity_id)) continue;
          const aid = e.area_id || devAreaId[e.device_id] || null;
          areaMap[e.entity_id] = aid ? (areaIdToName[aid] || null) : null;
          // The platform that CREATED the entity — "partition" for an
          // ESPHome-style split strip, whatever ELSE reports it is not our
          // business. Same registry fetch, no extra round trip.
          platformMap[e.entity_id] = e.platform || null;
        }
        store.reg = { ts: Date.now(), areaMap, platformMap };
        store.retryAfter = 0;
      } catch (_) {
        // A failed fetch must never become the authoritative answer. With a
        // previous copy, keep serving it and back the retry off; with none,
        // stay in the loading state (the map keeps its placeholder) instead of
        // caching an empty areaMap for 60s, which would tell the user every
        // light in the house has no room.
        if (store.reg) store.reg = { ts: Date.now(), areaMap: store.reg.areaMap, platformMap: store.reg.platformMap };
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
export function gatherLights(states, areaMap, shapeOverrides, tier, platformMap, typeOverrides){
  const paid = lightingUnlocked(tier);
  const pro = tierAtLeast(tier, "pro");
  const lights = Object.keys(states || {})
    .filter(eid => eid.startsWith("light.") || eid.startsWith("fan.")
      // Motion sensors join by DEVICE CLASS, not domain alone — doors,
      // windows and every other binary_sensor stay out of a lighting map.
      // "occupancy" rides along with "motion": both are PIR presence
      // sensors in HA's own taxonomy (motion = momentary, occupancy =
      // sustained — e.g. an outlet-integrated bathroom sensor reports
      // occupancy) and read identically on this map — found live: the
      // bathroom outlets' PIRs (binary_sensor.invisoutlet_occupancy*)
      // were invisible to the map until this line admitted their class.
      || (eid.startsWith("binary_sensor.")
          && ["motion", "occupancy"].includes(states[eid].attributes?.device_class)))
    .map(eid => ({
      entity_id:     eid,
      friendly_name: states[eid].attributes?.friendly_name || eid,
      state:         states[eid].state,   // "on" | "off" | "unavailable"
      area_name:     areaMap[eid] || null,
      // The user's word beats detection, at pro: forced class from
      // settings.light_type_overrides. Never applies to a fan (the domain is
      // the class) and never below pro.
      type_override: pro && !eid.startsWith("fan.") && typeOverrides ? (typeOverrides[eid] || null) : null,
      // The fan card's inputs, present only on fan.* entities.
      pct:           eid.startsWith("fan.") ? (Number.isFinite(Number(states[eid].attributes?.percentage)) ? Number(states[eid].attributes.percentage) : null) : null,
      preset_modes:  eid.startsWith("fan.") && Array.isArray(states[eid].attributes?.preset_modes) ? states[eid].attributes.preset_modes : null,
      preset_mode:   eid.startsWith("fan.") ? (states[eid].attributes?.preset_mode || null) : null,
      oscillating:   eid.startsWith("fan.") ? (typeof states[eid].attributes?.oscillating === "boolean" ? states[eid].attributes.oscillating : null) : null,
      direction:     eid.startsWith("fan.") ? (states[eid].attributes?.direction || null) : null,
      // The effect list is what makes a light WLED-class (W-series code,
      // purple border, effects dialog). Free tier: every light is a light.
      effect_list:   paid && Array.isArray(states[eid].attributes?.effect_list) ? states[eid].attributes.effect_list : null,
      // Which integration created the entity — "partition" is the P-series
      // signal (see isPartitionLight). Gated like effect_list: free tier
      // never sees a strip class at all.
      platform:      paid ? ((platformMap && platformMap[eid]) || null) : null,
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
export function lightIsTouched(l, shapeOverrides, placements) {
  const eid = l.entity_id;
  if (shapeOverrides && shapeOverrides[eid]) return true;
  const p = placements && placements[eid];
  if (!p) return false;
  if (Number(p.width_cm) > 0 || Number(p.height_cm) > 0) return true;
  if (Number(p.rotation)) return true;
  if (p.color && String(p.color).toLowerCase() !== _DROP_COLOR) return true;
  return false;
}

// Legend for the shape vocabulary — the map is only readable at a glance if
// the outlines are decodable. Only the kinds actually present are listed, so
// a house with no fans never shows a fan key.
function buildShapeLegend(el, lights){
  const present = new Set(lights.map(l => l.shape));
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

  // Semantic zoom (use surface): the codes leave the drawing below 100% and
  // come back above it, so a zoom change across that line is a rebuild, not
  // just a CSS width. The builder always shows codes (host.codeChip unset).
  let codesShown = null;
  const applyZoom = () => {
    const svg = isoDiv.querySelector("svg");
    if (!svg) return;
    svg.style.width = `${Math.round(view.zoom * 100)}%`;
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
      { showcase: !!host.showcase, fitRooms: !!host.showcase && !!host.fitRooms,
        ambient: host.ambient, isolux: !!host.showcase && !!host.isolux,
        sceneField: host.showcase ? sceneFieldFor(host.sceneName, host.sceneAngle) : null,
        // The use-surface ergonomics — see buildIsoSVG for each.
        codeChip: !!host.codeChip, hideCodes: !codesShown,
        classFilter: host.classFilter || null, hitHalo: !!host.hitHalo,
        collapseUnplaced: !!host.collapseUnplaced });
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
  const ctrlRow = el("div", { class: "lv-toolbar" });
  const SEP = () => el("span", { class: "lv-sep" }, "");

  // Showcase — first in the row because it changes everything to its right.
  // Only the Mapping tab offers it (the sidebar host passes no handler), and it
  // is a VIEW: every fixture stays exactly where it was put and stays editable.
  if (host.onShowcase) {
    ctrlRow.appendChild(el("button", {
      class: "lv-tgl tone-violet" + (host.showcase ? " on" : ""),
      title: "Presentation rendering — real fixture colour, light pools, contact shadows",
      onclick: () => host.onShowcase(!host.showcase),
    }, host.showcase ? "✦ Showcase ✓" : "✦ Showcase"));

    // Fit to room — only offered while Showcase is on, because it is a
    // constraint on the presentation, not an edit. Stored measurements are
    // never rewritten: turn it off and the typed sizes come straight back.
    if (host.showcase && host.onFitRooms) {
      ctrlRow.appendChild(el("button", {
        class: "lv-tgl tone-ember" + (host.fitRooms ? " on" : ""),
        title: "No fixture is drawn larger than the room it is in, with a small "
          + "gap to the walls. Stored measurements are not changed.",
        onclick: () => host.onFitRooms(!host.fitRooms),
      }, host.fitRooms ? "⊞ Fit room ✓" : "⊞ Fit room"));
    }

    // Isolux — the engineer's overlay: relative-illuminance contours computed
    // on a metre grid from the fixtures' real positions and brightness.
    if (host.showcase && host.onIsolux) {
      ctrlRow.appendChild(el("button", {
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
      ctrlRow.appendChild(el("button", {
        class: "lv-tgl tone-pink" + (cur ? " on" : ""),
        title: "Cycle spatial scene previews — the field's colour at each fixture's "
          + "own position. Nothing is applied until you press Apply.",
        onclick: () => {
          const i = SCENE_NAMES.indexOf(cur);
          host.onScene(i >= SCENE_NAMES.length - 1 ? null : SCENE_NAMES[i + 1]);
        },
      }, cur ? `✨ ${cur}` : "✨ Scene"));
      if (cur && host.onSceneAngle) {
        ctrlRow.appendChild(el("button", {
          class: "lv-act",
          title: "Rotate the scene's axis 45°",
          onclick: () => host.onSceneAngle(((Number(host.sceneAngle)||0) + 45) % 360),
        }, "↻"));
      }
      if (cur && host.onSceneApply) {
        ctrlRow.appendChild(el("button", {
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
      ctrlRow.appendChild(el("button", {
        class: "lv-tgl tone-blue" + (host.rippleArmed ? " on" : ""),
        title: "Arm, then tap the map — lights pulse outward from the tap in "
          + "real-distance order. Only lights already on take part.",
        onclick: () => host.onRipple(!host.rippleArmed),
      }, host.rippleArmed ? "◉ Tap the map…" : "◉ Ripple"));
    }
  }

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
  if (host.onShowcase || host.onHideUntouched) ctrlRow.appendChild(SEP());

  // Reset needs to put the focus control back too — see resetFocusCtl below.
  let resetFocusCtl = () => {};

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
    ctrlRow.appendChild(el("span", { class: "lv-lbl" }, "Floor"));
    ctrlRow.appendChild(focusSlider);
    ctrlRow.appendChild(focusLbl);
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
  ctrlRow.appendChild(SEP());
  ctrlRow.appendChild(el("span", { class: "lv-lbl" }, "Spacing"));
  ctrlRow.appendChild(gapSlider);
  ctrlRow.appendChild(gapLbl);

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
  ctrlRow.appendChild(SEP());
  ctrlRow.appendChild(el("span", { class: "lv-lbl" }, "L / R"));
  ctrlRow.appendChild(horizSlider);
  ctrlRow.appendChild(horizLbl);

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
  ctrlRow.appendChild(saveBtn);
  ctrlRow.appendChild(resetBtn);
  ctrlRow.appendChild(saveLbl);

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

  mapCard.appendChild(ctrlRow);

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
    mapCard.appendChild(bar);
  }

  mapCard.appendChild(isoDiv);
  const legend = buildShapeLegend(el, Object.values(host.lightsByEid));
  if (legend) mapCard.appendChild(legend);
  rebuildISO();
  return mapCard;
}

// ── The light index table (+ unassigned/loading notice) ──────────────────────
// Extra host fields used here:
//   callWS(msg) → Promise             for the Assign-room dropdown
//   toast(msg, isError)
//   onRowClick(l)                     sidebar: toggle — tab: select
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
  root.appendChild(el("div", { class: "lv-tbl-head" }, [
    el("span", { class: "lv-tbl-title" }, "Light Index"),
    el("span", { class: "lv-count" }, String(lights.length)),
    hiddenCount ? el("span", { class: "lv-hint" }, `${hiddenCount} hidden from map`) : null,
  ]));

  const tbl = el("table", { class: "table lv-table", style: "width:100%" });
  tbl.appendChild(el("thead", {}, el("tr", {}, [
    el("th", {}, "Code"),
    el("th", {}, "Light"),
    el("th", {}, "Room"),
    el("th", {}, "State"),
    el("th", { style: "width:60px;text-align:center" }, "Map"),
  ])));
  const tbody = el("tbody");
  const placements = (host.model && host.model.light_positions_m) || {};
  const selected = host.selectedEids || null;
  const queued = host.placeQueue || null;
  for (const l of lights) {
    const on = l.state === "on";
    const isHidden = hidden.has(l.entity_id);
    // A row filtered out by the layer chips dims like its marker does; a
    // selected row (builder multi-select) is lit so the map and the index
    // point at the same things.
    const dimmed = !classMatches(l, host.classFilter);
    const isSel = !!(selected && selected.has(l.entity_id));
    const row = el("tr", { "data-eid": l.entity_id,
      class: isSel ? "lv-row-sel" : "",
      style: `cursor:pointer;opacity:${isHidden ? "0.45" : (dimmed ? "0.4" : "1")}` }, [
      // Code + the same outline the map draws, so a row and its marker are
      // recognisably the same object. W-series purple = WLED-class,
      // P-series blue = an ESPHome-style partition segment, F green = fan,
      // M blue = motion sensor.
      el("td", { style: "white-space:nowrap" }, (() => {
        const swatch = l.isWled ? WLED_BORDER
          : (l.isPartition ? PARTITION_BORDER
          : (l.isFan ? FAN_BORDER
          : (l.isMotion ? MOTION_BORDER : "#52b788")));
        const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
        svg.setAttribute("width", "15"); svg.setAttribute("height", "15");
        svg.setAttribute("viewBox", "0 0 15 15");
        svg.setAttribute("style", "vertical-align:-2px;margin-right:5px");
        svg.innerHTML = shapeSvg(l.shape, 7.5, 7.5, 5.6, `fill="none" stroke="${swatch}" stroke-width="1.6"`);
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
      el("td", {}, el("span", { class: `lv-state ${on ? "on" : "off"}` }, on ? "ON" : "OFF")),
      el("td", { style: "text-align:center;white-space:nowrap" }, [
        // The visible way to the controls (sidebar): a "⋯" that opens the
        // card — the same card the hold opens, offered in plain sight.
        ...(host.onRowMore && !l.isMotion ? [el("button", {
          class: "lv-act", title: "Controls", style: "margin-right:6px",
          onclick: (e) => { e.stopPropagation(); host.onRowMore(l); },
        }, "⋯")] : []),
        // The placement queue (builder): arm this light, then tap the map
        // where it is. Only offered while it has no position of its own.
        ...(host.onPlaceRow && !placements[l.entity_id] ? [(() => {
          const q = !!(queued && queued.has(l.entity_id));
          return el("button", {
            class: "lv-act" + (q ? " primary" : ""), style: "margin-right:6px",
            title: q ? "Queued — tap the map to place it" : "Queue it, then tap the map where it is",
            onclick: (e) => { e.stopPropagation(); host.onPlaceRow(l.entity_id); },
          }, q ? "Queued" : "Place");
        })()] : []),
        // Pro only (the Mapping tab passes onTypeOverride only at pro; the
        // sidebar and every lower tier pass none): force the class when
        // detection got it wrong. Lights only — a fan or sensor IS its
        // domain, there is nothing to override.
        ...(host.onTypeOverride && !l.isFan && !l.isMotion ? [(() => {
          const sel = document.createElement("select");
          sel.className = "lv-select";
          sel.title = "Override how PadSpan classes this light (Pro)";
          sel.style.marginRight = "6px";
          const cur = (host.typeOverrides || {})[l.entity_id] || "auto";
          for (const [kind, label] of LIGHT_TYPE_OVERRIDES) {
            const o = el("option", { value: kind }, label);
            if (kind === cur) o.selected = true;
            sel.appendChild(o);
          }
          sel.addEventListener("click", e => e.stopPropagation());
          sel.addEventListener("change", (e) => { e.stopPropagation(); sel.disabled = true; host.onTypeOverride(l.entity_id, sel.value); });
          return sel;
        })()] : []),
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
    // Optional long-press (500ms) — the sidebar hangs the effects popup on
    // it so the plain tap stays the light switch; a host that passes no
    // handler (the Mapping tab) keeps plain clicks only.
    if (host.onRowLongPress) {
      let lpTimer = null;
      row.addEventListener("pointerdown", () => {
        row._lpFired = false;
        lpTimer = setTimeout(() => { row._lpFired = true; host.onRowLongPress(l); }, 500);
      });
      const lpCancel = () => { if (lpTimer) { clearTimeout(lpTimer); lpTimer = null; } };
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
    requestAnimationFrame(() => {
      const r = tbody.querySelectorAll("tr").find
        ? tbody.querySelectorAll("tr").find(t => t.getAttribute("data-eid") === host.focusRowEid)
        : [...tbody.querySelectorAll("tr")].find(t => t.getAttribute("data-eid") === host.focusRowEid);
      if (r && r.scrollIntoView) r.scrollIntoView({ block: "nearest", behavior: "smooth" });
    });
  }
  return root;
}
