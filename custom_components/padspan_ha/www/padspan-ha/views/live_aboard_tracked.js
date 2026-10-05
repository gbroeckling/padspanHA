// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
// See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
//
// Live Aboard, the 3D house (docs/IDEA_ATLAS_3D_HOUSE.md, "Beacons, scanners
// and people from photos"): what PadSpan tracks, in the house, live (P6).
//
//   scanners  a scanner with a look (the 3D file's devices[address].recipe)
//             stands where the map keeps it (scanner_positions_m, at its own
//             height z_m: presence uses those, so 3D only reads them)
//   beacons   a beacon with a look (devices[its key].recipe) is drawn where
//             PadSpan tracks it now, and moves there
//   people    each Home Assistant person found through the phone or tag they
//             carry walks to it: their figure (figures["person.x"]) if they
//             have one, a soft marker if not
//
// Beacons and people are the people layer (Show people, off by default): its
// positions are the live snapshot Overview already reads, handed in by the
// view; off, nothing of it is read or drawn. Someone walking is drawn on the
// view's live clock, at most every WALK_MS; standing still, nothing is drawn.
// Imports no three.js: the view hands it in, with the builders.

/** How often someone walking is drawn (ms), by profile. */
export const WALK_MS = { high: 40, low: 100 };
const WALK_SPEED = 1.3;                    // m/s: a stroll across a room
const JUMP_M = 8;                          // further than this (or another floor): there at once
const CARRY_H = 0.9;                       // a beacon's height above its floor: in a pocket, on keys
const SCANNER_Z = 2.2;                     // a scanner with no height: the map's own default
const MARKER = "#7dd3fc";                  // someone with no figure: a soft marker
// A tag is a few centimetres: drawn at least this big (m) so it can be seen
// from across the house; a scanner too.
const SHOWN_M = { beacon: 0.22, scanner: 0.16 };

const fin = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const low = (v) => String(v || "").trim().toLowerCase();

/**
 * What the live snapshot (Overview's, live_snapshot) tracks with a place:
 * {key, label, x, y, floor_id, linked: [entity ids]}. Not stale, not a ghost;
 * the same "a place it truly knows" rule as the flat Atlas's beacons.
 */
export function trackedOf(snapshot){
  const list = snapshot && snapshot.objects && Array.isArray(snapshot.objects.list) ? snapshot.objects.list : [];
  const out = [];
  for (const o of list) {
    if (!o || typeof o !== "object" || o._stale || o._ghost) continue;
    const x = fin(o.x_m), y = fin(o.y_m), key = String(o.key || o.address || o.entity_id || "");
    if (x === null || y === null || !key) continue;
    out.push({ key, x, y, floor_id: o.floor_id || null, linked: Array.isArray(o.linked_entities) ? o.linked_entities.map(String) : [],
               label: String(o.user_label || o.private_ble_name || o.name || ""), shown: !!(o.user_label || o.identified),
               beacon: o.kind === "ble" || o.kind === "private_ble" || o.kind === "ibeacon" });
  }
  return out;
}
/**
 * Each Home Assistant person, and the tracked thing that is theirs (or
 * null): the phone or tag behind their person entity (its device trackers),
 * or one named as they or their trackers are — how PadSpan already places
 * known people (ws_occupancy.py). Each tracked thing is someone's once.
 */
export function peopleOf(states, tracked){
  const st = states && typeof states === "object" ? states : {};
  const taken = new Set(), out = [];
  for (const eid of Object.keys(st).filter(e => e.startsWith("person.")).sort()) {
    const a = (st[eid] && st[eid].attributes) || {};
    const trackers = new Set([...(Array.isArray(a.device_trackers) ? a.device_trackers : []), a.source].filter(Boolean).map(String));
    const names = new Set([low(a.friendly_name || eid.slice(7).replace(/_/g, " "))]);
    for (const t of trackers) {
      const fn = st[t] && st[t].attributes && st[t].attributes.friendly_name;
      if (fn) names.add(low(fn));
      names.add(low(t.split(".").slice(1).join(".").replace(/_/g, " ")));
    }
    names.delete("");
    const at = (tracked || []).find(o => !taken.has(o.key) && (o.linked.some(e => trackers.has(e)) || (o.label && names.has(low(o.label))))) || null;
    if (at) taken.add(at.key);
    out.push({ eid, name: String(a.friendly_name || eid), at });
  }
  return out;
}

/**
 * ctx = {THREE, FURN() (the builders, or null), floors() (the view's floors:
 *        {fl, group}), canon(fid), quality() ("low" | "high")}
 */
