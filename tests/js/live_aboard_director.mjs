// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
//
// The director (views/live_aboard_director.js) under the DOM shim, on a
// clock of its own, with a stand-in view and panel:
//
//   rules     what counts as going off, per kind; the first look never does
//   fly       a doorbell flies the camera there, shows its card with the
//             camera's snapshot (the camera proxy's link), and after the
//             hold goes home
//   touch     touched recently, someone followed, or the view busy: the card
//             alone; touched while it is up: no return home
//   off       no triggers, or not the sidebar: no timer, nothing looked at
//   people    a person or tag picked (atlas_3d_director_people) going into a
//             room, or arriving home: the same card and flight, once each per
//             cooldown, never over another card
//
// usage: live_aboard_director.mjs <www/padspan-ha dir>
// prints one JSON line: { cases: {name: result}, failures: [...] }

import { pathToFileURL } from "node:url";
import { join } from "node:path";
import * as shim from "./dom_shim.mjs";

const WWW = process.argv[2];
if (!WWW) { console.error("usage: live_aboard_director.mjs <www/padspan-ha dir>"); process.exit(2); }
shim.install();

// A clock of our own: timers run only when we say.
let T = 100000;
let timers = [];
let tid = 0;
globalThis.performance = { now: () => T };
globalThis.setTimeout = (fn, ms) => { const id = ++tid; timers.push({ id, at: T + ms, fn }); return id; };
globalThis.clearTimeout = (id) => { timers = timers.filter(t => t.id !== id); };
const advance = (ms) => {
  const end = T + ms;
  for (;;) {
    timers.sort((a, b) => a.at - b.at);
    const t = timers[0];
    if (!t || t.at > end) break;
    timers.shift();
    T = t.at;
    t.fn();
  }
  T = end;
};

const D = await import(pathToFileURL(join(WWW, "views", "live_aboard_director.js")).href);

const cases = {}, failures = [];
const check = (name, ok, got) => { cases[name] = !!ok; if (!ok) failures.push({ name, got }); };

const st = (state, attributes = {}) => ({ state, attributes });
const PIC = "/api/camera_proxy/camera.front?token=abc123";

function rig(over = {}){
  const root = document.createElement("div");
  const log = { fly: [], home: 0 };
  const w = {
    states: { "event.front_bell": st("2026-10-21T10:00:00.000+00:00", { device_class: "doorbell", friendly_name: "Front doorbell", event_type: "ring" }),
              "binary_sensor.back_door": st("off", { device_class: "door", friendly_name: "Back door" }),
              "alarm_control_panel.house": st("armed_away", { friendly_name: "House alarm" }),
              "camera.front": st("idle", { friendly_name: "Front camera", entity_picture: PIC }) },
    settings: { atlas_3d_director: [{ entity: "event.front_bell", camera: "camera.front" }, { entity: "binary_sensor.back_door", camera: "" },
                                    { entity: "alarm_control_panel.house", camera: "" }] },
    sidebar: true, busy: null, following: false, touched: T - 60000, placed: true, rooms: [],
    ...over,
  };
  const dir = D.createDirector({
    root, guard: (fn) => fn,
    settings: () => w.settings, states: () => w.states, sidebar: () => w.sidebar, busy: () => w.busy,
    following: () => w.following, touchedAt: () => w.touched,
    fly: (eid) => { log.fly.push(eid); return w.placed; }, goHome: () => { log.home++; },
    rooms: () => w.rooms, flyTo: (key) => { log.fly.push(key); return w.placed; },
  });
  return { root, dir, w, log };
}

