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
  const calls = [], tele = [], shown = [], steps = [], renders = { n: 0 };
  W._resetCounts();
  const ans = o.ans || { session: SESS(), areas: ["Kitchen", "Garage"], undo: null, wizard: WIZ };
  const state = {
    dataMode: "live", view: "ai_wizard", kioskMode: !!o.kiosk, _aiwFrom: { view: "setup", surface: "setup" },
    settings: { telemetry_enabled: false, atlas_3d_ai_task_entity: o.chosen || "", ...(o.settings || {}) },
    maps: { list: o.maps || [{ id: "m1", name: "Main plan", floor_id: "main", image: { width: 1000, height: 800 } }] },
    model: { floors: o.floors || [{ floor_id: "main", name: "Main", level: 0 }], map_transforms: o.tfs || { m1: { ...T, reference_measurements: [{}] } }, room_geometry_m: {} },
  };
  const server = {
    "padspan_ha/ai_wizard_info": () => ({ reason: "offer", offer: true, wizard: o.wizard || {}, tier: o.tier || "pro", trial_offerable: !!o.trial }),
    "padspan_ha/plan_build_info": () => ({ unlock: o.unlock || { ok: false, why: "no_ai_task" }, master: !!o.master, switch: !!o.master,
      on: !!o.master && !!(o.unlock || {}).ok, candidates: o.candidates || [] }),
    "padspan_ha/ai_wizard_mark": () => ({ wizard: o.wizard || {} }),
    "padspan_ha/settings_set": (p) => ({ settings: { ...state.settings, ...p } }),
    "padspan_ha/plan_build_rooms_start": () => ({ session: "rb_1" }),
    "padspan_ha/plan_build_rooms_status": () => o.status ? o.status() : ans,
    "padspan_ha/plan_build_rooms_edit": () => ans,
    "padspan_ha/plan_build_rooms_commit": (p) => ({ ok: true, saved: p.items, areas: Object.fromEntries((p.ha_areas || []).map(i => [i, "created"])),
      session: SESS({ saved: Object.fromEntries(p.items.map(i => [i, "rb"])) }), undo: { session: "rb_1", items: p.items.length }, areas_list: [], wizard: WIZ }),
    "padspan_ha/plan_build_rooms_undo": () => ({ ok: true, undone: 2, skipped: [] }),
    "padspan_ha/plan_build_rooms_resume": () => ({ session: "rb_1" }),
    "padspan_ha/plan_build_scale_preview": (p) => preview(p, o),
    "padspan_ha/plan_build_scale_save": (p) => o.scaleSave ? o.scaleSave(p) : ({ ok: true, map_id: p.map_id, floor_id: p.floor_id || "main", across_m: 10, down_m: 8 }),
    "padspan_ha/plan_build_scale_undo": () => o.scaleUndo || { ok: false, code: "nothing_to_undo", message: "nothing" },
    // Claude's reading of a printed measurement (piece 4): nothing found unless a case says what it read.
    "padspan_ha/plan_build_scale_start": (p) => (o.scaleStart ? o.scaleStart(p) : { session: "sc_1" }),
    "padspan_ha/plan_build_scale_status": () => ({ session: o.scaleSess ? o.scaleSess() : { id: "sc_1", status: "done", proposal: { none_found: true, axes: {} } }, running: null }),
  };
  const ctx = {
    hass: { user: { is_admin: true } }, state,
    helpers: { el, esc, helpBtn: () => el("button", {}, "?"), mapImageUrl: () => "/local/plan.png" },
    actions: {
      callWS: (p) => { calls.push(p); const f = server[p.type]; return f ? Promise.resolve(f(p)) : Promise.reject({ code: "unknown_command" }); },
      wsCall: (type, data) => ctx.actions.callWS({ type, ...data }),
      telemetryEvent: (n) => tele.push(n), renderRooms: () => { renders.n++; }, renderNav: () => {},
      showView: (v) => shown.push(v), openSetupStep: (id) => steps.push(id),
    },
  };
  return { ctx, calls, tele, shown, steps, renders };
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
/** Read my plan on a plan with no scale: Claude's reading of a measurement starts, the reading screen shows, its poll runs. */
async function readScale(h, root) {
  q(root, '[data-aiw="start"]').click();
  for (let i = 0; i < 4; i++) await tick();
  await view(h);                                                   // the reading screen, its poll queued
  await shim.flush();
  return view(h);
}

