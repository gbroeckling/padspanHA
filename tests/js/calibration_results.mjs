// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
//
// Calibration → Results (views/calibration_results.js), run for real: the
// shipped calibration.js render() under the DOM shim, and the module's own
// nextAction() for the priority order.
//
// Run: node tests/js/calibration_results.mjs <www/padspan-ha dir>
// Prints one JSON line: { cases: {name: bool}, failures: [...] }.
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { install } from "./dom_shim.mjs";

const WWW = process.argv[2];
install(globalThis);
const CAL = await import(pathToFileURL(join(WWW, "views", "calibration.js")).href);
const R = await import(pathToFileURL(join(WWW, "views", "calibration_results.js")).href);

const cases = {}, failures = [];
const check = (name, ok, info) => { cases[name] = !!ok; if (!ok) failures.push({ name, info }); };
const tick = () => new Promise(r => setImmediate(r));

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
    n.appendChild(typeof c === "string" || typeof c === "number" ? document.createTextNode(String(c)) : c);
  }
  return n;
}
const quiet = () => new Proxy(() => document.createElement("span"), { get: (t, k) => k === "then" ? undefined : quiet() });

// One Calibration screen: its state, and every WS call and report event it made.
function screen(state) {
  const calls = [], events = [];
  const writes = [];
  const actions = {
    renderRooms: () => {}, renderNav: () => {},
    callWS: async (p) => { calls.push(p); return p.type === "padspan_ha/setup_tips" ? { tips: state._tipsAnswer || [] } : {}; },
    telemetryEvent: (n) => events.push(n),
    calibrationGet: async () => state.calibration,
  };
  for (const w of ["calibrationSavePoint", "calibrationDeletePoint", "calibrationClear", "calibrationClearMap", "calibrationComputeModel", "settingsSet"]) {
    actions[w] = async () => { writes.push(w); return {}; };
  }
  const ctx = {
    state,
    helpers: new Proxy({ el, helpBtn: () => el("button", {}, "?"), radioShortId: (s) => String(s || ""), mapImageUrl: () => "",
                         scannerStatus: () => "ok", esc: (s) => String(s) }, { get: (t, k) => k in t ? t[k] : quiet() }),
    actions: new Proxy(actions, { get: (t, k) => k in t ? t[k] : quiet() }),
    toast: () => {},
  };
  const render = () => CAL.render(ctx);
  return { ctx, calls, events, writes, render };
}

const LIVE = () => ({ view: "calibration", dataMode: "live", _dataModeKnown: true, _modelLoaded: true,
  live: { snapshot: { source: "live", ble: { radios: [] }, objects: { list: [] } } },
  settings: { telemetry_enabled: true }, maps: { list: [] } });
const RECT = (fid) => ({ type: "poly", floor_id: fid, points_m: [[0, 0], [3, 0], [3, 3], [0, 3]] });
const now = Date.now();
const iso = (hoursAgo) => new Date(now - hoursAgo * 3600000).toISOString();
const pts = (room, n, hoursAgo = 24) => Array.from({ length: n }, (_, i) => ({ id: `${room}${i}`, room, collected_at: iso(hoursAgo + i) }));
const CALDATA = () => ({
  points: [...pts("Kitchen", 6), ...pts("Living", 5)],
  model: { last_computed: iso(1), loo_accuracy: { mean_error_m: 1.1, room_confusion: {
    rooms: { Kitchen: { point_count: 6, correct: 3, accuracy: 0.5 }, Living: { point_count: 5, correct: 5, accuracy: 1 } },
    confusion_pairs: [{ true_room: "Kitchen", pred_room: "Living", count: 3 }] } } },
  heldout: { knn: { spots: 11, rooms_right_pc: 64, median_error_m: 2.3 }, spatial: { spots: 11, rooms_right_pc: 55, median_error_m: 2.9 }, better: "knn" },
});
const text = (n) => n ? n.textContent : "";

