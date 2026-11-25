// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
//
// "Start with a rough house from your Home Assistant rooms" (views/rough_plan.js starterOffer / starterNote, the
// owner's gap pick 1, 2026-11-23), run for real under the DOM shim: offered at the top of Setup and on Mapping's empty
// Library only while the house has no rooms (never the demo house, a wall screen or someone who isn't an
// administrator); its preview (padspan_ha/maps_starter_house, dry_run) says what it will make and what it leaves out,
// with the floor for areas that have none; one confirm makes it. Afterwards the plan's rough-start note says how many
// boxes are still boxes, with its two ways on; the plan editor draws the boxes dashed; and "Put it on the map"
// (wizard_build.js) puts a traced room in place of its box, but never over a room someone reshaped. In German too.
//
// usage: starter_house.mjs <www/padspan-ha dir>
// prints one JSON line: { cases: {name: result}, failures: [...] }

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import * as shim from "./dom_shim.mjs";

const WWW = process.argv[2];
shim.install(globalThis);
const I18N = await import(pathToFileURL(join(WWW, "views", "i18n.js")).href);
const RP = await import(pathToFileURL(join(WWW, "views", "rough_plan.js")).href);
const S = await import(pathToFileURL(join(WWW, "views", "setup.js")).href);
const ST = await import(pathToFileURL(join(WWW, "views", "setup_status.js")).href);
const WB = await import(pathToFileURL(join(WWW, "views", "wizard_build.js")).href);
const MAPS = await import(pathToFileURL(join(WWW, "views", "maps.js")).href);
const src = readFileSync(join(WWW, "panel.js"), "utf-8").replace(/\r\n/g, "\n");
const elStart = src.indexOf("function el(tag, attrs={}, children=[]){");
const el = new Function("return " + src.slice(elStart, src.indexOf("\n}\n", elStart) + 2).replace(/^function el/, "function"))();

const failures = [];
const cases = {};
const check = (name, ok, detail) => { cases[name] = !!ok; if (!ok) failures.push({ name, detail: detail === undefined ? null : detail }); };
const tick = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); await shim.flush(); for (let i = 0; i < 30; i++) await Promise.resolve(); };

const BOX_K = [[1, 1], [5.75, 1], [5.75, 5.75], [1, 5.75]];
const BOX_H = [[6.25, 1], [9.75, 1], [9.75, 4.5], [6.25, 4.5]];
const PREVIEW = {
  ok: true, dry_run: true,
  floors: [{ floor_id: "ground", name: "Ground floor", across_m: 12, down_m: 9, rooms: [
    { name: "Kitchen", devices: 9, side_m: 4.75, points_m: BOX_K }, { name: "Hall", devices: 1, side_m: 3.5, points_m: BOX_H },
    { name: "Garage", devices: 0, side_m: 3.5, points_m: [[1, 6], [4.5, 6], [4.5, 9.5], [1, 9.5]] }] },
    { floor_id: "upper", name: "Upstairs", across_m: 6, down_m: 6, rooms: [{ name: "Bedroom", devices: 2, side_m: 3.5, points_m: BOX_K }] }],
  skipped: [{ room: "Yard", why: "outdoor", floor_id: "__outside__" }, { room: "Office", why: "drawn", floor_id: "ground" }],
  no_floor: { to: "ground", rooms: ["Garage"] }, choices: [["ground", "Ground floor"], ["upper", "Upstairs"]],
};

function house(extra = {}) {
  return Object.assign({
    _mapsLoaded: true, _modelLoaded: true, dataMode: "live", view: "setup", complexity: "advanced", settings: {}, maps: { list: [] },
    model: { floors: [{ id: "ground", name: "Ground floor", level: 0 }, { id: "upper", name: "Upstairs", level: 1 }],
             areas: [{ name: "Kitchen" }, { name: "Hall" }], map_transforms: {}, room_geometry_m: {}, scanner_positions_m: {} },
    calibration: { points: [], model: {} }, setupPhones: [],
  }, extra);
}

