// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
//
// The keyboard for the panel's cards, sheets, drawers and dialogs
// (views/dialog_keys.js), RUN rather than read, and the places that use it.
// The click-through test of 2026-11-20: Escape did nothing on the phone
// menu, the Atlas builder guide, the flat Atlas's room, door and receiver
// cards and Live Aboard's receiver cards (✕ and a tap outside did), and the
// panel's dialog never took the keyboard: Tab walked the page behind it and
// on closing the focus fell to the page.
//
//   escape    Escape does what close does, on the one opened last only, when
//             pressed in it or with nothing focused; an editor's field
//             elsewhere, a key someone already took, and a dialog that keeps
//             its own Escape are left alone
//   tab       a modal one takes the focus (the box itself, no ring) and Tab
//             and Shift+Tab stay inside it; a card that is not modal leaves
//             Tab alone
//   back      on closing the focus goes back to what opened it, or to what
//             replaced it (same id, data-* attributes, or tag and words when
//             no other control has them); nothing when it is not clear
//   gone      one closed another way (its box off the page, or open() false)
//             holds nothing
//   pressed   opened by a press on what is no control (a tile, a room on the
//             map: nothing has the focus): the focus goes back to it, the
//             element that is the clickable thing, with tabindex -1 and no
//             ring; a press inside the card or long ago does not count
//   atlas     the flat Atlas's room sheet, door card, light card, activity
//             card, Unlock question (lights_map.js) and a person's or
//             receiver's card (atlas_aboard.js): Escape closes each, the
//             focus goes back
//   modal     panel.js's _openModal / _closeModal: the focus goes in, Tab
//             stays in, Escape (its own) closes, the focus goes back, also
//             after one modal replaced another
//
// usage: dialog_keys.mjs <www/padspan-ha dir>
// prints one JSON line: { cases: {name: result}, failures: [...] }

import { pathToFileURL } from "node:url";
import { join } from "node:path";
import { readFileSync } from "node:fs";
import { install, flush } from "./dom_shim.mjs";

const WWW = process.argv[2];
if (!WWW) { console.error("usage: dialog_keys.mjs <www/padspan-ha dir>"); process.exit(2); }
install(globalThis);

const failures = [];
const cases = {};
const check = (name, ok, detail) => { if (cases[name] !== false) cases[name] = !!ok; if (!ok) failures.push({ name, detail: detail === undefined ? null : detail }); };
const tryCase = async (name, fn) => { try { await fn(); } catch (e) { failures.push({ name, detail: String(e && e.stack || e).slice(0, 900) }); cases[name] = false; } };

// ── what the shim leaves out: on the page or not, focus, Tab order, keys ────
const proto = Object.getPrototypeOf(document.createElement("div"));
const topOf = (n) => { while (n.parentNode) n = n.parentNode; return n; };
Object.defineProperty(proto, "isConnected", { configurable: true, get() { return topOf(this) === document; } });
proto.getRootNode = function () { return topOf(this); };
const _remove = proto.removeChild;
proto.removeChild = function (c) { const r = _remove.call(this, c); if (c && c.parentNode === this && this.children.indexOf(c) < 0) c.parentNode = null; return r; };
// Only what can take it: a control, or anything with a tabindex.
proto.focus = function () { if (this.isConnected && !this.disabled && (this.hasAttribute("tabindex") || this.tabIndex >= 0)) active = this; };
// Children taken out by replaceChildren, innerHTML or textContent have no parent any more.
const _rc = proto.replaceChildren;
proto.replaceChildren = function (...cs) { for (const c of this.children.slice()) if (!cs.includes(c)) c.parentNode = null; return _rc.apply(this, cs); };
for (const k of ["innerHTML", "textContent"]) {
  const d = Object.getOwnPropertyDescriptor(proto, k);
  Object.defineProperty(proto, k, { configurable: true, get: d.get, set(v) { for (const c of this.children) c.parentNode = null; d.set.call(this, v); } });
}
proto.getClientRects = function () { return this.style.display === "none" ? [] : [{}]; };
proto.getAttributeNames = function () { return Object.keys(this.attributes); };
Object.defineProperty(proto, "nodeType", { configurable: true, get() { return { "#text": 3, "#document": 9, "#fragment": 11 }[this.localName] || 1; } });
const NATIVE = new Set(["button", "input", "select", "textarea", "summary"]);
Object.defineProperty(proto, "tabIndex", { configurable: true,
  get() { const t = this.getAttribute("tabindex"); if (t !== null) return Number(t); return NATIVE.has(this.localName) || (this.localName === "a" && this.hasAttribute("href")) ? 0 : -1; },
  set(v) { this.setAttribute("tabindex", String(v)); } });
