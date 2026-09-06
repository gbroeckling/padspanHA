// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
// See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
// PadSpan HA – Follow view
// Real-time tag tracker: pick a tag, see its current room + floor, movement log, and alert config.
// Position updates arrive via the existing 5s live-snapshot poll — no extra timers needed.

export function render(ctx) {
  const { el, esc, helpBtn, radioShortId } = ctx.helpers;
  const _sid = (source) => radioShortId ? radioShortId(source || "") : "";
  const isBasic = ctx.state.complexity === "basic";

  const snap     = (ctx.state.live && ctx.state.live.snapshot) || null;
  const dataMode = ctx.state.dataMode || "sample";

  // All tracked objects from snapshot
  const allObjects = (snap && snap.objects && Array.isArray(snap.objects.list)) ? snap.objects.list : [];
  const haAreas    = (ctx.state.model && Array.isArray(ctx.state.model.areas))  ? ctx.state.model.areas  : [];
  const haFloors   = (ctx.state.model && Array.isArray(ctx.state.model.floors)) ? ctx.state.model.floors : [];
  const radios     = (snap && snap.ble && Array.isArray(snap.ble.radios)) ? snap.ble.radios : [];
  const ads        = (snap && snap.ble && Array.isArray(snap.ble.advertisements)) ? snap.ble.advertisements : [];

  // ── Persistent state ────────────────────────────────────────────────────────
  if (!ctx.state.followAddr) ctx.state.followAddr = "";
  if (!ctx.state.followAlertConfig) ctx.state.followAlertConfig = {}; // addr → {email, on_change, watch_rooms:[]}

  // ── Resolve chosen object ────────────────────────────────────────────────────
  const addr   = ctx.state.followAddr || "";
  const chosen = addr ? (allObjects.find(o => {
    const id = o.address||o.entity_id||"";
    if (id === addr || id.toUpperCase() === addr.toUpperCase()) return true;
    // Also match by key or canonical_id (ibeacon/private_ble use stable keys).
    // Case-insensitive: followed_addrs are stored uppercase while backend
    // object keys are lowercase ("ibeacon:...", "irk:...").
    const addrU = addr.toUpperCase();
    if (o.key === addr || o.canonical_id === addr) return true;
    if ((o.key && String(o.key).toUpperCase() === addrU) ||
        (o.canonical_id && String(o.canonical_id).toUpperCase() === addrU)) return true;
    // Match rotating MACs
    if (o.all_addresses && o.all_addresses.some(a => String(a).toUpperCase() === addr.toUpperCase())) return true;
    return false;
  }) || null) : null;

  // Movement log (gap #17, best-in-class roadmap: unify Follow's history
  // onto the SAME server API history.js's Movement tab and manage.js's
  // History tab already share, instead of a THIRD independent client-side
  // tracker — this one previously an in-memory ring buffer, reset on every
  // page reload, that only ever saw room labels this browser tab happened
  // to be open for. Keyed on the resolved object's own canonical `key`
  // (what presence_coordinator.py/movement_store.py actually record
  // under `device`) rather than the raw followed address, which does not
  // always match it (rotating MACs, ibeacon/private_ble keys).
  const movementKey = chosen ? chosen.key : null;
  if (movementKey && ctx.state._followMovementKey !== movementKey) {
    ctx.state._followMovementKey = movementKey;
    ctx.state._followMovementEntries = null;
    ctx.actions.wsCall("padspan_ha/movement_history_get", { device: movementKey, limit: 60 }).then(r => {
      if (ctx.state._followMovementKey !== movementKey) return;   // superseded by a later selection
      ctx.state._followMovementEntries = (r && r.entries) || [];
      ctx.actions.renderRooms();
    }).catch(() => {
      if (ctx.state._followMovementKey === movementKey) ctx.state._followMovementEntries = [];
    });
  }

  // ── Header ──────────────────────────────────────────────────────────────────
  const header = el("div", { class: "row", style: "margin-bottom:14px" }, [
    el("div", { class: "grow" }, [
      el("div", { class: "row", style: "align-items:center;gap:8px" }, [
        el("div", { class: "h1" }, "Follow"),
        helpBtn("follow"),
      ]),
      el("div", { class: "muted" }, isBasic
        ? "Track exactly where a person or object is right now."
        : "Track a tag's real-time location. Position updates every ~5 s in Live mode."),
    ]),
    dataMode !== "live"
      ? el("span", { class: "badge warn" }, "Sample mode — switch to Live for real data")
      : el("span", { class: "badge" }, "Live · auto-refresh 5 s"),
  ]);

  // ── Tag selector ─────────────────────────────────────────────────────────────
  const selectorCard = _buildSelector(ctx, el, helpBtn, allObjects, addr, isBasic);

  if (!chosen) {
    return el("div", { id: "follow" }, [header, selectorCard,
      el("div", { class: "card" }, [
        isBasic
          ? el("div", { style: "font-size:16px;font-weight:700;margin-bottom:8px" }, "Choose a tag above to start tracking it")
          : el("div", { style: "font-weight:700" }, "No tag selected"),
        el("div", { class: "muted", style: "margin-top:6px" }, "Use the selector above to choose a tag to follow."),
      ]),
    ]);
  }

  // ── Current status ──────────────────────────────────────────────────────────
  const statusCard = _buildStatus(ctx, el, helpBtn, chosen, haAreas, haFloors, ads, dataMode, isBasic);

  // ── Mini-map (room grid with tag highlighted) ────────────────────────────────
  const mapCard = _buildMapCard(ctx, el, helpBtn, snap, chosen, haAreas, haFloors, radios);

  // ── Movement log (advanced only) ─────────────────────────────────────────────
  const logCard = isBasic ? null : _buildLog(el, ctx.state._followMovementEntries);

  // ── Alert config ─────────────────────────────────────────────────────────────
  const alertCard = _buildAlerts(ctx, el, helpBtn, addr, chosen, haAreas, dataMode, isBasic);

  return el("div", { id: "follow" }, [header, selectorCard, statusCard, mapCard, logCard, alertCard].filter(Boolean));
}

