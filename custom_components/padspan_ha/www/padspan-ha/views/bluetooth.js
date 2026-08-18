// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
// See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
// ── Bluetooth View ──────────────────────────────────────────────────────────
// Main Bluetooth diagnostics page with four sub-tabs:
//   - Visualization: SVG scanner→device graph showing which scanners hear which devices
//   - Monitor: Scrollable advertisement list with detail panel, enrichment badges, tagging
//   - Scanners: Left/right split — scanner list + per-scanner device table
//   - ESPHome Configs: Static YAML config library for setting up ESP32 BLE scanners
//
// Data flow: snapshot.ble provides radios[] (scanners) and advertisements[] (recent BLE ads).
// Each advertisement carries _xref (cross-reference to tracked objects) from the backend.
// The view also pulls snapshot.objects for richer display names and identification status.

// ── The shared display vocabulary ───────────────────────────────────────────
// Four things this view says over and over — a chip, a signal reading, an age,
// an empty state. They used to be written out inline at each call site with
// their own hex colours and font sizes, which is why the same concept looked
// different in three places. One definition each, styled by styles.css
// (the #bluetooth block).

// Signal strength, as a four-bar meter plus the number. -55 and better is
// four bars; every 10 dB below that drops one. Anything at or under -90 keeps
// one bar rather than none, because a device that IS heard should never draw
// as silence.
export function sigLevel(rssi) {
  const v = Number(rssi);
  if (!isFinite(v)) return 0;
  if (v >= -55) return 4;
  if (v >= -70) return 3;
  if (v >= -82) return 2;
  return 1;
}

function sigEl(el, rssi, opts) {
  const v = Number(rssi);
  const lvl = sigLevel(rssi);
  const bars = el("span", { class: "bt-bars", "data-level": String(lvl) },
    [el("i", {}), el("i", {}), el("i", {}), el("i", {})]);
  const txt = isFinite(v) ? `${v} dBm` : "— dBm";
  const wrap = el("span", { class: `bt-sig s-${lvl}`, title: (opts && opts.title) || `Signal ${txt}` },
    [bars, el("span", { class: "bt-dbm" }, txt)]);
  return wrap;
}

