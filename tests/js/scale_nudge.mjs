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
const RP = await import(pathToFileURL(join(WWW, "views", "rough_plan.js")).href);

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
  // A picture said not to scale (the plan's own kind, or the screen's button): each way its own scale, for the one-across
  // one-down pair these cases draw (plan_ai_write._per_axis works any two directions out).
  const own = house.state.maps.list.find(x => x.id === p.map_id);
  if (ppms.length === 2 && (p.not_to_scale || (own && own.kind === "sketch"))) Object.assign(out, { across_m: 1000 / ppms[0], down_m: 800 / ppms[1], per_axis: true });
  if (!p.save) return out;
  house.state.model.map_transforms[p.map_id] = { scale_x_m: out.across_m, scale_y_m: out.down_m, reference_measurements: ms };
  const m = house.state.maps.list.find(x => x.id === p.map_id);
  if (m) delete m.scale_nudge;
  return { ok: true, map_id: p.map_id, scale_x_m: out.across_m, scale_y_m: out.down_m, lengths: ms.length, ...(out.per_axis ? { per_axis: true } : {}) };
}

function house(o = {}) {
  const calls = [], tele = [], renders = { n: 0 }, toasts = [];
  N._resetCounts(); RP._resetCounts();
  const state = {
    complexity: o.complexity || "advanced", mapsTab: o.tab || "library", dataMode: o.dataMode || "live", view: "maps", kioskMode: !!o.kiosk,
    settings: { setup_progress: {} }, _mapsLoaded: true, _modelLoaded: true, calibration: { points: [] },
    maps: { list: o.maps || [] }, model: { floors: [{ id: "main", floor_id: "main", name: "Main" }], map_transforms: JSON.parse(JSON.stringify(o.tfs || {})), areas: [] },
    ...(o.wizard ? { _mapsWizard: o.wizard } : {}),
  };
  const h = { calls, tele, renders, toasts, state };
  const server = {
    "padspan_ha/maps_upload": (p) => { const m = { id: "up1", name: p.name, floor_id: p.floor_id, image: { width: 1000, height: 800 }, receivers: [], room_bounds: {},
      ...(p.scale_nudge ? { scale_nudge: true } : {}), ...(p.kind ? { kind: p.kind } : {}) }; state.maps.list.push(m); return { map: m }; },
    "padspan_ha/maps_scale_measure": (p) => measure(p, h),
    "padspan_ha/maps_scale_nudge_end": () => ({ ok: true, ended: true }),
    // Carry-along (views/plan_carry.js): the plans moved with things still where they stood, and what came of an answer.
    "padspan_ha/plan_carry_list": () => ({ plans: o.carry || [] }),
    "padspan_ha/plan_carry_apply": (p) => (o.carryFails ? { ok: false, code: "backup_failed", message: "The safety backup couldn't be made, so nothing was moved." }
      : { ok: true, moved: Object.fromEntries(p.kinds.map(k => [k, k === "points" ? 32 : 1])), backup_id: "bk_1" }),
    "padspan_ha/plan_carry_dismiss": () => ({ ok: true }),
    // No plan picture (views/rough_plan.js): a blank floor of a typed size, and a plan drawn from a room scan; each has its scale.
    "padspan_ha/maps_blank_create": (p) => { if (!/m$/.test(p.across) || !/m$/.test(p.down)) return { ok: false, code: "size", message: "Type the floor's width and depth." };
      const m = { id: "bl1", name: "Blank floor", floor_id: p.floor_id, kind: "blank", image: { width: 1200, height: 900 }, receivers: [], room_bounds: {} };
      state.maps.list.push(m); state.model.map_transforms.bl1 = { scale_x_m: 12, scale_y_m: 9, reference_measurements: [{}] }; return { ok: true, map: m }; },
    "padspan_ha/maps_scan_create": (p) => { if (p.file_base64 !== "AAAAAAAAAAA=") return { ok: false, code: "not_scan", message: "Not a USDZ file (it could not be opened)" };
      const m = { id: "sc1", name: p.name || "Room scan", floor_id: p.floor_id, kind: "scan", image: { width: 500, height: 400 }, receivers: [], room_bounds: {} };
      state.maps.list.push(m); state.model.map_transforms.sc1 = { scale_x_m: 5, scale_y_m: 4, reference_measurements: [{}] }; return { ok: true, map: m, walls: 4, rooms: 1, heights_m: [2.5], warnings: [], file: "usdz", named: true, ...(o.placed ? { placed: o.placed } : {}) }; },
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
  // How far a person got (2026-11-15): each step of the screen counted once, and the upload's own words.
  check("the screen's steps: first end, both ends and a length typed, once each; no Save refused",
    count(h, "first_end") === 1 && count(h, "both_ends") === 1 && count(h, "typed") === 1 && count(h, "refused") === 0, h.tele);
  check("the upload: counted as uploaded", h.tele.filter(t => t === "plan_upload:ok").length === 1, h.tele);
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
  check("a proper plan: no sketch words, and no 'not to scale' while the lengths agree", !q(gr, '[data-nudge="sketch"]') && !q(gr, '[data-nudge="not-to-scale"]'));
  // Not to scale (2026-11-16), said by the person: two lengths that disagree offer it; each way then has its own scale.
  const two = async (hh) => {
    let r = await render(hh);
    tap(r, 80, 300); r = await render(hh); tap(r, 480, 300); await tick(); r = await render(hh);
    await typeIn(r, "scale-length", "5 m");
    q(r, '[data-nudge="second"]').click(); r = await render(hh);
    tap(r, 400, 75); r = await render(hh); tap(r, 400, 375); await tick(); r = await render(hh);
    await typeIn(r, "scale-length-2", "5 m");
    return r;
  };
  const n = house({ tab: "edit", maps: [{ id: "n5", name: "Up", floor_id: "main", image: { width: 1000, height: 800 }, scale_nudge: true }] });
  n.state.activeMapId = "n5";
  let nr = await two(n);
  check("not to scale: offered once the two lengths disagree, nothing assumed", !!q(nr, '[data-nudge="differs"]') && !!q(nr, '[data-nudge="not-to-scale"]') && !q(nr, '[data-nudge="per-axis"]'));
  q(nr, '[data-nudge="not-to-scale"]').click();
  for (let i = 0; i < 3; i++) await tick();
  nr = await render(n);
  check("not to scale: each direction its own scale, said; the disagreement no longer", !!q(nr, '[data-nudge="per-axis"]') && !q(nr, '[data-nudge="differs"]')
    && nr.textContent.includes("10.0 m") && count(n, "not_to_scale") === 1, nr.textContent.slice(0, 1200));
  q(nr, '[data-nudge="save"]').click();
  for (let i = 0; i < 4; i++) await tick();
  const ns = n.calls.find(c => c.type === "padspan_ha/maps_scale_measure" && c.save);
  check("not to scale: Save says so to the server, counted, the plan a sketch from then on", ns && ns.not_to_scale === true && count(n, "per_axis") === 1
    && n.state.maps.list.find(x => x.id === "n5").kind === "sketch", [ns, n.tele]);
  // Uploaded as a sketch: said at the top, the second length asked for in its own words, no button needed.
  const s = house({ tab: "edit", maps: [{ id: "n6", name: "Mine", floor_id: "main", image: { width: 1000, height: 800 }, scale_nudge: true, kind: "sketch" }] });
  s.state.activeMapId = "n6";
  let sr = await render(s);
  check("a sketch: said at the top of the screen", !!q(sr, '[data-nudge="sketch"]') && q(sr, '[data-nudge="sketch"]').textContent.includes("your own sketch"));
  tap(sr, 80, 300); sr = await render(s); tap(sr, 480, 300); await tick(); sr = await render(s);
  await typeIn(sr, "scale-length", "5 m");
  check("a sketch: the second length is asked for in a sketch's words", sr.textContent.includes("rarely in proportion"), sr.textContent.slice(0, 900));
  q(sr, '[data-nudge="second"]').click(); sr = await render(s);
  tap(sr, 400, 75); sr = await render(s); tap(sr, 400, 375); await tick(); sr = await render(s);
  await typeIn(sr, "scale-length-2", "5 m");
  check("a sketch: each direction its own scale with no button, and no flag sent", !!q(sr, '[data-nudge="per-axis"]') && !q(sr, '[data-nudge="not-to-scale"]')
    && !s.calls.some(c => c.not_to_scale), sr.textContent.slice(0, 1200));
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

// ── The Setup Wizard's rooms step (2026-11-15): a room's name above the plan starts it, a click with no room chosen is
// said, and a finished room is saved without Save Layout (a room drawn there, then Next and Finish, was never saved) ──
{
  const P = (o) => ({ id: "e1", name: "Main", floor_id: "main", image: { width: 1000, height: 800 }, receivers: [], room_bounds: {}, ...o });
  const TF1 = { e1: { scale_x_m: 10, scale_y_m: 8, reference_measurements: [{}] } };
  const h = house({ maps: [P({})], tfs: TF1, wizard: { step: 3, mapId: "e1" } });
  h.state.model.areas = [{ name: "Kitchen" }, { name: "Hall" }];
  const saved = [];
  h.ctx.actions.mapsUpdateQuiet = async (p) => { saved.push(JSON.parse(JSON.stringify(p))); h.state.maps.list.find(x => x.id === p.map_id).room_bounds = JSON.parse(JSON.stringify(p.room_bounds)); };
  h.ctx.actions.mapsRefreshQuiet = async () => {};
  const draws = () => h.tele.filter(t => t.startsWith("wizard_draw:"));
  let root = await render(h);
  const at = (r, type, x, y) => { const ov = q(r, ".mapstage"); ov.dispatchEvent({ type, clientX: x, clientY: y, target: ov, preventDefault() {}, stopPropagation() {} }); };
  at(root, "click", 100, 100);
  check("rooms step: a click on the plan with no room chosen is said, and counted", h.toasts.some(t => t.includes("press its name above the plan"))
    && draws().join() === "wizard_draw:no_room" && !h.state.maps._drawing, [h.toasts, h.tele]);
  check("rooms step: each room not drawn is a button above the plan", all(root, "[data-wiz-room]").map(b => b.getAttribute("data-wiz-room")).join() === "Kitchen,Hall");
  q(root, '[data-wiz-room="Kitchen"]').click();
  root = await render(h);
  check("rooms step: its name starts that room, and says what to do", h.state.maps._drawing && h.state.maps._drawing.room === "Kitchen" && !!q(root, "[data-wiz-room-now]")
    && draws().includes("wizard_draw:name"), [h.state.maps._drawing, h.tele]);
  at(root, "click", 80, 60); at(root, "click", 400, 60); at(root, "click", 400, 300); at(root, "click", 400, 300); at(root, "dblclick", 400, 300);
  for (let i = 0; i < 6; i++) await tick();
  const kb = saved.length === 1 && saved[0].room_bounds.Kitchen;
  check("rooms step: the finished room is saved without Save Layout, the double-click's corner once", kb && kb.points.length === 3 && saved[0].map_id === "e1"
    && draws().includes("wizard_draw:kept") && h.toasts.some(t => t.startsWith("Saved")), [saved, h.tele, h.toasts]);
  root = await render(h);
  check("rooms step: the drawn room leaves the names, the count says one", all(root, "[data-wiz-room]").map(b => b.getAttribute("data-wiz-room")).join() === "Hall"
    && root.textContent.includes("1 of 2 rooms drawn"), root.textContent.slice(0, 600));
  button(root, "Next: place the receivers →").click();
  for (let i = 0; i < 4; i++) await tick();
  check("rooms step: Next with nothing new saves nothing again", saved.length === 1 && h.state._mapsWizard.step === 4, [saved.length, h.state._mapsWizard]);
  // Outside the wizard, Edit keeps Save Layout: nothing is written by a finished outline.
  const e = house({ tab: "edit", maps: [P({})], tfs: TF1 });
  e.state.model.areas = [{ name: "Kitchen" }]; e.state.activeMapId = "e1";
  const wrote = [];
  e.ctx.actions.mapsUpdateQuiet = async (p) => { wrote.push(p); };
  let er = await render(e);
  e.state.maps._mode = "rooms"; e.state.maps._selectedRoom = "Kitchen";
  at(er, "click", 80, 60); at(er, "click", 400, 60); at(er, "click", 400, 300); at(er, "dblclick", 400, 300);
  for (let i = 0; i < 4; i++) await tick();
  check("Edit outside the wizard: a finished outline waits for Save Layout", wrote.length === 0 && !!e.state.maps._draftRoomBounds.Kitchen, [wrote.length, e.state.maps._draftRoomBounds]);
  // The wizard opened at its receivers step (the rooms step never shown): a receiver placed, then Back to Setup, is saved.
  const r = house({ maps: [P({})], tfs: TF1, wizard: { step: 4, mapId: "e1" } });
  const kept = [];
  r.ctx.actions.mapsUpdateQuiet = async (p) => { kept.push(JSON.parse(JSON.stringify(p))); };
  r.ctx.actions.mapsRefreshQuiet = async () => {};
  const rr = await render(r);
  at(rr, "dblclick", 300, 200);
  check("receivers step: Back to Setup has the wizard's keeper without the rooms step", typeof r.state.maps._keepDraft === "function" && r.state.maps._draftReceivers.length === 1, r.state.maps._draftReceivers);
  r.state.maps._keepDraft();
  for (let i = 0; i < 6; i++) await tick();
  check("receivers step: a placed receiver is saved on Back to Setup", kept.length === 1 && kept[0].receivers.length === 1 && kept[0].map_id === "e1", kept);
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

// ── No floor plan (views/rough_plan.js, 2026-11-16): the ways to one on Mapping → Upload, each with its steps; a sketch is
// said by a tick; a blank floor and a room scan come with their scale; the phone's walk-through of a scan ──
{
  const rough = (h) => h.tele.filter(t => t.startsWith("rough_plan:")).map(t => t.slice(11));
  const scanFile = (ok) => ({ name: "Main floor.usdz", size: 1000, arrayBuffer: async () => new ArrayBuffer(ok ? 8 : 5) });
  const pick = async (root, file) => { const f = q(root, '[data-rough="scan-file"]'); f.files = [file]; f.dispatchEvent({ type: "change" }); for (let i = 0; i < 8; i++) await tick(); };
  const h = house({ tab: "upload" });
  let root = await render(h);
  check("no plan: Upload says nothing of it until asked, a tick for a sketch, unticked", !!q(root, '[data-rough="link"]') && !q(root, '[data-rough="card"]')
    && q(root, '[data-upload="sketch"]').checked === false);
  const plain = await upload(h);
  check("a picture is a proper plan unless the person says otherwise", plain && !("kind" in plain) && !h.tele.includes("plan_upload:sketch"), plain);
  // The list, its kinds in order, one open at a time, each counted.
  const g = house({ tab: "upload" });
  root = await render(g);
  q(root, '[data-rough="link"]').click(); root = await render(g);
  check("no plan: the ways, in order", all(root, "[data-rough]").map(n => n.getAttribute("data-rough")).filter(k => k.startsWith("kind-")).join() === "kind-have,kind-scan,kind-vacuum,kind-sketch,kind-blank"
    && rough(g).join() === "seen,opened", [rough(g)]);
  q(root, '[data-rough="kind-have"]').click(); root = await render(g);
  { const kids = q(root, '[data-rough="card"]').parentNode.children;
    const ci = kids.findIndex(k => k.getAttribute && k.getAttribute("data-rough") === "card"), fi = kids.findIndex(k => k.tagName === "INPUT");
    check("no plan: the list opens straight under its button, above the upload form", ci > 0 && fi > ci, [ci, fi]); }
  check("no plan: a way opens its steps", !!q(root, '[data-rough="steps-have"]') && q(root, '[data-rough="steps-have"]').textContent.includes("real-estate listing"));
  // A sketch: its steps, then back to the upload with the tick set; the upload says so and is counted.
  q(root, '[data-rough="kind-sketch"]').click(); root = await render(g);
  q(root, '[data-rough="sketch-go"]').click(); root = await render(g);
  check("a sketch: the upload's tick is set, the list closed", q(root, '[data-upload="sketch"]').checked === true && !q(root, '[data-rough="card"]') && rough(g).includes("sketch_upload"));
  const sk = await upload(g);
  check("a sketch: uploaded as one, counted, the tick spent", sk && sk.kind === "sketch" && g.tele.includes("plan_upload:sketch") && !g.state._mapsUploadSketch, [sk, g.tele]);
  // A blank floor: a size refused is said; a good one is made on the chosen floor and opens for its rooms.
  const b = house({ tab: "upload" });
  b.state._mapsUploadFloorId = "main";
  root = await render(b);
  q(root, '[data-rough="link"]').click(); root = await render(b);
  q(root, '[data-rough="kind-blank"]').click(); root = await render(b);
  await typeIn(root, "blank-across", "twelve"); await typeIn(root, "blank-down", "9 m");
  q(root, '[data-rough="blank-go"]').click(); for (let i = 0; i < 6; i++) await tick(); root = await render(b);
  check("a blank floor: a size that can't be read is said, nothing made", root.textContent.includes("Type the floor's width and depth") && rough(b).includes("blank_refused") && !b.state.maps.list.length);
  await typeIn(root, "blank-across", "12 m");
  q(root, '[data-rough="blank-go"]').click(); for (let i = 0; i < 8; i++) await tick();
  const bc = b.calls.filter(c => c.type === "padspan_ha/maps_blank_create").pop();
  check("a blank floor: made on the chosen floor, opened in Edit, counted", bc && bc.floor_id === "main" && bc.across === "12 m" && bc.down === "9 m"
    && b.state.activeMapId === "bl1" && b.state.mapsTab === "edit" && rough(b).includes("blank_made"), [bc, b.state.mapsTab, rough(b)]);
  root = await render(b);
  check("a blank floor: it has its scale, so no scale is asked for", !q(root, '[data-nudge="card"]'), root.textContent.slice(0, 300));
  // A room scan from the list: read by the server, the plan opened; in Basic the Setup Wizard's rooms step.
  const s = house({ tab: "upload", complexity: "basic" });
  s.state._mapsUploadFloorId = "main";
  root = await render(s);
  q(root, '[data-rough="link"]').click(); root = await render(s);
  check("basic: no robot-vacuum way while its setting is off", !q(root, '[data-rough="kind-vacuum"]') && !!q(root, '[data-rough="kind-scan"]'));
  q(root, '[data-rough="kind-scan"]').click(); root = await render(s);
  check("a scan: its steps, the file, the walk-through and its address for the phone", !!q(root, '[data-rough="scan-file"]') && !q(root, '[data-rough="scan-file"]').getAttribute("accept")
    && !!q(root, '[data-rough="walk-go"]') && String(q(root, '[data-rough="walk-link"]').value).includes("/padspan-ha?view=maps&guide=scan") && !!q(root, '[data-rough="walk-copy"]'));
  check("a scan: it asks its own floor, starting on the upload form's; nothing points elsewhere on the page", !!q(root, '[data-rough="floor"]') && s.state._roughPlan.floor === "main"
    && !/above/.test(q(root, '[data-rough="card"]').textContent), q(root, '[data-rough="card"]').textContent.slice(0, 600));
  await pick(root, scanFile(false)); root = await render(s);
  check("a scan: a file that isn't one is said, nothing made", root.textContent.includes("could not be opened") && rough(s).includes("scan_refused") && !s.state.maps.list.length, root.textContent.slice(0, 400));
  await pick(root, scanFile(true));
  const sc = s.calls.filter(c => c.type === "padspan_ha/maps_scan_create").pop();
  check("a scan: sent with its floor and name, the plan opened on its rooms step", sc && sc.floor_id === "main" && sc.name === "Main floor" && s.state.activeMapId === "sc1"
    && s.state._mapsWizard && s.state._mapsWizard.step === 3 && s.state._mapsWizard.mapId === "sc1" && rough(s).includes("scan_made"), [sc, s.state._mapsWizard, rough(s)]);
  // Told in full (owner, 2026-11-16: "no maps means not purchasing"): the button seen, why a scan was refused, what a read one held.
  check("a scan: counted in full: seen once, the refusal's reason, the file's kind, its walls as a band, named", rough(s).filter(w => w === "seen").length === 1
    && rough(s).includes("scan_refused_not_scan") && ["scan_usdz", "scan_walls_1_4", "scan_named"].every(w => rough(s).includes(w)) && !rough(s).includes("scan_phone"), rough(s));
  // Autoplace, said: where the scan was put, the two sizes, a drawn room that is off, an outline fitting both ways; not placed.
  for (const [name, placed, says, words] of [
    ["placed", { fit: true, room: "Kitchen", score: 0.97, fits_both_ways: false, size_scan_m: [4, 3], size_room_m: [4.05, 3] }, ["placed over Kitchen", "4.0 m by 3.0 m", "drawn 4.0 m by 3.0 m"], ["scan_placed"]],
    ["placed, the drawn room off, both ways", { fit: true, room: "Study", score: 0.9, fits_both_ways: true, size_scan_m: [5.3, 4.9], size_room_m: [3.6, 5.1] },
      ["placed over Study", "the drawn room is off", "fits both ways round"], ["scan_placed_both", "scan_size_differs"]],
    ["not placed", { fit: false }, ["couldn't be matched to this floor's rooms", "3D Stack"], ["scan_unplaced"]]]) {
    const a = house({ tab: "upload", placed });
    let ar = await render(a);
    q(ar, '[data-rough="link"]').click(); ar = await render(a);
    q(ar, '[data-rough="kind-scan"]').click(); ar = await render(a);
    await pick(ar, scanFile(true));
    const toast = a.toasts.join(" ");
    check(`autoplace, ${name}: said, and counted`, says.every(w => toast.includes(w)) && words.every(w => rough(a).includes(w))
      && (name !== "placed" || (!toast.includes("is off") && !rough(a).includes("scan_size_differs"))), [toast, rough(a)]);
  }
  // The walk-through: the whole of Mapping while it runs, one step a screen, the floor chosen on its last, done said.
  const w = house({ tab: "library", complexity: "basic" });
  w.state._roughPlan = { open: false, kind: null, across: "", down: "", busy: false, msg: "", walk: 0, linked: true };      // as the link ?view=maps&guide=scan sets it
  root = await render(w);
  check("walk-through: only it is shown, at its first step", !!q(root, '[data-rough="walk"]') && q(root, '[data-rough="walk-step"]').textContent.includes("step 1 of 6")
    && !q(root, ".tabs") && !q(root, '[data-rough="walk-back"]'), root.textContent.slice(0, 300));
  for (let i = 0; i < 5; i++) { q(root, '[data-rough="walk-next"]').click(); root = await render(w); }
  check("walk-through: the last step asks the floor and the file, no Next", q(root, '[data-rough="walk-step"]').textContent.includes("step 6 of 6") && !!q(root, '[data-rough="floor"]')
    && !!q(root, '[data-rough="scan-file"]') && !q(root, '[data-rough="walk-next"]') && !!q(root, '[data-rough="walk-back"]'));
  await pick(root, scanFile(false)); root = await render(w);
  check("walk-through: a wrong file is said, with what to check", root.textContent.includes("could not be opened") && root.textContent.includes("USDZ file the scanning app saved"));
  await pick(root, scanFile(true)); root = await render(w);
  const wc = w.calls.filter(c => c.type === "padspan_ha/maps_scan_create").pop();
  check("walk-through: the scan is in, on the floor chosen, and Done is said with what comes next", wc && wc.floor_id === "main" && !!q(root, '[data-rough="walk-done"]')
    && root.textContent.includes("4 walls") && root.textContent.includes("easier on a computer"), root.textContent.slice(0, 400));
  q(root, '[data-rough="walk-see"]').click(); for (let i = 0; i < 6; i++) await tick(); root = await render(w);
  check("walk-through: counted: opened by its address, each screen reached once, finished; not closed early", ["walk", "walk_link", "walk_2", "walk_3", "walk_4", "walk_5", "walk_6", "walk_done"]
    .every(k => rough(w).filter(x => x === k).length === 1) && !rough(w).includes("walk_closed"), rough(w));
  check("walk-through: See the plan ends it on that plan", !q(root, '[data-rough="walk"]') && w.state.activeMapId === "sc1" && w.state._roughPlan.walk === null, [w.state.activeMapId, w.state._roughPlan]);
  { const c = house({ tab: "library" });
    c.state._roughPlan = { open: false, kind: null, across: "", down: "", busy: false, msg: "", walk: 0 };
    let cr = await render(c);
    q(cr, '[data-rough="walk-next"]').click(); cr = await render(c);
    q(cr, '[data-rough="walk-close"]').click(); cr = await render(c);
    check("walk-through: closed before the end is counted, with how far it got", rough(c).join() === "walk_2,walk_closed" && !q(cr, '[data-rough="walk"]'), rough(c)); }
  // Never on the demo house, for a non-admin or on a wall screen.
  // The demo house and a non-administrator are told why, with a way out (the person holding the phone may not be one).
  for (const [name, o, says] of [["Sample", { dataMode: "sample" }, "demo house"], ["non-admin", { admin: false }, "needs an administrator"]]) {
    const x = house({ tab: "upload", ...o });
    x.state._roughPlan = { open: true, kind: "scan", across: "", down: "", busy: false, msg: "", walk: 0 };
    let xr = await render(x);
    const said = !q(xr, '[data-rough="walk"]') && !!q(xr, '[data-rough="walk-no"]') && q(xr, '[data-rough="walk-no"]').textContent.includes(says) && !q(xr, '[data-rough="scan-file"]');
    q(xr, '[data-rough="walk-close"]').click(); xr = await render(x);
    check(`${name}: no walk-through, said why, Close leaves it`, said && x.state._roughPlan.walk === null && !q(xr, '[data-rough="walk-no"]'), xr.textContent.slice(0, 200));
  }
  { const x = house({ tab: "upload", kiosk: true });
    x.state._roughPlan = { open: true, kind: "scan", across: "", down: "", busy: false, msg: "", walk: 0 };
    const xr = await render(x);
    check("wall screen: no walk-through, nothing said", !q(xr, '[data-rough="walk"]') && !q(xr, '[data-rough="walk-no"]') && x.state._roughPlan.walk === null); }
  { const x = house({ tab: "upload", dataMode: "sample" });           // the first draw, before the server has said which house this is
    x.state._dataModeKnown = false;
    x.state._roughPlan = { open: false, kind: null, across: "", down: "", busy: false, msg: "", walk: 0, linked: true };
    let xr = await render(x);
    const waited = !!q(xr, '[data-rough="walk-wait"]') && x.state._roughPlan.walk === 0;
    x.state._dataModeKnown = true; x.state.dataMode = "live"; xr = await render(x);
    check("the link's walk-through waits for the house to be known, then shows", waited && !!q(xr, '[data-rough="walk"]'), xr.textContent.slice(0, 200)); }
  const sm = house({ tab: "upload", dataMode: "sample" });
  const smr = await render(sm);
  check("Sample: no ways to a plan, no sketch tick", !q(smr, '[data-rough="link"]') && !q(smr, '[data-upload="sketch"]'));
}

// ── Carry-along (views/plan_carry.js, 2026-11-16): a moved plan's line in the Library; nothing ticked; only the ticked move ──
{
  const carry = (h) => h.tele.filter(t => t.startsWith("plan_carry:")).map(t => t.slice(11));
  const PL = [{ id: "c1", name: "Study", floor_id: "main", image: { width: 1000, height: 800 }, receivers: [], room_bounds: {} },
              { id: "c2", name: "Main", floor_id: "main", image: { width: 1000, height: 800 }, receivers: [], room_bounds: {} }];
  const TFS = { c1: { scale_x_m: 10, scale_y_m: 8, reference_measurements: [{}] }, c2: { scale_x_m: 10, scale_y_m: 8, reference_measurements: [{}] } };
  const C1 = { map_id: "c1", name: "Study", floor_id: "main", at: "2026-11-16T00:00:00Z", shift_m: 1.7, rooms: ["Office"], receivers: 3, points: 32, points_hand: 13, devices: 0, walls: 2, beacons: 0, zones: 0 };
  const open = async (o) => { const h = house({ tab: "library", maps: JSON.parse(JSON.stringify(PL)), tfs: TFS, ...o }); await render(h); for (let i = 0; i < 4; i++) await tick(); return [h, await render(h)]; };
  let [h, root] = await open({ carry: [C1] });
  const lines = all(root, '[data-carry="line"]');
  check("carry: the moved plan's row says what still stands where it was; no other row says anything", lines.length === 1
    && lines[0].textContent.includes("1 room, 3 receivers, 32 calibration points and 2 signal walls placed on it still stand where it used to be, up to 1.7 m off")
    && !q(root, '[data-carry="card"]') && carry(h).join() === "offered" && h.calls.filter(c => c.type === "padspan_ha/plan_carry_list").length === 1, [lines.map(l => l.textContent), carry(h)]);
  q(root, '[data-carry="review"]').click(); root = await render(h);
  const ticks = ["rooms", "receivers", "points", "devices"].map(k => q(root, `[data-carry="tick-${k}"]`));
  check("carry: its list, nothing ticked, no line for a kind it has none of, Move waiting for a tick", ticks[0] && ticks[1] && ticks[2] && !ticks[3]
    && ticks.slice(0, 3).every(t => t.checked === false) && q(root, '[data-carry="apply"]').disabled === true
    && q(root, '[data-carry="card"]').textContent.includes("13 placed by hand") && q(root, '[data-carry="card"]').textContent.includes("Nothing is ticked for you, and a backup is taken first"),
    q(root, '[data-carry="card"]') && q(root, '[data-carry="card"]').textContent.slice(0, 500));
  ticks[1].checked = true; ticks[1].dispatchEvent({ type: "change" }); root = await render(h);
  q(root, '[data-carry="apply"]').click(); for (let i = 0; i < 8; i++) await tick(); root = await render(h);
  const ap = h.calls.find(c => c.type === "padspan_ha/plan_carry_apply");
  check("carry: only the ticked kind is asked for; said, counted, the line gone", ap && JSON.stringify(ap.kinds) === '["receivers"]' && ap.map_id === "c1"
    && h.toasts.some(t => t.includes("Moved 1 thing with the plan") && t.includes("backup")) && ["opened", "moved", "moved_receivers"].every(w => carry(h).includes(w))
    && !carry(h).includes("moved_points") && !q(root, '[data-carry="line"]'), [ap, h.toasts, carry(h)]);
  // A refusal (no backup) is said and nothing is forgotten; Leave ends it without a move.
  [h, root] = await open({ carry: [C1], carryFails: true });
  q(root, '[data-carry="review"]').click(); root = await render(h);
  const t2 = q(root, '[data-carry="tick-points"]'); t2.checked = true; t2.dispatchEvent({ type: "change" }); root = await render(h);
  q(root, '[data-carry="apply"]').click(); for (let i = 0; i < 8; i++) await tick(); root = await render(h);
  check("carry: a move refused is said, counted, and still offered", root.textContent.includes("safety backup couldn't be made") && carry(h).includes("refused") && !!q(root, '[data-carry="line"]'));
  q(root, '[data-carry="leave"]').click(); for (let i = 0; i < 4; i++) await tick(); root = await render(h);
  check("carry: Leave them where they are ends it, moving nothing", !q(root, '[data-carry="line"]') && h.calls.some(c => c.type === "padspan_ha/plan_carry_dismiss" && c.map_id === "c1")
    && carry(h).includes("dismissed") && h.calls.filter(c => c.type === "padspan_ha/plan_carry_apply").length === 1);
  for (const [name, o] of [["Sample", { dataMode: "sample" }], ["non-admin", { admin: false }], ["wall screen", { kiosk: true }]]) {
    const [x, xr] = await open({ carry: [C1], ...o });
    check(`${name}: no carry line, and the list never asked for`, !q(xr, '[data-carry="line"]') && !x.calls.some(c => c.type === "padspan_ha/plan_carry_list"));
  }
}

// ── Rooms on a scanned plan (rough_plan.scanCorner / scanRoomAt, 2026-11-16): a corner lands on a scanned wall end; a
// scanned outline can be taken whole; nothing of it on a plan that is no scan ──
{
  const SC = { kind: "scan", image: { width: 1000, height: 500 }, scan: { rooms: [
    { name: null, points: [[0.1, 0.1], [0.9, 0.1], [0.9, 0.9], [0.1, 0.9]] }, { name: "Closet", points: [[0.1, 0.1], [0.3, 0.1], [0.3, 0.4], [0.1, 0.4]] }] } };
  check("scan rooms: a click near a scanned corner lands on it, by the picture's own shape; one further off stays where it was",
    JSON.stringify(RP.scanCorner(SC, 0.905, 0.11)) === "[0.9,0.1]" && RP.scanCorner(SC, 0.9, 0.13) && RP.scanCorner(SC, 0.9, 0.15) === null && RP.scanCorner(SC, 0.5, 0.5) === null,
    [RP.scanCorner(SC, 0.905, 0.11), RP.scanCorner(SC, 0.9, 0.13), RP.scanCorner(SC, 0.9, 0.15)]);
  const inner = RP.scanRoomAt(SC, 0.2, 0.2), outer = RP.scanRoomAt(SC, 0.6, 0.6);
  check("scan rooms: the outline clicked in is given, the smaller where two overlap, none outside them all",
    inner && inner.length === 4 && inner[2][0] === 0.3 && outer && outer[1][0] === 0.9 && RP.scanRoomAt(SC, 0.95, 0.95) === null && inner !== SC.scan.rooms[1].points, [inner, outer]);
  const WE = { ...SC, scan: { ...SC.scan, corners: [[0.12, 0.12], [0.88, 0.12]] } };
  check("scan rooms: where the walls' own ends were kept, a corner lands on those and not on the outline's",
    JSON.stringify(RP.scanCorner(WE, 0.11, 0.11)) === "[0.12,0.12]" && RP.scanCorner(WE, 0.9, 0.9) === null, [RP.scanCorner(WE, 0.11, 0.11), RP.scanCorner(WE, 0.9, 0.9)]);
  check("scan rooms: a plan that is no scan, or a scan with its outlines gone, offers neither",
    !RP.hasScanRooms({ kind: "sketch", scan: SC.scan }) && !RP.hasScanRooms({ kind: "scan" }) && RP.hasScanRooms(SC)
    && RP.scanCorner({ kind: "sketch", scan: SC.scan }, 0.9, 0.1) === null && RP.scanRoomAt({ kind: "scan" }, 0.5, 0.5) === null);
}

console.log(JSON.stringify({ cases, failures }));
