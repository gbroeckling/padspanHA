// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
// See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
//
// Live Aboard's ⋯ list, "Show on this screen" (Garry, 2026-11-05): a small ⋯
// beside the compass, on every screen (the wall too), opens a checklist of
// everything the 3D house draws, grouped, each ticked on or off for this
// screen only.
//
//   this screen  every tick is this browser's, per screen (prefs, the
//                view's own store, as its saved views are); an item never
//                changed follows the house's own setting, and the list never
//                writes one. "Back to house defaults" forgets them all.
//   alarms       leak, smoke, CO and gas, and their ring and pill, are in
//                the list ticked and greyed: always shown
//   not set up   an item this house hasn't made ready (no weather source
//                for rain, no receivers placed, people off for the house…)
//                stays in the list with one friendly line and one tap to
//                where it is set up; ready, it never says so
//   people       a screen can hide people (and tags), never show them for
//                the house: off for the house, the line takes an
//                administrator to the switch (Views ▾ → Show people, where
//                it is switched while Live Aboard is on) and tells anyone
//                else an administrator turns it on there
//   hidden       not drawn at all, costing nothing; the view draws again
//                only when the list changes, never on a poll because of it
//   a wall       (?kiosk=1) nothing in the list leaves the page: a line not
//                set up says where to set it up from another screen
//                (2026-11-07: a link there left the wall on the main panel)
//
// The view (live_aboard.js) works out what each tick hides and what is ready;
// this file holds the list, the prefs, the opt-in report's words and the
// dropdown itself. Imports nothing: the view and the house module read it.

/** The groups, in the order they are listed. */
export const SHOW_GROUPS = [
  ["lights", "Lights"], ["motion", "Motion and sensors"], ["openings", "Doors, windows and locks"],
  ["tracked", "People and tracking"], ["house", "The house"], ["look", "Weather and look"],
];

/**
 * Every line of the list. key: its name in the prefs and the report (never
 * changed once shipped); words: what people call it; hint: what it hides;
 * link: where it is set up or placed (the host's goTo); always: never
 * hidden (alarms); later: a line a later piece wires (left out until then).
 */
