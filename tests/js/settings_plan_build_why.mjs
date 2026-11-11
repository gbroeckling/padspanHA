// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
//
// Settings → AI with "AI map-building research" on and an AI Task that isn't
// a qualifying Claude: the Build from plans row is hidden, and one muted line
// says why in the rooms helper's words (views/ai_wizard_offer.js, one copy)
// with the guide; on a wall screen no link. Nothing new with the research
// switch off, and nothing with Claude ready (the row itself shows). RUN, not
// read. The pytest wrapper is tests/test_plans_tool_next.py.
//
// Run:  node tests/js/settings_plan_build_why.mjs <repo-root>
import { pathToFileURL } from "node:url";
const ROOT = process.argv[2];
const { install } = await import(pathToFileURL(ROOT + "/tests/js/dom_shim.mjs").href);
install(globalThis);
const SET = await import(pathToFileURL(ROOT + "/custom_components/padspan_ha/www/padspan-ha/views/settings.js").href);
const OFFER = await import(pathToFileURL(ROOT + "/custom_components/padspan_ha/www/padspan-ha/views/ai_wizard_offer.js").href);

const settle = async () => { for (let i = 0; i < 8; i++) await new Promise(r => setImmediate(r)); };
const results = {};
const check = (name, ok, detail) => { results[name] = { ok: !!ok, detail: ok ? undefined : detail }; };

function el(tag, attrs = {}, children = []) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (k === "class") n.className = v; else if (k === "id") n.id = v; else if (k === "style") n.setAttribute("style", v);
    else if (k.startsWith("on") && typeof v === "function") n.addEventListener(k.slice(2), v);
    else if (v !== undefined && v !== null) n.setAttribute(k, String(v));
  }
  if (!Array.isArray(children)) children = [children];
  for (const c of children) { if (c == null) continue; n.appendChild(typeof c === "string" || typeof c === "number" ? document.createTextNode(String(c)) : c); }
  return n;
}
const quiet = () => new Proxy(() => document.createElement("span"), {
  get: (_t, k) => (k === "then" ? undefined : (k === Symbol.toPrimitive || k === "toString") ? () => "" : quiet()),
  apply: () => document.createElement("span"),
});
const all = (n, out = []) => { for (const c of (n.childNodes || n.children || [])) { out.push(c); all(c, out); } return out; };
const text = (n) => (n.textContent || "").replace(/\s+/g, " ").trim();
const tag = (n) => (n.tagName || n.localName || "").toUpperCase();
const has = (n, k) => !!(n.getAttribute && n.getAttribute(k) !== null && n.getAttribute(k) !== undefined);

async function render(settings, info, kiosk = false) {
  const calls = [];
  const s = {
    dataMode: "live", _dataModeKnown: true, complexity: "advanced", view: "settings", _settingsTab: "ai", version: "0", buildId: "b", kioskMode: kiosk,
    settings: { tier: "pro", edition: "full", atlas_3d_ai_task_entity: "ai_task.helper", ...settings }, followedAddrs: new Set(), timing: {}, roomTagMap: {}, wsCounts: {},
    model: { floors: [], areas: [], room_meta: {}, room_geometry_m: {}, map_transforms: {} }, maps: { list: [] },
    live: { snapshot: { ble: { radios: [] }, objects: { list: [], summary: {} }, tags: [] } },
  };
  const actions = {
    wsCall: async (type, p) => { calls.push(type); if (type === "padspan_ha/plan_build_info") return info; return { settings: { ...s.settings, ...p } }; },
    canOpen: () => true,
  };
  const helpers = new Proxy({ el, esc: (x) => String(x ?? ""), helpBtn: () => el("button", {}, "?"), HELP: {} },
    { get: (t, k) => (k in t ? t[k] : quiet()) });
  const ctx = new Proxy({ hass: { states: { "ai_task.helper": { attributes: { friendly_name: "Helper" } } }, user: { is_admin: true }, connection: { sendMessagePromise: async () => ({}) } },
    state: s, helpers, actions: new Proxy(actions, { get: (t, k) => (k in t ? t[k] : quiet()) }),
    toast: () => {} }, { get: (t, k) => (k in t ? t[k] : quiet()) });
  const root = SET.render(ctx);
  await settle();
  const why = all(root).find(n => has(n, "data-ai-plan-build-why")) || null;
  return { root, calls, why, link: why ? all(why).find(n => tag(n) === "A") || null : null, sw: all(root).find(n => has(n, "data-ai-plan-build-switch")) || null };
}
const INFO = (unlock, cands = []) => ({ unlock: { ok: false, display: null, ...unlock }, master: true, switch: false, on: false, candidates: cands, floors: [], stall: null, undo: null });
const LEAD = "Build from plans (experimental) isn't offered here.";
const NEEDS = `It needs ${OFFER.MODEL_WORDS} through Home Assistant's Anthropic integration.`;

