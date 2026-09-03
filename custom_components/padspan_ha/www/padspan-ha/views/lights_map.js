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

const { buildIsoSVG, shapeSvg, fabricFrame, sampleSceneField } =
  await import(`./iso_lights.js${new URL(import.meta.url).search}`);
const { assignLightCodes, resolveLightShape, LIGHT_SHAPES, WLED_BORDER, PARTITION_BORDER } =
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
    isolux: false, onIsolux: null,
    sceneName: null, onScene: null, onSceneAngle: null, onSceneApply: null,
    rippleArmed: false, onRipple: null, onRippleFire: null,
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
          if (!e.entity_id.startsWith("light.")) continue;
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
export function gatherLights(states, areaMap, shapeOverrides, tier, platformMap){
  const paid = lightingUnlocked(tier);
  const lights = Object.keys(states || {})
    .filter(eid => eid.startsWith("light."))
    .map(eid => ({
      entity_id:     eid,
      friendly_name: states[eid].attributes?.friendly_name || eid,
      state:         states[eid].state,   // "on" | "off" | "unavailable"
      area_name:     areaMap[eid] || null,
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
    }))
    .sort((a, b) =>
      (a.area_name || "\xff").localeCompare(b.area_name || "\xff") ||
      a.friendly_name.localeCompare(b.friendly_name));
  assignLightCodes(lights);
  for (const l of lights) l.shape = paid ? resolveLightShape(l, shapeOverrides) : "hex";
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
  const row = el("div", { style:
    "display:flex;flex-wrap:wrap;gap:.35rem 1rem;align-items:center;margin-top:8px;"+
    "padding-top:8px;border-top:1px solid #1b3526" });
  for (const [kind, label] of LIGHT_SHAPES) {
    if (kind === "auto" || !present.has(kind)) continue;
    const cell = el("div", { style: "display:flex;align-items:center;gap:5px" });
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("width", "18"); svg.setAttribute("height", "18");
    svg.setAttribute("viewBox", "0 0 18 18");
    svg.innerHTML = shapeSvg(kind, 9, 9, 6.5, 'fill="none" stroke="#94a3b8" stroke-width="1.6"');
    cell.appendChild(svg);
    cell.appendChild(el("span", { style: "font-size:11px;color:#94a3b8" }, label));
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
  const mapCard = el("div", { class: "card", style: "padding:12px;margin-bottom:16px" });

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
  isoDiv.style.cssText = "overflow:auto;border-radius:8px;background:#071008;padding:8px;width:100%";

  const applyZoom = () => {
    const svg = isoDiv.querySelector("svg");
    if (!svg) return;
    svg.style.width = `${Math.round(view.zoom * 100)}%`;
  };

  const rebuildISO = () => {
    // The map may hide MORE than the index does — "Hide untouched" is a view
    // filter on the drawing, not the persisted hidden set, so the table still
    // lists every light and stays the way to reach one that is filtered out.
    isoDiv.innerHTML = buildIsoSVG(host.model, host.byRoom, host.hiddenEidsMap || host.hiddenEids, getFocusZ(view.focusIdx),
      view.floorGap, view.horizGap, host.lightsByEid, host.lightsLoading, floors,
      { showcase: !!host.showcase, fitRooms: !!host.showcase && !!host.fitRooms,
        ambient: host.ambient, isolux: !!host.showcase && !!host.isolux,
        sceneField: host.showcase ? sceneFieldFor(host.sceneName, host.sceneAngle) : null });
    applyZoom();
    host.onHexesBuilt(isoDiv, rebuildISO);
  };

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
  // no clue which control affects what.
  // Tight on purpose: this row carries three mode toggles now as well as the
  // view controls, and at the old 14px gap it wrapped onto a second line on a
  // normal panel — which pushed the map down and made the modes easy to miss.
  const ctrlRow = el("div", { style:
    "display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-bottom:8px;"
    + "padding:5px 7px;background:#08120c;border:1px solid #16281d;border-radius:10px" });
  const GROUP = "display:flex;gap:4px;align-items:center";
  const SEP = () => el("span", { style:
    "width:1px;align-self:stretch;background:#1b3526;margin:0 1px" }, "");
  const LBL = "font-size:10px;white-space:nowrap;text-transform:uppercase;"
    + "letter-spacing:0.04em;color:#64748b";

  // Showcase — first in the row because it changes everything to its right.
  // Only the Mapping tab offers it (the sidebar host passes no handler), and it
  // is a VIEW: every fixture stays exactly where it was put and stays editable.
  if (host.onShowcase) {
    ctrlRow.appendChild(el("button", {
      class: "btn inline",
      style: host.showcase
        ? "background:linear-gradient(135deg,#4c1d95,#7c3aed);border-color:#c4b5fd;color:#f5f3ff;font-size:11px;padding:2px 8px"
        : "font-size:11px;padding:2px 8px",
      title: "Presentation rendering — real fixture colour, light pools, contact shadows",
      onclick: () => host.onShowcase(!host.showcase),
    }, host.showcase ? "✦ Showcase ✓" : "✦ Showcase"));

    // Fit to room — only offered while Showcase is on, because it is a
    // constraint on the presentation, not an edit. Stored measurements are
    // never rewritten: turn it off and the typed sizes come straight back.
    if (host.showcase && host.onFitRooms) {
      ctrlRow.appendChild(el("button", {
        class: "btn inline",
        style: host.fitRooms
          ? "background:linear-gradient(135deg,#7c2d12,#ea580c);border-color:#fdba74;color:#fff7ed;font-size:11px;padding:2px 8px"
          : "font-size:11px;padding:2px 8px",
        title: "No fixture is drawn larger than the room it is in, with a small "
          + "gap to the walls. Stored measurements are not changed.",
        onclick: () => host.onFitRooms(!host.fitRooms),
      }, host.fitRooms ? "⊞ Fit room ✓" : "⊞ Fit room"));
    }

    // Isolux — the engineer's overlay: relative-illuminance contours computed
    // on a metre grid from the fixtures' real positions and brightness.
    if (host.showcase && host.onIsolux) {
      ctrlRow.appendChild(el("button", {
        class: "btn inline",
        style: host.isolux
          ? "background:linear-gradient(135deg,#14532d,#16a34a);border-color:#86efac;color:#f0fdf4;font-size:11px;padding:2px 8px"
          : "font-size:11px;padding:2px 8px",
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
        class: "btn inline",
        style: cur
          ? "background:linear-gradient(135deg,#7c2d12,#db2777);border-color:#f9a8d4;color:#fdf2f8;font-size:11px;padding:2px 8px"
          : "font-size:11px;padding:2px 8px",
        title: "Cycle spatial scene previews — the field's colour at each fixture's "
          + "own position. Nothing is applied until you press Apply.",
        onclick: () => {
          const i = SCENE_NAMES.indexOf(cur);
          host.onScene(i >= SCENE_NAMES.length - 1 ? null : SCENE_NAMES[i + 1]);
        },
      }, cur ? `✨ ${cur}` : "✨ Scene"));
      if (cur && host.onSceneAngle) {
        ctrlRow.appendChild(el("button", {
          class: "btn inline", style: "font-size:11px;padding:2px 8px",
          title: "Rotate the scene's axis 45°",
          onclick: () => host.onSceneAngle(((Number(host.sceneAngle)||0) + 45) % 360),
        }, "↻"));
      }
      if (cur && host.onSceneApply) {
        ctrlRow.appendChild(el("button", {
          class: "btn inline",
          style: "background:linear-gradient(135deg,#166534,#22c55e);border-color:#86efac;color:#f0fdf4;font-size:11px;padding:2px 8px",
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
        class: "btn inline",
        style: host.rippleArmed
          ? "background:linear-gradient(135deg,#1e3a8a,#3b82f6);border-color:#93c5fd;color:#eff6ff;font-size:11px;padding:2px 8px"
          : "font-size:11px;padding:2px 8px",
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
      class: "btn inline",
      style: host.hideUntouched
        ? "background:linear-gradient(135deg,#134e4a,#0d9488);border-color:#5eead4;color:#ecfeff;font-size:11px;padding:2px 8px"
        : "font-size:11px;padding:2px 8px",
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
    const focusLbl = el("span", { style: "font-size:12px;color:#cbd5e1;min-width:80px" }, getFocusLbl(view.focusIdx));
    const focusSlider = document.createElement("input");
    focusSlider.type = "range"; focusSlider.min = "0"; focusSlider.max = String(isoPos.length - 1);
    focusSlider.style.cssText = "width:96px;accent-color:#52b788;vertical-align:middle;cursor:pointer";
    focusSlider.value = String(view.focusIdx);
    focusSlider.addEventListener("input", () => {
      view.focusIdx = parseInt(focusSlider.value, 10);
      focusLbl.textContent = getFocusLbl(view.focusIdx);
      rebuildISO();
    });
    ctrlRow.appendChild(el("span", { class: "muted", style: LBL }, "Floor"));
    ctrlRow.appendChild(focusSlider);
    ctrlRow.appendChild(focusLbl);
    resetFocusCtl = () => { focusSlider.value = "0"; focusLbl.textContent = getFocusLbl(0); };
  }

  // Floor gap slider
  const gapLbl = el("span", { style: "font-size:12px;color:#cbd5e1;min-width:38px;font-variant-numeric:tabular-nums" }, String(view.floorGap));
  const gapSlider = document.createElement("input");
  // 60–340 matches the backend's clamp exactly. A wider slider silently stored
  // a different spacing than the one on screen.
  gapSlider.type = "range"; gapSlider.min = "60"; gapSlider.max = "340"; gapSlider.step = "10";
  gapSlider.style.cssText = "width:78px;accent-color:#52b788;vertical-align:middle;cursor:pointer";
  gapSlider.value = String(view.floorGap);
  gapSlider.addEventListener("input", () => {
    view.floorGap = parseInt(gapSlider.value, 10);
    gapLbl.textContent = String(view.floorGap);
    rebuildISO();
  });
  ctrlRow.appendChild(SEP());
  ctrlRow.appendChild(el("span", { class: "muted", style: LBL }, "Spacing"));
  ctrlRow.appendChild(gapSlider);
  ctrlRow.appendChild(gapLbl);

  // L/R horizontal offset slider
  const horizLbl = el("span", { style: "font-size:12px;color:#cbd5e1;min-width:38px;font-variant-numeric:tabular-nums" }, String(view.horizGap));
  const horizSlider = document.createElement("input");
  horizSlider.type = "range"; horizSlider.min = "-120"; horizSlider.max = "120"; horizSlider.step = "10";
  horizSlider.style.cssText = "width:78px;accent-color:#52b788;vertical-align:middle;cursor:pointer";
  horizSlider.value = String(view.horizGap);
  horizSlider.addEventListener("input", () => {
    view.horizGap = parseInt(horizSlider.value, 10);
    horizLbl.textContent = String(view.horizGap);
    rebuildISO();
  });
  ctrlRow.appendChild(SEP());
  ctrlRow.appendChild(el("span", { class: "muted", style: LBL }, "L / R"));
  ctrlRow.appendChild(horizSlider);
  ctrlRow.appendChild(horizLbl);

  // Save / Reset view buttons + status label
  const saveLbl = el("span", { style: "font-size:11px;color:#94a3b8;min-width:50px;display:inline-block" }, "");
  const saveBtn = el("button", { class: "btn inline", style: "margin-left:4px;font-size:11px;padding:2px 8px",
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
  const resetBtn = el("button", { class: "btn inline", style: "font-size:11px;padding:2px 8px",
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

  // Zoom controls
  ctrlRow.appendChild(SEP());
  ctrlRow.appendChild(el("span", { class: "muted", style: LBL }, "Zoom"));
  ctrlRow.appendChild(el("button", { class: "btn inline", onclick: () => {
    view.zoom = Math.max(0.4, Math.round((view.zoom - 0.1) * 10) / 10);
    applyZoom();
  } }, "Zoom −"));
  ctrlRow.appendChild(el("button", { class: "btn inline", onclick: () => {
    view.zoom = 1.0; applyZoom();
  } }, "100%"));
  ctrlRow.appendChild(el("button", { class: "btn inline", onclick: () => {
    view.zoom = Math.min(2.5, Math.round((view.zoom + 0.1) * 10) / 10);
    applyZoom();
  } }, "Zoom +"));

  mapCard.appendChild(ctrlRow);
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
  const root = el("div", { class: "card", style: "padding:12px" });

  const unassigned = lights.filter(l => !l.area_name && !hidden.has(l.entity_id));
  if (host.lightsLoading) {
    root.appendChild(el("div", { class: "muted", style: "font-size:12px;margin-bottom:10px" }, "Loading room assignments…"));
  } else if (unassigned.length) {
    root.appendChild(el("div", { class: "muted", style: "font-size:12px;margin-bottom:10px" },
      `${unassigned.length} light(s) not assigned to a room — shown in index only.`));
  }

  const hiddenCount = lights.filter(l => hidden.has(l.entity_id)).length;
  root.appendChild(el("div", { style: "font-weight:700;font-size:13px;color:#e2e8f0;margin-bottom:6px" },
    `Light Index (${lights.length}${hiddenCount ? ` · ${hiddenCount} hidden from map` : ""})`));

  const tbl = el("table", { class: "table", style: "width:100%" });
  tbl.appendChild(el("thead", {}, el("tr", {}, [
    el("th", {}, "Code"),
    el("th", {}, "Light"),
    el("th", {}, "Room"),
    el("th", {}, "State"),
    el("th", { style: "width:60px;text-align:center" }, "Map"),
  ])));
  const tbody = el("tbody");
  for (const l of lights) {
    const on = l.state === "on";
    const isHidden = hidden.has(l.entity_id);
    const row = el("tr", { style: `cursor:pointer;opacity:${isHidden ? "0.45" : "1"}` }, [
      // Code + the same outline the map draws, so a row and its marker are
      // recognisably the same object. W-series purple = WLED-class,
      // P-series blue = an ESPHome-style partition segment.
      el("td", { style: "white-space:nowrap" }, (() => {
        const swatch = l.isWled ? WLED_BORDER : (l.isPartition ? PARTITION_BORDER : "#52b788");
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
            sel.style.cssText = "background:#1a2e1e;color:#52b788;border:1px solid #2d4a36;border-radius:4px;padding:2px 6px;font-size:11px;cursor:pointer";
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
      el("td", {}, el("span", {
        style: `display:inline-block;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:700;` +
               `background:${on ? "#fbbf24" : "#374151"};color:${on ? "#111827" : "#fbbf24"}`,
      }, on ? "ON" : "OFF")),
      el("td", { style: "text-align:center" }, el("button", {
        class: "btn inline",
        style: `font-size:11px;padding:2px 6px${isHidden ? ";opacity:0.5" : ""}`,
        onclick: (e) => {
          e.stopPropagation();
          host.onToggleHidden(l.entity_id);
        },
      }, isHidden ? "Show" : "Hide")),
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
  return root;
}
