// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
// See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
//
// Live Aboard, the 3D house (docs/IDEA_ATLAS_3D_HOUSE.md): the Atlas's 3D
// view. Normally off — the shared card (lights_map.js) imports this module
// only while settings.atlas_3d_enabled is on AND a screen has picked 3D, so
// with the feature off neither this file nor three.js is ever fetched.
//
// The house is read from the map the Atlas already holds (live_aboard_house.js
// turns it into numbers); three.js, bundled unmodified in vendor/three, is the
// only outside code, used as a library. The camera, the geometry merging and
// the whole-house cut-away are PadSpan's own.
//
// It has to survive the Atlas: the card is rebuilt from scratch every 5 s, so
// the view is ONE long-lived element per screen ("slot", like the weather
// overlay's), moved into each new card beside the flat stage, which it hides
// while it shows. The renderer, the GL context, the scene and the camera live
// in the slot and are never rebuilt by a poll; a poll only repaints the lights
// whose state changed (an intensity and a colour, never what is drawn, so
// three.js never rebuilds a shader), and rebuilds geometry only when the map
// itself changed. It renders only when something changed, and not at all
// while the panel is hidden. Any failure — no WebGL, a slow GPU by the
// frame-time check, a lost GL context, any error — puts the flat Atlas back
// and is counted once (the report's closed words, live_aboard_house.js).
//
// What the flat Atlas does, it does here too (part B). Doors, windows and
// locks linked to sensors open, shut and flash as the Atlas reads them;
// rooms take the Motion · Air colours on the Atlas's clocks; temperature,
// humidity and air float as readouts; and a press is the Atlas's own press
// (live_aboard_use.js): the picking is this file's, the actions the host's.
// Something moving by itself (a pulse, a flash, a door swinging) draws on
// a steady clock, slower on Low; nothing moving, nothing is drawn.

const THREE = await import(`../vendor/three/three.module.min.js${new URL(import.meta.url).search}`);
const HOUSE = await import(`./live_aboard_house.js${new URL(import.meta.url).search}`);
const USE = await import(`./live_aboard_use.js${new URL(import.meta.url).search}`);
// Part C: the 3D file's rules (doors and windows drawn in 3D, a barrier's
// hinge, swing, sill and head, device heights), read through the host.
const DRAFT = await import(`./live_aboard_draft.js${new URL(import.meta.url).search}`);
// The 3D editor (Door, Window, Heights), for those who may place lights.
const EDIT = await import(`./live_aboard_edit.js${new URL(import.meta.url).search}`);
// P2 Furnish: furniture's rules, the pieces drawn and the Furnish tool, and
// the builders that draw each piece (missing or broken: every piece a box).
const PIECES = await import(`./live_aboard_pieces.js${new URL(import.meta.url).search}`);
const FURNISH = await import(`./live_aboard_furnish.js${new URL(import.meta.url).search}`);
const FURN = await import(`./live_aboard_furniture.js${new URL(import.meta.url).search}`).catch(() => null);
const NO_FILE = DRAFT.ownedOf(null);
// P8 atmosphere: rain and snow (the flat Atlas's own weather, drawn here).
// Optional: a module that fails to load leaves the house as it was.
const WEATHER = await import(`./live_aboard_weather.js${new URL(import.meta.url).search}`)
  .catch(err => { console.warn("PadSpan: live_aboard_weather failed to load", err); return null; });
// And the Atlas's Showcase look as this view's lighting (optional too).
const LOOKS = await import(`./live_aboard_showcase.js${new URL(import.meta.url).search}`)
  .catch(err => { console.warn("PadSpan: live_aboard_showcase failed to load", err); return null; });
// P5: furniture that is a device behaves like it (optional too: missing, the
// pieces are only furniture and the fixtures stay where they are).
const DEVICES = await import(`./live_aboard_devices.js${new URL(import.meta.url).search}`)
  .catch(err => { console.warn("PadSpan: live_aboard_devices failed to load", err); return null; });
// P6: beacons, scanners and people where PadSpan tracks them (optional too).
const TRACKED = await import(`./live_aboard_tracked.js${new URL(import.meta.url).search}`)
  .catch(err => { console.warn("PadSpan: live_aboard_tracked failed to load", err); return null; });

export const HOUSE3D_EVENTS = HOUSE.HOUSE3D_EVENTS;
export const HOUSE3D_FALLBACK_KINDS = HOUSE.HOUSE3D_FALLBACK_KINDS;

const D2R = Math.PI / 180;
const FOV = 40;
const BG = "#0c110f";
const MIN_PHI = 0.0015, MAX_PHI = 84 * D2R, MIN_R = 1.5, MAX_R = 260;
const SLAB_SIDE = "#c8b18c", EARTH_SIDE = "#4a3f33", TILE_MIX = "#d9d2c3";
const LAMP_I = 7;                          // a real lamp's intensity at full brightness
// The frame-time check: up to 22 frames, or 1.5 s once there are enough to
// judge; a screen that cannot draw six frames in 4 s is slow, full stop.
const MEASURE_FRAMES = 22, MEASURE_MS = 1500, MEASURE_MIN = 6, MEASURE_GIVE_UP_MS = 4000;
const HALO = { s: 0.16, m: 0.55, l: 1.05 };
const AO_W = 0.38, AO_A = 0.42;            // High's contact shade along wall bases: width (m), darkest alpha
// The sun and the sky by day, and what is left of them at night (blended
// through twilight by live_aboard_house.js sunLight).
const SUN_I = 2.0, SKY_I_DAY = 1.6, SKY_I_NIGHT = 0.3;
const SUN_HIGH = "#fff0dc", SUN_LOW = "#ff9f5a";
const SKY_DAY = "#e6edf6", SKY_NIGHT = "#4a5d8a", GROUND_DAY = "#3a342c", GROUND_NIGHT = "#101318";
const SUN_STEP = 0.5;                      // degrees the sun must move before the house is drawn again
// The live parts (part B).
const NO_READING = "#64748b";              // the Atlas's "no reading" grey (its dashed line)
const SHUT_LINE = "#94a3b8";               // the Atlas's line across a linked barrier that reads closed
const SENSOR_ON = "#3b82f6", SENSOR_QUIET = "#cfd8d3";   // a motion sensor lit while active (the Atlas's MOTION_PULSE)
const DOOR_OPEN = 85 * D2R, WINDOW_OPEN = 50 * D2R, SWING_MS = 650;
// Drawn at full rate only while something has just started moving: about
// 30 frames a second, 15 on Low. A door or window swings; a pulse or a
// lock's flash plays for its first LIVE_MS; whatever carries on after (a
// pulse, a lock left unlocked, a room breathing after motion, the air's
// bars) is drawn still, so a house at rest draws nothing at all.
const AMBIENT_MS = { high: 33, low: 66 };
const LIVE_MS = 5000;
const meanOf = (v) => v.slice(1).reduce((a, x, i) => a + (x + v[i]) / 2, 0) / (v.length - 1);
const STILL = { active: meanOf(HOUSE.MOTION_PULSE.fill), recent: meanOf(HOUSE.MOTION_RECENT.op) };   // a pulse's, a breath's mean
const PICK_R = 22, BADGE_PX = 28;          // a device's reach for a tap (the Atlas's 44 px target); a floor badge
const PIECE_D = PICK_R / 2;                // a press on a linked piece: a marker nearer than this wins
const PEOPLE_MS = 5000;                    // the people layer reads the live snapshot at most this often
const READ_H = 0.3, READ_PX = [14, 24];    // a readout's height (m), and never under / over this on screen (px)
const READ_W = 400, READ_C = 72;           // its canvas: the pill is drawn inside, as wide as its words
const RING_R0 = 0.6;                       // the motion ring's radius (m) at 1 (the Atlas's 0.7 → 2.4)
const FILL_K = 0.6, RECENT_K = 0.45, AIR_K = 1.6;   // how strongly a floor takes the Motion · Air colour

// The view's own look: everything is scoped under .la3d, and the sheet travels
// inside the long-lived element, so nothing is added to styles.css and the
// flat Atlas cannot be touched by it. The bars reuse the Atlas's segmented
// control (.lv-zoomseg) so they wear the same face.
const CSS = `
.la3d{position:relative;display:block;width:100%;height:calc(100vh - 260px);min-height:360px;box-sizing:border-box;
  border-radius:14px;overflow:hidden;background:${BG};border:1px solid rgba(120,190,155,.14);
  -webkit-user-select:none;user-select:none;-webkit-touch-callout:none}
.lv-mapcard.lv-display .la3d{border-radius:0;border:none;width:calc(100% - 44px);margin-left:44px;height:calc(100vh - 84px)}
.lv-rail.hidden ~ .la3d{width:100%;margin-left:0}
@media (max-width:900px){.lv-mapcard.lv-display .la3d{height:calc(100vh - 130px)}}
@media (max-width:600px){.lv-mapcard.lv-display .la3d{height:calc(100vh - 175px)}}
.la3d canvas{display:block;width:100%;height:100%;touch-action:none;outline:none}
.la3d-bar{position:absolute;left:10px;right:10px;bottom:10px;display:flex;flex-wrap:wrap;gap:8px;
  justify-content:space-between;align-items:flex-end;pointer-events:none}
.la3d-bar > *{pointer-events:auto}
.la3d .lv-zoomseg{background:rgba(6,14,9,.86);box-shadow:0 4px 14px rgba(0,0,0,.35)}
.la3d .lv-zoomseg button{padding:7px 12px;font-size:12px}
.la3d .lv-zoomseg button[aria-pressed="true"]{background:rgba(82,183,136,.32);color:#f0fdf4}
.la3d-lbl{align-self:center;padding:0 6px 0 10px;font-size:10.5px;font-weight:600;letter-spacing:.06em;
  text-transform:uppercase;color:rgba(226,240,232,.45)}
.la3d-compass{position:absolute;left:10px;top:10px;z-index:2;width:52px;height:52px;padding:0;border-radius:50%;
  border:1px solid rgba(120,190,155,.22);background:rgba(6,14,9,.8);box-shadow:0 4px 14px rgba(0,0,0,.35);cursor:pointer;
  touch-action:none}
.la3d-compass svg{display:block;width:100%;height:100%;pointer-events:none}
.la3d .la3d-north{position:absolute;left:10px;top:70px;z-index:3;display:none}
.la3d .la3d-north.on{display:inline-flex}
.la3d-toast{position:absolute;left:50%;bottom:64px;z-index:3;transform:translateX(-50%);display:flex;align-items:center;gap:10px;
  padding:6px 7px 6px 14px;border-radius:12px;background:rgba(6,14,9,.94);border:1px solid rgba(120,190,155,.24);
  color:#e8f0ea;font-size:12.5px;white-space:nowrap;box-shadow:0 6px 18px rgba(0,0,0,.45);animation:la3d-toast 6s ease forwards}
.la3d-toast button{all:unset;box-sizing:border-box;cursor:pointer;padding:5px 11px;border-radius:8px;font-weight:700;
  color:#f5b041;background:rgba(245,176,65,.12)}
@keyframes la3d-toast{0%{opacity:0;visibility:visible}5%{opacity:1}85%{opacity:1;visibility:visible}100%{opacity:0;visibility:hidden}}
.la3d-ov{position:absolute;left:0;top:0;width:100%;height:100%;pointer-events:none;overflow:visible;z-index:1}
.la3d-hud{position:absolute;left:72px;top:10px;z-index:3;max-width:calc(100% - 84px)}
.la3d-hud .lv-hoverhud{position:static}`;

const _slots = new Map();
/** One 3D view per screen ("atlas" — the sidebar; "builder" — Mapping). */
export function liveAboardSlot(key){
  const k = String(key || "atlas");
  if (!_slots.has(k)) _slots.set(k, createSlot(k));
  return _slots.get(k);
}
// Settings → Remove all furniture (settings.js, once house3d_clear has done
// it): every screen reads the 3D file again, so a removed piece is not drawn,
// nor saved back from a draft.
const FILE_CHANGED = "padspan-ha-house3d-changed";
if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
  window.addEventListener(FILE_CHANGED, () => { for (const s of _slots.values()) s.reload(); });
}
/** The feature was switched off: give the screen's GL context back (a later
 *  switch-on starts afresh). */
export function releaseLiveAboardSlot(key){
  const s = _slots.get(String(key || "atlas"));
  if (!s) return;
  _slots.delete(String(key || "atlas"));
  s.release();
}

