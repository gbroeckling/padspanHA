// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
//
// Let Claude draw your rooms (views/ai_wizard.js, views/ai_wizard_offer.js),
// run for real under the DOM shim with panel.js's own el(), against a fake
// server: each starting state (free with no AI Task, Pro with none, Pro with
// the wrong Claude, Pro with Claude ready, a usable Claude not chosen) reaches
// its screen and its words; the consent is a tick, never silent; the rooms
// check, Save with the Home Assistant tick, Done, Undo; a wall screen gets no
// new-tab link; a stopped read's words; the Overview card and its Not now.
//
// usage: ai_wizard.mjs <www/padspan-ha dir>
// prints one JSON line: { cases: {name: ok}, failures: [...], texts: [...], fails: [...] }

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import * as shim from "./dom_shim.mjs";

const WWW = process.argv[2];
shim.install(globalThis);
// Connect Claude checks again when the page comes back into view (document visibilitychange): caught here to fire it.
const docListeners = {};
document.addEventListener = (t, f) => { (docListeners[t] ||= []).push(f); };
const W = await import(pathToFileURL(join(WWW, "views", "ai_wizard.js")).href);
const O = await import(pathToFileURL(join(WWW, "views", "ai_wizard_offer.js")).href);
const src = readFileSync(join(WWW, "panel.js"), "utf-8").replace(/\r\n/g, "\n");
const elStart = src.indexOf("function el(tag, attrs={}, children=[]){");
const el = new Function("return " + src.slice(elStart, src.indexOf("\n}\n", elStart) + 2).replace(/^function el/, "function"))();
const escStart = src.indexOf("function esc(s){");
const esc = new Function("return " + src.slice(escStart, src.indexOf("\n}\n", escStart) + 2).replace(/^function esc/, "function"))();

const failures = [], cases = {}, texts = [];
const check = (name, ok, detail) => { cases[name] = !!ok; if (!ok) failures.push({ name, detail: detail === undefined ? null : detail }); };
const tick = () => new Promise(r => globalThis._realSetTimeout(r, 0));   // the shim queues setTimeout (the read poll never fires here)

const T = { origin_x_m: 0, origin_y_m: 0, scale_x_m: 10, scale_y_m: 8, rotation_rad: 0 };
const box = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
const PROP = { rooms: {}, openings: { "door:1": { id: "door:1" } }, stairs: {}, spaces: {
  "space:a": { id: "space:a", name: "KITCHEN", new: "Kitchen", outline_m: box(1, 1, 4, 4), reads: [1, 2] },
  "space:b": { id: "space:b", name: "DEN", new: "Den", outline_m: box(4, 1, 8, 4), reads: [1] },
  "space:c": { id: "space:c", name: "CL", new: "Closet", outline_m: box(1, 4, 2, 5), reads: [1, 2] } } };
const WIZ = { rows: ["space:a", "space:b", "space:c"], ticked: ["space:a"], small: ["space:c"], outdoor: [], dropped: [],
  m2: { "space:a": 9, "space:b": 12, "space:c": 1 }, sources: { "space:a": "area_exact", "space:b": "printed", "space:c": "printed" } };
const SESS = (extra = {}) => ({ id: "rb_1", rev: 3, status: "done", floor_id: "main", plans: [{ map_id: "m1", t: T }], proposal: PROP, progress: {}, ...extra });

function house(o = {}) {
  const calls = [], tele = [], shown = [], steps = [], stepMaps = [], renders = { n: 0 };
  W._resetCounts();
  const ans = o.ans || { session: SESS(), areas: ["Kitchen", "Garage"], undo: null, wizard: WIZ };
  const state = {
    dataMode: "live", view: "ai_wizard", kioskMode: !!o.kiosk, _aiwFrom: { view: "setup", surface: "setup" },
    settings: { telemetry_enabled: false, atlas_3d_ai_task_entity: o.chosen || "", ...(o.settings || {}) },
    maps: { list: o.maps || [{ id: "m1", name: "Main plan", floor_id: "main", image: { width: 1000, height: 800 } }] },
    model: { floors: o.floors || [{ floor_id: "main", name: "Main", level: 0 }], map_transforms: o.tfs || { m1: { ...T, reference_measurements: [{}] } }, room_geometry_m: o.rooms || {} },
  };
  const server = {
    "padspan_ha/ai_wizard_info": () => ({ reason: "offer", offer: true, wizard: o.wizard || {}, tier: o.tier || "pro", trial_offerable: !!o.trial }),
    "padspan_ha/plan_build_info": () => ({ unlock: o.unlock || { ok: false, why: "no_ai_task" }, master: !!o.master, switch: !!o.master, anthropic: !!o.anthropic,
      on: !!o.master && !!(o.unlock || {}).ok, candidates: o.candidates || [] }),
    "padspan_ha/ai_wizard_mark": () => ({ wizard: o.wizard || {} }),
    "padspan_ha/settings_set": (p) => ({ settings: { ...state.settings, ...p } }),
    "padspan_ha/plan_build_rooms_start": () => ({ session: "rb_1" }),
    "padspan_ha/plan_build_rooms_status": () => o.status ? o.status() : ans,
    "padspan_ha/plan_build_rooms_edit": (p) => (o.edit ? o.edit(p) : ans),
    "padspan_ha/plan_build_rooms_commit": (p) => ({ ok: true, saved: p.items, areas: Object.fromEntries((p.ha_areas || []).map(i => [i, "created"])),
      session: SESS({ saved: Object.fromEntries(p.items.map(i => [i, "rb"])) }), undo: { session: "rb_1", items: p.items.length }, areas_list: [], wizard: WIZ }),
    "padspan_ha/plan_build_rooms_undo": () => ({ ok: true, undone: 2, skipped: [] }),
    "padspan_ha/plan_build_rooms_resume": () => ({ session: "rb_1" }),
    "padspan_ha/plan_build_scale_preview": (p) => preview(p, o),
    "padspan_ha/ai_wizard_check_claude": () => o.check || { ok: true },   // the tiny read before anything is measured (2026-11-12)
    "padspan_ha/plan_build_scale_save": (p) => o.scaleSave ? o.scaleSave(p) : ({ ok: true, map_id: p.map_id, floor_id: p.floor_id || "main", across_m: 10, down_m: 8 }),
    "padspan_ha/plan_build_scale_undo": () => o.scaleUndo || { ok: false, code: "nothing_to_undo", message: "nothing" },
    // Claude's reading of a printed measurement (piece 4): nothing found unless a case says what it read.
    // held_only (the measure-first screen): a reading already held when the case says so, else none; never a start.
    "padspan_ha/plan_build_scale_start": (p) => (p.held_only ? (o.held ? { session: "sc_1", reused: true } : { session: null })
      : o.scaleStart ? o.scaleStart(p) : { session: "sc_1" }),
    "padspan_ha/plan_build_scale_status": () => ({ session: o.scaleSess ? o.scaleSess() : { id: "sc_1", status: "done", proposal: { none_found: true, axes: {} } }, running: null }),
  };
  const ctx = {
    hass: { user: { is_admin: true } }, state,
    helpers: { el, esc, helpBtn: () => el("button", {}, "?"), mapImageUrl: () => "/local/plan.png" },
    actions: {
      callWS: (p) => { calls.push(p); const f = server[p.type]; return f ? Promise.resolve(f(p)) : Promise.reject({ code: "unknown_command" }); },
      wsCall: (type, data) => ctx.actions.callWS({ type, ...data }),
      telemetryEvent: (n) => tele.push(n), renderRooms: () => { renders.n++; }, renderNav: () => {},
      showView: (v) => shown.push(v), openSetupStep: (id, mapId) => { steps.push(id); stepMaps.push(mapId); },
    },
  };
  return { ctx, calls, tele, shown, steps, stepMaps, renders };
}

// The server's plan_build_scale_preview, faked: the lengths it knows (and the unit a bare number is read in), the plan's
// size from the two ends on a 1000 x 800 picture.
const LENGTHS = { "13' 9\"": 4.191, "5 m": 5, "206 m": 206, "12": 12, "450": 0.45, "30'-5 1/2\"": 9.2837, "24'-0\"": 7.3152, "31'": 9.4488 };
const ASSUMED = { "12": "metres", "450": "millimetres" };
function preview(p, o) {
  const m = (p.measures || [])[0] || {};
  const out = { sig: "nn", size: [1000, 800], floor_known: o.floorKnown !== false, floors: ["main", "upper"], stop: null };
  if (!m.text) return out;
  const metres = m.text in LENGTHS ? LENGTHS[m.text] : null;
  out.metres = [metres];
  out.assumed = [ASSUMED[m.text] || null];
  if (metres === null) out.invalid = "Type a length such as 4.2 m, 420 cm or 13' 9\".";
  else if (m.p1 && m.p2) {
    const ppm = Math.hypot((m.p2[0] - m.p1[0]) * 1000, (m.p2[1] - m.p1[1]) * 800) / metres;
    Object.assign(out, { across_m: 1000 / ppm, down_m: 800 / ppm, odd: 1000 / ppm > 100 });
  }
  return out;
}

const q = (root, sel) => root.querySelector(sel);
function html(node) { let s = node._html || ""; for (const c of node.children || []) s += html(c); return s; }
async function view(h) {
  let root = W.render(h.ctx);
  for (let i = 0; i < 6; i++) { await tick(); root = W.render(h.ctx); }
  texts.push(root.textContent + " " + html(root).replace(/<[^>]*>/g, " "));
  return root;
}
const typesOf = (h) => h.calls.map(c => c.type.replace("padspan_ha/", ""));
/** Typing in the length field: the input event, then the pause the screen waits for (the shim's queued timers run). */
async function typeIn(len, text) { len.value = text; len.dispatchEvent({ type: "input" }); await shim.flush(); }
const chipOn = (root) => !!q(root, '[data-aiw="chip"]') && root.textContent.includes("EXPERIMENTAL");
/** Draw my rooms on a plan with no scale: the measuring screen (2026-11-12: nothing read unless asked). */
async function readScale(h, root) {
  q(root, '[data-aiw="start"]').click();
  for (let i = 0; i < 4; i++) await tick();
  await view(h);                                                   // the reading screen, its poll queued
  await shim.flush();
  return view(h);
}

// ── (i) free, no AI Task: the trial card ──────────────────────────────────────
{
  // Owner, 2026-11-12: the trial comes after Claude is connected, and its pitch is about drawing rooms here.
  const h0 = house({ tier: "free", trial: true, settings: { pro_has_key: false } });
  const r0 = await view(h0);
  check("free, no Claude yet: Connect Claude first, no trial card", !!q(r0, '[data-aiw="next-connect"]') && !q(r0, '[data-trial="card"]'), r0.textContent.slice(0, 400));
  const h = house({ tier: "free", trial: true, settings: { pro_has_key: false }, unlock: { ok: true, why: "ok" } });
  const root = await view(h);
  const pitch = q(root, '[data-trial="pitch"]');
  check("free: the trial card, not a buy link", !!q(root, '[data-trial="card"]') && !q(root, '[data-trial="buy"]') && !q(root, '[data-aiw="start"]'), root.textContent.slice(0, 400));
  check("free: pitched on drawing rooms, rooms stay after the trial", pitch && pitch.textContent.includes("let Claude draw your rooms now")
    && pitch.textContent.includes("When the trial ends, the rooms you saved stay") && !pitch.textContent.includes("light") && !pitch.textContent.includes("Forensics"), pitch && pitch.textContent);
  check("free: counted on its own surface", h.tele.includes("trial_offer_shown:ai_wizard"), h.tele);
  check("free: chip", chipOn(root));
  check("free: step trial marked", h.calls.some(c => c.type === "padspan_ha/ai_wizard_mark" && c.step === "trial"));
}

// ── (ii) Pro, no AI Task: Connect Claude's numbered steps ─────────────────────
{
  const h = house({});
  let root = await view(h);
  check("pro no ai: next is connect", !!q(root, '[data-aiw="next-connect"]') && !q(root, '[data-aiw="start"]'));
  q(root, '[data-aiw="next-connect"]').click();
  root = await view(h);
  // 2026-11-12: honest about the whole path (it listed 4 steps and left out the account and the credit).
  const steps = q(root, '[data-aiw="connect-steps"]');
  check("pro no ai: what is needed and how long, every step from the account to coming back", steps && steps.children.length === 6
    && root.textContent.includes(W.CONNECT_NEED) && steps.textContent.includes("Sign up or sign in") && steps.textContent.includes("Add credit")
    && steps.textContent.includes("under Billing") && steps.textContent.includes("Create an API key") && steps.textContent.includes("checks again by itself")
    && !/\$\s*\d/.test(root.textContent), root.textContent.slice(0, 700));
  // Coming back to the page (the tab visible again): checked again by itself.
  const n0 = h.calls.filter(c => c.type === "padspan_ha/plan_build_info").length;
  document.visibilityState = "visible";
  (docListeners.visibilitychange || []).forEach(f => f());
  for (let i = 0; i < 4; i++) await tick();
  check("pro no ai: checked again on coming back, with no press", h.calls.filter(c => c.type === "padspan_ha/plan_build_info").length === n0 + 1, n0);
  const con = q(root, '[data-aiw="link-console"]'), gd = q(root, '[data-aiw="link-guide"]'), add = q(root, '[data-aiw="link-ha_add"]');
  check("links: the Console, a new tab", con && con.getAttribute("href") === W.CONSOLE_URL && con.getAttribute("target") === "_blank");
  check("links: the guide", gd && gd.getAttribute("href") === W.GUIDE_URL);
  check("links: add Anthropic in Home Assistant, same window", add && add.getAttribute("href") === W.HA_ADD_PATH && add.getAttribute("target") !== "_blank");
  check("pro no ai: readiness counted", h.tele.includes("ai_wizard_ai:no_ai_task"), h.tele);
  con.click();
  q(root, '[data-aiw="check-again"]').click();
  await tick();
  check("pro no ai: link and check again counted", h.tele.includes("ai_wizard_link:console") && h.tele.includes("ai_wizard_ai:check_again"), h.tele);
  check("pro no ai: chip", chipOn(root));
  q(root, '[data-aiw="back"]').click();
  check("back: left at connect, to where it came from", h.tele.includes("ai_wizard_left:connect") && h.shown.at(-1) === "setup" && h.ctx.state._aiw === null, [h.tele, h.shown]);
  // The integration already in Home Assistant: the steps that make it are skipped.
  const g = house({ anthropic: true });
  let gr = await view(g);
  q(gr, '[data-aiw="next-connect"]').click();
  gr = await view(g);
  const gs = q(gr, '[data-aiw="connect-steps"]');
  check("integration there: two steps left, said, its page linked", gs && gs.children.length === 2 && gr.textContent.includes(W.CONNECT_HAVE)
    && !gs.textContent.includes("Create an API key") && !!q(gr, '[data-aiw="link-ha_anthropic"]') && !q(gr, '[data-aiw="link-ha_add"]'), gr.textContent.slice(0, 500));
}

