// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
//
// Settings → "Show lengths in feet and inches" (units_feet, off by default), RUN under the DOM shim with panel.js's own
// el(): the one formatter (views/plan_measure.js: feetText, sqftText, lengthText) and, with the switch on, the screens
// where a person measures or checks a plan: the rooms helper's measuring screen (placeholder, what a length was read
// as, the picture's size), its check list's room sizes and its scale notice's example sizes; the upload's nudge
// (views/scale_nudge.js); Mapping's Measure tool and the Library's plan size (views/maps.js); the Settings switch.
// With it off, every one of them says what it said before (tests/js/ai_wizard.mjs and scale_nudge.mjs run unchanged).
//
// usage: units_feet.mjs <www/padspan-ha dir>
// prints one JSON line: { cases: {name: ok}, failures: [...] }

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import * as shim from "./dom_shim.mjs";

const WWW = process.argv[2];
shim.install(globalThis);
const src = readFileSync(join(WWW, "panel.js"), "utf-8").replace(/\r\n/g, "\n");
const elStart = src.indexOf("function el(tag, attrs={}, children=[]){");
const el = new Function("return " + src.slice(elStart, src.indexOf("\n}\n", elStart) + 2).replace(/^function el/, "function"))();
const escStart = src.indexOf("function esc(s){");
const esc = new Function("return " + src.slice(escStart, src.indexOf("\n}\n", escStart) + 2).replace(/^function esc/, "function"))();
const PM = await import(pathToFileURL(join(WWW, "views", "plan_measure.js")).href);
const W = await import(pathToFileURL(join(WWW, "views", "ai_wizard.js")).href);
const MAPS = await import(pathToFileURL(join(WWW, "views", "maps.js")).href);
const SET = await import(pathToFileURL(join(WWW, "views", "settings.js")).href);

const failures = [], cases = {};
const check = (name, ok, detail) => { cases[name] = !!ok; if (!ok) failures.push({ name, detail: detail === undefined ? null : detail }); };
const tick = () => new Promise(r => globalThis._realSetTimeout(r, 0));
const q = (root, sel) => root.querySelector(sel);
const quiet = () => new Proxy(() => document.createElement("span"), {
  get: (_t, k) => (k === "then" ? undefined : k === Symbol.toPrimitive || k === "toString" ? () => "" : quiet()),
  apply: () => document.createElement("span"),
});

// ── the formatter: round trips and edges ─────────────────────────────────────
const FT = 0.3048, IN = 0.0254;
for (const [m, want, why] of [
  [0, "0\"", "nothing"], [0.005, "0\"", "under a quarter inch: 0"], [0.01, "½\"", "under an inch: a half"], [3 * IN, "3\"", "inches only"],
  [11.75 * IN, "1' 0\"", "11.75 inches: the next foot"], [5 * FT + 4.5 * IN, "5' 4½\"", "a half inch under 10 feet"], [4.191, "13' 9\"", "13' 9\" back"],
  [30 * FT + 6 * IN, "30' 6\"", "30' 6\""], [30 * FT + 6.4 * IN, "30' 6\"", "the nearest inch past 10 feet"], [100 * FT, "100'", "whole feet from 100"],
  [206, "676'", "a long length"], [-1, "0\"", "never negative"]]) {
  check(`feet: ${why}`, PM.feetText(m) === want, [m, PM.feetText(m)]);
}
for (const [m2, want] of [[0, "0 sq ft"], [0.5, "5.4 sq ft"], [9, "97 sq ft"], [12, "129 sq ft"], [108.4, "1167 sq ft"]]) {
  check(`area: ${m2} m²`, PM.sqftText(m2) === want, PM.sqftText(m2));
}
check("lengthText: metres as the scale screen says them when off", PM.lengthText(8.4, false) === "8.4 m" && PM.lengthText(206, false) === "206 m" && PM.lengthText(8.4, true) === "27' 7\"");
check("feetOn: only true is on", PM.feetOn({ state: { settings: { units_feet: true } } }) && !PM.feetOn({ state: { settings: {} } }) && !PM.feetOn({ state: {} }));

