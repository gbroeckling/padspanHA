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
//               lights and Shades and Climate below them (sheet). Three parts,
//               each with its own ⋯ line (the owner, 2026-11-26: "Shades should
//               go with doors and Windows", "Thermostats in climate and air
//               quality"): Audio (room_controls) with Room off, the Audio
//               add-on's; Shades (room_shades), everyone's; Climate and the
//               status line (room_climate), the Climate map add-on's. The host
//               says which are on (parts).
//   matching    which player is in which room, an administrator's (openMatch):
//               settings room_audio_matches {area id: [player, ...]} in the
//               room's order, room_audio_ha_speakers, and room_audio_matched
//               (the card kept a pick once: from then on no guess is made,
//               so rooms cleared on purpose stay cleared).
//   the card    (the owner, 2026-11-26: "full audio control in a room for fully working audio environments, and
//               source and audio mode control, and surround and eq options") each player's row: its state, Mute,
//               the level (− and + for a player that only steps, a slider for one that sets it: volumeSlider)
//               and ⏻ or On; then only what that player supports now (its supported_features, read at every
//               draw): what is playing with its transport, the source and the sound mode (pickLine), "Sound ›"
//               (its tone, EQ and surround entities: soundControls) and "Share ›" (other rooms on its platform:
//               openShare); All audio off under the players. The owner's tidy-up, in the matching card: each
//               player's sources renamed, hidden and ordered (room_audio_sources) and its volume limit
//               (room_audio_limits), held wherever a level is set.
//
// One press is one Home Assistant service call, from the browser with the
// person's own login, as a light's is; a volume's number moves with each press
// at once, in place (levelNow). Imports nothing but its words and the cards'
// keys.

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
export const PAUSE = 1, PREVIOUS_TRACK = 16, NEXT_TRACK = 32, TURN_ON = 128, SELECT_SOURCE = 2048, STOP = 4096, PLAY = 16384,
  SELECT_SOUND_MODE = 65536, GROUPING = 524288;
const CLIMATE_TARGET = 1;
const COVER_OPEN = 1, COVER_CLOSE = 2, COVER_STOP = 8;
// A cover that is a garage door, a gate or a door is an opener (its door's card, Alarm & security's), never a shade
// here: by its device class, or linked as a door's opener (o.openers).
const NOT_SHADES = new Set(["garage", "gate", "door"]);
const OFF_STATES = new Set(["off", "standby", "unavailable", "unknown"]);
// A player making sound now, and the states of a player that has media at all (All audio off).
const SOUNDING = new Set(["playing", "buffering"]), MEDIA_STATES = new Set(["playing", "paused", "idle", "buffering"]);
// How long a pressed level or mute shows before Home Assistant's own state is shown again.
const OPTIMISTIC_MS = 3000;
// What one − / + press moves a player that steps itself (VOLUME_STEP: a Control4 room, 1 in 100) when its state
// carries no volume_step of its own.
const SELF_STEP = 0.01;
// A dragged slider asks Home Assistant at most this often; the value it is let go at always.
const SEND_EVERY_MS = 250;
// A held slider with no input for this long is let go of (a finger lifted off it, or its sheet gone, unheard).
const DRAG_IDLE_MS = 4000;
// Sources up to this many are chips; more open a list. Sound modes past LONG_MODES are grouped in that list.
const CHIPS_MAX = 4, LONG_MODES = 8;
// A source's new name is kept this long after the last key (and at once on leaving the field or closing the card).
const RENAME_MS = 600;
const PLAYER_RE = /^media_player\.[a-z0-9_]+$/;

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

const isMap = (x) => !!x && typeof x === "object" && !Array.isArray(x);
const strings = (x) => (Array.isArray(x) ? [...new Set(x.filter(s => typeof s === "string" && s))] : []);
/** Its own key only: a source called "constructor" or "__proto__" is a source, never something every object has. */
const own = (o, k) => !!o && Object.prototype.hasOwnProperty.call(o, k);
// The owner's source lists as the server keeps them (ws_settings._source_names): the first 100, none over 100 long.
const SOURCES_MAX = 100;
const capped = (x) => (Array.isArray(x) ? [...new Set(x.slice(0, SOURCES_MAX).filter(s => typeof s === "string" && s && s.length <= SOURCES_MAX))] : []);
/** The owner's tidy-up of each player's sources, cleaned (as ws_settings.clean_room_audio_sources keeps it):
 *  {player: {names: {source: label}, hidden: [source], order: [source]}}; a player with none of them left out. */
export function cleanSources(raw){
  const out = {};
  if (!isMap(raw)) return out;
  for (const [eid, c] of Object.entries(raw).slice(0, 200)) {
    if (!PLAYER_RE.test(eid) || !isMap(c)) continue;
    const names = Object.create(null);
    if (isMap(c.names)) for (const [k, v] of Object.entries(c.names).slice(0, SOURCES_MAX)) {
      if (k && k.length <= SOURCES_MAX && typeof v === "string" && v.trim() && v.trim() !== k) names[k] = v.trim().slice(0, 60);
    }
    const hidden = capped(c.hidden), order = capped(c.order);
    if (Object.keys(names).length || hidden.length || order.length) out[eid] = { names, hidden, order };
  }
  return out;
}
/** Each player's volume limit, cleaned (ws_settings.clean_room_audio_limits): {player: 0.1..1}. */
export function cleanLimits(raw){
  const out = {};
  if (!isMap(raw)) return out;
  for (const [eid, v] of Object.entries(raw).slice(0, 200)) if (PLAYER_RE.test(eid) && typeof v === "number" && v >= 0.1 && v <= 1) out[eid] = Math.round(v * 100) / 100;
  return out;
}
/** A player's sources in the owner's order (his order first, the rest as the player lists them), with his names:
 *  [{raw, label, hidden}]. */
export function orderSources(list, conf){
  const c = conf || {}, names = c.names || null, hidden = new Set(strings(c.hidden)), order = strings(c.order);
  const raw = strings(list);
  return [...order.filter(s => raw.includes(s)), ...raw.filter(s => !order.includes(s))]
    .map(s => ({ raw: s, label: own(names, s) && typeof names[s] === "string" && names[s] ? names[s] : s, hidden: hidden.has(s) }));
}
/** The sources a player's row offers: the owner's order and names, his hidden ones left out. */
export const tidySources = (list, conf) => orderSources(list, conf).filter(s => !s.hidden);

// A long sound mode list (a Denon's 23) in groups, by its words; the first group a mode fits takes it.
const MODE_GROUPS = [
  [() => t("Direct"), /DIRECT/i],
  [() => t("Stereo"), /STEREO/i],
  [() => t("Auto"), /\bAUTO\b|^STANDARD$/i],
  [() => t("Movie, music, game"), /^(MOVIE|MUSIC|GAME)$/i],
  [() => t("Decoders"), /DOLBY|DTS|AURO|MATRIX|VIRTUAL|NEURAL|ATMOS|PCM|MULTI/i],
  [() => t("DSP"), /./],
];
/** [{label, items: [mode]}], the groups that have a mode, in that order. */
export function groupModes(list){
  const groups = MODE_GROUPS.map(([label]) => ({ label: label(), items: [] }));
  for (const m of strings(list)) groups[MODE_GROUPS.findIndex(([, re]) => re.test(m))].items.push(m);
  return groups.filter(g => g.items.length);
}

// ── Sound: the tone, EQ and surround entities a player's integration adds beside it ──
// Our keys, in the order the Sound part shows them, and their words.
const SOUND = {
  bass: () => t("Bass"), treble: () => t("Treble"), balance: () => t("Balance"), loudness: () => t("Loudness"),
  dynamic_eq: () => t("Dynamic EQ"), eq_low: () => t("EQ low"), eq_mid: () => t("EQ mid"), eq_high: () => t("EQ high"),
  sub_level: () => t("Subwoofer level"), sub_on: () => t("Subwoofer"),
  surround_level: () => t("Surround level"), music_surround_level: () => t("Music surround level"),
  surround_mode: () => t("Full surround for music"), surround_on: () => t("Surround"),
  speech: () => t("Speech enhancement"), dialogue_level: () => t("Dialogue level"), dialogue_lift: () => t("Dialogue lift"),
  clear_voice: () => t("Clear voice"), night: () => t("Night mode"), lip_sync: () => t("Lip sync"),
  tone_mode: () => t("Tone mode"), eq_mode: () => t("EQ mode"), surround_decoder: () => t("Surround decoder"),
};
const SOUND_ORDER = Object.keys(SOUND);
const same = (...ks) => Object.fromEntries(ks.map(k => [k, k]));
// By (platform, domain, translation_key): keys collide across platforms (Sonos's dialog_level is a switch, Music
// Assistant's dialogue_level a number), so always by platform.
const SOUND_KEYS = {
  sonos: {
    number: { ...same("bass", "treble", "balance", "surround_level", "music_surround_level"), sub_gain: "sub_level", audio_delay: "lip_sync" },
    switch: { loudness: "loudness", night_mode: "night", dialog_level: "speech", sub_enabled: "sub_on", surround_enabled: "surround_on", surround_mode: "surround_mode" },
    select: { speech_dialog_level: "dialogue_level" } },
  russound_rio: { number: same("bass", "treble", "balance"), switch: same("loudness") },
  music_assistant: {
    number: { ...same("bass", "treble", "balance", "surround_level", "music_surround_level", "dialogue_level", "dialogue_lift"),
      subwoofer_volume: "sub_level", audio_delay: "lip_sync", equalizer_low: "eq_low", equalizer_mid: "eq_mid", equalizer_high: "eq_high" },
    switch: { ...same("loudness", "clear_voice", "surround_mode"), night_mode: "night", speech_enhancement: "speech", sub_enabled: "sub_on", surround_enabled: "surround_on" },
    select: { tone_control_mode: "tone_mode", equalizer_mode: "eq_mode", surround_decoder_type: "surround_decoder" } },
  yamaha_musiccast: { select: { zone_tone_control_mode: "tone_mode", zone_surr_decoder_type: "surround_decoder", zone_equalizer_mode: "eq_mode" } },
  xantech: { number: same("bass", "treble", "balance") },
};
// The ones with no translation_key (MusicCast's numbers and switches, Nuvo's, an older Xantech's): by how their
// entity id or name ends.
const TONE_TAILS = { number: [["bass", "bass"], ["treble", "treble"], ["balance", "balance"]], switch: [["loudness", "loudness"]] };
const SOUND_TAILS = {
  yamaha_musiccast: {
    number: [["tone_control_bass", "bass"], ["tone_control_treble", "treble"], ["equalizer_low", "eq_low"], ["equalizer_mid", "eq_mid"],
      ["equalizer_high", "eq_high"], ["dialogue_level", "dialogue_level"], ["dialogue_lift", "dialogue_lift"], ["subwoofer_volume", "sub_level"]],
    switch: [["clear_voice", "clear_voice"]] },
  nuvo_serial: TONE_TAILS, xantech: TONE_TAILS,
};
const snake = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
/** A player's Sound controls: the number, switch and select entities of its own device and its own integration that
 *  map to one of our keys (one each, hidden, disabled and stateless ones left out), and a Denon's Dynamic EQ;
 *  [{eid, domain, key}] in SOUND's order. Nothing for a player whose integration adds none (Control4). */
