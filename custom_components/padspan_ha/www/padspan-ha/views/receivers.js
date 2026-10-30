// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
// See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
/**
 * Receivers: every Bluetooth receiver (scanner / proxy) in one table, one row
 * each, with what is spread over the other screens: room, floor, whether it
 * is on a floor plan, height, signal adjustment, status, devices heard now,
 * last heard. (Interface review item 11, after ESPresense Companion's Nodes.)
 *
 * Nothing here has its own storage or its own rules:
 *   height             model.scanner_positions_m[source].z_m, saved with
 *                      padspan_ha/fabric_scanner_z_set {source, z_m} — the
 *                      command Calibration → Tune and Mapping → Edit → Radios
 *                      send, with the same limits, default, lock and refresh
 *   signal adjustment  settings.scanner_offsets[source], saved with
 *                      ctx.actions.scannerOffsetSet (padspan_ha/
 *                      scanner_offset_set) — Settings → Tracking → Receivers,
 *                      same −20…+20 dB range
 *   status             views/status_dot.js receiverStatus (the top bar dot's
 *                      own silent / hearing-less rules)
 *   on a floor plan    the map's receivers, matched the way Edit → Radios
 *                      matches its live radio list (source, name or id)
 * Positions are never written here: "Place" opens Mapping's own placement
 * (Edit → Radios, or the map wizard's Place scanners step in Basic) with the
 * radio selected. Calibration points are not read or written.
 */

const SD = await import(`./status_dot.js${new URL(import.meta.url).search}`);
const TSP = await import(`./tune_save_plan.js${new URL(import.meta.url).search}`).catch(() => null);

// "Devices heard now": distinct addresses this receiver heard in the last minute.
export const HEARD_NOW_S = 60;
export const OFFSET_MIN = -20, OFFSET_MAX = 20;

const _lc = (s) => String(s || "").toLowerCase();

/** The map receiver this live radio is, by Edit → Radios' rule. */
function _placement(maps, radio) {
  for (const m of maps || []) {
    for (const r of (m && m.receivers) || []) {
      if (!r) continue;
      if ((r.source && r.source === radio.source)
          || (r.label && radio.name && _lc(r.label) === _lc(radio.name))
          || (r.id && r.id === radio.source)) {
        return { mapId: m.id, mapName: m.name || "", rxId: r.id || "", room: r.room || "", floorId: m.floor_id || "" };
      }
    }
  }
  return null;
}