export const SHOW_ITEMS = [
  { key: "lights", group: "lights", words: "Lights", hint: "Ceiling lights, pots, pendants, lamps: every light that isn't a strip or a fan", link: "place" },
  { key: "glow", group: "lights", words: "Light glow", hint: "The pool, glow and wash a light that is on throws (the bulbs stay)" },
  { key: "strips", group: "lights", words: "LED strips", hint: "Strips, coves, valances, under-cabinet and TV lights", link: "place" },
  { key: "fans", group: "lights", words: "Ceiling fans", hint: "Fans and their blades", link: "place" },
  // The scene row under the map (scene_row.js): on wherever the house has a
  // scene or a one-floor preset; not set up, the line opens Home Assistant's
  // new-scene editor (an administrator's, never on a wall).
  { key: "scenes", group: "lights", words: "Scene row", hint: "The lighting scenes under the map: tap one to run it, again to turn it off", link: "scene_new", flat: true },
  // Not a drawing: a tap on a light or an LED strip switches it, in 3D and on the flat Map
  // (live_aboard_use.js tapSwitch, lights_map.js wireUseSurface). On unless a screen unticks it
  // (a wall in a busy room). The Atlas tab and its walls only (live_aboard.js showRows: mapOnly).
  { key: "light_taps", group: "lights", words: "Tap a light to switch it", hint: "Here and on the flat Map. Off: a tap on a light switches nothing on this screen; holding still opens its controls", flat: true },
  { key: "motion_sensors", group: "motion", words: "Motion sensors", hint: "The sensors on the walls and their markers", link: "place" },
  { key: "motion_rooms", group: "motion", words: "Motion in rooms", hint: "A room's floor glowing after motion, and the Motion chip" },
  { key: "motion_reach", group: "motion", words: "Motion reach", hint: "The patch of floor a sensor sees, shown on a trigger or a tap" },
  { key: "readouts", group: "motion", words: "Temperature and air", hint: "The chips under room names: temperature, humidity, air", link: "place" },
  { key: "alarms", group: "motion", words: "Leak, smoke, CO and gas alarms", hint: "Always shown, with their ring and pill", always: true, link: "place" },
  { key: "doors", group: "openings", words: "Doors", hint: "Every door leaf; the doorway stays open", link: "walls" },
  { key: "windows", group: "openings", words: "Windows", hint: "Every pane; the opening stays", link: "walls" },
  { key: "covers", group: "openings", words: "Garage doors and gates", hint: "Doors that follow a cover in Home Assistant", link: "walls" },
  { key: "locks", group: "openings", words: "Locks", hint: "Lock markers, and an unlocked door's red glow", link: "place" },
  { key: "railings", group: "openings", words: "Railings", hint: "Deck rails, stair rails and the rails on open edges", link: "walls" },
  { key: "radios", group: "tracked", words: "Receivers (radios)", hint: "The Bluetooth receivers (scanners) where they are placed", link: "receivers" },
  // People and tags are switched for the house in Views ▾ while Live Aboard is on (settings.js says so): no Settings link.
  { key: "tags", group: "tracked", words: "Beacons and tags", hint: "Every tag PadSpan places, with its name" },
  { key: "people", group: "tracked", words: "People", hint: "Each person where their phone or tag is" },
  { key: "trails", group: "tracked", words: "Trails, last 30 min", hint: "Where each person and tag went in the last half hour" },
  { key: "codes", group: "tracked", words: "Device codes", hint: "The small code chips beside devices", link: "place" },
  { key: "furniture", group: "house", words: "Furniture", hint: "Every piece placed in Furnish", link: "furnish" },
  { key: "devices", group: "house", words: "Devices in furniture", hint: "Pieces that are a device (a TV, a washer): their screens and lights", link: "furnish" },
  { key: "stairs", group: "house", words: "Stairs", hint: "The flights (the opening in the floor stays)", link: "furnish" },
  { key: "room_names", group: "house", words: "Room names", hint: "Each room's name on its floor", link: "rooms" },
  { key: "room_outlines", group: "house", words: "Room outlines", hint: "The coloured line round each room", link: "rooms" },
  { key: "floor_outlines", group: "house", words: "Floor outlines", hint: "The faint line round each floor", link: "la3d" },
  // The flat Map's (lights_map.js focusAlone): with one floor chosen it is drawn alone, as big as the screen,
  // unless this is ticked. Off unless ticked (dflt: false, the house's own for every house).
  { key: "other_floors", group: "house", words: "Other floors, faded", hint: "On the flat Map with one floor chosen: the other floors stay, faded. Off: the chosen floor fills the screen", flat: true, dflt: false },
  { key: "roof", group: "house", words: "Roof", hint: "The roof, seen from outside (the Roof button too)" },
  { key: "rain", group: "look", words: "Rain and snow", hint: "Rain and snow falling round the house", link: "weather" },
  { key: "theme", group: "look", words: "Theme colours", hint: "Off: the Classic look on this screen", link: "showcase" },
  { key: "forest", group: "look", words: "West Coast Forest trees", hint: "The trees round the house", link: "showcase" },
];
const BY_KEY = new Map(SHOW_ITEMS.map(it => [it.key, it]));
/** The lines the flat Map honours too (lights_map.js flatShow): the only ones its own ⋯ list shows. */
export const FLAT_KEYS = SHOW_ITEMS.filter(it => it.flat).map(it => it.key);
/** The lines a person can tick (not the alarms, not a line still to come). */
export const SHOW_KEYS = SHOW_ITEMS.filter(it => !it.always && !it.later).map(it => it.key);
/** Where each place a line links to is, in words (the host's goTo knows the way). */
export const LINK_WORDS = {
  place: ["Mapping", "Mapping → Atlas, where devices are placed"],
  walls: ["Mapping", "Mapping → Edit, where walls, doors and windows are drawn"],
  rooms: ["Mapping", "Mapping → Edit, where rooms are drawn and named"],
  receivers: ["Mapping", "Mapping → Edit, where receivers are placed"],
  furnish: ["Mapping", "Mapping → Furnish"],
  la3d: ["Settings", "Settings → Atlas → Live Aboard"],
  weather: ["Settings", "Settings → Atlas → Outdoor weather"],
  showcase: ["Mapping", "Mapping → Atlas → Showcase options"],
  atlas: ["Settings", "Settings → Atlas"],
  // Home Assistant's own scene editor (scene_row.js SCENE_PLACE), not a PadSpan page.
  scene_new: ["Home Assistant", "Home Assistant → Settings → Automations & scenes → Scenes"],
};
/** Where each is, for the host's goTo({view, tab, part}): the panel's own
 *  screen, its tab, and the card on it (settings.js data-focus-part). */
