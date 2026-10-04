// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
//
// Live Aboard's rain and snow (views/live_aboard_weather.js), on its own and
// inside the real 3D view (views/live_aboard.js) under the DOM shim with a
// stub GL (tests/js/stub_gl.mjs).
//
//   spawn     nothing ever falls inside an indoor room, on any floor: each
//             drop's, flake's and splash's whole fall, at its layer's wind
//             (and a flake's sway), stays clear of every indoor outline;
//             what falls on a deck lands on it (the highest first), and with
//             the deck's floor hidden, on what is below; seeded, the same
//   budget    Low a few thousand at most, High more; a small house fewer
//   layers    light rain a slow near-vertical drizzle, heavy rain faster on a
//             17° wind with splashes, snow swaying, heavy snow settling
//   decision  the flat Atlas's own: decideAtlasWeather through holdVisual (a
//             reading that vanishes holds what showed for two minutes);
//             Outdoor weather off is nothing
//   dry       dry, or Rain and snow off: nothing built, and the view at rest
//             draws no frame at all
//   frames    while it shows the view draws on its own clock, capped: rain at
//             most 30 a second on Low and 60 on High, snow 30; it stops when
//             the weather does; prefers-reduced-motion draws it once, still
//
// usage: live_aboard_weather.mjs <www/padspan-ha dir>
// prints one JSON line: { cases: {name: result}, failures: [...] }

import { pathToFileURL } from "node:url";
import { join } from "node:path";
import * as shim from "./dom_shim.mjs";
import { installStubGL } from "./stub_gl.mjs";

const WWW = process.argv[2];
if (!WWW) { console.error("usage: live_aboard_weather.mjs <www/padspan-ha dir>"); process.exit(2); }
shim.install();
installStubGL();
const url = (...p) => pathToFileURL(join(WWW, ...p)).href;
const LA = await import(url("views", "live_aboard.js"));
const W = await import(url("views", "live_aboard_weather.js"));
const AW = await import(url("views", "atlas_weather.js"));
const HOUSE = await import(url("views", "live_aboard_house.js"));
const THREE = await import(url("vendor", "three", "three.module.min.js"));

const failures = [];
const cases = {};
const check = (name, ok, detail) => { cases[name] = !!ok; if (!ok) failures.push({ name, detail: detail === undefined ? null : detail }); };
const tryCase = async (name, fn) => {
  try { await fn(); } catch (e) { failures.push({ name, detail: String(e && e.stack || e).slice(0, 900) }); cases[name] = false; }
};

// ── the house: two floors, the upper one overhanging; a raised deck over a
// patio; a lawn far off on the garden floor ─────────────────────────────────
const rect = (floor_id, x0, y0, x1, y1) => ({ type: "poly", floor_id, points_m: [[x0, y0], [x1, y0], [x1, y1], [x0, y1]] });
const MODEL = {
  floors: [{ id: "main", name: "Main" }, { id: "upper", name: "Upper" }, { id: "garden", name: "Garden" }],
  floor_elevations: { main: 0, upper: 2.8, garden: 0 },
  room_geometry_m: {
    Kitchen: rect("main", 0, 0, 6, 5), Living: rect("main", 6.1, 0, 12, 5),
    Bedroom: rect("upper", 2, -2, 9, 4),                    // two metres past the main floor's north wall
    Deck: rect("upper", 8, 5.2, 12, 8),                     // raised, over part of the patio
    Patio: rect("main", 7, 5.2, 14, 11),
    Lawn: rect("garden", 40, 40, 46, 46),                   // far off: a patch of its own
  },
  light_positions_m: { "light.kitchen": { x_m: 3, y_m: 2, floor_id: "main" } },
};
const LBE = { "light.kitchen": { entity_id: "light.kitchen", friendly_name: "Kitchen", state: "on", brightness: 200, shape: "pendant" } };
const H = HOUSE.readHouse(MODEL, MODEL.floors, LBE, new Set());
const GROUND = H.ground - HOUSE.SLAB_T - 0.02;
const areaOf = (shown = () => true) => W.weatherArea({ rooms: H.rooms, ground: GROUND, shown });
const indoor = H.rooms.filter(r => !r.outdoor);
// An independent "how near is the nearest indoor room" (plan metres).
function nearestIndoor(x, y){
  let best = Infinity;
  for (const r of indoor) {
    if (HOUSE.inPoly(x, y, r.pts)) return -1;
    const P = r.pts;
    for (let i = 0, j = P.length - 1; i < P.length; j = i++) best = Math.min(best, HOUSE.segDist(x, y, P[j][0], P[j][1], P[i][0], P[i][1])[0]);
  }
  return best;
}
const NAMES = ["drizzle", "downpour", "splash", "flurry", "blizzard"];
const drops = (d) => Array.from({ length: d.n }, (_, i) => ({ x: d.pos[i * 4], y: d.pos[i * 4 + 1], land: d.pos[i * 4 + 2], ph: d.pos[i * 4 + 3] }));