function mkCtx(st, answers = {}) {
  const calls = [], events = [];
  const ctx = {
    state: st, hass: { user: { is_admin: true } },
    helpers: { el, helpBtn: () => el("button", {}, "?"), errorText: (e) => String(e && e.message || e), roomColor: () => "#52b788",
               roomColorAlpha: (c) => c, asButton: {}, mapImageUrl: () => "/x.png", esc: (s) => String(s ?? "") },
    toast: (m) => calls.push(["toast", m]),
    actions: {
      renderRooms: () => calls.push(["renderRooms"]), showView: (v) => { st.view = v; },
      telemetryEvent: (n) => events.push(n),
      callWS: async (msg) => {
        calls.push(["ws", msg]);
        if (msg.type === "padspan_ha/maps_starter_house") return msg.dry_run ? (answers.preview || PREVIEW) : (answers.made || { ...PREVIEW, ok: true, rooms: ["Kitchen", "Hall", "Garage", "Bedroom"], maps: [{ id: "s1" }, { id: "s2" }] });
        return { settings: st.settings };
      },
      modelRefresh: async () => calls.push(["modelRefresh"]), mapsRefresh: async () => calls.push(["mapsRefresh"]),
      calibrationGet: async () => ({ points: [], model: {} }),
      setMapsTab: (t) => { st.mapsTab = t; calls.push(["setMapsTab", t]); },
    },
  };
  return { ctx, calls, events };
}
const q = (root, attr) => root.querySelector(`[data-starter="${attr}"]`);
const ws = (calls) => calls.filter(c => c[0] === "ws" && c[1].type === "padspan_ha/maps_starter_house").map(c => c[1]);

// ── offered at the top of Setup, only while the house has no rooms ──────────
{
  RP._resetStarter();
  const st = house(), { ctx, events } = mkCtx(st);
  const root = S.render(ctx);
  const offer = q(root, "offer");
  const card = root.children[0];
  const kids = card.children;
  check("setup: offered at the top, before the steps", !!offer && kids.indexOf(offer) >= 0
    && kids.indexOf(offer) < kids.findIndex(k => k.querySelector && k.querySelector("[data-setup-status]")), kids.map(k => k.getAttribute && k.getAttribute("data-starter")));
  check("setup: its title says what it is", offer && offer.textContent.includes("Start with a rough house from your Home Assistant rooms"), offer && offer.textContent);
  S.render(ctx);
  check("setup: counted once a page as offered", events.filter(e => e === "starter_house:offered").length === 1, events);
  const roomed = house();
  roomed.model.room_geometry_m.Kitchen = { floor_id: "ground", points_m: [[0, 0], [3, 0], [3, 3]] };
  check("setup: not offered to a house that has rooms", !q(S.render(mkCtx(roomed).ctx), "offer"));
  const traced = house({ maps: { list: [{ id: "m1", floor_id: "ground", room_bounds: { Hall: { type: "poly", points: [[0, 0], [1, 0], [1, 1]] } }, receivers: [] }] } });
  check("setup: not offered where a room is traced on a plan", !q(S.render(mkCtx(traced).ctx), "offer"));
  check("setup: not on the demo house", !q(S.render(mkCtx(house({ dataMode: "sample" })).ctx), "offer"));
  check("setup: not on a wall screen", !q(S.render(mkCtx(house({ kioskMode: true })).ctx), "offer"));
  const user = mkCtx(house());
  user.ctx.hass.user.is_admin = false;
  check("setup: not for someone who isn't an administrator", !q(S.render(user.ctx), "offer"));
}

