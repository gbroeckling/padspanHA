// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
// See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
/**
 * Settings — user-configurable preferences
 *
 * Tabs (advanced mode):
 *   Appearance   — room colors, floor names, dark theme options
 *   Scanner Map  — assign scanners to rooms, per-map calibration clear
 *   Presence     — BLE tuning (ref power, path-loss, Kalman),
 *                  adaptive learning toggle, positioning algorithm
 *   Manage       — entity types toggle, MQTT, IRK devices
 *
 * Basic mode shows only the Appearance tab (no tabs UI).
 *
 * Uses a "draft" copy of the model so edits don't take effect until Save.
 */
const { BUY_URL, PRO_PRICE, LICENCE_PATH } =
  await import(`./editions.js${new URL(import.meta.url).search}`);

export function render(ctx){
  const { el, esc, roomColor, helpBtn } = ctx.helpers;
  const isBasic = ctx.state.complexity === "basic";
  const root = el("section",{id:"settings"});
  root.className = ctx.state.view==="settings" ? "" : "hidden";

  // Draft model — local copy so edits don't affect live state until Save
  if(!ctx.state._settingsDraft || ctx.state._settingsDraftBuild !== ctx.state.buildId){
    ctx.state._settingsDraft = JSON.parse(JSON.stringify(ctx.state.model || {floors:[], room_meta:{}}));
    if(!ctx.state._settingsDraft.floors || !ctx.state._settingsDraft.floors.length) ctx.state._settingsDraft.floors = [{id:"main", name:"Main"}];
    if(!ctx.state._settingsDraft.floors.find(f=>f.id==="main")) ctx.state._settingsDraft.floors.unshift({id:"main", name:"Main"});
    ctx.state._settingsDraftBuild = ctx.state.buildId;
  }
  const draft = ctx.state._settingsDraft;
  const haFloors = (ctx.state.model && Array.isArray(ctx.state.model.floors)) ? ctx.state.model.floors : [];
  const haAreas  = (ctx.state.model && Array.isArray(ctx.state.model.areas))  ? ctx.state.model.areas  : [];

  // Basic mode: no tabs, just appearance
  if(isBasic){
    root.appendChild(_settingsAppearance(ctx, el, helpBtn, draft, haFloors, haAreas, roomColor, true));
    return root;
  }

  // Advanced / Development mode: tabbed — Appearance | Scanner Map | Presence | UI Structure
  if(!ctx.state._settingsTab) ctx.state._settingsTab = "appearance";
  const activeTab = ctx.state._settingsTab;
  const setTab = (t) => { ctx.state._settingsTab = t; ctx.actions.renderRooms(); };

  // Tab definitions with help descriptions
  const _tabDefs = [
    ["appearance", "Appearance",
      "Configure how PadSpan looks and behaves. Set room colours that carry across the Overview map, Follow tracker, and all visualisations. " +
      "Manage floors and areas (sourced from HA). Assign scanners to rooms so the system knows where each Bluetooth radio is physically located."],
    ["scannermap", "Scanner Map",
      "Shows where PadSpan thinks each of your Bluetooth scanners is physically located on the floor plan. " +
      "The numbered dots are estimated positions based on your calibration data — when you collected fingerprints " +
      "at known spots, each scanner recorded signal strength. Louder signal = scanner is closer to that spot. " +
      "PadSpan combines all these readings to triangulate where the scanner must be sitting. " +
      "The percentage is confidence (more calibration points = more accurate). " +
      "If a dot is in the wrong place, collect more calibration points near that scanner to fix it. " +
      "This tab also has Replace Scanner (swap calibration data when hardware is replaced) and " +
      "Relearn Radio (adjust readings after antenna upgrade/downgrade)."],
    ["presence", "Presence",
      "Controls how PadSpan determines which room a device is in and when it's considered 'away'. " +
      "Room change delay prevents flicker when a device is near a boundary between rooms. " +
      "Away timeout sets how long a device must be unseen before it's marked as gone. " +
      "Quiet mode hides the flood of unidentified BLE advertisements so only your named/followed devices are shown. " +
      "Path-loss and Kalman filter parameters fine-tune the distance estimation from raw RSSI values."],
    ["features", "Features",
      "Experimental capabilities under active development. Each toggle enables a specific feature: " +
      "Trackability Rating scores how reliably each device can be tracked. " +
      "Walk-to-Identify discovers unknown devices by correlating signal changes with your movement. " +
      "Radio Map overlays signal heatmaps on the 3D iso view. " +
      "Distortion Map visualises where the RF model diverges from reality. " +
      "Adaptive Learning lets the system continuously improve from live positioning data."],
    ["ui", "UI Structure",
      "Choose which tabs appear in the sidebar when using Advanced mode. " +
      "All tabs are always visible in Development mode regardless of these settings. " +
      "Use this to show only the views you need — for example, enable Devices and Bluetooth for installers, " +
      "or keep it minimal with just Follow and Overview for end users."],
  ];

  const tabBar = el("div",{class:"tabs", style:"margin-bottom:14px;flex-wrap:wrap;gap:4px;align-items:center"});
  for(const [id, label, helpText] of _tabDefs){
    const tabWrap = el("div",{style:"display:inline-flex;align-items:center;gap:0"});
    tabWrap.appendChild(el("button",{
      class:"tab" + (activeTab===id ? " active" : ""),
      onclick:()=>setTab(id),
    }, label));
    // Help ? button
    const helpDot = el("button",{style:
      "width:16px;height:16px;border-radius:50%;border:1px solid #334155;background:transparent;" +
      "color:#64748b;font-size:10px;font-weight:700;cursor:pointer;display:inline-flex;align-items:center;" +
      "justify-content:center;margin-left:2px;transition:color .15s,border-color .15s;flex-shrink:0"}, "?");
    helpDot.title = helpText;
    helpDot.addEventListener("mouseenter",()=>{helpDot.style.color="#52b788";helpDot.style.borderColor="#52b788";});
    helpDot.addEventListener("mouseleave",()=>{helpDot.style.color="#64748b";helpDot.style.borderColor="#334155";});
    helpDot.addEventListener("click",(e)=>{
      e.stopPropagation();
      // Show as a modal for full readability
      const body = el("div",{style:"max-width:460px"},[
        el("div",{style:"font-weight:700;font-size:14px;color:#52b788;margin-bottom:8px"}, label),
        el("div",{style:"font-size:13px;color:#cbd5e1;line-height:1.6"}, helpText),
      ]);
      ctx.actions.openModal(`Settings: ${label}`, body, "Help");
    });
    tabWrap.appendChild(helpDot);
    tabBar.appendChild(tabWrap);
  }
  root.appendChild(tabBar);

  if(activeTab === "appearance"){
    root.appendChild(_settingsAppearance(ctx, el, helpBtn, draft, haFloors, haAreas, roomColor, false));
  } else if(activeTab === "presence"){
    root.appendChild(_settingsPresence(ctx, el));
  } else if(activeTab === "features"){
    root.appendChild(_settingsFeatures(ctx, el));
  } else if(activeTab === "ui"){
    root.appendChild(_settingsUI(ctx, el));
  } else {
    root.appendChild(_scannerMap(ctx, el, haFloors));
  }
  return root;
}

// ── Appearance tab ─────────────────────────────────────────────────────────────
function _settingsAppearance(ctx, el, helpBtn, draft, haFloors, haAreas, roomColor, isBasic){
  const wrap = el("div",{});

  // Floors card (hidden in basic)
  if(!isBasic){
    const floorsCard = el("div",{class:"card"});
    floorsCard.appendChild(el("div",{style:"font-weight:700"},"Floors"));
    floorsCard.appendChild(el("div",{class:"muted", style:"font-size:12px;margin-top:4px"},
      "Floors are read from HA. Manage them in HA Settings → Areas & Zones."
    ));
    const floorPills = el("div",{style:"display:flex;flex-wrap:wrap;gap:8px;margin-top:10px"});
    if(haFloors.length){
      for(const f of haFloors) floorPills.appendChild(el("span",{class:"pill"}, f.name || f.id));
    } else {
      floorPills.appendChild(el("span",{class:"muted", style:"font-size:12px"}, "No floors found in HA."));
    }
    floorsCard.appendChild(floorPills);
    wrap.appendChild(floorsCard);
  }

  // Rooms color card
  const roomsCard = el("div",{class:"card", style:"margin-top:12px"});
  roomsCard.appendChild(el("div",{class:"card-head"},[
    el("div",{style:"font-weight:700"}, isBasic ? "Room colours" : "Rooms"),
    helpBtn("settings_colors"),
  ]));
  roomsCard.appendChild(el("div",{class:"muted", style:"font-size:12px;margin-top:6px"},
    isBasic
      ? "Pick a colour for each room — this colour shows up on the Follow map and Overview."
      : "Assign each room to a floor and pick a color for sidebar + map overlays."
  ));

  const snap = (ctx.state.live && ctx.state.live.snapshot) || null;
  const rooms = (() => {
    const disc = snap && snap.rooms_discovered;
    if (disc && disc.length) return [...disc].sort((a,b) => a.localeCompare(b));
    return Object.keys(ctx.state.roomTagMap||{}).sort((a,b) => a.localeCompare(b));
  })();

  const table = el("div",{style:"margin-top:10px;display:flex;flex-direction:column;gap:8px"});
  for(const room of rooms){
    if(!draft.room_meta) draft.room_meta = {};
    if(!draft.room_meta[room]) draft.room_meta[room] = { floor_id: "main", color: _toHex(roomColor(room)) };
    const meta = draft.room_meta[room];
    const haArea = haAreas.find(a => a.name === room);
    const haFloorId = haArea?.floor_id || "";
    if(haFloorId) meta.floor_id = haFloorId;
    const haFloor = haFloors.find(f => f.id === meta.floor_id);
    const floorLabel = haFloor ? (haFloor.name || haFloor.id) : (meta.floor_id || "—");

    const row = el("div",{style:"display:grid;grid-template-columns:1fr 140px 90px;gap:10px;align-items:center;border:1px solid #1b3526;border-radius:12px;padding:10px;background:#0a150e"});
    row.appendChild(el("div",{style:"display:flex;align-items:center;gap:10px;flex-wrap:wrap"},[
      el("span",{class:"dot", style:`background:${meta.color || roomColor(room)};`}),
      el("div",{style:"font-weight:600"}, room),
    ]));
    row.appendChild(el("div",{style:"display:flex;flex-direction:column;gap:2px"},[
      el("div",{class:"muted", style:"font-size:10px"}, "Floor (HA)"),
      el("div",{style:"font-size:12px;font-weight:600;color:#94a3b8"}, floorLabel),
    ]));
    const col = document.createElement("input");
    col.type = "color";
    col.value = _toHex(meta.color || roomColor(room));
    col.addEventListener("input", ()=>{ meta.color = col.value; });
    row.appendChild(col);
    table.appendChild(row);
  }
  roomsCard.appendChild(table);
  wrap.appendChild(roomsCard);

  const saveCard = el("div",{class:"card", style:"margin-top:12px"});
  const saveBtn = el("button",{class:"btn primary", onclick:async()=>{
    await ctx.actions.modelUpdate({floors: draft.floors || [], room_meta: draft.room_meta || {}});
    alert("Saved ✔");
  }}, "Save floors & room settings");
  saveCard.appendChild(el("div",{class:"muted"},"These settings are stored locally in Home Assistant storage."));
  saveCard.appendChild(el("div",{style:"margin-top:10px"}, saveBtn));
  wrap.appendChild(saveCard);

  // ── Panel Style (chrome skin) ─────────────────────────────────────────────
  {
    const settings = ctx.state.settings || {};
    const skinNow = settings.ui_skin === "2025" ? "2025" : "classic";
    const mkSkin = (val, label) => {
      const b = el("button",{class:"btn inline"+(skinNow===val?" on":"")}, label);
      b.addEventListener("click", async()=>{
        if (skinNow === val) return;
        try {
          await ctx.actions.settingsSet({ ui_skin: val });
          ctx.toast(val === "2025" ? "2025 style on" : "Classic style restored");
        } catch(e){ ctx.toast("Failed to save", true); }
      });
      return b;
    };
    wrap.appendChild(el("div",{class:"card",style:"border-color:" + (skinNow === "2025" ? "#52b788" : "#334155")},[
      el("div",{class:"h2",style:"margin:0 0 4px;color:#52b788"}, "Panel Style"),
      el("div",{class:"muted",style:"font-size:12px;margin-bottom:10px"},
        "Classic is the original panel, unchanged. 2025 restyles the chrome only — grouped " +
        "sidebar with icons, a 60px collapsed rail, underlined sub-tabs, flatter buttons and " +
        "cards. It takes effect immediately and alters nothing but appearance, so switching " +
        "back is this same control."),
      el("div",{class:"row"},[ mkSkin("classic","Classic"), mkSkin("2025","2025") ]),
    ]));
  }

  // ── 2D Map Mode (Experimental) ────────────────────────────────────────────
  {
    const settings = ctx.state.settings || {};
    const mode2dOn = settings.overview_2d_mode === true;
    const mode2dToggle = el("input",{type:"checkbox",id:"mode2dToggle",style:"width:16px;height:16px;accent-color:#f59e0b;cursor:pointer"});
    mode2dToggle.checked = mode2dOn;
    mode2dToggle.addEventListener("change", async()=>{
      try {
        await ctx.actions.settingsSet({ overview_2d_mode: mode2dToggle.checked });
        ctx.toast(mode2dToggle.checked ? "2D map mode enabled (experimental)" : "3D isometric map restored");
        ctx.actions.renderRooms();
      } catch(e){ ctx.toast("Failed to save", true); }
    });
    wrap.appendChild(el("div",{class:"card",style:"margin-top:12px;border-color:" + (mode2dOn ? "#f59e0b" : "#334155")},[
      el("div",{style:"display:flex;align-items:center;gap:8px;margin-bottom:4px"},[
        el("div",{class:"h2",style:"margin:0;color:#f59e0b"}, "2D Map Mode"),
        el("span",{style:"font-size:10px;padding:1px 6px;border-radius:4px;background:#422006;color:#fbbf24;border:1px solid #92400e;font-weight:700"}, "EXPERIMENTAL"),
      ]),
      el("div",{style:"display:flex;align-items:center;gap:8px;margin-bottom:10px"},[
        mode2dToggle,
        el("label",{for:"mode2dToggle",style:"font-size:13px;color:#e2e8f0;cursor:pointer;font-weight:600"},
          "Replace 3D isometric view with flat 2D map"),
      ]),
      el("div",{class:"muted",style:"font-size:12px"},
        "Shows your floor plan image as a flat 2D map with zoom/pan (mouse wheel + drag). " +
        "Includes toggle filters for scanners, tagged objects, unknown devices, and room boundaries. " +
        "The map fills more screen space and hides multi-floor controls when only one map is uploaded. " +
        "This is experimental — the 3D view is still available by toggling this off."),
    ]));
  }

  return wrap;
}