// ── Small three helpers ──────────────────────────────────────────────────────
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3(), _c = new THREE.Color();
const _v = new THREE.Vector3(), _v2 = new THREE.Vector3();
const Y_AXIS = new THREE.Vector3(0, 1, 0);
const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);
function compose(x, y, z, yaw, sx, sy, sz){
  _q.setFromAxisAngle(Y_AXIS, yaw); _p.set(x, y, z); _s.set(sx, sy, sz);
  return _m.compose(_p, _q, _s);
}
/** A colour from room_color.js's answer: "#rrggbb", or its "hsl(h s% l%)". */
function colorOf(str){
  const s = String(str || "").trim();
  const m = /^hsla?\(\s*([\d.]+)(?:deg)?[\s,]+([\d.]+)%[\s,]+([\d.]+)%/i.exec(s);
  if (m) return new THREE.Color().setHSL((Number(m[1]) % 360) / 360, Number(m[2]) / 100, Number(m[3]) / 100, THREE.SRGBColorSpace);
  if (/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(s)) return new THREE.Color(s);
  return new THREE.Color("#7a8a80");
}
function radialTexture(stops){
  const c = document.createElement("canvas"); c.width = c.height = 128;
  const g = c.getContext("2d"), grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  for (const [o, col] of stops) grd.addColorStop(o, col);
  g.fillStyle = grd; g.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}
function rampTexture(){
  const c = document.createElement("canvas"); c.width = 4; c.height = 64;
  const g = c.getContext("2d"), grd = g.createLinearGradient(0, 0, 0, 64);
  grd.addColorStop(0, `rgba(0,0,0,${AO_A})`); grd.addColorStop(0.45, `rgba(0,0,0,${(AO_A * 0.35).toFixed(3)})`); grd.addColorStop(1, "rgba(0,0,0,0)");
  g.fillStyle = grd; g.fillRect(0, 0, 4, 64);
  return new THREE.CanvasTexture(c);
}
/** One air bar per repeat: a soft white band across a clear tile (the
 *  Atlas's bars are a fifth of the room apart, each a little under a fifth
 *  of that thick). Tinted and faded by its material. */
function barsTexture(){
  const c = document.createElement("canvas"); c.width = 4; c.height = 64;
  const g = c.getContext("2d"), grd = g.createLinearGradient(0, 0, 0, 64);
  grd.addColorStop(0, "rgba(255,255,255,0)"); grd.addColorStop(0.03, "rgba(255,255,255,1)");
  grd.addColorStop(0.15, "rgba(255,255,255,1)"); grd.addColorStop(0.19, "rgba(255,255,255,0)"); grd.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grd; g.fillRect(0, 0, 4, 64);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}
/** PadSpan's own merge: the non-indexed attributes every part shares, one
 *  after the other — one draw for a floor's tiles. */
function mergeGeometries(geos){
  const parts = geos.map(g => (g.index ? g.toNonIndexed() : g));
  const names = ["position", "normal", "uv", "color"].filter(n => parts.every(g => g.getAttribute(n)));
  const out = new THREE.BufferGeometry();
  for (const n of names) {
    const size = parts[0].getAttribute(n).itemSize;
    let total = 0;
    for (const g of parts) total += g.getAttribute(n).count * size;
    const arr = new Float32Array(total);
    let off = 0;
    for (const g of parts) { const a = g.getAttribute(n); for (let i = 0; i < a.count * size; i++) arr[off + i] = a.array[i]; off += a.count * size; }
    out.setAttribute(n, new THREE.BufferAttribute(arr, size));
  }
  parts.forEach((g, i) => { if (g !== geos[i]) g.dispose(); });
  return out;
}

function createSlot(slotKey){
  // ── the long-lived element ────────────────────────────────────────────────
  let root = null, canvas = null, bar = null, rose = null, roseDeg = null;
  let renderer = null, scene = null, camera = null;
  let failed = null;                       // the fallback kind, once failed (for this page load)
  let stage = null;                        // the flat stage hidden while this shows
  let send = null;                         // the host's report sender (closed words only)
  let touchCb = null;                      // the card's "the map was touched" (closes an open drawer)
  let observers = [];
  let frames = 0, pending = false, dirty = true, visible = true, drawnW = 0, drawnH = 0;
  // The house, as drawn: shell (floors, rooms, walls) and fixtures.
  let shellSig = null, lightsSig = null, house = null, floorsUi = [], lights = [];
  // The map's house as last read (readHouse) and what it was read from: a
  // change in the 3D file alone (the editor's draft) draws from it again.
  let reading = null, readSig = null;
  const work = { reads: 0, shells: 0, lights: 0, sensors: 0, moves: 0 };   // how often each was done (the harness)
  let shellRes = [], lightRes = [];       // geometries, materials and textures a rebuild disposes
  let topElev = null, wallMode = "cut";
  const quality = { setting: "auto", profile: null, measuring: null, measured: {}, intervals: [], t0: 0, last: 0 };
  // The camera fits the house until someone moves it (the first card may be
  // drawn before the map has arrived).
  const cam = { target: new THREE.Vector3(), theta: Math.PI / 4, phi: 0.98, radius: 30, needsFit: true, moved: false };
  let houseBox = { x0: -5, y0: -5, x1: 5, y1: 5, z0: 0, z1: 3 };
  // The sun as last read and as last drawn, and true north as drawn
  // (settings.fabric_bearing_deg, or the compass being spun).
  let sunRead = null, sunNow = null, bearing = 0;
  const sunDir = new THREE.Vector3(0, 1, 0);
  // North on the compass you spin (see "north: the compass you spin").
  const SPIN_SLOP = 6, NORTH_HOLD_MS = 60000;
  let storedBearing = 0;                   // the saved bearing, as the host last said
  let northPreview = null;                 // the bearing being tried, not saved
  let northHold = null;                    // {b, until}: just saved, until the host catches up
  let spin = null, compassEl = null, pill = null, pillBtns = [], unhookNorth = null, saveNorthCb = null;
  const camPts = new Map();                // fingers and buttons down on the house itself
  let dropPointers = () => {};             // ends every one of them, as a cancel (wirePointer)
  // Shared, made once per slot.
  let shared = null;
  let hemi = null, sun = null, lampPool = [], lampsDirty = true, ground = null, gridLines = null;
  const lampTarget = new THREE.Vector3(Infinity, 0, 0);
  // The live parts and the taps (part B). use: the press, the hover box and
  // the rings (live_aboard_use.js); apiOf: the host's use api, as the poll
  // last handed it; lbe: the Atlas's device records, live.
  let use = null, apiOf = null, apiNow = null, lbe = {}, haStarted = 0;
  let openings = [], sensorsUi = [], tints = [], readouts = [], badges = [];
  let sensorRes = [], badgeRes = [], sensorsSig = null;
  let liveMs = 0, lastAmbient = 0, rehoverDue = false;   // liveMs: how often something moving by itself is drawn (0: still)
  let northDismissed = null;               // the pointerdown that only put north back
  // The 3D file (part C), as the editor owns it (live_aboard_draft.js
  // ownedOf): read once through the host's load (house3d_get) when the view
  // first shows, and again after the screen went back to Map; null until
  // read. lastP: the card's newest data, to draw again from.
  let file = null, fileLoad = null, lastP = null;
  // Why the file cannot be edited: read but refused ({code: "read_failed"}),
  // or a newer PadSpan's ({code: "house3d_newer"}: read so, or a Save refused
  // so); null when it can. The next read that works says again.
  let fileErr = null;
  // The 3D editor (live_aboard_edit.js), made with the view; its draft, tool
  // and what is picked live here, so no rebuild touches them. shellGen moves
  // on every wall rebuild (the editor works out its walls again).
  let editor = null, shellGen = 0;
  // P8 atmosphere: the weather (live_aboard_weather.js), made only while Rain
  // and snow is on.
  let wx = null;
  // The Showcase look as drawn (live_aboard_showcase.js): Classic, today's
  // look, unless "Use the Atlas's Showcase look" is on.
  let lookKey = "classic", theme3d = LOOKS ? LOOKS.lookOf("classic") : null;
  // Furniture (P2 Furnish, live_aboard_furnish.js): every piece drawn on its
  // floor (layer). furnishP: what the Furnish tool needs of the host (its
  // connection, toast, settings, states), from the newest card; topCb: the
  // host's floor chips, which a piece moved up or down a floor follows.
  let layer = null, furnishP = null, topCb = null;
  // P5 (live_aboard_devices.js): what each linked piece shows, and the
  // outlines round the emergency lights while the Atlas's test runs.
  let devices = null, emOutlines = [], emKey = "";
  // P6 (live_aboard_tracked.js): scanners with a look where the map keeps
  // them; with Show tags & scanners on, every placed tag and every scanner;
  // with Show people on, people where PadSpan tracks them. peopleSnap: the
  // live snapshot as the host last handed it
  // (read through it, never more often than it says); off, none of it.
  let tracked = null, peopleSnap = null, peopleAt = 0, peopleLoad = null, peopleReads = 0;
  // Furnish shows a plan beside the 3D view on a wide screen, drawn by the
  // same renderer in its own viewport; on a phone, Plan or 3D. The plan looks
  // straight down at the top floor showing.
  let furnishOn = false, planOnly = false, planCam = null, planSeg = null;
  const plan = { cx: 0, cy: 0, half: 6, fit: true };

  // ── failing back to the flat Atlas ────────────────────────────────────────
  function showFlat(){
    try { if (stage) stage.style.display = ""; } catch (_) { /* gone with its card */ }
    stage = null;
    try { if (root && root.parentNode) root.parentNode.removeChild(root); } catch (_) { /* already out */ }
  }
  function teardown(){
    try { endSpin(false); hidePill(); dropPointers(); } catch (_) { /* nothing to undo */ }
    try { if (use) use.dispose(); } catch (_) { /* gone with the view */ }
    use = null;
    try { if (editor) editor.dispose(); } catch (_) { /* gone with the view */ }
    editor = null;
    try { if (devices) devices.dispose(); } catch (_) { /* gone with the view */ }
    devices = null; emOutlines = []; emKey = "";
    try { if (tracked) tracked.dispose(); } catch (_) { /* gone with the view */ }
    tracked = null; peopleSnap = null; peopleAt = 0; peopleLoad = null;
    try { if (layer) layer.dispose(); } catch (_) { /* gone with the view */ }
    layer = null; furnishP = null; topCb = null;
    for (const o of observers) { try { o(); } catch (_) { /* gone */ } }
    observers = [];
    disposeList(shellRes); disposeList(lightRes); disposeList(sensorRes); disposeList(badgeRes);
    shellRes = []; lightRes = []; sensorRes = []; badgeRes = [];
    // three.js gives every sprite (a readout, a floor badge) one geometry for
    // the whole page, and each renderer that drew one hangs a listener on it
    // that renderer.dispose() never takes off: that listener would keep this
    // whole view alive (the renderer, the canvas, this element, the scene and
    // the host's data) after every switch-off. Disposing it takes every such
    // listener off; another view still drawing sprites only uploads it again.
    try { if (scene) scene.traverse((o) => { if (o.isSprite && o.geometry) o.geometry.dispose(); }); } catch (_) { /* best effort */ }
    try { if (wx) wx.dispose(); } catch (_) { /* gone with the scene */ }
    wx = null;
    // Give the GPU its context back: the flat Atlas needs none.
    try { if (renderer) { renderer.dispose(); if (failed !== "context_lost") renderer.forceContextLoss(); } } catch (_) { /* best effort */ }
    renderer = null; scene = null; house = null; floorsUi = []; lights = [];
    openings = []; sensorsUi = []; tints = []; readouts = []; badges = []; liveMs = 0;
    // Nothing of the host's is kept: its card, its data, its callbacks.
    lastP = null; apiOf = null; apiNow = null; lbe = {}; stage = null; send = null; touchCb = null; saveNorthCb = null;
  }
  function fail(kind){
    if (failed) return;
    failed = HOUSE3D_FALLBACK_KINDS.includes(kind) ? kind : "error";
    HOUSE.countHouse3dOnce(`house3d_fallback:${failed}`, send);
    showFlat();
    teardown();
  }
  const guard = (fn) => function(...a){ try { return fn.apply(this, a); } catch (_) { fail("error"); return undefined; } };
  function disposeList(list){
    for (const r of list || []) { try { r.dispose(); } catch (_) { /* best effort */ } }
  }

  // ── start: WebGL or nothing ───────────────────────────────────────────────
  function buildRoot(){
    const d = (tag, cls) => { const n = document.createElement(tag); if (cls) n.className = cls; return n; };
    root = d("div", "la3d");
    root.setAttribute("data-la3d", slotKey);
    const style = d("style");
    style.textContent = CSS;
    root.appendChild(style);
    bar = d("div", "la3d-bar");
    const seg = (label, items) => {
      const s = d("span", "lv-zoomseg");
      if (label) { const l = d("span", "la3d-lbl"); l.textContent = label; s.appendChild(l); }
      for (const [text, title, act] of items) {
        const b = d("button");
        b.type = "button"; b.textContent = text; b.title = title;
        b.addEventListener("click", guard((e) => { e.stopPropagation(); act(); }));
        s.appendChild(b);
      }
      return s;
    };
    const walls = seg("Walls", [
      ["Cut", "Cut away the walls between you and the rooms", () => setWalls("cut")],
      ["Up", "All walls up", () => setWalls("up")],
      ["Down", "All walls down", () => setWalls("down")],
    ]);
    walls.setAttribute("data-la3d-walls", "");
    const views = seg(null, [
      ["Iso", "The Atlas's angle", () => preset("iso", true)],
      ["Top", "Straight down", () => preset("top", true)],
      ["⟳ 90°", "Turn the house a quarter", () => preset("turn", true)],
      ["Fit", "Fit the floors that are showing", () => preset("fit", true)],
    ]);
    views.setAttribute("data-la3d-views", "");
    bar.appendChild(walls); bar.appendChild(views);
    // Furnish on a narrow screen: the plan or the 3D view (a wide one shows both).
    planSeg = seg(null, [["3D", "The house in 3D", () => setPlanOnly(false)], ["Plan", "Straight down on the floor showing", () => setPlanOnly(true)]]);
    planSeg.setAttribute("data-la3d-plan", "");
    planSeg.style.display = "none";
    bar.appendChild(planSeg);
    root.appendChild(bar);
    // The compass: N is true north (settings.fabric_bearing_deg), and it
    // turns with the camera. A tap turns the house to north up.
    const compass = d("button", "la3d-compass");
    compass.type = "button";
    compass.title = "North up";
    compass.setAttribute("aria-label", "Compass: turn the view to north up");
    compass.innerHTML = '<svg viewBox="-26 -26 52 52" aria-hidden="true">'
      + '<circle r="23" fill="none" stroke="rgba(226,240,232,.18)" stroke-width="1.2"/>'
      + '<g class="la3d-rose"><path d="M0,-15 L4.6,0 L-4.6,0 Z" fill="#ef5350"/><path d="M0,15 L4.6,0 L-4.6,0 Z" fill="#cfd8d3"/>'
      + '<text x="0" y="-16.5" text-anchor="middle" font-size="8.5" font-weight="700" fill="#f3f6f4" '
      + 'font-family="system-ui,sans-serif">N</text></g></svg>';
    compass.addEventListener("pointerdown", guard((e) => spinDown(e)));
    compass.addEventListener("contextmenu", (e) => e.preventDefault());
    // Enter or Space on the focused compass (a click with no pointer behind
    // it): north up, like a tap. A pointer's own click is the spin's to decide.
    compass.addEventListener("click", guard((e) => {
      e.stopPropagation();
      if (e.detail !== 0) return;
      cam.moved = true; cam.needsFit = false;
      cam.theta = HOUSE.northUpTheta(bearingNow());
      applyCam();
    }));
    root.appendChild(compass);
    compassEl = compass;
    rose = compass.querySelector(".la3d-rose");
    // Shown on release of a spin: nothing is saved until Save.
    pill = d("span", "lv-zoomseg la3d-north");
    pill.setAttribute("role", "group");
    pill.setAttribute("aria-label", "North");
    pillBtns = [["Save north", "Keep north where the needle points", () => saveNorth()],
                ["Cancel", "Put north back", () => cancelNorth()]].map(([text, title, act]) => {
      const b = d("button");
      b.type = "button"; b.textContent = text; b.title = title;
      b.addEventListener("click", guard((e) => { e.stopPropagation(); act(); }));
      pill.appendChild(b);
      return b;
    });
    root.appendChild(pill);
    paintWallButtons();
  }
  function paintWallButtons(){
    if (!bar) return;
    const btns = bar.querySelectorAll("[data-la3d-walls] button");
    ["cut", "up", "down"].forEach((m, i) => { if (btns[i]) btns[i].setAttribute("aria-pressed", String(wallMode === m)); });
  }

  function start(setting){
    canvas = document.createElement("canvas");
    let gl = null;
    try {
      // A stencil: rain and snow are never drawn over a room (live_aboard_weather.js).
      gl = canvas.getContext("webgl2", { antialias: setting !== "low", alpha: false, depth: true, stencil: true,
                                         powerPreference: "default", preserveDrawingBuffer: false });
    } catch (_) { gl = null; }
    if (!gl) { fail("no_webgl"); return false; }
    renderer = new THREE.WebGLRenderer({ canvas, context: gl });
    renderer.setClearColor(BG, 1);
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    const onLost = () => fail("context_lost");
    canvas.addEventListener("webglcontextlost", onLost);
    observers.push(() => canvas.removeEventListener("webglcontextlost", onLost));
    buildRoot();
    canvas.setAttribute("role", "img");
    canvas.setAttribute("aria-label", "Live Aboard");
    root.insertBefore(canvas, bar);
    scene = new THREE.Scene();
    scene.background = new THREE.Color(BG);
    scene.fog = new THREE.Fog(BG, 140, 420);
    camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 700);
    makeShared();
    hemi = new THREE.HemisphereLight(0xe6edf6, 0x3a342c, 1.6);
    sun = new THREE.DirectionalLight(0xfff0dc, 2.0);
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.03;
    scene.add(hemi, sun, sun.target);
    // A fixed pool of real lamps: only their intensities ever change (Low
    // lights four of them, High all eight — a profile change, never a bulb).
    for (let i = 0; i < 8; i++) { const pl = new THREE.PointLight(0xffffff, 0, 7.5, 2); lampPool.push(pl); scene.add(pl); }
    // The press, the hover box and the rings: the Atlas's, over the house.
    use = USE.createUseSurface({
      root, pick: (x, y) => pickAt(x, y), screenOf,
      // Built once per poll, on first need: the host's api for this card.
      api: () => apiNow || (apiNow = apiOf ? apiOf() : null),
      frame: () => { if (!pending && !failed && renderer) { pending = true; requestAnimationFrame(frame); } },
      cursor: (on) => { canvas.style.cursor = on ? "pointer" : ""; },
    });
    // Furniture (P2): every piece drawn on its floor, in every view.
    layer = FURNISH.createPieceLayer({ THREE, PIECES, FURN: () => FURN, floors: () => floorsUi, blobTex: shared.blobTex,
      canon: (fid) => (house && house.canon ? house.canon(fid) : String(fid)), quality: () => (profileOf().pbr ? "high" : "low") });
    devices = DEVICES ? DEVICES.createDeviceLayer({ THREE, layer, FURN: () => FURN, halo: shared.haloMats.m,
      quality: () => (profileOf().pbr ? "high" : "low") }) : null;
    tracked = TRACKED ? TRACKED.createTrackedLayer({ THREE, FURN: () => FURN, floors: () => floorsUi,
      canon: (fid) => (house && house.canon ? house.canon(fid) : String(fid)), quality: () => (profileOf().pbr ? "high" : "low") }) : null;
    planCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 400);
    planCam.up.set(0, 0, -1);                                // the plan as drawn: its top up
    // The 3D editor: its page in this element, its marks in this scene, its
    // presses handed over by wirePointer while it is open.
    editor = EDIT.createEditor({
      THREE, HOUSE, DRAFT, root, canvas, bar, guard,
      camera: () => camera, scene: () => scene, floors: () => floorsUi, shellGen: () => shellGen,
      pick: (x, y) => pickAt(x, y), blocked: (v, own) => blocked(v, own), device: (eid) => deviceInfo(eid),
      file: () => file, reload: () => reloadFile(), problem: () => fileErr, newer: () => setFileErr("house3d_newer"),
      saved: (data) => { file = DRAFT.ownedOf(data); setFileErr(DRAFT.writable(data) ? null : "house3d_newer"); },
      redraw: () => redraw(), preview: (t) => preview(t), render: () => requestRender(), topDown: (F) => topDownOn(F),
      clearUse: () => { if (use) use.clear(); },
      // P2 Furnish: its tool, the furniture drawn, and where on screen each view is.
      FURNISH, PIECES, FURN: () => FURN, layer, rect: () => view3Rect(), viewAt: (x, y) => viewAt(x, y),
      // The plan alone (a narrow screen): its middle as it shows, not where the hidden 3D view looks.
      centre: () => { if (viewports().d3) return [cam.target.x, cam.target.z]; fitPlan(); return [plan.cx, plan.cy]; }, setTopFloor: (fid) => { if (topCb) topCb(fid); }, host: () => furnishP,
      base: new URL(import.meta.url).search,
    });
    wirePointer();
    wireObservers();
    return true;
  }
  function makeShared(){
    const wallBox = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);    // its base on y = 0
    const n = wallBox.attributes.normal, col = new Float32Array(n.count * 3);
    // A dark wall top, as in the Sims.
    for (let i = 0; i < n.count; i++) { const v = n.getY(i) > 0.5 ? 0.24 : 1; col[i * 3] = col[i * 3 + 1] = col[i * 3 + 2] = v; }
    wallBox.setAttribute("color", new THREE.BufferAttribute(col, 3));
    const glowTex = radialTexture([[0, "rgba(255,255,255,1)"], [0.22, "rgba(255,255,255,0.6)"], [0.55, "rgba(255,255,255,0.16)"], [1, "rgba(255,255,255,0)"]]);
    shared = {
      wallBox, glassBox: new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0),
      prim: {
        puck: new THREE.CylinderGeometry(1, 1, 1, 18),
        dome: new THREE.CylinderGeometry(1, 0.62, 1, 20).translate(0, -0.5, 0),     // a closed drum hanging from y = 0
        box: new THREE.BoxGeometry(1, 1, 1),
        sphere: new THREE.SphereGeometry(1, 14, 10),
      },
      glowTex, aoTex: rampTexture(),
      // A soft round shadow under furniture on Low (live_aboard_furnish.js).
      blobTex: radialTexture([[0, "rgba(255,255,255,1)"], [0.55, "rgba(255,255,255,0.55)"], [1, "rgba(255,255,255,0)"]]),
      bulbMat: new THREE.MeshBasicMaterial({ color: 0xffffff }),
      // Part B: an unlocked lock's flash (every one in step, as on the
      // Atlas), the motion ring, and the air bars' stripe.
      flashMat: new THREE.MeshBasicMaterial({ color: HOUSE.LOCK_FLASH.to, transparent: true, opacity: 0.55, depthWrite: false }),
      ringGeo: new THREE.RingGeometry(0.93, 1, 48).rotateX(-Math.PI / 2),
      barsTex: barsTexture(),
      poolGeo: new THREE.PlaneGeometry(2, 2).rotateX(-Math.PI / 2),
      poolMat: new THREE.MeshBasicMaterial({ map: glowTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -4 }),
      haloMats: {},
      mats: new Map(),
    };
    for (const k of Object.keys(HALO)) {
      shared.haloMats[k] = new THREE.PointsMaterial({ size: HALO[k] / Math.tan(FOV / 2 * D2R), map: glowTex, vertexColors: true,
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true });
    }
  }
  // One material per look and profile: flat colours on Low, PBR on High.
  function mat(spec){
    const key = (quality.profile || quality.measuring || "low") + JSON.stringify(spec);
    let m = shared.mats.get(key);
    if (!m) {
      const o = { color: spec.c || "#ffffff", vertexColors: !!spec.vc, transparent: !!spec.tr, opacity: spec.op ?? 1,
                  depthWrite: !spec.tr, side: spec.ds ? THREE.DoubleSide : THREE.FrontSide };
      m = profileOf().pbr ? new THREE.MeshStandardMaterial({ ...o, roughness: spec.r ?? 0.85, metalness: spec.m ?? 0 })
        : new THREE.MeshLambertMaterial(o);
      shared.mats.set(key, m);
    }
    return m;
  }
  const profileOf = () => HOUSE.QUALITY_PROFILES[quality.profile || quality.measuring || "low"];

  // ── the house ─────────────────────────────────────────────────────────────
  function clearShell(){
    clearSensors(); clearBadges();
    openings = [];
    if (use && !use.pressing) use.clear();            // what it marked is gone
    for (const F of floorsUi) scene.remove(F.group);
    if (ground) { scene.remove(ground); scene.remove(gridLines); ground = null; gridLines = null; }
    disposeList(shellRes); shellRes = [];
    clearLights();
    floorsUi = [];
  }
  function labelMesh(text, maxW){
    const px = 56, c = document.createElement("canvas"), g = c.getContext("2d");
    const font = `700 ${px}px system-ui, "Segoe UI", Roboto, sans-serif`;
    const setup = () => { g.font = font; if ("letterSpacing" in g) g.letterSpacing = "4px"; };
    setup();
    c.width = Math.ceil(g.measureText(text).width) + 48; c.height = px + 40;
    setup();
    g.textAlign = "center"; g.textBaseline = "middle"; g.lineJoin = "round";
    g.lineWidth = 12; g.strokeStyle = "rgba(12,16,14,0.8)"; g.strokeText(text, c.width / 2, c.height / 2 + 2);
    g.fillStyle = "#ffffff"; g.fillText(text, c.width / 2, c.height / 2 + 2);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
    let k = 0.5 / px;                                        // ~0.5 m letters, smaller in small rooms
    if (c.width * k > maxW) k = Math.max(0.2 / px, maxW / c.width);
    const geo = new THREE.PlaneGeometry(c.width * k, c.height * k);
    const m = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, polygonOffset: true,
                                            polygonOffsetFactor: -2, polygonOffsetUnits: -8 });
    shellRes.push(tex, geo, m);
    const mesh = new THREE.Mesh(geo, m);
    mesh.renderOrder = 3;
    return mesh;
  }
  function lit(geo, spec, cast = true, recv = true){
    const o = new THREE.Mesh(geo, mat(spec));
    o.userData.spec = spec; o.castShadow = cast; o.receiveShadow = recv;
    return o;
  }
  function buildShell(h){
    clearShell();
    shellGen++; work.shells++;
    house = h;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const r of h.rooms) {
      if (r.floor.outdoor) continue;
      for (const p of r.pts) { x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]); x1 = Math.max(x1, p[0]); y1 = Math.max(y1, p[1]); }
      z0 = Math.min(z0, r.floor.elev - HOUSE.SLAB_T); z1 = Math.max(z1, r.floor.elev + r.floor.h - HOUSE.SLAB_T);
    }
    houseBox = Number.isFinite(x0) ? { x0, y0, x1, y1, z0, z1 } : { x0: -5, y0: -5, x1: 5, y1: 5, z0: 0, z1: 3 };
    for (const fl of h.floors) {
      const group = new THREE.Group();
      group.name = "floor:" + fl.id;
      scene.add(group);
      const per = h.perFloor.get(fl) || { rooms: [], pieces: [] };
      const F = { fl, group, rooms: per.rooms, pieces: [], labels: [], tiles: null, solid: null, glass: null, ao: null };
      floorsUi.push(F);
      // Floor tiles: each room extruded down by its slab — the room's colour
      // on top, the Atlas's beige on the sides — merged into one per floor.
      const geos = [];
      per.rooms.forEach((r, i) => {
        const g = new THREE.ExtrudeGeometry(new THREE.Shape(r.pts.map(p => new THREE.Vector2(p[0], p[1]))), { depth: HOUSE.SLAB_T, bevelEnabled: false });
        g.rotateX(Math.PI / 2);                              // plan (x, y) -> world (x, ·, y); the extrusion goes down
        g.translate(0, (i % 8) * 0.0005, 0);                 // overlapping hand-drawn rooms must not z-fight
        const tm = theme3d ? theme3d.tile : 0.38;            // the Showcase look's mix (Classic: 0.38, a deck 0.5)
        const top = colorOf(r.color).lerp(new THREE.Color(TILE_MIX), r.outdoor ? tm + 0.12 : tm);
        const side = new THREE.Color(fl.outdoor ? EARTH_SIDE : SLAB_SIDE);
        const n = g.attributes.position.count, caps = g.groups.length ? g.groups[0].count : n, col = new Float32Array(n * 3);
        for (let v = 0; v < n; v++) { const cc = v < caps ? top : side; col[v * 3] = cc.r; col[v * 3 + 1] = cc.g; col[v * 3 + 2] = cc.b; }
        g.setAttribute("color", new THREE.BufferAttribute(col, 3));
        g.clearGroups();
        geos.push(g);
        const lbl = labelMesh(String(r.name).toUpperCase(), Math.max(0.6, r.spot.r * 1.9));
        lbl.position.set(r.spot.x, fl.elev + 0.02, r.spot.y);
        group.add(lbl);
        F.labels.push(lbl);
      });
      if (geos.length) {
        const merged = mergeGeometries(geos);
        geos.forEach(g => g.dispose());
        merged.translate(0, fl.elev, 0);
        shellRes.push(merged);
        F.tiles = lit(merged, { vc: true, r: 0.9 }, true, true);
        group.add(F.tiles);
      }
      // Walls: the derived pieces, each drawn bottom to top (wallElements).
      const solids = [], glasses = [];
      for (const pc of per.pieces) {
        if (Math.hypot(pc.x1 - pc.x0, pc.y1 - pc.y0) < 0.02) continue;
        // Lengthened only at its wall's own corners, so joints close and a
        // door, window or gap keeps its width (drawnSpan).
        const span = HOUSE.drawnSpan(pc);
        const els = HOUSE.wallElements(pc, fl.h).map(e => ({ ...e, list: e.glass ? glasses : solids }));
        for (const e of els) { e.i = e.list.length; e.list.push(e); }
        F.pieces.push({ pc, mx: span.mx, my: span.my, yaw: HOUSE.yawOf([pc.x1 - pc.x0, pc.y1 - pc.y0]),
                        len: span.len, els, cut: null, lights: [] });
      }
      const inst = (list, geo, spec, cast) => {
        if (!list.length) return null;
        const im = new THREE.InstancedMesh(geo, mat(spec), list.length);
        im.userData.spec = spec;
        im.castShadow = cast; im.receiveShadow = true; im.frustumCulled = false;
        list.forEach((e, i) => { e.mesh = im; im.setColorAt(i, _c.set(e.col)); });
        shellRes.push({ dispose: () => im.dispose() });
        group.add(im);
        return im;
      };
      F.solid = inst(solids, shared.wallBox, { vc: true, r: 0.92 }, true);
      F.glass = inst(glasses, shared.glassBox, { tr: true, op: 0.32, r: 0.08 }, false);
      // A door, window or lock linked to a sensor opens with it (part B).
      for (const P of F.pieces) setupOpening(F, P, per.rooms);
      for (const P of F.pieces) placePiece(F, P, false);
      F.ao = aoMesh(F);
      if (F.ao) group.add(F.ao);
    }
    // The ground and the sun, sized to the house.
    const cx = (houseBox.x0 + houseBox.x1) / 2, cy = (houseBox.y0 + houseBox.y1) / 2;
    const sx = houseBox.x1 - houseBox.x0, sy = houseBox.y1 - houseBox.y0;
    const groundY = h.ground - HOUSE.SLAB_T - 0.02;
    const gGeo = new THREE.CircleGeometry(420, 72).rotateX(-Math.PI / 2);
    // What the house stands on, and its grid: the Showcase look's (Classic: today's).
    const gc = theme3d ? theme3d.ground : "#18201c", today = !LOOKS || theme3d === LOOKS.SHOWCASE_LOOKS.classic;
    ground = lit(gGeo, { c: gc, r: 1 }, false, true);
    ground.position.set(cx, groundY, cy);
    const span = Math.ceil(Math.max(sx, sy) / 2 + 30) * 2;
    const toward = new THREE.Color(gc).getHSL({}).l > 0.5 ? 0x000000 : 0xffffff;
    gridLines = today ? new THREE.GridHelper(span, span / 2, 0x2b3730, 0x202a25)
      : new THREE.GridHelper(span, span / 2, new THREE.Color(gc).lerp(_c.set(toward), 0.09), new THREE.Color(gc).lerp(_c.set(toward), 0.04));
    gridLines.position.set(Math.round(cx), groundY + 0.004, Math.round(cy));
    shellRes.push(gGeo, gridLines.geometry, gridLines.material);
    scene.add(ground, gridLines);
    placeSun();
    applyTop();
    if (!cam.moved) cam.needsFit = true;
  }
  // The sun's light sits out along the sun's direction from the middle of the
  // house, its shadow box (High) fitted round the house's bounds.
  function placeSun(){
    const b = houseBox, cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2, cz = (b.z0 + b.z1) / 2;
    const R = Math.hypot(b.x1 - b.x0, b.y1 - b.y0, b.z1 - b.z0) / 2 + 4, dist = R + 40;
    sun.target.position.set(cx, cz, cy);
    sun.target.updateMatrixWorld();
    sun.position.set(cx + sunDir.x * dist, cz + sunDir.y * dist, cy + sunDir.z * dist);
    Object.assign(sun.shadow.camera, { left: -R, right: R, top: R, bottom: -R, near: 1, far: dist + R + 20 });
    sun.shadow.camera.updateProjectionMatrix();
  }
  // The real sun (live_aboard_house.js readSun: sun.sun, else worked out from
  // hass.config, else due south): its direction in the house's own frame by
  // the bearing, its strength and colour by its height; off at night, with a
  // dim cool sky. Drawn again only when it has moved more than SUN_STEP, the
  // phase of the day changed, or north moved. The light's intensity changes,
  // never whether it is there (no shader rebuilds).
  function applySun(p){
    sunRead = HOUSE.readSun(p.states, p.config, Date.now());
    storedBearing = HOUSE.normBearing(p.bearing);
    if (northHold && (storedBearing === northHold.b || Date.now() > northHold.until)) northHold = null;
    return drawSun(bearingNow(), false);
  }
  function drawSun(b, force){
    const s = sunRead || { ...HOUSE.SUN_DEFAULT, source: "default" }, look = HOUSE.sunLight(s.elevation);
    const gap = sunNow ? Math.abs(((s.azimuth - sunNow.azimuth) % 360 + 540) % 360 - 180) : Infinity;
    if (!force && sunNow && b === sunNow.bearing && look.phase === sunNow.phase
        && gap <= SUN_STEP && Math.abs(s.elevation - sunNow.elevation) <= SUN_STEP) return false;
    sunNow = { azimuth: s.azimuth, elevation: s.elevation, source: s.source, bearing: b, phase: look.phase, night: look.night };
    bearing = b;
    // A setting sun still lights from just above the horizon as it fades,
    // never from under the slabs.
    const d = HOUSE.sunDirection(s.azimuth, Math.max(s.elevation, 2), b);
    sunDir.set(d.x, d.up, d.y).normalize();
    sun.intensity = SUN_I * look.sun;
    sun.color.set(SUN_HIGH).lerp(_c.set(SUN_LOW), look.warm);
    hemi.intensity = SKY_I_DAY + (SKY_I_NIGHT - SKY_I_DAY) * look.night;
    hemi.color.set(SKY_DAY).lerp(_c.set(SKY_NIGHT), look.night);
    hemi.groundColor.set(GROUND_DAY).lerp(_c.set(GROUND_NIGHT), look.night);
    // The Showcase look's sky (Classic: none, and today's brightness).
    if (theme3d) { if (theme3d.skyMix) hemi.color.lerp(_c.set(theme3d.sky), theme3d.skyMix); hemi.intensity *= theme3d.ambient; }
    placeSun();
    roseDeg = null;
    requestRender();
    return true;
  }
  // The compass rose: where north shows on screen in this view (degrees,
  // clockwise from up, -180..180), the same arithmetic a spun needle is read
  // back through (live_aboard_house.js needleAngle / bearingFromNeedle).
  function paintCompass(){
    if (!rose) return;
    const a = HOUSE.needleAngle(bearing, cam.theta, cam.phi), deg = a > 180 ? a - 360 : a;
    if (roseDeg !== null && Math.abs(((deg - roseDeg) % 360 + 540) % 360 - 180) < 0.5) return;
    roseDeg = deg;
    rose.setAttribute("transform", `rotate(${deg.toFixed(1)})`);
  }

  // ── north: the compass you spin ───────────────────────────────────────────
  // Press the compass and drag round it, with a mouse or one finger: the
  // needle follows, and wherever it points on screen is where north is in this
  // view, in any view (the needle's angle and the camera give the bearing
  // through fabric_compass.js's inverse). The sun and its shadows follow as it
  // turns, so north can be lined up with the real shadows; nothing is saved.
  // On release a "Save north · Cancel" pill: Save writes the bearing alone
  // through the host (settings.fabric_bearing_deg, the GPS Bridge's own), then
  // "North saved · Undo"; Cancel, Escape or a tap anywhere else puts it all
  // back. A stray touch on the wall PC cannot move north. A tap, under
  // SPIN_SLOP of movement, turns the view north-up as before; a press while a
  // finger is on the house is that gesture's, never a spin.
  const bearingNow = () => (northPreview !== null ? northPreview : northHold ? northHold.b : storedBearing);
  function spinDown(e){
    e.stopPropagation();
    e.preventDefault();
    if (e.pointerType === "mouse" && e.button !== 0) return;
    if (spin) { endSpin(true); return; }                     // a second finger on the compass: no spin
    if (camPts.size) return;                                  // a finger on the house: its gesture
    const r = compassEl.getBoundingClientRect();
    spin = { id: e.pointerId, x0: e.clientX, y0: e.clientY, cx: r.left + r.width / 2, cy: r.top + r.height / 2,
             moved: false, before: northPreview, unhook: null };
    try { compassEl.setPointerCapture(e.pointerId); } catch (_) { /* the window listeners carry it anyway */ }
    // On the window, so a spin outlives a poll moving the view into a new card.
    const move = guard((ev) => spinMove(ev)), up = guard((ev) => spinUp(ev));
    const cancel = guard((ev) => { if (spin && ev.pointerId === spin.id) endSpin(true); });
    window.addEventListener("pointermove", move, true);
    window.addEventListener("pointerup", up, true);
    window.addEventListener("pointercancel", cancel, true);
    spin.unhook = () => {
      window.removeEventListener("pointermove", move, true);
      window.removeEventListener("pointerup", up, true);
      window.removeEventListener("pointercancel", cancel, true);
    };
  }
  function spinMove(ev){
    if (!spin || ev.pointerId !== spin.id) return;
    if (!spin.moved && Math.hypot(ev.clientX - spin.x0, ev.clientY - spin.y0) < SPIN_SLOP) return;
    if (!spin.moved && root) for (const t of root.querySelectorAll(".la3d-toast")) t.remove();   // an old Undo goes
    spin.moved = true;
    const a = Math.atan2(ev.clientX - spin.cx, -(ev.clientY - spin.cy)) * 180 / Math.PI;
    northPreview = HOUSE.normBearing(HOUSE.bearingFromNeedle(a, cam.theta, cam.phi));
    drawSun(northPreview, false);
  }
  function spinUp(ev){
    if (!spin || ev.pointerId !== spin.id) return;
    const moved = spin.moved;
    endSpin(false);
    if (moved) showPill();
    else {                                                     // a tap: north up
      cam.moved = true; cam.needsFit = false;
      cam.theta = HOUSE.northUpTheta(bearingNow());
      applyCam();
    }
  }
  /** The press is over; abort puts the needle back where this press found it. */
  function endSpin(abort){
    const s0 = spin;
    spin = null;
    if (!s0) return;
    if (s0.unhook) s0.unhook();
    try { if (compassEl && compassEl.hasPointerCapture && compassEl.hasPointerCapture(s0.id)) compassEl.releasePointerCapture(s0.id); }
    catch (_) { /* released already */ }
    if (abort && s0.moved) { northPreview = s0.before; drawSun(bearingNow(), true); }
  }
  function showPill(){
    if (!pill) return;
    pill.classList.add("on");
    for (const b of pillBtns) b.disabled = false;
    if (unhookNorth) return;
    const onKey = guard((e) => { if (e.key === "Escape") cancelNorth(); });
    const onDown = guard((e) => {
      const path = typeof e.composedPath === "function" ? e.composedPath() : [];
      // That touch only puts north back: on the house it presses nothing.
      if (!path.includes(pill) && !path.includes(compassEl)) { northDismissed = e; cancelNorth(); }
    });
    document.addEventListener("keydown", onKey, true);
    document.addEventListener("pointerdown", onDown, true);
    unhookNorth = () => {
      document.removeEventListener("keydown", onKey, true);
      document.removeEventListener("pointerdown", onDown, true);
      unhookNorth = null;
    };
  }
  function hidePill(){
    if (pill) pill.classList.remove("on");
    if (unhookNorth) unhookNorth();
  }
  function cancelNorth(){
    endSpin(false);
    hidePill();
    if (northPreview === null) return;
    northPreview = null;
    drawSun(bearingNow(), true);
  }
  function saveNorth(){
    if (northPreview === null) { hidePill(); return; }
    const b = northPreview, was = northHold ? northHold.b : storedBearing, save = saveNorthCb;
    if (typeof save !== "function") { cancelNorth(); toast("North can't be saved from here", null); return; }
    for (const x of pillBtns) x.disabled = true;
    Promise.resolve().then(() => save(b)).then(guard(() => {
      northHold = { b, until: Date.now() + NORTH_HOLD_MS };
      northPreview = null;
      hidePill();
      drawSun(bearingNow(), true);
      toast("North saved", () => undoNorth(was, save));
    }), guard(() => {
      for (const x of pillBtns) x.disabled = false;
      toast("Could not save north", null);
    }));
  }
  function undoNorth(was, save){
    Promise.resolve().then(() => save(was)).then(guard(() => {
      northHold = { b: was, until: Date.now() + NORTH_HOLD_MS };
      drawSun(bearingNow(), true);
      toast("North put back", null);
    }), guard(() => toast("Could not put north back", null)));
  }
  // A note over the view that fades out by itself (CSS), with an action.
  function toast(text, act){
    if (!root) return;
    for (const old of root.querySelectorAll(".la3d-toast")) old.remove();
    const t = document.createElement("div");
    t.className = "la3d-toast";
    t.setAttribute("role", "status");
    const span = document.createElement("span");
    span.textContent = text;
    t.appendChild(span);
    if (act) {
      const b = document.createElement("button");
      b.type = "button"; b.textContent = "Undo";
      b.addEventListener("click", guard((e) => { e.stopPropagation(); t.remove(); act(); }));
      t.appendChild(b);
    }
    t.addEventListener("animationend", () => t.remove());
    root.appendChild(t);
  }
  // High's ambient occlusion, baked rather than a post-process pass: a soft
  // shade on the floor along the foot of every wall (both sides of an inside
  // wall, the inside of an outside one), one mesh per floor, shown on High.
  function aoMesh(F){
    const pos = [], uv = [], idx = [];
    const strip = (P, side) => {
      const pc = P.pc, dx = pc.x1 - pc.x0, dy = pc.y1 - pc.y0, L = Math.hypot(dx, dy);
      if (L < 0.1) return;
      const nx = pc.nx * side, ny = pc.ny * side, o = pc.thick / 2, y = F.fl.elev + 0.004;
      const a0 = [pc.x0 + nx * o, pc.y0 + ny * o], a1 = [pc.x1 + nx * o, pc.y1 + ny * o];
      const b0 = [a0[0] + nx * AO_W, a0[1] + ny * AO_W], b1 = [a1[0] + nx * AO_W, a1[1] + ny * AO_W];
      const base = pos.length / 3;
      pos.push(a0[0], y, a0[1], a1[0], y, a1[1], b1[0], y, b1[1], b0[0], y, b0[1]);
      uv.push(0, 1, 1, 1, 1, 0, 0, 0);
      idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    };
    for (const P of F.pieces) {
      const k = P.pc.kind;
      if (k === "rail" || k === "open") continue;
      if (P.pc.cls === "ext" && !P.pc.free) strip(P, -1);
      else { strip(P, 1); strip(P, -1); }
    }
    if (!idx.length) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    const m = new THREE.MeshBasicMaterial({ color: 0x000000, map: shared.aoTex, transparent: true, depthWrite: false,
      side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 });
    shellRes.push(g, m);
    const mesh = new THREE.Mesh(g, m);
    mesh.renderOrder = 1;
    mesh.visible = !!profileOf().ao;
    return mesh;
  }
  // A wall piece's instances at full height, or cut down to CUT_H; a linked
  // leaf as open as its sensor has it.
  function placePiece(F, P, cut){
    for (const e of P.els) {
      const z1 = cut && e.cuttable ? Math.min(e.z1, HOUSE.CUT_H) : e.z1, hgt = z1 - e.z0;
      e.mesh.setMatrixAt(e.i, hgt < 0.005 ? ZERO : P.open && e === P.open.leaf ? leafMatrix(F, P, e.z0, hgt, e.thick)
        : compose(P.mx, F.fl.elev + e.z0, P.my, P.yaw, P.len, hgt, e.thick));
      e.mesh.instanceMatrix.needsUpdate = true;
    }
    if (P.open && P.open.flash) placeFlash(F, P, cut);
  }

  // ── doors, windows and locks with sensors (part B) ────────────────────────
  // A barrier linked to a sensor is an opening (live_aboard_house.js
  // openingKind): its leaf — a door's, or a window's pane — opens and shuts
  // with the sensor as the Atlas reads it (openingState), a door swinging
  // in about a hinge on the left, a window opening a little way, a garage
  // door rolling up into its head; no reading is the Atlas's grey, shut; an
  // unlocked lock flashes red. Hinge and swing are the defaults until the 3D
  // file says otherwise (part C hands its openings[<barrier id>] to
  // openingSwing; nothing here ever writes it).
  function setupOpening(F, P, rooms){
    const b = P.pc.barrier, k = P.pc.kind, len = Math.hypot(P.pc.x1 - P.pc.x0, P.pc.y1 - P.pc.y0);
    if (!b || !b.linked_entity_id) return;
    const o = { bar: b, eid: String(b.linked_entity_id), kind: k, leaf: null, len, hinge: null, side: null,
                garage: false, state: null, at: 0, to: 0, from: 0, t0: 0, flash: null };
    if (k === "open") {
      // A gap (material "open") has no leaf: it keeps its reading and its
      // tap target all the same, a doorway's height of it, and its
      // threshold reads as the Atlas's line does (closed grey, open
      // nothing, no reading the dashed grey).
      const sill = P.els[0];
      if (!sill) return;
      Object.assign(o, { sill, span: { z0: 0, z1: Math.min(HOUSE.DOOR_H, F.fl.h - HOUSE.SLAB_T), thick: P.pc.thick } });
    } else {
      const leaf = P.els.find(e => e.leaf);
      if (!leaf || (k !== "door" && k !== "window")) return;
      const sw = HOUSE.openingSwing(P.pc, rooms, P.pc.override || null);
      Object.assign(o, { leaf, hinge: sw.hinge, side: sw.side, garage: k === "door" && len > 1.8 });
    }
    P.open = o;
    openings.push({ F, P });
  }
  // The leaf at o.at (0 shut, 1 open), eased: about its hinge, or up into
  // its head for a garage door. Shut, it is exactly the piece's own place.
  function leafMatrix(F, P, z0, hgt, thick){
    const o = P.open, pc = P.pc, a = o.at * o.at * (3 - 2 * o.at);
    if (o.garage) {
      const up = a * Math.max(0, hgt - 0.2);
      return compose(P.mx, F.fl.elev + z0 + up, P.my, P.yaw, P.len, hgt - up, thick);
    }
    const hb = o.hinge === "b", hx = hb ? pc.x1 : pc.x0, hy = hb ? pc.y1 : pc.y0;
    const ux = ((hb ? pc.x0 : pc.x1) - hx) / o.len, uy = ((hb ? pc.y0 : pc.y1) - hy) / o.len;
    const ang = a * (o.kind === "window" ? WINDOW_OPEN : DOOR_OPEN), c = Math.cos(ang), s = Math.sin(ang);
    const dx = c * ux + s * pc.nx * o.side, dy = c * uy + s * pc.ny * o.side;
    return compose(hx + dx * o.len / 2, F.fl.elev + z0, hy + dy * o.len / 2, HOUSE.yawOf([dx, dy]), o.len, hgt, thick);
  }
  // An unlocked lock: a glow over its shut leaf, its colour and strength
  // set on the frame (animateLive); nothing while locked.
  function placeFlash(F, P, cut){
    const o = P.open, e = o.leaf || o.span, m = o.flash;
    if (o.state !== "unlocked") m.matrix.copy(ZERO);
    else {
      const z1 = cut ? Math.min(e.z1, HOUSE.CUT_H) : e.z1;
      m.matrix.copy(compose(P.mx, F.fl.elev + e.z0 - 0.01, P.my, P.yaw, P.len + 0.04, z1 - e.z0 + 0.03, e.thick + 0.05));
    }
    m.matrixWorldNeedsUpdate = true;
  }
  const OPEN_WORD = { open: "Open", closed: "Closed", locked: "Locked", unlocked: "Unlocked", none: "No reading" };
  function paintOpenings(){
    let changed = false;
    for (const { F, P } of openings) {
      const o = P.open, dl = lbe[o.eid];
      if (o.kind === "door" && dl && dl.device_class === "garage_door") o.garage = true;
      const st = HOUSE.openingState(o.bar, dl);
      if (st === o.state) continue;
      const first = o.state === null;
      if (st === "unlocked") o.liveUntil = performance.now() + LIVE_MS;   // a flash just started
      o.state = st;
      o.to = st === "open" ? 1 : 0;
      if (first || !o.leaf) o.at = o.to;                   // the first look is how it is, not a swing (a gap never swings)
      else { o.from = o.at; o.t0 = performance.now(); }    // a swing, timed on the clock (animateLive)
      const e = o.leaf || o.sill;
      e.mesh.setColorAt(e.i, _c.set(st === "none" ? NO_READING : !o.leaf && st !== "open" ? SHUT_LINE : e.col));
      e.mesh.instanceColor.needsUpdate = true;
      if (st === "unlocked" && !o.flash) {
        o.flash = new THREE.Mesh(shared.glassBox, shared.flashMat);
        o.flash.matrixAutoUpdate = false;
        o.flash.renderOrder = 4;
        F.group.add(o.flash);
      }
      placePiece(F, P, !!P.cut);
      changed = true;
    }
    return changed;
  }

  // ── the lights ────────────────────────────────────────────────────────────
  function clearLights(){
    for (const F of floorsUi) { if (F.lightGroup) F.group.remove(F.lightGroup); F.lightGroup = null; for (const P of F.pieces) P.lights = []; }
    disposeList(lightRes); lightRes = [];
    lights = [];
  }
  function buildLights(h){
    clearLights();
    work.lights++;
    for (const F of floorsUi) {
      // By id: a lights-only rebuild reads the floors afresh (same ids).
      const mine = h.lights.filter(L => L.floor.id === F.fl.id);
      if (!mine.length) continue;
      const lg = new THREE.Group();
      F.lightGroup = lg;
      F.group.add(lg);
      const bulbs = { puck: [], dome: [], box: [], sphere: [] }, houses = [], halos = { s: [], m: [], l: [] }, pools = [];
      const ctx = { rooms: F.rooms, pieces: F.pieces.map(P => P.pc), ground: h.ground };
      const zs = viewData().lights;
      for (const L0 of mine) {
        // Moved whole to its height in the 3D file, if it has one (part C).
        const lift = DRAFT.liftParts(HOUSE.fixtureParts(L0, ctx), zs[L0.eid], F.fl.h - HOUSE.SLAB_T), parts = lift.parts;
        const L = { ...L0, F, kf: parts.kf, wall: null, refs: { bulbs: [], houses: [], halos: [], pool: null }, key: null, look: null,
                    z: lift.z, zDefault: lift.zDefault };
        if (parts.wall) { const P = F.pieces.find(q => q.pc === parts.wall); if (P) { L.wall = P; P.lights.push(L); } }
        let sx = 0, sy = 0, sh = 0;
        for (const b of parts.bulbs) {
          const m = compose(b.x, F.fl.elev + b.h, b.y, b.yaw, b.sx, b.sy, b.sz).clone();
          L.refs.bulbs.push({ prim: b.prim, i: bulbs[b.prim].length, off: new THREE.Color(b.off), m });
          bulbs[b.prim].push({ m, off: b.off });
          sx += b.x; sy += b.y; sh += b.h;
        }
        for (const hh of parts.housings) { L.refs.houses.push({ i: houses.length, hh }); houses.push(hh); }
        for (const hl of parts.halos) { L.refs.halos.push({ cls: hl.cls, i: halos[hl.cls].length }); halos[hl.cls].push(hl); }
        // Where a press finds it: every bulb and every glow (a strip anywhere along it).
        L.pick = [...parts.bulbs, ...parts.halos].map(q => new THREE.Vector3(q.x, F.fl.elev + q.h, q.y));
        if (parts.pool && parts.poolH !== null) { L.refs.pool = pools.length; pools.push({ at: parts.poolAt, h: parts.poolH, ...parts.pool }); }
        const n = Math.max(1, parts.bulbs.length), mh = sh / n;
        L.lamp = new THREE.Vector3(sx / n, F.fl.elev + (mh > 1.5 ? mh - 0.3 : mh + 0.35), sy / n);
        lights.push(L);
      }
      F.bulbs = {};
      for (const [prim, list] of Object.entries(bulbs)) {
        if (!list.length) continue;
        const im = new THREE.InstancedMesh(shared.prim[prim], shared.bulbMat, list.length);
        list.forEach((b, i) => { im.setMatrixAt(i, b.m); im.setColorAt(i, _c.set(b.off)); });
        im.frustumCulled = false;                            // instances come and go with their walls
        lightRes.push({ dispose: () => im.dispose() });
        lg.add(F.bulbs[prim] = im);
      }
      if (houses.length) {
        const spec = { r: 0.6 };
        const im = new THREE.InstancedMesh(shared.prim.box, mat(spec), houses.length);
        im.userData.spec = spec; im.castShadow = true;
        houses.forEach((b, i) => { im.setMatrixAt(i, compose(b.x, F.fl.elev + b.h, b.y, b.yaw, b.sx, b.sy, b.sz)); im.setColorAt(i, _c.set(b.col)); });
        lightRes.push({ dispose: () => im.dispose() });
        lg.add(F.houses = im);
      }
      F.halos = {};
      for (const [cls, list] of Object.entries(halos)) {
        if (!list.length) continue;
        const pos = new Float32Array(list.length * 3), col = new Float32Array(list.length * 3);
        list.forEach((hl, i) => pos.set([hl.x, F.fl.elev + hl.h, hl.y], i * 3));
        const g = new THREE.BufferGeometry();
        g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
        g.setAttribute("color", new THREE.BufferAttribute(col, 3));
        const pts = new THREE.Points(g, shared.haloMats[cls]);
        pts.renderOrder = 5; pts.frustumCulled = false;
        lightRes.push(g);
        lg.add(F.halos[cls] = pts);
      }
      F.pool = null;
      if (pools.length) {
        const im = new THREE.InstancedMesh(shared.poolGeo, shared.poolMat, pools.length);
        pools.forEach((pl, i) => {
          _m.set(pl.a[0], 0, pl.b[0], pl.at[0], 0, 1, 0, F.fl.elev + pl.h, pl.a[1], 0, pl.b[1], pl.at[1], 0, 0, 0, 1);
          im.setMatrixAt(i, _m); im.setColorAt(i, _c.setRGB(0, 0, 0));
        });
        im.renderOrder = 2; im.frustumCulled = false;
        lightRes.push({ dispose: () => im.dispose() });
        lg.add(F.pool = im);
      }
    }
    lampsDirty = true;
  }
  // One light's look, painted: the bulb's colour, the glow, the pool. A
  // switch changes these values only — what is drawn never changes.
  const _white = new THREE.Color(1, 1, 1);
  function paintLight(L){
    const F = L.F, k = L.look, on = k.on, hidden = !!(L.wall && L.wall.cut) || !!L.swap, glow = theme3d ? theme3d.glow : 1;
    const c = new THREE.Color().setRGB(k.rgb[0], k.rgb[1], k.rgb[2], THREE.SRGBColorSpace);
    L.color = c; L.f = k.f;
    const core = on ? c.clone().lerp(_white, 0.35).multiplyScalar(0.55 + 0.45 * k.f) : null;
    for (const r of L.refs.bulbs) {
      const im = F.bulbs[r.prim];
      im.setColorAt(r.i, on ? core : (k.unavailable ? _c.copy(r.off).multiplyScalar(0.55) : r.off));
      im.setMatrixAt(r.i, hidden ? ZERO : r.m);
      im.instanceColor.needsUpdate = true;
      im.instanceMatrix.needsUpdate = true;
    }
    for (const r of L.refs.halos) {
      const attr = F.halos[r.cls].geometry.attributes.color, g = on && !hidden ? k.f * 0.95 * glow : 0;
      attr.setXYZ(r.i, c.r * g, c.g * g, c.b * g);
      attr.needsUpdate = true;
    }
    if (L.refs.pool !== null && F.pool) {
      const g = on ? k.f * 0.34 * glow : 0;
      F.pool.setColorAt(L.refs.pool, _c.setRGB(c.r * g, c.g * g, c.b * g));
      F.pool.instanceColor.needsUpdate = true;
    }
  }
  /** The poll: repaint only the lights whose look changed. */
  function paintLights(lightsByEid){
    let changed = false;
    for (const L of lights) {
      const look = HOUSE.lightLook((lightsByEid && lightsByEid[L.eid]) || L.l);
      const key = HOUSE.lookKey(look);
      if (key === L.key) continue;
      L.key = key; L.look = look;
      paintLight(L);
      changed = true;
    }
    if (changed) { lampsDirty = true; requestRender(); }
    return changed;
  }
  function assignLamps(){
    lampsDirty = false;
    lampTarget.copy(cam.target);
    const n = profileOf().lamps;
    // A fixture with a piece of its own (P5) lights from the piece's bulb.
    const cands = lights.filter(L => L.look && L.look.on && L.kf > 0 && L.F.group.visible && !L.swap)
      .map(L => ({ pos: L.lamp, color: L.color, k: L.f * L.kf }))
      .concat(devices ? devices.lamps() : [])
      .sort((a, b) => a.pos.distanceToSquared(cam.target) - b.pos.distanceToSquared(cam.target));
    lampPool.forEach((pl, i) => {
      const c = i < n ? cands[i] : null;
      if (!c) { pl.intensity = 0; return; }
      pl.position.copy(c.pos);
      pl.color.copy(c.color);
      pl.intensity = LAMP_I * c.k;
    });
  }

  // ── furniture that is a device (P5) ───────────────────────────────────────
  /** What each linked piece shows now (live_aboard_devices.js); a fixture
   *  whose device a piece is steps aside for it (in 3D only: where the light
   *  is placed is never touched); and while the Atlas's emergency lighting
   *  test runs (p.emergency: its lights), each one is outlined. */
  function syncDevices(p, vd){
    if (!devices) return;
    const em = Array.isArray(p.emergency) && p.emergency.length ? new Set(p.emergency.map(String)) : null;
    let changed = devices.sync(vd.pieces, { states: p.states || {}, regIds: p.regIds || null, entities: p.entities || null, lbe, emergency: em });
    for (const L of lights) {
      const s = devices.has(L.eid, L.kind === "fan" || (L.l && L.l.isFan) ? "spin" : "glow");
      if (s !== !!L.swap) { L.swap = s; L.key = null; changed = true; }
    }
    if (outlineFixtures(em)) changed = true;
    if (changed) { lampsDirty = true; requestRender(); }
  }
  function outlineFixtures(em){
    const want = em ? lights.filter(L => em.has(L.eid) && !L.swap && L.pick && L.pick.length && L.F.lightGroup) : [];
    const key = `${work.lights}:${want.map(L => L.eid).join(",")}`;
    if (key === emKey) return false;
    emKey = key;
    for (const o of emOutlines) if (o.parent) o.parent.remove(o);
    emOutlines = want.map(L => {
      const o = devices.outline(new THREE.Box3().setFromPoints(L.pick).expandByScalar(0.14));
      L.F.lightGroup.add(o);
      return o;
    });
    return true;
  }

  // ── beacons, scanners and people (P6) ─────────────────────────────────────
  /** p.people (only while Show people is on): {snapshot() (the live snapshot
   *  the host already holds, Mapping), or read() → Promise (through
   *  the host, the sidebar) with everyMs (never more often than Overview
   *  polls)}. A read happens on a card the Atlas builds anyway: no timer. */
  function syncTracked(p, vd, rebuilt){
    if (!tracked) return;
    // p.tags (only while Show tags & scanners is on) is the same reader: one
    // read serves both layers.
    const on = (x) => !!(x && typeof x === "object");
    const pp = on(p.people) ? p.people : on(p.tags) ? p.tags : null;
    if (!pp) { peopleSnap = null; peopleAt = 0; peopleLoad = null; }
    else if (typeof pp.snapshot === "function") { peopleSnap = pp.snapshot() || null; peopleReads++; }
    else if (typeof pp.read === "function" && !peopleLoad && Date.now() - peopleAt >= Math.max(PEOPLE_MS, Number(pp.everyMs) || 0)) {
      peopleAt = Date.now();
      peopleReads++;
      const mine = peopleLoad = Promise.resolve().then(() => pp.read()).then((snap) => {
        if (peopleLoad !== mine) return;
        peopleLoad = null; peopleSnap = snap && typeof snap === "object" ? snap : null;
        if (lastP && renderer && !failed) syncTracked(lastP, viewData(), false);
      }, () => { if (peopleLoad === mine) peopleLoad = null; });
    }
    if (tracked.sync({ model: p.model, looks: vd.devices, figures: vd.figures, snapshot: pp ? peopleSnap : null,
                       states: p.states || {}, people: on(p.people), tags: on(p.tags) }, rebuilt)) requestRender();
  }

  // ── sensors: motion, Motion · Air, the readouts (part B) ──────────────────
  // Placed sensors only, as on the Atlas. A motion sensor is a small sensor
  // near the ceiling, lit while active; the floor of its room pulses in the
  // Atlas's motion colours on its clocks (live_aboard_house.js motionLook),
  // with the ring sweeping out from under it. Poor air rises in bars across
  // its room's floor (airLook). Temperature, humidity and air float as
  // readouts, read-only. Each sits at its height above its floor: a default
  // by its type (deviceZ — part C's 3D file replaces it per device).
  function clearSensors(){
    for (const F of floorsUi) { if (F.sensorGroup) F.group.remove(F.sensorGroup); F.sensorGroup = null; }
    disposeList(sensorRes); sensorRes = [];
    sensorsUi = []; tints = []; readouts = [];
  }
  function buildSensors(h){
    clearSensors();
    work.sensors++;
    for (const F of floorsUi) {
      const mine = (h.sensors || []).filter(S => S.floor.id === F.fl.id);
      if (!mine.length) continue;
      const g = new THREE.Group();
      F.sensorGroup = g;
      F.group.add(g);
      const ceil = F.fl.h - HOUSE.SLAB_T, motion = [], here = [], zs = viewData().devices;
      for (const S0 of mine) {
        const z = HOUSE.deviceZ(S0.kind, ceil, zs[S0.eid] || null);
        const S = { ...S0, F, z, zDefault: HOUSE.deviceZ(S0.kind, ceil, null), pos: new THREE.Vector3(S0.x, F.fl.elev + z, S0.y),
                    room: HOUSE.roomAt(F.rooms, S0.x, S0.y), shown: null };
        sensorsUi.push(S); here.push(S);
        if (S.kind === "motion") motion.push(S); else readouts.push(makeReadout(S, g));
      }
      if (motion.length) {
        const im = new THREE.InstancedMesh(shared.prim.sphere, shared.bulbMat, motion.length);
        motion.forEach((S, i) => {
          im.setMatrixAt(i, compose(S.x, S.pos.y, S.y, 0, 0.055, 0.04, 0.055));
          im.setColorAt(i, _c.set(SENSOR_QUIET));
          S.mesh = im; S.i = i;
        });
        im.frustumCulled = false;
        sensorRes.push({ dispose: () => im.dispose() });
        g.add(im);
      }
      // One tint per room with motion or air in it; a motion sensor outside
      // every room pulses its own patch of floor. Air needs a room (as on
      // the Atlas: its bars fill the room the sensor is in).
      const byRoom = new Map();
      for (const S of here) {
        if (S.kind !== "motion" && S.kind !== "air") continue;
        if (S.kind === "air" && !S.room) continue;
        const key = S.room || S;
        if (!byRoom.has(key)) byRoom.set(key, { room: S.room, F, at: S, motion: [], air: [] });
        byRoom.get(key)[S.kind].push(S);
      }
      for (const T of byRoom.values()) tints.push(makeTint(T, g));
    }
  }
  function makeTint(T, g){
    const y = T.F.fl.elev + 0.008;
    const geo = T.room ? new THREE.ShapeGeometry(new THREE.Shape(T.room.pts.map(p => new THREE.Vector2(p[0], p[1]))))
      : new THREE.CircleGeometry(1.2, 32).translate(T.at.x, T.at.y, 0);
    // The air bars run across the plan as they run up the Atlas's screen:
    // v along (x + y), a fifth of the room per bar.
    const pos = geo.attributes.position, uv = new Float32Array(pos.count * 2);
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < pos.count; i++) { const s = (pos.getX(i) + pos.getY(i)) / Math.SQRT2; lo = Math.min(lo, s); hi = Math.max(hi, s); }
    const gap = Math.max(0.3, (hi - lo) / 5);
    for (let i = 0; i < pos.count; i++) uv[i * 2 + 1] = (pos.getX(i) + pos.getY(i)) / Math.SQRT2 / gap;
    geo.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
    geo.rotateX(Math.PI / 2).translate(0, y, 0);                       // plan (x, y) -> world (x, ·, y)
    sensorRes.push(geo);
    const flat = { transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true,
                   polygonOffsetFactor: -1, polygonOffsetUnits: -3 };
    T.fillMat = new THREE.MeshBasicMaterial({ ...flat, color: SENSOR_ON });
    const fill = new THREE.Mesh(geo, T.fillMat);
    fill.renderOrder = 1;
    g.add(fill);
    sensorRes.push(T.fillMat);
    T.rings = T.motion.map(S => {
      // The sweep is the active pulse's ring: its colour never changes.
      const mat = new THREE.MeshBasicMaterial({ ...flat, color: HOUSE.motionColor(HOUSE.MOTION_COLOR_STOPS[0][1]) });
      const mesh = new THREE.Mesh(shared.ringGeo, mat);
      mesh.position.set(S.x, y + 0.004, S.y);
      mesh.scale.setScalar(0);
      mesh.renderOrder = 1;
      g.add(mesh);
      sensorRes.push(mat);
      return { S, mesh, mat, on: false };
    });
    if (T.air.length) {
      T.barsTex = shared.barsTex.clone();
      T.barsTex.needsUpdate = true;
      T.barsMat = new THREE.MeshBasicMaterial({ ...flat, map: T.barsTex, color: 0xffffff });
      const bars = new THREE.Mesh(geo, T.barsMat);
      bars.renderOrder = 1;
      g.add(bars);
      sensorRes.push(T.barsTex, T.barsMat);
    }
    T.mLook = null; T.aLook = null; T.mKey = ""; T.aKey = "";
    return T;
  }
  // A readout: a sprite whose canvas is redrawn only when its words change.
  function makeReadout(S, g){
    const c = document.createElement("canvas");
    c.width = READ_W; c.height = READ_C;
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false });
    const sp = new THREE.Sprite(mat);
    sp.position.copy(S.pos);
    sp.renderOrder = 6;
    g.add(sp);
    sensorRes.push(tex, mat);
    Object.assign(S, { sprite: sp, tex, canvas: c, key: null, pillW: 0.5 });
    return S;
  }
  function drawReadout(S, r){
    const c = S.canvas, g = c.getContext("2d");
    let px = 40;
    const font = () => `800 ${px}px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`;
    g.font = font();
    while (px > 24 && g.measureText(r.text).width > READ_W - 44) { px -= 2; g.font = font(); }
    const w = Math.min(READ_W - 4, Math.ceil(g.measureText(r.text).width) + 40), h = READ_C - 8, x0 = (READ_W - w) / 2, y0 = 4;
    g.clearRect(0, 0, READ_W, READ_C);
    g.beginPath();
    if (g.roundRect) g.roundRect(x0, y0, w, h, h / 2); else g.rect(x0, y0, w, h);
    g.fillStyle = "rgba(6,14,9,0.84)"; g.fill();
    g.lineWidth = 2; g.strokeStyle = "rgba(226,240,232,0.18)"; g.stroke();
    g.textAlign = "center"; g.textBaseline = "middle";
    g.globalAlpha = r.live ? 1 : 0.7;
    g.fillStyle = r.color;
    g.fillText(r.text, READ_W / 2, READ_C / 2 + 2);
    g.globalAlpha = 1;
    S.pillW = w / READ_W;
    S.tex.needsUpdate = true;
  }
  // The floor badges: one per plate of the Atlas's stack, its number in its
  // colour, always on top, the same size on screen at any distance.
  function clearBadges(){
    for (const B of badges) if (B.sprite.parent) B.sprite.parent.remove(B.sprite);
    disposeList(badgeRes); badgeRes = [];
    badges = [];
  }
  function buildBadges(p){
    clearBadges();
    for (const B of HOUSE.floorBadges(p.model, p.floors, house)) {
      const F = floorsUi.find(x => x.fl === B.floor);
      if (!F) continue;
      const c = document.createElement("canvas");
      c.width = c.height = 64;
      const g = c.getContext("2d");
      g.beginPath(); g.arc(32, 32, 28, 0, Math.PI * 2);
      g.fillStyle = B.color; g.fill();
      g.lineWidth = 3; g.strokeStyle = "rgba(7,16,8,0.55)"; g.stroke();
      g.fillStyle = "#071008"; g.font = "700 30px system-ui, \"Segoe UI\", Roboto, sans-serif";
      g.textAlign = "center"; g.textBaseline = "middle"; g.fillText(String(B.n), 32, 34);
      const tex = new THREE.CanvasTexture(c);
      tex.colorSpace = THREE.SRGBColorSpace;
      const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false, sizeAttenuation: false });
      const sp = new THREE.Sprite(mat);
      sp.position.set(B.x, B.floor.elev + 0.12, B.y);
      sp.renderOrder = 20;
      F.group.add(sp);
      badgeRes.push(tex, mat);
      badges.push({ ...B, F, sprite: sp, pos: sp.position });
    }
  }
  /** The poll: what each sensor and opening shows now. */
  function paintLive(){
    let changed = paintOpenings();
    const now = Date.now();
    for (const S of sensorsUi) {
      const l = lbe[S.eid] || S.l;
      if (S.kind === "motion") {
        const look = HOUSE.motionLook(l, now, haStarted);
        S.look = look;
        // The sensor itself is lit as the Atlas lights its marker (motionActive).
        const col = HOUSE.motionActive(l, now, haStarted) ? SENSOR_ON : HOUSE.noReading(l) ? NO_READING : SENSOR_QUIET;
        if (col !== S.col) { S.col = col; S.mesh.setColorAt(S.i, _c.set(col)); S.mesh.instanceColor.needsUpdate = true; changed = true; }
      } else {
        const r = HOUSE.readoutOf(l, now);
        const key = r ? `${r.text}|${r.color}|${r.live}` : "";
        if (r && key !== S.key) { S.key = key; S.shown = r; drawReadout(S, r); changed = true; }
      }
      if (S.kind === "air") S.air = HOUSE.airLook(l);
    }
    for (const T of tints) {
      // The room shows its most telling sensor: active before quiet, the
      // latest quiet one; the worst air.
      let m = null;
      for (const S of T.motion) {
        const k = S.look;
        if (k && (!m || (k.active && !m.active) || (k.active === m.active && k.elapsed < m.elapsed))) m = k;
      }
      let a = null;
      for (const S of T.air) if (S.air && (!a || S.air.badness > a.badness)) a = S.air;
      const mKey = m ? `${m.active ? 1 : 0}|${m.hue}` : "", aKey = a ? `${a.hue}|${a.dur}|${a.op}` : "";
      const act = !!(m && m.active);
      if (act && !T.act) T.liveUntil = performance.now() + LIVE_MS;  // a pulse just started
      T.act = act;
      if (mKey !== T.mKey) {
        T.mKey = mKey;
        if (m) T.fillMat.color.set(HOUSE.motionFill(m));
        changed = true;
      }
      for (const R of T.rings) {
        const on = !!(R.S.look && R.S.look.active);
        if (on !== R.on) { R.on = on; changed = true; }
      }
      if (aKey !== T.aKey) { T.aKey = aKey; if (a && T.barsMat) T.barsMat.color.set(HOUSE.airColor(a.hue)); changed = true; }
      T.mLook = m; T.aLook = a;
    }
    // The box over the house says what is there now (a door just opened):
    // on the next frame, once the new card is on the page. What changed is
    // set at once, still or at the start of its pulse (animateLive).
    if (changed) { rehoverDue = true; animateLive(performance.now()); requestRender(); }
  }
  /** How often something moving by itself, on a floor that shows, is drawn
   *  (ms; 0: nothing, the view rests). Only while a door or window swings,
   *  and for a pulse's or a lock's flash's first LIVE_MS. A floor the chips
   *  hide costs no frames. */
  function liveRate(now){
    // Rain and snow draw on their own capped clock (live_aboard_weather.js frameMs).
    // A fan turning, a washer running (P5): on their own capped clock too.
    const wxMs = wx ? wx.frameMs() : 0, own = AMBIENT_MS[quality.profile || quality.measuring || "low"];
    // Someone walking (P6) too.
    const rates = [wxMs, devices ? devices.rate() : 0, tracked ? tracked.rate() : 0].filter(Boolean);
    const slow = rates.length ? Math.min(...rates) : 0;
    const fast = slow ? Math.min(own, slow) : own;
    for (const { F, P } of openings) {
      const o = P.open;
      if (F.group.visible && (o.at !== o.to || (o.state === "unlocked" && now < o.liveUntil))) return fast;
    }
    for (const T of tints) if (T.act && T.F.group.visible && now < T.liveUntil) return fast;
    return slow;
  }
  /** The frame: the Atlas's clocks, played (t: performance.now()). */
  function animateLive(t){
    let flashing = false, flashLive = false;
    for (const { F, P } of openings) {
      const o = P.open;
      if (o.state === "unlocked") { flashing = true; if (t < o.liveUntil) flashLive = true; }
      if (o.at === o.to) continue;
      // On the clock, not by frames: a slow screen swings it as fast.
      const k = Math.min(1, Math.max(0, (t - o.t0) / SWING_MS));
      o.at = k >= 1 ? o.to : o.from + (o.to - o.from) * k;
      placePiece(F, P, !!P.cut);
    }
    if (flashing) {
      // After its start, a still glow halfway between the flash's dim and its peak.
      const k = flashLive ? HOUSE.lockFlashAt(t) : 0.5;
      shared.flashMat.color.set(HOUSE.LOCK_FLASH.from).lerp(_c.set(HOUSE.LOCK_FLASH.to), k);
      shared.flashMat.opacity = HOUSE.LOCK_FLASH.op[0] + (HOUSE.LOCK_FLASH.op[1] - HOUSE.LOCK_FLASH.op[0]) * k;
    }
    const P0 = HOUSE.MOTION_PULSE;
    for (const T of tints) {
      // A pulse plays for its first LIVE_MS, then shows still, as a room
      // breathing after motion does; the air's bars stand still.
      const m = T.mLook, play = !!(T.act && t < T.liveUntil);
      T.fillMat.opacity = !m ? 0 : play ? HOUSE.cycleAt(P0.fill, P0.ms, t) * FILL_K
        : m.active ? STILL.active * FILL_K : STILL.recent * RECENT_K;
      for (const R of T.rings) {
        if (!R.on || !play) { R.mesh.scale.setScalar(0); R.mat.opacity = 0; continue; }
        const r = HOUSE.cycleAt(P0.ringR, P0.ms, t) * RING_R0;
        R.mesh.scale.set(r, 1, r);
        R.mat.opacity = HOUSE.cycleAt(P0.ringA, P0.ms, t);
      }
      if (T.barsMat) T.barsMat.opacity = T.aLook ? Math.min(1, T.aLook.op * AIR_K) : 0;
    }
    if (wx) wx.tick(t);                                       // rain and snow: the clock, to the GPU
    if (devices) devices.tick(t);                             // fans, washers, robots out
    if (tracked) tracked.tick(t);                             // people walking
    liveMs = liveRate(t);
  }
  // Readouts keep to a size you can read; badges keep one size on screen.
  function sizeSprites(){
    const H = canvas.clientHeight || 600, k = 2 * Math.tan(FOV / 2 * D2R) / H;     // metres per pixel, a metre away
    for (const R of readouts) {
      if (!R.F.group.visible) continue;
      const mpp = camera.position.distanceTo(R.pos) * k;
      const h = Math.max(READ_PX[0] * mpp, Math.min(READ_PX[1] * mpp, READ_H)) * READ_C / (READ_C - 8);
      R.sprite.scale.set(h * READ_W / READ_C, h, 1);
    }
    for (const B of badges) B.sprite.scale.set(BADGE_PX * k, BADGE_PX * k, 1);
  }

  // ── floors, walls, quality ────────────────────────────────────────────────
  function applyTop(){
    for (const F of floorsUi) F.group.visible = HOUSE.floorShown(F.fl, topElev);
    lampsDirty = true;
    liveMs = liveRate(performance.now());                    // a floor shown again may be swinging or flashing
  }
  function setWalls(m){
    if (!HOUSE.WALL_MODES.includes(m)) return;
    wallMode = m;
    paintWallButtons();
    requestRender();
  }
  function updateCutaway(){
    const topDown = cam.phi < 0.2;
    for (const F of floorsUi) {
      if (!F.group.visible) continue;
      for (const P of F.pieces) {
        const cut = HOUSE.wallCut(P.pc, camera.position.x, camera.position.z, wallMode, topDown);
        if (cut === P.cut) continue;
        P.cut = cut;
        placePiece(F, P, cut);
        for (const L of P.lights) if (L.look) paintLight(L);     // wall lights go with their wall
      }
    }
  }
  function applyProfile(name){
    const Q = HOUSE.QUALITY_PROFILES[name];
    if (!Q || !renderer) return;
    renderer.setPixelRatio(Q.dpr === "device" ? Math.min(window.devicePixelRatio || 1, 3) : 1);
    renderer.shadowMap.enabled = !!Q.shadows;
    sun.castShadow = !!Q.shadows;
    lampPool.forEach((l, i) => { l.visible = i < Q.lamps; });
    scene.traverse((o) => {
      if (o.userData && o.userData.spec) o.material = mat(o.userData.spec);
    });
    for (const F of floorsUi) if (F.ao) F.ao.visible = !!Q.ao;
    if (layer) layer.sync(viewData().pieces);              // furniture's finishes and shadows go with the profile
    if (lastP) { syncDevices(lastP, viewData()); syncTracked(lastP, viewData(), false); }
    lampsDirty = true;
    resize();
  }
  /** One step of the Auto / Low / High pick (live_aboard_house.js qualityStep). */
  function decideQuality(){
    const step = HOUSE.qualityStep(quality.setting, true, quality.measured);
    if (step.fallback) { fail(step.fallback); return; }
    if (step.measure) {
      quality.measuring = step.measure; quality.intervals = []; quality.t0 = 0; quality.last = 0;
      applyProfile(step.measure);
      // Shaders compile now, not inside the timed frames.
      try { renderer.compile(scene, camera); } catch (_) { /* compiled on first draw instead */ }
      requestRender();
      return;
    }
    quality.measuring = null;
    quality.profile = step.use;
    applyProfile(step.use);
    HOUSE.countHouse3dOnce("house3d_opened", send);
    requestRender();
  }

  // ── the camera: PadSpan's own orbit ───────────────────────────────────────
  // Spherical about a target: theta turns about the vertical (0 = from plan
  // +y), phi tilts down from straight above. Drag turns it; right-drag, or
  // two fingers, pans along the ground; the wheel, or a pinch, zooms about the
  // point under the cursor or between the fingers.
  function applyCam(){
    const s = Math.sin(cam.phi);
    camera.position.set(cam.target.x + cam.radius * s * Math.sin(cam.theta), cam.target.y + cam.radius * Math.cos(cam.phi),
                        cam.target.z + cam.radius * s * Math.cos(cam.theta));
    camera.lookAt(cam.target);
    camera.updateMatrixWorld();
    if (lampTarget.distanceToSquared(cam.target) > 1) lampsDirty = true;
    requestRender();
  }
  const _ray = new THREE.Raycaster(), _ndc = new THREE.Vector2(), _plane = new THREE.Plane();
  /** The world point on the plane y = h under a screen point, or null. */
  function groundAt(clientX, clientY, h){
    const r = view3Rect();
    if (!r.width || !r.height) return null;
    _ndc.set((clientX - r.left) / r.width * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    camera.updateMatrixWorld();
    _ray.setFromCamera(_ndc, camera);
    _plane.set(Y_AXIS, -h);
    const hit = _ray.ray.intersectPlane(_plane, new THREE.Vector3());
    if (!hit || hit.distanceTo(camera.position) > Math.max(40, cam.radius * 4)) return null;
    return hit;
  }
  // Every one of these is a person moving the camera: no more auto-fit.
  const moved = () => { cam.moved = true; cam.needsFit = false; };
  function orbitBy(dx, dy){
    moved();
    const h = canvas.clientHeight || 600;
    cam.theta -= 2 * Math.PI * dx / h;
    cam.phi = Math.max(MIN_PHI, Math.min(MAX_PHI, cam.phi - 2 * Math.PI * dy / h));
    applyCam();
  }
  function panBy(x0, y0, x1, y1){
    moved();
    const a = groundAt(x0, y0, cam.target.y), b = groundAt(x1, y1, cam.target.y);
    if (a && b) cam.target.add(a.sub(b));
    else {                                                   // looking at the horizon: pan in screen space
      const k = cam.radius / Math.max(200, canvas.clientHeight || 600);
      _v.setFromMatrixColumn(camera.matrixWorld, 0).setY(0).normalize().multiplyScalar(-(x1 - x0) * k);
      _v2.set(Math.sin(cam.theta), 0, Math.cos(cam.theta)).multiplyScalar(-(y1 - y0) * k);
      cam.target.add(_v).add(_v2);
    }
    applyCam();
  }
  function zoomAt(clientX, clientY, k){
    moved();
    const r0 = cam.radius, r1 = Math.max(MIN_R, Math.min(MAX_R, r0 * k));
    const f = r1 / r0;
    if (Math.abs(f - 1) < 1e-4) return;
    const p = groundAt(clientX, clientY, cam.target.y);
    if (p) cam.target.sub(p).multiplyScalar(f).add(p);     // the point under the fingers stays put
    cam.radius = r1;
    applyCam();
  }
  function wirePointer(){
    const pts = camPts;
    let mode = null, last = null, pinch = null, press = null, unfollow = null;
    const mid = () => { const [a, b] = [...pts.values()]; return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, d: Math.hypot(a.x - b.x, a.y - b.y) }; };
    // Every finger and button down on the house is followed on the window
    // (capture) until it lifts, as a spin is. A poll moving the view into a
    // new card takes the canvas's pointer capture with it, and a lift off
    // the canvas then never reaches the canvas: the pointer would stay down
    // here, every later press a pinch, and a mouse would turn the house with
    // no button held. Each event counts once, heard first on the window or
    // on the canvas itself (one sent to the canvas alone, never composed out
    // of its shadow root, reaches no window).
    const heard = new WeakSet();
    const once = (fn) => guard((e) => { if (heard.has(e)) return; heard.add(e); fn(e); });
    const follow = () => {
      if (unfollow) return;
      window.addEventListener("pointermove", moved, true);
      window.addEventListener("pointerup", lift, true);
      window.addEventListener("pointercancel", lift, true);
      unfollow = () => {
        window.removeEventListener("pointermove", moved, true);
        window.removeEventListener("pointerup", lift, true);
        window.removeEventListener("pointercancel", lift, true);
        unfollow = null;
      };
    };
    canvas.addEventListener("pointerdown", guard((e) => {
      if (spin) endSpin(true);                               // a finger on the house: no spin
      if (typeof touchCb === "function") { try { touchCb(); } catch (_) { /* the card's, not ours */ } }
      const onlyNorth = e === northDismissed;                // this tap put north back, nothing more
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      follow();
      try { canvas.setPointerCapture(e.pointerId); } catch (_) { /* followed on the window anyway */ }
      if (pts.size === 2) {
        if (press) { press = null; use.cancel(); }           // a second finger: a pinch, never a press
        if (mode === "edit" || mode === "editTap") editor.cancel();   // ...and never a line
        mode = "pinch"; pinch = mid(); pinch.plan = planHere(pinch.x, pinch.y); return;
      }
      mode = e.pointerType === "mouse" && (e.button === 2 || e.button === 1 || e.shiftKey || e.ctrlKey || e.metaKey) ? "pan" : "orbit";
      last = { x: e.clientX, y: e.clientY };
      // In Edit, one finger or the left button draws a line, drags an end
      // or picks what to change (the editor says which); a press never
      // switches a light there. Anything else turns the house as ever.
      if (editor && editor.active && mode === "orbit" && pts.size === 1 && !onlyNorth) {
        const g = editor.down(e);
        if (g === "line" || g === "drag" || g === "swallow") mode = "edit";
        else if (g === "tap") mode = "editTap";
        return;
      }
      // Furnish's plan: one finger or the mouse moves the plan (it never turns).
      if ((mode === "orbit" || mode === "pan") && planHere(e.clientX, e.clientY)) { mode = "planPan"; return; }
      // A press on something in the house (live_aboard_use.js). Moved
      // before it is held, it is no press: the drag turns the house, from
      // where it began.
      if (mode === "orbit" && pts.size === 1 && !onlyNorth && use && use.down(e)) {
        mode = "press";
        press = { id: e.pointerId, x0: e.clientX, y0: e.clientY };
      }
    }));
    canvas.addEventListener("pointermove", guard((e) => {
      if (pts.has(e.pointerId)) { moved(e); return; }
      // No button down: a mouse or pen over the house — what a click would land on.
      if (pts.size || e.pointerType === "touch") return;
      if (editor && editor.active) editor.hover(e);
      else if (use) use.hover(e);
    }));
    const moved = once((e) => {
      if (!pts.has(e.pointerId)) return;
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (mode === "press") {
        if (use.move(e) !== "cancel") return;
        const p0 = press;
        press = null;
        mode = "orbit";
        orbitBy(e.clientX - p0.x0, e.clientY - p0.y0);
        last = { x: e.clientX, y: e.clientY };
        return;
      }
      if (mode === "edit") { editor.move(e); return; }
      if (mode === "editTap") {
        if (Math.hypot(e.clientX - last.x, e.clientY - last.y) <= 6) return;
        editor.cancel();                                     // moved: no pick, the drag turns the house from where it began
        mode = planHere(last.x, last.y) ? "planPan" : "orbit";   // (or moves Furnish's plan)
      }
      if (mode === "planPan") {
        planPanBy(e.clientX - last.x, e.clientY - last.y);
        last = { x: e.clientX, y: e.clientY };
        return;
      }
      if (mode === "pinch" && pts.size === 2) {
        const now = mid();
        now.plan = pinch.plan;
        if (now.plan) { if (pinch.d > 0 && now.d > 0) planZoomAt(now.x, now.y, pinch.d / now.d); planPanBy(now.x - pinch.x, now.y - pinch.y); }
        else { if (pinch.d > 0 && now.d > 0) zoomAt(now.x, now.y, pinch.d / now.d); panBy(pinch.x, pinch.y, now.x, now.y); }
        pinch = now;
        e.preventDefault();
        return;
      }
      if (!last) return;
      if (mode === "orbit") orbitBy(e.clientX - last.x, e.clientY - last.y);
      else if (mode === "pan") panBy(last.x, last.y, e.clientX, e.clientY);
      last = { x: e.clientX, y: e.clientY };
    });
    const lift = once((e) => {
      if (!pts.has(e.pointerId)) return;
      const cancelled = e.type === "pointercancel";
      if (mode === "press") { press = null; if (cancelled) use.cancel(); else use.up(e); }
      else if ((mode === "edit" || mode === "editTap") && editor) {
        if (cancelled) editor.cancel();
        else if (mode === "edit") editor.up(e);
        else editor.tap(e);
      }
      pts.delete(e.pointerId);
      try { canvas.releasePointerCapture(e.pointerId); } catch (_) { /* fine */ }
      if (pts.size === 1) {                                  // one finger left of a pinch: carry on turning from it
        const [p] = [...pts.values()];
        mode = planHere(p.x, p.y) ? "planPan" : "orbit"; last = { x: p.x, y: p.y }; pinch = null;
      } else if (!pts.size) { mode = null; last = null; pinch = null; if (unfollow) unfollow(); }
    });
    canvas.addEventListener("pointerup", lift);
    canvas.addEventListener("pointercancel", lift);
    // The capture went (a poll moved the view): taken back while the
    // pointer is down. One the browser says is gone ends here, as a cancel.
    canvas.addEventListener("lostpointercapture", guard((e) => {
      if (!pts.has(e.pointerId)) return;
      try { canvas.setPointerCapture(e.pointerId); } catch (_) { lift({ type: "pointercancel", pointerId: e.pointerId }); }
    }));
    // The view leaves (Map, or switched off): whatever is down ends, as a cancel.
    dropPointers = () => { for (const id of [...pts.keys()]) lift({ type: "pointercancel", pointerId: id }); };
    canvas.addEventListener("pointerleave", guard((e) => { if (use && !pts.size) use.leave(e); }));
    canvas.addEventListener("contextmenu", (e) => e.preventDefault());
    canvas.addEventListener("wheel", guard((e) => {
      e.preventDefault();
      const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaMode === 2 ? e.deltaY * 400 : e.deltaY;
      const f = Math.exp(Math.max(-200, Math.min(200, dy)) * 0.0015);
      if (planHere(e.clientX, e.clientY)) planZoomAt(e.clientX, e.clientY, f); else zoomAt(e.clientX, e.clientY, f);
      if (use && !pts.size && !(editor && editor.active)) use.hover(e);   // what is under the cursor now
    }), { passive: false });
  }
  /** The corners of every room on a showing indoor floor, at floor and wall-top height. */
  function visiblePoints(){
    const pts = [];
    for (const r of (house && house.rooms) || []) {
      if (r.floor.outdoor || !HOUSE.floorShown(r.floor, topElev)) continue;
      for (const p of r.pts) pts.push(new THREE.Vector3(p[0], r.floor.elev - HOUSE.SLAB_T, p[1]),
                                      new THREE.Vector3(p[0], r.floor.elev + r.floor.h - HOUSE.SLAB_T, p[1]));
    }
    if (!pts.length) {
      const b = houseBox;
      pts.push(new THREE.Vector3(b.x0, b.z0, b.y0), new THREE.Vector3(b.x1, b.z1, b.y1));
    }
    return pts;
  }
  /** Frame the showing floors from the camera's direction (or `dir`). */
  function fit(theta = cam.theta, phi = cam.phi, pts = visiblePoints()){
    const dir = new THREE.Vector3(Math.sin(phi) * Math.sin(theta), Math.cos(phi), Math.sin(phi) * Math.cos(theta));
    const box = new THREE.Box3().setFromPoints(pts), c = box.getCenter(new THREE.Vector3());
    camera.position.copy(c).addScaledVector(dir, 50);
    camera.lookAt(c);
    camera.updateMatrixWorld();
    const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0), up = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1);
    const tv = Math.tan(FOV / 2 * D2R), th = tv * camera.aspect;
    // Centre on the projected extent, then back off until every corner fits.
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const q of pts) { const o = q.clone().sub(c); x0 = Math.min(x0, o.dot(right)); x1 = Math.max(x1, o.dot(right)); y0 = Math.min(y0, o.dot(up)); y1 = Math.max(y1, o.dot(up)); }
    c.addScaledVector(right, (x0 + x1) / 2).addScaledVector(up, (y0 + y1) / 2);
    let need = 2;
    for (const q of pts) {
      const o = q.clone().sub(c), z = o.dot(dir);
      need = Math.max(need, z + Math.abs(o.dot(right)) / th * 1.08, z + Math.abs(o.dot(up)) / tv * 1.22);
    }
    cam.target.copy(c); cam.theta = theta; cam.phi = Math.max(MIN_PHI, Math.min(MAX_PHI, phi));
    cam.radius = Math.max(MIN_R, Math.min(MAX_R, need));
    applyCam();
  }
  function preset(name, byHand = false){
    if (byHand) cam.moved = true;
    cam.needsFit = false;
    // The Atlas's angle (plan x down-right, plan y down-left); a portrait
    // screen turns it so a long house runs up the screen.
    if (name === "iso") fit(camera.aspect < 0.8 ? 0.35 : Math.PI / 4, camera.aspect < 0.8 ? 0.85 : 0.98);
    else if (name === "top") fit(0, MIN_PHI);
    else if (name === "turn") { cam.theta += Math.PI / 2; applyCam(); }
    else fit();
  }

  // ── picking: what a press lands on (PadSpan's own) ────────────────────────
  // Small things by how near they are on screen: a light within PICK_R of
  // any point it is drawn at (its bulbs and its glow, so a strip is pressed
  // anywhere along it), a sensor or a readout by its spot or its label —
  // the Atlas's 44 px target round every marker; the nearest wins, and the
  // others there are "under" it. Surfaces by the shape they cover on screen:
  // a room's name on its floor, a door's or window's opening; the nearest
  // along the ray wins. A floor badge is on top of everything, as on the
  // Atlas. Nothing hidden is pressed: a floor above the top one, a wall light
  // on a cut-away wall, or anything a ray from the eye meets a wall or a
  // floor before (the merged floor tiles included).
  const _hit = new THREE.Raycaster(), _sp = new THREE.Vector3();
  function screenPt(v, rect){
    _sp.copy(v).project(camera);
    if (!(_sp.z > -1 && _sp.z < 1)) return null;
    return [rect.left + (_sp.x + 1) / 2 * rect.width, rect.top + (1 - _sp.y) / 2 * rect.height];
  }
  /** Is v behind a wall or under a floor? own: "meshId:instance" keys of the
   *  thing itself (a door's own leaf and lintel never hide its opening). */
  function blocked(v, own){
    const occ = [];
    for (const F of floorsUi) if (F.group.visible) { if (F.tiles) occ.push(F.tiles); if (F.solid) occ.push(F.solid); }
    _v.copy(v).sub(camera.position);
    const d = _v.length();
    if (d < 0.2) return false;
    _hit.set(camera.position, _v.normalize());
    _hit.near = 0; _hit.far = d - 0.15;
    for (const h of _hit.intersectObjects(occ, false)) if (!(own && own.has(`${h.object.id}:${h.instanceId}`))) return true;
    return false;
  }
  function labelQuad(lbl){
    const p = lbl.geometry.parameters, w = p.width / 2, h = p.height / 2;
    lbl.updateMatrixWorld();
    return [[-w, -h], [w, -h], [w, h], [-w, h]].map(([x, y]) => new THREE.Vector3(x, y, 0).applyMatrix4(lbl.matrixWorld));
  }
  function openingQuad(F, P){
    const e = P.open.leaf || P.open.span, pc = P.pc, z0 = F.fl.elev + Math.max(0, e.z0);
    const z1 = F.fl.elev + (P.cut ? Math.min(e.z1, HOUSE.CUT_H) : e.z1);
    return [[pc.x0, z0, pc.y0], [pc.x1, z0, pc.y1], [pc.x1, z1, pc.y1], [pc.x0, z1, pc.y0]].map(a => new THREE.Vector3(...a));
  }
  const nearPoly = (x, y, poly, slop) => HOUSE.inPoly(x, y, poly)
    || poly.some((a, i) => { const b = poly[(i + 1) % poly.length]; return HOUSE.segDist(x, y, a[0], a[1], b[0], b[1])[0] <= slop; });
  function deviceTarget(c){
    const l = lbe[c.eid];
    // A piece linked to a device the Atlas has no marker for (a TV, a
    // washer, a robot): Home Assistant's own controls for it (P5).
    if (!l && c.piece) {
      const st = lastP && lastP.states ? lastP.states[c.eid] : null;
      return { kind: "entity", key: "entity:" + c.eid, eid: c.eid, anchor: c.v,
               label: (st && st.attributes && st.attributes.friendly_name) || c.eid };
    }
    return { kind: "device", key: "device:" + c.eid, eid: c.eid, anchor: c.v,
             label: l ? `${l.code ? l.code + " · " : ""}${l.friendly_name || c.eid}` : c.eid };
  }
  function pickAt(clientX, clientY){
    if (!renderer || failed || !house) return null;
    const rect = view3Rect();
    if (!rect.width || !rect.height) return null;
    camera.updateMatrixWorld();
    const dist = (v) => { const s = screenPt(v, rect); return s ? Math.hypot(s[0] - clientX, s[1] - clientY) : Infinity; };
    for (const B of badges) {
      if (B.F.group.visible && dist(B.pos) <= BADGE_PX / 2 + 4) {
        return { hit: { kind: "floor", key: "floor:" + B.z, z: B.z, anchor: B.pos, label: `${B.name} — the whole floor` }, under: [] };
      }
    }
    // A tag or a scanner (P6): on it, or anywhere on a tag's name (names
    // show over everything, so a press there is the tag's).
    let tagHit = null;
    for (const T of tracked ? tracked.pickable() : []) {
      let d = dist(T.at);
      const s = T.name && T.namePx ? screenPt(T.name, rect) : null;
      if (s && Math.abs(clientX - s[0]) <= T.namePx[0] / 2 && clientY <= s[1] + 2 && clientY >= s[1] - T.namePx[1] - 2) d = 0;
      else if (d > PICK_R || blocked(T.at)) continue;
      if (!tagHit || d < tagHit.d) tagHit = { d, hit: { kind: T.kind, key: T.key, anchor: T.at, label: T.label, card: T.card } };
    }
    const devs = [];
    for (const L of lights) {
      if (!L.F.group.visible || (L.wall && L.wall.cut) || !L.pick || L.swap) continue;
      let best = null;
      for (const v of L.pick) { const d = dist(v); if (d <= PICK_R && (!best || d < best.d)) best = { d, v }; }
      if (best) devs.push({ eid: L.eid, ...best });
    }
    const mpp = 2 * Math.tan(FOV / 2 * D2R) / (canvas.clientHeight || 600);
    for (const S of sensorsUi) {
      if (!S.F.group.visible) continue;
      const d = dist(S.pos);
      // A readout is pressed anywhere on its label.
      const r = S.sprite ? Math.max(PICK_R, S.sprite.scale.x * S.pillW / 2 / (camera.position.distanceTo(S.pos) * mpp)) : PICK_R;
      if (d <= r) devs.push({ eid: S.eid, d, v: S.pos });
    }
    // A piece that is a device (P5): anywhere on it, its device. A marker
    // nearer the press than PIECE_D still wins.
    const linked = devices ? devices.pickable() : [];
    if (linked.length) {
      _ndc.set((clientX - rect.left) / rect.width * 2 - 1, 1 - (clientY - rect.top) / rect.height * 2);
      _hit.setFromCamera(_ndc, camera);
      _hit.near = 0; _hit.far = Infinity;
      for (const c of linked) {
        const h = _hit.intersectObject(c.root, true).find(x => x.object.isMesh);
        if (h) devs.push({ eid: c.eid, d: PIECE_D, v: h.point.clone(), piece: c.id });
      }
    }
    devs.sort((a, b) => a.d - b.d);
    const ok = [];
    for (const c of devs.slice(0, 8)) if (!ok.some(x => x.eid === c.eid) && !blocked(c.v)) ok.push(c);
    if (tagHit && (!ok.length || tagHit.d <= ok[0].d)) return { hit: tagHit.hit, under: ok.map(deviceTarget) };
    if (ok.length) return { hit: deviceTarget(ok[0]), under: ok.slice(1).map(deviceTarget) };
    const surf = [];
    for (const F of floorsUi) {
      if (!F.group.visible) continue;
      F.labels.forEach((lbl, i) => {
        const q = labelQuad(lbl), poly = q.map(v => screenPt(v, rect));
        if (poly.every(Boolean) && HOUSE.inPoly(clientX, clientY, poly)) {
          surf.push({ kind: "room", room: F.rooms[i].name, quad: q, at: lbl.position, depth: camera.position.distanceTo(lbl.position) });
        }
      });
    }
    openings.forEach(({ F, P }, i) => {
      if (!F.group.visible || !HOUSE.openingPressable(lbe[P.open.eid])) return;
      const q = openingQuad(F, P), poly = q.map(v => screenPt(v, rect));
      if (!poly.every(Boolean) || !nearPoly(clientX, clientY, poly, 6)) return;
      const at = q[0].clone().add(q[2]).multiplyScalar(0.5);
      surf.push({ kind: "door", F, P, i, quad: q, at, depth: camera.position.distanceTo(at) });
    });
    surf.sort((a, b) => a.depth - b.depth);
    for (const s of surf) {
      const own = s.kind === "door" ? new Set(s.P.els.map(e => `${e.mesh.id}:${e.i}`)) : null;
      if (blocked(s.at, own)) continue;
      if (s.kind === "room") {
        const n = Object.values(lbe).filter(l => l && l.area_name === s.room).length;
        return { hit: { kind: "room", key: "room:" + s.room, room: s.room, quad: s.quad,
                        label: `${s.room} — opens its ${n} device${n === 1 ? "" : "s"}` }, under: [] };
      }
      const o = s.P.open, b = o.bar, l = lbe[o.eid];
      return { hit: { kind: "door", key: `door:${o.eid}@${b.id || s.i}`, eid: o.eid, bar: HOUSE.barrierCardOf(b), quad: s.quad,
                      label: `${b.name || (l && l.friendly_name) || o.eid} · ${OPEN_WORD[o.state] || OPEN_WORD.none}` }, under: [] };
    }
    return null;
  }
  /** Where a target is, in px from the view's own corner (for its marks). */
  function screenOf(t){
    if (!renderer || !root) return null;
    const rect = view3Rect(), r0 = root.getBoundingClientRect();
    const ox = r0.left + (root.clientLeft || 0), oy = r0.top + (root.clientTop || 0);
    if (t.anchor) { const s = screenPt(t.anchor, rect); return s ? { x: s[0] - ox, y: s[1] - oy } : null; }
    if (t.quad) {
      const ps = t.quad.map(v => screenPt(v, rect));
      return ps.every(Boolean) ? { poly: ps.map(p => [p[0] - ox, p[1] - oy]) } : null;
    }
    return null;
  }

  // ── drawing, on demand ────────────────────────────────────────────────────
  function shouldDraw(){
    return !!(renderer && root && root.isConnected !== false && visible
      && !(typeof document !== "undefined" && document.visibilityState === "hidden"));
  }
  function requestRender(){
    dirty = true;
    if (pending || failed || !renderer) return;
    pending = true;
    requestAnimationFrame(frame);
  }
  const frame = guard((t) => {
    pending = false;
    if (failed || !renderer) return;
    if (!shouldDraw()) {                                     // drawn again when it shows
      // A check cut short by hiding starts again: the gap is not a frame.
      quality.last = 0; quality.t0 = 0; quality.intervals = [];
      if (liveMs) dirty = true;                              // what moves carries on when it shows
      return;
    }
    // A press's ring and hold, the hover box's grace: timed on frames.
    const more = use ? use.tick(performance.now()) : false;
    // Something moving by itself draws on its own clock (liveRate).
    const due = dirty || !!quality.measuring || (liveMs > 0 && t - lastAmbient >= liveMs - 4);
    if (due) {
      if (cam.needsFit && (canvas.clientWidth || 0) > 0) preset("iso");
      updateCutaway();
      for (const F of floorsUi) if (F.group.visible) for (const l of F.labels) l.rotation.set(-Math.PI / 2, cam.theta, 0, "YXZ");
      animateLive(performance.now());                        // and how often it moves now (liveMs)
      lastAmbient = t;
      sizeSprites();
      if (lampsDirty || lampTarget.distanceToSquared(cam.target) > 1) assignLamps();
      const vp = viewports();
      if (!vp.plan) renderer.render(scene, camera);
      else {
        // Furnish: the 3D view and the plan, each in its own part of the one canvas.
        fitPlan();
        renderer.setScissorTest(true);
        for (const [r, c] of [[vp.d3, camera], [vp.plan, planCam]]) {
          if (!r) continue;
          renderer.setViewport(r[0], drawnH - r[1] - r[3], r[2], r[3]);
          renderer.setScissor(r[0], drawnH - r[1] - r[3], r[2], r[3]);
          renderer.render(scene, c);
        }
        renderer.setScissorTest(false);
        renderer.setViewport(0, 0, drawnW, drawnH);
      }
      paintCompass();
      if (use) { if (rehoverDue) { rehoverDue = false; use.rehover(); } use.layout(); }
      if (editor) editor.layout();
      frames++;
      dirty = false;
      if (quality.measuring) {
        if (quality.last) quality.intervals.push(t - quality.last);
        quality.last = t;
        if (!quality.t0) quality.t0 = t;
        const n = quality.intervals.length, el = t - quality.t0;
        if (n >= MEASURE_FRAMES || (el > MEASURE_MS && n >= MEASURE_MIN) || el > MEASURE_GIVE_UP_MS) {
          quality.measured[quality.measuring] = HOUSE.frameMs(quality.intervals);
          decideQuality();
        } else requestRender();
      }
    }
    if ((liveMs || more) && !pending) { pending = true; requestAnimationFrame(frame); }
  });
  // ── Furnish: the plan beside the 3D view (P2) ─────────────────────────────
  // Wide enough, the canvas is two views from the one renderer: the house in
  // 3D on the left, the plan of the top floor showing on the right. Narrower,
  // one of them, picked with Plan / 3D. Everything else draws, picks and
  // turns the 3D view in its own part (view3Rect).
  const SPLIT_MIN_W = 820, SPLIT_K = 0.58;
  /** Each view's part of the canvas, in CSS px from its top left [x, y, w, h], or null. */
  function viewports(){
    const w = drawnW, h = drawnH;
    if (!furnishOn || !w) return { d3: [0, 0, w, h], plan: null };
    if (w >= SPLIT_MIN_W) { const w3 = Math.round(w * SPLIT_K); return { d3: [0, 0, w3, h], plan: [w3, 0, w - w3, h] }; }
    return planOnly ? { d3: null, plan: [0, 0, w, h] } : { d3: [0, 0, w, h], plan: null };
  }
  function rectOf(vp){
    const r = canvas.getBoundingClientRect(), v = vp || [0, 0, 0, 0];
    return { left: r.left + v[0], top: r.top + v[1], width: v[2], height: v[3], right: r.left + v[0] + v[2], bottom: r.top + v[1] + v[3] };
  }
  /** The 3D view's own part of the canvas: all of it, except beside Furnish's plan. */
  const view3Rect = () => (furnishOn ? rectOf(viewports().d3) : canvas.getBoundingClientRect());
  /** The view under a screen point, with its camera (the editor's Furnish tool picks through it). */
  function viewAt(x, y){
    const vp = viewports(), inR = (r) => x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
    if (vp.plan) { const r = rectOf(vp.plan); if (inR(r)) { fitPlan(); return { camera: planCam, rect: r, plan: true }; } }
    if (vp.d3) { const r = rectOf(vp.d3); if (inR(r)) return { camera, rect: r, plan: false }; }
    return null;
  }
  const planHere = (x, y) => { const v = viewAt(x, y); return !!(v && v.plan); };
  /** The top floor showing, indoors (the editor's currentFloor). */
  const topFloorUi = () => floorsUi.filter(F => F.group.visible && !F.fl.outdoor && F.rooms.length).sort((a, b) => b.fl.elev - a.fl.elev)[0] || null;
  /** The plan's camera: straight down on the top floor showing, fitted to
   *  its rooms until someone pans or zooms it. */
  function fitPlan(){
    const vp = viewports().plan;
    if (!vp || !planCam || !vp[3]) return;
    const F = topFloorUi(), a = vp[2] / vp[3];
    if (plan.fit && F) {
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const r of F.rooms) for (const p of r.pts) { x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]); x1 = Math.max(x1, p[0]); y1 = Math.max(y1, p[1]); }
      if (Number.isFinite(x0)) { plan.cx = (x0 + x1) / 2; plan.cy = (y0 + y1) / 2; plan.half = Math.max(1.5, (y1 - y0) / 2, (x1 - x0) / 2 / a) * 1.1; }
    }
    const top = (F ? F.fl.elev + F.fl.h : houseBox.z1) + 30;
    planCam.left = -plan.half * a; planCam.right = plan.half * a; planCam.top = plan.half; planCam.bottom = -plan.half;
    planCam.near = 1; planCam.far = top - houseBox.z0 + 10;
    planCam.position.set(plan.cx, top, plan.cy);
    planCam.lookAt(plan.cx, top - 10, plan.cy);
    planCam.updateProjectionMatrix();
    planCam.updateMatrixWorld();
  }
  function planPanBy(dx, dy){
    const vp = viewports().plan;
    if (!vp || !vp[3]) return;
    const k = 2 * plan.half / vp[3];
    plan.fit = false; plan.cx -= dx * k; plan.cy -= dy * k;
    requestRender();
  }
  function planZoomAt(x, y, f){
    const vp = viewports().plan;
    if (!vp || !vp[3]) return;
    const r = rectOf(vp), k = 2 * plan.half / vp[3];
    const px = plan.cx + (x - (r.left + r.width / 2)) * k, py = plan.cy + (y - (r.top + r.height / 2)) * k;
    const h = Math.max(1, Math.min(200, plan.half * f)), s = h / plan.half;
    plan.fit = false; plan.cx = px + (plan.cx - px) * s; plan.cy = py + (plan.cy - py) * s; plan.half = h;
    requestRender();
  }
  /** Mapping → Furnish on or off (attach): the plan comes or goes. */
  function setFurnishView(on){
    if (furnishOn === on) return;
    furnishOn = on; planOnly = false; plan.fit = true;
    resize(true);
  }
  function setPlanOnly(on){
    if (planOnly === !!on) return;
    planOnly = !!on; plan.fit = true;
    resize(true);
  }
  function paintPlan(){
    if (!planSeg) return;
    const narrow = furnishOn && drawnW > 0 && drawnW < SPLIT_MIN_W, vp = viewports();
    // Furnish's panel keeps to the 3D side, clear of the plan (live_aboard_furnish.js).
    root.style.setProperty("--la3d-plan-w", `${vp.plan && vp.d3 ? vp.plan[2] : 0}px`);
    planSeg.style.display = narrow ? "" : "none";
    const bs = planSeg.querySelectorAll("button");
    if (bs[0]) bs[0].setAttribute("aria-pressed", String(!planOnly));
    if (bs[1]) bs[1].setAttribute("aria-pressed", String(planOnly));
  }
  function resize(force = false){
    if (!renderer || !root) return;
    const w = root.clientWidth, h = root.clientHeight;
    if (!w || !h) return;                                    // detached for a moment between two cards
    if (!force && w === drawnW && h === drawnH) return;      // moved into a new card at the same size: nothing to draw
    drawnW = w; drawnH = h;
    renderer.setSize(w, h, false);
    const d3 = viewports().d3;                               // Furnish's plan may take part of it
    camera.aspect = (d3 ? d3[2] : w) / h;
    camera.updateProjectionMatrix();
    paintPlan();
    requestRender();
  }
  function wireObservers(){
    if (typeof ResizeObserver !== "undefined") {
      const ro = new ResizeObserver(guard(() => resize()));
      ro.observe(root);
      observers.push(() => ro.disconnect());
    }
    if (typeof IntersectionObserver !== "undefined") {
      const io = new IntersectionObserver(guard((entries) => {
        const e = entries[entries.length - 1];
        visible = !!(e && e.isIntersecting);
        if (visible && dirty) requestRender();
      }));
      io.observe(root);
      observers.push(() => io.disconnect());
    }
    if (typeof document !== "undefined" && document.addEventListener) {
      const onVis = guard(() => { if (document.visibilityState !== "hidden" && dirty) requestRender(); });
      document.addEventListener("visibilitychange", onVis);
      observers.push(() => document.removeEventListener("visibilitychange", onVis));
    }
  }

  // ── the 3D file (part C) ──────────────────────────────────────────────────
  /** What is drawn on top of the map: the editor's draft while editing,
   *  else the 3D file as read. */
  const viewData = () => (editor && editor.view()) || file || NO_FILE;
  // Read through the host (the view calls nothing itself), once per showing:
  // a failed read leaves the house as the map draws it, with no retry until
  // the screen comes back to 3D. Drawn as soon as it arrives.
  function loadFile(p){
    if (fileLoad || typeof p.load !== "function") return;
    const mine = fileLoad = Promise.resolve().then(() => p.load()).then((r) => {
      if (fileLoad !== mine) return false;
      file = DRAFT.ownedOf(r && r.data);
      setFileErr(DRAFT.writable(r && r.data, r && r.writable) ? null : "house3d_newer");
      if (editor) editor.fileChanged();                   // an open draft follows what was removed elsewhere
      redraw();
      return true;
    }, (err) => {
      // There but unreadable: the house draws from the map, and Edit says why.
      if (fileLoad === mine && err && err.code === "read_failed") setFileErr("read_failed");
      return false;
    });
  }
  const redraw = guard(() => { if (lastP && renderer && !failed) update(lastP); });
  // Why the file cannot be edited, changed: Edit says so.
  function setFileErr(code){
    if (((fileErr && fileErr.code) || null) === (code || null)) return;
    fileErr = code ? { code } : null;
    if (editor) editor.refresh();
  }
  /** Read the file again (the editor opening before the first read came). */
  function reloadFile(){
    fileLoad = null;
    if (lastP) loadFile(lastP);
    return fileLoad || Promise.resolve(false);
  }
  /** A drawn light or sensor, for the editor's Heights: its height now and
   *  by default, its floor, where it is. Scanners are never drawn here: the
   *  map keeps their heights (presence uses them). */
  function deviceInfo(eid){
    const L = lights.find(x => x.eid === eid), S = L ? null : sensorsUi.find(x => x.eid === eid), X = L || S;
    if (!X || typeof X.z !== "number") return null;
    const l = lbe[eid];
    return { section: L ? "lights" : "devices", eid, F: X.F, z: X.z, zDefault: X.zDefault,
             label: l ? `${l.code ? l.code + " · " : ""}${l.friendly_name || eid}` : eid,
             at: new THREE.Vector3(X.x, X.F.fl.elev + X.z, X.y) };
  }
  // The line tool traces the plan: straight down on the floor it draws on.
  function topDownOn(F){
    const pts = [];
    for (const r of F.rooms) for (const p of r.pts) pts.push(new THREE.Vector3(p[0], F.fl.elev, p[1]), new THREE.Vector3(p[0], F.fl.elev + F.fl.h - HOUSE.SLAB_T, p[1]));
    cam.moved = true; cam.needsFit = false;
    fit(0, MIN_PHI, pts.length ? pts : undefined);
  }
  // ── a slider being dragged (the editor's Height, Sill, Head) ──────────────
  /** Only what the slider moves, moved in place from the draft: a door's or
   *  window's heights, or a light or sensor up or down. Nothing is read
   *  again or rebuilt; false when it is not drawn (the editor then draws the
   *  house again). Let go, the editor draws the house whole (update). */
  function preview(t){
    if (!renderer || failed || !t) return false;
    const vd = viewData();
    const ok = t.opening ? moveOpening(String(t.opening), vd) : t.eid ? moveDevice(String(t.eid), vd)
      : t.piece && layer ? layer.move(String(t.piece), (vd.pieces || {})[String(t.piece)]) : false;
    if (ok) { work.moves++; requestRender(); }
    return ok;
  }
  function moveOpening(id, vd){
    const o = vd.openings[id] || null, moves = [];
    // Every wall piece it is drawn in (one split over two walls or more moves
    // whole), each checked before any moves.
    for (const F of floorsUi) for (const P of F.pieces) {
      const pc = P.pc;
      if ((pc.kind !== "door" && pc.kind !== "window") || (pc.added ? pc.added !== id : !(pc.barrier && pc.barrier.id === id))) continue;
      // Its heights as the draft gives them (spliceOpening, applyOpenings).
      const bare = { ...pc, sill_m: undefined, head_m: undefined };
      const next = pc.added ? (o ? { ...pc, sill_m: o.sill_m, head_m: o.head_m } : null) : o ? DRAFT.overrideOpening(bare, o) : bare;
      if (!next) return false;
      const els = HOUSE.wallElements(next, F.fl.h);
      if (els.length !== P.els.length || els.some((e, i) => e.glass !== P.els[i].glass)) return false;
      moves.push({ F, P, next, els });
    }
    for (const { F, P, next, els } of moves) {
      els.forEach((e, i) => { P.els[i].z0 = e.z0; P.els[i].z1 = e.z1; });
      P.pc.sill_m = next.sill_m; P.pc.head_m = next.head_m;
      placePiece(F, P, !!P.cut);
    }
    return moves.length > 0;
  }
  function moveDevice(eid, vd){
    const L = lights.find(x => x.eid === eid);
    if (L) {
      // Moved whole, as liftParts moves it: bulbs, housings, glows, where a
      // press finds it and where its lamp hangs.
      if (typeof L.z !== "number" || !L.look) return false;
      const F = L.F, st = vd.lights[eid], want = st && typeof st.z_m === "number" && Number.isFinite(st.z_m) ? st.z_m : null;
      const z = want === null ? L.zDefault : DRAFT.clampHeight(want, F.fl.h - HOUSE.SLAB_T), d = z - L.z;
      for (const r of L.refs.bulbs) r.m.elements[13] += d;
      for (const r of L.refs.houses) {
        r.hh.h += d;
        F.houses.setMatrixAt(r.i, compose(r.hh.x, F.fl.elev + r.hh.h, r.hh.y, r.hh.yaw, r.hh.sx, r.hh.sy, r.hh.sz));
        F.houses.instanceMatrix.needsUpdate = true;
      }
      for (const r of L.refs.halos) {
        const a = F.halos[r.cls].geometry.attributes.position;
        a.setY(r.i, a.getY(r.i) + d);
        a.needsUpdate = true;
      }
      for (const v of L.pick) v.y += d;
      L.lamp.y += d; L.z = z; lampsDirty = true;
      paintLight(L);
      return true;
    }
    const S = sensorsUi.find(x => x.eid === eid);
    if (!S) return false;
    S.z = HOUSE.deviceZ(S.kind, S.F.fl.h - HOUSE.SLAB_T, vd.devices[eid] || null);
    S.pos.y = S.F.fl.elev + S.z;
    if (S.mesh) { S.mesh.setMatrixAt(S.i, compose(S.x, S.pos.y, S.y, 0, 0.055, 0.04, 0.055)); S.mesh.instanceMatrix.needsUpdate = true; }
    if (S.sprite) S.sprite.position.copy(S.pos);
    return true;
  }

  // ── P8 atmosphere: the Showcase look, rain and snow ───────────────────────
  /** The Atlas's Showcase look as this view's lighting: the background and
   *  its haze, the sky, the tiles' colour and the lights' glow
   *  (live_aboard_showcase.js; Classic is today's look). A change draws the
   *  tiles, the sky and the glow again. */
  function applyLook(p){
    const key = LOOKS && p.showcase3d === true && p.showcase && p.showcase.key ? String(p.showcase.key) : "classic";
    if (key === lookKey) return;
    lookKey = key;
    theme3d = LOOKS ? LOOKS.lookOf(key) : null;
    const bg = theme3d ? theme3d.bg : BG;
    renderer.setClearColor(bg, 1);
    scene.background.set(bg);
    scene.fog.color.set(bg);
    shellSig = null;                                         // the tiles and the lights, built again with it
    if (sunNow) drawSun(bearingNow(), true);
    requestRender();
  }
  /** Rain and snow (live_aboard_weather.js): the flat Atlas's own decision,
   *  from the host's own weather inputs, only while Rain and snow is on
   *  (settings.atlas_3d_weather: on unless false). Off, none of it is made,
   *  and what was showing is let go of. Never the view's failure: weather
   *  that cannot be drawn is simply not drawn. */
  function applyWeather(p){
    const w = WEATHER && p.weather3d !== false && p.weather && p.weather.settings ? p.weather : null;
    if (!w) { if (wx) { wx.dispose(); wx = null; requestRender(); } return; }
    try {
      if (!wx) wx = WEATHER.createWeather(THREE, { scene, renderer, camera });
      const changed = wx.update({ settings: w.settings, states: w.states, entities: w.entities, telemetry: w.telemetry,
        // What falls: the flat Atlas's colour for the Showcase theme this view
        // wears (Classic: white), or the look's own where that would not show
        // on its ground (a light theme); what settles: the flat Atlas's.
        colour: lookKey === "classic" ? "#ffffff" : (theme3d && theme3d.weather) || WEATHER.colourOf(p.showcase && p.showcase.theme),
        snowColour: lookKey === "classic" ? "#ffffff" : WEATHER.colourOf(p.showcase && p.showcase.theme),
        profile: quality.profile || quality.measuring || "low", nowMs: Date.now(),
        house: { key: `${shellGen}|${topElev}`, rooms: house.rooms, ground: house.ground - HOUSE.SLAB_T - 0.02,
                 shown: (fl) => HOUSE.floorShown(fl, topElev),
                 walls: () => floorsUi.filter(F => F.group.visible).flatMap(F => F.pieces.map(P => ({ P, F }))) } });
      if (changed) requestRender();
    } catch (_) {
      try { if (wx) wx.dispose(); } catch (__) { /* best effort */ }
      wx = null;
    }
  }

  // ── the slot ──────────────────────────────────────────────────────────────
  function update(p){
    lastP = p;
    applyLook(p);
    const setting = HOUSE.qualitySetting(p.quality);
    // This card's records and api: a press acts through the newest.
    lbe = p.lightsByEid || {};
    apiOf = typeof p.useApi === "function" ? p.useApi : null;
    apiNow = null;
    haStarted = Number(p.haStartedMs) || 0;
    // The map, and what the 3D file adds to it (its doors and windows, its
    // heights): either changing redraws what it touches.
    const vd = viewData();
    const mSig = HOUSE.shellSignature(p.model, p.floors, p.lightsByEid);
    const mlSig = HOUSE.lightsSignature(p.model, p.lightsByEid, p.hidden), mxSig = HOUSE.sensorsSignature(p.model, p.lightsByEid, p.hidden);
    const sSig = mSig + DRAFT.openingsSignature(vd);
    const lSig = mlSig + DRAFT.heightsSignature(vd, "lights");
    const xSig = mxSig + DRAFT.heightsSignature(vd, "devices");
    let rebuilt = false;
    if (sSig !== shellSig || lSig !== lightsSig || xSig !== sensorsSig) {
      // The map is read again only when it changed; the 3D file's doors and
      // windows are cut into a copy of its walls.
      const rSig = [mSig, mlSig, mxSig].join("|");
      if (rSig !== readSig) { reading = HOUSE.readHouse(p.model, p.floors, p.lightsByEid, p.hidden); readSig = rSig; work.reads++; }
      const shell = sSig !== shellSig;
      rebuilt = shell;
      if (shell) { buildShell(DRAFT.applyOpenings(HOUSE.readingCopy(reading), vd.openings)); buildBadges(p); shellSig = sSig; }
      else house = { ...house, lights: reading.lights, sensors: reading.sensors };
      if (shell || lSig !== lightsSig) {
        buildLights(house);
        lightsSig = lSig;
        for (const L of lights) L.key = null;
      }
      if (shell || xSig !== sensorsSig) { buildSensors(house); sensorsSig = xSig; }
      requestRender();
    }
    // Furniture (P2): each piece on its floor, from the draft while editing.
    if (layer && layer.sync(vd.pieces, rebuilt)) requestRender();
    syncDevices(p, vd);
    syncTracked(p, vd, rebuilt);
    paintLights(p.lightsByEid);
    paintLive();
    const t = HOUSE.topFloorElev(house.floors, p.topFloorIds || null);
    if (t !== topElev) { topElev = t; plan.fit = true; applyTop(); requestRender(); }
    applySun(p);
    if (setting !== quality.setting || (!quality.profile && !quality.measuring)) {
      quality.setting = setting; quality.measured = {}; quality.profile = null;
      decideQuality();
    }
    applyWeather(p);
  }
  function place(s){
    if (stage && stage !== s) { try { stage.style.display = ""; } catch (_) { /* the old card is gone */ } }
    stage = s;
    s.style.display = "none";
    if (root.parentNode !== s.parentNode || root.previousSibling !== s) s.parentNode.insertBefore(root, s.nextSibling);
    resize();
    if (dirty) requestRender();
  }

  return {
    get element(){ return root; },
    get failed(){ return failed; },
    /** Show the 3D house in place of the flat stage `s` (a fresh card's
     *  .lv-stage, already in its card). Never throws: false means the flat
     *  Atlas is showing (and why is in .failed). p = {model, floors,
     *  lightsByEid, hidden, topFloorIds, quality, telemetry, onTouch,
     *  states (hass.states, for sun.sun), config (hass.config), bearing
     *  (settings.fabric_bearing_deg), saveNorth(b) → Promise (the compass's
     *  Save: the host writes fabric_bearing_deg alone), useApi() → the
     *  host's use api (what a press acts through), haStartedMs (when Home
     *  Assistant came up: a restart's motion timestamps are no motion),
     *  load() → Promise (house3d_get: the 3D file, part C), edit(changes) →
     *  Promise (house3d_edit: the editor's Save; given only where lights may
     *  be placed, else null and there is no Edit), weather (the host's
     *  {settings, states, entities, telemetry}: the flat Atlas's own weather
     *  inputs), weather3d (settings.atlas_3d_weather: rain and snow unless
     *  false), showcase3d (settings.atlas_3d_showcase: the Showcase look when
     *  true), showcase ({key, theme}: the Showcase theme the flat Atlas
     *  shows, SHOWCASE_THEMES' own entry, only ever read), entities
     *  (hass.entities) and regIds ({registry id: entity id}, the registry
     *  the Atlas already reads): a linked piece follows its renamed entity;
     *  emergency (the Atlas's emergency lights while its test runs, else
     *  null) (P5), people (only while Show people is on: {snapshot()} or
     *  {read(), everyMs}, the live snapshot through the host) (P6), tags
     *  (the same, only while Show tags & scanners is on)}. */
    attach(s, p){
      send = p && p.telemetry;
      touchCb = p && p.onTouch;
      saveNorthCb = p && typeof p.saveNorth === "function" ? p.saveNorth : null;
      try {
        if (failed) { showFlat(); return false; }
        if (!s || !s.parentNode || !p) return false;
        if (!renderer && !start(HOUSE.qualitySetting(p.quality))) return false;
        loadFile(p);
        if (editor) editor.setEdit(typeof p.edit === "function" ? p.edit : null);
        // Mapping → Furnish (P2): the plan beside the 3D view and the Furnish
        // tool open. p.furnish is the host's own for the tool (its flows and
        // "This is a device…"), handed through: the view calls nothing itself.
        furnishP = p.furnish && typeof p.furnish === "object" ? { ...p.furnish, states: p.states || null } : null;
        topCb = typeof p.setTopFloor === "function" ? p.setTopFloor : null;
        setFurnishView(!!furnishP);
        update(p);
        if (editor) editor.setFurnish(!!furnishP);           // after update: a file read needs the card's data
        if (failed) return false;
        place(s);
        return !failed;
      } catch (_) {
        fail("error");
        return false;
      }
    },
    /** Back to the flat Atlas (Map picked, or the feature switched off).
     *  The camera and the GL context stay for a quick return. */
    /** The 3D file changed elsewhere (Settings → Remove all furniture): read
     *  again now while showing, else when the screen is next shown. */
    reload(){ try { fileLoad = null; if (stage && lastP && !failed) loadFile(lastP); } catch (_) { /* read when next shown */ } },
    detach(){ try { fileLoad = null; dirty = true; dropPointers(); cancelNorth(); if (use) use.clear(); if (editor) editor.leave(); showFlat(); } catch (_) { /* nothing to undo */ } },
    /** Something wants this screen to leave 3D (Map picked): with unsaved
     *  3D edits the editor asks first, in the view, and holds (true); `go`
     *  runs once they are saved or discarded. */
    holdLeave(go){ try { return !!(editor && !failed && editor.holdLeave(go)); } catch (_) { return false; } },
    /** The feature is off: the flat Atlas back and the GL context given up. */
    release(){ try { cancelNorth(); showFlat(); teardown(); } catch (_) { /* best effort */ } },
    // A window on it, for the harness and for poking at it from the console.
    _state(){
      return { failed, profile: quality.profile, measuring: quality.measuring, measured: { ...quality.measured }, frames, wallMode, topElev,
               cam: { theta: cam.theta, phi: cam.phi, radius: cam.radius, target: cam.target.toArray(), moved: cam.moved },
               sun: sunNow ? { ...sunNow, intensity: sun.intensity, sky: hemi.intensity, dir: sunDir.toArray() } : null, bearing, rose: roseDeg,
               north: { stored: storedBearing, preview: northPreview, hold: northHold ? northHold.b : null,
                        pill: !!(pill && pill.classList.contains("on")), spinning: !!spin },
               canvas, gl: renderer ? renderer.getContext() : null, lights: lights.length, floors: floorsUi.length,
               walls: floorsUi.reduce((a, F) => a + F.pieces.length, 0),
               // Part B: the live parts and the taps.
               openings: openings.map(({ P }) => ({ eid: P.open.eid, kind: P.open.kind, state: P.open.state, at: P.open.at, to: P.open.to,
                                                     garage: P.open.garage, hinge: P.open.hinge, side: P.open.side, cut: !!P.cut })),
               tints: tints.map(T => ({ room: T.room ? T.room.name : null, motion: T.mLook, air: T.aLook,
                                        fill: T.fillMat.opacity, bars: T.barsMat ? T.barsMat.opacity : null, rings: T.rings.filter(R => R.on).length,
                                        ringsShown: T.rings.filter(R => R.mesh.scale.x > 0).length })),
               readouts: readouts.map(R => ({ eid: R.eid, kind: R.kind, ...(R.shown || {}) })),
               motion: sensorsUi.filter(S => S.kind === "motion").map(S => ({ eid: S.eid, look: S.look || null, col: S.col })),
               badges: badges.map(B => ({ z: B.z, n: B.n, name: B.name, shown: B.F.group.visible })),
               flash: shared ? { color: "#" + shared.flashMat.color.getHexString(), opacity: shared.flashMat.opacity } : null,
               animating: liveMs > 0, liveMs, use: use ? use.state() : null, work: { ...work },
               // What of the host's it still holds (nothing, once switched off).
               held: { card: !!lastP, api: !!(apiOf || apiNow), stage: !!stage, send: !!send, touch: !!touchCb, north: !!saveNorthCb },
               // Part C: the 3D file as drawn.
               file: file ? { openings: Object.keys(file.openings).length, lights: Object.keys(file.lights).length,
                              devices: Object.keys(file.devices).length } : null,
               added: floorsUi.reduce((a, F) => a + F.pieces.filter(P => P.pc.added).length, 0),
               heights: { lights: lights.filter(L => L.z !== L.zDefault).map(L => ({ eid: L.eid, z: L.z, zDefault: L.zDefault })),
                          devices: sensorsUi.filter(S => S.z !== S.zDefault).map(S => ({ eid: S.eid, z: S.z, zDefault: S.zDefault })) },
               edit: editor ? editor.state() : null,
               // P8: the look as drawn, and rain and snow.
               look: scene ? { key: lookKey, bg: "#" + scene.background.getHexString(), fog: "#" + scene.fog.color.getHexString(),
                               sky: "#" + hemi.color.getHexString(), skyI: hemi.intensity, glow: theme3d ? theme3d.glow : 1,
                               ground: ground ? "#" + ground.material.color.getHexString() : null,
                               // Sums the harness compares: every tile's colour, every glow's.
                               tiles: floorsUi.reduce((a, F) => a + (F.tiles ? F.tiles.geometry.attributes.color.array.reduce((s, v) => s + v, 0) : 0), 0),
                               halos: floorsUi.reduce((a, F) => a + Object.values(F.halos || {})
                                 .reduce((s, h) => s + h.geometry.attributes.color.array.reduce((u, v) => u + v, 0), 0), 0) } : null,
               weather: wx ? wx._state() : null,
               // P2 Furnish: the furniture as drawn, and the views.
               pieces: layer ? layer.state() : [], furnish: furnishOn,
               // P5: what each linked piece shows, the fixtures that stepped
               // aside for one, the emergency lights outlined, the real lamps lit.
               devices: devices ? devices.state() : [], swapped: lights.filter(L => L.swap).map(L => L.eid),
               outlined: emOutlines.length, lamps: lampPool.filter(l => l.intensity > 0).map(l => l.position.toArray().map(v => Math.round(v * 100) / 100)),
               // P6: scanners, beacons and people as drawn, and how often the snapshot was read.
               tracked: tracked ? tracked.state() : [], peopleReads,
               split: furnishOn ? (viewports().plan ? (viewports().d3 ? "both" : "plan") : "3d") : null, plan: { ...plan } };
    },
    /** The Furnish tool (the harness builds a piece of any kind through it). */
    _furnish(){ return editor ? editor.furnish : null; },
    /** A piece's middle (dz metres above its bottom) on screen, in the 3D view or the plan. */
    _wherePiece(id, dz = 0.3, inPlan = false){
      const r = layer && layer.rootOf(id), vp = inPlan ? viewports().plan : viewports().d3;
      if (!r || !vp) return null;
      if (inPlan) fitPlan();
      const c = inPlan ? planCam : camera, rect = rectOf(vp), v = r.position.clone();
      v.y += dz;
      c.updateMatrixWorld();
      v.project(c);
      return [rect.left + (v.x + 1) / 2 * rect.width, rect.top + (1 - v.y) / 2 * rect.height];
    },
    /** The weather (the harness reads its drops). */
    _weather(){ return wx; },
    /** A door or window as drawn (its barrier's id, or a 3D one's): its parts, bottom to top. */
    _piece(id){
      for (const F of floorsUi) for (const P of F.pieces) {
        if (P.pc.added === id || (!P.pc.added && P.pc.barrier && P.pc.barrier.id === id)) {
          return { kind: P.pc.kind, els: P.els.map(e => [e.z0, e.z1, !!e.glass]) };
        }
      }
      return null;
    },
    /** The same, for every wall piece it is drawn in (split over two walls: two). */
    _pieces(id){
      return floorsUi.flatMap(F => F.pieces.filter(P => P.pc.added === id || (!P.pc.added && P.pc.barrier && P.pc.barrier.id === id))
        .map(P => ({ kind: P.pc.kind, els: P.els.map(e => [e.z0, e.z1, !!e.glass]) })));
    },
    /** A plan point on floor `fid`, z metres up, in client px (the harness draws there). */
    _whereOf(fid, x, y, z = 1, inPlan = false){
      if (!inPlan) return editor ? editor.whereOf(fid, x, y, z) : null;
      const F = floorsUi.find(q => q.fl.id === fid), vp = viewports().plan;
      if (!F || !vp) return null;
      fitPlan();
      const rect = rectOf(vp), v = new THREE.Vector3(x, F.fl.elev + z, y).project(planCam);
      return [rect.left + (v.x + 1) / 2 * rect.width, rect.top + (1 - v.y) / 2 * rect.height];
    },
    /** Put the camera somewhere (the harness frames a shot). */
    _look(theta, phi, target, radius){
      cam.moved = true; cam.needsFit = false;
      cam.theta = theta; cam.phi = Math.max(MIN_PHI, Math.min(MAX_PHI, phi)); cam.target.fromArray(target); cam.radius = radius;
      applyCam();
    },
    /** Where something is on screen, in client px (the harness presses it):
     *  {eid} a device's nearest point, {room}, {door: eid}, {floor: z},
     *  {tracked: key} a tag or a scanner (P6). */
    _where(q){
      if (!renderer || !camera) return null;
      const rect = view3Rect(), at = (v) => screenPt(v, rect);
      camera.updateMatrixWorld();
      if (q.floor !== undefined) { const B = badges.find(x => x.z === String(q.floor)); return B ? at(B.pos) : null; }
      if (q.room) {
        for (const F of floorsUi) {
          const i = F.rooms.findIndex(r => r.name === q.room);
          if (i >= 0) return at(F.labels[i].position);
        }
        return null;
      }
      if (q.door) {
        const o = openings.find(x => x.P.open.eid === q.door);
        if (!o) return null;
        const v = openingQuad(o.F, o.P);
        return at(v[0].clone().add(v[2]).multiplyScalar(0.5));
      }
      const L = lights.find(x => x.eid === q.eid);
      if (L && L.pick && L.pick.length) {
        const c = L.pick.reduce((a, v) => a.add(v), new THREE.Vector3()).multiplyScalar(1 / L.pick.length);
        return at(L.pick.reduce((b, v) => (v.distanceTo(c) < b.distanceTo(c) ? v : b)));
      }
      if (q.tracked) { const T = (tracked ? tracked.pickable() : []).find(x => x.key === q.tracked); return T ? at(T.at) : null; }
      const S = sensorsUi.find(x => x.eid === q.eid);
      return S ? at(S.pos) : null;
    },
    _pick(x, y){
      const r = pickAt(x, y);
      return r && { hit: r.hit.key, under: r.under.map(u => u.key) };
    },
  };
}
