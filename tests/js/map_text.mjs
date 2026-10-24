// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
//
// The map as text (views/map_text.js), run for real: the lines built from a
// snapshot (what the Overview map shows, quiet mode or not), the Atlas's
// people and tags, names kept as text, the hidden box and its 10 s pace.
//
// usage: map_text.mjs <www/padspan-ha dir>
// prints one JSON line: { cases: {name: result}, failures: [...] }

import { pathToFileURL } from "node:url";
import { join } from "node:path";
import { install } from "./dom_shim.mjs";

const WWW = process.argv[2];
if (!WWW) { console.error("usage: map_text.mjs <www/padspan-ha dir>"); process.exit(2); }
install(globalThis);

const MT = await import(pathToFileURL(join(WWW, "views", "map_text.js")).href);

const failures = [];
const cases = {};
const check = (name, ok, detail) => { cases[name] = !!ok; if (!ok) failures.push({ name, detail: detail === undefined ? null : detail }); };

// ── the Overview's objects ───────────────────────────────────────────────────
const objects = [
  { kind: "private_ble", key: "irk:a", address: "AA:00", user_label: "Garry's phone", room: "Kitchen", age_s: 3 },
  { kind: "ble", address: "BB:00", name: "Nicole's watch", identified: true, room: "Kitchen", age_s: 5 },
  { kind: "ble", address: "CC:00", name: "Random TV", room: "Kitchen", age_s: 2 },                 // unlabelled: not on the map
  { kind: "ble", address: "DD:00", user_label: "Old tag", room: "Office", age_s: 9999 },           // away
  { kind: "ble", address: "EE:00", user_label: "Ghost", room: "Office", _stale: true },
  { kind: "ble", address: "FF:00", name: "Followed thing", room: "Den", age_s: 1 },                // followed only
  { kind: "entity", entity_id: "device_tracker.garry", address: "AA:00", user_label: "Garry tracker", room: "Kitchen" }, // the radio stands for it
  { kind: "ble", address: "11:00", user_label: "Scanner itself", room: "Den" },
  { kind: "ble", address: "22:00", user_label: "<img src=x onerror=alert(1)>", room: "Hall", age_s: 1 },
];
const opts = { followed: (o) => o.address === "FF:00", away: (o) => (o.age_s || 0) > 300, isScanner: (o) => o.address === "11:00" };
const rooms = ["Den", "Hall", "Kitchen", "Office"];
const lines = MT.roomLines(MT.overviewEntries(objects, opts), rooms);
check("overview_lines", JSON.stringify(lines) === JSON.stringify([
  ["Den", "Den: Followed thing."],
  ["Hall", "Hall: <img src=x onerror=alert(1)>."],
  ["Kitchen", "Kitchen: Garry's phone, Nicole's watch."],
  ["Office", "Office: empty."],
]), lines);
// Quiet mode shows labelled, identified or followed, the set the map always draws:
// the unlabelled TV is never named, with quiet mode on or off.
check("never_unlabelled", !JSON.stringify(lines).includes("Random TV"));
check("no_followed_no_name", !JSON.stringify(MT.roomLines(MT.overviewEntries(objects, { ...opts, followed: () => false }), rooms)).includes("Followed thing"));
check("room_from_entity", JSON.stringify(MT.overviewEntries([
  { kind: "ble", address: "AB:CD", user_label: "Keys", room: "unknown" },
  { kind: "entity", entity_id: "sensor.keys", address: "ab:cd", room: "Garage" }])) === JSON.stringify([{ room: "Garage", name: "Keys" }]));
check("no_rooms_no_lines", MT.roomLines([], []).length === 0);
check("unknown_rooms_left_out", MT.roomLines([{ room: "not_home", name: "x" }, { room: "", name: "y" }], []).length === 0);

// ── the Atlas's people and tags ─────────────────────────────────────────────
const wants = [
  { kind: "person", key: "person.g", person: { name: "Garry", at: { room: "Kitchen" } } },
  { kind: "beacon", key: "beacon:k", name: "Keys", room: "Hall" },
  { kind: "scanner", key: "scanner:1" },
];
check("atlas_lines", JSON.stringify(MT.roomLines(MT.wantedEntries(wants, false), ["Hall", "Kitchen"]))
  === JSON.stringify([["Hall", "Hall: Keys."], ["Kitchen", "Kitchen: Garry."]]));
check("atlas_hidden_names", MT.roomLines(MT.wantedEntries(wants, true), [])[0][1] === "Kitchen: Garry.");
check("atlas_hidden_tag", JSON.stringify(MT.wantedEntries(wants, true)).includes("a tag") && !JSON.stringify(MT.wantedEntries(wants, true)).includes("Keys"));
check("map_rooms", JSON.stringify(MT.mapRooms({ room_geometry_m: { Office: {}, Den: {} } })) === '["Den","Office"]'
  && MT.mapRooms(null).length === 0);

// ── the hidden box ──────────────────────────────────────────────────────────
let now = 1_000_000;
const realNow = Date.now;
Date.now = () => now;
const timers = [];
const realSet = globalThis.setTimeout, realClear = globalThis.clearTimeout;
globalThis.setTimeout = (f, ms) => { timers.push({ f, at: now + ms }); return timers.length; };
globalThis.clearTimeout = (id) => { if (timers[id - 1]) timers[id - 1].f = null; };
const run = () => { for (const t of timers) if (t.f && t.at <= now) { const f = t.f; t.f = null; f(); } };

const box = MT.createMapText("psMapText", "Who is in which room");
const el = box.el;
check("attrs", el.id === "psMapText" && el.getAttribute("aria-live") === "off" && el.getAttribute("aria-atomic") === "false"
  && el.getAttribute("role") === "region" && el.getAttribute("aria-label") === "Who is in which room");
check("sr_only_style", el.style.cssText === MT.SR_ONLY, el.style.cssText);
for (const bit of ["position:fixed", "width:1px", "height:1px", "overflow:hidden", "clip-path:inset(50%)", "white-space:nowrap", "pointer-events:none"])
  check("sr_only_has_" + bit, MT.SR_ONLY.includes(bit));
box.update(lines);
check("first_at_once", box.text() === "Den: Followed thing. Hall: <img src=x onerror=alert(1)>. Kitchen: Garry's phone, Nicole's watch. Office: empty.", box.text());
check("names_are_text", el.children.every(p => p.children.length === 0), el.children.map(p => p.children.length));
check("first_fill_is_quiet", el.getAttribute("aria-live") === "off");
run();
check("live_after_first_fill", el.getAttribute("aria-live") === "polite");
const kitchen = el.children[2];
now += 3000;
box.update([["Kitchen", "Kitchen: empty."], ["Office", "Office: Garry's phone."]]);
check("not_before_10s", box.text().startsWith("Den: Followed thing."));
now += 6000; run();
check("still_waiting_9s", box.text().startsWith("Den: Followed thing."));
now += 1000; run();
check("after_10s", box.text() === "Kitchen: empty. Office: Garry's phone.", box.text());
check("same_room_node_kept", el.children[0] === kitchen);
box.clear();
check("clear_empties", el.children.length === 0);
check("clear_is_quiet_again", el.getAttribute("aria-live") === "off");
box.update(lines);
check("refill_is_quiet", el.getAttribute("aria-live") === "off" && el.children.length === 4);
now += 1; run();
check("refill_then_live", el.getAttribute("aria-live") === "polite");

Date.now = realNow; globalThis.setTimeout = realSet; globalThis.clearTimeout = realClear;
console.log(JSON.stringify({ cases, failures }));
