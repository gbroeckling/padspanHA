// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
// See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
//
// Live Aboard's rain and snow (docs/IDEA_ATLAS_3D_HOUSE.md, P8 atmosphere).
// The decision is the flat Atlas's own (atlas_weather.js: the same settings,
// decideAtlasWeather and holdVisual, never a copy of the rules); this file
// only draws it in the 3D house: falling OUTSIDE the walls, around the house
// and onto decks and patios, never inside an indoor room and never under a
// roof. Light rain is a sparse, slow, near-vertical drizzle; heavy rain a
// denser, faster sheet on a 17° wind with splashes on the ground; light snow
// slow flakes swaying gently; heavy snow denser, and on a snowfall warning a
// white layer builds over ~8 s on the roof line, the decks and the ground
// hugging the house.
//
// Everything that moves is moved by the GPU: each layer is one draw whose
// material holds the time, and every drop, flake and splash works out where
// it is from that and its own fixed numbers. Nothing is done per particle on
// the CPU per frame: the view hands over its clock on its own live clock,
// capped (frameMs). Dry, or switched off, nothing is built and nothing is
// drawn. prefers-reduced-motion: the same weather as a still picture.
//
// THREE is handed in by the view (the bundled build it already holds): this
// file imports no three.js, so node runs it as it is.

const AW = await import(`./atlas_weather.js${new URL(import.meta.url).search}`);

const D2R = Math.PI / 180;
// The way the wind blows across the plan (a unit vector in plan x, y): one
// fixed way, so turning the camera never turns the rain.
export const WIND = Object.freeze([-0.6, 0.8]);
const FADE_IN_MS = 3000, FADE_OUT_MS = 2500, SETTLE_MS = 8000;   // the flat Atlas's own timings
const GAP = 0.3;                     // m kept clear of every indoor wall, like the flat Atlas's feathered gap
const SKY = 2.5;                     // m above the highest floor that shows: where it starts falling
const A_REF = 1800;                  // m²: a patch this big or bigger gets the whole budget
// A view this big (CSS px) draws every drop built; a smaller one fewer of the
// same ones, down to a quarter, so light rain is as light on a phone.
const REF_PX = 1600 * 900, MIN_SHARE = 0.25;
const WRAP_S = 3600;                 // the shader's clock wraps hourly (float precision on a wall PC up for days)
const STILL_S = 7.3;                 // the moment a still picture shows
const CAP_H = 0.06, SETTLE_OP = 0.85, APRON_OP = 0.6, APRON_PAD = 2.4, APRON_BLUR = 1.2;
const SNOW_SHADE = 0.86;             // settled snow: the weather's colour a little greyer, never a glare

/** The layers. rain: speed m/s, len the streak (m), width (CSS px), op the
 *  streak's brightest alpha at strength 1. snow: size the flake (m), sway its
 *  gentle side-to-side (m). angle: the wind, degrees off vertical. */
export const LAYERS = Object.freeze({
  drizzle:  Object.freeze({ kind: "rain", angle: 3,  speed: 5.5, len: 0.55, width: 2.0, op: 0.6 }),
  downpour: Object.freeze({ kind: "rain", angle: 17, speed: 11,  len: 1.05, width: 1.7, op: 0.5 }),
  splash:   Object.freeze({ kind: "rain", angle: 0,  op: 0.7 }),
  flurry:   Object.freeze({ kind: "snow", angle: 3,  speed: 0.85, size: 0.09, sway: 0.28, op: 0.92 }),
  blizzard: Object.freeze({ kind: "snow", angle: 9,  speed: 1.3,  size: 0.07, sway: 0.38, op: 0.85 }),
});
/** Particles per layer by quality: Low a few thousand at most. */
export const BUDGET = Object.freeze({
  low:  Object.freeze({ drizzle: 900,  downpour: 3000, splash: 100, flurry: 1400, blizzard: 1600 }),
  high: Object.freeze({ drizzle: 2200, downpour: 7500, splash: 300, flurry: 3000, blizzard: 4500 }),
});
/** The view's live clock while it shows (ms between frames). The view draws
 *  a frame once (liveMs - 4) ms have passed since the last, so 19 keeps rain
 *  on High at 60 a second or under at 60, 90, 120, 144 and 240 Hz, and 36
 *  keeps everything else at 30 or under. */
export const FRAME_MS = Object.freeze({ rain: Object.freeze({ low: 36, high: 19 }), snow: Object.freeze({ low: 36, high: 36 }) });
export const CAPS_FPS = Object.freeze({ rain: Object.freeze({ low: 30, high: 60 }), snow: Object.freeze({ low: 30, high: 30 }) });
const NAMES = ["drizzle", "downpour", "splash", "flurry", "blizzard", "settle"];
const FALLING = NAMES.filter(n => n !== "settle");

