// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
//
// The Atlas's hold card and room sheet (views/lights_map.js), run under the
// DOM shim:
//   * Unlock asks "Unlock {name}?" first — from a tap's toggle (the room
//     sheet's lock row, the index), the hold card and the barrier card —
//     and sends nothing on Cancel; Lock never asks.
//   * A white bulb that goes warm to cool gets a colour temperature slider
//     over its own range, and Warm and Cool chips when it has no colour; an
//     unavailable light says "Unavailable" with every control greyed out;
//     Details opens Home Assistant's own dialog.
//   * Details is not offered on a wall (?kiosk=1): nothing there leaves
//     the page.
//   * The room sheet says who PadSpan places in the room — only while that
//     screen shows people (Show people, and its ⋯ People line) — offers All on /
//     All off only when they would change something (never to an
//     unavailable light), greys out unavailable rows, follows newer states
//     while open, and a button whose call failed shows its old word again.
//
// Run:  node tests/js/atlas_controls.mjs <www/padspan-ha dir>

import { pathToFileURL } from "node:url";
import { join } from "node:path";
import { install } from "./dom_shim.mjs";

const WWW = process.argv[2];
if (!WWW) { console.error("usage: atlas_controls.mjs <www/padspan-ha dir>"); process.exit(2); }
install(globalThis);
const LM = await import(pathToFileURL(join(WWW, "views", "lights_map.js")).href);

const cases = {}, failures = [];
const check = (name, ok, detail) => { cases[name] = !!ok; if (!ok) failures.push({ name, detail: detail ?? null }); };
const flush = () => new Promise(r => globalThis._realSetTimeout(r, 5));
const nodes = (n) => n._all();
const buttons = (n) => nodes(n).filter(x => x.tagName === "BUTTON");
const btn = (n, text) => buttons(n).find(b => b.textContent === text) || null;
const inputs = (n) => nodes(n).filter(x => x.tagName === "INPUT" || x.tagName === "SELECT");
const top = () => document.body.children[document.body.children.length - 1];
const onPage = (n) => document.body.children.includes(n);
const click = (b) => b && b.dispatchEvent({ type: "click", target: b, stopPropagation() {}, preventDefault() {} });

// Home Assistant's own element, where hass-more-info is heard.
const ha = document.createElement("home-assistant");
document.body.appendChild(ha);
const moreInfo = [];
ha.addEventListener("hass-more-info", (e) => moreInfo.push(e.detail && e.detail.entityId));

const calls = [];
const st = (state, attributes) => ({ state, attributes });
const hass = {
  states: {
    "lock.front": st("locked", { friendly_name: "Front Door" }),
    "lock.back": st("unlocked", { friendly_name: "Back Door" }),
    "lock.side": st("locked", { friendly_name: "Side Gate" }),
    "lock.garage": st("locked", { friendly_name: "Garage Lock" }),
    "light.ambiance": st("on", { friendly_name: "Hall Ambiance", supported_color_modes: ["color_temp"], color_mode: "color_temp",
      brightness: 128, color_temp_kelvin: 3000, min_color_temp_kelvin: 2200, max_color_temp_kelvin: 6500, rgb_color: [255, 180, 107] }),
    "light.narrow": st("off", { friendly_name: "Desk", supported_color_modes: ["color_temp"], min_color_temp_kelvin: 2700, max_color_temp_kelvin: 5000 }),
    "light.colour": st("on", { friendly_name: "Lounge Colour", supported_color_modes: ["color_temp", "hs"], color_mode: "hs",
      brightness: 200, min_color_temp_kelvin: 2000, max_color_temp_kelvin: 6535, rgb_color: [255, 0, 0] }),
    "light.dimmer": st("on", { friendly_name: "Plain Dimmer", supported_color_modes: ["brightness"], brightness: 90 }),
    "light.gone": st("unavailable", { friendly_name: "Gone Bulb", supported_color_modes: ["color_temp", "hs"] }),
    "fan.gone": st("unavailable", { friendly_name: "Gone Fan", percentage: 50, preset_modes: ["auto"], oscillating: false }),
  },
  callService: async (d, s, data) => { calls.push([d, s, data.entity_id, data.color_temp_kelvin]); },
};
const sent = (from) => calls.slice(from).map(c => c.slice(0, 3).join(" "));

