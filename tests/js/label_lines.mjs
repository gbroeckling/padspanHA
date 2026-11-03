// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
//
// The quiet lines a name link puts on a device (label_follow.py): what each says,
// and that each button says the right thing to the server.
//
// usage: label_lines.mjs <repo-root>
import { pathToFileURL } from "node:url";
const ROOT = process.argv[2];
if (!ROOT) { console.error("usage: label_lines.mjs <repo-root>"); process.exit(2); }
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
function acts(failWith) {
  const log = [];
  return { log, wsCall: async (type, data) => { log.push([type, data]); if (failWith) throw new Error(failWith); return {}; },
    toast: (m, bad) => log.push(["toast", m, bad]), showHelp: (k) => log.push(["help", k]),
    after: async () => log.push(["after"]) };
}
const walk = (n, f) => { f(n); for (const c of n.childNodes || []) walk(c, f); };
const text = (n) => n.textContent;
const buttons = (n) => { const out = []; walk(n, (c) => { if (String(c.tagName || "").toUpperCase() === "BUTTON") out.push(c); }); return out; };
const settle = async () => { for (let i = 0; i < 20; i++) await null; };
const press = async (b) => { b.click(); await settle(); };

check("nothing to say: nothing shown", DN.labelLines(el, { key: "ble:A" }, acts()) === null);

{
  // A double click: the second found the question closed and gave a red toast over a Yes that worked.
  const a = acts();
  const n = DN.labelLines(el, { key: "ble:B", label_ask: { key: "ble:A", address: "5B:00", label: "Car" } }, a);
  const [yes, no] = buttons(n);
  yes.click(); yes.click(); no.click();
  await settle();
  check("a double click answers once", a.log.filter(l => l[0] === "padspan_ha/label_link_answer").length === 1 && !a.log.some(l => l[0] === "toast"), JSON.stringify(a.log));
  yes.click();
  await settle();
  check("and it answers again once the first is done", a.log.filter(l => l[0] === "padspan_ha/label_link_answer").length === 2, JSON.stringify(a.log));
}
check("no device: nothing shown", DN.labelLines(el, null, acts()) === null);

{
  const a = acts();
  const n = DN.labelLines(el, { key: "ble:A", label_link: { address: "5B:00", by: "evidence" } }, a);
  check("a link says where it went", text(n).includes("Now on 5B:00") && text(n).includes("looks like the same device"), text(n));
  check("a link is never put as fact", !text(n).includes("is the same device"));
  const [undo] = buttons(n);
  check("one button: Undo", buttons(n).length === 1 && text(undo) === "Undo");
  await press(undo);
  check("Undo tells the server", a.log[0][0] === "padspan_ha/label_link_undo" && a.log[0][1].key === "ble:A");
  check("then redraws", a.log[1][0] === "after");
}
{
  const n = DN.labelLines(el, { key: "ble:A", label_link: { address: "5B:00", by: "you" } }, acts());
  check("your own link says so", text(n).includes("You said it's the same device"), text(n));
}
{
  const a = acts();
  const ask = { key: "ble:A", address: "5B:00", why: "gap", label: "My Car" };
  const n = DN.labelLines(el, { key: "ble:5B:00", label_ask: ask }, a);
  check("the question, in his words", text(n).includes("This looks like My Car: same device?"), text(n));
  const [yes, no] = buttons(n);
  await press(yes);
  check("Yes answers yes, for the named device", a.log[0][0] === "padspan_ha/label_link_answer" && a.log[0][1].same === true
    && a.log[0][1].key === "ble:A" && a.log[0][1].address === "5B:00");
  const b = acts();
  const [, no2] = buttons(DN.labelLines(el, { key: "ble:5B:00", label_ask: ask }, b));
  await press(no2);
  check("No answers no", b.log[0][1].same === false);
  check("two buttons", no !== undefined && buttons(n).length === 2);
}
{
  const a = acts();
  const n = DN.labelLines(el, { key: "ble:A", label_asking: { address: "5B:00", why: "gap" } }, a);
  check("the named row asks it from its side", text(n).includes("A new address, 5B:00, looks like this device: same device?"), text(n));
  const [yes] = buttons(n);
  await press(yes);
  check("and its Yes answers the same question", a.log[0][1].key === "ble:A" && a.log[0][1].address === "5B:00" && a.log[0][1].same === true);
}
{
  const a = acts();
  const n = DN.labelLines(el, { key: "ble:A", irk_hint: true }, a);
  check("the pointer names the fix", text(n).includes("Adding its key (IRK)"), text(n));
  const [how, dismiss] = buttons(n);
  await press(how);
  check("How opens the existing help", a.log[0][0] === "help" && a.log[0][1] === "private_ble");
  await press(dismiss);
  check("Dismiss tells the server", a.log.some((e) => e[0] === "padspan_ha/label_link_hint_off" && e[1].key === "ble:A"));
}
{
  const a = acts("nope");
  const n = DN.labelLines(el, { key: "ble:A", label_link: { address: "5B:00", by: "evidence" } }, a);
  await press(buttons(n)[0]);
  check("a failed call says so", a.log.some((e) => e[0] === "toast" && e[2] === true && String(e[1]).includes("nope")));
}
{
  let stopped = false;
  const n = DN.labelLines(el, { key: "ble:A", irk_hint: true }, acts());
  const b = buttons(n)[0];
  b.dispatchEvent({ type: "click", stopPropagation() { stopped = true; }, preventDefault() {} });
  await settle();
  check("a press doesn't open the row behind it", stopped);
}

console.log(JSON.stringify({ cases: results.length, failed }));
process.exit(failed ? 1 : 0);
