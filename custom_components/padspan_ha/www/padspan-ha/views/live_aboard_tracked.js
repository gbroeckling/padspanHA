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
//             height z_m: presence uses those, so 3D only reads them); with
//             Show tags & scanners on, every placed scanner does, as a small
//             plain box when it has no look
//   tags      with Show tags & scanners on, every tag the flat Atlas shows
//             (named or identified, with a place now) is drawn where PadSpan
//             tracks it, with its name over it and a faint ring on the floor
//             that is wider the less sure its spot is (Overview's own ring);
//             its look if it has one, a small plain tag if not
//   people    with Show people on, each Home Assistant person found through
//             the phone or tag they carry walks to it: their figure
//             (figures["person.x"]) if they have one, a soft marker if not
//             (what is someone's is drawn as them, not as a tag too)
//
// Tags and people read the live snapshot Overview already reads, handed in
// by the view (one read for both); with both off, nothing of it is read or
// drawn. Someone walking is drawn on the view's live clock, at most every
// WALK_MS; standing still, nothing is drawn. A tapped tag or scanner says
// what it is (pickable: its name, room, when last seen, which scanners hear
// it), all from the snapshot and the map already here. Imports no three.js:
// the view hands it in, with the builders.

/** How often someone walking is drawn (ms), by profile. */
export const WALK_MS = { high: 40, low: 100 };
const WALK_SPEED = 1.3;                    // m/s: a stroll across a room
const JUMP_M = 8;                          // further than this (or another floor): there at once
const CARRY_H = 0.9;                       // a beacon's height above its floor: in a pocket, on keys
const SCANNER_Z = 2.2;                     // a scanner with no height: the map's own default
const MARKER = "#7dd3fc";                  // someone with no figure: a soft marker
const TAG = "#5eead4";                     // a tag: the flat Atlas's beacon teal
const SCANNER = "#cbd5e1";                 // a plain scanner
// A tag is a few centimetres: drawn at least this big (m) so it can be seen
// from across the house; a scanner too.
const SHOWN_M = { beacon: 0.22, scanner: 0.16 };
/** The ring under a tag (m): this wide when PadSpan is sure of its spot,
 *  growing to the other when it is not (Overview's ring, 10 to 34 px). */
export const HALO_M = [0.3, 1.5];
const LABEL_PX = 22;                       // a tag's name: this tall on screen, any distance, either camera
const HEARD_MAX = 4;                       // scanners named in a tag's card

const fin = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const low = (v) => String(v || "").trim().toLowerCase();

/**
 * What the live snapshot (Overview's, live_snapshot) tracks with a place:
 * {key, label, x, y, floor_id, linked: [entity ids], shown (named or
 * identified: the flat Atlas shows it), beacon (a tag's kind), room, age
 * (s since last heard), sure (0..1, how sure the spot is, or null), heard:
 * [{source, rssi}]}. Not stale, not a ghost; the same "a place it truly
 * knows" rule as the flat Atlas's beacons.
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
               beacon: o.kind === "ble" || o.kind === "private_ble" || o.kind === "ibeacon",
               room: typeof o.room === "string" ? o.room : "", age: fin(o.age_s), sure: fin(o.knn_confidence),
               heard: (Array.isArray(o.sources) ? o.sources : []).map(s => (s && typeof s === "object" ? { source: String(s.source || ""), rssi: fin(s.rssi) } : { source: String(s || ""), rssi: null }))
                 .filter(s => s.source) });
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

/** How wide a tag's ring is (m) for how sure PadSpan is of its spot (0..1;
 *  not known: as unsure as it gets). */
export function haloOf(sure){
  const c = Math.max(0, Math.min(1, fin(sure) ?? 0));
  return Math.round((HALO_M[0] + (1 - c) * (HALO_M[1] - HALO_M[0])) * 1000) / 1000;
}
/** When something was last heard, said plainly ("" when not known). */
export function seenText(age){
  const a = fin(age);
  if (a === null || a < 0) return "";
  if (a < 10) return "Seen just now";
  if (a < 90) return `Seen ${Math.round(a)} s ago`;
  if (a < 5400) return `Seen ${Math.round(a / 60)} min ago`;
  return `Seen ${Math.round(a / 3600)} h ago`;
}
/** A scanner's name: its room on the map and the end of its address, as
 *  People & devices names it ("Living Room scanner (D7:1E)"). */
