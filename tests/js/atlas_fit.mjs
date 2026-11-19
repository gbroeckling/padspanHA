// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
//
// How big the house is drawn on a wall (views/atlas_fit.js), on fixture houses, the sample estate and (given a path)
// a real house's dump. No DOM: the rule and the measure are pure.
//
//   box      the rule's own box equals the drawing's (buildIsoSVG's viewBox), at any spacing
//   best     on every screen shape: nearly every room in sight, never smaller than the plain stack that shows as much,
//            never smaller than any spacing a person could have saved that shows as much, and the screen used
//   saved    the bug it ends: one saved spacing (tall, for a narrow column) on a wide wall is far back; the rule is not
//   judge    shortfall: far back is under 85% of what the screen allows, not a share of the screen
//   plate    a plate is 18 units thick straight down, whatever the sideways spacing; the badge stays in the drawing
//
// usage: atlas_fit.mjs <www/padspan-ha dir> [dump model_get.json]
// prints one JSON line: { cases: {name: result}, failures: [...] }

import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { join } from "node:path";
import { install } from "./dom_shim.mjs";

const WWW = process.argv[2], DUMP = process.argv[3] || "";
if (!WWW) { console.error("usage: atlas_fit.mjs <www/padspan-ha dir> [dump]"); process.exit(2); }
install(globalThis);

const failures = [], cases = {};
const check = (name, ok, detail) => { cases[name] = cases[name] === false ? false : !!ok; if (!ok) failures.push({ name, detail: detail === undefined ? null : detail }); };
const url = (...p) => pathToFileURL(join(WWW, ...p)).href;
const ISO = await import(url("views", "iso_lights.js"));
const FIT = await import(url("views", "atlas_fit.js"));

const rect = (floor_id, x0, y0, x1, y1) => ({ type: "poly", floor_id, points_m: [[x0, y0], [x1, y0], [x1, y1], [x0, y1]] });
const F3 = [{ id: "base", name: "Basement", level: -1 }, { id: "main", name: "Main", level: 0 }, { id: "upper", name: "Upper", level: 1 }];
const house = (floors, rooms) => ({ floors, room_geometry_m: rooms, light_positions_m: {}, rf_barriers_m: [] });
// A long house on three floors, the upper one's rooms at its two ends: the shape of the wall this was written for.
const WIDE = house(F3, {
  Rec: rect("base", 0, 0, 9, 8), Suite: rect("base", 9.2, 0, 16, 8), Garage: rect("base", 16.2, 1, 23, 8),
  Deck: rect("main", 0, 0, 6, 5), Bed: rect("main", 0, 5.2, 6, 9), Living: rect("main", 6.2, 0, 14, 7), Kitchen: rect("main", 10, 7.2, 14, 9),
  Entry: rect("main", 6.2, 7.2, 9.8, 9), Car: rect("main", 14.2, 0, 22, 7),
  Office: rect("upper", 0, 4, 4, 8), Study: rect("upper", 13, 0, 17, 4), Spare: rect("upper", 17.2, 0, 23, 5) });
const SMALL = house(F3, { Kitchen: rect("main", 0, 0, 5, 4), Living: rect("main", 5.1, 0, 11, 6), Office: rect("upper", 0, 0, 5, 5), Rec: rect("base", 0, 0, 8, 10) });
const TWO = house(F3.slice(1), { Kitchen: rect("main", 0, 0, 6, 5), Living: rect("main", 6.2, 0, 12, 8), Bed: rect("upper", 0, 0, 6, 5), Bath: rect("upper", 6.2, 0, 9, 4) });
const ONE = house(F3.slice(1, 2), { Kitchen: rect("main", 0, 0, 6, 5), Living: rect("main", 6.2, 0, 14, 8) });
const FOUR = house([...F3, { id: "attic", name: "Attic", level: 2 }], { ...SMALL.room_geometry_m, Loft: rect("attic", 1, 1, 6, 5) });
const houses = [["wide", WIDE], ["small", SMALL], ["two floors", TWO], ["four floors", FOUR]];
try {
  const SH = await import(url("sample_house.js"));
  const fx = SH.estateFixture ? SH.estateFixture(new URLSearchParams("")) : null;
  if (fx && fx.MODEL) houses.push(["estate", fx.MODEL]);
} catch (e) { failures.push({ name: "best: the estate loads", detail: String(e).slice(0, 300) }); }
if (DUMP) { const d = JSON.parse(readFileSync(DUMP, "utf8")); const m = d.model_get || d; houses.push(["dump", m.model || m]); }

