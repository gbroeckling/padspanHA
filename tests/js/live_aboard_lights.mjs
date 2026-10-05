// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
//
// Live Aboard's lights look like the real lights (views/live_aboard_house.js
// guessKind, drawnKind, fixtureParts; live_aboard_draft.js's kind), run for
// real.
//
//   kind      the order a light's kind is picked in: the kind set in Live
//             Aboard, the Atlas shape the person set, words in its name, a
//             footprint under 0.4 m never a strip, WLED names, then WLED a strip
//   strip     a strip, valance, under-cabinet, toe-kick and TV backlight: one
//             continuous line on a wall of its room (at any distance, never
//             mid-room) and light on the wall, the counter or the floor: no
//             row of glow dots
//   ring      a perimeter named pots: separate pots in from the walls, one per
//             corner, no bar between them, each with its own pool; a cove: a
//             wash down the top of the walls; a deck: pots at its edge on the floor
//   wled      a lamp, a panel on the wall, a small accent; not sure: a point and a pool
//   fan       a ceiling fan's blades can turn
//   draft     the 3D file's kind: read, sent, and lifted with the fixture
//
// usage: live_aboard_lights.mjs <www/padspan-ha dir>
// prints one JSON line: { cases: {name: result}, failures: [...] }

import { pathToFileURL } from "node:url";
import { join } from "node:path";

const WWW = process.argv[2];
if (!WWW) { console.error("usage: live_aboard_lights.mjs <www/padspan-ha dir>"); process.exit(2); }
const H = await import(pathToFileURL(join(WWW, "views", "live_aboard_house.js")).href);
const LC = await import(pathToFileURL(join(WWW, "views", "light_codes.js")).href);
const D = await import(pathToFileURL(join(WWW, "views", "live_aboard_draft.js")).href);

const failures = [];
const cases = {};
const check = (name, ok, detail) => { cases[name] = !!ok; if (!ok) failures.push({ name, detail: detail === undefined ? null : detail }); };
const tryCase = (name, fn) => { try { fn(); } catch (e) { failures.push({ name, detail: String(e && e.stack || e).slice(0, 900) }); cases[name] = false; } };
const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;
const rect = (floor_id, x0, y0, x1, y1) => ({ type: "poly", floor_id, points_m: [[x0, y0], [x1, y0], [x1, y1], [x0, y1]] });

const dev = (entity_id, name, extra = {}) => {
  const l = { entity_id, friendly_name: name, state: "on", rgb: null, bri: 255, ct: null, ...extra };
  LC.assignLightCodes([l]);
  l.shape = LC.resolveLightShape(l, {});
  return l;
};
const WLED = { effect_list: ["Solid", "Rainbow"] };
// A footprint in the Atlas's own frame: `deg` 150 runs along plan +y, 30
// along plan +x (isoToPlan), `cm` long.
const along = (cm, deg) => ({ width_cm: cm, height_cm: 1, rotation: deg });
const ALONG_Y = 150, ALONG_X = 30;
// One floor (2.8 m, ceiling 2.65 m): a 6 x 5 room and a deck beside it, up
// a storey so the deck has a rail.
const CEIL = 2.8 - H.SLAB_T;
function house(lights, shapes = {}, rooms = null){
  const model = {
    floors: [{ id: "ground", floor_to_floor_m: 2.8 }, { id: "main", floor_to_floor_m: 2.8 }],
    floor_elevations: { ground: 0, main: 2.8 },
    room_geometry_m: rooms || { "Master Bedroom": rect("main", 0, 0, 6, 5), "Upper Deck": rect("main", 6, 0, 9, 5),
                                Garage: rect("ground", 0, 0, 6, 6) },
    light_positions_m: Object.fromEntries(Object.entries(lights).map(([eid, v]) => [eid, { floor_id: "main", ...v.at }])),
  };
  const lbe = Object.fromEntries(Object.entries(lights).map(([eid, v]) => [eid, v.l]));
  const h = H.readHouse(model, model.floors, lbe, null, shapes);
  const byEid = Object.fromEntries(h.lights.map(L => [L.eid, L]));
  const ctxOf = (L) => ({ ...h.perFloor.get(L.floor), ground: h.ground });
  return {
    h, L: (eid) => byEid[eid],
    parts: (eid, kind) => { const L = byEid[eid]; return H.fixtureParts(kind ? { ...L, kind } : L, ctxOf(L)); },
    drawn: (eid) => { const L = byEid[eid]; return H.drawnKind(L, ctxOf(L)); },
  };
}
const fp = (cm, deg = ALONG_X) => H.footprint(along(cm, deg));

