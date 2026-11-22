// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
//
// RUN the Overview cards that live in panel.js, rather than reading them.
//
// tests/js/render_smoke.mjs exists for exactly this failure and its header
// lists four cases of it — an undeclared `liveSnap`, a bare `helpBtn()`, and
// two more. But it walks views/, and these cards live in panel.js itself, so
// panel.js has never had that net under it.
//
// On 2026-08-25 that gap cost the Overview tab. `_whatsNewCard` referenced
// `notesUrl`, which was declared nowhere: the line survived a refactor that
// removed its `const`. JavaScript raises ReferenceError only when control
// reaches the line, and control could not reach it until an install had a
// PREVIOUS version recorded — so the card returned null on every install in
// existence, the suite went green, `node --check` passed, and the bug shipped.
// The first install to satisfy `seen && seen !== APP_VERSION` lost the tab.
//
// The lesson is not "check that identifier". It is that a card reached only in
// a rare state must be EXECUTED in that state by something. So this evaluates
// the method against the module-level names panel.js really gives it — el,
// APP_VERSION, EDITIONS — and nothing else. A method that reaches for anything
// outside that set throws here, which is the whole point. The trial's panel.js
// placements (the banner's line, the milestone card, the sidebar entry) are
// run the same way, with TRIAL (views/trial_offer.js, real) and _trialPromise.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { install } from "./dom_shim.mjs";
import { panelT } from "./panel_t.mjs";

const PANEL = process.argv[2];
if (!PANEL) { console.error("usage: whats_new_card.mjs <panel.js>"); process.exit(2); }

install(globalThis);
const src = readFileSync(PANEL, "utf8");
const fail = [];
const ok = [];

/** Source of a top-level `function name(...)` or a class method `name(...)`. */
function extract(name, kind) {
  const re = kind === "function"
    ? new RegExp(`\\bfunction\\s+${name}\\s*\\(`)
    : new RegExp(`^\\s{2}${name}\\s*\\(`, "m");
  const m = re.exec(src);
  if (!m) throw new Error(`could not find ${kind} ${name}() in panel.js — renamed? update this test`);
  // Walk the PARAMETER list to its closing paren first. `el(tag, attrs={})`
  // has a brace in its defaults, so "first { after the name" is not the body.
  let p = src.indexOf("(", m.index), depth = 0, bodyStart = -1;
  for (let j = p; j < src.length; j++) {
    const c = src[j];
    if (c === "(") depth++;
    else if (c === ")") { depth--; if (!depth) { bodyStart = src.indexOf("{", j); break; } }
  }
  if (bodyStart < 0) throw new Error(`could not find the body of ${name}()`);
  depth = 0;
  for (let j = bodyStart; j < src.length; j++) {
    const c = src[j];
    if (c === "{") depth++;
    else if (c === "}") { depth--; if (!depth) return src.slice(m.index, j + 1); }
  }
  throw new Error(`unbalanced braces reading ${name}()`);
}

// The exact module-level scope panel.js hands these methods. Anything a card
// uses beyond this set is a bug, and evaluating it here is what proves so.
const APP_VERSION = "9.9.9";
const elSrc = extract("el", "function");
const cardSrc = extract("_whatsNewCard", "method");

// The trial placements (views/trial_offer.js) panel.js also owns: the
// milestone card and the sidebar entry. They reach for TRIAL (the loaded
// module, or null) and _trialPromise, and nothing else module-level.
const milestoneSrc = extract("_trialMilestoneCard", "method");
const sidebarSrc = extract("_renderSidebarTrial", "method");
const askSrc = extract("_telemetryAskCard", "method");
const launchSrc = extract("_launchPriceCard", "method");
// panel.js's own t() and tn() (tests/js/panel_t.mjs): part of the scope panel.js hands them.
const { t: panelTr, tn: panelTn } = panelT(readFileSync(PANEL, "utf-8"));
const TRIAL_REAL = await import(pathToFileURL(join(dirname(PANEL), "views", "trial_offer.js")).href);

