// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
//
// Live Aboard's photo and people screens without a page
// (views/live_aboard_photo.js photoMachine, views/live_aboard_people.js
// peopleMachine), run for real against the builders module, with a fake
// callWS that records every call.
//
//   photo     the AI Task check; a photo is sent only by Read it, once per
//             press, with the kind when one was picked; a good answer goes
//             to the measurement, a bad one to "couldn't read it" with the
//             kind kept, no AI Task to the explanation; Build instead
//   measure   the AI's size taken only when sure (high, all three); one
//             typed size scales the other two by the photo's proportions
//             (the builder's where the photo gave none); "keep the
//             builder's"; a typed size read in m, cm or mm; clamped
//   consent   a person's photo is never sent before the consent is ticked,
//             nor without a photo or an AI Task; sent once, then dropped
//   people    figures by hand and from a photo (origin kept), removed (null
//             only when the file has one), unlinked when the person is gone;
//             beacon and scanner looks set and removed ({recipe: null});
//             only what changed is resolved
//   lists     the beacons the Atlas shows, the scanners on the map, people
//
// usage: live_aboard_photo.mjs <www/padspan-ha dir>
// prints one JSON line: { cases: {name: result}, failures: [...], payloads: [...] }
// payloads: what the people screen resolves, which the server's apply_edit
// must take (tests/test_live_aboard_photo.py).

import { pathToFileURL } from "node:url";
import { join } from "node:path";

const WWW = process.argv[2];
if (!WWW) { console.error("usage: live_aboard_photo.mjs <www/padspan-ha dir>"); process.exit(2); }
const F = await import(pathToFileURL(join(WWW, "views", "live_aboard_furniture.js")).href);
const PH = await import(pathToFileURL(join(WWW, "views", "live_aboard_photo.js")).href);
const PP = await import(pathToFileURL(join(WWW, "views", "live_aboard_people.js")).href);

const failures = [];
const cases = {};
const payloads = [];
const check = (name, ok, detail) => { cases[name] = !!ok; if (!ok) failures.push({ name, detail: detail === undefined ? null : detail }); };
const tryCase = async (name, fn) => { try { await fn(); } catch (e) { failures.push({ name, detail: String(e && e.stack || e).slice(0, 900) }); cases[name] = false; } };
const near = (a, b, eps = 6e-4) => Math.abs(a - b) <= eps;   // sizes are kept to the millimetre

const SOFA = F.defaultRecipe("sofa");
const ANSWER = {
  ok: true, target: "furniture", kind: "sofa",
  recipe: F.clampRecipe({ ...SOFA, colors: ["#5b6b7a", "#c8b89a"], width_m: 2.2, depth_m: 0.9, height_m: 0.8 }),
  details: { category: "seating", title: "Three-seat grey sofa", checked: false },
  size: { width_m: 2.2, depth_m: 0.9, height_m: 0.8, confidence: "medium" }, ai_task: "ai_task.vision",
};
const INFO = { ready: true, ai_task: "ai_task.vision", name: "Vision", local: true };

/** A callWS that answers by type, records every message. */
function fakeWS(answers){
  const calls = [];
  const ws = async (msg) => {
    calls.push(msg);
    const a = answers[msg.type];
    const v = typeof a === "function" ? a(msg) : a;
    if (v instanceof Error) throw v;
    return JSON.parse(JSON.stringify(v ?? null));
  };
  ws.calls = calls;
  ws.sent = () => calls.filter(c => "photo" in c);
  return ws;
}
const photoWS = (read) => fakeWS({ "padspan_ha/house3d_from_photo": (msg) => ("photo" in msg ? read(msg) : INFO) });

