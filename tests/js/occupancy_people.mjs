// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
//
// RUN the occupancy card (overview.js) and the Occupancy tab (occupancy.js)
// against the estimator's real answer, and read what they print.
//
// The old tab printed "multiplier undefinedx → undefinedx", "Total BLE 0" and
// a history of "?" for months, because it read keys the backend never sent
// and nothing ever executed it with a real payload. So this executes both
// surfaces with the payload the Python estimator produces for the pinned
// house (tests/test_occupancy_people.py builds it, the pytest wrapper hands
// it over as JSON), then with a failing call, and requires the text to say
// what the number is and never say "undefined".
//
// usage: occupancy_people.mjs <views-dir> <estimate.json>
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { join } from "node:path";
import { install } from "./dom_shim.mjs";

const VIEWS_DIR = process.argv[2];
const ESTIMATE = process.argv[3];
if (!VIEWS_DIR || !ESTIMATE) { console.error("usage: occupancy_people.mjs <views-dir> <estimate.json>"); process.exit(2); }
install(globalThis);

const LIVE = JSON.parse(readFileSync(ESTIMATE, "utf8"));
const results = [];
let failed = 0;
function check(name, cond, detail = "") {
  results.push({ case: name, ok: !!cond });
  if (!cond) { failed++; console.error(`FAIL ${name}${detail ? ": " + detail : ""}`); }
}

function el(tag, attrs = {}, children = []) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (k === "class") n.className = v;
    else if (k === "id") n.id = v;
    else if (k === "style") n.setAttribute("style", v);
    else if (v !== undefined && v !== null) n.setAttribute(k, String(v));
  }
  if (!Array.isArray(children)) children = [children];
  for (const c of children) {
    if (c === null || c === undefined) continue;
    if (typeof c === "string" || typeof c === "number") n.appendChild(document.createTextNode(String(c)));
    else n.appendChild(c);
  }
  return n;
}

/** A ctx whose callWS answers from `answer` (a value, or a function of the message). */
function makeCtx(answer, settings = {}) {
  const modals = [], toasts = [];
  const ctx = {
    hass: { states: {} },
    state: { settings, live: {}, maps: { list: [] }, model: {} },
    helpers: { el, esc: s => String(s ?? ""), roomColor: () => "#52b788" },
    actions: {
      callWS: async (msg) => (typeof answer === "function" ? answer(msg) : answer),
      openModal: (title, body, subtitle) => modals.push({ title, body, subtitle }),
      settingsSet: async () => ({}),
    },
    toast: (m) => toasts.push(String(m)),
  };
  return { ctx, modals, toasts };
}