export const GO_TO = {
  place: { view: "maps", tab: "lights" }, showcase: { view: "maps", tab: "lights" },
  walls: { view: "maps", tab: "edit" }, rooms: { view: "maps", tab: "edit" }, receivers: { view: "maps", tab: "edit" },
  furnish: { view: "maps", tab: "furnish" },
  la3d: { view: "settings", tab: "atlas", part: "la3d" }, weather: { view: "settings", tab: "atlas", part: "atlas_weather" },
  atlas: { view: "settings", tab: "atlas" },
};

// ── the opt-in report's words (telemetry.py HOUSE3D_SHOW_EVENTS holds the same)
// Counts only, never a name, a room or an address: the list opened, each line
// hidden or shown again (by its key), a "not set up" line seen (once per page
// load) and followed, someone sent to where people or tags are switched on,
// and Back to house defaults. And the scene row's (scene_row.js SCENE_EVENTS,
// the same words): the row shown, a scene run or turned off, a new scene or
// an edit opened. And "Tap a light to switch it": a light switched by a tap, or not;
// and the list opened from the flat Map's own ⋯.
export const SHOW_EVENTS = ["house3d_show:opened", "house3d_show:opened:flat", "house3d_show:reset",
  ...SHOW_KEYS.flatMap(k => [`house3d_show:hide:${k}`, `house3d_show:show:${k}`]),
  ...SHOW_KEYS.flatMap(k => [`house3d_show:setup_seen:${k}`, `house3d_show:setup_go:${k}`]),
  "house3d_show:permission:people", "house3d_show:permission:tags",
  ...["row:atlas", "row:aboard", "run:scene", "run:preset", "off:scene", "off:preset", "new:row", "new:show", "new:settings",
      "edit:scene", "edit:yaml", "edit:preset"].map(w => `house3d_show:scene_${w}`),
  // A light switched by a tap in 3D, or one that could not be.
  "house3d_show:light_tap:ok", "house3d_show:light_tap:failed"];

/** The pref this screen keeps its ticks in. */
export const prefKey = (slotKey) => `show_${slotKey}`;

/** What a screen changed, from its pref: {key: true|false}, known keys only. */
export function readShown(raw){
  let o = null;
  try { o = typeof raw === "string" && raw ? JSON.parse(raw) : null; } catch (_) { o = null; }
  const out = {};
  if (!o || typeof o !== "object" || Array.isArray(o)) return out;
  for (const k of SHOW_KEYS) if (typeof o[k] === "boolean") out[k] = o[k];
  return out;
}

/** One tick changed: the overrides to keep. Back at the house's own default,
 *  the line is forgotten, so it follows the house again. */
export function withTick(over, key, on, house){
  const out = { ...(over || {}) };
  if (!BY_KEY.has(key) || BY_KEY.get(key).always) return out;
  if (on === !!house) delete out[key]; else out[key] = !!on;
  return out;
}

/** A line's own for the house: what the view says (house), else the line's default. */
export function houseOn(house, key){
  const it = BY_KEY.get(key);
  return (house && typeof house[key] === "boolean" ? house[key] : !(it && it.dflt === false)) !== false;
}

/** Every line's state: {key: true|false}; house: {key: the house's own}. */
export function resolveShown(over, house){
  const out = {};
  for (const it of SHOW_ITEMS) out[it.key] = it.always ? true : (over && typeof over[it.key] === "boolean") ? over[it.key] : houseOn(house, it.key);
  return out;
}

/**
 * The lines as drawn: [{group, words, rows: [{key, words, hint, on, always,
 * setup: null | {text, go (a link key) | null, perm ("people" | "tags") | null},
 * link: null | {where, words, title}}]}]. on: the resolved ticks; ready:
 * {key: its setupLine} for each line not set up in this house.
 */
export function rowsOf(on, ready){
  const groups = [];
  for (const [g, gw] of SHOW_GROUPS) {
    const rows = [];
    for (const it of SHOW_ITEMS) {
      if (it.group !== g || it.later) continue;
      const r = ready && ready[it.key];
      const link = it.link && LINK_WORDS[it.link] ? { where: it.link, words: LINK_WORDS[it.link][0], title: LINK_WORDS[it.link][1] } : null;
      rows.push({ key: it.key, words: it.words, hint: it.hint, always: !!it.always, on: !!on[it.key],
                  setup: r && typeof r === "object" ? r : null, link });
    }
    if (rows.length) groups.push({ group: g, words: gw, rows });
  }
  return groups;
}

