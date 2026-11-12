// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
//
// The guided Setup (views/setup.js), run for real: which step is current for
// a house at each stage (empty → plan → scale → floors → rooms → receivers
// → calibration → all done), resume where someone left off, skip and come
// back, each step opening its existing tool, the bar back, and the report's
// counters. The view is rendered under the DOM shim with panel.js's own el().
//
// usage: guided_setup.mjs <www/padspan-ha dir>
// prints one JSON line: { cases: {name: result}, failures: [...] }

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import * as shim from "./dom_shim.mjs";

const WWW = process.argv[2];
shim.install(globalThis);
const S = await import(pathToFileURL(join(WWW, "views", "setup.js")).href);
const src = readFileSync(join(WWW, "panel.js"), "utf-8").replace(/\r\n/g, "\n");
const elStart = src.indexOf("function el(tag, attrs={}, children=[]){");
const el = new Function("return " + src.slice(elStart, src.indexOf("\n}\n", elStart) + 2).replace(/^function el/, "function"))();

const failures = [];
const cases = {};
const check = (name, ok, detail) => { cases[name] = !!ok; if (!ok) failures.push({ name, detail: detail === undefined ? null : detail }); };

// ── house fixtures, one stage at a time ─────────────────────────────────────
const F2 = [{ floor_id: "ground", name: "Ground", level: 0 }, { floor_id: "up", name: "Upstairs", level: 1 }];
function house(stage, extra = {}) {
  const st = {
    _mapsLoaded: true, _modelLoaded: true, dataMode: "live", view: "setup", complexity: "advanced",
    settings: {}, maps: { list: [] },
    model: { floors: F2.map(f => ({ ...f })), areas: [{ name: "Kitchen" }, { name: "Office" }], map_transforms: {}, room_geometry_m: {}, scanner_positions_m: {} },
  };
  const at = (k) => S.SETUP_STEPS.indexOf(k) < stage;
  if (at("plan")) st.maps.list = [{ id: "m1", name: "Ground", floor_id: "ground", receivers: [], room_bounds: {} }];
  // A scale is the placement's positive size (setup_status.hasScale, review 2026-11-11), as Measure writes it with its record.
  if (at("scale")) st.model.map_transforms.m1 = { scale_x_m: 10, scale_y_m: 8, reference_measurements: [{ px: 100, m: 2 }] };
  if (at("floors")) st.model.floors[0].floor_to_floor_m = 2.7;
  if (at("rooms")) st.model.room_geometry_m.Kitchen = { floor_id: "ground", points_m: [[0, 0], [3, 0], [3, 3]] };
  if (at("receivers")) {
    st.maps.list[0].receivers = [{ source: "aa" }, { source: "bb" }];
    st.model.scanner_positions_m = { aa: { x_m: 1, y_m: 1, z_m: 2.2 }, bb: { x_m: 2, y_m: 2, z_m: 0.9 } };
  }
  if (at("calibration")) st.calibration = { points: [1, 2, 3, 4, 5].map(i => ({ id: i })), model: {} };
  return Object.assign(st, extra);
}

// ── step state derivation ───────────────────────────────────────────────────
{
  const names = ["empty house → step 1 (plan)", "plan, no scale → step 2 (scale)", "scale, floors at the default → step 3 (floors)",
    "floor heights, no rooms → step 4 (rooms)", "rooms, no receivers → step 5 (receivers)", "receivers, no calibration → step 6 (calibration)"];
  for (let i = 0; i < 6; i++) {
    const st = house(i);
    st.calibration = st.calibration || { points: [], model: {} };
    const d = S.deriveSetup(st);
    check("derive: " + names[i], d.known && d.current === S.SETUP_STEPS[i] && d.doneCount === i
      && d.steps.every((s, j) => s.status === (j < i ? "done" : j === i ? "current" : "todo")), d);
  }
  const all = S.deriveSetup(house(6));
  check("derive: every step done → all done, nothing current", all.allDone && all.current === null && all.doneCount === 6, all);

  // Owner's D5 (2026-11-13): floor heights after the rooms, and only for two indoor floors or more: a one-floor house
  // (Outside never counts as a floor) has no such step at all; it used to be shown as done.
  const one = house(2, {});
  one.model.floors = [F2[0], { floor_id: "__outside__", name: "Outside", level: 0 }];
  const od = S.deriveSetup(one);
  check("derive: a one-floor house has no floor heights step; rooms then receivers", JSON.stringify(od.steps.map(x => `${x.n}.${x.id}`))
    === '["1.plan","2.scale","3.rooms","4.receivers","5.calibration"]', od.steps.map(x => `${x.n}.${x.id}`));

  const same = house(5);
  for (const v of Object.values(same.model.scanner_positions_m)) v.z_m = 2.4;
  check("derive: receivers all at one height on two floors are not done (the receiver_heights tip's rule)",
    S.deriveSetup(same).current === "receivers", S.deriveSetup(same));

  const four = house(5);
  four.calibration = { points: [1, 2, 3, 4], model: {} };
  check("derive: four calibration points are not enough, five are", S.deriveSetup(four).current === "calibration"
    && S.deriveSetup(house(6)).steps[5].done, S.deriveSetup(four).steps[5]);

  // One rule with the Overview's Getting started "Calibrate" (setup_status.js
  // hasCalibration, which panel.js's _hasCal mirrors): receivers placed in
  // the layout are not calibration; a fitted model is.
  const placedOnly = house(5);
  placedOnly.calibration = { points: [], model: {} };
  const fitted = house(5);
  fitted.calibration = { points: [], model: { last_computed: "x" } };
  check("derive: receivers placed are not calibration, a fitted model is",
    Object.keys(placedOnly.model.scanner_positions_m).length === 2 && !S.deriveSetup(placedOnly).steps[5].done && S.deriveSetup(fitted).steps[5].done);
  const STATUS = await import(pathToFileURL(join(WWW, "views", "setup_status.js")).href);
  check("derive: the calibration step is setup_status.js's hasCalibration",
    [placedOnly, fitted, four, house(6)].every(h => S.deriveSetup(h).steps[5].done === STATUS.hasCalibration(h)));

  const unknown = house(5);
  delete unknown.calibration;
  const du = S.deriveSetup(unknown);
  check("derive: calibration not fetched yet is unknown, not done", du.steps[5].unknown && !du.steps[5].done && du.current === "calibration", du.steps[5]);

  const loading = house(0, { _mapsLoaded: false });
  check("derive: before maps and model arrive the answer is not known", S.deriveSetup(loading).known === false);
}

