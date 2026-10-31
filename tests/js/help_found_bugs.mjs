// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
//
// Five bugs found while auditing the help (2026-10-31), RUN rather than read:
//   events      Manage → Events: its room log read state.followHistory, which
//               nothing writes; now a line and Open History → Movement
//   health      Health → Live Discovery "Radios": the sample house's snapshot
//               has only ble.radios, so Sample read 0
//   diag        Diagnostics counted the snapshot's top-level keys as devices;
//               now your own devices (Monitor's _isMine: "a name or a room"
//               let every passing device in), phones' IRKs hidden there and
//               in Monitor → Export for support, and the screen says what the
//               report names
//   offset      Bluetooth → Scanners "RSSI offset": ±20 like the rest; a stored
//               value outside it is shown and kept, only new edits are held in.
//               Settings → Tracking → Receivers and the Receivers page clamped
//               a stored value on Save even unedited: now the same rule
//   compare     Mapping → Library "Compare Maps" threw on a visible plan with
//               rooms but no placement
// The pytest wrapper is tests/test_help_found_bugs.py.
//
// Run:  node tests/js/help_found_bugs.mjs <repo-root>
import { pathToFileURL } from "node:url";
const ROOT = process.argv[2];
const { install, flush } = await import(pathToFileURL(ROOT + "/tests/js/dom_shim.mjs").href);
install(globalThis);
const V = ROOT + "/custom_components/padspan_ha/www/padspan-ha/";
const imp = (n) => import(pathToFileURL(V + n).href);
const MAN = await imp("views/manage.js"), HEALTH = await imp("views/health.js"), DIAG = await imp("views/diagnostics.js");
const BT = await imp("views/bluetooth.js"), MAPS = await imp("views/maps.js");
const SET = await imp("views/settings.js"), RX = await imp("views/receivers.js"), MON = await imp("views/monitor.js");
const { SAMPLE_SNAPSHOT } = await imp("sample_data.js");

const results = {};
const check = (name, ok, detail) => { results[name] = { ok: !!ok, detail: ok ? undefined : detail }; };
const attempt = (name, fn) => { try { return fn(); } catch (e) { check(name, false, "threw: " + (e && e.stack || e)); return null; } };

function el(tag, attrs = {}, children = []) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (k === "class") n.className = v; else if (k === "id") n.id = v; else if (k === "style") n.setAttribute("style", v);
    else if (k === "value") { n.value = v; n.setAttribute(k, String(v)); }
    else if (k.startsWith("on") && typeof v === "function") n.addEventListener(k.slice(2), v);
    else if (v !== undefined && v !== null) n.setAttribute(k, String(v));
  }
  if (!Array.isArray(children)) children = [children];
  for (const c of children) { if (c == null) continue; n.appendChild(typeof c === "string" || typeof c === "number" ? document.createTextNode(String(c)) : c); }
  return n;
}
const quiet = () => new Proxy(() => document.createElement("span"), {
  get: (_t, k) => (k === "then" ? undefined : (k === Symbol.toPrimitive || k === "toString") ? () => "" : quiet()),
  apply: () => document.createElement("span"),
});
const all = (n, out = []) => { for (const c of (n.childNodes || n.children || [])) { out.push(c); all(c, out); } return out; };
const text = (n) => (n.textContent || "").replace(/\s+/g, " ").trim();
const attr = (root, a, v) => all(root).find(n => n.getAttribute && n.getAttribute(a) !== null && (v === undefined || n.getAttribute(a) === v)) || null;
const tagged = (root, t) => all(root).filter(n => (n.tagName || "").toUpperCase() === t);
const button = (root, label) => tagged(root, "BUTTON").find(n => text(n).includes(label)) || null;