// ── rules ────────────────────────────────────────────────────────────────────
{
  const W = D.wentOff;
  check("rules:first look is never news", !W("binary_sensor.d", undefined, st("on")) && !W("event.b", undefined, st("2026")), null);
  check("rules:door on", W("binary_sensor.d", st("off"), st("on")) && !W("binary_sensor.d", st("on"), st("on")) && !W("binary_sensor.d", st("on"), st("off")), null);
  check("rules:event fires on a new time", W("event.b", st("t1"), st("t2")) && !W("event.b", st("t1"), st("t1")) && !W("event.b", st("t1"), st("unavailable")), null);
  check("rules:event back from unavailable counts", W("event.b", st("unavailable"), st("t3")), null);
  check("rules:alarm triggered", W("alarm_control_panel.a", st("armed_home"), st("triggered")) && !W("alarm_control_panel.a", st("disarmed"), st("arming")), null);
  check("rules:other kinds never", !W("light.x", st("off"), st("on")), null);
  const t = D.triggersOf([{ entity: "event.a", camera: "camera.c" }, { entity: "event.a" }, { entity: "light.x" }, { entity: "binary_sensor.b", camera: "sensor.q" }, null, "x"]);
  check("rules:triggers cleaned", JSON.stringify(t) === JSON.stringify([{ entity: "event.a", camera: "camera.c" }, { entity: "binary_sensor.b", camera: "" }]), t);
  check("rules:words", D.wordsOf("event.a", st("t", { device_class: "doorbell" })) === "Someone rang the doorbell"
    && D.wordsOf("binary_sensor.s", st("on", { device_class: "smoke" })) === "Alarm: smoke"
    && D.wordsOf("binary_sensor.m", st("on", { device_class: "motion" })) === "Motion"
    && D.wordsOf("alarm_control_panel.a", st("triggered")) === "The alarm is going off", null);
  check("rules:snapshot only through the camera proxy", (D.snapshotOf(st("idle", { entity_picture: PIC })) || "").startsWith(PIC + "&_=")
    && D.snapshotOf(st("idle", { entity_picture: "https://elsewhere.example/x.jpg" })) === null && D.snapshotOf(st("idle")) === null, null);
}

// ── fly: the doorbell rings ──────────────────────────────────────────────────
{
  const { dir, w, log, root } = rig();
  dir.attach();
  check("fly:first look flies nowhere", log.fly.length === 0 && !dir.showing() && dir.state().looking, dir.state());
  w.states = { ...w.states, "event.front_bell": st("2026-10-21T10:05:00.000+00:00", w.states["event.front_bell"].attributes) };
  advance(1000);
  const s = dir.state();
  check("fly:flies to the doorbell", log.fly.join() === "event.front_bell" && s.flights === 1, { fly: log.fly, s });
  check("fly:card says who and what", dir.showing() && s.card.text.includes("Front doorbell") && s.card.text.includes("Someone rang the doorbell"), s.card);
  check("fly:card shows the snapshot", typeof s.card.img === "string" && s.card.img.startsWith(PIC), s.card);
  const el = root.querySelector("[data-la3d-director]");
  check("fly:card in the view", !!el && el.hidden === false, null);
  advance(D.HOLD_MS - 1500);
  check("fly:holds a while", log.home === 0 && dir.showing(), log);
  advance(2000);
  check("fly:then home and the card gone", log.home === 1 && !dir.showing() && el.hidden === true, { log, s: dir.state() });
  // The door after it: no camera, no picture.
  w.states = { ...w.states, "binary_sensor.back_door": st("on", w.states["binary_sensor.back_door"].attributes) };
  advance(1000);
  check("fly:door opens, no camera", log.fly.at(-1) === "binary_sensor.back_door" && dir.state().card.img === null
    && dir.state().card.text.includes("Opened"), dir.state());
  // An alarm and a door at once: the alarm.
  w.states = { ...w.states, "binary_sensor.back_door": st("off", {}), };
  advance(1000);
  w.states = { ...w.states, "binary_sensor.back_door": st("on", {}), "alarm_control_panel.house": st("triggered", { friendly_name: "House alarm" }) };
  advance(1000);
  check("fly:alarm goes first", log.fly.at(-1) === "alarm_control_panel.house", log.fly);
  dir.dispose();
  check("fly:disposed: no timer", timers.length === 0 && !root.querySelector("[data-la3d-director]"), timers.length);
}

