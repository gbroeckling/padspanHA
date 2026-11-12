// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
//
// "Set this plan's scale now" (views/scale_nudge.js) RUN under the DOM shim with panel.js's own el(), through the real
// Mapping view (views/maps.js) and Setup (views/setup.js), against a fake server: Mapping → Upload marks the plan, the
// nudge opens in Edit, two taps and a typed length are previewed and saved; a second length that disagrees is said;
// Later ends it; it is counted shown once; Basic goes on to the Setup Wizard's scale step and an upload in the wizard
// asks for nothing more; the quiet "No scale yet: Measure" line in the Library and in Setup; nothing for a non-admin,
// in Sample or on a wall screen.
//
// usage: scale_nudge.mjs <www/padspan-ha dir>
// prints one JSON line: { cases: {name: ok}, failures: [...] }

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import * as shim from "./dom_shim.mjs";

const WWW = process.argv[2];
shim.install(globalThis);
// The upload's picture: an image that loads, a canvas that makes a PNG.
globalThis.Image = class { set src(v) { this._s = v; this.naturalWidth = 1000; this.naturalHeight = 800; globalThis._realSetTimeout(() => this.onload && this.onload(), 0); } get src() { return this._s; } };
// A select's options are its option children (the floor picker, an Outside plan).
Object.defineProperty(globalThis.Node.prototype, "options", { get() { return (this.children || []).filter(c => c.tagName === "OPTION"); }, set() {}, configurable: true });
globalThis.Node.prototype.toBlob = function (cb) { cb(new Blob([new Uint8Array([137, 80, 78, 71])], { type: "image/png" })); };

const src = readFileSync(join(WWW, "panel.js"), "utf-8").replace(/\r\n/g, "\n");
const elStart = src.indexOf("function el(tag, attrs={}, children=[]){");
const el = new Function("return " + src.slice(elStart, src.indexOf("\n}\n", elStart) + 2).replace(/^function el/, "function"))();
const MAPS = await import(pathToFileURL(join(WWW, "views", "maps.js")).href);
const SETUP = await import(pathToFileURL(join(WWW, "views", "setup.js")).href);
const N = await import(pathToFileURL(join(WWW, "views", "scale_nudge.js")).href);

const failures = [], cases = {};
const check = (name, ok, detail) => { cases[name] = !!ok; if (!ok) failures.push({ name, detail: detail === undefined ? null : detail }); };
const tick = () => new Promise(r => globalThis._realSetTimeout(r, 0));
const quiet = () => new Proxy(() => document.createElement("span"), {
  get: (_t, k) => (k === "then" ? undefined : k === Symbol.toPrimitive || k === "toString" ? () => "" : quiet()),
  apply: () => document.createElement("span"),
});

// The server's maps_scale_measure, faked as plan_ai_write.measures_preview reads: these lengths, a 1000 x 800 picture.
const LENGTHS = { "5 m": 5, "4 m": 4, "12": 12 };
function measure(p, house) {
  const ms = p.measures || [];
  const out = { size: [1000, 800] };
  if (!ms.length) return out;
  out.metres = ms.map(m => (m.text in LENGTHS ? LENGTHS[m.text] : null));
  out.assumed = ms.map(m => (m.text === "12" ? "metres" : null));
  if (out.metres.includes(null)) { out.invalid = "Type a length such as 4.2 m, 420 cm or 13' 9\"."; return out; }
  if (!ms.every(m => m.p1 && m.p2)) return out;
  const ppms = ms.map((m, i) => Math.hypot((m.p2[0] - m.p1[0]) * 1000, (m.p2[1] - m.p1[1]) * 800) / out.metres[i]);
  const ppm = ppms.reduce((a, b) => a + b, 0) / ppms.length;
  Object.assign(out, { across_m: 1000 / ppm, down_m: 800 / ppm, odd: false });
  if (ppms.length === 2) out.differ_pct = Math.round(Math.abs(ppms[0] - ppms[1]) / ppm * 1000) / 10;
  if (!p.save) return out;
  house.state.model.map_transforms[p.map_id] = { scale_x_m: out.across_m, scale_y_m: out.down_m, reference_measurements: ms };
  const m = house.state.maps.list.find(x => x.id === p.map_id);
  if (m) delete m.scale_nudge;
  return { ok: true, map_id: p.map_id, scale_x_m: out.across_m, scale_y_m: out.down_m, lengths: ms.length };
}

