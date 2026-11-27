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

function makeHass({ settings, admin = true, extraStates = null }) {
  const calls = { ws: [], svc: [] };
  return {
    calls,
    // extraStates: entities the Atlas reads but never lists (a weather.*).
    states: extraStates ? { ...STATES, ...extraStates } : STATES,
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
  // Outdoor weather (views/atlas_weather.js): pouring outside, the overlay
  // drawn over the map — and, free, still.
  ["pro, pouring outside", { ...BASE, atlas_weather_enabled: true, atlas_weather_strength: 1.2 },
    { extraStates: { "weather.forecast_home": ST("weather.forecast_home", "pouring", { temperature: 9, temperature_unit: "°C" }) } }],
  ["free tier, snowing outside", { ...BASE, tier: "free", atlas_weather_enabled: true },
    { extraStates: { "weather.forecast_home": ST("weather.forecast_home", "snowy", { temperature: -3, temperature_unit: "°C" }) } }],
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
      const wx = all.find(n => n.classList && n.classList.contains("lv-wx"));
      rec.weather = wx ? (wx.classList.contains("still") ? "still" : "animated") : null;
      const rows = all.filter(n => n.localName === "tr" && n.getAttribute("data-eid"));
      rec.rows = rows.length;
      if (!rec.svg) throw new Error("no isometric <svg> was drawn");
      if (rows.length !== Object.keys(STATES).length) throw new Error(`index has ${rows.length} rows for ${Object.keys(STATES).length} entities`);

      // Every entity through the panel's own action paths. Unlock asks first
      // in the page (lights_map.js confirmUnlock): answered as a person would.
      for (const eid of Object.keys(STATES)) {
        try {
          const done = el._toggle(eid);
          const ask = document.body._all().filter(n => n.attributes && n.attributes.role === "alertdialog").pop();
          const yes = ask && ask._all().find(n => n.localName === "button" && n.textContent === "Unlock");
          if (yes) yes.click();
          await done;
        } catch (e) { fail(name, `_toggle(${eid})`, e); }
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
// lights, floats over the map's top-right from an anchor right before the
// stage, toggles through the backend, and Force off shows only while a test
// runs.
const emergency = { hiddenWithout: null, beforeStage: null, idleForce: null, sent: [], activeForce: null,
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
      if (m.type === "padspan_ha/emergency_member") {
        emergency.sent.push(`member:${m.entity_id}:${m.on}`);
        test = { ...test, manual: [m.entity_id] };
        return { available, source: "group", groups: [], members, test, results: [{ entity_id: m.entity_id, ok: true }] };
      }
      if (m.type === "padspan_ha/emergency_test" || m.type === "padspan_ha/emergency_force_off") {
        emergency.sent.push(m.type === "padspan_ha/emergency_test" ? `test:${m.on}` : "force_off");
        test = m.on ? { active: true, started_at: 1, kept_on: ["switch.b"], manual: [] }
                    : { active: false, started_at: null, kept_on: [], manual: [] };
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
    emergency.beforeStage = !!(anchor && stage && anchor.nextSibling === stage);
    emergency.idleForce = find("lv-emerg-force").length;
    find("lv-emerg-btn")[0].click();
    await flush(); await flush();
    emergency.activeForce = find("lv-emerg-force").length;
    emergency.activeLabel = find("lv-emerg-label")[0]?.textContent || null;
    // The ring: the card of every emergency light, a switch each.
    find("lv-emerg-ring")[0].click();
    await flush();
    const cardText = () => (el._emergCard ? document.body._all().map(n => n._text || "").join("|") : "");
    emergency.cardOpen = !!el._emergCard;
    emergency.cardNames = ["Closet", "PoE 7"].every(n => cardText().includes(n));
    emergency.cardTag = cardText().includes("was on");
    // Every row ends in a 38 px slot — the "⋯" or a blank — so the state
    // chips and switches line up down the list (a switch has no "⋯").
    const rowsOf = el._emergCard.sheet.children.filter(r => /border-bottom/.test(r.getAttribute("style") || ""));
    emergency.cardRows = rowsOf.length;
    emergency.cardAligned = rowsOf.length > 0 && rowsOf.every(r => /width:38px/.test(r.children[r.children.length - 1].getAttribute("style") || ""));
    const turn = document.body._all().find(n => n.localName === "button" && n.textContent === "Turn on");
    if (turn) turn.click();
    await flush(); await flush();
    el._render();                                   // a poll refills the open card; it must not throw
    emergency.cardStillOpen = !!el._emergCard;
    find("lv-emerg-force")[0].click();
    await flush(); await flush();
    emergency.endedForce = find("lv-emerg-force").length;
    el.disconnectedCallback();
  } catch (e) { fail("emergency test button", "lifecycle", e); }
}

// The review fixes (2026-09-28): a tap while switching is answered and
// Force off queued; a real emergency makes Force off ask twice; a stale
// status never overwrites an action's answer; the card is not rebuilt under
// a finger or when nothing changed; polling slows when there are no lights.
const emerg2 = { busyShown: null, stillToast: null, queuedRan: null, sent: [], armToast: null, armedLabel: null,
  armSent: null, confirmSent: null, staleIgnored: null, cardKept: null, cardRefilled: null, cardHeld: null,
  pollIdle: null, pollIdleLate: null, pollLive: null };
if (Cls) {
  try {
    const members = [{ entity_id: "light.a", name: "Closet", state: "off" }];
    let test = { active: true, started_at: 1, kept_on: [], manual: [] };
    let ran = [];
    let available = true;
    const gates = [];                                 // held answers, released by hand
    const hold = () => new Promise((res) => gates.push(res));
    const status = () => ({ available, source: "group", groups: [], members, test, emergency_ran: ran, pending_off: [] });
    let holdNext = false, statusCalls = 0;
    const hass = makeHass({ settings: BASE });
    const real = hass.callWS;
    hass.callWS = async (m) => {
      if (m.type === "padspan_ha/emergency_status") {
        statusCalls++;
        const snap = status();
        if (holdNext) { holdNext = false; await hold(); }
        return snap;
      }
      if (m.type === "padspan_ha/emergency_test" || m.type === "padspan_ha/emergency_force_off") {
        emerg2.sent.push(m.type === "padspan_ha/emergency_test" ? `test:${m.on}` : "force_off");
        if (holdNext) { holdNext = false; await hold(); }
        test = m.on ? { active: true, started_at: 1, kept_on: [], manual: [] }
                    : { active: false, started_at: null, kept_on: [], manual: [] };
        return { ...status(), results: [] };
      }
      return real(m);
    };
    const toasts = () => document.body._all().map(n => n._text || "").filter(Boolean).join("|");
    const el = new Cls();
    el.connectedCallback();
    el.hass = hass;
    await el._boot(); await flush(); await flush();
    const find = (cls) => el.shadowRoot.querySelector("#content")._all().filter(n => (n.className || "").split(" ").includes(cls));

    // 2. End the test (held), tap again, tap Force off: told, and queued.
    holdNext = true;
    find("lv-emerg-btn")[0].click();
    await flush();
    emerg2.busyShown = find("lv-emerg").some(n => n.classList.contains("busy"));
    find("lv-emerg-btn")[0].click();
    emerg2.stillToast = toasts().includes("Still switching…");
    find("lv-emerg-force")[0].click();
    find("lv-emerg-force")[0].click();                // repeated taps: one Force off
    gates.shift()();
    for (let i = 0; i < 6; i++) await flush();
    emerg2.queuedRan = emerg2.sent.join(",") === "test:false,force_off";

    // 9. A real emergency ran during the test: Force off asks twice.
    test = { active: true, started_at: 1, kept_on: [], manual: [] };
    ran = ["Emergency Lights - Power Failure"];
    emerg2.sent.length = 0;
    await el._loadEmergency(); el._render();
    // No flush() between the taps: the shim's flush fires every timer at
    // once, which would be the 3 s window running out.
    find("lv-emerg-force")[0].click();
    await Promise.resolve();
    emerg2.armSent = emerg2.sent.length;
    emerg2.armToast = toasts().includes("Tap again to turn off every emergency light");
    emerg2.armedLabel = find("lv-emerg-force")[0]?.textContent || null;
    find("lv-emerg-force")[0].click();
    for (let i = 0; i < 4; i++) await flush();
    emerg2.confirmSent = emerg2.sent.join(",");
    // …and a tap after the window closed asks again.
    test = { active: true, started_at: 1, kept_on: [], manual: [] };
    await el._loadEmergency(); el._render();
    emerg2.sent.length = 0;
    find("lv-emerg-force")[0].click();
    await flush();                                    // the window runs out
    find("lv-emerg-force")[0].click();
    await Promise.resolve();
    emerg2.rearmSent = emerg2.sent.length;
    await flush();
    ran = [];

    // 6. A status request that left before an action lands after it: ignored.
    test = { active: false, started_at: null, kept_on: [], manual: [] };
    await el._loadEmergency(); el._render();
    holdNext = true;
    const stale = el._loadEmergency();                // answers "not active", held
    await flush();
    find("lv-emerg-btn")[0].click();                  // start: answers "active"
    for (let i = 0; i < 4; i++) await flush();
    gates.shift()();
    await stale; await flush();
    emerg2.staleIgnored = !!(el.state._emerg && el.state._emerg.test && el.state._emerg.test.active);

    // 5. The card: not rebuilt when nothing changed, nor under a finger.
    find("lv-emerg-ring")[0].click();
    await flush();
    const card = el._emergCard;
    const first = card && card.sheet.children[0];
    el._render();
    emerg2.cardKept = !!card && card.sheet.children[0] === first;
    card.overlay.dispatchEvent({ type: "pointerdown" });
    el.state._emerg = { ...el.state._emerg, members: [{ ...members[0], name: "Closet 2" }] };
    el._render();
    emerg2.cardHeld = card.sheet.children[0] === first;
    card.overlay.dispatchEvent({ type: "pointerup" });
    el._render();
    emerg2.cardRefilled = card.sheet.children[0] !== first;
    card.close();

    // 11. Polling: 10 s with lights, 5 min without.
    available = false;
    await el._loadEmergency();
    statusCalls = 0;
    el._emergTs = Date.now() - 20_000; await el._poll();
    emerg2.pollIdle = statusCalls;
    el._emergTs = Date.now() - 301_000; await el._poll();
    emerg2.pollIdleLate = statusCalls;
    available = true;
    await el._loadEmergency();
    statusCalls = 0;
    el._emergTs = Date.now() - 11_000; await el._poll();
    emerg2.pollLive = statusCalls;
    el.disconnectedCallback();
  } catch (e) { fail("emergency review fixes", "lifecycle", e); }
}

// Settings → UI Structure → "Show the Test emergency lighting button" off:
// no button while idle, still asked every 5 minutes (not every 10 s), back
// the moment a test runs (started elsewhere), back when switched on again,
// and a failed settings fetch keeps the last answer.
const emerg3 = { hiddenAnchor: null, hiddenPollFast: null, hiddenPollSlow: null, activeWhileHidden: null,
  activePollFast: null, keptOnFailedFetch: null, backWhenReEnabled: null };
if (Cls) {
  try {
    const members = [{ entity_id: "light.a", name: "Closet", state: "off" }];
    let test = { active: false, started_at: null, kept_on: [], manual: [] };
    let statusCalls = 0, settingsDown = false;
    const settings = { ...BASE, atlas_emergency_button: false };
    const hass = makeHass({ settings });
    const real = hass.callWS;
    hass.callWS = async (m) => {
      if (m.type === "padspan_ha/emergency_status") {
        statusCalls++;
        return { available: true, source: "group", groups: [], members, test, emergency_ran: [], pending_off: [] };
      }
      if (m.type === "padspan_ha/settings_get" && settingsDown) throw new Error("ws down");
      return real(m);
    };
    const el = new Cls();
    el.connectedCallback();
    el.hass = hass;
    await el._boot(); await flush(); await flush();
    const find = (cls) => el.shadowRoot.querySelector("#content")._all().filter(n => (n.className || "").split(" ").includes(cls));
    const poll = async (emergAgo, settingsAgo = 0) => {
      el._emergTs = Date.now() - emergAgo;
      el._settingsTs = Date.now() - settingsAgo;
      await el._poll(); await flush();
    };
    el._render();
    emerg3.hiddenAnchor = find("lv-emerg-anchor").length;
    statusCalls = 0;
    await poll(11_000);
    emerg3.hiddenPollFast = statusCalls;
    await poll(301_000);
    emerg3.hiddenPollSlow = statusCalls;
    // A test started from another screen while the button is hidden.
    test = { active: true, started_at: 1, kept_on: [], manual: [] };
    await poll(301_000);
    emerg3.activeWhileHidden = find("lv-emerg-btn").length;
    statusCalls = 0;
    await poll(11_000);
    emerg3.activePollFast = statusCalls;
    test = { active: false, started_at: null, kept_on: [], manual: [] };
    await poll(11_000);
    // A settings fetch that fails keeps "hidden".
    settingsDown = true;
    await poll(0, 31_000);
    emerg3.keptOnFailedFetch = el.state._emergButtonHidden === true && find("lv-emerg-anchor").length === 0;
    settingsDown = false;
    // Switched back on in Settings: the next settings read brings it back.
    settings.atlas_emergency_button = true;
    await poll(0, 31_000);
    emerg3.backWhenReEnabled = find("lv-emerg-anchor").length;
    // Toasts: a new one replaces the last rather than landing on top of it.
    el._toast("first toast"); el._toast("second toast");
    const texts = document.body._all().map(n => n._text || "");
    emerg3.toastsOnScreen = texts.filter(t => t === "first toast" || t === "second toast").length;
    el.disconnectedCallback();
  } catch (e) { fail("emergency button hidden in settings", "lifecycle", e); }
}

// The saved floor when the page opens: the first card is drawn before the model
// is read, with no floors to check it against, and it has to last until there
// are. MODEL has two floors, so the view runs All, Main, the pair, Upstairs.
const savedFloor = {};
if (Cls) {
  const open = async (focus, modelDown = false) => {
    const hass = makeHass({ settings: { ...BASE, overview_iso_focus: focus } });
    const real = hass.callWS;
    hass.callWS = async (m) => {
      if (m.type === "padspan_ha/model_get" && modelDown) throw new Error("ws down");
      return real(m);
    };
    const el = new Cls();
    const draw = el._render, seen = [];
    let asked = 0;
    el._render = function () { if (el._view.scrollToChosen === true) asked++; draw.call(el); seen.push([Object.keys(el.state.model?.room_geometry_m || {}).length > 0, el._view.focusIdx]); };
    el.connectedCallback();
    // The real path: HA assigns .hass, the setter boots, nothing awaits it.
    el.hass = hass;
    for (let i = 0; i < 12; i++) await flush();
    const chips = el.shadowRoot.querySelector("#content")._all().filter(n => n.classList && n.classList.contains("floor") && n.classList.contains("on"));
    const out = { focus: el._view.focusIdx, noFloors: seen.filter(s => !s[0]).map(s => s[1]), floors: seen.filter(s => s[0]).map(s => s[1]), on: chips.map(c => c._floorIdx) };
    // The one scroll's request: made as the page opens, gone once the model's read has settled, not made again by a Refresh.
    out.askedAtOpen = asked > 0; out.askLeft = el._view.scrollToChosen === true;
    asked = 0;
    await el._boot();
    for (let i = 0; i < 12; i++) await flush();
    out.askedOnRefresh = asked > 0 || el._view.scrollToChosen === true;
    el.disconnectedCallback();
    return out;
  };
  try {
    savedFloor.main = await open(1);
    savedFloor.pair = await open(2);
    savedFloor.upstairs = await open(3);
    savedFloor.all = await open(0);
    savedFloor.gone = await open(5);
    savedFloor.modelDown = await open(3, true);
  } catch (e) { fail("a saved floor when the page opens", "lifecycle", e); }
}

// The house's alarm inside the emergency button (views/alarm_panel.js),
// through the panel itself (the owner, 2026-11-24: "put it in the emergency
// button on the top right of the screen inside the button there"): no alarm
// panel and the button is the same DOM as before (and so is a free house's
// with a quiet alarm); Bright and Pro: the button's centre is the alarm's
// shield, nothing beside the dial, and a press opens the button's card with
// the alarm on top and the emergency lights below, arming only after the
// question, never starting the lighting test; free shows only an alarm going
// off, with nothing to press; a house with no emergency lights gets the
// button for the alarm alone; a wall screen and a non-admin arm as they
// unlock; counted once.
const alarm = {};
if (Cls) {
  const tree = (n) => (n ? { tag: n.localName, a: n.attributes, html: n._html || "", text: n._text || "", kids: (n.children || []).map(tree) } : null);
  const STAGE = (extra) => ({ ...extra });
  const QUIET = { "alarm_control_panel.house": ST("alarm_control_panel.house", "disarmed", { supported_features: 3, code_format: null }) };
  const TRIG = { "alarm_control_panel.house": ST("alarm_control_panel.house", "triggered", { supported_features: 3, code_format: "number",
      open_sensors: { "binary_sensor.front_door_contact": "on" } }) };
  const open = async ({ tier = "bright", extra = {}, emerg = true, admin = true, kiosk = false, hidden = false, addons = null, running = false }) => {
    const settings = { ...BASE, tier, telemetry_enabled: true, pro_has_key: tier !== "free" || !!addons, ...(hidden ? { atlas_emergency_button: false } : {}),
      ...(addons ? { addons_licensed: addons } : {}) };
    const hass = makeHass({ settings, admin, extraStates: STAGE(extra) });
    const real = hass.callWS;
    const sent = [], svc = [], tests = [];
    hass.callWS = async (m) => {
      if (m.type === "padspan_ha/emergency_status") return emerg
        ? { available: true, source: "group", groups: [], members: [{ entity_id: "light.a", name: "Closet", state: "off" }], test: { active: running, kept_on: [], manual: [] } }
        : { available: false };
      if (m.type === "padspan_ha/emergency_test") { tests.push(m); return { ok: true, results: [], test: { active: !!m.on } }; }
      if (m.type === "padspan_ha/emergency_force_off") { tests.push(m); return { ok: true, results: [], available: true, members: [], test: { active: false } }; }
      if (m.type === "padspan_ha/telemetry_event") sent.push(m.event);
      return real(m);
    };
    hass.callService = async (domain, service, data) => { svc.push({ domain, service, ...data }); };
    if (kiosk) globalThis.location = { search: "?kiosk=1" };
    const el = new Cls();
    el.connectedCallback();
    el.hass = hass;
    await el._boot(); await flush(); await flush();
    el._render(); el._render();
    const find = (cls) => el.shadowRoot.querySelector("#content")._all().filter(n => (n.className || "").split(" ").includes(cls));
    return { el, hass, sent, svc, tests, find, done: () => { el.disconnectedCallback(); if (kiosk) delete globalThis.location; } };
  };
  const bodyAll = () => document.body._all();
  const askBox = () => bodyAll().filter(n => n.attributes && n.attributes.role === "alertdialog").pop() || null;
  const press = async (root, label) => {
    const b = root && root._all().find(n => n.localName === "button" && n.textContent === label);
    if (!b) throw new Error(`no "${label}" button`);
    b.click(); await flush(); await flush();
  };
  // The button's centre opens its card: the alarm on top (and the emergency lights below, where the house has them).
  const openCard = async (p) => {
    p.find("lv-emerg-alarm")[0].click();
    await flush();
    const sheet = p.el._emergCard && p.el._emergCard.sheet;
    const section = sheet && sheet._all().find(n => n.className === "ps-alarm-card");
    const words = sheet ? sheet._all().filter(n => n.localName === "button").map(n => n.textContent) : [];
    return { sheet, section, alarmFirst: !!section && sheet.children[1] === section, lights: words.includes("Start test") };
  };
  const armFrom = async (p) => {
    const c = await openCard(p);
    await press(c.section, "Arm away");
    const asked = !!askBox() && p.svc.length === 0;
    await press(askBox(), "Arm away");
    return { asked, card: !!c.section, alarmFirst: c.alarmFirst, lights: c.lights, noTest: p.tests.length === 0,
      links: c.section ? c.section._all().filter(n => n.localName === "a").length : -1,
      svc: p.svc.map(x => `${x.domain}.${x.service}:${x.entity_id}`) };
  };
  try {
    // No alarm panel: the overlay is exactly what it was (the alarm's path made to say nothing gives the same).
    let p = await open({});
    const real = JSON.stringify(tree(p.el._emergencyOverlay()));
    const sum = p.el._alarmSummary;
    p.el._alarmSummary = () => null;
    alarm.noPanelSame = real === JSON.stringify(tree(p.el._emergencyOverlay()));
    p.el._alarmSummary = sum;
    alarm.noPanelAlarm = p.find("lv-emerg-alarm").length;
    alarm.noPanelSent = p.sent.filter(e => e.startsWith("alarm_button:"));
    p.done();
    // Free, a quiet alarm: no Alarm & security, so no arming and no emergency lights test either (the owner,
    // 2026-11-25): no button at all, and no alarm in a card.
    p = await open({ tier: "free", extra: QUIET });
    alarm.freeQuietNone = p.el._emergencyOverlay() === null && p.find("lv-emerg-anchor").length === 0;
    p.el._openEmergencyCard();
    alarm.freeCard = !!(p.el._emergCard && p.el._emergCard.sheet._all().find(n => n.className === "ps-alarm-card"));
    p.el._emergCard && p.el._emergCard.close();
    p.done();
    // Free with another add-on (Audio): the same, nothing of Alarm & security.
    p = await open({ tier: "free", extra: QUIET, addons: ["audio"] });
    alarm.otherAddonNone = p.el._emergencyOverlay() === null && !p.el._alarmControls();
    p.done();
    // Free, no add-on, a test still running from before (the review, 2026-11-25): the lights show, so it can be ended
    // (its centre) and forced off (the card), and the card's list has no light's own switch.
    p = await open({ tier: "free", running: true });
    const rc = p.find("lv-emerg-btn")[0];
    alarm.runningShown = !!rc && p.find("lv-emerg-dial").length === 1;
    p.el._openEmergencyCard();
    const rsheet = p.el._emergCard && p.el._emergCard.sheet;
    const rwords = rsheet ? rsheet._all().filter(n => n.localName === "button").map(n => n.textContent) : [];
    alarm.runningCard = ["End test", "Force off"].every(w => rwords.includes(w)) && !rwords.includes("Turn on") && !rwords.includes("Turn off");
    p.el._emergCard && p.el._emergCard.close();
    if (rc) { rc.click(); await flush(); await flush(); }
    alarm.runningEnded = p.tests.map(m => m.type + ":" + (m.on === undefined ? "" : m.on));
    p.done();
    // Free with the Alarm & security add-on: as Bright and Pro, the shield and the lights' notch, armed from the card
    // after the question, the lights test below it; never the test from the centre.
    p = await open({ tier: "free", extra: QUIET, addons: ["alarm"] });
    alarm.addonLook = p.find("lv-emerg-notch").length === 1 && p.find("lv-emerg-alarm").length === 1;
    alarm.addonArm = await armFrom(p);
    p.el._emergCard && p.el._emergCard.close();
    p.done();
    // No emergency lights and no alarm: no button at all, as before.
    p = await open({ emerg: false });
    alarm.noLightsNoPanel = p.el._emergencyOverlay() === null && p.find("lv-emerg-anchor").length === 0;
    p.done();
    // Bright, one alarm: the centre is its shield, inside the dial, nothing beside it; armed from the card, after the question.
    p = await open({ extra: QUIET });
    const c = p.find("lv-emerg-alarm")[0];
    alarm.brightCentre = c ? [c.localName, c.className, c.attributes["aria-label"]] : null;
    const dial = p.find("lv-emerg-dial")[0];
    alarm.brightInside = !!c && !!dial && dial.children.includes(c) && p.find("lv-emerg-dial").length === 1
      && p.find("lv-emerg")[0].children.every(n => !(n.className || "").includes("alarm"));
    // Both: the emergency ring as it is, with its list notch, the shield as its centre.
    const br = p.find("lv-emerg-ring")[0];
    alarm.bothLook = br ? [br.className, br.attributes["aria-label"], p.find("lv-emerg-notch").length] : null;
    const anchor = p.find("lv-emerg-anchor")[0];
    alarm.brightBeforeStage = !!anchor && anchor.nextSibling === p.find("lv-stage")[0];
    alarm.brightArm = await armFrom(p);
    p.el._render(); p.el._render();
    alarm.brightSent = p.sent.filter(e => e.startsWith("alarm_button:"));
    p.el._emergCard && p.el._emergCard.close();
    p.done();
    // Pro too.
    p = await open({ tier: "pro", extra: QUIET });
    alarm.proCentre = p.find("lv-emerg-alarm").map(n => n.localName);
    p.done();
    // Free, the alarm going off: the shield in red, and the card says it, with the sensor, nothing to press. The
    // house's emergency lights are Alarm & security's: the button is the alarm's alone (no list notch).
    p = await open({ tier: "free", extra: TRIG });
    alarm.freeTriggeredAlone = p.find("lv-emerg-notch").length === 0 && p.find("lv-emerg-dial").length === 1;
    const f = p.find("lv-emerg-alarm")[0];
    const fc = f ? await openCard(p) : null;
    alarm.freeTriggered = f ? [f.className.includes("lv-emerg-alarm-triggered"), f.attributes["aria-label"],
      !!fc.section && fc.section.textContent.includes("Set off by front door contact"), fc.section ? fc.section._all().filter(n => n.localName === "button").length : -1] : null;
    p.el._emergCard && p.el._emergCard.close();
    p.done();
    // A house with no emergency lights: the button for the alarm alone, at the same corner; and with the test's button hidden in Settings.
    p = await open({ emerg: false, extra: QUIET });
    // Its own look: a plain ring in the alarm's colour, no emergency stripes' class change and no list notch.
    const ar = p.find("lv-emerg-ring")[0];
    alarm.aloneLook = ar ? [ar.className, ar.attributes["aria-label"], p.find("lv-emerg-notch").length] : null;
    const ac = p.find("lv-emerg-alarm").length === 1 ? await openCard(p) : null;
    alarm.aloneButton = p.find("lv-emerg-dial").length === 1 && p.find("lv-emerg-anchor").length === 1
      && !!ac && !!ac.section && !ac.lights;
    p.el._emergCard && p.el._emergCard.close();
    p.done();
    p = await open({ hidden: true, extra: QUIET });
    alarm.hiddenTestButton = p.find("lv-emerg-dial").length === 1 && p.find("lv-emerg-alarm").length === 1;
    p.done();
    // A wall screen (?kiosk=1) and a non-admin arm as they unlock a door, and nothing on the card leaves the page.
    p = await open({ extra: QUIET, kiosk: true });
    alarm.wallArm = await armFrom(p);
    p.el._emergCard && p.el._emergCard.close();
    p.done();
    p = await open({ extra: QUIET, admin: false });
    alarm.nonAdminArm = await armFrom(p);
    p.el._emergCard && p.el._emergCard.close();
    p.done();
  } catch (e) { fail("alarm inside the emergency button", "lifecycle", e); }
}

// Room controls (views/room_controls.js), through the panel itself (the owner, 2026-11-25: "in the pulldown in atlas,
// add a volume for room option"): with the ⋯ line not ticked, the map's drawing and a room's sheet are the same DOM as
// the panel without the module at all; ticked (this screen's pref), the speaker is drawn beside the room whose player
// is on, the room's sheet has its Audio, a press is one service call, a household member presses too, and the report
// hears room_controls:on and :up.
const roomCtl = {};
if (Cls) {
  const LMOD = await import(pathToFileURL(join(WWW, "views", "lights_map.js")).href);
  const tree = (n) => (n ? { tag: n.localName, style: n.style ? n.style.cssText : "", text: n._text || "", a: n.attributes, kids: (n.children || []).map(tree) } : null);
  const C4 = { "media_player.c4_kitchen": ST("media_player.c4_kitchen", "on", { friendly_name: "Kitchen", volume_level: 0.4, is_volume_muted: false, supported_features: 4 | 8 | 256 | 1024 }) };
  const settings = { ...BASE, atlas_layout_v2: true, telemetry_enabled: true, pro_has_key: true, room_audio_matches: { kitchen: ["media_player.c4_kitchen"] }, room_audio_ha_speakers: false };
  const open = async ({ admin = true, ticked = false, without = false, tier = "pro", addons = null, more = {}, wall = false } = {}) => {
    if (ticked) localStorage.setItem("padspan_la3d_show_atlas", JSON.stringify({ room_controls: true })); else localStorage.removeItem("padspan_la3d_show_atlas");
    const hass = makeHass({ settings: { ...settings, tier, ...(addons ? { addons_licensed: addons } : {}), ...more }, admin, extraStates: C4 });
    hass.entities = Object.fromEntries([...ENTITY_REG.map(e => [e.entity_id, e]), ["media_player.c4_kitchen", { entity_id: "media_player.c4_kitchen", platform: "control4", area_id: "kitchen" }]]);
    hass.areas = Object.fromEntries(AREAS.map(a => [a.area_id, a]));
    const real = hass.callWS, sent = [], svc = [];
    hass.callWS = async (m) => { if (m.type === "padspan_ha/telemetry_event") sent.push(m.event); return real(m); };
    hass.callService = async (domain, service, data) => { svc.push(`${domain}.${service}:${data && data.entity_id}`); };
    // A wall (?kiosk=1): below Pro, a wall from the free basics on (editions.js wallTier).
    if (wall) globalThis.location = { search: "?kiosk=1" };
    const el = new Cls();
    if (without) el._roomCtl = () => null;        // as if room_controls.js had not loaded
    el.connectedCallback();
    el.hass = hass;
    await el._boot(); await flush(); await flush();
    el._render(); await flush();
    const svg = () => el.shadowRoot.querySelector("#content")._all().map(n => n.innerHTML).find(h => typeof h === "string" && h.includes("<svg")) || "";
    const lights = LMOD.gatherLights(hass.states, Object.fromEntries(ENTITY_REG.filter(e => e.area_id).map(e => [e.entity_id, AREAS.find(a => a.area_id === e.area_id).name])), {}, "pro");
    const sheet = () => {
      document.body.children.length = 0;
      el._useApi(Object.fromEntries(lights.map(l => [l.entity_id, l])), lights).openRoom("Kitchen");
      return document.body.children[document.body.children.length - 1];
    };
    return { el, hass, sent, svc, svg, sheet, done: () => { el.disconnectedCallback(); document.body.children.length = 0; if (wall) delete globalThis.location; } };
  };
  try {
    let p = await open({ without: true });
    const bareSvg = p.svg(), bareSheet = JSON.stringify(tree(p.sheet()));
    p.done();
    p = await open();
    roomCtl.offSvgSame = p.svg() === bareSvg && bareSvg.length > 0;
    roomCtl.offSheetSame = JSON.stringify(tree(p.sheet())) === bareSheet;
    roomCtl.offSent = p.sent.filter(e => e.startsWith("room_controls:"));
    p.done();
    p = await open({ ticked: true });
    const on = p.svg();
    roomCtl.onIcon = (on.match(/class="lroom-audio"/g) || []).length === 1 && /data-room="Kitchen"[^>]*>[\s\S]*?lroom-audio-hit/.test(on);
    const sh = p.sheet();
    const audio = sh._all().find(n => n.attributes && n.attributes["data-room-controls"] === "audio");
    roomCtl.onAudio = !!audio && audio._all().some(n => n._text === "Control4 · ") ;
    const up = audio && audio._all().find(n => n.localName === "button" && n.attributes["aria-label"] === "Kitchen volume up");
    if (up) { up.click(); await flush(); await flush(); }
    roomCtl.onSvc = p.svc.slice();
    roomCtl.onSent = p.sent.filter(e => e.startsWith("room_controls:"));
    p.done();
    p = await open({ ticked: true, admin: false });
    const a2 = p.sheet()._all().find(n => n.attributes && n.attributes["data-room-controls"] === "audio");
    const up2 = a2 && a2._all().find(n => n.localName === "button" && n.attributes["aria-label"] === "Kitchen volume up");
    if (up2) { up2.click(); await flush(); }
    const mb = a2 && a2._all().find(n => n.localName === "button" && n.attributes["data-room-match"] !== undefined);
    roomCtl.nonAdmin = { svc: p.svc.slice(), matchDisabled: !!(mb && mb.disabled) };
    p.done();
    // Audio is decided in one place (_audioAllowed, Pro today): below it, ticked or not, no speaker, no Audio in the
    // sheet, and the map is handed no Audio at all (so the ⋯ list offers neither the line nor its Set up ›).
    p = await open({ ticked: true, tier: "bright" });
    const bs = p.sheet();
    roomCtl.belowPro = { allowed: p.el._audioAllowed(), icon: p.svg().includes("lroom-audio"),
      audio: !!bs._all().find(n => n.attributes && n.attributes["data-room-controls"] === "audio") };
    p.done();
    p = await open({ ticked: true });
    roomCtl.pro = { allowed: p.el._audioAllowed() };
    p.done();
    // The Audio add-on without Pro (the owner, 2026-11-25): no ⋯ list (Pro's display layout), so Settings → Atlas →
    // Audio (atlas_audio_enabled) is its way in, house-wide: off, nothing; on, the speaker and the sheet's Audio.
    const seen = (q) => { const s = q.sheet(); return { allowed: q.el._audioAllowed(), icon: q.svg().includes("lroom-audio"),
      audio: !!s._all().find(n => n.attributes && n.attributes["data-room-controls"] === "audio") }; };
    p = await open({ ticked: true, tier: "free", addons: ["audio"] });
    roomCtl.addonOff = seen(p);
    p.done();
    p = await open({ tier: "free", addons: ["audio"], more: { atlas_audio_enabled: true } });
    roomCtl.addonOn = seen(p);
    p.done();
    // Another add-on alone: nothing of Audio, the switch on or not.
    p = await open({ tier: "free", addons: ["climate"], more: { atlas_audio_enabled: true } });
    roomCtl.otherAddon = seen(p);
    p.done();
    // Pro on the classic layout: the switch, as for the add-on; on Pro's display layout the ⋯ line decides, not it.
    p = await open({ more: { atlas_layout_v2: false, atlas_audio_enabled: true } });
    roomCtl.proClassic = seen(p);
    p.done();
    p = await open({ more: { atlas_audio_enabled: true } });
    roomCtl.proV2Unticked = seen(p);
    p.done();
    localStorage.removeItem("padspan_la3d_show_atlas");
    // Shades and Thermostats out of Audio (2026-11-26): a screen with the ⋯ list keeps what its room card had, its new
    // lines ticked once, never again (carryShowLine's mark), and a wall that went by the Settings switches keeps those.
    const LS = "padspan_la3d_show_atlas", MARKS = ["room_controls", "room_shades", "room_climate"].map(k => "padspan_la3d_carried_atlas_" + k);
    const fresh = () => MARKS.forEach(k => localStorage.removeItem(k));
    const shown = () => JSON.parse(localStorage.getItem(LS) || "{}");
    const carry = {};
    fresh();
    p = await open({ ticked: true, more: { atlas_audio_enabled: false } });
    p.el._roomParts();
    carry.proTicked = { show: shown(), parts: p.el._roomParts() };
    p.done();
    // Unticked since (the list drops a line set back to its default): a reload leaves it so.
    localStorage.setItem(LS, JSON.stringify({ room_controls: true, room_climate: true }));
    p = await open({ more: { atlas_audio_enabled: false } });
    localStorage.setItem(LS, JSON.stringify({ room_controls: true, room_climate: true }));
    p.el._carried = false; p.el._roomParts();
    carry.proUnticked = shown();
    p.done();
    // Audio not ticked: nothing carried, and ticking Audio later carries nothing either.
    fresh();
    p = await open({ more: { atlas_audio_enabled: false } });
    p.el._roomParts();
    localStorage.setItem(LS, JSON.stringify({ room_controls: true }));
    p.el._carried = false; p.el._roomParts();
    carry.proUntickedThenAudio = shown();
    p.done();
    // A wall below Pro with the Audio add-on that went by Settings → Atlas: Audio and Shades come along, ticked; no
    // Thermostats without Climate & air quality.
    fresh(); localStorage.removeItem(LS);
    p = await open({ tier: "free", addons: ["audio"], wall: true,
                     more: { atlas_audio_enabled: true, atlas_shades_enabled: true, atlas_thermostats_enabled: true, free_basics: true } });
    p.el._roomParts();
    carry.wall = { isWall: p.el.hasAttribute("data-wall"), show: shown(), parts: p.el._roomParts() };
    p.done();
    fresh(); localStorage.removeItem(LS);
    roomCtl.carry = carry;
    // The covers never offered as shades (_doorOpeners): marked, a wall's opener, a door's cover with no class.
    p = await open({ more: { door_opener_ids: ["cover.marked"] } });
    p.el.state.model = { ...(p.el.state.model || {}), rf_barriers_m: [
      { id: "w1", name: "Garage door", linked_entity_id: "cover.garage_main" },
      { id: "w2", name: "Front gate", linked_entity_id: "cover.drive", linked_opener_entity_id: "switch.gate_relay" },
      { id: "w3", name: "Kitchen window", linked_entity_id: "cover.kitchen_shutter" },
      { id: "w4", name: "Back door", linked_entity_id: "cover.back_blind" } ] };
    p.hass.states["cover.garage_main"] = ST("cover.garage_main", "closed", {});
    p.hass.states["cover.drive"] = ST("cover.drive", "closed", { device_class: "gate" });
    p.hass.states["cover.kitchen_shutter"] = ST("cover.kitchen_shutter", "open", {});
    p.hass.states["cover.back_blind"] = ST("cover.back_blind", "open", { device_class: "blind" });
    roomCtl.openers = [...p.el._doorOpeners()].sort();
    p.done();
  } catch (e) { fail("room controls", "lifecycle", e); }
}

// Energy (views/energy_map.js, the Energy add-on), through the panel itself (the owner, 2026-11-26): off by default
// means nothing at all (the drawing and a room's sheet are the panel's without the module, and energy_get is never
// asked); the house's switch alone draws nothing until a screen ticks its ⋯ line (or, on the classic layout, Settings →
// Atlas → Energy is on); ticked, the room's chip and its sheet's Energy, and the report hears energy:on and :sheet; and
// only where the add-on is allowed.
const energy = {};
if (Cls) {
  const LMOD = await import(pathToFileURL(join(WWW, "views", "lights_map.js")).href);
  const tree = (n) => (n ? { tag: n.localName, style: n.style ? n.style.cssText : "", text: n._text || "", a: n.attributes, kids: (n.children || []).map(tree) } : null);
  const ANSWER = { on: true, allowed: true, set_up: true, currency: "CAD", price: 0.1, quiet_w: 1,
    house: { w: 900, source: "home", stale: false, metered_w: 120, rest_w: 780 },
    rooms: [{ room: "Kitchen", on_map: true, metered: 1, w: 120, kwh: 1.5, cost: 0.15, devices: ["sensor.kettle_energy"], empty: null }],
    devices: [{ id: "sensor.kettle_energy", rate: "sensor.kettle_power", name: "Kettle", room: "Kitchen", device_id: null, w: 120, own_w: 120,
      kwh: 1.5, own_kwh: 1.5, cost: 0.15, stale: false, always_on: false }],
    empty: { w: 0, rooms: [], after_min: 15, source: "padspan" }, standby: null, issues: [] };
  const settings = { ...BASE, atlas_layout_v2: true, telemetry_enabled: true, pro_has_key: true };
  const open = async ({ ticked = false, without = false, tier = "pro", addons = null, more = {} } = {}) => {
    if (ticked) localStorage.setItem("padspan_la3d_show_atlas", JSON.stringify({ energy: true })); else localStorage.removeItem("padspan_la3d_show_atlas");
    const hass = makeHass({ settings: { ...settings, tier, ...(addons ? { addons_licensed: addons } : {}), ...more } });
    hass.entities = Object.fromEntries(ENTITY_REG.map(e => [e.entity_id, e]));
    hass.areas = Object.fromEntries(AREAS.map(a => [a.area_id, a]));
    const real = hass.callWS, sent = [], asked = [];
    hass.callWS = async (m) => {
      if (m.type === "padspan_ha/telemetry_event") sent.push(m.event);
      if (m.type === "padspan_ha/energy_get") { asked.push(m.type); return ANSWER; }
      return real(m);
    };
    const el = new Cls();
    if (without) { el._energy = () => null; el._energyHouse = () => false; }     // as if energy_map.js had not loaded
    el.connectedCallback();
    el.hass = hass;
    await el._boot(); await flush(); await flush();
    el._render(); await flush(); await flush(); await flush();
    const svg = () => el.shadowRoot.querySelector("#content")._all().map(n => n.innerHTML).find(h => typeof h === "string" && h.includes("<svg")) || "";
    const lights = LMOD.gatherLights(hass.states, Object.fromEntries(ENTITY_REG.filter(e => e.area_id).map(e => [e.entity_id, AREAS.find(a => a.area_id === e.area_id).name])), {}, "pro");
    const sheet = () => {
      document.body.children.length = 0;
      el._useApi(Object.fromEntries(lights.map(l => [l.entity_id, l])), lights).openRoom("Kitchen");
      return document.body.children[document.body.children.length - 1];
    };
    const hasPart = () => !!sheet()._all().find(n => n.attributes && n.attributes["data-room-controls"] === "energy");
    return { el, sent, asked, svg, sheet, hasPart, done: () => { el.disconnectedCallback(); document.body.children.length = 0; } };
  };
  const seen = async (q) => { const s = q.svg(); const part = q.hasPart(); await flush(); await flush();
    return { house: q.el._energyHouse(), on: q.el._energyOn(), chip: s.includes("lroom-energy"), chipWords: s.includes("\u26A1\uFE0E 120 W"), part,
             asked: q.asked.length, sent: q.sent.filter(e => e.startsWith("energy:")) }; };
  try {
    // Each case against the panel without the module drawn just before and just after it: the house's own clock (a
    // reading's freshness, the sun) can move between two opens on a busy machine, and that is not Energy.
    const bare = async () => { const q = await open({ without: true }); const out = { svg: q.svg(), sheet: JSON.stringify(tree(q.sheet())) }; q.done(); return out; };
    const same = async (opts) => {
      const a = await bare();
      const q = await open(opts);
      const svg = q.svg(), sheet = JSON.stringify(tree(q.sheet()));
      const got = await seen(q);
      q.done();
      const b = await bare();
      return { svgSame: svg.length > 0 && (svg === a.svg || svg === b.svg), sheetSame: sheet === a.sheet || sheet === b.sheet, ...got };
    };
    let p;
    // Off by default: the same drawing, the same sheet, never asked, nothing counted, ticked or not.
    energy.off = await same({});
    energy.offTicked = await same({ ticked: true });
    // On for the house, not ticked on this screen: the line is offered, nothing drawn, nothing asked.
    energy.houseOnly = await same({ more: { energy_enabled: true } });
    // Ticked: the chip by the Kitchen's name, its sheet's Energy, counted.
    p = await open({ ticked: true, more: { energy_enabled: true } });
    energy.ticked = await seen(p);
    p.done();
    // Not allowed (no Pro, no Energy key): nothing, ticked and on.
    p = await open({ ticked: true, tier: "free", addons: ["audio"], more: { energy_enabled: true, atlas_layout_v2: false, atlas_energy_enabled: true } });
    energy.notAllowed = await seen(p);
    p.done();
    // An Energy key on the classic layout (no ⋯ list): Settings → Atlas → Energy decides, house-wide.
    p = await open({ tier: "free", addons: ["energy"], more: { energy_enabled: true, atlas_layout_v2: false, atlas_energy_enabled: true } });
    energy.classicOn = await seen(p);
    p.done();
    p = await open({ ticked: true, tier: "free", addons: ["energy"], more: { energy_enabled: true, atlas_layout_v2: false, atlas_energy_enabled: false } });
    energy.classicOff = await seen(p);
    p.done();
    localStorage.removeItem("padspan_la3d_show_atlas");
  } catch (e) { fail("energy", "lifecycle", e); }
}

process.stdout.write(JSON.stringify({ scenarios, failures, blip, restart, emergency, emerg2, emerg3, savedFloor, alarm, roomCtl, energy }) + "\n", () => process.exit(failures.length ? 1 : 0));   // exit only once the result is written (a pipe holds 64 KiB)
