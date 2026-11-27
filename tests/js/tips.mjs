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
  tier: "pro", addons_licensed: ALL_ADDONS, addon_key: false, edition: "full", free_basics: true };
// A house with everything every tip asks about.
const RICH = { plans: 2, rooms: 8, lights: 20, placedLights: 12, receivers: 5, tracked: 2, climate: 2, airSensors: 6,
  shades: 4, garage: 1, openings: 6, media: 3, audioMatched: 2, alarmPanels: 1, wled: 1, vacuums: 1, aiTasks: 1,
  house3d: true, wifiSurvey: true };
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
      const ok = need === "free" ? true : need === "pro" ? E.currentTier(s) === "pro" : need === "house3d" ? E.tierAtLeast(E.currentTier(s), E.house3dTier(s)) : E.addonAllowed(s, need);
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
  check("state: catalogue ids only, sane times", JSON.stringify(c) === JSON.stringify({ seen: { audio: Math.floor(NOW / 1000 - 5) }, dismissed: ["edgecut"], used: [], last_shown: Math.floor(NOW / 1000 - 5) }), JSON.stringify(c));
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
  const method = new Function("TIPS", "wallScreen", `return { ${body} }._featureTipCard;`)(T, () => wall);
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

console.log(JSON.stringify({ checks, failures }));
process.exit(failures.length ? 1 : 0);
