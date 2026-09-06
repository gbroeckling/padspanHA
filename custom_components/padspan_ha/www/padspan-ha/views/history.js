// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
// See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
/**
 * History view — temporal record of session activity and object movement.
 * Sub-tabs: Session Events | Movement.
 * Session Events shows the filtered event log (delegates to events-style rendering).
 * Movement shows per-object room transition history from the live snapshot.
 */

export function render(ctx){
  const { el, helpBtn } = ctx.helpers;
  const root = el("section",{id:"history"});

  // Header
  root.appendChild(el("div",{class:"row",style:"align-items:center;gap:8px;margin-bottom:14px"},[
    el("h2",{},"History"),
    helpBtn("history"),
  ]));

  // ── Sub-tab bar ──
  if(!ctx.state._historyTab) ctx.state._historyTab = "events";
  const activeTab = ctx.state._historyTab;
  const setTab = (t) => { ctx.state._historyTab = t; ctx.actions.renderRooms(); };

  const TABS = [["events","Session Events"],["movement","Movement"]];
  const tabBar = el("div",{class:"tabs",style:"margin-bottom:14px;flex-wrap:wrap;gap:4px"});
  for(const [id,label] of TABS){
    tabBar.appendChild(el("button",{
      class:"tab"+(activeTab===id?" active":""),
      onclick:()=>setTab(id),
    },label));
  }
  root.appendChild(tabBar);

  if(activeTab === "movement"){ root.appendChild(_movement(ctx, el)); return root; }

  // ═══════════════════════════════════════════════════════════════════════════
  // SESSION EVENTS TAB (default)
  // ═══════════════════════════════════════════════════════════════════════════
  const events = ctx.state._sessionEvents || [];

  if(events.length === 0){
    root.appendChild(el("div",{class:"card"},[
      el("div",{class:"muted"},"Session history will appear as you interact with the panel."),
      el("div",{class:"muted",style:"font-size:12px;margin-top:6px"},"Navigate views, refresh data, and tag objects to generate events."),
    ]));
    return root;
  }

  // Type colors & labels
  const TYPE_COLORS = {
    view_change: "#5eead4",
    snapshot: "#52b788",
    tag: "#ff8a65",
    ws_call: "#90a4ae",
  };
  const TYPE_LABELS = {
    view_change: "View",
    snapshot: "Data",
    tag: "Tag",
    ws_call: "WS",
  };

  // Filter state — persist across re-renders
  const allTypes = [...new Set(events.map(e=>e.type))].sort();
  if(!ctx.state._historyFilters){
    ctx.state._historyFilters = new Set(allTypes);
  }
  for(const t of allTypes){
    if(!ctx.state._historyFilters.has(t)) ctx.state._historyFilters.add(t);
  }
  const activeFilters = ctx.state._historyFilters;

  // Toolbar: filters + clear
  const toolbar = el("div",{style:"display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-bottom:12px"});

  for(const type of allTypes){
    const color = TYPE_COLORS[type] || "#94a3b8";
    const label = TYPE_LABELS[type] || type;
    const isActive = activeFilters.has(type);
    const count = events.filter(e=>e.type===type).length;
    const btn = el("button",{
      style:`font-size:11px;padding:3px 10px;border-radius:12px;border:1px solid ${color};cursor:pointer;font-weight:600;transition:all 0.15s;`
        + (isActive
          ? `background:${color}22;color:${color};`
          : `background:transparent;color:#64748b;border-color:#333;text-decoration:line-through;opacity:0.5;`)
    }, `${label} (${count})`);
    btn.addEventListener("click", ()=>{
      if(activeFilters.has(type)) activeFilters.delete(type);
      else activeFilters.add(type);
      ctx.actions.renderRooms();
    });
    toolbar.appendChild(btn);
  }

  toolbar.appendChild(el("div",{style:"flex:1"}));
  const clearBtn = el("button",{class:"btn inline",style:"font-size:11px;padding:2px 8px"}, "Clear History");
  clearBtn.addEventListener("click", ()=>ctx.actions.clearSessionEvents());
  toolbar.appendChild(clearBtn);

  root.appendChild(toolbar);

  const filtered = events.filter(e => activeFilters.has(e.type));

  root.appendChild(el("div",{class:"muted",style:"font-size:11px;margin-bottom:8px"},
    filtered.length === events.length
      ? `${events.length} events`
      : `Showing ${filtered.length} of ${events.length} events`
  ));

  if(filtered.length === 0){
    root.appendChild(el("div",{class:"card"},[
      el("div",{class:"muted"},"All event types are filtered out. Click a filter button above to show events."),
    ]));
    return root;
  }

  const listContainer = el("div",{class:"list-scroll",style:"max-height:500px;overflow-y:auto;display:flex;flex-direction:column;gap:2px"});

  const sorted = [...filtered].reverse();
  for(const ev of sorted){
    const time = new Date(ev.ts);
    const hh = String(time.getHours()).padStart(2, "0");
    const mm = String(time.getMinutes()).padStart(2, "0");
    const ss = String(time.getSeconds()).padStart(2, "0");
    const timeStr = `${hh}:${mm}:${ss}`;

    const typeColor = TYPE_COLORS[ev.type] || "#94a3b8";
    const typeLabel = TYPE_LABELS[ev.type] || ev.type;

    const row = el("div",{style:"display:flex;align-items:center;gap:8px;padding:4px 8px;border-radius:4px;background:rgba(255,255,255,0.02)"});

    row.appendChild(el("span",{style:"font-family:monospace;font-size:11px;color:#64748b;flex-shrink:0;width:56px"}, timeStr));
    row.appendChild(el("span",{style:`font-size:10px;font-weight:700;padding:1px 6px;border-radius:3px;background:${typeColor}22;color:${typeColor};flex-shrink:0;min-width:36px;text-align:center`}, typeLabel));
    row.appendChild(el("span",{style:"font-size:12px;color:#cbd5e1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap"}, ev.detail || ""));

    listContainer.appendChild(row);
  }

  root.appendChild(listContainer);
  return root;
}


