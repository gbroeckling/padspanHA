// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
//
// Line up plans (Build from plans, experimental): the Plans tool's second tab
// in views/live_aboard_plans.js, RUN: the tab shows only when the server says
// the line-up is on, the floor picker and its plans, a session's proposals with
// their overlays, what each would shift, stops in words with Resume, the two
// kinds of question, verdicts written at the click, Accept and Save refused by
// the server and said, and every part of the tab saying experimental. A
// synthetic session; no house's data. The pytest wrapper is tests/test_plan_build.py.
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
    corners_now_m: CORNERS(1, 0, 9, 7), corners_new_m: CORNERS(0, 0, 10, 8), evidence: { anchor: "m1", anchor_name: "Shop plan", corr: 0.91, seed: "stairs", tilt_deg: -0.4 },
    flags: [{ what: "calibration", id: "cp_1", stored_m: [3, 3], click_m: [3.4, 3.2], moved_m: 0.45, room_now: "Den", room_click: "Shop" },
            { what: "room_trace", id: "Den", label: "Den", moved_m: 0.6 }], others: { n: 2, names: ["Lamp", "Fan"] } },
  refile_m3: { kind: "refile", map_id: "m3", name: "Upstairs", state: "open", verdict: null, proposal: { to_floor_id: "upper", why: { title: null, rooms: ["OFFICE", "STUDIO"] } },
    to_name: "Upper", drawn: { rooms: 0, calibration: 0, receivers: 0, beacons: 0, lights: 0 }, flags: [], others: { n: 0, names: [] } },
  anchor_m1: { kind: "anchor_scale", map_id: "m1", name: "Shop plan", state: "info", verdict: null, max_move_m: 0.12, scale_change: 0.02,
    corners_now_m: CORNERS(0, 0, 10, 8), corners_new_m: CORNERS(0, 0, 10.2, 8), evidence: { seed: "dims", scale_err: [-0.02, 0.001] }, flags: [], others: { n: 0, names: [] } },
};
const SESSION = (over = {}) => ({ id: "pb_1", rev: 4, stage: "s1", floor_id: "basement", status: "out_of_time", error: null, reads: 7, reused: 0, est_usd: 0.08, spent_s: 64, budget_s: 600,
  plans: [{ map_id: "m1", name: "Shop plan", size_px: [1000, 800], corners_m: CORNERS(0, 0, 10, 8), role: "anchor" },
          { map_id: "m2", name: "Scan", size_px: [900, 750], corners_m: CORNERS(1, 0, 9, 7), role: "plan" },
          { map_id: "m3", name: "Upstairs", size_px: [640, 480], corners_m: CORNERS(0, 0, 6, 4), role: "other_floor" }],
  questions: [{ id: "q1", kind: "confirm_dimension", map_id: "m2", name: "Scan", state: "open", axis: "x", box: [40, 630, 770, 665], ticks_px: [[42, 654], [769, 649]], ai: { text: "3 m + 2.5 m + 2.5 m", metres: 8 } },
              { id: "q2", kind: "tap_corners", map_id: "m2", other_map_id: "m1", name: "Scan", other_name: "Shop plan", state: "open" }],
  items: JSON.parse(JSON.stringify(ITEMS)),
  stops: [{ reason: "out_of_time", at: 1, say: "The session ran out of time. What was read is kept.", next: "Resume reads the rest." },
          { reason: "help_unanswered", at: 2, say: "A question is waiting for you.", next: "Answer it, or Skip." }],
  cross_floor: { floor_id: "main", stairs_m: 0.34 }, ...over });
const INFO = (on = true) => ({ unlock: { ok: on, why: on ? "ok" : "below_opus_5_5", display: "Claude Opus 5.5" }, master: true, switch: on, on, running: null, start_blocked: null,
  floors: [{ id: "basement", name: "Basement", plans: [{ map_id: "m1", name: "Shop plan", drawn: { rooms: 0, calibration: 0 }, gauge: false }, { map_id: "m2", name: "Scan", drawn: { rooms: 1, calibration: 1 } }],
             last: { session: "pb_1", at: 5, status: "needs_help" } }, { id: "main", name: "Main", plans: [{ map_id: "g1", name: "Measured", gauge: true, drawn: {} }], last: null }],
  stall: { month: {}, words: {} } });

