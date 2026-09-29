// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
//
// The 90-day trial card (views/trial_offer.js), RUN rather than read — and
// the Overview's Getting started card's new "someone on the map" step,
// lifted out of panel.js by text the way onboarding_gate.mjs lifts its gate.
//
// The card is the one place outside Settings that asks for an email, so what
// it does is driven here under the DOM shim: who is offered it at all (never
// a house with a key, never before settings have loaded), that a non-admin
// never reaches padspan_ha/trial_start, that a bad address is refused before
// anything is sent, that success and failure each say so and are counted
// once, and that no usage event ever carries the email.
//
// Run:  node tests/js/trial_offer.mjs <views-dir> <panel.js>
// Prints ok/FAIL per check, then one JSON line {passed, failed, surfaces, steps}.

import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { join } from "node:path";
import { install } from "./dom_shim.mjs";

const VIEWS = process.argv[2], PANEL = process.argv[3];
if (!VIEWS || !PANEL) { console.error("usage: trial_offer.mjs <views-dir> <panel.js>"); process.exit(2); }
install(globalThis);

const T = await import(pathToFileURL(join(VIEWS, "trial_offer.js")).href);
const LOCATE = await import(pathToFileURL(join(VIEWS, "locate.js")).href);
const BUSY = await import(pathToFileURL(join(VIEWS, "busy_times.js")).href);

const ok = [], fail = [];
async function check(name, fn) {
  T._resetTrialOffer();
  try { await fn(); ok.push(name); } catch (e) { fail.push(`${name}: ${e && e.message ? e.message : e}`); }
}
function assert(cond, msg) { if (!cond) throw new Error(msg); }
const tick = () => new Promise(r => globalThis._realSetTimeout(r, 0));
async function settle() { for (let i = 0; i < 5; i++) await tick(); }

// panel.js el(), as views get it.
function el(tag, attrs = {}, children = []) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (k === "class") n.className = v;
    else if (k === "id") n.id = v;
    else if (k === "style") n.setAttribute("style", v);
    else if (k.startsWith("on") && typeof v === "function") n.addEventListener(k.slice(2), v);
    else if (v !== undefined && v !== null) n.setAttribute(k, String(v));
  }
  if (!Array.isArray(children)) children = [children];
  for (const c of children) {
    if (c === null || c === undefined) continue;
    if (typeof c === "string" || typeof c === "number") n.appendChild(document.createTextNode(String(c)));
    else n.appendChild(c);
  }
  return n;
}
const FREE = { tier: "free", pro_has_key: false, telemetry_enabled: true };
const find = (root, key) => root && root.querySelector(`[data-trial=${key}]`);

/** A host that records every call; `answer` is the trial_start result, or a
 *  function that throws. */
function makeHost({ admin = true, settings = FREE, answer = null } = {}) {
  const calls = [], events = [], toasts = [];
  let renders = 0, started = 0;
  const host = {
    el, settings, isAdmin: admin,
    callWS: async (type, data) => {
      calls.push({ type, ...data });
      if (typeof answer === "function") return answer();
      return answer;
    },
    telemetry: (n) => events.push(n),
    toast: (m, e) => toasts.push({ m, e: !!e }),
    rerender: () => { renders++; },
    onStarted: () => { started++; },
  };
  return { host, calls, events, toasts, renders: () => renders, started: () => started };
}
function type(card, value) {
  const i = find(card, "email");
  i.value = value;
  i.dispatchEvent({ type: "input" });
}

await check("a wall screen gets the buy option as text, never a new tab it can't close", () => {
  const W = (iw, ih, sw, sh) => ({ innerWidth: iw, innerHeight: ih, screen: { width: sw, height: sh } });
  assert(T.newTabOk(false, W(1400, 900, 1920, 1080)) === true, "a desktop browser window opens tabs");
  assert(T.newTabOk(true, W(1400, 900, 1920, 1080)) === false, "?kiosk=1 never opens tabs");
  assert(T.newTabOk(false, W(1080, 1920, 1080, 1920)) === false, "Chrome --kiosk fills the screen: no tabs");
  assert(T.newTabOk(false, W(1919, 1080, 1920, 1080)) === false, "a pixel of display-scaling slack");
  assert(T.newTabOk(false, {}) === true, "nothing to measure: a normal browser");
  const kiosk = makeHost();
  kiosk.host.kiosk = true;
  const card = T.trialOfferCard(kiosk.host, "update_banner");
  assert(!find(card, "buy"), "no link on a kiosk");
  assert(find(card, "buy-text") && /padspan\.traks\.ca/.test(find(card, "buy-text").textContent), "names the site instead");
});

