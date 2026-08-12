// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
// See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
/**
 * Health view — system status summary + Phase 4 System Critics.
 *
 * Top section: quick system info (version, build, data mode, refresh timing).
 * Scanner Health: Phase 3 per-scanner reliability table.
 * System Critics: Phase 4 unified self-diagnosis — room confusion, map quality,
 *   scanner issues, calibration status, and propagation health.  Fetched via
 *   the padspan_ha/system_critics WS handler on each render.
 */

// Cache for critics data — refreshed when view is active
let _criticsCache = null;
let _criticsFetchTs = 0;
const _CRITICS_TTL_MS = 30000; // refresh every 30s

export function render(ctx){
  const { el } = ctx.helpers;
  const root = el("section",{id:"health"});
  root.className = ctx.state.view==="health" ? "" : "hidden";

  const snap = ctx.state.live.snapshot;
  const rooms = snap?.rooms?.length ?? Object.keys(ctx.state.roomTagMap||{}).length;
  const tags = snap?.tags?.length ?? Object.values(ctx.state.roomTagMap||{}).reduce((a,b)=>a+(b?.length||0),0);
  const radios = snap?.radios?.length ?? 0;

  root.appendChild(el("div",{class:"grid"},[
    el("div",{class:"card"},[
      el("div",{style:"font-weight:700"},"System"),
      el("div",{class:"mono"}, `UI v${ctx.state.version} • build ${ctx.state.buildId}`),
      el("div",{class:"mono"}, `Data mode: ${ctx.state.dataMode.toUpperCase()}`),
      el("div",{class:"mono"}, `Refresh: ${ctx.state.timing.lastRefreshMs ?? "\u2014"}ms`),
    ]),
    el("div",{class:"card"},[
      el("div",{style:"font-weight:700"},"Live Discovery (best-effort)"),
      el("div",{class:"mono"}, `Rooms: ${rooms}`),
      el("div",{class:"mono"}, `Radios: ${radios}`),
      el("div",{class:"mono"}, `Tags/Objects: ${tags}`),
      el("div",{class:"muted", style:"margin-top:8px"},"For deeper validation, open Diagnostics and paste the JSON into chat."),
    ]),
  ]));

  // ── Scanner Health (Phase 3) ────────────────────────────────────────────
  const sh = snap?.scanner_health;
  if (sh && Object.keys(sh).length) {
    const _sid = ctx.helpers.radioShortId;
    const liveRadios = (snap?.ble?.radios) || [];
    const nameMap = {};
    for (const r of liveRadios) { if(r.source && r.name) nameMap[r.source] = r.name; }
    const entries = Object.entries(sh).sort((a,b) => a[1].reliability - b[1].reliability);
    const shCard = el("div",{class:"card",style:"margin-top:12px"});
    shCard.appendChild(el("div",{style:"font-weight:700;margin-bottom:8px"},"Scanner Health"));
    const tbl = el("div",{style:"display:grid;grid-template-columns:auto 1fr auto auto auto;gap:4px 10px;font-size:11px;align-items:center"});
    // Header
    for(const h of ["","Scanner","Room","Agreement","Weight"]){
      tbl.appendChild(el("div",{style:"font-weight:600;color:#94a3b8;font-size:10px;text-transform:uppercase"},h));
    }
    for(const [src, d] of entries){
      const rel = d.reliability;
      const dotColor = rel >= 0.9 ? "#52b788" : rel >= 0.7 ? "#f59e0b" : "#f87171";
      const sid = _sid ? _sid(src) : "";
      const name = nameMap[src] || src;
      tbl.appendChild(el("div",{style:`display:flex;align-items:center;gap:4px`},[
        el("span",{style:`display:inline-block;width:8px;height:8px;border-radius:50%;background:${dotColor}`}),
        sid ? el("span",{class:"pill",style:"font-family:monospace;font-size:10px;padding:0 4px"},sid) : null,
      ].filter(Boolean)));
      tbl.appendChild(el("div",{style:"overflow:hidden;text-overflow:ellipsis;white-space:nowrap"},name));
      tbl.appendChild(el("div",{class:"muted"},d.room || "\u2014"));
      tbl.appendChild(el("div",{style:`color:${dotColor}`},`${d.agree_pct}%`));
      tbl.appendChild(el("div",{class:"mono"},String(rel)));
    }
    shCard.appendChild(tbl);
    // Flag scanners with low reliability
    const bad = entries.filter(([,d]) => d.reliability < 0.7 && d.polls >= 12);
    if(bad.length){
      const warn = el("div",{style:"margin-top:8px;padding:8px;background:rgba(248,113,113,.08);border:1px solid rgba(248,113,113,.2);border-radius:6px;font-size:11px;color:#fca5a5"});
      warn.innerHTML = `<b>\u26a0 ${bad.length} scanner(s) below 70% reliability</b><br>` +
        bad.map(([src,d]) => `${nameMap[src]||src} (${d.agree_pct}% agreement)`).join(", ") +
        `<br><span style="color:#94a3b8;font-size:10px">These scanners frequently disagree with consensus room assignments. Check placement, antenna orientation, or RSSI offset.</span>`;
      shCard.appendChild(warn);
    }
    root.appendChild(shCard);
  }

  // ── Fabric Health (Phase 1-3 decoupling) ────────────────────────────────
  root.appendChild(el("div",{style:"display:flex;align-items:center;gap:8px;margin-top:16px"},[
    el("div",{style:"font-weight:700;font-size:14px;color:#52b788"},"Positioning Fabric"),
  ]));
  const fabricContainer = el("div",{id:"health-fabric",style:"margin-top:8px"});
  root.appendChild(fabricContainer);
  _fetchAndRenderFabric(ctx, fabricContainer);

  // ── Phase 4: System Critics ─────────────────────────────────────────────
  root.appendChild(el("div",{style:"display:flex;align-items:center;gap:8px;margin-top:16px"},[
    el("div",{style:"font-weight:700;font-size:14px;color:#52b788"},"System Critics"),
    ctx.helpers.helpBtn("health_critics"),
  ]));
  const criticsContainer = el("div",{id:"health-critics",style:"margin-top:8px"});
  root.appendChild(criticsContainer);

  // Fetch critics data (async, updates the container when ready)
  _fetchAndRenderCritics(ctx, criticsContainer);

  return root;
}


