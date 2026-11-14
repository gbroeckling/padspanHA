// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
//
// RUN Settings → Atlas → Power teams (views/power_teams.js): a team made, saved whole, shown again.
//
// usage: power_teams.mjs <views-dir>
// prints one JSON line: { cases: {name: result}, failures: [...] }

import { pathToFileURL } from "node:url";
import { join } from "node:path";
import { install } from "./dom_shim.mjs";

const VIEWS = process.argv[2];
if (!VIEWS) { console.error("usage: power_teams.mjs <views-dir>"); process.exit(2); }
install(globalThis);

function el(tag, attrs = {}, children = []) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (k === "class") n.className = v;
    else if (k === "value") n.value = v;
    else if (v !== undefined && v !== null) n.setAttribute(k, String(v));
  }
  for (const c of (Array.isArray(children) ? children : [children])) {
    if (c === null || c === undefined) continue;
    n.appendChild(typeof c === "string" || typeof c === "number" ? document.createTextNode(String(c)) : c);
  }
  return n;
}
const failures = [], cases = {};
const check = (name, ok, detail) => { cases[name] = !!ok; if (!ok) failures.push({ name, detail: detail === undefined ? null : detail }); };
const settle = async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); };
const PT = await import(pathToFileURL(join(VIEWS, "power_teams.js")).href);

const STATES = {
  "light.dimmer": { state: "off", attributes: { friendly_name: "Bedroom dimmer", supported_color_modes: ["brightness"] } },
  "switch.wall": { state: "off", attributes: { friendly_name: "Wall switch" } },
  "light.hue_1": { state: "on", attributes: { friendly_name: "Hue 1", supported_color_modes: ["color_temp", "xy"] } },
  "light.hue_2": { state: "on", attributes: { friendly_name: "Hue 2", supported_color_modes: ["xy"] } },
  "light.bedroom_lights": { state: "on", attributes: { friendly_name: "Bedroom lights", supported_color_modes: ["color_temp", "hs"], padspan_power_team: true } },
  "sensor.temp": { state: "21", attributes: {} },
};
const DEFAULTS = { min_brightness: 25, max_brightness: 100, min_kelvin: 2200, max_kelvin: 5000, sleep_brightness: 5, sleep_kelvin: 2000 };
const LIMITS = Object.fromEntries(Object.keys(DEFAULTS).map(k => [k, k.endsWith("kelvin") ? [1500, 9000] : [1, 100]]));
function page(admin, stored = []) {
  const sent = [];
  let teams = stored;
  const ctx = { hass: { user: { is_admin: admin }, states: STATES },
    actions: { wsCall: async (type, data) => {
      sent.push([type, JSON.parse(JSON.stringify(data))]);
      if (type === "padspan_ha/power_teams_set") {
        if (data.teams.some(t => !t.name)) throw new Error("Each team needs a name");
        teams = data.teams.map((t, i) => ({ id: t.id || `id${i}`, ...t }));
      }
      return { teams, live: teams.length && teams[0].id ? { [teams[0].id]: { phase: "failed", missing: ["light.hue_2"] } } : {}, defaults: DEFAULTS, limits: LIMITS };
    } } };
  const box = PT.powerTeamsSection(ctx, el), asked = sent.length;
  box._all().find(n => n.getAttribute && n.getAttribute("data-open") !== null).click();
  return { box, sent, asked };
}
const find = (box, attr, val) => box._all().filter(n => n.getAttribute && (val === undefined ? n.getAttribute(attr) !== null : n.getAttribute(attr) === val));
const fire = (n, type) => n.dispatchEvent({ type, target: n });

