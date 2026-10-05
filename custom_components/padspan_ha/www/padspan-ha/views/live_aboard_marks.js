// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
// See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
//
// Live Aboard, the 3D house (docs/IDEA_ATLAS_3D_HOUSE.md): the rest of the
// Atlas's placed devices, and what its drawers pick, in the house.
//
//   leak sensors  (the Atlas's Emergency class) a small puck on the floor
//                 where it is placed. Dry, it is quiet. Wet, or still inside
//                 the Atlas's 2-day latch (iso_lights.js floodLatchActive and
//                 the host's floodLatches), it shows the Atlas's alarm: wavy
//                 rings rippling out across its room's floor in the flood
//                 colour (three while wet, one slower while latched, as
//                 floodRingSvg draws them), the floor tinted, and the Atlas's
//                 own word for it (WET, ALARM) in a red pill drawn over
//                 everything, so it is seen from the whole house on every
//                 floor that shows
//   locks         a small padlock on the wall nearest its spot, about 1 m
//                 up, coloured as the Atlas's lock glyph: lit while locked,
//                 dark unlocked or jammed, grey with no reading
//   codes         the Atlas's code chip (A01, M08…) under each device, in
//                 its theme's chip colours, once the view is about room
//                 scale; none while "Hide device codes" is on
//   class chips   the Atlas's own class test (lights_map.js classMatches):
//                 a device of another class fades and takes no taps
//
// A door or window sensor is never a point here, as on the Atlas: its place
// is the section of wall it is linked to (docs/IDEA_DOOR_WINDOW_BARRIERS.md,
// Garry 2026-09-08), which the house already draws as its opening.
//
// Each sits at its height above its floor: a default by its kind, replaced
// by the 3D file's devices[<entity id>].z_m (Edit → Heights). An alarm moves
// on the view's capped clock (MARK_MS) only while it alarms on a floor that
// shows; nothing alarming, nothing is drawn. Imports no three.js: the view
// hands it in.

const HOUSE = await import(`./live_aboard_house.js${new URL(import.meta.url).search}`);
const { classMatches } = await import(`./lights_map.js${new URL(import.meta.url).search}`);
const { floodLatchActive } = await import(`./iso_lights.js${new URL(import.meta.url).search}`);
const { deviceClassOf, LOCK_BORDER, FLOOD_BORDER } = await import(`./light_codes.js${new URL(import.meta.url).search}`);

/** Each kind's height above its floor (m) until Heights sets one. */
export const MARK_Z = { flood: 0.02, lock: 1.0 };
/** How often an alarm is drawn while it alarms (ms), by profile. */
export const MARK_MS = { high: 40, low: 100 };
/** How strongly a device of another class shows while a class is picked (the Atlas's 0.22). */
export const DIM_K = 0.22;
/** Codes show once the view is about this wide or narrower (m): room scale,
 *  and zoomed in past the whole-house fit (a small flat's fit is a room). */
export const CODE_SPAN_M = 12, CODE_IN = 0.8;
/** The Atlas's flood ripple (floodRingSvg): ripples, period (ms) and turn (ms), wet and latched. */
export const FLOOD_RIPPLE = { wet: { n: 3, ms: 2600, spinMs: 9000 }, latched: { n: 1, ms: 4200, spinMs: 18000 },
                              lobes: 7, amp: 0.16, from: 0.03, op: 0.85 };
export const LOCK_LOOK = { locked: "#fbbf24", off: "#374151", none: "#64748b" };
const QUIET = "#cfd8d3", NO_READING = "#64748b";
const TINT = 0.2, RING_W = 0.14, LOCK_REACH = 1.5, BADGE_PX = 26, CODE_PX = 17;

const num = (v) => (v === null || v === undefined || v === "" || typeof v === "boolean" ? null
  : (Number.isFinite(Number(v)) ? Number(v) : null));