/** Which layers draw what is shown ({kind, heavy, rim}, holdVisual's answer). */
export function layersFor(v){
  if (!v || (v.kind !== "rain" && v.kind !== "snow")) return [];
  if (v.kind === "rain") return v.heavy ? ["downpour", "splash"] : ["drizzle"];
  return v.heavy ? ["flurry", "blizzard", ...(v.rim ? ["settle"] : [])] : ["flurry"];
}
/** The flat Atlas's weather colour for a Showcase theme (its washStops). */
export const colourOf = (theme) => AW.weatherColourOf(theme);
const same = (a, b) => a.kind === b.kind && !!a.heavy === !!b.heavy && !!a.rim === !!b.rim;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

// ── Where it falls (pure: plan metres, x right, y down the plan) ────────────
function bboxOf(P){
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of P) { x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]); x1 = Math.max(x1, p[0]); y1 = Math.max(y1, p[1]); }
  return { x0, y0, x1, y1 };
}
export function inPoly(x, y, P){
  let c = false;
  for (let i = 0, j = P.length - 1; i < P.length; j = i++) {
    const a = P[i], b = P[j];
    if ((a[1] > y) !== (b[1] > y) && x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0]) c = !c;
  }
  return c;
}
/** Inside the outline, or within g of one of its edges. */
function nearPoly(x, y, R, g){
  const b = R.bb;
  if (x < b.x0 - g || x > b.x1 + g || y < b.y0 - g || y > b.y1 + g) return false;
  const P = R.pts;
  if (inPoly(x, y, P)) return true;
  for (let i = 0, j = P.length - 1; i < P.length; j = i++) {
    const ax = P[j][0], ay = P[j][1], dx = P[i][0] - ax, dy = P[i][1] - ay, L = dx * dx + dy * dy;
    const t = L > 0 ? clamp(((x - ax) * dx + (y - ay) * dy) / L, 0, 1) : 0;
    const ex = ax + dx * t - x, ey = ay + dy * t - y;
    if (ex * ex + ey * ey < g * g) return true;
  }
  return false;
}

/** The patch of sky the weather falls through, from the house as the view
 *  reads it: h = {rooms: [{pts, outdoor, floor: {elev, h}}], ground (the
 *  drawn ground's height), shown(floor) → whether the floor chips show it}.
 *   indoor   every indoor room on EVERY floor: nothing falls on or through
 *            one (the cut-away house has no roof), whatever the chips show
 *   decks    outdoor rooms on floors that show (decks, patios, a yard's
 *            plates): what falls there lands on them, the highest first
 *   patches  a round patch round the house, its edge fading out, and a
 *            patch of its own for any deck or yard beyond it
 *   tops     the indoor rooms' floors that show, at their height: what
 *            falls is never drawn over one (the view's stencil)
 *   top      where it starts falling: above the highest floor that shows
 *  null when there is no house to rain round. */
export function weatherArea(h){
  const shown = h && typeof h.shown === "function" ? h.shown : () => true;
  const indoor = [], decks = [], tops = [];
  let box = null, top = -Infinity;
  const grow = (b, q) => (b ? { x0: Math.min(b.x0, q.x0), y0: Math.min(b.y0, q.y0), x1: Math.max(b.x1, q.x1), y1: Math.max(b.y1, q.y1) } : { ...q });
  for (const r of (h && h.rooms) || []) {
    if (!r || !r.floor || !Array.isArray(r.pts) || r.pts.length < 3) continue;
    const bb = bboxOf(r.pts);
    if (![bb.x0, bb.y0, bb.x1, bb.y1].every(Number.isFinite)) continue;
    if (!r.outdoor) { indoor.push({ pts: r.pts, bb }); box = grow(box, bb); }
    if (!shown(r.floor)) continue;
    const elev = Number(r.floor.elev) || 0;
    if (r.outdoor) decks.push({ pts: r.pts, bb, y: elev });
    else tops.push({ pts: r.pts, y: elev });
    top = Math.max(top, elev + (r.outdoor ? 1 : (Number(r.floor.h) || 2.8)));
  }
  if (!box) for (const d of decks) box = grow(box, d.bb);       // a garden alone still gets its weather
  if (!box) return null;
  const ground = Number.isFinite(h.ground) ? h.ground : 0;
  const sx = box.x1 - box.x0, sy = box.y1 - box.y0, cx = (box.x0 + box.x1) / 2, cy = (box.y0 + box.y1) / 2;
  const r = Math.hypot(sx, sy) / 2 + clamp(0.25 * Math.max(sx, sy), 6, 12);
  const patches = [{ disc: true, cx, cy, r, area: Math.PI * r * r }];
  for (const d of decks) {
    const b = d.bb, far = [[b.x0, b.y0], [b.x1, b.y0], [b.x1, b.y1], [b.x0, b.y1]].some(([x, y]) => Math.hypot(x - cx, y - cy) > r * 0.72);
    if (!far) continue;
    const q = { x0: b.x0 - 1.5, y0: b.y0 - 1.5, x1: b.x1 + 1.5, y1: b.y1 + 1.5 };
    patches.push({ ...q, area: (q.x1 - q.x0) * (q.y1 - q.y0) });
  }
  top = Math.max(Number.isFinite(top) ? top : ground + 3, ground + 3) + SKY;
  // Every indoor room's box together: a fall nowhere near it is clear at once.
  let ib = null;
  for (const R of indoor) ib = grow(ib, R.bb);
  return { cx, cy, r, top, ground, indoor, ib, decks, tops, patches, box, area: patches.reduce((a, p) => a + p.area, 0) };
}
/** Where something falling at (x, y) lands: the highest deck that shows
 *  there, else the ground. */
