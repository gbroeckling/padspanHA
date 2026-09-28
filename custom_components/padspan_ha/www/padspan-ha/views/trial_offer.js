// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
// See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
/**
 * The 90-day free trial, offered where people meet the paid wall.
 *
 * One card, used by every surface that offers the trial: the Overview's
 * Getting started card, the Atlas sidebar panel, Mapping → Atlas, a refused
 * light placement, Locate, Busy Times and Settings → PadSpan licence. It
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
const { BUY_URL, PRO_PRICE, PRO_LIFETIME_PRICE, proLifetimeOpen, tierAtLeast, currentTier } =
  await import(`./editions.js${new URL(import.meta.url).search}`);

export const TRIAL_DAYS = 90;
// Where the card can be shown — the usage report counts offers, starts and
// failures by these names only (telemetry.py TRIAL_SURFACES, same list).
export const TRIAL_SURFACES = Object.freeze(["overview", "atlas", "placement", "maps", "locate", "busy_times", "settings"]);
export const TRIAL_TITLE = "90-day free trial, no card";
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

/** The pitch line for a surface. `feature` names a Pro feature (Locate,
 *  Busy Times) whose gate the card sits in — the trial does not unlock
 *  those, and the card says so rather than letting someone find out after. */
export function trialPitch(surface, feature) {
  if (feature) {
    return `${feature} needs a PadSpan Pro key. The free trial covers the lighting side: ` +
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
    card.appendChild(el("div", { style: "font-size:11px;margin-top:6px" }, [
      el("a", { href: BUY_URL, target: "_blank", rel: "noopener", "data-trial": "buy",
        style: "color:#fbbf24;font-weight:600;text-decoration:none" }, "Or buy PadSpan Pro — " + PRO_PRICE
          + (proLifetimeOpen() ? ", or " + PRO_LIFETIME_PRICE + " for life until October 31" : "")),
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

/** The host for a panel view's ctx. */
export function trialOfferFromCtx(ctx, surface, opts = {}) {
  const host = {
    el: ctx.helpers.el,
    settings: ctx.state.settings,
    isAdmin: !!(ctx.hass && ctx.hass.user && ctx.hass.user.is_admin),
    callWS: (type, data) => ctx.actions.wsCall(type, data),
    telemetry: (name) => { if (ctx.actions.telemetryEvent) ctx.actions.telemetryEvent(name); },
    toast: (m, isErr) => { if (ctx.toast) ctx.toast(m, isErr); },
    rerender: () => ctx.actions.renderRooms(),
    onStarted: (r) => {
      if (r && r.settings) ctx.state.settings = r.settings;
      if (ctx.actions.renderNav) ctx.actions.renderNav();
    },
  };
  return trialOfferCard(host, surface, opts);
}
