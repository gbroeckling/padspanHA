// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
//
// A clickable <span> is worked from the keyboard. The views are rendered with
// panel.js's own el() and asButton (read out of panel.js, so this is the code
// the views are really handed), and every span a view marks as a button is
// then clicked, given Enter, and given Space: each must do the same thing.
// "The same thing" is read off what the handler did: the actions it called,
// the view and filters it set, and what it showed or hid beside itself.
// Radio QA, Monitor, Presence, Devices (By Room's list and the Registry's
// rows) and Mapping are rendered here; the pytest wrapper is
// tests/test_keyboard_buttons.py.
//
// Run:  node tests/js/keyboard_buttons.mjs <www-dir>
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { join } from "node:path";
import { install, flush } from "./dom_shim.mjs";

const WWW = process.argv[2];
const VIEWS_DIR = join(WWW, "views");
install(globalThis);

const src = readFileSync(join(WWW, "panel.js"), "utf-8").replace(/\r\n/g, "\n");
const cut = (from, to) => {
  const a = src.indexOf(from);
  if (a < 0) throw new Error("not in panel.js: " + from);
  return src.slice(a, src.indexOf(to, a) + to.length);
};
const { el, asButton } = new Function(
  cut("function el(tag, attrs={}, children=[]){", "\n}\n") + cut("const asButton = Object.freeze({", "\n});\n") + "return { el, asButton };")();

const results = {};
const check = (name, ok, detail) => { results[name] = { ok: !!ok, detail: ok ? undefined : detail }; };

// It adds a role, a tab stop and a key handler, and nothing a person sees: no class, no style.
check("asButton: a role, a tab stop and a key handler, nothing else",
  JSON.stringify(Object.keys(asButton).sort()) === '["onkeydown","role","tabindex"]' && asButton.role === "button" && asButton.tabindex === "0"
  && typeof asButton.onkeydown === "function", Object.keys(asButton));

// ── the context a view is handed ─────────────────────────────────────────────
const quiet = () => new Proxy(() => document.createElement("span"), {
  get: (_t, k) => (k === "then" ? undefined : k === Symbol.toPrimitive || k === "toString" ? () => "" : quiet()),
  apply: () => document.createElement("span"),
});

const OBJECTS = () => [
  { key: "ble:AA:BB:CC:DD:EE:01", address: "AA:BB:CC:DD:EE:01", kind: "ble", name: "Phone", user_label: "Sam's phone",
    identified: true, room: "Kitchen", room_confidence: 0.8, rssi: -62, age_s: 3, all_addresses: ["AA:BB:CC:DD:EE:01"],
    sources: [{ source: "AA:01", rssi: -62, age_s: 3 }] },
  { key: "ble:AA:BB:CC:DD:EE:02", address: "AA:BB:CC:DD:EE:02", kind: "ble", name: "Watch", room: "Attic", room_confidence: 0.5,
    rssi: -70, age_s: 5, all_addresses: ["AA:BB:CC:DD:EE:02"], sources: [{ source: "AA:02", rssi: -70, age_s: 5 }] },
];
const RADIOS = () => [{ source: "AA:01", name: "kitchen-esp", area_name: "Kitchen" }, { source: "AA:02", name: "upper-esp", area_name: "Kitchen" }];

