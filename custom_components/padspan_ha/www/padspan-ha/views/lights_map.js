// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
// See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
//
// THE shared Lights view — data pipeline, map card (controls + iso SVG) and
// light index table used by BOTH the Lights sidebar panel and the
// Mapping → Lights tab. The sidebar DISPLAYS the house-lights representation;
// the Mapping tab BUILDS it — so the two must show the identical map: same
// maps, same rooms, same hexes, same codes, same controls, same table.
// Everything either view renders comes from here; the hosts differ only in
// what an interaction does (sidebar: control the light — tab: place it).

const { buildIsoSVG } =
  await import(`./iso_lights.js${new URL(import.meta.url).search}`);
const { assignLightCodes } =
  await import(`./light_codes.js${new URL(import.meta.url).search}`);

// ── Registry: entity_id → area name for every light ──────────────────────────
// One implementation with ONE staleness rule so the two views can never
// disagree about which room a light is in. `store` is a host-owned plain
// object ({reg, loading}); the map renders from the cached copy immediately
// and a background refresh (60s staleness) re-renders via onLoaded. The
// stale copy keeps serving while a refresh is in flight — the tab previously
// dropped every room assignment to "loading" placeholders during each
// refetch, so the two maps went visibly different for seconds at a time.
export function ensureLightsRegistry(store, hass, areas, onLoaded){
  const stale = !store.reg || Date.now() - store.reg.ts > 60000;
  if (stale && hass && !store.loading){
    store.loading = true;
    (async () => {
      try {
        // Multi-MB whole-house dump; bound it so a stale/half-open websocket
        // can't wedge `loading` true forever (both views already had this).
        const [reg, devReg] = await Promise.race([
          Promise.all([
            hass.callWS({ type: "config/entity_registry/list" }),
            hass.callWS({ type: "config/device_registry/list" }),
          ]),
          new Promise((_, rej) => setTimeout(() => rej(new Error("registry fetch timed out")), 30000)),
        ]);
        const areaIdToName = {};
        for (const a of (areas || [])) areaIdToName[a.id] = a.name;
        // device_id → area_id (entities commonly inherit area from device)
        const devAreaId = {};
        for (const d of (devReg || [])) if (d.area_id) devAreaId[d.id] = d.area_id;
        const areaMap = {};
        for (const e of (reg || [])) {
          if (!e.entity_id.startsWith("light.")) continue;
          const aid = e.area_id || devAreaId[e.device_id] || null;
          areaMap[e.entity_id] = aid ? (areaIdToName[aid] || null) : null;
        }
        store.reg = { ts: Date.now(), areaMap };
      } catch (_) {
        // Failed refresh: keep serving the previous copy (empty only if there
        // was never a successful fetch); stamp ts to back off the retry.
        store.reg = { ts: Date.now(), areaMap: store.reg ? store.reg.areaMap : {} };
      } finally {
        store.loading = false;
        if (onLoaded) onLoaded();
      }
    })();
  }
  return { areaMap: store.reg ? store.reg.areaMap : {}, loading: !store.reg };
}

// ── Light list: every light entity, canonical codes, display sort ────────────
export function gatherLights(states, areaMap){
  const lights = Object.keys(states || {})
    .filter(eid => eid.startsWith("light."))
    .map(eid => ({
      entity_id:     eid,
      friendly_name: states[eid].attributes?.friendly_name || eid,
      state:         states[eid].state,   // "on" | "off" | "unavailable"
      area_name:     areaMap[eid] || null,
      effect_list:   Array.isArray(states[eid].attributes?.effect_list) ? states[eid].attributes.effect_list : null,
    }))
    .sort((a, b) =>
      (a.area_name || "\xff").localeCompare(b.area_name || "\xff") ||
      a.friendly_name.localeCompare(b.friendly_name));
  assignLightCodes(lights);
  return lights;
}

