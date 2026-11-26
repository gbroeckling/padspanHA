// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
//
// The Install Base view's Add-ons section (views/installbase.js), drawn under
// the DOM shim from a stats.php answer: its headline, the licence and
// add-on-key cards, the funnel per add-on and place, wanted-not-bought, use,
// the moved-from-free cohort, the market and Control4 (stats.php `addons`),
// and a plain name for every add-on event the report can send (argv[3]: the
// names, telemetry.ADDON_EVENTS).
//
// Run: node tests/js/installbase_addons.mjs <repo root> '<json list of event names>'
// Prints one JSON line: { cases: {name: bool}, failures: [...] }.
import { pathToFileURL } from "node:url";

const ROOT = process.argv[2];
const EVENTS = JSON.parse(process.argv[3] || "[]");
const { install, flush } = await import(pathToFileURL(ROOT + "/tests/js/dom_shim.mjs").href);
install(globalThis);
const _ss = new Map();
globalThis.sessionStorage = { getItem: k => (_ss.has(k) ? _ss.get(k) : null), setItem: (k, v) => _ss.set(k, String(v)), removeItem: k => _ss.delete(k) };
sessionStorage.setItem("padspan_installbase_unlocked", "1");
const IB = await import(pathToFileURL(ROOT + "/custom_components/padspan_ha/www/padspan-ha/views/installbase.js").href);

const cases = {}, failures = [];
const check = (name, ok, info) => { cases[name] = !!ok; if (!ok) failures.push({ name, info }); };

function el(tag, attrs = {}, children = []) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (k === "class") n.className = v; else if (k === "style") n.setAttribute("style", v);
    else if (v !== undefined && v !== null) n.setAttribute(k, String(v));
  }
  if (!Array.isArray(children)) children = [children];
  for (const c of children) { if (c == null) continue; n.appendChild(typeof c === "string" || typeof c === "number" ? document.createTextNode(String(c)) : c); }
  return n;
}

const ADDONS = {
  installs: 6,
  licence: { free: 2, addon: 2, pro_year: 1, trial: 1 },
  held: { alarm: { "91_365": 1, lt30: 1 }, audio: { gt365: 1 } },
  kept: 1,
  was: { "addon>pro_year": 1 },
  changes: { "addon>pro_year": 1, "free>addon": 2 },
  moved: { emergency_test: { installs: 2, holds: 1, pro: 0, into: "alarm" }, power_teams: { installs: 3, holds: 0, pro: 1, into: "lighting" },
           lidar: { installs: 1, holds: 0, pro: 0, into: "maps" } },
  on_it: { alarm: 2, audio: 2, lighting: 2, maps: 6, vacuum: 6, c4local: 1 },
  used: { alarm: 1, lighting: 1, maps: 2 },
  refused: { insights: { installs: 3, without: 2 } },
  market: { alarm: { installs: 2, sum: 3 }, wled: { installs: 1, sum: 4 } },
  reach: { alarm: { installs: 3, on_it: 1 }, audio: { installs: 1, on_it: 1 }, lighting: { installs: 1, on_it: 1 },
           c4local: { installs: 1, on_it: 0 } },
  audio: { control4: { installs: 1, sum: 22 } },
  c4: { "2:not_loaded": 1, "3:loaded": 1 }, c4_local: 1, c4_os2_local: 1,
  wifi: { utopia: 1, unifi: 2 }, history: { gt30d: 2, lt7d: 1 }, plans: { picture: 2 }, roomplan: 1, valetudo: 0,
  not_sold: ["maps", "vacuum", "c4local"],       // before December 1 (stats.php addon_sold)
  not_on_sale: ["c4local"],                      // no moment yet (licence.NOT_ON_SALE): Pro's, never everyone's
};
const USAGE = {
  "addon_offer:licence_card:alarm": { count: 10, installs: 4 }, "addon_buy:licence_card:alarm": { count: 2, installs: 2 },
  "addon_offer:busy_times:insights": { count: 5, installs: 3 },
  "addon_key:entered": { count: 3, installs: 2 }, "addon_key:needs_update": { count: 1, installs: 1 },
  "addon_gained:alarm": { count: 2, installs: 2 }, "addon_gained:audio": { count: 1, installs: 1 },
  "addon_gained_in:sale_w1": { count: 3, installs: 3 },
  "addon_sale_card:shown": { count: 8, installs: 5 }, "addon_sale_card:clicked": { count: 2, installs: 2 },
};
const stats = (usage) => ({
  generated: "2026-11-25T12:00:00", window_days: 30, installs: { reporting_window: 6 }, pings: {},
  dist: { version: { "0.38.300": 6 } }, usage, addons: ADDONS,
});
let STATS = stats(USAGE);
const ctx = (mode) => ({
  state: { dataMode: mode, settings: { tier: "pro" } },
  helpers: { el, esc: s => String(s ?? ""), helpBtn: () => el("button", {}, "?") },
  actions: { wsCall: async () => ({ stats: STATS, cached: false }), renderRooms: () => {} },
  toast: () => {},
});
async function draw(mode) {
  try {
    const root = IB.render(ctx(mode));
    await flush(12);
    // Every "Show all" opened, so each row is drawn.
    for (let i = 0; i < 60; i++) {
      const more = root.querySelectorAll(".ib-more").find(b => b.textContent.startsWith("Show all"));
      if (!more) break;
      more.click();
    }
    return root;
  } catch (e) {
    check(`render ${mode}: draws without throwing`, false, String(e && e.stack || e));
    return null;
  }
}