// A browser's focus: on what has it while it is on the page, else the body.
let active = document.body;
Object.defineProperty(document, "activeElement", { configurable: true, get() { return active && active.isConnected ? active : document.body; }, set(v) { active = v; } });
// Selectors: the shim's, and comma lists of tag[attr] / [attr="v"] parts (the Tab order's).
const _qsa = proto.querySelectorAll;
const part = (s) => { const m = /^([a-z][a-z0-9-]*)?((?:\[[^\]]+\])*)$/i.exec(s.trim()); if (!m || (!m[1] && !m[2])) return null;
  const attrs = [...m[2].matchAll(/\[([^=\]]+)(?:="((?:[^"\\]|\\.)*)")?\]/g)].map((a) => [a[1], a[2] === undefined ? undefined : a[2].replace(/\\(.)/g, "$1")]);
  return (n) => (!m[1] || n.localName === m[1].toLowerCase()) && attrs.every(([k, v]) => n.hasAttribute && n.hasAttribute(k) && (v === undefined || n.getAttribute(k) === v)); };
proto.querySelectorAll = function (sel) {
  const parts = String(sel).split(",").map(part);
  if (parts.some((p) => !p)) return _qsa.call(this, sel);
  return this._all().filter((n) => n.localName && parts.some((p) => p(n)));
};
document.querySelectorAll = proto.querySelectorAll.bind(document);
// The window's key listeners, capture and bubble, and one key press through them.
const winL = [];
const capOf = (o) => o === true || !!(o && o.capture);
globalThis.addEventListener = (t, fn, o) => { winL.push({ t, fn, cap: capOf(o) }); };
globalThis.removeEventListener = (t, fn, o) => { const i = winL.findIndex((l) => l.t === t && l.fn === fn && l.cap === capOf(o)); if (i >= 0) winL.splice(i, 1); };
document.addEventListener = (t, fn, o) => { winL.push({ t, fn, cap: capOf(o), doc: true }); };
document.removeEventListener = (t, fn, o) => { const i = winL.findIndex((l) => l.t === t && l.fn === fn && l.cap === capOf(o) && l.doc); if (i >= 0) winL.splice(i, 1); };
function key(k, o = {}) {
  const t = o.target || document.activeElement;
  let stopped = false, prevented = !!o.prevented;
  const path = [];
  for (let n = t; n; n = n.parentNode) path.push(n);
  path.push(globalThis);
  const e = { type: "keydown", key: k, shiftKey: !!o.shift, altKey: false, ctrlKey: false, metaKey: false, target: t, repeat: false,
    composedPath: () => path, stopPropagation() { stopped = true; }, stopImmediatePropagation() { stopped = true; },
    preventDefault() { prevented = true; }, get defaultPrevented() { return prevented; } };
  const ls = (cap, doc) => winL.filter((l) => l.t === "keydown" && l.cap === cap && !!l.doc === doc);
  for (const l of ls(true, false)) l.fn(e);
  if (!stopped) for (const l of ls(true, true)) l.fn(e);
  if (!stopped) for (const n of path.slice(0, -1)) { for (const f of ((n._listeners && n._listeners.keydown) || []).slice()) f(e); if (stopped) break; }
  if (!stopped) for (const l of ls(false, true)) l.fn(e);
  if (!stopped) for (const l of ls(false, false)) l.fn(e);
  return { stopped, prevented };
}
const mk = (tag, attrs = {}, text) => { const n = document.createElement(tag); for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v); if (text !== undefined) n.textContent = text; return n; };
const focused = () => document.activeElement;

