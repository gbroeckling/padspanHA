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

// Basic's focused parts (views/focus.js): a setting a problem points to opens on its own there.
const FOCUS = await import(`./focus.js${new URL(import.meta.url).search}`);
// The panel's words in its language (views/i18n.js; English is the key), and
// System Critics' sentences from the server by their exact English (views/ui_error.js serverText).
const { t, tn } = await import(`./i18n.js${new URL(import.meta.url).search}`);
const { serverText } = await import(`./ui_error.js${new URL(import.meta.url).search}`).catch(() => ({ serverText: (s) => String(s ?? "") }));

// ── "Go there" (2026-11-21) ─────────────────────────────────────────────
// A problem says where it is fixed (ws_diagnostics.py `go`, status_dot.js
// `go`); this opens that screen the ways the panel already opens it: the
// accuracy tips' Measure (the Mapping wizard on that plan), Setup's
// Calibrate (the guided calibration), Mapping → Layout on that floor, the
// Receivers page, Basic's focused card for a setting, Diagnostics. A screen
// this install or mode can't open gets no button.
export const GO_LABELS = {
  get measure() { return t("Measure"); },
  get calibrate() { return t("Calibrate"); },
  get layout() { return t("Open Layout"); },
  get receivers() { return t("Open Receivers"); },
  get adaptive_learning() { return t("Open the setting"); },
  get overview() { return t("Open the Overview"); },
  get diagnostics() { return t("Open Diagnostics"); },
};

/** Whether this panel can open `go` (null: no button). */
export function canGo(ctx, go) {
  if (!go || !GO_LABELS[go.to]) return false;
  const st = ctx.state, can = (id) => !ctx.actions.canOpen || ctx.actions.canOpen(id);
  const maps = (st.maps && st.maps.list) || [];
  if (go.to === "measure") return maps.length > 0 && can("maps");
  if (go.to === "calibrate") return can("calibration");
  // Layout is an expert tab: Basic's Mapping has Library and Upload only.
  if (go.to === "layout") return FOCUS.expertLinks(st) && can("maps");
  if (go.to === "receivers") return !!ctx.actions.openReceivers && can("receivers");
  if (go.to === "adaptive_learning") return can("settings");
  return true;
}

/** Open the screen `go` names. */
export function goThere(ctx, go) {
  const st = ctx.state;
  const maps = (st.maps && st.maps.list) || [];
  const has = (id) => !!id && maps.some(m => m.id === id);
  if (go.to === "measure") {
    const id = has(go.map_id) ? go.map_id : has(st.activeMapId) ? st.activeMapId : ((maps[0] && maps[0].id) || null);
    st._mapsWizard = { step: 2, mapId: id };
    ctx.actions.showView("maps");
  } else if (go.to === "calibrate") {
    if (has(go.map_id)) st.activeMapId = go.map_id;
    st._calibWizard = { step: 1 };
    ctx.actions.showView("calibration");
  } else if (go.to === "layout") {
    const ms = st.maps || (st.maps = {});
    if (go.floor_id && ms._roomsFloorId !== go.floor_id) {
      ms._roomsFloorId = go.floor_id; ms._roomsDraftFloorId = null; ms._roomsCarryNote = null;
    }
    st._mapsWizard = null;
    st.mapsTab = "rooms";
    ctx.actions.showView("maps");
  } else if (go.to === "receivers") {
    st._receivers = Object.assign({ sort: "name", dir: 1 }, st._receivers || {}, { problems: !!go.problems });
    ctx.actions.openReceivers();
  } else if (go.to === "adaptive_learning") {
    // Advanced: the whole Tracking tab, its section open and scrolled to the card (settings.js _settingsPart).
    if (FOCUS.expertLinks(st)) { st._presenceReveal = "positioning"; st._settingsPart = "adaptive_learning"; }
    FOCUS.openFocus(ctx, FOCUS.part("adaptiveLearning"));
  } else {
    ctx.actions.showView(go.to);
  }
}

/** The "Go there" button for a problem, or null. */
function _goButton(ctx, go) {
  if (!canGo(ctx, go)) return null;
  return ctx.helpers.el("button", { class: "btn inline", "data-go": go.to, title: t("Go there"),
    style: "font-size:11px;padding:2px 10px;margin:0;white-space:nowrap", onclick: () => goThere(ctx, go) }, GO_LABELS[go.to]);
}

// What the status dot says (status_dot.js trackIssues), at the top of Health:
// the dot opens Health, and Health said nothing about most of what the dot
// counts (a silent receiver, positioning stopped). Shown only while the dot is.
function _dotNow(ctx) {
  const { el } = ctx.helpers;
  const got = typeof ctx.helpers.statusIssues === "function" ? ctx.helpers.statusIssues() : null;
  const issues = Array.isArray(got) ? got : [];
  if (!issues.length) return null;
  const red = issues.some(i => i.level === "red");
  const card = el("div", { class: "card", "data-health-now": red ? "red" : "amber",
    style: `margin-bottom:12px;border:1px solid ${red ? "#f8717155" : "#f59e0b55"}` });
  card.appendChild(el("div", { style: `font-weight:700;margin-bottom:4px;color:${red ? "#fca5a5" : "#fbbf24"}` },
    red ? t("Something is broken") : t("Something needs attention")));
  for (const is of issues) {
    card.appendChild(el("div", { "data-health-issue": is.id, style: "display:flex;align-items:center;gap:8px;padding:3px 0;font-size:12px" }, [
      el("span", { style: "flex:1;min-width:0;color:#e2e8f0" }, is.text + "."),
      _goButton(ctx, is.go),
    ].filter(Boolean)));
  }
  return card;
}

// Cache for critics data — refreshed when view is active
let _criticsCache = null;
let _criticsFetchTs = 0;
// The data mode the caches below were read in: Sample mode's sample house is never shown as Live's.
let _cacheMode = null;
const _CRITICS_TTL_MS = 30000; // refresh every 30s