// ── Results with data ───────────────────────────────────────────────────────
{
  const st = { ...LIVE(), calibration: CALDATA(), model: { room_geometry_m: { Kitchen: RECT("main"), Living: RECT("main"), Den: RECT("main"), Garden: RECT("__outside__") } } };
  const s = screen(st);
  let root = s.render();
  check("data: Calibration opens on Results", st._calib.tab === "results" && root.querySelector('[data-cal-results="tab"]'), st._calib.tab);
  await tick(); await tick();
  root = s.render();
  const acc = text(root.querySelector('[data-cal-results="accuracy"]'));
  check("data: the house's accuracy is the held-out score of the better method",
    acc.includes("64%") && acc.includes("2.3 m") && acc.includes("11calibration points") && acc.includes("Tested on spots it hasn't seen"), acc);
  const rooms = root.querySelectorAll("[data-cal-room]").map(n => n.attributes["data-cal-room"]);
  check("data: rooms that need work first (no points, then the weakest), outside left out",
    JSON.stringify(rooms) === JSON.stringify(["Den", "Kitchen", "Living"]), rooms);
  const next = root.querySelector('[data-cal-results="next"]');
  check("data: next best thing is the room with no points", next && next.attributes["data-kind"] === "room_empty" && text(next).includes("Den"), text(next));
  check("data: the setup tips are asked for once, and nothing is written",
    s.calls.filter(c => c.type === "padspan_ha/setup_tips").length === 1 && s.calls.every(c => c.type === "padspan_ha/setup_tips") && !s.writes.length,
    { calls: s.calls, writes: s.writes });
  check("data: the tab's opening is counted once across redraws", s.events.filter(e => e === "cal_results_opened").length === 1, s.events);
  next.querySelector('[data-cal-results="go"]').click();
  check("data: its button goes to Pin & Listen and is counted", st._calib.tab === "pin" && s.events.includes("cal_results_action:room_empty"), { tab: st._calib.tab, ev: s.events });
  s.render();
  st._calib.tab = "results"; s.render();
  check("data: coming back to Results counts a new opening", s.events.filter(e => e === "cal_results_opened").length === 2, s.events);
  root = s.render();
  const guidedN = (r) => r.querySelectorAll("button").filter(b => text(b).includes("Guided calibration")).length;
  check("data: Results shows Guided calibration once (its own, not the header's too)",
    guidedN(root) === 1 && !root.querySelector('[data-calib-guided="header"]'), guidedN(root));
  st._calib.tab = "tune";
  const onTune = s.render();
  check("data: on another tab the header's Guided calibration is there", !!onTune.querySelector('[data-calib-guided="header"]'));
  st._calib.tab = "results";
  root = s.render();
  root.querySelector('[data-cal-results="guided"]').click();
  check("data: Guided calibration is the main button and opens the walk-through",
    st._calibWizard && st._calibWizard.step === 1 && st._calibWizard.from === "results" && s.events.includes("cal_results_action:guided"), st._calibWizard);
  root = s.render();
  const exit = root.querySelectorAll("button").find(b => text(b).includes("Exit guide"));
  exit.click();
  check("data: leaving the walk-through early comes back to Results", !st._calibWizard && st._calib.tab === "results", st._calib.tab);
  check("data: nothing on Results wrote calibration or settings", !s.writes.length, s.writes);
}