const K = await import(pathToFileURL(join(WWW, "views", "dialog_keys.js")).href);

// A page: an opener, and a card it opens with ✕ and two more buttons.
function card({ modal = false, withClose = true, take, opener } = {}) {
  const box = mk("div", { class: "card" });
  const x = mk("button", {}, "✕"), a = mk("button", {}, "One"), b = mk("button", {}, "Two");
  box.append(x, a, b);
  document.body.appendChild(box);
  let closed = 0, release = null;
  const close = () => { closed++; box.remove(); if (release) release(); };
  release = K.holdKeys(box, { ...(withClose ? { close } : {}), modal, ...(take === undefined ? {} : { take }), ...(opener === undefined ? {} : { opener }) });
  return { box, x, a, b, close, closed: () => closed, release };
}
// Whatever a case left: off the page, so nothing is held.
const reset = () => { document.body.children.slice().forEach((n) => n.remove()); active = document.body; key("Shift"); };

await tryCase("escape", async () => {
  reset();
  const opener = mk("button", { id: "open-it" }, "Open");
  document.body.appendChild(opener);
  opener.focus();
  const c = card();
  check("escape", focused() === c.box && c.box.getAttribute("tabindex") === "-1" && /outline:none/.test(c.box.style.cssText),
    { focus: focused().localName, tab: c.box.getAttribute("tabindex"), style: c.box.style.cssText });
  const r = key("Escape");
  check("escape", c.closed() === 1 && r.stopped && r.prevented && !c.box.isConnected, { closed: c.closed(), r });
  check("escape", focused() === opener, { focus: focused().localName });
  check("escape", K.held() === 0, K.held());
  // The one opened last, then the one under it.
  opener.focus();
  const low = card(), high = card();
  key("Escape");
  check("escape", high.closed() === 1 && low.closed() === 0, [low.closed(), high.closed()]);
  check("escape", focused() === low.box, focused().localName);
  key("Escape");
  check("escape", low.closed() === 1 && focused() === opener, [low.closed(), focused().localName]);
  // Pressed in an editor's field elsewhere: that field's. With nothing focused: the card's.
  const field = mk("input", { type: "text" });
  document.body.appendChild(field);
  const c2 = card({ take: false });
  field.focus();
  const r2 = key("Escape");
  check("escape", c2.closed() === 0 && !r2.stopped && !r2.prevented, r2);
  active = document.body;
  key("Escape");
  check("escape", c2.closed() === 1, c2.closed());
  // Someone took the key first: left alone.
  const c3 = card();
  key("Escape", { prevented: true });
  check("escape", c3.closed() === 0, c3.closed());
  // One that keeps its own Escape, over one that does not: neither is closed by this one.
  const own = card({ withClose: false });
  const r3 = key("Escape");
  check("escape", c3.closed() === 0 && !r3.stopped && !r3.prevented, r3);
  own.box.remove(); own.release();
  key("Escape");
  check("escape", c3.closed() === 1, c3.closed());
});

