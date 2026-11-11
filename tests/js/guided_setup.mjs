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
  if (at("scale")) st.model.map_transforms.m1 = { reference_measurements: [{ px: 100, m: 2 }] };
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

  const one = house(2, {});
  one.model.floors = [F2[0]];
  check("derive: a one-floor house has no floor heights to set", S.deriveSetup(one).steps[2].done === true);

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
    JSON.stringify(sk.skipped) === '["scale"]' && sk.at === "floors" && d.steps[1].status === "skipped" && d.current === "floors", { sk, d: d.steps });
  const ahead = S.skipStep(st, { at: "rooms", skipped: [] }, "rooms");
  check("skip: skipping a step jumped ahead to moves on to the step after it", ahead.at === "receivers", ahead);
  let q = fresh;
  for (const id of ["scale", "floors", "rooms", "receivers", "calibration"]) q = S.skipStep({ ...st, calibration: { points: [] } }, q, id);
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
    JSON.stringify(rows(root)) === JSON.stringify([["plan", "done"], ["scale", "current"], ["floors", "todo"], ["rooms", "todo"], ["receivers", "todo"], ["calibration", "todo"]]), rows(root));
  check("view: the current step is counted as reached once per page",
    events.filter(e => e === "setup_step:scale").length === 1, events);
  S.render(ctx);
  check("view: a redraw does not count it again", events.filter(e => e === "setup_step:scale").length === 1, events);

  btn(S.render(ctx), "skip-scale").click();
  check("view: Skip counts setup_skip and stores the step as skipped",
    events.includes("setup_skip:scale") && saved(calls).some(p => p.skipped.includes("scale") && p.at === "floors"), { events, saved: saved(calls) });
  await shim.flush();
  check("view: after Skip the next step is current", JSON.stringify(rows(S.render(ctx)).slice(1, 3)) === '[["scale","skipped"],["floors","current"]]', rows(S.render(ctx)));

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
  const lineRow = async (st) => {
    AIWO._reset();
    const { ctx } = offering(st);
    S.render(ctx);
    for (let i = 0; i < 4; i++) await new Promise(r => setImmediate(r));
    const root = S.render(ctx);
    return root.querySelectorAll("[data-setup-status]").filter(n => n.querySelector('[data-aiw="line"]')).map(n => n.getAttribute("data-setup").slice(5));
  };
  const floorsNow = house(2, { calibration: { points: [], model: {} } });
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
  // 2026-11-12, the pull trigger: a Scale step opened from Setup and Setup shown again with it unfinished: "left".
  {
    AIWO._reset();
    const st = house(1, { calibration: { points: [], model: {} } });
    const m = mkCtx(st);
    S.openStep(m.ctx, "scale");
    st.view = "setup";
    S.render(m.ctx);
    const marks = m.calls.filter(c => c[0] === "ws" && c[1].type === "padspan_ha/ai_wizard_mark").map(c => `${c[1].what}:${c[1].setup_step}`);
    check("pull trigger: opened from Setup (seen), then Setup again with it unfinished (left)", marks.indexOf("step_seen:scale") === 0 && marks.indexOf("step_left:scale") === 1, marks);   // Rooms, opened earlier on this page, may follow
  }
  // Review 2026-11-12, item 13: opening a step already done is not "left unfinished".
  {
    AIWO._reset();
    const st = house(3, { calibration: { points: [], model: {} } });
    const m = mkCtx(st);
    S.openStep(m.ctx, "scale");
    check("pull trigger: a finished Scale step opened is not counted", !m.calls.some(c => c[0] === "ws" && c[1].type === "padspan_ha/ai_wizard_mark"), m.calls.map(c => c[1] && c[1].what));
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

// 2026-11-12: "Put my receivers in their rooms" on Setup's receivers step, for everyone: what it would do, what it did and
// what it couldn't (and why), one Undo.
{
  const st = house(4, { calibration: { points: [], model: {} }, live: { snapshot: { ble: { radios: [{ source: "porch-proxy" }, { source: "kitchen-proxy" }] } } } });
  st.model.scanners = { "kitchen-proxy": { room: "Kitchen", floor_id: "ground" }, "office-proxy": { room: "Office", floor_id: "ground" } };
  const m = mkCtx(st), sent = [];
  m.ctx.actions.callWS = async (msg) => {
    sent.push(msg);
    if (msg.type !== "padspan_ha/receivers_to_rooms") return {};
    return msg.undo ? { ok: true, undone: ["kitchen-proxy"], left: [] }
      : { ok: true, placed: [{ source: "kitchen-proxy", room: "Kitchen", x_m: 1.5, y_m: 1 }], skipped: [{ source: "office-proxy", why: "no_outline" }, { source: "porch-proxy", why: "no_area" }] };
  };
  check("receivers: the count it would place", S.receiversReady(st) === 1);
  let root = S.render(m.ctx);
  const row = root.querySelector('[data-setup="step-receivers"]');
  check("receivers: the button on the receivers step, said with no cost", row && !!row.querySelector('[data-setup="receivers-place"]')
    && row.textContent.includes("1 receiver has a room with an outline and no place on the map yet") && row.textContent.includes("No AI, nothing to pay"), row && row.textContent);
  btn(root, "receivers-place").click();
  for (let i = 0; i < 6; i++) await new Promise(r => setImmediate(r));
  root = S.render(m.ctx);
  const said = btn(root, "receivers-said");
  check("receivers: what it placed, what it couldn't and why", said && said.textContent.includes("Placed 1 receiver at the middle of its room (kitchen-proxy in Kitchen)")
    && said.textContent.includes("no Home Assistant area: porch-proxy") && said.textContent.includes("its room has no outline yet: office-proxy"), said && said.textContent);
  btn(root, "receivers-undo").click();
  for (let i = 0; i < 6; i++) await new Promise(r => setImmediate(r));
  root = S.render(m.ctx);
  const u = sent.find(x => x.type === "padspan_ha/receivers_to_rooms" && x.undo);
  // Review 2026-11-12: what it placed is kept on the server (a reload keeps the Undo); Undo asks the server to take it back.
  check("receivers: Undo in one step, from what the server kept", u && u.undo === true && btn(root, "receivers-said").textContent.startsWith("1 taken back off the map")
    && !btn(root, "receivers-undo"), u);
  const demo = house(4, { dataMode: "sample" });
  demo.model.scanners = st.model.scanners;
  check("receivers: nothing on the demo house", !S.receiversBlock(mkCtx(demo).ctx));
  // Rooms and no receiver ready: one plain line on the receivers step (it says the button exists); nothing on the helper's Done.
  // After a reload: the Undo is still there (the server keeps what the last press placed).
  {
    const AIWO = await import(pathToFileURL(join(WWW, "views", "ai_wizard_offer.js")).href);
    S._resetReceivers(); AIWO._reset();
    const st2 = house(5, { calibration: { points: [], model: {} } });
    st2.model.scanners = {};
    const m2 = mkCtx(st2);
    m2.ctx.actions.callWS = async (msg) => (msg.type === "padspan_ha/ai_wizard_info" ? { reason: "has_rooms", offer: false, wizard: { receivers_placed: { "kitchen-proxy": [1.5, 1, 2.4, "ground"] } } } : {});
    AIWO.infoFor(m2.ctx, "setup");
    for (let i = 0; i < 4; i++) await new Promise(r => setImmediate(r));
    const rb = S.receiversBlock(m2.ctx);
    check("receivers: after a reload, Undo is still offered", rb && !!rb.querySelector('[data-setup="receivers-undo"]'), rb && rb.textContent);
    AIWO._reset(); S._resetReceivers();
  }
  S._resetReceivers();
  const none = house(4, { calibration: { points: [], model: {} } });
  none.model.scanners = {};
  const later = S.receiversBlock(mkCtx(none).ctx);
  check("receivers: none ready, a line saying it will work once they have areas", later && later.getAttribute("data-setup") === "receivers-later"
    && later.textContent.includes("PadSpan can put them in their rooms") && !S.receiversBlock(mkCtx(none).ctx, { quiet: true }), later && later.textContent);
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