// ── photo ───────────────────────────────────────────────────────────────────
await tryCase("photo: the check picks the screen", async () => {
  const m = PH.photoMachine({ F, callWS: photoWS(() => ANSWER) });
  check("photo: ready goes to the photo screen", (await m.check()) === "pick" && m.info.name === "Vision");
  const n = PH.photoMachine({ F, callWS: fakeWS({ "padspan_ha/house3d_from_photo": { ready: false, message: "No AI Task" } }) });
  check("photo: none set up goes to the explanation", (await n.check()) === "noai" && n.info.message === "No AI Task");
  const e = Object.assign(new Error("Live Aboard is off."), { code: "house3d_off" });
  const o = PH.photoMachine({ F, callWS: fakeWS({ "padspan_ha/house3d_from_photo": e }) });
  check("photo: a refusal goes to the explanation, said plainly", (await o.check()) === "noai" && o.info.message === "Live Aboard is off.");
});

await tryCase("photo: sent only by Read it, once a press", async () => {
  const ws = photoWS(() => ANSWER);
  const m = PH.photoMachine({ F, callWS: ws });
  await m.check();
  await m.read();
  check("photo: no photo, nothing sent", ws.sent().length === 0 && m.step === "pick");
  m.choose("other");
  check("photo: the box is not a kind to pick", m.kind === null);
  m.choose("sofa");
  m.setPhoto("QUJD");
  const p = m.read();
  check("photo: reading shows at once", m.step === "reading");
  await p;
  const sent = ws.sent();
  check("photo: one call with the photo and the kind", sent.length === 1 && sent[0].target === "furniture"
    && sent[0].photo === "QUJD" && sent[0].kind === "sofa", sent);
  check("photo: a good answer goes to the measurement", m.step === "measure" && m.recipe.kind === "sofa"
    && m.details.title === "Three-seat grey sofa");
  await m.read();
  check("photo: nothing more is sent from the measurement", ws.sent().length === 1);
  const ws2 = photoWS(() => ANSWER);
  const n = PH.photoMachine({ F, callWS: ws2 });
  await n.check();
  n.setPhoto("QUJD");
  await n.read();
  check("photo: no kind picked, none sent", ws2.sent().length === 1 && !("kind" in ws2.sent()[0]));
});

await tryCase("photo: a bad answer and a failure fall back", async () => {
  const bad = { ok: false, target: "furniture", reason: "bad_answer", message: "Couldn't read it: …", kind: "bed" };
  const ws = photoWS(() => bad);
  const m = PH.photoMachine({ F, callWS: ws });
  await m.check();
  m.setPhoto("QUJD");
  await m.read();
  check("failed: couldn't read it, said plainly", m.step === "failed" && m.error === "Couldn't read it: …");
  check("failed: the kind is kept for Build", m.kind === "bed");
  const r = m.build(m.kind);
  check("failed: Build instead is the builder's own piece", r.recipe.kind === "bed" && r.details === null
    && JSON.stringify(r.recipe) === JSON.stringify(F.defaultRecipe("bed")));
  const n = PH.photoMachine({ F, callWS: photoWS(() => bad) });
  await n.check(); n.setPhoto("QUJD"); await n.read();
  n.retry();
  check("failed: try again sends the same photo once more", n.step === "pick" && n.canRead());
  check("failed: a box when nothing fits", n.build(null).recipe.kind === "other");
  const gone = Object.assign(new Error("No AI Task is chosen"), { code: "no_ai_task" });
  const o = PH.photoMachine({ F, callWS: photoWS(() => { throw gone; }) });
  await o.check(); o.setPhoto("QUJD"); await o.read();
  check("failed: no AI Task goes to the explanation", o.step === "noai" && o.info.message === "No AI Task is chosen");
  const x = PH.photoMachine({ F, callWS: photoWS(() => { throw new Error("socket closed"); }) });
  await x.check(); x.setPhoto("QUJD"); await x.read();
  check("failed: a broken call is a plain failure", x.step === "failed" && x.error === "socket closed");
});