function house(o = {}) {
  const calls = [], tele = [], renders = { n: 0 }, toasts = [];
  N._resetCounts();
  const state = {
    complexity: o.complexity || "advanced", mapsTab: o.tab || "library", dataMode: o.dataMode || "live", view: "maps", kioskMode: !!o.kiosk,
    settings: { setup_progress: {} }, _mapsLoaded: true, _modelLoaded: true, calibration: { points: [] },
    maps: { list: o.maps || [] }, model: { floors: [{ id: "main", floor_id: "main", name: "Main" }], map_transforms: JSON.parse(JSON.stringify(o.tfs || {})), areas: [] },
    ...(o.wizard ? { _mapsWizard: o.wizard } : {}),
  };
  const h = { calls, tele, renders, toasts, state };
  const server = {
    "padspan_ha/maps_upload": (p) => { const m = { id: "up1", name: p.name, floor_id: p.floor_id, image: { width: 1000, height: 800 }, receivers: [], room_bounds: {},
      ...(p.scale_nudge ? { scale_nudge: true } : {}) }; state.maps.list.push(m); return { map: m }; },
    "padspan_ha/maps_scale_measure": (p) => measure(p, h),
    "padspan_ha/maps_scale_nudge_end": () => ({ ok: true, ended: true }),
    "padspan_ha/receivers_to_rooms": () => ({ ok: true, ready: o.ready || [], skipped: [], undo: 0 }),
    "padspan_ha/settings_set": (p) => ({ settings: { ...state.settings, ...p } }),
  };
  const actions = {
    callWS: (p) => { calls.push(p); const f = server[p.type]; return f ? Promise.resolve(f(p)) : Promise.resolve({}); },
    mapsUpload: (p) => actions.callWS({ type: "padspan_ha/maps_upload", ...p }),
    telemetryEvent: (n) => tele.push(n), renderRooms: () => { renders.n++; }, renderNav: () => {},
    setMapsTab: (t) => { state.mapsTab = t; }, mapsSetActive: (id) => { state.activeMapId = id; }, showView: (v) => { state.view = v; },
    mapsRefresh: () => {}, modelRefresh: () => {}, calibrationGet: () => Promise.resolve({ points: [] }),
    openSetupStep: (id) => { state._openedStep = id; },
  };
  h.ctx = {
    state, hass: { user: { is_admin: o.admin !== false }, states: {} }, toast: (m) => toasts.push(m),
    helpers: new Proxy({ el, esc: (s) => String(s ?? ""), helpBtn: () => el("button", {}, "?"), mapImageUrl: () => "/x.png", pill: (t) => el("span", {}, String(t ?? "")) },
      { get: (t, k) => (k in t ? t[k] : quiet()) }),
    actions: new Proxy(actions, { get: (t, k) => (k in t ? t[k] : quiet()) }),
  };
  return h;
}
const q = (root, sel) => root.querySelector(sel);
const all = (root, sel) => root.querySelectorAll(sel);
const button = (root, text) => all(root, "button").find(b => (b.textContent || "").trim() === text);
const render = async (h) => { const r = MAPS.render(h.ctx); await tick(); return r; };
async function upload(h, floor = "main") {
  h.state.mapsTab = "upload";
  h.state._mapsUploadFloorId = floor;
  let root = await render(h);
  h.state._mapsUploadFile = { name: "plan.png", type: "image/png", size: 100, arrayBuffer: async () => new ArrayBuffer(8) };
  button(root, "Upload & Convert").click();
  for (let i = 0; i < 6; i++) await tick();
  return h.calls.find(c => c.type === "padspan_ha/maps_upload");
}
const tap = (root, x, y) => q(root, '[data-aiw="measure"]').dispatchEvent({ type: "click", clientX: x, clientY: y });
async function typeIn(root, key, text) { const f = q(root, `[data-aiw="${key}"]`); f.value = text; f.dispatchEvent({ type: "input" }); await shim.flush(); }
const count = (h, w) => h.tele.filter(t => t === "scale_nudge:" + w).length;

