// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
// See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html

// ══════════════════════════════════════════════════════════════════════════════
// Manage View — Administration, data cleanup, entity management, and diagnostics
//
// Sub-tabs:
//   Data             — Danger-zone data management: orphan cleanup, label removal,
//                      entity/area deletion, map deletion, backup & restore,
//                      integration controls (reload, color reset)
//   HA Entities      — Entity reference docs, publishing toggles, live audit,
//                      automation YAML library, MQTT config
//   Beacon Chars     — Per-beacon signal profiles from calibration, model grouping
//   History          — Persisted room-transition log (backend movement_history store)
//   Events           — Session event log (in-memory), email alert configuration
//   Logs             — Live integration log viewer with level filtering
//   Factory Reset    — Nuclear option: wipes all PadSpan stores + browser caches
//
// The Data tab is gated by a `disabled` flag: destructive actions require
// Live mode. In Sample mode the buttons render but are disabled, and a
// warning banner tells the user to switch.
// ══════════════════════════════════════════════════════════════════════════════

export function render(ctx){
  const { el } = ctx.helpers;
  const root = el("section",{id:"manage"});
  root.className = ctx.state.view==="manage" ? "" : "hidden";

  // Default to the Data sub-tab on first visit
  if(!ctx.state.manageTab) ctx.state.manageTab = "data";
  const mTab = ctx.state.manageTab;
  const setTab = (t) => { ctx.state.manageTab = t; ctx.actions.renderRooms(); };

  const TABS = [
    ["data","Data"],
    ["ha_entities","HA Entities"],
    ["beacon_chars","Beacon Characteristics"],
    ["history","History"],
    ["events","Events"],
    ["logs","Logs"],
    ["factory_reset","Factory Reset"],
  ];

  const tabBar = el("div",{class:"tabs",style:"margin-bottom:12px;flex-wrap:wrap;gap:4px"});
  for(const [id,label] of TABS){
    tabBar.appendChild(el("button",{class:"tab"+(mTab===id?" active":""),onclick:()=>setTab(id)},label));
  }
  root.appendChild(tabBar);

  // Non-data tabs are rendered by dedicated helper functions and returned early
  if(mTab === "ha_entities")   { root.appendChild(_haEntities(ctx, el));    return root; }
  if(mTab === "beacon_chars")  { root.appendChild(_beaconChars(ctx, el));  return root; }
  if(mTab === "history")       { root.appendChild(_history(ctx, el));      return root; }
  if(mTab === "events")        { root.appendChild(_events(ctx, el));       return root; }
  if(mTab === "logs")          { root.appendChild(_logs(ctx, el));         return root; }
  if(mTab === "factory_reset") { root.appendChild(_factoryReset(ctx, el)); return root; }

  // ── Data Tab (default) ──────────────────────────────────────────────────────
  // Everything below builds the Data tab: orphan cleanup, labels, entities,
  // areas, maps, backup/restore, and integration controls.
  const snap     = (ctx.state.live && ctx.state.live.snapshot) || null;
  const haAreas  = (ctx.state.model && Array.isArray(ctx.state.model.areas))  ? ctx.state.model.areas  : [];
  const haFloors = (ctx.state.model && Array.isArray(ctx.state.model.floors)) ? ctx.state.model.floors : [];
  const dataMode = ctx.state.dataMode || "sample";

  // Danger zone banner — prominent red warning at top of the Data tab.
  // In sample mode, an extra line tells the user to switch to Live.
  root.appendChild(el("div",{style:"background:#3d0c0c;border:2px solid #dc2626;border-radius:12px;padding:16px"},[
    el("div",{style:"font-weight:800;font-size:15px;color:#fca5a5;margin-bottom:6px"},"⚠  Danger Zone — Read before proceeding"),
    el("div",{style:"font-size:13px;color:#fcd5d5;line-height:1.6"},
      "Actions here directly modify Home Assistant. Deleting areas, entities, or BLE labels cannot be undone. Only proceed if you understand what you are changing."
    ),
    dataMode !== "live"
      ? el("div",{style:"margin-top:10px;font-weight:700;color:#fbbf24"},"⚡ Switch to Live mode to enable management actions.")
      : null,
  ].filter(Boolean)));
  root.appendChild(ctx.helpers.helpBtn("manage_data"));

  // Master gate: all destructive buttons check this flag.
  // In sample mode, buttons render with "disabled" class + .disabled = true.
  const disabled = dataMode !== "live";

  // ── Orphan Room Polygons ──────────────────────────────────────────────────────
  // Orphans are room polygons stored in map.room_bounds whose room name no
  // longer exists in the HA area registry or roomTagMap. They typically come
  // from sample-mode demos that wrote polygons for rooms like "Kitchen" when
  // the real HA install has no such area. We detect them here and let the user
  // delete them individually or in bulk.
  {
    const allMaps = ctx.state.maps?.list || [];
    // Build a set of all room names the system currently recognises
    const validRooms = new Set([
      ...(ctx.state.model?.areas || []).map(a => a.name),
      ...Object.keys(ctx.state.roomTagMap || {}),
    ]);

    // Scan every map's room_bounds for polygon entries referencing unknown rooms
    const orphans = []; // {map, room, b}
    for(const m of allMaps){
      for(const [room, b] of Object.entries(m.room_bounds || {})){
        if(b && b.type === "poly" && !validRooms.has(room)){
          orphans.push({map: m, room, b});
        }
      }
    }

    if(orphans.length){
      const orphCard = el("div",{class:"card",style:"border-color:#f59e0b"});
      orphCard.appendChild(el("div",{class:"row",style:"margin-bottom:6px"},[
        el("div",{style:"font-weight:700;font-size:14px"},"Orphan Room Polygons"),
        el("span",{class:"badge warn",style:"margin-left:8px"},`${orphans.length} found`),
      ]));
      orphCard.appendChild(el("div",{style:"font-size:12px;color:#f59e0b;margin-bottom:10px"},
        "These room polygons are in your map data but the room name does not exist in your HA area registry. They are likely ghost entries from sample mode."
      ));

      const tbody = el("tbody");
      for(const {map, room, b} of orphans){
        const bw = el("div",{style:"display:flex;gap:4px"});
        // Each orphan row gets a Delete button that swaps to a Yes/No confirm
      // pattern (inline confirmation — no modal). On confirm, we rebuild the
      // map's room_bounds without the orphan key and push the whole map back
      // via mapsUpdate (the API expects the full room_bounds dict).
      const makeBtn = ()=>{
          const btn = el("button",{class:"btn tiny"+(disabled?" disabled":"")},"Delete");
          if(disabled) btn.disabled = true;
          btn.addEventListener("click", ()=>{
            bw.innerHTML = "";
            const yes = el("button",{class:"btn tiny",style:"background:#7f1d1d;border-color:#dc2626;white-space:nowrap"},"Yes, delete");
            const no  = el("button",{class:"btn tiny"},"No");
            yes.addEventListener("click", async()=>{
              bw.innerHTML = "";
              bw.appendChild(el("span",{class:"muted",style:"font-size:11px"},"Deleting…"));
              try {
                // Strip the orphan room from the bounds and re-save the entire map
                const newBounds = Object.fromEntries(
                  Object.entries(map.room_bounds || {}).filter(([r]) => r !== room)
                );
                await ctx.actions.mapsUpdate({
                  map_id: map.id,
                  receivers: map.receivers || [],
                  room_bounds: newBounds,
                  floor_id: map.floor_id || "",
                  calibration: map.calibration || {},
                  notes: map.notes || "",
                  // No `stack` key. Deleting an orphan room polygon is not a placement
                  // write, and round-tripping the CLIENT's copy of the stack lets a stale
                  // tab silently push back whatever it last saw - including a master flag
                  // another tab has since changed (issue #67). async_update_map only
                  // touches the stack when it is handed a dict, so omitting it preserves
                  // whatever the server holds.
                });
                await ctx.actions.mapsRefresh();
                ctx.toast(`Deleted orphan "${room}" from ${map.name||map.id}`);
                ctx.actions.renderRooms();
              } catch(e){ bw.innerHTML = ""; bw.appendChild(makeBtn()); ctx.toast("Failed: "+String(e), true); }
            });
            no.addEventListener("click", ()=>{ bw.innerHTML = ""; bw.appendChild(makeBtn()); });
            bw.appendChild(yes); bw.appendChild(no);
          });
          return btn;
        };
        bw.appendChild(makeBtn());
        tbody.appendChild(el("tr",{},[
          el("td",{style:"font-weight:600;color:#f59e0b"},room),
          el("td",{class:"muted",style:"font-size:11px"},map.name||map.id),
          el("td",{class:"muted",style:"font-size:11px"},`${(b.points||[]).length} pts`),
          el("td",{},bw),
        ]));
      }
      orphCard.appendChild(el("table",{class:"table"},[
        el("thead",{},el("tr",{},[el("th",{},"Orphan room"),el("th",{},"Map"),el("th",{},"Points"),el("th",{},"")])),
        tbody,
      ]));

      // Bulk delete: only shown when >1 orphan. Groups orphans by map to
    // minimise API calls — one mapsUpdate per affected map.
    if(orphans.length > 1){
        const delAllWrap = el("div",{style:"margin-top:10px;display:flex;gap:8px;align-items:center"});
        const makeDelAll = ()=>{
          const b = el("button",{class:"btn"+(disabled?" disabled":"")},"Delete ALL orphans");
          if(disabled) b.disabled = true;
          b.addEventListener("click", ()=>{
            delAllWrap.innerHTML = "";
            const yes = el("button",{class:"btn",style:"background:#7f1d1d;border-color:#dc2626"},`Yes, delete all ${orphans.length}`);
            const no  = el("button",{class:"btn inline"},"Cancel");
            yes.addEventListener("click", async()=>{
              delAllWrap.innerHTML = "";
              delAllWrap.appendChild(el("span",{class:"muted",style:"font-size:12px"},"Cleaning up…"));
              // Group by map so we do one update per map
              const byMap = new Map();
              for(const {map, room} of orphans){
                if(!byMap.has(map.id)) byMap.set(map.id, {map, rooms: []});
                byMap.get(map.id).rooms.push(room);
              }
              let fail = 0;
              for(const {map, rooms} of byMap.values()){
                try {
                  const newBounds = Object.fromEntries(
                    Object.entries(map.room_bounds || {}).filter(([r]) => !rooms.includes(r))
                  );
                  await ctx.actions.mapsUpdate({
                    map_id: map.id,
                    receivers: map.receivers || [],
                    room_bounds: newBounds,
                    floor_id: map.floor_id || "",
                    calibration: map.calibration || {},
                    notes: map.notes || "",
                    // No `stack` key. Deleting an orphan room polygon is not a placement
                    // write, and round-tripping the CLIENT's copy of the stack lets a stale
                    // tab silently push back whatever it last saw - including a master flag
                    // another tab has since changed (issue #67). async_update_map only
                    // touches the stack when it is handed a dict, so omitting it preserves
                    // whatever the server holds.
                  });
                } catch(e){ fail++; }
              }
              await ctx.actions.mapsRefresh();
              ctx.toast(`Removed ${orphans.length} orphan polygon${orphans.length===1?"":"s"}${fail?` (${fail} maps failed)`:""}.`);
              ctx.actions.renderRooms();
            });
            no.addEventListener("click", ()=>{ delAllWrap.innerHTML = ""; delAllWrap.appendChild(makeDelAll()); });
            delAllWrap.appendChild(yes); delAllWrap.appendChild(no);
          });
          return b;
        };
        delAllWrap.appendChild(makeDelAll());
        orphCard.appendChild(delAllWrap);
      }

      root.appendChild(orphCard);
    }
  }

  // ── BLE Device Labels ────────────────────────────────────────────────────────
  // Shows tagged BLE devices and lets the user remove ("untag") friendly names.
  // Removing a label does NOT delete the device from the snapshot — it just
  // reverts to showing the raw MAC address.
  const allObjs   = snap?.objects?.list || [];
  const taggedObjs = allObjs.filter(o => o.kind === "ble" && o.user_label);
  const tagsCard  = el("div",{class:"card"});
  tagsCard.appendChild(el("div",{class:"row",style:"margin-bottom:8px"},[
    el("div",{style:"font-weight:700;font-size:14px"},"BLE Device Labels"),
    el("span",{class:"badge",style:"margin-left:8px"},`${taggedObjs.length} tagged`),
  ]));
  tagsCard.appendChild(el("div",{class:"muted",style:"font-size:12px;margin-bottom:10px"},
    "Remove user-assigned labels from BLE devices. The device stays in the snapshot — it just loses its friendly name."
  ));
  if(taggedObjs.length){
    const tbody = el("tbody");
    for(const o of taggedObjs){
      const addr = o.address || "";
      const ageTxt = o.age_s != null ? `${Math.round(o.age_s)}s ago` : "—";
      const untagBtnWrap = el("div",{style:"display:flex;gap:4px"});
      const makeUntagBtn = ()=>{
        const b = el("button",{class:"btn tiny"+(disabled?" disabled":"")}, "Untag");
        if(disabled) b.disabled = true;
        b.addEventListener("click", ()=>{
          untagBtnWrap.innerHTML = "";
          const yes = el("button",{class:"btn tiny",style:"background:#7f1d1d;border-color:#dc2626"},"Yes");
          const no  = el("button",{class:"btn tiny"},"No");
          yes.addEventListener("click", async()=>{
            untagBtnWrap.innerHTML = "";
            try {
              await ctx.actions.objectLabelDelete(addr);
              ctx.toast("Label removed.");
              await ctx.actions.refreshSnapshot();
              ctx.actions.renderRooms();
            } catch(e){ ctx.toast("Failed: "+String(e), true); untagBtnWrap.appendChild(makeUntagBtn()); }
          });
          no.addEventListener("click", ()=>{ untagBtnWrap.innerHTML = ""; untagBtnWrap.appendChild(makeUntagBtn()); });
          untagBtnWrap.appendChild(yes); untagBtnWrap.appendChild(no);
        });
        return b;
      };
      untagBtnWrap.appendChild(makeUntagBtn());
      tbody.appendChild(el("tr",{},[
        el("td",{style:"font-family:monospace;font-size:11px"},addr),
        el("td",{style:"font-weight:600"},o.user_label),
        el("td",{class:"muted",style:"font-size:11px"},ageTxt),
        el("td",{},untagBtnWrap),
      ]));
    }
    const clearAllWrap = el("div",{style:"margin-top:10px;display:flex;gap:8px;align-items:center"});
    const makeClearAllBtn = ()=>{
      const b = el("button",{class:"btn"+(disabled?" disabled":"")},"Remove all labels");
      if(disabled) b.disabled = true;
      b.addEventListener("click", ()=>{
        clearAllWrap.innerHTML = "";
        const yes = el("button",{class:"btn",style:"background:#7f1d1d;border-color:#dc2626"},`Yes, remove all ${taggedObjs.length}`);
        const no  = el("button",{class:"btn inline"},"Cancel");
        yes.addEventListener("click", async()=>{
          clearAllWrap.innerHTML = "";
          let ok=0, fail=0;
          for(const o of taggedObjs){ try { await ctx.actions.objectLabelDelete(o.address); ok++; } catch(e){ fail++; } }
          ctx.toast(`Removed ${ok} labels${fail?` (${fail} failed)`:""}.`);
          await ctx.actions.refreshSnapshot();
          ctx.actions.renderRooms();
        });
        no.addEventListener("click", ()=>{ clearAllWrap.innerHTML = ""; clearAllWrap.appendChild(makeClearAllBtn()); });
        clearAllWrap.appendChild(yes); clearAllWrap.appendChild(no);
      });
      return b;
    };
    clearAllWrap.appendChild(makeClearAllBtn());
    tagsCard.appendChild(el("table",{class:"table"},[
      el("thead",{},el("tr",{},[el("th",{},"Address"),el("th",{},"Label"),el("th",{},"Last seen"),el("th",{},"")])),
      tbody,
    ]));
    tagsCard.appendChild(clearAllWrap);
  } else {
    tagsCard.appendChild(el("div",{class:"muted",style:"font-size:12px"},"No BLE devices have been tagged yet."));
  }
  root.appendChild(tagsCard);

  // ── HA Entities (Data tab section) ──────────────────────────────────────────
  // Two categories:
  //   Phantom — entity IDs in PadSpan's room_tag_map that no longer exist in HA
  //             (leftover sample data or stale installs). Safe to purge.
  //   Real    — actual HA entities. Deleting them removes from the HA registry.
  const entityObjs = allObjs.filter(o => o.kind === "entity" && o.entity_id);
  const phantomObjs = entityObjs.filter(o => o.missing === true);
  const realObjs    = entityObjs.filter(o => !o.missing);
  // Phantom entities card — purges stale room_tag_map entries via WS call
  if(phantomObjs.length){
    const phantomCard = el("div",{class:"card",style:"border-color:#f59e0b"});
    phantomCard.appendChild(el("div",{class:"row",style:"margin-bottom:6px"},[
      el("div",{style:"font-weight:700;font-size:14px"},"Phantom Room Entries"),
      el("span",{class:"badge warn",style:"margin-left:8px"},`${phantomObjs.length} found`),
    ]));
    phantomCard.appendChild(el("div",{style:"font-size:12px;color:#f59e0b;margin-bottom:4px"},
      "These entity IDs appear in PadSpan's room map but do not exist in Home Assistant. They are typically leftover sample data or stale entries from a previous install."
    ));
    phantomCard.appendChild(el("div",{style:"font-size:11px;color:#78909c;margin-bottom:10px;padding:6px 8px;background:#0a150e;border-radius:6px;border:1px solid #2a1f00"},
      "Removing them clears the phantom entries from PadSpan's room tracking — no HA entities are modified or deleted."
    ));

    const phantomList = el("div",{style:"display:flex;flex-direction:column;gap:3px;max-height:200px;overflow-y:auto;margin-bottom:10px"});
    for(const o of phantomObjs){
      phantomList.appendChild(el("div",{style:"display:flex;align-items:center;gap:6px;padding:4px 8px;background:#0a150e;border:1px solid #2a1f00;border-radius:6px"},[
        el("span",{style:"font-family:monospace;font-size:11px;color:#94a3b8;flex:1"},o.entity_id),
        o.room ? el("span",{style:"font-size:11px;color:#f59e0b"},o.room) : null,
      ].filter(Boolean)));
    }
    phantomCard.appendChild(phantomList);

    const purgeWrap = el("div",{style:"display:flex;gap:8px;align-items:center"});
    const makePurgeBtn = ()=>{
      const b = el("button",{class:"btn"+(disabled?" disabled":"")},"Clear phantom room data");
      if(disabled) b.disabled = true;
      b.addEventListener("click", ()=>{
        purgeWrap.innerHTML = "";
        const yes = el("button",{class:"btn",style:"background:#7f1d1d;border-color:#dc2626;white-space:nowrap"},`Yes, remove ${phantomObjs.length} phantom entr${phantomObjs.length===1?"y":"ies"}`);
        const no  = el("button",{class:"btn inline"},"Cancel");
        yes.addEventListener("click", async()=>{
          purgeWrap.innerHTML = "";
          purgeWrap.appendChild(el("span",{class:"muted",style:"font-size:12px"},"Clearing…"));
          try {
            const result = await ctx.actions.roomTagPurgeMissing();
            await ctx.actions.refreshSnapshot();
            ctx.toast(`Cleared ${result?.removed ?? phantomObjs.length} phantom entr${(result?.removed??0)===1?"y":"ies"} from room map.`);
            ctx.actions.renderRooms();
          } catch(e){
            ctx.toast("Failed: "+String(e), true);
            purgeWrap.innerHTML = ""; purgeWrap.appendChild(makePurgeBtn());
          }
        });
        no.addEventListener("click", ()=>{ purgeWrap.innerHTML = ""; purgeWrap.appendChild(makePurgeBtn()); });
        purgeWrap.appendChild(yes); purgeWrap.appendChild(no);
      });
      return b;
    };
    purgeWrap.appendChild(makePurgeBtn());
    phantomCard.appendChild(purgeWrap);
    root.appendChild(phantomCard);
  }

  // Real HA entities card — per-entity delete from the HA entity registry.
  // Entities from active integrations (e.g. Bermuda) will be recreated
  // on the next poll, so the user is warned about that.
  const entCard = el("div",{class:"card"});
  entCard.appendChild(el("div",{class:"row",style:"margin-bottom:8px"},[
    el("div",{style:"font-weight:700;font-size:14px"},"HA Entities"),
    el("span",{class:"badge warn",style:"margin-left:8px"},"Destructive"),
    el("span",{class:"badge",style:"margin-left:4px"},`${realObjs.length} found`),
  ]));
  entCard.appendChild(el("div",{class:"muted",style:"font-size:12px;margin-bottom:4px"},
    "Permanently remove entities from Home Assistant's entity registry. Use this to clean up stale or duplicate tracker entities. Automations that reference removed entities will break."
  ));
  entCard.appendChild(el("div",{style:"font-size:11px;color:#78909c;margin-bottom:10px;padding:6px 8px;background:#0a150e;border-radius:6px;border:1px solid #1b3526"},
    "⚠ Entities managed by active integrations (e.g. Bermuda) will be recreated on the next integration poll. To remove permanently, disable the device or integration in HA."
  ));
  if(realObjs.length){
    const entSearch = el("input",{type:"text",placeholder:"Filter entities…",style:"margin-bottom:8px;width:100%;box-sizing:border-box"});
    const entList   = el("div",{style:"display:flex;flex-direction:column;gap:4px;max-height:360px;overflow-y:auto"});
    const renderEntList = (filter) => {
      entList.innerHTML = "";
      const filtered = realObjs.filter(o => !filter || o.entity_id.toLowerCase().includes(filter.toLowerCase()) || (o.name||"").toLowerCase().includes(filter.toLowerCase()));
      for(const o of filtered){
        let row;
        const statusDiv = el("div",{style:"font-size:10px;margin-top:2px;display:none"});
        const btnWrap = el("div",{style:"display:flex;gap:4px;align-items:center;flex-shrink:0"});

        const doDelete = async ()=>{
          btnWrap.innerHTML = "";
          btnWrap.appendChild(el("span",{class:"muted",style:"font-size:11px"},"Deleting…"));
          try {
            await ctx.actions.entityDelete(o.entity_id);
            if(row){ row.style.opacity = "0.35"; row.style.transition = "opacity 0.4s"; }
            statusDiv.textContent = "✓ Removed from HA registry";
            statusDiv.style.color = "#52b788";
            statusDiv.style.display = "";
            btnWrap.innerHTML = "";
            ctx.toast(`Deleted: ${o.entity_id}`);
            ctx.actions.refreshSnapshot().then(()=>ctx.actions.renderRooms()).catch(()=>{});
          } catch(e){
            statusDiv.textContent = "✗ " + String(e).slice(0,80);
            statusDiv.style.color = "#f59e0b";
            statusDiv.style.display = "";
            btnWrap.innerHTML = "";
            btnWrap.appendChild(makeDelBtn());
            ctx.toast(`Delete failed: ${o.entity_id}`, true);
          }
        };

        const makeDelBtn = ()=>{
          const btn = el("button",{class:"btn tiny"+(disabled?" disabled":"")},"Delete");
          if(disabled) btn.disabled = true;
          btn.addEventListener("click", ()=>{
            btnWrap.innerHTML = "";
            const yesBtn = el("button",{class:"btn tiny",style:"background:#7f1d1d;border-color:#dc2626;white-space:nowrap"},"Yes, delete");
            const noBtn  = el("button",{class:"btn tiny"},"Cancel");
            yesBtn.addEventListener("click", doDelete);
            noBtn.addEventListener("click", ()=>{ btnWrap.innerHTML = ""; btnWrap.appendChild(makeDelBtn()); });
            btnWrap.appendChild(yesBtn);
            btnWrap.appendChild(noBtn);
          });
          return btn;
        };
        btnWrap.appendChild(makeDelBtn());

        row = el("div",{style:"display:flex;align-items:center;gap:8px;padding:6px 8px;border:1px solid #1b3526;border-radius:8px;background:#0a150e"},[
          el("div",{style:"flex:1;min-width:0"},[
            el("div",{style:"font-size:12px;font-family:monospace;color:#94a3b8;overflow:hidden;text-overflow:ellipsis;white-space:nowrap"},o.entity_id),
            o.name ? el("div",{style:"font-size:11px;color:#e2e8f0"},o.name) : null,
            o.room ? el("div",{style:"font-size:11px;color:#52b788"},`room: ${o.room}`) : null,
            statusDiv,
          ].filter(Boolean)),
          btnWrap,
        ]);
        entList.appendChild(row);
      }
      if(!filtered.length) entList.appendChild(el("div",{class:"muted",style:"font-size:12px"},"No entities match."));
    };
    entSearch.addEventListener("input",()=>renderEntList(entSearch.value));
    renderEntList("");
    entCard.appendChild(entSearch);
    entCard.appendChild(entList);
  } else {
    entCard.appendChild(el("div",{class:"muted",style:"font-size:12px"},"No HA entities found in snapshot. Switch to Live mode to see real entities."));
  }
  root.appendChild(entCard);

  // ── HA Areas (Rooms) ─────────────────────────────────────────────────────────
  // Deletes areas from HA's Area Registry. Devices assigned to a deleted area
  // become unassigned. Any PadSpan room_meta (custom colors) for that area is
  // also lost. HA is the source of truth for areas — PadSpan just reads them.
  const areasCard = el("div",{class:"card"});
  areasCard.appendChild(el("div",{class:"row",style:"margin-bottom:8px"},[
    el("div",{style:"font-weight:700;font-size:14px"},"HA Areas (Rooms)"),
    el("span",{class:"badge warn",style:"margin-left:8px"},"Destructive"),
    el("span",{class:"badge",style:"margin-left:4px"},`${haAreas.length} areas`),
  ]));
  areasCard.appendChild(el("div",{class:"muted",style:"font-size:12px;margin-bottom:10px"},
    "Delete areas from the HA Area Registry. All devices assigned to a deleted area will become unassigned. Room color settings for the area are also removed."
  ));
  if(haAreas.length){
    const tbody = el("tbody");
    for(const area of haAreas){
      const floor = haFloors.find(f=>f.id===area.floor_id);
      const floorLabel = floor ? floor.name : (area.floor_id||"—");
      const areaBtnWrap = el("div",{style:"display:flex;gap:4px"});
      const makeAreaDelBtn = ()=>{
        const b = el("button",{class:"btn tiny"+(disabled?" disabled":"")},"Delete");
        if(disabled) b.disabled = true;
        b.addEventListener("click", ()=>{
          areaBtnWrap.innerHTML = "";
          const yes = el("button",{class:"btn tiny",style:"background:#7f1d1d;border-color:#dc2626;white-space:nowrap"},"Yes, delete");
          const no  = el("button",{class:"btn tiny"},"No");
          yes.addEventListener("click", async()=>{
            areaBtnWrap.innerHTML = "";
            areaBtnWrap.appendChild(el("span",{class:"muted",style:"font-size:11px"},"Deleting…"));
            try {
              await ctx.actions.areaDelete(area.id);
              await ctx.actions.modelRefresh();
              ctx.toast(`Area "${area.name}" deleted.`);
              ctx.actions.renderRooms();
            } catch(e){ areaBtnWrap.innerHTML = ""; areaBtnWrap.appendChild(makeAreaDelBtn()); ctx.toast("Failed: "+String(e), true); }
          });
          no.addEventListener("click", ()=>{ areaBtnWrap.innerHTML = ""; areaBtnWrap.appendChild(makeAreaDelBtn()); });
          areaBtnWrap.appendChild(yes); areaBtnWrap.appendChild(no);
        });
        return b;
      };
      areaBtnWrap.appendChild(makeAreaDelBtn());
      tbody.appendChild(el("tr",{},[
        el("td",{style:"font-weight:600"},area.name),
        el("td",{class:"muted"},floorLabel),
        el("td",{style:"font-family:monospace;font-size:10px;color:#4a5568"},area.id),
        el("td",{},areaBtnWrap),
      ]));
    }
    areasCard.appendChild(el("table",{class:"table"},[
      el("thead",{},el("tr",{},[el("th",{},"Name"),el("th",{},"Floor"),el("th",{},"ID"),el("th",{},"")])),
      tbody,
    ]));
  } else {
    areasCard.appendChild(el("div",{class:"muted",style:"font-size:12px"},"No areas found."));
  }
  root.appendChild(areasCard);

  // ── Uploaded Maps ────────────────────────────────────────────────────────────
  // Permanently deletes floor plan images. Calibration data and room polygons
  // referencing the map will become orphaned (see Orphan Polygons above).
  const maps = ctx.state.maps?.list || [];
  if(maps.length){
    const mapsCard = el("div",{class:"card"});
    mapsCard.appendChild(el("div",{class:"row",style:"margin-bottom:8px"},[
      el("div",{style:"font-weight:700;font-size:14px"},"Uploaded Maps"),
      el("span",{class:"badge warn",style:"margin-left:8px"},"Destructive"),
      el("span",{class:"badge",style:"margin-left:4px"},`${maps.length} maps`),
    ]));
    mapsCard.appendChild(el("div",{class:"muted",style:"font-size:12px;margin-bottom:10px"},"Permanently delete uploaded floor plan images."));
    const tbody = el("tbody");
    for(const m of maps){
      const mapBtnWrap = el("div",{style:"display:flex;gap:4px"});
      const makeMapDelBtn = ()=>{
        const b = el("button",{class:"btn tiny"+(disabled?" disabled":"")},"Delete");
        if(disabled) b.disabled = true;
        b.addEventListener("click", ()=>{
          mapBtnWrap.innerHTML = "";
          const yes = el("button",{class:"btn tiny",style:"background:#7f1d1d;border-color:#dc2626;white-space:nowrap"},"Yes, delete");
          const no  = el("button",{class:"btn tiny"},"No");
          yes.addEventListener("click", async()=>{
            mapBtnWrap.innerHTML = "";
            try { await ctx.actions.mapsDelete(m.id); ctx.toast(`Map "${m.name}" deleted.`); }
            catch(e){ mapBtnWrap.appendChild(makeMapDelBtn()); ctx.toast("Failed: "+String(e), true); }
          });
          no.addEventListener("click", ()=>{ mapBtnWrap.innerHTML = ""; mapBtnWrap.appendChild(makeMapDelBtn()); });
          mapBtnWrap.appendChild(yes); mapBtnWrap.appendChild(no);
        });
        return b;
      };
      mapBtnWrap.appendChild(makeMapDelBtn());
      tbody.appendChild(el("tr",{},[
        el("td",{style:"font-weight:600"},m.name||m.id),
        el("td",{class:"muted",style:"font-size:11px"},m.image?.filename||""),
        el("td",{},mapBtnWrap),
      ]));
    }
    mapsCard.appendChild(el("table",{class:"table"},[
      el("thead",{},el("tr",{},[el("th",{},"Name"),el("th",{},"File"),el("th",{},"")])),
      tbody,
    ]));
    root.appendChild(mapsCard);
  }

  // ── Backup & Restore ────────────────────────────────────────────────────────
  // Flow: Create → List → Restore (selective) → Delete
  //
  // Create:  Calls store_backup_create, which snapshots all PadSpan .storage
  //          JSON files + map image binaries into a timestamped backup.
  // List:    store_backup_list returns metadata (store_keys, map_image_count).
  //          Displayed newest-first.
  // Restore: Opens an inline checkbox dialog letting the user pick which
  //          stores and/or map images to restore. Uses store_backup_restore
  //          with a store_keys whitelist + optional restore_map_images flag.
  // Delete:  store_backup_delete removes a single backup from disk.
  //
  // The checkbox dialog avoids the all-or-nothing problem: users can restore
  // just calibration data without overwriting their settings, for example.
  {
    const bkCard = el("div",{class:"card"});
    bkCard.appendChild(el("div",{style:"font-weight:700;font-size:14px;margin-bottom:4px"},"Backup & Restore"));
    bkCard.appendChild(el("div",{class:"muted",style:"font-size:12px;margin-bottom:14px"},
      "Create snapshots of all PadSpan™ data stores and map images. Restore selectively."
    ));

    const bkListWrap = el("div",{style:"margin-bottom:12px"});
    bkCard.appendChild(bkListWrap);

    // Friendly display names for internal store key strings.
    // These appear as checkbox labels in the selective-restore dialog.
    const _storeLabel = (k) => {
      const map = {
        "padspan_ha.settings": "Settings",
        "padspan_ha.calibration": "Calibration",
        "padspan_ha.adaptive": "Adaptive Model",
        "padspan_ha.objects": "Objects",
        "padspan_ha.maps": "Maps Config",
        "padspan_ha.model": "Model",
        "padspan_ha.follow_alerts": "Alerts",
        "padspan_ha.movement_history": "Movement",
        "padspan_ha.traceback": "Traceback",
        "padspan_ha.object_history": "Object History",
      };
      return map[k] || k.replace("padspan_ha.", "");
    };

    // Async-render the backup list into bkListWrap. Called on initial render
    // and after create/delete to refresh the displayed list.
    const _renderBkList = async () => {
      bkListWrap.innerHTML = "";
      try {
        const res = await ctx.actions.wsCall("padspan_ha/store_backup_list");
        const backups = res?.backups || [];
        if(!backups.length){
          bkListWrap.appendChild(el("div",{class:"muted",style:"font-size:12px"},"No backups yet."));
          return;
        }
        for(const bk of backups.reverse()){
          const bkRow = el("div",{style:"padding:10px 12px;border:1px solid #333;border-radius:8px;margin-bottom:8px;background:#0d1117"});
          const hdr = el("div",{style:"display:flex;justify-content:space-between;align-items:center;margin-bottom:4px"});
          hdr.appendChild(el("div",{style:"font-weight:600;font-size:13px"},
            (bk.note || "Backup") + (bk.version ? ` — v${bk.version}` : "")));
          hdr.appendChild(el("div",{class:"muted",style:"font-size:11px"},
            new Date(bk.created_at).toLocaleString()));
          bkRow.appendChild(hdr);
          bkRow.appendChild(el("div",{class:"muted",style:"font-size:11px;margin-bottom:8px"},
            `${bk.store_count} stores` + (bk.map_image_count ? `, ${bk.map_image_count} map images` : "")));

          // Action buttons row
          const actRow = el("div",{style:"display:flex;gap:8px;align-items:center;flex-wrap:wrap"});

          // Restore button — opens an inline selective-restore dialog.
          // Each store key from the backup gets a checkbox (pre-checked).
          // Map images get a separate checkbox if the backup includes any.
          // "Select all / none" convenience buttons are provided.
          const restoreWrap = el("div",{style:"display:flex;gap:8px;align-items:center;flex-wrap:wrap"});
          const makeRestoreBtn = () => {
            const btn = el("button",{class:"btn tiny"+(disabled?" disabled":"")}, "Restore…");
            if(disabled) btn.disabled = true;
            btn.addEventListener("click", () => {
              restoreWrap.innerHTML = "";
              const dialog = el("div",{style:"padding:10px 12px;border:1px solid #1e4976;border-radius:8px;background:#0a1a2a;margin-top:6px"});
              dialog.appendChild(el("div",{style:"font-weight:600;font-size:12px;margin-bottom:8px;color:#7dd3fc"},"Choose items to restore:"));
              const checkboxes = [];
              const storeKeys = bk.store_keys || [];
              for(const sk of storeKeys){
                const lbl = el("label",{style:"display:flex;align-items:center;gap:6px;font-size:12px;margin-bottom:4px;cursor:pointer"});
                const cb = document.createElement("input");
                cb.type = "checkbox"; cb.checked = true; cb.value = sk;
                cb.style.cssText = "width:14px;height:14px;accent-color:#52b788;cursor:pointer";
                lbl.appendChild(cb);
                lbl.appendChild(document.createTextNode(_storeLabel(sk)));
                dialog.appendChild(lbl);
                checkboxes.push(cb);
              }
              // ── Maps and Model move together ──────────────────────────
              // A map's picture and stack are in Maps; where that map SITS,
              // in metres, is in Model (`map_transforms`, keyed by map id),
              // and so is the world gauge that gives its stack a size. They
              // are one fact in two files, so ticking either ticks both:
              // restoring one alone pairs every map with a placement that
              // belongs to a different set of maps.
              //
              // The backend refuses the mismatched selection outright — see
              // ws_backup.ws_store_backup_restore — because the panel is not
              // the only caller of a websocket command. This is so the owner
              // never has to meet that refusal.
              {
                const _pair = checkboxes.filter(
                  c => c.value === "padspan_ha.maps" || c.value === "padspan_ha.model");
                if(_pair.length === 2){
                  for(const c of _pair){
                    c.addEventListener("change", () => {
                      for(const o of _pair) o.checked = c.checked;
                    });
                    c.title = "Maps and Model are restored together — a map's "
                            + "placement in metres lives in Model, keyed by map id.";
                  }
                }
              }
              // Map images checkbox
              if(bk.map_image_count > 0){
                const lbl = el("label",{style:"display:flex;align-items:center;gap:6px;font-size:12px;margin-bottom:4px;cursor:pointer"});
                const cb = document.createElement("input");
                cb.type = "checkbox"; cb.checked = true; cb.value = "__map_images__";
                cb.style.cssText = "width:14px;height:14px;accent-color:#52b788;cursor:pointer";
                lbl.appendChild(cb);
                lbl.appendChild(document.createTextNode(`Map Images (${bk.map_image_count} files)`));
                dialog.appendChild(lbl);
                checkboxes.push(cb);
              }
              // Select all / none
              const selRow = el("div",{style:"display:flex;gap:8px;margin:8px 0 4px"});
              selRow.appendChild(el("button",{class:"btn tiny",style:"font-size:10px", onclick:()=>{ checkboxes.forEach(c=>c.checked=true); }},"Select all"));
              selRow.appendChild(el("button",{class:"btn tiny",style:"font-size:10px", onclick:()=>{ checkboxes.forEach(c=>c.checked=false); }},"Select none"));
              dialog.appendChild(selRow);
              // Confirm / cancel
              const btnRow = el("div",{style:"display:flex;gap:8px;margin-top:10px"});
              const confirmBtn = el("button",{class:"btn",style:"background:#1b4a2e;border-color:#52b788;font-size:12px"},"Restore selected");
              confirmBtn.addEventListener("click", async()=>{
                // Split selections: real store keys vs the synthetic __map_images__ key
                const selected = checkboxes.filter(c=>c.checked).map(c=>c.value);
                const storeKeysToRestore = selected.filter(s=>s!=="__map_images__");
                const restoreImages = selected.includes("__map_images__");
                if(!storeKeysToRestore.length && !restoreImages){
                  ctx.toast("Nothing selected to restore.", true);
                  return;
                }
                confirmBtn.disabled = true; confirmBtn.textContent = "Restoring…";
                try {
                  const payload = { backup_id: bk.id };
                  if(storeKeysToRestore.length) payload.store_keys = storeKeysToRestore;
                  else payload.store_keys = [];
                  if(restoreImages) payload.restore_map_images = true;
                  const r = await ctx.actions.wsCall("padspan_ha/store_backup_restore", payload);
                  ctx.toast(`Restored ${r.restored} store(s)` + (r.images_restored ? ` + ${r.images_restored} map image(s)` : "") + ". Reload integration for full effect.");
                  restoreWrap.innerHTML = ""; restoreWrap.appendChild(makeRestoreBtn());
                } catch(e){
                  ctx.toast("Restore failed: "+String(e), true);
                  restoreWrap.innerHTML = ""; restoreWrap.appendChild(makeRestoreBtn());
                }
              });
              btnRow.appendChild(confirmBtn);
              btnRow.appendChild(el("button",{class:"btn inline",style:"font-size:12px", onclick:()=>{
                restoreWrap.innerHTML = ""; restoreWrap.appendChild(makeRestoreBtn());
              }},"Cancel"));
              dialog.appendChild(btnRow);
              restoreWrap.appendChild(dialog);
            });
            return btn;
          };
          restoreWrap.appendChild(makeRestoreBtn());
          actRow.appendChild(restoreWrap);

          // Delete button
          const delWrap = el("div",{style:"display:flex;gap:8px;align-items:center"});
          const makeDelBtn = () => {
            const btn = el("button",{class:"btn tiny",style:"color:#f87171;border-color:#7f1d1d"+(disabled?" ;opacity:0.4":"")}, "Delete");
            if(disabled) btn.disabled = true;
            btn.addEventListener("click", () => {
              delWrap.innerHTML = "";
              const yes = el("button",{class:"btn tiny",style:"background:#7f1d1d;border-color:#dc2626"},"Yes, delete");
              const no = el("button",{class:"btn tiny"},"No");
              yes.addEventListener("click", async()=>{
                delWrap.innerHTML = "";
                try {
                  await ctx.actions.wsCall("padspan_ha/store_backup_delete", {backup_id: bk.id});
                  ctx.toast("Backup deleted.");
                  _renderBkList();
                } catch(e){ ctx.toast("Delete failed: "+String(e), true); delWrap.innerHTML=""; delWrap.appendChild(makeDelBtn()); }
              });
              no.addEventListener("click", ()=>{ delWrap.innerHTML=""; delWrap.appendChild(makeDelBtn()); });
              delWrap.appendChild(yes); delWrap.appendChild(no);
            });
            return btn;
          };
          delWrap.appendChild(makeDelBtn());
          actRow.appendChild(delWrap);

          bkRow.appendChild(actRow);
          bkListWrap.appendChild(bkRow);
        }
      } catch(e){
        bkListWrap.appendChild(el("div",{style:"color:#f87171;font-size:12px"},"Failed to load backups: "+String(e)));
      }
    };

    // Create backup button — snapshots all stores + map images in one call
    const createWrap = el("div",{style:"display:flex;gap:8px;align-items:center"});
    const makeCreateBtn = () => {
      const btn = el("button",{class:"btn"+(disabled?" disabled":"")}, "Create Backup");
      if(disabled) btn.disabled = true;
      btn.addEventListener("click", async () => {
        btn.disabled = true; btn.textContent = "Creating…";
        try {
          const r = await ctx.actions.wsCall("padspan_ha/store_backup_create", {note: "Manual backup"});
          ctx.toast(`Backup created (${r.store_count} stores).`);
          _renderBkList();
        } catch(e){ ctx.toast("Backup failed: "+String(e), true); }
        createWrap.innerHTML = ""; createWrap.appendChild(makeCreateBtn());
      });
      return btn;
    };
    createWrap.appendChild(makeCreateBtn());
    bkCard.appendChild(createWrap);

    root.appendChild(bkCard);
    // Load backup list on render
    _renderBkList();
  }

  // ── Integration Controls ─────────────────────────────────────────────────────
  // Reload: forces HA to call async_setup_entry again without a full HA restart.
  // Reset colors: wipes room_meta (custom room color picks) so colors regenerate
  //               from the hash-based room name algorithm.
  const ctrlCard = el("div",{class:"card"});
  ctrlCard.appendChild(el("div",{style:"font-weight:700;font-size:14px;margin-bottom:8px"},"Integration Controls"));
  ctrlCard.appendChild(el("div",{class:"muted",style:"font-size:12px;margin-bottom:14px"},"Low-level control over the PadSpan™ HA integration."));
  const ctrlGrid = el("div",{style:"display:flex;flex-direction:column;gap:10px"});

  const reloadWrap = el("div",{style:"display:flex;gap:8px;align-items:center"});
  const makeReloadBtn = ()=>{
    const b = el("button",{class:"btn"},"Reload PadSpan™ HA integration");
    b.addEventListener("click", ()=>{
      reloadWrap.innerHTML = "";
      const yes = el("button",{class:"btn",style:"background:#7f1d1d;border-color:#dc2626"},"Yes, reload");
      const no  = el("button",{class:"btn inline"},"Cancel");
      yes.addEventListener("click", async()=>{
        reloadWrap.innerHTML = "";
        reloadWrap.appendChild(el("span",{class:"muted",style:"font-size:12px"},"Reloading…"));
        try { const res = await ctx.actions.integrationReload(); ctx.toast(`Integration reloaded (${res?.reloaded??0} entries).`); reloadWrap.innerHTML = ""; reloadWrap.appendChild(makeReloadBtn()); }
        catch(e){ ctx.toast("Reload failed: "+String(e), true); reloadWrap.innerHTML = ""; reloadWrap.appendChild(makeReloadBtn()); }
      });
      no.addEventListener("click", ()=>{ reloadWrap.innerHTML = ""; reloadWrap.appendChild(makeReloadBtn()); });
      reloadWrap.appendChild(yes); reloadWrap.appendChild(no);
    });
    return b;
  };
  reloadWrap.appendChild(makeReloadBtn());
  ctrlGrid.appendChild(el("div",{},[
    el("div",{style:"font-weight:600;margin-bottom:4px"},"Reload integration"),
    el("div",{class:"muted",style:"font-size:12px;margin-bottom:6px"},"Forces HA to reinitialize PadSpan™ HA without a full HA restart. Useful after config changes."),
    reloadWrap,
  ]));

  const resetColorsWrap = el("div",{style:"display:flex;gap:8px;align-items:center"});
  const makeResetColorsBtn = ()=>{
    const b = el("button",{class:"btn"},"Reset room color settings");
    b.addEventListener("click", ()=>{
      resetColorsWrap.innerHTML = "";
      const yes = el("button",{class:"btn",style:"background:#7f1d1d;border-color:#dc2626"},"Yes, reset colors");
      const no  = el("button",{class:"btn inline"},"Cancel");
      yes.addEventListener("click", async()=>{
        resetColorsWrap.innerHTML = ""; resetColorsWrap.appendChild(makeResetColorsBtn());
        try { await ctx.actions.modelUpdate({room_meta:{}}); ctx.toast("Room color settings cleared."); ctx.actions.renderRooms(); }
        catch(e){ ctx.toast("Failed: "+String(e), true); }
      });
      no.addEventListener("click", ()=>{ resetColorsWrap.innerHTML = ""; resetColorsWrap.appendChild(makeResetColorsBtn()); });
      resetColorsWrap.appendChild(yes); resetColorsWrap.appendChild(no);
    });
    return b;
  };
  resetColorsWrap.appendChild(makeResetColorsBtn());
  ctrlGrid.appendChild(el("div",{},[
    el("div",{style:"font-weight:600;margin-bottom:4px"},"Reset room colors"),
    el("div",{class:"muted",style:"font-size:12px;margin-bottom:6px"},"Clears all custom room color picks. Colors regenerate from room names."),
    resetColorsWrap,
  ]));

  ctrlCard.appendChild(ctrlGrid);
  root.appendChild(ctrlCard);
  return root;
}

