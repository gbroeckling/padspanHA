// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
// See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
/**
 * The 90-day free trial, offered where people meet the paid wall.
 *
 * One card, used by every surface that offers the trial: the Overview's
 * Getting started card, the Atlas sidebar panel, Mapping → Atlas, a refused
 * light placement, Locate, Busy Times and Settings → PadSpan licence — and,
 * for free installs that never meet a wall, three quiet ones: a line in the
 * "updated to vX" banner, a one-time milestone card on Overview and an entry
 * under the PadSpan sidebar menu (panel.js). It
 * used to be a window.prompt() behind one button in Settings, and in the
 * first months it was started twice.
 *
 * What the trial is: a real PadSpan Bright Pro key minted by
 * padspan_ha/trial_start (ws_forensics.py) — the lighting half, 90 days,
 * one per home (the licence server decides). The command is admin-only, so
 * everyone else sees a line saying an administrator has to start it and no
 * email field. The email goes to that one command and nowhere else: never
 * into the usage report, whose events here carry only the surface's name.
 *
 * Shown only while there is no key at all and the tier is below "bright"
 * (trialOfferable). A lapsed key — trial or bought — is not offered a new
 * trial; the licence card handles renewing.
 *
 * Hosts differ (the panel's ctx, the Atlas sidebar's own element), so the
 * card takes a small host object: trialOfferFromCtx builds one from a panel
 * ctx. tests/js/trial_offer.mjs drives it.
 */
const { BUY_URL, PRO_PRICE, PRO_LIFETIME_PRICE, proLifetimeOpen, tierAtLeast, currentTier, currentEdition } =
  await import(`./editions.js${new URL(import.meta.url).search}`);

export const TRIAL_DAYS = 90;
// Where the card can be shown — the usage report counts offers, starts and
// failures by these names only (telemetry.py TRIAL_SURFACES, same list).
// update_banner: a line in the Overview's "updated to vX" banner. milestone:
// the one-time Overview card (trialMilestoneDue). sidebar: the quiet entry
// under the PadSpan sidebar menu — the one placement a Bright build has too.
export const TRIAL_SURFACES = Object.freeze(["overview", "atlas", "placement", "maps", "locate", "busy_times", "settings",
  "update_banner", "milestone", "sidebar"]);
// The placements that are not a paid wall.
const _QUIET_SURFACES = ["update_banner", "milestone", "sidebar"];
export const TRIAL_TITLE = "90-day free trial, no card";
// Said wherever the trial is offered: the trial is the lighting half, and
// nothing about the free presence product changes whatever anyone answers.
export const TRIAL_HONESTY = "The presence tracking you're using stays free.";
export const TRIAL_NEWS_LINE = "New: try the lighting map free for 90 days, no card.";
// The update banner says it once: in the banner for the update that brought
// the trial (an install that was on a version before this one). Every later
// "updated to vX" banner goes back to the older Pro pitch (trialNewsDue).
export const TRIAL_NEWS_BEFORE = "0.38.87";
export const TRIAL_MILESTONE_TITLE = "PadSpan's working in your house.";
export const TRIAL_MILESTONE_BODY = "The lighting half puts every light on this same map — tap to switch, " +
  "hold for controls. 90 days free, no card.";
export const TRIAL_SIDEBAR_LABEL = "💡 Lighting · free trial";
export const TRIAL_MILESTONE_DAYS = 7;
export const TRIAL_BUTTON = "Start 90-day free trial";
export const TRIAL_EMAIL_NOTE = "Your email is only used to send your key; one trial per home.";
export const TRIAL_NOT_ADMIN = "An administrator of this Home Assistant has to start the trial.";

const _EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const _errText = (e) => String((e && (e.message || e.error)) || e || "unknown error");

/** True when the trial may be offered: no key of any kind, and a tier below
 *  the lighting product. Unknown settings (not loaded yet) never offer it —
 *  a licensed house must not see a trial flash past on first paint. */
export function trialOfferable(settings) {
  const s = settings || {};
  if (s.pro_has_key !== false) return false;
  return !tierAtLeast(currentTier(s), "bright");
}