for (const [why, display, words] of [
  ["no_ai_task", null, OFFER.CLAUDE_WHY.no_ai_task],
  ["not_anthropic", null, "Your AI Task isn't Claude through Home Assistant's Anthropic integration."],
  ["below_opus_5_5", "Claude Sonnet 4.5", "Your AI Task uses Claude Sonnet 4.5."],
  ["unknown_model", null, "PadSpan can't tell which Claude model this AI Task uses."],
  ["sources_disagree", null, "PadSpan can't tell which Claude model this AI Task uses."],
]) {
  const r = await render({ ai_plans_enabled: true }, INFO({ why, display }));
  check(`why, ${why}: one line in plain words`, r.why && text(r.why).startsWith(`${LEAD} ${words} ${NEEDS}`) && !r.sw, r.why ? text(r.why) : text(r.root).slice(0, 300));
  check(`why, ${why}: the guide`, r.link && r.link.getAttribute("href") === "https://padspan.traks.ca/guides/claude-ai-task/" && r.link.getAttribute("target") === "_blank", r.why ? text(r.why) : null);
}
{
  // The helper's Connect Claude screen and this line read the same words (one copy).
  check("one copy: the helper takes the guide and Claude's case from the same module",
    OFFER.GUIDE_URL === "https://padspan.traks.ca/guides/claude-ai-task/" && typeof OFFER.claudeState === "function", OFFER.GUIDE_URL);
  const r = await render({ ai_plans_enabled: true }, INFO({ why: "not_anthropic" }, [{ entity_id: "ai_task.claude", ok: true, chosen: false, display: "Claude Opus 5.5" }]));
  check("why: a ready Claude not chosen is said", r.why && text(r.why).includes("Home Assistant has Claude Opus 5.5 ready, but it isn't PadSpan's AI Task yet. Choose it as your AI Task above.") && !text(r.why).includes("It needs"), r.why ? text(r.why) : null);
}
{
  const r = await render({ ai_plans_enabled: true }, INFO({ why: "below_opus_5_5", display: "Claude Sonnet 4.5" }), true);
  check("why, wall screen: the words, no link that opens a page", r.why && text(r.why).includes("Your AI Task uses Claude Sonnet 4.5.") && !r.link, r.why ? text(r.why) : null);
}
{
  const r = await render({ ai_plans_enabled: false }, INFO({ why: "below_opus_5_5", display: "Claude Sonnet 4.5" }));
  check("research off: nothing new, the server isn't asked", !r.why && !r.calls.includes("padspan_ha/plan_build_info"), r.calls);
}
{
  const r = await render({ ai_plans_enabled: true }, { ...INFO({ ok: true, why: "ok", display: "Claude Opus 5.5" }), switch: true, on: true });
  check("Claude ready: the switch, no why line", !r.why && !!r.sw, text(r.root).slice(0, 200));
}

console.log(JSON.stringify(results));
