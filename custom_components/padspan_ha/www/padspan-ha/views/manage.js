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
//   History          — A way to the History screen's Movement tab (the same log)
//   Events           — Email/phone alert configuration, a way to History → Movement
//   Logs             — Live integration log viewer with level filtering
//   Factory Reset    — Nuclear option: wipes all PadSpan stores + browser caches
//
// The Data tab is gated by a `disabled` flag: destructive actions require
// Live mode. In Sample mode the buttons render but are disabled, and a
// warning banner tells the user to switch.
// ══════════════════════════════════════════════════════════════════════════════

// Basic's links (views/focus.js): which lead out to an expert screen.
const FOCUS = await import(`./focus.js${new URL(import.meta.url).search}`);
// Its words in the panel's language (views/i18n.js; English is the key).
const { t, tn } = await import(`./i18n.js${new URL(import.meta.url).search}`);

export function render(ctx){
  const { el } = ctx.helpers;
  const root = el("section",{id:"manage"});
  root.className = ctx.state.view==="manage" ? "" : "hidden";

  // Default to the Data sub-tab on first visit
  if(!ctx.state.manageTab) ctx.state.manageTab = "data";
  const mTab = ctx.state.manageTab;
  const setTab = (tab) => { ctx.state.manageTab = tab; ctx.actions.renderRooms(); };

  const TABS = [
    ["data",t("Data")],
    ["ha_entities",t("HA Entities")],
    ["beacon_chars",t("Beacon Characteristics")],
    ["history",t("History")],
    ["events",t("Events")],
    ["logs",t("Logs")],
    ["factory_reset",t("Factory Reset")],
  ];

  const tabBar = el("div",{class:"tabs tabs-rows",style:"margin-bottom:12px;flex-wrap:wrap;gap:4px"});
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
  root.appendChild(el("div",{style:"background:#3d0c0c;border:2px solid #dc2626;border-radius:12px;padding:16px;margin-bottom:12px"},[
    el("div",{style:"display:flex;align-items:center;gap:8px;margin-bottom:6px"},[
      el("div",{style:"font-weight:800;font-size:15px;color:#fca5a5"},t("⚠  Danger Zone — Read before proceeding")),
      ctx.helpers.helpBtn("manage_data"),
    ]),
    el("div",{style:"font-size:13px;color:#fcd5d5;line-height:1.6"},
      t("Actions here directly modify Home Assistant. Deleting areas, entities, or BLE labels cannot be undone. Only proceed if you understand what you are changing.")
    ),
    dataMode !== "live"
      ? el("div",{style:"margin-top:10px;font-weight:700;color:#fbbf24"},t("⚡ Switch to Live mode to enable management actions."))
      : null,
  ].filter(Boolean)));

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
        el("div",{style:"font-weight:700;font-size:14px"},t("Orphan Room Polygons")),
        el("span",{class:"badge warn",style:"margin-left:8px"},tn(orphans.length, "{n} found", "{n} found")),
      ]));
      orphCard.appendChild(el("div",{style:"font-size:12px;color:#f59e0b;margin-bottom:10px"},
        t("These room polygons are in your map data but the room name does not exist in your HA area registry. They are likely ghost entries from sample mode.")
      ));

      const tbody = el("tbody");
      for(const {map, room, b} of orphans){
        const bw = el("div",{style:"display:flex;gap:4px"});
        // Each orphan row gets a Delete button that swaps to a Yes/No confirm
      // pattern (inline confirmation — no modal). On confirm, we rebuild the
      // map's room_bounds without the orphan key and push the whole map back
      // via mapsUpdate (the API expects the full room_bounds dict).
      const makeBtn = ()=>{
          const btn = el("button",{class:"btn tiny"+(disabled?" disabled":"")},t("Delete"));
          if(disabled) btn.disabled = true;
          btn.addEventListener("click", ()=>{
            bw.innerHTML = "";
            const yes = el("button",{class:"btn tiny",style:"background:#7f1d1d;border-color:#dc2626;white-space:nowrap"},t("Yes, delete"));
            const no  = el("button",{class:"btn tiny"},t("No"));
            yes.addEventListener("click", async()=>{
              bw.innerHTML = "";
              bw.appendChild(el("span",{class:"muted",style:"font-size:11px"},t("Deleting…")));
              try {
                // Re-fetch before rebuilding: this payload round-trips the
                // whole receivers list and room_bounds dict, and a tab left
                // open across a server-side image op (trim, rotate — which
                // renormalize every fraction) would push its OLD-space copy
                // back over the server's corrected one. The stack got this
                // guard first (issue #67); the geometry gets it now.
                await ctx.actions.mapsRefreshQuiet();
                const fresh = (ctx.state.maps?.list || []).find(x => x.id === map.id);
                if(!fresh){ throw new Error(t("map no longer exists")); }
                const newBounds = Object.fromEntries(
                  Object.entries(fresh.room_bounds || {}).filter(([r]) => r !== room)
                );
                await ctx.actions.mapsUpdate({
                  map_id: fresh.id,
                  receivers: fresh.receivers || [],
                  room_bounds: newBounds,
                  floor_id: fresh.floor_id || "",
                  calibration: fresh.calibration || {},
                  notes: fresh.notes || "",
                  // No `stack` key. Deleting an orphan room polygon is not a placement
                  // write, and round-tripping the CLIENT's copy of the stack lets a stale
                  // tab silently push back whatever it last saw - including a master flag
                  // another tab has since changed (issue #67). async_update_map only
                  // touches the stack when it is handed a dict, so omitting it preserves
                  // whatever the server holds.
                });
                await ctx.actions.mapsRefresh();
                ctx.toast(t("Deleted orphan \"{room}\" from {map}", { room, map: map.name||map.id }));
                ctx.actions.renderRooms();
              } catch(e){ bw.innerHTML = ""; bw.appendChild(makeBtn()); ctx.toast(t("Failed: {why}", { why: ctx.helpers.errorText(e) }), true); }
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
          el("td",{class:"muted",style:"font-size:11px"},t("{n} pts", { n: (b.points||[]).length })),
          el("td",{},bw),
        ]));
      }
      orphCard.appendChild(el("div",{class:"table-scroll"},el("table",{class:"table"},[
        el("thead",{},el("tr",{},[el("th",{},t("Orphan room")),el("th",{},t("Map")),el("th",{},t("Points")),el("th",{},"")])),
        tbody,
      ])));

      // Bulk delete: only shown when >1 orphan. Groups orphans by map to
    // minimise API calls — one mapsUpdate per affected map.
    if(orphans.length > 1){
        const delAllWrap = el("div",{style:"margin-top:10px;display:flex;gap:8px;align-items:center"});
        const makeDelAll = ()=>{
          const b = el("button",{class:"btn"+(disabled?" disabled":"")},t("Delete ALL orphans"));
          if(disabled) b.disabled = true;
          b.addEventListener("click", ()=>{
            delAllWrap.innerHTML = "";
            const yes = el("button",{class:"btn",style:"background:#7f1d1d;border-color:#dc2626"},t("Yes, delete all {n}", { n: orphans.length }));
            const no  = el("button",{class:"btn inline"},t("Cancel"));
            yes.addEventListener("click", async()=>{
              delAllWrap.innerHTML = "";
              delAllWrap.appendChild(el("span",{class:"muted",style:"font-size:12px"},t("Cleaning up…")));
              // Same stale-tab guard as the single delete: rebuild every
              // payload from a fresh fetch, never from this tab's copy. A
              // failed fetch says so and puts the button back (it sat at
              // "Cleaning up…" for good).
              try { await ctx.actions.mapsRefreshQuiet(); }
              catch(e){ ctx.toast(t("Couldn't load the maps: {why}", { why: ctx.helpers.errorText(e) }), true); delAllWrap.innerHTML = ""; delAllWrap.appendChild(makeDelAll()); return; }
              const freshList = ctx.state.maps?.list || [];
              // Group by map so we do one update per map
              const byMap = new Map();
              for(const {map, room} of orphans){
                if(!byMap.has(map.id)) byMap.set(map.id, {map, rooms: []});
                byMap.get(map.id).rooms.push(room);
              }
              let fail = 0;
              for(const {map, rooms} of byMap.values()){
                try {
                  const fresh = freshList.find(x => x.id === map.id);
                  if(!fresh){ fail++; continue; }
                  const newBounds = Object.fromEntries(
                    Object.entries(fresh.room_bounds || {}).filter(([r]) => !rooms.includes(r))
                  );
                  await ctx.actions.mapsUpdate({
                    map_id: fresh.id,
                    receivers: fresh.receivers || [],
                    room_bounds: newBounds,
                    floor_id: fresh.floor_id || "",
                    calibration: fresh.calibration || {},
                    notes: fresh.notes || "",
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
              ctx.toast(tn(orphans.length, "Removed {n} orphan polygon", "Removed {n} orphan polygons") + (fail ? " " + tn(fail, "({n} map failed)", "({n} maps failed)") : "") + ".");
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
    el("div",{style:"font-weight:700;font-size:14px"},t("BLE Device Labels")),
    el("span",{class:"badge",style:"margin-left:8px"},tn(taggedObjs.length, "{n} tagged", "{n} tagged")),
  ]));
  tagsCard.appendChild(el("div",{class:"muted",style:"font-size:12px;margin-bottom:10px"},
    t("Remove user-assigned labels from BLE devices. The device stays in the snapshot — it just loses its friendly name.")
  ));
  if(taggedObjs.length){
    const tbody = el("tbody");
    for(const o of taggedObjs){
      const addr = o.address || "";
      const ageTxt = o.age_s != null ? t("{n}s ago", { n: Math.round(o.age_s) }) : "—";
      const untagBtnWrap = el("div",{style:"display:flex;gap:4px"});
      const makeUntagBtn = ()=>{
        const b = el("button",{class:"btn tiny"+(disabled?" disabled":"")}, t("Untag"));
        if(disabled) b.disabled = true;
        b.addEventListener("click", ()=>{
          untagBtnWrap.innerHTML = "";
          const yes = el("button",{class:"btn tiny",style:"background:#7f1d1d;border-color:#dc2626"},t("Yes"));
          const no  = el("button",{class:"btn tiny"},t("No"));
          yes.addEventListener("click", async()=>{
            untagBtnWrap.innerHTML = "";
            try {
              await ctx.actions.objectLabelDelete(addr);
              ctx.toast(t("Label removed."));
              await ctx.actions.refreshSnapshot();
              ctx.actions.renderRooms();
            } catch(e){ ctx.toast(t("Failed: {why}", { why: ctx.helpers.errorText(e) }), true); untagBtnWrap.appendChild(makeUntagBtn()); }
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
      const b = el("button",{class:"btn"+(disabled?" disabled":"")},t("Remove all labels"));
      if(disabled) b.disabled = true;
      b.addEventListener("click", ()=>{
        clearAllWrap.innerHTML = "";
        const yes = el("button",{class:"btn",style:"background:#7f1d1d;border-color:#dc2626"},t("Yes, remove all {n}", { n: taggedObjs.length }));
        const no  = el("button",{class:"btn inline"},t("Cancel"));
        yes.addEventListener("click", async()=>{
          clearAllWrap.innerHTML = "";
          let ok=0, fail=0;
          for(const o of taggedObjs){ try { await ctx.actions.objectLabelDelete(o.address); ok++; } catch(e){ fail++; } }
          ctx.toast(tn(ok, "Removed {n} label", "Removed {n} labels") + (fail ? " " + t("({n} failed)", { n: fail }) : "") + ".");
          await ctx.actions.refreshSnapshot();
          ctx.actions.renderRooms();
        });
        no.addEventListener("click", ()=>{ clearAllWrap.innerHTML = ""; clearAllWrap.appendChild(makeClearAllBtn()); });
        clearAllWrap.appendChild(yes); clearAllWrap.appendChild(no);
      });
      return b;
    };
    clearAllWrap.appendChild(makeClearAllBtn());
    tagsCard.appendChild(el("div",{class:"table-scroll"},el("table",{class:"table"},[
      el("thead",{},el("tr",{},[el("th",{},t("Address")),el("th",{},t("Label")),el("th",{},t("Last seen")),el("th",{},"")])),
      tbody,
    ])));
    tagsCard.appendChild(clearAllWrap);
  } else {
    tagsCard.appendChild(el("div",{class:"muted",style:"font-size:12px"},t("No BLE devices have been tagged yet.")));
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
      el("div",{style:"font-weight:700;font-size:14px"},t("Phantom Room Entries")),
      el("span",{class:"badge warn",style:"margin-left:8px"},tn(phantomObjs.length, "{n} found", "{n} found")),
    ]));
    phantomCard.appendChild(el("div",{style:"font-size:12px;color:#f59e0b;margin-bottom:4px"},
      t("These entity IDs appear in PadSpan's room map but do not exist in Home Assistant. They are typically leftover sample data or stale entries from a previous install.")
    ));
    phantomCard.appendChild(el("div",{style:"font-size:11px;color:#78909c;margin-bottom:10px;padding:6px 8px;background:#0a150e;border-radius:6px;border:1px solid #2a1f00"},
      t("Removing them clears the phantom entries from PadSpan's room tracking — no HA entities are modified or deleted.")
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
      const b = el("button",{class:"btn"+(disabled?" disabled":"")},t("Clear phantom room data"));
      if(disabled) b.disabled = true;
      b.addEventListener("click", ()=>{
        purgeWrap.innerHTML = "";
        const yes = el("button",{class:"btn",style:"background:#7f1d1d;border-color:#dc2626;white-space:nowrap"},tn(phantomObjs.length, "Yes, remove {n} phantom entry", "Yes, remove {n} phantom entries"));
        const no  = el("button",{class:"btn inline"},t("Cancel"));
        yes.addEventListener("click", async()=>{
          purgeWrap.innerHTML = "";
          purgeWrap.appendChild(el("span",{class:"muted",style:"font-size:12px"},t("Clearing…")));
          try {
            const result = await ctx.actions.roomTagPurgeMissing();
            await ctx.actions.refreshSnapshot();
            ctx.toast(tn(result?.removed ?? phantomObjs.length, "Cleared {n} phantom entry from room map.", "Cleared {n} phantom entries from room map."));
            ctx.actions.renderRooms();
          } catch(e){
            ctx.toast(t("Failed: {why}", { why: ctx.helpers.errorText(e) }), true);
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
    el("div",{style:"font-weight:700;font-size:14px"},t("HA Entities")),
    el("span",{class:"badge warn",style:"margin-left:8px"},t("Destructive")),
    el("span",{class:"badge",style:"margin-left:4px"},tn(realObjs.length, "{n} found", "{n} found")),
  ]));
  entCard.appendChild(el("div",{class:"muted",style:"font-size:12px;margin-bottom:4px"},
    t("Permanently remove entities from Home Assistant's entity registry. Use this to clean up stale or duplicate tracker entities. Automations that reference removed entities will break.")
  ));
  entCard.appendChild(el("div",{style:"font-size:11px;color:#78909c;margin-bottom:10px;padding:6px 8px;background:#0a150e;border-radius:6px;border:1px solid #1b3526"},
    t("⚠ Entities managed by active integrations (e.g. Bermuda) will be recreated on the next integration poll. To remove permanently, disable the device or integration in HA.")
  ));
  if(realObjs.length){
    const entSearch = el("input",{type:"text",placeholder:t("Filter entities…"),style:"margin-bottom:8px;width:100%;box-sizing:border-box"});
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
          btnWrap.appendChild(el("span",{class:"muted",style:"font-size:11px"},t("Deleting…")));
          try {
            await ctx.actions.entityDelete(o.entity_id);
            if(row){ row.style.opacity = "0.35"; row.style.transition = "opacity 0.4s"; }
            statusDiv.textContent = t("✓ Removed from HA registry");
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
            ctx.toast(t("Delete failed: {why}", { why: o.entity_id }), true);
          }
        };

        const makeDelBtn = ()=>{
          const btn = el("button",{class:"btn tiny"+(disabled?" disabled":"")},t("Delete"));
          if(disabled) btn.disabled = true;
          btn.addEventListener("click", ()=>{
            // Another integration's entity: the two-step confirm of the
            // Private BLE delete (issue #57), naming the entity and its owner.
            const reg = ctx.hass && ctx.hass.entities && ctx.hass.entities[o.entity_id];
            const platform = reg && reg.platform;
            if(platform !== "padspan_ha"){
              const owner = platform
                ? t("It belongs to {name}, not PadSpan", { name: String(platform).split("_").map(w=>w.charAt(0).toUpperCase()+w.slice(1)).join(" ") })
                : t("PadSpan can't tell which integration it belongs to");
              if(!confirm(t("Delete {id}? {owner}; deleting it removes it from Home Assistant.", { id: o.entity_id, owner }))) return;
              if(!confirm(t("Are you sure? {id} will be deleted from Home Assistant. Automations that use it will break.", { id: o.entity_id }))) return;
              doDelete();
              return;
            }
            btnWrap.innerHTML = "";
            const yesBtn = el("button",{class:"btn tiny",style:"background:#7f1d1d;border-color:#dc2626;white-space:nowrap"},t("Yes, delete"));
            const noBtn  = el("button",{class:"btn tiny"},t("Cancel"));
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
            o.room ? el("div",{style:"font-size:11px;color:#52b788"},t("room: {room}", { room: o.room })) : null,
            statusDiv,
          ].filter(Boolean)),
          btnWrap,
        ]);
        entList.appendChild(row);
      }
      if(!filtered.length) entList.appendChild(el("div",{class:"muted",style:"font-size:12px"},t("No entities match.")));
    };
    entSearch.addEventListener("input",()=>renderEntList(entSearch.value));
    renderEntList("");
    entCard.appendChild(entSearch);
    entCard.appendChild(entList);
  } else {
    entCard.appendChild(el("div",{class:"muted",style:"font-size:12px"},ctx.state.dataMode === "sample" ? t("No HA entities found in snapshot. Switch to Live mode to see real entities.") : t("No HA entities found in snapshot.")));
  }
  root.appendChild(entCard);

  // ── HA Areas (Rooms) ─────────────────────────────────────────────────────────
  // Deletes areas from HA's Area Registry. Devices assigned to a deleted area
  // become unassigned. Any PadSpan room_meta (custom colors) for that area is
  // also lost. HA is the source of truth for areas — PadSpan just reads them.
  const areasCard = el("div",{class:"card"});
  areasCard.appendChild(el("div",{class:"row",style:"margin-bottom:8px"},[
    el("div",{style:"font-weight:700;font-size:14px"},t("HA Areas (Rooms)")),
    el("span",{class:"badge warn",style:"margin-left:8px"},t("Destructive")),
    el("span",{class:"badge",style:"margin-left:4px"},tn(haAreas.length, "{n} area", "{n} areas")),
  ]));
  areasCard.appendChild(el("div",{class:"muted",style:"font-size:12px;margin-bottom:10px"},
    t("Delete areas from the HA Area Registry. All devices assigned to a deleted area will become unassigned. Room color settings for the area are also removed.")
  ));
  if(haAreas.length){
    const tbody = el("tbody");
    for(const area of haAreas){
      const floor = haFloors.find(f=>f.id===area.floor_id);
      const floorLabel = floor ? floor.name : (area.floor_id||"—");
      const areaBtnWrap = el("div",{style:"display:flex;gap:4px"});
      const makeAreaDelBtn = ()=>{
        const b = el("button",{class:"btn tiny"+(disabled?" disabled":"")},t("Delete"));
        if(disabled) b.disabled = true;
        b.addEventListener("click", async()=>{
          // The two-step confirm of the Private BLE delete (issue #57).
          if(!confirm(t("Delete the area \"{name}\"? This deletes it from Home Assistant itself, not just PadSpan: every device and entity in it becomes unassigned.", { name: area.name }))) return;
          if(!confirm(t("Are you sure? \"{name}\" will be deleted from Home Assistant.", { name: area.name }))) return;
          areaBtnWrap.innerHTML = "";
          areaBtnWrap.appendChild(el("span",{class:"muted",style:"font-size:11px"},t("Deleting…")));
          try {
            await ctx.actions.areaDelete(area.id);
            await ctx.actions.modelRefresh();
            ctx.toast(t("Area \"{name}\" deleted.", { name: area.name }));
            ctx.actions.renderRooms();
          } catch(e){ areaBtnWrap.innerHTML = ""; areaBtnWrap.appendChild(makeAreaDelBtn()); ctx.toast(t("Failed: {why}", { why: ctx.helpers.errorText(e) }), true); }
        });
        return b;
      };
      areaBtnWrap.appendChild(makeAreaDelBtn());
      // A long ID may wrap after an underscore (a <wbr>, so copying it gives the plain ID).
      const idParts = String(area.id).split("_");
      tbody.appendChild(el("tr",{},[
        el("td",{style:"font-weight:600"},area.name),
        el("td",{class:"muted"},floorLabel),
        el("td",{style:"font-family:monospace;font-size:11px;color:#94a3b8"},
          idParts.flatMap((part,i)=> i < idParts.length-1 ? [part+"_", el("wbr")] : [part])),
        el("td",{},areaBtnWrap),
      ]));
    }
    // min-width:0: on a phone a long ID wraps instead of pushing Delete off the edge.
    areasCard.appendChild(el("div",{class:"table-scroll"},el("table",{class:"table",style:"min-width:0"},[
      el("thead",{},el("tr",{},[el("th",{},t("Name")),el("th",{},t("Floor")),el("th",{},t("ID")),el("th",{},"")])),
      tbody,
    ])));
  } else {
    areasCard.appendChild(el("div",{class:"muted",style:"font-size:12px"},t("No areas found.")));
  }
  root.appendChild(areasCard);

  // ── Uploaded Maps ────────────────────────────────────────────────────────────
  // Permanently deletes floor plans. The room shapes go with the map. Its
  // calibration points are kept, detached from any map, and still steer
  // k-NN (ws_maps.py -> calibration_store.async_clear_map: only points
  // without metres are deleted; delete=True, the per-map Clear, drops all).
  const maps = ctx.state.maps?.list || [];
  if(maps.length){
    const mapsCard = el("div",{class:"card"});
    mapsCard.appendChild(el("div",{class:"row",style:"margin-bottom:8px"},[
      el("div",{style:"font-weight:700;font-size:14px"},t("Uploaded Maps")),
      el("span",{class:"badge warn",style:"margin-left:8px"},t("Destructive")),
      el("span",{class:"badge",style:"margin-left:4px"},tn(maps.length, "{n} map", "{n} maps")),
    ]));
    mapsCard.appendChild(el("div",{class:"muted",style:"font-size:12px;margin-bottom:10px"},t("Permanently delete uploaded floor plan images.")));
    const tbody = el("tbody");
    for(const m of maps){
      const mapBtnWrap = el("div",{style:"display:flex;gap:4px"});
      const makeMapDelBtn = ()=>{
        const b = el("button",{class:"btn tiny"+(disabled?" disabled":"")},t("Delete"));
        if(disabled) b.disabled = true;
        b.addEventListener("click", ()=>{
          mapBtnWrap.innerHTML = "";
          const yes = el("button",{class:"btn tiny",style:"background:#7f1d1d;border-color:#dc2626;white-space:nowrap"},t("Yes, delete"));
          const no  = el("button",{class:"btn tiny"},t("No"));
          yes.addEventListener("click", async()=>{
            mapBtnWrap.innerHTML = "";
            try { await ctx.actions.mapsDelete(m.id); ctx.toast(t("Map \"{name}\" deleted.", { name: m.name })); }
            catch(e){ mapBtnWrap.appendChild(makeMapDelBtn()); ctx.toast(t("Failed: {why}", { why: ctx.helpers.errorText(e) }), true); }
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
    mapsCard.appendChild(el("div",{class:"table-scroll"},el("table",{class:"table"},[
      el("thead",{},el("tr",{},[el("th",{},t("Name")),el("th",{},t("File")),el("th",{},"")])),
      tbody,
    ])));
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
    bkCard.appendChild(el("div",{style:"font-weight:700;font-size:14px;margin-bottom:4px"},t("Backup & Restore")));
    bkCard.appendChild(el("div",{class:"muted",style:"font-size:12px;margin-bottom:14px"},
      t("Create snapshots of all PadSpan™ data stores and map images. Restore selectively.")
    ));

    const bkListWrap = el("div",{style:"margin-bottom:12px"});
    bkCard.appendChild(bkListWrap);

    // Friendly display names for internal store key strings.
    // These appear as checkbox labels in the selective-restore dialog.
    const _storeLabel = (k) => {
      const map = {
        "padspan_ha.settings": t("Settings"),
        "padspan_ha.calibration": t("Calibration"),
        "padspan_ha.adaptive": t("Adaptive Model"),
        "padspan_ha.objects": t("Objects"),
        "padspan_ha.maps": t("Maps Config"),
        "padspan_ha.model": t("Model"),
        "padspan_ha.follow_alerts": t("Alerts"),
        "padspan_ha.movement_history": t("Movement"),
        "padspan_ha.traceback": t("Traceback"),
        "padspan_ha.object_history": t("Object History"),
        "padspan_ha.house3d": "Live Aboard",
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
          bkListWrap.appendChild(el("div",{class:"muted",style:"font-size:12px"},t("No backups yet.")));
          return;
        }
        for(const bk of backups.reverse()){
          const bkRow = el("div",{style:"padding:10px 12px;border:1px solid #333;border-radius:8px;margin-bottom:8px;background:#0d1117"});
          const hdr = el("div",{style:"display:flex;justify-content:space-between;align-items:center;margin-bottom:4px"});
          hdr.appendChild(el("div",{style:"font-weight:600;font-size:13px"},
            (bk.note || t("Backup")) + (bk.version ? ` — v${bk.version}` : "")));
          hdr.appendChild(el("div",{class:"muted",style:"font-size:11px"},
            new Date(bk.created_at).toLocaleString()));
          bkRow.appendChild(hdr);
          bkRow.appendChild(el("div",{class:"muted",style:"font-size:11px;margin-bottom:8px"},
            tn(bk.store_count, "{n} store", "{n} stores") + (bk.map_image_count ? ", " + tn(bk.map_image_count, "{n} map image", "{n} map images") : "")));

          // Action buttons row
          const actRow = el("div",{style:"display:flex;gap:8px;align-items:center;flex-wrap:wrap"});

          // Restore button — opens an inline selective-restore dialog.
          // Each store key from the backup gets a checkbox (pre-checked).
          // Map images get a separate checkbox if the backup includes any.
          // "Select all / none" convenience buttons are provided.
          const restoreWrap = el("div",{style:"display:flex;gap:8px;align-items:center;flex-wrap:wrap"});
          const makeRestoreBtn = () => {
            const btn = el("button",{class:"btn tiny"+(disabled?" disabled":"")}, t("Restore…"));
            if(disabled) btn.disabled = true;
            btn.addEventListener("click", () => {
              restoreWrap.innerHTML = "";
              const dialog = el("div",{style:"padding:10px 12px;border:1px solid #1e4976;border-radius:8px;background:#0a1a2a;margin-top:6px"});
              dialog.appendChild(el("div",{style:"font-weight:600;font-size:12px;margin-bottom:8px;color:#7dd3fc"},t("Choose items to restore:")));
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
                    c.title = t("Maps and Model are restored together — a map's placement in metres lives in Model, keyed by map id.");
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
                lbl.appendChild(document.createTextNode(tn(bk.map_image_count, "Map Images ({n} file)", "Map Images ({n} files)")));
                dialog.appendChild(lbl);
                checkboxes.push(cb);
              }
              // Select all / none
              const selRow = el("div",{style:"display:flex;gap:8px;margin:8px 0 4px"});
              selRow.appendChild(el("button",{class:"btn tiny",style:"font-size:10px", onclick:()=>{ checkboxes.forEach(c=>c.checked=true); }},t("Select all")));
              selRow.appendChild(el("button",{class:"btn tiny",style:"font-size:10px", onclick:()=>{ checkboxes.forEach(c=>c.checked=false); }},t("Select none")));
              dialog.appendChild(selRow);
              // Confirm / cancel
              const btnRow = el("div",{style:"display:flex;gap:8px;margin-top:10px"});
              const confirmBtn = el("button",{class:"btn",style:"background:#1b4a2e;border-color:#52b788;font-size:12px"},t("Restore selected"));
              confirmBtn.addEventListener("click", async()=>{
                // Split selections: real store keys vs the synthetic __map_images__ key
                const selected = checkboxes.filter(c=>c.checked).map(c=>c.value);
                const storeKeysToRestore = selected.filter(s=>s!=="__map_images__");
                const restoreImages = selected.includes("__map_images__");
                if(!storeKeysToRestore.length && !restoreImages){
                  ctx.toast(t("Nothing selected to restore."), true);
                  return;
                }
                confirmBtn.disabled = true; confirmBtn.textContent = t("Restoring…");
                try {
                  const payload = { backup_id: bk.id };
                  if(storeKeysToRestore.length) payload.store_keys = storeKeysToRestore;
                  else payload.store_keys = [];
                  if(restoreImages) payload.restore_map_images = true;
                  const r = await ctx.actions.wsCall("padspan_ha/store_backup_restore", payload);
                  ctx.toast(tn(r.restored, "Restored {n} store", "Restored {n} stores") + (r.images_restored ? " + " + tn(r.images_restored, "{n} map image", "{n} map images") : "") +
                    ". " + t("Reload integration for full effect."));
                  restoreWrap.innerHTML = ""; restoreWrap.appendChild(makeRestoreBtn());
                } catch(e){
                  ctx.toast(t("Restore failed: {why}", { why: ctx.helpers.errorText(e) }), true);
                  restoreWrap.innerHTML = ""; restoreWrap.appendChild(makeRestoreBtn());
                }
              });
              btnRow.appendChild(confirmBtn);
              btnRow.appendChild(el("button",{class:"btn inline",style:"font-size:12px", onclick:()=>{
                restoreWrap.innerHTML = ""; restoreWrap.appendChild(makeRestoreBtn());
              }},t("Cancel")));
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
            const btn = el("button",{class:"btn tiny",style:"color:#f87171;border-color:#7f1d1d"+(disabled?" ;opacity:0.4":"")}, t("Delete"));
            if(disabled) btn.disabled = true;
            btn.addEventListener("click", () => {
              delWrap.innerHTML = "";
              const yes = el("button",{class:"btn tiny",style:"background:#7f1d1d;border-color:#dc2626"},t("Yes, delete"));
              const no = el("button",{class:"btn tiny"},t("No"));
              yes.addEventListener("click", async()=>{
                delWrap.innerHTML = "";
                try {
                  await ctx.actions.wsCall("padspan_ha/store_backup_delete", {backup_id: bk.id});
                  ctx.toast(t("Backup deleted."));
                  _renderBkList();
                } catch(e){ ctx.toast(t("Delete failed: {why}", { why: ctx.helpers.errorText(e) }), true); delWrap.innerHTML=""; delWrap.appendChild(makeDelBtn()); }
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
        bkListWrap.appendChild(el("div",{style:"color:#f87171;font-size:12px"},t("Failed to load backups: {why}", { why: String(e) })));
      }
    };

    // Create backup button — snapshots all stores + map images in one call
    const createWrap = el("div",{style:"display:flex;gap:8px;align-items:center"});
    const makeCreateBtn = () => {
      const btn = el("button",{class:"btn"+(disabled?" disabled":"")}, t("Create Backup"));
      if(disabled) btn.disabled = true;
      btn.addEventListener("click", async () => {
        btn.disabled = true; btn.textContent = t("Creating…");
        try {
          const r = await ctx.actions.wsCall("padspan_ha/store_backup_create", {note: "Manual backup"});
          ctx.toast(tn(r.store_count, "Backup created ({n} store).", "Backup created ({n} stores)."));
          _renderBkList();
        } catch(e){ ctx.toast(t("Backup failed: {why}", { why: ctx.helpers.errorText(e) }), true); }
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
  ctrlCard.appendChild(el("div",{style:"font-weight:700;font-size:14px;margin-bottom:8px"},t("Integration Controls")));
  ctrlCard.appendChild(el("div",{class:"muted",style:"font-size:12px;margin-bottom:14px"},t("Low-level control over the PadSpan™ HA integration.")));
  const ctrlGrid = el("div",{style:"display:flex;flex-direction:column;gap:10px"});

  const reloadWrap = el("div",{style:"display:flex;gap:8px;align-items:center"});
  const makeReloadBtn = ()=>{
    const b = el("button",{class:"btn"},t("Reload PadSpan™ HA integration"));
    b.addEventListener("click", ()=>{
      reloadWrap.innerHTML = "";
      const yes = el("button",{class:"btn",style:"background:#7f1d1d;border-color:#dc2626"},t("Yes, reload"));
      const no  = el("button",{class:"btn inline"},t("Cancel"));
      yes.addEventListener("click", async()=>{
        reloadWrap.innerHTML = "";
        reloadWrap.appendChild(el("span",{class:"muted",style:"font-size:12px"},t("Reloading…")));
        try { const res = await ctx.actions.integrationReload(); ctx.toast(tn(res?.reloaded??0, "Integration reloaded ({n} entry).", "Integration reloaded ({n} entries).")); reloadWrap.innerHTML = ""; reloadWrap.appendChild(makeReloadBtn()); }
        catch(e){ ctx.toast(t("Reload failed: {why}", { why: ctx.helpers.errorText(e) }), true); reloadWrap.innerHTML = ""; reloadWrap.appendChild(makeReloadBtn()); }
      });
      no.addEventListener("click", ()=>{ reloadWrap.innerHTML = ""; reloadWrap.appendChild(makeReloadBtn()); });
      reloadWrap.appendChild(yes); reloadWrap.appendChild(no);
    });
    return b;
  };
  reloadWrap.appendChild(makeReloadBtn());
  ctrlGrid.appendChild(el("div",{},[
    el("div",{style:"font-weight:600;margin-bottom:4px"},t("Reload integration")),
    el("div",{class:"muted",style:"font-size:12px;margin-bottom:6px"},t("Forces HA to reinitialize PadSpan™ HA without a full HA restart. Useful after config changes.")),
    reloadWrap,
  ]));

  const resetColorsWrap = el("div",{style:"display:flex;gap:8px;align-items:center"});
  const makeResetColorsBtn = ()=>{
    const b = el("button",{class:"btn"},t("Reset room color settings"));
    b.addEventListener("click", ()=>{
      resetColorsWrap.innerHTML = "";
      const yes = el("button",{class:"btn",style:"background:#7f1d1d;border-color:#dc2626"},t("Yes, reset colors"));
      const no  = el("button",{class:"btn inline"},t("Cancel"));
      yes.addEventListener("click", async()=>{
        resetColorsWrap.innerHTML = ""; resetColorsWrap.appendChild(makeResetColorsBtn());
        try { await ctx.actions.modelUpdate({room_meta:{}}); ctx.toast(t("Room color settings cleared.")); ctx.actions.renderRooms(); }
        catch(e){ ctx.toast(t("Failed: {why}", { why: ctx.helpers.errorText(e) }), true); }
      });
      no.addEventListener("click", ()=>{ resetColorsWrap.innerHTML = ""; resetColorsWrap.appendChild(makeResetColorsBtn()); });
      resetColorsWrap.appendChild(yes); resetColorsWrap.appendChild(no);
    });
    return b;
  };
  resetColorsWrap.appendChild(makeResetColorsBtn());
  ctrlGrid.appendChild(el("div",{},[
    el("div",{style:"font-weight:600;margin-bottom:4px"},t("Reset room colors")),
    el("div",{class:"muted",style:"font-size:12px;margin-bottom:6px"},t("Clears all custom room color picks. Colors regenerate from room names.")),
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
// i18n part: manage2
function _haEntities(ctx, el){
  const wrap = el("div",{style:"display:flex;flex-direction:column;gap:12px"});
  const settings = ctx.state.settings || {};
  wrap.appendChild(_haEntitiesIntro(el, ctx.helpers.helpBtn));
  wrap.appendChild(_haEntityControls(ctx, el, settings));
  wrap.appendChild(_haEntityAudit(ctx, el));
  wrap.appendChild(_haEntityLibrary(ctx, el));
  wrap.appendChild(_haMqttSection(ctx, el, settings));
  wrap.appendChild(_haBleReseedSection(ctx, el, settings));
  wrap.appendChild(_haEspresenseSection(ctx, el, settings));
  wrap.appendChild(_haTasmotaSection(ctx, el, settings));
  return wrap;
}

/**
 * Aggressive BLE Reseed — for Shelly and passive BLE proxies.
 * When enabled, reseeds from HA's discovered-service-info API every 5s
 * instead of 30s. Helps with HA 2026.4+ where habluetooth dedup
 * suppresses repeat callbacks from passive proxies.
 * The switch itself lives in Settings → Tracking → Receivers, beside the
 * Bluetooth refresh interval it caps (2026-10-30); this card says where.
 */
function _haBleReseedSection(ctx, el, settings){
  const card = el("div",{class:"card",style:"border-color:#26c6da"});

  const header = el("div",{style:"display:flex;align-items:center;gap:8px;margin-bottom:6px"});
  header.appendChild(el("span",{style:"font-weight:700;font-size:14px"},t("BLE Proxy Compatibility")));
  header.appendChild(el("span",{style:"font-size:10px;padding:2px 8px;border-radius:10px;border:1px solid #26c6da;color:#26c6da"},"HA 2026.4+"));
  card.appendChild(header);

  card.appendChild(el("div",{style:"font-size:12px;color:#94a3b8;line-height:1.5;margin-bottom:10px"},
    t("Enable this if Shelly BLE proxies or other passive Bluetooth relay scanners aren't showing RSSI values during calibration. This increases the BLE data reseed frequency from every 30 seconds to every 5 seconds, working around a deduplication change in HA 2026.4.")
  ));

  const go = el("button",{class:"btn inline","data-goto":"settings-receivers"},t("Open Settings"));
  go.addEventListener("click", ()=>{
    ctx.state.view = "settings";
    ctx.state._settingsTab = "presence";
    ctx.state._presenceReveal = "receivers";
    if (ctx.actions.renderNav) ctx.actions.renderNav();
    ctx.actions.renderRooms();
  });
  card.appendChild(el("div",{style:"display:flex;align-items:center;gap:8px;flex-wrap:wrap;font-size:12px"},[
    el("span",{style:"color:#e2e8f0"}, settings.aggressive_ble_reseed === true ? t("Aggressive BLE reseed is on.") : t("Aggressive BLE reseed is off.")),
    el("span",{style:"color:#94a3b8"},t("Set it in Settings → Tracking → Receivers (Bluetooth refresh interval).")),
    // The Bluetooth refresh interval is receiver tuning, Advanced's: Basic
    // has no Tracking tab to open, so no button (views/focus.js).
    FOCUS.expertLinks(ctx.state) ? go : null,
  ]));

  if(settings.aggressive_ble_reseed){
    card.appendChild(el("div",{style:"font-size:11px;color:#26c6da;margin-top:6px"},
      t("Active — reseeding from HA Bluetooth discovery every 5 seconds. This uses slightly more CPU but ensures Shelly and passive scanner data stays fresh.")
    ));
  }

  return card;
}

/** Static intro card explaining the four entity types PadSpan creates. */
function _haEntitiesIntro(el, helpBtn){
  return el("div",{class:"card",style:"border-color:#1b4a2e"},[
    el("div",{style:"display:flex;align-items:center;gap:8px"},[
      el("div",{style:"font-weight:800;font-size:15px;color:#5eead4;margin-bottom:6px"},t("PadSpan HA — Entity Reference")),
      helpBtn ? helpBtn("manage_entities") : null,
    ]),
    el("div",{style:"font-size:13px;color:#94a3b8;line-height:1.6"},
      t("PadSpan creates up to four HA entities for every labelled BLE device. This reference documents each entity type, its state values, attributes, and provides ready-to-paste automation examples.")
    ),
    el("div",{style:"font-size:12px;color:#64748b;margin-top:6px"},
      t("Tip: PadSpan's room_confidence and rssi_margin_confidence attributes let you build flicker-free automations that competing integrations cannot match.")
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
  card.appendChild(el("div",{style:"font-weight:700;font-size:14px;margin-bottom:4px"},t("Entity Publishing Controls")));
  card.appendChild(el("div",{class:"muted",style:"font-size:12px;margin-bottom:12px"},
    t("Disable entity types you don't need. Existing entities will be disabled in the HA registry. New devices won't create disabled types. Re-enabling restores them. Requires integration reload for new devices.")
  ));

  const types = [
    {key:"ha_entity_tracker_enabled", label:"device_tracker.{label}", desc:t("Person-linkable tracker (home/room state)")},
    {key:"ha_entity_area_enabled", label:"sensor.{label}_area", desc:t("Primary room sensor with confidence attributes")},
    {key:"ha_entity_distance_enabled", label:"sensor.{label}_distance", desc:t("Distance to nearest scanner (metres)")},
    {key:"ha_entity_scanner_distance_enabled", label:"sensor.{label}_distance_{scanner}", desc:t("Per-scanner distance for hyper-local triggers")},
    {key:"ha_entity_occupancy_enabled", label:"sensor.padspan_occupancy_occupancy", desc:t("Building occupancy estimate (min/estimate/max) — requires integration reload")},
    {key:"subzones_enabled", label:"binary_sensor.padspan_{sub-zone}_occupied", desc:t("Sub-zones: a bed, couch or desk drawn with the Sub-zones tool in Mapping → Edit; each gets an occupied and a who sensor (off: they go unavailable)")},
  ];

  for(const typ of types){
    const row = el("div",{style:"display:flex;align-items:center;gap:10px;padding:6px 0;border-bottom:1px solid #1b3526"});
    const chk = el("input",{type:"checkbox"});
    chk.checked = settings[typ.key] !== false;
    chk.addEventListener("change", async()=>{
      try {
        await ctx.actions.settingsSet({[typ.key]: chk.checked});
        ctx.toast(chk.checked ? t("{name} enabled — reload integration for new devices.", { name: typ.label }) : t("{name} disabled. Existing entities disabled in HA registry.", { name: typ.label }));
      } catch(e){ ctx.toast(t("Failed: {why}", { why: ctx.helpers.errorText(e) }), true); chk.checked = !chk.checked; }
    });
    row.appendChild(chk);
    row.appendChild(el("div",{style:"flex:1"},[
      el("div",{style:"font-family:monospace;font-size:12px;color:#5eead4"},typ.label),
      el("div",{class:"muted",style:"font-size:11px"},typ.desc),
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
  header.appendChild(el("span",{style:"font-weight:700;font-size:14px"},t("Live Entity Inventory")));
  card.appendChild(header);
  card.appendChild(el("div",{class:"muted",style:"font-size:12px;margin-bottom:12px"},
    t("All PadSpan entities registered in Home Assistant with current state, health, and automation usage.")
  ));

  // Placeholder that gets filled async
  const body = el("div",{});
  const loading = el("div",{class:"muted",style:"font-size:12px;padding:12px 0"},t("Loading entity data…"));
  body.appendChild(loading);
  card.appendChild(body);

  // Fire the WS call
  ctx.actions.wsCall("padspan_ha/ha_entities_audit", {}).then(res => {
    body.innerHTML = "";
    if(!res || !res.entities || !res.entities.length){
      body.appendChild(el("div",{class:"muted",style:"font-size:12px;padding:8px 0"},
        ctx.state.dataMode === "sample"
          ? t("No PadSpan entities found. Name a BLE device in Devices → By Room and switch to Live mode.")
          : t("No PadSpan entities found. Name a BLE device in Devices → By Room.")
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
    summary.appendChild(_pill(t("total"), res.total, "#5eead4"));
    if(bh.good)        summary.appendChild(_pill(t("healthy"), bh.good, "#52b788"));
    if(bh.stale)       summary.appendChild(_pill(t("stale"), bh.stale, "#f59e0b"));
    if(bh.unavailable) summary.appendChild(_pill(t("unavailable"), bh.unavailable, "#f87171"));
    if(bh.unknown)     summary.appendChild(_pill(t("unknown"), bh.unknown, "#94a3b8"));
    if(bh.disabled)    summary.appendChild(_pill(t("disabled"), bh.disabled, "#64748b"));
    summary.appendChild(_pill(t("used in automations"), res.total_used_in_automations, "#8b5cf6"));
    body.appendChild(summary);

    // ── Type breakdown ──────────────────────────────────────────────────
    const bt = res.by_type || {};
    const typeBar = el("div",{style:"display:flex;flex-wrap:wrap;gap:6px;margin-bottom:12px"});
    const _typeColors = {tracker:"#8b5cf6", area:"#10b981", distance:"#f59e0b", scanner_distance:"#06b6d4"};
    const _typeLabels = {tracker:"device_tracker", area:t("area sensor"), distance:t("distance sensor"), scanner_distance:t("scanner distance")};
    for(const [ty, c] of Object.entries(bt)){
      typeBar.appendChild(el("div",{style:`font-size:10px;padding:2px 8px;border-radius:10px;border:1px solid ${_typeColors[ty]||"#64748b"};color:${_typeColors[ty]||"#64748b"}`},
        `${c} ${_typeLabels[ty]||ty}`
      ));
    }
    body.appendChild(typeBar);

    // ── Entity table ─────────────────────────────────────────────────────
    const _healthIcon = (h) => {
      if(h === "good")        return {dot:"#52b788", label:t("Healthy")};
      if(h === "stale")       return {dot:"#f59e0b", label:t("Stale")};
      if(h === "unavailable") return {dot:"#f87171", label:t("Unavailable")};
      if(h === "disabled")    return {dot:"#64748b", label:t("Disabled")};
      if(h === "unknown")     return {dot:"#94a3b8", label:t("Unknown")};
      return {dot:"#64748b", label:h};
    };
    const _ago = (iso) => {
      if(!iso) return "—";
      const d = new Date(iso);
      const sec = Math.floor((Date.now() - d.getTime()) / 1000);
      if(sec < 0) return t("just now");
      if(sec < 60) return t("{n}s ago", { n: sec });
      if(sec < 3600) return t("{n}m ago", { n: Math.floor(sec/60) });
      if(sec < 86400) return t("{n}h ago", { n: Math.floor(sec/3600) });
      return t("{n}d ago", { n: Math.floor(sec/86400) });
    };

    const thead = el("thead",{},el("tr",{},[
      el("th",{style:"text-align:left"},t("Health")),
      el("th",{style:"text-align:left"},t("Entity")),
      el("th",{style:"text-align:left"},t("Type")),
      el("th",{style:"text-align:left"},t("State")),
      el("th",{style:"text-align:left"},t("Last Changed")),
      el("th",{style:"text-align:left"},t("Used By")),
      el("th",{style:"text-align:left"},t("Hint")),
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
        ent.room_confidence != null ? el("div",{style:"font-size:10px;color:#64748b"},t("conf: {pct}%", { pct: Math.round(ent.room_confidence * 100) })) : null,
      ].filter(Boolean));

      // Last changed
      const changedCell = el("td",{},[
        el("div",{style:"font-size:11px;color:#94a3b8;white-space:nowrap"},_ago(ent.last_changed)),
        ent.health === "stale" && ent.health_detail ? el("div",{style:"font-size:10px;color:#f59e0b"},ent.health_detail.replace(/— .*/,"")) : null,
      ].filter(Boolean));

      // Used by automations/scripts
      const usedParts = [];
      if(ent.automations.length){
        usedParts.push(el("div",{style:"font-size:10px;color:#8b5cf6"},tn(ent.automations.length, "{n} automation", "{n} automations")));
        for(const a of ent.automations.slice(0,2)){
          usedParts.push(el("div",{style:"font-size:10px;color:#64748b;padding-left:6px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:160px"},a));
        }
        if(ent.automations.length > 2) usedParts.push(el("div",{style:"font-size:10px;color:#64748b;padding-left:6px"},t("+{n} more", { n: ent.automations.length-2 })));
      }
      if(ent.scripts.length){
        usedParts.push(el("div",{style:"font-size:10px;color:#06b6d4"},tn(ent.scripts.length, "{n} script", "{n} scripts")));
      }
      if(!usedParts.length){
        usedParts.push(el("div",{style:"font-size:10px;color:#64748b;font-style:italic"},t("unused")));
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
      insights.push({color:"#fbbf24", text:t("None of your {n} entities are used in automations yet. Scroll down to the Entity Type Library for ready-to-paste examples.", { n: unusedCount })});
    } else if(unusedCount > 0){
      insights.push({color:"#fbbf24", text:tn(unusedCount, "{n} entity is not used in any automation or script. Check the hints column for ideas.", "{n} entities are not used in any automation or script. Check the hints column for ideas.")});
    }
    if(staleCount > 0){
      insights.push({color:"#f59e0b", text:tn(staleCount, "{n} entity hasn't changed state in 24+ hours — likely away or out of scanner range.", "{n} entities haven't changed state in 24+ hours — likely away or out of scanner range.")});
    }
    if(unavailCount > 0){
      insights.push({color:"#f87171", text:tn(unavailCount, "{n} entity is unavailable. Try reloading the integration from the Data tab.", "{n} entities are unavailable. Try reloading the integration from the Data tab.")});
    }
    const areaCount = (bt.area || 0);
    const trackerCount = (bt.tracker || 0);
    if(areaCount > 0 && trackerCount === 0){
      insights.push({color:"#8b5cf6", text:t("You have area sensors but no device trackers. Enable device_tracker above to link devices to Person entities.")});
    }
    if(res.total_used_in_automations > 0){
      insights.push({color:"#52b788", text:tn(res.total_used_in_automations, "{n} entity is actively used in automations — nice!", "{n} entities are actively used in automations — nice!")});
    }

    if(insights.length){
      const insightWrap = el("div",{style:"margin-top:10px;display:flex;flex-direction:column;gap:6px"});
      insightWrap.appendChild(el("div",{style:"font-weight:600;font-size:12px;margin-bottom:2px"},t("Tips")));
      for(const ins of insights){
        insightWrap.appendChild(el("div",{style:`font-size:11px;color:${ins.color};padding:4px 8px;background:#0a150e;border:1px solid #1b3526;border-radius:6px;line-height:1.4`},ins.text));
      }
      body.appendChild(insightWrap);
    }

  }).catch(err => {
    body.innerHTML = "";
    body.appendChild(el("div",{style:"font-size:12px;color:#f87171;padding:8px 0"},
      t("Failed to load entity data: {why}", { why: String(err?.message || err) })
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
  wrap.appendChild(el("div",{style:"font-weight:700;font-size:14px;color:#94a3b8;margin-bottom:2px"},t("Entity Type Library")));

  // ── 1. device_tracker — person-linkable room tracker ────────────────────
  wrap.appendChild(_entityCard(el, {
    id: "device_tracker.{label}",
    badge: t("Person-linkable"),
    badgeColor: "#8b5cf6",
    state: t("The Home Assistant room (area) name when home (e.g. \"Kitchen\"), \"not_home\" when away beyond timeout."),
    attrs: [
      ["address", t("BLE MAC or iBeacon UUID")],
      ["padspan_id", t("PadSpan's own ID for the device; it stays the same when the Bluetooth address changes")],
      ["rssi", t("Latest smoothed RSSI (dBm), null when away")],
      ["age_s", t("Seconds since last advertisement")],
      ["user_label", t("Friendly name assigned in PadSpan")],
      ["home", t("Boolean — true when seen within away timeout")],
      ["last_room", t("The room it was last placed in; still there once the state is not_home")],
    ],
    examples: [
      {
        title: t("Link to a Person entity"),
        desc: t("Go to HA Settings → People → select person → under \"Track devices\", add device_tracker.{label}. The person shows PadSpan's room only when no other tracker on that person says more: a phone's GPS (the Companion app) or a router's \"home\" wins over a room."),
        yaml: `# No YAML needed — this is configured in the HA UI:
# Settings → People → [person] → Track devices
# Add: device_tracker.alice_phone
#
# Once linked, person.alice shows the room name
# reported by PadSpan (e.g. "Kitchen", "Bedroom"),
# unless a GPS tracker (the Companion app) or a
# router saying "home" is also on the person:
# those win over a room.`,
      },
    ],
  }));

  // ── 2. sensor._area — primary room sensor with confidence attributes ───
  wrap.appendChild(_entityCard(el, {
    id: "sensor.{label}_area",
    badge: t("Primary room sensor"),
    badgeColor: "#10b981",
    state: t("Current room name (e.g. \"living_room\"), \"unknown\" if no room assigned, \"not_home\" when away."),
    attrs: [
      ["room_confidence", t("0.0–1.0 — fraction of vote window agreeing on this room (PadSpan-unique)")],
      ["rssi_margin_confidence", t("0.0–1.0 — how much stronger the winning room's signal is vs runner-up (PadSpan-unique)")],
      ["kind", t("\"ble\", \"private_ble\", or \"ibeacon\"")],
      ["address", t("BLE MAC address")],
      ["rssi", t("Kalman-smoothed RSSI (dBm), null when away")],
      ["age_s", t("Seconds since last BLE advertisement")],
      ["sources", t("List of scanner names currently hearing this device")],
      ["home", t("Boolean — true when within away timeout")],
      ["ibeacon_uuid", t("iBeacon UUID (only for iBeacon devices)")],
      ["all_addresses", t("All MAC addresses seen for this device (rotating BLE)")],
    ],
    examples: [
      {
        title: t("Confidence-gated room lighting"),
        desc: t("Only turn on lights when PadSpan is confident about the room — avoids flicker from momentary signal bounces."),
        yaml: `automation:
  - alias: "Kitchen lights on — confidence gated"
    trigger:
      - platform: state
        entity_id: sensor.alice_phone_area
        to: "kitchen"
    condition:
      - condition: numeric_state
        entity_id: sensor.alice_phone_area
        attribute: room_confidence
        above: 0.75
    action:
      - service: light.turn_on
        target:
          area_id: kitchen`,
      },
      {
        title: t("Multi-person room occupancy sensor"),
        desc: t("Template binary sensor that's ON when anyone is in a room. Uses Jinja to scan all PadSpan area sensors."),
        yaml: `template:
  - binary_sensor:
      - name: "Kitchen occupied"
        state: >-
          {{ states.sensor
             | selectattr('entity_id', 'in', integration_entities('padspan_ha'))
             | selectattr('entity_id', 'search', '_area$')
             | rejectattr('entity_id', 'search', '_distance_')
             | map(attribute='state')
             | select('eq', 'kitchen')
             | list | length > 0 }}
        device_class: occupancy`,
      },
      {
        title: t("Follow-me Sonos media"),
        desc: t("Move music to whatever room you walk into. Define a room→speaker mapping, then trigger on area change."),
        yaml: `automation:
  - alias: "Follow-me Sonos"
    trigger:
      - platform: state
        entity_id: sensor.alice_phone_area
    condition:
      - condition: numeric_state
        entity_id: sensor.alice_phone_area
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
        title: t("Room-based HVAC — flicker-free"),
        desc: t("Only heat occupied rooms. The confidence gate prevents the thermostat toggling when BLE signals fluctuate."),
        yaml: `automation:
  - alias: "Heat occupied rooms only"
    trigger:
      - platform: state
        entity_id: sensor.alice_phone_area
    condition:
      - condition: numeric_state
        entity_id: sensor.alice_phone_area
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
        title: t("Dashboard Markdown card — all devices"),
        desc: t("Shows every tracked PadSpan device with its current room and confidence percentage."),
        yaml: `type: markdown
title: PadSpan Presence
content: >-
  {% set sensors = states.sensor
     | selectattr('entity_id', 'in', integration_entities('padspan_ha'))
     | selectattr('entity_id', 'search', '_area$')
     | rejectattr('entity_id', 'search', '_distance_')
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
    id: "sensor.{label}_distance",
    badge: t("Proximity metre"),
    badgeColor: "#f59e0b",
    state: t("Distance in metres to nearest scanner (float, e.g. 2.3). Unavailable when away."),
    attrs: [
      ["rssi", t("Kalman-smoothed RSSI used for distance calculation")],
      ["tx_power", t("Advertised TX power (dBm) from the BLE device, if available")],
      ["age_s", t("Seconds since last advertisement")],
      ["room", t("Current room assignment")],
    ],
    examples: [
      {
        title: t("Wake desk PC when within 1.5 m"),
        desc: t("Uses numeric_state trigger to fire a Wake-on-LAN when you sit down at your desk."),
        yaml: `automation:
  - alias: "Wake desk PC on approach"
    trigger:
      - platform: numeric_state
        entity_id: sensor.alice_phone_distance
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
        title: t("Occupant counter — people within 3 m"),
        desc: t("Template sensor counting how many tracked people are within 3 metres of any scanner."),
        yaml: `template:
  - sensor:
      - name: "Nearby people"
        unit_of_measurement: "people"
        state: >-
          {{ states.sensor
             | selectattr('entity_id', 'in', integration_entities('padspan_ha'))
             | selectattr('entity_id', 'search', '_distance$')
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
    id: "sensor.{label}_distance_{scanner}",
    badge: t("Per-scanner hyper-local"),
    badgeColor: "#06b6d4",
    state: t("Distance in metres from this specific scanner to the device. Unavailable when not heard."),
    attrs: [
      ["scanner", t("Name of the ESPresense / Bluetooth Proxy node")],
      ["rssi", t("Kalman-smoothed RSSI from this specific scanner")],
      ["age_s", t("Seconds since this scanner last heard the device")],
      ["room", t("Current room assignment (from global scoring, not this scanner alone)")],
    ],
    examples: [
      {
        title: t("Bedside lamp — zone within a room"),
        desc: t("Fire when you're within 1.2 m of the bedroom proxy. This creates a micro-zone inside a room — unique to per-scanner distance."),
        yaml: `automation:
  - alias: "Bedside lamp on approach"
    trigger:
      - platform: numeric_state
        entity_id: sensor.alice_phone_distance_bedroom_proxy
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
        entity_id: sensor.alice_phone_distance_bedroom_proxy
        above: 2.0
        for: "00:00:10"
    action:
      - service: light.turn_off
        target:
          entity_id: light.bedside_lamp`,
      },
      {
        title: t("Closest scanner template"),
        desc: t("Template sensor that reports which scanner is nearest. Useful for room override logic or debugging."),
        yaml: `template:
  - sensor:
      - name: "Alice closest scanner"
        state: >-
          {% set ns = namespace(best='unknown', dist=999) %}
          {% for s in states.sensor
             | selectattr('entity_id', 'search',
                 'alice_phone_distance_')
             | selectattr('state', 'is_number') %}
            {% if s.state | float < ns.dist %}
              {% set ns.dist = s.state | float %}
              {% set ns.best = s.attributes.scanner | default(
                 s.entity_id | replace(
                   'sensor.alice_phone_distance_','')) %}
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
    el("div",{style:"font-weight:600;font-size:12px;margin-bottom:2px"},t("State")),
    el("div",{style:"font-size:12px;color:#94a3b8"},cfg.state),
  ]));

  // Attributes table
  if(cfg.attrs && cfg.attrs.length){
    card.appendChild(el("div",{style:"font-weight:600;font-size:12px;margin-bottom:4px"},t("Attributes")));
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
    card.appendChild(el("div",{style:"font-weight:600;font-size:12px;margin-bottom:6px"},t("Automation Examples")));
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
  headerBtn.appendChild(el("span",{style:"font-size:10px;color:#64748b;border:1px solid #2d4a38;padding:1px 6px;border-radius:8px"},"YAML"));

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

  const copyBtn = el("button",{style:"position:absolute;top:4px;right:4px;background:#1b3526;border:1px solid #2d5a3e;color:#5eead4;font-size:10px;padding:2px 8px;border-radius:6px;cursor:pointer"},t("Copy"));
  copyBtn.addEventListener("click", async()=>{
    try { await navigator.clipboard.writeText(ex.yaml); copyBtn.textContent = t("Copied!"); } catch(e){
      try {
        const tmp = document.createElement("textarea");
        tmp.value = ex.yaml; tmp.style.cssText = "position:fixed;left:-9999px";
        document.body.appendChild(tmp); tmp.select(); document.execCommand("copy");
        document.body.removeChild(tmp); copyBtn.textContent = t("Copied!");
      } catch(e2){ copyBtn.textContent = t("Failed"); }
    }
    setTimeout(()=>{ copyBtn.textContent = t("Copy"); }, 1500);
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
  header.appendChild(el("span",{style:"font-weight:700;font-size:14px"},t("MQTT Publishing")));
  header.appendChild(el("span",{style:"font-size:10px;padding:2px 8px;border-radius:10px;border:1px solid #f59e0b;color:#f59e0b"},t("Experimental")));
  card.appendChild(header);

  card.appendChild(el("div",{style:"font-size:12px;color:#94a3b8;line-height:1.5;margin-bottom:10px"},
    t("When enabled, PadSpan publishes device presence data to MQTT alongside HA entities. Useful for bridging to Node-RED, external dashboards, or non-HA systems.")
  ));

  card.appendChild(el("div",{style:"font-size:11px;color:#64748b;margin-bottom:8px;padding:6px 8px;background:#1a1200;border:1px solid #3d2e00;border-radius:6px"},
    t("Topics: padspan/devices/{label}/state • padspan/devices/{label}/area • padspan/devices/{label}/distance — Schema may change without notice.")
  ));

  const chk = el("input",{type:"checkbox"});
  chk.checked = settings.mqtt_publish_enabled === true;
  chk.addEventListener("change", async()=>{
    try {
      await ctx.actions.settingsSet({mqtt_publish_enabled: chk.checked});
      ctx.toast(chk.checked ? t("MQTT publishing enabled.") : t("MQTT publishing disabled."));
      ctx.actions.renderRooms();
    } catch(e){ ctx.toast(t("Failed: {why}", { why: ctx.helpers.errorText(e) }), true); chk.checked = !chk.checked; }
  });
  card.appendChild(el("label",{style:"display:flex;align-items:center;gap:8px;cursor:pointer;font-size:12px;margin-bottom:10px"},[
    chk, el("span",{},t("Enable experimental MQTT publishing")),
  ]));

  if(settings.mqtt_publish_enabled){
    card.appendChild(el("div",{style:"font-size:12px;color:#f59e0b;margin-bottom:8px"},t("MQTT publishing is active. Ensure MQTT integration is configured in HA.")));
    card.appendChild(_exampleBlock(el, {
      title: t("MQTT automation example"),
      desc: t("Trigger a Node-RED flow or external system when a device enters a room via MQTT."),
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
// Tasmota BLE over MQTT (tasmota_ble.py): a Tasmota device on an ESP32 that
// scans for Bluetooth becomes a scanner, read from stat/<topic>/BLE.
function _haTasmotaSection(ctx, el, settings){
  const card = el("div",{class:"card",style:"border-color:#8b5cf6"});
  card.appendChild(el("div",{style:"display:flex;align-items:center;gap:8px;margin-bottom:6px"},[
    el("span",{style:"font-weight:700;font-size:14px"},"Tasmota BLE"),
    el("span",{style:"font-size:10px;padding:2px 8px;border-radius:10px;border:1px solid #8b5cf6;color:#8b5cf6"},t("Experimental")),
  ]));
  card.appendChild(el("div",{style:"font-size:12px;color:#94a3b8;line-height:1.5;margin-bottom:10px"},
    t("Use Tasmota devices on ESP32 (smart plugs, Sonoff switches) as Bluetooth scanners. PadSpan reads the device list each one publishes on {topic} over MQTT, and after a Tasmota restart it sends that device BLEDevices to start the list again. Requires HA's MQTT integration.", { topic: "tele/<topic>/BLE" })
  ));
  const chk = el("input",{type:"checkbox"});
  chk.checked = settings.tasmota_ble_enabled === true;
  chk.addEventListener("change", async()=>{
    try {
      await ctx.actions.settingsSet({tasmota_ble_enabled: chk.checked});
      ctx.toast(chk.checked ? t("Tasmota BLE enabled — each device appears as a scanner when it next reports.") : t("Tasmota BLE disabled."));
      ctx.actions.renderRooms();
    } catch(e){ ctx.toast(t("Failed: {why}", { why: ctx.helpers.errorText(e) }), true); chk.checked = !chk.checked; }
  });
  card.appendChild(el("label",{style:"display:flex;align-items:center;gap:8px;cursor:pointer;font-size:12px"},[
    chk, el("span",{},t("Read Tasmota BLE over MQTT")),
  ]));
  // Tasmota's defaults are built for an occasional device list, not room
  // presence: a 300 s TelePeriod, a device kept listed 600 s after it was
  // last heard, and random addresses (phones, tags) filtered out.
  card.appendChild(el("div",{style:"font-size:11px;color:#94a3b8;line-height:1.6;margin-top:8px"},[
    el("div",{},t("On each Tasmota, in its console:")),
    el("div",{style:"font-family:monospace;color:#e2e8f0"},"TelePeriod 10"),
    el("div",{style:"font-family:monospace;color:#e2e8f0"},"BLEMaxAge 30"),
    el("div",{style:"font-family:monospace;color:#e2e8f0"},"BLEAddrFilter 1"),
    el("div",{},t("Readings older than about 15 s don't count for rooms; a device that left stays listed for BLEMaxAge; and without BLEAddrFilter 1 phones and tags with random addresses are never reported.")),
  ]));
  if(settings.tasmota_ble_enabled){
    card.appendChild(el("div",{style:"font-size:11px;color:#64748b;padding:6px 8px;margin-top:8px;background:#0f0a1a;border:1px solid #2d1b4e;border-radius:6px"},
      t("Topics: tele/+/BLE \u2022 stat/+/BLE. Place each Tasmota scanner in its room (Mapping) like any other.")
    ));
  }
  return card;
}

function _haEspresenseSection(ctx, el, settings){
  const card = el("div",{class:"card",style:"border-color:#8b5cf6"});

  const header = el("div",{style:"display:flex;align-items:center;gap:8px;margin-bottom:6px"});
  header.appendChild(el("span",{style:"font-weight:700;font-size:14px"},"ESPresense MQTT"));
  header.appendChild(el("span",{style:"font-size:10px;padding:2px 8px;border-radius:10px;border:1px solid #8b5cf6;color:#8b5cf6"},t("Experimental")));
  card.appendChild(header);

  card.appendChild(el("div",{style:"font-size:12px;color:#94a3b8;line-height:1.5;margin-bottom:10px"},
    t("Subscribe to ESPresense MQTT topics to receive BLE scanner data. Enable this if your ESP32 nodes run ESPresense firmware and publish to MQTT. Requires HA's MQTT integration to be configured.")
  ));

  // Enable toggle
  const chk = el("input",{type:"checkbox"});
  chk.checked = settings.espresense_mqtt_enabled === true;
  chk.addEventListener("change", async()=>{
    try {
      await ctx.actions.settingsSet({espresense_mqtt_enabled: chk.checked});
      ctx.toast(chk.checked ? t("ESPresense MQTT enabled — scanners should appear within 10 seconds.") : t("ESPresense MQTT disabled."));
      ctx.actions.renderRooms();
    } catch(e){ ctx.toast(t("Failed: {why}", { why: ctx.helpers.errorText(e) }), true); chk.checked = !chk.checked; }
  });
  card.appendChild(el("label",{style:"display:flex;align-items:center;gap:8px;cursor:pointer;font-size:12px;margin-bottom:10px"},[
    chk, el("span",{},t("Enable ESPresense MQTT ingestion")),
  ]));

  if(settings.espresense_mqtt_enabled){
    card.appendChild(el("div",{style:"font-size:12px;color:#8b5cf6;margin-bottom:8px"},t("ESPresense MQTT is active. Your ESPresense nodes should appear as scanners in the Bluetooth and Overview views.")));

    // Topic prefix
    const prefixRow = el("div",{style:"display:flex;align-items:center;gap:8px;margin-bottom:10px"});
    prefixRow.appendChild(el("span",{style:"font-size:12px;color:#94a3b8;white-space:nowrap"},t("Topic prefix:")));
    const prefixInput = el("input",{type:"text",value:settings.espresense_topic_prefix||"espresense",placeholder:"espresense"});
    prefixInput.style.cssText = "background:#0a150e;border:1px solid #2d5a3d;border-radius:6px;color:#e2e8f0;padding:4px 8px;font-size:12px;width:180px;box-sizing:content-box";
    const prefixSave = el("button",{class:"btn inline",style:"font-size:11px;padding:3px 10px"});
    prefixSave.textContent = t("Save");
    prefixSave.addEventListener("click", async()=>{
      // Strip MQTT wildcard chars ('#' multi-level, '+' single-level) — left in, they'd
      // corrupt the subscription topic built from this prefix in espresense_mqtt.py.
      const v = prefixInput.value.trim().replace(/#|\+/g,"").replace(/^\/|\/$/g,"");
      if(!v){ ctx.toast(t("Prefix cannot be empty"), true); return; }
      prefixSave.disabled = true;
      try {
        await ctx.actions.settingsSet({espresense_topic_prefix: v});
        ctx.toast(t("Topic prefix saved. Restart HA or toggle ESPresense off/on to apply."));
        prefixSave.textContent = t("Saved \u2714");
        setTimeout(()=>{ prefixSave.textContent = t("Save"); prefixSave.disabled = false; }, 2000);
      } catch(e){ ctx.toast(t("Failed: {why}", { why: ctx.helpers.errorText(e) }), true); prefixSave.disabled = false; }
    });
    prefixRow.appendChild(prefixInput);
    prefixRow.appendChild(prefixSave);
    card.appendChild(prefixRow);

    card.appendChild(el("div",{style:"font-size:11px;color:#64748b;padding:6px 8px;background:#0f0a1a;border:1px solid #2d1b4e;border-radius:6px"},
      t("Topics: {list}", { list: (settings.espresense_topic_prefix||"espresense") + "/devices/# \u2022 " + (settings.espresense_topic_prefix||"espresense") + "/rooms/#" })
    ));
  }

  // ── Companion Import ──────────────────────────────────────────────────
  card.appendChild(el("div",{style:"margin-top:14px;padding-top:12px;border-top:1px solid #2d1b4e"}));
  card.appendChild(el("div",{style:"display:flex;align-items:center;gap:8px;margin-bottom:4px"},[
    el("span",{style:"font-weight:700;font-size:13px;color:#a78bfa"}, t("Import from ESPresense Companion")),
    el("span",{style:"font-size:10px;padding:2px 8px;border-radius:10px;border:1px solid #8b5cf6;color:#8b5cf6"},t("Experimental")),
    ctx.helpers.helpBtn("manage_espresense_import"),
  ]));
  card.appendChild(el("div",{style:"font-size:11px;color:#94a3b8;line-height:1.5;margin-bottom:8px"},
    t("Import floor layouts, room boundaries, and scanner/node positions from ESPresense Companion. Coordinates are in metres — PadSpan imports them directly into its room and receiver layout. This is a merge — existing PadSpan data is preserved.")
  ));

  const urlRow = el("div",{style:"display:flex;align-items:center;gap:8px;margin-bottom:8px;flex-wrap:wrap"});
  urlRow.appendChild(el("span",{style:"font-size:12px;color:#94a3b8;white-space:nowrap"}, t("Companion URL:")));
  const urlInput = el("input",{type:"text",value:settings.espresense_companion_url||"",placeholder:"http://espresense:8267"});
  urlInput.style.cssText = "background:#0a150e;border:1px solid #2d5a3d;border-radius:6px;color:#e2e8f0;padding:4px 8px;font-size:12px;width:240px;box-sizing:content-box";
  const urlSave = el("button",{class:"btn inline",style:"font-size:11px;padding:3px 10px"});
  urlSave.textContent = t("Save URL");
  urlSave.addEventListener("click", async()=>{
    const v = urlInput.value.trim().replace(/\/$/,"");
    urlSave.disabled = true;
    try {
      await ctx.actions.settingsSet({espresense_companion_url: v});
      ctx.toast(v ? t("Companion URL saved.") : t("Companion URL cleared."));
      urlSave.textContent = t("Saved \u2714");
      setTimeout(()=>{ urlSave.textContent = t("Save URL"); urlSave.disabled = false; }, 2000);
    } catch(e){ ctx.toast(t("Failed: {why}", { why: ctx.helpers.errorText(e) }), true); urlSave.disabled = false; }
  });
  urlRow.appendChild(urlInput);
  urlRow.appendChild(urlSave);
  card.appendChild(urlRow);

  // Import button (only enabled when URL is configured)
  const importStatus = el("div",{style:"font-size:11px;color:#94a3b8;margin-top:6px"});
  const importBtn = el("button",{class:"btn inline",style:"font-size:12px;padding:4px 14px;border-color:#8b5cf6;color:#a78bfa"});
  importBtn.textContent = t("\u2B07 Import Now");
  if(!settings.espresense_companion_url){
    importBtn.disabled = true;
    importBtn.title = t("Save a Companion URL first");
  }
  importBtn.addEventListener("click", async()=>{
    importBtn.disabled = true; importBtn.textContent = t("Importing\u2026");
    importStatus.textContent = "";
    importStatus.style.color = "#94a3b8";
    try {
      const r = await ctx.actions.wsCall("padspan_ha/espresense_companion_import", {});
      importStatus.style.color = "#52b788";
      importStatus.textContent = "\u2714 " + t("Imported: {floors} floors, {rooms} rooms, {scanners} scanners", { floors: r.floors||0, rooms: r.rooms||0, scanners: r.scanners||0 })
        + (r.skipped ? " " + t("({n} skipped)", { n: r.skipped }) : "");
      ctx.toast(t("ESPresense Companion import complete!"));
    } catch(e){
      importStatus.style.color = "#f87171";
      importStatus.textContent = "\u2718 " + (e.message||String(e));
      ctx.toast(t("Import failed: {why}", { why: ctx.helpers.errorText(e) }), true);
    }
    importBtn.disabled = false; importBtn.textContent = t("\u2B07 Import Now");
  });
  card.appendChild(importBtn);
  card.appendChild(importStatus);

  return card;
}

// ══════════════════════════════════════════════════════════════════════════════
// History sub-tab — now a way to the History screen
//
// It drew the backend movement_history store as a timeline, the same entries
// the History screen's Movement tab draws (which also tells a first sighting
// from a room change, filters them and jumps to Traceback). Interface review,
// 2026-10-30: one place for it. The tab id stays so a remembered Manage tab
// still lands here.
// ══════════════════════════════════════════════════════════════════════════════
// i18n part: -
function _history(ctx, el){
  const open = () => {
    ctx.state._historyTab = "movement";
    if (ctx.actions.showView) ctx.actions.showView("history");
    else { ctx.state.view = "history"; ctx.actions.renderRooms(); }
  };
  return el("div",{class:"card","data-manage-history":"",style:"display:flex;align-items:center;gap:10px;flex-wrap:wrap"},[
    el("span",{style:"font-size:13px;color:#cbd5e1"},
      t("The saved room changes (who moved from which room to which, and when) are on the History screen, under Movement.")),
    el("button",{class:"btn inline","data-goto":"history-movement",onclick:open},t("Open History")),
  ]);
}

// ══════════════════════════════════════════════════════════════════════════════
// Events sub-tab — email alert configuration + a way to History → Movement
//
//   1. Email Notifications — saved alerts summary table + per-device editor
//      with email, service selection, room filter checkboxes, test button
//   2. A line and "Open History": the room changes are on the History
//      screen's Movement tab. (A "session event log" stood here. It read
//      ctx.state.followHistory, which nothing has written since Follow moved
//      onto the server's movement history, so it was always empty.)
//
// Also shows system diagnostics JSON if ctx.state.diag is populated.
// ══════════════════════════════════════════════════════════════════════════════
function _events(ctx, el){
  const wrap = el("div",{style:"display:flex;flex-direction:column;gap:12px"});

  // ── Email Notifications card ──────────────────────────────────────────────
  // Wrapped in try/catch because this section is complex and a crash here
  // should not prevent the rest of the Events tab from rendering.
  try {
    wrap.appendChild(_buildNotifications(ctx, el));
  } catch(e) {
    console.error("_buildNotifications crashed:", e);
    wrap.appendChild(el("div",{class:"card",style:"border-color:#7f1d1d"},[
      el("div",{style:"font-weight:700;color:#fca5a5"},t("Email Notifications — Error")),
      el("div",{style:"font-size:11px;color:#f87171;font-family:monospace;word-break:break-all;margin-top:4px"}, String(e?.message || e)),
    ]));
  }

  const openHistory = () => {
    ctx.state._historyTab = "movement";
    if (ctx.actions.showView) ctx.actions.showView("history");
    else { ctx.state.view = "history"; ctx.actions.renderRooms(); }
  };
  wrap.appendChild(el("div",{class:"card","data-manage-events-history":"",style:"display:flex;align-items:center;gap:10px;flex-wrap:wrap"},[
    el("span",{style:"font-size:13px;color:#cbd5e1"},
      t("The room changes of your devices (who moved from which room to which, and when) are on the History screen, under Movement.")),
    el("button",{class:"btn inline","data-goto":"history-movement",onclick:openHistory},t("Open History")),
  ]));

  const diag = ctx.state.diag;
  if(diag && Object.keys(diag).length){
    const diagCard = el("div",{class:"card"});
    diagCard.appendChild(el("div",{style:"font-weight:700;margin-bottom:8px"},t("System Diagnostics")));
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
  // An email or a picked notify target: a phone-only alert (no email) is a
  // saved alert too, and was missing from this list — so it could not be
  // seen or deleted here.
  const savedEntries = Object.entries(configs).filter(([,c]) => c && (c.email || c.notify_service));
  const savedCard = el("div",{class:"card"});
  const activeCount = savedEntries.filter(([,c]) => c.on_room_change).length;
  savedCard.appendChild(el("div",{class:"row",style:"margin-bottom:6px"},[
    el("div",{style:"font-weight:700;font-size:14px"},t("Saved Alerts")),
    ctx.helpers.helpBtn ? ctx.helpers.helpBtn("manage_events") : null,
    activeCount > 0
      ? el("span",{class:"badge",style:"margin-left:8px;border-color:#52b788;color:#52b788"},tn(activeCount, "{n} active", "{n} active"))
      : el("span",{class:"badge",style:"margin-left:8px;border-color:#64748b;color:#64748b"},t("none active")),
  ]));
  savedCard.appendChild(el("div",{class:"muted",style:"font-size:12px;margin-bottom:10px"},
    t("All saved email alert configurations. Alerts fire when a device changes rooms (via HA notify service).")
  ));

  if(!savedEntries.length){
    savedCard.appendChild(el("div",{class:"muted",style:"font-size:12px;padding:8px 0"},
      t("No alerts configured yet. Tag a device on the Devices screen, then set up alerts below or in the Follow tab.")
    ));
  } else {
    const thead = el("thead",{},el("tr",{},[
      el("th",{},t("Device")),
      el("th",{},t("Email")),
      el("th",{},t("Service")),
      el("th",{},t("Rooms")),
      el("th",{},t("Status")),
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

      const delBtn = el("button",{class:"btn tiny",style:"color:#ef5350;border-color:#7f1d1d;padding:2px 8px;font-size:11px"}, t("Delete"));
      delBtn.addEventListener("click", async ()=>{
        if(!confirm(t("Delete alert for \"{name}\"?", { name: label }))) return;
        delBtn.disabled = true; delBtn.textContent = "...";
        try {
          await ctx.actions.followAlertDelete(addr);
          ctx.toast(t("Alert for {name} deleted.", { name: label }));
          ctx.actions.renderRooms();
        } catch(e){
          delBtn.disabled = false; delBtn.textContent = t("Delete");
          ctx.toast(t("Delete failed: {why}", { why: ctx.helpers.errorText(e) }), true);
        }
      });

      tbody.appendChild(el("tr",{},[
        el("td",{style:"font-weight:600;font-size:12px;max-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap"},label),
        el("td",{style:"font-size:11px;max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-family:monospace"},cfg.email || "—"),
        el("td",{class:"muted",style:"font-size:11px"},svc),
        el("td",{class:"muted",style:"font-size:11px;max-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap"},rooms),
        el("td",{},
          active
            ? el("span",{style:"color:#52b788;font-size:11px;font-weight:600"},t("Active"))
            : el("span",{style:"color:#64748b;font-size:11px"},t("Off"))
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
    // Re-render if list changed (new service added, or still empty on first load)
    if(JSON.stringify(ctx.state._notifyServices) !== _prevServices){
      ctx.actions.renderRooms();
    }
  }).catch(e => {
    console.warn("PadSpan: notify services list failed", e);
  });

  const editCard = el("div",{class:"card"});
  editCard.appendChild(el("div",{style:"font-weight:700;font-size:14px;margin-bottom:4px"},t("Configure Alerts")));
  editCard.appendChild(el("div",{class:"muted",style:"font-size:12px;margin-bottom:14px"},
    t("Set up or edit email alerts for tracked devices. You can also configure per-device alerts in the Follow tab.")
  ));

  if(disabled){
    editCard.appendChild(el("div",{style:"font-size:12px;color:#fbbf24;margin-bottom:10px"},
      t("Switch to Live mode to configure and save alert settings.")
    ));
  }

  // Service discovery info + refresh
  const _svcList = ctx.state._notifyServices || [];
  const refreshBtn = el("button",{class:"btn tiny",style:"margin-left:8px"}, t("Refresh Services"));
  refreshBtn.addEventListener("click", () => {
    ctx.state._notifyServices = null;
    ctx.actions.renderRooms();
  });
  if(_svcList.length === 0){
    editCard.appendChild(el("div",{style:"background:#1a0a0a;border:1px solid #7f1d1d;border-radius:8px;padding:12px 14px;margin-bottom:12px"},[
      el("div",{style:"display:flex;align-items:center;gap:8px;margin-bottom:4px"},[
        el("div",{style:"font-weight:700;font-size:13px;color:#fca5a5"},t("No notification services found")),
        refreshBtn,
      ]),
      el("div",{style:"font-size:12px;color:#fca5a5;line-height:1.5"},
        t("PadSpan sends alerts via Home Assistant's notify integration. You need to set up a notification provider first:")
      ),
      el("div",{style:"font-size:11px;color:#94a3b8;margin-top:6px;line-height:1.6;padding-left:10px"},
        t("1. Go to HA Settings → Devices & Services → Add Integration\n2. Search for your notification provider (e.g. SMTP, Mobile App, Pushover, Telegram)\n3. Configure it with your email/credentials\n4. Restart HA, then click Refresh Services above")
      ),
    ]));
  } else {
    editCard.appendChild(el("div",{style:"display:flex;align-items:center;gap:8px;margin-bottom:10px;flex-wrap:wrap"},[
      el("span",{class:"badge",style:"border-color:#52b788;color:#52b788"},tn(_svcList.length, "{n} service found", "{n} services found")),
      el("span",{class:"muted",style:"font-size:10px"}, _svcList.join(", ")),
      refreshBtn,
    ]));
  }

  if(!trackable.length){
    editCard.appendChild(el("div",{class:"muted",style:"font-size:12px;padding:8px 0"},
      t("No tracked devices found. Tag BLE devices on the Devices screen or add device trackers to set up notifications.")
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
        ? el("span",{class:"badge",style:"margin-left:auto;border-color:#52b788;color:#52b788;font-size:10px"},t("Active"))
        : el("span",{class:"badge",style:"margin-left:auto;border-color:#64748b;color:#64748b;font-size:10px"},t("Off")),
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
    serviceSelect.appendChild(el("option",{value:""},t("Auto-detect")));
    for(const svc of (ctx.state._notifyServices || [])){
      const opt = el("option",{value:svc},svc);
      if(cfg.notify_service === svc) opt.selected = true;
      serviceSelect.appendChild(opt);
    }
    // A saved target that is gone has no option: shown and selected anyway
    // (as in Follow), so choosing anything else, Auto-detect included, is a change.
    const _saved = cfg.notify_service, _list = ctx.state._notifyServices || [];
    if(_saved && !_list.includes(_saved)){
      const opt = el("option",{value:_saved}, _list.length ? t("{name} (not found)", { name: _saved }) : _saved);
      opt.selected = true;
      serviceSelect.appendChild(opt);
    }
    serviceSelect.addEventListener("change", () => {
      cfg.notify_service = serviceSelect.value || undefined;
      ctx.state.followAlertConfig[addr] = cfg;
    });

    row.appendChild(el("div",{style:"display:flex;flex-wrap:wrap;gap:8px;align-items:flex-end;margin-bottom:8px"},[
      el("div",{style:"display:flex;flex-direction:column;gap:2px"},[
        el("div",{class:"muted",style:"font-size:10px"},t("Email")),
        emailInput,
      ]),
      el("div",{style:"display:flex;flex-direction:column;gap:2px"},[
        el("div",{class:"muted",style:"font-size:10px"},t("Service")),
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
        chkChange, el("span",{},t("Alert on room change")),
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
        el("div",{class:"muted",style:"font-size:10px;margin-bottom:3px"},t("Only these rooms (unchecked = all):")),
        el("div",{style:"display:flex;flex-wrap:wrap;gap:6px"},roomChecks),
      ]));
    }

    // Save + Test
    const saveStatus = el("span",{class:"muted",style:"font-size:11px;max-width:300px;line-height:1.3"});
    const saveBtn = el("button",{class:"btn"+(disabled?" disabled":""),style:"background:#1b4a2e;border-color:#52b788;font-weight:700"}, t("Save Alert"));
    if(disabled) saveBtn.disabled = true;
    saveBtn.addEventListener("click", async () => {
      if(disabled){ saveStatus.textContent = t("Live mode required."); saveStatus.style.color = "#fbbf24"; return; }
      if(cfg.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(cfg.email)){
        saveStatus.textContent = t("Invalid email format."); saveStatus.style.color = "#f87171"; return;
      }
      saveStatus.textContent = t("Saving…"); saveStatus.style.color = "";
      try {
        await ctx.actions.followAlertSave({ addr, config: cfg });
        saveStatus.textContent = t("Saved!"); saveStatus.style.color = "#52b788";
        ctx.actions.renderRooms();
      } catch(e){
        saveStatus.textContent = t("Save failed: {why}", { why: e?.message || String(e) }); saveStatus.style.color = "#f87171";
      }
    });

    const testBtn = el("button",{class:"btn tiny"+(disabled?" disabled":"")}, t("Test Notification"));
    if(disabled) testBtn.disabled = true;
    testBtn.addEventListener("click", async () => {
      if(disabled){ saveStatus.textContent = t("Live mode required."); saveStatus.style.color = "#fbbf24"; return; }
      const testEmail = (emailInput.value || "").trim();
      saveStatus.textContent = t("Sending test…"); saveStatus.style.color = "";
      testBtn.disabled = true;
      try {
        // The target alerts use (cfg).
        const svc = cfg.notify_service || "";
        const payload = { service: svc || undefined };
        if(testEmail) payload.email = testEmail;
        await ctx.actions.wsCall("padspan_ha/notify_test", payload);
        saveStatus.textContent = t("Test sent — check your notification app/inbox."); saveStatus.style.color = "#52b788";
      } catch(e){
        // Whole: cut at 120 it lost the advice ("pick where to send again").
        saveStatus.textContent = (e?.message || String(e));
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

  const refreshBtn = el("button", { class: "btn" }, t("Refresh"));
  refreshBtn.addEventListener("click", () => fetchLogs());

  const toolbar = el("div", { style: "display:flex;gap:8px;align-items:center;margin-bottom:12px;flex-wrap:wrap" }, [
    el("span", { style: "font-weight:600;font-size:13px" }, t("Min level:")),
    levelSel,
    refreshBtn,
    ctx.helpers.helpBtn ? ctx.helpers.helpBtn("manage_logs") : null,
  ]);
  wrap.appendChild(toolbar);

  const data = ctx.state._logsData;
  if (ctx.state._logsLoading) {
    wrap.appendChild(el("div", { class: "muted" }, t("Loading logs...")));
    return wrap;
  }
  if (!data) {
    wrap.appendChild(el("div", { class: "muted" }, t("Fetching logs...")));
    return wrap;
  }
  if (data.error) {
    wrap.appendChild(el("div", { class: "card warn" }, [
      el("div", { style: "font-weight:700" }, t("Failed to fetch logs")),
      el("div", { class: "muted" }, data.error),
    ]));
    return wrap;
  }

  const entries = data.entries || [];
  wrap.appendChild(el("div", { class: "muted", style: "margin-bottom:8px;font-size:12px" },
    t("Showing {shown} of {total} buffered entries (newest first). Buffer holds up to 500 entries since last restart.", { shown: entries.length, total: data.total || 0 })));

  if (!entries.length) {
    wrap.appendChild(el("div", { class: "card" }, el("div", { class: "muted", style: "padding:12px 0" },
      t("No {level}+ log entries yet. PadSpan logs appear here as the integration runs.", { level: ctx.state._logsLevel }))));
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
//   - Show/hide toggle for the report (beacon_profiling_enabled)
//   - Group/Ungroup: override the report's auto-grouping for one beacon
//   - Display only: no setting here is read by positioning or adaptive tuning
//   - Collapsible per-scanner breakdown table (mean RSSI, std, point count)
//   - All overrides persisted to settings via beacon_tune_disabled and
//     beacon_group_overrides keys
// ══════════════════════════════════════════════════════════════════════════════
function _beaconChars(ctx, el){
  const wrap = el("div",{style:"max-width:900px"});
  const settings = ctx.state.settings || {};

  // Header
  wrap.appendChild(el("div",{style:"display:flex;align-items:center;gap:8px"},[
    el("div",{style:"font-weight:700;font-size:16px;color:#e2e8f0;margin-bottom:8px"}, t("Beacon Signal Profiles")),
    ctx.helpers.helpBtn ? ctx.helpers.helpBtn("manage_beacon_chars") : null,
  ]));
  wrap.appendChild(el("div",{style:"font-size:12px;color:#94a3b8;margin-bottom:12px;line-height:1.5"},
    t("Per-beacon signal characteristics computed from calibration data, grouped by model (iBeacon UUID prefix, manufacturer, BLE name). A report: it shows how each beacon reads, and nothing here changes positioning.")));

  // ── Master toggle ──
  const masterEnabled = settings.beacon_profiling_enabled !== false;
  const toggleRow = el("div",{style:"display:flex;align-items:center;gap:12px;margin-bottom:16px;padding:10px 14px;border-radius:8px;"
    + `background:${masterEnabled ? "rgba(22,163,74,.08)" : "rgba(220,38,38,.08)"};border:1px solid ${masterEnabled ? "#16a34a" : "#dc2626"}`});
  // Show/hide only: nothing in the backend reads beacon_profiling_enabled for
  // positioning (it said "model defaults applied" / "raw calibration data
  // only" — neither was true).
  toggleRow.appendChild(el("div",{style:"font-weight:700;font-size:13px;color:#e2e8f0;flex:1"},
    t("Beacon profiles")));
  const masterBtn = el("button",{
    style:`font-size:12px;padding:4px 14px;border-radius:4px;cursor:pointer;font-weight:700;border:1px solid ${masterEnabled?"#16a34a":"#dc2626"};background:${masterEnabled?"#052e16":"#3d0c0c"};color:${masterEnabled?"#4ade80":"#fca5a5"}`,
  }, masterEnabled ? t("Shown") : t("Hidden"));
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
    masterEnabled ? t("Showing the signal profile report")
                  : t("The report is hidden")));
  wrap.appendChild(toggleRow);

  if (!masterEnabled) {
    wrap.appendChild(el("div",{style:"color:#94a3b8;font-size:13px;padding:20px;text-align:center"},
      t("Show beacon profiles above to see the report.")));
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
  const refreshBtn = el("button",{class:"btn",style:"margin-bottom:12px;font-size:12px"},t("Refresh Profiles"));
  refreshBtn.addEventListener("click", refresh);
  wrap.appendChild(refreshBtn);

  // Auto-fetch on first render
  if (!ctx.state._bcProfiles && !ctx.state._bcLoading) {
    setTimeout(refresh, 50);
    wrap.appendChild(el("div",{style:"color:#94a3b8;font-size:13px;padding:20px"},t("Loading profiles…")));
    return wrap;
  }
  if (ctx.state._bcLoading) {
    wrap.appendChild(el("div",{style:"color:#94a3b8;font-size:13px;padding:20px"},t("Loading…")));
    return wrap;
  }

  const profiles = ctx.state._bcProfiles;
  if (!profiles || !profiles.beacons || profiles.beacons.length === 0) {
    wrap.appendChild(el("div",{style:"color:#94a3b8;font-size:13px;padding:20px"},
      t("No beacon calibration data yet. Use Beacon Tune or Calibration Guide to collect data.")));
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
      tn(group.length, "{n} beacon", "{n} beacons") + " · " + t("{n} cal points", { n: mData.total_cal_points||0 })));
    card.appendChild(hdr);

    // Model defaults row
    const defaults = el("div",{style:"display:flex;gap:16px;flex-wrap:wrap;font-size:12px;color:#cbd5e1;margin-bottom:10px;padding:6px 8px;background:rgba(59,130,246,.06);border-radius:6px"});
    if (mData.default_avg_rssi != null) defaults.appendChild(el("span",{},t("Avg RSSI: {v} dBm", { v: mData.default_avg_rssi })));
    if (mData.default_avg_std != null) defaults.appendChild(el("span",{},t("Variance: ±{v}", { v: mData.default_avg_std })));
    if (mData.default_scanner_reach != null) defaults.appendChild(el("span",{},t("Reach: {v} scanners", { v: mData.default_scanner_reach })));
    if (mData.default_multi_radio_pct != null) defaults.appendChild(el("span",{},t("Multi-radio: {v}%", { v: Math.round(mData.default_multi_radio_pct*100) })));
    if (mData.default_tx_power != null) defaults.appendChild(el("span",{},t("TX Power: {v} dBm", { v: mData.default_tx_power })));
    card.appendChild(defaults);

    // Per-beacon table
    const tbl = el("table",{style:"width:100%;border-collapse:collapse;font-size:11px"});
    const thead = el("tr",{style:"color:#94a3b8;text-align:left;border-bottom:1px solid #2d4a38"});
    for (const h of [t("Beacon"),t("Points"),t("Scanners"),t("Avg Reach"),t("Multi%"),t("Avg RSSI"),t("Variance"),t("Cells"),t("Group")]) {
      thead.appendChild(el("th",{style:"padding:4px 6px;font-weight:600"},h));
    }
    tbl.appendChild(thead);

    for (const b of group) {
      const tr = el("tr",{style:"border-bottom:1px solid #1b3526"});
      const lbl = b.label || b.device_id.substring(0,16);
      tr.appendChild(el("td",{style:"padding:4px 6px;color:#e2e8f0;max-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap",title:b.device_id},lbl));
      tr.appendChild(el("td",{style:"padding:4px 6px"},String(b.cal_points)));
      tr.appendChild(el("td",{style:"padding:4px 6px"},String(b.scanners_total)));
      tr.appendChild(el("td",{style:"padding:4px 6px"},String(b.avg_scanner_reach)));
      tr.appendChild(el("td",{style:"padding:4px 6px"},`${Math.round(b.multi_radio_pct*100)}%`));
      tr.appendChild(el("td",{style:"padding:4px 6px"},b.avg_rssi != null ? `${b.avg_rssi}` : "—"));
      tr.appendChild(el("td",{style:"padding:4px 6px"},b.avg_std != null ? `±${b.avg_std}` : "—"));
      tr.appendChild(el("td",{style:"padding:4px 6px"},String(b.grid_cells_hit)));

      // (A per-beacon "Tune" On/Off column stood here, labelled "exclude from
      // adaptive tuning". Adaptive tuning never read beacon_tune_disabled, so
      // it did nothing. Removed; the setting stays accepted for old files.)

      // Group action — the backend auto-groups beacons by model (iBeacon UUID
      // prefix, manufacturer, BLE name) so a new beacon of a known type can
      // inherit that model's signal defaults immediately instead of starting
      // cold with zero calibration data. That's usually right, but two
      // identical-model beacons can still sit in very different real-world
      // spots (a thin phone case vs. a thick wallet, a pocket vs. a bag) and
      // end up with meaningfully different signal behaviour despite sharing
      // a model key. "Ungroup" (Solo) lets one such beacon opt out of the
      // shared model and build its own independent profile from its own
      // calibration data only; "Regroup" reverses that, deleting the
      // override so it falls back to the auto-computed model key next
      // render. The `solo:<device_id prefix>` value is just a unique key,
      // never re-parsed — its ONLY job is to not collide with any real
      // model_key a grouping pass could produce, so this beacon's effective
      // model is guaranteed to contain nobody else.
      const grpTd = el("td",{style:"padding:4px 6px"});
      const isOverridden = !!overrides[b.device_id];
      if (group.length > 1 || isOverridden) {
        if (!isOverridden) {
          const ungroupBtn = el("button",{
            style:"font-size:10px;padding:2px 6px;border-radius:3px;cursor:pointer;border:1px solid #f59e0b;background:#451a03;color:#fcd34d",
          },t("Ungroup"));
          ungroupBtn.title = t("Show this beacon on its own row (the report only)");
          ungroupBtn.addEventListener("click", () => {
            ctx.state._bcGroupOverrides[b.device_id] = `solo:${b.device_id.substring(0,12)}`;
            _saveBC();
            ctx.actions.renderRooms();
          });
          grpTd.appendChild(ungroupBtn);
        } else {
          const regroupBtn = el("button",{
            style:"font-size:10px;padding:2px 6px;border-radius:3px;cursor:pointer;border:1px solid #3b82f6;background:#1e3a5f;color:#93c5fd",
          },t("Regroup"));
          regroupBtn.title = t("Put it back with its model (the report only)");
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
    },t("Show per-scanner details ▸"));
    const detailDiv = el("div",{style:"display:none;margin-top:8px"});

    detailBtn.addEventListener("click", () => {
      const vis = detailDiv.style.display !== "none";
      detailDiv.style.display = vis ? "none" : "block";
      detailBtn.textContent = vis ? t("Show per-scanner details ▸") : t("Hide per-scanner details ▾");
    });
    card.appendChild(detailBtn);

    // Per-scanner detail table
    const allScanners = new Set();
    for (const b of group) {
      for (const src of Object.keys(b.per_scanner || {})) allScanners.add(src);
    }
    if (allScanners.size > 0) {
      const st = el("table",{style:"width:100%;border-collapse:collapse;font-size:10px;margin-top:4px"});
      const sHead = el("tr",{style:"color:#94a3b8;text-align:left;border-bottom:1px solid #2d4a38"});
      sHead.appendChild(el("th",{style:"padding:3px 5px"},t("Beacon")));
      for (const src of allScanners) {
        sHead.appendChild(el("th",{style:"padding:3px 5px;max-width:80px;overflow:hidden;text-overflow:ellipsis",title:src},
          ctx.helpers.radioName(src) || scanner_names[src] || src.substring(0,12)));
      }
      st.appendChild(sHead);

      for (const b of group) {
        const sr = el("tr",{style:"border-bottom:1px solid #1b3526"});
        sr.appendChild(el("td",{style:"padding:3px 5px;color:#cbd5e1"},b.label||b.device_id.substring(0,12)));
        for (const src of allScanners) {
          const ps = (b.per_scanner || {})[src];
          if (ps) {
            const color = ps.mean_rssi > -60 ? "#4ade80" : ps.mean_rssi > -75 ? "#fbbf24" : "#f87171";
            sr.appendChild(el("td",{style:`padding:3px 5px;color:${color}`},
              `${ps.mean_rssi} (±${ps.std_rssi}) ×${ps.point_count}`));
          } else {
            sr.appendChild(el("td",{style:"padding:3px 5px;color:#64748b"},"—"));
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
    el("div",{style:"font-weight:700;font-size:15px;color:#fca5a5"},t("Factory Reset")),
    ctx.helpers.helpBtn("manage_factory_reset"),
  ]));

  const dataMode = ctx.state.dataMode || "sample";
  const disabled = dataMode !== "live";

  // Warning banner
  wrap.appendChild(el("div",{style:"background:#3d0c0c;border:3px solid #dc2626;border-radius:12px;padding:20px;margin-bottom:16px"},[
    el("div",{style:"font-weight:900;font-size:18px;color:#fca5a5;margin-bottom:10px"},t("⚠  FACTORY RESET")),
    el("div",{style:"font-size:14px;color:#fcd5d5;line-height:1.7"},[
      t("This will "),
      el("strong",{style:"color:#f87171"},t("permanently delete ALL PadSpan data")),
      t(" and return the integration to a blank state. This includes:"),
    ].filter(Boolean)),
    el("ul",{style:"color:#fcd5d5;font-size:13px;line-height:1.8;margin:10px 0 0 16px"},[
      el("li",{},t("All calibration points and computed models")),
      el("li",{},t("All uploaded floor maps, room polygons and receiver positions")),
      el("li",{},t("Room model metadata (floor assignments, colors)")),
      el("li",{},t("All BLE object labels and tag names")),
      el("li",{},t("All follow alerts and notification settings")),
      el("li",{},t("Movement history and traceback data")),
      el("li",{},t("Adaptive learning fingerprints")),
      el("li",{},t("All integration settings and scanner offsets")),
      el("li",{},t("All backups stored within PadSpan")),
    ]),
  ]));

  wrap.appendChild(el("div",{style:"background:#1b3526;border:1px solid #2d4a38;border-radius:8px;padding:14px;margin-bottom:16px;font-size:13px;color:#94a3b8;line-height:1.6"},[
    el("strong",{style:"color:#e2e8f0"},t("What this does NOT delete: ")),
    t("Home Assistant areas, floors, entities, and devices are managed by HA itself and will not be touched. "),
    t("You may want to remove those separately from Settings > Devices & Services after the reset."),
  ]));

  if(disabled){
    wrap.appendChild(el("div",{style:"font-weight:700;color:#fbbf24;font-size:14px;margin-bottom:12px"},
      t("⚡ Switch to Live mode to enable factory reset.")
    ));
    return wrap;
  }

  // Confirmation input — user must type "FACTORY RESET" exactly to unlock the button
  const confirmWrap = el("div",{style:"margin-bottom:16px"});
  confirmWrap.appendChild(el("div",{style:"font-size:13px;color:#94a3b8;margin-bottom:6px"},
    t("To confirm, type FACTORY RESET in the box below:")
  ));

  const input = el("input",{
    type:"text",
    placeholder:t("Type FACTORY RESET here"),
    autocomplete:"off",
    spellcheck:"false",
    style:"width:100%;max-width:300px;padding:8px 12px;background:#071008;border:2px solid #2d4a38;border-radius:6px;color:#e2e8f0;font-size:14px;font-family:monospace",
  });
  confirmWrap.appendChild(input);
  wrap.appendChild(confirmWrap);

  // Button area
  const btnWrap = el("div",{style:"display:flex;gap:12px;align-items:center"});

  const resetBtn = el("button",{
    class:"btn",
    style:"background:#7f1d1d;border:2px solid #dc2626;color:#fca5a5;font-weight:800;padding:10px 24px;font-size:14px;opacity:0.4;cursor:not-allowed",
    disabled:true,
  },t("Erase All Data & Reset"));

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
  const progressBar = el("div",{style:"width:100%;height:8px;background:#1b3526;border-radius:4px;overflow:hidden;margin-bottom:10px"});
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
      t("FINAL WARNING\n\nYou are about to permanently erase ALL PadSpan data.\nThis cannot be undone.\n\nAre you absolutely sure?")
    );
    if(!sure) return;

    resetBtn.disabled = true;
    resetBtn.textContent = t("Resetting…");
    input.disabled = true;
    progressWrap.style.display = "block";
    stepLog.innerHTML = "";

    // Block the 5s poll from calling renderRooms() while reset is in progress.
    // Without this flag, the poll would re-render the Manage tab and destroy
    // our progress bar DOM mid-operation.
    ctx.state._factoryResetInProgress = true;

    // ── Step 1: Send factory reset to backend (clears all 11 stores) ──
    _setProgress(15, t("Erasing all backend stores…"));
    let res;
    try {
      res = await ctx.actions.factoryReset();
      if(res && res.ok){
        _logStep(t("Backend: {done}/{total} stores cleared", { done: res.cleared, total: res.total }));
      } else {
        const errs = (res?.errors || []).join(", ");
        _logStep(t("Backend: {done}/{total} stores — errors: {errors}", { done: res?.cleared || 0, total: res?.total || "?", errors: errs }), false);
      }
    } catch(err) {
      _setProgress(15, t("Backend reset failed: {why}", { why: err.message||err }), true);
      _logStep(t("Backend reset failed: {why}", { why: err.message||err }), false);
      resetBtn.textContent = t("Erase All Data & Reset");
      resetBtn.disabled = false;
      input.disabled = false;
      ctx.state._factoryResetInProgress = false;
      return;
    }

    await _pause();

    // ── Step 2: Restore data_mode to "live" ──
    // Factory reset sets DEFAULT_SETTINGS which has data_mode:"sample".
    // The user was in live mode to reach this page — put them back.
    _setProgress(30, t("Restoring live data mode…"));
    try {
      await ctx.actions.wsCall("padspan_ha/settings_set", { data_mode: "live" });
      // Through panel.js's one setter, so the demo snapshot can never sit
      // under a Live badge (#88).
      ctx.actions.applyDataMode("live");
      _logStep(t("Data mode restored to live"));
    } catch(e){
      _logStep(t("Could not restore live mode: {why}", { why: e.message }), false);
    }

    await _pause();

    // ── Step 3: Clear browser-side caches ──
    _setProgress(45, t("Clearing browser caches…"));
    try {
      localStorage.removeItem("padspan_followed");
      localStorage.removeItem("padspan_followAddr");
      localStorage.removeItem("padspan_hiddenMapIds");
      _logStep(t("Browser localStorage cleared"));
    } catch(e){
      _logStep(t("localStorage clear failed: {why}", { why: e.message }), false);
    }

    await _pause();

    // ── Step 4: Reset frontend in-memory state ──
    _setProgress(55, t("Resetting frontend state…"));
    try {
      ctx.state.followedAddrs = new Set();
      ctx.state.followAddr = "";
      ctx.state.objSearch = "";
      ctx.state.objKind = "all";
      ctx.state.objStatus = "all";
      ctx.state.selectedRooms = [];
      ctx.state.tagFilter = "";
      ctx.state.mode = "live";      // the start-up default: "all" now means intersection
      _logStep(t("Cleared: followed list, filters, selections"));
    } catch(e){
      _logStep(t("Frontend state reset error: {why}", { why: e.message }), false);
    }

    await _pause();

    // ── Step 5: Verify settings on server ──
    _setProgress(70, t("Verifying server state…"));
    try {
      const sRes = await ctx.actions.wsCall("padspan_ha/settings_get", {});
      if(sRes?.settings){
        ctx.state.settings = sRes.settings;
        const serverFollowed = sRes.settings.followed_addrs || [];
        ctx.state.followedAddrs = new Set(serverFollowed);
        const dm = (sRes.settings.data_mode || "sample").toLowerCase();
        ctx.actions.applyDataMode(dm);
        _logStep(`Server: data_mode=${dm}, followed=${serverFollowed.length}`);
        if(serverFollowed.length > 0){
          _logStep("WARNING: server still has followed addresses", false);
        }
      } else {
        _logStep(t("Settings response empty"), false);
      }
    } catch(e){
      _logStep(t("Settings verify failed: {why}", { why: e.message }), false);
    }

    await _pause();

    // ── Step 6: Fetch fresh snapshot (without re-rendering the page) ──
    _setProgress(85, t("Fetching fresh snapshot…"));
    try {
      const snapRes = await ctx.actions.wsCall("padspan_ha/live_snapshot", {});
      if(snapRes?.snapshot){
        ctx.state.live.snapshot = snapRes.snapshot;
        ctx.state.live.error = null;
        const objCount = snapRes.snapshot?.objects?.summary?.total ?? 0;
        const labelCount = (snapRes.snapshot?.objects?.list || []).filter(o => o.user_label).length;
        _logStep(t("Snapshot: {objects} objects, {labelled} labelled", { objects: objCount, labelled: labelCount }));
        if(labelCount > 0){
          _logStep("WARNING: labelled objects remain in snapshot", false);
        }
      } else {
        _logStep(t("Snapshot empty (BLE cache was cleared — objects will return as scanners detect them)"));
      }
    } catch(e){
      _logStep(t("Snapshot fetch failed: {why}", { why: e.message }), false);
    }

    // ── Done ──
    _setProgress(100, t("Factory reset complete"));
    _logStep(t("All done. Click Reload Page to start fresh."));
    resetBtn.textContent = t("Reset Complete");
    resetBtn.style.background = "#14532d";
    resetBtn.style.borderColor = "#16a34a";
    resetBtn.style.color = "#4ade80";
    ctx.state._factoryResetInProgress = false;

    const reloadBtn = el("button",{
      class:"btn",
      style:"background:#1e40af;border-color:#3b82f6;color:#93c5fd;font-weight:700;padding:8px 20px;margin-top:12px",
    },t("Reload Page"));
    reloadBtn.addEventListener("click",()=>location.reload());
    btnWrap.appendChild(reloadBtn);
  });

  btnWrap.appendChild(resetBtn);
  wrap.appendChild(btnWrap);
  wrap.appendChild(progressWrap);

  return wrap;
}

