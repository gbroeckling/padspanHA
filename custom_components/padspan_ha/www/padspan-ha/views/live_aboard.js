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

const THREE = await import(`../vendor/three/three.module.min.js${new URL(import.meta.url).search}`);
const HOUSE = await import(`./live_aboard_house.js${new URL(import.meta.url).search}`);

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
@keyframes la3d-toast{0%{opacity:0;visibility:visible}5%{opacity:1}85%{opacity:1;visibility:visible}100%{opacity:0;visibility:hidden}}`;

const _slots = new Map();
/** One 3D view per screen ("atlas" — the sidebar; "builder" — Mapping). */
export function liveAboardSlot(key){
  const k = String(key || "atlas");
  if (!_slots.has(k)) _slots.set(k, createSlot(k));
  return _slots.get(k);
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
  let frames = 0, pending = false, dirty = true, visible = true;
  // The house, as drawn: shell (floors, rooms, walls) and fixtures.
  let shellSig = null, lightsSig = null, house = null, floorsUi = [], lights = [];
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
  // Shared, made once per slot.
  let shared = null;
  let hemi = null, sun = null, lampPool = [], lampsDirty = true, ground = null, gridLines = null;
  const lampTarget = new THREE.Vector3(Infinity, 0, 0);

  // ── failing back to the flat Atlas ────────────────────────────────────────
  function showFlat(){
    try { if (stage) stage.style.display = ""; } catch (_) { /* gone with its card */ }
    stage = null;
    try { if (root && root.parentNode) root.parentNode.removeChild(root); } catch (_) { /* already out */ }
  }
  function teardown(){
    try { endSpin(false); hidePill(); } catch (_) { /* nothing to undo */ }
    for (const o of observers) { try { o(); } catch (_) { /* gone */ } }
    observers = [];
    disposeList(shellRes); disposeList(lightRes);
    shellRes = []; lightRes = [];
    // Give the GPU its context back: the flat Atlas needs none.
    try { if (renderer) { renderer.dispose(); if (failed !== "context_lost") renderer.forceContextLoss(); } } catch (_) { /* best effort */ }
    renderer = null; scene = null; house = null; floorsUi = []; lights = [];
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
      gl = canvas.getContext("webgl2", { antialias: setting !== "low", alpha: false, depth: true, stencil: false,
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
    canvas.setAttribute("aria-label", "The house in 3D");
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
      bulbMat: new THREE.MeshBasicMaterial({ color: 0xffffff }),
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
        const top = colorOf(r.color).lerp(new THREE.Color(TILE_MIX), r.outdoor ? 0.5 : 0.38);
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
        const L = Math.hypot(pc.x1 - pc.x0, pc.y1 - pc.y0);
        if (L < 0.02) continue;
        const ext = pc.kind === "wall" || pc.kind === "rail" ? pc.thick / 2 : 0;   // overlap at corners so joints close
        const els = HOUSE.wallElements(pc, fl.h).map(e => ({ ...e, list: e.glass ? glasses : solids }));
        for (const e of els) { e.i = e.list.length; e.list.push(e); }
        F.pieces.push({ pc, mx: (pc.x0 + pc.x1) / 2, my: (pc.y0 + pc.y1) / 2, yaw: HOUSE.yawOf([pc.x1 - pc.x0, pc.y1 - pc.y0]),
                        len: L + 2 * ext, els, cut: null, lights: [] });
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
      for (const P of F.pieces) placePiece(F, P, false);
      F.ao = aoMesh(F);
      if (F.ao) group.add(F.ao);
    }
    // The ground and the sun, sized to the house.
    const cx = (houseBox.x0 + houseBox.x1) / 2, cy = (houseBox.y0 + houseBox.y1) / 2;
    const sx = houseBox.x1 - houseBox.x0, sy = houseBox.y1 - houseBox.y0;
    const groundY = h.ground - HOUSE.SLAB_T - 0.02;
    const gGeo = new THREE.CircleGeometry(420, 72).rotateX(-Math.PI / 2);
    ground = lit(gGeo, { c: "#18201c", r: 1 }, false, true);
    ground.position.set(cx, groundY, cy);
    const span = Math.ceil(Math.max(sx, sy) / 2 + 30) * 2;
    gridLines = new THREE.GridHelper(span, span / 2, 0x2b3730, 0x202a25);
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
      if (!path.includes(pill) && !path.includes(compassEl)) cancelNorth();
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
  // A wall piece's instances at full height, or cut down to CUT_H.
  function placePiece(F, P, cut){
    for (const e of P.els) {
      const z1 = cut && e.cuttable ? Math.min(e.z1, HOUSE.CUT_H) : e.z1, hgt = z1 - e.z0;
      e.mesh.setMatrixAt(e.i, hgt < 0.005 ? ZERO : compose(P.mx, F.fl.elev + e.z0, P.my, P.yaw, P.len, hgt, e.thick));
      e.mesh.instanceMatrix.needsUpdate = true;
    }
  }

  // ── the lights ────────────────────────────────────────────────────────────
  function clearLights(){
    for (const F of floorsUi) { if (F.lightGroup) F.group.remove(F.lightGroup); F.lightGroup = null; for (const P of F.pieces) P.lights = []; }
    disposeList(lightRes); lightRes = [];
    lights = [];
  }
  function buildLights(h){
    clearLights();
    for (const F of floorsUi) {
      // By id: a lights-only rebuild reads the floors afresh (same ids).
      const mine = h.lights.filter(L => L.floor.id === F.fl.id);
      if (!mine.length) continue;
      const lg = new THREE.Group();
      F.lightGroup = lg;
      F.group.add(lg);
      const bulbs = { puck: [], dome: [], box: [], sphere: [] }, houses = [], halos = { s: [], m: [], l: [] }, pools = [];
      const ctx = { rooms: F.rooms, pieces: F.pieces.map(P => P.pc), ground: h.ground };
      for (const L0 of mine) {
        const parts = HOUSE.fixtureParts(L0, ctx);
        const L = { ...L0, F, kf: parts.kf, wall: null, refs: { bulbs: [], halos: [], pool: null }, key: null, look: null };
        if (parts.wall) { const P = F.pieces.find(q => q.pc === parts.wall); if (P) { L.wall = P; P.lights.push(L); } }
        let sx = 0, sy = 0, sh = 0;
        for (const b of parts.bulbs) {
          const m = compose(b.x, F.fl.elev + b.h, b.y, b.yaw, b.sx, b.sy, b.sz).clone();
          L.refs.bulbs.push({ prim: b.prim, i: bulbs[b.prim].length, off: new THREE.Color(b.off), m });
          bulbs[b.prim].push({ m, off: b.off });
          sx += b.x; sy += b.y; sh += b.h;
        }
        for (const hh of parts.housings) houses.push(hh);
        for (const hl of parts.halos) { L.refs.halos.push({ cls: hl.cls, i: halos[hl.cls].length }); halos[hl.cls].push(hl); }
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
        lg.add(im);
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
    const F = L.F, k = L.look, on = k.on, hidden = !!(L.wall && L.wall.cut);
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
      const attr = F.halos[r.cls].geometry.attributes.color, g = on && !hidden ? k.f * 0.95 : 0;
      attr.setXYZ(r.i, c.r * g, c.g * g, c.b * g);
      attr.needsUpdate = true;
    }
    if (L.refs.pool !== null && F.pool) {
      const g = on ? k.f * 0.34 : 0;
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
    const cands = lights.filter(L => L.look && L.look.on && L.kf > 0 && L.F.group.visible)
      .sort((a, b) => a.lamp.distanceToSquared(cam.target) - b.lamp.distanceToSquared(cam.target));
    lampPool.forEach((pl, i) => {
      const L = i < n ? cands[i] : null;
      if (!L) { pl.intensity = 0; return; }
      pl.position.copy(L.lamp);
      pl.color.copy(L.color);
      pl.intensity = LAMP_I * L.f * L.kf;
    });
  }

  // ── floors, walls, quality ────────────────────────────────────────────────
  function applyTop(){
    for (const F of floorsUi) F.group.visible = HOUSE.floorShown(F.fl, topElev);
    lampsDirty = true;
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
    const r = canvas.getBoundingClientRect();
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
    let mode = null, last = null, pinch = null;
    const mid = () => { const [a, b] = [...pts.values()]; return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, d: Math.hypot(a.x - b.x, a.y - b.y) }; };
    canvas.addEventListener("pointerdown", guard((e) => {
      if (spin) endSpin(true);                               // a finger on the house: no spin
      if (typeof touchCb === "function") { try { touchCb(); } catch (_) { /* the card's, not ours */ } }
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      try { canvas.setPointerCapture(e.pointerId); } catch (_) { /* fine */ }
      if (pts.size === 2) { mode = "pinch"; pinch = mid(); return; }
      mode = e.pointerType === "mouse" && (e.button === 2 || e.button === 1 || e.shiftKey || e.ctrlKey || e.metaKey) ? "pan" : "orbit";
      last = { x: e.clientX, y: e.clientY };
    }));
    canvas.addEventListener("pointermove", guard((e) => {
      if (!pts.has(e.pointerId)) return;
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (mode === "pinch" && pts.size === 2) {
        const now = mid();
        if (pinch.d > 0 && now.d > 0) zoomAt(now.x, now.y, pinch.d / now.d);
        panBy(pinch.x, pinch.y, now.x, now.y);
        pinch = now;
        e.preventDefault();
        return;
      }
      if (!last) return;
      if (mode === "orbit") orbitBy(e.clientX - last.x, e.clientY - last.y);
      else if (mode === "pan") panBy(last.x, last.y, e.clientX, e.clientY);
      last = { x: e.clientX, y: e.clientY };
    }));
    const lift = guard((e) => {
      pts.delete(e.pointerId);
      try { canvas.releasePointerCapture(e.pointerId); } catch (_) { /* fine */ }
      if (pts.size === 1) {                                  // one finger left of a pinch: carry on turning from it
        const [p] = [...pts.values()];
        mode = "orbit"; last = { x: p.x, y: p.y }; pinch = null;
      } else if (!pts.size) { mode = null; last = null; pinch = null; }
    });
    canvas.addEventListener("pointerup", lift);
    canvas.addEventListener("pointercancel", lift);
    canvas.addEventListener("contextmenu", (e) => e.preventDefault());
    canvas.addEventListener("wheel", guard((e) => {
      e.preventDefault();
      const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaMode === 2 ? e.deltaY * 400 : e.deltaY;
      zoomAt(e.clientX, e.clientY, Math.exp(Math.max(-200, Math.min(200, dy)) * 0.0015));
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
  function fit(theta = cam.theta, phi = cam.phi){
    const dir = new THREE.Vector3(Math.sin(phi) * Math.sin(theta), Math.cos(phi), Math.sin(phi) * Math.cos(theta));
    const pts = visiblePoints(), box = new THREE.Box3().setFromPoints(pts), c = box.getCenter(new THREE.Vector3());
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
      return;
    }
    if (cam.needsFit && (canvas.clientWidth || 0) > 0) preset("iso");
    updateCutaway();
    for (const F of floorsUi) if (F.group.visible) for (const l of F.labels) l.rotation.set(-Math.PI / 2, cam.theta, 0, "YXZ");
    if (lampsDirty || lampTarget.distanceToSquared(cam.target) > 1) assignLamps();
    renderer.render(scene, camera);
    paintCompass();
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
  });
  function resize(){
    if (!renderer || !root) return;
    const w = root.clientWidth, h = root.clientHeight;
    if (!w || !h) return;                                    // detached for a moment between two cards
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
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

  // ── the slot ──────────────────────────────────────────────────────────────
  function update(p){
    const setting = HOUSE.qualitySetting(p.quality);
    const sSig = HOUSE.shellSignature(p.model, p.floors);
    const lSig = HOUSE.lightsSignature(p.model, p.lightsByEid, p.hidden);
    if (sSig !== shellSig || lSig !== lightsSig) {
      const h = HOUSE.readHouse(p.model, p.floors, p.lightsByEid, p.hidden);
      if (sSig !== shellSig) { buildShell(h); shellSig = sSig; }
      else house = { ...house, lights: h.lights };
      buildLights(h);
      lightsSig = lSig;
      for (const L of lights) L.key = null;
      requestRender();
    }
    paintLights(p.lightsByEid);
    const t = HOUSE.topFloorElev(house.floors, p.topFloorIds || null);
    if (t !== topElev) { topElev = t; applyTop(); requestRender(); }
    applySun(p);
    if (setting !== quality.setting || (!quality.profile && !quality.measuring)) {
      quality.setting = setting; quality.measured = {}; quality.profile = null;
      decideQuality();
    }
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
     *  Save: the host writes fabric_bearing_deg alone)}. */
    attach(s, p){
      send = p && p.telemetry;
      touchCb = p && p.onTouch;
      saveNorthCb = p && typeof p.saveNorth === "function" ? p.saveNorth : null;
      try {
        if (failed) { showFlat(); return false; }
        if (!s || !s.parentNode || !p) return false;
        if (!renderer && !start(HOUSE.qualitySetting(p.quality))) return false;
        update(p);
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
    detach(){ try { cancelNorth(); showFlat(); } catch (_) { /* nothing to undo */ } },
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
               walls: floorsUi.reduce((a, F) => a + F.pieces.length, 0) };
    },
  };
}