// ── Scanner Map tab ───────────────────────────────────────────────────────────
// Uses calibration fingerprint data to estimate where each BLE scanner physically
// sits on the floor plans, then renders those guessed positions on each map.
function _scannerMap(ctx, el, haFloors){
  const esc = ctx.helpers.esc;
  const wrap = el("div",{style:"display:flex;flex-direction:column;gap:12px"});
  const snap = (ctx.state.live && ctx.state.live.snapshot) || null;
  const maps  = (ctx.state.maps && ctx.state.maps.list) || [];

  // Load calibration data if not yet loaded
  if(!ctx.state.calibration){
    ctx.actions.calibrationGet()
      .then(d => { ctx.state.calibration = d; ctx.actions.renderRooms(); })
      .catch(() => { ctx.state.calibration = { points:[], model:{} }; ctx.actions.renderRooms(); });
    wrap.appendChild(el("div",{class:"card"},[
      el("div",{class:"muted",style:"font-size:11px"},"Loading calibration data…"),
    ]));
    return wrap;
  }

  const calData = ctx.state.calibration;
  const radios  = snap?.ble?.radios || [];

  // Intro card
  wrap.appendChild(el("div",{class:"card",style:"border-color:#52b788;padding:10px"},[
    el("div",{style:"font-weight:700;font-size:13px;margin-bottom:4px;color:#52b788"},"Where PadSpan Thinks Your Scanners Are"),
    el("div",{style:"font-size:11px;color:#94a3b8;line-height:1.6"},
      "Each numbered dot shows where PadSpan estimates a Bluetooth scanner is physically located on your floor plan. " +
      "These positions are calculated from your calibration data \u2014 when you collected fingerprints at known locations, " +
      "each scanner recorded how strong the signal was. Scanners that heard a calibration point loudly are estimated to be " +
      "closer to it; scanners that heard it faintly are estimated to be further away. " +
      "The percentage next to each scanner is the confidence in that estimate (more calibration points = higher confidence). " +
      "If a scanner appears in the wrong place, it means the calibration data is giving conflicting signals \u2014 " +
      "collecting more calibration points near that scanner will improve accuracy."),
  ]));

  if(!calData.points || calData.points.length === 0){
    wrap.appendChild(el("div",{class:"card"},[
      el("div",{style:"font-weight:700;font-size:13px;color:#f59e0b;margin-bottom:4px"},"⚠ No calibration data"),
      el("div",{class:"muted",style:"font-size:11px"},"Collect calibration fingerprints in the PadSpan™ Calib panel first."),
    ]));
    return wrap;
  }

  // Build per-map scanner estimates — ALL scanners heard on each map
  const byMap = _estimatePositionsPerMap(calData, radios);
  const allEstimatedSources = new Set(Object.values(byMap).flatMap(arr => arr.map(r => r.source)));

  // Radios active in snapshot but absent from all calibration data
  const unplacedRadios = radios.filter(r => r.source && !allEstimatedSources.has(r.source));

  const mapIds = Object.keys(byMap);
  if(!mapIds.length){
    wrap.appendChild(el("div",{class:"card"},[
      el("div",{class:"muted",style:"font-size:11px"},"Could not estimate positions from the available calibration data."),
    ]));
  }

  // Colour palette — up to 16 distinct scanners per map
  const PALETTE = [
    "#52b788","#60a5fa","#f59e0b","#a78bfa","#fb7185","#34d399",
    "#f472b6","#38bdf8","#fbbf24","#818cf8","#4ade80","#f87171",
    "#22d3ee","#e879f9","#a3e635","#fb923c",
  ];

  for(const mapId of mapIds){
    const mapData  = maps.find(m => m.id === mapId);
    const mapRadios = byMap[mapId];  // sorted by pointCount desc

    const mapCard = el("div",{class:"card",style:"padding:10px"});

    // Card header
    const floorName = _floorNameForMap(mapData, haFloors);
    mapCard.appendChild(el("div",{style:"display:flex;align-items:center;gap:6px;margin-bottom:8px"},[
      el("div",{style:"font-weight:700;font-size:13px"}, mapData?.name || mapId),
      floorName ? el("span",{class:"badge",style:"font-size:9px"},floorName) : null,
      el("span",{class:"badge",style:"margin-left:auto;font-size:9px"},
        `${mapRadios.length} scanner${mapRadios.length!==1?"s":""}`),
    ].filter(Boolean)));

    // SVG map with markers
    if(mapData?.image?.filename){
      const ar  = (mapData.image.height || 600) / (mapData.image.width || 800);
      const vbH = ar * 100;
      const imgUrl = ctx.helpers.mapImageUrl(mapData);

      let markersSvg = "";
      mapRadios.forEach((r, i) => {
        const cx  = (r.x_frac * 100).toFixed(2);
        const cy  = (r.y_frac * vbH).toFixed(2);
        const col = PALETTE[i % PALETTE.length];
        const conf = r.confidence;
        const outerR = (1.8 + conf * 3).toFixed(1);   // 1.8–4.8 SVG units
        const confPct = Math.round(conf * 100);

        // Confidence ring
        const ringOp = (0.15 + conf * 0.45).toFixed(2);
        markersSvg += `<circle cx="${cx}" cy="${cy}" r="${outerR}" fill="${col}" fill-opacity="0.10" stroke="${col}" stroke-width="0.4" stroke-dasharray="1 0.8" opacity="${ringOp}"/>`;
        // Centre dot
        markersSvg += `<circle cx="${cx}" cy="${cy}" r="1.0" fill="${col}" stroke="white" stroke-width="0.3" opacity="0.95"/>`;
        // Number label on dot
        markersSvg += `<text x="${cx}" y="${(parseFloat(cy)+0.35).toFixed(1)}" text-anchor="middle" dominant-baseline="middle" font-size="1.2" fill="white" font-weight="bold">${i+1}</text>`;
        // Scanner name + confidence — compact label above marker
        const labelY = (r.y_frac * vbH - parseFloat(outerR) - 0.5).toFixed(1);
        const shortName = r.name.length > 14 ? r.name.slice(0,12)+"…" : r.name;
        markersSvg += `<text x="${cx}" y="${labelY}" text-anchor="middle" font-size="1.5" fill="${col}" font-weight="600" paint-order="stroke" stroke="#071008" stroke-width="0.5">${esc(shortName)} ${confPct}%</text>`;
      });

      const mapDiv = el("div",{style:"border-radius:6px;overflow:hidden;border:1px solid #1b3526;margin-bottom:8px"});
      mapDiv.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 ${vbH}"
        preserveAspectRatio="none" style="width:100%;display:block">
        <image href="${imgUrl}" x="0" y="0" width="100" height="${vbH}" preserveAspectRatio="none"/>
        ${markersSvg}
      </svg>`;
      mapCard.appendChild(mapDiv);
    }

    // Compact legend — one row per scanner
    const legendDiv = el("div",{style:"display:flex;flex-direction:column;gap:2px"});
    mapRadios.forEach((r, i) => {
      const col = PALETTE[i % PALETTE.length];
      const confPct = Math.round(r.confidence * 100);
      const confColor = confPct >= 80 ? "#52b788" : confPct >= 40 ? "#f59e0b" : "#dc2626";
      legendDiv.appendChild(el("div",{
        style:"display:grid;grid-template-columns:16px 1fr auto auto;gap:5px;align-items:center;padding:3px 6px;background:#0a150e;border-radius:5px"
      },[
        // Number badge
        el("div",{style:`width:14px;height:14px;border-radius:50%;background:${col};display:flex;align-items:center;justify-content:center;font-size:8px;font-weight:700;color:#071008;flex-shrink:0`}, i+1),
        // Name
        el("div",{style:"font-size:10px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#e2e8f0"}, r.name),
        // Source tail
        el("div",{style:"font-size:9px;color:#4a6670;font-family:monospace;white-space:nowrap"}, r.source.slice(-8)),
        // Confidence + point count
        el("div",{style:`font-size:9px;color:${confColor};white-space:nowrap;text-align:right`},
          `${confPct}% · ${r.pointCount}pt`),
      ]));
    });
    mapCard.appendChild(legendDiv);

    // Clear calibration data for this map
    const pointCount = (calData.points || []).filter(p => p.map_id === mapId).length;
    const clearRow = el("div",{style:"display:flex;align-items:center;gap:8px;margin-top:8px;padding-top:8px;border-top:1px solid #1b3526"});
    const clearStatusEl = el("span",{class:"muted",style:"font-size:10px;min-width:60px"},"");
    const clearBtnWrap = document.createElement("span");
    clearBtnWrap.style.cssText = "display:inline-flex;gap:4px;align-items:center";
    const makeClearBtn = () => {
      clearBtnWrap.innerHTML = "";
      const cb = el("button",{class:"btn inline",style:"font-size:10px;padding:2px 8px;color:#f87171;border-color:#f8717140",
        title:`Remove all ${pointCount} calibration point(s) collected on this map`,
        onclick: (ev) => {
          ev.stopPropagation();
          clearBtnWrap.innerHTML = "";
          clearBtnWrap.appendChild(el("span",{style:"font-size:10px;color:#fca5a5"},`Clear ${pointCount} point(s)? `));
          clearBtnWrap.appendChild(el("button",{class:"btn inline",style:"font-size:10px;padding:2px 8px;background:#7f1d1d;border-color:#dc2626;color:#fca5a5",
            onclick: async (ev2) => {
              ev2.stopPropagation();
              clearBtnWrap.innerHTML = "";
              clearBtnWrap.appendChild(el("span",{style:"font-size:10px;color:#94a3b8"},"Clearing…"));
              try {
                const res = await ctx.actions.calibrationClearMap(mapId);
                const n = res?.deleted ?? 0;
                ctx.toast(`Cleared ${n} calibration point(s) from ${mapData?.name || mapId}`);
                ctx.state.calibration = null;
                ctx.actions.renderRooms();
              } catch(e) {
                ctx.toast("Clear failed: " + String(e), true);
                makeClearBtn();
              }
            }
          },"Yes"));
          clearBtnWrap.appendChild(el("button",{class:"btn inline",style:"font-size:10px;padding:2px 8px;color:#94a3b8;border-color:#94a3b840",
            onclick: (ev2) => { ev2.stopPropagation(); makeClearBtn(); }
          },"No"));
        }
      },`Clear (${pointCount})`);
      clearBtnWrap.appendChild(cb);
    };
    makeClearBtn();
    clearRow.appendChild(el("span",{class:"muted",style:"font-size:10px"},"Calibration:"));
    clearRow.appendChild(clearBtnWrap);
    clearRow.appendChild(clearStatusEl);
    mapCard.appendChild(clearRow);

    wrap.appendChild(mapCard);
  }

  // Unplaced radios — active but no calibration data anywhere
  if(unplacedRadios.length){
    const unplacedCard = el("div",{class:"card",style:"border-color:#f59e0b;padding:10px"});
    unplacedCard.appendChild(el("div",{style:"display:flex;align-items:center;gap:6px;margin-bottom:6px"},[
      el("div",{style:"font-weight:700;font-size:12px;color:#f59e0b"},"⚠ Not yet in calibration data"),
      el("span",{class:"badge warn",style:"font-size:9px;margin-left:auto"},unplacedRadios.length),
    ]));
    for(const r of unplacedRadios){
      const name = r.area_name || r.area || r.name || r.source || "?";
      unplacedCard.appendChild(el("div",{
        style:"display:grid;grid-template-columns:1fr auto auto;gap:5px;align-items:center;padding:3px 6px;background:#0a150e;border-radius:5px;margin-bottom:2px"
      },[
        el("div",{style:"font-size:10px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap"}, (ctx.helpers.radioShortId ? ctx.helpers.radioShortId(r.source||"")+" " : "") + name),
        el("div",{style:"font-size:9px;color:#4a6670;font-family:monospace;white-space:nowrap"}, r.source.slice(-8)),
        (()=>{ const _ss = ctx.helpers.scannerStatus; if(!_ss){ return r.scanning ? el("span",{class:"badge",style:"font-size:9px"},"scanning") : el("span",{class:"badge warn",style:"font-size:9px"},"idle"); } const ss = _ss(r, snap?.ble?.advertisements); const b = el("span",{class:ss.cls,style:"font-size:9px",title:ss.title},ss.label); if(ss.style) b.style.cssText+="font-size:9px;"+ss.style; return b; })(),
      ]));
    }
    wrap.appendChild(unplacedCard);
  }

  // ── Replace Scanner card ─────────────────────────────────────────────────
  // Collects all source IDs ever seen in calibration data + live radios
  const calSources = new Set();
  for(const pt of calData.points || []){
    for(const sr of pt.scanner_readings || []){ if(sr.source) calSources.add(sr.source); }
  }
  for(const r of radios){ if(r.source) calSources.add(r.source); }

  if(calSources.size >= 2){
    const swapCard = el("div",{class:"card",style:"padding:10px"});
    swapCard.appendChild(el("div",{style:"font-weight:700;font-size:12px;margin-bottom:4px"},"Replace Scanner"));
    swapCard.appendChild(el("div",{style:"font-size:10px;color:#78909c;margin-bottom:8px;line-height:1.5"},
      "Reassign all calibration data from one scanner to another — useful when a physical device is swapped out."));

    // Helper: build an option element
    const mkOpt = (val, label) => {
      const o = document.createElement("option"); o.value=val; o.textContent=label; return o;
    };
    // Name lookup helper
    const radioName = (src) => {
      const r = radios.find(r=>r.source===src);
      return r ? (r.area_name||r.area||r.name||src) : src;
    };
    const sortedSources = [...calSources].sort((a,b)=>radioName(a).localeCompare(radioName(b)));

    const rowEl = el("div",{style:"display:grid;grid-template-columns:1fr auto 1fr;gap:6px;align-items:center;margin-bottom:8px"});

    const oldSel = document.createElement("select");
    oldSel.style.cssText = "font-size:11px;width:100%";
    oldSel.appendChild(mkOpt("","— old radio —"));
    for(const src of sortedSources) oldSel.appendChild(mkOpt(src, radioName(src)));

    const arrowEl = el("div",{style:"font-size:14px;color:#78909c;text-align:center"},"→");

    const newSel = document.createElement("select");
    newSel.style.cssText = "font-size:11px;width:100%";
    newSel.appendChild(mkOpt("","— new radio —"));
    for(const src of sortedSources) newSel.appendChild(mkOpt(src, radioName(src)));

    rowEl.appendChild(oldSel);
    rowEl.appendChild(arrowEl);
    rowEl.appendChild(newSel);
    swapCard.appendChild(rowEl);

    // Summary line (updates when selects change)
    const summaryEl = el("div",{style:"font-size:10px;color:#78909c;margin-bottom:8px;min-height:14px"});
    const updateSummary = () => {
      if(!oldSel.value || !newSel.value || oldSel.value === newSel.value){
        summaryEl.textContent = "";
        return;
      }
      const pts = (calData.points||[]).filter(pt =>
        (pt.scanner_readings||[]).some(sr=>sr.source===oldSel.value)
      ).length;
      summaryEl.textContent = `Will update ${pts} calibration point${pts!==1?"s":""}. This cannot be undone.`;
      summaryEl.style.color = pts > 0 ? "#f59e0b" : "#78909c";
    };
    oldSel.addEventListener("change", updateSummary);
    newSel.addEventListener("change", updateSummary);
    swapCard.appendChild(summaryEl);

    // Swap button
    const swapBtnWrap = el("div");
    const makeSwapBtn = () => {
      const btn = el("button",{class:"btn inline",style:"font-size:11px;width:100%"},"Swap Readings");
      btn.addEventListener("click", async () => {
        const old_source = oldSel.value;
        const new_source = newSel.value;
        if(!old_source || !new_source){ ctx.toast("Select both radios first.", true); return; }
        if(old_source === new_source){ ctx.toast("Old and new radio must be different.", true); return; }
        btn.disabled = true; btn.textContent = "Swapping…";
        try {
          const res = await ctx.actions.calibrationSwapRadio(old_source, new_source);
          ctx.state.calibration = null;  // force reload
          ctx.toast(`Swapped ${res.updated_readings} reading${res.updated_readings!==1?"s":""} from ${radioName(old_source)} → ${radioName(new_source)}.`);
          ctx.actions.renderRooms();
        } catch(e){
          ctx.toast("Swap failed: " + String(e), true);
          swapBtnWrap.innerHTML = "";
          swapBtnWrap.appendChild(makeSwapBtn());
        }
      });
      return btn;
    };
    swapBtnWrap.appendChild(makeSwapBtn());
    swapCard.appendChild(swapBtnWrap);
    wrap.appendChild(swapCard);
  }

  // ── Relearn Radio card ──────────────────────────────────────────────────────
  // Adjust calibration data after antenna upgrade/downgrade — shifts all stored
  // RSSI readings for a scanner by a user-provided dB gain.
  if(calSources.size >= 1){
    const relearnCard = el("div",{class:"card",style:"padding:10px"});
    relearnCard.appendChild(el("div",{style:"font-weight:700;font-size:12px;margin-bottom:4px"},"Relearn Radio"));
    relearnCard.appendChild(el("div",{style:"font-size:10px;color:#78909c;margin-bottom:8px;line-height:1.5"},
      "Adjust calibration after an antenna upgrade or downgrade. Shifts all stored RSSI readings for the selected scanner by the dB gain you specify."));

    const radioName = (src) => {
      const r = radios.find(r=>r.source===src);
      return r ? (r.area_name||r.area||r.name||src) : src;
    };
    const rlSorted = [...calSources].sort((a,b)=>radioName(a).localeCompare(radioName(b)));

    const rlRow = el("div",{style:"display:grid;grid-template-columns:1fr auto;gap:6px;align-items:center;margin-bottom:8px"});
    const rlSel = document.createElement("select");
    rlSel.style.cssText = "font-size:11px;width:100%";
    rlSel.appendChild((() => { const o = document.createElement("option"); o.value=""; o.textContent="— select scanner —"; return o; })());
    for(const src of rlSorted){
      const o = document.createElement("option"); o.value=src; o.textContent=radioName(src); rlSel.appendChild(o);
    }

    const rlGainWrap = el("div",{style:"display:flex;align-items:center;gap:4px"});
    const rlGainInput = document.createElement("input");
    rlGainInput.type = "number"; rlGainInput.min = "-30"; rlGainInput.max = "30"; rlGainInput.step = "1"; rlGainInput.value = "3";
    rlGainInput.style.cssText = "width:48px;text-align:center;background:#0a150e;border:1px solid #2d5a3d;border-radius:4px;color:#e2e8f0;padding:2px 4px;font-size:11px";
    rlGainInput.title = "Positive = antenna upgrade (stronger signal); Negative = downgrade (weaker)";
    rlGainWrap.appendChild(rlGainInput);
    rlGainWrap.appendChild(el("span",{style:"font-size:10px;color:#78909c"},"dB"));

    rlRow.appendChild(rlSel);
    rlRow.appendChild(rlGainWrap);
    relearnCard.appendChild(rlRow);

    const rlHint = el("div",{style:"font-size:9px;color:#94a3b8;margin-bottom:8px"},
      "Positive = upgrade (e.g. +3 dB for better antenna). Negative = downgrade.");

    // Summary line
    const rlSummary = el("div",{style:"font-size:10px;color:#78909c;margin-bottom:8px;min-height:14px"});
    const updateRlSummary = () => {
      if(!rlSel.value){ rlSummary.textContent = ""; return; }
      const pts = (calData.points||[]).filter(pt =>
        (pt.scanner_readings||[]).some(sr=>sr.source===rlSel.value)
      ).length;
      const g = parseFloat(rlGainInput.value) || 0;
      rlSummary.textContent = pts > 0
        ? `Will shift ${pts} calibration point${pts!==1?"s":""} by ${g > 0 ? "+" : ""}${g} dB. Model will be recomputed.`
        : `No calibration data found for this scanner.`;
      rlSummary.style.color = pts > 0 ? "#38bdf8" : "#78909c";
    };
    rlSel.addEventListener("change", updateRlSummary);
    rlGainInput.addEventListener("input", updateRlSummary);
    relearnCard.appendChild(rlHint);
    relearnCard.appendChild(rlSummary);

    // Apply button
    const rlBtnWrap = el("div");
    const makeRlBtn = () => {
      const btn = el("button",{class:"btn inline",style:"font-size:11px;width:100%"},"Relearn");
      btn.addEventListener("click", async () => {
        const source = rlSel.value;
        const gain = Math.max(-30, Math.min(30, parseFloat(rlGainInput.value) || 0));
        if(!source){ ctx.toast("Select a scanner first.", true); return; }
        if(gain === 0){ ctx.toast("Gain must be non-zero.", true); return; }
        btn.disabled = true; btn.textContent = "Relearning…";
        try {
          const res = await ctx.actions.calibrationRelearnRadio(source, gain);
          ctx.state.calibration = null;
          ctx.toast(`Relearned ${radioName(source)}: ${gain > 0 ? "+" : ""}${gain} dB — ${res.updated_points} point${res.updated_points!==1?"s":""} updated.`);
          ctx.actions.renderRooms();
        } catch(e){
          ctx.toast("Relearn failed: " + String(e), true);
          rlBtnWrap.innerHTML = "";
          rlBtnWrap.appendChild(makeRlBtn());
        }
      });
      return btn;
    };
    rlBtnWrap.appendChild(makeRlBtn());
    relearnCard.appendChild(rlBtnWrap);
    wrap.appendChild(relearnCard);
  }

  // Reload button
  wrap.appendChild(el("div",{style:"text-align:center"},[
    el("button",{class:"btn inline",style:"font-size:11px",
      onclick:()=>{ ctx.state.calibration=null; ctx.actions.renderRooms(); }},
      "Reload calibration data"),
  ]));

  return wrap;
}

// Build per-map scanner estimates — every scanner that heard any calibration point
// on a given map gets an estimated position on that map.
// Returns { mapId: [ {source, name, x_frac, y_frac, pointCount, meanRssi, confidence} ] }
function _estimatePositionsPerMap(calData, radios){
  // acc[mapId][source] = [{x_frac, y_frac, mean_rssi}]
  const acc = {};
  for(const pt of calData.points || []){
    for(const sr of pt.scanner_readings || []){
      if(!sr.source || !sr.rssi_samples?.length) continue;
      const meanRssi = sr.rssi_samples.reduce((a,b)=>a+b,0) / sr.rssi_samples.length;
      if(!acc[pt.map_id]) acc[pt.map_id] = {};
      if(!acc[pt.map_id][sr.source]) acc[pt.map_id][sr.source] = [];
      acc[pt.map_id][sr.source].push({ x_frac:pt.x_frac, y_frac:pt.y_frac, mean_rssi:meanRssi });
    }
  }

  const result = {};
  for(const [mapId, bySource] of Object.entries(acc)){
    result[mapId] = [];
    for(const [source, pts] of Object.entries(bySource)){
      const weights = pts.map(p => Math.pow(10, p.mean_rssi / 10));
      const totalW  = weights.reduce((a,b)=>a+b, 0);
      const x = pts.reduce((s,p,i) => s + p.x_frac * weights[i], 0) / totalW;
      const y = pts.reduce((s,p,i) => s + p.y_frac * weights[i], 0) / totalW;
      const meanRssi  = Math.round(pts.reduce((s,p)=>s+p.mean_rssi,0) / pts.length);
      const confidence = Math.min(1, pts.length / 6);
      // Resolve display name from live snapshot radios
      const radio = radios.find(r => r.source === source);
      const name  = radio?.area_name || radio?.area || radio?.name || source;
      result[mapId].push({ source, name, x_frac:x, y_frac:y, pointCount:pts.length, meanRssi, confidence });
    }
    // Sort: most calibration points first
    result[mapId].sort((a,b) => b.pointCount - a.pointCount);
  }
  return result;
}

function _floorNameForMap(mapData, haFloors){
  if(!mapData) return null;
  const fid = mapData.floor_id;
  if(!fid) return null;
  const f = haFloors.find(f=>f.id===fid);
  return f ? (f.name || f.id) : fid;
}

function _toHex(c){
  const s = String(c||"").trim();
  if(/^#[0-9a-f]{6}$/i.test(s)) return s;
  const tmp = document.createElement("div");
  tmp.style.color = s;
  document.body.appendChild(tmp);
  const rgb = getComputedStyle(tmp).color;
  tmp.remove();
  const m = rgb.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/i);
  if(!m) return "#888888";
  const r = Number(m[1])|0, g=Number(m[2])|0, b=Number(m[3])|0;
  return "#" + [r,g,b].map(x=>x.toString(16).padStart(2,"0")).join("");
}