/** a < b, for x.y.z versions ("" and anything unreadable count as 0). */
function _versionBefore(a, b) {
  const p = (v) => String(v || "").split(".").map(n => parseInt(n, 10) || 0);
  const x = p(a), y = p(b);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) < (y[i] || 0);
  }
  return false;
}

/** True when the "updated to vX" banner carries the trial line: the trial
 *  is offerable, the install has not answered the milestone card
 *  (trial_nudge_done), it is not a kiosk (?kiosk=1), and the version the
 *  banner is updating FROM is older than the trial — so the line is news in
 *  one banner only, never in every update after it. */
export function trialNewsDue(settings, seenVersion, kiosk) {
  const s = settings || {};
  if (kiosk || s.trial_nudge_done === true) return false;
  if (!trialOfferable(s)) return false;
  return !!seenVersion && _versionBefore(seenVersion, TRIAL_NEWS_BEFORE);
}

/** The presence line ("stays free") only where presence is in view: a Bright
 *  build shows no presence unless its reveal switch is on. */
export function trialHonestyShown(settings) {
  const s = settings || {};
  return currentEdition(s) !== "bright" || !!s.bright_reveal_presence;
}

/** True when the trial was started from this surface on this page. */
export function trialStartedHere(surface) {
  return !!(_state[surface] && _state[surface].done);
}

/** True when the Overview's one-time milestone card is due: the trial is
 *  offerable, the install has never answered it (trial_nudge_done — a key
 *  an older backend does not send reads as "not known", never as "due"),
 *  and either someone real is on the map (`positioned`, panel.js's
 *  Getting started rule, live data only) or PadSpan has been running here
 *  for TRIAL_MILESTONE_DAYS (first_seen_ts, stamped by the backend). Sample
 *  mode, kiosks and "one card at a time" are the panel's to decide. */
export function trialMilestoneDue(settings, positioned, nowMs = Date.now()) {
  const s = settings || {};
  if (!trialOfferable(s)) return false;
  if (!("trial_nudge_done" in s) || s.trial_nudge_done) return false;
  if (positioned) return true;
  const since = Number(s.first_seen_ts);
  return Number.isFinite(since) && since > 0 && nowMs - since * 1000 >= TRIAL_MILESTONE_DAYS * 86400e3;
}

/** The pitch line for a surface. `feature` names a Pro feature (Locate,
 *  Busy Times) whose gate the card sits in — the trial does not unlock
 *  those, and the card says so rather than letting someone find out after.
 *  (The gate right above already says the feature needs Pro.) */
export function trialPitch(surface, feature) {
  if (feature) {
    return `The trial doesn't unlock ${feature}. It covers the lighting side: ` +
      "every light placed exactly where it hangs on your floor plan, with shapes, sizes and WLED strips.";
  }
  if (surface === "settings") {
    return "Try the whole lighting product on your own house. Nothing is taken away when it ends — " +
      "editing just goes back to the free view.";
  }
  return "See every light exactly where it hangs on your floor plan — fixture shapes and sizes, " +
    "WLED strips and Showcase. Try it on your own house.";
}

// Per surface, for this page: what was typed, whether a request is out, the
// last failure, and whether it worked. Survives the re-renders a poll causes.
const _state = {};
const _shown = new Set();
function _st(surface) {
  return _state[surface] || (_state[surface] = { email: "", busy: false, error: "", done: null });
}

/** Count a surface's offer as seen, once per page — for a placement that is
 *  seen before its card is opened (the milestone card). The card itself then
 *  does not count it again. */
export function trialOfferSeen(surface, telemetry) {
  if (_shown.has(surface)) return;
  _shown.add(surface);
  try { if (telemetry) telemetry("trial_offer_shown:" + surface); } catch (e) { /* never fatal */ }
}

/** Forget this page's card state (tests). */
export function _resetTrialOffer() {
  for (const k of Object.keys(_state)) delete _state[k];
  _shown.clear();
}

