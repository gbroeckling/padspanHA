// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
// See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
//
// Feature tips (2026-11-26): one at a time, a feature this house already has
// (free, in its add-ons or in Pro) and doesn't use yet.
//
// The owner's idea, with what the research changed (accepted by the owner):
//   a quiet card, never a pop-up   startup tips are the classic ignored push
//   fit before popularity          ranked by fit to THIS house (its hardware, data,
//                                  setup and licence); the opt-in reports' ranking
//                                  (settings.server_tips_rank) only breaks a tie
//   gone once seen                 shown once, never listed again (the owner's rule),
//                                  and never once it is used or dismissed
//   at most one a day              and none until the install is a week old
//                                  (settings.first_seen_ts), so we know what it uses
//   easy to turn off               "No more tips" on every tip, Settings →
//                                  Appearance → Tips (settings.tips_enabled)
//
// Where a tip may show (place):
//   overview      the Overview's one card per visit, only when no other card wants it
//                 (panel.js _featureTipCard, last in line before the accuracy tips)
//   atlas_adjust  where the Atlas is being adjusted, never in day-to-day use: the ⋯
//                 "Show on this screen" list while it is open (live_aboard_show.js,
//                 the flat Map's copy in lights_map.js), Settings → Atlas, and
//                 Mapping → Atlas builder. Never on the map itself, in a room's card
//                 or sheet, during taps, or on a wall screen (?kiosk=1, data-wall).
// One tip per page load in all: the place it first showed in keeps it until it is
// answered; everywhere else shows none.
//
// The picker is pure (pickTip, tests/js/tips.mjs runs it); the state it reads and
// writes is tips.py's (settings.tips_state, cleaned by the backend too). The
// opt-in report's words (telemetry.py FEATURE_TIP_EVENTS) are sent through the
// host, which sends them only while the report is on. Its words are the "tips"
// group (i18n/<lang>/tips.json).

const _q = new URL(import.meta.url).search;
const _fill = (s, v) => s.replace(/\{(\w+)\}/g, (m, k) => (v && Object.prototype.hasOwnProperty.call(v, k) ? String(v[k]) : m));
const { t } = await import(`./i18n.js${_q}`).catch(() => ({ t: _fill }));
const E = await import(`./editions.js${_q}`);
const FOCUS = await import(`./focus.js${_q}`).catch(() => null);
// What a shade is (room_controls.js isShade, the room card's own rule). Optional: without it no cover counts as a
// shade, so the Shades tip is never offered on a guess.
const RC = await import(`./room_controls.js${_q}`).catch(() => null);

export const DAY_S = 86400;
export const WAIT_DAYS = 7;          // no tip before the install is this many days old
export const GAP_S = DAY_S;          // at most one tip in this long
export const USED_AFTER_DAYS = 7;    // a feature used this soon after its tip showed: tip_used_after
export const PLACES = Object.freeze(["overview", "atlas_adjust"]);
const BOTH = Object.freeze(["overview", "atlas_adjust"]);
const OVERVIEW = Object.freeze(["overview"]);
const ATLAS = Object.freeze(["atlas_adjust"]);

const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
// Audio used: the room card's words (room_controls:<word>), the same list as the usage report's addon_report.AUDIO_USED
// (tests/test_tips.py holds the two equal).
export const AUDIO_USED = Object.freeze(["up", "down", "mute", "off", "match_saved", "source", "sound_mode", "play", "pause", "next",
  "previous", "scan", "slider", "sound", "share", "unshare", "all_off", "sources_saved", "limit_saved"]);
/** A setting that is on: true, a non-empty list, map or text. */
export function isOn(v) {
  if (v === true) return true;
  if (Array.isArray(v)) return v.length > 0;
  if (v && typeof v === "object") return Object.keys(v).length > 0;
  return typeof v === "string" && v !== "";
}

/**
 * The catalogue. One idea each, in plain words.
 *   id      its name in the state and the report (never changed once shipped; tips.py IDS)
 *   need    "free", "pro", "house3d" (Live Aboard's rung, editions.js house3dTier) or an add-on's name
 *   fit     (facts, settings) → 0 (doesn't fit this house) or more (fits better)
 *   used    settings: on means in use; events: a word the panel already counts (exact, or a
 *           prefix ending ":"); check(settings): its own rule; uses: its feature says so itself
 *           (editions.js tipUsed). A word or a use right after the tip's own Show me (GO_QUIET_S) is
 *           the Show me, not a use, and is not counted
 *   target  "Show me": { view, tab, part (Settings' data-focus-part), focus (focus.js PARTS,
 *           for Basic), reveal (the Tracking section to open), locate, mode }, or { atlas: "emergency" }
 *           (the Atlas page's emergency button card); null where only a ⋯ line shows it
 *   where   the places it may show (PLACES)
 *   line    the ⋯ list's line that switches it (live_aboard_show.js SHOW_ITEMS), if it has one
 *   admin   only an administrator can act on it, so only an administrator sees it
 *   surface the screen whose edition decides it (editions.js SURFACE_CLASS), if not target.view
 */
