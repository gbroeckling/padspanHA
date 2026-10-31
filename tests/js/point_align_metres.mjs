// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
//
// Point Align's preview gave each point's error as "%": a distance in
// fractions of the reference picture's width AND height, a share of nothing
// anyone could see. It is now in the reference's metres. The per-point loop
// and the chips are lifted out of views/maps.js by text and run as they ship.
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
const chips = cut("      // Per-point residual breakdown", "      panelsRow.appendChild(previewPanel);");
check("lifted", loop.includes("perPoint.push(") && chips.includes("chip.textContent"));

// The reference: 20 m wide, 10 m deep, turned 0.3 rad (turning keeps lengths).
const place = { origin_x_m: 3, origin_y_m: 4, scale_x_m: 20, scale_y_m: 10, rotation_rad: 0.3, shear_rad: 0 };
const run = new Function("refPts", "tgtPts", "rawM", "rDx", "rDy", "refMap", "_placeOf", "mapFracToMetres", "console", "previewPanel",
  `${loop}\n${chips}\nreturn perPoint;`);
const tgtPts = [{ x: 0.2, y: 0.3 }, { x: 0.8, y: 0.3 }, { x: 0.5, y: 0.8 }];
// The fit moves everything by (0.01, 0.02) of the picture: 0.2 m across and
// 0.2 m down, 0.28 m. Point 2's reference sits 0.05 (1 m) further right.
const refPts = [{ x: 0.2, y: 0.3 }, { x: 0.85, y: 0.3 }, { x: 0.5, y: 0.8 }];
const panel = document.createElement("div");
const pp = run(refPts, tgtPts, [1, 0, 0, 1], 0.01, 0.02, { id: "ref" }, (id) => (id === "ref" ? place : null),
  mapFracToMetres, { log() {} }, panel);
const txt = (n) => (n.textContent || "").replace(/\s+/g, " ").trim();
const all = txt(panel);
check("each point's error is in metres", /Pt 1: 0\.28 m/.test(all) && /Pt 2: 0\.82 m/.test(all) && /Pt 3: 0\.28 m/.test(all), all);
check("no bare %", !/%/.test(all), all);
check("the worst point's tip gives metres", /Point 2 has high error \(0\.82 m\)/.test(all), all);
check("the colours still go by the old rule", pp[0].pct === 2.2 && pp[1].pct === 4.5, pp.map(p => p.pct));

console.log(JSON.stringify({ cases, failures }));
