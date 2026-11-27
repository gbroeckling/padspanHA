// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
//
// Feature tips (views/tips.js), run: the picker as the pure function it is, the
// state it keeps, the page's one tip and its answers, the Overview's card, the
// quiet line where the Atlas is adjusted, Settings' Tips card, and the ⋯ list
// (views/live_aboard_show.js createShowMenu) drawing a tip, never on a wall.
//
//   licence   only a feature the licence includes, at every tier: never a tip that sells
//   fit       a tip that doesn't fit this house never shows; the best fit first
//   rank      the reports' ranking breaks a tie and nothing more
//   gone      seen, dismissed or used: never again; used by a setting or a counted word
//   waits     nothing before the install is 7 days old, within 24 h of the last, or off
//   places    a tip only where it may show; a ⋯-only tip only where its line is
//   who       an administrator's tip only to one; in Basic only a target Basic has
//
// usage: tips.mjs <www/padspan-ha dir>
// prints one JSON line: { checks: [...], failures: [...] }

import { pathToFileURL } from "node:url";
import { join } from "node:path";
import { readFileSync } from "node:fs";
import { install } from "./dom_shim.mjs";

const WWW = process.argv[2];
if (!WWW) { console.error("usage: tips.mjs <www/padspan-ha dir>"); process.exit(2); }
install(globalThis);
const url = (p) => pathToFileURL(join(WWW, p)).href;
const T = await import(url("views/tips.js"));
const E = await import(url("views/editions.js"));
const SHOW = await import(url("views/live_aboard_show.js"));

const checks = [], failures = [];
const check = (name, ok, detail) => { checks.push(name); if (!ok) failures.push({ name, detail: String(detail ?? "") }); };
const attempt = (name, fn) => { try { fn(); } catch (e) { failures.push({ name, detail: String(e && e.stack || e).slice(0, 900) }); checks.push(name); } };

const DAY = 86400e3;
const NOW = Date.parse("2026-12-10T18:00:00Z");
const ALL_ADDONS = E.ADDONS.map(a => a.name);
const base = { tips_enabled: true, tips_state: {}, server_tips_rank: [], first_seen_ts: (NOW - 10 * DAY) / 1000,
  tier: "pro", addons_licensed: ALL_ADDONS, addon_key: false, edition: "full", free_basics: true, addons_on_sale: ALL_ADDONS };
// A house with everything every tip asks about.
const RICH = { plans: 2, rooms: 8, lights: 20, placedLights: 12, receivers: 5, tracked: 2, climate: 2, airSensors: 6,
  shades: 4, garage: 1, openings: 6, media: 3, audioMatched: 2, alarmPanels: 1, wled: 1, vacuums: 1, aiTasks: 1,
  aiTaskSet: true, house3d: true, wifiSurvey: true };
const BARE = Object.fromEntries(Object.keys(RICH).map(k => [k, typeof RICH[k] === "boolean" ? false : 0]));
const pick = (o) => T.pickTip({ settings: base, facts: RICH, place: "overview", now: NOW, admin: true, basic: false,
  canGo: () => true, hasLine: () => false, ...o });
const idOf = (tip) => (tip ? tip.id : null);

// ── the catalogue ───────────────────────────────────────────────────────────
attempt("catalogue", () => {
  check("catalogue: 20 to 30 tips", T.TIPS.length >= 20 && T.TIPS.length <= 30, T.TIPS.length);
  check("catalogue: ids unique, short, lower case", new Set(T.TIP_IDS).size === T.TIPS.length && T.TIP_IDS.every(i => /^[a-z0-9_]{1,40}$/.test(i)));
  const needs = new Set(T.TIPS.map(x => x.need));
  for (const a of ["audio", "alarm", "wifi", "climate", "timetravel", "vacation", "looks", "insights", "lighting", "maps", "vacuum"])
    check(`catalogue: a tip for the ${a} add-on`, needs.has(a));
  check("catalogue: free and Pro tips too", needs.has("free") && needs.has("pro"));
  check("catalogue: none for Energy or OS 2 Local", !needs.has("energy") && !needs.has("c4local") && !needs.has("forensics"));
  for (const tip of T.TIPS) {
    check(`catalogue: ${tip.id} has words`, typeof tip.title === "string" && tip.title.length > 3 && tip.title.length <= 60
      && typeof tip.body === "string" && tip.body.length > 10 && tip.body.length <= 160, tip.title + " | " + tip.body);
    check(`catalogue: ${tip.id} has places`, tip.where.length && tip.where.every(p => T.PLACES.includes(p)));
    check(`catalogue: ${tip.id} has a way there`, !!tip.target || !!tip.line);
    check(`catalogue: ${tip.id} need is known`, ["free", "pro", "house3d"].includes(tip.need) || ALL_ADDONS.includes(tip.need));
    // Following a phone fits a house that follows none yet.
    check(`catalogue: ${tip.id} fits the rich house`, tip.fit(tip.id === "phone_tracking" ? { ...RICH, tracked: 0 } : RICH, base) > 0);
    check(`catalogue: ${tip.id} fits no bare house but the always-fitting`, tip.fit(BARE, base) === 0 || tip.id === "themes");
    if (tip.line) check(`catalogue: ${tip.id} line is a ⋯ line`, SHOW.SHOW_KEYS.includes(tip.line), tip.line);
    if (!tip.target) check(`catalogue: ${tip.id} without a target shows only on the Atlas`, tip.where.length === 1 && tip.where[0] === "atlas_adjust");
  }
});

