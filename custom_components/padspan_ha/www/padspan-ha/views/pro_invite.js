// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
// See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
/**
 * Two ways to get PadSpan Pro free, offered up front without nagging.
 *
 * The invite: a free year of Pro the developer offers an install that sends
 * the usage report (pro_invite.py). The backend says only whether one is
 * open (pro_invite_open) and its last day; the token never reaches here.
 * Shown on Overview until it is answered: "Later" hides it for a week in
 * this browser, "No thanks" ends it for good and says so on the card. It is
 * also in Settings → PadSpan licence, so closing it never loses it.
 *
 * The tester card: testers get two years of Pro (the licence server's plan
 * 'tester') while the usage report stays on. It takes the trial milestone's
 * slot — once per install (tester_nudge_done, saved the moment it shows), only
 * after PadSpan has proven itself here, and answering it ends the trial's
 * nudge too, so nobody is pitched twice. "Sign me up" opens the sign-up in
 * Settings → Presence → Help improve PadSpan, where the report switch is.
 *
 * Both: administrators only (the panel checks), never on a kiosk or in
 * sample mode, never to an install that already has Pro.
 * tests/js/pro_invite.mjs drives this file.
 */
const { tierAtLeast, currentTier, currentEdition } = await import(`./editions.js${new URL(import.meta.url).search}`);

export const INVITE_TITLE = "A free year of PadSpan Pro";
export const INVITE_BODY = "Thanks for sending the usage report. Houses like yours are what PadSpan gets built against, " +
  "so here's a year of PadSpan Pro free: the Atlas lighting tools, Forensics, Busy Times and Locate.";
export const INVITE_TERMS = "No card, nothing renews, and when the year's up you go back to free. Anything you've made stays.";
export const INVITE_BUTTON = "Claim my free year";
export const INVITE_EMAIL_NOTE = "Your email goes to the developer with your key. It's never shared.";
export const INVITE_FINAL_NOTE = "No thanks is final. This won't come back.";
export const INVITE_LATER_DAYS = 7;
const _LATER_KEY = "padspan_pro_invite_later";

export const TESTER_CARD_TITLE = "Get PadSpan Pro free by testing it";
export const TESTER_CARD_BODY = "Testers get two years of PadSpan Pro free. In return the anonymous usage report stays on, " +
  "and the developer may email you when there's something new for your setup to try.";
export const TESTER_CARD_REPORT_OFF = "It needs the usage report on. Settings shows exactly what it sends before you switch it on.";
export const TESTER_CARD_BUTTON = "Sign me up";
// Settings → PadSpan licence, beside its button.
export const TESTER_CARD_BODY_SHORT = "Or test it: testers get PadSpan Pro free for two years.";
export const TESTER_MILESTONE_DAYS = 7;

const _EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const _errText = (e) => String((e && (e.message || e.error)) || e || "unknown error");

function _hasPro(s) {
  return s.pro_active === true && tierAtLeast(currentTier(s), "pro");
}

/** The tester offer is on unless the update check's answer switched it off
 *  (update_check._keep_offers → settings.offer_tester). Everything that
 *  promises testers free Pro reads this: the Overview card, the sign-up's
 *  line, the licence card's button. */
export function testerOfferOn(settings) {
  return (settings || {}).offer_tester !== false;
}

// The opt-in report counts these, once per page where it says so
// (telemetry.OFFER_EVENTS): whether the cards are seen at all, and what
// people do with them. Never who, never the email.
const _counted = new Set();
function _count(host, name, once) {
  if (!host || !host.telemetry) return;
  if (once) { if (_counted.has(name)) return; _counted.add(name); }
  try { if (host && host.telemetry) host.telemetry(name); } catch (_) { /* never fatal */ }
}

/** "2026-12-31" → "December 31". */
export function untilText(day) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(day || ""));
  if (!m) return "";
  const months = ["January", "February", "March", "April", "May", "June", "July", "August",
    "September", "October", "November", "December"];
  return `${months[Number(m[2]) - 1] || ""} ${Number(m[3])}`;
}

// A key someone paid for and that still works (Bright Pro, say): claiming
// would put a one-year key in its place, so the card is not offered.
function _paidKeyActive(s) {
  return s.pro_active === true && s.license_is_trial !== true;
}

/** An invite is open, this is the full edition (the card names Forensics,
 *  Busy Times and Locate), and there is no Pro or working paid key here. A
 *  trial or a lapsed key may take it. */
export function inviteOpen(settings) {
  const s = settings || {};
  return s.pro_invite_open === true && s.offer_invite !== false && currentEdition(s) !== "bright"
    && !_hasPro(s) && !_paidKeyActive(s);
}

