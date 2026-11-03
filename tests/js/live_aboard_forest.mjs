// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
//
// West Coast Forest's trees in Live Aboard (views/live_aboard_forest.js): the plan,
// on the house as the view reads it (live_aboard_house.js readHouse).
//
//   clear    on the fixture house, the estate and (given a path) a real house's
//            dump: no tree within its margin plus its crown of any room's
//            outline, outdoor rooms and decks too; nothing on the floor within
//            its margin; a log clear along its whole length
//   same     the same house, the same forest; another house, another forest;
//            Low's trees are High's, fewer
//   rain     the rain's patch moves only when the forest asks
//   sun      only a bright sunny day by daylight, dry, changes the look
//
// usage: live_aboard_forest.mjs <www/padspan-ha dir> [dump model_get.json]
// prints one JSON line: { cases: {name: result}, failures: [...], counts: {...} }

import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { join } from "node:path";
import { install } from "./dom_shim.mjs";

const WWW = process.argv[2], DUMP = process.argv[3] || "";
if (!WWW) { console.error("usage: live_aboard_forest.mjs <www/padspan-ha dir> [dump]"); process.exit(2); }
install(globalThis);

const failures = [], cases = {}, counts = {};
const check = (name, ok, detail) => { cases[name] = !!ok; if (!ok) failures.push({ name, detail: detail === undefined ? null : detail }); };
const url = (...p) => pathToFileURL(join(WWW, ...p)).href;
const FO = await import(url("views", "live_aboard_forest.js"));
const HOUSE = await import(url("views", "live_aboard_house.js"));
const WEATHER = await import(url("views", "live_aboard_weather.js"));
const SH = await import(url("sample_house.js"));
const q = new URLSearchParams("");

const inPoly = (P, x, y) => {
  let c = false;
  for (let i = 0, j = P.length - 1; i < P.length; j = i++) {
    const a = P[i], b = P[j];
    if ((a[1] > y) !== (b[1] > y) && x < ((b[0] - a[0]) * (y - a[1])) / (b[1] - a[1]) + a[0]) c = !c;
  }
  return c;
};
/** How far from the outline, 0 inside: worked out here, not by the file under test. */
const distTo = (P, x, y) => {
  if (inPoly(P, x, y)) return 0;
  let best = Infinity;
  for (let i = 0, j = P.length - 1; i < P.length; j = i++) {
    const a = P[j], b = P[i], dx = b[0] - a[0], dy = b[1] - a[1], l = dx * dx + dy * dy;
    const t = l > 0 ? Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / l)) : 0;
    best = Math.min(best, Math.hypot(a[0] + dx * t - x, a[1] + dy * t - y));
  }
  return best;
};
const roomsOf = (model) => {
  const m = HOUSE.splitLevels ? HOUSE.splitLevels(model) : model;
  return HOUSE.readHouse(m, m.floors, {}, new Set(), {}, 0).rooms;
};
// A small house of its own: two floors, an upstairs that overhangs, a deck, a yard's shed far off.
const rect = (floor_id, x0, y0, x1, y1) => ({ type: "poly", floor_id, points_m: [[x0, y0], [x1, y0], [x1, y1], [x0, y1]] });
const FIXTURE = { floors: [{ id: "main", name: "Main", level: 0 }, { id: "upper", name: "Upper", level: 1 }, { id: "yard", name: "Yard", level: 0, outdoor: true }],
  floor_elevations: { main: 0, upper: 2.8, yard: 0 },
  room_geometry_m: { Kitchen: rect("main", 0, 0, 5, 4), Living: rect("main", 5.1, 0, 11, 6), Office: rect("upper", -2, 0, 5, 5), Deck: rect("yard", 11.1, 0, 15, 6), Shed: rect("yard", 40, 30, 44, 33) } };
const houses = [["fixture", FIXTURE], ["estate", SH.estateFixture(q).MODEL]];
if (DUMP) { const raw = JSON.parse(readFileSync(DUMP, "utf8")); houses.push(["dump", raw.result || raw]); }

