// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
// See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
//
// Let Claude draw your rooms (experimental; design PadspanResearch
// ai-wizard-design-2026-11-10.md, B, C option 2, D, G). For a house whose
// plan has a scale and no rooms: intro (the trial for a free install, the
// consent), Connect Claude, the rooms read, the rooms check drawn over the
// plan picture, Save, Done with Undo and the hand-off to Setup's receivers.
//
// Nothing new on the server's side of the rooms: the read, the edits, the
// save and its undo are Rooms from plans' own commands (ws_plan_ai.py), sent
// with via "wizard" (Live Aboard may be off; names are pre-filled; the
// server says which rows start ticked). The outlines are the Plans tool's
// list (live_aboard_plans.roomShapes), drawn on the picture through the read
// plan's own metres (stack_transform.metresToMapFrac). A focused view with
// one Back; it never changes Basic or Advanced, and on a wall screen no link
// opens a new page (trial_offer.newTabOk).

const V = new URL(import.meta.url).search;
const OFFER = await import(`./ai_wizard_offer.js${V}`);
const TRIAL = await import(`./trial_offer.js${V}`).catch(() => null);
const { roomShapes } = await import(`./live_aboard_plans.js${V}`);
const { metresToMapFrac } = await import(`./stack_transform.js${V}`);
const { _haLink } = await import(`./rooms.js${V}`);

export const VIA = "wizard";
export const CONSOLE_URL = "https://platform.claude.com/";
export const GUIDE_URL = "https://padspan.traks.ca/guides/claude-ai-task/";
export const HA_ADD_PATH = "/config/integrations/dashboard/add?domain=anthropic";
export const HA_ANTHROPIC_PATH = "/config/integrations/integration/anthropic";
export const HA_AREAS_PATH = "/config/areas/dashboard";

export const LEAVES = "Your floor plan picture goes to Anthropic, the company that makes Claude, through Home Assistant's Anthropic " +
  "integration and your own Anthropic account. Nothing else from your house is sent: no people, devices or positions.";
export const COST = "Anthropic charges your Anthropic account for each read: two reads for one plan, and one more for a room you " +
  "ask Claude to look at again. The Anthropic Console's usage page shows what it cost.";
const MODEL_WORDS = "Claude Opus 5.5 or newer (any Fable or Mythos works too)";

// What the person sees when a read or a save stops (design B, the failure table), and what they can do.
export const FAILS = {
  no_credit: { text: "Anthropic says this account is out of credit, so Claude couldn't read the plan. Nothing in your house was changed; " +
    "what was read is kept. Credit is set up in the Anthropic Console, under Billing. If your Claude plan includes monthly API credit, " +
    "check that your Console organisation is linked to it (the guide shows how).", acts: ["console", "guide", "resume"] },
  unreachable: { text: "Claude couldn't be reached. Nothing was changed; what was read is kept. Check that Home Assistant's Anthropic integration is working.",
    acts: ["resume"] },
  out_of_time: { text: "The reading stopped part-way. What was read is kept.", acts: ["carry_on"] },
  bad_answer: { text: "Claude's answers couldn't be used for this plan.", acts: ["again", "by_hand"] },
  refusal: { text: "Claude's answers couldn't be used for this plan.", acts: ["again", "by_hand"] },
  daily_cap: { text: "That's ten readings today. Try again tomorrow; nothing was lost.", acts: [] },
  no_media: { text: "Home Assistant's media folder couldn't take the plan for Claude.", acts: ["guide"] },
  backup_failed: { text: "The safety backup couldn't be made, so nothing was saved. Check Home Assistant's storage and try again.", acts: ["save"] },
  changed_since: { text: "The plan or your rooms changed while you were checking. Nothing was saved.", acts: ["read_again"] },
};
const ACT_LABEL = { console: "Open the Console ↗", guide: "Guide ↗", resume: "Try again", carry_on: "Carry on", again: "Try again",
  by_hand: "Draw them myself", save: "Try again", read_again: "Read again" };

// ── pure: which case, which screen, which words ──────────────────────────────

/** Claude's case from plan_build_info: {why, display, eid}. why is the unlock
 *  rule's word, or available_unchosen: a usable Claude that isn't PadSpan's AI. */
export function claudeState(build) {
  const b = build || {}, u = b.unlock || {}, cands = b.candidates || [];
  if (u.ok) return { why: "ok", display: u.display };
  const usable = cands.find(c => c.ok && !c.chosen);
  if (usable) return { why: "available_unchosen", display: usable.display, eid: usable.entity_id };
  let why = u.why || "no_ai_task", display = u.display || null;
  if (why === "no_ai_task" || why === "not_anthropic") {          // an Anthropic AI Task with the wrong model says more
    const anth = cands.find(c => c.why && c.why !== "not_anthropic");
    if (anth) { why = anth.why; display = anth.display; }
  }
  return { why, display };
}

/** Whether Start must first turn the two switches on (or choose Claude): asked by a tick, never silently. */
export function needsConsent(build, why) {
  return !(build && build.master && build.switch) || why === "available_unchosen";
}

/** The intro's block for a starting state: trial (free, no AI Task or any),
 *  no_pro, connect (Pro, Claude not ready), consent or start (Pro, Claude ready). */
export function introBlock(info, build) {
  if (!info || info.tier !== "pro") return info && info.trial_offerable ? "trial" : "no_pro";
  const c = claudeState(build).why;
  if (c !== "ok" && c !== "available_unchosen") return "connect";
  return needsConsent(build, c) ? "consent" : "start";
}

