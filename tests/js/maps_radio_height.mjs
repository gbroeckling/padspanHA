// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
//
// Mapping → Edit → Radios: the selected radio's height (2026-10-30). Drives
// the real view: the row shows the model's z_m, "Save height" sends exactly
// Calibration → Tune's Save Z command {type, source, z_m} and nothing else,
// publishes the acknowledged value to the model both places read, refreshes
// the model, and respects Tune's fabric-writer lock.

import { pathToFileURL } from "node:url";
import { join } from "node:path";
import { install, flush } from "./dom_shim.mjs";

const VIEWS_DIR = process.argv[2];
install(globalThis);

const results = {};
const check = (name, ok, detail) => { results[name] = { ok: !!ok, detail: ok ? undefined : detail }; };

function el(tag, attrs = {}, children = []) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (k === "class") n.className = v;
    else if (k === "style") n.setAttribute("style", v);
    else if (k.startsWith("on") && typeof v === "function") n.addEventListener(k.slice(2), v);
    else if (v !== undefined && v !== null) n.setAttribute(k, String(v));
  }
  for (const c of (Array.isArray(children) ? children : [children])) {
    if (c === null || c === undefined) continue;
    n.appendChild(typeof c === "string" || typeof c === "number" ? document.createTextNode(String(c)) : c);
  }
  return n;
}
const quiet = () => new Proxy(() => document.createElement("span"), {
  get: (_t, k) => (k === "then" ? undefined : k === Symbol.toPrimitive || k === "toString" ? () => "" : quiet()),
  apply: () => document.createElement("span"),
});

const RX = [
  { id: "rx_a", label: "Kitchen proxy", x: 0.25, y: 0.5, room: "Kitchen", source: "aa:bb:cc:dd:ee:01" },
  { id: "rx_b", label: "New one", x: 0.75, y: 0.5, room: "", source: "aa:bb:cc:dd:ee:02" },
];

function makeCtx(calls, opts = {}) {
  const state = {
    complexity: "advanced", mapsTab: "edit", settings: {}, dataMode: "live", view: "maps",
    activeMapId: "m1",
    maps: { list: [{ id: "m1", name: "Main floor", floor_id: "main", image: { width: 800, height: 600, sha256: "s1" },
      receivers: JSON.parse(JSON.stringify(RX)), room_bounds: {} }] },
    model: {
      floors: [{ id: "main", name: "Main", level: 0 }], map_transforms: {},
      scanner_positions_m: { "aa:bb:cc:dd:ee:01": { x_m: 3, y_m: 4, z_m: 2.4, floor_id: "main" } },
    },
  };
  if (opts.calibTune) state._calibTune = opts.calibTune;
  const actions = {
    setMapsTab: (t) => { state.mapsTab = t; },
    callWS: async (p) => { calls.push(["callWS", p]); return opts.wsResult !== undefined ? opts.wsResult : { ok: true }; },
    wsCall: async (t, d) => { calls.push(["wsCall", t, d]); return {}; },
    modelRefresh: async () => { calls.push(["modelRefresh"]); },
    mapsRefresh: async () => { calls.push(["mapsRefresh"]); },
    mapsRefreshQuiet: async () => { calls.push(["mapsRefresh"]); },
    mapsUpdateQuiet: async () => { calls.push(["mapsUpdate"]); },
  };
  return {
    state,
    hass: { states: {} },
    helpers: new Proxy({ el, esc: (s) => String(s ?? ""), helpBtn: () => el("button", {}, "?"),
      mapImageUrl: () => "/x.png", pill: (t) => el("span", {}, String(t ?? "")), roomColor: () => "#52b788" },
      { get: (t, k) => (k in t ? t[k] : quiet()) }),
    actions: new Proxy(actions, { get: (t, k) => (k in t ? t[k] : quiet()) }),
    toast: (m, isErr) => calls.push(["toast", String(m), !!isErr]),
  };
}

function find(node, pred) {
  if (pred(node)) return node;
  for (const c of node.childNodes || []) { const hit = find(c, pred); if (hit) return hit; }
  return null;
}
const textOf = (n) => (n.textContent || "").trim();
// flush() returns at once when nothing is queued; a click's awaits need real turns.
const settle = async () => { await flush(); for (let i = 0; i < 5; i++) await new Promise(r => globalThis._realSetTimeout(r, 0)); };

const maps = await import(pathToFileURL(join(VIEWS_DIR, "maps.js")).href);

async function open(ctx, rxId) {
  maps.render(ctx); await flush();              // seeds the drafts (and clears the selection)
  ctx.state.maps._mode = "receivers";
  ctx.state.maps._selectedRxId = rxId;
  const root = maps.render(ctx); await flush();
  return root;
}
const heightRow = (root) => find(root, (n) => n.getAttribute && n.getAttribute("data-rx-height"));
const saveBtn = (root) => find(root, (n) => n.tagName === "BUTTON" && textOf(n) === "Save height");
const input = (row) => find(row, (n) => n.tagName === "INPUT");

