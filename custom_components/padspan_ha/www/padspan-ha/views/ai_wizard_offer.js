// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
// See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
//
// Where "Let Claude draw your rooms" (views/ai_wizard.js) is offered: a row
// in the Overview's Getting started card, a card of its own on the Overview
// when Getting started isn't showing, and one line in Setup and in the
// Mapping wizard's scale and rooms steps (design ai-wizard A.4). Small on
// purpose: the screens load it, the helper itself loads only when opened.
//
// Who sees it is the server's rule alone (ai_wizard.offer_reason, asked once
// a page through padspan_ha/ai_wizard_info): "push" for the Overview, which
// minds Not now and Don't ask again; "pull" for Setup and Mapping.

// telemetry.AI_WIZARD_SURFACES, the report's words for where it was offered.
export const SURFACES = Object.freeze(["overview", "getting_started", "setup", "maps_wizard"]);
const RULE = { overview: "push", getting_started: "push", setup: "pull", maps_wizard: "pull" };

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
      .then(r => { _info[rule] = r || { offer: false }; ctx.actions.renderRooms(); })
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

/** Setup's and the Mapping wizard's line (pull: Not now doesn't hide it). */
export function offerLine(ctx, surface) {
  if (!offered(ctx, surface)) return null;
  const { el } = ctx.helpers;
  const go = el("button", { class: "btn inline", "data-aiw": "try", style: "font-size:12px;margin-left:6px" }, "Try it →");
  go.addEventListener("click", () => openWizard(ctx, surface));
  return el("div", { "data-aiw": "line", style: "font-size:12px;color:#94a3b8;margin:6px 0;line-height:1.5" },
    ["Stuck? Claude can read your plan and draw the rooms for you (experimental).", go]);
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
    [back ? "Claude's rooms for your plan are waiting for you." : "Your floor plan is in. Want Claude to draw the rooms?", chip(el)]));
  card.appendChild(el("div", { style: "font-size:12px;color:#cbd5e1;line-height:1.55;margin:4px 0 8px" }, back
    ? "Pick up where you left off: check the rooms Claude found and press Save. One button takes it all back."
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
