// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
// See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
//
// "Who's where now": what a house without a floor plan sees first on the
// Overview. Each room a Bluetooth scanner covers (the scanner's Home
// Assistant area) and who is in it right now — the room the engine already
// gives every device without a map, from the scanner that hears it best
// (presence_coordinator.py, the nearest-scanner path). Before this, a new
// install saw a grid of boxes with six-letter labels, or the demo house,
// and the first room only after a floor plan, a scale and traced rooms.
//
// Phones Home Assistant can already tell apart (Private BLE Device) have a
// Track button: one click names and follows one, as "Track this phone" does
// for an Android phone (overview.js). A scanner with no area is named, since
// it can never give a room.
//
// The card keeps itself current: it registers state._whosWhereUpdate, which
// the panel's poll calls (panel.js _render, fromPoll), so it never goes stale
// the way the static room grid does.

const okRoom = (r) => typeof r === "string" && r !== "" && r !== "unknown" && r !== "not_home";
const up = (a) => String(a || "").toUpperCase();

/** The Bluetooth scanners in a snapshot: [{source, name, area}], area "" when
 *  the scanner's Home Assistant device has none. */
export function scannersOf(snap){
  const radios = snap && snap.ble && Array.isArray(snap.ble.radios) ? snap.ble.radios : [];
  return radios.filter(r => r && r.source).map(r => ({
    source: String(r.source),
    name: String(r.name || r.source),
    area: okRoom(r.area_name) ? r.area_name : "",
  }));
}

/** What these scanners give the house, as {tone, text}. The thresholds are
 *  the engine's: rooms come from the scanner that hears a device best, one
 *  room per scanner area; positions between scanners need three placed on a
 *  measured floor plan (presence_coordinator.py, need_3_pos_scanners). */
export function scannerLine(scanners){
  const n = scanners.length;
  const areas = new Set(scanners.map(s => s.area).filter(Boolean)).size;
  if (!n) return { tone: "none", text: "No Bluetooth scanners found yet. Add an ESPHome Bluetooth proxy (or use your Home Assistant machine's own Bluetooth) and it shows up here within a minute." };
  if (!areas) return { tone: "warn", text: `${n === 1 ? "Your scanner has no" : `None of your ${n} scanners has a`} Home Assistant area yet, so PadSpan can tell home from away but not rooms. Give each scanner the area it's in.` };
  if (areas === 1) return { tone: "ok", text: `Your ${n === 1 ? "scanner covers" : `${n} scanners cover`} one room, so you get home or away. Put one in each room you want told apart.` };
  return { tone: "ok", text: `Your ${n} scanners cover ${areas} rooms. Each device goes to the room whose scanner hears it best. With three or more placed on a floor plan, PadSpan can also place devices between them, even in rooms with no scanner of their own.` };
}

/** Rooms and who is in them, for a snapshot's objects:
 *  [{room, people:[{name, key, track}], others}], scanner rooms first.
 *  people: labelled, identified or followed devices (what the map shows,
 *  map_text.js overviewEntries), plus Private BLE Device phones not tracked
 *  yet (track: true). others: every other device heard in that room.
 *  A person or phone heard with no room (only by a scanner with no area)
 *  goes in a last row, room "" — never dropped, or it could be tracked
 *  nowhere. opts.followed(o), opts.away(o), opts.isScanner(o) are the
 *  panel's own. */
export function whoIsWhere(snap, scanners, opts = {}){
  const objs = snap && snap.objects && Array.isArray(snap.objects.list) ? snap.objects.list : [];
  const rooms = new Map();
  const roomOf = (r) => { if (!rooms.has(r)) rooms.set(r, { room: r, people: [], others: 0 }); return rooms.get(r); };
  for (const s of scanners || []) if (s.area) roomOf(s.area);
  // A radio object stands for the HA entity of the same address (Bermuda's,
  // a device tracker's): count the device once, as overviewEntries does.
  const radioAddrs = new Set();
  for (const o of objs) {
    if (o && ["ble", "private_ble", "ibeacon"].includes(o.kind)) {
      if (o.address) radioAddrs.add(up(o.address));
      if (Array.isArray(o.all_addresses)) for (const a of o.all_addresses) radioAddrs.add(up(a));
    }
  }
  const noRoom = { room: "", people: [], others: 0 };
  for (const o of objs) {
    if (!o || o._stale || o._ghost) continue;
    if (opts.isScanner && opts.isScanner(o)) continue;
    if (opts.away && opts.away(o)) continue;
    if (o.kind === "entity" && o.address && radioAddrs.has(up(o.address))) continue;
    const key = o.canonical_id || o.key || o.address || "";
    const known = !!(o.user_label || o.identified || (opts.followed && opts.followed(o)));
    const phone = !known && o.kind === "private_ble" && o.private_ble_name;
    const r = okRoom(o.room) ? roomOf(o.room) : (known || phone) ? noRoom : null;
    if (!r) continue;
    if (known) r.people.push({ name: String(o.user_label || o.private_ble_name || o.name || "a device"), key, track: false });
    else if (phone) r.people.push({ name: String(o.private_ble_name), key, track: true });
    else r.others += 1;
  }
  const scannerRooms = new Set((scanners || []).map(s => s.area).filter(Boolean));
  const list = [...rooms.values()];
  for (const r of list.concat(noRoom)) r.people.sort((a, b) => a.name.localeCompare(b.name));
  list.sort((a, b) => (scannerRooms.has(b.room) - scannerRooms.has(a.room)) || a.room.localeCompare(b.room));
  return noRoom.people.length ? list.concat(noRoom) : list;
}

