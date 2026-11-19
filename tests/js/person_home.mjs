// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
//
// Is a person home (views/person_home.js), run:
//
//   table     the one table (tests/fixtures/person_home_cases.json): each
//             case's answer and the zones at home, printed for the Python
//             side to hold equal to presence_rules.person_is_home
//   tracked   Live Aboard's people (live_aboard_tracked.js wantedOf) known
//             only by their room: a person linked to PadSpan's tracker
//             (state: the room), one with no tracker whose tag PadSpan places
//             ("unknown"), one in a zone inside the home zone and one home
//             stand in their rooms; "unknown" with only an HA entity's room
//             or an away tag, a zone elsewhere (named as a room is), and
//             not_home do not
//   director  "Arrived home" (live_aboard_director.js arrivedOf) from away
//             to a room PadSpan knows, not to a zone elsewhere, not from a
//             room to a room
//
// usage: person_home.mjs <www/padspan-ha dir> <person_home_cases.json>
// prints one JSON line: { cases: {name: result}, failures: [...], table: {...} }

import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { join } from "node:path";

const WWW = process.argv[2], TABLE = process.argv[3];
if (!WWW || !TABLE) { console.error("usage: person_home.mjs <www/padspan-ha dir> <person_home_cases.json>"); process.exit(2); }

const PH = await import(pathToFileURL(join(WWW, "views", "person_home.js")).href);
const RS = await import(pathToFileURL(join(WWW, "views", "room_spot.js")).href);   // APART_M
const TR = await import(pathToFileURL(join(WWW, "views", "live_aboard_tracked.js")).href);
const D = await import(pathToFileURL(join(WWW, "views", "live_aboard_director.js")).href);

const failures = [];
const cases = {};
const check = (name, ok, detail) => { cases[name] = !!ok; if (!ok) failures.push({ name, detail: detail === undefined ? null : detail }); };
const tryCase = (name, fn) => {
  try { fn(); } catch (e) { failures.push({ name, detail: String(e && e.stack || e).slice(0, 900) }); cases[name] = false; }
};
const inPoly = (x, y, P) => { let c = false; for (let i = 0, j = P.length - 1; i < P.length; j = i++) { const a = P[i], b = P[j]; if ((a[1] > y) !== (b[1] > y) && x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0]) c = !c; } return c; };

// ── the one table ───────────────────────────────────────────────────────────
const T = JSON.parse(readFileSync(TABLE, "utf8"));
const zoneStates = Object.fromEntries(T.zones.map(z => [z.entity_id, { state: "zoning", attributes: z.attributes }]));
const zones = PH.homeZones(zoneStates);
const table = {
  zones: Object.fromEntries([...zones.entries()].sort()),
  answers: T.cases.map(c => PH.personIsHome(c.state, { rooms: T.rooms, zones, placed: c.placed })),
  // The same answers with the zones as a plain object, and the state as Home Assistant's state object.
  asObjects: T.cases.map(c => PH.personIsHome({ state: c.state }, { rooms: new Set(T.rooms), zones: Object.fromEntries(zones), placed: c.placed })),
};
tryCase("table: every case as the table says", () => {
  const bad = T.cases.filter((c, i) => table.answers[i] !== c.home || table.asObjects[i] !== c.home).map(c => c.why);
  check("table: every case as the table says", !bad.length && JSON.stringify(table.zones) === JSON.stringify(Object.fromEntries(Object.entries(T.zones_expected).sort())), { bad, zones: table.zones });
});

// ── Live Aboard's people known only by their room ───────────────────────────
const rect = (x0, y0, x1, y1) => ({ type: "poly", floor_id: "main", points_m: [[x0, y0], [x1, y0], [x1, y1], [x0, y1]] });
const MODEL = { floors: [{ id: "main", name: "Main" }],
  room_geometry_m: { Kitchen: rect(0, 0, 4, 4), Den: rect(5, 0, 9, 4), Office: rect(10, 0, 13, 4) } };