export function soundControls(hass, eid, byDevice = null){
  const ents = (hass && hass.entities) || {}, states = (hass && hass.states) || {};
  const me = own(ents, eid) ? ents[eid] : null, out = [], seen = new Set();
  if (!me || !me.platform) return out;
  const keys = SOUND_KEYS[me.platform] || {}, tails = SOUND_TAILS[me.platform] || {};
  // byDevice (devicesIndex): the entity ids of each device, made once for a whole draw; else every entity is read.
  const ids = byDevice ? (byDevice.get(me.device_id) || []) : Object.keys(ents).sort();
  if (me.device_id) for (const id of ids) {
    const e = ents[id], domain = id.split(".")[0], s = states[id];
    if (!["number", "switch", "select"].includes(domain) || !e || e.device_id !== me.device_id || e.platform !== me.platform) continue;
    if (e.hidden || e.hidden_by || e.disabled_by || !s || s.state === "unavailable") continue;
    let key = e.translation_key ? (keys[domain] || {})[e.translation_key] : null;
    if (!key && !e.translation_key && tails[domain]) {
      const said = [id.split(".")[1], snake(e.name), snake(s.attributes && s.attributes.friendly_name)].filter(Boolean);
      const hit = tails[domain].find(([tail]) => said.some(x => x === tail || x.endsWith("_" + tail)));
      key = hit ? hit[1] : null;
    }
    if (key && !seen.has(key)) { seen.add(key); out.push({ eid: id, domain, key }); }
  }
  const a = (states[eid] && states[eid].attributes) || {};
  if (me.platform === "denonavr" && typeof a.dynamic_eq === "boolean") out.push({ eid, domain: "denonavr", key: "dynamic_eq" });
  return out.sort((x, y) => SOUND_ORDER.indexOf(x.key) - SOUND_ORDER.indexOf(y.key));
}
/** Every device's entity ids, sorted: soundControls' byDevice, made once per draw. */
export function devicesIndex(hass){
  const out = new Map();
  for (const id of Object.keys((hass && hass.entities) || {}).sort()) {
    const e = hass.entities[id];
    if (e && e.device_id) { if (!out.has(e.device_id)) out.set(e.device_id, []); out.get(e.device_id).push(id); }
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
  // The full card's lines under a player's row: each wraps on its own in a narrow panel.
  line: "display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:0 0 6px",
  group: "display:inline-flex;align-items:center;gap:8px;flex:0 1 auto;flex-wrap:wrap",
  what: "font-size:11px;color:#94a3b8;font-weight:700;min-width:52px",
  thumb: "width:40px;height:40px;border-radius:6px;object-fit:cover;flex:0 0 auto;background:rgba(255,255,255,.05)",
  playing: "flex:1 1 150px;min-width:0;font-size:12px;line-height:1.3;overflow:hidden",
  title: "font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis",
  artist: "color:#94a3b8;white-space:nowrap;overflow:hidden;text-overflow:ellipsis",
  // A plain range input (HA's own sliders break on old wall-tablet webviews); a vertical swipe still scrolls.
  slider: "flex:1 1 160px;min-width:120px;height:36px;margin:0;touch-action:pan-y;accent-color:#52b788;cursor:pointer",
  pick: (on) => "min-height:36px;padding:4px 12px;border-radius:999px;cursor:pointer;font-size:12px;font-weight:700;"
    + (on ? "color:#e2e8f0;background:rgba(82,183,136,.22);border:1px solid #52b788"
          : "color:rgba(226,240,232,.8);background:rgba(255,255,255,.03);border:1px solid rgba(120,190,155,.22)"),
  more: "min-height:36px;padding:4px 12px;border-radius:8px;cursor:pointer;font-size:12px;font-weight:600;"
    + "background:rgba(255,255,255,.03);border:1px solid rgba(120,190,155,.18);color:rgba(226,240,232,.8)",
  sound: "margin:0 0 6px;padding:2px 0 2px 10px;border-left:2px solid rgba(82,183,136,.35)",
  select: "min-height:36px;max-width:220px;border-radius:8px;padding:4px 6px;background:#0b1710;color:#e2e8f0;border:1px solid rgba(120,190,155,.3);font-size:13px",
  danger: "min-height:36px;padding:4px 12px;border-radius:8px;cursor:pointer;font-size:12px;font-weight:700;background:#7f1d1d;border:1px solid #dc2626;color:#fecaca",
};
const off = ";opacity:.4;cursor:default";
// The transport's and ⏻'s glyphs as text (U+FE0E): Edge and Chrome draw ⏪ and ⏩ as blue colour emoji otherwise.
const TEXT_GLYPH = String.fromCharCode(0xFE0E);
const glyph = (c) => c + TEXT_GLYPH;
const mk = (tag, style, text) => { const n = document.createElement(tag); if (style) n.style.cssText = style; if (text !== undefined) n.textContent = text; return n; };

/**
 * Room controls for one screen. o:
 *   hass()        Home Assistant now (states, entities, devices, areas, callService, user)
 *   model()       the map (room_geometry_m, areas)
 *   settings()    {room_audio_matches, room_audio_ha_speakers, room_audio_matched, room_audio_sources, room_audio_limits}
 *   save(patch)   writes some of those (settings_set); resolves when Home Assistant kept them
 *   admin()       an administrator: may match rooms
 *   toast(m, err), errorText(e), count(word) (the report's room_controls:<word>), redraw() (the open sheet and the map)
 *   openers()     optional: the covers that open a door or a gate (a wall's opener on the map, Devices → Door Openers),
 *                 never offered as shades whatever their device class
 * Returns { looks, sheet, switched, openMatch, canMatch } — functions only (the map card's signature keeps none of its
 * data). canMatch(): may this person open the matching card (an administrator).
 */
export function createRoomControls(o){
  const opt = new Map();   // eid -> {muted?, target?, until}: what a press shows until Home Assistant says
  // eid -> {from, level, until, timer}: the level − / + pressed to (from: what Home Assistant said at the first press),
  // shown at once in the number alone, never by drawing the row again (a row drawn again under a finger lost the next
  // quick press), until Home Assistant says or the window ends. levelEls: the number's node in the open sheet.
  const vol = new Map(), levelEls = new Map();
  // eid -> {level, active, until, sent, sentAt, timer}: a slider being dragged (active) or let go of until `until`: its
  // level is shown, Home Assistant's is not, and the room's sheet is not drawn again under the finger (frozen: the
  // signature it was last drawn with). sliders / plusEls: the open sheet's slider and + per player, kept in step in place.
  const drag = new Map(), sliders = new Map(), plusEls = new Map(), frozen = new Map();
  const soundOpen = new Set();   // the players whose "Sound ›" is open
  const dialogs = new Set();     // the open cards (matching, a picker, Share), closed with the panel
  let share = null;              // the open Share card: {eid, refresh}
  let counted = false;
  // What one sheet() or one draw reads many times (the offered players, the cleaned settings, the rooms, each device's
  // entities), made once for it (withMemo); anything else reads Home Assistant as it is now.
  let memo = null;
  const once = (key, make) => { if (!memo) return make(); if (!memo.has(key)) memo.set(key, make()); return memo.get(key); };
  const withMemo = (m, run) => { const was = memo; memo = m; try { return run(); } finally { memo = was; } };
  const H = () => o.hass() || {};
  const st = (eid) => (H().states || {})[eid];
  const settings = () => o.settings() || {};
  const haOn = () => settings().room_audio_ha_speakers === true;
  const matches = () => once("matches", () => cleanMatches(settings().room_audio_matches));
  const offeredPlayers = () => once("players", () => audioPlayers(H(), haOn()));
  const offeredMap = () => once("playerMap", () => new Map(offeredPlayers().map(p => [p.eid, p])));
  const rooms = () => once("rooms", () => mapRooms(o.model()));
  const soundOf = (eid) => once(`sound:${eid}`, () => soundControls(H(), eid, memo ? once("devices", () => devicesIndex(H())) : null));
  // Set up: the card has kept its picks once (or, from before that was written down, some are kept). Only a house
  // never set up gets the card's guesses, the card opening by itself and the prominent button in every room.
  const setUp = () => settings().room_audio_matched === true || Object.keys(matches()).length > 0;
  const sourcesOf = (eid) => { const all = once("sources", () => cleanSources(settings().room_audio_sources)); return own(all, eid) ? all[eid] : null; };
  /** A player's volume limit (0.1..1; 1: none). */
  const limitOf = (eid) => { const all = once("limits", () => cleanLimits(settings().room_audio_limits)); return own(all, eid) ? all[eid] : 1; };
  // A Control4 room's ⏪ and ⏩: the Control4 integration's control4.media_scan, where it has one.
  const scanOK = () => { const sv = H().services; return !!(sv && sv.control4 && sv.control4.media_scan); };
  const count = (w) => { try { o.count(w); } catch (_) { /* the report is never the error */ } };
  const optOf = (eid) => { const v = opt.get(eid); if (v && Date.now() < v.until) return v; opt.delete(eid); return null; };
  const roomArea = (room) => {
    const r = rooms().find(x => x.name === room);
    if (r) return r.area_id;
    const want = String(room || "").trim().toLowerCase();
    for (const [id, a] of Object.entries(H().areas || {})) if (String((a && a.name) || "").trim().toLowerCase() === want) return id;
    return null;
  };
  /** The room's players in its order: matched, still offered, still in Home Assistant. */
  const playersIn = (room) => {
    const aid = roomArea(room);
    if (!aid) return [];
    const offered = offeredMap();
    return (matches()[aid] || []).map(e => offered.get(e)).filter(p => p && st(p.eid));
  };
  // The redraw after a press: at once (what was pressed), then once Home Assistant has had time to say.
  const later = () => { try { o.redraw(); } catch (_) { /* the sheet may be gone */ } setTimeout(() => { try { o.redraw(); } catch (_) { /* gone */ } }, OPTIMISTIC_MS + 100); };
  // word: the report's (none for Room off's own calls: that press is counted once, as room_off). redraw false: the
  // press drew what it changed itself (a volume's number), nothing is drawn again.
  const call = (domain, service, data, word, name, undo, redraw = true) => {
    if (word) count(word);
    const h = H();
    if (!h || typeof h.callService !== "function") return Promise.resolve(false);
    if (redraw) later();
    return Promise.resolve().then(() => h.callService(domain, service, data)).then(() => true, (e) => {
      if (undo) undo();
      o.toast(`${name}: ${o.errorText(e)}`, true);
      try { o.redraw(); } catch (_) { /* gone */ }
      return false;
    });
  };

  // ── a volume's number ──
  const reported = (eid) => { const a = (st(eid) && st(eid).attributes) || {}; return typeof a.volume_level === "number" ? a.volume_level : null; };
  /** The level a player's number shows: Home Assistant's, or for a while after − / + the level pressed to. Home
   *  Assistant saying something new is shown, unless it is on its way there (between where it was and the pressed
   *  level: the presses it has not caught up with yet are still coming). */
  // A drag with no input for DRAG_IDLE_MS is over, whatever became of its slider (let go off it, its sheet closed): the
  // number never keeps a stale level.
  const dragging = (eid) => { const d = drag.get(eid); return !!d && ((d.active && Date.now() - d.at < DRAG_IDLE_MS) || Date.now() < d.until); };
  /** Every held slider let go of (its sheet closed, a pointer let go anywhere): what was dragged to is sent. */
  function letGo(){ for (const [eid, d] of drag) if (d.active && d.finish) d.finish(); else if (d.active) { d.active = false; d.until = 0; paintLevel(eid); } }
  let letGoHooked = false;
  const hookLetGo = () => {
    if (letGoHooked || typeof document === "undefined" || typeof document.addEventListener !== "function") return;
    letGoHooked = true;
    for (const ev of ["pointerup", "pointercancel"]) document.addEventListener(ev, letGo, true);
  };
  function levelNow(eid){
    if (!playerOn(st(eid))) return reported(eid);   // off: no level of its own, nor one just pressed or dragged to
    if (dragging(eid)) return drag.get(eid).level;
    const r = reported(eid), v = vol.get(eid);
    if (!v || Date.now() >= v.until) return r;
    if (r === null || r === v.from) return v.level;
    const want = v.level - v.from, got = r - v.from;
    return want !== 0 && Math.sign(got) === Math.sign(want) && Math.abs(got) < Math.abs(want) ? v.level : r;
  }
  const levelText = (l) => (l === null ? "—" : String(Math.round(l * 100)));
  /** May + go one step up from l: never past the player's limit (one step that would pass it is refused, not cut
   *  short: Home Assistant steps a player by its own step), and never with a limit and no level known. */
  const upBlocked = (eid, l, step) => { const lim = limitOf(eid); return lim < 1 && (l === null || l + step > lim + 1e-9); };
  /** The number as it is now, in place (the row is not drawn again); the slider too unless it is held, and + greyed at
   *  the player's limit. */
  function paintLevel(eid){
    const l = levelNow(eid), n = levelEls.get(eid), sl = sliders.get(eid), plus = plusEls.get(eid);
    if (n) { const s = levelText(l); if (n.textContent !== s) n.textContent = s; }
    if (sl && !dragging(eid) && l !== null) { const v = String(Math.round(Math.min(l, limitOf(eid)) * 100)); if (sl.value !== v) sl.value = v; }
    if (plus) { const top = upBlocked(eid, l, plus.step); if (plus.btn.disabled !== top) { plus.btn.disabled = top; plus.btn.style.opacity = top ? ".4" : ""; } }
  }
  /** One − / + press: the number moves one step at once (presses add up), then Home Assistant is asked. Never up past
   *  the player's limit. */
  function nudgeLevel(p, dir, step){
    const r = reported(p.eid), shown = levelNow(p.eid), v = vol.get(p.eid);
    if (dir > 0 && upBlocked(p.eid, shown, step)) return;
    if (shown !== null) {
      const going = !!v && Date.now() < v.until && shown === v.level;
      if (v) clearTimeout(v.timer);
      const level = Math.round(Math.max(0, Math.min(dir > 0 ? limitOf(p.eid) : 1, shown + dir * step)) * 10000) / 10000;
      // When the window ends the number is Home Assistant's again, if it never said the pressed one.
      vol.set(p.eid, { from: going ? v.from : r, level, until: Date.now() + OPTIMISTIC_MS,
                       timer: setTimeout(() => paintLevel(p.eid), OPTIMISTIC_MS + 50) });
      paintLevel(p.eid);
    }
    call("media_player", dir > 0 ? "volume_up" : "volume_down", { entity_id: p.eid }, dir > 0 ? "up" : "down", p.name,
      () => { const w = vol.get(p.eid); if (w) clearTimeout(w.timer); vol.delete(p.eid); paintLevel(p.eid); }, false);
  }

  /** {room name: "on" | "muted"} for the map: a room with a player on; muted while its first player is. */
  function looks(){ return withMemo(new Map(), looksOf); }
  function looksOf(){
    if (!counted) { counted = true; count("on"); }
    const out = {};
    for (const r of rooms()) {
      const ps = playersIn(r.name);
      if (!ps.some(p => playerOn(st(p.eid)))) continue;
      const first = st(ps[0].eid), op = optOf(ps[0].eid);
      const muted = op && typeof op.muted === "boolean" ? op.muted : !!(first && first.attributes && first.attributes.is_volume_muted === true);
      out[r.name] = playerOn(first) && muted ? "muted" : "on";
    }
    return out;
  }

  // ── Audio: one row per player ──
  const button = (text, aria, run, disabled, style = S.btn) => {
    const b = mk("button", style + (disabled ? off : ""), text);
    b.setAttribute("aria-label", aria); b.title = aria;
    if (disabled) b.disabled = true;
    else b.addEventListener("click", (e) => { if (e && e.stopPropagation) e.stopPropagation(); run(); });
    return b;
  };
  function audioRow(p){
    const s = st(p.eid), a = (s && s.attributes) || {}, op = optOf(p.eid) || {};
    const na = !s || s.state === "unavailable", on = playerOn(s);
    const muted = typeof op.muted === "boolean" ? op.muted : a.is_volume_muted === true;
    const lvl = levelNow(p.eid);
    const row = mk("div", S.row);
    row.setAttribute("data-eid", p.eid);
    const label = mk("span", S.name);
    label.appendChild(mk("span", S.sys, `${p.system} · `));
    label.appendChild(document.createTextNode(p.name));
    row.appendChild(label);
    row.appendChild(mk("span", S.chip(on), na ? t("Unavailable") : !on ? t("Off") : muted ? t("Muted") : t("On")));
    const btn = button;
    const ctl = mk("span", S.ctl);
    row.appendChild(ctl);
    if (has(s, VOLUME_MUTE)) {
      ctl.appendChild(btn(muted ? t("Unmute") : t("Mute"), muted ? t("Unmute {name}", { name: p.name }) : t("Mute {name}", { name: p.name }), () => {
        opt.set(p.eid, { ...(optOf(p.eid) || {}), muted: !muted, until: Date.now() + OPTIMISTIC_MS });
        call("media_player", "volume_mute", { entity_id: p.eid, is_volume_muted: !muted }, "mute", p.name, () => opt.delete(p.eid));
      }, na));
    }
    const steps = has(s, VOLUME_STEP) || (has(s, VOLUME_SET) && lvl !== null);
    // One press: a player that steps itself (VOLUME_STEP: a Control4 room) moves 1 in 100 unless its state says its
    // volume_step; Home Assistant steps a VOLUME_SET player by its volume_step (0.1 unless it says). The number shows
    // the pressed level at once, in place (the owner, 2026-11-25: "The volume doesn't update fast enough"; before that,
    // a guess counted in tens, and a row drawn again under the finger lost the next quick press).
    const ownStep = Number(a.volume_step) > 0 ? Number(a.volume_step) : 0;
    const step = ownStep || (has(s, VOLUME_STEP) ? SELF_STEP : 0.1);
    const nudge = (dir) => () => nudgeLevel(p, dir, step);
    // A player that sets its level and says what it is has the slider under its row (volumeSlider); − and + stay for
    // every player that steps (VOLUME_STEP: a Control4 room, Home Assistant's own Control4 rooms too, beside their
    // slider) and for one whose level is not known (greyed when it can't step). + is greyed at the player's limit, in
    // place (paintLevel).
    const pm = !(has(s, VOLUME_SET) && lvl !== null) || has(s, VOLUME_STEP);
    plusEls.delete(p.eid);
    if (pm) ctl.appendChild(btn("−", t("{name} volume down", { name: p.name }), nudge(-1), na || !steps));
    const lv = mk("span", S.level, levelText(lvl));
    lv.setAttribute("data-level", "");
    levelEls.set(p.eid, lv);
    ctl.appendChild(lv);
    if (pm) {
      const plus = btn("+", t("{name} volume up", { name: p.name }), nudge(1), na || !steps);
      if (!na && steps) { plusEls.set(p.eid, { btn: plus, step }); if (upBlocked(p.eid, lvl, step)) { plus.disabled = true; plus.style.opacity = ".4"; } }
      ctl.appendChild(plus);
    }
    // On while it is off, for a player that turns on; never a Control4 room's (its turn_on starts the room's last
    // source, else its first video source: it can turn a TV on; a source picked starts the room instead).
    if (!on && !na && has(s, TURN_ON) && p.platform !== "control4") ctl.appendChild(btn(t("On"), t("Turn {name} on", { name: p.name }), () => call("media_player", "turn_on", { entity_id: p.eid }, null, p.name)));
    else if (has(s, TURN_OFF)) ctl.appendChild(btn(glyph("⏻"), t("Turn {name} off", { name: p.name }), () => call("media_player", "turn_off", { entity_id: p.eid }, "off", p.name), na || !on));
    return row;
  }

  /** What a player supports beyond its row, each line only while it does (its supported_features now): what is
   *  playing with the transport, who it is shared with, the slider, the source, the sound mode, then Sound › and
   *  Share › (and the Sound part while open). Nothing for a player with none of them (a Control4 room off). */
  function audioLines(p){
    const s = st(p.eid), out = [];
    if (!s || s.state === "unavailable") return out;
    const a = s.attributes || {}, on = playerOn(s);
    const pic = typeof a.entity_picture === "string" ? a.entity_picture : "";
    const picOK = (pic.startsWith("/") && !pic.startsWith("//")) || pic.startsWith("https://");
    const showNow = (s.state === "playing" || s.state === "paused") && !!(a.media_title || a.media_artist || picOK);
    const tr = on ? transport(p, s) : null;
    if (showNow || tr) {
      const line = mk("div", S.line);
      line.setAttribute("data-audio-now", p.eid);
      if (showNow) {
        // entity_picture: a same-origin path (Home Assistant's proxy) or https, used as it is, no referrer; gone if
        // it fails.
        if (picOK) {
          const img = mk("img", S.thumb);
          img.alt = "";
          img.referrerPolicy = "no-referrer";
          img.addEventListener("error", () => { img.style.display = "none"; });
          img.src = pic;
          line.appendChild(img);
        }
        const text = mk("div", S.playing);
        if (a.media_title) text.appendChild(mk("div", S.title, String(a.media_title)));
        const by = a.media_artist || a.app_name || sourceLabel(p.eid, a.source);
        if (by) text.appendChild(mk("div", S.artist, String(by)));
        line.appendChild(text);
      }
      if (tr) line.appendChild(tr);
      out.push(line);
    }
    const others = groupOthers(p.eid);
    if (others.length) {
      const n = mk("div", S.note + ";margin:0 0 6px", t("with {rooms}", { rooms: others.join(", ") }));
      n.setAttribute("data-audio-group", p.eid);
      out.push(n);
    }
    if (has(s, VOLUME_SET) && levelNow(p.eid) !== null) { const line = mk("div", S.line); line.appendChild(volumeSlider(p)); out.push(line); }
    const src = sourceLine(p, s);
    if (src) out.push(src);
    const mode = on ? modeLine(p, s) : null;
    if (mode) out.push(mode);
    const ctls = soundOf(p.eid), cands = has(s, GROUPING) ? shareCandidates(p) : [];
    if (ctls.length || cands.length) {
      const line = mk("div", S.line);
      if (ctls.length) {
        const word = () => `${t("Sound")} ${soundOpen.has(p.eid) ? "⌄" : "›"}`;
        let part = null;
        const b = button(word(), t("Sound for {name}", { name: p.name }), () => {
          // Opened and closed in place; kept open across redraws (soundOpen, in the signature).
          if (soundOpen.has(p.eid)) { soundOpen.delete(p.eid); if (part) part.remove(); part = null; }
          else {
            soundOpen.add(p.eid);
            part = soundPart(p, soundOf(p.eid));
            if (line.parentNode) line.parentNode.insertBefore(part, line.nextSibling);
          }
          b.textContent = word(); b.setAttribute("aria-expanded", String(soundOpen.has(p.eid)));
        }, false, S.more);
        b.setAttribute("data-audio-sound-btn", p.eid);
        b.setAttribute("aria-expanded", String(soundOpen.has(p.eid)));
        line.appendChild(b);
        if (soundOpen.has(p.eid)) part = soundPart(p, ctls);
        out.push(line);
        if (part) out.push(part);
      }
      if (cands.length) {
        const b = button(`${t("Share")} ›`, t("Share {name} to other rooms", { name: p.name }), () => openShare(p), false, S.more);
        b.setAttribute("data-audio-share-btn", p.eid);
        line.appendChild(b);
        if (!ctls.length) out.push(line);
      }
    }
    return out;
  }
  const sourceLabel = (eid, raw) => { if (!raw) return ""; const c = sourcesOf(eid); return (c && own(c.names, raw) && c.names[raw]) || String(raw); };

  /** The transport, only what the player supports: ⏮, a Control4 room's ⏪ (control4.media_scan, where the Control4
   *  integration has it), play and pause, ⏹, ⏩, ⏭. One toggle only while the state says playing or paused; a player
   *  that is only "on" or "idle" (an OS 2 Control4 room is always just on or off) gets ▶ and ⏸ apart, as a toggle
   *  would always send play. ⏹ where there is no pause, and in a Control4 room (its rooms take stop). */
  function transport(p, s){
    const g = mk("span", S.group), n = { name: p.name };
    g.setAttribute("data-audio-transport", p.eid);
    const add = (text, aria, domain, service, word, extra) => g.appendChild(button(text, aria, () => call(domain, service, { entity_id: p.eid, ...(extra || {}) }, word, p.name)));
    const c4 = p.platform === "control4", P = has(s, PLAY), Z = has(s, PAUSE), now = s.state;
    // ⏪ ⏩: a Control4 room that plays (play or pause), on, where the Control4 integration has control4.media_scan.
    const scan = c4 && (P || Z) && playerOn(s) && scanOK();
    if (has(s, PREVIOUS_TRACK)) add(glyph("⏮"), t("{name} previous", n), "media_player", "media_previous_track", "previous");
    if (scan) add(glyph("⏪"), t("{name} rewind", n), "control4", "media_scan", "scan", { direction: "back" });
    if (P && Z && (now === "playing" || now === "paused")) {
      const playing = now === "playing";
      add(glyph(playing ? "⏸" : "▶"), playing ? t("Pause {name}", n) : t("Play {name}", n), "media_player", "media_play_pause", playing ? "pause" : "play");
    } else if (P && Z) {
      add(glyph("▶"), t("Play {name}", n), "media_player", "media_play", "play");
      add(glyph("⏸"), t("Pause {name}", n), "media_player", "media_pause", "pause");
    } else if (P && now !== "playing") add(glyph("▶"), t("Play {name}", n), "media_player", "media_play", "play");
    else if (Z && now === "playing") add(glyph("⏸"), t("Pause {name}", n), "media_player", "media_pause", "pause");
    if (has(s, STOP) && (!Z || c4)) add(glyph("⏹"), t("Stop {name}", n), "media_player", "media_stop", "pause");
    if (scan) add(glyph("⏩"), t("{name} fast-forward", n), "control4", "media_scan", "scan", { direction: "forward" });
    if (has(s, NEXT_TRACK)) add(glyph("⏭"), t("{name} next", n), "media_player", "media_next_track", "next");
    return g.children.length ? g : null;
  }

  /** A player's volume as a plain range input, 0 to its limit. While it is dragged the number shows the dragged level
   *  at once and Home Assistant is asked at most every SEND_EVERY_MS (volume_set), the level let go at always; Home
   *  Assistant's own level is not shown while it is held and for a short while after (levelNow), and the room's sheet
   *  is not drawn again under the finger (sheet: frozen). */
  function volumeSlider(p){
    const lim = limitOf(p.eid), lvl = levelNow(p.eid);
    const r = mk("input", S.slider);
    r.type = "range"; r.min = "0"; r.max = String(Math.round(lim * 100)); r.step = "1";
    r.value = String(Math.round(Math.min(lvl === null ? 0 : lvl, lim) * 100));
    r.setAttribute("aria-label", t("{name} volume", { name: p.name }));
    r.setAttribute("data-slider", p.eid);
    if (lvl === null) r.disabled = true;
    sliders.set(p.eid, r);
    hookLetGo();
    const take = () => {
      let d = drag.get(p.eid);
      if (!d) { d = { level: 0, active: false, until: 0, at: 0, sent: null, sentAt: 0, timer: 0, finish: null }; drag.set(p.eid, d); }
      d.level = Math.round(Math.min(limitOf(p.eid), Math.max(0, Number(r.value) / 100)) * 100) / 100;
      d.at = Date.now();
      d.finish = finish;
      return d;
    };
    const send = () => {
      const d = drag.get(p.eid);
      if (!d) return;
      if (d.timer) { clearTimeout(d.timer); d.timer = 0; }
      if (d.sent === d.level) return;
      d.sent = d.level; d.sentAt = Date.now();
      call("media_player", "volume_set", { entity_id: p.eid, volume_level: Math.min(d.level, limitOf(p.eid)) }, null, p.name,
        () => { drag.delete(p.eid); paintLevel(p.eid); }, false);
    };
    // Held (a finger or the mouse down): what it shows now is where it starts, nothing to send yet.
    const begin = () => { const d = take(); if (!d.active) { d.active = true; d.sent = d.level; } };
    const move = () => {
      const d = take();
      d.active = true;
      paintLevel(p.eid);
      const wait = SEND_EVERY_MS - (Date.now() - d.sentAt);
      if (wait <= 0) send();
      else if (!d.timer) d.timer = setTimeout(send, wait);
    };
    function finish(){
      const d = drag.get(p.eid);
      if (!d) return;
      if (d.active) {
        d.active = false; d.until = Date.now() + OPTIMISTIC_MS;
        count("slider");
        setTimeout(() => paintLevel(p.eid), OPTIMISTIC_MS + 50);
      }
      send();
    }
    const quiet = (e) => { if (e && e.stopPropagation) e.stopPropagation(); };
    r.addEventListener("input", move);
    r.addEventListener("change", () => { take(); finish(); });
    for (const ev of ["pointerdown", "touchstart"]) r.addEventListener(ev, (e) => { quiet(e); begin(); });
    for (const ev of ["pointerup", "pointercancel", "touchend", "touchcancel", "blur"]) r.addEventListener(ev, finish);
    r.addEventListener("click", quiet);
    return r;
  }

  /** A line of choices: up to CHIPS_MAX as chips, the current one marked; more as one button (the current one's
   *  name) that opens the list (openPicker). pick(value) makes the one call. */
  function pickLine(p, kind, what, items, cur, curLabel, title, grouped, pick){
    const line = mk("div", S.line);
    line.setAttribute(`data-audio-${kind}`, p.eid);
    line.appendChild(mk("span", S.what, what));
    if (items.length <= CHIPS_MAX) {
      const g = mk("span", S.group);
      for (const it of items) {
        const b = button(it.label, it.label, () => { if (it.value !== cur) pick(it.value); }, false, S.pick(it.value === cur));
        b.setAttribute("aria-pressed", String(it.value === cur));
        g.appendChild(b);
      }
      line.appendChild(g);
      // The current one is not among them (hidden by the owner, or not in the player's list): said, to read only.
      if (cur && !items.some(it => it.value === cur)) line.appendChild(mk("span", S.note + ";margin:0", curLabel || String(cur)));
    } else {
      const b = button(`${curLabel || t("Pick one")} ›`, title, () => openPicker(title, items, cur, grouped, pick), false,
        S.more + ";max-width:240px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap");
      b.setAttribute("data-audio-list", kind);
      line.appendChild(b);
    }
    return line;
  }
  /** The source line (SELECT_SOURCE with a source_list): the owner's names, without his hidden ones, in his order.
   *  While the player is off too where picking a source starts it (a Control4 room, a player that turns on). */
  function sourceLine(p, s){
    const a = s.attributes || {};
    if (!has(s, SELECT_SOURCE)) return null;
    // Off, only where a source starts it: a Control4 room, or a player that turns on.
    if (!playerOn(s) && p.platform !== "control4" && !has(s, TURN_ON)) return null;
    const items = tidySources(a.source_list, sourcesOf(p.eid)).map(x => ({ value: x.raw, label: x.label }));
    if (!items.length) return null;
    const op = optOf(p.eid) || {}, cur = typeof op.source === "string" ? op.source : a.source;
    return pickLine(p, "source", t("Source"), items, cur, sourceLabel(p.eid, cur), t("Source for {name}", { name: p.name }), false, (v) => {
      opt.set(p.eid, { ...(optOf(p.eid) || {}), source: v, until: Date.now() + OPTIMISTIC_MS });
      call("media_player", "select_source", { entity_id: p.eid, source: v }, "source", p.name, () => { const w = optOf(p.eid); if (w) delete w.source; });
    });
  }
  /** The sound mode line (SELECT_SOUND_MODE with a sound_mode_list), while the player is on; a long list grouped
   *  (groupModes); what is decoded now (a Denon's sound_mode_raw) beside it, to read only. */
  function modeLine(p, s){
    const a = s.attributes || {};
    const list = strings(a.sound_mode_list);
    if (!has(s, SELECT_SOUND_MODE) || !list.length) return null;
    const op = optOf(p.eid) || {}, cur = typeof op.mode === "string" ? op.mode : a.sound_mode;
    const line = pickLine(p, "mode", t("Mode"), list.map(m => ({ value: m, label: m })), cur, cur, t("Sound mode for {name}", { name: p.name }), list.length > LONG_MODES, (v) => {
      opt.set(p.eid, { ...(optOf(p.eid) || {}), mode: v, until: Date.now() + OPTIMISTIC_MS });
      call("media_player", "select_sound_mode", { entity_id: p.eid, sound_mode: v }, "sound_mode", p.name, () => { const w = optOf(p.eid); if (w) delete w.mode; });
    });
    if (a.sound_mode_raw && a.sound_mode_raw !== cur) {
      const raw = mk("span", S.note + ";margin:0", t("Now: {mode}", { mode: String(a.sound_mode_raw) }));
      raw.setAttribute("data-audio-mode-raw", "");
      line.appendChild(raw);
    }
    return line;
  }

  /** A player's Sound part: one row per control (soundControls). */
  function soundPart(p, ctls){
    const box = mk("div", S.sound);
    box.setAttribute("data-audio-sound", p.eid);
    for (const c of ctls) box.appendChild(soundRow(c));
    return box;
  }
  const optKey = (c) => (c.domain === "denonavr" ? `${c.eid}#dynamic_eq` : c.eid);
  const decimals = (step) => Math.min(2, (String(step).split(".")[1] || "").length);
  /** number: − value + (its own min, max and step; number.set_value); switch: a toggle; select: its options; a Denon's
   *  Dynamic EQ: a toggle (denonavr.set_dynamic_eq). Each shown at once as pressed, until Home Assistant says. */
  function soundRow(c){
    const s = st(c.eid) || {}, a = s.attributes || {}, label = SOUND[c.key](), key = optKey(c), op = optOf(key) || {};
    const row = mk("div", S.row + ";padding:3px 0");
    row.setAttribute("data-sound", c.key);
    row.appendChild(mk("span", S.name, label));
    if (c.domain === "number") {
      const step = Number(a.step) > 0 ? Number(a.step) : 1;
      const lo = Number.isFinite(Number(a.min)) && a.min !== null ? Number(a.min) : -Infinity, hi = Number.isFinite(Number(a.max)) && a.max !== null ? Number(a.max) : Infinity;
      const v = typeof op.value === "number" ? op.value : Number(s.state);
      const ok = Number.isFinite(v) && s.state !== "" && s.state !== null && s.state !== undefined;
      const set = (dir) => () => {
        const nv = Math.round(Math.max(lo, Math.min(hi, v + dir * step)) * 1000) / 1000;
        opt.set(key, { value: nv, until: Date.now() + OPTIMISTIC_MS });
        call("number", "set_value", { entity_id: c.eid, value: nv }, "sound", label, () => opt.delete(key));
      };
      const g = mk("span", S.ctl);
      g.appendChild(button("−", t("{what} down", { what: label }), set(-1), !ok || v <= lo));
      g.appendChild(mk("span", S.level + ";min-width:48px", ok ? `${v.toFixed(decimals(step))}${a.unit_of_measurement ? ` ${a.unit_of_measurement}` : ""}` : "—"));
      g.appendChild(button("+", t("{what} up", { what: label }), set(1), !ok || v >= hi));
      row.appendChild(g);
    } else if (c.domain === "select") {
      const sel = mk("select", S.select);
      sel.setAttribute("aria-label", label);
      const cur = typeof op.option === "string" ? op.option : s.state;
      const opts = strings(a.options);
      // Its state is none of its options (unknown, or a mode the list lacks): shown first, never picked.
      if (!opts.includes(cur)) {
        const n = mk("option", null, cur && cur !== "unknown" ? String(cur) : t("Pick one"));
        n.value = ""; n.disabled = true; n.selected = true;
        sel.appendChild(n);
      }
      for (const x of opts) { const n = mk("option", null, x); n.value = x; if (x === cur) n.selected = true; sel.appendChild(n); }
      sel.value = opts.includes(cur) ? cur : "";
      sel.addEventListener("click", (e) => { if (e && e.stopPropagation) e.stopPropagation(); });
      sel.addEventListener("change", () => {
        const v = sel.value;
        if (!v || v === cur) return;
        opt.set(key, { option: v, until: Date.now() + OPTIMISTIC_MS });
        call("select", "select_option", { entity_id: c.eid, option: v }, "sound", label, () => opt.delete(key));
      });
      row.appendChild(sel);
    } else {
      const isOn = typeof op.on === "boolean" ? op.on : c.domain === "switch" ? s.state === "on" : a.dynamic_eq === true;
      const b = button(isOn ? t("On") : t("Off"), label, () => {
        opt.set(key, { on: !isOn, until: Date.now() + OPTIMISTIC_MS });
        if (c.domain === "switch") call("switch", isOn ? "turn_off" : "turn_on", { entity_id: c.eid }, "sound", label, () => opt.delete(key));
        else call("denonavr", "set_dynamic_eq", { entity_id: c.eid, dynamic_eq: !isOn }, "sound", label, () => opt.delete(key));
      }, false, S.pick(isOn));
      b.setAttribute("aria-pressed", String(isOn));
      row.appendChild(b);
    }
    return row;
  }
  const soundSig = (eid) => soundOf(eid).map(c => { const s = st(c.eid) || {}, a = s.attributes || {}, op = optOf(optKey(c));
    return [c.eid, c.key, s.state, a.options, a.min, a.max, a.step, a.unit_of_measurement, a.dynamic_eq, op && [op.value, op.on, op.option]]; });

  // ── Share: other rooms' players on the same platform join this one (GROUPING works within one platform) ──
  const areaOfPlayer = (eid) => { const m = matches(); return Object.keys(m).find(a => m[a].includes(eid)) || null; };
  const roomName = (aid) => { const r = rooms().find(x => x.area_id === aid), a = own(H().areas, aid) ? H().areas[aid] : null; return r ? r.name : (a && a.name) || null; };
  /** The rooms (else the players) a player's group plays in besides itself. */
  function groupOthers(eid){
    const g = ((st(eid) || {}).attributes || {}).group_members;
    if (!Array.isArray(g)) return [];
    return g.filter(e => typeof e === "string" && e !== eid).map(e => { const aid = areaOfPlayer(e); return (aid && roomName(aid)) || nameOf(st(e), e); });
  }
  /** The other rooms' matched players on this player's platform that group too: [{eid, name, platform, room}]. */
  function shareCandidates(p){
    const mine = areaOfPlayer(p.eid), offered = offeredMap(), out = [];
    for (const [aid, list] of Object.entries(matches())) {
      if (aid === mine) continue;
      for (const e of list) { const q = offered.get(e), s = st(e); if (q && s && q.platform === p.platform && has(s, GROUPING)) out.push({ ...q, room: roomName(aid) || q.name }); }
    }
    return out.sort((x, y) => x.room.localeCompare(y.room));
  }
  /** The Share card: a tick per room (media_player.join this player with it; untick: unjoin that one), each room in
   *  the group with its own slider, and Leave group (unjoin this one). Drawn again as Home Assistant says (refresh,
   *  from sheet), never while one of its sliders is held. */
  function openShare(p){
    if (share) share.close();
    const d = dialog("data-audio-share", 10002, 460);
    const pending = new Map();   // eid -> {on, until}: a tick shown at once, until Home Assistant says
    const members = () => { const g = ((st(p.eid) || {}).attributes || {}).group_members; return Array.isArray(g) ? g : []; };
    const inGroup = (e) => { const w = pending.get(e); return w && Date.now() < w.until ? w.on : members().includes(e); };
    let drawn = null;
    const sigNow = () => JSON.stringify([members(), shareCandidates(p).map(c => [c.eid, inGroup(c.eid), reported(c.eid) !== null, features(st(c.eid))])]);
    const draw = () => {
      drawn = sigNow();
      d.box.replaceChildren();
      d.box.appendChild(cardHead(d, t("Share {name}", { name: p.name }), t("The ticked rooms play what this room plays.")));
      for (const c of shareCandidates(p)) {
        const row = mk("div", S.row + ";border-bottom:1px solid rgba(120,190,155,.08)");
        row.setAttribute("data-eid", c.eid);
        const lab = mk("label", "display:flex;align-items:center;gap:10px;min-height:36px;flex:1 1 150px;cursor:pointer;font-size:13px");
        const cb = mk("input", "width:20px;height:20px");
        cb.type = "checkbox"; cb.checked = inGroup(c.eid);
        cb.setAttribute("aria-label", t("Play in {room}", { room: c.room }));
        cb.addEventListener("change", () => {
          const want = !!cb.checked;
          pending.set(c.eid, { on: want, until: Date.now() + OPTIMISTIC_MS });
          // Joined to the group's leader (its first member; this player when it is in no group).
          if (want) call("media_player", "join", { entity_id: members()[0] || p.eid, group_members: [c.eid] }, "share", p.name, () => pending.delete(c.eid));
          else call("media_player", "unjoin", { entity_id: c.eid }, "unshare", c.name, () => pending.delete(c.eid));
          draw();
        });
        lab.appendChild(cb); lab.appendChild(mk("span", null, c.room));
        row.appendChild(lab);
        if (inGroup(c.eid) && has(st(c.eid), VOLUME_SET) && reported(c.eid) !== null) {
          row.appendChild(volumeSlider(c));
          const lv = mk("span", S.level, levelText(levelNow(c.eid)));
          levelEls.set(c.eid, lv);
          row.appendChild(lv);
        }
        d.box.appendChild(row);
      }
      const foot = mk("div", "display:flex;justify-content:space-between;align-items:center;gap:10px;margin-top:12px");
      const others = members().filter(e => e !== p.eid);
      if (others.length && others.some(inGroup)) {
        const leave = button(t("Leave group"), t("{name} leaves the group", { name: p.name }), () => {
          for (const e of others) pending.set(e, { on: false, until: Date.now() + OPTIMISTIC_MS });
          call("media_player", "unjoin", { entity_id: p.eid }, "unshare", p.name);
          draw();
        }, false, S.more);
        leave.setAttribute("data-audio-leave", "");
        foot.appendChild(leave);
      } else foot.appendChild(mk("span"));
      const done = mk("button", S.primary, t("Done"));
      done.addEventListener("click", d.close);
      foot.appendChild(done);
      d.box.appendChild(foot);
    };
    const me = { eid: p.eid, close: d.close, refresh: () => { if (shareCandidates(p).some(c => dragging(c.eid))) return; if (sigNow() !== drawn) draw(); } };
    share = me;
    d.onClose = () => { if (share === me) share = null; };
    draw();
    return me;
  }

  // ── All audio off: every matched player that is on, in every room ──
  /** [[player, service, extra]]: every matched player that is sounding: playing or buffering, or on with no media
   *  state (a Control4 room) where it turns off. Paused and idle players are silent already (a Sonos or a Music
   *  Assistant player sits idle for good): left alone. Off where it turns off, else paused while playing, else
   *  stopped, else muted. */
  function allOffTargets(){
    const offered = offeredMap(), out = [];
    for (const list of Object.values(matches())) for (const e of list) {
      const q = offered.get(e), s = st(e);
      if (!q || !s) continue;
      const playing = SOUNDING.has(String(s.state));
      if (!playing && !(playerOn(s) && !MEDIA_STATES.has(String(s.state)) && has(s, TURN_OFF))) continue;
      if (has(s, TURN_OFF)) out.push([q, "turn_off"]);
      else if (playing && has(s, PAUSE)) out.push([q, "media_pause"]);
      else if (has(s, STOP)) out.push([q, "media_stop"]);
      else if (has(s, VOLUME_MUTE)) out.push([q, "volume_mute", { is_volume_muted: true }]);
    }
    return out;
  }
  /** A quiet button under the players; it asks first, in place. */
  function allOffButton(){
    const wrap = mk("div", "display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:4px 0 2px");
    wrap.setAttribute("data-audio-all-off", "");
    const rest = () => { wrap.replaceChildren(); wrap.appendChild(button(t("All audio off"), t("Turn off every room's audio"), ask, false, S.more)); };
    const ask = () => {
      wrap.replaceChildren();
      wrap.appendChild(mk("span", "font-size:12px;font-weight:700", t("Turn off every room's audio?")));
      wrap.appendChild(button(t("Turn off"), t("Turn off every room's audio"), () => {
        count("all_off");
        for (const [q, how, extra] of allOffTargets()) call("media_player", how, { entity_id: q.eid, ...(extra || {}) }, null, q.name);
        rest();
      }, false, S.danger));
      wrap.appendChild(button(t("Cancel"), t("Cancel"), rest, false, S.more));
    };
    rest();
    return wrap;
  }
  const systemsPresent = () => [...new Set(offeredPlayers().map(p => p.platform))];
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
    let doors = null;
    try { doors = typeof o.openers === "function" ? o.openers() : null; } catch (_) { doors = null; }
    for (const [eid, s] of Object.entries(H().states || {})) {
      if (!eid.startsWith("cover.") || areaOf(H(), eid) !== aid || !s || s.state === "unavailable") continue;
      if (NOT_SHADES.has(String((s.attributes || {}).device_class || "")) || (doors && doors.has(eid))) continue;
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
   *  above the lights and Shades and Climate below them; each part null when the room has nothing for it or the host
   *  has it off. lightsOn: the room's lights on now that Home Assistant can reach; setMany: the sheet's own lights
   *  switch; parts: {audio, shades, climate}, which are on for this screen (the host's ⋯ lines and add-ons). */
  function sheet(room, opts = {}){
    // One memo for the whole sheet and its Audio draw (the host draws it at once when its signature changed).
    const m = new Map(), out = withMemo(m, () => sheetOf(room, opts));
    if (out.before) { const draw = out.before.draw; out.before.draw = () => withMemo(m, draw); }
    return out;
  }
  function sheetOf(room, { lightsOn = [], setMany = null, parts = { audio: true, shades: true, climate: true } } = {}){
    const h = H(), aid = roomArea(room);
    const want = parts || {};
    // The status line (Climate's): the median temperature and humidity of the room's sensors.
    const temps = [], hums = [];
    if (aid && want.climate) for (const [eid, s] of Object.entries(h.states || {})) {
      if (!eid.startsWith("sensor.") || !s || areaOf(h, eid) !== aid) continue;
      const v = Number(s.state), dc = (s.attributes || {}).device_class;
      if (!Number.isFinite(v) || s.state === "" || s.state === null) continue;
      if (dc === "temperature") temps.push(v); else if (dc === "humidity") hums.push(v);
    }
    const mt = median(temps), mh = median(hums);
    const status = [mt === null ? null : `${one(mt)}°`, mh === null ? null : `${Math.round(mh)} %`].filter(Boolean).join(" · ") || null;
    const players = want.audio ? playersIn(room) : [];
    const onPlayers = players.filter(p => playerOn(st(p.eid)) && has(st(p.eid), TURN_OFF));
    // Room off is Audio's: without the players it would be All lights off again.
    const n = lightsOn.length + onPlayers.length;
    const roomOff = want.audio && n ? { label: t("Room off ({n})", { n }), run: () => {
      count("room_off");
      if (lightsOn.length && typeof setMany === "function") setMany(lightsOn, false);
      for (const p of onPlayers) call("media_player", "turn_off", { entity_id: p.eid }, null, p.name);
    } } : null;
    // Audio: the room's players; the matching button after them. In a house never set up, the button alone,
    // prominent, in every room (where else would one start).
    const none = want.audio && !setUp();
    const offered = none ? audioPlayers(h, haOn()).length : 0;
    // A level is not in the signature, only whether there is one: a new one goes into the number in place, so a row
    // is never drawn again between quick presses.
    // The full card's lines go in too (what is playing, the source, the mode, the group, the Sound entities' states,
    // the owner's names and limit), never a level.
    const audioSig = players.map(p => { const s = st(p.eid), a = (s && s.attributes) || {}, op = optOf(p.eid);
      return [p.eid, p.system, p.name, s && s.state, typeof a.volume_level === "number", a.volume_step, a.is_volume_muted, features(s), op && op.muted,
        p.platform, a.source, a.source_list, a.sound_mode, a.sound_mode_list, a.sound_mode_raw, a.media_title, a.media_artist, a.app_name,
        a.entity_picture, a.group_members, groupOthers(p.eid), op && op.source, op && op.mode, limitOf(p.eid), sourcesOf(p.eid),
        soundOpen.has(p.eid), soundSig(p.eid), has(s, GROUPING) ? shareCandidates(p).map(c => c.eid) : null]; });
    for (const p of players) paintLevel(p.eid);
    if (share) share.refresh();
    const allOff = players.length > 0 && allOffTargets().length > 0;
    let sig = JSON.stringify([audioSig, none, offered, !!o.admin(), systemsPresent(), allOff, scanOK()]);
    // A slider held (or just let go of) in this room: the signature it was last drawn with, so the sheet is not drawn
    // again under the finger; what changed meanwhile is drawn after.
    if (players.some(p => dragging(p.eid)) && frozen.has(room)) sig = frozen.get(room);
    else frozen.set(room, sig);
    const before = players.length || (none && offered) ? {
      sig,
      draw: () => {
        const sec = section(t("Audio"), "audio");
        for (const p of players) { sec.appendChild(audioRow(p)); for (const n of audioLines(p)) sec.appendChild(n); }
        sec.appendChild(matchButton(!players.length));
        if (allOff) sec.appendChild(allOffButton());
        return sec;
      } } : null;
    const shades = aid && want.shades ? shadesOf(aid) : [], climate = aid && want.climate ? climateOf(aid) : [];
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
  /** The switch was ticked (on) on this screen: in a house never set up, the matching card opens for an administrator. */
  function switched(on){
    if (on && o.admin() && !setUp()) openMatch();
  }

  // ── The cards over the page: the matching card, the owner's sources, a picker, Share ──
  /** A card over the page, its box marked with `attr`; Escape and Tab held in it (dialog_keys.js). */
  function dialog(attr, z, width){
    const overlay = mk("div", `position:fixed;inset:0;z-index:${z};background:rgba(3,8,5,.62);backdrop-filter:blur(6px);`
      + "-webkit-backdrop-filter:blur(6px);display:flex;justify-content:center;align-items:center;padding:12px;box-sizing:border-box");
    const box = mk("div", `width:100%;max-width:${width}px;max-height:86vh;overflow:auto;padding:14px 16px 16px;box-sizing:border-box;`
      + "background:linear-gradient(180deg,#101f15,#0b1710);border:1px solid rgba(120,190,155,.3);border-radius:16px;color:#e2e8f0;"
      + "font-family:Inter,system-ui,sans-serif;box-shadow:0 12px 50px rgba(0,0,0,.6)");
    box.setAttribute("role", "dialog"); box.setAttribute("aria-modal", "true"); box.setAttribute(attr, "");
    let open = true, release = () => {};
    const d = { overlay, box, onClose: null, close: () => {
      if (!open) return;
      open = false; dialogs.delete(d); overlay.remove(); release();
      if (d.onClose) d.onClose();
    } };
    overlay.addEventListener("click", (e) => { if (e.target === overlay) d.close(); });
    overlay.appendChild(box);
    document.body.appendChild(overlay);
    dialogs.add(d);
    release = KEYS && KEYS.holdKeys ? KEYS.holdKeys(box, { close: d.close, modal: true }) : () => {};
    return d;
  }
  /** A card's head: its title, a line under it, ✕. */
  function cardHead(d, title, sub){
    const head = mk("div", "display:flex;justify-content:space-between;align-items:flex-start;gap:10px;margin-bottom:8px");
    const hl = mk("div");
    hl.appendChild(mk("div", "font-weight:800;font-size:16px", title));
    if (sub) hl.appendChild(mk("div", "font-size:12px;color:#94a3b8;margin-top:2px", sub));
    head.appendChild(hl);
    const x = mk("button", S.quiet, "✕"); x.setAttribute("aria-label", t("Close")); x.addEventListener("click", d.close); head.appendChild(x);
    return head;
  }
  /** A long list of sources or sound modes: a filter box past LONG_MODES, the modes grouped (groupModes); one press
   *  picks and closes. */
  function openPicker(title, items, cur, grouped, pick){
    const d = dialog("data-audio-picker", 10002, 440);
    let q = "";
    d.box.appendChild(cardHead(d, title));
    const list = mk("div");
    const fill = () => {
      list.replaceChildren();
      const shown = items.filter(it => !q || String(it.label).toLowerCase().includes(q));
      const groups = grouped ? groupModes(shown.map(it => it.value)).map(g => ({ label: g.label, items: g.items.map(v => shown.find(it => it.value === v)) }))
        : [{ label: null, items: shown }];
      for (const g of groups) {
        if (g.label) list.appendChild(mk("div", S.head + ";margin-top:8px", g.label));
        const wrap = mk("div", "display:flex;flex-wrap:wrap;gap:6px;padding:4px 0");
        for (const it of g.items) {
          const b = button(it.value === cur ? `✓ ${it.label}` : it.label, it.label, () => { d.close(); if (it.value !== cur) pick(it.value); }, false, S.pick(it.value === cur));
          b.setAttribute("aria-pressed", String(it.value === cur));
          b.setAttribute("data-value", it.value);
          wrap.appendChild(b);
        }
        list.appendChild(wrap);
      }
      if (!shown.length) list.appendChild(mk("div", S.note, t("Nothing matches.")));
    };
    if (items.length > LONG_MODES) {
      const f = mk("input", S.select + ";width:100%;max-width:none;box-sizing:border-box;margin:0 0 8px");
      f.type = "search"; f.placeholder = t("Filter");
      f.setAttribute("aria-label", t("Filter")); f.setAttribute("data-audio-filter", "");
      f.addEventListener("input", () => { q = String(f.value || "").trim().toLowerCase(); fill(); });
      d.box.appendChild(f);
    }
    d.box.appendChild(list);
    fill();
    return d;
  }

  // ── The match card ──
  let card = null;
  function openMatch(){
    if (card || !o.admin()) return;
    count("match_open");
    const saved = matches(), fresh = !setUp();
    let ha = haOn();
    const rooms = mapRooms(o.model());
    // The draft: {area_id: [eid...]} in each room's order; the card's guesses only in a house never set up.
    let draft = fresh ? prefill(audioPlayers(H(), ha), rooms, H()) : JSON.parse(JSON.stringify(saved));
    // The owner's tidy-up, kept as each edit is made too: each player's sources and its volume limit.
    let srcDraft = cleanSources(settings().room_audio_sources);
    const limDraft = cleanLimits(settings().room_audio_limits);
    const d = dialog("data-room-match-card", 10001, 560), box = d.box, close = d.close;
    d.onClose = () => { card = null; };
    const roomOf = (eid) => Object.keys(draft).find(a => draft[a].includes(eid)) || "";
    const move = (eid, aid) => {
      for (const a of Object.keys(draft)) { draft[a] = draft[a].filter(e => e !== eid); if (!draft[a].length) delete draft[a]; }
      if (aid) (draft[aid] = draft[aid] || []).push(eid);
    };
    // Every pick is kept as it is made (the owner, 2026-11-25: a Save button left unpressed lost the matches): no Save,
    // no Cancel, only Done. One write at a time, in order; the card's own line says whether the last one was kept.
    let chain = Promise.resolve(), status = "";
    const savedOnce = new Set();   // the report's words already counted for this card: each once
    const write = (patch, word, refused) => {
      status = t("Saving…"); paintStatus();
      chain = chain.then(() => o.save(patch)).then(() => {
        if (!savedOnce.has(word)) { savedOnce.add(word); count(word); }
        status = t("Saved"); paintStatus();
        try { o.redraw(); } catch (_) { /* gone */ }
      }, (e) => {
        status = t("Not saved"); paintStatus();
        o.toast(refused(o.errorText(e)), true);
      });
      return chain;
    };
    // The draft as it is, cleaned only: a player the card can't show now (hidden, not loaded yet, a Home Assistant
    // speaker while those are not offered) or a room whose map name differs keeps its match (playersIn reads only
    // what is there).
    const persist = () => write({ room_audio_matches: cleanMatches(draft), room_audio_ha_speakers: ha, room_audio_matched: true }, "match_saved",
      (why) => t("Could not save the matches: {why}", { why }));
    const tidied = (patch, word) => write(patch, word, (why) => t("Could not save the audio setup: {why}", { why }));
    /** Under a player's row: its volume limit (off, or 10 to 100 %) and, with a source list, Sources ›. Null with neither. */
    const tidyLine = (p) => {
      const s = st(p.eid), line = mk("div", S.line + ";padding:0 0 8px");
      line.setAttribute("data-audio-tidy", p.eid);
      if (features(s) & (VOLUME_SET | VOLUME_STEP)) {
        const lab = mk("label", "display:inline-flex;align-items:center;gap:6px;font-size:12px;color:#94a3b8");
        lab.appendChild(document.createTextNode(t("Volume limit")));
        const sel = mk("select", S.select);
        sel.setAttribute("aria-label", t("Volume limit for {name}", { name: p.name }));
        sel.setAttribute("data-audio-limit", p.eid);
        const none = mk("option", null, t("No limit")); none.value = ""; sel.appendChild(none);
        const kept = own(limDraft, p.eid) ? limDraft[p.eid] : null;
        const steps = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(n => n / 10);
        if (kept !== null && !steps.includes(kept)) steps.push(kept);   // kept between the steps (0.35): offered as it is
        for (const v of steps.sort((x, y) => x - y)) { const op = mk("option", null, `${Math.round(v * 100)} %`); op.value = String(v); sel.appendChild(op); }
        sel.value = kept !== null ? String(kept) : "";
        sel.addEventListener("change", () => {
          const v = sel.value ? Number(sel.value) : null;
          if (v === (limDraft[p.eid] || null)) return;
          if (v) limDraft[p.eid] = v; else delete limDraft[p.eid];
          tidied({ room_audio_limits: cleanLimits(limDraft) }, "limit_saved");
        });
        lab.appendChild(sel);
        line.appendChild(lab);
      }
      if (capped(((s && s.attributes) || {}).source_list).length) {
        const b = button(`${t("Sources")} ›`, t("Sources for {name}", { name: p.name }), () => openSources(p), false, S.more);
        b.setAttribute("data-audio-sources", p.eid);
        line.appendChild(b);
      }
      return line.children.length ? line : null;
    };
    /** A player's sources: each renamed (a text field), hidden (its tick off) and ordered (▲ ▼), kept as each edit is
     *  made (room_audio_sources). Home Assistant's own names stay as they are. */
    const openSources = (p) => {
      const sd = dialog("data-audio-sources-card", 10002, 500);
      const renames = new Map(), pendingRenames = new Map();   // source -> its typing timer / its unsaved name's commit
      sd.onClose = () => { for (const commit of [...pendingRenames.values()]) commit(); pendingRenames.clear(); };
      const conf = () => (own(srcDraft, p.eid) ? srcDraft[p.eid] : { names: Object.create(null), hidden: [], order: [] });
      const edit = (fn) => {
        const c = conf(), next = { names: Object.assign(Object.create(null), c.names), hidden: [...c.hidden], order: [...c.order] };
        fn(next);
        srcDraft = cleanSources({ ...srcDraft, [p.eid]: next });
        tidied({ room_audio_sources: srcDraft }, "sources_saved");
      };
      const draw = () => {
        for (const commit of [...pendingRenames.values()]) commit();   // a name being typed is kept before the rows go
        sd.box.replaceChildren();
        sd.box.appendChild(cardHead(sd, t("Sources for {name}", { name: p.name }), t("Rename, hide and order the sources its card offers. Home Assistant keeps its own names.")));
        // As the server keeps them: the first 100 sources, none over 100 long (capped).
        const all = orderSources(capped(((st(p.eid) || {}).attributes || {}).source_list), conf());
        all.forEach((x, i) => {
          const row = mk("div", S.row + ";border-bottom:1px solid rgba(120,190,155,.08)");
          row.setAttribute("data-source", x.raw);
          // The tick and the source's name are one label, 36 px tall: a press anywhere on them shows or hides it.
          const lab = mk("label", "display:flex;align-items:center;gap:10px;min-height:36px;flex:1 1 140px;min-width:0;cursor:pointer;font-size:13px");
          const cb = mk("input", "width:22px;height:22px;margin:0;flex:0 0 auto");
          cb.type = "checkbox"; cb.checked = !x.hidden;
          cb.setAttribute("aria-label", t("Show {source}", { source: x.raw }));
          cb.addEventListener("change", () => { const show = !!cb.checked; edit(c => { c.hidden = show ? c.hidden.filter(v => v !== x.raw) : [...c.hidden, x.raw]; }); draw(); });
          lab.appendChild(cb);
          lab.appendChild(mk("span", "overflow:hidden;text-overflow:ellipsis", x.raw));
          row.appendChild(lab);
          const name = mk("input", S.select + ";flex:1 1 140px;max-width:none;box-sizing:border-box");
          name.type = "text"; name.value = x.label === x.raw ? "" : x.label; name.placeholder = x.raw; name.maxLength = 60;
          name.setAttribute("aria-label", t("Name for {source}", { source: x.raw }));
          // Kept as it is typed (a pause of RENAME_MS), on leaving the field, and when the card closes (Escape too).
          const commit = () => {
            clearTimeout(renames.get(x.raw)); renames.delete(x.raw); pendingRenames.delete(x.raw);
            const v = String(name.value || "").trim(), c = conf(), was = own(c.names, x.raw) ? c.names[x.raw] : "";
            if ((v && v !== x.raw ? v.slice(0, 60) : "") === was) return;
            edit(n => { if (v && v !== x.raw) n.names[x.raw] = v; else delete n.names[x.raw]; });
          };
          name.addEventListener("input", () => { clearTimeout(renames.get(x.raw)); renames.set(x.raw, setTimeout(commit, RENAME_MS)); pendingRenames.set(x.raw, commit); });
          name.addEventListener("change", () => { pendingRenames.delete(x.raw); commit(); });
          row.appendChild(name);
          const arrow = (text, aria, j, can) => {
            const b = button(text, aria, () => { const ord = all.map(y => y.raw); [ord[i], ord[j]] = [ord[j], ord[i]]; edit(c => { c.order = ord; }); draw(); }, !can);
            return b;
          };
          row.appendChild(arrow("▲", t("Earlier in the list"), i - 1, i > 0));
          row.appendChild(arrow("▼", t("Later in the list"), i + 1, i < all.length - 1));
          sd.box.appendChild(row);
        });
        const foot = mk("div", "display:flex;justify-content:flex-end;margin-top:12px");
        const done = mk("button", S.primary, t("Done"));
        done.addEventListener("click", sd.close);
        foot.appendChild(done);
        sd.box.appendChild(foot);
      };
      draw();
      return sd;
    };
    let statusEl = null;
    const paintStatus = () => { if (statusEl) statusEl.textContent = status; };
    const draw = () => {
      box.replaceChildren();
      const players = audioPlayers(H(), ha);
      const sys = [...new Set(players.map(p => p.platform))];
      box.appendChild(cardHead(d, sys.length === 1 && sys[0] === "control4" ? t("Match Control4 to HA") : t("Match rooms"),
        t("Pick the room each player is in. Several can share a room: the first in a room is the one the map's speaker follows.")));
      // Home Assistant's own speakers: off unless ticked.
      const lab = mk("label", "display:flex;align-items:center;gap:8px;font-size:13px;padding:6px 0 8px;cursor:pointer");
      const cb = mk("input"); cb.type = "checkbox"; cb.checked = ha; cb.setAttribute("data-ha-speakers", "");
      cb.addEventListener("change", () => { ha = !!cb.checked; draw(); persist(); });
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
        sel.value = rooms.some(r => r.area_id === at) ? at : "";   // matched to an area not on the map: "Not on the map"
        sel.addEventListener("change", () => { move(p.eid, sel.value); draw(); persist(); });
        row.appendChild(sel);
        const list = at ? draft[at] : [];
        if (list.length > 1) {
          const i = list.indexOf(p.eid);
          if (i === 0) row.appendChild(mk("span", S.chip(true), t("First in this room")));
          const arrow = (text, aria, j, can) => {
            const b = mk("button", S.btn + ";min-width:34px;min-height:32px;font-size:12px" + (can ? "" : off), text);
            b.setAttribute("aria-label", aria); b.title = aria;
            if (!can) b.disabled = true;
            else b.addEventListener("click", () => { const l = draft[at]; [l[i], l[j]] = [l[j], l[i]]; draw(); persist(); });
            return b;
          };
          row.appendChild(arrow("▲", t("Earlier in this room"), i - 1, i > 0));
          row.appendChild(arrow("▼", t("Later in this room"), i + 1, i < list.length - 1));
        }
        box.appendChild(row);
        const tidy = tidyLine(p);
        if (tidy) box.appendChild(tidy);
      }
      const foot = mk("div", "display:flex;justify-content:flex-end;align-items:center;gap:10px;margin-top:12px");
      statusEl = mk("span", "font-size:12px;color:#94a3b8", status);
      statusEl.setAttribute("data-room-match-status", "");
      foot.appendChild(statusEl);
      const done = mk("button", S.primary, t("Done"));
      done.setAttribute("data-room-match-done", "");
      done.addEventListener("click", close);
      foot.appendChild(done);
      box.appendChild(foot);
    };
    card = { overlay: d.overlay, close };
    draw();
    // Never set up: the card's own suggestions (same names, same areas) are kept as soon as it opens, so what it
    // shows is what the rooms use, even if Done is the only thing pressed.
    if (fresh && Object.keys(draft).length) persist();
    return card;
  }

  // close(): every card this made (the panel went away).
  // held(): a slider in a sheet is held now (or was let go of a moment ago): the host draws its sheet again only after
  // (lights_map.js openAggregateSheet). letGo(): the sheet closed; any held slider is let go of.
  return { looks, sheet, switched, openMatch, canMatch: () => !!o.admin(), close: () => { for (const d of [...dialogs]) d.close(); },
    held: () => [...drag.keys()].some(dragging), letGo };
}
