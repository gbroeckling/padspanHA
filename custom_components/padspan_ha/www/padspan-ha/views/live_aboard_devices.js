// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
// See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
//
// Live Aboard, the 3D house (docs/IDEA_ATLAS_3D_HOUSE.md): furniture that is
// a device behaves like it, live (P5). A piece linked with "This is a
// device…" (its entity_id and entity_reg_id) shows what its device is doing,
// through the parts its builder hands over (live_aboard_furniture.js
// group.userData.parts) and nothing else of the builder's:
//
//   glow    a lamp glows in its light's colour and brightness (the 3D view's
//           own reading of a light, live_aboard_house.js lightLook); a plug
//           or switch behind it, warm white while on
//   screen  a TV lights while its media player is on, brighter playing
//   spin    a fan's blades turn with the fan, faster with its speed
//   run     a washer or dryer shakes gently while it runs (an on/off, a
//           running word, or a power reading over a few watts); a speaker's
//           drivers pulse while it plays
//   dock    a robot vacuum or mower sits on its dock while docked, circles
//           slowly near it while cleaning or mowing (they rarely say where
//           they are), and waits beside it otherwise
//   warm    a radiator glows warm while its climate entity is heating
//   charge  a car or charger shows a charging glow while charging
//
// Emergency lights are outlined while the Atlas's emergency lighting test
// runs. A piece whose entity was renamed follows it by its registry id; one
// whose entity is gone wears a small "Unlinked" badge and is never removed.
//
// What moves (a fan, a washer, a robot out) moves on the view's live clock,
// at most every DEVICE_MS, and only on a floor that shows; Low turns slower,
// and does not shake or send the robot round. Nothing moving, nothing is
// drawn. Imports no three.js: the view hands it in.

const HOUSE = await import(`./live_aboard_house.js${new URL(import.meta.url).search}`);

/** How often what a device does is drawn while it moves (ms), by profile. */
export const DEVICE_MS = { high: 40, low: 100 };
/** The kinds of live behaviour a builder's kind can have (FURNITURE[kind].live). */
export const LIVE_KINDS = ["glow", "screen", "spin", "run", "dock", "warm", "charge"];

const TAU = Math.PI * 2;
const RUN_W = 5;                                  // a washer drawing more than this is running (W)
const EMERGENCY = "#ef4444";                      // the outline while the test runs
const SCREEN_ON = "#9cc2ff", SCREEN_IDLE = "#3b5878", WARM = "#ff5a1f", CHARGE = "#34d399";
const BADGE = { w: 0.46, h: 0.15, up: 0.16 };     // the "Unlinked" badge (m) and its height over the piece

const word = (v) => String(v === undefined || v === null ? "" : v).trim().toLowerCase().replace(/[\s-]+/g, "_");
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const fin = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);

// What a state's word means, kind by kind.
const SCREEN_LIT = new Set(["on", "idle", "playing", "paused", "buffering"]);
const PLAYING = new Set(["playing", "buffering"]);
const RUNNING = new Set(["on", "run", "running", "wash", "washing", "main_wash", "prewash", "pre_wash", "rinse", "rinsing",
                         "spin", "spinning", "dry", "drying", "active", "busy", "in_progress", "started", "playing"]);
const DOCKED = new Set(["docked", "charging", "off"]);
const OUT = new Set(["cleaning", "mowing", "returning", "on"]);
const HEATING = new Set(["heating", "heat", "on", "preheating"]);
const CHARGING = new Set(["charging", "on", "true"]);

// ── which entity a piece is, now ────────────────────────────────────────────
/**
 * piece {entity_id, entity_reg_id}; states (hass.states); regIds {registry
 * id: entity id} (the registry the Atlas already reads, or null); entities
 * (hass.entities, or null). → {eid, how}: "none" (not a device), "linked",
 * "renamed" (followed by its registry id) or "unlinked" (its entity is gone:
 * eid null, `was` the old id).
 */