// ── licence ─────────────────────────────────────────────────────────────────
attempt("licence", () => {
  const TIERS = {
    free: { ...base, tier: "free", addons_licensed: [] },
    free_no_basics: { ...base, tier: "free", addons_licensed: [], free_basics: false },
    climate_key: { ...base, tier: "free", addons_licensed: ["climate"], addon_key: true },
    audio_lighting_key: { ...base, tier: "free", addons_licensed: ["audio", "lighting"], addon_key: true },
    lapsed: { ...base, tier: "free", addons_licensed: [], pro_active: false },
    bright: { ...base, tier: "bright", addons_licensed: [] },
    pro: base,
  };
  for (const [name, s] of Object.entries(TIERS)) {
    const fits = T.fitTips({ settings: s, facts: RICH, admin: true, basic: false, canGo: () => true, hasLine: () => true });
    check(`licence: ${name}: every tip it could show is licensed`, fits.every(x => T.licensed(x.tip, s)), fits.map(x => x.tip.id));
    for (const x of fits) {
      const need = x.tip.need;
      const ok = need === "free" ? true : need === "pro" ? E.currentTier(s) === "pro" : need === "house3d" ? E.tierAtLeast(E.currentTier(s), E.house3dTier(s))
        : E.addonAllowed(s, need);
      check(`licence: ${name}: ${x.tip.id} is its licence's`, ok);
    }
  }
  check("licence: free shows no add-on tip", idOf(pick({ settings: TIERS.free })) !== null
    && T.fitTips({ settings: TIERS.free, facts: RICH, admin: true, canGo: () => true }).every(x => ["free", "house3d"].includes(x.tip.need)));
  check("licence: Live Aboard before the free basics needs Pro", !T.licensed(T.tipById("house_3d"), TIERS.free_no_basics)
    && T.licensed(T.tipById("house_3d"), TIERS.free));
  const ck = T.fitTips({ settings: TIERS.climate_key, facts: RICH, admin: true, canGo: () => true }).map(x => x.tip.id);
  check("licence: a Climate key: its tips, no other add-on's", ck.includes("heatmap") && ck.includes("thermostats") && !ck.includes("audio") && !ck.includes("showcase"), ck);
  check("licence: a Climate key: no Pro tip", !ck.includes("people_3d") && !ck.includes("atlas_overview"), ck);
  check("licence: Pro has every add-on's tip", T.TIPS.every(x => T.licensed(x, base)));
  const br = T.fitTips({ settings: { ...base, edition: "bright", tier: "pro" }, facts: RICH, admin: true, canGo: () => true }).map(x => x.tip.id);
  check("licence: a Bright build: no tip about a presence screen", !br.includes("wifi_coverage") && !br.includes("day_replay") && !br.includes("locate") && !br.includes("atlas_overview"), br);
});

// ── fit, then the ranking ───────────────────────────────────────────────────
attempt("fit", () => {
  check("fit: the best fit first (catalogue order among equals)", idOf(pick({})) === "audio", idOf(pick({})));
  check("fit: the ranking breaks the tie", idOf(pick({ settings: { ...base, server_tips_rank: ["robot_vacuum", "audio"] } })) === "robot_vacuum");
  check("fit: the ranking never beats a better fit", idOf(pick({ settings: { ...base, server_tips_rank: ["themes", "house_3d", "busy_times"] } })) === "audio");
  check("fit: the ranking's unknown ids are no harm", idOf(pick({ settings: { ...base, server_tips_rank: ["nope", 7, null] } })) === "audio");
  check("fit: no audio players, no Audio tip", idOf(pick({ facts: { ...RICH, audioMatched: 0, media: 0 } })) !== "audio");
  const noAlarm = { ...RICH, alarmPanels: 0 };
  for (let i = 0; i < 3; i++) check(`fit: no alarm panel, never the alarm tip (${i})`, !T.fitTips({ settings: base, facts: noAlarm, admin: true, canGo: () => true }).some(x => x.tip.id === "alarm_arm"));
  check("fit: a bare house gets only what fits everyone", T.fitTips({ settings: base, facts: BARE, admin: true, canGo: () => true }).every(x => x.tip.id === "themes"));
  const ranked = T.rankTips(T.fitTips({ settings: base, facts: RICH, admin: true, canGo: () => true, hasLine: () => true }), ["themes"]);
  check("fit: ranked by fit, high to low", ranked.every((x, i) => i === 0 || ranked[i - 1].fit >= x.fit), ranked.map(x => x.tip.id + ":" + x.fit));
  const ones = ranked.filter(x => x.fit === 1);
  check("fit: among equals, the ranked one first", ones.length > 1 && ones[0].tip.id === "themes", ones.map(x => x.tip.id));
});

// ── gone: used, dismissed, seen ─────────────────────────────────────────────
attempt("gone", () => {
  check("gone: Audio on in Settings → Atlas: used", idOf(pick({ settings: { ...base, atlas_audio_enabled: true } })) !== "audio");
  check("gone: dismissed", idOf(pick({ settings: { ...base, tips_state: { dismissed: ["audio"] } } })) !== "audio");
  check("gone: used", idOf(pick({ settings: { ...base, tips_state: { used: ["audio"] } } })) !== "audio");
  check("gone: seen long ago is still gone", idOf(pick({ settings: { ...base, tips_state: { seen: { audio: (NOW - 90 * DAY) / 1000 } } } })) !== "audio");
  // Every tip gone one by one: the picker walks the whole list and ends with nothing.
  const st = { seen: {}, dismissed: [], used: [] };
  const got = [];
  for (let i = 0; i < 40; i++) {
    const tip = pick({ settings: { ...base, tips_state: st }, place: i % 2 ? "overview" : "atlas_adjust", hasLine: () => true });
    if (!tip) { if (i % 2) break; continue; }
    got.push(tip.id);
    st.seen[tip.id] = (NOW - 30 * DAY) / 1000;
  }
  check("gone: each tip at most once, ever", new Set(got).size === got.length && got.length >= 20, got.join(","));
  check("gone: all gone, nothing left", pick({ settings: { ...base, tips_state: st }, hasLine: () => true }) === null
    && pick({ settings: { ...base, tips_state: st }, place: "atlas_adjust", hasLine: () => true }) === null);
  const themed = { ...base, theme_palette: "ocean" };
  check("gone: a Looks pack theme on: no themes tip", !T.fitTips({ settings: themed, facts: BARE, admin: true, canGo: () => true }).length);
});