export function landingAt(A, x, y){
  let y0 = A.ground;
  for (const d of A.decks) if (d.y > y0 && x >= d.bb.x0 && x <= d.bb.x1 && y >= d.bb.y0 && y <= d.bb.y1 && inPoly(x, y, d.pts)) y0 = d.y;
  return y0;
}
/** Is the whole fall clear: from where it lands, (dx, dy) up-wind at the
 *  top, H metres up — never within g of an indoor room (at any height), and
 *  never through a raised deck above it. */
export function clearPath(A, x, y, land, dx, dy, H, g){
  const steps = Math.max(2, Math.ceil(Math.hypot(dx, dy) / 0.4)), b = A.ib;
  const nearHouse = !!b && !(Math.max(x, x + dx) < b.x0 - g || Math.min(x, x + dx) > b.x1 + g
    || Math.max(y, y + dy) < b.y0 - g || Math.min(y, y + dy) > b.y1 + g);
  for (let i = 0; i <= steps; i++) {
    const s = i / steps, px = x + dx * s, py = y + dy * s, z = land + H * s;
    if (nearHouse) for (const R of A.indoor) if (nearPoly(px, py, R, g)) return false;
    for (const d of A.decks) if (d.y > z + 0.05 && nearPoly(px, py, d, 0.05)) return false;
  }
  return true;
}
/** How many of a layer this house gets: the budget, less for a small patch. */
export function countFor(A, name, profile){
  const b = (BUDGET[profile] || BUDGET.low)[name] || 0;
  return Math.round(b * clamp((A ? A.area : 0) / A_REF, 0.3, 1));
}
/** n drops (or flakes, or splashes) that fall clear: seeded, so the same
 *  house always gets the same ones. pos: [x, y, landing height, phase] each;
 *  vars: [speed k, size k, edge fade] each. */
export function spawnLayer(A, name, n, seed){
  const L = LAYERS[name] || {};
  const rnd = AW.seededRandom(seed);
  const tanA = Math.tan((L.angle || 0) * D2R), g = GAP + (L.sway || 0);
  const pos = new Float32Array(n * 4), vars = new Float32Array(n * 3);
  let k = 0;
  if (!A || !(n > 0)) return { pos: pos.slice(0, 0), vars: vars.slice(0, 0), n: 0 };
  for (let tries = 0; k < n && tries < n * 40; tries++) {
    let u = rnd() * A.area, P = A.patches[0];
    for (const q of A.patches) { if (u < q.area) { P = q; break; } u -= q.area; }
    let x, y, fade = 1;
    if (P.disc) {
      const rr = P.r * Math.sqrt(rnd()), a = rnd() * 2 * Math.PI;
      x = P.cx + rr * Math.cos(a); y = P.cy + rr * Math.sin(a);
      fade = 1 - smooth(0.72, 1, rr / P.r);
    } else { x = P.x0 + rnd() * (P.x1 - P.x0); y = P.y0 + rnd() * (P.y1 - P.y0); }
    const land = landingAt(A, x, y), H = Math.max(0.5, A.top - land);
    if (!clearPath(A, x, y, land, -WIND[0] * tanA * H, -WIND[1] * tanA * H, H, g)) continue;
    pos[k * 4] = x; pos[k * 4 + 1] = y; pos[k * 4 + 2] = land; pos[k * 4 + 3] = rnd();
    vars[k * 3] = 0.8 + rnd() * 0.4; vars[k * 3 + 1] = 0.75 + rnd() * 0.5; vars[k * 3 + 2] = fade;
    k++;
  }
  return { pos: pos.slice(0, k * 4), vars: vars.slice(0, k * 3), n: k };
}
/** The roof line: each outside wall's top that no room on a higher floor
 *  that shows covers. walls = [{P, F}] as the view draws them. */
