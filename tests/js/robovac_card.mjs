// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
//
// The robovac card (views/robovac_card.js), RUN against a fake Home Assistant
// connection: what a room location run needs and what is missing, Start /
// Pause / Dock and the run's Start, Stop and Undo each sending their command,
// the 401 said plainly, nothing reached for someone who is not an
// administrator, and its words in German.
//
// usage: robovac_card.mjs <www/padspan-ha dir>
// prints one JSON line: { cases: {name: result}, failures: [...] }

import { pathToFileURL } from "node:url";
import { join } from "node:path";
import { readFileSync } from "node:fs";
import { install } from "./dom_shim.mjs";

const WWW = process.argv[2];
if (!WWW) { console.error("usage: robovac_card.mjs <www/padspan-ha dir>"); process.exit(2); }
install(globalThis);
globalThis.CustomEvent = class { constructor(type, o) { this.type = type; Object.assign(this, o || {}); } };

const failures = [];
const cases = {};
const check = (name, ok, detail) => { if (cases[name] !== false) cases[name] = !!ok; if (!ok) failures.push({ name, detail: detail === undefined ? null : detail }); };

globalThis.fetch = async (url) => {
  const key = new URL(String(url)).pathname.split("/i18n/")[1];
  try { return { ok: true, json: async () => JSON.parse(readFileSync(join(WWW, "i18n", key), "utf-8")) }; }
  catch (_) { return { ok: false, json: async () => ({}) }; }
};

const I = await import(pathToFileURL(join(WWW, "views", "i18n.js")).href);
const RC = await import(pathToFileURL(join(WWW, "views", "robovac_card.js")).href);
const tick = () => new Promise(r => globalThis._realSetTimeout(r, 0));
const all = (n, tag, out = []) => { for (const c of n.children || []) { if (c.localName === tag) out.push(c); all(c, tag, out); } return out; };
const sheet = () => all(document.body, "div").find(d => d.className === "ps-robovac-card");
const btn = (label) => all(sheet(), "button").find(b => b.textContent === label);
const press = async (b) => { for (const f of (b._listeners.click || []).slice()) await f({ stopPropagation() {}, preventDefault() {}, target: b }); await tick(); };

const FINDINGS = {
  points: 24, runs: 2,
  findings: [
    { source: "aa:bb:cc:00:00:01", name: "Hall plug", kind: "moved", spots: 16, rms_before: 7.2, rms_after: 2.1,
      placed: { x_m: 2.5, y_m: 5, floor_id: "main", room: "Kitchen" }, found: { x_m: 6.5, y_m: 5, floor_id: "main", room: "Hall", distance_m: 4.0 } },
    { source: "upstairs-proxy", name: "Upstairs proxy", kind: "other_floor", spots: 16, strong: 9, strongest_dbm: -48.5, rms_before: null, rms_after: 1.9,
      placed: { x_m: 3, y_m: 3, floor_id: "upper", room: "" }, found: { x_m: 3, y_m: 3, floor_id: "main", room: "Kitchen", distance_m: null } },
  ],
  fine: [{ source: "k", name: "Kitchen plug", spots: 16, rms: 1.8 }],
  thin: [{ source: "g", name: "Garage", spots: 3, why: "few" }, { source: "o", name: "Office", spots: 8, why: "around" }],
};
const READY = {
  robot: { url: "http://192.168.1.50", auth: false, use: "full", applied: null },
  link: { map: true, valetudo: true, on: true, vacuum_entity: "" },
  tag: { address: "AA:BB:CC:DD:EE:FF", receivers: 3, age_s: 1 },
  state: { status: "docked", battery: 87, charging: true },
  run: null, runs: [], rooms: ["Kitchen", "Hall"],
};
function fakeHass(status, admin = true) {
  const sent = [];
  return {
    sent,
    user: { is_admin: admin },
    callWS: async (msg) => {
      sent.push(msg);
      if (msg.type === "padspan_ha/vacuum_robot_status") return typeof status === "function" ? status() : status;
      if (msg.type === "padspan_ha/vacuum_run_start") return { ok: true, run: { spots: 9 } };
      if (msg.type === "padspan_ha/vacuum_run_undo") return { ok: true, removed: 4 };
      if (msg.type === "padspan_ha/vacuum_findings") return FINDINGS;
      return { ok: true };
    },
  };
}
async function open(status, admin = true, lines = ["Where its own map says it is"], kiosk = false) {
  const hass = fakeHass(status, admin), toasts = [];
  RC.openRobovacCard({ hass, kiosk, toast: (m, bad) => toasts.push([m, !!bad]) }, { lines });
  await tick(); await tick();
  return { hass, toasts };
}
const types = (h) => h.sent.map(m => m.type.replace("padspan_ha/", ""));

