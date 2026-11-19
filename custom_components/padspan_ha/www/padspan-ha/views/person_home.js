// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
// See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
//
// Is a Home Assistant person home? One rule, for every view that asks (Live
// Aboard and the flat Atlas through their tracked layer, the director's
// "Arrived home"). The server's presence_rules.person_is_home is the same
// rule; tests/test_person_home.py holds the two alike on one table.
//
// A person is home when their state is
//   home                  Home Assistant's own word
//   a room PadSpan knows  a room tracker's answer: PadSpan's own device
//                         tracker reports the room as its state, and its guide
//                         says to link it to the person, so the person reads
//                         "Kitchen"
//   the home zone         its name, or a zone that lies wholly inside it (a
//                         Garden zone in the yard)
//   unknown               only while PadSpan places one of their own devices
//                         in the house (someone with no tracker of their own)
// Anything else is away: not_home, unavailable, a zone elsewhere. A zone wins
// over a room of the same name, so someone at a zone called "Office" is never
// put in the office at home.
//
// No imports.

const EARTH_M = 6371000;
const HOME_RADIUS_M = 100;                 // Home Assistant's own default for zone.home
const NOT_ROOMS = new Set(["", "unknown", "unavailable", "not home", "home", "away"]);

/** A room or zone name as compared: case, "_" and "-" and extra spaces aside. */
export function placeName(s){
  return String(s ?? "").toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
}
const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);

function metresApart(a, b){
  const rad = Math.PI / 180, dLat = (b.latitude - a.latitude) * rad, dLon = (b.longitude - a.longitude) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.latitude * rad) * Math.cos(b.latitude * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Home Assistant's zones by name (placeName), each true when it is the home
 *  zone or lies wholly inside it: Map(name -> at home). Two zones of one name
 *  are at home only if both are. states: Home Assistant's states. */
export function homeZones(states){
  const st = states && typeof states === "object" ? states : {};
  const home = st["zone.home"] && st["zone.home"].attributes ? st["zone.home"].attributes : null;
  const hLat = home ? num(home.latitude) : null, hLon = home ? num(home.longitude) : null;
  const hR = home ? (num(home.radius) ?? HOME_RADIUS_M) : HOME_RADIUS_M;
  const out = new Map();
  for (const [eid, s] of Object.entries(st)) {
    if (!eid.startsWith("zone.") || !s) continue;
    const a = s.attributes || {};
    const name = placeName(a.friendly_name || eid.slice(5));
    if (!name) continue;
    let atHome = eid === "zone.home";
    const lat = num(a.latitude), lon = num(a.longitude);
    if (!atHome && hLat !== null && hLon !== null && lat !== null && lon !== null)
      atHome = metresApart({ latitude: hLat, longitude: hLon }, { latitude: lat, longitude: lon }) + Math.max(0, num(a.radius) ?? 0) <= hR;
    out.set(name, out.has(name) ? out.get(name) && atHome : atHome);
  }
  return out;
}

/** Every room PadSpan knows (placeName): the map's rooms, each receiver's
 *  room, the receivers' Home Assistant areas, and the room each device is in
 *  now. model: PadSpan's model; snapshot: the live snapshot (either may be
 *  missing). → Set. */
export function knownRooms(model, snapshot){
  const out = new Set();
  const add = (r) => { const n = placeName(r); if (!NOT_ROOMS.has(n)) out.add(n); };
  const m = model && typeof model === "object" ? model : {};
  if (m.room_geometry_m && typeof m.room_geometry_m === "object") for (const r of Object.keys(m.room_geometry_m)) add(r);
  if (m.scanners && typeof m.scanners === "object") for (const s of Object.values(m.scanners)) if (s && typeof s === "object") add(s.room);
  const radios = snapshot && snapshot.ble && Array.isArray(snapshot.ble.radios) ? snapshot.ble.radios : [];
  for (const r of radios) if (r && typeof r === "object") add(r.area_name || r.area);
  const objs = snapshot && snapshot.objects && Array.isArray(snapshot.objects.list) ? snapshot.objects.list : [];
  for (const o of objs) if (o && typeof o === "object" && typeof o.room === "string") add(o.room);
  return out;
}

/** The rule. state: the person's state (a string, or their state object);
 *  ctx = {rooms (names PadSpan knows: any iterable), zones (homeZones', a Map
 *  or {name: at home}), placed (PadSpan places one of their own devices in
 *  the house now)}. */
export function personIsHome(state, ctx = {}){
  const raw = state && typeof state === "object" ? state.state : state;
  const s = String(raw ?? "").trim();
  if (s === "home") return true;
  if (s === "unknown") return !!ctx.placed;
  if (s === "" || s === "not_home" || s === "unavailable") return false;
  const n = placeName(s);
  const zones = new Map();
  const z = ctx.zones instanceof Map ? ctx.zones : new Map(Object.entries(ctx.zones && typeof ctx.zones === "object" ? ctx.zones : {}));
  for (const [k, v] of z) { const kn = placeName(k); zones.set(kn, zones.has(kn) ? zones.get(kn) && !!v : !!v); }
  if (zones.has(n)) return zones.get(n);
  for (const r of ctx.rooms || []) if (placeName(r) === n && !NOT_ROOMS.has(n)) return true;
  return false;
}