// ══════════════════════════════════════════════════════════════════════════════
// HA Entities sub-tab
// Composed of five sections stacked vertically:
//   1. Intro          — what PadSpan entities are and why they matter
//   2. Controls       — per-entity-type publishing toggles (tracker, area, etc.)
//   3. Audit          — live inventory fetched via WS, health pills, insights
//   4. Library        — reference cards for each entity type with YAML examples
//   5. MQTT           — experimental MQTT publishing toggle + topic docs
// ══════════════════════════════════════════════════════════════════════════════
function _haEntities(ctx, el){
  const wrap = el("div",{style:"display:flex;flex-direction:column;gap:12px"});
  const settings = ctx.state.settings || {};
  wrap.appendChild(_haEntitiesIntro(el));
  wrap.appendChild(_haEntityControls(ctx, el, settings));
  wrap.appendChild(_haEntityAudit(ctx, el));
  wrap.appendChild(_haEntityLibrary(ctx, el));
  wrap.appendChild(_haMqttSection(ctx, el, settings));
  wrap.appendChild(_haBleReseedSection(ctx, el, settings));
  wrap.appendChild(_haEspresenseSection(ctx, el, settings));
  return wrap;
}

/**
 * Aggressive BLE Reseed toggle — for Shelly and passive BLE proxies.
 * When enabled, reseeds from HA's discovered-service-info API every 5s
 * instead of 30s. Helps with HA 2026.4+ where habluetooth dedup
 * suppresses repeat callbacks from passive proxies.
 */
