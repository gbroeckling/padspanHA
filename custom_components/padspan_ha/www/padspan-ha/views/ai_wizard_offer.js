// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
// See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
//
// Where "Let Claude draw your rooms" (views/ai_wizard.js) is offered: a row
// in the Overview's Getting started card, a card of its own on the Overview
// when Getting started isn't showing, and one line in Setup and in the
// Mapping wizard's scale and rooms steps (design ai-wizard A.4), and one in
// the Plans tool where it stops on plans with no scale yet. Small on
// purpose: the screens load it, the helper itself loads only when opened.
//
// Who sees it is the server's rule alone (ai_wizard.offer_reason, asked once
// a page through padspan_ha/ai_wizard_info): "push" for the Overview, which
// minds Not now and Don't ask again; "pull" for Setup and Mapping.

// telemetry.AI_WIZARD_SURFACES, the report's words for where it was offered.
export const SURFACES = Object.freeze(["overview", "getting_started", "setup", "maps_wizard", "plans_tool"]);
const RULE = { overview: "push", getting_started: "push", setup: "pull", maps_wizard: "pull", plans_tool: "pull" };

// Why Claude can't be used here, in plain words (plan_build_info's unlock.why), one copy: the helper's
// Connect Claude screen (views/ai_wizard.js) and Settings → AI's line where Build from plans is hidden.
export const GUIDE_URL = "https://padspan.traks.ca/guides/claude-ai-task/";
export const MODEL_WORDS = "Claude Opus 5.5 or newer (any Fable or Mythos works too)";
export const CLAUDE_WHY = Object.freeze({
  not_connected: "Claude isn't connected to Home Assistant yet.",
  no_ai_task: "No AI Task is chosen for PadSpan yet.",
  not_anthropic: "Your AI Task isn't Claude through Home Assistant's Anthropic integration.",
  unknown_model: "PadSpan can't tell which Claude model this AI Task uses.",
});
/** Your AI Task's Claude, older than MODEL_WORDS. */
export const claudeOlder = (display) => `Your AI Task uses ${display || "an older Claude"}.`;

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

/** One sentence: why Claude can't read plans for PadSpan here (a claudeState()). */
export function claudeWhyWords(c) {
  if (c.why === "available_unchosen") return `Home Assistant has ${c.display || "Claude"} ready, but it isn't PadSpan's AI Task yet.`;
  if (c.why === "below_opus_5_5") return claudeOlder(c.display);
  if (c.why === "unknown_model" || c.why === "sources_disagree") return CLAUDE_WHY.unknown_model;
  return CLAUDE_WHY[c.why] || CLAUDE_WHY.not_anthropic;
}

export const CHIP_TEXT = "EXPERIMENTAL";
/** The amber chip every one of the helper's screens and offers carries. */
export function chip(el) {
  return el("span", { "data-aiw": "chip", style: "background:#f59e0b;color:#000;font-weight:700;font-size:10px;padding:1px 6px;border-radius:4px;margin-left:6px;vertical-align:middle" }, CHIP_TEXT);
}

// The rule's answer, per rule, once a page (cleared by a mark or a save).
const _info = { push: null, pull: null };
const _asking = { push: false, pull: false };
const _offered = new Set();

export function _reset() { _info.push = _info.pull = null; _asking.push = _asking.pull = false; _offered.clear(); }
export function forget() { _info.push = _info.pull = null; }

const _admin = (ctx) => !!(ctx.hass && ctx.hass.user && ctx.hass.user.is_admin);

/** The rule's cached answer for a surface, or null while it is asked. */
export function infoFor(ctx, surface) {
  const rule = RULE[surface];
  if (!rule || !_admin(ctx) || ctx.state.dataMode !== "live") return null;
  if (_info[rule]) return _info[rule];
  if (!_asking[rule] && ctx.actions.callWS) {
    _asking[rule] = true;
    ctx.actions.callWS({ type: "padspan_ha/ai_wizard_info", surface: rule, kiosk: !!ctx.state.kioskMode, live: true })
      .then(r => { _info[rule] = r || { offer: false }; if (_info[rule].offer) ctx.actions.renderRooms(); })   // no offer: nothing to draw again
      .catch(() => { _info[rule] = { offer: false }; })
      .finally(() => { _asking[rule] = false; });
  }
  return null;
}

/** Whether to offer here; the first time a page, said to the server (shown, by where). */
export function offered(ctx, surface) {
  const i = infoFor(ctx, surface);
  if (!i || !i.offer) return false;
  if (!_offered.has(surface)) {
    _offered.add(surface);
    ctx.actions.callWS({ type: "padspan_ha/ai_wizard_mark", what: "offered", surface }).catch(() => {});
  }
  return true;
}

/** Open the helper (a focused view with one Back), from a surface. */
export function openWizard(ctx, surface) {
  const st = ctx.state;
  st._aiwFrom = { view: st.view === "ai_wizard" ? "overview" : st.view, surface };
  st._aiw = null;                                   // views/ai_wizard.js starts over from the server's state
  ctx.actions.callWS({ type: "padspan_ha/ai_wizard_mark", what: "opened", surface }).catch(() => {});
  ctx.actions.showView("ai_wizard");
}