/** The Overview card is due: open, and not put off with "Later" this week. */
export function inviteDue(settings, nowMs = Date.now(), storage = globalThis.localStorage) {
  if (!inviteOpen(settings)) return false;
  let later = 0;
  try { later = Number(storage && storage.getItem(_LATER_KEY)) || 0; } catch (_) { /* no storage: always due */ }
  return !(later > 0 && nowMs - later < INVITE_LATER_DAYS * 86400e3);
}

export function inviteLater(nowMs = Date.now(), storage = globalThis.localStorage) {
  try { if (storage) storage.setItem(_LATER_KEY, String(nowMs)); } catch (_) { /* this page only */ }
}

/** The tester card is due: never answered (a backend without the key reads
 *  as "not known", never "due"), not a tester already, no Pro, and either
 *  someone real is on the map or PadSpan has run here for a week. */
export function testerCardDue(settings, positioned, nowMs = Date.now()) {
  const s = settings || {};
  if (!("tester_nudge_done" in s) || s.tester_nudge_done) return false;
  if (s.tester_signed_up === true || s.pro_has_key !== false || _hasPro(s)) return false;
  if (currentEdition(s) === "bright" || !testerOfferOn(s)) return false;
  if (positioned) return true;
  const since = Number(s.first_seen_ts);
  return Number.isFinite(since) && since > 0 && nowMs - since * 1000 >= TESTER_MILESTONE_DAYS * 86400e3;
}

// This page's claim state: what was typed, a request in flight, the last
// failure, and a claim that worked (kept so the card can say so).
const _claim = { email: "", busy: false, error: "", done: null };
export function _resetProInvite() { Object.assign(_claim, { email: "", busy: false, error: "", done: null }); _counted.clear(); }

const _cardStyle = "background:#0a1f14;border:1px solid #1a4228;border-radius:8px;padding:10px 14px;margin-bottom:12px;text-align:left";

/**
 * The invite card, or null.
 * host = { el, settings, callWS(type, data) -> Promise, toast(msg, isErr), rerender(), onSettings(settings) }
 * opts = { onLater, onDeclined, onClose, surface ("overview" | "settings") }
 */
export function inviteCard(host, opts = {}) {
  const el = host.el;
  if (_claim.done) {
    const note = el("div", { "data-invite": "claimed", style: _cardStyle + ";font-size:12px;color:#a7f3d0;line-height:1.55;display:flex;gap:8px;align-items:flex-start" },
      [el("div", { style: "flex:1" }, "✓ PadSpan Pro is on for a year. Your key is also on its way to " + _claim.done + ".")]);
    if (typeof opts.onClose === "function") {
      const x = el("button", { class: "btn inline", "data-invite": "close", title: "Hide this",
        style: "font-size:12px;padding:0 8px;color:#94a3b8" }, "✕");
      x.addEventListener("click", () => opts.onClose());
      note.appendChild(x);
    }
    return note;
  }
  if (!inviteOpen(host.settings)) return null;
  _count(host, "pro_invite_shown:" + (opts.surface === "settings" ? "settings" : "overview"), true);
  const card = el("div", { "data-invite": "card", style: _cardStyle });
  const head = el("div", { style: "display:flex;align-items:center;gap:8px;margin-bottom:4px" },
    [el("div", { style: "font-weight:700;font-size:13px;color:#52b788" }, INVITE_TITLE)]);
  if (typeof opts.onLater === "function") {
    const later = el("button", { class: "btn inline", "data-invite": "later", title: "Hide this for a week",
      style: "margin-left:auto;font-size:11px;padding:2px 8px;color:#94a3b8" }, "Later");
    later.addEventListener("click", () => { _count(host, "pro_invite_later"); opts.onLater(); });
    head.appendChild(later);
  }
  card.appendChild(head);
  card.appendChild(el("div", { style: "font-size:12px;color:#cbd5e1;line-height:1.55" }, INVITE_BODY));
  const until = untilText(host.settings.pro_invite_until);
  card.appendChild(el("div", { style: "font-size:12px;color:#94a3b8;line-height:1.55;margin:4px 0 8px" },
    INVITE_TERMS + (until ? ` Open until ${until}.` : "")));

  const input = el("input", { type: "email", "data-invite": "email", autocomplete: "email", maxlength: "254",
    placeholder: "you@example.com",
    style: "flex:1;min-width:180px;max-width:300px;box-sizing:border-box;background:#0a150e;border:1px solid #2d5a3d;" +
      "border-radius:6px;color:#e2e8f0;padding:5px 8px;font-size:13px" });
  input.value = _claim.email;
  input.addEventListener("input", () => { _claim.email = input.value; });
  const go = el("button", { class: "btn inline", "data-invite": "claim",
    style: "background:#0a2a1a;border-color:#52b788;color:#52b788;font-weight:700;font-size:12px" },
    _claim.busy ? "Claiming…" : INVITE_BUTTON);
  const no = el("button", { class: "btn inline", "data-invite": "decline", style: "color:#94a3b8;font-size:12px" }, "No thanks");
  if (_claim.busy) { go.disabled = true; input.disabled = true; no.disabled = true; }

  const claim = async () => {
    if (_claim.busy) return;
    const email = String(_claim.email || "").trim();
    if (!_EMAIL_RE.test(email)) { _claim.error = "That email address doesn't look right."; host.rerender(); return; }
    _claim.busy = true; _claim.error = ""; host.rerender();
    let r = null, why = "";
    try {
      r = await host.callWS("padspan_ha/pro_invite_claim", { email });
      if (!(r && r.ok)) why = (r && r.message) || "The invite could not be claimed.";
    } catch (e) { why = _errText(e); }
    _claim.busy = false;
    if (why) {
      _claim.error = why;
      _count(host, "pro_invite_claim_failed");
      host.toast("Not claimed: " + why, true);
    } else {
      _claim.done = email; _claim.email = "";
      _count(host, "pro_invite_claimed");
      host.toast("PadSpan Pro is on. Thanks for helping.");
      if (r.settings) host.onSettings(r.settings);
    }
    host.rerender();
  };
  go.addEventListener("click", claim);
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") claim(); });
  no.addEventListener("click", async () => {
    if (_claim.busy) return;
    _claim.busy = true; host.rerender();
    try {
      const r = await host.callWS("padspan_ha/pro_invite_decline", {});
      if (r && r.settings) host.onSettings(r.settings);
      _count(host, "pro_invite_declined");
      if (typeof opts.onDeclined === "function") opts.onDeclined();
    } catch (e) { host.toast("Couldn't save that: " + _errText(e), true); }
    _claim.busy = false; host.rerender();
  });
  card.appendChild(el("div", { style: "display:flex;gap:8px;flex-wrap:wrap;align-items:center" }, [input, go, no]));
  card.appendChild(el("div", { class: "muted", style: "font-size:11px;margin-top:4px" },
    INVITE_EMAIL_NOTE + " " + INVITE_FINAL_NOTE));
  if (_claim.error) {
    card.appendChild(el("div", { "data-invite": "error", style: "font-size:12px;color:#f87171;margin-top:6px;line-height:1.5" }, _claim.error));
  }
  return card;
}