/**
 * The card, or null when there is nothing to offer.
 *
 * host = { el, settings, isAdmin, callWS(type, data) -> Promise, telemetry(name),
 *          toast(msg, isErr), rerender(), onStarted(result) }
 * opts = { feature, buy (default true), onDismiss, compact }
 */
export function trialOfferCard(host, surface, opts = {}) {
  const el = host.el;
  const st = _st(surface);
  if (st.done) return _startedCard(el, st.done);
  if (!trialOfferable(host.settings)) return null;
  const tel = (name) => { try { if (host.telemetry) host.telemetry(name); } catch (e) { /* never fatal */ } };
  if (!_shown.has(surface)) { _shown.add(surface); tel("trial_offer_shown:" + surface); }

  const card = el("div", { "data-trial": "card", "data-surface": surface,
    style: "padding:10px 12px;border:1px solid #2d5a3d;border-radius:8px;background:#0a1f14;margin:8px 0;text-align:left" });
  const head = el("div", { style: "display:flex;align-items:center;gap:8px" }, [
    el("div", { style: "font-weight:700;font-size:13px;color:#8ee5b4" }, TRIAL_TITLE),
  ]);
  if (typeof opts.onDismiss === "function") {
    const x = el("button", { class: "btn inline", "data-trial": "dismiss", title: "Hide this",
      style: "margin-left:auto;font-size:11px;padding:2px 8px;color:#94a3b8" }, "Not now");
    x.addEventListener("click", () => opts.onDismiss());
    head.appendChild(x);
  }
  card.appendChild(head);
  card.appendChild(el("div", { "data-trial": "pitch", style: "font-size:12px;color:#cbd5e1;line-height:1.55;margin:4px 0 8px" },
    trialPitch(surface, opts.feature)));
  // A host that already says it right above the card (the update banner,
  // the milestone card) passes honesty: false rather than repeat it. A
  // Bright build shows no presence, so there it is not said at all.
  if (opts.honesty !== false && trialHonestyShown(host.settings)) {
    card.appendChild(el("div", { "data-trial": "honesty", style: "font-size:12px;color:#94a3b8;margin:-4px 0 8px" }, TRIAL_HONESTY));
  }

  if (!host.isAdmin) {
    card.appendChild(el("div", { "data-trial": "not-admin", class: "muted", style: "font-size:12px" }, TRIAL_NOT_ADMIN));
  } else {
    const input = el("input", { type: "email", "data-trial": "email", autocomplete: "email", maxlength: "254",
      placeholder: "you@example.com",
      style: "flex:1;min-width:180px;max-width:300px;box-sizing:border-box;background:#0a150e;border:1px solid #2d5a3d;" +
        "border-radius:6px;color:#e2e8f0;padding:5px 8px;font-size:13px" });
    input.value = st.email;
    input.addEventListener("input", () => { st.email = input.value; });
    const go = el("button", { class: "btn inline", "data-trial": "start",
      style: "background:#0a2a1a;border-color:#52b788;color:#52b788;font-weight:700;font-size:12px" },
      st.busy ? "Starting…" : TRIAL_BUTTON);
    if (st.busy) { go.disabled = true; input.disabled = true; }
    const start = async () => {
      if (st.busy) return;
      const email = String(st.email || "").trim();
      if (!_EMAIL_RE.test(email)) {
        st.error = "That email address doesn't look right.";
        if (host.rerender) host.rerender();
        return;
      }
      st.busy = true;
      st.error = "";
      if (host.rerender) host.rerender();
      let r = null, why = "";
      try {
        r = await host.callWS("padspan_ha/trial_start", { email });
        if (!(r && r.ok)) why = (r && r.message) || "Could not start a trial for this home.";
      } catch (e) {
        why = _errText(e);
      }
      st.busy = false;
      if (why) {
        st.error = why;
        tel("trial_failed:" + surface);
        if (host.toast) host.toast("Trial not started: " + why, true);
      } else {
        st.done = { days_left: r.days_left };
        st.email = "";
        tel("trial_started:" + surface);
        if (host.toast) host.toast("Your 90-day free trial has started.");
        try { if (host.onStarted) host.onStarted(r); } catch (e) { console.warn("PadSpan: trial onStarted failed", e); }
      }
      if (host.rerender) host.rerender();
    };
    go.addEventListener("click", start);
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") start(); });
    card.appendChild(el("div", { style: "display:flex;gap:8px;flex-wrap:wrap;align-items:center" }, [input, go]));
    card.appendChild(el("div", { "data-trial": "note", class: "muted", style: "font-size:11px;margin-top:4px" }, TRIAL_EMAIL_NOTE));
  }
  if (st.error) {
    card.appendChild(el("div", { "data-trial": "error", style: "font-size:12px;color:#f87171;margin-top:6px;line-height:1.5" }, st.error));
  }
  if (opts.buy !== false) {
    // On the three quiet placements nobody hit a wall, so the trial button
    // is the offer and buying is a small grey link under it; the paywalls
    // keep the amber line.
    const quiet = _QUIET_SURFACES.includes(surface);
    const buyText = "Or buy PadSpan Pro — " + PRO_PRICE
      + (proLifetimeOpen() ? ", or " + PRO_LIFETIME_PRICE + " for life until October 31" : "");
    const buyStyle = quiet ? "color:#94a3b8;text-decoration:underline" : "color:#fbbf24;font-weight:600;text-decoration:none";
    card.appendChild(el("div", { style: "font-size:11px;margin-top:6px" }, [
      // A wall screen can't close the tab a link opens: say where instead.
      newTabOk(host.kiosk)
        ? el("a", { href: BUY_URL, target: "_blank", rel: "noopener", "data-trial": "buy", style: buyStyle }, buyText)
        : el("span", { "data-trial": "buy-text", style: buyStyle.replace("text-decoration:underline", "text-decoration:none") },
          buyText + " at padspan.traks.ca"),
    ]));
  }
  return card;
}

