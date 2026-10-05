// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
// See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
//
// Live Aboard, the 3D house (docs/IDEA_ATLAS_3D_HOUSE.md): motion, in the
// Atlas's own colours and timing (live_aboard_house.js motionLook, the flat
// Atlas's rules, unchanged), drawn so it reads from across the room.
//
//   ring       a new trigger (off → on, or a re-trigger the state shows)
//              sends one ring across its room's floor from under the
//              sensor: about 1.2 s, easing out, fading to nothing, in the
//              active blue; clipped to the room, at most one per sensor
//              every 10 s, never looping while the sensor stays on
//   glow       the room's floor in the motion colour: full while on and
//              for the 5-minute hold, then the Atlas's steps by age, each
//              fainter than the last; a band along the room's edge so its
//              shape reads by day; unlit, so it glows on the darkened house
//              at night. The most recent sensor in a room wins.
//   presence   an occupancy or presence sensor that is on (an mmWave unit)
//              holds the room steady: a softer flat fill with a solid edge
//              line, never breathing, so a room occupied for hours costs no
//              frames. A motion + occupancy pair reads its motion half only,
//              as the Atlas does (Garry, 2026-09-04: every motion-class
//              marker looks and acts the same; an occupancy half left on
//              never holds the room lit); the half only picks its model
//   sensor     a small model by kind on the nearest wall at its height,
//              facing into the room (a PIR dome, a flat presence puck, the
//              square face of a paired room sensor); away from any wall,
//              a ceiling unit at its spot
//   marker     over it, the Atlas's motion glyph at a size you can read,
//              lit in the motion colour while active or recent, small and
//              quiet otherwise (hidden at whole-house scale); a dashed grey
//              ring with no reading, a ⚠ when the Atlas calls it stuck on
//   coverage   its detection fan on the floor, clipped to its room: shown
//              for 1.5 s on a trigger, while it is hovered or pressed, and
//              for every motion sensor while ☰ Motion is picked
//   chip       "Motion: Kitchen just now · Hall 4 min": the newest rooms in
//              their colours; a tap flies there; ⓘ is the colour key
//
// Outside every room, the ring and glow lie on the ground the sensor stands
// over (never in empty space); over nothing, the marker alone carries it.
// Only the ring and the trigger's flash move, on the view's capped clock,
// then stop: at rest it draws nothing. Imports no three.js: the view hands
// it in. Reads nothing of Home Assistant: the states the host passes.

const HOUSE = await import(`./live_aboard_house.js${new URL(import.meta.url).search}`);
const { computeMotionOccupancyPairs } = await import(`./lights_map.js${new URL(import.meta.url).search}`);
const { deviceClassOf, healthOf } = await import(`./light_codes.js${new URL(import.meta.url).search}`);

/** The onset ring: how long (ms), how often at most per sensor (ms), its
 *  width at the start and the end (m), its strength at the start. */
export const RING = { ms: 1200, everyMs: 10000, w0: 0.16, w1: 0.42, a: 0.95, r0: 0.25, rMax: 9, freshMs: 60000 };
/** A trigger shows the sensor's coverage this long (ms), at this strength. */
export const FLASH = { ms: 1500, a: 0.55 };
/** Coverage while hovered, pressed or under the motion lens. */
export const COVER_A = 0.34;
/** How often the ring is drawn while it spreads (ms), by profile. */
export const FRAME_MS = { high: 33, low: 66 };
/** Each kind's detection: width (°) and reach (m). A ceiling unit is a
 *  circle CEILING_K of its reach across. */
export const COVER = { pir: { deg: 100, m: 7 }, presence: { deg: 120, m: 6 }, pair: { deg: 100, m: 7 } };
export const CEILING_K = 0.5;
/** A sensor this near a wall (m) is mounted on it; farther, on the ceiling. */
export const WALL_REACH = 1.5;
/** How strongly a room glows at each of the Atlas's steps (MOTION_COLOR_STOPS:
 *  now, 5 min, 20, 40, 65, 90, 2 h): "just now" outshines "an hour ago". */
export const STEP_K = [1, 0.8, 0.66, 0.55, 0.46, 0.38, 0.32];
/** The floor's glow, by day and by night: its fill, its soft edge band; a
 *  presence hold's flat fill and solid line; a stuck sensor's hatch. */
export const GLOW = { fill: [0.66, 0.55], band: [1, 1], steadyFill: 0.72, steadyBand: 0.3, line: 1, stuck: 0.5,
                      bandW: [0.15, 0.6], bandOf: 0.3, groundR: 2.2, near: 0.6 };
/** The marker's size on screen (px): lit, quiet. Its tap target is the
 *  view's own (PICK_R, 44 px across). */
export const MARK_PX = { lit: 34, quiet: 22 };
/** The marker hangs this far out from its wall into the room (m), and this
 *  far under the ceiling at most, so a floor above never covers it. */
export const MARK_OUT = 0.35, MARK_UNDER = 0.15;
const QUIET_INK = "#94a3b8", NONE_INK = "#64748b", WARN = "#f59e0b", PLASTIC = "#eef2f6";
const ACTIVE = HOUSE.motionFill({ active: true });        // the Atlas's active blue (its MOTION_PULSE)
/** The colour key (ⓘ): the Atlas's steps, in its words. */
export const COLOUR_KEY = [["now", 0], ["5 min", 1], ["20 min", 2], ["40 min", 3], ["65 min", 4], ["90 min", 5], ["2 h", 6]];

const num = (v) => (v === null || v === undefined || v === "" || typeof v === "boolean" ? null
  : (Number.isFinite(Number(v)) ? Number(v) : null));
const unit = (v) => { const L = Math.hypot(v[0], v[1]); return L > 1e-9 ? [v[0] / L, v[1] / L] : null; };
const C30 = Math.cos(Math.PI / 6);
const isoToPlan = (sx, sy) => [sx / (2 * C30) + sy, -sx / (2 * C30) + sy];

// ── what a sensor is, and what it shows ─────────────────────────────────────
/** The colour of a step (0: the active blue). */
export const stepColor = (i) => (i <= 0 ? ACTIVE : HOUSE.motionColor(HOUSE.MOTION_COLOR_STOPS[Math.min(i, HOUSE.MOTION_COLOR_STOPS.length - 1)][1]));
/** The step a look is at: 0 active, else the last of the Atlas's stops it has passed. */
export function stepOf(look){
  if (!look || look.active) return 0;
  let i = 0;
  HOUSE.MOTION_COLOR_STOPS.forEach(([at], k) => { if (look.elapsed >= at) i = k; });
  return i;
}
/** "pir" | "presence" | "pair": the model drawn and the coverage. A sensor
 *  folded with an occupancy half (the Atlas's pairs) is a room sensor's square
 *  face; a "presence" sensor, or one whose name says radar, mmWave or
 *  presence (or names an mmWave model), a flat puck; anything else a PIR
 *  dome. Zigbee2MQTT reports a plain PIR as "occupancy", so that word alone
 *  never makes a presence unit. */
