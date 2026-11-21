// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
//
// What the click-through of every screen (tools/ui_click_through) found and
// was fixed, run for real: the views rendered with panel.js's own el() under
// the DOM shim, given the answers that showed the fault.
//
// Run:  node tests/js/click_through_fixes.mjs <www-dir>
// prints one JSON line: { name: { ok, detail } }
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { join } from "node:path";
import { install, flush } from "./dom_shim.mjs";

const WWW = process.argv[2];
install(globalThis);

const src = readFileSync(join(WWW, "panel.js"), "utf-8").replace(/\r\n/g, "\n");
const cut = (from, to) => {
  const a = src.indexOf(from);
  if (a < 0) throw new Error("not in panel.js: " + from);
  return src.slice(a, src.indexOf(to, a) + to.length);
};
const { el, asButton } = new Function(
  cut("function el(tag, attrs={}, children=[]){", "\n}\n") + cut("const asButton = Object.freeze({", "\n});\n") + "return { el, asButton };")();

const results = {};
const check = (name, ok, detail) => { results[name] = { ok: !!ok, detail: ok ? undefined : detail }; };
const settle = async () => { await flush(); await new Promise(r => globalThis._realSetTimeout(r, 0)); await flush(); };
const textOf = (n) => (n.textContent || "").replace(/\s+/g, " ");
const load = async (file) => import(pathToFileURL(join(WWW, "views", file)).href);

// Anything a view asks of its helpers that is not given here draws an empty span.
const quiet = () => new Proxy(() => document.createElement("span"), {
  get: (_t, k) => (k === "then" ? undefined : k === Symbol.toPrimitive || k === "toString" ? () => "" : quiet()),
  apply: () => document.createElement("span"),
});

function makeCtx(over = {}, answer = async () => ({})) {
  const toasts = [];
  const state = {
    view: "qa", dataMode: "live", _dataModeKnown: true, complexity: "advanced", timing: {}, wsCounts: {},
    settings: { data_mode: "live", followed_addrs: [], hidden_map_ids: [] },
    model: { floors: [{ id: "main", name: "Main", level: 0 }], areas: [{ name: "Kitchen", floor_id: "main" }], room_geometry_m: {}, map_transforms: {} },
    maps: { list: [] }, roomTagMap: { Kitchen: [] },
    live: { snapshot: { rooms: [{ name: "Kitchen" }], rooms_discovered: ["Kitchen"], tags: [], radios: [],
                        objects: { list: [], summary: { total: 0 } }, ble: { radios: [], advertisements: [] }, data_mode: "live" } },
    ...over,
  };
  const actions = new Proxy({ wsCall: (type, data) => answer(type, data), callWS: (msg) => answer(msg && msg.type, msg), followedHas: () => false },
    { get: (t, k) => (k in t ? t[k] : () => {}) });
  const helpers = new Proxy({
    el, asButton, esc: (s) => String(s ?? ""), pill: (t) => el("span", {}, String(t ?? "")), helpBtn: () => el("button", {}, "?"),
    radioShortId: (s) => String(s || "").slice(-2), radioName: () => "", roomColor: () => "#52b788", HELP: {},
  }, { get: (t, k) => (k in t ? t[k] : quiet()) });
  return { state, hass: { states: {}, user: { is_admin: true } }, helpers, actions, toast: (t) => toasts.push(t), toasts };
}

// ── Radio QA's propagation card: "Loading…" only while nothing has answered ──
// Sample mode answers the call from the sample house, which has no analysis
// ({}), and a failed call answered nothing: both used to leave "Loading
// propagation analysis..." on screen for good.
{
  const qa = await load("qa.js");
  const cases = [
    ["an answer with no grade", async (t) => (t === "padspan_ha/propagation_health" ? {} : {}), "No propagation analysis for this house yet."],
    ["a failed call", async (t) => { if (t === "padspan_ha/propagation_health") throw new Error("boom"); return {}; }, "Propagation analysis could not be loaded."],
    ["a graded answer", async (t) => (t === "padspan_ha/propagation_health" ? { grade: "B", rooms: [], scanners: [] } : {}), "Propagation Model: Grade B"],
  ];
  for (const [name, answer, want] of cases) {
    const ctx = makeCtx({}, answer);
    const root = qa.render(ctx);
    const before = textOf(root);
    await settle();
    const after = textOf(root);
    check(`qa propagation, ${name}: "Loading…" while it waits`, before.includes("Loading propagation analysis..."), before.slice(0, 300));
    check(`qa propagation, ${name}: then says ${JSON.stringify(want)}`, after.includes(want) && !after.includes("Loading propagation analysis..."),
      after.slice(after.indexOf("Propagation") - 20, after.indexOf("Propagation") + 200));
  }
}

// ── Settings → Tracking → Check Now in Sample mode ────────────────────────────
// Sample mode answers a read the sample house does not hold with {}, and the
// card printed "undefined calibration points · newest is unknown age old".
// The sample house now answers it from its own points, as the server does.
{
  const { createSampleHouse } = await import(pathToFileURL(join(WWW, "sample_house.js")).href);
  const house = createSampleHouse();
  const r = house.route({ type: "padspan_ha/calibration_health_check" });
  const pts = house.calibration.points.length;
  check("sample health check: answered, not left to {}", r && typeof r === "object", r);
  check("sample health check: the points the sample house holds", r && r.point_count === pts && pts > 0, { got: r && r.point_count, pts });
  check("sample health check: walked about three weeks ago", r && Number.isFinite(r.stale_days) && r.stale_days >= 20 && r.stale_days <= 23, r && r.stale_days);
  check("sample health check: each receiver with its points and mean signal",
    r && r.scanner_summary.length > 0 && r.scanner_summary.every(s => s.source && Number.isFinite(s.point_count) && Number.isFinite(s.mean_rssi)),
    r && r.scanner_summary.slice(0, 3));
  check("sample health check: the keys the server sends", r && ["enabled", "point_count", "stale_days", "scanner_anomalies", "scanner_summary", "recommended_spots", "has_issues"]
    .every(k => k in r), r && Object.keys(r));
}

process.stdout.write(JSON.stringify(results) + "\n", () => process.exit(0));
