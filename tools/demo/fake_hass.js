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
    loop: [["main", 2.5, 2], ["main", 8, 3], ["main", 8, 8], ["main", 2.5, 8], ["main", 2.5, 5]] },
  { key: "demo:sam_phone", eid: "device_tracker.sam_phone", person: "person.sam", name: "Sam's phone", kind: "entity",
    loop: [["upper", 2.5, 2.5], ["upper", 8, 3], ["upper", 2.5, 7.5], ["main", 2.5, 5], ["main", 8, 2]] },
  { key: "demo:keys", name: "Keys", kind: "ble", loop: [["main", 1, 5], ["main", 1.2, 5.2]] },
];
const MOTION = { Kitchen: "binary_sensor.kitchen_motion", "Living Room": "binary_sensor.living_motion", Hall: "binary_sensor.hall_motion",
                 Den: "binary_sensor.den_motion", Office: "binary_sensor.office_motion" };

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
  const { MODEL, STATES } = harnessFixture(new URLSearchParams(""));
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
  // The flat Atlas or Live Aboard: the Atlas card's own choice, kept per browser.
  if (page === "atlas") localStorage.setItem("padspan_lv_3d_atlas", "0");
  if (page === "atlas3d") localStorage.setItem("padspan_lv_3d_atlas", "1");
  let house3d = { schema: 1, pieces: {}, lights: {}, openings: {}, devices: {}, figures: {}, library: {} };

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

  const route = async (m) => {
    switch (m.type) {
      case "padspan_ha/settings_get": return { settings: clone(settings), cpu_pinning_supported: false };
      case "padspan_ha/settings_set": { const { type, id, ...rest } = m; Object.assign(settings, rest); return { settings: clone(settings) }; }
      case "padspan_ha/version": return built.version;
      case "padspan_ha/model_get": return clone(model);
      case "padspan_ha/maps_list": return { maps: [] };
      case "padspan_ha/live_snapshot": return { snapshot: snapshot() };
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