/** "12 s ago" / "4 min ago" / "3 h ago"; null when never heard. */
export function agoText(s) {
  if (typeof s !== "number" || !Number.isFinite(s)) return null;
  if (s < 60) return `${Math.max(0, Math.round(s))} s ago`;
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 172800) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86400)} d ago`;
}

/** One row per live receiver, from what the panel already holds (the live
 *  snapshot, the model, the maps list, settings). Pure: no requests. */
export function receiverRows(state) {
  const s = state || {};
  const snap = (s.live && s.live.snapshot) || null;
  const radios = (snap && snap.ble && Array.isArray(snap.ble.radios)) ? snap.ble.radios.filter(r => r && typeof r === "object") : [];
  const ads = (snap && snap.ble && Array.isArray(snap.ble.advertisements)) ? snap.ble.advertisements : [];
  const model = s.model || {};
  const spm = model.scanner_positions_m || {};
  const floors = Array.isArray(model.floors) ? model.floors : [];
  const areas = Array.isArray(model.areas) ? model.areas : [];
  const maps = (s.maps && Array.isArray(s.maps.list)) ? s.maps.list : [];
  const offsets = (s.settings && s.settings.scanner_offsets) || {};
  // The dot's own inputs: the receivers Settings leaves out, and who is in
  // this snapshot's advertisements at all.
  const masked = SD.maskedSources(s.settings), heardAny = SD.heardSources(snap);

  const heard = new Map();
  for (const a of ads) {
    if (!a || !a.source || !a.address || (typeof a.age_s === "number" && a.age_s > HEARD_NOW_S)) continue;
    let set = heard.get(a.source);
    if (!set) heard.set(a.source, set = new Set());
    set.add(String(a.address).toUpperCase());
  }
  const floorName = (id) => { const f = floors.find(x => x && x.id === id); return f ? (f.name || id) : id; };

  return radios.map(r => {
    const source = String(r.source || r.name || "");
    const placed = _placement(maps, r);
    const fab = spm[source] && typeof spm[source] === "object" ? spm[source] : null;
    const room = (placed && placed.room) || r.area_name || "";
    const area = areas.find(a => a && r.area_name && _lc(a.name) === _lc(r.area_name));
    const floorId = (fab && fab.floor_id) || (placed && placed.floorId) || (area && area.floor_id) || "";
    const off = offsets[source];
    const devices = (heard.get(source) || new Set()).size;
    return {
      source,
      name: String(r.display_name || r.name || source || "Receiver"),
      room,
      areaName: r.area_name || "",
      floorId,
      floor: floorId ? floorName(floorId) : "",
      placed,
      height: fab ? (fab.z_m != null ? Number(fab.z_m) : 2.4) : null,
      offset: off != null && Number.isFinite(Number(off)) ? Number(off) : 0,
      status: SD.receiverStatus(r, devices, { heard: heardAny, masked }),
      devices,
      lastHeardS: typeof r.last_heard_s === "number" ? r.last_heard_s : null,
    };
  });
}

const SORTS = {
  name:   (a, b) => a.name.localeCompare(b.name),
  room:   (a, b) => (a.room || "￿").localeCompare(b.room || "￿"),
  floor:  (a, b) => (a.floor || "￿").localeCompare(b.floor || "￿"),
  placed: (a, b) => (a.placed ? 0 : 1) - (b.placed ? 0 : 1),
  height: (a, b) => (a.height ?? 1e9) - (b.height ?? 1e9),
  offset: (a, b) => a.offset - b.offset,
  status: (a, b) => (a.status.level === "amber" ? 0 : 1) - (b.status.level === "amber" ? 0 : 1),
  devices: (a, b) => b.devices - a.devices,
  heard:  (a, b) => (a.lastHeardS ?? 1e12) - (b.lastHeardS ?? 1e12),
};

/** Sorted (stable on name) and filtered rows. */
export function viewRows(rows, { sort = "name", dir = 1, problems = false } = {}) {
  const cmp = SORTS[sort] || SORTS.name;
  const out = rows.filter(r => !problems || r.status.level !== "ok");
  return out.sort((a, b) => (cmp(a, b) * dir) || a.name.localeCompare(b.name));
}

// Mapping's placement, opened on this radio: the map it is on (or the map of
// its floor), Edit → Radios with it selected; in Basic, where Mapping has no
// Edit tab, the map wizard's Place scanners step (the same editor).
function _openPlacement(ctx, row) {
  const maps = (ctx.state.maps && ctx.state.maps.list) || [];
  const mapId = (row.placed && row.placed.mapId)
    || ((maps.find(m => m && row.floorId && m.floor_id === row.floorId) || {}).id)
    || (maps.some(m => m && m.id === ctx.state.activeMapId) ? ctx.state.activeMapId : null)
    || (maps[0] && maps[0].id) || null;
  ctx.state.maps = ctx.state.maps || {};
  ctx.state.view = "maps";
  if (!mapId) {
    ctx.state._mapsWizard = { step: 1, mapId: null };
    if (ctx.actions.renderNav) ctx.actions.renderNav();
    ctx.actions.renderRooms();
    return;
  }
  ctx.state.activeMapId = mapId;
  // One-shot, read by maps.js once its Edit draft is loaded.
  ctx.state.maps._openRadios = { rxId: (row.placed && row.placed.rxId) || null };
  if (ctx.actions.renderNav) ctx.actions.renderNav();
  if (ctx.state.complexity === "basic") {
    ctx.state._mapsWizard = { step: 4, mapId };
    ctx.actions.renderRooms();
  } else if (ctx.actions.setMapsTab) ctx.actions.setMapsTab("edit");
  else { ctx.state.mapsTab = "edit"; ctx.actions.renderRooms(); }
}

const INPUT = "width:68px;background:#071008;border:1px solid #2d4a38;color:#e2e8f0;padding:5px 7px;border-radius:8px;font-size:12px";

// Height: the same command, payload, limits, 2.4 m default, lock and
// acknowledged-value publish as Calibration → Tune and Edit → Radios.
function _heightCell(ctx, el, row, editable) {
  if (row.height == null) {
    return el("span", { class: "muted", title: "A height can be set once this receiver has a position: place it on a floor plan, then Calibration → Tune → Save." }, "No position yet");
  }
  if (!editable) return el("span", { class: "rx-num" }, `${row.height} m`);
  const zInp = el("input", { type: "number", min: "0", max: "100", step: "0.1", style: INPUT, "aria-label": `Height above floor (m) for ${row.name}` });
  zInp.value = String(row.height);
  const zBtn = el("button", { class: "btn inline rx-save", title: "Mounting height above this receiver's own floor. Same value as Calibration → Tune and Mapping → Edit → Radios." }, "Save");
  zBtn.addEventListener("click", async () => {
    const src = row.source;
    const v = parseFloat(zInp.value);
    if (!Number.isFinite(v) || v < 0 || v > 100) {
      ctx.toast("Height must be 0–100 m", true);
      return;
    }
    const ts = (TSP && ctx.state._calibTune) || null;
    if (ts && !TSP.tuneTryAcquire(ts)) {
      ctx.toast("A save is in progress — try again in a moment", true);
      return;
    }
    zBtn.disabled = true;
    try {
      const res = await ctx.actions.callWS({
        type: "padspan_ha/fabric_scanner_z_set",
        source: src, z_m: v,
      });
      if (res && res.ok === false) {
        ctx.toast("Save failed: height not stored", true);
        return;
      }
      try {
        const mdl = ctx.state.model || (ctx.state.model = {});
        const spm = mdl.scanner_positions_m || (mdl.scanner_positions_m = {});
        const prev = spm[src];
        spm[src] = { ...(prev && typeof prev === "object" ? prev : {}),
          z_m: Math.round(Math.max(0, Math.min(100, v)) * 100) / 100 };
      } catch (_e) { /* best-effort */ }
      ctx.toast(`${row.name}: height set to ${v} m`);
      if (ctx.actions.telemetryEvent) ctx.actions.telemetryEvent("receivers_page_edit");
      if (ts) ts._tuneRev = (ts._tuneRev || 0) + 1;
      if (ctx.actions.modelRefresh) await ctx.actions.modelRefresh();
    } catch (e) {
      ctx.toast("Save failed: height not stored", true);
    } finally {
      if (ts) TSP.tuneRelease(ts);
      zBtn.disabled = false;
    }
    ctx.actions.renderRooms();
  });
  return el("span", { class: "rx-edit" }, [zInp, zBtn]);
}

// Signal adjustment: Settings → Tracking → Receivers' manual offset, the
// same key, action and range.
function _offsetCell(ctx, el, row, editable) {
  const txt = `${row.offset > 0 ? "+" : ""}${row.offset} dB`;
  if (!editable) return el("span", { class: "rx-num" }, txt);
  const inp = el("input", { type: "number", min: String(OFFSET_MIN), max: String(OFFSET_MAX), step: "0.5", style: INPUT, "aria-label": `Signal adjustment (dB) for ${row.name}` });
  inp.value = String(row.offset);
  const btn = el("button", { class: "btn inline rx-save", title: "Added to every reading from this receiver: positive if it reads weaker than it should. Same value as Settings → Tracking → Receivers." }, "Save");
  btn.addEventListener("click", async () => {
    const v = Math.max(OFFSET_MIN, Math.min(OFFSET_MAX, parseFloat(inp.value) || 0));
    btn.disabled = true;
    try {
      await ctx.actions.scannerOffsetSet(row.source, v);
      ctx.toast(`${row.name}: manual offset set to ${v > 0 ? "+" : ""}${v} dB`);
      if (ctx.actions.telemetryEvent) ctx.actions.telemetryEvent("receivers_page_edit");
    } catch (e) {
      ctx.toast("Failed to save offset", true);
    } finally {
      btn.disabled = false;
    }
    ctx.actions.renderRooms();
  });
  return el("span", { class: "rx-edit" }, [inp, el("span", { class: "muted" }, "dB"), btn]);
}

const COLS = [
  ["name", "Receiver"], ["room", "Room"], ["floor", "Floor"], ["placed", "On a floor plan"],
  ["height", "Height"], ["offset", "Signal adjustment"], ["status", "Status"],
  ["devices", "Devices now"], ["heard", "Last heard"],
];

export function render(ctx) {
  const { el } = ctx.helpers;
  const root = el("section", { id: "receivers" });
  const st = ctx.state._receivers || (ctx.state._receivers = { sort: "name", dir: 1, problems: false });
  const phase = TSP ? TSP.tuneLivePhase(ctx.state) : (ctx.state.dataMode === "live" ? "live" : "sample");
  const editable = phase === "live";

  root.appendChild(el("div", { class: "card" }, [
    el("div", { style: "display:flex;align-items:center;gap:8px" }, [
      el("div", { class: "h2", style: "margin:0" }, "Receivers"),
      ctx.helpers.helpBtn ? ctx.helpers.helpBtn("receivers") : null,
    ].filter(Boolean)),
    el("div", { class: "muted", style: "font-size:12px;margin-top:4px;line-height:1.5" },
      "Every Bluetooth receiver PadSpan hears from, with its room, floor, height and signal adjustment in one place. " +
      "Height and signal adjustment save here and show everywhere else they appear. To move one on a floor plan, use Place."),
  ]));

  if (phase === "sample") {
    root.appendChild(el("div", { class: "card rx-note", "data-rx-note": "sample" },
      "Sample mode: these are the demo house's receivers, shown read-only. Switch to Live mode to see and edit yours."));
  } else if (phase === "waiting") {
    root.appendChild(el("div", { class: "card rx-note", "data-rx-note": "waiting" },
      "Waiting for live data from Home Assistant. Editing is available once it arrives."));
  }

  const rows = receiverRows(ctx.state);
  if (!rows.length) {
    root.appendChild(el("div", { class: "card", "data-rx-empty": "1" }, [
      el("div", { style: "font-weight:700;margin-bottom:4px" }, "No receivers yet"),
      el("div", { class: "muted", style: "font-size:12px;line-height:1.5" },
        phase === "waiting" ? "Receivers show here once the first live data arrives."
          : "PadSpan isn't hearing from any Bluetooth receiver. Add an ESPHome Bluetooth proxy (or another receiver) in Home Assistant, " +
            "and check that Home Assistant's Bluetooth integration is set up. They show here as soon as they report."),
    ]));
    return root;
  }

  const problemsN = rows.filter(r => r.status.level !== "ok").length;
  const shown = viewRows(rows, st);
  const filt = el("input", { type: "checkbox", id: "rxProblems", style: "width:16px;height:16px" });
  filt.checked = !!st.problems;
  filt.addEventListener("change", () => { st.problems = filt.checked; ctx.actions.renderRooms(); });
  const bar = el("div", { class: "rx-bar" }, [
    el("span", { class: "muted" }, `${rows.length} receiver${rows.length === 1 ? "" : "s"}` +
      (problemsN ? ` · ${problemsN} need${problemsN === 1 ? "s" : ""} attention` : " · all reporting normally")),
    el("label", { for: "rxProblems", class: "rx-filter" }, [filt, el("span", {}, "Problems only")]),
  ]);

  const head = el("tr", {}, COLS.map(([key, label]) => {
    const on = st.sort === key;
    const b = el("button", { class: "rx-sort" + (on ? " on" : ""), "data-sort": key,
      "aria-label": `Sort by ${label}`, title: `Sort by ${label}` }, label + (on ? (st.dir > 0 ? " ▴" : " ▾") : ""));
    b.addEventListener("click", () => {
      if (st.sort === key) st.dir = -st.dir; else { st.sort = key; st.dir = 1; }
      ctx.actions.renderRooms();
    });
    return el("th", { "aria-sort": on ? (st.dir > 0 ? "ascending" : "descending") : "none" }, b);
  }));

  const body = el("tbody", {});
  for (const r of shown) {
    const place = el("button", { class: "btn inline rx-place", "data-place": r.source,
      title: r.placed ? `On ${r.placed.mapName || "a floor plan"}. Opens Mapping with this receiver selected.` : "Opens Mapping to put this receiver on a floor plan." },
      r.placed ? "Move" : "Place");
    place.addEventListener("click", () => _openPlacement(ctx, r));
    const status = el("span", { class: "rx-status " + (r.status.level === "ok" ? "ok" : "warn"), title: r.status.title, "data-status": r.status.id }, [
      el("span", { class: "rx-dot", "aria-hidden": "true" }), r.status.label,
    ]);
    const ago = agoText(r.lastHeardS);
    const tr = el("tr", { "data-rx": r.source, class: r.status.level === "ok" ? "" : "rx-problem" }, [
      el("td", { "data-label": "Receiver" }, [
        el("div", { class: "rx-name" }, r.name),
        r.name !== r.source ? el("div", { class: "rx-src" }, r.source) : null,
      ].filter(Boolean)),
      el("td", { "data-label": "Room", title: r.areaName && r.areaName !== r.room ? `Home Assistant area: ${r.areaName}` : "" }, r.room || el("span", { class: "muted" }, "—")),
      el("td", { "data-label": "Floor" }, r.floor || el("span", { class: "muted" }, "—")),
      el("td", { "data-label": "On a floor plan" }, el("span", { class: "rx-edit" }, [
        el("span", { class: r.placed ? "" : "muted" }, r.placed ? "Yes" : "No"),
        editable ? place : null,
      ].filter(Boolean))),
      el("td", { "data-label": "Height" }, _heightCell(ctx, el, r, editable)),
      el("td", { "data-label": "Signal adjustment" }, _offsetCell(ctx, el, r, editable)),
      el("td", { "data-label": "Status" }, status),
      el("td", { "data-label": "Devices now", class: "rx-num", title: `Different devices heard in the last ${HEARD_NOW_S} seconds` }, String(r.devices)),
      el("td", { "data-label": "Last heard" }, ago || el("span", { class: "muted" }, r.devices ? "—" : "Not yet")),
    ]);
    body.appendChild(tr);
  }

  const card = el("div", { class: "card" }, [bar]);
  if (!shown.length) {
    card.appendChild(el("div", { class: "muted", style: "font-size:12px;padding:10px 2px", "data-rx-none": "1" },
      "No problems: every receiver is reporting normally."));
  } else {
    card.appendChild(el("div", { class: "table-wrap rx-wrap" },
      el("table", { class: "table rx-table" }, [el("thead", {}, head), body])));
  }
  root.appendChild(card);
  return root;
}