// ── The map card: control row + iso map ──────────────────────────────────────
// host = {
//   el(tag,attrs,children)            DOM builder
//   maps                              visible maps to render (host pre-filters
//                                     hidden_map_ids; the tab substitutes its
//                                     unsaved drafts here)
//   floors, model, byRoom, hiddenEids, lightsByEid, lightsLoading
//   view                              live {floorGap, horizGap, focusIdx, zoom}
//                                     object owned by the host (persists across
//                                     host re-renders)
//   saveView() → Promise              persist floorGap/horizGap/focusIdx
//   onHexesBuilt(isoDiv, rebuild)     wire hex interactions after every build
// }
export function buildLightsMapCard(host){
  const { el, view } = host;
  const floors = host.floors || [];
  const mapCard = el("div", { class: "card", style: "padding:12px;margin-bottom:16px" });

  const sortedLevels = [...new Set(host.maps.map(m => m.stack?.z_level ?? 0))].sort((a, b) => a - b);

  // Focus positions: All, each floor, each adjacent pair
  const isoPos = [null];
  for (let fi = 0; fi < sortedLevels.length; fi++) {
    isoPos.push(sortedLevels[fi]);
    if (fi < sortedLevels.length - 1) isoPos.push([sortedLevels[fi], sortedLevels[fi + 1]]);
  }
  const getFocusZ = (idx) => isoPos[Math.max(0, Math.min(idx, isoPos.length - 1))];
  const getFocusLbl = (idx) => {
    const pos = getFocusZ(idx);
    if (pos === null) return "All floors";
    const zArr = Array.isArray(pos) ? pos : [pos];
    return zArr.map(z => { const f = floors.find(x => x.level === z); return f ? (f.name || `L${z}`) : `L${z}`; }).join(" + ");
  };
  view.focusIdx = Math.max(0, Math.min(view.focusIdx, isoPos.length - 1));

  const isoDiv = document.createElement("div");
  isoDiv.style.cssText = `overflow:auto;border-radius:8px;background:#071008;padding:8px;` +
    `width:${Math.round(view.zoom * 100)}%`;

  const rebuildISO = () => {
    isoDiv.style.width = `${Math.round(view.zoom * 100)}%`;
    isoDiv.innerHTML = buildIsoSVG(host.maps, host.byRoom, host.hiddenEids, getFocusZ(view.focusIdx),
      view.floorGap, view.horizGap, host.lightsByEid, host.lightsLoading, floors, host.model);
    host.onHexesBuilt(isoDiv, rebuildISO);
  };

  const ctrlRow = el("div", { style: "display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-bottom:8px" });

  // Floor focus slider
  if (sortedLevels.length > 1) {
    const focusLbl = el("span", { style: "font-size:12px;color:#94a3b8;min-width:80px" }, getFocusLbl(view.focusIdx));
    const focusSlider = document.createElement("input");
    focusSlider.type = "range"; focusSlider.min = "0"; focusSlider.max = String(isoPos.length - 1);
    focusSlider.style.cssText = "width:120px;accent-color:#52b788;vertical-align:middle;cursor:pointer";
    focusSlider.value = String(view.focusIdx);
    focusSlider.addEventListener("input", () => {
      view.focusIdx = parseInt(focusSlider.value, 10);
      focusLbl.textContent = getFocusLbl(view.focusIdx);
      rebuildISO();
    });
    ctrlRow.appendChild(el("span", { class: "muted", style: "font-size:11px;white-space:nowrap" }, "Floor:"));
    ctrlRow.appendChild(focusSlider);
    ctrlRow.appendChild(focusLbl);
  }

  // Floor gap slider
  const gapLbl = el("span", { style: "font-size:12px;color:#94a3b8;min-width:38px" }, String(view.floorGap));
  const gapSlider = document.createElement("input");
  gapSlider.type = "range"; gapSlider.min = "50"; gapSlider.max = "400"; gapSlider.step = "10";
  gapSlider.style.cssText = "width:100px;accent-color:#52b788;vertical-align:middle;cursor:pointer";
  gapSlider.value = String(view.floorGap);
  gapSlider.addEventListener("input", () => {
    view.floorGap = parseInt(gapSlider.value, 10);
    gapLbl.textContent = String(view.floorGap);
    rebuildISO();
  });
  ctrlRow.appendChild(el("span", { class: "muted", style: "font-size:11px;white-space:nowrap;margin-left:8px" }, "Spacing:"));
  ctrlRow.appendChild(gapSlider);
  ctrlRow.appendChild(gapLbl);

  // L/R horizontal offset slider
  const horizLbl = el("span", { style: "font-size:12px;color:#94a3b8;min-width:38px" }, String(view.horizGap));
  const horizSlider = document.createElement("input");
  horizSlider.type = "range"; horizSlider.min = "-120"; horizSlider.max = "120"; horizSlider.step = "10";
  horizSlider.style.cssText = "width:100px;accent-color:#52b788;vertical-align:middle;cursor:pointer";
  horizSlider.value = String(view.horizGap);
  horizSlider.addEventListener("input", () => {
    view.horizGap = parseInt(horizSlider.value, 10);
    horizLbl.textContent = String(view.horizGap);
    rebuildISO();
  });
  ctrlRow.appendChild(el("span", { class: "muted", style: "font-size:11px;white-space:nowrap;margin-left:8px" }, "L/R:"));
  ctrlRow.appendChild(horizSlider);
  ctrlRow.appendChild(horizLbl);

  // Save / Reset view buttons + status label
  const saveLbl = el("span", { style: "font-size:11px;color:#94a3b8;min-width:50px;display:inline-block" }, "");
  const saveBtn = el("button", { class: "btn inline", style: "margin-left:8px;font-size:12px;padding:2px 10px",
    onclick: async () => {
      saveBtn.disabled = true;
      try {
        await host.saveView();
        saveLbl.textContent = "Saved ✓";
        setTimeout(() => { saveLbl.textContent = ""; }, 2000);
      } catch (e) { saveLbl.textContent = "Error"; }
      saveBtn.disabled = false;
    },
  }, "Save view");
  const resetBtn = el("button", { class: "btn inline", style: "font-size:12px;padding:2px 10px",
    onclick: async () => {
      view.floorGap = 150; view.horizGap = 0; view.focusIdx = 0; view.zoom = 1.0;
      gapSlider.value = "150"; gapLbl.textContent = "150";
      horizSlider.value = "0"; horizLbl.textContent = "0";
      rebuildISO();
      resetBtn.disabled = true;
      try {
        await host.saveView();
        saveLbl.textContent = "Reset ✓";
        setTimeout(() => { saveLbl.textContent = ""; resetBtn.disabled = false; }, 2000);
      } catch (e) { saveLbl.textContent = "Error"; resetBtn.disabled = false; }
    },
  }, "Reset view");
  ctrlRow.appendChild(saveBtn);
  ctrlRow.appendChild(resetBtn);
  ctrlRow.appendChild(saveLbl);

  // Zoom controls
  ctrlRow.appendChild(el("span", { class: "muted", style: "font-size:11px;white-space:nowrap;margin-left:8px" }, "Zoom:"));
  ctrlRow.appendChild(el("button", { class: "btn inline", onclick: () => {
    view.zoom = Math.max(0.4, Math.round((view.zoom - 0.1) * 10) / 10);
    isoDiv.style.width = `${Math.round(view.zoom * 100)}%`;
  } }, "Zoom −"));
  ctrlRow.appendChild(el("button", { class: "btn inline", onclick: () => {
    view.zoom = 1.0; isoDiv.style.width = "100%";
  } }, "100%"));
  ctrlRow.appendChild(el("button", { class: "btn inline", onclick: () => {
    view.zoom = Math.min(2.5, Math.round((view.zoom + 0.1) * 10) / 10);
    isoDiv.style.width = `${Math.round(view.zoom * 100)}%`;
  } }, "Zoom +"));

  mapCard.appendChild(ctrlRow);
  mapCard.appendChild(isoDiv);
  rebuildISO();
  return mapCard;
}

