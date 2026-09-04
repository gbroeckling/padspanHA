// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
// See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html

// Shared stack transform (P2-5); query inherited from our own module URL so
// the ?b= cache-buster propagates (see docs/06_UI_CACHE_BUSTING.md).
const { BUY_URL: _LIC_BUY_URL, PRO_PRICE: _LIC_PRICE, LICENCE_PATH: _LIC_PATH } =
  await import(`./editions.js${new URL(import.meta.url).search}`);
const { makeStackXform, mapXform, imageAr, fabricWorldRooms, mapFracToMetres,
        metresToMapFrac, placementFromColumns, placementStageAffine, worldGauge } =
  await import(`./stack_transform.js${new URL(import.meta.url).search}`);
// THE fabric frame — the Lights tab inverts drags through the exact function
// the renderer draws with, so the two cannot disagree.
const { fabricFrame, markerScale, markerRadiusPx, cmFromHandlePx, MAX_FIXTURE_CM,
        floorIdAtLevel, sceneColours, defaultPerimeterMarginM } =
  await import(`./iso_lights.js${new URL(import.meta.url).search}`);
// THE shared Lights view (data pipeline, map card, index table) — used
// verbatim by the Lights sidebar panel, so the two tools always show the
// identical map; this tab layers the build tools on top of it.
const { ensureLightsRegistry, gatherLights, buildLightsMapCard, buildLightsTable, lightIsTouched,
        sunAmbient, lastBrightness, spreadInRoom, createUndoStack, setOptimistic, clearOptimistic,
        wireUseSurface, openControlCard, openRoomSheet, openFloorSheet, openActivityCalendar, setManyStates } =
  await import(`./lights_map.js${new URL(import.meta.url).search}`);
// Fixture-shape vocabulary + derivation (the tab owns the manual override UI).
const { LIGHT_SHAPES, deriveLightShape } =
  await import(`./light_codes.js${new URL(import.meta.url).search}`);

// ── Maps View ────────────────────────────────────────────────────────────────
//
// This file implements the Maps view — the spatial foundation of PadSpan.
// Users upload floor plan images, place BLE scanner markers, draw room
// boundaries, align multiple floors into a unified 3D stack, and export
// the result.
//
// TABS:
//   Library   — browse uploaded maps, set/change master, delete with migration
//   Upload    — client-side image resize → PNG, crop tool, send base64 to backend
//   Edit      — place receivers (BLE scanners) + draw room boundary polygons
//   3D Stack  — floor assignment table, alignment overlay editor (drag/scale/
//               rotate), Point Align solver, tie-in system, 3D isometric preview
//   Lights    — hex-grid light control overlay on floor plans
//   Export    — download PNG/SVG/JSON backups, 3D building render
//   Help      — how-it-works reference
//
// KEY DESIGN DECISIONS:
//   • All coordinates are normalized 0–1 so they survive image resizing.
//   • The "master" map is the fixed alignment anchor — all other maps are
//     positioned relative to it via translate + rotate + scale transforms.
//   • Tie-ins are stored alignment snapshots that act as constraints; the
//     conflict resolver averages or warns when new alignment diverges.
//   • Point Align uses a 6-DOF affine least-squares solver to compute
//     transform from matched point pairs (see _solvePtAlign).
//   • _ptAlign.active gates the 5s poll re-render to prevent the side-by-side
//     panels from being destroyed mid-interaction.

// ── Main Render Entry Point ──────────────────────────────────────────────────
// Dispatches to the active tab. Called every 5s by the poll cycle and on
// user-initiated state changes.
export function render(ctx){
  const { el, esc, pill, helpBtn } = ctx.helpers;
  const isBasic = ctx.state.complexity === "basic";
  const root = el("section",{id:"maps"});
  root.className = ctx.state.view==="maps" ? "" : "hidden";

  const maps = (ctx.state.maps && ctx.state.maps.list) ? ctx.state.maps.list : [];
  const activeId = ctx.state.activeMapId || (maps[0] && maps[0].id) || null;
  const active = maps.find(m=>m.id===activeId) || null;

  const tab = ctx.state.mapsTab || "library";
  const setTab = (t)=>ctx.actions.setMapsTab(t);

  // Basic mode: only Library + Upload tabs. The Lights tab is always there
  // otherwise: below the bright tier it shows the free lighting map (rooms,
  // floors, one marker per light — the same drawing the sidebar shows) with
  // the build tools withheld, so a keyless install still has a lights map to
  // look at and a place that says what a key adds. This used to hide the tab
  // without a key, which left PadSpan Bright's free program with no map at all.
  const tabDefs = isBasic
    ? [["library","Library"],["upload","Upload"]]
    : [["library","Library"],["upload","Upload"],["edit","Edit"],["stack","3D Stack"],["rooms","Rooms"],["lights","Lights"],["export","Export"],["help","Help"]];

  // If current tab is not in basic tab list, reset to library
  if(isBasic && tab !== "library" && tab !== "upload"){
    ctx.state.mapsTab = "library";
  }
  const activeTab = ctx.state.mapsTab || "library";

  const tabs = el("div",{class:"tabs"}, tabDefs.map(([id,label])=>_tabBtn(id,label,activeTab,setTab)));

  const header = el("div",{class:"card"},[
    el("div",{style:"display:flex;align-items:center;gap:10px;justify-content:space-between"},[
      el("div",{},[
        el("div",{class:"card-head"},[
          el("div",{style:"font-weight:700;font-size:16px"},"Mapping"),
          helpBtn("maps"),
        ]),
        el("div",{class:"muted"}, isBasic
          ? "Upload a photo of your floor plan to visualise where your Bluetooth scanners are placed."
          : "Upload floorplans (any image type), auto-size to PNG, then place BLE receivers. Export maps + receiver layout."),
      ]),
      el("div",{style:"display:flex;gap:8px;align-items:center"},[
        el("button",{class:"btn inline", onclick:()=>ctx.actions.mapsRefresh()}, "Refresh"),
      ])
    ]),
    tabs,
  ]);

  const body = el("div",{},[
    activeTab==="library" ? _library(ctx, maps, activeId, helpBtn, isBasic) :
    activeTab==="upload" ? _upload(ctx, helpBtn, isBasic) :
    activeTab==="edit" ? _edit(ctx, active, maps) :
    activeTab==="stack" ? _stack(ctx, maps, helpBtn) :
    activeTab==="rooms" ? _roomsTab(ctx, maps) :
    activeTab==="lights" ? _lightsTab(ctx, maps, active) :
    activeTab==="export" ? _export(ctx, active, maps) :
    _help(ctx),
  ]);

  root.appendChild(header);
  root.appendChild(body);
  return root;
}

// ── Tab Button Helper ─────────────────────────────────────────────────────────
function _tabBtn(id,label,active,setTab){
  const b = document.createElement("button");
  b.className = "tab" + (active===id ? " active" : "");
  b.textContent = label;
  b.addEventListener("click", ()=>setTab(id));
  return b;
}

// Sentinel floor_id for outdoor/exterior maps — treated specially in the
// 3D stack (fitted inside the indoor bounding box rather than its own slab).
const OUTSIDE_FLOOR_ID = "__outside__";
function _isOutsideMap(m) { return (m.floor_id || "") === OUTSIDE_FLOOR_ID; }

// Resolve a floor_id to a human-readable name from the HA floor registry.
function _floorName(ctx, floor_id){
  const floors = (ctx.state.model && Array.isArray(ctx.state.model.floors)) ? ctx.state.model.floors : [];
  const id = String(floor_id || "").trim();
  if(!id) return "—";
  if(id === OUTSIDE_FLOOR_ID) return "Outside (Exp.)";
  const f = floors.find(x=>String(x.id)===id);
  return f ? (f.name || f.id) : id;
}

// ── Compare All Maps ─────────────────────────────────────────────────────────
// Cross-map room-boundary comparison.  For every pair of visible maps that
// share the same room name, transforms the room centroid from each map into
// world coordinates (via the map's stack transform) and computes the Euclidean
// distance.  The worst-case error across all room pairs is the headline metric.
//
// Hidden maps (via the 3D Stack visibility toggle) are excluded so the user can
// remove a suspect map and re-run to see if the error drops.
function _compareAllMaps(ctx, maps, resultDiv) {
  const { el } = ctx.helpers;
  resultDiv.innerHTML = "";

  const hiddenIds = (ctx.state.maps && ctx.state.maps._hiddenMapIds) || new Set();
  const visMaps = maps.filter(m => !hiddenIds.has(m.id));
  if (visMaps.length < 2) {
    resultDiv.appendChild(el("div",{style:"padding:10px;font-size:12px;color:#f59e0b"},
      "Need at least 2 visible maps to compare. Toggle visibility in 3D Stack tab."));
    return;
  }

  // Compute world-coordinate centroid for each room on each map, through each
  // map's placement. Null for a map with no placement — a picture nobody has
  // measured or placed has no world position to compare with anyone else's.
  const _worldCentroid = (map, cx, cy) => {
    const xf = mapXform(ctx.state.model, map);
    return xf ? xf.mapPt(cx, cy) : null;
  };

  // Build {roomName: [{map, wx, wy}]} for all visible maps
  const roomEntries = {};
  for (const m of visMaps) {
    for (const [rname, b] of Object.entries(m.room_bounds || {})) {
      let cx = 0.5, cy = 0.5;
      if (b.type === "circle") {
        cx = b.cx || 0.5; cy = b.cy || 0.5;
      } else if (b.type === "poly" && b.points && b.points.length >= 3) {
        cx = b.points.reduce((s, p) => s + p[0], 0) / b.points.length;
        cy = b.points.reduce((s, p) => s + p[1], 0) / b.points.length;
      }
      const [wx, wy] = _worldCentroid(m, cx, cy);
      if (!roomEntries[rname]) roomEntries[rname] = [];
      roomEntries[rname].push({ map: m, wx, wy, cx, cy });
    }
  }

  // For each room that appears on 2+ maps, compute pairwise error
  const pairs = [];
  let worstErr = 0, worstRoom = "", worstMaps = "";
  for (const [rname, entries] of Object.entries(roomEntries)) {
    if (entries.length < 2) continue;
    for (let i = 0; i < entries.length; i++) {
      for (let j = i + 1; j < entries.length; j++) {
        const a = entries[i], b = entries[j];
        const dx = a.wx - b.wx, dy = a.wy - b.wy;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const pct = Math.round(dist * 1000) / 10; // % of normalised space
        pairs.push({ room: rname, mapA: a.map.name || a.map.id, mapB: b.map.name || b.map.id, dist, pct });
        if (dist > worstErr) {
          worstErr = dist;
          worstRoom = rname;
          worstMaps = (a.map.name || a.map.id) + " vs " + (b.map.name || b.map.id);
        }
      }
    }
  }

  if (!pairs.length) {
    resultDiv.appendChild(el("div",{style:"padding:10px;font-size:12px;color:#94a3b8"},
      "No shared rooms found between visible maps. Room names must match exactly."));
    return;
  }

  // Sort worst-first
  pairs.sort((a, b) => b.dist - a.dist);
  const avgErr = pairs.reduce((s, p) => s + p.dist, 0) / pairs.length;
  const avgPct = Math.round(avgErr * 1000) / 10;
  const worstPct = Math.round(worstErr * 1000) / 10;

  // Rating
  const _rating = (pct) => pct < 2 ? ["Excellent", "#52b788"] : pct < 5 ? ["Good", "#7dd3fc"] : pct < 10 ? ["Fair", "#f59e0b"] : ["Poor", "#f87171"];
  const [overallLabel, overallColor] = _rating(worstPct);

  // Build result card
  const card = el("div",{style:"margin-top:10px;padding:12px;border-radius:8px;background:#071210;border:1px solid " + overallColor + "44"});

  // Headline
  const headline = el("div",{style:"display:flex;align-items:center;gap:10px;flex-wrap:wrap"});
  headline.appendChild(el("span",{style:"font-size:14px;font-weight:700;color:" + overallColor}, overallLabel));
  headline.appendChild(el("span",{style:"font-size:12px;color:#94a3b8"},
    "Worst error: " + worstPct + "% (" + worstRoom + ")"));
  headline.appendChild(el("span",{style:"font-size:11px;color:#64748b"},
    "Avg: " + avgPct + "% across " + pairs.length + " room pair(s)"));
  card.appendChild(headline);

  // Detail table
  const table = el("div",{style:"margin-top:8px;font-size:11px;font-family:monospace"});
  for (const p of pairs.slice(0, 20)) {
    const [lbl, col] = _rating(p.pct);
    const row = el("div",{style:"display:flex;gap:8px;padding:2px 0;border-bottom:1px solid #1a2a1a"});
    row.appendChild(el("span",{style:"width:100px;color:" + col + ";font-weight:600"}, p.pct.toFixed(1) + "%"));
    row.appendChild(el("span",{style:"flex:1;color:#e2e8f0"}, p.room));
    row.appendChild(el("span",{style:"color:#64748b"}, p.mapA + " vs " + p.mapB));
    table.appendChild(row);
  }
  if (pairs.length > 20) {
    table.appendChild(el("div",{style:"color:#64748b;padding:4px 0"}, "...and " + (pairs.length - 20) + " more"));
  }
  card.appendChild(table);

  // Tip
  if (worstPct > 5) {
    const tip = el("div",{style:"margin-top:8px;font-size:11px;color:#f59e0b"});
    tip.textContent = "Tip: Hide the worst map in 3D Stack → Floor Assignment, then re-run Compare to isolate it. " +
      "Worst offender: \"" + worstRoom + "\" between " + worstMaps + ".";
    card.appendChild(tip);
  }

  // Close button
  const closeBtn = el("button",{class:"btn inline",style:"margin-top:8px;font-size:11px",onclick:()=>{resultDiv.innerHTML="";}}, "Close");
  card.appendChild(closeBtn);

  resultDiv.appendChild(card);
}

// ── Library Tab ──────────────────────────────────────────────────────────────
// Lists all uploaded maps with thumbnails, master badges, and action buttons.
// Masters sort to the top. Each row shows receiver count, dimensions, floor,
// and whether a coverage gap was detected. Includes the undo-migration banner
// and the Change Master wizard launcher.
function _library(ctx, maps, activeId, helpBtn, isBasic){
  const { el } = ctx.helpers;
  helpBtn = helpBtn || (()=>null);
  const _compareResultDiv = el("div",{});
  const wrap = el("div",{class:"card"},[
    el("div",{class:"card-head"},[
      el("div",{style:"display:flex;align-items:center;gap:10px;flex-wrap:wrap"},[
        el("div",{class:"muted"}, isBasic ? "Your floor plans" : "Maps Library"),
        el("div",{class:"muted"},`${maps.length} map(s)`),
        ...(!isBasic && maps.length >= 2 ? [el("button",{class:"btn inline",style:"font-size:11px;padding:2px 10px;background:#0a1a2a;border-color:#1e4976;color:#7dd3fc",
          onclick:()=>{ _compareAllMaps(ctx, maps, _compareResultDiv); }
        }, "Compare Maps")] : []),
      ]),
      helpBtn("maps_library"),
    ]),
    _compareResultDiv,
  ]);

  // Sample mode: always show the demo floor plan regardless of real map count
  if(ctx.state.dataMode !== "live"){
    return _sampleDemo(ctx);
  }

  if(!maps.length){
    wrap.appendChild(el("div",{class:"muted", style:"margin-top:10px"},"No maps yet. Go to Upload tab."));
    return wrap;
  }

  const libSnap = (ctx.state.live && ctx.state.live.snapshot) || null;

  // Undo migration banner — shown after a migrate+delete, lets user revert if things look bad
  const _mig = ctx.state._lastMapMigration;
  if(_mig && (Date.now() - _mig.timestamp < 600000)){ // show for 10 minutes
    const tgtMap = maps.find(m => m.id === _mig.targetMapId);
    if(tgtMap){
      const undoBanner = el("div",{style:"margin-top:8px;padding:10px 14px;border-radius:8px;background:#2a1a0a;border:1px solid #d97706;display:flex;align-items:center;gap:10px;flex-wrap:wrap"},[
        el("div",{style:"flex:1;min-width:200px"},[
          el("div",{style:"font-weight:600;color:#fbbf24;font-size:13px"}, `Data migrated from "${_mig.srcMapName}" to "${_mig.targetMapName}"`),
          el("div",{class:"muted",style:"font-size:11px"}, "Review the target map. If things look wrong, revert the migrated data."),
        ]),
        el("button",{class:"btn inline", style:"color:#52b788;border-color:#52b788", onclick:()=>{
          ctx.actions.mapsSetActive(_mig.targetMapId);
          ctx.actions.setMapsTab('edit');
        }}, "Review map"),
        el("button",{class:"btn danger", style:"font-size:12px", onclick:async ()=>{
          if(!confirm("Remove all migrated receivers, beacons, and room outlines from the target map?")) return;
          // Remove migrated items from target map — computed from a FRESH
          // fetch, never this render's copy: the same stale-tab guard the
          // orphan delete carries, for the same reason.
          await ctx.actions.mapsRefreshQuiet();
          const m = (ctx.state.maps?.list || []).find(x => x.id === _mig.targetMapId);
          if(!m){ ctx.toast("Target map not found", true); return; }
          const mig = _mig.migrated || {};
          const movedRxLabels = new Set(mig.receivers || []);
          const movedBkLabels = new Set(mig.beacons || []);
          const movedRooms = new Set(mig.rooms || []);
          const newRx = (m.receivers||[]).filter(r => !movedRxLabels.has(r.label || r.source || r.id || ""));
          const newBk = (m.beacons||[]).filter(b => !movedBkLabels.has(b.label || b.key || ""));
          const newBounds = {};
          for(const [k,v] of Object.entries(m.room_bounds||{})){
            if(!movedRooms.has(k)) newBounds[k] = v;
          }
          // Save the strip FIRST, then un-extend. The stripped lists used to
          // be computed and never sent — the button reverted the canvas and
          // nothing else, leaving every migrated item on the map to be
          // clamped flat against the restored border. Order matters for the
          // same reason: migrated items live in the extension margin, and
          // reverting the canvas while they exist squashes them onto the
          // edge before the strip could remove them.
          try {
            await ctx.actions.mapsUpdateQuiet({
              map_id: _mig.targetMapId,
              receivers: newRx, beacons: newBk, room_bounds: newBounds,
            });
          } catch(e){ ctx.toast("Revert failed: "+String(e), true); return; }
          // Revert canvas extension if it was applied
          if(_mig.canvasExtended){
            try {
              await ctx.actions.callWS({ type:"padspan_ha/maps_revert_extend", map_id: _mig.targetMapId });
            } catch(e){ /* best effort */ }
          }
          delete ctx.state._lastMapMigration;
          await ctx.actions.mapsRefresh();
          ctx.toast("Migrated data reverted");
        }}, "Revert migration"),
        el("button",{class:"btn inline", style:"font-size:11px", onclick:async ()=>{
          delete ctx.state._lastMapMigration;
          await ctx.actions.mapsRefresh();
        }}, "Dismiss"),
      ]);
      wrap.appendChild(undoBanner);
    }
  }

  // Group maps by floor
  const _floors = ctx.state.model?.floors || [];
  const _floorMap = new Map();
  for (const m of maps) { const fid = m.floor_id || "main"; if (!_floorMap.has(fid)) _floorMap.set(fid, []); _floorMap.get(fid).push(m); }
  const _floorOrder = _floors.map(f => f.id);
  const _sortedFloors = [..._floorMap.keys()].sort((a, b) => { const ia = _floorOrder.indexOf(a), ib = _floorOrder.indexOf(b); return (ia < 0 ? 999 : ia) - (ib < 0 ? 999 : ib); });

  // THE MASTER IS GONE, and with it the banner that used to stand here.
  //
  // It was a boolean on one map's stack meaning "world units are this
  // picture", and it decided three unrelated things: which map anchored every
  // other map's metre origin, which map won a room-name collision, and which
  // map an align was refused against. None of those questions exists any
  // more. A map's placement is its own record in metres; a room-name
  // collision is settled by `room_precedence`, which is creation order and
  // cannot be nulled by a stack write; and an align is a placement like any
  // other, so there is nothing to refuse.
  //
  // #67 was that flag being revoked by an unrelated save, leaving a store
  // with no master, no way to set one from the UI, and rooms silently
  // changing shape. Set Master, Unset Master, the Change Master wizard and
  // `_alignMasterRefusal` are all deleted rather than guarded.
  const list = el("div",{style:"margin-top:10px;display:flex;flex-direction:column;gap:8px"});

  for (const fid of _sortedFloors) {
    const floorMaps = _floorMap.get(fid) || [];
    floorMaps.sort((a, b) => String(a.created || "").localeCompare(String(b.created || "")));
    const floorObj = _floors.find(f => f.id === fid);
    const floorName = floorObj ? (floorObj.name || fid) : fid;
    list.appendChild(el("div",{style:"font-weight:700;font-size:13px;color:#52b788;margin-top:8px;margin-bottom:2px;text-transform:uppercase;letter-spacing:.5px"},
      `${floorName} (${floorMaps.length})`));

  for(const m of floorMaps){
    const row = el("div",{class:"maprow" + (m.id===activeId ? " active" : "")});

    // Thumbnail with room bounds + recommendation overlay
    const reco = _recommendPlacement(m.receivers||[], m.room_bounds||{}, libSnap);
    const thumb = _libraryThumb(m, ctx, reco);

    // Name row: outside badge inline
    const nameRow = el("div",{style:"display:flex;align-items:center;gap:6px"},[
      el("div",{style:"font-weight:700"}, m.name || m.id),
      ...(_isOutsideMap(m) ? [el("span",{style:"padding:1px 7px;border-radius:10px;background:#1a2a0a;border:1px solid #6b8e23;font-size:10px;color:#9acd32;font-weight:600"},"Outside (Exp.)")] : []),
    ]);

    const _pl = (ctx.state.model?.map_transforms || {})[m.id];
    const _placed = !!(_pl && Number(_pl.scale_x_m) > 0 && Number(_pl.scale_y_m) > 0);
    const left = el("div",{style:"flex:1;min-width:0"},[
      nameRow,
      el("div",{class:"muted", style:"font-size:12px"}, `${m.image?.width||0}×${m.image?.height||0} • floor: ${(_floorName(ctx,m.floor_id))} • receivers: ${(m.receivers||[]).length}`),
      el("div",{class:"muted", style:"font-size:12px"}, `updated: ${m.updated || ""}` + (reco ? " • gap detected" : "")
        + (_placed ? ` • ${Number(_pl.scale_x_m).toFixed(1)}×${Number(_pl.scale_y_m).toFixed(1)} m` : " • not placed")),
    ]);

    const actions = el("div",{style:"display:flex;gap:8px;align-items:center;flex-shrink:0;flex-wrap:wrap"});
    actions.appendChild(el("button",{class:"btn inline", onclick:()=>{ ctx.actions.mapsSetActive(m.id); ctx.actions.setMapsTab('edit'); }}, "Open"));
    actions.appendChild(el("button",{class:"btn inline danger", onclick:()=>{ _deleteMapModal(ctx, m, maps); }}, "Delete"));

    row.appendChild(thumb);
    row.appendChild(left);
    row.appendChild(actions);
    list.appendChild(row);
  }
  } // end floor loop
  wrap.appendChild(list);
  return wrap;
}

// ── Delete Map Modal ─────────────────────────────────────────────────────────
// When a map has data (receivers, beacons, room outlines), offers the option
// to migrate that data to another same-floor map before deleting. Migration
// transforms coordinates from source → world → target coordinate space using
// each map's stack transform, and optionally extends the target canvas if
// migrated items would fall outside [0,1].
function _deleteMapModal(ctx, srcMap, allMaps){
  const { el } = ctx.helpers;

  const srcRx = srcMap.receivers || [];
  const srcBk = srcMap.beacons || [];
  const srcRooms = Object.keys(srcMap.room_bounds || {});
  const srcZ = (srcMap.stack || {}).z_level || 0;
  const hasData = srcRx.length || srcBk.length || srcRooms.length;

  // Find same-z_level maps (excluding the one being deleted)
  const sameFloorMaps = allMaps.filter(m => m.id !== srcMap.id && ((m.stack || {}).z_level || 0) === srcZ);

  // No data → simple delete
  if(!hasData){
    const body = el("div",{style:"display:flex;flex-direction:column;gap:12px"},[
      el("div",{}, `This map has no receivers, beacons, or room outlines.`),
      el("div",{style:"display:flex;gap:8px;justify-content:flex-end"},[
        el("button",{class:"btn inline", onclick:()=>ctx.actions.closeModal()}, "Cancel"),
        el("button",{class:"btn danger", onclick:async ()=>{
          await ctx.actions.mapsDelete(srcMap.id);
          ctx.actions.closeModal();
          ctx.toast(`Deleted "${srcMap.name||srcMap.id}"`);
        }}, "Delete"),
      ]),
    ]);
    ctx.actions.openModal(`Delete "${srcMap.name||srcMap.id}"?`, body);
    return;
  }

  // Build data summary
  const dataBadges = [];
  if(srcRx.length) dataBadges.push(`${srcRx.length} receiver(s)`);
  if(srcBk.length) dataBadges.push(`${srcBk.length} beacon(s)`);
  if(srcRooms.length) dataBadges.push(`${srcRooms.length} room outline(s)`);

  const summary = el("div",{style:"margin-bottom:10px"},[
    el("div",{style:"font-weight:600;margin-bottom:6px;color:#f59e0b"}, "This map has data that will be lost:"),
    el("div",{style:"display:flex;flex-wrap:wrap;gap:6px"},
      dataBadges.map(b => el("span",{class:"badge warn"}, b))
    ),
  ]);

  // No same-floor targets → can only delete outright
  if(!sameFloorMaps.length){
    const body = el("div",{style:"display:flex;flex-direction:column;gap:12px"},[
      summary,
      el("div",{class:"muted"}, "No other maps on this floor to migrate data to."),
      el("div",{style:"display:flex;gap:8px;justify-content:flex-end"},[
        el("button",{class:"btn inline", onclick:()=>ctx.actions.closeModal()}, "Cancel"),
        el("button",{class:"btn danger", onclick:async ()=>{
          await ctx.actions.mapsDelete(srcMap.id);
          ctx.actions.closeModal();
          ctx.toast(`Deleted "${srcMap.name||srcMap.id}" and all its data`);
        }}, "Delete anyway"),
      ]),
    ]);
    ctx.actions.openModal(`Delete "${srcMap.name||srcMap.id}"?`, body);
    return;
  }

  // Has same-floor targets → show migration option
  const targetSel = document.createElement("select");
  targetSel.style.cssText = "padding:6px 10px;border-radius:6px;border:1px solid #334;background:#0a1a10;color:#e2e8f0;width:100%";
  for(const tm of sameFloorMaps){
    const opt = document.createElement("option");
    opt.value = tm.id;
    opt.textContent = `${tm.name || tm.id} (${(tm.receivers||[]).length} receivers, ${Object.keys(tm.room_bounds||{}).length} rooms)`;
    targetSel.appendChild(opt);
  }

  // Canvas extension checkbox (shown when needed)
  const extendCheckbox = document.createElement("input");
  extendCheckbox.type = "checkbox";
  extendCheckbox.checked = false;
  extendCheckbox.disabled = true;
  extendCheckbox.id = "_mig_extend_cb";
  const extendLabel = el("label",{for:"_mig_extend_cb", style:"display:none;font-size:12px;color:#7dd3fc;cursor:pointer;align-items:center;gap:6px"},[
    extendCheckbox,
    el("span",{}, "Extend target map canvas to fit migrated data"),
  ]);
  const extendNote = el("div",{class:"muted", style:"display:none;font-size:11px;margin-top:2px"});

  // Preview what will migrate vs skip
  const previewDiv = el("div",{style:"margin-top:8px"});
  const updatePreview = () => {
    const tgtId = targetSel.value;
    const tgt = sameFloorMaps.find(m => m.id === tgtId);
    if(!tgt){ previewDiv.innerHTML = ""; return; }

    const tgtRxSources = new Set((tgt.receivers||[]).map(r=>r.source||r.id||"").filter(Boolean));
    const tgtBkKeys = new Set((tgt.beacons||[]).map(b=>b.key||"").filter(Boolean));
    const tgtRoomNames = new Set(Object.keys(tgt.room_bounds||{}));

    const willMove = [];
    const willSkip = [];

    for(const rx of srcRx){
      const k = rx.source || rx.id || "";
      const lbl = rx.label || k;
      if(k && tgtRxSources.has(k)) willSkip.push(`Receiver: ${lbl} (already on target)`);
      else willMove.push(`Receiver: ${lbl}`);
    }
    for(const bk of srcBk){
      const k = bk.key || "";
      const lbl = bk.label || k;
      if(k && tgtBkKeys.has(k)) willSkip.push(`Beacon: ${lbl} (already on target)`);
      else willMove.push(`Beacon: ${lbl}`);
    }
    for(const rm of srcRooms){
      if(tgtRoomNames.has(rm)) willSkip.push(`Room: ${rm} (already drawn on target)`);
      else willMove.push(`Room: ${rm}`);
    }

    // Check if any migrated coords would fall outside [0,1] on target
    // Transform source map coords → world coords → target map coords to check
    // if migrated items would fall outside the target's [0,1] canvas.
    // This mirrors the backend's coordinate transform pipeline.
    // Source map fraction → target map fraction, THROUGH METRES. It went
    // through world space on two `stack` dicts; a fraction of one picture is
    // a place in the house and a place in the house is a fraction of another
    // picture, so the shared frame is metres and there is nothing in the
    // middle. Mirrors ws_maps.py's `_xform`, which is what actually performs
    // the migration this is previewing. Identity when either map has no
    // placement: two pictures with no metres between them have no spatial
    // relationship, and the backend refuses the same way.
    const _mdlX = ctx.state.model;
    const _cross = (px, py, fromId, toId) => {
      const m = mapFracToMetres((_mdlX?.map_transforms || {})[fromId], px, py);
      const f = m && metresToMapFrac((_mdlX?.map_transforms || {})[toId], m[0], m[1]);
      return f || [px, py];
    };

    let hasOutOfBounds = false;
    const allPts = [];
    for(const rx of srcRx){
      const k = rx.source || rx.id || "";
      if(k && tgtRxSources.has(k)) continue;
      allPts.push(_cross(rx.x||0.5, rx.y||0.5, srcMap.id, tgt.id));
    }
    for(const bk of srcBk){
      const k = bk.key || "";
      if(k && tgtBkKeys.has(k)) continue;
      allPts.push(_cross(bk.x||0.5, bk.y||0.5, srcMap.id, tgt.id));
    }
    for(const rm of srcRooms){
      if(tgtRoomNames.has(rm)) continue;
      const b = (srcMap.room_bounds||{})[rm];
      if(b && b.type === "poly" && b.points){
        for(const p of b.points){
          allPts.push(_cross(p[0], p[1], srcMap.id, tgt.id));
        }
      } else if(b && b.type === "circle"){
        allPts.push(_cross(b.cx||0.5, b.cy||0.5, srcMap.id, tgt.id));
      }
    }
    if(allPts.length){
      const xs = allPts.map(p=>p[0]), ys = allPts.map(p=>p[1]);
      hasOutOfBounds = Math.min(...xs) < -0.01 || Math.max(...xs) > 1.01 || Math.min(...ys) < -0.01 || Math.max(...ys) > 1.01;
    }

    previewDiv.innerHTML = "";
    if(willMove.length){
      previewDiv.appendChild(el("div",{style:"font-size:12px;color:#52b788;margin-bottom:4px;font-weight:600"}, `Will migrate (${willMove.length}):`));
      previewDiv.appendChild(el("div",{style:"font-size:11px;color:#86efac;max-height:120px;overflow-y:auto;padding-left:8px"},
        willMove.map(m => el("div",{}, m))
      ));
    }
    if(willSkip.length){
      previewDiv.appendChild(el("div",{style:"font-size:12px;color:#f59e0b;margin-top:6px;margin-bottom:4px;font-weight:600"}, `Will skip (${willSkip.length}):`));
      previewDiv.appendChild(el("div",{style:"font-size:11px;color:#fbbf24;max-height:80px;overflow-y:auto;padding-left:8px"},
        willSkip.map(m => el("div",{}, m))
      ));
    }
    if(!willMove.length && !willSkip.length){
      previewDiv.appendChild(el("div",{class:"muted"}, "Nothing to migrate."));
    }

    // Canvas extension notice
    if(hasOutOfBounds && willMove.length){
      extendCheckbox.checked = true;
      extendCheckbox.disabled = false;
      extendLabel.style.display = "flex";
      extendNote.textContent = "Some data falls outside the target map. The canvas will be extended to fit.";
      extendNote.style.display = "";
    } else {
      extendCheckbox.checked = false;
      extendCheckbox.disabled = true;
      extendLabel.style.display = "none";
      extendNote.style.display = "none";
    }
  };
  targetSel.addEventListener("change", updatePreview);
  // Initial preview
  setTimeout(updatePreview, 0);

  const statusDiv = el("div",{style:"min-height:20px"});

  const body = el("div",{style:"display:flex;flex-direction:column;gap:12px"},[
    summary,
    el("div",{},[
      el("div",{style:"font-weight:600;margin-bottom:6px"}, "Migrate data to:"),
      targetSel,
    ]),
    previewDiv,
    extendLabel,
    extendNote,
    statusDiv,
    el("div",{style:"display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap"},[
      el("button",{class:"btn inline", onclick:()=>ctx.actions.closeModal()}, "Cancel"),
      el("button",{class:"btn danger", onclick:async ()=>{
        await ctx.actions.mapsDelete(srcMap.id);
        ctx.actions.closeModal();
        ctx.toast(`Deleted "${srcMap.name||srcMap.id}" — data was NOT migrated`);
      }}, "Delete without migrating"),
      el("button",{class:"btn", style:"background:#1a3a2a;border-color:#52b788;color:#52b788", onclick:async ()=>{
        const tgtId = targetSel.value;
        statusDiv.textContent = "Migrating...";
        try {
          const result = await ctx.actions.mapsDeleteMigrate(srcMap.id, tgtId, extendCheckbox.checked);
          const mig = (result && result.migrated) || {};
          const skip = (result && result.skipped) || {};
          const parts = [];
          if((mig.receivers||[]).length) parts.push(`${mig.receivers.length} receivers`);
          if((mig.beacons||[]).length) parts.push(`${mig.beacons.length} beacons`);
          if((mig.rooms||[]).length) parts.push(`${mig.rooms.length} rooms`);
          if(mig.calibration_points) parts.push(`${mig.calibration_points} cal points`);
          const skipParts = [];
          if((skip.receivers||[]).length) skipParts.push(`${skip.receivers.length} receivers`);
          if((skip.beacons||[]).length) skipParts.push(`${skip.beacons.length} beacons`);
          if((skip.rooms||[]).length) skipParts.push(`${skip.rooms.length} rooms`);

          // Store migration info for undo button
          const tgtMap = sameFloorMaps.find(m => m.id === tgtId);
          ctx.state._lastMapMigration = {
            targetMapId: tgtId,
            targetMapName: tgtMap ? (tgtMap.name||tgtMap.id) : tgtId,
            srcMapName: srcMap.name || srcMap.id,
            migrated: mig,
            canvasExtended: !!(result && result.canvas_extended),
            timestamp: Date.now(),
          };

          ctx.actions.closeModal();
          let msg = `Deleted "${srcMap.name||srcMap.id}"`;
          if(parts.length) msg += ` — migrated ${parts.join(", ")}`;
          if(result && result.canvas_extended) msg += " (canvas extended)";
          if(skipParts.length) msg += ` (skipped: ${skipParts.join(", ")})`;
          ctx.toast(msg);
        } catch(e) {
          statusDiv.textContent = `Error: ${e.message || e}`;
          statusDiv.style.color = "#f87171";
        }
      }}, "Migrate & Delete"),
    ]),
  ]);
  ctx.actions.openModal(`Delete "${srcMap.name||srcMap.id}"?`, body, "This map has data — migrate it to another map first?");
}

// ── Upload Tab ───────────────────────────────────────────────────────────────
// Accepts any image type (PNG/JPG/WebP/GIF/SVG), resizes client-side to a max
// dimension, converts to PNG via canvas, and sends base64 to the backend.
// Includes a drag-to-crop tool and floor selector (from HA Area Registry).
// The selected file is stored on ctx.state so it survives poll-triggered
// DOM rebuilds (the file input element gets destroyed on re-render).
function _upload(ctx, helpBtn, isBasic){
  helpBtn = helpBtn || (()=>null);
  const { el } = ctx.helpers;
  const card = el("div",{class:"card"});
  card.appendChild(el("div",{class:"card-head"},[
    el("div",{class:"h2"}, isBasic ? "Upload a floor plan" : "Upload floor plan"),
    helpBtn("maps_upload"),
  ]));

  // First-upload tip: shown only when no maps exist yet
  if(!(ctx.state.maps?.list||[]).length){
    card.appendChild(el("div",{style:"margin:10px 0 4px;padding:10px 12px;border-radius:8px;background:#0a1a0a;border:1px solid #52b788;font-size:12px;color:#86efac;line-height:1.6"},
      "💡 First map tip — Upload your most precise, to-scale floor plan first. " +
      "All other maps will be spatially anchored to it, so accuracy starts here. " +
      "After upload you can designate it as Master in the Library to protect it from accidental modification."
    ));
  }
  card.appendChild(el("div",{class:"muted",style:"margin-bottom:10px"}, isBasic
    ? "Take a photo of your house plan (or use any image). Give it a name and click Upload."
    : "Upload floorplan image (PNG/JPG/WebP/GIF/SVG). We'll auto-resize and store as optimized PNG for mapping."));

  const floors = (ctx.state.model && ctx.state.model.floors) ? ctx.state.model.floors : [];
  const floorSel = document.createElement("select");
  floorSel.className = "select";
  for(const f of floors){
    const opt = document.createElement("option");
    opt.value = f.id;
    opt.textContent = f.name || f.id;
    floorSel.appendChild(opt);
  }
  // Always offer "Outside" option
  const _outsideOpt = document.createElement("option");
  _outsideOpt.value = OUTSIDE_FLOOR_ID; _outsideOpt.textContent = "Outside (Experimental)";
  floorSel.appendChild(_outsideOpt);
  // Restore floor choice across rebuilds the same way the picked file survives
  // them (see comment above _upload) — a rebuild mid-upload (e.g. WS reconnect)
  // used to silently reset this <select> to floors[0], uploading to the wrong floor.
  if(ctx.state._mapsUploadFloorId && Array.from(floorSel.options).some(o=>o.value===ctx.state._mapsUploadFloorId)){
    floorSel.value = ctx.state._mapsUploadFloorId;
  } else if(!floorSel.value && floors[0]){
    floorSel.value = floors[0].id;
  }
  floorSel.addEventListener("change", ()=>{ ctx.state._mapsUploadFloorId = floorSel.value; });

  const name = el("input",{type:"text", placeholder:"Map name (e.g., Main Floor)"});
  const maxw = el("input",{type:"text", placeholder:"Max size (e.g., 1600). Default 1600"});
  const file = document.createElement("input");
  file.type = "file";
  file.accept = "image/*";

  const status = el("div",{class:"mono", style:"margin-top:10px"}, "\u2014");

  // ── Crop / trim tool ───────────────────────────────────────────────────────
  // Shown after a file is selected; drag on the preview to select a crop region.
  let cropRect = null; // {fx0,fy0,fx1,fy1} in 0-1 image-fraction, or null = full
  let _imgNatW = 0, _imgNatH = 0, _isDragging = false;
  let _dx0=0, _dy0=0, _dx1=0, _dy1=0;

  const previewOuter = el("div",{style:"display:none;margin-top:14px"});
  const previewWrap  = el("div",{style:"position:relative;display:inline-block;max-width:100%;border:1px solid #253e2e;border-radius:6px;overflow:hidden"});
  const previewImg   = document.createElement("img");
  previewImg.style.cssText = "display:block;max-width:100%;max-height:260px";
  const cropCanvas   = document.createElement("canvas");
  cropCanvas.style.cssText = "position:absolute;top:0;left:0;width:100%;height:100%;cursor:crosshair";
  const cropInfo     = el("div",{class:"muted",style:"font-size:11px;margin-top:5px"}, "");
  const cropClearBtn = el("button",{class:"btn tiny",style:"margin-top:6px"}, "Reset Crop");

  function _ccFrac(clientX, clientY){
    const r = cropCanvas.getBoundingClientRect();
    return [Math.max(0,Math.min(1,(clientX-r.left)/r.width)), Math.max(0,Math.min(1,(clientY-r.top)/r.height))];
  }
  function _drawCropOverlay(){
    const cw=cropCanvas.width, ch=cropCanvas.height;
    if(!cw||!ch) return;
    const g2=cropCanvas.getContext("2d");
    g2.clearRect(0,0,cw,ch);
    if(cropRect){
      const {fx0,fy0,fx1,fy1}=cropRect;
      const px0=fx0*cw, py0=fy0*ch, pw=(fx1-fx0)*cw, ph=(fy1-fy0)*ch;
      g2.fillStyle="rgba(0,0,0,0.5)"; g2.fillRect(0,0,cw,ch);
      g2.clearRect(px0,py0,pw,ph);
      g2.strokeStyle="#52b788"; g2.lineWidth=Math.max(1,cw/400); g2.strokeRect(px0,py0,pw,ph);
      const hs=Math.max(4,cw/100);
      g2.fillStyle="#52b788";
      for(const [hx,hy] of [[px0,py0],[px0+pw,py0],[px0,py0+ph],[px0+pw,py0+ph]])
        g2.fillRect(hx-hs/2,hy-hs/2,hs,hs);
      cropInfo.textContent=`Crop: ${Math.round(_imgNatW*(fx1-fx0))}\u00d7${Math.round(_imgNatH*(fy1-fy0))} px  (original: ${_imgNatW}\u00d7${_imgNatH}) \u2014 drag to adjust`;
    } else {
      cropInfo.textContent=`Full image: ${_imgNatW}\u00d7${_imgNatH} px \u2014 drag to select a crop region`;
    }
  }
  function _updateCropFromDrag(){
    const fx0=Math.min(_dx0,_dx1), fy0=Math.min(_dy0,_dy1);
    const fx1=Math.max(_dx0,_dx1), fy1=Math.max(_dy0,_dy1);
    cropRect=(fx1-fx0>0.015&&fy1-fy0>0.015)?{fx0,fy0,fx1,fy1}:null;
    _drawCropOverlay();
  }
  cropCanvas.addEventListener("mousedown",  e=>{ _isDragging=true;  [_dx0,_dy0]=_ccFrac(e.clientX,e.clientY); _dx1=_dx0;_dy1=_dy0; e.preventDefault(); });
  cropCanvas.addEventListener("mousemove",  e=>{ if(!_isDragging)return; [_dx1,_dy1]=_ccFrac(e.clientX,e.clientY); _updateCropFromDrag(); });
  cropCanvas.addEventListener("mouseup",    ()=>{ _isDragging=false; });
  cropCanvas.addEventListener("mouseleave", ()=>{ _isDragging=false; });
  cropCanvas.addEventListener("touchstart", e=>{ const t=e.touches[0]; _isDragging=true; [_dx0,_dy0]=_ccFrac(t.clientX,t.clientY); _dx1=_dx0;_dy1=_dy0; e.preventDefault(); },{passive:false});
  cropCanvas.addEventListener("touchmove",  e=>{ if(!_isDragging)return; const t=e.touches[0]; [_dx1,_dy1]=_ccFrac(t.clientX,t.clientY); _updateCropFromDrag(); e.preventDefault(); },{passive:false});
  cropCanvas.addEventListener("touchend",   ()=>{ _isDragging=false; });
  cropClearBtn.addEventListener("click",    ()=>{ cropRect=null; _drawCropOverlay(); });

  // Capture selected file on ctx.state so it survives poll-triggered DOM rebuilds.
  // The file input DOM element gets destroyed on re-render, losing the selected file.
  // Also set _mapsUploadFile flag to block re-renders while file is selected.
  file.addEventListener("change", ()=>{
    if(!file.files||!file.files[0]) return;
    ctx.state._mapsUploadFile = file.files[0];
    if(!name.value) name.value=ctx.state._mapsUploadFile.name.replace(/\.[^.]+$/,"");
    const objUrl=URL.createObjectURL(ctx.state._mapsUploadFile);
    previewImg.onload=()=>{
      URL.revokeObjectURL(objUrl);
      _imgNatW=previewImg.naturalWidth; _imgNatH=previewImg.naturalHeight;
      const cs=Math.min(1,1600/Math.max(_imgNatW,_imgNatH));
      cropCanvas.width=Math.round(_imgNatW*cs); cropCanvas.height=Math.round(_imgNatH*cs);
      cropRect=null; _drawCropOverlay();
      previewOuter.style.display="";
    };
    previewImg.onerror=()=>{
      URL.revokeObjectURL(objUrl);
      ctx.state._mapsUploadFile = null;
      status.textContent = "Could not load image. Supported formats: PNG, JPG, GIF, BMP, WebP, SVG.";
      status.style.color = "#f87171";
    };
    previewImg.src=objUrl;
  });

  previewWrap.appendChild(previewImg);
  previewWrap.appendChild(cropCanvas);
  previewOuter.appendChild(el("div",{class:"muted",style:"font-size:12px;margin-bottom:6px"},
    "Preview \u2014 drag to select a crop/trim region (optional):"));
  previewOuter.appendChild(previewWrap);
  previewOuter.appendChild(cropClearBtn);
  previewOuter.appendChild(cropInfo);

  const btn = el("button",{class:"btn inline", onclick: async ()=>{
    // Use file from ctx.state (survives re-renders), with file input as fallback
    const f = ctx.state._mapsUploadFile || (file.files && file.files[0]);
    if(!f){ status.textContent = "Pick an image file first. Supported: PNG, JPG, GIF, BMP, WebP, SVG."; return; }
    let floor_id = (floorSel.value||"").trim();
    if(!floor_id){ status.textContent = "Choose a floor before uploading."; return; }
    if(floor_id === OUTSIDE_FLOOR_ID){
      const existingMaps = ctx.state.maps?.list || [];
      if(existingMaps.some(m => m.floor_id === OUTSIDE_FLOOR_ID)){
        status.textContent = "Only one Outside map is allowed. Delete the existing one first.";
        return;
      }
    }
    status.textContent = "Reading\u2026";
    status.style.color = "";
    try{
      const max = parseInt((maxw.value||"").trim() || "1600", 10);
      const res = await _preparePng(f, isFinite(max) ? max : 1600, cropRect);
      status.textContent = `Uploading\u2026 (${res.width}\u00d7${res.height})`;
      const uploadRes = await ctx.actions.mapsUpload({
        name: (name.value||f.name||"Map"),
        filename: f.name,
        mime: f.type || "image/*",
        width: res.width,
        height: res.height,
        png_base64: res.pngBase64,
        floor_id,
      });
      status.textContent = "Uploaded \u2714";
      ctx.state._mapsUploadFile = null;
      ctx.state._mapsUploadFloorId = null;
      // Open the newly uploaded map in the edit tab
      if(uploadRes?.map?.id) ctx.state.activeMapId = uploadRes.map.id;
      ctx.state.mapsTab = "edit";
      ctx.actions.renderRooms();
    }catch(e){
      status.textContent = "Upload failed: " + String(e);
    }
  }}, "Upload & Convert");

  card.appendChild(el("div",{style:"display:flex;gap:10px;flex-wrap:wrap;align-items:end;margin-top:10px"},[
    el("div",{},[ el("div",{class:"muted",style:"font-size:12px;margin-bottom:4px"},"Floor (from HA)"), floorSel ]),
    el("div",{class:"muted",style:"font-size:12px;align-self:flex-end;padding-bottom:4px"}, "Manage floors in HA Settings \u2192 Areas & Zones"),
  ]));

  card.appendChild(name);
  card.appendChild(maxw);
  card.appendChild(file);
  card.appendChild(previewOuter);
  card.appendChild(btn);
  card.appendChild(status);

  // Restore preview if a file was already selected from a previous render cycle
  if(ctx.state._mapsUploadFile && !previewImg.src){
    const f = ctx.state._mapsUploadFile;
    if(!name.value) name.value = f.name.replace(/\.[^.]+$/,"");
    const objUrl = URL.createObjectURL(f);
    previewImg.onload = ()=>{
      URL.revokeObjectURL(objUrl);
      _imgNatW=previewImg.naturalWidth; _imgNatH=previewImg.naturalHeight;
      const cs=Math.min(1,1600/Math.max(_imgNatW,_imgNatH));
      cropCanvas.width=Math.round(_imgNatW*cs); cropCanvas.height=Math.round(_imgNatH*cs);
      cropRect=null; _drawCropOverlay();
      previewOuter.style.display="";
    };
    previewImg.src = objUrl;
    status.textContent = `File selected: ${f.name} (${Math.round(f.size/1024)} KB)`;
  }

  card.appendChild(el("div",{class:"muted", style:"margin-top:12px;font-size:12px"},
    "Best practice: upload one map per floor. Floors let you keep room placement clean and avoid mixing levels."
  ));

  return card;
}


// ── Image Processing Helpers ─────────────────────────────────────────────────

// Reads a File object, optionally crops it, constrains to maxDim, and returns
// {width, height, pngBase64}. All image processing happens client-side via
// an offscreen <canvas> — no server round-trip for resize/convert.
async function _preparePng(file, maxDim, crop=null){
  const buf = await file.arrayBuffer();
  const blob = new Blob([buf], {type: file.type || "image/*"});
  const url = URL.createObjectURL(blob);
  try{
    const img = await _loadImage(url);
    let w = img.naturalWidth || img.width;
    let h = img.naturalHeight || img.height;

    // Apply crop/trim if set (fx0,fy0,fx1,fy1 are 0-1 fractions of the image)
    let srcX=0, srcY=0, srcW=w, srcH=h;
    if(crop && crop.fx1>crop.fx0 && crop.fy1>crop.fy0){
      srcX = Math.round(w*crop.fx0);
      srcY = Math.round(h*crop.fy0);
      srcW = Math.max(1, Math.round(w*(crop.fx1-crop.fx0)));
      srcH = Math.max(1, Math.round(h*(crop.fy1-crop.fy0)));
    }

    // constrain to maxDim
    const scale = Math.min(1, maxDim / Math.max(srcW,srcH));
    const tw = Math.max(1, Math.round(srcW*scale));
    const th = Math.max(1, Math.round(srcH*scale));

    const canvas = document.createElement("canvas");
    canvas.width = tw; canvas.height = th;
    const g = canvas.getContext("2d");
    g.imageSmoothingEnabled = true;
    g.drawImage(img, srcX, srcY, srcW, srcH, 0, 0, tw, th);

    const pngBlob = await new Promise((resolve)=>canvas.toBlob(resolve, "image/png", 0.92));
    const ab = await pngBlob.arrayBuffer();
    const b64 = _arrayBufferToBase64(ab);
    return { width: tw, height: th, pngBase64: b64 };
  }finally{
    URL.revokeObjectURL(url);
  }
}

// Convert ArrayBuffer to base64 string. Processes in 32KB chunks to avoid
// exceeding the max argument count for String.fromCharCode.apply().
function _arrayBufferToBase64(buffer){
  let binary = "";
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  for(let i=0;i<bytes.length;i+=chunkSize){
    const chunk = bytes.subarray(i, i+chunkSize);
    binary += String.fromCharCode.apply(null, chunk);
  }
  return btoa(binary);
}

function _loadImage(url){
  return new Promise((resolve,reject)=>{
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = ()=>resolve(img);
    img.onerror = (e)=>reject(new Error("Image decode failed"));
    img.src = url;
  });
}

// Like _preparePng but loads from a URL (for trim/bake operations on
// already-uploaded map images that are served by HA at /local/...).
async function _preparePngFromUrl(imgUrl, maxDim, crop=null){
  const img = await _loadImage(imgUrl);
  let w = img.naturalWidth || img.width;
  let h = img.naturalHeight || img.height;

  let srcX=0, srcY=0, srcW=w, srcH=h;
  if(crop && crop.fx1>crop.fx0 && crop.fy1>crop.fy0){
    srcX = Math.round(w*crop.fx0);
    srcY = Math.round(h*crop.fy0);
    srcW = Math.max(1, Math.round(w*(crop.fx1-crop.fx0)));
    srcH = Math.max(1, Math.round(h*(crop.fy1-crop.fy0)));
  }

  const scale = Math.min(1, maxDim/Math.max(srcW,srcH));
  const tw = Math.max(1, Math.round(srcW*scale));
  const th = Math.max(1, Math.round(srcH*scale));

  const canvas = document.createElement("canvas");
  canvas.width=tw; canvas.height=th;
  const g=canvas.getContext("2d");
  g.imageSmoothingEnabled=true;
  g.drawImage(img, srcX, srcY, srcW, srcH, 0, 0, tw, th);

  const pngBlob = await new Promise(r=>canvas.toBlob(r,"image/png",0.92));
  const ab = await pngBlob.arrayBuffer();
  const b64 = _arrayBufferToBase64(ab);
  return {width:tw, height:th, pngBase64:b64};
}

// ── Edit Tab ─────────────────────────────────────────────────────────────────
// Full map editor with two modes:
//   Receivers mode — double-click to place BLE scanner markers, drag to
//                    reposition, assign room from HA Area Registry, auto-detect
//                    live BLE radios for one-click placement.
//   Rooms mode    — click to draw polygon room boundaries, auto-circle fallback
//                    for rooms with assigned receivers but no polygon yet.
//
// Draft state is kept on ctx.state.maps._draft* so edits survive tab switches
// within the same session. Changes are only persisted on explicit "Save Layout".
// Also includes Trim Image and Rotate Image sub-panels.
function _edit(ctx, map, allMaps){
  const { el, roomColor } = ctx.helpers;
  const card = el("div",{class:"card"});

  if(!map){
    card.appendChild(el("div",{class:"muted"},"No map selected. Go to Library or Upload tab."));
    return card;
  }

  const floors = (ctx.state.model && ctx.state.model.floors) ? ctx.state.model.floors : [];
  const floorById = (id)=>floors.find(f=>f.id===id) || null;

  // --- Draft state (per-map) ---
  // Reset drafts when switching to a different map — or when the map's
  // PICTURE changed under this one. Drafts are fractions of an image; a
  // trim, rotate or replace (from the toolbar here, another tab, another
  // user) renormalizes the server's fractions into the new image space,
  // and a draft seeded from the old picture then re-imposes old-space
  // coordinates on Save, silently undoing the server's renormalization.
  // The image sha is the picture's identity, so the draft lives exactly
  // as long as the picture it was traced against.
  const _draftImgSha = (map.image && map.image.sha256) || null;
  if(!ctx.state.maps._draftReceivers || ctx.state.maps._draftMapId !== map.id
     || ctx.state.maps._draftImageSha !== _draftImgSha){
    ctx.state.maps._draftReceivers = (map.receivers||[]).map(r=>({
      id: r.id||"",
      label: r.label||"",
      x: Number(r.x||0),
      y: Number(r.y||0),
      room: r.room || "",
      source: r.source || ""
    }));
    // Backfill: older receivers may lack a `source` field (MAC address).
    // Match by label against live BLE radios and persist the backfill so
    // future stale-receiver checks can work reliably.
    const _snap = (ctx.state.live && ctx.state.live.snapshot) || null;
    const _radios = (_snap && _snap.ble && Array.isArray(_snap.ble.radios)) ? _snap.ble.radios : [];
    if(_radios.length){
      let _backfilled = false;
      for(const dr of ctx.state.maps._draftReceivers){
        if(dr.source) continue;
        const match = _radios.find(r => (r.name && dr.label && r.name.toLowerCase() === dr.label.toLowerCase()) || r.source === dr.id);
        if(match){ dr.source = match.source; _backfilled = true; }
      }
      // Source backfill is a label fix on the map draft only — it never
      // touched real-world coordinates and no longer pretends to.
    }
    ctx.state.maps._draftRoomBounds = JSON.parse(JSON.stringify(map.room_bounds||{}));
    ctx.state.maps._draftFloorId = map.floor_id || (floors[0] && floors[0].id) || "main";
    ctx.state.maps._draftMapId = map.id;
    ctx.state.maps._draftImageSha = _draftImgSha;
    ctx.state.maps._selectedRxId = null;
    ctx.state.maps._mode = "receivers"; // receivers | rooms | barriers
    ctx.state.maps._selectedRoom = "";
    ctx.state.maps._drawing = null; // {room, points:[]} or barrier drawing
    ctx.state.maps._selectedBarrierId = null;
    ctx.state.maps._barrierMaterial = "metal";
    ctx.state.maps._recommendPoly = null;
  }

  // Cache-buster: map.updated changes on every trim/replace so the browser fetches fresh content
  const url = map.image && map.image.filename
    ? ctx.helpers.mapImageUrl(map)
    : null;

  // Rooms eligible for this map's floor
  const _modelAreas = ctx.state.model?.areas || [];
  const areaNames = _modelAreas.map(a => a.name);
  const tagMapNames = Object.keys(ctx.state.roomTagMap || {});
  // Also pull room names from live snapshot rooms (fallback when model_get hasn't loaded)
  const _snapRooms = [];
  if(ctx.state.live?.snapshot?.room_tag_map_live) _snapRooms.push(...Object.keys(ctx.state.live.snapshot.room_tag_map_live));
  if(ctx.state.live?.snapshot?.room_tag_map) _snapRooms.push(...Object.keys(ctx.state.live.snapshot.room_tag_map));
  const allRooms = [...new Set([...areaNames, ...tagMapNames, ..._snapRooms])].sort();
  const mapFloorId = ctx.state.maps._draftFloorId || "main";
  // Build area→floor lookup from HA area registry (authoritative source)
  const _areaFloor = {};
  for(const a of _modelAreas) if(a.floor_id) _areaFloor[a.name] = a.floor_id;
  const eligibleRooms = allRooms.filter(r=>{
    // Check area registry first (HA's authoritative floor assignment)
    const areaFid = _areaFloor[r];
    if(areaFid) return areaFid === mapFloorId;
    // Fall back to room_meta (PadSpan's own metadata)
    const meta = ctx.state.model?.room_meta?.[r];
    if(meta?.floor_id) return meta.floor_id === mapFloorId;
    // No floor info → show on all floors (don't hide rooms)
    return true;
  });

  // Map selector — switch between maps directly from the Edit tab
  const mapSel = document.createElement("select");
  mapSel.className = "select";
  for(const m of (allMaps || [])){
    const o = document.createElement("option");
    o.value = m.id;
    o.textContent = m.name || m.id;
    if(m.id === map.id) o.selected = true;
    mapSel.appendChild(o);
  }
  mapSel.onchange = ()=>{ ctx.actions.mapsSetActive(mapSel.value); };

  const titleBtns = el("div",{style:"display:flex;gap:8px;align-items:center;flex-wrap:wrap;justify-content:flex-end"},[
    el("div",{class:"muted", style:"font-size:12px"},"Map:"),
    mapSel,
    el("div",{class:"muted", style:"font-size:12px"},"Floor:"),
    _floorSelect(floors, mapFloorId, async (fid)=>{
      ctx.state.maps._draftFloorId = fid;
      if(ctx.state.maps._selectedRoom && !eligibleRooms.includes(ctx.state.maps._selectedRoom)){
        ctx.state.maps._selectedRoom = "";
        ctx.state.maps._drawing = null;
      }
      ctx.actions.renderRooms();
    }),
  ]);
  const title = el("div",{style:"display:flex;justify-content:space-between;align-items:center;gap:10px"},[
    el("div",{},[
      el("div",{style:"font-weight:700"}, `Edit: ${map.name || map.id}`),
      el("div",{class:"muted", style:"font-size:12px"}, "Place receivers and then draw room boundaries. Save when done."),
    ]),
    titleBtns,
  ]);

  // --- Stage ---
  const stage = document.createElement("div");
  stage.className = "mapstage";

  const img = new Image();
  img.className = "mapimg";
  if(url) img.src = url;

  const overlay = document.createElement("div");
  overlay.className = "mapoverlay";

  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("class","mapvector");
  svg.setAttribute("viewBox","0 0 1 1");
  svg.setAttribute("preserveAspectRatio","none");

  overlay.appendChild(svg);
  stage.appendChild(img);
  stage.appendChild(overlay);

  // ── Walls are in the fabric, in metres. The photo is where you DRAW one ──
  // A wall drawn here is converted through this map's metre transform and
  // stored in the fabric with an id, exactly like a calibration pin or a
  // scanner placed on a plan; the walls shown here are the fabric's, projected
  // back onto the picture. There is no per-photo list of walls any more (the
  // one there was, positioning never read). No transform, no walls: measure
  // the map first.
  const _wallTx = () => (ctx.state.model?.map_transforms || {})[map.id] || null;
  const _wallFloor = () => String(ctx.state.maps._draftFloorId || map.floor_id || "main");
  const _MAT_ATTEN = {metal:12, concrete:8, brick:4, custom:6, open:0};
  const _MAT_COLORS = {metal:"#ef4444",concrete:"#f97316",brick:"#eab308",custom:"#a855f7",open:"#38bdf8"};
  const _fabricWallsHere = () => {
    const tf = _wallTx(); if (!tf) return [];
    const fid = _wallFloor();
    const out = [];
    for (const b of (ctx.state.model?.rf_barriers_m || [])) {
      if (String(b.floor_id || "main") !== fid) continue;
      const pts = (b.points_m || []).map(p => metresToMapFrac(tf, Number(p[0]), Number(p[1]))).filter(Boolean);
      if (pts.length < 2) continue;
      out.push({ id: b.id, name: b.name || "", material: b.material || "custom",
                 attenuation_dbm: b.attenuation_dbm ?? 6, points: pts });
    }
    return out;
  };
  const _placeWall = async (name, material, atten, fracPts) => {
    const tf = _wallTx();
    if (!tf) { ctx.toast("Measure this map first (Measure tool) — walls are stored in metres.", true); return null; }
    const points_m = fracPts.map(p => mapFracToMetres(tf, clamp01(p[0]), clamp01(p[1])))
      .map(q => [Math.round(q[0] * 1000) / 1000, Math.round(q[1] * 1000) / 1000]);
    try {
      const r = await ctx.actions.callWS({ type: "padspan_ha/fabric_rf_barrier_set", barrier: {
        name, material, attenuation_dbm: atten, floor_id: _wallFloor(), points_m } });
      await ctx.actions.modelRefresh();
      return r && r.barrier ? r.barrier.id : null;
    } catch (e) { ctx.toast("Could not place wall: " + (e.message || e), true); return null; }
  };
  const _removeWall = async (id) => {
    try {
      await ctx.actions.callWS({ type: "padspan_ha/fabric_rf_barrier_remove", barrier_id: id });
      await ctx.actions.modelRefresh();
    } catch (e) { ctx.toast("Could not remove wall: " + (e.message || e), true); }
  };

  // --- Right panel (tools) ---
  const right = el("div",{class:"card", style:"margin-top:10px"},[]);
  const _modeHelp = {"receivers":"Double-click map to place radio; drag to reposition","rooms":"Click map to add points; double-click to finish","barriers":"Click to draw wall segments; double-click to finish","measure":"Click two points you know the real distance between"};
  const modeRow = el("div",{style:"display:flex;gap:8px;flex-wrap:wrap;align-items:center"},[
    el("button",{class:"btn inline"+(ctx.state.maps._mode==="receivers"?" primary":""), onclick:()=>{ ctx.state.maps._mode="receivers"; ctx.state.maps._drawing=null; renderAll(); renderTools(); }}, "Radios"),
    el("button",{class:"btn inline"+(ctx.state.maps._mode==="rooms"?" primary":""), onclick:()=>{ ctx.state.maps._mode="rooms"; ctx.state.maps._selectedRxId=null; renderAll(); renderTools(); }}, "Rooms"),
    el("button",{class:"btn inline"+(ctx.state.maps._mode==="barriers"?" primary":""), style:"background:#1a0a0a;border-color:#7f1d1d;color:#fca5a5", onclick:()=>{ ctx.state.maps._mode="barriers"; ctx.state.maps._selectedRxId=null; ctx.state.maps._drawing=null; renderAll(); renderTools(); }}, "RF Barriers"),
    el("button",{class:"btn inline"+(ctx.state.maps._mode==="measure"?" primary":""), style:"background:#0a1a2a;border-color:#1e4976;color:#7dd3fc", onclick:()=>{ ctx.state.maps._mode="measure"; ctx.state.maps._selectedRxId=null; ctx.state.maps._drawing=null; ctx.state.maps._measurePts=[]; renderAll(); renderTools(); }}, "\ud83d\udccf Measure"),
    el("span",{class:"muted", style:"font-size:12px"}, _modeHelp[ctx.state.maps._mode] || ""),
  ]);

  // Detect unsaved changes by comparing draft to saved
  const _hasDraftChanges = () => {
    const sRx = JSON.stringify((map.receivers||[]).map(r=>[r.x,r.y,r.source,r.room]));
    const dRx = JSON.stringify((ctx.state.maps._draftReceivers||[]).map(r=>[r.x,r.y,r.source,r.room]));
    if (sRx !== dRx) return true;
    if (JSON.stringify(map.room_bounds||{}) !== JSON.stringify(ctx.state.maps._draftRoomBounds||{})) return true;
    return false;
  };
  const _dirty = _hasDraftChanges();

  const _saveBtn = el("button",{class:"btn inline" + (_dirty ? " save-pulse" : ""), onclick:async (e)=>{
      const btn = e.currentTarget;
      btn.disabled = true; btn.textContent = "Saving\u2026"; btn.classList.remove("save-pulse");
      try{
        await ctx.actions.mapsUpdateQuiet({
          map_id: map.id,
          calibration: map.calibration||{},
          notes: map.notes||"",
          floor_id: ctx.state.maps._draftFloorId,
          room_bounds: ctx.state.maps._draftRoomBounds,
          receivers: ctx.state.maps._draftReceivers,
        });
        // Verify save: re-fetch maps from backend and check room_bounds persisted
        await ctx.actions.mapsRefreshQuiet();
        const _saved = (ctx.state.maps.list||[]).find(m=>m.id===map.id);
        const _rbCount = _saved ? Object.keys(_saved.room_bounds||{}).length : 0;
        const _draftCount = Object.keys(ctx.state.maps._draftRoomBounds||{}).length;
        console.log("[PadSpan] Save verify: draft rooms=%d, persisted rooms=%d, map_id=%s", _draftCount, _rbCount, map.id);
        if(_draftCount > 0 && _rbCount === 0){
          console.error("[PadSpan] room_bounds LOST after save! Draft:", JSON.stringify(ctx.state.maps._draftRoomBounds));
          ctx.toast("Warning: rooms may not have saved — check logs", true);
        } else {
          ctx.toast("Layout saved \u2714");
        }
      }catch(err){ ctx.toast("Save failed: "+String(err), true); }
      btn.disabled = false; btn.textContent = "\ud83d\udcbe Save Layout"; btn.classList.remove("save-pulse");
  }});
  _saveBtn.textContent = _dirty ? "\ud83d\udcbe Save Layout" : "Save Layout";

  const saveRow = el("div",{style:"display:flex;gap:10px;flex-wrap:wrap;margin-top:10px"},[
    _saveBtn,
    el("button",{class:"btn inline", onclick:()=>{
      // reset drafts from last saved map
      ctx.state.maps._draftReceivers = (map.receivers||[]).map(r=>({id:r.id||"", label:r.label||"", x:Number(r.x||0), y:Number(r.y||0), room:r.room||"", source:r.source||""}));
      ctx.state.maps._draftRoomBounds = JSON.parse(JSON.stringify(map.room_bounds||{}));
      ctx.state.maps._drawing = null;
      ctx.state.maps._selectedRxId = null;
      ctx.state.maps._selectedRoom = "";
      renderAll(); renderTools();
    }}, "Revert"),
  ]);

  const info = el("div",{class:"muted", style:"margin-top:10px;font-size:12px"},
    "Coordinates are stored normalized (0–1), so they stay correct if you re-upload a resized map with the same aspect ratio."
  );

  const list = el("div",{class:"mono", style:"margin-top:10px;white-space:pre-wrap"});

  const refreshList = ()=>{
    list.textContent = _layoutText(ctx.state.maps._draftReceivers, ctx.state.maps._draftRoomBounds);
  };

  // --- Rendering helpers ---
  const renderAll = ()=>{
    // SVG rooms
    while(svg.firstChild) svg.removeChild(svg.firstChild);

    // Draw saved polys first, then fallback circles (if receiver assigned but no poly yet)
    const rb = ctx.state.maps._draftRoomBounds || {};
    const roomToRx = _roomToReceivers(ctx.state.maps._draftReceivers);

    // Polygons
    for(const [room, b] of Object.entries(rb)){
      if(!b || b.type!=="poly" || !Array.isArray(b.points)) continue;
      const poly = document.createElementNS("http://www.w3.org/2000/svg","polygon");
      poly.setAttribute("points", b.points.map(p=>`${clamp01(p[0])},${clamp01(p[1])}`).join(" "));
      const c = roomColor(room);
      poly.setAttribute("fill", c);
      poly.setAttribute("fill-opacity","0.12");
      poly.setAttribute("stroke", c);
      poly.setAttribute("stroke-width","0.004");
      svg.appendChild(poly);

      const lab = document.createElementNS("http://www.w3.org/2000/svg","text");
      const centroid = _centroid(b.points);
      lab.setAttribute("x", centroid[0]);
      lab.setAttribute("y", centroid[1]);
      lab.setAttribute("font-size","0.04");
      lab.setAttribute("text-anchor","middle");
      lab.setAttribute("dominant-baseline","middle");
      lab.setAttribute("fill", c);
      lab.textContent = room;
      svg.appendChild(lab);
    }

    // Fallback circles
    for(const [room, rxs] of Object.entries(roomToRx)){
      if(rb[room] && rb[room].type==="poly") continue;
      const c = roomColor(room);
      const circ = _autoRoomCircle(rxs);
      if(!circ) continue;
      const cc = document.createElementNS("http://www.w3.org/2000/svg","circle");
      cc.setAttribute("cx", circ.cx);
      cc.setAttribute("cy", circ.cy);
      cc.setAttribute("r", circ.r);
      cc.setAttribute("fill","none");
      cc.setAttribute("stroke", c);
      cc.setAttribute("stroke-width","0.004");
      cc.setAttribute("stroke-dasharray","0.02 0.02");
      svg.appendChild(cc);
    }

    // Walls — the fabric's, projected onto this photo; dashed by material
    const barriers = _fabricWallsHere();
    const _matColors = _MAT_COLORS;
    for(let bi = 0; bi < barriers.length; bi++){
      const bar = barriers[bi];
      if(!bar.points || bar.points.length < 2) continue;
      const bc = _matColors[bar.material] || "#ef4444";
      const bLine = document.createElementNS("http://www.w3.org/2000/svg","polyline");
      bLine.setAttribute("points", bar.points.map(p=>`${clamp01(p[0])},${clamp01(p[1])}`).join(" "));
      bLine.setAttribute("fill","none");
      bLine.setAttribute("stroke", bc);
      const _isOpen = bar.material === "open";
      bLine.setAttribute("stroke-width", ctx.state.maps._selectedBarrierId === bar.id ? "0.010" : (_isOpen ? "0.003" : "0.006"));
      bLine.setAttribute("stroke-dasharray", _isOpen ? "0.004 0.008" : "0.006 0.018");
      bLine.setAttribute("stroke-linecap","round");
      if (_isOpen) bLine.setAttribute("opacity", "0.6");
      if(ctx.state.maps._mode === "barriers"){
        bLine.style.cursor = "pointer";
        bLine.addEventListener("click", (ev)=>{ ev.stopPropagation(); ctx.state.maps._selectedBarrierId = bar.id; renderAll(); renderTools(); });
      }
      svg.appendChild(bLine);
      // Label at midpoint
      if(bar.points.length >= 2){
        const midI = Math.floor(bar.points.length / 2);
        const blab = document.createElementNS("http://www.w3.org/2000/svg","text");
        blab.setAttribute("x", clamp01(bar.points[midI][0]));
        blab.setAttribute("y", clamp01(bar.points[midI][1] - 0.02));
        blab.setAttribute("font-size","0.025");
        blab.setAttribute("text-anchor","middle");
        blab.setAttribute("fill", bc);
        blab.textContent = bar.material === "open" ? "Open (Loft)" : (bar.material||"metal") + " (" + (bar.attenuation_dbm||12) + "dB)";
        svg.appendChild(blab);
      }
    }

    // Recommendation polygon overlay
    const recoPoly = ctx.state.maps._recommendPoly;
    if(recoPoly && Array.isArray(recoPoly.polygon) && recoPoly.polygon.length >= 3){
      const rpoly = document.createElementNS("http://www.w3.org/2000/svg","polygon");
      rpoly.setAttribute("points", recoPoly.polygon.map(p=>`${clamp01(p[0])},${clamp01(p[1])}`).join(" "));
      rpoly.setAttribute("fill","rgba(251,191,36,0.18)");
      rpoly.setAttribute("stroke","#fbbf24");
      rpoly.setAttribute("stroke-width","0.005");
      rpoly.setAttribute("stroke-dasharray","0.018 0.010");
      svg.appendChild(rpoly);
      const rcx = recoPoly.polygon.reduce((s,p)=>s+p[0],0)/recoPoly.polygon.length;
      const rcy = recoPoly.polygon.reduce((s,p)=>s+p[1],0)/recoPoly.polygon.length;
      const rlab = document.createElementNS("http://www.w3.org/2000/svg","text");
      rlab.setAttribute("x", clamp01(rcx));
      rlab.setAttribute("y", clamp01(rcy));
      rlab.setAttribute("font-size","0.045");
      rlab.setAttribute("text-anchor","middle");
      rlab.setAttribute("dominant-baseline","middle");
      rlab.setAttribute("fill","#fbbf24");
      rlab.setAttribute("stroke","#1a0f00");
      rlab.setAttribute("stroke-width","0.008");
      rlab.setAttribute("paint-order","stroke fill");
      rlab.setAttribute("font-family","system-ui,sans-serif");
      rlab.textContent = "Recommended zone";
      svg.appendChild(rlab);
    }

    // Draft drawing polyline
    if(ctx.state.maps._drawing && Array.isArray(ctx.state.maps._drawing.points) && ctx.state.maps._drawing.points.length){
      const pts = ctx.state.maps._drawing.points;
      const ln = document.createElementNS("http://www.w3.org/2000/svg","polyline");
      ln.setAttribute("points", pts.map(p=>`${clamp01(p[0])},${clamp01(p[1])}`).join(" "));
      const _isBarrierDraw = ctx.state.maps._mode === "barriers";
      const c = _isBarrierDraw ? (_matColors[ctx.state.maps._barrierMaterial]||"#ef4444") : roomColor(ctx.state.maps._drawing.room || "Room");
      ln.setAttribute("fill","none");
      ln.setAttribute("stroke", c);
      ln.setAttribute("stroke-width", _isBarrierDraw ? "0.008" : "0.006");
      if(_isBarrierDraw) ln.setAttribute("stroke-dasharray","0.006 0.018");
      svg.appendChild(ln);
    }

    // Markers
    overlay.querySelectorAll(".marker").forEach(n=>n.remove());
    const _sid = ctx.helpers.radioShortId || (src => (src||"").slice(0,3).toUpperCase());
    for(const r of ctx.state.maps._draftReceivers){
      const mk = document.createElement("div");
      mk.className = "marker" + (ctx.state.maps._selectedRxId===r.id ? " selected" : "");
      mk.style.left = `${Math.round((r.x||0)*10000)/100}%`;
      mk.style.top  = `${Math.round((r.y||0)*10000)/100}%`;
      const sid = r.source ? _sid(r.source) : "";
      mk.title = (r.label || r.id || "receiver") + (sid ? ` [${sid}]` : "") + (r.room ? ` • ${r.room}` : "");
      mk.textContent = sid || (r.label || r.id || "R").slice(0,2).toUpperCase();
      mk.addEventListener("click", (ev)=>{
        if(ctx.state.maps._mode==="measure") return; // let click pass through to stage
        ev.stopPropagation();
        if(ctx.state.maps._mode!=="receivers") return;
        ctx.state.maps._selectedRxId = r.id;
        renderAll(); renderTools();
      });
      _makeDraggable(mk, r, overlay, ()=>{ renderAll(); refreshList(); }, ()=>ctx.state.maps._mode==="receivers", (v)=>{ if(ctx.state.maps) ctx.state.maps._editDragging=v; });
      overlay.appendChild(mk);
    }

    // Measure mode: draw saved measurement lines + current points
    if (ctx.state.maps._mode === "measure") {
      // Previously saved measurements (dimmed)
      const savedMeas = ctx.state.maps._measurements || [];
      const measColors = ["#f59e0b", "#e879f9"];
      for (let mi = 0; mi < savedMeas.length; mi++) {
        const sm = savedMeas[mi]; const col = measColors[mi % measColors.length];
        const sLine = document.createElementNS("http://www.w3.org/2000/svg", "line");
        sLine.setAttribute("x1", sm.p1[0]); sLine.setAttribute("y1", sm.p1[1]);
        sLine.setAttribute("x2", sm.p2[0]); sLine.setAttribute("y2", sm.p2[1]);
        sLine.setAttribute("stroke", col); sLine.setAttribute("stroke-width", "0.003");
        sLine.setAttribute("stroke-dasharray", "0.008 0.004"); sLine.setAttribute("opacity", "0.6");
        sLine.style.pointerEvents = "none";
        svg.appendChild(sLine);
        for (const pt of [sm.p1, sm.p2]) {
          const d = document.createElementNS("http://www.w3.org/2000/svg", "circle");
          d.setAttribute("cx", pt[0]); d.setAttribute("cy", pt[1]);
          d.setAttribute("r", "0.006"); d.setAttribute("fill", col); d.setAttribute("opacity", "0.6");
          d.style.pointerEvents = "none";
          svg.appendChild(d);
        }
        // Label
        const mx = (sm.p1[0] + sm.p2[0]) / 2, my = (sm.p1[1] + sm.p2[1]) / 2;
        const lab = document.createElementNS("http://www.w3.org/2000/svg", "text");
        lab.setAttribute("x", mx); lab.setAttribute("y", my - 0.015);
        lab.setAttribute("text-anchor", "middle"); lab.setAttribute("font-size", "0.025");
        lab.setAttribute("fill", col); lab.setAttribute("opacity", "0.8");
        lab.textContent = `${sm.distance_m}m @ ${sm.angle_deg}\u00b0`;
        svg.appendChild(lab);
      }
      // Current points being placed (pointer-events:none so clicks pass through)
      const mPts = ctx.state.maps._measurePts || [];
      for (const pt of mPts) {
        const dot = document.createElementNS("http://www.w3.org/2000/svg", "circle");
        dot.setAttribute("cx", pt[0]); dot.setAttribute("cy", pt[1]);
        dot.setAttribute("r", "0.008"); dot.setAttribute("fill", "#60a5fa");
        dot.setAttribute("stroke", "white"); dot.setAttribute("stroke-width", "0.002");
        dot.style.pointerEvents = "none";
        svg.appendChild(dot);
      }
      if (mPts.length === 2) {
        const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
        line.setAttribute("x1", mPts[0][0]); line.setAttribute("y1", mPts[0][1]);
        line.setAttribute("x2", mPts[1][0]); line.setAttribute("y2", mPts[1][1]);
        line.setAttribute("stroke", "#60a5fa"); line.setAttribute("stroke-width", "0.003");
        line.setAttribute("stroke-dasharray", "0.01 0.005");
        line.style.pointerEvents = "none";
        svg.appendChild(line);
      }
    }
  };

  const renderTools = ()=>{
    right.innerHTML = "";
    right.appendChild(modeRow);

    // ── Suggest Placement button ──────────────────────────────────────────────
    {
      const polyRooms = Object.values(ctx.state.maps._draftRoomBounds||{})
        .filter(b=>b?.type==="poly" && Array.isArray(b.points) && b.points.length>=3);
      const hasData = polyRooms.length >= 1;
      const isActive = !!(ctx.state.maps._recommendPoly);
      const recoBtn = document.createElement("button");
      recoBtn.className = "btn inline" + (isActive ? " primary" : "");
      recoBtn.style.marginTop = "8px";
      recoBtn.disabled = !hasData;
      if(!hasData) recoBtn.style.opacity = "0.4";
      recoBtn.title = hasData
        ? "Analyse coverage gaps and highlight the best area to place a new scanner"
        : "Draw room boundaries first to enable coverage gap analysis";
      recoBtn.textContent = isActive ? "Clear Suggestion" : "Suggest Placement";
      recoBtn.addEventListener("click", ()=>{
        if(isActive){
          ctx.state.maps._recommendPoly = null;
          renderAll(); renderTools();
          return;
        }
        const snap = (ctx.state.live && ctx.state.live.snapshot) || null;
        const result = _recommendPlacement(ctx.state.maps._draftReceivers, ctx.state.maps._draftRoomBounds, snap);
        if(!result){
          ctx.toast("All areas appear well-covered — no obvious placement gaps found.", false);
          return;
        }
        ctx.state.maps._recommendPoly = result;
        renderAll(); renderTools();
        const rNames = result.rooms.slice(0,3).join(", ");
        ctx.toast(`Coverage gap found near: ${rNames}${result.rooms.length>3?" +more":""}`, false);
      });
      right.appendChild(recoBtn);
    }

    if(ctx.state.maps._mode==="receivers"){
      right.appendChild(el("div",{class:"muted", style:"margin-top:10px;font-size:12px"}, "Receiver tools"));
      right.appendChild(el("div",{style:"display:flex;gap:10px;flex-wrap:wrap;margin-top:8px"},[
        el("button",{class:"btn inline", onclick:()=>{
          const id = `rx_${Date.now().toString(16)}`;
          ctx.state.maps._draftReceivers.push({id, label:`Receiver ${ctx.state.maps._draftReceivers.length+1}`, x:0.5, y:0.5, room:""});
          ctx.state.maps._selectedRxId = id;
          renderAll(); refreshList(); renderTools();
        }}, "Add Receiver"),
        el("button",{class:"btn inline", onclick:()=>{
          if(!ctx.state.maps._draftReceivers.length) return;
          const last = ctx.state.maps._draftReceivers.pop();
          if(last && ctx.state.maps._selectedRxId===last.id) ctx.state.maps._selectedRxId=null;
          renderAll(); refreshList(); renderTools();
        }}, "Undo"),
      ]));

      const sel = ctx.state.maps._draftReceivers.find(x=>x.id===ctx.state.maps._selectedRxId) || null;
      if(sel){
        const lbl = el("input",{type:"text", value: sel.label||"", placeholder:"Receiver label"});
        lbl.addEventListener("input", ()=>{ sel.label = lbl.value; renderAll(); refreshList(); });

        const roomSel = document.createElement("select");
        roomSel.className = "select";
        const opt0 = document.createElement("option"); opt0.value=""; opt0.textContent="(no room)"; roomSel.appendChild(opt0);
        for(const r of eligibleRooms){
          const o = document.createElement("option");
          o.value = r; o.textContent = r;
          roomSel.appendChild(o);
        }
        roomSel.value = sel.room || "";
        roomSel.addEventListener("change", ()=>{
          sel.room = roomSel.value || "";
          renderAll(); refreshList();
        });

        right.appendChild(el("div",{style:"margin-top:10px"},[
          el("div",{class:"muted", style:"font-size:12px"},"Selected receiver"),
          el("div",{style:"display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin-top:6px"},[
            el("div",{class:"pill"}, sel.id),
            el("div",{class:"muted", style:"font-size:12px"}, `x=${(sel.x||0).toFixed(3)} y=${(sel.y||0).toFixed(3)}`),
          ]),
          lbl,
          el("div",{class:"muted", style:"font-size:12px;margin-top:6px"},"Room"),
          roomSel,
          el("button",{class:"btn inline", style:"margin-top:8px", onclick:()=>{
            ctx.state.maps._draftReceivers = ctx.state.maps._draftReceivers.filter(x=>x.id!==sel.id);
            ctx.state.maps._selectedRxId = null;
            renderAll(); refreshList(); renderTools();
          }}, "Delete receiver"),
        ]));
      } else {
        right.appendChild(el("div",{class:"muted", style:"margin-top:10px;font-size:12px"}, "Tip: click a radio marker to edit its room assignment."));
      }

      // Live BLE Radios panel — shows actual HA BLE scanners for placement
      const snap2 = (ctx.state.live && ctx.state.live.snapshot) || null;
      const liveRadios = (snap2 && snap2.ble && Array.isArray(snap2.ble.radios)) ? snap2.ble.radios : [];
      const _sid = ctx.helpers.radioShortId || (src => src.slice(0,3).toUpperCase());
      right.appendChild(el("div",{class:"muted", style:"margin-top:14px;font-size:12px;font-weight:600"}, "Live BLE Radios"));
      if(liveRadios.length){
        right.appendChild(el("div",{class:"muted", style:"font-size:11px;margin-top:2px;margin-bottom:6px"}, "Click Add to place on map, then drag to position."));
        const radList = el("div",{style:"display:flex;flex-direction:column;gap:5px"});
        for(const radio of liveRadios){
          const alreadyPlaced = ctx.state.maps._draftReceivers.some(r => (r.source && r.source === radio.source) || (r.label && radio.name && r.label.toLowerCase() === radio.name.toLowerCase()) || r.id === radio.source);
          const sid = _sid(radio.source || "");
          const borderColor = radio.disabled ? "#5b3b7a" : radio.lost ? "#7d5c2b" : "#1b3526";
          const bg = radio.disabled ? "rgba(148,100,220,.06)" : radio.lost ? "rgba(245,158,11,.06)" : "#0a150e";
          const row = el("div",{style:`display:flex;align-items:center;gap:6px;padding:4px 6px;border:1px solid ${borderColor};border-radius:6px;background:${bg};opacity:${(radio.lost||radio.disabled)?0.75:1}`});
          // ID pill
          row.appendChild(el("span",{style:"font-family:monospace;font-weight:700;font-size:10px;color:#94a3b8;white-space:nowrap"}, sid));
          // Name + room
          const info = el("div",{style:"flex:1;min-width:0"});
          info.appendChild(el("div",{style:"font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap"}, radio.name || radio.source || "Unknown"));
          const _netParts = [radio.area_name || "no room"];
          if(radio.ip) _netParts.push(radio.ip);
          if(radio.ssid) _netParts.push(radio.ssid);
          else if(radio.connection_type) _netParts.push(radio.connection_type);
          info.appendChild(el("div",{class:"muted",style:"font-size:10px"}, _netParts.join(" · ")));
          row.appendChild(info);
          if(radio.disabled){
            row.appendChild(el("span",{style:"font-size:10px;color:#c084fc;white-space:nowrap"}, "⊘ Disabled"));
          } else if(radio.lost){
            row.appendChild(el("span",{style:"font-size:10px;color:#f59e0b;white-space:nowrap"}, "⚠ Lost"));
          } else if(alreadyPlaced){
            row.appendChild(el("span",{style:"font-size:10px;color:#52b788;white-space:nowrap"}, "✓ placed"));
          } else {
            row.appendChild(el("button",{class:"btn inline", style:"font-size:10px;padding:2px 8px;white-space:nowrap", onclick:()=>{
              const id = `rx_${Date.now().toString(16)}`;
              ctx.state.maps._draftReceivers.push({
                id, label: radio.name || radio.source || id,
                x: 0.5, y: 0.5,
                room: radio.area_name || "",
                source: radio.source || "",
              });
              ctx.state.maps._selectedRxId = id;
              renderAll(); refreshList(); renderTools();
            }}, "Add"));
          }
          radList.appendChild(row);
        }
        right.appendChild(radList);
      } else {
        right.appendChild(el("div",{class:"muted", style:"margin-top:4px;font-size:11px"},
          snap2 ? "No live BLE radios detected. Enable Bluetooth proxy in HA." : "Switch to Live mode to see your BLE scanners."));
      }
    } else if(ctx.state.maps._mode==="barriers"){
      right.appendChild(el("div",{class:"muted", style:"margin-top:10px;font-size:12px"}, "RF Barrier tools"));

      // Material selector
      const matSel = document.createElement("select");
      matSel.className = "select";
      for(const [mat, atten, label] of [["open",0,"Open (Loft) — no wall"],["brick",4,null],["concrete",8,null],["metal",12,null],["custom",6,null]]){
        const o = document.createElement("option");
        o.value = mat; o.textContent = label || `${mat.charAt(0).toUpperCase()+mat.slice(1)} (${atten} dB)`;
        matSel.appendChild(o);
      }
      matSel.value = ctx.state.maps._barrierMaterial || "metal";
      matSel.addEventListener("change", ()=>{ ctx.state.maps._barrierMaterial = matSel.value; });
      right.appendChild(el("div",{style:"margin-top:8px"},[
        el("div",{class:"muted",style:"font-size:12px;margin-bottom:4px"}, "Material"),
        matSel,
      ]));

      // Drawing controls
      const bDrawing = ctx.state.maps._drawing;
      const bPts = bDrawing ? bDrawing.points.length : 0;
      const bUndoPt = el("button",{class:"btn inline", onclick:()=>{
        if(!ctx.state.maps._drawing || !ctx.state.maps._drawing.points.length) return;
        ctx.state.maps._drawing.points.pop();
        renderAll(); renderTools();
      }}, "Undo point");
      const bFinish = el("button",{class:"btn inline", onclick: async ()=>{
        const d = ctx.state.maps._drawing;
        if(!d || d.points.length < 2){ ctx.toast("Need at least 2 points for a barrier.", true); return; }
        const mat = ctx.state.maps._barrierMaterial || "metal";
        const pts = d.points.slice();
        ctx.state.maps._drawing = null;
        const id = await _placeWall(`Wall ${_fabricWallsHere().length + 1}`, mat, _MAT_ATTEN[mat] ?? 6, pts);
        if (id) ctx.state.maps._selectedBarrierId = id;
        renderAll(); renderTools();
      }}, `Finish (${bPts} pts)`);
      const bCancel = el("button",{class:"btn inline", onclick:()=>{
        ctx.state.maps._drawing = null;
        renderAll(); renderTools();
      }}, "Cancel");
      right.appendChild(el("div",{style:"display:flex;gap:10px;flex-wrap:wrap;margin-top:8px"},[
        bUndoPt, bFinish, bCancel,
      ]));
      right.appendChild(el("div",{class:"muted",style:"font-size:11px;margin-top:6px"}, bDrawing
        ? `Drawing: ${bPts} point${bPts!==1?"s":""} placed. Click on map to add, double-click or Finish to complete.`
        : (_wallTx()
            ? "Click on the map to start drawing a wall. It is stored in metres in the fabric the moment you finish."
            : "Measure this map first (Measure tool): walls are stored in metres, and this map has no scale yet.")));

      // The fabric's walls on this floor
      const bList = _fabricWallsHere();
      if(bList.length){
        const layersDiv = el("div",{style:"margin-top:14px"});
        layersDiv.appendChild(el("div",{class:"muted",style:"font-size:12px;font-weight:600;margin-bottom:6px"},`Walls on this floor (${bList.length})`));
        const _matColors2 = _MAT_COLORS;
        for(let bi = 0; bi < bList.length; bi++){
          const bar = bList[bi];
          const bc = _matColors2[bar.material] || "#ef4444";
          const isSel = ctx.state.maps._selectedBarrierId === bar.id;
          const delBtn = el("button",{class:"btn tiny"},"Delete");
          delBtn.addEventListener("click", async (ev)=>{
            ev.stopPropagation();
            if(!confirm(`Delete wall "${bar.name || "wall"}"?`)) return;
            await _removeWall(bar.id);
            if(ctx.state.maps._selectedBarrierId === bar.id) ctx.state.maps._selectedBarrierId = null;
            renderAll(); renderTools();
          });
          const row = el("div",{style:`display:flex;align-items:center;gap:6px;padding:5px 8px;border:1px solid ${isSel?"#52b788":"#1b3526"};border-radius:6px;background:${isSel?"#0f1f16":"#0a150e"};margin-bottom:4px;cursor:pointer`});
          row.addEventListener("click", ()=>{ ctx.state.maps._selectedBarrierId = bar.id; renderAll(); renderTools(); });
          row.appendChild(el("span",{style:`width:10px;height:3px;background:${bc};flex-shrink:0;border-radius:1px`}));
          row.appendChild(el("div",{style:"flex:1"},[
            el("div",{style:"font-size:12px;font-weight:600"}, bar.name || `Barrier ${bi+1}`),
            el("div",{class:"muted",style:"font-size:10px"}, bar.material === "open" ? `Open (Loft) · ${(bar.points||[]).length} pts` : `${bar.material} · ${bar.attenuation_dbm}dB · ${(bar.points||[]).length} pts`),
          ]));
          row.appendChild(delBtn);
          layersDiv.appendChild(row);
        }
        const clearAllBtn = el("button",{class:"btn inline",style:"margin-top:6px",onclick: async ()=>{
          if(!confirm(`Delete all ${bList.length} wall(s) on this floor from the fabric?`)) return;
          for (const bar of bList) await _removeWall(bar.id);
          ctx.state.maps._selectedBarrierId = null;
          renderAll(); renderTools();
        }}, "Delete all walls on this floor");
        layersDiv.appendChild(clearAllBtn);
        right.appendChild(layersDiv);
      }

    } else {
      right.appendChild(el("div",{class:"muted", style:"margin-top:10px;font-size:12px"}, "Room boundary tools"));

      // Build lookup: rooms already placed on OTHER maps (for warning in dropdown)
      const _allMaps = (ctx.state.maps && ctx.state.maps.list) ? ctx.state.maps.list : [];
      const _roomPlacedOn = {}; // room name → map name
      for(const om of _allMaps){
        if(om.id === map.id) continue;
        for(const rn of Object.keys(om.room_bounds || {})){
          _roomPlacedOn[rn] = om.name || om.id;
        }
      }

      const roomSel = document.createElement("select");
      roomSel.className = "select";
      const opt = document.createElement("option"); opt.value=""; opt.textContent="Choose room…"; roomSel.appendChild(opt);
      for(const r of eligibleRooms){
        const o = document.createElement("option");
        o.value = r;
        o.textContent = _roomPlacedOn[r] ? `${r}  ⚠ on "${_roomPlacedOn[r]}"` : r;
        if(_roomPlacedOn[r]) o.style.color = "#fbbf24";
        roomSel.appendChild(o);
      }
      roomSel.value = ctx.state.maps._selectedRoom || "";
      roomSel.addEventListener("change", ()=>{
        ctx.state.maps._selectedRoom = roomSel.value || "";
        ctx.state.maps._drawing = null;
        renderAll(); renderTools();
      });

      const startBtn = el("button",{class:"btn inline", onclick:()=>{
        if(!ctx.state.maps._selectedRoom){ ctx.toast("Choose a room first.", true); return; }
        ctx.state.maps._drawing = { room: ctx.state.maps._selectedRoom, points: [] };
        renderAll(); renderTools();
      }}, "Start drawing");

      const undoPt = el("button",{class:"btn inline", onclick:()=>{
        if(!ctx.state.maps._drawing || !ctx.state.maps._drawing.points.length) return;
        ctx.state.maps._drawing.points.pop();
        renderAll(); renderTools();
      }}, "Undo point");

      const finishBtn = el("button",{class:"btn inline", onclick:()=>{
        const d = ctx.state.maps._drawing;
        if(!d || !Array.isArray(d.points) || d.points.length < 3){ ctx.toast("Need at least 3 points.", true); return; }
        ctx.state.maps._draftRoomBounds[d.room] = { type:"poly", points: d.points.map(p=>[clamp01(p[0]), clamp01(p[1])]) };
        ctx.state.maps._drawing = null;
        renderAll(); refreshList(); renderTools();
      }}, "Finish");

      const clearBtn = el("button",{class:"btn inline", onclick:()=>{
        const r = ctx.state.maps._selectedRoom;
        if(!r) return;
        delete ctx.state.maps._draftRoomBounds[r];
        ctx.state.maps._drawing = null;
        renderAll(); refreshList(); renderTools();
      }}, "Clear boundary");

      right.appendChild(roomSel);

      // Warning if selected room is already drawn on another map
      const _selRoom = ctx.state.maps._selectedRoom;
      if(_selRoom && _roomPlacedOn[_selRoom]){
        right.appendChild(el("div",{style:"margin-top:6px;padding:6px 10px;border-radius:6px;background:#2a1a0a;border:1px solid #d97706;font-size:11px;color:#fbbf24"},
          `This room already has a boundary on "${_roomPlacedOn[_selRoom]}". Drawing it here will create a duplicate.`));
      }

      // "Enclose" button — auto-generate RF barriers along all edges of this room's polygon
      const encloseBtn = el("button",{class:"btn inline", style:"color:#f59e0b;border-color:#92400e",
        title:"Add weak RF barriers (3 dB) along every edge of this room's boundary polygon — models thin interior walls",
        onclick: async ()=>{
        const r2 = ctx.state.maps._selectedRoom;
        if(!r2){ ctx.toast("Choose a room first.", true); return; }
        const poly = ctx.state.maps._draftRoomBounds && ctx.state.maps._draftRoomBounds[r2];
        if(!poly || poly.type !== "poly" || !poly.points || poly.points.length < 3){
          ctx.toast("Draw the room boundary first, then enclose.", true); return;
        }
        const pts = poly.points;
        let added = 0;
        if(!_wallTx()){ ctx.toast("Measure this map first (Measure tool) — walls are stored in metres.", true); return; }
        for(let i = 0; i < pts.length; i++){
          const a = pts[i], b = pts[(i + 1) % pts.length];
          await _placeWall(`${r2} wall ${i + 1}`, "custom", 3, [[a[0], a[1]], [b[0], b[1]]]);
          added++;
        }
        ctx.toast(`Added ${added} wall segment${added!==1?"s":""} around ${r2} at 3 dB`);
        renderAll(); renderTools();
      }}, "Enclose (3dB walls)");

      right.appendChild(el("div",{style:"display:flex;gap:10px;flex-wrap:wrap;margin-top:8px"},[
        startBtn, undoPt, finishBtn, clearBtn, encloseBtn,
      ]));

      const r = ctx.state.maps._selectedRoom;
      if(r){
        const hasPoly = ctx.state.maps._draftRoomBounds && ctx.state.maps._draftRoomBounds[r] && ctx.state.maps._draftRoomBounds[r].type==="poly";
        const hint = hasPoly ? "Boundary saved. You can re-draw to replace it." : "No boundary yet. If a receiver is assigned to this room, you will see a dashed auto-circle until you draw a polygon.";
        right.appendChild(el("div",{class:"muted", style:"margin-top:10px;font-size:12px"}, hint));
        // Tags list for the selected room (LIVE detected + configured-missing)
        const snap = ctx.state.live && ctx.state.live.snapshot;
        const liveTags = (snap && Array.isArray(snap.tags)) ? snap.tags.filter(t => t && t.room === r && !t.missing) : [];
        const missing = (snap && snap.room_tag_map_missing && snap.room_tag_map_missing[r]) ? snap.room_tag_map_missing[r] : [];

        const tagBox = el("div", { style: "margin-top:10px" });
        tagBox.appendChild(el("div", { class: "muted", style: "font-size:12px;margin-bottom:4px" }, "Tags in this room (live):"));

        if (liveTags.length) {
          const list = el("div", { class: "list" });
          for (const t of liveTags) {
            const item = el("div", { class: "item" });
            const tw = el("div", { style: "display:flex;flex-direction:column;gap:2px;flex:1" });
            tw.appendChild(el("span", {}, String(t.name || t.entity_id)));
            tw.appendChild(el("span", { class: "muted" }, `${t.entity_id} • ${t.state}`));
            item.appendChild(tw);
            list.appendChild(item);
          }
          tagBox.appendChild(list);
        } else {
          tagBox.appendChild(el("div", { class: "muted", style: "font-size:12px" }, "No live tags detected for this room."));
        }

        if (missing && missing.length) {
          tagBox.appendChild(el("div", { class: "muted", style: "font-size:12px;margin-top:6px" }, `Configured (missing): ${missing.length}`));
        }

        right.appendChild(tagBox);

      }

      // --- Polygon Layers ---
      const polyEntries = Object.entries(ctx.state.maps._draftRoomBounds || {}).filter(([,b]) => b && b.type === "poly");
      if(polyEntries.length){
        const layersDiv = el("div",{style:"margin-top:14px"});
        layersDiv.appendChild(el("div",{class:"muted",style:"font-size:12px;font-weight:600;margin-bottom:6px"},`Polygon layers (${polyEntries.length})`));
        for(const [room, b] of polyEntries){
          const isOrphan = !allRooms.includes(room);
          const c = roomColor(room);
          const delBtn = el("button",{class:"btn tiny"},"Delete");
          delBtn.addEventListener("click", ()=>{
            delete ctx.state.maps._draftRoomBounds[room];
            renderAll(); refreshList(); renderTools();
          });
          const row = el("div",{style:"display:flex;align-items:center;gap:6px;padding:5px 8px;border:1px solid #1b3526;border-radius:6px;background:#0a150e;margin-bottom:4px"},[
            el("span",{style:`width:10px;height:10px;border-radius:50%;background:${c};flex-shrink:0`}),
            el("div",{style:"flex:1"},[
              el("div",{style:`font-size:12px;font-weight:600${isOrphan?";color:#f59e0b":""}`},room+(isOrphan?" ⚠ orphan":"")),
              el("div",{class:"muted",style:"font-size:10px"},`${(b.points||[]).length} points${isOrphan?" · not in room registry":""}`),
            ]),
            delBtn,
          ]);
          layersDiv.appendChild(row);
        }
        right.appendChild(layersDiv);
      }
    }

    // ── Measure tool panel (two-measurement aspect ratio validation) ─────
    if (ctx.state.maps._mode === "measure") {
      const mPanel = el("div",{style:"margin-top:10px;padding:10px;border:1px solid #1e4976;border-radius:8px;background:#0a1a2a"});
      const mPts = ctx.state.maps._measurePts || [];
      const imgW = map.image?.width || 800;
      const imgH = map.image?.height || 600;
      const cal = map.calibration || {};
      if (!ctx.state.maps._measurements) ctx.state.maps._measurements = [];
      const meas = ctx.state.maps._measurements;

      mPanel.appendChild(el("div",{style:"font-weight:700;font-size:13px;color:#7dd3fc;margin-bottom:6px"},
        "\ud83d\udccf Reference Distance Calibration"));
      mPanel.appendChild(el("div",{class:"muted",style:"font-size:11px;margin-bottom:8px;line-height:1.5"},
        "Two measurements at different angles are required to verify the map's aspect ratio. Click two points, enter the real distance, then repeat at a different angle."));

      // Current measurement progress
      const needed = 2 - meas.length;
      if (needed > 0) {
        mPanel.appendChild(el("div",{style:"font-size:11px;color:#f59e0b;margin-bottom:6px;font-weight:600"},
          `Measurement ${meas.length + 1} of 2`));
      }

      if (mPts.length === 0) {
        mPanel.appendChild(el("div",{style:"color:#94a3b8;font-size:12px"}, "Click the first point on the map\u2026"));
      } else if (mPts.length === 1) {
        mPanel.appendChild(el("div",{style:"color:#7dd3fc;font-size:12px"}, `Point 1 set. Now click the second point\u2026`));
      } else if (mPts.length >= 2) {
        const dx_px = (mPts[1][0] - mPts[0][0]) * imgW;
        const dy_px = (mPts[1][1] - mPts[0][1]) * imgH;
        const dist_px = Math.sqrt(dx_px * dx_px + dy_px * dy_px);
        const angle_deg = Math.round(Math.atan2(Math.abs(dy_px), Math.abs(dx_px)) * 180 / Math.PI);

        mPanel.appendChild(el("div",{style:"color:#52b788;font-size:12px;margin-bottom:4px"},
          `Two points selected \u2014 ${dist_px.toFixed(1)}px at ${angle_deg}\u00b0`));

        const inputRow = el("div",{style:"display:flex;align-items:center;gap:8px;flex-wrap:wrap"});
        const distInput = document.createElement("input");
        distInput.type = "number"; distInput.min = "0.1"; distInput.max = "500"; distInput.step = "0.1";
        distInput.placeholder = "metres";
        distInput.style.cssText = "width:100px;padding:4px 8px;border:1px solid #334155;border-radius:4px;background:#1e293b;color:#e2e8f0;font-size:12px";
        inputRow.appendChild(el("span",{style:"font-size:11px;color:#94a3b8"},"Real distance:"));
        inputRow.appendChild(distInput);
        inputRow.appendChild(el("span",{style:"font-size:11px;color:#94a3b8"},"m"));

        const addBtn = el("button",{class:"btn inline",style:"font-size:11px;padding:4px 12px;color:#7dd3fc;border-color:#1e4976"},
          meas.length === 0 ? "Add 1st Measurement" : "Add 2nd Measurement");
        addBtn.addEventListener("click", () => {
          const realDist = parseFloat(distInput.value);
          if (!realDist || realDist <= 0) { ctx.toast("Enter a valid distance"); return; }
          const ppm = dist_px / realDist;
          meas.push({
            p1: [mPts[0][0], mPts[0][1]], p2: [mPts[1][0], mPts[1][1]],
            dist_px, distance_m: realDist, px_per_meter: ppm, angle_deg,
          });
          ctx.state.maps._measurePts = [];
          renderAll(); renderTools();
        });
        inputRow.appendChild(addBtn);
        mPanel.appendChild(inputRow);
      }

      // Show collected measurements
      if (meas.length > 0) {
        const measDiv = el("div",{style:"margin-top:8px;border-top:1px solid #1e3a4a;padding-top:8px"});
        for (let i = 0; i < meas.length; i++) {
          const m2 = meas[i];
          measDiv.appendChild(el("div",{style:"font-size:11px;color:#7dd3fc;margin-bottom:2px"},
            `#${i+1}: ${m2.distance_m}m \u2192 ${m2.px_per_meter.toFixed(1)} px/m at ${m2.angle_deg}\u00b0`));
        }
        mPanel.appendChild(measDiv);
      }

      // When 2 measurements collected — show analysis + apply
      if (meas.length >= 2) {
        const ppm1 = meas[0].px_per_meter;
        const ppm2 = meas[1].px_per_meter;
        const avgPpm = (ppm1 + ppm2) / 2;
        const diff = Math.abs(ppm1 - ppm2);
        const diffPct = (diff / avgPpm * 100);
        const angleDiff = Math.abs(meas[0].angle_deg - meas[1].angle_deg);

        const analysisDiv = el("div",{style:"margin-top:8px;padding:8px;border-radius:6px"});

        if (angleDiff < 15) {
          analysisDiv.style.background = "rgba(245,158,11,.08)";
          analysisDiv.style.border = "1px solid #f59e0b33";
          analysisDiv.appendChild(el("div",{style:"font-size:11px;color:#fbbf24;font-weight:600"},
            `\u26a0 Measurements are at similar angles (${meas[0].angle_deg}\u00b0 vs ${meas[1].angle_deg}\u00b0). For best results, measure at different orientations (e.g., one horizontal, one more vertical).`));
        }

        if (diffPct <= 10) {
          analysisDiv.style.background = analysisDiv.style.background || "rgba(82,183,136,.08)";
          analysisDiv.style.border = analysisDiv.style.border || "1px solid #52b78833";
          analysisDiv.appendChild(el("div",{style:"font-size:12px;color:#52b788;font-weight:700;margin-bottom:4px"},
            `\u2705 Aspect ratio OK \u2014 ${diffPct.toFixed(1)}% difference`));
          analysisDiv.appendChild(el("div",{style:"font-size:11px;color:#94a3b8"},
            `Scale: ${avgPpm.toFixed(1)} px/m (avg of ${ppm1.toFixed(1)} and ${ppm2.toFixed(1)}). Map width = ${(imgW/avgPpm).toFixed(1)}m, height = ${(imgH/avgPpm).toFixed(1)}m`));
        } else {
          analysisDiv.style.background = "rgba(248,113,113,.08)";
          analysisDiv.style.border = "1px solid #f8717133";
          analysisDiv.appendChild(el("div",{style:"font-size:12px;color:#f87171;font-weight:700;margin-bottom:4px"},
            `\u26a0 Map appears stretched \u2014 ${diffPct.toFixed(1)}% scale difference`));
          analysisDiv.appendChild(el("div",{style:"font-size:11px;color:#94a3b8"},
            `Measurement 1: ${ppm1.toFixed(1)} px/m at ${meas[0].angle_deg}\u00b0. Measurement 2: ${ppm2.toFixed(1)} px/m at ${meas[1].angle_deg}\u00b0. Average: ${avgPpm.toFixed(1)} px/m`));
          analysisDiv.appendChild(el("div",{style:"font-size:10px;color:#fca5a5;margin-top:4px"},
            "The floor plan image may have non-uniform scaling. Consider re-exporting the image with correct proportions."));
        }
        mPanel.appendChild(analysisDiv);

        // Pre-compute dimensions for the button label (same formula as inside the click handler)
        const _preview_x_m = Math.round((imgW / avgPpm) * 10000) / 10000;
        const _preview_y_m = Math.round((imgH / avgPpm) * 10000) / 10000;

        // Save button — prominent green to make it clear this is the save action
        const applyBtn = el("button",{class:"btn save-pulse",style:"margin-top:12px;width:100%;padding:12px;font-size:15px;background:#1a3a0a;border:2px solid #52b788;color:#86efac;font-weight:800;border-radius:8px;cursor:pointer"},
          `\ud83d\udcbe  Save Scale: ${avgPpm.toFixed(1)} px/m \u2192 ${_preview_x_m.toFixed(1)}m \u00d7 ${_preview_y_m.toFixed(1)}m`);
        applyBtn.addEventListener("click", async () => {
          applyBtn.disabled = true; applyBtn.textContent = "Saving\u2026";
          const ppm = Math.round(avgPpm * 100) / 100;
          const fl = map.floor_id || "main";

          // Compute transform directly and save to fabric (authority)
          const scale_x_m = Math.round((imgW / ppm) * 10000) / 10000;
          const scale_y_m = Math.round((imgH / ppm) * 10000) / 10000;
          // NO origin and NO rotation, deliberately, for the same reason as
          // shear below. This measures how BIG the map is; it does not measure
          // where the map is or which way it faces. The three of them used to
          // be derived from the stack here — `(0,0)` if the map carried the
          // master flag, `x_offset * scale_x_m` otherwise, rotation off the
          // alignment — which was this panel reading the OTHER copy of the
          // placement and writing it back into this one. The stack is derived
          // from this record now, so there is no other copy to read, and the
          // writer's rule already keeps the stored pose for a payload that does
          // not state one.
          const transform = {
            scale_x_m, scale_y_m,
            // NO shear_rad, deliberately. A placement field is changed only by
            // a payload that STATES it, and a scale re-measure does not
            // measure the lean — so this says nothing about it and the store
            // keeps the one on disk.
            //
            // `shear_rad: Number(_savedTx.shear_rad) || 0` was worse than
            // saying nothing twice over. `|| 0` turns "this panel has no
            // cached record for that map" into an explicit "square", which is
            // the straightening the backend rule exists to stop, said out
            // loud so the backend obeys it. And when the panel DOES hold a
            // record it may be stale — a Point Align writes σ that this tab
            // does not see until its next refresh — so restating it puts the
            // old lean back on a map that has since been realigned.
            floor_id: fl,
            reference_measurements: meas.map(m2 => ({
              p1: [m2.p1[0], m2.p1[1]], p2: [m2.p2[0], m2.p2[1]],
              distance_m: m2.distance_m, px_per_meter: Math.round(m2.px_per_meter * 100) / 100,
              angle_deg: m2.angle_deg, date: new Date().toISOString().slice(0, 10),
            })),
          };
          try {
            // Save transform directly to fabric — fabric is the sole authority
            const _txResult = await ctx.actions.callWS({ type: "padspan_ha/fabric_map_transform_set", map_id: map.id, transform });
            // Re-derive spatial data for this map only (don't overwrite other transforms)
            try {
            } catch(e2) {}
            ctx.toast(`Scale saved: ${scale_x_m.toFixed(1)}m \u00d7 ${scale_y_m.toFixed(1)}m (${ppm} px/m)`);
            ctx.state.maps._measurePts = [];
            ctx.state.maps._measurements = [];
            await ctx.actions.mapsRefresh();
          } catch(e) {
            ctx.toast("Save failed: " + (e.message || e));
            applyBtn.disabled = false; applyBtn.textContent = "Apply Scale";
          }
        });
        mPanel.appendChild(applyBtn);
      }

      // Current scale from fabric transform
      const _fabTx = (ctx.state.model?.map_transforms || {})[map.id];
      if (_fabTx && _fabTx.scale_x_m) {
        mPanel.appendChild(el("div",{style:"font-size:11px;color:#52b788;margin-top:8px"},
          `Current fabric scale: ${_fabTx.scale_x_m.toFixed(1)}m \u00d7 ${_fabTx.scale_y_m.toFixed(1)}m`));
        mPanel.appendChild(el("div",{style:"font-size:10px;color:#64748b;margin-top:2px"},
          `World origin: (${(_fabTx.origin_x_m||0).toFixed(2)}, ${(_fabTx.origin_y_m||0).toFixed(2)})m \u2014 locked; display edits never move it`));
        const reanchorBtn = el("button",{class:"btn inline",style:"font-size:10px;padding:2px 8px;margin-top:4px;color:#f59e0b"}, "\u2693 Re-anchor origin");
        reanchorBtn.title = "Redefine this map's world origin/rotation from its current stack placement. Calibration pins keep their real-world metres and re-derive on the image.";
        reanchorBtn.addEventListener("click", async () => {
          if(!confirm("Re-anchor this map's world origin to its current stack placement?\n\nCalibration pins keep their real-world positions (metres) and their on-image positions re-derive through the new origin. This is refused if most pins would land off the map.")) return;
          reanchorBtn.disabled = true;
          try {
            const r = await ctx.actions.callWS({ type: "padspan_ha/fabric_map_reanchor", map_id: map.id });
            ctx.toast(`Re-anchored: origin (${r.origin_x_m}, ${r.origin_y_m})m, ${r.cal_points_remapped} pin(s) remapped`);
            await ctx.actions.modelRefresh();   // origin readout reads ctx.state.model
            await ctx.actions.mapsRefresh();
          } catch(e) {
            ctx.toast("Re-anchor refused: " + (e.message || e));
          } finally {
            reanchorBtn.disabled = false;
          }
        });
        mPanel.appendChild(reanchorBtn);
      } else if (cal.px_per_meter) {
        mPanel.appendChild(el("div",{style:"font-size:11px;color:#f59e0b;margin-top:8px"},
          `Legacy map scale: ${cal.px_per_meter.toFixed(1)} px/m (not in fabric yet)`));
      }
      const resetBtn = el("button",{class:"btn inline",style:"font-size:10px;padding:2px 8px;margin-top:6px;color:#94a3b8"}, "Start Over");
      resetBtn.addEventListener("click", () => { ctx.state.maps._measurePts = []; ctx.state.maps._measurements = []; renderAll(); renderTools(); });
      mPanel.appendChild(resetBtn);

      right.appendChild(mPanel);
      // Auto-scroll to make measure panel visible
      setTimeout(() => mPanel.scrollIntoView({ behavior: "smooth", block: "nearest" }), 50);
    }

    right.appendChild(saveRow);
  };

  // --- Interactions on the stage ---
  stage.title = (ctx.state.maps._mode==="receivers") ? "Double-click to add receiver; drag to reposition" : "Click to add room points; double-click to finish";
  stage.addEventListener("dblclick", (ev)=>{
    if(ctx.state.maps._mode==="receivers"){
      const rect = overlay.getBoundingClientRect();
      const x = (ev.clientX - rect.left) / rect.width;
      const y = (ev.clientY - rect.top) / rect.height;
      const id = `rx_${Date.now().toString(16)}`;
      ctx.state.maps._draftReceivers.push({id, label:`Receiver ${ctx.state.maps._draftReceivers.length+1}`, x: clamp01(x), y: clamp01(y), room:""});
      ctx.state.maps._selectedRxId = id;
      renderAll(); refreshList(); renderTools();
      return;
    }
    // rooms mode: dblclick finishes if currently drawing
    if(ctx.state.maps._mode==="rooms" && ctx.state.maps._drawing){
      const d = ctx.state.maps._drawing;
      if(d.points.length >= 3){
        ctx.state.maps._draftRoomBounds[d.room] = { type:"poly", points: d.points.map(p=>[clamp01(p[0]), clamp01(p[1])]) };
      }
      ctx.state.maps._drawing = null;
      renderAll(); refreshList(); renderTools();
    }
    // barriers mode: dblclick finishes the wall — into the fabric, in metres
    if(ctx.state.maps._mode==="barriers" && ctx.state.maps._drawing){
      const d = ctx.state.maps._drawing;
      const pts = d.points.slice();
      ctx.state.maps._drawing = null;
      if(pts.length >= 2){
        const mat = ctx.state.maps._barrierMaterial || "metal";
        _placeWall(`Wall ${_fabricWallsHere().length + 1}`, mat, _MAT_ATTEN[mat] ?? 6, pts)
          .then(id => { if (id) ctx.state.maps._selectedBarrierId = id; renderAll(); renderTools(); });
      }
      renderAll(); renderTools();
    }
  });

  stage.addEventListener("click", (ev)=>{
    // Measure mode: collect 2 points (minimal DOM update, no full re-render)
    if(ctx.state.maps._mode==="measure"){
      const rect = overlay.getBoundingClientRect();
      const x = (ev.clientX - rect.left) / rect.width;
      const y = (ev.clientY - rect.top) / rect.height;
      if (!ctx.state.maps._measurePts) ctx.state.maps._measurePts = [];
      if (ctx.state.maps._measurePts.length < 2) {
        ctx.state.maps._measurePts.push([x, y]);
        // Add dot directly to SVG without full re-render
        const dot = document.createElementNS("http://www.w3.org/2000/svg", "circle");
        dot.setAttribute("cx", x); dot.setAttribute("cy", y);
        dot.setAttribute("r", "0.008"); dot.setAttribute("fill", "#60a5fa");
        dot.setAttribute("stroke", "white"); dot.setAttribute("stroke-width", "0.002");
        dot.style.pointerEvents = "none";
        svg.appendChild(dot);
        if (ctx.state.maps._measurePts.length === 2) {
          const p = ctx.state.maps._measurePts;
          const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
          line.setAttribute("x1", p[0][0]); line.setAttribute("y1", p[0][1]);
          line.setAttribute("x2", p[1][0]); line.setAttribute("y2", p[1][1]);
          line.setAttribute("stroke", "#60a5fa"); line.setAttribute("stroke-width", "0.003");
          line.setAttribute("stroke-dasharray", "0.01 0.005");
          line.style.pointerEvents = "none";
          svg.appendChild(line);
          // Only rebuild tools panel when both points placed (to show distance input)
          renderTools();
        }
      }
      return;
    }
    if(ctx.state.maps._mode!=="rooms" && ctx.state.maps._mode!=="barriers") return;
    // ignore marker clicks (they stopPropagation already, but defensive)
    if(ev.target && ev.target.classList && ev.target.classList.contains("marker")) return;
    if(ctx.state.maps._mode==="rooms"){
      if(!ctx.state.maps._drawing){
        if(!ctx.state.maps._selectedRoom) return;
        ctx.state.maps._drawing = { room: ctx.state.maps._selectedRoom, points: [] };
      }
    } else if(ctx.state.maps._mode==="barriers"){
      if(!ctx.state.maps._drawing){
        ctx.state.maps._drawing = { barrier: true, points: [] };
      }
    }
    const rect = overlay.getBoundingClientRect();
    const x = (ev.clientX - rect.left) / rect.width;
    const y = (ev.clientY - rect.top) / rect.height;
    ctx.state.maps._drawing.points.push([clamp01(x), clamp01(y)]);
    renderAll(); renderTools();
  });

  // Initial render
  renderAll();
  refreshList();
  renderTools();

  // ── Trim Image Panel ────────────────────────────────────────────────────
  // Lets user crop the uploaded image in-place. Drag on the preview to select
  // a region; Apply Trim re-renders the cropped area as a new PNG and replaces
  // the map image on the backend. Receiver/room coordinates are remapped by
  // the backend's crop transform to stay aligned with the trimmed image.
  const trimPanel = el("div",{style:"display:none;margin-top:10px"});
  const trimStatus = el("div",{class:"mono",style:"font-size:12px;margin-top:6px"}, "\u2014");

  let _trimCrop = null;
  let _trimImgW = 0, _trimImgH = 0, _trimDrag = false;
  let _tdx0=0,_tdy0=0,_tdx1=0,_tdy1=0;

  const trimWrap   = el("div",{style:"position:relative;display:inline-block;max-width:100%;border:1px solid #253e2e;border-radius:6px;overflow:hidden"});
  const trimImg    = document.createElement("img");
  trimImg.style.cssText = "display:block;max-width:100%;max-height:320px";
  const trimCanvas = document.createElement("canvas");
  trimCanvas.style.cssText = "position:absolute;top:0;left:0;width:100%;height:100%;cursor:crosshair";
  const trimInfo   = el("div",{class:"muted",style:"font-size:11px;margin-top:5px"}, "");
  const trimClearBtn = el("button",{class:"btn tiny",style:"margin-top:6px"}, "Reset Selection");

  function _tcFrac(cx,cy){ const r=trimCanvas.getBoundingClientRect(); return [Math.max(0,Math.min(1,(cx-r.left)/r.width)),Math.max(0,Math.min(1,(cy-r.top)/r.height))]; }
  function _drawTrimOverlay(){
    const cw=trimCanvas.width, ch=trimCanvas.height;
    if(!cw||!ch) return;
    const g2=trimCanvas.getContext("2d");
    g2.clearRect(0,0,cw,ch);
    if(_trimCrop){
      const {fx0,fy0,fx1,fy1}=_trimCrop;
      const px0=fx0*cw, py0=fy0*ch, pw=(fx1-fx0)*cw, ph=(fy1-fy0)*ch;
      g2.fillStyle="rgba(0,0,0,0.52)"; g2.fillRect(0,0,cw,ch);
      g2.clearRect(px0,py0,pw,ph);
      g2.strokeStyle="#52b788"; g2.lineWidth=Math.max(1,cw/400); g2.strokeRect(px0,py0,pw,ph);
      const hs=Math.max(4,cw/100); g2.fillStyle="#52b788";
      for(const [hx,hy] of [[px0,py0],[px0+pw,py0],[px0,py0+ph],[px0+pw,py0+ph]])
        g2.fillRect(hx-hs/2,hy-hs/2,hs,hs);
      trimInfo.textContent=`Keep: ${Math.round(_trimImgW*(fx1-fx0))}\u00d7${Math.round(_trimImgH*(fy1-fy0))} px  (original: ${_trimImgW}\u00d7${_trimImgH}) \u2014 drag to adjust`;
    } else {
      trimInfo.textContent=`Full image: ${_trimImgW}\u00d7${_trimImgH} px \u2014 drag to select region to keep`;
    }
  }
  function _updateTrimCrop(){
    const fx0=Math.min(_tdx0,_tdx1), fy0=Math.min(_tdy0,_tdy1);
    const fx1=Math.max(_tdx0,_tdx1), fy1=Math.max(_tdy0,_tdy1);
    _trimCrop=(fx1-fx0>0.015&&fy1-fy0>0.015)?{fx0,fy0,fx1,fy1}:null;
    _drawTrimOverlay();
  }
  trimCanvas.addEventListener("mousedown",  e=>{ _trimDrag=true;  [_tdx0,_tdy0]=_tcFrac(e.clientX,e.clientY); _tdx1=_tdx0;_tdy1=_tdy0; e.preventDefault(); });
  trimCanvas.addEventListener("mousemove",  e=>{ if(!_trimDrag)return; [_tdx1,_tdy1]=_tcFrac(e.clientX,e.clientY); _updateTrimCrop(); });
  trimCanvas.addEventListener("mouseup",    ()=>{ _trimDrag=false; });
  trimCanvas.addEventListener("mouseleave", ()=>{ _trimDrag=false; });
  trimCanvas.addEventListener("touchstart", e=>{ const t=e.touches[0]; _trimDrag=true; [_tdx0,_tdy0]=_tcFrac(t.clientX,t.clientY); _tdx1=_tdx0;_tdy1=_tdy0; e.preventDefault(); },{passive:false});
  trimCanvas.addEventListener("touchmove",  e=>{ if(!_trimDrag)return; const t=e.touches[0]; [_tdx1,_tdy1]=_tcFrac(t.clientX,t.clientY); _updateTrimCrop(); e.preventDefault(); },{passive:false});
  trimCanvas.addEventListener("touchend",   ()=>{ _trimDrag=false; });
  trimClearBtn.addEventListener("click", ()=>{ _trimCrop=null; _drawTrimOverlay(); });

  // Use trimImg itself to size the canvas — avoids a second image load and the
  // CORS-cache split that happened when a separate tmpImg loaded the same URL.
  trimImg.crossOrigin = "anonymous";
  trimImg.onload = ()=>{
    _trimImgW = trimImg.naturalWidth; _trimImgH = trimImg.naturalHeight;
    const cs = Math.min(1, 1600/Math.max(_trimImgW,_trimImgH));
    trimCanvas.width  = Math.round(_trimImgW*cs);
    trimCanvas.height = Math.round(_trimImgH*cs);
    _trimCrop = null; _drawTrimOverlay();
  };
  // If already cached and decoded, fire onload manually
  if(trimImg.complete && trimImg.naturalWidth) trimImg.onload();
  trimImg.src = url || "";
  trimWrap.appendChild(trimImg);
  trimWrap.appendChild(trimCanvas);

  const trimApplyBtn = el("button",{class:"btn inline", onclick: async ()=>{
    if(!_trimCrop){ trimStatus.textContent="Drag on the image to select the region to keep first."; return; }
    trimStatus.textContent="Processing\u2026";
    try{
      const res = await _preparePngFromUrl(url, 1600, _trimCrop);
      trimStatus.textContent=`Uploading\u2026 (${res.width}\u00d7${res.height})`;
      await ctx.actions.mapsReplaceImage({
        map_id: map.id,
        width: res.width,
        height: res.height,
        png_base64: res.pngBase64,
        crop: _trimCrop,
      });
      // Reset draft state so edit reloads from fresh map data
      ctx.state.maps._draftMapId = null;
      trimStatus.textContent="Trim applied \u2714";
      trimPanel.style.display="none";
      ctx.actions.renderRooms();
    }catch(e){
      trimStatus.textContent="Failed: "+String(e);
    }
  }}, "Apply Trim");

  const trimCancelBtn = el("button",{class:"btn inline", onclick:()=>{ trimPanel.style.display="none"; }}, "Cancel");

  trimPanel.appendChild(el("div",{class:"muted",style:"font-size:12px;margin-bottom:6px"},"Drag to select the region to keep, then click Apply Trim:"));
  trimPanel.appendChild(trimWrap);
  trimPanel.appendChild(trimClearBtn);
  trimPanel.appendChild(trimInfo);
  trimPanel.appendChild(el("div",{style:"display:flex;gap:8px;flex-wrap:wrap;margin-top:8px"},[trimApplyBtn, trimCancelBtn]));
  trimPanel.appendChild(trimStatus);

  // "Trim" toggle button in the title bar
  const trimToggleBtn = el("button",{class:"btn inline", onclick:()=>{
    trimPanel.style.display = trimPanel.style.display==="none" ? "" : "none";
    trimStatus.textContent="\u2014";
  }}, "Trim Image");

  // Insert Trim button into the existing title row buttons (direct reference — no fragile querySelector)
  titleBtns.insertBefore(trimToggleBtn, titleBtns.firstChild);

  // ── Rotate Image Panel ─────────────────────────────────────────────────
  // Bakes rotation directly into the image file (not a CSS transform) so all
  // downstream code sees a pre-rotated image. Disabled once the map has
  // tie-ins — rotating a map somebody has recorded constraints against would
  // invalidate them.
  // Receiver and room-boundary coordinates are remapped through the same
  // rotation matrix so they stay aligned with the rotated image.
  const _stk = map.stack || {};
  const _hasStackTieIns = Array.isArray(_stk.tie_ins) && _stk.tie_ins.length > 0;
  const _canRotate = !_hasStackTieIns;

  const rotatePanel = el("div",{style:"display:none;margin-top:10px"});
  if(_canRotate && url){
    let _rotAngle = 0;
    const rotStatus = el("div",{class:"mono",style:"font-size:12px;margin-top:6px"}, "0°");

    const rotWrap = el("div",{style:"position:relative;display:inline-block;max-width:100%;border:1px solid #253e2e;border-radius:6px;overflow:visible;background:#0a150e;padding:20px"});
    const rotImg = document.createElement("img");
    rotImg.src = url;
    rotImg.style.cssText = "display:block;max-width:100%;max-height:320px;transition:transform 0.3s ease";
    rotWrap.appendChild(rotImg);

    const _updatePreview = () => {
      rotImg.style.transform = `rotate(${_rotAngle}deg)`;
      rotStatus.textContent = `${_rotAngle}°`;
    };

    const rotBtns = el("div",{style:"display:flex;gap:6px;flex-wrap:wrap;margin-top:8px;align-items:center"});
    for(const [label, delta] of [["-90°",-90],["-15°",-15],["-5°",-5],["+5°",5],["+15°",15],["+90°",90]]){
      const b = el("button",{class:"btn tiny"}, label);
      b.addEventListener("click", ()=>{ _rotAngle = ((_rotAngle + delta) % 360 + 360) % 360; _updatePreview(); });
      rotBtns.appendChild(b);
    }
    const resetBtn = el("button",{class:"btn tiny"}, "0°");
    resetBtn.addEventListener("click", ()=>{ _rotAngle = 0; _updatePreview(); });
    rotBtns.appendChild(resetBtn);

    const applyStatus = el("div",{class:"mono",style:"font-size:12px;margin-top:6px"});
    const applyBtn = el("button",{class:"btn inline",style:"margin-top:8px"}, "Apply Rotation");
    applyBtn.addEventListener("click", async ()=>{
      if(_rotAngle === 0){ applyStatus.textContent = "No rotation to apply."; return; }
      applyBtn.disabled = true;
      applyStatus.textContent = "Rotating image…";
      try {
        const img = await _loadImage(url);
        const sw = img.naturalWidth || img.width;
        const sh = img.naturalHeight || img.height;
        const rad = _rotAngle * Math.PI / 180;
        const absCos = Math.abs(Math.cos(rad));
        const absSin = Math.abs(Math.sin(rad));
        const nw = Math.round(sw * absCos + sh * absSin);
        const nh = Math.round(sw * absSin + sh * absCos);
        const canvas = document.createElement("canvas");
        canvas.width = nw; canvas.height = nh;
        const g = canvas.getContext("2d");
        g.imageSmoothingEnabled = true;
        g.translate(nw/2, nh/2);
        g.rotate(rad);
        g.drawImage(img, -sw/2, -sh/2);
        const blob = await new Promise(r => canvas.toBlob(r, "image/png", 0.92));
        const ab = await blob.arrayBuffer();
        const b64 = _arrayBufferToBase64(ab);

        applyStatus.textContent = "Uploading rotated image…";

        // Remap receiver and room bound coordinates through the same rotation
        const _rotPoint = (px, py) => {
          // px, py are 0-1 fractions in the old image
          const ox = px * sw - sw/2;
          const oy = py * sh - sh/2;
          const rx = ox * Math.cos(rad) - oy * Math.sin(rad);
          const ry = ox * Math.sin(rad) + oy * Math.cos(rad);
          return [Math.max(0, Math.min(1, (rx + nw/2) / nw)),
                  Math.max(0, Math.min(1, (ry + nh/2) / nh))];
        };

        // Rotate receivers
        const newReceivers = (map.receivers || []).map(r => {
          const [nx, ny] = _rotPoint(r.x || 0, r.y || 0);
          return { ...r, x: nx, y: ny };
        });
        // Rotate beacons
        const newBeacons = (map.beacons || []).map(b => {
          const [nx, ny] = _rotPoint(b.x || 0, b.y || 0);
          return { ...b, x: nx, y: ny };
        });
        // Rotate room bounds
        const newBounds = {};
        for(const [room, b] of Object.entries(map.room_bounds || {})){
          if(b && b.type === "poly" && Array.isArray(b.points)){
            newBounds[room] = { ...b, points: b.points.map(p => { const [nx,ny] = _rotPoint(p[0],p[1]); return [nx,ny]; }) };
          } else if(b && b.type === "circle"){
            const [cx2,cy2] = _rotPoint(b.cx||0.5, b.cy||0.5);
            newBounds[room] = { ...b, cx: cx2, cy: cy2 };
          } else {
            newBounds[room] = b;
          }
        }

        const _repRes = await ctx.actions.mapsReplaceImage({
          map_id: map.id, png_base64: b64, width: nw, height: nh,
          pixel_op: { deg: _rotAngle, sx: 1, sy: 1 },
        });
        if(_repRes && _repRes.scale_invalidated){
          ctx.toast("Map scale could not survive this rotation — re-measure the map (Measure tool).", true);
        }
        // Save rotated coordinates
        if(newReceivers.length || Object.keys(newBounds).length || newBeacons.length){
        }
        applyStatus.style.color = "#4ade80";
        applyStatus.textContent = `Rotated ${_rotAngle}° and saved. Reloading edit…`;
        _rotAngle = 0;
        // Short delay so the user sees the success message, then refresh
        await new Promise(r => setTimeout(r, 1200));
        await ctx.actions.mapsRefresh();
      } catch(e){
        applyStatus.style.color = "#f87171";
        applyStatus.textContent = "Failed: " + (e.message || e);
      }
      applyBtn.disabled = false;
    });

    const rotCancelBtn = el("button",{class:"btn inline", onclick:()=>{ rotatePanel.style.display="none"; _rotAngle=0; _updatePreview(); }}, "Cancel");

    rotatePanel.appendChild(el("div",{class:"muted",style:"font-size:12px;margin-bottom:6px"},"Preview rotation, then click Apply to bake it into the image:"));
    if((map.receivers||[]).length || Object.keys(map.room_bounds||{}).length){
      rotatePanel.appendChild(el("div",{style:"font-size:11px;color:#fbbf24;margin-bottom:6px"},"Receivers and room boundaries will be remapped to match the rotated image."));
    }
    rotatePanel.appendChild(rotWrap);
    rotatePanel.appendChild(rotBtns);
    rotatePanel.appendChild(rotStatus);
    rotatePanel.appendChild(el("div",{style:"display:flex;gap:8px;flex-wrap:wrap;margin-top:8px"},[applyBtn, rotCancelBtn]));
    rotatePanel.appendChild(applyStatus);

    const rotateToggleBtn = el("button",{class:"btn inline", onclick:()=>{
      rotatePanel.style.display = rotatePanel.style.display==="none" ? "" : "none";
    }}, "Rotate Image");
    titleBtns.insertBefore(rotateToggleBtn, titleBtns.firstChild);
  }

  card.appendChild(title);
  card.appendChild(rotatePanel);
  card.appendChild(trimPanel);
  card.appendChild(stage);
  card.appendChild(info);
  card.appendChild(right);
  card.appendChild(list);

  return card;
}

// ── Edit Tab Helpers ─────────────────────────────────────────────────────────

function _slug(s){
  return String(s||"").trim().toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/-+/g,"-").replace(/^-|-$/g,"") || "floor";
}

function _floorSelect(floors, value, onChange){
  const sel = document.createElement("select");
  sel.className = "select";
  for(const f of floors){
    const o = document.createElement("option");
    o.value = f.id; o.textContent = f.name || f.id;
    sel.appendChild(o);
  }
  // Always offer "Outside" as a floor option
  const oOut = document.createElement("option");
  oOut.value = OUTSIDE_FLOOR_ID; oOut.textContent = "Outside (Experimental)";
  sel.appendChild(oOut);
  sel.value = value || (floors[0] && floors[0].id) || "main";
  sel.addEventListener("change", ()=>onChange(sel.value));
  return sel;
}

// Group receivers by their assigned room name → {room: [receivers]}.
// Used to generate auto-circle fallbacks for rooms without drawn polygons.
function _roomToReceivers(receivers){
  const out = {};
  for(const r of (receivers||[])){
    const room = (r.room||"").trim();
    if(!room) continue;
    out[room] = out[room] || [];
    out[room].push(r);
  }
  return out;
}

// Auto-circle fallback: if a room has assigned receivers but no drawn polygon,
// show a dashed circle centered on the average receiver position.
function _autoRoomCircle(rxs){
  if(!rxs || !rxs.length) return null;
  let cx=0, cy=0;
  for(const r of rxs){ cx += (r.x||0); cy += (r.y||0); }
  cx /= rxs.length; cy /= rxs.length;
  return {cx: clamp01(cx), cy: clamp01(cy), r: 0.12};
}

function _centroid(points){
  // Simple average (good enough for UI label)
  if(!points || !points.length) return [0.5,0.5];
  let x=0,y=0;
  for(const p of points){ x+=p[0]; y+=p[1]; }
  return [clamp01(x/points.length), clamp01(y/points.length)];
}

// Library thumbnail: composites the map image + room bounds SVG + optional
// coverage-gap recommendation polygon into a fixed-width preview.
function _libraryThumb(m, ctx, reco){
  const iw = m.image?.width  || 800;
  const ih = m.image?.height || 600;
  const ar = ih / iw;
  const TW = 96;
  const TH = Math.max(48, Math.round(TW * ar));

  const wrap = document.createElement("div");
  wrap.style.cssText = `position:relative;width:${TW}px;height:${TH}px;flex-shrink:0;`
    + `border-radius:6px;overflow:hidden;border:1px solid #1b3526;background:#071008`;

  if(m.image?.filename){
    const img = document.createElement("img");
    img.src = ctx.helpers.mapImageUrl(m);
    img.style.cssText = "position:absolute;top:0;left:0;width:100%;height:100%;object-fit:fill";
    wrap.appendChild(img);
  }

  // SVG overlay: the FABRIC's rooms and scanners on this map's floor,
  // projected onto the picture through its metre transform — so the
  // thumbnail shows the building as it is, not as it was traced. A map with
  // no transform falls back to what was traced on it (the only thing it
  // has), and the recommendation polygon is drawn in either case.
  const roomColor = ctx.helpers.roomColor;
  const tf = (ctx.state.model?.map_transforms || {})[m.id] || null;
  const fid = String(m.floor_id || (m.stack && m.stack.floor_id) || "main");
  let s = `<svg viewBox="0 0 1 1" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg" style="position:absolute;top:0;left:0;width:100%;height:100%">`;
  if (tf) {
    for (const [room, g] of Object.entries(ctx.state.model?.room_geometry_m || {})) {
      if (!g || String(g.floor_id || "main") !== fid || g.type !== "poly" || !Array.isArray(g.points_m)) continue;
      const pts = g.points_m.map(p => metresToMapFrac(tf, Number(p[0]), Number(p[1]))).filter(Boolean);
      if (pts.length < 3) continue;
      const c = roomColor ? roomColor(room) : "#52b788";
      s += `<polygon points="${pts.map(p=>`${p[0]},${p[1]}`).join(" ")}" fill="${c}22" stroke="${c}" stroke-width="0.005"/>`;
    }
    for (const p of Object.values(ctx.state.model?.scanner_positions_m || {})) {
      if (!p || String(p.floor_id || "main") !== fid || typeof p.x_m !== "number") continue;
      const q = metresToMapFrac(tf, p.x_m, p.y_m);
      if (q) s += `<circle cx="${q[0]}" cy="${q[1]}" r="0.022" fill="#52b788" opacity="0.9"/>`;
    }
  } else {
    for(const [room, b] of Object.entries(m.room_bounds || {})){
      if(!b || b.type!=="poly" || !b.points?.length) continue;
      const pts = b.points.map(p=>`${p[0]},${p[1]}`).join(" ");
      const c = roomColor ? roomColor(room) : "#52b788";
      s += `<polygon points="${pts}" fill="${c}22" stroke="${c}" stroke-width="0.005"/>`;
    }
    for(const rx of (m.receivers||[])){
      s += `<circle cx="${rx.x||0}" cy="${rx.y||0}" r="0.022" fill="#52b788" opacity="0.9"/>`;
    }
  }
  if(reco && Array.isArray(reco.polygon) && reco.polygon.length >= 3){
    const pts = reco.polygon.map(p=>`${p[0]},${p[1]}`).join(" ");
    s += `<polygon points="${pts}" fill="rgba(251,191,36,0.25)" stroke="#fbbf24" stroke-width="0.007" stroke-dasharray="0.018 0.01"/>`;
    const rcx = reco.polygon.reduce((t,p)=>t+p[0],0)/reco.polygon.length;
    const rcy = reco.polygon.reduce((t,p)=>t+p[1],0)/reco.polygon.length;
    // Dot at centroid of recommended zone
    s += `<circle cx="${rcx}" cy="${rcy}" r="0.025" fill="#fbbf24" opacity="0.85"/>`;
    s += `<line x1="${rcx}" y1="${rcy-0.04}" x2="${rcx}" y2="${rcy-0.01}" stroke="#fbbf24" stroke-width="0.012" stroke-linecap="round" opacity="0.85"/>`;
  }
  s += `</svg>`;

  const svgDiv = document.createElement("div");
  svgDiv.innerHTML = s;
  wrap.appendChild(svgDiv.firstChild);

  return wrap;
}

function _layoutText(receivers, roomBounds){
  const lines = [];
  lines.push("Receivers:");
  for(const r of (receivers||[])){
    lines.push(`- ${r.id}  ${String(r.label||"").padEnd(16)}  room=${r.room||"-"}  x=${(r.x||0).toFixed(3)} y=${(r.y||0).toFixed(3)}`);
  }
  lines.push("");
  lines.push("Room bounds:");
  for(const [room,b] of Object.entries(roomBounds||{})){
    if(!b) continue;
    if(b.type==="poly" && Array.isArray(b.points)){
      lines.push(`- ${room}: poly (${b.points.length} pts)`);
    } else if(b.type==="circle"){
      lines.push(`- ${room}: circle`);
    } else {
      lines.push(`- ${room}: (unknown)`);
    }
  }
  return lines.join("\n");
}


// Makes a receiver marker node draggable within its container. Updates the
// receiver's (x,y) coordinates in normalized 0–1 space as the user drags.
// onDragState callback sets ctx.state.maps._editDragging to suppress re-renders.
function _makeDraggable(node, receiver, container, onMoved=null, isEnabled=null, onDragState=null){
  let dragging = false;
  let rect = null;

  const onDown = (ev)=>{
    if(isEnabled && !isEnabled()) return;
    dragging = true;
    if(onDragState) onDragState(true);
    rect = container.getBoundingClientRect();
    ev.preventDefault();
  };
  const onMove = (ev)=>{
    if(!dragging || !rect) return;
    const clientX = ev.touches ? ev.touches[0].clientX : ev.clientX;
    const clientY = ev.touches ? ev.touches[0].clientY : ev.clientY;
    const x = (clientX - rect.left)/rect.width;
    const y = (clientY - rect.top)/rect.height;
    receiver.x = clamp01(x);
    receiver.y = clamp01(y);
    node.style.left = `${Math.round(receiver.x*10000)/100}%`;
    node.style.top  = `${Math.round(receiver.y*10000)/100}%`;
    if(onMoved) onMoved();
  };
  const onUp = ()=>{
    if(!dragging) return;
    dragging = false;
    if(onDragState) onDragState(false);
    rect = null;
    if(onMoved) onMoved();
  };

  node.addEventListener("mousedown", onDown);
  window.addEventListener("mousemove", onMove);
  window.addEventListener("mouseup", onUp);

  node.addEventListener("touchstart", onDown, {passive:false});
  window.addEventListener("touchmove", onMove, {passive:false});
  window.addEventListener("touchend", onUp);
}

// Format receiver list as a numbered text summary (for debug display).
function _receiversText(receivers){
  if(!receivers || !receivers.length) return "No receivers placed yet.";
  return receivers.map((r,i)=>`${i+1}. ${r.label||r.id} @ (${(r.x||0).toFixed(3)}, ${(r.y||0).toFixed(3)})`).join("\n");
}

// Clamp a value to [0, 1] — all map coordinates are stored normalized.
function clamp01(x){
  if(!isFinite(x)) return 0;
  return Math.max(0, Math.min(1, x));
}

// ─── Scanner Placement Recommender ───────────────────────────────────────────
// Analyses coverage gaps by scoring each room based on: distance from nearest
// receiver (primary driver), live traffic volume, and signal strength. Rooms
// scoring above a threshold are merged into a convex-hull "recommended zone"
// polygon, which is displayed as a yellow overlay on the map.

// Andrew's monotone chain convex hull — O(n log n).
function _convexHull(pts){
  if(pts.length < 3) return pts.slice();
  const s = pts.slice().sort((a,b)=> a[0]!==b[0] ? a[0]-b[0] : a[1]-b[1]);
  const cross = (O,A,B)=>(A[0]-O[0])*(B[1]-O[1])-(A[1]-O[1])*(B[0]-O[0]);
  const lo = [], hi = [];
  for(const p of s){
    while(lo.length>=2 && cross(lo[lo.length-2],lo[lo.length-1],p)<=0) lo.pop();
    lo.push(p);
  }
  for(let i=s.length-1;i>=0;i--){
    const p=s[i];
    while(hi.length>=2 && cross(hi[hi.length-2],hi[hi.length-1],p)<=0) hi.pop();
    hi.push(p);
  }
  lo.pop(); hi.pop();
  return lo.concat(hi);
}

// Inflate a convex hull outward from its centroid by `dist` (in 0–1 space).
// Gives the recommendation zone some padding for placement flexibility.
function _inflatePolygon(pts, dist){
  if(!pts.length) return pts;
  const cx = pts.reduce((s,p)=>s+p[0],0)/pts.length;
  const cy = pts.reduce((s,p)=>s+p[1],0)/pts.length;
  return pts.map(([x,y])=>{
    const dx=x-cx, dy=y-cy;
    const d=Math.sqrt(dx*dx+dy*dy)||1e-6;
    return [
      Math.max(0.01, Math.min(0.99, x + dx/d * dist)),
      Math.max(0.01, Math.min(0.99, y + dy/d * dist)),
    ];
  });
}

// Returns { polygon, rooms, topScore } or null if no meaningful gap found.
function _recommendPlacement(receivers, roomBounds, snap){
  const objects = snap?.objects ? Object.values(snap.objects) : [];

  // Only rooms with drawn polygons on this map
  const rooms = Object.entries(roomBounds)
    .filter(([,b])=> b && b.type==="poly" && Array.isArray(b.points) && b.points.length >= 3)
    .map(([room, b])=>({ room, points: b.points, centroid: _centroid(b.points) }));
  if(!rooms.length) return null;

  // Traffic and best RSSI per room from the live snapshot
  const trafficByRoom = {}, rssiByRoom = {};
  for(const obj of objects){
    const r = obj.room || ""; if(!r) continue;
    trafficByRoom[r] = (trafficByRoom[r]||0) + 1;
    const v = obj.rssi != null ? Number(obj.rssi) : null;
    if(v != null && (rssiByRoom[r] == null || v > rssiByRoom[r])) rssiByRoom[r] = v;
  }

  // Score each room: far from receivers = high need; traffic + weak signal add weight
  const scored = rooms.map(({room, points, centroid})=>{
    let minDist = receivers.length ? 2.0 : 1.0;
    for(const rx of receivers){
      const d = Math.hypot((rx.x||0)-centroid[0], (rx.y||0)-centroid[1]);
      if(d < minDist) minDist = d;
    }
    let score = Math.min(1.0, minDist * 2.0);      // geometric gap (primary driver)
    if((trafficByRoom[room]||0) > 0) score += 0.35; // live traffic bonus
    const rssi = rssiByRoom[room] ?? -100;
    if(rssi < -80) score += 0.15;                   // weak signal
    if(rssi < -88) score += 0.15;                   // very weak signal
    return {room, points, centroid, score, minDist};
  });

  scored.sort((a,b)=>b.score-a.score);
  const maxScore = scored[0]?.score ?? 0;
  if(maxScore < 0.3) return null; // everything looks well-covered

  // Include rooms scoring ≥55% of max — builds a generous candidate zone
  const threshold = maxScore * 0.55;
  const candidates = scored.filter(r=>r.score >= threshold);

  // Convex hull of all candidate room vertices, then inflate for placement flexibility
  const allPts = [];
  for(const c of candidates) allPts.push(...c.points);
  if(allPts.length < 3) return null;
  const hull = _convexHull(allPts);
  if(hull.length < 3) return null;
  const polygon = _inflatePolygon(hull, 0.13); // expand ~13% of map width outward

  return { polygon, rooms: candidates.map(c=>c.room), topScore: maxScore };
}

// ── Alignment Conflict & Tie-in Helpers ──────────────────────────────────────
//
// A tie-in is a saved alignment constraint: "when I last checked this map
// against that one, it sat HERE". It stores a PLACEMENT, in metres, and it is
// compared against a candidate placement in metres.
//
// It used to store four stack fields — x_offset, y_offset, scale, rotation —
// and compare them by a weighted blend of "% offset", "% scale difference" and
// "degrees of rotation", each of which is a different unit and none of which
// is a distance. That blend could not see a mirror or a lean at all (neither
// is in any of the four), and the offset term was a fraction of the master
// picture, so "20%" meant different distances on different houses. Every
// tie-in was migrated to metres by `migrations._tie_ins_to_metres`.
//
// The disagreement is now the one this codebase defines everywhere else: the
// greatest distance, over the map's four picture corners, between where two
// placements put it. Same question, same units, one answer.

// The tolerances, in metres, mirroring fabric_truth.PLACEMENT_AGREE_TOL_M.
// A tie-in is a hand-recorded constraint, so the bar for "you have moved this
// map since you tied it" is deliberately looser than the bar for a fault.
const TIE_NOTICE_M = 0.30;   // worth mentioning
const TIE_MINOR_M  = 1.00;   // small enough to average silently
const TIE_MAJOR_M  = 3.00;   // an outright conflict

// How far apart two placements put the same map, in metres — the JS mirror of
// fabric_truth.placement_disagreement_m. Every degree of freedom is in it
// because every one of them moves a corner.
function _placementGapM(a, b) {
  if (!a || !b) return null;
  let worst = 0;
  for (const [fx, fy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
    const p = mapFracToMetres(a, fx, fy), q = mapFracToMetres(b, fx, fy);
    if (!p || !q) return null;
    worst = Math.max(worst, Math.hypot(p[0] - q[0], p[1] - q[1]));
  }
  return Number.isFinite(worst) ? worst : null;
}

// Conflicts between a candidate placement and this map's stored tie-ins.
function _checkAlignConflicts(place, tgtMap, allMaps) {
  const tieIns = (tgtMap?.stack?.tie_ins) || [];
  if (!tieIns.length) return [];
  const conflicts = [];
  for (const ti of tieIns) {
    const refMap = allMaps.find(m => m.id === ti.ref_map_id);
    const refName = refMap ? (refMap.name || refMap.id) : (ti.ref_map_id || "Unknown");
    const gap = _placementGapM(place, ti);
    if (gap === null || gap < TIE_NOTICE_M) continue;
    conflicts.push({ ti, refName, gapM: Math.round(gap * 100) / 100 });
  }
  return conflicts;
}

// The average of a candidate placement and every tie-in, for the minor case.
// Averaged as PLACEMENTS — the origin and the two metre axes — not as the old
// four fields, so a mirrored or leaning tie-in averages the way it is drawn
// rather than being silently straightened.
function _averageAlignWithTieIns(place, tieIns) {
  const all = [place, ...tieIns];
  const acc = [[0, 0], [0, 0], [0, 0]];   // origin, x axis, y axis
  for (const p of all) {
    const o = mapFracToMetres(p, 0, 0);
    const x = mapFracToMetres(p, 1, 0);
    const y = mapFracToMetres(p, 0, 1);
    if (!o || !x || !y) return null;
    acc[0][0] += o[0]; acc[0][1] += o[1];
    acc[1][0] += x[0] - o[0]; acc[1][1] += x[1] - o[1];
    acc[2][0] += y[0] - o[0]; acc[2][1] += y[1] - o[1];
  }
  const n = all.length;
  return placementFromColumns(
    [acc[0][0] / n, acc[0][1] / n],
    [acc[1][0] / n, acc[1][1] / n],
    [acc[2][0] / n, acc[2][1] / n]);
}

// A stack payload for a write that is not about placement.
//
// The stack holds no placement at all now — z_level, ceiling_height_m,
// ref_map_id and tie_ins — so this is a plain merge. It kept its name and its
// call sites because the RULE it enforced still holds and is now enforced by
// the store: a field a payload does not STATE is unchanged.
function _stackPatch(stk, fields) {
  return Object.assign({}, stk || {}, fields);
}

// ── Emergency Tie-in Recovery ─────────────────────────────────────────────────
// Scans all maps for inconsistent tie-ins and produces a recovery plan.
// Uses consensus clustering: each tie-in "votes" for a position, and outliers
// (those that agree with fewer than half the max-agreement cluster) are removed.
// The saved primary alignment is treated as an implicit vote.
// Returns array of { map, keptTieIns, removedTieIns, reason }.
function _emergencyRecoverTieIns(allMaps, model) {
  const plans = [];
  const txs = (model && model.map_transforms) || {};

  for(const m of allMaps){
    const tieIns = (m.stack?.tie_ins) || [];
    if(!tieIns.length) continue;

    // The map's own saved placement is an implicit vote — it is where the
    // owner last committed the map to, and it is now the same kind of object
    // as a tie-in rather than a different set of fields.
    const primary = txs[m.id];
    const pv = (primary && Number(primary.scale_x_m) > 0) ? primary : null;

    if(tieIns.length === 1){
      if(!pv) continue;
      const gap = _placementGapM(tieIns[0], pv);
      if(gap !== null && gap > TIE_MAJOR_M){
        plans.push({ map: m, keptTieIns: [], removedTieIns: tieIns,
          reason: `sole tie-in puts this map ${gap.toFixed(1)} m from where it is saved` });
      }
      continue;
    }

    // 2+ tie-ins: consensus clustering on the one distance, in metres.
    const allVotes = [...tieIns, ...(pv ? [pv] : [])];
    const agreeCount = allVotes.map((v, i) => {
      let n = 0;
      for(let j = 0; j < allVotes.length; j++){
        if(i === j) continue;
        const g = _placementGapM(v, allVotes[j]);
        if(g !== null && g <= TIE_MAJOR_M) n++;
      }
      return n;
    });
    const maxAgree = Math.max(...agreeCount);
    const keepMin  = Math.max(1, Math.ceil(maxAgree / 2));
    const removedTieIns = tieIns.filter((_, i) => agreeCount[i] < keepMin);
    const keptTieIns    = tieIns.filter((_, i) => agreeCount[i] >= keepMin);
    if(removedTieIns.length > 0){
      plans.push({ map: m, keptTieIns, removedTieIns,
        reason: `${removedTieIns.length} outlier${removedTieIns.length>1?"s":""} outside consensus cluster` });
    }
  }
  return plans;
}

// ── Export Tab ───────────────────────────────────────────────────────────────
// Five export sections:
//   1. Floor Plan Image — raw PNG download
//   2. Room Drawing SVG — scalable room boundaries + receiver dots
//   3. Combined PNG — floor plan + room overlay composited via canvas
//   4. Full 3D Building — isometric SVG/PNG of all floors
//   5. Map Data Backup — full JSON backup/restore including base64 images
function _export(ctx, active, maps_list){
  const { el } = ctx.helpers;

  if(!maps_list || !maps_list.length){
    const card = el("div",{class:"card"});
    card.appendChild(el("div",{class:"muted",style:"margin-top:10px"},"No maps uploaded yet. Go to Upload tab."));
    return card;
  }

  // Map selector state
  if(!ctx.state.maps._exportMapId || !maps_list.find(m=>m.id===ctx.state.maps._exportMapId))
    ctx.state.maps._exportMapId = maps_list[0].id;
  const exportMap = maps_list.find(m=>m.id===ctx.state.maps._exportMapId) || maps_list[0];

  const card = el("div",{class:"card"});
  card.appendChild(el("div",{style:"font-weight:700;font-size:15px;margin-bottom:10px"},"Export"));

  // Map selector
  const mapSel = document.createElement("select");
  mapSel.className = "select";
  for(const m of maps_list){
    const o = document.createElement("option");
    o.value = m.id; o.textContent = m.name || m.id;
    if(m.id === exportMap.id) o.selected = true;
    mapSel.appendChild(o);
  }
  mapSel.addEventListener("change", () => { ctx.state.maps._exportMapId = mapSel.value; ctx.actions.renderRooms(); });
  card.appendChild(el("div",{style:"display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:12px"},[
    el("div",{class:"muted",style:"font-size:12px"},"Map:"), mapSel,
  ]));

  // ── 1: Floor Plan Image ───────────────────────────────────────────────────
  const sec1 = el("div",{class:"card",style:"margin-top:0"});
  sec1.appendChild(el("div",{style:"font-weight:600;margin-bottom:4px"},"1 · Floor Plan Image"));
  sec1.appendChild(el("div",{class:"muted",style:"font-size:12px;margin-bottom:8px"},"Download the raw floor plan PNG as uploaded."));
  const pngUrl = ctx.helpers.mapImageUrl(exportMap);
  const dlPng = el("a",{class:"btn inline", href:pngUrl||"#", download:(exportMap.name||exportMap.id||"map")+".png"}, "Download PNG");
  if(!pngUrl) dlPng.setAttribute("disabled","disabled");
  const openPng = el("a",{class:"btn inline", href:pngUrl||"#", target:"_blank"}, "Open in new tab");
  if(!pngUrl) openPng.setAttribute("disabled","disabled");
  sec1.appendChild(el("div",{style:"display:flex;gap:8px;flex-wrap:wrap"},[dlPng, openPng]));
  card.appendChild(sec1);

  // ── 2: Room Drawing SVG ───────────────────────────────────────────────────
  const sec2 = el("div",{class:"card",style:"margin-top:10px"});
  sec2.appendChild(el("div",{style:"font-weight:600;margin-bottom:4px"},"2 · Room Drawing (SVG)"));
  sec2.appendChild(el("div",{class:"muted",style:"font-size:12px;margin-bottom:8px"},"Scalable SVG of room boundaries and radio positions."));
  const dlSvgBtn = el("button",{class:"btn inline", onclick:()=>{
    const svgStr = _buildRoomBoundsSVG(exportMap, ctx, false);
    _downloadBlob(new Blob([svgStr], {type:"image/svg+xml"}), (exportMap.name||exportMap.id||"map")+"_rooms.svg");
  }}, "Download SVG");
  sec2.appendChild(dlSvgBtn);
  card.appendChild(sec2);

  // ── 3: Combined PNG ───────────────────────────────────────────────────────
  const sec3 = el("div",{class:"card",style:"margin-top:10px"});
  sec3.appendChild(el("div",{style:"font-weight:600;margin-bottom:4px"},"3 · Combined (Floor Plan + Rooms)"));
  sec3.appendChild(el("div",{class:"muted",style:"font-size:12px;margin-bottom:8px"},"Floor plan image with room overlay rendered to PNG in your browser."));
  const combStatus = el("div",{class:"muted",style:"font-size:12px;min-height:16px"});
  const combBtn = el("button",{class:"btn inline", onclick:async()=>{
    combBtn.disabled = true; combStatus.textContent = "Rendering…";
    try{
      const blob = await _combinedMapPng(exportMap, ctx);
      _downloadBlob(blob, (exportMap.name||exportMap.id||"map")+"_combined.png");
      combStatus.textContent = "Downloaded ✓";
    }catch(e){ combStatus.textContent = "Render failed: "+String(e); }
    combBtn.disabled = false;
  }}, "Render & Download PNG");
  sec3.appendChild(el("div",{style:"display:flex;gap:10px;align-items:center;flex-wrap:wrap"},[combBtn, combStatus]));
  card.appendChild(sec3);

  // ── 4: Full 3D Building ───────────────────────────────────────────────────
  const sec4 = el("div",{class:"card",style:"margin-top:10px"});
  sec4.appendChild(el("div",{style:"font-weight:600;margin-bottom:4px"},"4 · Full 3D Building"));
  sec4.appendChild(el("div",{class:"muted",style:"font-size:12px;margin-bottom:8px"},"Isometric rendering of all floors. Download as scalable SVG or browser-rendered PNG."));
  const haFloors2 = (ctx.state.model && Array.isArray(ctx.state.model.floors)) ? ctx.state.model.floors : [];
  const lvlOpts2 = haFloors2.length > 0
    ? haFloors2.slice().sort((a,b)=>(a.level??999)-(b.level??999)).map((f,i)=>({value:f.level??i,label:f.name||f.id}))
    : _LEVEL_NAMES.map((n,i)=>({value:i,label:n}));
  const isoSvgStr = _stackIsoSVG(maps_list, ctx, lvlOpts2, null, ctx.state.maps._stackFloorGap || 200, ctx.state.maps._stackHorizGap || 0);
  const isoStatus = el("div",{class:"muted",style:"font-size:12px;min-height:16px"});
  const dlIsoSvg = el("button",{class:"btn inline", onclick:()=>{
    _downloadBlob(new Blob([isoSvgStr], {type:"image/svg+xml"}), "building_3d.svg");
  }}, "Download SVG");
  const dlIsoPng = el("button",{class:"btn inline", onclick:async()=>{
    dlIsoPng.disabled = true; isoStatus.textContent = "Rendering PNG…";
    try{
      const _vb = isoSvgStr.match(/viewBox="0 0 (\d+) (\d+)"/);
      const _iw = _vb ? parseInt(_vb[1],10) : 780;
      const _ih = _vb ? parseInt(_vb[2],10) : 520;
      const blob = await _svgStringToPng(isoSvgStr, _iw, _ih);
      _downloadBlob(blob, "building_3d.png");
      isoStatus.textContent = "Downloaded ✓";
    }catch(e){ isoStatus.textContent = "Render failed: "+String(e); }
    dlIsoPng.disabled = false;
  }}, "Render PNG");
  sec4.appendChild(el("div",{style:"display:flex;gap:8px;flex-wrap:wrap;align-items:center"},[dlIsoSvg, dlIsoPng, isoStatus]));
  card.appendChild(sec4);

  // ── 5: Map Data Backup (JSON) ─────────────────────────────────────────────
  const secJ = el("div",{class:"card",style:"margin-top:10px"});
  secJ.appendChild(el("div",{style:"font-weight:600;margin-bottom:4px"},"5 · Map Data Backup (JSON)"));
  secJ.appendChild(el("div",{class:"muted",style:"font-size:12px;margin-bottom:8px"},
    "Export a full backup of ALL maps including floor plan images, their 3D stack alignment and their real-world placement in metres. Use Restore to recover mapping data after reinstall."));

  // ── Backup button
  const backupStatus = el("div",{class:"muted",style:"font-size:12px;min-height:18px"});
  const backupBtn = el("button",{class:"btn inline", onclick:async()=>{
    backupBtn.disabled = true; backupStatus.textContent = "Building backup…";
    try{
      const allMaps = ctx.state.maps.list || [];
      const backupMaps = [];
      for(let i=0;i<allMaps.length;i++){
        const m = allMaps[i];
        backupStatus.textContent = `Fetching ${i+1}/${allMaps.length}: ${m.name||m.id}…`;
        const entry = JSON.parse(JSON.stringify(m));
        // The map's PLACEMENT, in metres. A backup carried the picture,
        // the stack and the calibration and left this behind, so a
        // restore brought back maps that sat nowhere: `map_transforms`
        // lives in the Model store and is keyed by map id, and a restored
        // map gets a NEW id, so the old record could never have found it
        // again even when the Model store was restored beside it.
        //
        // Metres are gauge-free, so this is the copy that survives a
        // restore into a house with a different world gauge — the stack
        // beside it is in world units and does not. Written down now,
        // while a second copy still exists to write down.
        const _tx = (ctx.state.model?.map_transforms || {})[m.id];
        if (_tx) entry.map_transform = JSON.parse(JSON.stringify(_tx));
        if(m.image?.filename){
          try{
            const resp = await fetch(ctx.helpers.mapImageUrl(m));
            if(resp.ok){
              const blob = await resp.blob();
              entry.png_base64 = await new Promise((res,rej)=>{
                const fr = new FileReader();
                fr.onload = ()=>res(fr.result.split(",")[1]);
                fr.onerror = rej; fr.readAsDataURL(blob);
              });
            }
          }catch(e2){ /* skip image if unavailable */ }
        }
        backupMaps.push(entry);
      }
      const dateStr = new Date().toISOString().slice(0,10).replace(/-/g,"");
      const backup = { padspan_backup:"v1", exported_at:new Date().toISOString(), count:backupMaps.length, maps:backupMaps };
      _downloadBlob(new Blob([JSON.stringify(backup,null,2)],{type:"application/json"}), `maps_backup_${dateStr}.json`);
      backupStatus.textContent = `Backup downloaded (${backupMaps.length} map${backupMaps.length!==1?"s":""}) ✓`;
    }catch(e){ backupStatus.textContent = "Backup failed: "+String(e); }
    backupBtn.disabled = false;
  }}, "Backup All Maps (JSON)");
  secJ.appendChild(el("div",{style:"display:flex;gap:10px;align-items:center;flex-wrap:wrap"},[backupBtn, backupStatus]));

  // ── Restore from backup
  secJ.appendChild(el("div",{style:"margin-top:14px;border-top:1px solid #1b3526;padding-top:12px;font-weight:600;font-size:13px"},"Restore from Backup"));
  secJ.appendChild(el("div",{class:"muted",style:"font-size:12px;margin-bottom:8px"},
    "Choose a maps_backup_*.json file. Maps whose names already exist will be skipped to prevent duplicates."));

  const restoreInput = document.createElement("input");
  restoreInput.type = "file"; restoreInput.accept = ".json,application/json"; restoreInput.style.display = "none";
  const restorePreview = el("div",{style:"font-size:12px;color:#94a3b8;min-height:18px;margin-top:6px"});
  const restoreStatus = el("div",{class:"muted",style:"font-size:12px;min-height:18px;margin-top:4px"});
  const restoreBtn = el("button",{class:"btn inline",style:"display:none"},"Restore Maps");
  let _restoreData = null;

  restoreInput.addEventListener("change", async()=>{
    const file = restoreInput.files?.[0]; if(!file) return;
    restorePreview.textContent = "Reading…"; restoreBtn.style.display = "none"; _restoreData = null;
    try{
      const parsed = JSON.parse(await file.text());
      if(!parsed.padspan_backup || !Array.isArray(parsed.maps)){
        restorePreview.textContent = "❌ Not a valid PadSpan backup file."; return;
      }
      const existingNames = new Set((ctx.state.maps.list||[]).map(m=>m.name));
      const toRestore = parsed.maps.filter(m=>!existingNames.has(m.name));
      const skipCount = parsed.maps.length - toRestore.length;
      restorePreview.textContent = `${parsed.maps.length} maps in backup: ${toRestore.length} to restore${skipCount ? `, ${skipCount} already exist (skipped)` : ""}.`;
      if(toRestore.length){ _restoreData = toRestore; restoreBtn.style.display = ""; }
    }catch(e){ restorePreview.textContent = "❌ Parse error: "+String(e); }
  });

  restoreBtn.addEventListener("click", async()=>{
    if(!_restoreData?.length) return;
    if(!confirm(`Restore ${_restoreData.length} map(s) into your system?`)) return;
    restoreBtn.disabled = true; let ok=0, fail=0;
    for(let i=0;i<_restoreData.length;i++){
      const bm = _restoreData[i];
      restoreStatus.textContent = `Restoring ${i+1}/${_restoreData.length}: ${bm.name}…`;
      try{
        const up = await ctx.actions.mapsUpload({
          name: bm.name||"Restored Map",
          filename: bm.image?.filename||"map.png",
          mime: bm.image?.mime||"image/png",
          width: bm.image?.width||800,
          height: bm.image?.height||600,
          png_base64: bm.png_base64||"",
          floor_id: bm.floor_id||"",
        });
        // The upload says which map it created. This used to find it by name
        // — first match wins — so a backup holding two maps of the same name,
        // or two unnamed ones (both of which become "Restored Map"), wrote the
        // second map's stack, calibration and notes onto the first and left
        // the second at a default stack. Same id the Upload tab reads.
        const newId = up?.map?.id;
        if(newId){
          await ctx.actions.mapsUpdateQuiet({
            map_id: newId, calibration: bm.calibration||{},
            notes: bm.notes||"", stack: bm.stack||{},
            // The backup carries the full map dict; the restore used to push
            // only the four fields above, silently dropping the hand-traced
            // room outlines, receiver pins and beacon pins it had faithfully
            // saved. A restore that loses the trace is a restore that makes
            // the user re-draw their house.
            receivers: bm.receivers||[],
            beacons: bm.beacons||[],
            room_bounds: bm.room_bounds||{},
          });
          // ...and where the map SITS, under its new id. Restoring the
          // stack without this leaves the map drawn in the 3D assembly
          // and placed nowhere in metres: every room, scanner and pin on
          // it has no size, and Repair Positioning has nothing to repair
          // it against. A backup written before this release has no
          // `map_transform`, and those restore exactly as they did.
          if(bm.map_transform){
            await ctx.actions.callWS({
              type: "padspan_ha/fabric_map_transform_set",
              map_id: newId, transform: bm.map_transform,
            });
          }
        }
        ok++;
      }catch(e){ fail++; console.error("Restore failed for",bm.name,e); }
    }
    restoreStatus.textContent = `Restored ${ok} map${ok!==1?"s":""}${fail?` (${fail} failed)`:""} ✓`;
    restoreBtn.disabled = false; _restoreData = null; restoreBtn.style.display = "none";
    await ctx.actions.mapsRefresh();
  });

  const chooseBtn = el("button",{class:"btn inline", onclick:()=>restoreInput.click()}, "Choose Backup File…");
  secJ.appendChild(el("div",{style:"display:flex;gap:8px;align-items:center;flex-wrap:wrap"},[chooseBtn, restoreBtn]));
  secJ.appendChild(restoreInput);
  secJ.appendChild(restorePreview);
  secJ.appendChild(restoreStatus);
  card.appendChild(secJ);

  return card;
}

function _help(ctx){
  const { el } = ctx.helpers;
  const card = el("div",{class:"card"});
  card.appendChild(el("div",{style:"font-weight:700"},"How this mapping system works"));
  card.appendChild(el("div",{class:"muted", style:"margin-top:8px;line-height:1.5"},[
    "• Upload any floorplan image; the UI converts it to optimized PNG and stores it under /config/www/padspan_ha/maps/ so HA can serve it at /local/padspan_ha/maps/.",
    el("br"),
    "• Place receivers as normalized coordinates (0–1). This is the common industry approach (web GIS, indoor positioning) because it survives resizing.",
    el("br"),
    "• Next step after this: calibration layers (physical/distortion maps) + per-room fit, then drag-and-drop tag trajectories to validate.",
  ]));
  return card;
}

// ─── Sample Mode Demo Floor Plan ────────────────────────────────────────────
// When in sample/demo mode, the Library tab shows a hardcoded "Smith Residence"
// SVG floor plan with fake rooms, scanners, and objects. This gives new users
// a fully-functional preview of the system without needing any real hardware.

function _sampleDemo(ctx){
  const { el } = ctx.helpers;
  const snap = (ctx.state.live && ctx.state.live.snapshot) || null;
  const fp = (snap && snap.floor_plan) || null;

  const card = el("div",{class:"card"});
  card.appendChild(el("div",{style:"display:flex;align-items:center;gap:10px;margin-bottom:4px"},[
    el("div",{style:"font-weight:700;font-size:16px"}, "Demo Floor Plan — Smith Residence"),
    el("span",{class:"badge"}, "Sample"),
  ]));
  card.appendChild(el("div",{class:"muted",style:"margin-bottom:12px"},
    "This shows a fully-configured system. Switch to Live mode and upload your own floor plan to get started."));

  const svgWrap = el("div",{style:"overflow:auto;border-radius:8px;background:#071008;padding:8px"});
  svgWrap.innerHTML = _buildDemoSVG(fp);
  card.appendChild(svgWrap);

  // Legend
  const legend = el("div",{style:"display:flex;gap:16px;flex-wrap:wrap;margin-top:12px;font-size:12px;color:#94a3b8"});
  [
    ["#52b788", "BLE Scanner"],
    ["#52b788", "HA Entity (phone/tracker)", "circle"],
    ["#5eead4", "Tagged BLE object", "square"],
    ["#f59e0b", "Unidentified BLE", "triangle"],
  ].forEach(([color, label, shape]) => {
    const icon = document.createElement("div");
    icon.style.cssText = `width:12px;height:12px;flex-shrink:0;background:${color};border-radius:${shape==="square"?"2px":shape==="triangle"?"0":"50%"};clip-path:${shape==="triangle"?"polygon(50% 0%,100% 100%,0% 100%)":"none"}`;
    legend.appendChild(el("div",{style:"display:flex;align-items:center;gap:6px"},[icon, el("span",{},label)]));
  });
  card.appendChild(legend);
  return card;
}

function _buildDemoSVG(fp){
  const rooms = (fp && fp.rooms) || [
    { id:"living_room",    name:"Living Room",    x:10,  y:10,  w:370, h:200, color:"#52b788" },
    { id:"kitchen",        name:"Kitchen",        x:390, y:10,  w:400, h:200, color:"#4caf50" },
    { id:"hallway",        name:"Hallway",        x:10,  y:220, w:780, h:40,  color:"#388e3c" },
    { id:"office",         name:"Office",         x:10,  y:270, w:230, h:160, color:"#43a047" },
    { id:"master_bedroom", name:"Master Bedroom", x:250, y:270, w:540, h:160, color:"#66bb6a" },
  ];
  const radios = (fp && fp.radios) || [
    { name:"Living Room Hub", x:185, y:95  },
    { name:"Bedroom Hub",     x:520, y:345 },
    { name:"Kitchen Hub",     x:590, y:95  },
  ];
  const objects = (fp && fp.objects) || [
    { name:"Alice's Phone",  x:140, y:155, type:"entity",       color:"#52b788" },
    { name:"Bob's Phone",    x:360, y:380, type:"entity",       color:"#52b788" },
    { name:"Car Keys",       x:280, y:75,  type:"tagged_ble",   color:"#5eead4" },
    { name:"Wallet",         x:90,  y:175, type:"tagged_ble",   color:"#5eead4" },
    { name:"Backpack",       x:555, y:155, type:"tagged_ble",   color:"#5eead4" },
    { name:"?? Unknown",     x:400, y:370, type:"unidentified", color:"#f59e0b" },
    { name:"?? Unknown",     x:210, y:45,  type:"unidentified", color:"#f59e0b" },
  ];

  let s = `<svg viewBox="0 0 810 460" xmlns="http://www.w3.org/2000/svg" width="100%" style="max-height:520px;display:block;font-family:system-ui,sans-serif">`;

  // Background
  s += `<rect width="810" height="460" fill="#071008"/>`;

  // Room fills
  for(const r of rooms){
    s += `<rect x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}" fill="${r.color}12" stroke="${r.color}" stroke-width="2"/>`;
  }

  // Furniture — Living Room
  s += `<rect x="25" y="148" width="140" height="48" fill="#1a3525" stroke="#2a5038" stroke-width="1" rx="4"/>`; // sofa
  s += `<rect x="25" y="148" width="140" height="13" fill="#1d3d2a" stroke="#2a5038" stroke-width="0.5" rx="2"/>`; // sofa back
  s += `<rect x="60" y="118" width="85" height="32" fill="#111e17" stroke="#1c3225" stroke-width="1" rx="2"/>`; // coffee table
  s += `<rect x="335" y="18" width="32" height="85" fill="#1a3525" stroke="#2a5038" stroke-width="1" rx="2"/>`; // bookshelf

  // Furniture — Kitchen
  s += `<rect x="395" y="14" width="392" height="38" fill="#1a3525" stroke="#2a5038" stroke-width="1"/>`; // counter top
  s += `<rect x="395" y="14" width="38" height="192" fill="#1a3525" stroke="#2a5038" stroke-width="1"/>`; // counter left
  s += `<rect x="488" y="78" width="135" height="70" fill="#1a3525" stroke="#2a5038" stroke-width="1" rx="3"/>`; // island
  s += `<circle cx="555" cy="113" r="22" fill="none" stroke="#2a5038" stroke-width="1.5" stroke-dasharray="3,2"/>`; // cooktop

  // Furniture — Master Bedroom
  s += `<rect x="428" y="293" width="205" height="125" fill="#1a3525" stroke="#2a5038" stroke-width="1" rx="5"/>`; // bed
  s += `<rect x="432" y="297" width="88" height="42" fill="#1c3a28" stroke="#2a5038" stroke-width="0.5" rx="3"/>`; // pillow L
  s += `<rect x="548" y="297" width="81" height="42" fill="#1c3a28" stroke="#2a5038" stroke-width="0.5" rx="3"/>`; // pillow R
  s += `<rect x="397" y="293" width="26" height="26" fill="#111e17" stroke="#1c3225" stroke-width="1" rx="2"/>`; // nightstand L
  s += `<rect x="638" y="293" width="26" height="26" fill="#111e17" stroke="#1c3225" stroke-width="1" rx="2"/>`; // nightstand R
  s += `<rect x="258" y="278" width="78" height="48" fill="#1a3525" stroke="#2a5038" stroke-width="1" rx="2"/>`; // dresser

  // Furniture — Office
  s += `<rect x="14" y="278" width="210" height="32" fill="#1a3525" stroke="#2a5038" stroke-width="1"/>`; // desk top
  s += `<rect x="14" y="278" width="32" height="90" fill="#1a3525" stroke="#2a5038" stroke-width="1"/>`; // desk side
  s += `<rect x="80" y="318" width="36" height="36" fill="#111e17" stroke="#1c3225" stroke-width="1" rx="18"/>`; // chair seat
  s += `<rect x="88" y="350" width="20" height="12" fill="#1a3525" stroke="#2a5038" stroke-width="1" rx="2"/>`; // chair base

  // Room labels
  for(const r of rooms){
    const cx = r.x + r.w/2;
    const cy = r.y + (r.id === "hallway" ? 28 : 24);
    s += `<text x="${cx}" y="${cy}" text-anchor="middle" fill="${r.color}" font-size="${r.id==="hallway"?"11":"13"}" font-weight="600" opacity="0.85">${_escSVG(r.name)}</text>`;
  }

  // Doors (gap + arc swing)
  const doors = [
    {x:110,y:220,w:30,top:false}, // Living Room → Hallway
    {x:470,y:210,w:30,top:false}, // Kitchen → Hallway (side)
    {x:75, y:270,w:30,top:true},  // Office → Hallway
    {x:415,y:270,w:30,top:true},  // Bedroom → Hallway
  ];
  for(const d of doors){
    s += `<rect x="${d.x}" y="${d.y-3}" width="${d.w}" height="7" fill="#071008"/>`; // gap
    const sweep = d.top ? 0 : 1;
    s += `<path d="M${d.x},${d.y} a${d.w},${d.w} 0 0,${sweep} ${d.w},0" fill="none" stroke="#52b78855" stroke-width="1.5" stroke-dasharray="4,2"/>`;
    s += `<line x1="${d.x}" y1="${d.y}" x2="${d.x}" y2="${d.top?d.y-d.w:d.y+d.w}" stroke="#52b78888" stroke-width="1.5" stroke-dasharray="2,2"/>`;
  }

  // Windows on exterior walls
  const wins = [
    {x1:10,y1:45,x2:10,y2:85,v:true},
    {x1:10,y1:115,x2:10,y2:155,v:true},
    {x1:450,y1:10,x2:560,y2:10,v:false},
    {x1:640,y1:10,x2:750,y2:10,v:false},
    {x1:790,y1:60,x2:790,y2:140,v:true},
    {x1:300,y1:430,x2:410,y2:430,v:false},
    {x1:500,y1:430,x2:630,y2:430,v:false},
    {x1:40, y1:430,x2:120,y2:430,v:false},
  ];
  for(const w of wins){
    s += `<line x1="${w.x1}" y1="${w.y1}" x2="${w.x2}" y2="${w.y2}" stroke="#4caf50" stroke-width="4" stroke-linecap="round"/>`;
    const mx=(w.x1+w.x2)/2, my=(w.y1+w.y2)/2;
    if(w.v) s += `<line x1="${mx-3}" y1="${my}" x2="${mx+3}" y2="${my}" stroke="#4caf5088" stroke-width="1.5"/>`;
    else    s += `<line x1="${mx}" y1="${my-3}" x2="${mx}" y2="${my+3}" stroke="#4caf5088" stroke-width="1.5"/>`;
  }

  // Exterior outline (thick walls)
  s += `<rect x="10" y="10" width="780" height="420" fill="none" stroke="#52b788" stroke-width="3" rx="2"/>`;

  // BLE scanner markers (concentric rings)
  for(const r of radios){
    const {x,y,name} = r;
    s += `<circle cx="${x}" cy="${y}" r="50" fill="none" stroke="#52b788" stroke-width="0.5" opacity="0.1"/>`;
    s += `<circle cx="${x}" cy="${y}" r="32" fill="none" stroke="#52b788" stroke-width="0.8" opacity="0.2"/>`;
    s += `<circle cx="${x}" cy="${y}" r="18" fill="none" stroke="#52b788" stroke-width="1.2" opacity="0.45"/>`;
    s += `<circle cx="${x}" cy="${y}" r="8"  fill="#52b788" opacity="0.95"/>`;
    s += `<circle cx="${x}" cy="${y}" r="3.5" fill="#071008"/>`;
    s += `<text x="${x}" y="${y+28}" text-anchor="middle" fill="#52b788" font-size="9" opacity="0.8">${_escSVG(name)}</text>`;
  }

  // Objects
  for(const o of objects){
    const {x,y,color,name,type} = o;
    if(type === "entity"){
      s += `<circle cx="${x}" cy="${y}" r="9" fill="${color}" opacity="0.95"/>`;
      s += `<circle cx="${x}" cy="${y}" r="4" fill="#071008" opacity="0.6"/>`;
    } else if(type === "tagged_ble"){
      s += `<rect x="${x-8}" y="${y-8}" width="16" height="16" fill="${color}" opacity="0.95" rx="3"/>`;
      s += `<rect x="${x-3}" y="${y-3}" width="6" height="6" fill="#071008" opacity="0.5" rx="1"/>`;
    } else {
      s += `<polygon points="${x},${y-10} ${x+9},${y+5} ${x-9},${y+5}" fill="${color}" opacity="0.85"/>`;
    }
    s += `<text x="${x}" y="${y-13}" text-anchor="middle" fill="${color}" font-size="9" font-weight="500">${_escSVG(name)}</text>`;
  }

  // Title in top-right corner
  s += `<rect x="620" y="375" width="175" height="46" fill="#0a150e" stroke="#1b3526" stroke-width="1" rx="4"/>`;
  s += `<text x="632" y="391" fill="#52b788" font-size="10" font-weight="700">Smith Residence (Demo)</text>`;
  s += `<text x="632" y="404" fill="#94a3b8" font-size="8">3 scanners · 5 objects · 5 rooms</text>`;
  s += `<text x="632" y="415" fill="#52b78870" font-size="8">PadSpan™ HA Sample Mode</text>`;

  s += `</svg>`;
  return s;
}

// ─── 3D Stack Tab ─────────────────────────────────────────────────────────────
// The spatial backbone of PadSpan's multi-floor system. Three main sections:
//
// 1. FLOOR ASSIGNMENT TABLE — assign each map to an HA floor, set z_level
//    (stacking order), ceiling height, and visibility toggle.
//
// 2. ALIGNMENT OVERLAY EDITOR — two layers stacked: the reference map (fixed)
//    and the target map (semi-transparent, draggable). User drags/scales/rotates
//    the target to align structural features. CSS transform with
//    transform-origin:50% 50% means translate moves the centre point, then
//    rotate+scale happen around that translated centre. View Zoom scales the
//    entire stage (not the maps) so both maps fit on screen.
//
// 3. 3D ISOMETRIC PREVIEW — SVG render of all floors stacked in isometric
//    perspective. Floor spacing, L/R offset, and focus floor are adjustable
//    via sliders. Outside maps are fitted inside the indoor bounding box.
//
// Also includes: Point Align (side-by-side affine solver), tie-in system,
// dual-master conflict resolution, and emergency tie-in recovery.

const _LEVEL_NAMES = ["Basement", "Ground", "Level 1", "Level 2", "Level 3"];

// Floor elevation belongs to the floor, not to a map: two maps on one floor
// must not each carry their own copy of its height.  One batch save, because
// the derived base of every floor above depends on the ones below it.
function _floorHeights(ctx){
  const { el } = ctx.helpers;
  const floors = (ctx.state.model?.floors || []).slice()
    .sort((a,b) => (a.level ?? 999) - (b.level ?? 999) || (a.name||"").localeCompare(b.name||""));
  const derived = ctx.state.model?.floor_elevations || {};

  const wrap = el("div",{style:"margin-top:16px"},[
    el("div",{class:"muted",style:"font-size:13px;font-weight:600"},"Floor Heights"),
    el("div",{class:"muted",style:"font-size:12px;margin-top:2px"},
      "Floor-to-floor is finished floor to the next finished floor — ceiling plus slab. It sets the vertical gap 3D positioning uses between floors. "+
      "Base elevation is derived by stacking those heights, so leave it blank unless stacking is wrong: a split level or a mezzanine."),
  ]);
  if(!floors.length){
    wrap.appendChild(el("div",{class:"muted",style:"font-size:12px;margin-top:8px"},"No floors defined in Home Assistant yet."));
    return wrap;
  }

  const _num = (val, min, max, placeholder, title) => el("input",{
    type:"number", min:String(min), max:String(max), step:"0.1", placeholder, title,
    value: val != null ? String(val) : "",
    style:"width:82px;background:#0a150e;border:1px solid #1b3526;color:#e2e8f0;padding:4px 6px;border-radius:4px",
  });

  const rows = floors.map(f => ({
    id: f.id,
    f2f:  _num(f.floor_to_floor_m,  1.5, 100, "2.8", "Finished floor to the next finished floor. Blank = 2.8 m default."),
    base: _num(f.base_elevation_m, -50, 500, "derived", "Absolute height of this floor's walking surface. Blank = stack the floors below."),
  }));

  const table = el("table",{style:"width:100%;border-collapse:collapse;font-size:13px;margin-top:8px"});
  const th = "text-align:left;padding:6px 8px;color:#94a3b8;font-weight:500";
  table.appendChild(el("thead",{},el("tr",{style:"border-bottom:1px solid #1b3526"},[
    el("th",{style:th},"Floor"),
    el("th",{style:th},"Floor↕ (m)"),
    el("th",{style:th},"Base elevation (m)"),
    el("th",{style:th},"In use (m)"),
  ])));
  table.appendChild(el("tbody",{}, rows.map((r,i) => el("tr",{style:"border-bottom:1px solid #0f2017"},[
    el("td",{style:"padding:6px 8px;font-weight:500"}, floors[i].name || floors[i].id),
    el("td",{style:"padding:6px 8px"}, r.f2f),
    el("td",{style:"padding:6px 8px"}, r.base),
    el("td",{style:"padding:6px 8px;color:#94a3b8"}, derived[r.id] != null ? String(derived[r.id]) : "—"),
  ]))));
  wrap.appendChild(el("div",{style:"overflow-x:auto"}, table));

  const _val = (inp) => { const v = parseFloat(inp.value); return isFinite(v) ? v : null; };
  wrap.appendChild(el("div",{style:"margin-top:8px"}, el("button",{class:"btn inline", onclick: async ()=>{
    try{
      await ctx.actions.callWS({ type:"padspan_ha/fabric_floor_elevations_set", floors: rows.map(r => ({
        id: r.id, floor_to_floor_m: _val(r.f2f), base_elevation_m: _val(r.base),
      }))});
      ctx.toast("Floor heights saved");
      await ctx.actions.modelRefresh();
    }catch(e){ ctx.toast("Save failed: "+String(e), true); }
  }},"Save Floor Heights")));
  return wrap;
}

function _stack(ctx, maps, helpBtn){
  const { el, esc } = ctx.helpers;
  helpBtn = helpBtn || (()=>null);

  // Init alignment state — outside maps are excluded from alignment because
  // they use a different coordinate model (fitted to indoor bounding box).
  const _alignableMaps = maps.filter(m => !_isOutsideMap(m));

  // WHAT THIS EDITOR EDITS: a map's PLACEMENT, in metres. It used to edit
  // `maps[].stack` — a complete second description of where the map sits, in
  // world units, which the metre record could not see and which every image
  // operation had to remember to update in step. The gestures are unchanged;
  // what they move is the one record, and Save is the one call that commits
  // it. Nothing on screen is a coordinate any more: the stage IS the
  // reference picture, so a drag is measured in the reference's own metres.
  const _txOf = (id) => (ctx.state.model?.map_transforms || {})[id] || null;
  const _placeOf = (id) => {
    const t = _txOf(id);
    if (!t || !(Number(t.scale_x_m) > 0) || !(Number(t.scale_y_m) > 0)) return null;
    return { origin_x_m: Number(t.origin_x_m || 0), origin_y_m: Number(t.origin_y_m || 0),
             scale_x_m: Number(t.scale_x_m), scale_y_m: Number(t.scale_y_m),
             rotation_rad: Number(t.rotation_rad || 0), shear_rad: Number(t.shear_rad || 0) };
  };
  // Where a NEVER-PLACED map starts, and what Reset goes back to: on top of
  // the reference, at the reference's width, undistorted in its own pixels.
  // This is the only place the editor builds a placement out of nothing, and
  // it needs one — a map with no record cannot be drawn at all, so without a
  // starting position there would be nothing on screen to drag. Null when the
  // REFERENCE has no placement either: two pictures and no metres between
  // them is not something to guess a size from.
  const _seedPlace = (tgt, refId) => {
    const r = _placeOf(refId);
    if (!r) return null;
    return { origin_x_m: r.origin_x_m, origin_y_m: r.origin_y_m,
             scale_x_m: r.scale_x_m, scale_y_m: r.scale_x_m * imageAr(tgt),
             rotation_rad: r.rotation_rad, shear_rad: 0 };
  };
  // Every gesture below turns the map about its own centre, so the picture
  // does not slide out from under the cursor while it is being resized.
  const _keepCentre = (before, after) => {
    const c0 = mapFracToMetres(before, 0.5, 0.5);
    const c1 = mapFracToMetres(after, 0.5, 0.5);
    if (!c0 || !c1) return after;
    after.origin_x_m += c0[0] - c1[0];
    after.origin_y_m += c0[1] - c1[1];
    return after;
  };
  if(!ctx.state.maps._stackAlign){
    const firstTgt = _alignableMaps[1] || _alignableMaps[0] || null;
    ctx.state.maps._stackAlign = {
      refId:    _alignableMaps[0] ? _alignableMaps[0].id : null,
      targetId: firstTgt ? firstTgt.id : null,
      place:    firstTgt ? _placeOf(firstTgt.id) : null,
    };
  }
  const alignState = ctx.state.maps._stackAlign;

  // Guard: ensure saved refId/targetId still valid after map deletions
  if(alignState.refId && !maps.find(m=>m.id===alignState.refId))
    alignState.refId = maps[0]?.id || null;
  if(alignState.targetId && !maps.find(m=>m.id===alignState.targetId)){
    const newTgt = maps[1] || maps[0] || null;
    alignState.targetId = newTgt?.id || null;
    alignState.place    = newTgt ? _placeOf(newTgt.id) : null;
  }

  // Level options: use HA floor registry if available, fall back to hardcoded names
  const haFloors = (ctx.state.model && Array.isArray(ctx.state.model.floors)) ? ctx.state.model.floors : [];
  const levelOptions = haFloors.length > 0
    ? haFloors
        .slice()
        .sort((a,b)=> (a.level ?? 999) - (b.level ?? 999) || (a.name||"").localeCompare(b.name||""))
        .map((f, i) => ({ value: f.level ?? i, label: f.name || f.id }))
    : _LEVEL_NAMES.map((name, i) => ({ value: i, label: name }));

  // View zoom scales the entire overlay stage (not individual maps) so both
  // reference and target are visible even when the target is offset far off.
  // Target opacity controls how transparent the draggable overlay is.
  if(ctx.state.maps._stackViewScale  === undefined) ctx.state.maps._stackViewScale  = 1.0;
  if(ctx.state.maps._stackTgtOpacity === undefined) ctx.state.maps._stackTgtOpacity = 0.55;
  if(ctx.state.maps._stackOutsideMode === undefined) ctx.state.maps._stackOutsideMode = false;

  const card = el("div",{class:"card"});
  card.appendChild(el("div",{class:"card-head"},[
    el("div",{style:"font-weight:700"},"3D Floor Stack"),
    helpBtn("maps_stack"),
  ]));

  card.appendChild(_floorHeights(ctx));

  if(!maps.length){
    card.appendChild(el("div",{class:"muted",style:"margin-top:10px"},"No maps uploaded yet. Go to Upload tab first."));
    return card;
  }

  // ── Section 1: Floor Assignment & Ceiling Height Table ───────────────────
  card.appendChild(el("div",{class:"muted",style:"margin-top:16px;font-size:13px;font-weight:600"},"Floor Assignment & Ceiling Heights"));
  card.appendChild(el("div",{class:"muted",style:"font-size:12px;margin-top:2px"},"Assign each map to an HA floor (auto-sets stack level) and set ceiling height."));

  if(!ctx.state.maps._hiddenMapIds){
    // Prefer HA settings store (persists across restarts); fall back to localStorage
    const savedIds = ctx.state.settings?.hidden_map_ids;
    if(Array.isArray(savedIds)){
      ctx.state.maps._hiddenMapIds = new Set(savedIds);
    } else {
      try{
        const stored = JSON.parse(localStorage.getItem("padspan_hiddenMapIds")||"[]");
        ctx.state.maps._hiddenMapIds = new Set(Array.isArray(stored)?stored:[]);
      }catch(e){ ctx.state.maps._hiddenMapIds = new Set(); }
    }
  }
  const hiddenIds = ctx.state.maps._hiddenMapIds;

  const tableWrap = el("div",{style:"overflow-x:auto;margin-top:8px"});
  const table = document.createElement("table");
  table.style.cssText = "width:100%;border-collapse:collapse;font-size:13px";
  const thead = document.createElement("thead");
  thead.innerHTML = `<tr style="border-bottom:1px solid #1b3526">
    <th style="text-align:left;padding:6px 8px;color:#94a3b8;font-weight:500">Map</th>
    <th style="text-align:left;padding:6px 8px;color:#94a3b8;font-weight:500">HA Floor</th>
    <th style="text-align:left;padding:6px 8px;color:#94a3b8;font-weight:500">Stack Level</th>
    <th style="text-align:left;padding:6px 8px;color:#94a3b8;font-weight:500">Ceiling (m)</th>
    <th style="text-align:center;padding:6px 8px;color:#94a3b8;font-weight:500">Show</th>
    <th style="padding:6px 8px"></th>
  </tr>`;
  table.appendChild(thead);
  const tbody = document.createElement("tbody");

  for(const m of maps){
    const stk = m.stack || {z_level:0,ceiling_height_m:2.4};
    const tr = document.createElement("tr");
    tr.style.cssText = "border-bottom:1px solid #0f2017";

    const tdName = document.createElement("td");
    tdName.style.cssText = "padding:6px 8px;font-weight:500";
    tdName.textContent = m.name || m.id;
    tr.appendChild(tdName);

    // HA Floor dropdown
    const tdFloor = document.createElement("td");
    tdFloor.style.cssText = "padding:6px 8px";
    const floorSel2 = document.createElement("select");
    floorSel2.className = "select";
    floorSel2.style.minWidth = "120px";
    const flOpt0 = document.createElement("option"); flOpt0.value = ""; flOpt0.textContent = "— None —";
    floorSel2.appendChild(flOpt0);
    haFloors.forEach(f => {
      const o = document.createElement("option");
      o.value = f.id; o.textContent = f.name || f.id;
      if(f.id === (m.floor_id||"")) o.selected = true;
      floorSel2.appendChild(o);
    });
    // Always offer "Outside" option
    const _oOpt2 = document.createElement("option");
    _oOpt2.value = OUTSIDE_FLOOR_ID; _oOpt2.textContent = "Outside (Experimental)";
    if(m.floor_id === OUTSIDE_FLOOR_ID) _oOpt2.selected = true;
    floorSel2.appendChild(_oOpt2);
    tdFloor.appendChild(floorSel2);
    tr.appendChild(tdFloor);

    // Stack level: ↓ number ↑
    const tdLevel = document.createElement("td");
    tdLevel.style.cssText = "padding:6px 8px;white-space:nowrap";
    const zLevelInput = document.createElement("input");
    zLevelInput.type = "number"; zLevelInput.min = "0"; zLevelInput.max = "20"; zLevelInput.step = "1";
    zLevelInput.value = String(stk.z_level ?? 0);
    zLevelInput.style.cssText = "width:52px;background:#0a150e;border:1px solid #1b3526;color:#e2e8f0;padding:4px 6px;border-radius:4px;text-align:center";
    const zDn = document.createElement("button"); zDn.className = "btn inline"; zDn.textContent = "↓"; zDn.style.padding = "2px 6px";
    zDn.addEventListener("click", () => { zLevelInput.value = String(Math.max(0, parseInt(zLevelInput.value||"0",10)-1)); });
    const zUp = document.createElement("button"); zUp.className = "btn inline"; zUp.textContent = "↑"; zUp.style.padding = "2px 6px";
    zUp.addEventListener("click", () => { zLevelInput.value = String(Math.min(20, parseInt(zLevelInput.value||"0",10)+1)); });
    // When HA floor changes, auto-sync z_level from floor.level attribute
    floorSel2.addEventListener("change", () => {
      const fl = haFloors.find(f => f.id === floorSel2.value);
      if(fl && fl.level != null) zLevelInput.value = String(fl.level);
    });
    tdLevel.appendChild(zDn);
    tdLevel.appendChild(zLevelInput);
    tdLevel.appendChild(zUp);
    tr.appendChild(tdLevel);

    // Ceiling input
    const tdCeil = document.createElement("td");
    tdCeil.style.cssText = "padding:6px 8px";
    const ceilInput = document.createElement("input");
    ceilInput.type = "number"; ceilInput.min = "1.5"; ceilInput.max = "100"; ceilInput.step = "0.1";
    ceilInput.value = String(stk.ceiling_height_m || 2.4);
    ceilInput.style.cssText = "width:70px;background:#0a150e;border:1px solid #1b3526;color:#e2e8f0;padding:4px 6px;border-radius:4px";
    tdCeil.appendChild(ceilInput);
    tr.appendChild(tdCeil);

    const tdShow = document.createElement("td");
    tdShow.style.cssText = "padding:6px 8px;text-align:center";
    const showCb = document.createElement("input");
    showCb.type = "checkbox";
    showCb.checked = !hiddenIds.has(m.id);
    showCb.style.cssText = "width:16px;height:16px;accent-color:#52b788;cursor:pointer";
    showCb.addEventListener("change", () => {
      if(!showCb.checked) hiddenIds.add(m.id); else hiddenIds.delete(m.id);
      try{ localStorage.setItem("padspan_hiddenMapIds", JSON.stringify([...hiddenIds])); }catch(e){}
      // Persist to HA settings store (survives restarts); fire-and-forget
      ctx.actions.settingsSet({ hidden_map_ids: [...hiddenIds] }).catch(()=>{});
    });
    tdShow.appendChild(showCb);
    tr.appendChild(tdShow);

    const tdSave = document.createElement("td");
    tdSave.style.cssText = "padding:6px 8px";
    tdSave.appendChild(el("button",{class:"btn inline", onclick: async ()=>{
      const newStk = _stackPatch(m.stack, {
        z_level: parseInt(zLevelInput.value, 10) || 0,
        ceiling_height_m: parseFloat(ceilInput.value) || 2.4,
      });
      await ctx.actions.mapsUpdateQuiet({ map_id: m.id, floor_id: floorSel2.value || m.floor_id||"", stack: newStk });
      // The floor's stacking order still follows its map's level; its heights
      // are owned by the Floor Heights table above.
      const _fid = floorSel2.value || m.floor_id || "";
      if(_fid && _fid !== OUTSIDE_FLOOR_ID){
        try{
          await ctx.actions.callWS({ type: "padspan_ha/fabric_floor_elevations_set", floors: [{
            id: _fid, level: parseInt(zLevelInput.value, 10) || 0,
          }]});
        }catch(e){}
      }
      ctx.actions.mapsRefresh();
    }},"Save"));
    tr.appendChild(tdSave);
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  tableWrap.appendChild(table);
  card.appendChild(tableWrap);

  // ── Section 2: Alignment Overlay Editor ──────────────────────────────────
  const alignHdrRow = el("div",{style:"margin-top:24px;display:flex;align-items:center;justify-content:space-between"});
  alignHdrRow.appendChild(el("div",{class:"muted",style:"font-size:13px;font-weight:600"},"Alignment Overlay"));
  card.appendChild(alignHdrRow);
  card.appendChild(el("div",{class:"muted",style:"font-size:12px;margin-top:4px"},"Drag the target floor plan (semi-transparent) over the reference to align them spatially. Use Scale +/− to resize."));

  const selRow = el("div",{style:"display:flex;gap:16px;flex-wrap:wrap;align-items:flex-end;margin-top:10px"});
  const refSel = document.createElement("select"); refSel.className = "select";
  const tgtSel = document.createElement("select"); tgtSel.className = "select";
  // Reference: masters sorted to top (they are the natural fixed reference); exclude Outside maps
  // Reference first = the maps that are actually PLACED, oldest first. It
  // sorted masters to the top; there is no master, and "has a placement" is
  // the property that actually matters — you cannot align onto a picture that
  // is nowhere.
  const _placedIds = new Set(Object.keys(ctx.state.model?.map_transforms || {})
    .filter(id => { const t = ctx.state.model.map_transforms[id];
                    return t && Number(t.scale_x_m) > 0 && Number(t.scale_y_m) > 0; }));
  const mapsForRef = [..._alignableMaps].sort(
    (a,b) => (_placedIds.has(b.id)?1:0) - (_placedIds.has(a.id)?1:0));
  for(const m of mapsForRef){
    const oR = document.createElement("option"); oR.value = m.id;
    oR.textContent = (_placedIds.has(m.id) ? "" : "⚠ ") + (m.name||m.id);
    if(m.id === alignState.refId) oR.selected = true;
    refSel.appendChild(oR);
  }
  // Target: show all except Outside maps, flag masters so user is aware
  for(const m of _alignableMaps){
    const oT = document.createElement("option"); oT.value = m.id;
    oT.textContent = (_placedIds.has(m.id) ? "" : "⚠ ") + (m.name||m.id);
    if(m.id === alignState.targetId) oT.selected = true;
    tgtSel.appendChild(oT);
  }
  selRow.appendChild(el("div",{},[el("div",{class:"muted",style:"font-size:11px;margin-bottom:3px"},"Reference (fixed)"), refSel]));
  selRow.appendChild(el("div",{},[el("div",{class:"muted",style:"font-size:11px;margin-bottom:3px"},"Target (draggable)"), tgtSel]));
  card.appendChild(selRow);
  // The align refusal that used to stand here is gone with the master flag.
  // An align is a placement like every other placement now, so there is no
  // map an align may not be applied to (#67). What CAN refuse is the commit,
  // and it refuses for a reason the owner can act on: it would strand the
  // calibration pins off the map.
  const readoutDiv = el("div",{style:"margin-top:8px;font-size:12px;font-family:monospace;color:#94a3b8"});
  const updateReadout = ()=>{
    const p = alignState.place;
    if(!p){ readoutDiv.textContent = "Not placed — pick a placed Reference, then press Reset to start this map on top of it."; return; }
    const lean = Math.abs(p.shear_rad) > 1e-4 ? `  Lean: ${(p.shear_rad*180/Math.PI).toFixed(1)}°` : "";
    readoutDiv.textContent =
      `Origin: ${p.origin_x_m.toFixed(2)}, ${p.origin_y_m.toFixed(2)} m`
      + `  Size: ${p.scale_x_m.toFixed(2)} × ${p.scale_y_m.toFixed(2)} m`
      + `  Rot: ${(p.rotation_rad*180/Math.PI).toFixed(1)}°${lean}`;
  };
  updateReadout();
  card.appendChild(readoutDiv);

  // stageOuter: scrollable canvas with 60px padding so the dragged target
  // remains visible when it overflows the reference map's bounding box.
  // stageWrap: the actual sized container. Its CSS transform:scale() is the
  // "View Zoom" — scaling the whole stage, not individual map layers.
  const stageOuter = el("div",{style:"margin-top:10px;overflow:auto;max-width:100%;border-radius:8px;background:#071008;padding:60px"});
  const stageWrap = el("div",{style:`position:relative;overflow:visible;border-radius:6px;background:#071008;width:100%;min-width:220px;transform:scale(${ctx.state.maps._stackViewScale||1.0});transform-origin:50% 50%`});
  stageOuter.appendChild(stageWrap);
  card.appendChild(stageOuter);

  let tgtLayerRef = null;
  let pinsLayerRef = null;
  let rebuildPins = () => {};  // forward ref — real impl assigned after buildStage
  let stageAr = 1.0;
  let applyCurrentTransform = ()=>{ updateReadout(); };
  // AbortController to clean up window listeners when buildStage() is called again
  let _dragAbort = null;

  const buildStage = ()=>{
    // Remove previous window listeners before attaching new ones
    if(_dragAbort){ _dragAbort.abort(); }
    _dragAbort = new AbortController();
    const { signal } = _dragAbort;

    stageWrap.innerHTML = "";
    const refId = refSel.value;
    const tgtId = tgtSel.value;

    // When the target changes, load ITS placement. A map with none opens
    // unplaced and the readout says so — it used to open at scale 1.0 in the
    // corner of the stage, which looks exactly like a placement and is not
    // one, and the pre-distortion correction below it existed because the
    // stage was neither picture's frame. The stage IS the reference now.
    if(tgtId !== alignState.targetId){
      alignState.place = _placeOf(tgtId);
    }
    alignState.refId    = refId;
    alignState.targetId = tgtId;

    const refMap = maps.find(m=>m.id===refId) || null;
    const tgtMap = maps.find(m=>m.id===tgtId) || null;
    if(!refMap){ applyCurrentTransform = ()=>{ updateReadout(); }; return; }

    const iw = refMap.image?.width  || 800;
    const ih = refMap.image?.height || 600;
    const ar = ih / iw;
    stageAr = ar;

    stageWrap.style.paddingBottom = `${ar * 100}%`;
    stageWrap.style.height = "0";

    // THE STAGE IS THE REFERENCE PICTURE. Sized to its shape, drawn
    // untransformed, so a stage fraction and a reference fraction are the
    // same number and the bridge to the target is metres.
    //
    // The reference layer used to carry its OWN stack transform on top of
    // that — a hand-inlined second copy of the renderer, one of two in this
    // function — which meant the stage was neither picture: the reference sat
    // rotated and offset inside a box shaped like it, and every drag was
    // measured in a frame nothing else in the codebase used. Deleting the
    // second copy is what lets a drag be metres.
    const refLayer = document.createElement("div");
    refLayer.style.cssText = "position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none";
    const refUrl = ctx.helpers.mapImageUrl(refMap);
    if(refUrl){
      const ri = document.createElement("img");
      ri.src = refUrl;
      ri.style.cssText = "position:absolute;top:0;left:0;width:100%;height:100%;object-fit:fill;display:block";
      refLayer.appendChild(ri);
    }
    const refSvgDiv = document.createElement("div");
    refSvgDiv.style.cssText = "position:absolute;top:0;left:0;width:100%;height:100%";
    refSvgDiv.innerHTML = _stackMapSVGStr(refMap, ctx, false, !refUrl);
    refLayer.appendChild(refSvgDiv);
    stageWrap.appendChild(refLayer);

    const refPlace = _placeOf(refId);

    if(tgtMap && tgtMap.id !== refMap.id){
      const tgtLayer = document.createElement("div");
      tgtLayer.style.cssText = "position:absolute;top:0;left:0;width:100%;height:100%;cursor:grab;transform-origin:50% 50%";

      // Target layer: image (if any) + SVG room bounds on top
      const tgtUrl = ctx.helpers.mapImageUrl(tgtMap);
      if(tgtUrl){
        const ti = document.createElement("img");
        ti.src = tgtUrl;
        ti.style.cssText = "position:absolute;top:0;left:0;width:100%;height:100%;object-fit:fill;display:block";
        tgtLayer.appendChild(ti);
      }
      const tgtSvgDiv = document.createElement("div");
      tgtSvgDiv.style.cssText = "position:absolute;top:0;left:0;width:100%;height:100%";
      tgtSvgDiv.innerHTML = _stackMapSVGStr(tgtMap, ctx, true, !tgtUrl);
      tgtLayer.appendChild(tgtSvgDiv);

      tgtLayer.style.opacity = String(ctx.state.maps._stackTgtOpacity || 0.55);
      tgtLayerRef = tgtLayer;

      // ONE draw path, not two. It had a matrix branch and a decomposed
      // branch, chosen by whether Point Align had run — the same two-branch
      // shape as the renderer it copied, and the reason four controls had to
      // null `_m` on one click so the picture would stop being drawn from a
      // matrix they had not updated. A placement is a placement; where it
      // lands on the reference's picture is `placementStageAffine`, and CSS
      // matrix() draws every affine there is.
      applyCurrentTransform = ()=>{
        const af = alignState.place && refPlace
          ? placementStageAffine(alignState.place, refPlace) : null;
        if (af) {
          // Stage x is a fraction of the stage WIDTH and stage y a fraction
          // of its HEIGHT, while CSS matrix() works in pixels — hence the
          // `ar` on the two cross terms.
          const ma = af.m[0], mb = af.m[2] * ar, mc = af.m[1] / ar, md = af.m[3];
          tgtLayer.style.display = "";
          tgtLayer.style.transform =
            `translate(${af.ox*100}%,${af.oy*100}%) matrix(${ma},${mb},${mc},${md},0,0)`;
        } else {
          // Unplaced, or a reference that is itself nowhere. Nothing is drawn
          // rather than something drawn at a guessed size.
          tgtLayer.style.display = "none";
        }
        updateReadout();
      };
      applyCurrentTransform();

      // A drag moves the map's ORIGIN, in metres, by the same distance the
      // cursor moved across the reference's own picture. The gesture is
      // identical; the units are the house's.
      let dragging = false, dragStartX = 0, dragStartY = 0;
      let startOX = 0, startOY = 0;
      const stageRect = ()=>stageWrap.getBoundingClientRect();
      const _setDrag = (v)=>{ dragging=v; if(ctx.state.maps) ctx.state.maps._stackDragging=v; };
      const _dragTo = (cx, cy)=>{
        const p = alignState.place; if(!p || !refPlace) return;
        const r = stageRect(); if(!r.width) return;
        const a = mapFracToMetres(refPlace, 0.5, 0.5);
        const b = mapFracToMetres(refPlace,
          0.5 + (cx - dragStartX)/r.width, 0.5 + (cy - dragStartY)/r.height);
        if(!a || !b) return;
        p.origin_x_m = startOX + (b[0] - a[0]);
        p.origin_y_m = startOY + (b[1] - a[1]);
        applyCurrentTransform();
      };
      const _dragFrom = (cx, cy)=>{
        _setDrag(true); dragStartX=cx; dragStartY=cy;
        startOX = alignState.place?.origin_x_m ?? 0;
        startOY = alignState.place?.origin_y_m ?? 0;
      };

      tgtLayer.addEventListener("mousedown",(ev)=>{
        _dragFrom(ev.clientX, ev.clientY);
        tgtLayer.style.cursor="grabbing"; ev.preventDefault();
      });
      tgtLayer.addEventListener("touchstart",(ev)=>{
        if(!ev.touches[0]) return;
        _dragFrom(ev.touches[0].clientX, ev.touches[0].clientY);
        ev.preventDefault();
      },{passive:false});
      window.addEventListener("mousemove",(ev)=>{
        if(!dragging) return;
        _dragTo(ev.clientX, ev.clientY);
      }, { signal });
      window.addEventListener("touchmove",(ev)=>{
        if(!dragging||!ev.touches[0]) return;
        _dragTo(ev.touches[0].clientX, ev.touches[0].clientY);
      },{ passive:false, signal });
      window.addEventListener("mouseup",()=>{ _setDrag(false); tgtLayer.style.cursor="grab"; }, { signal });
      window.addEventListener("touchend",()=>{ _setDrag(false); }, { signal });

      stageWrap.appendChild(tgtLayer);
    } else {
      applyCurrentTransform = ()=>{ updateReadout(); };
      applyCurrentTransform();
    }

    // Persistent pins overlay — always on top, never captures pointer events
    const pinsDiv = document.createElement("div");
    pinsDiv.style.cssText = "position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none";
    pinsLayerRef = pinsDiv;
    rebuildPins();
    stageWrap.appendChild(pinsDiv);
  };

  // Real rebuildPins — updates only the pins SVG layer without rebuilding the whole stage
  rebuildPins = () => {
    if(!pinsLayerRef) return;
    if(!ctx.state.maps._persistentPins){ pinsLayerRef.innerHTML = ""; return; }
    const refId = refSel.value;
    const refMap = maps.find(m=>m.id===refId) || null;
    if(!refMap){ pinsLayerRef.innerHTML = ""; return; }
    const snap = (ctx.state.live && ctx.state.live.snapshot) || null;
    const awayObjs = snap?.objects
      ? Object.values(snap.objects).filter(o =>
          o.user_label && o.room && o.room !== "unknown" && o.room !== "not_home" &&
          typeof o.age_s === "number" && o.age_s > 30)
      : [];
    pinsLayerRef.innerHTML = _persistent2dPinsSVGStr(refMap.room_bounds||{}, awayObjs);
  };

  refSel.addEventListener("change", buildStage);
  tgtSel.addEventListener("change", buildStage);
  buildStage();

  const ctrlRow = el("div",{style:"display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-top:10px"});

  // THE FOUR CONTROLS THAT USED TO NULL `_m`.
  //
  // Scale +/-, X +/- and Rotate each set `alignState._m = null` on click,
  // because the map was being drawn from a solved matrix those controls had
  // no way to update, and a decomposed edit beside a live matrix draws the
  // matrix. That was three copies of one placement — the matrix, the fields,
  // and the metre record — and it is why one click on any of these silently
  // discarded a Point Align. There is one placement now, and every control
  // edits it.
  //
  // Each turns the map about its OWN CENTRE, so the picture stays under the
  // cursor while it is resized. `_keepCentre` is the whole of that.
  const _editPlace = (fn) => {
    const p = alignState.place;
    if(!p){ ctx.toast("This map is not placed yet — press Reset to start it on the reference.", true); return; }
    const next = fn({ ...p });
    if(next) alignState.place = _keepCentre(p, next);
    applyCurrentTransform();
  };
  const _scaleBy = (fx, fy) => _editPlace(p => {
    const nx = p.scale_x_m * fx, ny = p.scale_y_m * fy;
    // A map with no width is not a placement, and neither is one the size of
    // the county. The bar is the same one `placement_is_readable` applies.
    if(!(nx > 0.05 && ny > 0.05 && nx < 5000 && ny < 5000)) return null;
    p.scale_x_m = nx; p.scale_y_m = ny; return p;
  });

  if(ctx.state.maps._stackArLocked === undefined) ctx.state.maps._stackArLocked = true;

  const xMinusBtn = el("button",{class:"btn inline",title:"Stretch left/right only (horizontal squeeze/stretch)"},"X −");
  const xPlusBtn  = el("button",{class:"btn inline",title:"Stretch left/right only (horizontal squeeze/stretch)"},"X +");
  const _setXBtnState = (locked)=>{
    xMinusBtn.disabled = locked; xMinusBtn.style.opacity = locked ? "0.3" : "";
    xPlusBtn.disabled  = locked; xPlusBtn.style.opacity  = locked ? "0.3" : "";
  };
  _setXBtnState(ctx.state.maps._stackArLocked);
  xMinusBtn.onclick = ()=>_scaleBy(1/1.05, 1);
  xPlusBtn.onclick  = ()=>_scaleBy(1.05, 1);

  const lockArBtn = el("button",{
    class:"btn inline",
    title:"Lock aspect ratio: Scale +/− resizes both axes equally. Unlock to enable X-only stretch.",
  }, ctx.state.maps._stackArLocked ? "Lock AR ✓" : "Lock AR");
  lockArBtn.style.cssText = ctx.state.maps._stackArLocked
    ? "background:#52b788;color:#071008;font-weight:700"
    : "color:#94a3b8";
  lockArBtn.onclick = ()=>{
    ctx.state.maps._stackArLocked = !ctx.state.maps._stackArLocked;
    const lk = ctx.state.maps._stackArLocked;
    lockArBtn.style.background = lk ? "#52b788" : "";
    lockArBtn.style.color      = lk ? "#071008" : "#94a3b8";
    lockArBtn.style.fontWeight = lk ? "700"     : "";
    lockArBtn.textContent      = lk ? "Lock AR ✓" : "Lock AR";
    _setXBtnState(lk);
  };

  const _scaleStep = ()=> ctx.state.maps._stackOutsideMode ? 1.25 : 1.05;
  ctrlRow.appendChild(el("span",{class:"muted",style:"font-size:11px;white-space:nowrap"},"Scale:"));
  ctrlRow.appendChild(el("button",{class:"btn inline",
    onclick:()=>{ const f=_scaleStep(); _scaleBy(f, f); }},"Scale +"));
  ctrlRow.appendChild(el("button",{class:"btn inline",
    onclick:()=>{ const f=1/_scaleStep(); _scaleBy(f, f); }},"Scale −"));
  ctrlRow.appendChild(lockArBtn);
  ctrlRow.appendChild(xPlusBtn);
  ctrlRow.appendChild(xMinusBtn);

  // Outside map toggle — bigger steps for very large or outdoor spaces. The
  // hard 0.1x-5x limits it used to lift were limits on a stack `scale`, which
  // was a multiple of the master picture; a placement is in metres and its
  // limit is the one above, which no house reaches.
  const outsideBtn = el("button",{
    class:"btn inline",
    style: ctx.state.maps._stackOutsideMode
      ? "background:#52b788;color:#071008;font-weight:700"
      : "color:#94a3b8",
    title: "Outside map mode: coarser steps (25% per click) for large outdoor spaces",
    onclick: ()=>{
      ctx.state.maps._stackOutsideMode = !ctx.state.maps._stackOutsideMode;
      outsideBtn.style.background = ctx.state.maps._stackOutsideMode ? "#52b788" : "";
      outsideBtn.style.color      = ctx.state.maps._stackOutsideMode ? "#071008" : "#94a3b8";
      outsideBtn.style.fontWeight = ctx.state.maps._stackOutsideMode ? "700"     : "";
      outsideBtn.textContent      = ctx.state.maps._stackOutsideMode ? "Outside ✓" : "Outside map";
    }
  }, ctx.state.maps._stackOutsideMode ? "Outside ✓" : "Outside map");
  ctrlRow.appendChild(outsideBtn);

  // Rotate controls
  const _turn = (deg)=>_editPlace(p => { p.rotation_rad += deg * Math.PI / 180; return p; });
  ctrlRow.appendChild(el("span",{class:"muted",style:"font-size:11px;white-space:nowrap;margin-left:8px"},"Rotate:"));
  ctrlRow.appendChild(el("button",{class:"btn inline", onclick:()=>_turn(-15)},"−15°"));
  ctrlRow.appendChild(el("button",{class:"btn inline", onclick:()=>_turn(15)},"﹢15°"));
  ctrlRow.appendChild(el("button",{class:"btn inline", onclick:()=>_editPlace(p => { p.rotation_rad = 0; return p; })},"0°"));

  // View zoom controls (scales stage content so both maps are visible — zooming out reveals overflowed target maps)
  ctrlRow.appendChild(el("span",{class:"muted",style:"font-size:11px;white-space:nowrap;margin-left:8px"},"View:"));
  ctrlRow.appendChild(el("button",{class:"btn inline", onclick:()=>{
    ctx.state.maps._stackViewScale = Math.max(0.2, Math.round(((ctx.state.maps._stackViewScale||1.0)-0.1)*100)/100);
    stageWrap.style.transform = `scale(${ctx.state.maps._stackViewScale})`;
  }},"Zoom −"));
  ctrlRow.appendChild(el("button",{class:"btn inline", onclick:()=>{
    ctx.state.maps._stackViewScale = 1.0;
    stageWrap.style.transform = "scale(1)";
  }},"100%"));
  ctrlRow.appendChild(el("button",{class:"btn inline", onclick:()=>{
    ctx.state.maps._stackViewScale = Math.min(2.0, Math.round(((ctx.state.maps._stackViewScale||1.0)+0.1)*100)/100);
    stageWrap.style.transform = `scale(${ctx.state.maps._stackViewScale})`;
  }},"Zoom +"));

  // Opacity controls (how transparent the draggable target layer is)
  ctrlRow.appendChild(el("span",{class:"muted",style:"font-size:11px;white-space:nowrap;margin-left:8px"},"Opacity:"));
  ctrlRow.appendChild(el("button",{class:"btn inline", onclick:()=>{
    ctx.state.maps._stackTgtOpacity = Math.max(0.05, Math.round(((ctx.state.maps._stackTgtOpacity||0.55)-0.1)*100)/100);
    if(tgtLayerRef) tgtLayerRef.style.opacity = String(ctx.state.maps._stackTgtOpacity);
  }},"▼"));
  ctrlRow.appendChild(el("button",{class:"btn inline", onclick:()=>{
    ctx.state.maps._stackTgtOpacity = 0.55;
    if(tgtLayerRef) tgtLayerRef.style.opacity = "0.55";
  }},"50%"));
  ctrlRow.appendChild(el("button",{class:"btn inline", onclick:()=>{
    ctx.state.maps._stackTgtOpacity = Math.min(0.95, Math.round(((ctx.state.maps._stackTgtOpacity||0.55)+0.1)*100)/100);
    if(tgtLayerRef) tgtLayerRef.style.opacity = String(ctx.state.maps._stackTgtOpacity);
  }},"▲"));

  // Reset — back to the seed placement: on the reference, at its width, this
  // picture's own shape. It is also how an unplaced map gets a first
  // position, so it is the one control that works with no placement loaded.
  ctrlRow.appendChild(el("button",{class:"btn inline",style:"margin-left:8px", onclick:()=>{
    const tgtMap = maps.find(m=>m.id===(alignState.targetId||tgtSel.value));
    const seed = tgtMap && _seedPlace(tgtMap, alignState.refId||refSel.value);
    if(!seed){ ctx.toast("The Reference map has no placement yet — measure it first.", true); return; }
    alignState.place = seed;
    applyCurrentTransform();
  }},"Reset"));

  // ── Point Align ────────────────────────────────────────────────────────────
  // Opens a MODAL OVERLAY (position:fixed) for side-by-side point matching.
  // Completely decoupled from the maps view render cycle — no re-render guard
  // needed. The modal manages its own DOM and state; on Compute or Cancel it
  // simply removes itself and writes results to alignState.

  // ── Gaussian Elimination Helper ────────────────────────────────────────────
  // Solves the normal equations AᵀA·x = Aᵀb via partial-pivot Gaussian elim.
  // Returns solution array of length K, or null if singular.
  const _gaussSolve = (ATA, ATb) => {
    const K = ATA.length;
    const M = ATA.map((r, i) => [...r, ATb[i]]);
    for (let col = 0; col < K; col++) {
      let maxR = col;
      for (let r = col + 1; r < K; r++)
        if (Math.abs(M[r][col]) > Math.abs(M[maxR][col])) maxR = r;
      [M[col], M[maxR]] = [M[maxR], M[col]];
      if (Math.abs(M[col][col]) < 1e-12) return null;
      for (let r = col + 1; r < K; r++) {
        const f = M[r][col] / M[col][col];
        for (let c2 = col; c2 <= K; c2++) M[r][c2] -= f * M[col][c2];
      }
    }
    const x = Array(K).fill(0);
    for (let r = K - 1; r >= 0; r--) {
      x[r] = M[r][K];
      for (let c2 = r + 1; c2 < K; c2++) x[r] -= M[r][c2] * x[c2];
      x[r] /= M[r][r];
    }
    return x;
  };

  // ── Affine Transform Solver (_solvePtAlign) ───────────────────────────────
  //
  // Fits 6-DOF affine matrix [m11,m12,m21,m22,dx,dy] directly in normalised
  // [0,1]² space.  Returns the RAW matrix alongside decomposed CSS params.
  //
  // MODEL (centred at 0.5):
  //   ref_x - 0.5 = m11·(tgt_x-0.5) + m12·(tgt_y-0.5) + dx
  //   ref_y - 0.5 = m21·(tgt_x-0.5) + m22·(tgt_y-0.5) + dy
  //
  // The raw matrix [m11,m12,m21,m22] is used for the CSS matrix() transform
  // (guaranteed correct — no decomposition needed).  Decomposed params
  // (scale, rotation, scaleX_adj) are also returned for display/manual controls.
  const _solvePtAlign = (refPts, tgtPts, ar) => {
    ar = ar || 1;
    const n = Math.min(refPts.length, tgtPts.length);
    if (n < 3) return null;
    const cx = 0.5, cy = 0.5;
    const K = 6;
    const ATA = Array.from({ length: K }, () => Array(K).fill(0));
    const ATb = Array(K).fill(0);
    for (let i = 0; i < n; i++) {
      const u = tgtPts[i].x - cx, v = tgtPts[i].y - cy;
      const bx = refPts[i].x - cx, by = refPts[i].y - cy;
      const r1 = [u, v, 0, 0, 1, 0];
      const r2 = [0, 0, u, v, 0, 1];
      for (let j = 0; j < K; j++) {
        for (let k = 0; k < K; k++) ATA[j][k] += r1[j] * r1[k] + r2[j] * r2[k];
        ATb[j] += r1[j] * bx + r2[j] * by;
      }
    }
    const x = _gaussSolve(ATA, ATb);
    if (!x) return null;
    const m11 = x[0], m12 = x[1], m21 = x[2], m22 = x[3], dx = x[4], dy = x[5];
    // AR-aware decomposition: CSS rotate works in pixel space, so the matrix
    // [[m11,m12],[m21,m22]] maps to CSS [[cos·sx, -sin·sy·ar],[sin·sx/ar, cos·sy]].
    // Recover θ, sx, sy from these relationships:
    const rotation = Math.atan2(m21 * ar, m11) * 180 / Math.PI;
    const sx = Math.sqrt(m11 * m11 + m21 * m21 * ar * ar);
    const sy = Math.sqrt(m12 * m12 / (ar * ar) + m22 * m22);
    const scale = sy;
    const scaleX_adj = sx > 0 && sy > 0 ? sx / sy : 1.0;
    // RMS residual using the raw matrix (always exact — no decomposition error)
    let res = 0;
    for (let i = 0; i < n; i++) {
      const u = tgtPts[i].x - cx, v = tgtPts[i].y - cy;
      const predX = m11 * u + m12 * v + cx + dx;
      const predY = m21 * u + m22 * v + cy + dy;
      res += (predX - refPts[i].x) ** 2 + (predY - refPts[i].y) ** 2;
    }
    return { x_offset: dx, y_offset: dy, scale, rotation, scaleX_adj,
      residual: Math.sqrt(res / n), _m: [m11, m12, m21, m22] };
  };

  // ── Rigid Similarity Solver (_solvePtAlignRigid) ────────────────────────
  //
  // 4-DOF: translation + rotation + uniform scale.  The design matrix models
  // the CSS transform directly so that a = s·cos(θ) and b = s·sin(θ) produce
  // the correct CSS behaviour even on non-square images.
  //
  // TWO aspect ratios, and they are NOT interchangeable.  Both pictures are
  // drawn into one stage with object-fit:fill and the stage is sized to the
  // REFERENCE map's ratio `ar`, so the target arrives pre-stretched by ar/arT.
  // "Rigid" has to mean uniform in the TARGET's own pixels — that is what
  // leaves its picture undistorted — so the target's v terms carry `arT` and
  // only the reference's own y term carries `ar`.
  //
  // INVARIANT: a placed map's world footprint has its OWN image's aspect.
  // Passing one ratio in for both breaks it — the reconstruction below then
  // yields m11 === m22, which pins the placed footprint's aspect to `ar`
  // whatever the target's picture is, so every metre read back through the
  // placement is wrong by arT/ar.  On a 1600x853 map point-aligned against a
  // 930x850 one that is a 42% axis disagreement and a floor 33% short on its
  // long axis (issue #62, rjbutler).  arT === ar reduces to the one-ratio
  // form exactly, so an align between same-shaped pictures is unchanged.
  //
  // CSS rigid model in normalised coords (ar = reference height/width,
  // arT = target height/width):
  //   ref_x - 0.5 = a·u - b·arT·v + dx            where u = tgt_x−0.5
  //   ref_y - 0.5 = b/ar·u + a·(arT/ar)·v + dy            v = tgt_y−0.5
  //
  // 4 unknowns: [a, b, dx, dy].
  const _solvePtAlignRigid = (refPts, tgtPts, ar, arT) => {
    ar = ar || 1;
    // arT gets NO default.  Falling back to `ar` here would hand any caller
    // that forgets the argument the one-ratio model back — the defect itself,
    // and silently, because the solve then succeeds and writes a placement of
    // the wrong shape.  A caller that does not know the target's own aspect
    // has nothing to solve, so it is refused the way everything else in this
    // solver is refused.  (It is also the only divisor of `arR` below.)
    if (!(arT > 0)) return null;
    const n = Math.min(refPts.length, tgtPts.length);
    if (n < 2) return null;
    const cx = 0.5, cy = 0.5;
    const arR = arT / ar;  // exactly 1 when the two pictures share a shape
    const K = 4;
    const ATA = Array.from({ length: K }, () => Array(K).fill(0));
    const ATb = Array(K).fill(0);
    for (let i = 0; i < n; i++) {
      const u = tgtPts[i].x - cx, v = tgtPts[i].y - cy;
      const bx = refPts[i].x - cx, by = refPts[i].y - cy;
      // Design rows that exactly match the CSS rigid transform model:
      const r1 = [u, -arT * v, 1, 0];      // x equation
      const r2 = [arR * v, u / ar,  0, 1]; // y equation
      for (let j = 0; j < K; j++) {
        for (let k = 0; k < K; k++) ATA[j][k] += r1[j] * r1[k] + r2[j] * r2[k];
        ATb[j] += r1[j] * bx + r2[j] * by;
      }
    }
    const x = _gaussSolve(ATA, ATb);
    if (!x) return null;
    const a = x[0], b = x[1], dx = x[2], dy = x[3];
    // The AR-aware decomposition of the matrix below — decomposeFracMatrix's,
    // so the fields written beside `_m` keep describing ONE footprint and the
    // preview's scale(sc·stretch, sc) draws what Apply then stores.
    const scale = Math.sqrt(a * a + b * b) * arR;
    const scaleX_adj = 1 / arR;
    const rotation = Math.atan2(b, a) * 180 / Math.PI;
    // Compute raw matrix coefficients for CSS matrix() transform
    const m11 = a, m12 = -b * arT, m21 = b / ar, m22 = a * arR;
    // RMS residual using raw matrix (exact)
    let res = 0;
    for (let i = 0; i < n; i++) {
      const u2 = tgtPts[i].x - cx, v2 = tgtPts[i].y - cy;
      const predX = m11 * u2 + m12 * v2 + cx + dx;
      const predY = m21 * u2 + m22 * v2 + cy + dy;
      res += (predX - refPts[i].x) ** 2 + (predY - refPts[i].y) ** 2;
    }
    return { x_offset: dx, y_offset: dy, scale, rotation, scaleX_adj,
      residual: Math.sqrt(res / n), _m: [m11, m12, m21, m22] };
  };

  // ── Point Align Modal ─────────────────────────────────────────────────────
  // Opens a full-screen fixed overlay for side-by-side point matching.
  // Completely self-contained — owns its own DOM, state, and lifecycle.
  // No re-render guard needed; the modal sits on top of everything and
  // removes itself on Compute or Cancel. The maps view never knows it existed.
  const _openPointAlignModal = () => {
    const refMap = maps.find(m => m.id === refSel.value);
    const tgtMap = maps.find(m => m.id === tgtSel.value);
    if (!refMap) { ctx.toast("Select a reference map first", true); return; }
    if (!tgtMap || tgtMap.id === refMap.id) { ctx.toast("Select a different target map", true); return; }
    // The align needs the reference to BE somewhere: the solve maps target
    // fractions onto reference fractions, and turning that into a placement
    // needs the reference's own metres. Refused here, before any points are
    // placed, rather than after the Compute the Apply would then reject.
    if (!_placeOf(refMap.id)) {
      ctx.toast("The reference map has no placement yet — measure it, or align it onto a measured map first.", true);
      return;
    }

    // ── Local state (lives only while modal is open) ──
    const refPts = [];
    const tgtPts = [];
    let phase = "ref";
    let bake = false;
    let fullTransform = false; // OFF = rigid (no skew); ON = full affine (can lean)

    // ── Modal root (position:fixed covers the viewport) ──
    const overlay = document.createElement("div");
    overlay.style.cssText = "position:fixed;top:0;left:0;right:0;bottom:0;z-index:99999;" +
      "background:#0a0f0a;display:flex;flex-direction:column;color:#e2e8f0;" +
      "font-family:var(--ha-font-family,Roboto,sans-serif);font-size:13px";

    // Helper: get map image URL with cache-buster
    const _mapUrl = (map) => ctx.helpers.mapImageUrl(map);

    // Helper: close modal
    const _close = () => { try { overlay.remove(); } catch (_e) {} };

    // ── Toolbar (top bar) ──
    const toolbar = document.createElement("div");
    toolbar.style.cssText = "padding:10px 16px;background:#071210;border-bottom:1px solid #1e4976;" +
      "display:flex;align-items:center;gap:10px;flex-wrap:wrap;flex-shrink:0";

    // Reference aspect ratio — used for BOTH panels so coordinates share the same space.
    const _refIW = refMap.image?.width || 800;
    const _refIH = refMap.image?.height || 600;
    const _refAR = _refIW / _refIH;  // width/height ratio (e.g. 1.33 for 800x600)

    // ── Map panels container ──
    const panelsRow = document.createElement("div");
    panelsRow.style.cssText = "flex:1;display:flex;gap:8px;padding:8px;overflow:hidden;min-height:0;align-items:start";

    // ── Rebuild UI (called after every point click, undo, clear) ──
    const _rebuild = () => {
      // -- Toolbar --
      toolbar.innerHTML = "";
      const pairs = Math.min(refPts.length, tgtPts.length);
      const placing = phase === "ref" ? "Reference" : "Target";
      const nextPt = phase === "ref" ? refPts.length + 1 : tgtPts.length + 1;
      const phaseColor = phase === "ref" ? "#52b788" : "#f59e0b";

      const title = document.createElement("span");
      title.style.cssText = "font-weight:700;font-size:14px;color:#7dd3fc";
      title.textContent = "Point Align";
      toolbar.appendChild(title);

      const status = document.createElement("span");
      status.style.cssText = "font-size:12px;font-weight:600;color:" + phaseColor;
      status.textContent = "Place point " + nextPt + " on " + placing;
      toolbar.appendChild(status);

      const badge = document.createElement("span");
      badge.style.cssText = "font-size:10px;padding:2px 8px;border-radius:4px;background:#1a2e1a;color:#52b788";
      badge.textContent = pairs + " pair" + (pairs !== 1 ? "s" : "");
      toolbar.appendChild(badge);

      // Spacer
      const spacer = document.createElement("div");
      spacer.style.cssText = "flex:1";
      toolbar.appendChild(spacer);

      // Undo button
      const undoBtn = document.createElement("button");
      undoBtn.className = "btn inline";
      undoBtn.style.cssText = "font-size:11px;padding:3px 10px;color:#e2e8f0;background:#162016;border:1px solid #2d5a2d;border-radius:4px;cursor:pointer";
      undoBtn.textContent = "Undo";
      undoBtn.onclick = () => {
        if (phase === "ref" && refPts.length > 0) refPts.pop();
        else if (phase === "tgt" && tgtPts.length > 0) tgtPts.pop();
        else if (refPts.length >= tgtPts.length && refPts.length > 0) refPts.pop();
        else if (tgtPts.length > 0) tgtPts.pop();
        _rebuild();
      };
      toolbar.appendChild(undoBtn);

      // Clear button
      const clearBtn = document.createElement("button");
      clearBtn.className = "btn inline";
      clearBtn.style.cssText = "font-size:11px;padding:3px 10px;color:#e2e8f0;background:#162016;border:1px solid #2d5a2d;border-radius:4px;cursor:pointer";
      clearBtn.textContent = "Clear";
      clearBtn.onclick = () => { refPts.length = 0; tgtPts.length = 0; phase = "ref"; _rebuild(); };
      toolbar.appendChild(clearBtn);

      // Bake checkbox
      const bakeLabel = document.createElement("label");
      bakeLabel.style.cssText = "display:inline-flex;align-items:center;gap:4px;font-size:11px;color:#94a3b8;cursor:pointer;user-select:none";
      const bakeCb = document.createElement("input");
      bakeCb.type = "checkbox";
      bakeCb.checked = bake;
      bakeCb.style.cssText = "width:14px;height:14px;accent-color:#52b788;cursor:pointer";
      bakeCb.onchange = () => { bake = bakeCb.checked; };
      bakeLabel.appendChild(bakeCb);
      bakeLabel.appendChild(document.createTextNode("Bake"));
      toolbar.appendChild(bakeLabel);

      // Full transform checkbox — OFF (default) = rigid (translate + rotate + scale only),
      // ON = full 6-DOF affine (allows non-uniform stretch / skew / "leaning" output)
      const ftLabel = document.createElement("label");
      ftLabel.style.cssText = "display:inline-flex;align-items:center;gap:4px;font-size:11px;color:#94a3b8;cursor:pointer;user-select:none";
      const ftCb = document.createElement("input");
      ftCb.type = "checkbox";
      ftCb.checked = fullTransform;
      ftCb.style.cssText = "width:14px;height:14px;accent-color:#f59e0b;cursor:pointer";
      ftCb.onchange = () => { fullTransform = ftCb.checked; };
      ftLabel.appendChild(ftCb);
      ftLabel.appendChild(document.createTextNode("Full transform"));
      toolbar.appendChild(ftLabel);

      // Compute button
      const canCompute = pairs >= 3;
      const computeBtn = document.createElement("button");
      computeBtn.style.cssText = "font-size:12px;padding:4px 16px;font-weight:600;border-radius:4px;cursor:pointer;border:1px solid " +
        (canCompute ? "#52b788;background:#1b4a2e;color:#e2e8f0" : "#333;background:#1a1a1a;color:#555");
      computeBtn.disabled = !canCompute;
      computeBtn.textContent = canCompute ? "Compute (" + pairs + " pairs)" : "Need 3+ pairs";
      computeBtn.onclick = () => {
        try {
          computeBtn.disabled = true;
          computeBtn.textContent = "Computing...";
          const arHW = _refIH / _refIW;  // height/width for isotropic space
          const arTgt = (tgtMap.image?.height || 600) / (tgtMap.image?.width || 800);
          const result = fullTransform
            ? _solvePtAlign(refPts, tgtPts, arHW)              // 6-DOF affine (allows skew)
            : _solvePtAlignRigid(refPts, tgtPts, arHW, arTgt); // 4-DOF rigid (no skew)
          if (!result) {
            ctx.toast("Could not compute — points may be collinear", true);
            computeBtn.disabled = false;
            computeBtn.textContent = "Compute (" + pairs + " pairs)";
            return;
          }
          // Sanitize
          const _sane = (v, def, lo, hi) => { const nn = Number(v); return (isFinite(nn) && nn >= lo && nn <= hi) ? nn : def; };
          const rScale    = _sane(Math.round(result.scale * 10000) / 10000, 1.0, 0.01, 100);
          const rRotation = _sane(Math.round(result.rotation * 100) / 100, 0, -360, 360);
          const rStretch  = _sane(Math.round((result.scaleX_adj || 1.0) * 10000) / 10000, 1.0, 0.01, 100);
          const rDx       = _sane(Math.round(result.x_offset * 10000) / 10000, 0, -10, 10);
          const rDy       = _sane(Math.round(result.y_offset * 10000) / 10000, 0, -10, 10);
          const resPct    = _sane(Math.round((result.residual || 0) * 1000) / 10, 0, 0, 999);

          // Raw matrix from solver (guaranteed correct — no decomposition involved)
          const rawM = result._m || [1, 0, 0, 1]; // [m11, m12, m21, m22]
          console.log("[PtAlign] AR(H/W)=" + arHW.toFixed(4) + " refImage=" + _refIW + "x" + _refIH);
          console.log("[PtAlign] Decomposed: dx=" + rDx + " dy=" + rDy + " scale=" + rScale +
            " rot=" + rRotation + " stretch=" + rStretch + " residual=" + resPct + "%");
          console.log("[PtAlign] Raw matrix: [" + rawM.map(v => v.toFixed(6)).join(", ") + "]");
          for (let _d = 0; _d < Math.min(refPts.length, tgtPts.length); _d++) {
            console.log("[PtAlign] Pair " + (_d+1) + ": ref=(" +
              refPts[_d].x.toFixed(4) + "," + refPts[_d].y.toFixed(4) + ") tgt=(" +
              tgtPts[_d].x.toFixed(4) + "," + tgtPts[_d].y.toFixed(4) + ")");
          }

          // Per-point residuals using the RAW matrix (exact, no decomposition)
          const perPoint = [];
          const n = Math.min(refPts.length, tgtPts.length);
          for (let i = 0; i < n; i++) {
            const u = tgtPts[i].x - 0.5, v = tgtPts[i].y - 0.5;
            const predX = rawM[0] * u + rawM[1] * v + 0.5 + rDx;
            const predY = rawM[2] * u + rawM[3] * v + 0.5 + rDy;
            const dx2 = predX - refPts[i].x;
            const dy2 = predY - refPts[i].y;
            const dist = Math.sqrt(dx2 * dx2 + dy2 * dy2);
            perPoint.push({ idx: i + 1, dist, pct: Math.round(dist * 1000) / 10,
              predX, predY, refX: refPts[i].x, refY: refPts[i].y });
            console.log("[PtAlign] Pt " + (i+1) + ": pred=(" +
              predX.toFixed(4) + "," + predY.toFixed(4) + ") ref=(" +
              refPts[i].x.toFixed(4) + "," + refPts[i].y.toFixed(4) + ") err=" + dist.toFixed(6));
          }

          // Self-test: create synthetic points with a known transform, solve, verify
          const _selfTest = () => {
            // Generated through BOTH ratios, because a generator that uses the
            // reference's for the target's v terms can only ever confirm the
            // one case where the two agree — which is the case issue #62 was
            // not. testS is the scale in the TARGET's own pixels, so the
            // decomposed scale the solver hands back is testS·arT/ar.
            const testAr = arHW, testArT = arTgt, testR = testArT / testAr;
            const testTheta = 12 * Math.PI / 180, testS = 1.08, testDx = 0.03, testDy = -0.02;
            const expScale = testS * testR, expStretch = 1 / testR;
            const testM11 = testS * Math.cos(testTheta);
            const testM12 = -testS * Math.sin(testTheta) * testArT;
            const testM21 = testS * Math.sin(testTheta) / testAr;
            const testM22 = testS * Math.cos(testTheta) * testR;
            const srcPts = [{x:0.2,y:0.3},{x:0.8,y:0.3},{x:0.5,y:0.8},{x:0.3,y:0.6},{x:0.7,y:0.7}];
            const genRef = srcPts.map(p => {
              const u = p.x-0.5, v = p.y-0.5;
              return {x: testM11*u + testM12*v + testDx + 0.5, y: testM21*u + testM22*v + testDy + 0.5};
            });
            const r1 = fullTransform
              ? _solvePtAlign(genRef, srcPts, testAr)
              : _solvePtAlignRigid(genRef, srcPts, testAr, testArT);
            if (r1) {
              const scaleErr = Math.abs(r1.scale - expScale);
              const stretchErr = Math.abs((r1.scaleX_adj || 1) - expStretch);
              const rotErr = Math.abs(r1.rotation - 12);
              const dxErr = Math.abs(r1.x_offset - testDx);
              const dyErr = Math.abs(r1.y_offset - testDy);
              const ok = scaleErr < 0.001 && stretchErr < 0.001 && rotErr < 0.1 && dxErr < 0.001 && dyErr < 0.001;
              console.log("[PtAlign SELF-TEST] " + (ok ? "PASS" : "FAIL") +
                " scale:" + r1.scale.toFixed(4) + "(exp " + expScale.toFixed(4) + ")" +
                " stretch:" + (r1.scaleX_adj || 1).toFixed(4) + "(exp " + expStretch.toFixed(4) + ")" +
                " rot:" + r1.rotation.toFixed(2) +
                "(exp 12) dx:" + r1.x_offset.toFixed(4) + "(exp 0.03) dy:" + r1.y_offset.toFixed(4) + "(exp -0.02)" +
                " residual:" + r1.residual.toFixed(8));
              if (r1._m) console.log("[PtAlign SELF-TEST] rawM: [" + r1._m.map(v=>v.toFixed(6)).join(", ") +
                "] expected: [" + [testM11,testM12,testM21,testM22].map(v=>v.toFixed(6)).join(", ") + "]");
            } else {
              console.log("[PtAlign SELF-TEST] FAIL — solver returned null");
            }
          };
          try { _selfTest(); } catch(e) { console.error("[PtAlign SELF-TEST] Error:", e); }

          // ── Show preview instead of immediately applying ──
          _showPreview(rDx, rDy, rScale, rRotation, rStretch, resPct, pairs, perPoint, rawM, arHW);
        } catch (err) {
          console.error("[PtAlign] Compute error:", err);
          ctx.toast("Compute error: " + String(err), true);
          computeBtn.disabled = false;
          computeBtn.textContent = "Compute (" + pairs + " pairs)";
        }
      };
      toolbar.appendChild(computeBtn);

      // Cancel button
      const cancelBtn = document.createElement("button");
      cancelBtn.style.cssText = "font-size:11px;padding:3px 10px;color:#f87171;background:#1a0808;border:1px solid #7f1d1d;border-radius:4px;cursor:pointer";
      cancelBtn.textContent = "Cancel";
      cancelBtn.onclick = _close;
      toolbar.appendChild(cancelBtn);

      // -- Panels --
      panelsRow.innerHTML = "";

      const _buildPanel = (map, label, color, pts, which) => {
        const panel = document.createElement("div");
        panel.style.cssText = "flex:1;display:flex;flex-direction:column;border:2px solid " + color +
          ";border-radius:8px;overflow:hidden;min-width:200px;background:#071008";

        // Header
        const hdr = document.createElement("div");
        hdr.style.cssText = "padding:6px 10px;background:" + color + "15;display:flex;align-items:center;gap:8px;flex-shrink:0";
        const lbl = document.createElement("span");
        lbl.style.cssText = "font-weight:700;font-size:12px;color:" + color;
        lbl.textContent = label;
        hdr.appendChild(lbl);
        const nm = document.createElement("span");
        nm.style.cssText = "font-size:11px;color:#94a3b8";
        nm.textContent = map.name || map.id;
        hdr.appendChild(nm);
        if (phase === which) {
          const arrow = document.createElement("span");
          arrow.style.cssText = "font-size:10px;color:" + color + ";font-weight:700;border:1px solid " + color + ";padding:1px 6px;border-radius:4px";
          arrow.textContent = "Click here";
          hdr.appendChild(arrow);
        }
        panel.appendChild(hdr);

        // Map stage — BOTH panels use the REFERENCE map's aspect ratio so
        // click coordinates share the same coordinate space for the solver.
        // Images are stretched with object-fit:fill to match.
        // IMPORTANT: width/height are both auto so aspect-ratio controls sizing
        // while max-width/max-height constrain without distortion. If we used
        // width:100% with max-height, the AR would break when max-height clips,
        // producing wrong click coordinates for edge/corner points.
        const stage = document.createElement("div");
        stage.style.cssText = "position:relative;width:auto;height:auto;max-width:100%;" +
          "max-height:calc(100vh - 120px);aspect-ratio:" + _refAR + ";background:#071008";

        // Image — stretched to fill the shared-AR container
        const url = _mapUrl(map);
        if (url) {
          const img = document.createElement("img");
          img.src = url;
          img.style.cssText = "position:absolute;top:0;left:0;width:100%;height:100%;object-fit:fill;display:block;pointer-events:none";
          stage.appendChild(img);
        }

        // Point markers — simple numbered circles using absolutely positioned divs
        for (let i = 0; i < pts.length; i++) {
          const p = pts[i];
          const marker = document.createElement("div");
          marker.style.cssText = "position:absolute;width:20px;height:20px;border-radius:50%;" +
            "background:" + color + "44;border:2px solid " + color + ";display:flex;align-items:center;" +
            "justify-content:center;font-size:10px;font-weight:700;color:" + color + ";pointer-events:none;" +
            "transform:translate(-50%,-50%);left:" + (p.x * 100) + "%;top:" + (p.y * 100) + "%";
          marker.textContent = String(i + 1);
          stage.appendChild(marker);
        }

        // Click catcher — covers the stage exactly
        // Only accepts clicks when this panel matches the current phase.
        // Prevents pair mismatch when user accidentally double-clicks one side.
        const catcher = document.createElement("div");
        catcher.style.cssText = "position:absolute;top:0;left:0;width:100%;height:100%;z-index:5;" +
          (phase === which ? "cursor:crosshair" : "cursor:not-allowed;opacity:0.3");
        catcher.addEventListener("click", (ev) => {
          if (phase !== which) {
            ctx.toast("Click the " + (phase === "ref" ? "Reference" : "Target") + " map (left = ref, right = target)", true);
            return;
          }
          const rect = catcher.getBoundingClientRect();
          if (!rect.width || !rect.height) return;
          const px = (ev.clientX - rect.left) / rect.width;
          const py = (ev.clientY - rect.top) / rect.height;
          if (px < 0 || px > 1 || py < 0 || py > 1) return;
          if (which === "ref") {
            if (refPts.length >= 8) { ctx.toast("Max 8 points"); return; }
            refPts.push({ x: px, y: py });
            phase = "tgt";
          } else {
            if (tgtPts.length >= 8) { ctx.toast("Max 8 points"); return; }
            tgtPts.push({ x: px, y: py });
            phase = "ref";
          }
          _rebuild();
        });
        stage.appendChild(catcher);

        panel.appendChild(stage);
        return panel;
      };

      panelsRow.appendChild(_buildPanel(refMap, "Reference", "#52b788", refPts, "ref"));
      panelsRow.appendChild(_buildPanel(tgtMap, "Target", "#f59e0b", tgtPts, "tgt"));

      // Help text at the bottom of toolbar
      const help = document.createElement("div");
      help.style.cssText = "width:100%;font-size:10px;color:#64748b;margin-top:4px";
      help.textContent = "Click the same real-world point on both maps. Auto-alternates. 3+ pairs required to Compute.";
      toolbar.appendChild(help);
    };

    // ── Shared CSS transform generator ────────────────────────────────────
    // SINGLE source of truth: both preview and Apply/buildStage use this
    // exact string to position the target.  No matrix(), no _m — just the
    // decomposed translate → rotate → scale(sx, sy) that CSS handles natively.
    const _buildTransformCSS = (dx, dy, rot, sc, stretch) => {
      const sx = sc * (stretch || 1);
      return "translate(" + (dx * 100) + "%," + (dy * 100) + "%) rotate(" + rot + "deg) scale(" + sx + "," + sc + ")";
    };

    // Compute where a target-local normalised point ends up after the
    // decomposed CSS transform, in the stage's normalised [0,1]² coords.
    // This lets us place diagnostic dots that MUST visually coincide with
    // the CSS-transformed image pixels — if they don't, the CSS is wrong.
    const _transformPt = (tx, ty, dx, dy, rot, sc, stretch, arHW_) => {
      const sx = sc * (stretch || 1), sy = sc;
      const r = rot * Math.PI / 180;
      const u = tx - 0.5, v = ty - 0.5;
      // CSS pixel-space: rotate(scale(u,v)) then translate, around center.
      // In normalised coords the AR enters via pixel ↔ normalised conversion.
      const su = sx * u, sv = sy * v;
      const rx = Math.cos(r) * su - Math.sin(r) * sv * arHW_;
      const ry = Math.sin(r) * su / arHW_ + Math.cos(r) * sv;
      return [rx + 0.5 + dx, ry + 0.5 + dy];
    };

    // ── Preview screen — shows the computed alignment before applying ──────
    const _showPreview = (rDx, rDy, rScale, rRotation, rStretch, resPct, pairs, perPoint, rawM, arHW) => {
      // Replace the point-picking UI with a preview of the result
      toolbar.innerHTML = "";
      panelsRow.innerHTML = "";

      // Build the CSS string — SAME formula used by Apply and buildStage
      const cssTransform = _buildTransformCSS(rDx, rDy, rRotation, rScale, rStretch);
      console.log("[PtAlign Preview] CSS: " + cssTransform);

      // -- Toolbar: result summary + Apply/Discard buttons --
      const title = document.createElement("span");
      title.style.cssText = "font-weight:700;font-size:14px;color:#7dd3fc";
      title.textContent = "Preview";
      toolbar.appendChild(title);

      const stats = document.createElement("span");
      stats.style.cssText = "font-size:11px;color:#94a3b8";
      stats.textContent = pairs + " pairs | residual " + resPct + "% | scale " +
        rScale.toFixed(3) + " | rot " + rRotation.toFixed(1) + "\u00b0" +
        (Math.abs(rStretch - 1.0) > 0.005 ? " | stretch " + Math.round(rStretch * 100) + "%" : "");
      toolbar.appendChild(stats);

      // Residual quality badge
      const qBadge = document.createElement("span");
      const qColor = resPct < 2 ? "#52b788" : resPct < 5 ? "#f59e0b" : "#f87171";
      const qLabel = resPct < 2 ? "Excellent" : resPct < 5 ? "Fair" : "Poor";
      qBadge.style.cssText = "font-size:10px;padding:2px 8px;border-radius:4px;background:" + qColor + "22;color:" + qColor + ";border:1px solid " + qColor + "44";
      qBadge.textContent = qLabel;
      toolbar.appendChild(qBadge);

      const spacer = document.createElement("div");
      spacer.style.cssText = "flex:1";
      toolbar.appendChild(spacer);

      // Back button — go back to point placement
      const backBtn = document.createElement("button");
      backBtn.style.cssText = "font-size:11px;padding:3px 12px;color:#e2e8f0;background:#162016;border:1px solid #2d5a2d;border-radius:4px;cursor:pointer";
      backBtn.textContent = "Back";
      backBtn.onclick = () => _rebuild();
      toolbar.appendChild(backBtn);

      // Apply button — stores ONLY decomposed values (same ones used for CSS above)
      const applyBtn = document.createElement("button");
      applyBtn.style.cssText = "font-size:12px;padding:4px 16px;font-weight:600;border-radius:4px;cursor:pointer;" +
        "border:1px solid #52b788;background:#1b4a2e;color:#e2e8f0";
      applyBtn.textContent = bake ? "Bake & Apply" : "Apply";
      applyBtn.onclick = () => {
        if (bake && tgtMap.image && tgtMap.image.filename) {
          // A BAKE puts the whole align into the PIXELS, so what is left for
          // the placement is a translation. The backend composes the baked op
          // into the record itself (`pixel_op` below → async_recompute_
          // transform_for_map), so nothing is written here: the record it
          // computes is the answer and a second one written from the panel
          // would be the second copy this release deletes.
          _close();
          buildStage();
          const bakeImg = new Image();
          bakeImg.crossOrigin = "anonymous";
          bakeImg.onload = () => {
            try {
              const ow = bakeImg.naturalWidth, oh = bakeImg.naturalHeight;
              const rad = rRotation * Math.PI / 180;
              const cosA = Math.abs(Math.cos(rad)), sinA = Math.abs(Math.sin(rad));
              // bsx != bsy whenever the two pictures are different shapes: an
              // align across shapes IS an anisotropic pixel stretch, and the
              // baked PNG has to carry it or the image comes out the wrong
              // shape (issue #62).  A ROTATED bake used to drop the map's
              // metric transform here — a general affine, which the
              // five-field record could not hold — and the toast below asked
              // for a re-measure.  The record carries σ now, so model_store
              // composes it instead and the map stays measured; the toast is
              // still wired for the ops that genuinely cannot be composed.
              const bsx = rScale * rStretch, bsy = rScale;
              const nw = Math.ceil(ow * bsx * cosA + oh * bsy * sinA);
              const nh = Math.ceil(ow * bsx * sinA + oh * bsy * cosA);
              const canvas = document.createElement("canvas");
              canvas.width = nw; canvas.height = nh;
              const cc = canvas.getContext("2d");
              cc.translate(nw / 2, nh / 2); cc.rotate(rad); cc.scale(bsx, bsy);
              cc.drawImage(bakeImg, -ow / 2, -oh / 2);
              const b64 = canvas.toDataURL("image/png").split(",")[1];
              ctx.actions.mapsReplaceImage({
                map_id: tgtMap.id, png_base64: b64, width: nw, height: nh,
                pixel_op: { deg: rRotation, sx: bsx, sy: bsy },
              })
                .then((res) => {
                  if(res && res.scale_invalidated){
                    ctx.toast("Baked, but the map scale could not survive rotation + stretch — re-measure the map.", true);
                  } else {
                    ctx.toast("Baked (" + pairs + " pairs, residual " + resPct + "%)");
                  }
                })
                .catch(e => ctx.toast("Bake upload failed: " + e, true));
            } catch (de) { ctx.toast("Bake draw failed: " + de, true); }
          };
          bakeImg.onerror = () => ctx.toast("Bake failed — image load error", true);
          bakeImg.src = _mapUrl(tgtMap);
        } else {
          // ── Compose the solve with the reference's PLACEMENT ──
          //
          // The solver maps target fraction → reference fraction. Where a
          // reference fraction IS, in metres, is the reference's record. So
          // the target's placement is that composition, read off its two
          // metre columns — one decomposition, the one `placementFromColumns`
          // performs, mirroring the backend's.
          //
          // It composed two WORLD AFFINES and wrote back stack fields plus a
          // matrix plus a decomposition: three descriptions of one placement,
          // written together and updated apart. `worldAffine`,
          // `composeAffine`, `invertAffine`, `decomposeFracMatrix` and
          // `stackFieldsFromAffine` existed only to keep those three in step
          // and are all deleted.
          const refP = _placeOf(refMap.id);
          if (!refP) { ctx.toast("The reference map has no placement — measure it first.", true); return; }
          const toRefFrac = (u, v) => [
            rawM[0]*(u-0.5) + rawM[1]*(v-0.5) + 0.5 + rDx,
            rawM[2]*(u-0.5) + rawM[3]*(v-0.5) + 0.5 + rDy,
          ];
          const atM = (u, v) => { const f = toRefFrac(u, v); return mapFracToMetres(refP, f[0], f[1]); };
          const o = atM(0, 0), ex = atM(1, 0), ey = atM(0, 1);
          const solved = (o && ex && ey) ? placementFromColumns(
            o, [ex[0]-o[0], ex[1]-o[1]], [ey[0]-o[0], ey[1]-o[1]]) : null;
          if (!solved) { ctx.toast("That align is singular — the points are collinear.", true); return; }
          alignState.place = solved;
          if (ctx.actions.telemetryEvent) ctx.actions.telemetryEvent("point_align_applied");
          _close();
          buildStage();
          ctx.toast("Aligned (" + pairs + " pairs, residual " + resPct + "%)");
        }
      };
      toolbar.appendChild(applyBtn);

      // Discard button
      const discardBtn = document.createElement("button");
      discardBtn.style.cssText = "font-size:11px;padding:3px 10px;color:#f87171;background:#1a0808;border:1px solid #7f1d1d;border-radius:4px;cursor:pointer";
      discardBtn.textContent = "Discard";
      discardBtn.onclick = _close;
      toolbar.appendChild(discardBtn);

      // -- Preview panel: both maps overlaid with the computed transform --
      const previewPanel = document.createElement("div");
      previewPanel.style.cssText = "flex:1;display:flex;flex-direction:column;align-items:center;" +
        "padding:16px;overflow:auto;min-height:0";

      const previewStage = document.createElement("div");
      previewStage.style.cssText = "position:relative;width:100%;max-width:500px;aspect-ratio:" + _refAR +
        ";background:#071008;border:2px solid #1e4976;border-radius:8px;overflow:visible";

      // Reference map layer (bottom) — shown FLAT
      const refUrl = _mapUrl(refMap);
      if (refUrl) {
        const ri = document.createElement("img");
        ri.src = refUrl;
        ri.style.cssText = "position:absolute;top:0;left:0;width:100%;height:100%;object-fit:fill;display:block;pointer-events:none;opacity:0.6";
        previewStage.appendChild(ri);
      }
      const refLabel = document.createElement("div");
      refLabel.style.cssText = "position:absolute;top:4px;left:6px;font-size:10px;color:#52b788;font-weight:700;z-index:3;background:#071008aa;padding:1px 6px;border-radius:3px";
      refLabel.textContent = "Ref: " + (refMap.name || refMap.id);
      previewStage.appendChild(refLabel);

      // Target map layer — uses THE SAME decomposed CSS as Apply/buildStage
      const tgtUrl = _mapUrl(tgtMap);
      if (tgtUrl) {
        const tgtLayer = document.createElement("div");
        tgtLayer.style.cssText = "position:absolute;top:0;left:0;width:100%;height:100%;" +
          "transform-origin:50% 50%;opacity:0.55;pointer-events:none";
        tgtLayer.style.transform = cssTransform;
        const ti = document.createElement("img");
        ti.src = tgtUrl;
        ti.style.cssText = "position:absolute;top:0;left:0;width:100%;height:100%;object-fit:fill;display:block";
        tgtLayer.appendChild(ti);
        previewStage.appendChild(tgtLayer);
      }
      const tgtLabel = document.createElement("div");
      tgtLabel.style.cssText = "position:absolute;top:4px;right:6px;font-size:10px;color:#f59e0b;font-weight:700;z-index:3;background:#071008aa;padding:1px 6px;border-radius:3px";
      tgtLabel.textContent = "Tgt: " + (tgtMap.name || tgtMap.id);
      previewStage.appendChild(tgtLabel);

      // Diagnostic markers on the FLAT reference layer (no transform on this div)
      const markerLayer = document.createElement("div");
      markerLayer.style.cssText = "position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:5";
      for (const pp of (perPoint || [])) {
        // Reference point (green circle) — where the point should be
        const refDot = document.createElement("div");
        refDot.style.cssText = "position:absolute;width:14px;height:14px;border-radius:50%;border:2px solid #52b788;" +
          "background:#52b78844;transform:translate(-50%,-50%);font-size:8px;color:#52b788;text-align:center;line-height:10px;" +
          "left:" + (pp.refX * 100) + "%;top:" + (pp.refY * 100) + "%";
        refDot.textContent = String(pp.idx);
        refDot.title = "Ref " + pp.idx + " (" + pp.refX.toFixed(3) + "," + pp.refY.toFixed(3) + ")";
        markerLayer.appendChild(refDot);

        // Predicted position via DECOMPOSED transform (yellow) — should overlap green
        const [predXd, predYd] = _transformPt(
          tgtPts[pp.idx - 1].x, tgtPts[pp.idx - 1].y,
          rDx, rDy, rRotation, rScale, rStretch, arHW);
        const predDot = document.createElement("div");
        predDot.style.cssText = "position:absolute;width:14px;height:14px;border-radius:50%;border:2px solid #f59e0b;" +
          "background:#f59e0b44;transform:translate(-50%,-50%);font-size:8px;color:#f59e0b;text-align:center;line-height:10px;" +
          "left:" + (predXd * 100) + "%;top:" + (predYd * 100) + "%";
        predDot.textContent = String(pp.idx);
        predDot.title = "Decomposed pred " + pp.idx + " (" + predXd.toFixed(3) + "," + predYd.toFixed(3) + ")";
        markerLayer.appendChild(predDot);
      }

      // Target corner markers — four cyan dots showing exactly where the CSS places
      // the target's corners.  These MUST visually coincide with the transformed
      // target image's corners; if they don't, we have a CSS rendering mismatch.
      for (const [cx, cy, label] of [[0,0,"TL"],[1,0,"TR"],[1,1,"BR"],[0,1,"BL"]]) {
        const [wx, wy] = _transformPt(cx, cy, rDx, rDy, rRotation, rScale, rStretch, arHW);
        const cd = document.createElement("div");
        cd.style.cssText = "position:absolute;width:10px;height:10px;border-radius:50%;background:#0ff;border:1px solid #088;" +
          "transform:translate(-50%,-50%);z-index:6;opacity:0.8;left:" + (wx * 100) + "%;top:" + (wy * 100) + "%";
        cd.title = "Tgt " + label + " (" + wx.toFixed(3) + "," + wy.toFixed(3) + ")";
        markerLayer.appendChild(cd);
      }
      previewStage.appendChild(markerLayer);

      previewPanel.appendChild(previewStage);

      // ── Canvas verification — draws the transform using Canvas 2D API ──
      // This COMPLETELY bypasses CSS transforms.  If the canvas looks right
      // but the CSS overlay doesn't, the bug is in CSS.  If the canvas is
      // ALSO wrong, the solver math has a bug.
      const canvasTitle = document.createElement("div");
      canvasTitle.style.cssText = "margin-top:12px;font-size:11px;color:#64748b;text-align:center";
      canvasTitle.textContent = "Canvas verification (no CSS transforms):";
      previewPanel.appendChild(canvasTitle);

      const cvs = document.createElement("canvas");
      const cvsW = 600, cvsH = Math.round(600 * arHW);
      cvs.width = cvsW; cvs.height = cvsH;
      cvs.style.cssText = "border:1px solid #1e4976;border-radius:4px;max-width:100%";
      previewPanel.appendChild(cvs);

      // Load both images and draw
      const refImg = new Image(); refImg.crossOrigin = "anonymous";
      const tgtImg = new Image(); tgtImg.crossOrigin = "anonymous";
      let refLoaded = false, tgtLoaded = false;
      const _drawCanvas = () => {
        if (!refLoaded || !tgtLoaded) return;
        const cc = cvs.getContext("2d");
        // Reference image: fill canvas
        cc.globalAlpha = 0.6;
        cc.drawImage(refImg, 0, 0, cvsW, cvsH);
        // Target image: apply transform using Canvas 2D API
        cc.globalAlpha = 0.5;
        cc.save();
        const cxP = cvsW / 2, cyP = cvsH / 2;
        // translate(dx, dy) — in pixel space
        cc.translate(rDx * cvsW, rDy * cvsH);
        // Now rotate + scale around center
        cc.translate(cxP, cyP);
        cc.rotate(rRotation * Math.PI / 180);
        cc.scale(rScale * rStretch, rScale);
        cc.translate(-cxP, -cyP);
        cc.drawImage(tgtImg, 0, 0, cvsW, cvsH);
        cc.restore();
        // Draw ref points (green circles)
        cc.globalAlpha = 1.0;
        for (let i = 0; i < (perPoint || []).length; i++) {
          const pp = perPoint[i];
          cc.beginPath();
          cc.arc(pp.refX * cvsW, pp.refY * cvsH, 6, 0, 2 * Math.PI);
          cc.strokeStyle = "#52b788"; cc.lineWidth = 2; cc.stroke();
          cc.fillStyle = "#52b78866"; cc.fill();
        }
        // Draw predicted tgt positions (yellow circles) — via decomposed math
        for (let i = 0; i < (perPoint || []).length; i++) {
          const pp = perPoint[i];
          const [predXd, predYd] = _transformPt(
            tgtPts[pp.idx - 1].x, tgtPts[pp.idx - 1].y,
            rDx, rDy, rRotation, rScale, rStretch, arHW);
          cc.beginPath();
          cc.arc(predXd * cvsW, predYd * cvsH, 4, 0, 2 * Math.PI);
          cc.strokeStyle = "#f59e0b"; cc.lineWidth = 2; cc.stroke();
          cc.fillStyle = "#f59e0b66"; cc.fill();
        }
        console.log("[PtAlign Canvas] drawn. cvsW=" + cvsW + " cvsH=" + cvsH +
          " arHW=" + arHW.toFixed(4) + " dx=" + rDx + " dy=" + rDy +
          " rot=" + rRotation + " scale=" + rScale + " stretch=" + rStretch);
      };
      refImg.onload = () => { refLoaded = true; _drawCanvas(); };
      tgtImg.onload = () => { tgtLoaded = true; _drawCanvas(); };
      if (_mapUrl(refMap)) refImg.src = _mapUrl(refMap);
      if (_mapUrl(tgtMap)) tgtImg.src = _mapUrl(tgtMap);

      // Zoom controls
      let pvMaxW = 500;
      const zoomRow = document.createElement("div");
      zoomRow.style.cssText = "margin-top:6px;display:flex;gap:6px;justify-content:center;align-items:center";
      const _pvZoomBtn = (label, fn) => {
        const b = document.createElement("button");
        b.style.cssText = "font-size:11px;padding:2px 10px;color:#e2e8f0;background:#162016;border:1px solid #2d5a2d;border-radius:4px;cursor:pointer";
        b.textContent = label;
        b.onclick = fn;
        return b;
      };
      zoomRow.appendChild(_pvZoomBtn("Zoom \u2212", () => {
        pvMaxW = Math.max(300, pvMaxW - 200);
        previewStage.style.maxWidth = pvMaxW + "px";
      }));
      zoomRow.appendChild(_pvZoomBtn("Fit", () => {
        pvMaxW = 500;
        previewStage.style.maxWidth = "500px";
      }));
      zoomRow.appendChild(_pvZoomBtn("Zoom +", () => {
        pvMaxW = Math.min(3000, pvMaxW + 300);
        previewStage.style.maxWidth = pvMaxW + "px";
      }));
      previewPanel.appendChild(zoomRow);

      // Parameter readout below preview
      const readout = document.createElement("div");
      readout.style.cssText = "margin-top:8px;font-size:11px;color:#64748b;text-align:center;font-family:monospace";
      readout.textContent = "X:" + rDx.toFixed(4) + "  Y:" + rDy.toFixed(4) +
        "  Scale:" + rScale.toFixed(4) + "  Rot:" + rRotation.toFixed(1) + "\u00b0" +
        (Math.abs(rStretch - 1.0) > 0.005 ? "  Stretch:" + rStretch.toFixed(4) : "") +
        "  | CSS: " + cssTransform;
      previewPanel.appendChild(readout);

      // Per-point residual breakdown
      if (perPoint && perPoint.length) {
        const ppDiv = document.createElement("div");
        ppDiv.style.cssText = "margin-top:6px;display:flex;gap:6px;flex-wrap:wrap;justify-content:center";
        for (const pp of perPoint) {
          const ppColor = pp.pct < 1 ? "#52b788" : pp.pct < 3 ? "#f59e0b" : "#f87171";
          const chip = document.createElement("span");
          chip.style.cssText = "font-size:10px;padding:2px 6px;border-radius:3px;font-family:monospace;" +
            "background:" + ppColor + "18;color:" + ppColor + ";border:1px solid " + ppColor + "44";
          chip.textContent = "Pt " + pp.idx + ": " + pp.pct.toFixed(1) + "%";
          chip.title = "Point pair " + pp.idx + " — distance " + pp.dist.toFixed(4) + " (lower = better fit)";
          ppDiv.appendChild(chip);
        }
        previewPanel.appendChild(ppDiv);
        const worstPt = perPoint.reduce((a, b) => b.pct > a.pct ? b : a, perPoint[0]);
        if (worstPt.pct > 3) {
          const tip = document.createElement("div");
          tip.style.cssText = "margin-top:4px;font-size:10px;color:#f59e0b;text-align:center";
          tip.textContent = "Point " + worstPt.idx + " has high error (" + worstPt.pct.toFixed(1) + "%). Consider going Back and re-placing it.";
          previewPanel.appendChild(tip);
        }
      }

      panelsRow.appendChild(previewPanel);
    };

    // Assemble modal and render
    overlay.appendChild(toolbar);
    overlay.appendChild(panelsRow);
    _rebuild();

    // Escape key closes modal
    const _onKey = (e) => { if (e.key === "Escape") { _close(); document.removeEventListener("keydown", _onKey); } };
    document.addEventListener("keydown", _onKey);

    // Attach to the nearest shadow root (HA custom panel) or body as fallback
    const root = card.getRootNode();
    if (root && root !== document) {
      root.appendChild(overlay);
    } else {
      document.body.appendChild(overlay);
    }
  };

  // Point Align button — opens the modal overlay
  const ptAlignBtn = el("button",{class:"btn inline",style:"background:#0a1a2a;border-color:#1e4976;color:#7dd3fc;font-size:11px;padding:3px 12px", onclick: _openPointAlignModal}, "Point Align");
  alignHdrRow.appendChild(ptAlignBtn);

  // Conflict warning div (created early so save/tie-in closures can reference it)
  const warnDiv = el("div",{style:"display:none;margin-top:12px;padding:12px;border-radius:8px;background:#1a0d00;border:1px solid #d97706;font-size:12px"});

  // Tie-in list div
  const tieInListDiv = el("div",{style:"margin-top:6px"});

  // THE COMMIT. One call, and it can refuse.
  //
  // An align used to be a "cosmetic" stack write that the metre record could
  // not see; it is a placement, so it goes through `fabric_map_reanchor` —
  // the one writer that preflights the calibration pins and writes NOTHING
  // if the new placement would strand most of them off the map. That guard
  // was written for a deliberate re-anchor and it is correct here for the
  // same reason: this is a Save button, not a mouseup. The drag moves
  // nothing on disk, so a writer that can decline never meets a live gesture,
  // and the decline arrives as a sentence the owner can act on instead of a
  // map that silently snaps back.
  //
  // `ref_map_id` is still recorded. It is provenance — what this map was
  // aligned against — and nothing reads it for geometry.
  const performSave = async (override) => {
    const tId = alignState.targetId || tgtSel.value;
    const tM  = (ctx.state.maps.list||[]).find(m=>m.id===tId) || maps.find(m=>m.id===tId);
    if(!tM) throw new Error("No target map selected");
    const place = override || alignState.place;
    if(!place) throw new Error("This map is not placed yet — press Reset to start it on the reference.");
    try {
      await ctx.actions.callWS({
        type: "padspan_ha/fabric_map_reanchor", map_id: tM.id,
        origin_x_m: place.origin_x_m, origin_y_m: place.origin_y_m,
        scale_x_m: place.scale_x_m, scale_y_m: place.scale_y_m,
        rotation_rad: place.rotation_rad, shear_rad: place.shear_rad,
      });
      if (ctx.actions.telemetryEvent) ctx.actions.telemetryEvent("map_placement_committed");
    } catch(e) {
      if (ctx.actions.telemetryEvent) ctx.actions.telemetryEvent("map_placement_refused");
      throw e;
    }
    const rId = alignState.refId || refSel.value;
    if(rId && rId !== tM.id && (tM.stack||{}).ref_map_id !== rId){
      await ctx.actions.mapsUpdateQuiet({ map_id: tM.id, stack: _stackPatch(tM.stack, { ref_map_id: rId }) });
    }
    alignState.place = { ...place };
    await ctx.actions.modelRefresh();
    warnDiv.style.display = "none";
  };

  // Render tie-in chips below ctrlRow
  const renderTieIns = () => {
    tieInListDiv.innerHTML = "";
    const tId2 = alignState.targetId || tgtSel.value;
    const tM2  = (ctx.state.maps.list||[]).find(m=>m.id===tId2) || maps.find(m=>m.id===tId2);
    const tieIns2 = (tM2?.stack?.tie_ins)||[];
    if(!tieIns2.length) return;
    const allM2 = ctx.state.maps.list||maps;
    const row2 = el("div",{style:"display:flex;gap:6px;flex-wrap:wrap;align-items:center"});
    row2.appendChild(el("span",{style:"font-size:11px;color:#64748b;white-space:nowrap"},"Tie-ins:"));
    for(const ti of tieIns2){
      const rM3 = allM2.find(m=>m.id===ti.ref_map_id);
      const rN  = rM3 ? (rM3.name||rM3.id) : (ti.ref_map_id||"?");
      const chip = el("span",{style:"display:inline-flex;align-items:center;gap:4px;padding:2px 8px;background:#0a2a1a;border:1px solid #2d6a4f;border-radius:12px;font-size:11px;color:#52b788"});
      chip.appendChild(document.createTextNode("Tied: "+rN));
      const delX = el("button",{style:"background:none;border:none;color:#64748b;cursor:pointer;font-size:11px;padding:0 0 0 4px;line-height:1",
        onclick: async(ev3)=>{
          ev3.stopPropagation();
          const tId3 = alignState.targetId || tgtSel.value;
          const tM3  = (ctx.state.maps.list||[]).find(m=>m.id===tId3) || maps.find(m=>m.id===tId3);
          if(!tM3) return;
          const newTIs = ((tM3?.stack?.tie_ins)||[]).filter(t=>t.ref_map_id !== ti.ref_map_id);
          const newStk3 = _stackPatch(tM3.stack, { tie_ins: newTIs });
          try {
            await ctx.actions.mapsUpdateQuiet({ map_id: tM3.id, stack: newStk3 });
            ctx.toast("Tie-in removed");
            renderTieIns();
          } catch(e3){ ctx.toast("Failed: "+String(e3), true); }
        }},"×");
      chip.appendChild(delX);
      row2.appendChild(chip);
    }
    tieInListDiv.appendChild(row2);
  };

  // Save alignment — checks stored tie-ins and lists downstream dependents.
  //
  // The three thresholds are METRES now, not a weighted blend of "% offset",
  // "% scale" and "degrees". They were three different units summed into one
  // percentage, and none of them could see a mirror or a lean — so a map the
  // tie-in put on the other side of the house scored zero and saved silently.
  const saveAlignBtn = el("button",{class:"btn inline", onclick: async (ev)=>{
    const btn = ev.currentTarget;
    const tId = alignState.targetId || tgtSel.value;
    const tM  = (ctx.state.maps.list||[]).find(m=>m.id===tId) || maps.find(m=>m.id===tId);
    if(!tM){ ctx.toast("No target map selected.", true); return; }
    if(!alignState.place){ ctx.toast("This map is not placed yet — press Reset to start it on the reference.", true); return; }
    const allM = ctx.state.maps.list||maps;
    const escN = s => String(s||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");

    const conflicts = _checkAlignConflicts(alignState.place, tM, allM);
    // Downstream: other maps that have a tie-in pointing TO this map
    const downstream = allM.filter(m =>
      m.id !== tM.id && (m.stack?.tie_ins||[]).some(ti => ti.ref_map_id === tM.id)
    );
    const downstreamNames = downstream.map(m => m.name||m.id);
    const _run = async (place, label) => {
      btn.disabled = true; btn.textContent = "Saving…";
      try {
        await performSave(place);
        ctx.toast(downstreamNames.length
          ? `Alignment saved ✔${label}\n↳ Downstream maps may need re-checking: ${downstreamNames.join(", ")}`
          : `Alignment saved ✔${label}`);
      }
      catch(e){ ctx.toast("Save failed: "+(e?.message||String(e)), true); }
      finally { try{ btn.disabled=false; btn.textContent="Save Alignment"; }catch(_){} }
    };

    if(!conflicts.length){ await _run(null, ""); return; }
    // Everything within a metre of every tie-in: average silently.
    if(conflicts.every(c=>c.gapM < TIE_MINOR_M)){
      const avg = _averageAlignWithTieIns(alignState.place, (tM?.stack?.tie_ins)||[]);
      await _run(avg, " (minor variance averaged with tie-ins)");
      return;
    }
    const hasModerate = conflicts.some(c=>c.gapM < TIE_MAJOR_M);
    let html = `<div style="font-weight:600;color:#f59e0b;margin-bottom:8px">⚠ Alignment Conflicts Detected</div>`;
    html += `<div style="color:#cbd5e1;margin-bottom:8px;font-size:11px">This position differs from stored tie-in relationships for <strong>${escN(tM.name||tM.id)}</strong>:</div>`;
    html += `<ul style="margin:0 0 10px 14px;padding:0;color:#94a3b8;font-size:11px">`;
    for(const c of conflicts){
      const sev = c.gapM >= TIE_MAJOR_M ? "color:#f87171" : "color:#fbbf24";
      html += `<li style="margin-bottom:3px">Tied to <strong style="color:#e2e8f0">"${escN(c.refName)}"</strong>: `
        + `<span style="${sev}">${c.gapM.toFixed(2)} m from where that tie-in puts this map</span></li>`;
    }
    html += `</ul>`;
    if(downstreamNames.length){
      html += `<div style="margin-bottom:10px;padding:7px 10px;border-radius:6px;background:#0a1a2a;border:1px solid #2563eb;font-size:11px;color:#93c5fd">`;
      html += `<strong>↓ Downstream maps tied to "${escN(tM.name||tM.id)}":</strong> `;
      html += downstreamNames.map(n=>`<strong>${escN(n)}</strong>`).join(", ");
      html += `<div style="color:#64748b;margin-top:3px">Moving this map will invalidate their tie-in constraints. Re-check and update them after saving.</div>`;
      html += `</div>`;
    }
    html += `<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">`;
    if(hasModerate) html += `<button id="_wAvgBtn" class="btn inline" style="background:#0a2a1a;border-color:#52b788">Average &amp; Save</button>`;
    html += `<button id="_wOvrBtn" class="btn inline" style="background:#7f1d1d;border-color:#dc2626">Override &amp; Save</button>`;
    html += `<button id="_wCxlBtn" class="btn inline">Cancel</button>`;
    html += `</div>`;
    warnDiv.innerHTML = html;
    warnDiv.style.display = "block";
    warnDiv.querySelector("#_wOvrBtn").onclick = async()=>{
      warnDiv.style.display="none";
      await _run(null, " (override)");
    };
    const avgBtn = warnDiv.querySelector("#_wAvgBtn");
    if(avgBtn) avgBtn.onclick = async()=>{
      warnDiv.style.display="none";
      const avg = _averageAlignWithTieIns(alignState.place, (tM?.stack?.tie_ins)||[]);
      await _run(avg, " (averaged with tie-ins)");
    };
    warnDiv.querySelector("#_wCxlBtn").onclick = ()=>{ warnDiv.style.display="none"; };
  }},"Save Alignment");
  ctrlRow.appendChild(saveAlignBtn);

  // ── Add Tie-in Button ──
  // A tie-in records the PLACEMENT this map had when it was checked against a
  // particular reference, plus a date. Several of them from different
  // references make a constraint network, and a later Save that disagrees
  // with them is either averaged (within a metre) or warned about.
  const addTieInBtn = el("button",{class:"btn inline",style:"margin-left:4px;background:#0a2a1a;border-color:#2d6a4f",
    onclick: async()=>{
      const tId = alignState.targetId || tgtSel.value;
      const tM  = (ctx.state.maps.list||[]).find(m=>m.id===tId) || maps.find(m=>m.id===tId);
      if(!tM){ ctx.toast("No target map selected.", true); return; }
      if(!alignState.place){ ctx.toast("This map is not placed yet — nothing to tie.", true); return; }
      const rId = alignState.refId || refSel.value;
      const existing = (tM?.stack?.tie_ins)||[];
      // Replace any existing tie-in for the same ref
      const filtered = existing.filter(ti=>ti.ref_map_id !== rId);
      const newTieIns = [...filtered, {
        ref_map_id: rId,
        date: new Date().toISOString().slice(0,10),
        ...alignState.place,
      }];
      const newStk = _stackPatch(tM.stack, { tie_ins: newTieIns });
      try {
        await ctx.actions.mapsUpdateQuiet({ map_id: tM.id, stack: newStk });
        ctx.toast("Tie-in added ✔");
        renderTieIns();
      } catch(e){ ctx.toast("Failed: "+String(e), true); }
    }},"+ Tie-in");
  ctrlRow.appendChild(addTieInBtn);

  card.appendChild(ctrlRow);
  card.appendChild(warnDiv);
  card.appendChild(tieInListDiv);
  renderTieIns();

  // ── Emergency Tie-in Recovery ──────────────────────────────────────────────
  const recovDetailPanel = el("div",{style:"display:none;margin-top:8px;padding:12px;border-radius:8px;background:#140800;border:1px solid #7f1d1d;font-size:12px"});
  const recovBtn = el("button",{class:"btn inline",
    style:"margin-top:10px;background:#1a0800;border-color:#7f1d1d;color:#fca5a5",
    onclick: ()=>{
      const allM = ctx.state.maps.list||maps;
      const plans = _emergencyRecoverTieIns(allM, ctx.state.model);
      if(!plans.length){
        recovDetailPanel.style.display = "none";
        ctx.toast("No inconsistent tie-ins found — network looks healthy ✔");
        return;
      }
      const escR = s => String(s||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
      const totalRemoved = plans.reduce((s,p)=>s+p.removedTieIns.length, 0);
      let html = `<div style="font-weight:600;color:#f87171;margin-bottom:8px">🚑 Emergency Tie-in Recovery</div>`;
      html += `<div style="color:#cbd5e1;margin-bottom:10px;font-size:11px">Found <strong>${totalRemoved}</strong> inconsistent tie-in${totalRemoved>1?"s":""} across <strong>${plans.length}</strong> map${plans.length>1?"s":""}. Only the most consistent cluster will be kept.</div>`;
      html += `<div style="margin-bottom:10px">`;
      for(const p of plans){
        const mapName = escR(p.map.name||p.map.id);
        html += `<div style="padding:7px 0;border-bottom:1px solid #2a1000">`;
        html += `<div style="color:#e2e8f0;font-weight:600">${mapName}</div>`;
        html += `<div style="color:#94a3b8;font-size:11px;margin-top:2px">${p.reason}</div>`;
        if(p.removedTieIns.length){
          const rmN = p.removedTieIns.map(ti=>{ const rm=allM.find(x=>x.id===ti.ref_map_id); return `"${escR(rm?rm.name||rm.id:ti.ref_map_id||"?")}"`;});
          html += `<div style="color:#f87171;font-size:11px;margin-top:2px">✕ Remove: ${rmN.join(", ")}</div>`;
        }
        if(p.keptTieIns.length){
          const kpN = p.keptTieIns.map(ti=>{ const km=allM.find(x=>x.id===ti.ref_map_id); return `"${escR(km?km.name||km.id:ti.ref_map_id||"?")}"`;});
          html += `<div style="color:#52b788;font-size:11px;margin-top:2px">✔ Keep: ${kpN.join(", ")}</div>`;
        } else {
          html += `<div style="color:#f59e0b;font-size:11px;margin-top:2px">All tie-ins removed (all conflict with saved position)</div>`;
        }
        html += `</div>`;
      }
      html += `</div>`;
      html += `<div style="display:flex;gap:8px;align-items:center">`;
      html += `<button id="_rConfBtn" class="btn inline" style="background:#7f1d1d;border-color:#dc2626">Confirm Recovery</button>`;
      html += `<button id="_rCxlBtn" class="btn inline">Cancel</button>`;
      html += `</div>`;
      recovDetailPanel.innerHTML = html;
      recovDetailPanel.style.display = "block";
      recovDetailPanel.querySelector("#_rCxlBtn").onclick = ()=>{ recovDetailPanel.style.display="none"; };
      recovDetailPanel.querySelector("#_rConfBtn").onclick = async ()=>{
        const confBtn = recovDetailPanel.querySelector("#_rConfBtn");
        confBtn.disabled=true; confBtn.textContent="Recovering…";
        try{
          for(const p of plans){
            const freshMap = (ctx.state.maps.list||maps).find(m=>m.id===p.map.id)||p.map;
            await ctx.actions.mapsUpdateQuiet({ map_id: freshMap.id, stack: _stackPatch(freshMap.stack, { tie_ins: p.keptTieIns }) });
          }
          recovDetailPanel.style.display="none";
          renderTieIns();
          ctx.toast(`Recovery complete ✔ — removed ${totalRemoved} outlier tie-in${totalRemoved>1?"s":""}`);
        } catch(e){
          ctx.toast("Recovery failed: "+String(e), true);
          try{ confBtn.disabled=false; confBtn.textContent="Confirm Recovery"; }catch(_){}
        }
      };
    }}, "🚑 Emergency Recovery");
  card.appendChild(recovBtn);
  card.appendChild(recovDetailPanel);

  // ── Section 3: 3D Isometric Preview ───────────────────────────────────────
  card.appendChild(el("div",{class:"muted",style:"margin-top:24px;font-size:13px;font-weight:600"},"3D Isometric Preview"));
  card.appendChild(el("div",{class:"muted",style:"font-size:12px;margin-top:2px"},"Shows all uploaded floor plans stacked by their assigned level. Use the slider to focus on one floor."));

  // Floor focus slider
  if(ctx.state.maps._stackIsoFocus  === undefined) ctx.state.maps._stackIsoFocus  = ctx.state.settings?.maps_iso_focus  ?? null;
  if(ctx.state.maps._stackFloorGap  === undefined) ctx.state.maps._stackFloorGap  = ctx.state.settings?.maps_iso_floor_gap ?? 200;
  if(ctx.state.maps._stackHorizGap  === undefined) ctx.state.maps._stackHorizGap  = ctx.state.settings?.maps_iso_horiz_gap ?? 0;
  const sortedIsoLevels = [...new Set(maps.map(m=>m.stack?.z_level||0))].sort((a,b)=>a-b);
  const focusLbl = el("span",{style:"font-size:12px;color:#94a3b8;min-width:80px;display:inline-block"}, "All floors");
  const focusSlider = document.createElement("input");
  focusSlider.type = "range"; focusSlider.min = "0"; focusSlider.max = String(sortedIsoLevels.length);
  focusSlider.style.cssText = "width:130px;accent-color:#52b788;vertical-align:middle;cursor:pointer";
  focusSlider.value = ctx.state.maps._stackIsoFocus === null ? "0"
    : String(sortedIsoLevels.indexOf(ctx.state.maps._stackIsoFocus) + 1);

  // Layer spacing slider
  const gapLbl = el("span",{style:"font-size:12px;color:#94a3b8;min-width:36px;display:inline-block;text-align:right"},
    String(ctx.state.maps._stackFloorGap));
  const gapSlider = document.createElement("input");
  gapSlider.type = "range"; gapSlider.min = "60"; gapSlider.max = "340"; gapSlider.step = "10";
  gapSlider.style.cssText = "width:130px;accent-color:#52b788;vertical-align:middle;cursor:pointer";
  gapSlider.value = String(ctx.state.maps._stackFloorGap);

  // L/R horizontal offset slider
  const horizLbl = el("span",{style:"font-size:12px;color:#94a3b8;min-width:36px;display:inline-block;text-align:right"},
    String(ctx.state.maps._stackHorizGap));
  const horizSlider = document.createElement("input");
  horizSlider.type = "range"; horizSlider.min = "-120"; horizSlider.max = "120"; horizSlider.step = "10";
  horizSlider.style.cssText = "width:100px;accent-color:#52b788;vertical-align:middle;cursor:pointer";
  horizSlider.value = String(ctx.state.maps._stackHorizGap);

  const isoWrap = el("div",{style:"margin-top:8px;overflow:auto;border-radius:8px;background:#071008;padding:8px"});
  const rebuildIso = () => {
    isoWrap.innerHTML = _stackIsoSVG(maps, ctx, levelOptions, ctx.state.maps._stackIsoFocus, ctx.state.maps._stackFloorGap, ctx.state.maps._stackHorizGap);
  };
  horizSlider.addEventListener("input", () => {
    ctx.state.maps._stackHorizGap = parseInt(horizSlider.value, 10);
    horizLbl.textContent = String(ctx.state.maps._stackHorizGap);
    rebuildIso();
  });
  focusSlider.addEventListener("input", () => {
    const idx = parseInt(focusSlider.value, 10);
    if(idx === 0){ ctx.state.maps._stackIsoFocus = null; focusLbl.textContent = "All floors"; }
    else {
      const z = sortedIsoLevels[idx-1];
      ctx.state.maps._stackIsoFocus = z;
      const opt = levelOptions.find(o=>o.value===z);
      focusLbl.textContent = opt ? opt.label : `L${z}`;
    }
    rebuildIso();
  });
  gapSlider.addEventListener("input", () => {
    ctx.state.maps._stackFloorGap = parseInt(gapSlider.value, 10);
    gapLbl.textContent = String(ctx.state.maps._stackFloorGap);
    rebuildIso();
  });

  // Persistent last-seen pins: show red target crosshairs for away objects
  if(ctx.state.maps._persistentPins === undefined) ctx.state.maps._persistentPins = false;
  const persistentBtn = el("button",{
    class: "btn inline",
    style: ctx.state.maps._persistentPins
      ? "background:#7f1d1d;border-color:#ef4444;color:#fca5a5;font-weight:700"
      : "color:#94a3b8",
    title: "Show last-seen position of away objects as red target pins on the 3D map",
    onclick: ()=>{
      ctx.state.maps._persistentPins = !ctx.state.maps._persistentPins;
      persistentBtn.style.cssText = ctx.state.maps._persistentPins
        ? "background:#7f1d1d;border-color:#ef4444;color:#fca5a5;font-weight:700"
        : "color:#94a3b8";
      rebuildIso();
      rebuildPins();
    }
  }, ctx.state.maps._persistentPins ? "⊕ Persistent ON" : "⊕ Persistent");

  if(ctx.state.maps._stackShowRoomList === undefined) ctx.state.maps._stackShowRoomList = false;

  const roomListToggle = el("button",{class:"btn inline", style:"margin-left:auto", onclick:()=>{
    ctx.state.maps._stackShowRoomList = !ctx.state.maps._stackShowRoomList;
    roomListToggle.textContent = ctx.state.maps._stackShowRoomList ? "☰ Hide Room List" : "☰ Room List";
    roomListPanel.style.display = ctx.state.maps._stackShowRoomList ? "block" : "none";
  }}, ctx.state.maps._stackShowRoomList ? "☰ Hide Room List" : "☰ Room List");

  const isoSaveLbl = el("span",{class:"muted",style:"font-size:11px;min-width:50px"}, "");
  const isoSaveBtn = el("button",{class:"btn inline",style:"padding:2px 10px;font-size:12px",
    title:"Save these slider positions so the view reopens with the same layout",
    onclick: async ()=>{
      isoSaveBtn.disabled = true;
      try{
        await ctx.actions.settingsSet({
          maps_iso_floor_gap: ctx.state.maps._stackFloorGap,
          maps_iso_horiz_gap: ctx.state.maps._stackHorizGap,
          maps_iso_focus:     ctx.state.maps._stackIsoFocus,
        });
        isoSaveLbl.textContent = "Saved ✓";
        setTimeout(()=>{ isoSaveLbl.textContent = ""; }, 2000);
      }catch(e){ isoSaveLbl.textContent = "Error"; }
      isoSaveBtn.disabled = false;
    }
  }, "Save");
  const isoResetBtn = el("button",{class:"btn inline",style:"padding:2px 10px;font-size:12px",
    title:"Reset sliders to default values and clear the saved layout",
    onclick: async ()=>{
      ctx.state.maps._stackFloorGap = 200;
      ctx.state.maps._stackHorizGap = 0;
      ctx.state.maps._stackIsoFocus = null;
      gapSlider.value   = "200"; gapLbl.textContent   = "200";
      horizSlider.value = "0";   horizLbl.textContent = "0";
      focusSlider.value = "0";   focusLbl.textContent = "All floors";
      rebuildIso();
      isoResetBtn.disabled = true;
      try{
        await ctx.actions.settingsSet({ maps_iso_floor_gap:200, maps_iso_horiz_gap:0, maps_iso_focus:null });
        isoSaveLbl.textContent = "Reset ✓";
        setTimeout(()=>{ isoSaveLbl.textContent = ""; }, 2000);
      }catch(e){ isoSaveLbl.textContent = "Error"; }
      isoResetBtn.disabled = false;
    }
  }, "Reset");
  // ── Stale Receiver Cleanup ──
  // A receiver is "stale" if its source MAC / label doesn't match any currently
  // active BLE scanner in HA. This can happen when scanners are removed or
  // renamed. The cleanup button removes stale receivers from all maps.
  const snap_rx = (ctx.state.live?.snapshot?.ble?.radios) || [];
  const liveSourceSet = new Set(snap_rx.map(r => r.source).filter(Boolean));
  // name→source and source→name lookups for backfill matching
  const nameToSource = new Map();
  const liveNameLower = new Map(); // lowercase name → source
  for(const radio of snap_rx){
    if(radio.name && radio.source) nameToSource.set(radio.name, radio.source);
    if(radio.name && radio.source) liveNameLower.set(radio.name.toLowerCase(), radio.source);
    // Also map source→source so label matching works when label IS the source address
    if(radio.source) liveNameLower.set(radio.source.toLowerCase(), radio.source);
  }

  // Backfill: if a receiver has no source but its label matches a live radio name,
  // populate source so future stale checks work reliably
  const backfillMaps = [];
  for(const m of maps){
    let changed = false;
    for(const r of (m.receivers||[])){
      if(r.source) continue; // already has source
      // Try exact name match first, then case-insensitive
      const matched = nameToSource.get(r.label) || liveNameLower.get((r.label||"").toLowerCase());
      if(matched){ r.source = matched; changed = true; }
    }
    if(changed) backfillMaps.push(m);
  }
  // Persist backfill silently (fire-and-forget)
  if(backfillMaps.length){
    (async ()=>{
      for(const m of backfillMaps){
        try{  }catch(e){}
      }
    })();
  }

  // Now count stale — a receiver matches if source is in live set OR label matches a live radio
  const _rxIsLive = (r) => {
    if(r.source && liveSourceSet.has(r.source)) return true;
    if(r.label && nameToSource.has(r.label)) return true;
    if(r.label && liveNameLower.has((r.label||"").toLowerCase())) return true;
    return false;
  };
  let staleCount = 0;
  for(const m of maps){
    for(const r of (m.receivers||[])){
      if(!_rxIsLive(r)) staleCount++;
    }
  }
  const cleanLbl = el("span",{class:"muted",style:"font-size:11px;min-width:50px"}, "");
  const cleanBtn = el("button",{class:"btn inline",style:"padding:2px 10px;font-size:12px" + (staleCount > 0 ? ";color:#ffd54f;border-color:#92400e" : ";opacity:0.5"),
    title: staleCount > 0 ? `Remove ${staleCount} receiver(s) not matching any live BLE scanner` : "All receivers match live scanners",
    onclick: async ()=>{
      if(!staleCount){ cleanLbl.textContent = "All clean"; setTimeout(()=>{ cleanLbl.textContent = ""; }, 2000); return; }
      if(!confirm(`Remove ${staleCount} stale receiver(s) from your maps?\n\nThese receivers don't match any active BLE scanner.`)) return;
      cleanBtn.disabled = true; cleanLbl.textContent = "Cleaning…";
      try{
        for(const m of maps){
          const orig = m.receivers || [];
          const kept = orig.filter(r => _rxIsLive(r));
          if(kept.length < orig.length){
          }
        }
        cleanLbl.textContent = `Removed ${staleCount} ✓`;
        setTimeout(()=>{ cleanLbl.textContent = ""; ctx.actions.renderRooms(); }, 1500);
      }catch(e){ cleanLbl.textContent = "Error"; }
      cleanBtn.disabled = false;
    }
  }, staleCount > 0 ? `Clean ${staleCount} stale` : "No stale");

  card.appendChild(el("div",{style:"display:flex;align-items:center;gap:10px;margin-top:8px;flex-wrap:wrap"},[
    el("span",{class:"muted",style:"font-size:12px"},"Floor:"),
    focusSlider,
    focusLbl,
    el("span",{class:"muted",style:"font-size:12px;margin-left:12px"},"Spacing:"),
    gapSlider,
    gapLbl,
    el("span",{class:"muted",style:"font-size:12px;margin-left:12px"},"L/R:"),
    horizSlider,
    horizLbl,
    isoSaveBtn,
    isoResetBtn,
    persistentBtn,
    cleanBtn,
    isoSaveLbl,
    cleanLbl,
    roomListToggle,
  ]));

  rebuildIso();
  card.appendChild(isoWrap);

  // Room list panel (all unique rooms across visible maps)
  const roomListPanel = el("div",{style:`display:${ctx.state.maps._stackShowRoomList ? "block" : "none"};margin-top:10px`});
  const visMaps2 = maps.filter(m=>!hiddenIds.has(m.id));
  const roomRows = [];
  for(const m of visMaps2){
    const floorLbl = _floorName(ctx, m.stack?.floor_id || m.floor_id || "");
    for(const room of Object.keys(m.room_bounds||{})){
      if(!roomRows.find(r=>r.room===room))
        roomRows.push({ room, map: m.name||m.id, floor: floorLbl });
    }
  }
  roomRows.sort((a,b)=>a.room.localeCompare(b.room));
  if(roomRows.length){
    const tbl = document.createElement("table");
    tbl.style.cssText = "width:100%;border-collapse:collapse;font-size:13px";
    tbl.innerHTML = `<thead><tr style="border-bottom:1px solid #1b3526">
      <th style="padding:5px 8px;color:#94a3b8;font-weight:500;text-align:left;width:24px"></th>
      <th style="padding:5px 8px;color:#94a3b8;font-weight:500;text-align:left">Room</th>
      <th style="padding:5px 8px;color:#94a3b8;font-weight:500;text-align:left">Floor</th>
      <th style="padding:5px 8px;color:#94a3b8;font-weight:500;text-align:left">Map</th>
    </tr></thead>`;
    const tbody2 = document.createElement("tbody");
    const roomColorFn = ctx.helpers.roomColor;
    for(const rr of roomRows){
      const color = roomColorFn(rr.room);
      const tr2 = document.createElement("tr");
      tr2.style.cssText = "border-bottom:1px solid #0f2017";
      tr2.innerHTML = `<td style="padding:5px 8px"><span style="display:inline-block;width:14px;height:14px;border-radius:50%;background:${color};vertical-align:middle"></span></td>
        <td style="padding:5px 8px;font-weight:600;color:#e2e8f0">${esc(rr.room)}</td>
        <td style="padding:5px 8px;color:#94a3b8">${esc(rr.floor)||"—"}</td>
        <td style="padding:5px 8px;color:#94a3b8">${esc(rr.map)}</td>`;
      tbody2.appendChild(tr2);
    }
    tbl.appendChild(tbody2);
    roomListPanel.appendChild(tbl);
  } else {
    roomListPanel.appendChild(el("div",{class:"muted",style:"font-size:12px;padding:8px"},"No rooms drawn yet. Go to Maps → Edit to draw room boundaries."));
  }
  card.appendChild(roomListPanel);

  return card;
}

// Render a single map's room bounds + receivers as an SVG string.
// Used in the Alignment Overlay (both ref and tgt layers) and in Point Align
// panels. viewBox="0 0 1 1" with preserveAspectRatio="none" matches the
// normalized coordinate system used by room bounds and receivers.
function _stackMapSVGStr(map, ctx, isTarget, showBg=true){
  const roomColor = ctx.helpers.roomColor;
  const rb = map.room_bounds || {};
  const hasRooms = Object.keys(rb).length > 0;
  const borderCol = isTarget ? "#52b78888" : "#1b3526";

  let s = `<svg viewBox="0 0 1 1" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:100%;display:block">`;
  if(showBg){
    s += `<rect x="0.005" y="0.005" width="0.99" height="0.99" fill="${isTarget?"#071008aa":"#071008"}" stroke="${borderCol}" stroke-width="0.012"/>`;
  } else if(isTarget){
    // Show a subtle border only so the target boundary is visible over the image
    s += `<rect x="0.005" y="0.005" width="0.99" height="0.99" fill="none" stroke="${borderCol}" stroke-width="0.012" opacity="0.5"/>`;
  }

  if(hasRooms){
    for(const [room, b] of Object.entries(rb)){
      if(!b) continue;
      const color = roomColor(room);
      const alpha = isTarget ? "99" : "33";
      if(b.type==="poly" && Array.isArray(b.points) && b.points.length >= 3){
        const pts = b.points.map(p=>`${p[0]},${p[1]}`).join(" ");
        s += `<polygon points="${pts}" fill="${color}${alpha}" stroke="${color}" stroke-width="0.006"/>`;
        const cx = b.points.reduce((a,p)=>a+p[0],0)/b.points.length;
        const cy = b.points.reduce((a,p)=>a+p[1],0)/b.points.length;
        s += `<text x="${cx}" y="${cy}" text-anchor="middle" dominant-baseline="middle" fill="${color}" font-size="0.05" font-family="system-ui,sans-serif">${_escSVG(room)}</text>`;
      } else if(b.type==="circle"){
        const cx=b.cx||0.5, cy=b.cy||0.5, r=b.r||0.12;
        s += `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${color}${alpha}" stroke="${color}" stroke-width="0.006"/>`;
        s += `<text x="${cx}" y="${cy}" text-anchor="middle" dominant-baseline="middle" fill="${color}" font-size="0.05" font-family="system-ui,sans-serif">${_escSVG(room)}</text>`;
      }
    }
    for(const r of (map.receivers||[])){
      s += `<circle cx="${r.x||0}" cy="${r.y||0}" r="0.022" fill="#52b788" opacity="0.9"/>`;
    }
  } else {
    s += `<text x="0.5" y="0.43" text-anchor="middle" dominant-baseline="middle" fill="#94a3b8" font-size="0.07" font-family="system-ui,sans-serif">${_escSVG(map.name||map.id)}</text>`;
    s += `<text x="0.5" y="0.58" text-anchor="middle" dominant-baseline="middle" fill="#4a6052" font-size="0.045" font-family="system-ui,sans-serif">no room bounds yet</text>`;
  }

  s += `<text x="0.97" y="0.97" text-anchor="end" dominant-baseline="auto" fill="${isTarget?"#52b788":"#94a3b8"}" font-size="0.04" font-family="system-ui,sans-serif">${_escSVG(map.name||map.id)}</text>`;
  s += `</svg>`;
  return s;
}

// Persistent-pins SVG overlay for the 2D alignment view: shows red target
// crosshairs at room centroids for objects that are "away" (stale age > 30s).
// Uses viewBox="0 0 1 1" / preserveAspectRatio="none" to match the room_bounds
// coordinate system (same as _stackMapSVGStr).
function _persistent2dPinsSVGStr(roomBounds, awayObjs){
  if(!awayObjs.length) return "";
  const rb = roomBounds || {};
  let s = `<svg viewBox="0 0 1 1" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg" style="position:absolute;top:0;left:0;width:100%;height:100%">`;
  for(const obj of awayObjs){
    const b = rb[obj.room];
    if(!b) continue;
    let cx = 0.5, cy = 0.5;
    if(b.type === "poly" && Array.isArray(b.points) && b.points.length >= 3){
      cx = b.points.reduce((a,p)=>a+p[0],0)/b.points.length;
      cy = b.points.reduce((a,p)=>a+p[1],0)/b.points.length;
    } else if(b.type === "circle"){
      cx = b.cx ?? 0.5; cy = b.cy ?? 0.5;
    }
    const R  = 0.040;  // outer ring
    const rM = 0.022;  // middle ring
    const rD = 0.009;  // centre dot
    const arm = rM + 0.026;  // crosshair arm end distance from centre
    const gap = rM + 0.005;  // crosshair arm start distance from centre
    s += `<g opacity="0.9">`;
    s += `<circle cx="${cx}" cy="${cy}" r="${R}" fill="none" stroke="#ef4444" stroke-width="0.007"/>`;
    s += `<circle cx="${cx}" cy="${cy}" r="${rM}" fill="none" stroke="#ef4444" stroke-width="0.009"/>`;
    s += `<circle cx="${cx}" cy="${cy}" r="${rD}" fill="#ef4444"/>`;
    s += `<line x1="${cx-arm}" y1="${cy}" x2="${cx-gap}" y2="${cy}" stroke="#ef4444" stroke-width="0.007"/>`;
    s += `<line x1="${cx+gap}" y1="${cy}" x2="${cx+arm}" y2="${cy}" stroke="#ef4444" stroke-width="0.007"/>`;
    s += `<line x1="${cx}" y1="${cy-arm}" x2="${cx}" y2="${cy-gap}" stroke="#ef4444" stroke-width="0.007"/>`;
    s += `<line x1="${cx}" y1="${cy+gap}" x2="${cx}" y2="${cy+arm}" stroke="#ef4444" stroke-width="0.007"/>`;
    s += `<text x="${cx}" y="${cy+R+0.030}" text-anchor="middle" fill="#fca5a5" font-size="0.038" font-family="system-ui,sans-serif" font-weight="600">${_escSVG(obj.user_label)}</text>`;
    s += `</g>`;
  }
  s += `</svg>`;
  return s;
}

// ── 3D Isometric SVG Renderer ─────────────────────────────────────────────────
// Generates a complete isometric building visualization as an SVG string.
// Each z_level becomes a "slab" (3D tile) rendered with an isometric
// projection: iso(wx,wy,wz) = (CX + (wx-wy)*TILE*0.866 + wz*horizGap,
//                               CY + (wx+wy)*TILE*0.5 - wz*FLOOR_GAP).
// The 0.866 factor (≈cos(30°)) and 0.5 (sin(30°)) give the standard
// isometric 30° viewing angle. FLOOR_GAP controls vertical separation
// between levels, horizGap shifts higher floors left/right.
//
// Each map's room bounds are projected through its stack transform
// (translate + rotate + scale) to world coordinates, then through the
// isometric projection to SVG pixel coordinates.
//
// Outside maps are special: they're fitted inside the indoor bounding box
// rather than getting their own slab, so they overlay naturally.
function _stackIsoSVG(maps, ctx, levelOptions, focusLevel=null, floorGap=200, horizGap=0){
  const TILE=260, FLOOR_GAP=floorGap, CX=390, CY=740, W=780, BASE_H=1060;
  const LAYER_PAL = ["#52b788","#f59e0b","#60a5fa","#e879f9","#fb923c","#34d399","#f87171","#a78bfa"];
  const roomColor = ctx.helpers.roomColor;
  const lvlLabel = (z)=>{ const opt=(levelOptions||[]).find(o=>o.value===z); return opt ? opt.label : `L${z}`; };

  // Persistent last-seen pins: collect away objects (labeled + have room + stale)
  const showPins = !!(ctx.state.maps && ctx.state.maps._persistentPins);
  const snap = (ctx.state.live && ctx.state.live.snapshot) || null;
  const awayObjs = showPins && snap?.objects
    ? Object.values(snap.objects).filter(o =>
        o.user_label && o.room && o.room !== "unknown" && o.room !== "not_home" &&
        typeof o.age_s === "number" && o.age_s > 30)
    : [];

  // Isometric projection: world (wx,wy,wz) → SVG pixel (x,y)
  const iso = (wx, wy, wz)=>[
    CX + (wx-wy)*TILE*0.866 + wz*horizGap,
    CY + (wx+wy)*TILE*0.5 - wz*FLOOR_GAP,
  ];
  const pt = (c)=>`${Math.round(c[0])},${Math.round(c[1])}`;
  const ptsStr = (corners)=>corners.map(pt).join(" ");

  // Filter hidden maps
  const hiddenIds = (ctx.state.maps && ctx.state.maps._hiddenMapIds) || new Set();
  const visMaps = maps.filter(m=>!hiddenIds.has(m.id));

  // Group by z_level
  const sorted = [...visMaps].sort((a,b)=>(a.stack?.z_level||0)-(b.stack?.z_level||0));
  const byLevel = new Map();
  for(const m of sorted){
    const z = m.stack?.z_level ?? 0;
    if(!byLevel.has(z)) byLevel.set(z,[]);
    byLevel.get(z).push(m);
  }
  const sortedLevels = [...byLevel.keys()].sort((a,b)=>a-b);

  // ── Outside map handling ──
  // Outside maps don't get their own slab in the 3D stack. Instead they're
  // rendered as an overlay fitted inside the indoor bounding box of their
  // z_level. This means their 0–1 coordinates map to the physical extent
  // of the indoor floors, so outdoor room bounds (garden, driveway) appear
  // in the right relative position.
  const _indoorBBByLevel = new Map();
  for(const m of visMaps){
    if(_isOutsideMap(m)) continue;
    const z = m.stack?.z_level ?? 0;
    const _xfBB = mapXform(ctx.state.model, m);
    if(!_xfBB) continue;    // unplaced: no footprint to take a bounding box of
    const bbPt = _xfBB.mapPt;
    if(!_indoorBBByLevel.has(z)) _indoorBBByLevel.set(z,{minX:Infinity,minY:Infinity,maxX:-Infinity,maxY:-Infinity});
    const bb=_indoorBBByLevel.get(z);
    for(const [cx,cy] of [[0,0],[1,0],[1,1],[0,1]]){const[wx,wy]=bbPt(cx,cy);bb.minX=Math.min(bb.minX,wx);bb.minY=Math.min(bb.minY,wy);bb.maxX=Math.max(bb.maxX,wx);bb.maxY=Math.max(bb.maxY,wy);}
  }
  // Also compute a global indoor bounding box (union of all levels) as fallback
  let _globalIndoorBB = {minX:Infinity,minY:Infinity,maxX:-Infinity,maxY:-Infinity};
  for(const bb of _indoorBBByLevel.values()){
    _globalIndoorBB.minX=Math.min(_globalIndoorBB.minX,bb.minX);_globalIndoorBB.minY=Math.min(_globalIndoorBB.minY,bb.minY);
    _globalIndoorBB.maxX=Math.max(_globalIndoorBB.maxX,bb.maxX);_globalIndoorBB.maxY=Math.max(_globalIndoorBB.maxY,bb.maxY);
  }
  if(!isFinite(_globalIndoorBB.minX)){_globalIndoorBB={minX:0,minY:0,maxX:1,maxY:0.75};}

  const levelColor = (z) => {
    const grp = byLevel.get(z) || [];
    if(grp.some(m => _isOutsideMap(m))) return "#6b8e23";
    return LAYER_PAL[sortedLevels.indexOf(z) % LAYER_PAL.length];
  };
  const LEGEND_H = sortedLevels.length * 30 + 24;
  const HTOTAL = BASE_H + LEGEND_H;

  let s = `<svg viewBox="0 0 ${W} ${HTOTAL}" xmlns="http://www.w3.org/2000/svg" width="100%" style="max-height:${HTOTAL}px;display:block;font-family:system-ui,sans-serif">`;
  s += `<rect width="${W}" height="${HTOTAL}" fill="#071008"/>`;
  s += `<text x="12" y="20" fill="#52b788" font-size="11" font-weight="600">3D Floor Stack Preview</text>`;

  if(!maps.length){
    s += `<text x="${W/2}" y="${BASE_H/2}" text-anchor="middle" fill="#4a6052" font-size="14">No floor plans uploaded yet.</text>`;
    s += `</svg>`; return s;
  }
  if(!visMaps.length){
    s += `<text x="${W/2}" y="${BASE_H/2}" text-anchor="middle" fill="#4a6052" font-size="13">All layers hidden.</text>`;
    s += `</svg>`; return s;
  }

  const slabWZ = 10/FLOOR_GAP;

  for(const [z, group] of [...byLevel.entries()].sort((a,b)=>a[0]-b[0])){
    const isFocused = focusLevel === null || focusLevel === z;
    const groupOpacity = isFocused ? 1.0 : 0.12;
    const lyrColor = levelColor(z);

    // Merged bounding box — only from indoor maps; outside maps rendered as overlay inside
    const indoorGroup = group.filter(m => !_isOutsideMap(m));
    const outsideGroup = group.filter(m => _isOutsideMap(m));
    let minX=Infinity, minY=Infinity, maxX=-Infinity, maxY=-Infinity;
    for(const m of indoorGroup){
      const _xfG = mapXform(ctx.state.model, m);
      if(!_xfG) continue;
      const bbPt = _xfG.mapPt;
      for(const [cx,cy] of [[0,0],[1,0],[1,1],[0,1]]){
        const [wx,wy]=bbPt(cx,cy);
        minX=Math.min(minX,wx); minY=Math.min(minY,wy);
        maxX=Math.max(maxX,wx); maxY=Math.max(maxY,wy);
      }
    }
    // If level has only outside maps, use global indoor bounding box as the slab
    if(!isFinite(minX)){
      const fb = _indoorBBByLevel.get(z) || _globalIndoorBB;
      minX=fb.minX; minY=fb.minY; maxX=fb.maxX; maxY=fb.maxY;
    }
    if(!isFinite(minX)){ minX=0; minY=0; maxX=1; maxY=0.75; }

    const TL=iso(minX,minY,z), TR=iso(maxX,minY,z), BR=iso(maxX,maxY,z), BL=iso(minX,maxY,z);
    const TR_b=iso(maxX,minY,z-slabWZ), BR_b=iso(maxX,maxY,z-slabWZ), BL_b=iso(minX,maxY,z-slabWZ);

    s += `<g opacity="${groupOpacity}">`;
    // Slab side faces
    s += `<polygon points="${ptsStr([TR,BR,BR_b,TR_b])}" fill="#0d2318" fill-opacity="0.35" stroke="#253e2e" stroke-width="0.8"/>`;
    s += `<polygon points="${ptsStr([BL,BR,BR_b,BL_b])}" fill="#0a1a12" fill-opacity="0.3" stroke="#253e2e" stroke-width="0.8"/>`;
    // Slab top face — see-through with colored outline
    s += `<polygon points="${ptsStr([TL,TR,BR,BL])}" fill="#0f2017" fill-opacity="0.06" stroke="${lyrColor}" stroke-width="1.5" stroke-dasharray="10,5" opacity="0.5"/>`;

    // Room bounds + receivers for all maps in this group
    const lidx = sortedLevels.indexOf(z);
    for(const m of group){
      const stk = m.stack||{};
      const _isOut2 = _isOutsideMap(m);

      // Outside maps: auto-fit their 0-1 coordinate space into the indoor bounding box
      // so their room bounds/receivers appear inside the indoor slab footprint.
      let mapPt;
      if(_isOut2){
        mapPt = (px,py) => {
          return [minX + px * (maxX - minX), minY + py * (maxY - minY)];
        };
      } else {
        const _xfM = mapXform(ctx.state.model, m);
        if(!_xfM) continue;   // unplaced: nothing on this picture has a place
        mapPt = _xfM.mapPt;
      }

      for(const [room, b] of Object.entries(m.room_bounds||{})){
        if(!b || b.type!=="poly" || !Array.isArray(b.points) || b.points.length<3) continue;
        const color = roomColor(room);
        const polyPts = b.points.map(p=>{ const [wx,wy]=mapPt(p[0],p[1]); return pt(iso(wx,wy,z)); }).join(" ");
        s += `<polygon points="${polyPts}" fill="${color}" fill-opacity="0.2" stroke="${color}" stroke-width="1.5" opacity="0.9"/>`;
        const cx = b.points.reduce((a,p)=>a+p[0],0)/b.points.length;
        const cy = b.points.reduce((a,p)=>a+p[1],0)/b.points.length;
        const [lwx,lwy] = mapPt(cx,cy);
        const [lix,liy] = iso(lwx,lwy,z);
        s += `<text x="${Math.round(lix)}" y="${Math.round(liy)+lidx*2}" text-anchor="middle" dominant-baseline="middle" fill="${color}" font-size="8" font-weight="600" opacity="0.9">${_escSVG(room)}</text>`;
      }
      for(const r of (m.receivers||[])){
        const [wx,wy]=mapPt(r.x||0, r.y||0);
        const [px,py]=iso(wx,wy,z);
        s += `<circle cx="${Math.round(px)}" cy="${Math.round(py)}" r="13" fill="none" stroke="#52b788" stroke-width="1.2" opacity="0.3"/>`;
        s += `<circle cx="${Math.round(px)}" cy="${Math.round(py)}" r="7"  fill="none" stroke="#52b788" stroke-width="1.5" opacity="0.6"/>`;
        s += `<circle cx="${Math.round(px)}" cy="${Math.round(py)}" r="4"  fill="#52b788" opacity="0.9"/>`;
      }
      // Persistent last-seen pins: red target crosshairs for away objects whose room is on this map
      if(awayObjs.length){
        const rb = m.room_bounds || {};
        for(const obj of awayObjs){
          const b = rb[obj.room];
          if(!b) continue;
          let ncx = 0.5, ncy = 0.5;
          if(b.type === "poly" && Array.isArray(b.points) && b.points.length >= 3){
            ncx = b.points.reduce((a,p)=>a+p[0],0)/b.points.length;
            ncy = b.points.reduce((a,p)=>a+p[1],0)/b.points.length;
          } else if(b.type === "circle"){
            ncx = b.cx ?? 0.5; ncy = b.cy ?? 0.5;
          }
          const [wx,wy] = mapPt(ncx, ncy);
          const [px,py] = iso(wx, wy, z);
          const r = Math.round;
          s += `<g opacity="0.92">`;
          s += `<circle cx="${r(px)}" cy="${r(py)}" r="20" fill="none" stroke="#ef4444" stroke-width="1.5"/>`;
          s += `<circle cx="${r(px)}" cy="${r(py)}" r="11" fill="none" stroke="#ef4444" stroke-width="2"/>`;
          s += `<circle cx="${r(px)}" cy="${r(py)}" r="4" fill="#ef4444"/>`;
          s += `<line x1="${r(px)-25}" y1="${r(py)}" x2="${r(px)-13}" y2="${r(py)}" stroke="#ef4444" stroke-width="1.5"/>`;
          s += `<line x1="${r(px)+13}" y1="${r(py)}" x2="${r(px)+25}" y2="${r(py)}" stroke="#ef4444" stroke-width="1.5"/>`;
          s += `<line x1="${r(px)}" y1="${r(py)-25}" x2="${r(px)}" y2="${r(py)-13}" stroke="#ef4444" stroke-width="1.5"/>`;
          s += `<line x1="${r(px)}" y1="${r(py)+13}" x2="${r(px)}" y2="${r(py)+25}" stroke="#ef4444" stroke-width="1.5"/>`;
          s += `<text x="${r(px)}" y="${r(py)+36}" text-anchor="middle" fill="#fca5a5" font-size="9" font-weight="600">${_escSVG(obj.user_label)}</text>`;
          s += `</g>`;
        }
      }
    }

    // Colored index dot at bottom-left corner of slab top face
    s += `<circle cx="${Math.round(BL[0])}" cy="${Math.round(BL[1])}" r="15" fill="${lyrColor}" opacity="0.95"/>`;
    s += `<text x="${Math.round(BL[0])}" y="${Math.round(BL[1])+6}" text-anchor="middle" fill="#071008" font-size="14" font-weight="700">${lidx+1}</text>`;
    s += `</g>`;
  }

  // Legend at bottom
  const LEGEND_ROW = 30;
  s += `<line x1="10" y1="${BASE_H+4}" x2="${W-10}" y2="${BASE_H+4}" stroke="#1b3526" stroke-width="0.8"/>`;
  sortedLevels.forEach((z, i)=>{
    const ly = BASE_H + 10 + i * LEGEND_ROW;
    const color = levelColor(z);
    const groupLabel = byLevel.get(z).map(m=>(m.name||m.id)).join(" + ");
    const ceil0 = byLevel.get(z)[0].stack?.ceiling_height_m || 2.4;
    s += `<circle cx="18" cy="${ly+11}" r="11" fill="${color}" opacity="0.9"/>`;
    s += `<text x="18" y="${ly+15}" text-anchor="middle" fill="#071008" font-size="12" font-weight="700">${i+1}</text>`;
    s += `<text x="36" y="${ly+15}" fill="${color}" font-size="18" font-weight="500">${_escSVG(groupLabel)}</text>`;
    s += `<text x="${W-10}" y="${ly+15}" text-anchor="end" fill="#94a3b8" font-size="15">${_escSVG(lvlLabel(z))} · ${ceil0}m</text>`;
  });

  // Outside overlay label
  if(visMaps.some(m => _isOutsideMap(m))){
    s += `<text x="${W-10}" y="20" text-anchor="end" fill="#6b8e23" font-size="11" font-weight="500">Outside layer fitted to indoor footprint</text>`;
  }

  s += `</svg>`;
  return s;
}

// Escape a string for safe inclusion in SVG text content.
function _escSVG(s){
  return String(s||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}

// ─── Export Helpers ───────────────────────────────────────────────────────────

// Trigger a browser download of a Blob with the given filename.
function _downloadBlob(blob, filename){
  const u = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = u; a.download = filename; a.click();
  setTimeout(()=>URL.revokeObjectURL(u), 3000);
}

// Build a standalone SVG of room boundaries + receiver dots in pixel coordinates.
// Used for SVG export and as an overlay layer in the combined PNG render.
function _buildRoomBoundsSVG(map, ctx, transparent=false){
  const iw = map.image?.width || 800;
  const ih = map.image?.height || 600;
  const roomColor = ctx.helpers.roomColor;
  const rb = map.room_bounds || {};
  let s = `<svg viewBox="0 0 ${iw} ${ih}" xmlns="http://www.w3.org/2000/svg" width="${iw}" height="${ih}">`;
  if(!transparent) s += `<rect width="${iw}" height="${ih}" fill="#071008"/>`;
  for(const [room, b] of Object.entries(rb)){
    if(!b || b.type!=="poly" || !Array.isArray(b.points) || b.points.length<3) continue;
    const color = roomColor(room);
    const pts = b.points.map(p=>`${p[0]*iw},${p[1]*ih}`).join(" ");
    s += `<polygon points="${pts}" fill="${color}44" stroke="${color}" stroke-width="2"/>`;
    const cx = b.points.reduce((a,p)=>a+p[0],0)/b.points.length*iw;
    const cy = b.points.reduce((a,p)=>a+p[1],0)/b.points.length*ih;
    const fs = Math.max(12, Math.round(iw*0.024));
    s += `<text x="${cx}" y="${cy}" text-anchor="middle" dominant-baseline="middle" fill="${color}" font-size="${fs}" font-family="system-ui,sans-serif">${_escSVG(room)}</text>`;
  }
  for(const r of (map.receivers||[])){
    const rx=(r.x||0)*iw, ry=(r.y||0)*ih;
    const rr = Math.max(6, Math.round(iw*0.012));
    s += `<circle cx="${rx}" cy="${ry}" r="${rr}" fill="#52b788" opacity="0.9"/>`;
    if(r.label){
      const fs = Math.max(9, Math.round(iw*0.014));
      s += `<text x="${rx}" y="${ry-rr-3}" text-anchor="middle" fill="#52b788" font-size="${fs}" font-family="system-ui,sans-serif">${_escSVG(r.label)}</text>`;
    }
  }
  s += `</svg>`;
  return s;
}

// Render a combined PNG: floor plan image + room bounds overlay composited
// via an offscreen <canvas>. The SVG overlay is drawn at 80% opacity.
async function _combinedMapPng(map, ctx){
  const iw = map.image?.width || 800;
  const ih = map.image?.height || 600;
  const canvas = document.createElement("canvas");
  canvas.width = iw; canvas.height = ih;
  const g = canvas.getContext("2d");
  const pngUrl = ctx.helpers.mapImageUrl(map);
  if(pngUrl){
    try{ const img = await _loadImage(pngUrl); g.drawImage(img,0,0,iw,ih); }
    catch(e){ g.fillStyle="#071008"; g.fillRect(0,0,iw,ih); }
  } else {
    g.fillStyle="#071008"; g.fillRect(0,0,iw,ih);
  }
  await _drawSvgOnCanvas(g, _buildRoomBoundsSVG(map, ctx, true), iw, ih, 0.8);
  return new Promise(resolve=>canvas.toBlob(resolve,"image/png",0.92));
}

// Render an SVG string to a PNG Blob via an offscreen canvas.
async function _svgStringToPng(svgStr, w, h){
  const canvas = document.createElement("canvas");
  canvas.width = w; canvas.height = h;
  const g = canvas.getContext("2d");
  g.fillStyle="#071008"; g.fillRect(0,0,w,h);
  await _drawSvgOnCanvas(g, svgStr, w, h, 1.0);
  return new Promise(resolve=>canvas.toBlob(resolve,"image/png",0.95));
}

// Draw an SVG string onto an existing canvas context at the given alpha.
// Creates a temporary Blob URL, loads it as an Image, then drawImage().
async function _drawSvgOnCanvas(g, svgStr, w, h, alpha=1.0){
  const blob = new Blob([svgStr],{type:"image/svg+xml;charset=utf-8"});
  const url = URL.createObjectURL(blob);
  try{
    const img = await _loadImage(url);
    const prev = g.globalAlpha;
    g.globalAlpha = alpha;
    g.drawImage(img,0,0,w,h);
    g.globalAlpha = prev;
  }finally{
    URL.revokeObjectURL(url);
  }
}

// ── Lights Tab ───────────────────────────────────────────────────────────────
// One unified view: room shape (pure vector polygons from room_bounds — never
// the raw floor-plan photo, which only ever appears in Maps > Edit/Upload)
// with every light shown on it. PadSpan Pro licence holders can drag a light
// directly on this same view to its exact spot and pick a shape/color/
// rotation — there is no separate "enter edit mode" step. Non-Pro sees the
// identical layout read-only; clicking a light toggles it. A light can also
// be hidden from the map entirely (shared with the Lights sidebar's
// Hide/Show, via the `lights_hidden` setting) without affecting its
// existence — it just won't clutter the room view.
// Lights are discovered from HA's entity registry and grouped by area_name.

// Placement is a paid lighting feature: PadSpan Bright Pro or PadSpan Pro
// (tier >= "bright" — licence.py's ladder, read off the settings payload).
function _isPro(ctx) {
  // The backend decides — it owns expiry, the grace window and the tier, and
  // the key itself is never sent to the frontend. This is a display gate
  // only; every paid action is enforced server-side regardless of what it says.
  const t = String(ctx.state.settings?.tier || "").toLowerCase();
  return t === "bright" || t === "pro";
}





// ─── Real-world metric room geometry + light placement (Lights tab) ───────
// Everything below renders from the app's UNIFIED real-world model
// (ModelStore.floors / room_geometry_m / map_transforms) — the same
// deduplicated, calibrated metric fabric the BLE positioning engine itself
// uses — never a single map's own room_bounds (a per-photo hand-traced
// derivative of that photo that duplicates whenever a floor has more than
// one uploaded map).





// Bounding box (metres) across a floor's real room_geometry_m shapes.
function _roomGeomBBoxM(roomGeoms) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [, g] of roomGeoms) {
    if (g.type === "poly" && Array.isArray(g.points_m)) {
      for (const p of g.points_m) {
        const x = p[0], y = p[1];
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
      }
    } else if (g.type === "circle") {
      const cx = g.cx_m || 0, cy = g.cy_m || 0, r = g.r_m || 0.1;
      if (cx - r < minX) minX = cx - r; if (cx + r > maxX) maxX = cx + r;
      if (cy - r < minY) minY = cy - r; if (cy + r > maxY) maxY = cy + r;
    }
  }
  if (!isFinite(minX)) return { minX: 0, minY: 0, width: 6, height: 4.5 };
  const padX = Math.max(0.3, (maxX - minX) * 0.06), padY = Math.max(0.3, (maxY - minY) * 0.06);
  return {
    minX: minX - padX, minY: minY - padY,
    width: Math.max(0.5, (maxX - minX) + padX * 2),
    height: Math.max(0.5, (maxY - minY) + padY * 2),
  };
}



// The unified room + lights canvas for one real FLOOR (not one uploaded
// map). Room shapes come from model.room_geometry_m — the deduplicated,
// calibrated metric fabric — merged across every map on this floor. Always
// shows every (non-hidden) light — at its saved position if placed, auto-
// clustered around its room's centre otherwise. Pro adds: an "Add to Room"
// picker for unplaced lights, drag-to-move (against the currently active
// map), a shape/color/rotation inspector on the selected pin, and Save.
// Vanilla-JS port of purelive.js's MapViewport (same math, same UX): wheel
// zoom, drag pan, pinch zoom, double-click/tap reset. Pure Live's version is
// a Preact hook-based component; this reimplements the same event-handling
// logic imperatively for maps.js's plain-DOM rendering style. `inner` must
// be an absolutely-positioned div filling `viewport` (transform-origin 0 0);
// `viewport` should have position:relative + overflow:hidden.
function _attachPanZoom(viewport, inner) {
  const MIN_SCALE = 0.3, MAX_SCALE = 5;
  const s = { scale: 1, tx: 0, ty: 0, dragging: false, startX: 0, startY: 0, startTx: 0, startTy: 0, pinchDist: 0, pinchScale: 1 };
  const apply = () => { inner.style.transform = `translate(${s.tx}px, ${s.ty}px) scale(${s.scale})`; };
  const zoomAt = (cx, cy, factor) => {
    const newScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, s.scale * factor));
    const ratio = newScale / s.scale;
    // The zoom-at-cursor fixed-point math assumes cursor coordinates
    // relative to the inner element's own (untransformed) layout origin —
    // inner is flex-centred inside the viewport, so subtract its layout
    // offset. Without this, every zoom step drifts the content toward a
    // corner and it quickly flies off screen.
    const ox = inner.offsetLeft, oy = inner.offsetTop;
    const px = cx - ox, py = cy - oy;
    s.tx = px - ratio * (px - s.tx);
    s.ty = py - ratio * (py - s.ty);
    s.scale = newScale;
    apply();
  };
  const reset = () => { s.scale = 1; s.tx = 0; s.ty = 0; apply(); };
  // A light pin handles its own drag (_makeDraggable); the viewport's pan
  // must not also fire for that same mousedown, or the pin and the whole
  // canvas would both move at once.
  const isExcluded = (t) => t.closest && t.closest("button,input,select,a,[data-light-pin],[data-room-handle]");

  viewport.addEventListener("wheel", (e) => {
    e.preventDefault();
    const r = viewport.getBoundingClientRect();
    zoomAt(e.clientX - r.left, e.clientY - r.top, e.deltaY < 0 ? 1.12 : 0.89);
  }, { passive: false });

  viewport.addEventListener("mousedown", (e) => {
    if (e.button !== 0 || isExcluded(e.target)) return;
    s.dragging = true; s.startX = e.clientX; s.startY = e.clientY; s.startTx = s.tx; s.startTy = s.ty;
    viewport.style.cursor = "grabbing";
  });
  window.addEventListener("mousemove", (e) => {
    if (!s.dragging) return;
    s.tx = s.startTx + (e.clientX - s.startX);
    s.ty = s.startTy + (e.clientY - s.startY);
    apply();
  });
  window.addEventListener("mouseup", () => { s.dragging = false; viewport.style.cursor = "grab"; });

  viewport.addEventListener("touchstart", (e) => {
    if (e.touches.length === 1) {
      if (isExcluded(e.target)) return;
      s.dragging = true; s.startX = e.touches[0].clientX; s.startY = e.touches[0].clientY; s.startTx = s.tx; s.startTy = s.ty;
    } else if (e.touches.length === 2) {
      s.dragging = false;
      const dx = e.touches[0].clientX - e.touches[1].clientX, dy = e.touches[0].clientY - e.touches[1].clientY;
      s.pinchDist = Math.sqrt(dx * dx + dy * dy); s.pinchScale = s.scale;
    }
  }, { passive: false });
  viewport.addEventListener("touchmove", (e) => {
    e.preventDefault();
    if (e.touches.length === 1 && s.dragging) {
      s.tx = s.startTx + (e.touches[0].clientX - s.startX);
      s.ty = s.startTy + (e.touches[0].clientY - s.startY);
      apply();
    } else if (e.touches.length === 2 && s.pinchDist > 0) {
      const dx = e.touches[0].clientX - e.touches[1].clientX, dy = e.touches[0].clientY - e.touches[1].clientY;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const newScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, s.pinchScale * (dist / s.pinchDist)));
      const r = viewport.getBoundingClientRect();
      const cx = (e.touches[0].clientX + e.touches[1].clientX) / 2 - r.left;
      const cy = (e.touches[0].clientY + e.touches[1].clientY) / 2 - r.top;
      const ratio = newScale / s.scale;
      s.tx = cx - ratio * (cx - s.tx); s.ty = cy - ratio * (cy - s.ty); s.scale = newScale;
      apply();
    }
  }, { passive: false });
  viewport.addEventListener("touchend", () => { s.dragging = false; s.pinchDist = 0; });

  viewport.addEventListener("dblclick", (e) => { if (!isExcluded(e.target)) reset(); });

  return { reset };
}


// ─── Lights tab — the builder for the Lights sidebar's map ────────────────
// The sidebar DISPLAYS the house-lights representation; this tab BUILDS it,
// on the identical shared view (views/lights_map.js): same maps, same rooms,
// same hexes, same codes, same controls, same index table. Every light
// already appears on the map — auto-clustered at its room's centre until
// placed — so the tools act directly on the hexes: click one to select it,
// drag it to where the light physically is, recolor it, or release it back
// to the auto cluster. Saving publishes the arrangement; the sidebar then
// shows exactly this map.
//
// Placement storage is unchanged (per-map `lights` entries in photo-fraction
// space via maps_update): a drag inverts the iso projection at the hex's own
// floor z back to world coords, then into the owning map's fraction space.
// The owning map is picked automatically — a placed hex moves on its own
// map; an auto hex lands on its floor's primary (best-calibrated) map. The
// user never sees or picks a photo here.

// Draft: mapId → scratch copy of that map's lights[]. Presence of a key IS
// the dirty marker; Save writes every drafted map, Discard drops them all.
// Which floor a given iso level IS — from the floor registry, not from
// whichever photo happens to sit at that height.
function _floorIdForZ(ctx, z, frame) {
  const floors = ctx.state.model?.floors || [];
  // Ask the RENDERER which floor it drew at this height. Matching on the
  // registry's `level` was wrong on any real install: every floor there has
  // level null, Number(null) is 0, so z=0 matched the first floor by accident
  // and every storey above it fell through to the "main" default. A light
  // dropped on the Upper floor was saved as main and vanished from the room
  // it was placed in. fabricFrame already resolves this (explicit level, then
  // base elevation, then registry order) and stacks the map with it, so the
  // inverse has to come from the same function or the two disagree.
  const drawn = floorIdAtLevel(frame, ctx.state.model, floors, z);
  if (drawn) return drawn;
  const f = floors.find(x => Number(x.level) === Number(z));
  if (f) return String(f.id);
  // No registry match: fall back to a floor the fabric already places here.
  const geo = ctx.state.model?.room_geometry_m || {};
  for (const g of Object.values(geo)) {
    const fid = String(g?.floor_id || "");
    if (!fid) continue;
    const ff = floors.find(x => String(x.id) === fid);
    if (ff && Number(ff.level) === Number(z)) return fid;
  }
  return "main";
}

// A light belongs to a ROOM, and a room belongs to a floor. That is the floor
// the light keeps — dragging it around the map never re-assigns the storey.
//
// Taking the floor from whichever slab the pointer happened to be over made
// lights jump between storeys at random and, worse, stranded them: once a
// fixture had been written onto a floor its room is not on, it no longer drew
// with that room and there was nothing left to grab to bring it back.
//
// Order: the room's own floor from the fabric, then whatever the light was
// already stored with, and only then the drawn height.
function _floorIdForLight(ctx, eid, z, frame, lightsByEid) {
  const room = ((lightsByEid || {})[eid] || {}).area_name;
  if (room) {
    const geo = (ctx.state.model?.room_geometry_m || {})[room];
    const fid = geo && geo.floor_id;
    if (fid) return String(fid);
  }
  const prevFid = ((ctx.state.model?.light_positions_m || {})[eid] || {}).floor_id;
  if (prevFid) return String(prevFid);
  return _floorIdForZ(ctx, z, frame);
}

// ── Undo / redo over the DRAFT ──────────────────────────────────────────────
// Every edit (drag, nudge, handle, inspector field, spread, queue drop) first
// records what the draft held for the lights it is about to touch. Undo
// puts that back — a `null` means "no draft entry", i.e. back to what is
// committed. Save clears the history: what is committed is not undoable
// from here (Auto position is the way back for a committed placement).
function _undoStack(mapState) {
  return mapState._lightsUndo || (mapState._lightsUndo = createUndoStack());
}
function _draftSnapshot(mapState, eids) {
  const d = mapState._lightsDraftM || {};
  const snap = {};
  for (const eid of eids) snap[eid] = d[eid] ? { ...d[eid] } : null;
  return snap;
}
function _pushUndo(mapState, eids) { _undoStack(mapState).push(_draftSnapshot(mapState, eids)); }
function _applySnapshot(mapState, snap) {
  const d = mapState._lightsDraftM || (mapState._lightsDraftM = {});
  for (const [eid, entry] of Object.entries(snap)) {
    if (entry) d[eid] = { ...entry }; else delete d[eid];
  }
}
function _lightsUndo(ctx, mapState) {
  const st = _undoStack(mapState);
  const top = st.peekUndo();
  if (!top) return;
  // What redo will need is the CURRENT draft of the same lights.
  const prev = st.undo(_draftSnapshot(mapState, Object.keys(top)));
  _applySnapshot(mapState, prev);
  ctx.actions.renderRooms();
}
function _lightsRedo(ctx, mapState) {
  const st = _undoStack(mapState);
  const top = st.peekRedo();
  if (!top) return;
  const next = st.redo(_draftSnapshot(mapState, Object.keys(top)));
  _applySnapshot(mapState, next);
  ctx.actions.renderRooms();
}

// The level (iso z) a floor id is drawn at — the inverse of floorIdAtLevel,
// through the same frame, so a queued drop lands on the storey its room is on.
function _levelForFloorId(frame, model, floors, fid) {
  for (const z of frame.levels) if (floorIdAtLevel(frame, model, floors, z) === String(fid)) return z;
  const f = floors.find(x => String(x.id) === String(fid));
  return f && Number.isFinite(Number(f.level)) ? Number(f.level) : (frame.levels[0] || 0);
}

// A draft entry for a light dropped at metres (x_m, y_m) on floor fid —
// keeps whatever look it already had (colour, size, rotation, margin).
function _draftAt(ctx, o, eid, x_m, y_m, fid, source) {
  const draft = o.mapState._lightsDraftM || (o.mapState._lightsDraftM = {});
  const prev = draft[eid] || ((ctx.state.model || {}).light_positions_m || {})[eid] || {};
  draft[eid] = {
    x_m: Math.round(x_m * 1000) / 1000, y_m: Math.round(y_m * 1000) / 1000, floor_id: fid,
    color: prev.color || "#fbbf24",
    rotation: prev.rotation || 0, width_cm: prev.width_cm || 0, height_cm: prev.height_cm || 0,
    margin_cm: prev.margin_cm,
    label: prev.label || (o.lightsByEid[eid] ? o.lightsByEid[eid].friendly_name : eid),
    // Provenance, draft-only (see the Save handler): "manual" is a hand
    // placement or a drag/nudge of one; "auto" is an accepted room-centre
    // guess, shown as APPROXIMATE in the inspector until someone moves it.
    source: source || "manual",
  };
}

// Wire the build tools onto the shared iso SVG: click any hex to select it,
// drag any hex to place/move it. Runs after every SVG rebuild.
function _wireLightsBuild(ctx, isoDiv, o) {
  const svg = isoDiv.querySelector("svg");
  if (!svg) return;
  const toVB = (ev) => {
    const p = svg.createSVGPoint();
    p.x = ev.clientX; p.y = ev.clientY;
    const m = svg.getScreenCTM();
    return m ? p.matrixTransform(m.inverse()) : { x: 0, y: 0 };
  };
  const mapState = o.mapState;
  const selSet = mapState._selSet || (mapState._selSet = new Set());
  // The drag inverts through THE SAME frame the renderer just drew with —
  // same function, same fabric, same live slider values — so a dropped light
  // lands where it was dropped by construction. This used to be a re-derived
  // copy of the projection, which could disagree with the drawing.
  // The model the SVG was DRAWN with, which includes unsaved drafts. Building
  // this from ctx.state.model instead meant that as soon as one light had an
  // unsaved position the two frames could differ in extent, and therefore in
  // scale — the next drag then inverted through a slightly different
  // projection and the light landed short of the pointer.
  const frameModel = o.model || ctx.state.model;
  const frame = fabricFrame(frameModel, frameModel?.floors || ctx.state.model?.floors || [],
                            o.view.floorGap, o.view.horizGap);

  _wireLightsPicker(ctx, isoDiv, svg, o, toVB);

  // The drop-marker pin: a second way to place the selected light, dragged
  // from its parked corner onto the map. Reuses exactly the projection
  // (toVB → frame.isoInv, inside o.onDropPlace) every other placement path
  // here already goes through.
  const dropG = isoDiv.querySelector('g[data-role="dropmarker"]');
  if (dropG && o.onDropPlace) {
    dropG.style.touchAction = "none";
    dropG.addEventListener("pointerdown", (ev) => {
      if (ev.button !== 0 && ev.pointerType === "mouse") return;
      ev.preventDefault(); ev.stopPropagation();
      const start = toVB(ev);
      let moved = false;
      try { dropG.setPointerCapture(ev.pointerId); } catch (_) {}
      const mm = (e) => {
        const v = toVB(e);
        const dx = v.x - start.x, dy = v.y - start.y;
        if (!moved && Math.abs(dx) + Math.abs(dy) > 4) moved = true;
        if (moved) dropG.setAttribute("transform", `translate(${dx},${dy})`);
      };
      const up = (e) => {
        dropG.removeEventListener("pointermove", mm);
        dropG.removeEventListener("pointerup", up);
        dropG.removeEventListener("pointercancel", up);
        try { dropG.releasePointerCapture(ev.pointerId); } catch (_) {}
        // The pin is redrawn fresh at its home corner on the next render
        // regardless — no transform to clean up beyond this one frame.
        if (!moved || e.type === "pointercancel") return;
        const v = toVB(e);
        // Dropped outside the drawing entirely (e.g. over the toolbar):
        // treat it the same as a cancelled drag, not a placement at the edge.
        const box = svg.viewBox && svg.viewBox.baseVal;
        if (box && (v.x < box.x || v.x > box.x + box.width || v.y < box.y || v.y > box.y + box.height)) return;
        o.onDropPlace(v.x, v.y);
      };
      dropG.addEventListener("pointermove", mm);
      dropG.addEventListener("pointerup", up);
      dropG.addEventListener("pointercancel", up);
    });
  }

  // Selection highlight — the one selected light (inspector) AND every light
  // in the multi-selection (shift-click, or a room name), so the map and the
  // lit index rows point at the same things.
  const selEid = o.mapState._selLight ? o.mapState._selLight.eid : null;
  const highlight = (eid, strong) => {
    const g = isoDiv.querySelector(`g.lhex[data-eid="${CSS.escape(eid)}"]`);
    // Not just polygons: a marker is a polygon, circle, rect or path depending
    // on the fixture shape, and selecting anything but a hexagon/triangle/
    // diamond would otherwise show no highlight at all. data-hit elements are
    // the invisible click plates, which are never the thing to outline.
    const mark = g && [...g.querySelectorAll("polygon,circle,rect,path,line")]
      .find(n => !n.hasAttribute("data-hit"));
    if (mark) { mark.setAttribute("stroke", "#e879f9"); mark.setAttribute("stroke-width", strong ? "3.5" : "2.2"); }
    return g;
  };
  for (const eid of selSet) if (eid !== selEid) highlight(eid, false);
  if (selEid) {
    const g = highlight(selEid, true);
    if (g && o.mapState._lightsTransform) {
      _wireTransformHandles(ctx, svg, g, selEid, frame, o, toVB);
    }
  }

  // Room name → select every light in the room (the multi-selection).
  for (const rg of isoDiv.querySelectorAll("g.lroom[data-room]")) {
    rg.addEventListener("click", (ev) => {
      ev.stopPropagation();
      const room = rg.getAttribute("data-room");
      const eids = Object.values(o.lightsByEid).filter(l => l.area_name === room).map(l => l.entity_id);
      if (!eids.length) return;
      selSet.clear();
      for (const e of eids) selSet.add(e);
      o.mapState._selLight = { eid: eids[0], mapId: null };
      o.mapState._focusRow = eids[0];
      ctx.actions.renderRooms();
    });
  }

  // The placement queue: while lights are queued, a tap on the GROUND (not
  // on a marker) drops the next one there, in metres, on the floor its room
  // is on — or on the storey in focus when it has no room.
  svg.addEventListener("click", (ev) => {
    const q = o.mapState._placeQueue || [];
    if (!q.length) return;
    if (ev.target && ev.target.closest && ev.target.closest("g.lhex, g.lroom, g.lfloor, .lpick")) return;
    const eid = q[0];
    const l = o.lightsByEid[eid];
    if (!l) { q.shift(); ctx.actions.renderRooms(); return; }
    const floors = ctx.state.model?.floors || [];
    // The room's floor, then a floor it was stored on before, then the
    // lowest drawn storey — same order _floorIdForLight uses for a drag.
    const geo = (ctx.state.model?.room_geometry_m || {})[l.area_name];
    let fid = geo && geo.floor_id ? String(geo.floor_id) : null;
    if (!fid) { const prev = ((ctx.state.model || {}).light_positions_m || {})[eid]; fid = prev && prev.floor_id ? String(prev.floor_id) : null; }
    if (!fid) fid = _floorIdForZ(ctx, frame.levels[0] || 0, frame);
    const z = _levelForFloorId(frame, ctx.state.model, floors, fid);
    const v = toVB(ev);
    const [x_m, y_m] = frame.isoInv(v.x, v.y, z);
    _pushUndo(o.mapState, [eid]);
    _draftAt(ctx, o, eid, x_m, y_m, fid, "manual");
    q.shift();
    o.mapState._selLight = { eid, mapId: null };
    o.mapState._focusRow = eid;
    ctx.toast(q.length ? `Placed ${l.code} · ${q.length} to go — tap the map for ${o.lightsByEid[q[0]] ? o.lightsByEid[q[0]].code : "the next"}` : `Placed ${l.code} — queue done`);
    ctx.actions.renderRooms();
  });

  // Keyboard: arrows nudge the selection in metres (1 cm; 10 cm with Shift);
  // Escape clears the selection AND the placement queue; Ctrl+Z / Ctrl+Y
  // undo and redo. The stage takes focus on a click so the keys reach it.
  isoDiv.setAttribute("tabindex", "0");
  isoDiv.style.outline = "none";
  if (!isoDiv._keysWired) {
    isoDiv._keysWired = true;
    isoDiv.addEventListener("pointerdown", () => { try { isoDiv.focus({ preventScroll: true }); } catch (_) {} });
    isoDiv.addEventListener("keydown", (ev) => {
      const ms = o.mapState;
      if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === "z") { ev.preventDefault(); if (ev.shiftKey) _lightsRedo(ctx, ms); else _lightsUndo(ctx, ms); return; }
      if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === "y") { ev.preventDefault(); _lightsRedo(ctx, ms); return; }
      if (ev.key === "Escape") { (ms._selSet || new Set()).clear(); ms._selLight = null; ms._placeQueue = []; ctx.actions.renderRooms(); return; }
      const step = ev.shiftKey ? 0.10 : 0.01;
      const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[ev.key];
      if (!d) return;
      ev.preventDefault();
      const targets = ms._selSet && ms._selSet.size ? [...ms._selSet] : (ms._selLight ? [ms._selLight.eid] : []);
      const placed = targets.filter(eid => (ms._lightsDraftM || {})[eid] || ((ctx.state.model || {}).light_positions_m || {})[eid]);
      if (!placed.length) return;
      _pushUndo(ms, placed);
      for (const eid of placed) {
        const cur = (ms._lightsDraftM || {})[eid] || ((ctx.state.model || {}).light_positions_m || {})[eid];
        // A deliberate nudge is the same kind of hand-adjustment a drag is —
        // it graduates an approximate position to manual, same as dragging it.
        _draftAt(ctx, o, eid, Number(cur.x_m) + d[0], Number(cur.y_m) + d[1], cur.floor_id, "manual");
      }
      ctx.actions.renderRooms();
    });
  }

  for (const g of isoDiv.querySelectorAll("g.lhex[data-eid]")) {
    const eid = g.getAttribute("data-eid");
    const z = parseFloat(g.getAttribute("data-z") || "0");

    // Pointer events, not mouse events: one code path covers mouse, touch and
    // pen (the builder was unusable on a tablet), and pointer capture
    // guarantees the release fires even if the finger/cursor leaves the SVG —
    // which is what previously left _editDragging stuck true and froze every
    // panel render until reload.
    // Without this the browser claims the gesture for panning/scrolling and
    // the pointermove stream stops after a few pixels — touch drag would look
    // supported and silently do nothing.
    g.style.touchAction = "none";
    g.addEventListener("pointerdown", (ev) => {
      if (ev.button !== 0 && ev.pointerType === "mouse") return;
      ev.preventDefault(); ev.stopPropagation();
      const start = toVB(ev);
      // Grab offset: dragging must move the hex by the pointer's DELTA, not
      // teleport its centre to the pointer — otherwise grabbing a hex near its
      // edge snaps the light sideways by that offset on drop.
      // Anchor on the fixture's own centre, which the renderer stamps on the
      // group and which is never scaled or rotated. The group's bounding box
      // is NOT that centre: it includes the code label's box below the marker,
      // so it sat about 6 px low and every drag landed high by that much —
      // consistently, which on a short move reads as the light snapping back.
      // Reading it off the label's own x/y worked only while the label sits ON
      // the marker; in Showcase it moves below, and the offset would be back.
      // parseFloat, not Number: Number(null) is 0, which is a real coordinate,
      // so a marker without the attribute would silently anchor at the origin.
      let originCx = parseFloat(g.getAttribute("data-cx"));
      let originCy = parseFloat(g.getAttribute("data-cy"));
      if (!Number.isFinite(originCx) || !Number.isFinite(originCy)) {
        try {
          const bb = g.getBBox();
          originCx = bb.x + bb.width / 2;
          originCy = bb.y + bb.height / 2;
        } catch (_) { originCx = start.x; originCy = start.y; }
      }
      let moved = false;
      try { g.setPointerCapture(ev.pointerId); } catch (_) {}
      // Group drag: when the grabbed light is part of the multi-selection,
      // every selected PLACED light moves with it by the same delta — each
      // from its own centre, so the arrangement is kept.
      const group = (selSet.has(eid) && selSet.size > 1)
        ? [...selSet].filter(e2 => e2 !== eid).map(e2 => {
            const g2 = isoDiv.querySelector(`g.lhex[data-eid="${CSS.escape(e2)}"][data-placed="1"]`);
            return g2 ? { eid: e2, g: g2, cx: parseFloat(g2.getAttribute("data-cx")), cy: parseFloat(g2.getAttribute("data-cy")),
                          z: parseFloat(g2.getAttribute("data-z") || "0") } : null;
          }).filter(Boolean)
        : [];
      const mm = (e) => {
        const v = toVB(e);
        const dx = v.x - start.x, dy = v.y - start.y;
        // Arm the drag (and the render freeze) only once this is genuinely a
        // drag. 8px, not 3: every hex is draggable now, so a twitch while
        // select-clicking an auto-clustered light would pin it. 3px is inside
        // normal click jitter (and inside a fingertip's), 8px is not.
        if (!moved && Math.abs(dx) + Math.abs(dy) > 8) {
          moved = true;
          o.mapState._editDragging = true;   // suppress poll re-renders mid-drag
        }
        if (moved) {
          g.setAttribute("transform", `translate(${dx},${dy})`);
          for (const m of group) m.g.setAttribute("transform", `translate(${dx},${dy})`);
        }
      };
      const up = (e) => {
        g.removeEventListener("pointermove", mm);
        g.removeEventListener("pointerup", up);
        g.removeEventListener("pointercancel", up);
        try { g.releasePointerCapture(ev.pointerId); } catch (_) {}
        o.mapState._editDragging = false;
        if (!moved || e.type === "pointercancel") {
          // Plain click (or a cancelled gesture): select the light; the
          // inspector holds the tools. Never write a position here.
          // Shift-click adds to / removes from the multi-selection instead.
          g.removeAttribute("transform");
          for (const m of group) m.g.removeAttribute("transform");
          if (ev.shiftKey || (o.mapState._multiSelect && e.type !== "pointercancel")) {
            if (selSet.has(eid)) selSet.delete(eid); else selSet.add(eid);
            if (o.mapState._selLight && selSet.size && !selSet.has(o.mapState._selLight.eid)) selSet.add(o.mapState._selLight.eid);
          } else {
            selSet.clear();
          }
          o.mapState._selLight = { eid, mapId: null };
          o.mapState._focusRow = eid;
          ctx.actions.renderRooms();
          return;
        }
        const v = toVB(e);
        // Straight to metres. The fabric IS the coordinate system, so there is
        // no scale to look up, no map to own the light, and nothing to refuse
        // when no photo has been measured.
        const [x_mRaw, y_mRaw] = frame.isoInv(originCx + (v.x - start.x),
                                              originCy + (v.y - start.y), z);
        const floorId = _floorIdForLight(ctx, eid, z, frame, o.lightsByEid);
        _pushUndo(o.mapState, [eid, ...group.map(m => m.eid)]);
        // The draft entry keeps whatever look the light had (draft first, then
        // committed): moving a light must never throw away its sizing.
        // Size stays 0 = "the default marker" unless it was set; margin is
        // left unset so the scale-aware default keeps applying; a hand drop
        // is "manual" provenance whatever it was before.
        _draftAt(ctx, o, eid, x_mRaw, y_mRaw, floorId, "manual");
        for (const m of group) {
          const [mx, my] = frame.isoInv(m.cx + (v.x - start.x), m.cy + (v.y - start.y), m.z);
          _draftAt(ctx, o, m.eid, mx, my, _floorIdForLight(ctx, m.eid, m.z, frame, o.lightsByEid), "manual");
        }
        o.mapState._selLight = { eid, mapId: null };
        o.mapState._focusRow = eid;
        ctx.actions.renderRooms();
      };
      g.addEventListener("pointermove", mm);
      g.addEventListener("pointerup", up);
      g.addEventListener("pointercancel", up);
    });
  }
}

// ── Free transform: resize and rotate a light on the map itself ────────────
// Typing centimetres into a box is a poor way to describe a light you can see.
// The handles work in SCREEN space, which is also the space markerSvg applies
// width/height/rotation in, so what is dragged is exactly what is stored:
// dragging a handle to N pixels from the centre sets that half-axis to N/scale
// metres. Written into the same draft the drag uses, so one Save commits both.
// ── Right-click: reach what is underneath ──────────────────────────────────
// A fixture drawn at its real size covers its neighbours — a 4 m valance sits
// on top of the downlights beside it, and left-click always hits the topmost
// thing, so the small ones became unreachable exactly once the map started
// telling the truth about size. Right-click lists everything under the
// pointer, SMALLEST FIRST, because the small one is the one you could not get
// to any other way.
function _wireLightsPicker(ctx, isoDiv, svg, o, toVB) {
  const close = () => {
    const old = isoDiv.querySelector(".lpick");
    if (old) old.remove();
  };
  isoDiv.addEventListener("pointerdown", (ev) => { if (ev.button !== 2) close(); }, true);

  svg.addEventListener("contextmenu", (ev) => {
    ev.preventDefault();
    close();
    const v = toVB(ev);
    const hits = [];
    for (const g of svg.querySelectorAll("g.lhex[data-eid]")) {
      let bb;
      try { bb = g.getBBox(); } catch (_) { continue; }
      // A little slack so a 1-2 px marker is still catchable.
      const pad = 3;
      if (v.x < bb.x - pad || v.x > bb.x + bb.width + pad) continue;
      if (v.y < bb.y - pad || v.y > bb.y + bb.height + pad) continue;
      hits.push({ eid: g.getAttribute("data-eid"), area: bb.width * bb.height });
    }
    if (!hits.length) return;
    hits.sort((a, b) => a.area - b.area);

    const menu = el("div", { class: "lpick", style:
      "position:fixed;z-index:9999;background:#0a150e;border:1px solid #2d6a4f;"
      + "border-radius:10px;padding:5px;box-shadow:0 10px 30px rgba(0,0,0,0.7);"
      + "max-height:260px;overflow:auto;min-width:196px" });
    menu.appendChild(el("div", { style:
      "font-size:9px;color:#64748b;padding:3px 8px 6px;text-transform:uppercase;"
      + "letter-spacing:0.07em;border-bottom:1px solid #16281d;margin-bottom:3px" },
      hits.length + " here · smallest first"));
    for (const h of hits) {
      const l = o.lightsByEid[h.eid];
      const name = l ? (l.friendly_name || h.eid) : h.eid;
      const code = l && l.code ? l.code + "  " : "";
      const row = el("button", { class: "btn tiny", style:
        "display:block;width:100%;text-align:left;margin:1px 0;font-size:11px",
        onclick: () => {
          close();
          o.mapState._selLight = { eid: h.eid, mapId: null };
          ctx.actions.renderRooms();
        },
      }, code + String(name).slice(0, 34));
      menu.appendChild(row);
    }
    menu.style.left = Math.min(ev.clientX, window.innerWidth - 220) + "px";
    menu.style.top = Math.min(ev.clientY, window.innerHeight - 280) + "px";
    isoDiv.appendChild(menu);
  });
}

function _wireTransformHandles(ctx, svg, g, eid, frame, o, toVB) {
  const NS = "http://www.w3.org/2000/svg";
  // The code label is drawn at the fixture's exact centre and is never scaled
  // or rotated, so it is the reliable anchor. The group's bounding box is not:
  // it grows with the scaled outline and with the label's own box, so handles
  // drifted off-centre exactly when the fixture was largest.
  let cx, cy;
  const lblEl = g.querySelector("text");
  if (lblEl) { cx = Number(lblEl.getAttribute("x")); cy = Number(lblEl.getAttribute("y")); }
  if (!Number.isFinite(cx) || !Number.isFinite(cy)) {
    try { const bb = g.getBBox(); cx = bb.x + bb.width / 2; cy = bb.y + bb.height / 2; }
    catch (_) { return; }
  }

  const cur = () => (o.mapState._lightsDraftM || {})[eid]
    || ((ctx.state.model || {}).light_positions_m || {})[eid] || {};
  const entry = cur();
  // What the fixture measures now, in drawn pixels — a metre is frame.scale px.
  const halfW = Math.max(14, ((Number(entry.width_cm) || 0) / 100) * frame.scale / 2);
  const halfH = Math.max(14, ((Number(entry.height_cm) || 0) / 100) * frame.scale / 2);
  const ROT_UP = halfH + 34;

  const layer = document.createElementNS(NS, "g");
  layer.setAttribute("class", "lxform");
  // A soft glow lifts the handles off whatever they sit on, so they read as
  // controls rather than as more of the drawing.
  const defs = document.createElementNS(NS, "defs");
  defs.innerHTML = '<filter id="lxfglow" x="-60%" y="-60%" width="220%" height="220%">'
    + '<feDropShadow dx="0" dy="0" stdDeviation="2.4" flood-color="#e879f9" flood-opacity="0.55"/>'
    + '</filter>';
  layer.appendChild(defs);
  layer.setAttribute("pointer-events", "all");
  svg.appendChild(layer);

  const line = document.createElementNS(NS, "line");
  line.setAttribute("x1", cx); line.setAttribute("y1", cy);
  line.setAttribute("x2", cx); line.setAttribute("y2", cy - ROT_UP);
  line.setAttribute("stroke", "#e879f9"); line.setAttribute("stroke-width", "1.5");
  line.setAttribute("stroke-dasharray", "4,3"); line.setAttribute("opacity", "0.8");
  layer.appendChild(line);

  const box = document.createElementNS(NS, "rect");
  box.setAttribute("x", cx - halfW); box.setAttribute("y", cy - halfH);
  box.setAttribute("width", halfW * 2); box.setAttribute("height", halfH * 2);
  box.setAttribute("fill", "none"); box.setAttribute("stroke", "#e879f9");
  box.setAttribute("stroke-width", "1.1"); box.setAttribute("stroke-dasharray", "6,5");
  box.setAttribute("opacity", "0.55"); box.setAttribute("pointer-events", "none");
  layer.appendChild(box);

  // kind: "w" widens, "h" lengthens, "wh" does both, "rot" turns.
  const mkHandle = (hx, hy, kind, cursor, title) => {
    const h = kind === "rot"
      ? document.createElementNS(NS, "circle")
      : document.createElementNS(NS, "rect");
    if (kind === "rot") {
      h.setAttribute("cx", hx); h.setAttribute("cy", hy); h.setAttribute("r", 8);
    } else {
      h.setAttribute("x", hx - 6.5); h.setAttribute("y", hy - 6.5);
      h.setAttribute("width", 13); h.setAttribute("height", 13); h.setAttribute("rx", 4);
    }
    h.setAttribute("fill", "#f0abfc");
    h.setAttribute("stroke", "#0a0512");
    h.setAttribute("stroke-width", "1.6");
    h.setAttribute("filter", "url(#lxfglow)");
    h.style.cursor = cursor;
    h.style.touchAction = "none";
    const t = document.createElementNS(NS, "title");
    t.textContent = title;
    h.appendChild(t);

    h.addEventListener("pointerdown", (ev) => {
      ev.preventDefault(); ev.stopPropagation();
      try { h.setPointerCapture(ev.pointerId); } catch (_) {}
      o.mapState._editDragging = true;
      const inner = g.querySelector("g[transform]") || g;
      const base = cur();
      let next = {
        rotation: Number(base.rotation) || 0,
        width_cm: Number(base.width_cm) || 0,
        height_cm: Number(base.height_cm) || 0,
      };

      const mm = (e) => {
        const v = toVB(e);
        if (kind === "rot") {
          const deg = Math.atan2(v.y - cy, v.x - cx) * 180 / Math.PI + 90;
          next.rotation = Math.max(-180, Math.min(180, Math.round(deg)));
        } else {
          if (kind.includes("w")) next.width_cm = cmFromHandlePx(v.x - cx, frame.scale);
          if (kind.includes("h")) next.height_cm = cmFromHandlePx(v.y - cy, frame.scale);
        }
        // Live preview on the marker itself — the map is the feedback, so the
        // shape follows the handle rather than waiting for the pointer up.
        // The renderer's own function, so the preview cannot disagree with
        // what lands on pointer-up.
        const { sx, sy } = markerScale(next.width_cm, next.height_cm,
                                       frame.scale, markerRadiusPx(frame.scale));
        inner.setAttribute("transform",
          `translate(${cx.toFixed(1)},${cy.toFixed(1)}) rotate(${next.rotation}) `
          + `scale(${sx.toFixed(3)},${sy.toFixed(3)})`);
      };
      const up = () => {
        h.removeEventListener("pointermove", mm);
        h.removeEventListener("pointerup", up);
        h.removeEventListener("pointercancel", up);
        try { h.releasePointerCapture(ev.pointerId); } catch (_) {}
        o.mapState._editDragging = false;
        _pushUndo(o.mapState, [eid]);
        const draft = o.mapState._lightsDraftM || (o.mapState._lightsDraftM = {});
        const prev = draft[eid] || { ...(((ctx.state.model || {}).light_positions_m || {})[eid] || {}) };
        // Sizing a light that has never been placed PLACES it, at the spot it
        // is already drawn — the middle of its room, where it has been sitting
        // in the auto-cluster. fabric_light_position_set requires x_m/y_m, so
        // without this a resize built a draft that could only fail on save;
        // refusing the handles instead just moved the dead end earlier. The
        // light is visibly somewhere, so that is where it goes.
        if (prev.x_m == null || prev.y_m == null) {
          const z = parseFloat(g.getAttribute("data-z") || "0");
          const [px_m, py_m] = frame.isoInv(cx, cy, z);
          prev.x_m = Math.round(px_m * 1000) / 1000;
          prev.y_m = Math.round(py_m * 1000) / 1000;
          prev.floor_id = prev.floor_id
            || _floorIdForLight(ctx, eid, z, frame, o.lightsByEid);
          if (!prev.color) prev.color = "#fbbf24";
        }
        draft[eid] = { ...prev, ...next };
        ctx.actions.renderRooms();
      };
      h.addEventListener("pointermove", mm);
      h.addEventListener("pointerup", up);
      h.addEventListener("pointercancel", up);
    });
    layer.appendChild(h);
  };

  mkHandle(cx, cy - ROT_UP, "rot", "grab", "Rotate");
  mkHandle(cx + halfW, cy, "w", "ew-resize", "Width");
  mkHandle(cx, cy + halfH, "h", "ns-resize", "Length");
  mkHandle(cx + halfW, cy + halfH, "wh", "nwse-resize", "Width + length");
}

function _lightsTab(ctx, maps, active) {
  const { el } = ctx.helpers;
  const mapState = ctx.state.maps;
  const wrap = el("div", {});
  if (!mapState._lightsDraftM) mapState._lightsDraftM = {};

  // Identical map = identical inputs: the same hidden-maps filter the
  // sidebar applies (init from the same persisted setting if the 3D Stack
  // tab hasn't already done so this session).
  if (!mapState._hiddenMapIds) {
    const savedIds = ctx.state.settings?.hidden_map_ids;
    if (Array.isArray(savedIds)) {
      mapState._hiddenMapIds = new Set(savedIds);
    } else {
      try {
        const stored = JSON.parse(localStorage.getItem("padspan_hiddenMapIds") || "[]");
        mapState._hiddenMapIds = new Set(Array.isArray(stored) ? stored : []);
      } catch(e) { mapState._hiddenMapIds = new Set(); }
    }
  }

  // Shared registry pipeline — the same implementation and staleness rule as
  // the sidebar, so the two views can never disagree on room assignment.
  // Guarded on the model so area NAMES exist before the areaMap is cached.
  if (!ctx.state._lightsRegStore) ctx.state._lightsRegStore = {};
  const areas = ctx.state.model?.areas || [];
  const floors = ctx.state.model?.floors || [];
  const reg = ctx.state._modelLoaded
    ? ensureLightsRegistry(ctx.state._lightsRegStore, ctx.hass, areas, () => ctx.actions.renderRooms())
    : { areaMap: {}, platformMap: {}, loading: true };
  const shapeOverrides = (ctx.state.settings?.light_shapes && typeof ctx.state.settings.light_shapes === "object")
    ? ctx.state.settings.light_shapes : {};
  const tier = ctx.state.settings?.tier;
  // Below `bright` this tab is the free lighting map: the shared card draws
  // the free view by itself (lights_map.js), and the build tools — transform,
  // drag, the inspector, unsaved-work bar — are not offered. A hex toggles
  // the light, as it does in the sidebar. Nothing stored is touched: enter a
  // key and every placement is back.
  const paid = _isPro(ctx);
  if (!paid) { mapState._lightsDraftM = {}; mapState._selLight = null; mapState._lightsTransform = false; }
  // The type override is PRO specifically — not the bright-or-pro gate
  // _isPro answers. (_isPro's name predates the tier ladder; it means paid.)
  const proTier = String(tier || "").toLowerCase() === "pro";
  const typeOverrides = (ctx.state.settings?.light_type_overrides && typeof ctx.state.settings.light_type_overrides === "object")
    ? ctx.state.settings.light_type_overrides : {};
  const lights = gatherLights(ctx.hass?.states || {}, reg.areaMap, shapeOverrides, tier, reg.platformMap, typeOverrides, reg.pairMap);

  // Preview-as-panel: the exact sidebar interaction model, in place, on the
  // same camera — so "what will the household see" is one toggle away
  // without leaving the builder. A VIEW mode of this tab, never persisted.
  const preview = paid && !!mapState._lightsPreview;
  const head = el("div", { class: "card lv-mapcard", style: "margin-bottom:12px" }, [
    el("div", { class: "card-head", style: "display:flex;gap:10px;align-items:center;flex-wrap:wrap" }, [
      el("div", { class: "lv-hero-title", style: "font-size:16px" }, "Lights"),
      // The mode, unmistakably: this tab EDITS the map the sidebar shows. A
      // map that both operates and moves devices is a mode error waiting to
      // happen, so the badge (and the drafting grid on the stage) say which
      // one you are in at every moment.
      ...(paid ? [el("span", { class: "lv-editing", style: preview ? "color:#8ee5b4;border-color:rgba(82,183,136,.55);background:rgba(82,183,136,.1)" : "" },
        preview ? "Preview · as the sidebar" : "Editing")] : []),
      el("span", { class: "lv-hint" }, paid
        ? (preview
          ? "Exactly what the Lights sidebar does with this map: tap switches, code or hold opens controls, room names open the room."
          : "Builds the Lights sidebar's map — what you arrange here is exactly what the sidebar shows. Click a hex to select a light; drag it to where it really is. Shift-click or click a room name to select several. Can't find one on the map? Pick it in the list below — a ring flashes its spot, and the pink marker in the corner drags it into place.")
        : "Every light in the house, one marker each, in its room. Click a marker to switch it."),
    ]),
  ]);
  wrap.appendChild(head);
  if (!paid) {
    wrap.appendChild(el("div", { class: "card lv-tablecard", style: "padding:10px 12px;border:1px solid rgba(251,191,36,.45);box-shadow:0 0 18px rgba(251,191,36,.07);font-size:12px;margin-bottom:12px" }, [
      el("span", { style: "font-weight:700;color:#fbbf24" }, "Free lighting map. "),
      el("span", { class: "muted" },
        "Placing each light where it really is, fixture shapes, sizes and angles, WLED strips, Showcase and Fit room "
        + "need PadSpan Bright Pro or PadSpan Pro. Already have a key? Enter it in " + _LIC_PATH + ". "),
      el("a", { href: _LIC_BUY_URL, target: "_blank", rel: "noopener", style: "color:#fbbf24;font-weight:700" },
        "Get PadSpan Pro \u2014 " + _LIC_PRICE),
    ]));
  }

  if (!lights.length) {
    head.appendChild(el("div", { class: "muted", style: "padding:8px" },
      "No light entities found in Home Assistant."));
    return wrap;
  }

  const lightsByEid = {};
  for (const l of lights) lightsByEid[l.entity_id] = l;

  // Hidden lights — the same backend set the sidebar persists.
  const hiddenEids = new Set(Array.isArray(ctx.state.settings?.lights_hidden) ? ctx.state.settings.lights_hidden : []);

  const byRoom = {};
  for (const l of lights) {
    if (l.area_name && !hiddenEids.has(l.entity_id)) (byRoom[l.area_name] = byRoom[l.area_name] || []).push(l);
  }

  // Drop a selection that no longer resolves (light removed from HA)
  if (mapState._selLight && !lightsByEid[mapState._selLight.eid]) mapState._selLight = null;

  // "Hide untouched" — the placements a light's own work is recorded in, draft
  // first so a fixture you are sizing right now does not vanish mid-edit.
  const placements = { ...((ctx.state.model || {}).light_positions_m || {}),
                       ...(mapState._lightsDraftM || {}) };
  const hideUntouched = mapState._lightsHideUntouched === undefined
    ? !!ctx.state.settings?.lights_hide_untouched
    : !!mapState._lightsHideUntouched;
  const untouchedCount = lights.filter(l => !lightIsTouched(l, shapeOverrides, placements)).length;

  const toggle = async (eid) => {
    if (!ctx.hass) return;
    // Service domain is the entity's own (light / fan); a motion sensor is
    // read-only — same rules as the sidebar. So is a temperature sensor.*.
    const domain = String(eid).split(".")[0];
    if (domain === "binary_sensor") { ctx.toast("Motion sensors are read-only"); return; }
    if (domain === "sensor") { ctx.toast("Temperature sensors are read-only"); return; }
    const on = ctx.hass.states[eid]?.state === "on";
    // Optimistic, like the sidebar: the marker flips now, HA reconciles.
    setOptimistic(eid, on ? "off" : "on");
    ctx.actions.renderRooms();
    try {
      // Off→on restores the last dimmed level (shared memory in
      // lights_map.js) — same behaviour as the sidebar, same source, so the
      // two views cannot disagree about what "on" brings back.
      const data = { entity_id: eid };
      if (!on && domain === "light") {
        const bri = lastBrightness(eid);
        if (bri !== null) data.brightness = bri;
      }
      await ctx.hass.callService(domain, on ? "turn_off" : "turn_on", data);
      setTimeout(() => ctx.actions.renderRooms(), 600);
    } catch(err) {
      clearOptimistic(eid);
      ctx.actions.renderRooms();
      ctx.toast("Could not toggle " + eid, true);
    }
  };
  // The sidebar's exact api, for Preview-as-sidebar (shared use surface).
  const controlsFor = (l0) => !!(l0 && (l0.isWled || l0.isPartition || l0.dimmable || l0.isFan));
  const previewApi = {
    hass: ctx.hass, lightsByEid, lights, controlsFor,
    toggle, toast: (m, e) => ctx.toast(m, e), rerender: () => ctx.actions.renderRooms(),
    openControls: (eid) => openControlCard(ctx.hass, eid, { toast: (m, e) => ctx.toast(m, e), rerender: () => ctx.actions.renderRooms() }),
    openActivity: (eid) => openActivityCalendar(ctx.hass, eid),
    setMany: (eids, on) => setManyStates(ctx.hass, eids, on, { toast: (m, e) => ctx.toast(m, e), rerender: () => ctx.actions.renderRooms() }),
  };
  previewApi.openRoom = (room, onlyEids) => openRoomSheet(previewApi, lights, room, onlyEids);
  previewApi.openFloor = (z) => openFloorSheet(previewApi, lights, ctx.state.model, z);

  // View settings live in mapState so slider positions survive re-renders;
  // seeded from (and saved to) the SAME settings keys the sidebar uses.
  if (!mapState._lightsView) mapState._lightsView = {
    floorGap: ctx.state.settings?.overview_iso_floor_gap ?? 150,
    horizGap: ctx.state.settings?.overview_iso_horiz_gap ?? 0,
    focusIdx: ctx.state.settings?.overview_iso_focus ?? 0,
    zoom: 1.0,
  };
  const view = mapState._lightsView;

  // ── Transform mode ──────────────────────────────────────────────────────
  // Off by default: with handles live, a stray drag near a fixture resizes it
  // instead of moving it, and moving is the common action.
  const xfBtn = !paid ? null : el("button", {
    class: "lv-tgl tone-violet" + (mapState._lightsTransform ? " on" : ""),
    onclick: () => {
      mapState._lightsTransform = !mapState._lightsTransform;
      ctx.actions.renderRooms();
    },
  }, mapState._lightsTransform ? "⬒ Transform: ON" : "⬒ Transform");
  // The builder's checklist: how much of the house is actually placed.
  const nPlaced = lights.filter(l => placements[l.entity_id]).length;
  const nApprox = lights.filter(l => placements[l.entity_id] && placements[l.entity_id].source === "auto").length;
  const nNoRoom = lights.filter(l => !l.area_name).length;
  const nUnplaced = lights.length - nPlaced;
  const selSet = mapState._selSet || (mapState._selSet = new Set());
  const queue = mapState._placeQueue || (mapState._placeQueue = []);
  const undoSt = _undoStack(mapState);
  if (paid && !preview) wrap.appendChild(el("div", { class: "card lv-tablecard", style: "display:flex;gap:10px;align-items:center;flex-wrap:wrap;padding:8px 12px;margin-bottom:12px" }, [
    xfBtn,
    el("button", {
      class: "lv-tgl tone-blue" + (mapState._multiSelect ? " on" : ""),
      title: "Touch-friendly multi-select: every tap adds to the selection (Shift-click does the same with a mouse)",
      onclick: () => { mapState._multiSelect = !mapState._multiSelect; ctx.actions.renderRooms(); },
    }, mapState._multiSelect ? "⧉ Select several: ON" : "⧉ Select several"),
    el("button", { class: "lv-act", title: "Undo the last unsaved edit (Ctrl+Z)", disabled: undoSt.canUndo ? null : "disabled",
      onclick: () => _lightsUndo(ctx, mapState) }, "↶ Undo"),
    el("button", { class: "lv-act", title: "Redo (Ctrl+Y)", disabled: undoSt.canRedo ? null : "disabled",
      onclick: () => _lightsRedo(ctx, mapState) }, "↷ Redo"),
    el("button", {
      class: "lv-tgl tone-green",
      title: "See this map exactly as the Lights sidebar shows it, without leaving the builder",
      onclick: () => { mapState._lightsPreview = true; ctx.actions.renderRooms(); },
    }, "▶ Preview as sidebar"),
    el("span", { class: "lv-check" }, [
      el("b", {}, String(nPlaced)), "placed",
      ...(nApprox ? ["·", el("b", {}, String(nApprox)), "approximate"] : []),
      "·", el("b", {}, String(nUnplaced)), "unplaced",
      ...(nNoRoom ? ["·", el("b", {}, String(nNoRoom)), "no room"] : []),
    ]),
    el("span", { class: "lv-hint", style: "flex-basis:100%" },
      mapState._lightsTransform
        ? "Drag a light to move it. Drag its handles to resize; the round handle above rotates. Arrow keys nudge 1 cm (Shift: 10 cm)."
        : "Drag any light to move it. Turn on Transform for resize and rotate handles. Arrow keys nudge the selection 1 cm (Shift: 10 cm)."),
  ]));
  if (paid && preview) wrap.appendChild(el("div", { class: "card lv-tablecard", style: "display:flex;gap:10px;align-items:center;flex-wrap:wrap;padding:8px 12px;margin-bottom:12px" }, [
    el("button", { class: "lv-tgl tone-violet on", onclick: () => { mapState._lightsPreview = false; ctx.actions.renderRooms(); } }, "✎ Back to editing"),
    el("span", { class: "lv-hint" }, "Nothing you do here changes the map — this is the sidebar's behaviour on the builder's camera."),
  ]));

  // ── Placement bar: the queue, spread-in-room, accept room centres ──────
  // Bulk placement without dragging a pile apart. Queue lights from their
  // index rows (or all of them), then tap the map once per light. Or spread
  // a room's unplaced lights evenly inside its polygon in one go.
  if (paid && !preview && nUnplaced) {
    const roomsWithUnplaced = [...new Set(lights.filter(l => l.area_name && !placements[l.entity_id]).map(l => l.area_name))].sort();
    const roomSel = document.createElement("select");
    roomSel.className = "lv-select";
    for (const r of roomsWithUnplaced) {
      const n = lights.filter(l => l.area_name === r && !placements[l.entity_id]).length;
      roomSel.appendChild(el("option", { value: r }, `${r} · ${n}`));
    }
    if (mapState._spreadRoom && roomsWithUnplaced.includes(mapState._spreadRoom)) roomSel.value = mapState._spreadRoom;
    roomSel.addEventListener("change", () => { mapState._spreadRoom = roomSel.value; });
    const floors0 = ctx.state.model?.floors || [];
    const frame0 = fabricFrame(ctx.state.model, floors0, view.floorGap, view.horizGap);
    const spread = (room) => {
      const geo = (ctx.state.model?.room_geometry_m || {})[room];
      if (!geo || geo.type !== "poly" || !Array.isArray(geo.points_m)) { ctx.toast("That room has no polygon to spread in", true); return; }
      const eids = lights.filter(l => l.area_name === room && !placements[l.entity_id]).map(l => l.entity_id);
      if (!eids.length) return;
      const pts = spreadInRoom(geo.points_m, eids.length, 0.5);
      const fid = String(geo.floor_id || _floorIdForZ(ctx, frame0.levels[0] || 0, frame0));
      _pushUndo(mapState, eids);
      eids.forEach((eid, i) => _draftAt(ctx, { mapState, lightsByEid }, eid, pts[i][0], pts[i][1], fid, "manual"));
      selSet.clear(); for (const e of eids) selSet.add(e);
      mapState._selLight = { eid: eids[0], mapId: null };
      ctx.toast(`Spread ${eids.length} in ${room} — drag any to fine-tune, then Save`);
      ctx.actions.renderRooms();
    };
    wrap.appendChild(el("div", { class: "card lv-tablecard", style: "display:flex;gap:10px;align-items:center;flex-wrap:wrap;padding:8px 12px;margin-bottom:12px" }, [
      el("span", { class: "lv-lbl" }, "Place"),
      el("button", {
        class: "lv-act" + (queue.length ? " primary" : ""),
        title: queue.length ? "Tap the map once per queued light, in index order. Esc clears." : "Queue every unplaced light, then tap the map once per light",
        onclick: () => {
          if (queue.length) { mapState._placeQueue = []; }
          else mapState._placeQueue = lights.filter(l => !placements[l.entity_id]).map(l => l.entity_id);
          ctx.actions.renderRooms();
        },
      }, queue.length ? `◎ ${queue.length} queued — tap the map · clear` : "◎ Queue all unplaced"),
      ...(queue.length ? [el("span", { class: "lv-hint" }, `Next: ${lightsByEid[queue[0]] ? lightsByEid[queue[0]].code + " " + lightsByEid[queue[0]].friendly_name : queue[0]}`)] : []),
      el("span", { class: "lv-sep" }, ""),
      el("span", { class: "lv-lbl" }, "Spread"),
      roomSel,
      el("button", { class: "lv-act", title: "Place this room's unplaced lights on an even grid inside the room, inset from its walls",
        onclick: () => spread(roomSel.value) }, "⊞ Spread in room"),
      el("span", { class: "lv-sep" }, ""),
      el("button", { class: "lv-act", title: "Give every unplaced light with a room its room's centre as an APPROXIMATE position (drawn with a dashed halo until moved)",
        onclick: () => {
          const eids = lights.filter(l => l.area_name && !placements[l.entity_id]).map(l => l.entity_id);
          if (!eids.length) return;
          _pushUndo(mapState, eids);
          let n = 0;
          for (const eid of eids) {
            const geo = (ctx.state.model?.room_geometry_m || {})[lightsByEid[eid].area_name];
            if (!geo) continue;
            const pts = geo.type === "poly" ? geo.points_m : null;
            const cx = pts ? pts.reduce((a, p) => a + p[0], 0) / pts.length : Number(geo.cx_m) || 0;
            const cy = pts ? pts.reduce((a, p) => a + p[1], 0) / pts.length : Number(geo.cy_m) || 0;
            const fid = String(geo.floor_id || _floorIdForZ(ctx, frame0.levels[0] || 0, frame0));
            _draftAt(ctx, { mapState, lightsByEid }, eid, cx, cy, fid, "auto");
            n++;
          }
          ctx.toast(`${n} approximate positions — Save to keep them`);
          ctx.actions.renderRooms();
        } }, "≈ Accept room centres"),
    ]));
  }

  // Unsaved-work bar
  const dirtyEids = Object.keys(mapState._lightsDraftM || {});
  if (dirtyEids.length) {
    const bar = el("div", { class: "card lv-tablecard", style: "display:flex;gap:10px;align-items:center;flex-wrap:wrap;padding:10px 12px;border:1px solid rgba(251,191,36,.5);box-shadow:0 0 18px rgba(251,191,36,.08);margin-bottom:12px" }, [
      el("span", { style: "font-size:12px;color:#fbbf24;font-weight:600" },
        `${dirtyEids.length} unsaved light placement${dirtyEids.length !== 1 ? "s" : ""}`),
      el("button", { class: "btn inline primary", onclick: async (e) => {
        const btn = e.currentTarget;
        btn.disabled = true; btn.textContent = "Saving…";
        // Drop each map from the draft as it lands. If a later one fails, the
        // ones already written stay written and are no longer offered as
        // unsaved — reporting "failed" for work that IS saved would push the
        // user to retry and re-send it.
        let saved = 0;
        try {
          for (const eid of dirtyEids) {
            // "source" (provenance: manual/auto) is a draft-only, pre-save
            // signal — the backend schema has no field for it and a stray
            // extra key fails the whole call. It exists to draw the
            // APPROXIMATE badge and the dashed halo before Save; it does not
            // need to survive one (an accepted room centre still IS just a
            // placement — the next drag makes it a real one).
            const { source, ...lp } = mapState._lightsDraftM[eid];
            await ctx.actions.wsCall("padspan_ha/fabric_light_position_set", { entity_id: eid, ...lp });
            delete mapState._lightsDraftM[eid];
            saved++;
          }
          await ctx.actions.modelRefresh();
          _undoStack(mapState).clear();   // what is committed is not undoable from here
          ctx.toast("Light placements saved ✔");
        } catch(err) {
          await ctx.actions.mapsRefreshQuiet();
          ctx.toast(saved
            ? `Saved ${saved} of ${dirtyEids.length} — the rest failed: ${err.message || err}`
            : "Save failed: " + (err.message || err), true);
        }
        ctx.actions.renderRooms();
      } }, "💾 Save placements"),
      el("button", { class: "btn inline", onclick: () => {
        mapState._lightsDraftM = {};
        mapState._selLight = null;
        _undoStack(mapState).clear();
        ctx.actions.renderRooms();
      } }, "Discard"),
    ]);
    wrap.appendChild(bar);
  }

  // ── THE shared map card — identical to the Lights sidebar ───────────────
  // Unsaved drags overlay the fabric's light positions; maps are untouched.
  const modelForRender = Object.keys(mapState._lightsDraftM || {}).length
    ? { ...ctx.state.model,
        light_positions_m: { ...(ctx.state.model?.light_positions_m || {}), ...mapState._lightsDraftM } }
    : ctx.state.model;
  // Hoisted out of the host object literal (rather than read back off
  // `host.onDropPlace` inside it, which does not exist yet mid-construction)
  // because _wireLightsBuild — wired below via onHexesBuilt — needs this
  // SAME function to actually drive the pin's drag.
  const onDropPlace = (paid && !preview && mapState._selLight) ? (vbX, vbY) => {
    const sel = mapState._selLight;
    const l = lightsByEid[sel.eid];
    if (!l) return;
    // The floor comes from the light's own room (or its prior placement,
    // or the lowest drawn storey) — exactly the same precedence the
    // placement queue already uses, so the two "drop it somewhere" tools
    // never disagree about which storey a bare x/y lands on.
    const floors2 = ctx.state.model?.floors || [];
    const frame2 = fabricFrame(ctx.state.model, floors2, view.floorGap, view.horizGap);
    const geo = (ctx.state.model?.room_geometry_m || {})[l.area_name];
    let fid = geo && geo.floor_id ? String(geo.floor_id) : null;
    if (!fid) { const prev = ((ctx.state.model || {}).light_positions_m || {})[sel.eid]; fid = prev && prev.floor_id ? String(prev.floor_id) : null; }
    if (!fid) fid = _floorIdForZ(ctx, frame2.levels[0] || 0, frame2);
    const z = _levelForFloorId(frame2, ctx.state.model, floors2, fid);
    const [x_m, y_m] = frame2.isoInv(vbX, vbY, z);
    _pushUndo(mapState, [sel.eid]);
    _draftAt(ctx, { mapState, lightsByEid }, sel.eid, x_m, y_m, fid, "manual");
    mapState._focusRow = sel.eid;
    ctx.toast(`Placed ${l.code} · ${l.friendly_name}`);
    ctx.actions.renderRooms();
  } : null;

  const host = {
    el,
    floors,
    model: modelForRender,
    tier,
    byRoom,
    hiddenEids,
    lightsByEid,
    lightsLoading: reg.loading,
    view,
    // settingsSet re-renders the whole maps view, which detaches the shared
    // card's "Saved ✓" label before it can be read — so confirm with a toast,
    // which outlives the re-render. A failure must not look like a success.
    saveView: async () => {
      try {
        await ctx.actions.settingsSet({
          overview_iso_floor_gap: view.floorGap,
          overview_iso_horiz_gap: view.horizGap,
          overview_iso_focus:     view.focusIdx,
        });
        ctx.toast("Map view saved ✔");
      } catch (e) {
        ctx.toast("Could not save the map view: " + String(e), true);
        throw e;
      }
    },
    callWS: (msg) => ctx.hass.callWS(msg),
    toast: (m, isErr) => ctx.toast(m, isErr),
    // Layer chips (which class is in front) — a view choice of this tab.
    classFilter: mapState._lightsClass || "all",
    onClassFilter: (cls) => { mapState._lightsClass = cls; ctx.actions.renderRooms(); },
    // The multi-selection and the placement queue light up their index rows.
    selectedEids: paid ? new Set([...selSet, ...(mapState._selLight ? [mapState._selLight.eid] : [])]) : null,
    placeQueue: paid && !preview ? new Set(queue) : null,
    onPlaceRow: paid && !preview ? (eid) => {
      const i = queue.indexOf(eid);
      if (i >= 0) queue.splice(i, 1); else queue.push(eid);
      ctx.actions.renderRooms();
    } : null,
    // Map → index: the row of the light just selected on the map scrolls
    // into view, once.
    focusRowEid: mapState._focusRow || null,
    // The locate ring (builder only — the sidebar has no index-driven
    // selection to lose track of, and Preview shows the sidebar's own
    // surface, not the builder's tools). Consumed after this one render.
    locateEid: (paid && !preview) ? (mapState._locateEid || null) : null,
    // The drop-marker pin: a second way to place the CURRENTLY SELECTED
    // light, parked in the map's corner. Only offered when there is a
    // selection to place — dragging it onto the map otherwise has nothing
    // to do. (Defined above, hoisted so _wireLightsBuild can drive it too.)
    onDropPlace,
    // Preview-as-sidebar asks the renderer for the use-surface ergonomics
    // (the sidebar's exact options) and wires the sidebar's exact gestures.
    codeChip: preview, hitHalo: preview, collapseUnplaced: preview,
    // Build-tool interaction: hexes select and drag instead of toggling.
    // Free tier: a hex switches the light, exactly as the sidebar does.
    // Preview: the shared use surface — tap switches, chip/hold opens the
    // control card, room names open the room sheet.
    onHexesBuilt: preview
      ? (isoDiv) => requestAnimationFrame(() => wireUseSurface(isoDiv, previewApi))
      : paid
      ? (isoDiv) => _wireLightsBuild(ctx, isoDiv, { mapState, view, lightsByEid, model: modelForRender, onDropPlace })
      : (isoDiv) => requestAnimationFrame(() => {
          isoDiv.querySelectorAll(".lhex").forEach(g => {
            g.style.cursor = "pointer";
            g.addEventListener("click", e => { e.stopPropagation(); toggle(g.dataset.eid); });
          });
        }),
    transform: !!mapState._lightsTransform,
    hiddenEidsMap: hideUntouched
      ? new Set([...hiddenEids, ...lights.filter(l => !lightIsTouched(l, shapeOverrides, placements))
                                        .map(l => l.entity_id)])
      : hiddenEids,
    hideUntouched,
    untouchedCount,
    onHideUntouched: async (v) => {
      mapState._lightsHideUntouched = v;
      try { await ctx.actions.settingsSet({ lights_hide_untouched: v }); }
      catch (e) { ctx.toast("Could not save the filter: " + String(e), true); }
      ctx.actions.renderRooms();
    },
    // Showcase is a rendering mode, not an edit mode: it is remembered like the
    // view sliders so the map comes back the way it was left.
    showcase: mapState._lightsShowcase === undefined
      ? !!ctx.state.settings?.lights_showcase
      : !!mapState._lightsShowcase,
    fitRooms: mapState._lightsFitRooms === undefined
      ? !!ctx.state.settings?.lights_fit_rooms
      : !!mapState._lightsFitRooms,
    onFitRooms: async (v) => {
      mapState._lightsFitRooms = v;
      try { await ctx.actions.settingsSet({ lights_fit_rooms: v }); }
      catch (e) { ctx.toast("Could not save the room fit: " + String(e), true); }
      ctx.actions.renderRooms();
    },
    onShowcase: async (v) => {
      mapState._lightsShowcase = v;
      try { await ctx.actions.settingsSet({ lights_showcase: v }); }
      catch (e) { ctx.toast("Could not save Showcase: " + String(e), true); }
      ctx.actions.renderRooms();
    },
    // Day lifts the ground and mutes the pools; from the sun HA tracks.
    ambient: sunAmbient(ctx.hass),
    isolux: mapState._lightsIsolux === undefined
      ? !!ctx.state.settings?.lights_isolux
      : !!mapState._lightsIsolux,
    onIsolux: async (v) => {
      mapState._lightsIsolux = v;
      try { await ctx.actions.settingsSet({ lights_isolux: v }); }
      catch (e) { ctx.toast("Could not save Isolux: " + String(e), true); }
      ctx.actions.renderRooms();
    },
    // Scene preview state is a view mode, deliberately NOT a setting: a
    // preview left armed in storage would repaint the map on every open.
    sceneName: mapState._lightsScene || null,
    sceneAngle: mapState._lightsSceneAngle || 0,
    onScene: (name) => { mapState._lightsScene = name; ctx.actions.renderRooms(); },
    onSceneAngle: (deg) => { mapState._lightsSceneAngle = deg; ctx.actions.renderRooms(); },
    onSceneApply: async (field) => {
      if (!ctx.hass || !field) return;
      const cols = sceneColours(ctx.state.model, floors, byRoom, lightsByEid, hiddenEids, field);
      let ok = 0, fail = 0;
      for (const c of cols) {
        try {
          await ctx.hass.callService("light", "turn_on",
            { entity_id: c.eid, rgb_color: c.rgb, transition: 1 });
          ok++;
        } catch (err) { fail++; }
      }
      ctx.toast(fail ? `Scene sent to ${ok} lights, ${fail} failed` : `Scene sent to ${ok} lights`);
      setTimeout(() => ctx.actions.renderRooms(), 1400);
    },
    rippleArmed: !!mapState._rippleArmed,
    onRipple: (v) => { mapState._rippleArmed = v; ctx.actions.renderRooms(); },
    onRippleFire: (delays) => {
      mapState._rippleArmed = false;
      if (!ctx.hass) return;
      // A brightness pulse, on lights already on, capped so a hall of
      // fixtures cannot flood the bus. +25% out, back down 700ms later.
      let n = 0;
      for (const d of delays) {
        if (ctx.hass.states[d.eid]?.state !== "on") continue;
        if (++n > 60) break;
        setTimeout(() => {
          ctx.hass.callService("light", "turn_on",
            { entity_id: d.eid, brightness_step_pct: 25, transition: 0.2 }).catch(() => {});
          setTimeout(() => {
            ctx.hass.callService("light", "turn_on",
              { entity_id: d.eid, brightness_step_pct: -25, transition: 0.6 }).catch(() => {});
          }, 700);
        }, d.delayMs);
      }
      ctx.toast(n ? `Ripple — ${n} lights` : "Ripple: no lights are on");
      ctx.actions.renderRooms();
    },
    // A table row selects the light on the map (toggle lives in the inspector).
    // A light has no owning map to look up any more — it has a position in
    // metres, or it has none and clusters in its room.
    onRowClick: (l) => {
      if (!paid) { toggle(l.entity_id); return; }
      mapState._selLight = { eid: l.entity_id, mapId: null };
      // Choosing FROM THE LIST is exactly when you don't yet know where a
      // light is on the map — the locate ring is a one-shot: it fires on
      // this render and is cleared right after (see buildLightsTable's
      // call site below), so it does not replay on every later edit while
      // the same light stays selected.
      mapState._locateEid = l.entity_id;
      ctx.actions.renderRooms();
    },
    onToggleHidden: async (eid) => {
      // Await the round-trip: settingsSet updates ctx.state.settings from the
      // response, and re-rendering before it lands would rebuild every row
      // against the pre-click set — the click would look ignored, and a
      // second toggle inside that window would overwrite the first.
      const next = new Set(hiddenEids);
      if (next.has(eid)) next.delete(eid); else next.add(eid);
      try { await ctx.actions.settingsSet({ lights_hidden: [...next] }); }
      catch (e) { ctx.toast("Could not save hidden lights: " + String(e), true); }
      ctx.actions.renderRooms();
    },
    // Pro only: force a light's class when detection got it wrong. Absent
    // below pro, so the shared table renders no control there at all.
    onTypeOverride: proTier ? async (eid, kind) => {
      const next = { ...typeOverrides };
      if (!kind || kind === "auto") delete next[eid]; else next[eid] = kind;
      try { await ctx.actions.settingsSet({ light_type_overrides: next }); }
      catch (e) { ctx.toast("Could not save the type override: " + String(e), true); }
      ctx.actions.renderRooms();
    } : null,
    typeOverrides,
    afterAssign: () => {
      const st = ctx.state._lightsRegStore;
      if (st.reg) st.reg.ts = 0;   // background refresh, keep serving current copy
      ctx.actions.renderRooms();
    },
    // The index's own filter + sort — same as the sidebar's, independent
    // of the map's layer chips.
    tableClassFilter: mapState._tableClassFilter || "all",
    onTableClassFilter: (cls) => { mapState._tableClassFilter = cls; ctx.actions.renderRooms(); },
    tableSort: mapState._tableSort || null,
    onTableSort: (next) => { mapState._tableSort = next; ctx.actions.renderRooms(); },
  };
  const mapCardEl = buildLightsMapCard(host);
  // The drafting grid on the stage says "editing" without a word.
  if (paid && !preview) { const stage = mapCardEl.querySelector(".lv-stage"); if (stage) stage.classList.add("editing"); }
  wrap.appendChild(mapCardEl);

  // ── Selected-light inspector — the build tools for one light ────────────
  const sel = paid && !preview ? mapState._selLight : null;
  if (sel && lightsByEid[sel.eid]) {
    const l = lightsByEid[sel.eid];
    // The light's placement, from the fabric: the unsaved draft first, then
    // what is committed. This was left as `sel.mapId ? [].find(...) : null`
    // when light positions stopped living on maps — always null, so the whole
    // block behind it (colour, width, length, rotation, Auto position) never
    // rendered for ANY light and only the Shape chooser survived.
    const entry = (mapState._lightsDraftM || {})[sel.eid]
      || ((ctx.state.model || {}).light_positions_m || {})[sel.eid]
      || null;
    const insp = el("div", { class: "card lv-tablecard", style: "display:flex;gap:14px;align-items:center;flex-wrap:wrap;padding:10px 12px;margin-bottom:12px" });
    insp.appendChild(el("div", { class: "lv-tbl-title", style: "min-width:140px" },
      `${l.code} · ${l.friendly_name}`));
    if (l.isWled) insp.appendChild(el("span", { class: "lv-chip violet" }, "WLED"));
    if (l.isPartition) insp.appendChild(el("span", { class: "lv-chip blue" }, "PARTITION"));
    // Provenance: an accepted room-centre guess is APPROXIMATE until moved.
    if (entry && entry.source === "auto") insp.appendChild(el("span", { class: "lv-chip", style: "color:#fde68a;border:1px solid rgba(251,191,36,.45);background:rgba(251,191,36,.1)", title: "Placed at its room's centre by Accept room centres — drag it to where it really is" }, "APPROXIMATE"));
    // Several selected: this light's look can be copied to all of them.
    if (selSet.size > 1 && entry) insp.appendChild(el("button", {
      class: "lv-act", title: "Copy this light's colour, size, rotation and margin to every selected light",
      onclick: () => {
        const others = [...selSet].filter(e => e !== sel.eid);
        _pushUndo(mapState, others);
        const draft = mapState._lightsDraftM || (mapState._lightsDraftM = {});
        let n = 0;
        for (const e of others) {
          const cur = draft[e] || ((ctx.state.model?.light_positions_m || {})[e] ? { ...(ctx.state.model.light_positions_m[e]) } : null);
          if (!cur) continue;   // an unplaced light has no entry to carry a look
          cur.color = entry.color; cur.width_cm = entry.width_cm; cur.height_cm = entry.height_cm;
          cur.rotation = entry.rotation; cur.margin_cm = entry.margin_cm;
          draft[e] = cur; n++;
        }
        ctx.toast(n ? `Look applied to ${n}` : "No placed lights in the selection to apply it to");
        ctx.actions.renderRooms();
      },
    }, `⎘ Apply look to ${selSet.size - 1} selected`));

    const on = l.state === "on";
    insp.appendChild(el("button", {
      class: `lv-onoff ${on ? "on" : "off"}`,
      onclick: () => toggle(l.entity_id),
    }, on ? "Turn Off" : "Turn On"));

    // Fixture shape — derived from the entity by default; this is the override.
    // Stored per entity_id (not per pin) so it works for every light, whether
    // it has been placed or is still auto-clustered in its room.
    {
      const current = shapeOverrides[l.entity_id] || "auto";
      const derived = LIGHT_SHAPES.find(([k]) => k === deriveLightShape(l));
      const shapeLbl = el("label", { class: "lv-field" }, "Shape");
      const shapeSel = document.createElement("select");
      shapeSel.className = "lv-select";
      for (const [kind, label] of LIGHT_SHAPES) {
        const o = document.createElement("option");
        o.value = kind;
        o.textContent = kind === "auto" && derived ? `Auto — ${derived[1]}` : label;
        if (kind === current) o.selected = true;
        shapeSel.appendChild(o);
      }
      shapeSel.addEventListener("change", async () => {
        const next = { ...shapeOverrides };
        if (shapeSel.value === "auto") delete next[l.entity_id];
        else next[l.entity_id] = shapeSel.value;
        shapeSel.disabled = true;
        try { await ctx.actions.settingsSet({ light_shapes: next }); }
        catch (e) { ctx.toast("Could not save shape: " + String(e), true); }
        ctx.actions.renderRooms();
      });
      shapeLbl.appendChild(shapeSel);
      insp.appendChild(shapeLbl);
    }

    if (entry) {
      const colorLbl = el("label", { class: "lv-field" }, "Hex colour");
      const colorInput = document.createElement("input");
      colorInput.type = "color";
      colorInput.value = entry.color || "#fbbf24";
      colorInput.className = "lv-swatch";
      colorInput.addEventListener("change", () => {
        _pushUndo(mapState, [sel.eid]);
        const draft = mapState._lightsDraftM || (mapState._lightsDraftM = {});
        const cur = draft[sel.eid] || { ...((ctx.state.model?.light_positions_m || {})[sel.eid] || {}) };
        cur.color = colorInput.value;
        draft[sel.eid] = cur;
        ctx.actions.renderRooms();
      });
      colorLbl.appendChild(colorInput);
      insp.appendChild(colorLbl);

      // ── Physical size + rotation ─────────────────────────────────────────
      // Real-world centimetres and degrees, stored in the fabric alongside the
      // position. These fields existed in the schema and the save command from
      // the start; there was simply no way to set them and nothing drew them.
      const editEntry = (mutate) => {
        _pushUndo(mapState, [sel.eid]);
        const draft = mapState._lightsDraftM || (mapState._lightsDraftM = {});
        const cur = draft[sel.eid] || { ...((ctx.state.model?.light_positions_m || {})[sel.eid] || {}) };
        mutate(cur);
        draft[sel.eid] = cur;
        ctx.actions.renderRooms();
      };
      const numBox = (labelText, key, min, max, step, suffix, dflt = 0) => {
        const lbl = el("label", { class: "lv-field" }, labelText);
        const inp = document.createElement("input");
        inp.type = "number";
        inp.min = String(min); inp.max = String(max); inp.step = String(step);
        // dflt is what an UNSET field shows — must match the renderer's own
        // fallback (perimeterSvg defaults margin_cm to 15) or the box would
        // show 0 while the map draws 15, and a save would then silently
        // change what a light without an opinion had been drawing as.
        inp.value = String(entry[key] === undefined || entry[key] === null ? dflt : Number(entry[key]) || 0);
        inp.className = "lv-num";
        inp.addEventListener("change", () => {
          const v = Math.max(min, Math.min(max, parseFloat(inp.value) || 0));
          inp.value = String(v);
          editEntry(c => { c[key] = v; });
        });
        lbl.appendChild(inp);
        if (suffix) lbl.appendChild(el("span", { style: "font-size:11px;color:rgba(226,240,232,.4)" }, suffix));
        return lbl;
      };
      if (l.shape === "perimeter") {
        // A perimeter light has no width/length/rotation of its own — its
        // extent IS the room it sits in. Margin is its only shape control:
        // how far the traced line sits inside the room's own walls.
        // The shown default has to match what an UNSET margin actually
        // renders as (defaultPerimeterMarginM, iso_lights.js) — scale-aware,
        // not a flat number, since a fixed cm value is invisible on a big
        // house and oversized on a small room. Its own fabricFrame call
        // (not the build tab's) because this inspector has no other reason
        // to compute one; a mismatched gap/spacing slider only skews the
        // PLACEHOLDER shown before anyone types a real value, never what
        // actually gets saved.
        const _dfltMarginCm = Math.round(defaultPerimeterMarginM(fabricFrame(ctx.state.model, floors, 150, 0)) * 100);
        insp.appendChild(numBox("Margin", "margin_cm", 0, 500, 1, "cm", _dfltMarginCm));
        insp.appendChild(el("span", { class: "lv-hint" },
          "inset from the room's walls · 0 = right on the wall line"));
      } else {
        insp.appendChild(numBox("Width", "width_cm", 0, 2000, 1, "cm"));
        insp.appendChild(numBox("Length", "height_cm", 0, 2000, 1, "cm"));
        insp.appendChild(numBox("Rotate", "rotation", -180, 180, 5, "°"));
        insp.appendChild(el("span", { class: "lv-hint" },
          "0 = default marker size"));
      }

      insp.appendChild(el("button", {
        class: "lv-act",
        onclick: async () => {
          // Un-place it: back to automatic clustering in its room.
          delete (mapState._lightsDraftM || {})[sel.eid];
          try {
            await ctx.actions.wsCall("padspan_ha/fabric_light_remove", { entity_id: sel.eid });
            await ctx.actions.modelRefresh();
          } catch (err) { ctx.toast("Failed: " + (err.message || err), true); }
          mapState._selLight = { eid: sel.eid, mapId: null };
          ctx.actions.renderRooms();
        },
      }, "↺ Auto position"));
    } else {
      insp.appendChild(el("span", { class: "lv-hint" },
        l.area_name
          ? "Auto-clustered in its room — drag its hex to place it at its exact spot."
          : "Not on the map — assign it a room in the index below, then drag its hex into place."));
    }
    insp.appendChild(el("button", { class: "lv-act", onclick: () => {
      mapState._selLight = null; ctx.actions.renderRooms();
    } }, "Deselect"));
    wrap.appendChild(insp);
  }

  // ── The shared light index table (brings its own card) ──────────────────
  wrap.appendChild(buildLightsTable(host, lights));
  mapState._focusRow = null;   // the scroll-into-view is a one-shot
  mapState._locateEid = null;  // the locate ring is a one-shot too

  return wrap;
}

// ─── Rooms tab — the fabric room-shape editor ─────────────────────────────
// Edits the FabricStore's per-floor room geometry DIRECTLY, in metres. The
// uploaded photo is never involved: a floor is built from its maps exactly
// once ("Build floor from maps"), and from then on every fix is a drag in
// real space saved via padspan_ha/fabric_correct_room. Deliberately NOT
// Pro-gated — room shapes are the positioning ground truth, and correcting
// them is data integrity, not a styling feature.

// Connected-component count over room bounding boxes (gap ≤ gapM = same
// cluster). Mirrors the backend's _cluster_count so the readout here and the
// Health tab's coherence check always agree.
function _roomClusterCount(geoms, gapM = 1.0) {
  const boxes = [];
  for (const [, g] of geoms) {
    if (g.type === "poly" && Array.isArray(g.points_m) && g.points_m.length >= 3) {
      const xs = g.points_m.map(p => p[0]), ys = g.points_m.map(p => p[1]);
      boxes.push([Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]);
    } else if (g.type === "circle") {
      const r = g.r_m || 0.1;
      boxes.push([(g.cx_m||0)-r, (g.cy_m||0)-r, (g.cx_m||0)+r, (g.cy_m||0)+r]);
    }
  }
  const n = boxes.length;
  if (!n) return 0;
  const parent = Array.from({length: n}, (_, i) => i);
  const find = (i) => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
  const h = gapM / 2;
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
    const a = boxes[i], b = boxes[j];
    if (a[0]-h <= b[2]+h && b[0]-h <= a[2]+h && a[1]-h <= b[3]+h && b[1]-h <= a[3]+h) parent[find(i)] = find(j);
  }
  return new Set(Array.from({length: n}, (_, i) => find(i))).size;
}

function _geomCentroid(g) {
  if (g.type === "poly") {
    const n = g.points_m.length;
    return [g.points_m.reduce((s,p)=>s+p[0],0)/n, g.points_m.reduce((s,p)=>s+p[1],0)/n];
  }
  return [g.cx_m || 0, g.cy_m || 0];
}

// Vertex-wise blend of the layouts the user trusts. Rooms present in several
// sets are averaged point-by-point (valid because every candidate descends
// from the SAME photo tracings, so vertex order corresponds); a room whose
// structure differs (edited vertex count, poly vs circle) falls back to the
// first — highest-priority — set that has it.
function _blendLayouts(sets) {
  const avg = (vals) => Math.round(vals.reduce((s, v) => s + v, 0) / vals.length * 1000) / 1000;
  const names = new Set();
  sets.forEach(s => Object.keys(s).forEach(n => names.add(n)));
  const out = {};
  for (const name of names) {
    const present = sets.map(s => s[name]).filter(Boolean);
    const first = present[0];
    if (present.length === 1) { out[name] = JSON.parse(JSON.stringify(first)); continue; }
    if (first.type === "circle" && present.every(g => g.type === "circle")) {
      out[name] = { type: "circle",
        cx_m: avg(present.map(g => g.cx_m)), cy_m: avg(present.map(g => g.cy_m)),
        r_m: avg(present.map(g => g.r_m)) };
    } else if (first.type === "poly" && present.every(g => g.type === "poly"
        && Array.isArray(g.points_m) && g.points_m.length === first.points_m.length)) {
      out[name] = { type: "poly", points_m: first.points_m.map((_, i) =>
        [avg(present.map(g => g.points_m[i][0])), avg(present.map(g => g.points_m[i][1]))]) };
    } else {
      out[name] = JSON.parse(JSON.stringify(first));
    }
  }
  return out;
}

// A map's frac->metre placement as an SVG matrix(a b c d e f), READ OFF
// mapFracToMetres — the function every pin converts through — rather than
// re-derived from the fields. The picture and the pins cannot then disagree
// about where the map is, and this file grows no fourth copy of
//
//   metres = origin + R(rho) . [[Sx, -Sy*sin(sigma)], [0, Sy*cos(sigma)]] . frac
//
// x/y/width/height + rotate() is FOUR degrees of freedom and the record has
// six: a sheared or mirrored placement drew square, in the one panel whose
// job is to show two placements disagreeing.
function _mapAffineM(t) {
  const o = mapFracToMetres(t, 0, 0);
  const ex = mapFracToMetres(t, 1, 0);
  const ey = mapFracToMetres(t, 0, 1);
  if (!o || !ex || !ey) return null;
  return [ex[0] - o[0], ex[1] - o[1], ey[0] - o[0], ey[1] - o[1], o[0], o[1]];
}

// A map's full-image footprint in metres — the visual aid for comparing where
// the system puts a photo vs where the stack alignment puts it.
function _mapFootprintM(t) {
  if (!t || t.scale_x_m == null) return null;
  return [[0, 0], [1, 0], [1, 1], [0, 1]].map(([fx, fy]) => {
    const [xm, ym] = mapFracToMetres(t, fx, fy);
    return [Math.round(xm * 1000) / 1000, Math.round(ym * 1000) / 1000];
  });
}

// Fetch the floor's truth candidates (fabric vs stack vs system calibration)
// with a short cache so the tab doesn't hammer the WS on every re-render.
function _fetchRoomsTruth(ctx, floorId) {
  const mapState = ctx.state.maps;
  const c = mapState._roomsTruthCache;
  if (c && c.floorId === floorId && (Date.now() - c.ts) < 15000) return;
  if (mapState._roomsTruthLoading === floorId) return;
  mapState._roomsTruthLoading = floorId;
  ctx.actions.wsCall("padspan_ha/fabric_truth_candidates", { floor_id: floorId })
    .then(res => { mapState._roomsTruthCache = { floorId, ts: Date.now(), data: res }; })
    .catch(err => { mapState._roomsTruthCache = { floorId, ts: Date.now(), data: null, error: String(err.message || err) }; })
    .finally(() => { mapState._roomsTruthLoading = null; ctx.actions.renderRooms(); });
}

// `_alignRepair` and the two repairs it routed to are deleted.
//
// It decided which of "Rebuild Stack" and "Fix alignment" to offer for a map
// whose two stored placements disagreed. A map has one placement, so it
// cannot disagree with itself: every one of the states that routing existed
// for — a trim, a proportional crop, a deliberate resize, a turn — is
// unrepresentable, and the two ws commands behind the buttons are gone.
// `geometry_fault` still exists and still reaches this table, but it now
// reports only the faults a single record can have: unreadable, unplaced, or
// no world frame at all. None of those has a repair the panel can perform;
// each has a sentence telling the owner what to do, in the Health tab.

function _roomsTab(ctx, maps) {
  const { el, roomColor } = ctx.helpers;
  const card = el("div", { class: "card" });
  const mapState = ctx.state.maps;
  const allGeo = ctx.state.model?.room_geometry_m || {};
  const fabricFloors = ctx.state.model?.fabric_floors || {};

  card.appendChild(el("div", { class: "card-head", style: "margin-bottom:4px" }, [
    el("div", { style: "font-weight:700;font-size:15px" }, "The Fabric — rooms and scanners, in metres"),
  ]));
  card.appendChild(el("div", { class: "muted", style: "font-size:12px;margin-bottom:10px" },
    "The real-world model the positioning engine uses — edited directly, in metres, with no floor " +
    "plan involved. Green pins are your scanners: drag one to say where it actually is. " +
    "Compare the saved fabric against the other forms of truth (your hand-tuned stack alignment, " +
    "or each photo's own calibration), refine, and only then commit the best layout. " +
    "Click a room to select it (Shift-click for a group), drag to move, drag a corner to reshape."));

  // ── Floor selector: every HA floor + any floor that has geometry or maps ─
  const haFloors = ctx.state.model?.floors || [];
  const floorIds = [];
  const seenF = new Set();
  const addF = (id, label) => { if (id && !seenF.has(id)) { seenF.add(id); floorIds.push([id, label || id]); } };
  for (const f of haFloors) addF(String(f.id), f.name || f.id);
  for (const g of Object.values(allGeo)) addF(String(g.floor_id || "main"));
  for (const m of maps) addF(String(m.floor_id || "main"));
  if (!floorIds.length) addF("main", "Main");
  if (!mapState._roomsFloorId || !seenF.has(mapState._roomsFloorId)) mapState._roomsFloorId = floorIds[0][0];
  const floorId = mapState._roomsFloorId;

  const bar = el("div", { style: "display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:8px" });
  bar.appendChild(el("span", { class: "muted", style: "font-size:12px" }, "Floor:"));
  for (const [fid, label] of floorIds) {
    bar.appendChild(el("button", {
      class: "btn inline" + (fid === floorId ? " primary" : ""),
      onclick: () => { mapState._roomsFloorId = fid; mapState._roomsDraftFloorId = null; ctx.actions.renderRooms(); },
    }, label));
  }
  card.appendChild(bar);

  // ── Add a room that exists only in the fabric ───────────────────────────
  // No HA area, no floor plan, no photo. Type a name and it is real; drag
  // its shape to where it is. This is what "the fabric is the truth" means
  // in practice.
  {
    const addRow = el("div", { style: "display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-bottom:8px" });
    const nameIn = el("input", {
      type: "text", placeholder: "New room name",
      style: "width:150px;background:#0a150e;color:#e2e8f0;border:1px solid #2d5a3d;border-radius:4px;padding:3px 8px;font-size:12px",
    });
    addRow.appendChild(nameIn);
    addRow.appendChild(el("button", {
      class: "btn inline",
      onclick: async (e) => {
        const name = (nameIn.value || "").trim();
        if (!name) { ctx.toast("Enter a room name"); return; }
        if (allGeo[name]) { ctx.toast(`"${name}" already exists`, true); return; }
        const btn = e.currentTarget;
        btn.disabled = true;
        try {
          await ctx.actions.wsCall("padspan_ha/fabric_room_add", { room: name, floor_id: floorId });
          // Give it a real 3m x 3m shape beside the rooms already on this
          // floor, so it is immediately draggable instead of invisible.
          let cx = 0, cy = 0, n = 0;
          for (const g of Object.values(fabricDraft)) {
            const c = _geomCentroid(g);
            if (c) { cx += c[0]; cy += c[1]; n++; }
          }
          if (n) { cx /= n; cy /= n; } else { cx = 0; cy = 0; }
          await ctx.actions.wsCall("padspan_ha/fabric_correct_room", {
            floor_id: floorId, room: name,
            geometry: { type: "poly", points_m: [
              [cx - 1.5, cy - 1.5], [cx + 1.5, cy - 1.5],
              [cx + 1.5, cy + 1.5], [cx - 1.5, cy + 1.5]] },
          });
          nameIn.value = "";
          ctx.toast(`✔ "${name}" added — drag it into place`);
          mapState._roomsDraftFloorId = null;
          mapState._roomsTruthCache = null;
          await ctx.actions.modelRefresh();
        } catch (err) {
          ctx.toast("Add failed: " + (err.message || err), true);
          btn.disabled = false;
        }
      },
    }, "+ Add room"));
    addRow.appendChild(el("span", { class: "muted", style: "font-size:11px" },
      "Exists in the fabric only — no Home Assistant area or floor plan required."));
    card.appendChild(addRow);
  }

  // ── Draft: a scratch copy of this floor's geometry, reset on floor switch ─
  if (mapState._roomsDraftFloorId !== floorId) {
    const draft = {};
    for (const [room, g] of Object.entries(allGeo)) {
      if (String(g.floor_id || "main") === String(floorId)) draft[room] = JSON.parse(JSON.stringify(g));
    }
    mapState._roomsDraft = draft;
    mapState._roomsOrig = JSON.parse(JSON.stringify(draft));
    mapState._roomsDraftFloorId = floorId;
    mapState._roomsSel = [];
    mapState._roomsTruth = "fabric";
    mapState._roomsCandDraft = null;
    mapState._roomsBlendAveraged = false;
    mapState._roomsAlignPreview = null;
    mapState._roomsScannerDraft = null;
    mapState._roomsBeaconDraft = null;
    mapState._roomsBarrierDraft = null;
  }

  // ── Scanners: the other half of the fabric, edited in metres right here ──
  // A photo is one way to say where a scanner is. This is the other, and the
  // only one that needs no photo at all.
  const allScanners = ctx.state.model?.scanner_positions_m || {};
  const floorScanners = {};
  for (const [src, p] of Object.entries(allScanners)) {
    if (String(p.floor_id || "main") !== String(floorId)) continue;
    if (!isFinite(p.x_m) || !isFinite(p.y_m)) continue;
    floorScanners[src] = p;
  }
  if (!mapState._roomsScannerDraft) {
    mapState._roomsScannerDraft = JSON.parse(JSON.stringify(floorScanners));
  }
  const scanDraft = mapState._roomsScannerDraft;
  const _scanMoved = (src) => {
    const a = scanDraft[src], b = floorScanners[src];
    return a && b && (Math.abs(a.x_m - b.x_m) > 0.001 || Math.abs(a.y_m - b.y_m) > 0.001);
  };
  const movedScanners = Object.keys(scanDraft).filter(_scanMoved);

  const allBeacons = ctx.state.model?.beacon_positions_m || {};
  const floorBeacons = {};
  for (const [k, p] of Object.entries(allBeacons)) {
    if (String(p.floor_id || "main") !== String(floorId)) continue;
    if (!isFinite(p.x_m) || !isFinite(p.y_m)) continue;
    floorBeacons[k] = p;
  }
  if (!mapState._roomsBeaconDraft) mapState._roomsBeaconDraft = JSON.parse(JSON.stringify(floorBeacons));
  const bkDraft = mapState._roomsBeaconDraft;
  const _bkMoved = (k) => {
    const a = bkDraft[k], b = floorBeacons[k];
    return a && b && (Math.abs(a.x_m - b.x_m) > 0.001 || Math.abs(a.y_m - b.y_m) > 0.001);
  };
  const movedBeacons = Object.keys(bkDraft).filter(_bkMoved);

  const allBarriers = (ctx.state.model?.rf_barriers_m || []).filter(
    b => String(b.floor_id || "main") === String(floorId) && (b.points_m || []).length >= 2);
  if (!mapState._roomsBarrierDraft) mapState._roomsBarrierDraft = JSON.parse(JSON.stringify(allBarriers));
  const barDraft = mapState._roomsBarrierDraft;
  const _barMoved = (i) => JSON.stringify(barDraft[i]?.points_m) !== JSON.stringify(allBarriers[i]?.points_m);
  const movedBarriers = barDraft.map((_, i) => i).filter(_barMoved);
  const fabricDraft = mapState._roomsDraft || {};
  const orig = mapState._roomsOrig || {};
  const sel = new Set(mapState._roomsSel || []);

  // ── Forms of truth: saved fabric vs stack alignment vs per-map calibration ─
  const floorMapsAll = maps.filter(m => String(m.floor_id || "main") === String(floorId));
  if (floorMapsAll.length) _fetchRoomsTruth(ctx, floorId);
  const truthCache = (mapState._roomsTruthCache && mapState._roomsTruthCache.floorId === floorId)
    ? mapState._roomsTruthCache.data : null;
  // TWO CANDIDATES, NOT THREE. The third was "Stack alignment" — the rooms
  // as the hand-tuned stack composition drew them — and it was a real second
  // opinion while the alignment was stored separately from the metre record.
  // It is derived from that record now, so the two agreed to exactly 0.0 m
  // over every map measured. Offering an owner a choice between two numbers
  // that cannot differ is not a comparison.
  const candidates = {
    transforms: truthCache
      ? { label: "Map placements", rooms: truthCache.transforms.rooms, stats: truthCache.transforms.stats }
      : null,
  };
  // Blended layout: vertex-average of whichever sources the user trusts.
  if (!mapState._roomsBlendSources && truthCache) {
    mapState._roomsBlendSources = { fabric: true, transforms: false };
  }
  const blendSources = mapState._roomsBlendSources || { fabric: true, transforms: false };
  // Each trusted source keeps its own line style so the same room's copies
  // are tellable apart when stacked: fabric solid, placements dotted.
  const _blendLabeledSets = () => {
    const sets = [];
    if (blendSources.fabric && Object.keys(fabricDraft).length) sets.push({ key: "fabric", label: "Fabric", rooms: fabricDraft, dashKind: null });
    if (blendSources.transforms && candidates.transforms) sets.push({ key: "transforms", label: "Placements", rooms: candidates.transforms.rooms, dashKind: "dot" });
    return sets;
  };
  const blendKey = JSON.stringify(blendSources);
  if (_blendLabeledSets().length) {
    const blended = _blendLayouts(_blendLabeledSets().map(s => s.rooms));
    candidates.blended = {
      label: "Blended", rooms: blended,
      stats: { rooms: Object.keys(blended).length, clusters: _roomClusterCount(Object.entries(blended)) },
    };
  }

  let truth = mapState._roomsTruth || "fabric";
  if (truth !== "fabric" && !candidates[truth]) { truth = "fabric"; mapState._roomsTruth = "fabric"; }
  const previewing = truth !== "fabric";
  // Blended starts as a STACKED comparison of the selected layouts; the
  // average only materializes when the user asks for it.
  const blendStacked = truth === "blended" && !mapState._roomsBlendAveraged;

  // A candidate view is just as editable as the fabric view — its edits live
  // in a per-view draft and reach the fabric only via an explicit commit.
  let draft = fabricDraft;
  let draftOrig = orig;
  if (previewing && !blendStacked) {
    const cd = mapState._roomsCandDraft;
    const cdBlendKey = truth === "blended" ? blendKey : "";
    if (!cd || cd.floorId !== floorId || cd.truth !== truth || cd.blendKey !== cdBlendKey) {
      mapState._roomsCandDraft = {
        floorId, truth, blendKey: cdBlendKey,
        rooms: JSON.parse(JSON.stringify(candidates[truth].rooms)),
        orig: JSON.parse(JSON.stringify(candidates[truth].rooms)),
      };
    }
    draft = mapState._roomsCandDraft.rooms;
    draftOrig = mapState._roomsCandDraft.orig;
  }
  let geoms = Object.entries(draft);
  if (blendStacked) {
    // Union of names for labels/readout; shapes render per-layer below.
    const union = {};
    for (const s of _blendLabeledSets()) {
      for (const [r, g] of Object.entries(s.rooms)) if (!union[r]) union[r] = g;
    }
    geoms = Object.entries(union);
  }
  const floorInfo = fabricFloors[floorId] || { committed: false, rooms: Object.keys(fabricDraft).length };
  const committed = !!floorInfo.committed;

  const _geomPayload = (g) => g.type === "circle"
    ? { type: "circle", cx_m: g.cx_m, cy_m: g.cy_m, r_m: g.r_m }
    : { type: "poly", points_m: g.points_m };
  const _changed = (room) => JSON.stringify(_geomPayload(draft[room])) !== JSON.stringify(draftOrig[room] ? _geomPayload(draftOrig[room]) : null);
  const changedRooms = Object.keys(draft).filter(_changed);

  // ── Truth selector — compare layouts before committing anything ────────
  if (floorMapsAll.length) {
    const selRow = el("div", { style: "display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-bottom:8px" });
    selRow.appendChild(el("span", { class: "muted", style: "font-size:12px" }, "Layout:"));
    const statLbl = (stats) => stats
      ? ` · ${stats.rooms} rooms · ${stats.clusters > 1 ? "⚠" + stats.clusters : "✓" + (stats.clusters || 0)}`
      : "";
    const fabricStats = { rooms: Object.keys(fabricDraft).length, clusters: _roomClusterCount(Object.entries(fabricDraft)) };
    const options = [["fabric", "Fabric (saved)", fabricStats]];
    if (candidates.transforms) options.push(["transforms", "Map placements", candidates.transforms.stats]);
    if (candidates.blended) options.push(["blended", "Blended", candidates.blended.stats]);
    for (const [key, label, stats] of options) {
      selRow.appendChild(el("button", {
        class: "btn inline" + (truth === key ? " primary" : ""),
        style: "font-size:11px",
        onclick: () => {
          mapState._roomsTruth = key;
          mapState._roomsSel = [];
          if (key === "blended") mapState._roomsBlendAveraged = false;
          ctx.actions.renderRooms();
        },
      }, label + statLbl(stats)));
    }
    if (truth === "blended") {
      // Which layouts feed the average — the user decides what's credible.
      const srcRow = el("div", { style: "display:flex;align-items:center;gap:10px;flex-wrap:wrap;font-size:11px;color:#94a3b8;margin-left:8px" });
      srcRow.appendChild(el("span", {}, "averaging:"));
      const srcs = [["fabric", "Fabric", Object.keys(fabricDraft).length > 0],
                    ["transforms", "Placements", !!candidates.transforms]];
      for (const [key, label, avail] of srcs) {
        const lbl = el("label", { style: `display:flex;gap:4px;align-items:center;cursor:pointer;${avail ? "" : "opacity:0.4"}` });
        const cb = document.createElement("input");
        cb.type = "checkbox";
        cb.checked = !!blendSources[key] && avail;
        cb.disabled = !avail;
        cb.addEventListener("change", () => {
          blendSources[key] = cb.checked;
          if (!Object.values(blendSources).some(Boolean)) blendSources.fabric = true;
          ctx.actions.renderRooms();
        });
        lbl.appendChild(cb);
        lbl.appendChild(el("span", {}, label));
        srcRow.appendChild(lbl);
      }
      selRow.appendChild(srcRow);
    }
    if (truthCache && truthCache.no_world_frame_reason) {
      selRow.appendChild(el("span", { class: "muted", style: "font-size:10px;color:#f87171" },
        "no world frame — " + truthCache.no_world_frame_reason));
    }
    if (!truthCache && mapState._roomsTruthLoading) {
      selRow.appendChild(el("span", { class: "muted", style: "font-size:10px" }, "loading candidates…"));
    }
    card.appendChild(selRow);

    // ── Reconcile: rooms whose source map's placement has moved ──────────
    // Only rooms the backend can PROVE are pure, unedited derivations of a
    // map ever appear here — anything hand-corrected carries no provenance
    // stamp and is out of this button's reach by construction. Explicit
    // action, named rooms, reported outcome; never a side effect.
    const _recon = (truthCache && truthCache.reconcilable) || [];
    if (_recon.length) {
      const rRow = el("div", { style: "display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:6px 0 8px;padding:8px 10px;background:rgba(245,158,11,.06);border:1px solid #f59e0b33;border-radius:8px" });
      rRow.appendChild(el("span", { style: "font-size:11px;color:#f59e0b" },
        `⚠ ${_recon.length} room${_recon.length !== 1 ? "s" : ""} built from a map whose placement has since changed: ${_recon.map(r => r.room).join(", ")}`));
      rRow.appendChild(el("button", {
        class: "btn inline",
        style: "font-size:11px",
        onclick: async (e) => {
          const btn = e.currentTarget;
          btn.disabled = true; btn.textContent = "Updating…";
          try {
            const res = await ctx.actions.wsCall("padspan_ha/fabric_rooms_reconcile", { floor_id: floorId });
            const failed = (res.failed || []).length;
            ctx.toast(failed
              ? `Updated ${(res.fixed || []).length}, failed ${failed}: ${res.failed.map(f => f.room).join(", ")}`
              : `✔ ${(res.fixed || []).length} room(s) updated from their map`, !!failed);
          } catch (err) {
            ctx.toast("Update failed: " + (err.message || err), true);
          }
          mapState._roomsDraftFloorId = null;
          mapState._roomsTruthCache = null;
          await ctx.actions.modelRefresh();
        },
      }, "↻ Update from map"));
      rRow.appendChild(el("span", { class: "muted", style: "font-size:10px" },
        "Rooms you've hand-corrected are never touched by this."));
      card.appendChild(rRow);
    }

    // ── Group divergence: the trace and the fabric disagree by one factor ─
    // No button, deliberately — the machine cannot know which record is the
    // stale one. The human can, in seconds, by comparing both layouts over
    // the photo; the row exists to make them look.
    const _dvg = (truthCache && truthCache.divergence) || [];
    if (_dvg.length) {
      const dRow = el("div", { style: "display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:6px 0 8px;padding:8px 10px;background:rgba(245,158,11,.06);border:1px solid #f59e0b33;border-radius:8px" });
      for (const d of _dvg) {
        dRow.appendChild(el("span", { style: "font-size:11px;color:#f59e0b" },
          `⚠ “${d.map_name}”: its trace and the saved rooms differ by one shared factor (×${d.ratio_x} across, ×${d.ratio_y} down) — one of the two predates a map change.`));
      }
      dRow.appendChild(el("span", { class: "muted", style: "font-size:10px" },
        "Compare “Fabric (saved)” and “Map placements” over the photo; commit whichever matches the picture. Health → Auto Diagnostics has the full note."));
      card.appendChild(dRow);
    }
  }

  // ── Alignment visual aid: the actual PHOTO ghosted at each placement ────
  // A bare rectangle reads as a random box; the map image rendered inside
  // it is what makes "where does this photo sit" judgeable by eye.
  const alignRow = (truthCache && truthCache.placements || [])
    .find(a => a.map_id === mapState._roomsAlignPreview);
  const _alignMap = alignRow ? maps.find(m => m.id === alignRow.map_id) : null;
  const _alignImgUrl = _alignMap && _alignMap.image && _alignMap.image.filename
    ? ctx.helpers.mapImageUrl(_alignMap) : null;
  // ONE ghost, because there is one placement. It drew two — "system" and
  // "stack" — so an owner could see the disagreement and pick a side.
  const alignRects = alignRow ? [
    alignRow.system ? { t: alignRow.system, pts: _mapFootprintM(alignRow.system), color: "#f59e0b", label: alignRow.name, imgUrl: _alignImgUrl } : null,
  ].filter(r => r && r.pts) : [];

  // ── Status / readout row ────────────────────────────────────────────────
  // bbox includes any alignment-preview footprints so a wildly misplaced
  // system placement is visible on canvas instead of clipped away.
  const bbox = _roomGeomBBoxM([
    ...geoms,
    ...alignRects.map((r, i) => ["__align" + i, { type: "poly", points_m: r.pts }]),
    ...Object.entries(scanDraft).map(([src, p]) => ["__rx" + src, {
      type: "circle", cx_m: p.x_m, cy_m: p.y_m, r_m: 0.6,
    }]),
    ...Object.entries(bkDraft).map(([k, p]) => ["__bk" + k, {
      type: "circle", cx_m: p.x_m, cy_m: p.y_m, r_m: 0.6,
    }]),
    ...barDraft.map((b, i) => ["__bar" + i, { type: "poly", points_m: b.points_m }]),
  ]);
  const clusters = _roomClusterCount(geoms);
  const readout = el("div", { style: "display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:8px;font-size:12px" });
  if (previewing) {
    readout.appendChild(el("span", {
      class: "pill", style: "background:#1e2a4a;color:#93b4f8;font-weight:700",
    }, blendStacked
      ? `◫ Stacked comparison (${_blendLabeledSets().map(s => s.label).join(" + ")}) — solid/dashed/dotted per layout`
      : `👁 ${candidates[truth].label} — editable; nothing saved until you commit`));
  }
  readout.appendChild(el("span", {
    class: "pill",
    style: committed ? "background:#14331f;color:#52b788;font-weight:700" : "background:#332714;color:#f59e0b;font-weight:700",
  }, committed ? "🔒 Committed" : "Not committed"));
  readout.appendChild(el("span", { class: "mono", style: "color:#94a3b8" },
    `${geoms.length} rooms · ${Object.keys(scanDraft).length} scanners · footprint ${(bbox.width).toFixed(1)}m × ${(bbox.height).toFixed(1)}m`));
  const movedCount = movedScanners.length + movedBeacons.length + movedBarriers.length;
  if (movedCount) {
    readout.appendChild(el("span", { class: "mono", style: "color:#fbbf24" },
      `${movedCount} moved`));
  }
  if (geoms.length) {
    readout.appendChild(el("span", {
      class: "mono",
      style: clusters > 1 ? "color:#f87171;font-weight:700" : "color:#52b788",
    }, clusters > 1 ? `⚠ ${clusters} disconnected clusters` : "✓ 1 connected cluster"));
  }
  if (sel.size) readout.appendChild(el("span", { class: "mono", style: "color:#e879f9" }, `${sel.size} selected`));
  if (changedRooms.length) readout.appendChild(el("span", { class: "mono", style: "color:#fbbf24" }, `${changedRooms.length} unsaved`));
  card.appendChild(readout);

  // ── Canvas ──────────────────────────────────────────────────────────────
  // Rooms OR scanners is enough to draw: a floor with radios and no floor
  // plan is a legitimate starting point, not an empty state.
  if (geoms.length || Object.keys(scanDraft).length || Object.keys(bkDraft).length || barDraft.length) {
    const stage = el("div", {
      class: "mapstage",
      style: "margin-top:0;height:calc(100vh - 260px);min-height:480px;display:flex;align-items:center;justify-content:center;position:relative;cursor:grab;touch-action:none",
    });
    const inner = el("div", {
      style: "position:relative;transform-origin:0 0",
    });
    stage.appendChild(inner);
    // Same measured contain-fit as the Lights canvas (see _fitInner there).
    const _fitRoomsInner = () => {
      const r = stage.getBoundingClientRect();
      if (r.width < 4 || r.height < 4) return;
      const R = bbox.width / bbox.height;
      let w = r.width, h = w / R;
      if (h > r.height) { h = r.height; w = h * R; }
      inner.style.width = `${Math.round(w)}px`;
      inner.style.height = `${Math.round(h)}px`;
    };
    // Reference held on the node — see _fitInner in the Lights canvas.
    try { stage._fitRO = new ResizeObserver(_fitRoomsInner); stage._fitRO.observe(stage); } catch (_) {}
    requestAnimationFrame(_fitRoomsInner);
    const resetBtn = el("button", {
      class: "btn inline",
      style: "position:absolute;right:8px;top:8px;z-index:5;font-size:11px;padding:3px 8px;opacity:0.85",
      onclick: () => panZoom.reset(),
    }, "Reset View");
    stage.appendChild(resetBtn);
    const panZoom = _attachPanZoom(stage, inner);

    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("class", "mapvector");
    svg.setAttribute("viewBox", `${bbox.minX} ${bbox.minY} ${bbox.width} ${bbox.height}`);
    svg.setAttribute("preserveAspectRatio", "none");
    inner.appendChild(svg);
    // Unlike the Lights canvas, the interactive targets here are the SVG
    // room shapes UNDER this overlay — the layer must not swallow their
    // clicks. Handles/labels re-enable pointer-events per element.
    const pinLayer = el("div", { class: "mapoverlay", style: "pointer-events:none" });
    inner.appendChild(pinLayer);

    const strokeW = Math.max(bbox.width, bbox.height) * 0.004;
    const shapeEls = {};   // room -> svg element (for imperative updates mid-drag)
    const handleEls = [];  // [{room, idx|"c"|"r", elDiv}]

    // Pointer px → metre delta, valid under any pan-zoom scale because the
    // layer rect already includes the CSS transform.
    const pxToM = (dxPx, dyPx) => {
      const r = pinLayer.getBoundingClientRect();
      // A collapsed rect means the layer isn't really laid out — treat the
      // movement as zero rather than scaling pixels into hundreds of metres.
      if (r.width < 2 || r.height < 2) return [0, 0];
      return [dxPx * bbox.width / r.width, dyPx * bbox.height / r.height];
    };
    const pt = (ev) => [ev.clientX ?? ev.touches?.[0]?.clientX ?? 0, ev.clientY ?? ev.touches?.[0]?.clientY ?? 0];

    // Shared drag runner: snapshots state, feeds metre deltas to onMove, and
    // suppresses the poll re-render for the whole gesture (same
    // _editDragging contract the Lights canvas uses).
    const runDrag = (ev, onMove, onClick) => {
      ev.preventDefault(); ev.stopPropagation();
      if (!pinLayer.isConnected) return;   // stale tree — a re-render just swapped the DOM
      const [sx, sy] = pt(ev);
      let moved = false;
      mapState._editDragging = true;
      const mm = (e) => {
        // If a re-render detaches this canvas mid-drag, its rect collapses to
        // 0 and the px→metre conversion would explode a 60px drag into
        // hundreds of metres — dead closures must never touch the draft.
        if (!pinLayer.isConnected) return;
        const [cx, cy] = pt(e);
        if (Math.abs(cx - sx) + Math.abs(cy - sy) > 3) moved = true;
        if (moved) { const [dxm, dym] = pxToM(cx - sx, cy - sy); onMove(dxm, dym); }
      };
      const up = (e) => {
        window.removeEventListener("mousemove", mm); window.removeEventListener("touchmove", mm);
        window.removeEventListener("mouseup", up); window.removeEventListener("touchend", up);
        mapState._editDragging = false;
        if (!moved && onClick) onClick(e);
        ctx.actions.renderRooms();
      };
      window.addEventListener("mousemove", mm); window.addEventListener("touchmove", mm);
      window.addEventListener("mouseup", up); window.addEventListener("touchend", up);
    };

    const applyShape = (room) => {
      const g = draft[room], elS = shapeEls[room];
      if (!elS) return;
      if (g.type === "poly") elS.setAttribute("points", g.points_m.map(p => `${p[0]},${p[1]}`).join(" "));
      else { elS.setAttribute("cx", g.cx_m); elS.setAttribute("cy", g.cy_m); elS.setAttribute("r", g.r_m); }
      for (const h of handleEls) {
        if (h.room !== room) continue;
        const [hx, hy] = h.idx === "c" ? _geomCentroid(g)
          : h.idx === "r" ? [g.cx_m + g.r_m, g.cy_m]
          : g.points_m[h.idx];
        h.elDiv.style.left = `${((hx - bbox.minX) / bbox.width * 100).toFixed(3)}%`;
        h.elDiv.style.top = `${((hy - bbox.minY) / bbox.height * 100).toFixed(3)}%`;
      }
    };

    // Room shapes — normally one editable layer; in the stacked blend
    // comparison, one read-only layer per trusted source (fabric solid,
    // stack dashed, system dotted) so the same room's copies overlay.
    const renderLayers = blendStacked
      ? _blendLabeledSets().map(s => ({ entries: Object.entries(s.rooms), dashKind: s.dashKind, interactive: false }))
      : [{ entries: geoms, dashKind: previewing ? "preview" : null, interactive: true }];
    for (const layer of renderLayers)
    for (const [room, g] of layer.entries) {
      const color = roomColor(room);
      const isSel = layer.interactive && sel.has(room);
      let elS;
      if (g.type === "poly" && Array.isArray(g.points_m) && g.points_m.length >= 3) {
        elS = document.createElementNS("http://www.w3.org/2000/svg", "polygon");
        elS.setAttribute("points", g.points_m.map(p => `${p[0]},${p[1]}`).join(" "));
      } else if (g.type === "circle") {
        elS = document.createElementNS("http://www.w3.org/2000/svg", "circle");
        elS.setAttribute("cx", g.cx_m ?? 0); elS.setAttribute("cy", g.cy_m ?? 0); elS.setAttribute("r", g.r_m ?? 0.6);
      } else continue;
      elS.setAttribute("fill", color);
      elS.setAttribute("fill-opacity", blendStacked ? "0.08" : isSel ? "0.38" : "0.18");
      elS.setAttribute("stroke", isSel ? "#e879f9" : color);
      elS.setAttribute("stroke-width", String(strokeW * (isSel ? 1.8 : 1)));
      if (layer.dashKind === "preview") elS.setAttribute("stroke-dasharray", `${strokeW * 2.5},${strokeW * 1.5}`);
      else if (layer.dashKind === "long") elS.setAttribute("stroke-dasharray", `${strokeW * 4},${strokeW * 2}`);
      else if (layer.dashKind === "dot") elS.setAttribute("stroke-dasharray", `${strokeW},${strokeW * 1.5}`);
      elS.style.pointerEvents = layer.interactive ? "auto" : "none";
      elS.style.cursor = isSel ? "move" : "pointer";
      if (isSel) elS.setAttribute("data-room-handle", "1");
      if (layer.interactive) shapeEls[room] = elS;

      if (layer.interactive) elS.addEventListener("mousedown", (ev) => {
        if (ev.button !== 0) return;
        if (!sel.has(room)) {
          // Not selected: a plain click selects (Shift adds); no drag from here.
          ev.stopPropagation(); ev.preventDefault();
          runDrag(ev, () => {}, (e) => {
            mapState._roomsSel = e.shiftKey ? [...new Set([...sel, room])] : [room];
          });
          return;
        }
        // Selected: drag moves the whole selection rigidly; a plain click
        // (no move) with Shift removes from the group, without Shift keeps
        // selection as-is when grouped or deselects when solo.
        const snap = {};
        for (const rn of sel) snap[rn] = JSON.parse(JSON.stringify(draft[rn]));
        runDrag(ev, (dxm, dym) => {
          for (const rn of sel) {
            const s = snap[rn], d = draft[rn];
            if (s.type === "poly") d.points_m = s.points_m.map(p => [Math.round((p[0]+dxm)*1000)/1000, Math.round((p[1]+dym)*1000)/1000]);
            else { d.cx_m = Math.round((s.cx_m+dxm)*1000)/1000; d.cy_m = Math.round((s.cy_m+dym)*1000)/1000; }
            applyShape(rn);
          }
        }, (e) => {
          if (e.shiftKey) mapState._roomsSel = [...sel].filter(rn => rn !== room);
          else if (sel.size === 1) mapState._roomsSel = [];
        });
      });
      svg.appendChild(elS);
    }

    // Alignment footprints — amber = system placement, cyan = stack placement,
    // each with the actual photo ghosted at that pose (under the room shapes
    // so the fabric stays readable). "Fix alignment" snaps amber onto cyan.
    for (const rect of alignRects) {
      if (rect.imgUrl && rect.t && rect.t.scale_x_m != null) {
        const img = document.createElementNS("http://www.w3.org/2000/svg", "image");
        img.setAttribute("href", rect.imgUrl);
        img.setAttributeNS("http://www.w3.org/1999/xlink", "href", rect.imgUrl);
        // The unit square, placed by the map's own affine. x/y/width/height +
        // rotate() could not lean the y axis, so a sheared ghost was drawn
        // square while its dashed footprint (same matrix) was not.
        img.setAttribute("x", "0");
        img.setAttribute("y", "0");
        img.setAttribute("width", "1");
        img.setAttribute("height", "1");
        img.setAttribute("preserveAspectRatio", "none");
        img.setAttribute("opacity", "0.35");
        img.setAttribute("transform", `matrix(${_mapAffineM(rect.t).join(" ")})`);
        img.style.pointerEvents = "none";
        svg.insertBefore(img, svg.firstChild);
      }
      const poly = document.createElementNS("http://www.w3.org/2000/svg", "polygon");
      poly.setAttribute("points", rect.pts.map(p => `${p[0]},${p[1]}`).join(" "));
      poly.setAttribute("fill", "none");
      poly.setAttribute("stroke", rect.color);
      poly.setAttribute("stroke-width", String(strokeW * 1.6));
      poly.setAttribute("stroke-dasharray", `${strokeW * 4},${strokeW * 2}`);
      poly.style.pointerEvents = "none";
      svg.appendChild(poly);
      const [lx, ly] = rect.pts[0];
      pinLayer.appendChild(el("div", {
        style: `position:absolute;left:${((lx - bbox.minX) / bbox.width * 100).toFixed(2)}%;top:${((ly - bbox.minY) / bbox.height * 100).toFixed(2)}%;` +
          `transform:translate(2px,2px);color:${rect.color};font-size:10px;font-weight:700;` +
          `pointer-events:none;white-space:nowrap;font-family:system-ui,sans-serif;z-index:3;` +
          `text-shadow:0 1px 2px rgba(0,0,0,.8)`,
      }, rect.label));
    }

    // Room labels
    for (const [room, g] of geoms) {
      const [cx, cy] = _geomCentroid(g);
      pinLayer.appendChild(el("div", {
        style: `position:absolute;left:${((cx - bbox.minX) / bbox.width * 100).toFixed(2)}%;top:${((cy - bbox.minY) / bbox.height * 100).toFixed(2)}%;` +
          `transform:translate(-50%,-50%);color:${roomColor(room)};font-size:11px;opacity:0.75;` +
          `pointer-events:none;white-space:nowrap;font-family:system-ui,sans-serif;z-index:1`,
      }, room));
    }

    // ── Scanner pins — draggable, in metres, no photo involved ───────────
    // The fabric is rooms AND the radios standing in them. Dragging here
    // writes real-world coordinates straight to the fabric; the floor plan
    // photo is not consulted and does not need to exist.
    for (const [src, p] of Object.entries(scanDraft)) {
      const label = (ctx.state.model?.scanners?.[src]?.name) || src;
      const moved = _scanMoved(src);
      const pin = el("div", {
        title: `${label}
${p.x_m.toFixed(2)}, ${p.y_m.toFixed(2)} m — drag to place`,
        style: `position:absolute;left:${((p.x_m - bbox.minX) / bbox.width * 100).toFixed(3)}%;` +
          `top:${((p.y_m - bbox.minY) / bbox.height * 100).toFixed(3)}%;` +
          `transform:translate(-50%,-50%);width:16px;height:16px;border-radius:50%;` +
          `background:${moved ? "#fbbf24" : "#52b788"};border:2px solid #0a150e;` +
          `box-shadow:0 0 0 1px ${moved ? "#fbbf24" : "#52b788"};` +
          `pointer-events:auto;cursor:grab;z-index:4;touch-action:none`,
      });
      const cap = el("div", {
        style: `position:absolute;left:${((p.x_m - bbox.minX) / bbox.width * 100).toFixed(3)}%;` +
          `top:${((p.y_m - bbox.minY) / bbox.height * 100).toFixed(3)}%;` +
          `transform:translate(-50%,10px);color:#cbd5e1;font-size:10px;pointer-events:none;` +
          `white-space:nowrap;font-family:system-ui,sans-serif;z-index:4;` +
          `text-shadow:0 1px 2px rgba(0,0,0,.8)`,
      }, label);
      const startX = p.x_m, startY = p.y_m;
      const onDown = (ev) => runDrag(ev, (dxm, dym) => {
        const e = scanDraft[src];
        e.x_m = Math.round((startX + dxm) * 1000) / 1000;
        e.y_m = Math.round((startY + dym) * 1000) / 1000;
        const lx = ((e.x_m - bbox.minX) / bbox.width * 100).toFixed(3);
        const ly = ((e.y_m - bbox.minY) / bbox.height * 100).toFixed(3);
        pin.style.left = `${lx}%`; pin.style.top = `${ly}%`;
        cap.style.left = `${lx}%`; cap.style.top = `${ly}%`;
      });
      pin.addEventListener("mousedown", onDown);
      pin.addEventListener("touchstart", onDown, { passive: false });
      pinLayer.appendChild(pin);
      pinLayer.appendChild(cap);
    }

    // ── Barriers — draggable walls, in metres ────────────────────────────
    for (let bi = 0; bi < barDraft.length; bi++) {
      const bar = barDraft[bi];
      const line = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
      const setPts = () => line.setAttribute("points", bar.points_m.map(q => `${q[0]},${q[1]}`).join(" "));
      setPts();
      line.setAttribute("fill", "none");
      line.setAttribute("stroke", _barMoved(bi) ? "#fbbf24" : "#94a3b8");
      line.setAttribute("stroke-width", String(strokeW * 2.2));
      line.setAttribute("stroke-linecap", "round");
      line.style.pointerEvents = "none";
      svg.appendChild(line);
      // one handle per vertex
      for (let vi = 0; vi < bar.points_m.length; vi++) {
        const startPt = [bar.points_m[vi][0], bar.points_m[vi][1]];
        const h = el("div", {
          title: `${bar.name || "Barrier"} — drag to reshape`,
          style: `position:absolute;left:${((startPt[0] - bbox.minX) / bbox.width * 100).toFixed(3)}%;` +
            `top:${((startPt[1] - bbox.minY) / bbox.height * 100).toFixed(3)}%;` +
            `transform:translate(-50%,-50%);width:12px;height:12px;border-radius:2px;` +
            `background:#94a3b8;border:2px solid #0a150e;pointer-events:auto;cursor:grab;` +
            `z-index:4;touch-action:none`,
        });
        const onDown = (ev) => runDrag(ev, (dxm, dym) => {
          bar.points_m[vi] = [Math.round((startPt[0] + dxm) * 1000) / 1000,
                              Math.round((startPt[1] + dym) * 1000) / 1000];
          setPts();
          h.style.left = `${((bar.points_m[vi][0] - bbox.minX) / bbox.width * 100).toFixed(3)}%`;
          h.style.top = `${((bar.points_m[vi][1] - bbox.minY) / bbox.height * 100).toFixed(3)}%`;
        });
        h.addEventListener("mousedown", onDown);
        h.addEventListener("touchstart", onDown, { passive: false });
        pinLayer.appendChild(h);
      }
      // Delete handle at the wall's first vertex.
      const p0 = bar.points_m[0];
      const del = el("div", {
        title: `Delete "${bar.name || "barrier"}"`,
        style: `position:absolute;left:${((p0[0] - bbox.minX) / bbox.width * 100).toFixed(3)}%;` +
          `top:${((p0[1] - bbox.minY) / bbox.height * 100).toFixed(3)}%;` +
          `transform:translate(-50%,-18px);color:#f87171;font-size:11px;font-weight:700;` +
          `pointer-events:auto;cursor:pointer;z-index:5;font-family:system-ui,sans-serif;` +
          `text-shadow:0 1px 2px rgba(0,0,0,.9)`,
        onclick: async (ev) => {
          ev.stopPropagation();
          if (!confirm(`Delete wall "${bar.name || "barrier"}"?`)) return;
          try {
            await ctx.actions.wsCall("padspan_ha/fabric_rf_barrier_remove", { barrier_id: bar.id });
            mapState._roomsBarrierDraft = null;
            await ctx.actions.modelRefresh();
          } catch (err) { ctx.toast("Delete failed: " + (err.message || err), true); }
        },
      }, "✕");
      pinLayer.appendChild(del);
    }

    // ── Beacon pins — draggable, in metres ───────────────────────────────
    for (const [key, p] of Object.entries(bkDraft)) {
      const label = p.label || p.kind || key;
      const moved = _bkMoved(key);
      const pin = el("div", {
        title: `${label}
${p.x_m.toFixed(2)}, ${p.y_m.toFixed(2)} m — drag to pin`,
        style: `position:absolute;left:${((p.x_m - bbox.minX) / bbox.width * 100).toFixed(3)}%;` +
          `top:${((p.y_m - bbox.minY) / bbox.height * 100).toFixed(3)}%;` +
          `transform:translate(-50%,-50%) rotate(45deg);width:13px;height:13px;` +
          `background:${moved ? "#fbbf24" : "#e879f9"};border:2px solid #0a150e;` +
          `pointer-events:auto;cursor:grab;z-index:4;touch-action:none`,
      });
      const cap = el("div", {
        style: `position:absolute;left:${((p.x_m - bbox.minX) / bbox.width * 100).toFixed(3)}%;` +
          `top:${((p.y_m - bbox.minY) / bbox.height * 100).toFixed(3)}%;` +
          `transform:translate(-50%,10px);color:#e879f9;font-size:10px;pointer-events:none;` +
          `white-space:nowrap;font-family:system-ui,sans-serif;z-index:4;` +
          `text-shadow:0 1px 2px rgba(0,0,0,.8)`,
      }, label);
      const sx0 = p.x_m, sy0 = p.y_m;
      const onDown = (ev) => runDrag(ev, (dxm, dym) => {
        const e = bkDraft[key];
        e.x_m = Math.round((sx0 + dxm) * 1000) / 1000;
        e.y_m = Math.round((sy0 + dym) * 1000) / 1000;
        const lx = ((e.x_m - bbox.minX) / bbox.width * 100).toFixed(3);
        const ly = ((e.y_m - bbox.minY) / bbox.height * 100).toFixed(3);
        pin.style.left = `${lx}%`; pin.style.top = `${ly}%`;
        cap.style.left = `${lx}%`; cap.style.top = `${ly}%`;
      });
      pin.addEventListener("mousedown", onDown);
      pin.addEventListener("touchstart", onDown, { passive: false });
      pinLayer.appendChild(pin);
      pinLayer.appendChild(cap);
    }

    // Vertex / circle handles — only in single-selection (precision mode)
    if (sel.size === 1) {
      const room = [...sel][0];
      const g = draft[room];
      const mkHandle = (idx, mx, my, title) => {
        const h = document.createElement("div");
        h.title = title;
        h.setAttribute("data-room-handle", "1");
        h.style.cssText = `position:absolute;left:${((mx - bbox.minX) / bbox.width * 100).toFixed(3)}%;` +
          `top:${((my - bbox.minY) / bbox.height * 100).toFixed(3)}%;width:12px;height:12px;` +
          `transform:translate(-50%,-50%);border-radius:50%;background:#e879f9;border:2px solid #fff;` +
          `box-shadow:0 1px 3px rgba(0,0,0,.7);cursor:grab;z-index:4;pointer-events:auto`;
        h.addEventListener("mousedown", (ev) => {
          if (ev.button !== 0) return;
          const snap = JSON.parse(JSON.stringify(g));
          runDrag(ev, (dxm, dym) => {
            if (idx === "c") { g.cx_m = Math.round((snap.cx_m+dxm)*1000)/1000; g.cy_m = Math.round((snap.cy_m+dym)*1000)/1000; }
            else if (idx === "r") { g.r_m = Math.max(0.1, Math.round((snap.r_m + dxm)*1000)/1000); }
            else { g.points_m[idx] = [Math.round((snap.points_m[idx][0]+dxm)*1000)/1000, Math.round((snap.points_m[idx][1]+dym)*1000)/1000]; }
            applyShape(room);
          });
        });
        pinLayer.appendChild(h);
        handleEls.push({ room, idx, elDiv: h });
      };
      if (g && g.type === "poly") g.points_m.forEach((p, i) => mkHandle(i, p[0], p[1], `${room} corner ${i + 1}`));
      else if (g && g.type === "circle") { mkHandle("c", g.cx_m, g.cy_m, `${room} centre`); mkHandle("r", g.cx_m + g.r_m, g.cy_m, `${room} radius`); }
    }

    card.appendChild(stage);

    // ── Group tools: scale / rotate the selection about its centroid ──────
    // A mis-scaled cluster (the fallback-transform disease) needs a group
    // scale to fix — per-vertex dragging can't realistically resize 5 rooms.
    if (sel.size) {
      const tools = el("div", { style: "display:flex;gap:12px;align-items:center;flex-wrap:wrap;padding:8px 10px;background:#0a150e;border-radius:6px;margin-top:8px;font-size:12px" });
      tools.appendChild(el("span", { style: "color:#94a3b8" }, `Group of ${sel.size}:`));
      const selCentroid = () => {
        let sx = 0, sy = 0, n = 0;
        for (const rn of sel) { const [cx, cy] = _geomCentroid(draft[rn]); sx += cx; sy += cy; n++; }
        return [sx / n, sy / n];
      };
      const applyXform = (fn, fr) => {
        const [ccx, ccy] = selCentroid();
        for (const rn of sel) {
          const g = draft[rn];
          if (g.type === "poly") g.points_m = g.points_m.map(p => { const [x, y] = fn(p[0]-ccx, p[1]-ccy); return [Math.round((ccx+x)*1000)/1000, Math.round((ccy+y)*1000)/1000]; });
          else { const [x, y] = fn(g.cx_m-ccx, g.cy_m-ccy); g.cx_m = Math.round((ccx+x)*1000)/1000; g.cy_m = Math.round((ccy+y)*1000)/1000; if (fr) g.r_m = Math.max(0.1, Math.round(fr(g.r_m)*1000)/1000); }
        }
        ctx.actions.renderRooms();
      };
      const scaleIn = el("input", { type: "number", value: "1.0", step: "0.05", min: "0.05", max: "20",
        style: "width:64px;background:#0a150e;color:#e2e8f0;border:1px solid #2d5a3d;border-radius:4px;padding:3px 6px" });
      tools.appendChild(el("label", { style: "display:flex;gap:6px;align-items:center;color:#94a3b8" }, ["Scale ×", scaleIn]));
      tools.appendChild(el("button", { class: "btn inline", onclick: () => {
        const k = parseFloat(scaleIn.value);
        if (!isFinite(k) || k <= 0) { ctx.toast("Enter a valid scale factor"); return; }
        applyXform((x, y) => [x * k, y * k], (r) => r * k);
      } }, "Apply"));
      const rotIn = el("input", { type: "number", value: "0", step: "1", min: "-359", max: "359",
        style: "width:64px;background:#0a150e;color:#e2e8f0;border:1px solid #2d5a3d;border-radius:4px;padding:3px 6px" });
      tools.appendChild(el("label", { style: "display:flex;gap:6px;align-items:center;color:#94a3b8" }, ["Rotate °", rotIn]));
      tools.appendChild(el("button", { class: "btn inline", onclick: () => {
        const deg = parseFloat(rotIn.value);
        if (!isFinite(deg)) { ctx.toast("Enter a valid angle"); return; }
        const th = deg * Math.PI / 180, c = Math.cos(th), s = Math.sin(th);
        applyXform((x, y) => [x * c - y * s, x * s + y * c]);
      } }, "Apply"));
      tools.appendChild(el("button", { class: "btn inline", onclick: () => { mapState._roomsSel = []; ctx.actions.renderRooms(); } }, "Deselect"));
      if (sel.size === 1 && !previewing) {
        const only = [...sel][0];
        tools.appendChild(el("button", {
          class: "btn inline", style: "color:#f87171;border-color:#f8717140",
          onclick: async () => {
            if (!confirm(`Delete room "${only}" from the fabric? Its shape, adjacency and scanner assignments go with it.`)) return;
            try {
              await ctx.actions.wsCall("padspan_ha/fabric_room_remove", { room: only });
              ctx.toast(`Deleted "${only}"`);
              mapState._roomsSel = [];
              mapState._roomsDraftFloorId = null;
              mapState._roomsTruthCache = null;
              await ctx.actions.modelRefresh();
            } catch (err) { ctx.toast("Delete failed: " + (err.message || err), true); }
          },
        }, `Delete "${only}"`));
      }
      card.appendChild(tools);
    }

    if (!previewing) {
      // ── Save / discard ──────────────────────────────────────────────────
      const saveRow = el("div", { style: "display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:10px" });
      const saveBtn = el("button", {
        class: "btn inline primary",
        onclick: async (e) => {
          if (!changedRooms.length && !movedCount) { ctx.toast("No changes to save"); return; }
          const btn = e.currentTarget;
          btn.disabled = true; btn.textContent = "Saving…";
          let ok = 0, fail = 0;
          for (const room of changedRooms) {
            try {
              await ctx.actions.wsCall("padspan_ha/fabric_correct_room", {
                floor_id: floorId, room, geometry: _geomPayload(draft[room]),
              });
              ok++;
            } catch (err) { fail++; console.warn("fabric_correct_room failed", room, err); }
          }
          // Everything below goes straight to the fabric in metres — no
          // map_id, no transform, nothing that depends on a photo existing.
          for (const src of movedScanners) {
            const p = scanDraft[src];
            try {
              await ctx.actions.wsCall("padspan_ha/fabric_scanner_position_set", {
                source: src, x_m: p.x_m, y_m: p.y_m,
                z_m: isFinite(p.z_m) ? p.z_m : 2.4, floor_id: floorId,
              });
              ok++;
            } catch (err) { fail++; console.warn("fabric_scanner_position_set failed", src, err); }
          }
          for (const key of movedBeacons) {
            const p = bkDraft[key];
            try {
              await ctx.actions.wsCall("padspan_ha/fabric_beacon_position_set", {
                key, x_m: p.x_m, y_m: p.y_m, floor_id: floorId,
                kind: p.kind || "", label: p.label || "",
              });
              ok++;
            } catch (err) { fail++; console.warn("fabric_beacon_position_set failed", key, err); }
          }
          for (const i of movedBarriers) {
            const b = barDraft[i];
            try {
              await ctx.actions.wsCall("padspan_ha/fabric_rf_barrier_set", {
                barrier: {
                  id: b.id, name: b.name, material: b.material || "custom",
                  attenuation_dbm: b.attenuation_dbm ?? 6,
                  floor_id: floorId, points_m: b.points_m,
                },
              });
              ok++;
            } catch (err) { fail++; console.warn("fabric_rf_barrier_set failed", b.name, err); }
          }
          ctx.toast(fail ? `Saved ${ok}, failed ${fail}` : `✔ ${ok} fabric correction${ok !== 1 ? "s" : ""} saved`, !!fail);
          mapState._roomsDraftFloorId = null;   // re-copy from refreshed model
          mapState._roomsTruthCache = null;
          mapState._roomsScannerDraft = null;
          mapState._roomsBeaconDraft = null;
          mapState._roomsBarrierDraft = null;
          await ctx.actions.modelRefresh();
        },
      }, `💾 Save corrections${(changedRooms.length + movedCount) ? ` (${changedRooms.length + movedCount})` : ""}`);
      saveRow.appendChild(saveBtn);
      if (changedRooms.length || movedCount) {
        saveRow.appendChild(el("button", { class: "btn inline", onclick: () => {
          mapState._roomsDraftFloorId = null;
          mapState._roomsScannerDraft = null;
          mapState._roomsBeaconDraft = null;
          mapState._roomsBarrierDraft = null;
          ctx.actions.renderRooms();
        } }, "Discard changes"));
      }
      card.appendChild(saveRow);
    } else if (blendStacked) {
      // ── Stacked comparison: look first, average when ready ──────────────
      const sets = _blendLabeledSets();
      const pRow = el("div", { style: "display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:10px" });
      pRow.appendChild(el("button", {
        class: "btn inline primary",
        onclick: () => { mapState._roomsBlendAveraged = true; mapState._roomsCandDraft = null; ctx.actions.renderRooms(); },
      }, `⌀ Average ${sets.length === 1 ? "this layout" : `these ${sets.length} layouts`}`));
      pRow.appendChild(el("span", { class: "muted", style: "font-size:11px" },
        "Each checked layout is stacked on the canvas — same room, one line style per layout. Averaging makes an editable draft; nothing is saved until you commit it."));
      card.appendChild(pRow);
    } else {
      // ── Candidate actions: refine here, then commit the layout ──────────
      const cand = candidates[truth];
      const pRow = el("div", { style: "display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:10px" });
      if (truth === "blended") {
        pRow.appendChild(el("button", {
          class: "btn inline",
          onclick: () => { mapState._roomsBlendAveraged = false; mapState._roomsCandDraft = null; ctx.actions.renderRooms(); },
        }, "◫ Back to stacked view"));
      }
      pRow.appendChild(el("button", {
        class: "btn inline primary",
        onclick: async (e) => {
          const rooms = Object.keys(draft);
          const fabricCount = Object.keys(fabricDraft).length;
          const edited = changedRooms.length ? ` (incl. your ${changedRooms.length} edit${changedRooms.length !== 1 ? "s" : ""})` : "";
          if (!confirm(`Commit this ${cand.label} layout${edited} to the base fabric for "${floorId}"? ${rooms.length} rooms will be written; ${fabricCount > rooms.length ? (fabricCount - rooms.length) + " fabric-only room(s) stay untouched." : "existing shapes with the same names are replaced."}`)) return;
          const btn = e.currentTarget;
          btn.disabled = true; btn.textContent = "Committing…";
          let ok = 0, fail = 0;
          for (const room of rooms) {
            try {
              // Provenance: only a pure Map-placements room the user did NOT
              // touch may claim "this is exactly what that map's placement
              // implies". A hand-tweaked room, or anything from a blended
              // layout, commits with no claim — the backend then clears any
              // stale stamp, which is what keeps the reconcile off it.
              const pure = truth === "transforms" && !changedRooms.includes(room) && draft[room].source_map_id;
              await ctx.actions.wsCall("padspan_ha/fabric_correct_room", {
                floor_id: floorId, room, geometry: _geomPayload(draft[room]),
                ...(pure ? { source_map_id: draft[room].source_map_id } : {}),
              });
              ok++;
            } catch (err) { fail++; console.warn("fabric_correct_room failed", room, err); }
          }
          ctx.toast(fail ? `Committed ${ok}, failed ${fail}` : `✔ ${cand.label} committed to fabric (${ok} rooms)`, !!fail);
          mapState._roomsDraftFloorId = null;
          mapState._roomsCandDraft = null;
          mapState._roomsTruthCache = null;
          mapState._roomsTruth = "fabric";
          await ctx.actions.modelRefresh();
        },
      }, `💾 Commit this layout to fabric${changedRooms.length ? ` (${changedRooms.length} edited)` : ""}`));
      if (changedRooms.length) {
        pRow.appendChild(el("button", {
          class: "btn inline",
          onclick: () => { mapState._roomsCandDraft = null; ctx.actions.renderRooms(); },
        }, "Reset to computed layout"));
      }
      pRow.appendChild(el("button", {
        class: "btn inline",
        onclick: () => {
          // Merge this (possibly edited) layout into the fabric editor draft
          // — fabric-only rooms stay visible alongside for final tweaks.
          const merged = JSON.parse(JSON.stringify(mapState._roomsDraft || {}));
          for (const [room, g] of Object.entries(draft)) {
            merged[room] = { type: g.type, floor_id: floorId,
              ...(g.type === "circle" ? { cx_m: g.cx_m, cy_m: g.cy_m, r_m: g.r_m } : { points_m: JSON.parse(JSON.stringify(g.points_m)) }) };
          }
          mapState._roomsDraft = merged;
          mapState._roomsTruth = "fabric";
          mapState._roomsSel = [];
          ctx.toast(`${cand.label} loaded into the Fabric editor — refine, then Save corrections`);
          ctx.actions.renderRooms();
        },
      }, "✏ Load into Fabric editor"));
      pRow.appendChild(el("span", { class: "muted", style: "font-size:11px" },
        "Drag/reshape rooms right here — nothing reaches the fabric until you commit."));
      card.appendChild(pRow);
    }
  } else {
    card.appendChild(el("div", { class: "muted", style: "padding:8px;margin:8px 0" },
      floorMapsAll.length
        ? "No room shapes saved for this floor yet. Switch Layout above to preview the Stack alignment or System calibration, then Load into editor or Adopt."
        : "Nothing on this floor yet. Scanners appear here as soon as Home Assistant sees them — drag one to place it in metres. Room shapes are optional; trace them on a photo in the Edit tab if you want them."));
  }

  // ── Finalize controls ───────────────────────────────────────────────────
  const admin = el("div", { style: "display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:12px;padding-top:10px;border-top:1px solid #1e293b" });
  const refreshAfter = async () => {
    mapState._roomsDraftFloorId = null;
    mapState._roomsTruthCache = null;
    await ctx.actions.modelRefresh();
  };

  if (!committed) {
    if (Object.keys(draft).length) {
      admin.appendChild(el("button", {
        class: "btn inline",
        style: "border-color:#52b788;color:#52b788",
        onclick: async () => {
          if (!confirm(`Finalize "${floorId}"? The floor's room shapes become locked ground truth: bulk rebuilds from maps are refused (individual corrections stay possible).`)) return;
          try {
            await ctx.actions.wsCall("padspan_ha/fabric_floor_finalize", { floor_id: floorId, committed: true });
            ctx.toast(`🔒 Floor "${floorId}" finalized`);
            await refreshAfter();
          } catch (err) { ctx.toast("Finalize failed: " + (err.message || err), true); }
        },
      }, "🔒 Finalize floor"));
    }
  } else {
    admin.appendChild(el("span", { class: "muted", style: "font-size:12px" },
      `Committed ${floorInfo.committed_at ? new Date(floorInfo.committed_at).toLocaleDateString() : ""} — shapes are locked ground truth. Corrections above still work.`));
    admin.appendChild(el("button", {
      class: "btn inline",
      style: "font-size:11px",
      onclick: async () => {
        if (!confirm(`Unlock "${floorId}"? This re-allows bulk rebuilds from maps. Only needed if you intend to rebuild the whole floor.`)) return;
        try {
          await ctx.actions.wsCall("padspan_ha/fabric_floor_finalize", { floor_id: floorId, committed: false });
          ctx.toast(`Floor "${floorId}" unlocked`);
          await refreshAfter();
        } catch (err) { ctx.toast("Unlock failed: " + (err.message || err), true); }
      },
    }, "Unlock…"));
  }
  card.appendChild(admin);

  // ── Map placements ─────────────────────────────────────────────────────
  // Where each map on this floor sits, in metres. It was "system calibration
  // vs stack alignment", two columns and up to three repair buttons per row,
  // plus a red warning telling the owner that pressing one of them could move
  // their rooms. All of that existed because a map's placement was stored
  // twice: the table showed the two copies, and the buttons overwrote one
  // with the other. There is one copy, so there is one column, no repair to
  // choose and nothing to warn about.
  const placeRows = (truthCache && truthCache.placements || []).filter(a => a.system);
  if (placeRows.length) {
    const aCard = el("div", { style: "margin-top:10px;padding:10px;background:#0a150e;border-radius:6px" });
    aCard.appendChild(el("div", { style: "font-weight:700;font-size:12px;color:#94a3b8;text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px" },
      "Map placements"));
    const tbl = el("div", { style: "display:grid;grid-template-columns:1fr auto auto auto;gap:3px 12px;font-size:11px;align-items:center" });
    for (const h of ["Map", "Placed at", "", ""]) {
      tbl.appendChild(el("div", { style: "font-weight:600;color:#64748b;font-size:10px;text-transform:uppercase" }, h));
    }
    const fmt = (t) => t && t.scale_x_m != null
      ? `${Number(t.scale_x_m).toFixed(1)}×${Number(t.scale_y_m).toFixed(1)}m @ (${Number(t.origin_x_m).toFixed(1)}, ${Number(t.origin_y_m).toFixed(1)})`
      : "—";
    for (const a of placeRows) {
      const showing = mapState._roomsAlignPreview === a.map_id;
      const fault = a.geometry_fault;
      tbl.appendChild(el("div", { style: "color:#e2e8f0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" },
        a.name + (a.system && a.system.measured ? " 📏" : "")));
      tbl.appendChild(el("div", { class: "mono", style: `color:${fault ? "#f87171" : "#52b788"}` }, fmt(a.system)));
      tbl.appendChild(el("button", {
        class: "btn inline" + (showing ? " primary" : ""),
        style: "font-size:10px;padding:2px 8px",
        title: "Draw this map's placement on the canvas",
        onclick: () => {
          mapState._roomsAlignPreview = showing ? null : a.map_id;
          ctx.actions.renderRooms();
        },
      }, showing ? "👁 Hide" : "👁 Show"));
      // The three faults a single record can still have. None of them has a
      // repair the panel can perform on the owner's behalf — each is either
      // "measure this map" or "this record is damaged" — so the row says what
      // is wrong and the Health tab says what to do about it.
      tbl.appendChild(fault
        ? el("div", { style: "color:#f87171;font-size:10px" },
            (fault.terms || []).includes("unreadable") ? "⚠ unreadable record"
            : (fault.terms || []).includes("unplaced") ? "not placed"
            : "⚠ " + (fault.terms || []).join(", "))
        : el("div", { style: "color:#52b788;font-size:10px" }, "✓"));
    }
    aCard.appendChild(tbl);
    card.appendChild(aCard);
  }

  return card;
}
