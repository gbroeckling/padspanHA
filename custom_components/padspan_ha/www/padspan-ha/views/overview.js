// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
// See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html

// Shared stack transform (P2-5); query inherited from our own module URL so
// the ?b= cache-buster propagates (see docs/06_UI_CACHE_BUSTING.md).
// The metric frame the lights map draws with. Metres in, screen out, no photo
// anywhere in it — the 3D map below uses THIS, and the stack_transform import
// above survives only for the experimental 2D map, which is swept next.
const { fabricFrame } =
  await import(`./iso_lights.js${new URL(import.meta.url).search}`);
// The plan viewer — the one view whose subject IS the photograph.
const { render2DMap } =
  await import(`./plan_viewer.js${new URL(import.meta.url).search}`);

/**
 * Overview — "control tower" dashboard
 *
 * Basic mode:  summary bar (rooms, objects, radios) + 3D iso map with room/beacon dots.
 * Advanced mode:  KPI cards + renderRoomGrid() SVG with heatmap + beacon pins.
 *
 * Data flow:
 *   snapshot.ble.radios            → scanner count & list
 *   snapshot.ble.advertisements    → ad monitor stream
 *   snapshot.objects.list          → all tracked objects (entities + BLE)
 *   snapshot.objects.summary       → counts, OUI breakdown
 *
 * Design rules:
 *   - Every KPI metric is clickable → opens a detail modal with the full list.
 *   - Uses `liveSnap` (not `snap`) — differs from other views. See memory note.
 *   - 3D iso map re-uses the maps list + stack transforms from the Maps tab.
 */

// Who is IN a room is present tense. An object keeps its last known room
// forever so a dropout does not erase where it was, but listing a departed one
// as an occupant says it is still standing there — a car gone for hours stayed
// chipped into the Garage row long after both its entities read not_home.
function _presentInRoom(ctx, o, room){
  if(o.room !== room) return false;
  return !ctx.helpers.isAway(o, ctx.helpers.awayTimeoutS(ctx.state.settings));
}