// ── Tag selector card ──────────────────────────────────────────────────────────
function _buildSelector(ctx, el, helpBtn, allObjects, currentAddr, isBasic) {
  const card = el("div", { class: "card", style: "margin-bottom:10px" });

  card.appendChild(el("div", { class: "card-head" }, [
    el("div", { class: isBasic ? "h2" : "muted", style: isBasic ? "" : "font-size:12px" }, "Choose a tag to follow"),
    helpBtn("follow_selector"),
  ]));

  // Sort: strongest RSSI first (identified objects with no RSSI sort after those with RSSI)
  const sorted = [...allObjects].sort((a, b) => {
    const ra = a.rssi ?? -999, rb = b.rssi ?? -999;
    if (ra !== rb) return rb - ra;
    if (!!a.identified !== !!b.identified) return a.identified ? -1 : 1;
    const na = a.user_label || a.name || a.entity_id || a.address || "";
    const nb = b.user_label || b.name || b.entity_id || b.address || "";
    return na.localeCompare(nb);
  });

  const _quietMode = !!(ctx.state.settings && ctx.state.settings.quiet_mode);
  const _isScanner = ctx.helpers.isScanner;

  // Build flat list of selectable items
  const items = [];
  for (const o of sorted) {
    const id = o.address || o.entity_id || "";
    if (!id) continue;
    if (_isScanner(o)) continue;
    if (_quietMode && !o.user_label && !o.identified && !ctx.actions.followedHas(id)) continue;
    const name = o.user_label || o.private_ble_name || o.name || o.entity_id || id;
    const room = o.room ? ` · ${o.room}` : "";
    const rssiStr = o.rssi != null ? ` (${o.rssi} dBm)` : "";
    const kind = o.kind === "entity" ? "[Entity]" : (o.identified ? "[Tagged]" : "[Unidentified]");
    items.push({ id, label: `${kind} ${name}${room}${rssiStr}`, search: `${name} ${o.room || ""} ${id}`.toLowerCase() });
  }

  // Current selection display
  const currentItem = items.find(i => i.id === currentAddr);

  // Search input
  const wrap = document.createElement("div");
  wrap.style.cssText = "position:relative";

  const input = document.createElement("input");
  input.type = "text";
  input.placeholder = currentItem ? currentItem.label : "Search tags...";
  input.className = "select";
  input.style.cssText = "width:100%;box-sizing:border-box;cursor:text";
  input.value = "";

  // Clear button (visible when a tag is selected)
  const clearBtn = document.createElement("button");
  clearBtn.textContent = "\u00d7";
  clearBtn.style.cssText = "position:absolute;right:8px;top:50%;transform:translateY(-50%);background:none;border:none;color:#94a3b8;font-size:18px;cursor:pointer;padding:2px 6px;display:" + (currentAddr ? "block" : "none");
  clearBtn.addEventListener("click", (ev) => {
    ev.stopPropagation();
    ctx.state.followAddr = "";
    ctx.actions.renderRooms();
  });

  // Dropdown results list
  const list = document.createElement("div");
  list.style.cssText = "position:absolute;left:0;right:0;top:100%;max-height:280px;overflow-y:auto;background:#1e293b;border:1px solid #334155;border-radius:0 0 8px 8px;z-index:100;display:none";

  const _select = (id) => {
    list.style.display = "none";
    input.value = "";
    ctx.state.followAddr = id;
    if (id && !ctx.actions.followedHas(id)) {
      ctx.actions.followedToggle(id);
      return;
    }
    ctx.actions.renderRooms();
  };

  const _renderList = (query) => {
    list.innerHTML = "";
    const q = (query || "").toLowerCase().trim();
    const filtered = q ? items.filter(i => i.search.includes(q)) : items;
    if (!filtered.length) {
      const empty = document.createElement("div");
      empty.style.cssText = "padding:10px 12px;color:#64748b;font-size:12px";
      empty.textContent = q ? "No matches" : "No tags available";
      list.appendChild(empty);
      return;
    }
    for (const item of filtered.slice(0, 50)) {
      const row = document.createElement("div");
      row.style.cssText = "padding:8px 12px;font-size:13px;color:#e2e8f0;cursor:pointer;border-bottom:1px solid #1e293b";
      row.textContent = item.label;
      row.addEventListener("mouseenter", () => { row.style.background = "#334155"; });
      row.addEventListener("mouseleave", () => { row.style.background = ""; });
      row.addEventListener("mousedown", (ev) => { ev.preventDefault(); _select(item.id); });
      if (item.id === currentAddr) row.style.cssText += ";background:#1a3a2a;color:#52b788;font-weight:600";
      list.appendChild(row);
    }
  };

  input.addEventListener("focus", () => {
    _renderList(input.value);
    list.style.display = "block";
  });
  input.addEventListener("input", () => {
    _renderList(input.value);
    list.style.display = "block";
  });
  input.addEventListener("blur", () => {
    // Small delay so mousedown on list items fires first
    setTimeout(() => { list.style.display = "none"; }, 150);
  });

  wrap.appendChild(input);
  wrap.appendChild(clearBtn);
  wrap.appendChild(list);
  card.appendChild(wrap);
  return card;
}