// ── Mapping → Upload (Advanced): the plan marked, the nudge in Edit, one length measured and saved ──
{
  const h = house();
  const up = await upload(h);
  check("upload: the plan is marked for the nudge", up && up.scale_nudge === true, up);
  check("upload: Edit opens on the new plan", h.state.mapsTab === "edit" && h.state.activeMapId === "up1", [h.state.mapsTab, h.state.activeMapId]);
  let root = await render(h);
  root = await render(h);
  check("the nudge: shown in Edit, its title and Later", !!q(root, '[data-nudge="card"]') && root.textContent.includes(N.TITLE) && !!q(root, '[data-nudge="later"]'),
    root.textContent.slice(0, 300));
  check("the nudge: counted shown once over two draws", count(h, "shown") === 1, h.tele);
  check("the nudge: none of the helper's Claude words", !/Claude|Anthropic|read|Pro\b/.test(q(root, '[data-nudge="card"]').textContent), q(root, '[data-nudge="card"]').textContent);
  check("the nudge: Save waits for a measurement", q(root, '[data-nudge="save"]').disabled === true);
  tap(root, 80, 300);                                        // the shim's layer is 800 x 600: (0.1, 0.5)
  root = await render(h);
  tap(root, 480, 300);                                       // (0.6, 0.5): half the width
  await tick();
  root = await render(h);
  await typeIn(root, "scale-length", "5 m");
  check("the length read, said in place", q(root, '[data-aiw="scale-understood"]').textContent === "= 5.00 m", q(root, '[data-aiw="scale-understood"]').textContent);
  check("the plan's size said", root.textContent.includes("10.0 m across and 8.0 m down"), root.textContent.slice(0, 900));
  check("a second length offered, not asked for", !!q(root, '[data-nudge="second"]') && q(root, '[data-nudge="save"]').disabled === false);
  check("the helper's commands never sent", !h.calls.some(c => /plan_build|ai_wizard/.test(c.type)), h.calls.map(c => c.type));
  q(root, '[data-nudge="save"]').click();
  for (let i = 0; i < 4; i++) await tick();
  const sv = h.calls.find(c => c.type === "padspan_ha/maps_scale_measure" && c.save);
  check("Save: the one length and its two ends, to the hand measurement's command", sv && sv.map_id === "up1" && sv.measures.length === 1
    && JSON.stringify(sv.measures[0]) === JSON.stringify({ text: "5 m", p1: [0.1, 0.5], p2: [0.6, 0.5] }), sv);
  check("Save: counted measured_one, said, the nudge over", count(h, "measured_one") === 1 && h.toasts.some(t => t.includes("10.0 m across"))
    && !N.pending(h.ctx, h.state.maps.list[0]) && !h.state._scaleNudge, [h.tele, h.toasts]);
  // Save leads on (review 2026-11-13, break 2): Edit on the same plan, the Rooms tool, one line saying the scale is set and what's next.
  check("Save: counted by its door, after an upload", count(h, "via_upload") === 1, h.tele);
  root = await render(h);
  const tools = all(root, "[data-edit-tool]").map(b => b.getAttribute("data-edit-tool"));
  check("Save goes on to Edit, the Rooms tool, on that plan", h.state.mapsTab === "edit" && h.state.activeMapId === "up1" && h.state.maps._mode === "rooms"
    && !q(root, '[data-nudge="card"]'), [h.state.mapsTab, h.state.maps._mode]);
  const nl = q(root, '[data-next-line="rooms"]');
  check("Save: the line at the top says the scale is set and the rooms are next, with one button", nl && nl.textContent.includes("scale is set")
    && nl.textContent.includes("Next: draw its rooms") && !!q(root, '[data-next="rooms"]'), root.textContent.slice(0, 600));
  check("Edit's tools are in build order: Measure, Rooms, Radios, Signal walls", JSON.stringify(tools.slice(0, 4)) === '["measure","rooms","receivers","barriers"]', tools);
  check("a Save that goes on by itself is not a Next press", !h.tele.some(t => t.startsWith("setup_next:")), h.tele);
}

