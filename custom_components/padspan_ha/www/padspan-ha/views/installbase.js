// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
// See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
/**
 * Install Base — the developer's view of what the opt-in reports add up to.
 *
 * Dev menu only, PadSpan Pro, and the server admits only a key on its
 * developer list (server/stats.php). Everything drawn here is a count over
 * other people's installs; the only per-install handle is the first eight
 * characters of a random id.
 *
 * Charts are inline SVG, one hue per chart, thin marks, a tooltip on hover.
 * Two measures never share an axis: pinging installs and reporting installs
 * are two small charts, not one with two scales.
 */

const ACCENT = "#38bdf8";       // the tab's colour; every data mark uses it
const INK = "#e2e8f0", INK2 = "#94a3b8", GRID = "rgba(148,163,184,.15)";
const STATUS = { warn: "#fbbf24", bad: "#f87171", good: "#52b788" };

const SVG_NS = "http://www.w3.org/2000/svg";
function svg(tag, attrs = {}, children = []) {
  const n = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v));
  for (const c of children) n.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
  return n;
}

let _cache = null;            // last stats payload, so a re-render is not a refetch
let _loading = false, _error = null;

export function render(ctx) {
  const { el, helpBtn } = ctx.helpers;
  const root = el("section", { id: "installbase" });
  const settings = ctx.state.settings || {};

  root.appendChild(el("div", { class: "row", style: "align-items:center;gap:8px;margin-bottom:14px;flex-wrap:wrap" }, [
    el("h2", {}, "Install Base"),
    helpBtn("installbase"),
    el("span", { class: "muted", style: "font-size:11px" }, "what the opt-in reports add up to"),
  ]));

  if (String(settings.tier || "") !== "pro") {
    root.appendChild(el("div", { class: "card" }, [
      el("div", { class: "h2" }, "PadSpan Pro"),
      el("div", { class: "muted" }, "The install-base dashboard presents your licence key to the stats server, and the server admits only keys on its developer list. Without a key there is nothing to present."),
    ]));
    return root;
  }

  const status = el("span", { class: "muted", style: "font-size:11px" }, "");
  const refresh = el("button", { class: "btn inline" }, "Refresh");
  refresh.addEventListener("click", () => load(true));
  root.appendChild(el("div", { style: "display:flex;gap:10px;align-items:center;margin-bottom:12px" }, [refresh, status]));
  const body = el("div");
  root.appendChild(body);

  const load = async (fresh) => {
    if (_loading) return;
    _loading = true; _error = null;
    status.textContent = fresh ? "Fetching…" : "Loading…";
    try {
      const r = await ctx.actions.wsCall("padspan_ha/install_base", fresh ? { fresh: true } : {});
      _cache = r.stats;
      status.textContent = (r.cached ? "cached · " : "") + "generated " + String(_cache.generated || "").replace("T", " ").slice(0, 16) + " UTC";
    } catch (e) {
      _error = (e && (e.message || e.code)) ? String(e.message || e.code) : "failed";
      status.textContent = "";
    }
    _loading = false;
    draw();
  };

  const draw = () => {
    body.innerHTML = "";
    if (_error) {
      body.appendChild(el("div", { class: "card warn" }, [
        el("div", { class: "h2" }, "Not available"),
        el("div", { class: "muted" }, _error),
      ]));
      return;
    }
    if (!_cache) { body.appendChild(el("div", { class: "muted" }, "Loading…")); return; }
    const s = _cache;

    // ── hero numbers ─────────────────────────────────────────────────────
    const tiles = el("div", { class: "grid", style: "margin-bottom:12px" });
    const tile = (label, value, sub) => el("div", { class: "card", style: "padding:10px 12px" }, [
      el("div", { class: "muted", style: "font-size:11px" }, label),
      el("div", { style: `font-size:26px;font-weight:700;color:${INK};line-height:1.2` }, String(value)),
      sub ? el("div", { class: "muted", style: "font-size:10px" }, sub) : el("span"),
    ]);
    const ins = s.installs || {}, pg = s.pings || {};
    // Today's figure is the honest one: a caller is a distinct IP, and IPv6
    // privacy addresses rotate, so the 30-day figure counts some installs
    // more than once.
    tiles.appendChild(tile("Pinging today", pg.distinct_today ?? "–", `distinct update-check callers · ${pg.distinct_window ?? 0} over ${s.window_days}d (IPv6 rotation overcounts)`));
    tiles.appendChild(tile("Reporting installs", ins.reporting_window ?? 0, `opted in and reported within ${s.window_days}d`));
    tiles.appendChild(tile("Active", ins.active ?? 0, `reported within ${s.active_days}d`));
    tiles.appendChild(tile("Lifetime", ins.lifetime ?? 0, "distinct ids ever seen (ledger)"));
    tiles.appendChild(tile("New", ins.new_window ?? 0, `first seen within ${s.window_days}d`));
    tiles.appendChild(tile("Lapsed", ins.lapsed ?? 0, `silent ${s.lapsed_days}d+`));
    tiles.appendChild(tile("Pro", ins.pro ?? 0, `Bright ${ins.bright ?? 0}`));
    body.appendChild(tiles);

    // ── per-day: two small multiples, one hue each ─────────────────────────
    const days = s.per_day || [];
    const two = el("div", { class: "grid-2", style: "margin-bottom:12px" });
    two.appendChild(chartCard(el, "Pinging installs per day", days, d => d.pings, d => d.day));
    two.appendChild(chartCard(el, "Reporting installs per day", days, d => d.installs, d => d.day));
    body.appendChild(two);

    // ── distributions ─────────────────────────────────────────────────────
    const dist = s.dist || {};
    const n = ins.reporting_window || Object.values(dist.version || {}).reduce((a, b) => a + b, 0) || 1;
    const g1 = el("div", { class: "grid", style: "margin-bottom:12px" });
    g1.appendChild(barList(el, "Version", dist.version, n));
    g1.appendChild(barList(el, "Home Assistant", dist.ha_version, n));
    g1.appendChild(barList(el, "Edition / tier", dist.tier, n));
    g1.appendChild(barList(el, "Pinging by version", pg.by_version, pg.distinct_window || 1, 8));
    g1.appendChild(barList(el, "Integrations present", s.integrations, n));
    body.appendChild(g1);

    const g2 = el("div", { class: "grid", style: "margin-bottom:12px" });
    for (const [k, label] of [["scanners", "Scanners"], ["floors", "Floors"], ["rooms", "Rooms"], ["maps", "Maps"],
                              ["calibration_points", "Calibration points"], ["irks", "IRKs"], ["walls", "Walls"],
                              ["placed_lights", "Placed lights"], ["objects_total", "Objects stored"]]) {
      g2.appendChild(barList(el, label, orderBuckets(dist[k]), n));
    }
    body.appendChild(g2);

    // ── BLE scan mode ─────────────────────────────────────────────────────
    // HA 2026.6 changed the default for every ESPHome proxy from active to
    // auto, overriding what each device's own firmware asked for. Most people
    // will not have noticed. Two different questions, so two different counts:
    // how much of the fleet sits in each mode (radios), and how many people
    // deliberately chose one (installs). `requested` is the choice; `mode` is
    // the momentary state, and an auto scanner reads passive nearly always.
    const smi = s.scan_mode_installs || {};
    if (Object.keys(s.scan_modes_requested || {}).length || Object.keys(smi).length) {
      const g2b = el("div", { class: "grid", style: "margin-bottom:12px" });
      g2b.appendChild(barList(el, "Scan mode chosen (radios)", s.scan_modes_requested, null));
      g2b.appendChild(barList(el, "Scan mode right now (radios)", s.scan_modes, null));
      const nWith = (smi.any_active || 0) + (smi.all_auto || 0) + (smi.any_passive_pinned || 0);
      g2b.appendChild(kv(el, "Who pinned a mode (installs)", [
        ["Pinned at least one ACTIVE", smi.any_active || 0],
        ["Pinned at least one PASSIVE", smi.any_passive_pinned || 0],
        ["Left everything on auto", smi.all_auto || 0],
        ["Too old to report it", smi.no_data || 0],
      ]));
      body.appendChild(g2b);
      if (nWith) {
        body.appendChild(el("div", { class: "muted", style: "margin:-6px 0 12px;font-size:12px" },
          `${Math.round(100 * (smi.all_auto || 0) / nWith)}% of installs that can report it have left every radio on auto — ` +
          "HA's 2026.6 default, which scans passively except in short promoted windows."));
      }
    }

    // ── flags, identity, geometry ─────────────────────────────────────────
    const g3 = el("div", { class: "grid", style: "margin-bottom:12px" });
    const flags = s.flags || {};
    const fc = el("div", { class: "card" }, [el("div", { class: "h2" }, "Health flags (installs affected)")]);
    const fkeys = Object.keys(flags);
    if (!fkeys.length) fc.appendChild(el("div", { class: "muted" }, "✓ none raised among installs that report them"));
    for (const k of fkeys) {
      const sev = /crypto|callback|faulted|desync|silent/.test(k) ? "bad" : "warn";
      fc.appendChild(el("div", { style: "display:flex;align-items:center;gap:8px;padding:3px 0;font-size:12px" }, [
        el("span", { style: `color:${STATUS[sev]};font-weight:700;width:14px` }, sev === "bad" ? "✖" : "⚠"),
        el("span", { style: `color:${INK};flex:1` }, k),
        el("span", { class: "badge" }, String(flags[k])),
      ]));
    }
    g3.appendChild(fc);
    const idn = s.identity || {};
    g3.appendChild(kv(el, "Identity", [
      ["Installs with IRKs registered", idn.with_irks],
      ["…resolving something", idn.resolving],
      ["…silent (keys that never match)", idn.silent],
      ["Installs with Private BLE Device", idn.private_ble_device],
    ]));
    const geo = s.geometry || {};
    g3.appendChild(kv(el, "Geometry", [
      ["Multi-floor installs", geo.multi_floor],
      ["Maps geometry-faulted", geo.faulted],
      ["Anchor faulted", geo.anchor_faulted],
      ["No metre anchor", `${geo.no_anchor ?? 0} of ${geo.no_anchor_known ?? 0} that can say`],
      ["Floors all default height", geo.floors_default],
      ["Scanner Z uniform", geo.z_uniform],
      ["Calibration points with no floor", geo.cal_no_floor],
    ]));
    body.appendChild(g3);

    // ── usage, tabs, errors ───────────────────────────────────────────────
    const g4 = el("div", { class: "grid", style: "margin-bottom:12px" });
    g4.appendChild(pairList(el, `Tabs opened (${s.window_days}d)`, s.tabs, "count"));
    g4.appendChild(pairList(el, `Tools used (${s.window_days}d)`, s.usage, "count"));
    g4.appendChild(pairList(el, "Warnings by module", s.errors, "lines"));
    g4.appendChild(barList(el, "Panel errors by view", s.ui_errors, null, 12));
    g4.appendChild(barList(el, "Features on (installs)", s.features, n, 40));
    body.appendChild(g4);

    // ── the table ─────────────────────────────────────────────────────────
    const rows = s.table || [];
    const card = el("div", { class: "card", style: "overflow-x:auto" });
    card.appendChild(el("div", { class: "h2" }, `Installs (${rows.length})`));
    const t = el("table", { style: "width:100%;border-collapse:collapse;font-size:11px" });
    const cols = ["id", "last", "days", "version", "ha", "tier", "scanners", "floors", "rooms", "maps", "cal", "irks", "irks_resolving", "objects", "identified", "pbd", "uptime", "flags"];
    const head = el("tr");
    for (const c of cols) head.appendChild(el("th", { style: `text-align:left;padding:4px 6px;color:${INK2};border-bottom:1px solid ${GRID};white-space:nowrap` }, c));
    t.appendChild(head);
    for (const r of rows) {
      const tr = el("tr");
      for (const c of cols) {
        let v = r[c];
        if (c === "flags") v = (v || []).join(", ") || "–";
        if (c === "pbd") v = r.bermuda ? `${v} +bermuda` : String(v);
        tr.appendChild(el("td", { style: `padding:4px 6px;border-bottom:1px solid ${GRID};white-space:nowrap;color:${c === "flags" && r.flags && r.flags.length ? STATUS.warn : INK}` }, String(v ?? "")));
      }
      t.appendChild(tr);
    }
    card.appendChild(t);
    body.appendChild(card);
    body.appendChild(el("div", { class: "muted", style: "font-size:10px;margin-top:6px" },
      `Spool from ${s.spool_first_day || "?"}; pings log from ${pg.first_day || "?"}. A flag counts only where the report carries the field.`));
  };

  if (_cache) draw(); else draw();
  if (!_cache) load(false);
  return root;
}

