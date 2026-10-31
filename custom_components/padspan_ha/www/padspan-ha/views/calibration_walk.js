// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
// See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html

// Calibration → Walk a room (setting calibration_room_walk, off by default;
// calibration.js only loads this file while it is on). Carry the device
// picked in Setup slowly around one room for WALK_S seconds; each poll keeps
// the device's fresh RSSI from every scanner (the same capture helpers Pin &
// Listen uses). The summary and the save are room_walk.py's; rooms come
// from the fabric (model room_geometry_m), never the photo. Nothing is
// stored until the person presses Save; Discard throws the walk away.

export const WALK_S = 90;
const POLL_MS = 1000;
const RING_R = 52;
const RING_C = 2 * Math.PI * RING_R;

// One poll's row: {source: rssi} for each scanner with a NEW sample.
export function walkRow(perRadio, lastMap, accept) {
  const row = {};
  for (const [src, info] of Object.entries(perRadio || {})) {
    if (accept(lastMap, src, info)) row[src] = info.rssi;
  }
  return row;
}

export function ringSvg(frac, label) {
  const off = RING_C * (1 - Math.max(0, Math.min(1, frac)));
  return `<svg viewBox="0 0 120 120" width="140" height="140" role="img" aria-label="${label}">` +
    `<circle cx="60" cy="60" r="${RING_R}" fill="none" stroke="#1b3526" stroke-width="10"/>` +
    `<circle cx="60" cy="60" r="${RING_R}" fill="none" stroke="#52b788" stroke-width="10" stroke-linecap="round" ` +
    `stroke-dasharray="${RING_C.toFixed(1)}" stroke-dashoffset="${off.toFixed(1)}" transform="rotate(-90 60 60)"/>` +
    `<text x="60" y="68" text-anchor="middle" font-size="26" font-weight="800" fill="#e2e8f0" font-family="monospace">${label}</text>` +
    `</svg>`;
}

const LOOKS = {
  distinct: (s) => `Stands out from ${s.nearest_room} (${s.gap_db} dB apart), the closest room.`,
  fair: (s) => `Somewhat like ${s.nearest_room} (${s.gap_db} dB apart). Fine, but a second walk can help.`,
  similar: (s) => `Reads much like ${s.nearest_room} (${s.gap_db} dB apart). The two may be hard to tell apart; walk closer to the walls and corners.`,
  unknown: () => "No other room has calibration yet to compare with.",
};

// Rooms of the fabric on this floor (any floor when the plan has none set).
export function walkRooms(geometry, floorId) {
  return Object.entries(geometry || {})
    .filter(([, g]) => g && (Array.isArray(g.points_m) ? g.points_m.length >= 3 : g.cx_m != null)
      && (!floorId || !g.floor_id || g.floor_id === floorId))
    .map(([r]) => r).sort();
}

// k-NN's held-out rooms-right, before vs after: as room_walk.change_word.
export function changeWord(before, after) {
  const b = before?.knn?.rooms_right_pc, a = after?.knn?.rooms_right_pc;
  if (typeof a !== "number" || typeof b !== "number") return null;
  return a - b >= 2 ? "up" : b - a >= 2 ? "down" : "same";
}

// The person left Calibration (or its Walk tab) mid-walk: the walk stops.
export function walkLeft(ctx, cs) {
  return ctx.state.view !== "calibration" || cs.tab !== "walk";
}

export function summaryText(s) {
  return `${s.samples} samples from ${s.scanners} scanner${s.scanners !== 1 ? "s" : ""} over ${s.polls} polls. ` +
    (LOOKS[s.looks] || LOOKS.unknown)(s);
}

