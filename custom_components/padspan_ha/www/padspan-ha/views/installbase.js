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
 * Laid out like a survey report (State of JS): numbered sections, each with
 * a big title and one line saying what it counts, then a card per chart.
 * Bars are one hue (the panel's forest green), thin, with the share at the
 * tip and the count at the end; where a denominator exists the bar is a share
 * of it on a 0–100% scale, so bar lengths are comparable across cards. Every
 * chart has a Table toggle, so no value is reachable only by hovering.
 * Two measures never share an axis: pinging installs and reporting installs
 * are two small charts, not one with two scales.
 */

// The PIN sits in public source, so it's a casual lock; the server's developer-key check is the real gate.
const PIN = "4525";
const PIN_KEY = "padspan_installbase_unlocked";
let _unlocked = false;        // survives the 5 s re-render even when sessionStorage is blocked

const SVG_NS = "http://www.w3.org/2000/svg";
function svg(tag, attrs = {}, children = []) {
  const n = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v));
  for (const c of children) n.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
  return n;
}

let _cache = null;            // last stats payload, so a re-render is not a refetch
let _loading = false, _error = null;
let _stamp = "";              // "generated …" line, so a re-render keeps it
const _tables = new Set();    // cards showing their table instead of the chart (kept across re-renders)

function isUnlocked() {
  if (_unlocked) return true;
  try { return sessionStorage.getItem(PIN_KEY) === "1"; } catch (_) { return false; }
}

export function render(ctx) {
  const { el } = ctx.helpers;
  const root = el("section", { id: "installbase" });
  root.appendChild(styleEl());
  if (!isUnlocked()) {
    root.appendChild(pinGate(el, () => {
      root.replaceChildren(styleEl());
      renderUnlocked(ctx, root);
    }));
    return root;
  }
  renderUnlocked(ctx, root);
  return root;
}

function pinGate(el, onUnlock) {
  const input = el("input", {
    type: "password", inputmode: "numeric", autocomplete: "off", maxlength: "12",
    class: "ib-pin-input", "aria-label": "PIN", placeholder: "PIN",
  });
  const msg = el("div", { class: "ib-pin-msg", role: "status" }, "");
  const form = el("form", { class: "ib-pin" }, [
    el("div", { class: "ib-kicker" }, "Developer view"),
    el("div", { class: "ib-pin-title" }, "Install Base is locked"),
    el("div", { class: "ib-pin-sub" }, "Enter the PIN to see the opt-in report totals."),
    el("div", { class: "ib-pin-row" }, [input, el("button", { type: "submit", class: "ib-pin-btn" }, "Unlock")]),
    msg,
  ]);
  form.addEventListener("submit", (ev) => {
    ev.preventDefault();
    if (input.value === PIN) {
      _unlocked = true;
      try { sessionStorage.setItem(PIN_KEY, "1"); } catch (_) { /* blocked: asked again after a reload */ }
      onUnlock();
      return;
    }
    input.value = "";
    msg.textContent = "Wrong PIN";
    input.focus();
  });
  setTimeout(() => { try { input.focus(); } catch (_) { /**/ } }, 0);
  return el("div", { class: "ib-pin-wrap" }, [form]);
}

