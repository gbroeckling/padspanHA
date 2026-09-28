// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
//
// RUN the Atlas sidebar panel (lights_panel.js) as the custom element it is.
//
// render_smoke.mjs walks views/ and calls every view's render(ctx) — but a
// view is a plain function. lights_panel.js (and panel.js) are stateful
// customElements with a lifecycle: constructor → hass setter → _boot() →
// connectedCallback → _render() → _poll(). Nothing ever instantiated one, so
// a ReferenceError anywhere on that path (an import that lost a name in a
// refactor, a helper renamed in lights_map.js) shipped as a BLANK SIDEBAR
// PANEL WITH A CLEAN TEST SUITE. Phase 2a's registry refactor rewired this
// file's imports and hold/⋯ handlers — exactly the kind of change this is for.
//
// It is a smoke test, not a rendering test: every scenario must get through
// boot, render, poll and the row/marker handlers without throwing, and must
// actually have produced the map and one index row per entity.
//
// usage: lights_panel_lifecycle.mjs <www/padspan-ha dir>
// prints one JSON line: { scenarios: [...], failures: [...], blip: {...}, restart: {...} }

import { pathToFileURL } from "node:url";
import { join } from "node:path";
import { install, flush } from "./dom_shim.mjs";
import { fakeConnection } from "./fake_ha_connection.mjs";

const WWW = process.argv[2];
if (!WWW) { console.error("usage: lights_panel_lifecycle.mjs <www/padspan-ha dir>"); process.exit(2); }

install(globalThis);