export const TIPS = Object.freeze([
  // ── free (or Live Aboard's own rung) ──
  { id: "house_3d", need: "house3d", where: BOTH, admin: true,
    get title() { return t("See your house in 3D"); },
    get body() { return t("Live Aboard draws your floors, walls and lights as a 3D house on the Atlas, one tap from the flat map."); },
    fit: (f) => (f.plans && f.rooms >= 2 ? (f.placedLights ? 2 : 1) : 0),
    used: { settings: ["atlas_3d_enabled"] },
    target: { view: "settings", tab: "atlas", part: "la3d", focus: "liveAboard" } },
  { id: "alert_pulse", need: "free", where: BOTH, admin: true,
    get title() { return t("Know when a door is left open"); },
    get body() { return t("Alert pulse rings a room in amber when a door, window or gate there is left open for hours, or a window is open in the rain."); },
    fit: (f) => (f.rooms && (f.openings + f.garage) ? (f.openings + f.garage >= 4 ? 2 : 1) : 0),
    used: { settings: ["atlas_alert_pulse"] },
    target: { view: "settings", tab: "atlas", part: "alert_pulse" } },
  { id: "shades", need: "free", where: BOTH, admin: true,
    get title() { return t("Shades in the room's panel"); },
    get body() { return t("Open, Stop and Close for a room's blinds and shades, right in its panel on the Atlas."); },
    fit: (f) => (f.rooms && f.shades ? (f.shades >= 3 ? 2 : 1) : 0),
    used: { settings: ["atlas_shades_enabled"], events: ["room_controls:cover", "house3d_show:show:room_shades"] },
    target: { view: "settings", tab: "atlas", part: "atlas_shades" }, line: "room_shades" },
  { id: "edgecut", need: "free", where: ATLAS, admin: false,
    get title() { return t("Let the rooms fill the screen"); },
    get body() { return t("Edgecut draws your rooms edge to edge, letting the house's outer edges run off the screen."); },
    fit: (f) => (f.rooms >= 3 ? 1 : 0),
    used: { events: ["house3d_show:show:edgecut"] },
    target: null, line: "edgecut" },
  { id: "room_switch", need: "free", where: ATLAS, admin: false,
    get title() { return t("Tap a room to switch its lights"); },
    get body() { return t("With Rooms as light switches, a tap on a room's floor turns all its lights on or off together."); },
    fit: (f) => (f.house3d && f.placedLights >= 2 ? 1 : 0),
    used: { events: ["house3d_show:show:room_switch", "house3d_show:room_tap:"] },
    target: null, line: "room_switch" },
  { id: "lights_follow", need: "free", where: OVERVIEW, admin: true,
    get title() { return t("Lights that follow you"); },
    get body() { return t("Lights follow people turns a room's lights on as someone walks in, and off once the room is empty."); },
    fit: (f) => (f.tracked && f.placedLights ? 2 : 0),
    used: { settings: ["lights_follow_enabled"] },
    target: { view: "settings", tab: "presence", part: "lights_follow", reveal: "integrations" } },
  { id: "yesterday_home", need: "free", where: OVERVIEW, admin: true,
    get title() { return t("A morning note about yesterday"); },
    get body() { return t("Yesterday at home sends one short message each morning: who came and went, and lights left on in empty rooms."); },
    fit: (f) => (f.tracked ? 1 : 0),
    used: { settings: ["yesterday_home_enabled"] },
    target: { view: "settings", tab: "presence", part: "yesterday_home", reveal: "phones" } },
  { id: "guest_tags", need: "free", where: OVERVIEW, admin: true,
    get title() { return t("Lend a tag to a guest"); },
    get body() { return t("Guest tags follow a tag you lend to a house-sitter or visitor, room by room, only while they have it."); },
    fit: (f) => (f.receivers >= 2 && f.rooms ? 1 : 0),
    used: { settings: ["guest_tags_enabled"] },
    target: { view: "settings", tab: "presence", part: "guest_tags", focus: "guestTags", reveal: "phones" } },
  { id: "phone_tracking", need: "free", where: OVERVIEW, admin: true,
    get title() { return t("Follow your phone or watch"); },
    get body() { return t("PadSpan can follow your phone or watch from room to room once it knows it. The phone wizard walks you through it."); },
    fit: (f) => (f.receivers >= 2 && !f.tracked ? 2 : 0),
    used: { settings: ["irk_devices"] },
    target: { view: "bluetooth", tab: "irk_panel", focus: "phoneWizard" } },
  // ── Pro ──
  { id: "people_3d", need: "pro", where: BOTH, admin: true,
    get title() { return t("People in the 3D house"); },
    get body() { return t("Show people puts each person in Live Aboard, where their phone or tag is."); },
    fit: (f) => (f.house3d && f.tracked ? 2 : 0),
    used: { settings: ["atlas_3d_people"] },
    target: { view: "settings", tab: "atlas", part: "la3d", focus: "liveAboard" } },
  { id: "atlas_overview", need: "pro", where: BOTH, admin: true, surface: "overview",
    get title() { return t("Open on the Atlas"); },
    get body() { return t("Overview can show the Atlas, your lights and rooms, instead of the classic map."); },
    fit: (f) => (f.placedLights >= 3 ? 1 : 0),
    used: { settings: ["overview_atlas"] },
    target: { view: "settings", tab: "atlas", part: "atlas_overview", focus: "atlasHome" } },
  // ── Audio ──
  { id: "audio", need: "audio", where: BOTH, admin: true,
    get title() { return t("Room audio on the Atlas"); },
    get body() { return t("Each room's players in its panel on the Atlas: on and off, volume, source and sound, play and skip, sharing with other rooms, and Room off."); },
    fit: (f) => (f.audioMatched ? 3 : f.media && f.rooms ? 1 : 0),
    used: { settings: ["atlas_audio_enabled"],
      events: ["house3d_show:show:room_controls", ...AUDIO_USED.map((w) => `room_controls:${w}`)] },
    target: { view: "settings", tab: "atlas", part: "atlas_audio" }, line: "room_controls" },
  // ── Alarm & security ──
  { id: "alarm_arm", need: "alarm", where: BOTH, admin: false,
    get title() { return t("Arm the alarm from the Atlas"); },
    get body() { return t("Press the shield on the Atlas's emergency button to arm or disarm your alarm, with its code if it asks for one."); },
    fit: (f) => (f.alarmPanels ? 3 : 0),
    used: { events: ["alarm_button:arm", "alarm_button:disarm"] },
    // The alarm's own place: the Atlas's emergency button and its card (lights_panel.js _openEmergencyCard).
    target: { atlas: "emergency" } },
  { id: "door_openers", need: "alarm", where: OVERVIEW, admin: true,
    get title() { return t("Open the garage from the map"); },
    get body() { return t("Mark your garage doors and gates as openers, then open or close them from their card on the map."); },
    fit: (f) => (f.garage ? 2 : 0),
    used: { settings: ["door_opener_ids"] },
    target: { view: "devices", tab: "openers" } },
  // ── Wi-Fi coverage ──
  { id: "wifi_coverage", need: "wifi", where: OVERVIEW, admin: false,
    get title() { return t("See your Wi-Fi coverage"); },
    get body() { return t("Wi-Fi coverage draws how strong your UniFi Wi-Fi is across your floor plan, so weak spots show."); },
    fit: (f) => (f.wifiSurvey ? 2 : 0),
    used: { events: ["tab:wifi"] },
    target: { view: "wifi" } },
  // ── Climate & air quality ──
  { id: "heatmap", need: "climate", where: BOTH, admin: true,
    get title() { return t("Rooms by temperature"); },
    get body() { return t("The ♨ Heatmap colours each room on the Atlas by its temperature, humidity or CO₂, from its own sensors."); },
    fit: (f) => (f.rooms >= 2 && f.airSensors >= 2 ? 2 : f.rooms && f.airSensors ? 1 : 0),
    used: { settings: ["atlas_heatmap_enabled"] },
    target: { view: "settings", tab: "atlas", part: "atlas_heatmap" } },
  { id: "thermostats", need: "climate", where: BOTH, admin: true,
    get title() { return t("Thermostats in the room's panel"); },
    get body() { return t("Each thermostat's mode and setpoint, with − and +, in its room's panel on the Atlas."); },
    fit: (f) => (f.rooms && f.climate ? 2 : 0),
    used: { settings: ["atlas_thermostats_enabled"], events: ["room_controls:climate", "house3d_show:show:room_climate"] },
    target: { view: "settings", tab: "atlas", part: "atlas_thermostats" }, line: "room_climate" },
  // ── Full house activity ──
  { id: "day_replay", need: "timetravel", where: OVERVIEW, admin: false,
    get title() { return t("Replay the day on your map"); },
    get body() { return t("Traceback can replay a whole day on your Atlas map: lights, doors, sensors and who was where."); },
    fit: (f) => (f.placedLights ? (f.tracked ? 2 : 1) : 0),
    used: { events: ["addon_used:timetravel"] },
    target: { view: "traceback" } },
  // ── Vacation Mode & presets ──
  { id: "vacation_mode", need: "vacation", where: BOTH, admin: true,
    get title() { return t("Lights that look lived-in while you're away"); },
    get body() { return t("Vacation Mode runs your lights the way you really used them, from last week or a month's average."); },
    fit: (f) => (f.lights >= 3 ? 1 : 0),
    used: { settings: ["vacation_mode_enabled", "vacation_mode_periods"] },
    target: { view: "maps", tab: "lights" } },
  { id: "house_presets", need: "vacation", where: BOTH, admin: true,
    get title() { return t("Save the whole house's lights"); },
    get body() { return t("A Whole house preset keeps how every light is set, and brings them all back with one tap."); },
    fit: (f) => (f.lights >= 4 ? 1 : 0),
    used: { settings: ["whole_house_presets"] },
    target: { view: "maps", tab: "lights" } },
  // ── Looks pack ──
  { id: "themes", need: "looks", where: OVERVIEW, admin: false,
    get title() { return t("Give the panel a new look"); },
    get body() { return t("Graphite, Ocean, Dusk and Day are themes for the whole panel, beside Night."); },
    fit: () => 1,
    used: { check: (s) => ["graphite", "ocean", "dusk"].includes(s.theme_palette) || s.day_theme === true },
    target: { view: "settings", tab: "appearance" } },
  { id: "showcase", need: "looks", where: BOTH, admin: true,
    get title() { return t("Dress up the map"); },
    get body() { return t("Showcase gives the Atlas map one of 20 looks, the West Coast Forest among them."); },
    fit: (f) => (f.placedLights ? 2 : 0),
    used: { settings: ["lights_showcase"] },
    target: { view: "maps", tab: "lights" } },
  // ── Presence insights ──
  { id: "locate", need: "insights", where: OVERVIEW, admin: false,
    get title() { return t("Find a lost tag"); },
    get body() { return t("Locate walks you to a lost tag, room by room."); },
    fit: (f) => (f.receivers >= 3 && f.rooms >= 2 && f.tracked ? 2 : 0),
    used: { uses: true },                          // views/locate.js says so (editions.js tipUsed)
    target: { view: "follow", locate: true } },
  { id: "busy_times", need: "insights", where: OVERVIEW, admin: false,
    get title() { return t("Each room's busy hours"); },
    get body() { return t("Busy Times shows when each room is busiest, hour by hour."); },
    fit: (f) => (f.receivers >= 2 && f.rooms >= 2 ? 1 : 0),
    used: { uses: true },                          // views/busy_times.js says so (editions.js tipUsed)
    target: { view: "traceback", mode: "busytimes" } },
  { id: "forensics", need: "insights", where: OVERVIEW, admin: true,
    get title() { return t("What was near a receiver"); },
    get body() { return t("Forensics shows which Bluetooth devices were near a receiver in any time window."); },
    fit: (f) => (f.receivers ? 1 : 0),
    used: { settings: ["forensics_enabled"] },
    target: { view: "settings", tab: "features", part: "forensics" } },
  // ── Advanced smart lighting ──
  { id: "power_teams", need: "lighting", where: BOTH, admin: true,
    get title() { return t("Smart bulbs behind a wall switch"); },
    get body() { return t("Pair a wall dimmer with the bulbs it feeds: they work as one light that follows the day and dims for sleep."); },
    fit: (f) => (f.lights >= 2 ? 1 : 0),
    used: { settings: ["power_teams"] },
    target: { view: "settings", tab: "atlas", part: "power_teams" } },
  { id: "wled_controls", need: "lighting", where: BOTH, admin: true,
    get title() { return t("Your WLED lights, in depth"); },
    get body() { return t("Hold a WLED light on the map: its card's Advanced tab has its presets, LEDs, sync and backups."); },
    fit: (f) => (f.wled ? 3 : 0),
    used: { uses: true },                          // its card's Advanced tab opened (lights_map.js, editions.js tipUsed)
    target: { view: "maps", tab: "lights" } },
  { id: "light_glow", need: "lighting", where: BOTH, admin: true,
    get title() { return t("A glow from each light"); },
    get body() { return t("Automorph throws a soft glow from each light into its room on the map."); },
    fit: (f) => (f.placedLights >= 3 ? 2 : 0),
    used: { settings: ["lights_automorph_enabled"] },
    target: { view: "maps", tab: "lights" } },
  // ── Advanced map creation ──
  { id: "ai_plans", need: "maps", where: OVERVIEW, admin: true,
    get title() { return t("Let your AI read your floor plans"); },
    get body() { return t("Your own AI Task can read your plans for stairs and rooms, and you check each find before it's saved."); },
    fit: (f) => (f.plans && f.aiTaskSet ? 2 : 0),   // only once an AI Task is chosen in Settings → AI
    used: { settings: ["ai_plans_enabled"] },
    target: { view: "settings", tab: "ai", part: "ai_plans" } },
  // ── Robot vacuum ──
  { id: "robot_vacuum", need: "vacuum", where: OVERVIEW, admin: true,
    get title() { return t("Your robot vacuum's map"); },
    get body() { return t("Use your robot vacuum's map as a floor plan, and see the robot on the Atlas as it cleans."); },
    fit: (f) => (f.vacuums ? 3 : 0),
    used: { settings: ["vacuum_import_enabled"] },
    target: { view: "settings", tab: "features", part: "feature_vacuum_import_enabled" } },
]);
export const TIP_IDS = Object.freeze(TIPS.map((x) => x.id));
const BY_ID = new Map(TIPS.map((x) => [x.id, x]));
export const tipById = (id) => BY_ID.get(id) || null;

