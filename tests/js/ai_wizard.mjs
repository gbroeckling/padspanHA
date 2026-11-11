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
  const calls = [], tele = [], shown = [], steps = [];
  W._resetCounts();
  const ans = o.ans || { session: SESS(), areas: ["Kitchen", "Garage"], undo: null, wizard: WIZ };
  const state = {
    dataMode: "live", view: "ai_wizard", kioskMode: !!o.kiosk, _aiwFrom: { view: "setup", surface: "setup" },
    settings: { telemetry_enabled: false, atlas_3d_ai_task_entity: o.chosen || "", ...(o.settings || {}) },
    maps: { list: [{ id: "m1", name: "Main plan", floor_id: "main", image: { width: 1000, height: 800 } }] },
    model: { floors: [{ floor_id: "main", name: "Main", level: 0 }], map_transforms: { m1: { ...T, reference_measurements: [{}] } }, room_geometry_m: {} },
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
  };
  const ctx = {
    hass: { user: { is_admin: true } }, state,
    helpers: { el, esc, helpBtn: () => el("button", {}, "?"), mapImageUrl: () => "/local/plan.png" },
    actions: {
      callWS: (p) => { calls.push(p); const f = server[p.type]; return f ? Promise.resolve(f(p)) : Promise.reject({ code: "unknown_command" }); },
      wsCall: (type, data) => ctx.actions.callWS({ type, ...data }),
      telemetryEvent: (n) => tele.push(n), renderRooms: () => {}, renderNav: () => {},
      showView: (v) => shown.push(v), openSetupStep: (id) => steps.push(id),
    },
  };
  return { ctx, calls, tele, shown, steps };
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
const chipOn = (root) => !!q(root, '[data-aiw="chip"]') && root.textContent.includes("EXPERIMENTAL");

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
  check("undo: the rooms, through the helper", u.length === 1 && u[0].type === "padspan_ha/plan_build_rooms_undo" && u[0].via === "wizard" && u[0].session === "rb_1", u);
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

console.log(JSON.stringify({ cases, failures, texts, fails: Object.keys(W.FAILS) }));
process.exit(0);