export function render(ctx){
  const { el } = ctx.helpers;
  const root = el("section",{id:"health"});
  root.className = ctx.state.view==="health" ? "" : "hidden";

  const snap = ctx.state.live.snapshot;
  const rooms = snap?.rooms?.length ?? Object.keys(ctx.state.roomTagMap||{}).length;
  // Every device heard is in objects.list (what Devices lists; objects.summary
  // .total counts it, and stays whole when the list is the slim one). `tags`
  // is only Home Assistant's own room-tracker entities, none in most houses:
  // reading it alone said 0 beside thousands of devices.
  const tags = snap?.objects?.summary?.total ?? snap?.objects?.list?.length
    ?? snap?.tags?.length ?? Object.values(ctx.state.roomTagMap||{}).reduce((a,b)=>a+(b?.length||0),0);
  // The server copies ble.radios to the top level (snapshot_builder.py); the
  // sample house's snapshot has only ble.radios, so Sample read 0 without this.
  const radios = snap?.radios?.length ?? snap?.ble?.radios?.length ?? 0;
  // Opened directly, this draws before the first refresh has answered: no
  // snapshot and no timing yet. That is "loading", not a count of 0 or a dash.
  const refreshMs = ctx.state.timing.lastRefreshMs ?? null;
  const waiting = !snap && refreshMs === null;
  const count = (n) => waiting ? t("loading…") : n;

  // Header
  root.appendChild(el("div",{class:"row",style:"align-items:center;gap:8px;margin-bottom:14px"},[
    el("h2",{style:"margin:0"},t("Health")),
    ctx.helpers.helpBtn("health"),
  ]));
  const now = _dotNow(ctx);
  if (now) root.appendChild(now);

  root.appendChild(el("div",{class:"grid grid-wide"},[
    el("div",{class:"card"},[
      el("div",{style:"font-weight:700"},t("System")),
      el("div",{class:"mono"}, t("UI v{version} • build {build}", { version: ctx.state.version, build: ctx.state.buildId })),
      el("div",{class:"mono"}, t("Data mode: {mode}", { mode: ctx.state._dataModeKnown ? (ctx.state.dataMode === "live" ? t("Live") : t("Sample")).toUpperCase() : "…" })),
      el("div",{class:"mono"}, refreshMs === null ? t("Refresh: loading…") : t("Refresh: {ms}ms", { ms: refreshMs })),
    ]),
    el("div",{class:"card"},[
      el("div",{style:"font-weight:700"},t("Live Discovery (best-effort)")),
      el("div",{class:"mono"}, t("Rooms: {n}", { n: count(rooms) })),
      el("div",{class:"mono"}, t("Radios: {n}", { n: count(radios) })),
      el("div",{class:"mono"}, t("Tags/Objects: {n}", { n: count(tags) })),
      el("div",{class:"muted", style:"margin-top:8px"},t("To send details to support, open Diagnostics and email its report to hello@traks.ca, or attach it to a GitHub issue (issues are public: remove personal details first).")),
      el("button",{class:"btn inline","data-open-diagnostics":"health",style:"margin-top:6px",onclick:()=>goThere(ctx, { to: "diagnostics" })},t("Open Diagnostics")),
    ]),
  ]));

  // ── A proxy that suddenly hears much less than it usually does ──────────
  // (proxy_health.py). Drawn only while a drop is on; nothing otherwise.
  const deaf = ((snap?.ble?.radios) || []).filter(r => r && r.adv_rate_low === true);
  if (deaf.length) {
    root.appendChild(el("div",{class:"card",style:"margin-top:12px;font-size:11px"},[
      el("div",{style:"font-weight:700;margin-bottom:4px"},t("Hearing less than usual")),
      el("div",{}, deaf.map(r => r.display_name || r.name || r.source).join(", ")),
      el("div",{class:"muted",style:"margin-top:4px"},
        t("For over 10 minutes this scanner has heard far fewer Bluetooth advertisements than it usually does, while the others are normal. Rooms near it can be wrong. Restarting it often helps; on ESPHome, check its version and Wi-Fi.")),
    ]));
  }

  // ── PadSpan Bright → PadSpan HA import ──────────────────────────────────
  // Offered only while a Bright house exists on this HA and has not been
  // imported; a receipt afterwards; nothing at all otherwise.
  const brightContainer = el("div",{id:"health-bright-import"});
  root.appendChild(brightContainer);
  _fetchAndRenderBrightImport(ctx, brightContainer);

  // ── Scanner Health (Phase 3) ────────────────────────────────────────────
  const sh = snap?.scanner_health;
  if (sh && Object.keys(sh).length) {
    const _sid = ctx.helpers.radioShortId;
    const liveRadios = (snap?.ble?.radios) || [];
    const nameMap = {};
    for (const r of liveRadios) { if(r.source && (r.display_name || r.name)) nameMap[r.source] = r.display_name || r.name; }
    const entries = Object.entries(sh).sort((a,b) => a[1].reliability - b[1].reliability);
    const shCard = el("div",{class:"card",style:"margin-top:12px"});
    shCard.appendChild(el("div",{style:"display:flex;align-items:center;gap:8px;margin-bottom:8px"},[
      el("div",{style:"font-weight:700"},t("Scanner Health")),
      ctx.actions.openReceivers && (!ctx.actions.canOpen || ctx.actions.canOpen("receivers")) ? el("button",{class:"btn inline","data-all-receivers":"health",style:"font-size:11px;padding:2px 10px;margin:0",onclick:()=>ctx.actions.openReceivers()},t("All receivers")) : null,
    ].filter(Boolean)));
    const tbl = el("div",{style:"display:grid;grid-template-columns:auto 1fr auto auto auto;gap:4px 10px;font-size:11px;align-items:center"});
    // Header
    for(const h of ["",t("Scanner"),t("Room"),t("Agreement"),t("Reliability")]){
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
    // Flag scanners with low reliability — but only once a scanner has had
    // a fair number of polls to be judged on (>= 12): a scanner that just
    // came online has an unstable, low-sample reliability score that says
    // more about "not enough data yet" than "this scanner disagrees with
    // consensus," and would otherwise show as a false alarm on every fresh
    // install or newly-added scanner.
    const bad = entries.filter(([,d]) => d.reliability < 0.7 && d.polls >= 12);
    if(bad.length){
      const warn = el("div",{style:"margin-top:8px;padding:8px;background:rgba(248,113,113,.08);border:1px solid rgba(248,113,113,.2);border-radius:6px;font-size:11px;color:#fca5a5"});
      warn.innerHTML = `<b>\u26a0 ${_escHtml(tn(bad.length, "1 receiver often points to a different room than the others", "{n} receivers often point to a different room than the others"))}</b><br>` +
        bad.map(([src,d]) => _escHtml(t("{name} ({pct}% agreement)", { name: nameMap[src]||src, pct: d.agree_pct }))).join(", ") +
        `<br><span style="color:#94a3b8;font-size:10px">${_escHtml(t("Check that each is in the right room in Home Assistant and where it is mounted. If it hears devices louder or quieter than it should, change its signal adjustment on the Receivers page. (Each has a reliability below 0.7.)"))}</span>`;
      shCard.appendChild(warn);
    }
    root.appendChild(shCard);
  }

  // ── Fabric Health (Phase 1-3 decoupling) ────────────────────────────────
  root.appendChild(el("div",{style:"display:flex;align-items:center;gap:8px;margin-top:16px"},[
    el("div",{style:"font-weight:700;font-size:14px;color:#52b788"},t("Room and receiver layout")),
  ]));
  const fabricContainer = el("div",{id:"health-fabric",style:"margin-top:8px"});
  root.appendChild(fabricContainer);
  _fetchAndRenderFabric(ctx, fabricContainer);

  // ── Phase 4: System Critics ─────────────────────────────────────────────
  root.appendChild(el("div",{style:"display:flex;align-items:center;gap:8px;margin-top:16px"},[
    el("div",{style:"font-weight:700;font-size:14px;color:#52b788"},t("Problems found")),
    ctx.helpers.helpBtn("health_critics"),
  ]));
  const criticsContainer = el("div",{id:"health-critics",style:"margin-top:8px"});
  root.appendChild(criticsContainer);

  // Fetch critics data (async, updates the container when ready)
  _fetchAndRenderCritics(ctx, criticsContainer);

  return root;
}


// ── PadSpan Bright import ─────────────────────────────────────────────────
// The rules are the backend's (bright_import.py): back up first, refuse a
// non-empty house, never merge, reload after. This card only says what the
// backend will do and shows what it said.

// A floor as people know it: Home Assistant's name, not the id behind it.
function _floorLabel(ctx, fid) {
  if (fid === "__outside__") return t("Outside");
  const f = (ctx.state.model?.floors || []).find(x => String(x.id) === String(fid));
  return f ? (f.name || f.id) : fid;
}

async function _fetchAndRenderBrightImport(ctx, container) {
  const { el } = ctx.helpers;
  let st;
  try { st = await ctx.actions.callWS({ type: "padspan_ha/bright_import_status" }); }
  catch (e) { return; }                       // an old backend: no card
  if (!st || !st.available) return;
  container.innerHTML = "";
  const card = el("div",{class:"card",style:"margin-top:12px;border:1px solid #b8860b"});
  card.appendChild(el("div",{style:"font-weight:700"},t("PadSpan Bright found on this Home Assistant")));
  const srcHas = (st.source && st.source.has) || [];
  card.appendChild(el("div",{class:"muted",style:"margin-top:4px;font-size:12px"},
    srcHas.length
      ? t("Bright holds {what} (stores: {files}).", { what: srcHas.join(", "), files: st.files.join(", ") })
      : t("Bright's stores are here ({files}) but hold no house yet.", { files: st.files.join(", ") })));
  if (st.done_at) {
    card.appendChild(el("div",{style:"margin-top:8px;font-size:12px;color:#52b788"},
      t("Imported into PadSpan HA on {when}. When the house looks right here, remove PadSpan Bright.", { when: new Date(st.done_at).toLocaleString() })));
    container.appendChild(card);
    return;
  }
  const blocked = (st.target_has || []).length ? st.target_has : null;
  card.appendChild(el("div",{class:"muted",style:"margin-top:8px;font-size:12px"},
    t("Import copies Bright's floors, rooms, walls, placed lights, maps and settings into PadSpan HA. A backup of this install's stores is taken first (Backup / Restore). It only runs into an empty house and never merges. PadSpan HA reloads when it is done; Bright's own data is left untouched.")));
  if (blocked) {
    card.appendChild(el("div",{style:"margin-top:8px;font-size:12px;color:#fca5a5"},
      t("Not offered: this install already holds {what}. Import only runs into an empty house.", { what: blocked.join(", ") })));
    container.appendChild(card);
    return;
  }
  const status = el("div",{style:"margin-top:8px;font-size:12px;color:#94a3b8"},"");
  const btn = el("button",{class:"btn inline primary",style:"margin-top:8px",onclick: async () => {
    btn.disabled = true; status.textContent = t("Backing up, importing…");
    try {
      const r = await ctx.actions.callWS({ type: "padspan_ha/bright_import" });
      status.style.color = "#52b788";
      status.textContent = (r.images
        ? t("Imported {what} and {n} map image(s) — backup {id}. PadSpan HA is reloading; refresh in a moment.", { what: r.imported.join(", "), n: r.images, id: r.backup_id })
        : t("Imported {what} — backup {id}. PadSpan HA is reloading; refresh in a moment.", { what: r.imported.join(", "), id: r.backup_id }));
    } catch (e) {
      btn.disabled = false; status.style.color = "#fca5a5";
      status.textContent = t("Import did not run: {why}", { why: ctx.helpers.errorText(e) });
    }
  }}, t("Import from PadSpan Bright"));
  card.appendChild(btn);
  card.appendChild(status);
  container.appendChild(card);
}


// ── Fabric Health fetch & render ──────────────────────────────────────────

let _fabricCache = null;
let _fabricFetchTs = 0;
const _FABRIC_TTL_MS = 15000;

async function _fetchAndRenderFabric(ctx, container) {
  const { el } = ctx.helpers;
  const now = Date.now();
  if (_cacheMode !== ctx.state.dataMode) { _cacheMode = ctx.state.dataMode; _fabricCache = null; _criticsCache = null; }
  if (_fabricCache && (now - _fabricFetchTs) < _FABRIC_TTL_MS) {
    _renderFabric(ctx, container, _fabricCache);
    return;
  }
  container.innerHTML = "";
  container.appendChild(el("div",{class:"card",style:"text-align:center;color:#94a3b8;padding:16px"},t("Loading layout checks…")));
  try {
    const res = await ctx.actions.callWS({ type: "padspan_ha/fabric_health" });
    _fabricCache = res;
    _fabricFetchTs = Date.now();
    _renderFabric(ctx, container, res);
  } catch (err) {
    container.innerHTML = "";
    container.appendChild(el("div",{class:"card",style:"color:#fca5a5"},t("Failed: {why}", { why: ctx.helpers.errorText(err) })));
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
      el("span",{style:"font-size:12px;color:#52b788;font-weight:600"},t("Layout active")),
      el("span",{style:"font-size:11px;color:#94a3b8"},
        tn(scanner_positions_m?.length || 0, "{n} scanner", "{n} scanners") + " · " + tn(room_geometry_m?.length || 0, "{n} room", "{n} rooms")),
    ]));
  }

  // ── Per-floor room fabric: committed state + coherence ─────────────────
  const _fabricFloors = data.fabric_floors || {};
  if (Object.keys(_fabricFloors).length) {
    const _ffCard = el("div",{class:"card",style:"margin-bottom:8px;padding:12px"});
    _ffCard.appendChild(el("div",{style:"font-weight:700;font-size:12px;color:#94a3b8;text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px"},
      t("Room layout by floor")));
    const _ffTbl = el("div",{style:"display:grid;grid-template-columns:1fr auto auto auto auto;gap:3px 10px;font-size:10px;align-items:center"});
    for (const h of [t("Floor"),t("Rooms"),t("Footprint"),t("Clusters"),t("Status")]) {
      _ffTbl.appendChild(el("div",{style:"font-weight:600;color:#64748b;text-transform:uppercase"},h));
    }
    for (const [fid, f] of Object.entries(_fabricFloors).sort()) {
      const _cl = f.clusters;
      const _clBad = typeof _cl === "number" && _cl > 1;
      _ffTbl.appendChild(el("div",{style:"color:#e2e8f0;font-weight:600"},_floorLabel(ctx, fid)));
      _ffTbl.appendChild(el("div",{class:"mono",style:"text-align:right"},String(f.rooms ?? 0)));
      _ffTbl.appendChild(el("div",{class:"mono",style:"color:#94a3b8"},
        f.bbox_w_m != null ? `${f.bbox_w_m}m × ${f.bbox_h_m}m` : "—"));
      _ffTbl.appendChild(el("div",{class:"mono",style:`color:${_clBad?"#f87171":"#52b788"};font-weight:${_clBad?"700":"400"}`},
        _clBad ? `⚠ ${_cl}` : String(_cl ?? "—")));
      _ffTbl.appendChild(el("div",{style:`color:${f.committed?"#52b788":"#f59e0b"};font-weight:600`},
        f.committed ? "🔒 " + t("committed") : t("not committed")));
    }
    _ffCard.appendChild(_ffTbl);
    container.appendChild(_ffCard);
  }

  // ── Summary banner ─────────────────────────────────────────────────────
  const color = summary.healthy ? "#52b788" : summary.failed > 2 ? "#f87171" : "#f59e0b";
  const bg = summary.healthy ? "rgba(82,183,136,.08)" : "rgba(248,113,113,.08)";
  container.appendChild(el("div",{class:"card",style:`border:1px solid ${color}33;background:${bg};margin-bottom:12px`},[
    el("div",{style:`display:flex;align-items:center;gap:8px`},[
      el("div",{style:`font-weight:800;font-size:14px;color:${color}`},t("Layout status")),
      el("div",{class:"pill",style:`background:${color}22;color:${color};font-size:10px;padding:2px 8px`},
        summary.healthy ? t("ALL PASS") : tn(summary.failed, "{n} ISSUE", "{n} ISSUES")),
    ]),
    el("div",{style:`font-size:11px;color:#94a3b8;margin-top:4px`},
      t("{passed}/{total} checks passed", { passed: summary.passed, total: summary.total })),
  ]));

  // ── Check results by group ─────────────────────────────────────────────
  const groups = [
    { key: "fabric_sync", label: t("Phase 1 — Receiver layout") },
    { key: "spatial", label: t("Phase 2 — Spatial Model (metres)") },
    { key: "calibration", label: t("Phase 3 — Calibration") },
    { key: "identity", label: t("Device Identity Registry") },
    { key: "multifloor", label: t("Multi-Floor Accuracy") },
    { key: "occupancy", label: t("Occupancy Estimator") },
    { key: "recorder", label: t("Phase 4 — HA Recorder Health") },
  ];
  for (const g of groups) {
    const gc = checks.filter(c => c.group === g.key);
    if (!gc.length) continue;
    const card = el("div",{class:"card",style:"margin-bottom:8px;padding:12px"});
    card.appendChild(el("div",{style:"font-weight:700;font-size:12px;color:#94a3b8;text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px"},g.label));
    const tbl = el("div",{class:"health-checks"});
    for (const c of gc) {
      const dot = c.ok ? "\u2705" : "\u274c";
      tbl.appendChild(el("div",{style:"font-size:13px;line-height:1"},dot));
      tbl.appendChild(el("div",{},[
        el("span",{style:"font-weight:600;color:#e2e8f0"},c.name),
        el("span",{style:"color:#64748b;margin-left:6px"},c.detail),
      ]));
      tbl.appendChild(el("div",{class:"mono",style:`color:${c.ok?"#52b788":"#fca5a5"};font-weight:600`},String(c.value)));
    }
    card.appendChild(tbl);
    container.appendChild(card);
  }

  // ── Scanner positions (metres) ─────────────────────────────────────────
  if (scanner_positions_m && scanner_positions_m.length) {
    const card = el("div",{class:"card",style:"margin-bottom:8px;padding:12px"});
    card.appendChild(el("div",{style:"font-weight:700;font-size:12px;color:#94a3b8;text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px"},
      t("Scanner Positions in Metres ({n})", { n: scanner_positions_m.length })));
    const tbl = el("div",{style:"display:grid;grid-template-columns:1fr auto auto auto auto auto;gap:3px 8px;font-size:10px;align-items:center"});
    for (const h of [t("Source"),"X","Y","Z",t("Floor"),t("Origin")]) {
      tbl.appendChild(el("div",{style:"font-weight:600;color:#64748b;text-transform:uppercase"},h));
    }
    for (const p of scanner_positions_m) {
      tbl.appendChild(el("div",{style:"overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#e2e8f0"},p.source));
      tbl.appendChild(el("div",{class:"mono",style:"text-align:right"},p.x_m != null ? p.x_m.toFixed(2) : "\u2014"));
      tbl.appendChild(el("div",{class:"mono",style:"text-align:right"},p.y_m != null ? p.y_m.toFixed(2) : "\u2014"));
      tbl.appendChild(el("div",{class:"mono",style:"text-align:right"},p.z_m != null ? p.z_m.toFixed(1) : "\u2014"));
      tbl.appendChild(el("div",{class:"mono",style:"color:#64748b"},_floorLabel(ctx, p.floor_id)));
      tbl.appendChild(el("div",{style:`color:${p.origin==="manual"?"#f59e0b":"#52b788"}`},p.origin));
    }
    card.appendChild(tbl);
    container.appendChild(card);
  }

  // ── Room geometry (metres) ─────────────────────────────────────────────
  if (room_geometry_m && room_geometry_m.length) {
    const card = el("div",{class:"card",style:"margin-bottom:8px;padding:12px"});
    card.appendChild(el("div",{style:"font-weight:700;font-size:12px;color:#94a3b8;text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px"},
      t("Room Geometry in Metres ({n})", { n: room_geometry_m.length })));
    const tbl = el("div",{style:"display:grid;grid-template-columns:1fr auto auto auto auto;gap:3px 8px;font-size:10px;align-items:center"});
    for (const h of [t("Room"),t("Type"),t("Centroid"),t("Floor"),t("Origin")]) {
      tbl.appendChild(el("div",{style:"font-weight:600;color:#64748b;text-transform:uppercase"},h));
    }
    for (const g of room_geometry_m) {
      const cStr = g.centroid_m ? `(${g.centroid_m[0]}, ${g.centroid_m[1]})` : "\u2014";
      tbl.appendChild(el("div",{style:"color:#e2e8f0;font-weight:600"},g.room));
      tbl.appendChild(el("div",{class:"mono"},g.type));
      tbl.appendChild(el("div",{class:"mono",style:"color:#94a3b8"},cStr));
      tbl.appendChild(el("div",{class:"mono",style:"color:#64748b"},_floorLabel(ctx, g.floor_id)));
      tbl.appendChild(el("div",{style:`color:${g.origin==="manual"?"#f59e0b":"#52b788"}`},g.origin));
    }
    card.appendChild(tbl);
    container.appendChild(card);
  }

  // ── Adjacency map ──────────────────────────────────────────────────────
  const adjRooms = adjacency ? Object.keys(adjacency).length : 0;
  if (adjRooms) {
    const card = el("div",{class:"card",style:"margin-bottom:8px;padding:12px"});
    card.appendChild(el("div",{style:"font-weight:700;font-size:12px;color:#94a3b8;text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px"},
      tn(adjRooms, "Room Adjacency ({n} room)", "Room Adjacency ({n} rooms)")));
    const list = el("div",{style:"font-size:11px;line-height:1.8"});
    for (const [room, neighbors] of Object.entries(adjacency).sort()) {
      list.appendChild(el("div",{},[
        el("span",{style:"font-weight:600;color:#e2e8f0"},room),
        el("span",{style:"color:#64748b"}," \u2192 "),
        el("span",{style:"color:#94a3b8"},neighbors.length ? neighbors.join(", ") : t("(none)")),
      ]));
    }
    card.appendChild(list);
    container.appendChild(card);
  }

  // ── Scanner mappings table ─────────────────────────────────────────────
  if (scanners && scanners.length) {
    const card = el("div",{class:"card",style:"margin-bottom:8px;padding:12px"});
    card.appendChild(el("div",{style:"font-weight:700;font-size:12px;color:#94a3b8;text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px"},
      t("Scanner → Room Mappings ({n})", { n: scanners.length })));
    const tbl = el("div",{style:"display:grid;grid-template-columns:1fr 1fr auto auto;gap:3px 8px;font-size:10px;align-items:center"});
    for (const h of [t("Source"),t("Room"),t("Floor"),t("Type")]) {
      tbl.appendChild(el("div",{style:"font-weight:600;color:#64748b;text-transform:uppercase"},h));
    }
    for (const s of scanners) {
      const typeColor = s.source_type === "manual" ? "#f59e0b" : "#52b788";
      tbl.appendChild(el("div",{style:"overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#e2e8f0"},s.source));
      tbl.appendChild(el("div",{style:"color:#94a3b8"},s.room));
      tbl.appendChild(el("div",{class:"mono",style:"color:#64748b"},_floorLabel(ctx, s.floor_id)));
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
        t("Retrain learned model ({state})", { state: rfCheck.value }));
      rfBtn.addEventListener("click", async () => {
        rfBtn.disabled = true; rfBtn.textContent = t("Retraining…");
        try {
          const r = await ctx.actions.callWS({type:"padspan_ha/calibration_retrain_rf"});
          ctx.toast(t("Learned model retrained: {units}, {n} pts", { units: r.use_metres ? t("metres") : t("fractions"), n: r.point_count }));
          _fabricCache = null; _fabricFetchTs = 0; _fetchAndRenderFabric(ctx, container);
        } catch(e) { ctx.toast(t("Failed: {why}", { why: ctx.helpers.errorText(e) })); rfBtn.disabled = false; rfBtn.textContent = t("Retrain learned model"); }
      });
      actCard.appendChild(rfBtn);
    }

    // Resync scanners (fix room/floor assignments)
    const resyncBtn = el("button",{class:"btn",style:"width:auto;padding:4px 14px;font-size:11px"},
      t("Resync Scanners"));
    resyncBtn.addEventListener("click", async () => {
      resyncBtn.disabled = true; resyncBtn.textContent = t("Resyncing…");
      try {
        const r = await ctx.actions.callWS({type:"padspan_ha/fabric_resync"});
        ctx.toast(t("Resync: removed {removed}, added {added}, pruned {pruned} → {n} scanners", { removed: r.removed, added: r.added, pruned: r.pruned, n: r.final_count }));
        _fabricCache = null; _fabricFetchTs = 0; _fetchAndRenderFabric(ctx, container);
      } catch(e) { ctx.toast(t("Failed: {why}", { why: ctx.helpers.errorText(e) })); resyncBtn.disabled = false; resyncBtn.textContent = t("Resync Scanners"); }
    });
    actCard.appendChild(resyncBtn);

    // Reset spatial model (nuclear option)
    const resetBtn = el("button",{class:"btn",style:"width:auto;padding:4px 14px;font-size:11px;border-color:#f8717144;color:#fca5a5"},
      t("Reset Spatial Model"));
    resetBtn.addEventListener("click", async () => {
      if (!confirm(t("Clear every scanner position, beacon position and barrier? A backup is taken first (Manage → Backup & Restore). Room shapes, lights, map placements and calibration points are NOT touched."))) return;
      resetBtn.disabled = true; resetBtn.textContent = t("Resetting…");
      try {
        const r = await ctx.actions.callWS({type:"padspan_ha/fabric_reset_spatial"});
        ctx.toast(r.backup_id
          ? t("Reset: {n} scanner/beacon positions and barriers cleared (backup taken first)", { n: r.removed })
          : t("Nothing to reset: no scanner/beacon positions or barriers"));
        _fabricCache = null; _fabricFetchTs = 0; _fetchAndRenderFabric(ctx, container);
      } catch(e) { ctx.toast(t("Failed: {why}", { why: ctx.helpers.errorText(e) })); resetBtn.disabled = false; resetBtn.textContent = t("Reset Spatial Model"); }
    });
    actCard.appendChild(resetBtn);

    // Migrate Device Identity Registry (if needed)
    const _idCheck = (checks||[]).find(c => c.group === "identity" && c.name === "Identity Migration");
    if (_idCheck && _idCheck.value === "needed") {
      const idBtn = el("button",{class:"btn save-pulse",style:"width:auto;padding:4px 14px;font-size:11px;background:#92400e;border-color:#f59e0b;color:#fbbf24;font-weight:700"},
        "\ud83d\udd11 " + t("Migrate Device Identity"));
      idBtn.addEventListener("click", async () => {
        idBtn.disabled = true; idBtn.textContent = t("Migrating…"); idBtn.classList.remove("save-pulse");
        try {
          const r = await ctx.actions.callWS({type:"padspan_ha/device_registry_migrate"});
          ctx.toast(t("Identity: {migrated} devices migrated, {merged} merged → {total} total", { migrated: r.migrated, merged: r.merged, total: r.total_devices }));
          _fabricCache = null; _fabricFetchTs = 0; _fetchAndRenderFabric(ctx, container);
        } catch(e) { ctx.toast(t("Failed: {why}", { why: ctx.helpers.errorText(e) })); idBtn.disabled=false; idBtn.textContent="\ud83d\udd11 " + t("Migrate Device Identity"); idBtn.classList.add("save-pulse"); }
      });
      actCard.appendChild(idBtn);
    }

    container.appendChild(actCard);
  }

  // ── RSSI vector capture ─────────────────────────────────────────────────
  // Opt-in, so it only exists on the page once the feature is switched on.
  if (ctx.state.settings?.rssi_capture_enabled === true) {
    _renderCapture(ctx, container);
  }

  // ── Maps diagnostic table ───────────────────────────────────────────────
  const maps = data.maps || [];
  if (maps.length) {
    const card = el("div",{class:"card",style:"margin-bottom:8px;padding:12px"});
    card.appendChild(el("div",{style:"font-weight:700;font-size:12px;color:#94a3b8;text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px"},
      t("Maps ({n})", { n: maps.length })));
    const tbl = el("div",{style:"display:grid;grid-template-columns:1fr auto auto auto auto auto auto;gap:3px 8px;font-size:10px;align-items:center"});
    for (const h of [t("Name"),t("Size"),"px/m",t("Receivers"),t("Rooms"),t("Barriers"),t("Floor")]) {
      tbl.appendChild(el("div",{style:"font-weight:600;color:#64748b;text-transform:uppercase"},h));
    }
    for (const m of maps) {
      const ppm = m.px_per_meter;
      const ppmColor = ppm ? "#52b788" : "#f87171";
      tbl.appendChild(el("div",{style:"overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#e2e8f0"},m.name));
      tbl.appendChild(el("div",{class:"mono",style:"white-space:nowrap"},`${m.width}\u00d7${m.height}`));
      tbl.appendChild(el("div",{class:"mono",style:`color:${ppmColor}`},ppm ? String(Math.round(ppm)) : t("none")));
      tbl.appendChild(el("div",{class:"mono",style:"text-align:center"},String(m.has_receivers)));
      tbl.appendChild(el("div",{class:"mono",style:"text-align:center"},String(m.has_room_bounds)));
      tbl.appendChild(el("div",{class:"mono",style:"text-align:center"},String(m.has_rf_barriers)));
      tbl.appendChild(el("div",{class:"mono",style:"color:#64748b"},_floorLabel(ctx, m.floor_id)));
    }
    card.appendChild(tbl);
    container.appendChild(card);
  }

  // ── Radio Audit ─────────────────────────────────────────────────────────
  const auditContainer = el("div",{id:"health-radio-audit"});
  container.appendChild(auditContainer);
  const auditBtn = el("button",{class:"btn",style:"margin-top:8px;width:auto;padding:6px 16px"},t("Run Radio Audit"));
  auditBtn.addEventListener("click", async () => {
    auditBtn.disabled = true; auditBtn.textContent = t("Auditing…");
    try {
      const res = await ctx.actions.callWS({type:"padspan_ha/radio_audit"});
      _renderRadioAudit(ctx, auditContainer, res);
      auditBtn.textContent = t("Run Radio Audit");
      auditBtn.disabled = false;
    } catch(e) {
      auditContainer.innerHTML = "";
      auditContainer.appendChild(el("div",{class:"card",style:"color:#fca5a5"},t("Audit failed: {why}", { why: ctx.helpers.errorText(e) })));
      auditBtn.textContent = t("Run Radio Audit"); auditBtn.disabled = false;
    }
  });
  container.appendChild(auditBtn);

  // ── Refresh button ─────────────────────────────────────────────────────
  const btn = el("button",{class:"btn",style:"margin-top:8px;margin-left:8px;width:auto;padding:6px 16px"},t("Refresh layout"));
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
    el("div",{style:`font-weight:800;font-size:14px;color:${color}`},t("Radio Audit")),
    el("div",{class:"pill",style:`background:${color}22;color:${color};font-size:10px;padding:2px 8px`},
      total_mismatches === 0 ? t("{n} RADIOS OK", { n: total_radios }) : tn(total_mismatches, "{n} MISMATCH", "{n} MISMATCHES")),
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
      hdr.appendChild(el("span",{style:`color:${ageColor};font-size:10px;margin-left:auto`},t("{n}s ago", { n: Math.round(age) })));
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
      _row(t("HA Name"), d.name_by_user || d.name);
      _row(t("Manufacturer"), d.manufacturer);
      _row(t("Model"), d.model);
      _row(t("SW Version"), d.sw_version);
      if (d.hw_version) _row(t("HW Version"), d.hw_version);
      _row("ESPHome", d.is_esphome ? t("Yes ({names})", { names: (d.esphome_names||[]).join(", ")||"?" }) : t("No"),
        d.is_esphome ? "#52b788" : "#64748b");
      _row(t("HA Area"), d.ha_area || t("(none)"), d.ha_area ? "#e2e8f0" : "#f87171");
      _row(t("HA Floor"), d.ha_floor ? _floorLabel(ctx, d.ha_floor) : t("(none)"), d.ha_floor ? "#e2e8f0" : "#f87171");

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
        t("No matching HA device found for this radio source")));
    }

    // Fabric info
    const f = r.fabric;
    if (f) {
      rCard.appendChild(el("div",{style:"font-size:10px;color:#64748b;margin-top:2px"},
        t("Layout: {room} ({floor}) [{type}]", { room: f.room, floor: _floorLabel(ctx, f.floor_id), type: f.source_type })));
    }

    // Position
    const p = r.position_m;
    if (p) {
      rCard.appendChild(el("div",{style:"font-size:10px;color:#64748b"},
        t("Position: ({x}, {y}, z={z}) [{floor}]", { x: p.x_m?.toFixed(1), y: p.y_m?.toFixed(1), z: p.z_m?.toFixed(1), floor: _floorLabel(ctx, p.floor_id) })));
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
  if (_cacheMode !== ctx.state.dataMode) { _cacheMode = ctx.state.dataMode; _fabricCache = null; _criticsCache = null; }
  if (_criticsCache && (now - _criticsFetchTs) < _CRITICS_TTL_MS) {
    _renderCritics(ctx, container, _criticsCache);
    return;
  }

  // Loading state
  container.innerHTML = "";
  container.appendChild(el("div",{class:"card",style:"text-align:center;color:#94a3b8;padding:20px"},
    t("Checking for problems…")
  ));

  try {
    const res = await ctx.actions.callWS({ type: "padspan_ha/system_critics" });
    _criticsCache = res;
    _criticsFetchTs = Date.now();
    _renderCritics(ctx, container, res);
  } catch (err) {
    container.innerHTML = "";
    container.appendChild(el("div",{class:"card",style:"color:#fca5a5"},
      t("Could not check for problems: {why}", { why: ctx.helpers.errorText(err) })
    ));
  }
}