/** The panel's own test for "followed" (overview.js): any of an object's
 *  addresses — a plain tag is followed by its bare address, not its key. */
export function followedObj(o, followedHas){
  return [o && o.address, o && o.entity_id, o && o.key, o && o.canonical_id].some(k => k && followedHas(k));
}

const othersText = (n) => `${n} other Bluetooth device${n === 1 ? "" : "s"}`;

/** Phones in Private BLE Device that no one tracks yet and that aren't heard
 *  right now (the snapshot only holds phones in range): [{name, key}]. */
export function phonesNotHeard(devices, labels, heardKeys, followed){
  const lab = new Set(Object.keys(labels || {}).map(up));
  const heard = new Set([...(heardKeys || [])].map(up));
  return (devices || [])
    .filter(d => d && d.canonical_id && d.source === "private_ble_device")
    .filter(d => !lab.has(up(d.canonical_id)) && !heard.has(up(d.canonical_id)) && !(followed && followed(d.canonical_id)))
    .map(d => ({ name: String(d.name || "Phone"), key: d.canonical_id }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** The card. Returns null when there is nothing for it to do (Sample mode,
 *  no snapshot yet): the caller shows it only before any room is drawn. */
export function whosWhereCard(ctx){
  const { el } = ctx.helpers;
  const snap = ctx.state.live?.snapshot;
  if (ctx.state.dataMode !== "live" || !snap) return null;
  const opts = {
    followed: (o) => followedObj(o, ctx.actions.followedHas),
    away: (o) => ctx.helpers.isAway(o, ctx.helpers.awayTimeoutS(ctx.state.settings)),
    isScanner: ctx.helpers.isScanner,
  };

  const card = el("div", { class: "card", style: "border-color:#2d6a4f;margin-bottom:10px", "data-whos-where": "1" });
  card.appendChild(el("div", { style: "display:flex;align-items:baseline;gap:10px;flex-wrap:wrap" }, [
    el("div", { class: "h2", style: "margin:0" }, "Who's where now"),
    el("span", { class: "muted", style: "font-size:12px" }, "From your Bluetooth scanners and the Home Assistant area each one is in. No floor plan needed."),
  ]));
  const lineEl = el("div", { style: "font-size:12px;margin:8px 0" });
  const roomsEl = el("div", { style: "display:grid;gap:6px" });
  const awayEl = el("div", { style: "margin-top:8px" });
  card.appendChild(lineEl);
  card.appendChild(roomsEl);
  card.appendChild(awayEl);

  // With Enhanced security on, naming a device is an administrator's
  // (ws_objects.py): someone else sees the phones, without a Track that
  // would only be refused.
  const canTrack = !(ctx.state.settings?.enhanced_security === true && ctx.hass?.user?.is_admin === false);
  const track = async (btn, p) => {
    btn.disabled = true;
    btn.textContent = "Tracking…";
    try {
      await ctx.actions.wsCall("padspan_ha/object_label_set", { address: p.key, label: p.name });
      // Before the toggle: it redraws at once, and the new card must re-read.
      ctx.state._whosWherePhones = null;
      if (!ctx.actions.followedHas(p.key)) ctx.actions.followedToggle(p.key);
      ctx.toast(`Tracking ${p.name}: it now has its own room and home/away sensors in Home Assistant.`);
    } catch (e) {
      btn.disabled = false;
      btn.textContent = "Track";
      ctx.toast(`Couldn't track ${p.name}: ${e?.message || e}`, true);
    }
  };
  const trackBtn = (p) => {
    if (!canTrack) return null;
    const b = el("button", { class: "btn inline", style: "font-size:11px;padding:2px 10px;margin-left:4px", title: "Name it in PadSpan and follow it: room and home/away sensors in Home Assistant" }, "Track");
    b.addEventListener("click", () => track(b, p));
    return b;
  };

  // Redrawn only when what it shows changed: a button rebuilt under the
  // pointer on every poll can lose the click that was landing on it.
  let shown = "";
  const draw = () => {
    const s = ctx.state.live?.snapshot || snap;
    const scanners = scannersOf(s);
    const rows = whoIsWhere(s, scanners, opts);
    // Heard = listed above: a phone the snapshot still holds but shows as
    // away or stale is "not heard right now", not nowhere.
    const heard = rows.flatMap(r => r.people.map(x => x.key)).filter(Boolean);
    const notHeard = phonesNotHeard(ctx.state._whosWherePhones?.devices, ctx.state._whosWherePhones?.labels, heard,
      (k) => ctx.actions.followedHas(k));
    // The counts of other devices change on most polls: they're updated in
    // place, so the rows (and their Track buttons) are rebuilt only when
    // who is where changed.
    const key = JSON.stringify([scanners, rows.map(r => [r.room, r.people, r.others > 0]), notHeard]);
    if (key === shown) {
      const spans = [...roomsEl.querySelectorAll("[data-others]")];
      for (const r of rows) {
        const span = spans.find(x => x.getAttribute("data-others") === r.room);
        if (span) span.textContent = othersText(r.others);
      }
      return;
    }
    shown = key;
    const line = scannerLine(scanners);
    lineEl.textContent = line.text;
    lineEl.style.color = line.tone === "ok" ? "#cbd5e1" : "#fbbf24";
    const noArea = scanners.filter(x => !x.area);
    if (noArea.length && noArea.length < scanners.length) {
      lineEl.textContent += ` ${noArea.length === 1 ? "One scanner has" : `${noArea.length} scanners have`} no Home Assistant area yet, so ${noArea.length === 1 ? "it gives" : "they give"} no room: ${noArea.map(x => x.name).join(", ")}.`;
    }
    roomsEl.replaceChildren();
    for (const r of rows) {
      const row = el("div", { style: "display:flex;align-items:baseline;gap:10px;padding:6px 10px;border-radius:6px;background:#071008;flex-wrap:wrap" });
      row.appendChild(el("span", { style: `font-weight:700;min-width:7em;color:${r.room ? "#e2e8f0" : "#fbbf24"}` }, r.room || "Heard, no room yet"));
      const who = el("span", { style: "flex:1;min-width:0;font-size:13px;color:#cbd5e1" });
      if (!r.people.length && !r.others) who.appendChild(el("span", { class: "muted" }, "empty"));
      r.people.forEach((p, i) => {
        if (i) who.appendChild(document.createTextNode(" · "));
        who.appendChild(el("span", { style: p.track ? "color:#5eead4" : "font-weight:600;color:#d8f3dc" }, p.name));
        const tb = p.track ? trackBtn(p) : null;
        if (tb) who.appendChild(tb);
      });
      if (r.others) {
        if (r.people.length) who.appendChild(document.createTextNode(" · "));
        who.appendChild(el("span", { class: "muted", style: "font-size:12px", "data-others": r.room }, othersText(r.others)));
      }
      row.appendChild(who);
      roomsEl.appendChild(row);
    }
    // Phones Home Assistant knows but doesn't hear right now.
    awayEl.replaceChildren();
    if (!canTrack && (notHeard.length || rows.some(r => r.people.some(x => x.track)))) {
      awayEl.appendChild(el("div", { class: "muted", style: "font-size:12px;margin-bottom:4px" },
        "Enhanced security is on: an administrator can track these phones."));
    }
    if (notHeard.length) {
      const line2 = el("div", { style: "font-size:12px;color:#94a3b8" }, "Not heard right now: ");
      notHeard.forEach((p, i) => {
        if (i) line2.appendChild(document.createTextNode(" · "));
        line2.appendChild(el("span", { style: "color:#5eead4" }, p.name));
        const tb = trackBtn(p);
        if (tb) line2.appendChild(tb);
      });
      awayEl.appendChild(line2);
    }
  };

  // Private BLE Device phones and PadSpan's labels: once, then on each redraw
  // after a Track (the snapshot alone has only the phones in range).
  if (ctx.state._whosWherePhones === undefined || ctx.state._whosWherePhones === null) {
    ctx.state._whosWherePhones = { devices: [], labels: {} };
    Promise.all([
      ctx.actions.wsCall("padspan_ha/private_ble_status", {}).catch(() => ({})),
      ctx.actions.wsCall("padspan_ha/object_label_list", {}).catch(() => ({})),
    ]).then(([st, lb]) => {
      ctx.state._whosWherePhones = { devices: st?.devices || [], labels: lb?.labels || {} };
      if (card.isConnected !== false) draw();
    });
  }

  const foot = el("div", { style: "display:flex;gap:8px;flex-wrap:wrap;margin-top:10px" });
  const mapBtn = el("button", { class: "btn inline", style: "font-size:12px", title: "Upload a floor plan (or a photo of one) and trace your rooms" }, "Make it a map");
  mapBtn.addEventListener("click", () => {
    ctx.state.view = "maps";
    const maps = ctx.state.maps?.list || [];
    ctx.state._mapsWizard = { step: 1, mapId: (maps[0] && maps[0].id) || null };
    ctx.actions.renderRooms();
  });
  const demoBtn = el("button", { class: "btn inline", style: "font-size:12px", title: "A made-up house with every feature set up. Your own house is one click away." }, "Preview a finished house");
  demoBtn.addEventListener("click", () => ctx.actions.setDataMode("sample"));
  foot.appendChild(mapBtn);
  foot.appendChild(demoBtn);
  card.appendChild(foot);

  draw();
  // Only isConnected === false is detached: the views' shared convention.
  ctx.state._whosWhereUpdate = () => { if (card.isConnected !== false) draw(); };
  return card;
}
