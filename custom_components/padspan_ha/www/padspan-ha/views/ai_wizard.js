// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
// See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
//
// Let Claude draw your rooms (experimental; design PadspanResearch
// ai-wizard-design-2026-11-10.md, B, C option 2, D, E, G). For a house whose
// plan has no rooms: intro (the trial for a free install, the consent),
// Connect Claude, one measurement when the plan has no scale yet (piece 3:
// plan_build_scale_preview / _save, Measure's own write on the server), the
// rooms read, the rooms check drawn over the plan picture, Save, Done with
// Undo (the rooms, then the scale) and the hand-off to Setup's receivers.
//
// Nothing new on the server's side of the rooms: the read, the edits, the
// save and its undo are Rooms from plans' own commands (ws_plan_ai.py), sent
// with via "wizard" (Live Aboard may be off; names are pre-filled; the
// server says which rows start ticked). The outlines are the Plans tool's
// list (plan_room_shapes.roomShapes), drawn on the picture through the read
// plan's own metres (stack_transform.metresToMapFrac). A focused view with
// one Back; it never changes Basic or Advanced, and on a wall screen no link
// opens a new page (trial_offer.newTabOk).

const V = new URL(import.meta.url).search;
const OFFER = await import(`./ai_wizard_offer.js${V}`);
const TRIAL = await import(`./trial_offer.js${V}`).catch(() => null);
const { roomShapes } = await import(`./plan_room_shapes.js${V}`);
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
  map_not_placed: "This plan's scale isn't set yet, so its rooms can't be read. Measure one thing on it first: both ends of something you know the length of.",
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

/** A plan nobody has measured or placed yet: the helper measures it first (one measurement, the scale screen). */
export function needsScale(state, plan) {
  const tfs = (state.model && state.model.map_transforms) || {};
  return !!(plan && plan.id) && !tfs[plan.id];
}

/** Plans the helper can read, best first: inside the house, with a scale or none at all yet (it measures that one first);
 *  a plan with a scale before one without, then the lowest floor, then the largest picture. */
export function plansOf(state) {
  const tfs = (state.model && state.model.map_transforms) || {};
  const floors = (state.model && state.model.floors) || [];
  const rank = (fid) => { const i = floors.findIndex(f => f && (f.floor_id || f.id) === fid); return i < 0 ? 999 : Number(floors[i].level ?? i); };
  const px = (m) => Number((m.image || {}).width || 0) * Number((m.image || {}).height || 0);
  const unscaled = (m) => (needsScale(state, m) ? 1 : 0);
  return ((state.maps && state.maps.list) || [])
    .filter(m => m && m.id && String(m.floor_id || "") !== "outside" && (!tfs[m.id] || Number(tfs[m.id].scale_x_m) > 0))
    .sort((a, b) => unscaled(a) - unscaled(b) || rank(a.floor_id) - rank(b.floor_id) || px(b) - px(a));
}

/** The house's indoor floors as {id, name}, for "Which floor does this plan show?". */
export function indoorFloors(state) {
  return ((state.model && state.model.floors) || []).map(f => ({ id: f && (f.floor_id || f.id), name: (f && f.name) || "" }))
    .filter(f => f.id && String(f.id).toLowerCase() !== "outside");
}

/** A length as the scale screen says it: whole metres past 100, else one decimal. */
export const metresText = (v) => (Number(v) >= 100 ? String(Math.round(Number(v))) : Number(v).toFixed(1));

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
  if (!st._aiw) st._aiw = { screen: null, info: null, build: null, ans: null, plan: null, ticks: new Set(), ha: new Set(), sel: new Set(), names: {}, root: null,
    sid: null, busy: false, msg: "", fail: null, showSmall: false, ok1: false, ok2: false, done: null, undone: null, timer: null, loading: false, sc: null };
  return st._aiw;
}

/** The scale screen's draft for the chosen plan (kept through every redraw until it is saved): the two ends, the typed
 *  length, the server's last answer about them, the floor picked. A new plan starts a new draft. */
function scaleDraft(S) {
  const id = S.plan && S.plan.id;
  if (!S.sc || S.sc.map_id !== id) S.sc = { map_id: id, pts: [], text: "", pv: null, seq: 0, floor: null, askFloor: false, drag: null, moved: false };
  return S.sc;
}

function stepWord(S) {
  if (S.screen === "intro") return { trial: "trial", consent: "consent" }[introBlock(S.info, S.build)] || "intro";
  return { connect: "connect", scale: "scale_guided", rooms_read: "rooms_read", rooms_check: "rooms_check", saved: "saved" }[S.screen] || null;
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
  for (const id of Object.keys(S.names || {})) if (!rows.has(id)) delete S.names[id];
}

