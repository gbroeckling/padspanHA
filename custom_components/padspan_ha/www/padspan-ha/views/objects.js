// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
// See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
/**
 * Objects view — lists all tracked BLE objects/tags.
 * Basic mode: card-based layout grouped by room.
 * Advanced mode: searchable/filterable table with sort, inline tagging, and detail expand.
 * Data source: snapshot tags + roomTagMap; live index built per-render for friendly names.
 */

export function renderTags(ctx, tagsList) {
  const { el } = ctx.helpers;
  const { mode, tagFilter } = ctx.state;

  const isLive = ctx.state.dataMode === "live";
  const roomTagMap = ctx.state.roomTagMap || {};
  const snap = (ctx.state.live && ctx.state.live.snapshot) || null;
  const missingByRoom =
    ctx.state.missingRoomTagMap ||
    (snap && snap.room_tag_map_missing) ||
    {};

  // Index live snapshot tags so we can show friendly names + state (not just entity_id).
  const liveTags = ((snap && snap.tags) || []);
  const liveIndex = {};
  const liveMissingIndex = {};
  for (const t of liveTags) {
    if (!t || !t.entity_id) continue;
    const eid = String(t.entity_id);
    if (t.missing) liveMissingIndex[eid] = t;
    else liveIndex[eid] = t;
  }

  const rooms = Object.keys(roomTagMap);

  // Ensure selectedRooms is always valid.
  if (!ctx.state.selectedRooms || !Array.isArray(ctx.state.selectedRooms)) ctx.state.selectedRooms = rooms.slice(0, 1);
  if (ctx.state.selectedRooms.length === 0 && rooms.length) ctx.state.selectedRooms = [rooms[0]];

  tagsList.innerHTML = "";

  // Selected tags
  const selectedRooms = (ctx.state.selectedRooms || []).filter(r => rooms.includes(r));
  const sets = selectedRooms.map(r => new Set(roomTagMap[r] || []));

  const union = new Set();
  for (const s of sets) for (const v of s) union.add(v);

  const intersect = new Set(union);
  for (const s of sets) for (const v of Array.from(intersect)) if (!s.has(v)) intersect.delete(v);

  let items = [];
  if (mode === "union") items = Array.from(union);
  else if (mode === "intersect") items = Array.from(intersect);
  else items = Array.from(union);

  // Optional filter
  if (tagFilter && tagFilter.trim()) {
    const q = tagFilter.trim().toLowerCase();
    items = items.filter(eid => {
      const meta = liveIndex[eid];
      return eid.toLowerCase().includes(q) || (meta && String(meta.name || "").toLowerCase().includes(q));
    });
  }

  const list = el("div", { class: "list" });

  // Empty state guidance (common when only placeholders exist).
  if (items.length === 0) {
    const missingTotal = Object.values(missingByRoom).reduce((a, v) => a + (Array.isArray(v) ? v.length : 0), 0);
    list.appendChild(
      el("div", { class: "muted", style: "padding:8px 4px" },
        missingTotal
          ? `No tags found. (${missingTotal} configured tags are missing in Home Assistant.)`
          : isLive
            ? "No tags found. Confirm your BLE integration creates entities whose state equals a room/area (e.g., *area_last_seen)."
            : "No tags mapped for the selected room(s)."
      )
    );
  }

  // Render each tag
  for (const eid of items) {
    const meta = liveIndex[eid] || null;
    const item = el("div", { class: "item" });

    const textWrap = el("div", { style: "display:flex;flex-direction:column;gap:2px;flex:1" });
    textWrap.appendChild(el("span", {}, meta ? String(meta.name || eid) : eid));

    if (meta) {
      const details = [];
      details.push(eid);
      if (meta.state !== undefined) details.push(String(meta.state));
      if (meta.nearest_receiver) details.push(`rx:${meta.nearest_receiver}`);
      textWrap.appendChild(el("span", { class: "muted" }, details.join(" • ")));
    } else {
      textWrap.appendChild(el("span", { class: "muted" }, eid));
    }

    item.appendChild(textWrap);

    // "open in HA" button
    const openBtn = el("button", { class: "btn tiny" }, "Open");
    openBtn.addEventListener("click", () => {
      const url = `/developer-tools/state?entity_id=${encodeURIComponent(eid)}`;
      window.open(url, "_blank");
    });
    item.appendChild(openBtn);

    list.appendChild(item);
  }

  // If there are missing configured tags for selected rooms, show them underneath (collapsed-ish).
  const missingForSelected = [];
  for (const r of selectedRooms) for (const eid of (missingByRoom[r] || [])) missingForSelected.push({ room: r, eid });
  if (isLive && missingForSelected.length) {
    list.appendChild(el("div", { class: "muted", style: "padding:10px 4px 4px" }, "Configured (missing in Home Assistant):"));
    for (const x of missingForSelected.slice(0, 200)) {
      const item = el("div", { class: "item" });
      const tw = el("div", { style: "display:flex;flex-direction:column;gap:2px;flex:1" });
      tw.appendChild(el("span", {}, x.eid));
      tw.appendChild(el("span", { class: "muted" }, `room: ${x.room}`));
      item.appendChild(tw);
      list.appendChild(item);
    }
  }

  tagsList.appendChild(list);
}