// ── Current status card ────────────────────────────────────────────────────────
function _buildStatus(ctx, el, helpBtn, chosen, haAreas, haFloors, ads, dataMode, isBasic) {
  const _rsid = ctx.helpers.radioShortId || (() => "");
  const _sid = (source) => _rsid(source || "");
  const obj    = chosen;
  const userLabel = obj.user_label || "";
  const name   = userLabel || obj.name || obj.entity_id || obj.address || "Unknown";
  const room   = obj.room || "—";
  const addr   = obj.address || "";
  // Resolve canonical address for tag/rename (same logic as _showObjectDetail)
  const kind = obj.kind || "";
  const tagAddr = kind === "private_ble" ? (obj.canonical_id || addr)
                : kind === "ibeacon"     ? (obj.key || obj.address || "")
                : addr;
  const canRename = (kind==="ble"||kind==="private_ble"||kind==="ibeacon") && !!tagAddr;

  // Floor from HA area
  const haArea  = haAreas.find(a => a.name === room);
  const haFloor = haFloors.find(f => f.id === (haArea?.floor_id || ""));
  const floor   = haFloor ? haFloor.name : "—";

  // Radios seeing this tag (from advertisements) — match by address, all_addresses, or _xref
  const allAddr = new Set();
  if (addr) allAddr.add(addr.toUpperCase());
  for (const a of (obj.all_addresses || [])) allAddr.add(String(a).toUpperCase());
  const seenBy = ads
    .filter(a => {
      if (!a.address) return false;
      if (allAddr.has(a.address.toUpperCase())) return true;
      const xr = a._xref;
      if (xr && xr.canonical_id && xr.canonical_id === obj.canonical_id) return true;
      return false;
    })
    .sort((a, b) => (b.rssi || -999) - (a.rssi || -999));

  const rssiClass = v => {
    if (v >= -60) return "badge";
    if (v >= -80) return "badge warn";
    return "badge err";
  };

  const lastSeen = (() => {
    if (!seenBy.length) return null;
    const s = seenBy[0].age_s;
    if (s == null) return null;
    const v = Math.max(0, Math.round(Number(s)));
    if (v < 60) return `${v}s ago`;
    return `${Math.round(v / 60)}m ago`;
  })();

  const statusBadge = obj.identified
    ? el("span", { class: "badge" }, "identified")
    : el("span", { class: "badge warn" }, "unidentified");
  const knnBadge = obj.knn_confidence > 0
    ? el("span", { class: "badge", style: "background:#1a3a2a;color:#52b788;border:1px solid #2d6a4f" },
        `Calibrated ${Math.round(obj.knn_confidence * 100)}%`)
    : null;

  // Rename button (inline — uses same tagObjectPrompt as Details modal)
  const renameBtn = canRename ? el("button", {class:"btn inline", style:"font-size:11px;padding:2px 8px",
    onclick:()=> ctx.actions.tagObjectPrompt(tagAddr, userLabel)
  }, userLabel ? "Rename" : "Name this tag") : null;

  if (isBasic) {
    // Basic mode: large room name + floor, simple last-seen
    const detailsBtnBasic = el("button", {class:"btn inline", style:"margin-left:auto",
      onclick:()=> ctx.actions.showObjectDetail(obj)
    }, "Details →");
    return el("div", { class: "card", style: "margin-bottom:10px" }, [
      el("div", { class: "card-head" }, [
        el("div", { class: "h2" }, name),
        renameBtn,
        knnBadge,
        helpBtn("follow_map"),
        detailsBtnBasic,
      ].filter(Boolean)),
      el("div", { style: "margin-top:8px" }, [
        el("div", { class: "muted", style: "font-size:12px" }, "Currently in"),
        el("div", { style: "font-size:28px;font-weight:800;color:#52b788;margin-top:2px" }, room),
        floor !== "—" ? el("div", { class: "muted", style: "margin-top:4px" }, `Floor: ${floor}`) : null,
        lastSeen ? el("div", { class: "muted", style: "margin-top:8px" }, `Last seen: ${lastSeen}`) : null,
      ].filter(Boolean)),
    ]);
  }

  const radiosEl = seenBy.length
    ? el("div", { style: "display:flex;flex-wrap:wrap;gap:6px;margin-top:6px" },
        seenBy.map(a => el("span", { class: rssiClass(a.rssi || -999) },
          `${_sid(a.source||"")}${_sid(a.source||"")?" ":""}${ctx.helpers.radioName(a.source||"")||(a.source||"?")} ${a.rssi != null ? a.rssi + " dBm" : ""}`
        ))
      )
    : el("div", { class: "muted", style: "margin-top:4px;font-size:12px" }, "No active detections");

  return el("div", { class: "card", style: "margin-bottom:10px" }, [
    el("div", { style: "display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:8px" }, [
      el("div", { style: "font-size:18px;font-weight:800;color:#e2e8f0" }, name),
      renameBtn,
      statusBadge,
      knnBadge,
      el("button", {class:"btn inline", style:"margin-left:auto",
        onclick:()=> ctx.actions.showObjectDetail(obj)
      }, "Details →"),
    ].filter(Boolean)),
    el("div", { class: "grid-2" }, [
      el("div", {}, [
        el("div", { class: "muted", style: "font-size:11px" }, "Current room"),
        el("div", { style: "font-size:20px;font-weight:700;color:#52b788;margin-top:2px" }, room),
        el("div", { class: "muted", style: "font-size:11px;margin-top:2px" }, `Floor: ${floor}`),
      ]),
      el("div", {}, [
        el("div", { class: "muted", style: "font-size:11px" }, "Detected by"),
        radiosEl,
        lastSeen ? el("div", { class: "muted", style: "font-size:11px;margin-top:4px" }, `Last seen: ${lastSeen}`) : null,
      ].filter(Boolean)),
    ]),
    addr ? el("div", { class: "muted", style: "font-size:11px;margin-top:8px" }, `Address: ${addr}`) : null,
  ].filter(Boolean));
}