// ── the rooms helper, the switch on ──────────────────────────────────────────
const T = { origin_x_m: 0, origin_y_m: 0, scale_x_m: 10, scale_y_m: 8, rotation_rad: 0 };
const box = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
const PROP = { rooms: {}, openings: {}, stairs: {}, spaces: { "space:a": { id: "space:a", name: "KITCHEN", new: "Kitchen", outline_m: box(1, 1, 4, 4), reads: [1, 2] } } };
const WIZ = { rows: ["space:a"], ticked: ["space:a"], small: [], outdoor: [], dropped: [], m2: { "space:a": 9 }, sources: { "space:a": "area_exact" } };
function helper(o = {}) {
  const calls = [];
  W._resetCounts();
  const ans = { session: { id: "rb_1", rev: 3, status: "done", floor_id: "main", plans: [{ map_id: "m1", t: T }], proposal: PROP, progress: {} }, areas: ["Kitchen"], undo: null,
    wizard: { ...WIZ, ...(o.scaleCheck ? { scale_check: o.scaleCheck } : {}) } };
  const state = { dataMode: "live", view: "ai_wizard", _aiwFrom: { view: "setup" }, settings: { units_feet: o.feet !== false, atlas_3d_ai_task_entity: "" },
    maps: { list: o.maps || [{ id: "m1", name: "Main plan", floor_id: "main", image: { width: 1000, height: 800 } }] },
    model: { floors: [{ floor_id: "main", name: "Main", level: 0 }], map_transforms: o.tfs || { m1: { ...T, reference_measurements: [{}] } }, room_geometry_m: {} } };
  const server = {
    "padspan_ha/ai_wizard_info": () => ({ reason: "offer", offer: true, wizard: o.wizard || {}, tier: "pro" }),
    "padspan_ha/plan_build_info": () => ({ unlock: { ok: true, why: "ok" }, master: true, switch: true, on: true, candidates: [] }),
    "padspan_ha/ai_wizard_mark": () => ({ wizard: o.wizard || {} }),
    "padspan_ha/plan_build_rooms_status": (p) => (p.map_id ? { session: null, running: null } : ans),
    "padspan_ha/ai_wizard_check_claude": () => ({ ok: true }),
    "padspan_ha/plan_build_scale_start": () => ({ session: null }),
    // The server reads a bare number as feet with the switch on (plan_geom.length_read): said back as "feet".
    "padspan_ha/plan_build_scale_preview": (p) => {
      const m = (p.measures || [])[0] || {}, out = { sig: "nn", size: [1000, 800], floor_known: true, floors: ["main"], stop: null };
      if (!m.text) return out;
      const metres = { "13.75": 4.191, "4.2 m": 4.2 }[m.text] ?? null;
      Object.assign(out, { metres: [metres], assumed: [m.text === "13.75" ? "feet" : null] });
      if (m.p1 && m.p2) { const ppm = Math.hypot((m.p2[0] - m.p1[0]) * 1000, (m.p2[1] - m.p1[1]) * 800) / metres; Object.assign(out, { across_m: 1000 / ppm, down_m: 800 / ppm, odd: false }); }
      return out;
    },
  };
  const ctx = { hass: { user: { is_admin: true } }, state,
    helpers: { el, esc, helpBtn: () => el("button", {}, "?"), mapImageUrl: () => "/local/plan.png" },
    actions: { callWS: (p) => { calls.push(p); const f = server[p.type]; return f ? Promise.resolve(f(p)) : Promise.reject({ code: "unknown_command" }); },
      telemetryEvent: () => {}, renderRooms: () => {}, renderNav: () => {}, showView: () => {}, openSetupStep: () => {}, modelRefresh: () => {} } };
  return { ctx, calls };
}
async function view(h) { let root = W.render(h.ctx); for (let i = 0; i < 6; i++) { await tick(); root = W.render(h.ctx); } return root; }
const tapAt = (layer, x, y) => layer.dispatchEvent({ type: "click", clientX: x, clientY: y, stopPropagation() {}, preventDefault() {} });
async function typeIn(len, text) { len.value = text; len.dispatchEvent({ type: "input" }); await shim.flush(); }
{
  const h = helper({ maps: [{ id: "n1", name: "New plan", floor_id: "main", image: { width: 1000, height: 800 } }], tfs: {} });
  let root = await view(h);
  q(root, '[data-aiw="start"]').click();
  for (let i = 0; i < 4; i++) await tick();
  root = await view(h); await shim.flush(); root = await view(h);
  const len = q(root, '[data-aiw="scale-length"]');
  check("helper, feet: the placeholder puts feet first", len && len.getAttribute("placeholder") === "e.g. 13' 9\" or 4.2 m", len && len.getAttribute("placeholder"));
  tapAt(q(root, '[data-aiw="measure"]'), 80, 300); root = await view(h);
  tapAt(q(root, '[data-aiw="measure"]'), 480, 300); root = await view(h);
  await typeIn(q(root, '[data-aiw="scale-length"]'), "13.75");
  root = await view(h);
  check("helper, feet: a bare number said as feet", q(root, '[data-aiw="scale-understood"]').textContent === "= 13' 9\" (read as feet)", q(root, '[data-aiw="scale-understood"]').textContent);
  check("helper, feet: the picture's size in feet", root.textContent.includes("will be 27' 6\" across and 22' 0\" down"), root.textContent.slice(0, 900));
  check("helper, feet: no metres on the measuring screen", !/\d m\b/.test(q(root, '[data-aiw="scale"]').textContent), q(root, '[data-aiw="scale"]').textContent);
  check("helper, feet: the typed text goes to the server as typed", h.calls.some(c => c.type === "padspan_ha/plan_build_scale_preview" && (c.measures[0] || {}).text === "13.75"));
}
{
  const SCK = { k: 3.1, source: "printed", signs: ["rooms", "printed"], example: { printed: { text: "45'", here_m: 4.5 }, rooms: { name: "Den", kind: "bedroom", m2: 108.4 } } };
  const h = helper({ scaleCheck: SCK, wizard: { started: { at: "rooms_check", map_id: "m1", rooms_session: "rb_1" } } });
  const root = await view(h);
  check("helper, feet: the check list's room size in square feet", q(root, '[data-aiw="m2-space:a"]')?.textContent === "97 sq ft", q(root, '[data-aiw="m2-space:a"]')?.textContent);
  const n = q(root, '[data-aiw="scale-notice"]');
  check("helper, feet: the scale notice's example sizes in feet", n && n.textContent.includes("which this scale makes 14' 9\".") && n.textContent.includes("Den would be 1167 sq ft: too big"), n && n.textContent);
  check("helper, off: the notice's words as before", W.scaleNoticeWords(SCK) === W.scaleNoticeWords(SCK, false) && W.scaleNoticeWords(SCK).includes("4.5 m") && W.scaleNoticeWords(SCK).includes("108.4 m²"));
  const off = helper({ feet: false, scaleCheck: SCK, wizard: { started: { at: "rooms_check", map_id: "m1", rooms_session: "rb_1" } } });
  const r0 = await view(off);
  check("helper, off: the room size in m² as before", q(r0, '[data-aiw="m2-space:a"]')?.textContent === "9 m²", q(r0, '[data-aiw="m2-space:a"]')?.textContent);
}