const shapesOf = (m) => FIT.floorShapes(ISO.fabricFrame(m, m.floors, 0, 0), 0, 0);
const viewBox = (m, FG, HG) => /viewBox="([-\d.]+) ([-\d.]+) ([-\d.]+) ([-\d.]+)"/
  .exec(ISO.buildIsoSVG(m, {}, new Set(), null, FG, HG, {}, false, m.floors, { hugX: true })).slice(1).map(Number);
const SCREENS = [["a 1080p wall", 1920, 1080], ["a 4K wall", 3840, 2160], ["an ultrawide", 3440, 1440], ["a 4:3 tablet", 1024, 768],
  ["a wall turned", 1080, 1920], ["a tablet turned", 768, 1024]];
const px = (shapes, FG, HG, W, H) => FIT.unitPx(FIT.drawingBox(shapes, FG, HG), W, H, 32);

// ── box: the rule measures the drawing it will get ───────────────────────────────────────────────────────────────────
for (const [name, m] of houses) {
  const shapes = shapesOf(m);
  for (const [FG, HG] of [[150, 0], [260, -60], [90, -320], [200, 300], [60, 0]]) {
    const vb = viewBox(m, FG, HG), b = FIT.drawingBox(shapes, FG, HG);
    const want = [b.x0 - FIT.PAD.x, b.y0 - FIT.PAD.top, b.x1 - b.x0 + 2 * FIT.PAD.x, b.y1 - b.y0 + FIT.PAD.top + FIT.PAD.bottom + 32];
    const off = Math.max(...want.map((v, i) => Math.abs(v - vb[i])));
    check(`box: ${name} at ${FG}/${HG}`, off <= 1.5, { vb, want });
  }
  // The same shapes from a frame built at any spacing: the storey's own shift is taken back out.
  const again = FIT.floorShapes(ISO.fabricFrame(m, m.floors, 230, -140), 230, -140);
  const a = FIT.drawingBox(shapes, 150, 40), c = FIT.drawingBox(again, 150, 40);
  check(`box: ${name} from a frame at another spacing`, Math.abs(a.x0 - c.x0) + Math.abs(a.y1 - c.y1) + Math.abs(a.x1 - c.x1) + Math.abs(a.y0 - c.y0) < 0.01, { a, c });
}