// ── kind: the order it is picked in ─────────────────────────────────────────
tryCase("kind: words in the name, as the real fixtures are named", () => {
  const g = (name, f = null, extra = {}) => H.guessKind(dev("light.x", name, extra), f, null);
  const got = {
    pots: g("Pots Main North"), stairPots: g("Stair pots north livingroom"), spot: g("Garden spotlight"), flood: g("Driveway flood"),
    valance: g("Kitchen Valance West", fp(300)), under: g("Under cabinet strip", fp(120)), counter: g("Counter strip", fp(120)),
    kick: g("Toe kick strip", fp(200)), stair: g("Stair LED strip", fp(200)), tv: g("TV backlight", fp(120)),
    screen: g("VoiceAssist7inch Backlight"), status: g("BLE-DigiK-C6-1 Status LED"), fan: g("Bedroom Fan"),
    pendant: g("Island pendant"), sconce: g("Hall sconce"), vanity: g("Bathroom vanity"), track: g("Gallery track"),
    tube: g("Lower Garage Flouresents"), ceiling: g("Ceiling light Main light utility"), plain: g("Master Bathroom"),
  };
  const want = { pots: "pot", stairPots: "pot", spot: "spot", flood: "spot", valance: "valance", under: "undercab", counter: "undercab",
    kick: "kick", stair: "kick", tv: "tv", screen: "led", status: "led", fan: "fan", pendant: "pendant", sconce: "sconce",
    vanity: "vanity", track: "track", tube: "tube", ceiling: "fixture", plain: "glow" };
  check("kind: words in the name, as the real fixtures are named", JSON.stringify(got) === JSON.stringify(want), { got, want });
});
tryCase("kind: a footprint under 0.4 m is never a strip, whatever its name", () => {
  const g = (name, f, extra = {}) => H.guessKind(dev("light.x", name, extra), f, null);
  const got = [g("Kitchen Valance", null), g("Kitchen Valance", fp(35)), g("LED strip", fp(38)), g("Garry's stair Rail LED XMAS", null),
    g("WLED-SoundReactive", null, WLED), g("WLED-SoundReactive", fp(39), WLED), g("Partition", fp(30), { platform: "partition" })];
  const long = [g("Kitchen Valance", fp(41)), g("WLED-SoundReactive", fp(665), WLED), g("Partition", fp(200), { platform: "partition" })];
  check("kind: a footprint under 0.4 m is never a strip, whatever its name",
    got.every(k => k === "glow") && JSON.stringify(long) === '["valance","strip","strip"]', { got, long });
});
tryCase("kind: WLED that is not a strip, by its name; WLED is a strip only last", () => {
  const g = (name, f = null, extra = WLED) => H.guessKind(dev("light.x", name, extra), f, null);
  const got = { gyverLamp: g("Gyver lamp"), lampLong: g("Gyver lamp", fp(200)), display: g("Emergency GarryOffice fun display"),
    matrix: g("LED Matrix 16x16"), panel: g("Desk panel"), pill: g("PillTaker-WLED"), ring: g("Doorbell ring"), orb: g("Orb"),
    gyver1: g("Gyver1"), long: g("Upper-South-WLED-Gledopto", fp(659)), valance: g("QuinLED Far West Valance", fp(430)),
    notWled: g("Desk lamp", null, {}), notWledDisplay: g("Fun display", null, {}),
    byOverride: H.guessKind(dev("light.x", "Gyver lamp", { type_override: "wled" }), null, null) };
  const want = { gyverLamp: "lamp", lampLong: "lamp", display: "panel", matrix: "panel", panel: "panel", pill: "accent", ring: "accent",
    orb: "accent", gyver1: "glow", long: "strip", valance: "valance", notWled: "glow", notWledDisplay: "glow", byOverride: "lamp" };
  check("kind: WLED that is not a strip, by its name; WLED is a strip only last", JSON.stringify(got) === JSON.stringify(want), { got, want });
});
tryCase("kind: the Atlas shape the person set wins over the name; the kind set in Live Aboard wins over both", () => {
  const l = dev("light.kitchen_valance", "Kitchen Valance", WLED);
  const got = { circle: H.guessKind(l, fp(300), "circle"), bar: H.guessKind(l, null, "bar"), hex: H.guessKind(l, null, "hex"),
    auto: H.guessKind(l, fp(300), "auto"), ringPots: H.guessKind(dev("light.p", "Master Bedroom Pots"), null, "perimeter"),
    ringOther: H.guessKind(dev("light.p", "Nicole's office"), null, "perimeter"),
    fan: H.guessKind(dev("fan.loft", "Loft"), null, "circle") };
  const want = { circle: "pot", bar: "valance", hex: "fixture", auto: "valance", ringPots: "pot_ring", ringOther: "perimeter", fan: "fan" };
  // (1): the 3D file's kind, when it is one this version draws.
  const stored = [H.storedKind({ z_m: 1, kind: "lamp" }), H.storedKind({ kind: "future_kind" }), H.storedKind({ kind: 3 }), H.storedKind(null)];
  const t = house({ "light.kitchen_valance": { l, at: { x_m: 3, y_m: 2.5, ...along(300, ALONG_X) } } }, { "light.kitchen_valance": "circle" });
  const asLamp = t.parts("light.kitchen_valance", stored[0]);
  check("kind: the Atlas shape the person set wins over the name; the kind set in Live Aboard wins over both",
    JSON.stringify(got) === JSON.stringify(want) && JSON.stringify(stored) === '["lamp",null,null,null]'
    && t.L("light.kitchen_valance").kind === "pot" && t.parts("light.kitchen_valance").kind === "pot"
    && asLamp.kind === "lamp" && asLamp.bulbs.length === 1 && asLamp.bulbs[0].prim === "puck" && asLamp.housings.length === 2,
    { got, stored, asLamp: asLamp.kind });
});
tryCase("kind: the picker's kinds are plain words and each has a height", () => {
  const ks = H.LIGHT_KINDS.map(([k]) => k), names = H.LIGHT_KINDS.map(([, n]) => n);
  check("kind: the picker's kinds are plain words and each has a height",
    new Set(ks).size === ks.length && ks.every(k => k in H.MOUNT && D.LIGHT_KIND.test(k)) && ks.includes("pot_ring") && ks.includes("glow")
    && names.every(n => typeof n === "string" && n.length > 2 && !/3d/i.test(n)), { ks, names });
});

