// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
//
// Mapping's alarm tick (panel.js _mappingAlarmTick), the method by itself: what it
// reads, how often, and that nothing but the latches changes and nothing renders.
//
// usage: mapping_alarm_tick.mjs <www/padspan-ha dir>
// prints one JSON line: { cases, failures }
import { readFileSync } from "node:fs";
import { join } from "node:path";

const src = readFileSync(join(process.argv[2], "panel.js"), "utf8");
const from = src.indexOf("  async _mappingAlarmTick(){");
const to = src.indexOf("  /**", from);
if (from < 0 || to < 0) { console.error("no _mappingAlarmTick in panel.js"); process.exit(2); }
const body = src.slice(from, to).trim();
const Tick = new Function(`return class { ${body} }`)();

const listeners = [];
globalThis.window = { dispatchEvent: (e) => { for (const fn of listeners) fn(e); return true; } };
globalThis.CustomEvent = class { constructor(type, init){ this.type = type; this.detail = init && init.detail; } };

let cases = 0;
const failures = [];
const check = (name, ok, detail) => { cases++; if (!ok) failures.push({ name, detail: detail === undefined ? null : detail }); };

function panel(reply){
  const p = new Tick();
  p.renders = 0; p.banners = 0; p.reads = 0;
  p._hass = { states: { "binary_sensor.leak": { state: "on" } } };
  p.state = { settings: { flood_latches: { a: 1 }, some_other: "kept" } };
  p._settingsPollTs = Date.now();
  p._callWS = async (m) => { p.reads++; p.asked = m.type; return reply(); };
  p._updateEmergencyBanner = () => { p.banners++; };
  p._scheduleRender = () => { p.renders++; };
  return p;
}
const server = () => ({ settings: { flood_latches: { b: 2 }, some_other: "changed", data_mode: "sample" } });

// Nothing of the Plans map on the page.
listeners.length = 0;
{
  const p = panel(server);
  await p._mappingAlarmTick();
  check("closed: inside 30 s nothing is read", p.reads === 0 && p.banners === 0);
  p._settingsPollTs = Date.now() - 31000;
  await p._mappingAlarmTick();
  check("closed: past 30 s the settings are read and the banner told", p.reads === 1 && p.asked === "padspan_ha/settings_get" && p.banners === 1);
  check("closed: only the latches are kept", p.state.settings.flood_latches.b === 2 && p.state.settings.some_other === "kept" && !("data_mode" in p.state.settings), p.state.settings);
  check("closed: it renders nothing", p.renders === 0);
  check("closed: nothing left in flight", p._pollInFlight === false && p._pollStartedAt === null);
}
// The Plans map open: a slot answers.
{
  const heard = [];
  listeners.push((e) => { heard.push({ states: e.detail.states, latches: e.detail.latches }); e.detail.plansOpen = true; });
  const p = panel(server);
  await p._mappingAlarmTick();
  check("open: read on every tick", p.reads === 1);
  await p._mappingAlarmTick();
  check("open: and again", p.reads === 2 && p.banners === 2);
  check("open: the view has the states at once and the new latches after", heard[0].states === p._hass.states && heard[0].latches.a === 1 && heard[1].latches.b === 2, heard);
  check("open: it renders nothing", p.renders === 0);
}
// A failed read changes nothing and doesn't stop the next.
{
  const p = panel(() => { throw new Error("no connection"); });
  const had = p.state.settings.flood_latches;
  await p._mappingAlarmTick();
  check("failed: the latches stay and nothing stays in flight", p.state.settings.flood_latches === had && p._pollInFlight === false && p.banners === 0);
}
// A reply with no latches isn't "no alarms".
{
  const p = panel(() => ({ settings: {} }));
  const had = p.state.settings.flood_latches;
  await p._mappingAlarmTick();
  check("empty: a reply with no latches leaves them", p.state.settings.flood_latches === had && p.banners === 0);
}
process.stdout.write(JSON.stringify({ cases, failures }) + "\n", () => process.exit(failures.length ? 1 : 0));   // exit only once the result is written (a pipe holds 64 KiB)