const OBJ = (key, kind, room, more = {}) => ({ key, kind, room, x_m: null, y_m: null, floor_id: "main", age_s: 4, ...more });
const SNAP = { objects: { list: [
  OBJ("irk:ann", "private_ble", "Kitchen", { linked_entities: ["device_tracker.ann_phone"] }),
  OBJ("ble:bob", "ble", "Den", { user_label: "Bob" }),
  OBJ("entity:device_tracker.cara", "entity", "Den", { entity_id: "device_tracker.cara", linked_entities: ["device_tracker.cara"] }),
  OBJ("ble:dan", "ble", "Den", { user_label: "Dan", away: true }),
  OBJ("ble:eve", "ble", "Kitchen", { user_label: "Eve" }),
  OBJ("ble:fay", "ble", "Office", { user_label: "Fay" }),
  OBJ("ble:gus", "ble", "Den", { user_label: "Gus" }),
  OBJ("ble:hal", "ble", "Den", { user_label: "Hal" }),
] } };
const person = (state, name, trackers = []) => ({ state, attributes: { friendly_name: name, device_trackers: trackers } });
const ZONES = Object.fromEntries(T.zones.filter(z => z.entity_id !== "zone.office_home").map(z => [z.entity_id, { state: "0", attributes: z.attributes }]));
const STATES = {
  ...ZONES,
  "person.ann": person("Kitchen", "Ann", ["device_tracker.ann_phone"]),        // linked to PadSpan's own tracker: its state is the room
  "device_tracker.ann_phone": { state: "Kitchen", attributes: { friendly_name: "Ann's phone", source_type: "bluetooth_le" } },
  "person.bob": person("unknown", "Bob"),                                       // no tracker of his own; his tag PadSpan places
  "person.cara": person("unknown", "Cara", ["device_tracker.cara"]),           // "unknown", and only an HA entity's room
  "device_tracker.cara": { state: "unknown", attributes: { friendly_name: "Cara" } },
  "person.dan": person("unknown", "Dan"),                                       // his tag is away
  "person.eve": person("Garden", "Eve"),                                        // a zone inside the home zone
  "person.fay": person("Office", "Fay"),                                        // a zone 5 km away, named as a room is
  "person.gus": person("not_home", "Gus"),
  "person.hal": person("home", "Hal"),
};
tryCase("tracked: who is home stands in their room; who is away, or unknown with nothing placed, does not", () => {
  const want = TR.wantedOf({ model: MODEL, snapshot: SNAP, states: STATES, people: true });
  const w = Object.fromEntries(want.filter(x => x.kind === "person").map(x => [x.key, x]));
  const drawn = Object.keys(w).sort();
  const inRoom = (k, room) => w[k] && inPoly(w[k].x, w[k].y, MODEL.room_geometry_m[room].points_m) && w[k].dim;
  const den = ["person.bob", "person.hal"].map(k => w[k]);
  check("tracked: who is home stands in their room; who is away, or unknown with nothing placed, does not",
    JSON.stringify(drawn) === JSON.stringify(["person.ann", "person.bob", "person.eve", "person.hal"])
    && inRoom("person.ann", "Kitchen") && inRoom("person.bob", "Den") && inRoom("person.eve", "Kitchen") && inRoom("person.hal", "Den")
    && Math.hypot(den[0].x - den[1].x, den[0].y - den[1].y) >= RS.APART_M
    && Math.hypot(w["person.ann"].x - w["person.eve"].x, w["person.ann"].y - w["person.eve"].y) >= RS.APART_M,
    { drawn, at: Object.fromEntries(Object.entries(w).map(([k, x]) => [k, [x.x, x.y]])) });
  // Without the zones Home Assistant has, a state named as a zone is only a name: Eve's "Garden" is no room.
  const noZones = Object.fromEntries(Object.entries(STATES).filter(([k]) => !k.startsWith("zone.")));
  const w2 = TR.wantedOf({ model: MODEL, snapshot: SNAP, states: noZones, people: true }).filter(x => x.kind === "person").map(x => x.key).sort();
  check("tracked: a zone's name means nothing without the zone; an Office zone elsewhere outranks the Office room",
    JSON.stringify(w2) === JSON.stringify(["person.ann", "person.bob", "person.fay", "person.hal"]) && !w["person.fay"], w2);
});

// ── the director's "Arrived home" ───────────────────────────────────────────
tryCase("director: from away to a room PadSpan knows is arriving home; to a zone elsewhere, or room to room, is not", () => {
  const any = { key: "person.ann", rooms: [] };
  const st = (s) => ({ state: s, attributes: {} });
  const ctx = { rooms: PH.knownRooms(MODEL, SNAP), zones: PH.homeZones(STATES) };
  const home = (s) => PH.personIsHome(s, ctx);
  check("director: from away to a room PadSpan knows is arriving home; to a zone elsewhere, or room to room, is not",
    D.arrivedOf(any, "", "", st("not_home"), st("Kitchen"), home) === "Arrived home"
    && D.arrivedOf(any, "", "", st("not_home"), st("Garden"), home) === "Arrived home"
    && D.arrivedOf(any, "", "", st("Office"), st("Den"), home) === "Arrived home"
    && D.arrivedOf(any, "", "", st("not_home"), st("Office"), home) === null
    && D.arrivedOf(any, "", "", st("Kitchen"), st("home"), home) === null
    && D.arrivedOf(any, "", "", st("Kitchen"), st("Den"), home) === null
    && D.arrivedOf(any, "", "", st("unknown"), st("Kitchen"), home) === null
    && D.arrivedOf(any, "", "", st("not_home"), st("home")) === "Arrived home"
    && D.arrivedOf(any, "", "", st("not_home"), st("Kitchen")) === null, null);
});

console.log(JSON.stringify({ cases, failures, table }));
