// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
//
// Point Align's preview gave each point's error and the residual as "%": a
// distance in fractions of the reference picture's width AND height, a share
// of nothing anyone could see. Both are now in the reference's metres; the
// rating keeps its limits, shown in metres for the plan. The per-point loop,
// the preview's summary and the chips are lifted out of views/maps.js by text
// and run as they ship.
//
// Run:  node tests/js/point_align_metres.mjs <repo-root>
// Prints one JSON line: { cases, failures }.
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const ROOT = process.argv[2];
const { install } = await import(pathToFileURL(ROOT + "/tests/js/dom_shim.mjs").href);
install(globalThis);
const V = ROOT + "/custom_components/padspan_ha/www/padspan-ha/views/";
const { mapFracToMetres } = await import(pathToFileURL(V + "stack_transform.js").href);

const cases = {}, failures = [];
const check = (name, ok, detail) => { cases[name] = !!ok; if (!ok) failures.push({ name, detail: detail === undefined ? null : detail }); };

const src = readFileSync(V + "maps.js", "utf-8").replace(/\r\n/g, "\n");
const cut = (a, b) => { const i = src.indexOf(a); return i < 0 ? "" : src.slice(i, src.indexOf(b, i)); };
const loop = cut("          // Per-point residuals using the RAW matrix", "          // Self-test: create synthetic points");
const summary = cut("      // -- Toolbar: result summary", "      const spacer = document.createElement");
const chips = cut("      // Per-point residual breakdown", "      panelsRow.appendChild(previewPanel);");
check("lifted", loop.includes("perPoint.push(") && summary.includes("stats.textContent") && summary.includes("qBadge")
  && chips.includes("chip.textContent"));

// The compute handler's loop, then _showPreview's summary and chips.
const solve = new Function("refPts", "tgtPts", "rawM", "rDx", "rDy", "refMap", "_placeOf", "mapFracToMetres", "console",
  `${loop}\nreturn perPoint;`);
const preview = new Function("perPoint", "resPct", "pairs", "rScale", "rRotation", "rStretch", "refMap", "_placeOf",
  "mapFracToMetres", "toolbar", "previewPanel", `${summary}\n${chips}\nreturn { resText, ptLimits };`);
const txt = (n) => (n.textContent || "").replace(/\s+/g, " ").trim();
const run = (place, resPct) => {
  const placeOf = (id) => (id === "ref" ? place : null);
  const pp = solve(refPts, tgtPts, [1, 0, 0, 1], 0.01, 0.02, { id: "ref" }, placeOf, mapFracToMetres, { log() {} });
  const toolbar = document.createElement("div"), panel = document.createElement("div");
  const out = preview(pp, resPct, 3, 1, 0, 1, { id: "ref" }, placeOf, mapFracToMetres, toolbar, panel);
  return { pp, out, bar: txt(toolbar), all: txt(panel), badge: toolbar.children[toolbar.children.length - 1] };
};

const tgtPts = [{ x: 0.2, y: 0.3 }, { x: 0.8, y: 0.3 }, { x: 0.5, y: 0.8 }];
// The fit moves everything by (0.01, 0.02) of the picture. Point 2's
// reference sits 0.05 of the width further right.
const refPts = [{ x: 0.2, y: 0.3 }, { x: 0.85, y: 0.3 }, { x: 0.5, y: 0.8 }];