// ── Item 2: unlock asks first ───────────────────────────────────────────────
{
  const n0 = calls.length;
  const p = LM.toggleEntity(hass, "lock.front", {});
  await flush();
  const dlg = top();
  check("toggle: a locked lock asks 'Unlock {name}?' with Unlock and Cancel, and sends nothing yet",
    calls.length === n0 && dlg.textContent.includes("Unlock Front Door?") && !!btn(dlg, "Unlock") && !!btn(dlg, "Cancel"),
    { text: dlg.textContent, calls: sent(n0) });
  click(btn(dlg, "Cancel"));
  const r = await p;
  check("toggle: Cancel sends nothing, closes the question and resolves undefined",
    r === undefined && calls.length === n0 && !onPage(dlg), { r, calls: sent(n0) });

  const p2 = LM.toggleEntity(hass, "lock.front", {});
  await flush();
  click(btn(top(), "Unlock"));
  const r2 = await p2;
  check("toggle: Unlock unlocks", r2 === true && JSON.stringify(sent(n0)) === JSON.stringify(["lock unlock lock.front"]), sent(n0));

  const n1 = calls.length, before = document.body.children.length;
  const r3 = await LM.toggleEntity(hass, "lock.back", {});
  check("toggle: Lock never asks", r3 === true && document.body.children.length === before
    && JSON.stringify(sent(n1)) === JSON.stringify(["lock lock lock.back"]), sent(n1));
}
{
  // The hold card's Unlock.
  const n0 = calls.length;
  LM.openControlCard(hass, "lock.side", {});
  const card = top();
  click(btn(card, "Unlock"));
  await flush();
  const dlg = top();
  check("hold card: Unlock asks first", dlg !== card && dlg.textContent.includes("Unlock Side Gate?") && calls.length === n0, dlg.textContent);
  click(btn(dlg, "Cancel"));
  await flush();
  check("hold card: Cancel sends nothing and leaves the card open", calls.length === n0 && onPage(card) && !onPage(dlg));
  click(btn(card, "Unlock"));
  await flush();
  click(btn(top(), "Unlock"));
  await flush();
  check("hold card: Unlock unlocks and closes the card",
    JSON.stringify(sent(n0)) === JSON.stringify(["lock unlock lock.side"]) && !onPage(card), sent(n0));
}
{
  // A door's barrier card with a lock on it (the flat map and the 3D view).
  const n0 = calls.length;
  LM.openBarrierCard(hass, { linked_entity_id: "lock.garage", name: "Garage" }, { toast() {}, rerender() {} });
  const card = top();
  click(btn(card, "Unlock"));
  await flush();
  const dlg = top();
  check("barrier card: Unlock asks first", dlg !== card && dlg.textContent.includes("Unlock Garage Lock?") && calls.length === n0);
  click(btn(dlg, "Unlock"));
  await flush();
  check("barrier card: Unlock unlocks", JSON.stringify(sent(n0)) === JSON.stringify(["lock unlock lock.garage"]), sent(n0));
}