export function sensorModelOf(l, paired){
  if (paired) return "pair";
  const name = `${(l && l.entity_id) || ""} ${(l && l.friendly_name) || ""}`.toLowerCase().replace(/[_.]/g, " ");
  const dc = l && l.device_class;
  if (/\bpir\b/.test(name)) return "pir";
  if (dc === "presence") return "presence";
  return /radar|mmwave|mm wave|presence|ld24\d\d|\bfp[12]\b|snzb ?06|\b06p\b/.test(name) ? "presence" : "pir";
}
/** The Atlas's own "stuck on" (light_codes.js healthOf with the motion
 *  class's health key): on for longer than it can really be. */
export function stuckOf(l, nowMs){
  if (!l || l.state !== "on" || deviceClassOf(l).health !== "stuck_on") return false;
  return !healthOf(l, nowMs).healthy;
}
/** What a sensor shows on its floor now: null (nothing: quiet, past six
 *  hours, a restart's restored timestamp), {none} (no reading: no glow,
 *  never "clear" and never "motion"), or {active, steady, stuck, on, step,
 *  color, k, elapsed}. presence: it holds the room steady while on. */
export function glowOf(l, nowMs, haStartedMs, presence = false){
  if (!l) return null;
  if (l.state === "unavailable" || l.state === "unknown") return { none: true };
  if (!presence && stuckOf(l, nowMs)) {                      // on for hours is someone still there, for presence
    const e = nowMs - Date.parse(l.last_changed);
    return { active: true, steady: false, stuck: true, on: true, step: 0, color: ACTIVE, k: GLOW.stuck, elapsed: Number.isFinite(e) ? e : 0 };
  }
  const look = HOUSE.motionLook(l, nowMs, haStartedMs);
  if (!look) return null;
  const step = stepOf(look), on = l.state === "on";
  return { active: look.active, steady: !!presence && on, stuck: false, on, step, color: HOUSE.motionFill(look), k: STEP_K[step],
           elapsed: look.elapsed };
}
/** A room's glow from its sensors' glows: the most recent wins (active
 *  before quiet), real motion before a stuck sensor; no reading counts for
 *  nothing. */
export function roomGlow(list){
  let best = null;
  for (const g of list || []) {
    if (!g || g.none) continue;
    if (!best) { best = g; continue; }
    if (!!g.stuck !== !!best.stuck) { if (best.stuck) best = g; continue; }
    if (!!g.active !== !!best.active) { if (g.active) best = g; continue; }
    if (g.elapsed < best.elapsed) best = g;
  }
  return best;
}
/** The Atlas's pairs as motion eid → its occupancy half (lights_map.js
 *  computeMotionOccupancyPairs, from the registry the host passes). */
export function pairHalves(entities, states){
  if (!entities || !states) return {};
  const reg = (Array.isArray(entities) ? entities : Object.values(entities)).filter(e => e && typeof e.entity_id === "string");
  const out = {};
  for (const [half, motion] of Object.entries(computeMotionOccupancyPairs(reg, states))) out[motion] = half;
  return out;
}
/** The occupancy half of a pair as a record motionLook reads (it has no row
 *  on the Atlas): its own state and last_changed. */
export function halfRecord(eid, st){
  if (!st) return null;
  return { entity_id: eid, isMotion: true, device_class: "occupancy", state: st.state, last_changed: st.last_changed || null,
           friendly_name: (st.attributes && st.attributes.friendly_name) || eid };
}
/** Does this reading ring? A rising edge (off → on) or a re-trigger the
 *  state shows (still on, changed since), that happened just now (within
 *  RING.freshMs of nowMs); never coming back from no reading, never a
 *  restart's restored state, never within RING.everyMs (t, lastT: the view's
 *  clock) of its last ring. prev: what was seen last, or null. */
export function ringDue(prev, l, haStartedMs, lastT, t, nowMs = Date.now()){
  if (!prev || !l || l.state !== "on") return false;
  if (prev.state === "unavailable" || prev.state === "unknown") return false;
  if (prev.state === "on" && (!l.last_changed || l.last_changed === prev.last_changed)) return false;
  const at = Date.parse(l.last_changed);
  if (haStartedMs && at <= haStartedMs + HOUSE.MOTION_BOOT_GRACE_MS) return false;
  if (Number.isFinite(at) && nowMs - at > RING.freshMs) return false;
  return !(lastT !== null && lastT !== undefined && t - lastT < RING.everyMs);
}
/** The ring at p (0..1 of its time): radius (m), width (m) and strength,
 *  easing out, fading to nothing. rMax: as far as the room reaches. */
export function ringAt(p, rMax){
  const q = Math.min(1, Math.max(0, p)), e = 1 - Math.pow(1 - q, 3);
  return { r: RING.r0 + (Math.max(RING.r0, rMax) - RING.r0) * e, w: RING.w0 + (RING.w1 - RING.w0) * q, a: RING.a * Math.pow(1 - q, 1.4) };
}
/** Its detection range from its device's own setting, when one is in the
 *  states: a sibling number or sensor named like *range* or *distance* (the
 *  same device in the registry, else the same name), in metres. */
export function rangeOf(eid, states, entities){
  if (!eid || !states) return null;
  const reg = entities && !Array.isArray(entities) ? entities : {};
  const dev = reg[eid] && reg[eid].device_id;
  const base = String(eid).split(".")[1].replace(/_(occupancy|presence|motion)(_\d+)?$/, "");
  let best = null;
  for (const [id, st] of Object.entries(states)) {
    const dot = id.indexOf("."), dom = id.slice(0, dot), obj = id.slice(dot + 1);
    if (dom !== "number" && dom !== "sensor") continue;
    if (!(dev ? reg[id] && reg[id].device_id === dev : obj.startsWith(base + "_"))) continue;
    const name = `${obj} ${(st && st.attributes && st.attributes.friendly_name) || ""}`.toLowerCase().replace(/[_.]/g, " ");
    if (!/range|distance/.test(name) || /target|\bmin\b|minimum|fading|delay|sensitiv|gate|timeout/.test(name)) continue;
    const v = num(st && st.state);
    if (!(v > 0)) continue;
    const u = String((st.attributes && st.attributes.unit_of_measurement) || "").toLowerCase();
    const m = u === "cm" ? v / 100 : u === "mm" ? v / 1000 : u === "m" ? v : v > 30 ? v / 100 : v;
    if (!(m >= 0.3 && m <= 20)) continue;
    const score = (dom === "number" ? 2 : 0) + (/max|range|detection/.test(name) ? 1 : 0);
    if (!best || score > best.score) best = { m, score };
  }
  return best ? Math.round(best.m * 100) / 100 : null;
}
/** Its coverage: {deg, m, circle}. A presence sensor's reach is its
 *  device's range setting when there is one. */
export function coverOf(model, ceiling, rangeM){
  const c = COVER[model] || COVER.pir;
  const m = model === "presence" && rangeM > 0 ? rangeM : c.m;
  return ceiling ? { deg: 360, m: Math.round(m * CEILING_K * 100) / 100, circle: true } : { deg: c.deg, m, circle: false };
}
/** Where it looks, in the plan: the Atlas marker's rotation if one was set
 *  (the glyph points up the Atlas's screen at 0°), else from (x, y) toward
 *  the room's middle; else `fallback` (the wall's face). A unit vector. */