function buildAll(EDITIONS, TRIAL = null) {
  // eslint-disable-next-line no-new-func
  return new Function("APP_VERSION", "EDITIONS", "TRIAL", "_trialPromise", "t", "tn", `
    ${elSrc}
    return { _el: el, ${cardSrc}, ${milestoneSrc}, ${sidebarSrc}, ${askSrc}, ${launchSrc} };
  `)(APP_VERSION, EDITIONS, TRIAL, Promise.resolve(), panelTr, panelTn);
}
function build(EDITIONS, TRIAL = null) { return buildAll(EDITIONS, TRIAL)._whatsNewCard; }

function ctx(settings, { admin = true } = {}) {
  const saved = [], events = [];
  const c = {
    state: { settings, _dataModeKnown: true, dataMode: "live" },
    _hass: { user: { is_admin: admin } },
    _saved: saved,
    _events: events,
    _callWS: (msg) => { saved.push(msg); return Promise.resolve({ settings }); },
    _toast: () => {},
    _scheduleRender: () => {},
    _telemetryEvent: (n) => events.push(n),
    _notesOpened: 0,
    _openReleaseNotes() { c._notesOpened++; },
  };
  // The panel ctx trialOfferFromCtx reads.
  c._ctx = () => ({
    hass: c._hass, state: c.state, helpers: { el: c._el }, toast() {},
    actions: { wsCall: async () => ({}), renderRooms() {}, renderNav() {}, telemetryEvent: (n) => events.push(n) },
  });
  return c;
}

function run(label, settings, EDITIONS, check, TRIAL = null, opts = {}) {
  let out;
  try {
    const c = ctx(settings, opts);
    const obj = buildAll(EDITIONS, TRIAL);
    c._el = obj._el;
    out = obj._whatsNewCard.call(c);
    check(out, c);
    ok.push(label);
  } catch (e) {
    fail.push(`${label}: ${e && e.message ? e.message : e}`);
  }
}

const EDITIONS_REAL = {
  WHATSNEW_URL: "https://padspan.traks.ca/?hl=en#whatsnew",
  proPitch: () => ({ kind: "free", text: "t ", cta: "c", url: "https://padspan.traks.ca/#pro" }),
};

// 1. No key at all — an install older than the feature. Nothing, silently.
run("settings without whatsnew_seen_version", {}, EDITIONS_REAL,
  (out) => { if (out !== null) throw new Error("expected null"); });

// 2. First sight: record the version, show nothing. Telling someone who just
//    installed PadSpan that it "updated" is worse than saying nothing.
run("first sight seeds and shows nothing", { whatsnew_seen_version: "" }, EDITIONS_REAL,
  (out, c) => {
    if (out !== null) throw new Error("expected null on first sight");
    const wrote = c._saved.find(m => m && m.whatsnew_seen_version === APP_VERSION);
    if (!wrote) throw new Error("first sight did not record the version — the card would fire on every load");
  });

// 3. THE CASE THAT BROKE THE TAB. A real update: a previous version recorded,
//    and it differs. This is the only path that reaches the card body.
run("a real update renders the card", { whatsnew_seen_version: "0.0.1" }, EDITIONS_REAL,
  (out) => {
    if (!out) throw new Error("expected a card node");
    const t = out.textContent || "";
    if (!t.includes(APP_VERSION)) throw new Error("card does not name the new version");
    if (!t.includes("0.0.1")) throw new Error("card does not name the version came from");
  });

// 4. Same version — already seen it. Nothing.
run("same version shows nothing", { whatsnew_seen_version: APP_VERSION }, EDITIONS_REAL,
  (out) => { if (out !== null) throw new Error("expected null"); });

// 5. editions.js failed to load. panel.js loads it with .catch(console.warn)
//    precisely so the panel survives; the card must survive it too, and
//    "See what changed" still opens the notes (they come with the panel,
//    not from editions.js).
run("editions module missing still renders", { whatsnew_seen_version: "0.0.1" }, null,
  (out, c) => {
    if (!out) throw new Error("card vanished when editions.js was unavailable");
    const btn = out.querySelector("[data-whatsnew-notes]");
    if (!btn || btn.textContent !== "See what changed") throw new Error("no See what changed");
    btn.click();
    if (c._notesOpened !== 1) throw new Error("the notes did not open without editions.js");
  });

