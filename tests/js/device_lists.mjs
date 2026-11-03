// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
//
// One name on screen, and how device lists gather the rotating addresses: the
// groups, a list's own filter passing through them, and nothing dropped.
//
// usage: device_lists.mjs <repo-root>
import { pathToFileURL } from "node:url";
const ROOT = process.argv[2];
if (!ROOT) { console.error("usage: device_lists.mjs <repo-root>"); process.exit(2); }
const { install } = await import(pathToFileURL(ROOT + "/tests/js/dom_shim.mjs").href);
install(globalThis);
const DN = await import(pathToFileURL(ROOT + "/custom_components/padspan_ha/www/padspan-ha/views/device_name.js").href);

const results = [];
let failed = 0;
function check(name, cond, detail = "") {
  results.push({ case: name, ok: !!cond });
  if (!cond) { failed++; console.error(`FAIL ${name}${detail ? ": " + detail : ""}`); }
}
function el(tag, attrs = {}, children = []) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (k === "style") n.setAttribute("style", v);
    else if (k.startsWith("on") && typeof v === "function") n.addEventListener(k.slice(2), v);
    else if (v !== undefined && v !== null) n.setAttribute(k, String(v));
  }
  for (const c of Array.isArray(children) ? children : [children]) {
    if (c == null) continue;
    n.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
  }
  return n;
}

// ── The one name ──────────────────────────────────────────────────────────────
const ADDR = "4C:11:22:33:44:55";
check("server name first", DN.deviceName({ best_name: "Samsung device", user_label: "x", name: ADDR, address: ADDR }) === "Samsung device");
check("sample mode: label", DN.deviceName({ user_label: "Car Keys", name: ADDR, address: ADDR }) === "Car Keys");
check("sample mode: phone", DN.deviceName({ private_ble_name: "Alice", name: "Alice", address: ADDR }) === "Alice");
check("sample mode: never the address", DN.deviceName({ name: ADDR, address: ADDR }) === "Unnamed device");
check("sample mode: blank name", DN.deviceName({ name: "", address: ADDR }) === "Unnamed device");
check("sample mode: maker", DN.deviceName({ name: "", address: ADDR, company_name: "Xiaomi" }) === "Xiaomi device");
check("fallback when nothing at all", DN.deviceName({}, "Unknown") === "Unknown" && DN.deviceName(null, "x") === "x");
check("what: from the server only", DN.deviceWhat({ best_name: "a", device_type: "Handoff" }) === null);
check("what: server's word", DN.deviceWhat({ best_name: "a", what_it_is: "AirTag", device_type: "Find My" }) === "AirTag");
check("what: sample mode", DN.deviceWhat({ device_type: "Tile" }) === "Tile");

// ── Fixed or Rotating ─────────────────────────────────────────────────────────
check("no badge until a radio has said", DN.addressBadge(el, { name: "x" }) === null);
check("fixed", DN.addressBadge(el, { address_kind: "fixed" }).textContent === "Fixed");
check("rotating", DN.addressBadge(el, { address_kind: "rotating" }).textContent === "Rotating");

// ── Fading ────────────────────────────────────────────────────────────────────
check("fresh stays", DN.fadeFor({ age_s: 10 }) === 1);
check("old fades", DN.fadeFor({ age_s: 90000 }) === 0.5);
check("a named device doesn't", DN.fadeFor({ age_s: 90000, user_label: "Car" }) === 1);

// ── Grouping ──────────────────────────────────────────────────────────────────
const rot = (over) => ({ address_kind: "rotating", name_source: "maker", age_s: 5, ...over });
const pc = (n) => rot({ key: `pc${n}`, what_it_is: "Windows PC", maker: "Microsoft", age_s: n });
const word = DN.groupWord;
check("word: what it is", word(pc(1)) === "Windows PC");
check("word: maker", word(rot({ maker: "Apple" })) === "Apple device");
check("word: service owner", word(rot({ service_owner: "Google" })) === "Google service");
check("word: nothing", word(rot({ name_source: "none" })) === "unnamed");
check("fixed stands alone", word({ ...pc(1), address_kind: "fixed" }) === null);
check("labelled stands alone", word({ ...pc(1), user_label: "Mine" }) === null);
check("identified stands alone", word({ ...pc(1), identified: true }) === null);
check("a real name stands alone", word({ ...pc(1), name_source: "broadcast" }) === null);
check("followed stands alone", word(pc(1), () => true) === null);

