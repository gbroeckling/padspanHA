// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
// See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
/**
 * Devices view — four sub-tabs:
 *   All      — unified deduped list of HA entity trackers + BLE objects
 *   By Room  — objects grouped by room with rich filtering (was Objects view)
 *   Registry — device identity registry (padspan_id management)
 *   Openers  — mark a cover/switch/button as a door/window opener (Atlas)
 */

// ── Sub-tab state ────────────────────────────────────────────────────────────
const TABS = [
  { id: "all",      label: "All Devices" },
  { id: "by_room",  label: "By Room" },
  { id: "registry", label: "Registry" },
  { id: "openers",  label: "Door Openers" },
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
  } else if (tab === "openers") {
    root.appendChild(_renderDoorOpeners(ctx));
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

// Entity trackers (tagsRaw above) report a device_tracker STATE, not a room
// name — for a person/device_tracker entity that state is usually the
// generic "home"/"not_home" rather than a room, so those need remapping to
// something a person reads as a location; a zone-tracker's state is already
// a real place name and passes through untouched. unknown/unavailable can't
// be treated as "in some room called Unknown", so they clear to "" instead
// (the row falls into the "No room" pill rather than a fake location).
function normalizeRoom(state) {
  const s = String(state || "").trim();
  if (!s || s === "unknown" || s === "unavailable") return "";
  if (s === "not_home") return "Away";
  if (s === "home") return "Home";
  return s;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Tab: Door Openers
// ═══════════════════════════════════════════════════════════════════════════════
// Garry, 2026-09-22: "Add a section to devices that is for door/windows
// openers." A cover/switch/button entity has no device_class an Atlas
// barrier's other two roles can lean on the way binary_sensor's door/window/
// garage_door/opening classes already do — a raw relay switch gives no
// reliable signal it moves a garage door rather than, say, a pump — so
// membership in this list IS the classification, same shape as
// light_type_overrides' per-entity override elsewhere in Devices, just a
// flat allowlist instead of a class map. Once marked, the entity is offered
// as an "Opener" choice from a linked door/window's own row in Mapping ->
// Atlas (the SAME wall-opening creation tool every other link already uses
// — Garry: "maybe all avenues lead to the same wall section creation
// tool?" — confirmed, no second tool built).
//
// Two REAL candidates on Garry's own house motivated this: switch.
// upper_garage_car_door / switch.upper_garage_truck_door, sitting right
// next to the two garage-door contact sensors already linked on the map,
// with no way before now to tie the relay to that same wall opening.
//
// script. joined the list the same day (Garry: "there is a garage door
// controller in HA, can you find it, there is nothing in the device list")
// — his own script.garage_door_car/script.garage_door_truck, which is
// almost certainly the RIGHT thing to trigger (whatever sequencing or
// safety logic those scripts hold, not just the raw relay underneath
// them) but was invisible here, cover/switch/button being the only three
// domains this ever admitted.
const _OPENER_DOMAINS = ["cover.", "switch.", "button.", "script."];
const _OPENER_NAME_HINT = /\b(door|gate|garage|opener)\b/i;

function _isDoorOpenersPaidTier(ctx) {
  const t = String((ctx.state.settings && ctx.state.settings.tier) || "").toLowerCase();
  return t === "bright" || t === "pro";
}

function _renderDoorOpeners(ctx) {
  const { el } = ctx.helpers;
  const card = el("div", { class: "card" });
  card.appendChild(el("div", { style: "font-weight:700;font-size:14px;color:#52b788;margin-bottom:8px" }, "Door / Window Openers"));
  card.appendChild(el("div", { style: "font-size:11px;color:#94a3b8;margin-bottom:12px" },
    "Mark a cover, switch, button, or script entity as a door/window opener (a garage door, gate, or any other powered opening) so it can be offered and linked from a door/window's own row in Mapping → Atlas, right alongside its sensor and its lock."));

  if (!_isDoorOpenersPaidTier(ctx)) {
    card.appendChild(el("div", { style: "font-size:12px;color:#fbbf24;background:#2a220a;border:1px solid #78350f;border-radius:8px;padding:10px" },
      "Door Openers is a Bright / Pro feature."));
    return card;
  }

  const states = (ctx.hass && ctx.hass.states) || {};
  const marked = new Set((ctx.state.settings && ctx.state.settings.door_opener_ids) || []);

  const candidates = Object.keys(states)
    .filter(eid => _OPENER_DOMAINS.some(d => eid.startsWith(d)))
    .filter(eid => marked.has(eid) || _OPENER_NAME_HINT.test(eid) || _OPENER_NAME_HINT.test((states[eid].attributes || {}).friendly_name || ""))
    .sort((a, b) => {
      // Marked first, then name-matched-but-unmarked, then alphabetical —
      // so a real find (the two garage relays) doesn't get lost in a long
      // "button." dump of unrelated identify/restart buttons that also
      // happen to share a domain prefix.
      const am = marked.has(a) ? 0 : 1, bm = marked.has(b) ? 0 : 1;
      if (am !== bm) return am - bm;
      const an = (states[a].attributes || {}).friendly_name || a;
      const bn = (states[b].attributes || {}).friendly_name || b;
      return an.localeCompare(bn);
    });

  const toggle = async (eid, checked) => {
    const next = new Set(marked);
    if (checked) next.add(eid); else next.delete(eid);
    try {
      await ctx.actions.settingsSet({ door_opener_ids: [...next] });
      ctx.toast(checked ? "Marked as an opener." : "No longer an opener.");
    } catch (e) { ctx.toast("Could not save: " + (e.message || e), true); }
  };

  if (!candidates.length) {
    card.appendChild(el("div", { style: "font-size:12px;color:#64748b;padding:8px 0" },
      "No cover, switch, button, or script entities with “door”, “gate”, “garage”, or “opener” in their name were found. " +
      "Nothing on this install looks like a door/window opener by name — if one exists under a different name, it can still be added from the picker on its wall opening's row in Mapping → Atlas."));
  } else {
    for (const eid of candidates) {
      const st = states[eid];
      const row = el("div", {
        style: "display:flex;align-items:center;gap:10px;border:1px solid #1b3526;border-radius:8px;"
          + "padding:8px 12px;margin-bottom:4px;background:#0d1f14",
      });
      const cb = document.createElement("input");
      cb.type = "checkbox"; cb.checked = marked.has(eid);
      cb.style.cssText = "accent-color:#52b788;width:16px;height:16px";
      cb.addEventListener("change", () => toggle(eid, cb.checked));
      row.appendChild(cb);
      row.appendChild(el("div", { style: "flex:1;min-width:0" }, [
        el("div", { style: "font-weight:600;font-size:13px" }, (st.attributes || {}).friendly_name || eid),
        el("div", { style: "font-size:10px;color:#64748b" }, `${eid} · ${st.state}`),
      ]));
      card.appendChild(row);
    }
  }

  const wrap = el("div", {}, [card, _renderRelayWizard(ctx)]);
  return wrap;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Build an opener or lock from relay(s)
// ═══════════════════════════════════════════════════════════════════════════════
// Garry, 2026-09-22 (verbatim): "a windows opener may need to import a relay
// and set it up with logic to open and close a window. We also have cases
// where we need to import a relay for a door lock, I have one in this house.
// In the filter, and at the bottom of the list we need to have an option to
// create door or windows opener or lock from relay/relays. And from there
// have a card to build a lock/opener from a relay, with accompanying logic
// for that."
//
// The three "kinds" below aren't invented — they're Garry's own three
// relay patterns, already hand-built elsewhere in this house, generalized to
// any relay pair:
//   1. Momentary opener — one relay, pulse-and-release. His own
//      script.garage_door_car / script.garage_door_truck, pulsing
//      switch.prodino1_relay_1/2 for 1s. No separate template entity: the
//      generated script itself IS the opener, exactly like his own two.
//   2. Two-direction motor opener — two relays with a hardware interlock (a
//      "which script is running" mutex, not just a timer), a travel timer,
//      and three boot-safe/failsafe automations. His own "Bedroom1 Window"
//      scripts + automations against light.windowopenerbedroom1_light/
//      _light_2 (a ZHA relay board exposed as two light entities), 180s
//      travel. Wrapped in a Template Cover so it self-reports like a real
//      cover — same shape openBarrierCard already understands.
//   3. Momentary-strike lock — one relay, pulse-and-release like kind 1, but
//      the release is electrical (a spring-loaded strike) rather than
//      mechanical, so lock/unlock STATE needs to be remembered somewhere —
//      there's no position to read back. Researched in Control4: item 607
//      "Front Door" (relaysingle_doorlock_c4, category "locks") on the
//      Utility Room IO Extender is a real momentary door-lock relay in this
//      house, but it was never bridged into HA (no lock.* or switch.*
//      entity exists for it) — this kind exists for whenever a relay like
//      it IS reachable from HA, wired or Zigbee (a z2m relay board, a
//      Shelly, a ProDino spare channel). Garry is separately buying a
//      Kwikset Zigbee lock for the back door — that pairs as a native
//      lock.* entity directly (already handled: lockCandidates below lists
//      every lock.* with no allowlist needed) and doesn't go through this
//      wizard at all; this kind is for a BARE relay with no such lock of
//      its own.
//
// Every generated piece is a REAL HA object — a script and/or automation via
// the REST config API, a Template lock/cover via the same config-entries
// flow HA's own Settings -> Helpers -> Template uses, and (only when no
// sensor is linked to give ground truth) an input_boolean to remember
// open/closed or locked/unlocked across restarts. Nothing here is simulated
// inside PadspanHA. settings.door_composites is the receipt: every id this
// wizard created, so "Remove" can delete every piece and only those pieces —
// never touching anything Garry built by hand.

const _RELAY_DOMAINS = ["switch.", "light."];
const _RELAY_KINDS = [
  { id: "momentary_opener", label: "Momentary opener (garage door, gate)" },
  { id: "two_direction_opener", label: "Two-direction opener (motorized window, blind, awning)" },
  { id: "momentary_lock", label: "Momentary-strike lock (electric door strike)" },
  { id: "relay_light", label: "Plain light (a relay-switched light — e.g. a PoE port, a bare on/off fixture)" },
];
const _COVER_DEVICE_CLASSES = ["window", "door", "garage", "gate", "blind", "shade", "shutter", "awning", "curtain", "damper"];

// A safe, predictable HA object_id from whatever name Garry types — every
// script/automation/helper id this wizard creates shares this one prefixed
// slug so a whole composite is trivially greppable/removable as a set.
export function relaySlug(name) {
  const base = String(name || "").toLowerCase().trim().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  return "padspanha_" + (base || "relay");
}

function _relayDomain(eid) { return String(eid).split(".")[0]; }

// Kind 1 — mirrors script.garage_door_car/_truck exactly: turn on, delay,
// turn off. The script IS the opener; no template entity, no helper.
export function buildMomentaryOpener({ slug, name, relayEid, pulseSeconds }) {
  const dom = _relayDomain(relayEid);
  const scriptId = `${slug}_trigger`;
  return {
    scripts: [{
      id: scriptId,
      config: {
        alias: `${name} - Trigger`,
        mode: "single",
        sequence: [
          { action: `${dom}.turn_on`, target: { entity_id: relayEid } },
          { delay: { seconds: pulseSeconds } },
          { action: `${dom}.turn_off`, target: { entity_id: relayEid } },
        ],
      },
    }],
    automations: [],
    helper: null,
    templateFlow: null,
    openerEntityId: `script.${scriptId}`,
  };
}

// Kind 2 — mirrors the Bedroom1 Window scripts + its three automations:
// each direction script cancels the OTHER direction's script first (the
// interlock), asserts both relays into the right state, then a travel-timed
// auto-off; "relays off on HA start" (a mid-travel HA restart must not leave
// a relay energized), "failsafe relay on past travel" (relay stuck on past
// travel time = force off), "failsafe both relays on" (both somehow on at
// once = force off immediately, the interlock's belt-and-suspenders).
// Wrapped in a Template Cover so it self-reports through openBarrierCard
// exactly like a real cover.
export function buildTwoDirectionOpener({ slug, name, openRelayEid, closeRelayEid, travelSeconds, deviceClass, sensorEid, invert }) {
  const openDom = _relayDomain(openRelayEid), closeDom = _relayDomain(closeRelayEid);
  const openScriptId = `${slug}_open`, closeScriptId = `${slug}_close`, stopScriptId = `${slug}_stop`;
  const helperId = sensorEid ? null : `${slug}_is_open`;
  // Proportional safety margin on the failsafe, in the same spirit as
  // Bedroom1's own 180s travel / 230s failsafe (~28%); floored at 10s so a
  // short travel time still gets a meaningful margin.
  const failsafeSeconds = travelSeconds + Math.max(10, Math.round(travelSeconds / 4));

  const stateSet = helperId ? [{ action: "input_boolean.turn_on", target: { entity_id: `input_boolean.${helperId}` } }] : [];
  const stateClear = helperId ? [{ action: "input_boolean.turn_off", target: { entity_id: `input_boolean.${helperId}` } }] : [];

  const scripts = [
    {
      id: openScriptId,
      config: {
        alias: `${name} - OPEN`,
        mode: "restart",
        sequence: [
          { action: "script.turn_off", target: { entity_id: `script.${closeScriptId}` }, continue_on_error: true },
          { action: `${closeDom}.turn_off`, target: { entity_id: closeRelayEid } },
          { action: `${openDom}.turn_on`, target: { entity_id: openRelayEid } },
          ...stateSet,
          { delay: { seconds: travelSeconds } },
          { action: `${openDom}.turn_off`, target: { entity_id: openRelayEid } },
        ],
      },
    },
    {
      id: closeScriptId,
      config: {
        alias: `${name} - CLOSE`,
        mode: "restart",
        sequence: [
          { action: "script.turn_off", target: { entity_id: `script.${openScriptId}` }, continue_on_error: true },
          { action: `${openDom}.turn_off`, target: { entity_id: openRelayEid } },
          { action: `${closeDom}.turn_on`, target: { entity_id: closeRelayEid } },
          ...stateClear,
          { delay: { seconds: travelSeconds } },
          { action: `${closeDom}.turn_off`, target: { entity_id: closeRelayEid } },
        ],
      },
    },
    {
      id: stopScriptId,
      config: {
        alias: `${name} - STOP`,
        mode: "single",
        sequence: [
          { action: "script.turn_off", target: { entity_id: [`script.${openScriptId}`, `script.${closeScriptId}`] }, continue_on_error: true },
          { action: `${openDom}.turn_off`, target: { entity_id: openRelayEid } },
          { action: `${closeDom}.turn_off`, target: { entity_id: closeRelayEid } },
        ],
      },
    },
  ];

  const relaysOff = [
    { action: `${openDom}.turn_off`, target: { entity_id: openRelayEid } },
    { action: `${closeDom}.turn_off`, target: { entity_id: closeRelayEid } },
  ];
  const automations = [
    {
      id: `${slug}_relays_off_on_start`,
      config: {
        alias: `${name} - relays off on HA start`,
        triggers: [{ platform: "homeassistant", event: "start" }],
        actions: relaysOff,
        mode: "single",
      },
    },
    {
      id: `${slug}_relay_failsafe`,
      config: {
        alias: `${name} - failsafe relay on past travel`,
        triggers: [{ platform: "state", entity_id: [openRelayEid, closeRelayEid], to: "on", for: { seconds: failsafeSeconds } }],
        actions: relaysOff,
        mode: "single",
      },
    },
    {
      id: `${slug}_both_relays_on`,
      config: {
        alias: `${name} - failsafe both relays on`,
        triggers: [{
          platform: "template",
          value_template: `{{ is_state('${openRelayEid}','on') and is_state('${closeRelayEid}','on') }}`,
          for: { seconds: 3 },
        }],
        actions: relaysOff,
        mode: "single",
      },
    },
  ];

  let stateTemplate;
  if (sensorEid) {
    stateTemplate = _relayDomain(sensorEid) === "cover"
      ? `{{ states('${sensorEid}') }}`
      : (invert
        ? `{{ 'closed' if is_state('${sensorEid}','on') else 'open' }}`
        : `{{ 'open' if is_state('${sensorEid}','on') else 'closed' }}`);
  } else {
    stateTemplate = `{{ 'open' if is_state('input_boolean.${helperId}','on') else 'closed' }}`;
  }

  return {
    scripts,
    automations,
    helper: helperId ? { id: helperId, name: `${name} position memory` } : null,
    templateFlow: {
      step: "cover",
      fields: {
        name,
        state: stateTemplate,
        open_cover: [{ action: `script.${openScriptId}` }],
        close_cover: [{ action: `script.${closeScriptId}` }],
        stop_cover: [{ action: `script.${stopScriptId}` }],
        device_class: deviceClass,
      },
    },
    openerEntityId: null, // not knowable until the flow creates it — resolved from the entity registry afterward
  };
}

// Kind 3 — a single momentary relay (the electric-strike release) plus an
// input_boolean to remember locked/unlocked (there is no position to read
// back from a spring strike). Unlock clears the memory and pulses the
// relay; a companion automation re-arms "locked" after relockSeconds,
// matching the "auto-off timer finished" idiom already used all over this
// house's own automations.yaml rather than a blocking in-script delay.
export function buildMomentaryLock({ slug, name, relayEid, pulseSeconds, relockSeconds }) {
  const dom = _relayDomain(relayEid);
  const helperId = `${slug}_locked`;
  const unlockScriptId = `${slug}_unlock`;
  return {
    scripts: [{
      id: unlockScriptId,
      config: {
        alias: `${name} - Unlock`,
        mode: "single",
        sequence: [
          { action: "input_boolean.turn_off", target: { entity_id: `input_boolean.${helperId}` } },
          { action: `${dom}.turn_on`, target: { entity_id: relayEid } },
          { delay: { seconds: pulseSeconds } },
          { action: `${dom}.turn_off`, target: { entity_id: relayEid } },
        ],
      },
    }],
    automations: [{
      id: `${slug}_auto_relock`,
      config: {
        alias: `${name} - auto re-lock`,
        triggers: [{ platform: "state", entity_id: `input_boolean.${helperId}`, to: "off", for: { seconds: relockSeconds } }],
        actions: [{ action: "input_boolean.turn_on", target: { entity_id: `input_boolean.${helperId}` } }],
        mode: "single",
      },
    }],
    helper: { id: helperId, name: `${name} state memory` },
    templateFlow: {
      step: "lock",
      fields: {
        name,
        state: `{{ 'locked' if is_state('input_boolean.${helperId}','on') else 'unlocked' }}`,
        lock: [{ action: "input_boolean.turn_on", target: { entity_id: `input_boolean.${helperId}` } }],
        unlock: [{ action: `script.${unlockScriptId}` }],
      },
    },
    openerEntityId: null,
  };
}

// Kind 4 — Garry, 2026-09-23: "I have a few places that a relay controlled
// poe switch is used to control a light, so I need the same magic to open
// that new card and setup the relay parameters so a light shows in HA that
// I can use for things. That is the pakedge I'm now working on." The
// simplest of the four: no pulse, no travel, no interlock, no helper — a
// plain relay's on/off IS the light's on/off, wrapped only so it "shows in
// HA" as a real light.* entity (grouping, areas, voice, dashboards) instead
// of a bare switch.* — a passthrough, not a controller. Works for any
// relay-backed light regardless of what put the relay in HA (a Pakedge
// PoE-port toggle, a ProDino channel, anything switch./light.*).
export function buildRelayLight({ slug, name, relayEid }) {
  const dom = _relayDomain(relayEid);
  return {
    scripts: [],
    automations: [],
    helper: null,
    templateFlow: {
      step: "light",
      fields: {
        name,
        state: `{{ is_state('${relayEid}','on') }}`,
        turn_on: [{ action: `${dom}.turn_on`, target: { entity_id: relayEid } }],
        turn_off: [{ action: `${dom}.turn_off`, target: { entity_id: relayEid } }],
      },
    },
    openerEntityId: null,
  };
}

// Runs a build plan (from one of the three builders above) against the real
// HA config APIs, in dependency order — helper before the scripts/
// automations that reference it, scripts before the template flow's
// lock/unlock actions reference them, reload before the template flow reads
// them back. Returns { entity_id, generated } for settings.door_composites;
// throws if any step fails.
async function _runBuildPlan(ctx, build) {
  const hass = ctx.hass;
  const generated = { scripts: [], automations: [], helper_id: null, template_entry_id: null };

  if (build.helper) {
    const r = await ctx.actions.callWS({ type: "input_boolean/create", name: build.helper.id });
    generated.helper_id = (r && r.id) || build.helper.id;
  }
  for (const s of build.scripts) {
    await hass.callApi("POST", `config/script/config/${s.id}`, s.config);
    generated.scripts.push(s.id);
  }
  for (const a of build.automations) {
    await hass.callApi("POST", `config/automation/config/${a.id}`, a.config);
    generated.automations.push(a.id);
  }
  if (build.scripts.length) await hass.callApi("POST", "services/script/reload", {});
  if (build.automations.length) await hass.callApi("POST", "services/automation/reload", {});

  let entityId = build.openerEntityId;
  if (build.templateFlow) {
    const menu = await hass.callApi("POST", "config/config_entries/flow", { handler: "template" });
    const stepRes = await hass.callApi("POST", `config/config_entries/flow/${menu.flow_id}`, { next_step_id: build.templateFlow.step });
    const submitRes = await hass.callApi("POST", `config/config_entries/flow/${stepRes.flow_id}`, build.templateFlow.fields);
    if (submitRes.type !== "create_entry" || !submitRes.result || !submitRes.result.entry_id) {
      throw new Error("Template entity was not created: " + JSON.stringify(submitRes.errors || submitRes));
    }
    generated.template_entry_id = submitRes.result.entry_id;
    const reg = await hass.callWS({ type: "config/entity_registry/list" });
    const match = (reg || []).find(e => e.config_entry_id === generated.template_entry_id);
    if (match) entityId = match.entity_id;
  }

  return { entityId, generated };
}

// The reverse of _runBuildPlan — deletes exactly what settings.door_composites
// recorded for this one composite, nothing else. Best-effort: keeps going
// past individual failures (an already-hand-deleted piece is not a reason to
// abandon the rest of the cleanup) and reports what it could and couldn't
// remove.
async function _teardownComposite(ctx, generated) {
  const hass = ctx.hass;
  const failures = [];
  if (generated.template_entry_id) {
    try { await hass.callApi("DELETE", `config/config_entries/entry/${generated.template_entry_id}`); }
    catch (e) { failures.push("template entity"); }
  }
  for (const id of generated.automations || []) {
    try { await hass.callApi("DELETE", `config/automation/config/${id}`); }
    catch (e) { failures.push(`automation ${id}`); }
  }
  for (const id of generated.scripts || []) {
    try { await hass.callApi("DELETE", `config/script/config/${id}`); }
    catch (e) { failures.push(`script ${id}`); }
  }
  if (generated.helper_id) {
    try { await ctx.actions.callWS({ type: "input_boolean/delete", input_boolean_id: generated.helper_id }); }
    catch (e) { failures.push("helper"); }
  }
  if (generated.automations && generated.automations.length) {
    try { await hass.callApi("POST", "services/automation/reload", {}); } catch (e) { /* best-effort */ }
  }
  if (generated.scripts && generated.scripts.length) {
    try { await hass.callApi("POST", "services/script/reload", {}); } catch (e) { /* best-effort */ }
  }
  return failures;
}

function _relayCandidates(states) {
  return Object.keys(states)
    .filter(eid => _RELAY_DOMAINS.some(d => eid.startsWith(d)))
    .map(eid => ({ entity_id: eid, friendly_name: (states[eid].attributes || {}).friendly_name || eid }))
    .sort((a, b) => a.friendly_name.localeCompare(b.friendly_name));
}

function _sensorCandidates(states) {
  return Object.keys(states)
    .filter(eid => eid.startsWith("binary_sensor.") || eid.startsWith("cover."))
    .map(eid => ({ entity_id: eid, friendly_name: (states[eid].attributes || {}).friendly_name || eid }))
    .sort((a, b) => a.friendly_name.localeCompare(b.friendly_name));
}

function _relaySelect(candidates, placeholder) {
  const sel = document.createElement("select");
  sel.style.cssText = "width:100%;background:#1a2e1e;color:#e2e8f0;border:1px solid #2d4a36;border-radius:8px;padding:7px;font-size:12px;margin-bottom:8px";
  const none = document.createElement("option"); none.value = ""; none.textContent = placeholder;
  sel.appendChild(none);
  for (const c of candidates) {
    const o = document.createElement("option");
    o.value = c.entity_id; o.textContent = `${c.friendly_name} (${c.entity_id})`;
    sel.appendChild(o);
  }
  return sel;
}

function _renderRelayWizard(ctx) {
  const { el } = ctx.helpers;
  const card = el("div", { class: "card" });
  card.appendChild(el("div", { style: "font-weight:700;font-size:14px;color:#52b788;margin-bottom:8px" }, "Build an Opener, Lock, or Light from Relays"));
  card.appendChild(el("div", { style: "font-size:11px;color:#94a3b8;margin-bottom:12px" },
    "For a door, window, or light with no ready-made entity — just a bare relay (a ProDino channel, a Pakedge PoE port, anything switch./light.*). Builds the same kind of script, automation, and template entity Garry's own garage doors, Bedroom1 window, and PoE-switched lights already use, then offers the result the same way any other opener, lock, or light is offered."));

  const composites = (ctx.state.settings && ctx.state.settings.door_composites) || [];
  if (composites.length) {
    card.appendChild(el("div", { style: "font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px" }, "Built from relays"));
    for (const c of composites) {
      const st = ctx.hass && ctx.hass.states && ctx.hass.states[c.entity_id];
      const row = el("div", {
        style: "display:flex;align-items:center;gap:10px;border:1px solid #1b3526;border-radius:8px;padding:8px 12px;margin-bottom:4px;background:#0d1f14",
      });
      row.appendChild(el("div", { style: "flex:1;min-width:0" }, [
        el("div", { style: "font-weight:600;font-size:13px" }, c.name || c.entity_id),
        el("div", { style: "font-size:10px;color:#64748b" }, `${c.entity_id} · ${st ? st.state : "unknown"} · ${(_RELAY_KINDS.find(k => k.id === c.kind) || {}).label || c.kind}`),
      ]));
      const removeBtn = el("button", {
        style: "background:rgba(248,113,113,.1);border:1px solid rgba(248,113,113,.35);border-radius:8px;color:#fca5a5;font-size:12px;cursor:pointer;padding:5px 10px",
        onclick: async () => {
          removeBtn.disabled = true; removeBtn.textContent = "Removing…";
          const failures = await _teardownComposite(ctx, c.generated || {});
          const next = composites.filter(x => x.id !== c.id);
          const nextOpeners = new Set((ctx.state.settings && ctx.state.settings.door_opener_ids) || []);
          nextOpeners.delete(c.entity_id);
          try {
            await ctx.actions.settingsSet({ door_composites: next, door_opener_ids: [...nextOpeners] });
            ctx.toast(failures.length ? `Removed, but couldn't delete: ${failures.join(", ")}` : "Removed.", !!failures.length);
          } catch (e) { ctx.toast("Could not save: " + (e.message || e), true); }
          ctx.actions.renderRooms();
        },
      }, "Remove");
      row.appendChild(removeBtn);
      card.appendChild(row);
    }
  }

  if (!ctx.state._relayWizardOpen) {
    card.appendChild(el("button", {
      class: "btn inline", style: "font-size:12px;margin-top:4px",
      onclick: () => { ctx.state._relayWizardOpen = true; ctx.actions.renderRooms(); },
    }, "+ Build an opener, lock, or light from relays"));
    return card;
  }

  // ── Open form ────────────────────────────────────────────────────────────
  if (!ctx.state._relayWizardKind) ctx.state._relayWizardKind = _RELAY_KINDS[0].id;
  const kind = ctx.state._relayWizardKind;
  const states = (ctx.hass && ctx.hass.states) || {};
  const relayCandidates = _relayCandidates(states);
  const sensorCandidates = _sensorCandidates(states);
  const usedRelays = new Set(composites.flatMap(c => c.relays || []));

  const form = el("div", { style: "border:1px solid #2d4a36;border-radius:10px;padding:12px;margin-top:8px;background:#0d1f14" });

  const kindSel = document.createElement("select");
  kindSel.style.cssText = "width:100%;background:#1a2e1e;color:#e2e8f0;border:1px solid #2d4a36;border-radius:8px;padding:7px;font-size:12px;margin-bottom:10px";
  for (const k of _RELAY_KINDS) {
    const o = document.createElement("option"); o.value = k.id; o.textContent = k.label; if (k.id === kind) o.selected = true;
    kindSel.appendChild(o);
  }
  kindSel.addEventListener("change", () => { ctx.state._relayWizardKind = kindSel.value; ctx.actions.renderRooms(); });
  form.appendChild(kindSel);

  const nameInput = document.createElement("input");
  nameInput.type = "text"; nameInput.placeholder = "Name (e.g. \"Back Door Strike\", \"Bedroom2 Window\")";
  nameInput.style.cssText = "width:100%;background:#1a2e1e;color:#e2e8f0;border:1px solid #2d4a36;border-radius:8px;padding:7px;font-size:13px;margin-bottom:8px";
  form.appendChild(nameInput);

  const relaySel1 = _relaySelect(relayCandidates, kind === "two_direction_opener" ? "— open relay —" : "— relay —");
  form.appendChild(relaySel1);
  let relaySel2 = null;
  if (kind === "two_direction_opener") {
    relaySel2 = _relaySelect(relayCandidates, "— close relay —");
    form.appendChild(relaySel2);
  }
  if (relayCandidates.some(c => usedRelays.has(c.entity_id))) {
    form.appendChild(el("div", { style: "font-size:10px;color:#64748b;margin-bottom:8px" },
      "A relay already used by another built opener/lock still shows here — nothing stops reusing it, but it's rarely intended."));
  }

  let classSel = null;
  if (kind === "two_direction_opener") {
    classSel = document.createElement("select");
    classSel.style.cssText = "width:100%;background:#1a2e1e;color:#e2e8f0;border:1px solid #2d4a36;border-radius:8px;padding:7px;font-size:12px;margin-bottom:8px";
    for (const dc of _COVER_DEVICE_CLASSES) {
      const o = document.createElement("option"); o.value = dc; o.textContent = dc[0].toUpperCase() + dc.slice(1);
      classSel.appendChild(o);
    }
    form.appendChild(classSel);
  }

  // relay_light is a plain passthrough — no pulse, no travel, nothing timed.
  let secondsInput = null;
  if (kind !== "relay_light") {
    secondsInput = document.createElement("input");
    secondsInput.type = "number"; secondsInput.min = "1";
    secondsInput.value = kind === "two_direction_opener" ? "30" : kind === "momentary_lock" ? "3" : "1";
    const secondsLabel = kind === "two_direction_opener" ? "Travel time, seconds (full open or close)"
      : kind === "momentary_lock" ? "Unlock pulse, seconds" : "Pulse, seconds";
    form.appendChild(el("div", { style: "font-size:10px;color:#64748b;margin-bottom:2px" }, secondsLabel));
    secondsInput.style.cssText = "width:100%;background:#1a2e1e;color:#e2e8f0;border:1px solid #2d4a36;border-radius:8px;padding:7px;font-size:13px;margin-bottom:8px";
    form.appendChild(secondsInput);
  }

  let relockInput = null;
  if (kind === "momentary_lock") {
    relockInput = document.createElement("input");
    relockInput.type = "number"; relockInput.min = "1"; relockInput.value = "5";
    form.appendChild(el("div", { style: "font-size:10px;color:#64748b;margin-bottom:2px" }, "Auto re-lock after, seconds"));
    relockInput.style.cssText = "width:100%;background:#1a2e1e;color:#e2e8f0;border:1px solid #2d4a36;border-radius:8px;padding:7px;font-size:13px;margin-bottom:8px";
    form.appendChild(relockInput);
  }

  let sensorSel = null, invertCb = null;
  if (kind === "two_direction_opener") {
    sensorSel = _relaySelect(sensorCandidates, "— optional: link a sensor for ground truth —");
    form.appendChild(sensorSel);
    const invertRow = el("div", { style: "display:flex;align-items:center;gap:6px;margin-bottom:8px;font-size:11px;color:#94a3b8" });
    invertCb = document.createElement("input"); invertCb.type = "checkbox";
    invertRow.appendChild(invertCb);
    invertRow.appendChild(el("span", {}, "Invert the sensor (it reads backwards)"));
    form.appendChild(invertRow);
    form.appendChild(el("div", { style: "font-size:10px;color:#64748b;margin-bottom:8px" },
      "Without a sensor, position is remembered from the open/close commands alone — accurate as long as nothing moves it outside HA."));
  }

  const errorMsg = el("div", { style: "font-size:11px;color:#f87171;margin-bottom:8px;display:none" });
  form.appendChild(errorMsg);

  const buildBtn = el("button", {
    style: "background:linear-gradient(135deg,#166534,#22c55e);color:#f0fdf4;border:1px solid rgba(134,239,172,.6);"
      + "border-radius:8px;font-size:12px;font-weight:700;cursor:pointer;padding:7px 14px;margin-right:6px",
    onclick: async () => {
      errorMsg.style.display = "none";
      const name = nameInput.value.trim();
      const relay1 = relaySel1.value;
      const relay2 = relaySel2 ? relaySel2.value : null;
      const seconds = secondsInput ? parseInt(secondsInput.value, 10) : null;
      if (!name) { errorMsg.textContent = "Name is required."; errorMsg.style.display = "block"; return; }
      if (!relay1 || (kind === "two_direction_opener" && !relay2)) {
        errorMsg.textContent = "Pick every relay this kind needs."; errorMsg.style.display = "block"; return;
      }
      if (kind === "two_direction_opener" && relay1 === relay2) {
        errorMsg.textContent = "The open and close relays must be different."; errorMsg.style.display = "block"; return;
      }
      if (secondsInput && (!Number.isFinite(seconds) || seconds < 1)) {
        errorMsg.textContent = "Enter a valid number of seconds."; errorMsg.style.display = "block"; return;
      }

      const slug = relaySlug(name);
      let build, relays;
      if (kind === "momentary_opener") {
        build = buildMomentaryOpener({ slug, name, relayEid: relay1, pulseSeconds: seconds });
        relays = [relay1];
      } else if (kind === "two_direction_opener") {
        build = buildTwoDirectionOpener({
          slug, name, openRelayEid: relay1, closeRelayEid: relay2, travelSeconds: seconds,
          deviceClass: classSel.value, sensorEid: sensorSel.value || null, invert: !!invertCb.checked,
        });
        relays = [relay1, relay2];
      } else if (kind === "momentary_lock") {
        const relock = parseInt(relockInput.value, 10);
        if (!Number.isFinite(relock) || relock < 1) { errorMsg.textContent = "Enter a valid re-lock time."; errorMsg.style.display = "block"; return; }
        build = buildMomentaryLock({ slug, name, relayEid: relay1, pulseSeconds: seconds, relockSeconds: relock });
        relays = [relay1];
      } else {
        build = buildRelayLight({ slug, name, relayEid: relay1 });
        relays = [relay1];
      }

      buildBtn.disabled = true; buildBtn.textContent = "Building…";
      try {
        const { entityId, generated } = await _runBuildPlan(ctx, build);
        if (!entityId) throw new Error("Built, but couldn't find the resulting entity.");
        const composite = { id: slug, kind, name, entity_id: entityId, relays, generated };
        const nextComposites = [...composites, composite];
        const settingsPatch = { door_composites: nextComposites };
        if (kind !== "momentary_lock" && kind !== "relay_light") {
          const nextOpeners = new Set((ctx.state.settings && ctx.state.settings.door_opener_ids) || []);
          nextOpeners.add(entityId);
          settingsPatch.door_opener_ids = [...nextOpeners];
        }
        await ctx.actions.settingsSet(settingsPatch);
        ctx.toast(`Built ${entityId}.`);
        ctx.state._relayWizardOpen = false;
        ctx.actions.renderRooms();
      } catch (e) {
        buildBtn.disabled = false; buildBtn.textContent = "Build";
        errorMsg.textContent = "Could not build: " + (e.message || e);
        errorMsg.style.display = "block";
      }
    },
  }, "Build");
  form.appendChild(buildBtn);

  form.appendChild(el("button", {
    class: "btn inline", style: "font-size:12px",
    onclick: () => { ctx.state._relayWizardOpen = false; ctx.actions.renderRooms(); },
  }, "Cancel"));

  card.appendChild(form);
  return card;
}
