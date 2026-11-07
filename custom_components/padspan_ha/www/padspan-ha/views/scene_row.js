// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
// See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
//
// The scene row (Garry, 2026-11-05): "Below the map on atlas and live aboard,
// add a row of lighting scenes. These will be little mini maps that show
// which lights the scene involves. Make these little tiny map
// representations very clear, and easy to see what they represent."
//
//   what's in it  Home Assistant's scenes (scene.*) that set a placed light,
//                 and (2026-11-06: "if a preset only has light on on one
//                 floor, add it to the bottom scene icons") the Whole house
//                 presets whose lights that are on all sit on one floor; a
//                 preset wears a small "Preset" mark
//   a tile        the floor with most of its lights, that floor's rooms, its
//                 lights lit in their own colour where known (glowing while
//                 they are on now), every other light faint, its name under
//                 it; a scene across floors says the others ("+ Upper")
//   a tap         "Toggles, on if mixed, then off": its lights not all on,
//                 it runs (scene.turn_on, or the preset applied); all on,
//                 they go off (a preset's: the lights it turns on)
//   building      + New scene at the end and ✎ on a scene open Home
//                 Assistant's own scene editor, an administrator's; a scene
//                 not made there (YAML, another integration) says so and
//                 opens the scene list; a preset's ✎ opens the Whole house
//                 bar on this page, where it was made
//   a wall        (?kiosk=1) nothing here leaves the page: what is made
//                 elsewhere says where, from another screen
//
// The pure parts (which scenes and presets qualify, on / mixed / off, the
// mini map) and the row itself. The host hands in the house, the states and
// what a tap does (lights_map.js); the row is drawn under the flat Atlas and
// in Live Aboard (live_aboard.js). Imports nothing.

/** Home Assistant's scene editor: a new scene, one scene, the list. */
export const NEW_SCENE_PATH = "/config/scene/edit/new";
export const SCENE_LIST_PATH = "/config/scene/dashboard";
/** Where a scene's ✎ goes: its own page in the editor, or the list when it has
 *  no editor id (made in YAML or by another integration). */
export function sceneEditPath(id){
  const s = typeof id === "number" ? String(id) : typeof id === "string" ? id.trim() : "";
  return s ? `/config/scene/edit/${encodeURIComponent(s)}` : SCENE_LIST_PATH;
}
/** Where scenes are made, in words (a wall and anyone not an administrator are told). */
export const SCENE_PLACE = "Home Assistant → Settings → Automations & scenes → Scenes";

// The opt-in report's words (live_aboard_show.js SHOW_EVENTS holds the same,
// and telemetry.py HOUSE3D_SHOW_EVENTS): the row shown (once per page load,
// on the flat Atlas or in Live Aboard), a scene run or turned off (an HA
// scene or a preset), a new scene opened (from the row, the ⋯ list or
// Settings), an edit opened (an HA scene, one not made in the editor, a
// preset). Counts only, never a name.
export const SCENE_EVENTS = ["house3d_show:scene_row:atlas", "house3d_show:scene_row:aboard",
  "house3d_show:scene_run:scene", "house3d_show:scene_run:preset", "house3d_show:scene_off:scene", "house3d_show:scene_off:preset",
  "house3d_show:scene_new:row", "house3d_show:scene_new:show", "house3d_show:scene_new:settings",
  "house3d_show:scene_edit:scene", "house3d_show:scene_edit:yaml", "house3d_show:scene_edit:preset"];

const isObj = (x) => !!x && typeof x === "object" && !Array.isArray(x);
const byName = (a, b) => String(a.name).localeCompare(String(b.name), undefined, { sensitivity: "base" }) || String(a.key).localeCompare(String(b.key));
const LIGHTISH = /^(light|fan)\./;

/** The fabric's outdoor floor and the registry's are one place. */
export function canonFloor(id, floors){
  const s = String(id === null || id === undefined ? "" : id);
  if (s === "__outside__" && (floors || []).some(f => f && String(f.id) === "outside")) return "outside";
  return s;
}
/** A floor's name, as the floor chips say it. */
export function floorName(id, floors){
  const f = (floors || []).find(x => x && canonFloor(x.id, floors) === id);
  if (f && f.name) return String(f.name);
  return id === "outside" || id === "__outside__" ? "Outside" : String(id || "");
}

/**
 * Home Assistant's scenes that set at least one placed light, by name:
 * [{kind: "scene", key, eid, name, id (the editor's, or null), lights (the
 * placed ones, drawn), all (every light it sets, placed or not)}]. A scene
 * Home Assistant can't run (unavailable) or that is hidden or disabled in
 * its registry is left out. placed: light_positions_m; isLight(eid): a
 * light or fan (not a lock, not a sensor).
 */