export function scannerName(addr, model){
  const info = model && model.scanners && typeof model.scanners === "object" ? model.scanners[addr] : null;
  const end = String(addr || "").slice(-5);
  return info && info.room ? `${info.room} scanner (${end})` : `Scanner ${addr}`;
}
/** What a tapped tag says: {title, lines}. Its room, when last heard, and
 *  which scanners hear it, the strongest first. */
export function tagCard(o, model){
  const lines = [o.room ? `In ${o.room}` : "Room not known"];
  const seen = seenText(o.age);
  if (seen) lines.push(seen);
  const heard = (o.heard || []).slice().sort((a, b) => (b.rssi ?? -999) - (a.rssi ?? -999));
  if (heard.length) {
    const names = heard.slice(0, HEARD_MAX).map(s => scannerName(s.source, model).replace(/ scanner \(/, " ("));
    lines.push(`Heard by: ${names.join(", ")}${heard.length > HEARD_MAX ? ` and ${heard.length - HEARD_MAX} more` : ""}`);
  } else lines.push("No scanner hears it right now");
  return { title: o.label || "Tag", lines };
}
/** What a tapped scanner says: where it is and how high. */
export function scannerCard(addr, model, z){
  const info = model && model.scanners && typeof model.scanners === "object" ? model.scanners[addr] : null;
  return { title: scannerName(addr, model), lines: [info && info.room ? `In ${info.room}` : "On the map", `${(Math.round(z * 100) / 100).toFixed(2)} m above the floor`] };
}

/** What is drawn now, Live Aboard's and the flat Atlas's alike (the sidebar's
 *  Show people and Show tags & scanners): d = {model, looks (the 3D file's
 *  devices), figures, snapshot, states, people, tags}. Each {key, kind:
 *  "scanner" | "beacon" | "person", floor_id, x, y, z, ...}. */
export function wantedOf(d){
  const out = [];
  const looks = d.looks && typeof d.looks === "object" ? d.looks : {};
  const lookOf = (k) => (looks[k] && looks[k].recipe && typeof looks[k].recipe === "object" ? looks[k].recipe : null);
  const sp = d.model && d.model.scanner_positions_m && typeof d.model.scanner_positions_m === "object" ? d.model.scanner_positions_m : {};
  for (const [addr, s] of Object.entries(sp)) {
    const r = lookOf(addr), x = fin(s && s.x_m), y = fin(s && s.y_m);
    if ((!r && !d.tags) || x === null || y === null) continue;
    const z = fin(s.z_m) ?? SCANNER_Z;
    out.push({ key: "scanner:" + addr, kind: "scanner", recipe: r, floor_id: s.floor_id, x, y, z, centre: true,
               card: scannerCard(addr, d.model, z) });
  }
  if (!d.people && !d.tags) return out;
  const tracked = trackedOf(d.snapshot);
  const people = d.people ? peopleOf(d.states, tracked) : [];
  const theirs = new Set(people.filter(P => P.at).map(P => P.at.key));
  if (d.tags) {
    for (const o of tracked) {
      const r = lookOf(o.key);
      if (!o.beacon || !(o.shown || r) || theirs.has(o.key)) continue;
      out.push({ key: "beacon:" + o.key, kind: "beacon", recipe: r, floor_id: o.floor_id, x: o.x, y: o.y, z: CARRY_H, centre: true,
                 name: o.label || "Tag", halo: haloOf(o.sure), card: tagCard(o, d.model) });
    }
  }
  const figs = d.figures && typeof d.figures === "object" ? d.figures : {};
  for (const P of people) {
    if (!P.at) continue;
    const f = figs[P.eid] && figs[P.eid].params && typeof figs[P.eid].params === "object" ? figs[P.eid].params : null;
    out.push({ key: P.eid, kind: "person", figure: f, floor_id: P.at.floor_id, x: P.at.x, y: P.at.y, z: 0, centre: false });
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
  let quality = "low", last = null, markerRes = null, tagRes = null;
  const _vp = new THREE.Vector4(), _wp = new THREE.Vector3();

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
  // What a tag or a scanner with no look is drawn as, its ring and its stem:
  // plain and unlit (they read the same by day and by night), shared by all.
  function res(){
    if (!tagRes) {
      tagRes = {
        tag: new THREE.SphereGeometry(0.075, 18, 12),
        tagMat: new THREE.MeshBasicMaterial({ color: TAG }),
        box: new THREE.BoxGeometry(0.16, 0.06, 0.1),
        boxMat: new THREE.MeshBasicMaterial({ color: SCANNER }),
        led: new THREE.SphereGeometry(0.014, 10, 8),
        ledMat: new THREE.MeshBasicMaterial({ color: TAG }),
        disc: new THREE.CircleGeometry(1, 40).rotateX(-Math.PI / 2),
        discMat: new THREE.MeshBasicMaterial({ color: TAG, transparent: true, opacity: 0.13, depthWrite: false }),
        rim: new THREE.RingGeometry(0.95, 1, 48).rotateX(-Math.PI / 2),
        rimMat: new THREE.MeshBasicMaterial({ color: TAG, transparent: true, opacity: 0.42, depthWrite: false, side: THREE.DoubleSide }),
        stemMat: new THREE.LineBasicMaterial({ color: TAG, transparent: true, opacity: 0.55, depthWrite: false }),
      };
    }
    return tagRes;
  }
  function plain(kind){
    const R = res(), g = new THREE.Group();
    if (kind === "scanner") {
      const b = new THREE.Mesh(R.box, R.boxMat), l = new THREE.Mesh(R.led, R.ledMat);
      b.position.y = 0.03; l.position.set(0, 0.03, 0.05);
      g.add(b, l);
      g.userData.size = { w: 0.16, d: 0.1, h: 0.06 };
    } else {
      const b = new THREE.Mesh(R.tag, R.tagMat);
      b.position.y = 0.075;
      g.add(b);
      g.userData.size = { w: 0.15, d: 0.15, h: 0.15 };
    }
    return g;
  }
  function body(w){
    const FURN = ctx.FURN ? ctx.FURN() : null;
    try {
      if (w.kind === "person" && w.figure && FURN && FURN.buildFigure) return { g: FURN.buildFigure(THREE, w.figure, { quality }), own: false };
      if (w.kind !== "person" && w.recipe && FURN && FURN.buildPiece) return { g: FURN.buildPiece(THREE, w.recipe, { quality }), own: false };
    } catch (_) { /* a marker, below */ }
    if (w.kind === "person") return { g: marker(), own: true };
    return { g: plain(w.kind), own: true, plain: true };
  }
  /** A name over a tag: a pill the same size on screen whichever camera
   *  draws it (the 3D view's, or Furnish's plan), always on top. */
  function nameSprite(text){
    const c = document.createElement("canvas"), font = "700 30px system-ui, \"Segoe UI\", Roboto, sans-serif";
    let g = c.getContext("2d");
    g.font = font;
    const tw = Math.ceil(Number(g.measureText(text).width) || text.length * 15);
    c.width = Math.min(640, tw + 36); c.height = 48;
    g = c.getContext("2d");
    g.font = font;                                      // a resized canvas forgets it
    g.beginPath();
    if (g.roundRect) g.roundRect(1, 1, c.width - 2, 46, 23); else g.rect(1, 1, c.width - 2, 46);
    g.fillStyle = "rgba(6,14,9,0.86)"; g.fill();
    g.lineWidth = 2; g.strokeStyle = "rgba(94,234,212,0.55)"; g.stroke();
    g.fillStyle = "#e8f6f0"; g.textAlign = "center"; g.textBaseline = "middle";
    g.fillText(text, c.width / 2, 25);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false });
    const sp = new THREE.Sprite(mat);
    sp.renderOrder = 32; sp.frustumCulled = false;           // over room names (31) and chips (30): a press on it is the tag's
    sp.center.set(0.5, 0);
    sp.userData.aspect = c.width / c.height;
    sp.onBeforeRender = (renderer, scene, camera) => {
      renderer.getCurrentViewport(_vp);
      const H = _vp.w / (renderer.getPixelRatio() || 1) || 600;
      let mpp;
      if (camera.isOrthographicCamera) mpp = (camera.top - camera.bottom) / (camera.zoom || 1) / H;
      else { sp.getWorldPosition(_wp); mpp = 2 * Math.tan((camera.fov || 40) * Math.PI / 360) * _wp.distanceTo(camera.position) / H; }
      const h = LABEL_PX * mpp;
      sp.scale.set(h * sp.userData.aspect, h, 1);
      sp.updateMatrixWorld();
    };
    return { sp, tex, mat, text };
  }
  function dropBody(I){
    if (!I.body) return;
    I.root.remove(I.body.g);
    if (!I.body.own) { const FURN = ctx.FURN ? ctx.FURN() : null; try { if (FURN && FURN.disposePiece) FURN.disposePiece(I.body.g); } catch (_) { /* best effort */ } }
    I.body = null;
  }
  function dropName(I){
    if (!I.name) return;
    I.root.remove(I.name.sp);
    I.name.tex.dispose(); I.name.mat.dispose();
    I.name = null;
  }
  function drop(key){
    const I = items.get(key);
    if (!I) return;
    if (I.root.parent) I.root.parent.remove(I.root);
    dropBody(I); dropName(I);
    if (I.stem) I.stem.geometry.dispose();
    items.delete(key);
  }
  function place(I, w, F){
    const S = I.body && I.body.g.userData && I.body.g.userData.size, h = S ? S.h * I.body.g.scale.y : 0;
    const y = F.fl.elev + Math.max(0, w.centre ? w.z - h / 2 : w.z);
    I.to.set(w.x, y, w.y);
    const far = I.F !== F || I.at.distanceTo(I.to) > JUMP_M || !I.placed;
    if (I.F !== F) { if (I.root.parent) I.root.parent.remove(I.root); F.group.add(I.root); I.F = F; }
    if (far) { I.at.copy(I.to); I.walking = false; I.placed = true; }
    else I.walking = I.at.distanceTo(I.to) > 0.02;
    // A tag's ring lies on its floor and its stem stands on it; its name is
    // over it (the root is at the tag, its floor below it).
    const down = F.fl.elev - y;
    if (I.halo) I.halo.position.y = down + 0.02;
    if (I.stem) { const a = I.stem.geometry.attributes.position; a.setY(0, down + 0.02); a.needsUpdate = true; I.stem.geometry.computeBoundingSphere(); }
    if (I.name) I.name.sp.position.y = h + 0.06;
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
  /** A tag's ring and stem, made once; its ring as wide as its spot is unsure. */
  function dressTag(I, w){
    const R = res();
    if (!I.halo) {
      I.halo = new THREE.Group();
      const disc = new THREE.Mesh(R.disc, R.discMat), rim = new THREE.Mesh(R.rim, R.rimMat);
      disc.renderOrder = 2; rim.renderOrder = 2;
      I.halo.add(disc, rim);
      I.root.add(I.halo);
      const geo = new THREE.BufferGeometry().setAttribute("position", new THREE.Float32BufferAttribute([0, 0, 0, 0, 0, 0], 3));
      I.stem = new THREE.Line(geo, R.stemMat);
      I.root.add(I.stem);
    }
    I.halo.scale.set(w.halo, 1, w.halo);
    if (!I.name || I.name.text !== w.name) {
      dropName(I);
      I.name = nameSprite(w.name);
      I.root.add(I.name.sp);
    }
  }
  const drawnKey = (I) => I.to.toArray().join() + (I.F && I.F.fl.id) + (I.name ? I.name.text : "") + (I.halo ? I.halo.scale.x : "");

  return {
    /** d = {model, looks (the 3D file's devices), figures, snapshot (the live
     *  snapshot, only while a layer that needs it is on), states, people
     *  (Show people on), tags (Show tags & scanners on)}; rebuilt: the
     *  floors were made afresh. True when anything drawn changed. */
    sync(d, rebuilt = false){
      quality = ctx.quality() === "high" ? "high" : "low";
      const want = wantedOf(d || {}), keys = new Set(want.map(w => w.key));
      let changed = false;
      for (const k of [...items.keys()]) if (!keys.has(k)) { drop(k); changed = true; }
      for (const w of want) {
        const F = floorOf(w.floor_id);
        if (!F) { if (items.has(w.key)) { drop(w.key); changed = true; } continue; }
        let I = items.get(w.key);
        if (!I) {
          I = { key: w.key, kind: w.kind, root: new THREE.Group(), body: null, look: null, F: null, at: new THREE.Vector3(), to: new THREE.Vector3(),
                yaw: 0, walking: false, placed: false, halo: null, stem: null, name: null, card: null };
          I.root.name = "tracked:" + w.key; items.set(w.key, I); changed = true;
        }
        if (rebuilt) { I.F = null; if (I.root.parent) I.root.parent.remove(I.root); }
        const look = JSON.stringify([w.recipe || null, w.figure || null, quality]);
        if (look !== I.look) {
          dropBody(I);
          I.body = body(w);
          const S = I.body.g.userData && I.body.g.userData.size;
          if (S && SHOWN_M[w.kind]) I.body.g.scale.setScalar(Math.max(1, SHOWN_M[w.kind] / Math.max(S.w, S.d, S.h, 1e-3)));
          I.body.g.traverse((o) => { if (o.isMesh) { o.castShadow = quality === "high" && !I.body.plain; o.receiveShadow = false; } });
          I.root.add(I.body.g);
          I.look = look; I.marker = I.body.own && w.kind === "person"; I.plain = !!I.body.plain;
          changed = true;
        }
        const before = drawnKey(I);
        if (w.kind === "beacon") dressTag(I, w);
        I.card = w.card || null;
        place(I, w, F);
        if (before !== drawnKey(I)) changed = true;
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
    /** The tags and scanners on floors that show, for a tap: {key, kind
     *  ("tag" | "scanner"), at (world: the middle of what is drawn), name
     *  (world: the bottom middle of its name, or null), namePx ([w, h] on
     *  screen), label, card: {title, lines}}. */
    pickable(){
      const out = [];
      for (const I of items.values()) {
        if (!shown(I) || !I.card || (I.kind !== "beacon" && I.kind !== "scanner")) continue;
        const S = I.body && I.body.g.userData && I.body.g.userData.size, h = S ? S.h * I.body.g.scale.y : 0;
        I.root.updateMatrixWorld();
        const at = new THREE.Vector3(0, h / 2, 0).applyMatrix4(I.root.matrixWorld);
        const name = I.name ? new THREE.Vector3().setFromMatrixPosition(I.name.sp.matrixWorld) : null;
        out.push({ key: I.key, kind: I.kind === "beacon" ? "tag" : "scanner", at, name,
                   namePx: I.name ? [LABEL_PX * I.name.sp.userData.aspect, LABEL_PX] : null,
                   label: I.kind === "beacon" ? `${I.card.title} · tag` : I.card.title, card: I.card });
      }
      return out;
    },
    state(){
      const r = (v) => Math.round(v * 1000) / 1000;
      return [...items.values()].map(I => ({ key: I.key, kind: I.kind, floor: I.F ? I.F.fl.id : null, at: [r(I.at.x), r(I.at.y), r(I.at.z)],
        to: [r(I.to.x), r(I.to.y), r(I.to.z)], yaw: r(I.yaw), walking: I.walking, marker: !!I.marker, plain: !!I.plain, shown: shown(I),
        name: I.name ? I.name.text : null, halo: I.halo ? r(I.halo.scale.x) : null, ground: I.halo ? r(I.at.y + I.halo.position.y) : null,
        card: I.card ? { title: I.card.title, lines: I.card.lines.slice() } : null }));
    },
    dispose(){
      for (const k of [...items.keys()]) drop(k);
      for (const R of [markerRes, tagRes]) if (R) for (const v of Object.values(R)) v.dispose();
      markerRes = null; tagRes = null;
    },
  };
}