// Nothing set up: each thing a run needs says it is missing, and Start a run waits.
{
  const { hass } = await open({ ...READY, robot: { url: "", auth: false }, link: { map: false, valetudo: false }, tag: { address: "", receivers: 0, age_s: null }, state: null, rooms: undefined });
  const text = sheet().textContent;
  check("setup", types(hass)[0] === "vacuum_robot_status" && hass.sent[0].rooms === true, hass.sent);
  check("setup", text.includes("✗ The robot's address") && text.includes("✗ Its map: import it from Valetudo") && text.includes("✗ The tag on the robot"), text);
  check("setup", text.includes("Not an AirTag or a Tile"), text);
  check("setup", btn("Start a run") && btn("Start a run").disabled === true, btn("Start a run") && btn("Start a run").disabled);
  check("setup", !btn("Dock"), "no robot read, no Dock");
  RC.closeRobovacCard();
  check("setup", !sheet(), "closed");
}

// Ready: the robot's state, Start / Pause / Dock, a run started for one room.
{
  const { hass, toasts } = await open(READY);
  const text = sheet().textContent;
  check("ready", text.includes("Docked · battery 87 % (charging)") && text.includes("✓ The tag on the robot is heard now by 3 receivers"), text);
  check("ready", !text.includes("Not an AirTag"), "the beacon note only when the tag is missing or not heard");
  await press(btn("Dock"));
  check("ready", hass.sent.some(m => m.type === "padspan_ha/vacuum_robot_control" && m.action === "home"), hass.sent);
  await press(btn("Pause"));
  await press(btn("Start"));
  check("ready", hass.sent.filter(m => m.type === "padspan_ha/vacuum_robot_control").map(m => m.action).join() === "home,pause,start", hass.sent);
  const sel = all(sheet(), "select")[0];
  check("ready", sel && sel.children.map(o => o.textContent).join("|") === "All rooms|Kitchen|Hall", sel && sel.children.map(o => o.textContent));
  sel.value = "Hall"; for (const f of sel._listeners.change || []) f({});
  check("ready", btn("Start a run").disabled === false, "ready to start");
  await press(btn("Start a run"));
  const start = hass.sent.find(m => m.type === "padspan_ha/vacuum_run_start");
  check("ready", start && start.room === "Hall" && toasts.some(([m]) => m === "Run started: 9 spots"), { start, toasts });
  RC.closeRobovacCard();
}

// A run going: its progress and Stop; the robot's own buttons wait.
{
  const { hass } = await open({ ...READY, run: { id: "rr_1", at_room: "Kitchen", spot: 3, spots: 9, added: 2, skipped: 0, state: "running" } });
  const text = sheet().textContent;
  check("running", text.includes("Running in Kitchen: spot 3 of 9, 2 added, 0 skipped"), text);
  check("running", btn("Dock").disabled && btn("Start").disabled && !btn("Start a run"), "buttons while running");
  await press(btn("Stop"));
  check("running", types(hass).includes("vacuum_run_stop"), hass.sent);
  RC.closeRobovacCard();
}

