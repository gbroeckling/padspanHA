// The public demo's Home Assistant: just enough of `hass` for the real
// PadSpan panel and the sidebar Atlas to run in a browser with no server.
// The house is the estate (the panel's own estate.js, through sample_house.js:
// three floors, furnished, two residents, a guest wearing a visitor tag) — the
// same house the panel's Sample mode shows ("Preview a finished house");
// ?house=classic is the old one-box-a-room house (fixture.js, the Live Aboard
// harness's), which ?fresh= keeps too. The panel sees hass.padspan_demo and
// asks this fake for everything, its Sample-mode snapshot included.
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

// The classic house's two people and a tag: waypoints in plan metres.
const CLASSIC_WALKERS = [
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
const CLASSIC_MOTION = { Kitchen: "binary_sensor.kitchen_motion", "Living Room": "binary_sensor.living_motion", Hall: "binary_sensor.hall_motion",
                         Den: "binary_sensor.den_motion", Laundry: "binary_sensor.laundry_motion", Office: "binary_sensor.office_motion" };

export async function startDemo(page){
  const q = new URLSearchParams(location.search);
  const built = await (await fetch("demo_settings.json")).json();
  // The estate and its helpers: the panel's own module (sample_house.js), at
  // the URL the panel imports it from, so both share one copy.
  const SH = await import(`./${WWW}sample_house.js?b=${built.version.build_id}`);
  const { roomAt, walkAt, snapshotOf, occupancyOf } = SH;
  // ?fresh=: a new install's first minutes, on the classic house (below).
  const fresh = ["1", "pending", "wizard"].includes(q.get("fresh"));
  // The estate, or with ?house=classic the quiet classic house (fixture.js
  // calm=1: no alarm, windows shut, °C throughout).
  const classic = fresh || q.get("house") === "classic";
  const house = classic ? { ...harnessFixture(new URLSearchParams("calm=1")), HOUSE3D: null, WALKERS: CLASSIC_WALKERS, MOTION: CLASSIC_MOTION }
    : SH.estateFixture(q);
  const { MODEL, STATES, WALKERS, MOTION } = house;
  // The estate as the panel's Sample mode shows it: measured floor plans,
  // calibration, diagnostics (the reads this fake does not answer itself).
  const finished = classic ? null : SH.createSampleHouse(q);
  const model = clone(MODEL);
  if (finished) model.map_transforms = clone(finished.model.map_transforms);
  model.areas = Object.keys(model.room_geometry_m).map(name => ({ id: slug(name), name, floor_id: model.room_geometry_m[name].floor_id }));
  model.room_meta = clone(MODEL.room_meta || {});
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
  // ?look= and ?quality=: Live Aboard's look (atlas, own or studio) and quality (auto, low or high),
  // as Settings → UI Structure → 🏠 Live Aboard sets them.
  if (["atlas", "own", "studio"].includes(q.get("look"))) settings.atlas_3d_look = q.get("look");
  if (["auto", "low", "high"].includes(q.get("quality"))) settings.atlas_3d_quality = q.get("quality");
  // ?fresh=1: what a brand-new install sees once Home Assistant reports its
  // Bluetooth scanners (onboarding.py, live_first): its own house, Live, no
  // floor plan and no room drawn yet, so the Overview leads with Who's where
  // now (views/whos_where.js). Phones come from Private BLE Device.
  // ?fresh=pending: the moment before — the panel open on the demo house,
  // and the "server" finding its first scanner 8 s later, as onboarding.py does.
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
  // Sample / Live is each browser's own choice in the panel (panel.js _applyDataMode): the demo
  // always opens on its own settings, whatever a visit before chose.
  try { localStorage.removeItem("padspan_data_mode"); localStorage.removeItem("padspan_follow_live"); } catch (_) { /* no storage */ }
  // The flat Atlas or Live Aboard: the Atlas card's own choice, kept per browser.
  if (page === "atlas") localStorage.setItem("padspan_lv_3d_atlas", "0");
  if (page === "atlas3d") localStorage.setItem("padspan_lv_3d_atlas", "1");
  // Each person's figure, as People & devices would save it: drawn as them, not a marker.
  const figures = Object.fromEntries(WALKERS.filter(w => w.figure).map(w => [w.person, { params: clone(w.figure), origin: "build" }]));
  // The estate comes furnished, with its stairs (Furnish's own pieces).
  let house3d = { schema: 1, pieces: clone((house.HOUSE3D && house.HOUSE3D.pieces) || {}), lights: {}, openings: {}, devices: {}, figures, library: {} };

  // ?at=: start everyone that many seconds along their walk (a picture of a given moment).
  const t0 = Date.now() - 1000 * Math.max(0, Number(q.get("at")) || 0);
  const snapshot = () => snapshotOf(model, WALKERS, (Date.now() - t0) / 1000, { source: "demo", generatedAt: now() });

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
  // ?fresh=wizard: the same house with one floor plan traced and measured
  // in the Setup Wizard but not yet on the map (wizard_build.js): three
  // rooms and three scanners pinned, a 12 m x 9 m placement, an empty fabric.
  const wizard = q.get("fresh") === "wizard";
  const WIZ_TF = { origin_x_m: 0, origin_y_m: 0, scale_x_m: 12, scale_y_m: 9, rotation_rad: 0, shear_rad: 0, floor_id: "main",
                   reference_measurements: [{ p1: [0, 0], p2: [1, 0], distance_m: 12 }] };
  const WIZ_MAP = { id: "demo-plan", name: "Ground floor", floor_id: "main", image: { width: 1200, height: 900 },
    room_bounds: { Kitchen: [[0, 0], [0.5, 0], [0.5, 0.5], [0, 0.5]], "Living Room": [[0.5, 0], [1, 0], [1, 0.6], [0.5, 0.6]],
                   Hall: [[0, 0.5], [0.5, 0.5], [0.5, 1], [0, 1]] },
    receivers: [{ id: "p1", label: "Kitchen proxy", x: 0.25, y: 0.25, room: "Kitchen", source: "demo-proxy-kitchen" },
                { id: "p2", label: "Living room proxy", x: 0.75, y: 0.3, room: "Living Room", source: "demo-proxy-living" },
                { id: "p3", label: "Hall proxy", x: 0.25, y: 0.75, room: "Hall", source: "demo-proxy-hall" }] };
  if (wizard) model.map_transforms = { [WIZ_MAP.id]: WIZ_TF };
  const toM = ([fx, fy]) => [WIZ_TF.origin_x_m + fx * WIZ_TF.scale_x_m, WIZ_TF.origin_y_m + fy * WIZ_TF.scale_y_m];
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
  const occupancy = () => occupancyOf(snapshot().objects.list, WALKERS, states, MOTION);

  const route = async (m) => {
    switch (m.type) {
      case "padspan_ha/settings_get": return { settings: clone(settings), cpu_pinning_supported: false };
      case "padspan_ha/settings_set": { const { type, id, ...rest } = m; Object.assign(settings, rest); return { settings: clone(settings) }; }
      case "padspan_ha/version": return built.version;
      case "padspan_ha/model_get": return clone(model);
      case "padspan_ha/maps_list": return wizard ? { maps: [clone(WIZ_MAP)] } : finished ? finished.route(m) : { maps: [] };
      case "padspan_ha/fabric_truth_candidates": return { floor_id: m.floor_id, transforms: { rooms: Object.fromEntries(
        Object.entries(WIZ_MAP.room_bounds).map(([r, pts]) => [r, { type: "poly", floor_id: "main", source_map_id: WIZ_MAP.id, points_m: pts.map(toM) }])) } };
      case "padspan_ha/fabric_correct_room":
        model.room_geometry_m[m.room] = { ...m.geometry, floor_id: m.floor_id };
        model.areas = Object.keys(model.room_geometry_m).map(name => ({ id: slug(name), name, floor_id: model.room_geometry_m[name].floor_id }));
        return { ok: true };
      case "padspan_ha/fabric_scanner_position_set":
        model.scanner_positions_m[m.source] = { x_m: m.x_m, y_m: m.y_m, z_m: m.z_m ?? 2.4, floor_id: m.floor_id };
        return { ok: true };
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
      default: { const r = finished && finished.route(m); return r === undefined ? {} : r; }
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
    // padspan_demo: this is the demo's own in-memory house, so the panel's
    // Sample mode asks it rather than answering from its own copy (panel.js _sampleGateOn).
    padspan_demo: true,
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
  window.__demo = { app, route, snapshot, house: classic ? "classic" : "estate", get hass(){ return current; } };
  return app;
}