// ── Next: … in Edit, from what is saved: rooms → receivers → calibration; each button counted ──
{
  const P = (o) => ({ id: "e1", name: "Main", floor_id: "main", image: { width: 1000, height: 800 }, receivers: [], room_bounds: {}, ...o });
  const TF1 = { e1: { scale_x_m: 10, scale_y_m: 8, reference_measurements: [{}] } };
  const ROOM = { Kitchen: { type: "poly", points: [[0.1, 0.1], [0.4, 0.1], [0.4, 0.4]] } };
  const h = house({ tab: "edit", maps: [P({ room_bounds: ROOM })], tfs: TF1 });
  h.state.activeMapId = "e1";
  let root = await render(h);
  check("Edit with rooms and no receivers: Next: place the receivers", !!q(root, '[data-next-line="receivers"]') && h.state.maps._mode === "receivers", root.textContent.slice(0, 300));
  h.state.maps._mode = "rooms";
  q(root, '[data-next="receivers"]').click();
  check("its button: the Radios tool on that plan, counted", h.state.maps._mode === "receivers" && h.tele.includes("setup_next:receivers"), [h.state.maps._mode, h.tele]);
  const r = house({ tab: "edit", maps: [P({ room_bounds: ROOM, receivers: [{ id: "r1", source: "aa", x: 0.2, y: 0.2 }] })], tfs: TF1 });
  r.state.activeMapId = "e1";
  root = await render(r);
  check("Edit with receivers: Next: calibrate", !!q(root, '[data-next-line="calibration"]'), root.textContent.slice(0, 300));
  q(root, '[data-next="calibration"]').click();
  check("its button: Setup's calibration step, counted", r.state._openedStep === "calibration" && r.tele.includes("setup_next:calibration"), [r.state._openedStep, r.tele]);
  const n = house({ tab: "edit", maps: [P({})], tfs: TF1 });
  n.state.activeMapId = "e1";
  root = await render(n);
  check("Edit on a plan with no rooms opens on the Rooms tool", n.state.maps._mode === "rooms", n.state.maps._mode);
  check("a new house: the Rooms Next line", !!q(root, '[data-next-line="rooms"]'), root.textContent.slice(0, 300));
  check("on the Rooms tool, the receivers' dry run is not asked", !n.calls.some(c => c.type === "padspan_ha/receivers_to_rooms"), n.calls.map(c => c.type));
  // Review 2026-11-11: rooms on the HOUSE (Layout, the rooms helper, a vacuum, Rooms from plans) count for a plan with no
  // traced outlines (setup_status.planRoomed); a finished house opens on Radios as before, with no Next line at all.
  const geo = { Kitchen: { floor_id: "main", points_m: [[0, 0], [4, 0], [4, 3]] } };
  const f = house({ tab: "edit", maps: [P({})], tfs: TF1 });
  Object.assign(f.state, { activeMapId: "e1", calibration: { points: [1, 2, 3, 4, 5].map(i => ({ id: "c" + i })) } });
  f.state.model.room_geometry_m = geo;
  f.state.model.scanner_positions_m = { aa: { x_m: 1, y_m: 1, z_m: 2.4, floor_id: "main" } };
  root = await render(f);
  check("a finished house, rooms on the house only: Radios, no Next line", f.state.maps._mode === "receivers" && !q(root, "[data-next-line]"),
    [f.state.maps._mode, root.textContent.slice(0, 300)]);
  const hr = house({ tab: "edit", maps: [P({})], tfs: TF1 });
  hr.state.activeMapId = "e1";
  hr.state.model.room_geometry_m = geo;
  root = await render(hr);
  check("house rooms on the plan's floor, no receivers: Radios, Next: the receivers (not draw its rooms)", hr.state.maps._mode === "receivers"
    && !!q(root, '[data-next-line="receivers"]') && !q(root, '[data-next-line="rooms"]'), root.textContent.slice(0, 300));
  // Review 2026-11-11 (C2): the wizard's Finish goes to Calibration as Setup's step does (its first step), not Beacon Tune.
  // Changed in review 2026-11-11 (item 13): Finish names the first step not done, so the plan has a receiver here and
  // calibrating is that step (it said "Go to Calibration" whatever was left).
  const fin = house({ tab: "edit", maps: [P({ room_bounds: ROOM, receivers: [{ id: "r1", source: "AA:BB" }] })], tfs: TF1, wizard: { step: 5, mapId: "e1" } });
  const finR = await render(fin);
  button(finR, "Go to Calibration →").click();
  check("Finish: Go to Calibration opens Setup's calibration step", fin.state._openedStep === "calibration" && fin.state._calibTabRequest !== "beacon"
    && !fin.state._mapsWizard, [fin.state._openedStep, fin.state._calibTabRequest]);
  // Review 2026-11-11 (B1): an area with no floor in Home Assistant is offered on every floor's plan; one on another
  // floor only is not; with none to choose, the step says so and makes one in Home Assistant on this plan's floor.
  const withAreas = async (areas) => {
    const x = house({ tab: "edit", maps: [P({ floor_id: "ground" })], tfs: TF1 });
    x.state.activeMapId = "e1"; x.state.model.areas = areas;
    const r = await render(x);
    return { x, r, rooms: all(r, "select").flatMap(s => s.children.map(op => op.value)).filter(v => ["Kitchen", "Den"].includes(v)), box: q(r, '[data-area-add="box"]') };
  };
  const fl = await withAreas([{ id: "kitchen", name: "Kitchen", floor_id: null }, { id: "den", name: "Den", floor_id: "upper" }]);
  const other = await withAreas([{ id: "den", name: "Den", floor_id: "upper" }]), none = await withAreas([]);
  check("rooms: a floorless area on every floor's list, another floor's not", JSON.stringify(fl.rooms) === '["Kitchen"]' && !fl.box, fl.rooms);
  check("rooms: none to choose, said, with Add to Home Assistant", !!other.box && other.rooms.length === 0 && !!none.box, [other.rooms, !!none.box]);
  q(none.r, '[data-area-add="name"]').value = "Kitchen";
  q(none.r, '[data-area-add="go"]').click();
  for (let i = 0; i < 4; i++) await tick();
  const add = none.x.calls.find(c => c.type === "padspan_ha/area_add");
  check("rooms: Add to Home Assistant makes the area on this plan's floor", add && add.name === "Kitchen" && add.floor_id === "ground", add);
  const o = house({ tab: "edit", maps: [P({ id: "o1", floor_id: "__outside__", room_bounds: ROOM })], tfs: { o1: TF1.e1 } });
  o.state.activeMapId = "o1";
  root = await render(o);
  check("an Outside plan with rooms and no receivers: no Next line", !q(root, "[data-next-line]"), root.textContent.slice(0, 300));
  // In the wizard: Save goes on to its rooms step, which says the scale is set; its Next names the next step.
  const w = house({ maps: [P({})], wizard: { step: 2, mapId: "e1" } });
  let wr = await render(w);
  tap(wr, 80, 300); wr = await render(w); tap(wr, 480, 300); await tick(); wr = await render(w);
  await typeIn(wr, "scale-length", "5 m");
  q(wr, '[data-nudge="save"]').click();
  for (let i = 0; i < 4; i++) await tick();
  wr = await render(w);
  check("wizard: Save goes on to Draw rooms, saying the scale is set", w.state._mapsWizard.step === 3 && !!q(wr, '[data-next-line="scale-set"]')
    && !!button(wr, "Next: place the receivers →"), [w.state._mapsWizard, wr.textContent.slice(0, 400)]);
}

