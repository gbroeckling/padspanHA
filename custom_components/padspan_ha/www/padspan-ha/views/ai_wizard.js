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
const { isOutdoorFloorId } = await import(`./iso_lights.js${V}`);
// "Put my receivers in their rooms": Setup's one copy, on the Done screen too (owner, 2026-11-12).
const SETUP = await import(`./setup.js${V}`).catch(() => null);

export const VIA = "wizard";
export const CONSOLE_URL = "https://platform.claude.com/";
// The guide, the model words and Claude's case are views/ai_wizard_offer.js's (one copy; Settings → AI says the same).
export const GUIDE_URL = OFFER.GUIDE_URL;
export const HA_ADD_PATH = "/config/integrations/dashboard/add?domain=anthropic";
export const HA_ANTHROPIC_PATH = "/config/integrations/integration/anthropic";
export const HA_AREAS_PATH = "/config/areas/dashboard";

// The intro (2026-11-12): what happens, what it costs in reads, that nothing is saved before Save; its Start is the one
// consent (no Settings switch is ticked for the helper).
export const START = "Draw my rooms →";
export const LEAVES = "Pressing Draw my rooms sends your floor plan picture to Claude, through Home Assistant's Anthropic integration and " +
  "your Anthropic account. Nothing else from your house is sent: no people, devices or positions.";
export const COST = "Claude reads your plan twice to find its rooms, after one tiny read with no plan in it that checks your account " +
  "has credit. Anthropic charges your Anthropic account for each read; the Anthropic Console's usage page shows what they cost.";
/** The same for a plan with no scale yet: the person measures it (owner, 2026-11-12: measure first; Claude reads the scale
 *  only when asked to). */
export const COST_SCALE = COST + " Claude looks for a measurement printed on your plan only if you ask it to (up to three reads more).";
export const SAVED_ONLY = "Nothing is saved until you press Save. A backup is taken first, and one Undo takes it all back.";
// The scale screen (owner, 2026-11-12: measure first, Claude optional). A reading of Claude's is offered only when it is
// double-checked (across and down read and agreeing: plan_ai.scale_proposal's `checked`), as "Use it"; never one that isn't.
export const SCALE_ASK = "Claude can look for a measurement printed on your plan: up to three reads, charged to your Anthropic account.";
export const SCALE_NONE = "Claude found no measurement printed on this plan that it could read.";
export const SCALE_UNUSABLE = "Claude's answers couldn't be used for this plan.";
export const SCALE_UNCHECKED = "Claude found a measurement but couldn't double-check it across and down, so it isn't offered.";
/** Under the scale screen's one Save: what it does, then what happens next. */
export const SCALE_SAVE_SAYS = "Save keeps this as your plan's scale, then Claude reads the plan for its rooms (two reads, 1–3 minutes). " +
  "A backup is taken first. Undo on the last screen takes the rooms and this scale back.";
/** The same after "Check the scale" (review 2026-11-12: it said two reads while the notice said it costs nothing). */
export const SCALE_SAVE_RESCALE = "Save keeps this as your plan's scale, then the same rooms are drawn again at it: nothing is read again, " +
  "nothing is paid for. A backup is taken first.";
export const SCALE_DIFFERS_PCT = 5;     // the person's line and Claude's double-checked reading this far apart: said, never refused
const MODEL_WORDS = OFFER.MODEL_WORDS;
// Connect Claude, honest about the whole path (owner, 2026-11-12; the guide's "ten steps in three places").
export const CONNECT_NEED = "What you need: an Anthropic account with credit on it (Anthropic charges it for each read) and Home Assistant's " +
  "Anthropic integration. About ten steps in the Anthropic Console and Home Assistant, around 15 minutes, once:";
export const CONNECT_HAVE = "Home Assistant's Anthropic integration is set up already, so two steps are left:";
/** While Start checks the Anthropic account before anything is measured or read. */
export const CHECKING = "Checking your Anthropic account with one tiny read (no plan is sent)…";
/** While Claude reads: the way back that is really there (Setup's line, ai_wizard_offer.offerLine, which the rule offers
 *  on the pull surfaces while a read is left part-way: ai_wizard.goes_on). */
export const COME_BACK = "You can leave this page; it carries on. To come back to it, open Mapping, then Setup, and press Carry on →.";

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

export const claudeState = OFFER.claudeState;

/** The intro's block for a starting state: connect (Claude not ready, Pro or not), then trial (free, Claude ready:
 *  owner, 2026-11-12, the trial comes after Claude is connected, pitched on drawing rooms) or no_pro, then start (Pro,
 *  Claude ready, or ready in Home Assistant and chosen by Start, said on the intro). No Settings switch is asked for:
 *  Start, with what is sent and what it costs beside it, is the consent. */
export function introBlock(info, build) {
  const c = claudeState(build).why;
  if (c !== "ok" && c !== "available_unchosen") return "connect";
  if (!info || info.tier !== "pro") return info && info.trial_offerable ? "trial" : "no_pro";
  return "start";
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
  not_found: "That isn't there any more: a plan or a room was removed. Go back and open Let Claude draw your rooms again.",
};
export const codeWords = (code) => CODE_WORDS[code] || "That didn't work. Try again in a moment.";

/** The screen a session belongs on. A session whose rooms were saved is finished: Done while its Undo is there, else
 *  (taken back, here or in Settings → AI) the intro, where the plan is chosen again; never its old check list. */
export function screenOf(ans) {
  const s = ans && ans.session;
  if (!s) return "intro";
  if (s.status === "running") return "rooms_read";
  if (Object.keys(s.saved || {}).length || (s.batches || []).length) return ans.undo && Object.keys(s.saved || {}).length ? "saved" : "intro";
  if (s.proposal) return "rooms_check";
  return failOf(s) ? "fail" : "intro";
}

/** A plan nobody has measured or placed yet: the helper measures it first (one measurement, the scale screen). */
export function needsScale(state, plan) {
  const tfs = (state.model && state.model.map_transforms) || {};
  return !!(plan && plan.id) && !tfs[plan.id];
}

/** Whether a plan's floor has rooms already (ai_wizard.plan_roomed is this rule): rooms drawn on the plan itself, or on
 *  its floor; a plan with no floor never takes another floor's rooms, only those drawn on it (its room_bounds, or a room
 *  whose outline was made from it). */
export function planRoomed(state, m) {
  if (!m) return false;
  if (Object.keys(m.room_bounds || {}).length) return true;
  const geo = Object.values((state.model && state.model.room_geometry_m) || {});
  if (!m.floor_id) return geo.some(r => r && r.source_map_id === m.id);
  return geo.some(r => r && r.floor_id === m.floor_id)
    || ((state.maps && state.maps.list) || []).some(o => o && o.floor_id === m.floor_id && Object.keys(o.room_bounds || {}).length);
}

/** Plans the helper can read, best first: inside the house, with a scale or none at all yet (it measures that one first);
 *  one on a floor with no rooms yet before one on a floor that has them (the next floor after a save), then a plan with
 *  a scale before one without, then the lowest floor, then the largest picture. */
export function plansOf(state) {
  const tfs = (state.model && state.model.map_transforms) || {};
  const floors = (state.model && state.model.floors) || [];
  const rank = (fid) => { const i = floors.findIndex(f => f && (f.floor_id || f.id) === fid); return i < 0 ? 999 : Number(floors[i].level ?? i); };
  const px = (m) => Number((m.image || {}).width || 0) * Number((m.image || {}).height || 0);
  const unscaled = (m) => (needsScale(state, m) ? 1 : 0);
  const done = (m) => (planRoomed(state, m) ? 1 : 0);
  return ((state.maps && state.maps.list) || [])
    .filter(m => m && m.id && !isOutdoorFloorId(m.floor_id) && (!tfs[m.id] || Number(tfs[m.id].scale_x_m) > 0))
    .sort((a, b) => done(a) - done(b) || unscaled(a) - unscaled(b) || rank(a.floor_id) - rank(b.floor_id) || px(b) - px(a));
}

/** The house's indoor floors as {id, name}, for "Which floor does this plan show?". */
export function indoorFloors(state) {
  return ((state.model && state.model.floors) || []).map(f => ({ id: f && (f.floor_id || f.id), name: (f && f.name) || "" }))
    .filter(f => f.id && !isOutdoorFloorId(f.id));
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
    // A printed name given a number the plan doesn't print (Hall 2): another room already has the name (ai_wizard._unique).
    const num = src[id] === "printed" && /^(.*\S) (\d+)$/.exec(name);
    const renamed = num && !(String(s.name || "").match(/\d+/g) || []).includes(num[2]) ? num[1] : null;
    out.push({ id, name, sure: (s.reads || []).length >= 2, matched, small: (w.small || []).includes(id), m2: (w.m2 || {})[id], renamed });
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
    sid: null, busy: false, msg: "", fail: null, showSmall: false, done: null, undone: null, timer: null, loading: false, sc: null,
    scaleSid: null, failFor: null, pending: null };
  return st._aiw;
}

/** The scale screen's draft for the chosen plan (kept through every redraw until it is saved): the two ends and the typed
 *  length, the line that says what Claude found when it was asked, Claude's double-checked reading (offered as "Use it")
 *  and what Use it put down (`used`: saved as Claude's reading while the ends and the length are still those), the
 *  server's last answer and what it was asked (pvFor), the floor picked. A new plan starts a new draft. */
function scaleDraft(S) {
  const id = S.plan && S.plan.id;
  if (!S.sc || S.sc.map_id !== id) {
    S.sc = { map_id: id, read: null, used: null, why: "", heldAsked: false,
      pts: [], text: "", pv: null, pvFor: null, seq: 0, timer: null, paint: null, floor: null, askFloor: false, drag: null, moved: false, zoom: 1, scroll: null };
  }
  return S.sc;
}

/** The measurement as it is now, what the server is asked about: the two ends and the length. */
function scaleAsk(sc) {
  const text = String(sc.text || "").trim();
  return text ? [{ text, ...(sc.pts.length === 2 ? { p1: sc.pts[0].slice(), p2: sc.pts[1].slice() } : {}) }] : [];
}
/** Use it's ends and length, untouched since: saved as Claude's reading (its session, plan_dimension). */
const scaleUsed = (sc) => !!sc.used && JSON.stringify(sc.used.ask) === JSON.stringify(scaleAsk(sc));
/** The server's answer is for the measurements as they are now (Save goes on nothing older). */
const scaleFresh = (sc) => !!sc.pv && !!sc.pvFor && JSON.stringify(sc.pvFor) === JSON.stringify(scaleAsk(sc));
const scaleMetres = (sc) => sc.pv && Array.isArray(sc.pv.metres) && sc.pv.metres[0];
const scaleSized = (sc) => { const a = scaleAsk(sc); return !!(scaleMetres(sc) && sc.pv.across_m && a.length && a.every(m => m.p1 && m.p2)); };
const scaleAskFloor = (sc) => !!((sc.pv && sc.pv.floor_known === false) || sc.askFloor);
/** What decides how the screen is built (a refusal, the floor question, a first answer): when it changes, it is drawn again. */
const scaleShape = (sc) => [!!sc.pv, !!(sc.pv && sc.pv.stop), scaleAskFloor(sc)].join();

function scaleReady(S) {
  const sc = scaleDraft(S);
  return scaleFresh(sc) && scaleSized(sc) && (!scaleAskFloor(sc) || !!sc.floor) && !S.busy;
}

function stepWord(S) {
  if (S.screen === "intro") return { trial: "trial" }[introBlock(S.info, S.build)] || "intro";
  return { connect: "connect", scale_read: "scale_read", scale: "scale_guided", rooms_read: "rooms_read",
    rooms_check: "rooms_check", saved: "saved" }[S.screen] || null;
}

