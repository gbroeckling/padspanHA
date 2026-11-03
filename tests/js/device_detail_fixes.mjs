// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
//
// What the 2026-11-02 review of device detail found, in the browser's half:
// rows you can tell apart where a person picks, no IRK in Copy raw broadcast,
// what the server leaves off, and Forensics' CSV columns keeping their meaning.
//
// usage: device_detail_fixes.mjs <repo-root>
import { pathToFileURL } from "node:url";
const ROOT = process.argv[2];
if (!ROOT) { console.error("usage: device_detail_fixes.mjs <repo-root>"); process.exit(2); }
const { install } = await import(pathToFileURL(ROOT + "/tests/js/dom_shim.mjs").href);
install(globalThis);
const VIEWS = ROOT + "/custom_components/padspan_ha/www/padspan-ha/views/";
const DN = await import(pathToFileURL(VIEWS + "device_name.js").href);
const { csvLines } = await import(pathToFileURL(VIEWS + "forensics.js").href);

const results = [];
let failed = 0;
function check(name, cond, detail = "") {
  results.push({ case: name, ok: !!cond });
  if (!cond) { failed++; console.error(`FAIL ${name}${detail ? ": " + detail : ""}`); }
}

// ── Where a person picks ────────────────────────────────────────────────
const A = "4b:25:0d:8a:3b:63";
const pick = (over) => DN.pickName({ address: A, name: A, ...over }, "fallback");
check("a maker: the address's end", pick({ best_name: "Apple device" }) === "Apple device · 8A:3B:63");
check("a service", pick({ best_name: "Uses a service from Google", name_source: "service" }) === "Uses a service from Google · 8A:3B:63");
check("nothing", pick({ best_name: "Unnamed device", name_source: "none" }) === "Unnamed device · 8A:3B:63");
check("a guess is a maker's word", pick({ best_name: "Probably Espressif device" }) === "Probably Espressif device · 8A:3B:63");
check("a label stands alone", pick({ best_name: "Keys", name_source: "label" }) === "Keys");
check("a device's name stands alone", pick({ best_name: "Pixel", name_source: "device" }) === "Pixel");
check("a broadcast name stands alone", pick({ best_name: "EX90", name_source: "broadcast" }) === "EX90");
check("a beacon's generated name is its own", pick({ best_name: "iBeacon abcd1234", name_source: "beacon" }) === "iBeacon abcd1234");
check("sample mode: maker", pick({ company_name: "Xiaomi" }) === "Xiaomi device · 8A:3B:63");
check("sample mode: nothing", pick({}) === "Unnamed device · 8A:3B:63");
check("sample mode: a label", pick({ user_label: "Car" }) === "Car");
check("a split iBeacon's one address", DN.pickName({ address: "ibeacon:x", all_addresses: [A], best_name: "Unnamed device", name_source: "none" }) === "Unnamed device · 8A:3B:63");
check("an IRK is never the tail", DN.pickName({ address: "irk:0123456789abcdef0123456789abcdef", best_name: "Apple device" }) === "Apple device");
check("no address, no tail", DN.pickName({ best_name: "Apple device" }) === "Apple device");
check("no object", DN.pickName(null, "x") === "x");

const fifty = Array.from({ length: 50 }, (_x, i) => ({ address: `4B:25:0D:8A:3B:${String(i).padStart(2, "0")}`, best_name: "Apple device" }));
check("fifty phones, fifty rows", new Set(fifty.map(o => DN.pickName(o))).size === 50);

// ── Left off by the server ──────────────────────────────────────────────
const rot = { address_kind: "rotating", age_s: 5 };
check("group: a best name with no source is a maker's", DN.groupWord({ ...rot, best_name: "Apple device", company_name: "Apple" }) === "Apple device");
check("group: never through the server stays out", DN.groupWord({ ...rot, company_name: "Apple" }) === null);
check("group: a broadcast name stays out", DN.groupWord({ ...rot, best_name: "EX90", name_source: "broadcast" }) === null);
check("what: not the name twice", DN.listWhat({ best_name: "Apple device", what_it_is: "Apple device" }) === null);
check("what: a type stays", DN.listWhat({ best_name: "Unnamed device", what_it_is: "Find My accessory" }) === "Find My accessory");