// The reference: 20 m wide, 10 m deep, turned 0.3 rad (turning keeps
// lengths): 0.2 m across and 0.2 m down is 0.28 m; point 2 is 0.8 m and
// 0.2 m, 0.82 m. RMS sqrt((0.08 + 0.68 + 0.08) / 3) = 0.53 m. The fractions'
// RMS is 0.0316: resPct 3.2, Fair.
const place = { origin_x_m: 3, origin_y_m: 4, scale_x_m: 20, scale_y_m: 10, rotation_rad: 0.3, shear_rad: 0 };
{
  const { pp, out, bar, all, badge } = run(place, 3.2);
  check("each point's error is in metres", /Pt 1: 0\.28 m/.test(all) && /Pt 2: 0\.82 m/.test(all) && /Pt 3: 0\.28 m/.test(all), all);
  check("the worst point's tip gives metres", /Point 2 has high error \(0\.82 m\)/.test(all), all);
  check("the colours still go by the old rule", pp[0].pct === 2.2 && pp[1].pct === 4.5, pp.map(p => p.pct));
  check("the preview's top line gives the residual in metres, no %",
    /3 pairs \| residual 0\.53 m \| scale/.test(bar) && !/%/.test(bar) && out.resText === "0.53 m", bar);
  // The rating is a share of the picture's width (20 m) and depth (10 m):
  // in metres it depends on the direction, from the depth to the width.
  const lim = "For this plan: Excellent under 0.20–0.40 m, Fair under 0.50–1.00 m";
  check("the rating's limits are shown in metres for this plan, under the chips and on the badge",
    out.ptLimits.startsWith(lim) && /depend on the direction/.test(out.ptLimits)
    && all.includes(out.ptLimits) && badge.title === out.ptLimits && badge.textContent === "Fair", { ptLimits: out.ptLimits, all });
  check("no bare % under the preview", !/%/.test(all), all);
}

// A reference that leans (shear 0.2 rad): two errors at right angles in the
// picture are no longer at right angles in metres, so their lengths combine
// by the law of cosines, |v|² = a² + b² − 2ab·sin(shear).
{
  const sh = 0.2;
  const leaning = { ...place, shear_rad: sh };
  const { pp, out } = run(leaning, 3.2);
  const law = (a, b) => Math.sqrt(a * a + b * b - 2 * a * b * Math.sin(sh));
  check("a leaning reference: each point's metres follow the lean",
    Math.abs(pp[0].m - law(0.2, 0.2)) < 1e-9 && Math.abs(pp[1].m - law(-0.8, 0.2)) < 1e-9, pp.map(p => p.m));
  // The limits: the least and greatest stretch over every direction,
  // found by walking round the circle rather than by the closed form.
  let lo = Infinity, hi = 0;
  for (let k = 0; k < 36000; k++) {
    const t = k * Math.PI / 18000, o = mapFracToMetres(leaning, 0, 0), q = mapFracToMetres(leaning, Math.cos(t), Math.sin(t));
    const d = Math.hypot(q[0] - o[0], q[1] - o[1]);
    lo = Math.min(lo, d); hi = Math.max(hi, d);
  }
  const f = (x) => x.toFixed(2);
  check("a leaning reference: the limits run from its least stretch to its greatest",
    out.ptLimits.startsWith("For this plan: Excellent under " + f(0.02 * lo) + "–" + f(0.02 * hi) + " m, Fair under "
      + f(0.05 * lo) + "–" + f(0.05 * hi) + " m"), { ptLimits: out.ptLimits, lo, hi });
}

// A square plan: one number per limit, nothing about the direction.
{
  const { out } = run({ ...place, scale_y_m: 20 }, 3.2);
  check("a square plan: one metre figure per limit",
    out.ptLimits === "For this plan: Excellent under 0.40 m, Fair under 1.00 m.", out.ptLimits);
}

// The rating itself is unchanged: Excellent under 2, Fair under 5, of the
// fractions' RMS in percent.
{
  const label = (r) => run(place, r).badge.textContent;
  check("the rating's limits are unchanged",
    label(1.9) === "Excellent" && label(2) === "Fair" && label(4.9) === "Fair" && label(5) === "Poor",
    [1.9, 2, 4.9, 5].map(label));
}

// Apply's and Bake's messages give the same metres.
check("the Aligned and Baked messages give the residual in metres",
  src.includes('ctx.toast("Aligned (" + pairs + " pairs, residual " + resText + ")")')
  && src.includes('ctx.toast("Baked (" + pairs + " pairs, residual " + resText + ")")')
  && !/residual " \+ resPct/.test(src), null);

console.log(JSON.stringify({ cases, failures }));
