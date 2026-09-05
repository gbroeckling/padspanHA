// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
// See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
/**
 * Sandbox view — experimental data playground.
 * Read-only exploration of live snapshot data, experimental feature toggles,
 * and internal state. Nothing here changes config or persisted data.
 * Marked with a PLAYGROUND badge to set expectations.
 */

export function render(ctx){
  const { el, helpBtn, radioShortId } = ctx.helpers;
  const _sid = (source) => radioShortId ? radioShortId(source || "") : "";
  const snap = (ctx.state.live && ctx.state.live.snapshot) || null;
  const settings = ctx.state.settings || {};
  const root = el("section",{id:"sandbox"});

  // Header
  root.appendChild(el("div",{class:"row",style:"align-items:center;gap:8px;margin-bottom:14px"},[
    el("h2",{},"Sandbox"),
    el("span",{style:"font-size:10px;font-weight:600;color:#fbbf24;background:#422006;padding:2px 6px;border-radius:4px"},"PLAYGROUND"),
    helpBtn("sandbox"),
  ]));

  root.appendChild(el("div",{class:"muted",style:"font-size:12px;margin-bottom:16px;line-height:1.5"},
    "Experimental data playground — explore live data, check experimental feature status, and poke around under the hood. Nothing here changes your config."));

  const grid = el("div",{class:"grid"});

  // ── Experimental Features Hub ──────────────────────────────────────────────
  const expCard = el("div",{class:"card",style:"border-color:#f59e0b"});
  expCard.appendChild(el("div",{style:"display:flex;align-items:center;gap:8px;margin-bottom:10px"},[
    el("span",{style:"font-size:16px"},"\u2697\uFE0F"),
    el("div",{style:"font-weight:700;font-size:14px;color:#f59e0b"},"Experimental Features"),
  ]));
  expCard.appendChild(el("div",{class:"muted",style:"font-size:11px;margin-bottom:12px"},
    "Status of all experimental features across PadSpan. Click any row to jump to its settings."));

  const expFeatures = [
    {
      name: "Adaptive Learning",
      enabled: settings.adaptive_learning_enabled === true,
      location: "Settings \u2192 Presence",
      tab: "settings",
      desc: "Passively learns room RSSI fingerprints from high-confidence assignments",
    },
    {
      name: "Floor Detection",
      enabled: settings.adaptive_floor_detection === true,
      location: "Settings \u2192 Presence",
      tab: "settings",
      desc: "Learns cross-floor signal attenuation for multi-story accuracy",
      sub: true,
    },
    {
      name: "MQTT Publishing",
      enabled: settings.mqtt_publish_enabled === true,
      location: "Manage \u2192 Data",
      tab: "manage",
      desc: "Publishes device presence to MQTT topics for external systems",
    },
    {
      name: "Ignore Bermuda",
      enabled: settings.bermuda_ignore === true,
      location: "Settings \u2192 Presence",
      tab: "settings",
      desc: "Completely ignore all data from the Bermuda integration",
    },
    {
      name: "Beacon Tune",
      enabled: false,
      location: "Calibration \u2192 Beacon Tune",
      tab: "calibration",
      desc: "Mark beacon positions on floor plans for auto-calibration",
      alwaysAvailable: true,
    },
  ];

  const expList = el("div",{style:"display:flex;flex-direction:column;gap:2px"});
  for(const f of expFeatures){
    const statusColor = f.alwaysAvailable ? "#38bdf8" : f.enabled ? "#52b788" : "#64748b";
    const statusText = f.alwaysAvailable ? "AVAILABLE" : f.enabled ? "ON" : "OFF";
    const row = el("div",{style:`display:flex;align-items:center;gap:8px;padding:6px 8px;border-radius:6px;cursor:pointer;${f.sub?"padding-left:24px":""}`});
    row.addEventListener("mouseenter", ()=>{ row.style.background = "rgba(255,255,255,0.04)"; });
    row.addEventListener("mouseleave", ()=>{ row.style.background = ""; });
    row.addEventListener("click", ()=>{ ctx.actions.navigate(f.tab); });
    row.appendChild(el("div",{style:`width:6px;height:6px;border-radius:50%;background:${statusColor};flex-shrink:0`}));
    row.appendChild(el("div",{style:"flex:1;min-width:0"},[
      el("div",{style:"font-size:12px;font-weight:600;color:#e2e8f0"}, f.name),
      el("div",{style:"font-size:10px;color:#64748b;overflow:hidden;text-overflow:ellipsis;white-space:nowrap"}, f.desc),
    ]));
    row.appendChild(el("div",{style:`font-size:9px;font-weight:700;color:${statusColor};letter-spacing:.05em;flex-shrink:0`}, statusText));
    expList.appendChild(row);
  }
  expCard.appendChild(expList);
  grid.appendChild(expCard);

  // ── State Inspector ────────────────────────────────────────────────────────
  const rooms = snap ? (snap.rooms_discovered || []) : [];
  const objects = snap ? ((snap.objects && snap.objects.list) || []) : [];
  const radios = snap ? ((snap.ble && snap.ble.radios) || []) : [];
  const ads = snap ? ((snap.ble && snap.ble.advertisements) || []) : [];
  const genAt = snap ? (snap.generated_at || "\u2014") : "\u2014";
  const uptimeMs = Date.now() - (ctx.state._sessionStart || Date.now());
  const uptimeMin = Math.floor(uptimeMs / 60000);

  const inspectorCard = el("div",{class:"card"});
  inspectorCard.appendChild(el("div",{style:"font-weight:700;margin-bottom:8px"},"State Inspector"));
  inspectorCard.appendChild(el("div",{style:"display:grid;grid-template-columns:1fr 1fr;gap:4px 12px;font-size:12px"},[
    el("div",{}, [el("span",{class:"muted"},"Mode: "), el("span",{style:"font-weight:600"}, ctx.state.dataMode.toUpperCase())]),
    el("div",{}, [el("span",{class:"muted"},"Session: "), el("span",{style:"font-weight:600"}, `${uptimeMin}m`)]),
    el("div",{}, [el("span",{class:"muted"},"Objects: "), el("span",{style:"font-weight:600"}, String(objects.length))]),
    el("div",{}, [el("span",{class:"muted"},"Radios: "), el("span",{style:"font-weight:600"}, String(radios.length))]),
    el("div",{}, [el("span",{class:"muted"},"Rooms: "), el("span",{style:"font-weight:600"}, String(rooms.length))]),
    el("div",{}, [el("span",{class:"muted"},"Ads: "), el("span",{style:"font-weight:600"}, String(ads.length))]),
    el("div",{style:"grid-column:1/-1"}, [el("span",{class:"muted"},"Snapshot: "), el("span",{style:"font-weight:600;font-size:11px"}, genAt)]),
  ]));

  // RSSI Distribution (merged into State Inspector card)
  if(ads.length > 0){
    const buckets = {};
    for(const ad of ads){
      if(ad.rssi == null) continue;
      const bucket = Math.floor(ad.rssi / 10) * 10;
      buckets[bucket] = (buckets[bucket] || 0) + 1;
    }
    const sortedBuckets = Object.entries(buckets)
      .map(([k,v])=>([Number(k),v]))
      .sort((a,b)=>a[0]-b[0]);
    const maxBucket = Math.max(...sortedBuckets.map(x=>x[1]), 1);
    const totalAds = sortedBuckets.reduce((s,b)=>s+b[1], 0);
    const avgRssi = totalAds > 0
      ? Math.round(ads.reduce((s,a)=>s+(a.rssi||0),0) / ads.filter(a=>a.rssi!=null).length)
      : 0;

    inspectorCard.appendChild(el("div",{style:"display:flex;align-items:center;justify-content:space-between;margin-top:12px;padding-top:10px;border-top:1px solid #1e293b;margin-bottom:8px"},[
      el("div",{style:"font-weight:700"},"RSSI Distribution"),
      el("div",{style:"font-size:11px;color:#94a3b8"}, `avg ${avgRssi} dBm`),
    ]));

    const chart = el("div",{style:"display:flex;align-items:flex-end;gap:4px;height:80px;overflow:hidden"});
    for(const [range, count] of sortedBuckets){
      const barH = Math.round((count / maxBucket) * 60);
      let barColor = "#52b788";
      if(range < -80) barColor = "#ef5350";
      else if(range < -70) barColor = "#ffd54f";
      else if(range < -60) barColor = "#81c784";
      const col = el("div",{style:"display:flex;flex-direction:column;align-items:center;flex:1;min-width:0"});
      col.appendChild(el("div",{style:`font-size:9px;color:${barColor};font-weight:600;margin-bottom:2px`}, String(count)));
      col.appendChild(el("div",{style:`height:${barH}px;width:100%;background:${barColor};border-radius:2px 2px 0 0;min-height:2px`}));
      col.appendChild(el("div",{style:"font-size:9px;color:#64748b;margin-top:2px;white-space:nowrap"}, `${range}`));
      chart.appendChild(col);
    }
    inspectorCard.appendChild(chart);
    inspectorCard.appendChild(el("div",{class:"muted",style:"font-size:10px;margin-top:6px;text-align:center"}, "dBm ranges (10 dBm buckets)"));
  }
  grid.appendChild(inspectorCard);

  // ── Floor Color Stack (rooms grouped by floor, each floor a column) ─────
  if(rooms.length > 0){
    const haFloors = (ctx.state.model && Array.isArray(ctx.state.model.floors)) ? ctx.state.model.floors : [];
    const haAreas  = (ctx.state.model && Array.isArray(ctx.state.model.areas))  ? ctx.state.model.areas  : [];

    // Build a lookup: room name → floor_id (from HA areas)
    const roomFloorId = {};
    for(const area of haAreas) roomFloorId[area.name] = area.floor_id || "";

    // Include ALL HA floors (not just those with discovered rooms)
    const sortedFloors = [...haFloors].sort((a,b) => (b.level||0) - (a.level||0));
    const floorOrder = [];
    for(const f of sortedFloors) floorOrder.push({ id: f.id, label: f.name || `Level ${f.level}` });

    // Also include all HA area names as potential rooms (even if not yet discovered)
    const allAreaNames = haAreas.map(a => a.name);
    const allRoomNames = new Set([...rooms, ...allAreaNames]);

    // Rooms without a floor
    const hasUnassigned = [...allRoomNames].some(r => !roomFloorId[r] || !sortedFloors.some(f => f.id === roomFloorId[r]));
    if(hasUnassigned) floorOrder.push({ id: "__none__", label: "Unassigned" });

    // Populate floor groups — include undiscovered rooms (count=0)
    const floorMap = new Map();
    for(const fo of floorOrder) floorMap.set(fo.id, []);
    for(const room of allRoomNames){
      const fid = roomFloorId[room] || "";
      const bucket = (fid && floorMap.has(fid)) ? fid : "__none__";
      if(!floorMap.has(bucket)) floorMap.set(bucket, []);
      const rc = ctx.helpers.roomColor(room);
      const count = objects.filter(o => o.room === room).length;
      floorMap.get(bucket).push({ room, color: rc, count });
    }

    const floorCard = el("div",{class:"card",style:"overflow:hidden"});
    floorCard.appendChild(el("div",{style:"display:flex;align-items:center;justify-content:space-between;margin-bottom:12px"},[
      el("div",{style:"font-weight:700"},"Floor Towers"),
      el("span",{class:"muted",style:"font-size:11px"}, `${allRoomNames.size} rooms \u00B7 ${sortedFloors.length} floor${sortedFloors.length!==1?"s":""}`),
    ]));

    // Inject glow keyframes
    if(!document.getElementById("padspan-glow-keyframes")){
      const st = document.createElement("style");
      st.id = "padspan-glow-keyframes";
      st.textContent = `@keyframes padspan-glow{0%,100%{filter:brightness(1)}50%{filter:brightness(1.3)}}`;
      document.head.appendChild(st);
    }

    // Tower layout: horizontal scroll, each floor is a fixed-width column
    const towerWrap = el("div",{style:"display:flex;gap:10px;align-items:flex-end;min-height:160px;padding-top:24px;overflow-x:auto;padding-bottom:4px"});

    // Calculate column width: fill available space, but guarantee room for text.
    // Budget is sized to the card's typical rendered width (.grid columns are
    // minmax(220px,1fr), minus card padding) rather than the card's max width,
    // so low floor-counts don't get an oversized column and overflow.
    const floorCount = floorOrder.length || 1;
    const colWidth = Math.max(120, Math.floor(200 / floorCount));

    for(const fo of floorOrder){
      const floorRooms = floorMap.get(fo.id) || [];
      // Sort: rooms with devices first (desc), then alphabetical
      floorRooms.sort((a,b) => (b.count - a.count) || a.room.localeCompare(b.room));

      const col = el("div",{style:`width:${colWidth}px;min-width:${colWidth}px;display:flex;flex-direction:column;align-items:stretch`});

      // Floor label
      col.appendChild(el("div",{style:`font-size:10px;font-weight:800;color:#e2e8f0;text-align:center;margin-bottom:4px;text-transform:uppercase;letter-spacing:.06em;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:${colWidth}px`}, fo.label));

      // Tower body
      const tower = el("div",{style:"border-radius:6px;overflow:hidden;border:1px solid #1e3a2a;background:#0a1a0f"});

      if(floorRooms.length === 0){
        tower.appendChild(el("div",{style:"height:40px;display:flex;align-items:center;justify-content:center;color:#253e2e;font-size:9px;font-style:italic"},"empty"));
      } else {
        for(let i = 0; i < floorRooms.length; i++){
          const r = floorRooms[i];
          const hasDevices = r.count > 0;
          const glowAnim = hasDevices ? "animation:padspan-glow 3s ease-in-out infinite;" : "";
          const dimStyle = hasDevices ? "" : "opacity:0.5;";

          const band = el("div",{style:`min-height:26px;padding:3px 6px;cursor:pointer;position:relative;background:linear-gradient(135deg, ${r.color}18 0%, ${r.color}35 100%);border-bottom:${i < floorRooms.length-1 ? `1px solid ${r.color}20` : "none"};display:flex;align-items:center;gap:4px;transition:all 0.2s ease;${glowAnim}${dimStyle}`.replace(/\s+/g," ")});

          // Left color accent bar
          band.appendChild(el("div",{style:`width:3px;align-self:stretch;background:${r.color};border-radius:2px;flex-shrink:0;opacity:0.7`}));

          // Room name — allow wrapping for long names
          band.appendChild(el("div",{style:`flex:1;min-width:0;font-size:10px;font-weight:600;color:${r.color};line-height:1.2;word-break:break-word`}, r.room));

          // Device count pips — small dots for 1-3, number for 4+
          if(r.count > 0 && r.count <= 3){
            const pips = el("div",{style:"display:flex;gap:2px;flex-shrink:0"});
            for(let p = 0; p < r.count; p++){
              pips.appendChild(el("div",{style:`width:5px;height:5px;border-radius:50%;background:${r.color};opacity:0.9`}));
            }
            band.appendChild(pips);
          } else if(r.count > 3){
            band.appendChild(el("div",{style:`font-size:10px;font-weight:800;color:${r.color};flex-shrink:0`}, String(r.count)));
          }

          // Hover glow effect
          band.addEventListener("mouseenter", ()=>{
            band.style.background = `linear-gradient(135deg, ${r.color}30 0%, ${r.color}50 100%)`;
            band.style.boxShadow = `inset 0 0 12px ${r.color}25, 0 0 8px ${r.color}15`;
            band.style.opacity = "1";
          });
          band.addEventListener("mouseleave", ()=>{
            band.style.background = `linear-gradient(135deg, ${r.color}18 0%, ${r.color}35 100%)`;
            band.style.boxShadow = "";
            band.style.opacity = hasDevices ? "1" : "0.5";
          });
          band.addEventListener("click", ()=> ctx.actions.showRoomDetail(r.room));
          tower.appendChild(band);
        }
      }

      col.appendChild(tower);

      // Floor device total at base
      const floorTotal = floorRooms.reduce((s,r)=>s+r.count, 0);
      col.appendChild(el("div",{style:"font-size:9px;color:#475569;text-align:center;margin-top:4px"}, floorTotal > 0 ? `${floorTotal} device${floorTotal!==1?"s":""}` : "\u00B7"));

      towerWrap.appendChild(col);
    }

    // Fallback: no floors at all → single tower with all rooms
    if(floorOrder.length === 0){
      const allRooms = rooms.map(room => ({
        room,
        color: ctx.helpers.roomColor(room),
        count: objects.filter(o=>o.room===room).length,
      }));
      const col = el("div",{style:"flex:1;min-width:120px;display:flex;flex-direction:column;align-items:stretch"});
      col.appendChild(el("div",{style:"font-size:10px;font-weight:800;color:#e2e8f0;text-align:center;margin-bottom:4px;text-transform:uppercase;letter-spacing:.06em"}, "All Rooms"));
      const tower = el("div",{style:"border-radius:6px;overflow:hidden;border:1px solid #1e3a2a;background:#0a1a0f"});
      for(let i = 0; i < allRooms.length; i++){
        const r = allRooms[i];
        const band = el("div",{style:`min-height:26px;padding:3px 6px;cursor:pointer;background:linear-gradient(135deg, ${r.color}18 0%, ${r.color}35 100%);border-bottom:${i < allRooms.length-1 ? `1px solid ${r.color}20` : "none"};display:flex;align-items:center;gap:4px`});
        band.appendChild(el("div",{style:`width:3px;align-self:stretch;background:${r.color};border-radius:2px;flex-shrink:0;opacity:0.7`}));
        band.appendChild(el("div",{style:`flex:1;min-width:0;font-size:10px;font-weight:600;color:${r.color};word-break:break-word`}, r.room));
        if(r.count > 0) band.appendChild(el("div",{style:`font-size:10px;font-weight:800;color:${r.color};flex-shrink:0`}, String(r.count)));
        band.addEventListener("click", ()=> ctx.actions.showRoomDetail(r.room));
        tower.appendChild(band);
      }
      col.appendChild(tower);
      towerWrap.appendChild(col);
    }

    floorCard.appendChild(towerWrap);
    grid.appendChild(floorCard);
  }

  // RSSI Distribution merged into State Inspector card above

  // ── Live Signal Bars ──────────────────────────────────────────────────────
  if(radios.length > 0){
    const scannerDevCounts = {};
    for(const ad of ads){
      const src = ad.source || "";
      scannerDevCounts[src] = (scannerDevCounts[src] || 0) + 1;
    }
    const maxDevs = Math.max(...Object.values(scannerDevCounts), 1);

    const barsCard = el("div",{class:"card"});
    barsCard.appendChild(el("div",{style:"font-weight:700;margin-bottom:8px"},"Live Signal Bars"));

    const barList = el("div",{style:"display:flex;flex-direction:column;gap:6px"});
    const sorted = [...radios].sort((a,b)=>(scannerDevCounts[b.source]||0)-(scannerDevCounts[a.source]||0));
    for(const radio of sorted){
      const count = scannerDevCounts[radio.source] || 0;
      const pct = Math.round((count / maxDevs) * 100);
      const row = el("div",{style:"display:flex;align-items:center;gap:8px;cursor:pointer;padding:2px 0;border-radius:3px"});
      row.addEventListener("mouseenter", ()=>{ row.style.background = "rgba(255,255,255,0.04)"; });
      row.addEventListener("mouseleave", ()=>{ row.style.background = ""; });
      row.addEventListener("click", ()=>ctx.actions.showScannerDetail(radio));
      const rsid = _sid(radio.source);
      row.appendChild(el("div",{style:"width:110px;font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex-shrink:0"}, [
        el("span",{style:"font-family:monospace;font-weight:700;letter-spacing:.04em;margin-right:4px"}, rsid),
        el("span",{class:"muted"}, radio.name || radio.source),
      ]));
      row.appendChild(el("div",{style:"flex:1;background:#1a2e1e;border-radius:3px;height:12px"}, [
        el("div",{style:`width:${pct}%;height:100%;background:#52b788;border-radius:3px;min-width:2px;transition:width 0.3s`}),
      ]));
      row.appendChild(el("div",{style:"width:30px;text-align:right;font-size:11px;font-weight:600"}, String(count)));
      barList.appendChild(row);
    }
    barsCard.appendChild(barList);
    grid.appendChild(barsCard);
  }

  // ── Signal Pulse (animated activity visualization) ─────────────────────────
  if(ads.length > 0 && rooms.length > 0){
    const pulseCard = el("div",{class:"card"});
    pulseCard.appendChild(el("div",{style:"font-weight:700;margin-bottom:8px"},"Signal Pulse"));
    pulseCard.appendChild(el("div",{class:"muted",style:"font-size:11px;margin-bottom:10px"},
      "Live room activity \u2014 ring size = device count, pulse = recent signal freshness."));

    const pulseWrap = el("div",{style:"display:flex;flex-wrap:wrap;gap:12px;justify-content:center;padding:8px 0"});

    // Build per-room stats
    const roomStats = [];
    for(const room of rooms){
      const devs = objects.filter(o=>o.room===room);
      const roomAds = ads.filter(a=> devs.some(d=> (d.address && a.address===d.address) || (d.entity_id && a.entity_id===d.entity_id)));
      const freshest = roomAds.reduce((best,a)=>{
        const age = a.age_s != null ? a.age_s : 999;
        return age < best ? age : best;
      }, 999);
      roomStats.push({ room, count: devs.length, freshest });
    }
    // Sort by count desc so active rooms are first
    roomStats.sort((a,b)=>b.count-a.count);

    const maxCount = Math.max(...roomStats.map(r=>r.count), 1);

    for(const rs of roomStats){
      const rc = ctx.helpers.roomColor(rs.room);
      const size = 24 + Math.round((rs.count / maxCount) * 36);
      const isFresh = rs.freshest < 30;
      const pulseAnim = isFresh && rs.count > 0
        ? `animation:padspan-pulse 2s ease-in-out infinite;`
        : "";

      const dot = el("div",{style:`
        display:flex;align-items:center;justify-content:center;flex-direction:column;
        width:${size}px;height:${size}px;border-radius:50%;
        background:${rc}22;border:2px solid ${rc}66;
        cursor:pointer;position:relative;${pulseAnim}
      `.replace(/\s+/g," ")});
      if(rs.count > 0){
        dot.appendChild(el("div",{style:`font-size:${size > 40 ? 14 : 11}px;font-weight:800;color:${rc}`}, String(rs.count)));
      }
      dot.title = `${rs.room}: ${rs.count} device${rs.count!==1?"s":""}`;
      dot.addEventListener("click", ()=>ctx.actions.showRoomDetail(rs.room));

      const wrap = el("div",{style:"display:flex;flex-direction:column;align-items:center;gap:2px"});
      wrap.appendChild(dot);
      wrap.appendChild(el("div",{style:`font-size:9px;color:${rc};max-width:${size+20}px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-align:center`}, rs.room));
      pulseWrap.appendChild(wrap);
    }

    pulseCard.appendChild(pulseWrap);

    // Inject keyframes if not already present
    if(!document.getElementById("padspan-pulse-keyframes")){
      const style = document.createElement("style");
      style.id = "padspan-pulse-keyframes";
      style.textContent = `@keyframes padspan-pulse { 0%,100%{transform:scale(1);opacity:1} 50%{transform:scale(1.12);opacity:.85} }`;
      document.head.appendChild(style);
    }
    grid.appendChild(pulseCard);
  }

  // ── Raw Snapshot Explorer ─────────────────────────────────────────────────
  const explorerCard = el("div",{class:"card"});
  explorerCard.appendChild(el("div",{style:"display:flex;align-items:center;justify-content:space-between;margin-bottom:8px"},[
    el("div",{style:"font-weight:700"},"Raw Snapshot Explorer"),
    el("span",{class:"muted",style:"font-size:11px"}, snap ? `${JSON.stringify(snap).length.toLocaleString()} bytes` : "no data"),
  ]));
  explorerCard.appendChild(el("div",{class:"muted",style:"font-size:11px;margin-bottom:10px"},
    "Browse the raw live snapshot data. Expand any key to inspect values."));

  if(snap){
    const topKeys = Object.keys(snap).sort();
    const treeWrap = el("div",{style:"font-family:monospace;font-size:11px;line-height:1.6;max-height:300px;overflow-y:auto"});

    for(const key of topKeys){
      const val = snap[key];
      const isExpandable = val !== null && typeof val === "object";
      const row = el("div",{style:"cursor:pointer;padding:2px 4px;border-radius:3px"});
      row.addEventListener("mouseenter", ()=>{ row.style.background = "rgba(255,255,255,0.04)"; });
      row.addEventListener("mouseleave", ()=>{ row.style.background = ""; });

      const arrow = el("span",{style:"display:inline-block;width:14px;color:#52b788;font-size:10px"},
        isExpandable ? "\u25B6" : "\u00B7");
      const keySpan = el("span",{style:"color:#52b788;font-weight:600"}, key);
      const preview = el("span",{class:"muted",style:"margin-left:6px"});

      if(!isExpandable){
        preview.textContent = val === null ? "null" : typeof val === "string" ? `"${val.slice(0,60)}"` : String(val);
      } else {
        const isArr = Array.isArray(val);
        preview.textContent = isArr ? `[ ${val.length} items ]` : `{ ${Object.keys(val).length} keys }`;
      }

      row.appendChild(arrow);
      row.appendChild(el("span",{}," "));
      row.appendChild(keySpan);
      row.appendChild(preview);

      const detail = el("div",{style:"display:none;margin-left:18px;padding:4px 8px;background:#0a1a0f;border-left:2px solid #253e2e;border-radius:0 4px 4px 0;margin-bottom:4px;max-height:200px;overflow:auto;white-space:pre-wrap;word-break:break-all;color:#94a3b8"});

      if(isExpandable){
        let loaded = false;
        row.addEventListener("click", ()=>{
          const showing = detail.style.display !== "none";
          detail.style.display = showing ? "none" : "";
          arrow.textContent = showing ? "\u25B6" : "\u25BC";
          if(!loaded){
            try {
              detail.textContent = JSON.stringify(val, null, 2);
            } catch(e){
              detail.textContent = "[circular or unserializable]";
            }
            loaded = true;
          }
        });
      }

      treeWrap.appendChild(row);
      if(isExpandable) treeWrap.appendChild(detail);
    }
    explorerCard.appendChild(treeWrap);
  } else {
    explorerCard.appendChild(el("div",{class:"muted",style:"font-size:12px"}, "No snapshot data available."));
  }

  // Copy button
  if(snap){
    const copyBtn = el("button",{class:"btn tiny",style:"margin-top:8px;font-size:11px"}, "Copy snapshot JSON");
    copyBtn.addEventListener("click", async ()=>{
      try {
        await navigator.clipboard.writeText(JSON.stringify(snap, null, 2));
        copyBtn.textContent = "Copied!";
        setTimeout(()=>{ copyBtn.textContent = "Copy snapshot JSON"; }, 2000);
      } catch(e){
        ctx.toast("Copy failed: " + String(e), true);
      }
    });
    explorerCard.appendChild(copyBtn);
  }
  grid.appendChild(explorerCard);

  root.appendChild(grid);
  return root;
}