// ── strip: one line on a wall, light on what it lands on ─────────────────────
const STRIPS = {
  "light.valance": { l: dev("light.valance", "Kitchen Valance"), at: { x_m: 3, y_m: 2.5, ...along(300, ALONG_X) } },
  "light.strip": { l: dev("light.strip", "LED strip"), at: { x_m: 1.0, y_m: 2.5, ...along(200, ALONG_Y) } },
  "light.under": { l: dev("light.under", "Under cabinet"), at: { x_m: 3, y_m: 4.5, ...along(150, ALONG_X) } },
  "light.kick": { l: dev("light.kick", "Toe kick strip"), at: { x_m: 3, y_m: 0.5, ...along(150, ALONG_X) } },
  "light.tv": { l: dev("light.tv", "TV backlight"), at: { x_m: 5.5, y_m: 2.5, ...along(120, ALONG_Y) } },
};
tryCase("strip: a continuous line and light on the wall, never a row of glow dots", () => {
  const t = house(STRIPS), out = {};
  let ok = true;
  for (const eid of Object.keys(STRIPS)) {
    const P = t.parts(eid);
    out[eid] = { kind: P.kind, bulbs: P.bulbs.length, halos: P.halos.length, washes: P.washes.length, h: P.bulbs[0] && P.bulbs[0].h,
                 len: P.bulbs[0] && P.bulbs[0].sx, picks: P.picks.length };
    ok = ok && P.halos.length === 0 && P.bulbs.length === 1 && P.bulbs[0].prim === "box" && P.washes.length >= 1 && P.picks.length >= 2;
  }
  const v = t.parts("light.valance"), u = t.parts("light.under"), k = t.parts("light.kick"), tv = t.parts("light.tv"), s = t.parts("light.strip");
  const down = v.washes.find(w => w.b[1] < 0), counter = u.washes.find(w => w.fixed), floorGlow = k.washes.find(w => w.fixed);
  ok = ok && v.kind === "valance" && near(v.bulbs[0].h, 2.1) && near(v.bulbs[0].sx, 3, 0.01) && down && near(down.h, 2.1) && !v.bulbs[0].hideOff
    && s.kind === "strip" && near(s.bulbs[0].h, CEIL - 0.12) && s.washes.some(w => w.b[1] > 0)            // up to the ceiling too
    && u.kind === "undercab" && near(u.bulbs[0].h, 1.4) && counter && near(counter.h, 0.91) && u.bulbs[0].hideOff
    && k.kind === "kick" && near(k.bulbs[0].h, 0.1) && floorGlow && floorGlow.h < 0.05 && k.bulbs[0].hideOff
    && tv.kind === "tv" && near(tv.bulbs[0].h, 1.2) && tv.washes.some(w => w.tex === "round") && tv.bulbs[0].hideOff;
  check("strip: a continuous line and light on the wall, never a row of glow dots", ok, out);
});
tryCase("strip: on the wall of its room it runs along, at any distance, never mid-room", () => {
  // Along x, 2.5 m from the walls at y = 0 and y = 5, 0.4 m from the wall at
  // x = 0 (running across it): it goes on a wall running its way.
  const lights = {
    "light.far": { l: dev("light.far", "Valance"), at: { x_m: 0.4, y_m: 2.4, ...along(120, ALONG_X) } },
    "light.mid": { l: dev("light.mid", "LED strip"), at: { x_m: 3, y_m: 2.5, ...along(80, ALONG_Y) } },
    "light.nosize": { l: dev("light.nosize", "Valance"), at: { x_m: 2, y_m: 1.2 } },
  };
  const t = house(lights, { "light.nosize": "bar" });
  const far = t.parts("light.far"), mid = t.parts("light.mid"), ns = t.parts("light.nosize");
  const onWall = (b) => Math.min(b.x, 6 - b.x, b.y, 5 - b.y) < 0.1;
  const ok = near(far.bulbs[0].y, 0.012, 0.03) && Math.abs(Math.cos(far.bulbs[0].yaw)) > 0.99 && far.wall
    && Math.min(mid.bulbs[0].x, 6 - mid.bulbs[0].x) < 0.1 && mid.wall
    && ns.kind === "valance" && onWall(ns.bulbs[0]) && near(ns.bulbs[0].y, 0.012, 0.03) && ns.wall
    && [far, mid, ns].every(P => onWall(P.bulbs[0]));
  // Wherever it is placed in the room, it lands on a wall.
  const bad = [];
  for (let i = 0; i < 40; i++) {
    const x = 0.3 + (i * 1.37) % 5.4, y = 0.3 + (i * 0.91) % 4.4, deg = i % 2 ? ALONG_X : ALONG_Y;
    const tt = house({ "light.s": { l: dev("light.s", "Kitchen valance"), at: { x_m: x, y_m: y, ...along(100, deg) } } });
    const b = tt.parts("light.s").bulbs[0];
    if (!onWall(b)) bad.push({ x, y, b: [b.x, b.y] });
  }
  check("strip: on the wall of its room it runs along, at any distance, never mid-room", ok && !bad.length,
    { far: far.bulbs[0], mid: mid.bulbs[0], ns: ns.bulbs[0], bad: bad.slice(0, 4) });
});