function markStep(ctx, S) {
  const step = stepWord(S);
  if (!step || _done.has("step:" + step)) return;
  _done.add("step:" + step);
  const ids = {};
  if (S.plan) { ids.map_id = S.plan.id; ids.floor_id = S.plan.floor_id; }
  if (S.scaleSid) ids.scale_session = S.scaleSid;
  if (S.sid) ids.rooms_session = S.sid;
  ws(ctx, { type: "padspan_ha/ai_wizard_mark", what: "step", step, ...ids }).catch(() => {});
  OFFER.forget();                                   // Setup's line asks again: Carry on while a read is left part-way
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
      // The plan it was left on is gone (removed, or moved outdoors): nothing of it is picked up; the chooser, said.
      const gone = !!(w.started && w.started.map_id && !plans.some(m => m.id === w.started.map_id));
      if (w.started && !w.finished_day && !w.undone && w.started.at !== "intro" && !_done.has("came_back")) {
        _done.add("came_back");                       // counted by the server (ai_wizard:came_back)
        ws(ctx, { type: "padspan_ha/ai_wizard_mark", what: "came_back" }).catch(() => {});
      }
      S.screen = "intro";
      const at = gone ? null : w.started && w.started.at;
      // A scale check left while measuring (its rooms session still there; a stale record is dropped).
      const rescale = !gone && S.plan && (at === "scale_guided" || needsScale(ctx.state, S.plan)) ? await rescaleAlive(ctx, S, S.plan.id) : null;
      if (rescale === RECHECK_UNKNOWN) {
        S.msg = RECHECK_UNKNOWN_WORDS;
      } else if (rescale) {
        // "Check the scale" left part-way (stored on the server for this plan, whatever else is held): back to measuring;
        // after Save the same rooms come back, drawn again (scaleSave), with no read.
        S.rescale = { map: S.plan.id, sid: rescale };
        await toMeasure(ctx, S);
      } else if (w.started && w.started.scale_session && ["scale_read", "scale_check", "scale_guided"].includes(at)) {
        S.scaleSid = w.started.scale_session;          // Claude's reading, left while it read or while measuring (scale_check: before 2026-11-12)
        await scaleStatus(ctx, S);
      } else if (at === "scale_guided" && S.plan && needsScale(ctx.state, S.plan)) {
        await toMeasure(ctx, S);                         // measuring: back to that, a reading Claude already made offered (never a new one)
      } else if (at === "floor_pick") {
        // Which floor the plan shows: the plan chooser; Draw my rooms then measures again (no new read).
      } else if (!gone && w.started && w.started.rooms_session) {
        S.sid = w.started.rooms_session;
        await status(ctx, S);
      }
      // Nothing to pick up (a session finished, taken back, gone): the intro, on the plan that is next, choosable.
      if (S.screen === "intro") {
        S.sid = null; S.ans = null;
        const open = plans.filter(m => !planRoomed(ctx.state, m));
        if (!S.plan || !open.some(m => m.id === S.plan.id)) S.plan = open[0] || null;
        // Rooms already read for that plan and not saved (the stored step may point elsewhere): their list, never a new read.
        if (S.plan && !gone && !needsScale(ctx.state, S.plan)) await heldRooms(ctx, S, S.plan);
      }
      if (gone) {
        S.gone = true;                                 // said at the top of the intro (introScreen), for one plan or several
        // The stored step points at the next plan now (the server drops the gone plan's readings with it).
        if (S.plan) ws(ctx, { type: "padspan_ha/ai_wizard_mark", what: "step", step: "intro", map_id: S.plan.id }).catch(() => {});
      }
      telOnce(ctx, "ai_wizard_ai:" + (now === "ok" ? "ok" : now));
    }
  } finally {
    S.loading = false;
    rerender(ctx);
  }
}

/** A rooms answer taken in. A session met afresh (opened again, a reload) starts from the ticks the person left on it
 *  (session.picked, kept there by keepTicks), else from the server's; true when they were the person's. */
function take(S, ans) {
  if (!ans) return false;
  const fresh = !S.ans || !S.ans.session || !ans.session || S.ans.session.id !== ans.session.id;
  const had = new Set(((S.ans && S.ans.wizard) || {}).rows || []);
  S.ans = ans;
  const w = ans.wizard || {}, rows = new Set(w.rows || []), picked = fresh && ans.session && ans.session.picked;
  if (fresh) {
    S.ticks = new Set(picked ? picked.ticked || [] : w.ticked || []);
    if (picked) S.ha = new Set(picked.ha || []);
  } else for (const id of w.ticked || []) if (!had.has(id)) S.ticks.add(id);      // a joined room: ticked as offered
  for (const id of [...S.ticks]) if (!rows.has(id)) S.ticks.delete(id);
  for (const id of [...S.ha]) if (!rows.has(id)) S.ha.delete(id);
  for (const id of [...S.sel]) if (!rows.has(id)) S.sel.delete(id);
  for (const id of Object.keys(S.names || {})) if (!rows.has(id)) delete S.names[id];
  return !!picked;
}

/** The ticks as the person left them, kept on the rooms session (the server's "ticks" edit), so Back, coming back or a
 *  reload finds them; a new read is a new session and starts from Claude's own. Nothing waits for it. */
function keepTicks(ctx, S) {
  const sess = S.ans && S.ans.session;
  if (!sess) return;
  ws(ctx, { type: "padspan_ha/plan_build_rooms_edit", session: sess.id, rev: sess.rev, op: "ticks", ticked: [...S.ticks], ha: [...S.ha], via: VIA })
    .catch(() => {});
}

export const NAME_KEEP_MS = 1000;

/** A name kept on the rooms session (the server's "space" edit, a draft: one already taken is said, not counted as a stop;
 *  Save's is). `typed`: the text of the field the event came from, so a field that was replaced can never read as
 *  cleared. While the person is in the field (`left` false: a second after typing stops) it only sends: no redraw, the
 *  field untouched (a phone keyboard keeps its word). When the field is left, the typed copy goes once the session has
 *  it and the list is drawn again. Empty: Claude's name back, sent after any draft still on its way (the server gives its
 *  suggestion back for an empty name). Save and Join wait for it (S.pending). Nothing from a helper that was left. */
function keepName(ctx, S, id, typed, left) {
  if (ctx.state._aiw !== S || S.screen !== "rooms_check") return;    // a timer after Back, or after Save: nothing
  const want = String(typed || "").trim(), row0 = rowsOf(S.ans).find(r => r.id === id);
  if (!S.ans || !S.ans.session || !row0 || row0.his) return;
  S.pending = Promise.resolve(S.pending).then(async () => {
    const now = S.ans && S.ans.session, row = rowsOf(S.ans).find(x => x.id === id);
    if (!now || !row) return;
    const mine = ["typed", "picked_area"].includes((((S.ans && S.ans.wizard) || {}).sources || {})[id]);
    if (want ? want !== row.name : mine) {
      try {
        take(S, await ws(ctx, { type: "padspan_ha/plan_build_rooms_edit", session: now.id, rev: now.rev, via: VIA, op: "space", space: id, name: want, draft: true }));
      } catch (e) {
        S.msg = e && e.code === "name_taken" ? `Another room is already called "${want}". Give one of them another name.` : codeWords(e && e.code);
        await status(ctx, S);
      }
    }
    if (!left) return;
    const got = (rowsOf(S.ans).find(x => x.id === id) || {}).name;
    if (String((S.names || {})[id] ?? "").trim() === want && (!want || got === want)) delete S.names[id];
    if (ctx.state._aiw === S) redrawAfterPress(ctx, S);
  }).catch(() => {});                                             // never leaves Save waiting on a broken chain
}

/** Draw again, but never under a press. A name field left by pressing Save, a tick or Join fires its change (and the
 *  name is kept) between that press and its click: a redraw then replaced the button, and the click was lost (real
 *  panel, 2026-11-11). Under a press the redraw waits until it is let go and its click delivered (render's listeners). */
function redrawAfterPress(ctx, S) {
  if (!S.pressing) { rerenderKeep(ctx, S); return; }
  S.redrawLater = true;
}

/** The press the list's redraw waits for (redrawAfterPress): pointerdown anywhere in the helper; its click is delivered
 *  in the same turn as its pointerup, so the waiting redraw runs one turn later. */
// Let go anywhere ends the press (review 2026-11-12: let go outside the helper left it pressed): one listener on the
// document for the open helper, taken off when it is left (leave).
let _upCtx = null, _up = null;
function watchPress(ctx, S, root) {
  root.addEventListener("pointerdown", () => { S.pressing = true; });
  _upCtx = ctx;
  if (_up || typeof document === "undefined" || !document.addEventListener) return;
  _up = () => {
    const c = _upCtx, s = c && c.state._aiw;
    if (!s) return;
    const go = () => {
      s.pressing = false;
      if (!s.redrawLater) return;
      s.redrawLater = false;
      if (c.state._aiw === s) rerenderKeep(c, s);
    };
    if (typeof setTimeout === "function") setTimeout(go, 0); else go();
  };
  document.addEventListener("pointerup", _up, true);
  document.addEventListener("pointercancel", _up, true);
}
function unwatchPress() {
  if (_up && typeof document !== "undefined" && document.removeEventListener) {
    document.removeEventListener("pointerup", _up, true);
    document.removeEventListener("pointercancel", _up, true);
  }
  _up = null; _upCtx = null;
}

/** A row's name as typed (kept here until the session has it: a redraw or an answer never takes typing away), else Claude's. */
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

/** Measuring for "Check the scale" on this plan: the old scale stays until a new one is saved (scale_replace). */
const rechecking = (S) => !!(S.rescale && S.plan && S.rescale.map === S.plan.id);
/** The rescale record for the plan (the server's: "Check the scale" waiting for the new measurement), or null. */
const rescaleOf = (S, mid) => (((S.info && S.info.wizard) || {}).rescale || {})[mid] || null;

/** Rooms Claude already read for this plan and its picture, finished and not saved (the server's newest for the plan;
 *  second review, 2026-11-12): that list again, said, with reading again as the paid lesser choice. True when there is one. */
async function heldRooms(ctx, S, plan) {
  const ans = await ws(ctx, { type: "padspan_ha/plan_build_rooms_status", map_id: plan.id, via: VIA }).catch(() => null);
  if (!ans || !ans.session || screenOf(ans) !== "rooms_check") return false;
  Object.assign(S, { plan, sid: ans.session.id, ans: null, ticks: new Set(), ha: new Set(), sel: new Set(), names: {}, fail: null, heldFor: plan.id });
  take(S, ans);
  S.screen = "rooms_check";
  // Its plan measured again or lined up since it was read: drawn again at the scale now, from the same reading, and said.
  S.redrawn = ans.reprojected && ans.reprojected.redrawn ? ans.reprojected : null;
  _done.delete("step:rooms_check");                // its step marked again, with this session (Carry on finds it)
  return true;
}
async function status(ctx, S) {
  try {
    // The rooms are drawn again from the same reads only when "Check the scale" asked for it, for this plan and this
    // session (the server's record), never because a plan moved for another reason (review 2026-11-12).
    // Always asked to draw the list again when its plan was measured again or lined up since (no read; the server does
    // it only then, and says so): a held list is never shown, or saved, at the old scale (real panel, 2026-11-12).
    const mid = S.plan && S.plan.id, again = !!(mid && S.sid && rescaleOf(S, mid) === S.sid && !needsScale(ctx.state, S.plan));
    const ans = await ws(ctx, { type: "padspan_ha/plan_build_rooms_status", session: S.sid, via: VIA, ...(S.sid ? { reproject: true } : {}) });
    if (ans.reprojected && ans.reprojected.redrawn) S.redrawn = ans.reprojected;
    if (again) {
      ws(ctx, { type: "padspan_ha/ai_wizard_mark", what: "rescale_done", map_id: mid }).catch(() => {});
      if (S.info && S.info.wizard && S.info.wizard.rescale) delete S.info.wizard.rescale[mid];
      _done.delete("step:rooms_check");             // marked again with this session: reopening the helper finds the list
    }
    const back = take(S, ans);
    const scr = screenOf(ans);
    if (back && scr === "rooms_check") telOnce(ctx, "ai_wizard:edits_back");   // back on the list with their ticks (once a page)
    if (scr !== "intro") S.screen = scr;
    if (scr === "fail" || scr === "rooms_check") {
      const f = failOf(ans.session);
      if (f) telOnce(ctx, "ai_wizard_fail:" + f);
      S.fail = scr === "fail" ? f : null;
      S.failFor = null;
    }
  } catch (e) {
    S.screen = "intro";
  }
}

/** The measuring screen, afresh: no ends, no length, and `why`: the line that says what Claude found when it was asked.
 *  `read`: Claude's double-checked reading, offered as "Use it" (never one that isn't double-checked). */
function toGuided(ctx, S, why = "", read = null) {
  const sc = scaleDraft(S);
  Object.assign(sc, { read, used: null, why, pts: [], text: "", pv: null, pvFor: null, seq: 0, paint: null });
  S.screen = "scale"; S.fail = null; S.failFor = null;
  _done.delete("step:scale_guided");
}

/** The scale step (owner, 2026-11-12: measure first, Claude optional): the measuring screen at once, nothing read. A
 *  reading Claude already made of this plan's picture is asked for (held_only: never a new, paid read) and, if it is
 *  double-checked, offered as "Use it". */
async function toMeasure(ctx, S) {
  toGuided(ctx, S);
  const sc = scaleDraft(S);
  sc.heldAsked = true;
  // A plan whose scale is being checked has a scale: its held reading is asked for as a recheck (third review, 2026-11-12).
  const r = await ws(ctx, { type: "padspan_ha/plan_build_scale_start", map_id: S.plan.id, held_only: true, ...(rechecking(S) ? { recheck: true } : {}), via: VIA }).catch(() => null);
  if (r && r.session && S.sc === sc && !sc.pts.length && !sc.text) {
    S.scaleSid = r.session;
    await scaleStatus(ctx, S);
  }
}