// ── 2026-11-12: the Anthropic account checked with one tiny read before anything is measured; out of credit said then ──
{
  const h = house({ unlock: { ok: true, why: "ok" }, maps: [{ id: "n1", name: "New plan", floor_id: "main", image: { width: 1000, height: 800 } }], tfs: {}, check: { ok: false, why: "no_credit" } });
  let root = await view(h);
  q(root, '[data-aiw="start"]').click();
  for (let i = 0; i < 6; i++) await tick();
  root = await view(h);
  check("account check: out of credit said before measuring, its ways on", !!q(root, '[data-aiw="fail-no_credit"]') && !q(root, '[data-aiw="measure"]')
    && !!q(root, '[data-aiw="link-console"]') && !!q(root, '[data-aiw="act-resume"]') && h.calls.some(c => c.type === "padspan_ha/ai_wizard_check_claude")
    && !h.calls.some(c => c.type === "padspan_ha/plan_build_scale_start" || c.type === "padspan_ha/plan_build_rooms_start"), root.textContent.slice(0, 400));
  check("account check: said while it runs", W.CHECKING.includes("one tiny read") && W.CHECKING.includes("no plan is sent"));
  h.ctx.state._aiw.screen = "fail";
  const ok = house({ unlock: { ok: true, why: "ok" }, maps: [{ id: "n1", name: "New plan", floor_id: "main", image: { width: 1000, height: 800 } }], tfs: {}, check: { ok: false, why: "error" } });
  let r2 = await view(ok);
  q(r2, '[data-aiw="start"]').click();
  for (let i = 0; i < 6; i++) await tick();
  r2 = await view(ok);
  check("account check: anything but no credit or unreachable goes on", !!q(r2, '[data-aiw="measure"]'), r2.textContent.slice(0, 300));
}

// ── a wall screen: no new tab, the address said ───────────────────────────────
{
  const h = house({ kiosk: true });
  let root = await view(h);
  q(root, '[data-aiw="next-connect"]').click();
  root = await view(h);
  const blank = root.querySelectorAll("a").filter(a => a.getAttribute("target") === "_blank");
  const con = q(root, '[data-aiw="link-console"]');
  check("wall: no new-tab link", blank.length === 0 && con && con.localName === "span" && con.textContent.includes("platform.claude.com"), [blank.length, con && con.textContent]);
}

// ── (iii) Pro, the wrong Claude ───────────────────────────────────────────────
{
  const h = house({ unlock: { ok: false, why: "below_opus_5_5", display: "Claude Sonnet 4.6" }, chosen: "ai_task.c",
    candidates: [{ entity_id: "ai_task.c", ok: false, why: "below_opus_5_5", display: "Claude Sonnet 4.6", chosen: true }] });
  let root = await view(h);
  q(root, '[data-aiw="next-connect"]').click();
  root = await view(h);
  check("wrong ai: says which model and which is needed", root.textContent.includes("Your AI Task uses Claude Sonnet 4.6") && root.textContent.includes("Claude Opus 5.5 or newer"), root.textContent.slice(0, 400));
  const l = q(root, '[data-aiw="link-ha_anthropic"]');
  check("wrong ai: the Anthropic integration", l && l.getAttribute("href") === W.HA_ANTHROPIC_PATH);
  check("wrong ai: counted", h.tele.includes("ai_wizard_ai:below_opus_5_5"));
}

// ── a usable Claude not chosen: one more tick ────────────────────────────────
{
  const h = house({ chosen: "ai_task.old", candidates: [{ entity_id: "ai_task.c", ok: true, why: "ok", display: "Claude Opus 5.5", chosen: false }] });
  const root = await view(h);
  // 2026-11-12: said above Start, no tick (Start chooses it).
  check("unchosen: said, Start chooses it", q(root, '[data-aiw="choose"]')?.textContent === "PadSpan will use Claude Opus 5.5 from Home Assistant as its AI; your earlier AI Task stays as the backup. Photo and stair reading will use it too."
    && q(root, '[data-aiw="start"]').disabled === false, q(root, '[data-aiw="choose"]')?.textContent);
  check("unchosen: the old choice becomes the backup", JSON.stringify(W.chooseClaude({ atlas_3d_ai_task_entity: "ai_task.old" }, "ai_task.c"))
    === JSON.stringify({ atlas_3d_ai_task_entity: "ai_task.c", atlas_3d_ai_task_backup_entity: "ai_task.old" }));
  check("unchosen: a backup already set stays", !("atlas_3d_ai_task_backup_entity" in W.chooseClaude({ atlas_3d_ai_task_entity: "a", atlas_3d_ai_task_backup_entity: "b" }, "c")));
}

// ── (iv) Pro, Claude ready, the Settings switches off: Start is the one consent (owner, 2026-11-12; it was two ticks) ──
{
  const h = house({ unlock: { ok: true, why: "ok", display: "Claude Opus 5.5" } });
  let root = await view(h);
  const start = q(root, '[data-aiw="start"]'), t = root.textContent;
  check("ready: no tick, Start ready, with what is sent, what it costs and that nothing is saved before Save beside it",
    !q(root, '[data-aiw="consent"]') && !root.querySelectorAll("input").some(i => i.getAttribute("type") === "checkbox") && start && start.disabled === false
    && t.includes(W.LEAVES) && t.includes(W.COST) && t.includes(W.SAVED_ONLY) && !t.includes("AI map-building research") && !t.includes("Build from plans")
    && !t.includes("look at again"), t.slice(0, 600));
  start.click();
  for (let i = 0; i < 6; i++) await tick();
  const go = h.calls.find(c => c.type === "padspan_ha/plan_build_rooms_start");
  check("ready: no switch turned on, the read through the helper", !h.calls.some(c => c.type === "padspan_ha/settings_set")
    && go && go.via === "wizard" && go.floor_id === "main" && JSON.stringify(go.map_ids) === '["m1"]', typesOf(h));
  root = await view(h);
  check("ready: reading, may leave", root.textContent.includes("Claude is reading your plan") && root.textContent.includes("You can leave this page"));
  // End-to-end test 2026-11-11: the way back named must be one that is there (Setup's line, which says Carry on while a read is left part-way).
  check("ready: the way back named is Setup's", root.textContent.includes(W.COME_BACK) && root.textContent.includes("open Mapping, then Setup, and press Carry on →")
    && !root.textContent.includes("from the Overview"), root.textContent.slice(0, 400));
  check("ready: chip", chipOn(root));
}

// ── back at the rooms check: ticks, names, the Home Assistant tick, Save, Done, Undo
{
  const h = house({ unlock: { ok: true, why: "ok" }, master: true, wizard: { started: { at: "rooms_check", map_id: "m1", rooms_session: "rb_1" } } });
  let root = await view(h);
  check("check: came back", h.calls.some(c => c.type === "padspan_ha/ai_wizard_mark" && c.what === "came_back"));
  check("check: what Claude found", root.textContent.includes("Claude found 3 rooms. 1 is ticked."), root.textContent.slice(0, 300));
  check("check: the server's ticks", q(root, '[data-aiw="tick-space:a"]').checked === true && q(root, '[data-aiw="tick-space:b"]').checked === false);
  check("check: small spaces left out until shown", !q(root, '[data-aiw="tick-space:c"]') && root.textContent.includes("Small spaces (1)"));
  check("check: chips", q(root, '[data-aiw="chip-space:a"]').textContent === "matches your Home Assistant room"
    && q(root, '[data-aiw="chip-space:b"]').textContent.includes("differently twice"));
  check("check: Also add to Home Assistant only for a room with no area, off", !q(root, '[data-aiw="ha-space:a"]') && q(root, '[data-aiw="ha-space:b"]').checked === false);
  check("check: the line says Undo leaves the area", root.textContent.includes("leaves the area in Home Assistant") && !!q(root, '[data-aiw="link-ha_areas"]'));
  const pic = html(root);
  check("check: two outlines on the plan picture", (pic.match(/<polygon /g) || []).length === 2 && pic.includes('data-id="space:a"'), pic.slice(0, 300));
  check("check: Home Assistant rooms not on the plan", root.textContent.includes("Home Assistant rooms not on this plan: Garage."));
  check("check: chip", chipOn(root));
  const tb = q(root, '[data-aiw="tick-space:b"]'); tb.checked = true; tb.dispatchEvent({ type: "change" });
  const hb = q(root, '[data-aiw="ha-space:b"]'); hb.checked = true; hb.dispatchEvent({ type: "change" });
  root = await view(h);
  // 2026-11-12: "Experimental." moved into the one-line note beside Save (a compact bar on a phone).
check("check: Save says how many", q(root, '[data-aiw="save"]').textContent === "Save 2 rooms" && q(root, '[data-aiw="save-bar"]').textContent.includes("Experimental."));
  q(root, '[data-aiw="save"]').click();
  for (let i = 0; i < 4; i++) await tick();
  const c = h.calls.find(x => x.type === "padspan_ha/plan_build_rooms_commit");
  check("save: rooms only, via the helper, the area asked for", c && c.via === "wizard" && JSON.stringify(c.items) === '["space:a","space:b"]'
    && JSON.stringify(c.ha_areas) === '["space:b"]', c);
  root = await view(h);
  check("done: saved on the floor", root.textContent.includes("✓ 2 rooms saved on Main."), root.textContent.slice(0, 300));
  check("done: the area added is said", root.textContent.includes("Added to Home Assistant's areas: Den."));
  q(root, '[data-aiw="receivers"]').click();
  check("done: the hand-off is Setup's receivers step, on the plan just saved", h.steps.join() === "receivers" && h.stepMaps.join() === "m1"
    && h.calls.some(x => x.what === "step" && x.step === "handoff"), h.stepMaps);
  h.ctx.state._aiw = null;
  // Undo: the rooms, through the helper.
  const h2 = house({ unlock: { ok: true }, master: true, wizard: { started: { at: "saved", map_id: "m1", rooms_session: "rb_1" } },
    ans: { session: SESS({ saved: { "space:a": "rb" } }), areas: [], undo: { session: "rb_1" }, wizard: WIZ } });
  root = await view(h2);
  check("undo: reopened at Done", !!q(root, '[data-aiw="undo"]'), root.textContent.slice(0, 200));
  q(root, '[data-aiw="undo"]').click();
  for (let i = 0; i < 3; i++) await tick();
  const u = h2.calls.filter(x => x.type.includes("undo"));
  check("undo: the rooms first, then the plan's scale, both through the helper", u.length === 2 && u[0].type === "padspan_ha/plan_build_rooms_undo" && u[0].via === "wizard"
    && u[0].session === "rb_1" && u[1].type === "padspan_ha/plan_build_scale_undo" && u[1].map_id === "m1" && u[1].via === "wizard", u);
  root = await view(h2);
  check("undo: said", root.textContent.includes("2 rooms taken back."));
}

// ── a stopped read: out of credit ─────────────────────────────────────────────
{
  const h = house({ unlock: { ok: true }, master: true, wizard: { started: { at: "rooms_read", rooms_session: "rb_1" } },
    ans: { session: SESS({ status: "no_credit", proposal: null }), areas: [], undo: null } });
  const root = await view(h);
  const box = q(root, '[data-aiw="fail-no_credit"]');
  check("no credit: what to tell, where credit is set up", box && box.textContent.includes("out of credit") && box.textContent.includes("under Billing"), root.textContent.slice(0, 300));
  check("no credit: the Console, the guide, Try again", !!q(root, '[data-aiw="link-console"]') && !!q(root, '[data-aiw="link-guide"]') && !!q(root, '[data-aiw="act-resume"]'));
  check("no credit: counted", h.tele.includes("ai_wizard_fail:no_credit"), h.tele);
  q(root, '[data-aiw="act-resume"]').click();
  await tick();
  check("no credit: Try again resumes", h.calls.some(c => c.type === "padspan_ha/plan_build_rooms_resume" && c.via === "wizard"));
}

// ── piece 3: a plan with no scale: measure one thing, then the rooms ─────────
const N1 = [{ id: "n1", name: "New plan", floor_id: "main", image: { width: 1000, height: 800 } }];
const tap = (layer, x, y) => layer.dispatchEvent({ type: "click", clientX: x, clientY: y, stopPropagation() {}, preventDefault() {} });   // the shim's layer is 800 x 600
{
  const h = house({ unlock: { ok: true, why: "ok" }, master: true, maps: N1, tfs: {} });
  let root = await view(h);
  // 2026-11-12: the first step no longer promises Claude reads the measurement "for" the person (most plans are measured by hand).
  check("scale: three steps, the first is the person measuring", root.textContent.includes("Three steps")
    && root.textContent.includes("You measure one length on your plan") && !root.textContent.includes("you check it. That gives the plan its size") && !root.textContent.includes("already set"), root.textContent.slice(0, 400));
  check("scale: the cost line counts the reads, no amount", root.textContent.includes(W.COST_SCALE) && W.COST_SCALE.includes("only if you ask it to"));   // 2026-11-12: no scale read unless asked
  const start = q(root, '[data-aiw="start"]');
  check("scale: the button says what it does", start && start.textContent === "Draw my rooms →", start && start.textContent);
  root = await readScale(h, root);
  // 2026-11-12, measure first: nothing read, so nothing "found"; Claude is asked only by the person (said with its cost).
  check("scale: the measurement at once, Claude only if asked", !root.textContent.includes(W.SCALE_NONE) && !!q(root, '[data-aiw="scale-ask"]') && !q(root, '[data-aiw="scale-again"]'),
    root.textContent.slice(0, 300));
  check("scale: the screen, its words, the chip", !!q(root, '[data-aiw="measure"]') && root.textContent.includes("Click both ends of something you know the length of (a wall, a doorway, the whole house), then type its length. The longer the thing you measure, the more exact your map.") && chipOn(root), root.textContent.slice(0, 300));
  check("scale: no read before the measurement", !h.calls.some(c => c.type === "padspan_ha/plan_build_rooms_start"));
  check("scale: counted as guided, step marked", h.tele.includes("plan_build_scale:guided") && h.calls.some(c => c.what === "step" && c.step === "scale_guided"), h.tele);
  check("scale: no floor question when the plan's floor is the house's", !q(root, '[data-aiw="floor-main"]') && !root.textContent.includes("Which floor"));
  check("scale: Save waits for two ends and a length", q(root, '[data-aiw="scale-save"]').disabled === true);
  tap(q(root, '[data-aiw="measure"]'), 80, 300);
  root = await view(h);
  tap(q(root, '[data-aiw="measure"]'), 480, 300);
  root = await view(h);
  const S = h.ctx.state._aiw;
  check("scale: two taps, two ends", JSON.stringify(S.sc.pts) === "[[0.1,0.5],[0.6,0.5]]", S.sc.pts);
  const pic = html(root);
  check("scale: two markers and a line between them", pic.includes('data-pt="0"') && pic.includes('data-pt="1"') && pic.includes("<line "), pic.slice(0, 200));
  const len = q(root, '[data-aiw="scale-length"]'), said0 = q(root, '[data-aiw="scale-understood"]'), save0 = q(root, '[data-aiw="scale-save"]');
  const r0 = h.renders.n, nPv = () => h.calls.filter(c => c.type === "padspan_ha/plan_build_scale_preview").length, p0 = nPv();
  len.value = "1"; len.dispatchEvent({ type: "input" });
  len.value = "13"; len.dispatchEvent({ type: "input" });
  check("scale: Save waits while the newest length has no answer", save0.disabled === true && nPv() === p0);
  await typeIn(len, "13' 9\"");
  check("scale: typing is asked about once it pauses", nPv() - p0 === 1, nPv() - p0);
  check("scale: typing never rebuilds the field (a phone keyboard stays up)", h.renders.n === r0 && said0.textContent === "= 4.19 m"
    && q(root, '[data-aiw="scale-size"]').textContent.includes("The whole picture, margins and all, will be 8.4 m across") && save0.disabled === false, [h.renders.n - r0, said0.textContent]);
  root = await view(h);
  check("scale: what it understood, as typed", q(root, '[data-aiw="scale-understood"]').textContent === "= 4.19 m", q(root, '[data-aiw="scale-understood"]').textContent);
  // 2026-11-12: said as the picture's size, margins and all (it was "Your plan will be", read as the house's).
  check("scale: the picture's size", root.textContent.includes("The whole picture, margins and all, will be 8.4 m across and 6.7 m down."), root.textContent.slice(0, 600));
  const pvs = h.calls.filter(c => c.type === "padspan_ha/plan_build_scale_preview");
  check("scale: the server works it out from the ends and the text", pvs.length >= 2 && JSON.stringify(pvs.at(-1).measures) === JSON.stringify([{ text: "13' 9\"", p1: [0.1, 0.5], p2: [0.6, 0.5] }]), pvs.at(-1));
  root = await view(h);
  check("scale: typed text and both ends kept through a redraw", q(root, '[data-aiw="scale-length"]').value === "13' 9\"" && S.sc.pts.length === 2);
  tap(q(root, '[data-aiw="measure"]'), 560, 300);
  check("scale: a third tap moves the nearer end", JSON.stringify(S.sc.pts) === "[[0.1,0.5],[0.7,0.5]]", S.sc.pts);
  root = await view(h);
  const layer = q(root, '[data-aiw="measure"]'), n0 = h.calls.length;
  layer.dispatchEvent({ type: "pointerdown", target: { getAttribute: (k) => (k === "data-pt" ? "0" : null) }, pointerId: 1, preventDefault() {} });
  layer.dispatchEvent({ type: "pointermove", clientX: 40, clientY: 300, pointerId: 1 });
  layer.dispatchEvent({ type: "pointerup", pointerId: 1 });
  tap(layer, 40, 300);                                            // the click a drag ends with: not a tap
  check("scale: an end dragged (finger or mouse)", JSON.stringify(S.sc.pts) === "[[0.05,0.5],[0.7,0.5]]" && h.calls.slice(n0).some(c => c.type === "padspan_ha/plan_build_scale_preview"), S.sc.pts);
  root = await view(h);
  const save = q(root, '[data-aiw="scale-save"]');
  check("scale: Save and find the rooms", save && save.disabled === false && save.textContent === "Save and find the rooms →", save && save.textContent);
  save.click();
  for (let i = 0; i < 6; i++) await tick();
  const sv = h.calls.find(c => c.type === "padspan_ha/plan_build_scale_save"), order = typesOf(h).filter(t => t === "plan_build_scale_save" || t === "plan_build_rooms_start");
  check("scale: saved through the helper, the ends and the text only, no scale of its own", sv && sv.map_id === "n1" && sv.sig === "nn" && sv.source === "guided" && sv.via === "wizard"
    && !("floor_id" in sv) && JSON.stringify(sv.measures) === JSON.stringify([{ p1: [0.05, 0.5], p2: [0.7, 0.5], text: "13' 9\"" }]), sv);
  const rs = h.calls.find(c => c.type === "padspan_ha/plan_build_rooms_start");
  check("scale: then straight on to the rooms read", order.join() === "plan_build_scale_save,plan_build_rooms_start" && rs.via === "wizard" && JSON.stringify(rs.map_ids) === '["n1"]', order);
  root = await view(h);
  check("scale: reading", root.textContent.includes("Claude is reading your plan"));
}