// ── An empty house ──────────────────────────────────────────────────────────
{
  const st = { ...LIVE(), calibration: { points: [], model: {}, heldout: null }, model: { room_geometry_m: { Kitchen: RECT("main") } } };
  const s = screen(st);
  let root = s.render();
  const empty = root.querySelector('[data-cal-results="empty"]');
  check("empty: two lines and Guided calibration", empty && text(empty).includes("No calibration yet") && empty.querySelector('[data-cal-results="guided"]')
    && !root.querySelector('[data-cal-results="accuracy"]') && !root.querySelector('[data-cal-results="next"]'), text(root));
  empty.querySelector('[data-cal-results="guided"]').click();
  check("empty: the button opens Guided calibration", st._calibWizard && st._calibWizard.step === 1, st._calibWizard);
  // A floor plan with no scale blocks saving points: it shows above.
  const st2 = { ...LIVE(), calibration: { points: [], model: {} }, _tipsAnswer: ["scale"], maps: { list: [{ id: "m1" }] } };
  const s2 = screen(st2);
  s2.render(); await tick(); await tick();
  root = s2.render();
  const nx = root.querySelector('[data-cal-results="next"]');
  check("empty: a plan with no scale is asked for first", nx && nx.attributes["data-kind"] === "scale" && root.querySelector('[data-cal-results="empty"]'), text(root));
  nx.querySelector('[data-cal-results="go"]').click();
  check("empty: Measure goes to the map wizard's scale step", st2.view === "maps" && st2._mapsWizard && st2._mapsWizard.step === 2 && st2._mapsWizard.mapId === "m1"
    && s2.events.includes("cal_results_action:scale"), { v: st2.view, w: st2._mapsWizard });
  // Floor heights live on Mapping's 3D Stack, Advanced only: Basic switches and says so.
  for (const mode of ["basic", "advanced"]) {
    const st3 = { ...LIVE(), complexity: mode, calibration: CALDATA(), _tipsAnswer: ["floor_heights"], maps: { list: [{ id: "m1" }] } };
    const s3 = screen(st3);
    const toasts = [];
    s3.ctx.actions.setComplexity = (m) => { st3.complexity = m; };
    // A view's toast is ctx.toast; the real ctx.actions has no toast.
    s3.ctx.toast = (t) => toasts.push(t);
    s3.ctx.actions.toast = undefined;
    s3.ctx.actions.setMapsTab = (t) => { st3.mapsTab = t; };
    s3.render(); await tick(); await tick();
    const fx = s3.render().querySelector('[data-cal-results="next"]');
    fx.querySelector('[data-cal-results="go"]').click();
    check(`data: floor heights from ${mode}: Mapping's 3D Stack, ${mode === "basic" ? "switched to Advanced with a toast" : "no switch, no toast"}`,
      fx.attributes["data-kind"] === "floor_heights" && st3.view === "maps" && st3.mapsTab === "stack" && st3.complexity === "advanced"
      && toasts.length === (mode === "basic" ? 1 : 0) && (mode !== "basic" || /switched to Advanced/.test(toasts[0])),
      { kind: fx.attributes["data-kind"], v: st3.view, tab: st3.mapsTab, c: st3.complexity, toasts });
  }
}

// ── Sample mode ─────────────────────────────────────────────────────────────
{
  const st = { view: "calibration", dataMode: "sample", _dataModeKnown: true, settings: { telemetry_enabled: true }, maps: { list: [] },
               calibration: { points: [], model: {} } };
  const s = screen(st);
  const root = s.render();
  const acc = text(root.querySelector('[data-cal-results="accuracy"]'));
  const rooms = root.querySelectorAll("[data-cal-room]").map(n => n.attributes["data-cal-room"]);
  check("sample: the sample house's results, said to be made up", root.querySelector('[data-cal-results="sample"]') && acc.includes("79%")
    && rooms[0] === "Guest Room" && rooms.length === 5, { acc, rooms });
  check("sample: no setup tips asked, nothing counted, nothing written", !s.calls.length && !s.events.length && !s.writes.length, { calls: s.calls, ev: s.events });
  const nx = root.querySelector('[data-cal-results="next"]');
  check("sample: the next best thing comes from the sample (its weakest room)", nx && nx.attributes["data-kind"] === "room_weak" && text(nx).includes("Guest Room"), text(nx));
}

// ── Deep links and requests from elsewhere ──────────────────────────────────
for (const [req, want] of [["tune", "tune"], ["matrix", "matrix"], ["model", "model"], ["setup", "setup"], ["beacon", "beacon"], ["results", "results"], ["nosuch", "results"]]) {
  const st = { ...LIVE(), calibration: CALDATA(), _calibTabRequest: req };
  const s = screen(st);
  s.render();
  check(`link: ?tab=${req} opens ${want}`, st._calib.tab === want && st._calibTabRequest === null, st._calib.tab);
}
{
  const st = { ...LIVE(), calibration: CALDATA() };
  const s = screen(st);
  s.render();
  st._calib.tab = "roam"; s.render();
  st.view = "overview"; s.render(); st.view = "calibration"; s.render();
  check("link: a tab picked this session is kept", st._calib.tab === "roam", st._calib.tab);
  st._calibTabRequest = "tune"; st.view = "overview"; s.render();
  check("link: a request waits until Calibration is shown", st._calibTabRequest === "tune" && st._calib.tab === "roam", st._calib.tab);
  st.view = "calibration"; s.render();
  check("link: then opens its tab", st._calib.tab === "tune", st._calib.tab);
  const walkOff = { ...LIVE(), calibration: CALDATA(), _calibTabRequest: "walk" };
  screen(walkOff).render();
  check("link: Walk a room only while it is on", walkOff._calib.tab === "results", walkOff._calib.tab);
}