/** What a line says when its feature isn't ready in this house: its words,
 *  where "Set it up" goes, and, for people and tags (an administrator's),
 *  the permission path. canGo: the host can open that place (not in Basic,
 *  where the line names it instead); kiosk: a wall, told to set it up from
 *  another screen. */
export function setupLine(key, admin, canGo = true, why = null, kiosk = false){
  const it = BY_KEY.get(key);
  const name = it ? it.words : key;
  if (key === "people" || key === "tags") {
    const sw = key === "people" ? "Show people" : "Show tags & scanners";
    return { text: admin ? `${name} are off for the whole house. Turn them on?` : `${name} are off for the whole house: an administrator turns them on (Views ▾ → ${sw}).`,
             go: null, perm: key, button: admin ? "Show me the switch ›" : null };
  }
  const SAYS = {
    lights: "No lights are placed yet.", light_taps: "No lights are placed yet.", strips: "No LED strips are placed yet.", fans: "No ceiling fans are placed yet.",
    motion_sensors: "No motion sensors are placed yet.", motion_rooms: "No motion sensors are placed yet.", motion_reach: "No motion sensors are placed yet.",
    readouts: "No temperature or air sensors are placed yet.", locks: "No locks are placed yet.",
    doors: "No doors are drawn yet.", windows: "No windows are drawn yet.", covers: "No door follows a garage door or gate yet.",
    railings: "No deck or stair rails yet.", radios: "No receivers are placed yet.", furniture: "No furniture yet.",
    devices: "No furniture is a device yet.", stairs: "No stairs yet.", room_names: "No rooms are drawn yet.",
    room_outlines: "No rooms are drawn yet.", rain: "Rain and snow aren't set up yet: they need a weather source.",
    theme: "No theme is on yet.", forest: "The trees come with the West Coast Forest theme.",
    floor_outlines: "Floor outlines come with the Atlas's look.",
    trails: "Trails follow people and tags: turn one of them on first.",
    trails_live: "Trails need live data (Traceback's last half hour).",
    scenes: "No lighting scenes yet: a Home Assistant scene with a placed light, or a Whole house preset that lights one floor.",
  };
  const said = typeof why === "string" && why ? why : SAYS[key] || `${name} isn't set up yet.`;
  const go = it && it.link && key !== "trails" ? it.link : null;
  // Where, in words: a PadSpan page is named as one, for a wall's "from another screen".
  const where = go ? (go === "scene_new" ? LINK_WORDS[go][1] : `PadSpan → ${LINK_WORDS[go][1]}`) : "";
  const make = key === "scenes";
  const text = !go ? said
    : kiosk ? `${said} ${make ? "Make one" : "Set it up"} from another screen, in ${where}.`
    : !admin ? `${said} An administrator ${make ? "makes scenes" : "sets it up"} in ${LINK_WORDS[go][1]}.`
    : canGo ? `${said} ${make ? "Make one?" : "Set it up?"}` : `${said} It's ${make ? "done" : "set up"} in ${LINK_WORDS[go][1]}.`;
  const can = admin && canGo && !kiosk;
  return { text, go: can ? go : null, perm: null, button: can && go ? "Yes ›" : null };
}

/**
 * The flat Map's ⋯ list (lights_map.js, the Atlas tab and its walls): this
 * same list, with only the lines the flat Map honours (FLAT_KEYS that this
 * screen has), on this screen's own pref, so a tick here is the 3D look's
 * too and the reverse. Returns createShowMenu's v (but root, anchor, guard).
 * o = { prefs: {get, set}, slot, lines() → keys shown, ready() → {key:
 * setupLine} not set up, go(where, key), canGo(), count(name), changed(key):
 * the flat Map follows a tick (null: every line) }.
 */