// ── A second length the other way that disagrees: said plainly; both saved ──
{
  const h = house({ tab: "edit", maps: [{ id: "n2", name: "Upstairs", floor_id: "main", image: { width: 1000, height: 800 }, scale_nudge: true }] });
  h.state.activeMapId = "n2";
  let root = await render(h);
  tap(root, 80, 300); root = await render(h); tap(root, 480, 300); await tick(); root = await render(h);
  await typeIn(root, "scale-length", "5 m");
  q(root, '[data-nudge="second"]').click();
  root = await render(h);
  check("second: the first kept, drawn quietly, its own field", !!q(root, '[data-aiw="scale-length-2"]') && root.innerHTML !== undefined
    && JSON.stringify(h.state._scaleNudge.first) === JSON.stringify({ text: "5 m", p1: [0.1, 0.5], p2: [0.6, 0.5] }), h.state._scaleNudge);
  check("second: Save waits for it", q(root, '[data-nudge="save"]').disabled === true);
  tap(root, 400, 75); root = await render(h); tap(root, 400, 375); await tick(); root = await render(h);   // (0.5, 0.125) to (0.5, 0.625): 400 px down
  await typeIn(root, "scale-length-2", "5 m");                // 400 px called 5 m, against 500 px for 5 m
  const off = q(root, '[data-nudge="differs"]');
  check("second: two lengths that disagree are said", off && off.textContent.includes("don't agree") && off.textContent.includes("stretched"), root.textContent.slice(0, 1200));
  q(root, '[data-nudge="save"]').click();
  for (let i = 0; i < 4; i++) await tick();
  const sv = h.calls.find(c => c.type === "padspan_ha/maps_scale_measure" && c.save);
  check("second: both saved, counted measured_two", sv && sv.measures.length === 2 && count(h, "measured_two") === 1, [sv, h.tele]);
  // Two that agree: said as agreeing.
  const g = house({ tab: "edit", maps: [{ id: "n4", name: "Up", floor_id: "main", image: { width: 1000, height: 800 }, scale_nudge: true }] });
  g.state.activeMapId = "n4";
  let gr = await render(g);
  tap(gr, 80, 300); gr = await render(g); tap(gr, 480, 300); await tick(); gr = await render(g);
  await typeIn(gr, "scale-length", "5 m");
  q(gr, '[data-nudge="second"]').click(); gr = await render(g);
  tap(gr, 400, 75); gr = await render(g); tap(gr, 400, 375); await tick(); gr = await render(g);
  await typeIn(gr, "scale-length-2", "4 m");
  check("second: two that agree are said to agree", !!q(gr, '[data-nudge="agrees"]') && !q(gr, '[data-nudge="differs"]'), gr.textContent.slice(0, 1200));
}

// ── Later: ended for good, said to the server, counted; never shown again ──
{
  const h = house({ tab: "edit", maps: [{ id: "n3", name: "Basement", floor_id: "main", image: { width: 1000, height: 800 }, scale_nudge: true }] });
  h.state.activeMapId = "n3";
  let root = await render(h);
  q(root, '[data-nudge="later"]').click();
  await tick();
  root = await render(h);
  check("Later: the server told, counted, the nudge gone", h.calls.some(c => c.type === "padspan_ha/maps_scale_nudge_end" && c.map_id === "n3")
    && count(h, "later") === 1 && !q(root, '[data-nudge="card"]') && !N.pending(h.ctx, h.state.maps.list[0]), h.tele);
  check("Later: shown once only", count(h, "shown") === 1, h.tele);
}

// ── Basic: no nudge card; the Setup Wizard's own scale step on the new plan. In the wizard: nothing more ──
{
  const h = house({ complexity: "basic" });
  const up = await upload(h);
  check("basic: no nudge mark; the wizard's scale step opens on the plan", up && !("scale_nudge" in up) && h.state._mapsWizard
    && h.state._mapsWizard.step === 2 && h.state._mapsWizard.mapId === "up1", [up, h.state._mapsWizard]);
  const w = house({ wizard: { step: 1, mapId: null } });
  const wu = await upload(w);
  check("in the wizard: no nudge mark, the wizard goes on by itself", wu && !("scale_nudge" in wu) && w.state._mapsWizard.step === 1 && count(w, "shown") === 0, [wu, w.state._mapsWizard]);
  const o = house();
  const ou = await upload(o, "__outside__");
  check("an Outside plan: no nudge", ou && !("scale_nudge" in ou), ou);
}

// ── The quiet reminder: Library and Setup, one line, its Measure ──
const plain = () => [{ id: "p1", name: "Ground", floor_id: "main", image: { width: 1000, height: 800 }, receivers: [], room_bounds: {} },
  { id: "p2", name: "Scaled", floor_id: "main", image: { width: 1000, height: 800 }, receivers: [], room_bounds: {} }];