/** A stopped session's word (FAILS), or null while it reads or when it read. */
export function failOf(sess) {
  if (!sess) return null;
  const st = sess.status, e = sess.error;
  if (st === "no_credit") return "no_credit";
  if (st === "out_of_time") return "out_of_time";
  if (st === "cancelled") return ["plan_changed", "plan_gone", "ai_changed"].includes(e) ? "changed_since" : "out_of_time";
  if (st === "failed") return { unreachable: "unreachable", no_media: "no_media", refusal: "refusal", no_credit: "no_credit" }[e] || "bad_answer";
  return null;
}

/** A command's refusal code as a FAILS word, or null. */
export function failOfCode(code) {
  if (code === "daily_cap" || code === "backup_failed") return code;
  if (["changed_since", "rev_mismatch", "name_taken", "plan_changed", "rooms_changed", "not_open"].includes(code)) return "changed_since";
  return null;
}

/** Other refusals, in plain words. */
const CODE_WORDS = {
  too_soon: "A reading started less than a minute ago. Try again in a minute.",
  already_running: "Claude is already reading a plan. Try again when it's done.",
  map_not_placed: "This plan's scale isn't set, so its rooms can't be read yet. Set the scale in Setup first.",
  apart: "Those two don't touch, so they can't be one room. Join only rooms that touch.",
  invalid: "Pick two or more rooms on the plan to join.",
  two_rooms: "Two of your rooms can't be joined here.",
  not_found: "That room isn't there any more: the list is reloaded.",
};
export const codeWords = (code) => CODE_WORDS[code] || "That didn't work. Try again in a moment.";

/** The screen a session belongs on. */
export function screenOf(ans) {
  const s = ans && ans.session;
  if (!s) return "intro";
  if (s.status === "running") return "rooms_read";
  if (ans.undo && s.saved && Object.keys(s.saved).length) return "saved";
  if (s.proposal) return "rooms_check";
  return failOf(s) ? "fail" : "intro";
}

/** Plans the helper can read, best first: a scale, inside the house; the lowest floor, then the largest picture. */
export function plansOf(state) {
  const tfs = (state.model && state.model.map_transforms) || {};
  const floors = (state.model && state.model.floors) || [];
  const rank = (fid) => { const i = floors.findIndex(f => f && (f.floor_id || f.id) === fid); return i < 0 ? 999 : Number(floors[i].level ?? i); };
  const px = (m) => Number((m.image || {}).width || 0) * Number((m.image || {}).height || 0);
  return ((state.maps && state.maps.list) || [])
    .filter(m => m && m.id && String(m.floor_id || "") !== "outside" && tfs[m.id] && Number(tfs[m.id].scale_x_m) > 0)
    .sort((a, b) => rank(a.floor_id) - rank(b.floor_id) || px(b) - px(a));
}

export function floorName(state, fid) {
  const f = ((state.model && state.model.floors) || []).find(x => x && (x.floor_id || x.id) === fid);
  return (f && f.name) || fid || "this floor";
}

/** Each outline on the plan picture, in picture fractions through the read plan's own metres. */
export function pictureShapes(prop, t) {
  return roomShapes(prop).filter(s => s.kind !== "his" && Array.isArray(s.pts) && s.pts.length >= 3)
    .map(s => ({ ...s, frac: s.pts.map(([x, y]) => metresToMapFrac(t, x, y)).filter(Boolean) }))
    .filter(s => s.frac.length >= 3);
}

/** Rows as the check screen lists them: id, name, how sure, the chip's case. */
export function rowsOf(ans) {
  const p = (ans && ans.session && ans.session.proposal) || {}, w = (ans && ans.wizard) || {};
  const src = w.sources || {}, areas = new Set(((ans && ans.areas) || []).map(a => String(a).toLowerCase()));
  const out = [];
  for (const id of w.rows || []) {
    if (id.startsWith("room:")) {
      const r = (p.rooms || {})[id.slice(5)];
      if (r) out.push({ id, name: r.room, sure: !!r.ready, his: true, flagged: (r.flags || []).some(f => f === "reads_differ" || f === "three_differ") });
      continue;
    }
    const s = (p.spaces || {})[id];
    if (!s) continue;
    const name = s.new || "";
    const matched = ["area_exact", "area_abbrev", "picked_area"].includes(src[id]) || areas.has(name.toLowerCase());
    out.push({ id, name, sure: (s.reads || []).length >= 2, matched, small: (w.small || []).includes(id), m2: (w.m2 || {})[id] });
  }
  return out;
}

// ── the view ────────────────────────────────────────────────────────────────

const _done = new Set();     // once a page: steps marked, AI words, failures counted
export function _resetCounts() { _done.clear(); }   // a test's new page

function tel(ctx, name) { if (ctx.actions.telemetryEvent) ctx.actions.telemetryEvent(name); }
function telOnce(ctx, name) { if (!_done.has(name)) { _done.add(name); tel(ctx, name); } }
const ws = (ctx, payload) => ctx.actions.callWS(payload);

function S_of(ctx) {
  const st = ctx.state;
  if (!st._aiw) st._aiw = { screen: null, info: null, build: null, ans: null, plan: null, ticks: new Set(), ha: new Set(), sel: new Set(),
    sid: null, busy: false, msg: "", fail: null, showSmall: false, ok1: false, ok2: false, done: null, undone: null, timer: null, loading: false };
  return st._aiw;
}

function stepWord(S) {
  if (S.screen === "intro") return { trial: "trial", consent: "consent" }[introBlock(S.info, S.build)] || "intro";
  return { connect: "connect", rooms_read: "rooms_read", rooms_check: "rooms_check", saved: "saved" }[S.screen] || null;
}

function markStep(ctx, S) {
  const step = stepWord(S);
  if (!step || _done.has("step:" + step)) return;
  _done.add("step:" + step);
  const ids = {};
  if (S.plan) { ids.map_id = S.plan.id; ids.floor_id = S.plan.floor_id; }
  if (S.sid) ids.rooms_session = S.sid;
  ws(ctx, { type: "padspan_ha/ai_wizard_mark", what: "step", step, ...ids }).catch(() => {});
}

