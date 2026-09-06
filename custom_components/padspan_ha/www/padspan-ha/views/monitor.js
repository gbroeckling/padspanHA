// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
// See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
/**
 * Monitor view — system health and diagnostics dashboard.
 * Sub-tabs: Diagnostics | Zones | Insights | Health | Diag Export | Debug.
 * Acts as a container that renders the active sub-tab; each sub-tab focuses
 * on a different aspect of system state (BLE coverage, zone config, performance).
 */

// Signal quality, per scanner (Diagnostics + Insights tabs).
//
// Averaging RSSI across every advertisement a scanner merely overhears
// makes "quality" meaningless in practice: most BLE traffic in a real
// house is someone else's phone two rooms away, or a passing car, so a
// busy, healthy scanner reads no differently than a broken one — the
// average trends toward "Poor" regardless of how well it actually covers
// the devices near it (Garry, 2026-09-06: "the radios all say poor, this
// tab is garbage"). Instead: for each device, only its STRONGEST scanner
// (the one hearing it loudest) gets credit for that reading. That measures
// how well a scanner covers what is actually close to it, which is what
// "signal quality" should mean here — not how much distant noise it
// happens to also pick up.
export function _scannerQuality(ads) {
  const bestPerAddr = new Map();
  for (const ad of ads) {
    const addr = ad.address || "";
    if (!addr || ad.rssi == null || !ad.source) continue;
    const cur = bestPerAddr.get(addr);
    if (!cur || ad.rssi > cur.rssi) bestPerAddr.set(addr, { source: ad.source, rssi: ad.rssi });
  }
  const stats = {};
  for (const { source, rssi } of bestPerAddr.values()) {
    const s = (stats[source] = stats[source] || { rssiSum: 0, count: 0 });
    s.rssiSum += rssi;
    s.count++;
  }
  return stats;
}

export function _qualityGrade(avg) {
  if (avg == null) return { label: "—", color: "#64748b" };
  if (avg >= -60) return { label: "Excellent", color: "#52b788" };
  if (avg >= -70) return { label: "Good", color: "#81c784" };
  if (avg >= -80) return { label: "Fair", color: "#ffd54f" };
  return { label: "Poor", color: "#ef5350" };
}

