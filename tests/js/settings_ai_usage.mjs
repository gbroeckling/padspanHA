// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
//
// Settings → AI, the AI credit tracker's line (views/settings.js _aiUsageRow),
// RUN on the DOM shim: a priced Claude model with nothing priced yet this
// month says $0.00, not "no price known" (review R2); an unknown model says so;
// Sample mode's empty answer shows nothing (review R3); a house with no AI
// Task and no reads this month shows nothing (review B4). The function is taken
// from settings.js as it is and run with a fake ctx. The pytest wrapper is
// tests/test_ai_usage.py.
//
// Run:  node tests/js/settings_ai_usage.mjs <repo-root>
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
const ROOT = process.argv[2];
const { install } = await import(pathToFileURL(ROOT + "/tests/js/dom_shim.mjs").href);
install(globalThis);

const src = readFileSync(ROOT + "/custom_components/padspan_ha/www/padspan-ha/views/settings.js", "utf8");
const start = src.indexOf("function _aiUsageRow(");
const body = src.slice(start, src.indexOf("\nfunction ", start + 10));
const aiUsageRow = new Function(`${body}\nreturn _aiUsageRow;`)();

const settle = async () => { for (let i = 0; i < 10; i++) await new Promise(r => setImmediate(r)); };
const results = {};
const check = (name, ok, detail) => { results[name] = { ok: !!ok, detail: ok ? undefined : detail }; };
const text = (n) => (n.textContent || "").replace(/\s+/g, " ").trim();
const el = (tagName, attrs, kids) => {
  const n = document.createElement(tagName);
  for (const [k, v] of Object.entries(attrs || {})) { if (k === "style") n.style.cssText = v; else n.setAttribute(k, v); }
  for (const c of [].concat(kids ?? [])) n.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
  return n;
};
const row = async (answer, settings = {}) => {
  const ctx = { state: { settings }, actions: { wsCall: async () => answer } };
  const box = aiUsageRow(ctx, el, async () => true);
  await settle();
  return box;
};
const MONTH = { month: "2026-11", main_maker: "claude", claude_reads: 0, reads: 0, stops: [], warned: false };

{
  const box = await row({ ...MONTH, main_priced: true, claude_usd: null }, { ai_credit_month_usd: 200 });
  check("a priced model on the 1st: $0.00 of the credit, never 'no price known'", box.style.display !== "none"
    && text(box).includes("Claude reads this month: 0, about $0.00 of your $200 monthly credit") && !text(box).includes("no price known"), text(box));
}
{
  const box = await row({ ...MONTH, main_priced: true, claude_reads: 3, claude_usd: 0.123 });
  check("a priced model with reads: its estimate", text(box).includes("Claude reads this month: 3, about $0.12"), text(box));
}
{
  const box = await row({ ...MONTH, main_priced: false, claude_usd: null });
  check("a model with no price: said", text(box).includes("(no price known for this model)"), text(box));
}
{
  const box = await row({});
  check("Sample mode's empty answer: nothing shown", box.style.display === "none" && !text(box).includes("undefined"), text(box));
}
{
  // What ai_usage.summary answers for a house that never chose an AI Task and never read (review B4).
  const none = { month: "2026-11", main_maker: null, main_priced: false, claude_reads: 0, claude_usd: null, reads: 0, stops: [],
                 credit_usd: 0, warn_pct: 0, warned: false, estimate: { calibration: 1, calibrated: false } };
  const box = await row(none);
  check("no AI Task and no reads this month: nothing shown", box.style.display === "none", text(box));
  const read = await row({ ...none, reads: 4 });
  check("no AI Task now, but reads this month: shown", read.style.display !== "none" && text(read).includes("AI reads this month: 4"), text(read));
}

console.log(JSON.stringify(results));
process.exit(0);