// ── ring: pots, a cove, a deck ───────────────────────────────────────────────
tryCase("ring: a perimeter named pots is separate pots in from the walls, one per corner, no bar", () => {
  const t = house({ "light.mbr_pots": { l: dev("light.mbr_pots", "Master Bedroom Pots"), at: { x_m: 3, y_m: 2.5 } } },
    { "light.mbr_pots": "perimeter" });
  const P = t.parts("light.mbr_pots");
  const pts = P.bulbs.map(b => [b.x, b.y]);
  const inFrom = pts.map(([x, y]) => Math.min(x, 6 - x, y, 5 - y));
  const corners = [[0.6, 0.6], [5.4, 0.6], [5.4, 4.4], [0.6, 4.4]].every(c => pts.some(p => Math.hypot(p[0] - c[0], p[1] - c[1]) < 0.05));
  const gaps = pts.map((p, i) => Math.min(...pts.filter((_, j) => j !== i).map(q => Math.hypot(p[0] - q[0], p[1] - q[1]))));
  const ok = P.kind === "pot_ring" && P.bulbs.length >= 8 && P.bulbs.every(b => b.prim === "puck" && near(b.h, CEIL - 0.012))
    && inFrom.every(d => near(d, 0.6, 0.01)) && corners && P.housings.length === 0 && !P.bulbs.some(b => b.prim === "box")
    && gaps.every(g => g >= 0.9 && g <= 1.7) && P.pools.length === P.bulbs.length && P.halos.every(h => h.cls === "s")
    && P.washes.length >= 4 && P.washes.every(w => w.tex === "scallop" && w.b[1] < 0);
  check("ring: a perimeter named pots is separate pots in from the walls, one per corner, no bar", ok,
    { kind: P.kind, n: P.bulbs.length, inFrom, corners, gaps, housings: P.housings.length, washes: P.washes.length });
});
tryCase("ring: any other perimeter is a cove: a wash down the top of the walls, unseen when off", () => {
  const t = house({ "light.office": { l: dev("light.office", "Nicole's office"), at: { x_m: 3, y_m: 2.5 } } }, { "light.office": "perimeter" });
  const P = t.parts("light.office");
  const ok = P.kind === "cove" && P.halos.length === 0 && P.bulbs.length === 4 && P.bulbs.every(b => b.hideOff && b.prim === "box" && near(b.h, CEIL - 0.012))
    && P.washes.length === 4 && P.washes.every(w => w.wall && near(w.b[1], -0.45) && w.h > CEIL - 0.02) && P.pools.length === 1 && P.picks.length >= 16;
  check("ring: any other perimeter is a cove: a wash down the top of the walls, unseen when off", ok,
    { kind: P.kind, bulbs: P.bulbs.length, washes: P.washes.map(w => [w.h, w.b]), halos: P.halos.length });
});
tryCase("ring: on a deck, small pots along its edge at floor level, never a bar in the air", () => {
  const t = house({ "light.deck": { l: dev("light.deck", "Deck pots"), at: { x_m: 7.5, y_m: 2.5, margin_cm: 90 } },
                    "light.deck2": { l: dev("light.deck2", "Deck lights"), at: { x_m: 7.5, y_m: 2.5 } } },
    { "light.deck": "perimeter", "light.deck2": "perimeter" });
  const P = t.parts("light.deck"), Q = t.parts("light.deck2");
  const inFrom = P.bulbs.map(b => Math.min(b.x - 6, 9 - b.x, b.y, 5 - b.y));
  const ok = [P, Q].every(R => R.kind === "pot_ring" && R.where === "out" && R.bulbs.length >= 8 && R.bulbs.every(b => b.prim === "puck" && b.h < 0.05)
      && R.housings.length === 0 && R.pools.length === R.bulbs.length)
    && inFrom.every(d => near(d, 0.25, 0.01)) && t.drawn("light.deck") === "pot_ring";
  check("ring: on a deck, small pots along its edge at floor level, never a bar in the air", ok,
    { kind: P.kind, where: P.where, n: P.bulbs.length, hs: P.bulbs.map(b => b.h), inFrom });
});