export function render(ctx){
  const { el, helpBtn, radioShortId } = ctx.helpers;
  const _sid = (source) => radioShortId ? radioShortId(source || "") : "";
  const snap = (ctx.state.live && ctx.state.live.snapshot) || null;
  const root = el("section",{id:"monitor"});

  // Header
  root.appendChild(el("div",{class:"row",style:"align-items:center;gap:8px;margin-bottom:14px"},[
    el("h2",{},"Monitor"),
    helpBtn("monitor"),
  ]));

  // ── Sub-tab bar ──
  if(!ctx.state._monitorTab) ctx.state._monitorTab = "diagnostics";
  const activeTab = ctx.state._monitorTab;
  const setTab = (t) => { ctx.state._monitorTab = t; ctx.actions.renderRooms(); };

  const TABS = [["diagnostics","Diagnostics"],["zones","Zones"],["insights","Insights"],["health","Health"],["diag_export","Diag Export"],["debug","Debug"]];
  const tabBar = el("div",{class:"tabs",style:"margin-bottom:14px;flex-wrap:wrap;gap:4px"});
  for(const [id,label] of TABS){
    tabBar.appendChild(el("button",{
      class:"tab"+(activeTab===id?" active":""),
      onclick:()=>setTab(id),
    },label));
  }
  root.appendChild(tabBar);

  if(activeTab === "zones"){ root.appendChild(_zones(ctx, el)); return root; }
  if(activeTab === "insights"){ root.appendChild(_insights(ctx, el, _sid)); return root; }
  if(activeTab === "health"){ root.appendChild(_health(ctx, el)); return root; }
  if(activeTab === "diag_export"){ root.appendChild(_diagExport(ctx, el)); return root; }
  if(activeTab === "debug"){ root.appendChild(_debug(ctx, el)); return root; }

  // ═══════════════════════════════════════════════════════════════════════════
  // DIAGNOSTICS TAB (default)
  // ═══════════════════════════════════════════════════════════════════════════
  const _quietMode = !!(ctx.state.settings && ctx.state.settings.quiet_mode);
  const grid = el("div",{class:"grid"});

  // ── BLE Diag Errors (top-level warning) ──
  const bleDiag = snap && snap.ble && snap.ble.diag;
  if(bleDiag && bleDiag.ok === false){
    const errors = (bleDiag.errors || []).join("; ") || "BLE subsystem unhealthy";
    root.appendChild(el("div",{class:"card",style:"border:1px solid #7f1d1d;background:#1a0a0a;margin-bottom:14px"},[
      el("div",{style:"font-weight:700;color:#ef5350;margin-bottom:4px"},"BLE Feed Unhealthy"),
      el("div",{style:"font-size:12px;color:#fca5a5"}, errors),
      el("div",{class:"muted",style:"font-size:11px;margin-top:6px"},"Try restarting Home Assistant (Settings → System → Restart)."),
    ]));
  }

  // ── Websocket Call Counts ──
  const wsCounts = ctx.state.wsCounts || {};
  const wsLines = Object.keys(wsCounts).sort().map(k=>`${k}: ${wsCounts[k]}`).join("\n") || "No websocket calls yet.";
  grid.appendChild(el("div",{class:"card"},[
    el("div",{style:"font-weight:700"},"Websocket Call Counts (UI)"),
    el("pre",{class:"mono",style:"max-height:240px;overflow:auto;font-size:11px"}, wsLines),
    el("div",{class:"muted",style:"font-size:11px;margin-top:6px"},"Helps detect if a button is wired (counts should increase when clicked)."),
  ]));

  // ── Timing ──
  grid.appendChild(el("div",{class:"card"},[
    el("div",{style:"font-weight:700"},"Timing"),
    el("div",{class:"mono"}, `Last refresh: ${ctx.state.timing.lastRefreshMs ?? "\u2014"}ms`),
    el("div",{class:"mono"}, `Last diagnostics: ${ctx.state.timing.lastDiagMs ?? "\u2014"}ms`),
  ]));

  // ── BLE Objects Summary ──
  const objSummary = snap && snap.objects && snap.objects.summary;
  if(objSummary){
    const total = objSummary.total || 0;
    const identified = objSummary.identified || 0;
    const ble = objSummary.ble || 0;
    const unid = objSummary.unidentified || 0;

    const displayTotal = _quietMode ? identified : total;

    const unidBadge = _quietMode ? null : (unid > 0
      ? el("span",{class:"badge warn",style:"cursor:pointer"}, `${unid} unidentified`)
      : el("span",{class:"badge"}, "All identified"));
    if(unidBadge && unid > 0){
      unidBadge.addEventListener("click", ()=>{
        ctx.state.view = "objects";
        ctx.actions.renderRooms();
      });
      unidBadge.title = "Click to view in Objects tab";
    }

    grid.appendChild(el("div",{class:"card"},[
      el("div",{style:"font-weight:700"},"BLE Objects"),
      el("div",{class:"row",style:"gap:8px;flex-wrap:wrap;margin-top:8px"},[
        el("span",{class:"badge"}, `${displayTotal} ${_quietMode ? "tracked" : "total"}`),
        _quietMode ? null : el("span",{class:"badge"}, `${ble} BLE ads`),
        unidBadge,
      ].filter(Boolean)),
    ]));
  } else {
    grid.appendChild(el("div",{class:"card"},[
      el("div",{style:"font-weight:700"},"BLE Objects"),
      el("div",{class:"muted"},"No live snapshot \u2014 switch to Live mode to see BLE metrics."),
    ]));
  }

  // ── Per-Scanner Breakdown ──
  const radios = (snap && snap.ble && snap.ble.radios) || [];
  const ads = (snap && snap.ble && snap.ble.advertisements) || [];
  if(radios.length > 0){
    const scannerData = {};
    for(const r of radios) scannerData[r.source] = { name: r.name || r.source, devs: 0, radio: r };
    for(const ad of ads){
      const src = ad.source || "";
      if(!scannerData[src]) scannerData[src] = { name: src, devs: 0, radio: null };
      scannerData[src].devs++;
    }
    const qualityBySrc = _scannerQuality(ads);

    const tbl = el("table",{style:"width:100%;font-size:12px;border-collapse:collapse;table-layout:fixed"});
    tbl.appendChild(el("tr",{},[
      el("th",{style:"text-align:left;padding:4px 6px;color:#94a3b8;font-weight:600;width:15%"},"ID"),
      el("th",{style:"text-align:left;padding:4px 6px;color:#94a3b8;font-weight:600;width:35%;overflow:hidden;text-overflow:ellipsis"},"Scanner"),
      el("th",{style:"text-align:right;padding:4px 6px;color:#94a3b8;font-weight:600;width:14%"},"Devices"),
      el("th",{style:"text-align:right;padding:4px 6px;color:#94a3b8;font-weight:600;width:16%",title:"Average RSSI of each device's OWN strongest scanner only \u2014 a device closer to another scanner doesn't count against this one."},"Best-RSSI"),
      el("th",{style:"text-align:left;padding:4px 6px;color:#94a3b8;font-weight:600;width:20%"},"Quality"),
    ]));
    for(const [src, st] of Object.entries(scannerData).sort((a,b)=>b[1].devs-a[1].devs)){
      const q = qualityBySrc[src];
      const avg = q && q.count > 0 ? Math.round(q.rssiSum / q.count) : null;
      const { label: quality, color: qColor } = _qualityGrade(avg);
      const tr = el("tr",{style:"cursor:pointer"});
      tr.addEventListener("mouseenter", ()=>{ tr.style.background = "rgba(255,255,255,0.04)"; });
      tr.addEventListener("mouseleave", ()=>{ tr.style.background = ""; });
      tr.addEventListener("click", ()=>{
        if(st.radio) ctx.actions.showScannerDetail(st.radio);
      });
      const _rn1 = ctx.helpers.radioName(src);
      tr.appendChild(el("td",{style:"padding:4px 6px;font-family:monospace;font-weight:700;font-size:11px;letter-spacing:.04em;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#7dd3fc",title:(_rn1?_rn1+" \u00b7 ":"")+src}, _sid(src)));
      tr.appendChild(el("td",{style:"padding:4px 6px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#7dd3fc;text-decoration:underline;text-decoration-color:rgba(125,211,252,0.35);text-underline-offset:2px"}, st.name));
      tr.appendChild(el("td",{style:"padding:4px 6px;text-align:right"}, String(st.devs)));
      tr.appendChild(el("td",{style:"padding:4px 6px;text-align:right;font-family:monospace"}, avg !== null ? `${avg}` : "\u2014"));
      tr.appendChild(el("td",{style:`padding:4px 6px;color:${qColor};font-weight:600`}, quality));
      tbl.appendChild(tr);
    }
    const tblWrap = el("div",{style:"overflow-x:auto"});
    tblWrap.appendChild(tbl);
    const scannerCard = el("div",{class:"card",style:"grid-column:1/-1"});
    scannerCard.appendChild(el("div",{style:"font-weight:700;margin-bottom:8px"},"Per-Scanner Breakdown"));
    scannerCard.appendChild(tblWrap);
    grid.appendChild(scannerCard);
  }

  // ── Advertisement Freshness ──
  if(ads.length > 0){
    let fresh = 0, stale = 0, old = 0;
    for(const ad of ads){
      const age = ad.age_s ?? 999;
      if(age < 10) fresh++;
      else if(age < 60) stale++;
      else old++;
    }
    const total = ads.length;
    const freshPct = Math.round((fresh/total)*100);
    const stalePct = Math.round((stale/total)*100);
    const oldPct = 100 - freshPct - stalePct;

    grid.appendChild(el("div",{class:"card"},[
      el("div",{style:"font-weight:700;margin-bottom:8px"},"Advertisement Freshness"),
      el("div",{style:"display:flex;height:18px;border-radius:4px;overflow:hidden;margin-bottom:8px"},[
        fresh > 0 ? el("div",{style:`width:${freshPct}%;background:#52b788`}) : null,
        stale > 0 ? el("div",{style:`width:${stalePct}%;background:#ffd54f`}) : null,
        old > 0 ? el("div",{style:`width:${oldPct}%;background:#ef5350`}) : null,
      ].filter(Boolean)),
      el("div",{style:"display:flex;gap:16px;font-size:12px"},[
        el("span",{}, [el("span",{style:"color:#52b788;font-weight:600"}, `${fresh}`), ` fresh (<10s)`]),
        el("span",{}, [el("span",{style:"color:#ffd54f;font-weight:600"}, `${stale}`), ` stale (10-60s)`]),
        el("span",{}, [el("span",{style:"color:#ef5350;font-weight:600"}, `${old}`), ` old (>60s)`]),
      ]),
    ]));
  }

  // ── Snapshot Summary ──
  if(snap){
    const objects = snap.objects || {};
    const roomCount = (snap.rooms_discovered || []).length;
    const recCount = (snap.receivers || []).length;
    const tags = snap.tags || [];
    const genAt = snap.generated_at || "\u2014";

    grid.appendChild(el("div",{class:"card"},[
      el("div",{style:"font-weight:700;margin-bottom:8px"},"Snapshot Summary"),
      el("div",{style:"display:flex;flex-wrap:wrap;gap:12px;font-size:12px"},[
        el("div",{}, [el("span",{class:"muted"},"Objects: "), el("span",{style:"font-weight:600"}, String(objects.summary?.total ?? 0))]),
        el("div",{}, [el("span",{class:"muted"},"Rooms: "), el("span",{style:"font-weight:600"}, String(roomCount))]),
        el("div",{}, [el("span",{class:"muted"},"Receivers: "), el("span",{style:"font-weight:600"}, String(recCount))]),
        el("div",{}, [el("span",{class:"muted"},"Tags: "), el("span",{style:"font-weight:600"}, String(tags.length))]),
      ]),
      el("div",{class:"muted",style:"font-size:11px;margin-top:6px"}, `Generated: ${genAt}`),
    ]));
  }

  // ── Session Info ──
  const uptimeMs = Date.now() - (ctx.state._sessionStart || Date.now());
  const uptimeMin = Math.floor(uptimeMs / 60000);
  const uptimeSec = Math.floor((uptimeMs % 60000) / 1000);
  grid.appendChild(el("div",{class:"card"},[
    el("div",{style:"font-weight:700;margin-bottom:8px"},"Session Info"),
    el("div",{style:"display:flex;flex-direction:column;gap:4px;font-size:12px"},[
      el("div",{}, [el("span",{class:"muted"},"Data mode: "), el("span",{style:"font-weight:600"}, ctx.state.dataMode.toUpperCase())]),
      el("div",{}, [el("span",{class:"muted"},"Panel uptime: "), el("span",{style:"font-weight:600"}, `${uptimeMin}m ${uptimeSec}s`)]),
      el("div",{}, [el("span",{class:"muted"},"Events logged: "), el("span",{style:"font-weight:600"}, String((ctx.state._sessionEvents||[]).length))]),
    ]),
  ]));

  root.appendChild(grid);
  return root;
}


