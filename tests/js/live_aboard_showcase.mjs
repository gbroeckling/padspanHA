// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
//
// Live Aboard's Showcase look (views/live_aboard_showcase.js), on its own and
// inside the real 3D view (views/live_aboard.js) under the DOM shim with a
// stub GL (tests/js/stub_gl.mjs).
//
//   table    every Showcase theme (iso_lights.js SHOWCASE_THEMES) has a row,
//            every row every field, in range; an unknown theme is Classic
//   classic  Classic is today's look exactly: with the switch off, or on in
//            Classic, the background, haze, sky, tiles and glow are the
//            same, and the same as before the feature
//   theme    another theme changes the background and its haze, the sky,
//            the tiles and the glow; the rain takes the theme's colour (the
//            flat Atlas's own); switched off, it is Classic again
//
// usage: live_aboard_showcase.mjs <www/padspan-ha dir>
// prints one JSON line: { cases: {name: result}, failures: [...] }

import { pathToFileURL } from "node:url";
import { join } from "node:path";
import * as shim from "./dom_shim.mjs";
import { installStubGL } from "./stub_gl.mjs";

const WWW = process.argv[2];
if (!WWW) { console.error("usage: live_aboard_showcase.mjs <www/padspan-ha dir>"); process.exit(2); }
shim.install();
installStubGL();
const url = (...p) => pathToFileURL(join(WWW, ...p)).href;
const LA = await import(url("views", "live_aboard.js"));
const LOOKS = await import(url("views", "live_aboard_showcase.js"));
const ISO = await import(url("views", "iso_lights.js"));
const AW = await import(url("views", "atlas_weather.js"));

const failures = [];
const cases = {};
const check = (name, ok, detail) => { cases[name] = !!ok; if (!ok) failures.push({ name, detail: detail === undefined ? null : detail }); };
const tryCase = async (name, fn) => {
  try { await fn(); } catch (e) { failures.push({ name, detail: String(e && e.stack || e).slice(0, 900) }); cases[name] = false; }
};
const settle = async (rounds = 12) => { await shim.flush(rounds); await new Promise(r => globalThis._realSetTimeout(r, 0)); };

// ── table ───────────────────────────────────────────────────────────────────
await tryCase("table: every Showcase theme has a row, every row every field", async () => {
  const themes = Object.keys(ISO.SHOWCASE_THEMES).sort(), rows = Object.keys(LOOKS.SHOWCASE_LOOKS).sort();
  const hex = (v) => /^#[0-9a-f]{6}$/i.test(String(v));
  const bad = rows.filter(k => {
    const r = LOOKS.SHOWCASE_LOOKS[k];
    return !(hex(r.bg) && hex(r.ground) && hex(r.sky) && (r.weather === null || hex(r.weather))
             && r.skyMix >= 0 && r.skyMix <= 1 && r.ambient > 0.4 && r.ambient <= 1.6
             && r.tile >= 0 && r.tile + 0.12 <= 1 && r.glow > 0.4 && r.glow <= 2)
      || JSON.stringify(Object.keys(r).sort()) !== JSON.stringify([...LOOKS.LOOK_FIELDS].sort());
  });
  check("table: every Showcase theme has a row, every row every field",
    themes.length >= 19 && JSON.stringify(themes) === JSON.stringify(rows) && bad.length === 0
    && LOOKS.lookOf("no_such_theme") === LOOKS.SHOWCASE_LOOKS.classic && LOOKS.lookOf("__proto__") === LOOKS.SHOWCASE_LOOKS.classic,
    { missing: themes.filter(k => !rows.includes(k)), extra: rows.filter(k => !themes.includes(k)), bad });
});
await tryCase("table: Classic is today's numbers", async () => {
  const c = LOOKS.SHOWCASE_LOOKS.classic;
  check("table: Classic is today's numbers", c.bg === "#0c110f" && c.ground === "#18201c" && c.skyMix === 0 && c.ambient === 1
    && c.tile === 0.38 && c.glow === 1 && c.tile + 0.12 === 0.5 && c.weather === null, c);
});

// ── the view ────────────────────────────────────────────────────────────────
const rect = (floor_id, x0, y0, x1, y1) => ({ type: "poly", floor_id, points_m: [[x0, y0], [x1, y0], [x1, y1], [x0, y1]] });
const MODEL = {
  floors: [{ id: "main", name: "Main" }],
  room_geometry_m: { Kitchen: rect("main", 0, 0, 6, 5), Den: rect("main", 6.1, 0, 10, 5), Deck: rect("main", 0, 5.2, 6, 8) },
  light_positions_m: { "light.kitchen": { x_m: 3, y_m: 2, floor_id: "main" }, "light.den": { x_m: 8, y_m: 2, floor_id: "main" } },
};
const LBE = {
  "light.kitchen": { entity_id: "light.kitchen", friendly_name: "Kitchen", state: "on", brightness: 200, shape: "pendant" },
  "light.den": { entity_id: "light.den", friendly_name: "Den", state: "on", brightness: 120, shape: "circle" },
};
const api = { toast(){}, toggle(){}, openRoom(){}, openFloor(){}, openControls(){}, openActivity(){}, controlsFor: () => null, lightsByEid: {}, hass: null };
const SC = (key) => ({ key, theme: ISO.SHOWCASE_THEMES[key] || ISO.SHOWCASE_THEMES.classic });
const RAIN = { slot: "atlas", settings: { atlas_weather_enabled: true }, entities: {}, telemetry: () => {},
               states: { "weather.home": { entity_id: "weather.home", state: "rainy", attributes: { temperature: 10 } } } };