// One relative-time formatter. There were two, character-identical, one in
// each sub-tab; a third would have been written the next time.
export function btAgo(sec) {
  const v = Number(sec);
  if (!isFinite(v)) return "\u2014";
  if (v < 1) return "just now";
  if (v < 60) return `${Math.round(v)}s`;
  const m = Math.floor(v / 60);
  if (m < 60) return `${m}m ${Math.round(v - m * 60)}s`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60}m`;
  const d = Math.floor(h / 24);
  return `${d}d ${h % 24}h`;
}

// A chip. tone ∈ good | ok | bad | info | violet | accent | mono | sid | quiet
function chip(el, text, tone, title) {
  return el("span", { class: "bt-chip" + (tone ? " " + tone : ""), ...(title ? { title } : {}) }, String(text));
}

// An empty state that says WHY it is empty and what to do about it — the old
// ones were a bold line and a grey line in a card.
function emptyState(el, mark, title, hint) {
  return el("div", { class: "bt-empty" }, [
    el("div", { class: "bt-empty-mark" }, mark),
    el("div", { class: "bt-empty-title" }, title),
    el("div", { class: "bt-empty-hint" }, hint),
  ]);
}

export function render(ctx) {
  const { el, esc } = ctx.helpers;

  // ── Extract BLE data from the live snapshot ───────────────────────────────
  const snap = (ctx.state.live && ctx.state.live.snapshot) || null;
  const isLive = ctx.state.dataMode === "live";
  const ble = snap && snap.ble ? snap.ble : { radios: [], advertisements: [], diag: { ok: true, errors: [] } };

  // Build an address→object index from the same objects model used by the Objects view,
  // so identified/unidentified status is consistent across both views.
  const objModel = snap && snap.objects ? snap.objects : null;
  const objIndex = new Map();
  if (objModel && Array.isArray(objModel.list)) {
    for (const o of objModel.list) {
      if (o && o.address) objIndex.set(String(o.address).toUpperCase(), o);
    }
  }

  // ── Persistent view state ─────────────────────────────────────────────────
  // Stored on ctx.state so values survive the 5-second poll re-render cycle.
  if (!ctx.state.btTab) ctx.state.btTab = "visualization";
  if (ctx.state.btFilter == null) ctx.state.btFilter = "";
  if (!ctx.state.btSource) ctx.state.btSource = "all";
  if (!ctx.state.btMax) ctx.state.btMax = 200;

  const radios = Array.isArray(ble.radios) ? ble.radios : [];
  const adsAll = Array.isArray(ble.advertisements) ? ble.advertisements : [];
  const diag = ble.diag || { ok: true, errors: [] };

  // ── Filter + paginate advertisements ──────────────────────────────────────
  // Apply source selector and free-text search across all relevant fields
  // (name, address, source, company, services, cross-ref label/room/kind).
  const filter = String(ctx.state.btFilter || "").trim().toLowerCase();
  const sourceSel = ctx.state.btSource || "all";
  const maxItems = Math.max(10, Math.min(1000, Number(ctx.state.btMax || 200)));

  const ads = adsAll
    .filter(a => {
      if (!a) return false;
      if (sourceSel !== "all" && String(a.source || "") !== sourceSel) return false;
      if (!filter) return true;
      // Concatenate all searchable fields into one haystack string for substring match
      const xr = a._xref || {};
      const hay = `${a.name || ""} ${a.address || ""} ${a.source || ""} ${a.company_name || ""} ${a.device_type || ""} ${(a.service_names||[]).join(" ")} ${xr.label || ""} ${xr.kind || ""} ${xr.room || ""} ${xr.canonical_id || ""} ${xr.ibeacon_uuid || ""}`.toLowerCase();
      return hay.includes(filter);
    })
    .slice(0, maxItems);

  // Deduplicated scanner source names for the source dropdown filter
  const sources = ["all", ...Array.from(new Set(radios.map(r => String(r.source || "")).filter(Boolean))).sort()];

  // ── Sub-tab switcher ──────────────────────────────────────────────────────
  const tabButton = (id, label) =>
    el(
      "button",
      {
        class: "tab" + (ctx.state.btTab === id ? " active" : ""),
        role: "tab",
        "aria-selected": ctx.state.btTab === id ? "true" : "false",
        onclick: () => {
          ctx.state.btTab = id;
          ctx.actions.renderRooms();
        },
      },
      label
    );

  // ── Page header + the stat strip ───────────────────────────────────────────
  // A stat is a number and its name. `link` makes one clickable (the IRK
  // count opens its manager); `zero` greys a number that is nothing, so a
  // row of stats reads at a glance instead of demanding six comparisons.
  const stat = (num, label, opts = {}) => {
    const n = Number(num) || 0;
    const cls = "bt-stat" + (opts.link ? " link" : "") + (opts.tone ? " tone-" + opts.tone : "")
      + (!n && !opts.tone ? " zero" : "");
    const d = el("div", { class: cls, ...(opts.title ? { title: opts.title } : {}) }, [
      el("div", { class: "bt-stat-num" }, String(num)),
      el("div", { class: "bt-stat-lbl" }, label),
    ]);
    if (opts.link) {
      d.setAttribute("role", "button");
      d.setAttribute("tabindex", "0");
      const go = () => { ctx.state.btTab = opts.link; ctx.actions.renderRooms(); };
      d.addEventListener("click", go);
      d.addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); go(); } });
    }
    return d;
  };
  const _res = (snap?.objects?.summary?.resolver) || {};
  const header = el("div", { class: "bt-head" }, [
    el("div", { style: "min-width:220px;flex:1" }, [
      el("div", { style: "display:flex;align-items:center;gap:8px" }, [
        el("div", { class: "h1" }, "Bluetooth"),
        ctx.helpers.helpBtn("bluetooth_overview"),
      ]),
      el("div", { class: "bt-head-sub" },
        "Every scanner this install can see, and every advertisement they have heard recently."),
    ]),
    el("div", { class: "bt-kpis" }, [
      stat(radios.length, "Scanners", { title: "BLE scanners reporting to this install" }),
      stat(adsAll.length, "Recent ads", { title: "Advertisements in the current window" }),
      stat(diag.unique_cached || 0, "Unique MACs", { title: "Distinct addresses cached" }),
      stat(_res.irk_devices || 0, "Private BLE IRKs",
        { link: "irk_panel", title: "Open the IRK Manager" }),
      stat(_res.resolved || 0, "RPAs resolved",
        { title: "Rotating addresses matched to a registered IRK" }),
      stat((snap?.objects?.summary?.ibeacon) || 0, "iBeacons"),
    ]),
  ]);

  // ── BLE health diagnostics ─────────────────────────────────────────────────
  // callback_active: whether bluetooth.async_register_callback() succeeded in HA.
  // resolver: private BLE (IRK) resolution status from the objects model.
  const _resolverDiag = (snap?.objects?.summary?.resolver) || {};
  const _resolverErrors = _resolverDiag.errors || [];
  const _callbackOk = diag.callback_active !== false;

  // ── Private BLE status card ─────────────────────────────────────────────────
  const _irkCount = _resolverDiag.irk_devices || 0;
  const _rpaCount = _resolverDiag.rpa_count || 0;
  const _resolvedCount = _resolverDiag.resolved || 0;
  const _privateBleCount = (snap?.objects?.summary?.private_ble) || 0;

  // ── Private BLE clickable card ──────────────────────────────────────────────
  // Expandable card showing IRK device status. Color-coded:
  //   green  = IRKs loaded and resolving RPAs
  //   amber  = RPAs detected but no IRKs configured (unresolvable)
  //   slate  = no rotating-MAC devices detected yet
  if (!ctx.state._pbleExpanded) ctx.state._pbleExpanded = false;
  if (!ctx.state._pbleStatus)   ctx.state._pbleStatus = null;

  let privateBleCard = null;
  const _tone = _irkCount > 0 ? "good" : _rpaCount > 0 ? "ok" : "";

  // Summary line (always shown)
  let _summaryText;
  if (_irkCount > 0) {
    _summaryText = `Private BLE: ${_irkCount} IRK${_irkCount !== 1 ? "s" : ""} loaded \u2022 ${_resolvedCount} address${_resolvedCount !== 1 ? "es" : ""} resolved \u2022 ${_privateBleCount} device${_privateBleCount !== 1 ? "s" : ""} tracked`;
  } else if (_rpaCount > 0) {
    _summaryText = `${_rpaCount} rotating-MAC device${_rpaCount !== 1 ? "s" : ""} detected but unresolvable \u2014 no IRKs configured`;
  } else {
    _summaryText = `Private BLE: no rotating-MAC devices detected yet`;
  }

  // A status dot, not an emoji: the state is the colour, and the colour is the
  // same three tones the whole view uses.
  privateBleCard = el("div", { class: "bt-notice" + (_tone ? " " + _tone : ""), style: "cursor:pointer" });

  const _pbleHdr = el("div", { style: "display:flex;align-items:flex-start;gap:10px;width:100%" }, [
    el("span", { class: "bt-notice-mark" }, ""),
    el("div", { class: "bt-notice-body" }, [
      el("div", { class: "bt-notice-title" }, _summaryText),
      _rpaCount > _resolvedCount && _irkCount > 0
        ? el("div", { class: "bt-notice-sub" }, `${_rpaCount - _resolvedCount} further RPA${_rpaCount - _resolvedCount !== 1 ? "s" : ""} seen that match no registered IRK`)
        : null,
    ].filter(Boolean)),
    el("span", { class: "bt-notice-more" }, ctx.state._pbleExpanded ? "\u25BE details" : "\u25B8 details"),
  ]);
  privateBleCard.appendChild(_pbleHdr);

  // Toggle expand/collapse; lazy-fetch private BLE status on first expand
  _pbleHdr.addEventListener("click", () => {
    ctx.state._pbleExpanded = !ctx.state._pbleExpanded;
    if (ctx.state._pbleExpanded && !ctx.state._pbleStatus) {
      ctx.actions.wsCall("padspan_ha/private_ble_status").then(res => {
        ctx.state._pbleStatus = res;
        ctx.actions.renderRooms();
      }).catch(e => console.error("pble status:", e));
    }
    ctx.actions.renderRooms();
  });

  // Expanded detail panel
  if (ctx.state._pbleExpanded) {
    const detail = el("div", { style: "margin-top:11px;padding-top:10px;border-top:1px solid var(--bt-line);width:100%" });

    const st = ctx.state._pbleStatus;
    if (!st) {
      detail.appendChild(el("div", { class: "muted" }, "Loading status\u2026"));
    } else {
      // ── Integration status ──
      const intRow = el("div", { class: "bt-chips", style: "margin-bottom:10px;gap:5px" }, [
        chip(el, st.has_private_ble_integration
              ? "Private BLE Device integration installed"
              : "Private BLE Device integration not installed",
             st.has_private_ble_integration ? "good" : "bad"),
        chip(el, `${st.total_ble_addresses || 0} BLE addresses seen`, "quiet"),
        chip(el, `${st.rpa_count || 0} rotating (RPA)`, st.rpa_count ? "info" : "quiet"),
      ]);
      detail.appendChild(intRow);

      // ── Mobile apps ──
      if (st.mobile_apps && st.mobile_apps.length > 0) {
        const maRow = el("div", { style: "font-size:12px;margin-bottom:10px" });
        maRow.appendChild(el("span", { class: "bt-mini-lbl" }, "Companion apps "));
        maRow.appendChild(el("span", { class: "muted" }, st.mobile_apps.join(", ")));
        detail.appendChild(maRow);
      }

      // ── Registered devices table ──
      if (st.devices && st.devices.length > 0) {
        detail.appendChild(el("div", { class: "bt-kv-title", style: "margin-top:0" },
          `Registered IRK devices (${st.devices.length})`));
        const tbl = el("table", { class: "table" });
        const thead = el("tr", {});
        for (const h of ["Name", "Canonical ID", "Source"]) thead.appendChild(el("th", {}, h));
        tbl.appendChild(el("thead", {}, thead));
        const tb = el("tbody");
        for (const d of st.devices) {
          const tr = el("tr", {});
          tr.appendChild(el("td", { style: "font-weight:700" }, d.name || "?"));
          tr.appendChild(el("td", { class: "bt-adv-sub", style: "white-space:normal;word-break:break-all" }, d.canonical_id || ""));
          tr.appendChild(el("td", { class: "muted" }, d.source || ""));
          tb.appendChild(tr);
        }
        tbl.appendChild(tb);
        detail.appendChild(tbl);
      } else {
        detail.appendChild(el("div", { class: "muted", style: "font-size:12px;margin-bottom:8px" },
          "No IRK registered. Phones and watches change their address every ~15 minutes; without the key, each change looks like a new device."));
      }

      // ── Add IRK form (always available) ──
      const irkForm = el("div", { style: "background:var(--bt-inset);border:1px solid var(--bt-line);border-radius:10px;padding:12px;margin-top:10px" });
      irkForm.appendChild(el("div", { class: "bt-kv-title", style: "margin-top:0" }, "Add an IRK"));
      irkForm.appendChild(el("div", { class: "muted", style: "font-size:12px;margin-bottom:9px;line-height:1.55" },
        "Paste the IRK from your phone's Companion App (Settings \u2192 Companion App \u2192 Manage Sensors \u2192 BLE Transmitter). "
        + "Accepts hex (32 chars), base64, or colon-separated format. "
        + "Need to capture IRKs from phones/watches? Use the ESPHome IRK Capture tool: github.com/DerekSeaman/irk-capture"));

      const irkInputRow = el("div", { style: "display:flex;gap:6px;align-items:center;flex-wrap:wrap" });
      const irkNameInput = el("input", {
        class: "input", type: "text", placeholder: "Device name \u2014 e.g. Garry's Pixel",
        style: "width:190px",
      });
      const irkValueInput = el("input", {
        class: "input", type: "text", placeholder: "IRK (hex or base64)",
        style: "width:270px;font-family:ui-monospace,SFMono-Regular,Consolas,monospace",
      });
      const irkAddBtn = el("button", { class: "btn inline" }, "Add");
      const irkMsg = el("div", { style: "font-size:11.5px;margin-top:5px;min-height:16px;width:100%" });

      // Submit IRK to backend — accepts hex (32 chars), base64, or colon-separated
      irkAddBtn.addEventListener("click", async (e) => {
        e.stopPropagation();
        const name = irkNameInput.value.trim();
        const irk = irkValueInput.value.trim();
        if (!name || !irk) { irkMsg.textContent = "Enter both a name and an IRK"; irkMsg.style.color = "var(--bt-ok)"; return; }
        irkAddBtn.disabled = true; irkAddBtn.textContent = "Adding...";
        try {
          await ctx.actions.wsCall("padspan_ha/irk_add", { name, irk_hex: irk });
          irkMsg.style.color = "var(--bt-good)";
          irkMsg.textContent = "\u2713 IRK saved for " + name + " \u2014 resolving will start within 60 seconds";
          irkNameInput.value = ""; irkValueInput.value = "";
          // Refresh status after a short delay to let the backend register the new IRK
          ctx.state._pbleStatus = null;
          setTimeout(() => {
            ctx.actions.wsCall("padspan_ha/private_ble_status").then(res => {
              ctx.state._pbleStatus = res;
              ctx.actions.renderRooms();
            });
          }, 1000);
        } catch (err) {
          irkMsg.style.color = "var(--bt-bad)";
          irkMsg.textContent = (err && err.message) || String(err);
        }
        irkAddBtn.disabled = false; irkAddBtn.textContent = "Add";
      });

      irkInputRow.appendChild(irkNameInput);
      irkInputRow.appendChild(irkValueInput);
      irkInputRow.appendChild(irkAddBtn);
      irkInputRow.appendChild(irkMsg);
      irkForm.appendChild(irkInputRow);

      // Remove buttons for PadSpan-managed IRKs
      if (st.devices && st.devices.length > 0) {
        const padspanDevs = st.devices.filter(d => d.source === "padspan");
        if (padspanDevs.length > 0) {
          const rmDiv = el("div", { style: "margin-top:10px" });
          rmDiv.appendChild(el("div", { class: "bt-mini-lbl", style: "display:block;margin-bottom:5px" }, "PadSpan-managed IRKs"));
          for (const d of padspanDevs) {
            const rmRow = el("div", { style: "display:flex;align-items:center;gap:8px;margin-bottom:3px" });
            rmRow.appendChild(el("span", { style: "font-size:12px;font-weight:600" }, d.name));
            rmRow.appendChild(el("span", { class: "bt-adv-sub" }, (d.canonical_id || "").substring(0, 20) + "\u2026"));
            const rmBtn = el("button", { class: "btn tiny bt-btn-danger" }, "Remove");
            rmBtn.addEventListener("click", async (ev) => {
              ev.stopPropagation();
              if (!confirm(`Remove IRK for ${d.name}?`)) return;
              const hex = (d.canonical_id || "").replace("irk:", "");
              await ctx.actions.wsCall("padspan_ha/irk_remove", { irk_hex: hex });
              ctx.state._pbleStatus = null;
              ctx.actions.wsCall("padspan_ha/private_ble_status").then(res => { ctx.state._pbleStatus = res; ctx.actions.renderRooms(); });
            });
            rmRow.appendChild(rmBtn);
            rmDiv.appendChild(rmRow);
          }
          irkForm.appendChild(rmDiv);
        }
      }

      detail.appendChild(irkForm);

      // ── How to find IRK ──
      detail.appendChild(el("div", { class: "muted", style: "font-size:11.5px;margin-top:10px;line-height:1.6" }, [
        el("div", { class: "bt-kv-title", style: "margin-top:0;border:none;padding:0" }, "Where to find the IRK"),
        el("div", {}, "Android: Companion App \u2192 Settings \u2192 Companion App \u2192 Manage Sensors \u2192 BLE Transmitter \u2192 look for \"IRK\" in the settings/attributes."),
        el("div", {}, [
          el("span", {}, "Apple: IRK is shared via Bluetooth pairing. "),
          el("a", { href: "https://community.home-assistant.io/t/private-ble-device-apple-devices/546810", target: "_blank", rel: "noopener", class: "bt-link" }, "Apple IRK guide"),
        ]),
      ]));

      // ── Resolver errors ──
      if (st.error) {
        detail.appendChild(el("div", { class: "bt-note bad", style: "margin-top:8px;font-size:12px" }, `Error: ${st.error}`));
      }

      // ── Refresh button ──
      const refreshBtn = el("button", { class: "btn inline", style: "margin-top:10px" }, "Refresh status");
      refreshBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        ctx.state._pbleStatus = null;
        ctx.actions.wsCall("padspan_ha/private_ble_status").then(res => {
          ctx.state._pbleStatus = res;
          ctx.actions.renderRooms();
        });
        ctx.actions.renderRooms();
      });
      detail.appendChild(refreshBtn);
    }
    privateBleCard.style.flexWrap = "wrap";
    privateBleCard.appendChild(detail);
  }

  // ── BLE health warning cards ────────────────────────────────────────────────
  // diagCard: shown when ble.diag.ok is false (e.g. HA Bluetooth integration missing)
  const diagCard =
    diag && (diag.ok === false || (diag.errors && diag.errors.length))
      ? el("div", { class: "bt-notice bad", style: "flex-wrap:wrap" }, [
          el("span", { class: "bt-notice-mark" }, ""),
          el("div", { class: "bt-notice-body" }, [
            el("div", { class: "bt-notice-title" }, "The Bluetooth feed looks unhealthy"),
            el("div", { class: "bt-notice-sub" },
              "Usually the HA Bluetooth integration is not enabled, or the scanner API callback failed. The page still renders; the data may be empty."),
          ]),
          el("pre", { class: "pre", style: "width:100%;margin:8px 0 0" }, esc(JSON.stringify(diag, null, 2))),
        ])
      : null;

  // bleDiagCard: shown when the BLE callback failed or private BLE resolver has errors
  const bleDiagCard = (!_callbackOk || _resolverErrors.length)
    ? el("div", { class: "bt-notice ok", style: "flex-wrap:wrap" }, [
        el("span", { class: "bt-notice-mark" }, ""),
        el("div", { class: "bt-notice-body" }, [
          !_callbackOk ? el("div", {}, [
            el("div", { class: "bt-notice-title" }, "BLE callback not active"),
            el("div", { class: "bt-notice-sub" }, "No live advertisements are arriving — only what HA already discovered. bluetooth.async_register_callback() failed; the HA log will say why."),
          ]) : null,
          _resolverErrors.length ? el("div", { style: _callbackOk ? "" : "margin-top:8px" }, [
            el("div", { class: "bt-notice-title" }, "Private BLE resolver errors"),
          ]) : null,
        ].filter(Boolean)),
        _resolverErrors.length ? el("pre", { class: "pre", style: "width:100%;margin:8px 0 0" }, _resolverErrors.join("\n")) : null,
      ].filter(Boolean))
    : null;

  // A segmented control rather than five loose pills: they are one choice.
  const tabs = el("div", { class: "bt-seg", role: "tablist" }, [
    tabButton("visualization", "Visualisation"),
    tabButton("monitor", "Advertisements"),
    tabButton("scanners", "Scanners"),
    tabButton("irk_panel", "IRK Manager"),
    tabButton("esphome_configs", "ESPHome Configs"),
  ]);

  // ── Search / source / max-rows controls ────────────────────────────────────
  // Shared filter bar used by all sub-tabs except ESPHome Configs.
  const controls = el("div", { class: "bt-controls" }, [
    el("div", { class: "field", style: "flex:2;min-width:160px" }, [
      el("div", { class: "label" }, "Search"),
      el("input", {
        class: "input",
        placeholder: "Name, address or scanner…",
        value: ctx.state.btFilter,
        oninput: e => {
          ctx.state.btFilter = e.target.value;
          ctx.actions.renderRooms();
        },
      }),
    ]),
    el("div", { class: "field", style: "flex:1;min-width:140px" }, [
      el("div", { class: "label" }, "Source"),
      el(
        "select",
        {
          class: "select",
          onchange: e => {
            ctx.state.btSource = e.target.value;
            ctx.actions.renderRooms();
          },
        },
        sources.map(s => el("option", { value: s, ...(s === sourceSel ? { selected: "selected" } : {}) }, s === "all" ? "All scanners" : s))
      ),
    ]),
    el("div", { class: "field", style: "flex:0 0 90px" }, [
      el("div", { class: "label" }, "Max rows"),
      el("input", {
        class: "input",
        type: "number",
        min: 10,
        max: 1000,
        value: String(ctx.state.btMax),
        oninput: e => {
          ctx.state.btMax = e.target.value;
          ctx.actions.renderRooms();
        },
      }),
    ]),
  ]);

  // ── Tab routing ────────────────────────────────────────────────────────────
  // ESPHome Configs tab is 100% static — cache the DOM to avoid flickering
  // expanded YAML blocks during the 5-second poll re-render cycle.
  if (ctx.state.btTab === "esphome_configs") {
    if (ctx.state._esphomeFullDom) return ctx.state._esphomeFullDom;
    const body = renderEsphomeConfigs(ctx);
    const out = el("div", { id: "bluetooth" }, [header, privateBleCard, diagCard, bleDiagCard, tabs, body]);
    ctx.state._esphomeFullDom = out;
    return out;
  }
  // Clear the cache when leaving the tab so it rebuilds on re-entry
  ctx.state._esphomeFullDom = null;
  ctx.state._esphomeConfigsDom = null;

  let body = null;
  if (ctx.state.btTab === "irk_panel") {
    body = renderIrkPanel(ctx, snap);
    const out = el("div", { id: "bluetooth" }, [header, privateBleCard, diagCard, bleDiagCard, tabs, body]);
    return out;
  } else if (ctx.state.btTab === "scanners") {
    body = renderScanners(ctx, radios, sources, adsAll);
  } else if (ctx.state.btTab === "monitor") {
    body = renderMonitor(ctx, ads, radios, objIndex);
  } else {
    body = renderVisualization(ctx, radios, ads, objIndex);
  }

  const out = el("div", { id: "bluetooth" }, [header, privateBleCard, diagCard, bleDiagCard, tabs, controls, body]);
  return out;
}

// ── Scanners Sub-Tab ────────────────────────────────────────────────────────
// Two-column layout: left panel lists all BLE scanners (ESPHome proxies,
// HA Bluetooth adapters), right panel shows devices heard by the selected scanner.
// Each scanner row includes: short ID pill, name, room, metadata, RSSI offset
// control, and a two-step "Reset radio" button (to prevent accidental data loss).
function renderScanners(ctx, radios, sources, adsAll) {
  const { el, radioShortId } = ctx.helpers;
  const snap = (ctx.state.live && ctx.state.live.snapshot) || null;
  const scannerOffsets = (snap && snap.scanner_offsets) || (ctx.state.settings && ctx.state.settings.scanner_offsets) || {};
  // Sources masked out of positioning (issue #59) — a mask, never a delete.
  const excludedSrcs = new Set(
    Array.isArray(ctx.state.settings?.excluded_scanners) ? ctx.state.settings.excluded_scanners : []);

  if (!radios.length) {
    return emptyState(el, "\u25CC", "No scanners reported",
      "If you expected scanners, check that Settings \u2192 Devices & services \u2192 Bluetooth is enabled in Home Assistant, and that your ESPHome proxies are online.");
  }

  const row = r => {
    const src  = String(r.source || "");
    const name = String(r.name || "");
    const sid  = radioShortId ? radioShortId(src) : "";
    const meta = [];
    if (r.adapter) meta.push(`adapter: ${r.adapter}`);
    { const _ss = ctx.helpers.scannerStatus; if(_ss){ const ss = _ss(r, adsAll); meta.push(`status: ${ss.label}`); } else if(r.scanning != null){ meta.push(`scanning: ${r.scanning ? "yes" : "no"}`); } }
    if (r.connectable != null) meta.push(`connectable: ${r.connectable ? "yes" : "no"}`);

    const nameRow = el("div", { style: "display:flex;align-items:center;gap:6px;flex-wrap:wrap;min-width:0" }, [
      sid ? chip(el, sid, "sid", (name ? name + " \u00b7 " : "") + src) : null,
      el("div", { class: "bt-scanner-name" }, name || src || "Scanner"),
      r.lost     ? chip(el, "lost", "ok", "Not heard from recently") : null,
      r.disabled ? chip(el, "disabled", "violet") : null,
      excludedSrcs.has(src)
        ? chip(el, "excluded", "quiet",
               "Masked out of positioning — its readings are ignored, but nothing it recorded has been deleted")
        : null,
    ].filter(Boolean));

      // Per-scanner RSSI offset control — compensates for hardware differences.
    // Positive offset = scanner reads weaker than reality; negative = reads stronger.
    // Persisted via padspan_ha/scanner_offset_set WS call, applied during model inference.
    const currentOffset = Number(scannerOffsets[src] || 0);
    const offsetInput = el("input", {
      type: "number", min: "-30", max: "30", step: "1",
      value: String(currentOffset),
      title: "RSSI offset in dBm — positive = scanner reads weaker than reality; negative = reads stronger",
      "aria-label": "RSSI offset in dBm",
    });
    const offsetSaveBtn = el("button", { class: "btn tiny" }, "Set");
    offsetSaveBtn.addEventListener("click", async (ev) => {
      ev.stopPropagation();
      const v = Math.max(-30, Math.min(30, parseFloat(offsetInput.value) || 0));
      try {
        await ctx.actions.scannerOffsetSet(src, v);
        ctx.toast(`Offset for ${name || src}: ${v > 0 ? "+" : ""}${v} dBm`);
      } catch(e) { ctx.toast("Failed to save offset", true); }
    });
    const offsetRow = el("div", { style: "display:flex;align-items:center;gap:4px;margin-top:3px" }, [
      el("span", { class: "muted", style: "font-size:10px" }, "RSSI offset:"),
      offsetInput,
      el("span", { class: "muted", style: "font-size:10px" }, "dBm"),
      offsetSaveBtn,
      currentOffset !== 0 ? el("span", { class: "badge", style: "font-size:10px;background:#1a3a2a;color:#52b788" }, `${currentOffset > 0 ? "+" : ""}${currentOffset} dBm active`) : null,
    ].filter(Boolean));

    // ── Exclude from positioning (issue #59) ────────────────────────────────
    // For a receiver that physically moves: its readings are actively
    // misleading rather than merely absent (an offline scanner already
    // contributes nothing on its own). Masking is fully reversible — nothing
    // it recorded is deleted, so Include restores it exactly.
    const isExcluded = excludedSrcs.has(src);
    const exclBtn = el("button", {
      class: "btn tiny" + (isExcluded ? " bt-btn-accent" : ""),
      title: isExcluded
        ? "Let this receiver influence positioning again"
        : "Ignore this receiver everywhere: no room votes, no RSSI influence, no new calibration readings, and the model retrains without it. Nothing stored is deleted.",
    }, isExcluded ? "Include" : "Exclude");
    exclBtn.addEventListener("click", async (ev) => {
      ev.stopPropagation();
      exclBtn.disabled = true;
      const next = new Set(excludedSrcs);
      if (isExcluded) next.delete(src); else next.add(src);
      try {
        await ctx.actions.settingsSet({ excluded_scanners: [...next] });
        ctx.toast(isExcluded
          ? `${name || src} is back in positioning`
          : `${name || src} excluded — stored data kept, model retraining`);
      } catch(e) {
        ctx.toast("Could not change exclusion", true);
        exclBtn.disabled = false;
      }
    });
    const exclRow = el("div", { style: "display:flex;align-items:center;gap:6px" }, [
      exclBtn,
      isExcluded ? el("span", { class: "bt-mini-lbl" }, "ignored \u00b7 data kept") : null,
    ].filter(Boolean));

    // Reset radio button — two-step confirmation to prevent accidental data loss.
    // First click shows "Erase all data? [Yes, reset] [No]"; second click executes.
    // Clears calibration readings, map placements, fingerprints, and offsets for this radio.
    const resetWrap = document.createElement("div");
    resetWrap.style.cssText = "display:flex;align-items:center;gap:4px";
    const makeResetBtn = () => {
      resetWrap.innerHTML = "";
      const rb = document.createElement("button");
      rb.className = "btn tiny bt-btn-danger";
      rb.textContent = "Reset";
      rb.title = "Clear all stored data for this radio (calibration, placement, offsets, fingerprints)";
      rb.addEventListener("click", (ev) => {
        ev.stopPropagation();
        resetWrap.innerHTML = "";
        const lbl2 = document.createElement("span");
        lbl2.className = "bt-mini-lbl";
        lbl2.style.color = "var(--bt-bad)";
        lbl2.textContent = "Erase all data?";
        const yesBtn = document.createElement("button");
        yesBtn.className = "btn tiny bt-btn-danger";
        yesBtn.textContent = "Yes, reset";
        const noBtn = document.createElement("button");
        noBtn.className = "btn tiny";
        noBtn.textContent = "No";
        yesBtn.addEventListener("click", async (ev2) => {
          ev2.stopPropagation();
          resetWrap.innerHTML = "";
          const spin = document.createElement("span");
          spin.className = "bt-mini-lbl";
          spin.textContent = "Resetting…";
          resetWrap.appendChild(spin);
          try {
            const res = await ctx.actions.radioReset(src);
            const sm = res?.summary || {};
            const parts = [];
            if (sm.maps?.receivers_removed) parts.push(`${sm.maps.receivers_removed} placement(s)`);
            if (sm.calibration?.readings_removed) parts.push(`${sm.calibration.readings_removed} cal reading(s)`);
            if (sm.adaptive?.room_pairs_removed) parts.push(`${sm.adaptive.room_pairs_removed} fingerprint(s)`);
            if (sm.settings?.offset_cleared) parts.push("offset cleared");
            const detail = parts.length ? ": " + parts.join(", ") : "";
            ctx.toast(`Radio reset${detail}`);
            ctx.actions.renderRooms();
          } catch (e) {
            ctx.toast("Reset failed: " + String(e), true);
            makeResetBtn();
          }
        });
        noBtn.addEventListener("click", (ev2) => {
          ev2.stopPropagation();
          makeResetBtn();
        });
        resetWrap.appendChild(lbl2);
        resetWrap.appendChild(yesBtn);
        resetWrap.appendChild(noBtn);
      });
      resetWrap.appendChild(rb);
    };
    makeResetBtn();

    // Relearn button — shift stored RSSI readings after antenna upgrade/downgrade.
    // Two-step flow: click → dB gain input + confirm; applies shift to all calibration data.
    const relearnWrap = document.createElement("div");
    relearnWrap.style.cssText = "display:flex;align-items:center;gap:4px";
    const makeRelearnBtn = () => {
      relearnWrap.innerHTML = "";
      const rb = document.createElement("button");
      rb.className = "btn tiny bt-btn-info";
      rb.textContent = "Relearn";
      rb.title = "Adjust calibration data after antenna upgrade/downgrade — shifts stored RSSI by a dB gain";
      rb.addEventListener("click", (ev) => {
        ev.stopPropagation();
        relearnWrap.innerHTML = "";
        const lbl = document.createElement("span");
        lbl.className = "bt-mini-lbl";
        lbl.style.color = "#7dd3fc";
        lbl.textContent = "dB gain";
        const inp = document.createElement("input");
        inp.type = "number"; inp.min = "-30"; inp.max = "30"; inp.step = "1"; inp.value = "3";
        inp.setAttribute("aria-label", "dB gain");
        inp.title = "Positive = antenna upgrade (stronger signal); Negative = downgrade (weaker)";
        const helpTxt = document.createElement("span");
        helpTxt.className = "bt-mini-lbl";
        helpTxt.textContent = "+ upgrade / − downgrade";
        const applyBtn = document.createElement("button");
        applyBtn.className = "btn tiny bt-btn-info";
        applyBtn.textContent = "Apply";
        const cancelBtn = document.createElement("button");
        cancelBtn.className = "btn tiny";
        cancelBtn.textContent = "Cancel";
        applyBtn.addEventListener("click", async (ev2) => {
          ev2.stopPropagation();
          const gain = Math.max(-30, Math.min(30, parseFloat(inp.value) || 0));
          if (gain === 0) { ctx.toast("Gain must be non-zero", true); return; }
          relearnWrap.innerHTML = "";
          const spin = document.createElement("span");
          spin.className = "bt-mini-lbl";
          spin.textContent = "Relearning…";
          relearnWrap.appendChild(spin);
          try {
            const res = await ctx.actions.calibrationRelearnRadio(src, gain);
            ctx.toast(`Relearned ${name || src}: ${gain > 0 ? "+" : ""}${gain} dB — ${res.updated_points} point(s) updated`);
            makeRelearnBtn();
            ctx.actions.renderRooms();
          } catch (e) {
            ctx.toast("Relearn failed: " + String(e), true);
            makeRelearnBtn();
          }
        });
        cancelBtn.addEventListener("click", (ev2) => {
          ev2.stopPropagation();
          makeRelearnBtn();
        });
        relearnWrap.appendChild(lbl);
        relearnWrap.appendChild(inp);
        relearnWrap.appendChild(helpTxt);
        relearnWrap.appendChild(applyBtn);
        relearnWrap.appendChild(cancelBtn);
      });
      relearnWrap.appendChild(rb);
    };
    makeRelearnBtn();

    // Scanner health badge (Phase 3: per-scanner reliability)
    const _sh = (snap && snap.scanner_health && snap.scanner_health[src]) || null;
    let healthBadge = null;
    if (_sh && _sh.polls >= 6) {
      const rel = _sh.reliability;
      const pct = _sh.agree_pct;
      const hColor = rel >= 0.9 ? "var(--bt-good)" : rel >= 0.7 ? "var(--bt-ok)" : "var(--bt-bad)";
      const hLabel = rel >= 0.9 ? "Reliable" : rel >= 0.7 ? "Fair" : "Unreliable";
      // Agreement is a proportion, so it is drawn as one: a filled track says
      // "how much" at a glance, and the numbers stay for the people who want them.
      healthBadge = el("div", { class: "bt-health", title:
        "How often this scanner agrees with the consensus room. Low agreement means placement, antenna or offset needs attention." }, [
        el("span", { class: "bt-health-dot", style: `background:${hColor}` }, ""),
        el("span", { style: `color:${hColor};font-weight:700` }, hLabel),
        el("span", { class: "bt-health-track" },
          el("span", { class: "bt-health-fill", style: `width:${Math.max(0, Math.min(100, pct))}%;background:${hColor}` }, "")),
        el("span", { class: "muted", style: "font-variant-numeric:tabular-nums" },
          `${pct}% agreement \u00b7 weight ${rel} \u00b7 ${_sh.polls} polls`),
      ]);
    }

    const subParts = [
      r.area_name ? chip(el, r.area_name, "accent") : null,
      r.ip ? chip(el, r.ip, "mono quiet", "IP address") : null,
      r.ssid ? chip(el, r.ssid, "quiet", "WiFi network") : null,
      r.wifi_signal != null ? chip(el, `${r.wifi_signal} dBm`, "quiet", "WiFi signal") : null,
    ].filter(Boolean);

    // Compact controls row: offset + relearn + reset on ONE line
    const ctrlRow = el("div", { class: "bt-mini" }, [
      // Offset inline
      el("span", { class: "bt-mini-lbl" }, "Offset"),
      offsetInput,
      offsetSaveBtn,
      currentOffset !== 0
        ? chip(el, `${currentOffset > 0 ? "+" : ""}${currentOffset} dBm`, "accent", "Offset in effect")
        : null,
      // Relearn + Reset as compact buttons on same line
      relearnWrap,
      resetWrap,
      exclRow,
    ].filter(Boolean));
    // Remove margin-top from relearn/reset since they're inline now
    relearnWrap.style.cssText = "display:flex;align-items:center;gap:4px";
    resetWrap.style.cssText = "display:flex;align-items:center;gap:4px";
    exclRow.style.marginTop = "0";

    const div = el("div", { class: "bt-scanner-row" + (r.lost || r.disabled ? " warn" : "") }, [
      el("div", { class: "bt-scanner-main", style: "min-width:0" }, [
        // Line 1: identity — short ID, name, state, room, network
        el("div", { style: "display:flex;align-items:center;gap:5px;flex-wrap:wrap;min-width:0" }, [
          ...nameRow.childNodes,
          ...subParts,
        ].filter(Boolean)),
        // Line 2: the source id and the adapter facts, in one quiet mono line
        el("div", { class: "bt-scanner-src", style: "margin-top:2px" },
          [src || "", meta.join(" \u00b7 ")].filter(Boolean).join("  \u2502  ")),
        // Line 3 (optional): how much this scanner is trusted
        healthBadge,
        // Line 4: this scanner's own controls
        ctrlRow,
      ].filter(Boolean)),
    ]);
    div.style.cursor = "pointer";
    div.title = "Click to see devices heard by this scanner";
    return div;
  };

  // ── Right panel: objects heard by selected scanner ──────────────────────────
  // Default to first scanner; selection persists across re-renders via ctx.state.
  if (!ctx.state._scannerSel && radios.length) ctx.state._scannerSel = radios[0].source || "";
  const selSrc = ctx.state._scannerSel || "";

  // Build the left-side scanner list with click-to-select behavior.
  // Selected scanner gets a green left border highlight.
  // Clicks on buttons/inputs (offset, reset) are excluded from selection.
  const scannerListEl = el("div", { class: "bt-list list-scroll", style: "max-height:78vh" });
  for (const r of radios) {
    const rowEl = row(r);
    const src = String(r.source || "");
    // A class, so the selected state is one rule in the stylesheet (an accent
    // rail down the left edge) instead of a style string appended at runtime.
    if (src === selSrc) rowEl.classList.add("is-selected");
    rowEl.addEventListener("click", (ev) => {
      if (ev.target.tagName === "BUTTON" || ev.target.tagName === "INPUT") return;
      ev.stopPropagation(); ev.preventDefault();
      ctx.state._scannerSel = src;
      ctx.actions.renderRooms();
    });
    scannerListEl.appendChild(rowEl);
  }

  // Build objects list for selected scanner from raw advertisements
  const objModel = snap && snap.objects ? snap.objects : null;
  const allObjects = objModel && Array.isArray(objModel.list) ? objModel.list : [];

  // Index objects by address for enrichment
  const objByAddr = new Map();
  for (const o of allObjects) {
    if (o.address) objByAddr.set(String(o.address).toUpperCase(), o);
    for (const a of (o.all_addresses || [])) { if (a) objByAddr.set(String(a).toUpperCase(), o); }
  }

  // Find all ads from the selected scanner, then dedup by address keeping the
  // strongest RSSI. This gives a "what can this scanner see right now?" view.
  const scannerAds = adsAll.filter(a => String(a.source || "") === selSrc);
  const addrMap = new Map();
  for (const a of scannerAds) {
    const addr = (a.address || "").toUpperCase();
    if (!addr) continue;
    const prev = addrMap.get(addr);
    if (!prev || (a.rssi || -200) > (prev.rssi || -200)) addrMap.set(addr, a);
  }
  const uniqueAds = [...addrMap.values()].sort((a, b) => (b.rssi || -200) - (a.rssi || -200));

  // One relative-time formatter for the whole view (top of this file).
  const fmtAgo = btAgo;

  // Quiet mode: only show devices the user has labeled, identified, or is following.
  // Hides the flood of unknown BLE advertisements for a cleaner view.
  const _quietMode = !!(ctx.state.settings && ctx.state.settings.quiet_mode);
  const _filteredAds = _quietMode
    ? uniqueAds.filter(a => {
        const addr = (a.address || "").toUpperCase();
        const obj = objByAddr.get(addr);
        if (obj && (obj.user_label || obj.identified)) return true;
        if (ctx.actions.followedHas && ctx.actions.followedHas(addr)) return true;
        return false;
      })
    : uniqueAds;

  const detailCard = el("div", { class: "bt-panel", style: "max-height:80vh;overflow-y:auto" });
  const selRadio = radios.find(r => String(r.source || "") === selSrc);
  const selName = selRadio ? (selRadio.name || selSrc) : selSrc;
  const _sid = ctx.helpers.radioShortId ? ctx.helpers.radioShortId(selSrc) : "";
  detailCard.appendChild(el("div", { class: "bt-panel-head" }, [
    _sid ? chip(el, _sid, "sid", selSrc) : null,
    el("div", { class: "bt-panel-title", style: "font-size:14px" }, selName),
    el("div", { class: "bt-panel-sub" }, "Everything this scanner can hear, strongest first."),
    chip(el, `${_filteredAds.length} ${_quietMode ? "tracked" : "devices"}`, "quiet"),
  ].filter(Boolean)));

  if (!_filteredAds.length) {
    detailCard.appendChild(emptyState(el, "\u25CC",
      _quietMode ? "No tracked devices here" : "Nothing heard yet",
      _quietMode
        ? "Quiet mode only shows devices you have labelled, identified or followed."
        : "This scanner has not reported an advertisement in the current window."));
  } else {
    const tbody = el("tbody");
    for (const a of _filteredAds) {
      const addr = (a.address || "").toUpperCase();
      const obj = objByAddr.get(addr);
      const displayName = obj ? (obj.user_label || obj.name || addr) : (a.name && a.name !== addr ? a.name : addr);
      const kindLabel = obj ? (obj.kind === "private_ble" ? "Private BLE" : obj.kind === "ibeacon" ? "iBeacon" : obj.identified ? "BLE" : "BLE?") : "";
      const kindTone = obj ? (obj.kind === "private_ble" ? "info" : obj.kind === "ibeacon" ? "ok"
                            : obj.identified ? "violet" : "quiet") : "quiet";

      const tr = el("tr", { style: "cursor:pointer" }, [
        el("td", { style: "max-width:220px" }, [
          el("div", { class: "bt-adv-name" }, displayName),
          displayName !== addr ? el("div", { class: "bt-adv-sub" }, addr) : null,
        ].filter(Boolean)),
        el("td", {}, kindLabel ? chip(el, kindLabel, kindTone) : ""),
        // The same meter the advertisement rows use — one reading of "signal"
        // across the view, instead of a percentage bar here and a pill there.
        el("td", { style: "white-space:nowrap" }, sigEl(el, a.rssi)),
        el("td", { class: "bt-age", style: "text-align:left" }, fmtAgo(a.age_s)),
      ]);
      if (obj) {
        tr.addEventListener("click", () => ctx.actions.showObjectDetail(obj));
      }
      tbody.appendChild(tr);
    }
    detailCard.appendChild(el("table", { class: "table" }, [
      el("thead", {}, el("tr", {}, [el("th",{},"Device"), el("th",{},"Kind"), el("th",{},"Signal"), el("th",{},"Age")])),
      tbody,
    ]));
  }

  return el("div", { class: "grid-2" }, [
    el("div", { class: "bt-panel" }, [
      el("div", { class: "bt-panel-head" }, [
        el("div", { class: "bt-panel-title" }, "Scanners"),
        el("div", { class: "bt-panel-sub" }, "Pick one to see what it hears. Each row carries that scanner's own controls."),
        chip(el, `${radios.length}`, "quiet"),
      ]),
      scannerListEl,
    ]),
    detailCard,
  ]);
}

// ── Advertisement Monitor Sub-Tab ────────────────────────────────────────────
// Two-column layout: left panel is a scrollable list of recently seen BLE
// advertisements with enrichment badges (kind, company, services, connectable).
// Right panel shows full detail for the selected advertisement including
// identity, signal info, manufacturer data, service UUIDs, iBeacon fields,
// and a raw JSON toggle. Clicking a row selects it; clicking the Tag button
// opens the label prompt for object tracking.
function renderMonitor(ctx, ads, radios, objIndex) {
  const { el, esc } = ctx.helpers;
  const _rsid = ctx.helpers.radioShortId || (() => "");

  const selected = ctx.state.btSelectedAddr || null;

  if (!ads.length) {
    return emptyState(el, "\u25CC", "No advertisements in this window",
      "Widen Max rows, clear the filters, or give the scanners a moment — BLE devices advertise every few seconds.");
  }

  // ── Display helpers ────────────────────────────────────────────────────────
  // Signal, age and every badge come from the shared vocabulary at the top of
  // this file, so an advertisement here and the same device in the Scanners
  // table read identically.
  const ageText = btAgo;

  // Object kind — one tone each, from the chip palette.
  const kindBadge = kind => {
    if (kind === "entity")      return chip(el, "entity", "good");
    if (kind === "private_ble") return chip(el, "private BLE", "info");
    if (kind === "ibeacon")     return chip(el, "iBeacon", "ok");
    if (kind === "ble")         return chip(el, "BLE", "violet");
    return null;
  };

  // ── Advertisement row renderer ──────────────────────────────────────────────
  // Each row shows: display name, sub-line (address, scanner short ID, room),
  // enrichment badges (kind, company, device type, connectable, services),
  // RSSI pill, age, and a Tag/Relabel button.

  const row = a => {
    const addr = a.address || "";
    const src = a.source || "";
    const xr = a._xref || {};  // Backend cross-reference: label, kind, room, canonical_id, etc.
    const obj = addr ? objIndex.get(String(addr).toUpperCase()) : null;
    const userLabel = xr.label || (obj && obj.user_label) || "";
    const displayName = userLabel || a.name || addr || "Unknown";
    const sid = _rsid(src);  // Short scanner ID (e.g. "S1") for compact display

    // Enrichment badges (inline, compact)
    const badges = [];
    if (xr.kind)          badges.push(kindBadge(xr.kind));
    if (a.company_name)   badges.push(chip(el, a.company_name, "info", "Manufacturer, from the advertisement"));
    if (a.device_type)    badges.push(chip(el, a.device_type, "violet"));
    if (a.connectable)    badges.push(chip(el, "connectable", "good", "This device accepts connections"));

    // Service names (max 3, then a count)
    const svcNames = a.service_names || (obj && obj.service_names) || [];
    for (let i = 0; i < Math.min(3, svcNames.length); i++) {
      badges.push(chip(el, svcNames[i], "accent"));
    }
    if (svcNames.length > 3) {
      badges.push(chip(el, `+${svcNames.length - 3}`, "quiet", svcNames.slice(3).join(", ")));
    }

    // Sub-line: address • scanner • room. The scanner is a short ID chip on the
    // name line now, so it is not repeated here as raw text.
    const subParts = [];
    if (addr) subParts.push(addr);
    if (xr.room) subParts.push(xr.room);
    if (xr.canonical_id) subParts.push("IRK-resolved");
    if (xr.ibeacon_uuid) subParts.push("iBeacon");

    // Use stable identifier for tagging — private BLE uses canonical_id (IRK-derived),
    // iBeacon uses the UUID/major/minor key, because MAC addresses rotate for these types.
    const tagAddr = xr.kind === "private_ble" ? (xr.canonical_id || addr)
                  : xr.kind === "ibeacon"     ? (xr.key || addr)
                  : addr;
    const tagBtn = el("button", { class: "btn tiny" }, userLabel ? "Relabel" : "Tag");
    tagBtn.addEventListener("click", e => { e.stopPropagation(); ctx.actions.tagObjectPrompt(tagAddr, userLabel); });

    const mainDiv = el("div", { class: "bt-adv-main", style: "min-width:0;flex:1" }, [
      el("div", { style: "display:flex;align-items:center;gap:6px;min-width:0" }, [
        sid ? chip(el, sid, "sid", `Heard by ${src}`) : null,
        el("div", { class: "bt-adv-name" }, displayName),
      ].filter(Boolean)),
      el("div", { class: "bt-adv-sub" }, subParts.join(" \u00b7 ")),
    ]);
    if (badges.length) {
      mainDiv.appendChild(el("div", { class: "bt-chips" }, badges.filter(Boolean)));
    }

    return el("div", {
      class: "bt-adv-row" + (selected === addr ? " active" : ""),
      style: "display:flex;justify-content:space-between;align-items:center;gap:10px;cursor:pointer",
      onclick: () => { ctx.state.btSelectedAddr = selected === addr ? null : addr; ctx.actions.renderRooms(); },
    }, [
      mainDiv,
      el("div", { class: "bt-adv-right" }, [
        sigEl(el, a.rssi),
        el("span", { class: "bt-age", title: "Last heard" }, ageText(a.age_s)),
        tagBtn,
      ]),
    ]);
  };

  // ── Detail panel (right column) ────────────────────────────────────────────
  // Shows full inspection of the selected advertisement: identity, signal,
  // manufacturer data, service UUIDs/data, iBeacon fields, and raw JSON toggle.
  const details = (() => {
    if (!selected) return null;
    const a = ads.find(x => x && String(x.address || "") === selected) || null;
    if (!a) return null;
    const xr = a._xref || {};
    const obj = objIndex.get(selected.toUpperCase()) || null;
    const card = el("div", { class: "bt-panel" });

    // Header: the name, its kind, and how strongly it is being heard right now
    const hdrName = xr.label || a.name || selected;
    card.appendChild(el("div", { style: "display:flex;align-items:center;gap:10px;flex-wrap:wrap" }, [
      el("div", { style: "font-size:15px;font-weight:800;letter-spacing:-.01em;flex:1;min-width:0;word-break:break-word" }, hdrName),
      sigEl(el, a.rssi),
    ]));
    if (xr.kind) card.appendChild(el("div", { class: "bt-chips" }, [kindBadge(xr.kind)]));

    // Section helper — a titled definition list, empty values skipped.
    // Addresses, UUIDs and hex get the mono treatment so they can be READ.
    const _MONO = /address|uuid|id$|ID$|data|key|major|minor/;
    const section = (title, rows) => {
      const s = el("div", {});
      s.appendChild(el("div", { class: "bt-kv-title" }, title));
      const dl = el("dl", { class: "bt-kv" });
      for (const [k, v] of rows) {
        if (v === null || v === undefined || v === "") continue;
        dl.appendChild(el("dt", {}, k));
        dl.appendChild(el("dd", { class: _MONO.test(k) ? "mono-val" : "" }, String(v)));
      }
      s.appendChild(dl);
      return s;
    };

    // Identity
    const idRows = [
      ["Address", a.address],
      ["Name", a.name || "\u2014"],
      ["User Label", xr.label || (obj?.user_label) || "\u2014"],
      ["Object Kind", xr.kind || "untracked"],
    ];
    if (xr.canonical_id) idRows.push(["Canonical ID", xr.canonical_id]);
    if (xr.entity_id)    idRows.push(["HA Entity", xr.entity_id]);
    if (xr.all_addresses && xr.all_addresses.length > 1) {
      idRows.push(["All Addresses", xr.all_addresses.join(", ")]);
    }
    if (xr.room) idRows.push(["Room", xr.room]);
    card.appendChild(section("Identity", idRows));

    // Signal
    const sigRows = [
      ["RSSI", a.rssi != null ? `${a.rssi} dBm` : "\u2014"],
      ["TX Power", a.tx_power != null ? `${a.tx_power} dBm` : "\u2014"],
      ["Age", ageText(a.age_s)],
      ["Scanner", (_rsid(a.source) ? _rsid(a.source) + " " : "") + (a.source || "\u2014")],
      ["Connectable", a.connectable ? "Yes" : "No"],
    ];
    card.appendChild(section("Signal", sigRows));

    // Manufacturer
    const md = a.manufacturer_data || {};
    const mdKeys = Object.keys(md);
    if (mdKeys.length || a.company_name || a.device_type) {
      const mfRows = [
        ["Company", a.company_name || "\u2014"],
        ["Device Type", a.device_type || "\u2014"],
      ];
      for (const cid of mdKeys) {
        mfRows.push(["Manuf ID " + cid, md[cid]]);
      }
      card.appendChild(section("Manufacturer", mfRows));
    }

    // Services
    const svcUuids = a.service_uuids || [];
    const svcMap = a.service_uuid_map || {};
    if (svcUuids.length) {
      const svcRows = svcUuids.map(u => [u, svcMap[u] || "Unknown service"]);
      card.appendChild(section("Services (" + svcUuids.length + ")", svcRows));
    }

    // Service data
    const sd = a.service_data || {};
    const sdKeys = Object.keys(sd);
    if (sdKeys.length) {
      const sdRows = sdKeys.map(k => [svcMap[k] || k, sd[k]]);
      card.appendChild(section("Service Data", sdRows));
    }

    // iBeacon
    if (xr.ibeacon_uuid) {
      card.appendChild(section("iBeacon", [
        ["UUID", xr.ibeacon_uuid],
        ["Major", xr.ibeacon_major],
        ["Minor", xr.ibeacon_minor],
      ]));
    }

    // Raw JSON (collapsible)
    const rawToggle = el("button", { class: "btn tiny", style: "margin-top:12px" }, "Show raw JSON");
    const rawPre = el("pre", { class: "pre", style: "display:none;margin-top:6px" }, esc(JSON.stringify(a, null, 2)));
    rawToggle.addEventListener("click", () => {
      const vis = rawPre.style.display !== "none";
      rawPre.style.display = vis ? "none" : "block";
      rawToggle.textContent = vis ? "Show raw JSON" : "Hide raw JSON";
    });
    card.appendChild(rawToggle);
    card.appendChild(rawPre);

    // Link to full object detail modal if this address is in the tracked objects list
    const snap = ctx.state.live?.snapshot;
    const matchedObj = (snap?.objects?.list||[]).find(o =>
      o.address && o.address.toUpperCase() === selected.toUpperCase()
    );
    if (matchedObj) {
      card.appendChild(el("button", { class: "btn inline", style: "margin-top:8px",
        onclick: () => ctx.actions.showObjectDetail(matchedObj)
      }, "Full object details"));
    }

    return card;
  })();

  // Quiet mode: filter ad list to only tracked/identified devices
  const _qm = !!(ctx.state.settings && ctx.state.settings.quiet_mode);
  const _monitorAds = _qm
    ? ads.filter(a => {
        const addr = String(a.address || "").toUpperCase();
        const xr = a._xref || {};
        const obj = addr ? objIndex.get(addr) : null;
        if (xr.label || (obj && (obj.user_label || obj.identified))) return true;
        if (ctx.actions.followedHas && ctx.actions.followedHas(addr)) return true;
        return false;
      })
    : ads;

  return el("div", { class: "grid-2" }, [
    el("div", { class: "bt-panel" }, [
      el("div", { class: "bt-panel-head" }, [
        el("div", { class: "bt-panel-title" }, "Advertisements"),
        el("div", { class: "bt-panel-sub" }, _qm
          ? "Tracked devices only — quiet mode is on. Click a row to inspect it."
          : "Click a row to inspect it: decoded manufacturer, services and any tracked object it belongs to."),
        el("span", { class: "bt-chip quiet" }, `${_monitorAds.length} shown`),
      ]),
      _monitorAds.length
        ? el("div", { class: "bt-list bt-adv-list list-scroll" }, _monitorAds.map(row))
        : emptyState(el, "\u25CC", "Nothing matches",
            _qm ? "Quiet mode hides everything untracked. Turn it off in the top bar to see the rest."
                : "No advertisement matches the current search and scanner filter."),
    ]),
    details || el("div", { class: "bt-panel" }, [
      el("div", { class: "bt-panel-head" }, [el("div", { class: "bt-panel-title" }, "Details")]),
      emptyState(el, "\u2190", "Nothing selected",
        "Pick an advertisement on the left to see its identity, signal, manufacturer data and services."),
    ]),
  ]);
}

// ── Visualization Sub-Tab ────────────────────────────────────────────────────
// Renders an SVG bipartite graph: scanners on the left, devices on the right,
// with lines connecting each device to the scanner that reported it.
//
// Layout (left to right):
//   [Scanner labels]  (circle)────line────(circle)  [Device labels]
//
// Lines are color-coded by RSSI strength (good/ok/bad). Labels are rendered
// as clickable blue text with underlines — clicking a scanner opens the scanner
// detail modal, clicking a device opens the object detail modal.
//
// SVG is built as an innerHTML string (not createElement) because
// document.createElement in HTML namespace produces invisible SVG elements
// in HA WebViews. Event delegation on the wrapper div handles clicks by
// walking up from the click target to find the nearest <g data-type="...">.
function renderVisualization(ctx, radios, ads, objIndex) {
  const { el } = ctx.helpers;

  if (!radios.length && !ads.length) {
    return emptyState(el, "\u25CC", "Nothing to draw yet",
      "Waiting for the scanner list and the first advertisements. If this stays empty, the Health tab will say why.");
  }

  // ── SVG coordinate system ─────────────────────────────────────────────────
  // Fixed width, dynamic height based on device count.
  // Scanner labels left-aligned at scannerLabelX, scanner circles at scannerNodeX.
  // Device circles at deviceNodeX, device labels right-aligned at deviceLabelX.
  const w = 920;
  const pad = 24;
  const scannerLabelX = pad + 10;          // labels start here (left-aligned)
  const scannerNodeX = pad + 300;          // scanner circles — more room for labels
  const deviceNodeX = w - pad - 300;       // device circles — more room for labels
  const deviceLabelX = w - pad - 10;       // device labels end here

  // Deduplicated sorted scanner source IDs, with index for positional lookups
  const srcs = Array.from(new Set(radios.map(r => String(r.source || "")).filter(Boolean))).sort();
  const srcIndex = new Map(srcs.map((s, i) => [s, i]));

  // Exclude scanner-to-scanner detections — scanners advertising to each other
  // would create noise in the device column without adding useful information.
  const _isScanner = ctx.helpers.isScanner || (() => false);
  const filteredAds = ads.filter(a => {
    const addr = String(a.address || "").toUpperCase();
    return !_isScanner({address: addr, name: a.name || ""});
  });

  // Group devices by source
  const bySrc = {};
  for (const a of filteredAds) {
    const src = String(a.source || "");
    if (!bySrc[src]) bySrc[src] = [];
    bySrc[src].push(a);
  }

  // ── Dynamic SVG height calculation ─────────────────────────────────────────
  // 16px per device row, minimum 460px, must also fit all scanners at 20px apart.
  const DEV_ROW_H = 16;
  const totalDevCount = Object.values(bySrc).reduce((sum, arr) => sum + Math.min(arr.length, 24), 0);
  const scannerMinH = srcs.length * 20 + pad * 2 + 40;
  let h = Math.max(460, totalDevCount * DEV_ROW_H + pad * 3 + 30, scannerMinH);

  // ── Scanner node placement (left column) ───────────────────────────────────
  // Initial pass: evenly spaced. After devices are placed, scanners are
  // repositioned to the vertical center of their device cluster for visual clarity.
  const _vizSid = ctx.helpers.radioShortId || (() => "");
  const scannerNodes = srcs.map((src, i) => {
    const y = pad + 20 + (i + 1) * ((h - pad * 2 - 20) / (srcs.length + 1));
    const sid = _vizSid(src);
    const name = radios.find(r => String(r.source || "") === src)?.name || src;
    return { id: src, label: (sid ? "[" + sid + "] " : "") + name, x: scannerNodeX, y };
  });

  // ── Device node placement (right column) ───────────────────────────────────
  // Devices are placed vertically near their reporting scanner (centered on
  // the scanner's Y position), capped at 24 per scanner to prevent overflow.
  // Rich labels include: user label or name, room, and RSSI in parentheses.
  const deviceNodes = [];
  for (const src of Object.keys(bySrc)) {
    const sIdx = srcIndex.has(src) ? srcIndex.get(src) : -1;
    const base = scannerNodes[Math.max(0, sIdx)] || { x: scannerNodeX, y: h / 2 };
    const list = bySrc[src].slice(0, 24);
    const blockH = list.length * DEV_ROW_H;
    const startY = base.y - blockH / 2;
    const _quietMode = !!(ctx.state.settings && ctx.state.settings.quiet_mode);
    for (let i = 0; i < list.length; i++) {
      const a = list[i];
      const addr = String(a.address || a.name || `${src}-${i}`);
      const obj = objIndex.get(addr.toUpperCase());
      // Quiet mode: only show identified/labeled/followed devices
      if (_quietMode && (!obj || (!obj.user_label && !obj.identified)) && !(ctx.actions.followedHas && ctx.actions.followedHas(addr))) continue;
      // Build a rich label: prefer user_label > object name > ad name > address
      let devLabel = "";
      if (obj) {
        devLabel = obj.user_label || obj.name || a.name || addr;
        const room = obj.room || a.area_name || "";
        if (room) devLabel += ` · ${room}`;
      } else {
        devLabel = a.name || addr;
        if (a.area_name) devLabel += ` · ${a.area_name}`;
      }
      if (a.rssi != null) devLabel += ` (${a.rssi})`;
      deviceNodes.push({
        id: addr,
        label: devLabel,
        x: deviceNodeX,
        y: startY + i * DEV_ROW_H,
        src,
        rssi: a.rssi,
      });
    }
  }

  // ── Overlap resolution ─────────────────────────────────────────────────────
  // Sort devices by Y, then push overlapping nodes apart to ensure minimum gap.
  // If the column overflows the bottom, shift the entire block up; if the top
  // overflows after shifting, clamp and accept that we need more height.
  deviceNodes.sort((a, b) => a.y - b.y);
  const MIN_GAP = DEV_ROW_H;
  for (let i = 1; i < deviceNodes.length; i++) {
    const gap = deviceNodes[i].y - deviceNodes[i - 1].y;
    if (gap < MIN_GAP) deviceNodes[i].y = deviceNodes[i - 1].y + MIN_GAP;
  }
  // If devices overflow the bottom, shift entire column up as a block
  if (deviceNodes.length) {
    const lastDevY = deviceNodes[deviceNodes.length - 1].y;
    const maxDevY = h - pad - 10;
    if (lastDevY > maxDevY) {
      const shift = lastDevY - maxDevY;
      for (const d of deviceNodes) d.y -= shift;
    }
    // If top overflows after shifting, clamp top and accept that we need more height
    const topMin = pad + 20;
    if (deviceNodes[0].y < topMin) {
      const shift = topMin - deviceNodes[0].y;
      for (const d of deviceNodes) d.y += shift;
    }
  }

  // Reposition each scanner to the vertical center of its device cluster —
  // this makes the connecting lines fan out symmetrically from the scanner node.
  for (const sn of scannerNodes) {
    const myDevs = deviceNodes.filter(d => d.src === sn.id);
    if (myDevs.length) {
      const minY = Math.min(...myDevs.map(d => d.y));
      const maxY = Math.max(...myDevs.map(d => d.y));
      sn.y = (minY + maxY) / 2;
    }
  }
  // Resolve scanner overlaps (minimum 20px apart — matches label font size)
  const SCAN_GAP = 20;
  scannerNodes.sort((a, b) => a.y - b.y);
  for (let i = 1; i < scannerNodes.length; i++) {
    if (scannerNodes[i].y - scannerNodes[i - 1].y < SCAN_GAP) {
      scannerNodes[i].y = scannerNodes[i - 1].y + SCAN_GAP;
    }
  }
  // If scanners overflow the bottom, shift them all up as a block
  if (scannerNodes.length) {
    const lastY = scannerNodes[scannerNodes.length - 1].y;
    const maxY = h - pad - 10;
    if (lastY > maxY) {
      const shift = lastY - maxY;
      for (const sn of scannerNodes) sn.y -= shift;
    }
    // Clamp top edge
    const topMin = pad + 20;
    if (scannerNodes[0].y < topMin) {
      const shift = topMin - scannerNodes[0].y;
      for (const sn of scannerNodes) sn.y += shift;
    }
  }

  // Expand SVG height if nodes extend beyond the initial estimate
  const allYs = [...deviceNodes.map(d => d.y), ...scannerNodes.map(s => s.y)];
  if (allYs.length) {
    const neededH = Math.max(...allYs) + pad + 20;
    if (neededH > h) h = neededH;
  }

  // RSSI CSS class for line color: good (green), ok (amber), bad (red)
  const rssiClass = rssi => {
    const v = Number(rssi);
    if (!isFinite(v)) return "rssi-unk";
    if (v >= -60) return "rssi-good";
    if (v >= -80) return "rssi-ok";
    return "rssi-bad";
  };

  // ── SVG rendering (innerHTML string approach) ─────────────────────────────
  // Must use innerHTML, not document.createElement, because SVG elements
  // created in the HTML namespace are invisible in HA's WebView.
  // Embedded <style> provides hover effects: labels turn teal, circles glow.
  let s = `<svg class="bt-viz" viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg">`;
  // Only the cursor and the hover reaction live here; every colour is in
  // styles.css (#bluetooth .bt-viz-*), so the graph cannot drift from the
  // rest of the view — the two used to disagree about what a label looks like.
  s += `<style>.bt-viz-click{cursor:pointer}`
    + `.bt-viz-click:hover text.bt-viz-label{fill:#5eead4}`
    + `.bt-viz-click:hover circle{opacity:.85;stroke:#5eead4;stroke-width:2}</style>`;

  // Lines first (back layer) — RSSI-colored connections between scanner and device circles
  for (const d of deviceNodes) {
    const sn = scannerNodes.find(n => n.id === d.src);
    if (!sn) continue;
    const rc = rssiClass(d.rssi);
    s += `<line x1="${sn.x + 10}" y1="${sn.y}" x2="${d.x - 10}" y2="${d.y}" class="bt-viz-line ${rc}"/>`;
  }

  // Truncate helper — keeps SVG text from overflowing
  const MAX_LABEL = 38;
  const trunc = (s) => s.length > MAX_LABEL ? s.slice(0, MAX_LABEL - 1) + "…" : s;

  // ── Click handlers ──────────────────────────────────────────────────────────
  // Store callbacks keyed by index. After innerHTML parse, we attach click
  // listeners directly to each <g> via querySelectorAll — no event delegation
  // or node.id lookup needed. This avoids SVGAnimatedString issues in WebViews
  // where node.id on SVG elements may return an object instead of a string.
  const _scannerClicks = [];  // index → callback
  const _deviceClicks = [];   // index → callback

  // ── Scanner nodes + labels (left column) ───────────────────────────────────
  // Labels are right-aligned just before the circle (text-anchor:end) so the
  // gap matches the device side (~10px between text edge and circle edge).
  for (let si = 0; si < scannerNodes.length; si++) {
    const sn = scannerNodes[si];
    const textX = sn.x - 12;  // 12px left of circle centre (7r + 5px gap)
    const lblText = trunc(sn.label);
    s += `<g data-vs="${si}" class="bt-viz-click" style="cursor:pointer">`;
    s += `<rect x="${Math.max(0, textX - 280)}" y="${sn.y - 12}" width="${280 + 24}" height="24" fill="rgba(0,0,0,0)" pointer-events="all"/>`;
    s += `<circle cx="${sn.x}" cy="${sn.y}" r="7" class="bt-viz-node scanner" pointer-events="all"/>`;
    s += `<text x="${textX}" y="${sn.y}" class="bt-viz-label" text-anchor="end" dominant-baseline="middle" pointer-events="all">${_escSvg(lblText)}</text>`;
    s += `</g>`;
    _scannerClicks[si] = () => {
      const radio = radios.find(r => String(r.source || "") === sn.id);
      if (radio) {
        ctx.actions.showScannerDetail(radio);
      } else {
        // Fallback: construct a minimal scanner object from available data
        ctx.actions.showScannerDetail({ source: sn.id, name: sn.label.replace(/^\[\w+\]\s*/, "") });
      }
    };
  }

  // ── Device nodes + labels (right column) ───────────────────────────────────
  for (let di = 0; di < deviceNodes.length; di++) {
    const d = deviceNodes[di];
    const rc = rssiClass(d.rssi);
    s += `<g data-vd="${di}" class="bt-viz-click" style="cursor:pointer">`;
    s += `<rect x="${d.x - 8}" y="${d.y - 9}" width="${deviceLabelX - d.x + 18}" height="18" fill="rgba(0,0,0,0)" pointer-events="all"/>`;
    s += `<circle cx="${d.x}" cy="${d.y}" r="5" class="bt-viz-node device ${rc}" pointer-events="all"/>`;
    s += `<text x="${d.x + 10}" y="${d.y}" class="bt-viz-label" font-size="11" text-anchor="start" dominant-baseline="middle" pointer-events="all">${_escSvg(trunc(d.label))}</text>`;
    s += `</g>`;
    _deviceClicks[di] = () => {
      const obj = objIndex.get(d.id.toUpperCase());
      if (obj) {
        ctx.actions.showObjectDetail(obj);
      } else {
        const ad = ads.find(a => String(a.address || "") === d.id || String(a.name || "") === d.id);
        if (ad) {
          ctx.actions.showObjectDetail({
            address: ad.address || d.id,
            name: ad.name || ad.address || d.id,
            kind: "ble",
            room: ad.area_name || "",
            rssi: ad.rssi,
            source: ad.source || "",
          });
        }
      }
    };
  }

  // Column titles at the top of the SVG
  s += `<text x="${scannerNodeX - 12}" y="${pad}" class="bt-viz-title" text-anchor="end" dominant-baseline="middle">Scanners</text>`;
  s += `<text x="${deviceNodeX + 10}" y="${pad}" class="bt-viz-title" text-anchor="start" dominant-baseline="middle">Devices</text>`;

  s += `</svg>`;

  const svgWrap = document.createElement("div");
  svgWrap.innerHTML = s;

  // ── Click handlers: use requestAnimationFrame to attach AFTER DOM render ────
  // All previous attempts to attach clicks during render failed because SVG
  // elements parsed via innerHTML may not be fully queryable until the next
  // frame. We schedule attachment to run after the browser has processed the DOM.
  requestAnimationFrame(() => {
    try {
      // Try querySelectorAll first (works in most browsers)
      const gEls = svgWrap.querySelectorAll("g[data-vs], g[data-vd]");
      if (gEls.length > 0) {
        gEls.forEach(g => {
          const vs = g.getAttribute("data-vs");
          const vd = g.getAttribute("data-vd");
          if (vs != null) {
            const idx = parseInt(vs, 10);
            if (_scannerClicks[idx]) g.addEventListener("click", (e) => { e.stopPropagation(); _scannerClicks[idx](); });
          }
          if (vd != null) {
            const idx = parseInt(vd, 10);
            if (_deviceClicks[idx]) g.addEventListener("click", (e) => { e.stopPropagation(); _deviceClicks[idx](); });
          }
        });
      } else {
        // Fallback: walk ALL elements manually
        const all = svgWrap.getElementsByTagName("*");
        for (let i = 0; i < all.length; i++) {
          const el = all[i];
          let vs = null, vd = null;
          try { vs = el.getAttribute("data-vs"); } catch(_){}
          try { vd = el.getAttribute("data-vd"); } catch(_){}
          if (vs != null && vs !== "") {
            const idx = parseInt(String(vs), 10);
            if (!isNaN(idx) && _scannerClicks[idx]) {
              el.addEventListener("click", (e) => { e.stopPropagation(); _scannerClicks[idx](); });
            }
          }
          if (vd != null && vd !== "") {
            const idx = parseInt(String(vd), 10);
            if (!isNaN(idx) && _deviceClicks[idx]) {
              el.addEventListener("click", (e) => { e.stopPropagation(); _deviceClicks[idx](); });
            }
          }
        }
      }
    } catch(err) { console.warn("PadSpan: BT viz click attach failed", err); }
  });

  return el("div", { class: "bt-panel" }, [
    el("div", { class: "bt-panel-head" }, [
      el("div", { class: "bt-panel-title" }, "Who hears what"),
      el("div", { class: "bt-panel-sub" },
        "Each line is one scanner hearing one device; its colour is how strongly. Click either end for details."),
      el("span", { class: "bt-chip quiet" }, `${scannerNodes.length} \u00d7 ${deviceNodes.length}`),
    ]),
    svgWrap,
    el("div", { class: "muted", style: "margin-top:10px;font-size:11.5px" },
      "Narrow it with the scanner and search filters above."),
  ]);
}

