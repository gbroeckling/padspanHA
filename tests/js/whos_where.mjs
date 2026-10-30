// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
//
// "Who's where now" (views/whos_where.js), run for real: what a house's
// scanners give it, who is in which room from a snapshot, phones Home
// Assistant knows that no one tracks yet, and the card itself (built,
// Track pressed, kept current by its updater, gone in Sample mode).
//
// usage: whos_where.mjs <www/padspan-ha dir>
// prints one JSON line: { cases: {name: result}, failures: [...] }

import { pathToFileURL } from "node:url";
import { join } from "node:path";
import { install } from "./dom_shim.mjs";

// The shim queues timers; a real tick lets the card's promises settle.
const tick = () => new Promise(r => globalThis._realSetTimeout(r, 0));

const WWW = process.argv[2];
if (!WWW) { console.error("usage: whos_where.mjs <www/padspan-ha dir>"); process.exit(2); }
install(globalThis);

const WW = await import(pathToFileURL(join(WWW, "views", "whos_where.js")).href);

const failures = [];
const cases = {};
const check = (name, ok, detail) => { cases[name] = !!ok; if (!ok) failures.push({ name, detail: detail === undefined ? null : detail }); };

// ── the scanners and what they give ──────────────────────────────────────────
const radio = (source, area, name) => ({ source, name: name || source, area_name: area });
const snapOf = (radios, objects) => ({ ble: { radios }, objects: { list: objects } });

const sc = WW.scannersOf(snapOf([radio("AA", "Kitchen", "Kitchen proxy"), radio("BB", "", "Hall proxy"), radio("", "Den"), null, radio("CC", "unknown")], []));
check("scannersOf keeps real scanners, an area only when it is one", sc.length === 3 && sc[0].area === "Kitchen" && sc[1].area === "" && sc[2].area === "", sc);
check("scannersOf copes with no snapshot", WW.scannersOf(null).length === 0 && WW.scannersOf({}).length === 0);

const line = (radios) => WW.scannerLine(WW.scannersOf(snapOf(radios, [])));
check("no scanner: how to get one", line([]).tone === "none" && /No Bluetooth scanners found yet/.test(line([]).text));
check("no area anywhere: home or away, not rooms", line([radio("AA", ""), radio("BB", "")]).tone === "warn" && /None of your 2 scanners has/.test(line([radio("AA", ""), radio("BB", "")]).text));
check("one scanner, no area", /^Your scanner has no Home Assistant area yet, so PadSpan can tell home from away but not rooms/.test(line([radio("AA", "")]).text), line([radio("AA", "")]).text);
check("one room: home or away", /cover one room|covers one room/.test(line([radio("AA", "Kitchen")]).text) && /home or away/.test(line([radio("AA", "Kitchen")]).text));
check("two scanners in one room: still one room", /2 scanners cover one room/.test(line([radio("AA", "Kitchen"), radio("BB", "Kitchen")]).text));
const three = line([radio("AA", "Kitchen"), radio("BB", "Den"), radio("CC", "Hall")]);
check("rooms: nearest scanner, and what three placed add", three.tone === "ok" && /3 scanners cover 3 rooms/.test(three.text) && /three or more placed on a floor plan/.test(three.text), three);