const rerender = (ctx) => ctx.actions.renderRooms();

async function loadAll(ctx, S) {
  if (S.loading) return;
  S.loading = true;
  try {
    const [info, build] = await Promise.all([
      ws(ctx, { type: "padspan_ha/ai_wizard_info", surface: "pull", kiosk: !!ctx.state.kioskMode, live: true }).catch(() => null),
      ws(ctx, { type: "padspan_ha/plan_build_info", via: VIA }).catch(() => null)]);
    const was = claudeState(S.build).why;
    S.info = info || { tier: "free", wizard: {} };
    S.build = build || {};
    const now = claudeState(S.build).why;
    if (S.screen === "connect" && was !== "ok" && now === "ok") telOnce(ctx, "ai_wizard_ai:became_ok");
    if (S.screen === null) {
      const w = S.info.wizard || {};
      const plans = plansOf(ctx.state);
      S.plan = plans.find(m => w.started && m.id === w.started.map_id) || plans[0] || null;
      if (w.started && !w.finished_day && !w.undone && w.started.at !== "intro" && !_done.has("came_back")) {
        _done.add("came_back");                       // counted by the server (ai_wizard:came_back)
        ws(ctx, { type: "padspan_ha/ai_wizard_mark", what: "came_back" }).catch(() => {});
      }
      S.screen = "intro";
      if (w.started && w.started.rooms_session) {
        S.sid = w.started.rooms_session;
        await status(ctx, S);
      }
      telOnce(ctx, "ai_wizard_ai:" + (now === "ok" ? "ok" : now));
    }
  } finally {
    S.loading = false;
    rerender(ctx);
  }
}

function take(S, ans) {
  if (!ans) return;
  const fresh = !S.ans || !S.ans.session || !ans.session || S.ans.session.id !== ans.session.id;
  const had = new Set(((S.ans && S.ans.wizard) || {}).rows || []);
  S.ans = ans;
  const w = ans.wizard || {}, rows = new Set(w.rows || []);
  if (fresh) S.ticks = new Set(w.ticked || []);
  else {
    for (const id of [...S.ticks]) if (!rows.has(id)) S.ticks.delete(id);
    for (const id of w.ticked || []) if (!had.has(id)) S.ticks.add(id);      // a joined room: ticked as offered
  }
  for (const id of [...S.ha]) if (!rows.has(id)) S.ha.delete(id);
  for (const id of [...S.sel]) if (!rows.has(id)) S.sel.delete(id);
}

async function status(ctx, S) {
  try {
    const ans = await ws(ctx, { type: "padspan_ha/plan_build_rooms_status", session: S.sid, via: VIA });
    take(S, ans);
    const scr = screenOf(ans);
    if (scr !== "intro") S.screen = scr;
    if (scr === "fail" || scr === "rooms_check") {
      const f = failOf(ans.session);
      if (f) telOnce(ctx, "ai_wizard_fail:" + f);
      S.fail = scr === "fail" ? f : null;
    }
  } catch (e) {
    S.screen = "intro";
  }
}

function poll(ctx, S) {
  if (S.timer || typeof setTimeout !== "function") return;
  S.timer = setTimeout(async () => {
    S.timer = null;
    if (ctx.state.view !== "ai_wizard" || ctx.state._aiw !== S || S.screen !== "rooms_read") return;
    await status(ctx, S);
    rerender(ctx);
  }, 4000);
}

async function startRead(ctx, S, plan) {
  S.busy = true; S.msg = ""; S.fail = null;
  rerender(ctx);
  try {
    const c = claudeState(S.build);
    if (needsConsent(S.build, c.why)) {
      const st = ctx.state, set = {};
      if (!(S.build.master && S.build.switch)) Object.assign(set, { ai_plans_enabled: true, ai_plan_build_enabled: true });
      if (c.why === "available_unchosen") Object.assign(set, chooseClaude(st, c.eid));
      const res = await ws(ctx, { type: "padspan_ha/settings_set", ...set });
      if (res && res.settings) st.settings = res.settings;
      if (set.ai_plans_enabled) tel(ctx, "ai_wizard_switch:on");
      if (set.atlas_3d_ai_task_entity) tel(ctx, "ai_wizard_ai:chosen");
      S.build = await ws(ctx, { type: "padspan_ha/plan_build_info", via: VIA }).catch(() => S.build);
    }
    const r = await ws(ctx, { type: "padspan_ha/plan_build_rooms_start", floor_id: plan.floor_id, map_ids: [plan.id], via: VIA });
    S.plan = plan; S.sid = r.session; S.ans = null; S.ticks = new Set(); S.ha = new Set(); S.sel = new Set(); S.done = null; S.undone = null;
    S.screen = "rooms_read";
    _done.delete("step:rooms_read"); _done.delete("step:rooms_check"); _done.delete("step:saved");
  } catch (e) {
    const code = e && e.code;
    S.fail = failOfCode(code);
    if (S.fail) { telOnce(ctx, "ai_wizard_fail:" + S.fail); S.screen = "fail"; }
    else if (code === "plan_build_locked") S.screen = "connect";
    else S.msg = codeWords(code);
  }
  S.busy = false;
  rerender(ctx);
}

/** The settings that make a usable Claude PadSpan's AI; the old choice becomes the backup if none is set. */
export function chooseClaude(settings, eid) {
  const old = String((settings && settings.atlas_3d_ai_task_entity) || "");
  const out = { atlas_3d_ai_task_entity: eid };
  if (old && old !== eid && !(settings && settings.atlas_3d_ai_task_backup_entity)) out.atlas_3d_ai_task_backup_entity = old;
  return out;
}