// ── spawn ───────────────────────────────────────────────────────────────────
await tryCase("spawn: nothing ever falls inside an indoor room, on any floor", async () => {
  const A = areaOf(), out = {};
  for (const prof of ["low", "high"]) for (const name of NAMES) {
    const L = W.LAYERS[name], n = W.countFor(A, name, prof), d = W.spawnLayer(A, name, n, 7);
    const tanA = Math.tan(L.angle * Math.PI / 180), margin = 0.25 + (L.sway || 0);
    let worst = Infinity;
    for (const q of drops(d)) {
      const fall = A.top - q.land;
      for (let s = 0; s <= 40; s++) {
        const k = s / 40, px = q.x - W.WIND[0] * tanA * fall * k, py = q.y - W.WIND[1] * tanA * fall * k;
        worst = Math.min(worst, nearestIndoor(px, py));
      }
    }
    out[`${prof}/${name}`] = { asked: n, got: d.n, worst: Number(worst.toFixed(3)), margin };
  }
  check("spawn: nothing ever falls inside an indoor room, on any floor",
    Object.values(out).every(o => o.got === o.asked && o.asked > 0 && o.worst >= o.margin), out);
});
await tryCase("spawn: what falls on a deck lands on it, the highest first; its floor hidden, on what is below", async () => {
  const deck = H.rooms.find(r => r.name === "Deck"), patio = H.rooms.find(r => r.name === "Patio"), lawn = H.rooms.find(r => r.name === "Lawn");
  const inR = (r, q) => HOUSE.inPoly(q.x, q.y, r.pts);
  const all = drops(W.spawnLayer(areaOf(), "downpour", 9000, 3));
  const onDeck = all.filter(q => inR(deck, q)), onPatio = all.filter(q => inR(patio, q) && !inR(deck, q)), onLawn = all.filter(q => inR(lawn, q));
  const hidden = drops(W.spawnLayer(areaOf((fl) => fl.id !== "upper"), "downpour", 9000, 3)).filter(q => inR(deck, q));
  const elsewhere = all.filter(q => !inR(deck, q) && !inR(patio, q) && !inR(lawn, q));
  check("spawn: what falls on a deck lands on it, the highest first; its floor hidden, on what is below",
    onDeck.length > 20 && onDeck.every(q => Math.abs(q.land - 2.8) < 1e-6) && onPatio.length > 20 && onPatio.every(q => Math.abs(q.land) < 1e-6)
    && onLawn.length > 5 && onLawn.every(q => Math.abs(q.land) < 1e-6) && hidden.length > 20 && hidden.every(q => Math.abs(q.land) < 1e-6)
    && elsewhere.every(q => Math.abs(q.land - GROUND) < 1e-6),
    { deck: onDeck.length, patio: onPatio.length, lawn: onLawn.length, hidden: hidden.length, ground: GROUND });
});
await tryCase("spawn: the same house gets the same drops", async () => {
  const a = W.spawnLayer(areaOf(), "flurry", 500, 9), b = W.spawnLayer(areaOf(), "flurry", 500, 9);
  check("spawn: the same house gets the same drops", a.n === 500 && JSON.stringify(Array.from(a.pos)) === JSON.stringify(Array.from(b.pos)));
});