export function aimOf(x, y, room, rotationDeg, fallback = null){
  const rot = num(rotationDeg);
  if (rot !== null && rot % 360 !== 0) {
    const t = rot * Math.PI / 180;
    const v = unit(isoToPlan(Math.sin(t), -Math.cos(t)));
    if (v) return v;
  }
  if (room) {
    const c = room.spot ? [room.spot.x, room.spot.y] : room.pts.reduce((a, p) => [a[0] + p[0] / room.pts.length, a[1] + p[1] / room.pts.length], [0, 0]);
    const v = unit([c[0] - x, c[1] - y]);
    if (v && Math.hypot(c[0] - x, c[1] - y) > 0.2) return v;
  }
  return fallback ? unit(fallback) : null;
}
/** Is plan point (px, py) inside the fan from (x, y) along aim? */
export function inCover(cov, x, y, aim, px, py){
  const dx = px - x, dy = py - y, r = Math.hypot(dx, dy);
  if (r > cov.m) return false;
  if (cov.circle || r < 1e-6 || !aim) return true;
  return (dx * aim[0] + dy * aim[1]) / r >= Math.cos(cov.deg / 2 * Math.PI / 180) - 1e-9;
}
/** How long ago, said plainly: "now" while on, "just now", "4 min", "2 h". */
export function ageWords(g){
  if (!g) return "";
  if (g.on) return "now";
  const min = g.elapsed / 60000;
  return min < 1 ? "just now" : min < 90 ? `${Math.floor(min)} min` : `${Math.round(min / 60)} h`;
}
/** The hover box's words: "Motion · Kitchen · 3 min ago". */
export function hoverWords(model, where, g){
  const what = model === "presence" ? "Presence" : "Motion";
  let when;
  if (!g) when = "quiet";
  else if (g.none) when = "no reading";
  else if (g.stuck) when = `stuck on for ~${Math.max(1, Math.round(g.elapsed / 3600000))} h`;
  else if (g.steady) when = "someone here";
  else { const w = ageWords(g); when = w === "now" ? "now" : w === "just now" ? w : `${w} ago`; }
  return `${what} · ${where} · ${when}`;
}
/** The Motion chip's rooms: the newest (on first), at most `max`, never a
 *  stuck sensor or one with no reading. rows: [{name, eid, glow}]. */
export function chipRooms(rows, max = 3){
  return (rows || []).filter(r => r && r.glow && !r.glow.none && !r.glow.stuck)
    .sort((a, b) => (a.glow.on ? -1 : 0) - (b.glow.on ? -1 : 0) || a.glow.elapsed - b.glow.elapsed)
    .slice(0, max)
    .map(r => ({ name: r.name, eid: r.eid, color: r.glow.color, words: ageWords(r.glow) }));
}
/** The marker as drawn: {lit, size, ink, ring, warn, steady, show (at whole-house scale too)}. */
export function markerLook(g){
  if (g && g.none) return { lit: false, size: MARK_PX.quiet, ink: NONE_INK, ring: "dashed", warn: false, steady: false, wide: false };
  if (g && g.stuck) return { lit: true, size: MARK_PX.lit, ink: g.color, ring: "solid", warn: true, steady: false, wide: true };
  if (g) return { lit: true, size: MARK_PX.lit, ink: g.color, ring: "solid", warn: false, steady: !!g.steady, wide: true };
  return { lit: false, size: MARK_PX.quiet, ink: QUIET_INK, ring: "solid", warn: false, steady: false, wide: false };
}

// ── the floor: glow, band, rings and coverage ──────────────────────────────
const MAX_S = 4;                             // sensors one floor patch draws rings and fans for
const FLOOR_VS = `varying vec2 vP;
void main(){ vP = position.xz; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const FLOOR_FS = `uniform vec3 uColor, uRingColor; uniform float uFill, uHatch, uRadial; uniform vec2 uCentre;
uniform vec4 uRing[${MAX_S}]; uniform float uRingW[${MAX_S}];
uniform vec4 uFan[${MAX_S}]; uniform vec4 uFanDir[${MAX_S}];
varying vec2 vP;
vec4 over(vec4 top, vec4 base){
  float a = top.a + base.a * (1.0 - top.a);
  return a <= 0.0 ? vec4(0.0) : vec4((top.rgb * top.a + base.rgb * base.a * (1.0 - top.a)) / a, a);
}
void main(){
  float a = uFill;
  if (uRadial > 0.0) a *= 1.0 - smoothstep(uRadial * 0.3, uRadial, length(vP - uCentre));
  if (uHatch > 0.5) a *= 0.2 + 0.8 * step(0.5, fract((vP.x + vP.y) * 2.4));
  vec4 c = vec4(uColor, a);
  for (int i = 0; i < ${MAX_S}; i++) {
    float fa = uFan[i].w;
    if (fa <= 0.0) continue;
    vec2 d = vP - uFan[i].xy;
    float r = length(d), reach = uFan[i].z;
    if (r > reach) continue;
    float inside = 1.0, side = 1e3;
    if (uFanDir[i].w < 0.5 && r > 1e-4) {
      float cs = dot(d / r, uFanDir[i].xy);
      inside = step(uFanDir[i].z, cs);
      side = r * sqrt(max(0.0, 1.0 - min(1.0, cs * cs))) - r * sqrt(max(0.0, 1.0 - uFanDir[i].z * uFanDir[i].z));
      side = abs(side);
    }
    if (inside <= 0.0) continue;
    // A pale fan, outlined dark with a light halo: it reads on a glowing
    // floor and on a bright one.
    float e = min(reach - r, side);
    float fill = fa * (0.3 + 0.35 * (1.0 - r / reach));
    c = over(vec4(1.0, 1.0, 1.0, fill), c);
    c = over(vec4(1.0, 1.0, 1.0, (1.0 - smoothstep(0.05, 0.09, e)) * min(1.0, fa * 2.6)), c);
    c = over(vec4(0.06, 0.09, 0.16, (1.0 - smoothstep(0.018, 0.04, e)) * min(0.9, fa * 2.4)), c);
  }
  for (int i = 0; i < ${MAX_S}; i++) {
    float ra = uRing[i].w;
    if (ra <= 0.0) continue;
    float dd = abs(length(vP - uRing[i].xy) - uRing[i].z), w = uRingW[i];
    float ring = (1.0 - smoothstep(w * 0.35, w, dd)) * ra;
    c = over(vec4(uRingColor, ring), c);
  }
  gl_FragColor = c;
  #include <colorspace_fragment>
}`;
const BAND_VS = `attribute float aE; varying float vE; varying vec2 vP;
void main(){ vE = aE; vP = position.xz; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const BAND_FS = `uniform vec3 uColor; uniform float uBand, uLine, uHatch; varying float vE; varying vec2 vP;
void main(){
  float soft = uBand * pow(1.0 - clamp(vE, 0.0, 1.0), 1.7);
  float line = uLine * (1.0 - smoothstep(0.2, 0.27, vE));
  float a = max(soft, line);
  if (uHatch > 0.5) a *= 0.2 + 0.8 * step(0.5, fract((vP.x + vP.y) * 2.4));
  gl_FragColor = vec4(uColor, a);
  #include <colorspace_fragment>
}`;

/** The inner band along a polygon's edge: a strip w wide inside it, aE 0 at
 *  the edge and 1 inside. pts: the plan polygon; y: its height. */
export function bandStrip(pts, w, y){
  const n = pts.length;
  if (n < 3) return null;
  // Which side is in: the left of the first edge, if a point a little that way is inside.
  const [a0, b0] = [pts[0], pts[1]];
  const d0 = unit([b0[0] - a0[0], b0[1] - a0[1]]) || [1, 0];
  const mid = [(a0[0] + b0[0]) / 2, (a0[1] + b0[1]) / 2];
  const sgn = HOUSE.inPoly(mid[0] - d0[1] * 0.02, mid[1] + d0[0] * 0.02, pts) ? 1 : -1;
  const nrm = (i) => {
    const a = pts[i], b = pts[(i + 1) % n], d = unit([b[0] - a[0], b[1] - a[1]]) || [1, 0];
    return [-d[1] * sgn, d[0] * sgn];
  };
  const inner = [];
  for (let i = 0; i < n; i++) {
    const n1 = nrm((i - 1 + n) % n), n2 = nrm(i), m = unit([n1[0] + n2[0], n1[1] + n2[1]]) || n2;
    const cos = Math.max(0.4, m[0] * n2[0] + m[1] * n2[1]);
    inner.push([pts[i][0] + m[0] * w / cos, pts[i][1] + m[1] * w / cos]);
  }
  const pos = [], e = [];
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n, A = pts[i], B = pts[j], A2 = inner[i], B2 = inner[j];
    pos.push(A[0], y, A[1], B[0], y, B[1], B2[0], y, B2[1], A[0], y, A[1], B2[0], y, B2[1], A2[0], y, A2[1]);
    e.push(0, 0, 1, 0, 1, 1);
  }
  return { pos: new Float32Array(pos), e: new Float32Array(e) };
}