// ── piece 3: the floor question only when the plan's floor isn't one of the house's; an odd size is said, not refused ──
{
  const h = house({ unlock: { ok: true, why: "ok" }, master: true, maps: [{ ...N1[0], floor_id: "ground" }], tfs: {}, floorKnown: false,
    floors: [{ floor_id: "main", name: "Main", level: 0 }, { floor_id: "upper", name: "Upper", level: 1 }, { floor_id: "outside", name: "Outside" }] });
  let root = await view(h);
  root = await readScale(h, root);
  check("floor: asked, with the house's indoor floors", root.textContent.includes("Which floor does this plan show?") && !!q(root, '[data-aiw="floor-main"]')
    && !!q(root, '[data-aiw="floor-upper"]') && !q(root, '[data-aiw="floor-outside"]'), root.textContent.slice(0, 500));
  check("floor: the step marked", h.calls.some(c => c.what === "step" && c.step === "floor_pick"));
  tap(q(root, '[data-aiw="measure"]'), 0, 300); root = await view(h);
  tap(q(root, '[data-aiw="measure"]'), 800, 300); root = await view(h);
  const len = q(root, '[data-aiw="scale-length"]');
  await typeIn(len, "206 m");
  root = await view(h);
  const odd = q(root, '[data-aiw="scale-odd"]');
  check("odd: said as a question, never a refusal", odd && odd.textContent.startsWith("That makes your plan 206 m across. Is the number right?"), root.textContent.slice(0, 600));
  check("floor: Save waits for the floor", q(root, '[data-aiw="scale-save"]').disabled === true);
  q(root, '[data-aiw="floor-upper"]').click();
  root = await view(h);
  check("odd: Save is there all the same", q(root, '[data-aiw="scale-save"]').disabled === false);
  q(root, '[data-aiw="scale-save"]').click();
  for (let i = 0; i < 6; i++) await tick();
  const sv = h.calls.find(c => c.type === "padspan_ha/plan_build_scale_save"), rs = h.calls.find(c => c.type === "padspan_ha/plan_build_rooms_start");
  check("floor: sent with the save, and the read is on that floor", sv && sv.floor_id === "upper" && rs && rs.floor_id === "upper", [sv, rs]);
}

// ── review: a bare number says its unit; only the newest answer counts; Save goes on nothing older; a tap after a drag; outside ──
{
  const h = house({ unlock: { ok: true, why: "ok" }, master: true, maps: N1, tfs: {} });
  let root = await view(h);
  root = await readScale(h, root);
  tap(q(root, '[data-aiw="measure"]'), 80, 300); root = await view(h);
  tap(q(root, '[data-aiw="measure"]'), 480, 300); root = await view(h);
  const S = h.ctx.state._aiw, len = q(root, '[data-aiw="scale-length"]'), said = q(root, '[data-aiw="scale-understood"]');
  await typeIn(len, "12");
  check("bare number: the unit it was read in", said.textContent === "= 12.00 m (read as metres)", said.textContent);
  await typeIn(len, "450");
  check("bare number: millimetres said", said.textContent === "= 0.45 m (read as millimetres)", said.textContent);
  await typeIn(len, "5 m");
  check("a unit typed: nothing added", said.textContent === "= 5.00 m", said.textContent);
  const held = [], real = h.ctx.actions.callWS;
  h.ctx.actions.callWS = (p) => (p.type === "padspan_ha/plan_build_scale_preview" ? new Promise(r => held.push(() => r(preview(p, {})))) : real(p));
  await typeIn(len, "206 m");
  await typeIn(len, "13' 9\"");
  held[1]();
  for (let i = 0; i < 4; i++) await tick();
  held[0]();                                                      // the older answer comes back last
  for (let i = 0; i < 4; i++) await tick();
  check("out of order: the older answer is dropped", held.length === 2 && said.textContent === "= 4.19 m" && S.sc.pvFor[0].text === "13' 9\"", [said.textContent, S.sc.pvFor]);
  h.ctx.actions.callWS = real;
  root = await view(h);
  const save = () => q(root, '[data-aiw="scale-save"]');
  check("fresh: Save ready", save().disabled === false);
  const l2 = q(root, '[data-aiw="scale-length"]');
  l2.value = "5 m"; l2.dispatchEvent({ type: "input" });          // not answered yet
  check("stale: Save waits for the answer", save().disabled === true);
  save().click();
  for (let i = 0; i < 4; i++) await tick();
  check("stale: nothing saved on an older answer", !h.calls.some(c => c.type === "padspan_ha/plan_build_scale_save"));
  await shim.flush();
  check("answered: Save ready again", save().disabled === false);
  const layer = q(root, '[data-aiw="measure"]');
  layer.dispatchEvent({ type: "pointerdown", target: { getAttribute: (k) => (k === "data-pt" ? "0" : null) }, pointerId: 1, preventDefault() {} });
  layer.dispatchEvent({ type: "pointermove", clientX: 120, clientY: 300, pointerId: 1 });
  layer.dispatchEvent({ type: "pointerup", pointerId: 1 });                     // let go off the plan: no click follows
  root = await view(h);
  const l3 = q(root, '[data-aiw="measure"]');
  l3.dispatchEvent({ type: "pointerdown", target: { getAttribute: () => null }, pointerId: 2, preventDefault() {} });
  tap(l3, 560, 300);
  check("a tap after a drag that ended without a click is taken", JSON.stringify(S.sc.pts) === "[[0.15,0.5],[0.7,0.5]]", S.sc.pts);
  await shim.flush();
  root = await view(h);
  q(root, '[data-aiw="scale-save"]').click();
  for (let i = 0; i < 6; i++) await tick();
  const sv = h.calls.find(c => c.type === "padspan_ha/plan_build_scale_save");
  check("save: the ends and the text the newest answer was for", sv && JSON.stringify(sv.measures) === JSON.stringify([{ p1: [0.15, 0.5], p2: [0.7, 0.5], text: "5 m" }]), sv);
  const plans = W.plansOf({ maps: { list: [{ id: "a", floor_id: "__outside__" }, { id: "b", floor_id: "outside" }, { id: "c", floor_id: "main" }] },
    model: { floors: [], map_transforms: {} } });
  const floors = W.indoorFloors({ model: { floors: [{ floor_id: "__outside__" }, { floor_id: "Outside" }, { floor_id: "main" }] } });
  check("outside: one rule for both spellings", plans.map(m => m.id).join() === "c" && floors.map(f => f.id).join() === "main", [plans, floors]);
}

// ── piece 3: a refusal is said and nothing moves on; a plan with a scale skips the step ──
{
  const h = house({ unlock: { ok: true, why: "ok" }, master: true, maps: N1, tfs: {},
    scaleSave: () => ({ ok: false, code: "points_on_plan", message: "Calibration spots are already saved on this plan, so its scale is left as it is." }) });
  let root = await view(h);
  root = await readScale(h, root);
  tap(q(root, '[data-aiw="measure"]'), 80, 300); root = await view(h);
  tap(q(root, '[data-aiw="measure"]'), 480, 300); root = await view(h);
  await typeIn(q(root, '[data-aiw="scale-length"]'), "5 m");
  root = await view(h);
  q(root, '[data-aiw="scale-save"]').click();
  for (let i = 0; i < 4; i++) await tick();
  root = await view(h);
  check("refused: the server's words, still on the screen, no read", root.textContent.includes("left as it is") && !!q(root, '[data-aiw="measure"]')
    && !h.calls.some(c => c.type === "padspan_ha/plan_build_rooms_start"), root.textContent.slice(0, 400));
  const h2 = house({ unlock: { ok: true, why: "ok" }, master: true });
  root = await view(h2);
  check("set already: two steps, said", root.textContent.includes("Two steps") && root.textContent.includes("✓ This plan's scale is already set."));
  q(root, '[data-aiw="start"]').click();
  for (let i = 0; i < 6; i++) await tick();
  check("set already: straight to the read, counted", h2.calls.some(c => c.type === "padspan_ha/plan_build_rooms_start") && !h2.calls.some(c => c.type.includes("plan_build_scale"))
    && h2.tele.includes("plan_build_scale:already_set"), typesOf(h2));
  check("codes: a plan not measured says the scale step", W.codeWords("map_not_placed").includes("Measure one thing on it first"));
}

// ── piece 3: Undo after a scale this helper set; refused when something in metres was added since ──
{
  const ans = { session: SESS({ saved: { "space:a": "rb" } }), areas: [], undo: { session: "rb_1" }, wizard: WIZ };
  const h = house({ unlock: { ok: true }, master: true, wizard: { started: { at: "saved", map_id: "m1", rooms_session: "rb_1" } }, ans, scaleUndo: { ok: true, map_id: "m1" } });
  let root = await view(h);
  q(root, '[data-aiw="undo"]').click();
  for (let i = 0; i < 4; i++) await tick();
  root = await view(h);
  check("undo: the scale taken back too, said", root.textContent.includes("2 rooms taken back.") && root.textContent.includes("the plan has no scale again"), root.textContent.slice(0, 300));
  const h2 = house({ unlock: { ok: true }, master: true, wizard: { started: { at: "saved", map_id: "m1", rooms_session: "rb_1" } }, ans,
    scaleUndo: { ok: false, code: "changed_since", message: "Something was added in metres since the scale was saved, so the scale stays. To change it, use Mapping → Edit → Measure." } });
  root = await view(h2);
  q(root, '[data-aiw="undo"]').click();
  for (let i = 0; i < 4; i++) await tick();
  root = await view(h2);
  const kept = q(root, '[data-aiw="scale-kept"]');
  check("undo: a scale that stays says why and where to change it", kept && kept.textContent.includes("Mapping → Edit → Measure"), root.textContent.slice(0, 300));
}

// ── the scale, measure first (owner, 2026-11-12; it was: Claude reads first, the person checks). Claude reads the scale
// only when asked; a double-checked reading is a quiet "Use it"; one that isn't double-checked is never shown. ──
const READ = (extra = {}) => ({ id: "sc_1", status: "done", map_id: "n1", proposal: {
  axes: { x: { text: "30'-5 1/2\"", save_text: "30'-5 1/2\"", metres: 9.2837, ppm: 86.17, ends_frac: [[0.1, 0.9], [0.9, 0.9]],
               box_frac: [0.08, 0.86, 0.92, 0.94], span_frac: 0.8, state: "single" },
          y: { text: "24'-0\"", save_text: "24'-0\"", metres: 7.3152, ppm: 87.5, ends_frac: [[0.95, 0.1], [0.95, 0.9]],
               box_frac: [0.93, 0.08, 0.98, 0.92], span_frac: 0.8, state: "unconfirmed" } },
  main: "x", other: "y", ppm: 86.8, across_m: 11.52, down_m: 9.22, stretch_pct: 1.5, stretched: false, none_found: false, checked: true, ...extra } });