// The last run, and Undo this run (asked first), exactly its id.
{
  const last = { id: "rr_7", started: "2026-11-24T18:02:11+00:00", state: "finished", added: 4, skipped: 1, points_kept: 4, undone: false, small: ["Closet"] };
  const { hass, toasts } = await open({ ...READY, runs: [last] });
  const text = sheet().textContent;
  check("undo", text.includes("Last run, 2026-11-24 18:02 UTC: 4 points added, 1 spots skipped, finished.") && text.includes("Too small for a spot: Closet"), text);
  let asked = null;
  globalThis.confirm = (q) => { asked = q; return true; };
  await press(btn("Undo this run"));
  const undo = hass.sent.find(m => m.type === "padspan_ha/vacuum_run_undo");
  check("undo", undo && undo.run_id === "rr_7" && /Remove the 4 points this run added/.test(asked || "") && toasts.some(([m]) => m === "Removed 4 points"), { undo, asked, toasts });
  RC.closeRobovacCard();
  // Undone already: said, no button; an older run with points still has its own Undo.
  const older = { id: "rr_3", started: "2026-11-20T09:00:00+00:00", state: "finished", added: 6, skipped: 0, points_kept: 6, undone: false, room: "Hall" };
  const { hass: h2 } = await open({ ...READY, runs: [{ ...last, undone: true }, older] });
  check("undo", !btn("Undo this run") && sheet().textContent.includes("Undone: its points were taken out of calibration.")
    && sheet().textContent.includes("2026-11-20 09:00 UTC, Hall: 6 points"), sheet().textContent);
  await press(btn("Undo"));
  check("undo", h2.sent.some(m => m.type === "padspan_ha/vacuum_run_undo" && m.run_id === "rr_3"), h2.sent);
  RC.closeRobovacCard();
}

// The robot answers 401: said plainly, with the login boxes.
{
  await open({ ...READY, state: { error: "auth", text: "HTTP 401" } });
  const text = sheet().textContent;
  check("auth", text.includes("(HTTP 401)") && text.includes("Valetudo user name and password"), text);
  check("auth", all(sheet(), "input").some(i => i.type === "password") && btn("Start a run").disabled, "login boxes, no run");
  RC.closeRobovacCard();
}

// How the robot's points are used: three choices, none made for the owner; Start waits for one.
{
  const { hass } = await open({ ...READY, robot: { ...READY.robot, use: null } });
  let text = sheet().textContent;
  check("choice", text.includes("Count them like your own") && text.includes("Fill gaps, count them less")
    && text.includes("Find mistakes and Wi-Fi only") && text.includes("Choose one before the first run."), text);
  check("choice", btn("Start a run").disabled === true, "Start waits for a pick");
  await press(btn("Fill gaps, count them less"));
  check("choice", hass.sent.some(m => m.type === "padspan_ha/vacuum_robot_use_set" && m.use === "fill"), hass.sent);
  RC.closeRobovacCard();
  // Changed later: what it would do to earlier runs, applied or left; once applied, undoable.
  const { hass: h2 } = await open({ ...READY, robot: { ...READY.robot, use: "none" }, use_change: { add: 0, remove: 12, reweight: 0, old_runs: 1 } });
  text = sheet().textContent;
  check("choice", text.includes("Earlier runs, by this choice: 0 points would be added, 12 taken out, 0 counted differently.")
    && text.includes("1 run from before this choice existed stays as it is."), text);
  globalThis.confirm = () => true;
  await press(btn("Apply to earlier runs"));
  await press(btn("Leave them as they are"));
  check("choice", h2.sent.filter(m => m.type === "padspan_ha/vacuum_robot_use_apply").map(m => !!m.leave).join() === "false,true", h2.sent);
  RC.closeRobovacCard();
  const { hass: h3 } = await open({ ...READY, robot: { ...READY.robot, applied: { from: "full", to: "none", added: 0, removed: 12 } } });
  await press(btn("Undo this change"));
  check("choice", h3.sent.some(m => m.type === "padspan_ha/vacuum_robot_use_apply" && m.undo === true), h3.sent);
  RC.closeRobovacCard();
  // Each run's measured effect on the owner's own test spots, beside its Undo.
  await open({ ...READY, runs: [{ id: "rr_9", started: "2026-11-24T18:02:11+00:00", state: "finished", added: 5, skipped: 0, points_kept: 5, undone: false,
    accuracy: { before: { knn: { rooms_right_pc: 80, median_error_m: 1.4 } }, after: { knn: { rooms_right_pc: 86, median_error_m: 1.1 } } } }] });
  check("choice", sheet().textContent.includes("On your own test spots: rooms right 80 % before this run, 86 % after; typical error 1.4 m, then 1.1 m."), sheet().textContent);
  RC.closeRobovacCard();
}