// ── budget and layers ───────────────────────────────────────────────────────
await tryCase("budget: Low a few thousand at most, High more; a small house fewer", async () => {
  const A = areaOf(), B = W.BUDGET;
  const total = (prof, v) => W.layersFor(v).filter(n => n !== "settle").reduce((a, n) => a + W.countFor({ area: 1e9 }, n, prof), 0);
  const looks = [{ kind: "rain", heavy: false }, { kind: "rain", heavy: true }, { kind: "snow", heavy: false }, { kind: "snow", heavy: true, rim: true }];
  const low = looks.map(v => total("low", v)), high = looks.map(v => total("high", v));
  const tiny = { area: 100 };
  check("budget: Low a few thousand at most, High more; a small house fewer",
    low.every(n => n > 0 && n <= 3500) && high.every((n, i) => n > low[i]) && NAMES.every(n => B.high[n] >= B.low[n])
    && NAMES.every(n => W.countFor(tiny, n, "high") < B.high[n] && W.countFor(tiny, n, "high") >= Math.round(B.high[n] * 0.3))
    && NAMES.every(n => W.countFor(A, n, "low") <= B.low[n]), { low, high });
});
await tryCase("layers: a slow near-vertical drizzle; a faster 17° downpour with splashes; snow sways; heavy snow settles", async () => {
  const L = W.LAYERS;
  check("layers: a slow near-vertical drizzle; a faster 17° downpour with splashes; snow sways; heavy snow settles",
    L.drizzle.angle === 3 && L.downpour.angle === 17 && L.drizzle.speed < L.downpour.speed && L.flurry.sway > 0 && L.blizzard.sway > 0
    && L.flurry.speed < L.drizzle.speed
    && JSON.stringify(W.layersFor({ kind: "rain", heavy: false })) === '["drizzle"]'
    && JSON.stringify(W.layersFor({ kind: "rain", heavy: true })) === '["downpour","splash"]'
    && JSON.stringify(W.layersFor({ kind: "snow", heavy: false })) === '["flurry"]'
    && JSON.stringify(W.layersFor({ kind: "snow", heavy: true, rim: true })) === '["flurry","blizzard","settle"]'
    && JSON.stringify(W.layersFor({ kind: "off" })) === "[]" && JSON.stringify(W.layersFor(null)) === "[]"
    && W.CAPS_FPS.rain.low === 30 && W.CAPS_FPS.rain.high === 60 && W.CAPS_FPS.snow.low === 30 && W.CAPS_FPS.snow.high === 30);
});

// ── decision ────────────────────────────────────────────────────────────────
const SET = (over = {}) => ({ atlas_weather_enabled: true, atlas_weather_rain_entity: "", atlas_weather_condition_entity: "",
  atlas_weather_warning_entity: "", atlas_weather_strength: 1, ...over });