export function renderWalk(ctx, el, cs, calData, h) {
  const wrap = el("div", { style: "display:flex;flex-direction:column;gap:14px" });
  const w = cs._walk || (cs._walk = { phase: "idle", room: "", polls: [] });

  if (!cs.deviceId || !cs.mapId) {
    wrap.appendChild(el("div", { class: "card", style: "border-color:#f59e0b" }, [
      el("div", { style: "font-size:13px;color:#f59e0b;font-weight:700" }, "Setup required"),
      el("div", { class: "muted", style: "font-size:12px;margin-top:4px" },
        "Pick the phone or tag you will carry, and the floor, in the Beacon and floor tab first."),
      el("button", { class: "btn", style: "margin-top:10px", onclick: () => { cs.tab = "setup"; ctx.actions.renderRooms(); } },
        "Go to Beacon and floor"),
    ]));
    return wrap;
  }
  const mapData = (ctx.state.maps?.list || []).find(m => m.id === cs.mapId) || {};
  const rooms = walkRooms(ctx.state.model?.room_geometry_m, mapData.floor_id);
  const pts = calData.points || [];
  const walked = (room) => pts.filter(p => p.source === "room_walk" && p.room === room).length;
  const card = el("div", { class: "card" });
  wrap.appendChild(card);
  card.appendChild(el("div", { class: "h2" }, ["Walk a room ", ctx.helpers.helpBtn("calibration_walk")]));

  if (w.phase === "walking") {
    card.appendChild(el("div", { style: "font-size:13px;color:#e2e8f0;text-align:center;font-weight:600" }, `Walking ${w.room}`));
    const ring = el("div", { style: "display:flex;justify-content:center;margin:8px 0" });
    ring.innerHTML = ringSvg(0, String(WALK_S));
    w._ringEl = ring;
    card.appendChild(ring);
    const count = el("div", { style: "font-size:11px;text-align:center;color:#78909c;font-family:monospace" }, "…");
    w._countEl = count;
    card.appendChild(count);
    card.appendChild(el("ul", { style: "font-size:12px;color:#94a3b8;line-height:1.6;margin:10px 0 0 18px;padding:0" }, [
      el("li", {}, "Hold the phone as you usually carry it (pocket, hand or bag)."),
      el("li", {}, "Walk slowly along the walls and into each corner, then through the middle."),
      el("li", {}, "Stay in this room until the ring is full."),
    ]));
    const stop = el("button", { class: "btn inline", style: "margin-top:12px;width:100%" }, "Cancel & discard");
    stop.addEventListener("click", () => { w.stop = true; cs._walk = { phase: "idle", room: w.room, polls: [] }; ctx.actions.renderRooms(); });
    card.appendChild(stop);
    return wrap;
  }

  if (w.phase === "summary" && w.summary) {
    const s = w.summary;
    card.appendChild(el("div", { style: "font-size:13px;color:#e2e8f0;font-weight:600" }, `${w.room}: walk complete`));
    card.appendChild(el("div", { style: "font-size:12px;color:#94a3b8;margin-top:6px;line-height:1.5" }, summaryText(s)));
    const ho = h.heldoutLine(el, calData.heldout);
    if (ho) card.appendChild(ho);
    if (!s.enough) {
      card.appendChild(el("div", { style: "font-size:12px;color:#f59e0b;margin-top:8px" },
        "Too little was heard to save. Check the device is on and near the scanners, then walk again."));
    }
    if (s.previous_walk_points) {
      card.appendChild(el("div", { style: "font-size:12px;color:#f59e0b;margin-top:8px" },
        `${w.room} already has a walk. Saving replaces that walk only; other calibration points stay as they are.`));
    }
    const row = el("div", { style: "display:flex;gap:8px;margin-top:12px" });
    if (s.enough) {
      const save = el("button", { class: "btn save-pulse", style: "flex:1" }, "Save this walk?");
      save.addEventListener("click", async () => {
        const replace = !!s.previous_walk_points;
        if (replace && !confirm(`Replace the earlier walk of ${w.room}?`)) return;
        save.disabled = true;
        save.textContent = "Saving and re-testing…";
        try {
          const r = await ctx.actions.wsCall("padspan_ha/calibration_room_walk_save", {
            room: w.room, map_id: cs.mapId, device_id: cs.deviceId || "", duration_s: WALK_S,
            polls: w.polls, replace,
          });
          ctx.state.calibration = await ctx.actions.calibrationGet();
          cs._walk = { phase: "saved", room: w.room, polls: [], result: r };
          ctx.toast(`Walk saved: ${r.added} points for ${w.room}.`);
          _awaitAfter(ctx, cs._walk);
        } catch (e) {
          ctx.toast("Save failed: " + (e && (e.message || e.code) || String(e)), true);
          save.disabled = false;
          save.textContent = "Save this walk?";
          return;
        }
        ctx.actions.renderRooms();
      });
      row.appendChild(save);
    }
    const discard = el("button", { class: "btn inline", style: "flex:1" }, "Discard");
    discard.addEventListener("click", () => { cs._walk = { phase: "idle", room: w.room, polls: [] }; ctx.actions.renderRooms(); });
    row.appendChild(discard);
    card.appendChild(row);
    return wrap;
  }

  if (w.phase === "saved" && w.result) {
    const r = w.result;
    card.appendChild(el("div", { style: "font-size:13px;color:#52b788;font-weight:700" },
      `✓ ${w.room}: ${r.added} points saved` + (r.replaced ? ` (replaced ${r.replaced} from the earlier walk)` : "")));
    const b = h.heldoutLine(el, r.heldout_before), a = h.heldoutLine(el, w.after);
    if (b) { b.textContent = "Before: " + b.textContent; card.appendChild(b); }
    if (a) { a.textContent = "After: " + a.textContent; card.appendChild(a); }
    else card.appendChild(el("div", { class: "muted", style: "font-size:12px;margin-top:10px" },
      w.afterGaveUp ? "Still working on the new score. Calibration → Model shows it once it is ready."
        : "Re-testing with the walk in…"));
    const chg = changeWord(r.heldout_before, w.after);
    if (chg) {
      card.appendChild(el("div", { class: "muted", style: "font-size:12px;margin-top:6px" },
        chg === "up" ? "Fingerprints got more rooms right." : chg === "down"
          ? "Fingerprints got fewer rooms right. Walk the room again, or remove the walk." : "About the same as before."));
    }
    card.appendChild(el("button", { class: "btn", style: "margin-top:12px",
      onclick: () => { cs._walk = { phase: "idle", room: "", polls: [] }; ctx.actions.renderRooms(); } }, "Walk another room"));
    return wrap;
  }

  // Idle: pick the room and start.
  card.appendChild(el("div", { class: "muted", style: "font-size:12px;line-height:1.5;margin-bottom:10px" },
    `Carrying ${cs.deviceLabel || cs.deviceId}. Pick a room, press Start and walk slowly around it for ${WALK_S} seconds. ` +
    "PadSpan listens to every scanner while you walk, then shows what it heard before anything is saved."));
  if (!rooms.length) {
    card.appendChild(el("div", { style: "font-size:12px;color:#f59e0b" }, "This floor has no rooms drawn yet. Draw them in Mapping first."));
    return wrap;
  }
  const sel = el("select", { style: "width:100%;margin-bottom:10px" });
  sel.appendChild(el("option", { value: "" }, "Choose a room…"));
  for (const r of rooms) {
    const o = el("option", { value: r }, walked(r) ? `${r} (walked)` : r);
    if (r === w.room) o.selected = true;
    sel.appendChild(o);
  }
  sel.addEventListener("change", () => { w.room = sel.value; ctx.actions.renderRooms(); });
  card.appendChild(sel);
  const start = el("button", { class: "btn", style: "width:100%" }, "Start walking");
  start.disabled = !w.room;
  start.addEventListener("click", () => _start(ctx, cs, h));
  card.appendChild(start);
  if (w.room && walked(w.room)) {
    const rm = el("button", { class: "btn inline", style: "width:100%;margin-top:8px" }, `Remove the walk of ${w.room}`);
    rm.addEventListener("click", async () => {
      if (!confirm(`Remove the walk of ${w.room}? Only its walk points go; other calibration points stay.`)) return;
      try {
        const r = await ctx.actions.wsCall("padspan_ha/calibration_room_walk_remove", { room: w.room });
        ctx.state.calibration = await ctx.actions.calibrationGet();
        ctx.toast(`Removed ${r.removed} walk points from ${w.room}.`);
      } catch (e) { ctx.toast("Remove failed: " + (e && (e.message || e.code) || String(e)), true); }
      ctx.actions.renderRooms();
    });
    card.appendChild(rm);
  }
  return wrap;
}