// ── wled: a lamp, a panel, an accent; not sure: a point and a pool ───────────
tryCase("wled: a lamp stands, a panel hangs on its wall, an accent lights nothing; unsure is a point and a pool", () => {
  const t = house({
    "light.gyver": { l: dev("light.gyver", "Gyver lamp", WLED), at: { x_m: 2, y_m: 2 } },
    "light.fun": { l: dev("light.fun", "Emergency GarryOffice fun display", WLED), at: { x_m: 3, y_m: 3.8 } },
    "light.pill": { l: dev("light.pill", "PillTaker-WLED", WLED), at: { x_m: 4, y_m: 2 } },
    "light.gyver1": { l: dev("light.gyver1", "Gyver1", WLED), at: { x_m: 1, y_m: 1, width_cm: 15, height_cm: 15 } },
    "light.bath": { l: dev("light.bath", "Master Bathroom"), at: { x_m: 4, y_m: 4, ...along(200, ALONG_X) } },
  });
  const lamp = t.parts("light.gyver"), panel = t.parts("light.fun"), pill = t.parts("light.pill"), g1 = t.parts("light.gyver1"), bath = t.parts("light.bath");
  const ok = lamp.kind === "lamp" && lamp.bulbs.length === 1 && near(lamp.bulbs[0].h, 0.75 + 0.13) && lamp.pools.length === 1 && lamp.kf > 0
    && panel.kind === "panel" && panel.wall && near(panel.bulbs[0].h, 1.5) && near(panel.bulbs[0].y, 5 - 0.012, 0.03) && panel.washes.length === 1
    && pill.kind === "accent" && pill.pools.length === 0 && pill.kf === 0 && near(pill.bulbs[0].h, 0.9)
    && [g1, bath].every(P => P.kind === "glow" && P.bulbs.length === 1 && P.bulbs[0].prim === "sphere" && P.bulbs[0].sx < 0.05
      && P.housings.length === 0 && P.washes.length === 0 && P.pools.length === 1 && P.halos.every(h => h.cls === "s"))
    && bath.pools[0].a[0] > 1;                               // its pool spreads over its footprint
  check("wled: a lamp stands, a panel hangs on its wall, an accent lights nothing; unsure is a point and a pool", ok,
    { lamp: lamp.kind, panel: [panel.kind, panel.bulbs[0]], pill: pill.kind, g1: g1.kind, bath: bath.kind });
});