// ── measure ─────────────────────────────────────────────────────────────────
const measuring = async (size) => {
  const m = PH.photoMachine({ F, callWS: photoWS(() => ({ ...ANSWER, size })) });
  await m.check(); m.setPhoto("QUJD"); await m.read();
  return m;
};
await tryCase("measure: the AI's size only when sure", async () => {
  const m = await measuring({ ...ANSWER.size, confidence: "medium" });
  check("measure: medium is not taken", m.accept() === null && m.step === "measure");
  const n = await measuring({ ...ANSWER.size, confidence: "high" });
  const r = n.accept();
  check("measure: high, all three: taken as read", r && near(r.recipe.width_m, 2.2) && near(r.recipe.depth_m, 0.9));
  const o = await measuring({ width_m: 2.2, depth_m: null, height_m: 0.8, confidence: "high" });
  check("measure: high but one missing is not taken", o.accept() === null);
});
await tryCase("measure: one size, the others by the photo's proportions", async () => {
  const m = await measuring(ANSWER.size);
  const r = m.measure("width_m", 2.0).recipe;
  check("measure: the typed width", near(r.width_m, 2.0));
  check("measure: depth and height follow the photo", near(r.depth_m, 0.9 * 2 / 2.2) && near(r.height_m, 0.8 * 2 / 2.2), r);
  const n = await measuring(ANSWER.size);
  const k = n.measure("width_m", null).recipe;
  check("measure: keep the builder's width", near(k.width_m, SOFA.width_m) && near(k.depth_m, 0.9 * SOFA.width_m / 2.2));
  const o = await measuring({ width_m: null, depth_m: null, height_m: null, confidence: null });
  const h = o.measure("height_m", SOFA.height_m * 1.1).recipe;
  check("measure: no size from the photo: the builder's proportions", near(h.width_m, SOFA.width_m * 1.1)
    && near(h.depth_m, SOFA.depth_m * 1.1), h);
  const p = await measuring(ANSWER.size);
  const big = p.measure("width_m", 99).recipe;
  check("measure: clamped the builders' way", big.width_m === F.FURNITURE.sofa.size.width_m[1]
    && JSON.stringify(big) === JSON.stringify(F.clampRecipe(big)));
  const q = await measuring(ANSWER.size);
  check("measure: no size is not a size", q.measure("width_m", 0) === null && q.measure("width_m", NaN) === null
    && q.measure("wingspan", 2) === null && q.step === "measure");
  check("measure: the details come along", q.measure("depth_m", 1).details.title === "Three-seat grey sofa");
});
await tryCase("measure: a typed size", async () => {
  const ok = [["2.1", 2.1], ["2,1", 2.1], ["210 cm", 2.1], ["2100mm", 2.1], [" 0.95 m ", 0.95]];
  check("measure: m, cm and mm", ok.every(([t, v]) => near(PH.readSize(t), v)), ok.map(([t]) => PH.readSize(t)));
  check("measure: not a size", ["", "abc", "0", "-2", "2 ft", "1.2.3"].every(t => PH.readSize(t) === null));
});
await tryCase("photo: which AI Task, and whether the photo leaves", async () => {
  check("note: local", PH.aiNote({ name: "Ollama", local: true }).includes("stays in the house"));
  check("note: cloud", PH.aiNote({ name: "Google AI", local: false }).includes("leaves the house"));
  check("note: unknown", PH.aiNote({ name: "X", local: null }).startsWith("X will read the photo. If it runs in the cloud"));
  check("note: never kept", PH.aiNote(INFO).includes("PadSpan never keeps the photo"));
  const kinds = PH.photoKinds(F);
  check("kinds: the furniture and device kinds, no box, in menu order", kinds.length > 0 && !kinds.some(k => k.kind === "other")
    && kinds.every(k => ["furniture", "device"].includes(F.FURNITURE[k.kind].group)) && kinds[0].kind === F.FURNITURE_KINDS[0]);
});

