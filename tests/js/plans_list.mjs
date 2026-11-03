// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
//
// Add data via plans, Stage 1a's list view (views/live_aboard_plans.js), RUN
// rather than read: what the sheet says before a plan is sent (which AI reads
// it, no tick and no gate), progress and cancel,
// and the list: Failure with a reason chip written at click, Later, take that
// back, Looks right, a stair's railing hint going with it, New and Correction
// greyed, no accept-all, Manage ignored, how a session that was cut short or
// read nothing says so. The pytest wrapper is tests/test_plan_ai.py.
//
// Run:  node tests/js/plans_list.mjs <repo-root>
import { pathToFileURL } from "node:url";
const ROOT = process.argv[2];
const { install } = await import(pathToFileURL(ROOT + "/tests/js/dom_shim.mjs").href);
install(globalThis);
globalThis.Image = class { constructor() { this.complete = false; this.naturalWidth = 0; } addEventListener() {} set src(v) { this._src = v; } get src() { return this._src; } };
const { createPlans } = await import(pathToFileURL(ROOT + "/custom_components/padspan_ha/www/padspan-ha/views/live_aboard_plans.js").href);

const settle = async () => { for (let i = 0; i < 8; i++) await new Promise(r => setImmediate(r)); };
const results = {};
const check = (name, ok, detail) => { results[name] = { ok: !!ok, detail: ok ? undefined : detail }; };

const all = (n, out = []) => { for (const c of (n.childNodes || n.children || [])) { out.push(c); all(c, out); } return out; };
const text = (n) => (n.textContent || "").replace(/\s+/g, " ").trim();
const tag = (n) => (n.tagName || n.localName || "").toUpperCase();
const buttons = (sheet) => all(sheet).filter(n => tag(n) === "BUTTON");
const button = (sheet, label) => buttons(sheet).find(b => text(b) === label) || null;
const click = async (b) => { b.dispatchEvent(new Event("click", { bubbles: true })); await settle(); };
const tick = async (sheet, words) => {
  const lab = all(sheet).find(n => tag(n) === "LABEL" && text(n).includes(words));
  const cb = all(lab).find(n => tag(n) === "INPUT");
  cb.checked = !cb.checked;
  cb.dispatchEvent(new Event("change", { bubbles: true }));
  await settle();
};

const PLANS = [{ map_id: "m1", name: "Main floor", floor_id: "main", refs: 2 }, { map_id: "m2", name: "Electrical", floor_id: "main", refs: 0 },
  { map_id: "m3", name: "Deck", floor_id: "__outside__", refs: 1 }];
// As on a real house: the floor's id is "outside", the plan's "__outside__" (only floorCanon maps one to the other).
const FLOORS = [{ fl: { id: "main", name: "Main" } }, { fl: { id: "outside", name: "Outside", outdoor: true } }];
const LOCAL = { ready: true, name: "Mac vision", local: true };
const stair = (id, extra = {}) => ({ id, kind: "stairs", map_id: "m1", floor_id: "main", state: "queued", verdict: null, box_px: [10, 10, 40, 60], frame: [1036, 812],
  seen_on: [{ map_id: "m1" }], geom: { x_m: 1, y_m: 2, width_m: 1.1, depth_m: 3.2 }, match: { relation: "new", near: [], near_names: [], held: null }, ...extra });
const SESSION = (over = {}) => ({ id: "ps_1", rev: 3, status: "done", error: null, spent_s: 250, budget_s: 480, reads: 9, skipped: 0, frame: "probed",
  plans: [{ map_id: "m1", name: "Main floor", read: true, answered: true }, { map_id: "m2", name: "Electrical", read: true, answered: true }], suggestions: {
    a: stair("a"),
    b: stair("b", { match: { relation: "correction", distance_m: 1.4, hand: true, target: "p", target_snap: { label: "Stairs" }, near: [], held: null } }),
    c: stair("c", { match: { relation: "stacked", target: "p", near: [], held: null } }),
    d: stair("d", { state: "duplicate", match: { relation: "duplicate", near: [], held: null } }),
    e: stair("e", { state: "failure", verdict: { v: "failure", why: "nothing_there", remembered: true, reject: "rk1" } }),
    r: { ...stair("r"), kind: "railing", geom: { stair: "a", side: null, x_m: 1, y_m: 2 } },
  }, ...over });

