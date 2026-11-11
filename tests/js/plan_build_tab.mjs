// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
//
// Line up plans (Build from plans, experimental): the Plans tool's second tab
// in views/live_aboard_plans.js, RUN: the tab shows only when the server says
// the line-up is on, the floor picker and its plans, a session's proposals with
// their overlays, what each would shift, stops in words with Resume, the two
// kinds of question, verdicts written at the click, Accept saving one item and
// the floor's Save only the items that shift nothing, a refusal said in its
// words, Undo this line-up session, Show me the dimension, a refile by hand,
// and every part of the tab saying experimental. A synthetic session; no
// house's data. The pytest wrapper is tests/test_plan_build.py.
//
// Run:  node tests/js/plan_build_tab.mjs <repo-root>
import { pathToFileURL } from "node:url";
const ROOT = process.argv[2];
const { install } = await import(pathToFileURL(ROOT + "/tests/js/dom_shim.mjs").href);
install(globalThis);
globalThis.Image = class { constructor() { this.complete = false; this.naturalWidth = 0; } addEventListener() {} set src(v) { this._src = v; } get src() { return this._src; } };
const { createPlans } = await import(pathToFileURL(ROOT + "/custom_components/padspan_ha/www/padspan-ha/views/live_aboard_plans.js").href);
const DRAFT = await import(pathToFileURL(ROOT + "/custom_components/padspan_ha/www/padspan-ha/views/live_aboard_draft.js").href);

const settle = async () => { for (let i = 0; i < 10; i++) await new Promise(r => setImmediate(r)); };
const results = {};
const check = (name, ok, detail) => { results[name] = { ok: !!ok, detail: ok ? undefined : detail }; };
const all = (n, out = []) => { for (const c of (n.childNodes || n.children || [])) { out.push(c); all(c, out); } return out; };
const text = (n) => (n.textContent || "").replace(/\s+/g, " ").trim();
const tag = (n) => (n.tagName || n.localName || "").toUpperCase();
const buttons = (sheet) => all(sheet).filter(n => tag(n) === "BUTTON");
const button = (sheet, label) => buttons(sheet).find(b => text(b) === label || text(b).startsWith(label)) || null;
const click = async (b) => { if (!b) return false; b.dispatchEvent(new Event("click", { bubbles: true })); await settle(); return true; };
const attr = (n, k) => (n.getAttribute ? n.getAttribute(k) : (n.attributes || {})[k]);