async function act(ctx, S, word) {
  if (word === "console" || word === "guide") return;          // links, below
  if (word === "by_hand") { ctx.state._aiw = null; ctx.actions.openSetupStep("rooms"); return; }
  if (word === "save") return save(ctx, S);
  S.busy = true; S.msg = ""; rerender(ctx);
  try {
    if (word === "resume" || word === "carry_on") {
      await ws(ctx, { type: "padspan_ha/plan_build_rooms_resume", session: S.sid, via: VIA });
      S.screen = "rooms_read"; S.fail = null;
    } else if (word === "again" || word === "read_again") {
      S.busy = false;
      return startRead(ctx, S, S.plan);
    }
  } catch (e) {
    const f = failOfCode(e && e.code);
    if (f) { S.fail = f; S.screen = "fail"; } else S.msg = codeWords(e && e.code);
  }
  S.busy = false;
  rerender(ctx);
}

async function edit(ctx, S, args) {
  const sess = S.ans && S.ans.session;
  if (!sess) return;
  S.busy = true; S.msg = "";
  try {
    take(S, await ws(ctx, { type: "padspan_ha/plan_build_rooms_edit", session: sess.id, rev: sess.rev, via: VIA, ...args }));
    S.sel = new Set();
  } catch (e) {
    S.msg = e && e.code === "name_taken" ? "Another room already has that name." : codeWords(e && e.code);
    await status(ctx, S);
  }
  S.busy = false;
  rerender(ctx);
}

async function save(ctx, S) {
  const sess = S.ans && S.ans.session;
  const rows = new Set(((S.ans && S.ans.wizard) || {}).rows || []);
  const items = [...S.ticks].filter(id => rows.has(id));
  if (!sess || !items.length) return;
  S.busy = true; S.msg = ""; S.fail = null; rerender(ctx);
  const names = Object.fromEntries(rowsOf(S.ans).map(r => [r.id, r.name]));
  try {
    const r = await ws(ctx, { type: "padspan_ha/plan_build_rooms_commit", session: sess.id, rev: sess.rev, items, via: VIA,
      ha_areas: [...S.ha].filter(id => S.ticks.has(id)) });
    if (r && r.ok === false) throw { code: r.code };
    take(S, r);
    S.done = { saved: items.length, areas: r.areas || {}, names };
    S.screen = "saved";
    OFFER.forget();
  } catch (e) {
    const f = failOfCode(e && e.code);
    if (f) { S.fail = f; telOnce(ctx, "ai_wizard_fail:" + f); } else S.msg = codeWords(e && e.code);
    if (f === "changed_since") await status(ctx, S);
  }
  S.busy = false;
  rerender(ctx);
}

async function undo(ctx, S) {
  S.busy = true; S.msg = ""; rerender(ctx);
  try {
    const r = await ws(ctx, { type: "padspan_ha/plan_build_rooms_undo", session: S.sid, via: VIA });
    S.undone = { n: Number(r && r.undone) || 0, skipped: ((r && r.skipped) || []).length };
    OFFER.forget();
  } catch (e) {
    S.msg = codeWords(e && e.code);
  }
  S.busy = false;
  rerender(ctx);
}

function leave(ctx, S) {
  const step = stepWord(S);
  if (step && S.screen !== "saved" && !S.undone) tel(ctx, "ai_wizard_left:" + step);
  if (S.timer) { clearTimeout(S.timer); S.timer = null; }
  const from = ctx.state._aiwFrom || {};
  ctx.state._aiw = null;
  ctx.actions.showView(from.view && from.view !== "ai_wizard" ? from.view : "overview");
}

// ── pieces ──────────────────────────────────────────────────────────────────

function btn(ctx, label, on, extra = {}) {
  const b = ctx.helpers.el("button", { class: "btn inline" + (extra.primary ? " primary" : ""), style: "font-size:12px", ...(extra.attrs || {}) }, label);
  if (extra.disabled) b.disabled = true;
  b.addEventListener("click", on);
  return b;
}

/** An outside link: a new tab where one can be closed again, else the address said. */
function ext(ctx, url, label, word) {
  const { el } = ctx.helpers;
  const tabOk = TRIAL && TRIAL.newTabOk ? TRIAL.newTabOk(!!ctx.state.kioskMode) : !ctx.state.kioskMode;
  if (!tabOk) return el("span", { "data-aiw": "link-" + word, style: "font-size:12px;color:#94a3b8" }, `${label.replace(/ ↗$/, "")}: ${url.replace(/^https:\/\//, "").replace(/\/$/, "")}`);
  const a = el("a", { href: url, target: "_blank", rel: "noopener", "data-aiw": "link-" + word, style: "font-size:12px;color:#52b788" }, label);
  a.addEventListener("click", () => tel(ctx, "ai_wizard_link:" + word));
  return a;
}

/** A link to a Home Assistant page, in the same window. */
function haLink(ctx, path, label, word) {
  const a = _haLink(ctx.helpers.el, path, label);
  a.setAttribute("data-aiw", "link-" + word);
  a.addEventListener("click", () => tel(ctx, "ai_wizard_link:" + word));
  return a;
}

const P = (ctx, text, style = "") => ctx.helpers.el("div", { style: "font-size:13px;color:#cbd5e1;line-height:1.55;margin:6px 0;" + style }, text);
const MUTED = (ctx, text) => ctx.helpers.el("div", { style: "font-size:12px;color:#94a3b8;line-height:1.5;margin:6px 0" }, text);
const row = (ctx, kids, style = "") => ctx.helpers.el("div", { style: "display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin:8px 0;" + style }, kids);