export function haScenesOf(states, { placed = {}, isLight = (e) => LIGHTISH.test(e), entities = null } = {}){
  const out = [];
  for (const [eid, st] of Object.entries(states || {})) {
    if (!eid.startsWith("scene.") || !isObj(st) || st.state === "unavailable") continue;
    const reg = entities && entities[eid];
    if (reg && (reg.hidden || reg.hidden_by || reg.disabled_by)) continue;
    const a = isObj(st.attributes) ? st.attributes : {};
    const ids = Array.isArray(a.entity_id) ? a.entity_id : typeof a.entity_id === "string" ? [a.entity_id] : [];
    const all = [...new Set(ids.filter(e => typeof e === "string" && isLight(e)))];
    const lights = all.filter(e => placed[e]);
    if (!lights.length) continue;
    const id = typeof a.id === "number" ? String(a.id) : typeof a.id === "string" && a.id.trim() ? a.id.trim() : null;
    out.push({ kind: "scene", key: eid, eid, name: String(a.friendly_name || eid.slice(6)), id, lights, all });
  }
  return out.sort(byName);
}

/**
 * The Whole house presets (settings.whole_house_presets, entities in
 * scene.apply's shape) whose lights that are on all sit on one floor, by
 * name: [{kind: "preset", key, name, preset, lights (placed, on), all
 * (every light it turns on), floor}]. Two floors or more: left out. A light
 * whose floor isn't known doesn't decide it; none placed: left out.
 */
export function presetScenesOf(presets, { placed = {}, isLight = (e) => LIGHTISH.test(e), floorOf = () => null } = {}){
  const out = [];
  for (const p of Array.isArray(presets) ? presets : []) {
    if (!isObj(p) || typeof p.name !== "string" || !p.name.trim() || !isObj(p.entities)) continue;
    const all = Object.entries(p.entities).filter(([e, s]) => isObj(s) && s.state === "on" && isLight(e)).map(([e]) => e);
    const floors = new Set(all.map(e => floorOf(e)).filter(Boolean));
    if (floors.size !== 1) continue;
    const lights = all.filter(e => placed[e]);
    if (!lights.length) continue;
    out.push({ kind: "preset", key: `preset:${p.name}`, name: p.name, preset: p, lights, all, floor: [...floors][0] });
  }
  return out.sort(byName);
}

/** Its lights now: "on" (every one that answers is on), "off" (none is) or
 *  "mixed". isOn(eid): true, false, or null (unavailable: not counted). */
export function sceneStateOf(eids, isOn){
  let n = 0, on = 0;
  for (const e of eids || []) {
    const s = isOn(e);
    if (s === null || s === undefined) continue;
    n++;
    if (s) on++;
  }
  return !on ? "off" : on === n ? "on" : "mixed";
}
/** What a tap does (Garry: "Toggles, on if mixed, then off"). */
export const tapOf = (state) => (state === "on" ? "off" : "run");
/** What the tile says its state is. */
export const STATE_WORDS = { on: "On", mixed: "Part on", off: "Off" };

/** The floors a scene's lights are on, most first (a tie: the house's own
 *  order): [{id, n}]. */
export function floorsOfLights(eids, floorOf, floors){
  const n = new Map();
  for (const e of eids || []) { const f = floorOf(e); if (f) n.set(f, (n.get(f) || 0) + 1); }
  const order = (floors || []).map(f => canonFloor(f && f.id, floors));
  const rank = (id) => { const i = order.indexOf(id); return i < 0 ? order.length : i; };
  return [...n.entries()].map(([id, k]) => ({ id, n: k })).sort((a, b) => b.n - a.n || rank(a.id) - rank(b.id) || a.id.localeCompare(b.id));
}

/** A light's colour from its attributes (or a preset's stored state), as
 *  CSS, or null when it isn't known (drawn the Atlas's warm amber). */
export function colourOfAttrs(a){
  if (!isObj(a)) return null;
  const rgb = a.rgb_color || a.rgbw_color || a.rgbww_color;
  if (Array.isArray(rgb) && rgb.length >= 3 && rgb.slice(0, 3).every(v => Number.isFinite(Number(v)))) {
    const [r, g, b] = rgb.slice(0, 3).map(v => Math.max(0, Math.min(255, Math.round(Number(v)))));
    return `rgb(${r},${g},${b})`;
  }
  const hs = a.hs_color;
  if (Array.isArray(hs) && hs.length >= 2 && Number.isFinite(Number(hs[0])) && Number.isFinite(Number(hs[1]))) {
    const h = ((Number(hs[0]) % 360) + 360) % 360, s = Math.max(0, Math.min(100, Number(hs[1])));
    return `hsl(${Math.round(h)},${Math.round(s)}%,${Math.round(100 - s / 2)}%)`;
  }
  const k = Number(a.color_temp_kelvin);
  if (Number.isFinite(k) && k > 0) return k < 3000 ? "#ffc46b" : k < 4200 ? "#ffe1a6" : "#e9f1ff";
  return null;
}