// ── Presence tab ────────────────────────────────────────────────────────────────
function _settingsPresence(ctx, el){
  const helpBtn = ctx.helpers.helpBtn;
  const settings = ctx.state.settings || {};
  const inpStyle = "width:72px;text-align:center;background:#0a150e;border:1px solid #2d5a3d;border-radius:6px;color:#e2e8f0;padding:4px 8px;font-size:13px";
  const rowStyle = "display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:6px";
  const wrap = el("div",{style:"display:flex;flex-direction:column;gap:12px"});
  wrap.appendChild(el("div",{style:"display:flex;align-items:center;gap:8px"},[
    el("div",{style:"font-weight:700;font-size:15px;color:#52b788"},"Presence Settings"),
    helpBtn("settings_presence"),
  ]));

  // ── Quiet Mode ────────────────────────────────────────────────────────────
  {
    const quietOn = settings.quiet_mode === true;
    const quietToggle = el("input",{type:"checkbox",id:"quietModeToggle",style:"width:16px;height:16px;accent-color:#52b788;cursor:pointer"});
    quietToggle.checked = quietOn;
    quietToggle.addEventListener("change", async()=>{
      try {
        await ctx.actions.settingsSet({ quiet_mode: quietToggle.checked });
        ctx.toast(quietToggle.checked ? "Quiet mode on — only tracked objects visible" : "Quiet mode off — all objects visible");
        ctx.actions.renderRooms();
      } catch(e){ ctx.toast("Failed to save", true); }
    });
    wrap.appendChild(el("div",{class:"card",style:"border-color:" + (quietOn ? "#52b788" : "#334155")},[
      el("div",{style:"display:flex;align-items:center;gap:8px;margin-bottom:4px"},[
        el("div",{class:"h2",style:"margin:0;color:#52b788"}, "Quiet Mode"),
      ]),
      el("div",{style:"display:flex;align-items:center;gap:8px;margin-bottom:10px"},[
        quietToggle,
        el("label",{for:"quietModeToggle",style:"font-size:13px;color:#e2e8f0;cursor:pointer;font-weight:600"},
          "Only show identified & followed objects"),
      ]),
      el("div",{class:"muted",style:"font-size:12px"},
        "Hides all unidentified BLE devices from the Objects list, overview counts, and dropdowns. " +
        "Scanning continues in the background so tracked objects still work. " +
        "Ideal for busy environments (condos, offices) where you only care about your own devices. " +
        "Turn off when you need to discover and tag new objects."),
    ]));
  }

  // ── Light Theme (inverted) ────────────────────────────────────────────────
  {
    const themeOn = settings.light_theme === true;
    const themeToggle = el("input",{type:"checkbox",id:"lightThemeToggle",style:"width:16px;height:16px;accent-color:#52b788;cursor:pointer"});
    themeToggle.checked = themeOn;
    themeToggle.addEventListener("change", async()=>{
      try {
        await ctx.actions.settingsSet({ light_theme: themeToggle.checked });
        ctx.toast(themeToggle.checked ? "Light theme on" : "Dark theme restored");
      } catch(e){ ctx.toast("Failed to save", true); }
    });
    wrap.appendChild(el("div",{class:"card",style:"border-color:" + (themeOn ? "#52b788" : "#334155")},[
      el("div",{style:"display:flex;align-items:center;gap:8px;margin-bottom:4px"},[
        el("div",{class:"h2",style:"margin:0;color:#52b788"}, "Light Theme"),
      ]),
      el("div",{style:"display:flex;align-items:center;gap:8px;margin-bottom:10px"},[
        themeToggle,
        el("label",{for:"lightThemeToggle",style:"font-size:13px;color:#e2e8f0;cursor:pointer;font-weight:600"},
          "Invert the panel colours (light background)"),
      ]),
      el("div",{class:"muted",style:"font-size:12px"},
        "Inverts every colour in the panel — white becomes black, black becomes white — for an " +
        "accessible light appearance. Photos and map images are automatically counter-inverted so " +
        "they still look normal. Applies instantly to this PadSpan panel."),
    ]));
  }

  // ── Fabric source ─────────────────────────────────────────────────────────
  // "Runs without Home Assistant areas" — the fabric is the model, and this
  // decides whether HA's registry gets to write into it.
  {
    const cur = (ctx.state.model && ctx.state.model.fabric_sync_mode) || "auto";
    const sel = el("select", {
      style: "width:220px;background:#0a150e;color:#e2e8f0;border:1px solid #2d5a3d;border-radius:6px;padding:4px 8px;font-size:13px",
    });
    for (const [v, label] of [["auto", "Follow Home Assistant areas"],
                              ["manual", "Standalone — the fabric is the truth"]]) {
      const o = el("option", { value: v }, label);
      if (cur === v) o.selected = true;
      sel.appendChild(o);
    }
    sel.addEventListener("change", async () => {
      try {
        await ctx.actions.callWS({ type: "padspan_ha/fabric_sync_mode_set", mode: sel.value });
        ctx.toast(sel.value === "manual"
          ? "Standalone — rooms and scanners come from the fabric only"
          : "Following Home Assistant areas");
        await ctx.actions.modelRefresh();
      } catch(e) { ctx.toast("Failed to save", true); }
    });
    wrap.appendChild(el("div", { class: "card" }, [
      el("div", { class: "h2", style: "color:#52b788" }, "Fabric source"),
      el("div", { style: "display:flex;align-items:center;gap:10px;margin-bottom:8px" }, [sel]),
      el("div", { class: "muted", style: "font-size:12px" },
        "Standalone lets PadSpan run with rooms you created here and no Home Assistant areas at all."),
    ]));
  }

  // ── Positioning Algorithm ─────────────────────────────────────────────────
  {
    const cs = (ctx.state.live && ctx.state.live.snapshot && ctx.state.live.snapshot.calibration_status) || {};
    const curAlgo = settings.positioning_algorithm || "knn";
    const rfReady = cs.rf_trained === true;
    const algoSel = el("select", {
      style: "width:180px;background:#0a150e;color:#e2e8f0;border:1px solid #2d5a3d;border-radius:6px;padding:4px 8px;font-size:13px",
    });
    const optKnn = el("option", { value: "knn" }, "k-NN (default)");
    const optRf = el("option", { value: "rf" }, "Random Forest (experimental)" + (rfReady ? "" : " — not trained"));
    if (curAlgo === "knn") optKnn.selected = true;
    else optRf.selected = true;
    algoSel.appendChild(optKnn);
    algoSel.appendChild(optRf);
    algoSel.addEventListener("change", async () => {
      try {
        await ctx.actions.settingsSet({ positioning_algorithm: algoSel.value });
        ctx.toast(`Positioning algorithm: ${algoSel.value === "rf" ? "Random Forest" : "k-NN"}`);
        ctx.actions.renderRooms();
      } catch(e) { ctx.toast("Failed to save", true); }
    });
    wrap.appendChild(el("div", { class: "card" }, [
      el("div", { class: "h2", style: "color:#52b788" }, "Positioning Algorithm"),
      el("div", { style: "display:flex;align-items:center;gap:10px;margin-bottom:8px" }, [
        algoSel,
        el("span", { class: "muted", style: "font-size:12px" },
          curAlgo === "rf" ? (rfReady ? "Active" : "Falling back to k-NN") : ""),
      ]),
      el("div", { class: "muted", style: "font-size:12px;line-height:1.6" },
        "k-NN compares live signals to the nearest calibration points — works well even with sparse scanner coverage. " +
        "Random Forest (experimental) trains a decision-tree model — needs dense multi-scanner overlap per object to outperform k-NN. " +
        "Both use the same calibration dataset — switching is instant and safe."),
    ]));
  }

  // ── Room change delay ──────────────────────────────────────────────────────
  const currentDelay = (settings.room_change_delay_s != null ? Number(settings.room_change_delay_s) : 20);
  const _pollInt = (settings.presence_poll_interval_s != null ? Number(settings.presence_poll_interval_s) : 10);
  const polls = Math.max(1, Math.round(currentDelay / _pollInt));
  const delayInp = el("input", {
    type: "number", min: "0", max: "300", step: "5", value: String(currentDelay), style: inpStyle,
  });
  const delaySaveBtn = el("button", { class: "btn" }, "Save");
  delaySaveBtn.addEventListener("click", async () => {
    const v = Math.max(0, Math.min(300, parseFloat(delayInp.value) || 0));
    try {
      await ctx.actions.settingsSet({ room_change_delay_s: v });
      ctx.toast(`Room change delay set to ${v}s`);
    } catch(e) { ctx.toast("Failed to save setting", true); }
  });
  wrap.appendChild(el("div", { class: "card" }, [
    el("div", { class: "h2" }, "Room Change Delay"),
    el("div", { class: "muted", style: "font-size:12px;margin-bottom:14px" },
      "How long a scanner must consistently dominate before PadSpan switches a device to a new room. " +
      "Higher values prevent flickering when a device sits on the boundary between two scanners."
    ),
    el("div", { style: rowStyle }, [
      el("div", { style: "font-size:13px;color:#a7f3d0;min-width:130px" }, "Room change delay"),
      delayInp,
      el("div", { class: "muted", style: "font-size:12px" }, "seconds"),
      delaySaveBtn,
    ]),
    el("div", { class: "muted", style: "font-size:11px;margin-top:8px" },
      `Current: ${currentDelay}s → requires ~${polls} consecutive ${_pollInt}s poll${polls !== 1 ? "s" : ""} agreement. ` +
      `Set to 0 for instant room switching.`
    ),
  ]));

  // ── Presence Poll Interval ──────────────────────────────────────────────────
  const currentPoll = (settings.presence_poll_interval_s != null ? Number(settings.presence_poll_interval_s) : 10);
  const pollInp = el("input", {
    type: "number", min: "1", max: "60", step: "1", value: String(currentPoll), style: inpStyle,
  });
  const pollSaveBtn = el("button", { class: "btn" }, "Save");
  pollSaveBtn.addEventListener("click", async () => {
    const v = Math.max(1, Math.min(60, parseInt(pollInp.value) || 10));
    try {
      await ctx.actions.settingsSet({ presence_poll_interval_s: v });
      ctx.toast(`Poll interval set to ${v}s`);
    } catch(e) { ctx.toast("Failed to save setting", true); }
  });
  wrap.appendChild(el("div", { class: "card" }, [
    el("div", { class: "h2" }, "Presence Poll Interval"),
    el("div", { class: "muted", style: "font-size:12px;margin-bottom:14px" },
      "How often the smoothing pipeline runs to update room assignments. " +
      "Lower values give faster room transitions but use more CPU. " +
      "Higher values reduce load on low-end hardware."
    ),
    el("div", { style: rowStyle }, [
      el("div", { style: "font-size:13px;color:#a7f3d0;min-width:130px" }, "Poll interval"),
      pollInp,
      el("div", { class: "muted", style: "font-size:12px" }, "seconds"),
      pollSaveBtn,
    ]),
    el("div", { class: "muted", style: "font-size:11px;margin-top:8px" },
      `Current: ${currentPoll}s. Default: 10s. Range: 1–60s.`
    ),
  ]));

  // ── CPU Mode ───────────────────────────────────────────────────────────────
  const cpuMode = (settings.cpu_mode || "shared").toLowerCase();
  const pinOk = !!ctx.state.cpuPinningSupported;
  const cpuSel = el("select", { style:
    "font-size:13px;background:#0f172a;color:#e2e8f0;border:1px solid #334155;border-radius:4px;padding:5px 8px" });
  const cpuOpts = [
    ["shared", "Shared — fastest updates, competes with HA"],
    ["single", "Single core — capped at one core, HA stays responsive"],
  ];
  if (pinOk) cpuOpts.push(["dedicated", "Dedicated core — own pinned core, zero contention"]);
  for (const [val, label] of cpuOpts) {
    const opt = el("option", { value: val }, label);
    if (val === cpuMode) opt.selected = true;
    cpuSel.appendChild(opt);
  }
  cpuSel.addEventListener("change", async () => {
    try {
      await ctx.actions.settingsSet({ cpu_mode: cpuSel.value });
      ctx.toast(`CPU mode: ${cpuSel.value}`);
    } catch(e) { ctx.toast("Failed to save setting", true); }
  });
  wrap.appendChild(el("div", { class: "card" }, [
    el("div", { class: "h2" }, "CPU Mode"),
    el("div", { class: "muted", style: "font-size:12px;margin-bottom:14px" },
      "Where the presence-smoothing computation runs. Shared runs it on Home Assistant's " +
      "main loop (fastest, but can slow HA on low-core hardware like a Pi). Single core moves " +
      "it to a background worker capped at one core so HA stays responsive." +
      (pinOk ? " Dedicated core additionally pins that worker to its own CPU core." : "")
    ),
    el("div", { style: rowStyle }, [
      el("div", { style: "font-size:13px;color:#a7f3d0;min-width:130px" }, "CPU mode"),
      cpuSel,
    ]),
    el("div", { class: "muted", style: "font-size:11px;margin-top:8px" },
      "Applies from the next poll cycle — no restart needed." +
      (pinOk ? "" : " (Dedicated core is unavailable on this platform.)")
    ),
  ]));

  // ── Update Check ───────────────────────────────────────────────────────────
  const updChkOn = settings.update_check_enabled !== false;
  const updChkBtn = el("button", { class: "btn inline", style: updChkOn
    ? "background:#0a2a1a;border-color:#52b788;color:#52b788;font-weight:700"
    : "color:#94a3b8" }, updChkOn ? "Enabled" : "Disabled");
  updChkBtn.addEventListener("click", async () => {
    try {
      await ctx.actions.settingsSet({ update_check_enabled: !updChkOn });
      ctx.toast(`Update check ${!updChkOn ? "enabled" : "disabled"}`);
      ctx.actions.renderRooms();
    } catch(e) { ctx.toast("Failed to save setting", true); }
  });
  wrap.appendChild(el("div", { class: "card" }, [
    el("div", { class: "h2" }, "Update Check"),
    el("div", { class: "muted", style: "font-size:12px;margin-bottom:14px" },
      "Once a day PadSpan asks padspan.traks.ca whether a newer version exists and " +
      "notifies you when one is available. The request contains only your installed " +
      "version number; the server sees your IP address (as any web request does) and " +
      "stores nothing else about you. Turn it off here if you prefer no contact."
    ),
    el("div", { style: rowStyle }, [
      el("div", { style: "font-size:13px;color:#a7f3d0;min-width:130px" }, "Update check"),
      updChkBtn,
    ]),
  ]));

  // ── Help improve PadSpan (opt-in usage report) ─────────────────────────────
  // OFF by default. The Preview shows the exact JSON that would go, before or
  // after opting in; the backend refuses to send anything identifier-shaped
  // regardless (telemetry.py assert_shareable).
  const telOn = !!settings.telemetry_enabled;
  const telBtn = el("button", { class: "btn inline", style: telOn
    ? "background:#0a2a1a;border-color:#52b788;color:#52b788;font-weight:700"
    : "color:#94a3b8" }, telOn ? "Opted in" : "Not sharing");
  telBtn.addEventListener("click", async () => {
    try {
      await ctx.actions.settingsSet({ telemetry_enabled: !telOn });
      ctx.toast(!telOn ? "Thank you — usage report on. Preview shows exactly what goes." : "Usage report off");
      ctx.actions.renderRooms();
    } catch(e) { ctx.toast("Failed to save setting", true); }
  });
  const telOut = el("pre", { class: "pre", style: "display:none;margin-top:10px;max-height:360px;overflow:auto;font-size:11px" });
  const telStatus = el("span", { class: "muted", style: "font-size:11px;margin-left:8px" }, "");
  const previewBtn = el("button", { class: "btn inline" }, "Preview what would be sent");
  previewBtn.addEventListener("click", async () => {
    previewBtn.disabled = true;
    try {
      const r = await ctx.actions.wsCall("padspan_ha/telemetry_preview");
      telOut.textContent = JSON.stringify(r.payload, null, 2);
      telOut.style.display = "block";
      telStatus.textContent = r.problem
        ? "Would be REFUSED before sending: " + r.problem
        : `${JSON.stringify(r.payload).length} bytes \u2192 ${r.url}`;
      telStatus.style.color = r.problem ? "#f87171" : "";
    } catch(e) { ctx.toast("Preview failed: " + (e.message || e), true); }
    previewBtn.disabled = false;
  });
  const sendBtn = el("button", { class: "btn inline", disabled: telOn ? undefined : "disabled",
    title: telOn ? "Send one report now" : "Opt in first" }, "Send a report now");
  sendBtn.addEventListener("click", async () => {
    sendBtn.disabled = true;
    try {
      const r = await ctx.actions.wsCall("padspan_ha/telemetry_send_now");
      ctx.toast(r.sent ? `Report sent (${r.bytes} bytes)` : "Not sent: " + (r.reason || "unknown"), !r.sent);
    } catch(e) { ctx.toast("Send failed: " + (e.message || e), true); }
    sendBtn.disabled = false;
  });
  const idBtn = el("button", { class: "btn inline", title: "Replace the anonymous install id with a new random one" }, "New anonymous ID");
  idBtn.addEventListener("click", async () => {
    idBtn.disabled = true;
    try {
      await ctx.actions.wsCall("padspan_ha/telemetry_reset_id");
      ctx.toast("New anonymous ID minted");
      await ctx.actions.settingsSet({});   // reloads settings into ctx.state
    } catch(e) { ctx.toast("Failed: " + (e.message || e), true); }
    idBtn.disabled = false;
    ctx.actions.renderRooms();
  });
  wrap.appendChild(el("div", { class: "card" }, [
    el("div", { class: "h2" }, "Help improve PadSpan"),
    el("div", { class: "muted", style: "font-size:12px;margin-bottom:8px;line-height:1.55" },
      "Opt in to send the developer an anonymous usage report at most once a day: which version and " +
      "Home Assistant; how many scanners, floors, rooms, placed lights, walls, maps, calibration points, " +
      "IRKs and objects you have and which related integrations are installed; which feature switches " +
      "are on; which tabs and tools got used (and whether IRKs are resolving anything); a few health flags; and how many warnings each part of the " +
      "code logged. Counts, versions and flags only \u2014 never addresses, keys, device or room names, " +
      "coordinates or timestamps. Preview is the complete list. PadSpan is developed against one house; " +
      "this is how features that only exist in yours (an iPhone with an IRK, a Bermuda install, twelve floors) get seen at all."
    ),
    el("div", { class: "muted", style: "font-size:11px;margin-bottom:12px" },
      "The report carries a random ID so installs can be counted rather than pings; you can replace it any time. " +
      "Preview shows the exact JSON \u2014 what you see is what goes, and anything identifier-shaped is refused before it leaves."),
    el("div", { style: rowStyle }, [
      el("div", { style: "font-size:13px;color:#a7f3d0;min-width:130px" }, "Usage report"),
      telBtn,
      telStatus,
    ]),
    el("div", { style: "display:flex;gap:8px;flex-wrap:wrap;margin-top:10px" }, [previewBtn, sendBtn, idBtn]),
    telOut,
  ]));

  // ── BLE Reseed Interval ──────────────────────────────────────────────────
  const currentReseed = (settings.ble_reseed_interval_s != null ? Number(settings.ble_reseed_interval_s) : 30);
  const reseedInp = el("input", {
    type: "number", min: "1", max: "60", step: "1", value: String(currentReseed), style: inpStyle,
  });
  const reseedSaveBtn = el("button", { class: "btn" }, "Save");
  reseedSaveBtn.addEventListener("click", async () => {
    const v = Math.max(1, Math.min(60, parseInt(reseedInp.value) || 30));
    try {
      await ctx.actions.settingsSet({ ble_reseed_interval_s: v });
      ctx.toast(`BLE reseed interval set to ${v}s`);
    } catch(e) { ctx.toast("Failed to save setting", true); }
  });
  wrap.appendChild(el("div", { class: "card" }, [
    el("div", { class: "h2" }, "BLE Reseed Interval"),
    el("div", { class: "muted", style: "font-size:12px;margin-bottom:14px" },
      "How often PadSpan re-fetches BLE data from HA's scanner infrastructure. " +
      "Essential for passive proxy scanners (Shelly, ESPHome BLE proxy) whose " +
      "advertisements don't arrive via callbacks. Lower values improve freshness on fast hardware."
    ),
    el("div", { style: rowStyle }, [
      el("div", { style: "font-size:13px;color:#a7f3d0;min-width:130px" }, "Reseed interval"),
      reseedInp,
      el("div", { class: "muted", style: "font-size:12px" }, "seconds"),
      reseedSaveBtn,
    ]),
    el("div", { class: "muted", style: "font-size:11px;margin-top:8px" },
      `Current: ${currentReseed}s. Default: 30s. Range: 1–60s.`
    ),
  ]));

  // ── Object History Retention ───────────────────────────────────────────────
  const HISTORY_DAY_CHOICES = [1, 2, 7, 14];
  const currentHistDays = (HISTORY_DAY_CHOICES.includes(Number(settings.object_history_days))
    ? Number(settings.object_history_days) : 1);
  const _unidentifiedNow = (((ctx.state.live && ctx.state.live.snapshot || {}).objects || {}).summary || {}).unidentified;
  const histSel = el("select", {
    style: "width:180px;background:#0a150e;color:#e2e8f0;border:1px solid #2d5a3d;border-radius:6px;padding:4px 8px;font-size:13px",
  });
  for (const d of HISTORY_DAY_CHOICES) {
    const o = el("option", { value: String(d) }, d === 1 ? "1 day (default)" : `${d} days`);
    if (d === currentHistDays) o.selected = true;
    histSel.appendChild(o);
  }
  const histSaveBtn = el("button", { class: "btn" }, "Save");
  histSaveBtn.addEventListener("click", async () => {
    const v = Number(histSel.value);
    if (!HISTORY_DAY_CHOICES.includes(v)) { ctx.toast("Invalid retention window", true); return; }
    try {
      await ctx.actions.settingsSet({ object_history_days: v });
      ctx.toast(`Object history set to ${v} day${v !== 1 ? "s" : ""}`);
    } catch(e) { ctx.toast("Failed to save setting", true); }
  });
  wrap.appendChild(el("div", { class: "card" }, [
    el("div", { class: "h2" }, "Object History Retention"),
    el("div", { class: "muted", style: "font-size:12px;margin-bottom:14px" },
      "How long a device that you never labelled is kept in history. " +
      "Labelled and tagged devices are never removed, whatever this is set to. " +
      "Every rotating-MAC device that passes by becomes a new entry, and the whole " +
      "history is sent to this panel on every 5s refresh — so longer windows make " +
      "the panel slower. Raise it only if you need to go back and label something you saw days ago."
    ),
    el("div", { style: rowStyle }, [
      el("div", { style: "font-size:13px;color:#a7f3d0;min-width:130px" }, "Keep unlabelled for"),
      histSel,
      histSaveBtn,
    ]),
    el("div", { class: "muted", style: "font-size:11px;margin-top:8px" },
      `Current: ${currentHistDays} day${currentHistDays !== 1 ? "s" : ""}. Default: 1 day. ` +
      (_unidentifiedNow != null ? `Unlabelled devices in history right now: ${_unidentifiedNow}. ` : "") +
      "Lowering this takes effect on the next refresh; entries past the window are dropped."
    ),
  ]));

  // ── Away timeout ───────────────────────────────────────────────────────────
  const currentAwayM = (settings.away_timeout_m != null ? Number(settings.away_timeout_m) : 5);
  const awayInp = el("input", {
    type: "number", min: "1", max: "1440", step: "1", value: String(currentAwayM), style: inpStyle,
  });
  const awaySaveBtn = el("button", { class: "btn" }, "Save");
  awaySaveBtn.addEventListener("click", async () => {
    const v = Math.max(1, Math.min(1440, parseFloat(awayInp.value) || 5));
    try {
      await ctx.actions.settingsSet({ away_timeout_m: v });
      ctx.toast(`Away timeout set to ${v} min`);
    } catch(e) { ctx.toast("Failed to save setting", true); }
  });
  wrap.appendChild(el("div", { class: "card" }, [
    el("div", { class: "h2" }, "Home/Away Timeout"),
    el("div", { class: "muted", style: "font-size:12px;margin-bottom:14px" },
      "If a device hasn't been detected for this long, it is marked as not_home in HA. " +
      "The device_tracker and area sensor both switch to not_home. " +
      "Set higher if devices drop off briefly during normal use."
    ),
    el("div", { style: rowStyle }, [
      el("div", { style: "font-size:13px;color:#a7f3d0;min-width:130px" }, "Away timeout"),
      awayInp,
      el("div", { class: "muted", style: "font-size:12px" }, "minutes"),
      awaySaveBtn,
    ]),
    el("div", { class: "muted", style: "font-size:11px;margin-top:8px" },
      `Current: ${currentAwayM} min (${currentAwayM * 60}s). Default: 5 min. Range: 1 min – 24 h.`
    ),
  ]));

  // ── Signal Loss Linger ───────────────────────────────────────────────────
  const currentLinger = (settings.signal_loss_linger_s != null ? Number(settings.signal_loss_linger_s) : 90);
  const lingerPolls = Math.max(2, Math.round(currentLinger / 10));
  const lingerInp = el("input", {
    type: "number", min: "10", max: "300", step: "10", value: String(currentLinger), style: inpStyle,
  });
  const lingerSaveBtn = el("button", { class: "btn" }, "Save");
  lingerSaveBtn.addEventListener("click", async () => {
    const v = Math.max(10, Math.min(300, parseInt(lingerInp.value) || 90));
    try {
      await ctx.actions.settingsSet({ signal_loss_linger_s: v });
      ctx.toast(`Signal loss linger set to ${v}s`);
    } catch(e) { ctx.toast("Failed to save setting", true); }
  });
  wrap.appendChild(el("div", { class: "card" }, [
    el("div", { class: "h2" }, "Signal Loss Linger"),
    el("div", { class: "muted", style: "font-size:12px;margin-bottom:14px" },
      "How long to hold a device at its last known room when it disappears from all scanners. " +
      "Only applies to devices with confident presence (≥60%). " +
      "Weak or transient devices still use the short 20s grace period."
    ),
    el("div", { style: rowStyle }, [
      el("div", { style: "font-size:13px;color:#a7f3d0;min-width:130px" }, "Linger time"),
      lingerInp,
      el("div", { class: "muted", style: "font-size:12px" }, "seconds"),
      lingerSaveBtn,
    ]),
    el("div", { class: "muted", style: "font-size:11px;margin-top:8px" },
      `Current: ${currentLinger}s (~${lingerPolls} polls). Default: 90s. Range: 10s – 300s.`
    ),
  ]));

  // ── BLE Advertisement Timeout ─────────────────────────────────────────────
  const currentBleAge = (settings.ble_max_age_s != null ? Number(settings.ble_max_age_s) : 3600);
  const bleAgeInp = el("input", {
    type: "number", min: "60", max: "14400", step: "60", value: String(currentBleAge), style: inpStyle,
  });
  const bleAgeSaveBtn = el("button", { class: "btn" }, "Save");
  bleAgeSaveBtn.addEventListener("click", async () => {
    const v = Math.max(60, Math.min(14400, parseInt(bleAgeInp.value) || 3600));
    try {
      await ctx.actions.settingsSet({ ble_max_age_s: v });
      ctx.toast(`BLE timeout set to ${v}s`);
    } catch(e) { ctx.toast("Failed to save setting", true); }
  });
  wrap.appendChild(el("div", { class: "card" }, [
    el("div", { class: "h2" }, "BLE Advertisement Timeout"),
    el("div", { class: "muted", style: "font-size:12px;margin-bottom:14px" },
      "How long to keep a BLE device visible after its last advertisement. " +
      "Higher values show more devices (especially slow-broadcasting ones). " +
      "Lower values keep the list cleaner but may drop intermittent devices."
    ),
    el("div", { style: rowStyle }, [
      el("div", { style: "font-size:13px;color:#a7f3d0;min-width:130px" }, "Max age"),
      bleAgeInp,
      el("div", { class: "muted", style: "font-size:12px" }, "seconds"),
      bleAgeSaveBtn,
    ]),
    el("div", { class: "muted", style: "font-size:11px;margin-top:8px" },
      `Current: ${currentBleAge}s. Default: 900s (15 min). Range: 60s – 1800s (30 min).`
    ),
  ]));

  // ── Private BLE / IRK Management ─────────────────────────────────────────
  {
    const irkCard = el("div", { class: "card" });
    irkCard.appendChild(el("div", { class: "h2" }, "Phone Tracking (Private BLE)"));
    irkCard.appendChild(el("div", { class: "muted", style: "font-size:12px;margin-bottom:14px" },
      "Track phones and watches with rotating MAC addresses using their IRK (Identity Resolving Key). " +
      "PadSpan scans system Bluetooth bonds automatically, or you can paste an IRK manually."
    ));

    // ── Auto-Detect section ──────────────────────────────────────────────
    const autoDetectRow = el("div", { style: "margin-bottom:14px" });
    const autoBtn = el("button", { class: "btn", style: "margin-right:8px" }, "Auto-Detect IRKs");
    const autoMsg = el("span", { style: "font-size:12px;color:#94a3b8" });
    autoDetectRow.appendChild(autoBtn);
    autoDetectRow.appendChild(autoMsg);
    const autoResults = el("div", { style: "margin-top:8px" });
    autoDetectRow.appendChild(autoResults);

    autoBtn.addEventListener("click", async () => {
      autoBtn.disabled = true;
      autoBtn.textContent = "Scanning...";
      autoMsg.textContent = "";
      autoResults.innerHTML = "";
      try {
        const res = await ctx.actions.wsCall("padspan_ha/irk_auto_detect", {});
        const found = res.found || [];
        const newOnes = found.filter(f => !f.already_registered);
        if (!found.length) {
          autoMsg.style.color = "#94a3b8";
          autoMsg.textContent = "No IRKs found in system Bluetooth bonds. Pair your phone via Bluetooth first, or paste the IRK manually below.";
        } else if (!newOnes.length) {
          autoMsg.style.color = "#52b788";
          autoMsg.textContent = "All " + found.length + " bonded device(s) are already registered.";
        } else {
          autoMsg.style.color = "#fbbf24";
          autoMsg.textContent = newOnes.length + " new IRK(s) found! " + (res.rpa_count > 0 ? "Verifying against live BLE..." : "");
          // Show each found IRK with an "Add" button
          for (const item of newOnes) {
            const row = el("div", { style: "display:flex;align-items:center;gap:8px;padding:4px 0;border-bottom:1px solid #1b3526" });
            const badge = el("span", { style: "font-size:10px;padding:1px 6px;border-radius:3px;font-weight:600;" +
              (item.verified ? "background:#052e16;color:#52b788;border:1px solid #2d6a4f" : "background:#1a0d00;color:#fbbf24;border:1px solid #92400e") },
              item.verified ? "Verified" : "Unverified");
            const nameLbl = el("span", { style: "font-weight:600;color:#e2e8f0;font-size:13px" }, item.name || item.device_mac || "Unknown");
            const srcLbl = el("span", { style: "font-size:11px;color:#64748b" }, item.source === "bluetooth_bond" ? "System BT bond" : item.source);
            const matchLbl = el("span", { style: "font-size:11px;color:#94a3b8" },
              item.matched_count > 0 ? item.matched_count + " RPA match(es)" : "");
            const addIrkBtn = el("button", { class: "btn inline", style: "margin-left:auto;font-size:11px;padding:2px 10px" }, "Add");
            addIrkBtn.addEventListener("click", async () => {
              addIrkBtn.disabled = true;
              addIrkBtn.textContent = "Adding...";
              try {
                await ctx.actions.wsCall("padspan_ha/private_ble_add_irk", { irk: item.irk_hex, name: item.name || "Phone" });
                addIrkBtn.textContent = "Added";
                addIrkBtn.style.color = "#52b788";
                await _refreshIrkStatus();
              } catch(e) {
                addIrkBtn.textContent = "Error";
                addIrkBtn.style.color = "#f87171";
                addIrkBtn.title = e.message || String(e);
                setTimeout(() => { addIrkBtn.textContent = "Add"; addIrkBtn.disabled = false; addIrkBtn.style.color = ""; }, 3000);
              }
            });
            row.appendChild(badge);
            row.appendChild(nameLbl);
            row.appendChild(srcLbl);
            row.appendChild(matchLbl);
            row.appendChild(addIrkBtn);
            autoResults.appendChild(row);
          }
        }
      } catch(e) {
        autoMsg.style.color = "#f87171";
        autoMsg.textContent = "Auto-detect failed: " + (e.message || String(e));
      }
      autoBtn.disabled = false;
      autoBtn.textContent = "Auto-Detect IRKs";
    });
    irkCard.appendChild(autoDetectRow);

    // Status: load current IRKs
    const irkStatus = el("div", { style: "margin-bottom:12px" });
    irkStatus.textContent = "Loading...";
    async function _refreshIrkStatus() {
      try {
        const st = await ctx.actions.wsCall("padspan_ha/private_ble_status", {});
        const devices = st.devices || [];
        const sourceInfo = st.source_info || [];
        const rpas = st.rpa_count || 0;
        if (devices.length) {
          irkStatus.innerHTML = "";
          const tbl = el("table", { class: "table", style: "font-size:12px;margin-bottom:8px" });
          const thead = el("thead", {}, el("tr", {}, [el("th",{},"Name"), el("th",{},"Canonical ID"), el("th",{},"Source"), el("th",{},"")]));
          tbl.appendChild(thead);
          const tbody = el("tbody", {});
          for (const d of devices) {
            const shortId = (d.canonical_id || "").replace(/^irk:/, "").substring(0, 12) + "...";
            const delBtn = el("button", {
              class: "btn inline",
              style: "font-size:10px;padding:1px 6px;color:#f87171;border-color:#5c2020;background:none",
            }, "Delete from HA");
            if (d.entry_id) {
              delBtn.addEventListener("click", async () => {
                if (!confirm(`Delete "${d.name || "device"}" from Home Assistant? This removes the Private BLE Device integration entry itself — the device disappears from HA, not just from PadSpan.`)) return;
                if (!confirm(`Are you sure? "${d.name || "device"}" will be deleted from Home Assistant. You would need its IRK to re-add it.`)) return;
                delBtn.disabled = true;
                delBtn.textContent = "...";
                try {
                  await ctx.actions.wsCall("padspan_ha/private_ble_delete_irk", { entry_id: d.entry_id });
                  await _refreshIrkStatus();
                } catch(e) {
                  delBtn.textContent = "Error";
                  setTimeout(() => { delBtn.textContent = "Delete"; delBtn.disabled = false; }, 2000);
                }
              });
            } else {
              delBtn.disabled = true;
              delBtn.title = "Managed by HA — delete from Settings → Devices & Services";
            }
            tbody.appendChild(el("tr", {}, [
              el("td", {}, d.name || "—"),
              el("td", { class: "muted", style: "font-family:monospace;font-size:11px" }, shortId),
              el("td", { class: "muted" }, d.source || "private_ble_device"),
              el("td", {}, delBtn),
            ]));
          }
          tbl.appendChild(tbody);
          irkStatus.appendChild(tbl);
          irkStatus.appendChild(el("div", { class: "muted", style: "font-size:11px" },
            `${devices.length} IRK(s) registered` + (rpas > 0 ? ` · ${rpas} rotating address(es) detected` : "")));
        } else {
          irkStatus.innerHTML = "";
          irkStatus.appendChild(el("div", { style: "color:#fbbf24;font-size:12px;margin-bottom:4px" },
            rpas > 0
              ? `No IRKs registered yet — ${rpas} rotating MAC address(es) detected. Add IRKs below to track phones.`
              : "No IRKs registered and no rotating addresses detected."
          ));
        }
      } catch(e) {
        irkStatus.textContent = "Could not load status";
      }
    }
    _refreshIrkStatus();
    irkCard.appendChild(irkStatus);

    // Add IRK form
    const irkInp = el("input", {
      type: "text", placeholder: "Paste IRK (hex or base64)",
      style: "flex:1;min-width:200px;background:#0a150e;border:1px solid #2d5a3d;border-radius:6px;color:#e2e8f0;padding:4px 8px;font-size:13px;font-family:monospace",
    });
    const nameInp = el("input", {
      type: "text", placeholder: "Device name (e.g., Alice's iPhone)",
      style: "flex:1;min-width:160px;background:#0a150e;border:1px solid #2d5a3d;border-radius:6px;color:#e2e8f0;padding:4px 8px;font-size:13px",
    });
    const addBtn = el("button", { class: "btn" }, "Add IRK");
    // Progress bar container — hidden until validation starts
    const irkProgress = el("div", { style: "display:none;margin-top:6px" });
    const irkMsg = el("div", { style: "font-size:11px;margin-top:6px;min-height:16px" });
    // Override row — shown when validation finds no match
    const irkOverrideRow = el("div", { style: "display:none;margin-top:6px;display:none;align-items:center;gap:8px" });

    // Helper: commit the IRK to HA (shared by both validated and override paths)
    const _commitIrk = async (irk, name) => {
      try {
        const res = await ctx.actions.wsCall("padspan_ha/private_ble_add_irk", { irk, name: name || "PadSpan Device" });
        if (res.duplicate) {
          irkMsg.style.color = "#fbbf24";
          irkMsg.textContent = res.message || "Already registered";
        } else {
          irkMsg.style.color = "#52b788";
          irkMsg.textContent = res.message || "IRK added successfully";
          irkInp.value = "";
          nameInp.value = "";
        }
        await _refreshIrkStatus();
      } catch(e) {
        irkMsg.style.color = "#f87171";
        irkMsg.textContent = e.message || "Failed to add IRK";
      }
    };

    // ── Validation-then-add flow ──
    // Polls irk_validate every 5s for up to 30s, looking for a live RPA match.
    // If matched: auto-saves. If not: shows warning + "Save Anyway" override.
    let _validationAborted = false;

    addBtn.addEventListener("click", async () => {
      const irk = irkInp.value.trim();
      const name = nameInp.value.trim();
      if (!irk) { irkMsg.textContent = "Please paste an IRK"; irkMsg.style.color = "#f87171"; return; }

      // Reset UI state
      addBtn.disabled = true;
      addBtn.textContent = "Validating...";
      irkMsg.textContent = "";
      irkOverrideRow.style.display = "none";
      _validationAborted = false;

      // Build progress bar
      const VALIDATE_DURATION_S = 30;
      const POLL_INTERVAL_S = 5;
      irkProgress.style.display = "block";
      irkProgress.innerHTML = "";
      const progressLabel = el("div", { style: "font-size:11px;color:#94a3b8;margin-bottom:3px" }, "Scanning for device...");
      const barOuter = el("div", { style: "height:6px;border-radius:3px;background:#1a2a1a;overflow:hidden;position:relative" });
      const barInner = el("div", { style: "height:100%;width:0%;background:#52b788;border-radius:3px;transition:width 0.4s ease" });
      barOuter.appendChild(barInner);
      irkProgress.appendChild(progressLabel);
      irkProgress.appendChild(barOuter);

      // Cancel button inside progress area
      const cancelBtn = el("button", { class: "btn inline", style: "font-size:10px;margin-top:4px;padding:2px 10px;color:#f87171;border-color:#7f1d1d" }, "Cancel");
      cancelBtn.addEventListener("click", () => { _validationAborted = true; });
      irkProgress.appendChild(cancelBtn);

      // Poll loop: try irk_validate every POLL_INTERVAL_S up to VALIDATE_DURATION_S
      let matched = false;
      let lastResult = null;
      const rounds = Math.ceil(VALIDATE_DURATION_S / POLL_INTERVAL_S);
      for (let i = 0; i < rounds; i++) {
        if (_validationAborted) break;
        const elapsed = i * POLL_INTERVAL_S;
        const pct = Math.min(100, Math.round((elapsed / VALIDATE_DURATION_S) * 100));
        barInner.style.width = pct + "%";
        progressLabel.textContent = `Scanning for device... ${elapsed}s / ${VALIDATE_DURATION_S}s`;

        try {
          lastResult = await ctx.actions.wsCall("padspan_ha/irk_validate", { irk_hex: irk });
          if (lastResult && lastResult.matched_count > 0) {
            matched = true;
            break;
          }
        } catch(e) {
          // Parse error — key is malformed
          irkMsg.style.color = "#f87171";
          irkMsg.textContent = e.message || "Invalid IRK format";
          irkProgress.style.display = "none";
          addBtn.disabled = false;
          addBtn.textContent = "Add IRK";
          return;
        }

        // Wait before next poll (unless it's the last round)
        if (i < rounds - 1 && !_validationAborted) {
          await new Promise(r => setTimeout(r, POLL_INTERVAL_S * 1000));
        }
      }

      // Fill bar to 100%
      barInner.style.width = "100%";

      if (_validationAborted) {
        // User cancelled
        irkProgress.style.display = "none";
        irkMsg.style.color = "#94a3b8";
        irkMsg.textContent = "Validation cancelled.";
        addBtn.disabled = false;
        addBtn.textContent = "Add IRK";
        return;
      }

      irkProgress.style.display = "none";

      if (matched) {
        // Key verified — save using the exact hex that matched
        const n = lastResult.matched_count;
        const validatedHex = lastResult.irk_hex || irk;
        progressLabel.textContent = "";
        irkMsg.style.color = "#52b788";
        const fmtNote = lastResult.matched_format ? ` (format: ${lastResult.matched_format})` : "";
        irkMsg.textContent = `Verified — matched ${n} rotating address${n !== 1 ? "es" : ""}${fmtNote}. Saving...`;
        await _commitIrk(validatedHex, name);
        addBtn.disabled = false;
        addBtn.textContent = "Add IRK";
      } else {
        // No match — warn + offer override
        const rpas = lastResult ? lastResult.rpa_count : 0;
        irkMsg.style.color = "#fbbf24";
        irkMsg.textContent = rpas > 0
          ? `No match found after ${VALIDATE_DURATION_S}s (${rpas} rotating addresses scanned). The device may be off, out of range, or the key may be incorrect.`
          : `No rotating addresses detected. Make sure BLE scanners are online and the device is nearby.`;

        // Show override buttons
        irkOverrideRow.style.display = "flex";
        irkOverrideRow.innerHTML = "";
        const saveAnywayBtn = el("button", { class: "btn", style: "font-size:11px;background:#1a0d00;border-color:#d97706;color:#fbbf24" }, "Save Anyway");
        const retryBtn = el("button", { class: "btn inline", style: "font-size:11px" }, "Retry");
        const cancelBtn2 = el("button", { class: "btn inline", style: "font-size:11px;color:#94a3b8" }, "Cancel");

        saveAnywayBtn.addEventListener("click", async () => {
          irkOverrideRow.style.display = "none";
          addBtn.disabled = true;
          addBtn.textContent = "Saving...";
          irkMsg.textContent = "";
          await _commitIrk(irk, name);
          addBtn.disabled = false;
          addBtn.textContent = "Add IRK";
        });
        retryBtn.addEventListener("click", () => {
          irkOverrideRow.style.display = "none";
          irkMsg.textContent = "";
          addBtn.disabled = false;
          addBtn.textContent = "Add IRK";
          addBtn.click();  // re-trigger validation
        });
        cancelBtn2.addEventListener("click", () => {
          irkOverrideRow.style.display = "none";
          irkMsg.textContent = "";
          addBtn.disabled = false;
          addBtn.textContent = "Add IRK";
        });

        irkOverrideRow.appendChild(saveAnywayBtn);
        irkOverrideRow.appendChild(retryBtn);
        irkOverrideRow.appendChild(cancelBtn2);
        addBtn.disabled = false;
        addBtn.textContent = "Add IRK";
      }
    });

    irkCard.appendChild(el("div", { style: rowStyle }, [irkInp]));
    irkCard.appendChild(el("div", { style: rowStyle + ";margin-top:4px" }, [nameInp, addBtn]));
    irkCard.appendChild(irkProgress);
    irkCard.appendChild(irkMsg);
    irkCard.appendChild(irkOverrideRow);

    // Brief help
    irkCard.appendChild(el("div", { class: "muted", style: "font-size:11px;margin-top:12px;line-height:1.6" },
      "Paste your device's IRK above and PadSpan handles the rest. Important: the device must be actively broadcasting (awake, Bluetooth on) and in range of a scanner when adding its IRK. Click below for step-by-step instructions for every device type."
    ));

    // Detailed guide toggle
    const guideBtn = el("button", { class: "btn inline", style: "margin-top:8px;font-size:12px;color:#60a5fa;border-color:#1e4976" }, "Detailed Setup Guide");
    const guidePanel = el("div", { style: "display:none;margin-top:12px;border:1px solid #1e3a2a;border-radius:8px;padding:14px;background:#060d08;line-height:1.7;font-size:12px;color:#cbd5e1" });
    guideBtn.addEventListener("click", () => {
      const open = guidePanel.style.display !== "none";
      guidePanel.style.display = open ? "none" : "block";
      guideBtn.textContent = open ? "Detailed Setup Guide" : "Hide Guide";
    });
    irkCard.appendChild(guideBtn);

    guidePanel.innerHTML = `
<div style="font-size:14px;font-weight:700;color:#e2e8f0;margin-bottom:10px">What is an IRK and why do you need it?</div>
<p style="margin:0 0 10px">
  Modern phones, watches, and tablets use <b>BLE Privacy</b> — they constantly rotate their Bluetooth MAC address
  (called a <b>Random Private Address</b> or <b>RPA</b>) every ~15 minutes to prevent tracking.
  This means a single phone looks like dozens of different devices to your BLE scanners.
</p>
<p style="margin:0 0 10px">
  The <b>IRK (Identity Resolving Key)</b> is a secret 128-bit key stored on the device. Anyone who knows the IRK
  can mathematically verify that a rotating MAC belongs to that specific device. By giving PadSpan your device's IRK,
  it can resolve all those rotating addresses back to one identity — enabling reliable room-level tracking.
</p>
<p style="margin:0 0 16px">
  PadSpan uses Home Assistant's <b>Private BLE Device</b> integration under the hood. You just paste the IRK here
  and PadSpan creates the integration entry automatically — no manual HA configuration needed.
</p>

<div style="font-size:14px;font-weight:700;color:#e2e8f0;margin-bottom:8px;border-top:1px solid #1e3a2a;padding-top:12px">
  Getting the IRK: By Device Type
</div>

<!-- ── iPhone / iPad ── -->
<div style="margin-bottom:16px">
  <div style="font-weight:700;color:#60a5fa;font-size:13px;margin-bottom:4px">Apple iPhone / iPad / Apple Watch</div>
  <p style="margin:0 0 6px">Apple does NOT expose the IRK in iOS settings. You need a <b>Mac</b> signed into the <b>same iCloud account</b>.</p>
  <div style="font-weight:600;color:#a7f3d0;margin-bottom:4px">Method 1: Mac Keychain Access (recommended)</div>
  <ol style="margin:0 0 8px;padding-left:20px">
    <li>On your Mac, open <b>Keychain Access</b> (search in Spotlight).</li>
    <li>In the top menu, select <b>Keychain Access → Preferences → Show Keychain Status in Menu Bar</b> (if needed).</li>
    <li>Ensure you're viewing the <b>iCloud</b> or <b>login</b> keychain (sidebar).</li>
    <li>In the search bar, type <b>BluetoothLE</b> or <b>GattServer</b>.</li>
    <li>Look for entries like <code style="background:#1a2a1a;padding:1px 4px;border-radius:3px">com.apple.bluetooth.…LTK</code> or similar.</li>
    <li>Double-click each entry → click <b>Show password</b> (enter your Mac password).</li>
    <li>The data contains a <b>plist</b> or binary blob. Look for a 16-byte (32 hex character) value labeled <b>IRK</b> or <b>IdentityResolvingKey</b>.</li>
    <li>Copy the 32-character hex string and paste it above.</li>
  </ol>

  <div style="font-weight:600;color:#a7f3d0;margin-bottom:4px">Method 2: macOS Terminal (faster if you know your way around)</div>
  <ol style="margin:0 0 8px;padding-left:20px">
    <li>Open <b>Terminal</b> on your Mac.</li>
    <li>Run: <code style="background:#1a2a1a;padding:2px 6px;border-radius:3px;display:inline-block;margin:2px 0">
      sudo defaults read /private/var/root/Library/Preferences/com.apple.bluetoothd.plist</code></li>
    <li>Enter your admin password.</li>
    <li>Search the output for your iPhone/iPad/Watch name. Under its entry, find the <b>IRK</b> field.</li>
    <li>The IRK will be shown as a <b>base64</b> string (e.g., <code style="background:#1a2a1a;padding:1px 4px;border-radius:3px">aBcDeFgHiJkLmNoPqRsTuA==</code>)
        or as hex data inside angle brackets (<code style="background:#1a2a1a;padding:1px 4px;border-radius:3px">&lt;a1b2c3d4 e5f6a7b8…&gt;</code>).</li>
    <li>Paste either format — PadSpan accepts both hex and base64.</li>
  </ol>

  <div style="font-weight:600;color:#a7f3d0;margin-bottom:4px">Method 3: ESP32 BLE IRK Sniffer</div>
  <ol style="margin:0 0 8px;padding-left:20px">
    <li>If you don't have a Mac, use an ESP32 running a BLE bond/pairing sketch.</li>
    <li>Flash the ESP32 with a BLE pairing firmware (search for <b>"ESP32 IRK capture"</b> — several open-source tools exist).</li>
    <li>Put your phone in Bluetooth pairing mode and pair it with the ESP32.</li>
    <li>After pairing completes, the ESP32 serial output shows the exchanged keys including the IRK.</li>
    <li>Copy the 32-hex-character IRK and paste it above.</li>
  </ol>

  <div style="background:#1a1a0a;border:1px solid #92400e;border-radius:6px;padding:8px 10px;margin-top:4px">
    <div style="font-weight:600;color:#fbbf24;font-size:11px;margin-bottom:2px">Apple Watch Note</div>
    <div style="font-size:11px;color:#d4d4aa">
      Apple Watch has its own separate IRK (different from the paired iPhone). You need to find and add it separately.
      Look for the Watch's Bluetooth name in the Keychain/plist data. Each Watch will appear as a separate device.
    </div>
  </div>
</div>

<!-- ── Android ── -->
<div style="margin-bottom:16px">
  <div style="font-weight:700;color:#34d399;font-size:13px;margin-bottom:4px">Android Phones / Tablets</div>

  <div style="background:#0a1a2a;border:1px solid #2563eb;border-radius:6px;padding:8px 10px;margin-bottom:10px">
    <div style="font-weight:600;color:#60a5fa;font-size:11px;margin-bottom:2px">Do you need an IRK for Android?</div>
    <div style="font-size:11px;color:#a5c8d4">
      If the HA Companion App's <b>BLE Transmitter</b> sensor is enabled, your phone already broadcasts an <b>iBeacon signal</b>
      that PadSpan tracks automatically — no IRK needed. Check the <b>Overview → Track My Phone</b> section: if your phone
      shows as "visible" or "BLE active", it's already being tracked. IRK adds enhanced tracking when iBeacon is not broadcasting
      (screen off for extended periods, app killed, etc.).
    </div>
  </div>

  <div style="font-weight:600;color:#a7f3d0;margin-bottom:4px">Method 1: HA Private BLE Device Integration (recommended)</div>
  <ol style="margin:0 0 8px;padding-left:20px">
    <li>In Home Assistant, go to <b>Settings → Devices & Services → Add Integration</b>.</li>
    <li>Search for <b>"Private BLE Device"</b> and add it.</li>
    <li>HA will scan for nearby BLE devices with rotating addresses and offer to add them.</li>
    <li>Select your phone from the list — HA handles the IRK extraction automatically.</li>
    <li>PadSpan picks up the IRK from this integration within 60 seconds.</li>
  </ol>
  <div style="background:#0a1a1a;border:1px solid #164e63;border-radius:6px;padding:8px 10px;margin-bottom:8px">
    <div style="font-weight:600;color:#22d3ee;font-size:11px;margin-bottom:2px">Important: BLE Transmitter should be enabled</div>
    <div style="font-size:11px;color:#a5c8d4">
      Enable the HA Companion App's <b>BLE Transmitter</b> sensor for the best tracking coverage.
      This makes Android broadcast a consistent iBeacon identity that PadSpan tracks natively.
      Battery impact is minimal (~1-2%).
    </div>
  </div>

  <div style="font-weight:600;color:#a7f3d0;margin-bottom:4px">Method 2: ADB / Root Access (advanced)</div>
  <ol style="margin:0 0 8px;padding-left:20px">
    <li>On a rooted Android device (or via ADB with root): <code style="background:#1a2a1a;padding:2px 6px;border-radius:3px;display:inline-block;margin:2px 0">
      adb shell su -c "cat /data/misc/bluedroid/bt_config.conf"</code></li>
    <li>Find the <b>[Local]</b> section → look for <b>LE_LOCAL_KEY_IRK</b>.</li>
    <li>The value is your IRK in hex. Copy and paste above.</li>
  </ol>

  <div style="font-weight:600;color:#a7f3d0;margin-bottom:4px">Method 3: ESP32 Pairing (same as iPhone method)</div>
  <p style="margin:0 0 8px;padding-left:20px">Pair the Android phone with an ESP32 running BLE pairing firmware. The IRK is exchanged during pairing and shown in the serial output.</p>
</div>

<!-- ── Wear OS / Samsung Galaxy Watch ── -->
<div style="margin-bottom:16px">
  <div style="font-weight:700;color:#c4b5fd;font-size:13px;margin-bottom:4px">Wear OS / Samsung Galaxy Watch</div>
  <p style="margin:0 0 6px">Smart watches have their own BLE identity, separate from the phone they're paired with.</p>
  <ol style="margin:0 0 8px;padding-left:20px">
    <li>If the watch runs <b>Wear OS</b> and has the <b>HA Companion App</b> installed, use the same BLE Transmitter method as Android above.</li>
    <li>For <b>Samsung Galaxy Watch</b> without HA app: Use the ESP32 pairing method. Put the watch in pairing mode and pair with the ESP32.</li>
    <li>Alternatively, on the paired phone, the watch's IRK may be stored in the Bluetooth bond data:
      <code style="background:#1a2a1a;padding:2px 6px;border-radius:3px;display:inline-block;margin:2px 0">
      adb shell su -c "cat /data/misc/bluedroid/bt_config.conf"</code>
      — look for the watch's MAC under <b>[Bonded Devices]</b> section.</li>
  </ol>
</div>

<!-- ── BLE Tags / Trackers ── -->
<div style="margin-bottom:16px">
  <div style="font-weight:700;color:#fb923c;font-size:13px;margin-bottom:4px">BLE Tags & Trackers (Tile, AirTag, SmartTag, Chipolo, etc.)</div>

  <div style="background:#1a1a0a;border:1px solid #92400e;border-radius:6px;padding:8px 10px;margin-bottom:8px">
    <div style="font-weight:600;color:#fbbf24;font-size:11px;margin-bottom:2px">Do you actually need an IRK for tags?</div>
    <div style="font-size:11px;color:#d4d4aa">
      Many BLE tags use <b>iBeacon</b> or fixed MAC addresses — PadSpan already tracks these natively without
      needing an IRK. Check the <b>Objects</b> tab: if your tag shows up as an "iBeacon" or "BLE" object with a
      consistent address, you're already set. IRKs are only needed for tags that use <b>rotating random MACs</b>.
    </div>
  </div>

  <div style="font-weight:600;color:#a7f3d0;margin-bottom:4px">Apple AirTag</div>
  <ul style="margin:0 0 8px;padding-left:20px">
    <li>AirTags rotate their MAC address and use Apple's proprietary FindMy network.</li>
    <li>The IRK is <b>not easily extractable</b> from AirTags without specialized tools.</li>
    <li>However, AirTags broadcast an <b>Apple Continuity advertisement</b> that PadSpan's dedup engine groups automatically.</li>
    <li>For direct tracking: use the <b>ESP32 OpenHaystack</b> project or similar to extract the AirTag's advertising key, then use an ESP32-based scanner.</li>
    <li>Alternative: use the <b>Bermuda BLE Trilateration</b> integration which can track AirTags via the HA iBeacon integration.</li>
  </ul>

  <div style="font-weight:600;color:#a7f3d0;margin-bottom:4px">Samsung SmartTag / SmartTag2</div>
  <ul style="margin:0 0 8px;padding-left:20px">
    <li>SmartTags use Samsung's SmartThings Find network and rotate MACs.</li>
    <li>They often broadcast a fixed <b>service UUID</b> that PadSpan can group via dedup.</li>
    <li>For IRK extraction: pair the SmartTag with an ESP32, or extract from the SmartThings app data on a rooted phone.</li>
  </ul>

  <div style="font-weight:600;color:#a7f3d0;margin-bottom:4px">Tile Trackers</div>
  <ul style="margin:0 0 8px;padding-left:20px">
    <li>Tile trackers typically use a <b>fixed public MAC</b> — PadSpan tracks them directly without an IRK.</li>
    <li>If your Tile uses a rotating MAC (newer models), the IRK can be extracted via ESP32 pairing.</li>
  </ul>

  <div style="font-weight:600;color:#a7f3d0;margin-bottom:4px">Chipolo, Nutfind, and Other Tags</div>
  <ul style="margin:0 0 8px;padding-left:20px">
    <li>Most use fixed MACs or iBeacon — check the Objects tab first.</li>
    <li>If rotating: pair with ESP32 to extract IRK.</li>
  </ul>
</div>

<!-- ── Laptops / Bluetooth Headphones ── -->
<div style="margin-bottom:16px">
  <div style="font-weight:700;color:#f472b6;font-size:13px;margin-bottom:4px">Laptops, Headphones & Other BLE Devices</div>
  <ul style="margin:0 0 8px;padding-left:20px">
    <li><b>Windows laptops</b>: Usually use a fixed public MAC for Bluetooth. Check the Objects tab — if it appears with a consistent address, no IRK needed.</li>
    <li><b>Mac laptops</b>: Use BLE privacy with rotating MACs. Extract IRK from the macOS Bluetooth plist (same Terminal method as iPhone above, look for the Mac's own entry).</li>
    <li><b>Bluetooth headphones/earbuds</b>: Most use a <b>fixed MAC</b> when actively connected/broadcasting. No IRK needed — PadSpan tracks them directly.</li>
    <li><b>Fitness bands</b>: Varies by manufacturer. Check Objects tab first. If rotating MAC, try ESP32 pairing method.</li>
  </ul>
</div>

<!-- ── IRK Format ── -->
<div style="margin-bottom:16px;border-top:1px solid #1e3a2a;padding-top:12px">
  <div style="font-weight:700;color:#e2e8f0;font-size:13px;margin-bottom:6px">IRK Format</div>
  <p style="margin:0 0 6px">PadSpan accepts IRKs in two formats — paste either one:</p>
  <ul style="margin:0 0 8px;padding-left:20px">
    <li><b>Hex</b>: 32 hexadecimal characters (e.g., <code style="background:#1a2a1a;padding:1px 4px;border-radius:3px">a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6</code>)</li>
    <li><b>Base64</b>: 24 characters ending in <code style="background:#1a2a1a;padding:1px 4px;border-radius:3px">=</code> or <code style="background:#1a2a1a;padding:1px 4px;border-radius:3px">==</code> (e.g., <code style="background:#1a2a1a;padding:1px 4px;border-radius:3px">obLD1OX2p7jJ0OHyo7TF1g==</code>)</li>
  </ul>
  <p style="margin:0 0 6px">Both represent the same 16-byte (128-bit) key. Hex is more common from Android; base64 from macOS.</p>
  <p style="margin:0">
    <b>Spaces, colons, and dashes are stripped automatically</b> — so formats like
    <code style="background:#1a2a1a;padding:1px 4px;border-radius:3px">a1:b2:c3:d4:…</code> or
    <code style="background:#1a2a1a;padding:1px 4px;border-radius:3px">a1 b2 c3 d4 …</code> also work.
  </p>
</div>

<!-- ── Troubleshooting ── -->
<div style="margin-bottom:8px;border-top:1px solid #1e3a2a;padding-top:12px">
  <div style="font-weight:700;color:#e2e8f0;font-size:13px;margin-bottom:6px">Troubleshooting</div>
  <div style="margin-bottom:8px">
    <div style="font-weight:600;color:#f87171;font-size:12px">"IRK added but device not showing up"</div>
    <ul style="margin:4px 0 0;padding-left:20px;font-size:11px">
      <li>Make sure the device is <b>within BLE range</b> of at least one ESPHome proxy / HA Bluetooth adapter.</li>
      <li>The device must be <b>actively advertising</b> BLE — phones in airplane mode or with Bluetooth off won't appear.</li>
      <li>Wait 1-2 minutes after adding the IRK. The Private BLE Device integration needs time to match rotating addresses.</li>
      <li>On Android, ensure <b>BLE Transmitter is enabled</b> in the HA Companion App.</li>
      <li>Check <b>Developer Tools → States</b> in HA — search for <code style="background:#1a2a1a;padding:1px 4px;border-radius:3px">device_tracker.private_ble_</code> entities.</li>
    </ul>
  </div>
  <div style="margin-bottom:8px">
    <div style="font-weight:600;color:#f87171;font-size:12px">"IRK invalid" error</div>
    <ul style="margin:4px 0 0;padding-left:20px;font-size:11px">
      <li>Ensure the IRK is exactly <b>32 hex characters</b> or a valid <b>base64 string</b> (24 chars with padding).</li>
      <li>Remove any surrounding quotes, brackets, or whitespace.</li>
      <li>If you copied from macOS plist data inside angle brackets like <code style="background:#1a2a1a;padding:1px 4px;border-radius:3px">&lt;a1b2c3d4…&gt;</code>, remove the angle brackets.</li>
    </ul>
  </div>
  <div style="margin-bottom:8px">
    <div style="font-weight:600;color:#f87171;font-size:12px">"Device shows in wrong room / jumps between rooms"</div>
    <ul style="margin:4px 0 0;padding-left:20px;font-size:11px">
      <li>This is a <b>signal strength issue</b>, not an IRK issue. The IRK only resolves identity — room assignment uses RSSI from your scanners.</li>
      <li>Add more <b>ESPHome BLE proxies</b> to improve coverage. Ideally one per room you want to track.</li>
      <li>Use the <b>Calibration</b> tab to create reference points — this dramatically improves room accuracy.</li>
      <li>Adjust <b>Distance Calibration</b> settings (below) if distance estimates are way off.</li>
    </ul>
  </div>
  <div>
    <div style="font-weight:600;color:#f87171;font-size:12px">"Multiple entries for the same phone"</div>
    <ul style="margin:4px 0 0;padding-left:20px;font-size:11px">
      <li>If you see both a Private BLE entry AND regular BLE entries for the same phone, PadSpan's dedup engine should merge them automatically.</li>
      <li>Check the <b>Objects</b> tab — look for objects with a "N MACs merged" badge.</li>
      <li>If duplicates persist, the phone may be advertising on <b>multiple protocols simultaneously</b> (e.g., iBeacon + regular BLE). PadSpan handles this.</li>
    </ul>
  </div>
</div>
`;

    irkCard.appendChild(guidePanel);

    wrap.appendChild(irkCard);
  }

  // ── Distance Calibration ───────────────────────────────────────────────────
  const currentRefPower   = (settings.ref_power    != null ? Number(settings.ref_power)    : -59);
  const currentPathLoss   = (settings.path_loss_exp != null ? Number(settings.path_loss_exp) : 2.5);
  const refInp = el("input", {
    type: "number", min: "-100", max: "0", step: "1", value: String(currentRefPower), style: inpStyle,
  });
  const plInp = el("input", {
    type: "number", min: "1", max: "4", step: "0.1", value: String(currentPathLoss), style: inpStyle,
  });
  const distSaveBtn = el("button", { class: "btn" }, "Save");
  distSaveBtn.addEventListener("click", async () => {
    const ref = Math.max(-100, Math.min(0, parseFloat(refInp.value) || -59));
    const pl  = Math.max(1.0,  Math.min(4.0,  parseFloat(plInp.value)  || 2.5));
    try {
      await ctx.actions.settingsSet({ ref_power: ref, path_loss_exp: pl });
      ctx.toast(`Distance params saved: ref=${ref} dBm, n=${pl}`);
    } catch(e) { ctx.toast("Failed to save setting", true); }
  });
  wrap.appendChild(el("div", { class: "card" }, [
    el("div", { class: "h2" }, "Distance Calibration"),
    el("div", { class: "muted", style: "font-size:12px;margin-bottom:14px" },
      "Parameters for the log-distance path-loss formula used by the sensor.{device}_distance HA entity. " +
      "Distance (m) = 10 ^ ((ref_power − RSSI) / (10 × n)). " +
      "Measure ref_power by holding a phone 1 m from a scanner and reading its RSSI. " +
      "Increase n for cluttered environments (walls, furniture); lower it for open spaces."
    ),
    el("div", { style: rowStyle }, [
      el("div", { style: "font-size:13px;color:#a7f3d0;min-width:130px" }, "Reference power"),
      refInp,
      el("div", { class: "muted", style: "font-size:12px" }, "dBm at 1 m (default −59)"),
    ]),
    el("div", { style: rowStyle }, [
      el("div", { style: "font-size:13px;color:#a7f3d0;min-width:130px" }, "Path-loss exponent"),
      plInp,
      el("div", { class: "muted", style: "font-size:12px" }, "n  (default 2.5, range 1–4)"),
    ]),
    el("div", { style: "margin-top:8px" }, distSaveBtn),
    el("div", { class: "muted", style: "font-size:11px;margin-top:8px" },
      `Current: ref=${currentRefPower} dBm, n=${currentPathLoss}. ` +
      "Free-space ≈ n=2.0. Typical indoor ≈ n=2.5–3.5."
    ),
  ]));

  // ── Signal Filter (Kalman) ────────────────────────────────────────────────
  const currentKalmanQ = (settings.kalman_q != null ? Number(settings.kalman_q) : 0.125);
  const currentKalmanR = (settings.kalman_r != null ? Number(settings.kalman_r) : 8.0);
  const kqInp = el("input", {
    type: "number", min: "0.01", max: "1", step: "0.01", value: String(currentKalmanQ), style: inpStyle,
  });
  const krInp = el("input", {
    type: "number", min: "0.5", max: "50", step: "0.5", value: String(currentKalmanR), style: inpStyle,
  });
  const kalmanSaveBtn = el("button", { class: "btn inline" }, "Save");
  kalmanSaveBtn.addEventListener("click", async () => {
    const q = Math.max(0.01, Math.min(1.0, parseFloat(kqInp.value) || 0.125));
    const r = Math.max(0.5, Math.min(50.0, parseFloat(krInp.value) || 8.0));
    try {
      await ctx.actions.settingsSet({ kalman_q: q, kalman_r: r });
      ctx.toast(`Signal filter saved: Q=${q}, R=${r}`);
    } catch(e) { ctx.toast("Failed to save setting", true); }
  });
  wrap.appendChild(el("div", { class: "card" }, [
    el("div", { class: "h2" }, "Signal Filter"),
    el("div", { class: "muted", style: "font-size:12px;margin-bottom:14px" },
      "Kalman filter parameters for per-scanner RSSI smoothing. " +
      "Q (process noise) controls how quickly the filter responds to real movement — lower = more smoothing, slower response. " +
      "R (measurement noise) controls how much individual RSSI readings are trusted — higher = more smoothing. " +
      "ESPresense defaults: Q=0.125, R=8.0."
    ),
    el("div", { style: rowStyle }, [
      el("div", { style: "font-size:13px;color:#a7f3d0;min-width:130px" }, "Process noise Q"),
      kqInp,
      el("div", { class: "muted", style: "font-size:12px" }, "0.01–1.0 (default 0.125)"),
    ]),
    el("div", { style: rowStyle }, [
      el("div", { style: "font-size:13px;color:#a7f3d0;min-width:130px" }, "Measurement noise R"),
      krInp,
      el("div", { class: "muted", style: "font-size:12px" }, "0.5–50 (default 8.0)"),
    ]),
    el("div", { style: "margin-top:8px" }, kalmanSaveBtn),
    el("div", { class: "muted", style: "font-size:11px;margin-top:8px" },
      `Current: Q=${currentKalmanQ}, R=${currentKalmanR}. ` +
      "Increase R to suppress noise at the cost of slower room detection. " +
      "Increase Q for faster response to movement."
    ),
  ]));

  // ── 3D Positioning: assumed device height ─────────────────────────────────
  const currentDevH = (settings.assumed_device_height_m != null
    ? Number(settings.assumed_device_height_m) : 1.0);
  const devHInp = el("input", {
    type: "number", min: "0", max: "3", step: "0.1", value: String(currentDevH), style: inpStyle,
  });
  const devHSaveBtn = el("button", { class: "btn inline" }, "Save");
  devHSaveBtn.addEventListener("click", async () => {
    const v = Math.max(0.0, Math.min(3.0, parseFloat(devHInp.value)));
    if (!isFinite(v)) { ctx.toast("Enter a height in metres", true); return; }
    try {
      await ctx.actions.settingsSet({ assumed_device_height_m: v });
      ctx.toast(`Device height set to ${v} m`);
    } catch(e) { ctx.toast("Failed to save setting", true); }
  });
  wrap.appendChild(el("div", { class: "card" }, [
    el("div", { class: "h2" }, "3D Positioning — Device Height"),
    el("div", { class: "muted", style: "font-size:12px;margin-bottom:14px" },
      "RSSI measures the straight-line (slant) distance to a scanner, but positioning solves on the " +
      "floor plane. PadSpan deducts the vertical offset between each scanner's mounted height and the " +
      "device's assumed carry height above the floor. 1.0 m suits a pocketed phone or a wrist; " +
      "lower it for floor-level tags (robot vacuum, pet collar). " +
      "Scanner heights come from the fabric (default: the map's ceiling height); floor stacking from " +
      "the per-floor heights."
    ),
    el("div", { style: rowStyle }, [
      el("div", { style: "font-size:13px;color:#a7f3d0;min-width:130px" }, "Device height (m)"),
      devHInp,
      el("div", { class: "muted", style: "font-size:12px" }, "0–3 m (default 1.0)"),
    ]),
    el("div", { style: "margin-top:8px" }, devHSaveBtn),
  ]));

  // ── Scanner RSSI Offsets ───────────────────────────────────────────────────
  const savedOffsets = settings.scanner_offsets || {};
  const radios = (ctx.state.live?.snapshot?.ble?.radios) || [];
  if(radios.length){
    // ── Auto-offset mode selector ──
    const autoMode = settings.auto_offset_mode || "partial";
    const autoModeRow = el("div",{style:"display:flex;align-items:center;gap:10px;margin-bottom:12px"});
    autoModeRow.appendChild(el("span",{style:"font-size:12px;color:#94a3b8"},"Auto-Offset:"));
    for (const [val, label, desc] of [
      ["off", "Off", "No automatic correction"],
      ["partial", "Partial", "50% correction — recommended default"],
      ["full", "Full", "100% correction to fleet median"],
    ]) {
      const btn = el("button",{class:"btn inline",style:
        autoMode === val
          ? "font-size:11px;padding:3px 10px;background:#0a2a1a;border-color:#52b788;color:#52b788;font-weight:700"
          : "font-size:11px;padding:3px 10px;color:#94a3b8"
      }, label);
      btn.title = desc;
      btn.addEventListener("click", async () => {
        try {
          await ctx.actions.settingsSet({ auto_offset_mode: val });
          ctx.toast(`Auto-offset: ${label}`);
          ctx.actions.renderRooms();
        } catch(e) { ctx.toast("Failed to save", true); }
      });
      autoModeRow.appendChild(btn);
    }

    // ── Compute auto-offsets from live advertisement data ──
    // Uses MEDIAN RSSI per scanner (robust to outliers from distant devices).
    // Remote scanners naturally see weaker signals — that's geography, not hardware.
    // To avoid penalizing remote scanners, we only compare each scanner's median
    // to the DEVICE-LEVEL mean: for each device, average across its reporting
    // scanners, then compare each scanner's reading to that average.
    const ads = (ctx.state.live?.snapshot?.ble?.advertisements) || [];
    const scannerMedians = {};
    const scannerRssis = {};
    for (const ad of ads) {
      if (!ad.source || ad.rssi == null || (ad.age_s || 0) > 30) continue;
      if (!scannerRssis[ad.source]) scannerRssis[ad.source] = [];
      scannerRssis[ad.source].push(ad.rssi);
    }
    // Median per scanner
    for (const [src, vals] of Object.entries(scannerRssis)) {
      vals.sort((a, b) => a - b);
      scannerMedians[src] = vals[Math.floor(vals.length / 2)];
    }
    // Fleet median (median of medians)
    const medVals = Object.values(scannerMedians);
    medVals.sort((a, b) => a - b);
    const fleetMedian = medVals.length ? medVals[Math.floor(medVals.length / 2)] : -70;

    // Auto-offset = fleet_median - scanner_median (positive = scanner reads weaker, boost it)
    // Partial = 50% of the full offset
    const autoScale = autoMode === "full" ? 1.0 : autoMode === "partial" ? 0.5 : 0;

    const offsetRows = el("div",{style:"display:flex;flex-direction:column;gap:8px;margin-top:8px"});
    for(const radio of radios){
      const src = radio.source || radio.name || "";
      if(!src) continue;
      const manualOffset = savedOffsets[src] != null ? Number(savedOffsets[src]) : 0;
      const scanMed = scannerMedians[src];
      const autoOff = (scanMed != null && autoScale > 0) ? Math.round((fleetMedian - scanMed) * autoScale * 10) / 10 : 0;
      const effectiveOff = manualOffset + autoOff;
      const friendlyName = radio.name && radio.name !== src ? radio.name : "";

      const offInp = el("input",{type:"number",min:"-20",max:"20",step:"0.5",value:String(manualOffset),style:inpStyle});
      const offSaveBtn = el("button",{class:"btn inline"},"Save");
      offSaveBtn.addEventListener("click", async()=>{
        const v = Math.max(-20, Math.min(20, parseFloat(offInp.value)||0));
        try {
          await ctx.actions.scannerOffsetSet(src, v);
          ctx.toast(`${friendlyName || src}: manual offset set to ${v>0?"+":""}${v} dB`);
        } catch(e){ ctx.toast("Failed to save offset", true); }
      });

      const autoLabel = autoOff !== 0
        ? el("span",{style:`font-size:10px;color:${autoOff > 0 ? "#52b788" : "#f59e0b"}`}, `auto: ${autoOff > 0?"+":""}${autoOff.toFixed(1)}`)
        : el("span",{style:"font-size:10px;color:#64748b"}, "auto: 0");
      const medLabel = scanMed != null
        ? el("span",{style:"font-size:10px;color:#64748b"}, `med: ${scanMed}dBm`)
        : null;

      offsetRows.appendChild(el("div",{style:rowStyle},[
        el("div",{style:"min-width:160px;overflow:hidden;text-overflow:ellipsis"},[
          friendlyName ? el("div",{style:"font-size:12px;color:#a7f3d0;font-weight:600"},friendlyName) : null,
          el("div",{style:"font-size:10px;color:#94a3b8;font-family:monospace"},src.substring(0,30)),
        ].filter(Boolean)),
        offInp,
        el("div",{class:"muted",style:"font-size:11px"},"dB"),
        offSaveBtn,
        autoLabel,
        medLabel,
      ].filter(Boolean)));
    }
    wrap.appendChild(el("div",{class:"card"},[
      el("div",{class:"h2"},"Scanner RSSI Offsets"),
      el("div",{class:"muted",style:"font-size:12px;margin-bottom:10px"},
        "Auto-offset normalizes scanner hardware differences using live median RSSI. " +
        "Partial (default) applies 50% correction — enough to smooth hardware variation without overcorrecting. " +
        "Remote scanners are NOT penalized — they naturally see weaker signals due to distance, not hardware."
      ),
      autoModeRow,
      offsetRows,
      el("div",{class:"muted",style:"font-size:11px;margin-top:8px"},
        `Fleet median: ${fleetMedian} dBm \u2022 Manual range: \u221220 to +20 dB \u2022 ` +
        "Auto + manual offsets stack. Set manual to 0 to use auto only."
      ),
    ]));
  }

  // ── Calibration Accuracy Reminder ─────────────────────────────────────────
  const reminderEnabled = settings.health_reminder_enabled === true;
  const reminderLastTs  = settings.health_reminder_last_ts || null;

  const reminderToggle = el("input",{type:"checkbox",id:"healthReminderToggle",style:"width:16px;height:16px;accent-color:#52b788;cursor:pointer"});
  reminderToggle.checked = reminderEnabled;

  const reminderResultDiv = el("div",{style:"margin-top:10px"});

  const _sid = ctx.helpers.radioShortId || (()=>"");
  const _renderHealthResults = (r)=>{
    while(reminderResultDiv.firstChild) reminderResultDiv.removeChild(reminderResultDiv.firstChild);
    if(!r){ return; }
    const rows = [];
    if(r.point_count === 0){
      rows.push(el("div",{class:"muted",style:"font-size:12px"},
        "No calibration data collected yet. Use Calibration → Pin & Listen to get started."));
    } else {
      const age = r.stale_days != null ? `${r.stale_days} day${r.stale_days!==1?"s":""}` : "unknown age";
      const ageColor = (r.stale_days||0) > 60 ? "#fbbf24" : "#52b788";
      rows.push(el("div",{style:"font-size:12px;margin-bottom:6px"},[
        el("span",{style:`color:${ageColor};font-weight:600`}, (r.stale_days||0)>60?"⚠ ":"✓ "),
        el("span",{class:"muted"},`${r.point_count} calibration point${r.point_count!==1?"s":""} · newest is ${age} old`),
      ]));
    }

    // Scanner summary table — name, short ID, points, mean RSSI
    const scanners = r.scanner_summary || [];
    if(scanners.length){
      rows.push(el("div",{style:"font-size:11px;font-weight:600;color:#e2e8f0;margin:8px 0 4px"},
        `Scanners in calibration data (${scanners.length}):`));
      const tbl = el("div",{style:"display:flex;flex-direction:column;gap:2px;margin-bottom:8px"});
      for(const sc of scanners){
        const sid = _sid(sc.source);
        const name = sc.name || sc.source.slice(-12);
        const rssiColor = sc.mean_rssi > -65 ? "#52b788" : sc.mean_rssi > -78 ? "#fbbf24" : "#f87171";
        // Check if this scanner has an anomaly
        const anomaly = (r.scanner_anomalies||[]).find(a => a.scanner === sc.source);
        const rowBorder = anomaly ? "border-left:2px solid #fbbf24;" : "border-left:2px solid #1e3a2a;";
        const row = el("div",{style:`display:grid;grid-template-columns:28px 1fr auto auto;gap:6px;align-items:center;padding:3px 6px;background:#0a150e;border-radius:4px;${rowBorder}`},[
          el("span",{style:"font-family:monospace;font-size:10px;font-weight:700;color:#52b788;letter-spacing:.04em"}, sid),
          el("span",{style:"font-size:11px;color:#e2e8f0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap"}, name),
          el("span",{style:"font-size:10px;color:#94a3b8;white-space:nowrap"}, `${sc.point_count} pt`),
          el("span",{style:`font-size:10px;color:${rssiColor};font-family:monospace;white-space:nowrap`}, `${sc.mean_rssi} dBm`),
        ]);
        if(anomaly){
          const tipDiv = el("div",{style:"grid-column:1/-1;font-size:10px;color:#fbbf24;padding:2px 0 0 34px"},
            `⚠ ${Math.abs(anomaly.deviation_db)} dBm ${anomaly.deviation_db > 0 ? "above" : "below"} fleet avg — consider RSSI offset or re-calibration`);
          row.appendChild(tipDiv);
        }
        tbl.appendChild(row);
      }
      rows.push(tbl);
    }

    if((r.recommended_spots||[]).length){
      // Group spots by map for cleaner display
      const spotsByMap = new Map();
      for(const spot of (r.recommended_spots||[])){
        const key = spot.map_id;
        if(!spotsByMap.has(key)) spotsByMap.set(key, { name: spot.map_name || spot.map_id.slice(0,8), spots: [] });
        spotsByMap.get(key).spots.push(spot);
      }
      rows.push(el("div",{style:"font-size:11px;font-weight:600;color:#e2e8f0;margin:8px 0 4px"},
        `Coverage gaps (${spotsByMap.size} map${spotsByMap.size!==1?"s":""})`));
      const spotsWrap = el("div",{style:"display:flex;flex-direction:column;gap:6px;margin-bottom:6px"});
      for(const [, mapGroup] of spotsByMap){
        const mapDiv = el("div",{style:"background:#0a150e;border-radius:4px;padding:6px 8px;border-left:2px solid #f59e0b"});
        mapDiv.appendChild(el("div",{style:"font-size:11px;font-weight:600;color:#e2e8f0;margin-bottom:3px"}, mapGroup.name));
        for(const spot of mapGroup.spots){
          const pct = x=>Math.round(x*100);
          const scoreLabel = spot.coverage_score<0.2 ? "uncovered" : spot.coverage_score<0.5 ? "sparse" : "partial";
          const scoreColor = spot.coverage_score<0.2 ? "#f87171" : spot.coverage_score<0.5 ? "#fbbf24" : "#94a3b8";
          mapDiv.appendChild(el("div",{style:"font-size:10px;color:#94a3b8;margin-bottom:1px;display:flex;gap:6px"},[
            el("span",{}, `(${pct(spot.x_frac)}%, ${pct(spot.y_frac)}%)`),
            el("span",{style:`color:${scoreColor}`}, scoreLabel),
          ]));
        }
        spotsWrap.appendChild(mapDiv);
      }
      rows.push(spotsWrap);
      rows.push(el("div",{class:"muted",style:"font-size:10px"},
        "Stand at each position with your beacon for 60 s. Open Calibration → Pin & Listen to collect."));
    }
    if(!r.has_issues && r.point_count > 0){
      rows.push(el("div",{style:"font-size:12px;color:#52b788"},"✓ Calibration data looks good — no issues detected."));
    }
    for(const row of rows) reminderResultDiv.appendChild(row);
  };

  _renderHealthResults(ctx.state._healthCheckResult || null);

  const checkNowBtn = el("button",{class:"btn",style:"margin-top:8px"},"Check Now");
  checkNowBtn.addEventListener("click", async()=>{
    checkNowBtn.disabled=true; checkNowBtn.textContent="Checking…";
    try {
      const r = await ctx.actions.calibrationHealthCheck();
      ctx.state._healthCheckResult = r;
      _renderHealthResults(r);
      await ctx.actions.settingsSet({ health_reminder_last_ts: Date.now()/1000 });
    } catch(e){ ctx.toast("Health check failed: "+String(e), true); }
    finally{ checkNowBtn.disabled=false; checkNowBtn.textContent="Check Now"; }
  });

  reminderToggle.addEventListener("change", async()=>{
    try {
      await ctx.actions.settingsSet({ health_reminder_enabled: reminderToggle.checked });
      ctx.toast(reminderToggle.checked ? "Calibration reminders enabled" : "Calibration reminders disabled");
    } catch(e){ ctx.toast("Failed to save setting", true); }
  });

  const lastCheckedTxt = reminderLastTs
    ? `Last checked: ${new Date(reminderLastTs*1000).toLocaleDateString()}`
    : "Never checked";

  wrap.appendChild(el("div",{class:"card"},[
    el("div",{class:"h2"},"Calibration Accuracy Reminders"),
    el("div",{style:"display:flex;align-items:center;gap:8px;margin-bottom:10px"},[
      reminderToggle,
      el("label",{for:"healthReminderToggle",style:"font-size:13px;color:#e2e8f0;cursor:pointer"},
        "Remind me to update calibration when needed for accuracy"),
    ]),
    el("div",{class:"muted",style:"font-size:12px;margin-bottom:10px"},
      "Checks whether calibration data has gaps, stale readings, or scanner anomalies. " +
      "When issues are found, suggests a few specific spots to stand with your beacon for 60 s each. Off by default."),
    el("div",{style:"display:flex;align-items:center;gap:12px;flex-wrap:wrap"},[
      checkNowBtn,
      el("span",{class:"muted",style:"font-size:12px"}, lastCheckedTxt),
    ]),
    reminderResultDiv,
  ]));

  // ── Adaptive Learning (Experimental) ───────────────────────────────────
  const adaptiveEnabled = settings.adaptive_learning_enabled === true;
  const floorDetEnabled = settings.adaptive_floor_detection === true;

  const adaptiveToggle = el("input",{type:"checkbox",id:"adaptiveLearningToggle",style:"width:16px;height:16px;accent-color:#52b788;cursor:pointer"});
  adaptiveToggle.checked = adaptiveEnabled;

  const floorToggle = el("input",{type:"checkbox",id:"adaptiveFloorToggle",style:"width:16px;height:16px;accent-color:#52b788;cursor:pointer"});
  floorToggle.checked = floorDetEnabled;

  const adaptiveStatusDiv = el("div",{style:"margin-top:10px"});

  const _renderAdaptiveStatus = (s)=>{
    while(adaptiveStatusDiv.firstChild) adaptiveStatusDiv.removeChild(adaptiveStatusDiv.firstChild);
    if(!s || !s.total_observations){
      adaptiveStatusDiv.appendChild(el("div",{class:"muted",style:"font-size:12px"},
        adaptiveEnabled ? "Learning... waiting for high-confidence room assignments." : "Enable to start learning from device movements."));
      return;
    }
    const matPct = s.maturity_pct || 0;
    const barColor = matPct < 25 ? "#fbbf24" : matPct < 75 ? "#38bdf8" : "#52b788";
    const rows = [
      el("div",{style:"font-size:12px;margin-bottom:6px"},[
        el("span",{style:"font-weight:600;color:#e2e8f0"},"Maturity: "),
        el("span",{style:`color:${barColor};font-weight:600`}, `${matPct}%`),
        el("span",{class:"muted"}, ` — ${matPct < 25 ? "collecting baseline" : matPct < 75 ? "building model" : "model active"}`),
      ]),
      el("div",{style:"background:#1e293b;border-radius:4px;height:6px;margin-bottom:8px;overflow:hidden"},[
        el("div",{style:`width:${Math.min(100,matPct)}%;height:100%;background:${barColor};border-radius:4px;transition:width 0.3s`}),
      ]),
      el("div",{style:"display:grid;grid-template-columns:1fr 1fr;gap:4px 16px;font-size:12px"},[
        el("span",{class:"muted"},`Observations: ${(s.total_observations||0).toLocaleString()}`),
        el("span",{class:"muted"},`Days active: ${s.days_active||0}`),
        el("span",{class:"muted"},`Rooms learned: ${s.rooms_learned||0}`),
        el("span",{class:"muted"},`Scanners: ${s.scanners_learned||0}`),
        el("span",{class:"muted"},`Transitions: ${(s.transitions_total||0).toLocaleString()}`),
        el("span",{class:"muted"},`Floor pairs: ${s.floor_pairs_learned||0}`),
      ]),
    ];
    for(const r of rows) adaptiveStatusDiv.appendChild(r);
  };

  // Load adaptive status on render
  if(adaptiveEnabled){
    (async()=>{
      try {
        const r = await ctx.actions.wsCall("padspan_ha/adaptive_status_get");
        _renderAdaptiveStatus(r?.adaptive || null);
      } catch(e){ /* best-effort */ }
    })();
  }
  _renderAdaptiveStatus(null);

  adaptiveToggle.addEventListener("change", async()=>{
    try {
      await ctx.actions.settingsSet({ adaptive_learning_enabled: adaptiveToggle.checked });
      ctx.toast(adaptiveToggle.checked ? "Adaptive learning enabled" : "Adaptive learning disabled");
      if(!adaptiveToggle.checked){
        floorToggle.checked = false;
        floorToggle.disabled = true;
      } else {
        floorToggle.disabled = false;
      }
      ctx.actions.renderRooms();
    } catch(e){ ctx.toast("Failed to save setting", true); }
  });

  floorToggle.addEventListener("change", async()=>{
    try {
      await ctx.actions.settingsSet({ adaptive_floor_detection: floorToggle.checked });
      ctx.toast(floorToggle.checked ? "Floor detection enhancement enabled" : "Floor detection enhancement disabled");
    } catch(e){ ctx.toast("Failed to save setting", true); }
  });

  if(!adaptiveEnabled) floorToggle.disabled = true;

  const resetAdaptiveBtn = el("button",{class:"btn",style:"margin-top:8px;background:#991b1b;border-color:#991b1b"},"Reset Learned Data");
  resetAdaptiveBtn.addEventListener("click", async()=>{
    if(!confirm("Clear all adaptive learning data? This cannot be undone.")) return;
    resetAdaptiveBtn.disabled=true; resetAdaptiveBtn.textContent="Resetting…";
    try {
      await ctx.actions.wsCall("padspan_ha/adaptive_reset");
      ctx.toast("Adaptive learning data cleared");
      _renderAdaptiveStatus(null);
    } catch(e){ ctx.toast("Reset failed: "+String(e), true); }
    finally{ resetAdaptiveBtn.disabled=false; resetAdaptiveBtn.textContent="Reset Learned Data"; }
  });

  wrap.appendChild(el("div",{class:"card"},[
    el("div",{style:"display:flex;align-items:center;gap:8px;margin-bottom:4px"},[
      el("div",{class:"h2",style:"margin:0"},"Adaptive Learning"),
      el("span",{style:"font-size:10px;font-weight:600;color:#fbbf24;background:#422006;padding:2px 6px;border-radius:4px"},"EXPERIMENTAL"),
    ]),
    el("div",{style:"display:flex;align-items:center;gap:8px;margin-bottom:10px"},[
      adaptiveToggle,
      el("label",{for:"adaptiveLearningToggle",style:"font-size:13px;color:#e2e8f0;cursor:pointer"},
        "Enable adaptive learning"),
    ]),
    el("div",{class:"muted",style:"font-size:12px;margin-bottom:10px"},
      "When enabled, PadSpan passively learns room RSSI fingerprints from high-confidence room " +
      "assignments. Over days, this tightens radio propagation models for more accurate room detection " +
      "without manual calibration walks. The system also learns room transition patterns to reduce false " +
      "room changes."),
    el("div",{style:"display:flex;align-items:center;gap:8px;margin-bottom:10px"},[
      floorToggle,
      el("label",{for:"adaptiveFloorToggle",style:"font-size:13px;color:#e2e8f0;cursor:pointer"},
        "Enhance floor-to-floor detection"),
    ]),
    el("div",{class:"muted",style:"font-size:12px;margin-bottom:10px"},
      "Learns cross-floor signal attenuation patterns to better distinguish between rooms on different " +
      "floors. Requires scanners assigned to rooms on multiple floors in Home Assistant."),
    adaptiveStatusDiv,
    resetAdaptiveBtn,
  ]));

  // ── PadSpan Automations ───────────────────────────────────────────────
  {
    const rules = settings.padspan_automations || [];
    const snap = (ctx.state.live && ctx.state.live.snapshot) || null;
    const objList = snap?.objects?.list || [];

    // Build device options from labelled objects
    const deviceOpts = [];
    const _seen = new Set();
    for (const o of objList) {
      const lbl = o.user_label || "";
      const key = o.key || "";
      if (lbl && !_seen.has(lbl.toUpperCase())) {
        _seen.add(lbl.toUpperCase());
        deviceOpts.push({ label: lbl, key });
      }
    }
    deviceOpts.sort((a, b) => a.label.localeCompare(b.label));

    // Build entity options (lights, switches, scenes)
    const _entities = Object.keys(ctx.hass?.states || {}).filter(e =>
      e.startsWith("light.") || e.startsWith("switch.") || e.startsWith("scene.") || e.startsWith("script.")
    ).sort();

    const _saveRules = async (newRules) => {
      try {
        await ctx.actions.settingsSet({ padspan_automations: newRules });
        ctx.state.settings = { ...ctx.state.settings, padspan_automations: newRules };
        ctx.toast("Automation saved");
        ctx.actions.renderView && ctx.actions.renderView();
      } catch(e) { ctx.toast("Save failed: " + String(e), true); }
    };

    const _deleteRule = (idx) => {
      const updated = [...rules];
      updated.splice(idx, 1);
      _saveRules(updated);
    };

    const _toggleRule = (idx) => {
      const updated = rules.map((r, i) => i === idx ? { ...r, enabled: !r.enabled } : r);
      _saveRules(updated);
    };

    // Existing rules list
    const ruleEls = rules.map((r, idx) => {
      const lbl = r.device_label || r.device_key || "?";
      const arrow = r.trigger === "arrive" ? "\u2192" : "\u2190";
      const actionLbl = r.action === "turn_on" ? "ON" : r.action === "turn_off" ? "OFF" : r.action;
      const entShort = (r.entity_id || "").split(".").pop() || "?";
      const opacity = r.enabled ? "1" : "0.4";
      const row = el("div",{style:`display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid #1e293b;opacity:${opacity}`},[
        el("span",{style:"font-size:11px;min-width:50px;color:#94a3b8"}, r.trigger === "arrive" ? "ARRIVE" : "DEPART"),
        el("span",{style:"font-size:12px;color:#e2e8f0;flex:1"}, `${lbl} ${arrow} ${actionLbl} ${entShort}`),
        el("button",{style:"background:none;border:none;color:#60a5fa;cursor:pointer;font-size:11px",title:"Toggle"}, r.enabled ? "ON" : "OFF"),
        el("button",{style:"background:none;border:none;color:#f87171;cursor:pointer;font-size:11px",title:"Delete"}, "\u2715"),
      ]);
      row.children[2].addEventListener("click", () => _toggleRule(idx));
      row.children[3].addEventListener("click", () => { if(confirm("Delete this automation?")) _deleteRule(idx); });
      return row;
    });

    // Add new rule form
    const triggerSel = el("select",{style:"font-size:12px;background:#0f172a;color:#e2e8f0;border:1px solid #334155;border-radius:4px;padding:4px"},[
      el("option",{value:"depart"},"When device DEPARTS"),
      el("option",{value:"arrive"},"When device ARRIVES"),
    ]);
    const deviceSel = el("select",{style:"font-size:12px;background:#0f172a;color:#e2e8f0;border:1px solid #334155;border-radius:4px;padding:4px"},[
      el("option",{value:""},"— Select device —"),
      ...deviceOpts.map(d => el("option",{value:d.label}, d.label)),
    ]);
    const actionSel = el("select",{style:"font-size:12px;background:#0f172a;color:#e2e8f0;border:1px solid #334155;border-radius:4px;padding:4px"},[
      el("option",{value:"turn_off"},"Turn OFF"),
      el("option",{value:"turn_on"},"Turn ON"),
    ]);
    const entitySel = el("select",{style:"font-size:12px;background:#0f172a;color:#e2e8f0;border:1px solid #334155;border-radius:4px;padding:4px;max-width:200px"},[
      el("option",{value:""},"— Select entity —"),
      ..._entities.map(e => el("option",{value:e}, e.split(".").pop())),
    ]);

    const addBtn = el("button",{class:"btn",style:"background:#065f46;border-color:#065f46;font-size:12px;padding:4px 12px"},"Add Rule");
    addBtn.addEventListener("click", () => {
      const dev = deviceSel.value;
      const ent = entitySel.value;
      if (!dev || !ent) { ctx.toast("Select a device and entity", true); return; }
      const devOpt = deviceOpts.find(d => d.label === dev);
      const newRule = {
        id: "auto_" + Date.now().toString(36),
        trigger: triggerSel.value,
        device_key: devOpt ? devOpt.key : "",
        device_label: dev,
        action: actionSel.value,
        entity_id: ent,
        enabled: true,
      };
      _saveRules([...rules, newRule]);
    });

    const cardChildren = [
      el("div",{class:"h2",style:"margin-bottom:4px"},"Automations"),
      el("div",{class:"muted",style:"font-size:12px;margin-bottom:10px"},
        "Simple arrive/depart rules. PadSpan also fires HA events (padspan_device_arrived, " +
        "padspan_device_departed) for labelled devices, so you can build complex automations " +
        "in HA. Unlabelled devices don't fire events — every rotating-MAC rotation would " +
        "register as a new arrival and flood the event bus — but the rules above still match them."),
    ];
    if (ruleEls.length) {
      cardChildren.push(el("div",{style:"margin-bottom:10px"}, ruleEls));
    } else {
      cardChildren.push(el("div",{class:"muted",style:"font-size:12px;margin-bottom:10px;font-style:italic"}, "No rules yet"));
    }
    cardChildren.push(el("div",{style:"display:flex;flex-wrap:wrap;align-items:center;gap:6px"},[
      triggerSel, deviceSel, actionSel, entitySel, addBtn,
    ]));
    wrap.appendChild(el("div",{class:"card"}, cardChildren));
  }

  // ── Suspend Databases (raw radio test) ─────────────────────────────────
  {
    const _snap = ctx.state.live?.snapshot;
    const _isActive = _snap?.suspended === true;
    const _remS = _snap?.suspend_remaining_s ?? 0;
    const _mm = Math.floor(_remS / 60);
    const _ss = _remS % 60;
    const _countdownStr = _remS > 0 ? `${_mm}:${String(_ss).padStart(2,"0")} remaining` : "";

    const cardChildren = [
      el("div",{class:"h2",style:"margin-bottom:4px"},"Positioning Test Mode"),
      el("div",{class:"muted",style:"font-size:12px;margin-bottom:10px"},
        "Temporarily suspend all learned databases (Kalman state, vote windows, scanner reliability, k-NN cache, adaptive learning) " +
        "and use only raw radio RSSI with spatial weighted-centroid positioning. Useful for diagnosing whether accumulated state is " +
        "causing incorrect room assignments. Calibration data and settings are preserved — only in-memory smoothing state is cleared."),
    ];

    if (_isActive) {
      // ── Active: show status, countdown, cancel ──
      const statusRow = el("div",{style:
        "display:flex;align-items:center;gap:10px;padding:10px 14px;border-radius:6px;" +
        "background:linear-gradient(135deg,#78350f,#92400e);border:1px solid #b45309;margin-bottom:8px"
      },[
        el("span",{style:"font-size:18px"}, "\u26a0\ufe0f"),
        el("div",{style:"flex:1"},[
          el("div",{style:"color:#fbbf24;font-weight:700;font-size:13px"}, "SUSPENDED — Raw Radio Mode Active"),
          el("div",{style:"color:#fde68a;font-size:12px;margin-top:2px"},
            _countdownStr
              ? `All learned databases bypassed \u00b7 ${_countdownStr}`
              : "All learned databases bypassed \u00b7 ending soon"),
        ]),
      ]);
      cardChildren.push(statusRow);

      const cancelBtn = el("button",{class:"btn",style:"background:#991b1b;border-color:#991b1b"},"Resume Normal Pipeline");
      cancelBtn.addEventListener("click", async()=>{
        cancelBtn.disabled=true; cancelBtn.textContent="Resuming\u2026";
        try {
          await ctx.actions.wsCall("padspan_ha/unsuspend_databases");
          ctx.toast("Normal pipeline resumed \u2014 smoothing state cleared for fresh start");
          ctx.actions.refreshLive && ctx.actions.refreshLive();
        } catch(e){ ctx.toast("Failed: "+String(e), true); }
        finally{ cancelBtn.disabled=false; cancelBtn.textContent="Resume Normal Pipeline"; }
      });
      cardChildren.push(cancelBtn);
    } else {
      // ── Inactive: show activate button ──
      const suspendBtn = el("button",{class:"btn",style:"background:#0369a1;border-color:#0369a1"},"Suspend All Databases (60 min)");
      suspendBtn.addEventListener("click", async()=>{
        if(!confirm("Suspend all learned databases for 60 minutes?\n\nThis clears Kalman filters, vote windows, scanner reliability, and cached positions.\nOnly raw radio RSSI + spatial centroid positioning will be used.\n\nCalibration data and settings are NOT deleted.")) return;
        suspendBtn.disabled=true; suspendBtn.textContent="Suspending\u2026";
        try {
          await ctx.actions.wsCall("padspan_ha/suspend_databases",{minutes:60});
          ctx.toast("Databases suspended \u2014 raw radio mode for 60 minutes");
          ctx.actions.refreshLive && ctx.actions.refreshLive();
        } catch(e){ ctx.toast("Failed: "+String(e), true); }
        finally{ suspendBtn.disabled=false; suspendBtn.textContent="Suspend All Databases (60 min)"; }
      });
      cardChildren.push(suspendBtn);
    }

    wrap.appendChild(el("div",{class:"card"}, cardChildren));
  }

  // ── HA Tags Integration ─────────────────────────────────────────────────
  {
    const tagsRoomEvt = settings.tags_room_events_enabled === true;
    const tagsNfc = settings.tags_nfc_identify_enabled === true;
    const tagsAutolink = settings.tags_phone_autolink_enabled === true;

    const roomEvtToggle = el("input",{type:"checkbox",id:"tagsRoomEvtToggle",style:"width:16px;height:16px;accent-color:#52b788;cursor:pointer"});
    roomEvtToggle.checked = tagsRoomEvt;
    roomEvtToggle.addEventListener("change", async()=>{
      try {
        await ctx.actions.settingsSet({ tags_room_events_enabled: roomEvtToggle.checked });
        ctx.toast(roomEvtToggle.checked ? "Room-change tag events enabled" : "Room-change tag events disabled");
      } catch(e){ ctx.toast("Failed to save", true); }
    });

    const nfcToggle = el("input",{type:"checkbox",id:"tagsNfcToggle",style:"width:16px;height:16px;accent-color:#52b788;cursor:pointer"});
    nfcToggle.checked = tagsNfc;
    nfcToggle.addEventListener("change", async()=>{
      try {
        await ctx.actions.settingsSet({ tags_nfc_identify_enabled: nfcToggle.checked });
        ctx.toast(nfcToggle.checked ? "NFC tap-to-identify enabled" : "NFC tap-to-identify disabled");
      } catch(e){ ctx.toast("Failed to save", true); }
    });

    const autolinkToggle = el("input",{type:"checkbox",id:"tagsAutolinkToggle",style:"width:16px;height:16px;accent-color:#52b788;cursor:pointer"});
    autolinkToggle.checked = tagsAutolink;
    autolinkToggle.addEventListener("change", async()=>{
      try {
        await ctx.actions.settingsSet({ tags_phone_autolink_enabled: autolinkToggle.checked });
        ctx.toast(autolinkToggle.checked ? "Phone auto-link enabled" : "Phone auto-link disabled");
      } catch(e){ ctx.toast("Failed to save", true); }
    });

    // Tag mappings info (async load)
    const mappingsDiv = el("div",{style:"margin-top:10px;display:none"});
    (async () => {
      try {
        const res = await ctx.actions.wsCall("padspan_ha/tags_status", {});
        if (!res.tag_available) {
          mappingsDiv.style.display = "";
          mappingsDiv.appendChild(el("div",{style:"font-size:12px;color:#fbbf24;padding:6px 10px;background:#422006;border-radius:4px"},
            "HA Tags component not loaded. Add a Tag in HA Settings \u2192 Tags to enable it."));
          return;
        }
        const maps = res.followed_tag_mappings || [];
        if (maps.length && tagsRoomEvt) {
          mappingsDiv.style.display = "";
          mappingsDiv.appendChild(el("div",{style:"font-size:12px;font-weight:600;color:#94a3b8;margin-bottom:4px"},
            `Tag IDs for ${maps.length} followed object(s):`));
          for (const m of maps.slice(0, 10)) {
            mappingsDiv.appendChild(el("div",{style:"font-size:11px;color:#64748b;padding:2px 0"},
              `${m.label} \u2192 tag_id: "${m.tag_id}"`));
          }
          mappingsDiv.appendChild(el("div",{style:"font-size:11px;color:#475569;margin-top:4px"},
            "Use these tag_ids in HA Automations to trigger actions on room changes."));
        }
      } catch(e) {}
    })();

    wrap.appendChild(el("div",{class:"card"},[
      el("div",{style:"display:flex;align-items:center;gap:8px;margin-bottom:8px"},[
        el("div",{class:"h2",style:"margin:0;color:#60a5fa"}, "HA Tags Integration"),
      ]),
      el("div",{class:"muted",style:"font-size:12px;margin-bottom:12px"},
        "Connect PadSpan to Home Assistant's Tags system for automations and easy object setup."),
      el("div",{style:"display:flex;flex-direction:column;gap:10px"},[
        el("div",{style:"padding:10px;background:#0f172a;border-radius:6px"},[
          el("div",{style:"display:flex;align-items:center;gap:8px;margin-bottom:4px"},[
            roomEvtToggle,
            el("label",{for:"tagsRoomEvtToggle",style:"font-size:13px;color:#e2e8f0;cursor:pointer;font-weight:600"},
              "Room-change tag events"),
          ]),
          el("div",{style:"font-size:11px;color:#64748b"},
            "Fires a tag_scanned event when a followed object changes rooms. " +
            "Build HA automations that trigger on room transitions (e.g. turn on lights when you enter a room)."),
        ]),
        el("div",{style:"padding:10px;background:#0f172a;border-radius:6px"},[
          el("div",{style:"display:flex;align-items:center;gap:8px;margin-bottom:4px"},[
            nfcToggle,
            el("label",{for:"tagsNfcToggle",style:"font-size:13px;color:#e2e8f0;cursor:pointer;font-weight:600"},
              "NFC tap-to-identify"),
          ]),
          el("div",{style:"font-size:11px;color:#64748b"},
            "Scan an NFC tag near an unidentified BLE object to auto-label and follow it. " +
            "PadSpan matches the scanning phone's room to the nearest unidentified BLE signal."),
        ]),
        el("div",{style:"padding:10px;background:#0f172a;border-radius:6px"},[
          el("div",{style:"display:flex;align-items:center;gap:8px;margin-bottom:4px"},[
            autolinkToggle,
            el("label",{for:"tagsAutolinkToggle",style:"font-size:13px;color:#e2e8f0;cursor:pointer;font-weight:600"},
              "Phone auto-link on NFC scan"),
          ]),
          el("div",{style:"font-size:11px;color:#64748b"},
            "When a phone scans any NFC tag, PadSpan auto-discovers and follows that phone's BLE Transmitter. " +
            "A quick way to onboard new phones without visiting the Overview page."),
        ]),
      ]),
      mappingsDiv,
    ]));
  }

  // ── Ignore Bermuda Data (Experimental) ──────────────────────────────────
  const bermudaIgnore = settings.bermuda_ignore === true;

  const bermudaToggle = el("input",{type:"checkbox",id:"bermudaIgnoreToggle",style:"width:16px;height:16px;accent-color:#52b788;cursor:pointer"});
  bermudaToggle.checked = bermudaIgnore;

  const bermudaStatusEl = el("span",{style:"font-size:11px;color:#94a3b8"});
  bermudaToggle.addEventListener("change", async()=>{
    try {
      await ctx.actions.settingsSet({ bermuda_ignore: bermudaToggle.checked });
      ctx.toast(bermudaToggle.checked ? "Bermuda data will be ignored" : "Bermuda data re-enabled");
      bermudaStatusEl.textContent = "Saved — refresh snapshot to apply";
      bermudaStatusEl.style.color = "#fbbf24";
      ctx.actions.renderRooms();
    } catch(e){ ctx.toast("Failed to save setting", true); }
  });

  const refreshBtn = el("button",{class:"btn inline",style:"font-size:11px;padding:3px 10px"}, "Refresh Snapshot");
  refreshBtn.addEventListener("click", async()=>{
    refreshBtn.disabled = true; refreshBtn.textContent = "Refreshing…";
    try {
      await ctx.actions.refreshSnapshot();
      bermudaStatusEl.textContent = "Snapshot refreshed";
      bermudaStatusEl.style.color = "#52b788";
      ctx.toast("Snapshot refreshed");
    } catch(e){ ctx.toast("Refresh failed: "+String(e), true); }
    finally { refreshBtn.disabled = false; refreshBtn.textContent = "Refresh Snapshot"; }
  });

  wrap.appendChild(el("div",{class:"card"},[
    el("div",{style:"display:flex;align-items:center;gap:8px;margin-bottom:4px"},[
      el("div",{class:"h2",style:"margin:0"},"Ignore Bermuda"),
      el("span",{style:"font-size:10px;font-weight:600;color:#fbbf24;background:#422006;padding:2px 6px;border-radius:4px"},"EXPERIMENTAL"),
    ]),
    el("div",{style:"display:flex;align-items:center;gap:8px;margin-bottom:10px"},[
      bermudaToggle,
      el("label",{for:"bermudaIgnoreToggle",style:"font-size:13px;color:#e2e8f0;cursor:pointer"},
        "Ignore all Bermuda integration data"),
    ]),
    el("div",{class:"muted",style:"font-size:12px;margin-bottom:10px"},
      "When enabled, PadSpan completely ignores all data from the Bermuda integration — no Bermuda devices, " +
      "receivers, or entity candidates will appear in snapshots. Useful for troubleshooting to isolate whether " +
      "unexpected activity originates from Bermuda."),
    el("div",{style:"display:flex;align-items:center;gap:10px;flex-wrap:wrap"},[
      refreshBtn,
      bermudaStatusEl,
    ]),
  ]));

  return wrap;
}