function makeCtx(over = {}) {
  const calls = [];
  const state = {
    view: "qa", dataMode: "live", _dataModeKnown: true, complexity: "advanced", timing: {}, wsCounts: {},
    settings: { data_mode: "live", followed_addrs: [], hidden_map_ids: [] },
    model: { floors: [{ id: "main", name: "Main", level: 0 }], areas: [{ name: "Kitchen", floor_id: "main" }, { name: "Den", floor_id: "main" }],
      room_geometry_m: {}, map_transforms: {} },
    // One receiver is on the plan (AA:01); the other is on no map.
    maps: { list: [{ id: "m1", name: "Main", floor_id: "main", image: { width: 800, height: 600 }, receivers: [{ id: "r1", source: "AA:01" }], room_bounds: {} }] },
    roomTagMap: { Kitchen: [], Den: [] },
    live: { snapshot: {
      rooms: [{ name: "Kitchen" }, { name: "Den" }],
      rooms_discovered: ["Kitchen", "Den"],   // Den has no receiver and nobody in it; "Attic" (the Watch's room) is not a room
      tags: [],
      radios: RADIOS(),
      objects: { list: OBJECTS(), summary: { total: 2, ble: 2, identified: 1, unidentified: 1 } },
      ble: {
        radios: RADIOS(),
        advertisements: [
          { address: "AA:BB:CC:DD:EE:01", source: "AA:01", rssi: -62, age_s: 2, name: "Phone" },
          { address: "AA:BB:CC:DD:EE:01", source: "AA:02", rssi: -75, age_s: 2, name: "Phone" },
          { address: "AA:BB:CC:DD:EE:02", source: "AA:02", rssi: -70, age_s: 2, name: "Watch" },
          { address: "AA:BB:CC:DD:EE:02", source: "AA:01", rssi: -80, age_s: 2, name: "Watch" },
        ],
      },
      data_mode: "live",
    } },
    ...over,
  };
  const brief = (x) => (x && typeof x === "object" ? x.address || x.source || x.name || "{}" : x);
  const actions = new Proxy({
    wsCall: async () => ({}), followedHas: () => false,
    callWS: async (msg) => (msg && msg.type === "padspan_ha/device_registry_list"
      ? { devices: { p1: { padspan_id: "p1", label: "Phone", identities: [] } } } : {}),
  }, { get: (t, k) => (k in t ? t[k] : (...a) => { calls.push([String(k), a.map(brief)]); }) });
  const helpers = new Proxy({
    el, asButton, esc: (s) => String(s ?? ""), pill: (t) => el("span", {}, String(t ?? "")), helpBtn: () => el("button", {}, "?"),
    radioShortId: (s) => String(s || "").slice(-2), radioName: () => "", roomColor: () => "#52b788", mapImageUrl: () => "/x.png",
    scannerStatus: () => "ok", isAway: () => false, awayTimeoutS: () => 120, isScanner: () => false, scannerAddrs: () => new Set(), HELP: {},
  }, { get: (t, k) => (k in t ? t[k] : quiet()) });
  return { state, calls, hass: { states: {}, user: { is_admin: true } }, helpers, actions, toast: () => {} };
}

// ── finding and pressing ─────────────────────────────────────────────────────
function walk(node, visit) { visit(node); for (const c of node.childNodes || []) walk(c, visit); }
const buttonSpans = (root) => {
  const out = [];
  walk(root, (n) => { if (n.localName === "span" && n.getAttribute && n.getAttribute("role") === "button") out.push(n); });
  return out;
};
const key = (node, k, more = {}) => {
  const e = { type: "keydown", key: k, target: node, currentTarget: node, repeat: false, prevented: false,
    preventDefault() { this.prevented = true; }, stopPropagation() {}, ...more };
  node.dispatchEvent(e);
  return e;
};
// What a press did; reading it puts the screen back as it was for the next press.
const KEYS = ["view", "objKind", "objStatus", "objSearch", "mapsTab"];
function watch(ctx, node) {
  const sibs = node.parentNode ? [...node.parentNode.children] : [];
  const before = { state: KEYS.map(k => ctx.state[k]), shown: sibs.map(s => s.style.display) };
  return () => {
    const did = JSON.stringify({ calls: ctx.calls, state: KEYS.map(k => ctx.state[k]), shown: sibs.map(s => s.style.display) });
    ctx.calls.length = 0;
    KEYS.forEach((k, i) => { if (before.state[i] === undefined) delete ctx.state[k]; else ctx.state[k] = before.state[i]; });
    sibs.forEach((s, i) => { s.style.display = before.shown[i]; });
    return did;
  };
}

const seen = {};
async function press(view, ctx, root, want) {
  await flush();
  await new Promise(r => globalThis._realSetTimeout(r, 0));
  ctx.calls.length = 0;   // what drawing the view called is not a press
  const nodes = buttonSpans(root);
  seen[view] = nodes.map(n => (n.textContent || "").trim());
  check(`${view}: its clickable spans are there`, nodes.length >= want.length && want.every(w => seen[view].some(t => t.includes(w))), seen[view]);
  for (const [i, n] of nodes.entries()) {
    const name = `${view} #${i} "${(n.textContent || "").trim()}"`;
    const done = watch(ctx, n);
    const nothing = done();
    n.click();
    const byClick = done();
    const enter = key(n, "Enter");
    const byEnter = done();
    const space = key(n, " ");
    const bySpace = done();
    check(`${name}: a click does something`, byClick !== nothing, byClick);
    check(`${name}: Enter and Space do what the click does`, byEnter === byClick && bySpace === byClick, { byClick, byEnter, bySpace });
    check(`${name}: Tab reaches it, and it is announced as a button`, n.getAttribute("tabindex") === "0" && n.getAttribute("role") === "button",
      [n.getAttribute("tabindex"), n.getAttribute("role")]);
    check(`${name}: the key is taken (Space does not scroll the page)`, enter.prevented && space.prevented, [enter.prevented, space.prevented]);
    const other = key(n, "a"); const byOther = done();
    const held = key(n, "Enter", { repeat: true }); const byHeld = done();
    const inside = key(n, "Enter", { target: document.createElement("b") }); const byInside = done();
    check(`${name}: another key, a held key, or a key pressed inside something else does nothing`,
      byOther === nothing && byHeld === nothing && byInside === nothing && !other.prevented && !held.prevented && !inside.prevented,
      { nothing, byOther, byHeld, byInside });
  }
  return nodes.length;
}

