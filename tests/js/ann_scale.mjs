// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
//
// RUN the Overview annotation re-scale against a resize.
//
// Every label, beacon glyph, scanner marker and badge on the 3D map is
// counter-scaled by one factor k so it reads at a designed size whatever the
// map's zoom. k used to be fixed when the SVG was built, and the only thing
// that recomputed it was a full rebuild, gated behind a 4% width change. So a
// smaller resize never corrected the text at all, and dragging the panel left
// it wrong until the threshold tripped — text and symbols visibly too big.
//
// `_applyAnnScale` re-derives the transforms in place. That is resize
// behaviour: nobody exercises it by hand, and it fails by looking slightly
// wrong rather than by throwing, which is the kind of bug that survives for
// months. So it is executed here against real numbers.
//
// The contract under test, which purelive.js also depends on:
//   - the root svg carries data-ann-k
//   - each annotation carries data-ann="x y", its anchor
//   - its transform is translate(a) scale(k) translate(-a)

import { readFileSync } from "node:fs";
import { install } from "./dom_shim.mjs";

const OVERVIEW = process.argv[2];
if (!OVERVIEW) { console.error("usage: ann_scale.mjs <overview.js>"); process.exit(2); }

install(globalThis);
globalThis.getComputedStyle = (el) => ({
  paddingLeft: `${(el && el._padPx) || 0}px`,
  paddingRight: `${(el && el._padPx) || 0}px`,
});
const src = readFileSync(OVERVIEW, "utf8");
const ok = [], fail = [];
const check = (label, cond, detail) => { if (cond) ok.push(label); else fail.push(`${label}${detail ? " — " + detail : ""}`); };

function lift(name) {
  // `const NAME = <expr>;` — to the semicolon at nesting depth zero, not the
  // first one, because these bodies contain statements and template literals.
  const re = new RegExp(`const ${name}\\s*=\\s*`);
  const m = re.exec(src);
  if (!m) throw new Error(`could not lift ${name} from overview.js — renamed? update this test`);
  let i = m.index + m[0].length;
  let depth = 0, q = null;
  for (let j = i; j < src.length; j++) {
    const c = src[j], prev = src[j - 1];
    if (q) { if (c === q && prev !== "\\") q = null; continue; }
    if (c === '"' || c === "'" || c === "`") { q = c; continue; }
    if (c === "(" || c === "{" || c === "[") depth++;
    else if (c === ")" || c === "}" || c === "]") depth--;
    else if (c === ";" && depth === 0) return src.slice(i, j);
  }
  throw new Error(`unterminated declaration for ${name}`);
}

const REF = /const _REF_PX_PER_UNIT = ([\d.]+);/.exec(src);
if (!REF) throw new Error("_REF_PX_PER_UNIT is gone");

// Build the SVG the way the renderer does, then hand it to the real function.
function scene(hostW, padPct = 0) {
  const svg = document.createElement("svg");
  svg.setAttribute("viewBox", "0 0 1000 700");
  svg.setAttribute("data-ann-k", "0.500");
  const anns = [[100, 200], [640, 55], [12, 900]];
  for (const [ax, ay] of anns) {
    const g = document.createElement("g");
    g.setAttribute("data-ann", `${ax} ${ay}`);
    g.setAttribute("transform", `translate(${ax} ${ay}) scale(0.500) translate(${-ax} ${-ay})`);
    svg.appendChild(g);
  }
  const isoDiv = document.createElement("div");
  isoDiv.appendChild(svg);
  isoDiv.clientWidth = hostW;
  // Per-ELEMENT, not a global capture: two scenes are built before either is
  // applied, and a global stub meant the second scene's padding was read for
  // both. The bug was in this harness, not the code under test.
  isoDiv._padPx = (hostW * padPct) / 100;
  return { isoDiv, svg, anns };
}

/** The real _applyAnnScale, with only its three collaborators supplied. */
function applyFor(isoDiv) {
  const fn = new Function("isoDiv", "_REF_PX_PER_UNIT", `
    const _annScaleFor = ${lift("_annScaleFor")};
    const _annHostW = ${lift("_annHostW")};
    const _applyAnnScale = ${lift("_applyAnnScale")};
    return _applyAnnScale;
  `)(isoDiv, parseFloat(REF[1]));
  return fn;
}

