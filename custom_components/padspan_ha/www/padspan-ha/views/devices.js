// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
// See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
/**
 * Devices view — three sub-tabs:
 *   All      — unified deduped list of HA entity trackers + BLE objects
 *   By Room  — objects grouped by room with rich filtering (was Objects view)
 *   Registry — device identity registry (padspan_id management)
 */

// ── Sub-tab state ────────────────────────────────────────────────────────────
const TABS = [
  { id: "all",      label: "All Devices" },
  { id: "by_room",  label: "By Room" },
  { id: "registry", label: "Registry" },
];

export function render(ctx) {
  const { el } = ctx.helpers;

  if (!ctx.state._devicesTab) ctx.state._devicesTab = "all";

  const root = el("div", {});

  // ── Sub-tab bar ──────────────────────────────────────────────────────────
  const tabBar = el("div", { style: "display:flex;gap:4px;margin-bottom:14px;border-bottom:1px solid #1b3526;padding-bottom:8px" });
  for (const t of TABS) {
    const active = ctx.state._devicesTab === t.id;
    const btn = el("button", {
      class: "btn" + (active ? "" : " inline"),
      style: `font-size:12px;padding:4px 14px;border-radius:8px 8px 0 0;${active ? "border-bottom:2px solid #52b788" : ""}`,
    }, t.label);
    btn.addEventListener("click", () => {
      ctx.state._devicesTab = t.id;
      ctx.actions.renderRooms();
    });
    tabBar.appendChild(btn);
  }
  root.appendChild(tabBar);

  // ── Content ──────────────────────────────────────────────────────────────
  const tab = ctx.state._devicesTab;
  if (tab === "by_room") {
    root.appendChild(_renderByRoom(ctx));
  } else if (tab === "registry") {
    root.appendChild(_renderRegistry(ctx));
  } else {
    root.appendChild(_renderAll(ctx));
  }

  return root;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Tab: All Devices (original Devices view)
// ═══════════════════════════════════════════════════════════════════════════════

function _renderAll(ctx) {
  const { el, esc, radioShortId } = ctx.helpers;
  const _sid = (source) => radioShortId ? radioShortId(source || "") : "";

  const snap = (ctx.state.live && ctx.state.live.snapshot) || null;

  if (!snap) {
    return el("div", { class: "card" }, [
      el("div", { style: "font-weight:700" }, "No snapshot data"),
      el("div", { class: "muted" }, "Switch to Sample or Live mode to see device data."),
    ]);
  }

  // ── Gather all devices from multiple sources ──────────────────────────────

  // 1) Entity-based trackers from snap.tags
  const tagsRaw = (Array.isArray(snap.tags) ? snap.tags : []).map(t => ({
    id: t.entity_id || "",
    type: "entity",
    name: t.name || t.entity_id || "Unknown",
    room: normalizeRoom(t.state),
    stateRaw: t.state || "",
    missing: !!t.missing,
    lastChanged: t.last_changed || t.last_updated || "",
    extra: t,
  }));

  // 2) BLE objects from objects.list (tagged, ibeacon, private_ble)
  const objList = (snap.objects && Array.isArray(snap.objects.list)) ? snap.objects.list : [];
  const bleDevices = objList
    .filter(o => o.kind === "ble" || o.kind === "private_ble" || o.kind === "ibeacon")
    .map(o => {
      // private_ble/ibeacon use their stable canonical_id/key here, not the raw
      // address: those kinds' addresses are BLE resolvable/rotating private
      // addresses that change periodically, so falling back to raw address
      // would break identity continuity across a MAC rotation.
      const stableId = o.kind === "private_ble" ? (o.canonical_id || o.address || "")
                      : o.kind === "ibeacon"     ? (o.key || o.address || "")
                      : (o.address || "");
      return {
        id: stableId,
        padspan_id: o.padspan_id || "",
        type: o.kind,
        name: o.user_label || o.private_ble_name || o.name || o.address || "Unknown",
        room: o.room || "",
        stateRaw: o.room || (o.age_s != null ? `seen ${Math.round(o.age_s)}s ago` : ""),
        missing: false,
        lastChanged: o.last_seen || "",
        tagged: !!(o.user_label || o.identified),
        rssi: o.rssi,
        age_s: o.age_s,
        sources: o.sources,
        obj: o,
      };
    });

  // Quiet mode: hide unidentified/untagged devices
  const _quietMode = !!(ctx.state.settings && ctx.state.settings.quiet_mode);
  const _followedAddrs = ctx.state.followedAddrs || new Set();

  // Merge: entity trackers + BLE objects, dedup by id
  const seen = new Set();
  const allDevices = [];
  for (const t of tagsRaw) {
    if (t.id && !seen.has(t.id)) { seen.add(t.id); allDevices.push(t); }
  }
  for (const b of bleDevices) {
    if (b.id && !seen.has(b.id)) {
      // In quiet mode, skip untagged/unidentified BLE objects (unless followed)
      if (_quietMode && !b.tagged) {
        const fk = String(b.id || "").toUpperCase();
        if (!fk || !_followedAddrs.has(fk)) continue;
      }
      seen.add(b.id); allDevices.push(b);
    }
  }

  // ── View state ────────────────────────────────────────────────────────────
  if (!ctx.state.devSearch) ctx.state.devSearch = "";
  if (!ctx.state.devFilter) ctx.state.devFilter = "all"; // all | tagged | untagged | entity | missing

  const filter = ctx.state.devFilter;

  // Assigned after the rows are built; declared here so the search box's
  // oninput closure can call it without triggering a full re-render.
  let applyDevSearch = () => {};

  // ── Filter (type only — the text search is applied in-place below so the
  //    search box keeps focus; re-rendering on every keystroke recreated the
  //    input and dropped focus/cursor, making it unusable). ─────────────────
  const filtered = allDevices.filter(d => {
    // Type filter
    if (filter === "tagged" && !(d.tagged || d.type === "entity")) return false;
    if (filter === "untagged" && (d.tagged || d.type === "entity")) return false;
    if (filter === "entity" && d.type !== "entity") return false;
    if (filter === "missing" && !d.missing) return false;
    return true;
  });

  // Sort: followed first, then tagged/entities, then by name
  filtered.sort((a, b) => {
    const aFol = _followedAddrs.has(a.address || "") || _followedAddrs.has(a.entity_id || "") || _followedAddrs.has(a.key || "") ? 0 : 1;
    const bFol = _followedAddrs.has(b.address || "") || _followedAddrs.has(b.entity_id || "") || _followedAddrs.has(b.key || "") ? 0 : 1;
    if (aFol !== bFol) return aFol - bFol;
    const aRank = (a.tagged || a.type === "entity") ? 0 : 1;
    const bRank = (b.tagged || b.type === "entity") ? 0 : 1;
    if (aRank !== bRank) return aRank - bRank;
    return (a.name || "").localeCompare(b.name || "");
  });

  // ── Counts ────────────────────────────────────────────────────────────────
  const entityCount = allDevices.filter(d => d.type === "entity").length;
  const taggedCount = allDevices.filter(d => d.tagged && d.type !== "entity").length;
  const untaggedCount = allDevices.filter(d => !d.tagged && d.type !== "entity").length;
  const missingCount = allDevices.filter(d => d.missing).length;

  // Clickable KPI card factory — clicking sets the device filter
  function _mkDevKpi(num, label, filterVal) {
    const isActive = filter === filterVal;
    const kpi = el("div", {
      class: "kpi",
      style: `cursor:pointer;${isActive ? "border:1px solid #52b788;border-radius:8px;background:#0a2a1a" : ""}`,
      title: `Click to filter: ${label}`,
    }, [
      el("div", { class: "kpi-num" }, num),
      el("div", { class: "kpi-lbl" }, label),
    ]);
    kpi.addEventListener("click", () => {
      ctx.state.devFilter = filterVal;
      ctx.actions.renderRooms();
    });
    return kpi;
  }

  // ── Header ────────────────────────────────────────────────────────────────
  const header = el("div", { class: "row", style: "margin-bottom:14px" }, [
    el("div", { class: "grow" }, [
      el("div", { class: "h2" }, "All Devices"),
      el("div", { class: "muted" }, "HA entities + tagged BLE objects, deduped into a single list."),
    ]),
    el("div", { class: "bt-kpis" }, [
      _mkDevKpi(String(allDevices.length), "Total", "all"),
      _mkDevKpi(String(entityCount), "Entities", "entity"),
      _mkDevKpi(String(taggedCount), "Tagged", "tagged"),
      _mkDevKpi(String(untaggedCount), "Untagged", "untagged"),
      missingCount ? _mkDevKpi(String(missingCount), "Missing", "missing") : null,
    ].filter(Boolean)),
  ]);

  // ── Controls ──────────────────────────────────────────────────────────────
  const filterBtn = (value, label, count) => el("button", {
    class: "btn" + (filter === value ? "" : " inline"),
    style: "font-size:11px;padding:3px 10px",
    onclick: () => { ctx.state.devFilter = value; ctx.actions.renderRooms(); },
  }, `${label} (${count})`);

  const controls = el("div", { style: "display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-bottom:12px" }, [
    el("input", {
      class: "input", style: "flex:1;min-width:180px;max-width:300px",
      placeholder: "Search name, address, room\u2026",
      value: ctx.state.devSearch,
      oninput: e => { ctx.state.devSearch = e.target.value; applyDevSearch(); },
    }),
    filterBtn("all", "All", allDevices.length),
    filterBtn("tagged", "Named", entityCount + taggedCount),
    filterBtn("untagged", "Untagged", untaggedCount),
    missingCount > 0 ? filterBtn("missing", "Missing", missingCount) : null,
  ].filter(Boolean));

  // ── Device rows ───────────────────────────────────────────────────────────
  const rows = filtered.slice(0, 300).map(d => {
    const kindBadge = d.type === "entity"      ? el("span", { class: "badge", style: "font-size:9px" }, "Entity")
                    : d.type === "private_ble"  ? el("span", { class: "badge", style: "font-size:9px;background:#1a2a3a;color:#7dd3fc;border-color:#1e4976" }, "Private BLE")
                    : d.type === "ibeacon"      ? el("span", { class: "badge", style: "font-size:9px;background:#2a1a3a;color:#c4b5fd;border-color:#5b21b6" }, "iBeacon")
                    : d.tagged                  ? el("span", { class: "badge", style: "font-size:9px" }, "Tagged")
                    : el("span", { class: "badge warn", style: "font-size:9px" }, "Untagged");

    const statusBadge = d.missing
      ? el("span", { class: "pill bad" }, "MISSING")
      : d.room
        ? el("span", { class: "pill good" }, d.room)
        : el("span", { class: "pill", style: "color:#94a3b8" }, "No room");

    const sub = [d.id];
    if (d.padspan_id) sub.push(d.padspan_id);
    if (d.rssi != null) sub.push(`RSSI ${d.rssi}`);
    if (d.age_s != null) sub.push(`${Math.round(d.age_s)}s ago`);
    if (d.sources && d.sources.length) sub.push(`${d.sources.length} radio${d.sources.length > 1 ? "s" : ""}`);
    if (d.type === "entity" && d.stateRaw) sub.push(`state: ${d.stateRaw}`);

    // Buttons
    const btns = [];

    // Details button
    btns.push(el("button", { class: "btn tiny", style: "font-size:10px;padding:2px 6px", onclick: () => {
      if (d.obj) {
        ctx.actions.showObjectDetail(d.obj);
      } else if (d.extra) {
        ctx.actions.showObjectDetail({
          address: d.id,
          entity_id: d.type === "entity" ? d.id : undefined,
          name: d.name,
          kind: d.type === "entity" ? "entity" : d.type,
          room: d.room,
          ...d.extra,
        });
      }
    }}, "Details"));

    // Tag/Rename button (BLE objects only)
    if (d.type === "ble" || d.type === "private_ble" || d.type === "ibeacon") {
      const label = d.obj?.user_label || "";
      btns.push(el("button", { class: "btn tiny", style: "font-size:10px;padding:2px 6px", onclick: () => {
        ctx.actions.tagObjectPrompt(d.id, label);
      }}, label ? "Rename" : "Tag"));
    }

    // Delete/Untag button
    if (d.tagged && d.type !== "entity") {
      btns.push(el("button", { class: "btn tiny", style: "font-size:10px;padding:2px 6px;color:#f87171;border-color:#7f1d1d", onclick: async () => {
        if (!confirm(`Remove tag "${d.name}" (${d.id})?`)) return;
        try {
          await ctx.actions.objectLabelDelete(d.id);
          ctx.toast("Tag removed.");
          await ctx.actions.refreshSnapshot();
        } catch(e) { ctx.toast("Failed to remove tag.", true); }
      }}, "Untag"));
    }

    const hay = `${d.name} ${d.id} ${d.room} ${d.stateRaw} ${d.type}`.toLowerCase();
    return el("div", { class: "dev-tag", "data-search": hay, style: "cursor:pointer", onclick: (e) => {
      if (e.target.closest("button")) return;
      if (d.obj) ctx.actions.showObjectDetail(d.obj);
    }}, [
      el("div", { class: "dev-tag-main" }, [
        el("div", { class: "dev-tag-name" }, d.name),
        el("div", { class: "dev-tag-sub" }, sub.join(" \u00b7 ")),
      ]),
      el("div", { class: "dev-tag-right", style: "display:flex;align-items:center;gap:6px;flex-wrap:wrap" }, [
        kindBadge,
        statusBadge,
        ...btns,
      ]),
    ]);
  });

  const countEl = el("div", { class: "h2", style: "flex:1" }, "");
  const emptyMsg = el("div", { class: "muted", style: "padding:12px 0" }, "No devices match the current filters.");
  const listEl = el("div", { class: "dev-tag-list list-scroll" }, rows);

  // In-place text search: toggle row visibility against the live search term
  // without rebuilding the DOM, so the search box retains focus while typing.
  applyDevSearch = () => {
    const q = String(ctx.state.devSearch || "").trim().toLowerCase();
    let shown = 0;
    for (const row of rows) {
      const ok = !q || (row.getAttribute("data-search") || "").includes(q);
      row.style.display = ok ? "" : "none";
      if (ok) shown++;
    }
    countEl.textContent = `Showing ${shown} of ${allDevices.length}`;
    emptyMsg.style.display = shown === 0 ? "" : "none";
    listEl.style.display = shown === 0 ? "none" : "";
  };
  applyDevSearch();

  const listCard = el("div", { class: "card" }, [
    el("div", { style: "display:flex;align-items:center;gap:8px;margin-bottom:8px" }, [countEl]),
    emptyMsg,
    listEl,
  ]);

  return el("div", {}, [header, controls, listCard]);
}

// ═══════════════════════════════════════════════════════════════════════════════
// Tab: By Room (delegates to Objects view)
// ═══════════════════════════════════════════════════════════════════════════════

function _renderByRoom(ctx) {
  const { el } = ctx.helpers;

  // Objects view is lazy-loaded — try to use it if available, otherwise load it
  const objView = window.__PADSPAN_VIEWS?.objects;
  if (objView && objView.render) {
    try {
      const section = objView.render(ctx);
      // The objects view wraps in a <section id="objects"> with a possible "hidden" class
      if (section) {
        section.className = "";  // always show
        section.id = "";         // avoid duplicate IDs
        return section;
      }
    } catch (e) {
      console.warn("[Devices] By Room render failed:", e);
    }
  }

  // Not loaded yet — trigger async load and show placeholder
  const buildId = ctx.state.buildId || "";
  import(`./objects.js?b=${buildId}`).then(m => {
    if (!window.__PADSPAN_VIEWS) window.__PADSPAN_VIEWS = {};
    window.__PADSPAN_VIEWS.objects = m;
    ctx.actions.renderRooms(); // re-render once loaded
  }).catch(e => console.warn("[Devices] objects.js load failed:", e));

  return el("div", { class: "card", style: "padding:20px;text-align:center" }, [
    el("div", { class: "muted" }, "Loading objects view\u2026"),
  ]);
}

// ═══════════════════════════════════════════════════════════════════════════════
// Tab: Registry (Device Identity)
// ═══════════════════════════════════════════════════════════════════════════════

function _renderRegistry(ctx) {
  const { el } = ctx.helpers;
  const snap = (ctx.state.live && ctx.state.live.snapshot) || null;

  // Count devices with padspan_id
  const objList = (snap?.objects?.list) || [];
  const _pidCount = objList.filter(o => o.padspan_id).length;

  const regCard = el("div", { class: "card" });
  regCard.appendChild(el("div", { style: "display:flex;align-items:center;gap:8px;margin-bottom:8px" }, [
    el("div", { style: "font-weight:700;font-size:14px;color:#52b788" }, "Device Identity Registry"),
    el("div", { class: "pill", style: "background:#52b78822;color:#52b788;font-size:10px;padding:2px 8px" },
      `${_pidCount} with stable ID`),
  ]));
  regCard.appendChild(el("div", { style: "font-size:11px;color:#94a3b8;margin-bottom:12px" },
    "Each device gets an immutable padspan_id that survives MAC rotation, iBeacon changes, and firmware updates. Use this tab to manage identities, merge duplicates, and add manual identity links."));

  // Auto-load registry on tab open
  const container = el("div", {});
  regCard.appendChild(container);
  _loadRegistryAsync(ctx, el, container);

  return regCard;
}

async function _loadRegistryAsync(ctx, el, container) {
  container.innerHTML = "";
  container.appendChild(el("div", { style: "text-align:center;color:#94a3b8;padding:12px" }, "Loading registry\u2026"));

  const _selected = new Set();

  try {
    const res = await ctx.actions.callWS({ type: "padspan_ha/device_registry_list" });
    const devs = res.devices || {};
    const entries = Object.values(devs).sort((a, b) => {
      if (a.label && !b.label) return -1; if (!a.label && b.label) return 1;
      return (a.label || a.padspan_id || "").localeCompare(b.label || b.padspan_id || "");
    });

    container.innerHTML = "";

    if (!entries.length) {
      container.appendChild(el("div", { style: "font-size:11px;color:#64748b;padding:8px 0" }, "No devices in registry yet."));
      return;
    }

    // Summary
    container.appendChild(el("div", { style: "font-size:12px;color:#94a3b8;margin-bottom:10px" },
      `${entries.length} device${entries.length !== 1 ? "s" : ""} registered \u00b7 ${entries.filter(d => d.label).length} labeled`));

    // Merge bar (hidden until 2 selected)
    const mergeBar = el("div", { style: "display:none;padding:6px 10px;background:#1a2a0a;border:1px solid #52b78844;border-radius:6px;margin-bottom:8px;font-size:11px;color:#a7f3d0" });
    const mergeBtn = el("button", { class: "btn", style: "font-size:11px;padding:2px 10px;margin-left:8px" }, "Merge Selected");
    mergeBar.appendChild(document.createTextNode("Select exactly 2 devices to merge "));
    mergeBar.appendChild(mergeBtn);
    container.appendChild(mergeBar);

    function _updateMergeBar() {
      if (_selected.size === 2) {
        mergeBar.style.display = "flex"; mergeBar.style.alignItems = "center";
        mergeBtn.disabled = false;
      } else {
        mergeBar.style.display = _selected.size > 0 ? "flex" : "none";
        mergeBtn.disabled = true;
      }
    }
    mergeBtn.addEventListener("click", async () => {
      const ids = [..._selected];
      if (ids.length !== 2) return;
      const d0 = devs[ids[0]], d1 = devs[ids[1]];
      const n0 = d0?.label || ids[0], n1 = d1?.label || ids[1];
      if (!confirm(`Merge "${n1}" into "${n0}"?\n\nAll identities from "${n1}" will move to "${n0}". "${n1}" will be deleted.`)) return;
      mergeBtn.disabled = true; mergeBtn.textContent = "Merging\u2026";
      try {
        await ctx.actions.callWS({ type: "padspan_ha/device_registry_merge", keep_id: ids[0], absorb_id: ids[1] });
        ctx.toast(`Merged: ${n1} \u2192 ${n0}`);
        _loadRegistryAsync(ctx, el, container);
      } catch (e) { ctx.toast("Merge failed: " + (e.message || e), true); mergeBtn.disabled = false; mergeBtn.textContent = "Merge Selected"; }
    });

    // Device rows
    for (const d of entries) {
      const pid = d.padspan_id || "?";
      const row = el("div", { style: "border:1px solid #1b3526;border-radius:6px;padding:8px 10px;margin-bottom:4px;background:#0d1f14" });

      // Header: checkbox + id + label + actions
      const hdr = el("div", { style: "display:flex;align-items:center;gap:8px;flex-wrap:wrap" });
      const cb = document.createElement("input"); cb.type = "checkbox"; cb.style.cssText = "accent-color:#52b788";
      cb.addEventListener("change", () => { if (cb.checked) _selected.add(pid); else _selected.delete(pid); _updateMergeBar(); });
      hdr.appendChild(cb);
      hdr.appendChild(el("span", { class: "mono", style: "color:#52b788;font-size:10px;min-width:110px" }, pid));

      // Inline-editable label
      const lblInput = document.createElement("input");
      lblInput.type = "text"; lblInput.value = d.label || "";
      lblInput.placeholder = "unlabeled";
      lblInput.style.cssText = "background:transparent;border:1px solid #334155;border-radius:4px;padding:2px 6px;color:#e2e8f0;font-size:12px;font-weight:600;width:140px";
      lblInput.addEventListener("keydown", async (e) => {
        if (e.key !== "Enter") return;
        const newLabel = lblInput.value.trim();
        if (!newLabel) return;
        try {
          await ctx.actions.callWS({ type: "padspan_ha/device_registry_label_set", padspan_id: pid, label: newLabel });
          ctx.toast(`Label set: ${newLabel}`);
        } catch (err) { ctx.toast("Failed: " + (err.message || err), true); }
      });
      hdr.appendChild(lblInput);
      hdr.appendChild(el("span", { style: "font-size:10px;color:#64748b;margin-left:auto" }, d.created_at ? d.created_at.substring(0, 10) : ""));

      // Delete button
      const delBtn = el("button", { class: "btn tiny", style: "font-size:10px;padding:1px 6px;color:#f87171;border-color:#7f1d1d" }, "\u2716");
      delBtn.title = "Delete device from registry";
      delBtn.addEventListener("click", async () => {
        if (!confirm(`Delete device ${d.label || pid}? This removes it from the identity registry.`)) return;
        try {
          await ctx.actions.callWS({ type: "padspan_ha/device_registry_delete", padspan_id: pid });
          ctx.toast("Deleted " + (d.label || pid));
          _loadRegistryAsync(ctx, el, container);
        } catch (e) { ctx.toast("Delete failed: " + (e.message || e), true); }
      });
      hdr.appendChild(delBtn);
      row.appendChild(hdr);

      // Identity pills
      const idents = d.identities || [];
      if (idents.length) {
        const pillRow = el("div", { style: "display:flex;flex-wrap:wrap;gap:4px;margin-top:4px" });
        for (const id of idents) {
          const kindColor = id.kind === "mac" ? "#60a5fa" : id.kind === "ibeacon" ? "#c4b5fd" : id.kind === "irk" ? "#fbbf24" : "#94a3b8";
          pillRow.appendChild(el("span", { style: `font-size:9px;padding:1px 6px;border-radius:3px;background:${kindColor}22;color:${kindColor};border:1px solid ${kindColor}44` },
            `${id.kind}: ${(id.value || "").substring(0, 25)}`));
        }
        row.appendChild(pillRow);
      }

      // Add Identity inline
      const addRow = el("div", { style: "display:none;margin-top:4px;gap:4px;align-items:center;font-size:10px" });
      const addKind = document.createElement("select");
      addKind.style.cssText = "padding:2px;border:1px solid #334155;border-radius:3px;background:#1e293b;color:#e2e8f0;font-size:10px";
      for (const k of ["mac","ibeacon","irk","entity"]) { const o = document.createElement("option"); o.value = k; o.textContent = k; addKind.appendChild(o); }
      const addVal = document.createElement("input");
      addVal.type = "text"; addVal.placeholder = "address or key";
      addVal.style.cssText = "flex:1;padding:2px 4px;border:1px solid #334155;border-radius:3px;background:#1e293b;color:#e2e8f0;font-size:10px;min-width:120px";
      const addGo = el("button", { class: "btn tiny", style: "font-size:10px;padding:1px 6px" }, "Add");
      addGo.addEventListener("click", async () => {
        const v = addVal.value.trim(); if (!v) return;
        try {
          await ctx.actions.callWS({ type: "padspan_ha/device_registry_add_identity", padspan_id: pid, kind: addKind.value, value: v });
          ctx.toast("Identity added"); addVal.value = ""; _loadRegistryAsync(ctx, el, container);
        } catch (e) { ctx.toast("Failed: " + (e.message || e), true); }
      });
      addRow.appendChild(addKind); addRow.appendChild(addVal); addRow.appendChild(addGo);

      const addLink = el("span", { style: "font-size:10px;color:#52b788;cursor:pointer;margin-top:4px;display:inline-block" }, "+ Add Identity");
      addLink.addEventListener("click", () => { addRow.style.display = addRow.style.display === "none" ? "flex" : "none"; });
      row.appendChild(addLink);
      row.appendChild(addRow);

      // Merged from
      if (d.merged_from && d.merged_from.length) {
        row.appendChild(el("div", { style: "font-size:9px;color:#64748b;margin-top:2px" }, `Merged from: ${d.merged_from.join(", ")}`));
      }

      container.appendChild(row);
    }
  } catch (e) {
    container.innerHTML = "";
    container.appendChild(el("div", { style: "color:#f87171;font-size:11px" }, "Failed: " + (e.message || e)));
  }
}

function normalizeRoom(state) {
  const s = String(state || "").trim();
  if (!s || s === "unknown" || s === "unavailable") return "";
  if (s === "not_home") return "Away";
  if (s === "home") return "Home";
  return s;
}