/**
 * ctx = {THREE, quality() ("low" | "high"), behind(v) (is world point v
 *        behind a wall or under a floor showing, from the eye), dim(eid)
 *        (faded by the class chips), dimK, floorTiles() (the floors that
 *        show, to tell a marker under one)}
 */
export function createMotionLayer(ctx){
  const { THREE } = ctx;
  const DIM = Number(ctx.dimK) > 0 ? Number(ctx.dimK) : 0.22;
  let sensors = [], patches = [], res = [], want = null, pairKey = null, halves = {}, lens = false, focusEid = null;
  let pairsOf = null, pairsN = -1, pairsAt = null;           // the pairs, for the registry (and states) they came from
  // near: the fill's strength at room scale (the band and the marker carry it there).
  let camKey = null, last = null, night = 0, near = 1;
  const seen = new Map();                    // eid -> {state, last_changed} last seen, and the half's
  const _p = new THREE.Vector3(), _d = new THREE.Vector3(), _ray = new THREE.Raycaster();
  /** Is world point v under a floor that shows, from camera c? A lit marker
   *  floats over walls (it says what is happening), never through a floor. */
  function under(v, c){
    const tiles = ctx.floorTiles ? ctx.floorTiles() : [];
    if (!tiles.length) return false;
    _d.copy(v).sub(c.position);
    const d = _d.length();
    if (d < 0.2) return false;
    _ray.set(c.position, _d.normalize());
    _ray.near = 0; _ray.far = d - 0.15;
    return _ray.intersectObjects(tiles, false).length > 0;
  }

  // The marker and the hover box read the device: its own state (no reading
  // and stuck are its own), else what it gives its room.
  const markGlow = (S) => (S.own && (S.own.none || S.own.stuck) ? S.own : S.give);
  const shown = (S) => !!(S.F && S.F.group && S.F.group.visible);
  const playing = (S) => S.ringT !== null || S.flashT !== null;
  function clear(){
    for (const S of sensors) { if (S.group && S.group.parent) S.group.parent.remove(S.group); }
    for (const P of patches) { if (P.group && P.group.parent) P.group.parent.remove(P.group); }
    for (const r of res) { try { r.dispose(); } catch (_) { /* best effort */ } }
    sensors = []; patches = []; res = []; camKey = null;
  }
  // ── the sensor itself ─────────────────────────────────────────────────────
  function model(S){
    const mat = new THREE.MeshLambertMaterial({ color: PLASTIC });
    const lens = new THREE.MeshLambertMaterial({ color: "#cbd5e1" });
    res.push(mat, lens);
    const g = new THREE.Group();
    const add = (geo, m, x, y, z, rx = 0) => { const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); o.rotation.x = rx; res.push(geo); g.add(o); return o; };
    if (S.model === "pir") {
      // A wall PIR: its back plate, the dome angled down into the room.
      if (!S.ceiling) add(new THREE.BoxGeometry(0.07, 0.09, 0.02), mat, 0, 0, 0.01);
      const dome = add(new THREE.SphereGeometry(0.034, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2), lens, 0, 0, S.ceiling ? 0 : 0.02,
                       S.ceiling ? Math.PI / 2 : Math.PI / 2 + 0.5);
      dome.scale.set(1, 1.15, 1);
    } else if (S.model === "pair") {
      // A room sensor's square face, its lens a dot.
      add(new THREE.BoxGeometry(0.046, 0.046, 0.014), mat, 0, 0, 0.007);
      add(new THREE.CylinderGeometry(0.007, 0.007, 0.004, 12), lens, 0, 0.006, 0.015, Math.PI / 2);
    } else {
      // A presence puck: flat on its wall, or flat under the ceiling.
      add(new THREE.CylinderGeometry(0.045, 0.045, 0.022, 24), mat, 0, 0, 0.011, Math.PI / 2);
      add(new THREE.CylinderGeometry(0.02, 0.02, 0.004, 16), lens, 0, 0, 0.023, Math.PI / 2);
    }
    if (S.ceiling) g.rotation.x = Math.PI / 2;                 // its face down
    else g.rotation.y = Math.atan2(S.face[0], S.face[1]);   // its face into the room
    g.position.set(S.mx, S.F.fl.elev + S.z, S.my);
    return g;
  }
  // ── the marker over it ────────────────────────────────────────────────────
  function drawMarker(S, k){
    const c = S.canvas, g = c.getContext("2d"), W = c.width, cx = W / 2, cy = W / 2, R = W * 0.36;
    g.clearRect(0, 0, W, W);
    g.save();
    if (k.lit) { g.shadowColor = k.ink; g.shadowBlur = W * 0.12; }
    g.beginPath(); g.arc(cx, cy, R, 0, Math.PI * 2);
    g.fillStyle = k.lit ? k.ink : "rgba(15,23,42,0.8)";
    g.fill();
    g.restore();
    g.lineWidth = W * 0.045;
    if (k.ring === "dashed" && typeof g.setLineDash === "function") g.setLineDash([W * 0.09, W * 0.07]);
    g.strokeStyle = k.ring === "dashed" ? "#94a3b8" : k.lit ? "rgba(255,255,255,0.95)" : "rgba(148,163,184,0.85)";
    g.beginPath(); g.arc(cx, cy, R, 0, Math.PI * 2); g.stroke();
    if (typeof g.setLineDash === "function") g.setLineDash([]);
    if (k.steady) { g.lineWidth = W * 0.025; g.strokeStyle = "rgba(255,255,255,0.9)"; g.beginPath(); g.arc(cx, cy, R * 0.8, 0, Math.PI * 2); g.stroke(); }
    // The Atlas's motion glyph: the ceiling-plan PIR dome and its lens lines.
    const HW = R * 0.5, oy = cy + HW * 0.45, ink = k.lit ? "#ffffff" : k.ring === "dashed" ? NONE_INK : "#cbd5e1";
    g.beginPath();
    for (let i = 0; i <= 16; i++) {
      const a = (180 + 180 * i / 16) * Math.PI / 180, x = cx + HW * Math.cos(a), y = oy + HW * 1.15 * Math.sin(a);
      if (i) g.lineTo(x, y); else g.moveTo(x, y);
    }
    g.closePath(); g.fillStyle = ink; g.fill();
    g.strokeStyle = k.lit ? k.ink : "rgba(15,23,42,0.85)"; g.lineWidth = W * 0.022;
    g.beginPath();
    for (let i = 0; i <= 12; i++) {
      const a = (180 + 180 * i / 12) * Math.PI / 180, x = cx + HW * 0.6 * Math.cos(a), y = oy + HW * 0.7 * Math.sin(a);
      if (i) g.lineTo(x, y); else g.moveTo(x, y);
    }
    g.moveTo(cx, cy - HW * 0.25); g.lineTo(cx, oy);
    g.stroke();
    if (k.warn) {
      // ⚠: stuck on — never read as real motion.
      const s = W * 0.3, x0 = W - s - W * 0.02, y0 = W * 0.04;
      g.beginPath(); g.moveTo(x0 + s / 2, y0); g.lineTo(x0 + s, y0 + s * 0.9); g.lineTo(x0, y0 + s * 0.9); g.closePath();
      g.fillStyle = WARN; g.fill(); g.lineWidth = W * 0.02; g.strokeStyle = "#111827"; g.stroke();
      g.fillStyle = "#111827"; g.font = `900 ${Math.round(s * 0.62)}px system-ui, sans-serif`; g.textAlign = "center"; g.textBaseline = "middle";
      g.fillText("!", x0 + s / 2, y0 + s * 0.56);
    }
    S.tex.needsUpdate = true;
  }
  /** Where the marker hangs: out from the wall into the room, at the
   *  sensor's height, under the ceiling. */
  function markAt(S){
    const out = S.ceiling ? 0 : MARK_OUT, top = S.F.fl.h - HOUSE.SLAB_T - MARK_UNDER;
    S.at.set(S.mx + S.face[0] * out, S.F.fl.elev + Math.min(S.z, top), S.my + S.face[1] * out);
    if (S.sprite) S.sprite.position.copy(S.at);
  }
  // ── the floor patch: a room's, or the ground's round an outside sensor ────
  function floorPatch(F, room, list, ground){
    const y = ground !== null ? ground : F.fl.elev + 0.006;
    let geo, centre = [0, 0], radial = 0;
    if (room) {
      geo = new THREE.ShapeGeometry(new THREE.Shape(room.pts.map(p => new THREE.Vector2(p[0], p[1]))));
      geo.rotateX(Math.PI / 2).translate(0, y, 0);
    } else {
      const S = list[0], R = Math.max(GLOW.groundR, S.cover.m);
      centre = [S.mx, S.my]; radial = GLOW.groundR;
      geo = new THREE.CircleGeometry(R, 48).rotateX(-Math.PI / 2).translate(S.mx, y, S.my);
    }
    const u = { uColor: { value: new THREE.Color(ACTIVE) }, uRingColor: { value: new THREE.Color(ACTIVE) }, uFill: { value: 0 },
                uHatch: { value: 0 }, uRadial: { value: radial }, uCentre: { value: new THREE.Vector2(centre[0], centre[1]) },
                uRing: { value: Array.from({ length: MAX_S }, () => new THREE.Vector4(0, 0, 0, 0)) }, uRingW: { value: new Array(MAX_S).fill(0.2) },
                uFan: { value: Array.from({ length: MAX_S }, () => new THREE.Vector4(0, 0, 0, 0)) },
                uFanDir: { value: Array.from({ length: MAX_S }, () => new THREE.Vector4(0, 0, 0, 0)) } };
    const mat = new THREE.ShaderMaterial({ uniforms: u, vertexShader: FLOOR_VS, fragmentShader: FLOOR_FS, transparent: true,
      depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -4 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.renderOrder = 2;
    mesh.visible = false;
    res.push(geo, mat);
    const P = { F, room, sensors: list.slice(0, MAX_S), all: list, group: new THREE.Group(), mesh, u, band: null, key: null, glow: null,
                rMax: 0, ground: ground !== null };
    P.group.add(mesh);
    // As far as a ring has to spread: the room's farthest corner from each sensor.
    for (const S of P.sensors) {
      S.rMax = room ? Math.min(RING.rMax, Math.max(...room.pts.map(p => Math.hypot(p[0] - S.mx, p[1] - S.my)))) : GLOW.groundR * 1.3;
    }
    if (room) {
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
      for (const q of room.pts) { x0 = Math.min(x0, q[0]); x1 = Math.max(x1, q[0]); y0 = Math.min(y0, q[1]); y1 = Math.max(y1, q[1]); }
      const w = Math.min(GLOW.bandW[1], Math.max(GLOW.bandW[0], GLOW.bandOf * Math.min(x1 - x0, y1 - y0) / 2));
      const st = bandStrip(room.pts, w, y + 0.001);
      if (st) {
        const bg = new THREE.BufferGeometry();
        bg.setAttribute("position", new THREE.BufferAttribute(st.pos, 3));
        bg.setAttribute("aE", new THREE.BufferAttribute(st.e, 1));
        const bu = { uColor: { value: new THREE.Color(ACTIVE) }, uBand: { value: 0 }, uLine: { value: 0 }, uHatch: { value: 0 } };
        const bm = new THREE.ShaderMaterial({ uniforms: bu, vertexShader: BAND_VS, fragmentShader: BAND_FS, transparent: true,
          depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -5 });
        const bmesh = new THREE.Mesh(bg, bm);
        bmesh.renderOrder = 3;
        bmesh.visible = false;
        res.push(bg, bm);
        P.group.add(bmesh);
        P.band = { mesh: bmesh, u: bu, w };
      }
    }
    F.group.add(P.group);
    for (const S of list) S.patch = P;
    return P;
  }
  function build(h){
    clear();
    const ground = h.ground;
    for (const S0 of want || []) {
      const F = S0.F, room = S0.room;
      const S = { eid: S0.eid, F, room, S0, z: S0.z, l: S0.l, lp: S0.lp || null, group: new THREE.Group(), ringT: null, flashT: null,
                  lastRing: null, glow: null, own: null, key: null, look: null, mkey: null, shownNow: false, patch: null, rMax: 1,
                  dim: false, hid: false, out: false, half: halves[S0.eid] || null };
      const l = S.l || {};
      S.model = sensorModelOf(l, !!S.half);
      // On the nearest wall within reach, facing into its room (outside: away
      // from the house); else a ceiling unit at its spot.
      const pieces = F.pieces.map(P => P.pc);
      const w = room ? HOUSE.roomWall(pieces, room, S0.x, S0.y) : HOUSE.nearestWall(pieces, S0.x, S0.y, WALL_REACH, true);
      S.ceiling = !(w && (!room || Math.hypot(w.x - S0.x, w.y - S0.y) <= WALL_REACH));
      if (S.ceiling) { S.mx = S0.x; S.my = S0.y; S.face = [0, 1]; }
      else { S.mx = w.x; S.my = w.y; S.face = w.n; }
      const rot = S.lp ? S.lp.rotation : null;
      S.aim = aimOf(S.mx, S.my, room, rot, S.ceiling ? null : S.face) || S.face;
      S.range = S.model === "presence" ? rangeOf(S.eid, h.states, h.entities) : null;
      S.cover = coverOf(S.model, S.ceiling, S.range);
      S.group.add(model(S));
      // The marker: drawn over everything, a size you can read.
      const c = document.createElement("canvas");
      c.width = 128; c.height = 128;
      const tex = new THREE.CanvasTexture(c);
      tex.colorSpace = THREE.SRGBColorSpace;
      const sm = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false, sizeAttenuation: false });
      const sp = new THREE.Sprite(sm);
      sp.renderOrder = 31;
      sp.visible = false;
      res.push(tex, sm);
      S.canvas = c; S.tex = tex; S.sprite = sp;
      S.at = new THREE.Vector3();
      markAt(S);
      sp.position.copy(S.at);
      S.group.add(sp);
      F.group.add(S.group);
      // Where the view finds it (a tap, its code, Find active): the marker.
      if (S0.pos && S0.pos.copy) S0.pos.copy(S.at);
      sensors.push(S);
    }
    // One patch per room with motion in it; outside, the ground under each
    // sensor on the ground; over nothing (an upper floor, out of every room),
    // none: the marker carries it.
    const byRoom = new Map();
    for (const S of sensors) {
      if (S.room) { if (!byRoom.has(S.room)) byRoom.set(S.room, []); byRoom.get(S.room).push(S); continue; }
      const onGround = S.F.fl.elev <= (ground || 0) + 0.5;
      if (onGround) patches.push(floorPatch(S.F, null, [S], (ground || 0) - HOUSE.SLAB_T - 0.02 + 0.006));
    }
    for (const [room, list] of byRoom) patches.push(floorPatch(list[0].F, room, list, null));
  }
  /** Each sensor's own glow, and what it gives its floor (with its half). */
  function read(S, h){
    const l = (h.lbe && h.lbe[S.eid]) || S.l;
    const own = glowOf(l, h.now, h.haStarted, S.model === "presence");
    // A pair: its motion half only, as on the Atlas (its occupancy half is never read).
    const give = roomGlow([own]) || (own && own.none ? own : null);
    const p0 = seen.get(S.eid);
    const rang = l && ringDue(p0 || null, l, h.haStarted, S.lastRing, h.t, h.now);
    seen.set(S.eid, l ? { state: l.state, last_changed: l.last_changed } : null);
    return { l, own, give, rang: !!rang };
  }
  function paintPatch(P, h){
    const list = P.all.map(S => S.give).filter(Boolean);
    const g = roomGlow(list);
    const dk = P.all.every(S => S.dim) ? DIM : 1;
    P.glow = g;
    const n = Math.min(1, Math.max(0, night));
    const fill0 = GLOW.fill[0] + (GLOW.fill[1] - GLOW.fill[0]) * n, band0 = GLOW.band[0] + (GLOW.band[1] - GLOW.band[0]) * n;
    const k = g ? g.k * dk : 0;
    const fill = !g ? 0 : g.steady ? fill0 * GLOW.steadyFill * k : fill0 * k;
    const band = !g ? 0 : g.steady ? band0 * GLOW.steadyBand * k : band0 * k;
    const line = g && g.steady ? GLOW.line * k : 0;
    const key = JSON.stringify([g ? [g.color, g.steady, g.stuck] : null, fill, band, line, P.ground]);
    if (key === P.key) return false;
    P.key = key;
    if (g) { P.u.uColor.value.set(g.color); if (P.band) P.band.u.uColor.value.set(g.color); }
    P.fill = P.ground ? (g ? Math.min(1, fill * 1.4) : 0) : fill;
    P.u.uFill.value = P.fill * (P.ground ? 1 : near);
    P.u.uHatch.value = g && g.stuck ? 1 : 0;
    if (P.band) { P.band.u.uBand.value = band; P.band.u.uLine.value = line; P.band.u.uHatch.value = g && g.stuck ? 1 : 0; }
    return true;
  }
  /** The rings and fans of a patch at t (the view's clock); the meshes shown
   *  only while something is drawn. */
  function stepPatch(P, t){
    let any = P.u.uFill.value > 0;
    P.sensors.forEach((S, i) => {
      const R = P.u.uRing.value[i], Fv = P.u.uFan.value[i], D = P.u.uFanDir.value[i];
      if (S.ringT !== null && t - S.ringT < RING.ms && shown(S)) {
        const r = ringAt((t - S.ringT) / RING.ms, S.rMax);
        R.set(S.mx, S.my, r.r, r.a * (S.dim ? DIM : 1));
        P.u.uRingW.value[i] = r.w;
      } else R.set(S.mx, S.my, 0, 0);
      let fa = 0;
      if (S.flashT !== null && t - S.flashT < FLASH.ms) { const q = (t - S.flashT) / FLASH.ms; fa = FLASH.a * (1 - q * q) * (S.dim ? DIM : 1); }
      if ((lens && !S.dim) || focusEid === S.eid) fa = Math.max(fa, COVER_A);
      if (fa > 0 && S.cover) {
        Fv.set(S.mx, S.my, S.cover.m, fa);
        D.set(S.aim[0], S.aim[1], Math.cos(S.cover.deg / 2 * Math.PI / 180), S.cover.circle ? 1 : 0);
      } else Fv.set(0, 0, 0, 0);
      if (R.w > 0 || Fv.w > 0) any = true;
    });
    P.mesh.visible = any;
    if (P.band) P.band.mesh.visible = P.band.u.uBand.value > 0 || P.band.u.uLine.value > 0;
  }

  return {
    /** The motion sensors to draw (from the view's sensors: {eid, l, F, x, y,
     *  z, room, lp, pos}); drawn on the next sync. */
    build(list){ want = list || []; pairKey = null; },
    /** What each reads now, and draw it. h = {lbe, states, entities, now
     *  (ms), haStarted, t (performance.now), cls (the class chips' pick),
     *  night (0 day … 1 night), ground}. True when anything drawn changed. */
    sync(h){
      let changed = false;
      const nStates = h.states ? Object.keys(h.states).length : 0;
      if (h.entities !== pairsOf || nStates !== pairsN || !pairsAt) { pairsOf = h.entities; pairsN = nStates; pairsAt = pairHalves(h.entities, h.states); }
      const hv = pairsAt, pk = JSON.stringify(hv);
      if (want && pk !== pairKey) {
        pairKey = pk; halves = hv;
        build(h);
        for (const S of sensors) { const l = (h.lbe && h.lbe[S.eid]) || S.l; if (!seen.has(S.eid) && l) seen.set(S.eid, { state: l.state, last_changed: l.last_changed }); }
        changed = true;
      }
      const lensNow = h.cls === "motion";
      if (lensNow !== lens) { lens = lensNow; changed = true; }
      if (Math.abs((h.night || 0) - night) > 1e-3) { night = h.night || 0; changed = true; for (const P of patches) P.key = null; }
      for (const S of sensors) {
        const r = read(S, h);
        S.own = r.own; S.give = r.give;
        const dim = !!(ctx.dim && ctx.dim(S.eid));
        if (dim !== S.dim) { S.dim = dim; changed = true; for (const P of patches) P.key = null; }
        if (r.rang) { S.ringT = h.t; S.flashT = h.t; S.lastRing = h.t; changed = true; }
        const k = markerLook(markGlow(S));
        const mkey = JSON.stringify(k);
        if (mkey !== S.mkey) { S.mkey = mkey; S.look = k; drawMarker(S, k); changed = true; camKey = null; }
      }
      for (const P of patches) if (paintPatch(P, h)) changed = true;
      if (changed) { last = h.t; for (const P of patches) stepPatch(P, h.t); }
      return changed;
    },
    /** The view's clock (t: performance.now()): the rings and flashes, moved. */
    tick(t){
      last = t;
      for (const P of patches) if (P.all.some(playing)) stepPatch(P, t);
      // Every sensor's ring and flash ends, a room's fifth too (its patch
      // draws four): else the view never came to rest.
      for (const S of sensors) {
        if (S.ringT !== null && t - S.ringT >= RING.ms) S.ringT = null;
        if (S.flashT !== null && t - S.flashT >= FLASH.ms) S.flashT = null;
      }
    },
    /** How often to draw while a ring or a flash plays on a floor that shows (ms), or 0. */
    rate(){
      for (const S of sensors) if (shown(S) && S.patch && playing(S)) return FRAME_MS[ctx.quality() === "high" ? "high" : "low"];
      return 0;
    },
    /** The markers sized for camera c over a view H px high; room: the view is
     *  about room scale (quiet ones show only then). */
    size(c, H, room){
      const k = 2 * Math.tan((c.fov || 40) / 2 * Math.PI / 180) / Math.max(1, H);
      const nearNow = room ? GLOW.near : 1;
      if (nearNow !== near) { near = nearNow; for (const P of patches) if (!P.ground) { P.u.uFill.value = (P.fill || 0) * near; P.mesh.visible = P.mesh.visible || P.u.uFill.value > 0; } }
      const key = c.matrixWorld.elements.map(v => v.toFixed(3)).join(",") + H + "|" + sensors.map(S => (shown(S) ? 1 : 0)).join("");
      const again = key !== camKey;
      camKey = key;
      for (const S of sensors) {
        const L = S.look || markerLook(null);
        let on = shown(S) && (!!room || L.wide);
        if (on && again) {
          _p.copy(S.at).project(c);
          S.out = !(_p.z > -1 && _p.z < 1 && Math.abs(_p.x) <= 1.05 && Math.abs(_p.y) <= 1.05);
          // Quiet, it hides behind a wall as a code chip does; lit, only under a floor.
          S.hid = !S.out && (L.wide ? under(S.at, c) : !!(ctx.behind && ctx.behind(S.at)));
        }
        on = on && !S.out && !S.hid;
        S.shownNow = on;
        S.sprite.visible = on;
        if (!on) continue;
        const px = L.size * (128 / (128 * 0.72));
        S.sprite.scale.set(px * k, px * k, 1);
        S.sprite.material.opacity = S.dim ? DIM + 0.1 : L.lit ? 1 : 0.85;
      }
    },
    /** Walls or floors changed: what hides a marker is worked out again. */
    recheck(){ camKey = null; },
    /** What a press can land on: a marker that shows, not faded. */
    pickable(){ return sensors.filter(S => S.shownNow && !S.dim).map(S => ({ eid: S.eid, v: S.at })); },
    /** The hover box's words for eid, or null. */
    label(eid){
      const S = sensors.find(x => x.eid === eid);
      if (!S) return null;
      const l = S.l || {};
      const where = S.room ? S.room.name : l.area_name || String(l.friendly_name || "Outside").replace(/\b(motion|occupancy|presence|sensor)\b/gi, " ").replace(/\s+/g, " ").trim() || "Outside";
      return hoverWords(S.model, where, markGlow(S));
    },
    /** What is hovered or pressed (eid, or null): its coverage shows. True
     *  when that changed what is drawn. */
    focus(eid){
      const e = eid && sensors.some(S => S.eid === eid) ? eid : null;
      if (e === focusEid) return false;
      focusEid = e;
      const t = last === null ? 0 : last;
      for (const P of patches) stepPatch(P, t);
      return true;
    },
    /** Heights' slider: moved in place (z: its new height above its floor). */
    move(eid, z){
      const S = sensors.find(x => x.eid === eid);
      if (!S) return false;
      const d = z - S.z;
      S.z = z;
      for (const o of S.group.children) if (o !== S.sprite) o.position.y += d;
      markAt(S);
      if (S.S0.pos && S.S0.pos.copy) S.S0.pos.copy(S.at);
      camKey = null;
      return true;
    },
    /** The Motion chip's rooms: [{name, eid, color, words}], newest first. */
    rooms(max = 3){
      const rows = [];
      for (const P of patches) {
        if (!P.glow) continue;
        const S = P.all.find(x => x.give === P.glow) || P.all[0];
        const l = S.l || {};
        rows.push({ name: P.room ? P.room.name : l.area_name || chipName(l) || "Outside", eid: S.eid, glow: P.glow });
      }
      // Over nothing (no patch): the marker's own.
      for (const S of sensors) if (!S.patch && S.own && !S.own.none) rows.push({ name: chipName(S.l || {}) || "Outside", eid: S.eid, glow: S.own });
      return chipRooms(rows, max);
    },
    state(){
      return {
        lens, focus: focusEid, night,
        sensors: sensors.map(S => ({ eid: S.eid, model: S.model, half: S.half, ceiling: S.ceiling, room: S.room ? S.room.name : null,
          at: [S.at.x, S.at.y, S.at.z].map(v => Math.round(v * 1000) / 1000), mount: [S.mx, S.my].map(v => Math.round(v * 1000) / 1000),
          aim: S.aim.map(v => Math.round(v * 1000) / 1000), cover: S.cover, range: S.range, own: S.own, give: S.give,
          look: S.look, shown: S.shownNow, hid: !!S.hid, out: !!S.out, dim: S.dim, ring: S.ringT !== null, flash: S.flashT !== null, patch: S.patch ? patches.indexOf(S.patch) : -1 })),
        patches: patches.map(P => ({ room: P.room ? P.room.name : null, ground: P.ground, floor: P.F.fl.id, visible: P.mesh.visible,
          y: Math.round(P.mesh.geometry.attributes.position.getY(0) * 1000) / 1000,
          glow: P.glow, fill: P.u.uFill.value, hatch: P.u.uHatch.value,
          band: P.band ? { on: P.band.mesh.visible, soft: P.band.u.uBand.value, line: P.band.u.uLine.value } : null,
          color: "#" + P.u.uColor.value.getHexString(),
          rings: P.u.uRing.value.map(v => [v.x, v.y, v.z, v.w].map(q => Math.round(q * 1000) / 1000)),
          fans: P.u.uFan.value.map(v => [v.x, v.y, v.z, v.w].map(q => Math.round(q * 1000) / 1000)) })),
      };
    },
    get count(){ return sensors.length; },
    clear(){ clear(); want = null; pairKey = null; },
    dispose(){ clear(); want = null; pairKey = null; seen.clear(); },
  };
}
/** An outside sensor's own name, without "motion" and the like. */
function chipName(l){
  const n = String((l && l.friendly_name) || "").replace(/\b(motion|occupancy|presence|sensor)\b/gi, " ").replace(/\s+/g, " ").trim();
  return n && n.length <= 18 ? n : null;
}