// ── what the house has ──────────────────────────────────────────────────────
/**
 * The facts the fit rules read, from what a host already holds: Home Assistant's
 * states and entity registry, PadSpan's model, floor plans, receivers and settings.
 * Counts only.
 */
/** The covers that open a door or a gate, by the room card's own rule (room_controls.js openersOf, as lights_panel.js
 *  _doorOpeners asks it): Devices → Door Openers' marked ones, a wall's opener on the map, and a cover linked to a wall
 *  and named as an opener. Never a shade. */
export function openersFrom(model, settings, states) {
  return RC ? RC.openersOf(model, states, settings && settings.door_opener_ids) : new Set();
}
export function factsFrom(src) {
  const o = src || {};
  const states = o.states || {}, ents = o.entities || {}, model = o.model || {}, s = o.settings || {};
  const openers = o.openers instanceof Set ? o.openers : openersFrom(model, s, states);
  const f = { plans: 0, rooms: 0, lights: 0, placedLights: 0, receivers: 0, tracked: 0, climate: 0, airSensors: 0,
    shades: 0, garage: 0, openings: 0, media: 0, audioMatched: 0, alarmPanels: 0, wled: 0, vacuums: 0, aiTasks: 0,
    house3d: s.atlas_3d_enabled === true, wifiSurvey: !!o.wifiSurvey };
  for (const eid of Object.keys(states)) {
    const st = states[eid], dom = eid.split(".")[0];
    const dc = st && st.attributes ? st.attributes.device_class : null;
    if (dom === "light") { f.lights++; if (ents[eid] && ents[eid].platform === "wled") f.wled++; }
    else if (dom === "climate") f.climate++;
    else if (dom === "cover") {
      if (dc === "garage" || dc === "gate") f.garage++;
      else if (RC && RC.isShade({ states }, eid, openers)) f.shades++;   // never a door, a damper, a window or an opener
    }
    else if (dom === "binary_sensor") { if (dc === "door" || dc === "window" || dc === "garage_door" || dc === "opening") f.openings++; }
    else if (dom === "sensor") { if (dc === "temperature" || dc === "humidity" || dc === "carbon_dioxide") f.airSensors++; }
    else if (dom === "media_player") f.media++;
    else if (dom === "alarm_control_panel") f.alarmPanels++;
    else if (dom === "vacuum") f.vacuums++;
    else if (dom === "ai_task") f.aiTasks++;
  }
  f.rooms = Object.keys(model.room_geometry_m || {}).length;
  f.placedLights = Object.keys(model.light_positions_m || {}).length;
  // A host without the plans list (the sidebar Atlas): a drawn room means a plan.
  f.plans = Array.isArray(o.plans) ? o.plans.length : o.plans == null ? (f.rooms ? 1 : 0) : num(o.plans);
  f.receivers = Array.isArray(o.radios) ? o.radios.length : Object.keys(model.scanner_positions_m || {}).length;
  f.tracked = (Array.isArray(s.irk_devices) ? s.irk_devices.length : 0) + (Array.isArray(s.followed_addrs) ? s.followed_addrs.length : 0);
  const matches = s.room_audio_matches && typeof s.room_audio_matches === "object" ? s.room_audio_matches : {};
  f.audioMatched = Object.values(matches).filter((v) => Array.isArray(v) && v.length).length;
  f.aiTaskSet = !!(typeof s.atlas_3d_ai_task_entity === "string" && s.atlas_3d_ai_task_entity);
  return f;
}