// ── ESPHome Config Library ─────────────────────────────────────────────────────
// Static array of optimized ESPHome YAML configurations for each ESP32 variant.
// Each entry has: full standalone YAML, a "minimal" snippet for adding to existing
// configs, chip/connection metadata, and human-readable notes.
// Ordered by recommendation: S3 Ethernet (best) → C6 WiFi → S3 WiFi → Minimal → C3 (worst).

const ESPHOME_CONFIGS = [
  {
    id: "s3_ethernet",
    chip: "ESP32-S3",
    connection: "Ethernet",
    badge: "Maximum performance",
    badgeColor: "#06b6d4",
    description: "Dual-core S3 with wired Ethernet. No WiFi means the radio is 100% available for BLE. Highest possible scan duty at 93.75%. Best for dedicated scanner deployments.",
    notes: [
      "Scan duty 93.75% (300 ms window / 320 ms interval) — the maximum",
      "No WiFi contention — the BLE radio has the full RF budget",
      "Ethernet: rock-solid connection, no WiFi dropouts",
      "Adjust the ethernet: section for your board (W5500, LAN8720, etc.)",
    ],
    yaml: `# PadSpan — ESP32-S3 Ethernet Scanner (maximum performance)
# Scan duty 93.75%. No WiFi = BLE radio has full RF budget.
# Adjust ethernet platform/pins for your board (W5500 SPI shown below).

esphome:
  name: padspan-s3-eth
  friendly_name: "PadSpan S3 Ethernet"

esp32:
  board: esp32-s3-devkitc-1
  framework:
    type: esp-idf

# ── Ethernet (W5500 SPI example — adjust pins for your board) ──────
ethernet:
  type: W5500
  clk_pin: GPIO12
  mosi_pin: GPIO11
  miso_pin: GPIO13
  cs_pin: GPIO10
  interrupt_pin: GPIO14
  reset_pin: GPIO15

api:
  encryption:
    key: !secret api_key

esp32_ble_tracker:
  scan_parameters:
    interval: 320ms
    window: 300ms                 # 93.75% duty — maximum scan coverage
    active: false
    continuous: true

bluetooth_proxy:
  active: false

# ── Diagnostic sensors ──────────────────────────────────────────────
sensor:
  - platform: internal_temperature
    name: "CPU Temperature"
    update_interval: 60s
  - platform: uptime
    name: "Uptime"
    update_interval: 60s

text_sensor:
  - platform: ethernet_info
    ip_address:
      name: "IP Address"`,
    minimal: `# ── Add to your existing ESP32-S3 Ethernet ESPHome config ──────────
# Paste these sections into your YAML. If you already have sensor:
# or text_sensor: sections, merge the entries under the existing key.

esp32_ble_tracker:
  scan_parameters:
    interval: 320ms
    window: 300ms                 # 93.75% — max duty (no WiFi contention)
    active: false
    continuous: true

bluetooth_proxy:
  active: false

sensor:
  - platform: internal_temperature
    name: "CPU Temperature"
    update_interval: 60s
  - platform: uptime
    name: "Uptime"
    update_interval: 60s

text_sensor:
  - platform: ethernet_info
    ip_address:
      name: "IP Address"`,
  },
  {
    id: "c6_wifi",
    chip: "ESP32-C6",
    connection: "WiFi 6",
    badge: "BLE 5.3 + Wi-Fi 6",
    badgeColor: "#8b5cf6",
    description: "Single-core RISC-V with BLE 5.3 and Wi-Fi 6 (802.11ax). Better coexistence than C3 but still single-core — same scan duty limits apply.",
    notes: [
      "Scan duty ~31% (100 ms window / 320 ms interval)",
      "Wi-Fi 6 improves coexistence vs C3, but single-core still limits duty",
      "BLE 5.3 hardware — ESPHome does not yet expose Coded PHY scanning",
    ],
    yaml: `# PadSpan — ESP32-C6 WiFi 6 Scanner (optimised)
# Scan duty ~31%. Wi-Fi 6 + BLE 5.3 hardware, single-core RISC-V.

esphome:
  name: padspan-c6-wifi
  friendly_name: "PadSpan C6 WiFi"

esp32:
  board: esp32-c6-devkitc-1
  framework:
    type: esp-idf

wifi:
  ssid: !secret wifi_ssid
  password: !secret wifi_password
  power_save_mode: LIGHT
  output_power: 20dB
  fast_connect: true

api:
  encryption:
    key: !secret api_key
  on_client_connected:
    - esp32_ble_tracker.start_scan:
        continuous: true
  on_client_disconnected:
    - esp32_ble_tracker.stop_scan:

esp32_ble_tracker:
  scan_parameters:
    interval: 320ms
    window: 100ms                 # ~31% duty — single-core safe
    active: false

bluetooth_proxy:
  active: false

# ── Diagnostic sensors ──────────────────────────────────────────────
sensor:
  - platform: wifi_signal
    name: "WiFi Signal"
    update_interval: 30s
  - platform: internal_temperature
    name: "CPU Temperature"
    update_interval: 60s
  - platform: uptime
    name: "Uptime"
    update_interval: 60s

text_sensor:
  - platform: wifi_info
    ip_address:
      name: "IP Address"
    ssid:
      name: "WiFi SSID"
    bssid:
      name: "WiFi BSSID"
    mac_address:
      name: "MAC Address"`,
    minimal: `# ── Add to your existing ESP32-C6 ESPHome config ──────────────────
# Paste these sections. Single-core: add the on_client_connected
# block under your existing api: key to gate BLE on API connection.
# If you already have sensor:/text_sensor: sections, merge entries.

# Add under your existing api: section:
#  on_client_connected:
#    - esp32_ble_tracker.start_scan:
#        continuous: true
#  on_client_disconnected:
#    - esp32_ble_tracker.stop_scan:

esp32_ble_tracker:
  scan_parameters:
    interval: 320ms
    window: 100ms                 # ~31% duty — single-core safe
    active: false

bluetooth_proxy:
  active: false

sensor:
  - platform: wifi_signal
    name: "WiFi Signal"
    update_interval: 30s
  - platform: internal_temperature
    name: "CPU Temperature"
    update_interval: 60s
  - platform: uptime
    name: "Uptime"
    update_interval: 60s

text_sensor:
  - platform: wifi_info
    ip_address:
      name: "IP Address"
    ssid:
      name: "WiFi SSID"
    bssid:
      name: "WiFi BSSID"
    mac_address:
      name: "MAC Address"`,
  },
  {
    id: "s3_wifi",
    chip: "ESP32-S3",
    connection: "WiFi",
    badge: "Dual-core — best WiFi",
    badgeColor: "#10b981",
    description: "Dual-core Xtensa with PSRAM. BLE runs on core 1 while WiFi runs on core 0, so continuous scanning is safe. Best general-purpose WiFi scanner.",
    notes: [
      "Scan duty ~31% (100 ms window / 320 ms interval) — WiFi still needs airtime",
      "Dual-core: BLE and WiFi run on separate cores — no watchdog risk",
      "continuous: true is safe on S3 (not on C3/C6)",
      "PSRAM available — handles large advertisement caches",
    ],
    yaml: `# PadSpan — ESP32-S3 WiFi Scanner (optimised)
# Dual-core: BLE on core 1, WiFi on core 0. Best WiFi scanner.

esphome:
  name: padspan-s3-wifi
  friendly_name: "PadSpan S3 WiFi"

esp32:
  board: esp32-s3-devkitc-1
  framework:
    type: esp-idf

wifi:
  ssid: !secret wifi_ssid
  password: !secret wifi_password
  power_save_mode: LIGHT
  output_power: 20dB
  fast_connect: true

api:
  encryption:
    key: !secret api_key

esp32_ble_tracker:
  scan_parameters:
    interval: 320ms
    window: 100ms                 # ~31% — WiFi still needs airtime
    active: false
    continuous: true              # safe on dual-core S3

bluetooth_proxy:
  active: false

# ── Diagnostic sensors ──────────────────────────────────────────────
sensor:
  - platform: wifi_signal
    name: "WiFi Signal"
    update_interval: 30s
  - platform: internal_temperature
    name: "CPU Temperature"
    update_interval: 60s
  - platform: uptime
    name: "Uptime"
    update_interval: 60s

text_sensor:
  - platform: wifi_info
    ip_address:
      name: "IP Address"
    ssid:
      name: "WiFi SSID"
    bssid:
      name: "WiFi BSSID"
    mac_address:
      name: "MAC Address"`,
    minimal: `# ── Add to your existing ESP32-S3 WiFi ESPHome config ─────────────
# Paste these sections into your YAML. If you already have sensor:
# or text_sensor: sections, merge the entries under the existing key.

esp32_ble_tracker:
  scan_parameters:
    interval: 320ms
    window: 100ms                 # ~31% — WiFi still needs airtime
    active: false
    continuous: true              # safe on dual-core S3

bluetooth_proxy:
  active: false

sensor:
  - platform: wifi_signal
    name: "WiFi Signal"
    update_interval: 30s
  - platform: internal_temperature
    name: "CPU Temperature"
    update_interval: 60s
  - platform: uptime
    name: "Uptime"
    update_interval: 60s

text_sensor:
  - platform: wifi_info
    ip_address:
      name: "IP Address"
    ssid:
      name: "WiFi SSID"
    bssid:
      name: "WiFi BSSID"
    mac_address:
      name: "MAC Address"`,
  },
  {
    id: "passive_minimal",
    chip: "Any ESP32",
    connection: "WiFi",
    badge: "Minimal / passive",
    badgeColor: "#94a3b8",
    description: "A stripped-down passive-only scanner that works on any ESP32 variant. Good starting point if you are unsure which board you have.",
    notes: [
      "Works on C3, C6, S3, and original ESP32",
      "Passive scanning only — less accurate name resolution but lower power",
      "Conservative 31% duty cycle — safe for any chip",
    ],
    yaml: `# PadSpan — Minimal Passive Scanner (any ESP32)
# Conservative settings that work on every ESP32 variant.

esphome:
  name: padspan-scanner
  friendly_name: "PadSpan Scanner"

esp32:
  board: esp32dev                 # change to your board
  framework:
    type: esp-idf

wifi:
  ssid: !secret wifi_ssid
  password: !secret wifi_password
  power_save_mode: LIGHT
  fast_connect: true

api:
  encryption:
    key: !secret api_key

esp32_ble_tracker:
  scan_parameters:
    interval: 320ms
    window: 100ms
    active: false
    continuous: true

bluetooth_proxy:
  active: false

# ── Diagnostic sensors ──────────────────────────────────────────────
sensor:
  - platform: wifi_signal
    name: "WiFi Signal"
    update_interval: 30s
  - platform: uptime
    name: "Uptime"
    update_interval: 60s

text_sensor:
  - platform: wifi_info
    ip_address:
      name: "IP Address"
    ssid:
      name: "WiFi SSID"`,
    minimal: `# ── Add to any existing ESP32 ESPHome config ─────────────────────
# Paste these sections into your YAML. Works on any ESP32 variant.
# If you already have sensor:/text_sensor: sections, merge entries.

esp32_ble_tracker:
  scan_parameters:
    interval: 320ms
    window: 100ms
    active: false
    continuous: true

bluetooth_proxy:
  active: false

sensor:
  - platform: wifi_signal
    name: "WiFi Signal"
    update_interval: 30s
  - platform: uptime
    name: "Uptime"
    update_interval: 60s

text_sensor:
  - platform: wifi_info
    ip_address:
      name: "IP Address"
    ssid:
      name: "WiFi SSID"`,
  },
  {
    id: "c3_wifi",
    chip: "ESP32-C3",
    connection: "WiFi",
    badge: "Not recommended",
    badgeColor: "#ef4444",
    description: "Single-core RISC-V. BLE and WiFi share the same core and radio — scan duty is low and real-world performance is worse than specs suggest. Use this config if you already own C3 boards, but buy S3 or C6 for new scanners.",
    notes: [
      "Scan duty ~31% nominal, but WiFi interruptions drop real duty to ~20-25%",
      "Single-core — BLE scanning blocks WiFi, causing missed advertisements",
      "Watchdog reset risk under heavy WiFi traffic — requires API-gated workaround",
      "Put C3 boards in low-priority rooms (hallways, garage) where missed readings matter less",
    ],
    yaml: `# PadSpan — ESP32-C3 WiFi Scanner
# NOT RECOMMENDED for new purchases. Use S3 or C6 instead.
# Single-core: BLE and WiFi compete for the same core and radio.
# This config gates scanning on API connection to prevent watchdog resets.

esphome:
  name: padspan-c3-wifi
  friendly_name: "PadSpan C3 WiFi"

esp32:
  board: esp32-c3-devkitm-1
  framework:
    type: esp-idf

wifi:
  ssid: !secret wifi_ssid
  password: !secret wifi_password
  power_save_mode: LIGHT
  output_power: 20dB
  fast_connect: true

api:
  encryption:
    key: !secret api_key
  on_client_connected:
    - esp32_ble_tracker.start_scan:
        continuous: true
  on_client_disconnected:
    - esp32_ble_tracker.stop_scan:

esp32_ble_tracker:
  scan_parameters:
    interval: 320ms
    window: 100ms                 # ~31% duty — safe for single-core WiFi
    active: false

bluetooth_proxy:
  active: false

# ── Diagnostic sensors (PadSpan reads these automatically) ──────────
sensor:
  - platform: wifi_signal
    name: "WiFi Signal"
    update_interval: 30s
  - platform: internal_temperature
    name: "CPU Temperature"
    update_interval: 60s
  - platform: uptime
    name: "Uptime"
    update_interval: 60s

text_sensor:
  - platform: wifi_info
    ip_address:
      name: "IP Address"
    ssid:
      name: "WiFi SSID"
    bssid:
      name: "WiFi BSSID"
    mac_address:
      name: "MAC Address"`,
    minimal: `# ── Add to your existing ESP32-C3 ESPHome config ─────────────────
# Paste these sections. Single-core: add the on_client_connected
# block under your existing api: key to gate BLE on API connection.
# If you already have sensor:/text_sensor: sections, merge entries.

# Add under your existing api: section:
#  on_client_connected:
#    - esp32_ble_tracker.start_scan:
#        continuous: true
#  on_client_disconnected:
#    - esp32_ble_tracker.stop_scan:

esp32_ble_tracker:
  scan_parameters:
    interval: 320ms
    window: 100ms                 # ~31% duty — single-core safe
    active: false

bluetooth_proxy:
  active: false

sensor:
  - platform: wifi_signal
    name: "WiFi Signal"
    update_interval: 30s
  - platform: internal_temperature
    name: "CPU Temperature"
    update_interval: 60s
  - platform: uptime
    name: "Uptime"
    update_interval: 60s

text_sensor:
  - platform: wifi_info
    ip_address:
      name: "IP Address"
    ssid:
      name: "WiFi SSID"
    bssid:
      name: "WiFi BSSID"
    mac_address:
      name: "MAC Address"`,
  },
];