const root = await draw("live");
const sec = root ? root.querySelectorAll(".ib-sec").find(s => (s.querySelector(".ib-h") || {}).textContent === "Add-ons") : null;
check("section: Add-ons is drawn", !!sec);
const head = sec ? sec.querySelector(".ib-headline").textContent : "";
check("section: folds to its headline", head === "2 installs on an add-on, 1 on Pro · 3 add-ons gained in 30 days", head);
const kv = sec ? sec.querySelectorAll(".ib-kv-row").map(r => r.children.map(c => c.textContent)) : [];
const kvRow = (label, from = 0) => kv.slice(from).find(r => r[0] === label);
const cells = sec ? sec.querySelectorAll("tr").map(r => r.children.map(c => c.textContent)) : [];
const cellRow = (label) => cells.find(r => r[0] === label);
const labels = sec ? sec.querySelectorAll(".ib-label").map(n => n.textContent) : [];

check("licence: by its plain word", labels.includes("An add-on key") && labels.includes("Pro, a year") && labels.includes("Pro trial"), labels);
const alarmKeys = cellRow("Alarm & security");
check("keys: each add-on held, by time left", !!alarmKeys && alarmKeys[1] === "2" && alarmKeys.length === 9, alarmKeys);
check("keys: Pro over a kept key is said", (sec ? sec.textContent : "").includes("1 on Pro over a kept add-on key (a trial or a Pro invite's year)"));
const up = cellRow("An add-on key → Pro, a year");
check("changes: add-on key to Pro, latest and across reports", !!up && up[1] === "1" && up[2] === "1", up);
const fa = cellRow("Free → An add-on key");
check("changes: free to an add-on key across reports only", !!fa && fa[1] === "0" && fa[2] === "2", fa);
const card = cellRow("Alarm & security · the licence card");
check("funnel: offers, buy clicks and clicks per offer", !!card && card[1] === "10 · 4" && card[2] === "2 · 2" && card[3] === "20%", card);
const busy = cellRow("Presence insights · Busy Times");
check("funnel: a refusal place offers, never links", !!busy && busy[1] === "5 · 3" && busy[2] === "–" && busy[3] === "–", busy);
check("keys entered: by how they went", labels.includes("Licence card: a key entered") && labels.includes("Licence card: PadSpan too old for the key"), labels);
const shown = kvRow("Sale card shown"), clicked = kvRow("  ↳ its link opened");
check("sale: card shown and clicked, as a share", !!shown && shown[1] === "8" && !!clicked && clicked[1] === "2" && clicked[2] === "25%", [shown, clicked]);
const w1 = kvRow("Add-ons gained in the sale's week 1");
check("sale: gained by sale week", !!w1 && w1[1] === "3", w1);
const want = kvRow("Presence insights: offered where refused");
const still = want ? kv[kv.indexOf(want) + 1] : null;
check("wanted: offered where refused, and still without it", !!want && want[1] === "3" && !!still && still[0] === "  ↳ still without it" && still[1] === "2" && still[2] === "67%", [want, still]);
const used = kvRow("Alarm & security", kv.findIndex(r => r[0] === "Alarm & security" && r[1] === "1"));
check("use: of the installs on it, used it", !!used && used[1] === "1" && used[2] === "50%", used);
const lit = kvRow("Advanced smart lighting");
check("use: Advanced smart lighting is a sold add-on, like the rest", !!lit && lit[1] === "1" && lit[2] === "50%"
      && !kvRow("Advanced smart lighting (not sold yet: everyone)"), lit);