export function roofLine(walls, rooms, shown = () => true){
  const out = [];
  for (const w of walls || []) {
    const P = w && w.P, F = w && w.F, pc = P && P.pc;
    if (!pc || !F || !F.fl || F.fl.outdoor || pc.cls !== "ext" || pc.kind === "rail" || pc.kind === "open") continue;
    const top = P.els && P.els.length ? P.els[P.els.length - 1].z1 : 0;
    if (!(top > 1)) continue;
    const mx = (pc.x0 + pc.x1) / 2, my = (pc.y0 + pc.y1) / 2;
    const covered = (rooms || []).some(r => r && !r.outdoor && r.floor && Array.isArray(r.pts) && r.floor.elev > F.fl.elev + 0.5
      && shown(r.floor) && inPoly(mx, my, r.pts));
    if (!covered) out.push({ P, F, top });
  }
  return out;
}

// ── The shaders: the GPU moves everything ────────────────────────────────────
// A drop: a streak from its tail (nothing) to its head (brightest), as wide
// on screen as the layer says, falling from the top to where it lands and
// draining into it. The wind carries it: it lands at its own spot, so the
// top of its fall is up-wind of it.
const RAIN_VS = `
uniform float uTime, uTop, uSpeed, uLen, uWidth, uOpacity;
uniform vec2 uView, uWind;
attribute vec4 aDrop;
attribute vec3 aVar;
varying float vA;
void main(){
  float land = aDrop.z, H = max(uTop - land, 0.5), len = uLen * aVar.y, run = H + len;
  float lead = uTop - fract(aDrop.w + uTime * uSpeed * aVar.x / run) * run;
  float yH = max(land, lead), yT = clamp(lead + len, land, uTop);
  vec3 head = vec3(aDrop.x - uWind.x * (yH - land), yH, aDrop.y - uWind.y * (yH - land));
  vec3 tail = vec3(aDrop.x - uWind.x * (yT - land), yT, aDrop.y - uWind.y * (yT - land));
  vec4 cH = projectionMatrix * modelViewMatrix * vec4(head, 1.0);
  vec4 cT = projectionMatrix * modelViewMatrix * vec4(tail, 1.0);
  vA = 0.0;
  if (cH.w <= 0.01 || cT.w <= 0.01) { gl_Position = vec4(0.0, 0.0, 2.0, 1.0); return; }
  vec2 d = (cH.xy / cH.w - cT.xy / cT.w) * uView;
  float dl = length(d);
  vec2 n = dl > 0.001 ? vec2(-d.y, d.x) / dl : vec2(1.0, 0.0);
  vec4 c = mix(cT, cH, position.y);
  c.xy += n * position.x * uWidth / uView * c.w;
  gl_Position = c;
  vA = uOpacity * aVar.z * position.y * step(0.002, yT - yH);
}`;
const FLAT_FS = `
uniform vec3 uColor;
varying float vA;
void main(){
  if (vA <= 0.003) discard;
  gl_FragColor = vec4(uColor, vA);
  #include <colorspace_fragment>
}`;
// A flake: a soft round point, falling slowly and swaying, melting into
// whatever it lands on.
const SNOW_VS = `
uniform float uTime, uTop, uSpeed, uSize, uScale, uMinPx, uMaxPx, uSway, uOpacity;
uniform vec2 uWind;
attribute vec4 aDrop;
attribute vec3 aVar;
varying float vA;
void main(){
  float land = aDrop.z, H = max(uTop - land, 0.5);
  float y = uTop - fract(aDrop.w + uTime * uSpeed * aVar.x / H) * H, fall = y - land, ph = aDrop.w * 43.0;
  vec2 sw = vec2(sin(uTime * 0.83 * aVar.y + ph), cos(uTime * 0.61 * aVar.x + ph * 1.7)) * uSway;
  vec4 mv = modelViewMatrix * vec4(aDrop.x - uWind.x * fall + sw.x, y, aDrop.y - uWind.y * fall + sw.y, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = clamp(uSize * aVar.y * uScale / max(-mv.z, 0.1), uMinPx, uMaxPx);
  vA = uOpacity * aVar.z * smoothstep(0.0, 0.35, fall) * smoothstep(0.0, 0.8, uTop - y);
}`;
const SNOW_FS = `
uniform vec3 uColor;
varying float vA;
void main(){
  vec2 q = gl_PointCoord * 2.0 - 1.0;
  float d = dot(q, q);
  if (d > 1.0 || vA <= 0.003) discard;
  gl_FragColor = vec4(uColor, vA * (1.0 - smoothstep(0.25, 1.0, d)));
  #include <colorspace_fragment>
}`;
// A splash: a ring opening on the ground (or the deck) and fading, at its
// own spot, on some of its turns only, so the same spots never pulse in step.
const SPLASH_VS = `
uniform float uTime, uOpacity;
attribute vec4 aDrop;
attribute vec3 aVar;
varying vec2 vQ;
varying float vA;
void main(){
  float c = uTime / (0.5 + 0.4 * aVar.x) + aDrop.w * 17.0, k = fract(c);
  float on = step(0.35, fract(sin(floor(c) * 12.9898 + aDrop.w * 78.233) * 43758.5453));
  float r = mix(0.06, 0.45, k) * aVar.y;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(aDrop.x + position.x * r, aDrop.z + 0.025, aDrop.y + position.y * r, 1.0);
  vQ = position.xy;
  vA = uOpacity * aVar.z * on * (1.0 - k) * (1.0 - k);
}`;
const SPLASH_FS = `
uniform vec3 uColor;
varying vec2 vQ;
varying float vA;
void main(){
  float d = length(vQ), a = vA * smoothstep(0.62, 0.8, d) * (1.0 - smoothstep(0.86, 1.0, d));
  if (a <= 0.003) discard;
  gl_FragColor = vec4(uColor, a);
  #include <colorspace_fragment>
}`;