// ── The next best thing, by priority ────────────────────────────────────────
{
  const W = (roomConf) => {           // calibration.js's _weakestRoom rule, as passed in
    const c = Object.entries(roomConf.rooms || {}).filter(([, r]) => r.point_count >= 2 && r.accuracy < 0.8).sort((a, b) => a[1].accuracy - b[1].accuracy);
    return c.length ? { name: c[0][0], accuracy: c[0][1].accuracy, confusedWith: null, suggested: 3 } : null;
  };
  const good = () => ({
    points: [...pts("Kitchen", 5), ...pts("Living", 5)],
    model: { last_computed: iso(1), loo_accuracy: { mean_error_m: 1, room_confusion: { rooms: {
      Kitchen: { point_count: 5, correct: 5, accuracy: 1 }, Living: { point_count: 5, correct: 5, accuracy: 1 } }, confusion_pairs: [] } } },
  });
  const kind = (o) => R.nextAction({ weakestRoom: W, roomNames: ["Kitchen", "Living"], ...o }).kind;
  const all = ["scale", "receiver_heights", "floor_heights"];
  check("priority: no scale beats everything", kind({ tips: all, calData: good() }) === "scale");
  check("priority: no points next", kind({ tips: ["receiver_heights"], calData: { points: [], model: {} } }) === "start");
  check("priority: receiver heights before floor heights", kind({ tips: ["floor_heights", "receiver_heights"], calData: good() }) === "receiver_heights");
  check("priority: floor heights", kind({ tips: ["floor_heights"], calData: good() }) === "floor_heights");
  const newer = good(); newer.points.push({ room: "Kitchen", collected_at: iso(0) });
  check("priority: points newer than the score: work it out again", kind({ calData: newer }) === "compute");
  const never = good(); delete never.model.loo_accuracy;
  check("priority: no score yet: work it out", kind({ calData: never }) === "compute");
  check("priority: a drawn room with no points", R.nextAction({ weakestRoom: W, roomNames: ["Kitchen", "Living", "Den"], calData: good() }).room === "Den");
  const weak = good(); weak.model.loo_accuracy.room_confusion.rooms.Living.accuracy = 0.4;
  const wa = R.nextAction({ weakestRoom: W, roomNames: ["Kitchen", "Living"], calData: weak });
  check("priority: the weakest room", wa.kind === "room_weak" && wa.room === "Living", wa);
  const few = good(); few.points = few.points.filter(p => p.room === "Kitchen" || p.id === "Living0" || p.id === "Living1");
  few.model.loo_accuracy.room_confusion.rooms.Living = { point_count: 2, correct: 2, accuracy: 1 };
  const fa = R.nextAction({ weakestRoom: W, roomNames: ["Kitchen", "Living"], calData: few });
  check("priority: a room with too few points", fa.kind === "room_weak" && fa.room === "Living", fa);
  const old = good(); old.points.forEach(p => { p.collected_at = iso(24 * 120); }); old.model.last_computed = iso(24 * 100);
  const oa = R.nextAction({ weakestRoom: W, roomNames: ["Kitchen", "Living"], calData: old });
  check("priority: stale calibration", oa.kind === "stale" && oa.days >= 119, oa);
  check("priority: nothing to fix: Accuracy by spot", kind({ calData: good() }) === "matrix");
  check("priority: every kind is one the report allows", R.ACTION_KINDS.length === 10);
}

console.log(JSON.stringify({ cases, failures }));