// ── the waits ───────────────────────────────────────────────────────────────
attempt("waits", () => {
  const at = (days) => ({ ...base, first_seen_ts: (NOW - days * DAY) / 1000 });
  check("waits: a 6.9-day-old install: nothing", pick({ settings: at(6.9) }) === null);
  check("waits: 7 days: a tip", pick({ settings: at(7) }) !== null);
  check("waits: never stamped: nothing", pick({ settings: { ...base, first_seen_ts: 0 } }) === null);
  check("waits: a tip 23 hours ago: nothing", pick({ settings: { ...base, tips_state: { seen: { themes: (NOW - 23 * 3600e3) / 1000 } } } }) === null);
  check("waits: 25 hours ago: the next", idOf(pick({ settings: { ...base, tips_state: { seen: { themes: (NOW - 25 * 3600e3) / 1000 } } } })) === "audio");
  check("waits: last_shown alone counts", pick({ settings: { ...base, tips_state: { last_shown: (NOW - 3600e3) / 1000 } } }) === null);
  check("waits: tips off: nothing", pick({ settings: { ...base, tips_enabled: false } }) === null);
  const old = { ...base }; delete old.tips_enabled;
  check("waits: an older backend (no tips_enabled): nothing", pick({ settings: old }) === null);
  check("waits: no settings: nothing", T.pickTip({ facts: RICH, place: "overview", now: NOW }) === null);
});

// ── places and who ──────────────────────────────────────────────────────────
attempt("places", () => {
  for (let k = 0; k < T.TIPS.length; k++) {
    const st = { seen: Object.fromEntries(T.TIP_IDS.slice(0, k).map(i => [i, (NOW - 40 * DAY) / 1000])) };
    for (const place of T.PLACES) {
      const tip = pick({ settings: { ...base, tips_state: st }, place, hasLine: () => true });
      if (tip) check(`places: ${tip.id} may show at ${place}`, tip.where.includes(place));
    }
  }
  const atlasOnly = T.fitTips({ settings: base, facts: RICH, admin: true, canGo: () => true, hasLine: () => true }).filter(x => !x.tip.where.includes("overview")).map(x => x.tip.id);
  check("places: the ⋯-only tips are Atlas-only", atlasOnly.includes("edgecut") && atlasOnly.includes("room_switch"), atlasOnly);
  check("places: a ⋯-only tip needs its line", !T.fitTips({ settings: base, facts: RICH, admin: true, canGo: () => true, hasLine: () => false }).some(x => !x.tip.target));
  check("places: its line there, it can show", T.fitTips({ settings: base, facts: RICH, admin: true, canGo: () => false, hasLine: (k) => k === "edgecut" }).map(x => x.tip.id).join() === "edgecut");
  const who = T.fitTips({ settings: base, facts: RICH, admin: false, canGo: () => true, hasLine: () => true });
  check("who: not an administrator: no administrator's tip", who.length > 0 && who.every(x => !x.tip.admin), who.map(x => x.tip.id));
  const basic = T.fitTips({ settings: base, facts: RICH, admin: true, basic: true, canGo: () => true, hasLine: () => false });
  check("who: Basic: only a target Basic has", basic.length > 0 && basic.every(x => T.basicOk(x.tip.target)), basic.map(x => x.tip.id));
  check("who: Basic: no Atlas builder tip", !basic.some(x => x.tip.target && x.tip.target.view === "maps"));
  check("who: no way there: not shown", !T.fitTips({ settings: base, facts: RICH, admin: true, canGo: (t) => t.view !== "wifi" }).some(x => x.tip.id === "wifi_coverage"));
});

// ── the state ───────────────────────────────────────────────────────────────
attempt("state", () => {
  const c = T.cleanState({ seen: { audio: NOW / 1000 - 5, nope: 1, heatmap: NOW / 1000 + 9 * 86400, edgecut: "x", themes: -4 }, dismissed: ["edgecut", "edgecut", 3, "zzz"],
    used: "audio", last_shown: true }, NOW);
  check("state: catalogue ids only; a time ahead kept, at now", JSON.stringify(c) === JSON.stringify({ seen: { audio: Math.floor(NOW / 1000 - 5), heatmap: Math.floor(NOW / 1000) }, dismissed: ["edgecut"], used: [], last_shown: Math.floor(NOW / 1000) }), JSON.stringify(c));
  check("state: a clock a year ahead still keeps the tip seen", T.cleanState({ seen: { audio: NOW / 1000 + 365 * 86400 } }, NOW).seen.audio === Math.floor(NOW / 1000));
  check("state: junk is empty", JSON.stringify(T.cleanState("junk", NOW)) === JSON.stringify({ seen: {}, dismissed: [], used: [], last_shown: 0 }));
  const s1 = T.withSeen({}, "audio", NOW);
  check("state: seen now, the day's tip", s1.seen.audio === Math.floor(NOW / 1000) && s1.last_shown === Math.floor(NOW / 1000));
  check("state: seen keeps its first time", T.withSeen(s1, "audio", NOW + DAY).seen.audio === Math.floor(NOW / 1000));
  check("state: dismissed", T.withDismissed(s1, "audio", NOW).dismissed.join() === "audio");
  // Used by a counted word: any tip it names, seen or not; tip_used_after only within 7 days of showing.
  const u1 = T.usedNow({ ...base, tips_state: { seen: { audio: (NOW - 3 * DAY) / 1000 } } }, NOW, "room_controls:up");
  check("state: a counted word: used, and after its tip", u1 && u1.added.join() === "audio" && u1.after.join() === "audio", JSON.stringify(u1));
  const u2 = T.usedNow({ ...base, tips_state: { seen: { audio: (NOW - 9 * DAY) / 1000 } } }, NOW, "room_controls:up");
  check("state: used 9 days on: used, not after", u2 && u2.added.join() === "audio" && !u2.after.length);
  const u3 = T.usedNow({ ...base }, NOW, "house3d_show:show:edgecut");
  check("state: never shown: used, no after", u3 && u3.added.join() === "edgecut" && !u3.after.length);
  check("state: a prefix word", (T.usedNow({ ...base }, NOW, "house3d_show:room_tap:on") || {}).added?.join() === "room_switch");
  check("state: an unrelated word: nothing", T.usedNow({ ...base }, NOW, "tab:maps") === null);
  const u4 = T.usedNow({ ...base, atlas_heatmap_enabled: true, tips_state: { seen: { heatmap: (NOW - DAY) / 1000 } } }, NOW);
  check("state: a setting on after its tip: used, after", u4 && u4.added.join() === "heatmap" && u4.after.join() === "heatmap");
  check("state: a setting on, tip never shown: nothing kept", T.usedNow({ ...base, atlas_heatmap_enabled: true }, NOW) === null);
});