// ── resume and skip ─────────────────────────────────────────────────────────
{
  const st = house(1);   // plan done, scale not
  check("resume: the step someone left off at is current while it is not done",
    S.deriveSetup(st, { at: "rooms", skipped: [] }).current === "rooms");
  check("resume: a step left off at that is now done gives way to the first to do",
    S.deriveSetup(st, { at: "plan", skipped: [] }).current === "scale");
  st.settings.setup_progress = { at: "floors", skipped: ["scale", "nonsense"], done: "yes" };
  const p = S.progressOf(st);
  check("resume: stored progress is read back, unknown steps dropped",
    p.at === "floors" && JSON.stringify(p.skipped) === '["scale"]' && p.done === false, p);

  const fresh = { at: null, skipped: [], done: false };
  const sk = S.skipStep(st, fresh, "scale");
  const d = S.deriveSetup(st, sk);
  check("skip: a skipped step is marked skipped and the next one is current",
    JSON.stringify(sk.skipped) === '["scale"]' && sk.at === "rooms" && d.steps[1].status === "skipped" && d.current === "rooms", { sk, d: d.steps });
  // D5's order: rooms, then floor heights (this is a two-floor house).
  const ahead = S.skipStep(st, { at: "rooms", skipped: [] }, "rooms");
  check("skip: skipping a step jumped ahead to moves on to the step after it", ahead.at === "floors", ahead);
  let q = fresh;
  for (const id of ["scale", "rooms", "floors", "receivers", "calibration"]) q = S.skipStep({ ...st, calibration: { points: [] } }, q, id);
  check("skip: with everything left skipped, the first skipped step comes back",
    S.deriveSetup({ ...st, calibration: { points: [] } }, q).current === "scale" && q.at === null, q);
  const back = S.openProgress(sk, "scale");
  check("skip: opening a skipped step un-skips it and makes it current",
    back.at === "scale" && back.skipped.length === 0 && S.deriveSetup(st, back).current === "scale", back);
}

// ── the view: steps open their own tools ────────────────────────────────────
function mkCtx(st) {
  const calls = [], events = [];
  const ctx = {
    state: st, hass: { user: { is_admin: true } }, helpers: { el, helpBtn: () => el("button", {}, "?") },
    toast: (m) => calls.push(["toast", m]),
    actions: {
      renderRooms: () => calls.push(["renderRooms"]),
      showView: (v) => { st.view = v; calls.push(["showView", v]); },
      setComplexity: (m) => { st.complexity = m; calls.push(["setComplexity", m]); },
      setDataMode: (m) => calls.push(["setDataMode", m]),
      telemetryEvent: (n) => events.push(n),
      callWS: async (msg) => { calls.push(["ws", msg]); return { settings: { ...st.settings, ...(msg.setup_progress ? { setup_progress: msg.setup_progress } : {}) } }; },
      calibrationGet: async () => { calls.push(["calibrationGet"]); return { points: [], model: {} }; },
    },
  };
  return { ctx, calls, events };
}
const rows = (root) => root.querySelectorAll("[data-setup-status]").map(n => [n.getAttribute("data-setup").slice(5), n.getAttribute("data-setup-status")]);
const btn = (root, id) => root.querySelector(`[data-setup="${id}"]`);
const saved = (calls) => calls.filter(c => c[0] === "ws" && c[1].type === "padspan_ha/settings_set").map(c => c[1].setup_progress);