function reducedMotion(){
  try { return !!(globalThis.matchMedia && globalThis.matchMedia("(prefers-reduced-motion: reduce)").matches); }
  catch (_) { return false; }
}

/** The weather in one 3D view. host = {scene, renderer, camera}: the view's
 *  own. update() at each poll, tick(t) on each frame the view draws,
 *  frameMs() for its live clock, dispose() when it goes. Never throws: a
 *  failure is counted (the flat Atlas's closed words) and the view simply
 *  has no weather until it is built again. */
export function createWeather(THREE, host){
  const OFF = Object.freeze({ kind: "off", heavy: false, rim: false });
  const t0 = performance.now();
  let shown = OFF, lastLive = -Infinity, broken = false;
  let colour = "#ffffff", snowColour = "#ffffff", strength = 1, still = false, profile = "low";
  let house = null, area = null, areaKey = null, built = 0;
  const L = {};                       // name -> {from, to, t0, dur, obj, n, res: [], mats: [], caps}
  for (const n of NAMES) L[n] = { from: 0, to: 0, t0: 0, dur: 0, obj: null, n: 0, drawn: 0, res: [], mats: [], caps: null };
  const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3();
  const Y = new THREE.Vector3(0, 1, 0), ZERO = new THREE.Matrix4().makeScale(0, 0, 0), _view = new THREE.Vector2();
  const col = new THREE.Color(colour), snowCol = new THREE.Color(snowColour);

  const opAt = (l, t) => (l.dur <= 0 ? l.to : l.from + (l.to - l.from) * clamp((t - l.t0) / l.dur, 0, 1));
  function target(name, to, t){
    const l = L[name];
    if (l.to === to) return;
    l.from = still ? to : opAt(l, t); l.to = to; l.t0 = t;
    l.dur = still ? 0 : to > l.from ? (name === "settle" ? SETTLE_MS : FADE_IN_MS) : FADE_OUT_MS;
  }
  function drop(name){
    const l = L[name];
    if (l.obj) { try { host.scene.remove(l.obj); } catch (_) { /* gone with the scene */ } }
    for (const r of l.res) { try { r.dispose(); } catch (_) { /* best effort */ } }
    if (l.obj) built--;
    l.obj = null; l.n = 0; l.drawn = 0; l.res = []; l.mats = []; l.caps = null;
    if (!FALLING.some(n => L[n].obj)) dropMask();
  }
  function dropAll(){ for (const n of NAMES) drop(n); }

  // ── building a layer ──────────────────────────────────────────────────────
  const seedOf = (name) => 11 + NAMES.indexOf(name) * 977;
  function particles(name){
    const spec = LAYERS[name], data = spawnLayer(area, name, countFor(area, name, profile), seedOf(name));
    if (!data.n) return null;
    let g;
    if (spec.kind === "snow") {
      // Points, one vertex a flake: the GPU places each one.
      g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(new Float32Array(data.n * 3), 3));
      g.setAttribute("aDrop", new THREE.Float32BufferAttribute(data.pos, 4));
      g.setAttribute("aVar", new THREE.Float32BufferAttribute(data.vars, 3));
    } else {
      // One quad, drawn once a drop: x across (-1, 1), y along (0 the tail,
      // 1 the head) — for a splash, the ring's square.
      g = new THREE.InstancedBufferGeometry();
      const q = name === "splash" ? [-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0] : [-1, 0, 0, 1, 0, 0, 1, 1, 0, -1, 1, 0];
      g.setAttribute("position", new THREE.Float32BufferAttribute(q, 3));
      g.setIndex([0, 1, 2, 0, 2, 3]);
      g.setAttribute("aDrop", new THREE.InstancedBufferAttribute(data.pos, 4));
      g.setAttribute("aVar", new THREE.InstancedBufferAttribute(data.vars, 3));
      g.instanceCount = data.n;
    }
    const tanA = Math.tan((spec.angle || 0) * D2R);
    const u = {
      uTime: { value: 0 }, uOpacity: { value: 0 }, uColor: { value: col.clone() }, uTop: { value: area.top },
      uWind: { value: new THREE.Vector2(WIND[0] * tanA, WIND[1] * tanA) },
    };
    // Never drawn where a room's floor shows (the mask marks it).
    const dry = { stencilWrite: true, stencilRef: 1, stencilFunc: THREE.NotEqualStencilFunc,
                  stencilFail: THREE.KeepStencilOp, stencilZFail: THREE.KeepStencilOp, stencilZPass: THREE.KeepStencilOp };
    let mat, obj;
    if (name === "splash") {
      mat = new THREE.ShaderMaterial({ uniforms: u, vertexShader: SPLASH_VS, fragmentShader: SPLASH_FS,
        transparent: true, depthWrite: false, side: THREE.DoubleSide, ...dry });
      obj = new THREE.Mesh(g, mat);
    } else if (spec.kind === "rain") {
      Object.assign(u, { uSpeed: { value: spec.speed }, uLen: { value: spec.len }, uWidth: { value: spec.width }, uView: { value: new THREE.Vector2(1, 1) } });
      mat = new THREE.ShaderMaterial({ uniforms: u, vertexShader: RAIN_VS, fragmentShader: FLAT_FS,
        transparent: true, depthWrite: false, side: THREE.DoubleSide, ...dry });
      obj = new THREE.Mesh(g, mat);
    } else {
      Object.assign(u, { uSpeed: { value: spec.speed }, uSize: { value: spec.size }, uSway: { value: spec.sway },
        uScale: { value: 500 }, uMinPx: { value: 2 }, uMaxPx: { value: 16 } });
      mat = new THREE.ShaderMaterial({ uniforms: u, vertexShader: SNOW_VS, fragmentShader: SNOW_FS,
        transparent: true, depthWrite: false, ...dry });
      obj = new THREE.Points(g, mat);
    }
    obj.frustumCulled = false;
    obj.renderOrder = 6;
    obj.name = "weather:" + name;
    return { obj, n: data.n, res: [g, mat], mats: [mat] };
  }
  // The snow that settles on a snowfall warning: the roof line, the decks and
  // the ground hugging the house, as three faint-to-white layers.
  function settle(){
    const grp = new THREE.Group();
    grp.name = "weather:settle";
    const res = [], mats = [];
    const lam = (extra) => {
      const m = new THREE.MeshLambertMaterial({ color: snowCol.clone().multiplyScalar(SNOW_SHADE), transparent: true, opacity: 0, depthWrite: false, ...extra });
      res.push(m); mats.push(m);
      return m;
    };
    let caps = null;
    const line = roofLine(house.walls ? house.walls() : [], house.rooms, house.shown);
    if (line.length) {
      const geo = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
      const im = new THREE.InstancedMesh(geo, lam({ depthWrite: true, transparent: true }), line.length);
      res.push(geo, { dispose: () => im.dispose() });
      caps = line.map((w, i) => {
        const P = w.P;
        _q.setFromAxisAngle(Y, P.yaw); _p.set(P.mx, w.F.fl.elev + w.top, P.my); _s.set(P.len + 0.04, CAP_H, (P.pc.thick || 0.14) + 0.05);
        const m = new THREE.Matrix4().compose(_p, _q, _s), cut = !!P.cut;
        im.setMatrixAt(i, cut ? ZERO : m);
        return { P, m, cut };
      });
      im.frustumCulled = false;
      im.renderOrder = 4;
      grp.add(im);
      caps.im = im;
    }
    const decks = (area && area.decks) || [];
    if (decks.length) {
      const dm = lam({ side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -4 });
      for (const d of decks) {
        // rotateX(+90°): the plan's (x, y) to the world's (x, z), as the floor tiles are.
        const g = new THREE.ShapeGeometry(new THREE.Shape(d.pts.map(p => new THREE.Vector2(p[0], p[1]))))
          .rotateX(Math.PI / 2).translate(0, d.y + 0.012, 0);
        res.push(g);
        const mesh = new THREE.Mesh(g, dm);
        mesh.renderOrder = 4;
        grp.add(mesh);
      }
    }
    const apron = apronMesh(lam, res);
    if (apron) grp.add(apron);
    return { obj: grp, n: (caps ? caps.length : 0), res, mats, caps };
  }
  function apronMesh(lam, res){
    const rooms = area ? area.indoor : [];
    if (!rooms.length || typeof document === "undefined") return null;
    const b = area.box, x0 = b.x0 - APRON_PAD, y0 = b.y0 - APRON_PAD, w = b.x1 - b.x0 + 2 * APRON_PAD, h = b.y1 - b.y0 + 2 * APRON_PAD;
    const k = Math.min(10, 320 / Math.max(w, h));                 // canvas px per metre
    const c = document.createElement("canvas");
    c.width = Math.max(8, Math.ceil(w * k)); c.height = Math.max(8, Math.ceil(h * k));
    const g = c.getContext("2d");
    if (!g) return null;
    // The house's outline grown a little, its shadow blurred: snow drifted
    // against the walls, thinning out a couple of metres away. Drawn off the
    // canvas so only the (blurred) shadow lands on it — shadowBlur is in
    // every browser, the canvas filter is not.
    const off = c.width * 2;
    g.shadowColor = "#ffffff"; g.shadowBlur = APRON_BLUR * k; g.shadowOffsetX = off; g.shadowOffsetY = 0;
    g.fillStyle = "#ffffff"; g.strokeStyle = "#ffffff"; g.lineWidth = 0.8 * k; g.lineJoin = "round";
    for (const R of rooms) {
      g.beginPath();
      R.pts.forEach((p, i) => { const X = (p[0] - x0) * k - off, Yc = (y0 + h - p[1]) * k; if (i) g.lineTo(X, Yc); else g.moveTo(X, Yc); });
      g.closePath(); g.fill(); g.stroke();
    }
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const geo = new THREE.PlaneGeometry(w, h).rotateX(Math.PI / 2).translate(x0 + w / 2, area.ground + 0.012, y0 + h / 2);
    // rotateX(+90°) turns the plane's top edge (+y) to plan +y: flip v so the
    // canvas (drawn y-down from the plan's far edge) lands the right way.
    const uv = geo.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setY(i, 1 - uv.getY(i));
    res.push(tex, geo);
    const mesh = new THREE.Mesh(geo, lam({ map: tex, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 }));
    mesh.renderOrder = 3;
    return mesh;
  }
  // The rooms' floors, marked on the screen and nothing else (no colour, no
  // depth): what falls is drawn only where none shows, as the flat Atlas's
  // rain never crosses a floor plate. Drawn after the house, before the
  // weather; a drop in front of a room, seen from above, is not drawn.
  let mask = null;
  function makeMask(){
    const tops = (area && area.tops) || [];
    if (!tops.length) return;
    const pos = [];
    for (const T of tops) {
      const g = new THREE.ShapeGeometry(new THREE.Shape(T.pts.map(p => new THREE.Vector2(p[0], p[1])))).toNonIndexed();
      g.rotateX(Math.PI / 2).translate(0, T.y, 0);
      pos.push(...g.attributes.position.array);
      g.dispose();
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    const m = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false, side: THREE.DoubleSide,
      polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -4,
      stencilWrite: true, stencilRef: 1, stencilFunc: THREE.AlwaysStencilFunc,
      stencilFail: THREE.KeepStencilOp, stencilZFail: THREE.KeepStencilOp, stencilZPass: THREE.ReplaceStencilOp });
    const obj = new THREE.Mesh(geo, m);
    obj.name = "weather:mask"; obj.renderOrder = 10; obj.frustumCulled = false;
    host.scene.add(obj);
    mask = { obj, res: [geo, m] };
  }
  function dropMask(){
    if (!mask) return;
    try { host.scene.remove(mask.obj); } catch (_) { /* gone with the scene */ }
    for (const r of mask.res) { try { r.dispose(); } catch (_) { /* best effort */ } }
    mask = null;
  }
  function build(name){
    const made = name === "settle" ? settle() : particles(name);
    if (!made) return false;
    Object.assign(L[name], made);
    host.scene.add(made.obj);
    built++;
    if (!mask && FALLING.includes(name)) makeMask();
    return true;
  }

  // ── each frame ────────────────────────────────────────────────────────────
  function paint(t){
    const time = still ? STILL_S : ((t - t0) / 1000) % WRAP_S;
    let dpr = 1;
    try { host.renderer.getDrawingBufferSize(_view); dpr = host.renderer.getPixelRatio() || 1; } catch (_) { _view.set(1, 1); }
    const H = _view.y || 1, scale = H / (2 * Math.tan(((host.camera && host.camera.fov) || 40) / 2 * D2R));
    const share = clamp((_view.x / dpr) * (_view.y / dpr) / REF_PX, MIN_SHARE, 1);
    for (const name of NAMES) {
      const l = L[name];
      if (!l.obj) continue;
      const k = opAt(l, t);
      if (k <= 0 && l.to === 0) { drop(name); continue; }
      if (name === "settle") {
        const kk = k * Math.min(1, 0.55 + 0.45 * strength);
        for (const m of l.mats) m.opacity = (m.map ? APRON_OP : SETTLE_OP) * kk;
        if (l.caps && l.caps.im) {
          let moved = false;
          l.caps.forEach((c, i) => { const cut = !!c.P.cut; if (cut !== c.cut) { c.cut = cut; l.caps.im.setMatrixAt(i, cut ? ZERO : c.m); moved = true; } });
          if (moved) l.caps.im.instanceMatrix.needsUpdate = true;
        }
        continue;
      }
      const spec = LAYERS[name], u = l.mats[0].uniforms;
      const want = Math.max(1, Math.round(l.n * share));
      if (want !== l.drawn) {
        l.drawn = want;
        const g = l.obj.geometry;
        if (g.isInstancedBufferGeometry) g.instanceCount = want; else g.setDrawRange(0, want);
      }
      u.uTime.value = time;
      u.uOpacity.value = spec.op * strength * k * (name === "splash" && still ? 0 : 1);
      if (u.uView) { u.uView.value.copy(_view); u.uWidth.value = spec.width * dpr; }
      if (u.uScale) { u.uScale.value = scale; u.uMinPx.value = 2 * dpr; u.uMaxPx.value = 16 * dpr; }
    }
  }

  return {
    /** At each poll. p = {settings (the settings payload), states, entities,
     *  colour ("#rrggbb": what falls), snowColour (what settles; else
     *  colour), profile ("low" | "high"), house: {key, rooms,
     *  ground, shown(floor), walls() → [{P, F}]}, nowMs, telemetry}. True
     *  when what is drawn changed (the view draws again). */
    update(p){
      if (broken) return false;
      const send = p && p.telemetry, now = Number.isFinite(p && p.nowMs) ? p.nowMs : Date.now(), t = performance.now();
      try {
        const cfg = AW.weatherSettingsFrom(p.settings);
        let d = null;
        try { d = AW.decideAtlasWeather(cfg, p.states || {}, p.entities); }
        catch (_) { AW.countWeatherOnce("weather_error:decision", send); }
        if (d && d.why !== "no_source") lastLive = now;
        const v = AW.holdVisual(shown, lastLive, d, now);
        let changed = false;
        const wasStill = still;
        still = reducedMotion();
        if (still !== wasStill) changed = true;
        if (!same(v, shown)) { shown = v; changed = true; }
        const hex = (v) => (/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(String(v || "")) ? String(v) : "#ffffff");
        const c = hex(p.colour), sc = hex(p.snowColour || p.colour);
        if (c !== colour || sc !== snowColour) {
          colour = c; col.set(c); snowColour = sc; snowCol.set(sc);
          for (const n of NAMES) for (const m of L[n].mats) { if (m.uniforms) m.uniforms.uColor.value.copy(col); else m.color.copy(snowCol).multiplyScalar(SNOW_SHADE); }
          changed = true;
        }
        if (cfg.strength !== strength) { strength = cfg.strength; changed = true; }
        const prof = p.profile === "high" ? "high" : "low";
        const want = new Set(layersFor(shown));
        // The house (or the floors showing, or the quality) changed: what is
        // built is built again for it.
        const key = `${(p.house && p.house.key) || ""}|${prof}`;
        if (key !== areaKey && (want.size || NAMES.some(n => L[n].obj))) {
          house = p.house || null;
          area = house ? weatherArea(house) : null;
          areaKey = key; profile = prof;
          for (const n of NAMES) if (L[n].obj) { drop(n); if (want.has(n)) changed = true; }
        }
        for (const n of NAMES) target(n, want.has(n) ? 1 : 0, t);
        for (const n of want) if (!L[n].obj && area) { if (build(n)) changed = true; }
        if (changed) paint(t);
        return changed;
      } catch (_) {
        AW.countWeatherOnce("weather_error:mount", send);
        broken = true;
        dropAll();
        return true;
      }
    },
    /** A frame: the clock and the fades handed to the GPU. */
    tick(t){ if (!broken) { try { paint(t); } catch (_) { broken = true; dropAll(); } } },
    /** How often the view draws for it (ms; 0: still, or nothing showing). */
    frameMs(){
      if (still || broken) return 0;
      let ms = 0;
      for (const n of NAMES) {
        if (!L[n].obj) continue;
        const m = FRAME_MS[n === "settle" ? "snow" : LAYERS[n].kind][profile];
        ms = ms ? Math.min(ms, m) : m;
      }
      return ms;
    },
    dispose(){ dropAll(); house = null; area = null; areaKey = null; },
    get shown(){ return shown; },
    /** For the harness. */
    _state(){
      const t = performance.now();
      const layers = {};
      for (const n of NAMES) if (L[n].obj || L[n].to) layers[n] = { n: L[n].n, drawn: L[n].drawn, op: opAt(L[n], t), to: L[n].to };
      return { shown, built, broken, still, profile, colour, snowColour, strength, frameMs: this.frameMs(), layers, mask: !!mask,
               area: area ? { cx: area.cx, cy: area.cy, r: area.r, top: area.top, patches: area.patches.length, decks: area.decks.length } : null };
    },
    /** For the harness: a layer's particles as built ([x, y, landing, phase] each). */
    _drops(name){ const l = L[name]; return l && l.obj && l.obj.geometry ? Array.from(l.obj.geometry.attributes.aDrop.array) : []; },
  };
}
