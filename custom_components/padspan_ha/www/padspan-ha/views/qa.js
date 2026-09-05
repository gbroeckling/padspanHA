// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
// See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
/**
 * QA view — automated config health checks and validation.
 * Runs pass/warn/fail checks against live snapshot data: BLE scanners present,
 * rooms discovered, maps uploaded, objects tracked, calibration state, etc.
 * Provides a quick at-a-glance summary of system readiness.
 */

export function render(ctx){
  const { el, esc, helpBtn, radioShortId } = ctx.helpers;
  const _sid = (source) => radioShortId ? radioShortId(source || "") : "";
  const snap = (ctx.state.live && ctx.state.live.snapshot) || null;
  const root = el("section",{id:"qa"});

  // Header
  root.appendChild(el("div",{class:"row",style:"align-items:center;gap:8px;margin-bottom:14px"},[
    el("h2",{},"QA"),
    helpBtn("qa"),
  ]));

  const grid = el("div",{class:"grid"});

  // ── Config Health ──
  const healthCard = el("div",{class:"card"});
  healthCard.appendChild(el("div",{style:"font-weight:700;margin-bottom:10px"},"Config Health"));

  const maps = (ctx.state.maps && ctx.state.maps.list) || [];
  const rooms = snap ? (snap.rooms_discovered || []) : [];
  const radios = snap ? ((snap.ble && snap.ble.radios) || []) : [];
  const bleAds = snap ? ((snap.ble && snap.ble.advertisements) || []) : [];
  const bleDiag = snap ? ((snap.ble && snap.ble.diag) || {}) : {};
  const objects = snap ? ((snap.objects && snap.objects.list) || []) : [];

  // BLE scanner check: pass if radios exist, warn if no radios but we have ads (data still flowing)
  const hasRadios = radios.length > 0;
  const hasAds = bleAds.length > 0;
  const bleScannersPass = hasRadios;
  const bleScannersWarn = !hasRadios && hasAds;
  // BLE feed check: pass if diag ok, warn if diag not ok but we have data (radios or ads)
  const bleFeedPass = bleDiag.ok === true;
  const bleFeedWarn = !bleFeedPass && (hasRadios || hasAds);

  // Checks support pass/warn/fail: pass=true → green ✅, warn=true → amber ⚠️, else red ❌
  const checks = [
    {
      label: "Maps configured",
      pass: maps.length > 0,
      detail: maps.length > 0 ? `${maps.length} map${maps.length>1?"s":""}` : "No maps uploaded",
      fix: "Upload a floor plan in the Maps tab.",
      fixView: "maps",
    },
    {
      label: "Receivers on maps",
      pass: maps.some(m => (m.receivers || []).length > 0),
      detail: maps.some(m => (m.receivers || []).length > 0) ? "At least one map has receivers" : "No receivers placed on maps",
      fix: "Place scanners on your map in Maps \u2192 3D Stack.",
      fixView: "maps",
    },
    {
      label: "Rooms defined",
      pass: rooms.length > 0,
      detail: rooms.length > 0 ? `${rooms.length} room${rooms.length>1?"s":""}` : "No HA areas configured",
      fix: "Create areas in HA Settings \u2192 Areas & Zones.",
    },
    {
      label: "BLE scanners active",
      pass: bleScannersPass,
      warn: bleScannersWarn,
      detail: hasRadios ? `${radios.length} scanner${radios.length>1?"s":""}` : hasAds ? `${bleAds.length} advertisements (radios not enumerated)` : "No BLE radios detected",
      fix: hasAds ? "BLE data is flowing but radio list unavailable \u2014 this is usually fine." : "Add Bluetooth scanner integrations to HA.",
    },
    {
      label: "BLE feed healthy",
      pass: bleFeedPass,
      warn: bleFeedWarn,
      detail: bleFeedPass ? "OK" : bleFeedWarn ? "BLE data flowing \u2014 diagnostics report minor issue" : (bleDiag.errors && bleDiag.errors.length ? bleDiag.errors[0] : "Unhealthy or no data"),
      fix: bleFeedWarn ? "BLE is working. The diagnostics flag can be ignored." : "Restart HA (Settings \u2192 System \u2192 Restart).",
    },
    {
      label: "Objects tagged",
      pass: objects.some(o => o.user_label),
      detail: objects.filter(o => o.user_label).length + " tagged",
      fix: "Tag devices in the Objects tab.",
      fixView: "objects",
    },
    {
      label: "Snapshot available",
      pass: !!snap,
      detail: snap ? "Yes" : "No snapshot loaded",
      fix: "Switch to Live or Sample mode.",
    },
  ];

  const checkList = el("div",{style:"display:flex;flex-direction:column;gap:6px"});
  let passCount = 0, warnCount = 0;
  for(const c of checks){
    if(c.pass) passCount++;
    else if(c.warn) warnCount++;
    const icon = c.pass ? "\u2705" : c.warn ? "\u26A0\uFE0F" : "\u274C";
    const color = c.pass ? "#52b788" : c.warn ? "#ffd54f" : "#ef5350";
    const row = el("div",{style:"display:flex;align-items:flex-start;gap:8px;font-size:13px"});
    row.appendChild(el("span",{style:"flex-shrink:0"}, icon));
    row.appendChild(el("div",{style:"flex:1"},[
      el("div",{style:"display:flex;align-items:center;gap:8px"},[
        el("span",{style:`color:${color};font-weight:600;min-width:140px`}, c.label),
        el("span",{class:"muted",style:"font-size:11px"}, c.detail),
      ]),
      !c.pass && !c.warn && c.fix ? el("div",{style:"font-size:11px;color:#90caf9;margin-top:2px;display:flex;align-items:center;gap:4px"},[
        el("span",{}, c.fix),
        c.fixView ? (() => {
          const link = el("span",{style:"cursor:pointer;text-decoration:underline;text-decoration-style:dotted;color:#5eead4"}, `Go \u2192`);
          link.addEventListener("click", ()=>{
            ctx.state.view = c.fixView;
            ctx.actions.renderRooms();
          });
          return link;
        })() : null,
      ].filter(Boolean)) : null,
      c.warn && c.fix ? el("div",{style:"font-size:11px;color:#ffd54f;margin-top:2px"}, c.fix) : null,
    ].filter(Boolean)));
    checkList.appendChild(row);
  }
  healthCard.appendChild(checkList);
  const allOk = passCount + warnCount === checks.length;
  healthCard.appendChild(el("div",{style:"margin-top:10px;font-size:12px;font-weight:600;color:" + (passCount === checks.length ? "#52b788" : allOk ? "#ffd54f" : "#ef5350")},
    `${passCount}/${checks.length} passed` + (warnCount > 0 ? `, ${warnCount} warning${warnCount>1?"s":""}` : "")));
  grid.appendChild(healthCard);

  // ── Data Consistency ──
  const consistCard = el("div",{class:"card"});
  consistCard.appendChild(el("div",{style:"font-weight:700;margin-bottom:10px"},"Data Consistency"));

  const issues = [];

  if(snap){
    // Orphaned objects
    const roomSet = new Set(rooms);
    const orphaned = objects.filter(o => o.room && !roomSet.has(o.room));
    if(orphaned.length > 0){
      const chips = el("div",{style:"display:flex;flex-wrap:wrap;gap:4px;margin-top:4px"});
      for(const o of orphaned.slice(0, 5)){
        const name = o.user_label || o.name || o.address;
        const chip = el("span",{style:"font-size:11px;color:#ffd54f;cursor:pointer;text-decoration:underline;text-decoration-style:dotted"}, name);
        chip.addEventListener("click", ()=>ctx.actions.showObjectDetail(o));
        chips.appendChild(chip);
      }
      if(orphaned.length > 5) chips.appendChild(el("span",{class:"muted",style:"font-size:11px"}, `+${orphaned.length-5} more`));
      issues.push(el("div",{style:"font-size:12px;margin-bottom:6px"},[
        el("span",{style:"color:#ffd54f;font-weight:600"}, `${orphaned.length} orphaned object${orphaned.length>1?"s":""} (in unknown rooms):`),
        chips,
      ]));
    }

    // Unmapped scanners
    const mappedSources = new Set();
    for(const m of maps) for(const r of (m.receivers||[])) mappedSources.add(r.source||r.name||r.id);
    const unmapped = radios.filter(r => !mappedSources.has(r.source) && !mappedSources.has(r.name));
    if(unmapped.length > 0){
      const chips = el("div",{style:"display:flex;flex-wrap:wrap;gap:4px;margin-top:4px"});
      for(const s of unmapped){
        const chipLabel = (_sid(s.source||"") ? _sid(s.source||"")+" " : "") + (s.name||s.source);
        const chip = el("span",{style:"font-size:11px;color:#ffd54f;cursor:pointer;text-decoration:underline;text-decoration-style:dotted"}, chipLabel);
        chip.addEventListener("click", ()=>ctx.actions.showScannerDetail(s));
        chips.appendChild(chip);
      }
      issues.push(el("div",{style:"font-size:12px;margin-bottom:6px"},[
        el("span",{style:"color:#ffd54f;font-weight:600"}, `${unmapped.length} unmapped scanner${unmapped.length>1?"s":""}:`),
        chips,
      ]));
    }

    // Rooms without scanner
    const scannerRooms = new Set(radios.map(r=>r.area_name).filter(Boolean));
    const uncovered = rooms.filter(r => !scannerRooms.has(r));
    if(uncovered.length > 0){
      const chips = el("div",{style:"display:flex;flex-wrap:wrap;gap:4px;margin-top:4px"});
      for(const r of uncovered){
        const chip = el("span",{style:"font-size:11px;color:#90caf9;cursor:pointer;text-decoration:underline;text-decoration-style:dotted"}, r);
        chip.addEventListener("click", ()=>ctx.actions.showRoomDetail(r));
        chips.appendChild(chip);
      }
      issues.push(el("div",{style:"font-size:12px;margin-bottom:6px"},[
        el("span",{style:"color:#90caf9;font-weight:600"}, `${uncovered.length} room${uncovered.length>1?"s":""} without scanner:`),
        chips,
      ]));
    }
  }

  if(issues.length === 0){
    consistCard.appendChild(el("div",{style:"font-size:13px;color:#52b788;font-weight:600"},"No data consistency issues found."));
  } else {
    for(const iss of issues) consistCard.appendChild(iss);
  }
  // ── Quick Actions (merged into Data Consistency card) ──
  consistCard.appendChild(el("div",{style:"font-weight:700;margin-top:14px;padding-top:10px;border-top:1px solid #1e293b;margin-bottom:8px"},"Quick Actions"));
  {
    const btnRow = el("div",{style:"display:flex;gap:8px;flex-wrap:wrap"});
    const refreshBtn = el("button",{class:"btn"}, "Refresh Snapshot");
    refreshBtn.addEventListener("click", async ()=>{
      refreshBtn.disabled = true;
      refreshBtn.textContent = "Refreshing\u2026";
      try { await ctx.actions.refreshSnapshot(); } catch(e){}
      refreshBtn.disabled = false;
      refreshBtn.textContent = "Refresh Snapshot";
    });
    btnRow.appendChild(refreshBtn);
    const exportBtn = el("button",{class:"btn inline"}, "Export State");
    exportBtn.addEventListener("click", ()=>{
      const data = {
        snapshot: snap,
        settings: ctx.state.settings,
        roomTagMap: ctx.state.roomTagMap,
        maps: ctx.state.maps,
        wsCounts: ctx.state.wsCounts,
        timing: ctx.state.timing,
        exportedAt: new Date().toISOString(),
      };
      const blob = new Blob([JSON.stringify(data, null, 2)], {type: "application/json"});
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `padspan-state-${new Date().toISOString().replace(/[:.]/g,"-")}.json`;
      a.click();
      URL.revokeObjectURL(url);
      ctx.toast("State exported.");
    });
    btnRow.appendChild(exportBtn);
    const diagBtn = el("button",{class:"btn inline"}, "Go to Diagnostics");
    diagBtn.addEventListener("click", ()=>{
      ctx.state.view = "diagnostics";
      ctx.actions.renderRooms();
    });
    btnRow.appendChild(diagBtn);
    consistCard.appendChild(btnRow);
  }
  grid.appendChild(consistCard);

  // ── Propagation Health ──
  const propCard = el("div",{class:"card",style:"overflow:hidden;min-width:0"});
  propCard.appendChild(el("div",{style:"display:flex;align-items:center;gap:8px;margin-bottom:10px"},[
    el("div",{style:"font-weight:700"},"Propagation Health"),
    helpBtn("qa_propagation"),
  ]));

  const propStatusDiv = el("div",{});
  const _propBar = (label, value, max, color) => {
    const pct = Math.min(100, Math.round((value / Math.max(max, 0.01)) * 100));
    return el("div",{style:"margin-bottom:8px"},[
      el("div",{style:"display:flex;justify-content:space-between;font-size:12px;margin-bottom:3px"},[
        el("span",{class:"muted"}, label),
        el("span",{style:`font-weight:600;color:${color}`}, typeof value==="number" && max<=1 ? `${Math.round(value*100)}%` : String(Math.round(value))),
      ]),
      el("div",{style:"background:#1e293b;border-radius:4px;height:6px;overflow:hidden"},[
        el("div",{style:`width:${pct}%;height:100%;background:${color};border-radius:4px;transition:width .3s`}),
      ]),
    ]);
  };

  const _gradeColor = (g) => g==="A"?"#52b788":g==="B"?"#38bdf8":g==="C"?"#ffd54f":g==="D"?"#fb923c":"#ef5350";

  // Load propagation health data async
  if(!ctx.state._qaExpandedProp) ctx.state._qaExpandedProp = false;
  if(!ctx.state._qaExpandedMath) ctx.state._qaExpandedMath = false;

  const _renderPropHealth = (ph) => {
    while(propStatusDiv.firstChild) propStatusDiv.removeChild(propStatusDiv.firstChild);
    if(!ph || !ph.grade){
      propStatusDiv.appendChild(el("div",{class:"muted",style:"font-size:12px"},"Loading propagation analysis..."));
      return;
    }
    const gc = _gradeColor(ph.grade);
    // Grade badge
    propStatusDiv.appendChild(el("div",{style:"display:flex;align-items:center;gap:12px;margin-bottom:12px"},[
      el("div",{style:`width:48px;height:48px;border-radius:12px;background:${gc}22;border:2px solid ${gc};display:flex;align-items:center;justify-content:center;font-size:28px;font-weight:800;color:${gc}`}, ph.grade),
      el("div",{style:"min-width:0;flex:1"},[
        el("div",{style:"font-weight:600;color:#e2e8f0;font-size:14px"}, `Propagation Model: Grade ${ph.grade}`),
        el("div",{class:"muted",style:"font-size:12px"}, ph.grade==="A"?"Excellent — model is well-calibrated":ph.grade==="B"?"Good — model is performing well":ph.grade==="C"?"Fair — room for improvement":ph.grade==="D"?"Developing — needs more data":"Insufficient — enable adaptive learning or add calibration"),
      ]),
    ]));

    // Sub-indicator bars
    const covColor = ph.coverage_pct>=0.7?"#52b788":ph.coverage_pct>=0.4?"#ffd54f":"#ef5350";
    propStatusDiv.appendChild(_propBar("Model Coverage", ph.coverage_pct, 1, covColor));
    // Mean LOO error in METRES (GRADE_*_ERROR_M in const.py). The bar reads
    // full at 0 m and empty at 3 m.
    const accVal = (ph.accuracy && ph.accuracy.mean_error_m) || 0;
    const accColor = accVal>0 && accVal<0.75?"#52b788":accVal<1.8?"#ffd54f":accVal>0?"#ef5350":"#64748b";
    propStatusDiv.appendChild(_propBar("Distance Accuracy", accVal>0 ? Math.max(0,1-accVal/3) : 0, 1, accColor));
    // avg_variance is per-room RSSI variance in dBm² (Welford variance over
    // scanner readings, see adaptive_store.py / ws_diagnostics.py). The 15/25
    // cutoffs and the /40 bar scale are empirically-chosen UI thresholds, not
    // derived from a single documented constant (the backend's own gating
    // threshold, _MAX_USEFUL_VARIANCE, is 50).
    const stab = ph.fingerprint_stability || {};
    const stabVal = stab.avg_variance || 0;
    const stabColor = stabVal>0 && stabVal<15?"#52b788":stabVal<25?"#ffd54f":stabVal>0?"#ef5350":"#64748b";
    propStatusDiv.appendChild(_propBar("Fingerprint Stability", stabVal>0 ? Math.max(0,1-stabVal/40) : 0, 1, stabColor));
    // mean_delta is the mean RSSI delta in dBm between floor pairs
    // (adaptive_store.py learned_floor_attenuation). The backend already
    // flags "sufficient" at |mean_delta|>=8 dBm; the /15 here is a separate,
    // empirically-chosen scale for how full this bar renders.
    const flr = ph.floor_separation || {};
    if(flr.pairs > 0){
      const flrColor = flr.sufficient?"#52b788":"#ffd54f";
      propStatusDiv.appendChild(_propBar("Floor Separation", Math.min(1, Math.abs(flr.mean_delta)/15), 1, flrColor));
    } else {
      propStatusDiv.appendChild(el("div",{style:"margin-bottom:8px"},[
        el("div",{style:"display:flex;justify-content:space-between;font-size:12px;margin-bottom:3px"},[
          el("span",{class:"muted"}, "Floor Separation"),
          el("span",{class:"muted",style:"font-size:11px"}, "N/A — single floor or no data"),
        ]),
      ]));
    }

    // Recommendations
    if(ph.recommendations && ph.recommendations.length > 0){
      propStatusDiv.appendChild(el("div",{style:"font-weight:600;font-size:12px;margin:10px 0 6px;color:#94a3b8"},"Recommendations"));
      for(const rec of ph.recommendations.slice(0,5)){
        const pColor = rec.priority==="high"?"#ef5350":rec.priority==="medium"?"#ffd54f":"#90caf9";
        propStatusDiv.appendChild(el("div",{style:"font-size:12px;padding:2px 0;display:flex;gap:6px"},[
          el("span",{style:`color:${pColor};flex-shrink:0`}, rec.priority==="high"?"\u25CF":"\u25CB"),
          el("span",{class:"muted"}, rec.text),
        ]));
      }
    }

    // More Detail toggle
    const detailToggle = el("button",{class:"btn inline",style:"margin-top:10px;font-size:11px"}, ctx.state._qaExpandedProp ? "Hide Detail" : "More Detail");
    detailToggle.addEventListener("click",()=>{
      ctx.state._qaExpandedProp = !ctx.state._qaExpandedProp;
      ctx.actions.renderRooms();
    });
    propStatusDiv.appendChild(detailToggle);

    if(ctx.state._qaExpandedProp){
      const detailDiv = el("div",{style:"margin-top:12px;border-top:1px solid #1e293b;padding-top:10px"});
      // Per-room fingerprint table
      if(ph.per_room && ph.per_room.length > 0){
        detailDiv.appendChild(el("div",{style:"font-weight:600;font-size:12px;margin-bottom:6px;color:#94a3b8"},"Per-Room Fingerprint Quality"));
        const tbl = el("div",{style:"font-size:11px;overflow-x:auto"});
        tbl.appendChild(el("div",{style:"display:grid;grid-template-columns:1fr 60px 70px 60px 70px;gap:4px;padding:4px 0;border-bottom:1px solid #1e293b;font-weight:600;color:#94a3b8"},
          ["Room","Scanners","Observations","Avg Var","Status"].map(h=>el("span",{},h))));
        for(const r of ph.per_room.slice(0,15)){
          const sColor = r.status==="stable"?"#52b788":r.status==="building"?"#38bdf8":r.status==="sparse"?"#ffd54f":"#64748b";
          tbl.appendChild(el("div",{style:"display:grid;grid-template-columns:1fr 60px 70px 60px 70px;gap:4px;padding:3px 0;border-bottom:1px solid #0d1f12"},[
            el("span",{style:"color:#e2e8f0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap"}, r.room),
            el("span",{class:"muted"}, String(r.scanners)),
            el("span",{class:"muted"}, r.observations.toLocaleString()),
            el("span",{class:"muted"}, r.avg_var > 0 ? r.avg_var.toFixed(1) : "\u2014"),
            el("span",{style:`color:${sColor};font-weight:600`}, r.status),
          ]));
        }
        detailDiv.appendChild(tbl);
      }
      // Per-scanner path-loss table
      if(ph.per_scanner_pl && ph.per_scanner_pl.length > 0){
        detailDiv.appendChild(el("div",{style:"font-weight:600;font-size:12px;margin:12px 0 6px;color:#94a3b8"},"Per-Scanner Path-Loss Model"));
        const tbl2 = el("div",{style:"font-size:11px;overflow-x:auto"});
        tbl2.appendChild(el("div",{style:"display:grid;grid-template-columns:1fr 50px 55px 45px 55px;gap:4px;padding:4px 0;border-bottom:1px solid #1e293b;font-weight:600;color:#94a3b8"},
          ["Scanner","n","RSSI@1m","R\u00b2","Quality"].map(h=>el("span",{},h))));
        for(const pl of ph.per_scanner_pl){
          const qColor = pl.quality==="good"?"#52b788":pl.quality==="fair"?"#ffd54f":"#ef5350";
          tbl2.appendChild(el("div",{style:"display:grid;grid-template-columns:1fr 50px 55px 45px 55px;gap:4px;padding:3px 0;border-bottom:1px solid #0d1f12"},[
            el("span",{style:"color:#e2e8f0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap"}, pl.name),
            el("span",{class:"muted"}, pl.n.toFixed(2)),
            el("span",{class:"muted"}, pl.rssi_1m.toFixed(1)),
            el("span",{style:`color:${qColor};font-weight:600`}, pl.r_sq.toFixed(2)),
            el("span",{style:`color:${qColor}`}, pl.quality),
          ]));
        }
        detailDiv.appendChild(tbl2);
      }
      // Math explainer toggle
      const mathToggle = el("button",{class:"btn inline",style:"margin-top:10px;font-size:11px"}, ctx.state._qaExpandedMath ? "Hide Math" : "How It Works");
      mathToggle.addEventListener("click",()=>{
        ctx.state._qaExpandedMath = !ctx.state._qaExpandedMath;
        ctx.actions.renderRooms();
      });
      detailDiv.appendChild(mathToggle);
      if(ctx.state._qaExpandedMath){
        const s = ph.settings || {};
        const mathDiv = el("div",{style:"margin-top:8px;padding:10px;background:#0a1a0d;border-radius:8px;font-size:11px;font-family:monospace;line-height:1.8;color:#94a3b8;overflow-x:auto;word-break:break-word"});
        mathDiv.innerHTML = [
          `<b style="color:#e2e8f0">Path-Loss Formula:</b>`,
          `  distance(m) = 10 ^ ((ref_power - rssi) / (10 \u00d7 n))`,
          `  ref_power = <span style="color:#5eead4">${s.ref_power||"-59.0"}</span> dBm &nbsp; n = <span style="color:#5eead4">${s.path_loss_exp||"2.5"}</span>`,
          ``,
          `<b style="color:#e2e8f0">Kalman Filter:</b>`,
          `  Q = <span style="color:#5eead4">${s.kalman_q||"0.125"}</span> (process noise \u2014 higher = faster response)`,
          `  R = <span style="color:#5eead4">${s.kalman_r||"8.0"}</span> (measurement noise \u2014 higher = more smoothing)`,
          ``,
          `<b style="color:#e2e8f0">Adaptive Blending:</b>`,
          `  ${s.adaptive_enabled ? `Enabled \u2014 maturity <span style="color:#5eead4">${Math.round((s.adaptive_maturity||0)*100)}%</span> \u2014 max influence ${Math.round(Math.min(40,((s.adaptive_maturity||0)*50)))}%` : "Disabled \u2014 enable in Settings \u2192 Presence"}`,
        ].join("<br>");
        detailDiv.appendChild(mathDiv);
      }

      // Reset buttons
      detailDiv.appendChild(el("div",{style:"font-weight:600;font-size:12px;margin:14px 0 6px;color:#94a3b8"},"Data Management"));
      const resetRow = el("div",{style:"display:flex;gap:8px;flex-wrap:wrap"});
      const resetAdBtn = el("button",{class:"btn",style:"font-size:11px;background:#991b1b;border-color:#991b1b"},"Reset Adaptive Learning");
      resetAdBtn.addEventListener("click", async()=>{
        if(!confirm("Clear all passively learned room fingerprints and transition patterns?\n\nManual calibration points are NOT affected.")) return;
        resetAdBtn.disabled=true;
        try { await ctx.actions.wsCall("padspan_ha/adaptive_reset"); ctx.toast("Adaptive learning data cleared"); ctx.actions.renderRooms(); }
        catch(e){ ctx.toast("Reset failed",true); }
        finally{ resetAdBtn.disabled=false; }
      });
      resetRow.appendChild(resetAdBtn);
      const resetCalBtn = el("button",{class:"btn",style:"font-size:11px;background:#7f1d1d;border-color:#7f1d1d"},"Reset All Calibration");
      resetCalBtn.addEventListener("click", async()=>{
        const typed = prompt("This removes ALL calibration data including manual pin-and-listen points.\nThis cannot be undone.\n\nType RESET to confirm:");
        if(typed !== "RESET") return;
        resetCalBtn.disabled=true;
        try { await ctx.actions.wsCall("padspan_ha/calibration_clear"); ctx.toast("All calibration data cleared"); ctx.actions.renderRooms(); }
        catch(e){ ctx.toast("Reset failed",true); }
        finally{ resetCalBtn.disabled=false; }
      });
      resetRow.appendChild(resetCalBtn);
      detailDiv.appendChild(resetRow);

      propStatusDiv.appendChild(detailDiv);
    }
  };

  // Async load propagation health
  _renderPropHealth(ctx.state._qaPropHealth || null);
  (async()=>{
    try {
      const r = await ctx.actions.wsCall("padspan_ha/propagation_health");
      ctx.state._qaPropHealth = r;
      _renderPropHealth(r);
    } catch(e){ /* best-effort */ }
  })();
  propCard.appendChild(propStatusDiv);
  grid.appendChild(propCard);

  // ── Data Backup & Recovery ──
  const backupCard = el("div",{class:"card"});
  backupCard.appendChild(el("div",{style:"display:flex;align-items:center;gap:8px;margin-bottom:10px"},[
    el("div",{style:"font-weight:700"},"Data Backup & Recovery"),
    helpBtn("qa_backup"),
  ]));
  backupCard.appendChild(el("div",{class:"muted",style:"font-size:12px;margin-bottom:10px"},
    "Create a snapshot of all PadSpan data before enabling experimental features. Restore to roll back if needed."));

  const noteInp = el("input",{type:"text",placeholder:"Optional note (e.g. Before adaptive learning)",style:"flex:1;min-width:180px;padding:4px 8px;border-radius:4px;border:1px solid #334155;background:#0f172a;color:#e2e8f0;font-size:12px"});
  const createBkBtn = el("button",{class:"btn",style:"font-size:12px"},"Create Backup");
  createBkBtn.addEventListener("click", async()=>{
    createBkBtn.disabled=true; createBkBtn.textContent="Saving\u2026";
    try {
      const note = noteInp.value.trim();
      await ctx.actions.wsCall("padspan_ha/store_backup_create", note ? {note} : {});
      noteInp.value = "";
      ctx.toast("Backup created");
      ctx.actions.renderRooms();
    } catch(e){ ctx.toast("Backup failed: "+String(e),true); }
    finally{ createBkBtn.disabled=false; createBkBtn.textContent="Create Backup"; }
  });
  backupCard.appendChild(el("div",{style:"display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:10px"},[noteInp, createBkBtn]));

  // List backups
  const bkListDiv = el("div",{});
  const _renderBackups = (list) => {
    while(bkListDiv.firstChild) bkListDiv.removeChild(bkListDiv.firstChild);
    if(!list || list.length === 0){
      bkListDiv.appendChild(el("div",{class:"muted",style:"font-size:12px"},"No backups yet."));
      return;
    }
    for(const bk of list){
      const dt = bk.created_at ? new Date(bk.created_at).toLocaleString() : "Unknown";
      const row = el("div",{style:"display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid #1e293b;font-size:12px"});
      row.appendChild(el("div",{style:"flex:1"},[
        el("div",{style:"font-weight:600;color:#e2e8f0"}, `${dt} (v${bk.version || "?"})`),
        bk.note ? el("div",{class:"muted",style:"font-size:11px"}, bk.note) : null,
      ].filter(Boolean)));
      const restoreBtn = el("button",{class:"btn inline",style:"font-size:11px"},"Restore");
      restoreBtn.addEventListener("click", async()=>{
        if(!confirm("Restore this backup? This will overwrite all current PadSpan data.")) return;
        restoreBtn.disabled=true;
        try { await ctx.actions.wsCall("padspan_ha/store_backup_restore", {backup_id: bk.id}); ctx.toast("Backup restored — reloading"); setTimeout(()=>location.reload(), 1500); }
        catch(e){ ctx.toast("Restore failed",true); restoreBtn.disabled=false; }
      });
      const delBtn = el("button",{class:"btn inline",style:"font-size:11px;color:#ef5350"},"Delete");
      delBtn.addEventListener("click", async()=>{
        if(!confirm("Delete this backup?")) return;
        try { await ctx.actions.wsCall("padspan_ha/store_backup_delete", {backup_id: bk.id}); ctx.toast("Backup deleted"); ctx.actions.renderRooms(); }
        catch(e){ ctx.toast("Delete failed",true); }
      });
      row.appendChild(restoreBtn);
      row.appendChild(delBtn);
      bkListDiv.appendChild(row);
    }
  };
  _renderBackups(null);
  (async()=>{
    try {
      const r = await ctx.actions.wsCall("padspan_ha/store_backup_list");
      _renderBackups((r && r.backups) || []);
    } catch(e){ /* best-effort */ }
  })();
  backupCard.appendChild(bkListDiv);
  grid.appendChild(backupCard);

  // ── Radio Analysis ── (full width)
  const radioCard = el("div",{class:"card",style:"grid-column:1/-1"});
  radioCard.appendChild(el("div",{style:"display:flex;align-items:center;gap:8px;margin-bottom:10px"},[
    el("div",{style:"font-weight:700"},"Radio Analysis"),
    helpBtn("qa_radio_analysis"),
  ]));

  const ads = bleAds;

  if(radios.length === 0){
    radioCard.appendChild(el("div",{class:"muted"},"No radios detected."));
  } else {
    // Build per-radio device sets and ad lists from advertisements
    const radioDevSets = {};
    const radioAds = {};
    for(const r of radios){ radioDevSets[r.source] = new Set(); radioAds[r.source] = []; }
    for(const ad of ads){
      const src = ad.source || "";
      if(!radioDevSets[src]){ radioDevSets[src] = new Set(); radioAds[src] = []; }
      radioDevSets[src].add(ad.address);
      radioAds[src].push(ad);
    }

    // Compute per-radio analysis
    const analyses = radios.map(r => {
      const src = r.source || "";
      const devSet = radioDevSets[src] || new Set();
      const myAds = radioAds[src] || [];

      const totalDevices = devSet.size;
      const rssiValues = myAds.filter(a => a.rssi != null).map(a => a.rssi);
      const ageValues = myAds.filter(a => a.age_s != null).map(a => a.age_s);

      const strongestRssi = rssiValues.length ? Math.max(...rssiValues) : null;
      const weakestRssi = rssiValues.length ? Math.min(...rssiValues) : null;
      const avgRssi = rssiValues.length ? Math.round(rssiValues.reduce((a,b)=>a+b,0) / rssiValues.length) : null;
      const freshestAge = ageValues.length ? Math.min(...ageValues) : null;
      const stalestAge = ageValues.length ? Math.max(...ageValues) : null;

      // Tagged/identified devices visible from this scanner
      const taggedVisible = objects.filter(o =>
        (o.identified || o.user_label) &&
        (o.sources||[]).some(s => (typeof s === "string" ? s : s.source) === src)
      ).length;

      // Cross-scanner overlap
      const overlaps = [];
      for(const r2 of radios){
        if(r2.source === src) continue;
        const otherSet = radioDevSets[r2.source] || new Set();
        let shared = 0;
        for(const addr of devSet) if(otherSet.has(addr)) shared++;
        if(shared > 0) overlaps.push({ source: r2.source, name: r2.name || r2.source, shared });
      }
      overlaps.sort((a,b) => b.shared - a.shared);

      // Unique devices (only seen by this scanner)
      let uniqueDevices = 0;
      for(const addr of devSet){
        let seenElsewhere = false;
        for(const r2 of radios){
          if(r2.source === src) continue;
          if((radioDevSets[r2.source] || new Set()).has(addr)){ seenElsewhere = true; break; }
        }
        if(!seenElsewhere) uniqueDevices++;
      }

      // Health verdict — only flag provable issues
      let health, healthColor, healthIcon, reason;
      if(!r.scanning || r.lost || r.disabled){
        // Hard failure: radio is definitively not working
        health = "Unhealthy"; healthColor = "#ef5350"; healthIcon = "\uD83D\uDD34";
        reason = r.lost ? "Radio marked as lost" : r.disabled ? "Radio is disabled" : "Not scanning";
      } else if(totalDevices === 0 && overlaps.length === 0){
        // No overlap with any other radio — could be too far away, not enough data yet
        health = "Unknown"; healthColor = "#94a3b8"; healthIcon = "\u2753";
        reason = "No advertisements yet \u2014 may be out of range of other radios";
      } else if(totalDevices === 0 && radios.filter(rx => rx.source !== src && (radioDevSets[rx.source]||new Set()).size > 0).length > 0){
        // Has nearby radios with data but hears nothing — likely a problem
        health = "Unhealthy"; healthColor = "#ef5350"; healthIcon = "\uD83D\uDD34";
        reason = "No advertisements while nearby radios are active";
      } else if(totalDevices === 0){
        // No ads but no other radios to compare against
        health = "Unknown"; healthColor = "#94a3b8"; healthIcon = "\u2753";
        reason = "No advertisements received \u2014 awaiting data";
      } else if(freshestAge != null && freshestAge > 60){
        // Provable: radio has gone quiet for over a minute
        health = "Fair"; healthColor = "#ffd54f"; healthIcon = "\uD83D\uDFE1";
        reason = `${Math.round(freshestAge)}s since last advertisement`;
      } else {
        health = "Healthy"; healthColor = "#52b788"; healthIcon = "\uD83D\uDFE2";
        const parts = [];
        parts.push(`${totalDevices} device${totalDevices>1?"s":""}`);
        if(avgRssi != null) parts.push(`avg ${avgRssi} dBm`);
        if(freshestAge != null) parts.push(`${Math.round(freshestAge)}s fresh`);
        reason = parts.join(", ");
      }

      return {
        radio: r, src, totalDevices, strongestRssi, weakestRssi, avgRssi,
        freshestAge, stalestAge, taggedVisible, overlaps, uniqueDevices,
        health, healthColor, healthIcon, reason,
        healthOrder: health === "Unhealthy" ? 0 : health === "Unknown" ? 1 : health === "Fair" ? 2 : 3,
      };
    });

    // ── Compute ranking scores per radio ──

    // Build per-device RSSI map: { address → { source → rssi } }
    const deviceRssiMap = {};
    for(const ad of ads){
      if(ad.rssi == null) continue;
      if(!deviceRssiMap[ad.address]) deviceRssiMap[ad.address] = {};
      // Keep best (highest) RSSI per source for each device
      const cur = deviceRssiMap[ad.address][ad.source||""];
      if(cur == null || ad.rssi > cur) deviceRssiMap[ad.address][ad.source||""] = ad.rssi;
    }

    // Hardware Score: compare shared-device RSSI across radios
    // For each radio, compute mean RSSI delta vs each neighbor for shared devices
    const hwDeltas = {}; // src → array of deltas (positive = reads stronger)
    for(const a of analyses){
      hwDeltas[a.src] = [];
      const myDevSet = radioDevSets[a.src] || new Set();
      for(const a2 of analyses){
        if(a2.src === a.src) continue;
        const otherDevSet = radioDevSets[a2.src] || new Set();
        const deltas = [];
        for(const addr of myDevSet){
          if(!otherDevSet.has(addr)) continue;
          const myR = (deviceRssiMap[addr]||{})[a.src];
          const thR = (deviceRssiMap[addr]||{})[a2.src];
          if(myR != null && thR != null) deltas.push(myR - thR);
        }
        if(deltas.length >= 2){
          const avg = deltas.reduce((s,v)=>s+v,0) / deltas.length;
          hwDeltas[a.src].push(avg);
        }
      }
    }
    // Compute raw hardware score: mean of mean deltas (higher = better antenna)
    const hwRaw = {};
    for(const a of analyses){
      const d = hwDeltas[a.src];
      hwRaw[a.src] = d.length > 0 ? d.reduce((s,v)=>s+v,0) / d.length : 0;
    }
    // Normalize to 0-100: best = 100, worst = scaled
    const hwVals = analyses.map(a=>hwRaw[a.src]);
    const hwMin = Math.min(...hwVals), hwMax = Math.max(...hwVals);
    const hwRange = hwMax - hwMin || 1;

    // Coverage Score: breadth of device overlap + unique reach
    const covRaw = {};
    const maxDevices = Math.max(1, ...analyses.map(a=>a.totalDevices));
    for(const a of analyses){
      // Count distinct other scanners this radio shares devices with
      const overlapPartners = a.overlaps.length;
      const maxPartners = Math.max(1, analyses.length - 1);
      const overlapBreadth = overlapPartners / maxPartners; // 0-1
      const deviceBreadth = a.totalDevices / maxDevices;    // 0-1
      const uniqueBonus = a.uniqueDevices / Math.max(1, a.totalDevices); // 0-1
      // Chosen weighting: raw device reach (50%) is the primary signal, overlap
      // with other scanners (35%) as a secondary signal, unique reach as a
      // smaller bonus (15%). Not derived from a formula, just a picked split.
      covRaw[a.src] = Math.round((overlapBreadth * 35 + deviceBreadth * 50 + uniqueBonus * 15));
    }

    // Reliability Score: freshness + consistency + wifi + scanning
    const relRaw = {};
    for(const a of analyses){
      let score = 0;
      const r = a.radio;
      // Freshness (0-35): fresher = better
      if(a.freshestAge != null){
        if(a.freshestAge < 5) score += 35;
        else if(a.freshestAge < 15) score += 28;
        else if(a.freshestAge < 30) score += 20;
        else if(a.freshestAge < 60) score += 10;
      }
      // RSSI spread (0-25): lower spread = more consistent
      if(a.strongestRssi != null && a.weakestRssi != null){
        const spread = a.strongestRssi - a.weakestRssi;
        if(spread < 20) score += 25;
        else if(spread < 35) score += 18;
        else if(spread < 50) score += 10;
        else score += 5;
      }
      // WiFi signal (0-20): stronger = better, wired = perfect
      if(r.connection_type === "wired") score += 20;
      else if(r.wifi_signal != null){
        if(r.wifi_signal >= -45) score += 20;
        else if(r.wifi_signal >= -55) score += 15;
        else if(r.wifi_signal >= -65) score += 10;
        else if(r.wifi_signal >= -75) score += 5;
      }
      // Scanning status (0-20)
      const _hasAds = bleAds.some(ad => ad.source === a.src);
      if(r.scanning && !r.lost && !r.disabled) score += 20;
      else if(r.scanning) score += 10;
      else if(_hasAds && !r.lost && !r.disabled) score += 15;  // passive/listening
      relRaw[a.src] = score;
    }

    // Assign scores to each analysis entry
    for(const a of analyses){
      a.hwScore = Math.round(50 + (hwRaw[a.src] - (hwMin + hwMax)/2) / hwRange * 100);
      a.hwScore = Math.max(0, Math.min(100, a.hwScore));
      a.hwDelta = hwRaw[a.src]; // raw dBm delta for display
      a.covScore = covRaw[a.src];
      a.relScore = relRaw[a.src];
      // Overall: Hardware 40% + Coverage 30% + Reliability 30%
      a.overallScore = Math.round(a.hwScore * 0.4 + a.covScore * 0.3 + a.relScore * 0.3);
      // Sink unhealthy/unknown radios regardless of score
      if(a.health === "Unhealthy" || a.health === "Unknown") a.overallScore = Math.min(a.overallScore, 10);
    }

    // Sort by overall score descending (best first), unhealthy/unknown last
    const _sinkHealth = h => h === "Unhealthy" || h === "Unknown";
    analyses.sort((a,b) => {
      if(_sinkHealth(a.health) && !_sinkHealth(b.health)) return 1;
      if(_sinkHealth(b.health) && !_sinkHealth(a.health)) return -1;
      return b.overallScore - a.overallScore;
    });

    // Assign rank
    analyses.forEach((a,i) => { a.rank = i + 1; });
    const medals = ["\uD83E\uDD47", "\uD83E\uDD48", "\uD83E\uDD49"]; // gold, silver, bronze

    // Score bar helper
    const _scoreBar = (label, value, color) => el("div",{style:"margin-bottom:6px"},[
      el("div",{style:"display:flex;justify-content:space-between;font-size:11px;margin-bottom:2px"},[
        el("span",{class:"muted"}, label),
        el("span",{style:`font-weight:600;color:${color}`}, `${value}/100`),
      ]),
      el("div",{style:"background:#1e293b;border-radius:3px;height:5px;overflow:hidden"},[
        el("div",{style:`width:${value}%;height:100%;background:${color};border-radius:3px;transition:width .3s`}),
      ]),
    ]);
    const _scoreColor = (v) => v >= 75 ? "#52b788" : v >= 50 ? "#38bdf8" : v >= 30 ? "#ffd54f" : "#ef5350";

    // Expand state persists across 5s re-renders
    if(!ctx.state._qaExpandedRadios) ctx.state._qaExpandedRadios = new Set();
    const expanded = ctx.state._qaExpandedRadios;

    const kv = (label, value, valueColor) => el("div",{style:"display:flex;align-items:baseline;gap:8px;padding:3px 0;border-bottom:1px solid #0d1f12;font-size:12px"},[
      el("span",{class:"muted",style:"min-width:110px;flex-shrink:0"}, label + ":"),
      el("span",{style:"font-weight:600;word-break:break-all;" + (valueColor ? `color:${valueColor}` : "")}, String(value != null ? value : "\u2014")),
    ]);

    const list = el("div",{style:"display:flex;flex-direction:column;gap:6px"});

    for(const a of analyses){
      const r = a.radio;
      const isOpen = expanded.has(a.src);
      const borderCol = a.health==="Unhealthy" ? "#7f1d1d" : a.health==="Unknown" ? "#334155" : a.health==="Fair" ? "#5c4b1f" : "#1a4228";
      const bgCol = a.health==="Unhealthy" ? "#1a0a0a" : a.health==="Unknown" ? "#0f172a" : a.health==="Fair" ? "#1a1808" : "#0f1a12";

      // Collapsed summary row — 3 lines: rank + name, metrics, score
      const summary = el("div",{style:`padding:8px 10px;cursor:pointer;border-radius:${isOpen?"8px 8px 0 0":"8px"};border:1px solid ${borderCol};background:${bgCol}`});

      // Row 1: arrow + rank badge + health icon + SID + overall score
      const medal = a.rank <= 3 ? medals[a.rank-1] : "";
      const rankBadge = el("span",{style:"font-weight:800;font-size:12px;color:#94a3b8;flex-shrink:0;min-width:24px"}, `#${a.rank}`);
      const scoreBadge = el("span",{style:`font-size:11px;font-weight:700;color:${_scoreColor(a.overallScore)};background:${_scoreColor(a.overallScore)}18;padding:1px 6px;border-radius:4px;flex-shrink:0;white-space:nowrap;margin-left:auto`}, `${a.overallScore}/100`);
      summary.appendChild(el("div",{style:"display:flex;align-items:center;gap:6px;min-width:0"},[
        el("span",{style:`font-size:10px;color:#94a3b8;flex-shrink:0;transition:transform .15s;transform:rotate(${isOpen?"90":"0"}deg)`}, "\u25B6"),
        rankBadge,
        medal ? el("span",{style:"font-size:14px;flex-shrink:0"}, medal) : null,
        el("span",{style:"flex-shrink:0;font-size:14px"}, a.healthIcon),
        el("span",{class:"pill",style:"font-family:monospace;font-weight:700;font-size:11px;padding:1px 6px;flex-shrink:0",title:(ctx.helpers.radioName(a.src)||"")?ctx.helpers.radioName(a.src)+" \u00b7 "+a.src:a.src}, _sid(a.src)),
        scoreBadge,
      ].filter(Boolean)));

      // Row 2: full radio name (no truncation)
      const nameLink = el("span",{style:"font-weight:600;color:#e2e8f0;cursor:pointer;text-decoration:underline;text-decoration-style:dotted;word-break:break-word"}, esc(r.name || r.source));
      nameLink.addEventListener("click", (ev)=>{ ev.stopPropagation(); ctx.actions.showScannerDetail(r); });
      summary.appendChild(el("div",{style:"padding-left:42px;margin-top:3px"},[nameLink]));

      // Row 3: metrics + health badge + reason
      const metricsLine = [
        el("span",{class:"muted",style:"font-size:11px"}, `${a.totalDevices} device${a.totalDevices!==1?"s":""}`),
      ];
      if(a.avgRssi != null) metricsLine.push(el("span",{class:"muted",style:"font-size:11px;font-family:monospace"}, `avg ${a.avgRssi} dBm`));
      if(r.area_name) metricsLine.push(el("span",{class:"muted",style:"font-size:11px"}, r.area_name));
      metricsLine.push(el("span",{style:`font-size:11px;font-weight:600;color:${a.healthColor}`}, a.health));
      metricsLine.push(el("span",{class:"muted",style:"font-size:10px"}, `\u2014 ${a.reason}`));
      summary.appendChild(el("div",{style:"display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-top:4px;padding-left:42px"}, metricsLine));

      summary.addEventListener("click", ()=>{
        if(expanded.has(a.src)) expanded.delete(a.src); else expanded.add(a.src);
        ctx.actions.renderRooms();
      });

      const wrapper = el("div",{});
      wrapper.appendChild(summary);

      // Expanded detail panel
      if(isOpen){
        const detail = el("div",{style:`padding:10px 12px;border:1px solid ${borderCol};border-top:none;border-radius:0 0 8px 8px;background:#091209`});

        // ── Performance Ranking ──
        detail.appendChild(el("div",{style:"font-weight:600;font-size:12px;margin-bottom:8px;color:#94a3b8"},"Performance Ranking"));
        const rankGrid = el("div",{style:"margin-bottom:12px"});
        const hwLabel = a.hwDelta > 0 ? `reads ${a.hwDelta.toFixed(1)} dBm stronger than neighbors` : a.hwDelta < 0 ? `reads ${Math.abs(a.hwDelta).toFixed(1)} dBm weaker than neighbors` : "comparable to neighbors";
        rankGrid.appendChild(_scoreBar(`Hardware \u2014 ${hwLabel}`, a.hwScore, _scoreColor(a.hwScore)));
        rankGrid.appendChild(_scoreBar(`Coverage \u2014 ${a.totalDevices} devices, ${a.overlaps.length} neighbor${a.overlaps.length!==1?"s":""}`, a.covScore, _scoreColor(a.covScore)));
        rankGrid.appendChild(_scoreBar(`Reliability \u2014 ${a.freshestAge!=null?Math.round(a.freshestAge)+"s fresh":"no ads"}`, a.relScore, _scoreColor(a.relScore)));
        rankGrid.appendChild(el("div",{style:"display:flex;justify-content:space-between;align-items:center;margin-top:6px;padding-top:6px;border-top:1px solid #1e293b"},[
          el("span",{style:"font-weight:700;font-size:12px;color:#e2e8f0"}, "Overall"),
          el("span",{style:`font-weight:800;font-size:14px;color:${_scoreColor(a.overallScore)}`}, `${a.overallScore}/100`),
        ]));
        // Hardware insight note
        if(hwDeltas[a.src].length > 0){
          const bestNeighbor = analyses.find(x => x.src !== a.src && x.rank === 1);
          if(bestNeighbor && a.src !== bestNeighbor.src){
            const delta = hwRaw[a.src] - hwRaw[bestNeighbor.src];
            if(Math.abs(delta) >= 2){
              const note = delta > 0
                ? `This radio's hardware outperforms ${esc(bestNeighbor.radio.name||bestNeighbor.src)} by ~${Math.abs(delta).toFixed(1)} dBm on average for shared devices, suggesting a better antenna or Bluetooth chipset.`
                : `${esc(bestNeighbor.radio.name||bestNeighbor.src)} outperforms this radio by ~${Math.abs(delta).toFixed(1)} dBm on shared devices \u2014 may have a better antenna or chipset.`;
              rankGrid.appendChild(el("div",{class:"muted",style:"font-size:11px;margin-top:4px;font-style:italic"}, note));
            }
          }
        }
        detail.appendChild(rankGrid);

        // Identity & Network
        detail.appendChild(el("div",{style:"font-weight:600;font-size:12px;margin-bottom:6px;color:#94a3b8"},"Identity & Network"));
        const netGrid = el("div",{});
        netGrid.appendChild(kv("Source ID", a.src));
        netGrid.appendChild(kv("Area", r.area_name || "Unassigned"));
        netGrid.appendChild(kv("Adapter", r.adapter || "\u2014"));
        netGrid.appendChild(kv("IP Address", r.ip || "not available"));
        netGrid.appendChild(kv("SSID", r.ssid || "not available"));
        netGrid.appendChild(kv("Connection", r.connection_type || "not available"));
        netGrid.appendChild(kv("WiFi Signal", r.wifi_signal != null ? `${r.wifi_signal} dBm` : "not available",
          r.wifi_signal != null && r.wifi_signal >= -50 ? "#52b788" : r.wifi_signal != null && r.wifi_signal < -70 ? "#ef5350" : null));
        detail.appendChild(netGrid);

        // Status badges
        const statusRow = el("div",{style:"display:flex;gap:6px;flex-wrap:wrap;margin:8px 0"});
        { const _ss = ctx.helpers.scannerStatus; if(_ss){ const ss = _ss(r, bleAds); const b = el("span",{class:ss.cls,title:ss.title},ss.label); if(ss.style) b.style.cssText+=ss.style; statusRow.appendChild(b); } else { statusRow.appendChild(el("span",{class:r.scanning?"badge":"badge warn"}, r.scanning?"scanning":"not scanning")); } }
        statusRow.appendChild(el("span",{class:"badge"}, r.connectable?"connectable":"not connectable"));
        if(r.lost) statusRow.appendChild(el("span",{class:"badge warn",style:"background:rgba(245,158,11,.18)"}, "\u26A0 Lost"));
        if(r.disabled) statusRow.appendChild(el("span",{class:"badge warn",style:"background:rgba(148,100,220,.18);color:#c084fc"}, "\u2298 Disabled"));
        detail.appendChild(statusRow);

        // Activity Metrics
        detail.appendChild(el("div",{style:"font-weight:600;font-size:12px;margin:10px 0 6px;color:#94a3b8"},"Activity Metrics"));
        const actGrid = el("div",{style:"display:grid;grid-template-columns:1fr 1fr;gap:0 20px"});
        actGrid.appendChild(kv("Total devices", a.totalDevices));
        actGrid.appendChild(kv("Tagged / identified", a.taggedVisible));
        actGrid.appendChild(kv("Strongest RSSI", a.strongestRssi != null ? `${a.strongestRssi} dBm` : "\u2014",
          a.strongestRssi != null && a.strongestRssi >= -60 ? "#52b788" : null));
        actGrid.appendChild(kv("Weakest RSSI", a.weakestRssi != null ? `${a.weakestRssi} dBm` : "\u2014",
          a.weakestRssi != null && a.weakestRssi < -80 ? "#ef5350" : null));
        actGrid.appendChild(kv("Avg RSSI", a.avgRssi != null ? `${a.avgRssi} dBm` : "\u2014"));
        actGrid.appendChild(kv("RSSI spread", (a.strongestRssi != null && a.weakestRssi != null) ? `${a.strongestRssi - a.weakestRssi} dB` : "\u2014"));
        actGrid.appendChild(kv("Freshest ad", a.freshestAge != null ? `${Math.round(a.freshestAge)}s` : "\u2014",
          a.freshestAge != null && a.freshestAge < 10 ? "#52b788" : a.freshestAge != null && a.freshestAge > 30 ? "#ef5350" : null));
        actGrid.appendChild(kv("Stalest ad", a.stalestAge != null ? `${Math.round(a.stalestAge)}s` : "\u2014"));
        detail.appendChild(actGrid);

        // Cross-Scanner Comparison
        detail.appendChild(el("div",{style:"font-weight:600;font-size:12px;margin:10px 0 6px;color:#94a3b8"},"Cross-Scanner Comparison"));
        if(a.overlaps.length > 0){
          for(const ov of a.overlaps.slice(0, 5)){
            detail.appendChild(el("div",{style:"font-size:12px;padding:2px 0"},[
              el("span",{}, "Shares "),
              el("span",{style:"font-weight:600;color:#5eead4"}, String(ov.shared)),
              el("span",{}, ` device${ov.shared>1?"s":""} with `),
              el("span",{style:"font-weight:600"}, esc(ov.name)),
              el("span",{class:"muted",style:"font-size:10px;margin-left:4px"}, `[${_sid(ov.source)}]`),
            ]));
          }
        } else {
          detail.appendChild(el("div",{class:"muted",style:"font-size:12px"},"No device overlap with other scanners."));
        }
        detail.appendChild(kv("Unique devices (only this scanner)", a.uniqueDevices));

        // Health Verdict
        detail.appendChild(el("div",{style:"font-weight:600;font-size:12px;margin:10px 0 6px;color:#94a3b8"},"Health Verdict"));
        detail.appendChild(el("div",{style:"display:flex;align-items:center;gap:8px"},[
          el("span",{style:"font-size:16px"}, a.healthIcon),
          el("span",{style:`font-weight:700;color:${a.healthColor}`}, a.health),
          el("span",{class:"muted",style:"font-size:11px"}, `\u2014 ${a.reason}`),
        ]));

        wrapper.appendChild(detail);
      }

      list.appendChild(wrapper);
    }

    radioCard.appendChild(list);
  }
  grid.appendChild(radioCard);

  // Quick Actions merged into Data Consistency card above

  root.appendChild(grid);
  return root;
}