{
  const st = house(1, { calibration: { points: [], model: {} } });
  const { ctx, calls, events } = mkCtx(st);
  const root = S.render(ctx);
  check("view: six rows in order with done / current / to do",
    JSON.stringify(rows(root)) === JSON.stringify([["plan", "done"], ["scale", "current"], ["rooms", "todo"], ["floors", "todo"], ["receivers", "todo"], ["calibration", "todo"]]), rows(root));
  check("view: the current step is counted as reached once per page",
    events.filter(e => e === "setup_step:scale").length === 1, events);
  S.render(ctx);
  check("view: a redraw does not count it again", events.filter(e => e === "setup_step:scale").length === 1, events);

  btn(S.render(ctx), "skip-scale").click();
  check("view: Skip counts setup_skip and stores the step as skipped",
    events.includes("setup_skip:scale") && saved(calls).some(p => p.skipped.includes("scale") && p.at === "rooms"), { events, saved: saved(calls) });
  await shim.flush();
  check("view: after Skip the next step is current", JSON.stringify(rows(S.render(ctx)).slice(1, 3)) === '[["scale","skipped"],["rooms","current"]]', rows(S.render(ctx)));

  const tool = (id) => { calls.length = 0; btn(S.render(ctx), "open-" + id).click(); return calls; };
  tool("rooms");
  check("open: Rooms opens the Mapping Setup Wizard at its Rooms step on the active plan",
    st.view === "maps" && st._mapsWizard && st._mapsWizard.step === 3 && st._mapsWizard.mapId === "m1" && st._setupReturn === "rooms"
    && saved(calls).some(p => p.at === "rooms"), { w: st._mapsWizard, ret: st._setupReturn });
  check("open: opening a step counts it as reached", events.includes("setup_step:rooms"), events);
  st.view = "setup";
  tool("scale");
  check("open: Scale opens the wizard's Measure step", st._mapsWizard.step === 2 && st._setupReturn === "scale");
  st.view = "setup";
  tool("receivers");
  check("open: Receivers opens the wizard's Place scanners step (each one's height is there)", st._mapsWizard.step === 4);
  st.view = "setup";
  tool("plan");
  check("open: a plan already uploaded: Add a floor opens the wizard's Upload for a new one",
    st._mapsWizard.step === 1 && st._mapsWizard.mapId === null && st.activeMapId === null);
  st.view = "setup"; st.complexity = "basic";
  const fc = tool("floors");
  const ff = st._focus || {};
  check("open: Floors opens only Mapping → 3D Stack's Floor Heights card in Basic, back to Setup: Basic stays Basic, no toast",
    st.view === "maps" && st.mapsTab === "stack" && ff.part === "floor_heights" && ff.back && ff.back.view === "setup"
    && st._setupReturn === "floors" && st._mapsWizard === null && st.complexity === "basic" && !fc.some(c => c[0] === "toast"), { tab: st.mapsTab, mode: st.complexity, ff });
  st.view = "setup";
  tool("calibration");
  check("open: Calibrate opens the guided calibration at its first step",
    st.view === "calibration" && st._calibWizard && st._calibWizard.step === 1 && st._setupReturn === "calibration");

  const bar = S.returnBar(ctx);
  check("bar: over the tool it says which step this is", bar && /step 6 of 6: Calibrate/.test(bar.textContent), bar && bar.textContent);
  btn(bar, "back").click();
  check("bar: Back to Setup opens Setup and ends the step's bar", st.view === "setup" && st._setupReturn === null);
  st._setupReturn = "nonsense";
  check("bar: nothing for a step that is not one", S.returnBar(ctx) === null);
  // Review 2026-11-11 (C1): the bar says the step the person is on NOW (it kept the one Setup opened).
  Object.assign(st, { _setupReturn: "plan", view: "maps", _mapsWizard: { step: 3, mapId: "m1" } });
  const now3 = S.returnBar(ctx).textContent;
  st._mapsWizard = { step: 5, mapId: "m1" };
  const fin = S.returnBar(ctx).textContent;
  Object.assign(st, { _mapsWizard: null, mapsTab: "edit" }); st.maps._mode = "measure";
  const meas = S.returnBar(ctx).textContent;
  st.view = "calibration";
  const cal = S.returnBar(ctx).textContent;
  check("bar: the step it is on now: the wizard's, none at Finish, Edit's tool, Calibration",
    /: Draw the rooms/.test(now3) && !/step \d/.test(fin) && /: Set the scale/.test(meas) && /: Calibrate/.test(cal), [now3, fin, meas, cal]);
  st._setupReturn = null; st.view = "setup";
}