// ── Fabric Health fetch & render ──────────────────────────────────────────

let _fabricCache = null;
let _fabricFetchTs = 0;
const _FABRIC_TTL_MS = 15000;

async function _fetchAndRenderFabric(ctx, container) {
  const { el } = ctx.helpers;
  const now = Date.now();
  if (_fabricCache && (now - _fabricFetchTs) < _FABRIC_TTL_MS) {
    _renderFabric(ctx, container, _fabricCache);
    return;
  }
  container.innerHTML = "";
  container.appendChild(el("div",{class:"card",style:"text-align:center;color:#94a3b8;padding:16px"},"Loading fabric diagnostics\u2026"));
  try {
    const res = await ctx.actions.callWS({ type: "padspan_ha/fabric_health" });
    _fabricCache = res;
    _fabricFetchTs = Date.now();
    _renderFabric(ctx, container, res);
  } catch (err) {
    container.innerHTML = "";
    container.appendChild(el("div",{class:"card",style:"color:#fca5a5"},`Failed: ${err.message || err}`));
  }
}

function _renderFabric(ctx, container, data) {
  const { el } = ctx.helpers;
  container.innerHTML = "";
  const { summary, checks, scanners, scanner_positions_m, room_geometry_m, adjacency } = data;

  // ── Fabric status ────────────────────────────────────────────────────────
  // (The old "Migrate to Fabric" button is gone deliberately: it re-derived
  // room shapes from per-photo calibration — the exact operation that
  // corrupted live data. Rooms are built once in Mapping → Rooms instead.)
  if (scanner_positions_m?.length || room_geometry_m?.length) {
    container.appendChild(el("div",{style:"display:flex;align-items:center;gap:8px;margin-bottom:8px;padding:6px 10px;background:rgba(82,183,136,.06);border:1px solid #52b78833;border-radius:8px"},[
      el("span",{style:"color:#52b788;font-size:13px"},"✅"),
      el("span",{style:"font-size:12px;color:#52b788;font-weight:600"},"Fabric active"),
      el("span",{style:"font-size:11px;color:#94a3b8"},
        `${scanner_positions_m?.length || 0} scanners · ${room_geometry_m?.length || 0} rooms`),
    ]));
  }

  // ── Per-floor room fabric: committed state + coherence ─────────────────
  const _fabricFloors = data.fabric_floors || {};
  if (Object.keys(_fabricFloors).length) {
    const _ffCard = el("div",{class:"card",style:"margin-bottom:8px;padding:12px"});
    _ffCard.appendChild(el("div",{style:"font-weight:700;font-size:12px;color:#94a3b8;text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px"},
      "Room Fabric by Floor"));
    const _ffTbl = el("div",{style:"display:grid;grid-template-columns:1fr auto auto auto auto;gap:3px 10px;font-size:10px;align-items:center"});
    for (const h of ["Floor","Rooms","Footprint","Clusters","Status"]) {
      _ffTbl.appendChild(el("div",{style:"font-weight:600;color:#64748b;text-transform:uppercase"},h));
    }
    for (const [fid, f] of Object.entries(_fabricFloors).sort()) {
      const _cl = f.clusters;
      const _clBad = typeof _cl === "number" && _cl > 1;
      _ffTbl.appendChild(el("div",{style:"color:#e2e8f0;font-weight:600"},fid));
      _ffTbl.appendChild(el("div",{class:"mono",style:"text-align:right"},String(f.rooms ?? 0)));
      _ffTbl.appendChild(el("div",{class:"mono",style:"color:#94a3b8"},
        f.bbox_w_m != null ? `${f.bbox_w_m}m × ${f.bbox_h_m}m` : "—"));
      _ffTbl.appendChild(el("div",{class:"mono",style:`color:${_clBad?"#f87171":"#52b788"};font-weight:${_clBad?"700":"400"}`},
        _clBad ? `⚠ ${_cl}` : String(_cl ?? "—")));
      _ffTbl.appendChild(el("div",{style:`color:${f.committed?"#52b788":"#f59e0b"};font-weight:600`},
        f.committed ? "🔒 committed" : "not committed"));
    }
    _ffCard.appendChild(_ffTbl);
    container.appendChild(_ffCard);
  }

  // ── Summary banner ─────────────────────────────────────────────────────
  const color = summary.healthy ? "#52b788" : summary.failed > 2 ? "#f87171" : "#f59e0b";
  const bg = summary.healthy ? "rgba(82,183,136,.08)" : "rgba(248,113,113,.08)";
  container.appendChild(el("div",{class:"card",style:`border:1px solid ${color}33;background:${bg};margin-bottom:12px`},[
    el("div",{style:`display:flex;align-items:center;gap:8px`},[
      el("div",{style:`font-weight:800;font-size:14px;color:${color}`},"Fabric Status"),
      el("div",{class:"pill",style:`background:${color}22;color:${color};font-size:10px;padding:2px 8px`},
        summary.healthy ? "ALL PASS" : `${summary.failed} ISSUE${summary.failed!==1?"S":""}`),
    ]),
    el("div",{style:`font-size:11px;color:#94a3b8;margin-top:4px`},
      `${summary.passed}/${summary.total} checks passed`),
  ]));

  // ── Check results by group ─────────────────────────────────────────────
  const groups = [
    { key: "fabric_sync", label: "Phase 1 \u2014 Scanner Fabric" },
    { key: "spatial", label: "Phase 2 \u2014 Spatial Model (metres)" },
    { key: "calibration", label: "Phase 3 \u2014 Calibration" },
    { key: "identity", label: "Device Identity Registry" },
    { key: "multifloor", label: "Multi-Floor Accuracy" },
    { key: "occupancy", label: "Occupancy Estimator" },
  ];
  for (const g of groups) {
    const gc = checks.filter(c => c.group === g.key);
    if (!gc.length) continue;
    const card = el("div",{class:"card",style:"margin-bottom:8px;padding:12px"});
    card.appendChild(el("div",{style:"font-weight:700;font-size:12px;color:#94a3b8;text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px"},g.label));
    const tbl = el("div",{style:"display:grid;grid-template-columns:18px 1fr auto;gap:4px 8px;font-size:11px;align-items:center"});
    for (const c of gc) {
      const dot = c.ok ? "\u2705" : "\u274c";
      tbl.appendChild(el("div",{style:"font-size:13px;line-height:1"},dot));
      tbl.appendChild(el("div",{},[
        el("span",{style:"font-weight:600;color:#e2e8f0"},c.name),
        el("span",{style:"color:#64748b;margin-left:6px"},c.detail),
      ]));
      tbl.appendChild(el("div",{class:"mono",style:`color:${c.ok?"#52b788":"#fca5a5"};font-weight:600;white-space:nowrap`},String(c.value)));
    }
    card.appendChild(tbl);
    container.appendChild(card);
  }

  // ── Scanner positions (metres) ─────────────────────────────────────────
  if (scanner_positions_m && scanner_positions_m.length) {
    const card = el("div",{class:"card",style:"margin-bottom:8px;padding:12px"});
    card.appendChild(el("div",{style:"font-weight:700;font-size:12px;color:#94a3b8;text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px"},
      `Scanner Positions in Metres (${scanner_positions_m.length})`));
    const tbl = el("div",{style:"display:grid;grid-template-columns:1fr auto auto auto auto auto;gap:3px 8px;font-size:10px;align-items:center"});
    for (const h of ["Source","X","Y","Z","Floor","Origin"]) {
      tbl.appendChild(el("div",{style:"font-weight:600;color:#64748b;text-transform:uppercase"},h));
    }
    for (const p of scanner_positions_m) {
      tbl.appendChild(el("div",{style:"overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#e2e8f0"},p.source));
      tbl.appendChild(el("div",{class:"mono",style:"text-align:right"},p.x_m != null ? p.x_m.toFixed(2) : "\u2014"));
      tbl.appendChild(el("div",{class:"mono",style:"text-align:right"},p.y_m != null ? p.y_m.toFixed(2) : "\u2014"));
      tbl.appendChild(el("div",{class:"mono",style:"text-align:right"},p.z_m != null ? p.z_m.toFixed(1) : "\u2014"));
      tbl.appendChild(el("div",{class:"mono",style:"color:#64748b"},p.floor_id));
      tbl.appendChild(el("div",{style:`color:${p.origin==="manual"?"#f59e0b":"#52b788"}`},p.origin));
    }
    card.appendChild(tbl);
    container.appendChild(card);
  }

  // ── Room geometry (metres) ─────────────────────────────────────────────
  if (room_geometry_m && room_geometry_m.length) {
    const card = el("div",{class:"card",style:"margin-bottom:8px;padding:12px"});
    card.appendChild(el("div",{style:"font-weight:700;font-size:12px;color:#94a3b8;text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px"},
      `Room Geometry in Metres (${room_geometry_m.length})`));
    const tbl = el("div",{style:"display:grid;grid-template-columns:1fr auto auto auto auto;gap:3px 8px;font-size:10px;align-items:center"});
    for (const h of ["Room","Type","Centroid","Floor","Origin"]) {
      tbl.appendChild(el("div",{style:"font-weight:600;color:#64748b;text-transform:uppercase"},h));
    }
    for (const g of room_geometry_m) {
      const cStr = g.centroid_m ? `(${g.centroid_m[0]}, ${g.centroid_m[1]})` : "\u2014";
      tbl.appendChild(el("div",{style:"color:#e2e8f0;font-weight:600"},g.room));
      tbl.appendChild(el("div",{class:"mono"},g.type));
      tbl.appendChild(el("div",{class:"mono",style:"color:#94a3b8"},cStr));
      tbl.appendChild(el("div",{class:"mono",style:"color:#64748b"},g.floor_id));
      tbl.appendChild(el("div",{style:`color:${g.origin==="manual"?"#f59e0b":"#52b788"}`},g.origin));
    }
    card.appendChild(tbl);
    container.appendChild(card);
  }

  // ── Adjacency map ──────────────────────────────────────────────────────
  if (adjacency && Object.keys(adjacency).length) {
    const card = el("div",{class:"card",style:"margin-bottom:8px;padding:12px"});
    card.appendChild(el("div",{style:"font-weight:700;font-size:12px;color:#94a3b8;text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px"},
      `Room Adjacency (${Object.keys(adjacency).length} rooms)`));
    const list = el("div",{style:"font-size:11px;line-height:1.8"});
    for (const [room, neighbors] of Object.entries(adjacency).sort()) {
      list.appendChild(el("div",{},[
        el("span",{style:"font-weight:600;color:#e2e8f0"},room),
        el("span",{style:"color:#64748b"}," \u2192 "),
        el("span",{style:"color:#94a3b8"},neighbors.length ? neighbors.join(", ") : "(none)"),
      ]));
    }
    card.appendChild(list);
    container.appendChild(card);
  }

  // ── Scanner mappings table ─────────────────────────────────────────────
  if (scanners && scanners.length) {
    const card = el("div",{class:"card",style:"margin-bottom:8px;padding:12px"});
    card.appendChild(el("div",{style:"font-weight:700;font-size:12px;color:#94a3b8;text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px"},
      `Scanner \u2192 Room Mappings (${scanners.length})`));
    const tbl = el("div",{style:"display:grid;grid-template-columns:1fr 1fr auto auto;gap:3px 8px;font-size:10px;align-items:center"});
    for (const h of ["Source","Room","Floor","Type"]) {
      tbl.appendChild(el("div",{style:"font-weight:600;color:#64748b;text-transform:uppercase"},h));
    }
    for (const s of scanners) {
      const typeColor = s.source_type === "manual" ? "#f59e0b" : "#52b788";
      tbl.appendChild(el("div",{style:"overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#e2e8f0"},s.source));
      tbl.appendChild(el("div",{style:"color:#94a3b8"},s.room));
      tbl.appendChild(el("div",{class:"mono",style:"color:#64748b"},s.floor_id));
      tbl.appendChild(el("div",{style:`color:${typeColor};font-weight:600`},s.source_type));
    }
    card.appendChild(tbl);
    container.appendChild(card);
  }

  // ── Quick actions ───────────────────────────────────────────────────────
  {
    const actCard = el("div",{style:"display:flex;gap:8px;margin-bottom:8px;flex-wrap:wrap"});

    // Retrain RF
    const rfCheck = checks.find(c => c.name === "RF Model");
    if (rfCheck) {
      const rfBtn = el("button",{class:"btn",style:"width:auto;padding:4px 14px;font-size:11px"},
        `Retrain RF (${rfCheck.value})`);
      rfBtn.addEventListener("click", async () => {
        rfBtn.disabled = true; rfBtn.textContent = "Retraining\u2026";
        try {
          const r = await ctx.actions.callWS({type:"padspan_ha/calibration_retrain_rf"});
          ctx.toast(`RF retrained: ${r.use_metres ? "metres" : "fractions"}, ${r.point_count} pts`);
          _fabricCache = null; _fabricFetchTs = 0; _fetchAndRenderFabric(ctx, container);
        } catch(e) { ctx.toast(`Failed: ${e.message||e}`); rfBtn.disabled = false; rfBtn.textContent = "Retrain RF"; }
      });
      actCard.appendChild(rfBtn);
    }

    // Repair positioning (one shot: align maps to stack, re-derive cal metres, retrain)
    const repBtn = el("button",{class:"btn",style:"width:auto;padding:4px 14px;font-size:11px"},
      "🔧 Repair Positioning");
    repBtn.addEventListener("click", async () => {
      // This rewrites the real-world metres on every calibration point. It is
      // recoverable (a backup is taken automatically first) but it is not a
      // read-only diagnostic, and it should not run because someone clicked
      // the shiniest button on the page.
      if(!confirm(
        "Repair positioning?\n\n"
        + "Every calibration point's real-world position will be recalculated, "
        + "and points that can't be anchored will lose their position (they stay "
        + "usable as signal fingerprints). The model is then retrained.\n\n"
        + "A backup is saved first, so this can be undone from Backup & Restore.")) return;
      repBtn.disabled = true; repBtn.textContent = "Repairing…";
      try {
        const r = await ctx.actions.callWS({type:"padspan_ha/positioning_repair"});
        ctx.toast(`Repaired ${r.maps_repaired.length} maps; cal: ${r.cal_from_map} from map, `
          + `${r.cal_room_snapped || 0} snapped to room, ${r.cal_from_room} from centroid, `
          + `${r.cal_cleared} cleared. RF ${r.rf_trained ? "retrained" : "NOT trained"}.`
          + (r.backup_id ? ` Backup saved (${r.backup_id}).` : ""));
        _fabricCache = null; _fabricFetchTs = 0; _fetchAndRenderFabric(ctx, container);
        repBtn.disabled = false; repBtn.textContent = "🔧 Repair Positioning";
      } catch(e) { ctx.toast(`Failed: ${e.message||e}`); repBtn.disabled = false; repBtn.textContent = "🔧 Repair Positioning"; }
    });
    actCard.appendChild(repBtn);

    // Resync scanners (fix room/floor assignments)
    const resyncBtn = el("button",{class:"btn",style:"width:auto;padding:4px 14px;font-size:11px"},
      "Resync Scanners");
    resyncBtn.addEventListener("click", async () => {
      resyncBtn.disabled = true; resyncBtn.textContent = "Resyncing\u2026";
      try {
        const r = await ctx.actions.callWS({type:"padspan_ha/fabric_resync"});
        ctx.toast(`Resync: removed ${r.removed}, added ${r.added}, pruned ${r.pruned} \u2192 ${r.final_count} scanners`);
        _fabricCache = null; _fabricFetchTs = 0; _fetchAndRenderFabric(ctx, container);
      } catch(e) { ctx.toast(`Failed: ${e.message||e}`); resyncBtn.disabled = false; resyncBtn.textContent = "Resync Scanners"; }
    });
    actCard.appendChild(resyncBtn);

    // Reset spatial model (nuclear option)
    const resetBtn = el("button",{class:"btn",style:"width:auto;padding:4px 14px;font-size:11px;border-color:#f8717144;color:#fca5a5"},
      "Reset Spatial Model");
    resetBtn.addEventListener("click", async () => {
      if (!confirm("Clear scanner positions, barriers, and map transforms? Room shapes (the fabric) and calibration points are NOT touched.")) return;
      resetBtn.disabled = true; resetBtn.textContent = "Resetting\u2026";
      try {
        const r = await ctx.actions.callWS({type:"padspan_ha/fabric_reset_spatial"});
        ctx.toast(`Reset: ${r.transforms} transforms, ${r.scanners} positions, ${r.rooms} rooms, ${r.cal_backfilled} cal pts rebuilt`);
        _fabricCache = null; _fabricFetchTs = 0; _fetchAndRenderFabric(ctx, container);
      } catch(e) { ctx.toast(`Failed: ${e.message||e}`); resetBtn.disabled = false; resetBtn.textContent = "Reset Spatial Model"; }
    });
    actCard.appendChild(resetBtn);

    // Migrate Device Identity Registry (if needed)
    const _idCheck = (checks||[]).find(c => c.group === "identity" && c.name === "Identity Migration");
    if (_idCheck && _idCheck.value === "needed") {
      const idBtn = el("button",{class:"btn save-pulse",style:"width:auto;padding:4px 14px;font-size:11px;background:#92400e;border-color:#f59e0b;color:#fbbf24;font-weight:700"},
        "\ud83d\udd11 Migrate Device Identity");
      idBtn.addEventListener("click", async () => {
        idBtn.disabled = true; idBtn.textContent = "Migrating\u2026"; idBtn.classList.remove("save-pulse");
        try {
          const r = await ctx.actions.callWS({type:"padspan_ha/device_registry_migrate"});
          ctx.toast(`Identity: ${r.migrated} devices migrated, ${r.merged} merged \u2192 ${r.total_devices} total`);
          _fabricCache = null; _fabricFetchTs = 0; _fetchAndRenderFabric(ctx, container);
        } catch(e) { ctx.toast(`Failed: ${e.message||e}`); idBtn.disabled=false; idBtn.textContent="\ud83d\udd11 Migrate Device Identity"; idBtn.classList.add("save-pulse"); }
      });
      actCard.appendChild(idBtn);
    }

    container.appendChild(actCard);
  }

  // ── Maps diagnostic table ───────────────────────────────────────────────
  const maps = data.maps || [];
  if (maps.length) {
    const card = el("div",{class:"card",style:"margin-bottom:8px;padding:12px"});
    card.appendChild(el("div",{style:"font-weight:700;font-size:12px;color:#94a3b8;text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px"},
      `Maps (${maps.length})`));
    const tbl = el("div",{style:"display:grid;grid-template-columns:1fr auto auto auto auto auto auto;gap:3px 8px;font-size:10px;align-items:center"});
    for (const h of ["Name","Size","px/m","Receivers","Rooms","Barriers","Floor"]) {
      tbl.appendChild(el("div",{style:"font-weight:600;color:#64748b;text-transform:uppercase"},h));
    }
    for (const m of maps) {
      const ppm = m.px_per_meter;
      const ppmColor = ppm ? "#52b788" : "#f87171";
      tbl.appendChild(el("div",{style:"overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#e2e8f0"},m.name));
      tbl.appendChild(el("div",{class:"mono",style:"white-space:nowrap"},`${m.width}\u00d7${m.height}`));
      tbl.appendChild(el("div",{class:"mono",style:`color:${ppmColor}`},ppm ? String(Math.round(ppm)) : "none"));
      tbl.appendChild(el("div",{class:"mono",style:"text-align:center"},String(m.has_receivers)));
      tbl.appendChild(el("div",{class:"mono",style:"text-align:center"},String(m.has_room_bounds)));
      tbl.appendChild(el("div",{class:"mono",style:"text-align:center"},String(m.has_rf_barriers)));
      tbl.appendChild(el("div",{class:"mono",style:"color:#64748b"},m.floor_id));
    }
    card.appendChild(tbl);
    container.appendChild(card);
  }

  // ── Migrate button (when transforms missing) ───────────────────────────
  const hasTransforms = checks.some(c => c.name === "Map Transforms" && c.value > 0);
  if (!hasTransforms) {
    const migrateCard = el("div",{class:"card",style:"margin-bottom:8px;padding:12px;border:1px solid #f59e0b33;background:rgba(245,158,11,.06)"});
    migrateCard.appendChild(el("div",{style:"font-weight:700;font-size:12px;color:#fbbf24;margin-bottom:8px"},
      "No map transforms \u2014 set floor width to bootstrap the spatial model"));
    const row = el("div",{style:"display:flex;align-items:center;gap:8px"});
    const input = el("input",{type:"number",value:"20",min:"5",max:"200",step:"1",
      style:"width:80px;padding:4px 8px;border:1px solid #334155;border-radius:4px;background:#1e293b;color:#e2e8f0;font-size:12px"});
    row.appendChild(el("span",{style:"font-size:11px;color:#94a3b8"},"Floor width:"));
    row.appendChild(input);
    row.appendChild(el("span",{style:"font-size:11px;color:#94a3b8"},"metres"));
    const migrateBtn = el("button",{class:"btn",style:"width:auto;padding:4px 14px;font-size:11px;margin-left:8px"},"Migrate to Metres");
    migrateBtn.addEventListener("click", async () => {
      const w = parseFloat(input.value);
      if (!w || w < 1) { ctx.toast("Enter a valid floor width"); return; }
      migrateBtn.disabled = true;
      migrateBtn.textContent = "Migrating\u2026";
      try {
        const res = await ctx.actions.callWS({
          type: "padspan_ha/fabric_migrate_from_maps",
          default_floor_width_m: w,
        });
        // Also retrain RF to pick up metre-space data
        try { await ctx.actions.callWS({type:"padspan_ha/calibration_retrain_rf"}); } catch(e){}
        ctx.toast(`Migrated: ${res.transforms_computed} transforms, ${res.scanners_migrated} scanners, ${res.rooms_migrated} rooms, ${res.cal_points_backfilled || 0} cal points. RF retrained.`);
        _fabricCache = null; _fabricFetchTs = 0;
        _fetchAndRenderFabric(ctx, container);
      } catch (err) {
        ctx.toast(`Migration failed: ${err.message || err}`);
        migrateBtn.disabled = false;
        migrateBtn.textContent = "Migrate to Metres";
      }
    });
    row.appendChild(migrateBtn);
    migrateCard.appendChild(row);
    container.appendChild(migrateCard);
  }

  // ── Radio Audit ─────────────────────────────────────────────────────────
  const auditContainer = el("div",{id:"health-radio-audit"});
  container.appendChild(auditContainer);
  const auditBtn = el("button",{class:"btn",style:"margin-top:8px;width:auto;padding:6px 16px"},"Run Radio Audit");
  auditBtn.addEventListener("click", async () => {
    auditBtn.disabled = true; auditBtn.textContent = "Auditing\u2026";
    try {
      const res = await ctx.actions.callWS({type:"padspan_ha/radio_audit"});
      _renderRadioAudit(ctx, auditContainer, res);
      auditBtn.textContent = "Run Radio Audit";
      auditBtn.disabled = false;
    } catch(e) {
      auditContainer.innerHTML = "";
      auditContainer.appendChild(el("div",{class:"card",style:"color:#fca5a5"},`Audit failed: ${e.message||e}`));
      auditBtn.textContent = "Run Radio Audit"; auditBtn.disabled = false;
    }
  });
  container.appendChild(auditBtn);

  // ── Refresh button ─────────────────────────────────────────────────────
  const btn = el("button",{class:"btn",style:"margin-top:8px;margin-left:8px;width:auto;padding:6px 16px"},"Refresh Fabric");
  btn.addEventListener("click", () => { _fabricCache = null; _fabricFetchTs = 0; _fetchAndRenderFabric(ctx, container); });
  container.appendChild(btn);
}