export function flatMenu(o){
  const over = () => readShown(o.prefs.get(prefKey(o.slot)));
  const save = (x) => o.prefs.set(prefKey(o.slot), JSON.stringify(x));
  const lines = () => o.lines().filter(k => FLAT_KEYS.includes(k));
  return {
    rows: () => {
      const ready = o.ready(), on = resolveShown(over(), {}), keys = lines();
      for (const k of Object.keys(ready)) on[k] = false;
      return rowsOf(on, ready).map(g => ({ ...g, rows: g.rows.filter(r => keys.includes(r.key)).map(r => (r.key === "scenes" ? { ...r, link: null } : r)) }))
        .filter(g => g.rows.length);
    },
    changed: () => lines().some(k => k in over()),
    toggle: (key) => {
      if (o.ready()[key]) return;
      const was = resolveShown(over(), {})[key];
      save(withTick(over(), key, !was, houseOn({}, key)));
      o.count(`house3d_show:${was ? "hide" : "show"}:${key}`);
      o.changed(key);
    },
    setup: (row) => { if (row.setup && row.setup.go) { o.count(`house3d_show:setup_go:${row.key}`); o.go(row.setup.go, row.key); } },
    go: (where, key) => o.go(where, key),
    canGo: () => !!o.canGo(),
    reset: () => {
      const keys = lines();
      save(Object.fromEntries(Object.entries(over()).filter(([k]) => !keys.includes(k))));
      o.count("house3d_show:reset");
      o.changed(null);
    },
    opened: () => o.count("house3d_show:opened:flat"),
  };
}