// ── what is drawn, and how it reads ─────────────────────────────────────────
/** "flood" | "lock" | null: the kinds this file draws (the registry's own keys). */
export function markKindOf(l){
  if (!l) return null;
  const k = deviceClassOf(l).key;
  return k === "flood" || k === "lock" ? k : null;
}
/** The placed leak sensors and locks, as readSensors reads the sensors:
 *  placed only, hidden never. F: the reading's floors (byId, canon). */
export function readMarks(model, F, lightsByEid, hidden){
  const out = [];
  const pos = (model && model.light_positions_m) || {};
  for (const eid of Object.keys(pos).sort()) {
    const lp = pos[eid], l = lightsByEid && lightsByEid[eid], kind = markKindOf(l);
    if (!kind || !lp || typeof lp !== "object") continue;
    if (hidden && typeof hidden.has === "function" && hidden.has(eid)) continue;
    const fl = F.byId.get(F.canon(lp.floor_id)), x = num(lp.x_m), y = num(lp.y_m);
    if (!fl || x === null || y === null) continue;
    out.push({ eid, l, kind, floor: fl, x, y, color: typeof lp.color === "string" ? lp.color : null });
  }
  return out;
}
/** What they are drawn from (which, where, what kind), not their state. */
export function marksSignature(model, lightsByEid, hidden){
  const pos = (model && model.light_positions_m) || {};
  const rows = [];
  for (const eid of Object.keys(pos).sort()) {
    const kind = markKindOf(lightsByEid && lightsByEid[eid]);
    if (!kind || (hidden && typeof hidden.has === "function" && hidden.has(eid))) continue;
    const p = pos[eid] || {};
    rows.push([eid, p.x_m, p.y_m, p.floor_id, kind, p.color || null]);
  }
  return JSON.stringify(rows);
}
/** Its height above its floor: Heights' if set, else its kind's (as deviceZ). */
export function markZ(kind, ceil, stored){
  const z = num(stored && stored.z_m);
  return HOUSE.deviceZ(kind, ceil, { z_m: z !== null ? z : (MARK_Z[kind] ?? 1) });
}
/** A leak sensor now: alarming while wet or latched (the Atlas's floodFx
 *  rule), its ripple, and the Atlas's words for it (stateWordOf: WET,
 *  ALARM, DRY). */
export function floodLook(l, latches, nowMs){
  const s = l ? l.state : null;
  const wet = s === "on";
  const latch = latches && l ? latches[l.entity_id] : null;
  const latched = !wet && floodLatchActive(latch ? num(latch.triggered_at) : NaN, nowMs);
  const none = !l || s === "unavailable" || s === "unknown";
  return { alarm: wet || latched, wet, latched, none, ripple: wet ? FLOOD_RIPPLE.wet : latched ? FLOOD_RIPPLE.latched : null,
           word: wet ? "WET" : latched ? "ALARM" : "DRY" };
}
/** A lock now, as the Atlas's glyph reads it (markerSvg: lit only while
 *  locked); no reading (barrierNoReading) grey. color: its pin colour. */
export function lockLook(l, color){
  const s = l ? l.state : null;
  const state = !l || s === "unavailable" || s === "unknown" ? "none" : s === "locked" ? "locked" : s === "jammed" ? "jammed" : "unlocked";
  return { state, lit: state === "locked", rim: LOCK_BORDER,
           body: state === "locked" ? (color || LOCK_LOOK.locked) : state === "none" ? LOCK_LOOK.none : LOCK_LOOK.off };
}
/** Is l faded by the class chips (cls: a class key, "all" or null)? */
export function dimmed(l, cls){ return !!(l && cls && cls !== "all" && !classMatches(l, cls)); }
/** Do codes show at this camera distance (m), screen aspect, field of view
 *  (°) and whole-house fit distance (m, or null)? */
export function codesAt(radius, aspect, fovDeg, fitR = null){
  const span = 2 * Math.tan((Number(fovDeg) || 40) / 2 * Math.PI / 180) * Number(radius) * Math.min(1, Number(aspect) || 1);
  return Number.isFinite(span) && span <= CODE_SPAN_M && !(Number(fitR) > 0 && Number(radius) > fitR * CODE_IN);
}
/** A device's code chip as the Atlas draws it (codeChipSvg): its code, the
 *  theme's chip, ink #e2e8f0 (Showcase: the light's colour while on, the
 *  theme's off label colour while off). */
