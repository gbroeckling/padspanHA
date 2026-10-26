// The public demo's Home Assistant: just enough of `hass` for the real
// PadSpan panel and the sidebar Atlas to run in a browser with no server.
// The house is fictional (fixture.js, the Live Aboard harness's house); the
// panel's own Sample mode (sample_data.js) supplies its tracking data.
//
// Everything is in memory: a light tapped on, a setting changed, a door drawn
// in 3D last until the page reloads. Nothing is sent anywhere.
//
// startDemo(page) mounts the panel ("panel") or the Atlas ("atlas", "atlas3d").

import { harnessFixture } from "./fixture.js";

const WWW = "padspan_ha_static/padspan-ha/";
const clone = (v) => JSON.parse(JSON.stringify(v));
const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
const now = () => new Date().toISOString();

// Two people and a tag that walk the house: waypoints in plan metres.
const WALKERS = [
  { key: "demo:alex_phone", eid: "device_tracker.alex_phone", person: "person.alex", name: "Alex's phone", kind: "entity",
    figure: { height_m: 1.82, build: "medium", hair: "short", glasses: true, hat: false,
              colors: { hair: "#3a2a1a", skin: "#c8956d", top: "#2d6a4f", bottom: "#333344" } },
    loop: [["main", 2.5, 2], ["main", 8, 3], ["main", 8, 8], ["main", 2.5, 8], ["main", 2.5, 5]] },
  { key: "demo:sam_phone", eid: "device_tracker.sam_phone", person: "person.sam", name: "Sam's phone", kind: "entity",
    figure: { height_m: 1.66, build: "slim", hair: "long", glasses: false, hat: false,
              colors: { hair: "#7a4a22", skin: "#e0b48c", top: "#b5476a", bottom: "#2a3a5a" } },
    loop: [["main", 8, 3], ["main", 9.5, 4.5], ["main", 8, 8], ["main", 2.5, 5], ["upper", 2.5, 2.5], ["upper", 3.5, 3]] },
  { key: "demo:keys", name: "Keys", kind: "ble", loop: [["main", 1, 5], ["main", 1.2, 5.2]] },
];
const MOTION = { Kitchen: "binary_sensor.kitchen_motion", "Living Room": "binary_sensor.living_motion", Hall: "binary_sensor.hall_motion",
                 Den: "binary_sensor.den_motion", Laundry: "binary_sensor.laundry_motion", Office: "binary_sensor.office_motion" };

/** Which room (plan metres) holds (x, y) on floor fid. */
function roomAt(model, fid, x, y){
  for (const [name, g] of Object.entries(model.room_geometry_m || {})) {
    if (g.floor_id !== fid) continue;
    const xs = g.points_m.map(p => p[0]), ys = g.points_m.map(p => p[1]);
    if (x >= Math.min(...xs) && x <= Math.max(...xs) && y >= Math.min(...ys) && y <= Math.max(...ys)) return name;
  }
  return "";
}

/** Where a walker is t seconds in: along its loop at 0.4 m/s, a floor change a step. */
function walkAt(w, t){
  const L = w.loop, legs = L.map((p, i) => {
    const q = L[(i + 1) % L.length];
    return { p, q, d: p[0] === q[0] ? Math.hypot(q[1] - p[1], q[2] - p[2]) : 0.5 };
  });
  const total = legs.reduce((s, l) => s + l.d, 0);
  let s = (t * 0.4) % total;
  for (const l of legs) {
    if (s <= l.d) {
      const f = l.d ? s / l.d : 1;
      if (l.p[0] !== l.q[0]) return { fid: f < 0.5 ? l.p[0] : l.q[0], x: f < 0.5 ? l.p[1] : l.q[1], y: f < 0.5 ? l.p[2] : l.q[2] };
      return { fid: l.p[0], x: l.p[1] + (l.q[1] - l.p[1]) * f, y: l.p[2] + (l.q[2] - l.p[2]) * f };
    }
    s -= l.d;
  }
  return { fid: L[0][0], x: L[0][1], y: L[0][2] };
}