check("use: an add-on before its moment is not sold yet (the feed's not_sold)", !!kvRow("Advanced map creation (not sold yet: everyone)")
      && !!kvRow("Robot vacuum (not sold yet: everyone)"));
check("use: OS 2 Local for Control4 is not sold yet and never everyone's", !!kvRow("OS 2 Local for Control4 (not sold yet: Pro includes it)")
      && !kvRow("OS 2 Local for Control4 (not sold yet: everyone)"));
const moved = kvRow("The emergency lights test → Alarm & security");
const movedHold = moved ? kv[kv.indexOf(moved) + 1] : null;
check("moved: the cohort and who holds the add-on now", !!moved && moved[1] === "2" && !!movedHold && movedHold[0] === "  ↳ holding Alarm & security" && movedHold[1] === "1", [moved, movedHold]);
const teams = kvRow("Power teams → Advanced smart lighting");
check("moved: power teams into lighting, who holds it and who is on Pro", !!teams && kv[kv.indexOf(teams) + 1][0] === "  ↳ holding Advanced smart lighting"
      && kv[kv.indexOf(teams) + 2][0] === "  ↳ on Pro" && kv[kv.indexOf(teams) + 2][1] === "1", teams && kv.slice(kv.indexOf(teams), kv.indexOf(teams) + 3));
const lidar = kvRow("A LiDAR room scan → Advanced map creation");
check("moved: a LiDAR scan into maps, not sold yet", !!lidar && kv[kv.indexOf(lidar) + 1][0] === "  ↳ not sold yet", lidar);
check("market: what the homes have", !!cellRow("Control4 audio players") && cellRow("Control4 audio players")[2] === "22" && !!cellRow("UniFi Utopia")
      && !!cellRow("a plan from a picture") && !!cellRow("over 30 days of history"), cells.slice(-12));
const c4 = kvRow("  ↳ the OS 2 Local market: OS 2, its Control4 not running or on the local override");
check("control4: the OS 2 Local market", !!c4 && c4[1] === "1" && c4[2] === "50%", c4);
check("control4: by OS and state", !!kvRow("  ↳ OS 2, not loaded") && !!kvRow("  ↳ OS 3, running"));
const raw = (sec ? sec.textContent : "").match(/\b[a-z0-9]+_[a-z0-9_]+\b/g);
check("words: no report word left raw in the section", !raw, raw);

// Every add-on event the report can send has a plain name wherever an event is listed.
const every = {};
for (const e of EVENTS) every[e] = { count: 1, installs: 1 };
STATS = stats(every);
const root2 = await draw("live-every-event");
const rows = root2 ? root2.querySelectorAll(".ib-row") : [];
const named = {};
for (const r of rows) {
  const m = /report name: (addon_[^\n]+)$/.exec(r.getAttribute("title") || "");
  if (m) named[m[1]] = (r.querySelector(".ib-label") || {}).textContent || "";
}
const missing = EVENTS.filter(e => !(e in named));
check("events: every add-on event is drawn somewhere", EVENTS.length > 0 && !missing.length, missing.slice(0, 8));
const plain = Object.entries(named).filter(([, t]) => /^Addon\b|undefined|\b[a-z0-9]+_[a-z0-9_]+\b/.test(t));
check("events: each has a plain name", !plain.length, plain.slice(0, 8));

console.log(JSON.stringify({ cases, failures }));