function renderUnlocked(ctx, root) {
  const { el, helpBtn } = ctx.helpers;
  const settings = ctx.state.settings || {};

  root.appendChild(el("header", { class: "ib-hero" }, [
    el("div", { class: "ib-kicker" }, "PadSpan opt-in reports"),
    el("div", { class: "ib-title-row" }, [el("h1", { class: "ib-h1" }, "Install Base"), helpBtn("installbase")]),
    el("p", { class: "ib-lede" }, "What the opt-in reports add up to. Every figure is a count over other people's installs; the only per-install handle is the first eight characters of a random id."),
  ]));

  if (String(settings.tier || "") !== "pro") {
    root.appendChild(el("div", { class: "card" }, [
      el("div", { class: "h2" }, "PadSpan Pro"),
      el("div", { class: "muted" }, "The install-base dashboard presents your licence key to the stats server, and the server admits only keys on its developer list. Without a key there is nothing to present."),
    ]));
    return root;
  }

  const status = el("span", { class: "ib-status" }, _stamp);
  const refresh = el("button", { class: "btn inline" }, "Refresh");
  refresh.addEventListener("click", () => load(true));
  root.appendChild(el("div", { class: "ib-toolbar" }, [refresh, status]));
  const body = el("div");
  root.appendChild(body);

  const load = async (fresh) => {
    if (_loading) return;
    _loading = true; _error = null;
    status.textContent = fresh ? "Fetching…" : "Loading…";
    try {
      const r = await ctx.actions.wsCall("padspan_ha/install_base", fresh ? { fresh: true } : {});
      _cache = r.stats;
      _stamp = (r.cached ? "cached · " : "") + "generated " + String(_cache.generated || "").replace("T", " ").slice(0, 16) + " UTC";
      status.textContent = _stamp;
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
    const ins = s.installs || {}, pg = s.pings || {};
    const dist = s.dist || {};
    const n = ins.reporting_window || Object.values(dist.version || {}).reduce((a, b) => a + b, 0) || 1;
    const W = s.window_days;
    const sections = [];
    const section = (title, lede, children) => {
      const num = String(sections.length + 1).padStart(2, "0");
      const sec = el("section", { class: "ib-sec" }, [
        el("div", { class: "ib-sec-head" }, [el("span", { class: "ib-num" }, num), el("h2", { class: "ib-h" }, title)]),
        el("p", { class: "ib-lede" }, lede),
        ...children,
      ]);
      sections.push([num, title, sec]);
      return sec;
    };
    const grid = (cards, wide) => el("div", { class: "ib-grid" + (wide ? " ib-grid-wide" : "") }, cards);

    // ── 01 reach ──────────────────────────────────────────────────────────
    // Today's figure is the honest one: a caller is a distinct IP, and IPv6
    // privacy addresses rotate, so the 30-day figure counts some installs
    // more than once.
    const tiles = el("div", { class: "ib-tiles" }, [
      tile(el, "Pinging today", pg.distinct_today ?? "–", `distinct update-check callers · ${fmt(pg.distinct_window ?? 0)} over ${W}d (IPv6 rotation overcounts)`),
      tile(el, "Active", ins.active ?? 0, `reported within ${s.active_days}d`),
      tile(el, "Lifetime", ins.lifetime ?? 0, "distinct ids ever seen (ledger)"),
      tile(el, "New", ins.new_window ?? 0, `first seen within ${W}d`),
      tile(el, "Lapsed", ins.lapsed ?? 0, `silent ${s.lapsed_days}d+`),
      tile(el, "Pro", ins.pro ?? 0, `Bright ${fmt(ins.bright ?? 0)}`),
    ]);
    const hero = el("div", { class: "ib-card ib-herofig" }, [
      el("div", { class: "ib-tile-label" }, "Reporting installs"),
      el("div", { class: "ib-herofig-value" }, fmt(ins.reporting_window ?? 0)),
      el("div", { class: "ib-tile-sub" }, `opted in and reported within ${W}d. Every share on this page is of these installs unless it says otherwise.`),
    ]);
    const days = s.per_day || [];
    section("Reach", "Who is out there. A ping is an update check from any install; a report comes only from installs that opted in.", [
      el("div", { class: "ib-figs" }, [hero, tiles]),
      grid([
        columnCard(el, "Pinging installs per day", "Distinct update-check callers each day", days, d => d.pings, d => d.day),
        columnCard(el, "Reporting installs per day", "Opted-in installs that sent a report each day", days, d => d.installs, d => d.day),
      ], true),
    ]);

    // ── 02 versions ───────────────────────────────────────────────────────
    section("Versions", `What people run, from each install's latest report. Shares are of the ${fmt(n)} reporting installs.`, [
      grid([
        barCard(el, { title: "Version", ask: "PadSpan version", map: dist.version, total: n }),
        barCard(el, { title: "Home Assistant", ask: "Home Assistant version", map: dist.ha_version, total: n }),
        barCard(el, { title: "Edition / tier", ask: "Edition and licence tier", map: dist.tier, total: n }),
        barCard(el, { title: "Pinging by version", ask: `Update-check callers over ${W}d, by version`, map: pg.by_version, total: pg.distinct_window || 1, unit: "callers", limit: 8 }),
      ]),
    ]);

    // ── 03 homes ──────────────────────────────────────────────────────────
    const homeCards = [barCard(el, { title: "Integrations present", ask: "Installs with each integration loaded", map: s.integrations, total: n })];
    for (const [k, label, ask] of [["scanners", "Scanners", "Bluetooth scanners"], ["floors", "Floors", "Floors"], ["rooms", "Rooms", "Rooms"],
                                   ["maps", "Maps", "Floor-plan maps"], ["calibration_points", "Calibration points", "Calibration points saved"],
                                   ["irks", "IRKs", "Phone keys (IRKs) registered"], ["walls", "Walls", "Walls drawn"],
                                   ["placed_lights", "Placed lights", "Lights placed on a map"], ["objects_total", "Objects stored", "Objects PadSpan holds"]]) {
      homeCards.push(barCard(el, { title: label, ask: `${ask}, bucketed`, map: orderBuckets(dist[k]), total: n, ranked: false }));
    }
    section("Homes", "How big the houses are and what else runs in them, bucketed from each install's latest report.", [grid(homeCards)]);

    // ── 04 radios ─────────────────────────────────────────────────────────
    // HA 2026.6 changed the default for every ESPHome proxy from active to
    // auto, overriding what each device's own firmware asked for. Most people
    // will not have noticed. Two different questions, so two different counts:
    // how much of the fleet sits in each mode (radios), and how many people
    // deliberately chose one (installs). `requested` is the choice; `mode` is
    // the momentary state, and an auto scanner reads passive nearly always.
    const smi = s.scan_mode_installs || {};
    if (Object.keys(s.scan_modes_requested || {}).length || Object.keys(smi).length) {
      const radios = (m) => Object.values(m || {}).reduce((a, b) => a + (Number(b) || 0), 0);
      const nWith = (smi.any_active || 0) + (smi.all_auto || 0) + (smi.any_passive_pinned || 0);
      const kids = [grid([
        barCard(el, { title: "Scan mode chosen (radios)", ask: "What each radio was set to", map: s.scan_modes_requested, total: radios(s.scan_modes_requested), unit: "radios" }),
        barCard(el, { title: "Scan mode right now (radios)", ask: "What each radio is doing at report time", map: s.scan_modes, total: radios(s.scan_modes), unit: "radios" }),
        kvCard(el, "Who pinned a mode (installs)", "Installs, by what they deliberately pinned", [
          ["Pinned at least one ACTIVE", smi.any_active || 0, n],
          ["Pinned at least one PASSIVE", smi.any_passive_pinned || 0, n],
          ["Left everything on auto", smi.all_auto || 0, n],
          ["Too old to report it", smi.no_data || 0, n],
        ]),
      ])];
      if (nWith) {
        kids.push(el("div", { class: "ib-callout" }, [
          el("span", { class: "ib-callout-fig" }, `${Math.round(100 * (smi.all_auto || 0) / nWith)}%`),
          el("span", {}, "of installs that can report it have left every radio on auto — HA's 2026.6 default, which scans passively except in short promoted windows."),
        ]));
      }
      section("Radios", "How the Bluetooth fleet scans: per radio for the fleet, per install for what people chose.", kids);
    }

    // ── 05 health ─────────────────────────────────────────────────────────
    const idn = s.identity || {}, geo = s.geometry || {};
    section("Health", "What's going wrong. A flag counts only where the report carries the field, so zero means none bad among installs that can say.", [
      grid([
        flagsCard(el, s.flags || {}, n),
        kvCard(el, "Identity", "Phone keys and Private BLE Device", [
          ["Installs with IRKs registered", idn.with_irks, n],
          ["…resolving something", idn.resolving, idn.with_irks],
          ["…silent (keys that never match)", idn.silent, idn.with_irks],
          ["Installs with Private BLE Device", idn.private_ble_device, n],
        ]),
        kvCard(el, "Geometry", "Map and height set-up", [
          ["Multi-floor installs", geo.multi_floor, n],
          ["Maps geometry-faulted", geo.faulted, n],
          ["Anchor faulted", geo.anchor_faulted, n],
          ["No metre anchor", `${fmt(geo.no_anchor ?? 0)} of ${fmt(geo.no_anchor_known ?? 0)} that can say`, null],
          ["Floors all default height", geo.floors_default, n],
          ["Scanner Z uniform", geo.z_uniform, n],
          ["Calibration points with no floor", geo.cal_no_floor, n],
        ]),
      ]),
    ]);

    // ── 06 usage ──────────────────────────────────────────────────────────
    const ad = s.adoption || {};
    const tok = s.type_override_kinds || {};
    section("Usage", `What gets used over the last ${W} days. Counts are events; the person icon is how many installs produced them.`, [
      grid([
        pairCard(el, `Tabs opened (${W}d)`, "Tab opens", s.tabs, "count"),
        pairCard(el, `Tools used (${W}d)`, "Tool and action events", s.usage, "count"),
        barCard(el, { title: "Features on (installs)", ask: "Installs with each feature switched on", map: s.features, total: n, limit: 40 }),
        kvCard(el, "Advanced feature adoption (installs)", "Installs that placed or used at least one", [
          ["Placed a motion sensor", ad.motion_sensors, n],
          ["Placed a temperature sensor", ad.temp_sensors, n],
          ["Placed a fan", ad.fans, n],
          ["Used a light type override (pro)", ad.type_overrides, n],
          ...Object.keys(tok).sort().map(k => [`  ↳ ${k}`, tok[k], null]),
        ]),
        pairCard(el, "Warnings by module", "Warning log lines", s.errors, "lines"),
        barCard(el, { title: "Panel errors by view", ask: "Panel errors caught in each view", map: s.ui_errors, unit: "errors", limit: 12 }),
      ]),
    ]);

    // ── 07 installs ───────────────────────────────────────────────────────
    const rows = s.table || [];
    section("Installs", `One row per install that reported within ${W}d, latest report first. ids are the first eight characters of a random id.`, [
      installsTable(el, rows),
      el("div", { class: "ib-note" },
        `Spool from ${s.spool_first_day || "?"}; pings log from ${pg.first_day || "?"}. A flag counts only where the report carries the field.`),
    ]);

    // section chips: jump within the page
    const nav = el("nav", { class: "ib-nav" });
    for (const [num, title, sec] of sections) {
      const chip = el("button", { class: "ib-chip", type: "button" }, [el("b", {}, num), title]);
      chip.addEventListener("click", () => sec.scrollIntoView({ behavior: "smooth", block: "start" }));
      nav.appendChild(chip);
    }
    body.appendChild(nav);
    for (const [, , sec] of sections) body.appendChild(sec);
  };

  draw();
  if (!_cache) load(false);
  return root;
}

// ── pieces ───────────────────────────────────────────────────────────────────

function fmt(v) {
  const x = Number(v);
  return Number.isFinite(x) && String(v).trim() !== "" ? x.toLocaleString() : String(v ?? "");
}

function pctOf(v, total) {
  if (!total) return null;
  const p = 100 * (Number(v) || 0) / total;
  return p > 0 && p < 1 ? "<1%" : `${Math.round(p)}%`;
}

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

const PERSON = () => svg("svg", { viewBox: "0 0 16 16", "aria-hidden": "true" }, [
  svg("circle", { cx: 8, cy: 5, r: 2.8 }),
  svg("path", { d: "M2.6 14c.7-2.9 2.8-4.4 5.4-4.4s4.7 1.5 5.4 4.4" }),
]);

function tile(el, label, value, sub) {
  return el("div", { class: "ib-card ib-tile" }, [
    el("div", { class: "ib-tile-label" }, label),
    el("div", { class: "ib-tile-value" }, fmt(value)),
    sub ? el("div", { class: "ib-tile-sub" }, sub) : null,
  ]);
}

/** A card: title, Table/Chart toggle, the question pill, then the chart or its table. */
function cardShell(el, title, ask, chart, table) {
  const head = el("div", { class: "ib-card-head" }, [el("div", { class: "ib-card-title" }, title)]);
  const body = el("div");
  const card = el("div", { class: "ib-card" }, [head, ask ? el("div", { class: "ib-q" }, ask) : null, body]);
  if (!table) { body.appendChild(chart()); return card; }
  const btn = el("button", { class: "ib-toggle", type: "button" });
  const paint = () => {
    const on = _tables.has(title);
    btn.textContent = on ? "Chart" : "Table";
    btn.setAttribute("aria-pressed", String(on));
    body.replaceChildren(on ? table() : chart());
  };
  btn.addEventListener("click", () => { if (_tables.has(title)) _tables.delete(title); else _tables.add(title); paint(); });
  head.appendChild(btn);
  paint();
  return card;
}

function empty(el) { return el("div", { class: "ib-empty" }, "–"); }

function dataTable(el, cols, rows) {
  const t = el("table", { class: "ib-table" });
  t.appendChild(el("tr", {}, cols.map((c, i) => el("th", { class: i ? "num" : "" }, c))));
  for (const r of rows) t.appendChild(el("tr", {}, r.map((v, i) => el("td", { class: i ? "num" : "" }, String(v)))));
  return el("div", { class: "ib-scroll" }, [t]);
}

/**
 * Horizontal bars, one hue. With a total, each bar is a share of it on a
 * fixed 0–100% scale (gridlines at quarters) and the share sits at the tip;
 * without one, bars scale to the largest value and only counts are shown.
 * `ranked` numbers the rows (a list sorted by count); bucketed distributions
 * keep their natural order and go unnumbered.
 */
function barCard(el, { title, ask, map, total = null, unit = "installs", limit = 10, ranked = true }) {
  const entries = Object.entries(map || {}).map(([k, v]) => [k, Number(v) || 0]);
  if (ranked) entries.sort((a, b) => b[1] - a[1]);
  const person = unit === "installs";
  const chart = () => {
    if (!entries.length) return empty(el);
    const shown = entries.slice(0, limit);
    const max = Math.max(...shown.map(e => e[1]), 1);
    const scale = total || max;
    const cw = Math.max(...shown.map(e => fmt(e[1]).length)) + (person ? 4 : 2);
    const cols = `${ranked ? "18px " : ""}minmax(60px,34%) minmax(0,1fr) ${cw}ch`;
    const wrap = el("div", { class: "ib-rows" + (total ? " ib-scaled" : ""), style: `--ib-cols:${cols}` });
    shown.forEach(([k, v], i) => {
      const w = Math.min(100, (v / scale) * 100);
      const p = total ? pctOf(v, total) : null;
      const inside = p && w >= 70;
      const fill = el("div", { class: "ib-fill", style: `width:${w.toFixed(2)}%${v > 0 ? ";min-width:2px" : ""}` },
        inside ? [el("span", { class: "ib-pct-in" }, p)] : []);
      wrap.appendChild(el("div", { class: "ib-row", title: total ? `${k}: ${fmt(v)} of ${fmt(total)} ${unit} (${p})` : `${k}: ${fmt(v)} ${unit}` }, [
        ranked ? el("span", { class: "ib-rank" }, String(i + 1)) : null,
        el("span", { class: "ib-label" }, k),
        el("div", { class: "ib-track" }, [fill, p && !inside ? el("span", { class: "ib-pct" }, p) : null]),
        el("span", { class: "ib-count" }, [person ? PERSON() : null, fmt(v)]),
      ]));
    });
    if (total) {
      wrap.appendChild(el("div", { class: "ib-axis" }, [
        ranked ? el("span") : null, el("span"),
        el("div", { class: "ib-axis-track" }, ["0%", "25%", "50%", "75%", "100%"].map((t, i) => el("span", { style: `left:${i * 25}%` }, t))),
        el("span"),
      ]));
    }
    const foot = [el("span", { class: "ib-foot-item" }, total ? [person ? PERSON() : null, `${fmt(total)} ${unit}`] : `${unit} · scaled to the largest`)];
    if (entries.length > limit) foot.push(el("span", { class: "ib-foot-item" }, `+${entries.length - limit} more in the table`));
    return el("div", {}, [wrap, el("div", { class: "ib-foot" }, foot)]);
  };
  const table = entries.length ? () => dataTable(el, total ? ["", unit, "share"] : ["", unit],
    entries.map(([k, v]) => total ? [k, fmt(v), pctOf(v, total)] : [k, fmt(v)])) : null;
  return cardShell(el, title, ask, chart, table);
}

/** Bars for values shaped {count|lines, installs}: events, with the installs that produced them. */
function pairCard(el, title, ask, map, field, limit = 12) {
  const entries = Object.entries(map || {}).map(([k, v]) => [k, Number(v && v[field]) || 0, Number(v && v.installs) || 0]);
  entries.sort((a, b) => b[1] - a[1]);
  const chart = () => {
    if (!entries.length) return empty(el);
    const shown = entries.slice(0, limit);
    const max = Math.max(...shown.map(e => e[1]), 1);
    const cw = Math.max(...shown.map(e => (fmt(e[1]) + fmt(e[2])).length)) + 6;
    const wrap = el("div", { class: "ib-rows", style: `--ib-cols:18px minmax(60px,34%) minmax(0,1fr) ${cw}ch` });
    shown.forEach(([k, v, inst], i) => {
      const w = (v / max) * 100;
      wrap.appendChild(el("div", { class: "ib-row", title: `${k}: ${fmt(v)} ${field} from ${fmt(inst)} installs` }, [
        el("span", { class: "ib-rank" }, String(i + 1)),
        el("span", { class: "ib-label" }, k),
        el("div", { class: "ib-track" }, [el("div", { class: "ib-fill", style: `width:${w.toFixed(2)}%${v > 0 ? ";min-width:2px" : ""}` })]),
        el("span", { class: "ib-count" }, [fmt(v), el("span", { class: "ib-sep" }, "·"), PERSON(), fmt(inst)]),
      ]));
    });
    const foot = [el("span", { class: "ib-foot-item" }, `${field} · scaled to the largest`)];
    if (entries.length > limit) foot.push(el("span", { class: "ib-foot-item" }, `+${entries.length - limit} more in the table`));
    return el("div", {}, [wrap, el("div", { class: "ib-foot" }, foot)]);
  };
  const table = entries.length ? () => dataTable(el, ["", field, "installs"], entries.map(([k, v, inst]) => [k, fmt(v), fmt(inst)])) : null;
  return cardShell(el, title, ask, chart, table);
}

/** Label · value · share. `of` is the denominator for the share (null: none). */
function kvCard(el, title, ask, triples) {
  return cardShell(el, title, ask, () => el("div", { class: "ib-kv" }, triples.map(([k, v, of]) => {
    const p = typeof v === "number" || v == null ? pctOf(v ?? 0, of) : null;
    return el("div", { class: "ib-kv-row" }, [
      el("span", { class: "ib-kv-label" }, k),
      el("span", { class: "ib-kv-value" }, fmt(v ?? 0)),
      el("span", { class: "ib-kv-pct" }, p || ""),
    ]);
  })));
}

function flagsCard(el, flags, n) {
  const keys = Object.keys(flags);
  return cardShell(el, "Health flags (installs affected)", "Installs where a health check reads bad", () => {
    if (!keys.length) return el("div", { class: "ib-ok" }, "✓ none raised among installs that report them");
    return el("div", { class: "ib-kv" }, keys.map(k => {
      const sev = /crypto|callback|faulted|desync|silent/.test(k) ? "bad" : "warn";
      return el("div", { class: "ib-kv-row" }, [
        el("span", { class: "ib-kv-label ib-flag" }, [
          el("span", { class: `ib-sev ib-sev-${sev}`, title: sev === "bad" ? "serious" : "warning" }, sev === "bad" ? "✖" : "⚠"), k,
        ]),
        el("span", { class: "ib-kv-value" }, fmt(flags[k])),
        el("span", { class: "ib-kv-pct" }, pctOf(flags[k], n) || ""),
      ]);
    }));
  });
}

function installsTable(el, rows) {
  const card = el("div", { class: "ib-card" }, [
    el("div", { class: "ib-card-head" }, [el("div", { class: "ib-card-title" }, `Installs (${rows.length})`)]),
  ]);
  const t = el("table", { class: "ib-table ib-installs" });
  const cols = ["id", "last", "days", "version", "ha", "tier", "scanners", "floors", "rooms", "maps", "cal", "irks", "irks_resolving", "objects", "identified", "pbd", "uptime", "flags"];
  const numeric = new Set(["days", "scanners", "floors", "rooms", "maps", "cal", "irks", "irks_resolving", "objects", "identified"]);
  t.appendChild(el("tr", {}, cols.map(c => el("th", { class: numeric.has(c) ? "num" : "" }, c))));
  for (const r of rows) {
    const tr = el("tr");
    for (const c of cols) {
      let v = r[c];
      if (c === "flags") v = (v || []).join(", ") || "–";
      if (c === "pbd") v = r.bermuda ? `${v} +bermuda` : String(v);
      const cls = [numeric.has(c) ? "num" : "", c === "id" ? "mono" : "", c === "flags" && r.flags && r.flags.length ? "ib-flagged" : ""].filter(Boolean).join(" ");
      tr.appendChild(el("td", { class: cls }, numeric.has(c) ? fmt(v ?? "") : String(v ?? "")));
    }
    t.appendChild(tr);
  }
  card.appendChild(el("div", { class: "ib-scroll" }, [t]));
  return card;
}

/** A single-series column chart with a hover tooltip, plus a table view. */
function columnCard(el, title, ask, data, yOf, labelOf) {
  const chart = () => {
    // Narrower viewBox on a phone so the 9px axis text stays about 9px once scaled.
    const W = (typeof window !== "undefined" && window.innerWidth < 720) ? 340 : 520;
    const H = 150, PL = 30, PB = 20, PT = 10, PR = 6;
    const wrap = el("div", { class: "ib-cols-chart" });
    const vals = data.map(yOf).map(v => Number(v) || 0);
    if (!vals.length) return empty(el);
    const max = Math.max(...vals, 1);
    const plotW = W - PL - PR, plotH = H - PT - PB;
    const slot = plotW / Math.max(data.length, 1);
    const bw = Math.max(2, Math.min(24, slot - 2));
    const g = svg("svg", { viewBox: `0 0 ${W} ${H}`, width: "100%", style: "display:block;overflow:visible" });
    // recessive grid: three hairlines
    for (const f of [0, 0.5, 1]) {
      const y = PT + plotH - f * plotH;
      g.appendChild(svg("line", { x1: PL, x2: W - PR, y1: y, y2: y, style: "stroke:var(--ib-grid)", "stroke-width": 1 }));
      g.appendChild(svg("text", { x: PL - 6, y: y + 3, "text-anchor": "end", "font-size": 9, style: "fill:var(--ib-ink3)" }, Math.round(max * f).toLocaleString()));
    }
    const tip = el("div", { class: "ib-tip" });
    // The last entry is always today (stats.php builds per_day oldest-first,
    // today last) and is still accumulating for the rest of the Pacific day —
    // plotted as an equal bar next to finished days, a normal mid-day dip here
    // reads as a cliff. Dimmed + labelled so it isn't compared 1:1 with a
    // completed day at a glance.
    const todayIdx = data.length - 1;
    data.forEach((d, i) => {
      const isToday = i === todayIdx;
      const v = vals[i];
      const x = PL + i * slot + (slot - bw) / 2;
      const h = Math.max(Math.round((v / max) * plotH), v > 0 ? 2 : 0);
      const y = PT + plotH - h;
      const r = Math.min(4, h, bw / 2);
      // 4px rounded data-end, square at the baseline
      const bar = svg("path", {
        d: h ? `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + bw - r}Q${x + bw},${y} ${x + bw},${y + r}V${y + h}Z` : "",
        style: "fill:var(--ib-accent)", opacity: isToday ? 0.45 : 1,
      });
      // hit target bigger than the mark
      const hit = svg("rect", { x: PL + i * slot, y: PT, width: slot, height: plotH, fill: "transparent" });
      hit.addEventListener("mouseenter", () => {
        tip.textContent = isToday ? `${labelOf(d)} · ${v.toLocaleString()} so far (today, still counting)` : `${labelOf(d)} · ${v.toLocaleString()}`;
        tip.style.display = "block";
        // Compute against the chart's actual rendered width (not the viewBox's
        // width) and clamp so a narrow single-column layout can't push the
        // tooltip past either edge of the card.
        const rect = g.getBoundingClientRect();
        const wrapRect = wrap.getBoundingClientRect();
        const scale = rect.width / W;
        const centre = (rect.left - wrapRect.left) + (x + bw / 2) * scale;
        const leftPx = Math.max(0, Math.min(wrapRect.width - tip.offsetWidth, centre - tip.offsetWidth / 2));
        tip.style.left = `${leftPx.toFixed(1)}px`;
        bar.style.fill = "var(--ib-ink)";
      });
      hit.addEventListener("mouseleave", () => { tip.style.display = "none"; bar.style.fill = "var(--ib-accent)"; });
      g.appendChild(bar); g.appendChild(hit);
      if (i === 0 || i === data.length - 1 || i === Math.floor(data.length / 2)) {
        const anchor = i === 0 ? "start" : i === data.length - 1 ? "end" : "middle";
        const tx = anchor === "start" ? x : anchor === "end" ? x + bw : x + bw / 2;
        g.appendChild(svg("text", { x: tx, y: H - 5, "text-anchor": anchor, "font-size": 9, style: "fill:var(--ib-ink3)" }, String(labelOf(d)).slice(5) + (isToday ? " (today)" : "")));
      }
    });
    wrap.appendChild(g);
    wrap.appendChild(tip);
    const last = vals.length > 1 ? vals[vals.length - 2] : null;
    return el("div", {}, [wrap, el("div", { class: "ib-foot" }, [
      el("span", { class: "ib-foot-item" }, `peak ${max.toLocaleString()}`),
      last != null ? el("span", { class: "ib-foot-item" }, `yesterday ${last.toLocaleString()}`) : null,
      el("span", { class: "ib-foot-item" }, "today dimmed, still counting"),
    ])]);
  };
  const table = data.length ? () => dataTable(el, ["day", "count"],
    data.map((d, i) => [labelOf(d) + (i === data.length - 1 ? " (today, so far)" : ""), fmt(yOf(d) ?? 0)]).reverse()) : null;
  return cardShell(el, title, ask, chart, table);
}

function styleEl() {
  const st = document.createElement("style");
  st.textContent = `
#installbase{--ib-ink:#e8f0ea;--ib-ink2:rgba(226,240,232,.66);--ib-ink3:rgba(226,240,232,.44);--ib-line:#1b3526;
  --ib-grid:rgba(120,190,155,.15);--ib-stripe:rgba(120,190,155,.045);--ib-surface:#0f1a12;--ib-accent:#45a878;
  --ib-warn:#fbbf24;--ib-bad:#f87171;--ib-mono:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;
  max-width:1280px;margin:0 auto;padding:0 0 40px;color:var(--ib-ink)}
#installbase *{box-sizing:border-box}
#installbase .ib-kicker{font:600 11px/1 var(--ib-mono);letter-spacing:.14em;text-transform:uppercase;color:var(--ib-accent)}
#installbase .ib-hero{padding:14px 0 4px}
#installbase .ib-title-row{display:flex;align-items:center;gap:12px;margin-top:10px}
#installbase .ib-h1{margin:0;font-size:clamp(32px,6vw,54px);line-height:.95;font-weight:800;letter-spacing:-.015em;text-transform:uppercase}
#installbase .ib-lede{margin:10px 0 0;max-width:76ch;font-size:13px;line-height:1.65;color:var(--ib-ink2)}
#installbase .ib-toolbar{display:flex;flex-wrap:wrap;gap:10px;align-items:center;margin:16px 0 0}
#installbase .ib-status{font-size:11px;color:var(--ib-ink3)}
#installbase .ib-nav{display:flex;flex-wrap:wrap;gap:6px;margin:18px 0 0;padding:12px 0;border-top:1px dashed var(--ib-line);border-bottom:1px dashed var(--ib-line)}
#installbase .ib-chip{width:auto;margin:0;background:transparent;border:1px dashed rgba(120,190,155,.38);border-radius:999px;padding:5px 11px;color:var(--ib-ink2);font-size:11px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;cursor:pointer}
#installbase .ib-chip b{font-family:var(--ib-mono);color:var(--ib-accent);margin-right:6px}
#installbase .ib-chip:hover{color:var(--ib-ink);border-style:solid;background:rgba(120,190,155,.08)}
#installbase .ib-sec{padding:38px 0 0;scroll-margin-top:10px}
#installbase .ib-sec-head{display:flex;align-items:baseline;gap:12px}
#installbase .ib-num{font:700 14px/1 var(--ib-mono);color:var(--ib-accent)}
#installbase .ib-h{margin:0;font-size:clamp(24px,3.8vw,34px);line-height:1;font-weight:800;letter-spacing:-.01em;text-transform:uppercase}
#installbase .ib-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,340px),1fr));gap:14px;margin-top:18px}
#installbase .ib-grid-wide{grid-template-columns:repeat(auto-fill,minmax(min(100%,460px),1fr))}
#installbase .ib-card{background:var(--ib-surface);border:1px solid var(--ib-line);border-radius:14px;padding:16px 16px 12px;min-width:0;position:relative}
#installbase .ib-card-head{display:flex;align-items:center;justify-content:space-between;gap:8px}
#installbase .ib-card-title{font-size:14px;font-weight:700;color:var(--ib-ink);min-width:0}
#installbase .ib-toggle{width:auto;margin:0;padding:3px 10px;border-radius:999px;background:transparent;border:1px solid var(--ib-line);color:var(--ib-ink2);font-size:10px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;cursor:pointer;flex-shrink:0}
#installbase .ib-toggle:hover{border-color:var(--ib-accent);color:var(--ib-ink)}
#installbase .ib-toggle[aria-pressed="true"]{border-color:var(--ib-accent);color:var(--ib-ink);background:rgba(69,168,120,.12)}
#installbase .ib-q{margin:10px 0 12px;padding:7px 12px;border-radius:999px;background:rgba(120,190,155,.07);font-size:11px;color:var(--ib-ink2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
#installbase .ib-rows{display:flex;flex-direction:column}
#installbase .ib-row,#installbase .ib-axis{display:grid;grid-template-columns:var(--ib-cols);column-gap:10px;align-items:center;padding:0 6px;font-size:12px}
#installbase .ib-row{min-height:30px;border-radius:6px}
#installbase .ib-row:nth-child(odd){background:var(--ib-stripe)}
#installbase .ib-row:hover{background:rgba(120,190,155,.13)}
#installbase .ib-rank{color:var(--ib-ink3);font:500 11px/1 var(--ib-mono);text-align:right}
#installbase .ib-label{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--ib-ink)}
#installbase .ib-track{align-self:stretch;display:flex;align-items:center;min-width:0}
#installbase .ib-scaled .ib-track{background:linear-gradient(90deg,var(--ib-grid) 1px,transparent 1px) 0 0/25% 100% repeat-x;box-shadow:inset -1px 0 0 var(--ib-grid)}
#installbase .ib-fill{position:relative;height:14px;background:var(--ib-accent);border-radius:0 4px 4px 0}
#installbase .ib-pct{margin-left:6px;font-size:10px;font-weight:600;color:var(--ib-ink2);font-variant-numeric:tabular-nums;white-space:nowrap}
#installbase .ib-pct-in{position:absolute;right:6px;top:50%;transform:translateY(-50%);font-size:10px;font-weight:700;color:#06200f;font-variant-numeric:tabular-nums}
#installbase .ib-count{display:inline-flex;align-items:center;justify-content:flex-end;gap:4px;color:var(--ib-ink2);font-size:11px;font-variant-numeric:tabular-nums;white-space:nowrap}
#installbase .ib-count svg,#installbase .ib-foot-item svg{width:12px;height:12px;stroke:currentColor;fill:none;stroke-width:1.5;flex-shrink:0}
#installbase .ib-sep{color:var(--ib-ink3);margin:0 2px}
#installbase .ib-axis{height:18px}
#installbase .ib-axis-track{position:relative;height:100%}
#installbase .ib-axis-track span{position:absolute;top:5px;transform:translateX(-50%);font-size:9px;color:var(--ib-ink3);font-variant-numeric:tabular-nums}
#installbase .ib-axis-track span:first-child{transform:none}
#installbase .ib-axis-track span:last-child{transform:translateX(-100%)}
#installbase .ib-foot{display:flex;flex-wrap:wrap;gap:6px 14px;align-items:center;margin-top:10px;padding-top:10px;border-top:1px solid var(--ib-grid);font-size:10px;color:var(--ib-ink3)}
#installbase .ib-foot-item{display:inline-flex;align-items:center;gap:4px}
#installbase .ib-empty{padding:10px 0;color:var(--ib-ink3)}
#installbase .ib-ok{padding:6px 0;font-size:12px;color:var(--ib-ink2)}
#installbase .ib-kv{display:flex;flex-direction:column}
#installbase .ib-kv-row{display:grid;grid-template-columns:minmax(0,1fr) auto 40px;gap:10px;align-items:center;min-height:28px;padding:0 6px;border-radius:6px;font-size:12px}
#installbase .ib-kv-row:nth-child(odd){background:var(--ib-stripe)}
#installbase .ib-kv-label{color:var(--ib-ink);white-space:pre-wrap;min-width:0}
#installbase .ib-kv-value{color:var(--ib-ink);font-weight:600;font-variant-numeric:tabular-nums;text-align:right}
#installbase .ib-kv-pct{color:var(--ib-ink3);font-size:10px;font-variant-numeric:tabular-nums;text-align:right}
#installbase .ib-flag{display:flex;align-items:center;gap:8px;font-family:var(--ib-mono);font-size:11px}
#installbase .ib-sev{font-weight:700;width:14px;text-align:center;font-family:inherit}
#installbase .ib-sev-warn{color:var(--ib-warn)}
#installbase .ib-sev-bad{color:var(--ib-bad)}
#installbase .ib-figs{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,2.2fr);gap:14px;margin-top:18px}
#installbase .ib-herofig{display:flex;flex-direction:column;justify-content:center;background:linear-gradient(160deg,rgba(69,168,120,.16),rgba(15,26,18,1) 70%);border-color:rgba(69,168,120,.35)}
#installbase .ib-herofig-value{font-size:64px;line-height:1;font-weight:800;letter-spacing:-.02em;margin:8px 0 10px;color:var(--ib-ink)}
#installbase .ib-tiles{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px}
#installbase .ib-tile{padding:14px}
#installbase .ib-tile-label{font-size:11px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;color:var(--ib-ink2)}
#installbase .ib-tile-value{font-size:28px;line-height:1.1;font-weight:700;margin-top:6px;color:var(--ib-ink)}
#installbase .ib-tile-sub{font-size:10px;line-height:1.45;margin-top:4px;color:var(--ib-ink3)}
#installbase .ib-cols-chart{position:relative}
#installbase .ib-tip{position:absolute;top:-6px;display:none;pointer-events:none;background:#0a150e;border:1px solid var(--ib-line);border-radius:8px;padding:5px 9px;font-size:11px;color:var(--ib-ink);white-space:nowrap;box-shadow:0 6px 18px rgba(0,0,0,.4)}
#installbase .ib-callout{display:flex;align-items:baseline;gap:12px;margin-top:14px;padding:14px 16px;border:1px dashed rgba(120,190,155,.38);border-radius:14px;font-size:13px;line-height:1.5;color:var(--ib-ink2)}
#installbase .ib-callout-fig{font-size:30px;font-weight:800;color:var(--ib-ink);flex-shrink:0}
#installbase .ib-scroll{overflow-x:auto;-webkit-overflow-scrolling:touch;max-width:100%}
#installbase .ib-table{width:100%;border-collapse:collapse;font-size:11px}
#installbase .ib-table th{text-align:left;padding:6px 8px;color:var(--ib-ink3);font-weight:600;letter-spacing:.04em;text-transform:uppercase;font-size:9px;border-bottom:1px solid var(--ib-line);white-space:nowrap}
#installbase .ib-table td{padding:6px 8px;border-bottom:1px solid var(--ib-grid);white-space:nowrap;color:var(--ib-ink)}
#installbase .ib-table tr:nth-child(even) td{background:var(--ib-stripe)}
#installbase .ib-table .num{text-align:right;font-variant-numeric:tabular-nums}
#installbase .ib-table .mono{font-family:var(--ib-mono);color:var(--ib-accent)}
#installbase .ib-table .ib-flagged{color:var(--ib-warn)}
#installbase .ib-installs{margin-top:10px}
#installbase .ib-note{margin-top:10px;font-size:10px;color:var(--ib-ink3)}
#installbase .ib-pin-wrap{display:flex;justify-content:center;padding:12vh 0 40px}
#installbase .ib-pin{width:min(100%,320px);background:var(--ib-surface);border:1px solid var(--ib-line);border-radius:16px;padding:22px 20px;text-align:center}
#installbase .ib-pin-title{margin-top:10px;font-size:18px;font-weight:800;text-transform:uppercase;letter-spacing:-.005em}
#installbase .ib-pin-sub{margin-top:6px;font-size:12px;color:var(--ib-ink2)}
#installbase .ib-pin-row{display:flex;gap:8px;margin-top:16px}
#installbase .ib-pin-input{flex:1;min-width:0;margin:0;padding:9px 12px;border-radius:10px;border:1px solid #2d6a4f;background:#0a150e;color:var(--ib-ink);font-size:16px;letter-spacing:.3em;text-align:center}
#installbase .ib-pin-input:focus{outline:2px solid var(--ib-accent);outline-offset:1px}
#installbase .ib-pin-btn{width:auto;margin:0;padding:9px 14px;border-radius:10px;border:1px solid var(--ib-accent);background:rgba(69,168,120,.18);color:var(--ib-ink);font-weight:700;cursor:pointer}
#installbase .ib-pin-btn:hover{background:rgba(69,168,120,.3)}
#installbase .ib-pin-msg{min-height:16px;margin-top:10px;font-size:12px;color:var(--ib-bad)}
@media (max-width:720px){
  #installbase .ib-figs{grid-template-columns:minmax(0,1fr)}
  #installbase .ib-tiles{grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}
  #installbase .ib-herofig-value{font-size:52px}
  #installbase .ib-card{padding:14px 12px 10px}
  #installbase .ib-sec{padding-top:30px}
  #installbase .ib-axis-track span:nth-child(2n){display:none}
}`;
  return st;
}