// 5b. 2026-09-28: "release notes screen has no way to close on touch
//     monitor". See what changed was a link to padspan.traks.ca in a new tab,
//     which a wall screen in Chrome --kiosk can't close. It opens the notes
//     over the panel now (views/release_notes.js, tests/js/release_notes.mjs),
//     and still records the version as seen.
run("See what changed opens the notes in the panel, not a new tab", { whatsnew_seen_version: "0.0.1" }, EDITIONS_REAL,
  (out, c) => {
    const btn = out.querySelector("[data-whatsnew-notes]");
    if (!btn || btn.localName !== "button") throw new Error("See what changed is not a button");
    for (const a of out.querySelectorAll("a")) {
      if (String(a.getAttribute("href") || "").includes("#whatsnew")) throw new Error("the card still links to the website's notes");
    }
    btn.click();
    if (c._notesOpened !== 1) throw new Error("the notes did not open");
    if (!c._saved.find(m => m && m.whatsnew_seen_version === APP_VERSION)) throw new Error("the version was not recorded as seen");
  });

// 6. A pitch that throws must not take the card — and so the tab — down.
run("a throwing proPitch does not kill the card", { whatsnew_seen_version: "0.0.1" },
  { WHATSNEW_URL: "https://padspan.traks.ca/?hl=en#whatsnew", proPitch: () => { throw new Error("boom"); } },
  (out) => { if (!out) throw new Error("expected a card node"); });

// ── The trial placements (views/trial_offer.js) ─────────────────────────────
const T = TRIAL_REAL;
const FREE = { tier: "free", pro_has_key: false, telemetry_enabled: true, whatsnew_seen_version: "0.0.1",
  trial_nudge_done: false, first_seen_ts: Date.now() / 1000 };
const KEYED = { ...FREE, tier: "bright", pro_has_key: true };
const q = (root, sel) => root && root.querySelector(sel);
function t(label, fn) {
  T._resetTrialOffer();
  try { fn(); ok.push(label); } catch (e) { fail.push(`${label}: ${e && e.message ? e.message : e}`); }
}
function assert(cond, msg) { if (!cond) throw new Error(msg); }
function setup(settings, opts = {}) {
  const c = ctx(settings, opts);
  const obj = buildAll(EDITIONS_REAL, "trial" in opts ? opts.trial : T);
  c._el = obj._el;
  c._renderSidebarTrial = obj._renderSidebarTrial;   // it re-renders itself
  return { c, obj };
}

// 7. The update banner's trial line.
t("update banner: a free install gets the trial line, counted once", () => {
  const { c, obj } = setup(FREE);
  let out = obj._whatsNewCard.call(c);
  const line = q(out, "[data-trial-line]");
  assert(line, "no trial line");
  assert(line.textContent.includes(T.TRIAL_NEWS_LINE) && line.textContent.includes(T.TRIAL_HONESTY), line.textContent);
  assert(q(out, "[data-trial-open]").textContent === "Try it", "no Try it");
  assert(!q(out, "[data-trial]"), "the card is open before anyone asked");
  obj._whatsNewCard.call(c);
  assert(JSON.stringify(c._events) === '["trial_offer_shown:update_banner"]', JSON.stringify(c._events));
  q(out, "[data-trial-open]").click();
  assert(c.state._bannerTrialOpen === true, "Try it did not open it");
  out = obj._whatsNewCard.call(c);
  const card = q(out, '[data-surface="update_banner"]');
  assert(card, "the card did not open inside the banner");
  assert(!q(out, '[data-trial="honesty"]'), "the honesty line is said twice");
  assert(c._events.length === 1, "counted again on open: " + JSON.stringify(c._events));
});
t("update banner: a keyed or Bright install gets no trial line", () => {
  for (const s of [KEYED, { ...FREE, tier: "bright" }, { ...FREE, pro_has_key: undefined }]) {
    const { c, obj } = setup(s);
    const out = obj._whatsNewCard.call(c);
    assert(out && !q(out, "[data-trial-line]"), "offered to " + JSON.stringify(s));
  }
});
t("update banner: a missing or throwing trial module costs only the line", () => {
  for (const trial of [null, { trialOfferable: () => { throw new Error("boom"); } }]) {
    const { c, obj } = setup(FREE, { trial });
    const out = obj._whatsNewCard.call(c);
    assert(out && out.textContent.includes("See what changed") && !q(out, "[data-trial-line]"), "banner lost");
  }
});
t("update banner: the trial line is news once — later banners have the Pro pitch as before", () => {
  // 0.38.186 made the trial all of Pro, and the banner says so once more.
  for (const seen of ["0.38.186", "0.38.187", "1.0.0"]) {
    const { c, obj } = setup({ ...FREE, whatsnew_seen_version: seen });
    const out = obj._whatsNewCard.call(c);
    assert(out && !q(out, "[data-trial-line]"), "the trial line again in the banner from " + seen);
    assert(out.textContent.includes("t c"), "the Pro pitch did not come back from " + seen + ": " + out.textContent);
    assert(!c._events.length, "counted an offer that was not shown: " + JSON.stringify(c._events));
  }
});
t("update banner: no trial line after No thanks, or on a kiosk", () => {
  const answered = setup({ ...FREE, trial_nudge_done: true });
  assert(!q(answered.obj._whatsNewCard.call(answered.c), "[data-trial-line]"), "shown after No thanks");
  const kiosk = setup(FREE);
  kiosk.c.state.kioskMode = true;
  assert(!q(kiosk.obj._whatsNewCard.call(kiosk.c), "[data-trial-line]"), "shown on a kiosk");
});
t("update banner: a non-admin opening it is told an administrator starts it", () => {
  const { c, obj } = setup(FREE, { admin: false });
  c.state._bannerTrialOpen = true;
  const out = obj._whatsNewCard.call(c);
  assert(q(out, '[data-trial="not-admin"]') && !q(out, '[data-trial="email"]'), "non-admin got the form");
});