// ── The light index table (+ unassigned/loading notice) ──────────────────────
// Extra host fields used here:
//   callWS(msg) → Promise             for the Assign-room dropdown
//   toast(msg, isError)
//   onRowClick(l)                     sidebar: toggle/WLED popup — tab: select
//   onToggleHidden(eid)               persist + re-render
//   afterAssign()                     invalidate registry cache + re-render
export function buildLightsTable(host, lights){
  const { el } = host;
  const hidden = host.hiddenEids;
  // The card wrapper lives HERE, not in the hosts — same objects AND same
  // layout in both views.
  const root = el("div", { class: "card", style: "padding:12px" });

  const unassigned = lights.filter(l => !l.area_name && !hidden.has(l.entity_id));
  if (host.lightsLoading) {
    root.appendChild(el("div", { class: "muted", style: "font-size:12px;margin-bottom:10px" }, "Loading room assignments…"));
  } else if (unassigned.length) {
    root.appendChild(el("div", { class: "muted", style: "font-size:12px;margin-bottom:10px" },
      `${unassigned.length} light(s) not assigned to a room — shown in index only.`));
  }

  const hiddenCount = lights.filter(l => hidden.has(l.entity_id)).length;
  root.appendChild(el("div", { style: "font-weight:700;font-size:13px;color:#e2e8f0;margin-bottom:6px" },
    `Light Index (${lights.length}${hiddenCount ? ` · ${hiddenCount} hidden from map` : ""})`));

  const tbl = el("table", { class: "table", style: "width:100%" });
  tbl.appendChild(el("thead", {}, el("tr", {}, [
    el("th", {}, "Code"),
    el("th", {}, "Light"),
    el("th", {}, "Room"),
    el("th", {}, "State"),
    el("th", { style: "width:60px;text-align:center" }, "Map"),
  ])));
  const tbody = el("tbody");
  for (const l of lights) {
    const on = l.state === "on";
    const isHidden = hidden.has(l.entity_id);
    const row = el("tr", { style: `cursor:pointer;opacity:${isHidden ? "0.45" : "1"}` }, [
      // W-series purple matches the WLED hex border — the at-a-glance type cue
      el("td", { style: `font-family:monospace;font-weight:700;color:${l.isWled ? "#c084fc" : "#52b788"};font-size:12px` }, l.code),
      el("td", {}, l.friendly_name),
      el("td", { class: "muted" }, l.area_name
        ? el("span", {}, l.area_name)
        : host.lightsLoading
        ? el("span", {}, "…")
        : (() => {
            const areas = host.model?.areas || [];
            if (!areas.length) return "—";
            const sel = document.createElement("select");
            sel.style.cssText = "background:#1a2e1e;color:#52b788;border:1px solid #2d4a36;border-radius:4px;padding:2px 6px;font-size:11px;cursor:pointer";
            sel.appendChild(el("option", { value: "" }, "Assign room…"));
            for (const a of [...areas].sort((x, y) => x.name.localeCompare(y.name))) {
              sel.appendChild(el("option", { value: a.id }, a.name));
            }
            sel.addEventListener("click", e => e.stopPropagation());
            sel.addEventListener("change", async () => {
              if (!sel.value) return;
              sel.disabled = true;
              try {
                await host.callWS({ type: "config/entity_registry/update", entity_id: l.entity_id, area_id: sel.value });
                host.toast(`Assigned ${l.friendly_name} to room`);
                host.afterAssign();
              } catch (e) {
                host.toast("Failed to assign room: " + (e.message || e), true);
                sel.disabled = false;
              }
            });
            return sel;
          })()
      ),
      el("td", {}, el("span", {
        style: `display:inline-block;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:700;` +
               `background:${on ? "#fbbf24" : "#374151"};color:${on ? "#111827" : "#fbbf24"}`,
      }, on ? "ON" : "OFF")),
      el("td", { style: "text-align:center" }, el("button", {
        class: "btn inline",
        style: `font-size:11px;padding:2px 6px${isHidden ? ";opacity:0.5" : ""}`,
        onclick: (e) => {
          e.stopPropagation();
          host.onToggleHidden(l.entity_id);
        },
      }, isHidden ? "Show" : "Hide")),
    ]);
    row.addEventListener("click", () => host.onRowClick(l));
    tbody.appendChild(row);
  }
  tbl.appendChild(tbody);
  root.appendChild(tbl);
  return root;
}