// ── the dropdown ─────────────────────────────────────────────────────────────
const CSS = `
.la3d-more{all:unset;box-sizing:border-box;position:absolute;left:70px;top:14px;z-index:2;width:44px;height:44px;border-radius:50%;
  display:flex;align-items:center;justify-content:center;cursor:pointer;color:#e2e8f0;font:800 22px/1 system-ui,"Segoe UI",sans-serif;
  letter-spacing:1px;background:rgba(6,14,9,.86);border:1px solid rgba(120,190,155,.26);box-shadow:0 4px 14px rgba(0,0,0,.35);
  transition:opacity .25s ease,visibility .25s}
.la3d-more:hover,.la3d-more:focus-visible,.la3d-more[aria-expanded="true"]{background:rgba(45,106,79,.92);border-color:#52b788}
.la3d-more.la3d-changed::after{content:"";position:absolute;right:-3px;top:-3px;width:14px;height:14px;border-radius:50%;background:var(--accent,#52b788);
  border:2px solid rgba(6,14,9,.95);box-shadow:0 0 6px var(--accent,#52b788)}
.la3d.la3d-bare .la3d-more,.la3d.la3d-bare .la3d-show{opacity:0;visibility:hidden;pointer-events:none}
/* On the flat Map: a rail button (styles.css .lv-railbtn, lights_map.js), with the same dot. */
.la3d-flatmore.la3d-changed::after{content:"";position:absolute;right:-4px;top:-4px;width:10px;height:10px;border-radius:50%;background:var(--accent,#52b788);
  border:2px solid rgba(6,14,9,.95)}
.la3d-show{position:absolute;left:10px;top:66px;z-index:5;box-sizing:border-box;width:min(640px,calc(100% - 20px));
  max-height:calc(100% - 132px);display:flex;flex-direction:column;border-radius:14px;background:rgba(6,14,9,.96);
  border:1px solid rgba(120,190,155,.3);box-shadow:0 12px 32px rgba(0,0,0,.55);color:#e2e8f0;font:13px/1.35 system-ui,"Segoe UI",Roboto,sans-serif}
.la3d.la3d-narrow .la3d-show{max-height:calc(100% - 120px)}
.la3d-show .la3d-shead{display:flex;align-items:center;gap:8px;padding:10px 8px 6px 14px}
.la3d-show .la3d-shead b{flex:1;font-size:15px}
.la3d-show .la3d-shead span{color:#94a3b8;font-size:12px}
.la3d-show button{all:unset;box-sizing:border-box;cursor:pointer}
.la3d-show .la3d-sx{min-width:40px;height:40px;border-radius:10px;text-align:center;font-size:18px;line-height:40px;color:#94a3b8}
.la3d-show .la3d-sx:hover,.la3d-show .la3d-sx:focus-visible{background:rgba(255,255,255,.08);color:#e2e8f0}
.la3d-show .la3d-sbody{overflow:auto;padding:0 8px 4px;overscroll-behavior:contain;-webkit-overflow-scrolling:touch;columns:2 270px;column-gap:10px}
.la3d-show .la3d-sgrp{break-inside:avoid;padding:4px 0 6px}
.la3d-show .la3d-sgrp > i{display:block;font-style:normal;padding:6px 6px 3px;font-size:11px;font-weight:700;letter-spacing:.06em;
  text-transform:uppercase;color:#7fb79a}
.la3d-show .la3d-srow{display:flex;align-items:flex-start;gap:4px;border-radius:10px}
.la3d-show .la3d-srow:hover{background:rgba(82,183,136,.10)}
.la3d-show .la3d-stick{flex:1;min-width:0;display:flex;align-items:center;gap:10px;min-height:40px;padding:5px 6px;border-radius:10px}
.la3d-show .la3d-stick:focus-visible{outline:2px solid #52b788}
.la3d-show .la3d-sbox{flex:none;width:22px;height:22px;border-radius:6px;border:2px solid #64748b;box-sizing:border-box;display:flex;
  align-items:center;justify-content:center;font:900 14px/1 system-ui,sans-serif;color:#071008}
.la3d-show .la3d-stick[aria-checked="true"] .la3d-sbox{background:#52b788;border-color:#52b788}
.la3d-show .la3d-stick[aria-checked="true"] .la3d-sbox::before{content:"✓"}
.la3d-show .la3d-stick[aria-checked="false"] .la3d-sname{color:#94a3b8}
.la3d-show .la3d-stick[aria-disabled="true"]{cursor:default}
.la3d-show .la3d-stick[aria-disabled="true"] .la3d-sbox{background:#3f5a4b;border-color:#3f5a4b;color:#cbd5e1}
.la3d-show .la3d-stick.la3d-snot .la3d-sbox{background:none;border:2px dashed #475569}
.la3d-show .la3d-stick.la3d-snot .la3d-sname{color:#94a3b8}
.la3d-show .la3d-sname{display:block;font-weight:600;font-size:14px}
.la3d-show .la3d-snote{display:block;font-size:11.5px;color:#94a3b8;margin-top:1px}
.la3d-show .la3d-slink{flex:none;margin:6px 2px 0 0;padding:6px 8px;border-radius:8px;font-size:11.5px;font-weight:700;color:#7dd3fc;white-space:nowrap}
.la3d-show .la3d-slink:hover,.la3d-show .la3d-slink:focus-visible{background:rgba(125,211,252,.12)}
.la3d-show .la3d-setup{margin:-2px 6px 5px 38px;padding:4px 4px 4px 9px;border-radius:9px;background:rgba(251,191,36,.08);border:1px solid rgba(251,191,36,.28);
  font-size:12px;color:#fde68a;display:flex;align-items:center;gap:8px}
.la3d-show .la3d-setup span{flex:1;min-width:0}
.la3d-show .la3d-setup button{flex:none;min-height:30px;padding:5px 11px;border-radius:8px;font-weight:700;color:#071008;background:#fbbf24;white-space:nowrap}
.la3d-show .la3d-setup button:hover,.la3d-show .la3d-setup button:focus-visible{background:#fcd34d}
.la3d-show .la3d-sfoot{display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:8px 10px 10px;border-top:1px solid rgba(120,190,155,.18)}
.la3d-show .la3d-sfoot button{padding:8px 12px;border-radius:9px;font-weight:700}
.la3d-show .la3d-sreset{background:rgba(82,183,136,.18);border:1px solid rgba(82,183,136,.45)}
.la3d-show .la3d-sreset[aria-disabled="true"]{opacity:.45;cursor:default}
.la3d-show .la3d-sset{margin-left:auto;color:#7dd3fc}
:host([data-wall]) .la3d-more,:host([data-wall]) .la3d-show{zoom:var(--wall-ctl,var(--wall-ui,1))}
/* A wall (2026-11-09, "fits the wall"): the whole list on the screen
   with no scrolling. As wide and tall as the screen lets it be (over the
   bottom bar while it is open), up to four columns;
   each line its plain name (no hint under it), a line not
   set up its one short note under it; the rows stay finger-sized. */
:host([data-wall]) .la3d-show{width:min(1240px,calc(100% - 20px));max-height:calc(100% - 76px)}
:host([data-wall]) .la3d-show .la3d-sbody{columns:4 230px}
:host([data-wall]) .la3d-show .la3d-sgrp{break-inside:auto;padding:0 0 4px}
:host([data-wall]) .la3d-show .la3d-sgrp > i{break-after:avoid}
:host([data-wall]) .la3d-show .la3d-srow,:host([data-wall]) .la3d-show .la3d-setup{break-inside:avoid}
:host([data-wall]) .la3d-show .la3d-snote{display:none}
:host([data-wall]) .la3d-show .la3d-setup{break-before:avoid;margin:-2px 4px 4px 36px;padding:3px 3px 3px 8px;font-size:11.5px;line-height:1.25}`;