const P = (over = {}) => ({ model: MODEL, floors: MODEL.floors, lightsByEid: LBE, hidden: new Set(), topFloorIds: null, quality: "low",
  telemetry: () => {}, onTouch: () => {}, states: {}, config: {}, bearing: 0, saveNorth: async () => true, useApi: () => api,
  haStartedMs: 0, load: async () => ({ data: {} }), edit: null, ...over });
function card(slot, over){
  const c = document.createElement("div"), stage = document.createElement("div");
  c.appendChild(stage);
  document.body.replaceChildren(c);
  return { ok: slot.attach(stage, P(over)), stage };
}
const lookOf = async (key, over) => {
  const slot = LA.liveAboardSlot(key);
  const { stage } = card(slot, over);
  await settle(30);
  const s = slot._state();
  return { slot, stage, look: s.look, weather: s.weather };
};
const strip = (l) => ({ bg: l.bg, fog: l.fog, ground: l.ground, sky: l.sky, skyI: Number(l.skyI.toFixed(6)), glow: l.glow,
  tiles: Number(l.tiles.toFixed(5)), halos: Number(l.halos.toFixed(5)) });

await tryCase("classic: switched off, or on in Classic, it is today's look exactly", async () => {
  const off = await lookOf("sc-off", { showcase3d: false, showcase: SC("neo_hud") });
  const absent = await lookOf("sc-absent", {});
  const classic = await lookOf("sc-classic", { showcase3d: true, showcase: SC("classic") });
  const unknown = await lookOf("sc-unknown", { showcase3d: true, showcase: { key: "retired_theme", theme: ISO.SHOWCASE_THEMES.classic } });
  const a = strip(absent.look);
  check("classic: switched off, or on in Classic, it is today's look exactly",
    a.bg === "#0c110f" && a.fog === "#0c110f" && a.ground === "#18201c" && a.glow === 1 && a.tiles > 0 && a.halos > 0
    && JSON.stringify(strip(off.look)) === JSON.stringify(a) && JSON.stringify(strip(classic.look)) === JSON.stringify(a)
    && JSON.stringify(strip(unknown.look)) === JSON.stringify(a) && off.look.key === "classic" && unknown.look.key === "retired_theme",
    { absent: a, off: strip(off.look), classic: strip(classic.look), unknown: strip(unknown.look) });
  for (const k of ["sc-off", "sc-absent", "sc-classic", "sc-unknown"]) LA.releaseLiveAboardSlot(k);
  await settle();
});
await tryCase("theme: another theme changes the background, sky, tiles and glow; the rain takes its colour; off, Classic again", async () => {
  const base = strip((await lookOf("sc-base", { weather: RAIN, weather3d: true })).look);
  const out = {};
  for (const key of ["cinematic_glass", "neo_hud", "luxury_realestate"]) {
    const r = await lookOf("sc-" + key, { showcase3d: true, showcase: SC(key), weather: RAIN, weather3d: true });
    const row = LOOKS.SHOWCASE_LOOKS[key], l = strip(r.look);
    out[key] = { l, colour: r.weather && r.weather.colour, snow: r.weather && r.weather.snowColour,
      ok: l.bg === row.bg && l.fog === row.bg && l.ground === row.ground && l.sky !== base.sky && l.tiles !== base.tiles
        && r.weather.snowColour === AW.weatherColourOf(ISO.SHOWCASE_THEMES[key])
        && Math.abs(l.halos - base.halos * row.glow) < 1e-3 && l.glow === row.glow && r.look.key === key };
    // Switched off again: Classic, exactly.
    r.slot.attach(r.stage, P({ showcase3d: false, showcase: SC(key), weather: RAIN, weather3d: true }));
    await settle(30);
    out[key].back = JSON.stringify(strip(r.slot._state().look)) === JSON.stringify(base);
    out[key].backColour = r.slot._state().weather.colour;
    LA.releaseLiveAboardSlot("sc-" + key);
    await settle();
  }
  LA.releaseLiveAboardSlot("sc-base");
  check("theme: another theme changes the background, sky, tiles and glow; the rain takes its colour; off, Classic again",
    Object.values(out).every(o => o.ok && o.back && o.backColour === "#ffffff")
    && out.cinematic_glass.colour === "#dceeff" && out.neo_hud.colour === "#4fe3ff"
    && out.luxury_realestate.colour === LOOKS.SHOWCASE_LOOKS.luxury_realestate.weather && out.luxury_realestate.snow === "#fff",
    { base, out });
});

console.log(JSON.stringify({ cases, failures }));