// ── the page: one tip, its answers, what is sent and saved ─────────────────
function host(over = {}) {
  const sent = [], saved = [], went = [];
  const h = { settings: JSON.parse(JSON.stringify(base)), facts: RICH, admin: true, basic: false, kiosk: false, live: true,
    save: (p) => { saved.push(JSON.parse(JSON.stringify(p))); return Promise.resolve(); }, send: (w) => sent.push(w),
    go: (t) => went.push(t), canGo: () => true, rerender: () => {}, toast: () => {}, ...over };
  return { h, sent, saved, went };
}
attempt("page", () => {
  T.resetPage();
  const { h, sent, saved } = host();
  const tip = T.currentTip(h, "overview", "overview", NOW);
  check("page: a tip shown, counted once, saved seen", tip && sent.join() === "tip_shown:" + tip.id && saved.length === 1
    && saved[0].tips_state.seen[tip.id] === Math.floor(NOW / 1000), JSON.stringify({ sent, saved }));
  check("page: drawn again, the same tip, nothing more sent", T.currentTip(h, "overview", "overview", NOW + 5000) === tip && sent.length === 1 && saved.length === 1);
  check("page: one tip per page load: none elsewhere", T.currentTip(h, "atlas_adjust", "settings_atlas", NOW) === null);
  T.answer(h, tip, "not_now", NOW);
  check("page: Not now: counted, gone, still seen", sent.at(-1) === "tip_not_now:" + tip.id && T.currentTip(h, "overview", "overview", NOW) === null
    && T.cleanState(h.settings.tips_state, NOW).seen[tip.id]);
  T.resetPage();
  check("page: the next page load, within the day: none", T.currentTip(h, "overview", "overview", NOW + 3600e3) === null);
  T.resetPage();
  const next = T.currentTip(h, "overview", "overview", NOW + 1.5 * DAY);
  check("page: a day on: another, never the same", next && next.id !== tip.id, next && next.id);

  T.resetPage();
  const d = host();
  const t2 = T.currentTip(d.h, "overview", "overview", NOW);
  T.answer(d.h, t2, "dismiss", NOW);
  check("page: dismissed: counted and saved", d.sent.at(-1) === "tip_dismiss:" + t2.id && d.saved.at(-1).tips_state.dismissed.includes(t2.id));

  T.resetPage();
  const g = host();
  const t3 = T.currentTip(g.h, "overview", "overview", NOW);
  T.answer(g.h, t3, "go", NOW);
  check("page: Show me: counted, and there", g.sent.at(-1) === "tip_go:" + t3.id && g.went.length === 1 && g.went[0] === t3.target);

  T.resetPage();
  const o = host();
  const t4 = T.currentTip(o.h, "overview", "overview", NOW);
  T.answer(o.h, t4, "off", NOW);
  check("page: No more tips: counted, switched off", o.sent.at(-1) === "tips_off" && o.saved.at(-1).tips_enabled === false && o.h.settings.tips_enabled === false);
  T.resetPage();
  check("page: off: none after", T.currentTip(o.h, "overview", "overview", NOW + 3 * DAY) === null);

  T.resetPage();
  check("page: a wall: none", T.currentTip(host({ kiosk: true }).h, "overview", "overview", NOW) === null && T.pageTip().id === null);
  check("page: sample data: none", T.currentTip(host({ live: false }).h, "overview", "overview", NOW) === null && T.pageTip().id === null);

  // A counted word: its tip is used; within the week of showing, tip_used_after.
  T.resetPage();
  const n = host();
  n.h.settings.tips_state = { seen: { audio: (NOW - 2 * DAY) / 1000 } };
  T.noteEvent(n.h, "room_controls:mute", NOW);
  check("page: used after its tip: counted and kept", n.sent.join() === "tip_used_after:audio" && n.saved.at(-1).tips_state.used.includes("audio"), JSON.stringify(n.sent));
  T.noteEvent(n.h, "room_controls:mute", NOW);
  check("page: used once is enough", n.sent.length === 1);
  T.noteEvent(n.h, "tip_go:edgecut", NOW);
  check("page: a tip's own words never count as use", n.sent.length === 1 && !n.h.settings.tips_state.used.includes("edgecut"));
  const old = host(); delete old.h.settings.tips_enabled;
  T.noteEvent(old.h, "room_controls:mute", NOW);
  check("page: an older backend: nothing written", old.saved.length === 0);
});

