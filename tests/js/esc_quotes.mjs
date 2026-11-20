// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
//
// panel.js's esc(), the escape every view is handed as ctx.helpers.esc, read
// out of panel.js and run: what it gives for each character, and that a value
// written into a quoted attribute stays inside it.
// The pytest wrapper is tests/test_esc_quotes.py.
//
// Run:  node tests/js/esc_quotes.mjs <www-dir>
import { readFileSync } from "node:fs";
import { join } from "node:path";

const src = readFileSync(join(process.argv[2], "panel.js"), "utf-8");
const m = src.match(/function esc\(s\)\{[\s\S]*?\n\}/);
if (!m) { console.error("esc() not found in panel.js"); process.exit(2); }
const esc = new Function(`${m[0]}; return esc;`)();

// What a browser does with an attribute's source text: the value runs to the
// next quote of the kind that opened it, then entities are decoded.
const decode = (s) => s.replace(/&(amp|lt|gt|quot|#39);/g, (_all, n) => ({ amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'" })[n]);
function attrValue(html, name, q) {
  const start = html.indexOf(`${name}=${q}`) + name.length + 2;
  return decode(html.slice(start, html.indexOf(q, start)));
}

const NAMES = ['Sam\'s "work" phone', '" onmouseover="alert(1)', "' onmouseover='alert(1)", "a & b < c > d", "&quot; already", "plain"];
const out = {
  each: esc(`&<>"'`),
  plain: esc("Kitchen ESP32 (40%)"),
  empty: [esc(null), esc(undefined), esc("")],
  number: esc(42),
  twice: esc(esc(`"`)),
  rawQuotesLeft: NAMES.map((n) => /["']/.test(esc(n))),
  doubleQuoted: NAMES.map((n) => attrValue(`<span title="${esc(n)}" data-x="1">`, "title", '"') === n),
  singleQuoted: NAMES.map((n) => attrValue(`<span title='${esc(n)}' data-x='1'>`, "title", "'") === n),
  asText: NAMES.map((n) => decode(esc(n)) === n),
};
console.log(JSON.stringify(out));
