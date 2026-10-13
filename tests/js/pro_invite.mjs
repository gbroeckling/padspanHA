// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
//
// The free-Pro cards (views/pro_invite.js), RUN under the DOM shim: who is
// offered what (never a house with Pro, never before settings say so), that a
// bad address is refused before anything is sent, that Claim and No thanks
// each send exactly one command, that "Later" holds for a week, and that the
// tester card only comes once something works here.
//
// Run:  node tests/js/pro_invite.mjs <views-dir>
// Prints ok/FAIL per check, then one JSON line {passed, failed}.

import { pathToFileURL } from "node:url";
import { join } from "node:path";
import { install } from "./dom_shim.mjs";

const VIEWS = process.argv[2];
if (!VIEWS) { console.error("usage: pro_invite.mjs <views-dir>"); process.exit(2); }
install(globalThis);

const P = await import(pathToFileURL(join(VIEWS, "pro_invite.js")).href);
const TS = await import(pathToFileURL(join(VIEWS, "tester_signup.js")).href);

const ok = [], fail = [];
async function check(name, fn) {
  P._resetProInvite();
  try { await fn(); ok.push(name); } catch (e) { fail.push(`${name}: ${e && e.message ? e.message : e}`); }
}
function assert(cond, msg) { if (!cond) throw new Error(msg); }
const tick = () => new Promise(r => globalThis._realSetTimeout(r, 0));
async function settle() { for (let i = 0; i < 5; i++) await tick(); }

function el(tag, attrs = {}, children = []) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (k === "class") n.className = v;
    else if (k === "style") n.setAttribute("style", v);
    else if (v !== undefined && v !== null) n.setAttribute(k, String(v));
  }
  if (!Array.isArray(children)) children = [children];
  for (const c of children) {
    if (c === null || c === undefined) continue;
    n.appendChild(typeof c === "string" || typeof c === "number" ? document.createTextNode(String(c)) : c);
  }
  return n;
}
const OPEN = { tier: "free", pro_has_key: false, pro_active: false, pro_invite_open: true, pro_invite_until: "2026-12-31" };
const find = (root, key) => root && root.querySelector(`[data-invite=${key}]`);
function store() { const m = {}; return { getItem: k => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = String(v); } }; }
function host(settings, answer) {
  const h = { el, settings, calls: [], toasts: [], renders: 0, got: null,
    callWS: async (type, data) => { h.calls.push([type, data]); if (answer instanceof Error) throw answer; return answer; },
    toast: (m, isErr) => h.toasts.push([m, !!isErr]),
    rerender: () => { h.renders++; },
    onSettings: (s) => { h.got = s; } };
  return h;
}
function type(input, value) { input.value = value; input.dispatchEvent(new Event("input")); }

await check("no invite, no card; a house with Pro never sees one", () => {
  assert(!P.inviteOpen({}) && P.inviteCard(host({}), {}) === null, "no settings, no card");
  assert(!P.inviteOpen({ ...OPEN, pro_invite_open: false }), "closed invite shown");
  assert(!P.inviteOpen({ ...OPEN, tier: "pro", pro_active: true, pro_has_key: true }), "offered to a Pro house");
  assert(!P.inviteOpen({ ...OPEN, tier: "bright", pro_active: true, pro_has_key: true }), "a paid Bright key would be replaced");
  assert(P.inviteOpen({ ...OPEN, tier: "bright", pro_active: true, pro_has_key: true, license_is_trial: true }), "a trial may take it");
  assert(P.inviteOpen({ ...OPEN, tier: "free", pro_active: false, pro_has_key: true }), "a lapsed key may take it");
  assert(!P.inviteOpen({ ...OPEN, edition: "bright" }), "shown in the Bright edition");
});

await check("the card says what it is, when it ends, and where the email goes", () => {
  const c = P.inviteCard(host(OPEN), {});
  const t = c.textContent;
  assert(t.includes(P.INVITE_TITLE) && t.includes("No card, nothing renews"), t);
  assert(t.includes("Open until December 31."), "end day missing: " + t);
  assert(t.includes("goes to the developer") && t.includes("No thanks is final"), t);
  assert(find(c, "later") === null, "no Later without a host that can hide it");
  assert(find(P.inviteCard(host(OPEN), { onLater: () => {} }), "later"), "Later missing on Overview");
});

await check("a bad address is refused before anything is sent", async () => {
  const h = host(OPEN, { ok: true });
  type(find(P.inviteCard(h, {}), "email"), "not-an-email");
  find(P.inviteCard(h, {}), "claim").dispatchEvent(new Event("click"));
  await settle();
  assert(h.calls.length === 0, "sent: " + JSON.stringify(h.calls));
  assert(find(P.inviteCard(h, {}), "error").textContent.includes("doesn't look right"), "no error shown");
});