// ── who is where ─────────────────────────────────────────────────────────────
const objects = [
  { kind: "private_ble", key: "irk:aa", canonical_id: "irk:aa", private_ble_name: "Anna's iPhone", room: "Kitchen", age_s: 2 },     // known to HA, not tracked: Track
  { kind: "private_ble", key: "irk:bb", canonical_id: "irk:bb", private_ble_name: "Garry's iPhone", user_label: "Garry", room: "Den", age_s: 2 },
  { kind: "ble", address: "11:11", name: "Keys", identified: true, room: "Kitchen", age_s: 3 },
  { kind: "ble", address: "22:22", room: "Kitchen", age_s: 1 },             // a stranger: counted, not named
  { kind: "ble", address: "33:33", room: "Kitchen", age_s: 1 },
  { kind: "ble", address: "44:44", user_label: "Old tag", room: "Den", age_s: 9999 },     // away
  { kind: "ble", address: "55:55", user_label: "Ghost", room: "Den", _stale: true },
  { kind: "ble", address: "66:66", room: "Garage", age_s: 1 },              // a room with no scanner of its own
  { kind: "entity", address: "11:11", user_label: "Keys tracker", room: "Kitchen" },     // the radio stands for it
  { kind: "ble", address: "AA", user_label: "the Kitchen proxy itself", room: "Kitchen" },
  { kind: "ble", address: "77:77", name: "Followed thing", room: "Hall", age_s: 1 },     // followed only
  { kind: "ble", address: "88:88", room: "unknown", age_s: 1 },
];
const opts = { followed: (o) => o.address === "77:77", away: (o) => (o.age_s || 0) > 300, isScanner: (o) => o.address === "AA" };
const radios = [radio("AA", "Kitchen"), radio("BB", "Den"), radio("CC", "Hall"), radio("DD", "Office")];
const rows = WW.whoIsWhere(snapOf(radios, objects), WW.scannersOf(snapOf(radios, [])), opts);
const byRoom = Object.fromEntries(rows.map(r => [r.room, r]));
check("every scanner room is listed, empty ones too", ["Kitchen", "Den", "Hall", "Office"].every(r => byRoom[r]), rows.map(r => r.room));
check("scanner rooms first, then others", rows.map(r => r.room).join(",") === "Den,Hall,Kitchen,Office,Garage", rows.map(r => r.room));
const k = byRoom.Kitchen;
check("Kitchen: Anna to track, Keys known, two strangers counted", k && k.people.length === 2 && k.others === 2
  && k.people[0].name === "Anna's iPhone" && k.people[0].track === true && k.people[0].key === "irk:aa"
  && k.people[1].name === "Keys" && k.people[1].track === false, k);
check("a labelled phone is known, not offered again", byRoom.Den.people.length === 1 && byRoom.Den.people[0].name === "Garry" && !byRoom.Den.people[0].track, byRoom.Den);
check("away, stale and the scanner itself are left out", byRoom.Den.others === 0 && !rows.some(r => r.people.some(p => /Old tag|Ghost|proxy itself/.test(p.name))));
check("an entity a radio stands for is counted once", k.people.filter(p => p.name.startsWith("Keys")).length === 1);
check("followed counts as known", byRoom.Hall.people.length === 1 && byRoom.Hall.people[0].name === "Followed thing");
check("a room with no scanner still shows who is there", byRoom.Garage && byRoom.Garage.others === 1);
check("not a room: left out", !rows.some(r => r.room === "unknown"));

// ── after review: the panel's followed test, phones with no room ─────────────
check("followed by its bare address, as the Follow buttons store it",
  WW.followedObj({ kind: "ble", key: "ble:AA:BB", address: "AA:BB" }, (k) => k === "AA:BB")
  && WW.followedObj({ kind: "entity", entity_id: "device_tracker.x" }, (k) => k === "device_tracker.x")
  && !WW.followedObj({ kind: "ble", key: "ble:CC" }, (k) => k === "AA:BB"));
const noArea = [
  { kind: "private_ble", key: "irk:ff", canonical_id: "irk:ff", private_ble_name: "Robin's iPhone", room: "unknown", age_s: 1 },
  { kind: "ble", address: "12:12", user_label: "Bag", room: "", age_s: 1 },
  { kind: "ble", address: "13:13", room: "unknown", age_s: 1 },               // a stranger with no room: not shown
];
const nrRows = WW.whoIsWhere(snapOf([radio("AA", "")], noArea), WW.scannersOf(snapOf([radio("AA", "")], [])), {});
const last = nrRows[nrRows.length - 1];
check("heard with no room: its own last row, with Track", last && last.room === "" && last.people.length === 2
  && last.people.some(p => p.name === "Robin's iPhone" && p.track) && last.people.some(p => p.name === "Bag" && !p.track) && last.others === 0, nrRows);
check("no such row when there's nobody in it", !WW.whoIsWhere(snapOf(radios, objects), WW.scannersOf(snapOf(radios, [])), opts).some(r => r.room === ""));