// ── the rules ───────────────────────────────────────────────────────────────
/** Whether this licence includes the tip's feature (never a tip that sells anything). */
export function licensed(tip, settings) {
  const s = settings || {}, need = tip.need || "free";
  if (need === "free") return true;
  if (need === "pro") return E.currentTier(s) === "pro";
  if (need === "house3d") return E.tierAtLeast(E.currentTier(s), E.house3dTier(s));
  if (need === "vacuum") return E.vacuumAllowed(s);    // the robot's features as the rest of the panel gates them
  return E.addonAllowed(s, need);
}
/** Whether this build shows the screen the tip is about (a Bright build hides the presence ones). */
export function inEdition(tip, settings) {
  const v = tip.surface || (tip.target && tip.target.view) || "settings";
  return !E.SURFACE_CLASS[v] || E.surfacesForEdition([v], settings).length > 0;
}
/** Whether its target is there in Basic: a focused part (focus.js), Settings → Appearance, Mapping's
 *  Library or Upload, or a screen of its own (every screen is in Basic's menu, the expert ones under More tools). */
export function basicOk(target) {
  if (!target) return false;
  if (target.focus || target.atlas) return true;       // the Atlas page is everyone's, in every mode
  if (target.view === "settings") return target.tab === "appearance";
  if (target.view === "maps") return target.tab === "library" || target.tab === "upload";
  return target.view !== "devices" && target.view !== "bluetooth";
}
/** Its feature is on by the settings alone. */
export function usedBySettings(tip, settings) {
  const s = settings || {}, u = tip.used || {};
  if ((u.settings || []).some((k) => isOn(s[k]))) return true;
  try { return typeof u.check === "function" && !!u.check(s); } catch (_) { return false; }
}
/** A word the panel counts that says the feature was used. */
export function eventUses(tip, name) {
  const n = String(name || "");
  return ((tip.used && tip.used.events) || []).some((e) => (e.endsWith(":") ? n.startsWith(e) : n === e));
}
/** Somewhere this place can take a person: a ⋯ line it has (hasLine), or its target (canGo; in Basic, only one Basic has). */
export function reachable(tip, o) {
  const viaLine = !!tip.line && typeof o.hasLine === "function" && !!o.hasLine(tip.line);
  const viaTarget = !!tip.target && (!o.basic || basicOk(tip.target)) && (typeof o.canGo !== "function" || !!o.canGo(tip.target));
  return viaLine || viaTarget;
}
/** Tips are on, the settings say so (an older backend doesn't: no tips), and the install is a week old. */
export function tipsReady(settings, now = Date.now()) {
  const s = settings || {};
  if (!("tips_enabled" in s) || s.tips_enabled === false) return false;
  const first = num(s.first_seen_ts);
  return first > 0 && now / 1000 - first >= WAIT_DAYS * DAY_S;
}