// ── people ──────────────────────────────────────────────────────────────────
const STATES = {
  "person.garry": { attributes: { friendly_name: "Garry" } },
  "person.nicole": { attributes: { friendly_name: "Nicole" } },
  "light.kitchen": { attributes: { friendly_name: "Kitchen" } },
};
const FIG = { params: PP.figureDefaults(F), origin: "photo" };
const tagKind = PH.photoKinds(F, ["tag"])[0];
const LOOK = tagKind ? F.defaultRecipe(tagKind.kind) : null;
const FILE = { data: { figures: { "person.garry": FIG, "person.gone": FIG },
                       devices: { "ble:AA:BB:CC:DD:EE:FF": { recipe: LOOK || F.defaultRecipe("other") }, "sensor.t": { z_m: 1.2 } } },
               writable: true };
const SNAP = { objects: { list: [
  { key: "ble:AA:BB:CC:DD:EE:FF", kind: "ble", user_label: "Garry's keys" },
  { key: "ble:11:22:33:44:55:66", kind: "private_ble", identified: true, name: "Pixel" },
  { key: "ble:99:99:99:99:99:99", kind: "ble" },                                   // unnamed noise
  { key: "ble:77:77:77:77:77:77", kind: "ble", user_label: "Ghost", _ghost: true },
  { key: "entity:sensor.t", kind: "entity", user_label: "Not a beacon" },
  { key: "ble:AA:BB:CC:DD:EE:FF", kind: "ble", user_label: "Garry's keys" },        // twice
] } };
const MODEL = { scanner_positions_m: { "E8:9F:6D:00:11:22": { x_m: 1, y_m: 2 }, "24:0A:C4:00:00:01": { x_m: 3, y_m: 1 } },
                scanners: { "E8:9F:6D:00:11:22": { room: "Living Room" } } };
const peopleWS = (read, info = { ...INFO, local: false }) => fakeWS({
  get_states: Object.entries(STATES).map(([entity_id, s]) => ({ entity_id, ...s })),
  "padspan_ha/house3d_get": FILE,
  "padspan_ha/house3d_from_photo": (msg) => ("photo" in msg ? read(msg) : info),
  "padspan_ha/live_snapshot": SNAP,
  "padspan_ha/model_get": MODEL,
});
const loaded = async (read = () => ({ ok: false, message: "x" }), info) => {
  const ws = peopleWS(read, info);
  const m = PP.peopleMachine({ F, callWS: ws });
  await m.load(); await m.loadDevices();
  return [m, ws];
};

await tryCase("lists: people, beacons and scanners", async () => {
  const [m] = await loaded();
  check("lists: Home Assistant's people", JSON.stringify(m.people) === JSON.stringify([{ id: "person.garry", name: "Garry" }, { id: "person.nicole", name: "Nicole" }]));
  check("lists: the beacons the Atlas shows", JSON.stringify(m.beacons.map(b => b.id)) === JSON.stringify(["ble:AA:BB:CC:DD:EE:FF", "ble:11:22:33:44:55:66"]), m.beacons);
  check("lists: the scanners on the map", m.scanners.length === 2 && m.scanners.some(s => s.label === "Living Room scanner"));
  check("lists: a figure whose person is gone is not linked", JSON.stringify(m.unlinked()) === JSON.stringify(["person.gone"]));
  const n = PP.peopleMachine({ F, callWS: peopleWS(() => null), hass: { states: STATES } });
  await n.load();
  check("lists: the page's own states when it has them", n.people.length === 2);
});

