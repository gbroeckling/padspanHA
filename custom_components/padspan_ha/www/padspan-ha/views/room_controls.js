// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
// See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
//
// Room controls on the flat Atlas (2026-11-25, the owner: "in the pulldown in
// atlas, add a volume for room option, when on creates an icon in the room
// that opens a card that has volume up down and mute"; a Control4 to Home
// Assistant matchup; room off; Crestron and the other whole-house systems; Home
// Assistant's own speakers, off by default; two volume controls in one room,
// "like in my house, denon and control4 at the same time"; no clutter on the
// maps; then "In the pulldown where you have room controls, that should say
// audio!!! And the setup card for audio should be accessible there"). Its words
// say Audio; its keys stay room_controls (the ⋯ line, the report) and
// room_audio_* (the settings), so the ticks kept and the report go on.
//
//   the switch  the ⋯ list's "Audio" line (live_aboard_show.js, per screen,
//               off unless ticked). Off, nothing here is read or drawn. Its
//               "Set up ›" opens the matching card (openMatch) over the map, in
//               the flat Map's list and the 3D look's, ticked or not.
//   the map     a small speaker beside a room's name while one of the room's
//               players is on (slashed while the room's first player is muted);
//               nothing while they are all off (looks, iso_lights.js). A tap on
//               it opens the room's sheet, as a tap on the name does: only a
//               button in the sheet moves anything.
//   the sheet   the Atlas's own room sheet (lights_map.js openRoomSheet), not a
//               second card: a status line (temperature, humidity, who is
//               here), Room off (its lights and players), then Audio above the
//               lights and Shades and Climate below them (sheet).
//   matching    which player is in which room, an administrator's (openMatch):
//               settings room_audio_matches {area id: [player, ...]} in the
//               room's order, and room_audio_ha_speakers.
//
// One press is one Home Assistant service call, from the browser with the
// person's own login, as a light's is. Imports nothing but its words and the
// cards' keys.

const _fill = (s, v) => s.replace(/\{(\w+)\}/g, (m, k) => (v && Object.prototype.hasOwnProperty.call(v, k) ? String(v[k]) : m));
const { t } = await import(`./i18n.js${new URL(import.meta.url).search}`)
  .catch(() => ({ t: _fill }));
// Escape, Tab and the focus for the match card (dialog_keys.js). Optional.
const KEYS = await import(`./dialog_keys.js${new URL(import.meta.url).search}`).catch(() => null);

/** The whole-house audio systems, by the Home Assistant integration (the entity registry's platform) that brings
 *  their media players in, and the name people know them by. Nothing else is recognised unless "Include Home
 *  Assistant speakers" is on. */
export const ROOM_AUDIO_SYSTEMS = Object.freeze({
  control4: "Control4", crestron: "Crestron", savant: "Savant", savantaudio: "Savant Audio",
  russound_rio: "Russound", russound_rnet: "Russound", nuvo_serial: "Nuvo", monoprice: "Monoprice",
  xantech: "Xantech", "triad-audio-matrix": "Triad", denonavr: "Denon", yamaha_musiccast: "Yamaha",
  yamaha: "Yamaha", anthemav: "Anthem",
});

// Home Assistant's MediaPlayerEntityFeature, ClimateEntityFeature and CoverEntityFeature bits used here.
export const VOLUME_SET = 4, VOLUME_MUTE = 8, TURN_OFF = 256, VOLUME_STEP = 1024;
const CLIMATE_TARGET = 1;
const COVER_OPEN = 1, COVER_CLOSE = 2, COVER_STOP = 8;
// A cover that is a garage door, a gate or a door is an opener (its door's card), never a shade here.
const NOT_SHADES = new Set(["garage", "gate", "door"]);
const OFF_STATES = new Set(["off", "standby", "unavailable", "unknown"]);
// How long a pressed level or mute shows before Home Assistant's own state is shown again.
const OPTIMISTIC_MS = 3000;

/** A name as two systems may both write it: lower case, no apostrophes, spaces or punctuation
 *  (Control4's "Alex's office" and the map's "Alex's Office" are one). */