/**
 * The tips that fit this house, for whoever this is, where they can be reached: [{tip, fit}],
 * each licensed, fitting (fit > 0) and not in use by the settings. o = { settings, facts,
 * admin, basic, canGo(target), hasLine(key), tips }.
 */
export function fitTips(o) {
  const s = o.settings || {}, f = o.facts || {};
  const out = [];
  for (const tip of o.tips || TIPS) {
    if (tip.admin && !o.admin) continue;
    if (!licensed(tip, s) || !inEdition(tip, s) || usedBySettings(tip, s)) continue;
    let fit = 0;
    try { fit = Number(tip.fit(f, s)) || 0; } catch (_) { fit = 0; }
    if (fit > 0 && reachable(tip, o)) out.push({ tip, fit });
  }
  return out;
}

/** Best fit first; then the reports' ranking (a tip it doesn't name after those it does); then the catalogue's order. */
export function rankTips(list, rank) {
  const r = Array.isArray(rank) ? rank : [];
  const pos = (id) => { const i = r.indexOf(id); return i < 0 ? r.length : i; };
  const order = (id) => TIP_IDS.indexOf(id);
  return list.slice().sort((a, b) => (b.fit - a.fit) || (pos(a.tip.id) - pos(b.tip.id)) || (order(a.tip.id) - order(b.tip.id)));
}

/**
 * The tip to show at `place` now, or null. Pure. o = { settings, facts, place, now (ms),
 * admin, basic, canGo, hasLine }. Nothing while tips are off, before the install is
 * WAIT_DAYS old, or within GAP_S of the last one; never one seen, dismissed or used.
 */
export function pickTip(o) {
  const s = o.settings || {}, now = o.now == null ? Date.now() : o.now;
  if (!tipsReady(s, now)) return null;
  const st = cleanState(s.tips_state, now);
  if (st.last_shown && now / 1000 - st.last_shown < GAP_S) return null;
  const gone = new Set([...Object.keys(st.seen), ...st.dismissed, ...st.used]);
  const list = rankTips(fitTips(o).filter((x) => !gone.has(x.tip.id) && x.tip.where.includes(o.place)), s.server_tips_rank);
  return list.length ? list[0].tip : null;
}

// ── the state (tips.py clean_state's twin) ──────────────────────────────────
// A time ahead of now (a device whose clock runs fast) is kept at now, the tip still seen (tips.py _ts).
const _ts = (v, now) => (typeof v === "number" && !Number.isNaN(v) && v > 0 ? Math.floor(Math.min(v, now / 1000)) : 0);
const _ids = (raw) => { const got = new Set(Array.isArray(raw) ? raw.filter((x) => typeof x === "string") : []); return TIP_IDS.filter((i) => got.has(i)); };
/** settings.tips_state as kept: {seen: {id: s}, dismissed: [id], used: [id], last_shown: s}, catalogue ids only. */
export function cleanState(raw, now = Date.now()) {
  const src = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const seenRaw = src.seen && typeof src.seen === "object" && !Array.isArray(src.seen) ? src.seen : {};
  const seen = {};
  for (const id of TIP_IDS) { const v = _ts(seenRaw[id], now); if (v) seen[id] = v; }
  const last = Math.max(_ts(src.last_shown, now), ...Object.values(seen), 0);
  return { seen, dismissed: _ids(src.dismissed), used: _ids(src.used), last_shown: last };
}
/** Shown now: seen (once; its first time stays) and the day's tip. */
export function withSeen(state, id, now = Date.now()) {
  const st = cleanState(state, now), at = Math.floor(now / 1000);
  if (!st.seen[id]) st.seen[id] = at;
  st.last_shown = Math.max(st.last_shown, at);
  return st;
}
export function withDismissed(state, id, now = Date.now()) {
  const st = cleanState(state, now);
  st.dismissed = _ids([...st.dismissed, id]);
  return st;
}
/**
 * What is newly in use: by `event` (a word the panel counted: any tip it names, so one never
 * shows after), by `uses` (a Map of tip id → ms: its feature said so, editions.js tipUsed), or
 * by the settings (a tip already shown, so the state stays small). `quiet`: tips whose Show me
 * was just pressed, whose words and uses are the Show me itself. null when nothing changed;
 * else { state, added, after } — after: used within USED_AFTER_DAYS of showing.
 */
export function usedNow(settings, now = Date.now(), event = null, uses = null, quiet = null) {
  const s = settings || {}, st = cleanState(s.tips_state, now);
  const used = new Set(st.used), added = [], after = [];
  for (const tip of TIPS) {
    if (used.has(tip.id)) continue;
    let at = now, hit;
    if (uses) { hit = uses.has(tip.id); if (hit) at = uses.get(tip.id); }
    else if (event) hit = eventUses(tip, event);
    else hit = !!st.seen[tip.id] && usedBySettings(tip, s);
    if (!hit || ((uses || event) && quiet && quiet.has(tip.id))) continue;
    used.add(tip.id);
    added.push(tip.id);
    const seen = st.seen[tip.id];
    if (seen && at / 1000 - seen <= USED_AFTER_DAYS * DAY_S) after.push(tip.id);
  }
  return added.length ? { state: { ...st, used: TIP_IDS.filter((i) => used.has(i)) }, added, after } : null;
}