/**
 * The tester card. host = { el, settings }; onSignUp / onNo / onClose are the
 * panel's (it saves tester_nudge_done and navigates).
 */
export function testerCard(host, { onSignUp, onNo, onClose }) {
  const el = host.el;
  const s = host.settings || {};
  _count(host, "free_pro_card_shown", true);
  const card = el("div", { "data-tester-card": "card", style: _cardStyle });
  const close = el("button", { class: "btn inline", "data-tester-card": "close", title: "Hide this",
    style: "margin-left:auto;font-size:12px;padding:0 8px;color:#94a3b8" }, "✕");
  close.addEventListener("click", () => { _count(host, "free_pro_card_no"); onClose(); });
  card.appendChild(el("div", { style: "display:flex;align-items:center;gap:8px;margin-bottom:4px" }, [
    el("div", { style: "font-weight:700;font-size:13px;color:#52b788" }, TESTER_CARD_TITLE), close]));
  card.appendChild(el("div", { style: "font-size:12px;color:#cbd5e1;line-height:1.55" }, TESTER_CARD_BODY));
  if (s.telemetry_enabled !== true) {
    card.appendChild(el("div", { "data-tester-card": "report-off", style: "font-size:12px;color:#94a3b8;line-height:1.55;margin-top:4px" },
      TESTER_CARD_REPORT_OFF));
  }
  const yes = el("button", { class: "btn inline", "data-tester-card": "yes",
    style: "background:#0a2a1a;border-color:#52b788;color:#52b788;font-weight:700" }, TESTER_CARD_BUTTON);
  yes.addEventListener("click", () => onSignUp());
  const no = el("button", { class: "btn inline", "data-tester-card": "no", style: "color:#94a3b8" }, "No thanks");
  no.addEventListener("click", () => { _count(host, "free_pro_card_no"); onNo(); });
  card.appendChild(el("div", { style: "display:flex;gap:8px;flex-wrap:wrap;margin-top:8px" }, [yes, no]));
  return card;
}

/** The host for a panel view's ctx (Settings → PadSpan licence). */
export function inviteHostFromCtx(ctx) {
  return {
    el: ctx.helpers.el,
    settings: ctx.state.settings || {},
    callWS: (type, data) => ctx.actions.wsCall(type, data),
    toast: (m, isErr) => { if (ctx.toast) ctx.toast(m, isErr); },
    rerender: () => ctx.actions.renderRooms(),
    telemetry: (name) => { if (ctx.actions.telemetryEvent) ctx.actions.telemetryEvent(name); },
    onSettings: (s) => { ctx.state.settings = s; if (ctx.actions.renderNav) ctx.actions.renderNav(); },
  };
}