await check("claim sends one command with the email, then says it worked", async () => {
  const h = host(OPEN, { ok: true, settings: { tier: "pro" } });
  type(find(P.inviteCard(h, {}), "email"), " me@example.com ");
  find(P.inviteCard(h, {}), "claim").dispatchEvent(new Event("click"));
  await settle();
  assert(JSON.stringify(h.calls) === JSON.stringify([["padspan_ha/pro_invite_claim", { email: "me@example.com" }]]),
    JSON.stringify(h.calls));
  assert(h.got && h.got.tier === "pro", "settings not handed back");
  const done = P.inviteCard(host({}), {});
  assert(done && done.getAttribute("data-invite") === "claimed" && done.textContent.includes("me@example.com"), "no claimed note");
  let closed = 0;
  const closable = P.inviteCard(host({}), { onClose: () => closed++ });
  find(closable, "close").dispatchEvent(new Event("click"));
  assert(closed === 1, "the claimed note cannot be closed");
});

await check("a refused claim keeps the card and says why", async () => {
  const h = host(OPEN, { ok: false, message: "This invite has ended." });
  type(find(P.inviteCard(h, {}), "email"), "me@example.com");
  find(P.inviteCard(h, {}), "claim").dispatchEvent(new Event("click"));
  await settle();
  const c = P.inviteCard(h, {});
  assert(c.getAttribute("data-invite") === "card" && find(c, "error").textContent.includes("ended"), "card lost or silent");
  assert(h.toasts.some(([m, e]) => e && m.includes("ended")), "no error toast");
});

await check("No thanks sends one decline and tells the host", async () => {
  const h = host(OPEN, { ok: true, settings: { pro_invite_open: false } });
  let declined = 0;
  find(P.inviteCard(h, { onDeclined: () => declined++ }), "decline").dispatchEvent(new Event("click"));
  await settle();
  assert(JSON.stringify(h.calls) === JSON.stringify([["padspan_ha/pro_invite_decline", {}]]), JSON.stringify(h.calls));
  assert(declined === 1 && h.got && h.got.pro_invite_open === false, "host not told");
});

await check("Later holds the Overview card for a week, in this browser", () => {
  const s = store(), now = Date.parse("2026-11-01T12:00:00Z");
  assert(P.inviteDue(OPEN, now, s), "not due at first");
  P.inviteLater(now, s);
  assert(!P.inviteDue(OPEN, now + 6 * 86400e3, s), "back within the week");
  assert(P.inviteDue(OPEN, now + 7 * 86400e3 + 1, s), "gone for good after Later");
  assert(P.inviteDue(OPEN, now, null), "no storage must still show it");
});

await check("the tester card waits for an answer it knows, and for something to work", () => {
  const base = { tier: "free", pro_has_key: false, tester_nudge_done: false, tester_signed_up: false };
  const now = Date.parse("2026-11-01T12:00:00Z");
  assert(!P.testerCardDue({ tier: "free", pro_has_key: false }, true, now), "a backend without the flag reads as due");
  assert(!P.testerCardDue({ ...base, tester_nudge_done: true }, true, now), "shown twice");
  assert(!P.testerCardDue({ ...base, tester_signed_up: true }, true, now), "offered to a tester");
  assert(!P.testerCardDue({ ...base, pro_has_key: true }, true, now), "offered to a house with a key");
  assert(P.testerCardDue(base, true, now), "not due with someone on the map");
  assert(!P.testerCardDue({ ...base, edition: "bright" }, true, now), "shown in the Bright edition");
  assert(!P.testerCardDue({ ...base, first_seen_ts: now / 1000 - 86400 }, false, now), "due on day one");
  assert(P.testerCardDue({ ...base, first_seen_ts: now / 1000 - 8 * 86400 }, false, now), "not due after a week");
});

await check("the tester card says what testing costs, and when the report is off", () => {
  let yes = 0, no = 0, x = 0;
  const cb = { onSignUp: () => yes++, onNo: () => no++, onClose: () => x++ };
  const on = P.testerCard({ el, settings: { telemetry_enabled: true } }, cb);
  assert(on.textContent.includes("two years of PadSpan Pro") && on.textContent.includes("usage report stays on"), on.textContent);
  assert(!on.querySelector("[data-tester-card=report-off]"), "report-off line with the report on");
  const off = P.testerCard({ el, settings: { telemetry_enabled: false } }, cb);
  assert(off.querySelector("[data-tester-card=report-off]"), "report-off line missing");
  for (const k of ["yes", "no", "close"]) off.querySelector(`[data-tester-card=${k}]`).dispatchEvent(new Event("click"));
  assert(yes === 1 && no === 1 && x === 1, `callbacks ${yes}/${no}/${x}`);
});

await check("dates read as words, anything else as nothing", () => {
  assert(P.untilText("2026-12-31") === "December 31" && P.untilText("2027-01-05") === "January 5", "wrong words");
  assert(P.untilText("") === "" && P.untilText("soon") === "", "bad input shown");
});

await check("the tester sign-up says what a tester gets", () => {
  assert(/Pro free for two years/.test(TS.TESTER_PRO_LINE) && /usage report stays on/.test(TS.TESTER_PRO_LINE), TS.TESTER_PRO_LINE);
});

for (const n of ok) console.log("ok   " + n);
for (const f of fail) console.log("FAIL " + f);
console.log(JSON.stringify({ passed: ok.length, failed: fail }));
process.exit(fail.length ? 1 : 0);