const paidStarts = (h) => h.calls.filter(c => c.type === "padspan_ha/plan_build_scale_start" && !c.held_only);
async function askClaude(h, root) {
  q(root, '[data-aiw="scale-ask"]').click();
  for (let i = 0; i < 4; i++) await tick();
  await view(h);                                                   // the reading screen, its poll queued
  await shim.flush();
  return view(h);
}
async function useIt(h, root) {
  q(root, '[data-aiw="scale-use"]').click();
  for (let i = 0; i < 4; i++) await tick();
  return view(h);
}
{
  let sess = { id: "sc_1", status: "running", map_id: "n1", proposal: null };
  const h = house({ unlock: { ok: true, why: "ok" }, master: true, maps: N1, tfs: {}, scaleSess: () => sess });
  let root = await view(h);
  root = await readScale(h, root);
  check("measure first: the measuring screen at once, nothing paid for, only a held reading asked after",
    !!q(root, '[data-aiw="measure"]') && paidStarts(h).length === 0 && h.calls.some(c => c.type === "padspan_ha/plan_build_scale_start" && c.held_only === true)
    && !h.calls.some(c => c.type === "padspan_ha/plan_build_scale_status") && h.ctx.state._aiw.screen === "scale", typesOf(h));
  const ask = q(root, '[data-aiw="scale-ask"]');
  check("measure first: asking Claude is the lesser choice, its cost said", ask && ask.textContent === "Ask Claude to look" && !ask.className.includes("primary")
    && root.textContent.includes(W.SCALE_ASK) && !q(root, '[data-aiw="scale-use"]'), root.textContent.slice(0, 500));
  root = await askClaude(h, root);
  check("asked: while Claude reads, its words", root.textContent.includes("Claude is looking for a measurement printed on your plan… (usually under a minute).")
    && root.textContent.includes("You can leave this page") && chipOn(root), root.textContent.slice(0, 300));
  const st = paidStarts(h)[0];
  check("asked: started for the plan, as the helper, counted", st && st.map_id === "n1" && st.via === "wizard" && h.tele.includes("plan_build_scale_taken:asked_claude")
    && !h.calls.some(c => c.type === "padspan_ha/plan_build_rooms_start"), h.tele);
  check("asked: the step marked with the reading's id, to come back to", h.calls.some(c => c.what === "step" && c.step === "scale_read" && c.scale_session === "sc_1" && c.map_id === "n1"));
  sess = READ();
  await shim.flush();
  root = await view(h);
  const t = root.textContent;
  check("double-checked: back on the measuring screen, Use it, quietly", !!q(root, '[data-aiw="measure"]') && q(root, '[data-aiw="scale-use"]')?.textContent === "Use it"
    && t.includes("Claude found 30'-5 1/2\" printed across your plan (9.28 m), and the other way agrees.") && !q(root, '[data-aiw="scale-yes"]')
    && JSON.stringify(h.ctx.state._aiw.sc.pts) === "[]" && !q(root, '[data-aiw="scale-ask"]'), t.slice(0, 500));
  root = await useIt(h, root);
  const S = h.ctx.state._aiw;
  check("use it: its two ends and its length put down, the close-up shown, nothing saved yet", JSON.stringify(S.sc.pts) === "[[0.1,0.9],[0.9,0.9]]"
    && q(root, '[data-aiw="scale-length"]').value === "30'-5 1/2\"" && !!q(root, '[data-aiw="scale-inset"]')
    && !h.calls.some(c => c.type === "padspan_ha/plan_build_scale_save"), [S.sc.pts, q(root, '[data-aiw="scale-length"]').value]);
  check("use it: the whole picture's size said as the picture's", q(root, '[data-aiw="scale-size"]').textContent.includes("The whole picture, margins and all, will be")
    && !q(root, '[data-aiw="scale-differs"]'), q(root, '[data-aiw="scale-size"]').textContent);
  q(root, '[data-aiw="scale-save"]').click();
  for (let i = 0; i < 6; i++) await tick();
  const sv = h.calls.find(c => c.type === "padspan_ha/plan_build_scale_save");
  check("use it: saved as Claude's reading, its session, the ends and the length as printed", sv && sv.source === "plan_dimension" && sv.session === "sc_1" && sv.sig === "nn"
    && sv.via === "wizard" && JSON.stringify(sv.measures) === JSON.stringify([{ p1: [0.1, 0.9], p2: [0.9, 0.9], text: "30'-5 1/2\"" }]) && h.tele.includes("plan_build_scale_taken:used_reading"), sv);
  const order = typesOf(h).filter(x => x === "plan_build_scale_save" || x === "plan_build_rooms_start");
  check("use it: then straight on to the rooms read", order.join() === "plan_build_scale_save,plan_build_rooms_start", order);
}
{
  // A double-checked reading already held for this picture: Use it at once, no new read. An end moved after Use it: the
  // person's own measurement, saved as theirs. The person's line far from Claude's reading: said, never refused.
  const h = house({ unlock: { ok: true, why: "ok" }, master: true, maps: N1, tfs: {}, held: true, scaleSess: () => READ() });
  let root = await view(h);
  root = await readScale(h, root);
  check("held: Use it at once, nothing paid for", !!q(root, '[data-aiw="scale-use"]') && paidStarts(h).length === 0, typesOf(h));
  root = await useIt(h, root);
  tap(q(root, '[data-aiw="measure"]'), 400, 300);                 // moves the nearer end
  for (let i = 0; i < 4; i++) await tick();
  root = await view(h);
  check("held: an end moved, the person's line against Claude's reading said", !!q(root, '[data-aiw="scale-differs"]')
    && q(root, '[data-aiw="scale-differs"]').textContent.startsWith("Claude's reading makes the picture 11.5 m across; your line makes it")
    && q(root, '[data-aiw="scale-save"]').disabled === false, root.textContent.slice(0, 600));
  q(root, '[data-aiw="scale-save"]').click();
  for (let i = 0; i < 6; i++) await tick();
  const sv = h.calls.find(c => c.type === "padspan_ha/plan_build_scale_save");
  check("held: moved after Use it, saved as the person's own", sv && sv.source === "guided" && !("session" in sv) && h.tele.includes("plan_build_scale_taken:measured"), sv);
}
{
  // Not double-checked (stretched, or one way only): never shown, said; no Use it, none of its numbers.
  for (const extra of [{ stretched: true, stretch_pct: 5.8, checked: false }, { other: null, stretch_pct: null, checked: false }]) {
    const h = house({ unlock: { ok: true, why: "ok" }, master: true, maps: N1, tfs: {}, held: true, scaleSess: () => READ(extra) });
    let root = await view(h);
    root = await readScale(h, root);
    check(`unchecked (${extra.other === null ? "one way" : "stretched"}): said, never offered`, root.textContent.includes(W.SCALE_UNCHECKED) && !q(root, '[data-aiw="scale-use"]')
      && !root.textContent.includes("30'-5") && !q(root, '[data-aiw="scale-ask"]') && !!q(root, '[data-aiw="measure"]'), root.textContent.slice(0, 400));
  }
}
{
  // Asked, nothing found / answers not usable: said on the measuring screen; no paid "again" offered.
  for (const [name, s, words] of [["none", { id: "sc_1", status: "done", map_id: "n1", proposal: { none_found: true, axes: {} } }, W.SCALE_NONE],
    ["unusable", { id: "sc_1", status: "failed", error: "bad_answer" }, W.SCALE_UNUSABLE]]) {
    const h = house({ unlock: { ok: true, why: "ok" }, master: true, maps: N1, tfs: {}, scaleSess: () => s });
    let root = await view(h);
    root = await readScale(h, root);
    root = await askClaude(h, root);
    check(`asked, ${name}: said, the measurement, no paid again`, root.textContent.includes(words) && !!q(root, '[data-aiw="measure"]')
      && !q(root, '[data-aiw="scale-ask"]') && !q(root, '[data-aiw="scale-again"]') && paidStarts(h).length === 1, root.textContent.slice(0, 300));
  }
}
{
  const h = house({ unlock: { ok: true, why: "ok" }, master: true, maps: N1, tfs: {}, scaleSess: () => ({ id: "sc_1", status: "no_credit", error: null }) });
  let root = await view(h);
  root = await readScale(h, root);
  root = await askClaude(h, root);
  const box = q(root, '[data-aiw="fail-no_credit"]');
  check("asked, no credit: its words, the Console, the guide, Try again", box && box.textContent.includes("out of credit") && !!q(root, '[data-aiw="link-console"]')
    && !!q(root, '[data-aiw="link-guide"]') && !!q(root, '[data-aiw="act-resume"]'), root.textContent.slice(0, 300));
  q(root, '[data-aiw="act-resume"]').click();
  for (let i = 0; i < 4; i++) await tick();
  check("asked, no credit: Try again reads again (no rooms resume)", paidStarts(h).length === 2 && !h.calls.some(c => c.type === "padspan_ha/plan_build_rooms_resume"));
}
{
  const h = house({ unlock: { ok: true, why: "ok" }, master: true, maps: N1, tfs: {}, scaleStart: () => Promise.reject({ code: "daily_cap" }) });
  let root = await view(h);
  root = await readScale(h, root);
  root = await askClaude(h, root);
  check("asked, daily cap: said, nothing to press", !!q(root, '[data-aiw="fail-daily_cap"]') && !q(root, '[data-aiw^="act-"]'), root.textContent.slice(0, 300));
  const h2 = house({ unlock: { ok: true, why: "ok" }, master: true, maps: N1, tfs: {}, scaleStart: () => Promise.reject({ code: "already_placed" }) });
  root = await view(h2);
  root = await readScale(h2, root);
  root = await askClaude(h2, root);
  check("asked, set already: straight to the rooms, counted", h2.calls.some(c => c.type === "padspan_ha/plan_build_rooms_start") && h2.tele.includes("plan_build_scale:already_set"), typesOf(h2));
}

// ── status → words ───────────────────────────────────────────────────────────
const map = [[{ status: "no_credit" }, "no_credit"], [{ status: "failed", error: "unreachable" }, "unreachable"], [{ status: "failed", error: "no_media" }, "no_media"],
  [{ status: "failed", error: "refusal" }, "refusal"], [{ status: "failed", error: "error" }, "bad_answer"], [{ status: "out_of_time" }, "out_of_time"],
  [{ status: "cancelled", error: "restart" }, "out_of_time"], [{ status: "cancelled", error: "plan_changed" }, "changed_since"], [{ status: "running" }, null], [{ status: "done" }, null]];
for (const [s, want] of map) check(`status: ${s.status}/${s.error || ""}`, W.failOf(s) === want, W.failOf(s));
check("codes: daily cap, backup, changed", W.failOfCode("daily_cap") === "daily_cap" && W.failOfCode("backup_failed") === "backup_failed"
  && W.failOfCode("rev_mismatch") === "changed_since" && W.failOfCode("too_soon") === null);
// 2026-11-12: Connect Claude comes before the trial (it was the trial first for a free install with no Claude).
check("start states", W.introBlock({ tier: "free", trial_offerable: true }, {}) === "connect" && W.introBlock({ tier: "free", trial_offerable: true }, { unlock: { ok: true } }) === "trial"
  && W.introBlock({ tier: "pro" }, {}) === "connect"
  // 2026-11-12: no "consent" block any more (no Settings switch is ticked for the helper): Claude ready is "start", switches or not.
  && W.introBlock({ tier: "pro" }, { unlock: { ok: true } }) === "start" && W.introBlock({ tier: "pro" }, { unlock: { ok: true }, master: true, switch: true }) === "start");
for (const k of Object.keys(W.FAILS)) texts.push(W.FAILS[k].text);

// ── the Overview card ─────────────────────────────────────────────────────────
{
  O._reset();
  const h = house({});
  h.ctx.state.view = "overview";
  O.overviewCard(h.ctx);
  for (let i = 0; i < 3; i++) await tick();
  const card = O.overviewCard(h.ctx);
  check("card: shown with the chip", card && card.textContent.includes("Want Claude to draw the rooms?") && card.textContent.includes("EXPERIMENTAL"));
  O.overviewCard(h.ctx);
  check("card: offered once a page", h.calls.filter(c => c.what === "offered" && c.surface === "overview").length === 1);
  q(card, '[data-aiw="snooze"]').click();
  await tick();
  check("card: Not now is the server's", h.calls.some(c => c.what === "snoozed"));
  texts.push(card.textContent);
  const h2 = house({});
  O._reset();
  O.offerLine(h2.ctx, "setup");
  for (let i = 0; i < 3; i++) await tick();
  const line = O.offerLine(h2.ctx, "setup");
  check("line: Setup asks the pull rule", line && h2.calls.some(c => c.type === "padspan_ha/ai_wizard_info" && c.surface === "pull"));
  q(line, '[data-aiw="try"]').click();
  check("line: opens the helper", h2.shown.at(-1) === "ai_wizard" && h2.calls.some(c => c.what === "opened" && c.surface === "setup"));
  texts.push(line.textContent);
  const h3 = house({});
  h3.ctx.hass.user.is_admin = false;
  O._reset();
  check("not an administrator: nothing asked", O.offerLine(h3.ctx, "setup") === null && h3.calls.length === 0);
}

// ── review 2026-11-10: the tick that chooses Claude keeps the earlier AI Task as the backup ──
{
  const h = house({ chosen: "ai_task.old", candidates: [{ entity_id: "ai_task.c", ok: true, why: "ok", display: "Claude Opus 5.5", chosen: false }] });
  let root = await view(h);
  // 2026-11-12: no tick: Start chooses it, as the line above Start says.
  q(root, '[data-aiw="start"]').click();
  for (let i = 0; i < 6; i++) await tick();
  const set = h.calls.find(c => c.type === "padspan_ha/settings_set");
  check("unchosen: Start keeps the earlier AI Task as the backup, and turns no switch on", set && set.atlas_3d_ai_task_entity === "ai_task.c"
    && set.atlas_3d_ai_task_backup_entity === "ai_task.old" && !("ai_plans_enabled" in set) && !("ai_plan_build_enabled" in set), set);
}

// ── review 2026-11-10: a typed name stays through a redraw, and Save sends the names first ──
{
  const h = house({ unlock: { ok: true, why: "ok" }, master: true, wizard: { started: { at: "rooms_check", map_id: "m1", rooms_session: "rb_1" } } });
  let root = await view(h);
  const n = q(root, '[data-aiw="name-space:a"]');
  n.value = "Scullery"; n.dispatchEvent({ type: "input" });
  check("names: typing asks the server nothing", !h.calls.some(c => c.type === "padspan_ha/plan_build_rooms_edit"));
  const tb = q(root, '[data-aiw="tick-space:b"]'); tb.checked = true; tb.dispatchEvent({ type: "change" });      // any redraw
  root = await view(h);
  check("names: the typed name is still there after a redraw", q(root, '[data-aiw="name-space:a"]').value === "Scullery");
  check("names: its chip and its Home Assistant tick follow the typed name", q(root, '[data-aiw="chip-space:a"]').textContent === "new room, only in PadSpan"
    && !!q(root, '[data-aiw="ha-space:a"]'));
  check("names: the plan's label too", html(root).includes(">Scullery<"));
  q(root, '[data-aiw="save"]').click();
  for (let i = 0; i < 6; i++) await tick();
  const order = h.calls.filter(c => (c.type === "padspan_ha/plan_build_rooms_edit" && c.op === "space") || c.type === "padspan_ha/plan_build_rooms_commit")
    .map(c => c.type.replace("padspan_ha/", ""));
  const e = h.calls.find(c => c.type === "padspan_ha/plan_build_rooms_edit" && c.op === "space");
  check("names: Save sends the changed name, then saves", order.join() === "plan_build_rooms_edit,plan_build_rooms_commit" && e.op === "space" && e.space === "space:a"
    && e.name === "Scullery" && e.via === "wizard", order);
}

// ── review 2026-11-10: nothing usable read: two ways on ──
{
  const none = { session: SESS({ proposal: { rooms: {}, openings: {}, stairs: {}, spaces: {} } }), areas: [], undo: null,
    wizard: { rows: [], ticked: [], small: [], outdoor: [], dropped: [], m2: {}, sources: {} } };
  const h = house({ unlock: { ok: true, why: "ok" }, master: true, wizard: { started: { at: "rooms_check", map_id: "m1", rooms_session: "rb_1" } }, ans: none });
  const root = await view(h);
  check("no rooms: says so, with Read it again and Draw them myself", root.textContent.includes("didn't find rooms it could use")
    && !!q(root, '[data-aiw="none-again"]') && !!q(root, '[data-aiw="none-by-hand"]') && !q(root, '[data-aiw="save"]'), root.textContent.slice(0, 300));
  q(root, '[data-aiw="none-by-hand"]').click();
  check("no rooms: Draw them myself opens Setup's rooms step", h.steps.join() === "rooms");
}