// ═══════════════════════════════════════════════════════════════════════════
// ZONES TAB
// ═══════════════════════════════════════════════════════════════════════════
function _zones(ctx, el){
  const snap = (ctx.state.live && ctx.state.live.snapshot) || null;
  const wrap = el("div",{});

  if(!snap){
    wrap.appendChild(el("div",{class:"card"},[
      el("div",{class:"muted"},"No snapshot available. Switch to Live or Sample mode to see zone data."),
    ]));
    return wrap;
  }

  const rooms = snap.rooms_discovered || [];
  const _isScanner = ctx.helpers.isScanner;
  const objects = ((snap.objects && snap.objects.list) || []).filter(o => !_isScanner(o));
  const model = ctx.state.model || {};
  const floors = (model.floors || []);
  const areas = (model.areas || []);

  // Build room → objects map (quiet mode filters unidentified)
  const _quietMode = !!(ctx.state.settings && ctx.state.settings.quiet_mode);
  const roomObjs = {};
  for(const r of rooms) roomObjs[r] = [];
  for(const o of objects){
    const r = o.room || "";
    if(!r) continue;
    if(_quietMode && !o.user_label && !o.identified && !(ctx.actions.followedHas && ctx.actions.followedHas(o.address || o.key || ""))) continue;
    if(roomObjs[r]) roomObjs[r].push(o);
    else roomObjs[r] = [o];
  }

  const occupied = Object.values(roomObjs).filter(v=>v.length>0).length;
  const empty = rooms.length - occupied;

  // KPI row
  wrap.appendChild(el("div",{class:"row",style:"gap:10px;flex-wrap:wrap;margin-bottom:16px"},[
    el("span",{class:"badge"}, `${rooms.length} rooms`),
    el("span",{class:"badge"}, `${occupied} occupied`),
    el("span",{class:"badge"}, `${empty} empty`),
    el("span",{class:"badge"}, `${objects.length} objects`),
  ]));

  if(rooms.length === 0){
    wrap.appendChild(el("div",{class:"card"},[
      el("div",{class:"muted"},"No rooms discovered. Configure areas in Home Assistant."),
    ]));
    return wrap;
  }

  // Build floor→room mapping if floors exist
  const floorRooms = {};
  let hasFloors = false;
  if(floors.length > 0 && areas.length > 0){
    for(const f of floors) floorRooms[f.floor_id] = { name: f.name || f.floor_id, rooms: [] };
    floorRooms["_none"] = { name: "Unassigned", rooms: [] };
    for(const a of areas){
      const fid = a.floor_id || "_none";
      if(!floorRooms[fid]) floorRooms[fid] = { name: fid, rooms: [] };
      if(rooms.includes(a.name)) floorRooms[fid].rooms.push(a.name);
    }
    const assignedRooms = new Set(areas.map(a=>a.name));
    for(const r of rooms){
      if(!assignedRooms.has(r)) floorRooms["_none"].rooms.push(r);
    }
    hasFloors = Object.values(floorRooms).some(f => f.rooms.length > 0 && f.name !== "Unassigned");
  }

  // Render room card helper
  const renderRoomCard = (room) => {
    const objs = roomObjs[room] || [];
    const isOccupied = objs.length > 0;
    const rc = ctx.helpers.roomColor(room);
    const borderColor = isOccupied ? rc : "rgba(255,255,255,0.08)";

    const card = el("div",{class:"card",style:`border-left:4px solid ${borderColor};cursor:pointer`});
    card.addEventListener("click", (e)=>{
      if(e.target.closest("[data-obj-click]")) return;
      ctx.actions.showRoomDetail(room);
    });

    card.appendChild(el("div",{class:"row",style:"justify-content:space-between;align-items:center;margin-bottom:8px"},[
      el("div",{style:`font-weight:700;color:${isOccupied ? "#e2e8f0" : "#64748b"}`}, room),
      el("span",{class:"badge"+(isOccupied?"":" muted")}, `${objs.length}`),
    ]));

    if(objs.length > 0){
      const list = el("div",{style:"display:flex;flex-direction:column;gap:3px"});
      for(const o of objs.slice(0, 8)){
        const label = o.user_label || o.name || o.address || "Unknown";
        const rssiText = o.rssi != null ? ` (${o.rssi} dBm)` : "";
        const isFollowed = ctx.actions.followedHas && ctx.actions.followedHas(o.address || o.key);
        const objRow = el("div",{"data-obj-click":"1",style:"font-size:12px;cursor:pointer;padding:2px 4px;border-radius:3px;display:flex;align-items:center;gap:4px"});
        objRow.addEventListener("mouseenter", ()=>{ objRow.style.background = "rgba(255,255,255,0.06)"; });
        objRow.addEventListener("mouseleave", ()=>{ objRow.style.background = ""; });
        objRow.addEventListener("click", (e)=>{ e.stopPropagation(); ctx.actions.showObjectDetail(o); });
        if(isFollowed) objRow.appendChild(el("span",{style:"color:#f59e0b;font-size:10px;flex-shrink:0"},"\u25C9"));
        objRow.appendChild(el("span",{style:"color:#cbd5e1"}, label));
        objRow.appendChild(el("span",{class:"muted",style:"font-size:11px"}, rssiText));
        list.appendChild(objRow);
      }
      if(objs.length > 8) list.appendChild(el("div",{class:"muted",style:"font-size:11px;font-style:italic;padding-left:4px"}, `+${objs.length - 8} more`));
      card.appendChild(list);
    } else {
      card.appendChild(el("div",{class:"muted",style:"font-size:12px;font-style:italic"},"Empty"));
    }
    return card;
  };

  // Render with floor grouping or flat
  if(hasFloors){
    for(const [fid, fdata] of Object.entries(floorRooms)){
      if(fdata.rooms.length === 0) continue;
      const sorted = [...fdata.rooms].sort((a,b)=>(roomObjs[b]||[]).length - (roomObjs[a]||[]).length || a.localeCompare(b));
      wrap.appendChild(el("div",{style:"font-size:14px;font-weight:700;color:#94a3b8;margin:16px 0 8px;border-bottom:1px solid rgba(255,255,255,0.06);padding-bottom:4px"}, fdata.name));
      const grid = el("div",{class:"grid"});
      for(const room of sorted) grid.appendChild(renderRoomCard(room));
      wrap.appendChild(grid);
    }
  } else {
    const grid = el("div",{class:"grid"});
    const sortedRooms = Object.keys(roomObjs).sort((a,b)=>{
      const diff = (roomObjs[b]||[]).length - (roomObjs[a]||[]).length;
      return diff !== 0 ? diff : a.localeCompare(b);
    });
    for(const room of sortedRooms) grid.appendChild(renderRoomCard(room));
    wrap.appendChild(grid);
  }

  return wrap;
}