// ── (i) free, no AI Task: the trial card ──────────────────────────────────────
{
  const h = house({ tier: "free", trial: true, settings: { pro_has_key: false } });
  const root = await view(h);
  check("free: the trial card, not a buy link", !!q(root, '[data-trial="card"]') && !q(root, '[data-trial="buy"]') && root.textContent.includes("part of PadSpan Pro. Try it free"), root.textContent.slice(0, 400));
  check("free: rooms stay after the trial", root.textContent.includes("When the trial ends, the rooms you saved stay"));
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
  check("pro no ai: five steps", !!q(root, '[data-aiw="connect-steps"]') && root.textContent.includes("Make sure that account has credit") && root.textContent.includes("under Billing"), root.textContent.slice(0, 500));
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
  check("unchosen: a tick to use it", !!q(root, '[data-aiw="choose"]') && root.textContent.includes("Use Claude Opus 5.5 for PadSpan's AI"));
  check("unchosen: the old choice becomes the backup", JSON.stringify(W.chooseClaude({ atlas_3d_ai_task_entity: "ai_task.old" }, "ai_task.c"))
    === JSON.stringify({ atlas_3d_ai_task_entity: "ai_task.c", atlas_3d_ai_task_backup_entity: "ai_task.old" }));
  check("unchosen: a backup already set stays", !("atlas_3d_ai_task_backup_entity" in W.chooseClaude({ atlas_3d_ai_task_entity: "a", atlas_3d_ai_task_backup_entity: "b" }, "c")));
}