function failBlock(ctx, S, word) {
  const { el } = ctx.helpers, f = FAILS[word];
  if (!f) return null;
  const box = el("div", { "data-aiw": "fail-" + word, style: "border:1px solid #f59e0b;border-radius:8px;padding:8px 12px;margin:8px 0" });
  box.appendChild(P(ctx, f.text, "margin:0"));
  const acts = f.acts.map(a => a === "console" ? ext(ctx, CONSOLE_URL, ACT_LABEL.console, "console")
    : a === "guide" ? ext(ctx, GUIDE_URL, ACT_LABEL.guide, "guide")
      : btn(ctx, ACT_LABEL[a], () => act(ctx, S, a), { attrs: { "data-aiw": "act-" + a }, disabled: S.busy }));
  if (acts.length) box.appendChild(row(ctx, acts));
  return box;
}

// ── screens ─────────────────────────────────────────────────────────────────

function introScreen(ctx, S, box) {
  const { el } = ctx.helpers, st = ctx.state;
  const plans = plansOf(st);
  box.appendChild(P(ctx, "Two steps, a few minutes:"));
  box.appendChild(el("ol", { style: "font-size:13px;color:#cbd5e1;line-height:1.55;margin:4px 0 4px 18px;padding:0" }, [
    el("li", {}, "Claude finds the rooms on your plan and their names. Rooms that match your Home Assistant rooms get their names."),
    el("li", {}, "You tick the rooms to keep and press Save. A backup is taken first; one Undo takes it all back."),
  ]));
  box.appendChild(MUTED(ctx, "✓ This plan's scale is already set."));
  if (!plans.length) {
    box.appendChild(P(ctx, "No floor plan with a scale was found. Set the scale in Setup first."));
    return;
  }
  if (plans.length > 1) {
    box.appendChild(P(ctx, "Which plan shall we start with?"));
    for (const m of plans) {
      const r = el("input", { type: "radio", name: "aiw-plan", "data-aiw": "plan-" + m.id });
      r.checked = !!(S.plan && S.plan.id === m.id);
      r.addEventListener("change", () => { S.plan = m; rerender(ctx); });
      box.appendChild(el("label", { style: "display:flex;gap:6px;align-items:center;font-size:13px;color:#e2e8f0;margin:2px 0" },
        [r, `${m.name || "Plan"} (${floorName(st, m.floor_id)})`]));
    }
  }
  box.appendChild(MUTED(ctx, LEAVES));
  box.appendChild(MUTED(ctx, COST));
  const block = introBlock(S.info, S.build);
  if (block === "trial" || block === "no_pro") {
    box.appendChild(P(ctx, block === "trial" ? "Drawing rooms with Claude is part of PadSpan Pro. Try it free:" : "Drawing rooms with Claude is part of PadSpan Pro."));
    if (block === "trial" && TRIAL) {
      const host = TRIAL.trialHostFromCtx(ctx);
      const started = host.onStarted;
      host.onStarted = (r) => { started(r); loadAll(ctx, S); };
      const card = TRIAL.trialOfferCard(host, "ai_wizard", { buy: false });
      if (card) box.appendChild(card);
      box.appendChild(MUTED(ctx, "When the trial ends, the rooms you saved stay: they're ordinary rooms."));
    }
    return;
  }
  if (block === "connect") {
    box.appendChild(row(ctx, [btn(ctx, "Next: connect Claude →", () => { S.screen = "connect"; rerender(ctx); }, { primary: true, attrs: { "data-aiw": "next-connect" } })]));
    return;
  }
  const c = claudeState(S.build);
  let ready = true;
  if (block === "consent") {
    if (!(S.build.master && S.build.switch)) {
      const t1 = el("input", { type: "checkbox", "data-aiw": "consent" });
      t1.checked = S.ok1;
      t1.addEventListener("change", () => { S.ok1 = t1.checked; rerender(ctx); });
      box.appendChild(el("label", { style: "display:flex;gap:6px;align-items:flex-start;font-size:12px;color:#cbd5e1;line-height:1.45;margin:6px 0" }, [t1,
        el("span", {}, "Turn on \"AI map-building research\" and \"Build from plans\" in Settings → AI (both experimental). You can turn them off there; that doesn't undo anything you saved.")]));
      ready = ready && S.ok1;
    }
    if (c.why === "available_unchosen") {
      const t2 = el("input", { type: "checkbox", "data-aiw": "choose" });
      t2.checked = S.ok2;
      t2.addEventListener("change", () => { S.ok2 = t2.checked; rerender(ctx); });
      box.appendChild(el("label", { style: "display:flex;gap:6px;align-items:flex-start;font-size:12px;color:#cbd5e1;line-height:1.45;margin:6px 0" }, [t2,
        el("span", {}, `Use ${c.display || "Claude"} for PadSpan's AI. Photo and stair reading will use it too.`)]));
      ready = ready && S.ok2;
    }
  }
  box.appendChild(row(ctx, [btn(ctx, S.busy ? "Starting…" : "Read my plan →", () => { if (ready && !S.busy && S.plan) startRead(ctx, S, S.plan); }, { primary: true, disabled: !ready || S.busy || !S.plan, attrs: { "data-aiw": "start" } })]));
}