// 8. The milestone card.
const WEEK_AGO = Date.now() / 1000 - 8 * 86400;
t("milestone: shown the first time someone is positioned, saved as done at once", () => {
  const { c, obj } = setup(FREE);
  assert(obj._trialMilestoneCard.call(c, false) === null, "shown on day one with nobody on the map");
  const out = obj._trialMilestoneCard.call(c, true);
  assert(out, "not shown");
  for (const s of [T.TRIAL_MILESTONE_TITLE, T.TRIAL_MILESTONE_BODY, T.TRIAL_HONESTY]) assert(out.textContent.includes(s), "missing: " + s);
  assert(q(out, '[data-trial-milestone="try"]').textContent === "Try it", "Try it");
  assert(q(out, '[data-trial-milestone="no"]').textContent === "No thanks", "No thanks");
  assert(q(out, '[data-trial-milestone="close"]'), "no ✕");
  obj._trialMilestoneCard.call(c, false);   // still on screen this page, even if nobody is now
  const saves = c._saved.filter(m => m.trial_nudge_done === true);
  assert(saves.length === 1 && saves[0].type === "padspan_ha/settings_set", "saved " + saves.length + " times");
  assert(JSON.stringify(c._events) === '["trial_offer_shown:milestone"]', JSON.stringify(c._events));
});
t("milestone: shown after a week of PadSpan here", () => {
  const { c, obj } = setup({ ...FREE, first_seen_ts: WEEK_AGO });
  assert(obj._trialMilestoneCard.call(c, false), "not shown after 8 days");
});
t("milestone: never in sample mode, before the mode is known, on a kiosk, to a non-admin, or with a key", () => {
  const cases = [
    [{ dataMode: "sample" }, FREE], [{ _dataModeKnown: false }, FREE], [{ kioskMode: true }, FREE],
    [{}, KEYED], [{}, { ...FREE, trial_nudge_done: true }], [{}, (() => { const s = { ...FREE }; delete s.trial_nudge_done; return s; })()],
    [{}, null],
  ];
  for (const [st, s] of cases) {
    const { c, obj } = setup(s);
    Object.assign(c.state, st);
    assert(obj._trialMilestoneCard.call(c, true) === null, "shown: " + JSON.stringify(st) + " " + JSON.stringify(s));
    assert(!c._saved.length, "saved when not shown");
  }
  const na = setup(FREE, { admin: false });
  assert(na.obj._trialMilestoneCard.call(na.c, true) === null, "shown to a non-admin");
  const nt = setup(FREE, { trial: null });
  assert(nt.obj._trialMilestoneCard.call(nt.c, true) === null, "shown without the trial module");
});
t("milestone: No thanks and ✕ take it away, counted, saved", () => {
  for (const which of ["no", "close"]) {
    const { c, obj } = setup(FREE);
    q(obj._trialMilestoneCard.call(c, true), `[data-trial-milestone="${which}"]`).click();
    assert(obj._trialMilestoneCard.call(c, true) === null, which + ": still shown");
    assert(c._events.includes("trial_nudge_dismissed"), which + ": not counted");
    assert(c._saved.filter(m => m.trial_nudge_done === true).length >= 1, which + ": not saved");
  }
});
t("milestone: Try it opens the shared card, which stays after a key arrives", () => {
  const { c, obj } = setup(FREE);
  q(obj._trialMilestoneCard.call(c, true), '[data-trial-milestone="try"]').click();
  let out = obj._trialMilestoneCard.call(c, true);
  assert(q(out, '[data-surface="milestone"]'), "card not opened");
  assert(!q(out, '[data-trial="honesty"]'), "honesty line twice");
  c.state.settings = KEYED;
  out = obj._trialMilestoneCard.call(c, true);
  assert(out, "an opened card vanished when the key arrived");
  const shut = setup(FREE);
  shut.obj._trialMilestoneCard.call(shut.c, true);
  shut.c.state.settings = KEYED;
  assert(shut.obj._trialMilestoneCard.call(shut.c, true) === null, "an unopened card outlived a key");
});

