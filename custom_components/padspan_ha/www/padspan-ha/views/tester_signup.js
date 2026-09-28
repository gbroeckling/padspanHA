// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
// See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
/**
 * Become a tester — inside Settings → Presence → Help improve PadSpan.
 *
 * The one place PadSpan asks for contact details, so it stays apart from the
 * anonymous usage report above it: its own section, its own consent box, its
 * own Send button and its own backend (tester.py → tester.php — never the
 * report's address). Nothing here counts a usage event or touches the report.
 *
 * Shown while the report is on. Someone already signed up always sees their
 * status and "Stop being a tester", whatever the report switch says —
 * withdrawing must always be possible. Administrators only: the four
 * padspan_ha/tester_* commands are admin-only, and a non-admin sees one line.
 *
 * The checks in testerProblems() are tester.py's clean_form(), in the same
 * words; tests/test_tester_signup_ui.py runs both on the same cases.
 */

// The same keys as tester.py INTERESTS and tester.php $INTERESTS.
export const TESTER_INTERESTS = [
  ["findmy", "AirTags / Find My tags"],
  ["wled", "WLED strings (incl. 5–6 channel)"],
  ["floors", "Several floors"],
  ["calibration", "Guided Calibration"],
  ["iphone_irk", "iPhones / IRK phones"],
  ["bermuda", "Running alongside Bermuda"],
  ["esphome_proxies", "ESPHome Bluetooth proxies"],
  ["other", "Other"],
];
// Characters, as tester.py counts them.
export const TESTER_LIMITS = { email: 254, github: 39, name: 64, interests_other: 80, notes: 500, timezone: 64 };
// Character for character the patterns in tester.py (and tester.php).
export const TESTER_PATTERNS = {
  email: /^[A-Za-z0-9._%+'-]{1,64}@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*\.[A-Za-z]{2,24}$/,
  github: /^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$/,
  timezone: /^[A-Za-z][A-Za-z0-9_+-]*(?:\/[A-Za-z0-9_+-]+){0,2}$/,
};
export const TESTER_SECRETS = [
  ["a PadSpan licence key", /\b[Pp][Ss][Pp][Aa][Nn]-[A-Za-z0-9-]{8,}/],
  ["a long hex string (a key or an IRK)", /\b[0-9A-Fa-f]{32,}\b/],
  ["a login token", /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/],
  ["a long key or token", /(?=[A-Za-z0-9+=_]*[0-9])(?=[A-Za-z0-9+=_]*[A-Za-z])[A-Za-z0-9+=_]{40,}/],
];

const _chars = (s) => [...String(s)].length;
const _oneLine = (v) => String(v ?? "").replace(/[\r\n\t]/g, " ").replace(/[\x00-\x08\x0b-\x1f\x7f]/g, "").trim();
const _multiLine = (v) => String(v ?? "").replace(/\r\n?/g, "\n").replace(/[\x00-\x08\x0b-\x1f\x7f]/g, "").trim();
const _github = (v) => { const g = _oneLine(v); return g.startsWith("@") ? g.slice(1) : g; };
const _errText = (e) => String((e && (e.message || e.error)) || e || "unknown error");

/** What secret `text` looks like it contains ("" if none). */
export function looksLikeSecret(text){
  for (const [what, rx] of TESTER_SECRETS) if (rx.test(String(text || ""))) return what;
  return "";
}

/** The panel's copy of tester.py clean_form: [] means it may be sent. */
export function testerProblems(form){
  const f = form || {};
  const L = TESTER_LIMITS;
  const p = [];
  const email = _oneLine(f.email);
  if (!email) p.push("Enter an email address.");
  else if (_chars(email) > L.email || !TESTER_PATTERNS.email.test(email)) p.push("That email address doesn't look right.");
  const github = _github(f.github);
  if (github && !TESTER_PATTERNS.github.test(github)) p.push("That GitHub username doesn't look right.");
  const name = _oneLine(f.name);
  if (_chars(name) > L.name) p.push(`Name is too long (${L.name} characters at most).`);
  const keys = TESTER_INTERESTS.map(([k]) => k);
  const picked = Array.isArray(f.interests) ? f.interests : [];
  for (const i of picked) if (!keys.includes(i)) p.push(`Unknown choice under what you'd like to test: ${String(i).slice(0, 40)}`);
  const other = picked.includes("other") ? _oneLine(f.other) : "";
  if (_chars(other) > L.interests_other) p.push(`'Other' is too long (${L.interests_other} characters at most).`);
  const notes = _multiLine(f.notes);
  if (_chars(notes) > L.notes) p.push(`Notes are too long (${L.notes} characters at most).`);
  const tz = _oneLine(f.timezone);
  if (tz && (_chars(tz) > L.timezone || !TESTER_PATTERNS.timezone.test(tz))) {
    p.push("That time zone doesn't look right (for example America/Vancouver).");
  }
  for (const [where, text] of [["your name", name], ["the GitHub username", github], ["'Other'", other], ["your notes", notes]]) {
    const what = looksLikeSecret(text);
    if (what) p.push(`That looks like ${what} in ${where} — please take it out. A sign-up never needs one.`);
  }
  if (f.consent !== true) p.push("Tick the box to agree to be contacted.");
  return p;
}

/** The fields padspan_ha/tester_preview and padspan_ha/tester_signup take.
 *  Only the ticked setup lines are named; the backend fills in their values. */
export function testerMessage(form, lines){
  const f = form || {};
  const picked = Array.isArray(f.interests) ? f.interests : [];
  const off = Array.isArray(f.setupOff) ? f.setupOff : [];
  return {
    email: _oneLine(f.email), github: _github(f.github), name: _oneLine(f.name),
    interests: TESTER_INTERESTS.map(([k]) => k).filter(k => picked.includes(k)),
    interests_other: picked.includes("other") ? _oneLine(f.other) : "",
    setup_keys: (Array.isArray(lines) ? lines : []).map(l => l && l.key).filter(k => k && !off.includes(k)),
    notes: _multiLine(f.notes), timezone: _oneLine(f.timezone),
    consent: f.consent === true, link_reports: f.link === true,
  };
}

/** The form's starting point: what was sent last time, or blank. Consent is
 *  never pre-ticked — it is asked every time something is sent. */
export function testerDraft(status){
  const s = status || {};
  const r = s.record || {};
  return {
    email: r.email || "", github: r.github || "", name: r.name || "",
    interests: Array.isArray(r.interests) ? r.interests.slice() : [],
    other: r.interests_other || "", notes: r.notes || "",
    timezone: r.timezone || s.default_timezone || "",
    setupOff: Array.isArray(r.setup_off) ? r.setup_off.slice() : [],
    consent: false, link: r.linked === true,
  };
}

function _day(iso){
  const d = new Date(String(iso || ""));
  return isNaN(d.getTime()) ? String(iso || "") : d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function _loadTesterStatus(ctx, st){
  st.loading = true;
  ctx.actions.wsCall("padspan_ha/tester_status").then((r) => {
    st.status = r || {};
    st.loadError = "";
  }).catch((e) => {
    st.loadError = _errText(e);
  }).finally(() => {
    st.loading = false;
    ctx.actions.renderRooms();
  });
}

/**
 * The section, or null when there is nothing to show: report off and not
 * signed up. `reportOn` is settings.telemetry_enabled, as the card reads it.
 */
export function testerSection(ctx, reportOn){
  const { el } = ctx.helpers;
  const settings = ctx.state.settings || {};
  const st = ctx.state._tester;
  // An administrator's loaded status is the truth; before it arrives (and
  // for everyone else) the settings flag says whether there is a sign-up.
  const signedUp = st && st.status ? st.status.signed_up === true : settings.tester_signed_up === true;
  if (!reportOn && !signedUp) return null;
  const box = el("div", { "data-tester": "section",
    style: "margin-top:16px;padding-top:14px;border-top:1px solid #1e3a2a" });
  box.appendChild(el("div", { style: "font-weight:700;font-size:14px;color:#a7f3d0;margin-bottom:6px" }, "Become a tester"));
  const isAdmin = !!(ctx.hass && ctx.hass.user && ctx.hass.user.is_admin);
  if (!isAdmin) {
    box.appendChild(el("div", { class: "muted", "data-tester": "not-admin", style: "font-size:12px" }, signedUp
      ? "This Home Assistant is signed up as a tester. An administrator can update it or stop it."
      : "An administrator can sign up here to help test new PadSpan features."));
    return box;
  }
  const s = st || (ctx.state._tester = { status: null, loading: false, loadError: "", open: false,
    form: null, preview: null, problems: [], busy: false });
  if (!s.status) {
    if (s.loadError) {
      const again = el("button", { class: "btn inline", "data-tester": "retry" }, "Try again");
      again.addEventListener("click", () => { s.loadError = ""; ctx.actions.renderRooms(); });
      box.appendChild(el("div", { style: "font-size:12px;color:#f87171;margin-bottom:8px" },
        "Could not load your tester details: " + s.loadError));
      box.appendChild(again);
    } else {
      if (!s.loading) _loadTesterStatus(ctx, s);
      box.appendChild(el("div", { class: "muted", style: "font-size:12px" }, "Loading…"));
    }
    return box;
  }
  if (s.open) {
    box.appendChild(_testerForm(ctx, s));
    return box;
  }
  if (s.status.signed_up === true) box.appendChild(_testerSignedUp(ctx, s, reportOn));
  else if (reportOn) box.appendChild(_testerInvite(ctx, s));
  return box;
}

function _testerProblemsBox(ctx, s){
  const { el } = ctx.helpers;
  const list = el("div", { "data-tester": "problems", style: "font-size:12px;color:#f87171;margin-top:8px;line-height:1.5" });
  for (const p of s.problems || []) list.appendChild(el("div", {}, p));
  return list;
}

function _testerInvite(ctx, s){
  const { el } = ctx.helpers;
  const open = el("button", { class: "btn inline", "data-tester": "open" }, "Become a tester…");
  open.addEventListener("click", () => {
    s.form = testerDraft(s.status);
    s.open = true;
    s.preview = null;
    s.problems = [];
    ctx.actions.renderRooms();
  });
  return el("div", {}, [
    el("div", { class: "muted", style: "font-size:12px;margin-bottom:10px;line-height:1.55" },
      "Happy to try new things before they ship? Sign up as a tester and the developer may get in touch " +
      "when there is something for your setup to try. This is separate from the anonymous report above: " +
      "it is your contact details, so it is sent only when you press Send, you see exactly what goes " +
      "first, and you can stop any time."),
    open,
  ]);
}

function _testerSignedUp(ctx, s, reportOn){
  const { el } = ctx.helpers;
  const r = (s.status && s.status.record) || {};
  const since = _day(r.signed_up_at);
  const upd = r.updated_at && _day(r.updated_at) !== since ? ` · details updated ${_day(r.updated_at)}` : "";
  const update = el("button", { class: "btn inline", "data-tester": "update" }, "Update my details");
  update.addEventListener("click", () => {
    s.form = testerDraft(s.status);
    s.open = true;
    s.preview = null;
    s.problems = [];
    ctx.actions.renderRooms();
  });
  const stop = el("button", { class: "btn inline", "data-tester": "withdraw",
    style: "color:#f87171;border-color:rgba(248,113,113,.45)" }, s.busy ? "Stopping…" : "Stop being a tester");
  if (s.busy) { update.disabled = true; stop.disabled = true; }
  stop.addEventListener("click", async () => {
    if (!confirm("Stop being a tester?\n\nThis asks padspan.traks.ca to delete your sign-up. " +
                 "It is removed from this Home Assistant once the server confirms.")) return;
    s.busy = true;
    s.problems = [];
    ctx.actions.renderRooms();
    try {
      const res = await ctx.actions.wsCall("padspan_ha/tester_withdraw");
      s.status = (res && res.status) || { signed_up: false };
      ctx.toast("You're no longer a tester — your sign-up was deleted.");
    } catch (e) {
      s.problems = [`Could not stop: ${_errText(e)} Your sign-up is still on file, so nothing changed here — please try again later.`];
      ctx.toast("Could not stop being a tester: " + _errText(e), true);
    }
    s.busy = false;
    ctx.actions.renderRooms();
  });
  return el("div", {}, [
    el("div", { "data-tester": "status", style: "font-size:13px;color:#e2e8f0;margin-bottom:4px" },
      `Signed up on ${since}${upd}`),
    r.linked === true
      ? el("div", { class: "muted", style: "font-size:11px;margin-bottom:4px" }, "Your anonymous usage reports are linked to this sign-up.")
      : null,
    reportOn ? null : el("div", { class: "muted", style: "font-size:11px;margin-bottom:4px" },
      "The usage report is off. Your tester sign-up stays until you stop it."),
    el("div", { style: "display:flex;gap:8px;flex-wrap:wrap;margin-top:8px" }, [update, stop]),
    _testerProblemsBox(ctx, s),
  ]);
}

function _testerForm(ctx, s){
  const { el } = ctx.helpers;
  const f = s.form || (s.form = testerDraft(s.status));
  const lines = Array.isArray(s.status && s.status.setup) ? s.status.setup : [];
  const updating = !!(s.status && s.status.signed_up === true);
  const inputStyle = "width:100%;max-width:360px;box-sizing:border-box;background:#0a150e;border:1px solid #2d5a3d;" +
    "border-radius:6px;color:#e2e8f0;padding:5px 8px;font-size:13px";
  const cbStyle = "width:15px;height:15px;accent-color:#52b788;cursor:pointer;flex-shrink:0";
  const label = (t) => el("div", { style: "font-size:12px;color:#a7f3d0;margin:12px 0 4px" }, t);
  const hint = (t) => el("div", { class: "muted", style: "font-size:11px;margin-top:3px;line-height:1.5" }, t);
  const previewOut = el("pre", { class: "pre", "data-tester": "preview",
    style: "display:none;margin-top:10px;max-height:320px;overflow:auto;font-size:11px" });
  const previewNote = el("div", { class: "muted", style: "font-size:11px;margin-top:6px" }, "");
  if (s.preview) {
    previewOut.textContent = s.preview.json;
    previewOut.style.display = "block";
    previewNote.textContent = s.preview.note;
  }
  // Anything changed after a Preview: that preview is no longer what goes.
  const touched = () => {
    if (!s.preview) return;
    s.preview = null;
    previewOut.style.display = "none";
    previewNote.textContent = "";
  };
  const text = (key, attrs) => {
    const i = el("input", { type: "text", style: inputStyle, "data-tester": key, ...attrs });
    i.value = f[key] || "";
    i.addEventListener("input", () => { f[key] = i.value; touched(); });
    return i;
  };
  const tick = (checked, onChange, attrs = {}) => {
    const cb = el("input", { type: "checkbox", style: cbStyle, ...attrs });
    cb.checked = !!checked;
    cb.addEventListener("change", () => { onChange(cb.checked); touched(); });
    return cb;
  };
  const row = (cb, words) => el("label", { style: "display:flex;align-items:flex-start;gap:8px;font-size:12px;color:#e2e8f0;margin:3px 0;cursor:pointer" },
    [cb, el("span", { style: "line-height:1.45" }, words)]);

  const wrap = el("div", { "data-tester": "form" });
  wrap.appendChild(label("Email (required)"));
  wrap.appendChild(text("email", { type: "email", autocomplete: "email", maxlength: String(TESTER_LIMITS.email) }));
  wrap.appendChild(label("GitHub username (optional)"));
  wrap.appendChild(text("github", { maxlength: String(TESTER_LIMITS.github + 1) }));
  wrap.appendChild(label("Name or nickname (optional)"));
  wrap.appendChild(text("name", { maxlength: String(TESTER_LIMITS.name) }));

  wrap.appendChild(label("What would you like to test?"));
  for (const [key, words] of TESTER_INTERESTS) {
    const cb = tick((f.interests || []).includes(key), (on) => {
      f.interests = (f.interests || []).filter(k => k !== key);
      if (on) f.interests.push(key);
      if (key === "other") ctx.actions.renderRooms();      // shows or hides its text box
    }, { "data-tester": "interest-" + key });
    wrap.appendChild(row(cb, words));
  }
  if ((f.interests || []).includes("other")) {
    wrap.appendChild(text("other", { maxlength: String(TESTER_LIMITS.interests_other), placeholder: "What else?" }));
  }

  wrap.appendChild(label("About your setup"));
  wrap.appendChild(hint("Filled in from what PadSpan already knows — counts and versions only, like the usage report. " +
    "Untick anything you'd rather not send."));
  if (!lines.length) wrap.appendChild(hint("PadSpan could not describe this setup just now. The sign-up works without it."));
  for (const ln of lines) {
    if (!ln || !ln.key) continue;
    const cb = tick(!(f.setupOff || []).includes(ln.key), (on) => {
      f.setupOff = (f.setupOff || []).filter(k => k !== ln.key);
      if (!on) f.setupOff.push(ln.key);
    }, { "data-tester": "setup-" + ln.key });
    wrap.appendChild(row(cb, `${ln.label}: ${ln.text}`));
  }

  wrap.appendChild(label("Notes (optional)"));
  const notes = el("textarea", { rows: "4", "data-tester": "notes", maxlength: String(TESTER_LIMITS.notes),
    style: inputStyle + ";max-width:480px;resize:vertical;font-family:inherit" });
  notes.value = f.notes || "";
  const count = el("span", {}, `${_chars(notes.value)} / ${TESTER_LIMITS.notes}`);
  notes.addEventListener("input", () => {
    f.notes = notes.value;
    count.textContent = `${_chars(notes.value)} / ${TESTER_LIMITS.notes}`;
    touched();
  });
  wrap.appendChild(notes);
  wrap.appendChild(el("div", { class: "muted", style: "font-size:11px;margin-top:3px" },
    ["Please don't paste passwords, keys or tokens. ", count]));

  wrap.appendChild(label("Time zone (optional)"));
  wrap.appendChild(text("timezone", { maxlength: String(TESTER_LIMITS.timezone), placeholder: "America/Vancouver" }));
  wrap.appendChild(hint("Filled in from Home Assistant's time zone."));

  wrap.appendChild(el("div", { style: "margin-top:14px" }, [row(tick(f.consent, (on) => { f.consent = on; },
    { "data-tester": "consent" }),
    "I agree to be contacted about testing PadSpan. This goes to the developer only, is kept until I withdraw, " +
    "and is never shared or sold.")]));
  wrap.appendChild(row(tick(f.link, (on) => { f.link = on; }, { "data-tester": "link" }),
    "Link my anonymous usage reports to this sign-up (optional)"));
  wrap.appendChild(hint("Off unless you tick it. Ticked, the developer can tell which anonymous reports are yours, " +
    "to see how your setup behaves over time. Untick it and send an update to undo it."));

  const previewBtn = el("button", { class: "btn inline", "data-tester": "preview-btn" }, "Preview what will be sent");
  const sendBtn = el("button", { class: "btn inline", "data-tester": "send",
    style: "background:#0a2a1a;border-color:#52b788;color:#52b788;font-weight:700" },
    s.busy ? "Sending…" : (updating ? "Send update" : "Send sign-up"));
  const cancelBtn = el("button", { class: "btn inline", "data-tester": "cancel" }, "Cancel");
  if (s.busy) { previewBtn.disabled = true; sendBtn.disabled = true; cancelBtn.disabled = true; }
  const refuse = (problems) => { s.problems = problems; ctx.actions.renderRooms(); };

  previewBtn.addEventListener("click", async () => {
    const problems = testerProblems(f);
    if (problems.length) { s.preview = null; refuse(problems); return; }
    previewBtn.disabled = true;
    try {
      const r = await ctx.actions.wsCall("padspan_ha/tester_preview", testerMessage(f, lines));
      if (r && Array.isArray(r.problems) && r.problems.length) { s.preview = null; s.problems = r.problems; }
      else {
        s.problems = [];
        s.preview = { json: JSON.stringify(r && r.payload, null, 2), note: `${(r && r.bytes) || 0} bytes → ${(r && r.url) || ""}` };
      }
    } catch (e) {
      s.preview = null;
      s.problems = ["Preview failed: " + _errText(e)];
    }
    ctx.actions.renderRooms();
  });
  sendBtn.addEventListener("click", async () => {
    const problems = testerProblems(f);
    if (problems.length) { refuse(problems); return; }
    s.busy = true;
    s.problems = [];
    ctx.actions.renderRooms();
    try {
      const res = await ctx.actions.wsCall("padspan_ha/tester_signup", testerMessage(f, lines));
      s.status = (res && res.status) || s.status;
      s.open = false;
      s.form = null;
      s.preview = null;
      ctx.toast(res && res.action === "update" ? "Your tester details are updated."
        : "Thank you — you're signed up as a tester.");
    } catch (e) {
      // Nothing is retried by itself: the reason stays on screen with the form.
      s.problems = ["Not sent: " + _errText(e)];
      ctx.toast("Tester sign-up not sent: " + _errText(e), true);
    }
    s.busy = false;
    ctx.actions.renderRooms();
  });
  cancelBtn.addEventListener("click", () => {
    s.open = false;
    s.form = null;
    s.preview = null;
    s.problems = [];
    ctx.actions.renderRooms();
  });

  wrap.appendChild(el("div", { style: "display:flex;gap:8px;flex-wrap:wrap;margin-top:14px" }, [previewBtn, sendBtn, cancelBtn]));
  wrap.appendChild(_testerProblemsBox(ctx, s));
  wrap.appendChild(previewNote);
  wrap.appendChild(previewOut);
  return wrap;
}