export const norm = (s) => String(s || "").toLowerCase().replace(/[’‘'`´]/g, "").replace(/[^\p{L}\p{N}]+/gu, "");

const features = (st) => Number((st && st.attributes && st.attributes.supported_features) || 0);
const has = (st, bit) => (features(st) & bit) === bit;
const nameOf = (st, eid) => String((st && st.attributes && st.attributes.friendly_name) || eid.split(".")[1] || eid);
const pretty = (platform) => String(platform || "").split(/[_-]+/).filter(Boolean).map(w => w[0].toUpperCase() + w.slice(1)).join(" ");
/** Is a player on (playing, paused, idle, on): anything but off, standby, unavailable, unknown. */
export const playerOn = (st) => !!st && !OFF_STATES.has(String(st.state));

/** The area an entity is in: its own, else its device's (as roomScenes reads it). */
export function areaOf(hass, eid){
  const e = hass && hass.entities && hass.entities[eid];
  if (!e) return null;
  const d = e.device_id && hass.devices && hass.devices[e.device_id];
  return e.area_id || (d && d.area_id) || null;
}

/** The map's rooms (model.room_geometry_m) that are a Home Assistant area (model.areas), by name:
 *  [{name, area_id}], sorted by name. */
export function mapRooms(model){
  const areas = (model && Array.isArray(model.areas)) ? model.areas : [];
  const byName = new Map();
  for (const a of areas) {
    const id = a && (a.id || a.area_id);
    if (id && a.name) byName.set(String(a.name).trim().toLowerCase(), String(id));
  }
  const out = [];
  for (const name of Object.keys((model && model.room_geometry_m) || {})) {
    const id = byName.get(String(name).trim().toLowerCase());
    if (id && !out.some(r => r.area_id === id)) out.push({ name, area_id: id });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/** The players room controls offer: every media_player whose integration is one of ROOM_AUDIO_SYSTEMS, and with
 *  haSpeakers every other one with a volume (Music Assistant, ESPHome, Cast, a TV...). [{eid, platform, system, name,
 *  ha}] sorted by system, then name. Hidden entities are left out. */
export function audioPlayers(hass, haSpeakers){
  const states = (hass && hass.states) || {}, ents = (hass && hass.entities) || {};
  const out = [];
  for (const [eid, st] of Object.entries(states)) {
    if (!eid.startsWith("media_player.")) continue;
    const reg = ents[eid] || null;
    if (reg && (reg.hidden || reg.hidden_by || reg.disabled_by)) continue;
    const platform = reg && reg.platform ? String(reg.platform) : "";
    const known = Object.prototype.hasOwnProperty.call(ROOM_AUDIO_SYSTEMS, platform) ? ROOM_AUDIO_SYSTEMS[platform] : null;
    if (known) out.push({ eid, platform, system: known, name: nameOf(st, eid), ha: false });
    else if (haSpeakers === true && (features(st) & (VOLUME_SET | VOLUME_STEP))) out.push({ eid, platform, system: pretty(platform) || "Home Assistant", name: nameOf(st, eid), ha: true });
  }
  return out.sort((a, b) => (a.ha - b.ha) || a.system.localeCompare(b.system) || a.name.localeCompare(b.name));
}

/** A first guess at the matches, for a house with none saved: a player whose Home Assistant area is a room on the map
 *  goes there, else one whose name (or entity id) is a room's name once normalised. {area_id: [eid, ...]}. */
export function prefill(players, rooms, hass){
  const ids = new Set(rooms.map(r => r.area_id)), byName = new Map(rooms.map(r => [norm(r.name), r.area_id]));
  const out = {};
  for (const p of players) {
    const a = areaOf(hass, p.eid);
    const id = (a && ids.has(a) ? a : null) || byName.get(norm(p.name)) || byName.get(norm(p.eid.split(".")[1])) || null;
    if (id) (out[id] = out[id] || []).push(p.eid);
  }
  return out;
}

/** The saved matches, cleaned: {area_id: [eid, ...]} with each player once. */
export function cleanMatches(raw){
  const out = {}, seen = new Set();
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  for (const [aid, list] of Object.entries(raw)) {
    if (!Array.isArray(list)) continue;
    const keep = list.filter(e => typeof e === "string" && e.startsWith("media_player.") && !seen.has(e) && seen.add(e));
    if (keep.length) out[aid] = keep;
  }
  return out;
}

const median = (xs) => {
  if (!xs.length) return null;
  const s = xs.slice().sort((a, b) => a - b), m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const one = (v) => String(Math.round(v * 10) / 10);

// ── the look ─────────────────────────────────────────────────────────────────
const S = {
  section: "padding:6px 2px 8px;border-bottom:1px solid rgba(120,190,155,.12);margin-bottom:6px",
  head: "font-size:10px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:#94a3b8;margin:2px 0 2px",
  row: "display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:6px 0",
  // A player's Mute, −, level, + and ⏻ stay on one line: a narrow panel (the 3D room panel on a wall) wraps them under
  // its name as one, never two of them on a second line.
  ctl: "display:inline-flex;align-items:center;gap:8px;flex:0 0 auto;flex-wrap:nowrap",
  name: "flex:1 1 140px;min-width:0;font-size:13px;overflow:hidden;text-overflow:ellipsis",
  sys: "color:#94a3b8;font-weight:600",
  chip: (on) => "display:inline-flex;align-items:center;padding:2px 9px;border-radius:999px;font-size:10px;font-weight:700;letter-spacing:.06em;"
    + (on ? "color:#52b788;background:rgba(82,183,136,.14);border:1px solid rgba(82,183,136,.5)"
          : "color:#94a3b8;background:rgba(255,255,255,.03);border:1px solid rgba(120,190,155,.18)"),
  btn: "min-width:38px;min-height:36px;padding:4px 10px;border-radius:8px;cursor:pointer;font-size:14px;font-weight:700;line-height:1;"
    + "background:rgba(255,255,255,.04);border:1px solid rgba(120,190,155,.22);color:#e2e8f0",
  primary: "min-height:36px;padding:6px 14px;border-radius:8px;cursor:pointer;font-size:12px;font-weight:700;"
    + "color:#e2e8f0;background:#2d6a4f;border:1px solid #52b788",
  quiet: "min-height:32px;padding:4px 12px;border-radius:8px;cursor:pointer;font-size:12px;font-weight:600;"
    + "background:rgba(255,255,255,.03);border:1px solid rgba(120,190,155,.18);color:rgba(226,240,232,.75)",
  level: "min-width:36px;text-align:center;font-variant-numeric:tabular-nums;font-weight:800;font-size:14px",
  note: "font-size:11px;color:#94a3b8;margin-top:4px",
};
const off = ";opacity:.4;cursor:default";
const mk = (tag, style, text) => { const n = document.createElement(tag); if (style) n.style.cssText = style; if (text !== undefined) n.textContent = text; return n; };

/**
 * Room controls for one screen. o:
 *   hass()        Home Assistant now (states, entities, devices, areas, callService, user)
 *   model()       the map (room_geometry_m, areas)
 *   settings()    {room_audio_matches, room_audio_ha_speakers}
 *   save(patch)   writes those two (settings_set); resolves when Home Assistant kept them
 *   admin()       an administrator: may match rooms
 *   toast(m, err), errorText(e), count(word) (the report's room_controls:<word>), redraw() (the open sheet and the map)
 * Returns { looks, sheet, switched, openMatch, canMatch } — functions only (the map card's signature keeps none of its
 * data). canMatch(): may this person open the matching card (an administrator).
 */
export function createRoomControls(o){
  const opt = new Map();   // eid -> {level?, muted?, target?, until}: what a press shows until Home Assistant says
  let counted = false;
  const H = () => o.hass() || {};
  const st = (eid) => (H().states || {})[eid];
  const settings = () => o.settings() || {};
  const haOn = () => settings().room_audio_ha_speakers === true;
  const matches = () => cleanMatches(settings().room_audio_matches);
  const count = (w) => { try { o.count(w); } catch (_) { /* the report is never the error */ } };
  const optOf = (eid) => { const v = opt.get(eid); if (v && Date.now() < v.until) return v; opt.delete(eid); return null; };
  const roomArea = (room) => {
    const r = mapRooms(o.model()).find(x => x.name === room);
    if (r) return r.area_id;
    const want = String(room || "").trim().toLowerCase();
    for (const [id, a] of Object.entries(H().areas || {})) if (String((a && a.name) || "").trim().toLowerCase() === want) return id;
    return null;
  };
  /** The room's players in its order: matched, still offered, still in Home Assistant. */
  const playersIn = (room) => {
    const aid = roomArea(room);
    if (!aid) return [];
    const offered = new Map(audioPlayers(H(), haOn()).map(p => [p.eid, p]));
    return (matches()[aid] || []).map(e => offered.get(e)).filter(p => p && st(p.eid));
  };
  // The redraw after a press: at once (what was pressed), then once Home Assistant has had time to say.
  const later = () => { try { o.redraw(); } catch (_) { /* the sheet may be gone */ } setTimeout(() => { try { o.redraw(); } catch (_) { /* gone */ } }, OPTIMISTIC_MS + 100); };
  // word: the report's (none for Room off's own calls: that press is counted once, as room_off).
  const call = (domain, service, data, word, name, undo) => {
    if (word) count(word);
    const h = H();
    if (!h || typeof h.callService !== "function") return Promise.resolve(false);
    later();
    return Promise.resolve().then(() => h.callService(domain, service, data)).then(() => true, (e) => {
      if (undo) undo();
      o.toast(`${name}: ${o.errorText(e)}`, true);
      try { o.redraw(); } catch (_) { /* gone */ }
      return false;
    });
  };

  /** {room name: "on" | "muted"} for the map: a room with a player on; muted while its first player is. */
  function looks(){
    if (!counted) { counted = true; count("on"); }
    const out = {};
    for (const r of mapRooms(o.model())) {
      const ps = playersIn(r.name);
      if (!ps.some(p => playerOn(st(p.eid)))) continue;
      const first = st(ps[0].eid), op = optOf(ps[0].eid);
      const muted = op && typeof op.muted === "boolean" ? op.muted : !!(first && first.attributes && first.attributes.is_volume_muted === true);
      out[r.name] = playerOn(first) && muted ? "muted" : "on";
    }
    return out;
  }

  // ── Audio: one row per player ──
  function audioRow(p){
    const s = st(p.eid), a = (s && s.attributes) || {}, op = optOf(p.eid) || {};
    const na = !s || s.state === "unavailable", on = playerOn(s);
    const muted = typeof op.muted === "boolean" ? op.muted : a.is_volume_muted === true;
    const lvl = typeof op.level === "number" ? op.level : (typeof a.volume_level === "number" ? a.volume_level : null);
    const row = mk("div", S.row);
    row.setAttribute("data-eid", p.eid);
    const label = mk("span", S.name);
    label.appendChild(mk("span", S.sys, `${p.system} · `));
    label.appendChild(document.createTextNode(p.name));
    row.appendChild(label);
    row.appendChild(mk("span", S.chip(on), na ? t("Unavailable") : !on ? t("Off") : muted ? t("Muted") : t("On")));
    const btn = (text, aria, run, disabled) => {
      const b = mk("button", S.btn + (disabled ? off : ""), text);
      b.setAttribute("aria-label", aria); b.title = aria;
      if (disabled) b.disabled = true;
      else b.addEventListener("click", (e) => { if (e && e.stopPropagation) e.stopPropagation(); run(); });
      return b;
    };
    const ctl = mk("span", S.ctl);
    row.appendChild(ctl);
    if (has(s, VOLUME_MUTE)) {
      ctl.appendChild(btn(muted ? t("Unmute") : t("Mute"), muted ? t("Unmute {name}", { name: p.name }) : t("Mute {name}", { name: p.name }), () => {
        opt.set(p.eid, { ...(optOf(p.eid) || {}), muted: !muted, until: Date.now() + OPTIMISTIC_MS });
        call("media_player", "volume_mute", { entity_id: p.eid, is_volume_muted: !muted }, "mute", p.name, () => opt.delete(p.eid));
      }, na));
    }
    const steps = has(s, VOLUME_STEP) || (has(s, VOLUME_SET) && lvl !== null);
    const step = Number(a.volume_step) > 0 ? Number(a.volume_step) : 0.1;   // what Home Assistant steps a VOLUME_SET player by
    const nudge = (dir) => () => {
      if (lvl !== null) opt.set(p.eid, { ...(optOf(p.eid) || {}), level: Math.max(0, Math.min(1, lvl + dir * step)), until: Date.now() + OPTIMISTIC_MS });
      call("media_player", dir > 0 ? "volume_up" : "volume_down", { entity_id: p.eid }, dir > 0 ? "up" : "down", p.name, () => opt.delete(p.eid));
    };
    ctl.appendChild(btn("−", t("{name} volume down", { name: p.name }), nudge(-1), na || !steps));
    const lv = mk("span", S.level, lvl === null ? "—" : String(Math.round(lvl * 100)));
    lv.setAttribute("data-level", "");
    ctl.appendChild(lv);
    ctl.appendChild(btn("+", t("{name} volume up", { name: p.name }), nudge(1), na || !steps));
    if (has(s, TURN_OFF)) ctl.appendChild(btn("⏻", t("Turn {name} off", { name: p.name }), () => call("media_player", "turn_off", { entity_id: p.eid }, "off", p.name), na || !on));
    return row;
  }
  const systemsPresent = () => [...new Set(audioPlayers(H(), haOn()).map(p => p.platform))];
  function matchButton(prominent){
    const wrap = mk("div", "padding:4px 0 2px");
    const onlyC4 = (() => { const s = systemsPresent(); return s.length === 1 && s[0] === "control4"; })();
    const b = mk("button", (prominent ? S.primary : S.quiet) + (o.admin() ? "" : off), onlyC4 ? t("Match Control4 to HA") : t("Match rooms"));
    b.setAttribute("data-room-match", "");
    if (o.admin()) b.addEventListener("click", (e) => { if (e && e.stopPropagation) e.stopPropagation(); openMatch(); });
    else b.disabled = true;
    wrap.appendChild(b);
    if (!o.admin()) wrap.appendChild(mk("div", S.note, t("An administrator matches the players to the rooms.")));
    return wrap;
  }
  const section = (word, key) => { const n = mk("div", S.section); n.setAttribute("data-room-controls", key); n.appendChild(mk("div", S.head, word)); return n; };

  // ── Shades: one row for the room's covers ──
  function shadesOf(aid){
    const out = [];
    for (const [eid, s] of Object.entries(H().states || {})) {
      if (!eid.startsWith("cover.") || areaOf(H(), eid) !== aid || !s || s.state === "unavailable") continue;
      if (NOT_SHADES.has(String((s.attributes || {}).device_class || ""))) continue;
      out.push(eid);
    }
    return out.sort();
  }
  function shadesRow(eids){
    const row = mk("div", S.row);
    const pos = eids.map(e => Number((st(e).attributes || {}).current_position)).filter(Number.isFinite);
    const open = eids.filter(e => ["open", "opening"].includes(st(e).state)).length;
    const word = pos.length === eids.length ? t("{pct} % open", { pct: Math.round(pos.reduce((a, b) => a + b, 0) / pos.length) }) : t("{n} of {total} open", { n: open, total: eids.length });
    const label = mk("span", S.name, eids.length === 1 ? nameOf(st(eids[0]), eids[0]) : t("{n} shades", { n: eids.length }));
    row.appendChild(label);
    row.appendChild(mk("span", S.chip(open > 0), word));
    for (const [bit, service, text] of [[COVER_OPEN, "open_cover", t("Open")], [COVER_STOP, "stop_cover", t("Stop")], [COVER_CLOSE, "close_cover", t("Close")]]) {
      const can = eids.filter(e => has(st(e), bit));
      if (!can.length) continue;
      const b = mk("button", S.btn + ";font-size:12px", text);
      b.addEventListener("click", (e) => { if (e && e.stopPropagation) e.stopPropagation();
        call("cover", service, { entity_id: can.length === 1 ? can[0] : can }, "cover", label.textContent); });
      row.appendChild(b);
    }
    return row;
  }

  // ── Climate: each thermostat in the room ──
  const MODE = { off: () => t("Off"), heat: () => t("Heat"), cool: () => t("Cool"), heat_cool: () => t("Heat and cool"), auto: () => t("Auto"),
    dry: () => t("Dry"), fan_only: () => t("Fan only") };
  function climateOf(aid){
    return Object.keys(H().states || {}).filter(e => e.startsWith("climate.") && areaOf(H(), e) === aid && st(e).state !== "unavailable").sort();
  }
  function climateRow(eid){
    const s = st(eid), a = s.attributes || {}, op = optOf(eid) || {};
    const unit = (H().config && H().config.unit_system && H().config.unit_system.temperature) || "°";
    const row = mk("div", S.row);
    row.setAttribute("data-eid", eid);
    row.appendChild(mk("span", S.name, nameOf(s, eid)));
    if (Number.isFinite(Number(a.current_temperature)) && a.current_temperature !== null) row.appendChild(mk("span", S.sys + ";font-size:13px", `${one(Number(a.current_temperature))} ${unit}`));
    row.appendChild(mk("span", S.chip(s.state !== "off"), MODE[s.state] ? MODE[s.state]() : String(s.state)));
    const target = typeof op.target === "number" ? op.target : Number(a.temperature);
    if (has(s, CLIMATE_TARGET) && a.temperature !== null && a.temperature !== undefined && Number.isFinite(target)) {
      const step = Number(a.target_temp_step) > 0 ? Number(a.target_temp_step) : 0.5;
      const lo = Number.isFinite(Number(a.min_temp)) ? Number(a.min_temp) : -Infinity, hi = Number.isFinite(Number(a.max_temp)) ? Number(a.max_temp) : Infinity;
      const set = (dir) => () => {
        const v = Math.round(Math.max(lo, Math.min(hi, target + dir * step)) * 100) / 100;
        opt.set(eid, { target: v, until: Date.now() + OPTIMISTIC_MS });
        call("climate", "set_temperature", { entity_id: eid, temperature: v }, "climate", nameOf(s, eid), () => opt.delete(eid));
      };
      const b = (text, aria, run) => { const n = mk("button", S.btn, text); n.setAttribute("aria-label", aria); n.title = aria;
        n.addEventListener("click", (e) => { if (e && e.stopPropagation) e.stopPropagation(); run(); }); return n; };
      row.appendChild(b("−", t("{name} cooler", { name: nameOf(s, eid) }), set(-1)));
      const v = mk("span", S.level, `${one(target)}°`); v.setAttribute("data-target", ""); row.appendChild(v);
      row.appendChild(b("+", t("{name} warmer", { name: nameOf(s, eid) }), set(1)));
    }
    return row;
  }

  /** What the room's sheet gains (lights_map.js _roomSheetSpec): its status line, Room off for the action row, Audio
   *  above the lights and Shades and Climate below them; each part null when the room has nothing for it.
   *  lightsOn: the room's lights on now that Home Assistant can reach; setMany: the sheet's own lights switch. */
  function sheet(room, { lightsOn = [], setMany = null } = {}){
    const h = H(), aid = roomArea(room);
    // The status line: the median temperature and humidity of the room's sensors.
    const temps = [], hums = [];
    if (aid) for (const [eid, s] of Object.entries(h.states || {})) {
      if (!eid.startsWith("sensor.") || !s || areaOf(h, eid) !== aid) continue;
      const v = Number(s.state), dc = (s.attributes || {}).device_class;
      if (!Number.isFinite(v) || s.state === "" || s.state === null) continue;
      if (dc === "temperature") temps.push(v); else if (dc === "humidity") hums.push(v);
    }
    const mt = median(temps), mh = median(hums);
    const status = [mt === null ? null : `${one(mt)}°`, mh === null ? null : `${Math.round(mh)} %`].filter(Boolean).join(" · ") || null;
    const players = playersIn(room);
    const onPlayers = players.filter(p => playerOn(st(p.eid)) && has(st(p.eid), TURN_OFF));
    const n = lightsOn.length + onPlayers.length;
    const roomOff = n ? { label: t("Room off ({n})", { n }), run: () => {
      count("room_off");
      if (lightsOn.length && typeof setMany === "function") setMany(lightsOn, false);
      for (const p of onPlayers) call("media_player", "turn_off", { entity_id: p.eid }, null, p.name);
    } } : null;
    // Audio: the room's players; the matching button after them. In a house where nothing is matched yet, the
    // button alone, prominent, in every room (where else would one start).
    const none = !Object.keys(matches()).length;
    const offered = none ? audioPlayers(h, haOn()).length : 0;
    const audioSig = players.map(p => { const s = st(p.eid), a = (s && s.attributes) || {}, op = optOf(p.eid);
      return [p.eid, p.system, p.name, s && s.state, a.volume_level, a.is_volume_muted, features(s), op && [op.level, op.muted]]; });
    const before = players.length || (none && offered) ? {
      sig: JSON.stringify([audioSig, none, offered, !!o.admin(), systemsPresent()]),
      draw: () => {
        const sec = section(t("Audio"), "audio");
        for (const p of players) sec.appendChild(audioRow(p));
        sec.appendChild(matchButton(!players.length));
        return sec;
      } } : null;
    const shades = aid ? shadesOf(aid) : [], climate = aid ? climateOf(aid) : [];
    const after = shades.length || climate.length ? {
      sig: JSON.stringify([shades.map(e => { const s = st(e), a = s.attributes || {}; return [e, s.state, a.current_position, features(s), a.friendly_name]; }),
        climate.map(e => { const s = st(e), a = s.attributes || {}, op = optOf(e); return [e, s.state, a.temperature, a.current_temperature, features(s), a.friendly_name, op && op.target]; })]),
      draw: () => {
        const frag = mk("div");
        if (shades.length) { const sec = section(t("Shades"), "shades"); sec.appendChild(shadesRow(shades)); frag.appendChild(sec); }
        if (climate.length) { const sec = section(t("Climate"), "climate"); for (const e of climate) sec.appendChild(climateRow(e)); frag.appendChild(sec); }
        return frag;
      } } : null;
    return { status, roomOff, before, after };
  }
  /** The switch was ticked (on) on this screen: with nothing matched yet, the matching card opens for an administrator. */
  function switched(on){
    if (on && o.admin() && !Object.keys(matches()).length) openMatch();
  }

  // ── The match card ──
  let card = null;
  function openMatch(){
    if (card || !o.admin()) return;
    count("match_open");
    const saved = matches();
    let ha = haOn();
    const rooms = mapRooms(o.model());
    // The draft: {area_id: [eid...]} in each room's order.
    let draft = Object.keys(saved).length ? JSON.parse(JSON.stringify(saved)) : prefill(audioPlayers(H(), ha), rooms, H());
    const overlay = mk("div", "position:fixed;inset:0;z-index:10001;background:rgba(3,8,5,.62);backdrop-filter:blur(6px);"
      + "-webkit-backdrop-filter:blur(6px);display:flex;justify-content:center;align-items:center;padding:12px;box-sizing:border-box");
    const box = mk("div", "width:100%;max-width:560px;max-height:86vh;overflow:auto;padding:14px 16px 16px;box-sizing:border-box;"
      + "background:linear-gradient(180deg,#101f15,#0b1710);border:1px solid rgba(120,190,155,.3);border-radius:16px;color:#e2e8f0;"
      + "font-family:Inter,system-ui,sans-serif;box-shadow:0 12px 50px rgba(0,0,0,.6)");
    box.setAttribute("role", "dialog"); box.setAttribute("aria-modal", "true"); box.setAttribute("data-room-match-card", "");
    let release = () => {};
    const close = () => { if (!card) return; card = null; overlay.remove(); release(); };
    overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });
    const roomOf = (eid) => Object.keys(draft).find(a => draft[a].includes(eid)) || "";
    const move = (eid, aid) => {
      for (const a of Object.keys(draft)) { draft[a] = draft[a].filter(e => e !== eid); if (!draft[a].length) delete draft[a]; }
      if (aid) (draft[aid] = draft[aid] || []).push(eid);
    };
    const draw = () => {
      box.replaceChildren();
      const players = audioPlayers(H(), ha);
      const head = mk("div", "display:flex;justify-content:space-between;align-items:flex-start;gap:10px;margin-bottom:8px");
      const hl = mk("div");
      const sys = [...new Set(players.map(p => p.platform))];
      hl.appendChild(mk("div", "font-weight:800;font-size:16px", sys.length === 1 && sys[0] === "control4" ? t("Match Control4 to HA") : t("Match rooms")));
      hl.appendChild(mk("div", "font-size:12px;color:#94a3b8;margin-top:2px", t("Pick the room each player is in. Several can share a room: the first in a room is the one the map's speaker follows.")));
      head.appendChild(hl);
      const x = mk("button", S.quiet, "✕"); x.setAttribute("aria-label", t("Close")); x.addEventListener("click", close); head.appendChild(x);
      box.appendChild(head);
      // Home Assistant's own speakers: off unless ticked.
      const lab = mk("label", "display:flex;align-items:center;gap:8px;font-size:13px;padding:6px 0 8px;cursor:pointer");
      const cb = mk("input"); cb.type = "checkbox"; cb.checked = ha; cb.setAttribute("data-ha-speakers", "");
      cb.addEventListener("change", () => { ha = !!cb.checked; draw(); });
      lab.appendChild(cb); lab.appendChild(mk("span", null, t("Include Home Assistant speakers (Music Assistant, ESPHome, Cast, TVs)")));
      box.appendChild(lab);
      if (!players.length) {
        box.appendChild(mk("div", S.note + ";font-size:12px;padding:8px 0",
          t("No players found. Audio knows Control4, Crestron, Savant, Russound, Nuvo, Monoprice, Xantech, Triad, Denon, Yamaha and Anthem players in Home Assistant.")));
      }
      if (!rooms.length) box.appendChild(mk("div", S.note + ";font-size:12px;padding:4px 0", t("No room on the map is a Home Assistant area yet.")));
      let group = null;
      for (const p of players) {
        const gname = p.ha ? t("Home Assistant speakers") : p.system;
        if (gname !== group) { group = gname; box.appendChild(mk("div", S.head + ";margin-top:10px", gname)); }
        const row = mk("div", S.row + ";border-bottom:1px solid rgba(120,190,155,.08)");
        row.setAttribute("data-eid", p.eid);
        const nm = mk("span", S.name);
        nm.appendChild(document.createTextNode(p.ha ? `${p.system} · ${p.name}` : p.name));
        nm.appendChild(mk("div", "font-size:10px;color:#64748b;font-family:ui-monospace,monospace", p.eid));
        row.appendChild(nm);
        const sel = mk("select", "min-height:34px;max-width:200px;border-radius:8px;padding:4px 6px;background:#0b1710;color:#e2e8f0;border:1px solid rgba(120,190,155,.3);font-size:13px");
        sel.setAttribute("aria-label", t("Room for {name}", { name: p.name }));
        const none = mk("option", null, t("Not on the map")); none.value = ""; sel.appendChild(none);
        for (const r of rooms) { const op = mk("option", null, r.name); op.value = r.area_id; sel.appendChild(op); }
        const at = roomOf(p.eid);
        sel.value = at;
        sel.addEventListener("change", () => { move(p.eid, sel.value); draw(); });
        row.appendChild(sel);
        const list = at ? draft[at] : [];
        if (list.length > 1) {
          const i = list.indexOf(p.eid);
          if (i === 0) row.appendChild(mk("span", S.chip(true), t("First in this room")));
          const arrow = (text, aria, j, can) => {
            const b = mk("button", S.btn + ";min-width:34px;min-height:32px;font-size:12px" + (can ? "" : off), text);
            b.setAttribute("aria-label", aria); b.title = aria;
            if (!can) b.disabled = true;
            else b.addEventListener("click", () => { const l = draft[at]; [l[i], l[j]] = [l[j], l[i]]; draw(); });
            return b;
          };
          row.appendChild(arrow("▲", t("Earlier in this room"), i - 1, i > 0));
          row.appendChild(arrow("▼", t("Later in this room"), i + 1, i < list.length - 1));
        }
        box.appendChild(row);
      }
      const foot = mk("div", "display:flex;justify-content:flex-end;gap:8px;margin-top:12px");
      const cancel = mk("button", S.quiet, t("Cancel")); cancel.addEventListener("click", close); foot.appendChild(cancel);
      const save = mk("button", S.primary, t("Save"));
      save.setAttribute("data-room-match-save", "");
      save.addEventListener("click", () => {
        const listed = new Set(players.map(p => p.eid)), out = {};
        for (const [aid, l] of Object.entries(draft)) { const keep = l.filter(e => listed.has(e)); if (keep.length && rooms.some(r => r.area_id === aid)) out[aid] = keep; }
        save.disabled = true;
        Promise.resolve().then(() => o.save({ room_audio_matches: out, room_audio_ha_speakers: ha })).then(() => {
          count("match_saved");
          close();
          try { o.redraw(); } catch (_) { /* gone */ }
        }, (e) => { save.disabled = false; o.toast(t("Could not save the matches: {why}", { why: o.errorText(e) }), true); });
      });
      foot.appendChild(save);
      box.appendChild(foot);
    };
    draw();
    overlay.appendChild(box);
    document.body.appendChild(overlay);
    card = { overlay, close };
    release = KEYS && KEYS.holdKeys ? KEYS.holdKeys(box, { close, modal: true }) : () => {};
    return card;
  }

  return { looks, sheet, switched, openMatch, canMatch: () => !!o.admin(), close: () => { if (card) card.close(); } };
}
