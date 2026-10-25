// The fixture house: a fictional house shared by the Live Aboard harness
// (tools/live_aboard_harness/index.html) and the public demo (tools/demo/).
// Nothing here is a real house. Rooms and positions are plan metres.
//
// harnessFixture(q) takes the page's query (URLSearchParams) and answers
// {MODEL, STATES}: the model_get payload and the Home Assistant states.
// The harness's options (one=1, gym=1, loft=1, sky=, night=, sunel=, smoke=0,
// wopen=0) are read here, so both pages build the same house. calm=1 is the
// public demo's quiet house: no smoke alarm, windows shut, every temperature
// in °C, no unavailable sensor and a fair sky. The harness keeps its edge cases.
export function harnessFixture(q){
  const rect = (floor_id, x0, y0, x1, y1) => ({ type: "poly", floor_id, points_m: [[x0, y0], [x1, y0], [x1, y1], [x0, y1]] });
  const one = q.get("one") === "1", calm = q.get("calm") === "1";
  const MODEL = {
    floors: one ? [{ id: "main", name: "Main", level: 0 }]
      : [{ id: "base", name: "Basement", level: -1 }, { id: "main", name: "Main", level: 0 }, { id: "upper", name: "Upper", level: 1 }],
    floor_elevations: { base: -2.7, main: 0, upper: 2.8 },
    room_geometry_m: Object.assign({
      Kitchen: rect("main", 0, 0, 5, 4), "Living Room": rect("main", 5.1, 0, 11, 6), Hall: rect("main", 0, 4.1, 5, 6),
      Den: rect("main", 0, 6.1, 5, 10), Laundry: rect("main", 5.1, 6.1, 11, 10),
    }, one ? {} : { Office: rect("upper", 0, 0, 5, 5), Bedroom: rect("upper", 5.1, 0, 11, 6), Bath: rect("upper", 0, 5.1, 5, 10),
                    Rec: rect("base", 0, 0, 8, 10), Shop: rect("base", 8.1, 0, 11, 10) }),
    light_positions_m: Object.assign({
      "light.kitchen_pots": { x_m: 2.5, y_m: 2, floor_id: "main" },
      "light.living_lamp": { x_m: 9, y_m: 4, floor_id: "main" },
      "light.living_valance": { x_m: 8, y_m: 0.3, floor_id: "main", width_cm: 300, height_cm: 5 },
      "light.den_lamp": { x_m: 0.6, y_m: 9.4, floor_id: "main", z_m: 1.2 },
      "fan.den_fan": { x_m: 2.5, y_m: 7.5, floor_id: "main" },
      "sensor.den_temperature": { x_m: 4.8, y_m: 7, floor_id: "main" },
      "sensor.kitchen_temperature": { x_m: 0.3, y_m: 2, floor_id: "main" },
      "sensor.living_temperature": { x_m: 10.7, y_m: 5, floor_id: "main" },
      "sensor.laundry_temperature": { x_m: 6, y_m: 9.7, floor_id: "main" },
      "lock.front": { x_m: 0.1, y_m: 5.5, floor_id: "main" },
      "binary_sensor.laundry_leak": { x_m: 10, y_m: 9.5, floor_id: "main" },
      "binary_sensor.hall_smoke": { x_m: 3.2, y_m: 5, floor_id: "main" },
      "binary_sensor.kitchen_motion": { x_m: 4.6, y_m: 0.4, floor_id: "main" },
      "binary_sensor.living_motion": { x_m: 7, y_m: 2, floor_id: "main" },
      "binary_sensor.hall_motion": { x_m: 1, y_m: 5, floor_id: "main" },
      "binary_sensor.den_motion": { x_m: 2.5, y_m: 8, floor_id: "main" },
      "binary_sensor.laundry_motion": { x_m: 8, y_m: 8, floor_id: "main" },
    }, one ? {} : { "binary_sensor.office_motion": { x_m: 2, y_m: 2, floor_id: "upper" }, "light.bed": { x_m: 8, y_m: 3, floor_id: "upper" },
                    "light.rec_cans": { x_m: 4, y_m: 5, floor_id: "base" }, "sensor.office_temperature": { x_m: 4.8, y_m: 2, floor_id: "upper" } }),
    rf_barriers_m: [{ id: "w1", name: "Living window", material: "glass", floor_id: "main", points_m: [[11, 2], [11, 3.6]], linked_entity_id: "binary_sensor.living_window" },
                    { id: "w2", name: "Kitchen window", material: "glass", floor_id: "main", points_m: [[1, 0], [2.6, 0]], linked_entity_id: "binary_sensor.kitchen_window" }].concat(q.get("loft") === "1" && !one ? [
                    // ?loft=1: Open (Loft) edges, the railing cases (live_aboard_house.js applyBarriers):
                    // all gaps: over the Laundry, an ordinary storey below (no drop: ?gym=1 has the railings),
                    // between two rooms upstairs and onto the street
                    { id: "loft", name: "Loft edge", material: "open", attenuation_dbm: 0, floor_id: "upper", points_m: [[5.1, 6], [11, 6]] },
                    { id: "between", name: "Office to bath", material: "open", attenuation_dbm: 0, floor_id: "upper", points_m: [[0.5, 5.05], [4.5, 5.05]] },
                    { id: "street", name: "Living room east", material: "open", attenuation_dbm: 0, floor_id: "main", points_m: [[11, 4], [11, 6]] }] : []),
    scanner_positions_m: {}, scanners: {},
  };
  // ?gym=1: a hall with a mezzanine (a sports hall, say): a 20 x 12 m hall
  // 7.5 m to the roof, and at 3.2 m a gallery across the back, a walkway in
  // front of the toilets. Open (Loft) edges: the gallery's front and the
  // walkway's front, both over the hall (railings), and gallery-to-walkway
  // (one floor: a gap).
  if (q.get("gym") === "1") Object.assign(MODEL, {
    floors: [{ id: "hall", name: "Hall", level: 0, floor_to_floor_m: 7.5 }, { id: "mezz", name: "Mezzanine", level: 1, floor_to_floor_m: 3 }],
    floor_elevations: { hall: 0, mezz: 3.2 },
    room_geometry_m: { Hall: rect("hall", 0, 0, 20, 12), Gallery: rect("mezz", 0, 0, 14, 4),
                       Toilets: rect("mezz", 14.12, 0, 20, 2.5), Walkway: rect("mezz", 14.12, 2.62, 20, 4) },
    rf_barriers_m: [
      { id: "gal", name: "Gallery edge", material: "open", attenuation_dbm: 0, floor_id: "mezz", points_m: [[0, 4], [14, 4]] },
      { id: "walk", name: "Walkway edge", material: "open", attenuation_dbm: 0, floor_id: "mezz", points_m: [[14.12, 4], [20, 4]] },
      { id: "galwalk", name: "Gallery to walkway", material: "open", attenuation_dbm: 0, floor_id: "mezz", points_m: [[14.06, 2.62], [14.06, 4]] },
    ],
    light_positions_m: { "light.kitchen_pots": { x_m: 10, y_m: 8, floor_id: "hall" }, "light.bed": { x_m: 6, y_m: 2, floor_id: "mezz" },
                         "light.living_valance": { x_m: 7, y_m: 3.8, floor_id: "mezz", width_cm: 300, height_cm: 5 } },
  });
  const ago = (min) => new Date(Date.now() - min * 60e3).toISOString();
  const S = (state, fn, a = {}, min = 60) => ({ state, attributes: { friendly_name: fn, ...a }, last_changed: ago(min), last_updated: ago(min), last_reported: ago(Math.min(min, 3)) });
  const M = { device_class: "motion" };
  const STATES = {
    "light.kitchen_pots": S("on", "Kitchen pots", { brightness: 200 }),
    "light.living_lamp": S("off", "Living lamp"),
    "light.bed": S("on", "Bed light", { brightness: 120 }),
    "light.rec_cans": S("on", "Rec cans"),
    "light.living_valance": S("on", "Living valance", { rgb_color: [255, 120, 40], brightness: 255 }),
    "light.den_lamp": S("on", "Den lamp", { brightness: 150 }),
    "fan.den_fan": S("on", "Den fan"),
    "sensor.den_temperature": S("21.5", "Den temperature", { device_class: "temperature", unit_of_measurement: "°C" }),
    "sensor.kitchen_temperature": S("19", "Kitchen temperature", { device_class: "temperature", unit_of_measurement: "°C" }),
    "sensor.living_temperature": calm ? S("22.5", "Living temperature", { device_class: "temperature", unit_of_measurement: "°C" })
      : S("72", "Living temperature", { device_class: "temperature", unit_of_measurement: "°F" }),
    "sensor.laundry_temperature": S("26.5", "Laundry temperature", { device_class: "temperature", unit_of_measurement: "°C" }),
    "sensor.office_temperature": S("24.5", "Office temperature", { device_class: "temperature", unit_of_measurement: "°C" }),
    "lock.front": S("locked", "Front lock"),
    "binary_sensor.living_window": S(q.get("wopen") === "0" || calm ? "off" : "on", "Living room window", { device_class: "window" }),
    "binary_sensor.kitchen_window": S("off", "Kitchen window", { device_class: "window" }),
    "sun.sun": q.get("sunel") ? { state: Number(q.get("sunel")) > 0 ? "above_horizon" : "below_horizon", attributes: { elevation: Number(q.get("sunel")), azimuth: 200 }, last_changed: ago(30) }
      : { state: q.get("night") ? "below_horizon" : "above_horizon", attributes: { elevation: q.get("night") ? -20 : 35, azimuth: 200 }, last_changed: ago(30) },
    "weather.home": S(q.get("sky") || (calm ? "partlycloudy" : "rainy"), "Home", { temperature: 12 }),
    "binary_sensor.laundry_leak": S("off", "Laundry leak", { device_class: "moisture" }),
    "binary_sensor.hall_smoke": S(q.get("smoke") === "0" || calm ? "off" : "on", "Hall smoke alarm", { device_class: "smoke" }, 1),
    "binary_sensor.kitchen_motion": S("on", "Kitchen motion", M, 0.2),
    "binary_sensor.living_motion": S("off", "Living motion", M, 12),
    "binary_sensor.hall_motion": S("off", "Hall motion", M, 70),
    "binary_sensor.den_motion": S("off", "Den motion", M, 600),
    "binary_sensor.laundry_motion": S(calm ? "off" : "unavailable", "Laundry motion", M, 30),
    "binary_sensor.office_motion": S("off", "Office motion", M, 3),
  };
  return { MODEL, STATES };
}