/** Claude's reading of a measurement printed on the plan: still reading, or stopped (the failure's words, its ways on), or
 *  done: the measuring screen, with "Use it" for a double-checked reading and otherwise a line saying what Claude found. */
async function scaleStatus(ctx, S) {
  let ans;
  try {
    ans = await ws(ctx, { type: "padspan_ha/plan_build_scale_status", session: S.scaleSid, via: VIA });
  } catch (e) {
    S.msg = codeWords(e && e.code);
    return;
  }
  const s = ans && ans.session;
  if (!s) { toGuided(ctx, S); return; }
  // The plan has a scale by now (saved here before the rooms read could start, or measured by hand): on to the rooms.
  if (S.plan && !needsScale(ctx.state, S.plan) && !rechecking(S)) { S.screen = "intro"; S.scaleSid = null; return; }
  // A reading of another plan (this one was removed, or moved outdoors, and the helper picked the next): never drawn here.
  if (S.plan && s.map_id && s.map_id !== S.plan.id) { toGuided(ctx, S); return; }
  if (s.status === "running") { S.screen = "scale_read"; return; }
  const f = failOf(s);
  if (f) telOnce(ctx, "ai_wizard_fail:" + f);
  if (f === "bad_answer" || f === "refusal") { toGuided(ctx, S, SCALE_UNUSABLE); return; }
  if (f) { S.fail = f; S.failFor = "scale"; S.screen = "fail"; return; }
  const prop = s.proposal;
  if (!prop || prop.none_found) { toGuided(ctx, S, SCALE_NONE); return; }
  // Only a double-checked reading is offered; one that isn't is said, never shown (its numbers were 19-41 % off in testing).
  const sc = scaleDraft(S);
  if (prop.checked && sc.read && sc.read.sid === s.id) { S.screen = "scale"; return; }    // the same reading: the draft kept
  toGuided(ctx, S, prop.checked ? "" : SCALE_UNCHECKED, prop.checked ? { sid: s.id, ...prop } : null);
}

/** "Use it": the double-checked reading's two ends and its length, put on the measuring screen as if the person had
 *  measured them; they see the line and the close-up of the print before Save. */
function useReading(ctx, S) {
  const sc = scaleDraft(S), r = sc.read, ax = r && r.axes[r.main];
  if (!ax || !Array.isArray(ax.ends_frac)) return;
  sc.pts = ax.ends_frac.map(p => p.slice());
  sc.text = ax.save_text;
  sc.used = { sid: r.sid, ask: scaleAsk(sc) };
  scalePreview(ctx, S);
  rerender(ctx);
}

function poll(ctx, S) {
  if (S.timer || typeof setTimeout !== "function") return;
  S.timer = setTimeout(async () => {
    S.timer = null;
    if (ctx.state.view !== "ai_wizard" || ctx.state._aiw !== S) return;
    if (S.screen === "rooms_read") await status(ctx, S);
    else if (S.screen === "scale_read") await scaleStatus(ctx, S);
    else return;
    rerender(ctx);
  }, 4000);
}

/** Start's one write, said on the intro above it: a Claude Home Assistant has ready becomes PadSpan's AI (the earlier
 *  one its backup). No switch is turned on: the helper's commands need none, and the Plans tool stays as it was. */
async function consent(ctx, S) {
  const c = claudeState(S.build);
  if (c.why !== "available_unchosen") return;
  const st = ctx.state;
  const res = await ws(ctx, { type: "padspan_ha/settings_set", ...chooseClaude(st.settings, c.eid) });
  if (res && res.settings) st.settings = res.settings;
  tel(ctx, "ai_wizard_ai:chosen");
  S.build = await ws(ctx, { type: "padspan_ha/plan_build_info", via: VIA }).catch(() => S.build);
}

/** A start that didn't go: its words, its failure screen, or Connect Claude. */
function startFailed(ctx, S, plan, e) {
  const code = e && e.code;
  S.fail = failOfCode(code);
  if (S.fail) { telOnce(ctx, "ai_wizard_fail:" + S.fail); S.screen = "fail"; }
  else if (code === "plan_build_locked") S.screen = "connect";
  else if (code === "map_not_placed" && needsScale(ctx.state, plan)) { S.plan = plan; S.screen = "scale"; S.msg = codeWords(code); }
  else if (code === "points_on_plan" || code === "no_picture_size") S.msg = (e && e.message) || codeWords(code);    // the save's own words, before a read
  else S.msg = codeWords(code);
}

/** From the intro (or Done's next floor): a plan with no scale is measured first (the measuring screen, nothing read),
 *  any other goes straight to the rooms read. */
async function begin(ctx, S, plan) {
  // A scale check belongs to its own plan and session: any other plan starts without it; this plan's (the server's
  // record, left part-way, its rooms still there) is picked up again: the measuring screen, nothing read.
  S.rescale = null;
  S.gone = false;
  const rs = await rescaleAlive(ctx, S, plan.id);
  if (rs === RECHECK_UNKNOWN) { S.busy = false; S.msg = RECHECK_UNKNOWN_WORDS; rerender(ctx); return; }
  if (rs) {
    S.plan = plan; S.rescale = { map: plan.id, sid: rs }; S.sid = rs; S.sc = null; S.done = null; S.undone = null;
    await toMeasure(ctx, S);
    rerender(ctx);
    return;
  }
  // Rooms Claude already read for this plan and picture, not saved: that list again, never a new read (second review).
  if (!needsScale(ctx.state, plan) && await heldRooms(ctx, S, plan)) { rerender(ctx); return; } S.busy = true; S.msg = ""; S.fail = null; S.failFor = null; rerender(ctx);
  try {
    await consent(ctx, S);
  } catch (e) {
    S.busy = false; S.msg = codeWords(e && e.code); rerender(ctx);
    return;
  }
  S.plan = plan;
  if (!(await checkAccount(ctx, S))) { S.busy = false; rerender(ctx); return; }
  S.busy = false;
  if (!needsScale(ctx.state, plan)) { telOnce(ctx, "plan_build_scale:already_set"); return startRead(ctx, S, plan); }
  S.busy = true; S.scaleSid = null; S.sc = null; S.done = null; S.undone = null;
  await toMeasure(ctx, S);
  S.busy = false;
  rerender(ctx);
}

/** Before the person measures or Claude reads (owner, 2026-11-12): the Anthropic account checked with one tiny read
 *  (ai_wizard_check_claude; a pass is believed for an hour). Out of credit or Claude unreachable: said now, with its
 *  ways on, before any effort; anything else goes on (the reads say it in their own words). */
async function checkAccount(ctx, S) {
  S.checking = true; rerender(ctx);
  const r = await ws(ctx, { type: "padspan_ha/ai_wizard_check_claude" }).catch(() => null);
  S.checking = false;
  const why = r && r.ok === false ? r.why : null;
  if (why !== "no_credit" && why !== "unreachable") return true;
  S.fail = why; S.failFor = "check"; S.screen = "fail";
  telOnce(ctx, "ai_wizard_fail:" + why);
  return false;
}

/** "Ask Claude to look" on the measuring screen, only when the person asks (it is paid, and said so): Claude looks for a
 *  measurement printed on the plan; the read runs on the server and this screen waits for it. A plan that has a scale
 *  by now goes straight to the rooms read. */
async function scaleRead(ctx, S, plan) {
  S.busy = true; S.msg = ""; S.fail = null; S.failFor = null;
  rerender(ctx);
  tel(ctx, "plan_build_scale_taken:asked_claude");
  try {
    const r = await ws(ctx, { type: "padspan_ha/plan_build_scale_start", map_id: plan.id, ...(rechecking(S) ? { recheck: true } : {}), via: VIA });
    S.plan = plan; S.scaleSid = r.session; S.done = null; S.undone = null;
    S.screen = "scale_read";
    for (const k of ["scale_read", "scale_guided"]) _done.delete("step:" + k);
    if (r.reused) await scaleStatus(ctx, S);             // a reading of this picture already held: shown now, nothing paid
  } catch (e) {
    // A plan that has a scale by now: on to its rooms, but never from a scale check (its rooms are already read).
    if (e && e.code === "already_placed" && !rechecking(S)) { S.busy = false; telOnce(ctx, "plan_build_scale:already_set"); return startRead(ctx, S, plan); }
    if (e && e.code === "already_placed") { S.busy = false; S.msg = codeWords(e.code); rerender(ctx); return; }
    startFailed(ctx, S, plan, e);
    if (S.screen === "fail") S.failFor = "scale";
  }
  S.busy = false;
  rerender(ctx);
}

async function startRead(ctx, S, plan) {
  // Nothing on a scale check's screen ever starts a rooms read: its rooms are already read (third review, 2026-11-12).
  if (rechecking(S)) { S.msg = "This plan's rooms are already read: save the new scale, or go back to them."; rerender(ctx); return; }
  S.busy = true; S.msg = ""; S.fail = null; S.failFor = null;
  rerender(ctx);
  try {
    await consent(ctx, S);
    const r = await ws(ctx, { type: "padspan_ha/plan_build_rooms_start", floor_id: plan.floor_id, map_ids: [plan.id], via: VIA });
    S.plan = plan; S.sid = r.session; S.ans = null; S.ticks = new Set(); S.ha = new Set(); S.sel = new Set(); S.names = {}; S.done = null; S.undone = null; S.redrawn = null; S.rescale = null; S.heldFor = null;
    S.screen = "rooms_read";
    _done.delete("step:rooms_read"); _done.delete("step:rooms_check"); _done.delete("step:saved");
  } catch (e) { startFailed(ctx, S, plan, e); }
  S.busy = false;
  rerender(ctx);
}

/** What the server makes of the two ends and the typed length (the length understood, the plan's size). Only the newest
 *  request's answer is taken (a counter); it is drawn in place, so the length field is never rebuilt while it is typed in. */
async function scalePreview(ctx, S) {
  const sc = scaleDraft(S), seq = ++sc.seq, ask = scaleAsk(sc);
  if (sc.timer) { clearTimeout(sc.timer); sc.timer = null; }
  const measures = ask.filter(m => m.text);
  try {
    const pv = await ws(ctx, { type: "padspan_ha/plan_build_scale_preview", map_id: S.plan.id, measures, ...(rechecking(S) ? { replace: true } : {}), via: VIA });
    if (seq !== sc.seq || S.sc !== sc) return;
    sc.pv = pv; sc.pvFor = ask;
    if (pv && pv.floor_known === false && !_done.has("step:floor_pick")) {
      _done.add("step:floor_pick");
      ws(ctx, { type: "padspan_ha/ai_wizard_mark", what: "step", step: "floor_pick", map_id: S.plan.id }).catch(() => {});
    }
  } catch (e) {
    if (seq !== sc.seq || S.sc !== sc) return;
    S.msg = codeWords(e && e.code);
    rerenderKeep(ctx, S);
    return;
  }
  if (!scalePaint(sc)) rerenderKeep(ctx, S);
}

/** Typing: asked once it pauses (about a quarter of a second); an answer already on its way is for older text, and Save waits. */
function scalePreviewSoon(ctx, S) {
  const sc = scaleDraft(S);
  sc.seq++;
  if (sc.timer) clearTimeout(sc.timer);
  sc.timer = null;
  scalePaint(sc);
  if (typeof setTimeout !== "function") { scalePreview(ctx, S); return; }
  sc.timer = setTimeout(() => { sc.timer = null; scalePreview(ctx, S); }, 250);
}

/** The answer drawn in place, when the screen is built for it; false when it has to be drawn again. */
function scalePaint(sc) {
  if (!sc.paint || sc.paint.shape !== scaleShape(sc)) return false;
  sc.paint.fn();
  return true;
}

/** Save the measurement (the server works the scale out again itself) as the newest answer had it, then straight on to the
 *  rooms read. Use it's ends and length, untouched, are saved as Claude's reading (its session); anything else as the
 *  person's own measurement. */