const kOf = (svg) => parseFloat(svg.getAttribute("data-ann-k"));
const tOf = (g) => g.getAttribute("transform");

// 1. A NARROWER container must scale annotations UP in user units, so they
//    hold their on-screen size as the map shrinks. This is the whole point.
{
  const { isoDiv, svg } = scene(400);
  applyFor(isoDiv)();
  check("narrow container raises k", kOf(svg) > 0.5, `k=${kOf(svg)}`);
}

// 2. A WIDER container scales them back down, and k is capped at 1 — beyond
//    that the map is already large enough and text would start to shrink.
{
  const { isoDiv, svg } = scene(4000);
  applyFor(isoDiv)();
  check("wide container lowers k", kOf(svg) < 0.5, `k=${kOf(svg)}`);
  check("k never exceeds 1", kOf(svg) <= 1, `k=${kOf(svg)}`);
}
{
  const { isoDiv, svg } = scene(50);   // absurdly narrow
  applyFor(isoDiv)();
  check("k is clamped at 1 even when very narrow", kOf(svg) === 1, `k=${kOf(svg)}`);
}

// 3. EVERY annotation is re-derived, each about its OWN anchor. Getting this
//    wrong moves labels off their markers rather than resizing them.
{
  const { isoDiv, svg, anns } = scene(400);
  applyFor(isoDiv)();
  const k = kOf(svg).toFixed(3);
  let allRight = true, bad = "";
  for (const g of svg.querySelectorAll("[data-ann]")) {
    const [ax, ay] = g.getAttribute("data-ann").split(" ").map(Number);
    const want = `translate(${ax} ${ay}) scale(${k}) translate(${-ax} ${-ay})`;
    if (tOf(g) !== want) { allRight = false; bad = `${tOf(g)} != ${want}`; }
  }
  check("every annotation re-derived about its own anchor", allRight, bad);
  check("all three annotations were found", svg.querySelectorAll("[data-ann]").length === anns.length);
}

// 4. Padding is subtracted. The svg sits inside 6% side padding; measuring
//    clientWidth raw makes every unit 12% too wide and the text too small.
{
  const a = scene(1000, 0), b = scene(1000, 6);
  applyFor(a.isoDiv)(); applyFor(b.isoDiv)();
  check("side padding changes the measured width", kOf(a.svg) !== kOf(b.svg),
    `no-pad k=${kOf(a.svg)} padded k=${kOf(b.svg)}`);
  check("padding makes annotations larger, not smaller", kOf(b.svg) > kOf(a.svg));
}

// 5. An unchanged width must not rewrite anything — this runs on every resize
//    tick, and pointlessly reassigning transforms on a large map is work for
//    nothing.
{
  const { isoDiv, svg } = scene(400);
  const apply = applyFor(isoDiv);
  apply();
  const first = svg.querySelectorAll("[data-ann]").map(tOf);
  const g0 = svg.querySelectorAll("[data-ann]")[0];
  g0.setAttribute("transform", "SENTINEL");
  apply();                                   // same width: must be a no-op
  check("a second call at the same width does nothing", tOf(g0) === "SENTINEL", tOf(g0));
  check("the first pass did write transforms", first[0].includes("scale("));
}

// 6. Degenerate input must not throw — this is wired to a ResizeObserver that
//    fires during teardown and before the first build.
for (const [label, build] of [
  ["no svg yet", () => { const d = document.createElement("div"); d.clientWidth = 400; return d; }],
  ["svg with no viewBox", () => { const { isoDiv, svg } = scene(400); svg.setAttribute("viewBox", ""); return isoDiv; }],
  ["zero-width container", () => scene(0).isoDiv],
]) {
  try { applyFor(build())(); ok.push(`survives: ${label}`); }
  catch (e) { fail.push(`threw on ${label}: ${e.message}`); }
}

for (const o of ok) console.log(`  ok   ${o}`);
for (const f of fail) console.log(`  FAIL ${f}`);
console.log(`${ok.length} passed, ${fail.length} failed`);
process.exit(fail.length ? 1 : 0);