/**
 * The ⋯ button and its list, in the view's element. v = {
 *   root, guard(fn)
 *   rows()           rowsOf(...) for the list now
 *   changed()        has this screen changed anything (the ⋯ wears a dot)?
 *   toggle(key)      tick or untick a line; the view redraws
 *   setup(row)       a "not set up" line's button
 *   go(where)        a link (null: the host has no way there)
 *   canGo()          can the host go anywhere at all?
 *   reset()          Back to house defaults
 *   opened()         the list opened (the report)
 *   seen(rows)       the lines shown (the report: "not set up" seen)
 *   onOpen(), onClose()   the view closes its other menus, and repaints
 * }
 */
export function createShowMenu(v){
  const doc = v.root.ownerDocument || document;
  const d = (tag, cls, text) => { const n = doc.createElement(tag); if (cls) n.className = cls; if (text !== undefined) n.textContent = text; return n; };
  const css = d("style");
  css.textContent = CSS;
  v.root.appendChild(css);
  // v.button: a ⋯ the host already drew (the flat Map's, in its rail), the
  // list opening over v.root; else this one, beside the compass.
  const btn = v.button || d("button", "la3d-more", "⋯");
  if (!v.button) {
    btn.type = "button";
    btn.title = "Show on this screen: pick what the map shows";
    btn.setAttribute("aria-label", "Show on this screen: pick what the map shows");
    btn.setAttribute("aria-haspopup", "true");
    btn.setAttribute("aria-expanded", "false");
    btn.setAttribute("data-la3d-more", "");
    v.root.appendChild(btn);
  }
  let box = null, off = null;
  const stop = (e) => { if (e && e.stopPropagation) e.stopPropagation(); };
  for (const ev of ["pointerup", "wheel", "dblclick"]) btn.addEventListener(ev, stop);
  btn.addEventListener("click", v.guard((e) => { stop(e); if (box) close(); else open(); }));

  function close(){
    if (off) off();
    off = null;
    if (box && box.parentNode) box.parentNode.removeChild(box);
    const was = !!box;
    box = null;
    btn.setAttribute("aria-expanded", "false");
    if (was && v.onClose) v.onClose();
  }
  function paint(){
    if (!box) return;
    const body = box.querySelector(".la3d-sbody"), top = body ? body.scrollTop : 0;
    while (body.firstChild) body.removeChild(body.firstChild);
    const groups = v.rows();
    for (const g of groups) {
      const gEl = d("div", "la3d-sgrp");
      gEl.setAttribute("role", "group");
      gEl.setAttribute("aria-label", g.words);
      gEl.appendChild(d("i", null, g.words));
      for (const r of g.rows) {
        const row = d("div", "la3d-srow");
        row.setAttribute("data-show", r.key);
        const tick = d("button", "la3d-stick");
        tick.type = "button";
        tick.setAttribute("role", "menuitemcheckbox");
        tick.setAttribute("aria-checked", String(!!r.on));
        const box0 = d("span", "la3d-sbox");
        const words = d("span", null);
        words.style.minWidth = "0";
        words.appendChild(d("span", "la3d-sname", r.words));
        words.appendChild(d("span", "la3d-snote", r.always ? "Always shown" : r.hint));
        tick.append(box0, words);
        tick.title = r.always ? `${r.words}: always shown, so an alarm is never missed` : `${r.on ? "Hide" : "Show"} ${r.words.toLowerCase()} on this screen`;
        // Not set up: greyed, a dashed box (people and tags: a tap still takes an administrator to their switch).
        if (r.setup) tick.classList.add("la3d-snot");
        if (r.always || (r.setup && !r.setup.perm)) { tick.setAttribute("aria-disabled", "true"); if (r.setup) tick.title = r.setup.text; }
        else tick.addEventListener("click", v.guard((e) => { stop(e); v.toggle(r.key); paint(); }));
        row.appendChild(tick);
        if (r.link && v.canGo() && !(r.setup && r.setup.button)) {
          const a = d("button", "la3d-slink", `${r.link.words} ›`);
          a.type = "button";
          a.title = `Open ${r.link.title}`;
          a.setAttribute("data-go", r.link.where);
          a.addEventListener("click", v.guard((e) => { stop(e); close(); v.go(r.link.where, r.key); }));
          row.appendChild(a);
        }
        gEl.appendChild(row);
        if (r.setup) {
          const s = d("div", "la3d-setup");
          s.setAttribute("data-setup", r.key);
          s.appendChild(d("span", null, r.setup.text));
          if (r.setup.button && (r.setup.perm || (r.setup.go && v.canGo()))) {
            const b = d("button", null, r.setup.button);
            b.type = "button";
            b.addEventListener("click", v.guard((e) => { stop(e); close(); v.setup(r); }));
            s.appendChild(b);
          }
          gEl.appendChild(s);
        }
      }
      body.appendChild(gEl);
    }
    body.scrollTop = top;
    const reset = box.querySelector(".la3d-sreset");
    if (reset) reset.setAttribute("aria-disabled", String(!v.changed()));
    btn.classList.toggle("la3d-changed", !!v.changed());
    if (v.seen) v.seen(groups);
  }
  function open(){
    close();
    if (v.onOpen) v.onOpen();
    box = d("div", "la3d-show");
    box.setAttribute("role", "dialog");
    box.setAttribute("aria-label", "Show on this screen");
    box.setAttribute("data-la3d-show", "");
    for (const ev of ["pointerdown", "pointerup", "wheel", "dblclick", "contextmenu"]) box.addEventListener(ev, stop);
    const head = d("div", "la3d-shead");
    head.appendChild(d("b", null, "Show on this screen"));
    head.appendChild(d("span", null, "Only this screen changes"));
    const x = d("button", "la3d-sx", "✕");
    x.type = "button"; x.title = "Close"; x.setAttribute("aria-label", "Close");
    x.addEventListener("click", v.guard((e) => { stop(e); close(); }));
    head.appendChild(x);
    const body = d("div", "la3d-sbody");
    body.setAttribute("role", "menu");
    const foot = d("div", "la3d-sfoot");
    const reset = d("button", "la3d-sreset", "Back to house defaults");
    reset.type = "button";
    reset.title = "Show everything as the house's settings say, on this screen";
    reset.addEventListener("click", v.guard((e) => { stop(e); if (!v.changed()) return; v.reset(); paint(); }));
    foot.appendChild(reset);
    if (v.canGo()) {
      const set = d("button", "la3d-sset", "Settings → Atlas ›");
      set.type = "button"; set.title = "Open Settings → Atlas: the house's own settings";
      set.addEventListener("click", v.guard((e) => { stop(e); close(); v.go("atlas", null); }));
      foot.appendChild(set);
    }
    box.append(head, body, foot);
    v.root.appendChild(box);
    btn.setAttribute("aria-expanded", "true");
    paint();
    if (v.opened) v.opened();
    // Closed by a tap anywhere else, or Escape.
    const away = v.guard((e) => { const path = e.composedPath ? e.composedPath() : []; if (box && !path.includes(box) && !path.includes(btn)) close(); });
    const esc = v.guard((e) => { if (e.key === "Escape") { close(); try { btn.focus(); } catch (_) { /* gone */ } } });
    const win = doc.defaultView || (typeof window !== "undefined" ? window : null);
    if (win && win.addEventListener) {
      win.addEventListener("pointerdown", away, true);
      win.addEventListener("keydown", esc);
      off = () => { win.removeEventListener("pointerdown", away, true); win.removeEventListener("keydown", esc); };
    }
  }
  return {
    button: btn,
    open, close, paint,
    get isOpen(){ return !!box; },
    /** The dot on ⋯ (something hidden or shown on this screen), kept up to date. */
    mark(){ btn.classList.toggle("la3d-changed", !!v.changed()); },
    state(){
      return { open: !!box, changed: btn.classList.contains("la3d-changed"),
               rows: box ? [...box.querySelectorAll(".la3d-srow")].map(r => r.getAttribute("data-show")) : [],
               setup: box ? [...box.querySelectorAll(".la3d-setup")].map(r => [r.getAttribute("data-setup"), r.textContent]) : [] };
    },
    dispose(){ close(); try { btn.remove(); css.remove(); } catch (_) { /* gone with the view */ } },
  };
}