// ── best: every house on every screen shape ──────────────────────────────────────────────────────────────────────────
for (const [name, m] of houses) {
  const shapes = shapesOf(m);
  for (const [screen, W, H] of SCREENS) {
    const b = FIT.bestLayout(shapes, W, H), tag = `best: ${name} on ${screen}`;
    check(`${tag}: nearly every room in sight`, FIT.hiddenShare(shapes, b.floorGap, b.horizGap) <= FIT.HIDDEN_MAX + 1e-9, b);
    check(`${tag}: no one room loses more than a sliver`, FIT.hiddenAt(shapes, b.floorGap, b.horizGap).worst <= FIT.ROOM_HIDDEN_MAX + 1e-9, FIT.hiddenAt(shapes, b.floorGap, b.horizGap));
    check(`${tag}: within the spacings it may use`, b.floorGap >= FIT.SPACING.min && b.floorGap <= FIT.SPACING.max && Math.abs(b.horizGap) <= FIT.SIDEWAYS.max, b);
    // Never beaten by a spacing a person could have saved that shows as much: the sliders' own range, coarsely.
    let rival = null;
    for (let FG = 60; FG <= 400; FG += 20) for (let HG = -400; HG <= 400; HG += 40) {
      const hid = FIT.hiddenAt(shapes, FG, HG);
      if (hid.share > FIT.HIDDEN_MAX || hid.worst > FIT.ROOM_HIDDEN_MAX) continue;
      const p = px(shapes, FG, HG, W, H);
      if (!rival || p > rival.p) rival = { FG, HG, p };
    }
    check(`${tag}: no saved spacing shows as much, larger`, !rival || b.px >= rival.p * 0.97, { b, rival });
    // The screen is used: the drawing reaches (nearly) one pair of edges, and where the house allows, most of the other.
    const box = FIT.drawingBox(shapes, b.floorGap, b.horizGap);
    const w = (box.x1 - box.x0 + 2 * FIT.PAD.x) * b.px / W, h = (box.y1 - box.y0 + FIT.PAD.top + FIT.PAD.bottom + 32) * b.px / H;
    check(`${tag}: reaches the screen's edges one way`, Math.max(w, h) >= 0.985 && Math.max(w, h) <= 1.0001, { w, h, b });
    if (shapes.length >= 3 && W > H) check(`${tag}: a wide screen is used both ways`, Math.min(w, h) >= 0.80, { w, h, b });
    // The same answer every time (it never flickers between two equals).
    const again = FIT.bestLayout(shapes, W, H);
    check(`${tag}: the same answer again`, again.floorGap === b.floorGap && again.horizGap === b.horizGap, { b, again });
  }
}
{
  const one = shapesOf(ONE), b = FIT.bestLayout(one, 1920, 1080);
  check("best: one floor has nothing to arrange", b.floorGap === 150 && b.horizGap === 0 && b.px > 0, b);
  const none = FIT.bestLayout([], 1920, 1080);
  check("best: no house, no arrangement", none.floorGap === 150 && none.horizGap === 0, none);
  check("best: no stage, the defaults", FIT.bestLayout(shapesOf(WIDE), 0, 0).floorGap === 150, null);
}

// ── saved: the bug this ends ─────────────────────────────────────────────────────────────────────────────────────────
// 260 / -60 was saved (it suits the Overview tab's narrow map). On a 1080p wall it drew the long house at about two
// thirds of the size the wall allows: a tower up the middle, space either side.
{
  const shapes = shapesOf(WIDE), W = 1920, H = 1080, b = FIT.bestLayout(shapes, W, H);
  const saved = FIT.shortfall(px(shapes, 260, -60, W, H), b.px);
  check("saved: a tall saved spacing is far back on a wide wall", saved.known && saved.low && saved.ratio < 0.8, saved);
  const fitted = FIT.shortfall(px(shapes, b.floorGap, b.horizGap, W, H), b.px);
  check("saved: the wall's own arrangement is not", fitted.known && !fitted.low && Math.abs(fitted.ratio - 1) < 1e-9, fitted);
  check("saved: and it is set sideways, not stacked, on a wide wall", Math.abs(b.horizGap) >= 100, b);
  const tall = FIT.bestLayout(shapes, 1080, 1920);
  check("saved: on a wall turned, the long house stays a stack", Math.abs(tall.horizGap) <= 60 && tall.floorGap >= 200, tall);
  check("saved: the plain stack hides rooms on this house (why it was spread)", FIT.hiddenShare(shapes, 150, 0) > FIT.HIDDEN_MAX, FIT.hiddenShare(shapes, 150, 0));
}