// ── Features tab (experimental toggles) ──────────────────────────────────────
// Enterprise-preview features gated behind settings toggles.
// All default to off and are labeled experimental.

// ── PadSpan licence ─────────────────────────────────────────────────────────
// The single place to see what this install is licensed for, enter a key, and
// find out where a key comes from. It exists because the only key field used to
// live inside the Forensics toggle: buying Pro to place lights meant enabling a
// recording feature you did not want in order to activate it. Every gate
// message in the product now names this card (editions.js LICENCE_PATH).
function _settingsLicence(ctx, el){
  const s = ctx.state.settings || {};
  const tier = String(s.tier || "free").toLowerCase();
  const edition = String(s.edition || "full").toLowerCase() === "bright" ? "PadSpan Bright" : "PadSpan HA";
  const hasKey = !!s.pro_has_key;
  const lapsed = s.pro_active === false;
  const exp = String(s.forensics_license_expires || "").slice(0, 10);
  const daysLeft = s.pro_days_left;
  const keyProd = String(s.license_tier || "").toLowerCase() === "bright" ? "PadSpan Bright Pro" : "PadSpan Pro";
  const expiringSoon = typeof daysLeft === "number" && daysLeft >= 0 && daysLeft <= 14;

  const card = el("div", { class: "card", style: "margin-bottom:14px;border:1px solid #2d5a3d;background:#0f1a12" });
  card.appendChild(el("div", { style: "display:flex;align-items:center;gap:8px;flex-wrap:wrap" }, [
    el("div", { style: "font-weight:700;font-size:14px;color:#52b788" }, "PadSpan licence"),
    el("span", { style: "font-size:10px;padding:1px 7px;border-radius:999px;background:rgba(82,183,136,.14);color:#a7f3d0;font-weight:700;text-transform:uppercase" },
      edition + " \u00B7 " + tier),
  ]));

  // Status — the backend's own answer, never re-derived here.
  let line, colour;
  if (!hasKey) {
    line = "No licence key on this install. Forensics and light placement are locked. " +
           "Everything else is free and stays free.";
    colour = "#94a3b8";
  } else if (lapsed) {
    line = "\u26A0 " + keyProd + " licence expired" + (exp ? " on " + exp : "") +
           " \u2014 paid editing is off. Everything you already built is still here, still readable and still exportable.";
    colour = "#fbbf24";
  } else if (expiringSoon) {
    line = "\u2713 " + keyProd + " licensed \u00B7 renews in " + daysLeft +
           " day" + (daysLeft === 1 ? "" : "s") + (exp ? " (" + exp + ")" : "");
    colour = "#fbbf24";
  } else {
    line = "\u2713 " + keyProd + " licensed" + (exp ? " \u00B7 valid until " + exp : "");
    colour = "#a7f3d0";
  }
  card.appendChild(el("div", { style: "font-size:12px;margin:8px 0 10px;line-height:1.5;color:" + colour }, line));

  const row = el("div", { style: "display:flex;gap:8px;flex-wrap:wrap;align-items:center" });

  const enterBtn = el("button", { class: "btn inline", style: "font-size:12px",
    onclick: async () => {
      const key = prompt("Enter your PadSpan licence key (PSPAN-XXXX-XXXX-XXXX-XXXX):");
      if (!key || !key.trim()) return;
      enterBtn.disabled = true;
      try {
        const r = await ctx.actions.wsCall("padspan_ha/forensics_license_activate", { key: key.trim() });
        if (r && r.ok) {
          if (r.settings) ctx.state.settings = r.settings;
          ctx.toast("Licence activated");
          ctx.actions.renderNav && ctx.actions.renderNav();
          ctx.actions.renderRooms();
        } else {
          ctx.toast((r && r.message) || "That key was not accepted", true);
        }
      } catch (e) {
        ctx.toast("Licence check failed: " + String(e), true);
      } finally { enterBtn.disabled = false; }
    } }, hasKey ? "Replace licence key" : "Enter licence key");
  row.appendChild(enterBtn);

  if (!hasKey || lapsed) {
    row.appendChild(el("a", { class: "btn inline", href: BUY_URL, target: "_blank", rel: "noopener",
      style: "font-size:12px;border-color:#52b788;color:#a7f3d0;text-decoration:none" },
      (lapsed ? "Renew" : "Buy") + " PadSpan Pro \u2014 " + PRO_PRICE));
  }

  if (hasKey) {
    const revealBtn = el("button", { class: "btn inline", style: "font-size:12px",
      onclick: async () => {
        try {
          const r = await ctx.actions.wsCall("padspan_ha/forensics_license_reveal", {});
          revealBtn.replaceWith(el("div", { style: "font-size:11px;font-family:monospace;color:#a7f3d0" }, (r && r.key) || "(none)"));
        } catch (e) { ctx.toast("Only a Home Assistant admin can reveal the licence key", true); }
      } }, "Show licence key");
    row.appendChild(revealBtn);
  }
  card.appendChild(row);

  card.appendChild(el("div", { style: "font-size:11px;color:#94a3b8;margin-top:10px;line-height:1.5" },
    "One key unlocks both paid features: Forensics, and placing lights exactly where they hang " +
    "(fixture shapes and sizes, WLED, Showcase, Fit room). A PadSpan Bright Pro key unlocks the " +
    "lighting half only. The gate governs editing \u2014 a lapsed licence never removes or hides " +
    "anything you already built."));
  return card;
}