// ── pieces ───────────────────────────────────────────────────────────────────

function orderBuckets(map) {
  // "<= 2", "<= 4", "> 32" sort numerically, not as strings
  if (!map) return map;
  const keys = Object.keys(map).sort((a, b) => {
    const na = parseFloat(a.replace(/[^\d.-]/g, "")), nb = parseFloat(b.replace(/[^\d.-]/g, ""));
    if (a.startsWith(">") !== b.startsWith(">")) return a.startsWith(">") ? 1 : -1;
    return na - nb;
  });
  const out = {};
  for (const k of keys) out[k] = map[k];
  return out;
}

/** Horizontal bar list: label · thin bar · count. One hue. */
function barList(el, title, map, total, limit = 10) {
  const card = el("div", { class: "card" }, [el("div", { class: "h2" }, title)]);
  const entries = Object.entries(map || {});
  if (!entries.length) { card.appendChild(el("div", { class: "muted" }, "–")); return card; }
  const max = Math.max(...entries.map(([, v]) => Number(v) || 0), 1);
  for (const [k, v] of entries.slice(0, limit)) {
    const pct = Math.round((Number(v) / max) * 100);
    const row = el("div", { style: "display:grid;grid-template-columns:minmax(70px,38%) 1fr 34px;gap:8px;align-items:center;padding:2px 0;font-size:12px", title: total ? `${v} of ${total}` : String(v) });
    row.appendChild(el("span", { style: `color:${INK};overflow:hidden;text-overflow:ellipsis;white-space:nowrap` }, k));
    row.appendChild(el("div", { style: `height:6px;background:${GRID};border-radius:3px;overflow:hidden` }, [
      el("div", { style: `height:100%;width:${pct}%;background:${ACCENT};border-radius:3px` }),
    ]));
    row.appendChild(el("span", { style: `color:${INK2};text-align:right;font-variant-numeric:tabular-nums` }, String(v)));
    card.appendChild(row);
  }
  if (entries.length > limit) card.appendChild(el("div", { class: "muted", style: "font-size:10px" }, `+${entries.length - limit} more`));
  return card;
}