function _haBleReseedSection(ctx, el, settings){
  const card = el("div",{class:"card",style:"border-color:#26c6da"});

  const header = el("div",{style:"display:flex;align-items:center;gap:8px;margin-bottom:6px"});
  header.appendChild(el("span",{style:"font-weight:700;font-size:14px"},"BLE Proxy Compatibility"));
  header.appendChild(el("span",{style:"font-size:10px;padding:2px 8px;border-radius:10px;border:1px solid #26c6da;color:#26c6da"},"HA 2026.4+"));
  card.appendChild(header);

  card.appendChild(el("div",{style:"font-size:12px;color:#94a3b8;line-height:1.5;margin-bottom:10px"},
    "Enable this if Shelly BLE proxies or other passive Bluetooth relay scanners aren't showing RSSI values during calibration. " +
    "This increases the BLE data reseed frequency from every 30 seconds to every 5 seconds, working around a deduplication change in HA 2026.4."
  ));

  const chk = el("input",{type:"checkbox"});
  chk.checked = settings.aggressive_ble_reseed === true;
  chk.addEventListener("change", async()=>{
    try {
      await ctx.actions.settingsSet({aggressive_ble_reseed: chk.checked});
      ctx.toast(chk.checked ? "Aggressive BLE reseed enabled (5s cycle)." : "BLE reseed set to normal (30s cycle).");
      ctx.actions.renderRooms();
    } catch(e){ ctx.toast("Failed: "+String(e), true); chk.checked = !chk.checked; }
  });
  card.appendChild(el("label",{style:"display:flex;align-items:center;gap:8px;cursor:pointer;font-size:12px"},[
    chk, el("span",{},"Enable aggressive BLE reseed (5s) for passive proxy scanners"),
  ]));

  if(settings.aggressive_ble_reseed){
    card.appendChild(el("div",{style:"font-size:11px;color:#26c6da;margin-top:6px"},
      "Active — reseeding from HA Bluetooth discovery every 5 seconds. This uses slightly more CPU but ensures Shelly and passive scanner data stays fresh."
    ));
  }

  return card;
}

/** Static intro card explaining the four entity types PadSpan creates. */
function _haEntitiesIntro(el){
  return el("div",{class:"card",style:"border-color:#1b4a2e"},[
    el("div",{style:"font-weight:800;font-size:15px;color:#5eead4;margin-bottom:6px"},"PadSpan HA — Entity Reference"),
    el("div",{style:"font-size:13px;color:#94a3b8;line-height:1.6"},
      "PadSpan creates up to four HA entities for every labelled BLE device. This reference documents each entity type, its state values, attributes, and provides ready-to-paste automation examples."
    ),
    el("div",{style:"font-size:12px;color:#64748b;margin-top:6px"},
      "Tip: PadSpan's room_confidence and rssi_margin_confidence attributes let you build flicker-free automations that competing integrations cannot match."
    ),
  ]);
}

/**
 * Entity publishing toggles — checkboxes to enable/disable each entity type.
 * Persisted to settings via settingsSet. Disabling a type marks existing
 * entities as disabled in the HA registry; new devices skip creating them.
 */
function _haEntityControls(ctx, el, settings){
  const card = el("div",{class:"card"});
  card.appendChild(el("div",{style:"font-weight:700;font-size:14px;margin-bottom:4px"},"Entity Publishing Controls"));
  card.appendChild(el("div",{class:"muted",style:"font-size:12px;margin-bottom:12px"},
    "Disable entity types you don't need. Existing entities will be disabled in the HA registry. New devices won't create disabled types. Re-enabling restores them. Requires integration reload for new devices."
  ));

  const types = [
    {key:"ha_entity_tracker_enabled", label:"device_tracker.padspan_{label}", desc:"Person-linkable tracker (home/room state)"},
    {key:"ha_entity_area_enabled", label:"sensor.padspan_{label}_area", desc:"Primary room sensor with confidence attributes"},
    {key:"ha_entity_distance_enabled", label:"sensor.padspan_{label}_distance", desc:"Distance to nearest scanner (metres)"},
    {key:"ha_entity_scanner_distance_enabled", label:"sensor.padspan_{label}_distance_{scanner}", desc:"Per-scanner distance for hyper-local triggers"},
    {key:"ha_entity_occupancy_enabled", label:"sensor.padspan_occupancy", desc:"Building occupancy estimate (min/estimate/max) — requires integration reload"},
  ];

  for(const t of types){
    const row = el("div",{style:"display:flex;align-items:center;gap:10px;padding:6px 0;border-bottom:1px solid #1b3526"});
    const chk = el("input",{type:"checkbox"});
    chk.checked = settings[t.key] !== false;
    chk.addEventListener("change", async()=>{
      try {
        await ctx.actions.settingsSet({[t.key]: chk.checked});
        ctx.toast(chk.checked ? `${t.label} enabled — reload integration for new devices.` : `${t.label} disabled. Existing entities disabled in HA registry.`);
      } catch(e){ ctx.toast("Failed: "+String(e), true); chk.checked = !chk.checked; }
    });
    row.appendChild(chk);
    row.appendChild(el("div",{style:"flex:1"},[
      el("div",{style:"font-family:monospace;font-size:12px;color:#5eead4"},t.label),
      el("div",{class:"muted",style:"font-size:11px"},t.desc),
    ]));
    card.appendChild(row);
  }
  return card;
}

/**
 * Live entity inventory — fetches all PadSpan entities from HA via
 * ha_entities_audit WS call. Renders a summary bar (health pills, type
 * counts), a scrollable table (health dot, entity ID, type badge, state,
 * last changed, automation usage, suggestion hints), and insight cards
 * that surface actionable advice (unused entities, stale sensors, etc.).
 */