function makeCtx(state, calls = [], actionsExtra = {}) {
  const s = Object.assign({
    dataMode: "live", _dataModeKnown: true, complexity: "advanced", view: "manage", version: "0", buildId: "b",
    settings: { tier: "pro", edition: "full" }, followedAddrs: new Set(), timing: {}, roomTagMap: {}, wsCounts: {},
    model: { floors: [{ id: "main", name: "Main" }], areas: [], room_meta: {}, room_geometry_m: {}, map_transforms: {} },
    maps: { list: [] },
    live: { snapshot: { ble: { radios: [] }, objects: { list: [], summary: {} }, tags: [] } },
  }, state);
  const actions = Object.assign({
    renderRooms: () => calls.push(["renderRooms"]), renderNav: () => calls.push(["renderNav"]),
    showView: (id) => { calls.push(["showView", id]); s.view = id; },
    setMapsTab: (t) => { s.mapsTab = t; }, mapsSetActive: (id) => { s.activeMapId = id; },
    settingsSet: async (p) => ({ settings: Object.assign(s.settings, p) }),
    callWS: async () => ({}), wsCall: async () => ({}), openModal: () => {}, closeModal: () => {},
    telemetryEvent: () => {}, objectLabelList: async () => ({}), canOpen: () => true, calibrationGet: async () => ({}),
    followedHas: () => false,
  }, actionsExtra);
  const helpers = new Proxy({ el, esc: (x) => String(x ?? ""), helpBtn: () => el("button", {}, "?"), radioShortId: (x) => String(x || ""),
    isScanner: () => false, roomColor: () => "#fff", pill: (t) => el("span", {}, String(t ?? "")), HELP: {}, mapImageUrl: () => "/x.png" },
    { get: (t, k) => (k in t ? t[k] : quiet()) });
  return new Proxy({ hass: { states: {}, user: { is_admin: true }, connection: { sendMessagePromise: async () => ({}) } },
    state: s, helpers, actions: new Proxy(actions, { get: (t, k) => (k in t ? t[k] : quiet()) }),
    toast: (m, err) => calls.push(["toast", String(m), !!err]) }, { get: (t, k) => (k in t ? t[k] : quiet()) });
}

// ── 1. Manage → Events ───────────────────────────────────────────────────────
{
  const calls = [];
  const ctx = makeCtx({ manageTab: "events" }, calls);
  const root = attempt("events: renders", () => MAN.render(ctx));
  if (root) {
    check("events: no session room log that nothing feeds", !/Session event log|No events recorded yet|Room Transitions/.test(text(root)), text(root).slice(0, 300));
    const card = attr(root, "data-manage-events-history");
    const b = card && button(card, "Open History");
    if (b) b.dispatchEvent(new Event("click"));
    check("events: Open History opens History → Movement",
      !!b && ctx.state.view === "history" && ctx.state._historyTab === "movement", [!!card, ctx.state.view, ctx.state._historyTab]);
  }
}

// ── 2. Health → Live Discovery, Sample mode ──────────────────────────────────
{
  const radiosLine = (snapshot) => {
    const root = HEALTH.render(makeCtx({ view: "health", dataMode: "sample", live: { snapshot } }));
    return (all(root).map(text).find(t => /^Radios: \d+$/.test(t)) || "");
  };
  const n = SAMPLE_SNAPSHOT.ble.radios.length;
  check("health: Sample's snapshot counts its receivers", radiosLine(SAMPLE_SNAPSHOT) === `Radios: ${n}`, radiosLine(SAMPLE_SNAPSHOT));
  check("health: Live's top-level radios still win", radiosLine({ radios: [{}, {}], ble: { radios: [{}] } }) === "Radios: 2",
    radiosLine({ radios: [{}, {}], ble: { radios: [{}] } }));
}