/** A sheet over a fake server: `answers[type]` is a value or a function of the message. */
function mount(answers) {
  const sheet = document.createElement("div"), root = document.createElement("div");
  sheet.scrollTop = 0;
  const calls = [];
  const hints = [];
  const callWS = async (m) => {
    calls.push(m);
    const a = answers[m.type.replace("padspan_ha/", "")];
    const v = typeof a === "function" ? a(m) : a;
    if (v instanceof Error) throw v;
    return v;
  };
  let tool;
  const redraw = () => { sheet.replaceChildren(); tool.sheet(); };
  tool = createPlans({ root, sheet, guard: (f) => f, host: () => ({ callWS }), floors: () => FLOORS, hint: (t, bad) => hints.push([t, bad]), redraw });
  return { sheet, tool, calls, hints, sent: (type) => calls.filter(c => c.type === `padspan_ha/${type}`) };
}
const BASE = { maps_image_urls: { image_urls: { m1: "/signed/m1", m2: "/signed/m2" } } };

// ── consent: a local AI ──────────────────────────────────────────────────────
{
  const M = mount({ ...BASE, plan_ai_plans: { plans: PLANS, ai: { ...LOCAL, backup: "ai_task.cloud", backup_name: "Cloud", backup_local: false }, running: null, latest: null, start_blocked: null },
    plan_ai_start: { session: "ps_1" }, plan_ai_status: { session: SESSION({ status: "running", suggestions: {}, progress: { plan: 1, of: 2, name: "Main floor", step: "stairs" } }) },
    plan_ai_cancel: { ok: true, message: "Stopping after the read in flight." } });
  M.tool.show(true); await settle();
  const t = () => text(M.sheet);
  check("consent: the banner and the chip", t().includes("EXPERIMENTAL") && t().includes("2 in 10 stair suggestions are wrong") && t().includes("Doors and windows aren't offered"), t());
  check("consent: the plans, outdoor left out, placed by eye said", t().includes("Main floor") && t().includes("Electrical (placed by eye)") && !t().includes("Deck"), t());
  check("consent: two plans on a floor said", t().includes("2 plans cover Main"), t());
  check("consent: thumbnails from the signed link", all(M.sheet).filter(n => tag(n) === "IMG").length === 2, "no thumbs");
  check("consent: what to expect", t().includes("For your 2 plans: roughly 3-8 items, 2-6 minutes to vet."), t());
  check("consent: lights say later, doors not offered as a kind", t().includes("Lights — comes in a later beta"), t());
  check("note: one line names the AI and the backup, in the photo step's words", t().includes("Mac vision will read the plans. It runs in your home, so the plans stay in the house. If it's away, the backup, Cloud, reads them instead. That one runs in the cloud: the plans leave the house for that service. PadSpan keeps no copy."), t());
  check("note: reads can hold a shared AI box, the backup named", t().includes("Reading can keep this AI or the backup busy for up to 8 minutes: if either also answers your voice assistant, voice may be slow until it ends."), t());
  check("no gate: no tick about the cloud or the backup, no address advice, the button as ever", !t().includes("I understand") && !t().includes("let the backup") && !t().includes("address") && !!button(M.sheet, "Read 2 plans") && !button(M.sheet, "Send 2 plans to the cloud"), t());
  await tick(M.sheet, "Electrical");
  await click(button(M.sheet, "Read 1 plan"));
  const st = M.sent("plan_ai_start")[0];
  check("start: only the ticked, no consent words", st && st.map_ids.join() === "m1" && !("backup_ok" in st) && !("cloud_ok" in st) && st.kinds.join() === "stairs,railing", JSON.stringify(st));
  check("progress: says what it reads and that the page can close", t().includes("Reading Main floor for stairs (1 of 2)") && t().includes("this page can close and come back"), t());
  await click(button(M.sheet, "Cancel"));
  check("progress: cancel goes to the server and says the read runs on", M.sent("plan_ai_cancel")[0]?.session === "ps_1" && t().includes("Stopping after the read in flight."), t());
  M.tool.dispose();
}
// ── consent: a cloud AI, the main away, nothing placed, no AI ────────────────
{
  const M = mount({ ...BASE, plan_ai_plans: { plans: PLANS, ai: { ready: true, name: "OpenAI", local: false }, running: null, latest: null, start_blocked: null } });
  M.tool.show(true); await settle();
  check("cloud: says it leaves, no tick, the button as ever", text(M.sheet).includes("OpenAI will read the plans. It runs in the cloud: the plans leave the house for that service.") && !text(M.sheet).includes("I understand") && !text(M.sheet).includes("address") && button(M.sheet, "Read 2 plans").disabled === false, text(M.sheet));
  check("cloud: no shared-box note on a cloud AI", !text(M.sheet).includes("voice assistant"), text(M.sheet));
  await click(button(M.sheet, "Read 2 plans"));
  check("cloud: it goes", M.sent("plan_ai_start").length === 1 && !text(M.sheet).includes("Tick"), text(M.sheet));
  M.tool.dispose();
  const U = mount({ ...BASE, plan_ai_plans: { plans: PLANS, ai: { ready: true, name: "Mystery", local: null }, running: null, latest: null, start_blocked: null } });
  U.tool.show(true); await settle();
  check("unknown: hedged, no tick", text(U.sheet).includes("If it runs in the cloud, the plans leave the house") && !text(U.sheet).includes("I understand") && text(U.sheet).includes("voice assistant"), text(U.sheet));
  U.tool.dispose();
  const One = mount({ ...BASE, plan_ai_plans: { plans: PLANS.slice(0, 1), ai: LOCAL, running: null, latest: null, start_blocked: null } });
  One.tool.show(true); await settle();
  check("one plan: said in the singular", text(One.sheet).includes("Mac vision will read the plan. It runs in your home, so the plan stays in the house."), text(One.sheet));
  One.tool.dispose();
  const NB = mount({ ...BASE, plan_ai_plans: { plans: PLANS, ai: { ...LOCAL, main_away: true }, running: null, latest: null, start_blocked: null } });
  NB.tool.show(true); await settle();
  check("away, no backup: said, and no go", text(NB.sheet).includes("Mac vision is away right now") && button(NB.sheet, "Read 2 plans").disabled === true, text(NB.sheet));
  NB.tool.dispose();
  const A = mount({ ...BASE, plan_ai_plans: { plans: PLANS, ai: { ...LOCAL, backup: "ai_task.b", backup_name: "Spare", backup_local: true, main_away: true }, running: null, latest: null } });
  A.tool.show(true); await settle();
  check("away, with a backup: it goes, the backup named", button(A.sheet, "Read 2 plans").disabled === false && text(A.sheet).includes("so the backup, Spare, will read"), text(A.sheet));
  A.tool.dispose();
  const N = mount({ ...BASE, plan_ai_plans: { plans: [], ai: LOCAL, running: null, latest: null } });
  N.tool.show(true); await settle();
  check("no plans: where to place one", text(N.sheet).includes("place it in Mapping → 3D Stack first"), text(N.sheet));
  N.tool.dispose();
  const S = mount({ plan_ai_plans: {} });
  S.tool.show(true); await settle();
  check("sample mode: an empty answer says so", text(S.sheet).includes("Sample mode shows a sample house"), text(S.sheet));
  S.tool.dispose();
}
// ── the list ─────────────────────────────────────────────────────────────────
{
  let sess = SESSION();
  const M = mount({ ...BASE, plan_ai_plans: { plans: PLANS, ai: LOCAL, running: null, latest: "ps_1", start_blocked: "too_soon" },
    plan_ai_status: () => ({ session: sess }), plan_ai_verdict: (m) => {
      const old = sess.suggestions[m.sug_id];
      const s = m.v === "back" ? { ...old, state: "queued", verdict: null } : { ...old, state: m.v, verdict: { v: m.v, why: m.why || null } };
      const hint = sess.suggestions.r;
      const changed = m.sug_id === "a" && m.v === "failure" ? [{ ...hint, state: "settled", verdict: { v: "settled", stair: "a" } }] : m.sug_id === "a" && m.v === "back" ? [{ ...hint, state: "queued", verdict: null }] : [];
      return { rev: m.rev + 1, suggestion: s, changed };
    },
    plan_ai_rejects_get: { rejects: [{ key: "rk1", kind: "stairs", plan: "Main floor", floor_id: "main", x_m: 8.5, y_m: 6.5, why: "nothing_there" }] },
    plan_ai_reject_forget: { ok: true } });
  M.tool.show(true); await settle();
  const t = () => text(M.sheet);
  check("list: the summary", t().includes("in 4 m 10 s") && t().includes("Vet them one by one."), t());
  const news = buttons(M.sheet).filter(b => text(b) === "New"), corr = buttons(M.sheet).filter(b => text(b) === "Correction");
  check("list: New and Correction greyed, saying the next beta", news.length === 4 && news.every(b => b.disabled && b.title.includes("next beta")) && corr.length === 1 && corr[0].disabled, `${news.length}/${corr.length}`);
  check("list: no accept-all of any kind", !buttons(M.sheet).some(b => /all|keep \d|accept/i.test(text(b))), buttons(M.sheet).map(text).join("|"));
  check("list: Looks right beside Failure and Later, on every queued item", buttons(M.sheet).filter(b => text(b) === "Looks right").length === 4 && buttons(M.sheet).filter(b => text(b) === "Failure").length === 4, buttons(M.sheet).map(text).join("|"));
  check("list: a 0-1000 frame isn't said on the list any more", !t().includes("0-1000"), t());
  check("list: a correction on a hand-placed stair says keep yours", t().includes("You placed this one. The AI puts it 1.4 m away. Keep yours unless the plan says otherwise."), t());
  check("list: stacked asked", t().includes("a second staircase here, stacked?"), t());
  check("list: a railing with no side asks which", t().includes("a rail on one side: which?") && t().includes("The AI can't tell the side for sure"), t());
  check("list: duplicates and ignored apart", t().includes("Already in your house (1)") && t().includes("Ignored before (1)") && !!button(M.sheet, "Un-ignore"), t());
  M.sheet.scrollTop = 120;
  await click(buttons(M.sheet).filter(b => text(b) === "Looks right")[0]);
  const lr = M.sent("plan_ai_verdict")[0];
  check("right: written at click, listed apart, says nothing is written", lr && lr.v === "right" && !lr.why && lr.rev === 3 && t().includes("Looks right (1)") && M.hints.some(h => /Nothing is written to your house/.test(h[0])), JSON.stringify(lr) + t());
  await click(button(M.sheet, "Take that back"));
  check("right: taken back, in the queue again", M.sent("plan_ai_verdict")[1]?.v === "back" && !t().includes("Looks right (1)"), t());
  await click(buttons(M.sheet).filter(b => text(b) === "Failure")[0]);
  const chips = ["Wrong place", "Nothing there", "Already here", "Wrong kind", "Can't tell"];
  check("failure: the five chips, nothing sent yet", chips.every(c => !!button(M.sheet, c)) && M.sent("plan_ai_verdict").length === 2, t());
  await click(button(M.sheet, "Wrong place"));
  const v = M.sent("plan_ai_verdict")[2];
  check("failure: written at click with the reason and the rev", v && v.v === "failure" && v.why === "wrong_place" && v.rev === 5 && v.session === "ps_1", JSON.stringify(v));
  check("failure: the stair's railing hint leaves the queue, listed apart", t().includes("Gone with its stair (1)") && t().includes("To check (2)") && M.hints.some(h => /railing hint goes with it/.test(h[0])), t());
  check("failure: listed apart, can be taken back, the next rev used", t().includes("Marked wrong (1)") && !!button(M.sheet, "Take that back"), t());
  check("failure: the list stayed where it was", M.sheet.scrollTop === 120, String(M.sheet.scrollTop));
  await click(buttons(M.sheet).filter(b => text(b) === "Later")[0]);
  const w = M.sent("plan_ai_verdict")[3];
  check("later: written at click, the rev moved on", w && w.v === "later" && w.rev === 6 && t().includes("Later (1)"), JSON.stringify(w));
  await click(buttons(M.sheet).filter(b => text(b) === "Take that back").at(-1));
  const back = M.sent("plan_ai_verdict")[4];
  check("back: a server call, and the hint comes back with its stair", back?.v === "back" && !t().includes("Gone with its stair") && t().includes("Later (1)"), JSON.stringify(back) + t());
  await click(button(M.sheet, "Manage ignored"));
  check("ignored: listed with its plan and reason", text(M.sheet).includes("Stairs · Main floor · Main") && text(M.sheet).includes("Marked wrong: Nothing there"), text(M.sheet));
  await click(button(M.sheet, "Forget"));
  check("ignored: forgotten on the server", M.sent("plan_ai_reject_forget")[0]?.key === "rk1", "");
  await click(button(M.sheet, "Back"));
  await click(button(M.sheet, "Read again"));
  check("read again: asks the server again", M.sent("plan_ai_plans").length === 2 && !!button(M.sheet, "Back to the last list"), t());
  M.tool.dispose();
}
// ── stale, cut short, a rev that moved ───────────────────────────────────────
{
  const moved = stair("m", { state: "stale", map_id: "m2" });
  const tgt = stair("t", { state: "stale", match: { relation: "correction", distance_m: 1.2, target: "p", target_snap: { label: "Hall stairs" }, near: [], held: null } });
  const S = SESSION({ status: "cancelled", error: "plan_changed", skipped: 1, crop_dropped: 2, no_floor: 1, frame: "named", plans: [{ map_id: "m1", name: "Main floor", read: true, answered: true }, { map_id: "m2", name: "Electrical", changed: true }], suggestions: { m: moved, t: tgt } });
  const err = Object.assign(new Error("changed"), { code: "rev_mismatch" });
  const M = mount({ ...BASE, plan_ai_plans: { plans: PLANS, ai: LOCAL, running: null, latest: "ps_1" }, plan_ai_status: { session: S }, plan_ai_verdict: err });
  M.tool.show(true); await settle();
  const t = text(M.sheet);
  check("cut short: why it stopped, what was left out", t.includes("stopped: a plan was moved or replaced") && t.includes("1 plan skipped (out of time)") && t.includes("2 left out: a closer look") && t.includes("1 left out: no floor below"), t);
  check("named frame: positions may be coarse", t.includes("This AI's picture size isn't known"), t);
  check("stale: the plan moved, read it again", t.includes("the plan moved: read it again") && t.includes("changed since you looked"), t);
  check("stale: New and Failure only", !button(M.sheet, "Correction") && !button(M.sheet, "Later") && !button(M.sheet, "Looks right") && !!button(M.sheet, "Failure"), buttons(M.sheet).map(text).join("|"));
  await click(buttons(M.sheet).filter(b => text(b) === "Failure")[0]);
  await click(button(M.sheet, "Can't tell"));
  check("a rev that moved: says so and reloads", M.hints.some(h => /had changed/.test(h[0])) && M.sent("plan_ai_status").length === 2, JSON.stringify(M.hints));
  M.tool.dispose();
  const R = mount({ ...BASE, plan_ai_plans: { plans: PLANS, ai: LOCAL, running: null, latest: "ps_1" }, plan_ai_status: { session: SESSION({ status: "failed", error: "restart", suggestions: {} }) } });
  R.tool.show(true); await settle();
  check("restart: the sheet says run it again", text(R.sheet).includes("Home Assistant restarted during the read; run it again.") && !!button(R.sheet, "Read again"), text(R.sheet));
  R.tool.dispose();
  const D = mount({ ...BASE, plan_ai_plans: { plans: PLANS, ai: LOCAL, running: null, latest: "ps_1" }, plan_ai_status: { session: SESSION({ suggestions: {} }) } });
  D.tool.show(true); await settle();
  check("nothing left to vet: back at the plans", !!button(D.sheet, "Read 2 plans"), text(D.sheet));
  D.tool.dispose();
}
// ── a session that read nothing, and one that read some ──────────────────────
{
  const unread = [{ map_id: "m1", name: "Main floor", read: true, answered: false }, { map_id: "m2", name: "Electrical", read: true, answered: false }];
  for (const [error, words] of [["unreachable", "the AI couldn't be reached"], ["timeout", "the AI didn't answer in time"], ["no_media", "media folder couldn't take the plans"],
    ["no_picture", "pictures wouldn't open"], ["bad_answer", "no answer that could be used"]]) {
    const M = mount({ ...BASE, plan_ai_plans: { plans: PLANS, ai: LOCAL, running: null, latest: "ps_1" }, plan_ai_status: { session: SESSION({ status: "failed", error, errors: { [error]: 2 }, plans: unread, suggestions: {} }) } });
    M.tool.show(true); await settle();
    const t = text(M.sheet);
    check(`nothing read, ${error}: says what happened, never that the AI found nothing`, t.includes(`Nothing was read: `) && t.includes(words) && !t.includes("The AI found nothing") && !t.includes("Found 0") && !t.includes("The read failed") && !!button(M.sheet, "Read again"), t);
    M.tool.dispose();
  }
  const P = mount({ ...BASE, plan_ai_plans: { plans: PLANS, ai: LOCAL, running: null, latest: "ps_1" }, plan_ai_status: { session: SESSION({ errors: { unreachable: 1 }, suggestions: { a: stair("a") },
    plans: [{ map_id: "m1", name: "Main floor", read: true, answered: true }, { map_id: "m2", name: "Electrical", read: true, answered: false }] }) } });
  P.tool.show(true); await settle();
  check("some read: found on the one, the other said", text(P.sheet).includes("Found 1 stair, 0 railing hints on 1 plan") && text(P.sheet).includes("1 plan couldn't be read.") && text(P.sheet).includes("1 read failed: the AI couldn't be reached"), text(P.sheet));
  P.tool.dispose();
  const O = mount({ ...BASE, plan_ai_plans: { plans: PLANS, ai: LOCAL, running: null, latest: "ps_1" }, plan_ai_status: { session: SESSION({ status: "out_of_time", errors: { timeout: 2 }, suggestions: { a: stair("a") } }) } });
  O.tool.show(true); await settle();
  check("two timeouts after a plan read: not said to be out of time", text(O.sheet).includes("It stopped after two reads in a row got no answer.") && !text(O.sheet).includes("ran out of time"), text(O.sheet));
  O.tool.dispose();
  const C = mount({ ...BASE, plan_ai_plans: { plans: PLANS, ai: LOCAL, running: null, latest: "ps_1" }, plan_ai_status: { session: SESSION({ status: "out_of_time", cut_short: "crop", errors: {}, suggestions: { a: stair("a") } }) } });
  C.tool.show(true); await settle();
  check("the budget cut short: out of time", text(C.sheet).includes("The session ran out of time."), text(C.sheet));
  C.tool.dispose();
  const X = mount({ ...BASE, plan_ai_plans: { plans: PLANS, ai: LOCAL, running: null, latest: "ps_1" }, plan_ai_status: { session: SESSION({ status: "cancelled", error: "user", suggestions: {}, plans: [{ map_id: "m1", name: "Main floor" }, { map_id: "m2", name: "Electrical" }] }) } });
  X.tool.show(true); await settle();
  check("cancelled with nothing: never that the AI found nothing", !text(X.sheet).includes("The AI found nothing") && text(X.sheet).includes("The session was cancelled."), text(X.sheet));
  X.tool.dispose();
}
console.log(JSON.stringify(results));
process.exit(0);