function connectScreen(ctx, S, box) {
  const { el } = ctx.helpers;
  const c = claudeState(S.build);
  telOnce(ctx, "ai_wizard_ai:" + c.why);
  const again = btn(ctx, "Check again", () => { tel(ctx, "ai_wizard_ai:check_again"); loadAll(ctx, S); }, { attrs: { "data-aiw": "check-again" } });
  if (c.why === "ok") {
    box.appendChild(P(ctx, `✓ ${c.display || "Claude"} is ready.`));
    box.appendChild(row(ctx, [btn(ctx, "Next →", () => { S.screen = "intro"; rerender(ctx); }, { primary: true, attrs: { "data-aiw": "next-intro" } })]));
    return;
  }
  if (c.why === "available_unchosen") {
    box.appendChild(P(ctx, `Home Assistant has ${c.display || "Claude"} ready.`));
    const use = btn(ctx, "Use it for PadSpan", async () => {
      const st = ctx.state, set = chooseClaude(st.settings, c.eid);
      try {
        const res = await ws(ctx, { type: "padspan_ha/settings_set", ...set });
        if (res && res.settings) st.settings = res.settings;
        tel(ctx, "ai_wizard_ai:chosen");
        S.msg = set.atlas_3d_ai_task_backup_entity ? "Done. Your earlier AI Task is kept as the backup." : "";
        S.screen = "intro";
        await loadAll(ctx, S);
      } catch (e) { S.msg = codeWords(e && e.code); rerender(ctx); }
    }, { primary: true, attrs: { "data-aiw": "use-claude" } });
    box.appendChild(row(ctx, [use]));
    return;
  }
  if (c.why === "below_opus_5_5") {
    box.appendChild(P(ctx, `Your AI Task uses ${c.display || "an older Claude"}. Drawing rooms needs ${MODEL_WORDS}. ` +
      "Change the model in Home Assistant: Settings → Devices & services → Anthropic."));
    box.appendChild(row(ctx, [haLink(ctx, HA_ANTHROPIC_PATH, "Open the Anthropic integration", "ha_anthropic"), again]));
    return;
  }
  if (c.why === "unknown_model" || c.why === "sources_disagree") {
    box.appendChild(P(ctx, "PadSpan can't tell which Claude model this AI Task uses. Choose the model again by its full name in the Anthropic integration."));
    box.appendChild(row(ctx, [haLink(ctx, HA_ANTHROPIC_PATH, "Open the Anthropic integration", "ha_anthropic"), again]));
    return;
  }
  box.appendChild(P(ctx, "Claude isn't connected to Home Assistant yet. It takes about ten minutes, once:"));
  const li = (kids) => el("li", { style: "margin:4px 0" }, kids);
  box.appendChild(el("ol", { "data-aiw": "connect-steps", style: "font-size:13px;color:#cbd5e1;line-height:1.55;margin:4px 0 4px 18px;padding:0" }, [
    li([el("b", {}, "Get an API key. "), "Sign in to the Anthropic Console and create a key. ", ext(ctx, CONSOLE_URL, "Open the Anthropic Console ↗", "console")]),
    li([el("b", {}, "Make sure that account has credit. "), "Credit is set up in the Console, under Billing. If your Claude plan includes monthly API credit, link your Console organisation to it first."]),
    li([el("b", {}, "Add Home Assistant's Anthropic integration "), "and paste the key. ", haLink(ctx, HA_ADD_PATH, "Add Anthropic to Home Assistant", "ha_add")]),
    li([el("b", {}, "Add an AI Task "), `in that integration and choose ${MODEL_WORDS} as its model.`]),
    li(["Come back here and press ", el("b", {}, "Check again"), "."]),
  ]));
  box.appendChild(row(ctx, ["Step-by-step guide with pictures, kept up to date:", ext(ctx, GUIDE_URL, "Connect Claude for PadSpan ↗", "guide")]));
  box.appendChild(row(ctx, [again]));
}

function readScreen(ctx, S, box) {
  const sess = S.ans && S.ans.session;
  const pr = (sess && sess.progress) || {};
  box.appendChild(P(ctx, "Claude is reading your plan for its rooms, twice, to check itself… (1–3 minutes). " +
    "You can leave this page; it carries on, and the Overview will say when it's ready."));
  if (pr.step) box.appendChild(MUTED(ctx, `Now: ${pr.step === "measure" ? "putting the rooms together" : pr.step}.`));
  poll(ctx, S);
}

function picture(ctx, S, shapes) {
  const { el, esc } = ctx.helpers, st = ctx.state;
  const map = ((st.maps && st.maps.list) || []).find(m => S.plan && m.id === S.plan.id);
  const img = map && ctx.helpers.mapImageUrl ? ctx.helpers.mapImageUrl(map) : null;
  const w = Number((map && map.image && map.image.width) || 1000), h = Number((map && map.image && map.image.height) || 750);
  const H = Math.round(1000 * h / w);
  const sure = new Set(rowsOf(S.ans).filter(r => r.sure).map(r => r.id));
  let svg = `<svg viewBox="0 0 1000 ${H}" preserveAspectRatio="none" style="position:absolute;left:0;top:0;width:100%;height:100%">`;
  for (const s of shapes) {
    const col = sure.has(s.id) ? "#52b788" : "#f59e0b", on = S.ticks.has(s.id), picked = S.sel.has(s.id);
    const pts = s.frac.map(([fx, fy]) => `${(fx * 1000).toFixed(1)},${(fy * H).toFixed(1)}`).join(" ");
    svg += `<polygon data-id="${esc(s.id)}" points="${pts}" fill="${col}" fill-opacity="${on ? 0.3 : 0.06}" stroke="${picked ? "#ffffff" : col}" ` +
      `stroke-width="${picked ? 5 : 3}"${on ? "" : ' stroke-dasharray="10 6"'} style="cursor:pointer"/>`;
  }
  for (const s of shapes) {
    const cx = s.frac.reduce((a, p) => a + p[0], 0) / s.frac.length * 1000, cy = s.frac.reduce((a, p) => a + p[1], 0) / s.frac.length * H;
    svg += `<text x="${cx.toFixed(1)}" y="${cy.toFixed(1)}" text-anchor="middle" font-size="20" fill="#ffffff" stroke="#000000" stroke-width="3" paint-order="stroke" pointer-events="none">${esc(s.name || "")}</text>`;
  }
  svg += "</svg>";
  const pic = el("div", { "data-aiw": "picture", style: `position:relative;width:100%;max-width:900px;aspect-ratio:${w}/${h};background:#0f1a12;border-radius:6px;overflow:hidden;margin:8px 0` });
  if (img) pic.appendChild(el("img", { src: img, alt: "", style: "position:absolute;left:0;top:0;width:100%;height:100%;object-fit:fill;opacity:.85" }));
  const layer = el("div", { style: "position:absolute;left:0;top:0;width:100%;height:100%" });
  layer.innerHTML = svg;
  layer.addEventListener("click", (e) => {
    const id = e && e.target && e.target.getAttribute ? e.target.getAttribute("data-id") : null;
    if (!id) return;
    if (S.sel.has(id)) S.sel.delete(id); else S.sel.add(id);
    rerender(ctx);
  });
  pic.appendChild(layer);
  return pic;
}