// ── Radio Audit render ───────────────────────────────────────────────────

function _renderRadioAudit(ctx, container, data) {
  const { el } = ctx.helpers;
  container.innerHTML = "";
  const { total_radios, total_mismatches, radios } = data;

  // Summary
  const color = total_mismatches === 0 ? "#52b788" : "#f87171";
  const card = el("div",{class:"card",style:`margin-top:12px;border:1px solid ${color}33;padding:12px`});
  card.appendChild(el("div",{style:`display:flex;align-items:center;gap:8px;margin-bottom:8px`},[
    el("div",{style:`font-weight:800;font-size:14px;color:${color}`},"Radio Audit"),
    el("div",{class:"pill",style:`background:${color}22;color:${color};font-size:10px;padding:2px 8px`},
      total_mismatches === 0 ? `${total_radios} RADIOS OK` : `${total_mismatches} MISMATCH${total_mismatches!==1?"ES":""}`),
  ]));

  // Per-radio detail
  for (const r of radios) {
    const rCard = el("div",{style:`padding:10px;margin-bottom:6px;border-radius:6px;border:1px solid ${r.ok?"#33415533":"#f8717133"};background:${r.ok?"transparent":"rgba(248,113,113,.04)"}`});

    // Header: source + status
    const hdr = el("div",{style:"display:flex;align-items:center;gap:8px;margin-bottom:6px"});
    hdr.appendChild(el("span",{style:"font-size:13px"},r.ok ? "\u2705" : "\u274c"));
    hdr.appendChild(el("span",{style:"font-weight:700;color:#e2e8f0;font-size:12px"},r.source));
    if (r.radio_name && r.radio_name !== r.source) {
      hdr.appendChild(el("span",{style:"color:#64748b;font-size:11px"},r.radio_name));
    }
    const age = r.last_heard_s;
    if (age != null) {
      const ageColor = age < 30 ? "#52b788" : age < 120 ? "#f59e0b" : "#f87171";
      hdr.appendChild(el("span",{style:`color:${ageColor};font-size:10px;margin-left:auto`},`${Math.round(age)}s ago`));
    }
    rCard.appendChild(hdr);

    // Device info
    const d = r.device;
    if (d) {
      const grid = el("div",{style:"display:grid;grid-template-columns:auto 1fr;gap:2px 10px;font-size:10px;margin-bottom:4px"});
      const _row = (label, val, color) => {
        grid.appendChild(el("div",{style:"color:#64748b;font-weight:600;text-transform:uppercase"},label));
        grid.appendChild(el("div",{style:`color:${color||"#94a3b8"}`},String(val || "\u2014")));
      };
      _row("HA Name", d.name_by_user || d.name);
      _row("Manufacturer", d.manufacturer);
      _row("Model", d.model);
      _row("SW Version", d.sw_version);
      if (d.hw_version) _row("HW Version", d.hw_version);
      _row("ESPHome", d.is_esphome ? `Yes (${(d.esphome_names||[]).join(", ")||"?"})` : "No",
        d.is_esphome ? "#52b788" : "#64748b");
      _row("HA Area", d.ha_area || "(none)", d.ha_area ? "#e2e8f0" : "#f87171");
      _row("HA Floor", d.ha_floor || "(none)", d.ha_floor ? "#e2e8f0" : "#f87171");

      // MACs
      if (d.macs && d.macs.length) {
        for (const m of d.macs) {
          _row(`MAC (${m.type})`, m.address, "#5eead4");
        }
      }

      // Identifiers
      if (d.identifiers && d.identifiers.length) {
        for (const i of d.identifiers) {
          _row(`ID (${i.domain})`, i.id, "#94a3b8");
        }
      }
      rCard.appendChild(grid);
    } else {
      rCard.appendChild(el("div",{style:"font-size:10px;color:#f87171;margin-bottom:4px"},
        "No matching HA device found for this radio source"));
    }

    // Fabric info
    const f = r.fabric;
    if (f) {
      rCard.appendChild(el("div",{style:"font-size:10px;color:#64748b;margin-top:2px"},
        `Fabric: ${f.room} (${f.floor_id}) [${f.source_type}]`));
    }

    // Position
    const p = r.position_m;
    if (p) {
      rCard.appendChild(el("div",{style:"font-size:10px;color:#64748b"},
        `Position: (${p.x_m?.toFixed(1)}, ${p.y_m?.toFixed(1)}, z=${p.z_m?.toFixed(1)}) [${p.floor_id}]`));
    }

    // Mismatches
    if (r.mismatches && r.mismatches.length) {
      for (const m of r.mismatches) {
        rCard.appendChild(el("div",{style:"font-size:10px;color:#fca5a5;font-weight:600;margin-top:2px"},
          `\u26a0 ${m}`));
      }
    }

    card.appendChild(rCard);
  }

  container.appendChild(card);
}


