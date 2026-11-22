// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
//
// RUN the same Zigbee device twice (views/zigbee_twins.js) in the panel: the
// helper itself, and Settings → Atlas → Outdoor weather's rain sensor list on
// the real page (the duplicate left out with a quiet note; a duplicate
// already chosen said so, with the button that uses the Zigbee2MQTT one).
//
// usage: zigbee_twins.mjs <views-dir>
// prints one JSON line: { cases: {name: result}, failures: [...] }

import { pathToFileURL } from "node:url";
import { join } from "node:path";
import { install } from "./dom_shim.mjs";

const VIEWS = process.argv[2];
if (!VIEWS) { console.error("usage: zigbee_twins.mjs <views-dir>"); process.exit(2); }
install(globalThis);

function el(tag, attrs = {}, children = []) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (k === "class") n.className = v;
    else if (k === "style") n.setAttribute("style", v);
    else if (k.startsWith("on") && typeof v === "function") n.addEventListener(k.slice(2), v);
    else if (v !== undefined && v !== null) n.setAttribute(k, String(v));
  }
  for (const c of (Array.isArray(children) ? children : [children])) {
    if (c === null || c === undefined) continue;
    n.appendChild(typeof c === "string" || typeof c === "number" ? document.createTextNode(String(c)) : c);
  }
  return n;
}
const noop = () => el("span");
const failures = [];
const cases = {};
const check = (name, ok, detail) => { cases[name] = !!ok; if (!ok) failures.push({ name, detail: detail === undefined ? null : detail }); };
const q = (u) => pathToFileURL(join(VIEWS, u)).href;
const TW = await import(q("zigbee_twins.js"));
const S = await import(q("settings.js"));

// A rain sensor in both Zigbee2MQTT and ZHA (made-up names), and one in Zigbee2MQTT only.
const Z2M = "binary_sensor.garden_rain", ZHA = "binary_sensor.garden_rain_2", SHED = "binary_sensor.shed_rain";
const TWINS = {
  devices: { dev_zha: { name: "Garden rain (ZHA)", via: "ZHA", twin: "dev_z2m", twin_name: "Garden rain", twin_via: "Zigbee2MQTT" } },
  entities: { [ZHA]: { twin: Z2M, device: "dev_zha" }, "sensor.garden_battery_2": { twin: "", device: "dev_zha" } },
};
const STATES = {
  [Z2M]: { state: "off", attributes: { friendly_name: "Garden Rain" } },
  [ZHA]: { state: "off", attributes: { friendly_name: "Garden Rain (old)" } },
  [SHED]: { state: "off", attributes: { friendly_name: "Shed Rain" } },
};
const ENT = { [Z2M]: { platform: "mqtt", device_id: "dev_z2m", name: "Rain" }, [ZHA]: { platform: "zha", device_id: "dev_zha", name: "Rain" },
              [SHED]: { platform: "mqtt", device_id: "dev_shed", name: "Rain" } };