// ── Mapping: the upload's nudge, Measure, the Library's plan size, the switch on ──
function mapping(o = {}) {
  const calls = [], toasts = [];
  const state = { complexity: "advanced", mapsTab: o.tab || "edit", dataMode: "live", view: "maps", settings: { units_feet: o.feet !== false },
    maps: { list: o.maps, _measurements: o.meas || [], _measurePts: [] }, model: { floors: [{ id: "main", name: "Main" }], map_transforms: o.tfs || {}, areas: [] }, activeMapId: o.maps[0].id };
  const server = { "padspan_ha/maps_scale_measure": (p) => {
    const m = (p.measures || [])[0] || {}, metres = { "13.75": 4.191 }[m.text] ?? null;
    const out = { size: [1000, 800], metres: [metres], assumed: [m.text === "13.75" ? "feet" : null] };
    if (m.p1 && m.p2) Object.assign(out, { across_m: 8.382, down_m: 6.7056, odd: false });
    return p.save ? { ok: true, map_id: p.map_id, scale_x_m: 8.382, scale_y_m: 6.7056, lengths: 1 } : out; } };
  const actions = { callWS: (p) => { calls.push(p); const f = server[p.type]; return Promise.resolve(f ? f(p) : {}); }, telemetryEvent: () => {}, renderRooms: () => {},
    setMapsTab: (t) => { state.mapsTab = t; }, mapsSetActive: () => {}, mapsRefresh: () => {}, modelRefresh: () => {} };
  const ctx = { state, hass: { user: { is_admin: true }, states: {} }, toast: (m) => toasts.push(m),
    helpers: new Proxy({ el, esc, helpBtn: () => el("button", {}, "?"), mapImageUrl: () => "/x.png", pill: (t) => el("span", {}, String(t ?? "")) }, { get: (t, k) => (k in t ? t[k] : quiet()) }),
    actions: new Proxy(actions, { get: (t, k) => (k in t ? t[k] : quiet()) }) };
  return { ctx, calls, toasts, state };
}
{
  const h = mapping({ maps: [{ id: "up1", name: "Plan", floor_id: "main", image: { width: 1000, height: 800 }, scale_nudge: true }] });
  let root = MAPS.render(h.ctx); await tick();
  tapAt(q(root, '[data-aiw="measure"]'), 80, 300); root = MAPS.render(h.ctx); await tick();
  tapAt(q(root, '[data-aiw="measure"]'), 480, 300); await tick(); root = MAPS.render(h.ctx);
  check("nudge, feet: the placeholder", q(root, '[data-aiw="scale-length"]').getAttribute("placeholder") === "e.g. 13' 9\" or 4.2 m");
  await typeIn(q(root, '[data-aiw="scale-length"]'), "13.75");
  check("nudge, feet: read as feet, the size in feet", q(root, '[data-aiw="scale-understood"]').textContent === "= 13' 9\" (read as feet)"
    && q(root, '[data-nudge="size"]').textContent.includes("27' 6\" across and 22' 0\" down"), [q(root, '[data-aiw="scale-understood"]').textContent, q(root, '[data-nudge="size"]').textContent]);
  q(root, '[data-nudge="save"]').click();
  for (let i = 0; i < 4; i++) await tick();
  check("nudge, feet: the typed text saved as typed, said in feet", h.calls.some(c => c.save && c.measures[0].text === "13.75") && h.toasts.some(t => t.includes("27' 6\" across")), h.toasts);
}
{
  const plan = { id: "m1", name: "Main", floor_id: "main", image: { width: 1000, height: 800 }, receivers: [], room_bounds: {} };
  const tfs = { m1: { scale_x_m: 10, scale_y_m: 8, reference_measurements: [{}] } };
  const lib = mapping({ tab: "library", maps: [plan], tfs });
  const lr = MAPS.render(lib.ctx);
  check("Library, feet: the plan's size in feet", lr.textContent.includes("32' 10\" × 26' 3\"") && !lr.textContent.includes("10.0×8.0 m"), lr.textContent.slice(0, 600));
  const libOff = mapping({ tab: "library", maps: [plan], tfs, feet: false });
  check("Library, off: as before", MAPS.render(libOff.ctx).textContent.includes("10.0×8.0 m"));
  // Measure: two measurements in, the analysis and Save in feet; the number typed is feet, stored in metres.
  const meas = [{ p1: [0.1, 0.5], p2: [0.6, 0.5], dist_px: 500, distance_m: 5, px_per_meter: 100, angle_deg: 0 },
    { p1: [0.5, 0.1], p2: [0.5, 0.6], dist_px: 400, distance_m: 4, px_per_meter: 100, angle_deg: 90 }];
  // The editor opens a plan on Radios: Measure pressed, then the draft drawn again with its measurements in.
  const measuring = async (h, set) => {
    let r = MAPS.render(h.ctx); await shim.flush();
    r.querySelector('[data-edit-tool="measure"]').click(); await shim.flush();
    Object.assign(h.state.maps, set);
    r = MAPS.render(h.ctx); await shim.flush();
    return r;
  };
  const m = mapping({ maps: [{ ...plan }], tfs: {} });
  let mr = await measuring(m, { _measurements: meas });
  const t = mr.textContent;
  check("Measure, feet: each length, the plan's size and Save in feet", t.includes("#1: 16' 5\"") && t.includes("Map width = 32' 10\", height = 26' 3\"")
    && t.includes("Save Scale: 100.0 px/m → 32' 10\" × 26' 3\"") && !/\d(\.\d)?m\b/.test(t.replace(/px\/m/g, "")), t.slice(t.indexOf("Reference Distance"), t.indexOf("Reference Distance") + 900));
  const one = mapping({ maps: [{ ...plan }], tfs: {}, meas: [] });
  mr = await measuring(one, { _measurements: [], _measurePts: [[0.1, 0.5], [0.6, 0.5]] });
  const inp = mr.querySelectorAll("input").find(i => i.placeholder === "feet");
  check("Measure, feet: the field says feet", !!inp && mr.textContent.includes("ft"), mr.querySelectorAll("input").map(i => i.placeholder));
  if (inp) {
    inp.value = "16.4042";
    mr.querySelectorAll("button").find(b => /Add 1st Measurement/.test(b.textContent)).click();
    const got = one.state.maps._measurements[0];
    check("Measure, feet: 16.4042 ft stored as 5 m", got && got.distance_m === 5 && Math.abs(got.px_per_meter - 100) < 1e-9, got);
  }
  const offM = mapping({ maps: [{ ...plan }], tfs: {}, feet: false });
  const to = (await measuring(offM, { _measurements: meas })).textContent;
  check("Measure, off: as before", to.includes("#1: 5m →") && to.includes("Map width = 10.0m, height = 8.0m") && to.includes("10.0m × 8.0m"), to.slice(to.indexOf("Reference Distance"), to.indexOf("Reference Distance") + 600));
}