// ── the Motion chip ─────────────────────────────────────────────────────────
const CHIP_CSS = `.la3d-mchip{position:absolute;left:50%;top:44px;z-index:2;transform:translateX(-50%);display:flex;align-items:center;gap:2px;
  max-width:calc(100% - 150px);padding:3px 4px 3px 12px;border-radius:999px;background:rgba(6,14,9,.8);border:1px solid rgba(120,190,155,.22);
  box-shadow:0 4px 14px rgba(0,0,0,.35);color:rgba(226,240,232,.75);font:600 12.5px/1.2 system-ui,"Segoe UI",Roboto,sans-serif;white-space:nowrap}
.la3d-mchip[hidden]{display:none}
.la3d.la3d-narrow .la3d-mchip{top:auto;bottom:58px;max-width:calc(100% - 20px);padding:2px 2px 2px 9px;font-size:11.5px}
.la3d.la3d-narrow .la3d-mchip button{padding:4px 4px}
.la3d.la3d-narrow .la3d-mchip .la3d-mage{margin-left:3px}
.la3d-mchip button{all:unset;box-sizing:border-box;cursor:pointer;padding:4px 7px;border-radius:999px;font-weight:800;overflow:hidden;text-overflow:ellipsis}
.la3d-mchip button:hover,.la3d-mchip button:focus-visible{background:rgba(255,255,255,.1)}
.la3d-mchip .la3d-mage{font-weight:600;opacity:.85;margin-left:4px}
.la3d-mchip .la3d-msep{opacity:.45}
.la3d-mchip .la3d-minfo{font-weight:600;color:rgba(226,240,232,.7);padding:4px 8px}
.la3d-mkey{position:absolute;left:50%;top:84px;z-index:5;transform:translateX(-50%);padding:9px 12px;border-radius:12px;background:rgba(6,14,9,.95);
  border:1px solid rgba(120,190,155,.24);box-shadow:0 10px 26px rgba(0,0,0,.5);color:#e8f0ea;font:600 12.5px/1.3 system-ui,"Segoe UI",Roboto,sans-serif}
.la3d-mkey[hidden]{display:none}
.la3d.la3d-narrow .la3d-mkey{top:auto;bottom:100px;max-width:calc(100% - 20px)}
.la3d-mkey b{display:block;margin-bottom:6px}
.la3d-mkey .la3d-mrow{display:flex;flex-wrap:wrap;gap:6px 12px}
.la3d-mkey i{display:inline-block;width:12px;height:12px;border-radius:50%;margin-right:5px;vertical-align:-1px}
.la3d.la3d-bare .la3d-mchip,.la3d.la3d-bare .la3d-mkey{opacity:0;visibility:hidden;pointer-events:none}`;
/**
 * The Motion chip by the view's top hint. o = {root, fly(eid)}. update(rows)
 * with Motion layer's rooms(); hides when there are none, and (CSS) with the
 * map alone.
 */