function _haEntityAudit(ctx, el){
  const card = el("div",{class:"card"});
  const header = el("div",{style:"display:flex;align-items:center;gap:8px;margin-bottom:4px"});
  header.appendChild(el("span",{style:"font-weight:700;font-size:14px"},"Live Entity Inventory"));
  card.appendChild(header);
  card.appendChild(el("div",{class:"muted",style:"font-size:12px;margin-bottom:12px"},
    "All PadSpan entities registered in Home Assistant with current state, health, and automation usage."
  ));

  // Placeholder that gets filled async
  const body = el("div",{});
  const loading = el("div",{class:"muted",style:"font-size:12px;padding:12px 0"},"Loading entity data…");
  body.appendChild(loading);
  card.appendChild(body);

  // Fire the WS call
  ctx.actions.wsCall("padspan_ha/ha_entities_audit", {}).then(res => {
    body.innerHTML = "";
    if(!res || !res.entities || !res.entities.length){
      body.appendChild(el("div",{class:"muted",style:"font-size:12px;padding:8px 0"},
        "No PadSpan entities found. Label a BLE device in the Objects tab and switch to Live mode."
      ));
      return;
    }
    const entities = res.entities;

    // ── Summary bar — coloured pills showing entity health breakdown ────
    const summary = el("div",{style:"display:flex;flex-wrap:wrap;gap:8px;margin-bottom:12px"});
    const _pill = (label, count, color) => el("div",{style:`display:inline-flex;align-items:center;gap:4px;padding:3px 10px;border-radius:12px;border:1px solid ${color};font-size:11px`},[
      el("span",{style:`color:${color};font-weight:700`},String(count)),
      el("span",{style:"color:#94a3b8"},label),
    ]);
    const bh = res.by_health || {};
    summary.appendChild(_pill("total", res.total, "#5eead4"));
    if(bh.good)        summary.appendChild(_pill("healthy", bh.good, "#52b788"));
    if(bh.stale)       summary.appendChild(_pill("stale", bh.stale, "#f59e0b"));
    if(bh.unavailable) summary.appendChild(_pill("unavailable", bh.unavailable, "#f87171"));
    if(bh.unknown)     summary.appendChild(_pill("unknown", bh.unknown, "#94a3b8"));
    if(bh.disabled)    summary.appendChild(_pill("disabled", bh.disabled, "#64748b"));
    summary.appendChild(_pill("used in automations", res.total_used_in_automations, "#8b5cf6"));
    body.appendChild(summary);

    // ── Type breakdown ──────────────────────────────────────────────────
    const bt = res.by_type || {};
    const typeBar = el("div",{style:"display:flex;flex-wrap:wrap;gap:6px;margin-bottom:12px"});
    const _typeColors = {tracker:"#8b5cf6", area:"#10b981", distance:"#f59e0b", scanner_distance:"#06b6d4"};
    const _typeLabels = {tracker:"device_tracker", area:"area sensor", distance:"distance sensor", scanner_distance:"scanner distance"};
    for(const [t, c] of Object.entries(bt)){
      typeBar.appendChild(el("div",{style:`font-size:10px;padding:2px 8px;border-radius:10px;border:1px solid ${_typeColors[t]||"#64748b"};color:${_typeColors[t]||"#64748b"}`},
        `${c} ${_typeLabels[t]||t}`
      ));
    }
    body.appendChild(typeBar);

    // ── Entity table ─────────────────────────────────────────────────────
    const _healthIcon = (h) => {
      if(h === "good")        return {dot:"#52b788", label:"Healthy"};
      if(h === "stale")       return {dot:"#f59e0b", label:"Stale"};
      if(h === "unavailable") return {dot:"#f87171", label:"Unavailable"};
      if(h === "disabled")    return {dot:"#64748b", label:"Disabled"};
      if(h === "unknown")     return {dot:"#94a3b8", label:"Unknown"};
      return {dot:"#64748b", label:h};
    };
    const _ago = (iso) => {
      if(!iso) return "—";
      const d = new Date(iso);
      const sec = Math.floor((Date.now() - d.getTime()) / 1000);
      if(sec < 0) return "just now";
      if(sec < 60) return `${sec}s ago`;
      if(sec < 3600) return `${Math.floor(sec/60)}m ago`;
      if(sec < 86400) return `${Math.floor(sec/3600)}h ago`;
      return `${Math.floor(sec/86400)}d ago`;
    };

    const thead = el("thead",{},el("tr",{},[
      el("th",{style:"text-align:left"},"Health"),
      el("th",{style:"text-align:left"},"Entity"),
      el("th",{style:"text-align:left"},"Type"),
      el("th",{style:"text-align:left"},"State"),
      el("th",{style:"text-align:left"},"Last Changed"),
      el("th",{style:"text-align:left"},"Used By"),
      el("th",{style:"text-align:left"},"Hint"),
    ]));
    const tbody = el("tbody");

    for(const ent of entities){
      const hi = _healthIcon(ent.health);

      // Health dot + label
      const healthCell = el("td",{style:"white-space:nowrap"},[
        el("span",{style:`display:inline-block;width:8px;height:8px;border-radius:50%;background:${hi.dot};margin-right:4px;vertical-align:middle`}),
        el("span",{style:`font-size:10px;color:${hi.dot}`},hi.label),
      ]);

      // Entity ID (monospace) + device label
      const idCell = el("td",{},[
        el("div",{style:"font-family:monospace;font-size:11px;color:#5eead4;word-break:break-all"},ent.entity_id),
        ent.device_label ? el("div",{style:"font-size:10px;color:#64748b"},ent.device_label) : null,
      ].filter(Boolean));

      // Type badge
      const tc = _typeColors[ent.type] || "#64748b";
      const typeCell = el("td",{},
        el("span",{style:`font-size:10px;padding:1px 6px;border-radius:8px;border:1px solid ${tc};color:${tc};white-space:nowrap`},
          _typeLabels[ent.type] || ent.type
        )
      );

      // State
      const stateStyle = ent.state === "not_home" ? "color:#f87171" :
                         ent.state === "unavailable" ? "color:#64748b;font-style:italic" :
                         ent.state === "unknown" ? "color:#94a3b8;font-style:italic" :
                         "color:#e2e8f0";
      const stateCell = el("td",{},[
        el("div",{style:`font-size:12px;font-weight:600;${stateStyle};max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap`},ent.state || "—"),
        ent.room_confidence != null ? el("div",{style:"font-size:10px;color:#64748b"},`conf: ${Math.round(ent.room_confidence * 100)}%`) : null,
      ].filter(Boolean));

      // Last changed
      const changedCell = el("td",{},[
        el("div",{style:"font-size:11px;color:#94a3b8;white-space:nowrap"},_ago(ent.last_changed)),
        ent.health === "stale" && ent.health_detail ? el("div",{style:"font-size:9px;color:#f59e0b"},ent.health_detail.replace(/— .*/,"")) : null,
      ].filter(Boolean));

      // Used by automations/scripts
      const usedParts = [];
      if(ent.automations.length){
        usedParts.push(el("div",{style:"font-size:10px;color:#8b5cf6"},`${ent.automations.length} automation${ent.automations.length>1?"s":""}`));
        for(const a of ent.automations.slice(0,2)){
          usedParts.push(el("div",{style:"font-size:9px;color:#64748b;padding-left:6px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:160px"},a));
        }
        if(ent.automations.length > 2) usedParts.push(el("div",{style:"font-size:9px;color:#64748b;padding-left:6px"},`+${ent.automations.length-2} more`));
      }
      if(ent.scripts.length){
        usedParts.push(el("div",{style:"font-size:10px;color:#06b6d4"},`${ent.scripts.length} script${ent.scripts.length>1?"s":""}`));
      }
      if(!usedParts.length){
        usedParts.push(el("div",{style:"font-size:10px;color:#64748b;font-style:italic"},"unused"));
      }
      const usedCell = el("td",{},usedParts);

      // Suggestion hint
      const hintCell = el("td",{});
      if(ent.suggestion){
        hintCell.appendChild(el("div",{style:"font-size:10px;color:#fbbf24;max-width:180px;line-height:1.3"},ent.suggestion));
      }

      tbody.appendChild(el("tr",{style:ent.health === "disabled" ? "opacity:0.45" : ""},[
        healthCell, idCell, typeCell, stateCell, changedCell, usedCell, hintCell,
      ]));
    }

    const table = el("table",{class:"table",style:"font-size:12px"},[thead, tbody]);
    const tableWrap = el("div",{style:"overflow-x:auto;max-height:500px;overflow-y:auto"});
    tableWrap.appendChild(table);
    body.appendChild(tableWrap);

    // ── Health insights — contextual advice based on the audit data ─────
    const insights = [];
    const unusedCount = entities.filter(e => e.used_count === 0 && e.health !== "disabled").length;
    const staleCount = bh.stale || 0;
    const unavailCount = bh.unavailable || 0;

    if(unusedCount > 0 && unusedCount === entities.filter(e => e.health !== "disabled").length){
      insights.push({color:"#fbbf24", text:`None of your ${unusedCount} entities are used in automations yet. Scroll down to the Entity Type Library for ready-to-paste examples.`});
    } else if(unusedCount > 0){
      insights.push({color:"#fbbf24", text:`${unusedCount} entit${unusedCount===1?"y is":"ies are"} not used in any automation or script. Check the hints column for ideas.`});
    }
    if(staleCount > 0){
      insights.push({color:"#f59e0b", text:`${staleCount} entit${staleCount===1?"y hasn't":"ies haven't"} changed state in 24+ hours — likely away or out of scanner range.`});
    }
    if(unavailCount > 0){
      insights.push({color:"#f87171", text:`${unavailCount} entit${unavailCount===1?"y is":"ies are"} unavailable. Try reloading the integration from the Data tab.`});
    }
    const areaCount = (bt.area || 0);
    const trackerCount = (bt.tracker || 0);
    if(areaCount > 0 && trackerCount === 0){
      insights.push({color:"#8b5cf6", text:"You have area sensors but no device trackers. Enable device_tracker above to link devices to Person entities."});
    }
    if(res.total_used_in_automations > 0){
      insights.push({color:"#52b788", text:`${res.total_used_in_automations} entit${res.total_used_in_automations===1?"y is":"ies are"} actively used in automations — nice!`});
    }

    if(insights.length){
      const insightWrap = el("div",{style:"margin-top:10px;display:flex;flex-direction:column;gap:6px"});
      insightWrap.appendChild(el("div",{style:"font-weight:600;font-size:12px;margin-bottom:2px"},"Insights"));
      for(const ins of insights){
        insightWrap.appendChild(el("div",{style:`font-size:11px;color:${ins.color};padding:4px 8px;background:#0a150e;border:1px solid #1b3526;border-radius:6px;line-height:1.4`},ins.text));
      }
      body.appendChild(insightWrap);
    }

  }).catch(err => {
    body.innerHTML = "";
    body.appendChild(el("div",{style:"font-size:12px;color:#f87171;padding:8px 0"},
      "Failed to load entity data: " + String(err?.message || err)
    ));
  });

  return card;
}

/**
 * Entity Type Library — static reference cards for each of the four entity
 * types PadSpan creates. Each card shows the entity ID pattern, state
 * description, attribute table, and collapsible YAML automation examples
 * with a copy-to-clipboard button.
 */
function _haEntityLibrary(ctx, el){
  const wrap = el("div",{style:"display:flex;flex-direction:column;gap:12px"});
  wrap.appendChild(el("div",{style:"font-weight:700;font-size:14px;color:#94a3b8;margin-bottom:2px"},"Entity Type Library"));

  // ── 1. device_tracker — person-linkable room tracker ────────────────────
  wrap.appendChild(_entityCard(el, {
    id: "device_tracker.padspan_{label}",
    badge: "Person-linkable",
    badgeColor: "#8b5cf6",
    state: "Room name when home (e.g. \"kitchen\"), \"not_home\" when away beyond timeout.",
    attrs: [
      ["address", "BLE MAC or iBeacon UUID"],
      ["rssi", "Latest smoothed RSSI (dBm), null when away"],
      ["age_s", "Seconds since last advertisement"],
      ["user_label", "Friendly name assigned in PadSpan"],
      ["home", "Boolean — true when seen within away timeout"],
    ],
    examples: [
      {
        title: "Link to a Person entity",
        desc: "Go to HA Settings → People → select person → under \"Track devices\", add device_tracker.padspan_{label}. HA will use PadSpan's room assignment for that person's location.",
        yaml: `# No YAML needed — this is configured in the HA UI:
# Settings → People → [person] → Track devices
# Add: device_tracker.padspan_alice_phone
#
# Once linked, person.alice will show the room name
# reported by PadSpan (e.g. "kitchen", "bedroom").
# Works alongside GPS trackers — HA merges both.`,
      },
    ],
  }));

  // ── 2. sensor._area — primary room sensor with confidence attributes ───
  wrap.appendChild(_entityCard(el, {
    id: "sensor.padspan_{label}_area",
    badge: "Primary room sensor",
    badgeColor: "#10b981",
    state: "Current room name (e.g. \"living_room\"), \"unknown\" if no room assigned, \"not_home\" when away.",
    attrs: [
      ["room_confidence", "0.0–1.0 — fraction of vote window agreeing on this room (PadSpan-unique)"],
      ["rssi_margin_confidence", "0.0–1.0 — how much stronger the winning room's signal is vs runner-up (PadSpan-unique)"],
      ["kind", "\"ble\", \"private_ble\", or \"ibeacon\""],
      ["address", "BLE MAC address"],
      ["rssi", "Kalman-smoothed RSSI (dBm), null when away"],
      ["age_s", "Seconds since last BLE advertisement"],
      ["sources", "List of scanner names currently hearing this device"],
      ["home", "Boolean — true when within away timeout"],
      ["ibeacon_uuid", "iBeacon UUID (only for iBeacon devices)"],
      ["all_addresses", "All MAC addresses seen for this device (rotating BLE)"],
    ],
    examples: [
      {
        title: "Confidence-gated room lighting",
        desc: "Only turn on lights when PadSpan is confident about the room — avoids flicker from momentary signal bounces.",
        yaml: `automation:
  - alias: "Kitchen lights on — confidence gated"
    trigger:
      - platform: state
        entity_id: sensor.padspan_alice_phone_area
        to: "kitchen"
    condition:
      - condition: numeric_state
        entity_id: sensor.padspan_alice_phone_area
        attribute: room_confidence
        above: 0.75
    action:
      - service: light.turn_on
        target:
          area_id: kitchen`,
      },
      {
        title: "Multi-person room occupancy sensor",
        desc: "Template binary sensor that's ON when anyone is in a room. Uses Jinja to scan all PadSpan area sensors.",
        yaml: `template:
  - binary_sensor:
      - name: "Kitchen occupied"
        state: >-
          {{ states.sensor
             | selectattr('entity_id', 'search', 'padspan_.*_area')
             | map(attribute='state')
             | select('eq', 'kitchen')
             | list | length > 0 }}
        device_class: occupancy`,
      },
      {
        title: "Follow-me Sonos media",
        desc: "Move music to whatever room you walk into. Define a room→speaker mapping, then trigger on area change.",
        yaml: `automation:
  - alias: "Follow-me Sonos"
    trigger:
      - platform: state
        entity_id: sensor.padspan_alice_phone_area
    condition:
      - condition: numeric_state
        entity_id: sensor.padspan_alice_phone_area
        attribute: room_confidence
        above: 0.8
    action:
      - variables:
          speakers:
            kitchen: media_player.kitchen_sonos
            living_room: media_player.living_room_sonos
            bedroom: media_player.bedroom_sonos
      - condition: template
        value_template: >-
          {{ trigger.to_state.state in speakers }}
      - service: media_player.join
        target:
          entity_id: "{{ speakers[trigger.to_state.state] }}"
        data:
          group_members:
            - "{{ speakers[trigger.from_state.state] }}"`,
      },
      {
        title: "Room-based HVAC — flicker-free",
        desc: "Only heat occupied rooms. The confidence gate prevents the thermostat toggling when BLE signals fluctuate.",
        yaml: `automation:
  - alias: "Heat occupied rooms only"
    trigger:
      - platform: state
        entity_id: sensor.padspan_alice_phone_area
    condition:
      - condition: numeric_state
        entity_id: sensor.padspan_alice_phone_area
        attribute: room_confidence
        above: 0.8
    action:
      - service: climate.set_temperature
        target:
          area_id: "{{ trigger.to_state.state }}"
        data:
          temperature: 21
      - condition: template
        value_template: "{{ trigger.from_state.state != trigger.to_state.state }}"
      - service: climate.set_temperature
        target:
          area_id: "{{ trigger.from_state.state }}"
        data:
          temperature: 17`,
      },
      {
        title: "Dashboard Markdown card — all devices",
        desc: "Shows every tracked PadSpan device with its current room and confidence percentage.",
        yaml: `type: markdown
title: PadSpan Presence
content: >-
  {% set sensors = states.sensor
     | selectattr('entity_id', 'search', 'padspan_.*_area')
     | list %}
  | Device | Room | Confidence |
  |--------|------|------------|
  {% for s in sensors -%}
  | {{ s.name | replace(' Area','') }} | {{ s.state }} | {{ (s.attributes.room_confidence | default(0) * 100) | round }}% |
  {% endfor %}`,
      },
    ],
  }));

  // ── 3. sensor._distance — nearest-scanner proximity in metres ───────────
  wrap.appendChild(_entityCard(el, {
    id: "sensor.padspan_{label}_distance",
    badge: "Proximity metre",
    badgeColor: "#f59e0b",
    state: "Distance in metres to nearest scanner (float, e.g. 2.3). Unavailable when away.",
    attrs: [
      ["rssi", "Kalman-smoothed RSSI used for distance calculation"],
      ["tx_power", "Advertised TX power (dBm) from the BLE device, if available"],
      ["age_s", "Seconds since last advertisement"],
      ["room", "Current room assignment"],
    ],
    examples: [
      {
        title: "Wake desk PC when within 1.5 m",
        desc: "Uses numeric_state trigger to fire a Wake-on-LAN when you sit down at your desk.",
        yaml: `automation:
  - alias: "Wake desk PC on approach"
    trigger:
      - platform: numeric_state
        entity_id: sensor.padspan_alice_phone_distance
        below: 1.5
    condition:
      - condition: state
        entity_id: switch.desk_pc_wol
        state: "off"
    action:
      - service: wake_on_lan.send_magic_packet
        data:
          mac: "AA:BB:CC:DD:EE:FF"`,
      },
      {
        title: "Occupant counter — people within 3 m",
        desc: "Template sensor counting how many tracked people are within 3 metres of any scanner.",
        yaml: `template:
  - sensor:
      - name: "Nearby people"
        unit_of_measurement: "people"
        state: >-
          {{ states.sensor
             | selectattr('entity_id', 'search', 'padspan_.*_distance$')
             | selectattr('state', 'is_number')
             | map(attribute='state')
             | map('float')
             | select('lt', 3.0)
             | list | length }}`,
      },
    ],
  }));

  // ── 4. sensor._distance_{scanner} — per-scanner micro-zone distance ────
  wrap.appendChild(_entityCard(el, {
    id: "sensor.padspan_{label}_distance_{scanner}",
    badge: "Per-scanner hyper-local",
    badgeColor: "#06b6d4",
    state: "Distance in metres from this specific scanner to the device. Unavailable when not heard.",
    attrs: [
      ["scanner", "Name of the ESPresense / Bluetooth Proxy node"],
      ["rssi", "Kalman-smoothed RSSI from this specific scanner"],
      ["age_s", "Seconds since this scanner last heard the device"],
      ["room", "Current room assignment (from global scoring, not this scanner alone)"],
    ],
    examples: [
      {
        title: "Bedside lamp — zone within a room",
        desc: "Fire when you're within 1.2 m of the bedroom proxy. This creates a micro-zone inside a room — unique to per-scanner distance.",
        yaml: `automation:
  - alias: "Bedside lamp on approach"
    trigger:
      - platform: numeric_state
        entity_id: sensor.padspan_alice_phone_distance_bedroom_proxy
        below: 1.2
        for: "00:00:05"
    action:
      - service: light.turn_on
        target:
          entity_id: light.bedside_lamp
        data:
          brightness_pct: 30
  - alias: "Bedside lamp off on leave"
    trigger:
      - platform: numeric_state
        entity_id: sensor.padspan_alice_phone_distance_bedroom_proxy
        above: 2.0
        for: "00:00:10"
    action:
      - service: light.turn_off
        target:
          entity_id: light.bedside_lamp`,
      },
      {
        title: "Closest scanner template",
        desc: "Template sensor that reports which scanner is nearest. Useful for room override logic or debugging.",
        yaml: `template:
  - sensor:
      - name: "Alice closest scanner"
        state: >-
          {% set ns = namespace(best='unknown', dist=999) %}
          {% for s in states.sensor
             | selectattr('entity_id', 'search',
                 'padspan_alice_phone_distance_')
             | selectattr('state', 'is_number') %}
            {% if s.state | float < ns.dist %}
              {% set ns.dist = s.state | float %}
              {% set ns.best = s.attributes.scanner | default(
                 s.entity_id | replace(
                   'sensor.padspan_alice_phone_distance_','')) %}
            {% endif %}
          {% endfor %}
          {{ ns.best }}`,
      },
    ],
  }));

  return wrap;
}