await check("who is offered the trial", () => {
  const cases = [
    [FREE, true],
    [{ tier: "free", pro_has_key: true, pro_active: false }, false],   // lapsed key: renew, not a new trial
    [{ tier: "bright", pro_has_key: true }, false],
    [{ tier: "pro", pro_has_key: true }, false],
    [{ tier: "bright", pro_has_key: false }, false],                    // a Bright floor already covers it
    [{ tier: "free" }, false],                                          // pro_has_key unknown
    [{}, false], [null, false], [undefined, false],
  ];
  for (const [s, want] of cases) {
    assert(T.trialOfferable(s) === want, `${JSON.stringify(s)} -> ${T.trialOfferable(s)}, want ${want}`);
  }
});

await check("every card says the presence tracking stays free, unless its host already did", () => {
  const { host } = makeHost();
  const card = T.trialOfferCard(host, "atlas");
  assert(find(card, "honesty") && find(card, "honesty").textContent === "The presence tracking you're using stays free.", "no honesty line");
  assert(!find(T.trialOfferCard(host, "milestone", { honesty: false }), "honesty"), "honesty:false still says it");
  const na = makeHost({ admin: false }).host;
  assert(find(T.trialOfferCard(na, "sidebar"), "honesty"), "a non-admin's card lacks it");
});

await check("the milestone is due once someone is on the map, or after a week", () => {
  const now = 1_800_000_000_000, day = 86400;
  const s = (o) => ({ ...FREE, trial_nudge_done: false, first_seen_ts: now / 1000, ...o });
  assert(T.trialMilestoneDue(s({}), true, now) === true, "positioned");
  assert(T.trialMilestoneDue(s({}), false, now) === false, "day one, nobody");
  assert(T.trialMilestoneDue(s({ first_seen_ts: now / 1000 - 6.9 * day }), false, now) === false, "6.9 days");
  assert(T.trialMilestoneDue(s({ first_seen_ts: now / 1000 - 7 * day }), false, now) === true, "7 days");
  assert(T.trialMilestoneDue(s({ first_seen_ts: 0 }), false, now) === false, "unstamped read as old");
  assert(T.trialMilestoneDue(s({ trial_nudge_done: true }), true, now) === false, "answered");
  const old = s({}); delete old.trial_nudge_done;
  assert(T.trialMilestoneDue(old, true, now) === false, "an older backend read as due");
  assert(T.trialMilestoneDue(s({ tier: "bright", pro_has_key: true }), true, now) === false, "keyed");
  assert(T.trialMilestoneDue(null, true, now) === false, "no settings");
});

await check("a placement counted as seen is not counted again when its card opens", () => {
  const { host, events } = makeHost();
  T.trialOfferSeen("milestone", host.telemetry);
  T.trialOfferSeen("milestone", host.telemetry);
  T.trialOfferCard(host, "milestone");
  assert(JSON.stringify(events) === '["trial_offer_shown:milestone"]', JSON.stringify(events));
});

await check("a licensed house gets no card at all", () => {
  const { host, events } = makeHost({ settings: { tier: "pro", pro_has_key: true } });
  assert(T.trialOfferCard(host, "atlas") === null, "card shown to a Pro house");
  assert(events.length === 0, "an offer was counted: " + events.join());
});

await check("the card says what it is, in the agreed words", () => {
  const { host } = makeHost();
  const card = T.trialOfferCard(host, "atlas");
  assert(/90-day free trial, no card/.test(card.textContent), "title");
  assert(find(card, "start").textContent === "Start 90-day free trial", "button: " + find(card, "start").textContent);
  assert(find(card, "note").textContent === "Your email is only used to send your key; one trial per home.", "note");
  assert(find(card, "buy") && /PadSpan Pro/.test(find(card, "buy").textContent), "buy link missing");
  assert(!find(T.trialOfferCard(host, "maps", { buy: false }), "buy"), "buy link shown with buy:false");
});