// ── the page: one tip per page load ────────────────────────────────────────
// host = { settings, facts (or a function giving them), admin, basic, kiosk, live,
//          save(patch) → Promise, send(word), go(target), canGo(target), hasLine(key),
//          rerender(), toast(text) }
const _page = { id: null, spot: null, closed: false };
// Show me pressed, by tip (ms): for GO_QUIET_S after it, a word or a use of that feature is the Show me landing there
// (the screen it opens counts itself opened), not a use.
export const GO_QUIET_S = 60;
const _wentAt = new Map();
const _quiet = (now) => new Set([..._wentAt].filter(([, at]) => now - at < GO_QUIET_S * 1000).map(([id]) => id));
// Features that said they were used (editions.js tipUsed, a page event: the views import nothing of this), kept until a
// host can write them down (reconcile, noteEvent).
const _pendingUse = new Map();
/** A feature of `id` used now (live data only: the caller says). Not right after its own Show me. */
export function noteUse(id, now = Date.now()) {
  if (BY_ID.has(id) && !_quiet(now).has(id) && !_pendingUse.has(id)) _pendingUse.set(id, now);
}
try {
  if (typeof globalThis.addEventListener === "function")
    globalThis.addEventListener("padspan-tip-used", (e) => { try { noteUse(String(e && e.detail)); } catch (_) { /* never the error */ } });
} catch (_) { /* no page events here */ }
/** Forget this page's tip (tests; a page load does it by itself). */
export function resetPage() { _page.id = null; _page.spot = null; _page.closed = false; _wentAt.clear(); _pendingUse.clear(); }
export function pageTip() { return { ..._page }; }

const _send = (host, word) => { try { if (host && typeof host.send === "function") host.send(word); } catch (_) { /* the report is a courtesy */ } };
function _write(host, patch) {
  if (host.live === false) return Promise.resolve();            // sample data: the real house's settings are not this page's
  if (host.settings) Object.assign(host.settings, patch);      // at once: the next draw reads it
  try { return Promise.resolve(typeof host.save === "function" ? host.save(patch) : null).catch(() => {}); } catch (_) { return Promise.resolve(); }
}
const _known = (host) => !!(host && host.settings && "tips_enabled" in host.settings);
// "No more tips" from someone who is not an administrator: this browser only (the house's switch, tips_enabled, is an
// administrator's: ws_settings refuses it to anyone else).
export const LOCAL_OFF_KEY = "padspan_tips_off";
export function localOff() { try { return globalThis.localStorage && globalThis.localStorage.getItem(LOCAL_OFF_KEY) === "1"; } catch (_) { return false; } }
function _setLocalOff(off) {
  try { if (off) globalThis.localStorage.setItem(LOCAL_OFF_KEY, "1"); else globalThis.localStorage.removeItem(LOCAL_OFF_KEY); } catch (_) { /* this page only */ }
}
/** Tips on for whoever this is: the house's switch, and for anyone but an administrator this browser's too. */
export function tipsOnFor(host) {
  const s = (host && host.settings) || {};
  return s.tips_enabled !== false && (!!host.admin || !localOff());
}
function _apply(host, ch) {
  if (!ch) return;
  _write(host, { tips_state: ch.state });
  for (const id of ch.after) _send(host, "tip_used_after:" + id);
}
/** The uses the features said since (noteUse), written down once a live host is here. */
function _usesNow(host, now) {
  if (!_pendingUse.size || host.live === false) return;
  const uses = new Map(_pendingUse);
  _pendingUse.clear();
  _apply(host, usedNow(host.settings, now, null, uses, _quiet(now)));
}
/** A feature turned on in the settings since its tip showed: kept as used (tip_used_after within the week). */
export function reconcile(host, now = Date.now()) {
  if (!_known(host)) return;
  _apply(host, usedNow(host.settings, now));
  _usesNow(host, now);
}
/** A word the panel counted (its usage report's, sent or not): a tip whose feature it names is used. Never in sample
 *  data (the sample house's use is not this house's), never a tip's own words, never its Show me landing. */
export function noteEvent(host, word, now = Date.now()) {
  const w = String(word || "");
  if (!_known(host) || host.live === false || /^tips?_/.test(w)) return;
  _apply(host, usedNow(host.settings, now, w, null, _quiet(now)));
  _usesNow(host, now);
}

/**
 * The tip this spot shows now, or null: the page's tip where it first showed (until it is
 * answered), else a new one if pickTip has one, shown (seen, the day's) and counted.
 * place: "overview" or "atlas_adjust"; spot: which of the place's screens (default the place).
 */
export function currentTip(host, place, spot = place, now = Date.now()) {
  if (!host || host.kiosk || host.live === false || !_known(host)) return null;
  reconcile(host, now);                            // a feature turned on since its tip: used (tips on or off)
  if (!tipsOnFor(host)) return null;
  if (_page.id) return !_page.closed && _page.spot === spot ? tipById(_page.id) : null;
  const facts = typeof host.facts === "function" ? host.facts() : host.facts;
  const tip = pickTip({ settings: host.settings, facts, place, now, admin: !!host.admin, basic: !!host.basic,
    canGo: host.canGo, hasLine: host.hasLine });
  if (!tip) return null;
  _page.id = tip.id; _page.spot = spot; _page.closed = false;
  _write(host, { tips_state: withSeen(host.settings.tips_state, tip.id, now) });
  _send(host, "tip_shown:" + tip.id);
  return tip;
}

/** An answer to the page's tip: "go" (Show me), "not_now" (Got it: seen, so never again, as the owner's rule says),
 *  "dismiss" (✕) or "off" (No more tips: the house's for an administrator, this browser's for anyone else). */
export function answer(host, tip, what, now = Date.now()) {
  if (!tip) return;
  _page.closed = true;
  const st = cleanState(host.settings && host.settings.tips_state, now);
  if (what === "dismiss") {
    _send(host, "tip_dismiss:" + tip.id);
    _write(host, { tips_state: withDismissed(withSeen(st, tip.id, now), tip.id, now) });
  } else if (what === "off") {
    _send(host, "tips_off");
    if (host.admin) _write(host, { tips_enabled: false });
    else _setLocalOff(true);
    if (typeof host.toast === "function") host.toast(host.admin ? t("Tips are off. Settings → Appearance → Tips brings them back.")
      : t("Tips are off on this browser. Settings → Appearance → Tips brings them back."));
  } else {
    _send(host, (what === "go" ? "tip_go:" : "tip_not_now:") + tip.id);
    // Seen it stays, so it never comes back (the owner's rule); written again only if the first save was lost.
    if (!st.seen[tip.id]) _write(host, { tips_state: withSeen(st, tip.id, now) });
    // Show me that opens a screen: what that screen counts as it opens is the Show me (a ⋯ line pointed at is not:
    // ticking it is the person's own).
    if (what === "go" && tip.target && typeof host.go === "function") {
      _wentAt.set(tip.id, now);
      try { host.go(tip.target); } catch (_) { /* stays here */ }
    }
  }
  if (typeof host.rerender === "function") host.rerender();
}