// ═══════════════════════════════════════════════════════════════════════════
// INSIGHTS TAB
// ═══════════════════════════════════════════════════════════════════════════
function _insights(ctx, el, _sid){
  const snap = (ctx.state.live && ctx.state.live.snapshot) || null;
  const wrap = el("div",{});

  if(!snap){
    wrap.appendChild(el("div",{class:"card"},[
      el("div",{class:"muted"},"No snapshot available. Switch to Live or Sample mode to see insights."),
    ]));
    return wrap;
  }

  const rooms = snap.rooms_discovered || [];
  const _quietMode = !!(ctx.state.settings && ctx.state.settings.quiet_mode);
  const _allObjects = (snap.objects && snap.objects.list) || [];
  const objects = _quietMode
    ? _allObjects.filter(o => o.user_label || o.identified || (ctx.actions.followedHas && ctx.actions.followedHas(o.address || o.key || "")))
    : _allObjects;
  const radios = (snap.ble && snap.ble.radios) || [];
  const ads = (snap.ble && snap.ble.advertisements) || [];
  const roomTagMap = ctx.state.roomTagMap || {};
  const maps = (ctx.state.maps && ctx.state.maps.list) || [];

  const grid = el("div",{class:"grid"});

  // ── Room Occupancy bar chart ──
  const roomCounts = {};
  for(const o of objects){
    const r = o.room || "Unknown";
    roomCounts[r] = (roomCounts[r]||0) + 1;
  }
  const sortedRC = Object.entries(roomCounts).sort((a,b)=>b[1]-a[1]);
  const maxCount = sortedRC.length ? sortedRC[0][1] : 1;

  const occCard = el("div",{class:"card",style:"overflow:hidden;min-width:0"});
  occCard.appendChild(el("div",{style:"font-weight:700;margin-bottom:10px"},"Room Occupancy"));
  if(sortedRC.length === 0){
    occCard.appendChild(el("div",{class:"muted"},"No objects assigned to rooms."));
  } else {
    const bars = el("div",{style:"display:flex;flex-direction:column;gap:6px"});
    for(const [room, count] of sortedRC.slice(0, 12)){
      const pct = Math.round((count / maxCount) * 100);
      const rc = ctx.helpers.roomColor(room);
      const row = el("div",{style:"display:flex;align-items:center;gap:8px;cursor:pointer;padding:2px 0;border-radius:3px"});
      row.addEventListener("mouseenter", ()=>{ row.style.background = "rgba(255,255,255,0.04)"; });
      row.addEventListener("mouseleave", ()=>{ row.style.background = ""; });
      row.addEventListener("click", ()=>ctx.actions.showRoomDetail(room));
      row.appendChild(el("div",{style:"width:100px;font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex-shrink:0"}, room));
      row.appendChild(el("div",{style:"flex:1;background:#1a2e1e;border-radius:3px;height:14px;position:relative"}, [
        el("div",{style:`width:${pct}%;height:100%;background:${rc};border-radius:3px;min-width:2px`}),
      ]));
      row.appendChild(el("div",{style:"width:24px;text-align:right;font-size:12px;font-weight:600"}, String(count)));
      bars.appendChild(row);
    }
    occCard.appendChild(bars);
  }
  grid.appendChild(occCard);

  // ── Signal Quality per scanner ──
  const scannerTotals = {};
  for(const ad of ads){
    const src = ad.source || "unknown";
    scannerTotals[src] = (scannerTotals[src] || 0) + 1;
  }
  const qualityBySrc2 = _scannerQuality(ads);

  const sigCard = el("div",{class:"card",style:"overflow:hidden"});
  sigCard.appendChild(el("div",{style:"font-weight:700;margin-bottom:10px"},"Signal Quality"));
  if(Object.keys(scannerTotals).length === 0){
    sigCard.appendChild(el("div",{class:"muted"},"No scanner data available."));
  } else {
    const tbl = el("table",{style:"width:100%;font-size:12px;border-collapse:collapse;table-layout:fixed"});
    tbl.appendChild(el("tr",{},[
      el("th",{style:"text-align:left;padding:4px 4px;color:#94a3b8;font-weight:600;width:15%"},"ID"),
      el("th",{style:"text-align:left;padding:4px 4px;color:#94a3b8;font-weight:600;width:32%;overflow:hidden;text-overflow:ellipsis"},"Scanner"),
      el("th",{style:"text-align:right;padding:4px 4px;color:#94a3b8;font-weight:600;width:16%"},"Devices"),
      el("th",{style:"text-align:right;padding:4px 4px;color:#94a3b8;font-weight:600;width:18%",title:"Average RSSI of each device's OWN strongest scanner only \u2014 a device closer to another scanner doesn't count against this one."},"Best-RSSI"),
      el("th",{style:"text-align:left;padding:4px 4px;color:#94a3b8;font-weight:600;width:19%"},"Grade"),
    ]));
    for(const [src, total] of Object.entries(scannerTotals).sort((a,b)=>b[1]-a[1])){
      const q = qualityBySrc2[src];
      const avg = q && q.count > 0 ? Math.round(q.rssiSum / q.count) : null;
      const { label: grade, color: gradeColor } = _qualityGrade(avg);
      const radio = radios.find(r=>r.source===src);
      const name = (radio && radio.name) || src;
      const tr = el("tr",{style:"cursor:pointer"});
      tr.addEventListener("mouseenter", ()=>{ tr.style.background = "rgba(255,255,255,0.04)"; });
      tr.addEventListener("mouseleave", ()=>{ tr.style.background = ""; });
      tr.addEventListener("click", ()=>{
        if(radio) ctx.actions.showScannerDetail(radio);
      });
      const _rn2 = ctx.helpers.radioName(src);
      tr.appendChild(el("td",{style:"padding:4px 4px;font-family:monospace;font-weight:700;font-size:10px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#7dd3fc",title:(_rn2?_rn2+" \u00b7 ":"")+src}, _sid(src)));
      tr.appendChild(el("td",{style:"padding:4px 4px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#7dd3fc;text-decoration:underline;text-decoration-color:rgba(125,211,252,0.35);text-underline-offset:2px",title:name}, name));
      tr.appendChild(el("td",{style:"padding:4px 4px;text-align:right"}, String(total)));
      tr.appendChild(el("td",{style:"padding:4px 4px;text-align:right;font-family:monospace"}, avg !== null ? `${avg}` : "\u2014"));
      tr.appendChild(el("td",{style:`padding:4px 4px;color:${gradeColor};font-weight:600`}, grade));
      tbl.appendChild(tr);
    }
    sigCard.appendChild(tbl);
  }
  grid.appendChild(sigCard);

  // ── Object Mobility ──
  // Accumulate rooms-seen across polls in session state
  if(!ctx.state._mobilityRooms) ctx.state._mobilityRooms = {};
  const _mobRooms = ctx.state._mobilityRooms;
  for(const obj of objects){
    const k = obj.key || obj.entity_id || "";
    if(!k || !obj.room) continue;
    if(!_mobRooms[k]) _mobRooms[k] = new Set();
    _mobRooms[k].add(obj.room);
  }
  const mobCard = el("div",{class:"card",style:"overflow:hidden;min-width:0"});
  mobCard.appendChild(el("div",{style:"font-weight:700;margin-bottom:10px"},"Object Mobility"));
  const topMobile = Object.entries(_mobRooms)
    .map(([t, rs])=>({t, n: rs.size, rooms: [...rs]}))
    .filter(x=>x.n > 1)
    .sort((a,b)=>b.n-a.n)
    .slice(0, 10);
  if(topMobile.length === 0){
    mobCard.appendChild(el("div",{class:"muted"},"No objects seen in multiple rooms yet. Data accumulates across polls — check back in a few minutes."));
  } else {
    const list = el("div",{style:"display:flex;flex-direction:column;gap:4px"});
    for(const x of topMobile){
      const obj = objects.find(o => o.key === x.t || o.entity_id === x.t);
      const row = el("div",{style:"font-size:12px;display:flex;justify-content:space-between;align-items:center;padding:3px 4px;border-radius:3px;gap:6px;" + (obj ? "cursor:pointer;" : "")});
      if(obj){
        row.addEventListener("mouseenter", ()=>{ row.style.background = "rgba(255,255,255,0.04)"; });
        row.addEventListener("mouseleave", ()=>{ row.style.background = ""; });
        row.addEventListener("click", ()=>ctx.actions.showObjectDetail(obj));
      }
      row.appendChild(el("span",{style:"overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;min-width:0"}, obj ? (obj.user_label || obj.name || x.t) : x.t));
      row.appendChild(el("span",{class:"badge",style:"flex-shrink:0",title:x.rooms.join(", ")}, `${x.n} rooms`));
      list.appendChild(row);
    }
    mobCard.appendChild(list);
  }
  grid.appendChild(mobCard);

  // ── Coverage Gaps ──
  const gapCard = el("div",{class:"card",style:"overflow:hidden;min-width:0"});
  gapCard.appendChild(el("div",{style:"font-weight:700;margin-bottom:10px"},"Coverage Gaps"));
  const gapItems = [];

  const emptyRooms = rooms.filter(r=>!(roomCounts[r]));
  if(emptyRooms.length > 0){
    const roomLinks = el("div",{style:"display:flex;flex-wrap:wrap;gap:4px;margin-top:4px"});
    for(const r of emptyRooms){
      const chip = el("span",{style:"font-size:11px;color:#ffd54f;cursor:pointer;text-decoration:underline;text-decoration-style:dotted"}, r);
      chip.addEventListener("click", ()=>ctx.actions.showRoomDetail(r));
      roomLinks.appendChild(chip);
    }
    gapItems.push(el("div",{style:"font-size:12px;margin-bottom:6px"},[
      el("span",{style:"color:#ffd54f;font-weight:600"}, `${emptyRooms.length} empty room${emptyRooms.length>1?"s":""}:`),
      roomLinks,
    ]));
  }

  const mappedReceivers = new Set();
  for(const m of maps){
    for(const r of (m.receivers || [])) mappedReceivers.add(r.source || r.name || r.id);
  }
  const unmappedScanners = radios.filter(r=>!mappedReceivers.has(r.source) && !mappedReceivers.has(r.name));
  if(unmappedScanners.length > 0){
    const scanLinks = el("div",{style:"display:flex;flex-wrap:wrap;gap:4px;margin-top:4px"});
    for(const s of unmappedScanners){
      const chip = el("span",{style:"font-size:11px;color:#ffd54f;cursor:pointer;text-decoration:underline;text-decoration-style:dotted"}, s.name||s.source);
      chip.addEventListener("click", ()=>ctx.actions.showScannerDetail(s));
      scanLinks.appendChild(chip);
    }
    gapItems.push(el("div",{style:"font-size:12px;margin-bottom:6px"},[
      el("span",{style:"color:#ffd54f;font-weight:600"}, `${unmappedScanners.length} scanner${unmappedScanners.length>1?"s":""} not on any map:`),
      scanLinks,
    ]));
  }

  if(gapItems.length === 0){
    gapCard.appendChild(el("div",{style:"font-size:12px;color:#52b788;font-weight:600"},"No coverage gaps detected."));
  } else {
    for(const item of gapItems) gapCard.appendChild(item);
  }
  grid.appendChild(gapCard);

  // ── Device Breakdown ──
  const summary = snap.objects && snap.objects.summary;
  const brkCard = el("div",{class:"card",style:"overflow:hidden;min-width:0"});
  brkCard.appendChild(el("div",{style:"font-weight:700;margin-bottom:10px"},"Device Breakdown"));
  if(!summary){
    brkCard.appendChild(el("div",{class:"muted"},"No object summary available."));
  } else {
    const tagged = objects.filter(o=>o.user_label).length;
    const identified = summary.identified || 0;
    const unidentified = summary.unidentified || 0;
    const total = summary.total || 0;

    const items = [
      { label: "Total", value: total, color: "#e2e8f0" },
      { label: "Identified", value: identified, color: "#52b788" },
      { label: "Unidentified", value: unidentified, color: unidentified > 0 ? "#ef5350" : "#52b788" },
      { label: "Tagged", value: tagged, color: "#5eead4" },
    ];
    const row = el("div",{style:"display:flex;gap:16px;flex-wrap:wrap"});
    for(const it of items){
      row.appendChild(el("div",{style:"text-align:center"},[
        el("div",{style:`font-size:24px;font-weight:800;color:${it.color}`}, String(it.value)),
        el("div",{class:"muted",style:"font-size:11px"}, it.label),
      ]));
    }
    brkCard.appendChild(row);
  }
  grid.appendChild(brkCard);

  // ── Dashboard Card Preview ──
  const dashCard = el("div",{class:"card",style:"overflow:hidden;min-width:0"});
  dashCard.appendChild(el("div",{style:"font-weight:700;margin-bottom:10px"},"Dashboard Card Preview"));
  dashCard.appendChild(el("div",{class:"muted",style:"font-size:11px;margin-bottom:10px"}, "What a Lovelace card could look like with your current data."));

  // Mini room grid
  const roomCells = Object.entries(roomCounts).sort((a,b)=>b[1]-a[1]).slice(0, 9);
  if(roomCells.length === 0){
    dashCard.appendChild(el("div",{class:"muted",style:"font-size:12px"},"No room data to preview."));
  } else {
    const cols = Math.min(3, roomCells.length);
    const miniGrid = el("div",{style:`display:grid;grid-template-columns:repeat(${cols},1fr);gap:6px;max-width:100%`});
    for(const [room, count] of roomCells){
      const rc = ctx.helpers.roomColor ? ctx.helpers.roomColor(room) : "#52b788";
      const cell = el("div",{style:`background:${rc}18;border:1px solid ${rc}44;border-radius:6px;padding:8px;text-align:center;overflow:hidden;min-width:0`},[
        el("div",{style:"font-size:11px;color:#94a3b8;overflow:hidden;text-overflow:ellipsis;white-space:nowrap"}, room),
        el("div",{style:`font-size:20px;font-weight:800;color:${rc}`}, String(count)),
        el("div",{style:"display:flex;justify-content:center;gap:2px;margin-top:4px"},
          Array.from({length: Math.min(count, 5)}, ()=> el("span",{style:`width:6px;height:6px;border-radius:50%;background:${rc}`}))
        ),
      ]);
      miniGrid.appendChild(cell);
    }
    dashCard.appendChild(miniGrid);
  }
  grid.appendChild(dashCard);

  wrap.appendChild(grid);
  return wrap;
}