export function resolveLink(piece, states, regIds, entities){
  const eid = piece && typeof piece.entity_id === "string" && piece.entity_id ? piece.entity_id : null;
  if (!eid) return { eid: null, how: "none" };
  const st = states && typeof states === "object" ? states : {};
  if (st[eid]) return { eid, how: "linked" };
  const reg = typeof piece.entity_reg_id === "string" && piece.entity_reg_id ? piece.entity_reg_id : null;
  if (reg) {
    let now = regIds && typeof regIds === "object" && typeof regIds[reg] === "string" ? regIds[reg] : null;
    if (!now && entities && typeof entities === "object") {
      for (const [k, e] of Object.entries(entities)) if (e && e.id === reg) { now = typeof e.entity_id === "string" ? e.entity_id : k; break; }
    }
    if (now && now !== eid && st[now]) return { eid: now, how: "renamed" };
  }
  // In the registry with no state yet (Home Assistant starting): still it.
  if (entities && typeof entities === "object" && entities[eid]) return { eid, how: "linked" };
  return { eid: null, how: "unlinked", was: eid };
}

// ── what a device is doing ──────────────────────────────────────────────────
/** A light's record as the Atlas keeps one, from its Home Assistant state. */
function recordOf(st){
  const a = (st && st.attributes) || {};
  const k = fin(a.color_temp_kelvin) ?? (fin(a.color_temp) ? 1e6 / a.color_temp : null);
  return { state: st ? st.state : "unavailable", rgb: Array.isArray(a.rgb_color) ? a.rgb_color : null, ct: k, bri: fin(a.brightness) };
}
/**
 * live (FURNITURE[kind].live), kind (the recipe's), eid, st (its Home
 * Assistant state, or null), rec (the Atlas's record for it, or null: lights
 * and fans have one) → what the piece shows. Plain numbers and words only.
 */
export function deviceLook(live, kind, eid, st, rec){
  const s = word(st && st.state), a = (st && st.attributes) || {};
  const dom = String(eid || "").split(".")[0];
  const gone = !st || s === "unavailable" || s === "unknown" || s === "";
  switch (live) {
    case "glow": {
      // The Atlas's record first (its effective state, colour and level).
      const r = rec || (dom === "light" ? recordOf(st) : { state: s === "on" ? "on" : gone ? "unavailable" : "off", ct: 2700 });
      const k = HOUSE.lightLook(r);
      return { live, on: k.on, rgb: k.rgb.map(v => Math.round(v * 1000) / 1000), f: Math.round(k.f * 1000) / 1000 };
    }
    case "screen": {
      const on = !gone && (SCREEN_LIT.has(s) || s === "on");
      return { live, on, playing: on && PLAYING.has(s) };
    }
    case "spin": {
      const on = !gone && (rec ? word(rec.state) === "on" : s === "on");
      const pct = fin(rec && rec.pct) ?? fin(a.percentage);
      return { live, on, rps: on ? Math.round((0.35 + 2.2 * clamp(pct ?? 60, 0, 100) / 100) * 1000) / 1000 : 0 };
    }
    case "run": {
      let on = false;
      if (!gone) {
        const n = Number(st.state), unit = word(a.unit_of_measurement);
        if (dom === "media_player") on = PLAYING.has(s);
        else if (Number.isFinite(n) && (unit === "w" || unit === "kw")) on = n * (unit === "kw" ? 1000 : 1) > RUN_W;
        else on = RUNNING.has(s);
      }
      return { live, on, pulse: kind === "speaker" };
    }
    case "dock": {
      const at = gone || DOCKED.has(s) ? "dock" : OUT.has(s) ? "out" : "beside";
      return { live, at };
    }
    case "warm": {
      const act = a.hvac_action !== undefined && a.hvac_action !== null ? word(a.hvac_action) : null;
      return { live, on: !gone && (act !== null ? act === "heating" || act === "preheating" : HEATING.has(s)) };
    }
    case "charge":
      return { live, on: !gone && (CHARGING.has(s) || a.charging === true || word(a.charging_state) === "charging") };
    default:
      return null;
  }
}