// ── the panel's host (panel.js, settings.js, maps.js) ──────────────────────
/** "Show me" on the panel: the exact screen, tab and card; in Basic a focused part where it has one. */
export function goCtx(ctx, target) {
  const st = ctx.state, A = ctx.actions || {};
  // The Atlas page's emergency button card (lights_panel.js reads ?card=emergency once it has loaded).
  if (target.atlas) { try { globalThis.location.assign(`/padspan-lights?card=${encodeURIComponent(target.atlas)}`); } catch (_) { /* stays */ } return true; }
  if (target.reveal) st._presenceReveal = target.reveal;   // its Tracking section opens (settings.js)
  if (st.complexity === "basic" && target.focus && FOCUS) { FOCUS.openFocus(ctx, FOCUS.part(target.focus)); return true; }
  if (target.view === "settings") { st._settingsTab = target.tab || "appearance"; st._settingsPart = target.part || null; }
  if (target.view === "bluetooth" && target.tab) st.btTab = target.tab;
  if (target.view === "devices" && target.tab) st._devicesTab = target.tab;
  if (target.view === "follow" && target.locate) st._followLocateOn = true;
  if (target.view === "traceback" && target.mode) st._tracebackInitialMode = target.mode;
  if (target.view === "maps") st._mapsWizard = null;
  if (typeof A.showView === "function") A.showView(target.view);
  else { st.view = target.view; if (A.renderRooms) A.renderRooms(); }
  if (target.view === "maps" && target.tab && typeof A.setMapsTab === "function") A.setMapsTab(target.tab);
  return true;
}
/** A wall screen: ?kiosk=1, or a window that fills the screen (panel.js wallScreen, the same test). */
export function wallScreen(kiosk, win = globalThis) {
  if (kiosk) return true;
  try {
    const sc = win.screen;
    return !!(sc && sc.width && win.innerWidth >= sc.width - 1 && win.innerHeight >= sc.height - 1);
  } catch (_) { return false; }
}
/** A host from a view's ctx: Overview, Settings → Atlas, the Atlas builder. Never a wall (?kiosk=1 or full screen). */
export function hostFromCtx(ctx, extra) {
  const st = ctx.state || {}, A = ctx.actions || {};
  const snap = st.live && st.live.snapshot;
  return {
    settings: st.settings,
    admin: !!(ctx.hass && ctx.hass.user && ctx.hass.user.is_admin),
    basic: st.complexity === "basic",
    kiosk: wallScreen(!!st.kioskMode),
    live: st.dataMode === "live",
    facts: () => factsFrom({ states: ctx.hass && ctx.hass.states, entities: ctx.hass && ctx.hass.entities, model: st.model,
      plans: st.maps && Array.isArray(st.maps.list) ? st.maps.list : null, radios: snap && snap.ble && Array.isArray(snap.ble.radios) ? snap.ble.radios : null,
      settings: st.settings, wifiSurvey: st._wifiSurveyOn }),
    save: (patch) => Promise.resolve(A.wsCall ? A.wsCall("padspan_ha/settings_set", { ...patch }) : null)
      .then((r) => { if (r && r.settings) st.settings = r.settings; }),
    send: (w) => { if (A.telemetryEvent) A.telemetryEvent(w); },
    go: (target) => goCtx(ctx, target),
    canGo: (target) => !!target && (!!target.atlas
      || (!!target.view && (target.view === "settings" || typeof A.canOpen !== "function" || A.canOpen(target.view)))),
    rerender: () => { if (A.renderRooms) A.renderRooms(); },
    toast: (m) => { if (typeof ctx.toast === "function") ctx.toast(m); },
    ...(extra || {}),
  };
}

// ── what it looks like ──────────────────────────────────────────────────────
function h(tag, attrs, kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === "style") n.style.cssText = v;
    else if (k === "text") n.textContent = v;
    else n.setAttribute(k, v === true ? "" : String(v));
  }
  for (const c of [].concat(kids || [])) if (c != null && c !== false) n.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
  return n;
}
const BTN = "min-height:36px;padding:6px 12px;font-size:12px";
function _button(label, attrs, onclick, accent) {
  const b = h("button", { class: "btn inline", type: "button", ...attrs,
    style: BTN + (accent ? ";background:#0a2a1a;border-color:#52b788;color:#52b788;font-weight:700" : ";color:#94a3b8") }, label);
  b.addEventListener("click", (e) => { if (e && e.stopPropagation) e.stopPropagation(); onclick(); });
  return b;
}
function _actions(host, tip, mark) {
  const go = tip.target && typeof host.go === "function"
    ? _button(t("Show me"), { [mark]: "go" }, () => answer(host, tip, "go"), true) : null;
  return h("div", { style: "display:flex;gap:8px;flex-wrap:wrap;align-items:center" }, [
    go,
    _button(t("Got it"), { [mark]: "not_now" }, () => answer(host, tip, "not_now")),
    _button(t("No more tips"), { [mark]: "off" }, () => answer(host, tip, "off")),
  ]);
}

/** The Overview's card (panel.js _featureTipCard), in the other Overview cards' look; null when none. */
export function overviewCard(host, now = Date.now()) {
  const tip = currentTip(host, "overview", "overview", now);
  if (!tip) return null;
  const card = h("div", { "data-feature-tip": tip.id, role: "note",
    style: "background:#0a1f14;border:1px solid #1a4228;border-radius:8px;padding:10px 14px;margin-bottom:12px" });
  const x = h("button", { class: "btn inline", type: "button", "data-feature-tip-act": "dismiss", title: t("Hide this tip"), "aria-label": t("Hide this tip"),
    style: "margin-left:auto;min-width:36px;min-height:36px;padding:0 8px;font-size:13px;color:#94a3b8" }, "✕");
  x.addEventListener("click", () => answer(host, tip, "dismiss"));
  card.appendChild(h("div", { style: "display:flex;align-items:flex-start;gap:8px;margin-bottom:4px" }, [
    h("div", { style: "flex:1;min-width:0" }, [
      h("div", { style: "font-size:10px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#7fb79a" }, t("Tip")),
      h("div", { style: "font-weight:700;font-size:13px;color:#52b788" }, tip.title),
    ]),
    x,
  ]));
  card.appendChild(h("div", { style: "font-size:12px;color:#cbd5e1;line-height:1.55;margin-bottom:8px" }, tip.body));
  card.appendChild(_actions(host, tip, "data-feature-tip-act"));
  return card;
}