// ── IRK Manager Panel ────────────────────────────────────────────────────────
// Comprehensive control panel for Private BLE (IRK) device management.
// Provides: device table, add/validate/auto-detect, unresolved RPAs, companion
// app status, and diagnostics.

function renderIrkPanel(ctx, snap) {
  const { el, esc } = ctx.helpers;
  const wrap = el("div", { style: "margin-top:12px" });

  // ── Lazy-load status on first render ──
  if (!ctx.state._irkPanelStatus && !ctx.state._irkPanelLoading) {
    ctx.state._irkPanelLoading = true;
    ctx.actions.wsCall("padspan_ha/private_ble_status").then(res => {
      ctx.state._irkPanelStatus = res || {};
      ctx.state._irkPanelLoading = false;
      ctx.actions.renderRooms();
    }).catch((e) => {
      console.warn("[IRK Manager] Failed to load status:", e);
      ctx.state._irkPanelStatus = { _error: String(e) };
      ctx.state._irkPanelLoading = false;
      ctx.actions.renderRooms();
    });
  }

  if (ctx.state._irkPanelLoading) {
    wrap.appendChild(el("div", { class: "muted", style: "padding:20px" }, "Loading IRK status\u2026"));
    return wrap;
  }

  const st = ctx.state._irkPanelStatus || {};
  const devices = st.devices || [];
  const rpaCount = st.rpa_count || 0;
  const totalBle = st.total_ble_addresses || 0;
  const mobileApps = st.mobile_apps || [];
  const hasIntegration = st.has_private_ble_integration;

  // ── The five numbers, in the view's own stat component ──
  // Tone carries the meaning: unresolved RPAs are amber only while there ARE
  // any, and a zero greys itself out rather than shouting.
  const kpiRow = el("div", { class: "bt-kpis", style: "margin-bottom:14px" });
  const kpi = (num, label, tone) => el("div", {
    class: "bt-stat" + (tone ? " tone-" + tone : "") + (!Number(num) ? " zero" : ""),
  }, [
    el("div", { class: "bt-stat-num" }, String(num)),
    el("div", { class: "bt-stat-lbl" }, label),
  ]);
  const _resolverSummary = (snap?.objects?.summary?.resolver) || {};
  const _actualResolved = _resolverSummary.resolved || 0;
  const _unresolved = Math.max(0, rpaCount - _actualResolved);
  kpiRow.appendChild(kpi(devices.length, "IRKs registered", devices.length ? "good" : "ok"));
  kpiRow.appendChild(kpi(rpaCount, "Rotating MACs", rpaCount ? "info" : ""));
  kpiRow.appendChild(kpi(_actualResolved, "Resolved", _actualResolved ? "good" : "ok"));
  kpiRow.appendChild(kpi(_unresolved, "Unresolved RPAs", _unresolved ? "ok" : ""));
  kpiRow.appendChild(kpi(totalBle, "Total BLE MACs"));
  wrap.appendChild(kpiRow);

  // ── Integration status ──
  const intCard = el("div", { class: "bt-notice " + (hasIntegration ? "good" : "ok") }, [
    el("span", { class: "bt-notice-mark" }, ""),
    el("div", { class: "bt-notice-body" }, [
      el("div", { class: "bt-notice-title" }, hasIntegration
        ? "Private BLE Device integration installed"
        : "Private BLE Device integration not installed"),
      mobileApps.length
        ? el("div", { class: "bt-notice-sub" }, `Companion apps: ${mobileApps.join(", ")}`)
        : null,
    ].filter(Boolean)),
  ]);
  wrap.appendChild(intCard);

  // ── Registered Devices Table ──
  const devCard = el("div", { class: "bt-panel", style: "margin-bottom:12px" });
  devCard.appendChild(el("div", { class: "bt-panel-head" }, [
    el("div", { class: "bt-panel-title" }, "Registered IRK devices"),
    el("div", { class: "bt-panel-sub" }, "Each key here lets PadSpan follow one device through its rotating addresses."),
    el("span", { class: "bt-chip quiet" }, String(devices.length)),
  ]));

  if (devices.length) {
    // Where a key came from is a category, so it wears a chip in the tone of
    // that category — the five hand-picked hexes were the same five ideas.
    const srcTone = { padspan: "violet", private_ble_device: "good", mobile_app: "info",
                      bluetooth_bond: "ok" };
    const tbl = el("table", { class: "table" });
    const thead = el("tr", {});
    for (const h of ["Name", "Source", "Canonical ID", ""]) thead.appendChild(el("th", {}, h));
    tbl.appendChild(el("thead", {}, thead));
    const tb = el("tbody");

    for (const d of devices) {
      const tr = el("tr", {});
      tr.appendChild(el("td", { style: "font-weight:700" }, d.name || "Unknown"));
      tr.appendChild(el("td", {}, chip(el, d.source || "unknown", srcTone[d.source] || "quiet")));
      tr.appendChild(el("td", { class: "bt-adv-sub", style: "white-space:normal;word-break:break-all" }, d.canonical_id || ""));

      // Delete button — different behavior based on source
      const tdAct = el("td", { style: "white-space:nowrap;text-align:right" });
      if (d.source === "padspan") {
        const rmBtn = el("button", { class: "btn tiny bt-btn-danger" }, "Remove");
        rmBtn.addEventListener("click", async () => {
          if (!confirm(`Remove IRK for "${d.name}"?`)) return;
          const hex = (d.canonical_id || "").replace("irk:", "");
          try {
            await ctx.actions.wsCall("padspan_ha/irk_remove", { irk_hex: hex });
            ctx.state._irkPanelStatus = null;
            ctx.actions.renderRooms();
          } catch(e) { ctx.toast(e.message || "Remove failed", true); }
        });
        tdAct.appendChild(rmBtn);
      } else if (d.source === "private_ble_device" && d.entry_id) {
        const rmBtn = el("button", { class: "btn tiny bt-btn-danger" }, "Delete");
        rmBtn.addEventListener("click", async () => {
          if (!confirm(`Delete "${d.name}" from Home Assistant? This removes the Private BLE Device integration entry itself — the device disappears from HA, not just from PadSpan.`)) return;
          if (!confirm(`Are you sure? "${d.name}" will be deleted from Home Assistant. You would need its IRK to re-add it.`)) return;
          try {
            await ctx.actions.wsCall("padspan_ha/private_ble_delete_irk", { entry_id: d.entry_id });
            ctx.state._irkPanelStatus = null;
            ctx.actions.renderRooms();
          } catch(e) { ctx.toast(e.message || "Delete failed", true); }
        });
        tdAct.appendChild(rmBtn);
      } else {
        tdAct.appendChild(el("span", { class: "bt-mini-lbl" }, d.source === "bluetooth_bond" ? "System" : "HA-managed"));
      }
      tr.appendChild(tdAct);
      tb.appendChild(tr);
    }
    tbl.appendChild(tb);
    devCard.appendChild(tbl);
  } else {
    devCard.appendChild(emptyState(el, "\u25CC", "No IRKs registered",
      "Without one, a phone that rotates its address looks like a new device every fifteen minutes. Add a key below."));
  }
  wrap.appendChild(devCard);

  // ── Add IRK Form ──
  const addCard = el("div", { class: "bt-panel", style: "margin-bottom:12px" });
  addCard.appendChild(el("div", { class: "bt-panel-head" }, [
    el("div", { class: "bt-panel-title" }, "Add an IRK"),
    el("div", { class: "bt-panel-sub" },
      "Paste the key from the phone's own settings — hex, base64, colon-separated or irk:-prefixed all work. "
      + "PadSpan checks it against live traffic before saving it."),
  ]));
  addCard.appendChild(el("div", { class: "bt-note", style: "margin-bottom:10px" },
    "Capturing an IRK from a phone or watch needs the ESPHome IRK Capture tool \u2014 github.com/DerekSeaman/irk-capture"));

  const nameInp = el("input", {
    class: "input", type: "text", placeholder: "Device name \u2014 e.g. Garry's Pixel",
    style: "width:100%;box-sizing:border-box",
  });
  const irkInp = el("input", {
    class: "input", type: "text", placeholder: "IRK (hex, base64 or colon-separated)",
    style: "width:100%;box-sizing:border-box;margin-top:6px;font-family:ui-monospace,SFMono-Regular,Consolas,monospace",
  });
  const addMsg = el("div", { style: "font-size:11.5px;margin-top:7px;min-height:16px" });

  const btnRow = el("div", { style: "display:flex;gap:8px;margin-top:10px;flex-wrap:wrap;align-items:center" });
  // "Add & Validate" was full width because .btn is; it is one action among
  // three, so it sizes like one.
  const addBtn = el("button", { class: "btn inline" }, "Add & validate");
  const validateBtn = el("button", { class: "btn inline" }, "Test only");
  const autoDetectBtn = el("button", { class: "btn inline bt-btn-info", style: "margin-left:auto" }, "Auto-detect IRKs");

  // Add & Validate handler
  addBtn.addEventListener("click", async () => {
    const irk = irkInp.value.trim();
    const name = nameInp.value.trim();
    if (!irk) { addMsg.textContent = "Paste an IRK first"; addMsg.style.color = "var(--bt-bad)"; return; }
    addBtn.disabled = true; addBtn.textContent = "Validating…";
    addMsg.textContent = ""; addMsg.style.color = "var(--bt-dim)";

    // Validate first
    try {
      const vRes = await ctx.actions.wsCall("padspan_ha/irk_validate", { irk_hex: irk });
      if (vRes && vRes.matched_count > 0) {
        addMsg.style.color = "var(--bt-good)";
        addMsg.textContent = `✓ Validated: matched ${vRes.matched_count} rotating address${vRes.matched_count !== 1 ? "es" : ""}. Saving…`;
        // Use the validated hex format
        const useIrk = vRes.irk_hex || irk;
        try {
          await ctx.actions.wsCall("padspan_ha/irk_add", { name: name || "PadSpan Device", irk_hex: useIrk });
          addMsg.style.color = "var(--bt-good)";
          addMsg.textContent = `✓ Saved "${name || "PadSpan Device"}" — resolving active immediately`;
          nameInp.value = ""; irkInp.value = "";
          ctx.state._irkPanelStatus = null;
          setTimeout(() => ctx.actions.renderRooms(), 500);
        } catch(e) {
          addMsg.style.color = "var(--bt-bad)";
          addMsg.textContent = e.message || "Save failed";
        }
      } else {
        // No live match — save anyway with warning
        addMsg.style.color = "var(--bt-ok)";
        const rpas = vRes ? vRes.rpa_count : 0;
        addMsg.textContent = rpas > 0
          ? `⚠ No live match (${rpas} RPAs scanned). Device may be off or out of range. Saving anyway…`
          : "⚠ No rotating addresses detected. Saving anyway…";
        try {
          await ctx.actions.wsCall("padspan_ha/irk_add", { name: name || "PadSpan Device", irk_hex: irk });
          addMsg.textContent += " ✓ Saved. Will resolve when device comes in range.";
          nameInp.value = ""; irkInp.value = "";
          ctx.state._irkPanelStatus = null;
          setTimeout(() => ctx.actions.renderRooms(), 500);
        } catch(e) {
          addMsg.style.color = "var(--bt-bad)";
          addMsg.textContent = e.message || "Save failed";
        }
      }
    } catch(e) {
      addMsg.style.color = "var(--bt-bad)";
      addMsg.textContent = e.message || "Invalid IRK format";
    }
    addBtn.disabled = false; addBtn.textContent = "Add & Validate";
  });

  // Test Only handler
  validateBtn.addEventListener("click", async () => {
    const irk = irkInp.value.trim();
    if (!irk) { addMsg.textContent = "Paste an IRK first"; addMsg.style.color = "var(--bt-bad)"; return; }
    validateBtn.disabled = true; validateBtn.textContent = "Testing…";
    addMsg.textContent = ""; addMsg.style.color = "var(--bt-dim)";
    try {
      const vRes = await ctx.actions.wsCall("padspan_ha/irk_validate", { irk_hex: irk });
      if (vRes && vRes.matched_count > 0) {
        addMsg.style.color = "var(--bt-good)";
        const fmt = vRes.matched_format ? ` (format: ${vRes.matched_format})` : "";
        addMsg.textContent = `✓ Valid! Matched ${vRes.matched_count} rotating address${vRes.matched_count !== 1 ? "es" : ""}${fmt}. Addresses: ${(vRes.matched_addresses || []).slice(0, 5).join(", ")}`;
      } else {
        addMsg.style.color = "var(--bt-ok)";
        addMsg.textContent = `No match found. ${vRes.rpa_count || 0} RPAs tested. ${vRes.candidates_tried || 0} format variants tried. Device may be off/out of range.`;
      }
    } catch(e) {
      addMsg.style.color = "var(--bt-bad)";
      addMsg.textContent = e.message || "Invalid IRK format";
    }
    validateBtn.disabled = false; validateBtn.textContent = "Test Only";
  });

  // Auto-Detect handler
  autoDetectBtn.addEventListener("click", async () => {
    autoDetectBtn.disabled = true; autoDetectBtn.textContent = "Scanning…";
    addMsg.textContent = ""; addMsg.style.color = "var(--bt-dim)";
    try {
      const res = await ctx.actions.wsCall("padspan_ha/irk_auto_detect", {});
      const found = res.found || [];
      if (found.length === 0) {
        addMsg.style.color = "var(--bt-ok)";
        addMsg.textContent = `No system Bluetooth bonds found (${res.system_bond_count || 0} bonds scanned, ${res.rpa_count || 0} RPAs tested).`;
      } else {
        // Show found IRKs
        addMsg.style.color = "var(--bt-good)";
        const newOnes = found.filter(f => !f.already_registered);
        const verified = found.filter(f => f.verified);
        addMsg.textContent = `Found ${found.length} IRK${found.length !== 1 ? "s" : ""}: ${newOnes.length} new, ${verified.length} verified against live RPAs.`;

        // Auto-add verified new ones
        for (const f of found) {
          if (!f.already_registered && f.verified) {
            try {
              await ctx.actions.wsCall("padspan_ha/irk_add", { name: f.name || "Auto-detected", irk_hex: f.irk_hex });
            } catch(_e) {}
          }
        }
        if (newOnes.some(f => f.verified)) {
          addMsg.textContent += " Verified IRKs saved automatically.";
          ctx.state._irkPanelStatus = null;
          setTimeout(() => ctx.actions.renderRooms(), 500);
        }
      }
    } catch(e) {
      addMsg.style.color = "var(--bt-bad)";
      addMsg.textContent = e.message || "Auto-detect failed";
    }
    autoDetectBtn.disabled = false; autoDetectBtn.textContent = "Auto-Detect IRKs";
  });

  btnRow.appendChild(addBtn);
  btnRow.appendChild(validateBtn);
  btnRow.appendChild(autoDetectBtn);
  addCard.appendChild(nameInp);
  addCard.appendChild(irkInp);
  addCard.appendChild(btnRow);
  addCard.appendChild(addMsg);
  wrap.appendChild(addCard);

  // ── Phone Setup Wizard ──
  // Guided setup flow for adding phones. Only shows when phone_wizard_enabled setting is on.
  const _wizSettings = ctx.state.settings || {};
  if (_wizSettings.phone_wizard_enabled) {
    const wizCard = el("div", { class: "bt-panel", style: "margin-bottom:12px" });
    wizCard.appendChild(el("div", { class: "bt-panel-head" }, [
      el("div", { class: "bt-panel-title" }, "Track your phone"),
      el("div", { class: "bt-panel-sub" }, "Three ways in, depending on what you have."),
      el("span", { class: "bt-chip ok" }, "wizard"),
    ]));

    // One shape for the three paths, so they read as alternatives rather than
    // three differently-coloured cards.
    const _path = (title, tone) => {
      const d = el("div", { style: "padding:11px 12px;background:var(--bt-inset);border:1px solid var(--bt-line);border-radius:10px;margin-bottom:8px" });
      d.appendChild(el("div", { style: `font-weight:700;font-size:12.5px;color:var(--bt-${tone});margin-bottom:5px` }, title));
      return d;
    };

    // Path A — IRK Capture ESP32
    const pathA = _path("I have an IRK Capture ESP32", "info");
    pathA.appendChild(el("div", { class: "muted", style: "font-size:12px;line-height:1.55;margin-bottom:8px" },
      "With DerekSeaman's irk-capture flashed on an ESP32, PadSpan can pick the captured key up by itself."));
    const wizScanBtn = el("button", { class: "btn inline bt-btn-info" }, "Scan for IRK Capture devices");
    const wizScanMsg = el("div", { style: "font-size:11.5px;margin-top:7px;min-height:16px" });
    wizScanBtn.addEventListener("click", async () => {
      wizScanBtn.disabled = true; wizScanBtn.textContent = "Scanning...";
      wizScanMsg.textContent = ""; wizScanMsg.style.color = "var(--bt-dim)";
      try {
        const res = await ctx.actions.wsCall("padspan_ha/irk_auto_detect", {});
        const found = res.found || [];
        if (found.length === 0) {
          wizScanMsg.style.color = "var(--bt-ok)";
          wizScanMsg.textContent = "No IRK Capture devices found. Make sure the ESP32 is powered on and has captured a pairing.";
        } else {
          wizScanMsg.style.color = "var(--bt-good)";
          const newOnes = found.filter(f => !f.already_registered);
          const verified = found.filter(f => f.verified);
          wizScanMsg.textContent = `Found ${found.length} IRK${found.length !== 1 ? "s" : ""}: ${newOnes.length} new, ${verified.length} verified.`;
          for (const f of found) {
            if (!f.already_registered && f.verified) {
              try {
                await ctx.actions.wsCall("padspan_ha/irk_add", { name: f.name || "Auto-detected", irk_hex: f.irk_hex });
              } catch(_e) {}
            }
          }
          if (newOnes.some(f => f.verified)) {
            wizScanMsg.textContent += " Verified IRKs saved automatically.";
            ctx.state._irkPanelStatus = null;
            setTimeout(() => ctx.actions.renderRooms(), 500);
          }
        }
      } catch(e) {
        wizScanMsg.style.color = "var(--bt-bad)";
        wizScanMsg.textContent = e.message || "Scan failed";
      }
      wizScanBtn.disabled = false; wizScanBtn.textContent = "Scan for IRK Capture devices";
    });
    pathA.appendChild(wizScanBtn);
    pathA.appendChild(wizScanMsg);
    wizCard.appendChild(pathA);

    // Path B — Android
    const pathB = _path("I have an Android phone", "good");
    pathB.appendChild(el("div", { class: "muted", style: "font-size:12px;line-height:1.55" },
      "The easiest way to track an Android phone: Install the HA Companion App \u2192 Settings \u2192 Manage Sensors \u2192 BLE Transmitter \u2192 Enable. " +
      "Your phone will broadcast an iBeacon signal that PadSpan tracks automatically. No IRK needed."));
    wizCard.appendChild(pathB);

    // Path C — iPhone
    const pathC = _path("I have an iPhone", "ok");
    pathC.appendChild(el("div", { class: "muted", style: "font-size:12px;line-height:1.55;margin-bottom:6px" },
      "For iPhone tracking you need the IRK (Identity Resolving Key). The easiest method is the IRK Capture ESP32 tool. " +
      "Alternative: if you have a Mac, extract the IRK from Keychain Access."));
    const irkLink = el("a", {
      href: "https://github.com/DerekSeaman/irk-capture",
      target: "_blank",
      rel: "noopener noreferrer",
      class: "bt-link",
      style: "font-size:12px",
    }, "github.com/DerekSeaman/irk-capture");
    pathC.appendChild(irkLink);
    wizCard.appendChild(pathC);

    wrap.appendChild(wizCard);
  }

  // ── Companion App IRK Status ──
  if (mobileApps.length || devices.some(d => d.source === "mobile_app")) {
    const compCard = el("div", { class: "bt-panel", style: "margin-bottom:12px" });
    compCard.appendChild(el("div", { class: "bt-panel-head" }, [
      el("div", { class: "bt-panel-title" }, "Companion apps"),
    ]));

    const appDevices = devices.filter(d => d.source === "mobile_app");
    if (appDevices.length) {
      compCard.appendChild(el("div", { class: "bt-note good" },
        `${appDevices.length} companion app${appDevices.length !== 1 ? "s" : ""} with an IRK: ${appDevices.map(d => d.name).join(", ")}`));
    }
    const appsWithoutIrk = mobileApps.filter(name => !appDevices.some(d => d.name === name));
    if (appsWithoutIrk.length) {
      compCard.appendChild(el("div", { class: "bt-note ok" },
        `${appsWithoutIrk.length} companion app${appsWithoutIrk.length !== 1 ? "s" : ""} without one: ${appsWithoutIrk.join(", ")}`));
      compCard.appendChild(el("div", { class: "muted", style: "font-size:11.5px;line-height:1.6;margin-top:8px" },
        "The HA Companion App stores an IRK when BLE Transmitter is enabled. " +
        "If the app registered before BLE Transmitter was added (or the IRK field wasn't populated), " +
        "you may need to manually extract the IRK. On Android: HA Settings → Companion App → Manage Sensors → BLE Transmitter → look for the IRK. " +
        "On iOS: the IRK is not exposed in the app — use the Mac Keychain method."));
    }
    wrap.appendChild(compCard);
  }

  // ── Troubleshooting Card ──
  const troubleCard = el("div", { class: "bt-panel", style: "margin-bottom:12px" });
  troubleCard.appendChild(el("div", { class: "bt-panel-head" }, [
    el("div", { class: "bt-panel-title" }, "How this install is doing"),
  ]));
  const issues = [];
  if (devices.length === 0 && rpaCount > 0) {
    issues.push({ tone: "ok", text: `${rpaCount} rotating addresses are being heard and no IRK is registered. Those are phones and watches, and without their key they cannot be told apart.` });
  }
  if (!hasIntegration) {
    issues.push({ tone: "", text: "The Private BLE Device integration is not installed. PadSpan resolves IRKs on its own regardless; installing it adds HA device entities you can automate on." });
  }
  if (devices.length > 0 && rpaCount === 0) {
    issues.push({ tone: "ok", text: "IRKs are registered but nothing rotating is being heard. Check that the scanners are online and the devices are in range." });
  }
  if (issues.length === 0) {
    issues.push({ tone: "good", text: "Everything is working: the keys are loaded and rotating addresses are resolving." });
  }
  const issueList = el("div", { class: "bt-notes" });
  for (const iss of issues) {
    issueList.appendChild(el("div", { class: "bt-note" + (iss.tone ? " " + iss.tone : "") }, iss.text));
  }
  troubleCard.appendChild(issueList);

  // Quick reference
  troubleCard.appendChild(el("div", { style: "margin-top:12px;padding-top:9px;border-top:1px solid var(--bt-line)" }, [
    el("div", { class: "bt-kv-title", style: "margin-top:0;border:none;padding:0" }, "Where to find an IRK"),
    el("dl", { class: "bt-kv" }, [
      el("dt", {}, "Android"),
      el("dd", {}, "Companion App \u2192 Settings \u2192 Manage Sensors \u2192 BLE Transmitter \u2192 IRK attribute"),
      el("dt", {}, "iPhone / iPad"),
      el("dd", {}, "On a Mac: sudo defaults read /private/var/root/Library/Preferences/com.apple.bluetoothd.plist"),
      el("dt", {}, "Linux bonds"),
      el("dd", {}, "Found for you by Auto-detect, above"),
      el("dt", {}, "Anything else"),
      el("dd", {}, "Pair with an ESP32 running BLE pairing firmware; the key is printed on the serial output"),
    ]),
  ]));
  wrap.appendChild(troubleCard);

  // ── Refresh button ──
  const refreshBtn = el("button", { class: "btn inline", style: "margin-bottom:12px" }, "Refresh status");
  refreshBtn.addEventListener("click", () => {
    ctx.state._irkPanelStatus = null;
    ctx.state._irkPanelLoading = false;
    ctx.actions.renderRooms();
  });
  wrap.appendChild(refreshBtn);

  return wrap;
}