export async function startDemo(page){
  const q = new URLSearchParams(location.search);
  const built = await (await fetch("demo_settings.json")).json();
  // The quiet house (fixture.js calm=1): no alarm, windows shut, °C throughout.
  const { MODEL, STATES } = harnessFixture(new URLSearchParams("calm=1"));
  const model = clone(MODEL);
  model.areas = Object.keys(model.room_geometry_m).map(name => ({ id: slug(name), name, floor_id: model.room_geometry_m[name].floor_id }));
  model.room_meta = {};
  let states = clone(STATES);
  const S = (state, attributes) => ({ state, attributes, last_changed: now(), last_updated: now(), last_reported: now() });
  for (const w of WALKERS) if (w.person) {
    const first = w.name.split("'")[0];
    states[w.eid] = S("home", { friendly_name: w.name, source_type: "bluetooth_le" });
    states[w.person] = S("home", { friendly_name: first, device_trackers: [w.eid] });
  }
  const settings = Object.assign({}, built.settings, {
    data_mode: "sample", onboarding_completed: true, telemetry_enabled: false, telemetry_asked: true,
    update_check_enabled: false, trial_nudge_done: true, tester_nudge_done: true, whatsnew_seen_version: built.version.version,
    atlas_3d_enabled: true, atlas_3d_people: true, atlas_3d_tags: true, atlas_weather_enabled: true, atlas_layout_v2: true,
    atlas_3d_carries: Object.fromEntries(WALKERS.filter(w => w.person).map(w => [w.person, [w.key]])),
    tier: "pro", edition: "full", pro_active: true, pro_has_key: false, offer_tester: false, offer_invite: false,
  });
  // ?fresh=1: what a brand-new install sees once Home Assistant reports its
  // Bluetooth scanners (onboarding.py, live_first): its own house, Live, no
  // floor plan and no room drawn yet, so the Overview leads with Who's where
  // now (views/whos_where.js). Phones come from Private BLE Device.
  // ?fresh=pending: the moment before — the panel open on the demo house,
  // and the "server" finding its first scanner 8 s later, as onboarding.py does.
  const fresh = q.get("fresh") === "1" || q.get("fresh") === "pending";
  if (fresh) {
    Object.assign(settings, { data_mode: "live", onboarding_completed: false, atlas_3d_enabled: false,
                              onboarding: { setup_ts: Date.now() / 1000 - 300, live_first: "switched" } });
    model.room_geometry_m = {};
    model.scanner_positions_m = {};
  }
  if (q.get("fresh") === "pending") {
    Object.assign(settings, { data_mode: "sample", onboarding: { ...settings.onboarding, live_first: "pending" } });
    setTimeout(() => Object.assign(settings, { data_mode: "live", onboarding: { ...settings.onboarding, live_first: "switched" } }), 8000);
  }
  // The demo opens straight onto the house: the first-time tips (the Atlas
  // coach mark, Live Aboard's card) count as seen. The bar says what it is.
  try { localStorage.setItem("padspan_ha_lights_coach_seen", "1"); localStorage.setItem("padspan_la3d_hint_seen", "1"); } catch (_) { /* no storage */ }
  // The flat Atlas or Live Aboard: the Atlas card's own choice, kept per browser.
  if (page === "atlas") localStorage.setItem("padspan_lv_3d_atlas", "0");
  if (page === "atlas3d") localStorage.setItem("padspan_lv_3d_atlas", "1");
  // Each person's figure, as People & devices would save it: drawn as them, not a marker.
  const figures = Object.fromEntries(WALKERS.filter(w => w.figure).map(w => [w.person, { params: clone(w.figure), origin: "build" }]));
  let house3d = { schema: 1, pieces: {}, lights: {}, openings: {}, devices: {}, figures, library: {} };

  const t0 = Date.now();
  const snapshot = () => {
    const t = (Date.now() - t0) / 1000;
    const list = WALKERS.map(w => {
      const at = walkAt(w, t), room = roomAt(model, at.fid, at.x, at.y);
      return { key: w.key, kind: w.kind, name: w.name, user_label: w.name, identified: true, entity_id: w.eid || null,
               linked_entities: w.eid ? [w.eid] : [], x_m: at.x, y_m: at.y, floor_id: at.fid, room, age_s: 1,
               knn_confidence: 0.8, sources: [{ source: "demo_scanner", rssi: -62 }] };
    });
    return { source: "demo", generated_at: now(), objects: { list } };
  };

  // ?fresh=1: four scanners, one with no area yet; each device is in the
  // room of the scanner that hears it best, as the engine does without a map.
  const FRESH_RADIOS = [
    { source: "demo-proxy-kitchen", name: "Kitchen proxy", area_name: "Kitchen" },
    { source: "demo-proxy-living", name: "Living room proxy", area_name: "Living Room" },
    { source: "demo-proxy-hall", name: "Hall proxy", area_name: "Hall" },
    { source: "demo-proxy-new", name: "esp32-bt-proxy-5f2a1c", area_name: "" },
  ];
  const NEAREST = { Kitchen: "Kitchen", Laundry: "Kitchen", "Living Room": "Living Room", Den: "Living Room", Hall: "Hall", Office: "Hall" };
  const freshModel = harnessFixture(new URLSearchParams("calm=1")).MODEL;
  const labels = { "IRK:5B0C": "Sam" };
  const FRESH_PHONES = [
    { name: "Alex's iPhone", canonical_id: "irk:9f2e", source: "private_ble_device" },
    { name: "Sam's iPhone", canonical_id: "irk:5b0c", source: "private_ble_device" },
    { name: "Jordan's Apple Watch", canonical_id: "irk:41d7", source: "private_ble_device" },
  ];
  const freshSnapshot = () => {
    const t = (Date.now() - t0) / 1000;
    const near = (w) => { const at = walkAt(w, t); return NEAREST[roomAt(freshModel, at.fid, at.x, at.y)] || "Hall"; };
    const phone = (w, p) => ({ key: p.canonical_id, canonical_id: p.canonical_id, kind: "private_ble", private_ble_name: p.name,
                               user_label: labels[p.canonical_id.toUpperCase()] || "", identified: !!labels[p.canonical_id.toUpperCase()],
                               room: near(w), age_s: 1 });
    const list = [
      phone(WALKERS[0], FRESH_PHONES[0]),
      phone(WALKERS[1], FRESH_PHONES[1]),
      { key: "demo:keys", kind: "ble", address: "demo:keys", name: "Keys", user_label: "Keys", identified: true, room: near(WALKERS[2]), age_s: 1 },
    ];
    // Everything else a house hears: TVs, speakers, the neighbours' phones.
    const others = { Kitchen: 4, "Living Room": 7, Hall: 2 };
    for (const [room, n] of Object.entries(others)) {
      for (let i = 0; i < n; i++) list.push({ key: `ble:${room}:${i}`, kind: "ble", address: `demo:other:${room}:${i}`, room, age_s: 2 });
    }
    return { source: "live", generated_at: now(), ble: { radios: FRESH_RADIOS, advertisements: [] }, objects: { list } };
  };

  // Overview's "People in building" (ws_occupancy.py's answer): the people
  // the snapshot places, the tag seen and not counted, motion where they are.
  const occupancy = () => {
    const list = snapshot().objects.list, mine = list.filter(o => o.entity_id);
    const people = WALKERS.filter(w => w.person).map(w => {
      const o = list.find(x => x.key === w.key);
      return { name: states[w.person].attributes.friendly_name, kind: "known", room: (o && o.room) || null, via: "person entity", aliases: [], assumed: false };
    });
    const motion = Object.entries(MOTION).filter(([, eid]) => states[eid] && states[eid].state === "on").map(([r]) => r);
    const rooms = {};
    for (const p of people) if (p.room) (rooms[p.room] = rooms[p.room] || { room: p.room, people: [], phones: 0, occupancy: false, motion: false }).people.push(p.name);
    for (const r of motion) (rooms[r] = rooms[r] || { room: r, people: [], phones: 0, occupancy: false, motion: false }).motion = true;
    for (const r of Object.values(rooms)) r.agreement = r.people.length && r.motion ? "agree" : r.people.length ? "ble_only" : "sensor_only";
    const n = people.length;
    return { total_estimate: n, total_low: n, total_high: n, confidence: "high", known: n, unknown: 0, people,
             rooms: Object.values(rooms).sort((a, b) => a.room.localeCompare(b.room)),
             evidence: { persons_home: people.map(p => p.name), persons_unlocated: [], phone_clusters: mine.length, phone_addresses: mine.length,
                         occupancy_rooms: [], motion_rooms: motion, unaccounted_rooms: [], stuck_sensors: [],
                         things_seen: list.filter(o => !o.entity_id).map(o => ({ label: o.name, kind: o.kind, room: o.room || null })) },
             hybrid_enabled: true, cluster_threshold: 0, training_count: 0, accuracy: null };
  };

  const route = async (m) => {
    switch (m.type) {
      case "padspan_ha/settings_get": return { settings: clone(settings), cpu_pinning_supported: false };
      case "padspan_ha/settings_set": { const { type, id, ...rest } = m; Object.assign(settings, rest); return { settings: clone(settings) }; }
      case "padspan_ha/version": return built.version;
      case "padspan_ha/model_get": return clone(model);
      case "padspan_ha/maps_list": return { maps: [] };
      case "padspan_ha/live_snapshot": return { snapshot: fresh ? freshSnapshot() : snapshot() };
      case "padspan_ha/private_ble_status": return fresh ? { devices: clone(FRESH_PHONES) } : {};
      case "padspan_ha/object_label_list": return { labels: clone(labels), registry_labels: {} };
      case "padspan_ha/object_label_set": labels[String(m.address).toUpperCase()] = m.label; return { ok: true };
      case "padspan_ha/occupancy_estimate": return occupancy();
      case "padspan_ha/house3d_get": return { enabled: true, data: clone(house3d), writable: true, counts: {} };
      case "padspan_ha/house3d_edit": {
        // Each part is {key: entry to set | null to remove}, as ws_house3d.py takes it.
        for (const part of ["openings", "lights", "devices", "pieces", "figures"]) {
          for (const [k, v] of Object.entries(m[part] || {})) { if (v === null) delete house3d[part][k]; else house3d[part][k] = v; }
        }
        return { enabled: true, data: clone(house3d), writable: true, counts: {} };
      }
      case "config/entity_registry/list": case "config/entity_registry/list_for_display":
        return Object.keys(states).map(eid => {
          const p = model.light_positions_m[eid], room = p ? roomAt(model, p.floor_id, p.x_m, p.y_m) : "";
          return { entity_id: eid, platform: "demo", area_id: room ? slug(room) : null, device_id: null, name: null };
        });
      case "config/device_registry/list": return [];
      case "config/area_registry/list": return model.areas.map(a => ({ area_id: a.id, name: a.name, floor_id: a.floor_id }));
      case "config/floor_registry/list": return model.floors.map(f => ({ floor_id: f.id, name: f.name, level: f.level }));
      default: return {};
    }
  };

  // A service call changes the states in memory; HA would push a new hass.
  const setState = (eid, state, attrs) => {
    const old = states[eid]; if (!old) return;
    states = { ...states, [eid]: { ...old, state, attributes: { ...old.attributes, ...(attrs || {}) }, last_changed: state !== old.state ? now() : old.last_changed, last_updated: now() } };
  };
  const callService = async (domain, service, data = {}) => {
    const ids = [].concat(data.entity_id || []);
    const { entity_id, ...attrs } = data;
    if (domain === "scene" && service === "apply") {
      for (const [eid, v] of Object.entries(data.entities || {})) setState(eid, typeof v === "string" ? v : v.state, typeof v === "object" ? v : null);
    }
    for (const eid of ids) {
      const cur = states[eid] && states[eid].state;
      if (service === "turn_on") setState(eid, "on", attrs);
      else if (service === "turn_off") setState(eid, "off");
      else if (service === "toggle") setState(eid, cur === "on" ? "off" : "on");
      else if (service === "lock" || service === "unlock") setState(eid, service + "ed");
    }
    push();
  };

  const hass = () => ({
    states, user: { is_admin: true, name: "Demo", id: "demo" }, language: "en", locale: { language: "en" }, themes: { darkMode: true },
    config: { latitude: 0, longitude: 0, time_zone: "UTC", unit_system: { temperature: "°C", length: "km" }, version: "2026.10.0" },
    callWS: (msg) => route(msg), callService, callApi: async () => ({}),
    connection: { subscribeMessage: async () => () => {}, subscribeEvents: async () => () => {}, sendMessagePromise: (msg) => route(msg),
                  addEventListener: () => {}, removeEventListener: () => {}, connected: true },
  });

  const panel = page === "panel";
  await import(`./${WWW}${panel ? "panel.js" : "lights_panel.js"}?b=${built.version.build_id}`);
  const app = document.createElement(panel ? "padspan-ha-app" : "padspan-lights-app");
  app.narrow = q.get("narrow") === "1"; app.panel = { config: {} };
  document.getElementById("app").appendChild(app);
  let current = null;
  const push = () => { current = hass(); app.hass = current; };
  push();

  // Life in the house: motion where someone is, temperatures that drift.
  setInterval(() => {
    const snap = snapshot(), busy = new Set(snap.objects.list.map(o => o.room));
    for (const [room, eid] of Object.entries(MOTION)) {
      const on = busy.has(room) ? "on" : "off";
      if (states[eid] && states[eid].state !== on) setState(eid, on);
    }
    const t = (Date.now() - t0) / 60000;
    for (const [eid, base] of Object.entries(STATES)) {
      if (!eid.endsWith("_temperature") || base.attributes.unit_of_measurement !== "°C") continue;
      setState(eid, (Number(base.state) + 0.5 * Math.sin(t + eid.length)).toFixed(1));
    }
    push();
  }, 3000);
  window.__demo = { app, route, snapshot, get hass(){ return current; } };
  return app;
}