// The rooms helper's Done (end-to-end test 2026-11-11): its receivers step opens on the plan it just saved, not the
// first plan or the one open in Mapping.
{
  const st = house(5, { calibration: { points: [], model: {} }, activeMapId: "m1" });
  st.maps.list.push({ id: "m2", name: "Upstairs", floor_id: "up", receivers: [], room_bounds: {} });
  const { ctx } = mkCtx(st);
  S.openStep(ctx, "receivers", "m2");
  check("open: a step opened on a given plan opens on that plan", st._mapsWizard.step === 4 && st._mapsWizard.mapId === "m2" && st.activeMapId === "m2", st._mapsWizard);
  S.openStep(ctx, "receivers", "gone");
  check("open: a plan that isn't there: the one open in Mapping", st._mapsWizard.mapId === "m2");
}

// The rooms helper's line (end-to-end test 2026-11-11): under the current step when that is Scale or Rooms, else under
// Rooms, so a two-floor house whose current step became Floors keeps it while the rule offers it.
{
  const AIWO = await import(pathToFileURL(join(WWW, "views", "ai_wizard_offer.js")).href);
  const offering = (st) => {
    const m = mkCtx(st);
    const real = m.ctx.actions.callWS;
    m.ctx.actions.callWS = async (msg) => (msg.type === "padspan_ha/ai_wizard_info" ? { reason: "offer", offer: true, wizard: {} } : real(msg));
    return m;
  };
  // Owner's D8 (2026-11-13): Getting started's row follows the pull rule (Setup's: tried the step and stopped), not the
  // push rule's week; "Don't ask again" on the Overview card keeps it away, "Not now" doesn't.
  for (const [name, pull, push, want] of [["pull offers, push says too new", { offer: true, wizard: {} }, { offer: false, reason: "plan_too_new" }, true],
    ["pull says not stuck yet", { offer: false, reason: "not_struggled", wizard: {} }, { offer: true, wizard: {} }, false],
    ["the card was refused (Don't ask again)", { offer: true, wizard: { dismissed: true } }, { offer: false, reason: "dismissed" }, false],
    ["the card was put off (Not now)", { offer: true, wizard: { snooze_until: 9e12 } }, { offer: false, reason: "snoozed" }, true]]) {
    AIWO._reset();
    const m = mkCtx(house(2));
    const asked = [];
    m.ctx.actions.callWS = async (msg) => { if (msg.type === "padspan_ha/ai_wizard_info") { asked.push(msg.surface); return msg.surface === "pull" ? pull : push; } return {}; };
    AIWO.gettingStartedRow(m.ctx);
    for (let i = 0; i < 4; i++) await new Promise(r => setImmediate(r));
    const row = AIWO.gettingStartedRow(m.ctx);
    check(`getting started's helper row: ${name}`, !!row === want && asked.every(x => x === "pull"), [asked, !!row]);
  }
  // Review 2026-11-11 (C4): the answer is for the house as read; rooms saved (a new model from the panel's refresh)
  // ask again, the same house does not.
  {
    AIWO._reset();
    const m = mkCtx(house(2));
    const asked = [];
    let ans = { offer: true, wizard: {} };
    m.ctx.actions.callWS = async (msg) => { if (msg.type === "padspan_ha/ai_wizard_info") { asked.push(msg.surface); return ans; } return {}; };
    const flush = async () => { for (let i = 0; i < 4; i++) await new Promise(r => setImmediate(r)); };
    AIWO.gettingStartedRow(m.ctx); await flush();
    const before = !!AIWO.gettingStartedRow(m.ctx);
    AIWO.gettingStartedRow(m.ctx); await flush();
    const same = asked.length;
    ans = { offer: false, reason: "has_rooms", wizard: {} };
    m.ctx.state.model = { ...m.ctx.state.model, room_geometry_m: { Kitchen: {} } };
    AIWO.gettingStartedRow(m.ctx); await flush();
    const after = !!AIWO.gettingStartedRow(m.ctx);
    check("helper offer: asked again for a new house model, not for the same one", before && same === 1 && asked.length === 2 && !after, [asked, before, after]);
  }
  AIWO._reset();
  const lineRow = async (st) => {
    AIWO._reset();
    const { ctx } = offering(st);
    S.render(ctx);
    for (let i = 0; i < 4; i++) await new Promise(r => setImmediate(r));
    const root = S.render(ctx);
    return root.querySelectorAll("[data-setup-status]").filter(n => n.querySelector('[data-aiw="line"]')).map(n => n.getAttribute("data-setup").slice(5));
  };
  const floorsNow = house(3, { calibration: { points: [], model: {} } });   // D5 (2026-11-13): floor heights come after the rooms
  check("helper line: Floors current, the line under Rooms", S.deriveSetup(floorsNow).current === "floors" && (await lineRow(floorsNow)).join() === "rooms");
  const scaleNow = house(1, { calibration: { points: [], model: {} } });
  check("helper line: Scale current, under Scale only", (await lineRow(scaleNow)).join() === "scale");
  const roomsDone = house(5, { calibration: { points: [], model: {} } });
  check("helper line: a house past its rooms keeps it under Rooms while the rule offers it", (await lineRow(roomsDone)).join() === "rooms");
  {
    // Click-through 2026-11-11: on a Rooms row already Done, the line doesn't open with "Stuck?".
    AIWO._reset();
    const { ctx } = offering(roomsDone);
    S.render(ctx);
    for (let i = 0; i < 4; i++) await new Promise(r => setImmediate(r));
    const line = S.render(ctx).querySelector('[data-aiw="line"]');
    const notDone = house(2, { calibration: { points: [], model: {} } });
    AIWO._reset();
    const o2 = offering(notDone);
    S.render(o2.ctx);
    for (let i = 0; i < 4; i++) await new Promise(r => setImmediate(r));
    const line2 = S.render(o2.ctx).querySelector('[data-aiw="line"]');
    check("helper line: a Done row says another plan, not Stuck?", line && line.textContent.includes("Claude can draw the rooms on another of your floor plans too")
      && !line.textContent.includes("Stuck?") && line2 && line2.textContent.includes("Stuck?"), [line && line.textContent, line2 && line2.textContent]);
  }
  AIWO._reset();
  const { ctx } = mkCtx(house(2, { calibration: { points: [], model: {} } }));
  S.render(ctx);
  for (let i = 0; i < 4; i++) await new Promise(r => setImmediate(r));
  check("helper line: none where the rule doesn't offer it", !S.render(ctx).querySelector('[data-aiw="line"]'));
  // Second review, 2026-11-12, the pull trigger: "opened the Scale or Rooms step and LEFT it unfinished". The real
  // sequence: Setup drawn, the step opened from it, the Mapping view drawn (its wizard draws the step, as maps.js does,
  // several times in one visit): one opening, not a struggle. Then left, and Setup or the step shown again: a struggle.
  {
    const marks = (m) => m.calls.filter(c => c[0] === "ws" && c[1].type === "padspan_ha/ai_wizard_mark").map(c => `${c[1].what}:${c[1].setup_step}`);
    AIWO._reset();
    const st = house(1, { calibration: { points: [], model: {} } });
    const m = mkCtx(st);
    st._viewVisit = 1; S.render(m.ctx);                            // Setup
    S.openStep(m.ctx, "scale");                                     // → Mapping
    st._viewVisit = 2; AIWO.stepSeen(m.ctx, "scale"); AIWO.stepSeen(m.ctx, "scale");   // the wizard's scale step drawn, twice
    check("pull trigger: one opening (Setup, then the step drawn) is not a struggle", marks(m).join() === "step_seen:scale", marks(m));
    st.view = "setup"; st._viewVisit = 3; S.render(m.ctx);          // left, back on Setup with it unfinished
    check("pull trigger: left unfinished and back on Setup: a struggle", marks(m).join() === "step_seen:scale,step_left:scale", marks(m));
    AIWO._reset();
    const m2 = mkCtx(st);
    st._viewVisit = 5; AIWO.stepSeen(m2.ctx, "scale");              // the step drawn
    st._viewVisit = 6; st._viewVisit = 7; AIWO.stepSeen(m2.ctx, "scale");   // left to another view and back to the step
    check("pull trigger: left and the step shown again on a later visit: a struggle", marks(m2).join() === "step_seen:scale,step_left:scale", marks(m2));
    AIWO._reset();
    const done = house(3, { calibration: { points: [], model: {} } });   // its scale set: the wizard doesn't mark a finished step
    const m3 = mkCtx(done);
    done._viewVisit = 1; S.render(m3.ctx); S.openStep(m3.ctx, "scale");
    done.view = "setup"; done._viewVisit = 3; S.render(m3.ctx);
    check("pull trigger: a finished step is never a struggle", !marks(m3).length, marks(m3));
    AIWO._reset();
  }
  // 2026-11-12: the helper's later undo on its Draw the rooms row: its own words, asked once, the rooms then the scale.
  {
    AIWO._reset();
    const st = house(5, { calibration: { points: [], model: {} } });
    const m = mkCtx(st), sent = [];
    m.ctx.actions.callWS = async (msg) => {
      sent.push(msg);
      return msg.type === "padspan_ha/ai_wizard_info" ? { reason: "has_rooms", offer: false, wizard: {}, undo: { session: "rb_1", map_id: "m1", items: 3, floor_name: "Ground", scale: "goes" } }
        : msg.type === "padspan_ha/plan_build_rooms_undo" ? { ok: true, undone: 3, skipped: [] } : msg.type === "padspan_ha/plan_build_scale_undo" ? { ok: true } : {};
    };
    S.render(m.ctx);
    for (let i = 0; i < 4; i++) await new Promise(r => setImmediate(r));
    let root = S.render(m.ctx);
    const box = root.querySelector('[data-setup="step-rooms"]').querySelector('[data-setup="helper-undo"]');
    check("later undo: on Setup's Draw the rooms row, in the helper's words", box && box.textContent.includes("The last rooms Let Claude draw your rooms saved on Ground: 3 rooms.")
      && box.textContent.includes("It also removes this plan's scale") && !!btn(root, "helper-undo-ask"), box && box.textContent);
    btn(root, "helper-undo-ask").click();
    root = S.render(m.ctx);
    check("later undo: asked first, saying what goes", root.textContent.includes("and remove this plan's scale that was set in the helper?") && !!btn(root, "helper-undo-go")
      && !sent.some(x => x.type === "padspan_ha/plan_build_rooms_undo"));
    btn(root, "helper-undo-go").click();
    for (let i = 0; i < 6; i++) await new Promise(r => setImmediate(r));
    root = S.render(m.ctx);
    const order = sent.filter(x => x.type.includes("_undo")).map(x => `${x.type.replace("padspan_ha/", "")}:${x.via}`);
    check("later undo: the rooms, then the scale, as the helper's; said, with the ways on; counted", order.join() === "plan_build_rooms_undo:wizard,plan_build_scale_undo:wizard"
      && root.textContent.includes("3 taken back. The plan's scale was removed too") && root.textContent.includes("To try again, use the line below; to draw them yourself, this step's own button.")
      && m.events.includes("ai_wizard:undo_from_setup"), [order, root.textContent.slice(0, 300)]);
  }
  AIWO._reset();
}

