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
const TRIAL_REAL = await import(pathToFileURL(join(dirname(PANEL), "views", "trial_offer.js")).href);

function buildAll(EDITIONS, TRIAL = null) {
  // eslint-disable-next-line no-new-func
  return new Function("APP_VERSION", "EDITIONS", "TRIAL", "_trialPromise", `
    ${elSrc}
    return { _el: el, ${cardSrc}, ${milestoneSrc}, ${sidebarSrc}, ${askSrc} };
  `)(APP_VERSION, EDITIONS, TRIAL, Promise.resolve());
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
  WHATSNEW_URL: "https://padspan.traks.ca/#whatsnew",
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
//    precisely so the panel survives; the card must survive it too, which
//    means the notes URL cannot come from an import that may not have landed.
run("editions module missing still renders", { whatsnew_seen_version: "0.0.1" }, null,
  (out) => {
    if (!out) throw new Error("card vanished when editions.js was unavailable");
    // dom_shim's querySelectorAll handles #id, .class and tag only — no
    // attribute selectors — so match the tag and read the attribute.
    const a = out.querySelector("a");
    const href = a && a.getAttribute ? a.getAttribute("href") : "";
    if (!href || !/^https?:\/\//.test(href)) {
      throw new Error(`notes link has no usable href without editions.js (got ${JSON.stringify(href)})`);
    }
  });

// 6. A pitch that throws must not take the card — and so the tab — down.
run("a throwing proPitch does not kill the card", { whatsnew_seen_version: "0.0.1" },
  { WHATSNEW_URL: "https://padspan.traks.ca/#whatsnew", proPitch: () => { throw new Error("boom"); } },
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
  for (const seen of ["0.38.87", "0.38.88", "1.0.0"]) {
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

for (const o of ok) console.log(`  ok   ${o}`);
for (const f of fail) console.log(`  FAIL ${f}`);
console.log(`${ok.length} passed, ${fail.length} failed`);
process.exit(fail.length ? 1 : 0);
