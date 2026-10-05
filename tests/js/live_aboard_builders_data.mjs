// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
//
// The builders' settings as data for the server (house3d_builders.py): the
// photo step asks the AI Task for a builder's own settings and clamps the
// answer to their ranges, and a people figure is checked against FIGURE. One
// source: this reads views/live_aboard_furniture.js itself.
//
//   data     {kinds: FURNITURE_KINDS, furniture: FURNITURE, figure: FIGURE},
//            as JSON keeps them; custom_components/padspan_ha/
//            live_aboard_builders.json must equal it (--write rewrites it)
//   probes   recipes at and past every edge (each setting below, above and
//            inside its range, text for numbers, bad choices, bad colours,
//            sizes out of range, unknown kinds and keys) with what the
//            builders' clampRecipe makes of them; the server's clamp_recipe
//            must make the same (tests/test_house3d_photo.py)
//
// usage: live_aboard_builders_data.mjs <www/padspan-ha dir> [--write]
// prints one JSON line: { data, probes: [{in, out}] }

import { pathToFileURL } from "node:url";
import { join, resolve } from "node:path";
import { writeFileSync } from "node:fs";

const WWW = process.argv[2];
if (!WWW) { console.error("usage: live_aboard_builders_data.mjs <www/padspan-ha dir> [--write]"); process.exit(2); }
const F = await import(pathToFileURL(join(WWW, "views", "live_aboard_furniture.js")).href);

const data = JSON.parse(JSON.stringify({ kinds: F.FURNITURE_KINDS, furniture: F.FURNITURE, figure: F.FIGURE }));
if (process.argv.includes("--write")) {
  const out = resolve(WWW, "..", "..", "live_aboard_builders.json");
  writeFileSync(out, JSON.stringify(data, null, 1) + "\n", "utf8");
}

const probes = [];
const probe = (r) => probes.push({ in: JSON.parse(JSON.stringify(r)), out: JSON.parse(JSON.stringify(F.clampRecipe(r))) });
const bad = ["", "  ", "abc", null, true, [], {}, "NaN", "1e999"];
for (const [kind, def] of Object.entries(data.furniture)) {
  probe({ kind });
  probe({ kind: ` ${kind.toUpperCase()} ` });
  const lo = {}, hi = {}, mid = {}, txt = {}, junk = {};
  for (const s of def.params || []) {
    if (s.type === "int" || s.type === "num") {
      lo[s.key] = s.min - 1; hi[s.key] = s.max + 3.7; mid[s.key] = (s.min + s.max) / 2 + 0.25;
      txt[s.key] = ` ${s.max} `;
    } else if (s.type === "choice") {
      lo[s.key] = s.choices[0]; hi[s.key] = ` ${String(s.choices[s.choices.length - 1]).toUpperCase()} `;
      mid[s.key] = "not-a-choice"; txt[s.key] = 3;
    } else if (s.type === "bool") {
      lo[s.key] = false; hi[s.key] = "true"; mid[s.key] = 1; txt[s.key] = "yes";
    }
    junk[s.key] = bad[(s.key.length * 7) % bad.length];
  }
  const sizes = (k) => Object.fromEntries(["width_m", "depth_m", "height_m"].map((d, i) => [d, k(def.size[d], i)]));
  probe({ kind, params: lo, colors: ["#ABC", "nope", "#123456", "#fedcba", "#00ff00", 7], ...sizes(r => r[0] - 1) });
  probe({ kind, params: hi, colors: [], ...sizes(r => r[1] * 2), extra: { kept: [1, "two"] } });
  probe({ kind, params: { ...mid, unknown_setting: 4 }, colors: "red", ...sizes(r => (r[0] + r[1]) / 2) });
  probe({ kind, params: txt, colors: ["#5b6b7a"], ...sizes((r, i) => ["", "1.5", null][i]) });
  probe({ kind, params: junk, colors: null, ...sizes(() => "abc") });
}
probe({ kind: "a_kind_from_a_newer_padspan", params: { x: 1 }, colors: ["#112233"], width_m: 0.01, depth_m: 99, height_m: 2 });
probe({});
probe({ kind: "", colors: ["#zzzzzz"] });
probe(null);

console.log(JSON.stringify({ data, probes }));
