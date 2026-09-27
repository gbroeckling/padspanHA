// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
//
// What the 3D Stack tab's per-map row Save actually sends.
//
// Every row of "Floor Assignment & Ceiling Heights" has a Save. It used to
// write that MAP's Stack Level onto the FLOOR as the floor's storey
// (fabric_floor_elevations_set {id, level}). A stored level outranks the HA
// registry's, so on an install whose registry levels are null one Save could
// put two floors on one slab. This renders the real tab, clicks every row's
// Save exactly as it is drawn, and prints every call those clicks made, so
// the Python side can replay them into a real ModelStore.
//
// Run:  node tests/js/stack_row_save.mjs <views dir> <fixture.json>
// Prints one JSON line: { rows: [...], calls: [{row, action, args}], errors: [...] }.
import fs from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { install, flush } from "./dom_shim.mjs";

const VIEWS_DIR = process.argv[2];
const FIX = JSON.parse(fs.readFileSync(process.argv[3], "utf8"));

install(globalThis);

function el(tag, attrs = {}, children = []) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (k === "class") n.className = v;
    else if (k === "id") n.id = v;
    else if (k === "style") n.setAttribute("style", v);
    else if (k.startsWith("on") && typeof v === "function") n.addEventListener(k.slice(2), v);
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
const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;")
  .replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// Anything the tab asks for that this harness does not model answers with a
// node, the same way tests/js/render_smoke.mjs does it.
function recorder() {
  const fn = () => document.createElement("span");
  return new Proxy(fn, {
    get(_t, k) {
      if (k === Symbol.toPrimitive || k === "toString") return () => "";
      if (k === "then") return undefined;
      return recorder();
    },
    apply() { return fn(); },
  });
}

// EVERY action is recorded — the point is to see all of what a Save sends,
// not only the calls this harness already expects.
const calls = [];
let currentRow = null;
const actions = new Proxy({}, {
  get: (_t, k) => (...args) => {
    calls.push({ row: currentRow, action: String(k), args: JSON.parse(JSON.stringify(args)) });
    return Promise.resolve({});
  },
});

const ctx = {
  hass: { states: {}, connection: { sendMessagePromise: async () => ({}) } },
  state: {
    view: "maps", mapsTab: "stack", settings: {}, _ctx: {},
    maps: { list: FIX.maps },
    model: FIX.model,
  },
  helpers: new Proxy({ el, esc, helpBtn: () => el("button", {}, "?") },
    { get: (t, k) => (k in t ? t[k] : recorder()) }),
  actions,
  toast: () => {},
};

const errors = [];
const { render } = await import(pathToFileURL(join(VIEWS_DIR, "maps.js")).href);
const root = render(ctx);
await flush();
calls.length = 0;   // only what the clicks send

// A row of the Floor Assignment table: it has the HA-floor <select> and a
// button reading exactly "Save" ("Save Floor Heights" is the other table).
const rows = [];
for (const tr of root.querySelectorAll("tr")) {
  const sel = tr.querySelector("select");
  const btn = tr.querySelectorAll("button").find(b => b.textContent === "Save");
  if (!sel || !btn) continue;
  const name = tr.children[0]?.textContent || "";
  rows.push(name);
  currentRow = name;
  try {
    // The handler is async; await it rather than dispatching and hoping.
    for (const fn of (btn._listeners.click || [])) {
      await fn({ type: "click", stopPropagation() {}, preventDefault() {} });
    }
    await flush();
  } catch (err) {
    errors.push({ row: name, error: String(err && err.message || err) });
  }
}

console.log(JSON.stringify({ rows, calls, errors }));
