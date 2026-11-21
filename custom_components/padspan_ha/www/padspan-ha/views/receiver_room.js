// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
// See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
//
// Pick a receiver's room right where PadSpan says it has none (2026-11-21): Who's where's "no Home Assistant area"
// line and Setup's receivers step. A receiver's room is its Home Assistant device's area (or the area of the device it
// belongs to): what the snapshot's radios carry (area_name), what the engine's nearest-receiver room, "Put my
// receivers in their rooms" and Who's where all read. It is written the one way PadSpan already writes it,
// padspan_ha/radio_area_set (the Bluetooth Radios list's Assign Area), into Home Assistant's device registry. A
// receiver with no room has no device area to start from, so the choice starts on a guess from its name
// ("esp32-kitchen" → Kitchen, the longest area name that fits first), else on nothing.

const { t } = await import(`./i18n.js${new URL(import.meta.url).search}`);

const _flat = (s) => String(s || "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "");
const _compact = (s) => _flat(s).replace(/[^a-z0-9]/g, "");
const _words = (s) => _flat(s).split(/[^a-z0-9]+/).filter(Boolean);

/** The Home Assistant area a receiver's name points to, or "": an area whose name is whole words of the receiver's
 *  display name, name or source ("living_room_proxy", "livingroom-ble" → Living Room; "garden_proxy" is not Den),
 *  else one the name starts or ends with ("kitchenproxy"); the longest area name first. */
export function guessArea(radio, areas) {
  const names = [radio && radio.display_name, radio && radio.name, radio && radio.source].filter(Boolean);
  const runs = new Set(), flat = names.map(_compact);
  for (const n of names) {
    const w = _words(n);
    for (let i = 0; i < w.length; i++) for (let j = i + 1; j <= w.length; j++) runs.add(w.slice(i, j).join(""));
  }
  const cand = [...new Set((areas || []).filter(a => typeof a === "string" && _compact(a).length >= 3))]
    .sort((a, b) => _compact(b).length - _compact(a).length);
  return cand.find(a => runs.has(_compact(a)))
    || cand.find(a => _compact(a).length >= 4 && flat.some(f => f !== _compact(a) && (f.startsWith(_compact(a)) || f.endsWith(_compact(a)))))
    || "";
}

/** Whether this person may set a receiver's room here: on the house's own data, never on a wall screen, and with
 *  Enhanced security on only an administrator (as Who's where's Track). */
export function canSetRooms(ctx) {
  const st = ctx.state;
  return st.dataMode === "live" && !st.kioskMode && !!(ctx.actions && ctx.actions.radioAreaSet)
    && !(st.settings && st.settings.enhanced_security === true && ctx.hass && ctx.hass.user && ctx.hass.user.is_admin === false);
}

/** The house's Home Assistant areas, by name: the snapshot's (rooms_discovered), else the model's. */
export function areaNames(state) {
  const snap = state.live && state.live.snapshot;
  const fromSnap = snap && Array.isArray(snap.rooms_discovered) ? snap.rooms_discovered : [];
  const names = fromSnap.length ? fromSnap : ((state.model && state.model.areas) || []).map(a => a && a.name);
  return [...new Set(names.filter(n => typeof n === "string" && n))].sort((a, b) => a.localeCompare(b));
}

/** One receiver's room, written as the Bluetooth Radios list's Assign Area writes it; the snapshot read again after. */
export async function setReceiverRoom(ctx, radio, area) {
  const payload = { area_name: area };
  if (radio.device_id) payload.device_id = radio.device_id;
  else payload.source = radio.source;
  await ctx.actions.radioAreaSet(payload);
  if (ctx.actions.refreshSnapshot) await Promise.resolve(ctx.actions.refreshSnapshot()).catch(() => {});
}

// Rooms set on this page, so a row says so until the snapshot (and the server's answers) have caught up.
const _set = new Map();
export function _resetRooms() { _set.clear(); }   // a test's new page

/** A row per receiver: its name, the house's areas (the guess chosen), Set room, and what happened. `radios`:
 *  [{source, name, display_name, device_id}]. `onSet(radio, area)` after a room is set (the caller asks again what
 *  it shows). null when this person can't set rooms here, or there is no receiver to show. */
export function roomPickers(ctx, radios, onSet) {
  if (!canSetRooms(ctx) || !(radios || []).length) return null;
  const { el } = ctx.helpers;
  const areas = areaNames(ctx.state);
  const box = el("div", { "data-receiver-room": "list", style: "display:flex;flex-direction:column;gap:6px;margin:6px 0" });
  if (!areas.length) {
    box.appendChild(el("div", { "data-receiver-room": "no-areas", style: "font-size:12px;color:#fbbf24" },
      t("Home Assistant has no areas yet. Add them there first: Settings → Areas, labels & zones.")));
    return box;
  }
  for (const r of radios) {
    const name = String(r.display_name || r.name || r.source || "");
    const row = el("div", { "data-receiver-room": r.source, style: "display:flex;align-items:center;gap:6px;flex-wrap:wrap;font-size:12px" });
    row.appendChild(el("span", { style: "font-weight:600;color:#e2e8f0;min-width:0;overflow-wrap:anywhere" }, name));
    const done = _set.get(r.source);
    if (done) {
      row.appendChild(el("span", { "data-receiver-room-said": "", style: "color:#a7f3d0" }, "✓ " + t("Room set: {room}.", { room: done })));
      box.appendChild(row);
      continue;
    }
    const guess = guessArea(r, areas);
    const sel = el("select", { class: "select", "data-receiver-room-pick": r.source, "aria-label": t("Room for {receiver}", { receiver: name }), style: "font-size:12px;max-width:100%" });
    sel.appendChild(el("option", { value: "" }, t("Choose a room…")));
    for (const a of areas) {
      const o = el("option", { value: a }, a);
      if (a === guess) o.setAttribute("selected", "");
      sel.appendChild(o);
    }
    if (guess) sel.value = guess;
    const go = el("button", { class: "btn inline", "data-receiver-room-set": r.source, style: "font-size:12px" }, t("Set room"));
    const said = el("span", { style: "color:#94a3b8;flex:1 1 100%;min-width:0" }, guess ? t("Chosen from its name; change it if it's wrong.") : "");
    go.disabled = !sel.value;
    sel.addEventListener("change", () => { go.disabled = !sel.value; said.textContent = ""; });
    go.addEventListener("click", async () => {
      const area = sel.value;
      if (!area) return;
      go.disabled = true; sel.disabled = true;
      said.style.color = "#94a3b8"; said.textContent = t("Saving...");
      try {
        await setReceiverRoom(ctx, r, area);
        _set.set(r.source, area);
        said.style.color = "#a7f3d0"; said.textContent = "✓ " + t("Room set: {room}.", { room: area });
        if (ctx.toast) ctx.toast(t("{receiver} is in {room} now.", { receiver: name, room: area }));
        if (onSet) onSet(r, area); else if (ctx.actions.renderRooms) ctx.actions.renderRooms();
      } catch (e) {
        // The server's own words: radio_area_set names the two devices when a receiver's name matches more than one.
        said.style.color = "#f87171";
        said.textContent = String((e && e.message) || t("That didn't work. Try again in a moment."));
        go.disabled = false; sel.disabled = false;
      }
    });
    row.appendChild(sel);
    row.appendChild(go);
    row.appendChild(said);
    box.appendChild(row);
  }
  return box;
}

// ── "Signals say this receiver is in X" (2026-11-21) ──────────────────────────────────────────────────────────────
// Once there are calibration points: each one holds the room it was taken in (point.room) and what every receiver
// heard there (scanner_readings[].mean_rssi). A receiver hears the spots nearest it best, so where most of its
// strongest-heard points are in one other room, that room is suggested, one tap to accept (the same write as above).
// Only where its own room has points of its own too: a room nobody calibrated in can't be told from the next one.
export const SIGNAL_TOP = 5;        // its strongest-heard points looked at
export const SIGNAL_MIN = 3;        // points it must have heard, with a room
export const SIGNAL_MOST = 0.6;     // "mostly": this share of them in the one other room
const _fold = (s) => String(s || "").trim().toLowerCase();

/** [{source, name, display_name, device_id, now, room, n, of}]: each receiver the points say is in another of the
 *  house's areas (`areas`, by name) than its own (`radios`' area_name). Lost and disabled receivers are left out. */
export function signalRooms(points, radios, areas) {
  const byName = new Map((areas || []).filter(a => typeof a === "string" && a).map(a => [_fold(a), a]));
  const pts = (Array.isArray(points) ? points : []).filter(p => p && typeof p === "object" && _fold(p.room));
  const perRoom = new Map();
  for (const p of pts) perRoom.set(_fold(p.room), (perRoom.get(_fold(p.room)) || 0) + 1);
  const out = [];
  for (const r of radios || []) {
    const now = r && typeof r.area_name === "string" ? r.area_name : "";
    if (!r || !r.source || !now || r.lost || r.disabled || (perRoom.get(_fold(now)) || 0) < 2) continue;
    const heard = [];
    for (const p of pts) {
      const rd = (Array.isArray(p.scanner_readings) ? p.scanner_readings : []).find(x => x && x.source === r.source);
      const v = rd ? Number(rd.mean_rssi) : NaN;
      if (Number.isFinite(v)) heard.push({ room: _fold(p.room), v });
    }
    if (heard.length < SIGNAL_MIN) continue;
    const top = heard.sort((a, b) => b.v - a.v).slice(0, SIGNAL_TOP);
    const count = new Map();
    for (const h of top) count.set(h.room, (count.get(h.room) || 0) + 1);
    const [best, n] = [...count.entries()].sort((a, b) => b[1] - a[1])[0];
    if (best === _fold(now) || n / top.length < SIGNAL_MOST || !byName.has(best)) continue;
    out.push({ source: r.source, name: r.name, display_name: r.display_name, device_id: r.device_id, now, room: byName.get(best), n, of: top.length });
  }
  return out;
}

const _kept = new Set();   // "Keep …" pressed on this page: not suggested again until the next load
export function _resetSignals() { _kept.clear(); }

/** The suggestions, each "Use {room}" and "Keep {now}"; null when there are none or this person can't set rooms. */
export function signalLines(ctx, onSet) {
  if (!canSetRooms(ctx)) return null;
  const st = ctx.state, snap = st.live && st.live.snapshot;
  const radios = (snap && snap.ble && Array.isArray(snap.ble.radios)) ? snap.ble.radios : [];
  const list = signalRooms(st.calibration && st.calibration.points, radios, areaNames(st)).filter(s => !_kept.has(s.source + "|" + s.room));
  if (!list.length) return null;
  const { el } = ctx.helpers;
  const box = el("div", { "data-receiver-signals": "list", style: "display:flex;flex-direction:column;gap:6px;margin:6px 0" });
  for (const s of list) {
    const name = String(s.display_name || s.name || s.source);
    const row = el("div", { "data-receiver-signals": s.source, style: "display:flex;align-items:center;gap:6px;flex-wrap:wrap;font-size:12px;color:#cbd5e1" });
    const done = _set.get(s.source);
    if (done) {
      row.appendChild(el("span", { style: "color:#a7f3d0" }, "✓ " + t("{receiver} is in {room} now.", { receiver: name, room: done })));
      box.appendChild(row);
      continue;
    }
    row.appendChild(el("span", { style: "flex:1 1 220px;min-width:0" },
      t("Signals say {receiver} is in {room}, not {now}: {n} of the {of} calibration points it hears best are there.", { receiver: name, room: s.room, now: s.now, n: s.n, of: s.of })));
    const use = el("button", { class: "btn inline primary", "data-receiver-signals-use": s.source, style: "font-size:12px" }, t("Use {room}", { room: s.room }));
    const keep = el("button", { class: "btn inline", "data-receiver-signals-keep": s.source, style: "font-size:12px" }, t("Keep {room}", { room: s.now }));
    const said = el("span", { style: "flex:1 1 100%;min-width:0" });
    use.addEventListener("click", async () => {
      use.disabled = true; keep.disabled = true;
      said.style.color = "#94a3b8"; said.textContent = t("Saving...");
      try {
        await setReceiverRoom(ctx, s, s.room);
        _set.set(s.source, s.room);
        said.style.color = "#a7f3d0"; said.textContent = "✓ " + t("Room set: {room}.", { room: s.room });
        if (ctx.toast) ctx.toast(t("{receiver} is in {room} now.", { receiver: name, room: s.room }));
        if (onSet) onSet(s, s.room); else if (ctx.actions.renderRooms) ctx.actions.renderRooms();
      } catch (e) {
        said.style.color = "#f87171";
        said.textContent = String((e && e.message) || t("That didn't work. Try again in a moment."));
        use.disabled = false; keep.disabled = false;
      }
    });
    keep.addEventListener("click", () => { _kept.add(s.source + "|" + s.room); row.remove(); });
    row.appendChild(use);
    row.appendChild(keep);
    row.appendChild(said);
    box.appendChild(row);
  }
  return box;
}