async function scaleSave(ctx, S) {
  const sc = scaleDraft(S), pv = sc.pv || {}, ask = sc.pvFor, used = scaleUsed(sc) ? sc.used : null;
  if (S.busy || !scaleFresh(sc) || !ask.length || !ask.every(m => m.p1 && m.p2 && m.text) || !pv.sig) return;
  S.busy = true; S.msg = ""; rerender(ctx);
  let r = null;
  try {
    r = await ws(ctx, { type: "padspan_ha/plan_build_scale_save", map_id: S.plan.id, sig: pv.sig, ...(sc.floor ? { floor_id: sc.floor } : {}),
      measures: ask.map(m => ({ p1: m.p1, p2: m.p2, text: m.text })),
      source: used ? "plan_dimension" : "guided", ...(used ? { session: used.sid } : {}), ...(rechecking(S) ? { replace: true } : {}), via: VIA });
  } catch (e) {
    r = { ok: false, code: e && e.code, message: codeWords(e && e.code) };
  }
  S.busy = false;
  if (!r || r.ok === false) {
    const code = r && r.code;
    if (code === "backup_failed") telOnce(ctx, "ai_wizard_fail:backup_failed");
    if (code === "floor_unknown") sc.askFloor = true;
    if (code === "plan_changed") Object.assign(sc, { pts: [], pv: null, read: null, used: null });   // what Claude read was of the picture before
    S.msg = (r && r.message) || codeWords(code);
    rerender(ctx);
    if (code === "plan_changed") scalePreview(ctx, S);
    return;
  }
  tel(ctx, "plan_build_scale_taken:" + (used ? "used_reading" : "measured"));
  const plan = { ...S.plan, floor_id: r.floor_id || S.plan.floor_id };
  S.sc = null;
  if (ctx.actions.modelRefresh) await Promise.resolve(ctx.actions.modelRefresh()).catch(() => {});
  if (ctx.actions.mapsRefresh && plan.floor_id !== S.plan.floor_id) await Promise.resolve(ctx.actions.mapsRefresh()).catch(() => {});
  if (S.rescale && S.rescale.map === plan.id) {     // "Check the scale": the same rooms, worked out again at the new scale (no new read)
    S.sid = S.rescale.sid; S.rescale = null; S.scaleElsewhere = null;
    await status(ctx, S);
    if (S.screen !== "rooms_check") {              // the list is gone: never a read from a screen that said it was free
      S.screen = "intro"; S.sid = null; S.ans = null;
      S.msg = "The scale is saved. The rooms list from before isn't there any more: press Draw my rooms to have Claude read the plan (two reads).";
    }
    rerender(ctx);
    return;
  }
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
  // Claude's reading of the measurement stopped: every way on reads it again (what was read is kept and used again).
  if (S.failFor === "scale" && ["resume", "carry_on", "again", "read_again"].includes(word)) return scaleRead(ctx, S, S.plan);
  if (S.failFor === "check" && ["resume", "carry_on", "again", "read_again"].includes(word)) return begin(ctx, S, S.plan);   // the account checked again
  if (word === "by_hand") { ctx.state._aiw = null; ctx.actions.openSetupStep("rooms", S.plan && S.plan.id); return; }
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
  if (S.busy) return;
  S.busy = true; S.msg = "";
  if (S.pending) await S.pending;                                 // a name just typed is kept first: the join goes on its rev
  const sess = S.ans && S.ans.session;
  if (!sess) { S.busy = false; return; }
  try {
    take(S, await ws(ctx, { type: "padspan_ha/plan_build_rooms_edit", session: sess.id, rev: sess.rev, via: VIA, ...args }));
    S.sel = new Set();
    keepTicks(ctx, S);                                             // a joined room ticked as offered, its parts gone
  } catch (e) {
    S.msg = e && e.code === "name_taken" ? "Another room already has that name." : codeWords(e && e.code);
    await status(ctx, S);
  }
  S.busy = false;
  rerender(ctx);
}

async function save(ctx, S) {
  if (S.busy) return;                                             // one press, one commit
  S.busy = true; S.msg = ""; S.fail = null; rerender(ctx);
  if (S.pending) await S.pending;                                 // a name just typed is kept first
  const sess = S.ans && S.ans.session;
  const rows = new Set(((S.ans && S.ans.wizard) || {}).rows || []);
  const items = [...S.ticks].filter(id => rows.has(id));
  if (!sess || !items.length) { S.busy = false; rerender(ctx); return; }
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
    if (r && r.ok === false) throw { code: r.code, message: r.message };
    take(S, r);
    S.done = { saved: items.length, areas: r.areas || {}, names };
    S.screen = "saved";
    OFFER.forget();
    // The panel's own copy of the house, as other writers do after a write (second review: Setup said no rooms until a reload).
    if (ctx.actions.modelRefresh) await Promise.resolve(ctx.actions.modelRefresh()).catch(() => {});
  } catch (e) {
    const f = failOfCode(e && e.code);
    if (f) { S.fail = f; telOnce(ctx, "ai_wizard_fail:" + f); } else S.msg = (e && e.message) || codeWords(e && e.code);
    if (f === "changed_since") {
      await status(ctx, S);                          // the list as it is now (drawn again if its plan moved)...
      S.fail = f;                                    // ...and the refusal stays said, whatever the refresh did (real panel, 2026-11-12)
    }
  }
  S.busy = false;
  rerender(ctx);
}

async function undo(ctx, S) {
  S.busy = true; S.msg = ""; rerender(ctx);
  try {
    // The rooms first, then the plan's scale if this helper set it (design E.5): the server takes the scale back only
    // while nothing in metres was added since, and otherwise says why. One run for here, Setup and Settings → AI.
    const mid = (S.plan && S.plan.id) || ((((S.ans && S.ans.session) || {}).plans || [])[0] || {}).map_id;
    // The server's word for the scale (as Setup and Settings → AI use it): quiet about a scale measured again by hand.
    const out = await OFFER.undoHelperRooms(ctx, { session: S.sid, map_id: mid, scale: ((S.ans && S.ans.undo) || {}).scale });
    if (!out.ok) throw { code: "undo", message: out.message };
    S.undone = { n: out.n, skipped: out.skipped, scale: out.scale === "back" ? "back" : out.scale === "kept" ? out.scaleWords : null };
    if (ctx.actions.modelRefresh) await Promise.resolve(ctx.actions.modelRefresh()).catch(() => {});   // the rooms went, the scale perhaps
  } catch (e) {
    S.msg = (e && e.message) || codeWords(e && e.code);
  }
  S.busy = false;
  rerender(ctx);
}

/** The plan chooser, from any step: nothing is thrown away on the server (a reading stays held for its plan). */
function toChooser(ctx, S) {
  if (S.timer) { clearTimeout(S.timer); S.timer = null; }
  Object.assign(S, { screen: "intro", sid: null, ans: null, scaleSid: null, sc: null, fail: null, failFor: null, msg: "", done: null, undone: null, rescale: null, redrawn: null, heldFor: null });
  _done.delete("step:intro");
  rerender(ctx);
}

function leave(ctx, S) {
  const step = stepWord(S);
  if (step && S.screen !== "saved" && !S.undone) tel(ctx, "ai_wizard_left:" + step);
  if (S.timer) { clearTimeout(S.timer); S.timer = null; }
  const from = ctx.state._aiwFrom || {};
  unwatchPress();
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
  // A floor that has rooms already isn't read again here (that would offer changes to its rooms, and more rooms on top):
  // listed apart, plainly, never chosen. A floor the house doesn't know isn't named by its id.
  const open = plans.filter(m => !planRoomed(st, m)), done = plans.filter(m => planRoomed(st, m));
  const label = (m) => {
    const f = ((st.model && st.model.floors) || []).find(x => x && (x.floor_id || x.id) === m.floor_id), nm = m.name || "Plan";
    return !f || !f.name || nm.trim().toLowerCase() === String(f.name).trim().toLowerCase() ? nm : `${nm} (${f.name})`;
  };
  const doneLine = () => el("div", { "data-aiw": "plans-done", style: "font-size:12px;color:#94a3b8;line-height:1.5;margin:6px 0" },
    `Already has rooms, so not read again here: ${done.map(label).join(", ")}. Change those rooms in Mapping.`);
  // The plan a stored step pointed at was deleted: said first, in words for the plans that are left.
  if (S.gone) box.appendChild(el("div", { "data-aiw": "plan-gone", style: "font-size:13px;color:#f59e0b;line-height:1.5;margin:6px 0" },
    "The plan you were working on isn't there any more." + (open.length === 1 ? " Claude will read the plan that is left instead." : open.length ? " Choose a plan to go on." : "")));
  if (plans.length && !open.length) {
    box.appendChild(P(ctx, "Every floor with a plan already has rooms."));
    box.appendChild(doneLine());
    return;
  }
  const measure = needsScale(st, S.plan);
  box.appendChild(P(ctx, measure ? "Three steps, a few minutes:" : "Two steps, a few minutes:"));
  box.appendChild(el("ol", { "data-aiw": "steps", style: "font-size:13px;color:#cbd5e1;line-height:1.55;margin:4px 0 4px 18px;padding:0" }, [
    ...(measure ? [el("li", {}, "You measure one length on your plan (a wall, a doorway or the whole house), so the map is in metres.")] : []),
    el("li", {}, "Claude finds the rooms on your plan and their names. Rooms that match your Home Assistant rooms get their names."),
    el("li", {}, "You check the rooms and press Save."),
  ]));
  if (S.plan && !measure) box.appendChild(MUTED(ctx, "✓ This plan's scale is already set."));
  if (!plans.length) {
    box.appendChild(P(ctx, "No floor plan was found. Add one in Setup first."));
    return;
  }
  if (done.length) box.appendChild(doneLine());
  if (open.length === 1) box.appendChild(el("div", { "data-aiw": "plan-one", style: "font-size:13px;color:#e2e8f0;margin:6px 0" }, `Claude will read ${label(open[0])}.`));
  if (open.length > 1) {
    box.appendChild(P(ctx, "Which plan shall we start with?"));
    for (const m of open) {
      const r = el("input", { type: "radio", name: "aiw-plan", "data-aiw": "plan-" + m.id });
      r.checked = !!(S.plan && S.plan.id === m.id);
      r.addEventListener("change", () => { S.plan = m; rerender(ctx); });
      box.appendChild(el("label", { style: "display:flex;gap:6px;align-items:center;font-size:13px;color:#e2e8f0;margin:2px 0" }, [r, label(m)]));
    }
  }
  const block = introBlock(S.info, S.build);
  if (block === "start") {                          // what Start does, beside it: the one consent
    box.appendChild(MUTED(ctx, measure ? COST_SCALE : COST));
    box.appendChild(MUTED(ctx, SAVED_ONLY));
  }
  if (block === "trial" || block === "no_pro") {
    if (block === "no_pro") box.appendChild(P(ctx, "Drawing rooms with Claude is part of PadSpan Pro."));
    if (block === "trial" && TRIAL) {                // its pitch is about drawing rooms here (trial_offer.trialPitch)
      const host = TRIAL.trialHostFromCtx(ctx);
      const started = host.onStarted;
      host.onStarted = (r) => { started(r); loadAll(ctx, S); };
      const card = TRIAL.trialOfferCard(host, "ai_wizard", { buy: false });
      if (card) box.appendChild(card);
    }
    return;
  }
  if (block === "connect") {
    box.appendChild(row(ctx, [btn(ctx, "Next: connect Claude →", () => { S.screen = "connect"; rerender(ctx); }, { primary: true, attrs: { "data-aiw": "next-connect" } })]));
    return;
  }
  const c = claudeState(S.build);
  if (c.why === "available_unchosen") {               // chosen by Start, said here (no tick)
    const old = !!Object.keys(chooseClaude(st.settings, c.eid)).includes("atlas_3d_ai_task_backup_entity");
    box.appendChild(el("div", { "data-aiw": "choose", style: "font-size:12px;color:#cbd5e1;line-height:1.5;margin:6px 0" },
      `PadSpan will use ${c.display || "Claude"} from Home Assistant as its AI${old ? "; your earlier AI Task stays as the backup" : ""}. ` +
      "Photo and stair reading will use it too."));
  }
  box.appendChild(MUTED(ctx, LEAVES));
  if (S.checking) box.appendChild(MUTED(ctx, CHECKING));
  box.appendChild(row(ctx, [btn(ctx, S.busy ? "Starting…" : START,
    () => { if (!S.busy && S.plan) begin(ctx, S, S.plan); }, { primary: true, disabled: S.busy || !S.plan, attrs: { "data-aiw": "start" } })]));
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
    box.appendChild(P(ctx, `${OFFER.claudeOlder(c.display)} Drawing rooms needs ${MODEL_WORDS}. ` +
      "Change the model in Home Assistant: Settings → Devices & services → Anthropic."));
    box.appendChild(row(ctx, [haLink(ctx, HA_ANTHROPIC_PATH, "Open the Anthropic integration", "ha_anthropic"), again]));
    return;
  }
  if (c.why === "unknown_model" || c.why === "sources_disagree") {
    box.appendChild(P(ctx, OFFER.CLAUDE_WHY.unknown_model + " Choose the model again by its full name in the Anthropic integration."));
    box.appendChild(row(ctx, [haLink(ctx, HA_ANTHROPIC_PATH, "Open the Anthropic integration", "ha_anthropic"), again]));
    return;
  }
  // Honest about the whole path (2026-11-12): what is needed, how long, and only the steps not done yet (Home Assistant's
  // Anthropic integration already there: the last three). The screen checks again by itself when the person comes back.
  const have = !!(S.build && S.build.anthropic);
  box.appendChild(P(ctx, OFFER.CLAUDE_WHY.not_connected));
  box.appendChild(P(ctx, have ? CONNECT_HAVE : CONNECT_NEED, "margin-top:0"));
  const li = (kids) => el("li", { style: "margin:4px 0" }, kids);
  const aiTask = li([el("b", {}, "Give the integration an AI Task: "), `open its AI Task (or add one), choose ${MODEL_WORDS} by its full name, and save. `,
    ...(have ? [haLink(ctx, HA_ANTHROPIC_PATH, "Open the Anthropic integration", "ha_anthropic")] : [])]);
  const back = li(["Come back here: this screen checks again by itself (or press ", el("b", {}, "Check again"), ")."]);
  box.appendChild(el("ol", { "data-aiw": "connect-steps", style: "font-size:13px;color:#cbd5e1;line-height:1.55;margin:4px 0 4px 18px;padding:0" }, have ? [aiTask, back] : [
    li([el("b", {}, "Sign up or sign in "), "at the Anthropic Console. ", ext(ctx, CONSOLE_URL, "Open the Anthropic Console ↗", "console")]),
    li([el("b", {}, "Add credit "), "under Billing, or link your Claude plan's monthly API credit there. A Claude subscription on its own doesn't pay for these reads."]),
    li([el("b", {}, "Create an API key "), "under API keys and copy it: it is shown only once."]),
    li([el("b", {}, "Add Home Assistant's Anthropic integration "), "and paste the key. ", haLink(ctx, HA_ADD_PATH, "Add Anthropic to Home Assistant", "ha_add")]),
    aiTask, back,
  ]));
  box.appendChild(row(ctx, [MUTED(ctx, "Every step with pictures, kept up to date:"), ext(ctx, GUIDE_URL, "Connect Claude for PadSpan ↗", "guide")]));
  box.appendChild(row(ctx, [again]));
  watchReturn(ctx, S);
}