// ── ESPHome Configs Sub-Tab ──────────────────────────────────────────────────
// Renders the full ESPHome config library: intro card, hardware recommendations
// (with auto-expiry dates), chip comparison table, per-config cards with
// expandable YAML (full and minimal variants), and a tips card.
// The entire DOM is cached because this tab has no dynamic data.
function renderEsphomeConfigs(ctx) {
  // Cache the entire config library DOM — it's 100% static content.
  // Without this, the 5s poll cycle rebuilds the DOM and flickers expanded YAML.
  if (ctx.state._esphomeConfigsDom) return ctx.state._esphomeConfigsDom;

  const { el } = ctx.helpers;

  // Floating copy-to-clipboard icon for code blocks.
  // Placed top-right of the code container. Shows a checkmark for 1.5s after successful copy.
  function _makeCodeCopyIcon(text) {
    const btn = document.createElement("button");
    btn.title = "Copy to clipboard";
    btn.style.cssText = "position:absolute;top:8px;right:8px;background:rgba(255,255,255,.055);border:1px solid rgba(120,190,155,.28);border-radius:8px;padding:5px 6px;cursor:pointer;opacity:0.55;transition:opacity .15s ease,border-color .15s ease;display:flex;align-items:center;justify-content:center;z-index:1";
    btn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="rgba(226,240,232,.6)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
    btn.addEventListener("mouseenter", () => { btn.style.opacity = "1"; });
    btn.addEventListener("mouseleave", () => { if (btn.dataset.copied !== "1") btn.style.opacity = "0.55"; });
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      navigator.clipboard.writeText(text).then(() => {
        btn.dataset.copied = "1";
        btn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#8ee5b4" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';
        btn.style.opacity = "1";
        btn.style.borderColor = "rgba(82,183,136,.75)";
        setTimeout(() => {
          btn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="rgba(226,240,232,.6)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
          btn.style.opacity = "0.55";
          btn.style.borderColor = "rgba(120,190,155,.28)";
          delete btn.dataset.copied;
        }, 1500);
      }).catch(() => {});
    });
    return btn;
  }

  // Intro card
  const intro = el("div", { class: "bt-panel" }, [
    el("div", { class: "bt-panel-head" }, [
      el("div", { class: "bt-panel-title" }, "ESPHome config library"),
    ]),
    el("div", { class: "muted", style: "line-height:1.6;font-size:12px" },
      "Optimised ESPHome YAML for every ESP32 variant PadSpan supports. " +
      "Each config includes the diagnostic sensors PadSpan reads automatically (IP address, WiFi signal, SSID, temperature, uptime). " +
      "Copy the YAML into your ESPHome device configuration, adjust wifi/api secrets, and flash."
    ),
    el("div", { style: "margin-top:10px;display:flex;gap:12px;flex-wrap:wrap" }, [
      el("div", { style: "flex:1;min-width:200px;background:var(--bt-inset);border:1px solid var(--bt-line);border-radius:10px;padding:11px 13px" }, [
        el("div", { class: "bt-kv-title", style: "margin:0 0 5px;border:none;padding:0" }, "Scan parameters"),
        el("div", { class: "muted", style: "font-size:11px;line-height:1.5" },
          "interval and window must be multiples of 0.625 ms (one BLE time slot). " +
          "320 ms interval is the standard. WiFi scanners: window = 100 ms (31% duty). " +
          "Ethernet scanners: window = 300 ms (93.75% duty)."
        ),
      ]),
      el("div", { style: "flex:1;min-width:200px;background:var(--bt-inset);border:1px solid var(--bt-line);border-radius:10px;padding:11px 13px" }, [
        el("div", { class: "bt-kv-title", style: "margin:0 0 5px;border:none;padding:0" }, "Why passive scanning"),
        el("div", { class: "muted", style: "font-size:11px;line-height:1.5" },
          "active: false means the scanner only listens — it never sends scan requests. " +
          "This reduces RF contention, saves power, and is all PadSpan needs for RSSI-based presence. " +
          "Active scanning is only needed if you want to connect to BLE devices."
        ),
      ]),
    ]),
  ]);

  // ── External antenna recommendation card ───────────────────────────────────
  // Auto-expires September 10, 2026 — hardware recommendations go stale.
  const _antExpiry = new Date("2026-09-10T00:00:00Z").getTime();
  const antennaCard = Date.now() < _antExpiry ? el("div", { class: "bt-panel", style: "border-color:rgba(251,191,36,.34);background:rgba(251,191,36,.045)" }, [
    el("div", { style: "display:flex;justify-content:space-between;align-items:flex-start;gap:10px;flex-wrap:wrap" }, [
      el("div", {}, [
        el("div", { style: "display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:4px" }, [
          el("span", { style: "font-weight:800;font-size:15px;color:var(--bt-ok)" }, "An external antenna is the biggest single upgrade"),
          el("span", { class: "bt-chip ok" }, "#1 upgrade"),
        ]),
        el("div", { class: "muted", style: "font-size:12px;line-height:1.7;max-width:650px" },
          "Adding an external antenna to your ESP32 scanner is the most impactful upgrade you can make. " +
          "The tiny PCB antennas on most boards have limited range and are easily blocked by enclosures. " +
          "An external antenna dramatically improves RSSI consistency, range, and positioning accuracy — " +
          "often doubling effective coverage per scanner."
        ),
      ]),
      (() => {
        const linkBtn = document.createElement("a");
        linkBtn.href = "https://www.aliexpress.com/item/1005003443721023.html";
        linkBtn.target = "_blank";
        linkBtn.rel = "noopener noreferrer";
        linkBtn.className = "btn tiny";
        linkBtn.style.cssText = "text-decoration:none;display:inline-flex;align-items:center;gap:4px;flex-shrink:0;color:var(--bt-ok);border-color:rgba(251,191,36,.4);background:rgba(251,191,36,.1)";
        linkBtn.textContent = "Example on AliExpress";
        return linkBtn;
      })(),
    ]),
    el("div", { class: "bt-notes" }, [
      el("div", { class: "bt-note" }, "Look for boards with an IPEX/U.FL connector (most ESP32-S3 and ESP32 boards have one)"),
      el("div", { class: "bt-note" }, "A simple 2.4 GHz antenna with IPEX connector is all you need — no soldering required"),
      el("div", { class: "bt-note ok" }, "Connector types (IPEX, U.FL) vary between boards — verify your board's connector before ordering"),
      el("div", { class: "bt-note" }, "Tested and working, but this is a third-party link provided as an example only"),
    ]),
  ]) : null;

  // ── Recommended hardware card (ESP32-S3 Ethernet) ──────────────────────────
  // Auto-expires July 10, 2026. Includes a tested YAML config with show/copy buttons.
  const _recExpiry = new Date("2026-07-10T00:00:00Z").getTime();
  const recCard = Date.now() < _recExpiry ? (() => {
    const _recYaml = `esphome:
  name: ble-white3dprintedbox
  friendly_name: BLE-white3dprintedBOX
  min_version: 2025.11.0
  name_add_mac_suffix: false

esp32:
  variant: esp32s3
  framework:
    type: esp-idf

# ── Ethernet (W5500 over SPI) ──────────────────────────────
ethernet:
  type: W5500
  clk_pin: GPIO7
  mosi_pin: GPIO9
  miso_pin: GPIO8
  cs_pin: GPIO2
  interrupt_pin: GPIO10

# ── Home Assistant API ─────────────────────────────────────
api:
  encryption:
    key: "YOUR_KEY_HERE"

# ── OTA Updates ────────────────────────────────────────────
ota:
  - platform: esphome
    password: "YOUR_PASSWORD_HERE"

# ── Logging ────────────────────────────────────────────────
logger:
  level: WARN

# ── BLE Configuration ─────────────────────────────────────
esp32_ble:
  max_connections: 4

esp32_ble_tracker:
  scan_parameters:
    interval: 1100ms
    window: 1100ms
    active: true

# ── Bluetooth Proxy ───────────────────────────────────────
bluetooth_proxy:
  active: true
  connection_slots: 4

# ── Diagnostic Sensors ─────────────────────────────────────
sensor:
  - platform: uptime
    name: "Uptime"
    update_interval: 60s
    entity_category: diagnostic

  - platform: internal_temperature
    name: "ESP32 Temperature"
    update_interval: 60s
    entity_category: diagnostic

text_sensor:
  - platform: ethernet_info
    ip_address:
      name: "IP Address"
      entity_category: diagnostic

  - platform: version
    name: "ESPHome Version"
    entity_category: diagnostic

binary_sensor:
  - platform: status
    name: "Status"
    entity_category: diagnostic

# ── Control Buttons ────────────────────────────────────────
button:
  - platform: restart
    name: "Restart"
    entity_category: config

  - platform: safe_mode
    name: "Safe Mode Boot"
    entity_category: config

  - platform: factory_reset
    name: "Factory Reset"
    entity_category: config`;

    const yamlPre = document.createElement("pre");
    yamlPre.className = "pre";
    yamlPre.className = "pre tall";
    yamlPre.style.cssText = "margin-top:10px;tab-size:2;display:none";
    yamlPre.textContent = _recYaml;

    // Wrap pre in container with floating copy icon
    const _recPreWrap = document.createElement("div");
    _recPreWrap.style.cssText = "position:relative;display:none";
    const _recCopyIcon = _makeCodeCopyIcon(_recYaml);
    _recPreWrap.appendChild(yamlPre);
    _recPreWrap.appendChild(_recCopyIcon);
    yamlPre.style.display = "block"; // always visible inside wrapper
    yamlPre.style.marginTop = "0";

    const showBtn = el("button", { class: "btn tiny", style: "font-size:11px" }, "Show YAML");
    showBtn.addEventListener("click", () => {
      const show = _recPreWrap.style.display === "none";
      _recPreWrap.style.display = show ? "block" : "none";
      showBtn.textContent = show ? "Hide YAML" : "Show YAML";
    });
    const copyBtn = el("button", { class: "btn tiny", style: "font-size:11px" }, "Copy");
    copyBtn.addEventListener("click", () => {
      navigator.clipboard.writeText(_recYaml).then(() => {
        copyBtn.textContent = "Copied!";
        setTimeout(() => { copyBtn.textContent = "Copy"; }, 1500);
      }).catch(() => {
        _recPreWrap.style.display = "block";
        showBtn.textContent = "Hide YAML";
        copyBtn.textContent = "Copy manually";
        setTimeout(() => { copyBtn.textContent = "Copy"; }, 2000);
      });
    });

    const linkBtn = document.createElement("a");
    linkBtn.href = "https://www.aliexpress.com/item/1005009310322353.html";
    linkBtn.target = "_blank";
    linkBtn.rel = "noopener noreferrer";
    linkBtn.className = "btn tiny";
    linkBtn.className = "btn tiny bt-btn-accent";
    linkBtn.style.cssText = "text-decoration:none;display:inline-flex;align-items:center;gap:4px";
    linkBtn.textContent = "View on AliExpress";

    return el("div", { class: "bt-panel", style: "border-color:rgba(82,183,136,.4);background:rgba(82,183,136,.05)" }, [
      el("div", { style: "display:flex;justify-content:space-between;align-items:flex-start;gap:10px;flex-wrap:wrap" }, [
        el("div", {}, [
          el("div", { style: "display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:4px" }, [
            el("span", { style: "font-weight:800;font-size:14px;color:#8ee5b4" }, "Recommended: ESP32-S3 Ethernet board"),
            el("span", { class: "bt-chip good" }, "tested"),
          ]),
          el("div", { class: "muted", style: "font-size:12px;line-height:1.6;max-width:600px" },
            "ESP32-S3 with W5500 Ethernet in a compact 3D-printed case. Wired connection means zero WiFi contention — the BLE radio runs at full duty. " +
            "Affordable, reliable, and field-tested with PadSpan. Just flash the config below and plug in."
          ),
        ]),
        el("div", { style: "display:flex;gap:6px;flex-shrink:0;flex-wrap:wrap" }, [linkBtn, showBtn, copyBtn]),
      ]),
      el("div", { class: "bt-notes" }, [
        el("div", { class: "bt-note" }, "ESP32-S3 + W5500 Ethernet — no WiFi needed, maximum BLE scan duty"),
        el("div", { class: "bt-note" }, "Active scanning with Bluetooth Proxy enabled (4 connection slots)"),
        el("div", { class: "bt-note" }, "Replace API key and OTA password with your own values before flashing"),
      ]),
      _recPreWrap,
    ]);
  })() : null;

  // ── IRK Capture Tool card ──────────────────────────────────────────────────
  const irkCaptureCard = el("div", { class: "bt-panel", style: "border-color:rgba(196,181,253,.3);background:rgba(196,181,253,.045)" }, [
    el("div", { style: "display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:4px" }, [
      el("span", { style: "font-weight:800;font-size:14px;color:var(--bt-violet)" }, "IRK Capture tool"),
      el("span", { class: "bt-chip violet" }, "community project"),
    ]),
    el("div", { class: "muted", style: "font-size:12px;line-height:1.6;max-width:700px;margin-bottom:8px" },
      "Phones and watches rotate their BLE MAC address every ~15 minutes, making them hard to track. " +
      "An IRK (Identity Resolving Key) lets PadSpan see through the rotation and track each device by name. " +
      "This ESPHome package captures IRKs by briefly pairing with a phone or watch \u2014 flash a spare ESP32, pair, copy the IRK, and paste it into PadSpan\u2019s Private BLE section above."
    ),
    el("div", { class: "bt-notes" }, [
      el("div", { class: "bt-note" }, "Supports Apple (heart rate sensor profile) and Android (keyboard profile)"),
      el("div", { class: "bt-note" }, "Flash any spare ESP32 \u2014 only needed once per device, then reflash back to scanner duty"),
      el("div", { class: "bt-note ok" }, "Third-party community project \u2014 not maintained by PadSpan"),
    ]),
    (() => {
      const linkBtn = document.createElement("a");
      linkBtn.href = "https://github.com/DerekSeaman/irk-capture";
      linkBtn.target = "_blank";
      linkBtn.rel = "noopener noreferrer";
      linkBtn.className = "btn tiny";
      linkBtn.style.cssText = "text-decoration:none;display:inline-flex;align-items:center;gap:4px;margin-top:10px;color:var(--bt-violet);border-color:rgba(196,181,253,.4);background:rgba(196,181,253,.1)";
      linkBtn.textContent = "View on GitHub \u2192";
      return linkBtn;
    })(),
  ]);

  // ── Chip comparison table ──────────────────────────────────────────────────
  // Auto-expires March 10, 2028 (hardware recs go stale).
  const _chipExpiry = new Date("2028-03-10T00:00:00Z").getTime();
  const chipTable = Date.now() < _chipExpiry ? el("div", { class: "bt-panel" }, [
    el("div", { class: "bt-panel-head" }, [
      el("div", { class: "bt-panel-title" }, "Which chip"),
      el("div", { class: "bt-panel-sub" }, "Scan duty is what decides how much a scanner actually hears."),
    ]),
    (() => {
      const wrap = document.createElement("div");
      wrap.style.cssText = "overflow-x:auto";
      // The shared table style; the only inline colour left is the verdict,
      // and it comes from the same three tone tokens as everything else.
      const _g = "color:var(--bt-good)", _o = "color:var(--bt-ok)",
            _b = "color:var(--bt-bad)", _v = "color:var(--bt-violet)";
      wrap.innerHTML = `<table class="table">
        <thead><tr>
          <th>Chip</th><th>Cores</th><th>BLE</th><th>WiFi</th><th>Max scan duty</th><th>Best for</th>
        </tr></thead>
        <tbody>
          <tr><td style="font-weight:700;${_g}">ESP32-S3</td><td style="${_g}">2 (Xtensa)</td><td>5.0</td><td>4 (b/g/n)</td><td style="${_g}">~31% WiFi / 93.75% Eth</td><td style="${_g};font-weight:700">Best overall</td></tr>
          <tr><td style="font-weight:700">ESP32-C6</td><td>1 (RISC-V)</td><td style="${_v}">5.3</td><td style="${_v}">6 (ax)</td><td style="${_o}">~31%</td><td>Future-proof, Wi-Fi 6</td></tr>
          <tr><td style="font-weight:700">ESP32 (original)</td><td>2 (Xtensa)</td><td>4.2</td><td>4 (b/g/n)</td><td style="${_o}">~31%</td><td>Legacy installs</td></tr>
          <tr><td style="font-weight:700;${_b}">ESP32-C3</td><td>1 (RISC-V)</td><td>5.0</td><td>4 (b/g/n)</td><td style="${_b}">~20-25%</td><td style="${_b}">Not recommended \u2014 existing installs only</td></tr>
        </tbody>
      </table>`;
      return wrap;
    })(),
  ]) : null;

  // ── Per-config expandable cards ─────────────────────────────────────────────
  // Each card has two YAML variants (full + minimal "add to existing"), only one
  // visible at a time. Copy button copies whichever is currently expanded.
  const configCards = ESPHOME_CONFIGS.map(cfg => {
    const expandedFull = ctx.state[`_cfgExpand_${cfg.id}`] || false;
    const expandedMin  = ctx.state[`_cfgMinimal_${cfg.id}`] || false;

    const toggleBtn = el("button", { class: "btn tiny", style: "font-size:11px" }, expandedFull ? "Hide YAML" : "Full YAML");
    const minimalBtn = cfg.minimal
      ? el("button", { class: "btn tiny bt-btn-accent" }, expandedMin ? "Hide Minimal" : "Add to Existing")
      : null;
    const copyBtn = el("button", { class: "btn tiny", style: "font-size:11px" }, "Copy");

    const headerRow = el("div", { style: "display:flex;justify-content:space-between;align-items:flex-start;gap:10px;flex-wrap:wrap" }, [
      el("div", {}, [
        el("div", { style: "display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:4px" }, [
          el("span", { style: "font-weight:700;font-size:14px" }, `${cfg.chip} — ${cfg.connection}`),
          // The badge colour is data on the config, so it rides in as a
          // custom property rather than a second chip vocabulary.
          el("span", { class: "bt-chip", style: `color:${cfg.badgeColor};border-color:${cfg.badgeColor}55;background:${cfg.badgeColor}14` }, cfg.badge),
        ]),
        el("div", { class: "muted", style: "font-size:12px;line-height:1.5;max-width:600px" }, cfg.description),
      ]),
      el("div", { style: "display:flex;gap:6px;flex-shrink:0;flex-wrap:wrap" }, [minimalBtn, toggleBtn, copyBtn].filter(Boolean)),
    ]);

    const notesList = el("div", { class: "bt-notes" },
      cfg.notes.map(n => el("div", { class: "bt-note" }, n)));

    const yamlPre = document.createElement("pre");
    yamlPre.className = "pre";
    yamlPre.className = "pre tall";
    yamlPre.style.cssText = "tab-size:2";
    yamlPre.textContent = cfg.yaml;

    // Wrap full YAML pre with floating copy icon
    const yamlWrap = document.createElement("div");
    yamlWrap.style.cssText = "position:relative;margin-top:10px;display:" + (expandedFull ? "block" : "none");
    yamlWrap.appendChild(yamlPre);
    yamlWrap.appendChild(_makeCodeCopyIcon(cfg.yaml));

    const minPre = document.createElement("pre");
    let minWrap = null;
    if (cfg.minimal) {
      minPre.className = "pre";
      minPre.style.cssText = "font-size:11px;max-height:500px;overflow:auto;white-space:pre;tab-size:2;border:1px solid #52b78830";
      minPre.textContent = cfg.minimal;

      // Wrap minimal pre with floating copy icon
      minWrap = document.createElement("div");
      minWrap.style.cssText = "position:relative;margin-top:10px;display:" + (expandedMin ? "block" : "none");
      minWrap.appendChild(minPre);
      minWrap.appendChild(_makeCodeCopyIcon(cfg.minimal));
    }

    // Mutual exclusion: only one YAML panel (full or minimal) can be open at a time
    toggleBtn.addEventListener("click", () => {
      const show = !ctx.state[`_cfgExpand_${cfg.id}`];
      ctx.state[`_cfgExpand_${cfg.id}`] = show;
      ctx.state[`_cfgMinimal_${cfg.id}`] = false;
      yamlWrap.style.display = show ? "block" : "none";
      if (minWrap) minWrap.style.display = "none";
      toggleBtn.textContent = show ? "Hide YAML" : "Full YAML";
      if (minimalBtn) minimalBtn.textContent = "Add to Existing";
    });

    if (minimalBtn) {
      minimalBtn.addEventListener("click", () => {
        const show = !ctx.state[`_cfgMinimal_${cfg.id}`];
        ctx.state[`_cfgMinimal_${cfg.id}`] = show;
        ctx.state[`_cfgExpand_${cfg.id}`] = false;
        if (minWrap) minWrap.style.display = show ? "block" : "none";
        yamlWrap.style.display = "none";
        minimalBtn.textContent = show ? "Hide Minimal" : "Add to Existing";
        toggleBtn.textContent = "Full YAML";
      });
    }

    // Copy whichever YAML variant is currently visible; falls back to selecting text
    // in the pre element if clipboard API is unavailable (e.g. insecure context).
    copyBtn.addEventListener("click", () => {
      const text = ctx.state[`_cfgMinimal_${cfg.id}`] ? cfg.minimal : cfg.yaml;
      navigator.clipboard.writeText(text).then(() => {
        copyBtn.textContent = "Copied!";
        setTimeout(() => { copyBtn.textContent = "Copy"; }, 1500);
      }).catch(() => {
        const target = ctx.state[`_cfgMinimal_${cfg.id}`] ? (minWrap || yamlWrap) : yamlWrap;
        target.style.display = "block";
        const pre = target.querySelector("pre");
        const range = document.createRange();
        range.selectNodeContents(pre);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
        copyBtn.textContent = "Select failed — copy manually";
        setTimeout(() => { copyBtn.textContent = "Copy"; }, 2000);
      });
    });

    return el("div", { class: "card", style: "border:1px solid #1a2e22" }, [headerRow, notesList, minWrap, yamlWrap].filter(Boolean));
  });

  // Tips card at the bottom
  const tips = el("div", { class: "bt-panel" }, [
    el("div", { style: "font-weight:700;margin-bottom:6px" }, "Tips for Best Results"),
    el("div", { class: "muted", style: "display:flex;flex-direction:column;gap:6px;font-size:12px;line-height:1.55" }, [
      el("div", {}, "1. Use Ethernet S3 boards for dedicated rooms — 3x the scan coverage of WiFi scanners."),
      el("div", {}, "2. Place scanners at chest height (1.2 m) for best RSSI consistency with carried devices."),
      el("div", {}, "3. After flashing, check Bluetooth → Scanners tab — PadSpan shows IP, WiFi signal, and SSID automatically from these configs."),
      el("div", {}, "4. The diagnostic sensors (IP, signal, temp) appear in HA as entities and PadSpan reads them with zero extra setup."),
      el("div", {}, "5. For Ethernet boards: adjust the ethernet: section pins to match your specific board (W5500, LAN8720, etc)."),
      el("div", {}, "6. All configs use active: false (passive scanning). PadSpan only needs RSSI — active scanning adds no benefit and wastes airtime."),
    ]),
  ]);

  const result = el("div", {}, [intro, antennaCard, recCard, irkCaptureCard, chipTable, ...configCards, tips].filter(Boolean));
  ctx.state._esphomeConfigsDom = result;
  return result;
}

// ── SVG text escaping ───────────────────────────────────────────────────────
// Escape HTML entities for safe inclusion in SVG innerHTML strings.
// Required because labels may contain user-supplied text (device names, etc.).
function _escSvg(s) {
  return String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