// ── the preview, then one confirm ───────────────────────────────────────────
{
  RP._resetStarter();
  const st = house(), { ctx, calls, events } = mkCtx(st);
  let root = S.render(ctx);
  check("preview: nothing is asked of the server before the button", ws(calls).length === 0);
  q(root, "preview-go").click();
  await tick();
  check("preview: asked as a dry run", ws(calls).length === 1 && ws(calls)[0].dry_run === true && !("label" in ws(calls)[0]), ws(calls));
  check("preview: counted", events.includes("starter_house:previewed"), events);
  root = S.render(ctx);
  const pv = q(root, "preview"), text = pv ? pv.textContent : "";
  check("preview: each floor with its rooms", pv && pv.querySelectorAll('[data-starter="floor"]').length === 2
    && text.includes("Ground floor: a blank floor with 3 rooms (Kitchen, Hall, Garage)") && text.includes("Upstairs: a blank floor with 1 room (Bedroom)"), text);
  check("preview: what it leaves out, and why", text.includes("Outdoors, left out: Yard.") && text.includes("Already drawn, left as they are: Office."), text);
  const sel = q(root, "no-floor");
  check("preview: an area with no floor, and the floor it goes on", !!sel && text.includes("Garage has no floor in Home Assistant. Put it on:")
    && sel.children.length === 2 && st._starter.to === "ground", text);
  sel.value = "upper";
  sel.dispatchEvent({ type: "change" });
  await tick();
  check("preview: another floor picked asks again with it", ws(calls).length === 2 && ws(calls)[1].no_floor_to === "upper" && ws(calls)[1].dry_run, ws(calls));
  root = S.render(ctx);
  q(root, "make").click();
  await tick(); await tick();
  const made = ws(calls)[2];
  check("make: one press, not a dry run, with the floor picked and the plans' word", made && made.dry_run === false && made.no_floor_to === "upper" && made.label === "rough start", made);
  check("make: the house read again, and said", calls.some(c => c[0] === "modelRefresh") && calls.some(c => c[0] === "mapsRefresh")
    && calls.some(c => c[0] === "toast" && String(c[1]).startsWith("Rough house made: 4 rooms on the map.")), calls.filter(c => c[0] !== "renderRooms"));
  check("make: the preview is gone", !st._starter.preview && !q(S.render(ctx), "preview"));
  check("make: the server counts it, not the panel", !events.includes("starter_house:made"), events);
}
{
  RP._resetStarter();
  const nothing = { ...PREVIEW, ok: false, code: "nothing", floors: [], choices: [], no_floor: { to: null, rooms: [] },
                    skipped: [{ room: "Kitchen", why: "floor_has_plan", floor_id: "ground" }] };
  const st = house(), { ctx, calls, events } = mkCtx(st, { preview: nothing });
  q(S.render(ctx), "preview-go").click();
  await tick();
  const root = S.render(ctx), text = q(root, "preview").textContent;
  check("nothing: said, with why, and no Make", text.includes("Nothing to make: every floor already has a floor plan or rooms.")
    && text.includes("On a floor that already has a plan or rooms, so draw them there: Kitchen.") && !q(root, "make") && !!q(root, "cancel"), text);
  check("nothing: counted", events.includes("starter_house:nothing") && !events.includes("starter_house:previewed"), events);
  q(root, "cancel").click();
  check("nothing: Cancel closes it", !st._starter.preview && ws(calls).length === 1);
}

// ── afterwards: the boxes, the note, the two ways on ────────────────────────
const starterMap = { id: "s1", name: "Ground floor (rough start)", floor_id: "ground", kind: "blank", image: { width: 1200, height: 900 },
                     receivers: [], room_bounds: {}, starter: { made: "2026-11-24", rooms: { Kitchen: BOX_K, Hall: BOX_H } } };