const TF = { p2: { scale_x_m: 10, scale_y_m: 8, reference_measurements: [{}] } };
{
  const h = house({ maps: plain(), tfs: TF });
  let root = await render(h);
  const lines = all(root, '[data-nudge="reminder"]');
  check("Library: one quiet line, on the plan with no scale only", lines.length === 1 && lines[0].textContent.includes("No scale yet"), lines.map(l => l.textContent));
  button(lines[0], "Measure").click();
  // 2026-11-13 (D1): a plan's first scale is the one-length screen wherever it is asked for; it used to open Edit → Measure.
  check("Library: its Measure counted, the plan opened on the one-length screen", count(h, "reminder_measure") === 1 && h.state.mapsTab === "edit"
    && h.state.activeMapId === "p1" && h.state._firstScale && h.state._firstScale.door === "reminder", [h.tele, h.state.mapsTab, h.state._firstScale]);
  root = await render(h);
  check("Library: Edit shows the one-length screen, with Later, not Edit → Measure", !!q(root, '[data-nudge="card"]') && !!q(root, '[data-nudge="later"]')
    && !root.textContent.includes("Measurement 1 of 2") && root.textContent.includes("Ground has no scale yet"), root.textContent.slice(0, 300));
  tap(root, 80, 300); root = await render(h); tap(root, 480, 300); await tick(); root = await render(h);
  await typeIn(root, "scale-length", "5 m");
  q(root, '[data-nudge="save"]').click();
  for (let i = 0; i < 4; i++) await tick();
  check("Library: Save counts the door it came through", count(h, "via_reminder") === 1 && count(h, "measured_one") === 1, h.tele);
  // Review 2026-11-11: "is uploaded" only on the upload's own screen; a flagged plan opened by another door has no scale yet.
  const f = house({ maps: plain().map(m => (m.id === "p1" ? { ...m, scale_nudge: true } : m)), tfs: TF });
  f.state._firstScale = { mapId: "p1", door: "reminder" };
  Object.assign(f.state, { mapsTab: "edit", activeMapId: "p1" });
  const fr = await render(f);
  check("a flagged plan by another door: has no scale yet, not uploaded", fr.textContent.includes("Ground has no scale yet") && !fr.textContent.includes("is uploaded"),
    fr.textContent.slice(0, 200));
  // Review 2026-11-11 (B2): the panel renders at once on mapsSetActive, still on the Library, before Edit is set: the
  // Library's Measure must still open the one-length screen (it opened Edit → Rooms).
  {
    const ri = house({ maps: plain(), tfs: TF });
    ri.ctx.actions.mapsSetActive = (id) => { ri.state.activeMapId = id; MAPS.render(ri.ctx); };
    ri.ctx.actions.setMapsTab = (t) => { ri.state.mapsTab = t; MAPS.render(ri.ctx); };
    let rr = await render(ri);
    button(all(rr, '[data-nudge="reminder"]')[0], "Measure").click();
    rr = await render(ri);
    check("Library (Advanced), the panel rendering at once: Measure opens the one-length screen", !!q(rr, '[data-nudge="card"]')
      && ri.state.mapsTab === "edit" && ri.state.activeMapId === "p1", [ri.state.mapsTab, rr.textContent.slice(0, 200)]);
  }
  // Later on a screen a door opened: back to Edit on that plan.
  const l = house({ maps: plain(), tfs: TF });
  let lr = await render(l);
  button(all(lr, '[data-nudge="reminder"]')[0], "Measure").click();
  lr = await render(l);
  q(lr, '[data-nudge="later"]').click(); await tick();
  lr = await render(l);
  check("Library: Later leaves the screen for Edit on that plan", !l.state._firstScale && !q(lr, '[data-nudge="card"]') && l.state.mapsTab === "edit", l.state._firstScale);
  // A plan that has a scale is measured again in Edit → Measure, as before.
  const m2 = house({ maps: plain(), tfs: TF, wizard: { step: 2, mapId: "p2" } });
  const mr = await render(m2);
  check("a plan with a scale: the wizard's scale step is Edit → Measure", !q(mr, '[data-nudge="card"]') && mr.textContent.includes("Measurement 1 of 2")
    && mr.textContent.includes("This plan has a scale"), mr.textContent.slice(0, 400));
  // Review 2026-11-11: an Outside plan with no scale gets no one-length screen; its step says what is true.
  const ow = house({ maps: [{ ...plain()[0], floor_id: "__outside__" }], tfs: {}, wizard: { step: 2, mapId: "p1" } });
  const owr = await render(ow);
  check("an unscaled Outside plan: the scale step says it has no scale yet", !owr.textContent.includes("This plan has a scale")
    && owr.textContent.includes("This plan has no scale yet"), owr.textContent.slice(0, 400));
  // The wizard's scale step on a plan with none: the one-length screen, no Later (the wizard's Skip is there), counted by its door.
  for (const cx of ["basic", "advanced"]) {
    const g = house({ complexity: cx, maps: plain(), tfs: TF, wizard: { step: 2, mapId: "p1" } });
    g.state._setupReturn = "scale";
    let gr = await render(g);
    check(`${cx}: the wizard's scale step on a plan with no scale is the one-length screen, says one distance, no Later`, !!q(gr, '[data-nudge="card"]')
      && !q(gr, '[data-nudge="later"]') && !gr.textContent.includes("Measurement 1 of 2") && gr.textContent.includes("Measure one distance you know"),
      gr.textContent.slice(0, 400));
    // Review 2026-11-13, break 7: Basic has no Edit → Measure; it is told Setup's scale step.
    check(`${cx}: where to measure again, in words for the mode`, cx === "basic" ? gr.textContent.includes(N.SAVE_SAYS_BASIC) && !gr.textContent.includes("Edit → Measure")
      : gr.textContent.includes(N.SAVE_SAYS), gr.textContent.slice(-300));
    tap(gr, 80, 300); gr = await render(g); tap(gr, 480, 300); await tick(); gr = await render(g);
    await typeIn(gr, "scale-length", "5 m");
    q(gr, '[data-nudge="save"]').click();
    for (let i = 0; i < 4; i++) await tick();
    check(`${cx}: saved from Setup's door, counted so`, count(g, "via_setup") === 1 && g.calls.some(c => c.type === "padspan_ha/maps_scale_measure" && c.save && c.map_id === "p1"), g.tele);
  }
  // Basic's upload: the wizard's scale step, the one-length screen, counted as after an upload.
  const bu = house({ complexity: "basic" });
  await upload(bu);
  let br = await render(bu);
  check("basic upload: the wizard's scale step shows the one-length screen", !!q(br, '[data-nudge="card"]') && bu.state._mapsWizard.door === "upload"
    && br.textContent.includes("is uploaded"), [bu.state._mapsWizard, br.textContent.slice(0, 300)]);
  const s = house({ maps: plain(), tfs: TF });
  s.state.view = "setup";
  const sr = SETUP.render(s.ctx);
  const sl = all(sr, '[data-nudge="reminder"]');
  check("Setup: the line under Set the scale, naming the plan", sl.length === 1 && sl[0].textContent.includes("No scale yet: Ground")
    && !!q(sr, '[data-setup="step-scale"]').querySelector('[data-nudge="reminder"]'), sl.map(l => l.textContent));
  button(sl[0], "Measure").click();
  check("Setup: its Measure opens the scale step on that plan", count(s, "reminder_measure") === 1 && s.state._mapsWizard
    && s.state._mapsWizard.step === 2 && s.state._mapsWizard.mapId === "p1", s.state._mapsWizard);
}

