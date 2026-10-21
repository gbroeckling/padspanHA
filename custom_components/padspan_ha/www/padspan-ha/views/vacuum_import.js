// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
// See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
//
// "Import from a robot vacuum" (vacuum_import.py, ws_vacuum.py), beside the
// Sweet Home 3D import on the Mapping tab's Rooms card. Closed until clicked.
//
//   import   a Valetudo map file, the robot's Valetudo address, or its map
//            camera → a preview (picture, size, rooms) → "Add as a new map".
//            The commit adds a NEW map and only rooms PadSpan does not have.
//   live     after an import from a camera or address: show the robot on the
//            maps (off until ticked)
//   walker   a BLE tag riding on the robot: spots it stood still on wait in
//            a review pile; nothing goes into calibration until accepted here
//
// Its state lives on ctx.state._vacuumImport so the Rooms card can redraw
// around it without losing a preview.

function S(ctx){
  if (!ctx.state._vacuumImport) ctx.state._vacuumImport = { open: false, preview: null, status: null, pending: null, busy: false };
  return ctx.state._vacuumImport;
}

async function refresh(ctx){
  const st = S(ctx);
  try {
    st.status = await ctx.actions.wsCall("padspan_ha/vacuum_status", {});
    st.pending = st.status.pending ? (await ctx.actions.wsCall("padspan_ha/vacuum_cal_pending_list", {})).pending : [];
  } catch (err) { st.status = { error: String(err.message || err) }; }
  ctx.actions.renderRooms();
}

function cameras(ctx){
  const ids = Object.keys((ctx.hass && ctx.hass.states) || {}).filter(e => e.startsWith("camera."));
  return ids.sort((a, b) => (b.includes("map") - a.includes("map")) || a.localeCompare(b));
}

