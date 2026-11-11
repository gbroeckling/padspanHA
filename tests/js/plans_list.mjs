// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
//
// Add data via plans, the list view (views/live_aboard_plans.js), RUN rather
// than read: what the sheet says before a plan is sent (which AI reads it, no
// tick and no gate), progress and cancel, and the list: Failure with a reason
// chip written at click, Later, take that back, Looks right, a stair's railing
// hint going with it, no accept-all, Manage ignored, how a session that was cut
// short or read nothing says so. New and Correction in the real draft: one Undo
// step each, nothing sent until Save, Keep mine where a hand-placed stair starts,
// the floor of a stacked stair, a railing's side and style, a commit and its
// refusals, Undo this session. The pytest wrapper is tests/test_plan_ai.py.
//
// Run:  node tests/js/plans_list.mjs <repo-root>
import { pathToFileURL } from "node:url";
const ROOT = process.argv[2];
const { install } = await import(pathToFileURL(ROOT + "/tests/js/dom_shim.mjs").href);
install(globalThis);
globalThis.Image = class { constructor() { this.complete = false; this.naturalWidth = 0; } addEventListener() {} set src(v) { this._src = v; } get src() { return this._src; } };
const { createPlans } = await import(pathToFileURL(ROOT + "/custom_components/padspan_ha/www/padspan-ha/views/live_aboard_plans.js").href);
const DRAFT = await import(pathToFileURL(ROOT + "/custom_components/padspan_ha/www/padspan-ha/views/live_aboard_draft.js").href);

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