// ── 3. Diagnostics ───────────────────────────────────────────────────────────
{
  const stale = { key: "ble:00:00:00:00:00:01", kind: "ble", address: "00:00:00:00:00:01", user_label: "Old tag", identified: true, age_s: 90000,
    sources: [{ source: "kit", rssi: -70, age_s: 90000 }] };
  // Shaped as the server sends a device that isn't yours: named by its address
  // when it advertises no name (snapshot_builder.py), and given the room of its
  // loudest receiver like every device heard.
  const passing = { key: "ble:11:22:33:44:55:66", kind: "ble", address: "11:22:33:44:55:66", name: "11:22:33:44:55:66", room: "Kitchen",
    identified: false, age_s: 4, sources: [{ source: "kit", rssi: -88, age_s: 4 }] };
  const neighbour = { key: "ble:22:33:44:55:66:77", kind: "ble", address: "22:33:44:55:66:77", name: "Neighbour TV", room: "Garage",
    identified: false, age_s: 9, sources: [{ source: "kit", rssi: -91, age_s: 9 }] };
  const snapshot = Object.assign({}, SAMPLE_SNAPSHOT, { objects: Object.assign({}, SAMPLE_SNAPSHOT.objects,
    { list: [...SAMPLE_SNAPSHOT.objects.list, stale, passing, neighbour] }) });
  const root = DIAG.render(makeCtx({ view: "diagnostics", live: { snapshot }, maps: { list: [] } }));
  const ta = tagged(root, "TEXTAREA")[0];
  const report = JSON.parse(ta.value);
  const devs = report.snapshot.devices || {};
  check("diag: devices come from objects.list", "ble:CC:DD:EE:33:44:55" in devs && "entity:device_tracker.alice_phone" in devs
    && devs["ble:CC:DD:EE:33:44:55"].user_label === "Car Keys", Object.keys(devs));
  check("diag: no snapshot section counted as a device", !("ble" in devs) && !("objects" in devs) && !("floor_plan" in devs), Object.keys(devs));
  check("diag: devices that aren't yours, even named and in a room, and >24 h devices left out",
    !("ble:D2:5A:7F:0B:93:4E" in devs) && !(stale.key in devs) && !(passing.key in devs) && !(neighbour.key in devs), Object.keys(devs));
  const total = snapshot.objects.list.length, kept = Object.keys(devs).length;
  check("diag: the counts are devices", report.snapshot._summary.startsWith(`${kept} of ${total} devices`) && kept >= 8
    && all(root).some(n => text(n).startsWith(`${kept} devices ·`)), [report.snapshot._summary, kept, total]);
  // A phone's IRK lets whoever has it follow the phone: never in the report.
  check("diag: no phone's IRK in the report", !/irk:[0-9a-f]{32}/i.test(ta.value), (ta.value.match(/irk:[0-9a-f]{32}/i) || [])[0]);
  const byName = (n) => Object.entries(devs).find(([, d]) => d.name === n) || [];
  const [ak, alice] = byName("Alice's iPhone"), [bk, bob] = byName("Bob's Pixel");
  check("diag: each phone stays in, under its own stand-in for the IRK", /^irk:hidden-\d+$/.test(ak || "") && alice.canonical_id === ak
    && /^irk:hidden-\d+$/.test(bk || "") && bob.canonical_id === bk && ak !== bk, [ak, alice && alice.canonical_id, bk, bob && bob.canonical_id]);
  const note = attr(root, "data-diag-privacy");
  check("diag: the screen says what the report names before it is sent",
    !!note && /names your rooms, floor plans and devices, with their Bluetooth addresses/.test(text(note)) && /look it over before you send it/.test(text(note)),
    note && text(note));
}

// ── 3b. Monitor → Export for support: the IRKs left out too ─────────────────
{
  check("diag: the same IRK, any case, is one stand-in",
    MON.hideIrks("irk:AABBCCDDEEFF00112233445566778899 irk:aabbccddeeff00112233445566778899 irk:ffeeddccbbaa99887766554433221100 irk:short")
      === "irk:hidden-1 irk:hidden-1 irk:hidden-2 irk:short", null);
  const ctx = makeCtx({ view: "monitor", _monitorTab: "diag_export", live: { snapshot: SAMPLE_SNAPSHOT } });
  const root = attempt("diag: Monitor's export renders", () => MON.render(ctx));
  const b = root && button(root, "Build export");
  if (b) b.dispatchEvent(new Event("click"));
  const ta = root && tagged(root, "TEXTAREA")[0];
  const v = (ta && ta.value) || "";
  check("diag: Monitor → Export for support leaves the IRKs out", v.length > 1000 && /Alice's iPhone/.test(v)
    && !/irk:[0-9a-f]{32}/i.test(v) && /irk:hidden-1/.test(v), [!!b, v.length, (v.match(/irk:[0-9a-f]{32}/i) || [])[0]]);
}