// ── judge ────────────────────────────────────────────────────────────────────────────────────────────────────────────
{
  check("judge: under 85% of what the screen allows is far back", FIT.shortfall(0.84, 1).low && !FIT.shortfall(0.86, 1).low && FIT.FAR_BACK === 0.85, null);
  check("judge: nothing measured is not far back", !FIT.shortfall(0, 1).low && !FIT.shortfall(1, 0).known && !FIT.shortfall(NaN, 1).known, null);
  const f = FIT.fillOf({ x0: 100, y0: 0, x1: 900, y1: 500 }, { left: 0, top: 0, right: 1000, bottom: 1000 });
  check("judge: fillOf says the shares", Math.abs(f.w - 0.8) < 1e-9 && Math.abs(f.h - 0.5) < 1e-9 && f.known, f);
  check("judge: fillOf with nothing drawn", !FIT.fillOf(null, { x0: 0, y0: 0, x1: 1, y1: 1 }).known, null);
  // A long low house on a tall screen fills little of it and is still as large as it can be.
  const one = shapesOf(ONE), box = FIT.drawingBox(one, 150, 0), p = FIT.unitPx(box, 1080, 1920, 32);
  check("judge: one long floor on a tall screen is not far back", !FIT.shortfall(p, FIT.bestLayout(one, 1080, 1920).px).low && (box.y1 - box.y0) * p / 1920 < 0.5, null);
}

// ── plate ────────────────────────────────────────────────────────────────────────────────────────────────────────────
{
  const svg = ISO.buildIsoSVG(WIDE, {}, new Set(), null, 110, -280, {}, false, WIDE.floors, { hugX: true });
  const sides = [...svg.matchAll(/<polygon points="([^"]+)"[^>]*data-role="slabside"/g)].map(m => m[1]);
  const slab = /<g data-role="floorslab"[^>]*>([\s\S]*?)<\/g>/.exec(svg);
  const polys = slab ? [...slab[1].matchAll(/points="([^"]+)"/g)].map(m => m[1].split(" ").map(p => p.split(",").map(Number))) : [];
  // A plate's side faces: each stands on two corners, and at each corner its two points are exactly 18 apart, one
  // straight under the other. (Through iso() at a fraction of a storey they also slid sideways with the L/R spacing.)
  const upright = (poly) => {
    const xs = [...new Set(poly.map(pt => pt[0]))];
    return xs.length === 2 && xs.every(x => { const ys = poly.filter(pt => pt[0] === x).map(pt => pt[1]); return ys.length === 2 && Math.abs(Math.abs(ys[0] - ys[1]) - 18) <= 1; });
  };
  const faces = polys.filter(upright);
  check("plate: 18 units thick, straight down, with floors set far sideways", polys.length >= 3 && faces.length === 2, { polys: polys.slice(0, 3), sides: sides.length });
  const vb = /viewBox="([-\d.]+) ([-\d.]+) ([-\d.]+) ([-\d.]+)"/.exec(svg).slice(1).map(Number);
  const badges = [...svg.matchAll(/<g class="lfloor"[^>]*>[\s\S]*?<circle cx="([-\d.]+)" cy="([-\d.]+)" r="15"/g)].map(m => [Number(m[1]), Number(m[2])]);
  check("plate: every floor's badge is inside the drawing", badges.length === 3 && badges.every(b => b[0] >= vb[0] + 15 && b[0] <= vb[0] + vb[2] - 15), { badges, vb });
  check("plate: and at its own floor's corner, not in a column", new Set(badges.map(b => Math.round(b[0] / 40))).size === 3, badges);
  // Off a wall (no hugX), the drawing keeps its old box: nothing moves for the sidebar or Mapping.
  const classic = /viewBox="([-\d.]+) ([-\d.]+) ([-\d.]+) ([-\d.]+)"/.exec(ISO.buildIsoSVG(SMALL, {}, new Set(), null, 150, 0, {}, false, SMALL.floors, {})).slice(1).map(Number);
  check("plate: off a wall the box keeps the 760 canvas", classic[0] <= 0 && classic[0] + classic[2] >= ISO.ISO.W, classic);
}

console.log(JSON.stringify({ cases, failures }));