await tryCase("consent: nothing is sent before it is ticked", async () => {
  const fig = { ok: true, target: "person", figure: { params: { ...PP.figureDefaults(F), colors: { ...F.FIGURE.colors } }, origin: "photo" } };
  const [m, ws] = await loaded(() => fig);
  m.photoFigure("person.nicole", "Nicole");
  m.setPhoto("QUJD");
  await m.read();
  check("consent: not ticked, nothing sent", ws.sent().length === 0 && m.error === PP.CONSENT_NEEDED && m.step === "figphoto");
  check("consent: Read it is off until then", !m.canRead());
  m.setConsent("yes");
  check("consent: only a real tick counts", !m.consent);
  m.setConsent(true);
  check("consent: ticked, with a photo, Read it is on", m.canRead() && m.error === null);
  await m.read();
  const sent = ws.sent();
  check("consent: one call, as a person", sent.length === 1 && sent[0].target === "person" && !("kind" in sent[0]));
  check("consent: the photo is dropped once sent", m.photo === null);
  check("consent: the figure lands in the sliders, from a photo", m.step === "figure" && m.edit.origin === "photo");
  m.setFigure(F.FIGURE.params[0].key, F.FIGURE.params[0].type === "choice" ? F.FIGURE.params[0].choices.at(-1) : F.FIGURE.params[0].def);
  m.keepFigure();
  check("consent: adjusted, it is still from a photo", m.changes.figures["person.nicole"].origin === "photo" && m.step === "list");
  const [n, ws2] = await loaded(() => fig, { ready: false, message: "No AI Task" });
  n.photoFigure("person.nicole", "Nicole"); n.setConsent(true); n.setPhoto("QUJD");
  await n.read();
  check("consent: no AI Task, nothing sent", ws2.sent().length === 0 && !n.canRead());
  n.back();
  n.photoFigure("person.garry", "Garry");
  check("consent: asked again for each photo", n.consent === false);
});

await tryCase("people: figures by hand, removed, unlinked", async () => {
  const [m] = await loaded();
  m.editFigure("person.nicole", "Nicole");
  const num = F.FIGURE.params.find(s => s.type === "num" || s.type === "int");
  if (num) m.setFigure(num.key, num.max + 10);
  m.setFigure("colors.top", "#123456");
  m.keepFigure();
  const f = m.changes.figures["person.nicole"];
  check("people: by hand is build", f.origin === "build" && f.params.colors.top === "#123456");
  check("people: numbers clamped", !num || f.params[num.key] === num.max);
  m.removeFigure("person.nicole");
  check("people: removing one never saved is no change", !("person.nicole" in m.changes.figures));
  m.removeFigure("person.garry");
  check("people: removing a saved one is null", m.changes.figures["person.garry"] === null && m.figureOf("person.garry") === null);
  m.removeFigure("person.gone");
  check("people: an unlinked one can be removed", m.changes.figures["person.gone"] === null && m.unlinked().length === 0);
  payloads.push({ figures: m.result().figures, devices: m.result().devices });
});

await tryCase("people: beacon and scanner looks", async () => {
  if (!tagKind) { check("people: looks wait for the tag builders", true); return; }
  const look = { ok: true, target: "tag", kind: tagKind.kind, recipe: F.defaultRecipe(tagKind.kind), details: { category: "device", title: "White puck tag", checked: false } };
  const [m, ws] = await loaded(() => look);
  m.editLook("ble:11:22:33:44:55:66", "Pixel", "beacon");
  check("looks: a beacon is a tag", m.edit.group === "tag" && F.FURNITURE[m.edit.recipe.kind].group === "tag");
  m.setLook("colors.0", "#ff0000");
  m.keepLook();
  const e = m.changes.devices["ble:11:22:33:44:55:66"];
  check("looks: kept as a look", e.recipe.colors[0] === "#ff0000" && e.library_id === null && e.submission_id === null);
  m.photoLook("E8:9F:6D:00:11:22", "Living Room scanner", "scanner");
  m.setPhoto("QUJD");
  const scannerKinds = PH.photoKinds(F, ["scanner"]);
  if (scannerKinds.length) {
    await m.read();
    check("looks: a scanner's photo is read as a scanner, no consent needed", ws.sent().at(-1).target === "scanner");
  }
  m.back();
  m.removeLook("ble:AA:BB:CC:DD:EE:FF");
  check("looks: removing one is {recipe: null}", JSON.stringify(m.changes.devices["ble:AA:BB:CC:DD:EE:FF"]) === '{"recipe":null}');
  m.removeLook("sensor.t");
  check("looks: a height alone is not a look to remove", !("sensor.t" in m.changes.devices));
  const r = m.result();
  check("people: only what changed", Object.keys(r.figures).length === 0 && Object.keys(r.devices).length === 2);
  payloads.push(r);
});

console.log(JSON.stringify({ cases, failures, payloads }));