/**
 * The mini map: a floor's rooms and its lights fitted into w × h (px), plan
 * view as the floor plans are drawn (x right, y down; turned a quarter when
 * turn, for a house taller than it is wide), the same scale both ways. rooms: [[[x, y], …], …] (metres); lights: [{x, y, …}] (metres, the
 * rest kept). → {w, h, k (px a metre), rooms: [d], lights: [{…, x, y} in px]}.
 * With no rooms the lights alone set the frame.
 */
export function miniMap(rooms, lights, { w = 140, h = 80, pad = 6, turn = false } = {}){
  // Turned a quarter (turn): x ← y, y ← −x, the house's long side along the tile.
  const T = (p) => (turn ? [Number(p[1]), -Number(p[0])] : [Number(p[0]), Number(p[1])]);
  rooms = (rooms || []).map(P => (Array.isArray(P) ? P.map(T) : P));
  lights = (lights || []).map(l => { const [x, y] = T([l.x, l.y]); return { ...l, x, y }; });
  const polys = (rooms || []).filter(P => Array.isArray(P) && P.length >= 3);
  const pts = polys.length ? polys.flat() : (lights || []).map(l => [l.x, l.y]);
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of pts) {
    const x = Number(p[0]), y = Number(p[1]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
  }
  if (!Number.isFinite(x0)) return { w, h, k: 0, rooms: [], lights: [] };
  const bw = Math.max(1, x1 - x0), bh = Math.max(1, y1 - y0);
  const k = Math.min((w - 2 * pad) / bw, (h - 2 * pad) / bh);
  const ox = (w - bw * k) / 2 - x0 * k, oy = (h - bh * k) / 2 - y0 * k;
  const r1 = (v) => Math.round(v * 10) / 10;
  const X = (x) => r1(ox + x * k), Y = (y) => r1(oy + y * k);
  const out = { w, h, k: r1(k), rooms: [], lights: [] };
  for (const P of polys) out.rooms.push("M" + P.map(p => `${X(Number(p[0]))} ${Y(Number(p[1]))}`).join("L") + "Z");
  for (const l of lights || []) {
    const x = Number(l.x), y = Number(l.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    out.lights.push({ ...l, x: Math.max(2, Math.min(w - 2, X(x))), y: Math.max(2, Math.min(h - 2, Y(y))) });
  }
  return out;
}

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const LIT = "#fbbf24";                       // a lit light's colour when its own isn't known (the Atlas's amber)
/** The mini map as SVG: the floor's outline round its rooms, the rooms, every
 *  other light faint, the scene's own lit (a glow round those on now). */
export function miniMapSvg(m){
  const rooms = m.rooms.join(" ");
  let s = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${m.w} ${m.h}" width="${m.w}" height="${m.h}" aria-hidden="true" focusable="false">`;
  if (rooms) {
    // The outline: every room stroked wide underneath, the rooms over it, so
    // only the floor's outside edge (and a hall between rooms) shows it.
    s += `<path d="${rooms}" fill="#8fc5a8" stroke="#8fc5a8" stroke-width="3.5" stroke-linejoin="round"/>`;
    s += `<path d="${rooms}" fill="#22392c" stroke="#4d7a63" stroke-width="1" stroke-linejoin="round"/>`;
  }
  for (const l of m.lights) if (!l.mine) s += `<circle cx="${l.x}" cy="${l.y}" r="1.7" fill="#8aa396" fill-opacity=".5"/>`;
  for (const l of m.lights) {
    if (!l.mine) continue;
    const c = esc(l.colour || LIT);
    if (l.on) s += `<circle cx="${l.x}" cy="${l.y}" r="8" fill="${c}" fill-opacity=".32"/>`;
    s += `<circle cx="${l.x}" cy="${l.y}" r="3.6" fill="${c}" stroke="#0b130e" stroke-width="1.3"/>`;
  }
  return s + "</svg>";
}

/**
 * The row's tiles, from the house: [{key, kind, name, eid, id, preset,
 * floor, floorName, others (the other floors' names), state, offEids,
 * map, sig}]. h = {states, entities, model, floors, presets, isLight(eid),
 * isOn(eid) (true / false / null), floorOf(eid) (a canon floor id or null),
 * size: {w, h}}.
 */
export function sceneTiles(h){
  const model = (h && h.model) || {}, floors = (h && h.floors) || [], states = (h && h.states) || {};
  const placed = isObj(model.light_positions_m) ? model.light_positions_m : {};
  const isLight = (h && h.isLight) || ((e) => LIGHTISH.test(e));
  const isOn = (h && h.isOn) || ((e) => { const s = states[e]; return !s || s.state === "unavailable" || s.state === "unknown" ? null : s.state === "on"; });
  const floorOf = (h && h.floorOf) || ((e) => (placed[e] && placed[e].floor_id ? canonFloor(placed[e].floor_id, floors) : null));
  const list = [...haScenesOf(states, { placed, isLight, entities: h && h.entities }),
                ...presetScenesOf(h && h.presets, { placed, isLight, floorOf })];
  if (!list.length) return [];
  const rooms = new Map(), lamps = new Map();
  for (const g of Object.values(isObj(model.room_geometry_m) ? model.room_geometry_m : {})) {
    if (!isObj(g) || !Array.isArray(g.points_m) || g.points_m.length < 3) continue;
    const f = canonFloor(g.floor_id, floors);
    if (!rooms.has(f)) rooms.set(f, []);
    rooms.get(f).push(g.points_m);
  }
  for (const [eid, p] of Object.entries(placed)) {
    if (!isObj(p) || !isLight(eid)) continue;
    const f = floorOf(eid);
    if (!f) continue;
    if (!lamps.has(f)) lamps.set(f, []);
    lamps.get(f).push({ eid, x: Number(p.x_m), y: Number(p.y_m) });
  }
  const many = new Set([...rooms.keys()].filter(f => f)).size > 1;
  // One way round for the whole house, so every floor reads alike: its long side along the tile.
  let bx0 = Infinity, by0 = Infinity, bx1 = -Infinity, by1 = -Infinity;
  for (const list of rooms.values()) for (const P of list) for (const p of P) {
    const x = Number(p[0]), y = Number(p[1]);
    if (Number.isFinite(x) && Number.isFinite(y)) { bx0 = Math.min(bx0, x); by0 = Math.min(by0, y); bx1 = Math.max(bx1, x); by1 = Math.max(by1, y); }
  }
  const size = { ...((h && h.size) || {}), turn: Number.isFinite(bx0) && (by1 - by0) > (bx1 - bx0) * 1.15 };
  const out = [];
  for (const s of list) {
    const fl = floorsOfLights(s.lights, floorOf, floors);
    const top = fl.length ? fl[0].id : (s.floor || null);
    const mine = new Set(s.lights);
    const colour = (e) => (s.kind === "preset" ? colourOfAttrs(s.preset.entities[e]) : isOn(e) ? colourOfAttrs(states[e] && states[e].attributes) : null);
    const pts = (lamps.get(top) || []).map(l => (mine.has(l.eid) ? { ...l, mine: true, on: isOn(l.eid) === true, colour: colour(l.eid) } : { ...l, mine: false }));
    const map = miniMap(rooms.get(top) || [], pts, size);
    const state = sceneStateOf(s.all, isOn);
    const t = { key: s.key, kind: s.kind, name: s.name, eid: s.eid || null, id: s.kind === "scene" ? s.id : null,
                preset: s.kind === "preset" ? s.preset : null, floor: top, floorName: many && top ? floorName(top, floors) : "",
                others: fl.slice(1).map(f => floorName(f.id, floors)), state, offEids: s.all.slice(), lights: s.lights.slice(), map };
    t.sig = JSON.stringify([t.kind, t.name, t.id, t.floorName, t.others, t.state, map.rooms, map.lights.map(l => [l.x, l.y, l.mine ? 1 : 0, l.on ? 1 : 0, l.colour || ""])]);
    out.push(t);
  }
  return out;
}

/** A Home Assistant page from inside PadSpan, as the panel opens one (rooms.js):
 *  Home Assistant's own router, else a plain load. */
export function openHaPage(path, win = (typeof window !== "undefined" ? window : null)){
  if (!win) return false;
  try {
    win.history.pushState(null, "", path);
    win.dispatchEvent(new win.CustomEvent("location-changed", { detail: { replace: false } }));
    return true;
  } catch (_) {
    try { win.location.assign(path); return true; } catch (__) { return false; }
  }
}

// ── the row ──────────────────────────────────────────────────────────────────
const CSS = `
.psc-row{box-sizing:border-box;position:relative;font:13px/1.3 system-ui,"Segoe UI",Roboto,sans-serif;color:#e2e8f0;
  -webkit-user-select:none;user-select:none}
.psc-row[hidden]{display:none}
.psc-scroll{overflow-x:auto;overflow-y:hidden;overscroll-behavior-x:contain;-webkit-overflow-scrolling:touch;scrollbar-width:thin;
  scrollbar-color:rgba(120,190,155,.4) transparent;touch-action:pan-x;scroll-snap-type:x proximity}
.psc-track{display:flex;gap:8px;width:max-content;margin:0 auto;padding:2px}
.psc-tile{position:relative;flex:none;width:156px;box-sizing:border-box;border-radius:12px;background:rgba(6,14,9,.9);
  border:2px solid rgba(120,190,155,.22);box-shadow:0 4px 14px rgba(0,0,0,.35);scroll-snap-align:start}
.psc-tile[data-state="on"]{border-color:#52b788;background:rgba(10,32,20,.94)}
.psc-tile[data-state="mixed"]{border-color:rgba(251,191,36,.75)}
:where(.psc-tile) button{all:unset;box-sizing:border-box;cursor:pointer}
.psc-go{display:flex;flex-direction:column;width:100%;padding:6px 6px 5px;border-radius:10px}
.psc-go:hover{background:rgba(82,183,136,.10)}
.psc-go:focus-visible,.psc-edit:focus-visible,.psc-new:focus-visible{outline:2px solid #52b788;outline-offset:1px}
.psc-map{display:block;height:80px;border-radius:7px;background:#0a1510;overflow:hidden}
.psc-map svg{display:block;width:100%;height:100%}
.psc-line{display:flex;align-items:center;gap:6px;margin-top:5px;min-width:0}
.psc-dot{flex:none;width:10px;height:10px;border-radius:50%;box-sizing:border-box;border:2px solid #64748b}
.psc-tile[data-state="on"] .psc-dot{background:#52b788;border-color:#52b788}
.psc-tile[data-state="mixed"] .psc-dot{border-color:#fbbf24;background:linear-gradient(90deg,#fbbf24 50%,transparent 50%)}
.psc-name{flex:1;min-width:0;font-weight:700;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.psc-word{flex:none;font-size:11px;font-weight:600;color:#94a3b8}
.psc-tile[data-state="on"] .psc-word{color:#a7f3d0}
.psc-tile[data-state="mixed"] .psc-word{color:#fde68a}
.psc-floor{position:absolute;left:11px;top:67px;max-width:122px;padding:1px 6px;border-radius:6px;background:rgba(6,14,9,.82);
  font-size:10.5px;font-weight:600;color:#cbd5e1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;pointer-events:none}
.psc-mark{position:absolute;left:11px;top:11px;padding:1px 6px;border-radius:6px;background:#7c3aed;color:#f5f3ff;
  font-size:10px;font-weight:800;letter-spacing:.04em;text-transform:uppercase;pointer-events:none}
.psc-edit{position:absolute;right:4px;top:4px;width:30px;height:30px;border-radius:50%;display:flex;align-items:center;justify-content:center;
  font-size:14px;color:#e2e8f0;background:rgba(6,14,9,.88);border:1px solid rgba(120,190,155,.35)}
.psc-edit:hover{background:rgba(45,106,79,.95)}
.psc-busy .psc-go{animation:psc-busy 1s ease-in-out infinite}
@keyframes psc-busy{50%{opacity:.55}}
.psc-new{flex:none;width:120px;box-sizing:border-box;border-radius:12px;border:2px dashed rgba(120,190,155,.45);background:rgba(6,14,9,.78);
  display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;padding:8px;text-align:center;color:#a7f3d0;
  font:12px/1.3 system-ui,"Segoe UI",Roboto,sans-serif;scroll-snap-align:start}
.psc-new b{font-size:14px;color:#e2e8f0}
button.psc-new{-webkit-appearance:none;appearance:none;margin:0;cursor:pointer}
button.psc-new:hover{background:rgba(45,106,79,.5);border-color:#52b788}
.psc-new.psc-say{width:180px;color:#cbd5e1;font-size:11.5px;cursor:default}
.psc-note{display:flex;align-items:center;gap:8px;margin:0 auto 6px;width:max-content;max-width:100%;box-sizing:border-box;padding:5px 6px 5px 11px;
  border-radius:10px;background:rgba(6,14,9,.95);border:1px solid rgba(251,191,36,.4);color:#fde68a;font-size:12px}
.psc-note span{flex:1;min-width:0}
.psc-note button{all:unset;box-sizing:border-box;cursor:pointer;flex:none;padding:5px 10px;border-radius:8px;font-weight:700;white-space:nowrap}
.psc-note .psc-ok{color:#071008;background:#fbbf24}
.psc-note .psc-x{color:#94a3b8}
/* Under the flat Atlas: beside the sidebar's rail, as the map is. A map
   taller than the screen: the row waits at the bottom of the screen (pinned,
   clear of ⛶ in the corner) until its own place scrolls into view, and a
   touch beside its tiles is the map's. The map alone: the row steps aside. */
.lv-mapcard > .psc-atlas{margin:8px 0 6px}
.lv-mapcard.lv-display > .psc-atlas{margin:4px 64px 8px 52px}
.lv-mapcard.lv-display > .lv-rail.hidden ~ .psc-atlas{margin-left:8px}
.lv-mapcard.lv-display.lv-wall > .psc-atlas{flex:none;zoom:var(--wall-ctl,var(--wall-ui,1));margin:6px 8px 8px 52px}
.lv-mapcard.lv-display.lv-wall > .lv-rail.hidden ~ .psc-atlas{margin-left:8px}
.lv-mapcard.lv-alone > .psc-atlas{display:none}
.psc-in.psc-pinned{position:fixed;z-index:6;pointer-events:none}
.psc-in.psc-pinned .psc-scroll{pointer-events:auto;width:max-content;max-width:100%;margin:0 auto}
.psc-in.psc-pinned .psc-note{pointer-events:auto}
/* In Live Aboard: its own line along the top of the bottom bar, over the controls, never on them. */
.la3d-bar > .psc-aboard{flex:1 0 100%;order:-1;min-width:0;pointer-events:none}
.la3d-bar > .psc-aboard .psc-track > *,.la3d-bar > .psc-aboard .psc-note{pointer-events:auto}
.la3d-bar > .psc-aboard .psc-scroll{pointer-events:auto;width:max-content;max-width:100%;margin:0 auto}
.la3d.la3d-narrow .la3d-bar.psc-has{flex-wrap:wrap}
.la3d.la3d-narrow .psc-tile{width:124px}
.la3d.la3d-narrow .psc-map{height:64px}
.la3d.la3d-narrow .psc-floor{top:51px}
@media (prefers-reduced-motion:reduce){.psc-busy .psc-go{animation:none;opacity:.7}}`;

/**
 * The row, in either place. o = {doc, place ("atlas" | "aboard"), guard(fn)
 * (the view's own, or none), pinRect() (where it may wait at the screen's
 * foot while its place is below the screen, or none)}. update(m) draws it from m = {tiles, admin,
 * kiosk, editPresets (a preset's ✎ is offered), act(tile), edit(tile, row)
 * (row: this row, for its note), add(from), count(name, once)}: each tile is built again only when what it
 * shows changed. Hidden (no tiles, or hide(true)): nothing is drawn.
 */
export function createSceneRow(o){
  const doc = o.doc || document, place = o.place === "aboard" ? "aboard" : "atlas";
  const guard = typeof o.guard === "function" ? o.guard : (fn) => fn;
  const d = (tag, cls, text) => { const n = doc.createElement(tag); if (cls) n.className = cls; if (text !== undefined) n.textContent = text; return n; };
  const el = d("div", `psc-row psc-${place}`);
  el.setAttribute("data-scenes", place);
  el.setAttribute("role", "region");
  el.setAttribute("aria-label", "Lighting scenes");
  const css = d("style");
  css.textContent = CSS;
  el.appendChild(css);
  const inner = d("div", "psc-in");
  const noteBox = d("div", "psc-note");
  noteBox.hidden = true;
  noteBox.style.display = "none";
  inner.appendChild(noteBox);
  const scroll = d("div", "psc-scroll");
  const track = d("div", "psc-track");
  scroll.appendChild(track);
  inner.appendChild(scroll);
  el.appendChild(inner);
  // Pinned (o.pinRect: where on screen it may wait, {left, right, bottom}):
  // while its own place is below the screen, the tiles wait at the screen's
  // foot; its place keeps their height, so nothing under it moves.
  let pinned = false, io = null;
  const unpin = () => {
    if (!pinned) return;
    pinned = false;
    inner.classList.remove("psc-pinned");
    for (const k of ["left", "width", "bottom"]) inner.style[k] = "";
    el.style.minHeight = "";
  };
  const pinAt = () => {
    const r = typeof o.pinRect === "function" ? o.pinRect() : null;
    if (!r) { unpin(); return; }
    if (!pinned) { el.style.minHeight = `${inner.offsetHeight}px`; inner.classList.add("psc-pinned"); pinned = true; }
    const vh = (doc.defaultView && doc.defaultView.innerHeight) || r.bottom;
    Object.assign(inner.style, { left: `${Math.round(r.left)}px`, width: `${Math.max(0, Math.round(r.right - r.left))}px`,
                                 bottom: `${Math.max(0, Math.round(vh - r.bottom + 8))}px` });
  };
  if (typeof o.pinRect === "function" && typeof IntersectionObserver !== "undefined") {
    io = new IntersectionObserver(guard((entries) => {
      if (!el.isConnected) { unpin(); io.disconnect(); if (win && win.removeEventListener) win.removeEventListener("resize", onResize); return; }
      const e = entries[entries.length - 1], vb = e.rootBounds ? e.rootBounds.bottom : ((doc.defaultView && doc.defaultView.innerHeight) || 0);
      if (!e.isIntersecting && e.boundingClientRect.top >= vb && !el.hidden) pinAt(); else unpin();
    }));
    io.observe(el);
  }
  const win = doc.defaultView || null, onResize = guard(() => { if (pinned) pinAt(); });
  if (io && win && win.addEventListener) win.addEventListener("resize", onResize);
  el.hidden = true;
  const stop = (e) => { if (e && e.stopPropagation) e.stopPropagation(); };
  // In Live Aboard a press here is the row's, never the camera's.
  for (const ev of ["pointerdown", "pointerup", "pointermove", "dblclick", "contextmenu", "touchstart"]) el.addEventListener(ev, stop);
  // A mouse wheel scrolls the row sideways when it overflows.
  el.addEventListener("wheel", (e) => {
    stop(e);
    if (scroll.scrollWidth > scroll.clientWidth + 1 && Math.abs(e.deltaY) > Math.abs(e.deltaX || 0)) {
      scroll.scrollLeft += e.deltaY;
      if (e.preventDefault) e.preventDefault();
    }
  }, { passive: false });
  let m = null, hiddenBy = false, shown = false, noteT = null;
  const tiles = new Map();      // key -> {node, sig}
  const busy = new Map();       // key -> until (ms)
  let newNode = null, newSig = "";

  function note(text, button = null, act = null){
    if (noteT) { clearTimeout(noteT); noteT = null; }
    while (noteBox.firstChild) noteBox.removeChild(noteBox.firstChild);
    if (!text) { noteBox.hidden = true; noteBox.style.display = "none"; return; }
    noteBox.appendChild(d("span", null, text));
    if (button && act) {
      const b = d("button", "psc-ok", button);
      b.type = "button";
      b.addEventListener("click", guard((e) => { stop(e); note(null); act(); }));
      noteBox.appendChild(b);
    }
    const x = d("button", "psc-x", "✕");
    x.type = "button"; x.title = "Close"; x.setAttribute("aria-label", "Close");
    x.addEventListener("click", guard((e) => { stop(e); note(null); }));
    noteBox.appendChild(x);
    noteBox.hidden = false;
    noteBox.style.display = "";
    noteT = setTimeout(() => note(null), button ? 15000 : 7000);
  }
  function tileNode(t){
    const n = d("div", "psc-tile");
    n.setAttribute("data-scene", t.key);
    n.setAttribute("data-kind", t.kind);
    n.setAttribute("data-state", t.state);
    const go = d("button", "psc-go");
    go.type = "button";
    const doing = tapOf(t.state) === "off" ? "turn its lights off" : t.state === "mixed" ? "turn it all on" : "turn it on";
    const kind = t.kind === "preset" ? "Whole house preset" : "Scene";
    const where = t.floorName ? ` on ${t.floorName}` : "";
    const also = t.others.length ? `, and ${t.others.join(", ")}` : "";
    const label = `${kind} ${t.name}: ${STATE_WORDS[t.state].toLowerCase()}${where}${also}. Tap to ${doing}.`;
    go.title = label;
    go.setAttribute("aria-label", label);
    const map = d("span", "psc-map");
    map.innerHTML = miniMapSvg(t.map);
    const line = d("span", "psc-line");
    line.append(d("span", "psc-dot"), d("span", "psc-name", t.name), d("span", "psc-word", STATE_WORDS[t.state]));
    go.append(map, line);
    go.addEventListener("click", guard((e) => {
      stop(e);
      if ((busy.get(t.key) || 0) > Date.now() || !m) return;
      busy.set(t.key, Date.now() + 2500);
      n.classList.add("psc-busy");
      setTimeout(() => { busy.delete(t.key); n.classList.remove("psc-busy"); }, 2500);
      m.act(t);
    }));
    n.appendChild(go);
    const fl = [t.floorName, ...t.others.map(x => `+ ${x}`)].filter(Boolean).join(" ");
    if (fl) n.appendChild(d("span", "psc-floor", fl));
    if (t.kind === "preset") { const mk = d("span", "psc-mark", "Preset"); mk.title = "A PadSpan Whole house preset"; n.appendChild(mk); }
    const canEdit = t.kind === "preset" ? !!m.editPresets : !!(m.admin && !m.kiosk);
    if (canEdit) {
      const ed = d("button", "psc-edit", "✎");
      ed.type = "button";
      const et = t.kind === "preset" ? `Edit ${t.name}: the Whole house presets` : t.id ? `Edit ${t.name} in Home Assistant's scene editor` : `${t.name}: where it is edited`;
      ed.title = et;
      ed.setAttribute("aria-label", et);
      ed.addEventListener("click", guard((e) => { stop(e); if (m) m.edit(t, api); }));
      n.appendChild(ed);
    }
    if ((busy.get(t.key) || 0) > Date.now()) n.classList.add("psc-busy");
    return n;
  }
  function newTile(){
    // + New scene: an administrator's way to Home Assistant's editor; a wall,
    // or anyone else, is told where scenes are made.
    if (m.kiosk) {
      const n = d("div", "psc-new psc-say");
      n.setAttribute("data-scene-new", "kiosk");
      n.append(d("b", null, "+ New scene"), d("span", null, `Make one from another screen, in ${SCENE_PLACE}.`));
      return [n, "kiosk"];
    }
    if (!m.admin) {
      const n = d("div", "psc-new psc-say");
      n.setAttribute("data-scene-new", "ask");
      n.append(d("b", null, "+ New scene"), d("span", null, "An administrator makes scenes in Home Assistant."));
      return [n, "ask"];
    }
    const b = d("button", "psc-new");
    b.type = "button";
    b.setAttribute("data-scene-new", "go");
    b.title = "Make a new scene in Home Assistant's scene editor";
    b.append(d("b", null, "+ New scene"), d("span", null, "in Home Assistant"));
    b.addEventListener("click", guard((e) => { stop(e); if (m) m.add("row"); }));
    return [b, "go"];
  }
  function paint(){
    const list = (m && Array.isArray(m.tiles)) ? m.tiles : [];
    const want = !!(m && list.length && !hiddenBy);
    el.hidden = !want;
    el.style.display = want ? "" : "none";
    if (el.parentNode && el.parentNode.classList) el.parentNode.classList.toggle("psc-has", want);
    if (!want) return;
    if (!shown) { shown = true; if (m.count) m.count(`house3d_show:scene_row:${place}`, true); }
    const keep = new Set();
    let at = null;
    for (const t of list) {
      keep.add(t.key);
      const s = t.sig + "|" + (m.admin ? 1 : 0) + (m.kiosk ? 1 : 0) + (m.editPresets ? 1 : 0);
      let had = tiles.get(t.key);
      if (!had || had.sig !== s) {
        const node = tileNode(t);
        if (had && had.node.parentNode === track) track.replaceChild(node, had.node);
        had = { node, sig: s };
        tiles.set(t.key, had);
      }
      const ref = at ? at.nextSibling : track.firstChild;
      if (had.node !== ref) track.insertBefore(had.node, ref);
      at = had.node;
    }
    for (const [k, v] of [...tiles]) if (!keep.has(k)) { if (v.node.parentNode === track) track.removeChild(v.node); tiles.delete(k); }
    const ns = (m.kiosk ? "k" : "") + (m.admin ? "a" : "");
    if (!newNode || newSig !== ns) {
      const [n] = newTile();
      if (newNode && newNode.parentNode === track) track.removeChild(newNode);
      newNode = n; newSig = ns;
    }
    track.appendChild(newNode);
  }
  const api = {
    el,
    update(next){ m = next || null; paint(); },
    /** Hidden by the place it is in (the ⋯ list, Edit, the map alone). */
    hide(on){ if (hiddenBy === !!on) return; hiddenBy = !!on; paint(); },
    note,
    get shown(){ return !el.hidden; },
    state(){
      return { shown: !el.hidden, tiles: [...track.querySelectorAll(".psc-tile")].map(n => [n.getAttribute("data-scene"), n.getAttribute("data-state"), n.getAttribute("data-kind")]),
               edits: [...track.querySelectorAll(".psc-edit")].length, add: newNode ? newNode.getAttribute("data-scene-new") : null,
               note: noteBox.hidden ? null : noteBox.textContent };
    },
    dispose(){
      if (noteT) clearTimeout(noteT);
      if (io) { io.disconnect(); if (win && win.removeEventListener) win.removeEventListener("resize", onResize); }
      try { el.remove(); } catch (_) { /* gone with its place */ } },
  };
  return api;
}
