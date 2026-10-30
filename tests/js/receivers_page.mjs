// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
//
// The Receivers page (views/receivers.js), run for real under the DOM shim:
//   rows      one row per live receiver from the snapshot, model, maps and
//             settings: room, floor, on a floor plan, height, offset,
//             devices heard now, last heard
//   status    the top bar dot's rules (status_dot.js receiverStatus)
//   height    Save sends Tune's / Edit → Radios' command and payload exactly
//   offset    Save goes through scannerOffsetSet, Settings' action
//   sort      headings sort; Problems only filters
//   sample    Sample mode: rows shown, nothing editable, a note
//   empty     no receivers: an empty state
//   place     Place / Move opens Mapping → Edit → Radios with it selected
//             (in Basic too, as a link: Basic stays Basic)
//
// usage: receivers_page.mjs <views dir>
// prints one JSON line: { name: {ok, detail} }

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

const A = "aa:bb:cc:dd:ee:01", B = "aa:bb:cc:dd:ee:02", C = "aa:bb:cc:dd:ee:03";
function snapshot() {
  return {
    source: "live",
    ble: {
      radios: [
        { source: A, name: "kitchen-proxy", display_name: "Kitchen proxy", area_name: "Kitchen", last_heard_s: 2 },
        { source: B, name: "Garage proxy", area_name: "Garage", last_heard_s: 1500 },
        { source: C, name: "Den proxy", area_name: "Den", last_heard_s: 4, adv_rate_low: true },
      ],
      advertisements: [
        { address: "11:11:11:11:11:11", source: A, age_s: 3 },
        { address: "22:22:22:22:22:22", source: A, age_s: 10 },
        { address: "22:22:22:22:22:22", source: C, age_s: 10 },
        { address: "33:33:33:33:33:33", source: A, age_s: 400 },        // not "now"
      ],
    },
  };
}