/** The row and, once opened, its panel. floorId: the Rooms card's floor. */
export function vacuumImportBlock(ctx, floorId){
  const { el } = ctx.helpers;
  const st = S(ctx);
  const wrap = el("div", { class: "vacuum-import", style: "margin-bottom:4px" });
  const row = el("div", { style: "display:flex;align-items:center;gap:8px;flex-wrap:wrap" });
  row.appendChild(el("button", { class: "btn inline" + (st.open ? " primary" : ""),
    onclick: () => { st.open = !st.open; if (st.open && !st.status) refresh(ctx); else ctx.actions.renderRooms(); } },
    "🤖 Import from a robot vacuum"));
  row.appendChild(el("span", { class: "muted", style: "font-size:11px" },
    "Valetudo, Dreame or Xiaomi map → a new floor plan with its rooms. Rooms you already have are kept."));
  wrap.appendChild(row);
  if (!st.open) return wrap;

  const box = el("div", { style: "border:1px solid rgba(255,255,255,0.12);border-radius:8px;padding:8px;margin-top:6px;display:flex;flex-direction:column;gap:6px" });
  const run = async (args) => {
    st.busy = true; ctx.actions.renderRooms();
    try {
      st.preview = await ctx.actions.wsCall("padspan_ha/vacuum_import_preview", args);
    } catch (err) {
      st.preview = null;
      ctx.toast("Robot map: " + (err.message || err), true);
    }
    st.busy = false; ctx.actions.renderRooms();
  };

  // ── where the map comes from ──
  const src = el("div", { style: "display:flex;gap:6px;flex-wrap:wrap;align-items:center" });
  const file = document.createElement("input");
  file.type = "file"; file.accept = ".json,application/json"; file.style.display = "none";
  file.addEventListener("change", async () => {
    const f = file.files && file.files[0];
    file.value = "";
    if (f) run({ json_text: await f.text() });
  });
  src.appendChild(file);
  src.appendChild(el("button", { class: "btn inline", onclick: () => file.click() }, "Map file (.json)"));
  const url = el("input", { type: "text", placeholder: "Valetudo address, e.g. http://valetudo.local", style: "min-width:220px;font-size:12px" });
  src.appendChild(url);
  src.appendChild(el("button", { class: "btn inline", onclick: () => url.value.trim() && run({ url: url.value.trim() }) }, "Read"));
  const cam = el("select", { style: "font-size:12px;max-width:240px" });
  cam.appendChild(el("option", { value: "" }, "…or its map camera"));
  for (const id of cameras(ctx)) cam.appendChild(el("option", { value: id }, id));
  src.appendChild(cam);
  src.appendChild(el("button", { class: "btn inline", onclick: () => cam.value && run({ entity_id: cam.value }) }, "Read camera"));
  box.appendChild(src);
  if (st.busy) box.appendChild(el("span", { class: "muted", style: "font-size:11px" }, "Reading…"));

  // ── the preview ──
  const p = st.preview;
  if (p) {
    const pv = el("div", { style: "display:flex;gap:10px;flex-wrap:wrap;align-items:flex-start" });
    pv.appendChild(el("img", { src: "data:image/png;base64," + p.png_base64, alt: "Robot map",
      style: "max-width:260px;max-height:200px;border-radius:4px;background:#fff" }));
    const info = el("div", { style: "display:flex;flex-direction:column;gap:4px;font-size:12px" });
    info.appendChild(el("div", {}, `${p.scale_x_m.toFixed(1)} × ${p.scale_y_m.toFixed(1)} m · ${p.rooms.length} room${p.rooms.length === 1 ? "" : "s"}${p.dock ? " · dock found" : ""}`));
    if (p.rooms.length) info.appendChild(el("div", { class: "muted" }, p.rooms.map(r => r.name).join(", ")));
    if (p.warnings.length) info.appendChild(el("div", { class: "muted", style: "font-size:11px" }, "Notes: " + p.warnings.join(" · ")));
    const name = el("input", { type: "text", value: "Robot vacuum map", style: "font-size:12px" });
    const rooms = el("input", { type: "checkbox" }); rooms.checked = true;
    info.appendChild(name);
    info.appendChild(el("label", { style: "font-size:11px" }, [rooms, " Add its rooms (any room PadSpan already has is skipped)"]));
    info.appendChild(el("button", { class: "btn inline primary", onclick: async (e) => {
      e.currentTarget.disabled = true;
      try {
        const r = await ctx.actions.wsCall("padspan_ha/vacuum_import_commit",
          { floor_id: floorId, name: name.value.trim() || "Robot vacuum map", include_rooms: rooms.checked });
        ctx.toast(`✔ Robot map added — ${r.rooms_added.length} room(s) added` +
          (r.rooms_skipped.length ? `, ${r.rooms_skipped.length} already there (kept)` : ""));
        st.preview = null;
        await ctx.actions.mapsRefresh();
        await ctx.actions.modelRefresh();
        await refresh(ctx);
      } catch (err) { ctx.toast("Import failed: " + (err.message || err), true); ctx.actions.renderRooms(); }
    } }, `Add as a new map on "${floorId}"`));
    info.appendChild(el("span", { class: "muted", style: "font-size:11px" },
      "It is placed at the house's origin — line it up with your other plans in 3D Stack if you have them."));
    pv.appendChild(info);
    box.appendChild(pv);
  }

  // ── the link and the walker ──
  const s = st.status;
  const lk = s && s.link;
  if (lk) {
    const set = async (args) => {
      try { st.status = await ctx.actions.wsCall("padspan_ha/vacuum_link_set", args); }
      catch (err) { ctx.toast(String(err.message || err), true); }
      refresh(ctx);
    };
    const live = el("input", { type: "checkbox", onchange: (e) => set({ enabled: e.currentTarget.checked }) });
    live.checked = !!lk.enabled;
    box.appendChild(el("label", { style: "font-size:12px" }, [live, " Show the robot live on the maps (read every 10 s from ",
      el("code", {}, lk.ref || "?"), ")"]));
    if (s.live) box.appendChild(el("span", { class: "muted", style: "font-size:11px" },
      `Robot now at ${s.live.x_m.toFixed(1)}, ${s.live.y_m.toFixed(1)} m on ${s.live.floor_id}`));
    const wk = s.walker || {};
    const tag = el("input", { type: "text", placeholder: "Tag address on the robot (AA:BB:…)", value: wk.tag || "", style: "font-size:12px;min-width:200px" });
    const walk = el("input", { type: "checkbox", onchange: (e) => set({ walker_enabled: e.currentTarget.checked, walker_tag: tag.value.trim() }) });
    walk.checked = !!wk.enabled;
    walk.disabled = !lk.enabled;
    box.appendChild(el("div", { style: "display:flex;gap:6px;align-items:center;flex-wrap:wrap;font-size:12px" },
      [el("label", {}, [walk, " Collect calibration candidates from a tag riding on the robot"]), tag]));
    box.appendChild(el("span", { class: "muted", style: "font-size:11px" },
      "Where the robot stands still, the tag's readings wait here. Nothing goes into calibration until you accept it."));
    const pend = st.pending || [];
    if (pend.length) {
      const list = el("div", { style: "display:flex;flex-direction:column;gap:3px;max-height:180px;overflow:auto;font-size:11px" });
      for (const pt of pend) {
        list.appendChild(el("div", { style: "display:flex;gap:6px;align-items:center" }, [
          el("span", {}, `${pt.x_m.toFixed(2)}, ${pt.y_m.toFixed(2)} m · ${pt.floor_id} · ${(pt.scanner_readings || []).length} scanners · ${String(pt.collected_at || "").slice(0, 16).replace("T", " ")}`),
          el("button", { class: "btn inline", onclick: async () => {
            try { await ctx.actions.wsCall("padspan_ha/vacuum_cal_pending_accept", { point_id: pt.id }); ctx.toast("Added to calibration"); }
            catch (err) { ctx.toast("Not added: " + (err.message || err), true); }
            refresh(ctx);
          } }, "Accept"),
          el("button", { class: "btn inline", onclick: async () => {
            await ctx.actions.wsCall("padspan_ha/vacuum_cal_pending_reject", { point_id: pt.id }); refresh(ctx);
          } }, "Reject"),
        ]));
      }
      box.appendChild(el("div", { style: "font-size:12px" }, `${pend.length} candidate point${pend.length === 1 ? "" : "s"} waiting for review`));
      box.appendChild(list);
      box.appendChild(el("button", { class: "btn inline", style: "align-self:flex-start", onclick: async () => {
        if (!confirm(`Reject all ${pend.length} candidate points? Calibration is not touched.`)) return;
        await ctx.actions.wsCall("padspan_ha/vacuum_cal_pending_reject", { all: true }); refresh(ctx);
      } }, "Reject all"));
    }
    box.appendChild(el("button", { class: "btn inline", style: "align-self:flex-start", onclick: () => {
      if (confirm("Unlink the robot? The imported map and rooms stay; the pending points stay too.")) set({ unlink: true, enabled: false, walker_enabled: false });
    } }, "Unlink robot"));
  } else if (s && s.error) {
    box.appendChild(el("span", { class: "muted", style: "font-size:11px" }, s.error));
  }
  wrap.appendChild(box);
  return wrap;
}