// ── phones Home Assistant knows, not heard now ───────────────────────────────
const devices = [
  { name: "Anna's iPhone", canonical_id: "irk:aa", source: "private_ble_device" },      // heard: on the room list instead
  { name: "Garry's iPhone", canonical_id: "irk:bb", source: "private_ble_device" },     // labelled
  { name: "Nicole's Watch", canonical_id: "irk:cc", source: "private_ble_device" },     // not heard, not tracked: offered
  { name: "Bob's Pixel", canonical_id: "irk:dd", source: "settings" },                   // PadSpan's own IRK list, not HA's
  { name: "Followed", canonical_id: "irk:ee", source: "private_ble_device" },          // followed
];
const nh = WW.phonesNotHeard(devices, { "IRK:BB": "Garry" }, ["irk:aa"], (key) => key === "irk:ee");
check("not heard: only Nicole's Watch", nh.length === 1 && nh[0].name === "Nicole's Watch" && nh[0].key === "irk:cc", nh);
check("not heard copes with nothing", WW.phonesNotHeard(null, null, null).length === 0);

// ── the card ─────────────────────────────────────────────────────────────────
const el = (tag, attrs = {}, kids = []) => {
  const n = document.createElement(tag);
  for (const [a, v] of Object.entries(attrs || {})) {
    if (a === "class") n.className = v; else if (a === "style") n.style.cssText = v; else n.setAttribute(a, v);
  }
  for (const c of [].concat(kids)) { if (c == null) continue; n.appendChild(typeof c === "string" ? document.createTextNode(c) : c); }
  return n;
};
const calls = [];
const followed = new Set();
const toasts = [];
const mkCtx = (mode, snap) => ({
  helpers: { el, isAway: (o, t) => (o.age_s || 0) > t, awayTimeoutS: () => 300, isScanner: opts.isScanner },
  state: { dataMode: mode, live: { snapshot: snap }, settings: {}, maps: { list: [] } },
  actions: {
    followedHas: (a) => followed.has(String(a).toUpperCase()),
    followedToggle: (a) => { const u = String(a).toUpperCase(); if (followed.has(u)) followed.delete(u); else followed.add(u); },
    wsCall: async (type, data) => {
      calls.push([type, data]);
      if (type === "padspan_ha/private_ble_status") return { devices };
      if (type === "padspan_ha/object_label_list") return { labels: { "IRK:BB": "Garry" } };
      return {};
    },
    renderRooms: () => calls.push(["renderRooms"]),
    setDataMode: (m) => calls.push(["setDataMode", m]),
    showView: (v) => calls.push(["showView", v]),
  },
  toast: (m, err) => toasts.push([m, !!err]),
});

check("no card in Sample mode", WW.whosWhereCard(mkCtx("sample", snapOf(radios, objects))) === null);
check("no card before the first snapshot", WW.whosWhereCard(mkCtx("live", null)) === null);

followed.add("IRK:EE");          // as in phonesNotHeard above: a followed phone isn't offered
const ctx = mkCtx("live", snapOf(radios, objects));
const card = WW.whosWhereCard(ctx);
document.body.appendChild(card);
const text = () => card.textContent;
check("the card names rooms and people", /Who's where now/.test(text()) && /Kitchen/.test(text()) && /Anna's iPhone/.test(text()) && /2 other Bluetooth devices/.test(text()), text());
check("it registered its updater", typeof ctx.state._whosWhereUpdate === "function");
await tick();
await tick();
check("it asked Home Assistant's phones and PadSpan's labels once", calls.filter(c => c[0] === "padspan_ha/private_ble_status").length === 1
  && calls.filter(c => c[0] === "padspan_ha/object_label_list").length === 1, calls);