// Each kind of check and how serious it is, in a house owner's words; the
// ids (ws_diagnostics.py) stay what other code reads.
export const CATEGORY_LABELS = {
  get room_confusion() { return t("Rooms mixed up"); },
  get map_quality() { return t("Calibration accuracy"); },
  get map_geometry() { return t("Floor plan"); },
  get room_footprint() { return t("Room sizes"); },
  get room_divergence() { return t("Saved rooms"); },
  get scanner() { return t("Receiver"); },
  get calibration() { return t("Calibration"); },
  get propagation() { return t("Signal and learning"); },
};
export const SEVERITY_LABELS = {
  get critical() { return t("Fix this"); }, get warning() { return t("Worth fixing"); }, get info() { return t("Good to know"); },
};

function _renderCritics(ctx, container, data) {
  const { el } = ctx.helpers;
  container.innerHTML = "";

  const { summary, critics, confusion_matrix, per_map_quality } = data;

  // ── Summary Banner ──────────────────────────────────────────────────────
  // Notes alone (a new house's next steps) are not issues: green, and said so.
  const issues = (summary.critical || 0) + (summary.warning || 0);
  const bannerColor = summary.critical > 0 ? "#f87171" : summary.warning > 0 ? "#f59e0b" : "#52b788";
  const bannerBg = summary.critical > 0 ? "rgba(248,113,113,.08)" :
    summary.warning > 0 ? "rgba(245,158,11,.08)" : "rgba(82,183,136,.08)";
  const counts = [
    summary.critical > 0 ? t("{n} to fix", { n: summary.critical }) : "",
    summary.warning > 0 ? t("{n} worth fixing", { n: summary.warning }) : "",
    summary.info > 0 ? t("{n} good to know", { n: summary.info }) : "",
  ].filter(Boolean).join(" \u00b7 ");
  const bannerText = summary.healthy ? t("Nothing wrong found.")
    : issues ? counts : t("Nothing to fix. {counts}.", { counts });

  container.appendChild(el("div",{
    class:"card",
    style:`border:1px solid ${bannerColor}33;background:${bannerBg};margin-bottom:12px`
  },[
    el("div",{style:`display:flex;align-items:center;gap:8px`},[
      el("div",{class:"pill",style:`background:${bannerColor}22;color:${bannerColor};font-size:10px;padding:2px 8px`},
        summary.healthy ? t("HEALTHY") : issues ? tn(issues, "{n} ISSUE", "{n} ISSUES") : t("NOTHING TO FIX")
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
        "data-critic": critic.category,
        style:`border:1px solid ${sev.border};background:${sev.bg};margin-bottom:8px;padding:12px`
      });
      const kind = CATEGORY_LABELS[critic.category] || String(critic.category || "").replace(/_/g, " ");
      card.innerHTML = `
        <div style="display:flex;align-items:flex-start;gap:8px">
          <span style="font-size:14px;line-height:1">${sev.icon}</span>
          <div style="flex:1;min-width:0">
            <div style="font-weight:700;font-size:12px;color:${sev.text};text-transform:uppercase;letter-spacing:.5px;margin-bottom:2px">
              ${_escHtml(kind)} \u2022 ${_escHtml(SEVERITY_LABELS[critic.severity] || critic.severity)}
            </div>
            <div style="font-weight:600;font-size:13px;color:#e2e8f0;margin-bottom:4px">${_escHtml(serverText(critic.title))}</div>
            <div style="font-size:11px;color:#94a3b8;line-height:1.5">${_escHtml(serverText(critic.message))}</div>
            <div data-critic-action style="font-size:11px;color:#5eead4;margin-top:6px;line-height:1.4;display:flex;align-items:center;gap:8px;flex-wrap:wrap"><span><b>${_escHtml(t("Action:"))}</b> ${_escHtml(serverText(critic.action))}</span></div>
            ${critic.detail ? `<div data-critic-detail style="font-size:10px;color:#64748b;margin-top:4px;line-height:1.4">${_escHtml(t("Details:"))} ${_escHtml(critic.detail)}</div>` : ""}
          </div>
        </div>
      `;
      const go = _goButton(ctx, critic.go);
      if (go) ((card.querySelector && card.querySelector("[data-critic-action]")) || card).appendChild(go);
      container.appendChild(card);
    }
  }

  // ── Room Confusion Matrix ───────────────────────────────────────────────
  if (confusion_matrix && confusion_matrix.length) {
    const cmCard = el("div",{class:"card",style:"margin-top:12px"});
    cmCard.appendChild(el("div",{style:"font-weight:700;margin-bottom:8px"},t("Room mix-ups")));
    cmCard.appendChild(el("div",{class:"muted",style:"font-size:11px;margin-bottom:8px"},
      t("Rooms PadSpan keeps moving devices back and forth between. The more moves, the more often one of the two is wrong.")
    ));

    const tbl = el("div",{style:"display:grid;grid-template-columns:1fr 1fr auto auto;gap:4px 10px;font-size:11px;align-items:center"});
    // Header
    for (const h of [t("Room A"),t("Room B"),t("Moves"),t("Share")]) {
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
    mqCard.appendChild(el("div",{style:"font-weight:700;margin-bottom:8px"},t("Map Calibration Quality")));
    mqCard.appendChild(el("div",{class:"muted",style:"font-size:11px;margin-bottom:8px"},
      t("How far off PadSpan is when it checks each plan's calibration points against each other, on average and at worst. Lower is better.")
    ));

    const tbl = el("div",{style:"display:grid;grid-template-columns:1fr auto auto auto;gap:4px 10px;font-size:11px;align-items:center"});
    for (const h of [t("Map"),t("Points"),t("Average"),t("Worst")]) {
      tbl.appendChild(el("div",{style:"font-weight:600;color:#94a3b8;font-size:10px;text-transform:uppercase"},h));
    }
    for (const m of per_map_quality) {
      // Thresholds in metres, matching CRITIC_*_ERROR_M in const.py.
      const errM = m.mean_error_m;
      const errColor = errM == null ? "#94a3b8" :
        errM >= 2.25 ? "#f87171" : errM >= 1.2 ? "#f59e0b" : "#52b788";
      tbl.appendChild(el("div",{style:"overflow:hidden;text-overflow:ellipsis;white-space:nowrap"}, m.map_name || m.map_id));
      tbl.appendChild(el("div",{style:"text-align:right"}, String(m.point_count)));
      tbl.appendChild(el("div",{style:`color:${errColor};text-align:right`},
        errM != null ? `${errM.toFixed(2)}m` : "\u2014"
      ));
      tbl.appendChild(el("div",{class:"muted",style:"text-align:right"},
        m.max_error_m != null ? `${m.max_error_m.toFixed(2)}m` : "\u2014"
      ));
    }
    mqCard.appendChild(tbl);
    container.appendChild(mqCard);
  }

  // ── Refresh button ──────────────────────────────────────────────────────
  const refreshBtn = el("button",{class:"btn",style:"margin-top:12px;width:auto;padding:6px 16px"}, t("Check again"));
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

// ── RSSI vector capture ───────────────────────────────────────────────────
// Record a session, mark where the device really is, export the trace —
// and now (gap #13, best-in-class roadmap) replay a finished session and
// score it, and A/B a settings change against the SAME recorded walk.
// Replay runs against an ISOLATED coordinator built fresh from the
// capture's own header (capture_replay.py) — it never touches the live
// coordinator's own filter/vote state.

let _capTimer = null;

function _capFmt(bytes) {
  return bytes > 1048576 ? `${(bytes / 1048576).toFixed(1)} MB`
       : bytes > 1024    ? `${Math.round(bytes / 1024)} KB`
       : `${bytes} B`;
}

function _capClock(secs) {
  const s = Math.max(0, Math.round(secs));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function _renderCapture(ctx, container) {
  const { el } = ctx.helpers;
  const card = el("div", {class:"card", style:"margin-bottom:8px;padding:12px"});
  card.appendChild(el("div", {style:"font-weight:700;font-size:12px;color:#94a3b8;text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px"},
    t("RSSI Vector Capture")));
  card.appendChild(el("div", {style:"font-size:11px;color:#64748b;margin-bottom:10px"},
    t("Record what every scanner heard, walk the house marking the room you are actually in, then export the trace. Nothing is recorded until you press Record.")));

  const status = el("div", {style:"font-size:11px;color:#94a3b8;margin-bottom:8px"}, "…");
  const row = el("div", {style:"display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:8px"});
  const sessions = el("div", {style:"font-size:11px"});
  card.appendChild(status); card.appendChild(row); card.appendChild(sessions);
  container.appendChild(card);

  const recBtn = el("button", {class:"btn", style:"width:auto;padding:4px 14px;font-size:11px"}, "⏺ " + t("Record"));
  const markSel = el("select", {class:"input", style:"width:auto;padding:3px 8px;font-size:11px"});
  const markBtn = el("button", {class:"btn", style:"width:auto;padding:4px 14px;font-size:11px"}, t("Mark room"));
  // Optional precise position alongside the room (gap #13, best-in-class
  // roadmap) — numeric metre entry, not a draggable map pin: it always
  // works regardless of whether a map is anchored to the fabric's world
  // gauge, which a click-on-image picker would depend on. Left blank, the
  // mark behaves exactly as before (room label only).
  const markX = el("input", {class:"input", type:"number", step:"0.1", placeholder:"x (m)",
    style:"width:64px;box-sizing:content-box;padding:3px 6px;font-size:11px"});
  const markY = el("input", {class:"input", type:"number", step:"0.1", placeholder:"y (m)",
    style:"width:64px;box-sizing:content-box;padding:3px 6px;font-size:11px"});
  row.appendChild(recBtn); row.appendChild(markSel); row.appendChild(markX); row.appendChild(markY);
  row.appendChild(markBtn);

  const roomNames = (ctx.state.live.snapshot?.rooms || []).map(r => r.name || r).filter(Boolean);
  for (const r of roomNames) markSel.appendChild(el("option", {value:r}, r));
  markSel.disabled = markBtn.disabled = markX.disabled = markY.disabled = true;

  // One interval, cleared before it is ever replaced. A record button that
  // leaves a 5 s poll behind on every tab change is a leak nobody notices
  // until the panel has been open all day.
  if (_capTimer) { clearInterval(_capTimer); _capTimer = null; }

  const refresh = async () => {
    if (!document.body.contains(card)) { clearInterval(_capTimer); _capTimer = null; return; }
    let st;
    try { st = await ctx.actions.callWS({type:"padspan_ha/capture_status"}); }
    catch { return; }
    if (st.recording) {
      const left = (st.ends_ts || 0) - Date.now() / 1000;
      status.textContent = t("Recording — {time} left · {frames} frames · {objects} objects · {size}", { time: _capClock(left), frames: st.frames, objects: st.objects, size: _capFmt(st.bytes) })
        + (st.gt_room ? " · " + t("marked \"{room}\"", { room: st.gt_room }) : "")
        + (st.truncated ? " · " + t("{n} objects dropped", { n: st.truncated }) : "");
      status.style.color = "#fbbf24";
      recBtn.textContent = "⏹ " + t("Stop");
      markSel.disabled = markBtn.disabled = markX.disabled = markY.disabled = false;
    } else {
      status.textContent = t("Not recording.");
      status.style.color = "#94a3b8";
      recBtn.textContent = "⏺ " + t("Record");
      markSel.disabled = markBtn.disabled = markX.disabled = markY.disabled = true;
    }
    recBtn.disabled = false;
    await _capList(ctx, sessions);
  };

  recBtn.addEventListener("click", async () => {
    recBtn.disabled = true;
    try {
      const st = await ctx.actions.callWS({type:"padspan_ha/capture_status"});
      if (st.recording) {
        const r = await ctx.actions.callWS({type:"padspan_ha/capture_stop"});
        ctx.toast(r.ok ? t("Stopped: {frames} frames, {size}", { frames: r.frames, size: _capFmt(r.bytes) }) : serverText(r.error));
      } else {
        const mins = parseInt(prompt(t("Record for how many minutes? (1–60)"), "5") || "0", 10);
        if (!mins) { recBtn.disabled = false; return; }
        const label = prompt(t("Label for this session (optional)"), "") || "";
        const r = await ctx.actions.callWS({type:"padspan_ha/capture_start", minutes:mins, label});
        ctx.toast(t("Recording {id} — {minutes} min, {n} scanners", { id: r.session_id, minutes: r.minutes, n: r.sources }));
      }
    } catch(e) { ctx.toast(t("Failed: {why}", { why: ctx.helpers.errorText(e) }), true); }
    await refresh();
  });

  markBtn.addEventListener("click", async () => {
    try {
      const msg = {type:"padspan_ha/capture_mark", room:markSel.value};
      const x = parseFloat(markX.value), y = parseFloat(markY.value);
      if (isFinite(x) && isFinite(y)) { msg.x_m = x; msg.y_m = y; }
      const r = await ctx.actions.callWS(msg);
      ctx.toast(r.ok ? t("Marked {room}", { room: r.room }) + (msg.x_m != null ? ` @ (${x}, ${y})` : "") : serverText(r.error));
    } catch(e) { ctx.toast(t("Failed: {why}", { why: ctx.helpers.errorText(e) }), true); }
    await refresh();
  });

  refresh();
  _capTimer = setInterval(refresh, 5000);
}

async function _capList(ctx, host) {
  const { el } = ctx.helpers;
  let list;
  try { list = (await ctx.actions.callWS({type:"padspan_ha/capture_list"})).sessions || []; }
  catch { return; }
  host.replaceChildren();
  if (!list.length) { host.appendChild(el("div",{style:"color:#64748b"},t("No recorded sessions."))); return; }

  for (const s of list) {
    const rowEl = el("div", {style:"display:flex;gap:8px;align-items:center;padding:3px 0;border-top:1px solid #1b3526"});
    const when = new Date((s.t0 || 0) * 1000).toLocaleString();
    rowEl.appendChild(el("div", {style:"flex:1;color:#cbd5e1"},
      `${s.label || s.id} · ${when} · ` + t("{n} frames", { n: s.frames }) + ` · ${_capFmt(s.bytes || 0)}`
      + (s.stop_reason && s.stop_reason !== "manual" ? ` · ${s.stop_reason}` : "")
      // A truncated session sampled its site rather than describing it, and
      // the export gives no hint of that on its own.
      + (s.truncated ? " · ⚠ " + t("{n} objects dropped", { n: s.truncated }) : "")));

    const dl = el("button", {class:"btn", style:"width:auto;padding:2px 10px;font-size:10px"}, t("Export .jsonl"));
    dl.addEventListener("click", async () => {
      dl.disabled = true; dl.textContent = t("Exporting…");
      try {
        // Paged: one response is byte-capped at ~1.5 MB, so a 25 MB session
        // arrives in pieces rather than taking the browser down with it.
        const out = [];
        for (let off = 0; ; ) {
          const p = await ctx.actions.callWS({type:"padspan_ha/capture_get", session_id:s.id, offset:off, limit:2000});
          out.push(...p.lines);
          off += p.lines.length;
          if (p.eof || !p.lines.length) break;
        }
        const url = URL.createObjectURL(new Blob([out.join("\n") + "\n"], {type:"application/x-ndjson"}));
        const a = document.createElement("a");
        a.href = url; a.download = `padspan-capture-${s.id}.jsonl`; a.click();
        URL.revokeObjectURL(url);
        ctx.toast(t("Exported {n} lines.", { n: out.length }));
      } catch(e) { ctx.toast(t("Failed: {why}", { why: ctx.helpers.errorText(e) }), true); }
      dl.disabled = false; dl.textContent = t("Export .jsonl");
    });
    rowEl.appendChild(dl);

    const replayBtn = el("button", {class:"btn", style:"width:auto;padding:2px 10px;font-size:10px"}, t("Replay & Score"));
    const replayPanel = el("div", {style:"display:none;margin:6px 0 4px;padding:8px;background:#0a150e;border:1px solid #1b3526;border-radius:8px;font-size:11px"});
    replayBtn.addEventListener("click", async () => {
      const open = replayPanel.style.display !== "none";
      if (open) { replayPanel.style.display = "none"; return; }
      replayPanel.style.display = "block";
      await _renderReplayPanel(ctx, replayPanel, s.id);
    });
    rowEl.appendChild(replayBtn);

    const del = el("button", {class:"btn", style:"width:auto;padding:2px 10px;font-size:10px;border-color:#f8717144;color:#fca5a5"}, t("Delete"));
    del.addEventListener("click", async () => {
      if (!confirm(t("Delete capture session {id}?", { id: s.id }))) return;
      try {
        await ctx.actions.callWS({type:"padspan_ha/capture_delete", session_id:s.id});
        await _capList(ctx, host);
      } catch(e) { ctx.toast(t("Failed: {why}", { why: ctx.helpers.errorText(e) }), true); }
    });
    rowEl.appendChild(del);

    const wrap = el("div", {style:"display:flex;flex-direction:column;width:100%"});
    wrap.appendChild(rowEl);
    wrap.appendChild(replayPanel);
    host.appendChild(wrap);
  }
}

// Replay & Score panel for one finished session (gap #13, best-in-class
// roadmap). Fetches padspan_ha/capture_replay, shows room accuracy + metre
// error, and offers a small A/B: tweak a couple of the settings the replay
// loop actually reads (kalman_q/r, room_change_delay_s) and re-run against
// the SAME recorded frames. Position accuracy never moves in the variant —
// see capture_replay.py's module docstring for why — so only the room
// accuracy row is shown twice.
async function _renderReplayPanel(ctx, panel, sessionId) {
  const { el } = ctx.helpers;
  panel.replaceChildren(el("div", {style:"color:#78909c"}, t("Replaying…")));

  let res;
  try {
    res = await ctx.actions.callWS({type:"padspan_ha/capture_replay", session_id: sessionId});
  } catch(e) {
    panel.replaceChildren(el("div", {style:"color:#fca5a5"}, t("Replay failed: {why}", { why: ctx.helpers.errorText(e) })));
    return;
  }

  const scoreRow = (label, score) => el("div", {style:"margin-bottom:4px"}, [
    el("span", {style:"color:#94a3b8"}, label + ": "),
    score.room_accuracy != null
      ? el("span", {style:"color:#e0e0e0"},
          t("{pct}% room ({n} labelled)", { pct: Math.round(score.room_accuracy * 100), n: score.room_scored_count }))
      : el("span", {style:"color:#64748b"}, t("no room labels")),
    score.mean_error_m != null
      ? el("span", {style:"color:#e0e0e0"},
          " · " + t("{mean}m mean / {max}m max position error ({n} marked)", { mean: score.mean_error_m, max: score.max_error_m, n: score.position_scored_count }))
      : el("span", {style:"color:#64748b"}, " · " + t("no position marks")),
  ]);

  panel.replaceChildren();
  panel.appendChild(scoreRow(t("Baseline (recorded settings)"), res.baseline));

  const abRow = el("div", {style:"display:flex;gap:6px;align-items:center;margin-top:6px;flex-wrap:wrap"});
  const qIn = el("input", {class:"input", type:"number", step:"0.01", placeholder:"kalman_q",
    style:"width:80px;box-sizing:content-box;padding:2px 6px;font-size:10px"});
  const rIn = el("input", {class:"input", type:"number", step:"0.5", placeholder:"kalman_r",
    style:"width:80px;box-sizing:content-box;padding:2px 6px;font-size:10px"});
  const dIn = el("input", {class:"input", type:"number", step:"1", placeholder:"room_change_delay_s",
    style:"width:120px;box-sizing:content-box;padding:2px 6px;font-size:10px"});
  const abBtn = el("button", {class:"btn", style:"width:auto;padding:2px 10px;font-size:10px"}, t("Run A/B"));
  abRow.appendChild(qIn); abRow.appendChild(rIn); abRow.appendChild(dIn); abRow.appendChild(abBtn);
  panel.appendChild(abRow);

  const abResult = el("div", {style:"margin-top:6px"});
  panel.appendChild(abResult);

  abBtn.addEventListener("click", async () => {
    const settings = {};
    for (const [inp, key] of [[qIn, "kalman_q"], [rIn, "kalman_r"], [dIn, "room_change_delay_s"]]) {
      const v = parseFloat(inp.value);
      if (isFinite(v)) settings[key] = v;
    }
    if (!Object.keys(settings).length) { ctx.toast(t("Enter at least one setting to compare.")); return; }
    abResult.replaceChildren(el("div", {style:"color:#78909c"}, t("Replaying variant…")));
    try {
      const ab = await ctx.actions.callWS({
        type:"padspan_ha/capture_replay", session_id: sessionId, settings});
      abResult.replaceChildren(scoreRow(t("Variant ({settings})", { settings: Object.entries(settings).map(([k,v]) => `${k}=${v}`).join(", ") }), ab.variant));
    } catch(e) {
      abResult.replaceChildren(el("div", {style:"color:#fca5a5"}, t("A/B failed: {why}", { why: ctx.helpers.errorText(e) })));
    }
  });
}