t("milestone: waits for another page load after another Overview card showed on this one", () => {
  const { c, obj } = setup(FREE);
  c._overviewCardShown = true;          // the update banner, the usage ask or Getting started
  assert(obj._trialMilestoneCard.call(c, true) === null, "shown right after another card");
  assert(!c._saved.length && !c._events.length, "saved or counted while waiting");
  const shown = setup(FREE);
  assert(shown.obj._trialMilestoneCard.call(shown.c, true), "not shown on a clean load");
  shown.c._overviewCardShown = true;    // already on screen: it stays
  assert(shown.obj._trialMilestoneCard.call(shown.c, true), "an open card vanished");
});

t("usage ask: nothing until settings have loaded (it latched the milestone off on every load)", () => {
  const cases = [[{}, false], [{ telemetry_enabled: false, telemetry_asked: false }, true],
                 [{ telemetry_enabled: false, telemetry_asked: true }, false], [{ telemetry_enabled: true }, false]];
  for (const [s, want] of cases) {
    const { c, obj } = setup(s);
    assert(!!obj._telemetryAskCard.call(c, false) === want, JSON.stringify(s) + " -> " + !want);
  }
});

// 9. The sidebar entry.
function sidebar(settings, opts) {
  const s = setup(settings, opts);
  const box = document.createElement("div");
  s.c.$ = (sel) => (sel === "#navTrial" ? box : null);
  s.box = box;
  return s;
}
t("sidebar: a quiet entry that opens the card in place", () => {
  const { c, obj, box } = sidebar(FREE);
  obj._renderSidebarTrial.call(c);
  const entry = q(box, "[data-trial-sidebar]");
  assert(entry && entry.textContent === T.TRIAL_SIDEBAR_LABEL, "entry: " + (entry && entry.textContent));
  assert(!c._events.length, "counted before anyone opened it");
  entry.click();
  const card = q(box, '[data-surface="sidebar"]');
  assert(card, "no card after a tap");
  assert(q(box, '[data-trial="honesty"]').textContent === T.TRIAL_HONESTY, "no honesty line");
  assert(JSON.stringify(c._events) === '["trial_offer_shown:sidebar"]', JSON.stringify(c._events));
  q(box, "[data-trial-sidebar]").click();
  assert(!q(box, '[data-surface="sidebar"]'), "a second tap did not close it");
});
t("sidebar: nothing with a key, before settings, or without the module", () => {
  for (const s of [KEYED, undefined, { ...FREE, tier: "bright" }]) {
    const { c, obj, box } = sidebar(s);
    obj._renderSidebarTrial.call(c);
    assert(!box.children.length, "shown for " + JSON.stringify(s));
  }
  const { c, obj, box } = sidebar(FREE, { trial: null });
  obj._renderSidebarTrial.call(c);
  assert(!box.children.length, "shown without the module");
});
t("sidebar: the entry reads at 4.5:1 or better on either skin's sidebar", () => {
  // Design pass 2026-09-28: #64748b measured 3.9:1 on the 2025 skin's rail.
  const lum = (hex) => {
    const c = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
      .map(v => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  };
  const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };
  const { c, obj, box } = sidebar(FREE);
  obj._renderSidebarTrial.call(c);
  const fg = /(?:^|;)\s*color:\s*(#[0-9a-f]{6})/i.exec(q(box, "[data-trial-sidebar]").getAttribute("style"))[1];
  const rail = /--ps-s1:\s*(#[0-9a-f]{6})/i.exec(readFileSync(join(dirname(PANEL), "styles-2025.css"), "utf8"))[1];
  const classic = /\.left\{background:linear-gradient\(180deg,(#[0-9a-f]{6}) 0%,(#[0-9a-f]{6}) 100%\)/i
    .exec(readFileSync(join(dirname(PANEL), "styles.css"), "utf8"));
  for (const bg of [rail, classic[1], classic[2]]) {
    assert(ratio(fg, bg) >= 4.5, `${fg} on ${bg} is ${ratio(fg, bg).toFixed(2)}:1`);
  }
});
t("sidebar: administrators only, and gone once the milestone was answered", () => {
  const na = sidebar(FREE, { admin: false });
  na.obj._renderSidebarTrial.call(na.c);
  assert(!na.box.children.length, "shown to a non-admin");
  const done = sidebar({ ...FREE, trial_nudge_done: true });
  done.obj._renderSidebarTrial.call(done.c);
  assert(!done.box.children.length, "shown after No thanks");
});

// 10. ✕ on the milestone after a trial was started from it: a "started"
//     note closing, not a dismissal (async: the start is a request).
{
  T._resetTrialOffer();
  const label = "milestone: ✕ after a trial started here is not counted as a dismissal";
  try {
    const { c, obj } = setup(FREE);
    const inner = c._ctx;
    c._ctx = () => { const x = inner(); x.actions.wsCall = async () => ({ ok: true, days_left: 90 }); return x; };
    q(obj._trialMilestoneCard.call(c, true), '[data-trial-milestone="try"]').click();
    const card = obj._trialMilestoneCard.call(c, true);
    const input = q(card, '[data-trial="email"]');
    input.value = "someone@example.com";
    input.dispatchEvent({ type: "input" });
    q(card, '[data-trial="start"]').click();
    for (let i = 0; i < 5; i++) await new Promise(r => globalThis._realSetTimeout(r, 0));
    assert(T.trialStartedHere("milestone"), "the trial did not start in the harness");
    const saves = c._saved.filter(m => m.trial_nudge_done === true).length;
    q(obj._trialMilestoneCard.call(c, true), '[data-trial-milestone="close"]').click();
    assert(!c._events.includes("trial_nudge_dismissed"), "counted as dismissed: " + JSON.stringify(c._events));
    assert(c._saved.filter(m => m.trial_nudge_done === true).length === saves, "saved again on ✕");
    assert(obj._trialMilestoneCard.call(c, true) === null, "still shown after ✕");
    ok.push(label);
  } catch (e) { fail.push(`${label}: ${e && e.message ? e.message : e}`); }
}

// 11. After a yes, the same card asks where they heard about PadSpan: once,
//     optional, and never after a No thanks (async: each answer is a save).
{
  T._resetTrialOffer();
  const label = "usage ask: one optional question once the report goes on or a free licence starts; an answer or Skip ends it";
  try {
    const tick = async () => { for (let i = 0; i < 5; i++) await new Promise(r => globalThis._realSetTimeout(r, 0)); };
    const house = () => {
      const s = { telemetry_enabled: false, telemetry_asked: false };
      const { c, obj } = setup(s);
      // What ws_settings does with these keys: the question falls due when the report goes on, an answer ends it.
      c._callWS = (msg) => {
        c._saved.push(msg);
        const m = { ...msg }; delete m.type;
        if (m.telemetry_enabled && !s.telemetry_enabled && !s.telemetry_heard_ask) m.telemetry_heard_ask = "due";
        if (m.telemetry_heard) m.telemetry_heard_ask = "done";
        Object.assign(s, m);
        return Promise.resolve({ settings: s });
      };
      return { c, card: () => obj._telemetryAskCard.call(c, false) };
    };
    // yes, then an answer
    const a = house();
    q(a.card(), '[data-ask="yes"]').click();
    await tick();
    assert(a.c._saved.length === 1 && a.c._saved[0].telemetry_enabled === true, "the yes was not saved first");
    let ask = a.card();
    assert(ask && q(ask, '[data-heard="reddit"]') && q(ask, "[data-heard-skip]"), "no question after a yes");
    assert(!q(ask, '[data-ask="yes"]'), "the opt-in buttons are still there");
    q(ask, '[data-heard="reddit"]').click();
    await tick();
    assert(a.c._saved.length === 2 && a.c._saved[1].telemetry_heard === "reddit", "answer not saved: " + JSON.stringify(a.c._saved));
    assert(a.card() === null, "asked again after an answer");
    // yes, then Skip: nothing saved, nothing asked again
    const b = house();
    q(b.card(), '[data-ask="yes"]').click();
    await tick();
    q(b.card(), "[data-heard-skip]").click();
    await tick();
    assert(b.c._saved.length === 2 && b.c._saved[1].telemetry_heard_ask === "done" && !("telemetry_heard" in b.c._saved[1]),
      "Skip did not end the question: " + JSON.stringify(b.c._saved));
    assert(b.card() === null, "asked again after Skip");
    // due from a trial, tester sign-up or free year on a house already reporting: asked on the next Overview
    const d = house();
    Object.assign(d.c.state.settings, { telemetry_enabled: true, telemetry_asked: true, telemetry_heard_ask: "due" });
    assert(q(d.card(), '[data-heard="youtube"]'), "a due question was not shown");
    d.c._hass.user.is_admin = false;
    assert(d.card() === null, "shown to someone who cannot answer it");
    d.c._hass.user.is_admin = true;
    d.c.state.kioskMode = true;
    assert(d.card() === null, "shown on a wall screen");
    // a house reporting since before the question existed: nothing pops up
    const old = house();
    Object.assign(old.c.state.settings, { telemetry_enabled: true, telemetry_asked: true });
    assert(old.card() === null, "asked a house that was already reporting");
    // No thanks: never asked
    const n = house();
    q(n.card(), '[data-ask="no"]').click();
    await tick();
    assert(n.card() === null, "a question after No thanks");
    assert(n.c._saved.length === 1 && !("telemetry_heard" in n.c._saved[0]), "No thanks saved an answer");
    ok.push(label);
  } catch (e) { fail.push(`${label}: ${e && e.message ? e.message : e}`); }
}

// 12. The launch price's card (panel.js _launchPriceCard, editions.js
//     launchCardDue): to an administrator, once, until the launch price ends.
//     The clock is the harness's, so the cases hold on any day.
{
  const ED = await import(pathToFileURL(join(dirname(PANEL), "views", "editions.js")).href);
  const BEFORE = Date.parse("2026-11-24T18:00:00Z"), END = Date.parse(ED.PRO_LIFETIME_LAUNCH_UNTIL);
  let clock = BEFORE;
  const edNow = { ...ED, proLifetimeLaunch: () => ED.proLifetimeLaunch(clock), launchCardDue: (s) => ED.launchCardDue(s, clock),
                  proLifetimeWords: () => ED.proLifetimeWords(clock) };
  const LFREE = { ...FREE, launch_card_done: false };
  const launch = (settings, { admin = true, trial = T, editions = edNow, state = {} } = {}) => {
    const c = ctx(settings, { admin });
    Object.assign(c.state, state);
    const obj = buildAll(editions, trial);
    c._el = obj._el;
    return { c, card: () => obj._launchPriceCard.call(c) };
  };
  const lt = (label, fn) => { clock = BEFORE; t(label, fn); };
  lt("launch card: an administrator sees it once: the end date, the price after, where to buy, No thanks", () => {
    const { c, card } = launch(LFREE);
    const out = card();
    assert(out, "not shown");
    const words = out.textContent;
    assert(words.includes("The launch price ends November 30"), words);
    assert(words.includes("PadSpan Pro for life is $89 CAD, once, until November 30 (then $168)."), words);
    const buy = q(out, '[data-launch-card="buy"]');
    assert(buy && buy.getAttribute("href") === ED.BUY_URL && buy.getAttribute("target") === "_blank" && buy.textContent === "Buy at padspan.traks.ca", "buy link");
    assert(q(out, '[data-launch-card="no"]').textContent === "No thanks", "No thanks");
    assert(c._overviewCardShown === true, "it does not hold the one-card slot");
    card();
    const saves = c._saved.filter(m => m.launch_card_done === true);
    assert(saves.length === 1 && saves[0].type === "padspan_ha/settings_set", "saved " + saves.length + " times");
    assert(!c._events.length, "counted something: " + JSON.stringify(c._events));
  });
  lt("launch card: No thanks is final for this page, and the flag was already saved for every other", () => {
    const { c, card } = launch(LFREE);
    q(card(), '[data-launch-card="no"]').click();
    assert(card() === null, "still shown after No thanks");
    assert(c._saved.filter(m => m.launch_card_done === true).length === 1, "not saved, or saved twice");
    c.state.settings = { ...LFREE, launch_card_done: true };
    const next = launch({ ...LFREE, launch_card_done: true });
    assert(next.card() === null, "shown again on the next page load");
  });
  lt("launch card: never to a non-admin, on a wall, in sample mode or before the mode is known, to a running paid key, or without editions.js", () => {
    const cases = [
      [{ admin: false }, LFREE], [{ state: { kioskMode: true } }, LFREE], [{ state: { dataMode: "sample" } }, LFREE],
      [{ state: { _dataModeKnown: false } }, LFREE], [{}, { ...LFREE, tier: "pro", pro_has_key: true, pro_active: true }],
      [{}, (() => { const s = { ...LFREE }; delete s.launch_card_done; return s; })()], [{}, null],
      [{ editions: null }, LFREE], [{ editions: { ...edNow, launchCardDue: undefined } }, LFREE],
    ];
    for (const [o, s] of cases) {
      const { c, card } = launch(s, o);
      assert(card() === null, "shown: " + JSON.stringify(o) + " " + JSON.stringify(s));
      assert(!c._saved.length, "saved when not shown");
    }
    const trial = launch({ ...LFREE, tier: "pro", pro_has_key: true, license_is_trial: true });
    assert(trial.card(), "not shown during a trial");
  });
  lt("launch card: a key for a year (Pro or Bright Pro) is told it becomes Pro for life; a lifetime key never sees it", () => {
    const year = { ...LFREE, tier: "pro", pro_has_key: true, pro_active: true, pro_days_left: 200 };
    const a = launch(year).card();
    assert(a && a.textContent.includes("Pay with the email your key was sent to and this key becomes Pro for life."), a && a.textContent);
    const bright = launch({ ...year, tier: "bright" }).card();
    assert(bright && bright.textContent.includes("this key becomes Pro for life"), "Bright Pro for a year not told");
    const free = launch(LFREE).card();
    assert(free && !free.textContent.includes("this key becomes"), "the no-key card says the key line");
    const life = launch({ ...year, pro_days_left: 26000 });
    assert(life.card() === null && !life.c._saved.length, "shown to a lifetime key");
    clock = END;
    assert(launch(year).card() === null, "shown to a year's key after the launch price ended");
  });
  lt("launch card: waits for another page load after another Overview card showed on this one", () => {
    const { c, card } = launch(LFREE);
    c._overviewCardShown = true;
    assert(card() === null && !c._saved.length, "shown or saved right after another card");
  });
  lt("launch card: gone at the end of November 30, even on screen, and never after", () => {
    const { card } = launch(LFREE);
    clock = END - 1000;
    assert(card(), "not shown in the last second");
    clock = END;
    assert(card() === null, "still on screen once the launch price ended");
    const later = launch(LFREE);
    assert(later.card() === null, "shown after the end");
  });
  lt("launch card: a page that fills the screen names the site instead of opening a tab it can't close", () => {
    const { card } = launch(LFREE, { trial: { ...T, newTabOk: () => false } });
    const out = card();
    assert(out && !q(out, "a") && q(out, '[data-launch-card="buy-text"]').textContent === "At padspan.traks.ca", out && out.textContent);
  });
}

for (const o of ok) console.log(`  ok   ${o}`);
for (const f of fail) console.log(`  FAIL ${f}`);
console.log(`${ok.length} passed, ${fail.length} failed`);
process.exit(fail.length ? 1 : 0);