const wxState = (cond, attrs = {}) => ({ "weather.home": { entity_id: "weather.home", state: cond, attributes: { temperature: 12, temperature_unit: "°C", ...attrs } } });
const WARN = (text) => ({ "sensor.home_warnings": { entity_id: "sensor.home_warnings", state: "1", attributes: { alert_1: text, friendly_name: "Home warnings" } } });
const WARN_REG = { "sensor.home_warnings": { entity_id: "sensor.home_warnings", platform: "environment_canada", translation_key: "warnings" } };
const bare = () => {
  const scene = new THREE.Scene();
  const renderer = { getDrawingBufferSize: (v) => v.set(1920, 1080), getPixelRatio: () => 1 };
  return { scene, host: { scene, renderer, camera: { fov: 40 } } };
};
const HOUSE_P = (shown = () => true) => ({ key: "k1", rooms: H.rooms, ground: GROUND, shown, walls: () => [] });
const objs = (scene) => scene.children.filter(o => String(o.name || "").startsWith("weather:")).map(o => o.name).sort();
await tryCase("decision: the flat Atlas's own, through holdVisual", async () => {
  const { scene, host } = bare();
  const w = W.createWeather(THREE, host);
  const t0 = Date.parse("2026-10-04T12:00:00Z");
  const step = (states, entities, dt, settings = SET()) => {
    w.update({ settings, states, entities, profile: "low", house: HOUSE_P(), nowMs: t0 + dt, colour: "#ffffff" });
    return { ...w.shown };
  };
  const want = (states, entities, settings = SET()) => AW.decideAtlasWeather(AW.weatherSettingsFrom(settings), states, entities);
  const seen = {
    rainy: [step(wxState("rainy"), {}, 0), want(wxState("rainy"), {})],
    pouring: [step(wxState("pouring"), {}, 1000), want(wxState("pouring"), {})],
    snowy: [step(wxState("snowy"), {}, 2000), want(wxState("snowy"), {})],
    cold: [step(wxState("rainy", { temperature: 0 }), {}, 3000), want(wxState("rainy", { temperature: 0 }), {})],
    warned: [step({ ...wxState("snowy"), ...WARN("Snowfall warning in effect") }, WARN_REG, 4000),
             want({ ...wxState("snowy"), ...WARN("Snowfall warning in effect") }, WARN_REG)],
  };
  const same = Object.values(seen).every(([a, b]) => a.kind === b.kind && a.heavy === b.heavy && a.rim === b.rim);
  const builtHeavy = objs(scene);
  // The weather entity vanishes (Home Assistant restarting): no signal, so
  // what showed holds for HOLD_MS, then goes — holdVisual's own answer.
  const held = step({}, {}, 4000 + 60000), heldWant = AW.holdVisual({ kind: "snow", heavy: true, rim: true }, t0 + 4000, want({}, {}), t0 + 64000);
  const gone = step({}, {}, 4000 + AW.HOLD_MS + 1000);
  // Outdoor weather switched off: nothing, whatever it is doing outside.
  const { host: host2, scene: scene2 } = bare();
  const w2 = W.createWeather(THREE, host2);
  w2.update({ settings: SET({ atlas_weather_enabled: false }), states: wxState("pouring"), entities: {}, profile: "low", house: HOUSE_P(), nowMs: t0, colour: "#ffffff" });
  check("decision: the flat Atlas's own, through holdVisual",
    same && seen.rainy[0].kind === "rain" && !seen.rainy[0].heavy && seen.pouring[0].heavy && seen.snowy[0].kind === "snow"
    && seen.cold[0].kind === "snow" && seen.warned[0].heavy && seen.warned[0].rim
    && ["weather:blizzard", "weather:flurry", "weather:settle"].every(n => builtHeavy.includes(n))
    && ["drizzle", "downpour", "splash"].every(n => !w._state().layers[n] || w._state().layers[n].to === 0)
    && held.kind === "snow" && held.heavy && heldWant.kind === "snow" && gone.kind === "off"
    && w2.shown.kind === "off" && objs(scene2).length === 0 && w2._state().built === 0,
    { seen, builtHeavy, held, gone, off: w2._state() });
  w.dispose(); w2.dispose();
});
await tryCase("dry: nothing built, and nothing asks for a frame", async () => {
  const { scene, host } = bare();
  const w = W.createWeather(THREE, host);
  const changed = w.update({ settings: SET(), states: wxState("sunny"), entities: {}, profile: "high", house: HOUSE_P(), nowMs: Date.now(), colour: "#ffffff" });
  const s = w._state();
  check("dry: nothing built, and nothing asks for a frame",
    !changed && s.built === 0 && s.frameMs === 0 && objs(scene).length === 0 && s.area === null && Object.keys(s.layers).length === 0, s);
});