const load = async (file) => import(pathToFileURL(join(VIEWS_DIR, file)).href);
let total = 0;

// Radio QA: the health check's "Go", the lists of names (devices in a room that isn't one, receivers on no map,
// rooms with no receiver), and a receiver's name in its row.
{
  const ctx = makeCtx({ view: "qa", maps: { list: [] } });   // no floor plan: that check fails, and offers "Go"
  const root = (await load("qa.js")).render(ctx);
  total += await press("qa", ctx, root, ["Go", "Watch", "upper-esp", "Den", "kitchen-esp"]);
}
// Monitor: the unidentified count; on Insights, empty rooms and receivers on no map.
{
  const ctx = makeCtx({ view: "monitor" });
  const root = (await load("monitor.js")).render(ctx);
  total += await press("monitor", ctx, root, ["1 unidentified"]);
}
{
  const ctx = makeCtx({ view: "monitor", _monitorTab: "insights" });
  const root = (await load("monitor.js")).render(ctx);
  total += await press("monitor insights", ctx, root, ["Den", "upper-esp"]);
}
// Presence: a device's name opens its details.
{
  const ctx = makeCtx({ view: "presence" });
  const root = (await load("presence.js")).render(ctx);
  total += await press("presence", ctx, root, ["Sam's phone", "Watch"]);
}
// Devices → By Room: the badges that filter the list.
{
  const ctx = makeCtx({ view: "objects" });
  const root = (await load("objects.js")).render(ctx);
  total += await press("objects", ctx, root, ["2 BLE", "1 unidentified"]);
}
// Devices → Registry: "+ Add Identity" under a device shows and hides its row.
{
  const ctx = makeCtx({ view: "devices", _devicesTab: "registry" });
  const root = (await load("devices.js")).render(ctx);
  total += await press("devices", ctx, root, ["+ Add Identity"]);
}
// Mapping with no floor plan: "Go to the Upload tab".
{
  const ctx = makeCtx({ view: "maps", mapsTab: "library", maps: { list: [] } });
  const root = (await load("maps.js")).render(ctx);
  total += await press("maps", ctx, root, ["Go to the Upload tab"]);
}

// Live Tracker draws with Preact: its locate target takes the same attributes through its template
// (views/purelive.js: <span ...${ctx.helpers.asButton} className="pl-tracked-locate" …>). Drawn the same way here.
{
  const { render, html } = await import(pathToFileURL(join(WWW, "lib", "preact-bundle.js")).href);
  // A browser's elements have these; Preact reads them to name the event.
  globalThis.Node.prototype.onclick = null; globalThis.Node.prototype.onkeydown = null;
  let flown = 0;
  const ctx = { helpers: { asButton } }, d = { label: "Keys" };
  const host = document.createElement("div");
  render(html`<div><span ...${ctx.helpers.asButton} className="pl-tracked-locate" title="Center camera on ${d.label}"
    onClick=${(e) => { e.stopPropagation(); flown++; }}>🎯</span></div>`, host);
  const span = host.children[0].children[0];
  // Preact's listeners read the element as `this`.
  const fire = (type, props = {}) => { for (const f of span._listeners[type] || []) f.call(span, { type, target: span, currentTarget: span, preventDefault() {}, stopPropagation() {}, ...props }); };
  span.click = () => fire("click");
  span.click(); const byClick = flown;
  fire("keydown", { key: "Enter" }); const byEnter = flown - byClick;
  fire("keydown", { key: " " }); const bySpace = flown - byClick - byEnter;
  fire("keydown", { key: "a" });
  check("purelive template: Enter and Space do what the click does, another key nothing",
    byClick === 1 && byEnter === 1 && bySpace === 1 && flown === 3, { byClick, byEnter, bySpace, flown });
  check("purelive template: Tab reaches it, announced as a button, its class kept",
    span.getAttribute("role") === "button" && span.getAttribute("tabindex") === "0" && span.className === "pl-tracked-locate", [span.attributes, span.className]);
}

results._seen = { ok: true, seen, total };
process.stdout.write(JSON.stringify(results) + "\n", () => process.exit(0));
