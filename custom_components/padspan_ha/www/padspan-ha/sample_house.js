// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
// See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
//
// The sample house Sample mode shows ("Preview a finished house"): the
// estate (estate.js, the website demo's house too), dressed as a finished
// install. createSampleHouse() answers the READ messages the panel asks
// (model_get, maps_list, live_snapshot, calibration_get, ...) from it, in the
// same shapes the server sends. It never answers a write: panel.js blocks
// those in Sample mode (_sampleCall), and the website demo (tools/demo/
// fake_hass.js) keeps its own in-memory ones.
//
// Loaded only when Sample mode is entered (panel.js _ensureSampleHouse), so a
// Live install never downloads it. Every name, entity id and label in it is
// made up.

const { estateFixture } = await import(`./estate.js${new URL(import.meta.url).search}`);
export { estateFixture };

const clone = (v) => JSON.parse(JSON.stringify(v));
export const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");

/** Whether (x, y) is inside polygon P ([[x, y], ...]): the even-odd rule. */
export function inPoly(P, x, y){
  let inside = false;
  for (let i = 0, j = P.length - 1; i < P.length; j = i++) {
    const [xi, yi] = P[i], [xj, yj] = P[j];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Which room (plan metres) holds (x, y) on floor fid: its outline, not its box (an L-shaped room's box takes in its neighbour). */
export function roomAt(model, fid, x, y){
  for (const [name, g] of Object.entries(model.room_geometry_m || {})) {
    if (g.floor_id === fid && Array.isArray(g.points_m) && inPoly(g.points_m, x, y)) return name;
  }
  return "";
}

/** The room a receiver is in: its outline, else (one mounted on an outside wall) the nearest outline's room on its floor. */
function roomOfReceiver(model, sp){
  const r = roomAt(model, sp.floor_id, sp.x_m, sp.y_m);
  if (r) return r;
  let best = "", bd = Infinity;
  for (const [name, g] of Object.entries(model.room_geometry_m || {})) {
    if (g.floor_id !== sp.floor_id || !Array.isArray(g.points_m)) continue;
    for (const [x, y] of g.points_m) { const d = Math.hypot(x - sp.x_m, y - sp.y_m); if (d < bd) { bd = d; best = name; } }
  }
  return best;
}

/** Where a walker is t seconds along its loop: [floor, x, y, stay?] waypoints at 0.4 m/s, a floor change taking half a metre. */
export function walkAt(w, t){
  const L = w.loop;
  if (L.length === 1) return { fid: L[0][0], x: L[0][1], y: L[0][2] };
  const legs = L.map((p, i) => {
    const q = L[(i + 1) % L.length];
    return { p, q, stay: p[3] || 0, s: (p[0] === q[0] ? Math.hypot(q[1] - p[1], q[2] - p[2]) : 0.5) / 0.4 };
  });
  const total = legs.reduce((s, l) => s + l.stay + l.s, 0);
  let s = t % total;
  for (const l of legs) {
    if (s <= l.stay) return { fid: l.p[0], x: l.p[1], y: l.p[2] };
    s -= l.stay;
    if (s <= l.s) {
      const f = l.s ? s / l.s : 1;
      if (l.p[0] !== l.q[0]) return { fid: f < 0.5 ? l.p[0] : l.q[0], x: f < 0.5 ? l.p[1] : l.q[1], y: f < 0.5 ? l.p[2] : l.q[2] };
      return { fid: l.p[0], x: l.p[1] + (l.q[1] - l.p[1]) * f, y: l.p[2] + (l.q[2] - l.p[2]) * f };
    }
    s -= l.s;
  }
  return { fid: L[0][0], x: L[0][1], y: L[0][2] };
}

/** A steady number in [0, 1) from a string: the same house at every load. */
function steady(s){
  let h = 2166136261;
  for (const c of String(s)) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return ((h >>> 0) % 1000) / 1000;
}

/** "demo-proxy-living-room-1" -> "Living room proxy 1". */
function radioName(source){
  const m = /^demo-proxy-(.+?)(?:-(\d+))?$/.exec(source);
  if (!m) return source;
  const words = m[1].replace(/-/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1) + " proxy" + (m[2] ? " " + m[2] : "");
}

/** What a receiver hears from a spot: a plain path-loss curve, a floor or two costing more. */
function rssiAt(model, sp, fid, x, y){
  const z = (id) => Number((model.floor_elevations || {})[id] || 0);
  const d = Math.max(0.5, Math.hypot(sp.x_m - x, sp.y_m - y, (z(sp.floor_id) + (sp.z_m ?? 2.4)) - (z(fid) + 1.1)));
  const floors = Math.round(Math.abs(z(sp.floor_id) - z(fid)) / 2.8);
  return Math.round(-59 - 24 * Math.log10(d) - 9 * floors);
}

/** The receivers that hear a spot best, strongest first. */
function heardBy(model, fid, x, y, n = 3){
  return Object.entries(model.scanner_positions_m || {})
    .map(([source, sp]) => ({ source, rssi: rssiAt(model, sp, fid, x, y) }))
    .filter(r => r.rssi > -95)
    .sort((a, b) => b.rssi - a.rssi)
    .slice(0, n);
}

/** The receivers as a snapshot lists them (bluetooth_live.py's radios). */
export function radiosOf(model){
  return Object.entries(model.scanner_positions_m || {}).map(([source, sp], i) => ({
    source, name: radioName(source), display_name: radioName(source),
    area_name: roomOfReceiver(model, sp),
    connectable: true, scanning: true, scan_mode: i % 3 ? "passive" : "active", requested_scan_mode: null,
    adapter: "", connection_type: "wireless", last_heard_s: 1 + Math.round(2 * steady(source)),
  }));
}

// Things any house hears besides its people: TVs, speakers, a watch on a
// charger. Unnamed and in one room each (heard from its middle), as the engine leaves them.
const HEARD = [["Living Room", "TV"], ["Media Room", "Soundbar"], ["Kitchen", ""], ["Primary Bedroom", "Watch"], ["Office", ""], ["Games Room", ""]];

/**
 * The live snapshot (snapshot_builder.py's shape) of everyone t seconds
 * along their walks: who is where, the receivers, what each one hears.
 * source: "sample" in the panel (tuneLivePhase never records from it).
 */
export function snapshotOf(model, walkers, t, { source = "sample", generatedAt = new Date().toISOString() } = {}){
  const clone1 = (v) => JSON.parse(JSON.stringify(v));
  const list = walkers.map(w => {
    const at = walkAt(w, t), room = roomAt(model, at.fid, at.x, at.y);
    const heard = heardBy(model, at.fid, at.x, at.y);
    return { key: w.key, kind: w.kind, name: w.name, user_label: w.name, identified: true, entity_id: w.eid || null,
             address: w.key, linked_entities: w.eid ? [w.eid] : [], x_m: at.x, y_m: at.y, floor_id: at.fid, room, age_s: 1,
             knn_confidence: 0.8, rssi: heard.length ? heard[0].rssi : -62,
             sources: heard.length ? heard.map(h => ({ source: h.source, rssi: h.rssi })) : [{ source: "demo_scanner", rssi: -62 }],
             // A tag lent to a guest for their stay: who has it (guest_tags.py snapshot_overlay).
             ...(w.guest ? { guest: clone1(w.guest) } : {}) };
  });
  const fidOf = (room) => ((model.room_geometry_m || {})[room] || {}).floor_id;
  for (const [i, [room, name]] of HEARD.entries()) {
    const fid = fidOf(room);
    if (!fid) continue;
    const P = model.room_geometry_m[room].points_m || [[0, 0]];
    const x = P.reduce((t, p) => t + p[0], 0) / P.length, y = P.reduce((t, p) => t + p[1], 0) / P.length;
    const heard = heardBy(model, fid, x, y);
    list.push({ key: `ble:demo:heard_${i}`, kind: "ble", address: `demo:heard_${i}`, name, identified: false, room,
                floor_id: fid, age_s: 2 + i, rssi: heard.length ? heard[0].rssi : -80,
                sources: heard.map(h => ({ source: h.source, rssi: h.rssi })), connectable: false });
  }
  const advertisements = [];
  for (const o of list) {
    for (const s of o.sources) {
      if (s.source === "demo_scanner") continue;
      advertisements.push({ address: o.address || o.key, name: o.name || "", source: s.source, rssi: s.rssi, age_s: o.age_s, connectable: false });
    }
  }
  const radios = radiosOf(model);
  const rooms = Object.keys(model.room_geometry_m || {}).filter(r => fidOf(r) !== "__outside__");
  const tagMap = Object.fromEntries(rooms.map(r => [r, []]));
  for (const o of list) if (o.entity_id && tagMap[o.room]) tagMap[o.room].push(o.entity_id);
  const ent = list.filter(o => o.kind === "entity").length;
  const known = list.filter(o => o.identified).length;
  return {
    source, generated_at: generatedAt,
    rooms_discovered: rooms, rooms: rooms.map(name => ({ name })),
    receivers: radios.map(r => ({ id: r.source, name: r.name, manufacturer: "Espressif", model: "ESP32 BT Proxy", area_name: r.area_name })),
    ble: { radios, advertisements, diag: { ok: true, errors: [] } },
    tags: list.filter(o => o.entity_id).map(o => ({ entity_id: o.entity_id, name: o.name, room: o.room, state: o.room })),
    room_tag_map: tagMap, room_tag_map_live: tagMap, room_tag_map_missing: {}, room_tag_map_saved: tagMap,
    objects: { list, summary: { total: list.length, identified: known, unidentified: list.length - known, entities: ent,
                                ble: list.length - ent, private_ble: 0, ibeacon: 0, common_prefixes: {} } },
    raw_counts: { areas: rooms.length, receivers: radios.length, candidate_entities: ent, mapped_entities: ent,
                  saved_entities_total: ent, saved_entities_found: ent, saved_entities_missing: 0 },
  };
}

/**
 * Overview's "People in building" (ws_occupancy.py's answer): the people the
 * snapshot places, the tag seen and not counted, motion where they are.
 */
export function occupancyOf(list, walkers, states, motionMap){
  const mine = list.filter(o => o.entity_id);
  const people = walkers.filter(w => w.person).map(w => {
    const o = list.find(x => x.key === w.key);
    const p = states[w.person];
    return { name: (p && p.attributes.friendly_name) || w.name, kind: "known", room: (o && o.room) || null, via: "person entity", aliases: [], assumed: false };
  });
  const motion = Object.entries(motionMap).filter(([, eid]) => states[eid] && states[eid].state === "on").map(([r]) => r);
  const rooms = {};
  for (const p of people) if (p.room) (rooms[p.room] = rooms[p.room] || { room: p.room, people: [], phones: 0, occupancy: false, motion: false }).people.push(p.name);
  for (const r of motion) (rooms[r] = rooms[r] || { room: r, people: [], phones: 0, occupancy: false, motion: false }).motion = true;
  for (const r of Object.values(rooms)) r.agreement = r.people.length && r.motion ? "agree" : r.people.length ? "ble_only" : "sensor_only";
  const n = people.length;
  return { total_estimate: n, total_low: n, total_high: n, confidence: "high", known: n, unknown: 0, people,
           rooms: Object.values(rooms).sort((a, b) => a.room.localeCompare(b.room)),
           evidence: { persons_home: people.map(p => p.name), persons_unlocated: [], phone_clusters: mine.length, phone_addresses: mine.length,
                       occupancy_rooms: [], motion_rooms: motion, unaccounted_rooms: [], stuck_sensors: [],
                       things_seen: list.filter(o => !o.entity_id && o.identified).map(o => ({ label: o.name, kind: o.kind, room: o.room || null })) },
           hybrid_enabled: true, cluster_threshold: 0, training_count: 0, accuracy: null };
}

// ── the floor plans: one drawing per floor, already measured ────────────────

const PX_PER_M = 40, MARGIN_M = 1;

function esc(s){ return String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]); }

/**
 * Each floor as an uploaded, measured plan: a drawing of its rooms (an SVG,
 * as a data: link), the room outlines and receivers as the Setup Wizard
 * stores them (fractions of the picture), and the placement that makes the
 * picture plan metres (model.map_transforms). The picture and the metres
 * agree by construction: both are the same outlines.
 */
export function floorPlansOf(model){
  const maps = [], imageUrls = {}, transforms = {};
  for (const f of model.floors || []) {
    const rooms = Object.entries(model.room_geometry_m || {}).filter(([, g]) => g.floor_id === f.id && Array.isArray(g.points_m));
    if (!rooms.length) continue;
    const xs = rooms.flatMap(([, g]) => g.points_m.map(p => p[0])), ys = rooms.flatMap(([, g]) => g.points_m.map(p => p[1]));
    const x0 = Math.min(...xs) - MARGIN_M, y0 = Math.min(...ys) - MARGIN_M;
    const wm = Math.max(...xs) + MARGIN_M - x0, hm = Math.max(...ys) + MARGIN_M - y0;
    const W = Math.round(wm * PX_PER_M), H = Math.round(hm * PX_PER_M);
    const id = `estate_${f.id}`;
    const px = (p) => [((p[0] - x0) / wm) * W, ((p[1] - y0) / hm) * H];
    const frac = (p) => [Math.round(((p[0] - x0) / wm) * 1e4) / 1e4, Math.round(((p[1] - y0) / hm) * 1e4) / 1e4];
    let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`
      + `<rect width="${W}" height="${H}" fill="#f4f1ea"/>`;
    for (const [name, g] of rooms) {
      const pts = g.points_m.map(px);
      svg += `<polygon points="${pts.map(p => p.map(v => v.toFixed(1)).join(",")).join(" ")}" fill="#ffffff" stroke="#3b3b3b" stroke-width="5" stroke-linejoin="round"/>`;
      const cx = pts.reduce((s, p) => s + p[0], 0) / pts.length, cy = pts.reduce((s, p) => s + p[1], 0) / pts.length;
      svg += `<text x="${cx.toFixed(1)}" y="${cy.toFixed(1)}" font-family="sans-serif" font-size="15" fill="#555" text-anchor="middle">${esc(name)}</text>`;
    }
    svg += "</svg>";
    imageUrls[id] = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
    const receivers = Object.entries(model.scanner_positions_m || {}).filter(([, sp]) => sp.floor_id === f.id).map(([source, sp]) => {
      const [x, y] = frac([sp.x_m, sp.y_m]);
      return { id: source, label: radioName(source), x, y, room: roomOfReceiver(model, sp), source };
    });
    maps.push({ id, name: `${f.name} floor`, floor_id: f.id, created_at: "2026-09-12T10:00:00+00:00",
                image: { filename: `${id}.svg`, width: W, height: H, content_type: "image/svg+xml" },
                room_bounds: Object.fromEntries(rooms.map(([name, g]) => [name, g.points_m.map(frac)])), receivers });
    transforms[id] = { origin_x_m: x0, origin_y_m: y0, scale_x_m: wm, scale_y_m: hm, rotation_rad: 0, shear_rad: 0, floor_id: f.id,
                       reference_measurements: [{ p1: [0, 0], p2: [1, 0], distance_m: wm }] };
  }
  return { maps, imageUrls, transforms };
}

// ── calibration: a house walked a few weeks ago ─────────────────────────────

/** Spots inside a room's outline, spread over it (a grid, every other cell). */
function spotsIn(g, n){
  const xs = g.points_m.map(p => p[0]), ys = g.points_m.map(p => p[1]);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const out = [];
  for (let k = 4; k <= 12 && out.length < n; k += 2) {
    out.length = 0;
    for (let i = 1; i < k; i++) for (let j = 1; j < k; j++) {
      const x = x0 + (x1 - x0) * i / k, y = y0 + (y1 - y0) * j / k;
      if ((i + j) % 2 === 0 && inPoly(g.points_m, x, y)) out.push([x, y]);
    }
  }
  const step = out.length / n;
  return Array.from({ length: Math.min(n, out.length) }, (_, i) => out[Math.floor(i * step)]);
}

/** calibration_get's answer: points in every room, a fitted model and its held-out score. sample: true marks it made-up. */
export function calibrationOf(model, plans, now = Date.now()){
  const points = [], scored = {}, pairs = [];
  const rooms = Object.entries(model.room_geometry_m || {}).filter(([, g]) => g.floor_id !== "__outside__" && Array.isArray(g.points_m));
  const mapOf = Object.fromEntries(plans.maps.map(m => [m.floor_id, m]));
  let i = 0;
  for (const [room, g] of rooms) {
    // Most rooms walked well; a couple of small ones only twice (the next thing to do).
    const k = steady(room);
    const n = k < 0.12 ? 2 : 3 + Math.round(k * 4);
    const m = mapOf[g.floor_id], tf = m && plans.transforms[m.id];
    for (const [x, y] of spotsIn(g, n)) {
      const readings = heardBy(model, g.floor_id, x, y, 4).map(h => ({ source: h.source, name: radioName(h.source),
        mean_rssi: h.rssi, std_rssi: 2.5, sample_count: 15, rssi_samples: [] }));
      points.push({ id: `sample_${String(i).padStart(3, "0")}`, map_id: m ? m.id : "", room, label: "", device_id: "demo:alex_phone",
                    x_frac: tf ? Math.round(((x - tf.origin_x_m) / tf.scale_x_m) * 1e4) / 1e4 : 0.5,
                    y_frac: tf ? Math.round(((y - tf.origin_y_m) / tf.scale_y_m) * 1e4) / 1e4 : 0.5,
                    x_m: Math.round(x * 1000) / 1000, y_m: Math.round(y * 1000) / 1000, floor_id: g.floor_id,
                    collected_at: new Date(now - (21 * 86400 + 90 * i) * 1000).toISOString(), duration_s: 15, weight: 1,
                    scanner_readings: readings });
      i++;
    }
    const count = points.filter(p => p.room === room).length;
    const wrong = count > 2 && steady(room + "x") < 0.35 ? 1 : 0;
    scored[room] = { point_count: count, correct: count - wrong, accuracy: count ? (count - wrong) / count : 0 };
    if (wrong) {
      const near = rooms.filter(([r, h]) => r !== room && h.floor_id === g.floor_id).map(([r]) => r);
      if (near.length) pairs.push({ true_room: room, pred_room: near[Math.floor(steady(room + "p") * near.length)], count: 1 });
    }
  }
  const total = points.length, right = Object.values(scored).reduce((s, r) => s + r.correct, 0);
  return {
    sample: true,
    points,
    model: {
      last_computed: new Date(now - 20 * 86400000).toISOString(),
      point_count: total,
      loo_accuracy: { mean_error_m: 1.1, room_confusion: { rooms: scored, confusion_pairs: pairs } },
    },
    heldout: {
      radius_m: 1.5,
      knn: { spots: total, placed: total, room_spots: total, rooms_right_pc: Math.round((100 * right) / Math.max(1, total)), median_error_m: 1.3 },
      spatial: { spots: total, placed: total - 2, room_spots: total, rooms_right_pc: Math.round((100 * right) / Math.max(1, total)) - 6, median_error_m: 1.8 },
      better: "knn",
    },
  };
}

// ── the house ───────────────────────────────────────────────────────────────

/**
 * The estate as a finished install. q: URLSearchParams for estateFixture
 * (?night=1, ?sky=). Answers { model, maps, imageUrls, states, entities,
 * snapshot(), route(msg) } where route answers a read message as the server
 * would, and undefined for anything it does not hold.
 */
export function createSampleHouse(q = new URLSearchParams(), { now = Date.now } = {}){
  const fx = estateFixture(q);
  const t0 = now();
  const plans = floorPlansOf(fx.MODEL);
  const model = clone(fx.MODEL);
  model.areas = Object.keys(model.room_geometry_m).map(name => ({ id: slug(name), name, floor_id: model.room_geometry_m[name].floor_id }));
  model.room_meta = clone(fx.MODEL.room_meta || {});
  model.map_transforms = clone(plans.transforms);
  const S = (state, attributes) => ({ state, attributes, last_changed: new Date(t0 - 600e3).toISOString(),
                                      last_updated: new Date(t0 - 600e3).toISOString(), last_reported: new Date(t0).toISOString() });
  const states = clone(fx.STATES);
  for (const w of fx.WALKERS) if (w.person) {
    states[w.eid] = S("home", { friendly_name: w.name, source_type: "bluetooth_le" });
    states[w.person] = S("home", { friendly_name: w.name.split("'")[0], device_trackers: [w.eid] });
  }
  const snapshot = () => snapshotOf(model, fx.WALKERS, (now() - t0) / 1000, { generatedAt: new Date(now()).toISOString() });
  // Motion where someone is, as the website demo's house moves it.
  const busy = new Set(snapshot().objects.list.filter(o => o.identified).map(o => o.room));
  for (const [room, eid] of Object.entries(fx.MOTION)) if (states[eid]) states[eid] = { ...states[eid], state: busy.has(room) ? "on" : "off" };
  const entities = Object.fromEntries(Object.keys(states).map(eid => {
    const p = model.light_positions_m[eid], room = p ? roomAt(model, p.floor_id, p.x_m, p.y_m) : "";
    return [eid, { entity_id: eid, platform: "demo", area_id: room ? slug(room) : null, device_id: null, name: null }];
  }));
  const figures = Object.fromEntries(fx.WALKERS.filter(w => w.figure).map(w => [w.person, { params: clone(w.figure), origin: "build" }]));
  const house3d = { schema: 1, pieces: clone((fx.HOUSE3D && fx.HOUSE3D.pieces) || {}), lights: {}, openings: {}, devices: {}, figures, library: {} };
  const calibration = calibrationOf(model, plans, t0);

  const route = (m) => {
    switch (m && m.type) {
      case "padspan_ha/model_get": return clone(model);
      case "padspan_ha/maps_list": return { maps: clone(plans.maps), image_urls: { ...plans.imageUrls } };
      case "padspan_ha/maps_image_urls": return { image_urls: { ...plans.imageUrls } };
      case "padspan_ha/live_snapshot": return { snapshot: snapshot() };
      case "padspan_ha/occupancy_estimate": return occupancyOf(snapshot().objects.list, fx.WALKERS, states, fx.MOTION);
      case "padspan_ha/room_tags": { const s = snapshot(); return { room_tag_map: s.room_tag_map }; }
      case "padspan_ha/calibration_get": return clone(calibration);
      // Read-only here: Live Aboard offers no edits (writable: false).
      case "padspan_ha/house3d_get": return { enabled: true, data: clone(house3d), writable: false, sample: true, counts: {} };
      case "padspan_ha/object_label_list": return { labels: {}, registry_labels: {} };
      case "padspan_ha/private_ble_status": return {};
      case "padspan_ha/setup_tips": return { tips: [] };
      // Insights and Busy Times: no history kept in the sample house (not "Failed").
      case "padspan_ha/insights_get": return { days: [] };
      case "padspan_ha/follow_alert_get": return { configs: {} };
      case "padspan_ha/status": return { entries: [{ title: "PadSpan HA", state: "loaded" }] };
      case "padspan_ha/auto_diagnostics": return { summary: { ok: true, total: 4, passed: 4, failed: 0 }, recommendations: [],
        checks: [{ name: "receivers_reporting", ok: true, detail: `${Object.keys(model.scanner_positions_m).length} receivers reporting` },
                 { name: "rooms_drawn", ok: true, detail: `${model.areas.length} rooms drawn` },
                 { name: "floor_plans_measured", ok: true, detail: `${plans.maps.length} floor plans measured` },
                 { name: "calibration", ok: true, detail: `${calibration.points.length} calibration points` }] };
      // Health's layout checks (ws_fabric.py): all passing.
      case "padspan_ha/fabric_health": {
        const c = (group, name, detail) => ({ group, name, ok: true, value: detail, detail });
        const checks = [c("fabric_sync", "Receivers in the layout", `${Object.keys(model.scanner_positions_m).length} placed`),
          c("spatial", "Rooms in metres", `${Object.keys(model.room_geometry_m).length} rooms on ${model.floors.length} floors`),
          c("calibration", "Calibration points", `${calibration.points.length} points`),
          c("multifloor", "Floor heights", model.floors.map(f => `${f.name} ${f.floor_to_floor_m} m`).join(", "))];
        return { summary: { total: checks.length, passed: checks.length, failed: 0, healthy: true }, checks, scanners: {},
                 scanner_positions_m: Object.entries(model.scanner_positions_m).map(([source, sp]) => ({ source, x_m: sp.x_m, y_m: sp.y_m, z_m: sp.z_m, floor_id: sp.floor_id, map_id: `estate_${sp.floor_id}` })),
                 room_geometry_m: Object.entries(model.room_geometry_m).map(([room, g]) => ({ room, type: "poly", floor_id: g.floor_id, origin: "manual",
                   centroid_m: [0, 1].map(k => Math.round(100 * g.points_m.reduce((t, p) => t + p[k], 0) / g.points_m.length) / 100) })),
                 adjacency: {}, fabric_floors: {} };
      }
      // Health's self-diagnosis (ws_diagnostics.py): nothing to report.
      case "padspan_ha/system_critics":
        return { summary: { total: 0, critical: 0, warning: 0, info: 0, healthy: true }, critics: [], confusion_matrix: null, per_map_quality: null };
      // Mapping → Rooms' "Map placements": each room as its floor plan places it.
      case "padspan_ha/fabric_truth_candidates": {
        const rooms = {};
        for (const [name, g] of Object.entries(model.room_geometry_m)) {
          if (m.floor_id && g.floor_id !== m.floor_id) continue;
          rooms[name] = { type: "poly", floor_id: g.floor_id, source_map_id: `estate_${g.floor_id}`, points_m: clone(g.points_m) };
        }
        return { floor_id: m.floor_id || null, transforms: { rooms, stats: { rooms: Object.keys(rooms).length } } };
      }
      case "config/entity_registry/list": case "config/entity_registry/list_for_display": return Object.values(clone(entities));
      case "config/device_registry/list": return [];
      case "config/area_registry/list": return model.areas.map(a => ({ area_id: a.id, name: a.name, floor_id: a.floor_id }));
      case "config/floor_registry/list": return model.floors.map(f => ({ floor_id: f.id, name: f.name, level: f.level }));
      default: return undefined;
    }
  };
  // The settings as the sample house has them: the real ones (theme, edition, language...), less what
  // belongs to the real house's drawing (its Vacation Mode, receiver offsets, hidden plans). The real
  // flood latches stay: a real alarm shows on a screen left in Sample mode too (panel.js banner).
  const settingsFor = (s) => ({ ...(s || {}), vacation_mode_enabled: false, scanner_offsets: {}, hidden_map_ids: [] });
  return { model, maps: plans.maps, imageUrls: plans.imageUrls, states, entities, house3d, calibration, snapshot, route, settingsFor, walkers: fx.WALKERS };
}