// A wall (?kiosk=1): the robot's state only; nothing that leads away or changes the house.
{
  await open({ ...READY, link: { ...READY.link, vacuum_entity: "vacuum.robot" }, runs: [{ id: "rr_7", state: "finished", added: 2, points_kept: 2, undone: false }] }, true, [], true);
  const text = sheet().textContent;
  check("wall", text.includes("Docked · battery 87 %"), text);
  check("wall", !btn("Dock") && !btn("Start a run") && !btn("Find mistakes") && !btn("Undo this run")
    && !btn("Open in Home Assistant") && !text.includes("Room location") && all(sheet(), "input").length === 0, text);
  RC.closeRobovacCard();
  // Its findings card, opened on a wall, has no link away.
  const FI = await import(pathToFileURL(join(WWW, "views", "robovac_findings.js")).href);
  FI.openFindings({ hass: fakeHass(READY), kiosk: true });
  await tick(); await tick();
  const card = all(document.body, "div").find(d => d.className === "ps-robovac-findings");
  check("wall", card && card.textContent.includes("Hall plug") && all(card, "a").length === 0, card && card.textContent);
  FI.closeFindings();
}

// Not an administrator: where it is, nothing read from the robot.
{
  const { hass } = await open(READY, false);
  const text = sheet().textContent;
  check("not-admin", hass.sent.length === 0 && text.includes("Where its own map says it is") && text.includes("Only an administrator"), { sent: hass.sent, text });
  check("not-admin", !btn("Dock") && !btn("Start a run"), "no buttons");
  RC.closeRobovacCard();
}

// Find mistakes: its own card, only findings, each with the link to that receiver's placement.
{
  const last = { id: "rr_7", started: "2026-11-24T18:02:11+00:00", state: "finished", added: 4, skipped: 0, points_kept: 4, undone: false };
  const { hass } = await open({ ...READY, runs: [last] });
  await press(btn("Find mistakes"));
  await tick(); await tick();
  const card = all(document.body, "div").find(d => d.className === "ps-robovac-findings");
  const text = card ? card.textContent : "";
  check("findings", hass.sent.some(m => m.type === "padspan_ha/vacuum_findings") && card, hass.sent);
  check("findings", text.includes("Hall plug") && text.includes("Placed in Kitchen. The readings put it in Hall, 4 m away.")
    && text.includes("How sure: 16 spots; the readings fit 7.2 dB off where it is placed, 2.1 dB off there."), text);
  check("findings", text.includes("It may be on the wrong floor.") && text.includes("Not enough readings to judge: Garage (3)")
    && text.includes("Not enough readings around it to judge: Office"), text);
  const links = all(card, "a").map(a => a.href);
  check("findings", links[0] === "/padspan-ha?view=maps&tab=edit&receiver=aa%3Abb%3Acc%3A00%3A00%3A01" && links.length === 2, links);
  const FI = await import(pathToFileURL(join(WWW, "views", "robovac_findings.js")).href);
  FI.closeFindings();
  check("findings", !all(document.body, "div").some(d => d.className === "ps-robovac-findings"), "closed");
  RC.closeRobovacCard();
  // No run with points: no Find mistakes button.
  await open(READY);
  check("findings", !btn("Find mistakes"), "no points, no button");
  RC.closeRobovacCard();
}

// In German: the card's own words, from i18n/de/aboard2.json.
{
  const lang = await I.useLanguage({ language: "de" }, ["aboard2"]);
  await open({ ...READY, runs: [{ id: "rr_7", started: "2026-11-24T18:02:11+00:00", state: "stopped", added: 2, skipped: 0, points_kept: 2, undone: false }] });
  const text = sheet().textContent;
  check("german", lang === "de" && text.includes("Raumortung") && text.includes("In der Station · Akku 87 % (lädt)"), text);
  check("german", btn("Zur Station") && btn("Fahrt starten") && btn("Diese Fahrt rückgängig machen") && text.includes("angehalten"), text);
  check("german", !text.includes("Room location") && !text.includes("Start a run"), text);
  await press(btn("Fehler finden"));
  await tick(); await tick();
  const card = all(document.body, "div").find(d => d.className === "ps-robovac-findings");
  check("german", card && card.textContent.includes("Platziert in Kitchen. Die Messwerte verorten ihn in Hall, 4 m entfernt.")
    && card.textContent.includes("Seine Platzierung öffnen"), card && card.textContent);
  RC.closeRobovacCard();
}

console.log(JSON.stringify({ cases, failures }));