const made = () => house({ view: "maps", maps: { list: [JSON.parse(JSON.stringify(starterMap))] }, model: {
  ...house().model, map_transforms: { s1: { scale_x_m: 12, scale_y_m: 9, origin_x_m: 0, origin_y_m: 0, rotation_rad: 0, shear_rad: 0 } },
  room_geometry_m: { Kitchen: { type: "poly", floor_id: "ground", points_m: BOX_K, committed_by: "external_import" },
                     Hall: { type: "poly", floor_id: "ground", points_m: BOX_H, committed_by: "external_import" } } } });
{
  const st = made();
  check("boxes: both still as made", JSON.stringify(Object.keys(ST.starterBoxes(st)).sort()) === '["Hall","Kitchen"]', ST.starterBoxes(st));
  st.model.room_geometry_m.Hall = { ...st.model.room_geometry_m.Hall, points_m: [[6, 1], [9.75, 1], [9.75, 4.5], [6, 4.5]], committed_by: "correction" };
  check("boxes: one reshaped since is the person's room", JSON.stringify(Object.keys(ST.starterBoxes(st))) === '["Kitchen"]', ST.starterBoxes(st));
  check("boxes: none without a starter plan", Object.keys(ST.starterBoxes(house())).length === 0);
  // A box traced on a plan with a scale since: drawn on that plan, to put on the map (in place of the box).
  const real = { id: "r1", floor_id: "ground", room_bounds: { Kitchen: { type: "poly", points: [[0.1, 0.1], [0.4, 0.1], [0.4, 0.5]] } }, receivers: [] };
  st.maps.list.push(real);
  st.model.map_transforms.r1 = { scale_x_m: 10, scale_y_m: 8 };
  const d = ST.roomDrawn(st, "Kitchen");
  check("drawn: a box traced on a real plan is to put on the map from it", d && d.house === false && d.map.id === "r1", d);
  check("drawn: a room someone reshaped stays the house's", JSON.stringify(ST.roomDrawn(st, "Hall")) === '{"house":true,"map":null}');
}
{
  const st = made(), { ctx, events } = mkCtx(st);
  let reshaped = 0, uploaded = 0;
  const note = RP.starterNote(ctx, st.maps.list[0], { reshape: () => reshaped++, upload: () => uploaded++ });
  check("note: says how many boxes are left, and both ways on", note && note.textContent.includes("Rough start: 2 rooms on this floor are still boxes made from your Home Assistant rooms.")
    && !!q(note, "reshape") && !!q(note, "upload"), note && note.textContent);
  q(note, "reshape").click(); q(note, "upload").click();
  check("note: each way runs and is counted", reshaped === 1 && uploaded === 1 && events.includes("starter_house:reshape") && events.includes("starter_house:upload"), events);
  check("note: none on a plan the starter didn't make", RP.starterNote(ctx, { id: "x", floor_id: "ground", room_bounds: {} }, {}) === null);
  st.model.room_geometry_m = {};
  const all = RP.starterNote(ctx, st.maps.list[0], { reshape: () => {}, upload: () => {} });
  check("note: every box replaced, only the upload way", all.textContent.includes("Rough start: a blank floor made from your Home Assistant rooms.") && !q(all, "reshape") && !!q(all, "upload"), all.textContent);
}

// ── Mapping: the empty Library offers it; the rough plan's row and editor say so ───
const quiet = () => new Proxy(() => document.createElement("span"), {
  get: (_t, k) => (k === "then" ? undefined : k === Symbol.toPrimitive || k === "toString" ? () => "" : quiet()),
  apply: () => document.createElement("span"),
});
const mapsCtx = (st) => {
  const m = mkCtx(st);
  m.ctx.hass = { user: { is_admin: true }, states: {} };
  m.ctx.helpers = new Proxy(m.ctx.helpers, { get: (t, k) => (k in t ? t[k] : quiet()) });
  m.ctx.actions = new Proxy(m.ctx.actions, { get: (t, k) => (k in t ? t[k] : quiet()) });
  return m;
};
{
  RP._resetStarter();
  const st = house({ view: "maps", mapsTab: "library", _dataModeKnown: true });
  const { ctx } = mapsCtx(st);
  const root = MAPS.render(ctx);
  await shim.flush();
  check("library: the empty Library offers it", !!q(root, "offer"));
  const full = made();
  Object.assign(full, { mapsTab: "library", _dataModeKnown: true });
  const r2 = MAPS.render(mapsCtx(full).ctx);
  await shim.flush();
  check("library: a house with rooms is not offered it", !q(r2, "offer"));
  check("library: the rough plan's row has its note", !!q(r2, "note") && q(r2, "note").textContent.includes("2 rooms on this floor are still boxes"));
  // Advanced: reshape is Mapping → Layout on that floor; Basic: the Setup Wizard's rooms step on that plan.
  const adv = mapsCtx(Object.assign(made(), { mapsTab: "library", _dataModeKnown: true, maps: { list: [JSON.parse(JSON.stringify(starterMap))], _roomsFloorId: "upper" } }));
  q(MAPS.render(adv.ctx), "reshape").click();
  check("library: Advanced reshapes in Layout, on its floor", adv.ctx.state.mapsTab === "rooms" && adv.ctx.state.maps._roomsFloorId === "ground", adv.ctx.state.mapsTab);
  const bas = mapsCtx(Object.assign(made(), { complexity: "basic", mapsTab: "library", _dataModeKnown: true }));
  q(MAPS.render(bas.ctx), "reshape").click();
  check("library: Basic reshapes in the Setup Wizard's rooms step on that plan", bas.ctx.state._mapsWizard && bas.ctx.state._mapsWizard.step === 3 && bas.ctx.state._mapsWizard.mapId === "s1", bas.ctx.state._mapsWizard);
  const up = mapsCtx(Object.assign(made(), { mapsTab: "library", _dataModeKnown: true }));
  q(MAPS.render(up.ctx), "upload").click();
  check("library: Upload opens on the plan's floor", up.ctx.state.mapsTab === "upload" && up.ctx.state._mapsUploadFloorId === "ground");
}
{
  const st = Object.assign(made(), { mapsTab: "edit", activeMapId: "s1", _dataModeKnown: true });
  let root = null;
  try { root = MAPS.render(mapsCtx(st).ctx); await shim.flush(); } catch (e) { check("edit: the rough plan opens", false, String(e && e.stack || e)); }
  if (root) {
    const boxes = root.querySelectorAll("[data-starter-box]").map(n => n.getAttribute("data-starter-box")).sort();
    check("edit: the house's boxes are drawn dashed on the rough plan", JSON.stringify(boxes) === '["Hall","Kitchen"]', boxes);
    check("edit: with its note, and how to draw over a box", !!q(root, "note") && q(root, "note").textContent.includes("To redraw a box here"), q(root, "note") && q(root, "note").textContent);
  }
}

