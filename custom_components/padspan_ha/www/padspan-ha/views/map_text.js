// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
// See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
//
// The map as text, for screen readers and keyboards: who is in which room,
// one line a room ("Kitchen: Alice's iPhone, Bob's watch." / "Office:
// empty."). Never seen: the box is clipped to nothing and stands at the
// screen's corner, so no layout, scroll or pixel changes for anyone looking.
// A screen reader hears a room's line when it changes, politely, and at most
// once every ten seconds.
//
// Only what the map itself shows: the Overview's labelled, identified or
// followed objects that are not away (quiet mode shows the same set), the
// Atlas's people and tags (Live Aboard's own wantedOf). Names go in as
// text (textContent), never as markup.

/** A box no one sees and a screen reader still reads. */
export const SR_ONLY = "position:fixed;top:0;left:0;width:1px;height:1px;margin:0;padding:0;border:0;"
  + "overflow:hidden;clip-path:inset(50%);white-space:nowrap;pointer-events:none";
/** At most one announcement this often (ms). */
export const EVERY_MS = 10000;

const nameOf = (o) => String(o.user_label || o.private_ble_name || o.name || "").trim() || "an unnamed device";
const okRoom = (r) => typeof r === "string" && r !== "" && r !== "unknown" && r !== "not_home";

/** [[room, line]] from [{room, name}]: every room on the map (rooms, in order)
 *  and any other room someone is in, names sorted. */
export function roomLines(entries, rooms){
  const by = new Map();
  for (const r of rooms || []) if (okRoom(r)) by.set(r, []);
  for (const e of entries || []) {
    if (!e || !okRoom(e.room)) continue;
    if (!by.has(e.room)) by.set(e.room, []);
    by.get(e.room).push(String(e.name));
  }
  return [...by.entries()].map(([room, names]) =>
    [room, `${room}: ${names.length ? names.sort((a, b) => a.localeCompare(b)).join(", ") : "empty"}.`]);
}

/** The Overview map's objects, as its map takes them (overview.js
 *  _refreshIsoObjects): no scanners, no Home Assistant entity that a radio
 *  object already stands for, a radio object with no room takes its entity's;
 *  then labelled, identified or followed, not stale and not away.
 *  opts.followed(o), opts.away(o), opts.isScanner(o) are the panel's own. */
export function overviewEntries(objects, opts = {}){
  const RADIO = ["ble", "private_ble", "ibeacon"], up = (a) => String(a).toUpperCase();
  const list = (objects || []).filter(o => o && !(opts.isScanner && opts.isScanner(o)));
  const addrs = new Set(), linked = new Set(), entityRoom = {};
  for (const o of list) {
    if (RADIO.includes(o.kind)) {
      if (o.address) addrs.add(up(o.address));
      if (Array.isArray(o.all_addresses)) for (const a of o.all_addresses) addrs.add(up(a));
    }
    if (Array.isArray(o.linked_entities)) for (const e of o.linked_entities) linked.add(e);
    if (o.kind === "entity" && okRoom(o.room) && o.address) entityRoom[up(o.address)] = o.room;
  }
  const out = [];
  for (const o of list) {
    if (o.kind === "entity" && ((o.address && addrs.has(up(o.address))) || (o.entity_id && linked.has(o.entity_id)))) continue;
    if (o._stale || o._ghost || (opts.away && opts.away(o))) continue;
    if (!o.user_label && !o.identified && !(opts.followed && opts.followed(o))) continue;
    const room = okRoom(o.room) ? o.room : RADIO.includes(o.kind) && o.address ? entityRoom[up(o.address)] : o.room;
    out.push({ room, name: nameOf(o) });
  }
  return out;
}

/** The Atlas's people and tags (wantedOf's list). Names hidden on the map: a tag is "a tag". */
export function wantedEntries(wants, hideNames){
  const out = [];
  for (const w of wants || []) {
    if (!w) continue;
    if (w.kind === "person" && w.person && w.person.at) out.push({ room: w.person.at.room, name: String(w.person.name || "someone") });
    else if (w.kind === "beacon") out.push({ room: w.room, name: hideNames ? "a tag" : String(w.name || "a tag") });
  }
  return out;
}

/** The rooms drawn on the map (model.room_geometry_m), by name. */
export function mapRooms(model){
  const g = model && model.room_geometry_m && typeof model.room_geometry_m === "object" ? model.room_geometry_m : {};
  return Object.keys(g).sort((a, b) => a.localeCompare(b));
}

/** The hidden live box. update(lines) shows the newest lines, at most every
 *  EVERY_MS; a room's own line is only touched when its text changed. The
 *  first fill (and the first after clear) goes in quietly — aria-live is
 *  turned on only after it, so opening the map does not read out the whole
 *  house, only the rooms that change after. */
export function createMapText(id, label){
  const box = document.createElement("div");
  if (id) box.id = id;
  box.setAttribute("role", "region");
  box.setAttribute("aria-label", label || "Who is in which room");
  box.setAttribute("aria-live", "off");
  box.setAttribute("aria-atomic", "false");
  box.setAttribute("data-map-text", "");
  box.style.cssText = SR_ONLY;
  let at = 0, timer = null, wanted = null, liveTimer = null;
  const apply = () => {
    timer = null;
    if (!wanted) return;
    const lines = wanted; wanted = null; at = Date.now();
    const have = new Map([...box.children].map(n => [n.getAttribute("data-room"), n]));
    let prev = null;
    for (const [room, text] of lines) {
      let n = have.get(room);
      have.delete(room);
      if (!n) { n = document.createElement("p"); n.setAttribute("data-room", room); n.style.margin = "0"; }
      if (n.textContent !== text) n.textContent = text;
      const want = prev ? prev.nextSibling : box.firstChild;
      if (n !== want) box.insertBefore(n, want);
      prev = n;
    }
    for (const n of have.values()) n.remove();
    if (box.getAttribute("aria-live") === "off" && !liveTimer)
      liveTimer = setTimeout(() => { liveTimer = null; box.setAttribute("aria-live", "polite"); }, 0);
  };
  return {
    el: box,
    update(lines){
      wanted = lines || [];
      if (timer) return;
      const wait = at ? Math.max(0, at + EVERY_MS - Date.now()) : 0;
      if (wait === 0) apply(); else timer = setTimeout(apply, wait);
    },
    clear(){
      if (timer) clearTimeout(timer);
      if (liveTimer) clearTimeout(liveTimer);
      timer = null; liveTimer = null; wanted = null; at = 0;
      box.setAttribute("aria-live", "off");
      box.replaceChildren();
    },
    text: () => [...box.children].map(n => n.textContent).join(" "),
  };
}
