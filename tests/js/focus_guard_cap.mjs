// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
//
// _renderCurrentView's focused-field guard, RUN rather than read.
//
// Review round 5, 2026-09-23: a poll render skipped for a focused input
// stamped _lastGoodRender so the watchdog wouldn't rebuild mid-typing — but
// with no limit, a field left focused on an idle wall screen kept the live
// view frozen for good. The stamp now needs someone to have used the page in
// the last 2 minutes; past that the watchdog is free to step in.
//
// Same extraction technique as poll_settings_throttle.mjs.
//
// Run:  node tests/js/focus_guard_cap.mjs <panel.js path>

import { readFileSync } from "node:fs";

const PANEL = process.argv[2];
if (!PANEL) { console.error("usage: focus_guard_cap.mjs <panel.js>"); process.exit(2); }

const src = readFileSync(PANEL, "utf8");
const ok = [], fail = [];

function extractMethod(name) {
  const re = new RegExp(`^\\s{2}(?:async\\s+)?${name}\\s*\\(`, "m");
  const m = re.exec(src);
  if (!m) throw new Error(`could not find method ${name}() in panel.js — renamed? update this test`);
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

const render = new Function(`const obj = { ${extractMethod("_renderCurrentView")} }; return obj._renderCurrentView;`)();

let now = 1_000_000;
globalThis.performance = { now: () => now };

function panel(lastInteraction) {
  return {
    state: { view: "follow" },
    _lastGoodRender: 0,
    _lastUserInteraction: lastInteraction,
    // Past the guard means a real render was attempted; stop there.
    get $content() { throw new Error("rendered"); },
    shadowRoot: { querySelector: (q) => (q === ":focus" ? { tagName: "SELECT" } : null) },
  };
}

function poll(p) {
  try { render.call(p, true); return "skipped"; }
  catch (e) { if (e.message === "rendered") return "rendered"; throw e; }
}

// Someone picked from a list 10 s ago: skipped, and stamped as healthy.
let p = panel(now - 10_000);
if (poll(p) === "skipped" && p._lastGoodRender === now) ok.push("recent use: skip + stamp");
else fail.push(`recent use: expected skip + stamp, got stamp=${p._lastGoodRender}`);

// The field has sat focused with nobody touching the screen for 3 min:
// still skipped (a poll never snaps it shut), but NOT stamped, so the
// watchdog's own render can recover a stalled view.
p = panel(now - 180_000);
if (poll(p) === "skipped" && p._lastGoodRender === 0) ok.push("idle focus: skip, no stamp");
else fail.push(`idle focus: expected skip without stamp, got stamp=${p._lastGoodRender}`);

// Never touched at all (focus restored by the browser): no stamp either.
p = panel(0);
if (poll(p) === "skipped" && p._lastGoodRender === 0) ok.push("never used: no stamp");
else fail.push(`never used: expected no stamp, got stamp=${p._lastGoodRender}`);

for (const o of ok) console.log("ok   " + o);
for (const f of fail) console.log("FAIL " + f);
process.exit(fail.length ? 1 : 0);