// ── Item 3: the hold card's light controls ─────────────────────────────────
const range = (n, min) => inputs(n).find(i => i.type === "range" && i.min === String(min)) || null;
{
  const n0 = calls.length;
  LM.openControlCard(hass, "light.ambiance", {});
  const card = top();
  const ct = range(card, 2200);
  check("white bulb: a colour temperature slider over the bulb's own range, at its kelvin now",
    !!ct && ct.max === "6500" && ct.value === "3000" && card.textContent.includes("Color temperature: 3000 K"),
    { text: card.textContent, ct: ct && [ct.min, ct.max, ct.value] });
  check("white bulb: Warm and Cool chips, and no colour picker although it reports an rgb_color",
    !!btn(card, "Warm") && !!btn(card, "Cool") && !inputs(card).some(i => i.type === "color"));
  click(btn(card, "Warm"));
  click(btn(card, "Cool"));
  if (ct) { ct.value = "4100"; ct.dispatchEvent({ type: "change" }); }
  await flush();
  check("white bulb: Warm, Cool and the slider set the white through Home Assistant",
    JSON.stringify(calls.slice(n0).map(c => [c[1], c[3]])) === JSON.stringify([["turn_on", 2700], ["turn_on", 6500], ["turn_on", 4100]]),
    calls.slice(n0));
  document.body.removeChild(card);

  const n1 = calls.length;
  LM.openControlCard(hass, "light.narrow", {});
  const narrow = top();
  click(btn(narrow, "Warm")); click(btn(narrow, "Cool"));
  await flush();
  check("white bulb: the chips keep to the bulb's range (2700–5000 K), and off says it turns the light on",
    JSON.stringify(calls.slice(n1).map(c => c[3])) === JSON.stringify([2700, 5000])
      && narrow.textContent.includes("turns the light on") && range(narrow, 2700)?.value === "5000",
    { k: calls.slice(n1), text: narrow.textContent });
  document.body.removeChild(narrow);

  LM.openControlCard(hass, "light.colour", {});
  const colour = top();
  check("colour bulb that does white: the slider beside its colour picker, no chips",
    !!range(colour, 2000) && inputs(colour).some(i => i.type === "color") && !btn(colour, "Warm") && !btn(colour, "Cool"));
  document.body.removeChild(colour);

  LM.openControlCard(hass, "light.dimmer", {});
  const dim = top();
  check("brightness-only bulb: no colour temperature", !dim.textContent.includes("Color temperature") && !btn(dim, "Warm"));
  document.body.removeChild(dim);
}
{
  // (A browser never fires click on a disabled button; the shim would, so the
  // greyed-out state is what is checked.)
  LM.openControlCard(hass, "light.gone", {});
  const card = top();
  const un = btn(card, "Unavailable");
  const ctl = inputs(card);
  check("unavailable light: 'Unavailable' where Turn On was, greyed out",
    !!un && un.disabled === true && !btn(card, "Turn On") && !btn(card, "Turn Off"), buttons(card).map(b => b.textContent));
  check("unavailable light: every control on it is greyed out",
    ctl.length >= 3 && ctl.every(i => i.disabled === true) && btn(card, "Warm") === null && btn(card, "Details")?.disabled === false,
    ctl.map(i => [i.type, i.disabled]));
  document.body.removeChild(card);

  LM.openControlCard(hass, "fan.gone", {});
  const fan = top();
  const fctl = [...inputs(fan), btn(fan, "Oscillate")];
  check("unavailable fan: 'Unavailable', its speed, preset and oscillate greyed out",
    btn(fan, "Unavailable")?.disabled === true && fctl.length === 3 && fctl.every(i => i && i.disabled === true), fctl.map(i => i && i.disabled));
  check("fan card: Details too", !!btn(fan, "Details"));
  document.body.removeChild(fan);
}
{
  LM.openControlCard(hass, "light.ambiance", {});
  const card = top();
  const d = btn(card, "Details");
  if (d) click(d);
  check("Details: opens Home Assistant's own dialog for the light and closes the card",
    !!d && JSON.stringify(moreInfo) === JSON.stringify(["light.ambiance"]) && !onPage(card), moreInfo);
  LM.openControlCard(hass, "lock.back", {});
  const lockCard = top();
  check("Details: on a lock's card too", !!btn(lockCard, "Details"));
  document.body.removeChild(lockCard);
  // A wall (?kiosk=1): nothing on it leaves the page, so no Details there.
  LM.openControlCard(hass, "light.ambiance", { kiosk: true });
  const wall = top();
  LM.openControlCard(hass, "fan.gone", { kiosk: true });
  const wallFan = top();
  check("Details: not on a wall screen (light or fan card); the rest of the card is there",
    !btn(wall, "Details") && !btn(wallFan, "Details") && !!btn(wall, "Warm") && !!btn(wall, "Turn Off"),
    buttons(wall).map(b => b.textContent));
  document.body.removeChild(wall); document.body.removeChild(wallFan);
}

