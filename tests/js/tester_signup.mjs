// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
//
// "Become a tester" (views/tester_signup.js), RUN rather than read.
//
// The section is the one place the panel handles contact details, so what it
// does is driven here under the DOM shim: when it shows at all, that a
// non-administrator never reaches a tester_* command, that nothing is sent
// without the checks passing, that only the ticked setup lines are named,
// that a failed "Stop being a tester" leaves the sign-up standing, and that
// settings.js really puts the section inside the report's card.
//
// It also prints the panel's verdict on a list of forms; the pytest wrapper
// (tests/test_tester_signup_ui.py) runs tester.py's clean_form on the same
// forms and requires the same words — the two checks are one rule.
//
// Run:  node tests/js/tester_signup.mjs <views-dir>

import { pathToFileURL } from "node:url";
import { join } from "node:path";
import { install } from "./dom_shim.mjs";

const VIEWS = process.argv[2];
if (!VIEWS) { console.error("usage: tester_signup.mjs <views-dir>"); process.exit(2); }
install(globalThis);

const T = await import(pathToFileURL(join(VIEWS, "tester_signup.js")).href);
const SETTINGS = await import(pathToFileURL(join(VIEWS, "settings.js")).href);

const ok = [], fail = [];
async function check(name, fn) {
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

const LINES = [
  { key: "ha_version", label: "Home Assistant", value: "2026.9.3", text: "2026.9.3" },
  { key: "scanners", label: "Scanners", value: { ip_known: 2, espresense: 0, other: 1 }, text: "3 — 2 with diagnostics (ESPHome), 1 other" },
  { key: "rooms", label: "Rooms", value: 12, text: "12" },
  { key: "findmy_on_air", label: "Find My on the air now", value: { airtag: 1 }, text: "1 AirTag" },
];
// padspan_ha/tester_status, as tester.status() shapes it.
const NOT_SIGNED = { signed_up: false, record: null, setup: LINES, default_timezone: "America/Vancouver" };
const SIGNED = {
  signed_up: true, setup: LINES, default_timezone: "America/Vancouver",
  record: { tester_id: "0b1e3f6e-9c1a-4e0b-8a44-5a8c1f7d2e10", email: "tester@example.com", github: "octo",
            name: "Octo", interests: ["wled", "other"], interests_other: "Zigbee", notes: "hi", timezone: "Europe/Berlin",
            setup_off: ["rooms"], linked: true, signed_up_at: "2026-09-20T10:00:00Z", updated_at: "2026-09-21T10:00:00Z" },
};

/** A ctx that records every websocket call; `answers` maps a command to a
 *  function (msg) -> result, or throws to reject. */
function makeCtx({ admin = true, reportOn = true, signedFlag = false, answers = {} } = {}) {
  const calls = [], toasts = [];
  let renders = 0;
  const ctx = {
    hass: admin === null ? {} : { user: { is_admin: admin } },
    state: { settings: { telemetry_enabled: reportOn, tester_signed_up: signedFlag } },
    helpers: { el },
    actions: {
      renderRooms: () => { renders++; },
      wsCall: async (type, data = {}) => {
        calls.push({ type, ...data });
        const a = answers[type];
        if (!a) throw { code: "unknown_command", message: `no answer for ${type}` };
        return a({ type, ...data });
      },
    },
    toast: (m, err = false) => toasts.push({ m, err }),
  };
  return { ctx, calls, toasts, renders: () => renders };
}
const find = (root, key) => root && root.querySelector(`[data-tester=${key}]`);
const text = (n) => (n ? n.textContent : "");

// ── the checks, and their verdicts for the Python side ───────────────────────
const GOOD = { email: "tester@example.com", github: "@octo-cat", name: "Octo", interests: ["wled", "floors"],
               other: "", notes: "Two floors, five proxies.", timezone: "America/Vancouver", consent: true };
const HEX = "ec0234a357c8ad05341010a60a397d9b";
const JWT = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJhYmNkZWYxMjM0NTYifQ.c2lnbmF0dXJlc2lnbmF0dXJlc2ln";
const CASES = [
  ["valid", GOOD],
  ["no email", { ...GOOD, email: "" }],
  ["email without domain", { ...GOOD, email: "garry@" }],
  ["email with a space", { ...GOOD, email: "gar ry@example.com" }],
  ["email without a dot", { ...GOOD, email: "garry@localhost" }],
  ["email with an apostrophe", { ...GOOD, email: "o'brien@example.co.uk" }],
  ["no consent", { ...GOOD, consent: false }],
  ["consent not true", { ...GOOD, consent: "yes" }],
  ["unknown interest", { ...GOOD, interests: ["wled", "zigbee_pwn"] }],
  ["notes 500", { ...GOOD, notes: "a ".repeat(250).trim() + "b" }],
  ["notes 501", { ...GOOD, notes: "x".repeat(501) }],
  ["notes with a licence key", { ...GOOD, notes: "my key is PSPAN-AAAA-BBBB-CCCC-DDDD" }],
  ["notes with a lower-case licence key", { ...GOOD, notes: "pspan-aaaa-bbbb-cccc" }],
  ["notes with an IRK", { ...GOOD, notes: `IRK ${HEX}` }],
  ["notes with a 64-hex key", { ...GOOD, notes: HEX + HEX }],
  ["notes with a JWT", { ...GOOD, notes: `token ${JWT}` }],
  ["notes with a GitHub token", { ...GOOD, notes: "ghp_" + "A1b2C3d4E5".repeat(4) }],
  ["notes with a URL", { ...GOOD, notes: "see https://github.com/gbroeckling/padspanHA/issues/65 and discussions/categories/general" }],
  ["notes with a long product name", { ...GOOD, notes: "ESP32-S3-DevKitC-1-N8R8-with-external-antenna-and-PSRAM" }],
  ["notes with a UUID", { ...GOOD, notes: "id 99a58376-461d-4a9b-9700-2375fcfd705b" }],
  ["name with an IRK", { ...GOOD, name: HEX }],
  ["name too long", { ...GOOD, name: "n".repeat(65) }],
  ["other with a key", { ...GOOD, interests: ["other"], other: "PSPAN-1234-5678-ABCD" }],
  ["other unticked hides its key", { ...GOOD, interests: ["wled"], other: "PSPAN-1234-5678-ABCD" }],
  ["other too long", { ...GOOD, interests: ["other"], other: "o".repeat(81) }],
  ["github with double hyphen", { ...GOOD, github: "octo--cat" }],
  ["github starting with a hyphen", { ...GOOD, github: "-octo" }],
  ["github too long", { ...GOOD, github: "a".repeat(40) }],
  ["timezone with a space", { ...GOOD, timezone: "Mars/Olympus Mons" }],
  ["timezone Etc", { ...GOOD, timezone: "Etc/GMT+8" }],
  ["timezone three parts", { ...GOOD, timezone: "America/Argentina/Buenos_Aires" }],
  ["everything wrong", { email: "x", github: "--", name: "n".repeat(70), interests: ["nope"], notes: HEX, timezone: "?", consent: false }],
];
const verdicts = CASES.map(([name, form]) => ({ name, form, problems: T.testerProblems(form) }));

await check("a valid form has no problems", () => {
  assert(T.testerProblems(GOOD).length === 0, JSON.stringify(T.testerProblems(GOOD)));
});
await check("each refusal says what is wrong", () => {
  const v = Object.fromEntries(verdicts.map(x => [x.name, x.problems.join(" | ")]));
  assert(/email address/.test(v["no email"]) && /doesn't look right/.test(v["email without domain"]), "email");
  assert(v["email with an apostrophe"] === "", "a real address refused: " + v["email with an apostrophe"]);
  assert(/agree to be contacted/.test(v["no consent"]) && /agree to be contacted/.test(v["consent not true"]), "consent");
  assert(/Unknown choice/.test(v["unknown interest"]), "interest");
  assert(v["notes 500"] === "" && /too long/.test(v["notes 501"]), "notes length");
  for (const k of ["notes with a licence key", "notes with a lower-case licence key", "notes with an IRK",
                   "notes with a 64-hex key", "notes with a JWT", "notes with a GitHub token",
                   "name with an IRK", "other with a key"]) {
    assert(/please take it out/.test(v[k]), `${k} was not refused: ${v[k]}`);
  }
  for (const k of ["notes with a URL", "notes with a long product name", "notes with a UUID",
                   "other unticked hides its key", "timezone Etc", "timezone three parts"]) {
    assert(v[k] === "", `${k} was refused: ${v[k]}`);
  }
  assert(/GitHub/.test(v["github with double hyphen"]) && /GitHub/.test(v["github starting with a hyphen"]), "github");
  assert(/time zone/.test(v["timezone with a space"]), "timezone");
});

await check("the message names only the ticked setup lines", () => {
  const m = T.testerMessage({ ...GOOD, setupOff: ["rooms", "findmy_on_air"] }, LINES);
  assert(JSON.stringify(m.setup_keys) === JSON.stringify(["ha_version", "scanners"]), JSON.stringify(m.setup_keys));
  assert(m.github === "octo-cat", "the @ was not taken off");
  assert(m.link_reports === false && m.consent === true, "flags");
  assert(m.interests_other === "", "text for an unticked Other went");
  const all = T.testerMessage({ ...GOOD, setupOff: [] }, LINES);
  assert(all.setup_keys.length === LINES.length, "a line with nothing unticked went missing");
  const linked = T.testerMessage({ ...GOOD, link: true, interests: ["other"], other: " Zigbee " }, LINES);
  assert(linked.link_reports === true && linked.interests_other === "Zigbee", "link / other");
  // Nothing in the message carries the setup VALUES: the backend fills those in.
  assert(!JSON.stringify(m).includes("2026.9.3"), "setup values travel from the browser");
});

await check("the draft never pre-ticks consent", () => {
  const d = T.testerDraft(SIGNED);
  assert(d.consent === false, "consent pre-ticked");
  assert(d.email === "tester@example.com" && d.link === true && d.setupOff.join() === "rooms", "draft from the record");
  assert(T.testerDraft(NOT_SIGNED).timezone === "America/Vancouver", "time zone not filled from HA");
  assert(T.testerDraft(NOT_SIGNED).link === false, "link on by default");
});

// ── when it shows, and for whom ──────────────────────────────────────────────
await check("report off and not signed up: nothing at all", () => {
  const { ctx, calls } = makeCtx({ reportOn: false, signedFlag: false });
  assert(T.testerSection(ctx, false) === null, "section shown");
  assert(calls.length === 0, "a call was made");
});
await check("a non-admin sees one line and never reaches a tester command", () => {
  for (const [on, flag] of [[true, false], [false, true], [true, true]]) {
    const { ctx, calls } = makeCtx({ admin: false, reportOn: on, signedFlag: flag });
    const box = T.testerSection(ctx, on);
    assert(box && find(box, "not-admin"), "no line for a non-admin");
    assert(!find(box, "open") && !find(box, "withdraw") && !find(box, "send"), "a non-admin got a button");
    assert(calls.length === 0, `a non-admin reached ${JSON.stringify(calls)}`);
    if (flag) assert(/signed up/.test(text(find(box, "not-admin"))), "signed-up line missing");
  }
  const noUser = makeCtx({ admin: null });
  const box = T.testerSection(noUser.ctx, true);
  assert(find(box, "not-admin") && noUser.calls.length === 0, "no user is not an admin");
});
await check("an admin with the report on loads the status once, then is invited", async () => {
  const h = makeCtx({ answers: { "padspan_ha/tester_status": () => NOT_SIGNED } });
  const first = T.testerSection(h.ctx, true);
  assert(/Loading/.test(text(first)), "no loading line");
  T.testerSection(h.ctx, true);                       // a second render mid-load
  await settle();
  assert(h.calls.length === 1 && h.calls[0].type === "padspan_ha/tester_status", JSON.stringify(h.calls));
  assert(h.renders() >= 1, "no render after the status came back");
  const box = T.testerSection(h.ctx, true);
  assert(find(box, "open"), "no Become a tester button");
  assert(!find(box, "withdraw"), "withdraw offered with no sign-up");
});
await check("signed up with the report OFF: status and Stop being a tester", () => {
  const { ctx } = makeCtx({ reportOn: false, signedFlag: true });
  ctx.state._tester = { status: SIGNED, loading: false, loadError: "", open: false, form: null, preview: null, problems: [], busy: false };
  const box = T.testerSection(ctx, false);
  assert(box && find(box, "withdraw"), "no way to withdraw with the report off");
  assert(/Signed up on/.test(text(find(box, "status"))), "no signed-up date");
  assert(!find(box, "open"), "a new sign-up offered with the report off");
});
await check("not signed up with the report off (status loaded): hidden", () => {
  const { ctx } = makeCtx({ reportOn: false, signedFlag: true });
  ctx.state._tester = { status: NOT_SIGNED, loading: false, loadError: "", open: false, form: null, preview: null, problems: [], busy: false };
  assert(T.testerSection(ctx, false) === null, "shown after the sign-up was withdrawn");
});
await check("a status that fails to load says so and does not retry by itself", async () => {
  const h = makeCtx({ answers: { "padspan_ha/tester_status": () => { throw { code: "x", message: "boom" }; } } });
  T.testerSection(h.ctx, true);
  await settle();
  const box = T.testerSection(h.ctx, true);
  await settle();
  assert(/boom/.test(text(box)) && find(box, "retry"), "no error / retry button");
  assert(h.calls.length === 1, `retried by itself: ${h.calls.length} calls`);
});

// ── the form ─────────────────────────────────────────────────────────────────
function openForm(h, status = NOT_SIGNED) {
  h.ctx.state._tester = { status, loading: false, loadError: "", open: false, form: null, preview: null, problems: [], busy: false };
  const invite = T.testerSection(h.ctx, true);
  find(invite, status.signed_up ? "update" : "open").click();
  return T.testerSection(h.ctx, true);
}
function type(box, key, value) {
  const i = find(box, key);
  assert(i, `no ${key} field`);
  i.value = value;
  i.dispatchEvent({ type: "input" });
}
function setBox(box, key, on) {
  const cb = find(box, key);
  assert(cb, `no ${key} box`);
  cb.checked = on;
  cb.dispatchEvent({ type: "change" });
}

await check("nothing is sent while the checks fail", async () => {
  const h = makeCtx({ answers: { "padspan_ha/tester_signup": () => ({ ok: true, action: "signup", status: SIGNED }) } });
  let box = openForm(h);
  type(box, "email", "not-an-email");
  find(box, "send").click();
  await settle();
  box = T.testerSection(h.ctx, true);
  assert(!h.calls.some(c => c.type === "padspan_ha/tester_signup"), "sent with a bad email and no consent");
  assert(/doesn't look right/.test(text(find(box, "problems"))) && /agree to be contacted/.test(text(find(box, "problems"))),
    "problems not shown: " + text(find(box, "problems")));
  find(box, "preview-btn").click();
  await settle();
  assert(!h.calls.some(c => c.type === "padspan_ha/tester_preview"), "previewed with a bad form");
});
await check("a sign-up sends exactly what the form says", async () => {
  const h = makeCtx({ answers: {
    "padspan_ha/tester_preview": (m) => ({ payload: { schema: 1, contact: { email: m.email } }, problems: [], bytes: 42, url: "https://padspan.traks.ca/api/tester.php" }),
    "padspan_ha/tester_signup": () => ({ ok: true, action: "signup", status: SIGNED }),
  } });
  let box = openForm(h);
  assert(find(box, "consent").checked === false, "consent pre-ticked");
  assert(find(box, "link").checked === false, "link pre-ticked");
  assert(find(box, "setup-rooms").checked === true, "a setup line not pre-ticked");
  type(box, "email", "tester@example.com");
  setBox(box, "interest-wled", true);
  setBox(box, "setup-rooms", false);
  type(box, "notes", "Five proxies.");
  setBox(box, "consent", true);
  find(box, "preview-btn").click();
  await settle();
  box = T.testerSection(h.ctx, true);
  assert(/tester@example.com/.test(text(find(box, "preview"))), "preview not shown");
  find(box, "send").click();
  await settle();
  const sent = h.calls.filter(c => c.type === "padspan_ha/tester_signup");
  assert(sent.length === 1, `${sent.length} sends`);
  const m = sent[0];
  assert(m.email === "tester@example.com" && m.consent === true && m.link_reports === false, JSON.stringify(m));
  assert(JSON.stringify(m.interests) === '["wled"]', "interests " + JSON.stringify(m.interests));
  assert(!m.setup_keys.includes("rooms") && m.setup_keys.includes("ha_version"), "setup " + JSON.stringify(m.setup_keys));
  assert(m.timezone === "America/Vancouver", "time zone default not sent");
  const s = h.ctx.state._tester;
  assert(s.open === false && s.status.signed_up === true, "not shown as signed up afterwards");
  assert(h.toasts.some(t => /signed up/.test(t.m) && !t.err), "no thank-you");
  const after = T.testerSection(h.ctx, true);
  assert(find(after, "update") && find(after, "withdraw"), "no Update / Stop afterwards");
});
await check("a failed send keeps the form, says why, and is not retried", async () => {
  const h = makeCtx({ answers: { "padspan_ha/tester_signup": () => { throw { code: "network", message: "Could not reach padspan.traks.ca." }; } } });
  let box = openForm(h);
  type(box, "email", "tester@example.com");
  setBox(box, "consent", true);
  find(box, "send").click();
  await settle();
  box = T.testerSection(h.ctx, true);
  assert(find(box, "form"), "the form closed");
  assert(/Could not reach/.test(text(find(box, "problems"))), "reason not shown");
  assert(h.calls.filter(c => c.type === "padspan_ha/tester_signup").length === 1, "retried by itself");
  assert(h.ctx.state._tester.status.signed_up === false, "shown as signed up after a failure");
});
await check("an update pre-fills what was sent and says Send update", () => {
  const h = makeCtx({});
  const box = openForm(h, SIGNED);
  assert(find(box, "email").value === "tester@example.com", "email not pre-filled");
  assert(find(box, "setup-rooms").checked === false, "an unticked line came back ticked");
  assert(find(box, "link").checked === true, "link not kept");
  assert(find(box, "consent").checked === false, "consent pre-ticked on update");
  assert(/Send update/.test(text(find(box, "send"))), "button says " + text(find(box, "send")));
  assert(find(box, "other").value === "Zigbee", "Other text not pre-filled");
});
await check("changing the form after a Preview hides that preview", async () => {
  const h = makeCtx({ answers: { "padspan_ha/tester_preview": () => ({ payload: { a: 1 }, problems: [], bytes: 7, url: "u" }) } });
  let box = openForm(h);
  type(box, "email", "tester@example.com");
  setBox(box, "consent", true);
  find(box, "preview-btn").click();
  await settle();
  box = T.testerSection(h.ctx, true);
  assert(find(box, "preview").style.display === "block", "preview not shown");
  type(box, "notes", "changed");
  assert(find(box, "preview").style.display === "none" && h.ctx.state._tester.preview === null, "a stale preview stayed");
});

// ── stop being a tester ──────────────────────────────────────────────────────
await check("a withdraw the server did not confirm leaves the sign-up standing", async () => {
  const h = makeCtx({ reportOn: false, signedFlag: true, answers: {
    "padspan_ha/tester_withdraw": () => { throw { code: "refused", message: "padspan.traks.ca did not accept it (HTTP 500)." }; } } });
  h.ctx.state._tester = { status: SIGNED, loading: false, loadError: "", open: false, form: null, preview: null, problems: [], busy: false };
  find(T.testerSection(h.ctx, false), "withdraw").click();
  await settle();
  const box = T.testerSection(h.ctx, false);
  assert(h.ctx.state._tester.status.signed_up === true, "shown as withdrawn");
  assert(find(box, "withdraw") && /Could not stop/.test(text(find(box, "problems"))), "no error / no second chance");
  assert(h.toasts.some(t => t.err), "no error toast");
});
await check("a confirmed withdraw clears it, and with the report off the section goes", async () => {
  const h = makeCtx({ reportOn: false, signedFlag: true, answers: {
    "padspan_ha/tester_withdraw": () => ({ ok: true, status: { signed_up: false, record: null, setup: LINES } }) } });
  h.ctx.state._tester = { status: SIGNED, loading: false, loadError: "", open: false, form: null, preview: null, problems: [], busy: false };
  find(T.testerSection(h.ctx, false), "withdraw").click();
  await settle();
  assert(h.calls.length === 1 && h.calls[0].type === "padspan_ha/tester_withdraw", JSON.stringify(h.calls));
  assert(h.ctx.state._tester.status.signed_up === false, "still shown as signed up");
  assert(T.testerSection(h.ctx, false) === null, "section still shown with the report off");
});

// ── inside the report's card ─────────────────────────────────────────────────
function settingsCtx({ reportOn, signedFlag, admin }) {
  const h = makeCtx({ admin, reportOn, signedFlag, answers: { "padspan_ha/tester_status": () => NOT_SIGNED } });
  const helpers = new Proxy({ el, esc: (s) => String(s ?? ""), helpBtn: () => el("button", {}, "?"),
    pill: (t) => el("span", {}, String(t ?? "")), roomColor: () => "#52b788" },
  { get: (t, k) => (k in t ? t[k] : () => el("span")) });
  const actions = new Proxy(h.ctx.actions, { get: (t, k) => (k in t ? t[k] : async () => ({})) });
  const ctx = new Proxy({ ...h.ctx, helpers, actions,
    state: { ...h.ctx.state, view: "settings", _settingsTab: "presence", model: { floors: [], room_meta: {} } } },
  { get: (t, k) => (k in t ? t[k] : undefined) });
  return { h, ctx };
}
await check("settings.js puts the section inside the Help improve PadSpan card", () => {
  const { ctx } = settingsCtx({ reportOn: true, signedFlag: false, admin: true });
  const root = SETTINGS.render(ctx);
  const section = find(root, "section");
  assert(section, "no tester section on Settings → Presence with the report on");
  let card = section.parentNode;
  while (card && !(card.classList && card.classList.contains("card"))) card = card.parentNode;
  assert(card && /Help improve PadSpan/.test(card.textContent), "the section is not in the report's card");
  const off = settingsCtx({ reportOn: false, signedFlag: false, admin: true });
  assert(!find(SETTINGS.render(off.ctx), "section"), "section shown with the report off and no sign-up");
  const kept = settingsCtx({ reportOn: false, signedFlag: true, admin: false });
  assert(find(SETTINGS.render(kept.ctx), "section"), "a signed-up install lost the section when the report went off");
});

for (const o of ok) console.log(`  ok   ${o}`);
for (const f of fail) console.log(`  FAIL ${f}`);
// The panel's vocabulary and patterns, for the wrapper to hold equal to
// tester.py's (and so to tester.php's).
const vocab = {
  interests: T.TESTER_INTERESTS.map(([k]) => k),
  limits: T.TESTER_LIMITS,
  patterns: Object.fromEntries(Object.entries(T.TESTER_PATTERNS).map(([k, rx]) => [k, rx.source])),
  secrets: T.TESTER_SECRETS.map(([what, rx]) => [what, rx.source, rx.flags]),
};
console.log(JSON.stringify({ passed: ok.length, failed: fail, verdicts, vocab }));
process.exit(fail.length ? 1 : 0);