// ── 4. Bluetooth → Scanners, RSSI offset ─────────────────────────────────────
async function scannerSet(stored, typed) {
  const saved = [];
  const ctx = makeCtx({ view: "bluetooth", btTab: "scanners", settings: { scanner_offsets: stored == null ? {} : { kit: stored } },
    live: { snapshot: { ble: { radios: [{ source: "kit", name: "Kitchen", area_name: "Kitchen" }], advertisements: [], diag: { ok: true, errors: [] } },
      objects: { list: [] } } } }, [], { scannerOffsetSet: async (src, v) => { saved.push([src, v]); } });
  const root = BT.render(ctx);
  const inp = tagged(root, "INPUT").find(n => n.getAttribute("aria-label") === "RSSI offset in dBm");
  const shown = inp && inp.value;
  if (inp && typed != null) inp.value = String(typed);
  const set = inp && tagged(inp.parentNode, "BUTTON").find(b => text(b) === "Set");
  if (set) set.dispatchEvent(new Event("click"));
  await flush();
  return { min: inp && inp.getAttribute("min"), max: inp && inp.getAttribute("max"), shown, saved };
}
{
  const a = await scannerSet(null, 25);
  check("offset: the input is -20..+20 like the rest", a.min === "-20" && a.max === "20", [a.min, a.max]);
  check("offset: a new value past +20 is held at +20", JSON.stringify(a.saved) === JSON.stringify([["kit", 20]]), a.saved);
  const b = await scannerSet(null, -27);
  check("offset: a new value past -20 is held at -20", JSON.stringify(b.saved) === JSON.stringify([["kit", -20]]), b.saved);
  const c = await scannerSet(25, null);
  check("offset: a stored +25 is shown as it is and Set unchanged keeps it", c.shown === "25" && JSON.stringify(c.saved) === JSON.stringify([["kit", 25]]), c);
  const d = await scannerSet(25, 30);
  check("offset: changing a stored +25 is held at +20", JSON.stringify(d.saved) === JSON.stringify([["kit", 20]]), d.saved);
  const e = await scannerSet(-27.5, null);
  check("offset: a stored -27.5 is shown as it is and Set unchanged keeps it", e.shown === "-27.5" && JSON.stringify(e.saved) === JSON.stringify([["kit", -27.5]]), e);
}

// ── 4b. The same rule on Settings → Tracking → Receivers and the Receivers page
// Both clamped to ±20 on Save even when nothing was typed, so an offset 1 m
// Reference Calibration saved past ±20 was cut the first time anyone pressed
// Save on that row.
async function offsetVia(screen, stored, typed) {
  const saved = [];
  const state = { settings: { tier: "pro", edition: "full", scanner_offsets: stored == null ? {} : { kit: stored } },
    live: { snapshot: { source: "live", ble: { radios: [{ source: "kit", name: "Kitchen", area_name: "Kitchen" }], advertisements: [] }, objects: { list: [] } } } };
  const extra = { scannerOffsetSet: async (src, v) => { saved.push([src, v]); } };
  let inp = null;
  if (screen === "settings") {
    const root = SET.render(makeCtx(Object.assign(state, { view: "settings", _settingsTab: "presence" }), [], extra));
    const card = all(root).find(n => (n.className || "") === "card" && /Receiver signal adjustments/.test(text(n)));
    inp = card ? tagged(card, "INPUT").find(n => n.getAttribute("type") === "number") : null;
  } else {
    const root = RX.render(makeCtx(Object.assign(state, { view: "receivers" }), [], extra));
    inp = tagged(root, "INPUT").find(n => /^Signal adjustment \(dB\) for/.test(n.getAttribute("aria-label") || "")) || null;
  }
  const shown = inp && inp.value;
  if (inp && typed != null) inp.value = String(typed);
  const save = inp && tagged(inp.parentNode, "BUTTON").find(b => text(b) === "Save");
  if (save) save.dispatchEvent(new Event("click"));
  await flush();
  return { found: !!inp && !!save, min: inp && inp.getAttribute("min"), max: inp && inp.getAttribute("max"), shown, saved };
}
for (const screen of ["settings", "receivers"]) {
  const same = (r, v) => JSON.stringify(r.saved) === JSON.stringify([["kit", v]]);
  const a = await offsetVia(screen, 25, null);
  check(`offset: ${screen} has the box, -20..+20`, a.found && a.min === "-20" && a.max === "20", a);
  check(`offset: ${screen} shows a stored +25 as it is and Save unchanged keeps it`, a.shown === "25" && same(a, 25), a);
  const b = await offsetVia(screen, -27.5, null);
  check(`offset: ${screen} keeps a stored -27.5 on Save unchanged`, b.shown === "-27.5" && same(b, -27.5), b);
  const c = await offsetVia(screen, 25, 30);
  check(`offset: ${screen} holds a new value typed over a stored +25 at +20`, same(c, 20), c.saved);
  const d = await offsetVia(screen, 25, 12.5);
  check(`offset: ${screen} saves a new in-range value as typed`, same(d, 12.5), d.saved);
  const e = await offsetVia(screen, null, -26);
  check(`offset: ${screen} holds a new value past -20 at -20`, same(e, -20), e.saved);
  const f = await offsetVia(screen, 4.5, null);
  check(`offset: ${screen} saves an in-range stored value unchanged`, same(f, 4.5), f.saved);
}