export function render(ctx){
  const { el, esc, pill, helpBtn, radioShortId } = ctx.helpers;
  const _sid = (source) => radioShortId ? radioShortId(source || "") : "";
  const isBasic = ctx.state.complexity === "basic";

  const fmtNum = (n)=>{
    try{ return new Intl.NumberFormat().format(Number(n||0)); }catch(e){ return String(n||0); }
  };
  const fmtAgo = (sec)=>{
    if(sec==null || isNaN(sec)) return "";
    const s = Math.max(0, Math.round(Number(sec)));
    if(s < 60) return `${s}s ago`;
    const m = Math.round(s/60);
    if(m < 60) return `${m}m ago`;
    const h = Math.round(m/60);
    if(h < 48) return `${h}h ago`;
    const d = Math.round(h/24);
    return `${d}d ago`;
  };

  const dataMode = ctx.state.dataMode || "sample";
  const liveSnap = ctx.state.live?.snapshot || null;

  // When live mode is active but snapshot hasn't arrived yet, show placeholder
  const liveLoading = dataMode === "live" && !liveSnap;

  // Fallback counts based on roomTagMap (works in sample mode too).
  const roomTagMap = liveLoading ? {} : (ctx.state.roomTagMap || {});
  const roomsCount = Object.keys(roomTagMap).length;
  const tagsCount = (() => {
    const s = new Set();
    for(const r of Object.keys(roomTagMap)){
      (roomTagMap[r]||[]).forEach(eid=>s.add(eid));
    }
    return s.size;
  })();

  const objSummary = (liveSnap && liveSnap.objects && liveSnap.objects.summary) ? liveSnap.objects.summary : null;
  const _quietMode = !!(ctx.state.settings && ctx.state.settings.quiet_mode);
  const objectsTotal = objSummary ? (_quietMode ? objSummary.identified : objSummary.total) : tagsCount;
  const unidentifiedCount = objSummary ? objSummary.unidentified : 0;

  const radios = (liveSnap && liveSnap.ble && Array.isArray(liveSnap.ble.radios)) ? liveSnap.ble.radios : [];
  const radiosCount = radios.length;

  // ---------- Modal helpers ----------
  function openRoomsList(){
    const body = el("div",{});
    const rows = Object.keys(roomTagMap).sort().map((room)=>{
      const eids = roomTagMap[room] || [];
      const hasFollowed = eids.some(eid => ctx.actions.followedHas(String(eid)));
      const roomLabel = el("td",{},[
        el("span",{}, room),
        hasFollowed ? el("span",{style:"margin-left:6px;font-size:10px;color:#fbbf24;font-weight:700"}, "\u25C9 tracked") : null,
      ].filter(Boolean));
      const row = el("tr",{},[
        roomLabel,
        el("td",{}, String(eids.length)),
        el("td",{}, eids.join(", "))
      ]);
      row.style.cursor = "pointer";
      row.title = "Click for room details";
      row.addEventListener("click", ()=>{ ctx.actions.closeModal(); ctx.actions.showRoomDetail(room); });
      return row;
    });

    body.appendChild(el("div",{class:"controls"},[
      el("span",{class:"badge"}, `${roomsCount} rooms`),
      el("span",{class:"badge"}, `${tagsCount} mapped entities`)
    ]));

    body.appendChild(el("table",{class:"table"},[
      el("thead",{}, el("tr",{},[
        el("th",{}, "Room"),
        el("th",{}, "Mapped entities"),
        el("th",{}, "Entity IDs")
      ])),
      el("tbody",{}, rows.length?rows:el("tr",{}, el("td",{colspan:3}, "No rooms in current map.")))
    ]));

    ctx.actions.openModal("Rooms", body, "Current room→entity map");
  }

  function openRadiosList(){
    const body = el("div",{});
    const r = radios || [];
    const areas = (liveSnap && Array.isArray(liveSnap.rooms_discovered)) ? liveSnap.rooms_discovered : [];
    body.appendChild(el("div",{class:"controls"},[
      el("span",{class:"badge"}, `${r.length} radios`),
      el("span",{class:"badge"}, "Areas read from HA device registry"),
    ]));
    const rows = r.map((x)=>{
      const assignBtn = el("button",{class:"btn tiny"}, x.area_name ? "Change" : "Assign");
      assignBtn.addEventListener("click",(e)=>{
        e.stopPropagation();
        openAreaAssign(x, areas);
      });
      const areaCell = el("td",{});
      if(x.disabled){
        areaCell.appendChild(el("span",{class:"badge warn",style:"background:rgba(148,100,220,.18);color:#c084fc;margin-right:4px"},"⊘ Disabled"));
      } else if(x.lost){
        areaCell.appendChild(el("span",{class:"badge warn",style:"background:rgba(245,158,11,.18);color:#f59e0b;margin-right:4px"},"⚠ Lost"));
      }
      areaCell.appendChild(document.createTextNode(x.area_name || (x.disabled||x.lost ? "" : "—")));
      const _ovRn = ctx.helpers.radioName(x.source);
      const tr = el("tr",{},[
        el("td",{style:"font-family:monospace;font-weight:700;font-size:12px;letter-spacing:.04em",title:(_ovRn?_ovRn+" \u00b7 ":"")+(x.source||"")}, _sid(x.source)),
        el("td",{}, x.name || ""),
        el("td",{}, x.source || ""),
        el("td",{}, (x.adapter!=null?String(x.adapter):"")),
        el("td",{}, (x.scanning==null?"":String(x.scanning))),
        el("td",{}, (x.connectable==null?"":String(x.connectable))),
        areaCell,
        el("td",{}, assignBtn),
      ]);
      tr.style.cursor = "pointer";
      tr.title = "Click for scanner details";
      tr.addEventListener("click",(e)=>{
        if(e.target.tagName==="BUTTON") return;
        ctx.actions.closeModal(); ctx.actions.showScannerDetail(x);
      });
      return tr;
    });

    body.appendChild(el("table",{class:"table"},[
      el("thead",{}, el("tr",{},[
        el("th",{}, "ID"),
        el("th",{}, "Name"),
        el("th",{}, "Source"),
        el("th",{}, "Adapter"),
        el("th",{}, "Scanning"),
        el("th",{}, "Connectable"),
        el("th",{}, "Area"),
        el("th",{}, ""),
      ])),
      el("tbody",{}, rows.length?rows:el("tr",{}, el("td",{colspan:8}, "No radios found. (Switch to Live mode + ensure Bluetooth is enabled in HA.)")))
    ]));
    ctx.actions.openModal("Bluetooth Radios", body, "ID = 3-letter label code · Areas read from HA device registry");
  }

  function openAreaAssign(radio, areas){
    const sid = _sid(radio.source);
    if(dataMode !== "live"){
      ctx.toast("Area assignment requires Live mode.", true);
      return;
    }
    const sel = el("select",{class:"select"});
    sel.appendChild(el("option",{value:""},"— No area (clear) —"));
    for(const a of areas){
      const opt = el("option",{value:a}, a);
      if(a === radio.area_name && !radio.lost && !radio.disabled) opt.selected = true;
      sel.appendChild(opt);
    }
    // Lost sentinel — always at bottom, visually distinct
    const lostOpt = el("option",{value:"__lost__"}, "⚠  Lost  —  exclude from location math");
    lostOpt.style.color = "#f59e0b";
    if(radio.lost) lostOpt.selected = true;
    sel.appendChild(lostOpt);
    // Disabled sentinel — below Lost
    const disabledOpt = el("option",{value:"__disabled__"}, "⊘  Disabled  —  intentionally off");
    disabledOpt.style.color = "#c084fc";
    if(radio.disabled) disabledOpt.selected = true;
    sel.appendChild(disabledOpt);

    const status = el("div",{class:"muted", style:"min-height:20px;margin-top:6px"});
    const saveBtn = el("button",{class:"btn"}, "Save");
    const cancelBtn = el("button",{class:"btn inline"}, "Cancel");
    cancelBtn.addEventListener("click", ()=>ctx.actions.closeModal());
    saveBtn.addEventListener("click", async ()=>{
      const v = sel.value;
      saveBtn.disabled = true;
      try {
        if(v === "__lost__"){
          if(radio.disabled) await ctx.actions.radioDisabledSet(radio.source, false);
          await ctx.actions.radioLostSet(radio.source, true);
          ctx.actions.closeModal();
          ctx.toast(`"${radio.name || radio.source}" marked as Lost`);
        } else if(v === "__disabled__"){
          if(radio.lost) await ctx.actions.radioLostSet(radio.source, false);
          await ctx.actions.radioDisabledSet(radio.source, true);
          ctx.actions.closeModal();
          ctx.toast(`"${radio.name || radio.source}" marked as Disabled`);
        } else {
          // Restore from lost/disabled if needed, then set area
          if(radio.lost)     await ctx.actions.radioLostSet(radio.source, false);
          if(radio.disabled) await ctx.actions.radioDisabledSet(radio.source, false);
          const payload = { area_name: v };
          if(radio.device_id) payload.device_id = radio.device_id;
          else if(radio.source) payload.source = radio.source;
          await ctx.actions.radioAreaSet(payload);
          ctx.actions.closeModal();
          ctx.toast(v ? `Area set to "${v}"` : "Area cleared");
        }
        await ctx.actions.refreshSnapshot();
      } catch(e) {
        status.textContent = "Failed to update. Check HA logs.";
        saveBtn.disabled = false;
      }
    });
    const radioLabel = [sid, radio.name || radio.source].filter(Boolean).join("  ·  ");
    const body = el("div",{},[
      el("div",{class:"muted", style:"margin-bottom:8px"}, `Radio: ${radioLabel}`),
      radio.lost     ? el("div",{style:"color:#f59e0b;font-size:12px;margin-bottom:8px"}, "⚠ Currently marked as Lost. Select a room to restore it.") : null,
      radio.disabled ? el("div",{style:"color:#c084fc;font-size:12px;margin-bottom:8px"}, "⊘ Currently Disabled. Select a room to re-enable it.") : null,
      el("div",{style:"color:#94a3b8;font-size:12px;margin-bottom:10px"}, areas.length ? "Select an HA area for this scanner:" : "No HA areas found. Add areas in HA Settings → Areas & Zones."),
      el("div",{class:"row",style:"gap:8px;flex-wrap:wrap"},[sel, saveBtn, cancelBtn]),
      status,
    ].filter(Boolean));
    ctx.actions.openModal("Assign Area", body, `HA area for "${radio.name || radio.source}"`);
  }

  async function fillVendorCell(mac, cell){
    // Cache by prefix (AA:BB:CC)
    ctx.state._vendorCache = ctx.state._vendorCache || {};
    const prefix = (mac||"").split(":").slice(0,3).join(":").toUpperCase();
    if(!prefix){ cell.textContent = ""; return; }

    const cached = ctx.state._vendorCache[prefix];
    if(cached){
      cell.innerHTML = renderVendorHTML(cached);
      return;
    }

    // Placeholder while fetching
    cell.innerHTML = `<span class="badge">Looking up…</span>`;
    try{
      const res = await ctx.actions.vendorLookup(mac, false);
      ctx.state._vendorCache[prefix] = res;
      cell.innerHTML = renderVendorHTML(res);
    }catch(e){
      cell.innerHTML = `<span class="badge err">Lookup failed</span>`;
    }
  }

  function renderVendorHTML(res){
    if(!res || res.enabled === false){
      return `<span class="badge warn">Vendor lookup disabled</span>`;
    }
    const v1 = res.sources?.macvendors || null;
    const v2 = res.sources?.maclookup?.company || null;
    const rand = res.sources?.maclookup?.isRand;
    const priv = res.sources?.maclookup?.isPrivate;
    const flags = [];
    if(rand===true) flags.push("randomized");
    if(priv===true) flags.push("private");
    const top = (v2 || v1 || "Unknown vendor");
    const sub = flags.length ? ` <span class="badge warn">${flags.join(", ")}</span>` : "";
    const bt = res.sources?.maclookup?.blockType ? ` · ${res.sources.maclookup.blockType}` : "";
    return `<div><span class="badge">${escapeHtml(top)}</span>${sub}${escapeHtml(bt)}</div>`;
  }

  function escapeHtml(s){
    return String(s||"").replace(/[&<>"']/g,(c)=>({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;" }[c]));
  }

  function openObjectsList(initialFilter="all"){
    if(!liveSnap || !liveSnap.objects){
      const body = el("div",{},[
        el("p",{}, "Objects list is only available in Live mode (it includes BLE advertisement monitor data)."),
        el("p",{}, "Switch to Live in Settings, then reopen this list.")
      ]);
      ctx.actions.openModal("Objects", body, "Live snapshot required");
      return;
    }

    const list = liveSnap.objects.list || [];
    const summary = liveSnap.objects.summary || {};
    const commonPrefixes = summary.common_prefixes || {};

    // Dedup: suppress entity rows whose device already has a BLE/iBeacon/private_ble row
    const _ovBleAddrSet = new Set();
    for (const o of list) {
      if (o.kind !== "ble" && o.kind !== "private_ble" && o.kind !== "ibeacon") continue;
      if (o.address) _ovBleAddrSet.add(o.address);
      if (Array.isArray(o.all_addresses)) {
        for (const a of o.all_addresses) _ovBleAddrSet.add(String(a).toUpperCase());
      }
    }
    const _ovLinkedSet = new Set(
      list.flatMap(o => Array.isArray(o.linked_entities) ? o.linked_entities : [])
    );
    const _ovIsDup = (o) =>
      o.kind === "entity" && (
        (o.address && _ovBleAddrSet.has(String(o.address).toUpperCase())) ||
        (o.entity_id && _ovLinkedSet.has(o.entity_id))
      );

    // Away detection — the shared rule (panel.js / presence_rules.py)
    const awayTimeoutS = ctx.helpers.awayTimeoutS(ctx.state.settings);
    const _isAway = (o) => ctx.helpers.isAway(o, awayTimeoutS);

    // Time range slider
    const _ageSteps = [300, 900, 3600, 21600, 86400, 259200, 604800];
    const _ageLabels = ["5 min", "15 min", "1 hour", "6 hours", "1 day", "3 days", "1 week"];
    if (ctx.state.objAgeMax == null) ctx.state.objAgeMax = 604800;
    const _ageIdx = _ageSteps.indexOf(ctx.state.objAgeMax);
    const _curIdx = _ageIdx >= 0 ? _ageIdx : _ageSteps.length - 1;

    const body = el("div",{});
    const controls = el("div",{class:"controls"});
    const search = el("input",{type:"text", placeholder:"Search address, name, label…"});
    const kindSel = el("select",{},[
      el("option",{value:"all"}, "All kinds"),
      el("option",{value:"entity"}, "Entities only"),
      el("option",{value:"ble"}, "BLE / beacon devices"),
    ]);
    const statusSel = el("select",{},[
      el("option",{value:"all"}, "All statuses"),
      el("option",{value:"identified"}, "Identified"),
      el("option",{value:"unidentified"}, "Unidentified"),
      el("option",{value:"away"}, "Away"),
    ]);
    statusSel.value = initialFilter === "unidentified" ? "unidentified" : "all";

    const commonOnly = el("label",{style:"display:flex;align-items:center;gap:6px"},[
      el("input",{type:"checkbox"}),
      el("span",{}, "Only common OUIs (≥3)")
    ]);

    const ageLabel = el("span",{class:"muted",style:"white-space:nowrap;font-size:12px"}, _ageLabels[_curIdx]);
    const ageSlider = el("input",{
      type:"range", min:"0", max:String(_ageSteps.length - 1), step:"1",
      value: String(_curIdx),
      style: "width:120px;accent-color:#52b788",
    });
    ageSlider.addEventListener("input", ()=>{
      const idx = Number(ageSlider.value);
      ctx.state.objAgeMax = _ageSteps[idx];
      ageLabel.textContent = _ageLabels[idx];
      apply();
    });

    const stats = el("div",{class:"spacer"});
    controls.appendChild(el("span",{class:"badge"}, `${fmtNum(summary.total||0)} total`));
    controls.appendChild(el("span",{class:"badge"}, `${fmtNum(summary.unidentified||0)} unidentified`));
    controls.appendChild(search);
    controls.appendChild(kindSel);
    controls.appendChild(statusSel);
    controls.appendChild(commonOnly);
    controls.appendChild(el("div",{style:"display:flex;align-items:center;gap:6px"},
      [el("span",{class:"muted",style:"font-size:12px;white-space:nowrap"}, "History:"), ageSlider, ageLabel]));
    controls.appendChild(stats);

    const table = el("table",{class:"table"});
    const thead = el("thead",{}, el("tr",{},[
      el("th",{}, "Kind"),
      el("th",{}, "Name / Entity"),
      el("th",{}, "Address"),
      el("th",{}, "Room"),
      el("th",{}, "Signal"),
      el("th",{}, "Last seen"),
      el("th",{}, "OUI freq"),
      el("th",{}, "Follow"),
      el("th",{}, "Tag"),
      el("th",{}, "Vendor (online)"),
    ]));
    const tbody = el("tbody",{});
    table.appendChild(thead);
    table.appendChild(tbody);

    // Build rows once, then filter by show/hide (fast, no re-render).
    const rowEls = list.map((o)=>{
      // Skip entity rows that duplicate a BLE row for the same physical device
      if(_ovIsDup(o)) return null;

      const kind = o.kind || "";
      const identified = !!o.identified;
      const addr = o.address || "";
      const userLabel = o.user_label || "";
      const name = userLabel || o.name || o.entity_id || "";
      const room = o.room || "";
      const rssi = (o.rssi==null?"":String(o.rssi));
      const lastSeen = o.age_s!=null ? fmtAgo(o.age_s) : (o.last_seen || "");
      const pfxCount = o.prefix_count || 0;
      const pfx = (o.prefix || "").toUpperCase();
      const isCommon = pfx && (commonPrefixes[pfx] || 0) >= 3;

      const vendorCell = el("td",{}, kind==="ble" ? el("span",{class:"badge"}, "—") : el("span",{class:"badge"}, "n/a"));

      // Follow button
      const followKey = addr || o.entity_id || "";
      const followCell = (() => {
        if (!followKey) return el("td",{}, "");
        const isF = ctx.actions.followedHas(followKey);
        const btn = el("button",{
          class: "btn tiny",
          style: isF ? "background:#1a3a2a;border-color:#52b788;color:#52b788" : "",
        }, isF ? "✓ Following" : "Follow");
        btn.addEventListener("click",(e)=>{
          e.stopPropagation();
          ctx.actions.followedToggle(followKey);
          const nowF = ctx.actions.followedHas(followKey);
          btn.textContent = nowF ? "✓ Following" : "Follow";
          btn.style.cssText = nowF ? "background:#1a3a2a;border-color:#52b788;color:#52b788" : "";
        });
        return el("td",{}, btn);
      })();

      // Tag button for BLE/iBeacon/private_ble rows
      const tagCell = (() => {
        const tagAddr = kind === "private_ble" ? (o.canonical_id || addr)
                      : kind === "ibeacon"     ? (o.key || "")
                      : addr;
        if ((kind !== "ble" && kind !== "private_ble" && kind !== "ibeacon") || !tagAddr) return el("td",{}, "");
        const btn = el("button",{class:"btn tiny"}, userLabel ? "Relabel" : "Tag");
        btn.addEventListener("click",(e)=>{
          e.stopPropagation();
          ctx.actions.tagObjectPrompt(tagAddr, userLabel);
        });
        const wrap = el("div",{style:"display:flex;align-items:center;gap:6px"});
        if(userLabel) wrap.appendChild(el("span",{style:"color:#94a3b8;font-size:12px"}, userLabel));
        wrap.appendChild(btn);
        return el("td",{}, wrap);
      })();

      const isAway = _isAway(o);
      const tr = el("tr",{
        "data-kind": kind,
        "data-identified": identified ? "1":"0",
        "data-common": isCommon ? "1":"0",
        "data-age": String(o.age_s != null ? Math.round(o.age_s) : 0),
        "data-search": [
          kind, name, addr, room, userLabel, o.entity_id,
          o.ibeacon_uuid, o.company_name, o.device_type,
          (o.service_names||[]).join(" "),
          o.canonical_id, o.key, o.name, o.private_ble_name,
          (o.all_addresses||[]).join(" "),
          (o.linked_entities||[]).join(" "),
          o.ibeacon_major, o.ibeacon_minor,
          o.vendor, o.device, o.prefix,
          o.first_seen,
          (o.service_uuids||[]).join(" "),
          isAway ? "away" : "",
        ].filter(Boolean).join(" ").toLowerCase(),
        "data-mac": addr,
      },[
        el("td",{}, kind==="ble" ? pill("BLE","") : pill("Entity","")),
        el("td",{}, [
          el("div",{}, name),
          (userLabel && (o.name && o.name !== userLabel) ? el("div",{style:"color:#94a3b8"}, `raw: ${o.name}`) : null),
          (o.entity_id ? el("div",{style:"color:#94a3b8"}, o.entity_id) : null),
          (Array.isArray(o.linked_entities) && o.linked_entities.length ? el("div",{style:"color:#94a3b8"}, `Linked: ${o.linked_entities.join(", ")}`) : null),
          (kind==="ble" && Array.isArray(o.sources) && o.sources.length ? el("div",{style:"color:#94a3b8"}, `Seen by: ${o.sources.map(s=>{const _src=typeof s==="object"?(s.source||""):String(s);const id=_sid(_src);const _fn=ctx.helpers.radioName(_src);return id?id+" "+(_fn||_src):(_fn||_src);}).join(", ")}`) : null),
          ((o.company_name || o.device_type || (o.service_names && o.service_names.length))
            ? el("div",{style:"display:flex;flex-wrap:wrap;gap:4px;margin-top:2px"}, [
                o.company_name ? el("span",{style:"font-size:10px;padding:1px 5px;border-radius:4px;background:#1a2a3a;color:#7dd3fc;border:1px solid #1e4976"}, o.company_name) : null,
                o.device_type  ? el("span",{style:"font-size:10px;padding:1px 5px;border-radius:4px;background:#2a1a3a;color:#c4b5fd;border:1px solid #5b21b6"}, o.device_type) : null,
                ...(o.service_names || []).slice(0,3).map(sn =>
                  el("span",{style:"font-size:10px;padding:1px 5px;border-radius:4px;background:#1a3a2a;color:#86efac;border:1px solid #166534"}, sn)
                ),
              ].filter(Boolean))
            : (kind==="ble" && o.manufacturer_data && Object.keys(o.manufacturer_data).length ? el("div",{style:"color:#94a3b8;font-size:11px"}, `Manuf ID: ${Object.keys(o.manufacturer_data).slice(0,3).join(", ")}`) : null)),
          (o.device && (o.device.manufacturer || o.device.model) ? el("div",{style:"color:#94a3b8"}, `${o.device.manufacturer||""} ${o.device.model||""}`.trim()) : null),
          (o.connectable === true ? el("span",{style:"font-size:9px;color:#52b788"}, "connectable") : null),
        ].filter(Boolean)),
        el("td",{}, addr || "—"),
        // An object keeps its last known room forever — deliberately, so
        // "last seen in the Garage" survives a dropout. But printing it bare
        // asserts the device is THERE: a car gone for an hour still read as
        // "Garage" in this column while its own entities said not_home.
        el("td",{}, isAway
          ? el("span",{style:"color:#94a3b8"},[
              el("span",{style:"color:#f87171;font-size:10px;font-weight:600"},"Away"),
              o.last_room ? el("span",{}," · last: "+o.last_room) : null,
            ].filter(Boolean))
          : (room || "—")),
        el("td",{}, rssi ? `${rssi} dBm` : "—"),
        el("td",{}, lastSeen || "—"),
        el("td",{}, pfxCount>=3 ? el("span",{class:"badge warn"}, `${pfxCount}×`) : (pfxCount? String(pfxCount):"")),
        followCell,
        tagCell,
        vendorCell,
      ]);

      tr.style.cursor = "pointer";
      tr.addEventListener("click",(ev)=>{
        if(ev.target.tagName==="BUTTON"||ev.target.tagName==="A") return;
        ctx.actions.closeModal(); ctx.actions.showObjectDetail(o);
      });
      // kick vendor lookup for BLE rows (best-effort, after render)
      tr._vendorCell = vendorCell;
      return tr;
    }).filter(Boolean);

    rowEls.forEach(tr=>tbody.appendChild(tr));

    function apply(){
      const q = (search.value||"").trim().toLowerCase();
      const k = kindSel.value;
      const st = statusSel.value;
      const co = commonOnly.querySelector("input").checked;
      const maxAge = ctx.state.objAgeMax || 604800;

      let shown = 0;

      for(const tr of rowEls){
        const kind = tr.getAttribute("data-kind");
        const idf = tr.getAttribute("data-identified")==="1";
        const common = tr.getAttribute("data-common")==="1";
        const hay = tr.getAttribute("data-search") || "";
        const away = hay.includes(" away");
        const age = Number(tr.getAttribute("data-age") || "0");

        let ok = true;
        // Entity objects always pass the age filter
        if(kind !== "entity" && age > maxAge) ok = false;
        if(q && !hay.includes(q)) ok=false;
        // "ble" filter covers ble, private_ble, and ibeacon (all physical BLE devices)
        if(k === "ble" && kind !== "ble" && kind !== "private_ble" && kind !== "ibeacon") ok = false;
        else if(k!=="all" && k!=="ble" && kind!==k) ok=false;
        if(st==="identified" && !idf) ok=false;
        if(st==="unidentified" && idf) ok=false;
        if(st==="away" && !away) ok=false;
        if(co && !common) ok=false;

        tr.style.display = ok ? "" : "none";
        if(ok) shown++;
      }
      stats.textContent = `${shown} of ${rowEls.length}`;
    }

    search.addEventListener("input", apply);
    kindSel.addEventListener("change", apply);
    statusSel.addEventListener("change", apply);
    commonOnly.querySelector("input").addEventListener("change", apply);
    apply();

    body.appendChild(controls);
    body.appendChild(table);

    ctx.actions.openModal("Objects", body, "Filter + vendor lookup (best-effort)");

    // After modal opens, do vendor lookups for visible BLE rows (limited concurrency).
    const maxLookups = 40;
    const queue = rowEls
      .filter(tr=>tr.getAttribute("data-kind")==="ble")
      .slice(0, maxLookups);

    // lightweight concurrency limiter
    let i = 0;
    const conc = 3;
    const runOne = async ()=>{
      while(i < queue.length){
        const tr = queue[i++];
        if(tr.style.display==="none") continue;
        const mac = tr.getAttribute("data-mac") || "";
        const cell = tr._vendorCell;
        if(mac && cell) await fillVendorCell(mac, cell);
      }
    };
    for(let n=0;n<conc;n++) runOne();
  }

  // The experimental 2D flat map lives in views/plan_viewer.js — it is a
  // PLAN VIEWER, not the house view, and keeping it here made this file
  // impossible to certify photo-free. Called through _render2DMap below.

  // ---------- 3D Iso Floor Stack (uses uploaded maps data + live presence) ----------
  function renderIsoFloorStack(){
    // ── Experimental 2D mode gate ──
    if(ctx.state.settings && ctx.state.settings.overview_2d_mode){
      return render2DMap(ctx, {
        esc: s2 => String(s2||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;"),
        renderRoomGrid,
        radios,
        sid: _sid,
        isScanner: ctx.helpers.isScanner,
      });
    }
    const maps_list = (ctx.state.maps && ctx.state.maps.list) ? ctx.state.maps.list : [];
    // The house view needs a HOUSE, not a photograph of one. It used to bail
    // here when no image had been uploaded, however complete the fabric was.
    const _fabRooms0 = (ctx.state.model || {}).room_geometry_m || {};
    if(!Object.keys(_fabRooms0).length){
      if(liveSnap && liveSnap.floor_plan) return renderFloorPlan(liveSnap.floor_plan);
      return renderRoomGrid();
    }

    const TILE=220, CX=380, CY=590, W=760, BASE_H=940;
    const LAYER_PAL = ["#52b788","#f59e0b","#60a5fa","#e879f9","#fb923c","#34d399","#f87171","#a78bfa"];
    const roomColorFn = ctx.helpers.roomColor;
    const _esc = s=>String(s||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
    if(ctx.state._overviewFloorGap===undefined) ctx.state._overviewFloorGap = ctx.state.settings?.overview_iso_floor_gap ?? 150;
    if(ctx.state._overviewHorizGap===undefined) ctx.state._overviewHorizGap = ctx.state.settings?.overview_iso_horiz_gap ?? 0;
    let _ovFG=ctx.state._overviewFloorGap, _ovHG=ctx.state._overviewHorizGap;
    // Track the actual projected extent — stitched maps can extend well past
    // the fixed W×BASE_H canvas (world x beyond the master's unit square),
    // which used to clip the north-east of the layout.  Reset per build.
    let _isoBB = null;
    // The frame is sized by the BUILDING, never by what is standing outside it.
    // A truck parked in the driveway is legitimately 30 m from the house, and
    // letting its marker grow the bounding box zoomed the whole map out to
    // contain it — the house shrank into the middle and the map stopped being
    // readable. Frozen once the structure is drawn; object markers are then
    // tethered to the edge instead (see _tetherOutside).
    let _isoBBFrozen = false;
    // THE frame. Built from room_geometry_m and the floor registry, so it
    // exists for a house that has never had a photograph uploaded. This
    // replaces a projection that took world coordinates derived from where
    // someone had dragged a picture — which is why deleting a plan used to
    // move the house, and why an unmeasured install drew nothing at all.
    const _fabF = fabricFrame(ctx.state.model, (ctx.state.model || {}).floors || [], _ovFG, _ovHG);
    const _fabOK = !!(_fabF && !_fabF.empty && _fabF.levels && _fabF.levels.length);
    // ── Fabric helpers ──────────────────────────────────────────────────────
    // Declared HERE, above every use. They were defined further down and called
    // at the byLevel grouping ~60 lines earlier: a const arrow in its temporal
    // dead zone, which threw before a single room was drawn and left an empty
    // view with a clean console.
    const _mapFid = m => String(m.stack?.floor_id || m.floor_id || "main");
    const _fabZOf = (fid) => {
      if(!_fabOK) return undefined;
      const r = _fabF.rooms.find(rr => String(rr.floor_id) === String(fid));
      return r ? r.z : undefined;
    };
    // A plan belongs to a floor; the floor has a storey. Reading the storey off
    // the image's own stack level meant re-dragging a picture re-storeyed the
    // house. floor_id is the plan's one legitimate link to the building.
    const _mapZ = (m) => {
      const z = _fabZOf(_mapFid(m));
      return z === undefined ? 0 : z;
    };
    // Scanner geometry in metres, keyed the way the fabric keys it. Null when
    // the fabric has nothing for that source, so an install mid-migration
    // falls back rather than losing a marker.
    const _fabScannerPos = (ctx.state.model || {}).scanner_positions_m || {};
    const _fabScanner = (src) => {
      if(!_fabOK || !src) return null;
      const p = _fabScannerPos[src] || _fabScannerPos[String(src).toUpperCase()];
      if(!p || typeof p.x_m !== "number" || typeof p.y_m !== "number") return null;
      const z = _fabZOf(p.floor_id);
      if(z === undefined) return null;
      const [sx,sy] = _fabF.iso(p.x_m, p.y_m, z);
      return {sx, sy, z};
    };

    const iso = (wx,wy,wz)=>{
      if(_fabOK) return _fabF.iso(wx, wy, wz);
      const p=[CX+(wx-wy)*TILE*0.866+wz*_ovHG, CY+(wx+wy)*TILE*0.5-wz*_ovFG];
      if(_isoBB && !_isoBBFrozen){
        if(p[0]<_isoBB.minX)_isoBB.minX=p[0]; if(p[0]>_isoBB.maxX)_isoBB.maxX=p[0];
        if(p[1]<_isoBB.minY)_isoBB.minY=p[1]; if(p[1]>_isoBB.maxY)_isoBB.maxY=p[1];
      }
      return p;
    };
    // The building's own screen extent, captured when the frame is frozen.
    let _bldgBB = null;
    const OUTSIDE_RING_PX = 34;   // how far past the building an outsider sits
    /**
     * Keep a marker that lies beyond the building visible at the edge.
     *
     * Returns the drawing position and whether the object is genuinely
     * outside. The real position is preserved in the tooltip — this only
     * decides where the dot is painted, so one distant object cannot dictate
     * the zoom level for everything else.
     */
    const _tetherOutside = (px, py) => {
      if(!_bldgBB || !isFinite(_bldgBB.minX)) return {x:px, y:py, outside:false};
      const x0=_bldgBB.minX-OUTSIDE_RING_PX, x1=_bldgBB.maxX+OUTSIDE_RING_PX;
      const y0=_bldgBB.minY-OUTSIDE_RING_PX, y1=_bldgBB.maxY+OUTSIDE_RING_PX;
      const cx=Math.max(x0, Math.min(x1, px)), cy=Math.max(y0, Math.min(y1, py));
      return {x:cx, y:cy, outside:(cx!==px || cy!==py)};
    };
    const pt  = c=>`${Math.round(c[0])},${Math.round(c[1])}`;
    const pts = cs=>cs.map(pt).join(" ");

    const _isScanner = ctx.helpers.isScanner;
    // Re-readable object list — refreshed before each buildIsoSVG call so the
    // 5s poll _updateIsoObjects renders current snapshot data, not stale closure.
    let allObjects = [];
    let allRadios_live = radios;
    function _refreshIsoObjects() {
      const _snap = ctx.state.live?.snapshot;
      const _rawList = (_snap?.objects?.list || []);
      const _allObjRaw = _rawList.filter(o => !_isScanner(o));
      const _isoAddrSet = new Set();
      const _entityRoomByAddr = {};
      for (const o of _allObjRaw) {
        if (o.kind !== "ble" && o.kind !== "private_ble" && o.kind !== "ibeacon") continue;
        if (o.address) _isoAddrSet.add(String(o.address).toUpperCase());
        if (Array.isArray(o.all_addresses)) for (const a of o.all_addresses) _isoAddrSet.add(String(a).toUpperCase());
      }
      const _isoLinkedSet = new Set(_allObjRaw.flatMap(o => Array.isArray(o.linked_entities) ? o.linked_entities : []));
      for (const o of _allObjRaw) {
        if (o.kind !== "entity") continue;
        if (o.room && o.room !== "unknown" && o.room !== "not_home" && o.address) {
          _entityRoomByAddr[String(o.address).toUpperCase()] = o.room;
        }
      }
      allObjects = _allObjRaw.filter(o => {
        if (o.kind === "entity" && (
          (o.address && _isoAddrSet.has(String(o.address).toUpperCase())) ||
          (o.entity_id && _isoLinkedSet.has(o.entity_id))
        )) return false;
        return true;
      }).map(o => {
        if ((o.kind === "ble" || o.kind === "private_ble" || o.kind === "ibeacon") &&
            (!o.room || o.room === "unknown" || o.room === "not_home") && o.address) {
          const eRoom = _entityRoomByAddr[String(o.address).toUpperCase()];
          if (eRoom) return Object.assign({}, o, { room: eRoom });
        }
        return o;
      });
      allRadios_live = (_snap?.ble?.radios) || radios;
    }
    _refreshIsoObjects();

    // Sync _hiddenMapIds from settings (authoritative, fetched on every refresh).
    // Fall back to localStorage only if settings hasn't populated it yet.
    const _savedHiddenIds = ctx.state.settings?.hidden_map_ids;
    if(Array.isArray(_savedHiddenIds)){
      ctx.state.maps._hiddenMapIds = new Set(_savedHiddenIds);
    } else if(!ctx.state.maps._hiddenMapIds){
      try{ ctx.state.maps._hiddenMapIds = new Set(JSON.parse(localStorage.getItem("padspan_hiddenMapIds")||"[]")); }
      catch(e){ ctx.state.maps._hiddenMapIds = new Set(); }
    }
    // Filter hidden maps
    const hiddenIds = ctx.state.maps._hiddenMapIds;
    // Kept only so the per-map receiver/barrier loops below still have
    // something to iterate on a part-migrated install; nothing about the
    // BUILDING is read from it any more.
    const sorted = [...maps_list].filter(m=>!hiddenIds.has(m.id));

    // Group maps by z_level
    const byLevel = new Map();
    for(const m of sorted){
      const z=_mapZ(m);
      if(!byLevel.has(z)) byLevel.set(z,[]);
      byLevel.get(z).push(m);
    }
    const sortedIsoLevels = [...byLevel.keys()].sort((a,b)=>a-b);
    const levelColor = (z) => LAYER_PAL[sortedIsoLevels.indexOf(z) % LAYER_PAL.length];

    // A storey is named by the FLOOR it is, never by the photo someone happened
    // to upload for it. The map legend used to print `m.name||m.id` joined with
    // "+", so a floor traced from two photos read as "Electrical.jpg+Position1"
    // — a filename presented as a fact about the building, and it showed up in
    // Pure Live too because that view borrows this very map element.
    //
    // Resolved the same way the rest of this file already resolves a floor
    // name: the HA floor registry, by the floor_id the maps at that level carry.
    // The fallback is the storey number, NEVER a map name.
    const _floorLabelForLevel = (z) => {
      const haFloors = (ctx.state.model && Array.isArray(ctx.state.model.floors)) ? ctx.state.model.floors : [];
      const seen = [];
      for (const m of (byLevel.get(z) || [])) {
        const fid = String(m.stack?.floor_id || m.floor_id || "");
        if (!fid || seen.some(f => String(f.id) === fid)) continue;
        const flr = haFloors.find(f => String(f.id) === fid);
        if (flr) seen.push(flr);
      }
      if (seen.length) return seen.map(f => f.name || f.id).join(" + ");
      const byLvl = haFloors.find(f => Number(f.level) === Number(z));
      return byLvl ? (byLvl.name || byLvl.id) : `Floor ${sortedIsoLevels.indexOf(z) + 1}`;
    };

    // ── Slider positions: all → l0 → l0+l1 → l1 → l1+l2 → l2 → … ───────────
    // Each position is null (all), a single z-level, or [z0, z1] (adjacent pair).
    const _isoPos = [null];
    for(let _fi=0; _fi<sortedIsoLevels.length; _fi++){
      _isoPos.push(sortedIsoLevels[_fi]);
      if(_fi < sortedIsoLevels.length-1)
        _isoPos.push([sortedIsoLevels[_fi], sortedIsoLevels[_fi+1]]);
    }
    const _getFocusZ   = (idx) => _isoPos[Math.max(0,Math.min(idx,_isoPos.length-1))];
    const _getFocusLbl = (idx) => {
      const pos = _getFocusZ(idx);
      if(pos === null) return "All floors";
      const fl = ctx.state.model?.floors || [];
      const zArr = Array.isArray(pos) ? pos : [pos];
      return zArr.map(z=>{ const f=fl.find(x=>x.level===z); return f?(f.name||`L${z}`):`L${z}`; }).join(" + ");
    };

    // Build room centroid + receiver iso positions for live data overlay
    // _rebuildPositions() is called initially and whenever iso params change (slider)
    // Uses mapTransforms for correct rotation/ref_ar/scale_x_adj alignment.
    // Fabric-first: once the committed metre fabric exists (anchored to the
    // world frame by a measured map), room centroids come from IT — per-photo
    // room_bounds stay only as the un-anchored fallback and for outside maps.
    // Rooms straight out of the fabric, in metres. fabricWorldRooms() divided
    // these by a measured photo's scale and returned NULL when no photo had
    // been measured — so the fabric was only ever drawable through a picture.
    const _isoFabricW = _fabOK
      ? Object.fromEntries(_fabF.rooms.map(r => [r.room, { floor_id: r.floor_id, pts: r.pts }]))
      : null;
    const roomIsoPos = {}, receiverIsoByRoom = {};
    function _rebuildPositions(){
      for(const k of Object.keys(roomIsoPos)) delete roomIsoPos[k];
      for(const k of Object.keys(receiverIsoByRoom)) delete receiverIsoByRoom[k];
      if(_isoFabricW){
        // Which storey a room is on is a fact about the BUILDING. It used to
        // be read off the z_level someone gave a photograph, so a room whose
        // floor had no picture simply did not appear.
        const floorZ = {};
        if(_fabOK){
          for(const r of _fabF.rooms) if(floorZ[r.floor_id] === undefined) floorZ[r.floor_id] = r.z;
        } else {
          for(const m of sorted){
            if(_isOutMap(m)) continue;
            const fid = _mapFid(m);
            if(floorZ[fid] === undefined) floorZ[fid] = _mapZ(m);
          }
        }
        for(const [room,fr] of Object.entries(_isoFabricW)){
          const z = floorZ[fr.floor_id];
          if(z === undefined) continue;
          const cx=fr.pts.reduce((a,p)=>a+p[0],0)/fr.pts.length;
          const cy=fr.pts.reduce((a,p)=>a+p[1],0)/fr.pts.length;
          roomIsoPos[room] = iso(cx, cy, z);
        }
      }
      for(const m of sorted){
        const tf = mapTransforms[m.id]; if(!tf) continue;
        const z = tf.z;
        // Outside maps used to contribute their own room centroids from photo
        // bounds. The fabric holds outdoor rooms too — Shed, Richard's Shed,
        // Top Driveway Entrance are all in it — so there is nothing left here
        // that the loop above has not already placed, in metres.
        for(const r of (m.receivers||[])){
          if(r.room && !receiverIsoByRoom[r.room]){
            // A receiver's place in a room comes from its metres. This still
            // called tf.mapPt after the indoor transforms stopped carrying a
            // projection — the one call site the sweep missed, and it threw
            // inside a render whose failure shows as a blank view.
            const fp = _fabScanner(r.source || r.id || "");
            if(fp) receiverIsoByRoom[r.room] = [fp.sx, fp.sy];
            else if(!_fabOK && tf.mapPt){
              const [wx,wy]=tf.mapPt(r.x||0, r.y||0);
              receiverIsoByRoom[r.room] = iso(wx, wy, z);
            }
          }
        }
      }
    }

    if(ctx.state._overviewIsoFocusIdx === undefined)
      ctx.state._overviewIsoFocusIdx = Math.max(0, Math.min(ctx.state.settings?.overview_iso_focus ?? 0, _isoPos.length-1));
    const hasBounds = !!(_isoFabricW && Object.keys(_isoFabricW).length);

    // ── Fingerprint positioning ─────────────────────────────────────────────
    // Load calibration data the first time (non-blocking; re-renders when ready)
    if(!ctx.state.calibration){
      ctx.actions.calibrationGet().then(d=>{
        ctx.state.calibration = d;
        ctx.actions.renderRooms();
      }).catch(()=>{});
    }
    const calPoints = (ctx.state.calibration?.points) || [];

    // ── Lazy-load radio_map module for 3D heatmap overlay ──────────────────
    const _isoRadioMapOn = !!(ctx.state.settings && ctx.state.settings.radio_map_enabled);
    let _isoRadioMapMod = ctx.state._2dRadioMapMod || null; // reuse same cache
    if (_isoRadioMapOn && !_isoRadioMapMod) {
      import("./radio_map.js?b=" + (ctx.state.buildId || "")).then(mod => {
        ctx.state._2dRadioMapMod = mod;
        ctx.actions.renderRooms();
      }).catch(e => console.warn("PadSpan: radio_map module load failed", e));
    }

    // Per-map coord transform: image-fraction (0-1) → ISO screen pixel
    // Uses the same mapPt formula as the room-polygon renderer so positions align exactly.
    // Built from ALL maps (not just visible) so objects on hidden maps can still be positioned.
    const _OUTSIDE_FID = "__outside__";
    const _isOutMap = m => (m.floor_id || "") === _OUTSIDE_FID;

    // Compute indoor bounding box (union of all non-outside maps) for fitting outside layers
    // The extent of the BUILDING — the union of its rooms in metres. It used
    // to be the union of the four corners of every uploaded image, so a plan
    // photographed with a wide margin made the house bigger.
    let _indoorBB = {minX:Infinity,minY:Infinity,maxX:-Infinity,maxY:-Infinity};
    for(const r of (_fabOK ? _fabF.rooms : [])){
      for(const p of r.pts){
        _indoorBB.minX=Math.min(_indoorBB.minX,p[0]); _indoorBB.minY=Math.min(_indoorBB.minY,p[1]);
        _indoorBB.maxX=Math.max(_indoorBB.maxX,p[0]); _indoorBB.maxY=Math.max(_indoorBB.maxY,p[1]);
      }
    }
    if(!isFinite(_indoorBB.minX)){_indoorBB={minX:0,minY:0,maxX:1,maxY:0.75};}

    // Metres -> world, and a floor's slab height. Positions are metres, so
    // drawing them needs no map id and no per-photo transform.
    // An object knows where it is in metres. This used to be the factor that
    // pushed those metres back into photo-world, and it was NULL without a
    // measured plan — so a perfectly good position was thrown away.
    const _mAnchor = _fabOK ? { m_per_world: 1 } : null;
    const _floorZByFloor = {};
    for(const m of maps_list){
      const fl = String(m.stack?.floor_id || m.floor_id || "main");
      if(_floorZByFloor[fl] === undefined) _floorZByFloor[fl] = _mapZ(m);
    }
    const _floorZ = (fl) => (fl && _floorZByFloor[String(fl)] !== undefined)
      ? _floorZByFloor[String(fl)] : 0;

    const mapTransforms = {};
    for(const m of maps_list){
      const z=_mapZ(m);
      if(_isOutMap(m)){
        // Outside maps: fit 0-1 coords into the indoor bounding box
        mapTransforms[m.id]={z, mapPt:(px,py)=>{
          return[_indoorBB.minX+px*(_indoorBB.maxX-_indoorBB.minX), _indoorBB.minY+py*(_indoorBB.maxY-_indoorBB.minY)];
        }};
      } else {
        mapTransforms[m.id]={z};
      }
    }
    _rebuildPositions();

    // ── Scanner position map for RSSI trilateration ──────────────────────────
    // Maps scanner source → ISO screen coordinates so we can estimate object
    // positions from live RSSI without requiring calibration data.
    const _scannerIsoPos = {};
    for(const m of maps_list){
      const tf = mapTransforms[m.id]; if(!tf) continue;
      for(const r of (m.receivers||[])){
        // Match stored receiver to live radio — primary key is source
        const rSrc = r.source || "";
        const liveRadio = rSrc ? allRadios_live.find(rd=>rd.source===rSrc) : allRadios_live.find(rd=>rd.name===(r.label||""));
        const src = (liveRadio ? liveRadio.source : null) || rSrc || r.id || "";
        if(!src) continue;
        // A scanner on the wall has a position in metres, in the fabric. Its
        // x/y on a photograph is where someone dropped a pin on a picture of
        // that wall — same wall, but only one of the two is a measurement.
        const fp = _fabScanner(src);
        if(fp){ _scannerIsoPos[src] = fp; continue; }
        if(_fabOK) continue;
        const [wx,wy] = tf.mapPt(r.x||0, r.y||0);
        const [sx,sy] = iso(wx, wy, tf.z);
        _scannerIsoPos[src] = {sx, sy, z: tf.z};
      }
    }

    // Trilateration: weighted centroid of scanner positions based on RSSI.
    // Returns {sx, sy, confidence} or null.  Works without calibration data.
    function _trilateratePos(obj){
      const readings = _getObjReadings(obj);
      const sources = Object.keys(readings);
      if(sources.length < 1) return null;
      let wx=0, wy=0, wTotal=0, matched=0;
      for(const src of sources){
        const pos = _scannerIsoPos[src];
        if(!pos) continue;
        const rssi = readings[src].rssi;
        const age = readings[src].age_s || 0;
        if(age > 60) continue;
        // Weight: exponential on RSSI (stronger signal = heavier weight).
        // Shift by +100 so typical range (-40 to -95) maps to positive exponents.
        const w = Math.pow(10, (rssi + 100) / 20) * Math.exp(-age / 45);
        wx += pos.sx * w;
        wy += pos.sy * w;
        wTotal += w;
        matched++;
      }
      if(matched < 2 || wTotal < 1e-10) return null;
      // Confidence scales with number of matched scanners (≥3 = full)
      const confidence = Math.min(1.0, matched / 3) * 0.35;
      return {sx: wx / wTotal, sy: wy / wTotal, confidence};
    }

    // Collect per-source RSSI for an object from the live advertisement stream.
    // obj.sources in the snapshot is a string array; the actual RSSI values are in
    // snap.ble.advertisements (one row per {address, source}).
    function _getObjReadings(obj){
      const addr = obj.address||"";
      if(!addr) return {};
      // For iBeacon objects, match by all rotating MAC addresses (not the
      // stable ibeacon:uuid:major:minor key which never appears in raw ads).
      const matchAddrs = new Set();
      matchAddrs.add(addr);
      if(Array.isArray(obj.all_addresses)){
        for(const a of obj.all_addresses) matchAddrs.add(String(a));
      }
      const readings={};
      for(const ad of (liveSnap?.ble?.advertisements||[])){
        if(!matchAddrs.has(ad.address) || !ad.source || ad.rssi==null) continue;
        if(!readings[ad.source] || (ad.age_s||0) < readings[ad.source].age_s)
          readings[ad.source]={rssi:ad.rssi, age_s:ad.age_s||0};
      }
      return readings;
    }

    // k-NN fingerprint match across all calibration points visible on current maps.
    // Returns {sx, sy, z, dist, confidence} (ISO screen coords) or null.
    // Age-decay: readings >45 s old contribute less weight.
    // Missing-source penalty: 28 dBm per calibration source absent from current scan.
    function _matchFingerprint(readings){
      if(!calPoints.length) return null;
      const obsSrcs = Object.keys(readings);
      if(!obsSrcs.length) return null;
      const scored=[];
      for(const p of calPoints){
        if(!mapTransforms[p.map_id]) continue;
        const cal=p.scanner_readings||{};
        let sumSq=0, count=0;
        for(const src of obsSrcs){
          if(cal[src]?.rssi!=null){
            const ageW = Math.exp(-(readings[src].age_s||0)/45);
            const diff  = readings[src].rssi - cal[src].rssi;
            sumSq += diff*diff * Math.max(ageW, 0.1);
            count++;
          }
        }
        if(count<1) continue;
        const missing = Object.keys(cal).length - count;
        const dist = Math.sqrt(sumSq/count) + missing*28;
        scored.push({p, dist});
      }
      if(!scored.length) return null;
      scored.sort((a,b)=>a.dist-b.dist);
      const k=Math.min(5, scored.length);
      // Find dominant map (highest total weight among top-k)
      const mapW={};
      for(let i=0;i<k;i++){
        const {p,dist}=scored[i]; const w=1/Math.max(dist*dist,0.01);
        mapW[p.map_id]=(mapW[p.map_id]||0)+w;
      }
      let bestMap=scored[0].p.map_id, bestW=0;
      for(const [mid,w] of Object.entries(mapW)){if(w>bestW){bestW=w;bestMap=mid;}}
      // Weighted centroid using only points on the dominant map
      let wx=0, wy=0, wTotal=0;
      for(let i=0;i<k;i++){
        const {p,dist}=scored[i];
        if(p.map_id!==bestMap) continue;
        const w=1/Math.max(dist*dist,0.01);
        wx+=p.x_frac*w; wy+=p.y_frac*w; wTotal+=w;
      }
      if(!wTotal) return null;
      const tf=mapTransforms[bestMap];
      // Fingerprint positioning still averages calibration points held as
      // fractions of a PHOTO, so it can only place a result while a photo
      // projection exists. With the fabric in charge it stands down and the
      // metre-based methods (trilateration, k-NN x_m/y_m) answer instead —
      // rather than throwing and taking the whole view down with it.
      if(!tf || typeof tf.mapPt !== "function") return null;
      const [lwx,lwy]=tf.mapPt(wx/wTotal, wy/wTotal);
      const [sx,sy]=iso(lwx, lwy, tf.z);
      return{sx, sy, z:tf.z, dist:scored[0].dist, confidence:Math.max(0,1-scored[0].dist/50)};
    }
    const LEGEND_H = 30;  // single-row compact legend

    if(ctx.state._overviewPersistentPins === undefined) ctx.state._overviewPersistentPins = !!(ctx.state.settings && ctx.state.settings.overview_persistent_pins);
    if(ctx.state._overviewShowWalls === undefined) ctx.state._overviewShowWalls = !!(ctx.state.settings && ctx.state.settings.overview_show_walls);
    if(ctx.state._overviewShowHeatmap === undefined) ctx.state._overviewShowHeatmap = false;
    if(ctx.state._overviewShowDistortion === undefined) ctx.state._overviewShowDistortion = false;

    const buildIsoSVG = (focusZ)=>{
      // Re-read objects from current snapshot (not stale closure)
      _refreshIsoObjects();
      const slabWZ = 18/_ovFG;
      // Dynamic viewBox: expand to fit all floors.
      // Vertical: expand upward for tall floor stacks.
      // Horizontal: expand rightward for L/R offset on upper floors + labels.
      const maxIsoZ = sortedIsoLevels.length ? sortedIsoLevels[sortedIsoLevels.length-1] : 0;
      const viewY   = Math.min(0, CY - maxIsoZ*_ovFG - 50);   // 50 px top padding
      const horizExtra = Math.abs(maxIsoZ * _ovHG) + 60;       // 60 px padding for labels
      const viewX   = _ovHG < 0 ? Math.floor(_ovHG * maxIsoZ) - 30 : -30;
      const viewW   = W + horizExtra + 60;  // extra breathing room on both sides
      const HTOTAL  = BASE_H + LEGEND_H - viewY;
      // The <svg> header is composed at return time: the heuristic box above
      // covers floor-gap/offset growth, but only the tracked bounding box
      // knows how far stitched-map geometry actually reaches.  Union of both
      // — framing never shrinks, content can no longer be clipped.
      _isoBB = {minX:Infinity,minY:Infinity,maxX:-Infinity,maxY:-Infinity};
      const _isoHeader = ()=>{
        let vx=viewX, vy=viewY, vw=viewW, vh=HTOTAL;
        if(_isoBB && isFinite(_isoBB.minX)){
          const PAD=60;
          const x0=Math.min(vx, _isoBB.minX-PAD), y0=Math.min(vy, _isoBB.minY-PAD);
          const x1=Math.max(vx+vw, _isoBB.maxX+PAD), y1=Math.max(vy+vh, _isoBB.maxY+40);
          vx=x0; vy=y0; vw=x1-x0; vh=y1-y0;
        }
        return `<svg viewBox="${vx} ${vy} ${vw} ${vh}" xmlns="http://www.w3.org/2000/svg" width="100%" style="max-height:${Math.round(vh)}px;display:block;font-family:system-ui,sans-serif">`
          + `<rect x="${vx}" y="${vy}" width="${vw}" height="${vh}" fill="#071008"/>`;
      };
      let s = ``;

      // Floor surface patterns — defined once per level, referenced by fill="url(#...)"
      s += `<defs>`;
      sortedIsoLevels.forEach((z2, li) => {
        const c2 = levelColor(z2);
        if(li === 0){
          // Ground floor: subtle paisley (teardrop + curl + inner dot)
          s += `<pattern id="flrpat_${li}" x="0" y="0" width="24" height="24" patternUnits="userSpaceOnUse">`;
          s += `<path d="M12,2 C16,2 19,6 19,11 C19,16 16,21 12,22 C8,21 5,16 5,11 C5,6 8,2 12,2 Z" fill="none" stroke="${c2}" stroke-width="0.7" opacity="0.14"/>`;
          s += `<path d="M12,2 C13.5,0 15.5,0.5 14.5,2.5 C13.5,1.5 12,2 12,2 Z" fill="${c2}" opacity="0.11"/>`;
          s += `<circle cx="12" cy="15" r="1.4" fill="${c2}" opacity="0.1"/>`;
          s += `</pattern>`;
        } else if(li === 2){
          // Level 2: crosshatch (two diagonal sets of lines)
          s += `<pattern id="flrpat_${li}" x="0" y="0" width="12" height="12" patternUnits="userSpaceOnUse">`;
          s += `<line x1="0" y1="12" x2="12" y2="0" stroke="${c2}" stroke-width="0.6" opacity="0.18"/>`;
          s += `<line x1="0" y1="0" x2="12" y2="12" stroke="${c2}" stroke-width="0.6" opacity="0.18"/>`;
          s += `</pattern>`;
        } else if(li >= 3){
          // Level 3+: hex dot grid
          s += `<pattern id="flrpat_${li}" x="0" y="0" width="16" height="13.86" patternUnits="userSpaceOnUse">`;
          s += `<circle cx="0"  cy="0"     r="1.5" fill="${c2}" opacity="0.14"/>`;
          s += `<circle cx="8"  cy="6.93"  r="1.5" fill="${c2}" opacity="0.14"/>`;
          s += `<circle cx="16" cy="0"     r="1.5" fill="${c2}" opacity="0.14"/>`;
          s += `<circle cx="0"  cy="13.86" r="1.5" fill="${c2}" opacity="0.14"/>`;
          s += `<circle cx="16" cy="13.86" r="1.5" fill="${c2}" opacity="0.14"/>`;
          s += `</pattern>`;
        }
        // li === 1: no pattern (clean slab)
      });
      s += `</defs>`;

      if(!sorted.length){
        s += `<text x="${W/2}" y="${BASE_H/2}" text-anchor="middle" fill="#4a6052" font-size="13">All layers hidden</text>`;
        return _isoHeader() + s + `</svg>`;
      }

      // Emit 3D hatch pattern defs once (before any level renders cells)
      if (_isoRadioMapOn && _isoRadioMapMod && _isoRadioMapMod.isoHatchDefs && ctx.state._overviewShowHeatmap) {
        s += _isoRadioMapMod.isoHatchDefs();
      }

      // Pre-compute GLOBAL RSSI range across all floors for consistent color scale.
      // Without this, each floor gets its own scale and bad floors look deceptively green.
      if ((_isoRadioMapOn || _isoDistortionOn) && _isoRadioMapMod && (ctx.state._overviewShowHeatmap || ctx.state._overviewShowDistortion)) {
        const refPow = ctx.state.settings?.ref_power ?? -59;
        const plN = ctx.state.settings?.path_loss_exp ?? 2.5;
        let gMin = 0, gMax = -120;
        for (const [zz, grp] of [...byLevel.entries()]) {
          for (const m of grp) {
            const tf = mapTransforms[m.id]; if (!tf || !tf.mapPt) continue;
            for (const r of (m.receivers || [])) {
              if (r.x == null || r.y == null) continue;
              // Best case: right at the scanner = refPower at 0.3m
              const best = refPow - 10 * plN * Math.log10(0.3);
              if (best > gMax) gMax = best;
              // Worst case: far corner of bounding box (rough estimate)
              const worst = refPow - 10 * plN * Math.log10(15); // ~15m away
              if (worst < gMin) gMin = worst;
            }
          }
        }
        if (_isoRadioMapMod.setGlobalRange) _isoRadioMapMod.setGlobalRange(gMin, gMax);
      }

      for(const [z,group] of [...byLevel.entries()].sort((a,b)=>a[0]-b[0])){
        const isFocused = focusZ===null || (Array.isArray(focusZ) ? focusZ.includes(z) : focusZ===z);
        const go = isFocused ? 1.0 : 0.1;
        const lyrColor = levelColor(z);
        const lidx = sortedIsoLevels.indexOf(z);

        // Bounding box from indoor maps only; outside maps render as overlay inside
        let x0=Infinity,y0_=Infinity,x1=-Infinity,y1_=-Infinity;
        for(const r of (_fabOK ? _fabF.rooms.filter(rr=>rr.z===z) : [])){
          for(const p of r.pts){
            x0=Math.min(x0,p[0]); y0_=Math.min(y0_,p[1]);
            x1=Math.max(x1,p[0]); y1_=Math.max(y1_,p[1]);
          }
        }
        // Level with only outside maps: use global indoor BB
        if(!isFinite(x0)){x0=_indoorBB.minX;y0_=_indoorBB.minY;x1=_indoorBB.maxX;y1_=_indoorBB.maxY;}
        if(!isFinite(x0)){x0=0;y0_=0;x1=1;y1_=0.75;}

        const TL=iso(x0,y0_,z), TR=iso(x1,y0_,z), BR=iso(x1,y1_,z), BL=iso(x0,y1_,z);
        const TR_b=iso(x1,y0_,z-slabWZ), BR_b=iso(x1,y1_,z-slabWZ), BL_b=iso(x0,y1_,z-slabWZ);

        s += `<g opacity="${go}">`;
        s += `<polygon points="${pts([TR,BR,BR_b,TR_b])}" fill="#0d2318" fill-opacity="0.35" stroke="#253e2e" stroke-width="0.8"/>`;
        s += `<polygon points="${pts([BL,BR,BR_b,BL_b])}" fill="#0a1a12" fill-opacity="0.3" stroke="#253e2e" stroke-width="0.8"/>`;
        s += `<polygon points="${pts([TL,TR,BR,BL])}" fill="#0f2017" fill-opacity="0.06" stroke="${lyrColor}" stroke-width="1.5" stroke-dasharray="10,5" opacity="0.5"/>`;
        if(lidx !== 1){ s += `<polygon points="${pts([TL,TR,BR,BL])}" fill="url(#flrpat_${lidx})" stroke="none"/>`; }

        // ── Radio Map heatmap layer (3D isometric, behind room polygons) ──
        if (_isoRadioMapOn && _isoRadioMapMod && calPoints.length && ctx.state._overviewShowHeatmap) {
          if (_isoRadioMapMod.setUserGainContrast) {
            _isoRadioMapMod.setUserGainContrast(ctx.state._heatGain || ctx.state.settings?.heatmap_gain || 0, ctx.state._heatContrast || ctx.state.settings?.heatmap_contrast || 0);
          }
          // Set source blend + adaptive data before rendering
          if (_isoRadioMapMod.setSourceBlend) _isoRadioMapMod.setSourceBlend(ctx.state._heatSource ?? ctx.state.settings?.heatmap_source ?? 0);
          if (_isoRadioMapMod.setAdaptiveData) _isoRadioMapMod.setAdaptiveData(ctx.state._adaptiveFps || null);
          if (_isoRadioMapMod.setFabricWorld) _isoRadioMapMod.setFabricWorld(_isoFabricW);
          // Prefer model-based heatmap
          if (_isoRadioMapMod.modelIsoHeatmapSVG) {
            s += _isoRadioMapMod.modelIsoHeatmapSVG(group, mapTransforms, iso, z, ctx.state.settings, sorted, liveSnap, ctx.state.model);
          } else if (_isoRadioMapMod.isoLevelHeatmapSVG) {
            s += _isoRadioMapMod.isoLevelHeatmapSVG(calPoints, group, mapTransforms, iso, z);
          }
        }

        // ── Distortion Map (3D isometric, behind room polygons) ──
        const _isoDistortionOn2 = !!(ctx.state.settings && ctx.state.settings.distortion_map_enabled);
        if (_isoDistortionOn2 && _isoRadioMapMod && calPoints.length && ctx.state._overviewShowDistortion) {
          if (_isoRadioMapMod.setUserGainContrast) {
            _isoRadioMapMod.setUserGainContrast(ctx.state._heatGain || ctx.state.settings?.heatmap_gain || 0, ctx.state._heatContrast || ctx.state.settings?.heatmap_contrast || 0);
          }
          if (_isoRadioMapMod.setDistortionIntensity) {
            _isoRadioMapMod.setDistortionIntensity(ctx.state._distIntensity ?? ctx.state.settings?.distortion_intensity ?? 50);
          }
          if (_isoRadioMapMod.isoDistortionSVG) {
            s += _isoRadioMapMod.isoDistortionSVG(calPoints, group, mapTransforms, iso, z, ctx.state.settings, sorted, liveSnap, ctx.state.model);
          }
        }

        // Room polygons — fabric-first (per-photo bounds only as fallback
        // and for outside maps, whose stacks aren't in the world frame).
        const _emitIsoRoom = (room, pp, lix, liy) => {
          const color = roomColorFn(room);
          const _objsHere = allObjects.filter(o=>_presentInRoom(ctx,o,room));
          const _roomTip = `${room}\n${_objsHere.length} object${_objsHere.length!==1?"s":""} detected`;
          s += `<g data-tip="${_esc(_roomTip)}"><polygon points="${pp}" fill="${color}" fill-opacity="0.2" stroke="${color}" stroke-width="2" opacity="0.9"/></g>`;
          s += `<text x="${Math.round(lix)}" y="${Math.round(liy)+lidx*2}" text-anchor="middle" dominant-baseline="middle" fill="${color}" font-size="9" font-weight="600">${_esc(room)}</text>`;
        };
        // The per-photo room fallback is gone. Every room, indoors and out,
        // is in the fabric; a room that is not there is not a room yet.
        const _legacyIsoRooms = () => {};
        const _groupFids = new Set(group.filter(m=>!_isOutMap(m)).map(_mapFid));
        const _fabRoomsHere = _isoFabricW
          ? Object.entries(_isoFabricW).filter(([,fr])=>_groupFids.has(fr.floor_id)) : [];
        if(_fabRoomsHere.length){
          for(const [room,fr] of _fabRoomsHere){
            const pp = fr.pts.map(p=>pt(iso(p[0],p[1],z))).join(" ");
            const cx=fr.pts.reduce((a,p)=>a+p[0],0)/fr.pts.length;
            const cy=fr.pts.reduce((a,p)=>a+p[1],0)/fr.pts.length;
            const [lix,liy]=iso(cx,cy,z);
            _emitIsoRoom(room, pp, lix, liy);
          }
          for(const m of group) if(_isOutMap(m)) _legacyIsoRooms(m);
        } else {
          for(const m of group) _legacyIsoRooms(m);
        }
        for(const m of group){
          const tf = mapTransforms[m.id]; if(!tf) continue;
          const mapPt = tf.mapPt;
          // RF barriers — dotted white lines on 3D map
          if(ctx.state._overviewShowWalls){
            // Barriers are walls. A wall is in the fabric, in metres.
            const _fabBars = _fabOK ? ((ctx.state.model||{}).rf_barriers_m || []) : [];
            const _bars = _fabOK
              ? _fabBars.filter(b => _fabZOf(b.floor_id) === z)
                        .map(b => ({ points: b.points_m || [] }))
              : (m.rf_barriers || []);
            for(let bi=0;bi<_bars.length;bi++){
              const bar = _bars[bi];
              const bpts = bar.points || bar.pts || [];
              if(bpts.length<2) continue;
              const bp = bpts.map(p=>{
                const P = _fabOK ? [Number(p[0]), Number(p[1])] : mapPt(Number(p[0]), Number(p[1]));
                return pt(iso(P[0], P[1], z));
              }).join(" ");
              s += `<polyline points="${bp}" fill="none" stroke="#ffffff" stroke-opacity="0.85" stroke-width="3" stroke-dasharray="5 8" stroke-linecap="round"/>`;
            }
          }
          // Placed receivers (with scanner tooltip + name label)
          // Show ALL stored receivers — match calibration Tune tab behavior.
          // Non-live receivers render dimmed instead of hidden.
          for(const r of (m.receivers||[])){
            const liveRadio = allRadios_live.find(rd=>rd.name===(r.label||"")||rd.source===(r.id||"")||rd.source===(r.source||"")||rd.name===(r.id||""));
            const isLive = !!liveRadio;
            const _rsrc0 = (liveRadio ? liveRadio.source : null) || r.source || r.id || "";
            const _fp = _fabScanner(_rsrc0);
            if(!_fp && _fabOK) continue;   // fabric is truth; no metres, no marker
            const[wx,wy]=_fp?[0,0]:mapPt(r.x||0,r.y||0);
            const [px,py]=_fp?[_fp.sx,_fp.sy]:iso(wx,wy,z);
            const rsid = (_sid((isLive ? liveRadio.source : null) || r.source || r.id || r.label || "") || "R").toUpperCase();
            const _rTip = `${rsid} · ${(isLive ? liveRadio.name : null)||r.label||r.id||"receiver"}${r.room ? "\nArea: "+r.room : ""}${isLive && liveRadio.scanning!=null ? "\nScanning: "+(liveRadio.scanning?"Yes":"No") : ""}${!isLive ? "\n(offline)" : ""}`;
            const rxColor = isLive ? "#52b788" : "#4a6052";
            const rxOp = isLive ? 1.0 : 0.45;
            const rxSrc = _esc((isLive ? liveRadio.source : null) || r.source || r.id || "");
            s += `<g data-scanner-src="${rxSrc}" data-tip="${_esc(_rTip)}" opacity="${rxOp}" style="cursor:pointer">`;
            s += `<circle cx="${Math.round(px)}" cy="${Math.round(py)}" r="15" fill="none" stroke="${rxColor}" stroke-width="1.3" opacity="0.3"/>`;
            s += `<circle cx="${Math.round(px)}" cy="${Math.round(py)}" r="9"  fill="none" stroke="${rxColor}" stroke-width="1.5" opacity="0.6"/>`;
            s += `<circle cx="${Math.round(px)}" cy="${Math.round(py)}" r="4.5" fill="${rxColor}" opacity="0.9"/>`;
            s += `<text x="${Math.round(px)}" y="${Math.round(py)-13}" text-anchor="middle" fill="${rxColor}" font-size="9" font-weight="700" style="cursor:pointer">${_esc(rsid)}</text>`;
            s += `</g>`;
          }
        }

        // Layer index dot at bottom-left corner (BL = front-left of top face)
        s += `<circle cx="${Math.round(BL[0])}" cy="${Math.round(BL[1])}" r="15" fill="${lyrColor}" opacity="0.95"/>`;
        s += `<text x="${Math.round(BL[0])}" y="${Math.round(BL[1])+6}" text-anchor="middle" fill="#071008" font-size="14" font-weight="700">${lidx+1}</text>`;
        s += `</g>`;
      }

      // ── Helper: build tooltip string for any object ────────────────────────
      const _objTip = (o) => {
        const parts = [];
        const n = o.user_label || o.private_ble_name || o.name || o.address || o.entity_id || "Unknown";
        parts.push(n);
        if(o.kind) parts.push(`Kind: ${o.kind}`);
        if(o.address && o.address !== n) parts.push(`Addr: ${o.address}`);
        if(o.room) parts.push(`Room: ${o.room}`);
        if(o.knn_confidence > 0) parts.push(`Calibrated: ${Math.round(o.knn_confidence * 100)}%`);
        if(o.rssi != null) parts.push(`RSSI: ${o.rssi} dBm`);
        if(o.age_s != null){
          const a = Number(o.age_s);
          parts.push(`Seen: ${a<60 ? Math.round(a)+"s ago" : Math.floor(a/60)+"m ago"}`);
        }
        if(o.sources && o.sources.length) parts.push(`Scanners: ${o.sources.map(s => typeof s === "object" ? (s.source || "") : String(s)).join(", ")}`);
        if(!o.user_label) parts.push("Click to tag / view details");
        return parts.join("|");  // pipe-delimited for data attribute, rendered as lines
      };

      s += `<!-- ISO_OBJECTS_START -->`;
      // Track which object keys are rendered (to avoid duplicate dots for unlabeled layer)
      const _renderedObjKeys = new Set();

      // Followed beacons — positioned using server k-NN first (same as calibration
      // beacon tune), with client-side fingerprint as high-confidence enhancement only.
      const followedObjects = allObjects.filter(o =>
        ctx.actions.followedHas(o.address || "") || ctx.actions.followedHas(o.entity_id || "") || ctx.actions.followedHas(o.key || "")
      );
      // Everything from here on is an OBJECT, not structure. The building is
      // fully drawn, so its extent is the frame — freeze it before any marker
      // can stretch it.
      if(_isoBB && isFinite(_isoBB.minX)) _bldgBB = {..._isoBB};
      _isoBBFrozen = true;

      const BEACON_CLR = "#fbbf24";
      const _awayTimeoutS2 = ctx.helpers.awayTimeoutS(ctx.state.settings);
      for(const o of followedObjects){
        // Skip objects positioned on a hidden floor/map

        _renderedObjKeys.add(o.key || o.address || o.entity_id || "");
        const isGhost = o._ghost || o._stale;
        const ageS = typeof o.age_s === "number" ? o.age_s : 0;
        const isAway = isGhost && (o.rssi == null) && (ageS > _awayTimeoutS2);
        const lbl = (o.user_label||o.private_ble_name||o.name||"?").substring(0,14);
        let bx, by;
        let posConf = 0;  // confidence for dashed circle

        // Priority 1: the server's position, in metres, drawn through the
        // world frame. No map id: a position is not "on" a photo.
        if(typeof o.x_m === "number" && typeof o.y_m === "number" && _mAnchor){
          const k = 1/_mAnchor.m_per_world;
          [bx,by]=iso(o.x_m*k, o.y_m*k, _floorZ(o.floor_id));
          posConf = o.knn_confidence || 0;
        }
        // Priority 2: Client-side fingerprint fallback — server k-NN is authoritative,
        // this only fires when the server didn't provide a position (e.g., no calibration data).
        if(bx == null){
          const readings = _getObjReadings(o);
          const match = _matchFingerprint(readings);
          if(match && match.confidence > 0.4){
            bx=match.sx; by=match.sy;
            posConf = match.confidence;
          }
        }
        // Priority 2.5: Scanner trilateration — RSSI-weighted centroid of known scanner positions
        if(bx == null){
          const tri = _trilateratePos(o);
          if(tri){ bx=tri.sx; by=tri.sy; posConf=tri.confidence; }
        }
        // Priority 3: Room centroid
        if(bx == null && o.room && roomIsoPos[o.room]){
          [bx,by] = roomIsoPos[o.room];
        }
        // No position = not on the map
        if(bx == null) continue;

        // Outside the building: tether to the edge with a blue ring so one
        // distant object cannot set the zoom for the whole map.
        {
          const _t = _tetherOutside(bx, by);
          if(_t.outside){
            bx = _t.x; by = _t.y;
            s += `<circle cx="${Math.round(bx)}" cy="${Math.round(by)}" r="17" fill="none" `
               + `stroke="#38bdf8" stroke-width="2" opacity="0.85"><title>Outside the building — shown at the edge, actual distance is further out</title></circle>`;
          }
        }

        // Confidence circle (only when we have a real positioned match)
        if(posConf > 0){
          const cr = Math.round(10 + (1-posConf)*24);
          const op = (0.3 + posConf*0.55).toFixed(2);
          s += `<circle cx="${Math.round(bx)}" cy="${Math.round(by)}" r="${cr}" fill="none" stroke="${BEACON_CLR}" stroke-width="1.5" stroke-dasharray="5,3" opacity="${op}"/>`;
        }

        // Confidence badge — always visible, color-coded by quality
        const hasKnn = typeof o.x_m === "number" && typeof o.y_m === "number";
        const confPct = hasKnn ? Math.round((o.knn_confidence || 0) * 100) : 0;
        // Color: green > 60%, amber 30-60%, red < 30%, gray = no data
        const confColor = !hasKnn ? "#64748b" : confPct >= 60 ? "#52b788" : confPct >= 30 ? "#f59e0b" : "#f87171";
        const confLabel = !hasKnn ? "Room only" : confPct + "%";

        const _ok = _esc(o.key||o.address||o.entity_id||"");
        // Dim away/ghost objects
        const dotOp = isAway ? "0.35" : "0.97";
        const glowOp = isAway ? "0.08" : "0.18";
        const lblColor = isAway ? "#a0845c" : BEACON_CLR;
        s += `<g data-obj-key="${_ok}" data-tip="${_esc(_objTip(o))}" style="cursor:pointer">`;
        // Confidence badge below the dot (skip for away)
        if(!isAway){
          const cW = Math.min(confLabel.length * 6.5 + 8, 65);
          s += `<rect x="${Math.round(bx)-cW/2}" y="${Math.round(by)+18}" width="${cW}" height="13" rx="3" fill="#071008" opacity="0.8"/>`;
          s += `<text x="${Math.round(bx)}" y="${Math.round(by)+28}" text-anchor="middle" fill="${confColor}" font-size="9" font-weight="600">${_esc(confLabel)}</text>`;
          // Red warning ring only when truly bad (< 30% or no data)
          if(confPct < 30){
            s += `<circle cx="${Math.round(bx)}" cy="${Math.round(by)}" r="20" fill="none" stroke="${confColor}" stroke-width="1.5" stroke-dasharray="6,3" opacity="0.5"/>`;
          }
        }
        s += `<circle cx="${Math.round(bx)}" cy="${Math.round(by)}" r="16" fill="${BEACON_CLR}" opacity="${glowOp}"/>`;
        s += `<circle cx="${Math.round(bx)}" cy="${Math.round(by)}" r="11" fill="${BEACON_CLR}" stroke="#071008" stroke-width="1.5" opacity="${dotOp}"/>`;
        s += `<circle cx="${Math.round(bx)}" cy="${Math.round(by)}" r="3.5" fill="#071008" opacity="0.7"/>`;
        const awayTag = isAway ? " (Away)" : "";
        const fullLbl = lbl + awayTag;
        const lblW = Math.min(fullLbl.length * 7 + 10, 140);
        s += `<rect x="${Math.round(bx)-lblW/2}" y="${Math.round(by)-32}" width="${lblW}" height="16" rx="3" fill="#071008" opacity="0.7"/>`;
        s += `<text x="${Math.round(bx)}" y="${Math.round(by)-20}" text-anchor="middle" fill="${lblColor}" font-size="12" font-weight="700">${_esc(fullLbl)}</text>`;
        s += `</g>`;
      }

      // Persistent pins + unlabeled objects with known room positions.
      // When persistent ON: show followed items at their last known room (away = red crosshair, active = teal dot).
      // When persistent OFF: only unlabeled objects shown as dim amber dots.
      {
        const _isFollowed = (o) => ctx.actions.followedHas(o.address || "") || ctx.actions.followedHas(o.entity_id || "") || ctx.actions.followedHas(o.key || "");
        const _mapAwayM = ctx.helpers.awayTimeoutS(ctx.state.settings);
        // Show objects that are currently present (have a position and are not stale)
        const _quietMode = !!(ctx.state.settings && ctx.state.settings.quiet_mode);
        const _mapObjs = allObjects.filter(o => {
          if (_renderedObjKeys.has(o.key || o.address || o.entity_id || "")) return false;
          // Stale/ghost objects don't belong on the map
          if (o._stale || o._ghost) return false;
          const hasKnn = typeof o.x_m === "number" && typeof o.y_m === "number" && !!_mAnchor;
          const hasRoom = o.room && o.room !== "unknown" && o.room !== "not_home" && roomIsoPos[o.room];
          if (!hasKnn && !hasRoom) return false;

          // Quiet mode: only show labeled/identified objects
          if (_quietMode && !o.user_label && !o.identified) return false;
          // Only show labeled/identified objects (not random BLE noise)
          if (!o.user_label && !o.identified) return false;
          return true;
        });
        const _roomObjCount = {};
        for(const obj of _mapObjs){
          const oKey = obj.key || obj.address || obj.entity_id || "";
          _renderedObjKeys.add(oKey);
          const _ok = _esc(oKey);
          const isAway = ctx.helpers.isAway(obj, ctx.helpers.awayTimeoutS(ctx.state.settings));
          const objLabel = obj.user_label || obj.private_ble_name || obj.name || "";

          // Position: server k-NN first, then high-confidence fingerprint, then room centroid + stagger
          let px, py;
          if(typeof obj.x_m === "number" && typeof obj.y_m === "number" && _mAnchor){
            const k = 1/_mAnchor.m_per_world;
            const [ix,iy] = iso(obj.x_m*k, obj.y_m*k, _floorZ(obj.floor_id));
            [px,py]=[Math.round(ix), Math.round(iy)];
          } else {
            const readings = _getObjReadings(obj);
            const fpMatch = _matchFingerprint(readings);
            if (fpMatch && fpMatch.confidence > 0.4) {
              px = Math.round(fpMatch.sx);
              py = Math.round(fpMatch.sy);
            } else {
              // Scanner trilateration — RSSI-weighted centroid (no calibration needed)
              const tri = _trilateratePos(obj);
              if(tri){
                px = Math.round(tri.sx);
                py = Math.round(tri.sy);
              } else if (obj.room && roomIsoPos[obj.room]) {
                const pos = roomIsoPos[obj.room];
                const idx = (_roomObjCount[obj.room] || 0);
                _roomObjCount[obj.room] = idx + 1;
                const angle = idx * 2.4;
                const radius = 8 + idx * 6;
                px = Math.round(pos[0] + Math.cos(angle) * Math.min(radius, 40));
                py = Math.round(pos[1] + Math.sin(angle) * Math.min(radius, 25));
              }
            }
          }
          // Skip if no position could be determined
          if(px == null || py == null) continue;

          // Outside the building: draw it at the edge with a blue ring rather
          // than at its true distance, so a truck in the driveway cannot set
          // the zoom for the whole map.
          const _teth = _tetherOutside(px, py);
          const _isOutside = _teth.outside;
          px = _teth.x; py = _teth.y;
          if(_isOutside){
            s += `<circle cx="${px}" cy="${py}" r="17" fill="none" stroke="#38bdf8" `
               + `stroke-width="2" opacity="0.85"><title>Outside the building — shown at the edge, actual distance is further out</title></circle>`;
          }

          if(ctx.state._overviewPersistentPins){
            if(isAway){
              // Red crosshair for away objects (persistent mode)
              s += `<g data-obj-key="${_ok}" data-tip="${_esc(_objTip(obj))}" style="cursor:pointer" opacity="0.92">`;
              s += `<circle cx="${px}" cy="${py}" r="22" fill="none" stroke="#ef4444" stroke-width="1.5"/>`;
              s += `<circle cx="${px}" cy="${py}" r="12" fill="none" stroke="#ef4444" stroke-width="2"/>`;
              s += `<circle cx="${px}" cy="${py}" r="4.5" fill="#ef4444"/>`;
              s += `<line x1="${px-27}" y1="${py}" x2="${px-14}" y2="${py}" stroke="#ef4444" stroke-width="1.5"/>`;
              s += `<line x1="${px+14}" y1="${py}" x2="${px+27}" y2="${py}" stroke="#ef4444" stroke-width="1.5"/>`;
              s += `<line x1="${px}" y1="${py-27}" x2="${px}" y2="${py-14}" stroke="#ef4444" stroke-width="1.5"/>`;
              s += `<line x1="${px}" y1="${py+14}" x2="${px}" y2="${py+27}" stroke="#ef4444" stroke-width="1.5"/>`;
              if(objLabel) s += `<text x="${px}" y="${py+38}" text-anchor="middle" fill="#fca5a5" font-size="10" font-weight="600">${_esc(objLabel)}</text>`;
              s += `</g>`;
            } else {
              // Teal dot for active objects (persistent mode)
              s += `<g data-obj-key="${_ok}" data-tip="${_esc(_objTip(obj))}" style="cursor:pointer" opacity="0.88">`;
              s += `<circle cx="${px}" cy="${py}" r="13" fill="#5eead4" opacity="0.15"/>`;
              s += `<circle cx="${px}" cy="${py}" r="9" fill="#5eead4" stroke="#071008" stroke-width="1.5" opacity="0.95"/>`;
              s += `<circle cx="${px}" cy="${py}" r="2.5" fill="#071008" opacity="0.7"/>`;
              if(objLabel) s += `<text x="${px}" y="${py+22}" text-anchor="middle" fill="#5eead4" font-size="10" font-weight="600">${_esc(objLabel)}</text>`;
              s += `</g>`;
            }
          } else if(!obj.user_label){
            // Small dim amber dot for unlabeled objects
            s += `<g data-obj-key="${_ok}" data-tip="${_esc(_objTip(obj))}" style="cursor:pointer" opacity="0.6">`;
            s += `<circle cx="${px}" cy="${py}" r="6" fill="#f59e0b" stroke="#071008" stroke-width="1" opacity="0.7"/>`;
            s += `</g>`;
          }
        }
      }

      // Only placed receivers (pinned to maps) are shown in the 3D view.
      // Live BLE radios without map placement are omitted — they have no
      // precise coordinates and would just clutter the spatial view.

      if(!hasBounds && sorted.length){
        s += `<text x="${W/2}" y="${BASE_H-20}" text-anchor="middle" fill="#4a6052" font-size="16">Go to Maps → Edit to draw room boundaries</text>`;
      }

      // Legend at bottom — compact single row
      s += `<line x1="10" y1="${BASE_H+4}" x2="${W-10}" y2="${BASE_H+4}" stroke="#1b3526" stroke-width="0.8"/>`;
      {
        const ly = BASE_H + 10;
        let lx = 12;
        sortedIsoLevels.forEach((z, i)=>{
          const color = levelColor(z);
          const groupLabel = _floorLabelForLevel(z);
          s += `<circle cx="${lx+7}" cy="${ly+7}" r="7" fill="${color}" opacity="0.9"/>`;
          s += `<text x="${lx+7}" y="${ly+10}" text-anchor="middle" fill="#071008" font-size="9" font-weight="700">${i+1}</text>`;
          s += `<text x="${lx+18}" y="${ly+10}" fill="${color}" font-size="11" font-weight="500">${_esc(groupLabel)}</text>`;
          lx += 22 + groupLabel.length * 6;
          if (i < sortedIsoLevels.length - 1) {
            s += `<text x="${lx}" y="${ly+10}" fill="#4a6052" font-size="10">\u00B7</text>`;
            lx += 10;
          }
        });
      }

      return _isoHeader() + s + `</svg>`;
    };

    // Wrapper with floor focus slider + room list toggle
    const outer = document.createElement("div");
    outer.style.cssText = "margin-bottom:16px";

    const focusLbl = document.createElement("span");
    focusLbl.style.cssText = "font-size:12px;color:#94a3b8;min-width:80px;display:inline-block";
    focusLbl.textContent = _getFocusLbl(ctx.state._overviewIsoFocusIdx);

    const focusSlider = document.createElement("input");
    focusSlider.type = "range"; focusSlider.min = "0"; focusSlider.max = String(_isoPos.length-1);
    focusSlider.style.cssText = "width:130px;accent-color:#52b788;vertical-align:middle;cursor:pointer";
    focusSlider.value = String(ctx.state._overviewIsoFocusIdx);

    const isoWrap = document.createElement("div");
    isoWrap.style.cssText = "position:relative;margin-top:6px";

    const isoDiv = document.createElement("div");
    isoDiv.style.cssText = "overflow:auto;border-radius:8px;background:#071008;padding:8px";

    // ── 3D map loading indicator ────────────────────────────────────────
    const _isoProgressFill = { style: {} }; // stub — no visual progress bar

    /** Rebuild the 3D SVG with a progress indicator. */
    /** Full rebuild: replaces entire SVG (expensive — used for initial load + control changes) */
    function _rebuildIso(focusZ) {
      _isoProgressFill.style.transition = "none";
      _isoProgressFill.style.width = "40%";
      _isoProgressFill.style.background = "#a855f7";
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          isoDiv.innerHTML = buildIsoSVG(focusZ);
          ctx.state._isoBuildPending = false;
          // Inject a <g> wrapper for objects so we can swap it on polls
          const svgEl = isoDiv.querySelector("svg");
          if (svgEl) {
            const marker = "<!-- ISO_OBJECTS_START -->";
            const html = svgEl.innerHTML;
            const idx = html.indexOf(marker);
            if (idx >= 0) {
              const staticPart = html.substring(0, idx);
              const dynPart = html.substring(idx + marker.length);
              svgEl.innerHTML = staticPart + `<g id="iso-objects">${dynPart}`;
            }
          }
          _isoProgressFill.style.transition = "width 0.2s";
          _isoProgressFill.style.width = "100%";
          _isoProgressFill.style.background = "#52b788";
          setTimeout(() => { _isoProgressFill.style.width = "0"; }, 600);
        });
      });
    }

    /** Light update: only rebuilds object dots (cheap — used for 5s polls) */
    function _updateIsoObjects() {
      const svgEl = isoDiv.querySelector("svg");
      const objGroup = svgEl && svgEl.querySelector("#iso-objects");
      if (!svgEl || !objGroup) return; // no static base yet, skip
      // Build the full SVG and extract just the objects portion
      const fullSvg = buildIsoSVG(_getFocusZ(ctx.state._overviewIsoFocusIdx));
      const marker = "<!-- ISO_OBJECTS_START -->";
      const idx = fullSvg.indexOf(marker);
      if (idx < 0) return;
      const endSvg = fullSvg.lastIndexOf("</svg>");
      if (endSvg < 0) return;
      const dynHtml = fullSvg.substring(idx + marker.length, endSvg);
      // Swap just the dynamic group contents
      const tmp = document.createElement("div");
      tmp.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg">${dynHtml}</svg>`;
      const tmpSvg = tmp.querySelector("svg");
      if (tmpSvg) {
        while (objGroup.firstChild) objGroup.removeChild(objGroup.firstChild);
        while (tmpSvg.firstChild) objGroup.appendChild(tmpSvg.firstChild);
      }
    }

    // Expose the light updater for poll use
    ctx.state._isoUpdateObjects = _updateIsoObjects;

    // Initial load: show loading placeholder, defer heavy SVG build until DOM is ready
    // Set a flag so the 5s poll doesn't clobber us before the first build finishes
    ctx.state._isoBuildPending = true;
    isoDiv.innerHTML = `<div style="text-align:center;padding:60px 0;color:#52b788;font-size:13px">Building 3D map\u2026</div>`;
    _isoProgressFill.style.transition = "none";
    _isoProgressFill.style.width = "40%";
    _isoProgressFill.style.background = "#a855f7";

    // Hover info overlay — upper-left corner of the map
    const isoTipEl = document.createElement("div");
    isoTipEl.style.cssText = "position:absolute;top:8px;left:8px;background:rgba(7,16,8,0.92);" +
      "border:1px solid #2d6a4f;border-radius:8px;padding:6px 10px;font-size:11px;color:#a7f3d0;" +
      "pointer-events:none;white-space:pre-line;max-width:min(260px,calc(100vw - 40px));z-index:5;display:none;" +
      "font-family:ui-monospace,SFMono-Regular,Consolas,monospace;line-height:1.5";
    isoWrap.appendChild(isoDiv);
    isoWrap.appendChild(isoTipEl);

    // Event delegation: hover → show info overlay, click → open detail modal
    isoDiv.addEventListener("mouseover", (e) => {
      const g = e.target.closest("[data-tip]");
      if(g){
        isoTipEl.textContent = "";
        const lines = g.getAttribute("data-tip").split("|");
        lines.forEach((line, i) => {
          if(i > 0) isoTipEl.appendChild(document.createElement("br"));
          isoTipEl.appendChild(document.createTextNode(line));
        });
        isoTipEl.style.display = "block";
      }
    });
    isoDiv.addEventListener("mouseout", (e) => {
      const g = e.target.closest("[data-tip]");
      if(!g || !isoDiv.contains(e.relatedTarget && e.relatedTarget.closest && e.relatedTarget.closest("[data-tip]")))
        isoTipEl.style.display = "none";
    });
    isoDiv.addEventListener("click", (e) => {
      // Check for scanner click first
      const sg = e.target.closest("[data-scanner-src]");
      if (sg) {
        const src = sg.getAttribute("data-scanner-src");
        if (src) {
          const radio = allRadios_live.find(r => r.source === src);
          if (radio) { ctx.actions.showScannerDetail(radio); return; }
        }
      }
      // Then check for object click
      const g = e.target.closest("[data-obj-key]");
      if(!g) return;
      const objKey = g.getAttribute("data-obj-key");
      if(!objKey) return;
      const obj = allObjects.find(o =>
        (o.key||"") === objKey || (o.address||"") === objKey || (o.entity_id||"") === objKey);
      if(obj) ctx.actions.showObjectDetail(obj);
    });

    const haFloors2 = ctx.state.model?.floors || [];
    focusSlider.addEventListener("input", ()=>{
      ctx.state._overviewIsoFocusIdx = parseInt(focusSlider.value, 10);
      focusLbl.textContent = _getFocusLbl(ctx.state._overviewIsoFocusIdx);
      _rebuildIso(_getFocusZ(ctx.state._overviewIsoFocusIdx));
    });

    // Room list toggle
    if(ctx.state._overviewShowRoomList === undefined) ctx.state._overviewShowRoomList = false;
    const roomListPanel = document.createElement("div");
    roomListPanel.style.cssText = `margin-top:10px;display:${ctx.state._overviewShowRoomList?"block":"none"}`;

    // Build room list — fabric roster first (ground truth), per-map bounds
    // only for rooms/installs the fabric doesn't cover.
    const ovRoomRows = [];
    if(_isoFabricW){
      for(const [room, fr] of Object.entries(_isoFabricW)){
        const haFlr = haFloors2.find(f=>String(f.id)===String(fr.floor_id));
        const flLbl = haFlr ? (haFlr.name||haFlr.id) : (fr.floor_id||"—");
        const objsInRoom = allObjects.filter(o=>_presentInRoom(ctx,o,room));
        ovRoomRows.push({ room, map: "fabric", floor: flLbl, count: objsInRoom.length, objects: objsInRoom });
      }
    }
    for(const m of sorted){
      const floorId = m.stack?.floor_id || m.floor_id || "";
      const haFlr = haFloors2.find(f=>String(f.id)===String(floorId));
      const flLbl = haFlr ? (haFlr.name||haFlr.id) : (floorId||"—");
      // Rooms come from the fabric, so the list no longer needs a photo to
      // have been traced — and no longer names the picture a room came from.
      for(const [room, g] of Object.entries((ctx.state.model||{}).room_geometry_m || {})){
        if(String(g && g.floor_id) !== String(floorId)) continue;
        if(!ovRoomRows.find(r=>r.room===room)){
          const objsInRoom = allObjects.filter(o=>_presentInRoom(ctx,o,room));
          ovRoomRows.push({ room, map: flLbl, floor: flLbl, count: objsInRoom.length, objects: objsInRoom });
        }
      }
    }
    ovRoomRows.sort((a,b)=>a.room.localeCompare(b.room));

    if(ovRoomRows.length){
      const thStyle = "padding:5px 8px;color:#94a3b8;font-weight:500;text-align:left";
      const tbl = el("table",{style:"width:100%;border-collapse:collapse;font-size:13px"},[
        el("thead",{},el("tr",{style:"border-bottom:1px solid #1b3526"},[
          el("th",{style:thStyle+";width:24px"}),
          el("th",{style:thStyle},"Room"),
          el("th",{style:thStyle},"Floor"),
          el("th",{style:thStyle},"Objects"),
        ])),
      ]);
      const tbody2 = document.createElement("tbody");
      const roomColorFn2 = ctx.helpers.roomColor;
      for(const rr of ovRoomRows){
        const color = roomColorFn2(rr.room);
        const hasFollowed = rr.objects.some(o=> ctx.actions.followedHas(o.address||"") || ctx.actions.followedHas(o.entity_id||""));
        // Build object summary chips
        const objChips = el("div",{style:"display:flex;flex-wrap:wrap;gap:3px;margin-top:2px"});
        for(const o of (rr.objects||[]).slice(0,6)){
          const oKey = o.address || o.entity_id || "";
          const isF = ctx.actions.followedHas(oKey);
          const lbl = (o.user_label || o.private_ble_name || o.name || o.address || "?").substring(0,16);
          const oc = isF ? "#fbbf24" : (o.identified ? "#5eead488" : "#f59e0b88");
          const chip = el("span",{style:`font-size:10px;padding:1px 5px;border-radius:3px;background:${oc}22;color:${isF?"#fbbf24":"#94a3b8"};border:1px solid ${oc};white-space:nowrap${isF?";font-weight:700":""}`}, isF ? lbl + " \u25C9" : lbl);
          objChips.appendChild(chip);
        }
        if(rr.objects.length > 6) objChips.appendChild(el("span",{style:"font-size:10px;color:#64748b"}, `+${rr.objects.length-6}`));

        const roomCell = el("td",{style:"padding:5px 8px"},[
          el("span",{style:"font-weight:600;color:#e2e8f0"}, rr.room),
          hasFollowed ? el("span",{style:"margin-left:6px;font-size:9px;color:#fbbf24;font-weight:700"}, "\u25C9 tracked") : null,
        ].filter(Boolean));

        const tr2 = el("tr",{style:"border-bottom:1px solid #0f2017;cursor:pointer"},[
          el("td",{style:"padding:5px 8px"},el("span",{style:`display:inline-block;width:14px;height:14px;border-radius:50%;background:${color};vertical-align:middle`})),
          roomCell,
          el("td",{style:"padding:5px 8px;color:#94a3b8"}, rr.floor),
          el("td",{style:"padding:5px 8px"}, [
            el("span",{style:"color:#94a3b8"}, rr.count ? String(rr.count) : ""),
            objChips,
          ]),
        ]);
        tr2.addEventListener("click",()=>ctx.actions.showRoomDetail(rr.room));
        tbody2.appendChild(tr2);
      }
      tbl.appendChild(tbody2);
      roomListPanel.appendChild(tbl);
    } else {
      const msg = document.createElement("div");
      msg.className = "muted"; msg.style.cssText = "font-size:12px;padding:8px";
      msg.textContent = "No rooms drawn yet. Go to Maps → Edit to draw room boundaries.";
      roomListPanel.appendChild(msg);
    }

    const roomToggleBtn = document.createElement("button");
    roomToggleBtn.className = "btn inline";
    roomToggleBtn.style.cssText = "padding:1px 6px;font-size:10px";
    roomToggleBtn.textContent = ctx.state._overviewShowRoomList ? "Rooms \u25BC" : "Rooms";
    roomToggleBtn.addEventListener("click", ()=>{
      ctx.state._overviewShowRoomList = !ctx.state._overviewShowRoomList;
      roomToggleBtn.textContent = ctx.state._overviewShowRoomList ? "Rooms \u25BC" : "Rooms";
      roomListPanel.style.display = ctx.state._overviewShowRoomList ? "block" : "none";
    });

    // Spacing slider
    const ovGapLbl = document.createElement("span");
    ovGapLbl.style.cssText = "font-size:12px;color:#94a3b8;min-width:36px;display:inline-block;text-align:right";
    ovGapLbl.textContent = String(ctx.state._overviewFloorGap);
    const ovGapSlider = document.createElement("input");
    ovGapSlider.type="range"; ovGapSlider.min="60"; ovGapSlider.max="340"; ovGapSlider.step="10";
    ovGapSlider.style.cssText = "width:110px;accent-color:#52b788;vertical-align:middle;cursor:pointer";
    ovGapSlider.value = String(ctx.state._overviewFloorGap);
    ovGapSlider.addEventListener("input",()=>{
      ctx.state._overviewFloorGap = parseInt(ovGapSlider.value, 10);
      _ovFG = ctx.state._overviewFloorGap;
      ovGapLbl.textContent = String(ctx.state._overviewFloorGap);
      _rebuildPositions();
      _rebuildIso(ctx.state._overviewIsoFocus);
    });

    // L/R horizontal offset slider
    const ovHorizLbl = document.createElement("span");
    ovHorizLbl.style.cssText = "font-size:12px;color:#94a3b8;min-width:36px;display:inline-block;text-align:right";
    ovHorizLbl.textContent = String(ctx.state._overviewHorizGap);
    const ovHorizSlider = document.createElement("input");
    ovHorizSlider.type="range"; ovHorizSlider.min="-120"; ovHorizSlider.max="120"; ovHorizSlider.step="10";
    ovHorizSlider.style.cssText = "width:110px;accent-color:#52b788;vertical-align:middle;cursor:pointer";
    ovHorizSlider.value = String(ctx.state._overviewHorizGap);
    ovHorizSlider.addEventListener("input",()=>{
      ctx.state._overviewHorizGap = parseInt(ovHorizSlider.value, 10);
      _ovHG = ctx.state._overviewHorizGap;
      ovHorizLbl.textContent = String(ctx.state._overviewHorizGap);
      _rebuildPositions();
      _rebuildIso(ctx.state._overviewIsoFocus);
    });

    const ctrlRow = document.createElement("div");
    ctrlRow.style.cssText = "display:flex;align-items:center;gap:4px;flex-wrap:wrap;font-size:10px";
    const floorLbl = document.createElement("span");
    floorLbl.style.cssText = "color:#94a3b8";
    floorLbl.textContent = "Floor:";
    ctrlRow.appendChild(floorLbl);
    focusSlider.style.cssText = "width:90px;accent-color:#52b788;vertical-align:middle;cursor:pointer";
    focusLbl.style.cssText = "color:#94a3b8;min-width:60px;display:inline-block";
    ctrlRow.appendChild(focusSlider);
    ctrlRow.appendChild(focusLbl);
    // Spacing
    const ovSpacingLbl = document.createElement("span");
    ovSpacingLbl.style.cssText = "color:#94a3b8;margin-left:4px";
    ovSpacingLbl.textContent = "Gap:";
    ctrlRow.appendChild(ovSpacingLbl);
    ovGapSlider.style.cssText = "width:70px;accent-color:#52b788;vertical-align:middle;cursor:pointer";
    ctrlRow.appendChild(ovGapSlider);
    ctrlRow.appendChild(ovGapLbl);
    // L/R
    const ovLRLbl = document.createElement("span");
    ovLRLbl.style.cssText = "color:#94a3b8;margin-left:4px";
    ovLRLbl.textContent = "L/R:";
    ctrlRow.appendChild(ovLRLbl);
    ovHorizSlider.style.cssText = "width:70px;accent-color:#52b788;vertical-align:middle;cursor:pointer";
    ctrlRow.appendChild(ovHorizSlider);
    ctrlRow.appendChild(ovHorizLbl);
    // Save button — persists all three slider values to settings store
    const ovSaveLbl = document.createElement("span");
    ovSaveLbl.style.cssText = "color:#94a3b8;min-width:40px";
    const ovSaveBtn = document.createElement("button");
    ovSaveBtn.className = "btn inline";
    ovSaveBtn.style.cssText = "padding:1px 6px;font-size:10px";
    ovSaveBtn.title = "Save these slider positions so the view reopens with the same layout";
    ovSaveBtn.textContent = "Save";
    ovSaveBtn.addEventListener("click", async ()=>{
      ovSaveBtn.disabled = true;
      try{
        await ctx.actions.settingsSet({
          overview_iso_floor_gap: ctx.state._overviewFloorGap,
          overview_iso_horiz_gap: ctx.state._overviewHorizGap,
          overview_iso_focus:     ctx.state._overviewIsoFocusIdx,
        });
        ovSaveLbl.textContent = "Saved ✓";
        setTimeout(()=>{ ovSaveLbl.textContent = ""; }, 2000);
      }catch(e){ ovSaveLbl.textContent = "Error"; }
      ovSaveBtn.disabled = false;
    });
    const ovResetBtn = document.createElement("button");
    ovResetBtn.className = "btn inline";
    ovResetBtn.style.cssText = "padding:1px 6px;font-size:10px";
    ovResetBtn.title = "Reset sliders to default values and clear the saved layout";
    ovResetBtn.textContent = "Reset";
    ovResetBtn.addEventListener("click", async ()=>{
      ctx.state._overviewFloorGap = 150; _ovFG = 150;
      ctx.state._overviewHorizGap = 0;   _ovHG = 0;
      ctx.state._overviewIsoFocusIdx = 0;
      ovGapSlider.value   = "150"; ovGapLbl.textContent   = "150";
      ovHorizSlider.value = "0";   ovHorizLbl.textContent = "0";
      focusSlider.value   = "0";   focusLbl.textContent   = "All floors";
      _rebuildPositions();
      _rebuildIso(null);
      ovResetBtn.disabled = true;
      try{
        await ctx.actions.settingsSet({ overview_iso_floor_gap:150, overview_iso_horiz_gap:0, overview_iso_focus:0 });
        ovSaveLbl.textContent = "Reset ✓";
        setTimeout(()=>{ ovSaveLbl.textContent = ""; }, 2000);
      }catch(e){ ovSaveLbl.textContent = "Error"; }
      ovResetBtn.disabled = false;
    });
    ctrlRow.appendChild(ovSaveBtn);
    ctrlRow.appendChild(ovResetBtn);
    ctrlRow.appendChild(ovSaveLbl);
    ctrlRow.appendChild(roomToggleBtn);

    // View-mode toggle — flip to the top-down overhead (2D) map.
    const ovTo2d = document.createElement("button");
    ovTo2d.className = "btn inline";
    ovTo2d.style.cssText = "padding:1px 6px;font-size:10px;color:#94a3b8";
    ovTo2d.textContent = "▣ Overhead";
    ovTo2d.title = "Switch to the large top-down overhead map";
    ovTo2d.addEventListener("click", async ()=>{
      ovTo2d.disabled = true;
      try { await ctx.actions.settingsSet({ overview_2d_mode: true }); }
      catch(e){ ovTo2d.disabled = false; if(ctx.toast) ctx.toast("Failed to switch view", true); }
    });
    ctrlRow.appendChild(ovTo2d);

    const ovPersistentBtn = document.createElement("button");
    ovPersistentBtn.className = "btn inline";
    const _pinStyle = (on) => `padding:1px 6px;font-size:10px;${on ? "background:#7f1d1d;border-color:#ef4444;color:#fca5a5;font-weight:700" : "color:#94a3b8"}`;
    ovPersistentBtn.style.cssText = _pinStyle(ctx.state._overviewPersistentPins);
    ovPersistentBtn.textContent = ctx.state._overviewPersistentPins ? "Pins ON" : "Pins";
    ovPersistentBtn.addEventListener("click", ()=>{
      ctx.state._overviewPersistentPins = !ctx.state._overviewPersistentPins;
      ovPersistentBtn.style.cssText = _pinStyle(ctx.state._overviewPersistentPins);
      ovPersistentBtn.textContent = ctx.state._overviewPersistentPins ? "Pins ON" : "Pins";
      _rebuildIso(_getFocusZ(ctx.state._overviewIsoFocusIdx));
      // Persist to settings so it survives reboots
      ctx.actions.settingsSet({ overview_persistent_pins: ctx.state._overviewPersistentPins });
    });
    ctrlRow.appendChild(ovPersistentBtn);

    const ovWallsBtn = document.createElement("button");
    ovWallsBtn.className = "btn inline";
    const _wallStyle = (on) => `padding:1px 6px;font-size:10px;${on ? "background:#1a1a2e;border-color:#6366f1;color:#a5b4fc;font-weight:700" : "color:#94a3b8"}`;
    ovWallsBtn.style.cssText = _wallStyle(ctx.state._overviewShowWalls);
    ovWallsBtn.textContent = ctx.state._overviewShowWalls ? "Walls ON" : "Walls";
    ovWallsBtn.addEventListener("click", ()=>{
      ctx.state._overviewShowWalls = !ctx.state._overviewShowWalls;
      ovWallsBtn.style.cssText = _wallStyle(ctx.state._overviewShowWalls);
      ovWallsBtn.textContent = ctx.state._overviewShowWalls ? "Walls ON" : "Walls";
      _rebuildIso(_getFocusZ(ctx.state._overviewIsoFocusIdx));
      ctx.actions.settingsSet({ overview_show_walls: ctx.state._overviewShowWalls });
    });
    ctrlRow.appendChild(ovWallsBtn);

    // ── Radio Map + Distortion toggles (mutually exclusive) ────────────────
    const _heatStyle = (on) => `padding:1px 6px;font-size:10px;${on ? "background:#2d1b4e;border-color:#a855f7;color:#d8b4fe;font-weight:700" : "color:#94a3b8"}`;
    const _distStyle = (on) => `padding:1px 6px;font-size:10px;${on ? "background:#431407;border-color:#f97316;color:#fdba74;font-weight:700" : "color:#94a3b8"}`;
    let _ovHeatBtn = null, _ovDistBtn = null;
    let _isoOverlayCtrl = null; // slider bar — toggled by _syncOverlayBtns

    const _syncOverlayBtns = () => {
      if (_ovHeatBtn) {
        _ovHeatBtn.style.cssText = _heatStyle(ctx.state._overviewShowHeatmap);
        _ovHeatBtn.textContent = ctx.state._overviewShowHeatmap ? "Heat ON" : "Heat";
      }
      if (_ovDistBtn) {
        _ovDistBtn.style.cssText = _distStyle(ctx.state._overviewShowDistortion);
        _ovDistBtn.textContent = ctx.state._overviewShowDistortion ? "Warp ON" : "Warp";
      }
      // Show/hide the slider control bar based on active overlay
      if (_isoOverlayCtrl) {
        const show = ctx.state._overviewShowHeatmap || ctx.state._overviewShowDistortion;
        _isoOverlayCtrl.style.display = show ? "flex" : "none";
      }
      _rebuildIso(_getFocusZ(ctx.state._overviewIsoFocusIdx));
    };

    if (_isoRadioMapOn) {
      _ovHeatBtn = document.createElement("button");
      _ovHeatBtn.className = "btn inline";
      _ovHeatBtn.style.cssText = _heatStyle(ctx.state._overviewShowHeatmap);
      _ovHeatBtn.textContent = ctx.state._overviewShowHeatmap ? "Heat ON" : "Heat";
      _ovHeatBtn.addEventListener("click", () => {
        ctx.state._overviewShowHeatmap = !ctx.state._overviewShowHeatmap;
        if (ctx.state._overviewShowHeatmap) ctx.state._overviewShowDistortion = false; // mutual exclusion
        _syncOverlayBtns();
      });
      ctrlRow.appendChild(_ovHeatBtn);
    }

    const _isoDistortionOn = !!(ctx.state.settings && ctx.state.settings.distortion_map_enabled);
    if (_isoDistortionOn) {
      _ovDistBtn = document.createElement("button");
      _ovDistBtn.className = "btn inline";
      _ovDistBtn.style.cssText = _distStyle(ctx.state._overviewShowDistortion);
      _ovDistBtn.textContent = ctx.state._overviewShowDistortion ? "\u2192 Distortion ON" : "\u2192 Distortion";
      _ovDistBtn.addEventListener("click", () => {
        ctx.state._overviewShowDistortion = !ctx.state._overviewShowDistortion;
        if (ctx.state._overviewShowDistortion) ctx.state._overviewShowHeatmap = false; // mutual exclusion
        _syncOverlayBtns();
      });
      ctrlRow.appendChild(_ovDistBtn);
    }
    ctrlRow.appendChild(helpBtn("overview_3d_controls"));

    outer.appendChild(ctrlRow);

    // ── Overlay controls: Gain, Contrast, Distortion Intensity, Save ──────
    // Shared bar for both heatmap and distortion — visible when either is active
    if (_isoRadioMapOn || _isoDistortionOn) {
      _isoOverlayCtrl = document.createElement("div");
      const isoOverlayCtrl = _isoOverlayCtrl;
      isoOverlayCtrl.style.cssText = (ctx.state._overviewShowHeatmap || ctx.state._overviewShowDistortion)
        ? "display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:8px;padding:6px 10px;background:#0a1a12;border:1px solid #1a4228;border-radius:8px"
        : "display:none";

      const _mkSlider = (label, min, max, value, color, width) => {
        const lbl = document.createElement("span");
        lbl.style.cssText = `font-size:10px;color:${color};min-width:${width}px`;
        lbl.textContent = label;
        const sl = document.createElement("input");
        sl.type = "range"; sl.min = String(min); sl.max = String(max); sl.step = "1";
        sl.value = String(value);
        sl.style.cssText = `width:80px;accent-color:${color}`;
        return { lbl, sl };
      };

      const g = _mkSlider(`Gain: ${ctx.state._heatGain ?? ctx.state.settings?.heatmap_gain ?? 0}`, -20, 20, ctx.state._heatGain ?? ctx.state.settings?.heatmap_gain ?? 0, "#d8b4fe", 50);
      const c = _mkSlider(`Contrast: ${ctx.state._heatContrast ?? ctx.state.settings?.heatmap_contrast ?? 0}`, -15, 15, ctx.state._heatContrast ?? ctx.state.settings?.heatmap_contrast ?? 0, "#d8b4fe", 65);
      const d = _mkSlider(`Warp: ${ctx.state._distIntensity ?? ctx.state.settings?.distortion_intensity ?? 50}%`, 0, 100, ctx.state._distIntensity ?? ctx.state.settings?.distortion_intensity ?? 50, "#fdba74", 55);
      const src = _mkSlider(`Source: ${ctx.state._heatSource ?? ctx.state.settings?.heatmap_source ?? 0}%`, 0, 100, ctx.state._heatSource ?? ctx.state.settings?.heatmap_source ?? 0, "#5eead4", 60);

      const iSaveBtn = document.createElement("button");
      iSaveBtn.className = "btn inline";
      iSaveBtn.style.cssText = "font-size:10px;padding:2px 8px;color:#52b788;border-color:#2d6a4f";
      iSaveBtn.textContent = "Save";
      iSaveBtn.addEventListener("click", async () => {
        try {
          await ctx.actions.settingsSet({
            heatmap_gain: parseInt(g.sl.value, 10),
            heatmap_contrast: parseInt(c.sl.value, 10),
            distortion_intensity: parseInt(d.sl.value, 10),
            heatmap_source: parseInt(src.sl.value, 10),
          });
          ctx.toast("Overlay settings saved");
        } catch(e) { ctx.toast("Failed to save", true); }
      });

      // Loading progress bar for overlay rendering
      const progressBar = document.createElement("div");
      progressBar.style.cssText = "width:60px;height:4px;background:#1a2e1e;border-radius:2px;overflow:hidden;flex-shrink:0";
      const progressFill = document.createElement("div");
      progressFill.style.cssText = "width:0;height:100%;background:#52b788;border-radius:2px;transition:width 0.3s";
      progressBar.appendChild(progressFill);

      const statusLbl = document.createElement("span");
      statusLbl.style.cssText = "font-size:9px;color:#64748b;min-width:40px";
      statusLbl.textContent = "";

      const _showProgress = (pct, text) => {
        progressFill.style.width = pct + "%";
        statusLbl.textContent = text || "";
      };

      // Fetch adaptive fingerprints once for the source blend
      if (!ctx.state._adaptiveFpLoaded) {
        ctx.state._adaptiveFpLoaded = true;
        _showProgress(20, "Loading...");
        ctx.actions.callWS({ type: "padspan_ha/adaptive_fingerprints_get" }).then(res => {
          if (res?.fingerprints) {
            ctx.state._adaptiveFps = res.fingerprints;
            ctx.state._adaptiveObs = res.total_observations || 0;
            const rooms = Object.keys(res.fingerprints).length;
            _showProgress(100, `${res.total_observations} obs, ${rooms} rooms`);
          } else {
            _showProgress(100, "No data");
          }
        }).catch(() => { _showProgress(100, "Error"); });
      } else if (ctx.state._adaptiveObs) {
        const rooms = Object.keys(ctx.state._adaptiveFps || {}).length;
        statusLbl.textContent = `${ctx.state._adaptiveObs} obs, ${rooms} rooms`;
        progressFill.style.width = "100%";
      }

      // Debounced update — prevents rebuilding SVG on every slider pixel move
      let _overlayTimer = null;
      const _isoOverlayUpdate = () => {
        const gv = parseInt(g.sl.value, 10), cv = parseInt(c.sl.value, 10), dv = parseInt(d.sl.value, 10), sv = parseInt(src.sl.value, 10);
        g.lbl.textContent = `Gain: ${gv > 0 ? "+" : ""}${gv}`;
        c.lbl.textContent = `Contrast: ${cv > 0 ? "+" : ""}${cv}`;
        d.lbl.textContent = `Warp: ${dv}%`;
        src.lbl.textContent = sv === 0 ? "Source: Model" : sv >= 100 ? "Source: Historical" : `Source: ${sv}% hist`;
        ctx.state._heatGain = gv;
        ctx.state._heatContrast = cv;
        ctx.state._distIntensity = dv;
        ctx.state._heatSource = sv;
        if (_isoRadioMapMod) {
          if (_isoRadioMapMod.setUserGainContrast) _isoRadioMapMod.setUserGainContrast(gv, cv);
          if (_isoRadioMapMod.setDistortionIntensity) _isoRadioMapMod.setDistortionIntensity(dv);
          if (_isoRadioMapMod.setSourceBlend) _isoRadioMapMod.setSourceBlend(sv);
          if (_isoRadioMapMod.setAdaptiveData) _isoRadioMapMod.setAdaptiveData(ctx.state._adaptiveFps || null);
          if (_isoRadioMapMod.setFabricWorld && typeof _isoFabricW !== "undefined") _isoRadioMapMod.setFabricWorld(_isoFabricW);
        }
        // Debounce: wait 150ms after last slider move before rebuilding SVG
        _showProgress(30, "Rendering...");
        if (_overlayTimer) clearTimeout(_overlayTimer);
        _overlayTimer = setTimeout(() => {
          _rebuildIso(_getFocusZ(ctx.state._overviewIsoFocusIdx));
          _showProgress(100, sv > 0 && ctx.state._adaptiveObs ? `${ctx.state._adaptiveObs} obs` : "Ready");
        }, 150);
      };
      g.sl.addEventListener("input", _isoOverlayUpdate);
      c.sl.addEventListener("input", _isoOverlayUpdate);
      d.sl.addEventListener("input", _isoOverlayUpdate);
      src.sl.addEventListener("input", _isoOverlayUpdate);

      isoOverlayCtrl.append(g.lbl, g.sl, c.lbl, c.sl, d.lbl, d.sl, src.lbl, src.sl, progressBar, statusLbl, iSaveBtn);
      outer.appendChild(isoOverlayCtrl);
    }

    outer.appendChild(isoWrap);
    outer.appendChild(roomListPanel);

    // Deferred initial build: outer is now fully constructed with all elements.
    // When the browser appends it to the DOM, the rAF fires and builds the SVG
    // with the progress bar visible.
    requestAnimationFrame(() => _rebuildIso(_getFocusZ(ctx.state._overviewIsoFocusIdx)));

    return outer;
  }
  // ---------- Room + radio grid (auto-generated from live HA data) ----------
  function renderRoomGrid(){
    const haAreas  = (ctx.state.model && Array.isArray(ctx.state.model.areas))  ? ctx.state.model.areas  : [];
    const haFloors = (ctx.state.model && Array.isArray(ctx.state.model.floors)) ? ctx.state.model.floors : [];

    const allRadios  = (liveSnap && liveSnap.ble && Array.isArray(liveSnap.ble.radios)) ? liveSnap.ble.radios : [];
    const _rgIsScanner = ctx.helpers.isScanner;
    const _rgRaw = ((liveSnap && liveSnap.objects && Array.isArray(liveSnap.objects.list)) ? liveSnap.objects.list : [])
      .filter(o => !_rgIsScanner(o));
    // Dedup entity rows + filter stale history for room grid
    const _rgAddrSet = new Set();
    for (const o of _rgRaw) {
      if (o.kind !== "ble" && o.kind !== "private_ble" && o.kind !== "ibeacon") continue;
      if (o.address) _rgAddrSet.add(String(o.address).toUpperCase());
      if (Array.isArray(o.all_addresses)) for (const a of o.all_addresses) _rgAddrSet.add(String(a).toUpperCase());
    }
    const _rgLinkedSet = new Set(_rgRaw.flatMap(o => Array.isArray(o.linked_entities) ? o.linked_entities : []));
    const _rgAwayS = ctx.helpers.awayTimeoutS(ctx.state.settings);
    const allObjects = _rgRaw.filter(o => {
      if (o.kind === "entity" && (
        (o.address && _rgAddrSet.has(String(o.address).toUpperCase())) ||
        (o.entity_id && _rgLinkedSet.has(o.entity_id))
      )) return false;
      // Skip objects from deep history (>2x away timeout) for room grid dots
      const age = typeof o.age_s === "number" ? o.age_s : 0;
      if (o.kind !== "entity" && age > Math.max(_rgAwayS * 2, 3600)) return false;
      return true;
    });

    // Build room list from HA areas + roomTagMap (union)
    const roomSet = new Set(haAreas.map(a => a.name));
    for(const r of Object.keys(roomTagMap)) roomSet.add(r);
    const rooms = Array.from(roomSet).sort();

    if(!rooms.length && !allRadios.length) return null;

    // Group radios + objects by room
    const radiosByRoom = {}, objByRoom = {};
    for(const r of allRadios){
      const a = r.area_name || ""; if(a){ (radiosByRoom[a] = radiosByRoom[a]||[]).push(r); }
    }
    for(const o of allObjects){
      const r = o.room || ""; if(r){ (objByRoom[r] = objByRoom[r]||[]).push(o); }
    }
    const unassignedRadios = allRadios.filter(r => !r.area_name);

    // Layout constants — 2 columns, large boxes
    const COLS = 2, BW = 380, BH = 170, GAP = 16, PX = 14, PY = 14;
    const rows = Math.ceil(rooms.length / COLS);
    const svgW  = COLS * (BW + GAP) - GAP + PX * 2;
    const svgH  = rows * (BH + GAP) - GAP + PY * 2;
    const extraH = unassignedRadios.length ? BH * 0.6 + GAP : 0;
    const PALETTE = ["#52b788","#4caf50","#43a047","#388e3c","#66bb6a","#81c784","#a5d6a7","#2e7d32"];

    const _esc = s => String(s||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");

    let s = `<svg viewBox="0 0 ${svgW} ${svgH + extraH}" xmlns="http://www.w3.org/2000/svg" width="100%" style="display:block;font-family:system-ui,sans-serif">`;
    s += `<rect width="${svgW}" height="${svgH + extraH}" fill="#071008" rx="8"/>`;

    rooms.forEach((room, idx) => {
      const col = idx % COLS;
      const row = Math.floor(idx / COLS);
      const x = PX + col * (BW + GAP);
      const y = PY + row * (BH + GAP);
      const color = PALETTE[idx % PALETTE.length];

      // Box
      s += `<rect x="${x}" y="${y}" width="${BW}" height="${BH}" fill="${color}10" stroke="${color}" stroke-width="1.5" rx="10"/>`;

      // Room name
      s += `<text x="${x + BW/2}" y="${y + 22}" text-anchor="middle" fill="${color}" font-size="16" font-weight="700">${_esc(room)}</text>`;

      // Floor label from HA
      const haArea = haAreas.find(a => a.name === room);
      const haFloor = haFloors.find(f => f.id === (haArea?.floor_id||""));
      if(haFloor){
        s += `<text x="${x + BW/2}" y="${y + 37}" text-anchor="middle" fill="${color}88" font-size="11">${_esc(haFloor.name)}</text>`;
      }

      // Radios (antenna rings) — spread across the box width
      const roomRadios = radiosByRoom[room] || [];
      roomRadios.slice(0,5).forEach((r, ri) => {
        const rx = x + 22 + ri * 52, ry = y + 105;
        const sid = _sid(r.source || "");
        const rName = (r.name || r.source || "radio").substring(0, 12);
        s += `<circle cx="${rx}" cy="${ry}" r="14" fill="none" stroke="#52b788" stroke-width="0.7" opacity="0.2"/>`;
        s += `<circle cx="${rx}" cy="${ry}" r="8"  fill="none" stroke="#52b788" stroke-width="1"   opacity="0.5"/>`;
        s += `<circle cx="${rx}" cy="${ry}" r="4"  fill="#52b788"/>`;
        s += `<text x="${rx}" y="${ry - 18}" text-anchor="middle" fill="#52b788" font-size="9" font-weight="600">${sid ? _esc(sid)+" " : ""}${_esc(rName)}</text>`;
        const lbl = (r.name || r.source || "").substring(0, 9);
        s += `<text x="${rx}" y="${ry + 20}" text-anchor="middle" fill="#52b788" font-size="8" opacity="0.7">${_esc(lbl)}</text>`;
      });

      // Objects (dots on the right side)
      const roomObjs = objByRoom[room] || [];
      roomObjs.slice(0,6).forEach((o, oi) => {
        const ox = x + BW - 16 - oi * 28, oy = y + 100;
        const oc = o.identified ? "#5eead4" : "#f59e0b";
        s += `<circle cx="${ox}" cy="${oy}" r="7" fill="${oc}" opacity="0.9"/>`;
        const lbl = (o.user_label || o.private_ble_name || o.name || "?").substring(0, 6);
        s += `<text x="${ox}" y="${oy + 18}" text-anchor="middle" fill="${oc}" font-size="9">${_esc(lbl)}</text>`;
      });

      // Bottom summary
      const rc = roomRadios.length, oc = roomObjs.length;
      const sumTxt = [rc ? `${rc} radio${rc>1?"s":""}` : "", oc ? `${oc} obj${oc>1?"s":""}` : ""].filter(Boolean).join(" · ") || "no devices";
      s += `<text x="${x + BW - 8}" y="${y + BH - 7}" text-anchor="end" fill="${color}77" font-size="10">${_esc(sumTxt)}</text>`;
    });

    // Unassigned radios row
    if(unassignedRadios.length){
      const uy = svgH + GAP;
      s += `<text x="${PX}" y="${uy + 14}" fill="#94a3b8" font-size="12" font-weight="600">Radios not yet assigned to an HA area</text>`;
      unassignedRadios.slice(0,6).forEach((r, ri) => {
        const rx = PX + 20 + ri * 140, ry = uy + 42;
        const rName = (r.name || r.source || "Unknown").substring(0, 16);
        s += `<circle cx="${rx}" cy="${ry}" r="8" fill="none" stroke="#52b788" stroke-width="0.8" opacity="0.3"/>`;
        s += `<circle cx="${rx}" cy="${ry}" r="5" fill="none" stroke="#52b788" stroke-width="1"   opacity="0.6"/>`;
        s += `<circle cx="${rx}" cy="${ry}" r="3" fill="#52b78888"/>`;
        s += `<text x="${rx + 14}" y="${ry - 2}" fill="#52b788" font-size="10" font-weight="600">${_esc(rName)}</text>`;
        s += `<text x="${rx + 14}" y="${ry + 12}" fill="#94a3b8" font-size="9">${_esc(r.name || r.source || "Unknown")}</text>`;
      });
    }

    s += `</svg>`;
    const wrap = document.createElement("div");
    wrap.style.cssText = "margin-bottom:16px";
    wrap.innerHTML = s;
    return wrap;
  }

  // ---------- Floor plan SVG ----------
  function renderFloorPlan(fp){
    if(!fp) return null;
    const vw = fp.vw || 800;
    const vh = fp.vh || 440;
    let s = `<svg viewBox="0 0 ${vw} ${vh}" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto;border-radius:8px;background:#091209;display:block">`;

    // Rooms
    for(const r of (fp.rooms||[])){
      s += `<rect x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}" fill="${r.color}18" stroke="${r.color}" stroke-width="1.5" rx="3"/>`;
      const tx = r.x + r.w/2, ty = r.y + 16;
      s += `<text x="${tx}" y="${ty}" text-anchor="middle" fill="${r.color}" font-size="12" font-family="system-ui,sans-serif" font-weight="600">${esc(r.name)}</text>`;
    }

    // Radio markers (concentric rings = scanning BT proxy)
    for(const radio of (fp.radios||[])){
      const {x,y} = radio;
      const rxName = (radio.name || radio.id || "radio").substring(0, 16);
      s += `<circle cx="${x}" cy="${y}" r="22" fill="none" stroke="#52b788" stroke-width="0.8" opacity="0.2"/>`;
      s += `<circle cx="${x}" cy="${y}" r="14" fill="none" stroke="#52b788" stroke-width="1" opacity="0.4"/>`;
      s += `<circle cx="${x}" cy="${y}" r="8"  fill="none" stroke="#52b788" stroke-width="1.5" opacity="0.7"/>`;
      s += `<circle cx="${x}" cy="${y}" r="4"  fill="#52b788" opacity="1"/>`;
      s += `<text x="${x}" y="${y-26}" text-anchor="middle" fill="#52b788" font-size="10" font-weight="600">${esc(rxName)}</text>`;
      s += `<text x="${x}" y="${y+30}" text-anchor="middle" fill="#94a3b8" font-size="9" font-family="system-ui,sans-serif">${esc(radio.name)}</text>`;
    }

    // Objects (phones, keys, trackers)
    for(const obj of (fp.objects||[])){
      const {x,y,color,name} = obj;
      s += `<circle cx="${x}" cy="${y}" r="7" fill="${color}" opacity="0.95"/>`;
      s += `<text x="${x}" y="${y-11}" text-anchor="middle" fill="${color}" font-size="9" font-family="system-ui,sans-serif">${esc(name)}</text>`;
    }

    s += `</svg>`;
    const wrap = document.createElement("div");
    wrap.style.cssText = "margin-bottom:16px";
    wrap.innerHTML = s;
    if(fp.name){
      const lbl = document.createElement("div");
      lbl.style.cssText = "color:#94a3b8;font-size:11px;margin-top:4px;text-align:center";
      lbl.textContent = fp.name;
      wrap.appendChild(lbl);
    }
    return wrap;
  }

  // Always try iso floor stack first; falls back to sample floor plan or room grid if no maps
  const mapEl = renderIsoFloorStack();
  if (mapEl) mapEl.setAttribute("data-padspan-map", "true");

  // ── SUSPENDED banner builder (used by both basic + advanced sections) ──
  const _buildSuspendBanner = () => {
    if (liveSnap?.suspended !== true) return null;
    const _remS = liveSnap.suspend_remaining_s ?? 0;
    const _mm = Math.floor(_remS / 60);
    const _ss = _remS % 60;
    const _countdown = _remS > 0 ? `${_mm}:${String(_ss).padStart(2,"0")} remaining` : "ending soon";

    if (!document.getElementById("padspan-suspend-flash-style")) {
      const _sty = document.createElement("style");
      _sty.id = "padspan-suspend-flash-style";
      _sty.textContent = [
        `@keyframes padspan-suspend-pulse { 0%,100%{box-shadow:0 0 8px rgba(251,191,36,.3)} 50%{box-shadow:0 0 18px rgba(251,191,36,.7)} }`,
        `@keyframes padspan-suspend-dot { 0%,100%{opacity:1} 50%{opacity:0.3} }`,
      ].join("\n");
      document.head.appendChild(_sty);
    }

    const cancelBtn = el("button",{style:
      "background:#991b1b;color:#fecaca;border:1px solid #b91c1c;border-radius:4px;" +
      "padding:3px 12px;font-size:11px;font-weight:600;cursor:pointer;margin-left:12px"
    }, "Resume Normal");
    cancelBtn.addEventListener("click", async () => {
      cancelBtn.disabled = true; cancelBtn.textContent = "Resuming...";
      try {
        await ctx.actions.wsCall("padspan_ha/unsuspend_databases");
        ctx.toast("Normal pipeline resumed");
      } catch(e) { ctx.toast("Failed: " + String(e), true); }
    });

    return el("div",{style:
      "display:flex;align-items:center;justify-content:center;gap:10px;" +
      "padding:8px 16px;margin-bottom:10px;border-radius:8px;" +
      "background:linear-gradient(135deg,#78350f,#92400e);" +
      "border:1px solid #b45309;" +
      "animation:padspan-suspend-pulse 2s ease-in-out infinite"
    },[
      el("span",{style:"font-size:16px;animation:padspan-suspend-dot 1s ease-in-out infinite"}, "\u26a0"),
      el("span",{style:"color:#fbbf24;font-weight:700;font-size:13px;letter-spacing:0.3px"},
        "DATABASES SUSPENDED"),
      el("span",{"data-suspend-countdown":"1",style:"color:#fde68a;font-size:12px;font-weight:400"},
        "Raw radio only \u00b7 " + _countdown),
      cancelBtn,
    ]);
  };

  // ── Positioning Diagnostics panel ────────────────────────────────────
  const _buildDiagPanel = () => {
    const wrap = el("div",{class:"card",style:"border-color:#334155"});
    const hdr = el("div",{style:"display:flex;align-items:center;gap:8px;cursor:pointer"});
    const arrow = el("span",{style:"font-size:11px;color:#60a5fa;transition:transform .2s"},"\u25B6");
    hdr.appendChild(arrow);
    hdr.appendChild(el("span",{style:"font-weight:700;font-size:13px;color:#60a5fa"},"Positioning Diagnostics"));
    hdr.appendChild(el("span",{class:"muted",style:"font-size:11px;flex:1"},"Tap to load"));
    wrap.appendChild(hdr);
    const body = el("div",{style:"display:none;margin-top:8px"});
    wrap.appendChild(body);
    hdr.addEventListener("click", async () => {
      const open = body.style.display !== "none";
      if (open) { body.style.display = "none"; arrow.style.transform = ""; return; }
      body.style.display = "block"; arrow.style.transform = "rotate(90deg)";
      body.textContent = "Loading...";
      try {
        const res = await ctx.actions.wsCall("padspan_ha/positioning_diag");
        const devices = res.devices || [];
        if (!devices.length) { body.textContent = "No labelled devices found."; _loaded = true; return; }
        body.textContent = "";
        const pre = el("pre",{style:"font-size:11px;color:#e2e8f0;background:#0f172a;padding:10px;border-radius:6px;overflow-x:auto;white-space:pre-wrap;max-height:400px;overflow-y:auto;user-select:all;cursor:text"});
        const lines = [];
        // System health summary
        const st = res.stats || {};
        const seed = res.ble_seed || {};
        const ag = res.all_room_geometry || {};
        const agKeys = Object.keys(ag);
        lines.push(`=== PadSpan Positioning Diagnostics ===`);
        lines.push(`BLE: ${seed.method||"?"} | ${seed.scanner_count||0} scanners | ${st.active||0} active devices of ${st.total||0}`);
        lines.push(`Scanner positions: ${res.scanner_positions||0} | Room polygons: ${agKeys.length} | Spatial OK: ${st.spatial_ok||0} | OUTSIDE_ALL: ${st.outside_all||0}`);
        if (seed.error) lines.push(`BLE ERROR: ${seed.error}`);
        lines.push("");
        // Per device: decision chain
        for (const d of devices) {
          const conf = d.confirmed || "---";
          const cand = d.candidate || "---";
          const sp = d.spatial_room || "";
          // Flag: does spatial disagree with confirmed?
          const flag = (sp && conf !== "---" && sp !== conf) ? " \u26A0" : (sp && sp === conf) ? " \u2713" : "";
          lines.push(`[${d.label}] ${d.kind}${flag}`);
          // Line 2: decision chain
          const src = d.cand_source || "?";
          lines.push(`  confirmed: ${conf} | candidate: ${cand} (${src}) | spatial: ${sp || "none"}`);
          // Line 3: spatial detail if computed
          if (d.spatial_xy) {
            lines.push(`  position: ${d.spatial_xy}`);
          }
          // Line 4: top scanners
          const top = (d.scanners || []).map(s => `${s.room}=${s.rssi}[${s.floor}]`).join(", ");
          lines.push(`  scanners(${d.ema_count}/${d.ema_with_pos}pos): ${top}`);
          // Line 5: vote window
          if (d.votes && d.votes.length) {
            // Abbreviate room names for compactness
            const abbr = (r) => {
              if (!r) return "?";
              const words = r.split(/[\s']+/);
              return words.length > 1 ? words.map(w => w[0]).join("").toUpperCase() : r.slice(0, 8);
            };
            const voteStr = d.votes.map(abbr).join(" ");
            const counts = {};
            d.votes.forEach(v => { counts[v] = (counts[v]||0) + 1; });
            const topVote = Object.entries(counts).sort((a,b) => b[1]-a[1])[0];
            lines.push(`  votes: [${voteStr}] ${topVote ? topVote[0]+"="+topVote[1]+"/"+d.votes.length : ""}`);
          }
          // Line 6: RSSI scores if available
          if (d.rssi_top3 && d.rssi_top3.length) {
            lines.push(`  rssi_scores: ${d.rssi_top3.map(([r,s]) => `${r}=${s}`).join(", ")}`);
          }
          lines.push("");
        }
        pre.textContent = lines.join("\n");
        body.appendChild(pre);
        const copyBtn = el("button",{class:"btn",style:"margin-top:6px;font-size:11px;padding:4px 10px"},"Copy to Clipboard");
        copyBtn.addEventListener("click", () => {
          const text = pre.textContent;
          // Use textarea + execCommand as primary (works in HA shadow DOM)
          const ta = document.createElement("textarea");
          ta.value = text;
          ta.style.cssText = "position:fixed;left:-9999px;top:-9999px";
          document.body.appendChild(ta);
          ta.select();
          try { document.execCommand("copy"); ctx.toast("Copied"); }
          catch(e) {
            // Fallback: try clipboard API
            navigator.clipboard.writeText(text).then(() => ctx.toast("Copied")).catch(() => ctx.toast("Copy failed — select text manually", true));
          }
          document.body.removeChild(ta);
        });
        body.appendChild(copyBtn);
        // data loaded
      } catch(e) { body.textContent = "Error: " + String(e); }
    });
    return wrap;
  };

  // ---------- Basic mode layout ----------
  if(isBasic){
    const summary = el("div",{class:"basic-summary"},[
      el("div",{style:"text-align:center"},[
        el("div",{class:"basic-summary-num"}, liveLoading ? "--" : String(roomsCount)),
        el("div",{class:"basic-summary-lbl"}, "Rooms"),
      ]),
      el("div",{style:"text-align:center"},[
        el("div",{class:"basic-summary-num"}, liveLoading ? "--" : String(objectsTotal)),
        el("div",{class:"basic-summary-lbl"}, "Objects"),
      ]),
      el("div",{style:"text-align:center"},[
        el("div",{class:"basic-summary-num"}, liveLoading ? "--" : String(radiosCount)),
        el("div",{class:"basic-summary-lbl"}, "Scanners"),
      ]),
      (() => {
        const cs = liveSnap?.calibration_status;
        if (!cs) return null;
        const total = cs.total_points || 0;
        const empty = cs.empty_points || 0;
        const usable = total - empty;
        const color = !usable ? "#f87171" : usable >= (cs.knn_min_required||5) ? "#52b788" : "#f59e0b";
        const algoName = cs.positioning_algorithm === "rf" ? "RF" : "k-NN";
        const knnLabel = cs.store_initialized === false ? "Store not loaded" :
          !cs.knn_active ? `Need ${(cs.knn_min_required||5) - usable} more` :
          cs.knn_positioned_objects > 0 ? `${algoName} active (${cs.knn_positioned_objects})` : `${algoName} ready`;
        const knnColor = cs.store_initialized === false ? "#f87171" :
          cs.knn_active && cs.knn_positioned_objects > 0 ? "#52b788" :
          cs.knn_active ? "#f59e0b" : "#94a3b8";
        return el("div",{style:"text-align:center"},[
          el("div",{class:"basic-summary-num",style:`color:${color}`}, liveLoading ? "--" : String(usable)),
          el("div",{class:"basic-summary-lbl"}, "Cal pts"),
          el("div",{style:`font-size:9px;color:${knnColor};margin-top:2px`}, knnLabel),
        ]);
      })(),
    ].filter(Boolean));

    const mapCard = el("div",{class:"card"},[
      el("div",{class:"card-head"},[
        el("div",{class:"h2"}, "Your home"),
        helpBtn("overview"),
      ]),
      el("div",{class:"muted",style:"font-size:12px;margin-bottom:10px"},
        dataMode === "live" ? "Live view · updates every 5s" : "Sample data — switch to Live for your real home."),
    ]);
    if(mapEl) mapCard.appendChild(mapEl);

    // Companion phone discovery (basic mode) — collapsed by default
    const basicCompanionCard = el("div",{class:"card",style:"border-color:#2563eb"});
    if (dataMode === "live") {
      // Collapsed header row — click to expand
      const _phoneHdr = el("div",{style:"display:flex;align-items:center;gap:8px;cursor:pointer"});
      const _phoneArrow = el("span",{style:"font-size:11px;color:#60a5fa;transition:transform .2s"}, "\u25B6");
      _phoneHdr.appendChild(_phoneArrow);
      _phoneHdr.appendChild(el("span",{style:"font-weight:600;font-size:13px;color:#60a5fa"}, "Track Your Phone"));
      _phoneHdr.appendChild(el("span",{class:"muted",style:"font-size:11px;flex:1"}, "Tap to expand"));
      basicCompanionCard.appendChild(_phoneHdr);
      const _phoneBody = el("div",{style:"display:none;margin-top:8px"});
      basicCompanionCard.appendChild(_phoneBody);
      _phoneHdr.addEventListener("click", () => {
        const open = _phoneBody.style.display !== "none";
        _phoneBody.style.display = open ? "none" : "block";
        _phoneArrow.style.transform = open ? "" : "rotate(90deg)";
        _phoneHdr.querySelector(".muted").textContent = open ? "Tap to expand" : "";
      });
      const _bLoadMsg = el("div",{class:"muted",style:"font-size:12px"}, "Discovering phones...");
      _phoneBody.appendChild(_bLoadMsg);
      (async () => {
        try {
          const res = await ctx.actions.wsCall("padspan_ha/companion_discover", {});
          const phones = res.phones || [];
          if (!phones.length) {
            _bLoadMsg.textContent = "No phones detected. Enable the HA Companion App with BLE Transmitter.";
            _bLoadMsg.style.color = "#64748b";
            return;
          }

          _bLoadMsg.textContent = "Phones with the HA Companion App. Track or unfollow below.";

          for (const phone of phones) {
            const row = document.createElement("div");
            row.style.cssText = "display:flex;align-items:center;gap:10px;padding:8px 10px;border-radius:6px;background:#0f172a;margin-bottom:6px";

            // Name + status
            const info = document.createElement("div");
            info.style.cssText = "flex:1;min-width:0";
            const nameEl = document.createElement("div");
            nameEl.style.cssText = "font-weight:600;font-size:13px;color:#e2e8f0";
            nameEl.textContent = phone.device_name || "Phone";
            info.appendChild(nameEl);
            const meta = document.createElement("div");
            meta.style.cssText = "font-size:11px;color:#64748b;margin-top:2px";
            const parts = [];
            if (phone.is_disabled) parts.push("Entity disabled");
            else if (phone.is_transmitting) parts.push("BLE active");
            else parts.push(`BLE: ${phone.state || "off"}`);
            if (!phone.is_disabled) parts.push(phone.is_visible ? "visible" : "not seen");
            if (phone.is_followed) parts.push("tracked");
            if (phone.existing_label) parts.push(phone.existing_label);
            parts.push(phone.has_irk ? "IRK \u2713" : "no IRK");
            meta.textContent = parts.join(" · ");
            info.appendChild(meta);

            // IRK section — add button or show status
            if (!phone.has_irk && !phone.is_disabled) {
              const irkRow = document.createElement("div");
              irkRow.style.cssText = "margin-top:4px;display:flex;align-items:center;gap:6px;flex-wrap:wrap";

              const irkHint = document.createElement("span");
              irkHint.style.cssText = "font-size:10px;color:#f59e0b";
              irkHint.textContent = "No IRK \u2014 ";
              irkRow.appendChild(irkHint);

              const addIrkBtn = document.createElement("button");
              addIrkBtn.style.cssText = "font-size:10px;padding:2px 8px;border-radius:3px;cursor:pointer;border:1px solid #2563eb;background:#1e3a5f;color:#93c5fd";
              addIrkBtn.textContent = "Add IRK";

              const irkInput = document.createElement("input");
              irkInput.type = "text";
              irkInput.placeholder = "Paste IRK (hex or base64)";
              irkInput.style.cssText = "font-size:10px;padding:2px 6px;background:#0f172a;color:#e2e8f0;border:1px solid #334155;border-radius:3px;width:220px;display:none;font-family:monospace";

              const irkSaveBtn = document.createElement("button");
              irkSaveBtn.style.cssText = "font-size:10px;padding:2px 8px;border-radius:3px;cursor:pointer;border:1px solid #16a34a;background:#052e16;color:#4ade80;display:none";
              irkSaveBtn.textContent = "Save";

              addIrkBtn.addEventListener("click", (e) => {
                e.stopPropagation();
                addIrkBtn.style.display = "none";
                irkInput.style.display = "inline";
                irkSaveBtn.style.display = "inline";
                irkInput.focus();
              });

              irkSaveBtn.addEventListener("click", async (e) => {
                e.stopPropagation();
                const irk = irkInput.value.trim();
                if (!irk) return;
                irkSaveBtn.textContent = "Saving...";
                irkSaveBtn.disabled = true;
                try {
                  await ctx.actions.wsCall("padspan_ha/irk_add", {
                    name: phone.device_name || "Phone",
                    irk_hex: irk,
                  });
                  irkRow.innerHTML = "";
                  const ok = document.createElement("span");
                  ok.style.cssText = "font-size:10px;color:#4ade80";
                  ok.textContent = "\u2713 IRK saved — tracking will activate within 60 seconds";
                  irkRow.appendChild(ok);
                } catch (err) {
                  irkSaveBtn.textContent = "Error";
                  irkSaveBtn.style.color = "#f87171";
                  irkSaveBtn.style.borderColor = "#dc2626";
                  const errMsg = (err && err.message) || String(err);
                  const errDiv = document.createElement("div");
                  errDiv.style.cssText = "font-size:10px;color:#f87171;width:100%;margin-top:2px";
                  errDiv.textContent = errMsg;
                  irkRow.appendChild(errDiv);
                  irkSaveBtn.disabled = false;
                  irkSaveBtn.textContent = "Retry";
                }
              });

              irkRow.appendChild(addIrkBtn);
              irkRow.appendChild(irkInput);
              irkRow.appendChild(irkSaveBtn);

              // Help text
              const helpText = document.createElement("div");
              helpText.style.cssText = "font-size:9px;color:#64748b;width:100%;margin-top:2px;display:none";
              helpText.textContent = "IRK is optional — your phone is already tracked via iBeacon. For IRK (enhanced tracking), see Settings \u2192 Phone Tracking for extraction methods.";
              irkRow.appendChild(helpText);
              addIrkBtn.addEventListener("click", () => { helpText.style.display = "block"; });

              info.appendChild(irkRow);
            }
            row.appendChild(info);

            // Action button
            const btn = document.createElement("button");
            btn.className = "btn tiny";
            btn.style.cssText = "white-space:nowrap;font-size:12px;padding:4px 14px";

            // Helper to wire button as Track or Unfollow (allows toggling)
            const _setTrack = () => {
              btn.textContent = "Track";
              btn.style.color = "#60a5fa";
              btn.style.borderColor = "#2563eb";
              btn.disabled = false;
              btn.onclick = async () => {
                btn.disabled = true;
                btn.textContent = "Setting up...";
                try {
                  const r = await ctx.actions.wsCall("padspan_ha/companion_follow", {
                    ibeacon_key: phone.ibeacon_key,
                    device_name: phone.device_name,
                    entity_id: phone.entity_id,
                  });
                  if (r.follow_key) {
                    ctx.state.followedAddrs.add(r.follow_key);
                    try { localStorage.setItem("padspan_followed", JSON.stringify([...ctx.state.followedAddrs])); } catch(e){}
                  }
                  if (r.verified_label && r.verified_followed) {
                    phone.is_followed = true;
                    meta.textContent = meta.textContent.replace("not tracked","tracked");
                    _setUnfollow();
                  } else {
                    btn.textContent = "Error — retry";
                    btn.style.color = "#f87171";
                    btn.disabled = false;
                  }
                } catch (e) {
                  btn.textContent = "Error — retry";
                  btn.style.color = "#f87171";
                  btn.disabled = false;
                }
              };
            };
            const _setUnfollow = () => {
              btn.textContent = "Unfollow";
              btn.style.color = "#f87171";
              btn.style.borderColor = "#7f1d1d";
              btn.disabled = false;
              btn.onclick = async () => {
                if (!confirm(`Stop tracking ${phone.device_name || "this phone"} and remove its label?`)) return;
                btn.disabled = true;
                btn.textContent = "Removing...";
                try {
                  await ctx.actions.wsCall("padspan_ha/companion_unfollow", {
                    ibeacon_key: phone.ibeacon_key,
                    device_name: phone.device_name,
                  });
                  ctx.state.followedAddrs.delete(phone.ibeacon_key);
                  ctx.state.followedAddrs.delete(phone.ibeacon_key.toUpperCase());
                  try { localStorage.setItem("padspan_followed", JSON.stringify([...ctx.state.followedAddrs])); } catch(e){}
                  phone.is_followed = false;
                  meta.textContent = meta.textContent.replace("tracked","not tracked");
                  _setTrack();
                } catch (e) {
                  btn.textContent = "Error";
                  btn.style.color = "#f87171";
                  btn.disabled = false;
                }
              };
            };

            if (phone.state === "sensor_not_registered") {
              // Phone is registered with HA but BLE Transmitter sensor isn't enabled
              meta.textContent = (phone.model ? phone.model + " · " : "") + "BLE Transmitter sensor not enabled";
              btn.textContent = "Setup";
              btn.style.color = "#f59e0b";
              btn.style.borderColor = "#92400e";
              btn.addEventListener("click", () => {
                alert(
                  "To enable phone tracking:\n\n" +
                  "1. Open the HA Companion App on your phone\n" +
                  "2. Go to Settings > Companion App > Manage Sensors\n" +
                  "3. Find 'BLE Transmitter' and enable it\n" +
                  "4. Turn on 'Transmit enabled'\n" +
                  "5. Restart Home Assistant\n\n" +
                  "The BLE Transmitter sensor must be registered with HA before PadSpan can track the phone."
                );
              });
            } else if (phone.is_disabled) {
              btn.textContent = "Enable & Track";
              btn.style.color = "#f59e0b";
              btn.style.borderColor = "#92400e";
              btn.addEventListener("click", async () => {
                btn.disabled = true;
                btn.textContent = "Enabling...";
                try {
                  await ctx.actions.wsCall("config/entity_registry/update", {
                    entity_id: phone.entity_id,
                    disabled_by: null,
                  });
                  // Also auto-follow so the notify command turns on BLE transmitter
                  if (phone.ibeacon_key) {
                    await ctx.actions.wsCall("padspan_ha/companion_follow", {
                      ibeacon_key: phone.ibeacon_key,
                      device_name: phone.device_name,
                      entity_id: phone.entity_id,
                    });
                  }
                  btn.textContent = "Enabled — restart HA";
                  btn.style.color = "#34d399"; btn.style.borderColor = "#065f46";
                  meta.textContent = "Entity enabled & BLE command sent. Restart HA to complete.";
                } catch (e) {
                  btn.textContent = "Enable manually in HA";
                  btn.style.color = "#f59e0b";
                  btn.disabled = false;
                }
              });
            } else if (phone.is_followed) {
              _setUnfollow();
            } else {
              _setTrack();
            }
            row.appendChild(btn);
            _phoneBody.appendChild(row);
          }
        } catch (e) { _bLoadMsg.textContent = "Phone discovery error: " + (e.message||e); _bLoadMsg.style.color = "#f87171"; }
      })();
    } else {
      basicCompanionCard.style.display = "none";
    }

    // Basic mode quiet toggle
    const bQuietToggle = el("input",{type:"checkbox",style:"width:14px;height:14px;accent-color:#52b788;cursor:pointer;margin:0"});
    bQuietToggle.checked = _quietMode;
    bQuietToggle.addEventListener("change", async()=>{
      try {
        await ctx.actions.settingsSet({ quiet_mode: bQuietToggle.checked });
        ctx.toast(bQuietToggle.checked ? "Quiet mode on" : "Quiet mode off");
        ctx.actions.renderRooms();
      } catch(e){ ctx.toast("Failed to save", true); }
    });
    const bQuietRow = el("div",{style:"display:flex;align-items:center;gap:5px;cursor:pointer;font-size:11px;color:" + (_quietMode ? "#52b788" : "#64748b")},[
      bQuietToggle,
      el("span",{style:"user-select:none"}, "Quiet"),
    ]);
    bQuietRow.addEventListener("click", (e)=>{ if(e.target !== bQuietToggle){ bQuietToggle.checked = !bQuietToggle.checked; bQuietToggle.dispatchEvent(new Event("change")); } });

    const section = el("section",{},[
      _buildSuspendBanner(),
      el("div",{style:"display:flex;align-items:center;justify-content:space-between;margin-bottom:10px"},[
        el("div",{class:"row",style:"align-items:center;gap:8px"},[
          el("h2",{style:"margin:0"}, "Overview"),
          helpBtn("overview_grid"),
        ]),
        bQuietRow,
      ]),
      summary,
      _buildDiagPanel(),
      basicCompanionCard,
      mapCard,
    ].filter(Boolean));
    return section;
  }

  // ---------- Advanced mode layout ----------
  const grid = el("div",{class:"grid"},[
    el("div",{class:"card"},[
      el("div",{class:"kpi"},[
        el("div",{class:"k"}, "Rooms"),
        el("div",{class:"v"}, liveLoading ? "--" : String(roomsCount)),
      ]),
      el("div",{class:"row"},[
        el("button",{class:"btn", onclick: openRoomsList}, "View rooms list"),
      ])
    ]),
    el("div",{class:"card"},[
      el("div",{class:"kpi"},[
        el("div",{class:"k"}, "Objects"),
        el("div",{class:"v"}, liveLoading ? "--" : String(objectsTotal)),
      ]),
      el("div",{class:"row"},[
        el("button",{class:"btn", onclick: ()=>openObjectsList("all")}, _quietMode ? "Tracked objects" : "All objects"),
        _quietMode ? null : el("button",{class:"btn", onclick: ()=>openObjectsList("unidentified")}, `Unidentified (${liveLoading ? "--" : unidentifiedCount})`),
      ].filter(Boolean)),
      unidentifiedCount > 0 ? el("div",{style:"margin-top:6px"},[
        el("button",{class:"btn inline",style:"font-size:11px;color:#f87171;border-color:#7f1d1d", onclick: async function(){
          if(!confirm("Clear all unidentified objects? Tagged and followed devices will be kept.")) return;
          this.disabled = true; this.textContent = "Clearing...";
          try {
            const r = await ctx.actions.wsCall("padspan_ha/objects_clear_history",{});
            ctx.toast(`Cleared ${r.removed} object${r.removed!==1?"s":""}, kept ${r.kept} tagged/followed`);
            await ctx.actions.refreshSnapshot();
          } catch(e){ ctx.toast("Failed: " + (e.message||e), true); }
          this.disabled = false; this.textContent = "Clear unidentified";
        }}, "Clear unidentified"),
      ]) : null,
    ]),
    el("div",{class:"card"},[
      el("div",{class:"kpi"},[
        el("div",{class:"k"}, "Bluetooth radios"),
        el("div",{class:"v"}, liveLoading ? "--" : String(radiosCount)),
      ]),
      el("div",{class:"row"},[
        el("button",{class:"btn", onclick: openRadiosList}, "View radios list"),
      ]),
      el("div",{style:"margin-top:8px;color:#94a3b8;font-size:12px"}, dataMode==="live" ? "Live snapshot" : "Sample data — switch to Live to see your real devices")
    ]),
    // Calibration status card
    (() => {
      const cs = liveSnap?.calibration_status;
      if (!cs) return null;
      const total = cs.total_points || 0;
      const empty = cs.empty_points || 0;
      const usable = total - empty;
      const ready = usable >= (cs.knn_min_required || 5);
      const storeOk = cs.store_initialized !== false;
      const knnPos = cs.knn_positioned_objects || 0;
      const color = !storeOk ? "#f87171" : !total ? "#f87171" : empty > 0 ? "#f59e0b" : ready ? "#52b788" : "#f59e0b";
      const algoLabel = cs.positioning_algorithm === "rf" ? "Random Forest" : "k-NN";
      const statusText = !storeOk ? "Store not loaded (restart HA)" :
        !total ? "No data" : !ready ? `Need ${(cs.knn_min_required||5) - usable} more` :
        knnPos > 0 ? `${algoLabel} — ${knnPos} objects positioned` : `${algoLabel} ready (no objects matched yet)`;
      const parts = [];
      if (cs.manual_points > 0) parts.push(`${cs.manual_points} manual`);
      if (cs.auto_points > 0) parts.push(`${cs.auto_points} auto`);
      if (empty > 0) parts.push(`${empty} empty (no RSSI)`);
      return el("div",{class:"card"},[
        el("div",{class:"kpi"},[
          el("div",{class:"k"}, "Calibration"),
          el("div",{class:"v",style:`color:${color}`}, `${usable} pts`),
        ]),
        el("div",{style:"font-size:11px;color:#94a3b8;margin-top:4px"},
          parts.join(" · ") + (cs.scanners ? ` · ${cs.scanners} scanners` : "") + (cs.maps ? ` · ${cs.maps} maps` : "")),
        el("div",{style:`font-size:11px;margin-top:4px;color:${color}`},
          `k-NN: ${statusText}`),
        !storeOk ? el("div",{style:"font-size:11px;margin-top:4px;color:#f87171;font-weight:600"},
          "CalibrationStore was not loaded at startup. Restart Home Assistant to activate k-NN positioning.") : null,
        empty > 0 ? el("div",{style:"font-size:11px;margin-top:4px;color:#f59e0b"},
          `${empty} point(s) have no RSSI data — re-calibrate to fix`) : null,
        // k-NN diagnostic: collapsible
        cs.source_overlap !== undefined ? (() => {
          const diagWrap = el("div",{style:"font-size:10px;margin-top:6px;padding:6px;background:#0f172a;border:1px solid #1e293b;border-radius:4px;color:#94a3b8"});
          const diagHdr = el("div",{style:"display:flex;align-items:center;gap:6px;cursor:pointer"});
          const diagArrow = el("span",{style:"font-size:9px;color:#60a5fa;transition:transform .2s"}, "\u25B6");
          diagHdr.appendChild(diagArrow);
          diagHdr.appendChild(el("span",{style:"font-weight:600;color:#e2e8f0"}, `${algoLabel} Diagnostic`));
          diagWrap.appendChild(diagHdr);
          const diagBody = el("div",{style:"display:none;margin-top:4px"});
          diagBody.appendChild(el("div",{}, `Cal sources: ${(cs.cal_sources||[]).length} · Live EMA sources: ${(cs.ema_sources||[]).length} · Overlap: ${cs.source_overlap}`));
          if (cs.source_overlap === 0) diagBody.appendChild(el("div",{style:"color:#f87171;font-weight:600;margin-top:3px"},
            "No scanner overlap between calibration data and live objects — cannot match!"));
          if (cs.source_overlap === 0 && (cs.cal_sources||[]).length > 0 && (cs.ema_sources||[]).length > 0)
            diagBody.appendChild(el("div",{style:"color:#f59e0b;margin-top:3px"},
              `Cal: ${(cs.cal_sources||[]).slice(0,3).join(", ")} · Live: ${(cs.ema_sources||[]).slice(0,3).join(", ")}`));
          (cs.knn_diag||[]).forEach(d => {
            diagBody.appendChild(el("div",{style:"margin-top:3px;border-top:1px solid #1e293b;padding-top:3px"}, [
              el("div",{}, `${d.key}: ${d.ema_scanners} EMA, ${d.shared_with_cal} overlap cal`),
              d.knn_result ? el("div",{style:"color:#52b788"},
                `→ conf=${(d.knn_result.confidence*100).toFixed(0)}% room=${d.knn_result.room} k=${d.knn_result.k_used} shared=${d.knn_result.shared_scanners||"?"}`) :
                el("div",{style:"color:#f87171"}, d.shared_with_cal > 0 ? "→ locate returned null" : "→ no shared scanners"),
            ]));
          });
          diagWrap.appendChild(diagBody);
          diagHdr.addEventListener("click", () => {
            const open = diagBody.style.display !== "none";
            diagBody.style.display = open ? "none" : "block";
            diagArrow.style.transform = open ? "" : "rotate(90deg)";
          });
          return diagWrap;
        })() : null,
      ].filter(Boolean));
    })(),
  ].filter(Boolean));

  // ---------- Companion App Phone Discovery ----------
  const companionCard = el("div",{class:"card",style:"border-color:#2563eb"});
  if (dataMode === "live") {
    // Collapsed header — click to expand
    const _aPhoneHdr = el("div",{style:"display:flex;align-items:center;gap:8px;cursor:pointer"});
    const _aPhoneArrow = el("span",{style:"font-size:11px;color:#60a5fa;transition:transform .2s"}, "\u25B6");
    _aPhoneHdr.appendChild(_aPhoneArrow);
    _aPhoneHdr.appendChild(el("span",{style:"font-weight:700;font-size:14px;color:#60a5fa"}, "Track Your Phone"));
    _aPhoneHdr.appendChild(el("span",{class:"muted",style:"font-size:11px;flex:1"}, "Tap to expand"));
    companionCard.appendChild(_aPhoneHdr);
    const _aPhoneBody = el("div",{style:"display:none;margin-top:8px"});
    companionCard.appendChild(_aPhoneBody);
    _aPhoneHdr.addEventListener("click", () => {
      const open = _aPhoneBody.style.display !== "none";
      _aPhoneBody.style.display = open ? "none" : "block";
      _aPhoneArrow.style.transform = open ? "" : "rotate(90deg)";
      _aPhoneHdr.querySelector(".muted").textContent = open ? "Tap to expand" : "";
    });
    const _aLoadMsg = el("div",{class:"muted",style:"font-size:12px;margin-bottom:10px"}, "Discovering phones...");
    _aPhoneBody.appendChild(_aLoadMsg);
    (async () => {
      try {
        const res = await ctx.actions.wsCall("padspan_ha/companion_discover", {});
        const phones = res.phones || [];
        if (!phones.length) {
          _aLoadMsg.textContent = "No phones detected. Enable the HA Companion App with BLE Transmitter.";
          _aLoadMsg.style.color = "#64748b";
          return;
        }

        _aLoadMsg.textContent = "Phones running the HA Companion App with BLE Transmitter. Click to track.";

        for (const phone of phones) {
          const row = document.createElement("div");
          row.style.cssText = "display:flex;align-items:center;gap:10px;padding:8px;border-radius:6px;background:#0f172a;margin-bottom:6px";

          // Phone icon + name
          const info = document.createElement("div");
          info.style.cssText = "flex:1;min-width:0";
          const nameEl = document.createElement("div");
          nameEl.style.cssText = "font-weight:600;font-size:14px;color:#e2e8f0";
          nameEl.textContent = phone.device_name || "Phone";
          info.appendChild(nameEl);

          const meta = document.createElement("div");
          meta.style.cssText = "font-size:11px;color:#64748b;margin-top:2px";
          const statusParts = [];
          if (phone.is_disabled) statusParts.push("Entity disabled in HA");
          else if (phone.is_transmitting) statusParts.push("BLE active");
          else statusParts.push("BLE off");
          if (!phone.is_disabled) {
            if (phone.is_visible) statusParts.push("visible to scanners");
            else statusParts.push("not seen yet");
          }
          if (phone.existing_label) statusParts.push(`labelled: ${phone.existing_label}`);
          statusParts.push(phone.has_irk ? "IRK \u2713" : "no IRK");
          meta.textContent = statusParts.join(" · ");
          info.appendChild(meta);

          // IRK add form for phones without IRK (advanced view)
          if (!phone.has_irk && !phone.is_disabled) {
            const irkRow = document.createElement("div");
            irkRow.style.cssText = "margin-top:4px;display:flex;align-items:center;gap:6px;flex-wrap:wrap";
            const irkHint = document.createElement("span");
            irkHint.style.cssText = "font-size:10px;color:#f59e0b";
            irkHint.textContent = "No IRK \u2014 ";
            irkRow.appendChild(irkHint);
            const addIrkBtn = document.createElement("button");
            addIrkBtn.style.cssText = "font-size:10px;padding:2px 8px;border-radius:3px;cursor:pointer;border:1px solid #2563eb;background:#1e3a5f;color:#93c5fd";
            addIrkBtn.textContent = "Add IRK";
            const irkInput = document.createElement("input");
            irkInput.type = "text";
            irkInput.placeholder = "Paste IRK (hex or base64)";
            irkInput.style.cssText = "font-size:10px;padding:2px 6px;background:#0f172a;color:#e2e8f0;border:1px solid #334155;border-radius:3px;width:220px;display:none;font-family:monospace";
            const irkSaveBtn = document.createElement("button");
            irkSaveBtn.style.cssText = "font-size:10px;padding:2px 8px;border-radius:3px;cursor:pointer;border:1px solid #16a34a;background:#052e16;color:#4ade80;display:none";
            irkSaveBtn.textContent = "Save";
            addIrkBtn.addEventListener("click", (e) => {
              e.stopPropagation();
              addIrkBtn.style.display = "none";
              irkInput.style.display = "inline";
              irkSaveBtn.style.display = "inline";
              irkHelp.style.display = "block";
              irkInput.focus();
            });
            irkSaveBtn.addEventListener("click", async (e) => {
              e.stopPropagation();
              const irk = irkInput.value.trim();
              if (!irk) return;
              irkSaveBtn.textContent = "Saving...";
              irkSaveBtn.disabled = true;
              try {
                await ctx.actions.wsCall("padspan_ha/irk_add", {
                  name: phone.device_name || "Phone",
                  irk_hex: irk,
                });
                irkRow.innerHTML = "";
                const ok = document.createElement("span");
                ok.style.cssText = "font-size:10px;color:#4ade80";
                ok.textContent = "\u2713 IRK saved — tracking will activate within 60 seconds";
                irkRow.appendChild(ok);
              } catch (err) {
                irkSaveBtn.textContent = "Error";
                irkSaveBtn.style.color = "#f87171";
                irkSaveBtn.style.borderColor = "#dc2626";
                const errDiv = document.createElement("div");
                errDiv.style.cssText = "font-size:10px;color:#f87171;width:100%;margin-top:2px";
                errDiv.textContent = (err && err.message) || String(err);
                irkRow.appendChild(errDiv);
                irkSaveBtn.disabled = false;
                irkSaveBtn.textContent = "Retry";
              }
            });
            irkRow.appendChild(addIrkBtn);
            irkRow.appendChild(irkInput);
            irkRow.appendChild(irkSaveBtn);
            const irkHelp = document.createElement("div");
            irkHelp.style.cssText = "font-size:9px;color:#64748b;width:100%;margin-top:2px;display:none";
            irkHelp.textContent = "IRK is optional — your phone is already tracked via iBeacon. For IRK (enhanced tracking), see Settings \u2192 Phone Tracking for extraction methods.";
            irkRow.appendChild(irkHelp);
            info.appendChild(irkRow);
          }
          row.appendChild(info);

          // Phone registered but BLE sensor not enabled (common on Android)
          if (phone.state === "sensor_not_registered") {
            meta.textContent = (phone.model ? phone.model + " · " : "") + "BLE Transmitter sensor not enabled in Companion App";
            const setupBtn = document.createElement("button");
            setupBtn.className = "btn inline";
            setupBtn.style.cssText = "font-size:12px;padding:4px 14px;color:#f59e0b;border-color:#92400e;font-weight:600;white-space:nowrap";
            setupBtn.textContent = "Setup";
            setupBtn.addEventListener("click", () => {
              alert(
                "To enable phone tracking:\n\n" +
                "1. Open the HA Companion App on your phone\n" +
                "2. Go to Settings > Companion App > Manage Sensors\n" +
                "3. Find 'BLE Transmitter' and enable it\n" +
                "4. Turn on 'Transmit enabled'\n" +
                "5. Restart Home Assistant\n\n" +
                "The BLE Transmitter sensor must be registered with HA before PadSpan can track the phone."
              );
            });
            row.appendChild(setupBtn);
            _aPhoneBody.appendChild(row);
            continue;
          }

          // Disabled entity — enable + auto-follow
          if (phone.is_disabled) {
            const enableBtn = document.createElement("button");
            enableBtn.className = "btn inline";
            enableBtn.style.cssText = "font-size:12px;padding:4px 14px;color:#f59e0b;border-color:#92400e;font-weight:600;white-space:nowrap";
            enableBtn.textContent = "Enable & Track";
            enableBtn.addEventListener("click", async () => {
              enableBtn.disabled = true;
              enableBtn.textContent = "Enabling...";
              try {
                // Enable the entity via HA entity registry
                await ctx.actions.wsCall("config/entity_registry/update", {
                  entity_id: phone.entity_id,
                  disabled_by: null,
                });
                // Also auto-follow so the notify command turns on BLE transmitter
                if (phone.ibeacon_key) {
                  await ctx.actions.wsCall("padspan_ha/companion_follow", {
                    ibeacon_key: phone.ibeacon_key,
                    device_name: phone.device_name,
                    entity_id: phone.entity_id,
                  });
                }
                enableBtn.textContent = "Enabled — restart HA";
                enableBtn.style.color = "#34d399";
                enableBtn.style.borderColor = "#065f46";
                meta.textContent = "Entity enabled & BLE command sent. Restart Home Assistant to complete setup.";
              } catch (e) {
                enableBtn.textContent = "Enable manually";
                enableBtn.disabled = false;
                meta.textContent = `Go to HA → Settings → Devices → ${phone.device_name} → Entities → BLE Transmitter → Enable`;
              }
            });
            row.appendChild(enableBtn);
            _aPhoneBody.appendChild(row);
            continue;
          }

          // Status badge + untrack
          if (phone.is_followed) {
            const btnWrap = document.createElement("div");
            btnWrap.style.cssText = "display:flex;align-items:center;gap:6px;flex-wrap:wrap";
            const badge = document.createElement("span");
            if (phone.is_visible) {
              badge.style.cssText = "font-size:11px;color:#34d399;font-weight:600;padding:3px 8px;border:1px solid #065f46;border-radius:4px";
              badge.textContent = "Tracked";
            } else if (phone.is_transmitting) {
              badge.style.cssText = "font-size:11px;color:#fbbf24;font-weight:600;padding:3px 8px;border:1px solid #92400e;border-radius:4px";
              badge.textContent = "Waiting for signal";
            } else {
              badge.style.cssText = "font-size:11px;color:#f87171;font-weight:600;padding:3px 8px;border:1px solid #7f1d1d;border-radius:4px";
              badge.textContent = "BLE off";
            }
            btnWrap.appendChild(badge);
            const unBtn = document.createElement("button");
            unBtn.className = "btn inline";
            unBtn.style.cssText = "font-size:11px;padding:3px 10px;color:#f87171;border-color:#7f1d1d";
            unBtn.textContent = "Untrack";
            unBtn.addEventListener("click", async () => {
              if (!confirm(`Stop tracking ${phone.device_name || "this phone"} and remove its label?`)) return;
              unBtn.disabled = true;
              unBtn.textContent = "Removing...";
              try {
                await ctx.actions.wsCall("padspan_ha/companion_unfollow", {
                  ibeacon_key: phone.ibeacon_key,
                });
                // Sync local state
                const fk = phone.ibeacon_key.toUpperCase();
                ctx.state.followedAddrs.delete(fk);
                try { localStorage.setItem("padspan_followed", JSON.stringify([...ctx.state.followedAddrs])); } catch(e){}
                badge.textContent = "Removed";
                badge.style.color = "#64748b";
                badge.style.borderColor = "#334155";
                unBtn.style.display = "none";
                setTimeout(() => ctx.actions.renderRooms(), 1500);
              } catch (e) {
                unBtn.textContent = "Error";
                unBtn.disabled = false;
              }
            });
            btnWrap.appendChild(unBtn);
            row.appendChild(btnWrap);
          } else {
            // Follow button
            const btn = document.createElement("button");
            btn.className = "btn inline";
            btn.style.cssText = "font-size:12px;padding:4px 14px;color:#60a5fa;border-color:#2563eb;font-weight:600";
            btn.textContent = "Track this phone";
            btn.addEventListener("click", async () => {
              btn.disabled = true;
              btn.textContent = "Setting up...";
              try {
                const r = await ctx.actions.wsCall("padspan_ha/companion_follow", {
                  ibeacon_key: phone.ibeacon_key,
                  device_name: phone.device_name,
                  entity_id: phone.entity_id,
                });
                // Sync local followed set so Follow view + overview see it immediately
                if (r.follow_key) {
                  ctx.state.followedAddrs.add(r.follow_key);
                  try { localStorage.setItem("padspan_followed", JSON.stringify([...ctx.state.followedAddrs])); } catch(e){}
                }
                // Show status based on actual phone state
                if (r.verified_label && r.verified_followed) {
                  if (phone.is_visible) {
                    btn.textContent = "Tracked!";
                    btn.style.cssText = "font-size:12px;padding:4px 14px;color:#34d399;border-color:#065f46;font-weight:600";
                    meta.textContent = `Tagged as "${r.verified_label}" · visible to scanners`;
                  } else if (phone.is_transmitting || r.transmitter_enabled) {
                    btn.textContent = "Registered — waiting for signal";
                    btn.style.cssText = "font-size:12px;padding:4px 14px;color:#fbbf24;border-color:#92400e;font-weight:600";
                    meta.textContent = `Tagged as "${r.verified_label}" · BLE active but not yet seen by scanners. Walk near a scanner.`;
                  } else {
                    btn.textContent = "Registered — enable BLE";
                    btn.style.cssText = "font-size:12px;padding:4px 14px;color:#f59e0b;border-color:#92400e;font-weight:600";
                    meta.textContent = `Tagged as "${r.verified_label}" · BLE transmitter is OFF. Enable it in Companion App → Settings → Manage Sensors → BLE Transmitter.`;
                  }
                } else {
                  btn.textContent = "Error saving — retry";
                  btn.style.cssText = "font-size:12px;padding:4px 14px;color:#f87171;border-color:#7f1d1d;font-weight:600";
                  btn.disabled = false;
                }
                // Refresh to update map + follow view
                setTimeout(() => ctx.actions.renderRooms(), 1500);
              } catch (e) {
                btn.textContent = "Error — try again";
                btn.style.color = "#f87171";
                btn.disabled = false;
              }
            });
            row.appendChild(btn);
          }

          _aPhoneBody.appendChild(row);
        }

        // Help note
        const helpNote = el("div",{style:"font-size:11px;color:#475569;margin-top:8px"},
          "Not seeing your phone? Open Companion App \u2192 Settings \u2192 Companion App \u2192 Manage Sensors \u2192 BLE Transmitter \u2192 Enable. The phone will appear here once the transmitter is active.");
        _aPhoneBody.appendChild(helpNote);
      } catch (e) {
        _aLoadMsg.textContent = "Phone discovery error: " + (e.message||e);
        _aLoadMsg.style.color = "#f87171";
      }
    })();
  } else {
    companionCard.style.display = "none";
  }

  // Quiet Mode toggle for top-right
  const quietToggle = el("input",{type:"checkbox",style:"width:14px;height:14px;accent-color:#52b788;cursor:pointer;margin:0"});
  quietToggle.checked = _quietMode;
  quietToggle.addEventListener("change", async()=>{
    try {
      await ctx.actions.settingsSet({ quiet_mode: quietToggle.checked });
      ctx.toast(quietToggle.checked ? "Quiet mode on" : "Quiet mode off");
      ctx.actions.renderRooms();
    } catch(e){ ctx.toast("Failed to save", true); }
  });
  const quietRow = el("div",{style:"display:flex;align-items:center;gap:5px;cursor:pointer;font-size:11px;color:" + (_quietMode ? "#52b788" : "#64748b")},[
    quietToggle,
    el("span",{style:"user-select:none"}, "Quiet"),
  ]);
  quietRow.addEventListener("click", (e)=>{ if(e.target !== quietToggle){ quietToggle.checked = !quietToggle.checked; quietToggle.dispatchEvent(new Event("change")); } });

  const section = el("section",{},[
    _buildSuspendBanner(),
    el("div",{style:"display:flex;align-items:center;justify-content:space-between"},[
      el("h2",{style:"margin:0"}, "Overview"),
      quietRow,
    ]),
    el("div",{style:"color:#94a3b8;margin-top:2px;margin-bottom:10px"}, `Mode: ${dataMode.toUpperCase()} · ${ctx.state.versionInfo?.version || ""} (${ctx.state.versionInfo?.build_id || ""})`),
    _buildDiagPanel(),
  ].filter(Boolean));
  // Migration banner — show on overview if fabric is empty but maps have data
  {
    const _maps2 = ctx.state.maps?.list || [];
    const _hasMaps = _maps2.some(m => (m.receivers||[]).length > 0 || (m.has_room_bounds === true));
    const _hasFabric = Object.keys(ctx.state.model?.scanner_positions_m || {}).length > 0 || Object.keys(ctx.state.model?.room_geometry_m || {}).length > 0;
    if (_hasMaps && !_hasFabric) {
      section.appendChild(el("div",{style:"padding:10px 14px;border:2px solid #f59e0b;background:rgba(245,158,11,.08);border-radius:8px;margin-bottom:10px"},[
        el("div",{style:"font-weight:700;color:#fbbf24;font-size:13px"},"\u26a0 Fabric migration needed"),
        el("div",{style:"font-size:11px;color:#e2e8f0;margin-top:4px"},"Go to Health tab \u2192 Positioning Fabric \u2192 Migrate to Fabric to enable real-world positioning."),
      ]));
    }
  }
  // ── Occupancy Estimator card (clickable, compact) ──────────────────────
  let occCard;
  {
    occCard = el("div",{class:"card",style:"cursor:pointer;border-color:#5eead433;transition:border-color 0.2s;padding:8px 12px"});
    occCard.addEventListener("mouseenter",()=>{occCard.style.borderColor="#5eead4";});
    occCard.addEventListener("mouseleave",()=>{occCard.style.borderColor="#5eead433";});
    const occContent = el("div",{style:"display:flex;align-items:center;gap:8px"});
    const occNum = el("span",{style:"font-weight:800;font-size:18px;color:#5eead4;min-width:32px"},"\u2026");
    const occText = el("span",{style:"font-size:11px;color:#94a3b8;flex:1"}, "Loading\u2026");
    const occBadge = el("span",{style:"font-size:10px;padding:1px 6px;border-radius:10px;background:#0a2a2a;border:1px solid #5eead433;color:#5eead4;white-space:nowrap"});
    occContent.appendChild(occNum);
    occContent.appendChild(occText);
    occContent.appendChild(occBadge);
    occCard.appendChild(occContent);
    section.appendChild(occCard);

    // Async load occupancy data
    (async () => {
      try {
        const res = await ctx.actions.callWS({type:"padspan_ha/occupancy_estimate"});
        const confColor = res.confidence === "high" ? "#52b788" : res.confidence === "medium" ? "#f59e0b" : "#f87171";
        occNum.textContent = `~${res.total_estimate}`;
        occNum.style.color = confColor;
        // Build source summary
        const hy = res.hybrid || {};
        const parts = [];
        if (res.identified > 0) parts.push(`${res.identified} identified`);
        if (res.clusters != null && res.clusters > 0) parts.push(`${res.clusters} BLE clusters`);
        if (hy.persons_home > 0) parts.push(`${hy.persons_home} person${hy.persons_home > 1 ? "s" : ""} home`);
        if (hy.presence_sensors_active > 0) parts.push(`${hy.presence_sensors_active} occupancy sensor${hy.presence_sensors_active > 1 ? "s" : ""}`);
        if (hy.motion_sensors_active > 0) parts.push(`${hy.motion_sensors_active} motion`);
        if (hy.wifi_clients > 0) parts.push(`${hy.wifi_clients} WiFi`);
        const bleOnly = res.ble_estimate != null && res.ble_estimate !== res.total_estimate;
        occText.textContent = parts.join(" \u00b7 ") + (bleOnly ? ` (BLE alone: ${res.ble_estimate})` : "");
        occBadge.textContent = `${res.total_low}\u2013${res.total_high}`;
        occBadge.style.borderColor = confColor + "44";
        occBadge.style.color = confColor;
      } catch(e) {
        occText.textContent = "Unavailable";
      }
    })();

    // Click → detail modal
    occCard.addEventListener("click", async () => {
      try {
        const res = await ctx.actions.callWS({type:"padspan_ha/occupancy_estimate"});
        const confColor = res.confidence === "high" ? "#52b788" : res.confidence === "medium" ? "#f59e0b" : "#f87171";
        const body = el("div",{style:"max-width:500px"});

        // Summary
        body.appendChild(el("div",{style:"display:flex;align-items:center;gap:10px;margin-bottom:12px"},[
          el("div",{style:"font-size:32px"},"\ud83c\udfe0"),
          el("div",{},[
            el("div",{style:`font-weight:800;font-size:20px;color:${confColor}`},
              `~${res.total_estimate} people`),
            el("div",{style:"font-size:12px;color:#94a3b8"},
              `Range: ${res.total_low}\u2013${res.total_high} \u00b7 Confidence: ${res.confidence}`),
          ]),
        ]));

        // Stats
        body.appendChild(el("div",{style:"display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-bottom:12px"},[
          el("div",{class:"card",style:"text-align:center;padding:8px"},[
            el("div",{style:"font-size:18px;font-weight:700;color:#52b788"},String(res.identified)),
            el("div",{style:"font-size:10px;color:#94a3b8"},"Identified"),
          ]),
          el("div",{class:"card",style:"text-align:center;padding:8px"},[
            el("div",{style:"font-size:18px;font-weight:700;color:#f59e0b"},String(res.unidentified)),
            el("div",{style:"font-size:10px;color:#94a3b8"},"Unidentified"),
          ]),
          el("div",{class:"card",style:"text-align:center;padding:8px"},[
            el("div",{style:"font-size:18px;font-weight:700;color:#64748b"},String(res.excluded)),
            el("div",{style:"font-size:10px;color:#94a3b8"},"Excluded"),
          ]),
        ]));

        // Per-room table
        if (res.rooms.length) {
          body.appendChild(el("div",{style:"font-weight:700;font-size:12px;color:#94a3b8;margin-bottom:6px;text-transform:uppercase"},"Per-Room Breakdown"));
          const tbl = el("div",{style:"display:grid;grid-template-columns:1fr auto auto auto;gap:3px 10px;font-size:11px;align-items:center"});
          for (const h of ["Room","Identified","Unidentified","Estimate"]) {
            tbl.appendChild(el("div",{style:"font-weight:600;color:#64748b;font-size:10px;text-transform:uppercase"},h));
          }
          for (const r of res.rooms) {
            const rc = ctx.helpers.roomColor ? ctx.helpers.roomColor(r.room) : "#5eead4";
            tbl.appendChild(el("div",{style:`color:${rc};font-weight:600`},r.room));
            tbl.appendChild(el("div",{style:"text-align:right;color:#52b788"},String(r.identified)));
            tbl.appendChild(el("div",{style:"text-align:right;color:#f59e0b"},String(r.unidentified)));
            tbl.appendChild(el("div",{style:"text-align:right;font-weight:700;color:#e2e8f0"},
              `~${r.estimate} (${r.estimate_low}\u2013${r.estimate_high})`));
          }
          body.appendChild(tbl);
        }

        // Hybrid signals
        const hy = res.hybrid || {};
        const hybridOn = res.hybrid_enabled !== false;
        if (hybridOn) {
          body.appendChild(el("div",{style:"margin-top:12px;padding:8px 10px;background:rgba(94,234,212,.04);border:1px solid rgba(94,234,212,.12);border-radius:6px"},[
            el("div",{style:"font-weight:700;font-size:11px;color:#5eead4;margin-bottom:4px"},
              res.ble_estimate != null && res.ble_estimate !== res.total_estimate
                ? `Hybrid: raised from BLE ${res.ble_estimate} \u2192 ${res.total_estimate}`
                : "Hybrid signals"),
            el("div",{style:"display:grid;grid-template-columns:1fr 1fr;gap:2px 12px;font-size:10px"},[
              el("div",{style:`color:${hy.persons_home>0?"#52b788":"#475569"}`},`Persons home: ${hy.persons_home||0}`),
              el("div",{style:"color:#94a3b8"},(hy.person_names||[]).join(", ")||"\u2014"),
              el("div",{style:`color:${hy.presence_sensors_active>0?"#60a5fa":"#475569"}`},`Occupancy sensors: ${hy.presence_sensors_active||0}`),
              el("div",{style:"color:#94a3b8"},(hy.presence_rooms||[]).join(", ")||"\u2014"),
              el("div",{style:`color:${hy.motion_sensors_active>0?"#fbbf24":"#475569"}`},`Motion: ${hy.motion_sensors_active||0}`),
              el("div",{style:"color:#94a3b8"},(hy.motion_rooms||[]).join(", ")||"\u2014"),
              el("div",{style:`color:${hy.wifi_clients>0?"#a78bfa":"#475569"}`},`WiFi clients: ${hy.wifi_clients||0}`),
              el("div",{style:"color:#94a3b8"},hy.wifi_source?hy.wifi_source.replace("sensor.",""):"\u2014"),
            ]),
          ]));
        }

        // Settings info
        body.appendChild(el("div",{style:"margin-top:12px;font-size:10px;color:#64748b"},
          `Multiplier: ${res.multiplier}x \u00b7 Dwell: ${res.dwell_min}m \u00b7 Training: ${res.training_count} obs \u00b7 Hybrid: ${hybridOn?"on":"off"}`));

        // Training input
        body.appendChild(el("div",{style:"margin-top:12px;padding-top:12px;border-top:1px solid #1b3526"}));
        body.appendChild(el("div",{style:"font-weight:700;font-size:12px;color:#5eead4;margin-bottom:6px"},"\ud83c\udfaf Train the Estimator"));
        body.appendChild(el("div",{style:"font-size:11px;color:#94a3b8;margin-bottom:8px"},
          "Enter how many people are actually in the building right now. This helps the system learn the correct device-to-person ratio."));
        const trainRow = el("div",{style:"display:flex;align-items:center;gap:8px"});
        const trainInput = document.createElement("input");
        trainInput.type="number";trainInput.min="0";trainInput.max="500";trainInput.step="1";
        trainInput.placeholder="people";
        trainInput.style.cssText="width:80px;padding:4px 8px;border:1px solid #334155;border-radius:4px;background:#1e293b;color:#e2e8f0;font-size:12px";
        trainRow.appendChild(el("span",{style:"font-size:11px;color:#94a3b8"},"Actual count:"));
        trainRow.appendChild(trainInput);
        const trainBtn = el("button",{class:"btn save-pulse",style:"width:auto;padding:4px 14px;font-size:11px"});
        trainBtn.textContent = "\ud83d\udcbe Train";
        trainBtn.addEventListener("click", async () => {
          const v = parseInt(trainInput.value);
          if (v == null || v < 0) { ctx.toast("Enter a valid count"); return; }
          trainBtn.disabled = true; trainBtn.textContent = "Saving\u2026"; trainBtn.classList.remove("save-pulse");
          try {
            const tr = await ctx.actions.callWS({type:"padspan_ha/occupancy_train",actual_count:v});
            ctx.toast(`Trained: actual=${v}, computed multiplier=${tr.observation.computed_multiplier}x (${tr.total_observations} total observations)`);
            trainBtn.textContent = "\u2714 Saved";
          } catch(e) {
            ctx.toast("Train failed: "+(e.message||e));
            trainBtn.disabled=false; trainBtn.textContent="Train"; trainBtn.classList.add("save-pulse");
          }
        });
        trainRow.appendChild(trainBtn);
        body.appendChild(trainRow);

        ctx.actions.openModal("Occupancy Estimate", body, "Experimental");
      } catch(e) {
        ctx.toast("Failed to load occupancy: "+(e.message||e));
      }
    });
  }

  // Put occupancy + companion on the same row to save vertical space
  const _topRow = el("div",{style:"display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px"});
  // occCard was already appended to section — remove and re-add to row
  if (occCard.parentNode) occCard.parentNode.removeChild(occCard);
  _topRow.appendChild(occCard);
  companionCard.style.marginBottom = "0";
  _topRow.appendChild(companionCard);
  section.appendChild(_topRow);
  if(mapEl) section.appendChild(mapEl);
  section.appendChild(grid);
  return section;
}