function checkScreen(ctx, S, box) {
  const { el } = ctx.helpers;
  const sess = S.ans.session, rows = rowsOf(S.ans), w = S.ans.wizard || {};
  const shown = rows.filter(r => !r.small || S.showSmall);
  const nTick = rows.filter(r => S.ticks.has(r.id)).length;
  const f = failOf(sess);
  if (f) box.appendChild(failBlock(ctx, S, f));
  box.appendChild(P(ctx, `Claude found ${rows.length} room${rows.length === 1 ? "" : "s"}. ${nTick} ${nTick === 1 ? "is" : "are"} ticked.`, "font-weight:600"));
  const plan = (sess.plans || []).find(p => S.plan && p.map_id === S.plan.id) || (sess.plans || [])[0];
  const shapes = plan ? pictureShapes(sess.proposal, plan.t).filter(s => shown.some(r => r.id === s.id)) : [];
  box.appendChild(picture(ctx, S, shapes));
  box.appendChild(MUTED(ctx, "Green: both of Claude's reads agree. Amber: they differ, so look at its shape."));
  const areas = (S.ans.areas || []).map(String);
  box.appendChild(el("datalist", { id: "aiw-areas" }, areas.map(a => el("option", { value: a }))));
  const list = el("div", { "data-aiw": "rows", style: "display:flex;flex-direction:column;gap:6px;margin:8px 0" });
  for (const r of shown) {
    const tick = el("input", { type: "checkbox", "data-aiw": "tick-" + r.id });
    tick.checked = S.ticks.has(r.id);
    tick.addEventListener("change", () => { if (tick.checked) S.ticks.add(r.id); else S.ticks.delete(r.id); rerender(ctx); });
    const name = el("input", { type: "text", list: "aiw-areas", maxlength: "40", "data-aiw": "name-" + r.id,
      style: "flex:0 1 220px;min-width:120px;background:#0a150e;border:1px solid #2d5a3d;border-radius:6px;color:#e2e8f0;padding:3px 6px;font-size:13px" });
    name.value = r.name;
    if (r.his || S.busy) name.disabled = true;
    name.addEventListener("change", () => { const v = String(name.value || "").trim(); if (v && v !== r.name) edit(ctx, S, { op: "space", space: r.id, name: v }); });
    const chipText = r.his ? "your room" : !r.sure ? "Claude saw this one differently twice: look at its shape"
      : r.matched ? "matches your Home Assistant room" : "new room, only in PadSpan";
    const line = el("div", { style: "display:flex;gap:8px;align-items:center;flex-wrap:wrap" }, [tick, name,
      el("span", { "data-aiw": "chip-" + r.id, style: `font-size:11px;color:${r.sure ? "#94a3b8" : "#f59e0b"}` }, chipText)]);
    if (r.his && r.flagged) line.appendChild(btn(ctx, "Ask Claude to look again", async () => {
      try { take(S, await ws(ctx, { type: "padspan_ha/plan_build_rooms_read_again", session: sess.id, rev: sess.rev, room: r.id.slice(5), via: VIA })); S.screen = "rooms_read"; }
      catch (e) { S.msg = codeWords(e && e.code); }
      rerender(ctx);
    }, { attrs: { "data-aiw": "again-" + r.id } }));
    const item = el("div", { style: "padding:6px 8px;border:1px solid #1b3526;border-radius:6px" }, [line]);
    if (!r.his && !r.matched) {
      const ha = el("input", { type: "checkbox", "data-aiw": "ha-" + r.id });
      ha.checked = S.ha.has(r.id);
      ha.addEventListener("change", () => { if (ha.checked) S.ha.add(r.id); else S.ha.delete(r.id); rerender(ctx); });
      item.appendChild(el("label", { style: "display:flex;gap:6px;align-items:flex-start;font-size:12px;color:#94a3b8;line-height:1.45;margin:4px 0 0 22px" }, [ha,
        el("span", {}, ["Also add this room to Home Assistant. Undo here takes the room out of PadSpan but leaves the area in Home Assistant; remove it there on the ",
          haLink(ctx, HA_AREAS_PATH, "Areas page", "ha_areas"), "."])]));
    }
    list.appendChild(item);
  }
  box.appendChild(list);
  const small = rows.filter(r => r.small);
  if (small.length) box.appendChild(row(ctx, [MUTED(ctx, `Small spaces (${small.length}): closets and halls, left out.`),
    btn(ctx, S.showSmall ? "Hide" : "Show", () => { S.showSmall = !S.showSmall; rerender(ctx); }, { attrs: { "data-aiw": "small" } })]));
  const used = new Set(rows.map(r => String(r.name).toLowerCase()));
  const left = areas.filter(a => !used.has(a.toLowerCase())).slice(0, 8);
  if (left.length) box.appendChild(MUTED(ctx, `Home Assistant rooms not on this plan: ${left.join(", ")}. Pick one in a row above, or draw it later in Mapping.`));
  box.appendChild(row(ctx, [MUTED(ctx, "Tap two rooms on the plan to join them into one (an open kitchen and dining room, say)."),
    btn(ctx, "Join into one", () => { if (S.sel.size >= 2 && !S.busy) edit(ctx, S, { op: "merge", parts: [...S.sel] }); }, { disabled: S.sel.size < 2 || S.busy, attrs: { "data-aiw": "join" } })]));
  if (S.fail) box.appendChild(failBlock(ctx, S, S.fail));
  const n = [...S.ticks].filter(id => rows.some(r => r.id === id)).length;
  box.appendChild(row(ctx, [btn(ctx, S.busy ? "Saving…" : `Save ${n} room${n === 1 ? "" : "s"} (experimental)`, () => save(ctx, S),
    { primary: true, disabled: !n || S.busy, attrs: { "data-aiw": "save" } }), MUTED(ctx, "A backup is taken first. One Undo takes it all back.")]));
}