// ── fan, and the other kinds still draw ──────────────────────────────────────
tryCase("fan: a ceiling fan's four blades, ready to turn", () => {
  const t = house({ "fan.bedroom": { l: dev("fan.bedroom", "Bedroom"), at: { x_m: 3, y_m: 2.5 } } });
  const P = t.parts("fan.bedroom");
  const ok = P.kind === "fan" && P.spin && P.spin.blades.length === 4 && P.spin.blades.every(b => P.housings[b.i] && P.housings[b.i].sx > 0.4 && b.r > 0.2)
    && near(P.spin.x, 3) && near(P.spin.y, 2.5);
  check("fan: a ceiling fan's four blades, ready to turn", ok, P.spin);
});
tryCase("fan: every kind the picker offers draws something, in its room and outside", () => {
  const t = house({ "light.any": { l: dev("light.any", "Thing"), at: { x_m: 3, y_m: 2.5, ...along(150, ALONG_X) } },
                    "light.out": { l: dev("light.out", "Thing"), at: { x_m: 7.5, y_m: 2.5 } },
                    "light.none": { l: dev("light.none", "Thing"), at: { x_m: 12, y_m: 2.5 } } });
  const bad = [];
  for (const [k] of H.LIGHT_KINDS) {
    for (const eid of ["light.any", "light.out", "light.none"]) {
      const P = t.parts(eid, k);
      const fin = (q) => [q.x, q.y, q.h].every(Number.isFinite);
      if (!P.bulbs.length || ![...P.bulbs, ...P.housings, ...P.halos, ...P.washes, ...P.picks].every(fin)) bad.push([k, eid, P.kind]);
    }
  }
  check("fan: every kind the picker offers draws something, in its room and outside", !bad.length, bad.slice(0, 6));
});