// ── the view ────────────────────────────────────────────────────────────────
let clockOff = 0, frozen = null;
const realNow = performance.now.bind(performance);
// While a display is simulated, time is only what the harness moves on: the
// real milliseconds a step takes must not count as screen time.
performance.now = () => (frozen === null ? realNow() : frozen) + clockOff;
const shimRaf = globalThis.requestAnimationFrame;
globalThis.requestAnimationFrame = (fn) => shimRaf(() => fn(performance.now()));
const pendingFrames = () => shim.rafQueue.filter(Boolean).length;
const settle = async (rounds = 12) => { await shim.flush(rounds); await new Promise(r => globalThis._realSetTimeout(r, 0)); };
async function later(ms, rounds = 6){ clockOff += ms; await settle(rounds); }
/** `s` seconds of a `hz` display: one frame's worth of time, then its frame. */
async function display(slot, s, hz){
  frozen = realNow();
  try {
    const f0 = slot._state().frames;
    const n = Math.round(s * hz);
    for (let i = 0; i < n; i++) { clockOff += 1000 / hz; await shim.flush(1); }
    return slot._state().frames - f0;
  } finally { frozen = null; }
}
const api = { toast(){}, toggle(){}, openRoom(){}, openFloor(){}, openControls(){}, openActivity(){}, controlsFor: () => null, lightsByEid: {}, hass: null };
const P = (over = {}) => ({ model: MODEL, floors: MODEL.floors, lightsByEid: LBE, hidden: new Set(), topFloorIds: null, quality: "low",
  telemetry: () => {}, onTouch: () => {}, states: {}, config: {}, bearing: 0, saveNorth: async () => true, useApi: () => api,
  haStartedMs: 0, load: async () => ({ data: {} }), edit: async () => ({ data: {} }), weather3d: true,
  weather: { slot: "atlas", settings: SET(), states: wxState("sunny"), entities: {}, telemetry: () => {} }, ...over });
const rain = (cond = "rainy", over = {}) => ({ weather: { slot: "atlas", settings: SET(), states: wxState(cond), entities: {}, telemetry: () => {} }, ...over });
function card(slot, over){
  const c = document.createElement("div"), stage = document.createElement("div");
  c.appendChild(stage);
  document.body.replaceChildren(c);
  return { ok: slot.attach(stage, P(over)), stage };
}
const poll = (slot, stage, over) => slot.attach(stage, P(over));

