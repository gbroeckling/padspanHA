// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
//
// Bluetooth → Advertisements says only what it knows: run the Monitor tab with
// an untagged device, a tagged one, and the unknowns the server leaves as null.
//
// usage: bt_labels.mjs <repo-root>
import { pathToFileURL } from "node:url";
const ROOT = process.argv[2];
if (!ROOT) { console.error("usage: bt_labels.mjs <repo-root>"); process.exit(2); }
const { install } = await import(pathToFileURL(ROOT + "/tests/js/dom_shim.mjs").href);
install(globalThis);
const BT = await import(pathToFileURL(ROOT + "/custom_components/padspan_ha/www/padspan-ha/views/bluetooth.js").href);

const results = [];
let failed = 0;
function check(name, cond, detail = "") {
  results.push({ case: name, ok: !!cond });
  if (!cond) { failed++; console.error(`FAIL ${name}${detail ? ": " + detail : ""}`); }
}
function el(tag, attrs = {}, children = []) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (k === "class") n.className = v; else if (k === "style") n.setAttribute("style", v);
    else if (k.startsWith("on") && typeof v === "function") n.addEventListener(k.slice(2), v);
    else if (v !== undefined && v !== null) n.setAttribute(k, String(v));
  }
  if (!Array.isArray(children)) children = [children];
  for (const c of children) { if (c == null) continue; if (typeof c === "string" || typeof c === "number") n.appendChild(document.createTextNode(String(c))); else n.appendChild(c); }
  return n;
}
const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const recorder = () => new Proxy(() => document.createElement("span"), { get: (t, k) => k === "then" ? undefined : recorder() });
const walk = (n, out = []) => { if (!n) return out; out.push(n); for (const c of (n.children || [])) walk(c, out); return out; };

const UNTAGGED = "4C:11:22:33:44:01", TAGGED = "4C:11:22:33:44:02", GUESS = "A4:C1:38:00:00:01", KNOWN = "F0:18:98:12:34:56", ADDR_SAYS = "DC:0D:30:00:00:01";
const untagged = { key: "ble:" + UNTAGGED, kind: "ble", address: UNTAGGED, name: UNTAGGED };
const tagged = { key: "ble:" + TAGGED, kind: "ble", address: TAGGED, name: "EX90", user_label: "Car", identified: true };
const ad = (address, extra) => ({ address, source: "kit", rssi: -60, age_s: 2, name: address, ...extra });
const ADS = [
  // What the server sends for a device nobody named: "label" falls back to the address.
  ad(UNTAGGED, { connectable: null, tx_power: null, _xref: { key: untagged.key, kind: "ble", label: UNTAGGED, user_label: "" } }),
  ad(TAGGED, { name: "EX90", connectable: true, tx_power: -12, _xref: { key: tagged.key, kind: "ble", label: "Car", user_label: "Car" } }),
  ad(GUESS, { connectable: false, maker_guess: "Telink Semiconductor", _xref: null }),
  ad(KNOWN, { company_name: "Apple", maker_source: "company_id", _xref: null }),
  ad(ADDR_SAYS, { company_name: "Feasycom", maker_source: "address", _xref: null }),
];

function draw(selected) {
  const prompts = [];
  const state = { btTab: "monitor", dataMode: "live", settings: {}, btSelectedAddr: selected || null,
    live: { snapshot: { ble: { radios: [{ source: "kit", name: "kit", area_name: "Kitchen" }], advertisements: ADS, diag: { ok: true, errors: [] } },
      objects: { list: [untagged, tagged] } } } };
  const helpers = new Proxy({ el, esc, helpBtn: () => el("button", {}, "?"), radioShortId: s => s, isScanner: () => false, roomColor: () => "#fff" },
    { get: (t, k) => k in t ? t[k] : recorder() });
  const actions = new Proxy({ followedHas: () => false, showObjectDetail: () => {}, tagObjectPrompt: (a, l) => prompts.push([a, l]) },
    { get: (t, k) => k in t ? t[k] : recorder() });
  const node = BT.render({ hass: { states: {} }, state, helpers, actions, toast: () => {} });
  return { node, prompts, nodes: walk(node) };
}
const rowOf = (d, addr) => d.nodes.find(n => n.className && String(n.className).includes("bt-adv-row")
  && String(n.textContent).includes(addr));
const buttonIn = (row) => walk(row).find(n => n.tagName === "BUTTON" && /^(Tag|Relabel)$/.test(String(n.textContent).trim()));

// ── Rows ────────────────────────────────────────────────────────────────────
{
  const d = draw();
  const row = rowOf(d, UNTAGGED);
  check("found the untagged row", !!row);
  const btn = buttonIn(row);
  check("an untagged device says Tag, not Relabel", btn && String(btn.textContent).trim() === "Tag", btn && btn.textContent);
  btn.click();
  check("and offers no label to change", JSON.stringify(d.prompts) === JSON.stringify([[UNTAGGED, ""]]), JSON.stringify(d.prompts));
  const tag = buttonIn(rowOf(d, TAGGED));
  check("a tagged device says Relabel", tag && String(tag.textContent).trim() === "Relabel", tag && tag.textContent);
  tag.click();
  check("and offers its label", JSON.stringify(d.prompts[1]) === JSON.stringify([TAGGED, "Car"]), JSON.stringify(d.prompts));
  check("a tagged row shows its label", String(rowOf(d, TAGGED).textContent).includes("Car"));
  const guess = String(rowOf(d, GUESS).textContent);
  check("no receiver's word reads probably", guess.includes("Probably Telink Semiconductor"), guess);
  const known = walk(rowOf(d, KNOWN)).find(n => String(n.textContent).trim() === "Apple" && n.getAttribute("title"));
  check("a known maker reads plainly", !!known);
  check("its hover text says how it is known", known && /company number/.test(known.getAttribute("title") || ""), known && known.getAttribute("title"));
  const viaAddr = walk(rowOf(d, ADDR_SAYS)).find(n => String(n.textContent).trim() === "Feasycom" && n.getAttribute("title"));
  check("from the address list, the hover text says so", viaAddr && /address makers/.test(viaAddr.getAttribute("title") || ""), viaAddr && viaAddr.getAttribute("title"));
}

// ── Details ─────────────────────────────────────────────────────────────────
const text = (addr) => String(draw(addr).node.textContent).replace(/\s+/g, " ");
{
  const t = text(UNTAGGED);
  check("details: no User Label on an untagged device", /User Label\s*—/.test(t), t.slice(0, 400));
  check("details: the address isn't called a label", !t.includes(`User Label${UNTAGGED}`) && !t.includes(`User Label ${UNTAGGED}`));
  check("details: unknown connectable says Unknown, not No", /Connectable\s*Unknown/.test(t), t.slice(0, 500));
  check("details: no TX power is a dash", /TX Power\s*—/.test(t), t.slice(0, 500));
}
{
  const t = text(TAGGED);
  check("details: a tagged device's label", /User Label\s*Car/.test(t), t.slice(0, 400));
  check("details: connectable yes", /Connectable\s*Yes/.test(t), t.slice(0, 500));
  check("details: a real TX power", /TX Power\s*-12 dBm/.test(t), t.slice(0, 500));
}
{
  const t = text(GUESS);
  check("details: connectable no, when a radio said so", /Connectable\s*No/.test(t), t.slice(0, 500));
  check("details: Company reads probably", /Company\s*Probably Telink Semiconductor/.test(t), t.slice(0, 700));
}

for (const r of results) console.log(JSON.stringify(r));
console.log(JSON.stringify({ summary: true, cases: results.length, failed }));
process.exit(failed ? 1 : 0);