// A held-out result that covers the save: stamped with the save's seq or
// later (a run already going when the walk was saved does not count).
export function coversSave(ho, seq) {
  return !!ho && typeof ho.seq === "number" && typeof seq === "number" && ho.seq >= seq;
}

// The re-test runs in the background (heldout_rerun); look again a few
// times for a result that covers the save, never holding anything up.
function _awaitAfter(ctx, w) {
  const seq = w.result && w.result.heldout_seq;
  let tries = 0;
  const look = async () => {
    if (ctx.state._calib?._walk !== w) return;
    tries++;
    try {
      const d = await ctx.actions.calibrationGet();
      ctx.state.calibration = d;
      const ho = d && d.heldout;
      if (coversSave(ho, seq)) w.after = ho;
    } catch (_) { /**/ }
    if (!w.after && tries >= 12) w.afterGaveUp = true;
    if (!w.after && !w.afterGaveUp) setTimeout(look, 5000);
    ctx.actions.renderRooms();
  };
  setTimeout(look, 3000);
}

function _start(ctx, cs, h) {
  if (h.phase(ctx.state) !== "live") {
    ctx.toast("Switch to Live mode, with live data from Home Assistant, to walk a room.", true);
    return;
  }
  const w = cs._walk;
  Object.assign(w, { phase: "walking", polls: [], last: {}, ticks: 0, stop: false, summary: null });
  const endAt = Date.now() + WALK_S * 1000;
  ctx.actions.renderRooms();
  const loop = async () => {
    if (w.stop || cs._walk !== w) return;
    if (walkLeft(ctx, cs)) { w.stop = true; cs._walk = { phase: "idle", room: w.room, polls: [] }; return; }
    try { await ctx.actions.refreshSnapshot(); } catch (_) { /**/ }
    if (w.stop || cs._walk !== w) return;
    w.ticks++;
    const row = walkRow(h.findAds(h.snap(ctx), cs.deviceId).perRadio, w.last, h.accept);
    if (Object.keys(row).length) w.polls.push(row);
    const left = Math.max(0, Math.ceil((endAt - Date.now()) / 1000));
    if (w._ringEl) w._ringEl.innerHTML = ringSvg(1 - left / WALK_S, String(left));
    if (w._countEl) w._countEl.textContent = `Poll #${w.ticks} · ${w.polls.length} with fresh readings`;
    if (Date.now() < endAt) { setTimeout(loop, Math.min(POLL_MS, endAt - Date.now())); return; }
    try {
      w.summary = await ctx.actions.wsCall("padspan_ha/calibration_room_walk_preview", { room: w.room, polls: w.polls });
      w.phase = "summary";
    } catch (e) {
      ctx.toast("Could not read the walk: " + (e && (e.message || e.code) || String(e)), true);
      w.phase = "idle";
    }
    ctx.actions.renderRooms();
  };
  loop();
}