// ── end-to-end test 2026-11-11, defect 1: the person's edits survive Back, reopening and a reload ──
{
  // A fake server that keeps what the helper sends: names through the "space" edit, ticks through the "ticks" edit.
  const kept = { names: {}, picked: null };
  const answer = (id = "rb_1") => ({ session: SESS({ id, picked: id === "rb_1" ? kept.picked : null, proposal: { ...PROP, spaces: Object.fromEntries(
    Object.entries(PROP.spaces).map(([k, v]) => [k, kept.names[k] ? { ...v, new: kept.names[k] } : v])) } }), areas: ["Kitchen", "Garage"], undo: null, wizard: WIZ });
  const edit = (p) => {
    if (p.op === "ticks") { kept.picked = { ticked: p.ticked, ha: p.ha }; return { ok: true }; }
    if (p.op === "space") kept.names[p.space] = p.name;
    return answer();
  };
  const o = { unlock: { ok: true, why: "ok" }, master: true, wizard: { started: { at: "rooms_check", map_id: "m1", rooms_session: "rb_1" } }, status: () => answer(), edit };
  const h = house(o);
  let root = await view(h);
  const na = q(root, '[data-aiw="name-space:a"]'), nb = q(root, '[data-aiw="name-space:b"]');
  na.value = "Scullery"; na.dispatchEvent({ type: "input" }); na.dispatchEvent({ type: "change" });
  nb.value = "Studio"; nb.dispatchEvent({ type: "input" }); nb.dispatchEvent({ type: "change" });
  for (let i = 0; i < 6; i++) await tick();
  root = await view(h);
  const ta = q(root, '[data-aiw="tick-space:a"]'); ta.checked = false; ta.dispatchEvent({ type: "change" });
  root = await view(h);
  const tb = q(root, '[data-aiw="tick-space:b"]'); tb.checked = true; tb.dispatchEvent({ type: "change" });
  root = await view(h);
  const hb = q(root, '[data-aiw="ha-space:b"]'); hb.checked = true; hb.dispatchEvent({ type: "change" });
  for (let i = 0; i < 4; i++) await tick();
  check("edits: a name left is kept on the session at once", kept.names["space:a"] === "Scullery" && kept.names["space:b"] === "Studio"
    && h.calls.filter(c => c.op === "space").every(c => c.via === "wizard"), kept.names);
  check("edits: the ticks and the Home Assistant tick are kept on the session", JSON.stringify(kept.picked) === '{"ticked":["space:b"],"ha":["space:b"]}', kept.picked);
  q(await view(h), '[data-aiw="back"]').click();
  // Opened again (a reload is the same: a new page, a new state), from the server alone.
  for (const how of ["reopened", "reloaded"]) {
    const h2 = house(o);
    root = await view(h2);
    check(`edits: ${how}, the names typed are there`, q(root, '[data-aiw="name-space:a"]').value === "Scullery" && q(root, '[data-aiw="name-space:b"]').value === "Studio",
      [q(root, '[data-aiw="name-space:a"]').value]);
    check(`edits: ${how}, the ticks as left`, q(root, '[data-aiw="tick-space:a"]').checked === false && q(root, '[data-aiw="tick-space:b"]').checked === true
      && q(root, '[data-aiw="ha-space:b"]').checked === true && root.textContent.includes("1 is ticked."), root.textContent.slice(0, 200));
    check(`edits: ${how}, counted`, h2.tele.includes("ai_wizard:edits_back"), h2.tele);
    q(root, '[data-aiw="save"]').click();
    for (let i = 0; i < 6; i++) await tick();
    const c = h2.calls.find(x => x.type === "padspan_ha/plan_build_rooms_commit");
    check(`edits: ${how}, Save sends them as left`, c && JSON.stringify(c.items) === '["space:b"]' && JSON.stringify(c.ha_areas) === '["space:b"]'
      && !h2.calls.some(x => x.op === "space"), c);
  }
  // A new read is a new session: Claude's own ticks, nothing of the old one's.
  const h3 = house({ ...o, status: () => answer("rb_2"), wizard: { started: { at: "rooms_check", map_id: "m1", rooms_session: "rb_2" } } });
  root = await view(h3);
  check("edits: a new read starts from Claude's ticks", q(root, '[data-aiw="tick-space:a"]').checked === true && q(root, '[data-aiw="tick-space:b"]').checked === false
    && !h3.tele.includes("ai_wizard:edits_back"));
}

// ── defect 11: after an undo in Settings → AI (or the helper's), reopening starts where the plan can be chosen ──
{
  const maps = [{ id: "m1", name: "Main plan", floor_id: "main", image: { width: 1000, height: 800 } },
    { id: "m2", name: "Upper plan", floor_id: "upper", image: { width: 1000, height: 800 } }];
  const floors = [{ floor_id: "main", name: "Main", level: 0 }, { floor_id: "upper", name: "Upper", level: 1 }];
  const tfs = { m1: { ...T, reference_measurements: [{}] }, m2: { ...T, reference_measurements: [{}] } };
  const taken = { session: SESS({ saved: {}, batches: ["rbb_1"] }), areas: [], undo: null, wizard: WIZ };
  const started = { finished_day: "2026-11-11", started: { at: "handoff", map_id: "m1", rooms_session: "rb_1" } };
  const h = house({ unlock: { ok: true, why: "ok" }, master: true, maps, floors, tfs, ans: taken, wizard: started });
  const root = await view(h);
  check("taken back: the intro with both plans to choose, not the old check list", !q(root, '[data-aiw="save"]') && !!q(root, '[data-aiw="plan-m1"]')
    && !!q(root, '[data-aiw="plan-m2"]') && !!q(root, '[data-aiw="start"]'), root.textContent.slice(0, 300));
  // The first floor's rooms still there: the next floor is the one picked.
  const h2 = house({ unlock: { ok: true, why: "ok" }, master: true, maps, floors, tfs, ans: taken, rooms: { Kitchen: { floor_id: "main" } }, wizard: started });
  const r2 = await view(h2);
  // Click-through 2026-11-11: a floor that has rooms is listed apart, plainly, never chosen (no second set of rooms on top).
  check("next floor: the plan on the floor with no rooms is picked; the one with rooms is said apart, not choosable",
    h2.ctx.state._aiw.plan.id === "m2" && !q(r2, '[data-aiw="plan-m1"]')
    && q(r2, '[data-aiw="plans-done"]').textContent === "Already has rooms, so not read again here: Main plan (Main). Change those rooms in Mapping.", r2.textContent.slice(0, 500));
  const h4 = house({ unlock: { ok: true, why: "ok" }, master: true, maps, floors, tfs, rooms: { Kitchen: { floor_id: "main" }, Den: { floor_id: "upper" } } });
  const r4 = await view(h4);
  check("every floor with rooms: said, nothing to start", r4.textContent.includes("Every floor with a plan already has rooms.") && !q(r4, '[data-aiw="start"]'), r4.textContent.slice(0, 400));
  check("plans: a floor with rooms after one without", W.plansOf(h2.ctx.state).map(m => m.id).join() === "m2,m1");
  q(r2, '[data-aiw="start"]').click();
  for (let i = 0; i < 6; i++) await tick();
  const rs = h2.calls.find(c => c.type === "padspan_ha/plan_build_rooms_start");
  check("next floor: read on its own floor", rs && rs.floor_id === "upper" && JSON.stringify(rs.map_ids) === '["m2"]', rs);
  // A plan and its floor of the same name are said once.
  const h3 = house({ unlock: { ok: true, why: "ok" }, master: true, tfs, floors: [{ floor_id: "g", name: "Ground Floor", level: 0 }, floors[1]],
    maps: [{ id: "m1", name: "Ground Floor", floor_id: "g", image: { width: 1000, height: 800 } }, maps[1]] });
  const r3 = await view(h3);
  check("plans: Ground Floor (Ground Floor) said once", !r3.textContent.includes("Ground Floor (Ground Floor)") && r3.textContent.includes("Ground Floor")
    && r3.textContent.includes("Upper plan (Upper)"), r3.textContent.slice(0, 500));
}

// ── defect 7: the close look is the box quoted, bounded to the screen ──
for (const [main, other] of [["x", "y"], ["y", "x"]]) {
  const ax = READ({ main, other }).proposal.axes[main];
  // 2026-11-12: the close-up shows once Use it put Claude's double-checked reading down (the check screen is gone).
  const h = house({ unlock: { ok: true, why: "ok" }, master: true, maps: N1, tfs: {}, held: true, scaleSess: () => READ({ main, other }) });
  let root = await view(h);
  root = await useIt(h, await readScale(h, root));
  const win = q(root, '[data-aiw="scale-inset"]'), pic = q(root, '[data-aiw="scale-inset-pic"]');
  const st = String(win && win.getAttribute("style")), [cx, cy, cw, ch] = String(pic && pic.getAttribute("data-crop")).split(",").map(Number);
  const [b0, b1, b2, b3] = [ax.box_frac[0] * 1000, ax.box_frac[1] * 800, ax.box_frac[2] * 1000, ax.box_frac[3] * 800];
  check(`inset ${main}: a window no taller than a third of the screen, scrolling`, st.includes("max-height:min(33vh, 240px)") && st.includes("overflow:auto")
    && st.includes("max-width:100%"), st);
  // Changed 2026-11-12 (real panel: Claude's box can be shorter than the line, so some quoted numbers couldn't be
  // scrolled to): along the line the crop runs from its two ends plus a margin (and the box); round 3's "the box's own
  // length" no longer holds. Across its narrow side the printed numbers beside the line are whole: INSET_ACROSS of its length each way.
  const e = ax.ends_frac.map(p => [p[0] * 1000, p[1] * 800]);
  const tall = Math.abs(e[1][1] - e[0][1]) > Math.abs(e[1][0] - e[0][0]);
  const along = tall ? [e[0][1], e[1][1]] : [e[0][0], e[1][0]], mg = 12 + W.INSET_ACROSS * Math.abs(along[1] - along[0]);
  const lo = Math.min(tall ? b1 : b0, Math.min(...along) - mg), hi = Math.max(tall ? b3 : b2, Math.max(...along) + mg);
  const len = Math.min(tall ? 800 : 1000, hi) - Math.max(0, lo), across = Math.max(12, W.INSET_ACROSS * (hi - lo));
  const [lenSide, wide, boxWide] = tall ? [ch, cw, b2 - b0] : [cw, ch, b3 - b1];
  check(`inset ${main}: the whole line and box quoted, its numbers whole across it`, cx <= b0 && cy <= b1 && cx + cw >= b2 && cy + ch >= b3
    && (tall ? cy <= Math.min(...along) && cy + ch >= Math.max(...along) : cx <= Math.min(...along) && cx + cw >= Math.max(...along))
    && Math.abs(lenSide - len) <= 2 && wide >= boxWide + 2 * across - 2 && wide <= boxWide + 2 * across + 2, [cx, cy, cw, ch, b0, b1, b2, b3, len]);
  const ps = String(pic.getAttribute("style")), zw = Number(/width:([\d.]+)px/.exec(ps)[1]), zh = Number(/height:([\d.]+)px/.exec(ps)[1]);
  const bx = Number(/background-position:-([\d.]+)px/.exec(ps)[1]);
  check(`inset ${main}: enlarged so its short side reads`, Math.abs(Math.min(zw, zh) - W.INSET_PX) < 1 && Math.abs(bx - cx * zw / cw) < 0.005 * bx, ps);   // the crop's numbers are rounded in data-crop
}
// Real panel 2026-11-11: Claude's box down a line can be much shorter than the line (box 315-820 of a line 166-1014): the
// close-up still runs the line's whole length, so every number quoted can be scrolled to.
{
  const short = READ({ main: "y", other: "x" });
  short.proposal.axes.y = { ...short.proposal.axes.y, ends_frac: [[0.95, 0.15], [0.95, 0.95]], box_frac: [0.93, 0.38, 0.98, 0.62] };
  const h = house({ unlock: { ok: true, why: "ok" }, master: true, maps: N1, tfs: {}, held: true, scaleSess: () => short });
  let root = await view(h);
  root = await useIt(h, await readScale(h, root));
  const [cx, cy, cw, ch] = String(q(root, '[data-aiw="scale-inset-pic"]').getAttribute("data-crop")).split(",").map(Number);
  check("inset: a box shorter than its line, the close-up runs the whole line", cy <= 0.15 * 800 && cy + ch >= 0.95 * 800 - 1 && cx <= 930 && cx + cw >= 980, [cx, cy, cw, ch]);
}

// ── defect 10: the guided picture: its room, Tap on a touch screen, pinch, a zoom ──
{
  const realMM = globalThis.matchMedia;
  globalThis.matchMedia = (mq) => ({ matches: mq === "(pointer: coarse)" });
  const h = house({ unlock: { ok: true, why: "ok" }, master: true, maps: N1, tfs: {} });
  let root = await view(h);
  root = await readScale(h, root);
  check("touch: Tap, and pinch said", root.textContent.includes("Tap both ends of something you know the length of") && root.textContent.includes("Pinch with two fingers")
    && root.textContent.includes("Tap the first end on the plan.") && !root.textContent.includes("Click"), root.textContent.slice(0, 400));
  const layer = q(root, '[data-aiw="measure"]');
  check("touch: two fingers pinch and pan, one finger places", String(layer.getAttribute("style")).includes("touch-action:pinch-zoom")
    && !String(layer.getAttribute("style")).includes("touch-action:none"), layer.getAttribute("style"));
  globalThis.matchMedia = realMM;
  check("mouse: Click", W.tapWord() === "Click");
  const col = q(root, '[data-aiw="measure-col"]');
  check("room: the plan takes the width its few fields leave", String(col.getAttribute("style")).includes("flex:1 1 0")
    && String(q(root, '[data-aiw="picture"]').getAttribute("style")).includes("width:min(100%, calc(72vh * 1000 / 800))"), col.getAttribute("style"));
  check("zoom: − off at its smallest", q(root, '[data-aiw="zoom-out"]').disabled === true && q(root, '[data-aiw="zoom-in"]').disabled === false);
  q(root, '[data-aiw="zoom-in"]').click();
  root = await view(h);
  check("zoom: + makes the plan twice as big, in its own window, counted", String(q(root, '[data-aiw="picture"]').getAttribute("style")).includes("width:calc(2 * min(100%")
    && String(q(root, '[data-aiw="measure-view"]').getAttribute("style")).includes("overflow:auto") && h.tele.includes("ai_wizard:zoomed"), h.tele);
  tap(q(root, '[data-aiw="measure"]'), 80, 300); root = await view(h);
  tap(q(root, '[data-aiw="measure"]'), 480, 300); root = await view(h);
  check("zoom: a tap still places an end where it is on the plan", JSON.stringify(h.ctx.state._aiw.sc.pts) === "[[0.1,0.5],[0.6,0.5]]", h.ctx.state._aiw.sc.pts);
}

// ── defect 12: small rooms' names fit; a name given a number says why; one name for the helper ──
{
  const prop = { ...PROP, spaces: { ...PROP.spaces, "space:h": { id: "space:h", name: "HALL", new: "Hall 2", outline_m: box(4, 4, 8, 7), reads: [1, 2] },
    "space:k": { id: "space:k", name: "BEDROOM 2", new: "Bedroom 2", outline_m: box(8, 4, 10, 7), reads: [1, 2] } } };
  const wiz = { ...WIZ, rows: [...WIZ.rows, "space:h", "space:k"], sources: { ...WIZ.sources, "space:h": "printed", "space:k": "printed" } };
  const h = house({ unlock: { ok: true, why: "ok" }, master: true, wizard: { started: { at: "rooms_check", map_id: "m1", rooms_session: "rb_1" } },
    ans: { session: SESS({ proposal: prop }), areas: ["Kitchen"], undo: null, wizard: wiz } });
  let root = await view(h);
  const why = q(root, '[data-aiw="renamed-space:h"]');
  check("renamed: Hall 2 says why", why && why.textContent === 'Another room is already called "Hall", so this one is "Hall 2". Change it if you like.'
    && !q(root, '[data-aiw="renamed-space:k"]'), root.textContent.slice(0, 600));
  q(root, '[data-aiw="small"]').click();
  root = await view(h);
  const pic = html(root), fsOf = (name) => Number((new RegExp(`font-size="(\\d+)"[^>]*>${name}<`).exec(pic) || [])[1]);
  check("labels: a small room's name is smaller, a big one's as before", fsOf("Closet") < 30 && fsOf("Closet") >= 14 && fsOf("Kitchen") === 30, [fsOf("Closet"), fsOf("Kitchen")]);
  const titles = new Function("return " + /const UNLISTED_VIEW_TITLES = (\{[^\n]*\});/.exec(src)[1])();
  // Click-through 2026-11-11: the phone's title bar cut the full name off; a short form of the same name, the card says it whole.
  check("one name: the phone's title bar a short form of the card's", titles.ai_wizard === "Claude draws rooms" && titles.ai_wizard.length <= 18
    && root.textContent.includes("Let Claude draw your rooms"));
}