export function createMotionChip(o){
  const doc = o.root.ownerDocument || document;
  const css = doc.createElement("style");
  css.textContent = CHIP_CSS;
  o.root.appendChild(css);
  const el = doc.createElement("div");
  el.className = "la3d-mchip";
  el.hidden = true;
  el.setAttribute("data-la3d-motion", "");
  o.root.appendChild(el);
  const keyEl = doc.createElement("div");
  keyEl.className = "la3d-mkey";
  keyEl.hidden = true;
  const kb = doc.createElement("b");
  kb.textContent = "Motion colours: how long ago";
  const kr = doc.createElement("div");
  kr.className = "la3d-mrow";
  for (const [words, i] of COLOUR_KEY) {
    const s = doc.createElement("span"), dot = doc.createElement("i");
    dot.style.background = stepColor(i);
    s.appendChild(dot);
    s.appendChild(doc.createTextNode(words));
    kr.appendChild(s);
  }
  keyEl.appendChild(kb); keyEl.appendChild(kr);
  o.root.appendChild(keyEl);
  let shownKey = "", rows = [];
  const stop = (e) => { if (e && e.stopPropagation) e.stopPropagation(); };
  for (const ev of ["pointerdown", "pointerup", "wheel", "dblclick"]) el.addEventListener(ev, stop);
  return {
    update(list){
      rows = list || [];
      const key = JSON.stringify(rows);
      if (key === shownKey) return false;
      shownKey = key;
      while (el.firstChild) el.removeChild(el.firstChild);
      if (!rows.length) { el.hidden = true; keyEl.hidden = true; return true; }
      el.hidden = false;
      const lbl = doc.createElement("span");
      lbl.textContent = "Motion:";
      lbl.style.marginRight = "2px";
      el.appendChild(lbl);
      rows.forEach((r, i) => {
        if (i) { const s = doc.createElement("span"); s.className = "la3d-msep"; s.textContent = "·"; el.appendChild(s); }
        const b = doc.createElement("button");
        b.type = "button";
        b.style.color = r.color;
        b.title = `Go to ${r.name}`;
        b.setAttribute("data-eid", r.eid);
        b.appendChild(doc.createTextNode(r.name));
        const a = doc.createElement("span");
        a.className = "la3d-mage";
        a.textContent = r.words;
        b.appendChild(a);
        b.addEventListener("click", (e) => { stop(e); try { o.fly(r.eid); } catch (_) { /* the view's */ } });
        el.appendChild(b);
      });
      const info = doc.createElement("button");
      info.type = "button";
      info.className = "la3d-minfo";
      info.textContent = "ⓘ";
      info.title = "What the colours mean";
      info.setAttribute("aria-label", "What the motion colours mean");
      info.addEventListener("click", (e) => { stop(e); keyEl.hidden = !keyEl.hidden; });
      el.appendChild(info);
      return true;
    },
    state(){ return { shown: !el.hidden, text: el.hidden ? "" : el.textContent, rows: rows.map(r => ({ ...r })), key: !keyEl.hidden, keyText: keyEl.textContent }; },
    /** A press on room `i` (tests): flies there. */
    press(i){ const r = rows[i]; if (r) o.fly(r.eid); return !!r; },
    toggleKey(){ keyEl.hidden = !keyEl.hidden; return !keyEl.hidden; },
    dispose(){ try { el.remove(); keyEl.remove(); css.remove(); } catch (_) { /* gone with the view */ } },
  };
}
