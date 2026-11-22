// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
//
// RUN a power team on the map (views/power_team_card.js, and its wiring in lights_map.js), against a fake hass that
// records every service call and websocket message: the Control4 dimmer placed on the map stands for its team — a tap
// switches the team (the bulbs, when the team leaves the power on), a drag dims the team, a hold opens the team's card;
// the card says what the team is doing in every case, cuts or puts on the power, names a bulb that did not answer and
// sends it again, saves the wake-up and the day's curve whole, and follows Home Assistant live while it is open.
//
// usage: power_team_card.mjs <views dir>
// prints one JSON line: { cases: {name: result}, failures: [...] }

import { pathToFileURL } from "node:url";
import { join } from "node:path";
import { install, flush } from "./dom_shim.mjs";

const VIEWS = process.argv[2];
if (!VIEWS) { console.error("usage: power_team_card.mjs <views dir>"); process.exit(2); }
install(globalThis);
globalThis.performance = globalThis.performance || { now: () => Date.now() };

const failures = [], cases = {};
const check = (name, ok, detail) => { cases[name] = !!ok; if (!ok) failures.push({ name, detail: detail === undefined ? null : detail }); };
const settle = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };
const wait = async () => { await settle(); await flush(3, 1000); await settle(); };

function el(tag, attrs = {}, children = []) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (k === "style") n.setAttribute("style", v);
    else if (k === "value") n.value = v;
    else if (typeof v === "function") n.addEventListener(k.replace(/^on/, ""), v);
    else if (v !== undefined && v !== null) n.setAttribute(k, String(v));
  }
  for (const c of (Array.isArray(children) ? children : [children])) {
    if (c === null || c === undefined) continue;
    n.appendChild(typeof c === "string" || typeof c === "number" ? document.createTextNode(String(c)) : c);
  }
  return n;
}
const find = (root, attr, val) => root._all().filter(n => n.getAttribute && (val === undefined ? n.getAttribute(attr) !== null : n.getAttribute(attr) === val));
const fire = (n, type) => n.dispatchEvent({ type, target: n });

const TEAM = "light.master_pots", DIM = "light.control4_mainpotlights", B = ["light.pot_1", "light.pot_2", "light.pot_3"];
function house(over = {}) {
  const s = {
    [TEAM]: { state: "on", attributes: { friendly_name: "Master Pots", padspan_power_team: true, team_id: "9466dc82", power: DIM, bulbs: B,
      phase: "ready", missing: [], follows_the_day: true, effect: "Adaptive", effect_list: ["Adaptive", "Sleep"], turns_off: "bulbs",
      waking: false, fading: false, brightness: 255, color_temp_kelvin: 4755, rgb_color: [255, 220, 190], supported_color_modes: ["color_temp", "hs"] } },
    [DIM]: { state: "on", attributes: { friendly_name: "Master Bedroom Pots", brightness: 255, supported_color_modes: ["brightness"] } },
    "light.kitchen": { state: "on", attributes: { friendly_name: "Kitchen", brightness: 90, supported_color_modes: ["brightness"] } },
  };
  for (const b of B) s[b] = { state: "on", attributes: { friendly_name: b.replace("light.pot_", "Master Pot "), brightness: 255, color_temp_kelvin: 4761 } };
  for (const [eid, v] of Object.entries(over)) s[eid] = v === null ? undefined : { ...s[eid], ...v, attributes: { ...(s[eid] || {}).attributes, ...(v.attributes || {}) } };
  return s;
}
const STORED = [
  { id: "10bb248f", name: "Christmas strings", power: "", bulbs: ["light.s1"], off: "bulbs", adaptive: true, curve: {}, wake: {} },
  { id: "9466dc82", name: "Master Pots", power: DIM, bulbs: B, off: "bulbs", adaptive: true,
    curve: { min_brightness: 25, max_brightness: 100, min_kelvin: 2200, max_kelvin: 5000, sleep_brightness: 5, sleep_kelvin: 2000,
             sunrise_offset: 0, sunset_offset: 0, sunrise_time: "", sunset_time: "" },
    wake: { on: false, time: "06:30", days: [0, 1, 2, 3, 4], minutes: 30, brightness: 100, kelvin: 4000 } },
];
function fakeHass(states, { admin = true } = {}) {
  const ws = [], svc = [], subs = [];
  let stored = JSON.parse(JSON.stringify(STORED));
  const h = {
    ws, svc, subs, states, user: { is_admin: admin },
    callWS: async (m) => {
      ws.push(JSON.parse(JSON.stringify(m)));
      const live = { "9466dc82": { next_wake: ["2026-11-23", "06:30"] } };
      if (m.type === "padspan_ha/power_teams_get") return { teams: JSON.parse(JSON.stringify(stored)), wake_default: STORED[1].wake, wake_minutes: [1, 90],
        bedtime_default: { on: false, time: "22:30", days: [0, 1, 2, 3, 4, 5, 6], minutes: 30, end: "off" }, bedtime_minutes: [1, 120],
        night_default: { on: false, from: "23:00", to: "06:00" }, live,
        limits: { sunrise_offset: [-180, 180], sunset_offset: [-180, 180] } };
      if (m.type === "padspan_ha/power_teams_set") { stored = JSON.parse(JSON.stringify(m.teams)); return { teams: stored, live }; }
      if (m.type === "padspan_ha/power_team_sleep") return { ran: true };
      return { counted: false };
    },
    callService: async (domain, service, data) => { svc.push([domain, service, JSON.parse(JSON.stringify(data))]); },
    connection: {
      subscribeEvents: async (cb, type) => { const sub = { cb, type, live: true }; subs.push(sub); return () => { sub.live = false; }; },
    },
    push(eid, state, attributes) {           // Home Assistant reports a change
      const new_state = { state, attributes: { ...((states[eid] || {}).attributes || {}), ...(attributes || {}) } };
      for (const s of subs) if (s.live) s.cb({ data: { entity_id: eid, new_state } });
    },
  };
  return h;
}
const tracked = (h) => h.ws.filter(m => m.type === "padspan_ha/telemetry_event").map(m => m.event);