// ── the boxes never block the plan path (coordinator, 2026-11-24) ───────────
{
  const AIW = await import(pathToFileURL(join(WWW, "views", "ai_wizard.js")).href);
  const st = made();
  st.model.map_transforms.s1.reference_measurements = [{ source: "blank" }];
  const d = S.deriveSetup(st);
  check("plan path: after the rough house, Setup's rooms step is still to do (its boxes are placeholders there)",
    d.steps.find(x => x.id === "plan").done && d.steps.find(x => x.id === "scale").done && !d.steps.find(x => x.id === "rooms").done && d.current === "rooms", d.steps);
  check("plan path: but it isn't offered again", !RP.starterOffered(mkCtx(st).ctx) && ST.hasAnyRooms(st) && !ST.hasRooms(st));
  check("plan path: an untouched box is not drawn", ST.roomDrawn(st, "Kitchen") === null && ST.undrawnAreaNames(st).includes("Kitchen"));
  const real = { id: "r1", name: "Ground floor plan", floor_id: "ground", image: { width: 1000, height: 800 }, receivers: [], room_bounds: {}, created: "2026-11-25" };
  st.maps.list.push(real);
  st.model.map_transforms.r1 = { scale_x_m: 10, scale_y_m: 8, origin_x_m: 0, origin_y_m: 0, rotation_rad: 0, shear_rad: 0 };
  check("plan path: a real plan on the rough floor has no rooms yet", ST.planRoomed(st, real) === false && ST.planRoomed(st, st.maps.list[0]) === false);
  const plans = AIW.plansOf(st).map(m => m.id);
  check("plan path: the rooms helper reads the real plan, never the rough one", JSON.stringify(plans) === '["r1"]', plans);
  const open = (state) => { const c = mapsCtx(Object.assign(state, { mapsTab: "edit", activeMapId: "r1", _dataModeKnown: true })); MAPS.render(c.ctx); return c.ctx.state.maps._mode; };
  check("plan path: Edit opens the real plan on Rooms, as on a floor with no rooms", open(st) === "rooms", st.maps._mode);
  const reshaped = made();
  reshaped.maps.list.push({ ...real });
  reshaped.model.map_transforms.r1 = { ...st.model.map_transforms.r1 };
  reshaped.model.room_geometry_m.Hall = { ...reshaped.model.room_geometry_m.Hall, points_m: [[6, 1], [10, 1], [10, 4.5], [6, 4.5]], committed_by: "correction" };
  check("plan path: a reshaped box is a room: the plan's floor has rooms, Edit opens on Radios as before",
    ST.planRoomed(reshaped, real) === true && open(reshaped) === "receivers" && JSON.stringify(Object.keys(ST.planRooms(reshaped))) === '["Hall"]');
  check("plan path: the boxes are rooms everywhere else (the house's own record is untouched)", Object.keys(st.model.room_geometry_m).length === 2);
}