function _startedCard(el, done) {
  const days = Number(done && done.days_left);
  return el("div", { "data-trial": "started",
    style: "padding:10px 12px;border:1px solid #2d5a3d;border-radius:8px;background:#0a1f14;margin:8px 0;font-size:12px;color:#a7f3d0;line-height:1.55" },
    "✓ Your 90-day free trial has started" + (Number.isFinite(days) && days > 0 ? ` (${days} days left)` : "") +
    ". Place your lights in Mapping → Atlas — drag each one to where it really hangs.");
}

/**
 * Can a link open a new tab here that someone can close again? Not on a
 * ?kiosk=1 panel, and not on a page that fills the whole screen (Chrome
 * --kiosk on a wall touch screen: no tab bar, no keyboard, so a new tab
 * strands the screen). Same rule as views/release_notes.js notesHistoryLink.
 */
export function newTabOk(kiosk, win = globalThis) {
  if (kiosk) return false;
  try {
    const s = win.screen;
    if (s && win.innerWidth >= s.width - 1 && win.innerHeight >= s.height - 1) return false;
  } catch (_) { /* nothing to measure: a normal browser */ }
  return true;
}

/** The host for a panel view's ctx. */
export function trialOfferFromCtx(ctx, surface, opts = {}) {
  return trialOfferCard(trialHostFromCtx(ctx), surface, opts);
}

/** The host object trialOfferFromCtx uses, for a caller that re-renders
 *  something other than the view (the panel's sidebar entry). */
export function trialHostFromCtx(ctx) {
  return {
    el: ctx.helpers.el,
    settings: ctx.state.settings,
    isAdmin: !!(ctx.hass && ctx.hass.user && ctx.hass.user.is_admin),
    kiosk: !!(ctx.state && ctx.state.kioskMode),
    callWS: (type, data) => ctx.actions.wsCall(type, data),
    telemetry: (name) => { if (ctx.actions.telemetryEvent) ctx.actions.telemetryEvent(name); },
    toast: (m, isErr) => { if (ctx.toast) ctx.toast(m, isErr); },
    rerender: () => ctx.actions.renderRooms(),
    onStarted: (r) => {
      if (r && r.settings) ctx.state.settings = r.settings;
      if (ctx.actions.renderNav) ctx.actions.renderNav();
    },
  };
}