await tryCase("dry: the view at rest draws no frame, and builds no weather", async () => {
  const slot = LA.liveAboardSlot("wx-dry");
  const { stage } = card(slot, {});
  await later(10000, 60);
  const f0 = slot._state().frames;
  await later(60000);
  poll(slot, stage, {});
  await later(5000);
  const s = slot._state();
  check("dry: the view at rest draws no frame, and builds no weather",
    s.profile && s.weather && s.weather.built === 0 && s.weather.frameMs === 0 && s.liveMs === 0 && s.frames === f0 && pendingFrames() === 0,
    { weather: s.weather, liveMs: s.liveMs, after: s.frames - f0 });
  LA.releaseLiveAboardSlot("wx-dry");
  await settle();
});
await tryCase("dry: with Rain and snow off nothing of it is made, rain or no rain", async () => {
  const slot = LA.liveAboardSlot("wx-off");
  const { stage } = card(slot, rain("pouring", { weather3d: false }));
  await later(10000, 60);
  const f0 = slot._state().frames, s = slot._state();
  await later(30000);
  // Switched off mid-rain: what was showing is let go of.
  poll(slot, stage, rain("pouring"));
  await later(500, 3);
  const wx = slot._weather(), during = wx ? wx._state().built : 0;
  poll(slot, stage, rain("pouring", { weather3d: false }));
  await later(1000);
  check("dry: with Rain and snow off nothing of it is made, rain or no rain",
    s.weather === null && slot._weather() === null && s.liveMs === 0 && slot._state().frames >= f0 && during > 0
    && wx._state().built === 0 && slot._state().weather === null, { s: s.weather, during, after: wx && wx._state() });
  LA.releaseLiveAboardSlot("wx-off");
  await settle();
});
await tryCase("frames: rain draws on its own clock, at most 30 a second on Low and 60 on High; snow 30", async () => {
  const out = {};
  for (const [name, quality, cond] of [["rainLow", "low", "rainy"], ["rainHigh", "high", "pouring"], ["snowHigh", "high", "snowy"]]) {
    const slot = LA.liveAboardSlot("wx-" + name);
    card(slot, rain(cond, { quality }));
    await later(10000, 60);
    const s = slot._state();
    out[name] = { liveMs: s.liveMs, profile: s.profile, shown: s.weather && s.weather.shown.kind,
                  at60: await display(slot, 3, 60), at144: await display(slot, 3, 144), at120: await display(slot, 2, 120) };
    LA.releaseLiveAboardSlot("wx-" + name);
    await settle();
  }
  const ok = (o, cap) => o.at60 <= cap * 3 + 1 && o.at60 >= cap * 3 * 0.9 && o.at144 <= cap * 3 + 1 && o.at120 <= cap * 2 + 1;
  check("frames: rain draws on its own clock, at most 30 a second on Low and 60 on High; snow 30",
    out.rainLow.liveMs === 36 && out.rainLow.profile === "low" && ok(out.rainLow, 30)
    && out.rainHigh.liveMs === 19 && out.rainHigh.profile === "high" && ok(out.rainHigh, 60)
    && out.snowHigh.liveMs === 36 && out.snowHigh.shown === "snow" && ok(out.snowHigh, 30), out);
});
await tryCase("frames: when the rain stops the view rests again", async () => {
  const slot = LA.liveAboardSlot("wx-stop");
  const { stage } = card(slot, rain("rainy"));
  await later(10000, 60);
  const raining = slot._state().liveMs;
  poll(slot, stage, rain("sunny"));
  for (let i = 0; i < 40; i++) await later(100, 2);         // the fade, played out
  await later(1000);
  const s = slot._state(), f1 = s.frames;
  await later(30000);
  check("frames: when the rain stops the view rests again",
    raining === 36 && s.liveMs === 0 && s.weather.built === 0 && s.weather.shown.kind === "off" && slot._state().frames === f1 && pendingFrames() === 0,
    { raining, liveMs: s.liveMs, weather: s.weather, after: slot._state().frames - f1 });
  LA.releaseLiveAboardSlot("wx-stop");
  await settle();
});
await tryCase("still: prefers-reduced-motion draws the same weather once", async () => {
  const realMM = globalThis.matchMedia;
  globalThis.matchMedia = (q) => ({ matches: /reduce/.test(String(q)), addEventListener() {}, removeEventListener() {} });
  try {
    const slot = LA.liveAboardSlot("wx-still");
    const { stage } = card(slot, {});
    await later(10000, 60);
    const f0 = slot._state().frames;
    poll(slot, stage, rain("pouring"));
    await later(16, 6);
    const once = slot._state().frames - f0, s = slot._state();
    await later(30000);
    check("still: prefers-reduced-motion draws the same weather once",
      once === 1 && s.liveMs === 0 && s.weather.still && s.weather.shown.heavy && s.weather.layers.downpour && s.weather.layers.downpour.op === 1
      && slot._state().frames === f0 + 1 && pendingFrames() === 0, { once, weather: s.weather, after: slot._state().frames - f0 });
    LA.releaseLiveAboardSlot("wx-still");
    await settle();
  } finally { globalThis.matchMedia = realMM; }
});
await tryCase("release: switched off, the weather goes with the view", async () => {
  const slot = LA.liveAboardSlot("wx-release");
  card(slot, rain("snowy"));
  await later(10000, 60);
  const wx = slot._weather(), before = wx && wx._state().built;
  LA.releaseLiveAboardSlot("wx-release");
  await settle();
  check("release: switched off, the weather goes with the view", before > 0 && wx._state().built === 0 && slot._weather() === null,
    { before, after: wx && wx._state() });
});

console.log(JSON.stringify({ cases, failures }));