const asked = [];
const server = (type, data) => { asked.push([type, data]); return Promise.resolve({ how_known: "Apple, from its company number." }); };
const node = { textContent: "" };
const o = { kind: "ble", name: A, address: A, company_name: "Apple", maker_source: "company_id", room: "Hall", manufacturer_data: { 76: "0x10" }, best_name: "Apple device", sources: [1] };
DN.fillHowKnown(node, o, server);
for (let i = 0; i < 5; i++) await Promise.resolve();
check("how: the window asks", asked.length === 1 && asked[0][0] === "padspan_ha/device_how_known" && node.textContent === "Apple, from its company number.");
check("how: only what it needs", !("room" in asked[0][1].object) && !("address" in asked[0][1].object) && asked[0][1].object.company_name === "Apple");
const again = { textContent: "" };
DN.fillHowKnown(again, { ...o }, server);
check("how: a redraw doesn't ask twice", asked.length === 1 && again.textContent === "Apple, from its company number.");
const sample = { textContent: "" };
DN.fillHowKnown(sample, { how_known: "From sample." }, server);
check("how: sample mode has it already", sample.textContent === "From sample." && asked.length === 1);
const failedNode = { textContent: "" };
DN.fillHowKnown(failedNode, { ...o, company_name: "Other" }, () => Promise.reject(new Error("offline")));
for (let i = 0; i < 5; i++) await Promise.resolve();
check("how: an old server or no connection isn't an error", failedNode.textContent === "—");

// ── Copy raw broadcast ──────────────────────────────────────────────────
const IRK = "irk:0123456789abcdef0123456789abcdef";
const text = DN.rawBroadcast({ address: "6A:11:22:33:44:55", address_type: "random", name: IRK, espresense_id: IRK, broadcast_name: "Pixel", user_label: "Nicole's keys", manufacturer_data: { 76: "0x10" } });
const raw = JSON.parse(text);
check("raw: the IRK is hidden", !/irk:[0-9a-f]{32}/i.test(text) && raw.espresense_id === "irk:hidden-1", text);
check("raw: the name it broadcast", raw.broadcast_name === "Pixel" && !("name" in raw));
check("raw: not your label", !text.includes("Nicole"));
const labelled = JSON.parse(DN.rawBroadcast({ address: A, name: "Nicole's keys", user_label: "Nicole's keys" }));
check("raw: a labelled beacon's name isn't sent", !("name" in labelled) && !("broadcast_name" in labelled));
check("hideIrks: the same phone, the same number", DN.hideIrks(`${IRK} ${IRK.toUpperCase().replace("IRK", "irk")}`) === "irk:hidden-1 irk:hidden-1");

// ── Forensics' CSV ──────────────────────────────────────────────────────
const session = { start: 1000, end: 1060, rssi: -60 };
const recorded = [
  { address: "4B:25:0D:8A:3B:63", name: "", company_name: "Apple", device_type: "Nearby Info", best_name: "Apple device", what_it_is: "Apple device", sources: ["s1"], session_count: 2, sessions: [session] },
  { address: "FD:E2:2C:B8:53:F0", name: "", device_type: "", best_name: "Uses a service from Google", sources: [], sessions: [session] },
];
const possible = [{ key: "ble:X", address: "AA:BB:CC:00:11:33", name: "Some TV", device_type: "AirPlay Target", best_name: "Some TV", what_it_is: null, first_seen: 1000, last_seen: 2000 }];
const lines = csvLines(recorded, possible);
const head = lines[0].split(",");
const col = (line, name) => line.split(",")[head.indexOf(name)];
check("csv: the old columns in their old places", lines[0].startsWith("confidence,address,name,label,vendor,device_type,session_start,session_end,dwell,max_rssi,scanners"));
check("csv: new columns at the end", head.slice(-2).join() === "best_name,what_it_is");
check("csv: name stays what the device sent", col(lines[1], "name") === "" && col(lines[3], "name") === "" && col(lines[4], "name") === "Some TV");
check("csv: device_type stays the message type", col(lines[1], "device_type") === "Nearby Info" && col(lines[4], "device_type") === "AirPlay Target");
check("csv: the one name in its own column", col(lines[1], "best_name") === "Apple device" && col(lines[3], "best_name") === "Uses a service from Google");
check("csv: what it is in its own", col(lines[1], "what_it_is") === "Apple device" && col(lines[4], "what_it_is") === "");
check("csv: every row as wide as the header", lines.every(l => l.split(",").length === head.length), lines.join("\n"));
check("csv: the row saying sessions were left out", lines[2].includes("1 earlier session(s) in this window not included"));
check("csv: a formula from a device's name is still neutralized", csvLines([{ ...recorded[0], name: "=HYPERLINK(1)" }], [])[1].split(",")[2] === "'=HYPERLINK(1)");

console.log(JSON.stringify({ cases: results.length, failed }));
if (failed) process.exit(1);