const settle = () => new Promise(r => globalThis._realSetTimeout(r, 10));
const text = (n) => n.textContent;
const clean = (s) => !/undefined|NaN|\[object/.test(s);

// ── the overview card, as the source ships it ────────────────────────────────
const overviewSrc = readFileSync(join(VIEWS_DIR, "overview.js"), "utf8");
const start = overviewSrc.indexOf("  // ── People in building (clickable)");
const end = overviewSrc.indexOf("  // Put occupancy + companion on the same row");
if (start < 0 || end < 0) { console.error("card markers not found in overview.js — moved? update this harness"); process.exit(2); }
const cardBlock = overviewSrc.slice(start, end);
const buildCard = new Function("el", "ctx", "section", "document", cardBlock + "\n  return occCard;");

async function card(answer) {
  const { ctx, modals, toasts } = makeCtx(answer);
  const section = el("div");
  const node = buildCard(el, ctx, section, document);
  await settle();
  return { node, section, modals, toasts, txt: text(node) };
}

{
  const c = await card(LIVE);
  check("card: mounted into the section", c.section.children.includes(c.node));
  check("card: says what the number is", c.txt.includes("People in building") && c.txt.includes("people"));
  check("card: shows the estimate", c.txt.includes(String(LIVE.total_estimate)));
  check("card: shows the range only when it is real", LIVE.total_low !== LIVE.total_high
    ? c.txt.includes(`${LIVE.total_low}–${LIVE.total_high}`)
    : !c.txt.includes("–"), c.txt);
  check("card: names the people and the room that places one", c.txt.includes("Living Room") && c.txt.includes("Nicole"));
  check("card: marks an assumed room as assumed", c.txt.includes("Nicole · Bedroom (assumed)"), c.txt);
  check("card: says who is not placed by a device", c.txt.includes("Nicole not placed by a device"), c.txt);
  check("card: says a phone was heard", c.txt.includes("1 phone heard"));
  check("card: names the sensed rooms", c.txt.includes("sensors: Living Room, Bedroom"));
  check("card: counts the tagged things as things", c.txt.includes("5 tagged things seen, not people"));
  check("card: prints no undefined", clean(c.txt), c.txt);

  c.node.click();
  await settle();
  check("modal: opened with the people title", c.modals.length === 1 && c.modals[0].title === "People in building", JSON.stringify(c.modals.map(m => m.title)));
  const body = c.modals[0] ? text(c.modals[0].body) : "";
  check("modal: has the sections", ["Counted", "Rooms with evidence", "How", "Seen, not people (5)"].every(s => body.includes(s)), body);
  check("modal: lists the truck once, as a thing", (body.match(/\bBronco\b/g) || []).length === 1, body);
  check("modal: explains the unknown count", body.includes("0 unknown people beyond the known"), body);
  check("modal: names the held-on sensor", body.includes("binary_sensor.alarm_di1"), body);
  check("modal: prints no undefined", clean(body), body);
}

{
  const one = { ...LIVE, total_estimate: 1, total_low: 1, total_high: 1, known: 1, unknown: 0,
    people: [LIVE.people[0]], evidence: { ...LIVE.evidence, persons_unlocated: [], phone_clusters: 0, things_seen: [] } };
  const c = await card(one);
  check("card: one person is 'person' with no pill", c.txt.includes("1person") || c.txt.includes("1 person") || /1\s*person/.test(c.txt));
  check("card: no degenerate range", !c.txt.includes("1–1"), c.txt);
}

{
  const c = await card(() => { throw new Error("socket closed"); });
  check("card: failure is stated", c.txt.includes("Unavailable") && c.txt.includes("socket closed") && c.txt.includes("—"), c.txt);
  check("card: failure prints no undefined", clean(c.txt), c.txt);
}

// ── the Occupancy tab ────────────────────────────────────────────────────────
const tab = await import(pathToFileURL(join(VIEWS_DIR, "occupancy.js")).href);
{
  const history = [{ ts: "2026-08-27T23:10:00+00:00", actual: 2, estimated: 2, known: 2, unknown: 0 }];
  const { ctx, toasts } = makeCtx((msg) => msg.type === "padspan_ha/occupancy_train"
    ? { ok: true, observation: { ...history[0], actual: 3, estimated: 2 }, total_observations: 2 }
    : LIVE, { occupancy_training: history });
  const root = tab.render(ctx);
  await settle();
  const txt = text(root);
  check("tab: headline", txt.includes("People in building") && txt.includes(`${LIVE.total_estimate}people`) || txt.includes(String(LIVE.total_estimate)));
  check("tab: the KPIs are the new ones", ["Known home", "Unknown", "Phones heard", "Sensed rooms", "Things, not people"].every(s => txt.includes(s)), txt);
  check("tab: the old KPIs are gone", !/Identified|Unidentified|Clusters|Total BLE|Multiplier/.test(txt), txt);
  check("tab: sections", ["Counted", "Rooms with evidence", "How the number was reached", "Seen, not people (5)", "Record the real count"].every(s => txt.includes(s)), txt);
  check("tab: history row prints the observation", txt.includes("History (1 observations)") && txt.includes("2 / 0"), txt);
  check("tab: prints no undefined, NaN or ?", clean(txt) && !txt.includes("?"), txt);

  // Save a real count: the toast must quote what the estimate said.
  const all = [];
  (function walk(n) { all.push(n); for (const c of n.children || []) walk(c); })(root);
  const saveBtn = all.find(n => n.tagName === "BUTTON" && text(n) === "Save");
  const numInput = all.find(n => n.tagName === "INPUT" && n.type === "number" && n.placeholder === "Actual headcount");
  check("tab: has the save row", !!saveBtn && !!numInput);
  if (saveBtn && numInput) {
    numInput.value = "3";
    saveBtn.click();
    await settle();
    check("tab: save toast quotes the estimate", toasts.some(t => t.includes("actual 3") && t.includes("estimate said 2")), JSON.stringify(toasts));
  }
}

for (const r of results) console.log(JSON.stringify(r));
console.log(JSON.stringify({ summary: true, cases: results.length, failed }));
process.exit(failed ? 1 : 0);