try {
  const c = PT.choices(STATES);
  check("choices: a light or a switch powers a team, a colour light is a bulb, a team's own light is neither",
    JSON.stringify(c.power.map(p => p[0])) === JSON.stringify(["light.dimmer", "light.hue_1", "light.hue_2", "switch.wall"])
    && JSON.stringify(c.bulbs.map(p => p[0])) === JSON.stringify(["light.hue_1", "light.hue_2"]), c);

  const p = page(true);
  await settle();
  const empty = p.box.textContent.includes("No team yet.") && p.asked === 0;   // nothing is read until it is opened
  find(p.box, "data-add")[0].click();
  // Saved with no name: the server's words are shown, nothing is lost.
  find(p.box, "data-save")[0].click(); await settle();
  const refused = p.box.textContent.includes("Could not save: Each team needs a name") && find(p.box, "data-team").length === 1;
  const t = find(p.box, "data-team")[0];
  const name = t._all().find(n => n.tagName === "INPUT" && n.getAttribute("type") === "text");
  name.value = "Bedroom lights"; fire(name, "input");
  const sel = t._all().find(n => n.tagName === "SELECT");
  sel.value = "light.dimmer"; fire(sel, "change");
  for (const cb of find(t, "data-bulb")) { cb.checked = true; fire(cb, "change"); }
  const warm = find(t, "data-curve", "min_kelvin")[0];
  warm.value = "99999"; fire(warm, "change");
  find(p.box, "data-save")[0].click(); await settle();
  const set = p.sent.filter(s => s[0] === "padspan_ha/power_teams_set").pop()[1].teams;
  check("make: a team is added, filled in and saved whole; a refusal is said in the server's words",
    empty && refused && set.length === 1 && set[0].name === "Bedroom lights" && set[0].power === "light.dimmer"
    && JSON.stringify(set[0].bulbs) === JSON.stringify(["light.hue_1", "light.hue_2"]) && set[0].adaptive === true
    && set[0].curve.min_kelvin === 9000 && set[0].curve.max_kelvin === 5000 && warm.value === "9000"
    && p.box.textContent.includes("Saved. Each team is now a light in Home Assistant"),
    { empty, refused, set, text: p.box.textContent.slice(-300) });
  check("shown: what the team is doing now, and the bulb that did not answer",
    p.box.textContent.includes("Now: On, but not every bulb answered. No answer from: light.hue_2."), p.box.textContent.slice(-400));

  // No power source chosen: saved as none (lights that always have power).
  const none = page(true);
  await settle();
  find(none.box, "data-add")[0].click();
  const nt = find(none.box, "data-team")[0];
  const nn = nt._all().find(n => n.tagName === "INPUT" && n.getAttribute("type") === "text");
  nn.value = "Strings"; fire(nn, "input");
  for (const cb of find(nt, "data-bulb")) { cb.checked = true; fire(cb, "change"); }
  find(none.box, "data-save")[0].click(); await settle();
  const nset = none.sent.filter(s => s[0] === "padspan_ha/power_teams_set").pop()[1].teams;
  check("no power source: lights that always have power are a team of their own",
    nset.length === 1 && nset[0].power === "" && nset[0].bulbs.length === 2
    && nt._all().some(n => n.tagName === "OPTION" && n.textContent === "None: these lights always have power"), nset);

  find(p.box, "data-remove")[0].click();
  find(p.box, "data-save")[0].click(); await settle();
  check("remove: gone from the list once saved",
    p.sent.filter(s => s[0] === "padspan_ha/power_teams_set").pop()[1].teams.length === 0 && p.box.textContent.includes("No team yet."), p.sent.slice(-1));

  const v = page(false, [{ id: "a1", name: "Bedroom lights", power: "light.dimmer", bulbs: ["light.hue_1"], adaptive: false, curve: DEFAULTS }]);
  await settle();
  check("not an administrator: the teams are shown, with no Add and no Save",
    find(v.box, "data-team").length === 1 && !find(v.box, "data-add").length && !find(v.box, "data-save").length
    && v.box.textContent.includes("An administrator makes and changes teams.") && v.sent.every(s => s[0] === "padspan_ha/power_teams_get"), v.sent);
} catch (e) {
  failures.push({ name: "harness", detail: String((e && e.stack) || e) });
}
process.stdout.write(JSON.stringify({ cases, failures }) + "\n", () => process.exit(failures.length ? 1 : 0));
