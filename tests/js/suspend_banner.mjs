// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
//
// Overview's suspend banner after "Resume Normal", RUN rather than read.
//
// Review round 6, 2026-09-23: the poll that saw suspended=false recorded
// the new state BEFORE the 3 s interaction guard returned — and the click on
// "Resume Normal" is itself an interaction — so the rebuild was skipped and
// every later poll took the in-place path: the banner stayed up for good.
// Same extraction technique as focus_guard_cap.mjs.
//
// Run:  node tests/js/suspend_banner.mjs <panel.js path>

import { readFileSync } from "node:fs";

const src = readFileSync(process.argv[2], "utf8");

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
const p = {
  state: { view: "overview", live: { snapshot: { suspended: false } }, _isoUpdateObjects() {} },
  _lastSuspendState: true,              // the banner is showing
  _lastGoodRender: now,
  _lastUserInteraction: now - 1000,     // "Resume Normal" tapped 1 s ago
  // Past the guards means the full rebuild was reached; stop there.
  get $content() { throw new Error("rendered"); },
  shadowRoot: { querySelector: () => null },
};
const poll = () => {
  try { render.call(p, true); return "skipped"; }
  catch (e) { if (e.message === "rendered") return "rebuilt"; throw e; }
};
const first = poll();
now += 5000;
const later = poll();
console.log(JSON.stringify({ first, later }));
process.exit(first === "skipped" && later === "rebuilt" ? 0 : 1);