try {
  const T = await import(pathToFileURL(join(VIEWS, "power_team_card.js")).href);
  const LM = await import(pathToFileURL(join(VIEWS, "lights_map.js")).href);

  // ── who belongs to which team ──
  {
    const s = house();
    check("members: the dimmer, each bulb and the team's own light all stand for the team; anything else for nothing",
      T.teamOf(s, DIM) === TEAM && B.every(b => T.teamOf(s, b) === TEAM) && T.teamOf(s, TEAM) === TEAM && T.teamOf(s, "light.kitchen") === null
      && JSON.stringify(T.teamMembers(s, TEAM)) === JSON.stringify([TEAM, DIM, ...B]));
    const look = T.teamLook(house({ [TEAM]: { state: "off" } }), DIM);
    check("look: the dimmer is drawn as its team (dark when the team is off with the power on); a team out of reach leaves it as itself",
      look && look.state === "off" && look.team === TEAM && T.teamLook(house({ [TEAM]: { state: "unavailable" } }), DIM) === null && T.teamLook(s, TEAM) === null, look);
  }

  // ── what the card says, case by case ──
  {
    const say = (over) => T.teamStatus(house(over), TEAM);
    const cases2 = {
      following: say({}),
      sleep: say({ [TEAM]: { attributes: { follows_the_day: false, effect: "Sleep" } } }),
      hand: say({ [TEAM]: { attributes: { follows_the_day: false, effect: null } } }),
      offPowered: say({ [TEAM]: { state: "off" } }),
      offCut: say({ [TEAM]: { state: "off" }, [DIM]: { state: "off" } }),
      starting: say({ [TEAM]: { attributes: { phase: "starting" } }, "light.pot_3": { state: "off" } }),
      failed: say({ [TEAM]: { attributes: { phase: "failed", missing: ["light.pot_2", "light.pot_3"] } } }),
      fading: say({ [TEAM]: { attributes: { follows_the_day: false, effect: null, waking: true, fading: true } } }),
      gone: say({ [TEAM]: { state: "unavailable" } }),
      briHand: say({ [TEAM]: { attributes: { brightness_follows: false, brightness: 102 } } }),
      colourHand: say({ [TEAM]: { attributes: { follows_the_day: false, effect: null, brightness_follows: true } } }),
      goingOff: say({ [TEAM]: { attributes: { going_off: true, fading: true, effect: "Sleep", follows_the_day: false } } }),
      sleepFade: say({ [TEAM]: { attributes: { fading: true, effect: "Sleep", follows_the_day: false } } }),
    };
    check("status (2026-11-22): brightness set by hand with the colour on the day, the colour by hand, going to sleep",
      cases2.briHand[0] === "On · colour follows the day, brightness set by hand (40%)"
      && cases2.colourHand[0] === "On · colour set by hand, brightness follows the day"
      && cases2.goingOff[0] === "Going to sleep: fading, then off" && cases2.sleepFade[0] === "Going to sleep: fading", cases2);
    check("status: following the day, sleep, set by hand, off (power on or cut), starting, bulbs not answering, waking, out of reach",
      cases2.following[0] === "On · following the day: 100%, 4755 K" && cases2.sleep[0].includes("sleep") && cases2.hand[0] === "On · set by hand"
      && cases2.offPowered[0].includes("the power is on, so it comes on at once") && cases2.offCut[0] === "Off · the power is off"
      && cases2.starting[0] === "Starting its bulbs… 2 of 3 on" && cases2.starting[1] === "busy"
      && cases2.failed[0] === "On, but 2 bulbs have not answered" && cases2.failed[1] === "warn"
      && cases2.fading[0] === "Waking up: fading in" && cases2.gone[1] === "warn", cases2);
    const p = (over) => T.powerState(house(over), DIM);
    const pw = { full: p({}), low: p({ [DIM]: { attributes: { brightness: 100 } } }), off: p({ [DIM]: { state: "off" } }), gone: p({ [DIM]: { state: "unavailable" } }) };
    check("power: on full (can be cut), left low at the wall (put back to full), off (can be put on), out of reach (nothing to press)",
      pw.full.text === "on, full" && pw.full.canCut && !pw.full.canOn && pw.low.text.startsWith("on at 39%") && pw.off.canOn && !pw.off.canCut
      && !pw.gone.canCut && !pw.gone.canOn && pw.gone.text === "out of reach", pw);
    const bs = (over, missing) => T.bulbState(house(over), "light.pot_1", missing)[0];
    check("bulbs: their light, off, out of reach, not answering",
      bs({}) === "100%, 4761 K" && bs({ "light.pot_1": { state: "off" } }) === "off" && bs({ "light.pot_1": { state: "unavailable" } }) === "out of reach"
      && bs({}, ["light.pot_1"]) === "not answering");
    check("bulbs with the power cut: no power, whatever a cut bulb last said (Zigbee2MQTT keeps its last state)",
      T.bulbState(house(), "light.pot_1", [], true)[0] === "no power");
  }

  // ── the marker (before any tap: a tap leaves a claim the marker shows until Home Assistant agrees) ──
  {
    const lights = LM.gatherLights(house({ [TEAM]: { state: "off" } }), {}, {}, "pro", {}, {}, {}, {}, Date.now());
    const dim = lights.find(l => l.entity_id === DIM), team = lights.find(l => l.entity_id === TEAM);
    const LC = await import(pathToFileURL(join(VIEWS, "light_codes.js")).href);
    check("marker: the dimmer is drawn as the team (dark: the bulbs are off though the power is on); the team's own light is a light, not a strip",
      dim && dim.state === "off" && dim.team === TEAM && team && team.power_team === true && !LC.isWledLight(team)
      && LC.isWledLight({ effect_list: ["Rainbow"] }), { dim, team });
  }

  // ── the map: tap, drag and hold on the Control4 dimmer are the team's ──
  {
    const h = fakeHass(house());
    await LM.toggleEntity(h, DIM, {});
    const tap = h.svc.slice();
    h.svc.length = 0;
    await LM.setLightBrightness(h, DIM, 120);
    const drag = h.svc.slice();
    h.svc.length = 0;
    await LM.toggleEntity(h, "light.kitchen", {});
    check("tap: the dimmer switches the TEAM off (its bulbs: the power is left on) and never the dimmer; any other light as ever",
      JSON.stringify(tap) === JSON.stringify([["light", "turn_off", { entity_id: TEAM }]]) && tracked(h).includes("team_tap")
      && h.svc.length === 1 && h.svc[0][2].entity_id === "light.kitchen", { tap, kitchen: h.svc });
    check("drag: dimming the dimmer dims the team (the bulbs), never the dimmer",
      JSON.stringify(drag) === JSON.stringify([["light", "turn_on", { entity_id: TEAM, brightness: 120 }]]), drag);
    const h3 = fakeHass(house({ [TEAM]: { state: "off" } }));
    await LM.setManyStates(h3, [DIM, B[0], "light.kitchen"], true, {});
    check("a room's All lights on: the team once (its light), the other lights as ever — never the dimmer, already on",
      JSON.stringify(h3.svc) === JSON.stringify([["light", "turn_on", { entity_id: [TEAM, "light.kitchen"] }]]), h3.svc);
    for (const e of [TEAM, DIM, ...B, "light.kitchen"]) LM.clearOptimistic(e);   // Home Assistant agreed: the claims are done
    const h2 = fakeHass(house({ [TEAM]: { state: "off" } }));
    await LM.toggleEntity(h2, B[0], {});
    check("tap on a bulb: the team comes on, in the day's light (no remembered brightness)",
      JSON.stringify(h2.svc) === JSON.stringify([["light", "turn_on", { entity_id: TEAM }]]), h2.svc);
  }
  // ── the card, opened by holding the dimmer ──
  {
    const h = fakeHass(house());
    document.body.children.length = 0;
    LM.openControlCard(h, DIM, { toast: () => {}, rerender: () => {} });
    await settle();
    const card = document.body._all().find(n => n.getAttribute && n.getAttribute("data-team-card") === TEAM);
    const text = card ? card.textContent : "";
    check("hold: the team's card opens (its name, its status, the day, the power, each bulb), with no strip effect list",
      !!card && document.body.textContent.includes("Master Pots") && text.includes("On · following the day")
      && find(card, "data-team-effect").length === 2 && find(card, "data-team-effect", "Adaptive")[0].getAttribute("aria-pressed") === "true"
      && text.includes("Master Bedroom Pots") && find(card, "data-team-power", "cut").length === 1 && find(card, "data-team-bulb").length === 3
      && !document.body._all().some(n => n.tagName === "SELECT" && n._all().some(o => o.textContent === "Adaptive"))
      && tracked(h).includes("team_card:opened"), text.slice(0, 600));

    find(card, "data-team-power", "cut")[0].click(); await settle();
    check("Cut power: the dimmer itself is turned off (the only way the card touches it)",
      h.svc.some(c => c[0] === "light" && c[1] === "turn_off" && c[2].entity_id === DIM) && tracked(h).includes("team_card:power_cut"), h.svc);

    find(card, "data-team-effect", "Sleep")[0].click(); await settle();
    check("Sleep: the team's effect", h.svc.some(c => c[1] === "turn_on" && c[2].entity_id === TEAM && c[2].effect === "Sleep"), h.svc);

    // Live: Home Assistant reports the power cut, then a bulb that does not answer after a restart of the power.
    h.push(DIM, "off", {}); h.push(TEAM, "off", {});
    await wait(200);
    const afterCut = card.textContent;
    h.push(DIM, "on", { brightness: 255 });
    h.push(TEAM, "on", { phase: "failed", missing: ["light.pot_2"] });
    await wait(200);
    const afterFail = card.textContent;
    check("live: the card follows Home Assistant while open — power off offers Power on; a bulb that did not answer is named, with Try again",
      afterCut.includes("Off · the power is off") && afterCut.includes("Power on")
      && afterFail.includes("On, but 1 bulb has not answered") && afterFail.includes("not answering") && find(card, "data-team-retry").length === 1,
      { afterCut: afterCut.slice(0, 300), afterFail: afterFail.slice(0, 400) });
    h.svc.length = 0;
    find(card, "data-team-retry")[0].click(); await settle();
    check("Try again: the team's light once more (its bulbs sent what is wanted again)",
      JSON.stringify(h.svc) === JSON.stringify([["light", "turn_on", { entity_id: TEAM }]]), h.svc);

    // The wake-up, saved whole: the other team is kept as it was.
    const wakeFold = find(card, "data-team-fold", "wake")[0];
    const on = find(wakeFold, "data-wake", "on")[0]; on.checked = true;
    const time = find(wakeFold, "data-wake", "time")[0]; time.value = "06:45";
    find(wakeFold, "data-wake-day", "5")[0].click();          // Saturday too
    find(wakeFold, "data-wake-save")[0].click(); await settle(); await settle();
    const set = h.ws.filter(m => m.type === "padspan_ha/power_teams_set").pop();
    const mine = set && set.teams.find(t => t.id === "9466dc82");
    check("wake-up: saved with the team (on, its time, its days), every other team sent back untouched",
      mine && mine.wake.on === true && mine.wake.time === "06:45" && JSON.stringify(mine.wake.days) === JSON.stringify([0, 1, 2, 3, 4, 5])
      && mine.wake.minutes === 30 && set.teams.length === 2 && set.teams[0].name === "Christmas strings" && tracked(h).includes("team_card:wake_saved"), set);

    const adv = find(card, "data-team-fold", "advanced")[0];
    find(adv, "data-curve", "sunrise_time")[0].value = "06:30";
    find(adv, "data-curve", "max_kelvin")[0].value = "4500";
    find(adv, "data-curve", "sunset_offset")[0].value = "-30";
    find(adv, "data-team-off")[0].value = "power";
    find(adv, "data-curve-save")[0].click(); await settle(); await settle();
    const set2 = h.ws.filter(m => m.type === "padspan_ha/power_teams_set").pop();
    const m2 = set2 && set2.teams.find(t => t.id === "9466dc82");
    check("advanced: the day's curve (a fixed sunrise, a moved sunset, its colours) and what a tap's off does, saved with the team, the wake-up kept",
      m2 && m2.curve.sunrise_time === "06:30" && m2.curve.max_kelvin === 4500 && m2.curve.sunset_offset === -30 && m2.curve.sunset_time === ""
      && m2.off === "power" && m2.wake.time === "06:45" && tracked(h).includes("team_card:off_mode_saved"), m2);

    // Out of reach: Home Assistant drops the team light's attributes; the card keeps its power row and bulbs.
    h.push(TEAM, "unavailable", null);
    h.subs.forEach(s2 => s2.live && s2.cb({ data: { entity_id: TEAM, new_state: { state: "unavailable", attributes: { friendly_name: "Master Pots" } } } }));
    await wait(200);
    check("out of reach: the card says so and still shows the power and each bulb",
      card.textContent.includes("out of Home Assistant's reach") && find(card, "data-team-bulb").length === 3 && card.textContent.includes("Master Bedroom Pots"),
      card.textContent.slice(0, 400));
    // Sleep in 30 min: the team fades to Sleep and goes off (its bedtime's end).
    h.push(TEAM, "on", { phase: "ready", missing: [], follows_the_day: true, effect: "Adaptive" });
    await wait(200);
    find(card, "data-team-sleep-now")[0].click(); await settle();
    const sl = h.ws.filter(m => m.type === "padspan_ha/power_team_sleep").pop();
    check("Sleep in 30 min: the team's own command, 30 minutes, then off",
      sl && sl.entity_id === TEAM && sl.minutes === 30 && sl.end === "off" && tracked(h).includes("team_card:sleep_now"), sl);

    // Skip the next morning: saved with the team; a later save of the wake-up keeps it.
    const wf = () => find(card, "data-team-fold", "wake")[0];
    find(wf(), "data-wake-skip", "skip")[0].click(); await settle(); await settle();
    const sk = h.ws.filter(m => m.type === "padspan_ha/power_teams_set").pop().teams.find(t => t.id === "9466dc82");
    const wkEnd = find(wf(), "data-wake", "weekend_time")[0];
    wkEnd.value = "08:00";
    find(wf(), "data-wake", "back_after")[0].value = "45";
    find(wf(), "data-wake-save")[0].click(); await settle(); await settle();
    const ws2 = h.ws.filter(m => m.type === "padspan_ha/power_teams_set").pop().teams.find(t => t.id === "9466dc82");
    check("wake-up: skip Monday, a weekend time and back-to-the-day minutes, a skip kept by a later save",
      sk && sk.wake.skip === "2026-11-23" && ws2.wake.skip === "2026-11-23" && ws2.wake.weekend_time === "08:00" && ws2.wake.back_after === 45
      && tracked(h).includes("team_card:wake_skip") && find(wf(), "data-wake-skip", "undo").length === 1 && wf().textContent.includes("(skipped)"),
      { sk: sk && sk.wake, ws2: ws2 && ws2.wake });

    const bf = find(card, "data-team-fold", "bedtime")[0];
    find(bf, "data-bed", "on")[0].checked = true;
    find(bf, "data-bed", "time")[0].value = "22:45";
    find(bf, "data-bed", "end")[0].value = "sleep";
    find(bf, "data-bed-save")[0].click(); await settle(); await settle();
    const bs = h.ws.filter(m => m.type === "padspan_ha/power_teams_set").pop().teams.find(t => t.id === "9466dc82");
    const nf = find(card, "data-team-fold", "night")[0];
    find(nf, "data-night", "on")[0].checked = true;
    find(nf, "data-night", "from")[0].value = "22:00";
    find(nf, "data-night-save")[0].click(); await settle(); await settle();
    const ns = h.ws.filter(m => m.type === "padspan_ha/power_teams_set").pop().teams.find(t => t.id === "9466dc82");
    check("bedtime and night light: saved with the team, each keeping the other",
      bs && bs.bedtime.on === true && bs.bedtime.time === "22:45" && bs.bedtime.end === "sleep" && bs.bedtime.days.length === 7
      && ns.night.on === true && ns.night.from === "22:00" && ns.night.to === "06:00" && ns.bedtime.time === "22:45"
      && tracked(h).includes("team_card:bedtime_saved") && tracked(h).includes("team_card:night_saved"), { bs: bs && bs.bedtime, ns: ns && ns.night });

    const af = find(card, "data-team-fold", "advanced")[0];
    find(af, "data-curve", "min_sunrise_time")[0].value = "06:30";
    find(af, "data-team-resume")[0].value = "120";
    find(af, "data-curve-save")[0].click(); await settle(); await settle();
    const as = h.ws.filter(m => m.type === "padspan_ha/power_teams_set").pop().teams.find(t => t.id === "9466dc82");
    check("advanced: an earliest sunrise and the hand-back time saved; the wake-up, bedtime and night light kept",
      as && as.curve.min_sunrise_time === "06:30" && as.curve.max_sunset_time === "" && as.resume === 120
      && as.wake.skip === "2026-11-23" && as.bedtime.time === "22:45" && as.night.from === "22:00", as);

    // A save draws again only its own section: a bedtime typed and not yet saved survives a skip pressed meanwhile.
    const bt = find(find(card, "data-team-fold", "bedtime")[0], "data-bed", "time")[0];
    bt.value = "23:15";
    find(find(card, "data-team-fold", "wake")[0], "data-wake-skip")[0].click(); await settle(); await settle();
    const bt2 = find(find(card, "data-team-fold", "bedtime")[0], "data-bed", "time")[0];
    check("a save draws only its own section: an unsaved bedtime survives a skip",
      bt2 === bt && bt2.value === "23:15" && find(find(card, "data-team-fold", "wake")[0], "data-wake-skip", "skip").length === 1, bt2 && bt2.value);

    const live = h.subs.filter(s => s.live).length;
    document.body._all().find(n => n.tagName === "BUTTON" && n.textContent === "✕").click();
    check("closed: it stops following Home Assistant", live === 1 && h.subs.every(s => !s.live), h.subs.length);
  }

  // ── the pencil edits what was held on the map (the dimmer), not the team's light ──
  {
    const h = fakeHass(house());
    document.body.children.length = 0;
    let edited = null;
    LM.openControlCard(h, DIM, { toast: () => {}, rerender: () => {}, onEdit: (e) => { edited = e; } });
    await settle();
    document.body._all().find(n => n.tagName === "BUTTON" && n.textContent === "✎").click();
    check("pencil: Mapping opens on the dimmer that is placed", edited === DIM, edited);
  }

  // ── not an administrator: switched, never changed ──
  {
    const h = fakeHass(house(), { admin: false });
    document.body.children.length = 0;
    LM.openControlCard(h, TEAM, { toast: () => {}, rerender: () => {} });
    await settle();
    const card = document.body._all().find(n => n.getAttribute && n.getAttribute("data-team-card") === TEAM);
    check("not an administrator: the wake-up and the curve are shown with no Save; the light is still switched",
      !!card && !find(card, "data-wake-save").length && !find(card, "data-curve-save").length
      && card.textContent.includes("An administrator changes the wake-up, the bedtime, the night light and the curve.") && find(card, "data-team-power").length === 1,
      card && card.textContent.slice(-300));
  }
} catch (e) {
  failures.push({ name: "harness", detail: String((e && e.stack) || e) });
}
process.stdout.write(JSON.stringify({ cases, failures }) + "\n", () => process.exit(failures.length ? 1 : 0));
