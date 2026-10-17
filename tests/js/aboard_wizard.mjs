// The Live Aboard setup wizard: survey() and checks() on a house shaped like
// the developer's (4 floors, one without a height; 92 placed, no heights; 7
// door/window sensors, 2 linked; WLED valances with no runs; no furniture),
// then every step rendered and clicked through.
import { pathToFileURL } from "node:url";
const ROOT = process.argv[2];
const { install } = await import(pathToFileURL(ROOT + "/tests/js/dom_shim.mjs").href);
install(globalThis);
const W = await import(pathToFileURL(ROOT + "/custom_components/padspan_ha/www/padspan-ha/views/aboard_wizard.js").href);
function el(tag, attrs = {}, children = []) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (k === "class") n.className = v; else if (k === "style") n.setAttribute("style", v);
    else if (k.startsWith("on") && typeof v === "function") n.addEventListener(k.slice(2), v);
    else if (v !== undefined && v !== null) n.setAttribute(k, String(v));
  }
  if (!Array.isArray(children)) children = [children];
  for (const c of children) { if (c == null) continue; n.appendChild(typeof c === "string" ? document.createTextNode(c) : c); }
  return n;
}
const st = (id, dc, name) => ({ entity_id: id, state: "off", attributes: { device_class: dc, friendly_name: name || id } });
const states = {};
for (const [id, dc] of [["binary_sensor.front_door", "door"], ["binary_sensor.back_door", "door"], ["binary_sensor.side_door", "door"],
                        ["binary_sensor.garage", "garage_door"], ["binary_sensor.kitchen_window", "opening"],
                        ["binary_sensor.bed_window", "opening"], ["binary_sensor.bath_window", "opening"],
                        ["binary_sensor.hall_motion", "motion"], ["sensor.living_temp", "temperature"], ["sensor.attic_temp", "temperature"]])
  states[id] = st(id, dc);
for (const id of ["light.kitchen_valance", "light.quinled_west_valance", "light.lamp", "light.pot_1"]) states[id] = st(id, null);
states["weather.forecast_home"] = st("weather.forecast_home"); states["person.garry"] = st("person.garry"); states["scene.evening"] = st("scene.evening");
const model = {
  floors: [{ id: "basement", name: "Basement", floor_to_floor_m: 3.0 }, { id: "main", name: "Main", floor_to_floor_m: 2.3 },
           { id: "outside", name: "Outside" }, { id: "upper", name: "Upper" }],
  room_geometry_m: { Living: { floor_id: "main" }, Kitchen: { floor_id: "main" }, Rec: { floor_id: "basement" }, Bed: { floor_id: "upper" } },
  light_positions_m: { "light.kitchen_valance": { x_m: 1, y_m: 1 }, "light.quinled_west_valance": { x_m: 2, y_m: 1 }, "light.lamp": { x_m: 3, y_m: 1 },
                       "binary_sensor.hall_motion": { x_m: 1, y_m: 2 }, "sensor.living_temp": { x_m: 2, y_m: 2 },
                       "binary_sensor.front_door": { x_m: 0, y_m: 0 }, "binary_sensor.back_door": { x_m: 0, y_m: 5 } },
  rf_barriers_m: [{ id: "b1", linked_entity_id: "binary_sensor.front_door" }, { id: "b2", linked_entity_id: "binary_sensor.back_door" }, { id: "b3" }],
};
const settings = { tier: "pro", atlas_3d_enabled: true, atlas_weather_enabled: true, atlas_3d_weather: true,
                   atlas_weather_rain_entity: "binary_sensor.rain", overview_atlas: false };
const s = W.survey({ settings, model, states, house: { pieces: {}, lights: {}, openings: {}, devices: {} }, webgl: true });
const c = W.checks(s);
const out = { steps: W.STEPS.map(x => x.id), done: Object.fromEntries(Object.entries(c).map(([k, v]) => [k, v.done])),
  floorsLine: c.floors.line, openingsLine: c.openings.line, stripsLine: c.strips.line, heightsLine: c.heights.line,
  floors: s.floors.map(f => f.id), freeOn: W.checks(W.survey({ settings: { tier: "free" }, model, states })).on.line };

// Render: open the wizard, then press Next through every step; save calls are recorded.
const calls = []; let modal = null;
const ctx = { hass: { states }, toast: () => {},
  state: { settings, model }, helpers: { el },
  actions: { openModal: (t, body) => { modal = body; }, closeModal: () => {}, renderRooms: () => {},
             settingsSet: async (p) => { calls.push(p); Object.assign(settings, p); return { settings }; },
             callWS: async (p) => (p.type === "padspan_ha/house3d_get" ? { data: { pieces: {}, lights: {}, openings: {}, devices: {} } } : {}),
             telemetryEvent: (n) => calls.push(n) } };
await W.openLiveAboardWizard(ctx);
const text = (n) => (n._text || n.textContent || "") + [...(n.childNodes || n.children || [])].map(text).join(" ");
const find = (n, label) => { if ((n.tagName || "").toLowerCase() === "button" && text(n).includes(label)) return n;
  for (const k of (n.childNodes || n.children || [])) { const r = find(k, label); if (r) return r; } return null; };
out.firstStep = ctx.state._laWizard.i;
ctx.state._laWizard.i = 0;
find(modal, "Turn it on").dispatchEvent(new Event("click"));
const seen = [];
for (let i = 0; i < W.STEPS.length; i++) {
  seen.push(text(modal).includes(`${i + 1}. ${W.STEPS[i].title}`));
  const next = find(modal, "Next");
  if (next) next.dispatchEvent(new Event("click"));
}
out.allRendered = seen.every(Boolean);
out.finish = !!find(modal, "Finish");
out.overviewMentioned = text(modal).includes("Show the Atlas as Overview");
out.events = calls.filter(x => typeof x === "string");
console.log(JSON.stringify(out));