const list = [{ key: "named", user_label: "Car", address_kind: "fixed" }, pc(30), pc(2), rot({ key: "lone", what_it_is: "AirTag" }), pc(9)];
const items = DN.groupDevices(list, o => o);
check("gathered at the first one's place", items.length === 3 && items[0].entry === list[0] && items[1].group.word === "Windows PC" && items[2].entry === list[3]);
check("nothing dropped", items[1].group.entries.length === 3);
check("newest", items[1].group.newest === 2);
check("the title", DN.groupTitle(items[1].group) === "3 Windows PC addresses");
check("the title while searching", DN.groupTitle(items[1].group, 1) === "1 of 3 Windows PC addresses");

// A list's rows, in a real parent, through its filter.
const parent = document.createElement("tbody");
const rows = list.map(o => { const tr = document.createElement("tr"); tr.setAttribute("data-k", o.key); parent.appendChild(tr); return { node: tr, obj: o }; });
const open = new Set();
let passes = 0;
const filter = (q = () => true) => {
  for (const r of rows) r.node.style.display = q(r.obj) ? "" : "none";
  groups.refresh(false);
  passes++;
};
const groups = DN.groupRows(el, rows, parent, {
  openKeys: open,
  makeShell: (content) => el("tr", { "data-head": "1" }, el("td", {}, content)),
  reapply: () => filter(),
});
filter();
const kids = () => Array.from(parent.children);
const shown = () => kids().filter(n => n.style.display !== "none");
const headNode = kids().find(n => n.getAttribute("data-head"));
check("head stands before its rows", kids()[1] === headNode && kids().length === 6, kids().length);
check("rows still in the list, hidden", kids().filter(n => n.getAttribute("data-k")).length === 5);
check("closed: only the head shows", shown().length === 3, shown().length);
check("count in the head", groups.groups[0].head.title.textContent === "3 Windows PC addresses");
headNode.querySelector("button").click();
check("click opens, by the list's own filter", passes === 2 && open.has("Windows PC") && shown().length === 6, shown().length);
headNode.querySelector("button").click();
check("click closes", shown().length === 3);
filter(o => o.key === "pc2");
check("filter narrows the head's count", groups.groups[0].head.title.textContent === "1 of 3 Windows PC addresses");
for (const r of rows) r.node.style.display = r.obj.key === "pc2" ? "" : "none";
groups.refresh(true);
check("a search opens what it matches", shown().map(n => n.getAttribute("data-k")).includes("pc2"));
filter(() => false);
check("nothing passes: the head goes too", shown().length === 0);

// ── Copy ──────────────────────────────────────────────────────────────────────
const raw = JSON.parse(DN.rawBroadcast({ address: ADDR, name: ADDR, address_type: "random", manufacturer_data: { 76: "0x12" }, service_data: {}, service_uuids: [], connectable: null, best_name: "x", room: "Hall", sources: [1] }));
check("raw: what it broadcast", raw.address === ADDR && raw.address_type === "random" && raw.manufacturer_data[76] === "0x12");
check("raw: not where it is or what we call it", !("room" in raw) && !("best_name" in raw) && !("sources" in raw));
check("raw: empty left out, address not repeated as name", !("name" in raw) && !("service_data" in raw) && !("connectable" in raw));
check("first few", DN.firstFew(["a", "b", "c", "d", "e"]) === "a, b, c +2 more" && DN.firstFew(["a"]) === "a");

console.log(JSON.stringify({ cases: results.length, failed }));
if (failed) process.exit(1);