/** Renders a single entity type reference card (header, state, attributes table, examples). */
function _entityCard(el, cfg){
  const card = el("div",{class:"card"});

  // Header
  const header = el("div",{style:"display:flex;align-items:center;gap:8px;margin-bottom:8px;flex-wrap:wrap"});
  header.appendChild(el("span",{style:"font-family:monospace;font-size:13px;font-weight:700;color:#5eead4"},cfg.id));
  header.appendChild(el("span",{style:`font-size:10px;padding:2px 8px;border-radius:10px;border:1px solid ${cfg.badgeColor};color:${cfg.badgeColor}`},cfg.badge));
  card.appendChild(header);

  // State
  card.appendChild(el("div",{style:"margin-bottom:8px"},[
    el("div",{style:"font-weight:600;font-size:12px;margin-bottom:2px"},"State"),
    el("div",{style:"font-size:12px;color:#94a3b8"},cfg.state),
  ]));

  // Attributes table
  if(cfg.attrs && cfg.attrs.length){
    card.appendChild(el("div",{style:"font-weight:600;font-size:12px;margin-bottom:4px"},"Attributes"));
    const tbody = el("tbody");
    for(const [name, desc] of cfg.attrs){
      tbody.appendChild(el("tr",{},[
        el("td",{style:"font-family:monospace;font-size:11px;color:#5eead4;white-space:nowrap;padding-right:12px"},name),
        el("td",{style:"font-size:11px;color:#94a3b8"},desc),
      ]));
    }
    card.appendChild(el("table",{style:"width:100%;margin-bottom:10px;border-collapse:collapse"},[tbody]));
  }

  // Examples
  if(cfg.examples && cfg.examples.length){
    card.appendChild(el("div",{style:"font-weight:600;font-size:12px;margin-bottom:6px"},"Automation Examples"));
    for(const ex of cfg.examples){
      card.appendChild(_exampleBlock(el, ex));
    }
  }

  return card;
}

/**
 * Collapsible YAML example block with copy-to-clipboard.
 * Used in the Entity Library cards and MQTT section.
 * Starts collapsed (arrow ▶); click toggles the code panel.
 */
function _exampleBlock(el, ex){
  const wrap = el("div",{style:"margin-bottom:8px;border:1px solid #1b3526;border-radius:8px;overflow:hidden"});

  const expanded = {v: false};
  const codeWrap = el("div",{style:"display:none"});

  const headerBtn = el("button",{style:"display:flex;align-items:center;gap:8px;width:100%;padding:8px 10px;background:#0a150e;border:none;cursor:pointer;text-align:left;color:#e2e8f0;font-size:12px"});
  const arrow = el("span",{style:"color:#5eead4;font-size:10px;transition:transform 0.15s"},"▶");
  headerBtn.appendChild(arrow);
  headerBtn.appendChild(el("span",{style:"font-weight:600;flex:1"},ex.title));
  headerBtn.appendChild(el("span",{style:"font-size:10px;color:#64748b;border:1px solid #334155;padding:1px 6px;border-radius:8px"},"YAML"));

  headerBtn.addEventListener("click",()=>{
    expanded.v = !expanded.v;
    codeWrap.style.display = expanded.v ? "block" : "none";
    arrow.style.transform = expanded.v ? "rotate(90deg)" : "";
  });
  wrap.appendChild(headerBtn);

  if(ex.desc){
    const descDiv = el("div",{style:"padding:4px 10px 6px 28px;font-size:11px;color:#64748b;background:#0a150e"});
    descDiv.textContent = ex.desc;
    wrap.appendChild(descDiv);
  }

  const pre = document.createElement("pre");
  pre.style.cssText = "margin:0;padding:10px 12px;font-size:11px;line-height:1.5;overflow-x:auto;background:#060d08;color:#a7f3d0;white-space:pre;";
  pre.textContent = ex.yaml;

  const copyBtn = el("button",{style:"position:absolute;top:4px;right:4px;background:#1b3526;border:1px solid #2d5a3e;color:#5eead4;font-size:10px;padding:2px 8px;border-radius:6px;cursor:pointer"},"Copy");
  copyBtn.addEventListener("click", async()=>{
    try { await navigator.clipboard.writeText(ex.yaml); copyBtn.textContent = "Copied!"; } catch(e){
      try {
        const tmp = document.createElement("textarea");
        tmp.value = ex.yaml; tmp.style.cssText = "position:fixed;left:-9999px";
        document.body.appendChild(tmp); tmp.select(); document.execCommand("copy");
        document.body.removeChild(tmp); copyBtn.textContent = "Copied!";
      } catch(e2){ copyBtn.textContent = "Failed"; }
    }
    setTimeout(()=>{ copyBtn.textContent = "Copy"; }, 1500);
  });

  const codeContainer = el("div",{style:"position:relative"});
  codeContainer.appendChild(pre);
  codeContainer.appendChild(copyBtn);
  codeWrap.appendChild(codeContainer);
  wrap.appendChild(codeWrap);

  return wrap;
}

/**
 * MQTT Publishing section — experimental feature that publishes device
 * presence data to MQTT topics alongside HA entities. Useful for bridging
 * to Node-RED or non-HA systems. Toggle persisted to settings store.
 */
function _haMqttSection(ctx, el, settings){
  const card = el("div",{class:"card",style:"border-color:#f59e0b"});

  const header = el("div",{style:"display:flex;align-items:center;gap:8px;margin-bottom:6px"});
  header.appendChild(el("span",{style:"font-weight:700;font-size:14px"},"MQTT Publishing"));
  header.appendChild(el("span",{style:"font-size:10px;padding:2px 8px;border-radius:10px;border:1px solid #f59e0b;color:#f59e0b"},"Experimental"));
  card.appendChild(header);

  card.appendChild(el("div",{style:"font-size:12px;color:#94a3b8;line-height:1.5;margin-bottom:10px"},
    "When enabled, PadSpan publishes device presence data to MQTT alongside HA entities. Useful for bridging to Node-RED, external dashboards, or non-HA systems."
  ));

  card.appendChild(el("div",{style:"font-size:11px;color:#64748b;margin-bottom:8px;padding:6px 8px;background:#1a1200;border:1px solid #3d2e00;border-radius:6px"},
    "Topics: padspan/devices/{label}/state • padspan/devices/{label}/area • padspan/devices/{label}/distance — Schema may change without notice."
  ));

  const chk = el("input",{type:"checkbox"});
  chk.checked = settings.mqtt_publish_enabled === true;
  chk.addEventListener("change", async()=>{
    try {
      await ctx.actions.settingsSet({mqtt_publish_enabled: chk.checked});
      ctx.toast(chk.checked ? "MQTT publishing enabled." : "MQTT publishing disabled.");
      ctx.actions.renderRooms();
    } catch(e){ ctx.toast("Failed: "+String(e), true); chk.checked = !chk.checked; }
  });
  card.appendChild(el("label",{style:"display:flex;align-items:center;gap:8px;cursor:pointer;font-size:12px;margin-bottom:10px"},[
    chk, el("span",{},"Enable experimental MQTT publishing"),
  ]));

  if(settings.mqtt_publish_enabled){
    card.appendChild(el("div",{style:"font-size:12px;color:#f59e0b;margin-bottom:8px"},"MQTT publishing is active. Ensure MQTT integration is configured in HA."));
    card.appendChild(_exampleBlock(el, {
      title: "MQTT automation example",
      desc: "Trigger a Node-RED flow or external system when a device enters a room via MQTT.",
      yaml: `automation:
  - alias: "MQTT room arrival"
    trigger:
      - platform: mqtt
        topic: "padspan/devices/alice_phone/area"
    condition:
      - condition: template
        value_template: "{{ trigger.payload != 'not_home' }}"
    action:
      - service: notify.notify
        data:
          message: >-
            Alice's phone arrived in {{ trigger.payload }}`,
    }));
  }

  return card;
}

/**
 * ESPresense MQTT Ingestion section — subscribe to ESPresense MQTT topics
 * to receive BLE data from ESPresense scanner nodes. Required when HA has
 * no Bluetooth adapter/integration installed.
 */