function savedScreen(ctx, S, box) {
  const { el } = ctx.helpers, st = ctx.state;
  const sess = S.ans && S.ans.session;
  const fid = (sess && sess.floor_id) || (S.plan && S.plan.floor_id);
  if (S.undone) {
    box.appendChild(P(ctx, `${S.undone.n} room${S.undone.n === 1 ? "" : "s"} taken back.` +
      (S.undone.skipped ? ` ${S.undone.skipped} ${S.undone.skipped === 1 ? "was" : "were"} left, because ${S.undone.skipped === 1 ? "it" : "they"} changed since or a receiver was put in.` : "")));
    return;
  }
  const n = S.done ? S.done.saved : Object.keys((sess && sess.saved) || {}).length;
  box.appendChild(P(ctx, `✓ ${n} room${n === 1 ? "" : "s"} saved on ${floorName(st, fid)}.`, "font-weight:600;color:#a7f3d0"));
  const res = (S.done && S.done.areas) || {}, names = (S.done && S.done.names) || {};
  const made = Object.keys(res).filter(k => res[k] === "created").map(k => names[k]);
  const failed = Object.keys(res).filter(k => res[k] === "failed").map(k => names[k]);
  if (made.length) box.appendChild(MUTED(ctx, `Added to Home Assistant's areas: ${made.join(", ")}.`));
  if (failed.length) box.appendChild(row(ctx, [MUTED(ctx, `Couldn't add to Home Assistant: ${failed.join(", ")}. The rooms are saved in PadSpan; add the area yourself on Home Assistant's`),
    haLink(ctx, HA_AREAS_PATH, "Areas page", "ha_areas")]));
  box.appendChild(row(ctx, [P(ctx, "Next: put your Bluetooth receivers on the map, so PadSpan can tell which room each phone is in.", "margin:0"),
    btn(ctx, "Place receivers →", () => { ws(ctx, { type: "padspan_ha/ai_wizard_mark", what: "step", step: "handoff" }).catch(() => {});
      st._aiw = null; ctx.actions.openSetupStep("receivers"); }, { primary: true, attrs: { "data-aiw": "receivers" } })]));
  const roomsOn = new Set(Object.values((st.model && st.model.room_geometry_m) || {}).map(r => r && r.floor_id).filter(Boolean));
  const next = plansOf(st).find(m => m.floor_id !== fid && !roomsOn.has(m.floor_id));
  if (next) box.appendChild(row(ctx, [MUTED(ctx, `${floorName(st, next.floor_id)} has a plan too.`),
    btn(ctx, `Do ${floorName(st, next.floor_id)} next →`, () => { ws(ctx, { type: "padspan_ha/ai_wizard_mark", what: "step", step: "next_floor" }).catch(() => {}); startRead(ctx, S, next); }, { attrs: { "data-aiw": "next-floor" } })]));
  box.appendChild(row(ctx, [MUTED(ctx, "Something wrong?"), btn(ctx, "Undo", () => undo(ctx, S), { disabled: S.busy, attrs: { "data-aiw": "undo" } }),
    MUTED(ctx, "takes back the rooms.")]));
}

export function render(ctx) {
  const { el } = ctx.helpers, st = ctx.state;
  const S = S_of(ctx);
  const root = el("div", { id: "ai-wizard" });
  const card = el("div", { class: "card" });
  const back = btn(ctx, "← Back", () => leave(ctx, S), { attrs: { "data-aiw": "back" } });
  card.appendChild(el("div", { style: "display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:6px" }, [back,
    el("div", { style: "font-weight:700;font-size:16px;color:#52b788" }, ["Let Claude draw your rooms", OFFER.chip(el)]),
    ctx.helpers.helpBtn ? ctx.helpers.helpBtn("ai_wizard") : ""]));
  root.appendChild(card);
  if (st.dataMode !== "live") {
    card.appendChild(P(ctx, "The demo house is showing. The helper works on your own house."));
    return root;
  }
  if (ctx.hass && ctx.hass.user && ctx.hass.user.is_admin === false) {
    card.appendChild(P(ctx, "Only an administrator can use this."));
    return root;
  }
  if (S.screen === null) {
    loadAll(ctx, S);
    card.appendChild(MUTED(ctx, "Loading…"));
    return root;
  }
  if (S.screen === "intro") introScreen(ctx, S, card);
  else if (S.screen === "connect") connectScreen(ctx, S, card);
  else if (S.screen === "rooms_read") readScreen(ctx, S, card);
  else if (S.screen === "rooms_check" && S.ans && S.ans.session && S.ans.session.proposal) checkScreen(ctx, S, card);
  else if (S.screen === "saved") savedScreen(ctx, S, card);
  else if (S.screen === "fail") { const b = failBlock(ctx, S, S.fail || "bad_answer"); if (b) card.appendChild(b); }
  if (S.msg) card.appendChild(el("div", { "data-aiw": "msg", style: "font-size:12px;color:#f59e0b;margin-top:6px" }, S.msg));
  markStep(ctx, S);
  return root;
}