// ── defect 2: Setup's line says Carry on while a read is left part-way (what the reading screen promises) ──
{
  O._reset();
  const h = house({ wizard: { started: { at: "rooms_read", rooms_session: "rb_1" } } });
  O.offerLine(h.ctx, "setup");
  for (let i = 0; i < 3; i++) await tick();
  const line = O.offerLine(h.ctx, "setup");
  check("line: Carry on for a read left part-way", line && q(line, '[data-aiw="try"]').textContent === "Carry on →" && line.textContent.includes("part-way"), line && line.textContent);
  O._reset();
  const h2 = house({ wizard: { finished_day: "2026-11-11", started: { at: "handoff" } } });
  O.offerLine(h2.ctx, "setup");
  for (let i = 0; i < 3; i++) await tick();
  check("line: Try it otherwise", q(O.offerLine(h2.ctx, "setup"), '[data-aiw="try"]').textContent === "Try it →");
  if (line) texts.push(line.textContent);
  O._reset();
}

// ── review 2026-11-11 of the fixes: names kept as typed, Save and Join wait for them ──
{
  // A server whose edits each move the rev on, and whose name edits can be held back to answer later.
  const mk = () => {
    const st = { rev: 3, names: {}, held: [], commits: [] };
    const answer = () => ({ session: SESS({ rev: st.rev, proposal: { ...PROP, spaces: Object.fromEntries(Object.entries(PROP.spaces)
      .map(([k, v]) => [k, st.names[k] ? { ...v, new: st.names[k] } : v])) } }), areas: ["Kitchen", "Garage"], undo: null,
    wizard: { ...WIZ, sources: { ...WIZ.sources, ...Object.fromEntries(Object.keys(st.names).map(k => [k, "typed"])) } } });
    const edit = (p) => {
      if (p.op === "ticks") return { ok: true };
      if (p.rev !== st.rev) return Promise.reject({ code: "rev_mismatch" });
      const go = () => { st.rev++; if (p.op === "space") { if (p.name) st.names[p.space] = p.name; else delete st.names[p.space]; } return answer(); };
      return p.op === "space" && st.hold ? new Promise(r => st.held.push(() => r(go()))) : go();
    };
    const o = { unlock: { ok: true, why: "ok" }, master: true, wizard: { started: { at: "rooms_check", map_id: "m1", rooms_session: "rb_1" } }, status: answer, edit };
    return { st, o };
  };
  const nameIn = async (root, id, text) => { const n = q(root, `[data-aiw="name-${id}"]`); n.value = text; n.dispatchEvent({ type: "input" }); n.dispatchEvent({ type: "change" }); };
  {
    const { st, o } = mk();
    const h = house(o);
    let root = await view(h);
    st.hold = true;
    await nameIn(root, "space:a", "Scullery");
    q(root, '[data-aiw="save"]').click();
    q(root, '[data-aiw="save"]').click();                         // pressed twice while the name is still being kept
    for (let i = 0; i < 4; i++) await tick();
    check("save twice: nothing committed while the name is kept", !h.calls.some(c => c.type === "padspan_ha/plan_build_rooms_commit") && st.held.length === 1);
    st.hold = false; st.held.shift()();
    for (let i = 0; i < 8; i++) await tick();
    const commits = h.calls.filter(c => c.type === "padspan_ha/plan_build_rooms_commit");
    check("save twice: one press, one commit, on the name's rev", commits.length === 1 && commits[0].rev === 4 && !h.tele.some(t => t.startsWith("ai_wizard_fail:")), [commits, h.tele]);
    const kept = h.calls.find(c => c.op === "space");
    check("names: kept as typed, as a draft (no stop counted)", kept && kept.draft === true && kept.name === "Scullery");
  }
  {
    const { st, o } = mk();
    const h = house(o);
    let root = await view(h);
    st.hold = true;
    await nameIn(root, "space:a", "Scullery");
    h.ctx.state._aiw.sel = new Set(["space:a", "space:b"]);
    root = await view(h);
    q(root, '[data-aiw="join"]').click();                         // at once, the name not kept yet
    for (let i = 0; i < 4; i++) await tick();
    check("join: waits for the name being kept", !h.calls.some(c => c.op === "merge"));
    st.hold = false; st.held.shift()();
    for (let i = 0; i < 8; i++) await tick();
    const m = h.calls.find(c => c.op === "merge");
    check("join: then goes, on the rev after the name", m && m.rev === 4 && !h.ctx.state._aiw.msg, [m, h.ctx.state._aiw.msg]);
  }
  {
    const { st, o } = mk();
    const h = house(o);
    let root = await view(h);
    await nameIn(root, "space:a", "Scullery");
    for (let i = 0; i < 6; i++) await tick();
    root = await view(h);
    check("cleared: the kept name is there first", q(root, '[data-aiw="name-space:a"]').value === "Scullery" && st.names["space:a"] === "Scullery");
    await nameIn(root, "space:a", "");
    for (let i = 0; i < 6; i++) await tick();
    root = await view(h);
    const e = h.calls.filter(c => c.op === "space").at(-1);
    check("cleared: Claude's name again, on screen and on the server", e.name === "" && !("space:a" in st.names)
      && q(root, '[data-aiw="name-space:a"]').value === "Kitchen", [e, q(root, '[data-aiw="name-space:a"]').value]);
    // A redraw that throws while a name is kept leaves Save working.
    const real = h.ctx.actions.renderRooms;
    let once = true;
    h.ctx.actions.renderRooms = () => { if (once) { once = false; throw new Error("redraw"); } return real(); };
    await nameIn(root, "space:b", "Studio");
    for (let i = 0; i < 6; i++) await tick();
    h.ctx.actions.renderRooms = real;
    root = await view(h);
    q(root, '[data-aiw="save"]').click();
    for (let i = 0; i < 8; i++) await tick();
    check("a redraw that threw: Save still goes", h.calls.some(c => c.type === "padspan_ha/plan_build_rooms_commit"));
  }
  {
    // edits_back only when the person lands back on the list.
    const picked = { ticked: ["space:b"], ha: [] };
    for (const [how, sess, undo, list] of [["on the list", SESS({ picked }), null, true], ["at Done", SESS({ picked, saved: { "space:b": "rb" } }), { session: "rb_1" }, false],
      ["taken back", SESS({ picked, saved: {}, batches: ["rbb_1"] }), null, false]]) {
      const h = house({ unlock: { ok: true, why: "ok" }, master: true, wizard: { started: { at: "saved", map_id: "m1", rooms_session: "rb_1" } },
        ans: { session: sess, areas: [], undo, wizard: WIZ } });
      const root = await view(h);
      check(`edits_back: ${how}`, h.tele.includes("ai_wizard:edits_back") === list && !!q(root, '[data-aiw="rows"]') === list, h.tele);
    }
  }
}

// ── review 2026-11-11: the close-up and the zoomed window keep their place through a redraw ──
{
  const h = house({ unlock: { ok: true, why: "ok" }, master: true, maps: N1, tfs: {}, held: true, scaleSess: () => READ() });
  let root = await view(h);
  root = await useIt(h, await readScale(h, root));
  const win = q(root, '[data-aiw="scale-inset"]');
  win.scrollLeft = 300; win.scrollTop = 5; win.dispatchEvent({ type: "scroll" });
  root = W.render(h.ctx);                                         // the 5 s poll's redraw, say
  await Promise.resolve();                                        // put back before the screen is painted: a microtask
  const win2 = q(root, '[data-aiw="scale-inset"]');
  check("inset: kept where it was scrolled through a redraw", win2 !== win && win2.scrollLeft === 300 && win2.scrollTop === 5, [win2.scrollLeft, win2.scrollTop]);
  const g = house({ unlock: { ok: true, why: "ok" }, master: true, maps: N1, tfs: {} });
  root = await view(g);
  root = await readScale(g, root);
  q(root, '[data-aiw="zoom-in"]').click();
  root = await view(g);
  const v = q(root, '[data-aiw="measure-view"]');
  v.scrollLeft = 210; v.scrollTop = 90; v.dispatchEvent({ type: "scroll" });
  root = W.render(g.ctx);
  await Promise.resolve();
  const v2 = q(root, '[data-aiw="measure-view"]');
  check("zoomed window: kept in the same tick (no flicker)", v2 !== v && v2.scrollLeft === 210 && v2.scrollTop === 90, [v2.scrollLeft, v2.scrollTop]);

  // ── touch: a pinch that starts on an end doesn't move it; zoomed in, one finger on the empty plan pans ──
  tap(q(root, '[data-aiw="measure"]'), 80, 300); root = await view(g);
  tap(q(root, '[data-aiw="measure"]'), 480, 300); root = await view(g);
  const S = g.ctx.state._aiw, before = JSON.stringify(S.sc.pts), onEnd = { getAttribute: (k) => (k === "data-pt" ? "0" : null) };
  let layer = q(root, '[data-aiw="measure"]');
  layer.dispatchEvent({ type: "pointerdown", target: onEnd, pointerId: 7, preventDefault() {} });
  layer.dispatchEvent({ type: "pointermove", clientX: 300, clientY: 100, pointerId: 8 });
  check("touch: another finger's move never moves the end", JSON.stringify(S.sc.pts) === before, S.sc.pts);
  layer.dispatchEvent({ type: "pointermove", clientX: 300, clientY: 100, pointerId: 7 });
  layer.dispatchEvent({ type: "pointerdown", target: { getAttribute: () => null }, pointerId: 8, preventDefault() {} });   // the second finger lands: a pinch
  check("touch: a pinch begun on an end puts it back", JSON.stringify(S.sc.pts) === before && S.sc.drag === null, S.sc.pts);
  root = await view(g); layer = q(root, '[data-aiw="measure"]');
  layer.dispatchEvent({ type: "pointerdown", target: onEnd, pointerId: 9, preventDefault() {} });
  layer.dispatchEvent({ type: "pointermove", clientX: 300, clientY: 100, pointerId: 9 });
  layer.dispatchEvent({ type: "pointercancel", pointerId: 9 });   // the browser took the gesture over
  check("touch: a cancelled drag puts the end back", JSON.stringify(S.sc.pts) === before && S.sc.drag === null, S.sc.pts);
  root = await view(g); layer = q(root, '[data-aiw="measure"]');
  const vw = q(root, '[data-aiw="measure-view"]'), n0 = S.sc.pts.length;
  vw.scrollLeft = 100; vw.scrollTop = 50;
  layer.dispatchEvent({ type: "pointerdown", target: { getAttribute: () => null }, pointerId: 10, clientX: 400, clientY: 300, preventDefault() {} });
  layer.dispatchEvent({ type: "pointermove", clientX: 360, clientY: 280, pointerId: 10 });
  layer.dispatchEvent({ type: "pointerup", pointerId: 10 });
  tap(layer, 360, 280);                                           // the click a pan ends with: not a tap
  check("zoomed: one finger on the empty plan pans, and places nothing", vw.scrollLeft === 140 && vw.scrollTop === 70 && JSON.stringify(S.sc.pts) === before
    && S.sc.pts.length === n0, [vw.scrollLeft, vw.scrollTop, S.sc.pts]);
  layer.dispatchEvent({ type: "pointerdown", target: { getAttribute: () => null }, pointerId: 11, clientX: 400, clientY: 300, preventDefault() {} });
  layer.dispatchEvent({ type: "pointerup", pointerId: 11 });
  tap(layer, 400, 300);
  check("zoomed: a tap still places an end", JSON.stringify(S.sc.pts) !== before, S.sc.pts);
}

// ── review 2026-11-11: a measurement of the person's own left is said as that, not "part-way" ──
{
  for (const [at, words, btn] of [["scale_guided", "You started measuring your plan on Main for Claude to draw its rooms", "Carry on →"],
    ["floor_pick", "You were choosing which floor your plan shows", "Carry on →"], ["scale_read", "part-way", "Carry on →"], ["rooms_check", "part-way", "Carry on →"]]) {
    O._reset();
    const h = house({ wizard: { started: { at, floor_id: "main" } } });
    O.offerLine(h.ctx, "setup");
    for (let i = 0; i < 3; i++) await tick();
    const line = O.offerLine(h.ctx, "setup");
    check(`line: ${at}`, line && line.textContent.includes(words) && q(line, '[data-aiw="try"]').textContent === btn
      && (words === "part-way" || !line.textContent.includes("part-way")), line && line.textContent);
  }
  O._reset();
}

// ── click-through 2026-11-11, A: Carry on lands where it was left, and Claude's reading is never paid for twice ──
// (2026-11-12, measure first: coming back to the measuring screen, a reading already held is offered as Use it; nothing is read.)
{
  const h = house({ unlock: { ok: true, why: "ok" }, master: true, maps: N1, tfs: {}, scaleSess: () => READ(),
    wizard: { started: { at: "scale_guided", map_id: "n1", scale_session: "sc_1" } } });
  const root = await view(h);
  check("carry on, measuring: back on the measurement, the reading held offered, nothing read", !!q(root, '[data-aiw="measure"]') && !!q(root, '[data-aiw="scale-use"]')
    && !h.calls.some(c => c.type === "padspan_ha/plan_build_scale_start"), root.textContent.slice(0, 300));
  const h1 = house({ unlock: { ok: true, why: "ok" }, master: true, maps: N1, tfs: {}, wizard: { started: { at: "scale_guided", map_id: "n1" } } });
  const r1 = await view(h1);
  check("carry on, measuring with no reading held: the measurement, nothing paid", !!q(r1, '[data-aiw="measure"]') && paidStarts(h1).length === 0);
  const h2 = house({ unlock: { ok: true, why: "ok" }, master: true, maps: N1, tfs: {}, held: true, scaleSess: () => READ(),
    wizard: { started: { at: "floor_pick", map_id: "n1", scale_session: "sc_1" } } });
  let r2 = await view(h2);
  check("carry on, which floor: the plan chooser, nothing read", !!q(r2, '[data-aiw="start"]') && !q(r2, '[data-aiw="measure"]') && paidStarts(h2).length === 0, r2.textContent.slice(0, 300));
  q(r2, '[data-aiw="start"]').click();
  for (let i = 0; i < 6; i++) await tick();
  r2 = await view(h2);
  check("draw my rooms again: the reading held offered as Use it, no new read", paidStarts(h2).length === 0 && !!q(r2, '[data-aiw="scale-use"]')
    && h2.ctx.state._aiw.screen === "scale", r2.textContent.slice(0, 400));
}

// ── B: a name being typed is kept a moment after typing stops (a reload mid-word keeps it) ──
{
  const kept = [];
  const h = house({ unlock: { ok: true, why: "ok" }, master: true, wizard: { started: { at: "rooms_check", map_id: "m1", rooms_session: "rb_1" } },
    edit: (p) => {
      if (p.op === "space") kept.push(p);
      const spaces = { ...PROP.spaces };
      for (const k of kept) spaces[k.space] = { ...spaces[k.space], new: k.name };
      return { session: SESS({ proposal: { ...PROP, spaces } }), areas: ["Kitchen", "Garage"], undo: null, wizard: WIZ };
    } });
  const root = await view(h);
  const n = q(root, '[data-aiw="name-space:b"]');
  n.value = "Stud"; n.dispatchEvent({ type: "input" });
  n.value = "Studio"; n.dispatchEvent({ type: "input" });
  check("typing: nothing sent while typing", kept.length === 0);
  await shim.flush();                                             // a second with no key pressed
  for (let i = 0; i < 4; i++) await tick();
  check("typing: kept once it stops, the last text only, as a draft", kept.length === 1 && kept[0].name === "Studio" && kept[0].draft === true, kept);
  n.dispatchEvent({ type: "change" });                            // then the field is left: kept already, nothing more
  for (let i = 0; i < 4; i++) await tick();
  check("typing: leaving the field after it was kept sends nothing more", kept.length === 1, kept.length);
}