// ── Mini-map ───────────────────────────────────────────────────────────────────
function _buildMapCard(ctx, el, helpBtn, snap, chosen, haAreas, haFloors, radios) {
  const roomTagMap = ctx.state.roomTagMap || {};
  const allObjects = (snap && snap.objects && Array.isArray(snap.objects.list)) ? snap.objects.list : [];

  const chosenRoom = chosen.room || "";
  const chosenAddr = chosen.address || chosen.entity_id || "";

  // Build room list
  const roomSet = new Set(haAreas.map(a => a.name));
  for (const r of Object.keys(roomTagMap)) roomSet.add(r);
  const rooms = Array.from(roomSet).sort();

  if (!rooms.length) {
    return el("div", { class: "card", style: "margin-bottom:10px" }, [
      el("div", { class: "muted" }, "No rooms configured. Add areas in HA Settings → Areas & Zones."),
    ]);
  }

  // Radio→room mapping
  const radiosByRoom = {};
  for (const r of radios) {
    const a = r.area_name || "";
    if (a) (radiosByRoom[a] = radiosByRoom[a] || []).push(r);
  }

  const COLS = 2, BW = 380, BH = 170, GAP = 16, PX = 14, PY = 14;
  const rows = Math.ceil(rooms.length / COLS);
  const svgW = COLS * (BW + GAP) - GAP + PX * 2;
  const svgH = rows * (BH + GAP) - GAP + PY * 2;
  const PALETTE = ["#52b788","#4caf50","#43a047","#388e3c","#66bb6a","#81c784","#a5d6a7","#2e7d32"];
  const _esc = s => String(s||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");

  let s = `<svg viewBox="0 0 ${svgW} ${svgH}" xmlns="http://www.w3.org/2000/svg" width="100%" style="display:block;font-family:system-ui,sans-serif">`;
  s += `<rect width="${svgW}" height="${svgH}" fill="#071008" rx="8"/>`;

  rooms.forEach((room, idx) => {
    const col = idx % COLS;
    const row = Math.floor(idx / COLS);
    const x = PX + col * (BW + GAP);
    const y = PY + row * (BH + GAP);
    const isActive = room === chosenRoom;
    const color = PALETTE[idx % PALETTE.length];
    const strokeW = isActive ? "3" : "1.5";
    const fillOp = isActive ? "22" : "10";

    s += `<rect x="${x}" y="${y}" width="${BW}" height="${BH}" fill="${color}${fillOp}" stroke="${color}" stroke-width="${strokeW}" rx="10"/>`;
    // Cap the room name so a long HA area name can't overlap the neighboring box.
    const roomName = room.length > 20 ? room.substring(0, 20) + "…" : room;
    s += `<text x="${x + BW/2}" y="${y + 22}" text-anchor="middle" fill="${color}" font-size="16" font-weight="700">${_esc(roomName)}</text>`;

    const haArea  = haAreas.find(a => a.name === room);
    const haFloor = haFloors.find(f => f.id === (haArea?.floor_id || ""));
    if (haFloor) {
      s += `<text x="${x + BW/2}" y="${y + 37}" text-anchor="middle" fill="${color}88" font-size="11">${_esc(haFloor.name)}</text>`;
    }

    // Radios in this room
    const roomRadios = radiosByRoom[room] || [];
    roomRadios.slice(0, 5).forEach((r, ri) => {
      const rx = x + 22 + ri * 52, ry = y + 100;
      s += `<circle cx="${rx}" cy="${ry}" r="14" fill="none" stroke="#52b788" stroke-width="0.7" opacity="0.25"/>`;
      s += `<circle cx="${rx}" cy="${ry}" r="8"  fill="none" stroke="#52b788" stroke-width="1"   opacity="0.5"/>`;
      s += `<circle cx="${rx}" cy="${ry}" r="4"  fill="#52b788"/>`;
    });

    // Chosen tag marker — bright pulsing ring
    if (isActive) {
      const tx = x + BW / 2, ty = y + BH / 2 + 14;
      s += `<circle cx="${tx}" cy="${ty}" r="24" fill="none" stroke="#5eead4" stroke-width="1.5" opacity="0.3">`;
      s += `<animate attributeName="r" values="18;30;18" dur="2s" repeatCount="indefinite"/>`;
      s += `<animate attributeName="opacity" values="0.4;0.1;0.4" dur="2s" repeatCount="indefinite"/>`;
      s += `</circle>`;
      s += `<circle cx="${tx}" cy="${ty}" r="13" fill="#5eead4" opacity="0.2"/>`;
      s += `<circle cx="${tx}" cy="${ty}" r="9"  fill="#5eead4" opacity="0.95"/>`;
      s += `<circle cx="${tx}" cy="${ty}" r="4.5" fill="#071008"/>`;
      const lbl = (chosen.user_label || chosen.name || "Tag").substring(0, 14);
      s += `<text x="${tx}" y="${ty + 26}" text-anchor="middle" fill="#5eead4" font-size="11" font-weight="600">${_esc(lbl)}</text>`;
    }
  });

  s += `</svg>`;

  const wrap = document.createElement("div");
  wrap.innerHTML = s;

  return el("div", { class: "card", style: "margin-bottom:10px" }, [
    el("div", { class: "card-head" }, [
      el("div", { class: "h2" }, "Location map"),
      helpBtn("follow_map"),
    ]),
    el("div", { class: "muted", style: "margin-bottom:10px;font-size:12px" },
      chosenRoom
        ? `Showing: ${chosen.user_label || chosen.name || "Tag"} is in ${chosenRoom}`
        : "Tag has no room assignment yet."),
    wrap,
  ]);
}

// ── Movement log ───────────────────────────────────────────────────────────────
function _buildLog(el, history) {
  const card = el("div", { class: "card", style: "margin-bottom:10px" });
  card.appendChild(el("div", { class: "h2" }, "Movement log"));

  if (history === null) {
    card.appendChild(el("div", { class: "muted", style: "margin-top:6px" }, "Loading…"));
    return card;
  }
  if (!history.length) {
    card.appendChild(el("div", { class: "muted", style: "margin-top:6px" }, "No movement recorded yet for this tag."));
    return card;
  }

  // Server timestamps are epoch SECONDS (movement_store.py's time.time()),
  // not the milliseconds this card's own client-side clock used to hand it.
  const fmtTs = ts => {
    try {
      const d = new Date(ts * 1000);
      return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    } catch { return ""; }
  };

  const rows = [...history].reverse().slice(0, 30);
  const table = el("table", { class: "table", style: "margin-top:8px" }, [
    el("thead", {}, el("tr", {}, [
      el("th", {}, "Time"),
      el("th", {}, "Room"),
      el("th", {}, ""),
    ])),
    el("tbody", {}, rows.map((entry) => {
      // A first-ever room confirmation is recorded with `from` unset (gap
      // #17, best-in-class roadmap) — the same distinction history.js's
      // Movement tab now makes, so the two views agree on what this means.
      const firstSeen = !entry.from;
      const detail = firstSeen
        ? el("td", { style: "font-size:11px;color:#a78bfa;font-weight:600" }, "✨ First seen")
        : el("td", { class: "muted", style: "font-size:11px" }, `← ${entry.from}`);
      return el("tr", {}, [
        el("td", { class: "mono", style: "font-size:11px;color:#94a3b8" }, fmtTs(entry.ts)),
        el("td", { style: "font-weight:600;color:#5eead4" }, entry.to || "—"),
        detail,
      ]);
    })),
  ]);
  card.appendChild(table);
  return card;
}

// ── Alert configuration (per-device, inline in Follow) ────────────────────────
function _buildAlerts(ctx, el, helpBtn, addr, chosen, haAreas, dataMode, isBasic) {
  const cfg = ctx.state.followAlertConfig[addr] || {};
  const name = chosen.user_label || chosen.name || addr || "tag";
  const saved = !!(cfg.email && cfg.on_room_change);

  const card = el("div", { class: "card" });
  card.appendChild(el("div", { class: "card-head" }, [
    el("div", { class: "h2" }, "Movement Alerts"),
    saved ? el("span",{class:"badge",style:"border-color:#52b788;color:#52b788;font-size:10px;margin-left:8px"},"Active") : null,
    helpBtn("follow_alerts"),
  ].filter(Boolean)));

  card.appendChild(el("div", { class: "muted", style: "font-size:12px;margin-bottom:12px" },
    "Email notifications when this tag moves rooms. Sent via HA's notify service."
  ));

  // Email input
  const emailInput = el("input", {
    class: "input", type: "email", placeholder: "email@example.com",
    value: cfg.email || "", style: "max-width:260px",
  });
  emailInput.addEventListener("input", e => {
    cfg.email = e.target.value;
    ctx.state.followAlertConfig[addr] = cfg;
  });

  // Notify service selector (loads once, cached in state)
  const serviceSelect = el("select", { class: "input", style: "max-width:200px" });
  const _noSvcHint = el("div", { style: "font-size:10px;color:#f59e0b;margin-top:2px;display:none" },
    "No notify services found — add SMTP or another notification integration in HA Settings → Integrations");
  serviceSelect.appendChild(el("option", { value: "" }, "Auto-detect"));
  if(!ctx.state._notifyServices){
    ctx.state._notifyServices = [];
    ctx.actions.wsCall("padspan_ha/notify_services_list", {}).then(r => {
      ctx.state._notifyServices = (r && r.services) || [];
      if (!ctx.state._notifyServices.length) _noSvcHint.style.display = "block";
      for(const svc of ctx.state._notifyServices){
        const opt = document.createElement("option");
        opt.value = svc; opt.textContent = svc;
        if(cfg.notify_service === svc) opt.selected = true;
        serviceSelect.appendChild(opt);
      }
    }).catch(() => { _noSvcHint.style.display = "block"; });
  } else {
    if (!ctx.state._notifyServices.length) _noSvcHint.style.display = "block";
    for(const svc of ctx.state._notifyServices){
      const opt = el("option", { value: svc }, svc);
      if(cfg.notify_service === svc) opt.selected = true;
      serviceSelect.appendChild(opt);
    }
  }
  serviceSelect.addEventListener("change", () => {
    cfg.notify_service = serviceSelect.value || undefined;
    ctx.state.followAlertConfig[addr] = cfg;
  });

  // On-change toggle
  const chkChange = el("input", { type: "checkbox" });
  if (cfg.on_room_change) chkChange.checked = true;
  chkChange.addEventListener("change", () => {
    cfg.on_room_change = chkChange.checked;
    ctx.state.followAlertConfig[addr] = cfg;
  });

  const saveStatus = el("span", { class: "muted", style: "font-size:11px" });
  const saveBtn = el("button", { class: "btn", style: "margin-top:10px" }, "Save");
  saveBtn.addEventListener("click", async () => {
    if (dataMode !== "live") { saveStatus.textContent = "Switch to Live mode first."; return; }
    if (cfg.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(cfg.email)) { saveStatus.textContent = "Invalid email."; return; }
    saveStatus.textContent = "Saving…";
    try {
      await ctx.actions.followAlertSave({ addr, config: cfg });
      saveStatus.textContent = "Saved";
      saveStatus.style.color = "#52b788";
    } catch (e) {
      saveStatus.textContent = "Save failed";
      saveStatus.style.color = "#f87171";
    }
  });

  const testBtn = el("button", { class: "btn", style: "margin-top:10px" }, "Send Test Email");
  testBtn.addEventListener("click", async () => {
    const email = (emailInput.value || "").trim();
    if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      saveStatus.textContent = "Enter a valid email first."; saveStatus.style.color = "#f87171"; return;
    }
    if (dataMode !== "live") { saveStatus.textContent = "Switch to Live mode first."; return; }
    saveStatus.textContent = "Sending test…"; saveStatus.style.color = "";
    testBtn.disabled = true;
    try {
      const svc = serviceSelect ? serviceSelect.value : "";
      await ctx.actions.wsCall("padspan_ha/notify_test", { email, service: svc || undefined });
      saveStatus.textContent = "Test sent — check your inbox."; saveStatus.style.color = "#52b788";
    } catch (e) {
      saveStatus.textContent = "Test failed: " + (e?.message || String(e)).slice(0, 60);
      saveStatus.style.color = "#f87171";
    } finally { testBtn.disabled = false; }
  });

  if (isBasic) {
    card.appendChild(el("div", { style: "display:flex;flex-direction:column;gap:12px" }, [
      el("div",{style:"display:flex;flex-wrap:wrap;gap:10px;align-items:flex-end"}, [
        el("div", {}, [
          el("div", { class: "muted", style: "font-size:11px;margin-bottom:3px" }, "Email address"),
          emailInput,
        ]),
        el("div", {}, [
          el("div", { class: "muted", style: "font-size:11px;margin-bottom:3px" }, "Notify service"),
          serviceSelect,
          _noSvcHint,
        ]),
      ]),
      el("label", { style: "display:flex;align-items:center;gap:8px;cursor:pointer;font-size:13px" }, [
        chkChange, el("span", {}, `Email me when ${name} moves`),
      ]),
    ]));
  } else {
    const watchRooms = cfg.watch_rooms || [];
    const roomNames = haAreas.map(a => a.name).sort();
    const checkboxes = roomNames.map(room => {
      const chk = el("input", { type: "checkbox" });
      if (watchRooms.includes(room)) chk.checked = true;
      chk.addEventListener("change", () => {
        const wr = ctx.state.followAlertConfig[addr]?.watch_rooms || [];
        if (chk.checked) { if (!wr.includes(room)) wr.push(room); }
        else { const i = wr.indexOf(room); if (i >= 0) wr.splice(i, 1); }
        cfg.watch_rooms = wr;
        ctx.state.followAlertConfig[addr] = cfg;
      });
      return el("label", { style: "display:flex;align-items:center;gap:5px;cursor:pointer;font-size:12px" }, [chk, el("span", {}, room)]);
    });

    card.appendChild(el("div", { style: "display:flex;flex-direction:column;gap:12px" }, [
      el("div",{style:"display:flex;flex-wrap:wrap;gap:10px;align-items:flex-end"}, [
        el("div", {}, [
          el("div", { class: "muted", style: "font-size:11px;margin-bottom:3px" }, "Email address"),
          emailInput,
        ]),
        el("div", {}, [
          el("div", { class: "muted", style: "font-size:11px;margin-bottom:3px" }, "Notify service"),
          serviceSelect,
          _noSvcHint,
        ]),
      ]),
      el("label", { style: "display:flex;align-items:center;gap:8px;cursor:pointer;font-size:13px" }, [
        chkChange,
        el("span", {}, `Alert on every room change for "${name}"`),
      ]),
      checkboxes.length ? el("div", {}, [
        el("div", { class: "muted", style: "font-size:11px;margin-bottom:4px" }, "Only alert for these rooms (unchecked = all):"),
        el("div", { style: "display:flex;flex-wrap:wrap;gap:8px" }, checkboxes),
      ]) : null,
    ].filter(Boolean)));
  }

  card.appendChild(el("div",{style:"display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-top:10px"},[saveBtn, testBtn, saveStatus]));
  return card;
}