// ── Settings: one switch, off by default, saved ──────────────────────────────
{
  const saved = [];
  const ctx = { state: { complexity: "basic", settings: {}, model: { floors: [], areas: [] }, view: "settings" }, hass: { user: { is_admin: true }, states: {} }, toast: () => {},
    helpers: new Proxy({ el, esc, helpBtn: () => el("button", {}, "?") }, { get: (t, k) => (k in t ? t[k] : quiet()) }),
    actions: new Proxy({ settingsSet: async (p) => { saved.push(p); } }, { get: (t, k) => (k in t ? t[k] : quiet()) }) };
  let root = null;
  try { root = SET.render(ctx); await shim.flush(); } catch (e) { check("settings: renders", false, String(e && e.stack)); }
  const tg = root && q(root, '[data-units-feet="toggle"]'), card = root && q(root, '[data-units-feet="card"]');
  check("settings: the switch, its words, off by default", tg && tg.checked === false && card.textContent.includes("Show lengths in feet and inches")
    && card.textContent.includes("stored in metres"), card && card.textContent);
  if (tg) { tg.checked = true; tg.dispatchEvent({ type: "change" }); await tick(); }
  check("settings: turning it on saves units_feet", JSON.stringify(saved) === '[{"units_feet":true}]', saved);
}

console.log(JSON.stringify({ cases, failures }));