// 1. A positioned radio shows its height and saves it with Tune's command.
{
  const calls = [];
  const ctx = makeCtx(calls);
  let root = null;
  try { root = await open(ctx, "rx_a"); }
  catch (e) { check("Edit → Radios renders", false, String(e && e.stack || e)); }
  const row = root && heightRow(root);
  check("the selected radio has a height row", row && row.getAttribute("data-rx-height") === "aa:bb:cc:dd:ee:01", row && row.getAttribute("data-rx-height"));
  const inp = row && input(row);
  check("the height row shows the model's z_m", inp && inp.value === "2.4", inp && inp.value);
  check("same limits as Tune (0–100, step 0.1)",
    inp && inp.getAttribute("min") === "0" && inp.getAttribute("max") === "100" && inp.getAttribute("step") === "0.1",
    inp && [inp.getAttribute("min"), inp.getAttribute("max"), inp.getAttribute("step")]);
  check("the label is metres", row && /Height above floor \(m\)/.test(textOf(row)), row && textOf(row));
  const btn = root && saveBtn(root);
  check("the button says Save height", !!btn);
  const posBefore = JSON.stringify({ ...ctx.state.model.scanner_positions_m["aa:bb:cc:dd:ee:01"], z_m: undefined });
  const draftBefore = JSON.stringify(ctx.state.maps._draftReceivers);
  if (inp && btn) {
    inp.value = "1.234";
    btn.click(); await settle();
    const ws = calls.filter(c => c[0] === "callWS" || c[0] === "wsCall");
    check("one write, Tune's Save Z command and payload exactly",
      ws.length === 1 && ws[0][0] === "callWS"
      && JSON.stringify(ws[0][1]) === JSON.stringify({ type: "padspan_ha/fabric_scanner_z_set", source: "aa:bb:cc:dd:ee:01", z_m: 1.234 }), ws);
    const p = ctx.state.model.scanner_positions_m["aa:bb:cc:dd:ee:01"];
    check("the acknowledged height is in the model Calibration reads (rounded like the backend)", p && p.z_m === 1.23, p);
    check("the position is untouched", JSON.stringify({ ...p, z_m: undefined }) === posBefore, p);
    check("the map draft is untouched", JSON.stringify(ctx.state.maps._draftReceivers) === draftBefore);
    check("the model is refreshed after the save", calls.some(c => c[0] === "modelRefresh"), calls);
    check("no layout save, no maps write", !calls.some(c => c[0] === "mapsUpdate"), calls);
    check("a success toast", calls.some(c => c[0] === "toast" && /height set to 1\.234 m/.test(c[1]) && !c[2]), calls);
  }
  // 2. A value Calibration saved shows here on the next render.
  ctx.state.model.scanner_positions_m["aa:bb:cc:dd:ee:01"].z_m = 0.8;
  const root2 = maps.render(ctx); await flush();
  const inp2 = input(heightRow(root2));
  check("a height saved elsewhere shows on the next render", inp2 && inp2.value === "0.8", inp2 && inp2.value);
}

// 3. Out of range: refused, nothing sent.
{
  const calls = [];
  const ctx = makeCtx(calls);
  const root = await open(ctx, "rx_a");
  const inp = input(heightRow(root));
  for (const bad of ["-1", "101", "abc"]) {
    inp.value = bad;
    saveBtn(root).click(); await settle();
  }
  check("out-of-range heights are refused and nothing is sent",
    !calls.some(c => c[0] === "callWS") && calls.filter(c => c[0] === "toast" && /0.100 m/.test(c[1]) && c[2]).length === 3, calls);
  check("a refused height leaves the model alone", ctx.state.model.scanner_positions_m["aa:bb:cc:dd:ee:01"].z_m === 2.4);
}

// 4. A radio with no fabric position has no height control.
{
  const calls = [];
  const ctx = makeCtx(calls);
  const root = await open(ctx, "rx_b");
  const row = heightRow(root);
  check("no fabric position: a hint, no input and no Save height",
    row && row.getAttribute("data-rx-height") === "none" && !input(row) && !saveBtn(root), row && textOf(row));
}

// 5. Tune's fabric-writer lock is shared, and released after.
{
  const calls = [];
  const ts = { _tuneBusy: true };
  const ctx = makeCtx(calls, { calibTune: ts });
  const root = await open(ctx, "rx_a");
  saveBtn(root).click(); await settle();
  check("while Tune is saving, Save height waits", !calls.some(c => c[0] === "callWS")
    && calls.some(c => c[0] === "toast" && /in progress/.test(c[1]) && c[2]), calls);
  ts._tuneBusy = false;
  saveBtn(root).click(); await settle();
  check("then it saves and releases the lock", calls.some(c => c[0] === "callWS") && ts._tuneBusy === false, [ts._tuneBusy, calls]);
}

// 6. A refusal from the backend changes nothing locally.
{
  const calls = [];
  const ctx = makeCtx(calls, { wsResult: { ok: false } });
  const root = await open(ctx, "rx_a");
  input(heightRow(root)).value = "3";
  saveBtn(root).click(); await settle();
  check("a refused save keeps the old height and says so",
    ctx.state.model.scanner_positions_m["aa:bb:cc:dd:ee:01"].z_m === 2.4
    && calls.some(c => c[0] === "toast" && /not stored/.test(c[1]) && c[2]), calls);
}

console.log(JSON.stringify(results));