function mount(answers){
  const sheet = document.createElement("div"), root = document.createElement("div");
  const calls = [], hints = [];
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
  tool = createPlans({ root, sheet, guard: (f) => f, host: () => ({ callWS }), floors: () => [{ fl: { id: "basement", name: "Basement" } }], hint: (t, bad) => hints.push([t, bad]), redraw,
    DRAFT, draft: () => draft, change: (fn) => draft.change(fn), saving: () => false, save: () => {}, stairPiece: () => null, fileWritten: () => {} });
  return { sheet, tool, calls, hints, sent: (type) => calls.filter(c => c.type === `padspan_ha/${type}`) };
}
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
    plan_build_commit: Object.assign(new Error("Line up plans (experimental): saving line-ups isn't built yet. Nothing was changed; your verdicts are kept."), { code: "not_yet" }),
    plan_build_answer: (m) => { sess = { ...sess, questions: sess.questions.map(q => (q.id === m.question_id ? { ...q, state: "answered", answer: m.answer } : q)) }; return { session: sess }; },
    plan_build_resume: { session: "pb_1" } });
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
  check("card: the placement, its numbers and its anchor", t().includes("Placement · Scan") && t().includes("Moves up to 1.4 m; scale changes 8.0 %.") && t().includes("Fits Shop plan at 0.91 (from the stairs)"), t());
  check("card: what it would shift, never moved", t().includes("A calibration click lands 0.5 m from where it is stored, in Shop. This tool never moves calibration points.")
    && t().includes("Den was traced on this plan; its outline in the house stays where it is.") && t().includes("2 other devices on this floor lie under this plan"), t());
  check("card: the accept names its effects", !!button(M.sheet, "Accept: 2 things drawn here would sit elsewhere"), t());
  check("card: the refile, its evidence", t().includes("Refile · Upstairs") && t().includes("It shows Upper: OFFICE, STUDIO. Then line it up on Upper."), t());
  check("card: the anchor's own error is information", t().includes("The anchor's own scale · Shop plan") && t().includes("Under 3 %: information only."), t());
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
  // Save goes to the server, which refuses until the writes are built: said, nothing else.
  const save = button(M.sheet, "Save line-up for Basement (experimental): 1 plan, 1 refile");
  check("save: names the floor and what it holds", !!save, buttons(M.sheet).map(b => text(b)));
  await click(save);
  check("save: refused by the server and said", M.sent("plan_build_commit")[0]?.items.sort().join() === "place_m2,refile_m3" && t().includes("saving line-ups isn't built yet. Nothing was changed"), t());
  // The little help: Yes on the dimension.
  await click(button(M.sheet, "Yes"));
  check("answer: yes sent, no new read asked for", M.sent("plan_build_answer")[0]?.answer === "yes" && !M.sent("plan_build_start").length, JSON.stringify(M.sent("plan_build_answer")));
  await click(button(M.sheet, "Resume (experimental)"));
  check("resume: sent for the session", M.sent("plan_build_resume")[0]?.session === "pb_1", JSON.stringify(M.sent("plan_build_resume")));
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
  check("picker: the measured plan is said to be never moved", t().includes("Measured · your measured plan (never moved)"), t());
  await click(button(M.sheet, "Basement · 2 plans"));
  check("picker: what is drawn on each plan", t().includes("Scan — rooms traced: 1, calibration points: 1") && t().includes("Shop plan — nothing drawn on it"), t());
  check("picker: which AI reads them and that nothing is saved", t().includes("Claude Opus 5.5 reads them: the plans leave the house for Anthropic.") && t().includes("this version proposes only"), t());
  await click(button(M.sheet, "Line up Basement (experimental)"));
  const st = M.sent("plan_build_start")[0];
  check("start: the floor and its ticked plans", st && st.floor_id === "basement" && st.map_ids.sort().join() === "m1,m2", JSON.stringify(st));
  check("progress: what it reads, and Stop", t().includes("Reading Scan (1 of 2)… experimental.") && !!button(M.sheet, "Stop (experimental)"), t());
  M.tool.dispose();
}
console.log(JSON.stringify(results));
process.exit(0);