// ── the layer: what each linked piece shows, in the view ───────────────────
/**
 * ctx = {THREE, layer (live_aboard_furnish.js createPieceLayer), FURN() (the
 *        builders, or null), quality() ("low" | "high"), halo (the view's
 *        fixtures' glow, a PointsMaterial with vertex colours)}
 */
export function createDeviceLayer(ctx){
  const { THREE } = ctx;
  const recs = new Map();                   // piece id -> what it shows and its extras
  const _v = new THREE.Vector3(), _c = new THREE.Color();
  let quality = "low", last = null, badgeMat = null, badgeTex = null, outlineGeo = null, outlineMat = null, madeSprite = false;

  const bodyOf = (root) => root.children.find(c => c.userData && c.userData.parts) || null;
  const sizeOf = (R) => (R.body && R.body.userData && R.body.userData.size) || { w: 0.5, d: 0.5, h: 0.5 };
  const meshes = (list) => (Array.isArray(list) ? list : list ? [list] : []).filter(m => m && m.material && m.material.emissive);
  const shown = (R) => !!(R.root.parent && R.root.parent.visible);
  const moving = (R) => R.rps > 0 || R.shake || R.pulse || R.circling;

  /** A new body (a new piece, a new look, a new profile): its parts as built. */
  function rest(R, body){
    for (const [o, b] of R.base) { o.position.copy(b.p); o.rotation.copy(b.r); o.scale.copy(b.s); }
    R.base = new Map();
    R.body = body;
    R.parts = (body && body.userData.parts) || {};
    for (const o of [R.parts.spin, R.parts.run, R.parts.dock]) {
      if (o && o.position) R.base.set(o, { p: o.position.clone(), r: o.rotation.clone(), s: o.scale.clone() });
    }
    if (R.halo) { R.root.remove(R.halo); R.halo.geometry.dispose(); R.halo = null; }
    R.angle = 0; R.key = null;
  }
  function badge(){
    if (badgeMat) return badgeMat;
    const c = document.createElement("canvas");
    c.width = 184; c.height = 60;
    const g = c.getContext("2d");
    g.fillStyle = "rgba(51,65,85,0.92)";
    g.beginPath();
    if (g.roundRect) g.roundRect(2, 2, 180, 56, 28); else g.rect(2, 2, 180, 56);
    g.fill();
    g.fillStyle = "#e2e8f0";
    g.font = "600 30px system-ui, sans-serif";
    g.textAlign = "center"; g.textBaseline = "middle";
    g.fillText("Unlinked", 92, 31);
    badgeTex = new THREE.CanvasTexture(c);
    badgeTex.colorSpace = THREE.SRGBColorSpace;
    badgeMat = new THREE.SpriteMaterial({ map: badgeTex, transparent: true, depthWrite: false });
    return badgeMat;
  }
  function outline(){
    if (!outlineGeo) {
      const box = new THREE.BoxGeometry(1, 1, 1);
      outlineGeo = new THREE.EdgesGeometry(box);
      box.dispose();
      outlineMat = new THREE.LineBasicMaterial({ color: EMERGENCY });
    }
    return new THREE.LineSegments(outlineGeo, outlineMat);
  }
  function setEmissive(list, hex, k){
    for (const m of meshes(list)) {
      if (k > 0) m.material.emissive.set(hex).multiplyScalar(k); else m.material.emissive.setRGB(0, 0, 0);
    }
  }
  /** Where the lamp's bulb is, in the piece's own frame (the halo and the real light go there). */
  function bulbAt(R){
    const g = meshes(R.parts.glow), b = g[g.length - 1];
    if (!b) return null;
    if (!b.geometry.boundingSphere) b.geometry.computeBoundingSphere();
    R.root.updateWorldMatrix(true, true);
    return R.root.worldToLocal(b.localToWorld(_v.copy(b.geometry.boundingSphere.center))).clone();
  }
  /** A glow round the bulb (or the charge light), as the fixtures have:
   *  off, its colour is black, never hidden. */
  function halo(R, g, col, k){
    if (!R.halo && R.eid && g.length && ctx.halo) {
      const at = bulbAt(R);
      if (at) {
        const geo = new THREE.BufferGeometry();
        geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array([at.x, at.y, at.z]), 3));
        geo.setAttribute("color", new THREE.BufferAttribute(new Float32Array(3), 3));
        R.halo = new THREE.Points(geo, ctx.halo);
        R.halo.renderOrder = 5; R.halo.frustumCulled = false;
        R.bulb = at;
        R.root.add(R.halo);
      }
    }
    if (R.halo) {
      const attr = R.halo.geometry.attributes.color;
      attr.setXYZ(0, col.r * k, col.g * k, col.b * k);
      attr.needsUpdate = true;
    }
  }
  /** Draw what R shows now. */
  function apply(R){
    const k = R.look, live = R.live, high = quality === "high", P = R.parts, S = sizeOf(R);
    // The badge while its entity is gone; the outline while the test runs.
    if (R.how === "unlinked" && !R.badge) {
      R.badge = new THREE.Sprite(badge());
      madeSprite = true;
      R.badge.renderOrder = 6;
      R.badge.scale.set(BADGE.w, BADGE.h, 1);
      R.root.add(R.badge);
    } else if (R.how !== "unlinked" && R.badge) { R.root.remove(R.badge); R.badge = null; }
    if (R.badge) R.badge.position.set(0, S.h + BADGE.up, 0);
    if (R.em && !R.outline) { R.outline = outline(); R.root.add(R.outline); }
    else if (!R.em && R.outline) { R.root.remove(R.outline); R.outline = null; }
    if (R.outline) { R.outline.scale.set(S.w + 0.1, S.h + 0.08, S.d + 0.1); R.outline.position.set(0, (S.h + 0.08) / 2 - 0.02, 0); }
    // The parts at rest, then what it does now.
    for (const [o, b] of R.base) { o.position.copy(b.p); o.rotation.copy(b.r); o.scale.copy(b.s); }
    R.rps = 0; R.shake = false; R.pulse = false; R.circling = false;
    const on = !!(k && k.on);
    if (live === "glow" || live === "charge") {
      const g = meshes(P.glow);
      if (live === "glow") {
        _c.setRGB(k ? k.rgb[0] : 1, k ? k.rgb[1] : 1, k ? k.rgb[2] : 1, THREE.SRGBColorSpace);
        R.color = _c.clone();
        g.forEach((m, i) => {
          if (!on) { m.material.emissive.setRGB(0, 0, 0); return; }
          const last2 = i === g.length - 1;                  // the bulb, brighter and whiter than the shade
          m.material.emissive.copy(_c).lerp(new THREE.Color(1, 1, 1), last2 ? 0.5 : 0.15).multiplyScalar(last2 ? 0.7 + 0.3 * k.f : 0.2 + 0.45 * k.f);
        });
        halo(R, g, R.color, on ? k.f * 0.8 : 0);
      } else {
        // A charge port or ring is a few centimetres: its glow carries a halo too.
        setEmissive(g, CHARGE, on ? 0.9 : 0);
        halo(R, g, _c.set(CHARGE), on ? 0.7 : 0);
      }
    } else if (live === "screen") setEmissive(P.screen, k && k.playing ? SCREEN_ON : SCREEN_IDLE, on ? (k.playing ? 0.85 : 0.7) : 0);
    else if (live === "warm") setEmissive(P.warm, WARM, on ? 0.55 : 0);
    else if (live === "spin") R.rps = k ? k.rps * (high ? 1 : 0.5) : 0;
    else if (live === "run") { if (on && high) { if (k.pulse) R.pulse = true; else R.shake = true; } }
    else if (live === "dock" && P.dock && R.base.has(P.dock)) {
      const b = R.base.get(P.dock), at = k ? k.at : "dock";
      if (at === "out" && high) R.circling = true;
      else if (at !== "dock") P.dock.position.set(b.p.x + S.w * 0.35, b.p.y, b.p.z + Math.max(0.35, S.d * 0.6));   // waiting beside it
    }
    if (moving(R)) step(R, last === null ? 0 : last, 0);
  }
  /** One step of what moves (t: ms, dt: s). */
  function step(R, t, dt){
    const P = R.parts, s = t / 1000;
    if (R.rps > 0 && P.spin && R.base.has(P.spin)) {
      R.angle = (R.angle + R.rps * TAU * dt) % TAU;
      P.spin.rotation.z = R.base.get(P.spin).r.z + R.angle;
    }
    if ((R.shake || R.pulse) && P.run && R.base.has(P.run)) {
      const b = R.base.get(P.run);
      if (R.shake) {
        P.run.position.set(b.p.x + 0.0035 * Math.sin(TAU * 8.7 * s), b.p.y, b.p.z + 0.0022 * Math.sin(TAU * 6.3 * s + 1));
        P.run.rotation.y = b.r.y + 0.006 * Math.sin(TAU * 5.1 * s + 2);
      } else P.run.scale.z = b.s.z * (1 + 0.35 * (0.5 + 0.5 * Math.sin(TAU * 2 * s)));
    }
    if (R.circling && P.dock && R.base.has(P.dock)) {
      const b = R.base.get(P.dock), mower = R.kind === "mower_dock", r = mower ? 0.9 : 0.5;
      R.angle = (R.angle + (mower ? 0.3 : 0.45) * dt) % TAU;
      P.dock.position.set(b.p.x + r * Math.sin(R.angle), b.p.y, b.p.z + 0.12 + r - r * Math.cos(R.angle));
      P.dock.rotation.y = b.r.y - R.angle;
    }
  }
  function drop(id){
    const R = recs.get(id);
    if (!R) return;
    for (const [o, b] of R.base) { o.position.copy(b.p); o.rotation.copy(b.r); o.scale.copy(b.s); }
    setEmissive([...meshes(R.parts.glow), ...meshes(R.parts.screen), ...meshes(R.parts.warm)], "#000000", 0);
    for (const x of [R.badge, R.outline, R.halo]) if (x) R.root.remove(x);
    if (R.halo) R.halo.geometry.dispose();
    recs.delete(id);
  }

  return {
    /** What each linked piece shows now. pieces: {id: piece} (the view's,
     *  the draft's while editing); h = {states, regIds, entities, lbe (the
     *  Atlas's records), emergency (a Set of entity ids while the test
     *  runs, or null)}. True when anything drawn changed. */
    sync(pieces, h){
      const want = pieces && typeof pieces === "object" ? pieces : {};
      const H = h || {};
      quality = ctx.quality() === "high" ? "high" : "low";
      let changed = false;
      for (const id of [...recs.keys()]) {
        const R = recs.get(id);
        if (!want[id] || ctx.layer.rootOf(id) !== R.root) { drop(id); changed = true; }
      }
      const FURN = ctx.FURN ? ctx.FURN() : null;
      for (const [id, p] of Object.entries(want)) {
        const root = p && p.recipe ? ctx.layer.rootOf(id) : null;
        if (!root) continue;
        let R = recs.get(id);
        if (!R) { R = { id, root, body: null, parts: {}, base: new Map(), key: null, angle: 0, badge: null, outline: null, halo: null }; recs.set(id, R); }
        const body = bodyOf(root);
        if (R.body !== body) rest(R, body);
        const kind = String(p.recipe.kind || ""), def = FURN && FURN.FURNITURE ? FURN.FURNITURE[kind] : null;
        R.kind = kind;
        R.live = def && LIVE_KINDS.includes(def.live) ? def.live : null;
        const link = resolveLink(p, H.states, H.regIds, H.entities);
        R.eid = link.eid; R.how = link.how;
        const st = link.eid && H.states ? H.states[link.eid] || null : null;
        R.look = R.live && link.eid ? deviceLook(R.live, kind, link.eid, st, (H.lbe && H.lbe[link.eid]) || null) : null;
        R.em = !!(link.eid && H.emergency && H.emergency.has(link.eid));
        const key = JSON.stringify([link.how, R.look, R.em, quality, sizeOf(R)]);
        if (key === R.key) continue;
        R.key = key;
        apply(R);
        changed = true;
      }
      return changed;
    },
    /** The live clock (t: performance.now()): what moves, moved. */
    tick(t){
      const now = [...recs.values()].filter(moving);
      if (!now.length) { last = null; return; }              // starting again: no leap for the time at rest
      const dt = last === null ? 0 : Math.min(0.25, Math.max(0, (t - last) / 1000));
      last = t;
      for (const R of now) step(R, t, dt);
    },
    /** How often to draw for what moves on a floor that shows (ms), or 0. */
    rate(){
      for (const R of recs.values()) if (moving(R) && shown(R)) return DEVICE_MS[quality];
      return 0;
    },
    /** An outline round box (a THREE.Box3): an emergency light's fixture. */
    outline(box){
      const o = outline();
      box.getCenter(o.position);
      box.getSize(o.scale);
      return o;
    },
    /** Is a lamp showing the light eid (its fixture then steps aside)? A
     *  piece that cannot glow (a sofa linked to a light) leaves it in place. */
    has(eid){ for (const R of recs.values()) if (R.eid === eid && R.live === "glow" && R.root.parent) return true; return false; },
    /** Linked pieces on a floor that shows, for a press: {id, eid, root}. */
    pickable(){ return [...recs.values()].filter(R => R.eid && shown(R)).map(R => ({ id: R.id, eid: R.eid, root: R.root })); },
    /** Lamps glowing on a floor that shows: where their light comes from. */
    lamps(){
      const out = [];
      for (const R of recs.values()) {
        if (R.live !== "glow" || !R.look || !R.look.on || !R.bulb || !shown(R)) continue;
        out.push({ eid: R.eid, pos: R.root.localToWorld(R.bulb.clone()), color: R.color, k: R.look.f * 0.8 });
      }
      return out;
    },
    state(){
      const hex = (list) => meshes(list).map(m => "#" + m.material.emissive.getHexString());
      return [...recs.values()].map(R => ({ id: R.id, eid: R.eid, how: R.how, live: R.live, look: R.look, rps: R.rps || 0,
        shake: !!R.shake, pulse: !!R.pulse, circling: !!R.circling, badge: !!R.badge, outline: !!R.outline, shown: shown(R),
        glow: hex(R.parts.glow), screen: hex(R.parts.screen), warm: hex(R.parts.warm),
        halo: R.halo ? [...R.halo.geometry.attributes.color.array].map(v => Math.round(v * 1000) / 1000) : null,
        spin: R.parts.spin ? Math.round(R.parts.spin.rotation.z * 1000) / 1000 : null,
        run: R.parts.run ? [R.parts.run.position.x, R.parts.run.position.z, R.parts.run.scale.z].map(v => Math.round(v * 10000) / 10000) : null,
        dock: R.parts.dock ? [R.parts.dock.position.x, R.parts.dock.position.z].map(v => Math.round(v * 1000) / 1000) : null }));
    },
    dispose(){
      for (const id of [...recs.keys()]) drop(id);
      if (badgeMat) { badgeMat.dispose(); badgeTex.dispose(); badgeMat = null; }
      if (outlineGeo) { outlineGeo.dispose(); outlineMat.dispose(); outlineGeo = null; }
      // three.js's one geometry for every sprite keeps a listener per renderer
      // that drew one (see the view's teardown): let go of it.
      if (madeSprite) { try { new THREE.Sprite().geometry.dispose(); } catch (_) { /* best effort */ } }
    },
  };
}