await tryCase("tab", async () => {
  reset();
  const opener = mk("button", {}, "Open");
  const behind = mk("button", {}, "Behind");
  document.body.append(opener, behind);
  opener.focus();
  const c = card({ modal: true });
  check("tab", focused() === c.box, focused().localName);
  // From the box, Tab goes on to its first control (the browser's own step).
  const r0 = key("Tab");
  check("tab", !r0.prevented, r0);
  c.b.focus();
  const r1 = key("Tab");
  check("tab", r1.prevented && focused() === c.x, { r1, at: focused().textContent });
  const r2 = key("Tab", { shift: true });
  check("tab", r2.prevented && focused() === c.b, { r2, at: focused().textContent });
  c.box.focus();
  key("Tab", { shift: true });
  check("tab", focused() === c.b, focused().textContent);
  // The focus somehow behind it: Tab brings it back in.
  behind.focus();
  const r3 = key("Tab");
  check("tab", r3.prevented && focused() === c.x, { r3, at: focused().textContent });
  // A hidden or disabled control is not a stop.
  c.x.disabled = true; c.b.style.display = "none";
  c.a.focus();
  key("Tab");
  check("tab", focused() === c.a, focused().textContent);
  c.close();
  check("tab", focused() === opener, focused().textContent);
  // Not modal: Tab is the page's.
  opener.focus();
  const n = card();
  n.b.focus();
  const r4 = key("Tab");
  check("tab", !r4.prevented && focused() === n.b, r4);
  n.close();
});

await tryCase("back", async () => {
  reset();
  // Replaced by a redraw while open: the same id, data-* attributes, or words.
  for (const [attrs, text, how] of [[{ id: "roomBtn" }, "Kitchen", "id"], [{ "data-room": "kitchen", "data-kind": "light" }, "Kitchen", "data"], [{}, "Atlas builder", "words"]]) {
    const host = mk("div");
    document.body.appendChild(host);
    const opener = mk("button", attrs, text);
    host.appendChild(opener);
    opener.focus();
    const c = card();
    host.replaceChildren(mk("button", {}, "Other"));
    const again = mk("button", attrs, text);
    host.appendChild(again);
    c.close();
    check("back", focused() === again, { how, at: focused().localName, text: focused().textContent });
    host.remove();
  }
  // Two controls with the same words: not clear which, so neither.
  const host = mk("div");
  document.body.appendChild(host);
  const opener = mk("button", {}, "Details");
  host.appendChild(opener);
  opener.focus();
  const c = card();
  host.replaceChildren(mk("button", {}, "Details"), mk("button", {}, "Details"));
  c.close();
  check("back", focused() === document.body, focused().localName);
  // A Rename on every row: the row (its data-* attributes) says which.
  const rowOf = (dev) => { const r = mk("div", { class: "dev-tag", "data-search": dev }); r.appendChild(mk("span", {}, dev)); r.appendChild(mk("button", {}, "Rename")); return r; };
  host.replaceChildren(rowOf("keys"), rowOf("alex phone"));
  const rename = host.children[1].children[1];
  rename.focus();
  const cr = card();
  host.replaceChildren(rowOf("keys"), rowOf("alex phone"));
  cr.close();
  check("back", focused() === host.children[1].children[1], { at: focused().localName, row: focused().parentNode && focused().parentNode.getAttribute && focused().parentNode.getAttribute("data-search") });
  // A press outside put the focus somewhere on purpose: it stays there.
  const o2 = mk("button", {}, "Open");
  const there = mk("button", {}, "There");
  host.replaceChildren(o2, there);
  o2.focus();
  const c2 = card();
  there.focus();
  c2.close();
  check("back", focused() === there, focused().textContent);
  // The caret of a text field drawn again.
  const field = mk("input", { type: "text", "data-filter": "rooms" });
  field.selectionStart = 3; field.selectionEnd = 3;
  host.replaceChildren(field);
  field.focus();
  const was = K.remember(field);
  const field2 = mk("input", { type: "text", "data-filter": "rooms" });
  let range = null;
  field2.setSelectionRange = (a, b) => { range = [a, b]; };
  host.replaceChildren(field2);
  check("back", K.refocus({ ...was, root: host }) && focused() === field2 && JSON.stringify(range) === "[3,3]", { range, at: focused().localName });
  host.remove();
});