export function createTrackedLayer(ctx){
  const { THREE } = ctx;
  const items = new Map();                  // key -> what is drawn for it
  let quality = "low", last = null, markerRes = null;

  const floorOf = (fid) => {
    const id = ctx.canon ? ctx.canon(fid) : String(fid);
    return ctx.floors().find(F => F.fl.id === id) || null;
  };
  const shown = (I) => !!(I.F && I.F.group.visible);
  function marker(){
    if (!markerRes) {
      markerRes = {
        disc: new THREE.CircleGeometry(0.32, 28).rotateX(-Math.PI / 2),
        dot: new THREE.SphereGeometry(0.1, 16, 12),
        discMat: new THREE.MeshBasicMaterial({ color: MARKER, transparent: true, opacity: 0.32, depthWrite: false }),
        dotMat: new THREE.MeshBasicMaterial({ color: MARKER }),
      };
    }
    const g = new THREE.Group(), d = new THREE.Mesh(markerRes.disc, markerRes.discMat), b = new THREE.Mesh(markerRes.dot, markerRes.dotMat);
    d.position.y = 0.015; d.renderOrder = 2;
    b.position.y = 1.15;
    g.add(d, b);
    return g;
  }
  function body(w){
    const FURN = ctx.FURN ? ctx.FURN() : null;
    try {
      if (w.kind === "person" && w.figure && FURN && FURN.buildFigure) return { g: FURN.buildFigure(THREE, w.figure, { quality }), own: false };
      if (w.kind !== "person" && FURN && FURN.buildPiece) return { g: FURN.buildPiece(THREE, w.recipe, { quality }), own: false };
    } catch (_) { /* a marker, below */ }
    return { g: marker(), own: true };
  }
  function drop(key){
    const I = items.get(key);
    if (!I) return;
    if (I.root.parent) I.root.parent.remove(I.root);
    if (I.body && !I.body.own) { const FURN = ctx.FURN ? ctx.FURN() : null; try { if (FURN && FURN.disposePiece) FURN.disposePiece(I.body.g); } catch (_) { /* best effort */ } }
    items.delete(key);
  }
  /** What should be drawn now. */
  function wanted(d){
    const out = [];
    const looks = d.looks && typeof d.looks === "object" ? d.looks : {};
    const lookOf = (k) => (looks[k] && looks[k].recipe && typeof looks[k].recipe === "object" ? looks[k].recipe : null);
    const sp = d.model && d.model.scanner_positions_m && typeof d.model.scanner_positions_m === "object" ? d.model.scanner_positions_m : {};
    for (const [addr, s] of Object.entries(sp)) {
      const r = lookOf(addr), x = fin(s && s.x_m), y = fin(s && s.y_m);
      if (!r || x === null || y === null) continue;
      out.push({ key: "scanner:" + addr, kind: "scanner", recipe: r, floor_id: s.floor_id, x, y, z: fin(s.z_m) ?? SCANNER_Z, centre: true });
    }
    if (!d.people) return out;
    const tracked = trackedOf(d.snapshot);
    for (const o of tracked) {
      const r = lookOf(o.key);
      if (r && o.beacon) out.push({ key: "beacon:" + o.key, kind: "beacon", recipe: r, floor_id: o.floor_id, x: o.x, y: o.y, z: CARRY_H, centre: true });
    }
    const figs = d.figures && typeof d.figures === "object" ? d.figures : {};
    for (const P of peopleOf(d.states, tracked)) {
      if (!P.at) continue;
      const f = figs[P.eid] && figs[P.eid].params && typeof figs[P.eid].params === "object" ? figs[P.eid].params : null;
      out.push({ key: P.eid, kind: "person", figure: f, floor_id: P.at.floor_id, x: P.at.x, y: P.at.y, z: 0, centre: false });
    }
    return out;
  }
  function place(I, w, F){
    const S = I.body && I.body.g.userData && I.body.g.userData.size, h = S ? S.h * I.body.g.scale.y : 0;
    const y = F.fl.elev + Math.max(0, w.centre ? w.z - h / 2 : w.z);
    I.to.set(w.x, y, w.y);
    const far = I.F !== F || I.at.distanceTo(I.to) > JUMP_M || !I.placed;
    if (I.F !== F) { if (I.root.parent) I.root.parent.remove(I.root); F.group.add(I.root); I.F = F; }
    if (far) { I.at.copy(I.to); I.walking = false; I.placed = true; }
    else I.walking = I.at.distanceTo(I.to) > 0.02;
    pose(I, 0);
  }
  /** Where it stands and how it moves (t: ms). */
  function pose(I, t){
    I.root.position.copy(I.at);
    I.root.rotation.y = I.yaw;
    if (I.kind === "person" && I.body) {
      // A simple walk: a step's bob and sway while moving; still otherwise.
      const s = t / 1000, step = I.walking ? Math.abs(Math.sin(Math.PI * 1.9 * s)) : 0;
      I.body.g.position.y = 0.035 * step;
      I.body.g.rotation.z = I.walking ? 0.05 * Math.sin(Math.PI * 1.9 * s) : 0;
    }
  }

  return {
    /** d = {model, looks (the 3D file's devices), figures, snapshot (the live
     *  snapshot, only while the people layer is on), states, people (the
     *  layer on)}; rebuilt: the floors were made afresh. True when anything
     *  drawn changed. */
    sync(d, rebuilt = false){
      quality = ctx.quality() === "high" ? "high" : "low";
      const want = wanted(d || {}), keys = new Set(want.map(w => w.key));
      let changed = false;
      for (const k of [...items.keys()]) if (!keys.has(k)) { drop(k); changed = true; }
      for (const w of want) {
        const F = floorOf(w.floor_id);
        if (!F) { if (items.has(w.key)) { drop(w.key); changed = true; } continue; }
        let I = items.get(w.key);
        if (!I) { I = { key: w.key, kind: w.kind, root: new THREE.Group(), body: null, look: null, F: null, at: new THREE.Vector3(), to: new THREE.Vector3(), yaw: 0, walking: false, placed: false }; I.root.name = "tracked:" + w.key; items.set(w.key, I); changed = true; }
        if (rebuilt) { I.F = null; if (I.root.parent) I.root.parent.remove(I.root); }
        const look = JSON.stringify([w.recipe || null, w.figure || null, quality]);
        if (look !== I.look) {
          if (I.body) { I.root.remove(I.body.g); if (!I.body.own) { const FURN = ctx.FURN ? ctx.FURN() : null; try { if (FURN && FURN.disposePiece) FURN.disposePiece(I.body.g); } catch (_) { /* best effort */ } } }
          I.body = body(w);
          const S = I.body.g.userData && I.body.g.userData.size;
          if (S && SHOWN_M[w.kind]) I.body.g.scale.setScalar(Math.max(1, SHOWN_M[w.kind] / Math.max(S.w, S.d, S.h, 1e-3)));
          I.body.g.traverse((o) => { if (o.isMesh) { o.castShadow = quality === "high"; o.receiveShadow = false; } });
          I.root.add(I.body.g);
          I.look = look; I.marker = I.body.own;
          changed = true;
        }
        const before = I.to.toArray().join() + (I.F && I.F.fl.id);
        place(I, w, F);
        if (before !== I.to.toArray().join() + (I.F && I.F.fl.id)) changed = true;
      }
      return changed;
    },
    /** The live clock (t: performance.now()): whoever walks, a step on. */
    tick(t){
      const now = [...items.values()].filter(I => I.walking);
      if (!now.length) { last = null; return; }
      const dt = last === null ? 0 : Math.min(0.25, Math.max(0, (t - last) / 1000));
      last = t;
      for (const I of now) {
        const dx = I.to.x - I.at.x, dy = I.to.y - I.at.y, dz = I.to.z - I.at.z, d = Math.hypot(dx, dy, dz), stepM = WALK_SPEED * dt;
        if (Math.hypot(dx, dz) > 0.01) I.yaw = Math.atan2(dx, dz);              // faces where it goes (+z is its front)
        if (d <= stepM || d < 0.02) { I.at.copy(I.to); I.walking = false; }
        else I.at.set(I.at.x + dx / d * stepM, I.at.y + dy / d * stepM, I.at.z + dz / d * stepM);
        pose(I, t);
      }
    },
    /** How often to draw while someone walks on a floor that shows (ms), or 0. */
    rate(){
      for (const I of items.values()) if (I.walking && shown(I)) return WALK_MS[quality];
      return 0;
    },
    state(){
      const r = (v) => Math.round(v * 1000) / 1000;
      return [...items.values()].map(I => ({ key: I.key, kind: I.kind, floor: I.F ? I.F.fl.id : null, at: [r(I.at.x), r(I.at.y), r(I.at.z)],
        to: [r(I.to.x), r(I.to.y), r(I.to.z)], yaw: r(I.yaw), walking: I.walking, marker: !!I.marker, shown: shown(I) }));
    },
    dispose(){
      for (const k of [...items.keys()]) drop(k);
      if (markerRes) { for (const v of Object.values(markerRes)) v.dispose(); markerRes = null; }
    },
  };
}