// ── Item 4: the room sheet ──────────────────────────────────────────────────
const roomStates = (aState, bState) => ({
  "light.den_a": st(aState, { friendly_name: "Den Lamp", supported_color_modes: ["brightness"] }),
  "light.den_b": st(bState, { friendly_name: "Den Ceiling", supported_color_modes: ["brightness"] }),
  "light.den_c": st("unavailable", { friendly_name: "Den Shelf" }),
  "lock.den_door": st("locked", { friendly_name: "Den Door" }),
});
const area = { "light.den_a": "Den", "light.den_b": "Den", "light.den_c": "Den", "lock.den_door": "Den" };
const lightsOf = (states) => LM.gatherLights(states, area, {}, "pro");
const asked = [];
const occupancy = { people: [
  { name: "Alex", kind: "known", room: "Den" }, { name: "Sam", kind: "known", room: "Kitchen" },
  { name: "Unknown phone", kind: "unknown", room: "den" },
] };
const many = [];
const roomHass = (states) => ({ states, callService: hass.callService, callWS: async (m) => { asked.push(m.type); return occupancy; } });
const roomApi = (states, toggle, peopleShown = true) => ({
  hass: roomHass(states), floodLatches: {}, doorInvertByEid: {}, controlsFor: () => false, peopleShown,
  setMany: (eids, on) => many.push([eids, on]), toast() {}, openControls() {},
  toggle: toggle || ((e) => LM.toggleEntity(roomHass(states), e, {})),
});
{
  const s1 = roomStates("on", "off");
  const h = LM.openRoomSheet(roomApi(s1), lightsOf(s1), "Den");
  const sheet = top();
  await flush();
  check("room sheet: who PadSpan places in the room, and only them",
    sheet.textContent.includes("Here: Alex, +1 unknown phone") && !sheet.textContent.includes("Sam")
      && JSON.stringify(asked) === JSON.stringify(["padspan_ha/occupancy_estimate"]), sheet.textContent);
  const rowOf = (name) => nodes(sheet).find(n => n.children && n.children.some(c => c.textContent === name)) || null;
  const shelf = rowOf("Den Shelf");
  check("room sheet: an unavailable light's row is greyed out and says so",
    !!shelf && btn(shelf, "Unavailable")?.disabled === true && !btn(shelf, "On") && !btn(shelf, "Off"), shelf && shelf.textContent);
  check("room sheet: All lights on and off while some are off and some on",
    !!btn(sheet, "All lights on") && !!btn(sheet, "All lights off"));
  click(btn(sheet, "All lights on"));
  check("room sheet: All lights on switches only the ones that are off, never an unavailable one",
    JSON.stringify(many) === JSON.stringify([[["light.den_b"], true]]) && !onPage(sheet), many);
  check("room sheet: a closed sheet takes no update", h?.update(roomApi(s1), lightsOf(s1)) === false);
}
{
  const s1 = roomStates("off", "off");
  const api1 = roomApi(s1);
  const h = LM.openRoomSheet(api1, lightsOf(s1), "Den");
  const sheet = top();
  check("room sheet: with every light off, no All lights off", !btn(sheet, "All lights off") && !!btn(sheet, "All lights on"));
  // The house changes while the sheet is open: the host hands it newer states.
  const s2 = roomStates("on", "on");
  const live = h?.update(roomApi(s2), lightsOf(s2));
  const words = buttons(sheet).map(b => b.textContent);
  check("room sheet: follows newer states while open — rows and buttons as the house is now",
    live === true && !words.includes("All lights on") && words.includes("All lights off") && words.filter(w => w === "On").length === 2, words);
  click(btn(sheet, "✕"));
}
{
  // A switch Home Assistant refused: the row's word goes back.
  const s1 = roomStates("off", "off");
  let answer = false;
  LM.openRoomSheet(roomApi(s1, async () => answer), lightsOf(s1), "Den");
  const sheet = top();
  const rowOf = (name) => nodes(sheet).find(n => n.children && n.children.some(c => c.textContent === name));
  const b = btn(rowOf("Den Lamp"), "Off");
  click(b);
  const flipped = b.textContent;
  await flush();
  check("room sheet: a failed switch shows its old word again", flipped === "On" && b.textContent === "Off", [flipped, b.textContent]);
  answer = true;
  click(b);
  await flush();
  check("room sheet: a switch Home Assistant took keeps its new word", b.textContent === "On");
  click(btn(sheet, "✕"));
}
{
  // The lock row asks too (it goes through toggleEntity), and keeps its word on Cancel.
  const s1 = roomStates("off", "off");
  const n0 = calls.length;
  LM.openRoomSheet(roomApi(s1), lightsOf(s1), "Den");
  const sheet = top();
  const rowOf = (name) => nodes(sheet).find(n => n.children && n.children.some(c => c.textContent === name));
  const u = btn(rowOf("Den Door"), "Unlock");
  click(u);
  await flush();
  const dlg = top();
  check("room sheet: the lock row's Unlock asks first", dlg !== sheet && dlg.textContent.includes("Unlock Den Door?") && calls.length === n0);
  click(btn(dlg, "Cancel"));
  await flush();
  check("room sheet: Cancel sends nothing and the row still says Unlock", calls.length === n0 && u.textContent === "Unlock");
  click(u);
  await flush();
  click(btn(top(), "Unlock"));
  await flush();
  check("room sheet: Unlock unlocks", JSON.stringify(sent(n0)) === JSON.stringify(["lock unlock lock.den_door"]) && u.textContent === "Lock", sent(n0));
  click(btn(sheet, "✕"));
}
{
  // No line when nobody is placed there, on the unplaced chip's sheet, or without a connection.
  const s1 = roomStates("off", "off");
  const n0 = asked.length;
  LM.openRoomSheet(roomApi(s1), lightsOf(s1), "Den", ["light.den_a"]);
  const unplaced = top();
  await flush();
  check("room sheet: the unplaced chip's sheet asks nobody", asked.length === n0 && !unplaced.textContent.includes("Here:"));
  click(btn(unplaced, "✕"));
  LM.openRoomSheet({ ...roomApi(s1), hass: { states: s1 } }, lightsOf(s1), "Den");
  const plain = top();
  await flush();
  check("room sheet: no connection, no line, no error", !plain.textContent.includes("Here:"));
  click(btn(plain, "✕"));
  // People hidden on this screen: no names, and nobody is even asked.
  const n1 = asked.length;
  const hiddenSheet = LM.openRoomSheet(roomApi(s1, null, false), lightsOf(s1), "Den");
  const hidden = top();
  await flush();
  check("room sheet: with people hidden on this screen, no names and nothing asked",
    asked.length === n1 && !hidden.textContent.includes("Here:") && !hidden.textContent.includes("Alex"), hidden.textContent);
  // ...and a sheet whose screen stops showing people while it is open drops them.
  hiddenSheet?.update(roomApi(s1), lightsOf(s1));
  await flush();
  const shownThen = hidden.textContent.includes("Here: Alex");
  hiddenSheet?.update(roomApi(s1, null, false), lightsOf(s1));
  check("room sheet: names come and go with the screen's people switch while open",
    shownThen && !hidden.textContent.includes("Here:"), hidden.textContent);
  click(btn(hidden, "✕"));
  const who = LM.whoInRoom || (() => undefined);
  check("whoInRoom: nobody there is no line", who(occupancy, "Hall") === null && who(null, "Den") === null
    && who({ people: [{ name: "Someone", kind: "unknown", room: "Hall" }] }, "Hall") === "Here: +1 someone");
}