export function chipLook(l, theme, showcase, litHex){
  if (!l || !l.code) return null;
  const T = theme || {};
  const ink = !showcase ? "#e2e8f0" : litHex || T.labelColorOff || "#e2e8f0";
  return { text: String(l.code), bg: T.codeChipBg || "#050d09", bgOp: num(T.codeChipBgOpacity) ?? 0.72, ink };
}

// ── the flood ripple, on its room's floor ───────────────────────────────────
const RIPPLE_VS = `varying vec2 vP;
void main(){ vP = position.xz; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const RIPPLE_FS = `uniform vec2 uC; uniform float uR, uN, uPh, uA, uTint, uK, uOn, uW; uniform vec3 uColor;
varying vec2 vP;
void main(){
  vec2 d = vP - uC;
  float r = length(d), a = atan(d.y, d.x) + uA, alpha = uTint * uOn;
  for (int k = 0; k < 3; k++) {
    if (float(k) >= uN) break;
    float ph = fract(uPh - float(k) / uN);
    float rr = mix(uR * ${FLOOD_RIPPLE.from.toFixed(2)}, uR, ph) * (1.0 + ${FLOOD_RIPPLE.amp.toFixed(2)} * sin(${FLOOD_RIPPLE.lobes.toFixed(1)} * a));
    float ring = 1.0 - smoothstep(uW * 0.5, uW, abs(r - rr));
    alpha = max(alpha, ring * ${FLOOD_RIPPLE.op.toFixed(2)} * (1.0 - ph) * uOn);
  }
  gl_FragColor = vec4(uColor, alpha * uK);
}`;

/**
 * ctx = {THREE, quality() ("low" | "high"), behind(v) (is world point v
 *        behind a wall or under a floor showing, from the eye)}
 */
export function createMarkLayer(ctx){
  const { THREE } = ctx;
  let marks = [], res = [], sig = null, last = null, cls = null;
  const _c = new THREE.Color();

  const shown = (M) => !!(M.F && M.F.group && M.F.group.visible);
  const alarming = (M) => !!(M.look && M.look.alarm);
  function clear(){
    for (const M of marks) if (M.group && M.group.parent) M.group.parent.remove(M.group);
    for (const r of res) { try { r.dispose(); } catch (_) { /* best effort */ } }
    marks = []; res = [];
  }
  function pill(text){
    const c = document.createElement("canvas");
    c.width = 168; c.height = 64;
    const g = c.getContext("2d");
    g.clearRect(0, 0, c.width, c.height);
    g.fillStyle = FLOOD_BORDER;
    g.beginPath();
    if (g.roundRect) g.roundRect(4, 4, 160, 56, 28); else g.rect(4, 4, 160, 56);
    g.fill();
    g.lineWidth = 4; g.strokeStyle = "rgba(255,255,255,0.9)"; g.stroke();
    g.fillStyle = "#ffffff";
    g.font = "800 30px system-ui, \"Segoe UI\", Roboto, sans-serif";
    g.textAlign = "center"; g.textBaseline = "middle";
    g.fillText(text, 84, 34);
    return c;
  }
  function buildFlood(M){
    const y0 = M.F.fl.elev;
    const puckMat = new THREE.MeshBasicMaterial({ color: QUIET, transparent: true, opacity: 1 });
    const rimMat = new THREE.MeshBasicMaterial({ color: FLOOD_BORDER, transparent: true, opacity: 1 });
    const puck = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.08, 0.025, 20), puckMat);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.078, 0.008, 6, 24).rotateX(Math.PI / 2), rimMat);
    puck.position.set(M.x, y0 + M.z + 0.0125, M.y);
    rim.position.set(M.x, y0 + M.z + 0.02, M.y);
    res.push(puck.geometry, rim.geometry, puckMat, rimMat);
    M.group.add(puck, rim);
    M.mats = [puckMat, rimMat];
    M.puck = puck; M.rim = rim;
    // The ripple: its room's floor (a sensor outside every room: a patch round it).
    const r0 = M.room ? Math.max(0.8, ...M.room.pts.map(p => Math.hypot(p[0] - M.x, p[1] - M.y))) : 1.6;
    const geo = M.room ? new THREE.ShapeGeometry(new THREE.Shape(M.room.pts.map(p => new THREE.Vector2(p[0], p[1]))))
      : new THREE.CircleGeometry(r0, 40).translate(M.x, M.y, 0);
    geo.rotateX(Math.PI / 2).translate(0, y0 + 0.014, 0);
    const u = { uC: { value: new THREE.Vector2(M.x, M.y) }, uR: { value: r0 }, uN: { value: 1 }, uPh: { value: 0 }, uA: { value: 0 },
                uTint: { value: TINT }, uK: { value: 1 }, uOn: { value: 0 }, uW: { value: RING_W }, uColor: { value: new THREE.Color(FLOOD_BORDER) } };
    const mat = new THREE.ShaderMaterial({ uniforms: u, vertexShader: RIPPLE_VS, fragmentShader: RIPPLE_FS, transparent: true,
      depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -4 });
    const floor = new THREE.Mesh(geo, mat);
    floor.renderOrder = 2;
    floor.visible = false;
    res.push(geo, mat);
    M.group.add(floor);
    M.ripple = { mesh: floor, u };
    // The word over everything, while it alarms.
    const c = pill("WET");
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const sm = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false, sizeAttenuation: false });
    const sp = new THREE.Sprite(sm);
    sp.renderOrder = 34;
    sp.center.set(0.5, -0.25);
    sp.position.copy(puck.position);
    sp.visible = false;
    res.push(tex, sm);
    M.group.add(sp);
    M.badge = { sprite: sp, tex, canvas: c, word: "WET" };
  }
  function buildLock(M){
    const y0 = M.F.fl.elev;
    // On the wall nearest its spot, facing the room it is in.
    const w = HOUSE.nearestWall(M.F.pieces.map(P => P.pc), M.x, M.y, LOCK_REACH);
    const at = w ? [w.x + w.n[0] * 0.02, w.y + w.n[1] * 0.02] : [M.x, M.y];
    const yaw = w ? HOUSE.yawOf(w.dir) : 0;
    const bodyMat = new THREE.MeshBasicMaterial({ color: LOCK_LOOK.off, transparent: true, opacity: 1 });
    const rimMat = new THREE.MeshBasicMaterial({ color: LOCK_BORDER, transparent: true, opacity: 1 });
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.09, 0.035), bodyMat);
    const shackle = new THREE.Mesh(new THREE.TorusGeometry(0.03, 0.009, 6, 14, Math.PI), rimMat);
    shackle.position.set(0, 0.045, 0);
    const g = new THREE.Group();
    g.add(body, shackle);
    g.position.set(at[0], y0 + M.z, at[1]);
    g.rotation.y = yaw;
    res.push(body.geometry, shackle.geometry, bodyMat, rimMat);
    M.group.add(g);
    M.mats = [bodyMat, rimMat];
    M.lock = { g, body, wall: w ? w.pc : null };
    M.pos.set(at[0], y0 + M.z, at[1]);
  }
  function build(want, floorsUi){
    clear();
    for (const R of want) {
      const F = floorsUi.find(q => q.fl.id === R.floor.id);
      if (!F) continue;
      const M = { ...R, F, group: new THREE.Group(), look: null, key: null, dim: false, room: HOUSE.roomAt(F.rooms, R.x, R.y),
                  pos: new THREE.Vector3(R.x, F.fl.elev + R.z, R.y) };
      F.group.add(M.group);
      if (M.kind === "flood") buildFlood(M); else buildLock(M);
      if (M.kind === "flood") M.pos.copy(M.puck.position);
      marks.push(M);
    }
  }
  function paint(M, h){
    const l = (h.lbe && h.lbe[M.eid]) || M.l;
    const dim = dimmed(l, h.cls);
    if (M.kind === "flood") {
      const k = floodLook(l, h.latches, h.now);
      const key = JSON.stringify([k.alarm, k.wet, k.latched, k.none, k.word, dim]);
      M.look = k; M.dim = dim;
      if (key === M.key) return false;
      M.key = key;
      M.mats[0].color.set(k.alarm ? FLOOD_BORDER : k.none ? NO_READING : QUIET);
      for (const m of M.mats) m.opacity = dim ? DIM_K + 0.1 : 1;
      M.ripple.mesh.visible = k.alarm;
      M.ripple.u.uOn.value = k.alarm ? 1 : 0;
      M.ripple.u.uK.value = dim ? DIM_K : 1;
      if (k.ripple) M.ripple.u.uN.value = k.ripple.n;
      M.badge.sprite.visible = k.alarm;
      M.badge.sprite.material.opacity = dim ? DIM_K + 0.15 : 1;
      if (k.alarm && M.badge.word !== k.word) {
        const c = pill(k.word);
        M.badge.canvas.getContext("2d").clearRect(0, 0, c.width, c.height);
        M.badge.canvas.getContext("2d").drawImage(c, 0, 0);
        M.badge.word = k.word;
        M.badge.tex.needsUpdate = true;
      }
      return true;
    }
    const k = lockLook(l, M.color);
    const key = JSON.stringify([k.state, k.body, dim]);
    M.look = k; M.dim = dim;
    if (key === M.key) return false;
    M.key = key;
    const bg = h.bg || null;
    M.mats[0].color.set(k.body); M.mats[1].color.set(k.rim);
    // Faded as the fixtures fade: toward the ground it stands over.
    if (dim) for (const m of M.mats) m.color.lerp(bg ? _c.copy(bg) : _c.set("#0c110f"), 1 - DIM_K);
    return true;
  }
  /** One step of the ripples (t: performance.now()). */
  function step(M, t){
    if (!M.ripple || !alarming(M) || !M.look.ripple) return;
    const r = M.look.ripple;
    M.ripple.u.uPh.value = (t % r.ms) / r.ms;
    M.ripple.u.uA.value = (t % r.spinMs) / r.spinMs * Math.PI * 2;
    // The pill breathes with the first ripple.
    M.badge.k = 1 + 0.1 * Math.sin((t % r.ms) / r.ms * Math.PI * 2);
  }

  return {
    /** Draw what is placed, then what each reads now. h = {model, floors
     *  (the view's floorsUi), F (the reading's floors: byId, canon), lbe,
     *  hidden, devices (the 3D file's heights), gen (the shell's build), cls
     *  (the class chips' pick), latches (floodLatches), now (ms), bg (the
     *  scene's background colour)}. True when anything drawn changed. */
    sync(h){
      let changed = false;
      const zs = h.devices || {};
      const s = [marksSignature(h.model, h.lbe, h.hidden), h.gen,
        JSON.stringify(Object.keys(zs).filter(k => markKindOf(h.lbe && h.lbe[k])).sort().map(k => [k, zs[k] && zs[k].z_m]))].join("|");
      if (s !== sig) {
        sig = s;
        const want = h.F ? readMarks(h.model, h.F, h.lbe, h.hidden).map(R => {
          const F = h.floors.find(q => q.fl.id === R.floor.id);
          const ceil = F ? F.fl.h - HOUSE.SLAB_T : 2.65;
          return { ...R, z: markZ(R.kind, ceil, zs[R.eid] || null), zDefault: markZ(R.kind, ceil, null) };
        }) : [];
        build(want, h.floors || []);
        changed = true;
      }
      cls = h.cls || null;
      for (const M of marks) if (paint(M, h)) changed = true;
      if (changed && last !== null) for (const M of marks) step(M, last);
      return changed;
    },
    /** The view's clock (t: performance.now()): the ripples, moved. */
    tick(t){
      const now = marks.filter(M => alarming(M) && shown(M));
      if (!now.length) { last = null; return; }
      last = t;
      for (const M of now) step(M, t);
    },
    /** How often to draw while an alarm shows (ms), or 0. */
    rate(){
      for (const M of marks) if (alarming(M) && shown(M)) return MARK_MS[ctx.quality() === "high" ? "high" : "low"];
      return 0;
    },
    /** The alarms' words sized for camera c over a view H px high (k: metres per px at 1 m). */
    size(c, H){
      const k = 2 * Math.tan((c.fov || 40) / 2 * Math.PI / 180) / Math.max(1, H);
      for (const M of marks) {
        if (!M.badge || !M.badge.sprite.visible) continue;
        const hPx = BADGE_PX * (M.badge.k || 1);
        M.badge.sprite.scale.set(hPx * (168 / 64) * k, hPx * k, 1);
      }
    },
    /** What a press can land on: not faded, on a floor that shows. */
    pickable(){ return marks.filter(M => shown(M) && !M.dim).map(M => ({ eid: M.eid, v: M.pos })); },
    /** The edit's Heights: {F, z, zDefault, x, y} for eid, or null. */
    info(eid){ const M = marks.find(x => x.eid === eid); return M ? { F: M.F, z: M.z, zDefault: M.zDefault, x: M.pos.x, y: M.pos.z, kind: M.kind } : null; },
    /** Heights' slider: moved in place (stored: the draft's record). */
    move(eid, stored){
      const M = marks.find(x => x.eid === eid);
      if (!M) return false;
      const z = markZ(M.kind, M.F.fl.h - HOUSE.SLAB_T, stored || null), d = z - M.z;
      M.z = z;
      // The sensor itself goes up or down; its ripple stays on the floor.
      for (const o of M.lock ? [M.lock.g] : [M.puck, M.rim, M.badge.sprite]) o.position.y += d;
      M.pos.y += d;
      return true;
    },
    /** Every one drawn, for a code chip or Find active: {eid, F, v}. */
    places(){ return marks.map(M => ({ eid: M.eid, F: M.F, v: M.pos, kind: M.kind })); },
    state(){
      return marks.map(M => ({ eid: M.eid, kind: M.kind, z: M.z, zDefault: M.zDefault, shown: shown(M), dim: M.dim,
        room: M.room ? M.room.name : null, look: M.look ? { ...M.look } : null,
        body: M.mats ? "#" + M.mats[0].color.getHexString() : null, opacity: M.mats ? M.mats[0].opacity : null,
        wall: M.lock ? !!M.lock.wall : null, at: [M.pos.x, M.pos.y, M.pos.z].map(v => Math.round(v * 1000) / 1000),
        ripple: M.ripple ? { on: M.ripple.mesh.visible, n: M.ripple.u.uN.value, ph: Math.round(M.ripple.u.uPh.value * 1000) / 1000,
                             k: M.ripple.u.uK.value } : null,
        badge: M.badge ? { on: M.badge.sprite.visible, word: M.badge.word, onTop: !M.badge.sprite.material.depthTest } : null }));
    },
    get cls(){ return cls; },
    dispose(){ clear(); sig = null; },
  };
}

// ── the code chips ──────────────────────────────────────────────────────────
/**
 * ctx = {THREE, behind(v)}. Each frame: size(camera, H, show) with show
 * whether codes are on at all (the preference and room scale).
 */
export function createCodeLayer(ctx){
  const { THREE } = ctx;
  const chips = new Map();                  // eid -> {sprite, tex, canvas, key, F, v, dim}
  let shownN = 0, camKey = null;
  const _p = new THREE.Vector3();
  function draw(C, look){
    const c = C.canvas, g = c.getContext("2d");
    const fs = 30, w = Math.min(c.width - 4, Math.ceil(look.text.length * fs * 0.64 + fs * 0.9)), h = Math.round(fs * 1.5);
    g.clearRect(0, 0, c.width, c.height);
    const x0 = (c.width - w) / 2, y0 = (c.height - h) / 2;
    g.beginPath();
    if (g.roundRect) g.roundRect(x0, y0, w, h, h * 0.35); else g.rect(x0, y0, w, h);
    g.globalAlpha = look.bgOp; g.fillStyle = look.bg; g.fill();
    g.globalAlpha = 0.45; g.lineWidth = 2; g.strokeStyle = look.ink; g.stroke();
    g.globalAlpha = 1;
    g.fillStyle = look.ink;
    g.font = `700 ${fs}px ui-monospace, monospace`;
    g.textAlign = "center"; g.textBaseline = "middle";
    g.fillText(look.text, c.width / 2, c.height / 2 + 1);
    C.tex.needsUpdate = true;
    C.w = w / c.width;
  }
  function make(eid){
    const c = document.createElement("canvas");
    c.width = 200; c.height = 56;
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false, sizeAttenuation: false });
    const sprite = new THREE.Sprite(mat);
    sprite.renderOrder = 29;                                   // under the room's names and its readouts
    sprite.visible = false;
    return { eid, sprite, tex, canvas: c, key: null, F: null, v: null, dim: false, w: 0.5, text: "" };
  }
  function drop(eid){
    const C = chips.get(eid);
    if (!C) return;
    if (C.sprite.parent) C.sprite.parent.remove(C.sprite);
    C.tex.dispose(); C.sprite.material.dispose();
    chips.delete(eid);
  }
  return {
    /** list: [{eid, F, v (world point), look (chipLook), dim}] — every
     *  device with a code that is drawn. */
    sync(list){
      const want = new Map();
      for (const d of list || []) if (d && d.look && d.F) want.set(d.eid, d);
      let changed = false;
      for (const eid of [...chips.keys()]) if (!want.has(eid) || chips.get(eid).F !== want.get(eid).F) { drop(eid); changed = true; }
      for (const [eid, d] of want) {
        let C = chips.get(eid);
        if (!C) { C = make(eid); chips.set(eid, C); changed = true; }
        if (C.sprite.parent !== d.F.group) { d.F.group.add(C.sprite); changed = true; }
        C.F = d.F; C.v = d.v; C.dim = !!d.dim;
        C.sprite.position.copy(d.v);
        const key = JSON.stringify(d.look);
        if (key !== C.key) { C.key = key; C.text = d.look.text; draw(C, d.look); changed = true; }
      }
      camKey = null;
      return changed;
    },
    /** Sized and shown for camera c over a view H px high; show: codes on
     *  at all (the preference, and room scale). */
    size(c, H, show){
      const k = 2 * Math.tan((c.fov || 40) / 2 * Math.PI / 180) / Math.max(1, H);
      // A covered code (behind a wall, under a floor) is worked out only when the camera moved.
      const key = show ? c.matrixWorld.elements.map(v => v.toFixed(3)).join(",") + H : "off";
      const again = key !== camKey;
      camKey = key;
      shownN = 0;
      for (const C of chips.values()) {
        let on = !!show && C.F.group.visible;
        if (on && again) {
          _p.copy(C.v).project(c);
          C.out = !(_p.z > -1 && _p.z < 1 && Math.abs(_p.x) <= 1.05 && Math.abs(_p.y) <= 1.05);
          C.hid = !C.out && !!(ctx.behind && ctx.behind(C.v));
        }
        on = on && !C.out && !C.hid;
        C.sprite.visible = on;
        if (!on) continue;
        shownN++;
        C.sprite.scale.set(CODE_PX * (200 / 56) * k, CODE_PX * k, 1);
        C.sprite.material.opacity = C.dim ? DIM_K : 1;            // faded with its device
        C.sprite.center.set(0.5, 1 + 10 / CODE_PX);            // under the device, clear of it
      }
    },
    state(){ return { shown: shownN, chips: [...chips.values()].map(C => ({ eid: C.eid, text: C.text, on: C.sprite.visible, dim: C.dim,
      key: C.key ? JSON.parse(C.key) : null })) }; },
    dispose(){ for (const eid of [...chips.keys()]) drop(eid); },
  };
}