// ── draft: the 3D file's kind ────────────────────────────────────────────────
tryCase("draft: a light's kind is read, sent whole with its height, and changes what is drawn", () => {
  const v = D.ownedOf({ lights: { "light.a": { z_m: 1.2, kind: "lamp" }, "light.b": { kind: "pot_ring" }, "light.c": { kind: "Not A Kind" },
                                  "light.d": { kind: "future_kind", note: 1 }, "light.e": { z_m: 2 } } });
  const d = D.createDraft(v);
  // As the picker does: a kind set keeps the height; "PadSpan's guess" with no height left removes the entry.
  d.change(c => { c.lights["light.e"] = { ...c.lights["light.e"], kind: "valance" }; delete c.lights["light.b"]; });
  const ch = d.changes(), sorted = (o) => JSON.stringify(Object.keys(o).sort().map(k => [k, o[k]]));
  const sig = (vd) => D.heightsSignature(vd, "lights");
  const ok = JSON.stringify(v.lights) === JSON.stringify({ "light.a": { z_m: 1.2, kind: "lamp" }, "light.e": { z_m: 2 }, "light.b": { kind: "pot_ring" },
                                                            "light.d": { kind: "future_kind" } })
    && Object.keys(ch).join() === "lights" && sorted(ch.lights) === sorted({ "light.b": null, "light.e": { z_m: 2, kind: "valance" } })
    && sig({ lights: { "light.a": { kind: "lamp" } } }) !== sig({ lights: { "light.a": { kind: "pot" } } })
    && sig({ lights: { "light.a": { z_m: 1 } } }) !== sig({ lights: { "light.a": { z_m: 1, kind: "pot" } } });
  check("draft: a light's kind is read, sent whole with its height, and changes what is drawn", ok, { lights: v.lights, ch });
});
tryCase("draft: a height moves the fixture and the light on its wall, not where the light lands", () => {
  const t = house(STRIPS);
  const u = t.parts("light.under"), before = JSON.parse(JSON.stringify(u));
  const lifted = D.liftParts(u, { z_m: 1.6 }, CEIL);
  const wallW = u.washes.find(w => !w.fixed), counter = u.washes.find(w => w.fixed), w0 = before.washes.find(w => !w.fixed);
  const ok = near(lifted.z, 1.6) && near(lifted.zDefault, 1.4) && near(u.bulbs[0].h, 1.6) && near(wallW.h, w0.h + 0.2)
    && near(counter.h, 0.91) && near(u.picks[0].h, before.picks[0].h + 0.2);
  check("draft: a height moves the fixture and the light on its wall, not where the light lands", ok, { lifted: [lifted.z, lifted.zDefault] });
});

console.log(JSON.stringify({ cases, failures }));
process.exit(failures.length ? 1 : 0);
