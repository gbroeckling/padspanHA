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
// outside that set throws here, which is the whole point.

import { readFileSync } from "node:fs";
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

function build(EDITIONS) {
  // eslint-disable-next-line no-new-func
  return new Function("APP_VERSION", "EDITIONS", "elSrc", "cardSrc", `
    ${elSrc}
    const obj = { ${cardSrc} };
    return obj._whatsNewCard;
  `)(APP_VERSION, EDITIONS, elSrc, cardSrc);
}

function ctx(settings) {
  const saved = [];
  return {
    state: { settings },
    _saved: saved,
    _callWS: (msg) => { saved.push(msg); return Promise.resolve({ settings }); },
    _toast: () => {},
    _scheduleRender: () => {},
  };
}

function run(label, settings, EDITIONS, check) {
  let out;
  try {
    const c = ctx(settings);
    out = build(EDITIONS).call(c);
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

for (const o of ok) console.log(`  ok   ${o}`);
for (const f of fail) console.log(`  FAIL ${f}`);
console.log(`${ok.length} passed, ${fail.length} failed`);
process.exit(fail.length ? 1 : 0);