export function render(ctx){
  const { el, esc, roomColor, helpBtn } = ctx.helpers;
  const { roomTagMap, mode, tagFilter } = ctx.state;
  const selectedRooms = new Set(Array.isArray(ctx.state.selectedRooms) ? ctx.state.selectedRooms : []);
  const isBasic = ctx.state.complexity === "basic";

  const root = el("section",{id:"objects"});
  root.className = ctx.state.view==="objects" ? "" : "hidden";

  // ----------------------------
  // Inventory: unified Objects model (BLE advertisements + mapped entities)
  // ----------------------------
  const isLive = ctx.state.dataMode === "live";
  const liveSnap = (ctx.state.live && ctx.state.live.snapshot) || null;
  const objModel = liveSnap && liveSnap.objects ? liveSnap.objects : null;

  const fmtAgo = (age_s)=>{
    const s = Number(age_s);
    if(!isFinite(s)) return "—";
    if(s < 1) return "<1s";
    if(s < 60) return `${Math.round(s)}s`;
    const m = Math.floor(s/60);
    const rs = Math.round(s - m*60);
    if(m < 60) return `${m}m ${rs}s`;
    const h = Math.floor(m/60);
    const rm = m - h*60;
    if(h < 24) return `${h}h ${rm}m`;
    const d = Math.floor(h/24);
    const rh = h - d*24;
    return `${d}d ${rh}h`;
  };
  const fmtNum = (n)=>{
    const v = Number(n);
    if(!isFinite(v)) return "0";
    return v.toLocaleString();
  };

  // --- Inline objects list (BLE scanner detections + entities) ---
  const _quietMode = !!(ctx.state.settings && ctx.state.settings.quiet_mode);
  const _followedAddrs = ctx.state.followedAddrs || new Set();
  const _isScanner = ctx.helpers.isScanner;
  const _rawObjects = (objModel && Array.isArray(objModel.list) ? objModel.list : [])
    .filter(o => !_isScanner(o));  // Never show scanners as tracked objects
  // Quiet mode: only show identified or followed objects
  const allObjects = _quietMode
    ? _rawObjects.filter(o => {
        if (o.identified || o.user_label) return true;
        // Check if followed
        const fk = (o.kind === "ibeacon" ? (o.key || "") : (o.address || o.entity_id || "")).toUpperCase();
        if (fk && _followedAddrs.has(fk)) return true;
        return false;
      })
    : _rawObjects;
  const summary = objModel && objModel.summary ? objModel.summary : null;

  // Dedup: suppress entity rows whose physical device already has a BLE/iBeacon/private_ble row.
  // This prevents e.g. "Dog Tracker" entity appearing alongside its BLE advertisement row.
  const _bleAddrSet = new Set();
  for (const o of allObjects) {
    if (o.kind !== "ble" && o.kind !== "private_ble" && o.kind !== "ibeacon") continue;
    if (o.address) _bleAddrSet.add(o.address);
    // Include all rotating MACs from iBeacon/private_ble groups
    if (Array.isArray(o.all_addresses)) {
      for (const a of o.all_addresses) _bleAddrSet.add(String(a).toUpperCase());
    }
  }
  const _linkedEntitySet = new Set(
    allObjects.flatMap(o => Array.isArray(o.linked_entities) ? o.linked_entities : [])
  );
  const _isDuplicateEntity = (o) =>
    o.kind === "entity" && (
      (o.address && _bleAddrSet.has(String(o.address).toUpperCase())) ||
      (o.entity_id && _linkedEntitySet.has(o.entity_id))
    );

  // Away detection — the shared rule (panel.js / presence_rules.py)
  const awayTimeoutS = ctx.helpers.awayTimeoutS(ctx.state.settings);
  const _isAway = (o) => ctx.helpers.isAway(o, awayTimeoutS);

  if (!ctx.state.objSearch) ctx.state.objSearch = "";
  if (!ctx.state.objKind)   ctx.state.objKind   = "all";
  if (!ctx.state.objStatus) ctx.state.objStatus  = "all";
  if (ctx.state.objAgeMax == null) ctx.state.objAgeMax = 14400; // default: 4 hours

  // Time range slider: controls how far back to show objects
  const _ageSteps = [60, 300, 900, 3600, 14400, 43200, 86400, 259200, 604800];
  const _ageLabels = ["1 min", "5 min", "15 min", "1 hour", "4 hours", "12 hours", "1 day", "3 days", "1 week"];
  const _ageIdx = _ageSteps.indexOf(ctx.state.objAgeMax);
  const _curIdx = _ageIdx >= 0 ? _ageIdx : _ageSteps.length - 1;

  const objSearchInput = el("input",{type:"text", placeholder:"Search address, name, label…", value: ctx.state.objSearch});
  const objKindSel = el("select",{class:"btn"});
  [{v:"all",t:"All"},{v:"ble",t:"BLE (all)"},{v:"ble_only",t:"BLE only"},{v:"ibeacon",t:"iBeacon"},{v:"private_ble",t:"Private BLE"},{v:"entity",t:"HA entities"}]
    .forEach(o=>objKindSel.appendChild(el("option",{value:o.v},o.t)));
  objKindSel.value = ctx.state.objKind;

  const objStatusSel = el("select",{class:"btn"});
  [{v:"all",t:"All statuses"},{v:"unidentified",t:"Unidentified"},{v:"identified",t:"Identified"},{v:"away",t:"Away"}]
    .forEach(o=>objStatusSel.appendChild(el("option",{value:o.v},o.t)));
  objStatusSel.value = ctx.state.objStatus;

  const objAgeLabel = el("span",{class:"muted",style:"white-space:nowrap;font-size:12px"}, _ageLabels[_curIdx]);
  const objAgeSlider = el("input",{
    type:"range", min:"0", max:String(_ageSteps.length - 1), step:"1",
    value: String(_curIdx),
    style: "width:140px;accent-color:#52b788",
  });
  objAgeSlider.addEventListener("input", ()=>{
    const idx = Number(objAgeSlider.value);
    ctx.state.objAgeMax = _ageSteps[idx];
    objAgeLabel.textContent = _ageLabels[idx];
    applyObjFilter();
  });
  const objStats = el("span",{class:"muted"});

  const objTbody = el("tbody",{});
  const objTable = el("table",{class:"table"},[
    el("thead",{}, el("tr",{},[
      el("th",{},"Kind"),
      el("th",{},"Name / Address"),
      el("th",{},"Signal"),
      el("th",{},"Last seen"),
      el("th",{},"Scanner"),
      el("th",{},"Follow"),
      el("th",{},"Tag"),
    ])),
    objTbody,
  ]);

  // ── Walk-to-Identify: pre-compute scores for dev/advanced mode ──────────
  // Scores are calculated once here and shared by both the table-row badges
  // and the WTI bar UI below.  Algorithm: for each unidentified BLE address,
  // compare mean RSSI heard by in-room scanners vs out-of-room scanners.
  // Higher score = device is more likely physically present in the target room.
  // Score formula: inRoomMean - outRoomMean*0.5 + inRoomScannerCount*3
  //   - The 0.5 weight penalises strong out-of-room signal (device is elsewhere)
  //   - The +3 per in-room scanner rewards devices seen by multiple room scanners
  //   - Only ads < 30s old are considered (recent signal only)
  //   - Default out-of-room RSSI of -95 dBm when device is only heard in-room
  const _wtiEnabledAdv = !!(ctx.state.settings && ctx.state.settings.walk_to_identify_enabled);
  const _wtiRoomAdv = (_wtiEnabledAdv && isLive) ? (ctx.state._wtiRoom || null) : null;
  let _wtiScoresAdv = null;
  let _wtiMaxScoreAdv = 0;
  if (_wtiRoomAdv) {
    const _ads = (liveSnap && liveSnap.ble && liveSnap.ble.advertisements) || [];
    const _radios = (liveSnap && liveSnap.ble && liveSnap.ble.radios) || [];
    // Partition scanners: in-room (assigned to target room via HA area) vs all
    const _inSrcs = new Set(), _allSrcs = new Set();
    for (const r of _radios) {
      if (r.source) _allSrcs.add(r.source);
      if (r.source && (r.area_name || r.area || "") === _wtiRoomAdv) _inSrcs.add(r.source);
    }
    if (_inSrcs.size) {
      // Build per-address best RSSI from each scanner (only recent ads)
      const _arMap = {};
      for (const ad of _ads) {
        if (!ad.address || !ad.source || ad.rssi == null || (ad.age_s || 0) > 30) continue;
        const k = ad.address.toUpperCase();
        if (!_arMap[k]) _arMap[k] = {};
        if (!_arMap[k][ad.source] || ad.rssi > _arMap[k][ad.source]) _arMap[k][ad.source] = ad.rssi;
      }
      _wtiScoresAdv = {};
      for (const [addr, srcMap] of Object.entries(_arMap)) {
        let inS = 0, inC = 0, outS = 0, outC = 0;
        for (const [src, rssi] of Object.entries(srcMap)) {
          if (_inSrcs.has(src)) { inS += rssi; inC++; }
          else if (_allSrcs.has(src)) { outS += rssi; outC++; }
        }
        if (!inC) continue;
        _wtiScoresAdv[addr] = (inS / inC) - (outC ? outS / outC : -95) * 0.5 + inC * 3;
      }
      _wtiMaxScoreAdv = Math.max(0, ...Object.values(_wtiScoresAdv));
    }
  }

  const objRowEls = allObjects.map(o=>{
    // Skip entity rows that duplicate a BLE/iBeacon/private_ble row for the same device
    if(_isDuplicateEntity(o)) return null;

    const kind = o.kind || "";
    const identified = !!o.identified;
    const addr = o.address || "";
    const userLabel = o.user_label || "";
    const displayName = userLabel || o.name || o.entity_id || addr || "—";
    const rssi = o.rssi != null ? `${o.rssi} dBm` : "";
    const age = o.age_s != null ? fmtAgo(o.age_s) : "";
    const isPrivateBle = kind === "private_ble";
    const isIbeacon = kind === "ibeacon";
    const isAway = _isAway(o);
    const _sid = ctx.helpers.radioShortId || (() => "");
    const _rName = ctx.helpers.radioName || (() => "");
    const scanner = (kind==="ble" || isPrivateBle || isIbeacon) && Array.isArray(o.sources) && o.sources.length
      ? o.sources.map(s => { const src = typeof s === "object" ? (s.source || "") : String(s); const id = _sid(src); const fn = _rName(src); return id ? id+" "+(fn||src) : (fn||src); }).filter(Boolean).join(", ")
      : (o.room || "");

    // For iBeacon the stable identifier is the UUID key, not the rotating MAC
    const followKey = isIbeacon ? (o.key || "") : (addr || o.entity_id || "");
    const followCell = (() => {
      if (!followKey) return el("td",{}, "");
      const isF = ctx.actions.followedHas(followKey);
      const btn = el("button",{
        class:"btn tiny",
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

    const tagCell = (() => {
      // Use stable identifier for each kind: canonical_id for private_ble, uuid key for ibeacon
      const tagAddr = kind === "private_ble" ? (o.canonical_id || addr)
                    : kind === "ibeacon"     ? (o.key || "")
                    : addr;
      if ((kind !== "ble" && kind !== "private_ble" && kind !== "ibeacon") || !tagAddr) return el("td",{}, "");
      const btn = el("button",{class:"btn tiny"}, userLabel ? "Relabel" : "Tag");
      btn.addEventListener("click",(e)=>{ e.stopPropagation(); ctx.actions.tagObjectPrompt(tagAddr, userLabel); });
      return el("td",{}, btn);
    })();

    // For iBeacon, show UUID short form instead of the internal uuid key as address
    const displayAddr = isIbeacon ? (o.ibeacon_uuid ? `${o.ibeacon_uuid.slice(0,8)}…` : addr) : addr;

    const tr = el("tr",{
      "data-kind": kind,
      "data-identified": identified ? "1" : "0",
      "data-age": String(o.age_s != null ? Math.round(o.age_s) : 0),
      "data-search": [
        kind, displayName, addr, userLabel, o.entity_id, scanner,
        o.ibeacon_uuid, o.company_name, o.device_type,
        (o.service_names||[]).join(" "),
        o.canonical_id, o.key, o.name, o.private_ble_name,
        (o.all_addresses||[]).join(" "),
        (o.linked_entities||[]).join(" "),
        o.ibeacon_major, o.ibeacon_minor,
        o.vendor, o.device, o.prefix,
        o.first_seen,
        (o.service_uuids||[]).join(" "),
        (o.merged_protocols||[]).join(" "),
        Object.keys(o.service_data||{}).join(" "),
        isAway ? "away" : "",
      ].filter(Boolean).join(" ").toLowerCase(),
    },[
      el("td",{}, [
        isPrivateBle
          ? el("span",{class:"badge"+(identified?"":" warn"),style:identified?"background:#1a3a5a;color:#7dd3fc;border-color:#3b82f6":""}, identified?"Private BLE":"Private BLE?")
          : isIbeacon
            ? el("span",{class:"badge"+(identified?"":" warn"),style:identified?"background:#3a2a0a;color:#fbbf24;border-color:#d97706":""},
                (Array.isArray(o.merged_protocols) && o.merged_protocols.length > 1)
                  ? (identified ? o.merged_protocols.join("+") : o.merged_protocols.join("+")+"?")
                  : (identified?"iBeacon":"iBeacon?"))
            : el("span",{class:"badge"+(identified?"":" warn")}, kind==="ble" ? (identified?"BLE":"BLE?") : "Entity"),
      ]),
      el("td",{}, [
        el("div",{style:"font-weight:600"}, displayName),
        (displayAddr && displayAddr !== displayName ? el("div",{class:"muted",style:"font-size:11px"}, displayAddr) : null),
        (o.entity_id && !userLabel ? el("div",{class:"muted",style:"font-size:11px"}, o.entity_id) : null),
        (isPrivateBle && o.private_ble_name
          ? el("div",{class:"muted",style:"font-size:11px"}, `\u{1F512} ${o.private_ble_name}`) : null),
        (isIbeacon && o.ibeacon_uuid
          ? el("div",{class:"muted",style:"font-size:11px"}, `UUID: ${o.ibeacon_uuid.slice(0,8)}\u2026 \u00B7 M${o.ibeacon_major}.${o.ibeacon_minor}`) : null),
        (Array.isArray(o.all_addresses) && o.all_addresses.length > 1
          ? el("div",{class:"muted",style:"font-size:10px;color:#a78bfa"}, `${o.all_addresses.length} MACs merged`)
          : null),
        // WTI score badge (dev mode)
        (_wtiRoomAdv && _wtiScoresAdv && !identified && (() => {
          const sc = _wtiScoresAdv[(addr || "").toUpperCase()] || 0;
          const thr = _wtiMaxScoreAdv * 0.4;
          if (sc > thr && sc > 0) {
            const pct = Math.min(100, Math.round(sc / _wtiMaxScoreAdv * 100));
            return el("div",{style:"display:flex;align-items:center;gap:4px;margin-top:2px"}, [
              el("span",{style:"font-size:9px;padding:1px 6px;border-radius:3px;background:rgba(168,85,247,.2);color:#d8b4fe;font-weight:700"}, `Likely in ${_wtiRoomAdv}`),
              el("span",{style:"font-size:10px;color:#94a3b8"}, `${pct}% match`),
            ]);
          }
          return null;
        })()),
        // Enrichment: company + device type + services
        ((o.company_name || o.device_type || (o.service_names && o.service_names.length))
          ? el("div",{style:"display:flex;flex-wrap:wrap;gap:4px;margin-top:2px"}, [
              o.company_name ? el("span",{class:"badge",style:"font-size:9px;padding:1px 5px;background:#1a2a3a;color:#7dd3fc;border-color:#1e4976"}, o.company_name) : null,
              o.device_type  ? el("span",{class:"badge",style:"font-size:9px;padding:1px 5px;background:#2a1a3a;color:#c4b5fd;border-color:#5b21b6"}, o.device_type) : null,
              ...(o.service_names || []).slice(0,2).map(sn =>
                el("span",{class:"badge",style:"font-size:9px;padding:1px 5px;background:#1a3a2a;color:#86efac;border-color:#166534"}, sn)
              ),
            ].filter(Boolean))
          : null),
      ].filter(Boolean)),
      el("td",{}, o._ghost
        ? el("span",{class:"badge",style:"background:#2a1a00;color:#f59e0b;border-color:#92400e;font-size:10px"}, "No signal")
        : (rssi && !isAway ? el("span",{class:"badge"}, rssi) : "—")),
      el("td",{}, o._ghost
        ? el("span",{class:"badge",style:"background:#2a1a00;color:#f59e0b;border-color:#92400e;font-size:10px"}, "Waiting")
        : (isAway
          ? [
              el("span",{class:"badge",style:"background:#3a0a0a;color:#f87171;border-color:#7f1d1d;font-size:10px"}, "Away"),
              age ? el("div",{class:"muted",style:"font-size:10px;margin-top:2px"}, age) : null,
            ].filter(Boolean)
          : (age || "—"))),
      el("td",{class:"muted",style:"font-size:11px;max-width:160px;overflow:hidden;text-overflow:ellipsis"},
        o.knn_confidence > 0
          ? [scanner || "—", el("div",{style:"font-size:10px;color:#52b788;margin-top:1px"}, `Calibrated ${Math.round(o.knn_confidence*100)}%`)]
          : (scanner || "—")),
      followCell,
      tagCell,
    ]);
    tr.style.cursor = "pointer";
    tr.title = "Click for details";
    tr.addEventListener("click", (ev)=>{
      if(ev.target.tagName==="BUTTON") return;
      ctx.actions.showObjectDetail(o);
    });
    objTbody.appendChild(tr);
    return tr;
  }).filter(Boolean);

  function applyObjFilter(){
    const q = String(ctx.state.objSearch||"").toLowerCase();
    const k = ctx.state.objKind || "all";
    const s = ctx.state.objStatus || "all";
    const maxAge = ctx.state.objAgeMax != null ? ctx.state.objAgeMax : 604800;
    let shown = 0;
    for(const tr of objRowEls){
      const kind = tr.getAttribute("data-kind");
      const ident = tr.getAttribute("data-identified")==="1";
      const hay = tr.getAttribute("data-search")||"";
      const away = hay.includes(" away");
      const age = Number(tr.getAttribute("data-age") || "0");
      let ok = true;
      // Entity objects always pass the age filter (they're real-time from HA)
      if(kind !== "entity" && age > maxAge) ok = false;
      // Kind filter — "ble" (all) includes ble + private_ble + ibeacon;
      // sub-filters (ble_only, ibeacon, private_ble) match exact kind only.
      if(k === "ble" && kind !== "ble" && kind !== "private_ble" && kind !== "ibeacon") ok = false;
      else if(k === "ble_only" && kind !== "ble") ok = false;
      else if(k === "ibeacon" && kind !== "ibeacon") ok = false;
      else if(k === "private_ble" && kind !== "private_ble") ok = false;
      else if(k === "entity" && kind !== "entity") ok = false;
      else if(k !== "all" && k !== "ble" && k !== "ble_only" && k !== "ibeacon" && k !== "private_ble" && k !== "entity" && kind !== k) ok = false;
      if(s === "identified" && !ident) ok = false;
      if(s === "unidentified" && ident) ok = false;
      if(s === "away" && !away) ok = false;
      if(q && !hay.includes(q)) ok = false;
      tr.style.display = ok ? "" : "none";
      if(ok) shown++;
    }
    const _dedupN = (summary && summary.dedup_absorbed) || 0;
    objStats.textContent = `${shown} of ${objRowEls.length}` + (_dedupN ? ` (${_dedupN} merged)` : "");
  }

  objSearchInput.addEventListener("input",  ()=>{ ctx.state.objSearch = objSearchInput.value; applyObjFilter(); });
  objKindSel.addEventListener("change",     ()=>{ ctx.state.objKind   = objKindSel.value;     applyObjFilter(); });
  objStatusSel.addEventListener("change",   ()=>{ ctx.state.objStatus = objStatusSel.value;   applyObjFilter(); });
  applyObjFilter();

  // ── Basic mode: card-per-object list ─────────────────────────────────────────
  if(isBasic){
    const _basicMaxAge = ctx.state.objAgeMax != null ? ctx.state.objAgeMax : 604800;
    const _ageFilter = (o) => o.kind === "entity" || (typeof o.age_s !== "number") || o.age_s <= _basicMaxAge;
    const identified = allObjects.filter(o => o.identified && _ageFilter(o));
    const unidentified = allObjects.filter(o => !o.identified && _ageFilter(o));

    const basicAgeLabel = el("span",{class:"muted",style:"white-space:nowrap;font-size:12px"}, _ageLabels[_curIdx]);
    const basicAgeSlider = el("input",{
      type:"range", min:"0", max:String(_ageSteps.length - 1), step:"1",
      value: String(_curIdx),
      style: "width:120px;accent-color:#52b788",
    });
    basicAgeSlider.addEventListener("input", ()=>{
      const idx = Number(basicAgeSlider.value);
      ctx.state.objAgeMax = _ageSteps[idx];
      ctx.actions.renderRooms();
    });
    const headerRow = el("div",{class:"card-head",style:"flex-wrap:wrap;gap:8px"},[
      el("div",{class:"h2",style:"flex:1"}, "Tracked Objects"),
      el("div",{style:"display:flex;align-items:center;gap:6px"},
        [el("span",{class:"muted",style:"font-size:12px"}, "History:"), basicAgeSlider, basicAgeLabel]),
      helpBtn("objects"),
    ]);

    const mkCard = (o) => {
      const addr = o.address || o.entity_id || "";
      const name = o.user_label || o.name || o.entity_id || addr || "Unknown";
      const room = o.room || "—";
      const rssi = o.rssi != null ? `${o.rssi} dBm` : null;
      const kind = o.kind === "entity" ? "HA Entity"
        : o.kind === "private_ble" ? "Private BLE"
        : o.kind === "ibeacon" ? "iBeacon"
        : (o.identified ? "Tagged BLE" : "Unknown BLE");
      const isObjAway = _isAway(o);

      const actions = el("div",{class:"basic-obj-actions"});
      // Follow toggle
      const followKey = addr || o.entity_id || "";
      if(followKey){
        const isF = ctx.actions.followedHas(followKey);
        const fBtn = el("button",{
          class:"btn tiny",
          style: isF ? "background:#1a3a2a;border-color:#52b788;color:#52b788" : "",
        }, isF ? "✓ Following" : "Follow");
        fBtn.addEventListener("click", ()=>{
          ctx.actions.followedToggle(followKey);
          const nowF = ctx.actions.followedHas(followKey);
          fBtn.textContent = nowF ? "✓ Following" : "Follow";
          fBtn.style.cssText = nowF ? "background:#1a3a2a;border-color:#52b788;color:#52b788" : "";
        });
        actions.appendChild(fBtn);
      }
      const tagAddr2 = o.kind === "private_ble" ? (o.canonical_id || addr)
                     : o.kind === "ibeacon"     ? (o.key || "")
                     : addr;
      if((o.kind === "ble" || o.kind === "private_ble" || o.kind === "ibeacon") && tagAddr2){
        const btn = el("button",{class:"btn tiny"}, o.user_label ? "Relabel" : "Tag");
        btn.addEventListener("click", ()=> ctx.actions.tagObjectPrompt(tagAddr2, o.user_label || ""));
        actions.appendChild(btn);
      }
      const detailsBtn = el("button",{class:"btn tiny", onclick:()=> ctx.actions.showObjectDetail(o)}, "Details");
      actions.appendChild(detailsBtn);

      return el("div",{class:"basic-obj-card"},[
        el("div",{},[
          el("div",{class:"basic-obj-name",style:"display:flex;align-items:center;gap:6px"},[
            el("span",{}, name),
            o._ghost ? el("span",{class:"badge",style:"background:#2a1a00;color:#f59e0b;border-color:#92400e;font-size:9px"}, "Waiting for signal") : null,
            isObjAway && !o._ghost ? el("span",{class:"badge",style:"background:#3a0a0a;color:#f87171;border-color:#7f1d1d;font-size:9px"}, "Away") : null,
          ].filter(Boolean)),
          el("div",{class:"basic-obj-room"}, o._ghost
            ? "Enable BLE Transmitter in Companion App"
            : (isObjAway
              ? (o.last_room ? `Last: ${o.last_room}` : "—")
              : room)),
          el("div",{class:"basic-obj-sub"}, [kind, o.company_name, o.device_type, isObjAway ? null : rssi].filter(Boolean).join(" · ")),
        ]),
        actions,
      ]);
    };

    const identCard = el("div",{class:"card",style:"margin-bottom:10px"},[
      headerRow,
      helpBtn ? null : null,
    ]);
    identified.forEach(o => identCard.appendChild(mkCard(o)));
    if(!identified.length){
      identCard.appendChild(el("div",{class:"muted",style:"margin-top:8px"},
        isLive ? "No identified objects detected yet." : "Switch to Live mode to see your real devices."));
    }
    root.appendChild(identCard);

    if(unidentified.length){
      const clearUnidentBtn = el("button",{class:"btn inline",style:"font-size:11px;color:#f87171;border-color:#7f1d1d"}, "Clear unidentified");
      clearUnidentBtn.title = "Remove all unidentified objects. Tagged and followed devices are kept.";
      clearUnidentBtn.addEventListener("click", async()=>{
        if(!confirm("Clear all unidentified objects?\n\nTagged and followed devices will be kept.")) return;
        clearUnidentBtn.disabled = true; clearUnidentBtn.textContent = "Clearing...";
        try {
          const res = await ctx.actions.wsCall("padspan_ha/objects_clear_history", {});
          ctx.toast(`Cleared ${res.removed} object${res.removed!==1?"s":""}, kept ${res.kept} tagged/followed`);
          ctx.actions.renderRooms();
        } catch(e){ ctx.toast("Failed: " + (e.message||e), true); clearUnidentBtn.textContent = "Clear unidentified"; }
        clearUnidentBtn.disabled = false;
      });

      // ── Walk-to-Identify: "Who's here?" room filter ───────────────────────
      const _wtiEnabled = !!(ctx.state.settings && ctx.state.settings.walk_to_identify_enabled);
      let _wtiRoom = ctx.state._wtiRoom || null;
      let _wtiScores = null; // {addr: score}

      // Compute scores: for each unidentified object, how strongly does it correlate
      // with scanners in the selected room? Uses live advertisement RSSI data.
      function _computeWtiScores(targetRoom) {
        const ads = (liveSnap && liveSnap.ble && liveSnap.ble.advertisements) || [];
        const radios = (liveSnap && liveSnap.ble && liveSnap.ble.radios) || [];
        // Find scanner sources assigned to the target room
        const inRoomSrcs = new Set();
        const allSrcs = new Set();
        for (const r of radios) {
          if (r.source) allSrcs.add(r.source);
          if (r.source && (r.area_name || r.area || "") === targetRoom) inRoomSrcs.add(r.source);
        }
        if (!inRoomSrcs.size) return {};
        // Build per-address RSSI map: {addr: {source: rssi}}
        const addrRssi = {};
        for (const ad of ads) {
          if (!ad.address || !ad.source || ad.rssi == null) continue;
          if ((ad.age_s || 0) > 30) continue; // only recent ads
          const key = ad.address.toUpperCase();
          if (!addrRssi[key]) addrRssi[key] = {};
          // Keep best (most recent / strongest) per source
          if (!addrRssi[key][ad.source] || ad.rssi > addrRssi[key][ad.source]) {
            addrRssi[key][ad.source] = ad.rssi;
          }
        }
        // Score each address
        const scores = {};
        for (const [addr, srcMap] of Object.entries(addrRssi)) {
          let inRoomSum = 0, inRoomCount = 0;
          let outRoomSum = 0, outRoomCount = 0;
          for (const [src, rssi] of Object.entries(srcMap)) {
            if (inRoomSrcs.has(src)) {
              inRoomSum += rssi;
              inRoomCount++;
            } else if (allSrcs.has(src)) {
              outRoomSum += rssi;
              outRoomCount++;
            }
          }
          if (!inRoomCount) continue; // not seen by any in-room scanner
          const inRoomMean = inRoomSum / inRoomCount;
          const outRoomMean = outRoomCount ? outRoomSum / outRoomCount : -95;
          // Score = how much stronger in target room vs elsewhere
          // Higher = more likely to be physically in the room
          scores[addr] = inRoomMean - outRoomMean * 0.5 + inRoomCount * 3;
        }
        return scores;
      }

      // Room selector for WTI
      let wtiBar = null;
      if (_wtiEnabled && isLive) {
        const rooms = (liveSnap && liveSnap.rooms_discovered) || Object.keys(ctx.state.roomTagMap || {});
        const roomSel = el("select", {style:"font-size:11px;padding:2px 6px;background:#0a1a12;color:#e2e8f0;border:1px solid #2d6a4f;border-radius:6px"});
        roomSel.appendChild(el("option",{value:""}, "— select room —"));
        for (const r of rooms) roomSel.appendChild(el("option",{value:r}, r));
        if (_wtiRoom) roomSel.value = _wtiRoom;

        const wtiBtn = el("button",{class:"btn inline",style:"font-size:11px;padding:2px 8px;background:#1a0a2e;border-color:#a855f7;color:#d8b4fe;font-weight:600"}, "Who's here?");
        wtiBtn.addEventListener("click", () => {
          const room = roomSel.value;
          if (!room) { ctx.toast("Select a room first", true); return; }
          ctx.state._wtiRoom = room;
          _wtiRoom = room;
          _wtiScores = _computeWtiScores(room);
          ctx.actions.renderRooms();
        });
        const wtiClear = _wtiRoom ? el("button",{class:"btn inline",style:"font-size:10px;color:#94a3b8"}, "Clear") : null;
        if (wtiClear) wtiClear.addEventListener("click", () => {
          ctx.state._wtiRoom = null;
          _wtiRoom = null;
          _wtiScores = null;
          ctx.actions.renderRooms();
        });

        wtiBar = el("div",{style:"display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-bottom:10px"},[
          el("span",{style:"font-size:9px;padding:1px 6px;border-radius:3px;background:rgba(168,85,247,.15);color:#a855f7;font-weight:600;text-transform:uppercase"}, "walk-to-identify"),
          roomSel,
          wtiBtn,
          wtiClear,
          _wtiRoom ? el("span",{style:"font-size:11px;color:#d8b4fe;font-weight:600"}, `Showing devices likely in: ${_wtiRoom}`) : null,
        ].filter(Boolean));

        // Compute scores if room is active
        if (_wtiRoom) _wtiScores = _computeWtiScores(_wtiRoom);
      }

      const unCard = el("div",{class:"card"},[
        el("div",{class:"card-head"},[
          el("div",{class:"h2"}, `Unidentified (${unidentified.length})`),
          clearUnidentBtn,
          helpBtn("objects_tag"),
        ]),
        el("div",{class:"muted",style:"font-size:12px;margin-bottom:10px"},
          "These Bluetooth devices haven't been named yet. Click Tag to give one a friendly name."),
      ]);
      if (wtiBar) unCard.appendChild(wtiBar);

      // Sort: if WTI active, sort by correlation score descending.
      // Otherwise default: iBeacons/private_ble first, then by age.
      let _sortedUnident;
      if (_wtiRoom && _wtiScores) {
        _sortedUnident = [...unidentified].sort((a, b) => {
          const sa = _wtiScores[(a.address || "").toUpperCase()] || -999;
          const sb = _wtiScores[(b.address || "").toUpperCase()] || -999;
          return sb - sa;
        });
      } else {
        _sortedUnident = [...unidentified].sort((a,b) => {
          const kindPri = (o) => o.kind === "ibeacon" ? 0 : o.kind === "private_ble" ? 1 : 2;
          const kd = kindPri(a) - kindPri(b);
          if(kd !== 0) return kd;
          return (a.age_s || 0) - (b.age_s || 0);
        });
      }
      // WTI threshold: devices scoring above 40% of the top score are "likely in room"
      const _wtiMaxScore = _wtiScores ? Math.max(0, ...Object.values(_wtiScores)) : 0;
      const _wtiThreshold = _wtiMaxScore * 0.4;
      _sortedUnident.slice(0, 50).forEach(o => {
        const card = mkCard(o);
        // WTI badge: show "Likely in [Room]" with match % for top candidates
        if (_wtiRoom && _wtiScores && _wtiMaxScore > 0) {
          const score = _wtiScores[(o.address || "").toUpperCase()] || 0;
          if (score > _wtiThreshold) {
            const scorePct = Math.min(100, Math.round(score / _wtiMaxScore * 100));
            card.appendChild(el("div",{style:"display:flex;align-items:center;gap:4px;margin-top:4px"}, [
              el("span",{style:"font-size:9px;padding:1px 6px;border-radius:3px;background:rgba(168,85,247,.2);color:#d8b4fe;font-weight:700"}, `Likely in ${_wtiRoom}`),
              el("span",{style:"font-size:10px;color:#94a3b8"}, `${scorePct}% match`),
            ]));
          }
        }
        unCard.appendChild(card);
      });
      root.appendChild(unCard);
    }
    return root;
  }

  // ── Advanced mode: table ──────────────────────────────────────────────────────
  const awayCount = allObjects.filter(_isAway).length;
  // Badge factory: creates clickable badges that filter the object list
  function _mkFilterBadge(text, extraStyle, kindVal, statusVal, isWarn) {
    const badge = el("span", {
      class: "badge" + (isWarn ? " warn" : ""),
      style: (extraStyle || "") + ";cursor:pointer",
      title: "Click to filter",
    }, text);
    badge.addEventListener("click", () => {
      ctx.state.objKind = kindVal;
      ctx.state.objStatus = statusVal;
      objKindSel.value = kindVal;
      objStatusSel.value = statusVal;
      applyObjFilter();
    });
    return badge;
  }

  const inventorySection = el("div",{class:"card"},[
    el("div",{class:"row",style:"margin-bottom:8px"},[
      el("div",{class:"h2",style:"flex:1"}, _quietMode ? "Tracked Objects" : "BLE Scanner Detections"),
      _quietMode
        ? el("span",{class:"badge",style:"background:#0a2a1a;color:#52b788;border-color:#166534;font-weight:700"}, "Quiet Mode")
        : null,
      _quietMode ? null : (summary ? _mkFilterBadge(`${summary.ble||0} BLE`, "", "ble", "all") : null),
      _quietMode ? null : (summary && summary.ibeacon ? _mkFilterBadge(`${summary.ibeacon} iBeacon`, "background:#2a1a00;color:#fbbf24;border-color:#92400e", "ibeacon", "all") : null),
      _quietMode ? null : (summary && summary.private_ble ? _mkFilterBadge(`${summary.private_ble} Private BLE`, "background:#0a1a3a;color:#93c5fd;border-color:#1e4976", "private_ble", "all") : null),
      _quietMode ? null : (summary ? _mkFilterBadge(`${summary.unidentified||0} unidentified`, "", "all", "unidentified", true) : null),
      summary ? _mkFilterBadge(`${summary.entities||0} entities`, "", "entity", "all") : null,
      awayCount ? _mkFilterBadge(`${awayCount} away`, "background:#3a0a0a;color:#f87171;border-color:#7f1d1d", "all", "away") : null,
    ].filter(Boolean)),
    el("div",{class:"toolbar"},[objSearchInput, objKindSel, objStatusSel,
      el("div",{style:"display:flex;align-items:center;gap:6px"},
        [el("span",{class:"muted",style:"font-size:12px;white-space:nowrap"}, "History:"), objAgeSlider, objAgeLabel]),
      objStats,
      (() => {
        const clrBtn = el("button",{class:"btn inline",style:"font-size:11px;color:#f87171;border-color:#7f1d1d;margin-left:auto;white-space:nowrap"}, "Clear unidentified");
        clrBtn.title = "Remove all unidentified objects. Tagged and followed devices are kept.";
        clrBtn.addEventListener("click", async () => {
          if (!confirm("Clear all unidentified objects?\n\nTagged and followed devices will be kept.")) return;
          clrBtn.disabled = true;
          clrBtn.textContent = "Clearing...";
          try {
            const res = await ctx.actions.wsCall("padspan_ha/objects_clear_history", {});
            ctx.toast(`Cleared ${res.removed} object${res.removed!==1?"s":""}, kept ${res.kept} tagged/followed`);
            ctx.actions.renderRooms();
          } catch(e) {
            clrBtn.textContent = "Error";
            ctx.toast("Failed: " + (e.message||e), true);
          }
          clrBtn.disabled = false; clrBtn.textContent = "Clear unidentified";
        });
        return clrBtn;
      })()]),
    allObjects.length
      ? objTable
      : el("div",{class:"muted"}, isLive ? "Waiting for scanner data…" : "Switch to Live mode to see real BLE detections."),
  ]);

  // ── Walk-to-Identify bar (advanced/dev mode) ─────────────────────────────
  if (_wtiEnabledAdv && isLive) {
    const _wtiRooms = (liveSnap && liveSnap.rooms_discovered) || Object.keys(ctx.state.roomTagMap || {});
    const roomSel = el("select", {style:"font-size:11px;padding:2px 6px;background:#0a1a12;color:#e2e8f0;border:1px solid #2d6a4f;border-radius:6px"});
    roomSel.appendChild(el("option",{value:""}, "— select room —"));
    for (const r of _wtiRooms) roomSel.appendChild(el("option",{value:r}, r));
    if (_wtiRoomAdv) roomSel.value = _wtiRoomAdv;

    const wtiBtn = el("button",{class:"btn inline",style:"font-size:11px;padding:2px 8px;background:#1a0a2e;border-color:#a855f7;color:#d8b4fe;font-weight:600"}, "Who's here?");
    wtiBtn.addEventListener("click", () => {
      const room = roomSel.value;
      if (!room) { ctx.toast("Select a room first", true); return; }
      ctx.state._wtiRoom = room;
      ctx.state.objStatus = "unidentified";
      ctx.actions.renderRooms();
    });
    const wtiClear = _wtiRoomAdv ? el("button",{class:"btn inline",style:"font-size:10px;color:#94a3b8"}, "Clear") : null;
    if (wtiClear) wtiClear.addEventListener("click", () => {
      ctx.state._wtiRoom = null;
      ctx.actions.renderRooms();
    });

    let wtiResults = null;
    if (_wtiRoomAdv && _wtiScoresAdv) {
      const threshold = _wtiMaxScoreAdv * 0.4;
      const topCount = Object.values(_wtiScoresAdv).filter(s => s >= threshold).length;
      wtiResults = el("span",{style:"font-size:11px;color:#d8b4fe;font-weight:600"},
        `${topCount} candidate${topCount !== 1 ? "s" : ""} likely in ${_wtiRoomAdv}`);
    }

    const wtiBar = el("div",{style:"display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-bottom:10px;padding:8px 12px;background:#0f0a1e;border:1px solid rgba(168,85,247,.3);border-radius:8px"},[
      el("span",{style:"font-size:9px;padding:1px 6px;border-radius:3px;background:rgba(168,85,247,.15);color:#a855f7;font-weight:600;text-transform:uppercase"}, "walk-to-identify"),
      roomSel, wtiBtn, wtiClear, wtiResults,
    ].filter(Boolean));

    inventorySection.insertBefore(wtiBar, inventorySection.children[2] || null);
  }

  root.appendChild(inventorySection);


  const roomsList = el("div",{class:"rooms", id:"rooms"});
  const tagsList = el("div",{class:"tags", id:"tags"});

  const rooms = (() => {
    const disc = liveSnap && liveSnap.rooms_discovered;
    if (disc && disc.length) return [...disc].sort((a,b)=>a.localeCompare(b));
    return Object.keys(roomTagMap||{}).sort((a,b)=>a.localeCompare(b));
  })();
  // Ensure at least one room selected so tags list has context.
  if (selectedRooms.size === 0 && rooms.length) { selectedRooms.add(rooms[0]); ctx.state.selectedRooms = Array.from(selectedRooms); }
  if(!rooms.length){
    roomsList.appendChild(el("div",{class:"item"},"No room data yet."));
  } else {
    for(const room of rooms){
      const count = (roomTagMap[room]||[]).length;
      const row = el("label",{class:"item"});
      const cb = el("input",{type:"checkbox"});
      cb.checked = selectedRooms.has(room);
      cb.addEventListener("change", ()=>{ cb.checked ? selectedRooms.add(room) : selectedRooms.delete(room); ctx.state.selectedRooms = Array.from(selectedRooms); ctx.actions.renderTags(); });
      row.appendChild(cb);
      row.appendChild(el("span",{class:"roomdot", style:`background:${roomColor(room)}`}, ""));
      row.appendChild(el("span",{}, esc(room)));
      row.appendChild(el("span",{class:"muted"}, `(${count})`));
      roomsList.appendChild(row);
    }
  }

  const toolbarLeft = el("div",{class:"toolbar"},[
    el("button",{class:"btn", onclick:()=>{ rooms.forEach(r=>selectedRooms.add(r)); ctx.state.selectedRooms = Array.from(selectedRooms); ctx.state._roomsInit = true; ctx.actions.renderRooms(); ctx.actions.renderTags(); }},"All Rooms"),
    el("button",{class:"btn", onclick:()=>{ selectedRooms.clear(); ctx.state.selectedRooms = []; ctx.state._roomsInit = true; ctx.actions.renderRooms(); ctx.actions.renderTags(); }},"Clear"),
  ]);

  const modeSel = el("select",{class:"btn", id:"modeSel"});
  modeSel.style.maxWidth="420px";
  const optAll = el("option",{value:"all"},"Show tags in ALL selected rooms (intersection)");
  const optAny = el("option",{value:"any"},"Show tags in ANY selected room (union)");
  modeSel.appendChild(optAll); modeSel.appendChild(optAny);
  modeSel.value = mode;
  modeSel.addEventListener("change", ()=>{ ctx.state.mode = modeSel.value; ctx.actions.renderTags(); });

  const filter = el("input",{type:"text", id:"tagFilter", placeholder:"Filter tags… (e.g., keys)"});
  filter.value = tagFilter;
  filter.addEventListener("input", ()=>{ ctx.state.tagFilter = filter.value; ctx.actions.renderTags(); });

  const toolbarRight = el("div",{class:"toolbar"},[modeSel, filter]);

  const leftCard = el("div",{class:"card"},[
    el("div",{class:"h2"},"Room Presence Mapping"),
    el("div",{class:"muted",style:"margin-bottom:6px"},"Select rooms to see which trackers are assigned to them."),
    toolbarLeft,
    roomsList,
  ]);

  const rightCard = el("div",{class:"card"},[
    el("div",{class:"muted"},"Trackers in selected rooms"),
    toolbarRight,
    tagsList,
  ]);

  const grid = el("div",{class:"grid"},[leftCard,rightCard]);
  root.appendChild(grid);

  renderTags(ctx, tagsList);

  return root;
}