// ── F: Click or Tap to join; the close-up says it scrolls; a room too small for a name has none on the picture ──
{
  const prop = { ...PROP, spaces: { ...PROP.spaces, "space:e": { id: "space:e", name: "ENS", new: "Ensuite", outline_m: box(8, 4, 8.5, 6), reads: [1, 2] } } };
  const h = house({ unlock: { ok: true, why: "ok" }, master: true, wizard: { started: { at: "rooms_check", map_id: "m1", rooms_session: "rb_1" } },
    ans: { session: SESS({ proposal: prop }), areas: ["Kitchen"], undo: null, wizard: { ...WIZ, rows: [...WIZ.rows, "space:e"] } } });
  const root = await view(h);
  const pic = html(root);
  check("labels: a room too small for a readable name has none on the picture, its outline stays", pic.includes('data-id="space:e"') && !pic.includes(">Ensuite<")
    && pic.includes(">Kitchen<") && !!q(root, '[data-aiw="name-space:e"]'), pic.slice(0, 400));
  check("join: Click with a mouse", root.textContent.includes("Click two rooms on the plan to join them into one"));
  const g = house({ unlock: { ok: true, why: "ok" }, master: true, maps: N1, tfs: {}, held: true, scaleSess: () => READ() });
  let r = await view(g);
  r = await useIt(g, await readScale(g, r));
  check("close-up: says it scrolls when there is more of it", q(r, '[data-aiw="scale-inset-more"]')?.textContent === "Scroll the close-up to see the whole measurement.");
}

// ── round 3, item 1 (real panel): a typed name reverted to Claude's 1.2 s after typing stopped. Events in a browser's
// order: input, the keep timer, then change on that same field. Keeping while in the field never redraws it. ──
{
  const fake = () => {
    const st = { rev: 3, names: {}, held: [], hold: false };
    const answer = () => ({ session: SESS({ rev: st.rev, proposal: { ...PROP, spaces: Object.fromEntries(Object.entries(PROP.spaces)
      .map(([k, v]) => [k, st.names[k] ? { ...v, new: st.names[k] } : v])) } }), areas: ["Kitchen", "Garage"], undo: null,
    wizard: { ...WIZ, sources: { ...WIZ.sources, ...Object.fromEntries(Object.keys(st.names).map(k => [k, "typed"])) } } });
    const edit = (p) => {
      if (p.op === "ticks") return { ok: true };
      if (p.rev !== st.rev) return Promise.reject({ code: "rev_mismatch" });
      const go = () => { st.rev++; if (p.op === "space") { if (p.name) st.names[p.space] = p.name; else delete st.names[p.space]; } return answer(); };
      return st.hold ? new Promise(r => st.held.push(() => r(go()))) : go();
    };
    return { st, o: { unlock: { ok: true, why: "ok" }, master: true, wizard: { started: { at: "rooms_check", map_id: "m1", rooms_session: "rb_1" } }, status: answer, edit } };
  };
  const spaceEdits = (h) => h.calls.filter(c => c.op === "space").map(c => c.name);
  {
    const { o } = fake();
    const h = house(o);
    const root = await view(h);
    const node = q(root, '[data-aiw="name-space:a"]');
    node.value = "Scullery"; node.dispatchEvent({ type: "input" });
    const r0 = h.renders.n;
    await shim.flush();                                             // a second with no key pressed: the keep timer
    for (let i = 0; i < 6; i++) await tick();
    check("typed name: kept while in the field, nothing redrawn", JSON.stringify(spaceEdits(h)) === '["Scullery"]' && h.renders.n === r0, [spaceEdits(h), h.renders.n - r0]);
    node.dispatchEvent({ type: "change" });                         // then left: the change of that same field
    for (let i = 0; i < 6; i++) await tick();
    const after = await view(h);
    check("typed name: leaving it sends no empty name, and it stays", JSON.stringify(spaceEdits(h)) === '["Scullery"]'
      && q(after, '[data-aiw="name-space:a"]').value === "Scullery", [spaceEdits(h), q(after, '[data-aiw="name-space:a"]').value]);
  }
  {
    const { st, o } = fake();
    const h = house(o);
    let root = await view(h);
    const node = q(root, '[data-aiw="name-space:a"]');
    st.hold = true;
    node.value = "Scull"; node.dispatchEvent({ type: "input" });
    await shim.flush();                                             // the draft "Scull" on its way, held
    node.value = ""; node.dispatchEvent({ type: "input" }); node.dispatchEvent({ type: "change" });
    for (let i = 0; i < 4; i++) await tick();
    st.hold = false; while (st.held.length) st.held.shift()();
    for (let i = 0; i < 8; i++) await tick();
    root = await view(h);
    q(root, '[data-aiw="save"]').click();
    for (let i = 0; i < 8; i++) await tick();
    check("cleared while a draft was on its way: the clear goes after it, Claude's name saved", JSON.stringify(spaceEdits(h)) === '["Scull",""]'
      && !("space:a" in st.names) && !!h.calls.find(c => c.type === "padspan_ha/plan_build_rooms_commit"), [spaceEdits(h), st.names]);
  }
  {
    const { o } = fake();
    const h = house(o);
    const root = await view(h);
    const node = q(root, '[data-aiw="name-space:a"]');
    node.value = "Larder"; node.dispatchEvent({ type: "input" });
    q(root, '[data-aiw="back"]').click();                           // left the helper before the timer
    await shim.flush();
    for (let i = 0; i < 4; i++) await tick();
    check("the keep timer after Back does nothing", spaceEdits(h).length === 0, spaceEdits(h));
  }
}

// (Round 3, item 4, "Ask Claude again" on a reading offered again, is gone with the check screen: measure first, 2026-11-12.)

// ── round 3, item 5: Choose another plan from a step Carry on reached; a stored step whose plan is gone ──
{
  const maps = [{ id: "m1", name: "Main plan", floor_id: "main", image: { width: 1000, height: 800 } },
    { id: "m2", name: "Upper plan", floor_id: "upper", image: { width: 1000, height: 800 } }];
  const floors = [{ floor_id: "main", name: "Main", level: 0 }, { floor_id: "upper", name: "Upper", level: 1 }];
  const tfs = { m1: { ...T, reference_measurements: [{}] }, m2: { ...T, reference_measurements: [{}] } };
  const h = house({ unlock: { ok: true, why: "ok" }, master: true, maps, floors, tfs, wizard: { started: { at: "rooms_check", map_id: "m1", rooms_session: "rb_1" } } });
  let root = await view(h);
  check("choose: on the list Carry on reached, a way to the plan chooser", !!q(root, '[data-aiw="rows"]') && !!q(root, '[data-aiw="choose-plan"]'));
  q(root, '[data-aiw="choose-plan"]').click();
  root = await view(h);
  check("choose: the chooser, both plans", !!q(root, '[data-aiw="plan-m1"]') && !!q(root, '[data-aiw="plan-m2"]') && !q(root, '[data-aiw="choose-plan"]')
    && !q(root, '[data-aiw="rows"]'), root.textContent.slice(0, 300));
  // The plan the stored step points at was deleted: cleared, the chooser, said, nothing of it picked up.
  const g = house({ unlock: { ok: true, why: "ok" }, master: true, maps: [maps[1]], floors, tfs, scaleSess: () => READ(),
    wizard: { started: { at: "scale_check", map_id: "m1", scale_session: "sc_1" } } });
  root = await view(g);
  const mk = g.calls.find(c => c.what === "step" && c.step === "intro" && c.map_id === "m2");
  check("gone: the chooser, said, the step moved to the plan that is there", root.textContent.includes("The plan you were working on isn't there any more")
    && !!q(root, '[data-aiw="start"]') && !q(root, '[data-aiw="measure"]') && !g.calls.some(c => c.type === "padspan_ha/plan_build_scale_status")
    && !!mk && root.textContent.includes("Claude will read Upper plan (Upper)."), [root.textContent.slice(0, 300), !!mk]);
  // 2026-11-12: said at the top, above the steps and Start, in words for the one plan left (not "Choose a plan").
  const t = root.textContent, gl = q(root, '[data-aiw="plan-gone"]');
  check("gone: said first, for the one plan left", gl && gl.textContent === "The plan you were working on isn't there any more. Claude will read the plan that is left instead."
    && t.indexOf("isn't there any more") < t.indexOf("Claude will read") && !t.includes("Choose a plan to go on") && !q(root, '[data-aiw="msg"]'), t.slice(0, 400));
  // Setup's line beforehand: nothing to carry on with on a plan that was deleted (it said "You started measuring…").
  O._reset();
  const s = house({ maps: [maps[1]], floors, wizard: { started: { at: "scale_guided", map_id: "m1", floor_id: "main" } } });
  O.offerLine(s.ctx, "setup");
  for (let i = 0; i < 3; i++) await tick();
  const line = O.offerLine(s.ctx, "setup");
  check("gone: Setup's line doesn't say a deleted plan's measuring was started", line && !line.textContent.includes("You started measuring")
    && q(line, '[data-aiw="try"]').textContent === "Try it →", line && line.textContent);
  O._reset();
}

// ── real panel 2026-11-11: the first press on Save from a name field already kept was lost. Browser order: pointerdown on
// Save, change on the field (the name kept), pointerup, click on the Save that was there at pointerdown. ──
{
  const h = house({ unlock: { ok: true, why: "ok" }, master: true, wizard: { started: { at: "rooms_check", map_id: "m1", rooms_session: "rb_1" } } });
  const root = await view(h);
  const save = q(root, '[data-aiw="save"]'), name = q(root, '[data-aiw="name-space:a"]'), r0 = h.renders.n;
  root.dispatchEvent({ type: "pointerdown" });
  name.dispatchEvent({ type: "change" });                          // its name is Claude's, already kept: nothing sent, the list would be drawn again
  for (let i = 0; i < 6; i++) await tick();
  check("press: leaving a name field under a press draws nothing yet", h.renders.n === r0, h.renders.n - r0);
  (docListeners.pointerup || []).forEach(f => f({ type: "pointerup" }));   // let go: heard on the document, wherever it is
  save.click();                                                    // the node that was there at pointerdown
  await shim.flush();
  for (let i = 0; i < 6; i++) await tick();
  check("press: the click reaches Save, then the list is drawn", !!h.calls.find(c => c.type === "padspan_ha/plan_build_rooms_commit") && h.renders.n > r0, typesOf(h));
  // No press (the keyboard's Tab): drawn at once, as before.
  const k = house({ unlock: { ok: true, why: "ok" }, master: true, wizard: { started: { at: "rooms_check", map_id: "m1", rooms_session: "rb_1" } } });
  const kr = await view(k), k0 = k.renders.n;
  q(kr, '[data-aiw="name-space:a"]').dispatchEvent({ type: "change" });
  for (let i = 0; i < 6; i++) await tick();
  check("press: with no press the list is drawn at once", k.renders.n > k0, k.renders.n - k0);
}

// ── round 3, items 8 and 9: a plan with no floor; floors the house doesn't know; one plan named; nothing left ──
{
  const maps = [{ id: "m1", name: "Main plan", floor_id: "main", image: { width: 1000, height: 800 } },
    { id: "c1", name: "Cottage plan", image: { width: 1000, height: 800 } }];
  const tfs = { m1: { ...T, reference_measurements: [{}] }, c1: { ...T, reference_measurements: [{}] } };
  const h = house({ unlock: { ok: true, why: "ok" }, master: true, maps, tfs, rooms: { Kitchen: { floor_id: "main" } } });
  const root = await view(h);
  check("no floor: not taken for main's rooms, chosen, named without an id", h.ctx.state._aiw.plan.id === "c1"
    && root.textContent.includes("Claude will read Cottage plan.") && !root.textContent.includes("Cottage plan (main)"), root.textContent.slice(0, 400));
  check("no floor: has rooms only by its own", W.planRoomed(h.ctx.state, maps[1]) === false
    && W.planRoomed({ ...h.ctx.state, model: { ...h.ctx.state.model, room_geometry_m: { Den: { floor_id: "main", source_map_id: "c1" } } } }, maps[1]) === true);
  const g = house({ unlock: { ok: true, why: "ok" }, master: true, maps: [{ ...maps[1], floor_id: "attic" }], tfs });
  const r2 = await view(g);
  check("unknown floor: the plan's name alone", r2.textContent.includes("Claude will read Cottage plan.") && !r2.textContent.includes("(attic)"), r2.textContent.slice(0, 300));
  const k = house({ unlock: { ok: true, why: "ok" }, master: true, maps: [maps[0]], tfs, rooms: { Kitchen: { floor_id: "main" } } });
  const r3 = await view(k);
  check("nothing left: said, no steps list above it", r3.textContent.includes("Every floor with a plan already has rooms.") && !q(r3, '[data-aiw="steps"]')
    && !q(r3, '[data-aiw="start"]'), r3.textContent.slice(0, 300));
}

// ── 2026-11-12: the check list's shape: what looks right first, what needs a look after it under its heading, each row's
// size, its secondary controls behind its own ⋯, Save in a bar that stays in view ──
{
  const h = house({ unlock: { ok: true, why: "ok" }, master: true, wizard: { started: { at: "rooms_check", map_id: "m1", rooms_session: "rb_1" } } });
  let root = await view(h);
  const list = q(root, '[data-aiw="rows"]'), t = list.textContent, head = q(root, '[data-aiw="unsure-head"]');
  check("shape: sure rows first, the unsure after their heading", head && head.textContent === "Look at this one: Claude saw it differently on its two reads"
    && t.indexOf("Kitchen") < t.indexOf("Look at this one") && t.indexOf("Look at this one") < t.indexOf("differently twice"), t.slice(0, 400));
  check("shape: each row's size", q(root, '[data-aiw="m2-space:a"]')?.textContent === "9 m²" && q(root, '[data-aiw="m2-space:b"]')?.textContent === "12 m²");
  const more = q(root, '[data-aiw="more-space:b"]');
  check("shape: the Home Assistant area behind the row's ⋯, closed, default off", more && String(more.getAttribute("style")).includes("display:none")
    && !!q(more, '[data-aiw="ha-space:b"]') && q(more, '[data-aiw="ha-space:b"]').checked === false && !!q(root, '[data-aiw="toggle-space:b"]')
    && !q(root, '[data-aiw="toggle-space:a"]'), more && more.getAttribute("style"));
  q(root, '[data-aiw="toggle-space:b"]').click();
  root = await view(h);
  check("shape: ⋯ opens it", String(q(root, '[data-aiw="more-space:b"]').getAttribute("style")).includes("display:block"));
  const bar = q(root, '[data-aiw="save-bar"]');
  check("shape: Save in a bar stuck to the bottom of the screen", bar && String(bar.getAttribute("style")).includes("position:sticky") && String(bar.getAttribute("style")).includes("bottom:0")
    && !!q(bar, '[data-aiw="save"]'), bar && bar.getAttribute("style"));
}

// ── 2026-11-12: nothing found: draw them by hand (or another plan) first; reading again the lesser choice, its cost said ──
{
  const maps = [{ id: "m1", name: "Main plan", floor_id: "main", image: { width: 1000, height: 800 } }, { id: "m2", name: "Upper plan", floor_id: "upper", image: { width: 1000, height: 800 } }];
  const none = { session: SESS({ proposal: { rooms: {}, spaces: {}, openings: {}, stairs: {} } }), areas: [], undo: null, wizard: { ...WIZ, rows: [], ticked: [], small: [] } };
  const h = house({ unlock: { ok: true, why: "ok" }, master: true, maps, floors: [{ floor_id: "main", name: "Main", level: 0 }, { floor_id: "upper", name: "Upper", level: 1 }],
    tfs: { m1: { ...T, reference_measurements: [{}] }, m2: { ...T, reference_measurements: [{}] } }, ans: none, wizard: { started: { at: "rooms_check", map_id: "m1", rooms_session: "rb_1" } } });
  const root = await view(h);
  const hand = q(root, '[data-aiw="none-by-hand"]'), again = q(root, '[data-aiw="none-again"]'), other = q(root, '[data-aiw="none-other-plan"]');
  check("nothing found: Draw them myself first, another plan offered, Read it again lesser with its cost", hand && hand.className.includes("primary")
    && again && !again.className.includes("primary") && !!other && root.textContent.includes("usually finds the same: two more reads, charged to your Anthropic account"), root.textContent.slice(0, 400));
}