await tryCase("gone", async () => {
  reset();
  // Taken off the page some other way: nothing is held.
  const c = card({ modal: true });
  c.box.remove();
  const r = key("Escape");
  check("gone", c.closed() === 0 && !r.stopped && K.held() === 0, { r, held: K.held() });
  // A drawer that stays on the page, closed another way (open() false).
  const box = mk("div");
  box.appendChild(mk("button", {}, "Menu item"));
  document.body.appendChild(box);
  let isOpen = true, closed = 0;
  K.holdKeys(box, { close: () => { closed++; }, modal: true, open: () => isOpen });
  isOpen = false;
  const outside = mk("button", {}, "Page");
  document.body.appendChild(outside);
  active = document.body;
  const r2 = key("Escape");
  outside.focus();
  const r3 = key("Tab");
  check("gone", closed === 0 && !r2.stopped && !r3.prevented && K.held() === 0, { closed, r2, r3, held: K.held() });
});

await tryCase("pressed", async () => {
  reset();
  // cursor is inherited, as in a browser.
  globalThis.getComputedStyle = (n) => { let c = ""; for (let p = n; p && !c; p = p.parentNode) c = (p.style && p.style.cursor) || ""; return { cursor: c, getPropertyValue: () => "" }; };
  const press = (t) => { for (const l of winL.filter((l) => l.t === "pointerdown" && l.cap)) l.fn({ type: "pointerdown", target: t, composedPath: () => [t] }); };
  const tile = mk("div", { class: "kpi" });
  tile.style.cursor = "pointer";
  const label = mk("span", {}, "PEOPLE IN BUILDING");
  tile.appendChild(label);
  document.body.appendChild(tile);
  press(label);
  const c = card({ modal: true });
  check("pressed", focused() === c.box, focused().localName);
  c.close();
  check("pressed", focused() === tile && tile.getAttribute("tabindex") === "-1" && /outline:none/.test(tile.style.cssText),
    { at: focused().localName + "." + focused().className, tab: tile.getAttribute("tabindex") });
  // A press inside the card is not what opened the next one.
  tile.removeAttribute("tabindex");
  active = document.body;
  const c2 = card();
  press(c2.a);
  const c3 = card();
  c3.close();
  check("pressed", focused() === c2.box, focused().localName);
  c2.close();
  // A press with no clickable thing (the page itself): nothing to give it back to.
  active = document.body;
  press(document.body);
  const c4 = card();
  c4.close();
  check("pressed", focused() === document.body, focused().localName);
});