// ═══════════════════════════════════════════════════════════════════════════
// HEALTH TAB
// ═══════════════════════════════════════════════════════════════════════════
function _health(ctx, el){
  const snap = (ctx.state.live && ctx.state.live.snapshot) || null;
  const rooms  = (snap?.rooms_discovered?.length) ?? Object.keys(ctx.state.roomTagMap||{}).length;
  const tags   = (snap?.tags?.length) ?? Object.values(ctx.state.roomTagMap||{}).reduce((a,b)=>a+(b?.length||0),0);
  const radios = snap?.ble?.radios?.length ?? 0;

  const wrap = el("div",{class:"grid"});
  wrap.appendChild(el("div",{class:"card"},[
    el("div",{style:"font-weight:700"},"System"),
    el("div",{class:"mono"},`UI v${ctx.state.version} • build ${ctx.state.buildId}`),
    el("div",{class:"mono"},`Data mode: ${(ctx.state.dataMode||"").toUpperCase()}`),
    el("div",{class:"mono"},`Refresh: ${ctx.state.timing?.lastRefreshMs??"—"}ms`),
  ]));
  wrap.appendChild(el("div",{class:"card"},[
    el("div",{style:"font-weight:700"},"Discovery (best-effort)"),
    el("div",{class:"mono"},`Rooms: ${rooms}`),
    el("div",{class:"mono"},`Radios: ${radios}`),
    el("div",{class:"mono"},`Objects tracked: ${(snap?.objects?.list||[]).length}`),
    el("div",{class:"mono"},`Tags: ${tags}`),
    el("div",{class:"muted",style:"margin-top:8px"},"For deeper validation, open the Diag Export tab and paste the JSON into chat."),
  ]));
  if(snap?.ble){
    wrap.appendChild(el("div",{class:"card"},[
      el("div",{style:"font-weight:700"},"Bluetooth"),
      el("div",{class:"mono"},`Scanners: ${(snap.ble.radios||[]).length}`),
      el("div",{class:"mono"},`Advertisements: ${(snap.ble.advertisements||[]).length}`),
    ]));
  }

  // ── Phase 4: System Critics Summary ────────────────────────────────────
  const criticsWrap = el("div",{style:"grid-column:1/-1;margin-top:4px"});
  wrap.appendChild(criticsWrap);
  _fetchCriticsInline(ctx, el, criticsWrap);

  return wrap;
}