try {
  // ── the helper ──────────────────────────────────────────────────────────
  const settings = { zigbee_twins: TWINS };
  const d = TW.dropDuplicates([Z2M, ZHA, SHED], settings);
  check("the duplicate copy is left out, the rest kept in order", JSON.stringify(d.ids) === JSON.stringify([Z2M, SHED]) && d.hidden === 1 && d.via === "Zigbee2MQTT", d);
  check("the one already chosen stays", TW.dropDuplicates([Z2M, ZHA], settings, [ZHA]).ids.includes(ZHA));
  check("no map, nothing left out", TW.dropDuplicates([Z2M, ZHA], {}).hidden === 0 && TW.dropDuplicates([ZHA], null).ids[0] === ZHA);
  check("the note, one", TW.hiddenNote(1, "Zigbee2MQTT") === "1 duplicate hidden (same unit on Zigbee2MQTT)", TW.hiddenNote(1, "Zigbee2MQTT"));
  check("the note, several", TW.hiddenNote(3, "Zigbee2MQTT") === "3 duplicates hidden (same units on Zigbee2MQTT)", TW.hiddenNote(3, "Zigbee2MQTT"));
  check("no note with none hidden", TW.hiddenNote(0) === "" && TW.hiddenNoteEl(0) === null);
  const w = TW.duplicateWarning(ZHA, settings, STATES);
  check("the warning names both and the one used", w && w.text === "Garden Rain (old) is the ZHA copy of a device that is also in Zigbee2MQTT, as Garden Rain. PadSpan uses the Zigbee2MQTT one."
        && w.twin === Z2M && w.button === "Use the Zigbee2MQTT one", w);
  const amb = TW.duplicateWarning("sensor.garden_battery_2", settings, STATES);
  check("no single twin: the device named, no button", amb && amb.twin === "" && amb.button === ""
        && amb.text.endsWith("is the ZHA copy of Garden rain, which is also in Zigbee2MQTT. Pick the Zigbee2MQTT one in the list."), amb);
  const gone = TW.duplicateWarning(ZHA, settings, { [ZHA]: STATES[ZHA] });
  check("a twin not in Home Assistant's states gets no button", gone && gone.twin === "" && gone.button === "", gone);
  check("nobody's duplicate: no warning", TW.duplicateWarning(SHED, settings, STATES) === null && TW.duplicateWarningEl(SHED, settings, STATES, () => {}) === null);
  let used = null;
  const wel = TW.duplicateWarningEl(ZHA, settings, STATES, (eid) => { used = eid; });
  const btn = wel && wel._all().find(n => n.tagName === "BUTTON");
  btn && btn.click();
  check("the button uses the twin only when pressed", !!btn && used === Z2M, { used });

  // ── Settings → Atlas → Outdoor weather, the real page ──────────────────
  const page = (rain, sent) => {
    const ctx = {
      hass: { user: { is_admin: true }, states: STATES, entities: ENT },
      state: { view: "settings", complexity: "advanced", _settingsTab: "atlas", model: { floors: [], areas: [], room_geometry_m: {} },
        settings: { lights_panel_enabled: true, atlas_emergency_button: true, advanced_extra_tabs: [], tier: "pro", atlas_weather_enabled: true,
                    atlas_weather_rain_entity: rain, zigbee_twins: TWINS } },
      helpers: new Proxy({ el, esc: (s) => String(s), roomColor: () => "#52b788", helpBtn: noop, errorText: (e) => String(e) }, { get: (t, k) => (k in t ? t[k] : noop) }),
      actions: new Proxy({ renderRooms() {}, renderNav() {}, wsCall: async (type, data) => { sent.push({ type, ...data });
        return type === "padspan_ha/zigbee_twin_use" ? { ok: true, settings: { atlas_weather_rain_entity: data.twin } } : {}; } },
                         { get: (t, k) => (k in t ? t[k] : () => {}) }),
      toast() {},
    };
    const root = S.render(ctx);
    const box = root._all().find(n => n.getAttribute && n.getAttribute("data-focus-part") === "atlas_weather");
    if (!box) throw new Error("no Outdoor weather box on Settings → Atlas");
    return box;
  };
  const rainSelect = (box) => box._all().find(n => n.tagName === "SELECT");
  const values = (sel) => sel._all().filter(n => n.tagName === "OPTION").map(o => o.getAttribute("value"));
  const sent = [];
  const plain = page("", sent);
  const vs = values(rainSelect(plain));
  check("the rain list leaves the ZHA copy out", vs.includes(Z2M) && vs.includes(SHED) && !vs.includes(ZHA), vs);
  const note = plain._all().find(n => n.getAttribute && n.getAttribute("data-zigbee-hidden"));
  check("and says so, quietly, under it", !!note && note.textContent === "1 duplicate hidden (same unit on Zigbee2MQTT)", note && note.textContent);
  check("no warning with nothing chosen", !plain._all().some(n => n.getAttribute && n.getAttribute("data-zigbee-twin")));
  const chosen = page(ZHA, sent);
  const sel = rainSelect(chosen);
  check("the ZHA copy already chosen stays chosen", sel.value === ZHA && values(sel).includes(ZHA), sel.value);
  const warn = chosen._all().find(n => n.getAttribute && n.getAttribute("data-zigbee-twin") === ZHA);
  check("and is said so, naming the Zigbee2MQTT one", !!warn && warn.textContent.includes("is the ZHA copy of a device that is also in Zigbee2MQTT, as Garden Rain (binary_sensor.garden_rain)."),
        warn && warn.textContent);
  const text = chosen.textContent;
  check("the warning sits under the rain sensor", text.indexOf("Rain sensor") < text.indexOf("is the ZHA copy") && text.indexOf("is the ZHA copy") < text.indexOf("Weather entity"), text.slice(0, 900));
  check("nothing is switched by itself", sent.length === 0, sent);
  const use = warn && warn._all().find(n => n.tagName === "BUTTON");
  check("its button says what it does", !!use && use.textContent === "Use the Zigbee2MQTT one", use && use.textContent);
  use && use.click();
  await new Promise(r => setImmediate(r));
  check("pressed, it uses the Zigbee2MQTT one everywhere PadSpan keeps it", sent.length === 1 && sent[0].type === "padspan_ha/zigbee_twin_use"
        && sent[0].entity_id === ZHA && sent[0].twin === Z2M, sent);
  check("and the list shows it chosen, the warning gone", sel.value === Z2M && !chosen._all().some(n => n.getAttribute && n.getAttribute("data-zigbee-twin")), sel.value);

  // ── the Atlas: the map, the light index (views/lights_map.js) ───────────
  const LM = await import(q("lights_map.js"));
  const NOW = Date.now();
  const ST = (state, attributes) => ({ state, attributes, last_changed: new Date(NOW - 60e3).toISOString(), last_updated: new Date(NOW - 60e3).toISOString() });
  const LIGHTS = { "light.hall": ST("on", { friendly_name: "Hall light" }), "light.hall_2": ST("on", { friendly_name: "Hall light (ZHA)" }),
                   "binary_sensor.den_motion": ST("off", { device_class: "motion", friendly_name: "Den motion" }),
                   "binary_sensor.den_motion_2": ST("off", { device_class: "motion", friendly_name: "Den motion (ZHA)" }),
                   "light.porch": ST("off", { friendly_name: "Porch" }) };
  const LSET = { zigbee_twins: { devices: { h_hall: { name: "Hall light", via: "ZHA", twin: "z_hall", twin_name: "Hall light", twin_via: "Zigbee2MQTT" },
                                            h_den: { name: "Den motion", via: "ZHA", twin: "z_den", twin_name: "Den motion", twin_via: "Zigbee2MQTT" } },
                                 entities: { "light.hall_2": { twin: "light.hall", device: "h_hall" },
                                             "binary_sensor.den_motion_2": { twin: "binary_sensor.den_motion", device: "h_den" } } } };
  const AREAS = { "light.hall": "Hall", "light.hall_2": "Hall", "binary_sensor.den_motion": "Den", "binary_sensor.den_motion_2": "Den", "light.porch": "Porch" };
  const all = LM.gatherLights(LIGHTS, AREAS, undefined, "pro", undefined, undefined, undefined, undefined, NOW);
  const placed = { "light.hall_2": { x_m: 1, y_m: 2, floor_id: "main" } };
  const out = LM.withoutZigbeeDuplicates(all, LSET, (eid) => !!placed[eid]);
  const ids = out.lights.map(l => l.entity_id).sort();
  check("the Atlas leaves an unplaced duplicate copy out", !ids.includes("binary_sensor.den_motion_2") && ids.includes("binary_sensor.den_motion"), ids);
  check("and keeps one that is placed", ids.includes("light.hall_2") && ids.includes("light.hall"), ids);
  check("the index is told how many it left out", out.twins && out.twins.hidden === 1 && out.twins.note === "1 duplicate hidden (same unit on Zigbee2MQTT)", out.twins);
  check("no map in the settings, every device as before", LM.withoutZigbeeDuplicates(all, {}, () => false).lights.length === all.length
        && LM.withoutZigbeeDuplicates(all, {}, () => false).twins === null);
  const moved = [];
  const host = { el, hiddenEids: new Set(), lightsLoading: false, model: { areas: [], floors: [], light_positions_m: placed }, tableClassFilter: "all",
    tableSort: null, tableHealthFilter: false, floodLatches: {}, doorLinkedIds: new Set(), doorInvertByEid: {}, typeOverrides: {},
    onRowClick: () => {}, onRowLongPress: () => {}, onRowMore: () => {}, onToggleHidden: () => {}, afterAssign: () => {}, callWS: async () => ({}), toast: () => {},
    onTableClassFilter: () => {}, onTableSort: () => {}, onTableHealthFilter: () => {}, onFloodReset: () => {},
    zigbeeTwins: out.twins, onUseTwin: (l, twin) => moved.push([l.entity_id, twin]) };
  const card = LM.buildLightsTable(host, out.lights);
  const head = card._all().find(n => n.getAttribute && n.getAttribute("data-zigbee-hidden"));
  check("the light index says so, quietly, in its header", !!head && head.textContent === "1 duplicate hidden (same unit on Zigbee2MQTT)", head && head.textContent);
  const line = card._all().find(n => n.getAttribute && n.getAttribute("data-zigbee-twin") === "light.hall_2");
  check("a placed duplicate's row names the Zigbee2MQTT one", !!line && line.textContent.startsWith("Hall light (ZHA) is the ZHA copy of a device that is also in Zigbee2MQTT, as Hall light."), line && line.textContent);
  check("no line on any other row", card._all().filter(n => n.getAttribute && n.getAttribute("data-zigbee-twin")).length === 1);
  check("nothing moved by itself", moved.length === 0);
  const ub = line && line._all().find(n => n.tagName === "BUTTON");
  ub && ub.click();
  check("the row's button moves it to the Zigbee2MQTT one when pressed", ub && ub.textContent === "Use the Zigbee2MQTT one" && JSON.stringify(moved) === JSON.stringify([["light.hall_2", "light.hall"]]), moved);
  const view = LM.buildLightsTable({ ...host, onUseTwin: null }, out.lights);
  const vline = view._all().find(n => n.getAttribute && n.getAttribute("data-zigbee-twin"));
  check("the Atlas page's index says it, with no button", !!vline && !vline._all().some(n => n.tagName === "BUTTON"));

  // ── Settings → Atlas → Power teams (views/power_teams.js) ───────────────
  const PT = await import(q("power_teams.js"));
  const PST = { "light.lamp": ST("on", { friendly_name: "Lamp", supported_color_modes: ["xy"] }), "light.lamp_2": ST("on", { friendly_name: "Lamp (ZHA)", supported_color_modes: ["xy"] }),
                "switch.wall": ST("on", { friendly_name: "Wall" }) };
  const PSET = { zigbee_twins: { devices: { h_lamp: { name: "Lamp", via: "ZHA", twin: "z_lamp", twin_name: "Lamp", twin_via: "Zigbee2MQTT" } },
                                 entities: { "light.lamp_2": { twin: "light.lamp", device: "h_lamp" } } } };
  const teamsSent = [], teamMoves = [];
  let bulbsNow = ["light.lamp_2"];
  const pctx = { hass: { user: { is_admin: true }, states: PST }, state: { settings: PSET },
                 actions: { wsCall: async (type, data) => {
                   if (type === "padspan_ha/power_teams_get") return { teams: [{ id: "t1", name: "Den", power: "switch.wall", bulbs: bulbsNow, off: "power" }] };
                   if (type === "padspan_ha/zigbee_twin_use") { teamMoves.push(data); bulbsNow = [data.twin]; return { ok: true, settings: {} }; }
                   teamsSent.push(data); return { teams: data.teams }; } } };
  const pbox = PT.powerTeamsSection(pctx, el);
  pbox._all().find(n => n.getAttribute && n.getAttribute("data-open")).click();
  await new Promise(r => setImmediate(r));
  const bulbs = pbox._all().filter(n => n.getAttribute && n.getAttribute("data-bulb")).map(n => n.getAttribute("data-bulb"));
  check("a team's duplicate bulb is still listed, ticked", bulbs.includes("light.lamp_2") && bulbs.includes("light.lamp"), bulbs);
  const pw = pbox._all().find(n => n.getAttribute && n.getAttribute("data-zigbee-twin") === "light.lamp_2");
  check("and said so", !!pw && pw.textContent.includes("is the ZHA copy of a device that is also in Zigbee2MQTT, as Lamp."), pw && pw.textContent);
  pw && pw._all().find(n => n.tagName === "BUTTON").click();
  await new Promise(r => setImmediate(r));
  const ticked = pbox._all().filter(n => n.getAttribute && n.getAttribute("data-bulb") && n.checked).map(n => n.getAttribute("data-bulb"));
  check("its button moves the team to the Zigbee2MQTT one, read back", JSON.stringify(teamMoves) === JSON.stringify([{ entity_id: "light.lamp_2", twin: "light.lamp" }])
        && JSON.stringify(ticked) === JSON.stringify(["light.lamp"]) && teamsSent.length === 0, { teamMoves, ticked, teamsSent });

  // ── Live Aboard's "More devices of the area" (views/live_aboard_rooms.js) ──
  const LR = await import(q("live_aboard_rooms.js"));
  const RH = { areas: { a1: { name: "Hall" } }, devices: { z_hall: { area_id: "a1" }, h_hall: { area_id: "a1" } },
               entities: { "light.hall": { device_id: "z_hall" }, "light.hall_2": { device_id: "h_hall" }, "sensor.hall_battery_2": { device_id: "h_hall" } },
               states: { "light.hall": ST("on", { friendly_name: "Hall light" }), "light.hall_2": ST("on", { friendly_name: "Hall light (ZHA)" }),
                         "sensor.hall_battery_2": ST("90", { friendly_name: "Hall battery (ZHA)", unit_of_measurement: "%" }) } };
  const RSET = { zigbee_twins: { devices: LSET.zigbee_twins.devices, entities: { ...LSET.zigbee_twins.entities, "sensor.hall_battery_2": { twin: "", device: "h_hall" } } } };
  const extras = LR.areaExtras(RH, "Hall", ["light.hall"], RSET).map(x => x.eid);
  check("Live Aboard's room list leaves the duplicate copy out", extras.length === 0, extras);
  check("and without the map lists it as before", LR.areaExtras(RH, "Hall", ["light.hall"]).length === 2);
} catch (e) {
  failures.push({ name: "harness", detail: String((e && e.stack) || e).slice(0, 900) });
}
process.stdout.write(JSON.stringify({ cases, failures }) + "\n", () => process.exit(failures.length ? 1 : 0));   // exit only once the result is written (a pipe holds 64 KiB)