const stairPiece = (id, over = {}) => ({ id, floor_id: "main", x_m: 3, y_m: 4, z_m: 0, rotation: 0, label: "Hall stairs", origin: "build", recipe: { kind: "stairs", params: { shape: "straight", rail: "none" }, width_m: 1, depth_m: 3, height_m: 2.8 }, ...over });
/** A sheet over a fake server: `answers[type]` is a value or a function of the message. */
function mount(answers, file = null) {
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
  let tool, n = 0;
  const redraw = () => { sheet.replaceChildren(); tool.sheet(); };
  const draft = DRAFT.createDraft(DRAFT.ownedOf(file || { schema: 1, pieces: { fur_0000000f: stairPiece("fur_0000000f") } }));
  const written = [];
  tool = createPlans({ root, sheet, guard: (f) => f, host: () => ({ callWS }), floors: () => FLOORS, hint: (t, bad) => hints.push([t, bad]), redraw,
    DRAFT, draft: () => draft, change: (fn) => draft.change(fn), saving: () => false, save: () => { written.push("save"); },
    stairPiece: (g, fid, label) => stairPiece(`fur_0000000${++n}`, { floor_id: fid, x_m: g.x_m, y_m: g.y_m, label }), fileWritten: (d) => { written.push(d); draft.rebase(DRAFT.ownedOf(d)); } });
  return { sheet, tool, calls, hints, draft, written, sent: (type) => calls.filter(c => c.type === `padspan_ha/${type}`) };
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
  check("consent: lights are asked for, off, doors not offered as a kind", t().includes("Lights — only on a plan that draws light fixtures") && !t().includes("Does this plan draw"), t());
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
  check("no plans: measure one first", text(N.sheet).includes("then measure it in Mapping → Edit → 📏 Measure") && !text(N.sheet).includes("3D Stack"), text(N.sheet));
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
  const news = buttons(M.sheet).filter(b => text(b) === "New");
  check("list: New live on each stair, Take the AI's position and Keep mine on the correction", news.length === 3 && news.every(b => !b.disabled) && buttons(M.sheet).filter(b => text(b) === "Take the AI's position").length === 1 && !!button(M.sheet, "Keep mine"), `${news.length}`);
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
  check("stale: New where the AI's own geometry stands, and Failure; nothing else", !button(M.sheet, "Take the AI's position") && !button(M.sheet, "Keep mine") && !button(M.sheet, "Later") && !button(M.sheet, "Looks right") && !!button(M.sheet, "Failure") && buttons(M.sheet).filter(b => text(b) === "New").length === 1, buttons(M.sheet).map(text).join("|"));
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
// ── New and Correction: the real draft ───────────────────────────────────────
const SUGS = () => ({
  a: stair("a", { geom: { x_m: 1, y_m: 2, width_m: 1.1, depth_m: 3.2, shape: "straight", rotation: 0 } }),
  b: stair("b", { geom: { x_m: 4.4, y_m: 4, width_m: 1.1, depth_m: 3.2 }, match: { relation: "correction", distance_m: 1.4, hand: true, target: "fur_0000000f", target_snap: { label: "Hall stairs" }, near: [], held: null } }),
  c: stair("c", { geom: { x_m: 3, y_m: 4.2, width_m: 1, depth_m: 3 }, match: { relation: "stacked", target: "fur_0000000f", near: [], held: null } }),
  r: { ...stair("r", { of_stair: "a" }), kind: "railing", geom: { stair: "a", side: null, x_m: 1, y_m: 2 } },
  r2: { ...stair("r2", { of_stair: "b" }), kind: "railing", geom: { stair: "fur_0000000f", side: "left", x_m: 3, y_m: 4 }, match: { relation: "new", target: "fur_0000000f", near: [], held: null, target_snap: {} } },
});
const FLOORS3 = [{ fl: { id: "basement", name: "Basement", elev: 0 } }, { fl: { id: "main", name: "Main", elev: 2.8 } }, { fl: { id: "upper", name: "Upper", elev: 5.6 } }];
let focused = null;
const proto = Object.getPrototypeOf(document.createElement("button"));
const realFocus = proto.focus;
proto.focus = function () { focused = text(this); };
{
  FLOORS.push(...FLOORS3.filter(f => f.fl.id !== "main"));
  FLOORS[0].fl.elev = 2.8;
  const sess = SESSION({ suggestions: SUGS() });
  const M = mount({ ...BASE, plan_ai_plans: { plans: PLANS, ai: LOCAL, running: null, latest: "ps_1" }, plan_ai_status: () => ({ session: sess, undo: null }),
    plan_ai_verdict: (m) => ({ rev: m.rev + 1, suggestion: { ...sess.suggestions[m.sug_id], state: m.v, verdict: { v: m.v, why: m.why || null } }, changed: [] }) });
  M.tool.show(true); await settle();
  const t = () => text(M.sheet);
  const first = (label) => buttons(M.sheet).find(b => text(b) === label);
  check("keep mine: where the keyboard starts on a hand-placed stair", focused === "Keep mine", focused);
  const go = buttons(M.sheet).find(b => text(b) === "Take the AI's position");
  check("keep mine: the AI's position isn't the highlighted one on a hand-placed stair", !go.classList.contains("go"), go.className);
  // New goes to the draft and nowhere else.
  const before = M.calls.length;
  await click(first("New"));
  const held = DRAFT.planPending(M.draft.cur);
  check("new: in the draft, one piece, its label, no rail, no server call", held.length === 1 && held[0].sug_id === "a" && held[0].made && M.calls.length === before
    && M.draft.cur.pieces[held[0].piece].label === "Stairs (from the plan)" && M.draft.cur.pieces[held[0].piece].recipe.params.rail === "none" && M.draft.cur.pieces[held[0].piece].x_m === 1, JSON.stringify(held));
  check("new: says so, listed apart, a keep button with the count and no other bulk", t().includes("To keep, when you Save (1)") && t().includes("Keep 1 new (one undo for the whole session)") && t().includes("kept, until Save") && M.hints.some(h => /nothing is kept until Save/.test(h[0])), t());
  check("no accept-all: only what was kept is counted, one button", !buttons(M.sheet).some(b => /keep all|accept|dismiss/i.test(text(b))), buttons(M.sheet).map(text).join("|"));
  M.draft.undo(); M.tool.sheet(); M.sheet.replaceChildren(); M.tool.sheet();
  check("new: the editor's Undo clears it, and nothing is counted", DRAFT.planPending(M.draft.cur).length === 0 && t().includes("To check (5)") && M.calls.length === before, t());
  M.draft.redo(); M.sheet.replaceChildren(); M.tool.sheet();
  await click(first("Take that back"));
  check("new: Take that back, too", DRAFT.planPending(M.draft.cur).length === 0 && !t().includes("To keep"), t());
  // Stacked: the floor comes first.
  check("stacked: asks which floor it climbs from; the top floor isn't one", t().includes("It climbs from:") && !!first("Basement") && !first("Upper"), t());
  await click(first("Basement"));
  await click(buttons(M.sheet).filter(b => text(b) === "New")[2]);
  const st = DRAFT.planPending(M.draft.cur)[0];
  check("stacked: goes on the floor picked", st.sug_id === "c" && M.draft.cur.pieces[st.piece].floor_id === "basement", JSON.stringify(st));
  M.draft.undo(); M.sheet.replaceChildren(); M.tool.sheet();
  // A railing: its stair first; a side and a style; no side picked for you when the AI couldn't tell.
  const rail = () => all(M.sheet).filter(n => n.classList && n.classList.contains("pl-row")).find(n => text(n).includes("a rail on one side: which?"));
  check("railing: keep its stair first", text(rail()).includes("Keep its stair first") && !buttons(rail()).some(b => text(b) === "Keep this rail"), text(rail()));
  await click(first("New"));
  const railKeep = () => buttons(rail()).find(b => text(b) === "Keep this rail");
  check("railing: with its stair in the draft, side and style are asked; no side picked for you", !!railKeep() && railKeep().disabled === true && ["Both", "Left", "Right", "Balustrade", "Topless", "Single bar"].every(w => buttons(rail()).some(b => text(b) === w)), text(rail()));
  await click(buttons(rail()).find(b => text(b) === "Left"));
  await click(buttons(rail()).find(b => text(b) === "Topless"));
  await click(railKeep());
  const pendR = DRAFT.planPending(M.draft.cur).find(p => p.sug_id === "r");
  const pieceR = M.draft.cur.pieces[pendR.piece];
  check("railing: side and style on the stair, in the draft", pendR.rail.side === "inner" && pendR.rail.style === "topless" && pieceR.recipe.params.rail === "inner" && pieceR.recipe.params.rail_style === "topless", JSON.stringify(pendR));
  // The AI's side, where it could tell, is picked for you and can be changed.
  const hintBeside = all(M.sheet).filter(n => n.classList && n.classList.contains("pl-row")).find(n => text(n).includes("the AI says left"));
  check("railing: the AI's side is picked for you on a straight flight", buttons(hintBeside).find(b => text(b) === "Left").getAttribute("aria-pressed") === "true" && buttons(hintBeside).find(b => text(b) === "Keep this rail").disabled === false, text(hintBeside));
  // Correction.
  await click(buttons(M.sheet).find(b => text(b) === "Take the AI's position"));
  const cor = DRAFT.planPending(M.draft.cur).find(p => p.sug_id === "b");
  check("correction: the target moved in the draft, the file's stair still where it was", cor.v === "correction" && M.draft.cur.pieces.fur_0000000f.x_m === 4.4 && M.draft.base.pieces.fur_0000000f.x_m === 3, JSON.stringify(cor));
  check("correction: the count", t().includes("Keep 1 new, 1 correction, 1 railing (one undo for the whole session)"), t());
  await click(button(M.sheet, "Read again"));
  check("read again: not while items wait in the draft", M.hints.at(-1)[1] === true && /Save or take back/.test(M.hints.at(-1)[0]) && t().includes("To keep"), JSON.stringify(M.hints.at(-1)));
  await click(button(M.sheet, "Keep 1 new, 1 correction, 1 railing (one undo for the whole session)"));
  check("the keep button is the editor's Save", M.written.includes("save"), JSON.stringify(M.written));
  // Discard: the server hears nothing and keeps what it has.
  await click(first("Later"));
  const sentNow = M.sent("plan_ai_verdict").length;
  const noted = M.sent("plan_ai_verdict").at(-1);
  M.draft.discard(); M.sheet.replaceChildren(); M.tool.sheet();
  check("discard: nothing pending; the later written at click is not asked again, and no call goes", noted.v === "later" && DRAFT.planPending(M.draft.cur).length === 0 && M.sent("plan_ai_verdict").length === sentNow && t().includes("Later (1)") && M.draft.cur.pieces.fur_0000000f.x_m === 3, t());
  // Keep mine records already here.
  const rows = () => all(M.sheet).filter(n => n.classList && n.classList.contains("pl-row"));
  await click(buttons(M.sheet).find(b => text(b) === "Keep mine"));
  const km = M.sent("plan_ai_verdict").at(-1);
  check("keep mine: already here, written at click, nothing in the draft", km.v === "failure" && km.why === "already_here" && km.sug_id === "b" && !M.draft.dirty && M.hints.some(h => /yours stays/.test(h[0])), JSON.stringify(km));
  M.tool.dispose();
  // On a stair the AI placed, the AI's position is where it starts.
  focused = null;
  const AIs = SUGS(); AIs.b.match.hand = false; AIs.b.match.target_snap = { label: "Stairs (from the plan)" };
  const A2 = mount({ ...BASE, plan_ai_plans: { plans: PLANS, ai: LOCAL, running: null, latest: "ps_1" }, plan_ai_status: () => ({ session: SESSION({ suggestions: AIs }) }) });
  A2.tool.show(true); await settle();
  check("the AI's position: where the keyboard starts only on a stair the AI placed", focused === "Take the AI's position" && buttons(A2.sheet).find(b => text(b) === "Take the AI's position").classList.contains("go"), focused);
  check("the AI's position: no You placed this one on it", !text(A2.sheet).includes("You placed this one"), text(A2.sheet));
  A2.tool.dispose();
  // Held: a coarse position is never offered as a move.
  const Hs = SUGS(); Hs.b.match = { relation: "new", target: "fur_0000000f", near: ["fur_0000000f"], near_names: ["Hall stairs"], held: "frame" };
  const H2 = mount({ ...BASE, plan_ai_plans: { plans: PLANS, ai: LOCAL, running: null, latest: "ps_1" }, plan_ai_status: () => ({ session: SESSION({ suggestions: Hs }) }) });
  H2.tool.show(true); await settle();
  check("held: no correction offered on a coarse frame", !buttons(H2.sheet).some(b => /Take the AI|A correction of/.test(text(b))) && text(H2.sheet).includes("Position may be coarse"), buttons(H2.sheet).map(text).join("|"));
  H2.tool.dispose();
  // Near two stairs: a person may turn it into a correction of either.
  const Ns = SUGS(); Ns.a.match = { relation: "new", target: null, near: ["fur_0000000f", "fur_00000002"], near_names: ["Hall stairs", "Back stairs"], near_snaps: { fur_0000000f: {}, fur_00000002: {} }, held: null };
  const N2 = mount({ ...BASE, plan_ai_plans: { plans: PLANS, ai: LOCAL, running: null, latest: "ps_1" }, plan_ai_status: () => ({ session: SESSION({ suggestions: Ns }) }) }, { schema: 1, pieces: { fur_0000000f: stairPiece("fur_0000000f"), fur_00000002: stairPiece("fur_00000002") } });
  N2.tool.show(true); await settle();
  await click(buttons(N2.sheet).find(b => text(b) === "A correction of Back stairs"));
  const nr = DRAFT.planPending(N2.draft.cur)[0];
  check("near two: a correction of the one a person picks, never auto-paired", nr.target === "fur_00000002" && nr.piece === "fur_00000002" && N2.draft.cur.pieces.fur_00000002.x_m === 1, JSON.stringify(nr));
  N2.tool.dispose();
}
// ── a commit, and its refusals ───────────────────────────────────────────────
{
  const sess = SESSION({ suggestions: SUGS() });
  let answer = null, statusNow = sess;
  const M = mount({ ...BASE, plan_ai_plans: { plans: PLANS, ai: LOCAL, running: null, latest: "ps_1" }, plan_ai_status: () => ({ session: statusNow, undo: null }), plan_ai_commit: (m) => (typeof answer === "function" ? answer(m) : answer) });
  M.tool.show(true); await settle();
  const first = (label) => buttons(M.sheet).find(b => text(b) === label);
  await click(first("New"));
  await click(buttons(M.sheet).find(b => text(b) === "Take the AI's position"));
  const temp = DRAFT.planPending(M.draft.cur).find(p => p.sug_id === "a").piece;
  // Refused with a rev that moved: nothing drops but what can't be kept.
  answer = Object.assign(new Error("changed"), { code: "rev_mismatch" });
  let thrown = null;
  try { await M.tool.commit(); } catch (e) { thrown = e; }
  const sent = M.sent("plan_ai_commit")[0];
  check("commit: the session, the rev, every item once", sent.session === "ps_1" && sent.rev === 3 && sent.items.length === 2 && sent.items.find(i => i.sug_id === "a").v === "new" && sent.items.find(i => i.sug_id === "b").v === "correction", JSON.stringify(sent));
  check("commit: the draft's piece as final, no note on it", sent.items.every(i => i.final && !(DRAFT.PLAN_NOTE in i.final)) && sent.items.find(i => i.sug_id === "b").final.x_m === 4.4, JSON.stringify(sent));
  check("commit: a refusal is thrown as one, and the draft stays", thrown && thrown.planRefusal && thrown.code === "rev_mismatch" && DRAFT.planPending(M.draft.cur).length === 2, String(thrown));
  await M.tool.refused(thrown);
  check("rev moved: reloaded, and what can still be kept stays", M.sent("plan_ai_status").length >= 2 && DRAFT.planPending(M.draft.cur).length === 2, "");
  // Someone else kept one meanwhile: it leaves the draft.
  statusNow = { ...sess, suggestions: { ...sess.suggestions, a: { ...sess.suggestions.a, state: "committed_new", piece_id: "fur_12345678" } } };
  await M.tool.refused(thrown);
  check("two admins: an item the other kept leaves this draft: no second piece", !DRAFT.planPending(M.draft.cur).some(p => p.sug_id === "a") && !M.draft.cur.pieces[temp] && DRAFT.planPending(M.draft.cur).length === 1, JSON.stringify(DRAFT.planPending(M.draft.cur)));
  // Changed since: the list, and those leave the draft, back where they stood.
  statusNow = { ...sess, rev: 9, suggestions: { ...sess.suggestions, b: { ...sess.suggestions.b, state: "stale" } } };
  answer = { ok: false, code: "changed_since", message: "changed", changed: [{ sug_id: "b", why: "gone" }], rev: 9 };
  thrown = null;
  try { await M.tool.commit(); } catch (e) { thrown = e; }
  check("changed since: a refusal with its list", thrown && thrown.code === "changed_since" && thrown.changed[0].sug_id === "b", String(thrown));
  await M.tool.refused(thrown);
  check("changed since: the sheet reloaded, the target back where it stood, says so", DRAFT.planPending(M.draft.cur).length === 0 && M.draft.cur.pieces.fur_0000000f.x_m === 3 && /Nothing was saved/.test(thrown.message), thrown.message);
  // A commit that stands.
  statusNow = { ...sess, rev: 9, suggestions: SUGS() };
  await click(button(M.sheet, "Read again"));
  await click(button(M.sheet, "Back to the last list"));
  M.tool.show(false); M.tool.show(true); await settle();
  await click(buttons(M.sheet).find(b => text(b) === "New"));
  const t2 = DRAFT.planPending(M.draft.cur)[0].piece;
  const fileAfter = { schema: 1, pieces: { fur_0000000f: stairPiece("fur_0000000f"), fur_abcdef01: stairPiece("fur_abcdef01", { label: "Stairs (from the plan)", x_m: 1, y_m: 2, plan_ai: { batch: "pb_1" } }) } };
  answer = { ok: true, rev: 10, batch: "pb_1", piece_ids: { a: "fur_abcdef01" }, suggestions: { a: { ...SUGS().a, state: "committed_new", piece_id: "fur_abcdef01" } }, undo: { id: "pb_1", items: 1, puts_back: false }, data: fileAfter };
  const kept = await M.tool.commit();
  check("commit: what the editor adopts: the file's piece, the draft's id gone", kept.renamed[t2] === "fur_abcdef01" && kept.pieces.fur_abcdef01.plan_ai.batch === "pb_1" && /Kept 1 new from the plans/.test(kept.said), JSON.stringify(kept));
  M.draft.adopt("pieces", kept.pieces, kept.renamed);
  M.sheet.replaceChildren(); M.tool.sheet();
  check("commit: listed as kept, the undo offered, nothing pending, the file's own in the draft", DRAFT.planPending(M.draft.cur).length === 0 && text(M.sheet).includes("Kept (1)") && !!button(M.sheet, "Undo this session (1)") && !M.draft.dirty, text(M.sheet));
  M.tool.dispose();
}
// ── Undo this session ────────────────────────────────────────────────────────
{
  let sess = SESSION({ suggestions: { a: stair("a", { state: "committed_new", piece_id: "fur_abcdef01" }), d: stair("d", { state: "failure", verdict: { v: "failure", why: "wrong_place" } }) } });
  const fileBack = { schema: 1, pieces: { fur_0000000f: stairPiece("fur_0000000f") } };
  let undoNow = { id: "pb_1", items: 2, puts_back: false };
  const undoAnswer = { ok: true, undone: 1, of: 2, skipped: [{ sug_id: "z", why: "changed" }], batch: "pb_2", undo: { id: "pb_2", items: 1, puts_back: true }, data: fileBack };
  const M = mount({ ...BASE, plan_ai_plans: { plans: PLANS, ai: LOCAL, running: null, latest: "ps_1" }, plan_ai_status: () => ({ session: sess, undo: undoNow }), plan_ai_undo: () => { undoNow = undoAnswer.undo; return undoAnswer; } });
  M.tool.show(true); await settle();
  const t = () => text(M.sheet);
  M.draft.change((c) => { c.pieces.fur_0000000f.x_m = 8; });
  M.sheet.replaceChildren(); M.tool.sheet();
  await click(button(M.sheet, "Undo this session (2)"));
  check("undo: asks first", t().includes("Take what this session kept out of your 3D house?") && M.sent("plan_ai_undo").length === 0, t());
  await click(button(M.sheet, "Cancel"));
  check("undo: Cancel", !t().includes("Take what this session") && M.sent("plan_ai_undo").length === 0, t());
  await click(button(M.sheet, "Undo this session (2)"));
  await click(button(M.sheet, "Undo"));
  check("undo: not with unsaved work: says so, nothing sent", M.sent("plan_ai_undo").length === 0 && /Save or discard/.test(M.hints.at(-1)[0]) && M.hints.at(-1)[1] === true, JSON.stringify(M.hints.at(-1)));
  M.draft.discard(); M.sheet.replaceChildren(); M.tool.sheet();
  await click(button(M.sheet, "Undo this session (2)"));
  await click(button(M.sheet, "Undo"));
  check("undo: the batch, the file handed to the editor, what was left said", M.sent("plan_ai_undo")[0].batch_id === "pb_1" && M.written.includes(fileBack) && /Undone: 1 of 2\. 1 was changed since and left as it is\./.test(M.hints.at(-1)[0]), JSON.stringify(M.hints.at(-1)));
  check("undo: Put back, once undone", !!button(M.sheet, "Put back 1"), t());
  check("undo: what was marked wrong stays marked wrong", t().includes("Marked wrong (1)"), t());
  M.tool.dispose();
}
proto.focus = realFocus;

// ── A correction and a railing: only what they are, and the person's own edits stay ──
{
  const hintOn = (extra = {}) => ({ ...stair("r"), kind: "railing", geom: { stair: "fur_0000000f", side: "left", x_m: 3, y_m: 4 },
    match: { relation: "correction", target: "fur_0000000f", near: [], held: null, target_snap: { label: "Hall stairs" } }, ...extra });
  const moveTo = stair("c", { geom: { x_m: 1.5, y_m: 4 }, match: { relation: "correction", target: "fur_0000000f", distance_m: 1.5, hand: true, near: [], held: null, target_snap: { label: "Hall stairs" } } });
  // The server's answer, as plan_ai_write writes it: position, or side and style, on the file's own piece.
  const world = (sugs, filed = stairPiece("fur_0000000f")) => {
    const file = { schema: 1, pieces: { fur_0000000f: JSON.parse(JSON.stringify(filed)) } };
    const answers = { ...BASE,
      plan_ai_plans: { plans: PLANS, ai: LOCAL, running: null, latest: "ps_1", start_blocked: null },
      plan_ai_status: () => ({ session: SESSION({ suggestions: sugs }), undo: null }),
      plan_ai_commit: (m) => {
        const p = file.pieces.fur_0000000f, ids = {};
        for (const it of m.items) {
          if (it.rail) p.recipe.params = { ...p.recipe.params, rail: it.rail.side, rail_style: it.rail.style };
          else { p.x_m = it.final.x_m; p.y_m = it.final.y_m; }
          ids[it.sug_id] = "fur_0000000f";
        }
        p.plan_ai = { batch: "pb_1" };
        return { ok: true, rev: 4, batch: "pb_1", piece_ids: ids, suggestions: {}, undo: { id: "pb_1", items: m.items.length, puts_back: false }, data: JSON.parse(JSON.stringify(file)) };
      } };
    return { M: mount(answers, { schema: 1, pieces: { fur_0000000f: stairPiece("fur_0000000f") } }), file };
  };
  /** What live_aboard_edit.save does around plans.commit. */
  const saved = async (M) => {
    const kept = await M.tool.commit();
    M.draft.adopt("pieces", kept.pieces, kept.renamed);
    M.draft.change((c) => { DRAFT.dropPlanPending(c, null); });
    return M.draft.changes();
  };

  // A railing kept on a stair dragged in the same draft: the drag stays for the Save after.
  {
    const { M, file } = world({ r: hintOn() });
    M.tool.show(true); await settle();
    M.draft.change((c) => { c.pieces.fur_0000000f.x_m = 3.5; });
    M.sheet.replaceChildren(); M.tool.sheet();
    await click(button(M.sheet, "Keep this rail"));
    const item = M.sent("plan_ai_commit").length;
    const ch = await saved(M);
    const [sent] = M.sent("plan_ai_commit");
    check("railing: the commit takes side and style only", item === 0 && file.pieces.fur_0000000f.x_m === 3 && file.pieces.fur_0000000f.recipe.params.rail === "inner" && sent.items[0].final === undefined, sent);
    check("railing: a drag in the same draft is still there, for the ordinary Save", ch && ch.pieces && ch.pieces.fur_0000000f.x_m === 3.5 && M.draft.cur.pieces.fur_0000000f.recipe.params.rail === "inner", ch);
    check("railing: nothing still marked", DRAFT.planPending(M.draft.cur).length === 0, M.draft.cur.pieces);
    M.tool.dispose();
  }
  // A correction sends where it stands, nothing else; a stair changed elsewhere stays changed.
  {
    const { M, file } = world({ c: moveTo });
    M.tool.show(true); await settle();
    const other = file.pieces.fur_0000000f;                  // another tab, after this draft began
    other.recipe.params.shape = "l"; other.recipe.width_m = 1.4; other.rotation = 90;
    await click(button(M.sheet, "Take the AI's position"));
    const ch = await saved(M);
    const [sent] = M.sent("plan_ai_commit");
    check("correction: position only on the wire", Object.keys(sent.items[0].final).sort().join() === "x_m,y_m" && sent.items[0].final.x_m === 1.5, sent.items[0]);
    check("correction: an older draft puts nothing back", ch === null && M.draft.cur.pieces.fur_0000000f.recipe.params.shape === "l" && M.draft.cur.pieces.fur_0000000f.recipe.width_m === 1.4 && M.draft.cur.pieces.fur_0000000f.rotation === 90 && M.draft.cur.pieces.fur_0000000f.x_m === 1.5, { ch, p: M.draft.cur.pieces.fur_0000000f });
    M.tool.dispose();
  }
  // A person's own turn and size in that draft aren't the commit's: they go with the ordinary Save.
  {
    const { M, file } = world({ c: moveTo });
    M.tool.show(true); await settle();
    M.draft.change((c) => { const q = c.pieces.fur_0000000f; q.rotation = 45; q.recipe.width_m = 1.2; });
    M.sheet.replaceChildren(); M.tool.sheet();
    await click(button(M.sheet, "Take the AI's position"));
    const ch = await saved(M);
    check("correction: the person's own edits stay in the draft", ch && ch.pieces.fur_0000000f.rotation === 45 && ch.pieces.fur_0000000f.recipe.width_m === 1.2 && ch.pieces.fur_0000000f.x_m === 1.5, ch);
    check("correction: the commit itself took neither", file.pieces.fur_0000000f.rotation === 0 && file.pieces.fur_0000000f.recipe.width_m !== 1.2, file.pieces.fur_0000000f);
    M.tool.dispose();
  }
  // A railing's style starts on the one the stair has.
  {
    const filed = stairPiece("fur_0000000f");
    filed.recipe.params.rail_style = "topless";
    const answers = { ...BASE, plan_ai_plans: { plans: PLANS, ai: LOCAL, running: null, latest: "ps_1", start_blocked: null },
      plan_ai_status: () => ({ session: SESSION({ suggestions: { r: hintOn() } }), undo: null }) };
    const M = mount(answers, { schema: 1, pieces: { fur_0000000f: filed } });
    M.tool.show(true); await settle();
    const pressed = buttons(M.sheet).filter(b => b.getAttribute("aria-pressed") === "true").map(text);
    check("railing: its style starts on the stair's own", pressed.includes("Topless") && !pressed.includes("Balustrade"), pressed);
    M.tool.dispose();
  }
}
// ── S7: a mark nobody read a symbol from isn't "already there" ──────────────
{
  const lightSug = (id, symbol) => ({ ...stair(id), kind: "light", state: "duplicate", geom: { x_m: 1, y_m: 2, symbol }, match: { relation: "duplicate", near: [], held: null, target: "light.a", label: "Hall", now_kind: "pot" } });
  const M = mount({ ...BASE, plan_ai_plans: { plans: PLANS, ai: LOCAL, running: null, latest: "ps_1", start_blocked: null },
    plan_ai_status: { session: SESSION({ lights_asked: true, suggestions: { y: lightSug("y", "pot"), u: lightSug("u", "unknown"), v: lightSug("v", "unknown") } }) } });
  M.tool.show(true); await settle();
  const t = text(M.sheet);
  check("S7: one read as that light is already there", t.includes("1 light was already there."), t);
  check("S7: the others are said for what they are", t.includes("2 marks near a placed light weren't read closely enough to say what they are."), t);
  check("S7: each in its own group", t.includes("Already in your house") && t.includes("Near a placed light, not read closely"), t);
  M.tool.dispose();
  const O = mount({ ...BASE, plan_ai_plans: { plans: PLANS, ai: LOCAL, running: null, latest: "ps_1", start_blocked: null },
    plan_ai_status: { session: SESSION({ lights_asked: true, suggestions: { u: lightSug("u", "unknown") } }) } });
  O.tool.show(true); await settle();
  const o = text(O.sheet);
  check("S7: only unread marks: nothing called already there", !o.includes("already there") && !o.includes("Already in your house") && o.includes("1 mark near a placed light wasn't read closely enough to say what it is."), o);
  O.tool.dispose();
}
console.log(JSON.stringify(results));
process.exit(0);