// 2026-11-12: "Put my receivers in their rooms" on Setup's receivers step, for everyone. Its count and reasons are the
// server's one rule (a dry run of the same command, review 2026-11-12): what it did and couldn't, and why; Undo of the last press.
{
  const flush = async () => { for (let i = 0; i < 6; i++) await new Promise(r => setImmediate(r)); };
  const fake = (st, plans) => {
    const m = mkCtx(st), sent = [];
    let k = 0;
    m.ctx.actions.callWS = async (msg) => {
      sent.push(msg);
      if (msg.type !== "padspan_ha/receivers_to_rooms") return {};
      if (msg.dry_run) return plans[Math.min(k++, plans.length - 1)];
      return msg.undo ? { ok: true, undone: ["kitchen-proxy"], left: [] }
        : { ok: true, placed: [{ source: "kitchen-proxy", room: "Kitchen", x_m: 1.5, y_m: 1 }], skipped: [{ source: "office-proxy", why: "no_outline" }, { source: "porch-proxy", why: "no_area" }] };
    };
    return { ...m, sent };
  };
  const skipped = [{ source: "office-proxy", why: "no_outline" }, { source: "porch-proxy", why: "no_area" }];
  S._resetReceivers();
  const st = house(4, { calibration: { points: [], model: {} } });
  st._viewVisit = 1;
  const m = fake(st, [{ ok: true, ready: [{ source: "kitchen-proxy", room: "Kitchen" }], skipped, undo: 0 },
    { ok: true, ready: [], skipped, undo: 1 }, { ok: true, ready: [], skipped, undo: 0 }]);
  S.render(m.ctx);
  await flush();
  let root = S.render(m.ctx);
  const row = root.querySelector('[data-setup="step-receivers"]');
  check("receivers: the server's count on the receivers step, its reasons, no cost", row && !!row.querySelector('[data-setup="receivers-place"]')
    && row.textContent.includes("1 receiver has a room with an outline and no place on the map yet") && row.textContent.includes("No AI, nothing to pay")
    && row.textContent.includes("no Home Assistant area: porch-proxy") && m.sent.filter(x => x.dry_run).length === 1, row && row.textContent);
  btn(root, "receivers-place").click();
  await flush();
  root = S.render(m.ctx);
  await flush();
  root = S.render(m.ctx);
  const said = btn(root, "receivers-said");
  check("receivers: what it placed, what it couldn't and why; asked again after", said && said.textContent.includes("Placed 1 receiver inside its room (kitchen-proxy in Kitchen)")
    && said.textContent.includes("no Home Assistant area: porch-proxy") && said.textContent.includes("its room has no outline yet: office-proxy")
    && m.sent.filter(x => x.dry_run).length === 2 && !btn(root, "receivers-place"), said && said.textContent);
  const undo = btn(root, "receivers-undo");
  check("receivers: Undo of the last press, said so", undo && undo.textContent === "Undo the 1 placed last", undo && undo.textContent);
  undo.click();
  await flush();
  root = S.render(m.ctx);
  await flush();
  root = S.render(m.ctx);
  check("receivers: Undo in one step, from what the server kept", m.sent.some(x => x.undo === true) && btn(root, "receivers-said").textContent.startsWith("1 taken back off the map")
    && !btn(root, "receivers-undo"));
  const demo = house(4, { dataMode: "sample" });
  check("receivers: nothing on the demo house", !S.receiversBlock(fake(demo, [{ ready: [], skipped: [], undo: 0 }]).ctx));
  // Nothing the server would place: no button; the line says why (or, with no receiver yet, that it will work later).
  S._resetReceivers();
  const none = house(4, { calibration: { points: [], model: {} } });
  const n2 = fake(none, [{ ok: true, ready: [], skipped, undo: 0 }]);
  S.receiversBlock(n2.ctx);
  await flush();
  const why = S.receiversBlock(n2.ctx);
  check("receivers: none ready, no button, the line says why", why && why.getAttribute("data-setup") === "receivers-later" && !why.querySelector('[data-setup="receivers-place"]')
    && why.textContent.includes("Not ready: no Home Assistant area: porch-proxy") && why.textContent.includes("its room has no outline yet: office-proxy") && !S.receiversBlock(n2.ctx, { quiet: true }), why && why.textContent);
  S._resetReceivers();
  const n3 = fake(none, [{ ok: true, ready: [], skipped: [], undo: 0 }]);
  S.receiversBlock(n3.ctx);
  await flush();
  const later = S.receiversBlock(n3.ctx);
  check("receivers: no receiver yet, a line saying it will work once they have areas", later && later.textContent.includes("PadSpan can put them in their rooms"), later && later.textContent);
  // Rooms drawn by hand (on the plan, no helper): the line shows there too (real panel, 2026-11-12).
  S._resetReceivers();
  const hand = house(3, { calibration: { points: [], model: {} } });
  hand.maps.list[0].room_bounds = { Kitchen: { points: [[0, 0], [1, 0], [1, 1]] } };
  const n5 = fake(hand, [{ ok: true, ready: [], skipped: [], undo: 0 }]);
  S.receiversBlock(n5.ctx);
  await flush();
  const hl = S.receiversBlock(n5.ctx);
  check("receivers: rooms drawn by hand, the line shows", hl && hl.getAttribute("data-setup") === "receivers-later", hl && hl.textContent);  // After a reload: the Undo is still there (the server keeps what the last press placed and says so in its dry run).
  S._resetReceivers();
  const n4 = fake(none, [{ ok: true, ready: [], skipped: [], undo: 2 }]);
  S.receiversBlock(n4.ctx);
  await flush();
  const rb = S.receiversBlock(n4.ctx);
  check("receivers: after a reload, Undo is still offered", rb && rb.querySelector('[data-setup="receivers-undo"]')?.textContent === "Undo the 2 placed last", rb && rb.textContent);
  S._resetReceivers();
  // Review 2026-11-13, break 5: a room drawn only on a plan with no scale says so, and offers that plan's scale (one press).
  const ns = house(3, { calibration: { points: [], model: {} } });
  ns.maps.list[0].room_bounds = { Kitchen: { points: [[0, 0], [1, 0], [1, 1]] } };
  const n6 = fake(ns, [{ ok: true, ready: [], skipped: [{ source: "attic-proxy", why: "no_scale", map_id: "m1" }], undo: 0 }]);
  S.receiversBlock(n6.ctx);
  await flush();
  const nsb = S.receiversBlock(n6.ctx);
  check("receivers: a room on a plan with no scale says so, with that plan's Set the scale", nsb && nsb.textContent.includes("its room is drawn on a floor plan with no scale yet: attic-proxy")
    && btn(nsb, "receivers-scale") && btn(nsb, "receivers-scale").textContent === "Set the scale of Ground", nsb && nsb.textContent);
  btn(nsb, "receivers-scale").click();
  check("receivers: its press opens that plan's scale step", ns._mapsWizard && ns._mapsWizard.step === 2 && ns._mapsWizard.mapId === "m1" && ns._setupReturn === "scale", ns._mapsWizard);
  // What a press placed names where they are moved: Calibration's first step (they are on the map of the house, not pins).
  check("receivers: the press's words name where they are dragged", said && said.textContent.includes("on the map of your house")
    && said.textContent.includes("Check receiver positions") && !said.textContent.includes("Edit → Radios"), said && said.textContent);
  S._resetReceivers();
  // Review 2026-11-11: every receiver placed already: nothing at all (a finished house was told "Once your Bluetooth
  // receivers are in Home Assistant…"). The answer is drawn in place: no redraw of the whole view.
  const fin = house(3, { calibration: { points: [], model: {} } });
  fin.maps.list[0].room_bounds = { Kitchen: { points: [[0, 0], [1, 0], [1, 1]] } };
  const nf = fake(fin, [{ ok: true, ready: [], skipped: [{ source: "aa", why: "placed_already" }, { source: "bb", why: "placed_already" }], undo: 0 }]);
  let redraws = 0;
  nf.ctx.actions.renderRooms = () => { redraws++; };
  const slot = S.receiversBlock(nf.ctx);
  await flush();
  check("receivers: all placed already, nothing said, no redraw", slot && !slot.textContent && !S.receiversBlock(nf.ctx) && redraws === 0
    && nf.sent.filter(x => x.dry_run).length === 1, [slot && slot.textContent, redraws]);
  S._resetReceivers();
  const nr = fake(fin, [{ ok: true, ready: [{ source: "cc", room: "Kitchen" }], skipped: [], undo: 0 }]);
  nr.ctx.actions.renderRooms = () => { redraws++; };
  const slot2 = S.receiversBlock(nr.ctx);
  await flush();
  check("receivers: the answer fills the block in place", slot2 && !!slot2.querySelector('[data-setup="receivers-place"]') && redraws === 0, slot2 && slot2.textContent);
  S._resetReceivers();
}