function _haEspresenseSection(ctx, el, settings){
  const card = el("div",{class:"card",style:"border-color:#8b5cf6"});

  const header = el("div",{style:"display:flex;align-items:center;gap:8px;margin-bottom:6px"});
  header.appendChild(el("span",{style:"font-weight:700;font-size:14px"},"ESPresense MQTT"));
  header.appendChild(el("span",{style:"font-size:10px;padding:2px 8px;border-radius:10px;border:1px solid #8b5cf6;color:#8b5cf6"},"Experimental"));
  card.appendChild(header);

  card.appendChild(el("div",{style:"font-size:12px;color:#94a3b8;line-height:1.5;margin-bottom:10px"},
    "Subscribe to ESPresense MQTT topics to receive BLE scanner data. Enable this if your ESP32 nodes run ESPresense firmware and publish to MQTT. Requires HA's MQTT integration to be configured."
  ));

  // Enable toggle
  const chk = el("input",{type:"checkbox"});
  chk.checked = settings.espresense_mqtt_enabled === true;
  chk.addEventListener("change", async()=>{
    try {
      await ctx.actions.settingsSet({espresense_mqtt_enabled: chk.checked});
      ctx.toast(chk.checked ? "ESPresense MQTT enabled — scanners should appear within 10 seconds." : "ESPresense MQTT disabled.");
      ctx.actions.renderRooms();
    } catch(e){ ctx.toast("Failed: "+String(e), true); chk.checked = !chk.checked; }
  });
  card.appendChild(el("label",{style:"display:flex;align-items:center;gap:8px;cursor:pointer;font-size:12px;margin-bottom:10px"},[
    chk, el("span",{},"Enable ESPresense MQTT ingestion"),
  ]));

  if(settings.espresense_mqtt_enabled){
    card.appendChild(el("div",{style:"font-size:12px;color:#8b5cf6;margin-bottom:8px"},"ESPresense MQTT is active. Your ESPresense nodes should appear as scanners in the Bluetooth and Overview views."));

    // Topic prefix
    const prefixRow = el("div",{style:"display:flex;align-items:center;gap:8px;margin-bottom:10px"});
    prefixRow.appendChild(el("span",{style:"font-size:12px;color:#94a3b8;white-space:nowrap"},"Topic prefix:"));
    const prefixInput = el("input",{type:"text",value:settings.espresense_topic_prefix||"espresense",placeholder:"espresense"});
    prefixInput.style.cssText = "background:#0a150e;border:1px solid #2d5a3d;border-radius:6px;color:#e2e8f0;padding:4px 8px;font-size:12px;width:180px";
    const prefixSave = el("button",{class:"btn inline",style:"font-size:11px;padding:3px 10px"});
    prefixSave.textContent = "Save";
    prefixSave.addEventListener("click", async()=>{
      const v = prefixInput.value.trim().replace(/#|\+/g,"").replace(/^\/|\/$/g,"");
      if(!v){ ctx.toast("Prefix cannot be empty", true); return; }
      prefixSave.disabled = true;
      try {
        await ctx.actions.settingsSet({espresense_topic_prefix: v});
        ctx.toast("Topic prefix saved. Restart HA or toggle ESPresense off/on to apply.");
        prefixSave.textContent = "Saved \u2714";
        setTimeout(()=>{ prefixSave.textContent = "Save"; prefixSave.disabled = false; }, 2000);
      } catch(e){ ctx.toast("Failed: "+String(e), true); prefixSave.disabled = false; }
    });
    prefixRow.appendChild(prefixInput);
    prefixRow.appendChild(prefixSave);
    card.appendChild(prefixRow);

    card.appendChild(el("div",{style:"font-size:11px;color:#64748b;padding:6px 8px;background:#0f0a1a;border:1px solid #2d1b4e;border-radius:6px"},
      "Topics: " + (settings.espresense_topic_prefix||"espresense") + "/devices/# \u2022 " + (settings.espresense_topic_prefix||"espresense") + "/rooms/#"
    ));
  }

  // ── Companion Import ──────────────────────────────────────────────────
  card.appendChild(el("div",{style:"margin-top:14px;padding-top:12px;border-top:1px solid #2d1b4e"}));
  card.appendChild(el("div",{style:"display:flex;align-items:center;gap:8px;margin-bottom:4px"},[
    el("span",{style:"font-weight:700;font-size:13px;color:#a78bfa"}, "Import from ESPresense Companion"),
    el("span",{style:"font-size:10px;padding:2px 8px;border-radius:10px;border:1px solid #8b5cf6;color:#8b5cf6"},"Experimental"),
    ctx.helpers.helpBtn("manage_espresense_import"),
  ]));
  card.appendChild(el("div",{style:"font-size:11px;color:#94a3b8;line-height:1.5;margin-bottom:8px"},
    "Import floor layouts, room boundaries, and scanner/node positions from ESPresense Companion. " +
    "Coordinates are in metres — PadSpan imports them directly into its positioning fabric. " +
    "This is a merge — existing PadSpan data is preserved."
  ));

  const urlRow = el("div",{style:"display:flex;align-items:center;gap:8px;margin-bottom:8px;flex-wrap:wrap"});
  urlRow.appendChild(el("span",{style:"font-size:12px;color:#94a3b8;white-space:nowrap"}, "Companion URL:"));
  const urlInput = el("input",{type:"text",value:settings.espresense_companion_url||"",placeholder:"http://espresense:8267"});
  urlInput.style.cssText = "background:#0a150e;border:1px solid #2d5a3d;border-radius:6px;color:#e2e8f0;padding:4px 8px;font-size:12px;width:240px";
  const urlSave = el("button",{class:"btn inline",style:"font-size:11px;padding:3px 10px"});
  urlSave.textContent = "Save URL";
  urlSave.addEventListener("click", async()=>{
    const v = urlInput.value.trim().replace(/\/$/,"");
    urlSave.disabled = true;
    try {
      await ctx.actions.settingsSet({espresense_companion_url: v});
      ctx.toast(v ? "Companion URL saved." : "Companion URL cleared.");
      urlSave.textContent = "Saved \u2714";
      setTimeout(()=>{ urlSave.textContent = "Save URL"; urlSave.disabled = false; }, 2000);
    } catch(e){ ctx.toast("Failed: "+String(e), true); urlSave.disabled = false; }
  });
  urlRow.appendChild(urlInput);
  urlRow.appendChild(urlSave);
  card.appendChild(urlRow);

  // Import button (only enabled when URL is configured)
  const importStatus = el("div",{style:"font-size:11px;color:#94a3b8;margin-top:6px"});
  const importBtn = el("button",{class:"btn inline",style:"font-size:12px;padding:4px 14px;border-color:#8b5cf6;color:#a78bfa"});
  importBtn.textContent = "\u2B07 Import Now";
  if(!settings.espresense_companion_url){
    importBtn.disabled = true;
    importBtn.title = "Save a Companion URL first";
  }
  importBtn.addEventListener("click", async()=>{
    importBtn.disabled = true; importBtn.textContent = "Importing\u2026";
    importStatus.textContent = "";
    importStatus.style.color = "#94a3b8";
    try {
      const r = await ctx.actions.wsCall("padspan_ha/espresense_companion_import", {});
      importStatus.style.color = "#52b788";
      importStatus.textContent = "\u2714 Imported: " + (r.floors||0) + " floors, " + (r.rooms||0) + " rooms, " + (r.scanners||0) + " scanners" + (r.skipped ? " (" + r.skipped + " skipped)" : "");
      ctx.toast("ESPresense Companion import complete!");
    } catch(e){
      importStatus.style.color = "#f87171";
      importStatus.textContent = "\u2718 " + (e.message||String(e));
      ctx.toast("Import failed: " + (e.message||e), true);
    }
    importBtn.disabled = false; importBtn.textContent = "\u2B07 Import Now";
  });
  card.appendChild(importBtn);
  card.appendChild(importStatus);

  return card;
}

// ══════════════════════════════════════════════════════════════════════════════
// History sub-tab — persisted room-transition timeline
//
// Fetches the backend movement_history store (up to 500 entries) and renders
// them newest-first in a scrollable timeline. Each entry shows timestamp,
// device label, from-room, and to-room with a colour-coded left border.
//
// Friendly names are resolved from three sources (in priority order):
//   1. Live snapshot objects (BLE devices)
//   2. Snapshot tags (entity trackers)
//   3. Stored object labels (padspan_ha.objects store)
// ══════════════════════════════════════════════════════════════════════════════
function _history(ctx, el){
  const { roomColor } = ctx.helpers;
  const wrap = el("div",{style:"display:flex;flex-direction:column;gap:12px"});

  // Lazy-load object labels from the backend (once per session).
  // Triggers a re-render when labels arrive so device names appear.
  if(!ctx.state._objectLabelsLoaded){
    ctx.state._objectLabelsLoaded = true;
    ctx.actions.objectLabelList().then(r => {
      if(r && r.labels && Object.keys(r.labels).length){
        ctx.state._objectLabels = r.labels;
        ctx.actions.renderRooms();
      }
    }).catch(()=>{});
  }

  // Fetch persisted movement history from backend (once per session).
  // The _manageMovementLoaded flag prevents re-fetching on every render.
  if(!ctx.state._manageMovementLoaded){
    ctx.state._manageMovementLoaded = true;
    ctx.state._manageMovementEntries = [];
    ctx.actions.wsCall("padspan_ha/movement_history_get", {limit: 500}).then(r => {
      ctx.state._manageMovementEntries = (r && r.entries) || [];
      ctx.actions.renderRooms();
    }).catch(e => {
      console.error("Movement history load failed:", e);
    });
  }

  const entries = ctx.state._manageMovementEntries || [];

  // Build a lookup for friendly names from all available sources
  const snap = (ctx.state.live && ctx.state.live.snapshot) || null;
  const _nameMap = {};
  // From snapshot objects (BLE devices)
  const _objs = (snap && snap.objects && Array.isArray(snap.objects.list)) ? snap.objects.list : [];
  for(const o of _objs){
    const addr = o.address || o.entity_id || "";
    if(addr && (o.user_label || o.name)) _nameMap[addr] = o.user_label || o.name;
  }
  // From snapshot tags (entity trackers)
  const _tags = (snap && Array.isArray(snap.tags)) ? snap.tags : [];
  for(const t of _tags){
    if(t.entity_id && (t.name || t.entity_id)){
      if(!_nameMap[t.entity_id]) _nameMap[t.entity_id] = t.name || t.entity_id;
    }
  }
  // From stored object labels
  const _storedLabels = ctx.state._objectLabels || {};
  for(const [addr, info] of Object.entries(_storedLabels)){
    if(addr && !_nameMap[addr]){
      _nameMap[addr] = (typeof info === "string") ? info : (info && info.label) || addr;
    }
  }

  // Toolbar
  const toolbar = el("div",{style:"display:flex;align-items:center;gap:8px;margin-bottom:8px"});
  toolbar.appendChild(el("div",{class:"muted",style:"font-size:12px"}, `${entries.length} room transitions (persisted)`));
  toolbar.appendChild(el("div",{style:"flex:1"}));
  const refreshBtn = el("button",{class:"btn inline",style:"font-size:11px;padding:2px 8px"}, "Refresh");
  refreshBtn.addEventListener("click", ()=>{
    ctx.state._manageMovementLoaded = false;
    ctx.actions.renderRooms();
  });
  toolbar.appendChild(refreshBtn);
  wrap.appendChild(toolbar);

  if(entries.length === 0){
    wrap.appendChild(el("div",{class:"card"},[
      el("div",{class:"muted"},"No movement history recorded yet. Room transitions are automatically saved when tracked devices move between rooms."),
    ]));
    return wrap;
  }

  // Timeline (newest first)
  const listContainer = el("div",{style:"max-height:500px;overflow-y:auto;display:flex;flex-direction:column;gap:2px"});
  const sorted = [...entries].reverse();
  for(const entry of sorted){
    const ts = entry.ts ? new Date(entry.ts * 1000) : null;
    let timeStr = "\u2014";
    let dateStr = "";
    if(ts){
      const hh = String(ts.getHours()).padStart(2, "0");
      const mm = String(ts.getMinutes()).padStart(2, "0");
      const ss = String(ts.getSeconds()).padStart(2, "0");
      timeStr = `${hh}:${mm}:${ss}`;
      const today = new Date();
      if(ts.toDateString() !== today.toDateString()){
        dateStr = `${ts.getMonth()+1}/${ts.getDate()} `;
      }
    }
    const _dev = entry.device || "";
    const label = entry.label || _nameMap[_dev] || _dev || "Unknown";
    const fromRoom = entry.from || "?";
    const toRoom = entry.to || "?";
    const rc = roomColor ? roomColor(toRoom) : "#52b788";
    const row = el("div",{style:"display:flex;align-items:center;gap:8px;padding:5px 8px;border-radius:4px;background:rgba(255,255,255,0.02);border-left:3px solid " + rc});
    row.appendChild(el("span",{style:"font-family:monospace;font-size:11px;color:#64748b;flex-shrink:0;width:72px"}, dateStr + timeStr));
    row.appendChild(el("span",{style:"font-size:12px;font-weight:600;color:#e2e8f0;min-width:80px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex-shrink:0"}, label));
    row.appendChild(el("span",{style:"font-size:11px;color:#94a3b8;flex-shrink:0"}, fromRoom));
    row.appendChild(el("span",{style:"font-size:11px;color:#5eead4"}, "\u2192"));
    row.appendChild(el("span",{style:`font-size:11px;color:${rc};font-weight:600`}, toRoom));
    listContainer.appendChild(row);
  }
  wrap.appendChild(listContainer);
  return wrap;
}

// ══════════════════════════════════════════════════════════════════════════════
// Events sub-tab — session event log + email alert configuration
//
// Two main sections:
//   1. Email Notifications — saved alerts summary table + per-device editor
//      with email, service selection, room filter checkboxes, test button
//   2. Session event log — in-memory followHistory, newest first, clears on
//      page reload (unlike the History tab which reads persisted data)
//
// Also shows system diagnostics JSON if ctx.state.diag is populated.
// ══════════════════════════════════════════════════════════════════════════════
function _events(ctx, el){
  const { roomColor } = ctx.helpers;
  const wrap = el("div",{style:"display:flex;flex-direction:column;gap:12px"});

  // ── Email Notifications card ──────────────────────────────────────────────
  // Wrapped in try/catch because this section is complex and a crash here
  // should not prevent the rest of the Events tab from rendering.
  try {
    wrap.appendChild(_buildNotifications(ctx, el));
  } catch(e) {
    console.error("_buildNotifications crashed:", e);
    wrap.appendChild(el("div",{class:"card",style:"border-color:#7f1d1d"},[
      el("div",{style:"font-weight:700;color:#fca5a5"},"Email Notifications — Error"),
      el("div",{style:"font-size:11px;color:#f87171;font-family:monospace;word-break:break-all;margin-top:4px"}, String(e?.message || e)),
    ]));
  }

  wrap.appendChild(el("div",{class:"muted",style:"font-size:12px"},
    "Session event log — room transitions for all tracked tags, newest first. Clears on page reload."
  ));

  // Build a flat, time-sorted event list from per-device followHistory arrays.
  // Each device's history is an array of {ts, room} entries; we merge them all
  // and tag the last entry per device as "isCurrent" for a "now" badge.
  const followHistory = ctx.state.followHistory || {};
  const snap = (ctx.state.live && ctx.state.live.snapshot) || null;
  const allObjects = (snap && snap.objects && Array.isArray(snap.objects.list)) ? snap.objects.list : [];
  const events = [];
  for(const [addr,history] of Object.entries(followHistory)){
    if(!history||!history.length) continue;
    const obj = allObjects.find(o=>(o.address||o.entity_id||"")===addr);
    const label = (obj&&(obj.user_label||obj.name||obj.entity_id))||addr;
    for(let i=history.length-1;i>=0;i--){
      events.push({ts:history[i].ts,room:history[i].room,label,isCurrent:i===history.length-1});
    }
  }
  events.sort((a,b)=>b.ts-a.ts);

  if(!events.length){
    wrap.appendChild(el("div",{class:"card"},[
      el("div",{class:"muted"},"No events recorded yet. Track tags in the Follow tab to generate movement events."),
    ]));
  } else {
    const card = el("div",{class:"card"});
    card.appendChild(el("div",{class:"row",style:"margin-bottom:8px"},[
      el("div",{style:"font-weight:700"},"Room Transitions"),
      el("span",{class:"badge",style:"margin-left:8px"},`${events.length} events`),
    ]));
    const list = el("div",{style:"display:flex;flex-direction:column;gap:4px;max-height:400px;overflow-y:auto"});
    for(const ev of events){
      const timeStr = new Date(ev.ts).toLocaleTimeString([],{hour:"2-digit",minute:"2-digit",second:"2-digit"});
      const rc = roomColor(ev.room||"");
      const row = el("div",{style:"display:flex;align-items:center;gap:8px;padding:5px 8px;border-radius:8px;background:#0a150e;border:1px solid #1b3526"},[
        el("span",{style:"color:#94a3b8;font-size:11px;font-family:monospace;white-space:nowrap"},timeStr),
        el("span",{class:"dot",style:`background:${rc};flex-shrink:0`}),
        el("span",{style:"flex:1;font-size:12px"},[
          el("span",{style:"color:#94a3b8"},ev.label+" → "),
          el("span",{style:"font-weight:600"},ev.room||"(unknown)"),
        ]),
        ev.isCurrent ? el("span",{class:"badge"},"now") : null,
      ].filter(Boolean));
      list.appendChild(row);
    }
    card.appendChild(list);
    wrap.appendChild(card);
  }

  const diag = ctx.state.diag;
  if(diag && Object.keys(diag).length){
    const diagCard = el("div",{class:"card"});
    diagCard.appendChild(el("div",{style:"font-weight:700;margin-bottom:8px"},"System Diagnostics"));
    const pre = document.createElement("pre");
    pre.className = "mono";
    pre.setAttribute("style","max-height:200px;overflow:auto;font-size:11px");
    pre.textContent = JSON.stringify(diag,null,2);
    diagCard.appendChild(pre);
    wrap.appendChild(diagCard);
  }
  return wrap;
}

// ══════════════════════════════════════════════════════════════════════════════
// Email Notification Configuration
//
// Renders two cards:
//   1. Saved Alerts — summary table of all persisted alert configs with
//      device name, email, service, watched rooms, active status, delete btn.
//   2. Configure Alerts — per-device editor with email input, HA notify
//      service dropdown, on-room-change toggle, room filter checkboxes,
//      save + test buttons. Also handles notify service discovery and shows
//      setup instructions when no services are found.
//
// The device list is assembled from five sources to ensure completeness:
//   1. Snapshot tags (entity trackers)
//   2. Snapshot objects (BLE devices)
//   3. Saved alert configs (devices that had alerts previously)
//   4. Followed addresses
//   5. Stored object labels
// ══════════════════════════════════════════════════════════════════════════════
function _buildNotifications(ctx, el){
  const snap = (ctx.state.live && ctx.state.live.snapshot) || null;
  const snapObjects = (snap && snap.objects && Array.isArray(snap.objects.list)) ? snap.objects.list : [];
  const configs = ctx.state.followAlertConfig || {};
  const seen = new Set();
  const allObjects = [];
  // Include entity trackers from snap.tags
  const snapTags = (snap && Array.isArray(snap.tags)) ? snap.tags : [];
  for(const t of snapTags){
    const addr = t.entity_id || "";
    if(addr && !seen.has(addr)){
      seen.add(addr);
      allObjects.push({ address: addr, entity_id: addr, user_label: t.name || addr, name: t.name || addr, kind: "entity" });
    }
  }
  for(const o of snapObjects){
    const addr = o.address || o.entity_id || "";
    if(addr && !seen.has(addr)){ seen.add(addr); allObjects.push(o); }
  }
  // Add devices from saved alert configs that aren't in the snapshot
  for(const [addr, cfg] of Object.entries(configs)){
    if(!addr || seen.has(addr)) continue;
    seen.add(addr);
    allObjects.push({ address: addr, user_label: cfg._label || addr, kind: "ble", _fromConfig: true });
  }
  // Add followed devices that aren't in the snapshot
  for(const addr of (ctx.state.followedAddrs || [])){
    if(!addr || seen.has(addr)) continue;
    seen.add(addr);
    allObjects.push({ address: addr, user_label: addr, kind: "ble", _fromFollowed: true });
  }
  // Load labels from object store if available (async, will re-render)
  if(!ctx.state._objectLabelsLoaded){
    ctx.state._objectLabelsLoaded = true;
    ctx.actions.objectLabelList().then(r => {
      if(r && r.labels && Object.keys(r.labels).length){
        ctx.state._objectLabels = r.labels;
        ctx.actions.renderRooms();
      }
    }).catch(()=>{});
  }
  // Merge stored labels into allObjects
  const storedLabels = ctx.state._objectLabels || {};
  for(const [addr, info] of Object.entries(storedLabels)){
    if(!addr || seen.has(addr)) continue;
    seen.add(addr);
    const label = (typeof info === "string") ? info : (info && info.label) || addr;
    allObjects.push({ address: addr, user_label: label, kind: "ble", _fromStore: true });
  }

  const haAreas = (ctx.state.model && Array.isArray(ctx.state.model.areas)) ? ctx.state.model.areas : [];
  const dataMode = ctx.state.dataMode || "sample";
  const disabled = dataMode !== "live";

  const wrap = el("div",{style:"display:flex;flex-direction:column;gap:12px"});

  // ── Saved Alerts summary table — read-only view of all persisted configs ──
  const savedEntries = Object.entries(configs).filter(([,c]) => c && c.email);
  const savedCard = el("div",{class:"card"});
  const activeCount = savedEntries.filter(([,c]) => c.on_room_change).length;
  savedCard.appendChild(el("div",{class:"row",style:"margin-bottom:6px"},[
    el("div",{style:"font-weight:700;font-size:14px"},"Saved Alerts"),
    activeCount > 0
      ? el("span",{class:"badge",style:"margin-left:8px;border-color:#52b788;color:#52b788"},`${activeCount} active`)
      : el("span",{class:"badge",style:"margin-left:8px;border-color:#64748b;color:#64748b"},"none active"),
  ]));
  savedCard.appendChild(el("div",{class:"muted",style:"font-size:12px;margin-bottom:10px"},
    "All saved email alert configurations. Alerts fire when a device changes rooms (via HA notify service)."
  ));

  if(!savedEntries.length){
    savedCard.appendChild(el("div",{class:"muted",style:"font-size:12px;padding:8px 0"},
      "No alerts configured yet. Tag a device in Objects, then set up alerts below or in the Follow tab."
    ));
  } else {
    const thead = el("thead",{},el("tr",{},[
      el("th",{},"Device"),
      el("th",{},"Email"),
      el("th",{},"Service"),
      el("th",{},"Rooms"),
      el("th",{},"Status"),
      el("th",{style:"width:50px"},""),
    ]));
    const tbody = el("tbody");
    for(const [addr, cfg] of savedEntries){
      // Try to find a friendly name from live objects
      const obj = allObjects.find(o => (o.address||o.entity_id||"") === addr);
      const label = (obj && (obj.user_label || obj.name)) || addr;
      const svc = cfg.notify_service || "default";
      const rooms = (cfg.watch_rooms && cfg.watch_rooms.length) ? cfg.watch_rooms.join(", ") : "all";
      const active = cfg.on_room_change;

      const delBtn = el("button",{class:"btn tiny",style:"color:#ef5350;border-color:#7f1d1d;padding:2px 8px;font-size:11px"}, "Delete");
      delBtn.addEventListener("click", async ()=>{
        if(!confirm(`Delete alert for "${label}"?`)) return;
        delBtn.disabled = true; delBtn.textContent = "...";
        try {
          await ctx.actions.followAlertDelete(addr);
          ctx.toast(`Alert for ${label} deleted.`);
          ctx.actions.renderRooms();
        } catch(e){
          delBtn.disabled = false; delBtn.textContent = "Delete";
          ctx.toast("Delete failed: " + (e?.message || String(e)), true);
        }
      });

      tbody.appendChild(el("tr",{},[
        el("td",{style:"font-weight:600;font-size:12px;max-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap"},label),
        el("td",{style:"font-size:11px;max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-family:monospace"},cfg.email),
        el("td",{class:"muted",style:"font-size:11px"},svc),
        el("td",{class:"muted",style:"font-size:11px;max-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap"},rooms),
        el("td",{},
          active
            ? el("span",{style:"color:#52b788;font-size:11px;font-weight:600"},"Active")
            : el("span",{style:"color:#64748b;font-size:11px"},"Off")
        ),
        el("td",{},[delBtn]),
      ]));
    }
    savedCard.appendChild(el("table",{class:"table"},[thead, tbody]));
  }
  wrap.appendChild(savedCard);

  // ── Per-device alert editor ─────────────────────────────────────────────────
  // Any device with a label/name can receive alerts: tagged BLE, entities, followed.
  // Each device row has: email input, notify service dropdown, on-room-change
  // toggle, room filter checkboxes, save button, and test-notification button.
  const trackable = allObjects.filter(o =>
    o.user_label || o.name || o.kind === "entity" || o._fromConfig || o._fromFollowed || o._fromStore
  );

  // Always refresh notify services on render (user may add SMTP mid-session).
  // If the service list changes, we re-render to update all dropdowns.
  const _prevServices = JSON.stringify(ctx.state._notifyServices || []);
  if(!ctx.state._notifyServices) ctx.state._notifyServices = [];
  ctx.actions.wsCall("padspan_ha/notify_services_list", {}).then(r => {
    ctx.state._notifyServices = (r && r.services) || [];
    ctx.state._notifySvcDebug = r ? JSON.stringify(r) : "null response";
    // Re-render if list changed (new service added, or still empty on first load)
    if(JSON.stringify(ctx.state._notifyServices) !== _prevServices){
      ctx.actions.renderRooms();
    }
  }).catch(e => {
    ctx.state._notifySvcDebug = "WS error: " + (e?.message || String(e));
  });

  const editCard = el("div",{class:"card"});
  editCard.appendChild(el("div",{style:"font-weight:700;font-size:14px;margin-bottom:4px"},"Configure Alerts"));
  editCard.appendChild(el("div",{class:"muted",style:"font-size:12px;margin-bottom:14px"},
    "Set up or edit email alerts for tracked devices. You can also configure per-device alerts in the Follow tab."
  ));

  if(disabled){
    editCard.appendChild(el("div",{style:"font-size:12px;color:#fbbf24;margin-bottom:10px"},
      "Switch to Live mode to configure and save alert settings."
    ));
  }

  // Service discovery info + refresh
  const _svcList = ctx.state._notifyServices || [];
  const refreshBtn = el("button",{class:"btn tiny",style:"margin-left:8px"}, "Refresh Services");
  refreshBtn.addEventListener("click", () => {
    ctx.state._notifyServices = null;
    ctx.actions.renderRooms();
  });
  if(_svcList.length === 0){
    const _dbg = ctx.state._notifySvcDebug || "loading…";
    editCard.appendChild(el("div",{style:"background:#1a0a0a;border:1px solid #7f1d1d;border-radius:8px;padding:12px 14px;margin-bottom:12px"},[
      el("div",{style:"display:flex;align-items:center;gap:8px;margin-bottom:4px"},[
        el("div",{style:"font-weight:700;font-size:13px;color:#fca5a5"},"No notification services found"),
        refreshBtn,
      ]),
      el("div",{style:"font-size:12px;color:#fca5a5;line-height:1.5"},
        "PadSpan sends alerts via Home Assistant's notify integration. You need to set up a notification provider first:"
      ),
      el("div",{style:"font-size:11px;color:#94a3b8;margin-top:6px;line-height:1.6;padding-left:10px"},
        "1. Go to HA Settings \u2192 Devices & Services \u2192 Add Integration\n" +
        "2. Search for your notification provider (e.g. SMTP, Mobile App, Pushover, Telegram)\n" +
        "3. Configure it with your email/credentials\n" +
        "4. Restart HA, then click Refresh Services above"
      ),
      el("div",{style:"font-size:10px;color:#475569;margin-top:8px;font-family:monospace;word-break:break-all"}, "Debug: " + _dbg + " | UI: v" + (ctx.state.version||"?") + " | Backend: v" + (ctx.state.versionInfo?.version||"?") + " | Mode: " + (ctx.state.dataMode||"?")),
    ]));
  } else {
    editCard.appendChild(el("div",{style:"display:flex;align-items:center;gap:8px;margin-bottom:10px;flex-wrap:wrap"},[
      el("span",{class:"badge",style:"border-color:#52b788;color:#52b788"},`${_svcList.length} service${_svcList.length>1?"s":""} found`),
      el("span",{class:"muted",style:"font-size:10px"}, _svcList.join(", ")),
      refreshBtn,
    ]));
  }

  if(!trackable.length){
    editCard.appendChild(el("div",{class:"muted",style:"font-size:12px;padding:8px 0"},
      "No tracked devices found. Tag BLE devices in Objects or add device trackers to set up notifications."
    ));
    wrap.appendChild(editCard);
    return wrap;
  }

  const roomNames = haAreas.map(a => a.name).sort();
  const list = el("div",{style:"display:flex;flex-direction:column;gap:8px"});

  for(const obj of trackable){
    const addr = obj.address || obj.entity_id || "";
    if(!addr) continue;
    const name = obj.user_label || obj.name || addr;
    const cfg = configs[addr] || {on_room_change: true};
    if(!configs[addr]) configs[addr] = cfg;
    const isActive = !!(cfg.on_room_change && cfg.email);

    const row = el("div",{style:"padding:10px 12px;border:1px solid " + (isActive ? "#1b4a2e" : "#1b3526") + ";border-radius:8px;background:#0a150e"});

    // Header row: name + status
    row.appendChild(el("div",{style:"display:flex;align-items:center;gap:8px;margin-bottom:8px"},[
      el("span",{style:"font-weight:600;font-size:13px;color:#5eead4"},name),
      el("span",{class:"muted",style:"font-size:10px;font-family:monospace"},addr),
      isActive
        ? el("span",{class:"badge",style:"margin-left:auto;border-color:#52b788;color:#52b788;font-size:10px"},"Active")
        : el("span",{class:"badge",style:"margin-left:auto;border-color:#64748b;color:#64748b;font-size:10px"},"Off"),
    ]));

    // Email + service row
    const emailInput = el("input",{
      class:"input", type:"email", placeholder:"email@example.com",
      value: cfg.email || "", style:"max-width:240px",
    });
    emailInput.addEventListener("input", e => {
      cfg.email = e.target.value;
      ctx.state.followAlertConfig[addr] = cfg;
    });

    const serviceSelect = el("select",{class:"input",style:"max-width:180px"});
    serviceSelect.appendChild(el("option",{value:""},"Auto-detect"));
    for(const svc of (ctx.state._notifyServices || [])){
      const opt = el("option",{value:svc},svc);
      if(cfg.notify_service === svc) opt.selected = true;
      serviceSelect.appendChild(opt);
    }
    serviceSelect.addEventListener("change", () => {
      cfg.notify_service = serviceSelect.value || undefined;
      ctx.state.followAlertConfig[addr] = cfg;
    });

    row.appendChild(el("div",{style:"display:flex;flex-wrap:wrap;gap:8px;align-items:flex-end;margin-bottom:8px"},[
      el("div",{style:"display:flex;flex-direction:column;gap:2px"},[
        el("div",{class:"muted",style:"font-size:10px"},"Email"),
        emailInput,
      ]),
      el("div",{style:"display:flex;flex-direction:column;gap:2px"},[
        el("div",{class:"muted",style:"font-size:10px"},"Service"),
        serviceSelect,
      ]),
    ]));

    // On-change toggle
    const chkChange = el("input",{type:"checkbox"});
    if(cfg.on_room_change) chkChange.checked = true;
    chkChange.addEventListener("change", () => {
      cfg.on_room_change = chkChange.checked;
      ctx.state.followAlertConfig[addr] = cfg;
    });

    row.appendChild(el("div",{style:"display:flex;align-items:center;gap:10px;margin-bottom:8px"},[
      el("label",{style:"display:flex;align-items:center;gap:6px;cursor:pointer;font-size:12px"},[
        chkChange, el("span",{},"Alert on room change"),
      ]),
    ]));

    // Watch-rooms
    if(roomNames.length){
      const watchRooms = cfg.watch_rooms || [];
      const roomChecks = roomNames.map(room => {
        const chk = el("input",{type:"checkbox"});
        if(watchRooms.includes(room)) chk.checked = true;
        chk.addEventListener("change", () => {
          const wr = ctx.state.followAlertConfig[addr]?.watch_rooms || [];
          if(chk.checked){ if(!wr.includes(room)) wr.push(room); }
          else { const i = wr.indexOf(room); if(i >= 0) wr.splice(i, 1); }
          cfg.watch_rooms = wr;
          ctx.state.followAlertConfig[addr] = cfg;
        });
        return el("label",{style:"display:inline-flex;align-items:center;gap:4px;cursor:pointer;font-size:11px"},[chk, el("span",{},room)]);
      });
      row.appendChild(el("div",{style:"margin-bottom:8px"},[
        el("div",{class:"muted",style:"font-size:10px;margin-bottom:3px"},"Only these rooms (unchecked = all):"),
        el("div",{style:"display:flex;flex-wrap:wrap;gap:6px"},roomChecks),
      ]));
    }

    // Save + Test
    const saveStatus = el("span",{class:"muted",style:"font-size:11px;max-width:300px;line-height:1.3"});
    const saveBtn = el("button",{class:"btn"+(disabled?" disabled":""),style:"background:#1b4a2e;border-color:#52b788;font-weight:700"}, "Save Alert");
    if(disabled) saveBtn.disabled = true;
    saveBtn.addEventListener("click", async () => {
      if(disabled){ saveStatus.textContent = "Live mode required."; saveStatus.style.color = "#fbbf24"; return; }
      if(cfg.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(cfg.email)){
        saveStatus.textContent = "Invalid email format."; saveStatus.style.color = "#f87171"; return;
      }
      saveStatus.textContent = "Saving…"; saveStatus.style.color = "";
      try {
        await ctx.actions.followAlertSave({ addr, config: cfg });
        saveStatus.textContent = "Saved!"; saveStatus.style.color = "#52b788";
        ctx.actions.renderRooms();
      } catch(e){
        saveStatus.textContent = "Save failed: " + (e?.message || String(e)); saveStatus.style.color = "#f87171";
      }
    });

    const testBtn = el("button",{class:"btn tiny"+(disabled?" disabled":"")}, "Test Notification");
    if(disabled) testBtn.disabled = true;
    testBtn.addEventListener("click", async () => {
      if(disabled){ saveStatus.textContent = "Live mode required."; saveStatus.style.color = "#fbbf24"; return; }
      const testEmail = (emailInput.value || "").trim();
      saveStatus.textContent = "Sending test…"; saveStatus.style.color = "";
      testBtn.disabled = true;
      try {
        const svc = serviceSelect ? serviceSelect.value : "";
        const payload = { service: svc || undefined };
        if(testEmail) payload.email = testEmail;
        await ctx.actions.wsCall("padspan_ha/notify_test", payload);
        saveStatus.textContent = "Test sent — check your notification app/inbox."; saveStatus.style.color = "#52b788";
      } catch(e){
        const msg = (e?.message || String(e));
        saveStatus.textContent = msg.length > 120 ? msg.slice(0, 120) + "…" : msg;
        saveStatus.style.color = "#f87171";
      } finally { if(!disabled) testBtn.disabled = false; }
    });

    row.appendChild(el("div",{style:"display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-top:4px"},[saveBtn, testBtn, saveStatus]));
    list.appendChild(row);
  }

  editCard.appendChild(list);
  wrap.appendChild(editCard);
  return wrap;
}

// ══════════════════════════════════════════════════════════════════════════════
// Logs sub-tab — live integration log viewer
//
// Fetches up to 300 log entries from the backend's in-memory ring buffer
// (which holds 500 entries since last HA restart). Level filter dropdown
// controls minimum severity. Colour-coded rows: green=INFO, amber=WARNING,
// red=ERROR/CRITICAL, grey=DEBUG. Auto-fetches on first visit.
// ══════════════════════════════════════════════════════════════════════════════
function _logs(ctx, el) {
  const wrap = el("div", {});
  if (!ctx.state._logsLevel) ctx.state._logsLevel = "DEBUG";
  if (!ctx.state._logsData) ctx.state._logsData = null;
  if (!ctx.state._logsLoading) ctx.state._logsLoading = false;

  const levelColors = { DEBUG: "#94a3b8", INFO: "#52b788", WARNING: "#fbbf24", ERROR: "#f87171", CRITICAL: "#f87171" };

  const fetchLogs = async () => {
    ctx.state._logsLoading = true;
    try {
      const res = await ctx.actions.callWS({ type: "padspan_ha/logs_get", level: ctx.state._logsLevel, limit: 300 });
      ctx.state._logsData = res;
    } catch (e) {
      ctx.state._logsData = { entries: [], total: 0, error: String(e) };
    }
    ctx.state._logsLoading = false;
    ctx.actions.renderRooms();
  };

  // Auto-fetch on first visit
  if (!ctx.state._logsData && !ctx.state._logsLoading) {
    fetchLogs();
  }

  // Level filter
  const levelSel = el("select", { class: "btn" });
  for (const lv of ["DEBUG", "INFO", "WARNING", "ERROR"]) {
    const opt = el("option", { value: lv }, lv);
    if (lv === ctx.state._logsLevel) opt.selected = true;
    levelSel.appendChild(opt);
  }
  levelSel.addEventListener("change", () => {
    ctx.state._logsLevel = levelSel.value;
    ctx.state._logsData = null;
    fetchLogs();
  });

  const refreshBtn = el("button", { class: "btn" }, "Refresh");
  refreshBtn.addEventListener("click", () => fetchLogs());

  const toolbar = el("div", { style: "display:flex;gap:8px;align-items:center;margin-bottom:12px;flex-wrap:wrap" }, [
    el("span", { style: "font-weight:600;font-size:13px" }, "Min level:"),
    levelSel,
    refreshBtn,
  ]);
  wrap.appendChild(toolbar);

  const data = ctx.state._logsData;
  if (ctx.state._logsLoading) {
    wrap.appendChild(el("div", { class: "muted" }, "Loading logs..."));
    return wrap;
  }
  if (!data) {
    wrap.appendChild(el("div", { class: "muted" }, "Fetching logs..."));
    return wrap;
  }
  if (data.error) {
    wrap.appendChild(el("div", { class: "card warn" }, [
      el("div", { style: "font-weight:700" }, "Failed to fetch logs"),
      el("div", { class: "muted" }, data.error),
    ]));
    return wrap;
  }

  const entries = data.entries || [];
  wrap.appendChild(el("div", { class: "muted", style: "margin-bottom:8px;font-size:12px" },
    `Showing ${entries.length} of ${data.total || 0} buffered entries (newest first). Buffer holds up to 500 entries since last restart.`));

  if (!entries.length) {
    wrap.appendChild(el("div", { class: "card" }, el("div", { class: "muted", style: "padding:12px 0" },
      `No ${ctx.state._logsLevel}+ log entries yet. PadSpan logs appear here as the integration runs.`)));
    return wrap;
  }

  const logList = el("div", { style: "display:flex;flex-direction:column;gap:1px;font-family:monospace;font-size:11px;max-height:70vh;overflow-y:auto;background:#0a150e;border:1px solid #1b3526;border-radius:8px;padding:4px" });

  for (const e of entries) {
    const ts = e.ts ? new Date(e.ts * 1000) : null;
    const timeStr = ts ? ts.toLocaleTimeString("en-GB", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "??:??:??";
    const dateStr = ts ? ts.toLocaleDateString("en-CA") : "";
    const color = levelColors[e.level] || "#94a3b8";
    const bgColor = e.level === "ERROR" || e.level === "CRITICAL" ? "rgba(248,113,113,.08)" : e.level === "WARNING" ? "rgba(251,191,36,.05)" : "transparent";

    const row = el("div", { style: `display:flex;gap:8px;padding:3px 6px;background:${bgColor};border-radius:3px;align-items:flex-start` }, [
      el("span", { style: "color:#64748b;white-space:nowrap;min-width:68px" }, timeStr),
      el("span", { style: `color:${color};font-weight:700;min-width:56px` }, e.level),
      el("span", { style: "color:#64748b;min-width:90px;max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap", title: e.logger || "" }, e.logger || ""),
      el("span", { style: "color:#e2e8f0;word-break:break-word;flex:1" }, e.message || ""),
    ]);
    row.title = `${dateStr} ${timeStr} [${e.level}] ${e.logger}: ${e.message}`;
    logList.appendChild(row);
  }

  wrap.appendChild(logList);
  return wrap;
}


// ══════════════════════════════════════════════════════════════════════════════
// Beacon Characteristics sub-tab — signal profiles computed from calibration
//
// Shows per-beacon and per-model signal statistics: average RSSI, variance,
// scanner reach, multi-radio percentage, grid cells hit. Beacons are
// auto-grouped by model (iBeacon UUID prefix, manufacturer, BLE name).
//
// Features:
//   - Master toggle to enable/disable beacon profiling
//   - Per-beacon "Tune" toggle: exclude specific beacons from adaptive tuning
//   - Group/Ungroup: override auto-grouping for individual beacons
//   - Collapsible per-scanner breakdown table (mean RSSI, std, point count)
//   - All overrides persisted to settings via beacon_tune_disabled and
//     beacon_group_overrides keys
// ══════════════════════════════════════════════════════════════════════════════
function _beaconChars(ctx, el){
  const wrap = el("div",{style:"max-width:900px"});
  const settings = ctx.state.settings || {};

  // Header
  wrap.appendChild(el("div",{style:"font-weight:700;font-size:16px;color:#e2e8f0;margin-bottom:8px"},
    "Beacon Signal Profiles"));
  wrap.appendChild(el("div",{style:"font-size:12px;color:#94a3b8;margin-bottom:12px;line-height:1.5"},
    "Per-beacon signal characteristics computed from calibration data. "
    + "Beacons are automatically grouped by model (iBeacon UUID prefix, manufacturer, BLE name). "
    + "Model defaults apply to new beacons of the same type until they build their own profile."));

  // ── Master toggle ──
  const masterEnabled = settings.beacon_profiling_enabled !== false;
  const toggleRow = el("div",{style:"display:flex;align-items:center;gap:12px;margin-bottom:16px;padding:10px 14px;border-radius:8px;"
    + `background:${masterEnabled ? "rgba(22,163,74,.08)" : "rgba(220,38,38,.08)"};border:1px solid ${masterEnabled ? "#16a34a" : "#dc2626"}`});
  toggleRow.appendChild(el("div",{style:"font-weight:700;font-size:13px;color:#e2e8f0;flex:1"},
    "Beacon Profiling"));
  const masterBtn = el("button",{
    style:`font-size:12px;padding:4px 14px;border-radius:4px;cursor:pointer;font-weight:700;border:1px solid ${masterEnabled?"#16a34a":"#dc2626"};background:${masterEnabled?"#052e16":"#3d0c0c"};color:${masterEnabled?"#4ade80":"#fca5a5"}`,
  }, masterEnabled ? "Enabled" : "Disabled");
  masterBtn.addEventListener("click", () => {
    const newVal = !masterEnabled;
    ctx.actions.wsCall("padspan_ha/settings_set", {
      beacon_profiling_enabled: newVal,
    }).then(() => {
      ctx.state.settings = { ...settings, beacon_profiling_enabled: newVal };
      ctx.actions.renderRooms();
    });
  });
  toggleRow.appendChild(masterBtn);
  toggleRow.appendChild(el("div",{style:"font-size:11px;color:#94a3b8"},
    masterEnabled ? "Profiling active — model defaults applied to new beacons"
                  : "Profiling disabled — all beacons use raw calibration data only"));
  wrap.appendChild(toggleRow);

  if (!masterEnabled) {
    wrap.appendChild(el("div",{style:"color:#94a3b8;font-size:13px;padding:20px;text-align:center"},
      "Enable beacon profiling above to see signal profiles and model grouping."));
    return wrap;
  }

  // ── State (hydrate from settings on first load) ──
  // _bcTuneDisabled: Set of device_ids excluded from adaptive tuning
  // _bcGroupOverrides: {device_id: model_key} overrides for auto-grouping
  if (!ctx.state._bcProfiles) ctx.state._bcProfiles = null;
  if (!ctx.state._bcLoading)  ctx.state._bcLoading = false;
  if (!ctx.state._bcStateHydrated) {
    ctx.state._bcGroupOverrides = settings.beacon_group_overrides || {};
    ctx.state._bcTuneDisabled = new Set(settings.beacon_tune_disabled || []);
    ctx.state._bcStateHydrated = true;
  }

  // Helper to persist tune-disabled + group overrides to settings
  const _saveBC = () => {
    ctx.actions.wsCall("padspan_ha/settings_set", {
      beacon_tune_disabled: [...ctx.state._bcTuneDisabled],
      beacon_group_overrides: ctx.state._bcGroupOverrides,
    }).catch(e => console.error("save beacon settings:", e));
  };

  const refresh = () => {
    ctx.state._bcLoading = true;
    ctx.actions.renderRooms();
    ctx.actions.wsCall("padspan_ha/calibration_beacon_profiles").then(res => {
      ctx.state._bcProfiles = res;
      ctx.state._bcLoading = false;
      ctx.actions.renderRooms();
    }).catch(e => {
      console.error("beacon_profiles error:", e);
      ctx.state._bcProfiles = { beacons: [], models: {}, scanner_names: {}, error: String(e) };
      ctx.state._bcLoading = false;
      ctx.actions.renderRooms();
    });
  };

  // Refresh button
  const refreshBtn = el("button",{class:"btn",style:"margin-bottom:12px;font-size:12px"},"Refresh Profiles");
  refreshBtn.addEventListener("click", refresh);
  wrap.appendChild(refreshBtn);

  // Auto-fetch on first render
  if (!ctx.state._bcProfiles && !ctx.state._bcLoading) {
    setTimeout(refresh, 50);
    wrap.appendChild(el("div",{style:"color:#94a3b8;font-size:13px;padding:20px"},"Loading profiles…"));
    return wrap;
  }
  if (ctx.state._bcLoading) {
    wrap.appendChild(el("div",{style:"color:#94a3b8;font-size:13px;padding:20px"},"Loading…"));
    return wrap;
  }

  const profiles = ctx.state._bcProfiles;
  if (!profiles || !profiles.beacons || profiles.beacons.length === 0) {
    wrap.appendChild(el("div",{style:"color:#94a3b8;font-size:13px;padding:20px"},
      "No beacon calibration data yet. Use Beacon Tune or Calibration Guide to collect data."));
    return wrap;
  }

  const { beacons, models, scanner_names } = profiles;

  // ── Apply group overrides to compute effective model keys ──
  const overrides = ctx.state._bcGroupOverrides || {};
  const effective = beacons.map(b => ({
    ...b,
    effective_model: overrides[b.device_id] || b.model_key,
  }));

  // ── Group by effective model, sorted by total calibration points (most data first) ──
  const grouped = {};
  for (const b of effective) {
    const mk = b.effective_model;
    if (!grouped[mk]) grouped[mk] = [];
    grouped[mk].push(b);
  }

  const sortedModels = Object.keys(grouped).sort((a,b) => {
    const ca = grouped[a].reduce((s,x)=>s+x.cal_points,0);
    const cb = grouped[b].reduce((s,x)=>s+x.cal_points,0);
    return cb - ca;
  });

  // ── Model summary cards ──
  for (const mk of sortedModels) {
    const group = grouped[mk];
    const mData = models[mk] || {};
    const card = el("div",{class:"card",style:"margin-bottom:12px"});

    // Model header
    const hdr = el("div",{style:"display:flex;justify-content:space-between;align-items:center;margin-bottom:8px"});
    hdr.appendChild(el("div",{style:"font-weight:700;font-size:14px;color:#60a5fa"}, mk));
    hdr.appendChild(el("div",{style:"font-size:11px;color:#94a3b8"},
      `${group.length} beacon${group.length!==1?"s":""} · ${mData.total_cal_points||0} cal points`));
    card.appendChild(hdr);

    // Model defaults row
    const defaults = el("div",{style:"display:flex;gap:16px;flex-wrap:wrap;font-size:12px;color:#cbd5e1;margin-bottom:10px;padding:6px 8px;background:rgba(59,130,246,.06);border-radius:6px"});
    if (mData.default_avg_rssi != null) defaults.appendChild(el("span",{},`Avg RSSI: ${mData.default_avg_rssi} dBm`));
    if (mData.default_avg_std != null) defaults.appendChild(el("span",{},`Variance: ±${mData.default_avg_std}`));
    if (mData.default_scanner_reach != null) defaults.appendChild(el("span",{},`Reach: ${mData.default_scanner_reach} scanners`));
    if (mData.default_multi_radio_pct != null) defaults.appendChild(el("span",{},`Multi-radio: ${Math.round(mData.default_multi_radio_pct*100)}%`));
    if (mData.default_tx_power != null) defaults.appendChild(el("span",{},`TX Power: ${mData.default_tx_power} dBm`));
    card.appendChild(defaults);

    // Per-beacon table
    const tbl = el("table",{style:"width:100%;border-collapse:collapse;font-size:11px"});
    const thead = el("tr",{style:"color:#94a3b8;text-align:left;border-bottom:1px solid #334155"});
    for (const h of ["Beacon","Points","Scanners","Avg Reach","Multi%","Avg RSSI","Variance","Cells","Tune","Group"]) {
      thead.appendChild(el("th",{style:"padding:4px 6px;font-weight:600"},h));
    }
    tbl.appendChild(thead);

    for (const b of group) {
      const tr = el("tr",{style:"border-bottom:1px solid #1e293b"});
      const lbl = b.label || b.device_id.substring(0,16);
      tr.appendChild(el("td",{style:"padding:4px 6px;color:#e2e8f0;max-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap",title:b.device_id},lbl));
      tr.appendChild(el("td",{style:"padding:4px 6px"},String(b.cal_points)));
      tr.appendChild(el("td",{style:"padding:4px 6px"},String(b.scanners_total)));
      tr.appendChild(el("td",{style:"padding:4px 6px"},String(b.avg_scanner_reach)));
      tr.appendChild(el("td",{style:"padding:4px 6px"},`${Math.round(b.multi_radio_pct*100)}%`));
      tr.appendChild(el("td",{style:"padding:4px 6px"},b.avg_rssi != null ? `${b.avg_rssi}` : "—"));
      tr.appendChild(el("td",{style:"padding:4px 6px"},b.avg_std != null ? `±${b.avg_std}` : "—"));
      tr.appendChild(el("td",{style:"padding:4px 6px"},String(b.grid_cells_hit)));

      // Tune toggle
      const tuneTd = el("td",{style:"padding:4px 6px"});
      const tuneOff = ctx.state._bcTuneDisabled.has(b.device_id);
      const tuneBtn = el("button",{
        style:`font-size:10px;padding:2px 6px;border-radius:3px;cursor:pointer;border:1px solid ${tuneOff?"#dc2626":"#16a34a"};background:${tuneOff?"#3d0c0c":"#052e16"};color:${tuneOff?"#fca5a5":"#4ade80"}`,
      }, tuneOff ? "Off" : "On");
      tuneBtn.addEventListener("click", () => {
        if (tuneOff) ctx.state._bcTuneDisabled.delete(b.device_id);
        else ctx.state._bcTuneDisabled.add(b.device_id);
        _saveBC();
        ctx.actions.renderRooms();
      });
      tuneTd.appendChild(tuneBtn);
      tr.appendChild(tuneTd);

      // Group action
      const grpTd = el("td",{style:"padding:4px 6px"});
      const isOverridden = !!overrides[b.device_id];
      if (group.length > 1 || isOverridden) {
        if (!isOverridden) {
          const ungroupBtn = el("button",{
            style:"font-size:10px;padding:2px 6px;border-radius:3px;cursor:pointer;border:1px solid #f59e0b;background:#451a03;color:#fcd34d",
          },"Ungroup");
          ungroupBtn.addEventListener("click", () => {
            ctx.state._bcGroupOverrides[b.device_id] = `solo:${b.device_id.substring(0,12)}`;
            _saveBC();
            ctx.actions.renderRooms();
          });
          grpTd.appendChild(ungroupBtn);
        } else {
          const regroupBtn = el("button",{
            style:"font-size:10px;padding:2px 6px;border-radius:3px;cursor:pointer;border:1px solid #3b82f6;background:#1e3a5f;color:#93c5fd",
          },"Regroup");
          regroupBtn.addEventListener("click", () => {
            delete ctx.state._bcGroupOverrides[b.device_id];
            _saveBC();
            ctx.actions.renderRooms();
          });
          grpTd.appendChild(regroupBtn);
        }
      }
      tr.appendChild(grpTd);
      tbl.appendChild(tr);
    }
    card.appendChild(tbl);

    // Per-scanner breakdown (collapsed by default)
    const detailBtn = el("button",{
      style:"font-size:11px;color:#60a5fa;background:none;border:none;cursor:pointer;margin-top:6px;padding:2px 0",
    },"Show per-scanner details ▸");
    const detailDiv = el("div",{style:"display:none;margin-top:8px"});

    detailBtn.addEventListener("click", () => {
      const vis = detailDiv.style.display !== "none";
      detailDiv.style.display = vis ? "none" : "block";
      detailBtn.textContent = vis ? "Show per-scanner details ▸" : "Hide per-scanner details ▾";
    });
    card.appendChild(detailBtn);

    // Per-scanner detail table
    const allScanners = new Set();
    for (const b of group) {
      for (const src of Object.keys(b.per_scanner || {})) allScanners.add(src);
    }
    if (allScanners.size > 0) {
      const st = el("table",{style:"width:100%;border-collapse:collapse;font-size:10px;margin-top:4px"});
      const sHead = el("tr",{style:"color:#94a3b8;text-align:left;border-bottom:1px solid #334155"});
      sHead.appendChild(el("th",{style:"padding:3px 5px"},"Beacon"));
      for (const src of allScanners) {
        sHead.appendChild(el("th",{style:"padding:3px 5px;max-width:80px;overflow:hidden;text-overflow:ellipsis",title:src},
          scanner_names[src] || src.substring(0,12)));
      }
      st.appendChild(sHead);

      for (const b of group) {
        const sr = el("tr",{style:"border-bottom:1px solid #1e293b"});
        sr.appendChild(el("td",{style:"padding:3px 5px;color:#cbd5e1"},b.label||b.device_id.substring(0,12)));
        for (const src of allScanners) {
          const ps = (b.per_scanner || {})[src];
          if (ps) {
            const color = ps.mean_rssi > -60 ? "#4ade80" : ps.mean_rssi > -75 ? "#fbbf24" : "#f87171";
            sr.appendChild(el("td",{style:`padding:3px 5px;color:${color}`},
              `${ps.mean_rssi} (±${ps.std_rssi}) ×${ps.point_count}`));
          } else {
            sr.appendChild(el("td",{style:"padding:3px 5px;color:#475569"},"—"));
          }
        }
        st.appendChild(sr);
      }
      detailDiv.appendChild(st);
    }
    card.appendChild(detailDiv);
    wrap.appendChild(card);
  }

  return wrap;
}


// ══════════════════════════════════════════════════════════════════════════════
// Factory Reset sub-tab — complete data wipe with multi-step progress
//
// Guarded by three safety layers:
//   1. Requires Live mode (disabled flag)
//   2. User must type "FACTORY RESET" in a text input
//   3. Browser confirm() dialog as final gate
//
// Reset sequence (shown as a progress bar):
//   Step 1: Backend store_factory_reset — clears all 11 .storage JSON files
//   Step 2: Restore data_mode to "live" (factory reset defaults to "sample")
//   Step 3: Clear browser localStorage keys (followed list, hidden maps, etc.)
//   Step 4: Reset in-memory frontend state (filters, selections)
//   Step 5: Verify server settings are clean
//   Step 6: Fetch fresh snapshot (objects will be empty)
//
// Sets _factoryResetInProgress on state to prevent the 5s poll from
// re-rendering the page and destroying the progress DOM mid-reset.
// ══════════════════════════════════════════════════════════════════════════════
function _factoryReset(ctx, el){
  const wrap = el("div",{class:"card",style:"max-width:640px"});
  wrap.appendChild(el("div",{style:"display:flex;align-items:center;gap:8px;margin-bottom:12px"},[
    el("div",{style:"font-weight:700;font-size:15px;color:#fca5a5"},"Factory Reset"),
    ctx.helpers.helpBtn("manage_factory_reset"),
  ]));

  const dataMode = ctx.state.dataMode || "sample";
  const disabled = dataMode !== "live";

  // Warning banner
  wrap.appendChild(el("div",{style:"background:#3d0c0c;border:3px solid #dc2626;border-radius:12px;padding:20px;margin-bottom:16px"},[
    el("div",{style:"font-weight:900;font-size:18px;color:#fca5a5;margin-bottom:10px"},"⚠  FACTORY RESET"),
    el("div",{style:"font-size:14px;color:#fcd5d5;line-height:1.7"},[
      "This will ",
      el("strong",{style:"color:#f87171"},"permanently delete ALL PadSpan data"),
      " and return the integration to a blank state. This includes:",
    ].filter(Boolean)),
    el("ul",{style:"color:#fcd5d5;font-size:13px;line-height:1.8;margin:10px 0 0 16px"},[
      el("li",{},"All calibration points and computed models"),
      el("li",{},"All uploaded floor maps, room polygons and receiver positions"),
      el("li",{},"Room model metadata (floor assignments, colors)"),
      el("li",{},"All BLE object labels and tag names"),
      el("li",{},"All follow alerts and notification settings"),
      el("li",{},"Movement history and traceback data"),
      el("li",{},"Adaptive learning fingerprints"),
      el("li",{},"All integration settings and scanner offsets"),
      el("li",{},"All backups stored within PadSpan"),
    ]),
  ]));

  wrap.appendChild(el("div",{style:"background:#1e293b;border:1px solid #334155;border-radius:8px;padding:14px;margin-bottom:16px;font-size:13px;color:#94a3b8;line-height:1.6"},[
    el("strong",{style:"color:#e2e8f0"},"What this does NOT delete: "),
    "Home Assistant areas, floors, entities, and devices are managed by HA itself and will not be touched. ",
    "You may want to remove those separately from Settings > Devices & Services after the reset.",
  ]));

  if(disabled){
    wrap.appendChild(el("div",{style:"font-weight:700;color:#fbbf24;font-size:14px;margin-bottom:12px"},
      "⚡ Switch to Live mode to enable factory reset."
    ));
    return wrap;
  }

  // Confirmation input — user must type "FACTORY RESET" exactly to unlock the button
  const confirmWrap = el("div",{style:"margin-bottom:16px"});
  confirmWrap.appendChild(el("div",{style:"font-size:13px;color:#94a3b8;margin-bottom:6px"},
    'To confirm, type FACTORY RESET in the box below:'
  ));

  const input = el("input",{
    type:"text",
    placeholder:"Type FACTORY RESET here",
    autocomplete:"off",
    spellcheck:"false",
    style:"width:100%;max-width:300px;padding:8px 12px;background:#0f172a;border:2px solid #475569;border-radius:6px;color:#e2e8f0;font-size:14px;font-family:monospace",
  });
  confirmWrap.appendChild(input);
  wrap.appendChild(confirmWrap);

  // Button area
  const btnWrap = el("div",{style:"display:flex;gap:12px;align-items:center"});

  const resetBtn = el("button",{
    class:"btn",
    style:"background:#7f1d1d;border:2px solid #dc2626;color:#fca5a5;font-weight:800;padding:10px 24px;font-size:14px;opacity:0.4;cursor:not-allowed",
    disabled:true,
  },"Erase All Data & Reset");

  const status = el("span",{style:"font-size:13px;color:#64748b"});

  // Enable button only when input matches
  input.addEventListener("input", ()=>{
    const match = input.value.trim() === "FACTORY RESET";
    resetBtn.disabled = !match;
    resetBtn.style.opacity = match ? "1" : "0.4";
    resetBtn.style.cursor = match ? "pointer" : "not-allowed";
  });

  // ── Progress UI (hidden until reset starts) ──
  // Shows a green progress bar, step label, and scrollable log of completed steps.
  const progressWrap = el("div",{style:"display:none;margin-top:16px"});
  const progressBar = el("div",{style:"width:100%;height:8px;background:#1e293b;border-radius:4px;overflow:hidden;margin-bottom:10px"});
  const progressFill = el("div",{style:"width:0%;height:100%;background:#52b788;border-radius:4px;transition:width 0.3s ease"});
  progressBar.appendChild(progressFill);
  progressWrap.appendChild(progressBar);
  const stepLabel = el("div",{style:"font-size:13px;color:#94a3b8;min-height:20px"});
  progressWrap.appendChild(stepLabel);
  const stepLog = el("div",{style:"font-size:11px;color:#64748b;margin-top:6px;max-height:180px;overflow-y:auto;font-family:monospace;line-height:1.7"});
  progressWrap.appendChild(stepLog);

  const _setProgress = (pct, label, isError=false) => {
    progressFill.style.width = pct + "%";
    progressFill.style.background = isError ? "#dc2626" : "#52b788";
    stepLabel.textContent = label;
    stepLabel.style.color = isError ? "#f87171" : "#94a3b8";
  };
  const _logStep = (msg, ok=true) => {
    const line = el("div",{style:"color:"+(ok?"#4ade80":"#f87171")}, (ok?"✓ ":"✗ ") + msg);
    stepLog.appendChild(line);
    stepLog.scrollTop = stepLog.scrollHeight;
  };
  const _pause = (ms=400) => new Promise(r => setTimeout(r, ms));

  resetBtn.addEventListener("click", async ()=>{
    if(input.value.trim() !== "FACTORY RESET") return;

    const sure = confirm(
      "FINAL WARNING\\n\\n" +
      "You are about to permanently erase ALL PadSpan data.\\n" +
      "This cannot be undone.\\n\\n" +
      "Are you absolutely sure?"
    );
    if(!sure) return;

    resetBtn.disabled = true;
    resetBtn.textContent = "Resetting…";
    input.disabled = true;
    progressWrap.style.display = "block";
    stepLog.innerHTML = "";

    // Block the 5s poll from calling renderRooms() while reset is in progress.
    // Without this flag, the poll would re-render the Manage tab and destroy
    // our progress bar DOM mid-operation.
    ctx.state._factoryResetInProgress = true;

    // ── Step 1: Send factory reset to backend (clears all 11 stores) ──
    _setProgress(15, "Erasing all backend stores…");
    let res;
    try {
      res = await ctx.actions.factoryReset();
      if(res && res.ok){
        _logStep(`Backend: ${res.cleared}/${res.total} stores cleared`);
      } else {
        const errs = (res?.errors || []).join(", ");
        _logStep(`Backend: ${res?.cleared || 0}/${res?.total || "?"} stores — errors: ${errs}`, false);
      }
    } catch(err) {
      _setProgress(15, "Backend reset failed: " + (err.message||err), true);
      _logStep("Backend reset failed: " + (err.message||err), false);
      resetBtn.textContent = "Erase All Data & Reset";
      resetBtn.disabled = false;
      input.disabled = false;
      ctx.state._factoryResetInProgress = false;
      return;
    }

    await _pause();

    // ── Step 2: Restore data_mode to "live" ──
    // Factory reset sets DEFAULT_SETTINGS which has data_mode:"sample".
    // The user was in live mode to reach this page — put them back.
    _setProgress(30, "Restoring live data mode…");
    try {
      await ctx.actions.wsCall("padspan_ha/settings_set", { data_mode: "live" });
      ctx.state.dataMode = "live";
      _logStep("Data mode restored to live");
    } catch(e){
      _logStep("Could not restore live mode: " + e.message, false);
    }

    await _pause();

    // ── Step 3: Clear browser-side caches ──
    _setProgress(45, "Clearing browser caches…");
    try {
      localStorage.removeItem("padspan_followed");
      localStorage.removeItem("padspan_followAddr");
      localStorage.removeItem("padspan_hiddenMapIds");
      _logStep("Browser localStorage cleared");
    } catch(e){
      _logStep("localStorage clear failed: " + e.message, false);
    }

    await _pause();

    // ── Step 4: Reset frontend in-memory state ──
    _setProgress(55, "Resetting frontend state…");
    try {
      ctx.state.followedAddrs = new Set();
      ctx.state.followAddr = "";
      ctx.state.objSearch = "";
      ctx.state.objKind = "all";
      ctx.state.objStatus = "all";
      ctx.state.selectedRooms = [];
      ctx.state.tagFilter = "";
      ctx.state.mode = "all";
      _logStep("Cleared: followed list, filters, selections");
    } catch(e){
      _logStep("Frontend state reset error: " + e.message, false);
    }

    await _pause();

    // ── Step 5: Verify settings on server ──
    _setProgress(70, "Verifying server state…");
    try {
      const sRes = await ctx.actions.wsCall("padspan_ha/settings_get", {});
      if(sRes?.settings){
        ctx.state.settings = sRes.settings;
        const serverFollowed = sRes.settings.followed_addrs || [];
        ctx.state.followedAddrs = new Set(serverFollowed);
        const dm = (sRes.settings.data_mode || "sample").toLowerCase();
        ctx.state.dataMode = dm === "live" ? "live" : "sample";
        _logStep(`Server: data_mode=${dm}, followed=${serverFollowed.length}`);
        if(serverFollowed.length > 0){
          _logStep("WARNING: server still has followed addresses", false);
        }
      } else {
        _logStep("Settings response empty", false);
      }
    } catch(e){
      _logStep("Settings verify failed: " + e.message, false);
    }

    await _pause();

    // ── Step 6: Fetch fresh snapshot (without re-rendering the page) ──
    _setProgress(85, "Fetching fresh snapshot…");
    try {
      const snapRes = await ctx.actions.wsCall("padspan_ha/live_snapshot", {});
      if(snapRes?.snapshot){
        ctx.state.live.snapshot = snapRes.snapshot;
        ctx.state.live.error = null;
        const objCount = snapRes.snapshot?.objects?.summary?.total ?? 0;
        const labelCount = (snapRes.snapshot?.objects?.list || []).filter(o => o.user_label).length;
        _logStep(`Snapshot: ${objCount} objects, ${labelCount} labelled`);
        if(labelCount > 0){
          _logStep("WARNING: labelled objects remain in snapshot", false);
        }
      } else {
        _logStep("Snapshot empty (BLE cache was cleared — objects will return as scanners detect them)");
      }
    } catch(e){
      _logStep("Snapshot fetch failed: " + e.message, false);
    }

    // ── Done ──
    _setProgress(100, "Factory reset complete");
    _logStep("All done. Click Reload Page to start fresh.");
    resetBtn.textContent = "Reset Complete";
    resetBtn.style.background = "#14532d";
    resetBtn.style.borderColor = "#16a34a";
    resetBtn.style.color = "#4ade80";
    ctx.state._factoryResetInProgress = false;

    const reloadBtn = el("button",{
      class:"btn",
      style:"background:#1e40af;border-color:#3b82f6;color:#93c5fd;font-weight:700;padding:8px 20px;margin-top:12px",
    },"Reload Page");
    reloadBtn.addEventListener("click",()=>location.reload());
    btnWrap.appendChild(reloadBtn);
  });

  btnWrap.appendChild(resetBtn);
  wrap.appendChild(btnWrap);
  wrap.appendChild(progressWrap);

  return wrap;
}