function _mark(ctx, what) {
  forget();
  return ctx.actions.callWS({ type: "padspan_ha/ai_wizard_mark", what }).catch(() => {}).finally(() => ctx.actions.renderRooms());
}

// Where the helper was left (ai_wizard._UNFINISHED): Claude reading, or what it read waiting to be checked, is part-way
// (what the reading screen promises); a measurement of the person's own was only started.
const READING = new Set(["scale_read", "scale_check", "rooms_read", "rooms_check"]);
const MEASURING = new Set(["scale_guided"]);

/** The words for where the helper was left, one copy for every pull surface: {back, text, go}. `back`: there is something
 *  to carry on with (Claude reading, a reading to check, a measurement started); `done`: the step it is offered on is done
 *  (Setup's Rooms row once a floor has rooms), so not "Stuck?". */
export function lineWords(ctx, surface, done = false) {
  const st0 = ((infoFor(ctx, surface) || {}).wizard || {}).started || {};
  // The plan it was left on was deleted: nothing of it to carry on with (the helper says so and starts on the chooser).
  const st = st0.map_id && !((ctx.state.maps && ctx.state.maps.list) || []).some(m => m && m.id === st0.map_id) ? {} : st0;
  const fl = (((ctx.state.model && ctx.state.model.floors) || []).find(f => f && (f.floor_id || f.id) === st.floor_id) || {}).name;
  const text = READING.has(st.at) ? "Claude is part-way through drawing your rooms (experimental)."
    : MEASURING.has(st.at) ? `You started measuring your plan${fl ? ` on ${fl}` : ""} for Claude to draw its rooms (experimental).`
      : st.at === "floor_pick" ? "You were choosing which floor your plan shows, for Claude to draw its rooms (experimental)."
        : null;
  if (text) return { back: true, text, go: "Carry on →" };
  return { back: false, go: "Try it →", text: done ? "Claude can draw the rooms on another of your floor plans too (experimental)."
    : "Stuck? Claude can read your plan and draw the rooms for you (experimental)." };
}

/** Setup's and the Mapping wizard's line (pull: Not now doesn't hide it): Carry on where it was left, else Try it. */
export function offerLine(ctx, surface, done = false) {
  if (!offered(ctx, surface)) return null;
  const { el } = ctx.helpers, w = lineWords(ctx, surface, done);
  const go = el("button", { class: "btn inline", "data-aiw": "try", style: "font-size:12px;margin-left:6px" }, w.go);
  go.addEventListener("click", () => openWizard(ctx, surface));
  return el("div", { "data-aiw": "line", style: "font-size:12px;color:#94a3b8;margin:6px 0;line-height:1.5" }, [w.text, go]);
}

/** The Getting started card's row, under Draw Rooms. */
export function gettingStartedRow(ctx) {
  if (!offered(ctx, "getting_started")) return null;
  const { el } = ctx.helpers;
  const row = el("div", { "data-aiw": "gs-row", style: "display:flex;align-items:center;gap:8px;padding:4px 8px;border-radius:4px;font-size:12px;cursor:pointer;background:#0f2a1a;margin-left:22px" }, [
    el("span", { style: "font-size:14px" }, "✨"),
    el("span", { style: "color:#8ee5b4" }, "Or let Claude draw the rooms from your plan (experimental) →"),
  ]);
  row.addEventListener("click", () => openWizard(ctx, "getting_started"));
  return row;
}

/** The Overview's own card when Getting started isn't showing. */
export function overviewCard(ctx) {
  if (!offered(ctx, "overview")) return null;
  const { el } = ctx.helpers;
  const w = (_info.push && _info.push.wizard) || {};
  const back = w.started && ["rooms_read", "rooms_check"].includes(w.started.at);
  const card = el("div", { "data-aiw": "card", style: "background:#0a1f14;border:1px solid #1a4228;border-radius:8px;padding:10px 14px;margin-bottom:12px" });
  card.appendChild(el("div", { style: "font-weight:700;font-size:13px;color:#52b788" },
    [back ? "Pick up where you left off with Claude and your plan." : "Your floor plan is in. Want Claude to draw the rooms?", chip(el)]));
  card.appendChild(el("div", { style: "font-size:12px;color:#cbd5e1;line-height:1.55;margin:4px 0 8px" }, back
    ? "Carry on to see the rooms Claude found, check them and press Save. One button takes it all back."
    : "Claude can read your plan, find its rooms and their names, and draw them for you. You check each one before anything is saved, and one button takes it all back."));
  const show = el("button", { class: "btn inline primary", "data-aiw": "show", style: "font-size:12px" }, back ? "Carry on" : "Show me");
  show.addEventListener("click", () => openWizard(ctx, "overview"));
  const later = el("button", { class: "btn inline", "data-aiw": "snooze", style: "font-size:12px" }, "Not now");
  later.addEventListener("click", () => _mark(ctx, "snoozed"));
  const never = el("button", { class: "btn inline", "data-aiw": "dismiss", style: "font-size:12px;color:#94a3b8" }, "Don't ask again");
  never.addEventListener("click", () => _mark(ctx, "dismissed"));
  card.appendChild(el("div", { style: "display:flex;gap:8px;flex-wrap:wrap" }, [show, later, never]));
  return card;
}