/** Like barList but each value is {count|lines, installs}. */
function pairList(el, title, map, field, limit = 12) {
  const card = el("div", { class: "card" }, [el("div", { class: "h2" }, title)]);
  const entries = Object.entries(map || {});
  if (!entries.length) { card.appendChild(el("div", { class: "muted" }, "–")); return card; }
  const max = Math.max(...entries.map(([, v]) => Number(v[field]) || 0), 1);
  for (const [k, v] of entries.slice(0, limit)) {
    const pct = Math.round((Number(v[field]) / max) * 100);
    const row = el("div", { style: "display:grid;grid-template-columns:minmax(70px,38%) 1fr 78px;gap:8px;align-items:center;padding:2px 0;font-size:12px" });
    row.appendChild(el("span", { style: `color:${INK};overflow:hidden;text-overflow:ellipsis;white-space:nowrap` }, k));
    row.appendChild(el("div", { style: `height:6px;background:${GRID};border-radius:3px;overflow:hidden` }, [
      el("div", { style: `height:100%;width:${pct}%;background:${ACCENT};border-radius:3px` }),
    ]));
    row.appendChild(el("span", { style: `color:${INK2};text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap` }, `${v[field]} · ${v.installs} inst`));
    card.appendChild(row);
  }
  if (entries.length > limit) card.appendChild(el("div", { class: "muted", style: "font-size:10px" }, `+${entries.length - limit} more`));
  return card;
}