// ═══════════════════════════════════════════════════════════════════════════
// MOVEMENT TAB
// ═══════════════════════════════════════════════════════════════════════════
// A device's very first room confirmation is recorded exactly like any
// other transition (presence_coordinator.py's _confirmed_room.get(key)
// returns None for a key never seen before, and that None flows straight
// into movement_store.record()'s `from`) \u2014 so this data already existed,
// it just rendered as "unknown \u2192 room", indistinguishable from a real
// transition or a genuine data gap. Gap #17, best-in-class roadmap: give
// it its own identity instead of quietly collapsing it into "unknown".
function _isFirstSeen(entry){ return !entry.from; }

function _jumpToTraceback(ctx, entry){
  const base = ctx.state._traceback || {
    mode: "playback", playing: false, playDurationS: 300, frameIdx: 0, frames: [],
    range: null, objKeys: [], filterKey: null, filterName: "All objects", rangePreset: 300,
    startTs: null, endTs: null, _animTimer: null,
    discoFromMin: 60, discoToMin: 0, discoResults: [], discoSelected: null,
  };
  const ts = entry.ts || (Date.now() / 1000);
  ctx.state._traceback = {
    ...base,
    mode: "playback",
    startTs: ts - 120,
    endTs: ts + 120,
    filterKey: entry.device || null,
    filterName: entry.label || entry.device || "All objects",
    frameIdx: 0,
    frames: [],
    playing: false,
    range: null,
  };
  ctx.state.view = "traceback";
  ctx.actions.renderRooms();
}