await check("the buy line is a small grey link where nobody hit a wall, amber on the paywalls", () => {
  const { host } = makeHost();
  const style = (surface) => find(T.trialOfferCard(host, surface), "buy").getAttribute("style");
  for (const quiet of ["update_banner", "milestone", "sidebar"]) {
    assert(/color:#94a3b8/.test(style(quiet)) && !/#fbbf24|font-weight/.test(style(quiet)), `${quiet}: ${style(quiet)}`);
  }
  for (const wall of ["atlas", "maps", "placement", "locate", "busy_times", "settings", "overview"]) {
    assert(/color:#fbbf24/.test(style(wall)), `${wall} lost the amber line: ${style(wall)}`);
  }
  assert(/PadSpan Pro/.test(find(T.trialOfferCard(host, "sidebar"), "buy").textContent), "the quiet link lost its words");
});

await check("a non-admin sees one line and never reaches trial_start", () => {
  const { host, calls } = makeHost({ admin: false });
  const card = T.trialOfferCard(host, "atlas");
  assert(card && find(card, "not-admin"), "no line for a non-admin");
  assert(/administrator/.test(find(card, "not-admin").textContent), "line does not name the administrator");
  assert(!find(card, "email") && !find(card, "start"), "a non-admin got the form");
  assert(calls.length === 0, "a call was made");
});

await check("the offer is counted once per surface, never with the email", async () => {
  const { host, events } = makeHost({ answer: { ok: true, days_left: 90 } });
  const first = T.trialOfferCard(host, "overview");
  T.trialOfferCard(host, "overview");
  T.trialOfferCard(host, "locate", { feature: "Locate" });
  type(first, "someone@example.com");
  find(first, "start").click();
  await settle();
  assert(JSON.stringify(events) === JSON.stringify(["trial_offer_shown:overview", "trial_offer_shown:locate", "trial_started:overview"]),
    JSON.stringify(events));
  assert(!events.some(e => /@|example/.test(e)), "an event carries the email");
});

await check("a bad email is refused before anything is sent", async () => {
  const { host, calls } = makeHost({ answer: { ok: true } });
  const card = T.trialOfferCard(host, "atlas");
  for (const bad of ["", "garry", "garry@", "garry@localhost", "gar ry@example.com"]) {
    type(card, bad);
    find(card, "start").click();
    await settle();
  }
  assert(calls.length === 0, "sent: " + JSON.stringify(calls));
  const again = T.trialOfferCard(host, "atlas");
  assert(/doesn't look right/.test(find(again, "error").textContent), "no reason shown");
});

await check("success: one call, counted, settings handed back, then the started card", async () => {
  const h = makeHost({ answer: { ok: true, days_left: 90, settings: { tier: "bright", pro_has_key: true } } });
  const card = T.trialOfferCard(h.host, "maps");
  type(card, "  someone@example.com ");
  find(card, "start").click();
  await settle();
  assert(h.calls.length === 1 && h.calls[0].type === "padspan_ha/trial_start", JSON.stringify(h.calls));
  assert(h.calls[0].email === "someone@example.com", "email not trimmed: " + h.calls[0].email);
  assert(h.started() === 1, "onStarted not called");
  assert(h.toasts.some(t => !t.e && /90-day free trial has started/.test(t.m)), JSON.stringify(h.toasts));
  // Even though the house is now licensed, this surface says it worked.
  h.host.settings = { tier: "bright", pro_has_key: true };
  const after = T.trialOfferCard(h.host, "maps");
  assert(after && after.getAttribute("data-trial") === "started" && /90 days left/.test(after.textContent), after.textContent);
  // ...and another surface, not the one it started on, shows nothing.
  assert(T.trialOfferCard(h.host, "atlas") === null, "another surface still offers it");
});

await check("the server says no: the reason stays, the form stays, counted as failed", async () => {
  const h = makeHost({ answer: { ok: false, status: "used", message: "This home has already had its trial." } });
  const card = T.trialOfferCard(h.host, "settings", { buy: false });
  type(card, "someone@example.com");
  find(card, "start").click();
  await settle();
  const again = T.trialOfferCard(h.host, "settings", { buy: false });
  assert(/already had its trial/.test(find(again, "error").textContent), "reason not shown");
  assert(find(again, "email") && find(again, "email").value === "someone@example.com", "the typed email was lost");
  assert(h.events.includes("trial_failed:settings") && !h.events.some(e => e.startsWith("trial_started")), JSON.stringify(h.events));
  assert(h.started() === 0, "onStarted called on a refusal");
});

await check("a network failure is a failure too, and nothing retries by itself", async () => {
  const h = makeHost({ answer: () => { throw { code: "network", message: "Could not reach the licence server." }; } });
  const card = T.trialOfferCard(h.host, "placement");
  type(card, "someone@example.com");
  find(card, "start").click();
  await settle();
  assert(h.calls.length === 1, "retried: " + h.calls.length);
  assert(h.events.includes("trial_failed:placement"), JSON.stringify(h.events));
  assert(/licence server/.test(find(T.trialOfferCard(h.host, "placement"), "error").textContent), "reason not shown");
});

await check("while a request is out the button cannot send a second", async () => {
  let release;
  const h = makeHost({ answer: () => new Promise(r => { release = r; }) });
  const card = T.trialOfferCard(h.host, "atlas");
  type(card, "someone@example.com");
  find(card, "start").click();
  find(card, "start").click();
  await settle();
  const busy = T.trialOfferCard(h.host, "atlas");
  assert(find(busy, "start").disabled === true && /Starting/.test(find(busy, "start").textContent), "not shown busy");
  release({ ok: true, days_left: 90 });
  await settle();
  assert(h.calls.length === 1, "sent twice: " + h.calls.length);
});

await check("Not now is offered only where the host asks for it", () => {
  const { host } = makeHost();
  let hidden = 0;
  assert(!find(T.trialOfferCard(host, "maps"), "dismiss"), "dismiss shown without onDismiss");
  const card = T.trialOfferCard(host, "atlas", { onDismiss: () => { hidden++; } });
  find(card, "dismiss").click();
  assert(hidden === 1, "onDismiss not called");
});

await check("a Pro gate's pitch does not promise the Pro feature", () => {
  const p = T.trialPitch("locate", "Locate");
  assert(/The trial doesn't unlock Locate/.test(p) && /lighting/.test(p), p);
  // The gate right above already says Locate needs Pro; the card must not
  // say it a second time.
  assert(!/needs a PadSpan Pro key/.test(p), "the gate's own line, repeated: " + p);
});

await check("the update banner's trial line is news once, never on a kiosk or after an answer", () => {
  const s = { ...FREE, trial_nudge_done: false };
  assert(T.trialNewsDue(s, "0.38.86", false) === true, "the update that brought the trial");
  assert(T.trialNewsDue(s, "0.9.3", false) === true, "an older install updating straight past it");
  for (const seen of ["0.38.87", "0.38.88", "0.39.0", "1.0.0"]) {
    assert(T.trialNewsDue(s, seen, false) === false, "said again in the banner from " + seen);
  }
  assert(T.trialNewsDue(s, "", false) === false, "no previous version: no banner, no line");
  assert(T.trialNewsDue(s, "0.38.86", true) === false, "on a kiosk");
  assert(T.trialNewsDue({ ...s, trial_nudge_done: true }, "0.38.86", false) === false, "after No thanks");
  assert(T.trialNewsDue({ tier: "pro", pro_has_key: true }, "0.38.86", false) === false, "with a key");
  const old = { ...FREE }; delete old.trial_nudge_done;
  assert(T.trialNewsDue(old, "0.38.86", false) === true, "an older backend (no flag) reads as not answered");
});

await check("a Bright build's card leaves out the presence line unless presence is shown", () => {
  const bright = { ...FREE, edition: "bright" };
  assert(T.trialHonestyShown(FREE) && !T.trialHonestyShown(bright), "edition rule");
  assert(T.trialHonestyShown({ ...bright, bright_reveal_presence: true }), "revealed presence");
  const card = T.trialOfferCard(makeHost({ settings: bright }).host, "sidebar");
  assert(card && !find(card, "honesty"), "a Bright card says the presence tracking stays free");
  const shown = T.trialOfferCard(makeHost({ settings: { ...bright, bright_reveal_presence: true } }).host, "settings");
  assert(find(shown, "honesty"), "the presence line is missing with presence revealed");
});

await check("trialStartedHere says whether this surface started the trial", async () => {
  const h = makeHost({ answer: { ok: true, days_left: 90 } });
  assert(T.trialStartedHere("milestone") === false, "before");
  const card = T.trialOfferCard(h.host, "milestone");
  type(card, "someone@example.com");
  find(card, "start").click();
  await settle();
  assert(T.trialStartedHere("milestone") === true && T.trialStartedHere("atlas") === false, "after");
});

// ── the real views: the gate cards carry the trial, and only without a key ──
function viewCtx(settings, admin = true) {
  const calls = [];
  return {
    calls,
    ctx: {
      hass: { user: { is_admin: admin }, states: {} },
      state: { settings, live: { snapshot: null } },
      helpers: { el, helpBtn: () => el("span") },
      actions: { renderRooms() {}, renderNav() {}, telemetryEvent() {}, wsCall: async (t, d) => { calls.push({ type: t, ...d }); return {}; } },
      toast() {},
    },
  };
}
await check("Locate and Busy Times gates carry the trial card with their own surface", () => {
  for (const [mod, surface, word] of [[LOCATE, "locate", "Locate"], [BUSY, "busy_times", "Busy Times"]]) {
    const { ctx } = viewCtx(FREE);
    const root = mod.render(ctx, {});
    const card = root.querySelector("[data-trial=card]");
    assert(card && card.getAttribute("data-surface") === surface, `${surface}: no trial card`);
    assert(new RegExp("The trial doesn't unlock " + word).test(card.textContent), `${surface}: pitch`);
    assert(!/3-month/.test(root.textContent), `${surface}: old 3-month wording`);
    const keyed = mod.render(viewCtx({ tier: "bright", pro_has_key: true }).ctx, {});
    assert(!keyed.querySelector("[data-trial=card]"), `${surface}: offered with a key`);
  }
});

// ── Getting started (panel.js): the "someone on the map" step ───────────────
const SRC = readFileSync(PANEL, "utf8").replace(/\r\n/g, "\n");   // a Windows checkout is CRLF
const lift = (name) => {
  const m = SRC.match(new RegExp(`const\\s+${name}\\s*=\\s*([\\s\\S]*?);\\n`));
  if (!m) throw new Error(`panel.js no longer defines ${name}`);
  return m[1];
};
await check("the Getting started card waits for a live answer, and counts only the house", () => {
  const SAMPLE = { objects: { list: [{ identified: true, x_m: 1, y_m: 1 }] } };
  const fn = new Function("state", "SAMPLE_SNAPSHOT", `
    const _liveSnap = ${lift("_liveSnap").replace(/this\.state/g, "state")};
    const _posKnown = ${lift("_posKnown").replace(/this\.state/g, "state")};
    const _hasPositioned = ${lift("_hasPositioned").replace(/this\.state/g, "state")};
    return { known: _posKnown, done: _hasPositioned };`);
  const at = (o) => ({ objects: { list: [o] } });
  const run = (state) => fn({ _dataModeKnown: true, dataMode: "live", live: { snapshot: null }, ...state }, SAMPLE);
  let r = run({ _dataModeKnown: false });
  assert(r.known === false, "mode unknown read as known");
  r = run({});
  assert(r.known === false && r.done === false, "no live snapshot yet read as an answer");
  r = run({ live: { snapshot: SAMPLE } });
  assert(r.known === false && r.done === false, "the demo house counted as live");
  r = run({ dataMode: "sample", live: { snapshot: SAMPLE } });
  assert(r.known === true && r.done === false, "sample mode: known, never done");
  r = run({ live: { snapshot: at({ identified: true, x_m: 2, y_m: 3 }) } });
  assert(r.known && r.done, "an identified, positioned device did not count");
  r = run({ live: { snapshot: at({ kind: "private_ble", x_m: 0, y_m: 0 }) } });
  assert(r.done, "an IRK phone at (0,0) did not count");
  for (const o of [{ x_m: 2, y_m: 3 }, { identified: true, x_m: null, y_m: 3 }, { identified: true, x_m: 2, y_m: 3, _stale: true },
                   { user_label: "Keys", x_m: 2, y_m: 3, _ghost: true }, { identified: true, x_m: NaN, y_m: 1 }]) {
    assert(run({ live: { snapshot: at(o) } }).done === false, "counted: " + JSON.stringify(o));
  }
  assert(/if\s*\(\s*_setupKnown\s*&&\s*!_onboardingDone[^)]*&&\s*_posKnown\b/.test(SRC), "the card is not gated on _posKnown");
});
await check("the card's dismiss and done are persisted, not optional-chained into nothing", () => {
  const i = SRC.indexOf("// ── Onboarding wizard");
  const block = SRC.slice(i, SRC.indexOf("if(!mod || typeof mod.render", i));
  assert(!/this\.actions\?\.settingsSet|this\.actions\.settingsSet/.test(block), "still calls the non-existent this.actions.settingsSet");
  assert(/padspan_ha\/settings_set", onboarding_completed: true/.test(block), "onboarding_completed is never saved");
  assert(/"getting_started_dismissed"/.test(block) && /"getting_started_shown"/.test(block) && /"getting_started_step:"/.test(block),
    "a Getting started event is not fired");
});

// The step ids, for the wrapper to hold equal to telemetry.py's.
const steps = [...SRC.matchAll(/\{\s*id:\s*"([a-z_]+)",\s*label:/g)].map(m => m[1]);
if (/"step-trial"/.test(SRC)) steps.push("trial");

for (const o of ok) console.log(`  ok   ${o}`);
for (const f of fail) console.log(`  FAIL ${f}`);
console.log(JSON.stringify({ passed: ok.length, failed: fail, surfaces: [...T.TRIAL_SURFACES], steps }));
process.exit(fail.length ? 1 : 0);