function kv(el, title, pairs) {
  const card = el("div", { class: "card" }, [el("div", { class: "h2" }, title)]);
  for (const [k, v] of pairs) {
    card.appendChild(el("div", { style: "display:flex;justify-content:space-between;gap:8px;padding:3px 0;font-size:12px" }, [
      el("span", { style: `color:${INK}` }, k),
      el("span", { style: `color:${INK2};font-variant-numeric:tabular-nums` }, String(v ?? 0)),
    ]));
  }
  return card;
}

/** A single-series column chart with a hover tooltip. */
function chartCard(el, title, data, yOf, labelOf) {
  const W = 520, H = 130, PL = 28, PB = 18, PT = 8;
  const card = el("div", { class: "card", style: "position:relative" }, [el("div", { class: "h2" }, title)]);
  const vals = data.map(yOf).map(v => Number(v) || 0);
  const max = Math.max(...vals, 1);
  const plotW = W - PL - 6, plotH = H - PT - PB;
  const bw = Math.max(2, Math.floor(plotW / Math.max(data.length, 1)) - 2);
  const g = svg("svg", { viewBox: `0 0 ${W} ${H}`, width: "100%", height: "auto", style: "display:block;overflow:visible" });
  // recessive grid: three lines
  for (const f of [0, 0.5, 1]) {
    const y = PT + plotH - f * plotH;
    g.appendChild(svg("line", { x1: PL, x2: W - 6, y1: y, y2: y, stroke: GRID, "stroke-width": 1 }));
    g.appendChild(svg("text", { x: PL - 4, y: y + 3, "text-anchor": "end", "font-size": 9, fill: INK2 }, String(Math.round(max * f))));
  }
  const tip = el("div", { style: `position:absolute;display:none;pointer-events:none;background:#0c1a0e;border:1px solid ${GRID};border-radius:6px;padding:4px 8px;font-size:11px;color:${INK};white-space:nowrap` });
  data.forEach((d, i) => {
    const v = vals[i];
    const x = PL + i * (plotW / Math.max(data.length, 1)) + 1;
    const h = Math.round((v / max) * plotH);
    const y = PT + plotH - h;
    const bar = svg("rect", { x, y, width: bw, height: Math.max(h, v > 0 ? 2 : 0), rx: 2, fill: ACCENT });
    // hit target bigger than the mark
    const hit = svg("rect", { x: x - 1, y: PT, width: bw + 2, height: plotH, fill: "transparent" });
    hit.addEventListener("mouseenter", () => {
      tip.textContent = `${labelOf(d)} · ${v}`;
      tip.style.display = "block";
      // Compute against the chart's actual rendered width (not the viewBox's
      // 520) and clamp to a few px so a narrow single-column layout can't push
      // the tooltip past the card's left edge with a flat 30px offset.
      const rect = g.getBoundingClientRect();
      const cardRect = card.getBoundingClientRect();
      const scale = rect.width / W;
      const leftPx = Math.max(4, (rect.left - cardRect.left) + (x + bw / 2) * scale - 30);
      tip.style.left = `${leftPx.toFixed(1)}px`;
      tip.style.top = "30px";
      bar.setAttribute("fill", INK);
    });
    hit.addEventListener("mouseleave", () => { tip.style.display = "none"; bar.setAttribute("fill", ACCENT); });
    g.appendChild(bar); g.appendChild(hit);
    if (i === 0 || i === data.length - 1 || i === Math.floor(data.length / 2)) {
      g.appendChild(svg("text", { x: x + bw / 2, y: H - 4, "text-anchor": "middle", "font-size": 9, fill: INK2 }, String(labelOf(d)).slice(5)));
    }
  });
  card.appendChild(g);
  card.appendChild(tip);
  return card;
}