function _settingsFeatures(ctx, el){
  const settings = ctx.state.settings || {};
  const wrap = el("div",{});

  wrap.appendChild(_settingsLicence(ctx, el));

  const helpBtn = ctx.helpers.helpBtn;
  const headerCard = el("div",{class:"card",style:"border:1px solid #1a4228;background:#0f1a12;margin-bottom:14px"});
  headerCard.appendChild(el("div",{style:"display:flex;align-items:center;gap:8px"},[
    el("div",{style:"font-weight:700;font-size:14px;color:#52b788;margin-bottom:6px"}, "Experimental Features"),
    helpBtn("settings_features"),
  ]));
  headerCard.appendChild(el("div",{style:"font-size:12px;color:#94a3b8;line-height:1.5"},
    "These features are under active development. Enable them to preview and help test. " +
    "They may change or be removed in future releases. Feedback welcome."));
  wrap.appendChild(headerCard);

  // Trackability Rating, Compass Ring Calibration and Replay Timeline used to
  // sit in this list. They were settings keys read by NOTHING outside this
  // screen: switching them on did nothing, ever. Removed 2026-08-24 along with
  // their schema entries, their defaults and their place in the usage report.
  // tests/test_dead_features.py fails if any of them comes back without an
  // implementation to go with it.
  const features = [
    {
      key: "walk_to_identify_enabled",
      label: "Walk-to-Identify",
      desc: "Discover unknown BLE devices by walking into a room. PadSpan correlates signal strength changes with your " +
            "reported location to isolate which device belongs to which person — no MAC addresses needed.",
    },
    {
      key: "radio_map_enabled",
      label: "Radio Map",
      desc: "RSSI heatmap overlay on floor plan maps. Visualizes signal coverage from calibration data so you can see " +
            "dead zones, strong corridors, and receiver reach at a glance.",
    },
    {
      key: "distortion_map_enabled",
      label: "Distortion Map",
      desc: "Shows where calibration predictions disagree with reality. Renders disagreement vectors on the map to reveal " +
            "areas where walls, furniture, or interference cause positioning errors.",
    },
    {
      key: "phone_wizard_enabled",
      label: "Phone Setup Wizard",
      desc: "Shows a guided setup flow in the IRK Manager for adding phones and watches. Detects IRK Capture devices and walks through the pairing process.",
    },
    {
      key: "mac_rotation_bridging",
      label: "MAC Rotation Bridging",
      desc: "When a device's Bluetooth address rotates, attempts to link the old and new addresses by matching advertisement characteristics (company ID, services, signal pattern). Probabilistic — may occasionally link wrong devices.",
    },
    {
      key: "apple_auto_classify",
      label: "Apple Device Classification",
      desc: "Automatically labels Apple devices as iPhone, iPad, Apple Watch, AirPods, etc. by decoding Bluetooth Continuity protocol messages. Display-only — does not affect tracking or identity.",
    },
    {
      key: "rssi_capture_enabled",
      label: "RSSI Vector Capture",
      desc: "Record the signal strength every scanner heard for every tracked device, poll by poll, alongside the " +
            "room PadSpan chose — then export it and replay the same walk offline against changed settings. " +
            "Adds a Record button to Health → Quick actions. Nothing is recorded until you start a session, and a " +
            "session stops itself at 60 minutes or 25 MB.",
    },
  ];

  for(const f of features){
    const on = settings[f.key] === true;
    const card = el("div",{class:"card",style:"margin-bottom:10px"});
    const row = el("div",{style:"display:flex;align-items:center;justify-content:space-between;gap:12px"});
    const left = el("div",{style:"flex:1"});
    left.appendChild(el("div",{style:"display:flex;align-items:center;gap:8px"}, [
      el("span",{style:"font-weight:700;font-size:13px"}, f.label),
      el("span",{style:"font-size:9px;padding:1px 6px;border-radius:3px;background:rgba(245,158,11,.15);color:#f59e0b;font-weight:600;text-transform:uppercase"}, "experimental"),
    ]));
    left.appendChild(el("div",{style:"font-size:11px;color:#94a3b8;margin-top:4px;line-height:1.4"}, f.desc));
    const toggle = el("input",{type:"checkbox",style:"width:18px;height:18px;accent-color:#52b788;cursor:pointer;flex-shrink:0"});
    toggle.checked = on;
    toggle.addEventListener("change", async()=>{
      try {
        await ctx.actions.settingsSet({ [f.key]: toggle.checked });
        ctx.toast(`${f.label}: ${toggle.checked ? "enabled" : "disabled"}`);
      } catch(e){ ctx.toast("Failed to save", true); }
    });
    row.appendChild(left);
    row.appendChild(toggle);
    card.appendChild(row);
    wrap.appendChild(card);
  }

  // ── Forensics (privacy-sensitive, off by default — issue #55) ─────────────
  {
    const forensicsOn = settings.forensics_enabled === true;
    const card = el("div",{class:"card",style:"margin-top:14px;border-color:" + (forensicsOn ? "#b91c1c" : "#334155")});

    card.appendChild(el("div",{style:"display:flex;align-items:center;gap:8px;margin-bottom:6px"},[
      el("div",{class:"h2",style:"margin:0;color:#f87171"},"Forensics"),
      el("span",{style:"font-size:9px;padding:1px 6px;border-radius:3px;background:rgba(248,113,113,.15);color:#f87171;font-weight:600;text-transform:uppercase"}, "privacy-sensitive"),
    ]));
    card.appendChild(el("div",{class:"muted",style:"font-size:12px;margin-bottom:10px"},
      "Records presence sessions for every Bluetooth device your scanners hear, so you can later ask " +
      "\"which devices were near my home between X and Y?\" — e.g. after a break-in, or to spot an unknown " +
      "tracker that keeps returning. Adds a Forensics tab while enabled. Samples every 60 seconds in Live mode."));

    // Always-visible privacy warning
    card.appendChild(el("div",{style:
      "display:flex;gap:10px;padding:10px 14px;border-radius:6px;" +
      "background:linear-gradient(135deg,#450a0a,#7f1d1d);border:1px solid #b91c1c;margin-bottom:10px"
    },[
      el("span",{style:"font-size:18px"}, "⚠️"),
      el("div",{style:"flex:1"},[
        el("div",{style:"color:#fca5a5;font-weight:700;font-size:13px"},"Privacy notice"),
        el("div",{style:"color:#fecaca;font-size:12px;margin-top:2px;line-height:1.5"},
          "This continuously records which Bluetooth devices are near your scanners — including devices " +
          "belonging to neighbours, visitors, and passers-by. Recordings stay on this Home Assistant " +
          "instance and are never uploaded. Laws on collecting wireless identifiers vary by jurisdiction; " +
          "you are responsible for using this lawfully. Results are investigative leads, not proof — " +
          "a Bluetooth address is not a person, and most phones rotate their addresses."),
      ]),
    ]));

    const toggle = el("input",{type:"checkbox",id:"forensicsToggle",style:"width:18px;height:18px;accent-color:#f87171;cursor:pointer"});
    toggle.checked = forensicsOn;
    toggle.addEventListener("change", async()=>{
      const live = ctx.state.dataMode === "live";
      // Forensics is a PadSpan PRO feature (tier "pro"): a Bright Pro key is
      // a valid key too, but not for this. Backend-owned answer, not the key.
      const hasKey = String(settings.tier || "") === "pro";
      if(toggle.checked){
        let msg = "Enable Forensics recording?\n\nPadSpan will continuously record the presence of ALL nearby Bluetooth devices — including neighbours' and passers-by's — on this Home Assistant instance.\n\nYou are responsible for using this lawfully in your jurisdiction.";
        if(!live) msg += "\n\nNote: data mode is currently Sample — nothing will be recorded until you switch data mode to Live.";
        if(!confirm(msg)){
          toggle.checked = false;
          return;
        }
        if(!hasKey){
          // Forensics is a PadSpan Pro feature — ask for the licence key.
          const key = prompt("Forensics is a PadSpan Pro feature.\n\nEnter your licence key (PSPAN-XXXX-XXXX-XXXX-XXXX):");
          if(!key || !key.trim()){
            toggle.checked = false;
            ctx.toast("A PadSpan Pro licence key is required for Forensics", true);
            return;
          }
          toggle.disabled = true;
          try {
            const r = await ctx.actions.wsCall("padspan_ha/forensics_license_activate", { key: key.trim() });
            if(r?.ok){
              if(r.settings) ctx.state.settings = r.settings;
              ctx.toast(live
                ? "PadSpan Pro activated — Forensics recording enabled"
                : "PadSpan Pro activated — recording starts once data mode is Live");
              ctx.actions.renderNav && ctx.actions.renderNav();
              ctx.actions.renderRooms();
            } else {
              toggle.checked = false;
              ctx.toast(r?.message || "Key not valid for PadSpan Pro", true);
            }
          } catch(e){
            toggle.checked = false;
            ctx.toast("Licence check failed: " + String(e), true);
          } finally { toggle.disabled = false; }
          return;
        }
      }
      try {
        await ctx.actions.settingsSet({ forensics_enabled: toggle.checked });
        ctx.toast(toggle.checked
          ? (live
              ? "Forensics recording enabled — the Forensics tab is now in the sidebar"
              : "Forensics enabled — recording starts once data mode is Live; the Forensics tab is now in the sidebar")
          : "Forensics recording disabled (recorded data kept — delete it below if wanted)");
        ctx.actions.renderRooms();
      } catch(e){ ctx.toast("Failed to save", true); }
    });
    card.appendChild(el("div",{style:"display:flex;align-items:center;gap:8px;margin-bottom:10px"},[
      toggle,
      el("label",{for:"forensicsToggle",style:"font-size:13px;color:#e2e8f0;cursor:pointer;font-weight:600"},
        "Enable presence-session recording"),
      el("span",{style:"font-size:9px;padding:1px 6px;border-radius:3px;background:rgba(168,85,247,.15);color:#c4b5fd;font-weight:600;text-transform:uppercase"}, "pro"),
    ]));

    // Licence status line (key set via the enable flow's activation prompt)
    {
      // The key itself is no longer sent to the browser — status comes from
      // the backend's own gate (pro_active), so what's shown here and what is
      // enforced can never disagree. Use "Show licence key" to read it back
      // when moving the licence to another install (admins only).
      if(settings.pro_has_key){
        const licExp = String(settings.forensics_license_expires || "").slice(0,10);
        const daysLeft = settings.pro_days_left;
        const lapsed = settings.pro_active === false;
        const expiringSoon = typeof daysLeft === "number" && daysLeft >= 0 && daysLeft <= 14;
        // Name the product the key is for: a Bright Pro key licenses the
        // lighting product, and this card should not call it PadSpan Pro.
        const _prod = String(settings.license_tier || "").toLowerCase() === "bright" ? "PadSpan Bright Pro" : "PadSpan Pro";
        const line = lapsed
          ? `⚠ ${_prod} licence expired${licExp ? ` on ${licExp}` : ""} — paid editing is off. Everything you already recorded is still here and still exportable.`
          : expiringSoon
          ? `✓ ${_prod} licensed · renews in ${daysLeft} day${daysLeft === 1 ? "" : "s"}${licExp ? ` (${licExp})` : ""}`
          : `✓ ${_prod} licensed` + (licExp ? ` · valid until ${licExp}` : "");
        card.appendChild(el("div",{class:"muted",
          style:`font-size:11px;margin-bottom:6px;color:${lapsed ? "#fbbf24" : expiringSoon ? "#fbbf24" : "#a7f3d0"}`}, line));
        const revealBtn = el("button",{class:"btn inline",style:"font-size:11px;padding:2px 8px;margin-bottom:10px",
          onclick: async()=>{
            try{
              const r = await ctx.actions.wsCall("padspan_ha/forensics_license_reveal", {});
              revealBtn.replaceWith(el("div",{class:"muted",
                style:"font-size:11px;margin-bottom:10px;font-family:monospace;color:#a7f3d0"}, r?.key || "(none)"));
            }catch(e){ ctx.toast("Only a Home Assistant admin can reveal the licence key", true); }
          }}, "Show licence key");
        card.appendChild(revealBtn);
      } else {
        card.appendChild(el("div",{class:"muted",style:"font-size:11px;margin-bottom:10px"},
          "Requires a PadSpan Pro licence key. Enter one in PadSpan licence at the top of this tab, "
          + "or you will be asked for it when enabling."));
      }
    }

    // Retention select (auto-save on change)
    const RETENTION_CHOICES = [7, 14, 30, 60, 90];
    const curRet = RETENTION_CHOICES.includes(Number(settings.forensics_retention_days))
      ? Number(settings.forensics_retention_days) : 14;
    const retSel = el("select",{style:"width:160px;background:#0a150e;color:#e2e8f0;border:1px solid #2d5a3d;border-radius:6px;padding:4px 8px;font-size:13px"});
    for(const d of RETENTION_CHOICES){
      const o = el("option",{value:String(d)}, d === 14 ? "14 days (default)" : `${d} days`);
      if(d === curRet) o.selected = true;
      retSel.appendChild(o);
    }
    retSel.addEventListener("change", async()=>{
      const v = Number(retSel.value);
      if(!RETENTION_CHOICES.includes(v)) return;
      try {
        await ctx.actions.settingsSet({ forensics_retention_days: v });
        ctx.toast(`Forensics retention set to ${v} days`);
      } catch(e){ ctx.toast("Failed to save", true); }
    });
    card.appendChild(el("div",{style:"display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:10px"},[
      el("div",{style:"font-size:13px;color:#a7f3d0;min-width:130px"},"Keep sessions for"),
      retSel,
    ]));

    // Stats line + delete button
    const statsDiv = el("div",{class:"muted",style:"font-size:11px;margin-bottom:8px"},"Loading stats…");
    (async()=>{
      try {
        const s = await ctx.actions.wsCall("padspan_ha/forensics_stats");
        const oldest = s?.oldest_ts ? new Date(s.oldest_ts * 1000).toLocaleDateString() : null;
        statsDiv.textContent = (s?.addr_count || 0) + " addresses · " + (s?.session_count || 0) +
          " sessions recorded" + (oldest ? ` · oldest ${oldest}` : "");
      } catch(e){ statsDiv.textContent = ""; }
    })();
    card.appendChild(statsDiv);

    const delBtn = el("button",{class:"btn",style:"background:#991b1b;border-color:#991b1b"},"Delete all recorded data");
    delBtn.addEventListener("click", async()=>{
      if(!confirm("Delete ALL recorded forensics sessions? This cannot be undone.\n\nNote: the 'Possible' tier in the Forensics tab comes from the Objects first/last-seen history and is not affected by this delete.")) return;
      if(!confirm("Are you sure? Every recorded presence session will be permanently deleted.")) return;
      delBtn.disabled = true; delBtn.textContent = "Deleting…";
      try {
        const r = await ctx.actions.wsCall("padspan_ha/forensics_clear");
        ctx.toast(`Deleted forensics data for ${r?.removed ?? 0} addresses`);
        statsDiv.textContent = "0 addresses · 0 sessions recorded";
      } catch(e){ ctx.toast("Delete failed: " + String(e), true); }
      finally { delBtn.disabled = false; delBtn.textContent = "Delete all recorded data"; }
    });
    card.appendChild(delBtn);

    wrap.appendChild(card);
  }

  return wrap;
}