/** A row's name as typed (kept here until Save: a redraw or an answer never takes typing away), else Claude's. */
const nameOf = (S, r) => { const d = (S.names || {})[r.id]; return typeof d === "string" && d.trim() ? d.trim() : r.name; };

/** Draw again and put the cursor back where it was (a name left for the next field: that field keeps its focus). */
function rerenderKeep(ctx, S) {
  const rn = S.root && S.root.getRootNode ? S.root.getRootNode() : null;
  const a = rn && rn.activeElement, key = a && a.getAttribute ? a.getAttribute("data-aiw") : null;
  let pos = null;
  try { if (a && typeof a.selectionStart === "number") pos = [a.selectionStart, a.selectionEnd]; } catch (_) { pos = null; }
  rerender(ctx);
  if (!key || typeof setTimeout !== "function") return;
  setTimeout(() => {
    const n = S.root && S.root.querySelector ? S.root.querySelector(`[data-aiw="${key}"]`) : null;
    if (!n || !n.focus) return;
    n.focus();
    if (pos && n.setSelectionRange) { try { n.setSelectionRange(pos[0], pos[1]); } catch (_) { /* not a text field */ } }
  }, 0);
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

/** The ticks the intro asked for, written before anything else (both switches; Claude chosen). Nothing turned on silently. */
async function consent(ctx, S) {
  const c = claudeState(S.build);
  if (!needsConsent(S.build, c.why)) return;
  const st = ctx.state, set = {};
  if (!(S.build.master && S.build.switch)) Object.assign(set, { ai_plans_enabled: true, ai_plan_build_enabled: true });
  if (c.why === "available_unchosen") Object.assign(set, chooseClaude(st.settings, c.eid));
  const res = await ws(ctx, { type: "padspan_ha/settings_set", ...set });
  if (res && res.settings) st.settings = res.settings;
  if (set.ai_plans_enabled) tel(ctx, "ai_wizard_switch:on");
  if (set.atlas_3d_ai_task_entity) tel(ctx, "ai_wizard_ai:chosen");
  S.build = await ws(ctx, { type: "padspan_ha/plan_build_info", via: VIA }).catch(() => S.build);
}

/** A start that didn't go: its words, its failure screen, or Connect Claude. */
function startFailed(ctx, S, plan, e) {
  const code = e && e.code;
  S.fail = failOfCode(code);
  if (S.fail) { telOnce(ctx, "ai_wizard_fail:" + S.fail); S.screen = "fail"; }
  else if (code === "plan_build_locked") S.screen = "connect";
  else if (code === "map_not_placed" && needsScale(ctx.state, plan)) { S.plan = plan; S.screen = "scale"; S.msg = codeWords(code); }
  else S.msg = codeWords(code);
}

/** From the intro (or Done's next floor): a plan with no scale is measured first, any other goes straight to the read. */
async function begin(ctx, S, plan) {
  if (!needsScale(ctx.state, plan)) { telOnce(ctx, "plan_build_scale:already_set"); return startRead(ctx, S, plan); }
  S.busy = true; S.msg = ""; S.fail = null;
  rerender(ctx);
  try {
    await consent(ctx, S);
    S.plan = plan; S.screen = "scale"; S.done = null; S.undone = null;
    _done.delete("step:scale_guided");
  } catch (e) { startFailed(ctx, S, plan, e); }
  S.busy = false;
  rerender(ctx);
}

async function startRead(ctx, S, plan) {
  S.busy = true; S.msg = ""; S.fail = null;
  rerender(ctx);
  try {
    await consent(ctx, S);
    const r = await ws(ctx, { type: "padspan_ha/plan_build_rooms_start", floor_id: plan.floor_id, map_ids: [plan.id], via: VIA });
    S.plan = plan; S.sid = r.session; S.ans = null; S.ticks = new Set(); S.ha = new Set(); S.sel = new Set(); S.names = {}; S.done = null; S.undone = null;
    S.screen = "rooms_read";
    _done.delete("step:rooms_read"); _done.delete("step:rooms_check"); _done.delete("step:saved");
  } catch (e) { startFailed(ctx, S, plan, e); }
  S.busy = false;
  rerender(ctx);
}

/** What the server makes of the two ends and the typed length (the length understood, the plan's size); the newest answer wins. */
async function scalePreview(ctx, S) {
  const sc = scaleDraft(S), seq = ++sc.seq;
  const text = String(sc.text || "").trim();
  const measures = text ? [{ text, ...(sc.pts.length === 2 ? { p1: sc.pts[0], p2: sc.pts[1] } : {}) }] : [];
  try {
    const pv = await ws(ctx, { type: "padspan_ha/plan_build_scale_preview", map_id: S.plan.id, measures, via: VIA });
    if (seq !== sc.seq) return;
    sc.pv = pv;
    if (pv && pv.floor_known === false && !_done.has("step:floor_pick")) {
      _done.add("step:floor_pick");
      ws(ctx, { type: "padspan_ha/ai_wizard_mark", what: "step", step: "floor_pick", map_id: S.plan.id }).catch(() => {});
    }
  } catch (e) {
    if (seq === sc.seq) S.msg = codeWords(e && e.code);
  }
  rerenderKeep(ctx, S);
}

/** Save the measurement (the server works the scale out again itself), then straight on to the rooms read. */
async function scaleSave(ctx, S) {
  const sc = scaleDraft(S), pv = sc.pv || {};
  if (S.busy || sc.pts.length !== 2 || !pv.sig) return;
  S.busy = true; S.msg = ""; rerender(ctx);
  let r = null;
  try {
    r = await ws(ctx, { type: "padspan_ha/plan_build_scale_save", map_id: S.plan.id, sig: pv.sig, ...(sc.floor ? { floor_id: sc.floor } : {}),
      measures: [{ p1: sc.pts[0], p2: sc.pts[1], text: String(sc.text || "").trim() }], source: "guided", via: VIA });
  } catch (e) {
    r = { ok: false, code: e && e.code, message: codeWords(e && e.code) };
  }
  S.busy = false;
  if (!r || r.ok === false) {
    const code = r && r.code;
    if (code === "backup_failed") telOnce(ctx, "ai_wizard_fail:backup_failed");
    if (code === "floor_unknown") sc.askFloor = true;
    if (code === "plan_changed") { sc.pts = []; sc.pv = null; }
    S.msg = (r && r.message) || codeWords(code);
    rerender(ctx);
    if (code === "plan_changed") scalePreview(ctx, S);
    return;
  }
  const plan = { ...S.plan, floor_id: r.floor_id || S.plan.floor_id };
  S.sc = null;
  if (ctx.actions.modelRefresh) await Promise.resolve(ctx.actions.modelRefresh()).catch(() => {});
  if (ctx.actions.mapsRefresh && plan.floor_id !== S.plan.floor_id) await Promise.resolve(ctx.actions.mapsRefresh()).catch(() => {});
  return startRead(ctx, S, plan);
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
  let names = {};
  try {
    for (const row of rowsOf(S.ans)) {
      const typed = nameOf(S, row);
      if (row.his || !items.includes(row.id) || typed === row.name) continue;
      try {
        take(S, await ws(ctx, { type: "padspan_ha/plan_build_rooms_edit", session: S.ans.session.id, rev: S.ans.session.rev, via: VIA, op: "space", space: row.id, name: typed }));
      } catch (e) {
        if (e && e.code === "name_taken") { S.msg = `Another room is already called "${typed}". Give one of them another name.`; S.busy = false; rerender(ctx); return; }
        throw e;
      }
      delete S.names[row.id];
    }
    names = Object.fromEntries(rowsOf(S.ans).map(r => [r.id, r.name]));
    const now = S.ans.session;
    const r = await ws(ctx, { type: "padspan_ha/plan_build_rooms_commit", session: now.id, rev: now.rev, items, via: VIA,
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
    // The rooms first, then the plan's scale if this helper set it (design E.5): the server takes the scale back only
    // while nothing in metres was added since, and otherwise says why (it stays, like any measurement).
    const r = await ws(ctx, { type: "padspan_ha/plan_build_rooms_undo", session: S.sid, via: VIA });
    S.undone = { n: Number(r && r.undone) || 0, skipped: ((r && r.skipped) || []).length, scale: null };
    OFFER.forget();
    const mid = (S.plan && S.plan.id) || ((((S.ans && S.ans.session) || {}).plans || [])[0] || {}).map_id;
    if (mid) {
      const u = await ws(ctx, { type: "padspan_ha/plan_build_scale_undo", map_id: mid, via: VIA }).catch(() => null);
      if (u && u.ok) { S.undone.scale = "back"; if (ctx.actions.modelRefresh) await Promise.resolve(ctx.actions.modelRefresh()).catch(() => {}); }
      else if (u && u.code && u.code !== "nothing_to_undo") S.undone.scale = u.message || codeWords(u.code);
    }
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
  const measure = needsScale(st, S.plan);
  box.appendChild(P(ctx, measure ? "Three steps, a few minutes:" : "Two steps, a few minutes:"));
  box.appendChild(el("ol", { "data-aiw": "steps", style: "font-size:13px;color:#cbd5e1;line-height:1.55;margin:4px 0 4px 18px;padding:0" }, [
    ...(measure ? [el("li", {}, "You measure one thing on your plan: click both ends of something you know the length of, and type its length. That gives the plan its size.")] : []),
    el("li", {}, "Claude finds the rooms on your plan and their names. Rooms that match your Home Assistant rooms get their names."),
    el("li", {}, "You tick the rooms to keep and press Save. A backup is taken first; one Undo takes it all back."),
  ]));
  if (S.plan && !measure) box.appendChild(MUTED(ctx, "✓ This plan's scale is already set."));
  if (!plans.length) {
    box.appendChild(P(ctx, "No floor plan was found. Add one in Setup first."));
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
  box.appendChild(row(ctx, [btn(ctx, S.busy ? "Starting…" : measure ? "Next: measure one thing →" : "Read my plan →",
    () => { if (ready && !S.busy && S.plan) begin(ctx, S, S.plan); }, { primary: true, disabled: !ready || S.busy || !S.plan, attrs: { "data-aiw": "start" } })]));
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
  box.appendChild(row(ctx, [MUTED(ctx, "Step-by-step guide with pictures, kept up to date:"), ext(ctx, GUIDE_URL, "Connect Claude for PadSpan ↗", "guide")]));
  box.appendChild(row(ctx, [again]));
}

function readScreen(ctx, S, box) {
  const sess = S.ans && S.ans.session;
  const pr = (sess && sess.progress) || {};
  box.appendChild(P(ctx, "Claude is reading your plan for its rooms, twice, to check itself… (1–3 minutes). " +
    "You can leave this page; it carries on. Come back here from the Overview or Setup."));
  if (pr.step) box.appendChild(MUTED(ctx, `Now: ${pr.step === "measure" ? "putting the rooms together" : pr.step}.`));
  poll(ctx, S);
}

/** The chosen plan's picture with a layer over it, 1000 units across and H down: as wide as its column, but never
 *  taller than most of the screen, so an upright plan stays whole, beside its list. */
function planFrame(ctx, S, layerStyle = "") {
  const { el } = ctx.helpers, st = ctx.state;
  const map = ((st.maps && st.maps.list) || []).find(m => S.plan && m.id === S.plan.id);
  const img = map && ctx.helpers.mapImageUrl ? ctx.helpers.mapImageUrl(map) : null;
  const w = Number((map && map.image && map.image.width) || 1000), h = Number((map && map.image && map.image.height) || 750);
  const pic = el("div", { "data-aiw": "picture",
    style: `position:relative;width:min(100%, calc(72vh * ${w} / ${h}));aspect-ratio:${w}/${h};background:#0f1a12;border-radius:6px;overflow:hidden;margin:8px 0` });
  if (img) pic.appendChild(el("img", { src: img, alt: "", style: "position:absolute;left:0;top:0;width:100%;height:100%;object-fit:fill;opacity:.85" }));
  const layer = el("div", { style: "position:absolute;left:0;top:0;width:100%;height:100%;" + layerStyle });
  pic.appendChild(layer);
  return { pic, layer, H: Math.round(1000 * h / w) };
}

function picture(ctx, S, shapes) {
  const { esc } = ctx.helpers;
  const { pic, layer, H } = planFrame(ctx, S);
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
    svg += `<text x="${cx.toFixed(1)}" y="${cy.toFixed(1)}" text-anchor="middle" font-size="30" font-weight="600" fill="#ffffff" stroke="#000000" stroke-width="5" paint-order="stroke" pointer-events="none">${esc(s.name || "")}</text>`;
  }
  svg += "</svg>";
  layer.innerHTML = svg;
  layer.addEventListener("click", (e) => {
    const id = e && e.target && e.target.getAttribute ? e.target.getAttribute("data-id") : null;
    if (!id) return;
    if (S.sel.has(id)) S.sel.delete(id); else S.sel.add(id);
    rerender(ctx);
  });
  return pic;
}

/** The two ends on the plan: a tap puts the first, then the second; after that a tap moves the nearer one, and either
 *  can be dragged (mouse, pen or finger: pointer events, no page scroll while dragging). */
function measurePicture(ctx, S) {
  const sc = scaleDraft(S);
  const { pic, layer, H } = planFrame(ctx, S, "cursor:crosshair;touch-action:none");
  const xy = (p) => [(p[0] * 1000).toFixed(1), (p[1] * H).toFixed(1)];
  let svg = `<svg viewBox="0 0 1000 ${H}" preserveAspectRatio="none" style="position:absolute;left:0;top:0;width:100%;height:100%">`;
  if (sc.pts.length === 2) {
    const [a, b] = sc.pts.map(xy);
    svg += `<line data-aiw-line="1" x1="${a[0]}" y1="${a[1]}" x2="${b[0]}" y2="${b[1]}" stroke="#000000" stroke-width="9" stroke-opacity=".5"/>` +
      `<line data-aiw-line="2" x1="${a[0]}" y1="${a[1]}" x2="${b[0]}" y2="${b[1]}" stroke="#f59e0b" stroke-width="5"/>`;
  }
  sc.pts.forEach((p, i) => {
    const [x, y] = xy(p);
    svg += `<circle data-pt="${i}" cx="${x}" cy="${y}" r="16" fill="#f59e0b" fill-opacity=".9" stroke="#ffffff" stroke-width="4" style="cursor:grab"/>` +
      `<text x="${x}" y="${(Number(y) - 24).toFixed(1)}" text-anchor="middle" font-size="28" font-weight="700" fill="#ffffff" stroke="#000000" stroke-width="5" paint-order="stroke" pointer-events="none">${i + 1}</text>`;
  });
  svg += "</svg>";
  layer.innerHTML = svg;
  layer.setAttribute("data-aiw", "measure");
  const frac = (e) => {
    const r = layer.getBoundingClientRect();
    if (!r || !r.width || !r.height) return null;
    return [Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)), Math.max(0, Math.min(1, (e.clientY - r.top) / r.height))].map(v => Math.round(v * 10000) / 10000);
  };
  layer.addEventListener("click", (e) => {
    if (sc.moved) { sc.moved = false; return; }                     // the end of a drag, not a tap
    const p = e && frac(e);
    if (!p) return;
    if (sc.pts.length < 2) sc.pts.push(p);
    else {
      const d = (q) => (q[0] - p[0]) ** 2 + (q[1] - p[1]) ** 2;
      sc.pts[d(sc.pts[0]) <= d(sc.pts[1]) ? 0 : 1] = p;
    }
    scalePreview(ctx, S);
    rerenderKeep(ctx, S);
  });
  layer.addEventListener("pointerdown", (e) => {
    const i = e && e.target && e.target.getAttribute ? e.target.getAttribute("data-pt") : null;
    if (i === null || i === undefined) return;
    sc.drag = Number(i);
    sc.moved = false;
    if (e.preventDefault) e.preventDefault();
    try { if (layer.setPointerCapture && e.pointerId !== undefined) layer.setPointerCapture(e.pointerId); } catch (_) { /* not capturable */ }
  });
  layer.addEventListener("pointermove", (e) => {
    if (sc.drag === null) return;
    const p = frac(e);
    if (!p) return;
    sc.pts[sc.drag] = p;
    sc.moved = true;
    // Moved in place while dragging (a redraw would drop the pointer); the screen is drawn again when it is let go.
    const c = layer.querySelector ? layer.querySelector(`circle[data-pt="${sc.drag}"]`) : null;
    const [x, y] = xy(p);
    if (c && c.setAttribute) { c.setAttribute("cx", x); c.setAttribute("cy", y); }
    for (const k of ["1", "2"]) {
      const l = layer.querySelector ? layer.querySelector(`line[data-aiw-line="${k}"]`) : null;
      if (l && l.setAttribute) { l.setAttribute(sc.drag === 0 ? "x1" : "x2", x); l.setAttribute(sc.drag === 0 ? "y1" : "y2", y); }
    }
  });
  const drop = () => {
    if (sc.drag === null) return;
    sc.drag = null;
    scalePreview(ctx, S);
    rerenderKeep(ctx, S);
  };
  layer.addEventListener("pointerup", drop);
  layer.addEventListener("pointercancel", drop);
  return pic;
}

/** The plan has no scale: one measurement the person makes (design B screen 3's fallback; E has the save). */
function scaleScreen(ctx, S, box) {
  const { el } = ctx.helpers, st = ctx.state;
  const sc = scaleDraft(S), pv = sc.pv;
  telOnce(ctx, "plan_build_scale:guided");
  if (!pv && !sc.seq) scalePreview(ctx, S);                      // the picture's signature, its floor, whether it may be measured here
  box.appendChild(P(ctx, "Click both ends of something you know the length of (a wall, a doorway, the whole house), then type its length."));
  if (pv && pv.stop) {
    box.appendChild(P(ctx, pv.stop_message || codeWords(pv.stop), "color:#f59e0b"));
    if (pv.stop === "already_placed") box.appendChild(row(ctx, [btn(ctx, "Find the rooms →", () => startRead(ctx, S, S.plan), { primary: true, attrs: { "data-aiw": "scale-skip" } })]));
    else box.appendChild(row(ctx, [btn(ctx, "Draw them myself", () => act(ctx, S, "by_hand"), { attrs: { "data-aiw": "scale-by-hand" } })]));
    return;
  }
  const cols = el("div", { "data-aiw": "scale", style: "display:flex;gap:16px;flex-wrap:wrap;align-items:flex-start" });
  const side = el("div", { style: "flex:1 1 300px;min-width:260px" });
  cols.appendChild(el("div", { style: "flex:1 1 380px;min-width:280px;max-width:900px" }, [measurePicture(ctx, S),
    MUTED(ctx, sc.pts.length < 2 ? `Click the ${sc.pts.length ? "other" : "first"} end on the plan.` : "Drag an end, or click near it, to move it.")]));
  cols.appendChild(side);
  box.appendChild(cols);
  const len = el("input", { type: "text", maxlength: "40", "data-aiw": "scale-length", placeholder: "e.g. 4.2 m or 13' 9\"",
    style: "flex:0 1 180px;min-width:120px;background:#0a150e;border:1px solid #2d5a3d;border-radius:6px;color:#e2e8f0;padding:4px 8px;font-size:14px" });
  len.value = sc.text;
  if (S.busy) len.disabled = true;
  // Typing stays here (S.sc) through every redraw; the server says what it understood.
  len.addEventListener("input", () => { sc.text = String(len.value || ""); scalePreview(ctx, S); });
  const m = pv && Array.isArray(pv.metres) && pv.metres[0];
  const said = !sc.text.trim() ? "" : m ? `= ${Number(m).toFixed(2)} m` : (pv && pv.invalid) || "";
  side.appendChild(el("label", { style: "display:block;font-size:13px;color:#cbd5e1;margin:8px 0 4px" }, "Its length:"));
  side.appendChild(row(ctx, [len, el("span", { "data-aiw": "scale-understood", style: `font-size:13px;color:${m ? "#a7f3d0" : "#f59e0b"}` }, said)], "margin:0 0 8px"));
  const sized = !!(m && sc.pts.length === 2 && pv && pv.across_m);
  if (sized) {
    side.appendChild(P(ctx, `Your plan will be ${metresText(pv.across_m)} m across and ${metresText(pv.down_m)} m down.`, "font-weight:600"));
    if (pv.odd) {
      const big = pv.across_m > 100 || pv.across_m < 2 ? ["across", pv.across_m] : ["down", pv.down_m];
      side.appendChild(el("div", { "data-aiw": "scale-odd", style: "font-size:12px;color:#f59e0b;line-height:1.5;margin:4px 0" },
        `That makes your plan ${metresText(big[1])} m ${big[0]}. Is the number right? You can change it, or save it as it is.`));
    }
  }
  const floors = indoorFloors(st);
  const askFloor = (pv && pv.floor_known === false) || sc.askFloor;
  if (askFloor) {
    side.appendChild(P(ctx, "Which floor does this plan show?"));
    side.appendChild(row(ctx, floors.map(f => btn(ctx, f.name || f.id, () => { sc.floor = f.id; rerender(ctx); },
      { primary: sc.floor === f.id, attrs: { "data-aiw": "floor-" + f.id } }))));
  }
  const ready = sized && (!askFloor || !!sc.floor) && !S.busy;
  side.appendChild(row(ctx, [btn(ctx, S.busy ? "Saving…" : "Save and find the rooms →", () => { if (ready) scaleSave(ctx, S); },
    { primary: true, disabled: !ready, attrs: { "data-aiw": "scale-save" } })]));
  side.appendChild(MUTED(ctx, "A backup is taken first. Undo on the last screen takes the rooms and this measurement back."));
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
  const shapes = plan ? pictureShapes(sess.proposal, plan.t).filter(s => shown.some(r => r.id === s.id))
    .map(s => { const r = shown.find(x => x.id === s.id); return r ? { ...s, name: nameOf(S, r) } : s; }) : [];
  const areas = (S.ans.areas || []).map(String), isArea = (n) => areas.some(a => a.toLowerCase() === String(n).toLowerCase());
  if (!rows.length && !f) {
    box.appendChild(P(ctx, "Claude didn't find rooms it could use on this plan. You can ask it to read the plan again, or draw the rooms yourself."));
    box.appendChild(row(ctx, [btn(ctx, "Read it again", () => act(ctx, S, "again"), { primary: true, disabled: S.busy, attrs: { "data-aiw": "none-again" } }),
      btn(ctx, "Draw them myself", () => act(ctx, S, "by_hand"), { attrs: { "data-aiw": "none-by-hand" } })]));
    return;
  }
  // The plan beside its list on a wide screen, above it on a narrow one.
  const cols = el("div", { "data-aiw": "check", style: "display:flex;gap:16px;flex-wrap:wrap;align-items:flex-start" });
  const side = el("div", { style: "flex:1 1 340px;min-width:280px" });
  cols.appendChild(el("div", { style: "flex:1 1 380px;min-width:280px;max-width:900px" }, [picture(ctx, S, shapes),
    MUTED(ctx, "Green: both of Claude's reads agree. Amber: they differ, so look at its shape.")]));
  cols.appendChild(side);
  box.appendChild(cols);
  box.appendChild(el("datalist", { id: "aiw-areas" }, areas.map(a => el("option", { value: a }))));
  const list = el("div", { "data-aiw": "rows", style: "display:flex;flex-direction:column;gap:6px;margin:8px 0" });
  let anyHa = false;
  for (const r of shown) {
    const tick = el("input", { type: "checkbox", "data-aiw": "tick-" + r.id });
    tick.checked = S.ticks.has(r.id);
    tick.addEventListener("change", () => { if (tick.checked) S.ticks.add(r.id); else S.ticks.delete(r.id); rerender(ctx); });
    const name = el("input", { type: "text", list: "aiw-areas", maxlength: "40", "data-aiw": "name-" + r.id,
      style: "flex:0 1 220px;min-width:120px;background:#0a150e;border:1px solid #2d5a3d;border-radius:6px;color:#e2e8f0;padding:3px 6px;font-size:13px" });
    name.value = typeof S.names[r.id] === "string" ? S.names[r.id] : r.name;
    if (r.his || S.busy) name.disabled = true;
    // Typing stays here until Save (S.names): no answer or redraw takes it away, and Save sends the names first.
    name.addEventListener("input", () => { S.names[r.id] = String(name.value || ""); });
    name.addEventListener("change", () => { if (typeof setTimeout === "function") setTimeout(() => rerenderKeep(ctx, S), 0); else rerender(ctx); });
    const typed = nameOf(S, r), matched = typed === r.name ? r.matched : isArea(typed);
    const chipText = r.his ? "your room" : !r.sure ? "Claude saw this one differently twice: look at its shape"
      : matched ? "matches your Home Assistant room" : "new room, only in PadSpan";
    const line = el("div", { style: "display:flex;gap:8px;align-items:center;flex-wrap:wrap" }, [tick, name,
      el("span", { "data-aiw": "chip-" + r.id, style: `font-size:11px;color:${r.sure ? "#94a3b8" : "#f59e0b"}` }, chipText)]);
    if (r.his && r.flagged) line.appendChild(btn(ctx, "Ask Claude to look again", async () => {
      try { take(S, await ws(ctx, { type: "padspan_ha/plan_build_rooms_read_again", session: sess.id, rev: sess.rev, room: r.id.slice(5), via: VIA })); S.screen = "rooms_read"; }
      catch (e) { S.msg = codeWords(e && e.code); }
      rerender(ctx);
    }, { attrs: { "data-aiw": "again-" + r.id } }));
    const item = el("div", { style: "padding:6px 8px;border:1px solid #1b3526;border-radius:6px" }, [line]);
    if (!r.his && !matched) {
      const ha = el("input", { type: "checkbox", "data-aiw": "ha-" + r.id });
      ha.checked = S.ha.has(r.id);
      ha.addEventListener("change", () => { if (ha.checked) S.ha.add(r.id); else S.ha.delete(r.id); rerender(ctx); });
      // Said once, under the list (HA_NOTE below): a row keeps to a few words.
      item.appendChild(el("label", { style: "display:flex;gap:6px;align-items:center;font-size:12px;color:#94a3b8;margin:4px 0 0 22px" }, [ha,
        el("span", {}, "Also add this room to Home Assistant")]));
      anyHa = true;
    }
    // The row's room lights up on the plan while the pointer is on it.
    item.addEventListener("mouseenter", () => { const g = cols.querySelector(`polygon[data-id="${r.id}"]`); if (g) { g.setAttribute("stroke", "#ffffff"); g.setAttribute("stroke-width", "6"); } });
    item.addEventListener("mouseleave", () => { const g = cols.querySelector(`polygon[data-id="${r.id}"]`); if (g) { const pk = S.sel.has(r.id); g.setAttribute("stroke", pk ? "#ffffff" : (r.sure ? "#52b788" : "#f59e0b")); g.setAttribute("stroke-width", pk ? "5" : "3"); } });
    list.appendChild(item);
  }
  side.appendChild(list);
  if (anyHa) side.appendChild(el("div", { "data-aiw": "ha-note", style: "font-size:12px;color:#94a3b8;line-height:1.5;margin:2px 0 8px" }, [
    "\"Also add this room to Home Assistant\" makes an area there with that name, so Home Assistant's own pages and motion sensors can use the room. ",
    "Undo here takes the room out of PadSpan but leaves the area in Home Assistant; remove it there on the ", haLink(ctx, HA_AREAS_PATH, "Areas page", "ha_areas"), "."]));
  const small = rows.filter(r => r.small);
  if (small.length) side.appendChild(row(ctx, [MUTED(ctx, `Small spaces (${small.length}): closets and halls, left out.`),
    btn(ctx, S.showSmall ? "Hide" : "Show", () => { S.showSmall = !S.showSmall; rerender(ctx); }, { attrs: { "data-aiw": "small" } })]));
  const used = new Set(rows.map(r => String(nameOf(S, r)).toLowerCase()));
  const left = areas.filter(a => !used.has(a.toLowerCase())).slice(0, 8);
  if (left.length) side.appendChild(MUTED(ctx, `Home Assistant rooms not on this plan: ${left.join(", ")}. Pick one in a row above, or draw it later in Mapping.`));
  side.appendChild(row(ctx, [MUTED(ctx, "Tap two rooms on the plan to join them into one (an open kitchen and dining room, say)."),
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
    if (S.undone.scale === "back") box.appendChild(MUTED(ctx, "The measurement this helper made is taken back too: the plan has no scale again."));
    else if (S.undone.scale) box.appendChild(el("div", { "data-aiw": "scale-kept", style: "font-size:12px;color:#f59e0b;line-height:1.5;margin:6px 0" }, S.undone.scale));
    if (Object.values((S.done && S.done.areas) || {}).includes("created")) box.appendChild(row(ctx, [
      MUTED(ctx, "The areas added to Home Assistant are still there. Remove them on Home Assistant's"), haLink(ctx, HA_AREAS_PATH, "Areas page", "ha_areas")]));
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
    btn(ctx, `Do ${floorName(st, next.floor_id)} next →`, () => { ws(ctx, { type: "padspan_ha/ai_wizard_mark", what: "step", step: "next_floor" }).catch(() => {}); begin(ctx, S, next); }, { attrs: { "data-aiw": "next-floor" } })]));
  box.appendChild(row(ctx, [MUTED(ctx, "Something wrong?"), btn(ctx, "Undo", () => undo(ctx, S), { disabled: S.busy, attrs: { "data-aiw": "undo" } }),
    MUTED(ctx, "takes back the rooms, and the measurement if this helper made it. Later, the rooms' Undo is in Settings → AI.")]));
}

export function render(ctx) {
  const { el } = ctx.helpers, st = ctx.state;
  const S = S_of(ctx);
  const root = el("div", { id: "ai-wizard" });
  S.root = root;                                    // where rerenderKeep puts the cursor back
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
  else if (S.screen === "scale" && S.plan) scaleScreen(ctx, S, card);
  else if (S.screen === "rooms_read") readScreen(ctx, S, card);
  else if (S.screen === "rooms_check" && S.ans && S.ans.session && S.ans.session.proposal) checkScreen(ctx, S, card);
  else if (S.screen === "saved") savedScreen(ctx, S, card);
  else if (S.screen === "fail") { const b = failBlock(ctx, S, S.fail || "bad_answer"); if (b) card.appendChild(b); }
  if (S.msg) card.appendChild(el("div", { "data-aiw": "msg", style: "font-size:12px;color:#f59e0b;margin-top:6px" }, S.msg));
  markStep(ctx, S);
  return root;
}