/** A small quiet line where the Atlas is adjusted: Settings → Atlas ("settings_atlas") and
 *  Mapping → Atlas builder ("atlas_builder"). null when none. */
export function adjustLine(host, spot, now = Date.now()) {
  const tip = currentTip(host, "atlas_adjust", spot, now);
  if (!tip) return null;
  return h("div", { "data-feature-tip": tip.id, "data-feature-tip-spot": spot, role: "note",
    style: "display:flex;align-items:center;gap:8px 12px;flex-wrap:wrap;margin:0 0 12px;padding:8px 12px;border-radius:8px;"
      + "border:1px solid #1a4228;border-left:3px solid #52b788;background:rgba(82,183,136,.06);font-size:12px;color:#cbd5e1" }, [
    h("div", { style: "flex:1 1 260px;min-width:0;line-height:1.5" }, [
      h("span", { style: "color:#52b788;font-weight:700" }, tip.title + ". "),
      h("span", {}, tip.body),
    ]),
    _actions(host, tip, "data-feature-tip-act"),
  ]);
}

/**
 * The ⋯ list's tip (live_aboard_show.js createShowMenu draws it, under its heading): plain
 * data, or null. keys: the list's lines; a tip whose line is among them shows that line
 * ("Show me" points at it) instead of leaving the screen. The host's go leaves for the
 * PadSpan panel; it has none in Basic or on a wall, where only a line can be shown.
 */
export function menuTip(host, keys, now = Date.now()) {
  const lines = Array.isArray(keys) ? keys : [];
  const hh = { ...host, hasLine: (k) => lines.includes(k) };
  const tip = currentTip(hh, "atlas_adjust", "atlas_menu", now);
  if (!tip) return null;
  const line = tip.line && lines.includes(tip.line) ? tip.line : null;
  const canGo = !!line || (!!tip.target && typeof hh.go === "function" && (typeof hh.canGo !== "function" || hh.canGo(tip.target)));
  return {
    id: tip.id, title: tip.title, body: tip.body, line,
    words: { label: t("Tip"), go: t("Show me"), notNow: t("Got it"), off: t("No more tips") },
    canGo,
    go: () => answer(line ? { ...hh, go: null } : hh, line ? { ...tip, target: null } : tip, "go", Date.now()),
    notNow: () => answer(hh, tip, "not_now", Date.now()),
    off: () => answer(hh, tip, "off", Date.now()),
  };
}

/**
 * Settings → Appearance → Tips: the switch ("No more tips" turns it off; here it comes
 * back), and every tip that fits this house, seen ones too, each with Show me: the
 * place to find one again.
 */
export function settingsCard(host) {
  const s = (host && host.settings) || {};
  if (!("tips_enabled" in s)) return null;          // an older backend: nothing to switch
  const admin = !!host.admin, houseOff = s.tips_enabled === false;
  const on = tipsOnFor(host);
  const card = h("div", { class: "card", "data-focus-part": "tips", "data-tips-card": "", style: "margin-top:12px" });
  card.appendChild(h("div", { class: "h2", style: "margin:0 0 4px;color:#52b788" }, t("Tips")));
  const cb = h("input", { type: "checkbox", id: "tipsEnabledToggle", "data-tips-card": "switch", style: "width:18px;height:18px;accent-color:#52b788;cursor:pointer" });
  cb.checked = on;
  // Off for the whole house: only an administrator turns it back on.
  if (!admin && houseOff) cb.disabled = true;
  const set = (want) => {
    if (!want) _send(host, "tips_off");
    if (!admin) { _setLocalOff(!want); if (typeof host.rerender === "function") host.rerender(); return; }
    _write(host, { tips_enabled: want }).then(() => { if (typeof host.rerender === "function") host.rerender(); });
  };
  cb.addEventListener("change", () => set(cb.checked));
  card.appendChild(h("label", { for: "tipsEnabledToggle", style: "display:flex;align-items:center;gap:8px;min-height:36px;cursor:pointer;font-size:13px;color:#e2e8f0;font-weight:600" },
    [cb, t("Show a tip now and then")]));
  card.appendChild(h("div", { class: "muted", style: "font-size:12px;margin-top:2px;line-height:1.5" },
    t("At most one a day, about something this house already has and doesn't use yet: on the Overview, or where you adjust the Atlas. Never on a wall screen, and never one you've seen before.")));
  if (!admin) card.appendChild(h("div", { class: "muted", "data-tips-card": "local", style: "font-size:12px;margin-top:4px" },
    houseOff ? t("An administrator turned tips off for the whole house.") : t("This switch is for this browser only.")));
  if (!on && !(houseOff && !admin)) {
    card.appendChild(h("div", { style: "display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-top:8px" }, [
      h("span", { class: "muted", style: "font-size:12px" }, t("Tips are off.")),
      _button(t("Bring tips back"), { "data-tips-card": "back" }, () => set(true), true),
    ]));
  }
  const list = rankTips(fitTips({ settings: s, facts: typeof host.facts === "function" ? host.facts() : host.facts,
    admin: !!host.admin, basic: !!host.basic, canGo: host.canGo }), s.server_tips_rank);
  if (list.length) {
    const det = h("details", { "data-tips-card": "list", style: "margin-top:10px" });
    det.appendChild(h("summary", { style: "cursor:pointer;font-size:13px;color:#cbd5e1;min-height:36px;display:flex;align-items:center" },
      t("Every tip for this house ({n})", { n: list.length })));
    for (const { tip } of list) {
      const row = h("div", { "data-tips-row": tip.id, style: "display:flex;align-items:center;gap:10px;padding:6px 0;border-top:1px solid #12301f;font-size:12px" }, [
        h("div", { style: "flex:1;min-width:0;line-height:1.45" }, [
          h("div", { style: "color:#e2e8f0;font-weight:600" }, tip.title),
          h("div", { class: "muted" }, tip.body),
        ]),
        _button(t("Show me"), { "data-tips-row-go": tip.id }, () => { if (typeof host.go === "function") host.go(tip.target); }),
      ]);
      det.appendChild(row);
    }
    card.appendChild(det);
  }
  return card;
}
