// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
//
// Power teams and Advanced smart lighting (the owner, 2026-11-25), RUN: Settings → Atlas → Power teams
// (views/power_teams.js) and a team's part of the control card (views/power_team_card.js), with power_teams_get
// saying `lighting` true (PadSpan Pro, the add-on, a Bright key) or false. The pytest wrapper is
// tests/test_addon_lighting.py.
//
// usage: power_team_lighting.mjs <views-dir>
// prints one JSON line: { out: {...}, fail: [...] }

import { pathToFileURL } from "node:url";
import { join } from "node:path";
import { install } from "./dom_shim.mjs";

const VIEWS = process.argv[2];
install(globalThis);
const PT = await import(pathToFileURL(join(VIEWS, "power_teams.js")).href);
const CARD = await import(pathToFileURL(join(VIEWS, "power_team_card.js")).href);
const settle = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };

function el(tag, attrs = {}, children = []) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (k === "class") n.className = v;
    else if (k === "value") n.value = v;
    else if (k.startsWith("on") && typeof v === "function") n.addEventListener(k.slice(2), v);
    else if (v !== undefined && v !== null) n.setAttribute(k, String(v));
  }
  for (const c of (Array.isArray(children) ? children : [children])) {
    if (c === null || c === undefined) continue;
    n.appendChild(typeof c === "string" || typeof c === "number" ? document.createTextNode(String(c)) : c);
  }
  return n;
}
const find = (box, attr) => box._all().filter(n => n.getAttribute && n.getAttribute(attr) !== null);
const said = (box, v) => find(box, "data-team-lighting").filter(n => n.getAttribute("data-team-lighting") === v).length;
const URL_ = "https://padspan.traks.ca/#addons";
const out = {}, fail = [];
const TEAM = { id: "t1", name: "Bedroom", power: "light.dimmer", bulbs: ["light.hue_1"], off: "bulbs", adaptive: true, curve: {},
               wake: { on: true, time: "06:30", days: [0, 1, 2, 3, 4] } };
const STATES = {
  "light.dimmer": { state: "on", attributes: { friendly_name: "Dimmer", supported_color_modes: ["brightness"] } },
  "light.hue_1": { state: "on", attributes: { friendly_name: "Hue 1", supported_color_modes: ["color_temp"] } },
  "light.bedroom": { state: "on", attributes: { friendly_name: "Bedroom", padspan_power_team: true, team_id: "t1",
                                              power: "light.dimmer", bulbs: ["light.hue_1"], phase: "ready",
                                              effect_list: ["Adaptive", "Sleep"], effect: "Adaptive", follows_the_day: true } },
};
const view = (lighting) => ({ teams: [TEAM], live: { t1: { phase: "ready", missing: [] } }, defaults: {}, limits: {}, lighting,
                              wake_default: {}, wake_minutes: [1, 90], bedtime_default: {}, night_default: {} });

for (const lighting of [false, true]) {
  const k = lighting ? "with" : "without";
  try {
    // Settings → Atlas → Power teams
    const sent = [];
    const ctx = { hass: { user: { is_admin: true }, states: STATES },
      actions: { wsCall: async (type, data) => { sent.push(type); return view(lighting); } } };
    // The usage report's add-on funnel (settings.js wires these to addonOfferSeen and addon_buy:power_teams:lighting).
    const tel = [];
    const box = PT.powerTeamsSection(ctx, el, { lightingPrice: "$8.65 CAD", addonsUrl: URL_,
      onOffer: () => tel.push("offer"), onBuy: () => tel.push("buy") });
    find(box, "data-open")[0].click();
    await settle();
    const text = box.textContent || "";
    const offered = tel.filter(w => w === "offer").length;
    find(box, "data-team-lighting").filter(n => n.getAttribute("data-team-lighting") === "offer").forEach(n => n.click());
    out[`settings_${k}`] = { save: find(box, "data-save").length, add: find(box, "data-add").length,
      remove: find(box, "data-remove").length, inputs: box._all().filter(n => n.localName === "input").length,
      locked: said(box, "locked"), offer: said(box, "offer"), named: text.includes("Bedroom"),
      price: text.includes("Advanced smart lighting add-on ($8.65 CAD)"), keeps: text.includes("The teams already made keep switching"),
      offered: offered > 0, bought: tel.filter(w => w === "buy").length };
    // The card's part
    const hass = { states: STATES, user: { is_admin: true }, connection: null,
      callWS: async (m) => (m.type === "padspan_ha/power_teams_get" ? view(lighting) : {}), callService: async () => {} };
    const ctel = [];
    const sec = CARD.teamSection("light.bedroom", { el, hass, lightingPrice: "$8.65 CAD", addonsUrl: URL_,
      onOffer: () => ctel.push("offer"), onBuy: () => ctel.push("buy") });
    await settle();
    const cOffered = ctel.filter(w => w === "offer").length;
    find(sec.node, "data-team-lighting").filter(n => n.getAttribute("data-team-lighting") === "offer").forEach(n => n.click());
    const folds = find(sec.node, "data-team-fold").map(n => n.getAttribute("data-team-fold"));
    const ctext = sec.node.textContent || "";
    out[`card_${k}`] = { folds, locked: said(sec.node, "locked"), offer: said(sec.node, "offer"),
      price: ctext.includes("Advanced smart lighting add-on ($8.65 CAD)"), keeps: ctext.includes("keeps switching as one light"),
      effects: find(sec.node, "data-team-effect").length, sleepNow: find(sec.node, "data-team-sleep-now").length,
      manual: ["Cut power", "Hue 1"].filter(w => ctext.includes(w)), offered: cOffered > 0, bought: ctel.filter(w => w === "buy").length };
    sec.stop();
  } catch (e) { fail.push(`${k}: ${e && e.stack || e}`); }
}
process.stdout.write(JSON.stringify({ out, fail }) + "\n", () => process.exit(fail.length ? 1 : 0));