// ── "Put it on the map": a traced room takes a box's place, never a reshaped room's ──
{
  const st = made();
  st.model.room_geometry_m.Hall = { ...st.model.room_geometry_m.Hall, points_m: [[6, 1], [9.75, 1], [9.75, 4.5], [6, 4.5]], committed_by: "correction" };
  const { ctx, events } = mkCtx(st);
  const wrote = [];
  ctx.actions.wsCall = async (type, msg) => {
    if (type === "padspan_ha/fabric_truth_candidates") return { fabric: { rooms: st.model.room_geometry_m }, transforms: { rooms: {
      Kitchen: { type: "poly", points_m: [[1, 1], [5, 1], [5, 4], [1, 4]], source_map_id: "r1" },
      Hall: { type: "poly", points_m: [[6, 1], [9, 1], [9, 4], [6, 4]], source_map_id: "r1" } } } };
    wrote.push([type, msg]);
    return { ok: true };
  };
  const traced = { mapId: "r1", floorId: "ground", rooms: ["Kitchen", "Hall"], scanners: [], readable: true, boxes: ST.starterBoxes(st) };
  const plan = WB.planHouse(traced, st.model);
  check("put: a box is missing from the house, a reshaped room isn't", JSON.stringify(plan.rooms) === '["Kitchen"]', plan);
  check("put: without the boxes, nothing is (as before)", WB.planHouse({ ...traced, boxes: undefined }, st.model).rooms.length === 0);
  const out = await WB.buildHouse(ctx, traced, { planPins: () => ({ writes: [] }) });
  check("put: the traced Kitchen replaces its box, under the same name", out.rooms === 1 && out.replaced === 1 && wrote.length === 1
    && wrote[0][1].room === "Kitchen" && wrote[0][1].source_map_id === "r1" && JSON.stringify(wrote[0][1].geometry.points_m) === "[[1,1],[5,1],[5,4],[1,4]]", { out, wrote });
  check("put: counted as a box replaced", events.filter(e => e === "starter_house:replaced").length === 1, events);
}

// ── in German ────────────────────────────────────────────────────────────────
{
  // The shipped German files, served from disk (as tests/js/atlas_sheet_german.mjs does).
  globalThis.fetch = async (url) => {
    const key = new URL(String(url)).pathname.split("/i18n/")[1];
    try { return { ok: true, json: async () => JSON.parse(readFileSync(join(WWW, "i18n", key), "utf-8")) }; }
    catch (_) { return { ok: false, json: async () => ({}) }; }
  };
  const lang = await I18N.useLanguage({ language: "de" }, ["plans", "setup", "mapping"]);
  RP._resetStarter();
  const st = house(), { ctx, calls } = mkCtx(st);
  let root = S.render(ctx);
  const offer = q(root, "offer");
  check("german: the offer", lang === "de" && offer && offer.textContent.includes("Mit einem groben Haus aus deinen Home-Assistant-Räumen beginnen")
    && offer.textContent.includes("Zeigen, was angelegt wird"), offer && offer.textContent);
  q(root, "preview-go").click();
  await tick();
  root = S.render(ctx);
  const text = q(root, "preview").textContent;
  check("german: the preview", text.includes("Ground floor: ein leeres Stockwerk mit 3 Räumen (Kitchen, Hall, Garage)") && text.includes("Upstairs: ein leeres Stockwerk mit 1 Raum (Bedroom)")
    && text.includes("Draußen, ausgelassen: Yard.") && text.includes("Garage hat in Home Assistant kein Stockwerk.") && q(root, "make").textContent === "Grobes Haus anlegen", text);
  q(root, "make").click();
  await tick();
  check("german: the plans' word is German too", ws(calls).slice(-1)[0].label === "grober Anfang", ws(calls).slice(-1)[0]);
  const note2 = RP.starterNote({ ...ctx, state: made() }, made().maps.list[0], { reshape: () => {}, upload: () => {} });
  check("german: the note", note2.textContent.includes("Grober Anfang: 2 Räume auf diesem Stockwerk sind noch Kästen") && q(note2, "reshape").textContent === "Räume umformen"
    && q(note2, "upload").textContent === "Einen Plan dieses Stockwerks hochladen", note2.textContent);
  await I18N.useLanguage({ language: "en" });
}

console.log(JSON.stringify({ cases, failures }));