// ── 5. Mapping → Library, Compare Maps ───────────────────────────────────────
function compare(transforms) {
  const sq = (x) => ({ type: "poly", points: [[x, 0.2], [x + 0.2, 0.2], [x + 0.2, 0.4], [x, 0.4]] });
  const maps = [
    { id: "m1", name: "Main floor", floor_id: "main", image: { width: 800, height: 600 }, receivers: [], room_bounds: { Kitchen: sq(0.1), Hall: sq(0.5) } },
    { id: "m2", name: "Main copy", floor_id: "main", image: { width: 800, height: 600 }, receivers: [], room_bounds: { Kitchen: sq(0.12), Hall: sq(0.5) } },
    { id: "m3", name: "Basement sketch", floor_id: "main", image: { width: 800, height: 600 }, receivers: [], room_bounds: { Kitchen: sq(0.3) } },
  ];
  const ctx = makeCtx({ view: "maps", mapsTab: "library", activeMapId: "m1", maps: { list: maps },
    model: { floors: [{ id: "main", name: "Main" }], areas: [], room_meta: {}, room_geometry_m: {}, world_gauge: { m_per_unit: 10 }, map_transforms: transforms } });
  const root = MAPS.render(ctx);
  const b = button(root, "Compare Maps");
  if (!b) return { err: "no Compare Maps button", root };
  try { b.dispatchEvent(new Event("click")); } catch (e) { return { err: String(e && e.message || e), root }; }
  return { root };
}
{
  const tf = { origin_x_m: 0, origin_y_m: 0, scale_x_m: 10, scale_y_m: 8, rotation_rad: 0, shear_rad: 0 };
  const r = compare({ m1: tf, m2: tf });
  check("compare: a visible plan with rooms and no placement doesn't break it", !r.err, r.err);
  if (!r.err) {
    const t = text(r.root);
    check("compare: the placed plans are compared", /Worst error/.test(t) && /Main floor vs Main copy/.test(t), t.slice(0, 400));
    const note = attr(r.root, "data-compare-not-placed");
    check("compare: the unplaced plan is named as not placed", !!note && /Basement sketch/.test(text(note)) && !/Main floor/.test(text(note)), note && text(note));
  }
  const none = compare({});
  check("compare: nothing placed, no crash and every plan named", !none.err && /No shared rooms/.test(text(none.root))
    && /Main floor, Main copy, Basement sketch/.test(text(attr(none.root, "data-compare-not-placed") || el("i"))), none.err || text(none.root).slice(0, 300));
}

console.log(JSON.stringify(results));