/** Back on the page after setting Claude up elsewhere: Connect Claude checks again by itself. One listener a page. */
let _returnCtx = null;
function watchReturn(ctx, S) {
  const first = !_returnCtx;
  _returnCtx = { ctx, S };
  if (!first || typeof document === "undefined" || !document.addEventListener) return;
  document.addEventListener("visibilitychange", () => {
    const r = _returnCtx;
    if (document.visibilityState !== "visible" || !r || r.ctx.state._aiw !== r.S || r.S.screen !== "connect") return;
    loadAll(r.ctx, r.S);
  });
}

function readScreen(ctx, S, box) {
  const sess = S.ans && S.ans.session;
  const pr = (sess && sess.progress) || {};
  box.appendChild(P(ctx, "Claude is reading your plan for its rooms, twice, to check itself… (1–3 minutes). " + COME_BACK));
  if (pr.step) box.appendChild(MUTED(ctx, `Now: ${pr.step === "measure" ? "putting the rooms together" : pr.step}.`));
  poll(ctx, S);
}

/** The chosen plan's picture with a layer over it, 1000 units across and H down: as wide as its column, but never
 *  taller than most of the screen, so an upright plan stays whole, beside its list. `zoom` (the guided measurement's,
 *  inside its own scrolling window): that many times as big. */
function planFrame(ctx, S, layerStyle = "", zoom = 0) {
  const { el } = ctx.helpers, st = ctx.state;
  const map = ((st.maps && st.maps.list) || []).find(m => S.plan && m.id === S.plan.id);
  const img = map && ctx.helpers.mapImageUrl ? ctx.helpers.mapImageUrl(map) : null;
  const w = Number((map && map.image && map.image.width) || 1000), h = Number((map && map.image && map.image.height) || 750);
  const fit = `min(100%, calc(72vh * ${w} / ${h}))`;
  const pic = el("div", { "data-aiw": "picture",
    style: `position:relative;width:${zoom > 1 ? `calc(${zoom} * ${fit})` : fit};aspect-ratio:${w}/${h};background:#0f1a12;border-radius:6px;overflow:hidden;margin:${zoom ? 0 : "8px 0"}` });
  if (img) pic.appendChild(el("img", { src: img, alt: "", style: "position:absolute;left:0;top:0;width:100%;height:100%;object-fit:fill;opacity:.85" }));
  const layer = el("div", { style: "position:absolute;left:0;top:0;width:100%;height:100%;" + layerStyle });
  pic.appendChild(layer);
  return { pic, layer, H: Math.round(1000 * h / w) };
}

export const LABEL_MIN = 18;     // a label smaller than this (of 1000 across) isn't drawn: it can't be read
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
    // Sized to its room, so the names of rooms side by side don't run into each other; a room too small for a name that
    // can be read has none on the picture (the list beside it names it).
    const xs = s.frac.map(p => p[0] * 1000), fit = (Math.max(...xs) - Math.min(...xs)) / (0.6 * Math.max(String(s.name || "").length, 1));
    if (fit < LABEL_MIN) continue;
    const fs = Math.min(30, fit);
    svg += `<text x="${cx.toFixed(1)}" y="${cy.toFixed(1)}" text-anchor="middle" font-size="${fs.toFixed(0)}" font-weight="600" fill="#ffffff" stroke="#000000" stroke-width="${(fs / 6).toFixed(1)}" paint-order="stroke" pointer-events="none">${esc(s.name || "")}</text>`;
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

/** A window's scroll put back once it is on the page, before it is painted (a microtask: the panel draws a screen and
 *  puts it on the page in one go), so a redraw neither jumps nor flickers. */
function keepScroll(win, at) {
  const go = () => { win.scrollLeft = at[0]; win.scrollTop = at[1]; };
  if (typeof queueMicrotask === "function") queueMicrotask(go); else if (typeof setTimeout === "function") setTimeout(go, 0);
}

/** "Tap" on a touch screen, "Click" with a mouse. */
export const tapWord = () => (typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches ? "Tap" : "Click");
export const ZOOM_MAX = 4;

/** The two ends on the plan: a tap puts the first, then the second; after that a tap moves the nearer one, and either
 *  can be dragged (mouse, pen or finger: pointer events). One finger places and drags; two fingers pinch and pan the
 *  page (touch-action pinch-zoom). − and + enlarge the picture inside its own window, which keeps its place through
 *  every redraw (sc.scroll), so the printed numbers can be read. */