// ── the looks ───────────────────────────────────────────────────────────────
const tall = (b) => /min-height:\s*36px/.test(b.style.cssText) || /min-height:36px/.test(b.getAttribute("style") || "");
attempt("looks", () => {
  T.resetPage();
  const { h, sent, went } = host();
  const card = T.overviewCard(h, NOW);
  const acts = card.querySelectorAll("[data-feature-tip-act]");
  const words = acts.map(b => b.getAttribute("data-feature-tip-act")).join();
  check("looks: the Overview card: Show me, Not now, No more tips, ✕", words === "dismiss,go,not_now,off", words);
  check("looks: every button 36 px tall at least", acts.every(tall), acts.map(b => b.style.cssText).join(" | "));
  check("looks: the Overview cards' style", /background:#0a1f14/.test(card.style.cssText) && /border-radius:8px/.test(card.style.cssText));
  card.querySelector('[data-feature-tip-act="go"]').click();
  check("looks: Show me goes there", went.length === 1 && sent.at(-1).startsWith("tip_go:"));
  check("looks: answered: no card on the next draw", T.overviewCard(h, NOW) === null);

  T.resetPage();
  const a = host();
  const line = T.adjustLine(a.h, "settings_atlas", NOW);
  const id = line && line.getAttribute("data-feature-tip");
  check("looks: Settings → Atlas: an Atlas tip, three answers", line && T.tipById(id).where.includes("atlas_adjust")
    && line.querySelectorAll("[data-feature-tip-act]").map(b => b.getAttribute("data-feature-tip-act")).join() === "go,not_now,off", id);
  check("looks: the line's buttons 36 px tall", line.querySelectorAll("[data-feature-tip-act]").every(tall));
  check("looks: the Atlas builder, the same page load: none", T.adjustLine(a.h, "atlas_builder", NOW) === null);

  // Settings → Appearance → Tips: the switch, every fitting tip (seen too), Show me each.
  const sc = host();
  sc.h.settings.tips_state = { seen: { audio: (NOW - 50 * DAY) / 1000 }, dismissed: ["heatmap"] };
  const box = T.settingsCard(sc.h);
  const rows = box.querySelectorAll("[data-tips-row]").map(r => r.getAttribute("data-tips-row"));
  check("looks: Tips card lists seen and dismissed tips too", rows.includes("audio") && rows.includes("heatmap") && rows.length >= 20, rows.join());
  check("looks: Tips card lists no ⋯-only tip", !rows.includes("edgecut"));
  box.querySelector('[data-tips-row-go="audio"]').click();
  check("looks: Tips card's Show me goes there", sc.went.length === 1 && sc.went[0] === T.tipById("audio").target);
  const sw = box.querySelector('[data-tips-card="switch"]');
  sw.checked = false; sw.dispatchEvent({ type: "change" });
  check("looks: the switch off: saved, counted", sc.saved.at(-1).tips_enabled === false && sc.sent.at(-1) === "tips_off");
  const offBox = T.settingsCard(sc.h);
  const back = offBox.querySelector('[data-tips-card="back"]');
  check("looks: off: Bring tips back", !!back && tall(back));
  back.click();
  check("looks: Bring tips back: on again", sc.saved.at(-1).tips_enabled === true);
  const oldS = host(); delete oldS.h.settings.tips_enabled;
  check("looks: an older backend: no Tips card", T.settingsCard(oldS.h) === null);
  const bs = host({ basic: true });
  const bRows = T.settingsCard(bs.h).querySelectorAll("[data-tips-row]").map(r => T.tipById(r.getAttribute("data-tips-row")));
  check("looks: Basic's Tips card: only targets Basic has", bRows.length > 0 && bRows.every(x => T.basicOk(x.target)));
});

// ── the ⋯ list ──────────────────────────────────────────────────────────────
attempt("menu", () => {
  const rows = () => [{ group: "house", words: "The house", rows: ["edgecut", "room_shades", "other_floors"].map(k => ({ key: k, words: k, hint: "", on: false, always: false, setup: null, link: null })) }];
  const make = (root, tip) => SHOW.createShowMenu({ root, guard: (fn) => fn, rows, changed: () => false, toggle() {}, setup() {}, go() {}, canGo: () => false,
    reset() {}, opened() {}, seen() {}, tip });
  // The tip, as menuTip gives it, from a host with the ⋯ list's lines: Show me points at the line.
  T.resetPage();
  const m = host({ go: null, canGo: () => false, admin: false });
  const root = document.createElement("div");
  document.body.appendChild(root);
  const menu = make(root, (keys) => T.menuTip(m.h, keys, NOW));
  menu.open();
  const tipEl = root.querySelector("[data-la3d-tip]");
  const id = tipEl && tipEl.getAttribute("data-la3d-tip");
  check("menu: the list open: a tip under its heading", !!tipEl && ["edgecut"].includes(id), id);
  const acts = tipEl ? tipEl.querySelectorAll("[data-la3d-tip-act]").map(b => b.getAttribute("data-la3d-tip-act")).join() : "";
  check("menu: three answers", acts === "go,not_now,off", acts);
  tipEl.querySelector('[data-la3d-tip-act="go"]').click();
  const row = root.querySelector('[data-show="edgecut"]');
  check("menu: Show me points at its line, the list stays", menu.isOpen && row && row.classList.contains("la3d-spoint") && !root.querySelector("[data-la3d-tip]"));
  check("menu: Show me counted, no page left", m.sent.at(-1) === "tip_go:edgecut" && m.went.length === 0);
  menu.close(); menu.open();
  check("menu: answered: no tip when it opens again", !root.querySelector("[data-la3d-tip]"));
  menu.dispose();

  // A wall: never, whatever the host hands in.
  T.resetPage();
  const w = host();
  const wall = document.createElement("div");
  wall.setAttribute("data-wall", "");
  const wroot = document.createElement("div");
  wall.appendChild(wroot); document.body.appendChild(wall);
  let asked = 0;
  const wm = make(wroot, (keys) => { asked++; return T.menuTip(w.h, keys, NOW); });
  wm.open();
  check("menu: a wall: no tip, not even asked", !wroot.querySelector("[data-la3d-tip]") && asked === 0 && w.sent.length === 0);
  wm.dispose();
  // A host that hands none (the wall's lights_panel.js, Mapping's 3D look): none.
  const nroot = document.createElement("div"); document.body.appendChild(nroot);
  const nm = make(nroot, undefined);
  nm.open();
  check("menu: no tip handed in: none", !nroot.querySelector("[data-la3d-tip]"));
  nm.dispose();
  // menuTip from a wall host: none.
  T.resetPage();
  check("menu: menuTip on a wall host: none", T.menuTip(host({ kiosk: true }).h, ["edgecut"], NOW) === null);
});

// ── the Overview's slot (panel.js _featureTipCard, run as panel.js has it) ──
attempt("slot", () => {
  const src = readFileSync(join(WWW, "panel.js"), "utf8");
  const m = /^\s{2}_featureTipCard\s*\(\)\s*\{/m.exec(src);
  let depth = 0, end = -1;
  for (let j = src.indexOf("{", m.index); j < src.length; j++) {
    if (src[j] === "{") depth++;
    else if (src[j] === "}") { depth--; if (!depth) { end = j + 1; break; } }
  }
  const body = src.slice(m.index, end);
  let wall = false;
  // The module-level names panel.js hands it: TIPS and wallScreen, nothing else.
  // The module-level names panel.js hands it: TIPS, wallScreen, and the two cards before it that ask the server.
  const PEND = { aiw: false, c4l: false };
  const AIW = { overviewPending: () => PEND.aiw }, C4L = { overviewPending: () => PEND.c4l };
  const method = new Function("TIPS", "wallScreen", "AIW", "C4L", `return { ${body} }._featureTipCard;`)(T, () => wall, AIW, C4L);
  const panel = (over = {}) => {
    const sent = [], saved = [];
    // The panel asks at the real clock: an install ten days old by it.
    const state = { settings: { ...JSON.parse(JSON.stringify(base)), first_seen_ts: Date.now() / 1000 - 10 * 86400 }, _dataModeKnown: true, dataMode: "live", kioskMode: false, complexity: "advanced",
      model: { room_geometry_m: { a: {}, b: {}, c: {} }, light_positions_m: { "light.a": {}, "light.b": {}, "light.c": {} } }, maps: { list: [{ id: "m" }] } };
    const ctx = { state, hass: { user: { is_admin: true }, states: { "media_player.k": { attributes: {} }, "alarm_control_panel.h": { attributes: {} } } },
      actions: { wsCall: (type, data) => { saved.push(data); return Promise.resolve({}); }, telemetryEvent: (n) => sent.push(n), showView() {}, renderRooms() {}, canOpen: () => true },
      toast() {} };
    const p = { state, _ctx: () => ctx, _overviewCardShown: false, sent, saved, ...over };
    return p;
  };
  T.resetPage();
  const taken = panel({ _overviewCardShown: true });
  check("slot: another card has this page load: no tip", method.call(taken) === null && T.pageTip().id === null);
  const k = panel(); k.state.kioskMode = true;
  check("slot: a wall (?kiosk=1): no tip", method.call(k) === null);
  wall = true;
  check("slot: a wall (a window filling the screen): no tip", method.call(panel()) === null);
  wall = false;
  const sm = panel(); sm.state.dataMode = "sample";
  check("slot: sample data: no tip", method.call(sm) === null);
  const unk = panel(); unk.state._dataModeKnown = false;
  check("slot: data mode not known yet: no tip", method.call(unk) === null);
  check("slot: none of it used up a tip", T.pageTip().id === null);
  PEND.aiw = true;
  check("slot: Let Claude draw your rooms not answered yet: no tip", method.call(panel()) === null && T.pageTip().id === null);
  PEND.aiw = false; PEND.c4l = true;
  check("slot: OS 2 Local for Control4 not answered yet: no tip", method.call(panel()) === null && T.pageTip().id === null);
  PEND.c4l = false;
  const p = panel();
  const card = method.call(p);
  check("slot: the slot free: the card, holding the slot", !!card && p._overviewCardShown === true && p._tipCardVisible === true
    && p.sent.length === 1 && p.sent[0].startsWith("tip_shown:"), JSON.stringify(p.sent));
  p._overviewCardShown = true;
  const again = method.call(p);
  check("slot: drawn again: the same tip", !!again && again.getAttribute("data-feature-tip") === card.getAttribute("data-feature-tip") && p.sent.length === 1);
  again.querySelector('[data-feature-tip-act="not_now"]').click();
  check("slot: answered: gone, and the slot stays taken this page load", method.call(p) === null && p._overviewCardShown === true);
});

// ── the review's fixes (2026-11-26) ────────────────────────────────────────
attempt("review", () => {
  // Show me's places.
  const alarm = T.tipById("alarm_arm"), ai = T.tipById("ai_plans");
  check("review: the alarm's Show me opens the Atlas's emergency button card", alarm.target && alarm.target.atlas === "emergency" && T.basicOk(alarm.target));
  check("review: AI plan reading opens its own switch, never in Basic", ai.target.part === "ai_plans" && !ai.target.focus && !T.basicOk(ai.target));
  check("review: AI plan reading fits only with an AI Task chosen", ai.fit({ ...RICH, aiTaskSet: false }, base) === 0 && ai.fit(RICH, base) > 0);
  check("review: the AI Task chosen is a fact", T.factsFrom({ settings: { atlas_3d_ai_task_entity: "ai_task.claude" } }).aiTaskSet === true
    && T.factsFrom({ settings: {} }).aiTaskSet === false);
  for (const id of ["lights_follow", "yesterday_home", "guest_tags"])
    check(`review: ${id}'s Show me opens its Tracking section`, !!T.tipById(id).target.reveal);
  const st = { _settingsTab: null }, shown = [];
  T.goCtx({ state: st, actions: { showView: (v) => shown.push(v) } }, T.tipById("lights_follow").target);
  check("review: goCtx sets the section to open", st._presenceReveal === "integrations" && st._settingsPart === "lights_follow" && shown.join() === "settings");
  let went = null;
  const loc = globalThis.location;
  globalThis.location = { assign: (u) => { went = u; } };
  T.goCtx({ state: {}, actions: {} }, alarm.target);
  globalThis.location = loc;
  check("review: goCtx takes the alarm's Show me to the Atlas page's card", went === "/padspan-lights?card=emergency", went);
  // The robot vacuum by the add-on itself: never for a free install whose robot features lock on December 1.
  const notYet = { ...base, tier: "free", addons_licensed: [], addons_on_sale: ALL_ADDONS.filter(n => n !== "vacuum") };
  check("review: robot vacuum strictly by its add-on, not before it is on sale either", E.vacuumAllowed(notYet)
    && !T.licensed(T.tipById("robot_vacuum"), notYet) && T.licensed(T.tipById("robot_vacuum"), { ...notYet, addons_licensed: ["vacuum"] }));
  // Each its own "used"; none of the four counts its own Show me landing.
  for (const id of ["locate", "busy_times", "wled_controls"])
    check(`review: ${id} has its own use, no shared word`, T.tipById(id).used.uses === true && !(T.tipById(id).used.events || []).length);
  T.resetPage();
  const q = host({ go: () => {} });
  q.h.settings.tips_state = {};
  const shownTip = T.tipById("wifi_coverage");
  q.h.settings.tips_state = { seen: { wifi_coverage: (NOW - DAY) / 1000 } };
  T.answer(q.h, shownTip, "go", NOW);
  T.noteEvent(q.h, "tab:wifi", NOW + 2000);
  check("review: Show me's own landing (tab:wifi) is not a use", !T.cleanState(q.h.settings.tips_state, NOW).used.includes("wifi_coverage") && !q.sent.includes("tip_used_after:wifi_coverage"));
  T.noteEvent(q.h, "tab:wifi", NOW + (T.GO_QUIET_S + 5) * 1000);
  check("review: a visit after the quiet window is", T.cleanState(q.h.settings.tips_state, NOW).used.includes("wifi_coverage") && q.sent.includes("tip_used_after:wifi_coverage"));
  T.resetPage();
  const b = host({ go: () => {} });
  b.h.settings.tips_state = { seen: { busy_times: (NOW - DAY) / 1000 } };
  T.answer(b.h, T.tipById("busy_times"), "go", NOW);
  T.noteUse("busy_times", NOW + 1000);
  T.reconcile(b.h, NOW + 1000);
  check("review: Busy Times opened by its Show me: not a use", !T.cleanState(b.h.settings.tips_state, NOW).used.includes("busy_times"));
  T.noteUse("busy_times", NOW + 120e3);
  T.noteUse("locate", NOW + 120e3);
  T.reconcile(b.h, NOW + 120e3);
  const used = T.cleanState(b.h.settings.tips_state, NOW).used;
  check("review: later, Busy Times and Locate each by their own use", used.includes("busy_times") && used.includes("locate") && b.sent.includes("tip_used_after:busy_times")
    && !b.sent.includes("tip_used_after:locate"), JSON.stringify({ used, sent: b.sent }));
  T.noteEvent(b.h, "addon_used:insights", NOW + 200e3);
  check("review: the shared insights word marks neither", true);
  // A ⋯ line pointed at: ticking it is the person's own, counted at once.
  T.resetPage();
  const ln = host({ go: null, canGo: () => false });
  ln.h.settings.tips_state = {};
  const mt = T.menuTip(ln.h, ["edgecut"], NOW);
  mt.go();
  T.noteEvent(ln.h, "house3d_show:show:edgecut", Date.now() + 1000);
  check("review: a line ticked after Show me counts", T.cleanState(ln.h.settings.tips_state, Date.now()).used.includes("edgecut"));
  // Sample data: the sample house's use is never this house's.
  T.resetPage();
  const smp = host({ live: false });
  T.noteEvent(smp.h, "room_controls:up", NOW);
  T.noteUse("locate", NOW);
  T.reconcile(smp.h, NOW);
  check("review: sample data marks nothing used", smp.saved.length === 0);
  T.resetPage();
  // A wall in Settings → Atlas and the Atlas builder: a window filling the screen.
  const scr = globalThis.screen, iw = globalThis.innerWidth, ih = globalThis.innerHeight;
  globalThis.screen = { width: 1920, height: 1080 }; globalThis.innerWidth = 1920; globalThis.innerHeight = 1080;
  const wallHost = T.hostFromCtx({ state: { settings: base, dataMode: "live" }, actions: {} });
  check("review: a full-screen window is a wall for every view's host", wallHost.kiosk === true && T.adjustLine({ ...wallHost, settings: { ...base } }, "settings_atlas", NOW) === null);
  globalThis.innerHeight = 900;
  check("review: an ordinary window is not", T.hostFromCtx({ state: { settings: base, dataMode: "live" }, actions: {} }).kiosk === false);
  globalThis.screen = scr; globalThis.innerWidth = iw; globalThis.innerHeight = ih;
});

// The two cards the Overview's tip waits for: their own "still asking" rule.
const AIWM = await import(url("views/ai_wizard_offer.js"));
const C4LM = await import(url("views/c4local.js"));
let release = null;
const aiCtx = { state: { dataMode: "live", model: {}, maps: { list: [] } }, hass: { user: { is_admin: true } },
  actions: { callWS: () => new Promise((r) => { release = r; }), renderRooms() {} } };
check("review: Let Claude draw your rooms, asked and not back: pending", AIWM.overviewPending(aiCtx) === true && typeof release === "function");
release({ offer: false });
for (let i = 0; i < 6; i++) await Promise.resolve();   // the answer's then and finally
check("review: Let Claude draw your rooms, answered: not pending", AIWM.overviewPending(aiCtx) === false);
check("review: not an administrator: never pending", AIWM.overviewPending({ ...aiCtx, hass: { user: { is_admin: false } } }) === false);
C4LM._reset();
const c4Ctx = { state: { settings: { addons_on_sale: [] } }, hass: { user: { is_admin: true }, config: { components: ["control4"] } },
  actions: { wsCall: () => new Promise(() => {}), renderRooms() {} } };
check("review: OS 2 Local not published: never pending", C4LM.overviewPending(c4Ctx) === false);

// ── the whole-beta inspection's fixes ───────────────────────────────────────
attempt("beta", () => {
  // Got it, not Not now: seen is never again.
  T.resetPage();
  const g = host();
  const card = T.overviewCard(g.h, NOW);
  const gotIt = card.querySelector('[data-feature-tip-act="not_now"]');
  check("beta: the answer says Got it", gotIt && gotIt.textContent === "Got it", gotIt && gotIt.textContent);
  // A household member's No more tips: this browser only, the house's switch untouched.
  localStorage.removeItem(T.LOCAL_OFF_KEY);
  T.resetPage();
  const m = host({ admin: false });
  const tip = T.currentTip(m.h, "overview", "overview", NOW);
  T.answer(m.h, tip, "off", NOW);
  check("beta: a member's No more tips: this browser, no house write", T.localOff() === true && m.h.settings.tips_enabled === true
    && !m.saved.some((p) => "tips_enabled" in p) && m.sent.at(-1) === "tips_off");
  T.resetPage();
  check("beta: then no tip for them here", T.currentTip(host({ admin: false }).h, "overview", "overview", NOW + 3 * DAY) === null);
  T.resetPage();
  check("beta: an administrator on the same browser still gets tips", T.currentTip(host({ admin: true }).h, "overview", "overview", NOW + 3 * DAY) !== null);
  const mc = host({ admin: false });
  const box = T.settingsCard(mc.h);
  check("beta: a member's Tips card says it is this browser's", !!box.querySelector('[data-tips-card="local"]'));
  box.querySelector('[data-tips-card="back"]').click();
  check("beta: a member brings tips back on this browser, nothing written", T.localOff() === false && mc.saved.length === 0);
  const houseOff = host({ admin: false });
  houseOff.h.settings.tips_enabled = false;
  const hb = T.settingsCard(houseOff.h);
  check("beta: off for the house: a member can't switch it, and is told why", hb.querySelector('[data-tips-card="switch"]').disabled === true
    && !hb.querySelector('[data-tips-card="back"]'));
  // Sample data: nothing is ever saved, whatever happens.
  T.resetPage();
  const smp = host({ live: false });
  T.noteEvent(smp.h, "addon_used:timetravel", NOW);
  T.noteEvent(smp.h, "tab:wifi", NOW);
  T.noteUse("busy_times", NOW);
  T.reconcile(smp.h, NOW);
  T.answer(smp.h, T.tipById("audio"), "dismiss", NOW);
  T.settingsCard(smp.h).querySelector('[data-tips-card="switch"]').dispatchEvent({ type: "change" });
  check("beta: sample data: no settings_set, ever", smp.saved.length === 0, JSON.stringify(smp.saved));
  // The panel's own word in Sample mode never reaches the server.
  const src = readFileSync(join(WWW, "panel.js"), "utf8");
  const i = src.indexOf("\n  _tipNote(name){"), j = src.indexOf("\n  _telemetryEvent(name, extra){", i);
  const noteFn = new Function("TIPS", `return { ${src.slice(i, j)} }._tipNote;`)(T);
  const calls = [];
  const pSample = { state: { settings: { ...base, tips_state: { seen: { audio: (Date.now() - DAY) / 1000 } } }, _dataModeKnown: true, dataMode: "sample" },
    _callWS: (m) => { calls.push(m); return Promise.resolve({}); }, _telemetryEvent: () => {} };
  T.resetPage();
  noteFn.call(pSample, "room_controls:up");
  pSample.state.dataMode = "live"; pSample.state._dataModeKnown = false;
  noteFn.call(pSample, "room_controls:up");
  check("beta: the panel in Sample mode (or not yet known) writes nothing", calls.length === 0, JSON.stringify(calls));
  pSample.state._dataModeKnown = true;
  noteFn.call(pSample, "room_controls:up");
  check("beta: live, the same word is written", calls.length === 1 && calls[0].type === "padspan_ha/settings_set");
  // Audio: the card's new words count.
  for (const w of ["source", "sound_mode", "play", "share", "all_off"])
    check(`beta: room_controls:${w} is Audio used`, T.eventUses(T.tipById("audio"), "room_controls:" + w));
  check("beta: the ⋯ line ticked is Audio used", T.eventUses(T.tipById("audio"), "house3d_show:show:room_controls"));
  check("beta: Audio's words describe the card", /source/.test(T.tipById("audio").body) && /Room off/.test(T.tipById("audio").body));
  localStorage.removeItem(T.LOCAL_OFF_KEY);
});

// ── the Shades tip goes by the room card's own rule (room_controls.js isShade) ─────────────
attempt("shades rule", () => {
  const cover = (dc, name) => ({ state: "closed", attributes: { friendly_name: name, ...(dc ? { device_class: dc } : {}), supported_features: 3 } });
  const model = { room_geometry_m: { Kitchen: {}, Garage: {} } };
  const shadesTip = (states, extra = {}) => {
    const facts = T.factsFrom({ states, model, settings: {}, ...extra });
    return { n: facts.shades, fit: T.tipById("shades").fit(facts, base) };
  };
  // Only a garage door, a door, a damper, a window and an unlinked opener: no shade, no Shades tip.
  const notShades = { "cover.garage": cover("garage", "Garage door"), "cover.front": cover("door", "Front door"), "cover.hvac": cover("damper", "Damper"),
    "cover.sky": cover("window", "Skylight"), "cover.side_opener": cover(null, "Garage side door opener") };
  const a = shadesTip(notShades);
  check("shades rule: a house with only doors, dampers, windows and openers gets no Shades tip", a.n === 0 && a.fit === 0);
  // One blind: the tip fits. Linked as a door's opener (the model's barrier, or the host's own list): not a shade.
  const b = shadesTip({ ...notShades, "cover.kitchen_blind": cover("blind", "Kitchen blind") });
  check("shades rule: one blind gets the Shades tip", b.n === 1 && b.fit > 0);
  const c = shadesTip({ "cover.kitchen_blind": cover(null, "Kitchen blind") }, { model: { ...model, rf_barriers_m: [{ linked_entity_id: "cover.kitchen_blind" }] } });
  const d = shadesTip({ "cover.kitchen_blind": cover(null, "Kitchen blind") }, { openers: new Set(["cover.kitchen_blind"]) });
  check("shades rule: a cover linked as a door's opener is never a shade", c.n === 0 && d.n === 0);
  check("shades rule: the openers the model and settings name", [...T.openersFrom({ rf_barriers_m: [{ linked_opener_entity_id: "cover.a" }, { linked_entity_id: "light.x" }] },
    { door_opener_ids: ["cover.b", 3] })].sort().join() === "cover.a,cover.b");
});

console.log(JSON.stringify({ checks, failures }));
process.exit(failures.length ? 1 : 0);