// Review 2026-11-13, break 4: one rule for "placed" — receivers only on the map of the house (the button's) count, in Setup.
{
  const st = house(4);
  st.model.scanner_positions_m = { aa: { x_m: 1, y_m: 1, z_m: 2.2, floor_id: "ground" }, bb: { x_m: 2, y_m: 2, z_m: 0.9, floor_id: "ground" } };
  const STATUS = await import(pathToFileURL(join(WWW, "views", "setup_status.js")).href);
  const d = S.deriveSetup(st);
  check("one rule: receivers only on the house map make the receivers step done", d.steps.find(x => x.id === "receivers").done === true
    && STATUS.placedReceivers(st, "ground").size === 2 && STATUS.placedReceivers(st, "up").size === 0, d.steps.map(x => [x.id, x.done]));
}

// No Skip for the plan: every step after it draws on one.
{
  const { ctx } = mkCtx(house(0, { calibration: { points: [] } }));
  const root = S.render(ctx);
  check("view: the plan step, current, has Start but no Skip", !!btn(root, "open-plan") && !btn(root, "skip-plan"));
}

// Loading: calibration asked once; the demo house says so.
{
  const st = house(5, { dataMode: "sample" });
  delete st.calibration;
  const { ctx, calls } = mkCtx(st);
  const root = S.render(ctx);
  S.render(ctx);
  check("view: calibration points are fetched once when not loaded",
    calls.filter(c => c[0] === "calibrationGet").length === 1, calls);
  check("view: the demo house showing says Setup works on your own house, with Back to my house",
    /demo house is showing/.test(root.textContent) && /Back to my house/.test(root.textContent));
  await shim.flush();
  check("view: once fetched, calibration reads as to do", st.calibration && S.deriveSetup(st).current === "calibration");
}