// ── touch: someone is using the screen ───────────────────────────────────────
{
  const { dir, w, log } = rig({ touched: T - 5000 });
  dir.attach();
  w.states = { ...w.states, "binary_sensor.back_door": st("on", {}) };
  advance(1000);
  check("touch:recent touch: card only", log.fly.length === 0 && dir.showing(), { log, s: dir.state() });
  advance(D.HOLD_MS + 100);
  check("touch:no flight, no return", log.home === 0 && !dir.showing(), log);
  dir.dispose();
}
for (const [what, over] of [["busy", { busy: "edit" }], ["following", { following: true }]]) {
  const { dir, w, log } = rig(over);
  dir.attach();
  w.states = { ...w.states, "binary_sensor.back_door": st("on", {}) };
  advance(1000);
  check(`touch:${what}: card only`, log.fly.length === 0 && dir.showing(), log);
  dir.dispose();
}
{
  const { dir, w, log } = rig();
  dir.attach();
  w.states = { ...w.states, "binary_sensor.back_door": st("on", {}) };
  advance(1000);
  w.touched = T;                                       // a touch while the card is up
  advance(D.HOLD_MS + 100);
  check("touch:touched during: stays", log.fly.length === 1 && log.home === 0, log);
  dir.dispose();
}
{
  const { dir, w, log } = rig({ placed: false });
  dir.attach();
  w.states = { ...w.states, "binary_sensor.back_door": st("on", {}) };
  advance(1000);
  advance(D.HOLD_MS + 100);
  check("touch:nowhere to fly: no return either", log.fly.length === 1 && log.home === 0 && dir.state().fired === 1, log);
  dir.dispose();
}

// ── off ──────────────────────────────────────────────────────────────────────
{
  timers = [];
  const { dir, w, log } = rig({ settings: { atlas_3d_director: [] } });
  dir.attach();
  check("off:no triggers: no timer", timers.length === 0 && !dir.state().looking, timers.length);
  dir.dispose();
  const b = rig({ sidebar: false });
  b.dir.attach();
  b.w.states = { ...b.w.states, "binary_sensor.back_door": st("on", {}) };
  b.dir.check();
  check("off:not the sidebar: nothing", timers.length === 0 && b.log.fly.length === 0 && !b.dir.showing(), timers.length);
  b.dir.dispose();
  const c = rig();
  c.dir.attach();
  c.dir.detach();
  check("off:detached: no timer", timers.length === 0, timers.length);
  c.dir.dispose();
  void w; void log;
}