// ── (iv) Pro, Claude ready: the consent is a tick, then the read ──────────────
{
  const h = house({ unlock: { ok: true, why: "ok", display: "Claude Opus 5.5" } });
  let root = await view(h);
  const start = q(root, '[data-aiw="start"]'), t = q(root, '[data-aiw="consent"]');
  check("ready: the consent tick, Start waits for it", t && start && start.disabled === true);
  start.click();
  await tick();
  check("ready: nothing turned on silently", !h.calls.some(c => c.type === "padspan_ha/settings_set"));
  t.checked = true;
  t.dispatchEvent({ type: "change" });
  root = await view(h);
  q(root, '[data-aiw="start"]').click();
  for (let i = 0; i < 6; i++) await tick();
  const set = h.calls.find(c => c.type === "padspan_ha/settings_set"), go = h.calls.find(c => c.type === "padspan_ha/plan_build_rooms_start");
  check("ready: both switches, then the read through the helper", set && set.ai_plans_enabled === true && set.ai_plan_build_enabled === true
    && go && go.via === "wizard" && go.floor_id === "main" && JSON.stringify(go.map_ids) === '["m1"]', typesOf(h));
  check("ready: the switch counted", h.tele.includes("ai_wizard_switch:on"));
  root = await view(h);
  check("ready: reading, may leave", root.textContent.includes("Claude is reading your plan") && root.textContent.includes("You can leave this page"));
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
  check("check: Save says how many", q(root, '[data-aiw="save"]').textContent.includes("Save 2 rooms (experimental)"));
  q(root, '[data-aiw="save"]').click();
  for (let i = 0; i < 4; i++) await tick();
  const c = h.calls.find(x => x.type === "padspan_ha/plan_build_rooms_commit");
  check("save: rooms only, via the helper, the area asked for", c && c.via === "wizard" && JSON.stringify(c.items) === '["space:a","space:b"]'
    && JSON.stringify(c.ha_areas) === '["space:b"]', c);
  root = await view(h);
  check("done: saved on the floor", root.textContent.includes("✓ 2 rooms saved on Main."), root.textContent.slice(0, 300));
  check("done: the area added is said", root.textContent.includes("Added to Home Assistant's areas: Den."));
  q(root, '[data-aiw="receivers"]').click();
  check("done: the hand-off is Setup's receivers step", h.steps.join() === "receivers" && h.calls.some(x => x.what === "step" && x.step === "handoff"));
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
  check("scale: three steps, the first is Claude reading a measurement", root.textContent.includes("Three steps")
    && root.textContent.includes("Claude reads a measurement printed on your plan, and you check it.") && !root.textContent.includes("already set"), root.textContent.slice(0, 400));
  check("scale: the cost line counts the reads, no amount", root.textContent.includes("about five reads for one plan") && !root.textContent.includes("two reads for one plan"));
  const start = q(root, '[data-aiw="start"]');
  check("scale: the button says what comes next", start && start.textContent === "Read my plan →", start && start.textContent);
  root = await readScale(h, root);
  check("scale: nothing printed found: the measurement, with the line that says why", root.textContent.includes(W.SCALE_NONE) && !q(root, '[data-aiw="scale-again"]'),
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
    && q(root, '[data-aiw="scale-size"]').textContent.includes("Your plan will be 8.4 m across") && save0.disabled === false, [h.renders.n - r0, said0.textContent]);
  root = await view(h);
  check("scale: what it understood, as typed", q(root, '[data-aiw="scale-understood"]').textContent === "= 4.19 m", q(root, '[data-aiw="scale-understood"]').textContent);
  check("scale: the plan's size", root.textContent.includes("Your plan will be 8.4 m across and 6.7 m down."), root.textContent.slice(0, 600));
  const pvs = h.calls.filter(c => c.type === "padspan_ha/plan_build_scale_preview");
  check("scale: the server works it out from the ends and the text", pvs.length >= 2 && JSON.stringify(pvs.at(-1).measures) === JSON.stringify([{ text: "13' 9\"", p1: [0.1, 0.5], p2: [0.6, 0.5] }]), pvs.at(-1));
  root = await view(h);
  check("scale: typed text and both ends kept through a redraw", q(root, '[data-aiw="scale-length"]').value === "13' 9\"" && S.sc.pts.length === 2);
  tap(q(root, '[data-aiw="measure"]'), 560, 300);
  check("scale: a third tap moves the nearer end", JSON.stringify(S.sc.pts) === "[[0.1,0.5],[0.7,0.5]]", S.sc.pts);
  root = await view(h);
  const layer = q(root, '[data-aiw="measure"]'), n0 = h.calls.length;
  layer.dispatchEvent({ type: "pointerdown", target: { getAttribute: (k) => (k === "data-pt" ? "0" : null) }, pointerId: 1, preventDefault() {} });
  layer.dispatchEvent({ type: "pointermove", clientX: 40, clientY: 300 });
  layer.dispatchEvent({ type: "pointerup" });
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
  layer.dispatchEvent({ type: "pointermove", clientX: 120, clientY: 300 });
  layer.dispatchEvent({ type: "pointerup" });                     // let go off the plan: no click follows
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

// ── piece 4: Claude reads a measurement printed on the plan, and the person checks it ──
const READ = (extra = {}) => ({ id: "sc_1", status: "done", map_id: "n1", proposal: {
  axes: { x: { text: "30'-5 1/2\"", save_text: "30'-5 1/2\"", metres: 9.2837, ppm: 86.17, ends_frac: [[0.1, 0.9], [0.9, 0.9]],
               box_frac: [0.08, 0.86, 0.92, 0.94], span_frac: 0.8, state: "single" },
          y: { text: "24'-0\"", save_text: "24'-0\"", metres: 7.3152, ppm: 87.5, ends_frac: [[0.95, 0.1], [0.95, 0.9]],
               box_frac: [0.93, 0.08, 0.98, 0.92], span_frac: 0.8, state: "unconfirmed" } },
  main: "x", other: "y", ppm: 86.8, across_m: 11.52, down_m: 9.22, stretch_pct: 1.5, stretched: false, none_found: false, ...extra } });
{
  let sess = { id: "sc_1", status: "running", map_id: "n1", proposal: null };
  const h = house({ unlock: { ok: true, why: "ok" }, master: true, maps: N1, tfs: {}, scaleSess: () => sess });
  let root = await view(h);
  root = await readScale(h, root);
  check("read: while Claude reads, its words", root.textContent.includes("Claude is looking for a measurement printed on your plan… (usually under a minute).")
    && root.textContent.includes("You can leave this page") && chipOn(root), root.textContent.slice(0, 300));
  const st = h.calls.find(c => c.type === "padspan_ha/plan_build_scale_start");
  check("read: started for the plan, as the helper", st && st.map_id === "n1" && st.via === "wizard" && !h.calls.some(c => c.type === "padspan_ha/plan_build_rooms_start"));
  check("read: the step marked with the reading's id, to come back to", h.calls.some(c => c.what === "step" && c.step === "scale_read" && c.scale_session === "sc_1" && c.map_id === "n1"));
  sess = READ();
  await shim.flush();
  root = await view(h);
  const t = root.textContent;
  check("found: what Claude read, where, and the question", t.includes("Claude read 30'-5 1/2\" here, across the whole house (9.28 m). Is that what your plan says?"), t.slice(0, 500));
  check("found: the other direction, ticked", t.includes("and down the side: 24'-0\" (7.32 m) ✓"), t.slice(0, 600));
  const pic = html(root);
  check("found: drawn in amber between the marks found, a close look at the print", pic.includes("<line ") && pic.includes("#f59e0b") && !!q(root, '[data-aiw="scale-inset"]')
    && !!q(root, '[data-aiw="scale-line"]'), pic.slice(0, 200));
  check("found: Yes, No with a field, Measure myself", !!q(root, '[data-aiw="scale-yes"]') && !!q(root, '[data-aiw="scale-no"]') && !!q(root, '[data-aiw="scale-fix"]')
    && !!q(root, '[data-aiw="scale-myself"]') && q(root, '[data-aiw="scale-yes"]').textContent === "Yes, that's right"
    && q(root, '[data-aiw="scale-myself"]').textContent === "Measure something myself instead");
  check("found: the plan's size from what was read, worked out by the server", q(root, '[data-aiw="scale-size"]').textContent.includes("Your plan will be 11.6 m across and 9.3 m down.")
    && h.calls.some(c => c.type === "padspan_ha/plan_build_scale_preview" && c.measures.length === 2 && c.measures[0].text === "30'-5 1/2\""), q(root, '[data-aiw="scale-size"]').textContent);
  check("found: the step marked", h.calls.some(c => c.what === "step" && c.step === "scale_check"));
  check("found: no stretch said when across and down agree", !q(root, '[data-aiw="scale-stretch"]'));
  q(root, '[data-aiw="scale-yes"]').click();
  for (let i = 0; i < 6; i++) await tick();
  const sv = h.calls.find(c => c.type === "padspan_ha/plan_build_scale_save");
  check("yes: saved as read, from the ends found and the lengths as printed, no scale of its own", sv && sv.source === "plan_dimension" && sv.session === "sc_1" && sv.sig === "nn"
    && sv.via === "wizard" && JSON.stringify(sv.measures) === JSON.stringify([{ p1: [0.1, 0.9], p2: [0.9, 0.9], text: "30'-5 1/2\"" }, { p1: [0.95, 0.1], p2: [0.95, 0.9], text: "24'-0\"" }])
    && !("ppm" in sv) && !("scale_x_m" in sv), sv);
  const order = typesOf(h).filter(x => x === "plan_build_scale_save" || x === "plan_build_rooms_start");
  check("yes: then straight on to the rooms read", order.join() === "plan_build_scale_save,plan_build_rooms_start", order);
}

// ── piece 4: a number corrected, said as typed, kept through a redraw; coming back to the check ──
{
  const h = house({ unlock: { ok: true, why: "ok" }, master: true, maps: N1, tfs: {}, scaleSess: () => READ(),
    wizard: { started: { at: "scale_check", map_id: "n1", scale_session: "sc_1" } } });
  let root = await view(h);
  check("back: reopens on the check, the same reading", !!q(root, '[data-aiw="scale-yes"]')
    && h.calls.some(c => c.type === "padspan_ha/plan_build_scale_status" && c.session === "sc_1"), root.textContent.slice(0, 300));
  const fix = q(root, '[data-aiw="scale-fix"]'), said = q(root, '[data-aiw="scale-understood"]'), r0 = h.renders.n;
  await typeIn(fix, "31'");
  check("fix: what was understood, said as typed, the field never rebuilt", said.textContent === "= 9.45 m" && h.renders.n === r0, [said.textContent, h.renders.n - r0]);
  check("fix: the answer is No, drawn in place", q(root, '[data-aiw="scale-no"]').className.includes("primary") && !q(root, '[data-aiw="scale-yes"]').className.includes("primary"));
  const pv = h.calls.filter(c => c.type === "padspan_ha/plan_build_scale_preview").at(-1);
  check("fix: the server asked about the person's number on the ends found", JSON.stringify(pv.measures) === JSON.stringify([{ p1: [0.1, 0.9], p2: [0.9, 0.9], text: "31'" }]), pv.measures);
  root = await view(h);
  check("fix: the typed number and the answer kept through a redraw", q(root, '[data-aiw="scale-fix"]').value === "31'" && h.ctx.state._aiw.sc.answer === "no"
    && q(root, '[data-aiw="scale-understood"]').textContent === "= 9.45 m");
  q(root, '[data-aiw="scale-save"]').click();
  for (let i = 0; i < 6; i++) await tick();
  const sv = h.calls.find(c => c.type === "padspan_ha/plan_build_scale_save");
  check("fix: saved as corrected, the person's number on the ends found", sv && sv.source === "plan_dimension_corrected" && sv.session === "sc_1"
    && JSON.stringify(sv.measures) === JSON.stringify([{ p1: [0.1, 0.9], p2: [0.9, 0.9], text: "31'" }]), sv);
}

// ── piece 4: measure myself instead; stretched; unusable answers; out of credit; the start's refusals ──
{
  const h = house({ unlock: { ok: true, why: "ok" }, master: true, maps: N1, tfs: {}, scaleSess: () => READ({ stretched: true, stretch_pct: 5.8 }) });
  let root = await view(h);
  root = await readScale(h, root);
  const st = q(root, '[data-aiw="scale-stretch"]');
  check("stretch: said as information, Save still there", st && st.textContent === "Across and down disagree by 6 %: the picture may be stretched. The average is used, as Mapping's Measure does."
    && !root.textContent.includes("(7.32 m) ✓") && q(root, '[data-aiw="scale-save"]').disabled === false, root.textContent.slice(0, 600));
  q(root, '[data-aiw="scale-myself"]').click();
  root = await view(h);
  check("myself: the guided measurement, with no line about Claude", !!q(root, '[data-aiw="measure"]') && !root.textContent.includes(W.SCALE_NONE)
    && h.tele.includes("plan_build_scale_check:guided_instead") && h.tele.includes("plan_build_scale:guided"), h.tele);
}
{
  const h = house({ unlock: { ok: true, why: "ok" }, master: true, maps: N1, tfs: {}, scaleSess: () => ({ id: "sc_1", status: "failed", error: "bad_answer" }) });
  let root = await view(h);
  root = await readScale(h, root);
  check("unusable: the measurement, saying why, with Try again", root.textContent.includes(W.SCALE_UNUSABLE) && !!q(root, '[data-aiw="measure"]') && !!q(root, '[data-aiw="scale-again"]'),
    root.textContent.slice(0, 300));
  q(root, '[data-aiw="scale-again"]').click();
  for (let i = 0; i < 4; i++) await tick();
  check("unusable: Try again asks Claude again", h.calls.filter(c => c.type === "padspan_ha/plan_build_scale_start").length === 2);
}
{
  const h = house({ unlock: { ok: true, why: "ok" }, master: true, maps: N1, tfs: {}, scaleSess: () => ({ id: "sc_1", status: "no_credit", error: null }) });
  let root = await view(h);
  root = await readScale(h, root);
  const box = q(root, '[data-aiw="fail-no_credit"]');
  check("read no credit: its words, the Console, the guide, Try again", box && box.textContent.includes("out of credit") && !!q(root, '[data-aiw="link-console"]')
    && !!q(root, '[data-aiw="link-guide"]') && !!q(root, '[data-aiw="act-resume"]'), root.textContent.slice(0, 300));
  q(root, '[data-aiw="act-resume"]').click();
  for (let i = 0; i < 4; i++) await tick();
  check("read no credit: Try again reads again (no rooms resume)", h.calls.filter(c => c.type === "padspan_ha/plan_build_scale_start").length === 2
    && !h.calls.some(c => c.type === "padspan_ha/plan_build_rooms_resume"));
}
{
  const h = house({ unlock: { ok: true, why: "ok" }, master: true, maps: N1, tfs: {}, scaleStart: () => Promise.reject({ code: "daily_cap" }) });
  let root = await view(h);
  root = await readScale(h, root);
  check("read daily cap: said, nothing to press", !!q(root, '[data-aiw="fail-daily_cap"]') && !q(root, '[data-aiw^="act-"]'), root.textContent.slice(0, 300));
  const h2 = house({ unlock: { ok: true, why: "ok" }, master: true, maps: N1, tfs: {}, scaleStart: () => Promise.reject({ code: "already_placed" }) });
  root = await view(h2);
  root = await readScale(h2, root);
  check("read already set: straight to the rooms, counted", h2.calls.some(c => c.type === "padspan_ha/plan_build_rooms_start") && h2.tele.includes("plan_build_scale:already_set"), typesOf(h2));
}

// ── status → words ───────────────────────────────────────────────────────────
const map = [[{ status: "no_credit" }, "no_credit"], [{ status: "failed", error: "unreachable" }, "unreachable"], [{ status: "failed", error: "no_media" }, "no_media"],
  [{ status: "failed", error: "refusal" }, "refusal"], [{ status: "failed", error: "error" }, "bad_answer"], [{ status: "out_of_time" }, "out_of_time"],
  [{ status: "cancelled", error: "restart" }, "out_of_time"], [{ status: "cancelled", error: "plan_changed" }, "changed_since"], [{ status: "running" }, null], [{ status: "done" }, null]];
for (const [s, want] of map) check(`status: ${s.status}/${s.error || ""}`, W.failOf(s) === want, W.failOf(s));
check("codes: daily cap, backup, changed", W.failOfCode("daily_cap") === "daily_cap" && W.failOfCode("backup_failed") === "backup_failed"
  && W.failOfCode("rev_mismatch") === "changed_since" && W.failOfCode("too_soon") === null);
check("start states", W.introBlock({ tier: "free", trial_offerable: true }, {}) === "trial" && W.introBlock({ tier: "pro" }, {}) === "connect"
  && W.introBlock({ tier: "pro" }, { unlock: { ok: true } }) === "consent" && W.introBlock({ tier: "pro" }, { unlock: { ok: true }, master: true, switch: true }) === "start");
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
  for (const k of ["consent", "choose"]) { const t = q(root, `[data-aiw="${k}"]`); if (t) { t.checked = true; t.dispatchEvent({ type: "change" }); root = await view(h); } }
  q(root, '[data-aiw="start"]').click();
  for (let i = 0; i < 6; i++) await tick();
  const set = h.calls.find(c => c.type === "padspan_ha/settings_set");
  check("unchosen: Read my plan keeps the earlier AI Task as the backup", set && set.atlas_3d_ai_task_entity === "ai_task.c" && set.atlas_3d_ai_task_backup_entity === "ai_task.old", set);
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
  const order = typesOf(h).filter(t => t === "plan_build_rooms_edit" || t === "plan_build_rooms_commit");
  const e = h.calls.find(c => c.type === "padspan_ha/plan_build_rooms_edit");
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

console.log(JSON.stringify({ cases, failures, texts, fails: Object.keys(W.FAILS) }));
process.exit(0);