// ── Critics fetch & render ────────────────────────────────────────────────

async function _fetchAndRenderCritics(ctx, container) {
  const { el } = ctx.helpers;
  const now = Date.now();

  // Use cache if fresh enough
  if (_criticsCache && (now - _criticsFetchTs) < _CRITICS_TTL_MS) {
    _renderCritics(ctx, container, _criticsCache);
    return;
  }

  // Loading state
  container.innerHTML = "";
  container.appendChild(el("div",{class:"card",style:"text-align:center;color:#94a3b8;padding:20px"},
    "Loading system diagnostics\u2026"
  ));

  try {
    const res = await ctx.actions.callWS({ type: "padspan_ha/system_critics" });
    _criticsCache = res;
    _criticsFetchTs = Date.now();
    _renderCritics(ctx, container, res);
  } catch (err) {
    container.innerHTML = "";
    container.appendChild(el("div",{class:"card",style:"color:#fca5a5"},
      `Failed to load system critics: ${err.message || err}`
    ));
  }
}

function _renderCritics(ctx, container, data) {
  const { el } = ctx.helpers;
  container.innerHTML = "";

  const { summary, critics, confusion_matrix, per_map_quality } = data;

  // ── Summary Banner ──────────────────────────────────────────────────────
  const bannerColor = summary.healthy ? "#52b788" :
    summary.critical > 0 ? "#f87171" :
    summary.warning > 0 ? "#f59e0b" : "#52b788";
  const bannerBg = summary.healthy ? "rgba(82,183,136,.08)" :
    summary.critical > 0 ? "rgba(248,113,113,.08)" :
    summary.warning > 0 ? "rgba(245,158,11,.08)" : "rgba(82,183,136,.08)";
  const bannerText = summary.healthy
    ? "All systems healthy \u2014 no issues detected."
    : `${summary.total} issue${summary.total !== 1 ? "s" : ""} found: ` +
      [
        summary.critical > 0 ? `${summary.critical} critical` : "",
        summary.warning > 0 ? `${summary.warning} warning` : "",
        summary.info > 0 ? `${summary.info} info` : "",
      ].filter(Boolean).join(", ");

  container.appendChild(el("div",{
    class:"card",
    style:`border:1px solid ${bannerColor}33;background:${bannerBg};margin-bottom:12px`
  },[
    el("div",{style:`display:flex;align-items:center;gap:8px`},[
      el("div",{style:`font-weight:800;font-size:15px;color:${bannerColor}`},"System Critics"),
      el("div",{class:"pill",style:`background:${bannerColor}22;color:${bannerColor};font-size:10px;padding:2px 8px`},
        summary.healthy ? "HEALTHY" : `${summary.total} ISSUE${summary.total !== 1 ? "S" : ""}`
      ),
    ]),
    el("div",{style:`font-size:12px;color:${bannerColor};margin-top:4px`}, bannerText),
  ]));

  // ── Critic Cards ────────────────────────────────────────────────────────
  if (critics.length) {
    const sevColors = {
      critical: { bg: "rgba(248,113,113,.06)", border: "#f8717133", text: "#fca5a5", icon: "\u26d4" },
      warning:  { bg: "rgba(245,158,11,.06)",  border: "#f59e0b33", text: "#fbbf24", icon: "\u26a0" },
      info:     { bg: "rgba(148,163,184,.06)", border: "#94a3b833", text: "#94a3b8", icon: "\u2139" },
    };

    for (const critic of critics) {
      const sev = sevColors[critic.severity] || sevColors.info;
      const card = el("div",{
        class:"card",
        style:`border:1px solid ${sev.border};background:${sev.bg};margin-bottom:8px;padding:12px`
      });
      card.innerHTML = `
        <div style="display:flex;align-items:flex-start;gap:8px">
          <span style="font-size:14px;line-height:1">${sev.icon}</span>
          <div style="flex:1;min-width:0">
            <div style="font-weight:700;font-size:12px;color:${sev.text};text-transform:uppercase;letter-spacing:.5px;margin-bottom:2px">
              ${_escHtml(critic.category.replace(/_/g, " "))} \u2022 ${_escHtml(critic.severity)}
            </div>
            <div style="font-weight:600;font-size:13px;color:#e2e8f0;margin-bottom:4px">${_escHtml(critic.title)}</div>
            <div style="font-size:11px;color:#94a3b8;line-height:1.5">${_escHtml(critic.message)}</div>
            <div style="font-size:11px;color:#5eead4;margin-top:6px;line-height:1.4"><b>Action:</b> ${_escHtml(critic.action)}</div>
          </div>
        </div>
      `;
      container.appendChild(card);
    }
  }

  // ── Room Confusion Matrix ───────────────────────────────────────────────
  if (confusion_matrix && confusion_matrix.length) {
    const cmCard = el("div",{class:"card",style:"margin-top:12px"});
    cmCard.appendChild(el("div",{style:"font-weight:700;margin-bottom:8px"},"Room Confusion Matrix"));
    cmCard.appendChild(el("div",{class:"muted",style:"font-size:11px;margin-bottom:8px"},
      "Bidirectional transitions between room pairs. High counts suggest the system oscillates between these rooms."
    ));

    const tbl = el("div",{style:"display:grid;grid-template-columns:1fr 1fr auto auto;gap:4px 10px;font-size:11px;align-items:center"});
    // Header
    for (const h of ["Room A","Room B","Transitions","Rate"]) {
      tbl.appendChild(el("div",{style:"font-weight:600;color:#94a3b8;font-size:10px;text-transform:uppercase"},h));
    }
    // Find max count for heat coloring
    const maxCount = confusion_matrix.length ? confusion_matrix[0].count : 1;
    for (const entry of confusion_matrix.slice(0, 15)) {
      const heat = Math.min(1, entry.count / Math.max(maxCount, 1));
      const heatColor = heat > 0.6 ? "#f87171" : heat > 0.3 ? "#f59e0b" : "#52b788";
      tbl.appendChild(el("div",{style:"overflow:hidden;text-overflow:ellipsis;white-space:nowrap"}, entry.room_a));
      tbl.appendChild(el("div",{style:"overflow:hidden;text-overflow:ellipsis;white-space:nowrap"}, entry.room_b));
      tbl.appendChild(el("div",{style:`color:${heatColor};font-weight:600;text-align:right`}, String(entry.count)));
      tbl.appendChild(el("div",{class:"muted",style:"text-align:right"}, `${(entry.rate * 100).toFixed(1)}%`));
    }
    cmCard.appendChild(tbl);
    container.appendChild(cmCard);
  }

  // ── Per-Map Quality ─────────────────────────────────────────────────────
  if (per_map_quality && per_map_quality.length) {
    const mqCard = el("div",{class:"card",style:"margin-top:12px"});
    mqCard.appendChild(el("div",{style:"font-weight:700;margin-bottom:8px"},"Map Calibration Quality"));
    mqCard.appendChild(el("div",{class:"muted",style:"font-size:11px;margin-bottom:8px"},
      "Leave-one-out cross-validation error per map. Lower is better."
    ));

    const tbl = el("div",{style:"display:grid;grid-template-columns:1fr auto auto auto;gap:4px 10px;font-size:11px;align-items:center"});
    for (const h of ["Map","Points","Mean Error","Max Error"]) {
      tbl.appendChild(el("div",{style:"font-weight:600;color:#94a3b8;font-size:10px;text-transform:uppercase"},h));
    }
    for (const m of per_map_quality) {
      const errFrac = m.mean_error_frac;
      const errColor = errFrac == null ? "#94a3b8" :
        errFrac >= 0.15 ? "#f87171" : errFrac >= 0.08 ? "#f59e0b" : "#52b788";
      tbl.appendChild(el("div",{style:"overflow:hidden;text-overflow:ellipsis;white-space:nowrap"}, m.map_name || m.map_id));
      tbl.appendChild(el("div",{style:"text-align:right"}, String(m.point_count)));
      tbl.appendChild(el("div",{style:`color:${errColor};text-align:right`},
        errFrac != null ? `${m.mean_error_m_est}m (${(errFrac * 100).toFixed(1)}%)` : "\u2014"
      ));
      tbl.appendChild(el("div",{class:"muted",style:"text-align:right"},
        m.max_error_frac != null ? `${(m.max_error_frac * 100).toFixed(1)}%` : "\u2014"
      ));
    }
    mqCard.appendChild(tbl);
    container.appendChild(mqCard);
  }

  // ── Refresh button ──────────────────────────────────────────────────────
  const refreshBtn = el("button",{class:"btn",style:"margin-top:12px;width:auto;padding:6px 16px"}, "Refresh Critics");
  refreshBtn.addEventListener("click", () => {
    _criticsCache = null;
    _criticsFetchTs = 0;
    _fetchAndRenderCritics(ctx, container);
  });
  container.appendChild(refreshBtn);
}

function _escHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