function _movement(ctx, el){
  const wrap = el("div",{});

  // Load movement data on first render (cached in state)
  if(!ctx.state._movementLoaded){
    ctx.state._movementLoaded = true;
    ctx.state._movementEntries = [];
    ctx.actions.wsCall("padspan_ha/movement_history_get", {limit: 200}).then(r => {
      ctx.state._movementEntries = (r && r.entries) || [];
      ctx.actions.renderRooms();
    }).catch(() => {});
  }

  const entries = ctx.state._movementEntries || [];

  if(entries.length === 0){
    wrap.appendChild(el("div",{class:"card"},[
      el("div",{class:"muted"},"No movement history recorded yet."),
      el("div",{class:"muted",style:"font-size:12px;margin-top:6px"},"Room transitions are automatically recorded when tracked devices move between rooms."),
    ]));
    // Refresh button
    const refreshBtn = el("button",{class:"btn inline",style:"margin-top:10px;font-size:11px"}, "Refresh");
    refreshBtn.addEventListener("click", ()=>{
      ctx.state._movementLoaded = false;
      ctx.actions.renderRooms();
    });
    wrap.appendChild(refreshBtn);
    return wrap;
  }

  // Type filters \u2014 same chip pattern as the Session Events tab above,
  // applied to a different (and previously conflated) pair of kinds.
  if(!ctx.state._movementFilters) ctx.state._movementFilters = new Set(["transition","first_seen"]);
  const activeFilters = ctx.state._movementFilters;
  const firstSeenCount = entries.filter(_isFirstSeen).length;
  const transitionCount = entries.length - firstSeenCount;

  // Toolbar
  const toolbar = el("div",{style:"display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-bottom:12px"});
  const filterBtn = (kind, label, count, color) => {
    const isActive = activeFilters.has(kind);
    const btn = el("button",{
      style:`font-size:11px;padding:3px 10px;border-radius:12px;border:1px solid ${color};cursor:pointer;font-weight:600;transition:all 0.15s;`
        + (isActive
          ? `background:${color}22;color:${color};`
          : `background:transparent;color:#64748b;border-color:#333;text-decoration:line-through;opacity:0.5;`)
    }, `${label} (${count})`);
    btn.addEventListener("click", ()=>{
      if(activeFilters.has(kind)) activeFilters.delete(kind);
      else activeFilters.add(kind);
      ctx.actions.renderRooms();
    });
    return btn;
  };
  toolbar.appendChild(filterBtn("transition", "Room change", transitionCount, "#52b788"));
  toolbar.appendChild(filterBtn("first_seen", "First seen", firstSeenCount, "#a78bfa"));
  toolbar.appendChild(el("div",{style:"flex:1"}));
  const refreshBtn = el("button",{class:"btn inline",style:"font-size:11px;padding:2px 8px"}, "Refresh");
  refreshBtn.addEventListener("click", ()=>{
    ctx.state._movementLoaded = false;
    ctx.actions.renderRooms();
  });
  toolbar.appendChild(refreshBtn);
  wrap.appendChild(toolbar);

  // Timeline (newest first)
  const listContainer = el("div",{class:"list-scroll",style:"max-height:500px;overflow-y:auto;display:flex;flex-direction:column;gap:2px"});

  const sorted = [...entries].reverse()
    .filter(e => activeFilters.has(_isFirstSeen(e) ? "first_seen" : "transition"));
  if(!sorted.length){
    listContainer.appendChild(el("div",{class:"muted",style:"padding:10px"}, "No entries match the current filters."));
  }
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

    const label = entry.label || entry.device || "Unknown";
    const toRoom = entry.to || "unknown";
    const firstSeen = _isFirstSeen(entry);
    const rc = ctx.helpers.roomColor ? ctx.helpers.roomColor(toRoom) : "#52b788";
    const borderColor = firstSeen ? "#a78bfa" : rc;

    const row = el("div",{style:"display:flex;align-items:center;gap:8px;padding:5px 8px;border-radius:4px;background:rgba(255,255,255,0.02);border-left:3px solid " + borderColor});

    row.appendChild(el("span",{style:"font-family:monospace;font-size:11px;color:#64748b;flex-shrink:0;width:72px"}, dateStr + timeStr));
    row.appendChild(el("span",{style:"font-size:12px;font-weight:600;color:#e2e8f0;min-width:80px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex-shrink:0"}, label));
    if(firstSeen){
      row.appendChild(el("span",{style:"font-size:11px;color:#a78bfa;font-weight:600"}, "\u2728 First seen in"));
      row.appendChild(el("span",{style:`font-size:11px;color:${rc};font-weight:600`}, toRoom));
    } else {
      row.appendChild(el("span",{style:"font-size:11px;color:#94a3b8;flex-shrink:0"}, entry.from));
      row.appendChild(el("span",{style:"font-size:11px;color:#5eead4"}, "\u2192"));
      row.appendChild(el("span",{style:`font-size:11px;color:${rc};font-weight:600`}, toRoom));
    }
    row.appendChild(el("div",{style:"flex:1"}));
    if(entry.device){
      const tbBtn = el("button",{class:"btn inline",style:"font-size:10px;padding:2px 8px;flex-shrink:0"}, "\u25b6 Traceback");
      tbBtn.title = "Open Traceback centred on this moment";
      tbBtn.addEventListener("click", ()=>_jumpToTraceback(ctx, entry));
      row.appendChild(tbBtn);
    }

    listContainer.appendChild(row);
  }

  wrap.appendChild(listContainer);
  return wrap;
}