// ── UI Structure tab ──────────────────────────────────────────────────────────
const _DEV_ONLY_TABS = ["devices","bluetooth","presence","monitor","qa","sandbox"];
const _TAB_LABELS = {devices:"Devices",bluetooth:"Bluetooth",presence:"Presence",monitor:"Monitor",qa:"QA",sandbox:"Sandbox"};

function _settingsUI(ctx, el){
  const wrap = el("div",{});
  const settings = ctx.state.settings || {};
  const extras = settings.advanced_extra_tabs || [];

  wrap.appendChild(el("h3",{style:"color:#52b788;margin-bottom:8px"},"UI Structure"));
  wrap.appendChild(el("p",{style:"color:#94a3b8;font-size:13px;margin-bottom:16px"},
    "Choose which tabs appear in Advanced mode. All tabs are always visible in Development mode."));

  const card = el("div",{class:"card",style:"padding:16px"});
  const checks = [];
  for(const tabId of _DEV_ONLY_TABS){
    const label = _TAB_LABELS[tabId] || tabId;
    const checked = extras.includes(tabId);
    const row = el("label",{style:"display:flex;align-items:center;gap:8px;padding:6px 0;cursor:pointer"});
    const cb = el("input",{type:"checkbox"});
    cb.checked = checked;
    cb.dataset.tab = tabId;
    checks.push(cb);
    row.appendChild(cb);
    row.appendChild(el("span",{style:"color:#e2e8f0;font-size:14px"}, label));
    card.appendChild(row);
  }
  wrap.appendChild(card);

  const saveBtn = el("button",{class:"btn",style:"margin-top:12px"},"Save");
  const status = el("span",{style:"margin-left:10px;color:#94a3b8;font-size:13px"});
  saveBtn.addEventListener("click", async ()=>{
    const selected = checks.filter(c => c.checked).map(c => c.dataset.tab);
    await ctx.actions.settingsSet({ advanced_extra_tabs: selected });
    status.textContent = "Saved!";
    if(ctx.state.complexity === "advanced"){
      ctx.actions.renderNav();
    }
    setTimeout(()=>{ status.textContent = ""; }, 2000);
  });
  wrap.appendChild(el("div",{style:"display:flex;align-items:center"}, [saveBtn, status]));

  // ── Mapped Light Control Goodie ──
  const lightsCard = el("div",{class:"card",style:"padding:16px;margin-top:20px"});
  lightsCard.appendChild(el("div",{style:"font-weight:700;font-size:14px;color:#fbbf24;margin-bottom:6px"},"\uD83D\uDCA1 Mapped Light Control Goodie"));
  lightsCard.appendChild(el("div",{style:"font-size:12px;color:#94a3b8;margin-bottom:10px;line-height:1.5"},
    "Adds a separate Lights panel to the HA sidebar for map-based light control. Requires a Home Assistant restart after changing this setting."));
  const lightsRow = el("label",{style:"display:flex;align-items:center;gap:8px;cursor:pointer"});
  const lightsCb = el("input",{type:"checkbox"});
  lightsCb.checked = !!(settings.lights_panel_enabled);
  lightsRow.appendChild(lightsCb);
  lightsRow.appendChild(el("span",{style:"color:#e2e8f0;font-size:14px"}, "Enable Mapped Light Control in sidebar"));
  lightsCard.appendChild(lightsRow);
  const lightsSaveBtn = el("button",{class:"btn",style:"margin-top:10px"},"Save");
  const lightsStatus = el("span",{style:"margin-left:10px;color:#94a3b8;font-size:13px"});
  lightsSaveBtn.addEventListener("click", async ()=>{
    await ctx.actions.settingsSet({ lights_panel_enabled: lightsCb.checked });
    lightsStatus.textContent = lightsCb.checked
      ? "Saved \u2014 restart Home Assistant to see the Lights panel in the sidebar."
      : "Saved \u2014 restart Home Assistant to remove the Lights panel from the sidebar.";
    lightsStatus.style.color = "#fbbf24";
  });
  lightsCard.appendChild(el("div",{style:"display:flex;align-items:center;flex-wrap:wrap"}, [lightsSaveBtn, lightsStatus]));
  wrap.appendChild(lightsCard);

  // ── Edition & tier ──
  // What this build is and what the key lets it do (licence.py). The reveal
  // switch exists only on a Bright build: hide-by-default, never hidden for
  // good. The tier override can only LOWER the effective tier — it is how a
  // Pro developer looks at what a free or Bright user sees, and never a way
  // past the licence.
  const edCard = el("div",{class:"card",style:"padding:16px;margin-top:20px"});
  const _ed = String(settings.edition || "full"), _tier = String(settings.tier || "free");
  edCard.appendChild(el("div",{style:"font-weight:700;font-size:14px;color:#a7f3d0;margin-bottom:6px"},"Edition & tier"));
  edCard.appendChild(el("div",{style:"font-size:12px;color:#94a3b8;margin-bottom:10px;line-height:1.5"},
    `This build: ${_ed === "bright" ? "PadSpan Bright" : "PadSpan HA"} · running at tier "${_tier}"` +
    (settings.license_tier_override ? ` (override: ${settings.license_tier_override})` : "") + `.`));
  if(_ed === "bright"){
    const revRow = el("label",{style:"display:flex;align-items:center;gap:8px;cursor:pointer;margin-bottom:8px"});
    const revCb = el("input",{type:"checkbox"});
    revCb.checked = !!settings.bright_reveal_presence;
    revCb.addEventListener("change", async ()=>{
      await ctx.actions.settingsSet({ bright_reveal_presence: revCb.checked });
      ctx.actions.renderNav();
    });
    revRow.appendChild(revCb);
    revRow.appendChild(el("span",{style:"color:#e2e8f0;font-size:14px"}, "Show the presence tabs too (Overview, Follow, Calibration, …)"));
    edCard.appendChild(revRow);
  }
  if(ctx.state.complexity === "development"){
    const ovRow = el("div",{style:"display:flex;align-items:center;gap:8px;flex-wrap:wrap"});
    ovRow.appendChild(el("span",{style:"color:#e2e8f0;font-size:13px"}, "Look at this install as tier:"));
    const ovSel = document.createElement("select"); ovSel.className = "select";
    for(const [v,l] of [["","(no override)"],["free","free"],["bright","bright"],["pro","pro"]]){
      const o = document.createElement("option"); o.value = v; o.textContent = l; ovSel.appendChild(o);
    }
    ovSel.value = String(settings.license_tier_override || "");
    ovSel.addEventListener("change", async ()=>{
      await ctx.actions.settingsSet({ license_tier_override: ovSel.value });
      ctx.toast(ovSel.value ? `Viewing as tier ${ovSel.value} (lower only)` : "Tier override cleared");
      ctx.actions.renderRooms();
    });
    ovRow.appendChild(ovSel);
    ovRow.appendChild(el("span",{class:"muted",style:"font-size:11px"}, "lowers only — the licence still decides upward"));
    edCard.appendChild(ovRow);
  }
  wrap.appendChild(edCard);

  return wrap;
}