for (const [name, model] of houses) {
  const rooms = roomsOf(model), seed = FO.forestSeed(model), bad = [];
  check(`read: ${name}`, rooms.length > 0, rooms.length);
  for (const profile of ["high", "low"]) {
    const plan = FO.forestPlan(rooms, seed, profile);
    const away = (x, y) => Math.min(...rooms.map(r => distTo(r.pts, x, y)));
    for (const t of plan.trees) {
      const d = away(t.x, t.y);
      if (d < FO.TREE_MARGIN + t.crown - 1e-6) bad.push({ profile, tree: [t.x, t.y], d, crown: t.crown });
    }
    for (const kind of ["ferns", "salal", "rocks"]) for (const t of plan[kind]) {
      const d = away(t.x, t.y);
      if (d < FO.FLOOR_MARGIN + t.r - 1e-6) bad.push({ profile, kind, at: [t.x, t.y], d });
    }
    for (const t of plan.logs) for (let k = -3; k <= 3; k++) {
      const x = t.x + Math.cos(t.rot) * t.s * k / 6, y = t.y + Math.sin(t.rot) * t.s * k / 6, d = away(x, y);
      if (d < FO.FLOOR_MARGIN + t.r - 1e-6) bad.push({ profile, log: [x, y], d });
    }
    counts[`${name}:${profile}`] = { trees: plan.trees.length, near: plan.trees.filter(t => t.near).length, ferns: plan.ferns.length, salal: plan.salal.length, logs: plan.logs.length, rocks: plan.rocks.length };
    check(`dense: ${name} ${profile}`, plan.trees.length >= (profile === "high" ? 300 : 120), plan.trees.length);
    check(`budget: ${name} ${profile}`, plan.ferns.length <= FO.BUDGET[profile].ferns && plan.salal.length <= FO.BUDGET[profile].salal
      && plan.logs.length <= FO.BUDGET[profile].logs && plan.rocks.length <= FO.BUDGET[profile].rocks && plan.trees.filter(t => t.near).length <= FO.BUDGET[profile].near, counts[`${name}:${profile}`]);
  }
  check(`clear: ${name}`, bad.length === 0, bad.slice(0, 5));
  const a = FO.forestPlan(rooms, seed, "high"), b = FO.forestPlan(roomsOf(JSON.parse(JSON.stringify(model))), FO.forestSeed(JSON.parse(JSON.stringify(model))), "high");
  check(`same: ${name} the same house, the same forest`, JSON.stringify(a) === JSON.stringify(b));
  const at = (t) => `${t.x},${t.y}`, high = new Set(a.trees.map(at)), low = FO.forestPlan(rooms, seed, "low").trees;
  check(`same: ${name} Low's trees are High's, fewer`, low.length < a.trees.length && low.every(t => high.has(at(t))), [low.length, a.trees.length]);
}

// Another house, another forest: one room moved 2 m.
{
  const model = JSON.parse(JSON.stringify(houses[0][1])), key = Object.keys(model.room_geometry_m)[0];
  const seedA = FO.forestSeed(houses[0][1]);
  for (const p of model.room_geometry_m[key].points_m) p[0] += 2;
  check("same: another house, another seed", FO.forestSeed(model) !== seedA);
}
check("same: no rooms, no forest", FO.forestPlan([], 1) === null);

// The rain: its patch is the same without the forest's word, and only grows with it.
{
  const floor = { elev: 0, h: 2.8 }, rooms = [{ pts: [[0, 0], [10, 0], [10, 8], [0, 8]], floor, outdoor: false }];
  const plain = WEATHER.weatherArea({ rooms, ground: -0.3, shown: () => true }), grown = WEATHER.weatherArea({ rooms, ground: -0.3, shown: () => true, ...FO.RAIN_REACH });
  check("rain: reach and rise only when asked", grown.r === plain.r + FO.RAIN_REACH.reach && grown.top === plain.top + FO.RAIN_REACH.rise, { plain: [plain.r, plain.top], grown: [grown.r, grown.top] });
}
// The sun: a bright sunny day and nothing else.
for (const [cond, wet, night, want] of [["sunny", false, 0, 1], ["sunny", false, 1, 0], ["sunny", false, 0.5, 0.5], ["sunny", true, 0, 0],
                                        ["partlycloudy", false, 0, 0], ["cloudy", false, 0, 0], ["fog", false, 0, 0], ["rainy", false, 0, 0], ["clear-night", false, 1, 0], [null, false, 0, 0]]) {
  const got = FO.niceDay(cond, wet, night);
  check(`sun: ${cond}, wet ${wet}, night ${night}`, got === want, { got, want });
}
console.log(JSON.stringify({ cases, failures, counts }));