const CORNERS = (x, y, w, h) => [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
const ITEMS = {
  place_m2: { kind: "place", map_id: "m2", name: "Scan", state: "open", verdict: null, held: null, max_move_m: 1.42, scale_change: 0.08,
    corners_now_m: CORNERS(1, 0, 9, 7), corners_new_m: CORNERS(0, 0, 10, 8), evidence: { anchor: "m1", anchor_name: "Shop plan", corr: 0.91, seed: "stairs", tilt_deg: -0.4,
      ppm_printed: [90.9, 90.8], ppm_now: [100.0, 107.1], ppm_new: [90.9, 90.8] },
    flags: [{ what: "calibration", id: "cp_1", stored_m: [3, 3], click_m: [3.4, 3.2], moved_m: 0.45, room_now: "Den", room_click: "Shop" },
            { what: "room_trace", id: "Den", label: "Den", moved_m: 0.6 }], others: { n: 2, names: ["Lamp", "Fan"] } },
  refile_m3: { kind: "refile", map_id: "m3", name: "Upstairs", state: "open", verdict: null, proposal: { to_floor_id: "upper", why: { title: null, rooms: ["OFFICE", "STUDIO"] } },
    to_name: "Upper", drawn: { rooms: 0, calibration: 0, receivers: 0, beacons: 0, lights: 0 }, flags: [], others: { n: 0, names: [] } },
  anchor_m1: { kind: "anchor_scale", map_id: "m1", name: "Shop plan", state: "info", verdict: null, max_move_m: 0.12, scale_change: 0.02,
    corners_now_m: CORNERS(0, 0, 10, 8), corners_new_m: CORNERS(0, 0, 10.2, 8), evidence: { seed: "dims", scale_err: [-0.02, 0.001] }, flags: [], others: { n: 0, names: [] } },
};
const SESSION = (over = {}) => ({ id: "pb_1", rev: 4, stage: "s1", floor_id: "basement", status: "out_of_time", error: null, reads: 7, reused: 0, est_usd: 0.08, spent_s: 64, budget_s: 600,
  plans: [{ map_id: "m1", name: "Shop plan", size_px: [1000, 800], corners_m: CORNERS(0, 0, 10, 8), role: "anchor" },
          { map_id: "m2", name: "Scan", size_px: [900, 750], corners_m: CORNERS(1, 0, 9, 7), role: "plan",
            dims: [{ axis: "x", text: "3 m + 2.5 m + 2.5 m", box: [40, 630, 770, 665], ticks_px: [[42, 654], [769, 649]], span_px: 727.1, ppm: 90.89, parse_m: 8, ok: true, source: "ai" },
                   { axis: "y", text: "12'-0\"", box: [860, 40, 890, 700], ok: false, why: "unconfirmed" }] },
          { map_id: "m3", name: "Upstairs", size_px: [640, 480], corners_m: CORNERS(0, 0, 6, 4), role: "other_floor" }],
  questions: [{ id: "q1", kind: "confirm_dimension", map_id: "m2", name: "Scan", state: "open", axis: "x", box: [40, 630, 770, 665], ticks_px: [[42, 654], [769, 649]], ai: { text: "3 m + 2.5 m + 2.5 m", metres: 8 } },
              { id: "q2", kind: "tap_corners", map_id: "m2", other_map_id: "m1", name: "Scan", other_name: "Shop plan", state: "open" }],
  items: JSON.parse(JSON.stringify(ITEMS)),
  stops: [{ reason: "out_of_time", at: 1, say: "The session ran out of time. What was read is kept.", next: "Resume reads the rest." },
          { reason: "help_unanswered", at: 2, say: "A question is waiting for you.", next: "Answer it, or Skip." }],
  cross_floor: { floor_id: "main", stairs_m: 0.34 }, resumable: true, ...over });
const INFO = (on = true) => ({ unlock: { ok: on, why: on ? "ok" : "below_opus_5_5", display: "Claude Opus 5.5" }, master: true, switch: on, on, running: null, start_blocked: null,
  floors: [{ id: "basement", name: "Basement", plans: [{ map_id: "m1", name: "Shop plan", drawn: { rooms: 0, calibration: 0 }, gauge: false, est_usd: [0.05, 0.1] },
                                                        { map_id: "m2", name: "Scan", drawn: { rooms: 1, calibration: 1 }, est_usd: [0.06, 0.12] }],
             last: { session: "pb_1", at: 5, status: "needs_help" } }, { id: "main", name: "Main", plans: [{ map_id: "g1", name: "Measured", gauge: true, drawn: {} }], last: null }],
  stall: { month: {}, words: {} } });

function mount(answers, opts = {}){
  const sheet = document.createElement("div"), root = document.createElement("div");
  const calls = [], hints = [], tel = [];
  const callWS = async (m) => {
    calls.push(m);
    const a = answers[m.type.replace("padspan_ha/", "")];
    const v = typeof a === "function" ? a(m) : a;
    if (v instanceof Error) throw v;
    return v;
  };
  let tool;
  const redraw = () => { sheet.replaceChildren(); tool.sheet(); };
  const draft = DRAFT.createDraft(DRAFT.ownedOf({ schema: 1, pieces: {} }));
  tool = createPlans({ root, sheet, guard: (f) => f, host: () => ({ callWS, go: opts.go || null, telemetry: (e) => tel.push(e) }), floors: () => [{ fl: { id: "basement", name: "Basement" } }], hint: (t, bad) => hints.push([t, bad]), redraw,
    DRAFT, draft: () => draft, change: (fn) => draft.change(fn), saving: () => false, save: () => {}, stairPiece: () => null, fileWritten: () => {} });
  return { sheet, tool, calls, hints, tel, sent: (type) => calls.filter(c => c.type === `padspan_ha/${type}`) };
}
/** The host's next actions (maps.js plansGo), recorded; `offered`: the rooms helper's rule says yes. */
const GO = (offered = true) => { const went = []; return { went, measure: (id) => went.push(`measure:${id}`), helperOffered: () => offered,
  helper: () => went.push("helper"), settings: () => went.push("settings") }; };
const BASE = { maps_image_urls: { image_urls: { m1: "/signed/m1", m2: "/signed/m2", m3: "/signed/m3" } },
  plan_ai_plans: { plans: [], ai: { ready: true, name: "Claude", local: false }, running: null, latest: null, start_blocked: null } };

// ── off: no tab ──────────────────────────────────────────────────────────────
{
  const M = mount({ ...BASE, plan_build_info: INFO(false) });
  M.tool.show(true); await settle();
  check("off: no line-up tab when the server says it is off", !button(M.sheet, "Line up plans (experimental)"), text(M.sheet));
  M.tool.dispose();
}
// ── on: the tab, the session, the cards ─────────────────────────────────────
{
  let sess = SESSION();
  const M = mount({ ...BASE, plan_build_info: INFO(true), plan_build_status: () => ({ session: sess, running: null }),
    plan_build_verdict: (m) => { const it = sess.items[m.item_id]; if (m.v === "back") { it.state = "open"; it.verdict = null; } else { it.state = m.v; it.verdict = { v: m.v, why: m.why || null }; } sess.rev++; return { rev: sess.rev, item: it }; },
    // The first save of the placement is refused by the calibration preflight (nothing written); the next goes in.
    plan_build_commit: (m) => {
      if (m.items.includes("place_m2") && !commits.refusedOnce) { commits.refusedOnce = true; sess.rev++;
        return { ok: false, code: "points_out_of_range", rev: sess.rev, items: ["place_m2"],
                 message: "Line up plans (experimental): 1 of 1 calibration points on Scan would fall off its picture, so nothing was saved. Mark it wrong, or line the plan up by hand in Mapping → Align." }; }
      for (const id of m.items) sess.items[id].state = "committed";
      sess.rev++; return { ok: true, rev: sess.rev, batch: "lb_1", backup_id: "bk_1", session: sess };
    },
    plan_build_undo: () => { for (const it of Object.values(sess.items)) if (it.state === "committed") it.state = "undone"; sess.rev++; return { ok: true, undone: 2, skipped: [], session: sess }; },
    plan_build_refile: (m) => { sess.items[`refile_${m.map_id}`] = { kind: "refile", map_id: m.map_id, name: "Scan", state: "refused", by_hand: true, proposal: { to_floor_id: m.to_floor_id, why: { title: null, rooms: [] } },
      to_name: "Main", drawn: { rooms: 1, calibration: 1 }, flags: [], others: { n: 0, names: [] } }; sess.rev++;
      return { ok: false, code: "refile_refused", message: "Line up plans (experimental): This plan shows another floor, but things are drawn on it. Move it by hand in Mapping → 3D Stack if you're sure.", rev: sess.rev, item_id: `refile_${m.map_id}`, session: sess }; },
    plan_build_answer: (m) => { sess = { ...sess, questions: sess.questions.map(q => (q.id === m.question_id ? { ...q, state: "answered", answer: m.answer } : q)) }; return { session: sess }; },
    plan_build_resume: { session: "pb_1" } });
  const commits = {};
  M.tool.show(true); await settle();
  const tab = button(M.sheet, "Line up plans (experimental)");
  check("on: the tab is offered beside Add data via plans", !!tab && !!button(M.sheet, "Add data via plans"), text(M.sheet));
  await click(tab);
  const t = () => text(M.sheet);
  check("session: opens on the floor's last session", M.sent("plan_build_status")[0]?.session === "pb_1" && t().includes("Basement: ran out of time. 7 reads"), t());
  check("session: the estimate and the cross-floor look", t().includes("about $0.08 (estimate)") && t().includes("Its stairs sit 0.3 m from Main's"), t());
  check("banner: what it may get wrong, in one plain sentence", t().includes("Claude reads the text; PadSpan measures. Matches and scales can still be wrong"), t());
  check("stops: each in words with the way on, Resume offered", t().includes("The session ran out of time. What was read is kept. Resume reads the rest.") && !!button(M.sheet, "Resume (experimental)"), t());
  check("question: a dimension to confirm, with Claude's words", t().includes("Claude reads “3 m + 2.5 m + 2.5 m” (8.0 m) here. Is that what the plan says?") && !!button(M.sheet, "Yes") && !!button(M.sheet, "Skip this one"), t());
  check("question: corners to tap on two plans", t().includes("Tap the same corner on Scan and Shop plan") && !!button(M.sheet, "Use these taps"), t());
  check("card: the placement, its numbers and its anchor", t().includes("Line up · Scan") && t().includes("Moves up to 1.4 m; scale changes 8.0 %.") && t().includes("Matches Shop plan well (found by the stairs)")
    && all(M.sheet).some(n => n.title === "Match score 0.91 (1.00: a perfect match)"), t());
  check("card: what it would shift, never moved", t().includes("A calibration click lands 0.5 m from where it is stored, in Shop. This tool never moves calibration points.")
    && t().includes("Den was traced on this plan; its outline in the house stays where it is.") && t().includes("2 other devices on this floor lie under this plan"), t());
  check("card: the accept names its effects", !!button(M.sheet, "Accept: 2 things drawn on this plan would move"), t());
  check("card: the refile, its evidence", t().includes("Move to another floor · Upstairs") && t().includes("It shows Upper: OFFICE, STUDIO. Then line it up on Upper."), t());
  check("card: the anchor's own error is information", t().includes("Scale of the plan the others are lined up to · Shop plan") && t().includes("Under 3 %: for information only."), t());
  check("card: an overlay per placement and per anchor, none for a refile", all(M.sheet).filter(n => tag(n) === "CANVAS").length >= 2 + 1 + 2, all(M.sheet).filter(n => tag(n) === "CANVAS").length);
  // Every part of the tab says experimental (design 7).
  const parts = all(M.sheet).filter(n => attr(n, "data-plan-build") !== undefined && attr(n, "data-plan-build") !== null);
  const quiet = parts.filter(n => !/experimental/i.test(text(n)));
  check("experimental: every part of the tab says so", parts.length >= 6 && quiet.length === 0, quiet.map(n => text(n).slice(0, 80)));
  // Verdicts: written at the click.
  await click(button(M.sheet, "Wrong"));
  await click(button(M.sheet, "Wrong scale"));
  const v = M.sent("plan_build_verdict")[0];
  check("verdict: wrong with one reason, written at once", v && v.item_id === "place_m2" && v.v === "wrong" && v.why === "wrong_scale" && v.rev === 4, JSON.stringify(v));
  check("verdict: taken back", !!button(M.sheet, "Take that back"), text(M.sheet));
  await click(button(M.sheet, "Take that back"));
  check("verdict: back to open", sess.items.place_m2.state === "open" && M.sent("plan_build_verdict")[1]?.v === "back", JSON.stringify(sess.items.place_m2));
  check("verdict: each hint says experimental (review R4)", M.hints.length >= 2 && M.hints.every(([h]) => h.startsWith("Line up plans (experimental): ")), M.hints);
  // Show me the dimension: the printed dimension the proposal stands on, on its picture.
  const canvases = () => all(M.sheet).filter(n => tag(n) === "CANVAS").length;
  const before = canvases();
  await click(button(M.sheet, "Show me the dimension"));
  check("dimension: shown on the plan, measured between its ticks", canvases() === before + 1 && t().includes("The printed sizes this change is based on (experimental)")
    && t().includes("Scan (this plan): “3 m + 2.5 m + 2.5 m” = 8.000 m across; 727 px between its end marks, so 90.9 pixels per metre.")
    && t().includes("Scale in pixels per metre, across / down: from the printed sizes 90.9 / 90.8; now 100.0 / 107.1; proposed 90.9 / 90.8."), t());
  check("dimension: an unconfirmed reading isn't shown as used", !t().includes("12'-0"), t());
  await click(button(M.sheet, "Hide the dimension"));
  // The floor's Save takes only what shifts nothing drawn on a plan (form q8); the rest one by one.
  const save = button(M.sheet, "Save line-up for Basement (experimental): 1 to another floor");
  check("save: names the floor and only what shifts nothing", !!save && t().includes("1 change would move things drawn on its plan, so it is accepted one by one."), buttons(M.sheet).map(b => text(b)));
  await click(save);
  const sv = M.sent("plan_build_commit")[0];
  check("save: the group goes to the server as a group", sv && sv.group === true && sv.items.join() === "refile_m3" && sv.rev === 6, JSON.stringify(sv));
  check("save: saved, said on its card and in a hint", t().includes("Saved (experimental). A backup was taken first; Undo this line-up session takes it back.")
    && M.hints.some(([h]) => h.startsWith("Line up plans (experimental): saved it.")), t());
  // Accept one by one: refused by the calibration preflight first, said in its words, nothing else; then saved.
  await click(button(M.sheet, "Accept: 2 things drawn on this plan would move"));
  const one = M.sent("plan_build_commit")[1];
  check("accept: one item, not a group", one && one.items.join() === "place_m2" && !one.group, JSON.stringify(one));
  check("accept: a refusal is said in plain words", t().includes("Line up plans (experimental): 1 of 1 calibration points on Scan would fall off its picture, so nothing was saved.")
    && sess.items.place_m2.state === "open", t());
  await click(button(M.sheet, "Accept: 2 things drawn on this plan would move"));
  check("accept: saved the second time", sess.items.place_m2.state === "committed" && M.sent("plan_build_commit").length === 3 && !t().includes("would fall off its picture"), t());
  check("accept: a saved item takes no verdict", !button(M.sheet, "Accept: 2 things drawn on this plan would move"), buttons(M.sheet).map(b => text(b)));
  // Undo this line-up session: asked once, then the whole session.
  await click(button(M.sheet, "Undo this line-up session (experimental)"));
  check("undo: asked first, saying what it does", t().includes("Put every plan this session saved back where it was? A backup is taken first; a plan you moved by hand since is left as it is.")
    && !M.sent("plan_build_undo").length, t());
  await click(button(M.sheet, "Undo it (experimental)"));
  check("undo: the session taken back, said", M.sent("plan_build_undo")[0]?.session === "pb_1" && t().includes("Undone: it is back where it was. Accept saves it again.")
    && M.hints.some(([h]) => h === "Line up plans (experimental): 2 plans put back where they were."), t());
  check("undo: an undone item can be saved again", !!button(M.sheet, "Accept: 2 things drawn on this plan would move") && !button(M.sheet, "Undo this line-up session (experimental)"), buttons(M.sheet).map(b => text(b)));
  // A refile by hand, refused for a plan with things drawn on it.
  await click(button(M.sheet, "Scan isn't Basement? (experimental)"));
  await click(button(M.sheet, "Main"));
  const rf = M.sent("plan_build_refile")[0];
  check("refile by hand: the plan and the floor, to the server", rf && rf.map_id === "m2" && rf.to_floor_id === "main", JSON.stringify(rf));
  check("refile by hand: refused and said", t().includes("This plan shows another floor, but things are drawn on it.") && t().includes("You say it shows Main")
    && t().includes("are drawn on this plan; move it by hand in Mapping → 3D Stack if you're sure."), t());
  const parts2 = all(M.sheet).filter(n => attr(n, "data-plan-build") !== undefined && attr(n, "data-plan-build") !== null);
  const quiet2 = parts2.filter(n => !/experimental/i.test(text(n)));
  check("experimental: still every part after saving and undoing", quiet2.length === 0, quiet2.map(n => text(n).slice(0, 80)));
  // The little help: Yes on the dimension.
  await click(button(M.sheet, "Yes"));
  check("answer: yes sent, no new read asked for", M.sent("plan_build_answer")[0]?.answer === "yes" && !M.sent("plan_build_start").length, JSON.stringify(M.sent("plan_build_answer")));
  await click(button(M.sheet, "Resume (experimental)"));
  check("resume: sent for the session", M.sent("plan_build_resume")[0]?.session === "pb_1", JSON.stringify(M.sent("plan_build_resume")));
  M.tool.dispose();
}
// ── how a session stopped: Resume where it can go on, never where it can't (review S1, S2) ──
for (const [name, over, words, resume] of [
  ["a restart mid-read", { status: "failed", error: "restart", questions: [], stops: [{ reason: "restart", at: 1, say: "Home Assistant restarted while this session was reading. What was read is kept.", next: "Resume reads the rest." }] },
   "Home Assistant restarted while this session was reading. What was read is kept. Resume reads the rest.", true],
  ["an old failed session with no stop recorded", { status: "failed", error: "restart", questions: [], stops: [] }, "Where it stopped (experimental):", true],
  ["a plan moved while read", { status: "cancelled", error: "plan_changed", questions: [], resumable: false,
    stops: [{ reason: "plan_changed", at: 1, say: "A plan was moved, changed or removed in Mapping while this session read it, so what was read no longer fits it.", next: "Line the floor up again." }] },
   "so what was read no longer fits it. Line the floor up again.", false],
]) {
  const M = mount({ ...BASE, plan_build_info: INFO(true), plan_build_status: { session: SESSION(over), running: null } });
  M.tool.show(true); await settle();
  await click(button(M.sheet, "Line up plans (experimental)"));
  check(`stopped, ${name}: said, Resume ${resume ? "offered" : "not offered"}`, text(M.sheet).includes(words) && !!button(M.sheet, "Resume (experimental)") === resume, text(M.sheet));
  M.tool.dispose();
}
// ── a refusal from the server while opening a session says experimental (review R4) ──
{
  const M = mount({ ...BASE, plan_build_info: INFO(true), plan_build_status: () => new Error("Live Aboard is off: turn it on in Settings.") });
  M.tool.show(true); await settle();
  await click(button(M.sheet, "Line up plans (experimental)"));
  check("status refused: said with experimental", text(M.sheet).includes("Line up plans (experimental): Live Aboard is off: turn it on in Settings."), text(M.sheet));
  M.tool.dispose();
}
// ── no tabs: one line on what turns them on, the way to Settings → AI (an administrator's tool) ──
for (const [name, info, words] of [
  ["Claude not unlocked", INFO(false), "need Claude Opus 5.5 or newer through Home Assistant's Anthropic integration, then Settings → AI → Build from plans"],
  ["the switch off", { ...INFO(true), switch: false, on: false }, "come with Settings → AI → Build from plans"],
]) {
  const go = GO();
  const M = mount({ ...BASE, plan_build_info: info }, { go });
  M.tool.show(true); await settle();
  const t = text(M.sheet);
  check(`no tabs, ${name}: the hint says what turns them on`, t.includes("Two more tabs, Line up plans and Rooms from plans, " + words) && !button(M.sheet, "Line up plans (experimental)"), t);
  await click(button(M.sheet, "Open Settings → AI"));
  check(`no tabs, ${name}: Open Settings → AI goes there, counted`, go.went.join() === "settings" && M.tel.includes("plans_tool_go:settings")
    && M.tel.includes(info.unlock.ok ? "plan_build_stop_ui:no_tabs_off" : "plan_build_stop_ui:no_tabs_locked"), JSON.stringify([go.went, M.tel]));
  M.tool.dispose();
}
{
  const M = mount({ ...BASE, plan_build_info: INFO(false) });         // a wall screen: the host hands no go
  M.tool.show(true); await settle();
  check("no tabs, wall screen: the words, no button that leaves", text(M.sheet).includes("Two more tabs") && !button(M.sheet, "Open Settings → AI"), text(M.sheet));
  M.tool.dispose();
}
{
  const M = mount({ ...BASE, plan_build_info: INFO(true) }, { go: GO() });
  M.tool.show(true); await settle();
  check("tabs on: no hint", !text(M.sheet).includes("Two more tabs") && !button(M.sheet, "Open Settings → AI"), text(M.sheet));
  M.tool.dispose();
}
// ── Line up on floors whose plans have no scale yet: the count and why, Measure; none measured: one message ──
{
  const info = INFO(true);
  info.floors.push({ id: "upper", name: "Upper", plans: [], last: null });
  info.unscaled = { upper: [{ map_id: "u1", name: "Upper scan" }, { map_id: "u2", name: "Loft" }] };
  const go = GO();
  const M = mount({ ...BASE, plan_build_info: info, plan_build_status: { session: SESSION(), running: null } }, { go });
  M.tool.show(true); await settle();
  await click(button(M.sheet, "Line up plans (experimental)"));
  await click(button(M.sheet, "Line up again (experimental)"));
  const t = () => text(M.sheet);
  const chip = button(M.sheet, "Upper · 2 plans, none with a scale yet");
  check("no scale: the floor listed with its real count and why, not selectable", !!chip && chip.disabled === true && !!button(M.sheet, "Basement · 2 plans"), buttons(M.sheet).map(b => text(b)));
  check("no scale: said in plain words", t().includes("Upper: its plans have no scale yet, so they can't be lined up."), t());
  await click(button(M.sheet, "Measure Upper scan in Mapping"));
  check("no scale: Measure opens that plan in Mapping, counted", go.went.join() === "measure:u1" && M.tel.includes("plans_tool_go:measure"), JSON.stringify([go.went, M.tel]));
  M.tool.dispose();
}
for (const [name, go, offered] of [["the helper offered", GO(true), true], ["the helper not offered", GO(false), false], ["a wall screen", null, false]]) {
  const info = { ...INFO(true), gauge: false, floors: [{ id: "main", name: "Main", plans: [], last: null }], unscaled: { main: [{ map_id: "p1", name: "Ground floor" }] } };
  const M = mount({ ...BASE, plan_build_info: info }, { go });
  M.tool.show(true); await settle();
  await click(button(M.sheet, "Line up plans (experimental)"));
  const t = text(M.sheet);
  check(`nothing measured, ${name}: one message, no dead floors`, t.includes("Line up needs one plan measured first: the other plans are lined up to it.") && !t.includes("Which floor") && !button(M.sheet, "Main · 0 plans"), t);
  check(`nothing measured, ${name}: Measure only where it can navigate`, go ? !!button(M.sheet, "Measure Ground floor in Mapping") : (!button(M.sheet, "Measure Ground floor in Mapping") && t.includes("From another screen: Mapping → Edit, open Ground floor, then")), t);
  check(`nothing measured, ${name}: the helper line only where its rule offers it`, t.includes("Or let Claude draw the rooms for you: it starts with one measurement.") === offered && !!button(M.sheet, "Try it →") === offered, t);
  if (offered) { await click(button(M.sheet, "Try it →")); check("nothing measured: Try it opens the helper, counted", go.went.join() === "helper" && M.tel.includes("plans_tool_go:helper"), JSON.stringify([go.went, M.tel])); }
  M.tool.dispose();
}
// ── the floor picker ─────────────────────────────────────────────────────────
{
  const info = INFO(true);
  info.floors[0].last = null;
  const M = mount({ ...BASE, plan_build_info: info, plan_build_start: { session: "pb_2" }, plan_build_status: { session: SESSION({ status: "running", progress: { plan: 1, of: 2, name: "Scan", step: "plan" } }) } });
  M.tool.show(true); await settle();
  await click(button(M.sheet, "Line up plans (experimental)"));
  const t = () => text(M.sheet);
  check("picker: a chip per floor with its plans", !!button(M.sheet, "Basement · 2 plans") && !!button(M.sheet, "Main · 1 plan"), buttons(M.sheet).map(b => text(b)));
  await click(button(M.sheet, "Main · 1 plan"));
  check("picker: the measured plan is said to be never moved", t().includes("Measured · the plan that set your house's scale (never moved)"), t());
  await click(button(M.sheet, "Basement · 2 plans"));
  check("picker: what is drawn on each plan", t().includes("Scan — rooms traced: 1, calibration points: 1") && t().includes("Shop plan — nothing drawn on it"), t());
  check("picker: which AI reads them and when anything is saved", t().includes("Claude Opus 5.5 reads them: the plans leave the house for Anthropic.")
    && t().includes("Nothing is saved until you accept a proposal: a backup is taken before each save, and one undo takes the whole session back."), t());
  check("picker: the tracker's own estimate for the ticked plans, no promise (review R5)",
    t().includes("Claude looks at each plan about 5 times; about $0.11–$0.22 for these 2 plans (estimate, experimental).") && !t().includes("under a dollar"), t());
  await click(button(M.sheet, "Line up Basement (experimental)"));
  const st = M.sent("plan_build_start")[0];
  check("start: the floor and its ticked plans", st && st.floor_id === "basement" && st.map_ids.sort().join() === "m1,m2", JSON.stringify(st));
  check("progress: what it reads, and Stop", t().includes("Reading Scan (1 of 2)… experimental.") && !!button(M.sheet, "Stop (experimental)"), t());
  M.tool.dispose();
}
console.log(JSON.stringify(results));
process.exit(0);