// ── Nothing for a non-admin, in Sample, or on a wall screen ──
for (const [name, o] of [["non-admin", { admin: false }], ["Sample", { dataMode: "sample" }], ["wall screen", { kiosk: true }]]) {
  const h = house({ ...o, maps: [{ ...plain()[0], scale_nudge: true }] });
  const m = h.state.maps.list[0];
  check(`${name}: no nudge, no reminder`, !N.pending(h.ctx, m) && !N.reminderLine(h.ctx, m, () => {}), name);
  if (name !== "Sample") {
    const root = await render(h);
    h.state.mapsTab = "edit"; h.state.activeMapId = m.id;
    check(`${name}: the Library has no line`, !q(root, '[data-nudge="reminder"]'), root.textContent.slice(0, 200));
    check(`${name}: nothing counted`, !h.tele.some(t => t.startsWith("scale_nudge:")), h.tele);
  }
}

// ── Receivers where receivers are placed (review 2026-11-13, breaks 3 and 4): the wizard's receivers step and Edit's Radios
// carry "Put my receivers in their rooms"; the step's count is the one rule (on the house map counts) ──
{
  const SETUP_MOD = await import(pathToFileURL(join(WWW, "views", "setup.js")).href);
  for (const cx of ["basic", "advanced"]) {
    SETUP_MOD._resetReceivers();
    const h = house({ complexity: cx, ready: [{ source: "k1", room: "Kitchen" }], tfs: { r1: { scale_x_m: 10, scale_y_m: 8, reference_measurements: [{}] } },
      maps: [{ id: "r1", name: "Main", floor_id: "main", image: { width: 1000, height: 800 }, receivers: [], room_bounds: { Kitchen: { type: "poly", points: [[0.1, 0.1], [0.4, 0.1], [0.4, 0.4]] } } }],
      wizard: { step: 4, mapId: "r1" } });
    h.state.model.scanner_positions_m = { h1: { x_m: 1, y_m: 1, z_m: 2.4, floor_id: "main" } };
    await render(h); await tick();
    const root = await render(h);
    const cnt = q(root, '[data-wizard-count="receivers"]');
    check(`${cx}: the wizard's receivers step has the button`, !!q(root, '[data-setup="receivers-place"]'), root.textContent.slice(0, 500));
    // One vocabulary (review 2026-11-13): the wizard's chips are Setup's steps, numbered and named as Setup does.
    // Changed in review 2026-11-11 (C8): a done step's chip starts with "✓ " (Setup's rule), so the mark is read too.
    const chips = all(root, "button").map(b => b.textContent).filter(t => /^(✓ )?\d\. |^Finish$/.test(t));
    const want = SETUP_MOD.deriveSetup(h.state).steps.filter(x => x.id !== "calibration").map(x => `${x.done ? "✓ " : ""}${x.n}. ${x.label}`).concat(["Finish"]);
    check(`${cx}: the wizard's chips are Setup's numbers and names`, JSON.stringify(chips) === JSON.stringify(want), [chips, want]);
    check(`${cx}: its count includes a receiver on the house map, and says where it is moved`, cnt && cnt.textContent.startsWith("1 receiver placed on this floor.")
      && cnt.textContent.includes("Check receiver positions"), cnt && cnt.textContent);
  }
  SETUP_MOD._resetReceivers();
}