// ── the flat Atlas's cards ───────────────────────────────────────────────────
const LM = await import(pathToFileURL(join(WWW, "views", "lights_map.js")).href);
const AB = await import(pathToFileURL(join(WWW, "views", "atlas_aboard.js")).href);
const overlays = () => document.body.children.filter((n) => n.localName === "div" && /position:fixed/.test(n.style.cssText));
async function opens(what, open) {
  reset();
  const opener = mk("button", { "data-room": what }, what);
  document.body.appendChild(opener);
  opener.focus();
  const before = overlays().length;
  const ret = open();
  await flush(2);
  const sheet = overlays().length - before;
  const inside = focused() !== opener && focused() !== document.body;
  const r = key("Escape");
  await flush(2);
  check("atlas", sheet === 1 && inside && r.stopped && overlays().length === before && focused() === opener,
    { what, sheet, inside, r, left: overlays().length, at: focused().localName + " " + focused().textContent });
  return ret;
}
const hass = {
  states: {
    "light.kitchen": { state: "on", attributes: { friendly_name: "Kitchen pots", brightness: 200, supported_color_modes: ["brightness"] } },
    "binary_sensor.garage_door": { state: "off", attributes: { friendly_name: "Garage door", device_class: "garage_door" } },
    "binary_sensor.bath_motion": { state: "off", attributes: { friendly_name: "Bath motion", device_class: "motion" } },
  },
  callService: async () => {}, callWS: async () => ({}), callApi: async () => [[]],
};
await tryCase("atlas", async () => {
  await opens("room sheet", () => LM.openAggregateSheet({ floodLatches: {}, doorInvertByEid: {}, controlsFor: () => null, toggle: async () => true },
    { title: "Kitchen", sub: "Lights 1/1", items: [], actions: [{ label: "All lights off", run() {} }] }));
  await opens("light card", () => LM.openControlCard(hass, "light.kitchen", {}));
  await opens("door card", () => LM.openBarrierCard(hass, { name: "Garage door", linked_entity_id: "binary_sensor.garage_door" }, {}));
  await opens("activity", () => { LM.openActivityCalendar(hass, "binary_sensor.bath_motion"); });
  // The Unlock question: Cancel has the focus; Escape is Cancel.
  reset();
  const opener = mk("button", {}, "Unlock");
  document.body.appendChild(opener);
  opener.focus();
  const asked = LM.confirmUnlock("Front door");
  check("atlas", focused().textContent === "Cancel", focused().textContent);
  key("Escape");
  check("atlas", (await asked) === false && overlays().length === 0 && focused() === opener, { at: focused().textContent });
  // A person's or a receiver's card on the flat map.
  reset();
  const dot = mk("button", { "data-live-key": "alex" }, "A");
  document.body.appendChild(dot);
  dot.focus();
  AB.showCard({ title: "Alex", lines: ["In Living Room"] }, null, document.body, "alex");
  check("atlas", !!AB.cardOpen() && focused() !== dot, AB.cardOpen());
  const r = key("Escape");
  check("atlas", !AB.cardOpen() && r.stopped && focused() === dot, { open: AB.cardOpen(), at: focused().textContent });
});

// ── panel.js's own modal ─────────────────────────────────────────────────────
function extractMethod(src, name) {
  const re = new RegExp(`^\\s{2}${name}\\s*\\(`, "m");
  const m = re.exec(src);
  if (!m) throw new Error(`could not find method ${name}() in panel.js: renamed? update this test`);
  const start = src.indexOf("{", src.indexOf(")", m.index));
  let depth = 0;
  for (let j = start; j < src.length; j++) {
    if (src[j] === "{") depth++;
    else if (src[j] === "}") { depth--; if (!depth) return src.slice(m.index, j + 1); }
  }
  throw new Error(`no end to ${name}()`);
}
await tryCase("modal", async () => {
  reset();
  const src = readFileSync(join(WWW, "panel.js"), "utf8");
  const methods = ["_openModal", "_closeModal"].map((n) => extractMethod(src, n)).join("\n");
  const el = (tag, attrs = {}, kids) => { const n = mk(tag, attrs); for (const c of [].concat(kids === undefined ? [] : kids)) n.appendChild(typeof c === "string" ? document.createTextNode(c) : c); return n; };
  const Host = new Function("el", "DIALOG_KEYS", "window", `return class { ${methods} };`)(el, K, globalThis);
  const p = new Host();
  p.$modal = mk("div", { id: "modal", class: "modal hidden" });
  const opener = mk("button", { id: "details" }, "Details");
  document.body.append(opener, p.$modal);
  opener.focus();
  const field = mk("input", { type: "text" });
  p._openModal("Kitchen beacon", field);
  const panel = p.$modal.children[0] && p.$modal.children[0].children[0];
  check("modal", focused() === panel, focused().localName + "." + focused().className);
  field.focus();
  const r = key("Tab");
  check("modal", r.prevented && focused().textContent === "Close", { r, at: focused().textContent });
  // Rename from inside it: a second modal replaces the first; closing it gives the focus to Details.
  p._openModal("Rename", mk("input", { type: "text" }));
  const r2 = key("Escape");
  check("modal", p.$modal.children.length === 0 && focused() === opener && !r2.stopped, { left: p.$modal.children.length, at: focused().textContent });
  check("modal", K.held() === 0, K.held());
});

console.log(JSON.stringify({ cases, failures }));
process.exit(0);
