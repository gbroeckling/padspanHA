// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
//
// RUN Settings → Atlas → Outdoor weather (views/settings.js): the warning under
// the rain sensor when that sensor has stopped reporting, on the real page.
//
// usage: atlas_weather_settings.mjs <views-dir>
// prints one JSON line: { cases: {name: result}, failures: [...] }

import { pathToFileURL } from "node:url";
import { join } from "node:path";
import { install } from "./dom_shim.mjs";

const VIEWS = process.argv[2];
if (!VIEWS) { console.error("usage: atlas_weather_settings.mjs <views-dir>"); process.exit(2); }
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
const S = await import(pathToFileURL(join(VIEWS, "settings.js")).href);

const RAIN = "binary_sensor.rain", SEEN = "sensor.rain_last_seen";
const ENT = { [RAIN]: { platform: "mqtt", device_id: "d1", name: "Rain" }, [SEEN]: { platform: "mqtt", device_id: "d1", name: "Last seen" } };
const states = (seen) => ({ [RAIN]: { state: "on", attributes: { friendly_name: "Rain- Rain" } },
  ...(seen ? { [SEEN]: { state: seen, attributes: { device_class: "timestamp", friendly_name: "Rain- Last seen" } } } : {}) });
function page(st, entities, rain = RAIN) {
  const ctx = {
    hass: { user: { is_admin: true }, states: st, entities },
    state: { view: "settings", complexity: "advanced", _settingsTab: "atlas", model: { floors: [], areas: [], room_geometry_m: {} },
      settings: { lights_panel_enabled: true, atlas_emergency_button: true, advanced_extra_tabs: [], tier: "pro", atlas_weather_enabled: true, atlas_weather_rain_entity: rain } },
    helpers: new Proxy({ el, esc: (s) => String(s), roomColor: () => "#52b788", helpBtn: noop }, { get: (t, k) => (k in t ? t[k] : noop) }),
    actions: new Proxy({ renderRooms() {}, renderNav() {} }, { get: (t, k) => (k in t ? t[k] : () => {}) }),
    toast() {},
  };
  const root = S.render(ctx);
  const box = root._all().find(n => n.getAttribute && n.getAttribute("data-focus-part") === "atlas_weather");
  if (!box) throw new Error("no Outdoor weather box on Settings → Atlas");
  return box;
}
const WARNS = /This sensor hasn't reported since .+\. Using the weather forecast instead\./;
const OLD = new Date(Date.now() - 3 * 86400000).toISOString(), FRESH = new Date(Date.now() - 60000).toISOString();
try {
  const when = new Date(OLD).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
  const stale = page(states(OLD), ENT).textContent;
  check("a sensor that has stopped reporting is said so, with its date", WARNS.test(stale) && stale.includes(`since ${when}.`), stale.slice(0, 900));
  // The warning sits right under the rain sensor's row, before the next picker.
  check("it sits under the rain sensor", stale.indexOf("Rain sensor") < stale.indexOf("hasn't reported") && stale.indexOf("hasn't reported") < stale.indexOf("Weather entity"), stale.slice(0, 900));
  check("one still reporting says nothing", !/hasn't reported/.test(page(states(FRESH), ENT).textContent));
  check("one with no last-seen sensor says nothing", !/hasn't reported/.test(page(states(null), ENT).textContent));
  check("no rain sensor chosen says nothing", !/hasn't reported/.test(page(states(OLD), ENT, "").textContent));
  check("a page with no registry says nothing", !/hasn't reported/.test(page(states(OLD), undefined).textContent));
} catch (e) {
  failures.push({ name: "harness", detail: String((e && e.stack) || e).slice(0, 900) });
}
process.stdout.write(JSON.stringify({ cases, failures }) + "\n", () => process.exit(failures.length ? 1 : 0));   // exit only once the result is written (a pipe holds 64 KiB)
