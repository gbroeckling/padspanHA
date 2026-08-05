// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
// See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
//
// Forensics view — time-window presence search (issue #55).
// Only reachable when the forensics_enabled setting is on (panel.js gates the
// tab).  Two result tiers:
//   Recorded — real presence sessions captured by the background sampler
//   Possible — object-history first/last-seen span overlaps the window
//              (lower confidence: the device may have left and returned)

export function render(ctx){
  const { el, helpBtn } = ctx.helpers;
  const root = el("section",{id:"forensics"});
  const isLive = ctx.state.dataMode === "live";

  root.appendChild(el("div",{class:"row",style:"align-items:center;gap:8px;margin-bottom:10px"},[
    el("h2",{},"Forensics"),
    helpBtn("forensics"),
  ]));

  // ── Persistent reliability disclaimer ────────────────────────────────────
  root.appendChild(el("div",{style:
    "display:flex;align-items:center;gap:10px;padding:10px 14px;border-radius:6px;" +
    "background:linear-gradient(135deg,#450a0a,#7f1d1d);border:1px solid #b91c1c;margin-bottom:14px"
  },[
    el("span",{style:"font-size:18px"}, "⚠️"),
    el("div",{style:"flex:1"},[
      el("div",{style:"color:#fca5a5;font-weight:700;font-size:13px"}, "Investigative leads, not proof"),
      el("div",{style:"color:#fecaca;font-size:12px;margin-top:2px"},
        "A Bluetooth address is not a person: phones rotate their addresses (15 min–24 h), " +
        "addresses can be spoofed, and absence of a record is not absence of a device. " +
        "Results mostly surface fixed-address devices (earbuds, trackers, gadgets)."),
    ]),
  ]));

  if(!isLive){
    root.appendChild(el("div",{class:"card",style:"border-color:#f59e0b"},[
      el("div",{style:"font-weight:700;font-size:12px;color:#f59e0b;margin-bottom:4px"},"⚠ Sample mode"),
      el("div",{class:"muted",style:"font-size:12px"},
        "Forensics records live data only. You can still search previously recorded sessions, " +
        "but nothing new is being recorded while data mode is Sample."),
    ]));
  }

  // ── Search window controls ───────────────────────────────────────────────
  const nowS = Date.now() / 1000;
  if(ctx.state._forensicsFrom == null) ctx.state._forensicsFrom = nowS - 86400;
  if(ctx.state._forensicsTo == null) ctx.state._forensicsTo = nowS;

  const _toLocalISO = (ts) => {
    const d = new Date(ts * 1000);
    const pad = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };
  const _fmtTs = (ts) => {
    if(ts == null) return "—";
    const d = new Date(ts * 1000);
    const pad = (n) => String(n).padStart(2, "0");
    return `${d.getMonth()+1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };
  const _fmtDwell = (s) => {
    s = Number(s) || 0;
    if(s < 60) return `${Math.round(s)}s`;
    const m = Math.floor(s/60);
    if(m < 60) return `${m}m`;
    return `${Math.floor(m/60)}h ${m%60}m`;
  };
  const _dtStyle = "background:#071008;color:#e2e8f0;border:1px solid #2d6a4f;border-radius:4px;padding:4px 8px;font-size:12px";

  const startInput = document.createElement("input");
  startInput.type = "datetime-local";
  startInput.style.cssText = _dtStyle;
  startInput.value = _toLocalISO(ctx.state._forensicsFrom);

  const endInput = document.createElement("input");
  endInput.type = "datetime-local";
  endInput.style.cssText = _dtStyle;
  endInput.value = _toLocalISO(ctx.state._forensicsTo);

  const searchBtn = el("button",{class:"btn",style:"color:#fbbf24;border-color:#92400e;font-weight:600"},"Search window");
  const statusSpan = el("span",{class:"muted",style:"font-size:12px"});

  searchBtn.addEventListener("click", async () => {
    const sVal = startInput.value, eVal = endInput.value;
    if(!sVal || !eVal){ ctx.toast("Pick both start and end times", true); return; }
    const fromTs = new Date(sVal).getTime() / 1000;
    const toTs = new Date(eVal).getTime() / 1000;
    if(!isFinite(fromTs) || !isFinite(toTs)){ ctx.toast("Invalid date", true); return; }
    ctx.state._forensicsFrom = Math.min(fromTs, toTs);
    ctx.state._forensicsTo = Math.max(fromTs, toTs);
    searchBtn.disabled = true; searchBtn.textContent = "Searching…";
    try {
      const r = await ctx.actions.wsCall("padspan_ha/forensics_query", {
        from_ts: ctx.state._forensicsFrom, to_ts: ctx.state._forensicsTo,
      });
      ctx.state._forensicsResults = r || {recorded:[], possible:[]};
      ctx.actions.renderRooms();
    } catch(e){
      ctx.toast("Search failed: " + String(e), true);
      searchBtn.disabled = false; searchBtn.textContent = "Search window";
    }
  });

  // Quick presets
  const presetRow = el("div",{style:"display:flex;gap:6px;flex-wrap:wrap"});
  for(const [label, secs] of [["Last hour",3600],["Last 24 h",86400],["Last 7 days",604800]]){
    presetRow.appendChild(el("button",{class:"btn inline",style:"font-size:11px;padding:2px 8px",
      onclick: ()=>{
        const n = Date.now()/1000;
        startInput.value = _toLocalISO(n - secs);
        endInput.value = _toLocalISO(n);
      }}, label));
  }

  root.appendChild(el("div",{class:"card"},[
    el("div",{class:"h2"},"Seen between"),
    el("div",{class:"muted",style:"font-size:12px;margin-bottom:10px"},
      "Find every Bluetooth device your scanners heard during a time window. Times are local."),
    el("div",{style:"display:flex;align-items:center;gap:8px;flex-wrap:wrap"},[
      startInput,
      el("span",{style:"font-size:12px;color:#64748b"},"to"),
      endInput,
      searchBtn,
      statusSpan,
    ]),
    el("div",{style:"margin-top:8px"},[presetRow]),
  ]));

  // ── Results ──────────────────────────────────────────────────────────────
  const res = ctx.state._forensicsResults;
  if(!res){
    root.appendChild(el("div",{class:"muted",style:"margin-top:6px"},
      "Pick a window and hit Search."));
    return root;
  }

  if(ctx.state._forensicsHideKnown == null) ctx.state._forensicsHideKnown = false;
  const hideKnown = ctx.state._forensicsHideKnown;
  // "Hide labelled" serves the core issue #55 workflow: your own always-home
  // devices monopolize the dwell-sorted top — strangers are the point.
  const recordedAll = res.recorded || [];
  const possibleAll = res.possible || [];
  const recorded = hideKnown ? recordedAll.filter(r => !r.user_label) : recordedAll;
  const possible = hideKnown ? possibleAll.filter(p => !p.user_label) : possibleAll;
  const oldest = res.recording_oldest_ts;

  // Window-predates-recording warning
  if(oldest != null && ctx.state._forensicsFrom < oldest){
    root.appendChild(el("div",{class:"card",style:"border-color:#f59e0b;padding:10px"},[
      el("div",{style:"font-weight:700;font-size:12px;color:#f59e0b"},
        `⚠ Recording starts ${_fmtTs(oldest)} — the window reaches earlier than any recorded session. ` +
        "Earlier matches can only appear in the lower-confidence Possible tier."),
    ]));
  } else if(oldest == null){
    root.appendChild(el("div",{class:"card",style:"border-color:#f59e0b;padding:10px"},[
      el("div",{style:"font-weight:700;font-size:12px;color:#f59e0b"},
        "⚠ No sessions recorded yet. Recording starts once Forensics is enabled and data mode is Live " +
        "(samples every 60 s). Matches below come only from the lower-confidence history overlap."),
    ]));
  }

  // Export
  const exportBtn = el("button",{class:"btn inline"},"Export CSV");
  exportBtn.addEventListener("click", ()=>{
    // Quote + neutralize spreadsheet formula injection — device names arrive
    // over RF from untrusted hardware (a name like "=HYPERLINK(…)" must not
    // execute when the CSV is opened in Excel).
    const esc = (v)=>{
      v = String(v==null?"":v);
      if(/^[=+\-@\t\r]/.test(v)) v = "'" + v;
      return /[",\n]/.test(v) ? '"'+v.replace(/"/g,'""')+'"' : v;
    };
    const lines = ["confidence,address,name,label,vendor,device_type,session_start,session_end,dwell,max_rssi,scanners"];
    for(const r of recorded){
      for(const s of (r.sessions||[])){
        lines.push([ "recorded", r.address, r.name, r.user_label||"", r.company_name||"", r.device_type||"",
          new Date(s.start*1000).toISOString(), new Date(s.end*1000).toISOString(),
          Math.round(s.end - s.start) + "s", s.rssi, (r.sources||[]).join("; ") ].map(esc).join(","));
      }
    }
    for(const p of possible){
      lines.push([ "possible", p.address||p.key, p.name, p.user_label||"", p.company_name||"", p.device_type||"",
        new Date(p.first_seen*1000).toISOString(), new Date(p.last_seen*1000).toISOString(),
        "", "", "" ].map(esc).join(","));
    }
    const blob = new Blob([lines.join("\n")], {type:"text/csv"});
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `padspan-forensics-${new Date().toISOString().replace(/[:.]/g,"-").slice(0,19)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    ctx.toast("Exported forensics CSV.");
  });

  const hideKnownToggle = el("input",{type:"checkbox",id:"forensicsHideKnown",style:"width:14px;height:14px;accent-color:#f87171;cursor:pointer"});
  hideKnownToggle.checked = hideKnown;
  hideKnownToggle.addEventListener("change", ()=>{
    ctx.state._forensicsHideKnown = hideKnownToggle.checked;
    ctx.actions.renderRooms();
  });
  root.appendChild(el("div",{style:"display:flex;align-items:center;gap:10px;margin:10px 0 6px;flex-wrap:wrap"},[
    el("span",{class:"muted",style:"font-size:12px"},
      `${_fmtTs(ctx.state._forensicsFrom)} → ${_fmtTs(ctx.state._forensicsTo)} · ` +
      `${recorded.length} recorded · ${possible.length} possible` +
      (hideKnown ? ` (${(recordedAll.length - recorded.length) + (possibleAll.length - possible.length)} labelled hidden)` : "")),
    el("label",{for:"forensicsHideKnown",style:"display:flex;align-items:center;gap:5px;font-size:12px;color:#e2e8f0;cursor:pointer"},[
      hideKnownToggle,
      "Hide my labelled devices",
    ]),
    (recorded.length || possible.length) ? exportBtn : null,
  ]));

  // Recorded table
  const recCard = el("div",{class:"card"});
  recCard.appendChild(el("div",{class:"h2"},"Recorded — actually present"));
  recCard.appendChild(el("div",{class:"muted",style:"font-size:12px;margin-bottom:8px"},
    "Devices with a recorded presence session overlapping the window. Sorted by time spent in the window."));
  if(!recorded.length){
    recCard.appendChild(el("div",{class:"muted"},"No recorded sessions in this window."));
  } else {
    const tbody = el("tbody",{});
    for(const r of recorded){
      const name = r.user_label || (r.name && r.name !== r.address ? r.name : "");
      const sess = (r.sessions||[]);
      const sessStr = sess.slice(-4).map(s=>`${_fmtTs(s.start)}–${_fmtTs(s.end).split(" ").pop()}`).join(", ")
        + (sess.length > 4 ? ` (+${sess.length-4} more)` : "");
      tbody.appendChild(el("tr",{},[
        el("td",{},[
          name ? el("div",{style:"font-weight:600"},name) : null,
          el("div",{style:"font-family:monospace;font-size:11px;color:#94a3b8"},r.address),
          (r.company_name || r.device_type) ? el("div",{style:"display:flex;flex-wrap:wrap;gap:4px;margin-top:2px"},[
            r.company_name ? el("span",{class:"badge",style:"font-size:9px;padding:1px 5px;background:#1a2a3a;color:#7dd3fc;border-color:#1e4976"}, r.company_name) : null,
            r.device_type ? el("span",{class:"badge",style:"font-size:9px;padding:1px 5px;background:#2a1a3a;color:#c4b5fd;border-color:#5b21b6"}, r.device_type) : null,
          ].filter(Boolean)) : null,
        ].filter(Boolean)),
        el("td",{style:"font-size:11px"},sessStr),
        el("td",{},_fmtDwell(r.dwell_s)),
        el("td",{},r.max_rssi != null && r.max_rssi > -127 ? `${r.max_rssi} dBm` : "—"),
        el("td",{style:"font-size:11px"},(r.sources||[]).join(", ")),
      ]));
    }
    recCard.appendChild(el("div",{style:"overflow-x:auto"},
      el("table",{class:"table"},[
        el("thead",{}, el("tr",{},[
          el("th",{},"Device"),
          el("th",{},"Sessions in window"),
          el("th",{},"Dwell"),
          el("th",{},"Peak signal"),
          el("th",{},"Scanners"),
        ])),
        tbody,
      ])));
  }
  root.appendChild(recCard);

  // Possible table
  const posCard = el("div",{class:"card"});
  posCard.appendChild(el("div",{class:"h2"},"Possible — first/last-seen span overlaps"));
  posCard.appendChild(el("div",{class:"muted",style:"font-size:12px;margin-bottom:8px"},
    "Known devices whose first-seen/last-seen span overlaps the window but have no recorded session in it — " +
    "for example anything from before Forensics was enabled. If a device's first-seen or last-seen time falls " +
    "inside your window, it was actually heard at that moment; otherwise it was only seen before and after " +
    "the window and may not have been present in between."));
  if(!possible.length){
    posCard.appendChild(el("div",{class:"muted"},"None."));
  } else {
    const tbody = el("tbody",{});
    for(const p of possible.slice(0, 200)){
      const name = p.user_label || (p.name && p.name !== p.address ? p.name : "");
      tbody.appendChild(el("tr",{},[
        el("td",{},[
          name ? el("div",{style:"font-weight:600"},name) : null,
          el("div",{style:"font-family:monospace;font-size:11px;color:#94a3b8"},p.address || p.key),
          (p.company_name || p.device_type) ? el("div",{style:"font-size:11px;color:#7dd3fc"},
            [p.company_name, p.device_type].filter(Boolean).join(" · ")) : null,
        ].filter(Boolean)),
        el("td",{},p.kind || ""),
        el("td",{},_fmtTs(p.first_seen)),
        el("td",{},_fmtTs(p.last_seen)),
      ]));
    }
    if(possible.length > 200){
      posCard.appendChild(el("div",{class:"muted",style:"font-size:11px"},
        `Showing 200 of ${possible.length} — export CSV for the full list.`));
    }
    posCard.appendChild(el("div",{style:"overflow-x:auto"},
      el("table",{class:"table"},[
        el("thead",{}, el("tr",{},[
          el("th",{},"Device"),
          el("th",{},"Kind"),
          el("th",{},"First seen"),
          el("th",{},"Last seen"),
        ])),
        tbody,
      ])));
  }
  root.appendChild(posCard);

  return root;
}
