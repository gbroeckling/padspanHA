// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
// See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
/**
 * Events view — session event log filtered to actionable types.
 * Displays tag, view_change, and snapshot events from _sessionEvents with
 * color-coded type badges and a summary count bar. Events are shown in
 * reverse chronological order (newest first).
 */

export function render(ctx){
  const { el, helpBtn } = ctx.helpers;
  const root = el("section",{id:"events"});
  const allEvents = ctx.state._sessionEvents || [];

  // Header
  root.appendChild(el("div",{class:"row",style:"align-items:center;gap:8px;margin-bottom:14px"},[
    el("h2",{},"Events"),
    helpBtn("manage_events"),
  ]));

  // Filter to actionable events
  const ACTIONABLE = new Set(["tag", "view_change", "snapshot"]);
  const events = allEvents.filter(e => ACTIONABLE.has(e.type));

  // Summary bar
  const typeCounts = {};
  for(const e of events) typeCounts[e.type] = (typeCounts[e.type]||0) + 1;

  const TYPE_COLORS = {
    tag: "#ff8a65",
    view_change: "#5eead4",
    snapshot: "#52b788",
  };
  const TYPE_LABELS = {
    tag: "Tag",
    view_change: "Navigation",
    snapshot: "Data",
  };

  const summaryRow = el("div",{class:"row",style:"gap:8px;flex-wrap:wrap;margin-bottom:14px"});
  for(const [type, count] of Object.entries(typeCounts).sort((a,b)=>b[1]-a[1])){
    const color = TYPE_COLORS[type] || "#94a3b8";
    const label = TYPE_LABELS[type] || type;
    summaryRow.appendChild(el("span",{class:"badge",style:`border-color:${color};color:${color}`}, `${label}: ${count}`));
  }
  if(Object.keys(typeCounts).length > 0){
    summaryRow.appendChild(el("span",{class:"muted",style:"font-size:11px"}, `${events.length} total`));
  }
  root.appendChild(summaryRow);

  if(events.length === 0){
    root.appendChild(el("div",{class:"card"},[
      el("div",{class:"muted"},"No notable events yet. Tag objects and navigate views to see events here."),
      el("div",{class:"muted",style:"font-size:12px;margin-top:6px"},"Events include: tagging/untagging objects, navigation between views, data refreshes."),
    ]));
    return root;
  }

  // Event cards (newest first)
  const listContainer = el("div",{class:"list-scroll",style:"max-height:500px;overflow-y:auto;display:flex;flex-direction:column;gap:4px"});
  const sorted = [...events].reverse();

  for(const ev of sorted){
    const time = new Date(ev.ts);
    const hh = String(time.getHours()).padStart(2, "0");
    const mm = String(time.getMinutes()).padStart(2, "0");
    const ss = String(time.getSeconds()).padStart(2, "0");
    const timeStr = `${hh}:${mm}:${ss}`;

    const typeColor = TYPE_COLORS[ev.type] || "#94a3b8";
    const typeLabel = TYPE_LABELS[ev.type] || ev.type;

    // Human-readable detail
    let detail = ev.detail || "";
    if(ev.type === "view_change") detail = `Navigated to ${detail}`;

    const isClickable = ev.type === "view_change" && ev.detail;
    const card = el("div",{style:"display:flex;align-items:center;gap:10px;padding:8px 12px;border-radius:6px;background:rgba(255,255,255,0.03);border-left:3px solid " + typeColor + (isClickable ? ";cursor:pointer" : "")});

    if(isClickable){
      card.addEventListener("mouseenter", ()=>{ card.style.background = "rgba(255,255,255,0.06)"; });
      card.addEventListener("mouseleave", ()=>{ card.style.background = "rgba(255,255,255,0.03)"; });
      card.addEventListener("click", ()=>{
        ctx.state.view = ev.detail;
        ctx.actions.renderRooms();
      });
    }

    card.appendChild(el("span",{style:"font-family:monospace;font-size:11px;color:#64748b;flex-shrink:0"}, timeStr));
    card.appendChild(el("span",{style:`font-size:10px;font-weight:700;padding:2px 8px;border-radius:10px;background:${typeColor}22;color:${typeColor};flex-shrink:0`}, typeLabel));
    card.appendChild(el("span",{style:"font-size:13px;color:#e2e8f0"}, detail));

    if(isClickable){
      card.appendChild(el("span",{style:"font-size:10px;color:#64748b;margin-left:auto;flex-shrink:0"},"→"));
    }

    listContainer.appendChild(card);
  }

  root.appendChild(listContainer);
  return root;
}