// ── Phase 4: Inline critics for Monitor → Health sub-tab ─────────────────
let _monCriticsCache = null;
let _monCriticsFetchTs = 0;

async function _fetchCriticsInline(ctx, el, container) {
  const now = Date.now();
  if (_monCriticsCache && (now - _monCriticsFetchTs) < 30000) {
    _renderCriticsInline(ctx, el, container, _monCriticsCache);
    return;
  }
  container.innerHTML = "";
  container.appendChild(el("div",{class:"card",style:"text-align:center;color:#94a3b8;padding:16px"},
    "Loading system critics\u2026"
  ));
  try {
    const res = await ctx.actions.callWS({ type: "padspan_ha/system_critics" });
    _monCriticsCache = res;
    _monCriticsFetchTs = Date.now();
    _renderCriticsInline(ctx, el, container, res);
  } catch (err) {
    container.innerHTML = "";
    container.appendChild(el("div",{class:"card",style:"color:#fca5a5"},
      `Failed to load system critics: ${err.message || err}`
    ));
  }
}

function _renderCriticsInline(ctx, el, container, data) {
  container.innerHTML = "";
  const { summary, critics, confusion_matrix } = data;

  // Summary banner
  const bannerColor = summary.healthy ? "#52b788" :
    summary.critical > 0 ? "#f87171" :
    summary.warning > 0 ? "#f59e0b" : "#52b788";
  const bannerText = summary.healthy
    ? "All systems healthy \u2014 no issues detected."
    : `${summary.total} issue${summary.total !== 1 ? "s" : ""}: ` +
      [
        summary.critical > 0 ? `${summary.critical} critical` : "",
        summary.warning > 0 ? `${summary.warning} warning` : "",
        summary.info > 0 ? `${summary.info} info` : "",
      ].filter(Boolean).join(", ");

  const banner = el("div",{class:"card",style:`border:1px solid ${bannerColor}33;background:${bannerColor}08`},[
    el("div",{style:`display:flex;align-items:center;gap:8px`},[
      el("div",{style:`font-weight:800;font-size:14px;color:${bannerColor}`},"System Critics (Phase 4)"),
      el("div",{class:"pill",style:`background:${bannerColor}22;color:${bannerColor};font-size:10px;padding:2px 8px`},
        summary.healthy ? "HEALTHY" : `${summary.total} ISSUE${summary.total !== 1 ? "S" : ""}`
      ),
    ]),
    el("div",{style:`font-size:11px;color:${bannerColor};margin-top:4px`}, bannerText),
  ]);
  container.appendChild(banner);

  // Show top 5 critics inline
  const sevColors = {
    critical: { text: "#fca5a5", icon: "\u26d4" },
    warning:  { text: "#fbbf24", icon: "\u26a0" },
    info:     { text: "#94a3b8", icon: "\u2139" },
  };
  const topCritics = critics.slice(0, 5);
  if (topCritics.length) {
    const list = el("div",{style:"margin-top:8px"});
    for (const c of topCritics) {
      const sev = sevColors[c.severity] || sevColors.info;
      const row = el("div",{style:`display:flex;align-items:flex-start;gap:6px;padding:6px 0;border-bottom:1px solid #1e3a2c;font-size:11px`});
      row.innerHTML = `<span style="color:${sev.text}">${sev.icon}</span>
        <span style="color:${sev.text};font-weight:600">${_escHtmlMon(c.title)}</span>
        <span style="color:#64748b;margin-left:auto;white-space:nowrap;font-size:10px">${_escHtmlMon(c.category.replace(/_/g," "))}</span>`;
      list.appendChild(row);
    }
    if (critics.length > 5) {
      list.appendChild(el("div",{style:"font-size:10px;color:#64748b;padding-top:4px"},
        `+ ${critics.length - 5} more issue${critics.length - 5 > 1 ? "s" : ""}\u2026`
      ));
    }
    container.appendChild(list);
  }

  // Room confusion mini-table (top 5)
  if (confusion_matrix && confusion_matrix.length) {
    const cm = el("div",{style:"margin-top:10px"});
    cm.appendChild(el("div",{style:"font-weight:600;font-size:11px;color:#94a3b8;margin-bottom:4px"},"Top Confused Room Pairs"));
    const tbl = el("div",{style:"display:grid;grid-template-columns:1fr 1fr auto;gap:2px 8px;font-size:11px"});
    for (const entry of confusion_matrix.slice(0, 5)) {
      const heat = entry.rate >= 0.15 ? "#f87171" : entry.rate >= 0.08 ? "#f59e0b" : "#94a3b8";
      tbl.appendChild(el("div",{}, entry.room_a));
      tbl.appendChild(el("div",{}, entry.room_b));
      tbl.appendChild(el("div",{style:`color:${heat};text-align:right`}, `${entry.count}x`));
    }
    cm.appendChild(tbl);
    container.appendChild(cm);
  }

  // Refresh button
  const refreshBtn = el("button",{class:"btn",style:"margin-top:8px;width:auto;padding:4px 12px;font-size:11px"}, "Refresh");
  refreshBtn.addEventListener("click", () => {
    _monCriticsCache = null;
    _monCriticsFetchTs = 0;
    _fetchCriticsInline(ctx, el, container);
  });
  container.appendChild(refreshBtn);
}