// ── people: someone picked goes into a room ──────────────────────────────────
{
  const W = D.watchedOf([{ key: "person.ann", rooms: ["Kitchen", 3, ""] }, { key: "person.ann" }, { key: "beacon:aa" }, { key: "light.x" }, null]);
  check("people:picks cleaned", JSON.stringify(W) === JSON.stringify([{ key: "person.ann", rooms: ["Kitchen"] }, { key: "beacon:aa", rooms: [] }]), W);
  const any = { key: "person.ann", rooms: [] }, kit = { key: "person.ann", rooms: ["Kitchen"] };
  check("people:arrivals", D.arrivedOf(any, undefined, "Hall", undefined, null) === null
    && D.arrivedOf(any, "Hall", "Kitchen", null, null) === "Went into Kitchen"
    && D.arrivedOf(kit, "Hall", "Office", null, null) === null && D.arrivedOf(kit, "Hall", "Kitchen", null, null) === "Went into Kitchen"
    && D.arrivedOf(any, "Hall", "Hall", st("not_home"), st("home")) === "Arrived home"
    && D.arrivedOf(kit, "", "", st("not_home"), st("home")) === null
    && D.arrivedOf(any, "", "", st("unavailable"), st("home")) === null && D.arrivedOf(any, "", "", undefined, st("home")) === null, null);
}
const ann = (room) => [{ key: "person.ann", name: "Ann", room }, { key: "beacon:keys", name: "Keys", room: "Hall" }];
const peopleSet = (people) => ({ atlas_3d_director: [{ entity: "binary_sensor.back_door", camera: "" }], atlas_3d_director_people: people });
{
  timers = [];
  const { dir, w, log } = rig({ settings: { atlas_3d_director: [], atlas_3d_director_people: [{ key: "person.ann", rooms: [] }] }, rooms: ann("Hall") });
  dir.attach();
  check("people:only people picked: it looks", dir.state().looking && dir.state().watched.join() === "person.ann", dir.state());
  check("people:first look flies nowhere", log.fly.length === 0 && !dir.showing(), log);
  w.rooms = ann("Kitchen");
  advance(1000);
  const s = dir.state();
  check("people:went into a room: flies to them", log.fly.join() === "person.ann" && s.flights === 1, { log, s });
  check("people:card says who and where", dir.showing() && s.card.text.includes("Ann") && s.card.text.includes("Went into Kitchen") && s.card.img === null, s.card);
  advance(D.HOLD_MS + 100);
  check("people:then home", log.home === 1 && !dir.showing(), log);
  // Pacing: back to the hall and again into the kitchen inside the cooldown.
  w.rooms = ann("Hall"); advance(1000);
  w.rooms = ann("Kitchen"); advance(1000);
  check("people:pacing inside the cooldown: nothing", log.fly.length === 1 && !dir.showing(), log);
  // Out of sight a while, back in the same room: not news either.
  w.rooms = []; advance(D.COOLDOWN_MS);
  w.rooms = ann("Kitchen"); advance(1000);
  check("people:back in sight in the same room: nothing", log.fly.length === 1, log);
  w.rooms = ann("Office"); advance(1000);
  check("people:after the cooldown: again", log.fly.length === 2 && dir.state().card.text.includes("Went into Office"), log);
  dir.dispose();
}
{
  const { dir, w, log } = rig({ settings: peopleSet([{ key: "person.ann", rooms: [] }]), rooms: ann("Hall") });
  w.states = { ...w.states, "person.ann": st("not_home", { friendly_name: "Ann" }) };
  dir.attach();
  w.states = { ...w.states, "person.ann": st("home", { friendly_name: "Ann" }) };
  advance(1000);
  check("people:arrived home", log.fly.join() === "person.ann" && dir.state().card.text.includes("Arrived home"), { log, s: dir.state() });
  dir.dispose();
}
{
  const { dir, w, log } = rig({ settings: peopleSet([{ key: "person.ann", rooms: ["Office"] }, { key: "beacon:keys", rooms: ["Garage"] }]), rooms: ann("Hall") });
  w.states = { ...w.states, "person.ann": st("not_home") };
  dir.attach();
  w.states = { ...w.states, "person.ann": st("home") };
  w.rooms = ann("Kitchen"); advance(1000);
  check("people:a room not picked, or home with rooms picked: nothing", log.fly.length === 0 && !dir.showing(), log);
  w.rooms = [{ key: "beacon:keys", name: "Keys", room: "Garage" }]; advance(1000);
  check("people:a tag into its room", log.fly.join() === "beacon:keys" && dir.state().card.text.includes("Keys"), log);
  dir.dispose();
}
for (const [what, over] of [["touched", { touched: T - 5000 }], ["busy", { busy: "edit" }], ["following", { following: true }]]) {
  const { dir, w, log } = rig({ settings: peopleSet([{ key: "person.ann", rooms: [] }]), rooms: ann("Hall"), ...over });
  if (what === "touched") w.touched = T - 5000;
  dir.attach();
  w.rooms = ann("Kitchen"); advance(1000);
  check(`people:${what}: card only`, log.fly.length === 0 && dir.showing(), { log, s: dir.state() });
  advance(D.HOLD_MS + 100);
  check(`people:${what}: no return`, log.home === 0, log);
  dir.dispose();
}
{
  const { dir, w, log } = rig({ settings: peopleSet([{ key: "person.ann", rooms: [] }]), rooms: ann("Hall") });
  dir.attach();
  w.states = { ...w.states, "binary_sensor.back_door": st("on", { device_class: "door", friendly_name: "Back door" }) };
  advance(1000);
  w.rooms = ann("Kitchen"); advance(1000);
  check("people:never over another card", log.fly.join() === "binary_sensor.back_door" && dir.state().card.text.includes("Back door"), log);
  dir.dispose();
}
{
  // Nobody picked (the default): the director as it always was.
  timers = [];
  const { dir, w, log } = rig({ rooms: ann("Hall") });
  dir.attach();
  w.rooms = ann("Kitchen"); advance(1000);
  check("people:nobody picked: nothing new", log.fly.length === 0 && !dir.showing() && dir.state().watched.length === 0, log);
  dir.dispose();
  const b = rig({ settings: { atlas_3d_director: [], atlas_3d_director_people: [] } });
  b.dir.attach();
  check("people:nothing picked at all: no timer", timers.length === 0 && !b.dir.state().looking, timers.length);
  b.dir.dispose();
}

console.log(JSON.stringify({ cases, failures }));