function makeCtx(calls, opts = {}) {
  const state = {
    complexity: opts.complexity || "advanced", view: "receivers", dataMode: opts.dataMode || "live", _dataModeKnown: true,
    settings: { scanner_offsets: { [A]: -3.5 } },
    live: { snapshot: opts.snapshot !== undefined ? opts.snapshot : snapshot() },
    activeMapId: "m2",
    maps: { list: [
      { id: "m1", name: "Main floor", floor_id: "main", image: { width: 800, height: 600, sha256: "s1" }, room_bounds: {},
        receivers: [{ id: "rx_k", label: "Kitchen", x: 0.2, y: 0.3, room: "Kitchen nook", source: A }] },
      { id: "m2", name: "Basement", floor_id: "basement", image: { width: 800, height: 600, sha256: "s2" }, room_bounds: {},
        receivers: [{ id: "rx_den", label: "den proxy", x: 0.5, y: 0.5, room: "", source: "" }] },
    ] },
    model: {
      floors: [{ id: "main", name: "Main", level: 0 }, { id: "basement", name: "Basement", level: -1 }],
      areas: [{ id: "kitchen", name: "Kitchen", floor_id: "main" }, { id: "garage", name: "Garage", floor_id: "basement" }],
      map_transforms: {},
      scanner_positions_m: { [A]: { x_m: 3, y_m: 4, z_m: 2.1, floor_id: "main" } },
    },
  };
  if (opts.calibTune) state._calibTune = opts.calibTune;
  const actions = {
    renderRooms: () => calls.push(["render"]),
    renderNav: () => calls.push(["nav"]),
    setMapsTab: (t) => { state.mapsTab = t; calls.push(["mapsTab", t]); },
    callWS: async (p) => { calls.push(["callWS", p]); return opts.wsResult !== undefined ? opts.wsResult : { ok: true }; },
    scannerOffsetSet: async (src, v) => { calls.push(["scannerOffsetSet", src, v]); },
    modelRefresh: async () => { calls.push(["modelRefresh"]); },
    telemetryEvent: (n) => calls.push(["telemetry", n]),
    mapsUpdateQuiet: async () => { calls.push(["mapsUpdate"]); },
  };
  return {
    state,
    hass: { states: {}, user: { is_admin: true } },
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
function findAll(node, pred, out = []) {
  if (pred(node)) out.push(node);
  for (const c of node.childNodes || []) findAll(c, pred, out);
  return out;
}
const textOf = (n) => (n.textContent || "").trim();
const settle = async () => { await flush(); for (let i = 0; i < 5; i++) await new Promise(r => globalThis._realSetTimeout(r, 0)); };
const rowOf = (root, src) => find(root, (n) => n.tagName === "TR" && n.getAttribute && n.getAttribute("data-rx") === src);
const cell = (tr, label) => find(tr, (n) => n.tagName === "TD" && n.getAttribute("data-label") === label);
const order = (root) => findAll(root, (n) => n.tagName === "TR" && n.getAttribute && n.getAttribute("data-rx")).map(n => n.getAttribute("data-rx"));

const R = await import(pathToFileURL(join(VIEWS_DIR, "receivers.js")).href);
const SD = await import(pathToFileURL(join(VIEWS_DIR, "status_dot.js")).href);

// ── rows ──
{
  const calls = [];
  const ctx = makeCtx(calls);
  const rows = R.receiverRows(ctx.state);
  const a = rows.find(r => r.source === A), b = rows.find(r => r.source === B), c = rows.find(r => r.source === C);
  check("rows: one per live receiver", rows.length === 3, rows.length);
  check("rows: the display name, else the name", a.name === "Kitchen proxy" && b.name === "Garage proxy", [a.name, b.name]);
  check("rows: room is the floor plan's room, else the HA area", a.room === "Kitchen nook" && b.room === "Garage", [a.room, b.room]);
  check("rows: floor from the receiver's position, else its map, else its area",
    a.floor === "Main" && c.floor === "Basement" && b.floor === "Basement", [a.floor, b.floor, c.floor]);
  check("rows: on a floor plan by source, or by name the way Edit → Radios matches",
    a.placed && a.placed.mapId === "m1" && a.placed.rxId === "rx_k" && c.placed && c.placed.rxId === "rx_den" && b.placed === null,
    [a.placed, b.placed, c.placed]);
  check("rows: height from the model's z_m, none without a position", a.height === 2.1 && b.height === null, [a.height, b.height]);
  check("rows: signal adjustment from settings.scanner_offsets (0 unset)", a.offset === -3.5 && b.offset === 0, [a.offset, b.offset]);
  check("rows: devices heard now = different addresses in the last minute", a.devices === 2 && c.devices === 1 && b.devices === 0,
    [a.devices, b.devices, c.devices]);
  check("rows: last heard", a.lastHeardS === 2 && b.lastHeardS === 1500, [a.lastHeardS, b.lastHeardS]);
  check("ago text", R.agoText(2) === "2 s ago" && R.agoText(1500) === "25 min ago" && R.agoText(7300) === "2 h ago" && R.agoText(null) === null);
}

// ── status: the dot's own rules ──
{
  const rows = R.receiverRows(makeCtx([]).state);
  const by = Object.fromEntries(rows.map(r => [r.source, r.status]));
  check("status: online", by[A].id === "online" && by[A].level === "ok", by[A]);
  check("status: silent N min (over the dot's 10 min)", by[B].id === "silent" && by[B].label === "Silent 25 min" && by[B].level === "amber", by[B]);
  check("status: hearing far fewer devices than usual", by[C].id === "hearing_less" && by[C].level === "amber", by[C]);
  check("status: the same thresholds as the dot",
    SD.isSilent({ last_heard_s: SD.SILENT_S + 1 }) && !SD.isSilent({ last_heard_s: SD.SILENT_S }) && !SD.isSilent({ last_heard_s: null })
    && SD.receiverStatus({ last_heard_s: SD.SILENT_S }).id === "online");
  const dot = SD.statusIssues({ live: true, failed: false, maps: [], snapshot: snapshot() }).map(i => i.id).sort();
  check("status: what the page flags is what the dot counts", JSON.stringify(dot) === JSON.stringify(["hearing_less", "receivers_silent"]), dot);
  check("status: not heard yet, unless it is heard in the snapshot",
    SD.receiverStatus({ last_heard_s: null }).id === "not_heard" && SD.receiverStatus({ last_heard_s: null }, 2).id === "online");
  // The dot's filters (batch 1): lost, disabled or excluded receivers are left out,
  // and one scanning or with advertisements in this snapshot is never silent.
  const st = makeCtx([]).state;
  st.settings = { ...(st.settings || {}), excluded_scanners: [B] };
  const ex = Object.fromEntries(R.receiverRows(st).map(r => [r.source, r.status]));
  const dotEx = SD.statusIssues({ live: true, failed: false, snapshot: st.live.snapshot, excluded: [...SD.maskedSources(st.settings)] }).map(i => i.id).sort();
  check("status: an excluded receiver is Not in use, and the dot leaves it out too",
    ex[B].id === "not_used" && ex[B].level === "ok" && JSON.stringify(dotEx) === JSON.stringify(["hearing_less"]), { row: ex[B], dot: dotEx });
  const old = { source: "zz", last_heard_s: SD.SILENT_S + 100 };
  check("status: lost or disabled (snapshot or Settings) is Not in use",
    SD.receiverStatus({ ...old, lost: true }).id === "not_used" && SD.receiverStatus({ ...old, disabled: true }).id === "not_used"
    && SD.receiverStatus(old, 0, { masked: SD.maskedSources({ lost_radios: { zz: 1 } }) }).id === "not_used"
    && SD.receiverStatus(old, 0, { masked: SD.maskedSources({ disabled_radios: { zz: 1 } }) }).id === "not_used");
  check("status: scanning, or advertising in this snapshot, is never silent",
    SD.receiverStatus({ ...old, scanning: true }).id === "online"
    && SD.receiverStatus(old, 0, { heard: SD.heardSources({ ble: { advertisements: [{ source: "zz", address: "x", age_s: 300 }] } }) }).id === "online"
    && SD.receiverStatus(old).id === "silent");
}

// ── render ──
{
  const calls = [];
  const ctx = makeCtx(calls);
  const root = R.render(ctx);
  const trA = rowOf(root, A), trB = rowOf(root, B);
  check("render: a table row per receiver", order(root).length === 3, order(root));
  check("render: the nine columns", findAll(root, n => n.tagName === "TH").map(n => textOf(n).replace(/\s*[▴▾]$/, "")).join("|")
    === "Receiver|Room|Floor|On a floor plan|Height|Signal adjustment|Status|Devices now|Last heard",
    findAll(root, n => n.tagName === "TH").map(textOf));
  check("render: a problem row is marked", trB.className.includes("rx-problem") && !trA.className.includes("rx-problem"));
  check("render: status cell", textOf(cell(trB, "Status")) === "Silent 25 min" && textOf(cell(trA, "Status")) === "Online");
  check("render: placed yes/no with Move / Place",
    /^Yes\s*Move$/.test(textOf(cell(trA, "On a floor plan"))) && /^No\s*Place$/.test(textOf(cell(trB, "On a floor plan"))),
    [textOf(cell(trA, "On a floor plan")), textOf(cell(trB, "On a floor plan"))]);
  check("render: no position, no height box", !find(cell(trB, "Height"), n => n.tagName === "INPUT") && /No position yet/.test(textOf(cell(trB, "Height"))));
  const zInp = find(cell(trA, "Height"), n => n.tagName === "INPUT");
  check("render: height box with Tune's limits", zInp && zInp.value === "2.1" && zInp.getAttribute("min") === "0"
    && zInp.getAttribute("max") === "100" && zInp.getAttribute("step") === "0.1", zInp && zInp.value);
  const oInp = find(cell(trA, "Signal adjustment"), n => n.tagName === "INPUT");
  check("render: offset box with Settings' range", oInp && oInp.value === "-3.5" && oInp.getAttribute("min") === "-20"
    && oInp.getAttribute("max") === "20" && oInp.getAttribute("step") === "0.5", oInp && oInp.value);
  check("render: devices now and last heard", textOf(cell(trA, "Devices now")) === "2" && textOf(cell(trB, "Last heard")) === "25 min ago");
  check("render: the summary counts problems", /3 receivers · 2 need attention/.test(textOf(root)), textOf(root).slice(0, 400));
  check("render: no sample note in Live", !find(root, n => n.getAttribute && n.getAttribute("data-rx-note")));
}

// ── height: the same command and payload as Tune / Edit → Radios ──
{
  const calls = [];
  const ctx = makeCtx(calls);
  const root = R.render(ctx);
  const td = cell(rowOf(root, A), "Height");
  const inp = find(td, n => n.tagName === "INPUT"), btn = find(td, n => n.tagName === "BUTTON");
  const posBefore = JSON.stringify({ ...ctx.state.model.scanner_positions_m[A], z_m: undefined });
  const mapsBefore = JSON.stringify(ctx.state.maps.list);
  inp.value = "1.234"; btn.click(); await settle();
  const ws = calls.filter(c => c[0] === "callWS");
  check("height: one write, padspan_ha/fabric_scanner_z_set {source, z_m} exactly",
    ws.length === 1 && JSON.stringify(ws[0][1]) === JSON.stringify({ type: "padspan_ha/fabric_scanner_z_set", source: A, z_m: 1.234 }), ws);
  const p = ctx.state.model.scanner_positions_m[A];
  check("height: the acknowledged value is in the shared model (rounded like the backend)", p.z_m === 1.23, p);
  check("height: position and floor plans untouched", JSON.stringify({ ...p, z_m: undefined }) === posBefore
    && JSON.stringify(ctx.state.maps.list) === mapsBefore && !calls.some(c => c[0] === "mapsUpdate"));
  check("height: model refreshed, then the page redrawn",
    calls.findIndex(c => c[0] === "modelRefresh") >= 0 && calls.findIndex(c => c[0] === "render") > calls.findIndex(c => c[0] === "modelRefresh"), calls);
  check("height: counted once in the opt-in report", calls.filter(c => c[0] === "telemetry" && c[1] === "receivers_page_edit").length === 1, calls);
  // refused values, a refusing backend, Tune's lock
  const calls2 = [];
  const ctx2 = makeCtx(calls2, { wsResult: { ok: false } });
  const td2 = cell(rowOf(R.render(ctx2), A), "Height");
  const inp2 = find(td2, n => n.tagName === "INPUT"), btn2 = find(td2, n => n.tagName === "BUTTON");
  for (const bad of ["-1", "101", "abc"]) { inp2.value = bad; btn2.click(); await settle(); }
  check("height: out of range refused, nothing sent", !calls2.some(c => c[0] === "callWS")
    && calls2.filter(c => c[0] === "toast" && c[2]).length === 3, calls2);
  inp2.value = "3"; btn2.click(); await settle();
  check("height: a refused save keeps the old height and is not counted", ctx2.state.model.scanner_positions_m[A].z_m === 2.1
    && !calls2.some(c => c[0] === "telemetry"), calls2);
  const calls3 = [];
  const ts = { _tuneBusy: true };
  const ctx3 = makeCtx(calls3, { calibTune: ts });
  const btn3 = find(cell(rowOf(R.render(ctx3), A), "Height"), n => n.tagName === "BUTTON");
  btn3.click(); await settle();
  check("height: waits while a Tune save holds the lock", !calls3.some(c => c[0] === "callWS"), calls3);
  ts._tuneBusy = false; btn3.click(); await settle();
  check("height: then saves and releases it", calls3.some(c => c[0] === "callWS") && ts._tuneBusy === false);
}

// ── signal adjustment: Settings' action and range ──
{
  const calls = [];
  const ctx = makeCtx(calls);
  const td = cell(rowOf(R.render(ctx), B), "Signal adjustment");
  const inp = find(td, n => n.tagName === "INPUT"), btn = find(td, n => n.tagName === "BUTTON");
  inp.value = "4.5"; btn.click(); await settle();
  check("offset: saved through scannerOffsetSet(source, dB)",
    JSON.stringify(calls.filter(c => c[0] === "scannerOffsetSet")) === JSON.stringify([["scannerOffsetSet", B, 4.5]]), calls);
  check("offset: no other write", !calls.some(c => c[0] === "callWS"), calls);
  check("offset: counted once", calls.filter(c => c[0] === "telemetry" && c[1] === "receivers_page_edit").length === 1, calls);
  inp.value = "99"; btn.click(); await settle();
  check("offset: clamped to Settings' ±20 dB", calls.filter(c => c[0] === "scannerOffsetSet").pop()[2] === 20, calls);
}

// ── sort and filter ──
{
  const ctx = makeCtx([]);
  check("sort: by name by default", JSON.stringify(order(R.render(ctx))) === JSON.stringify([C, B, A]), order(R.render(ctx)));
  ctx.state._receivers.sort = "heard";
  check("sort: last heard", JSON.stringify(order(R.render(ctx))) === JSON.stringify([A, C, B]), order(R.render(ctx)));
  const root = R.render(ctx);
  find(root, n => n.getAttribute && n.getAttribute("data-sort") === "heard").click();
  check("sort: a heading clicked twice reverses", ctx.state._receivers.dir === -1 && JSON.stringify(order(R.render(ctx))) === JSON.stringify([B, C, A]));
  find(R.render(ctx), n => n.getAttribute && n.getAttribute("data-sort") === "devices").click();
  check("sort: devices now, most first", JSON.stringify(order(R.render(ctx))) === JSON.stringify([A, C, B]), order(R.render(ctx)));
  ctx.state._receivers.problems = true;
  check("filter: problems only", JSON.stringify(order(R.render(ctx)).sort()) === JSON.stringify([B, C].sort()), order(R.render(ctx)));
  const healthy = makeCtx([], { snapshot: { source: "live", ble: { radios: [{ source: A, name: "x", last_heard_s: 1 }], advertisements: [] } } });
  healthy.state._receivers = { sort: "name", dir: 1, problems: true };
  const hr = R.render(healthy);
  check("filter: nothing wrong says so", find(hr, n => n.getAttribute && n.getAttribute("data-rx-none")) && order(hr).length === 0);
}

// ── sample mode and waiting: read-only ──
{
  const calls = [];
  const s = snapshot(); s.source = "sample";
  const ctx = makeCtx(calls, { dataMode: "sample", snapshot: s });
  const root = R.render(ctx);
  check("sample: rows shown", order(root).length === 3);
  check("sample: a note says read-only", find(root, n => n.getAttribute && n.getAttribute("data-rx-note") === "sample")
    && /Sample mode/.test(textOf(root)));
  check("sample: no inputs, no Save, no Place", !find(root, n => n.tagName === "INPUT" && n.getAttribute("type") === "number")
    && !find(root, n => n.tagName === "BUTTON" && /^(Save|Place|Move)$/.test(textOf(n))));
  check("sample: the values still show", textOf(cell(rowOf(root, A), "Height")) === "2.1 m" && textOf(cell(rowOf(root, A), "Signal adjustment")) === "-3.5 dB");
  const w = makeCtx([], { dataMode: "live", snapshot: Object.assign(snapshot(), { source: "x" }) });
  const wr = R.render(w);
  check("waiting: read-only with a note", find(wr, n => n.getAttribute && n.getAttribute("data-rx-note") === "waiting")
    && !find(wr, n => n.tagName === "INPUT" && n.getAttribute("type") === "number"));
}

// ── empty ──
{
  const ctx = makeCtx([], { snapshot: { source: "live", ble: { radios: [], advertisements: [] } } });
  const root = R.render(ctx);
  check("empty: no receivers says so, no table", find(root, n => n.getAttribute && n.getAttribute("data-rx-empty"))
    && !find(root, n => n.tagName === "TABLE") && /No receivers yet/.test(textOf(root)));
  const none = makeCtx([], { snapshot: null });
  check("empty: no snapshot at all renders", (() => { try { return !!R.render(none); } catch (e) { return false; } })());
}

// ── Place / Move into Mapping's own placement ──
const maps = await import(pathToFileURL(join(VIEWS_DIR, "maps.js")).href);
{
  const calls = [];
  const ctx = makeCtx(calls);
  find(cell(rowOf(R.render(ctx), A), "On a floor plan"), n => n.tagName === "BUTTON").click();
  check("move: opens Mapping → Edit on the map it is on", ctx.state.view === "maps" && ctx.state.activeMapId === "m1" && ctx.state.mapsTab === "edit", [ctx.state.view, ctx.state.activeMapId, ctx.state.mapsTab]);
  ctx.state.view = "maps";
  try { maps.render(ctx); await flush(); } catch (e) { check("move: Mapping renders", false, String(e && e.stack || e)); }
  check("move: Radios, with that receiver selected", ctx.state.maps._mode === "receivers" && ctx.state.maps._selectedRxId === "rx_k",
    [ctx.state.maps._mode, ctx.state.maps._selectedRxId]);
  check("move: the one-shot is used up", ctx.state.maps._openRadios === null);
  maps.render(ctx); await flush();
  check("move: no position is written", !calls.some(c => c[0] === "callWS" || c[0] === "mapsUpdate"), calls);
}
{
  const ctx = makeCtx([]);
  find(cell(rowOf(R.render(ctx), B), "On a floor plan"), n => n.tagName === "BUTTON").click();
  check("place: an unplaced receiver opens the map of its floor", ctx.state.activeMapId === "m2" && ctx.state.mapsTab === "edit", ctx.state.activeMapId);
  maps.render(ctx); await flush();
  check("place: on Radios, nothing selected", ctx.state.maps._mode === "receivers" && !ctx.state.maps._selectedRxId);
}
{
  const ctx = makeCtx([], { complexity: "basic" });
  find(cell(rowOf(R.render(ctx), A), "On a floor plan"), n => n.tagName === "BUTTON").click();
  const f = ctx.state._focus;
  check("place (Basic): only Mapping → Edit's Radios tool on that map, back to Receivers, the mode unchanged",
    !ctx.state._mapsWizard && ctx.state.mapsTab === "edit" && !!f && f.view === "maps" && f.tab === "edit" && f.part === "receivers"
    && f.item === "rx_k" && f.back && f.back.view === "receivers" && ctx.state.activeMapId === "m1"
    && ctx.state.complexity === "basic", [ctx.state.mapsTab, f, ctx.state.activeMapId, ctx.state._mapsWizard]);
  maps.render(ctx); await flush();
  check("place (Basic): Edit stays open in Basic, on Radios", ctx.state.mapsTab === "edit" && ctx.state.maps._mode === "receivers"
    && ctx.state.complexity === "basic", [ctx.state.mapsTab, ctx.state.maps._mode]);
}
{
  // Advanced: the whole Edit tab, as before; no focus.
  const ctx = makeCtx([], { complexity: "advanced" });
  find(cell(rowOf(R.render(ctx), A), "On a floor plan"), n => n.tagName === "BUTTON").click();
  check("place (Advanced): Mapping → Edit, no focus", ctx.state.mapsTab === "edit" && !ctx.state._focus && ctx.state.view === "maps",
    [ctx.state.mapsTab, ctx.state._focus, ctx.state.view]);
}

console.log(JSON.stringify(results));