// ── 2026-11-12: "the scale looks wrong", only on the server's two agreeing signs; Check the scale and The scale is right ──
{
  // Review 2026-11-12: said as a factor in lengths ("about 3 times"), not a percent of unlike factors.
  const SCK = { k: 3.1, signs: ["rooms", "spread"], example: { rooms: { name: "Den", kind: "bedroom", m2: 108.4 }, spread: { m: 57.1 } } };
  const ans = { session: SESS(), areas: ["Kitchen", "Garage"], undo: null, wizard: { ...WIZ, scale_check: SCK } };
  let statusAsked = [];
  const h = house({ unlock: { ok: true, why: "ok" }, master: true, ans, scaleUndo: { ok: true, map_id: "m1" },
    status: () => { statusAsked.push(1); return ans; }, wizard: { started: { at: "rooms_check", map_id: "m1", rooms_session: "rb_1" } } });
  let root = await view(h);
  const n = q(root, '[data-aiw="scale-notice"]');
  check("scale notice: said with its example, two answers, Save still there", n && n.textContent.includes("The scale may be off: the rooms come out about 3 times too big. Den would be 108.4 m², big for a bedroom. The rooms together would reach 57.1 m end to end.")
    && !!q(root, '[data-aiw="scale-check"]') && !!q(root, '[data-aiw="scale-right"]') && q(root, '[data-aiw="save"]').disabled === false, n && n.textContent);
  check("scale notice: counted, with its signs", h.tele.includes("ai_wizard_scale_notice:shown") && h.tele.includes("ai_wizard_scale_sign:rooms") && h.tele.includes("ai_wizard_scale_sign:spread"), h.tele);
  q(root, '[data-aiw="scale-check"]').click();
  for (let i = 0; i < 6; i++) await tick();
  h.ctx.state.model.map_transforms = {};                          // the helper's scale taken back: the plan has none now
  root = await view(h);
  const u = h.calls.find(c => c.type === "padspan_ha/plan_build_scale_undo");
  check("check the scale: the helper's scale taken back, the measuring screen, counted", u && u.map_id === "m1" && u.via === "wizard" && !!q(root, '[data-aiw="measure"]')
    && h.tele.includes("ai_wizard_scale_notice:checked"), typesOf(h));
  tap(q(root, '[data-aiw="measure"]'), 80, 300); root = await view(h);
  tap(q(root, '[data-aiw="measure"]'), 480, 300); root = await view(h);
  await typeIn(q(root, '[data-aiw="scale-length"]'), "5 m");
  root = await view(h);
  const before = statusAsked.length;
  h.ctx.state.model.map_transforms = { m1: { ...T, reference_measurements: [{}] } };
  q(root, '[data-aiw="scale-save"]').click();
  for (let i = 0; i < 8; i++) await tick();
  root = await view(h);
  check("check the scale: saved, then the same rooms back from the same reading, no new read", h.calls.some(c => c.type === "padspan_ha/plan_build_scale_save")
    && statusAsked.length > before && !h.calls.some(c => c.type === "padspan_ha/plan_build_rooms_start") && !!q(root, '[data-aiw="rows"]'), typesOf(h));
  // The scale is right: dismissed for that plan, remembered.
  const g = house({ unlock: { ok: true, why: "ok" }, master: true, ans, wizard: { started: { at: "rooms_check", map_id: "m1", rooms_session: "rb_1" } } });
  let gr = await view(g);
  q(gr, '[data-aiw="scale-right"]').click();
  gr = await view(g);
  check("the scale is right: gone, remembered for the plan, counted", !q(gr, '[data-aiw="scale-notice"]') && g.calls.some(c => c.what === "scale_ok" && c.map_id === "m1")
    && g.tele.includes("ai_wizard_scale_notice:dismissed"), g.tele);
  // Things in metres on the scale: not taken back here; what a correction affects, and Mapping's Measure.
  const k = house({ unlock: { ok: true, why: "ok" }, master: true, ans, scaleUndo: { ok: false, code: "changed_since", message: "x" },
    wizard: { started: { at: "rooms_check", map_id: "m1", rooms_session: "rb_1" } } });
  let kr = await view(k);
  q(kr, '[data-aiw="scale-check"]').click();
  for (let i = 0; i < 4; i++) await tick();
  kr = await view(k);
  check("scale elsewhere: what it affects, Measure in Mapping", kr.textContent.includes(W.SCALE_ELSEWHERE.changed_since) && !!q(kr, '[data-aiw="scale-elsewhere"]')
    && !q(kr, '[data-aiw="measure"]') && k.tele.includes("ai_wizard_scale_notice:elsewhere"), kr.textContent.slice(0, 500));
  q(kr, '[data-aiw="scale-elsewhere"]').click();
  check("scale elsewhere: opens Setup's scale step on this plan", k.steps.at(-1) === "scale" && k.stepMaps.at(-1) === "m1", [k.steps, k.stepMaps]);
  // One sign alone: never shown (the server answers none).
  const one = house({ unlock: { ok: true, why: "ok" }, master: true, wizard: { started: { at: "rooms_check", map_id: "m1", rooms_session: "rb_1" } } });
  check("no notice without the server's answer", !q(await view(one), '[data-aiw="scale-notice"]'));
}
// ── 2026-11-12: after the Done screen's Undo, the next moves (it was Back only); one undo run for here, Setup and Settings ──
{
  const ans = { session: SESS({ saved: { "space:a": "rb" } }), areas: [], undo: { session: "rb_1" }, wizard: WIZ };
  const h = house({ unlock: { ok: true }, master: true, wizard: { started: { at: "saved", map_id: "m1", rooms_session: "rb_1" } }, ans, scaleUndo: { ok: true, map_id: "m1" } });
  let root = await view(h);
  q(root, '[data-aiw="undo"]').click();
  for (let i = 0; i < 4; i++) await tick();
  root = await view(h);
  const again = q(root, '[data-aiw="undone-again"]'), hand = q(root, '[data-aiw="undone-by-hand"]');
  const u = h.calls.filter(c => c.type.endsWith("_undo")).map(c => `${c.type.replace("padspan_ha/", "")}:${c.via}`);
  check("undone: try again or draw them myself", again && again.className.includes("primary") && hand && root.textContent.includes("2 rooms taken back.")
    && u.join() === "plan_build_rooms_undo:wizard,plan_build_scale_undo:wizard", [u, root.textContent.slice(0, 300)]);
  hand.click();
  check("undone: draw them myself opens Setup's rooms step, counted", h.steps.at(-1) === "rooms" && h.tele.includes("ai_wizard:undo_next_by_hand"), [h.steps, h.tele]);
  check("done: says where the later Undo is", W.FAILS && (await view(house({ unlock: { ok: true }, master: true, wizard: { started: { at: "saved", map_id: "m1", rooms_session: "rb_1" } }, ans })))
    .textContent.includes("Later, the same Undo is on Setup's Draw the rooms step and in Settings → AI."));
}
// ── 2026-11-12: "Put my receivers in their rooms" on the Done screen too (Setup's one copy) ──
{
  const ans = { session: SESS({ saved: { "space:a": "rb" } }), areas: [], undo: { session: "rb_1" }, wizard: WIZ };
  const h = house({ unlock: { ok: true }, master: true, wizard: { started: { at: "saved", map_id: "m1", rooms_session: "rb_1" } }, ans,
    rooms: { Kitchen: { floor_id: "main", points_m: [[1, 1], [4, 1], [4, 4], [1, 4]] } } });
  h.ctx.state.model.scanners = { "kitchen-proxy": { room: "Kitchen", floor_id: "main" } };
  const root = await view(h);
  const b = q(root, '[data-setup="receivers-place"]');
  check("done: put my receivers in their rooms, before Place receivers", b && b.textContent === "Put my receivers in their rooms"
    && root.textContent.indexOf("Put my receivers") < root.textContent.indexOf("Place receivers →"), root.textContent.slice(0, 500));
}
// ── review 2026-11-12: the factor in plain words; a printed reading said first ──
check("factor words", [[3.1, "about 3 times"], [1 / 3, "about 3 times"], [2.1, "about twice"], [0.5, "about twice"], [2.54, "about two and a half times"],
  [1.6, "about one and a half times"], [0.3048, "about 3 times"]].every(([k, w]) => W.factorWords(k) === w));
check("printed first", W.scaleNoticeWords({ k: 0.33, example: { printed: { text: "45'", here_m: 4.5 }, rooms: { name: "Room 3", kind: null, m2: 1.3 } } })
  === "The scale may be off: the rooms come out about 3 times too small. Claude read 45' printed on the plan, which this scale makes 4.5 m. Room 3 would be 1.3 m².");
// ── review 2026-11-12, items 2, 3, 11, 15: "Check the scale" is one plan's and one session's, stored on the server ──
{
  // Left mid-measure, then Carry on: back to measuring, whatever reading is held; Save draws the same rooms again, no read.
  const ans = { session: SESS(), areas: ["Kitchen"], undo: null, wizard: WIZ };
  const h = house({ unlock: { ok: true, why: "ok" }, master: true, maps: N1, tfs: {}, ans, held: true, scaleSess: () => READ(),
    wizard: { started: { at: "scale_guided", map_id: "n1", scale_session: "sc_1", rooms_session: "rb_1" }, rescale: { n1: "rb_1" } } });
  let root = await view(h);
  check("carry on a scale check: the measuring screen, its own Save words", !!q(root, '[data-aiw="measure"]') && h.ctx.state._aiw.rescale?.sid === "rb_1"
    && root.textContent.includes(W.SCALE_SAVE_RESCALE) && !root.textContent.includes(W.SCALE_SAVE_SAYS), root.textContent.slice(0, 300));
  root = await useIt(h, root);
  h.ctx.state.model.map_transforms = { n1: { ...T, reference_measurements: [{}] } };
  q(root, '[data-aiw="scale-save"]').click();
  for (let i = 0; i < 8; i++) await tick();
  const st = h.calls.filter(c => c.type === "padspan_ha/plan_build_rooms_status").at(-1);
  check("carry on a scale check: saved, the same session drawn again, no rooms read", !h.calls.some(c => c.type === "padspan_ha/plan_build_rooms_start")
    && st && st.session === "rb_1" && st.reproject === true && h.calls.some(c => c.what === "rescale_done" && c.map_id === "n1"), typesOf(h));
}
{
  // Check the scale on one plan, then another plan: it goes with the first plan; the second is read as any plan is.
  const maps = [{ id: "m1", name: "Main plan", floor_id: "main", image: { width: 1000, height: 800 } }, { id: "m2", name: "Upper plan", floor_id: "upper", image: { width: 1000, height: 800 } }];
  const floors = [{ floor_id: "main", name: "Main", level: 0 }, { floor_id: "upper", name: "Upper", level: 1 }];
  const ans = { session: SESS(), areas: [], undo: null, wizard: { ...WIZ, scale_check: { k: 3, signs: ["rooms", "spread"], example: {} } } };
  const h = house({ unlock: { ok: true, why: "ok" }, master: true, maps, floors, tfs: { m1: { ...T, reference_measurements: [{}] } }, ans, scaleUndo: { ok: true },
    wizard: { started: { at: "rooms_check", map_id: "m1", rooms_session: "rb_1" } } });
  let root = await view(h);
  q(root, '[data-aiw="scale-check"]').click();
  for (let i = 0; i < 6; i++) await tick();
  h.ctx.state.model.map_transforms = {};
  root = await view(h);
  check("scale check: recorded on the server for its plan and session", h.calls.some(c => c.what === "rescale" && c.map_id === "m1" && c.rooms_session === "rb_1"));
  q(root, '[data-aiw="choose-plan"]').click();
  root = await view(h);
  check("another plan: the scale check doesn't go with it", h.ctx.state._aiw.rescale === null);
  q(root, '[data-aiw="plan-m2"]').checked = true; q(root, '[data-aiw="plan-m2"]').dispatchEvent({ type: "change" });
  root = await view(h);
  q(root, '[data-aiw="start"]').click();
  for (let i = 0; i < 6; i++) await tick();
  root = await view(h);
  tap(q(root, '[data-aiw="measure"]'), 80, 300); root = await view(h);
  tap(q(root, '[data-aiw="measure"]'), 480, 300); root = await view(h);
  await typeIn(q(root, '[data-aiw="scale-length"]'), "5 m");
  root = await view(h);
  h.ctx.state.model.map_transforms = { m2: { ...T, reference_measurements: [{}] } };
  const before = h.calls.filter(c => c.type === "padspan_ha/plan_build_rooms_status").length;
  q(root, '[data-aiw="scale-save"]').click();
  for (let i = 0; i < 8; i++) await tick();
  const rs = h.calls.find(c => c.type === "padspan_ha/plan_build_rooms_start");
  check("another plan: its rooms read, the first plan's session not loaded", rs && JSON.stringify(rs.map_ids) === '["m2"]'
    && h.calls.filter(c => c.type === "padspan_ha/plan_build_rooms_status").length === before, typesOf(h));
  // Coming back later to the first plan: its scale check picked up again (the server's record).
  const S = h.ctx.state._aiw;
  S.screen = "intro"; S.plan = maps[0]; S.busy = false;
  root = await view(h);
  q(root, '[data-aiw="start"]').click();
  for (let i = 0; i < 6; i++) await tick();
  check("first plan again: its scale check picked up (no new read later)", h.ctx.state._aiw.rescale?.sid === "rb_1" && h.ctx.state._aiw.screen === "scale", h.ctx.state._aiw.rescale);
}
{
  // Done's Undo uses the server's word for the scale: a scale measured again by hand is left, with no words about it.
  const ans = { session: SESS({ saved: { "space:a": "rb" } }), areas: [], undo: { session: "rb_1", helper: true, scale: "remeasured" }, wizard: WIZ };
  const h = house({ unlock: { ok: true }, master: true, wizard: { started: { at: "saved", map_id: "m1", rooms_session: "rb_1" } }, ans });
  let root = await view(h);
  q(root, '[data-aiw="undo"]').click();
  for (let i = 0; i < 4; i++) await tick();
  root = await view(h);
  check("done undo: the server's scale word, no scale undo for a scale measured again by hand", !h.calls.some(c => c.type === "padspan_ha/plan_build_scale_undo")
    && !q(root, '[data-aiw="scale-kept"]'), typesOf(h));
}
// ── review 2026-11-12, item 14: "later" is a later visit to the view (the panel's _viewVisit), not only a reload ──
{
  O._reset();
  const h = house({});
  h.ctx.state._viewVisit = 3;
  O.stepSeen(h.ctx, "scale"); O.stepSeen(h.ctx, "scale");       // drawn twice in one visit: one mark
  h.ctx.state._viewVisit = 5;                                       // left the view and came back
  O.stepSeen(h.ctx, "scale");
  await tick();
  const pages = h.calls.filter(c => c.what === "step_seen").map(c => c.page);
  check("visit: one mark a visit, another visit another page id", pages.length === 2 && pages[0] !== pages[1] && pages[0].endsWith(":3") && pages[1].endsWith(":5"), pages);
  O._reset();
}
console.log(JSON.stringify({ cases, failures, texts, fails: Object.keys(W.FAILS) }));
process.exit(0);