// Whether a screen shows people: the 3D view's rule — Show people (Pro) and
// the screen's own ⋯ People line (padspan_la3d_show_<slot>) not unticked.
{
  const shown = LM.peopleShownOn || (() => undefined);
  const on = { atlas_3d_people: true }, off = { atlas_3d_people: false };
  const pref = (slot, o) => localStorage.setItem(`padspan_la3d_show_${slot}`, JSON.stringify(o));
  localStorage.removeItem("padspan_la3d_show_atlas");
  const plain = shown("atlas", on, "pro");
  pref("atlas", { people: false });
  const unticked = shown("atlas", on, "pro"), otherScreen = shown("builder", on, "pro");
  pref("atlas", { people: true });
  const tickedButOff = shown("atlas", off, "pro");
  localStorage.removeItem("padspan_la3d_show_atlas");
  check("peopleShownOn: Show people on at Pro shows them; this screen's ⋯ People unticked hides them there only",
    plain === true && unticked === false && otherScreen === true, { plain, unticked, otherScreen });
  check("peopleShownOn: never with Show people off, below Pro, or before the settings came in",
    tickedButOff === false && shown("atlas", on, "bright") === false && shown("atlas", null, "pro") === false
      && shown("atlas", undefined, undefined) === false);
}

process.stdout.write(JSON.stringify({ cases, failures }) + "\n", () => process.exit(failures.length ? 1 : 0));   // exit only once the result is written (a pipe holds 64 KiB)