// ── What a custom element needs that a plain view never did ─────────────────
// Kept HERE, not in dom_shim.mjs: the 19 other harnesses rely on the shim's
// innerHTML staying an unparsed string (a parsed 2 MB iso SVG would turn a
// "did it throw" check into a DOM-fidelity project).
const defined = {};
globalThis.customElements = {
  define(name, cls) { defined[name] = cls; },
  get(name) { return defined[name]; },
  whenDefined: () => Promise.resolve(),
};
const VOID = new Set(["link", "meta", "br", "hr", "img", "input"]);
function parseInto(parent, html) {
  const src = String(html || "").replace(/<(style|script)\b[\s\S]*?<\/\1>/gi, "").replace(/<!--[\s\S]*?-->/g, "");
  const re = /<\/([\w-]+)\s*>|<([\w-]+)((?:\s+[^\s=>\/]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)\s*(\/?)>|([^<]+)/g;
  let cur = parent, m;
  while ((m = re.exec(src))) {
    if (m[1]) { if (cur !== parent && cur.localName === m[1].toLowerCase()) cur = cur.parentNode; continue; }
    if (m[2]) {
      const n = document.createElement(m[2].toLowerCase());
      for (const a of (m[3] || "").matchAll(/([^\s=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)) {
        n.setAttribute(a[1], a[2] ?? a[3] ?? a[4] ?? "");
      }
      cur.appendChild(n);
      if (!m[4] && !VOID.has(n.localName)) cur = n;
      continue;
    }
    if (m[5] && m[5].trim()) cur.appendChild(document.createTextNode(m[5]));
  }
}
globalThis.Node.prototype.attachShadow = function () {
  const root = document.createElement("#shadow-root");
  root.activeElement = null;
  let html = "";
  Object.defineProperty(root, "innerHTML", {
    get: () => html,
    set: (v) => { html = String(v ?? ""); root.children.length = 0; parseInto(root, html); },
  });
  this.shadowRoot = root;
  return root;
};

// ── A house ─────────────────────────────────────────────────────────────────
const NOW = Date.now();
const iso = (msAgo) => new Date(NOW - msAgo).toISOString();
const ST = (entity_id, state, attributes = {}, changedAgo = 60_000) =>
  ({ entity_id, state, attributes: { friendly_name: entity_id.split(".")[1].replace(/_/g, " "), ...attributes },
     last_changed: iso(changedAgo), last_updated: iso(changedAgo) });
const STATES = Object.fromEntries([
  ST("light.kitchen_pots", "on", { brightness: 180, supported_color_modes: ["brightness"] }),
  ST("light.kitchen_valance", "on", { effect_list: ["Rainbow", "Solid"], rgb_color: [255, 120, 40], supported_color_modes: ["rgb"] }),
  ST("light.deck_segment", "off", { supported_color_modes: ["rgb"] }),
  ST("light.hall_plain", "off", { supported_color_modes: ["onoff"] }),
  ST("light.dead_bulb", "unavailable"),
  ST("fan.great_room", "on", { percentage: 66, percentage_step: 33, oscillating: false }),
  ST("lock.front_door", "locked"),
  ST("lock.side_door", "jammed"),
  ST("binary_sensor.hall_motion", "on", { device_class: "motion" }, 5_000),
  ST("binary_sensor.stuck_motion", "on", { device_class: "occupancy" }, 9 * 3600_000),
  ST("binary_sensor.front_door_contact", "on", { device_class: "door" }),
  ST("binary_sensor.kitchen_window", "off", { device_class: "window" }),
  ST("binary_sensor.kitchen_sink_leak", "off", { device_class: "moisture" }),
  ST("binary_sensor.laundry_leak", "on", { device_class: "moisture" }),
  ST("sensor.kitchen_temperature", "21.5", { device_class: "temperature", unit_of_measurement: "°C" }),
  ST("sensor.stale_temperature", "18", { device_class: "temperature", unit_of_measurement: "°C" }, 5 * 3600_000),
  ST("sensor.bath_humidity", "61", { device_class: "humidity", unit_of_measurement: "%" }),
  ST("sensor.office_co2", "1650", { device_class: "carbon_dioxide", unit_of_measurement: "ppm" }),
  ST("sensor.bath_outlet_air_quality", "moderate", { device_class: "enum" }),
].map(s => [s.entity_id, s]));

const AREAS = [{ area_id: "kitchen", name: "Kitchen", floor_id: "main" }, { area_id: "hall", name: "Hall", floor_id: "main" },
               { area_id: "loft", name: "Loft", floor_id: "up" }];
const AREA_OF = (eid) => /kitchen/.test(eid) ? "kitchen" : /loft|office|bath/.test(eid) ? "loft" : /dead_bulb/.test(eid) ? null : "hall";
const ENTITY_REG = Object.keys(STATES).map((entity_id, i) => ({
  entity_id, area_id: AREA_OF(entity_id), device_id: "dev" + i, hidden_by: null, disabled_by: null,
  platform: entity_id === "light.deck_segment" ? "partition" : "demo",
}));
const DEVICE_REG = ENTITY_REG.map((e) => ({ id: e.device_id, area_id: e.area_id, manufacturer: "Acme", model: "X1", configuration_url: null, connections: [] }));
const MODEL = {
  areas: AREAS,
  floors: [{ id: "main", name: "Main", level: 0 }, { id: "up", name: "Upstairs", level: 1 }],
  room_geometry_m: {
    Kitchen: { type: "poly", floor_id: "main", points_m: [[0, 0], [6, 0], [6, 4], [0, 4]] },
    Hall:    { type: "poly", floor_id: "main", points_m: [[6, 0], [10, 0], [10, 4], [6, 4]] },
    Loft:    { type: "poly", floor_id: "up",   points_m: [[0, 0], [5, 0], [5, 5], [0, 5]] },
  },
  light_positions_m: {
    "light.kitchen_pots": { x_m: 2, y_m: 2, floor_id: "main", width_cm: 40, height_cm: 40 },
    "light.kitchen_valance": { x_m: 4, y_m: 1, floor_id: "main", width_cm: 200, height_cm: 10, rotation: 15 },
    "fan.great_room": { x_m: 8, y_m: 2, floor_id: "main" },
    "lock.front_door": { x_m: 9, y_m: 3.5, floor_id: "main" },
    "binary_sensor.hall_motion": { x_m: 7, y_m: 1, floor_id: "main" },
    "binary_sensor.laundry_leak": { x_m: 9, y_m: 1, floor_id: "main" },
    "binary_sensor.kitchen_sink_leak": { x_m: 1, y_m: 3, floor_id: "main" },
    "sensor.kitchen_temperature": { x_m: 3, y_m: 3, floor_id: "main" },
    "sensor.bath_humidity": { x_m: 1, y_m: 1, floor_id: "up" },
    "sensor.office_co2": { x_m: 3, y_m: 3, floor_id: "up" },
  },
  rf_barriers_m: [
    { id: "b1", floor_id: "main", material: "wood", attenuation_dbm: 4, points_m: [[6, 1], [6, 2]], linked_entity_id: "binary_sensor.front_door_contact" },
    { id: "b2", floor_id: "main", material: "wood", attenuation_dbm: 4, points_m: [[10, 1], [10, 2]], linked_entity_id: "lock.side_door" },
  ],
  ha_started_at: iso(24 * 3600_000),
};

function makeHass({ settings, admin = true }) {
  const calls = { ws: [], svc: [] };
  return {
    calls,
    states: STATES,
    user: { is_admin: admin, name: "smoke" },
    language: "en",
    config: { unit_system: { temperature: "°C" } },
    callWS: async (msg) => {
      calls.ws.push(msg.type);
      switch (msg.type) {
        case "padspan_ha/settings_get": return { settings };
        case "padspan_ha/settings_set": return { settings };
        case "padspan_ha/model_get": return MODEL;
        case "padspan_ha/flood_reset": return { ok: true };
        case "config/entity_registry/list": return ENTITY_REG;
        case "config/device_registry/list": return DEVICE_REG;
        case "config/area_registry/list": return AREAS;
        default: return {};
      }
    },
    callService: async (domain, service, data) => { calls.svc.push(`${domain}.${service}:${data && data.entity_id}`); },
    connection: { subscribeEvents: async () => () => {}, subscribeMessage: async () => () => {},
      addEventListener() {}, removeEventListener() {} },
  };
}

const BASE = { tier: "pro", lights_showcase: false, lights_automorph_enabled: false, flood_latches: {}, lights_hidden: [] };
const SCENARIOS = [
  ["free tier, working mode", { ...BASE, tier: "free" }, {}],
  ["bright tier", { ...BASE, tier: "bright" }, {}],
  ["pro, working mode, non-admin", BASE, { admin: false }],
  ["pro, showcase + automorph + isolux + fit", { ...BASE, lights_showcase: true, lights_showcase_theme: "hygge", lights_automorph_enabled: true,
      lights_automorph_room_pct: 60, lights_automorph_hardness: -20, lights_automorph_style: "nebula", lights_isolux: true, lights_fit_rooms: true }, {}],
  ["pro, hide untouched + hide codes, a latched flood alarm", { ...BASE, lights_hide_untouched: true, lights_hide_device_codes: true,
      flood_latches: { "binary_sensor.kitchen_sink_leak": { triggered_at: NOW / 1000 - 3600, expires_at: NOW / 1000 + 86400 } } }, {}],
  ["settings that never arrive", null, {}],
];

const { } = await import(pathToFileURL(join(WWW, "lights_panel.js")).href);
const Cls = defined["padspan-lights-app"];
const scenarios = [], failures = [];
const fail = (name, what, err) => failures.push({ scenario: name, what, error: String(err && err.stack || err).slice(0, 1200) });
let _unhandled = null;
process.on("unhandledRejection", (e) => { _unhandled = e; });

if (!Cls) {
  fail("(module)", "customElements.define was never called for padspan-lights-app", "");
} else {
  for (const [name, settings, opts] of SCENARIOS) {
    const rec = { name, rows: 0, svg: false, svcCalls: 0 };
    _unhandled = null;
    try {
      const hass = makeHass({ settings: settings || {}, ...opts });
      if (settings === null) { const real = hass.callWS; hass.callWS = async (m) => { if (m.type === "padspan_ha/settings_get") throw new Error("ws down"); return real(m); }; }
      const el = new Cls();
      el.connectedCallback();
      // The real path: HA assigns .hass, the setter boots, nothing awaits it.
      el.hass = hass;
      await flush(); await flush();
      // …and then the explicit one, so a rejection in _boot surfaces HERE.
      await el._boot();
      await flush(); await flush();
      await el._poll();
      await flush();
      const content = el.shadowRoot.querySelector("#content");
      if (!content || !content.children.length) throw new Error("rendered nothing into #content");
      const all = content._all();
      rec.svg = all.some(n => typeof n.innerHTML === "string" && n.innerHTML.includes("<svg"));
      const rows = all.filter(n => n.localName === "tr" && n.getAttribute("data-eid"));
      rec.rows = rows.length;
      if (!rec.svg) throw new Error("no isometric <svg> was drawn");
      if (rows.length !== Object.keys(STATES).length) throw new Error(`index has ${rows.length} rows for ${Object.keys(STATES).length} entities`);

      // Every entity through the panel's own action paths.
      for (const eid of Object.keys(STATES)) {
        try { await el._toggle(eid); } catch (e) { fail(name, `_toggle(${eid})`, e); }
      }
      // Every row: its click, and every button in it (⋯ Controls, Reset,
      // Hide…). confirm() answers true; the hass is fake.
      for (const r of rows) {
        const eid = r.getAttribute("data-eid");
        try { r.click(); } catch (e) { fail(name, `row click ${eid}`, e); }
        for (const b of r._all().filter(n => n.localName === "button")) {
          try { b.click(); } catch (e) { fail(name, `row button "${b.textContent}" on ${eid}`, e); }
        }
      }
      // Every toolbar control outside the table.
      for (const b of all.filter(n => (n.localName === "button") && !rows.some(r => r.contains(n)))) {
        try { b.click(); } catch (e) { fail(name, `button "${b.textContent}"`, e); }
      }
      await flush(); await flush();
      try { el._render(); } catch (e) { fail(name, "re-render after the clicks", e); }
      rec.svcCalls = hass.calls.svc.length;
      // Read-only classes must never have reached a service call.
      const bad = hass.calls.svc.filter(c => /binary_sensor\.|sensor\./.test(c));
      if (bad.length) fail(name, "a read-only sensor reached callService", bad.join(", "));
      el.disconnectedCallback();
      if (_unhandled) fail(name, "unhandled promise rejection", _unhandled);
    } catch (e) { fail(name, "lifecycle", e); }
    scenarios.push(rec);
  }
}

// A motion sensor back from an offline blip 30 s ago, its real change 9 h
// before (motion_reconnects.py): the panel subscribes on its own, and the
// pushed entry redraws the marker quiet — no pulse, no ring.
const blip = { subscribed: null, pulseBefore: null, pulseAfter: null, ringAfter: null };
if (Cls) {
  try {
    const eid = "binary_sensor.hall_motion";
    const hass = makeHass({ settings: BASE });
    hass.states = { ...STATES, [eid]: ST(eid, "off", { device_class: "motion" }, 30_000) };
    let push = null;
    hass.connection = { subscribeEvents: async () => () => {}, addEventListener() {}, removeEventListener() {},
      subscribeMessage: async (cb, msg) => { push = cb; blip.subscribed = msg; return () => {}; } };
    const el = new Cls();
    el.connectedCallback();
    el.hass = hass;
    await el._boot(); await flush(); await flush();
    await el._poll(); await flush();
    const svg = () => el.shadowRoot.querySelector("#content")._all().map(n => n.innerHTML).find(h => typeof h === "string" && h.includes("<svg")) || "";
    const has = (cls) => new RegExp(`class="${cls}" data-eid="${eid.replace(/\./g, "\\.")}"`).test(svg());
    blip.pulseBefore = has("lpulse");
    push({ [eid]: { at: hass.states[eid].last_changed, last_changed: iso(9 * 3600_000) } });
    await flush(); await flush();
    blip.pulseAfter = has("lpulse"); blip.ringAfter = has("lrecent");
    el.disconnectedCallback();
  } catch (e) { fail("motion reconnect", "lifecycle", e); }
}

// HA restarts under a page that stays open (the wall kiosk). The frontend
// keeps the same Connection object; the reconnect lands before PadSpan has
// registered its commands, so the first re-subscribe is refused. Once PadSpan
// is up, the subscription must be live again — once — and pushes must land.
const restart = { liveBefore: null, liveWhileLoading: null, liveAfter: null, delivered: null,
  liveAfterDisconnect: null, readyListenersAfterDisconnect: null, wire: null };
if (Cls) {
  try {
    const conn = fakeConnection();
    conn.subscribeEvents = async () => () => {};
    const hass = makeHass({ settings: BASE });
    hass.connection = conn;
    const el = new Cls();
    el.connectedCallback();
    el.hass = hass;
    await el._boot(); await flush();
    restart.liveBefore = conn.live;
    conn.padspanLoaded = false;
    await conn.restart(); await flush();
    restart.liveWhileLoading = conn.live;
    conn.padspanLoaded = true;
    el.hass = { ...hass };                      // HA hands the panel a fresh hass, same connection
    await flush(); await flush();
    restart.liveAfter = conn.live;
    el.state._motionReconnects = "untouched";
    conn.push("padspan_ha/motion_reconnects", { "binary_sensor.hall_motion": { at: "a", last_changed: "b" } });
    restart.delivered = el.state._motionReconnects !== "untouched";
    el.disconnectedCallback();
    await flush();
    restart.liveAfterDisconnect = conn.live;
    restart.readyListenersAfterDisconnect = conn.listenerCount("ready");
    restart.wire = conn.wire;
  } catch (e) { fail("HA restart", "lifecycle", e); }
}

// The "Test emergency lighting" button (emergency_test.py): hidden without
// lights, floats right after the stage, toggles through the backend, and
// Force off shows only while a test runs.
const emergency = { hiddenWithout: null, afterStage: null, idleForce: null, sent: [], activeForce: null,
  activeLabel: null, endedForce: null };
if (Cls) {
  try {
    const members = [{ entity_id: "light.a", name: "Closet", state: "off" },
                     { entity_id: "switch.b", name: "PoE 7", state: "on" }];
    let test = { active: false, started_at: null, kept_on: [] };
    let available = false;
    const hass = makeHass({ settings: BASE });
    const real = hass.callWS;
    hass.callWS = async (m) => {
      if (m.type === "padspan_ha/emergency_status") return { available, source: "group", groups: [], members, test };
      if (m.type === "padspan_ha/emergency_test" || m.type === "padspan_ha/emergency_force_off") {
        emergency.sent.push(m.type === "padspan_ha/emergency_test" ? `test:${m.on}` : "force_off");
        test = m.on ? { active: true, started_at: 1, kept_on: ["switch.b"] } : { active: false, started_at: null, kept_on: [] };
        return { available, source: "group", groups: [], members, test,
                 results: [{ entity_id: "light.a", ok: true }, { entity_id: "switch.b", ok: false, skipped: "unavailable" }] };
      }
      return real(m);
    };
    const el = new Cls();
    el.connectedCallback();
    el.hass = hass;
    await el._boot(); await flush(); await flush();
    const find = (cls) => el.shadowRoot.querySelector("#content")._all().filter(n => (n.className || "").split(" ").includes(cls));
    emergency.hiddenWithout = find("lv-emerg-btn").length === 0;
    available = true;
    await el._loadEmergency(); el._render();
    const anchor = find("lv-emerg-anchor")[0];
    const stage = find("lv-stage")[0];
    emergency.afterStage = !!(anchor && stage && stage.nextSibling === anchor);
    emergency.idleForce = find("lv-emerg-force").length;
    find("lv-emerg-btn")[0].click();
    await flush(); await flush();
    emergency.activeForce = find("lv-emerg-force").length;
    emergency.activeLabel = find("lv-emerg-label")[0]?.textContent || null;
    find("lv-emerg-force")[0].click();
    await flush(); await flush();
    emergency.endedForce = find("lv-emerg-force").length;
    el.disconnectedCallback();
  } catch (e) { fail("emergency test button", "lifecycle", e); }
}

console.log(JSON.stringify({ scenarios, failures, blip, restart, emergency }));
process.exit(failures.length ? 1 : 0);