function measurePicture(ctx, S) {
  const { el } = ctx.helpers;
  const sc = scaleDraft(S), z = sc.zoom || 1;
  const { pic, layer, H } = planFrame(ctx, S, "cursor:crosshair;touch-action:pinch-zoom", z);
  const xy = (p) => [(p[0] * 1000).toFixed(1), (p[1] * H).toFixed(1)];
  let svg = `<svg viewBox="0 0 1000 ${H}" preserveAspectRatio="none" style="position:absolute;left:0;top:0;width:100%;height:100%">`;
  const u = (v) => (v / z).toFixed(1);                             // marks keep their size on the screen when zoomed, so an end sits exactly
  if (sc.pts.length === 2) {
    const [a, b] = sc.pts.map(xy);
    svg += `<line data-aiw-line="1" x1="${a[0]}" y1="${a[1]}" x2="${b[0]}" y2="${b[1]}" stroke="#000000" stroke-width="${u(9)}" stroke-opacity=".5"/>` +
      `<line data-aiw-line="2" x1="${a[0]}" y1="${a[1]}" x2="${b[0]}" y2="${b[1]}" stroke="#f59e0b" stroke-width="${u(5)}"/>`;
  }
  sc.pts.forEach((p, i) => {
    const [x, y] = xy(p);
    svg += `<circle data-pt="${i}" cx="${x}" cy="${y}" r="${u(16)}" fill="#f59e0b" fill-opacity=".9" stroke="#ffffff" stroke-width="${u(4)}" style="cursor:grab"/>` +
      `<text x="${x}" y="${(Number(y) - 24 / z).toFixed(1)}" text-anchor="middle" font-size="${u(28)}" font-weight="700" fill="#ffffff" stroke="#000000" stroke-width="${u(5)}" paint-order="stroke" pointer-events="none">${i + 1}</text>`;
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
  // One pointer at a time: an end dragged by the finger that took it; a second finger (a pinch) puts it back where it was,
  // as the browser's pointercancel does. Zoomed in, a drag on the empty plan pans the window; a tap still places an end.
  const capture = (e) => { try { if (layer.setPointerCapture && e.pointerId !== undefined) layer.setPointerCapture(e.pointerId); } catch (_) { /* not capturable */ } };
  const putBack = () => { if (sc.drag !== null && sc.dragFrom) sc.pts[sc.drag] = sc.dragFrom; sc.drag = null; sc.pan = null; sc.moved = false; rerenderKeep(ctx, S); };
  layer.addEventListener("pointerdown", (e) => {
    if (sc.drag !== null || sc.pan) { if (e.pointerId !== sc.dragId) putBack(); return; }      // a second finger: a pinch, not a drag
    sc.moved = false;                                               // a drag's own click may never have come: every press starts afresh
    const i = e && e.target && e.target.getAttribute ? e.target.getAttribute("data-pt") : null;
    if (i === null || i === undefined) {
      if (z > 1) { sc.pan = { x: e.clientX, y: e.clientY, l: Number(view.scrollLeft) || 0, t: Number(view.scrollTop) || 0 }; sc.dragId = e.pointerId; capture(e); }
      return;
    }
    sc.drag = Number(i);
    sc.dragId = e.pointerId;
    sc.dragFrom = sc.pts[sc.drag] ? sc.pts[sc.drag].slice() : null;
    if (e.preventDefault) e.preventDefault();
    capture(e);
  });
  layer.addEventListener("pointermove", (e) => {
    if (e.pointerId !== sc.dragId) return;                          // another finger's: never moves this end
    if (sc.pan) {
      const dx = e.clientX - sc.pan.x, dy = e.clientY - sc.pan.y;
      if (Math.abs(dx) + Math.abs(dy) > 6) sc.moved = true;          // a pan, not a tap
      view.scrollLeft = Math.max(0, sc.pan.l - dx); view.scrollTop = Math.max(0, sc.pan.t - dy);
      return;
    }
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
  const drop = (e) => {
    if (e && e.pointerId !== sc.dragId) return;
    if (sc.pan) { sc.pan = null; return; }
    if (sc.drag === null) return;
    sc.drag = null;
    scalePreview(ctx, S);
    rerenderKeep(ctx, S);
  };
  layer.addEventListener("pointerup", drop);
  layer.addEventListener("pointercancel", (e) => { if (e && e.pointerId === sc.dragId && (sc.drag !== null || sc.pan)) putBack(); });   // the browser took it (a pinch)
  const view = el("div", { "data-aiw": "measure-view", style: "overflow:auto;max-width:100%;max-height:72vh;margin:8px 0" }, [pic]);
  view.addEventListener("scroll", () => { sc.scroll = [Number(view.scrollLeft) || 0, Number(view.scrollTop) || 0]; });
  if (z > 1 && sc.scroll) keepScroll(view, sc.scroll);
  const zoomTo = (nz) => {                                         // the middle of the window stays where it was
    const r = nz / z, vw = Number(view.clientWidth) || 0, vh = Number(view.clientHeight) || 0, [l, t] = sc.scroll || [0, 0];
    sc.scroll = [Math.max(0, (l + vw / 2) * r - vw / 2), Math.max(0, (t + vh / 2) * r - vh / 2)];
    sc.zoom = nz;
    if (nz > 1) telOnce(ctx, "ai_wizard:zoomed");
    rerenderKeep(ctx, S);
  };
  return el("div", {}, [view, row(ctx, [MUTED(ctx, "Zoom:"),
    btn(ctx, "−", () => zoomTo(Math.max(1, z - 1)), { disabled: z <= 1, attrs: { "data-aiw": "zoom-out", "aria-label": "Smaller" } }),
    btn(ctx, "+", () => zoomTo(Math.min(ZOOM_MAX, z + 1)), { disabled: z >= ZOOM_MAX, attrs: { "data-aiw": "zoom-in", "aria-label": "Bigger" } })], "margin:0")]);
}

/** A refusal the server says before anything is saved (the plan has a scale by now, calibration spots on it…): its words, the way on. */
function scaleStopped(ctx, S, box, pv) {
  box.appendChild(P(ctx, pv.stop_message || codeWords(pv.stop), "color:#f59e0b"));
  if (pv.stop === "already_placed" && !rechecking(S)) box.appendChild(row(ctx, [btn(ctx, "Find the rooms →", () => startRead(ctx, S, S.plan), { primary: true, attrs: { "data-aiw": "scale-skip" } })]));
  else box.appendChild(row(ctx, [btn(ctx, "Draw them myself", () => act(ctx, S, "by_hand"), { attrs: { "data-aiw": "scale-by-hand" } })]));
}

/** The end of both scale screens: the plan's size (drawn in place by scaleSaid), "Which floor does this plan show?" only when
 *  its floor isn't one of the house's indoor floors, Save, and the backup line. */
function scaleFooter(ctx, S, side) {
  const { el } = ctx.helpers, sc = scaleDraft(S);
  const sized = el("div", { "data-aiw": "scale-size" });
  side.appendChild(sized);
  if (scaleAskFloor(sc)) {
    side.appendChild(P(ctx, "Which floor does this plan show?"));
    side.appendChild(row(ctx, indoorFloors(ctx.state).map(f => btn(ctx, f.name || f.id, () => { sc.floor = f.id; rerender(ctx); },
      { primary: sc.floor === f.id, attrs: { "data-aiw": "floor-" + f.id } }))));
  }
  const save = btn(ctx, S.busy ? "Saving…" : rechecking(S) ? "Save the new scale →" : "Save and find the rooms →", () => { if (scaleReady(S)) scaleSave(ctx, S); },
    { primary: true, attrs: { "data-aiw": "scale-save" } });
  side.appendChild(row(ctx, [save]));
  side.appendChild(MUTED(ctx, S.rescale ? SCALE_SAVE_RESCALE : SCALE_SAVE_SAYS));
  return { sized, save };
}

/** Claude is reading the plan for a printed measurement (piece 4). It carries on if the person leaves. */
function scaleReadScreen(ctx, S, box) {
  box.appendChild(P(ctx, "Claude is looking for a measurement printed on your plan… (usually under a minute)."));
  box.appendChild(MUTED(ctx, COME_BACK));
  poll(ctx, S);
}

/** A close look at the measurement Claude quoted: its whole printed line, the box Claude gave for it (never only the
 *  middle of a long line, where a neighbouring length is printed), enlarged so its short side is about INSET_PX on the
 *  screen, in a window that never takes more than a third of the screen's height or its column's width and scrolls
 *  along a long line, starting at its middle. `crop`: the part of the picture shown, in its pixels. */
export const INSET_PX = 160;
export const INSET_ACROSS = 0.03;
function textInset(ctx, S, ax) {
  const { el } = ctx.helpers, st = ctx.state;
  const map = ((st.maps && st.maps.list) || []).find(m => S.plan && m.id === S.plan.id);
  const img = map && ctx.helpers.mapImageUrl ? ctx.helpers.mapImageUrl(map) : null;
  const b = ax && ax.box_frac;
  if (!img || !b) return null;
  const w = Number((map.image && map.image.width) || 1000), h = Number((map.image && map.image.height) || 750), pad = 12;
  // Along the line: from its two ends (plus a margin), with Claude's box: the box can be shorter than the line (real
  // panel, 2026-11-11: a box 315-820 down a line running 166-1014), and every number quoted is printed along the line.
  // Across its narrow side the box is Claude's tight one round the line; the numbers are printed beside it: widened by
  // INSET_ACROSS of its length each way, so they are whole.
  const e = Array.isArray(ax.ends_frac) && ax.ends_frac.length === 2 ? ax.ends_frac : null;
  const tall = e ? Math.abs(e[1][1] - e[0][1]) * h > Math.abs(e[1][0] - e[0][0]) * w : (b[3] - b[1]) * h > (b[2] - b[0]) * w;
  let [l, t, r, bt] = [b[0] * w, b[1] * h, b[2] * w, b[3] * h];
  if (e) {
    const along = tall ? [e[0][1] * h, e[1][1] * h] : [e[0][0] * w, e[1][0] * w], m = pad + INSET_ACROSS * Math.abs(along[1] - along[0]);
    const lo = Math.min(...along) - m, hi = Math.max(...along) + m;
    if (tall) { t = Math.min(t, lo); bt = Math.max(bt, hi); } else { l = Math.min(l, lo); r = Math.max(r, hi); }
  }
  const across = Math.max(pad, INSET_ACROSS * Math.max(r - l, bt - t)), alongPad = e ? 0 : pad;
  const padX = tall ? across : alongPad, padY = tall ? alongPad : across;
  const x0 = Math.max(0, l - padX), y0 = Math.max(0, t - padY);
  const cw = Math.max(Math.min(w, r + padX) - x0, 1), ch = Math.max(Math.min(h, bt + padY) - y0, 1);
  const z = Math.min(4, INSET_PX / Math.min(cw, ch)), px = (v) => `${(v * z).toFixed(1)}px`;
  const pic = el("div", { "data-aiw": "scale-inset-pic", "data-crop": [x0, y0, cw, ch].map(v => Math.round(v)).join(","),
    style: `width:${px(cw)};height:${px(ch)};background:#ffffff url("${img}") no-repeat;background-size:${px(w)} ${px(h)};` +
      `background-position:-${px(x0)} -${px(y0)}` });
  const long = cw * z > 320 || ch * z > 240;                      // more than its window shows: say it scrolls
  const win = el("div", { "data-aiw": "scale-inset", role: "img", "aria-label": "Where the measurement is printed on your plan",
    style: "max-width:100%;width:max-content;max-height:min(33vh, 240px);overflow:auto;border:2px solid #f59e0b;border-radius:6px;margin:4px 0 8px" }, [pic]);
  // Where the person scrolled it stays through every redraw (the 5 s poll's too); the first time, a long line's middle.
  const sc = scaleDraft(S), key = (b || []).join();
  win.addEventListener("scroll", () => { sc.inset = { key, at: [Number(win.scrollLeft) || 0, Number(win.scrollTop) || 0] }; });
  if (sc.inset && sc.inset.key === key) keepScroll(win, sc.inset.at);
  else if (typeof queueMicrotask === "function" || typeof setTimeout === "function") {
    const mid = () => { win.scrollLeft = Math.max(0, (Number(win.scrollWidth) - Number(win.clientWidth)) / 2) || 0;
      win.scrollTop = Math.max(0, (Number(win.scrollHeight) - Number(win.clientHeight)) / 2) || 0; };
    if (typeof queueMicrotask === "function") queueMicrotask(mid); else setTimeout(mid, 0);
  }
  return long ? el("div", {}, [win, el("div", { "data-aiw": "scale-inset-more", style: "font-size:11px;color:#94a3b8;margin:-4px 0 6px" },
    "Scroll the close-up to see the whole measurement.")]) : win;
}

/** How the scale screen says where a direction runs. */
const runs = (k) => (k === "x" ? "across" : "down");

/** The plan's scale, measure first (owner, 2026-11-12): the person clicks both ends of a length they know and types it.
 *  Claude's double-checked reading, when there is one, is a quiet "Use it" that puts its ends and length down here; with
 *  none, "Ask Claude to look" is the lesser choice, its cost said. Nothing of Claude's is saved unless Use it was pressed
 *  and left as it was. */
function scaleScreen(ctx, S, box) {
  const { el } = ctx.helpers;
  const sc = scaleDraft(S), pv = sc.pv, r = sc.read, main = r && r.axes[r.main];
  telOnce(ctx, "plan_build_scale:guided");
  // A scale check can end without a new measurement (third review, 2026-11-12): back to the same list, nothing written.
  if (rechecking(S)) box.appendChild(row(ctx, [btn(ctx, "The scale is right, back to my rooms", () => backToRooms(ctx, S),
    { disabled: S.busy, attrs: { "data-aiw": "recheck-back" } })], "margin:0 0 6px"));
  if (!pv && !sc.seq) scalePreview(ctx, S);                      // the picture's signature, its floor, whether it may be measured here
  const tap = tapWord();
  box.appendChild(P(ctx, `${tap} both ends of something you know the length of (a wall, a doorway, the whole house), then type its length. ` +
    "The longer the thing you measure, the more exact your map." + (tap === "Tap" ? " Pinch with two fingers, or use + below the plan, to look closer." : "")));
  if (main) {
    box.appendChild(row(ctx, [P(ctx, ["Claude found ", el("b", { "data-aiw": "scale-text" }, main.text), ` printed ${runs(r.main)} your plan ` +
      `(${Number(main.metres).toFixed(2)} m), and the other way agrees.`], "margin:0"),
      btn(ctx, "Use it", () => useReading(ctx, S), { disabled: S.busy, attrs: { "data-aiw": "scale-use" } })], "margin:4px 0"));
  } else if (sc.why) {
    box.appendChild(P(ctx, sc.why, "margin:4px 0;color:#94a3b8"));
  } else if (sc.heldAsked && !S.scaleSid) {
    box.appendChild(row(ctx, [MUTED(ctx, SCALE_ASK), btn(ctx, "Ask Claude to look", () => scaleRead(ctx, S, S.plan),
      { disabled: S.busy, attrs: { "data-aiw": "scale-ask" } })], "margin:4px 0"));
  }
  sc.paint = null;
  if (pv && pv.stop) { scaleStopped(ctx, S, box, pv); return; }
  // The plan takes every bit of the width its few fields leave it; on a phone, the whole width above them.
  const cols = el("div", { "data-aiw": "scale", style: "display:flex;gap:16px;flex-wrap:wrap;align-items:flex-start" });
  const side = el("div", { style: "flex:0 1 240px;min-width:220px" });
  cols.appendChild(el("div", { "data-aiw": "measure-col", style: "flex:1 1 0;min-width:280px" }, [measurePicture(ctx, S),
    MUTED(ctx, sc.pts.length < 2 ? `${tap} the ${sc.pts.length ? "other" : "first"} end on the plan.` : `Drag an end, or ${tap.toLowerCase()} near it, to move it.`)]));
  cols.appendChild(side);
  box.appendChild(cols);
  if (main && sc.used) {                                          // Use it pressed: where Claude read it, close up, to check before Save
    const inset = textInset(ctx, S, main);
    if (inset) side.appendChild(inset);
    side.appendChild(MUTED(ctx, "Check that the two ends sit where the printed length starts and ends."));
  }
  const len = el("input", { type: "text", maxlength: "40", "data-aiw": "scale-length", placeholder: "e.g. 4.2 m or 13' 9\"",
    style: "flex:0 1 180px;min-width:120px;background:#0a150e;border:1px solid #2d5a3d;border-radius:6px;color:#e2e8f0;padding:4px 8px;font-size:14px" });
  len.value = sc.text;
  if (S.busy) len.disabled = true;
  // Typing stays here (S.sc) through every redraw, and the field is never rebuilt while it is typed in: the server's
  // answer (what it understood, the plan's size, whether Save may go) is drawn in place (paint), as a drag is.
  len.addEventListener("input", () => { sc.text = String(len.value || ""); scalePreviewSoon(ctx, S); });
  const said = el("span", { "data-aiw": "scale-understood", style: "font-size:13px" });
  side.appendChild(el("label", { style: "display:block;font-size:13px;color:#cbd5e1;margin:8px 0 4px" }, "Its length:"));
  side.appendChild(row(ctx, [len, said], "margin:0 0 8px"));
  const { sized, save } = scaleFooter(ctx, S, side);
  sc.paint = { shape: scaleShape(sc), fn: () => scaleSaid(ctx, S, said, sized, save) };
  sc.paint.fn();
}

/** The server's answer on the scale screen: the length understood (with the unit a bare number was read in), the whole
 *  picture's size (margins and all: it is the picture, not the house), the person's line against Claude's double-checked
 *  reading when they are more than SCALE_DIFFERS_PCT apart, and Save, which goes only on an answer for the measurement as
 *  it is now. */
function scaleSaid(ctx, S, said, sized, save) {
  const { el } = ctx.helpers, sc = scaleDraft(S), pv = sc.pv, m = scaleMetres(sc);
  const unit = pv && Array.isArray(pv.assumed) && pv.assumed[0];
  said.textContent = !String(sc.text || "").trim() ? "" : m ? `= ${Number(m).toFixed(2)} m${unit ? ` (read as ${unit})` : ""}` : (pv && pv.invalid) || "";
  said.style.color = m ? "#a7f3d0" : "#f59e0b";
  const lines = [];
  if (scaleSized(sc)) {
    lines.push(P(ctx, `The whole picture, margins and all, will be ${metresText(pv.across_m)} m across and ${metresText(pv.down_m)} m down.`, "font-weight:600"));
    if (pv.odd) {
      const big = pv.across_m > 100 || pv.across_m < 2 ? ["across", pv.across_m] : ["down", pv.down_m];
      lines.push(el("div", { "data-aiw": "scale-odd", style: "font-size:12px;color:#f59e0b;line-height:1.5;margin:4px 0" },
        `That makes your plan ${metresText(big[1])} m ${big[0]}. Is the number right? You can change it, or save it as it is.`));
    }
    const r = sc.read;
    if (r && r.across_m && !scaleUsed(sc) && Math.abs(pv.across_m / r.across_m - 1) * 100 > SCALE_DIFFERS_PCT) {
      lines.push(el("div", { "data-aiw": "scale-differs", style: "font-size:12px;color:#f59e0b;line-height:1.5;margin:4px 0" },
        `Claude's reading makes the picture ${metresText(r.across_m)} m across; your line makes it ${metresText(pv.across_m)} m. Check the two ends and the length.`));
    }
  }
  sized.replaceChildren(...lines);
  save.disabled = !scaleReady(S);
}

/** "The scale looks wrong" in plain words (ai_wizard.scale_signs' answer): how far, and the example that showed it. */
const KIND_WORDS = { living: "living room", dining: "dining room", family: "family room", powder: "powder room" };
/** A length factor as people say it (2026-11-12: a percent of unlike factors said "60 % too small" for 3 times). */
export function factorWords(k) {
  const f = Number(k) > 1 ? Number(k) : 1 / Number(k);
  return f < 1.75 ? "about one and a half times" : f < 2.25 ? "about twice" : f < 2.75 ? "about two and a half times" : `about ${Math.round(f)} times`;
}
export function scaleNoticeWords(sc) {
  const big = Number(sc.k) > 1, ex = sc.example || {}, bits = [];
  // With a printed reading, its factor; on room sizes alone (a unit mix-up) the direction and "several times", never a
  // figure the room sizes can't back (second review, 2026-11-12).
  const amount = sc.source === "printed" ? factorWords(sc.k) : "several times";
  if (ex.printed) bits.push(`Claude read ${ex.printed.text} printed on the plan, which this scale makes ${ex.printed.here_m} m.`);
  // The room that shows it, with what it is (the server picks a named room impossible for its kind first; review 2026-11-12).
  if (ex.rooms) bits.push(`${ex.rooms.name} would be ${ex.rooms.m2} m²` + (ex.rooms.kind ? `: ${big ? "too big" : "too small"} for any ${KIND_WORDS[ex.rooms.kind] || ex.rooms.kind}.`
    : big ? "." : ": too small for any room."));
  return [`The scale may be off: the rooms come out ${amount} too ${big ? "big" : "small"}.`, ...bits].join(" ");
}
/** Where "Check the scale" can't take the scale back here (u.code): what a correction affects, and where it is made. */
export const SCALE_ELSEWHERE = {
  changed_since: "Things placed in metres sit on this scale now (receivers, calibration spots, or another plan lined up with it), so it isn't " +
    "taken back here: a new measurement in Mapping → Edit → Measure moves them with it. Come back here after: the rooms are drawn again " +
    "from the same reading, with no new read.",
  other: "This plan's scale wasn't set here, so it is changed where it was set, in Mapping → Edit → Measure. Come back here after: the rooms " +
    "are drawn again from the same reading, with no new read.",
};

/** "Check the scale": the helper's own scale taken back (only while nothing in metres sits on it) and the measuring screen
 *  opened; after Save the same rooms come back, worked out again at the new scale on the server, with no new read. Where
 *  it can't be taken back here, the list says what a correction affects and opens Mapping's Measure. Never automatic. */
async function checkScale(ctx, S) {
  const mid = S.plan && S.plan.id;
  if (!mid || S.busy) return;
  tel(ctx, "ai_wizard_scale_notice:checked");
  S.busy = true; S.msg = ""; rerender(ctx);
  // Nothing is changed now (second review, 2026-11-12: a false alarm must never cost a right scale). Asked first: may the
  // helper's own scale be replaced here (scale_replace's rule)? Then the measuring screen with the scale still in place;
  // only a saved new measurement that differs replaces it, in one step on the server.
  const pv = await ws(ctx, { type: "padspan_ha/plan_build_scale_preview", map_id: mid, measures: [], replace: true, via: VIA }).catch(() => null);
  if (!pv || pv.replace !== "goes") {
    S.busy = false;
    tel(ctx, "ai_wizard_scale_notice:elsewhere");
    S.scaleElsewhere = pv && pv.replace === "changed_since" ? "changed_since" : "other";
    rerender(ctx);
    return;
  }
  // Stored on the server for this plan first, so leaving now and Carry on comes back to the measurement and its Save
  // draws these rooms again (never a new read). If it can't be stored, nothing goes on.
  const kept = await ws(ctx, { type: "padspan_ha/ai_wizard_mark", what: "rescale", map_id: mid, rooms_session: S.sid }).then(() => true, () => false);
  S.busy = false;
  if (!kept) {
    S.msg = "The scale check couldn't be started, so nothing was changed. Try again in a moment.";
    rerender(ctx);
    return;
  }
  if (S.info) S.info.wizard = { ...(S.info.wizard || {}), rescale: { ...((S.info.wizard || {}).rescale || {}), [mid]: S.sid } };
  S.rescale = { map: mid, sid: S.sid }; S.scaleSid = null; S.sc = null;
  await toMeasure(ctx, S);
  rerender(ctx);
}

export const RECHECK_UNKNOWN = "unknown";
export const RECHECK_UNKNOWN_WORDS = "Your scale check couldn't be looked up just now, so nothing was changed. Try again in a moment.";
/** "The scale is right, back to my rooms": the check ended (its record cleared, the notice not shown again for this
 *  plan), the same list with its names and ticks, and nothing written to the scale. */
async function backToRooms(ctx, S) {
  const mid = S.plan.id, sid = S.rescale.sid;
  S.rescale = null; S.sc = null;
  if (S.info && S.info.wizard && S.info.wizard.rescale) delete S.info.wizard.rescale[mid];
  ws(ctx, { type: "padspan_ha/ai_wizard_mark", what: "rescale_done", map_id: mid }).catch(() => {});
  tel(ctx, "ai_wizard_scale_notice:dismissed");
  S.scaleOkFor = [...(S.scaleOkFor || []), mid];
  ws(ctx, { type: "padspan_ha/ai_wizard_mark", what: "scale_ok", map_id: mid }).catch(() => {});
  S.sid = sid;
  await status(ctx, S);
  rerender(ctx);
}
/** The plan's scale-check record, if the rooms session behind it is still there to draw again (read, not saved); a
 *  stale one is dropped (second review: never a screen that says free ahead of a paid read). */
async function rescaleAlive(ctx, S, mid) {
  const sid = rescaleOf(S, mid);
  if (!sid) return null;
  const a = await ws(ctx, { type: "padspan_ha/plan_build_rooms_status", session: sid, via: VIA }).then(x => x, () => undefined);
  if (a === undefined) return RECHECK_UNKNOWN;      // not answered just now (a blip, Claude locked): kept, said, tried again later
  const s = a && a.session;
  if (s && s.id === sid && s.proposal && s.status !== "running" && !Object.keys(s.saved || {}).length) return sid;
  ws(ctx, { type: "padspan_ha/ai_wizard_mark", what: "rescale_done", map_id: mid }).catch(() => {});
  if (S.info && S.info.wizard && S.info.wizard.rescale) delete S.info.wizard.rescale[mid];
  return null;
}

/** The notice at the top of the check list: two signs or more agreeing (never one), with its example; never blocks Save. */
function scaleNotice(ctx, S, sc) {
  const { el } = ctx.helpers, mid = S.plan && S.plan.id;
  if (!sc || !mid || (S.scaleOkFor || []).includes(mid)) return null;
  telOnce(ctx, "ai_wizard_scale_notice:shown");
  for (const s of sc.signs || []) telOnce(ctx, "ai_wizard_scale_sign:" + s);
  const box = el("div", { "data-aiw": "scale-notice", style: "border:1px solid #f59e0b;border-radius:8px;padding:8px 12px;margin:8px 0" });
  box.appendChild(P(ctx, scaleNoticeWords(sc), "margin:0"));
  if (S.scaleElsewhere) {
    box.appendChild(P(ctx, SCALE_ELSEWHERE[S.scaleElsewhere], "margin:6px 0 0;color:#f59e0b"));
    box.appendChild(row(ctx, [btn(ctx, "Measure it in Mapping →", () => {
      // Recorded first: back here after measuring, these rooms are drawn again at the new scale (status, no read).
      ws(ctx, { type: "padspan_ha/ai_wizard_mark", what: "rescale", map_id: mid, rooms_session: S.sid }).catch(() => {});
      ctx.state._aiw = null; ctx.actions.openSetupStep("scale", mid); },
      { primary: true, attrs: { "data-aiw": "scale-elsewhere" } })]));
    return box;
  }
  box.appendChild(row(ctx, [
    btn(ctx, "Check the scale", () => checkScale(ctx, S), { primary: true, disabled: S.busy, attrs: { "data-aiw": "scale-check" } }),
    btn(ctx, "The scale is right", () => {
      tel(ctx, "ai_wizard_scale_notice:dismissed");
      S.scaleOkFor = [...(S.scaleOkFor || []), mid];
      ws(ctx, { type: "padspan_ha/ai_wizard_mark", what: "scale_ok", map_id: mid }).catch(() => {});
      rerender(ctx);
    }, { attrs: { "data-aiw": "scale-right" } }),
    MUTED(ctx, "Checking it costs nothing: the same reading is used.")]));
  return box;
}

/** The check list (2026-11-12): what needs a look after what looks right, each row's size, its secondary controls behind
 *  its own "⋯", and Save in a bar that stays in view while the list scrolls. The defaults are the server's, unchanged. */
function checkScreen(ctx, S, box) {
  const { el } = ctx.helpers, st = ctx.state;
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
    // Nothing found (2026-11-12): reading the same plan again found the same rooms every time in testing, so the main way
    // on is drawing them by hand or another plan; reading again is the lesser choice, its cost said.
    box.appendChild(P(ctx, "Claude didn't find rooms it could use on this plan."));
    const others = plansOf(st).filter(m => S.plan && m.id !== S.plan.id && !planRoomed(st, m));
    box.appendChild(row(ctx, [btn(ctx, "Draw them myself", () => act(ctx, S, "by_hand"), { primary: true, attrs: { "data-aiw": "none-by-hand" } }),
      ...(others.length ? [btn(ctx, "Try another plan", () => toChooser(ctx, S), { attrs: { "data-aiw": "none-other-plan" } })] : [])]));
    box.appendChild(row(ctx, [MUTED(ctx, "Reading this plan again usually finds the same: two more reads, charged to your Anthropic account."),
      btn(ctx, "Read it again", () => act(ctx, S, "again"), { disabled: S.busy, attrs: { "data-aiw": "none-again" } })]));
    return;
  }
  if (S.redrawn) box.appendChild(el("div", { "data-aiw": "redrawn", style: "font-size:12px;color:#a7f3d0;line-height:1.5;margin:4px 0" },
    "Drawn again at the new scale, from the same reading. " + (S.redrawn.reset ? "Names and ticks are Claude's again: check them before you save." : "Your names and ticks are kept.")));
  if (S.heldFor && S.plan && S.heldFor === S.plan.id) box.appendChild(row(ctx, [MUTED(ctx, "Claude already read this plan's rooms, so they aren't read again."),
    btn(ctx, "Read it again", () => act(ctx, S, "again"), { disabled: S.busy, attrs: { "data-aiw": "held-again" } }),
    MUTED(ctx, "Two reads, charged to your Anthropic account.")], "margin:4px 0"));
  const notice = scaleNotice(ctx, S, w.scale_check);
  if (notice) box.appendChild(notice);
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
  const rowItem = (r) => {
    const tick = el("input", { type: "checkbox", "data-aiw": "tick-" + r.id });
    tick.checked = S.ticks.has(r.id);
    tick.addEventListener("change", () => { if (tick.checked) S.ticks.add(r.id); else S.ticks.delete(r.id); keepTicks(ctx, S); rerender(ctx); });
    const name = el("input", { type: "text", list: "aiw-areas", maxlength: "40", "data-aiw": "name-" + r.id,
      style: "flex:0 1 200px;min-width:110px;background:#0a150e;border:1px solid #2d5a3d;border-radius:6px;color:#e2e8f0;padding:3px 6px;font-size:13px" });
    name.value = typeof S.names[r.id] === "string" ? S.names[r.id] : r.name;
    if (r.his || S.busy) name.disabled = true;
    // Typing stays here (S.names): no answer or redraw takes it away. Left (change), the name is kept on the session
    // (keepName), so Back or a reload finds it; Save still sends any name not kept yet first.
    name.addEventListener("input", () => {
      S.names[r.id] = String(name.value || "");
      if (typeof setTimeout !== "function") return;               // kept a second after typing stops, so a reload mid-word loses nothing
      clearTimeout((S.nameTimers || {})[r.id]);
      (S.nameTimers = S.nameTimers || {})[r.id] = setTimeout(() => { delete S.nameTimers[r.id]; keepName(ctx, S, r.id, name.value, false); }, NAME_KEEP_MS);
    });
    name.addEventListener("change", () => {                         // left: kept, then the list drawn again
      clearTimeout((S.nameTimers || {})[r.id]);
      keepName(ctx, S, r.id, name.value, true);
    });
    const typed = nameOf(S, r), matched = typed === r.name ? r.matched : isArea(typed);
    const chipText = r.his ? "your room" : !r.sure ? "Claude saw this one differently twice: look at its shape"
      : matched ? "matches your Home Assistant room" : "new room, only in PadSpan";
    const size = Number(r.m2) > 0 ? el("span", { "data-aiw": "m2-" + r.id, style: "font-size:12px;color:#cbd5e1;white-space:nowrap" }, `${Math.round(r.m2 * 10) / 10} m²`) : "";
    // Its secondary controls behind the row's own ⋯ (the Home Assistant area, a look again): kept in the row, hidden.
    const more = el("div", { "data-aiw": "more-" + r.id, style: `display:${(S.open || new Set()).has(r.id) ? "block" : "none"};margin:4px 0 0 22px` });
    if (r.his && r.flagged) more.appendChild(btn(ctx, "Ask Claude to look again", async () => {
      try { take(S, await ws(ctx, { type: "padspan_ha/plan_build_rooms_read_again", session: sess.id, rev: sess.rev, room: r.id.slice(5), via: VIA })); S.screen = "rooms_read"; }
      catch (e) { S.msg = codeWords(e && e.code); }
      rerender(ctx);
    }, { attrs: { "data-aiw": "again-" + r.id } }));
    if (!r.his && !matched) {
      const ha = el("input", { type: "checkbox", "data-aiw": "ha-" + r.id });
      ha.checked = S.ha.has(r.id);
      ha.addEventListener("change", () => { if (ha.checked) S.ha.add(r.id); else S.ha.delete(r.id); keepTicks(ctx, S); rerender(ctx); });
      more.appendChild(el("label", { style: "display:flex;gap:6px;align-items:center;font-size:12px;color:#94a3b8" }, [ha,
        el("span", {}, "Also make it a Home Assistant area (for its area pages and motion sensors)")]));
      anyHa = true;
    }
    const toggle = more.children.length ? btn(ctx, (S.open || new Set()).has(r.id) ? "▴" : "⋯", () => {
      S.open = S.open || new Set();
      if (S.open.has(r.id)) S.open.delete(r.id); else S.open.add(r.id);
      rerender(ctx);
    }, { attrs: { "data-aiw": "toggle-" + r.id, "aria-label": "More for this room" } }) : "";
    const line = el("div", { style: "display:flex;gap:8px;align-items:center;flex-wrap:wrap" }, [tick, name, size,
      el("span", { "data-aiw": "chip-" + r.id, style: `font-size:11px;color:${r.sure ? "#94a3b8" : "#f59e0b"}` }, chipText),
      S.ha.has(r.id) ? el("span", { style: "font-size:11px;color:#a7f3d0" }, "+ area") : "", toggle]);
    const item = el("div", { style: "padding:6px 8px;border:1px solid #1b3526;border-radius:6px" }, [line, more]);
    if (r.renamed && typed === r.name) item.appendChild(el("div", { "data-aiw": "renamed-" + r.id, style: "font-size:12px;color:#94a3b8;margin:4px 0 0 22px" },
      `Another room is already called "${r.renamed}", so this one is "${r.name}". Change it if you like.`));
    // The row's room lights up on the plan while the pointer is on it.
    item.addEventListener("mouseenter", () => { const g = cols.querySelector(`polygon[data-id="${r.id}"]`); if (g) { g.setAttribute("stroke", "#ffffff"); g.setAttribute("stroke-width", "6"); } });
    item.addEventListener("mouseleave", () => { const g = cols.querySelector(`polygon[data-id="${r.id}"]`); if (g) { const pk = S.sel.has(r.id); g.setAttribute("stroke", pk ? "#ffffff" : (r.sure ? "#52b788" : "#f59e0b")); g.setAttribute("stroke-width", pk ? "5" : "3"); } });
    return item;
  };
  // What looks right first; what needs a look after it, under its own heading.
  const unsure = shown.filter(r => !r.sure || r.flagged), sure = shown.filter(r => !unsure.includes(r));
  for (const r of sure) list.appendChild(rowItem(r));
  if (unsure.length) {
    list.appendChild(el("div", { "data-aiw": "unsure-head", style: "font-size:13px;font-weight:600;color:#f59e0b;margin:8px 0 0" },
      `Look at ${unsure.length === 1 ? "this one" : `these ${unsure.length}`}: Claude saw ${unsure.length === 1 ? "it" : "them"} differently on its two reads`));
    for (const r of unsure) list.appendChild(rowItem(r));
  }
  side.appendChild(list);
  if (anyHa) side.appendChild(el("div", { "data-aiw": "ha-note", style: "font-size:12px;color:#94a3b8;line-height:1.5;margin:2px 0 8px" }, [
    "A room's ⋯ can also make it a Home Assistant area of that name, so Home Assistant's own pages and motion sensors can use the room. ",
    "Undo here takes the room out of PadSpan but leaves the area in Home Assistant; remove it there on the ", haLink(ctx, HA_AREAS_PATH, "Areas page", "ha_areas"), "."]));
  const small = rows.filter(r => r.small);
  if (small.length) side.appendChild(row(ctx, [MUTED(ctx, `Small spaces (${small.length}): closets and halls, left out.`),
    btn(ctx, S.showSmall ? "Hide" : "Show", () => { S.showSmall = !S.showSmall; rerender(ctx); }, { attrs: { "data-aiw": "small" } })]));
  const used = new Set(rows.map(r => String(nameOf(S, r)).toLowerCase()));
  const left = areas.filter(a => !used.has(a.toLowerCase())).slice(0, 8);
  if (left.length) side.appendChild(MUTED(ctx, `Home Assistant rooms not on this plan: ${left.join(", ")}. Pick one in a row above, or draw it later in Mapping.`));
  side.appendChild(row(ctx, [MUTED(ctx, `${tapWord()} two rooms on the plan to join them into one (an open kitchen and dining room, say).`),
    btn(ctx, "Join into one", () => { if (S.sel.size >= 2 && !S.busy) edit(ctx, S, { op: "merge", parts: [...S.sel] }); }, { disabled: S.sel.size < 2 || S.busy, attrs: { "data-aiw": "join" } })]));
  if (S.fail) box.appendChild(failBlock(ctx, S, S.fail));
  const n = [...S.ticks].filter(id => rows.some(r => r.id === id)).length;
  // Save stays in view while the list scrolls (desktop and phone): a bar stuck to the bottom of the screen.
  // One compact line (review 2026-11-12: on a phone the bar and the bottom menu took about 150 of 844 px): the note beside
  // Save shrinks to one line and is cut short rather than wrapping.
  box.appendChild(el("div", { "data-aiw": "save-bar", style: "position:sticky;bottom:0;z-index:2;background:#0f1a12;border-top:1px solid #1b3526;padding:4px 0;margin-top:8px;" +
    "display:flex;gap:8px;align-items:center;flex-wrap:nowrap" }, [
    btn(ctx, S.busy ? "Saving…" : `Save ${n} room${n === 1 ? "" : "s"}`, () => save(ctx, S), { primary: true, disabled: !n || S.busy, attrs: { "data-aiw": "save", style: "font-size:12px;flex:none" } }),
    el("span", { style: "flex:1 1 auto;min-width:0;font-size:11px;color:#94a3b8;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" },
      "Experimental. A backup is taken first; one Undo takes it all back.")]));
}

function savedScreen(ctx, S, box) {
  const { el } = ctx.helpers, st = ctx.state;
  const sess = S.ans && S.ans.session;
  const fid = (sess && sess.floor_id) || (S.plan && S.plan.floor_id);
  if (S.undone) {
    box.appendChild(P(ctx, `${S.undone.n} room${S.undone.n === 1 ? "" : "s"} taken back.` +
      (S.undone.skipped ? ` ${S.undone.skipped} ${S.undone.skipped === 1 ? "was" : "were"} left, because ${S.undone.skipped === 1 ? "it" : "they"} changed since or a receiver was put in.` : "")));
    if (S.undone.scale === "back") box.appendChild(MUTED(ctx, "The scale set here is taken back too: the plan has no scale again."));
    else if (S.undone.scale) box.appendChild(el("div", { "data-aiw": "scale-kept", style: "font-size:12px;color:#f59e0b;line-height:1.5;margin:6px 0" }, S.undone.scale));
    if (Object.values((S.done && S.done.areas) || {}).includes("created")) box.appendChild(row(ctx, [
      MUTED(ctx, "The areas added to Home Assistant are still there. Remove them on Home Assistant's"), haLink(ctx, HA_AREAS_PATH, "Areas page", "ha_areas")]));
    // What next (2026-11-12; it was Back only): try again on this plan, or draw the rooms by hand.
    box.appendChild(row(ctx, [
      btn(ctx, "Try again", () => { tel(ctx, "ai_wizard:undo_next_again"); begin(ctx, S, S.plan); }, { primary: true, disabled: S.busy || !S.plan, attrs: { "data-aiw": "undone-again" } }),
      btn(ctx, "Draw them myself", () => { tel(ctx, "ai_wizard:undo_next_by_hand"); act(ctx, S, "by_hand"); }, { attrs: { "data-aiw": "undone-by-hand" } })]));
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
  const rb = SETUP && SETUP.receiversBlock ? SETUP.receiversBlock(ctx, { quiet: true }) : null;
  if (rb) box.appendChild(rb);
  box.appendChild(row(ctx, [P(ctx, "Next: put your Bluetooth receivers on the map, so PadSpan can tell which room each phone is in.", "margin:0"),
    btn(ctx, "Place receivers →", () => { ws(ctx, { type: "padspan_ha/ai_wizard_mark", what: "step", step: "handoff" }).catch(() => {});
      const mid = ((((sess && sess.plans) || [])[0]) || {}).map_id || (S.plan && S.plan.id);   // the plan just saved, never Setup's own pick
      st._aiw = null; ctx.actions.openSetupStep("receivers", mid); }, { primary: true, attrs: { "data-aiw": "receivers" } })]));
  const next = plansOf(st).find(m => m.floor_id !== fid && !planRoomed(st, m));
  if (next) box.appendChild(row(ctx, [MUTED(ctx, `${floorName(st, next.floor_id)} has a plan too.`),
    btn(ctx, `Do ${floorName(st, next.floor_id)} next →`, () => { ws(ctx, { type: "padspan_ha/ai_wizard_mark", what: "step", step: "next_floor" }).catch(() => {}); begin(ctx, S, next); }, { attrs: { "data-aiw": "next-floor" } })]));
  box.appendChild(row(ctx, [MUTED(ctx, "Something wrong?"), btn(ctx, "Undo", () => undo(ctx, S), { disabled: S.busy, attrs: { "data-aiw": "undo" } }),
    MUTED(ctx, "takes back the rooms, and the plan's scale if it was set here. Later, the same Undo is on Setup's Draw the rooms step and in Settings → AI.")]));
}

export function render(ctx) {
  const { el } = ctx.helpers, st = ctx.state;
  const S = S_of(ctx);
  const root = el("div", { id: "ai-wizard" });
  S.root = root;                                    // where rerenderKeep puts the cursor back
  watchPress(ctx, S, root);
  const card = el("div", { class: "card" });
  const back = btn(ctx, "← Back", () => leave(ctx, S), { attrs: { "data-aiw": "back" } });
  // Off any step (a reading Carry on came back to, say) to the plan chooser: what was read stays held on the server.
  const choose = S.screen && !["intro", "connect"].includes(S.screen) && plansOf(st).length > 1
    ? btn(ctx, "Choose another plan", () => toChooser(ctx, S), { attrs: { "data-aiw": "choose-plan" } }) : "";
  card.appendChild(el("div", { style: "display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:6px" }, [back,
    el("div", { style: "font-weight:700;font-size:16px;color:#52b788" }, ["Let Claude draw your rooms", OFFER.chip(el)]),
    ctx.helpers.helpBtn ? ctx.helpers.helpBtn("ai_wizard") : "", choose]));
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
  else if (S.screen === "scale_read") scaleReadScreen(ctx, S, card);
  else if (S.screen === "scale" && S.plan) scaleScreen(ctx, S, card);
  else if (S.screen === "rooms_read") readScreen(ctx, S, card);
  else if (S.screen === "rooms_check" && S.ans && S.ans.session && S.ans.session.proposal) checkScreen(ctx, S, card);
  else if (S.screen === "saved") savedScreen(ctx, S, card);
  else if (S.screen === "fail") { const b = failBlock(ctx, S, S.fail || "bad_answer"); if (b) card.appendChild(b); }
  if (S.msg) card.appendChild(el("div", { "data-aiw": "msg", style: "font-size:12px;color:#f59e0b;margin-top:6px" }, S.msg));
  markStep(ctx, S);
  return root;
}