function _escHtmlMon(str) {
  return String(str).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
}


// ═══════════════════════════════════════════════════════════════════════════
// DIAG EXPORT TAB (was "Diagnostics" in Manage)
// ═══════════════════════════════════════════════════════════════════════════
function _diagExport(ctx, el){
  const payload = {
    ui: { version:ctx.state.version, buildId:ctx.state.buildId, view:ctx.state.view, dataMode:ctx.state.dataMode, timing:ctx.state.timing, wsCounts:ctx.state.wsCounts },
    backend: { versionInfo:ctx.state.versionInfo, status:ctx.state.status, roomTagMap:ctx.state.roomTagMap, liveSnapshot:ctx.state.live?.snapshot, liveSources:ctx.state.live?.sources, maps:ctx.state.maps?.list },
    autoDiagnostics: ctx.state.diag,
  };
  const text = JSON.stringify(payload,null,2);

  const ta = document.createElement("textarea");
  ta.className = "mono";
  ta.setAttribute("style","width:100%;height:420px;resize:vertical;white-space:pre;overflow:auto;");
  ta.readOnly = true;
  ta.value = text;

  const selectAll = ()=>{ ta.focus(); ta.select(); };
  const btnSelect = el("button",{class:"btn"},"Select All");
  btnSelect.addEventListener("click",()=>{ selectAll(); ctx.toast("Selected. Press Ctrl/Cmd+C to copy."); });

  const btnCopy = el("button",{class:"btn"},"Copy");
  btnCopy.addEventListener("click", async()=>{
    try { await navigator.clipboard.writeText(text); ctx.toast("Copied diagnostics."); return; } catch(e){}
    try {
      const tmp = document.createElement("textarea");
      tmp.value=text; tmp.setAttribute("readonly",""); tmp.style.position="fixed"; tmp.style.left="-9999px"; tmp.style.top="0";
      document.body.appendChild(tmp); tmp.focus(); tmp.select();
      const ok = document.execCommand && document.execCommand("copy");
      document.body.removeChild(tmp);
      if(ok){ ctx.toast("Copied diagnostics."); return; }
    } catch(e2){}
    selectAll(); ctx.toast("Copy blocked by browser. Press Ctrl/Cmd+C.", true);
  });

  const wrap = el("div",{class:"grid"});
  const diagCard = el("div",{class:"card"});
  diagCard.appendChild(el("div",{style:"display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap"},[
    el("div",{},[
      el("div",{style:"font-weight:700"},"Diagnostics Export"),
      el("div",{class:"muted"},"Paste this back into chat when something breaks."),
    ]),
    el("div",{style:"display:flex;gap:8px;align-items:center"},[btnSelect,btnCopy]),
  ]));
  diagCard.appendChild(ta);
  wrap.appendChild(diagCard);
  wrap.appendChild(el("div",{class:"card"},[
    el("div",{style:"font-weight:700"},"Install Verification"),
    el("div",{class:"muted"},"If UI/Backend versions differ, HA is serving an older install or cached JS."),
    el("div",{class:"mono"},`UI: v${ctx.state.version} • build ${ctx.state.buildId}`),
    el("div",{class:"mono"},`Backend: ${ctx.state.versionInfo?JSON.stringify(ctx.state.versionInfo):"unknown"}`),
    el("div",{class:"muted",style:"margin-top:8px"},"If backend version differs from UI, you likely have multiple installs. Remove duplicates and restart HA."),
  ]));
  return wrap;
}


// ═══════════════════════════════════════════════════════════════════════════
// DEBUG TAB
// ═══════════════════════════════════════════════════════════════════════════
function _debug(ctx, el){
  const pre = document.createElement("pre");
  pre.className = "mono";
  pre.setAttribute("style","max-height:520px;overflow:auto");
  pre.textContent = JSON.stringify(ctx.state,(k,v)=>{ if(v instanceof Set) return Array.from(v); return v; },2);
  const card = el("div",{class:"card"},[
    el("div",{style:"font-weight:700"},"Debug (panel state)"),
    el("div",{class:"muted"},"Useful for UI-side issues (dead buttons, missing views)."),
  ]);
  card.appendChild(pre);
  return el("div",{},[card]);
}