check("a known phone not heard now is offered", /Not heard right now/.test(text()) && /Nicole's Watch/.test(text()), text());

// Track Anna.
const trackBtns = [...card.querySelectorAll("button")].filter(b => b.textContent === "Track");
check("a Track button per phone to track", trackBtns.length === 2, trackBtns.length);
trackBtns[0].click();
await tick();
const labelCall = calls.find(c => c[0] === "padspan_ha/object_label_set");
check("Track names it under its key", labelCall && labelCall[1].address === "irk:aa" && labelCall[1].label === "Anna's iPhone", labelCall);
check("Track follows it", followed.has("IRK:AA"));
check("Track says what it did", toasts.some(([m, e]) => !e && /Tracking Anna's iPhone/.test(m)), toasts);

// Nothing changed: the updater leaves the buttons where they are.
ctx.state._whosWhereUpdate();            // takes in the Track above
const rowOf = () => [...card.querySelectorAll("div")].find(d => d.firstChild && d.firstChild.textContent === "Kitchen");
const sameRow = rowOf();
ctx.state._whosWhereUpdate();
check("an unchanged house is not redrawn", !!sameRow && rowOf() === sameRow);

// The updater redraws from the newest snapshot.
ctx.state.live.snapshot = snapOf(radios, [{ kind: "ble", address: "99:99", user_label: "Dog", room: "Office", age_s: 1 }]);
ctx.state._whosWhereUpdate();
check("the updater shows the new snapshot", /Dog/.test(text()) && !/Anna's iPhone<|2 other Bluetooth devices/.test(text()), text());

// Footer buttons.
const btn = (label) => [...card.querySelectorAll("button")].find(b => b.textContent === label);
btn("Preview a finished house").click();
check("Preview switches to the demo house", calls.some(c => c[0] === "setDataMode" && c[1] === "sample"));
btn("Make it a map").click();
check("Make it a map opens the guided Setup", calls.some(c => c[0] === "showView" && c[1] === "setup"));

// A Track that fails says so and can be pressed again (Anna not followed yet here).
followed.clear();
const bad = mkCtx("live", snapOf(radios, objects));
bad.actions.wsCall = async (type) => { if (type === "padspan_ha/object_label_set") throw new Error("unauthorized"); return {}; };
const card2 = WW.whosWhereCard(bad);
document.body.appendChild(card2);
const b2 = [...card2.querySelectorAll("button")].find(b => b.textContent === "Track");
b2.click();
await tick();
check("a failed Track says why and comes back", toasts.some(([m, e]) => e && /unauthorized/.test(m)) && b2.textContent === "Track" && !b2.disabled);

// Detached: the updater does nothing (the shim has no isConnected; views treat only false as gone).
card.isConnected = false;
const before = text();
ctx.state.live.snapshot = snapOf(radios, [{ kind: "ble", address: "99:98", user_label: "Cat", room: "Office", age_s: 1 }]);
ctx.state._whosWhereUpdate();
check("a detached card is left alone", text() === before);

// Counts change in place: the Track buttons stay.
followed.clear();
const ctx4 = mkCtx("live", snapOf(radios, objects));
const card4 = WW.whosWhereCard(ctx4);
document.body.appendChild(card4);
const btn4 = [...card4.querySelectorAll("button")].find(b => b.textContent === "Track");
const more = objects.concat([{ kind: "ble", address: "34:34", room: "Kitchen", age_s: 1 }]);
ctx4.state.live.snapshot = snapOf(radios, more);
ctx4.state._whosWhereUpdate();
check("a new stranger updates the count and keeps the buttons",
  [...card4.querySelectorAll("button")].includes(btn4) && /3 other Bluetooth devices/.test(card4.textContent), card4.textContent);

// Enhanced security, someone who isn't an administrator: no Track, and why.
const ctx5 = mkCtx("live", snapOf(radios, objects));
ctx5.state.settings = { enhanced_security: true };
ctx5.hass = { user: { is_admin: false } };
const card5 = WW.whosWhereCard(ctx5);
check("no Track for a non-admin under Enhanced security, and the reason",
  ![...card5.querySelectorAll("button")].some(b => b.textContent === "Track") && /an administrator can track/.test(card5.textContent), card5.textContent);
const ctx6 = mkCtx("live", snapOf(radios, objects));
ctx6.state.settings = { enhanced_security: true };
ctx6.hass = { user: { is_admin: true } };
check("an administrator still has Track", [...WW.whosWhereCard(ctx6).querySelectorAll("button")].some(b => b.textContent === "Track"));

// A phone the snapshot still holds but shows as away is "not heard right now".
followed.clear();
const awayPhone = [{ kind: "private_ble", key: "irk:cc", canonical_id: "irk:cc", private_ble_name: "Nicole's Watch", room: "Den", age_s: 9999 }];
const ctx7 = mkCtx("live", snapOf(radios, awayPhone));
const card7 = WW.whosWhereCard(ctx7);
document.body.appendChild(card7);
await tick();
await tick();
check("an away phone still in the snapshot is listed as not heard", /Not heard right now/.test(card7.textContent) && /Nicole's Watch/.test(card7.textContent), card7.textContent);

// Names are text, never markup.
const ctx3 = mkCtx("live", snapOf(radios, [{ kind: "ble", address: "x", user_label: "<img src=x onerror=alert(1)>", room: "Kitchen", age_s: 1 }]));
const card3 = WW.whosWhereCard(ctx3);
check("names stay text", !card3.querySelector("img") && /<img src=x/.test(card3.textContent));

console.log(JSON.stringify({ cases, failures }));