// Sample mode: Setup is about your own house, so nothing stored or counted.
{
  const st = house(2, { dataMode: "sample", calibration: { points: [], model: {} },
    settings: { setup_progress: { at: "floors", skipped: [], done: false } } });
  const { ctx, calls, events } = mkCtx(st);
  const root = S.render(ctx);
  const open = btn(root, "open-floors"), skip = btn(root, "skip-floors");
  check("sample: the step buttons are off", open && open.disabled && skip && skip.disabled);
  open.click(); skip.click();
  check("sample: nothing opened, stored or counted", st.view === "setup" && !saved(calls).length && !events.length, { calls, events });
  S.openStep(ctx, "rooms");
  check("sample: a step opened from elsewhere is not stored or counted either", !saved(calls).length && !events.length, { calls, events });
  const done = house(6, { dataMode: "sample", settings: { setup_progress: { at: "calibration", skipped: [], done: false } } });
  const d = mkCtx(done);
  S.render(d.ctx);
  check("sample: a finished house is not counted as finishing", !d.events.includes("setup_done") && !saved(d.calls).length, d.events);
}

// Finished.
{
  const used = house(6, { settings: { setup_progress: { at: "calibration", skipped: [], done: false } } });
  const a = mkCtx(used);
  const r = S.render(a.ctx);
  check("done: all done says so and counts setup_done once, stored",
    !!btn(r, "all-done") && a.events.filter(e => e === "setup_done").length === 1 && saved(a.calls).some(p => p.done === true), a.events);
  await shim.flush();
  S.render(a.ctx);
  check("done: not counted again", a.events.filter(e => e === "setup_done").length === 1, a.events);
  const never = mkCtx(house(6));
  S.render(never.ctx);
  check("done: a house set up before it ever opened Setup is not counted as finishing it",
    !never.events.includes("setup_done") && saved(never.calls).length === 0, never.events);
}

console.log(JSON.stringify({ cases, failures }));