// ── D5 (2026-11-13): one order in every list. A one-floor house: rooms, then receivers; three floors (and an Outside):
// rooms, floor heights, receivers, the same steps and numbers in Setup, Getting started's source and the wizard ──
{
  const SETUP_MOD = await import(pathToFileURL(join(WWW, "views", "setup.js")).href);
  const STATUS = await import(pathToFileURL(join(WWW, "views", "setup_status.js")).href);
  const ROOM = { Kitchen: { type: "poly", points: [[0.1, 0.1], [0.4, 0.1], [0.4, 0.4]] } };
  const F3 = [{ id: "g", floor_id: "g", name: "Ground" }, { id: "u", floor_id: "u", name: "Upstairs" }, { id: "a", floor_id: "a", name: "Attic" },
    { id: "__outside__", floor_id: "__outside__", name: "Outside" }];
  for (const [name, floors, want] of [["one floor", [{ id: "main", floor_id: "main", name: "Main" }], ["plan", "scale", "rooms", "receivers", "calibration"]],
    ["three floors and Outside", F3, ["plan", "scale", "rooms", "floors", "receivers", "calibration"]]]) {
    const h = house({ maps: [{ id: "f1", name: "Main", floor_id: floors[0].id, image: { width: 1000, height: 800 }, receivers: [], room_bounds: ROOM }],
      tfs: { f1: { scale_x_m: 10, scale_y_m: 8, reference_measurements: [{}] } }, wizard: { step: 3, mapId: "f1" } });
    h.state.model.floors = floors;
    const setupIds = SETUP_MOD.deriveSetup(h.state).steps.map(x => x.id);
    check(`${name}: Setup's steps in the one order`, JSON.stringify(setupIds) === JSON.stringify(want), setupIds);
    check(`${name}: the same list Getting started reads`, JSON.stringify(STATUS.setupSteps(h.state).map(x => x.id)) === JSON.stringify(want));
    let root = await render(h);
    // Changed in review 2026-11-11 (C8): a done step's chip starts with "✓ " (Setup's rule), so the mark is read too.
    const chips0 = all(root, "button").map(b => b.textContent).filter(t => /^(✓ )?\d\. |^Finish$/.test(t));
    const chips = chips0.slice(0, chips0.indexOf("Finish") + 1);          // the head's chips (the Rooms tool has its own Finish)
    const wantChips = SETUP_MOD.deriveSetup(h.state).steps.filter(x => x.id !== "calibration").map(x => `${x.done ? "✓ " : ""}${x.n}. ${x.label}`).concat(["Finish"]);
    check(`${name}: the wizard's chips, the same steps, numbers and order`, JSON.stringify(chips) === JSON.stringify(wantChips), [chips, wantChips]);
    const nx = all(root, "button").find(b => /^Next: /.test(b.textContent));
    check(`${name}: the rooms step's Next names the next step`, nx && nx.textContent === (want.includes("floors") ? "Next: floor heights →" : "Next: place the receivers →"), nx && nx.textContent);
    nx.click();
    root = await render(h);
    check(`${name}: it goes there`, h.state._mapsWizard.step === (want.includes("floors") ? 6 : 4)
      && (want.includes("floors") ? !!q(root, '[data-wizard-step="floors"]') && root.textContent.includes("Floor Heights") : !!q(root, '[data-wizard-count="receivers"]')),
      [h.state._mapsWizard.step, root.textContent.slice(0, 300)]);
    if (want.includes("floors")) {
      all(root, "button").find(b => b.textContent === "Next: place the receivers →").click();
      root = await render(h);
      check(`${name}: floor heights, then the receivers`, h.state._mapsWizard.step === 4 && h.tele.includes("wizard_maps_step_floors"), [h.state._mapsWizard.step, h.tele]);
      all(root, "button").find(b => b.textContent === "← Back").click();
      check(`${name}: Back from the receivers is floor heights`, h.state._mapsWizard.step === 6, h.state._mapsWizard.step);
    }
    // Edit's Next line after rooms (outside the wizard): floor heights first where the house has the step.
    const e = house({ tab: "edit", maps: [{ id: "f1", name: "Main", floor_id: floors[0].id, image: { width: 1000, height: 800 }, receivers: [], room_bounds: ROOM }],
      tfs: { f1: { scale_x_m: 10, scale_y_m: 8, reference_measurements: [{}] } } });
    e.state.model.floors = floors; e.state.activeMapId = "f1";
    const er = await render(e);
    check(`${name}: Edit's Next after the rooms`, !!q(er, `[data-next-line="${want.includes("floors") ? "floors" : "receivers"}"]`), er.textContent.slice(0, 300));
  }
}

console.log(JSON.stringify({ cases, failures }));
