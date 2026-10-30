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
// Sections open (the rest fold to one line with their headline) and lists
// showing every row, both kept across re-renders. Summary first, the rest on
// demand: only Reach and Needs attention start open.
const _open = new Set(["Reach", "Needs attention"]);
const _more = new Set();
const SHORT = 6;              // a ranked list shows its top SHORT until "Show all"
const SHORT_ROWS = 8;         // a long table shows its first SHORT_ROWS until "Show all"

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
    el("p", { class: "ib-lede" }, "What the usage reports add up to, from installs that turned the report on (Settings → Tracking). Every figure is a count across homes; nothing here says who or where anyone is. Hover a row to see the report's own name for it."),
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
    // The distributions, features and table come from every install's latest
    // report in the whole spool, not only the window: divided by the window's
    // count they read over 100%. Their own total is the base for their shares.
    const n = Object.values(dist.version || {}).reduce((a, b) => a + (Number(b) || 0), 0) || ins.reporting_window || 1;
    const W = s.window_days;
    const sections = [];
    // A section folds to one line: its number, title and headline (the few
    // figures that matter); open, its explanation and cards.
    const section = (title, lede, children, headline = "") => {
      const num = String(sections.length + 1).padStart(2, "0");
      const sec = el("details", { class: "ib-sec", ...(_open.has(title) ? { open: "" } : {}) }, [
        el("summary", { class: "ib-sec-head" }, [
          el("span", { class: "ib-chev", "aria-hidden": "true" }, "▸"),
          el("span", { class: "ib-num" }, num), el("h2", { class: "ib-h" }, title),
          headline ? el("span", { class: "ib-headline" }, headline) : null,
        ]),
        el("div", { class: "ib-sec-body" }, [lede ? el("p", { class: "ib-lede" }, lede) : null, ...children]),
      ]);
      sec.addEventListener("toggle", () => { if (sec.open) _open.add(title); else _open.delete(title); });
      sections.push([num, title, sec, headline]);
      return sec;
    };
    const top = (map, field = null) => {
      let best = null;
      // "?" and "–" (not known) never lead a headline.
      for (const [k, v] of Object.entries(map || {})) { const x = Number(field ? v && v[field] : v) || 0; if (k !== "?" && k !== "–" && (!best || x > best[1])) best = [k, x]; }
      return best;
    };
    const grid = (cards, wide) => el("div", { class: "ib-grid" + (wide ? " ib-grid-wide" : "") }, cards);
    const jump = (title) => {
      const hit = sections.find(x => x[1] === title);
      if (!hit) return;
      hit[2].open = true;
      hit[2].scrollIntoView({ behavior: "smooth", block: "start" });
    };

    // ── 01 reach ──────────────────────────────────────────────────────────
    // Today's figure is the honest one: a caller is a distinct IP, and IPv6
    // privacy addresses rotate, so the 30-day figure counts some installs
    // more than once.
    const _days = s.per_day || [];
    const homesYesterday = _days.length > 1 ? _days[_days.length - 2].pings : null;
    const tiles = el("div", { class: "ib-tiles" }, [
      // Homes running: the last FULL day's update checks, by address (a
      // home's address rarely changes within a day). The 30-day figure counts
      // addresses, which rotate, so one home shows up many times: never homes
      // (2026-10-29: read as "1,600 homes" when about 400 run PadSpan).
      tile(el, "Homes running", homesYesterday ?? "–", `different homes that checked for an update yesterday, opted in or not · ${fmt(pg.distinct_today ?? 0)} so far today`),
      tile(el, "Active", ins.active ?? 0, `sent a usage report in the last ${s.active_days} days`),
      tile(el, "Ever reported", ins.lifetime ?? 0, "installs that have ever sent a usage report"),
      tile(el, "New", ins.new_window ?? 0, `first report in the last ${W} days`),
      tile(el, "Gone quiet", ins.lapsed ?? 0, `no report for ${s.lapsed_days}+ days`),
      tile(el, "Pro", ins.pro ?? 0, `on a Pro licence · Bright (Atlas only) ${fmt(ins.bright ?? 0)}`),
    ]);
    const hero = el("div", { class: "ib-card ib-herofig" }, [
      el("div", { class: "ib-tile-label" }, "Installs sharing a report"),
      el("div", { class: "ib-herofig-value" }, fmt(ins.reporting_window ?? 0)),
      el("div", { class: "ib-tile-sub" }, `turned the usage report on and sent one in the last ${W} days.`),
    ]);
    const days = s.per_day || [];
    section("Reach", "How many homes run PadSpan. Every install checks for updates (a ping), which is how all of them are counted; only the ones that turned the usage report on say anything more.", [
      el("div", { class: "ib-figs" }, [hero, tiles]),
      grid([
        columnCard(el, "Homes running, per day", "Different homes that checked for an update that day (all installs, opted in or not)", days, d => d.pings, d => d.day),
        columnCard(el, "Installs reporting, per day", "Installs that sent a usage report that day (opted in only)", days, d => d.installs, d => d.day),
      ], true),
    ], `${fmt(homesYesterday ?? 0)} homes running · ${fmt(ins.reporting_window ?? 0)} sharing a report · ${fmt(ins.new_window ?? 0)} new · ${fmt(ins.lapsed ?? 0)} gone quiet`);

    // ── needs attention ──
    // What a reader should look at first, worked out from the numbers below:
    // a setup problem in a fifth of homes or more, warnings and errors, the 3D
    // view falling back, how many run the newest PadSpan. Each opens its section.
    const att = [];
    const flagN = (k) => Number((s.flags || {})[k]) || 0;
    const many = (x, one, more) => `${fmt(x)} ${Number(x) === 1 ? one : more}`;
    for (const k of Object.keys(s.flags || {}).sort((a, b) => flagN(b) - flagN(a))) {
      if (flagN(k) / n >= 0.2) att.push({ sev: /crypto|callback|faulted|desync|silent/.test(k) ? "bad" : "warn", text: word("flag", k),
                                          fig: `${many(flagN(k), "home", "homes")} · ${pctOf(flagN(k), n)}`, go: "Health", name: k });
    }
    const sumOf = (m, f) => Object.values(m || {}).reduce((a, v) => a + (Number(f ? v && v[f] : v) || 0), 0);
    const maxOf = (m, f) => Math.max(0, ...Object.values(m || {}).map(v => Number(v && v[f]) || 0));
    const logLines = sumOf(s.errors, "lines");
    if (logLines) att.push({ sev: "warn", text: "Warnings PadSpan wrote to the Home Assistant log", fig: `${many(logLines, "line", "lines")} · up to ${many(maxOf(s.errors, "installs"), "home", "homes")}`, go: "Usage" });
    const uiErr = sumOf(s.ui_errors);
    if (uiErr) att.push({ sev: "warn", text: "Errors caught in the PadSpan panel", fig: many(uiErr, "error", "errors"), go: "Usage" });
    const fb = Object.fromEntries(Object.entries(s.usage || {}).filter(([k]) => /^house3d_fallback/.test(k)));
    if (Object.keys(fb).length) att.push({ sev: "warn", text: "The 3D house couldn't show, and the flat Atlas did instead", fig: `${many(sumOf(fb, "count"), "time", "times")} · up to ${many(maxOf(fb, "installs"), "home", "homes")}`, go: "Usage" });
    if (ins.lapsed) att.push({ sev: "info", text: `Installs gone quiet (no report for ${s.lapsed_days}+ days)`, fig: fmt(ins.lapsed), go: "Installs" });
    const semver = (v) => String(v).split(".").map(Number);
    const vers = Object.keys(dist.version || {}).filter(v => /^\d+(\.\d+)*$/.test(v))
      .sort((a, b) => { const x = semver(a), y = semver(b); for (let i = 0; i < Math.max(x.length, y.length); i++) if ((y[i] || 0) !== (x[i] || 0)) return (y[i] || 0) - (x[i] || 0); return 0; });
    if (vers.length) att.push({ sev: "info", text: `On the newest PadSpan that reports (${vers[0]})`, fig: `${fmt(dist.version[vers[0]])} · ${pctOf(dist.version[vers[0]], n)}`, go: "Versions" });
    const nBad = att.filter(a => a.sev === "bad").length, nWarn = att.filter(a => a.sev === "warn").length;
    const attList = el("div", { class: "ib-att" }, att.length ? att.map(a => {
      const row = el("button", { class: `ib-att-row ib-att-${a.sev}`, type: "button", title: `Open ${a.go}` + (a.name ? `\nreport name: ${a.name}` : "") }, [
        el("span", { class: "ib-att-dot", "aria-hidden": "true" }),
        el("span", { class: "ib-att-text" }, a.text),
        el("span", { class: "ib-att-fig" }, a.fig),
        el("span", { class: "ib-att-go", "aria-hidden": "true" }, "→"),
      ]);
      row.addEventListener("click", () => jump(a.go));
      return row;
    }) : [el("div", { class: "ib-ok" }, "✓ Nothing stands out")]);
    section("Needs attention", "", [attList],
      nBad || nWarn ? [nBad ? `${nBad} serious` : null, nWarn ? `${nWarn} to look at` : null].filter(Boolean).join(" · ") : "nothing stands out");

    // ── new installs ──────────────────────────────────────────────────────
    const ni = s.new_installs;
    if (ni && (ni.weeks || []).length) {
      const fr = (h, of) => (of ? `${h}/${of}` : "–");
      const st = ni.stages || {};
      const stageWords = ["none", "map", "rooms", "receivers", "calibrated"];
      section("New installs", "Do new people stick with it? Each install is counted in the week it first sent a report. \"Brand new\" means that first report came from an install under a week old, not an old one that just turned reporting on (known from PadSpan 0.38.173; – before). \"Still here\" means it reported in the last 2 days. Day 7 and day 30 count only installs old enough to have got there.", [
        grid([
          cardShell(el, "By the week they started", "New installs that week, and how many are still running PadSpan", () =>
            dataTable(el, ["week of", "new", "brand new", "still here", "still at day 7", "still at day 30", "only 1 report"],
              ni.weeks.slice().reverse().map(w => [w.week, w.new, fr(w.really_new, w.age_known), w.still, fr(w.d7, w.d7_of), fr(w.d30, w.d30_of), w.one]), "weeks")),
          cardShell(el, "How far they got with setup", "New installs from the last 30 days, by the furthest setup step they reached", () =>
            dataTable(el, ["", ...stageWords.map(w => word("stage", w))],
              [["still here", ...stageWords.map(w => (st.still || {})[w] || 0)],
               ["stopped reporting", ...stageWords.map(w => (st.quiet || {})[w] || 0)]])),
        ], true),
        cardShell(el, `Stopped reporting (${(ni.quiet || []).length})`, "Started in the last 60 days, then nothing for 7+ days: where each one stopped", () =>
          dataTable(el, ["install", "first report", "last report", "days reported", "version", "got as far as", "age at first report"],
            (ni.quiet || []).map(q => [q.id, q.first, q.last, q.days, q.version, word("stage", q.stage), q.age || "–"]), "quiet")),
      ], (() => {
        const w4 = ni.weeks.slice(-4), nNew = w4.reduce((a, w) => a + (Number(w.new) || 0), 0), still = w4.reduce((a, w) => a + (Number(w.still) || 0), 0);
        return `${fmt(nNew)} new in the last 4 weeks · ${fmt(still)} of them still here · ${fmt((ni.quiet || []).length)} stopped`;
      })());
    }

    // ── 02 versions ───────────────────────────────────────────────────────
    section("Versions", `What people run, from each install's latest report. Percentages on this page are of the ${fmt(n)} installs that have ever sent a report, unless a card says otherwise.`, [
      grid([
        barCard(el, { title: "PadSpan version", ask: "Which PadSpan each install runs", map: dist.version, total: n }),
        barCard(el, { title: "Home Assistant version", ask: "Which Home Assistant each install runs", map: dist.ha_version, total: n }),
        barCard(el, { title: "Licence", ask: "Free, Pro, or Bright (the Atlas-only edition)", map: dist.tier, total: n, kind: "tier" }),
        barCard(el, { title: "Country", ask: "The country set in Home Assistant (? = not set, or PadSpan older than 0.38.148)", map: dist.country, total: n }),
        barCard(el, { title: "Language", ask: "Home Assistant's language (? = PadSpan older than 0.38.148)", map: dist.language, total: n }),
        barCard(el, { title: "Versions running (by address)", ask: `Addresses that checked for an update in ${W} days, by the version they run: addresses change, so a home can count more than once; read it for the mix of versions, not for how many (– = too old to say)`, map: pg.by_version, total: pg.distinct_window || 1, unit: "addresses", limit: 8 }),
      ]),
    ], (() => {
      const v = top(dist.version), h = top(dist.ha_version), c = top(dist.country);
      return [v && `most on PadSpan ${v[0]} (${pctOf(v[1], n)})`, h && `HA ${h[0]} (${pctOf(h[1], n)})`, c && `most in ${c[0]}`].filter(Boolean).join(" · ");
    })());

    // ── 03 homes ──────────────────────────────────────────────────────────
    const homeCards = [barCard(el, { title: "Other Home Assistant add-ons", ask: "Installs that also run each of these", map: s.integrations, total: n, kind: "integration" })];
    for (const [k, label, ask] of [["scanners", "Bluetooth receivers", "Bluetooth receivers (proxies) in the house"], ["floors", "Floors", "Floors in Home Assistant"], ["rooms", "Rooms", "Rooms (areas) in Home Assistant"],
                                   ["maps", "Floor plans", "Floor plans added in PadSpan"], ["calibration_points", "Calibration points", "Spots measured during calibration"],
                                   ["irks", "Phone keys", "iPhones and others added by their key (IRK), so they can be followed"], ["walls", "Walls", "Walls drawn on the plans"],
                                   ["placed_lights", "Lights on the map", "Lights placed on a floor plan"], ["objects_total", "Devices seen", "Bluetooth devices PadSpan has seen (most are neighbours' and passers-by)"]]) {
      homeCards.push(barCard(el, { title: label, ask: `${ask}, grouped (≤ 4 means up to 4)`, map: orderBuckets(dist[k]), total: n, ranked: false }));
    }
    const most = (k) => { const t = top(dist[k]); return t ? t[0].replace("<=", "≤").replace(">=", "≥") : "?"; };
    section("Homes", "How big the houses are and what else runs in them, from each install's latest report. Numbers are grouped, never exact.", [grid(homeCards)],
      `most have ${most("rooms")} rooms · ${most("scanners")} receivers · ${most("floors")} floors`);

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
        barCard(el, { title: "How receivers are set to scan", ask: "Every receiver, by the scan mode it was set to", map: s.scan_modes_requested, total: radios(s.scan_modes_requested), unit: "receivers", kind: "scan" }),
        barCard(el, { title: "How receivers are scanning now", ask: "Every receiver, by what it was doing when the report was sent", map: s.scan_modes, total: radios(s.scan_modes), unit: "receivers", kind: "scan" }),
        kvCard(el, "Who chose a scan mode (installs)", "Installs, by what they set on purpose", [
          ["Set at least one receiver to Active", smi.any_active || 0, n],
          ["Set at least one receiver to Passive", smi.any_passive_pinned || 0, n],
          ["Left every receiver on Auto", smi.all_auto || 0, n],
          ["PadSpan too old to say", smi.no_data || 0, n],
        ]),
      ])];
      if (nWith) {
        kids.push(el("div", { class: "ib-callout" }, [
          el("span", { class: "ib-callout-fig" }, `${Math.round(100 * (smi.all_auto || 0) / nWith)}%`),
          el("span", {}, "of installs that can say have left every receiver on Auto. That's Home Assistant's default since 2026.6: it mostly just listens, and only asks devices to answer for short spells."),
        ]));
      }
      section("Receivers", "How the Bluetooth receivers listen. Active asks devices to answer (faster, more readings); passive only listens. Counted per receiver, and per install for what people chose.", kids,
        nWith ? `${Math.round(100 * (smi.all_auto || 0) / nWith)}% left every receiver on Auto` : "");
    }

    // ── 05 health ─────────────────────────────────────────────────────────
    const idn = s.identity || {}, geo = s.geometry || {};
    section("Health", "What's going wrong in people's setups. A problem is counted only where the install's PadSpan is new enough to check it, so zero means none found among those that can say.", [
      grid([
        flagsCard(el, s.flags || {}, n),
        kvCard(el, "Following phones", "Phones added by their key (IRK), and Home Assistant's Private BLE Device", [
          ["Installs with phone keys added", idn.with_irks, n],
          ["…recognising a phone with them", idn.resolving, idn.with_irks],
          ["…whose keys never match anything", idn.silent, idn.with_irks],
          ["Installs using Private BLE Device", idn.private_ble_device, n],
        ]),
        kvCard(el, "Floor plans and heights", "Whether the plans and floors are set up well enough to place devices", [
          ["Homes with more than one floor", geo.multi_floor, n],
          ["A plan's shape or scale doesn't add up", geo.faulted, n],
          ["The plan used for scale is itself wrong", geo.anchor_faulted, n],
          ["No plan has a real-world scale", `${fmt(geo.no_anchor ?? 0)} of ${fmt(geo.no_anchor_known ?? 0)} that can say`, null],
          ["Floors left at the default height", geo.floors_default, n],
          ["Every receiver at the same height", geo.z_uniform, n],
          ["Calibration points with no floor", geo.cal_no_floor, n],
        ]),
      ]),
    ], (() => {
      const ks = Object.keys(s.flags || {}).sort((a, b) => flagN(b) - flagN(a));
      return ks.length ? `${ks.length} kinds of problem · the most common: ${word("flag", ks[0])} (${pctOf(flagN(ks[0]), n)})` : "no problems found";
    })());

    // ── 06 usage ──────────────────────────────────────────────────────────
    const ad = s.adoption || {};
    const tok = s.type_override_kinds || {};
    // The AI Task people chose for photos (env.ai, 0.38.187): local or cloud.
    const aiMap = s.ai || {};
    // The Overview card's two kinds of row: settings changed (counted per
    // install) and what each screen showed (counted per screen, homes with 2+).
    const ovMap = s.overview || {};
    const ovSettings = Object.fromEntries(Object.entries(ovMap).filter(([k]) => !/^screens?(_listed)?:/.test(k)));
    const ovScreens = Object.fromEntries(Object.entries(ovMap).filter(([k]) => /^screens?(_listed)?:/.test(k)));
    // Things people did, things PadSpan did by itself, and what the panel saw of its screen.
    const _auto = /^(irk_resolved|irk_unresolved_rpa|irk_cache_cleared|scan_mode_flip|lost_and_found|tagged_(arrived|departed)|findmy_|mqtt_publish_failed|proxy_rate_drops|vacation_resumed|bermuda_history_purged|house3d_fallback|map_placement_refused|weather_note|weather_source|weather_shown|wall_reload|view_link|ui_error_while)/;
    const _screen = /^(client_|wall_screen:|overview_shown:)/;
    const usePeople = {}, useAuto = {}, useScreen = {};
    for (const [k, v] of Object.entries(s.usage || {})) (_screen.test(k) ? useScreen : _auto.test(k) ? useAuto : usePeople)[k] = v;
    section("Usage", `What people actually use, over the last ${W} days. The first number is how many times; the person icon is how many installs.`, [
      grid([
        pairCard(el, `Tabs opened (${W} days)`, "Which parts of PadSpan people open", s.tabs, "count", 12, "tab"),
        pairCard(el, `Things people did (${W} days)`, "Actions, wizard steps and offers seen", usePeople, "count", 15, "usage"),
        pairCard(el, `What PadSpan did by itself (${W} days)`, "Background work: recognising phones, tidying, receivers changing mode, arrivals", useAuto, "count", 15, "usage"),
        pairCard(el, `The screens it runs on (${W} days)`, "What the panel noticed about each browser: smoothness, memory, screen size", useScreen, "count", 15, "usage"),
        barCard(el, { title: "Settings switched on", ask: "Installs with each setting on (some are on by default)", map: s.features, total: n, limit: 40, kind: "feature" }),
        ...(Object.keys(ovSettings).length ? [barCard(el, { title: "Overview and Atlas: changed from default", ask: "Installs that changed how the Overview, Atlas or 3D house looks", map: ovSettings, total: n, limit: 40, kind: "overview" })] : []),
        ...(Object.keys(ovScreens).length ? [barCard(el, { title: "Screens, in homes with two or more", ask: "Each screen PadSpan is open on, by what it is and what it shows (counted per screen)", map: ovScreens, unit: "screens", limit: 40, kind: "overview" })] : []),
        ...(Object.keys(aiMap).length ? [barCard(el, { title: "AI chosen for photos", ask: "Installs that picked an AI Task in Settings → AI, by where it runs", map: aiMap, total: n,
          kind: "ai" })] : []),
        kvCard(el, "Extra things placed on the map (installs)", "Installs that placed or used at least one", [
          ["Placed a motion sensor", ad.motion_sensors, n],
          ["Placed a temperature sensor", ad.temp_sensors, n],
          ["Placed a fan", ad.fans, n],
          ["Changed what kind of light something is (Pro)", ad.type_overrides, n],
          ...Object.keys(tok).sort().map(k => [`  ↳ as a ${k === "wled" ? "WLED strip" : k}`, tok[k], null]),
        ]),
        ...((s.stairs && s.stairs.installs) ? [kvCard(el, "Stairs in the 3D house", "Homes with stairs in Live Aboard, and what kind", [
          ["Homes with stairs", s.stairs.installs, n],
          ["Stairs in all", s.stairs.total, null],
          ["  ↳ read off a plan by AI, still there", s.stairs.ai_kept, s.stairs.total],
          ["  ↳ a few steps within one floor", s.stairs.within, s.stairs.total],
        ])] : []),
        ...(Object.keys(s.usage || {}).some(k => /^stairs_/.test(k)) ? [pairCard(el, "Stairs at work (page loads)", "Each time Live Aboard drew a house with stairs: whether they land in a room, what they reach, their shapes and styles",
          Object.fromEntries(Object.entries(s.usage || {}).filter(([k]) => /^stairs_/.test(k))), "count", 12, "usage")] : []),
        ...(s.fixes ? [kvCard(el, "Recent fixes at work (installs)", "Homes where a fix from the last betas made a difference", [
          ["A Shelly's scanner found by its MAC (0.38.175)", s.fixes.shelly_mac, n],
          ["A scanner's room taken from its Shelly (0.38.176)", s.fixes.shelly_area_via, n],
          ["Forensics on", s.fixes.forensics_on, n],
          ["  ↳ paused: the licence no longer reaches Pro (0.38.191)", s.fixes.forensics_paused_licence, s.fixes.forensics_on],
        ])] : []),
        pairCard(el, "Warnings in the Home Assistant log", "Warning lines PadSpan wrote, by the part of PadSpan that wrote them", s.errors, "lines", 12, "module"),
        barCard(el, { title: "Panel errors, by where", ask: "Errors the PadSpan panel caught: by the file that threw on 0.38.85 and later, by the open tab before that (when any error on the page counted)", map: s.ui_errors, unit: "errors", limit: 12, kind: "view" }),
      ]),
    ], (() => {
      const t = top(s.tabs, "count"), a = top(usePeople, "count");
      return [t && `most opened: ${word("tab", t[0])}`, a && `most done: ${word("usage", a[0])}`].filter(Boolean).join(" · ");
    })());

    // ── everything else in the reports ────────────────────────────────────
    // Every env/health field the cards above don't show (stats.php fields),
    // one row each: what it is, how many homes sent it, and what they said.
    // A field added to the report later turns up here by itself.
    const shownElsewhere = new Set(["scanners", "floors", "rooms", "maps", "calibration_points", "irks", "walls", "placed_lights",
      "objects_total", "integrations", "scanner_kinds", "scan_modes", "scan_modes_requested", "scan_mode_installs", "ai", "screens",
      "stairs", "calibration_no_floor", "install_age", "setup_stage", "country", "language",
      "crypto_ok", "ble_callback_active", "ble_diag_ok", "maps_geometry_faulted", "geometry_anchor_faulted", "stack_desync", "irks_silent",
      "has_metre_anchor", "floors_all_default", "scanner_z_uniform", "radios_ambiguous", "radios_unresolved", "calibration_points_vanished",
      "maps_vanished", "rooms_overlap", "radios_shelly_mac", "radios_area_via", "forensics_paused_licence", "irk_devices_resolving"]);
    const fieldRows = [];
    for (const [sec, map] of Object.entries((s.fields) || {})) {
      for (const [k, f] of Object.entries(map || {})) {
        if (shownElsewhere.has(k) || !f || !f.installs) continue;
        const bits = [];
        if (f.above_zero || f.sum) bits.push(`above zero in ${fmt(f.above_zero)} · sum ${fmt(Math.round(f.sum * 10) / 10)}`);
        const vals = Object.entries(f.values || {}), sums = Object.entries(f.sums || {});
        if (vals.length) bits.push(vals.slice(0, 6).map(([v, c]) => `${v} ${fmt(c)}`).join(" · ") + (vals.length > 6 ? ` · +${vals.length - 6}` : ""));
        if (sums.length) bits.push(sums.slice(0, 6).map(([v, c]) => `${v} Σ${fmt(Math.round(c * 10) / 10)}`).join(" · ") + (sums.length > 6 ? ` · +${sums.length - 6}` : ""));
        fieldRows.push([word("field", k), sec, fmt(f.installs), bits.join("  |  ") || "–", `${sec}.${k}`]);
      }
    }
    fieldRows.sort((a, b) => Number(String(b[2]).replace(/\D/g, "")) - Number(String(a[2]).replace(/\D/g, "")));
    if (fieldRows.length) {
      const q = el("input", { class: "ib-filter", type: "search", placeholder: "Filter fields…", "aria-label": "Filter fields" });
      const holder = el("div");
      const paint = () => {
        const f = String(q.value || "").trim().toLowerCase();
        const hit = f ? fieldRows.filter(r => r.join(" ").toLowerCase().includes(f)) : fieldRows;
        holder.replaceChildren(dataTable(el, ["field", "part", "homes", "what they said"], hit.map(r => [r[0] + "  ·  " + r[4], r[1], r[2], r[3]]), "fields"));
      };
      q.addEventListener("input", paint);
      paint();
      section("Everything else in the reports", "Every other field in the usage reports, from each install's latest report: how many homes sent it, and what they said (counts of each answer, sums, or how many were above zero). New fields appear here by themselves.",
        [el("div", { class: "ib-card" }, [el("div", { class: "ib-card-head" }, [el("div", { class: "ib-card-title" }, `Fields (${fieldRows.length})`), q]), holder])],
        `${fmt(fieldRows.length)} more fields`);
    }

    // ── 07 installs ───────────────────────────────────────────────────────
    const rows = s.table || [];
    section("Installs", `One row per install that has sent a report, latest first. The install column is the start of a random id: it says nothing about who or where.`, [
      installsTable(el, rows),
      el("div", { class: "ib-note" },
        `Reports kept from ${s.spool_first_day || "?"}; update checks from ${pg.first_day || "?"}. Hover a column name for what it means.`),
    ], `${fmt(rows.length)} installs · ${fmt(rows.filter(r => r.flags && r.flags.length).length)} with a setup problem`);

    // section chips: jump within the page
    const nav = el("nav", { class: "ib-nav" });
    for (const [num, title] of sections) {
      const chip = el("button", { class: "ib-chip", type: "button" }, [el("b", {}, num), title]);
      chip.addEventListener("click", () => jump(title));
      nav.appendChild(chip);
    }
    // Open or close every section at once.
    const all = (on) => { for (const [, , sec] of sections) sec.open = on; };
    const bOpen = el("button", { class: "ib-chip ib-chip-act", type: "button" }, "Open all");
    const bClose = el("button", { class: "ib-chip ib-chip-act", type: "button" }, "Close all");
    bOpen.addEventListener("click", () => all(true));
    bClose.addEventListener("click", () => all(false));
    nav.append(el("span", { class: "ib-nav-gap" }), bOpen, bClose);
    body.appendChild(nav);
    for (const [, , sec] of sections) body.appendChild(sec);
  };

  draw();
  if (!_cache) load(false);
  return root;
}

// ── Words: what each report name means, for the person reading the page ─────
// The report's own names (setting keys, event names, module names) stay in
// each row's hover text; the row itself says what it is in plain words.
// A name missing here is shown tidied up (underscores to spaces), never blank.
const W_FEATURE = {
  beacon_profiling_enabled: "Beacon profiling (learns fixed beacons)",
  ha_entity_tracker_enabled: "Home Assistant: a tracker per device",
  update_check_enabled: "Checks for PadSpan updates",
  ha_entity_area_enabled: "Home Assistant: a room sensor per device",
  ha_entity_distance_enabled: "Home Assistant: a distance sensor per device",
  beacon_auto_calibrate: "Calibrates itself from pinned beacons",
  ha_entity_scanner_distance_enabled: "Home Assistant: distance to each receiver",
  lights_panel_enabled: "Atlas in the Home Assistant sidebar",
  onboarding_completed: "Finished the first-run setup",
  apple_auto_classify: "Sorts Apple devices by type",
  radio_map_enabled: "Radio Map tab",
  walk_to_identify_enabled: "Spots who just walked in",
  mac_rotation_bridging: "Follows phones whose address changes",
  phone_wizard_enabled: "Phone setup wizard",
  quiet_mode: "Quiet mode (hides unnamed devices)",
  forensics_enabled: "Forensics (Pro)",
  adaptive_floor_detection: "Learns how much each floor blocks signal",
  distortion_map_enabled: "Signal distortion map tab",
  bermuda_ignore: "Ignores Bermuda's data",
  overview_2d_mode: "Overview drawn flat (2D)",
  ha_entity_occupancy_enabled: "Home Assistant: a sensor per room that says if it's occupied",
  tags_room_events_enabled: "Tags: an event on each room change",
  rssi_capture_enabled: "Records raw signal for replay",
  aggressive_ble_reseed: "Re-reads Bluetooth every 5 s (passive proxies)",
  espresense_mqtt_enabled: "ESPresense receivers over MQTT",
  lights_show_beacons: "Atlas shows beacons",
  overview_persistent_pins: "Overview keeps device pins shown",
  mqtt_publish_enabled: "Publishes rooms to MQTT",
  overview_show_outdoor: "Overview shows the outdoors",
  overview_show_walls: "Overview draws walls",
  tags_nfc_identify_enabled: "Tags: identify by NFC tap",
  tags_phone_autolink_enabled: "Tags: an NFC tap starts tracking a phone",
  low_memory_mode: "Low-memory mode (2 GB machines)",
  lights_showcase: "Atlas presentation look",
  lights_hide_device_codes: "Atlas hides device codes",
  lights_hide_untouched: "Atlas draws only lights that were set up",
  lights_automorph_enabled: "Atlas room-alignment glow",
  lights_fit_rooms: "Atlas keeps each light inside its room",
  lights_isolux: "Atlas light-spread contours",
  light_theme: "Light colour theme",
  atlas_3d_enabled: "3D house (Live Aboard)",
  overview_atlas: "Atlas as the Overview",
  room_reason: "Says why a device is in its room",
  room_hold: "Holds the room through a short gap",
  pick_better: "Picks the better of two room guesses (positioning)",
  unsure: "Marks a device unsure instead of guessing",
  live_colours: "Atlas lights in their live colours", alert_pulse: "Atlas pulses rooms with an alert",
  heatmap: "Atlas heat map", subzones: "Zones inside rooms", plan_scan_import: "Imports a phone room scan",
  wall_fully: "Wall screen: Fully Kiosk support", wall_floor_cycle: "Wall screen: cycles through floors",
  director: "3D house: camera flies to events", scale: "Optimize for several wall screens",
  guest_tags: "Guest tags", room_walk: "Calibration: Walk a room", day_theme: "Day colour theme (Pro)",
  fusion: "Combines position and signal for the room",
  tasmota_ble_enabled: "Tasmota Bluetooth receivers",
  occupancy_hybrid_enabled: "Occupancy from motion + Bluetooth",
  enhanced_security: "Enhanced security",
};
const W_TAB = {
  overview: "Overview", maps: "Maps", calibration: "Calibration", follow: "Follow", purelive: "Live Tracker",
  settings: "Settings", manage: "Manage", training: "Training", devices: "Devices", occupancy: "Occupancy",
  health: "Health", bluetooth: "Bluetooth", monitor: "Monitor", traceback: "Traceback", presence: "Presence",
  qa: "QA", rooms: "Rooms", installbase: "Install Base (this page)", sandbox: "Sandbox", forensics: "Forensics", insights: "Insights",
  "maps/edit": "Maps › Edit", "maps/rooms": "Maps › Rooms", "maps/stack": "Maps › Floor stack",
  "maps/library": "Maps › Library", "maps/upload": "Maps › Upload a plan", "maps/lights": "Maps › Lights",
  "maps/export": "Maps › Export", "maps/help": "Maps › Help",
  "bluetooth/scanners": "Bluetooth › Receivers", "bluetooth/monitor": "Bluetooth › Monitor",
  "bluetooth/irk_panel": "Bluetooth › Phone keys", "bluetooth/esphome_configs": "Bluetooth › ESPHome configs",
  "bluetooth/visualization": "Bluetooth › Visualisation",
};
const W_FLAG = {
  floors_all_default: "Floors left at the default height (multi-floor homes)",
  scanner_z_uniform: "Every receiver at the same height (multi-floor homes)",
  no_metre_anchor: "No map has a real-world scale (metres)",
  irks_silent: "Phone keys added that never match a phone",
  geometry_faulted: "A map's shape or scale doesn't add up",
  radios_ambiguous: "Two receivers' names overlap, so one can't be matched",
  calibration_no_floor: "Calibration points with no floor",
  radios_unresolved: "A receiver with no Home Assistant device",
  rooms_overlap: "Rooms on one floor drawn over each other",
};
const W_INTEGRATION = {
  bluetooth: "Bluetooth", mobile_app: "Home Assistant phone app", mqtt: "MQTT", ibeacon: "iBeacon tracker",
  esphome: "ESPHome", bermuda: "Bermuda", private_ble_device: "Private BLE Device",
};
const W_MODULE = {
  ws_notify: "Notifications", __init__: "Start-up", ws_calibration: "Calibration",
  ws_companion: "Phone app (Companion)", device_registry: "Home Assistant device list",
};
const W_VIEW = { overview: "Overview", calibration: "Calibration", sandbox: "Sandbox", devices: "Devices" };
const W_STAGE = {
  none: "Nothing set up", map: "Added a floor plan", rooms: "Drew rooms",
  receivers: "Placed receivers", calibrated: "Calibrated",
};
const W_TIER = { "full/free": "Free", "full/pro": "Pro", "full/bright": "Bright (Atlas only)" };
const W_SCAN = { active: "Active (asks devices to answer)", passive: "Passive (only listens)", auto: "Auto (HA decides)", unknown: "Not known" };
const W_OVERVIEW = {
  "ov_house:gap_tight": "Overview: floors stacked closer together",
  "ov_house:gap_wide": "Overview: floors spread further apart",
  "ov_house:gap_custom": "Overview: floor spacing changed a little",
  "ov_house:offset": "Overview: floors shifted sideways",
  "ov_house:one_floor": "Overview: opens on one floor, not all",
  "ov_house:trails": "Overview: movement trails on",
  "ov_atlas:zoom_lt1": "Atlas: zoomed out",
  "ov_atlas:zoom_1_2": "Atlas: zoomed in (up to 2×)",
  "ov_atlas:zoom_gt2": "Atlas: zoomed in past 2×",
  "ov_atlas:classic": "Atlas: kept the old layout",
  "ov_atlas:no_emergency": "Atlas: emergency button hidden",
  "ov_atlas:no_weather": "Atlas: weather off",
  "ov_atlas:weather_lt1": "Atlas: weather toned down",
  "ov_atlas:weather_gt1": "Atlas: weather turned up",
  "ov_3d:q_low": "3D house: low quality",
  "ov_3d:q_high": "3D house: high quality",
  "ov_3d:people": "3D house: people shown",
  "ov_3d:tags": "3D house: tags shown",
  "ov_3d:library": "3D house: furniture library",
  "ov_3d:no_weather": "3D house: weather off",
  "ov_3d:look_own": "3D house: own colours",
  "ov_3d:look_studio": "3D house: studio look",
  "below_pro:overview_atlas": "Atlas as Overview switched on without Pro",
  "below_pro:atlas_3d_enabled": "3D house switched on without Pro",
};
// What one screen showed or is (screen:<word>, homes with two or more screens).
const W_SCREEN = {
  house: "Overview: the house drawing", house_empty: "Overview: house with no floors yet",
  floor_plan: "Overview: a floor plan", room_grid: "Overview: a grid of rooms", flat: "Overview: flat (2D)",
  atlas: "Overview: the Atlas", atlas_3d: "Overview: the 3D house", basic: "Overview in Basic mode",
  res_lt720: "Smaller than 720p", res_720: "720p screen", res_1080: "1080p screen", res_1440: "1440p screen",
  res_4k: "4K screen", res_5k_up: "5K or bigger screen",
  kind_phone: "A phone", kind_tablet: "A tablet", kind_desktop: "A computer", kind_large: "A big screen or TV",
  panel_kiosk: "Panel as a wall screen (kiosk link)", panel_fullscreen_idle: "Panel full screen, left alone (a wall)",
  panel_fullscreen_used: "Panel full screen, in use", panel_windowed: "Panel in a window",
  atlaspage_kiosk: "Sidebar Atlas as a wall screen (kiosk link)", atlaspage_fullscreen_idle: "Sidebar Atlas full screen, left alone",
  atlaspage_fullscreen_used: "Sidebar Atlas full screen, in use", atlaspage_windowed: "Sidebar Atlas in a window",
};
const W_VIEWS_PERF = { atlas: "the Atlas", sim: "the 3D house", other: "other tabs" };
const W_BUCKET = {
  lt10: "under 10 fps", "10_24": "10–24 fps", "24_45": "24–45 fps", "45up": "45 fps or more",
  lt128m: "under 128 MB", "128_256m": "128–256 MB", "256_512m": "256–512 MB", "512m_1g": "512 MB–1 GB", "1g_up": "over 1 GB",
};
const W_DEV = {
  mem_lt1g: "Device memory: under 1 GB", mem_1g: "Device memory: 1 GB", mem_2g: "Device memory: 2 GB",
  mem_4g: "Device memory: 4 GB", mem_8g_up: "Device memory: 8 GB or more", mem_unknown: "Device memory: browser won't say",
  cores_1_2: "Processor: 1–2 cores", cores_3_4: "Processor: 3–4 cores", cores_5_8: "Processor: 5–8 cores",
  cores_9_up: "Processor: 9+ cores", cores_unknown: "Processor: browser won't say",
  webgl2_yes: "3D graphics supported", webgl2_no: "No 3D graphics (WebGL 2)",
  touch_yes: "Touch screen", touch_no: "No touch screen",
  lastrep_yes: "Sensor freshness reaches the panel", lastrep_no: "Sensor freshness doesn't reach the panel",
};
const W_CLIENT_SCREEN = {
  ...Object.fromEntries(Object.entries(W_SCREEN).filter(([k]) => /^(res|kind)_/.test(k))),
  orient_land: "Landscape", orient_port: "Portrait",
  dpr_1: "Standard pixel density", dpr_1_5: "1.5× pixel density", dpr_2: "2× (high-DPI) screen", dpr_3_up: "3× or more (phone-class) screen",
  screens_1: "One monitor", screens_2up: "Two or more monitors", screens_unknown: "Monitors: browser won't say",
};
const W_SURFACE = {
  atlas: "the Atlas", busy_times: "Busy times", locate: "Locate", maps: "Maps", milestone: "a setup milestone",
  settings: "Settings", sidebar: "the sidebar", update_banner: "the update banner", overview: "the Overview",
};
const W_EVENT = {
  stale_receivers_listed: "Opened the stale-receiver list (Mapping › 3D Stack)",
  status_dot_open: "Opened Health from the top bar's status dot",
  backup_created: "Made a backup", beacon_tune_saved: "Saved a beacon position (Beacon Tune)",
  bermuda_history_purged: "Cleared Bermuda's old history", calibration_point_added: "Added a calibration point",
  client_screen_seen: "Screens seen", companion_tx_sent: "Phone app set to broadcast (setup wizard)",
  findmy_linked: "Find My tag linked to its owner", findmy_linked_slow: "Find My tag linked, but slowly",
  findmy_missed_ambiguous: "Find My tag not linked: two possible owners",
  findmy_missed_elsewhere: "Find My tag not linked: owner elsewhere",
  findmy_missed_no_candidate: "Find My tag not linked: no owner nearby",
  findmy_back_on_day_key: "Find My tag back on its daily key",
  findmy_moved_back: "Find My tag went back to an earlier address",
  findmy_moved_back_addrs: "Links undone when a Find My tag went back",
  forensics_query: "Ran a Forensics search", free_pro_card_shown: "Saw the free-Pro card",
  getting_started_shown: "Saw the Getting Started card", house3d_opened: "Opened the 3D house",
  "house3d_fallback:context_lost": "3D house fell back: the browser dropped 3D graphics",
  irk_added: "Added a phone key (IRK)", irk_cache_cleared: "Phone keys reloaded after a change",
  irk_resolved: "A phone's changing address recognised", irk_unresolved_rpa: "A changing address no key recognised",
  irk_validate: "Checked a phone key", light_placed: "Placed a light", lights_tour_opened: "Opened the Atlas tour",
  lights_tour_completed: "Finished the Atlas tour", lights_tour_dismissed_early: "Left the Atlas tour early",
  lost_and_found_pruned: "Old unknown devices tidied away", map_placement_committed: "Placed a floor plan",
  map_placement_refused: "A floor plan placement was refused", mqtt_publish_failed: "MQTT publish failed",
  point_align_applied: "Lined up a map by points", pro_invite_later: "Free Pro year: chose Later",
  scan_mode_flip_auto: "A receiver switched to auto scanning", scan_mode_flip_pinned: "A receiver's scan mode pinned",
  tagged_arrived: "Tagged device arrived home", tagged_departed: "Tagged device left home",
  vacation_resumed: "Vacation Mode resumed after a restart", wall_placed: "Drew a wall", wall_removed: "Removed a wall",
  "view_link:kept": "A ?view= link opened its tab", "view_link:forensics_off": "A ?view= link went to the menu (Forensics off)",
  "view_link:edition": "A ?view= link went to the menu (not in this edition)",
  "ha_sidebar:hidden": "Hid Home Assistant's sidebar", "ha_sidebar:shown": "Brought the sidebar back",
  "weather_note:warning_ignored": "Weather: a leak sensor chosen as the warning, ignored",
  "weather_note:sensor_overruled": "Weather: a wet rain sensor under clear sky, ignored",
  wizard_calib_step_setup: "Calibration wizard: setup", wizard_calib_step_model: "Calibration wizard: house model",
  wizard_calib_step_roam: "Calibration wizard: walk around", wizard_calib_step_tune: "Calibration wizard: tune",
  wizard_calib_step_finish: "Calibration wizard: finished", wizard_calib_exited_early: "Calibration wizard: left early",
  wizard_maps_step_upload: "Maps wizard: upload a plan", wizard_maps_step_scale: "Maps wizard: set the scale",
  wizard_maps_step_rooms: "Maps wizard: rooms", wizard_maps_step_scanners: "Maps wizard: receivers",
  wizard_maps_step_finish: "Maps wizard: finished", wizard_maps_exited_early: "Maps wizard: left early",
  wizard_tiers_step_free: "Editions tour: Free", wizard_tiers_step_ladder: "Editions tour: compare",
  wizard_tiers_step_upgrade: "Editions tour: upgrade", wizard_tiers_completed: "Editions tour: finished",
  wizard_la_opened: "3D house setup: opened", wizard_la_finished: "3D house setup: finished",
  menu_more_tools_open: "Opened More tools in the menu",
  cal_results_opened: "Opened Calibration Results",
  rooms_page_edit: "Rooms page: a colour, ceiling height or split level saved",
};
const W_GS_STEP = { upload: "add a floor plan", scale: "set the scale", rooms: "draw rooms", scanners: "place receivers",
                    calibrate: "calibrate", positioned: "see devices placed" };
const W_WEATHER = { still: "nothing falling", light_rain: "light rain", heavy_rain: "heavy rain", light_snow: "light snow",
                    heavy_snow: "heavy snow", condition: "the weather's condition", rain_sensor: "a rain sensor", none: "no weather source" };
const W_WALL_KIND = { kiosk: "as a wall screen (kiosk link)", fullscreen_idle: "full screen, left alone (a wall)",
                      fullscreen_used: "full screen, in use", windowed: "in a window", fullscreen: "full screen", stuck: "stuck on the old version" };

function tidy(k) {
  const s = String(k).replace(/[_:/]+/g, " ").trim();
  return s ? s[0].toUpperCase() + s.slice(1) : String(k);
}

/** What a report name means, in words. `kind` says which list it comes from. */
// What each report field is, for "Everything else in the reports" (a field
// missing here shows its own name, tidied).
const W_FIELD = {
  beacon_positions: "Beacons placed on a plan", scanner_positions: "Receivers placed on a plan",
  ble_max_age_s: "Oldest advert the live view takes (s)", object_history_days: "Days an unknown device stays in history",
  calibration_auto_points: "Calibration points PadSpan added itself", coverage_floor_active: "A weakest-signal floor is set",
  floors_with_height: "Floors given a real height", rooms_with_height: "Rooms given their own height", scanners_with_z: "Receivers given a mounting height",
  geometry_fault_unplaced: "Plans with no placement", geometry_fault_unreadable: "Plans whose placement can't be read",
  geometry_no_world_frame: "Placements on disk but no scale to draw them", maps_divergent: "Plans whose two room records disagree",
  room_footprint_oversized: "Rooms bigger than their plan", room_footprint_undersized: "Rooms smaller than their plan",
  guest: "Guest tags", vacation: "Vacation Mode", room_walk: "Calibration: Walk a room", heldout: "Held-out accuracy (calibration)",
  has_any_identity: "Any phone identity set up", irks_total: "Phone keys in all", irks_by_source: "Phone keys, by where they came from",
  irks_resolving_by_source: "Phone keys that work, by where they came from", rpas_seen: "Rotating Bluetooth addresses on the air",
  rpas_resolved: "Rotating addresses recognised", resolver_errors: "Phone-key errors", followed: "Devices followed",
  findmy: "Find My tags on the air", objects_by_kind: "Devices, by kind", outside_now: "Followed devices outside now",
  positioned_now: "Followed devices placed on the map now", presence_cfg: "Room timing changed from the default",
  quiet_hidden: "Share hidden by quiet mode", scanner_floors: "Receivers with a minimum signal set",
  scanner_names: "Where receivers' names come from", scanner_state: "Receivers lost, off or left out",
  split_levels: "Split levels (rooms raised or sunk)", temp_fresh: "Temperature sensors reporting on time",
  hw: "The machine Home Assistant runs on", maps_www: "Plans moved out of the public folder",
  cal_points_phantom_room_n: "Calibration points in a room that isn't there", entity_dup_n: "PadSpan entities duplicated (_2, _3…)",
  pinned_movers_n: "Followed devices pinned in place", usage_dropped: "Usage counts left out to fit the report",
  perf: "How hard PadSpan works the machine", runs: "PadSpan's background jobs",
};
function word(kind, k) {
  const key = String(k);
  const [a, b, c] = key.split(":");
  switch (kind) {
    case "feature": return W_FEATURE[key] || tidy(key.replace(/_enabled$/, ""));
    case "field": return W_FIELD[key] || tidy(key);
    case "tab": return W_TAB[key] || tidy(key);
    case "flag": return W_FLAG[key] || tidy(key);
    case "integration": return W_INTEGRATION[key] || tidy(key);
    case "module": return W_MODULE[b || a] ? `${W_MODULE[b || a]}${b && a !== "WARNING" ? ` (${a.toLowerCase()})` : ""}` : tidy(b || a);
    case "view": return W_VIEW[key] || W_TAB[key] || tidy(key);
    case "stage": return W_STAGE[key] || tidy(key);
    case "tier": return W_TIER[key] || tidy(key);
    case "scan": return W_SCAN[key] || tidy(key);
    case "ai": return { local: "Local (stays in the house)", cloud: "Cloud (leaves the house)", unknown: "Another AI integration",
                        unready: "Chosen, but not ready" }[key] || tidy(key);
    case "overview":
      if (W_OVERVIEW[key]) return W_OVERVIEW[key];
      if (a === "screen") return W_SCREEN[b] || tidy(b);
      if (a === "screens_listed") return `Homes listing ${b} screens`;
      return tidy(key);
    case "usage": {
      if (W_EVENT[key]) return W_EVENT[key];
      if (a === "client_fps") return `Smoothness on ${W_VIEWS_PERF[b] || b}: ${W_BUCKET[c] || c}`;
      if (a === "client_heap") return `Browser memory on ${W_VIEWS_PERF[b] || b}: ${W_BUCKET[c] || c}`;
      if (a === "client_dev") return W_DEV[b] || tidy(b);
      if (a === "client_screen") return W_CLIENT_SCREEN[b] || tidy(b);
      if (a === "overview_shown") return (W_SCREEN[b] || tidy(b)) + " (drawn)";
      if (a === "trial_offer_shown") return `Free trial offered on ${W_SURFACE[b] || b}`;
      if (a === "trial_started") return `Free trial started from ${W_SURFACE[b] || b}`;
      if (a === "trial_failed") return `Free trial failed to start (${W_SURFACE[b] || b})`;
      if (a === "pro_invite_shown") return `Free Pro year offered on ${W_SURFACE[b] || b}`;
      if (a === "getting_started_step") return `Getting Started: ${W_GS_STEP[b] || b}`;
      if (a === "weather_shown") return `Atlas weather shown: ${W_WEATHER[b] || b}`;
      if (a === "weather_source") return `Atlas weather from ${W_WEATHER[b] || b}`;
      if (a === "wall_screen") return `${b === "atlas" ? "Sidebar Atlas" : "Panel"} ${W_WALL_KIND[c] || c}`;
      if (a === "wall_reload") return `${b === "atlas" ? "Sidebar Atlas" : "Panel"} reloaded itself after an update (${W_WALL_KIND[c] || c})`;
      if (a === "ui_error_while") return `Panel error while in ${W_TAB[b] || b}`;
      if (a === "first_room") return `First room drawn (${b === "lt15m" ? "within 15 min" : b})`;
      if (a === "photo_read") return { ok: "AI read a photo", no_ai_task: "AI photo refused: no AI Task set up",
                                        bad_answer: "AI answered with nothing usable", error: "AI photo read failed" }[b] || tidy(key);
      if (a === "stair_read") return { found: "AI found stairs on a floor plan", none: "AI found no stairs on a plan",
                                        bad_answer: "AI's stair answer unreadable", error: "AI stair read failed",
                                        no_ai_task: "AI stair read refused: no AI Task" }[b] || tidy(key);
      if (a === "photo_subject") return `AI read a photo of ${{ furniture: "furniture", tag: "a tag", scanner: "a receiver", person: "a person" }[b] || b}`;
      if (a === "photo_secs") return `AI took ${{ lt5: "under 5 s", "5_15": "5–15 s", "15_45": "15–45 s", gt45: "over 45 s" }[b] || b} to answer`;
      if (a === "stairs_outcome") return { all_ok: "Stairs: every flight lands in a room", some_landing: "Stairs: one lands in no room (check where)",
                                            some_nofloor: "Stairs: one has no floor above to reach" }[b] || tidy(key);
      if (a === "stairs_reach") return { split_level: "Stairs: one reaches a raised or sunken room", within: "Stairs: a few steps within one floor" }[b] || tidy(key);
      if (a === "stairs_shape") return `Stairs shaped ${{ straight: "straight", l: "L", u: "U", l2: "with two landings", l3: "with three landings" }[b] || b}`;
      if (a === "stairs_style") return `Stairs: ${{ closed: "closed", open: "open risers", treads: "treads only", floating: "floating (on a spine)" }[b] || b}`;
      if (a === "stair_secs") return `AI took ${{ lt5: "under 5 s", "5_15": "5–15 s", "15_45": "15–45 s", gt45: "over 45 s" }[b] || b} to read a floor plan`;
      if (a === "house3d_fallback_size") return `3D house fell back, in a house of ${{ lt20: "under 20", "20_60": "20–60", "60_150": "60–150", gt150: "over 150" }[b] || b} rooms`;
      if (a === "tip_shown" || a === "tip_opened" || a === "tip_hidden") {
        const tip = { floor_heights: "floor heights", receiver_heights: "receiver heights", scale: "a real-world scale", all: "all of them" }[b] || b;
        return `Accuracy tip ${{ tip_shown: "shown", tip_opened: "followed to its fix", tip_hidden: "hidden" }[a]}: ${tip}`;
      }
      if (a === "cal_results_action") return `Calibration Results: ${{ scale: "went to measure a floor plan", start: "started calibrating", receiver_heights: "went to receiver heights",
        floor_heights: "went to floor heights", compute: "went to work out the accuracy", room_empty: "went to add points in an empty room",
        room_weak: "went to add points in a weak room", stale: "walked the house again", matrix: "opened Accuracy by spot", guided: "opened Guided calibration" }[b] || b}`;
      if (a === "proxy_rate_drops") return `A receiver's reading rate dropped (${b} a day)`;
      return tidy(key);
    }
  }
  return tidy(key);
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

/** `build(limit)` drawn with the first `short` of `count` rows, and under it
 *  a "Show all" that draws every row (kept per `key` across re-renders). */
function expandable(el, key, count, short, build) {
  const out = el("div");
  const paint = () => {
    const all = _more.has(key) || count <= short;
    const kids = [build(all ? count : short)];
    if (count > short) {
      const b = el("button", { class: "ib-more", type: "button", "aria-expanded": String(all) }, all ? "Show fewer ▴" : `Show all ${fmt(count)} ▾`);
      b.addEventListener("click", () => { if (_more.has(key)) _more.delete(key); else _more.add(key); paint(); });
      kids.push(b);
    }
    out.replaceChildren(...kids);
  };
  paint();
  return out;
}

/** A table; with `key`, a long one shows its first SHORT_ROWS until "Show all". */
function dataTable(el, cols, rows, key = null) {
  const draw = (limit) => {
    const t = el("table", { class: "ib-table" });
    t.appendChild(el("tr", {}, cols.map((c, i) => el("th", { class: i ? "num" : "" }, c))));
    for (const r of rows.slice(0, limit)) t.appendChild(el("tr", {}, r.map((v, i) => el("td", { class: i ? "num" : "" }, String(v)))));
    return el("div", { class: "ib-scroll" }, [t]);
  };
  return key ? expandable(el, "rows:" + key, rows.length, SHORT_ROWS, draw) : draw(rows.length);
}

/**
 * Horizontal bars, one hue. With a total, each bar is a share of it on a
 * fixed 0–100% scale (gridlines at quarters) and the share sits at the tip;
 * without one, bars scale to the largest value and only counts are shown.
 * `ranked` numbers the rows (a list sorted by count); bucketed distributions
 * keep their natural order and go unnumbered.
 */
function barCard(el, { title, ask, map, total = null, unit = "installs", limit = 10, ranked = true, kind = null }) {
  const name = (k) => kind ? word(kind, k) : k;
  const entries = Object.entries(map || {}).map(([k, v]) => [k, Number(v) || 0]);
  if (ranked) entries.sort((a, b) => b[1] - a[1]);
  const person = unit === "installs";
  // A ranked list shows its top few; a grouped one (sizes) is short and shows whole.
  const short = ranked ? Math.min(limit, SHORT) : entries.length;
  const chart = () => expandable(el, title, entries.length, short, (limit) => {
    if (!entries.length) return empty(el);
    const shown = entries.slice(0, limit);
    const max = Math.max(...shown.map(e => e[1]), 1);
    const scale = total || max;
    const cw = Math.max(...shown.map(e => fmt(e[1]).length)) + (person ? 4 : 2);
    const cols = `${ranked ? "18px " : ""}minmax(90px,48%) minmax(0,1fr) ${cw}ch`;
    const wrap = el("div", { class: "ib-rows" + (total ? " ib-scaled" : ""), style: `--ib-cols:${cols}` });
    shown.forEach(([k, v], i) => {
      const w = Math.min(100, (v / scale) * 100);
      const p = total ? pctOf(v, total) : null;
      const inside = p && w >= 70;
      const fill = el("div", { class: "ib-fill", style: `width:${w.toFixed(2)}%${v > 0 ? ";min-width:2px" : ""}` },
        inside ? [el("span", { class: "ib-pct-in" }, p)] : []);
      const hover = (total ? `${name(k)}: ${fmt(v)} of ${fmt(total)} ${unit} (${p})` : `${name(k)}: ${fmt(v)} ${unit}`) + (kind ? `\nreport name: ${k}` : "");
      wrap.appendChild(el("div", { class: "ib-row", title: hover }, [
        ranked ? el("span", { class: "ib-rank" }, String(i + 1)) : null,
        el("span", { class: "ib-label" }, name(k)),
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
    return el("div", {}, [wrap, el("div", { class: "ib-foot" }, foot)]);
  });
  const table = entries.length ? () => dataTable(el, total ? ["", unit, "share"] : ["", unit],
    entries.map(([k, v]) => total ? [name(k), fmt(v), pctOf(v, total)] : [name(k), fmt(v)])) : null;
  return cardShell(el, title, ask, chart, table);
}

/** Bars for values shaped {count|lines, installs}: events, with the installs that produced them. */
function pairCard(el, title, ask, map, field, limit = 12, kind = null) {
  const name = (k) => kind ? word(kind, k) : k;
  const what = field === "lines" ? "lines" : "times";
  const entries = Object.entries(map || {}).map(([k, v]) => [k, Number(v && v[field]) || 0, Number(v && v.installs) || 0]);
  entries.sort((a, b) => b[1] - a[1]);
  const chart = () => expandable(el, title, entries.length, Math.min(limit, SHORT), (limit) => {
    if (!entries.length) return empty(el);
    const shown = entries.slice(0, limit);
    const max = Math.max(...shown.map(e => e[1]), 1);
    const cw = Math.max(...shown.map(e => (fmt(e[1]) + fmt(e[2])).length)) + 6;
    const wrap = el("div", { class: "ib-rows", style: `--ib-cols:18px minmax(90px,48%) minmax(0,1fr) ${cw}ch` });
    shown.forEach(([k, v, inst], i) => {
      const w = (v / max) * 100;
      wrap.appendChild(el("div", { class: "ib-row", title: `${name(k)}: ${fmt(v)} ${what} from ${fmt(inst)} installs` + (kind ? `\nreport name: ${k}` : "") }, [
        el("span", { class: "ib-rank" }, String(i + 1)),
        el("span", { class: "ib-label" }, name(k)),
        el("div", { class: "ib-track" }, [el("div", { class: "ib-fill", style: `width:${w.toFixed(2)}%${v > 0 ? ";min-width:2px" : ""}` })]),
        el("span", { class: "ib-count" }, [fmt(v), el("span", { class: "ib-sep" }, "·"), PERSON(), fmt(inst)]),
      ]));
    });
    const foot = [el("span", { class: "ib-foot-item" }, `${what} · bars scaled to the largest`)];
    return el("div", {}, [wrap, el("div", { class: "ib-foot" }, foot)]);
  });
  const table = entries.length ? () => dataTable(el, ["", what, "installs"], entries.map(([k, v, inst]) => [name(k), fmt(v), fmt(inst)])) : null;
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
  return cardShell(el, "Problems found (installs)", "Installs where a setup check found something wrong", () => {
    if (!keys.length) return el("div", { class: "ib-ok" }, "✓ none found among installs that can check");
    return el("div", { class: "ib-kv" }, keys.map(k => {
      const sev = /crypto|callback|faulted|desync|silent/.test(k) ? "bad" : "warn";
      return el("div", { class: "ib-kv-row" }, [
        el("span", { class: "ib-kv-label ib-flag" }, [
          el("span", { class: `ib-sev ib-sev-${sev}`, title: sev === "bad" ? "serious" : "warning" }, sev === "bad" ? "✖" : "⚠"),
          el("span", { title: `report name: ${k}` }, word("flag", k)),
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
  const cols = ["id", "first", "last", "days", "stage", "version", "ha", "tier", "scanners", "floors", "rooms", "maps", "cal", "irks", "irks_resolving", "objects", "identified", "pbd", "uptime", "flags"];
  const numeric = new Set(["days", "scanners", "floors", "rooms", "maps", "cal", "irks", "irks_resolving", "objects", "identified"]);
  const HEAD = {
    id: ["install", "The start of a random id. Says nothing about who or where."],
    first: ["first report", "Day of the first usage report"], last: ["last report", "Day of the latest usage report"],
    days: ["days", "Days it has sent a report"], stage: ["setup", "The furthest setup step reached"],
    version: ["PadSpan", "PadSpan version"], ha: ["HA", "Home Assistant version"], tier: ["licence", "Free, Pro or Bright"],
    scanners: ["receivers", "Bluetooth receivers"], floors: ["floors", "Floors"], rooms: ["rooms", "Rooms"],
    maps: ["plans", "Floor plans"], cal: ["cal. points", "Calibration points"], irks: ["phone keys", "Phones added by their key (IRK)"],
    irks_resolving: ["keys working", "Phone keys that recognised a phone"], objects: ["devices seen", "Bluetooth devices PadSpan holds"],
    identified: ["named", "Devices given a name or identified"], pbd: ["Private BLE", "Home Assistant Private BLE Device entries (+Bermuda: Bermuda also runs)"],
    uptime: ["up for", "Time since Home Assistant last started"], flags: ["problems", "Setup checks that found something wrong"],
  };
  const headRow = el("tr", {}, cols.map(c => el("th", { class: numeric.has(c) ? "num" : "", title: (HEAD[c] || [c, ""])[1] }, (HEAD[c] || [c])[0])));
  const trs = [];
  for (const r of rows) {
    const tr = el("tr");
    for (const c of cols) {
      let v = r[c];
      if (c === "flags") v = (v || []).map(f => word("flag", f)).join("; ") || "–";
      if (c === "stage") v = v ? word("stage", v) : "–";
      if (c === "tier") v = word("tier", v);
      if (c === "pbd") v = r.bermuda ? `${v} +Bermuda` : String(v);
      const cls = [numeric.has(c) ? "num" : "", c === "id" ? "mono" : "", c === "flags" && r.flags && r.flags.length ? "ib-flagged" : ""].filter(Boolean).join(" ");
      tr.appendChild(el("td", { class: cls }, numeric.has(c) ? fmt(v ?? "") : String(v ?? "")));
    }
    trs.push(tr);
  }
  // A filter over every column (an id, a version, a problem), then the first
  // SHORT_ROWS of what matches until "Show all".
  const q = el("input", { class: "ib-filter", type: "search", placeholder: "Filter: an id, a version, a problem…", "aria-label": "Filter installs" });
  const holder = el("div");
  const paint = () => {
    const f = String(q.value || "").trim().toLowerCase();
    const hit = f ? trs.filter(tr => tr.textContent.toLowerCase().includes(f)) : trs;
    holder.replaceChildren(expandable(el, "rows:installs", hit.length, SHORT_ROWS, (limit) => {
      t.replaceChildren(headRow, ...hit.slice(0, limit));
      return el("div", { class: "ib-scroll" }, [t]);
    }));
  };
  q.addEventListener("input", paint);
  card.querySelector(".ib-card-head").appendChild(q);
  paint();
  card.appendChild(holder);
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
#installbase .ib-nav{display:flex;flex-wrap:wrap;gap:6px;margin:14px 0 0;padding:8px 0;border-bottom:1px solid var(--ib-line);position:sticky;top:0;z-index:5;background:var(--bg,#0a150e)}
#installbase .ib-nav-gap{flex:1}
#installbase .ib-chip-act{border-style:solid;color:var(--ib-ink3)}
#installbase .ib-chip{width:auto;margin:0;background:transparent;border:1px dashed rgba(120,190,155,.38);border-radius:999px;padding:5px 11px;color:var(--ib-ink2);font-size:11px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;cursor:pointer}
#installbase .ib-chip b{font-family:var(--ib-mono);color:var(--ib-accent);margin-right:6px}
#installbase .ib-chip:hover{color:var(--ib-ink);border-style:solid;background:rgba(120,190,155,.08)}
#installbase .ib-sec{margin:0;border-bottom:1px solid var(--ib-line);scroll-margin-top:52px}
#installbase .ib-sec-head{display:flex;align-items:baseline;flex-wrap:wrap;gap:6px 12px;padding:14px 4px;cursor:pointer;list-style:none;border-radius:8px}
#installbase .ib-sec-head::-webkit-details-marker{display:none}
#installbase .ib-sec-head:hover{background:rgba(120,190,155,.06)}
#installbase .ib-sec-head:focus-visible{outline:2px solid var(--ib-accent);outline-offset:2px}
#installbase .ib-chev{color:var(--ib-accent);font-size:12px;width:12px;display:inline-block;transition:transform .15s}
#installbase .ib-sec[open] > .ib-sec-head .ib-chev{transform:rotate(90deg)}
#installbase .ib-num{font:700 12px/1 var(--ib-mono);color:var(--ib-accent)}
#installbase .ib-h{margin:0;font-size:18px;line-height:1.1;font-weight:800;letter-spacing:.01em;text-transform:uppercase}
#installbase .ib-headline{font-size:12px;color:var(--ib-ink2);font-variant-numeric:tabular-nums}
#installbase .ib-sec-body{padding:0 0 22px}
#installbase .ib-sec-body > .ib-lede{margin-top:0;font-size:12px;color:var(--ib-ink3)}
#installbase .ib-att{display:flex;flex-direction:column;gap:4px;margin-top:4px}
#installbase .ib-att-row{display:grid;grid-template-columns:10px minmax(0,1fr) auto 14px;gap:10px;align-items:center;width:100%;margin:0;padding:8px 12px;border-radius:10px;border:1px solid var(--ib-line);background:var(--ib-surface);color:var(--ib-ink);font-size:13px;text-align:left;cursor:pointer}
#installbase .ib-att-row:hover{border-color:var(--ib-accent)}
#installbase .ib-att-dot{width:8px;height:8px;border-radius:50%;background:var(--ib-ink3)}
#installbase .ib-att-bad .ib-att-dot{background:var(--ib-bad)}
#installbase .ib-att-warn .ib-att-dot{background:var(--ib-warn)}
#installbase .ib-att-info .ib-att-dot{background:var(--ib-accent)}
#installbase .ib-att-fig{color:var(--ib-ink2);font-size:12px;font-variant-numeric:tabular-nums;white-space:nowrap}
#installbase .ib-att-go{color:var(--ib-ink3)}
#installbase .ib-more{width:auto;margin:8px 0 0;padding:4px 12px;border-radius:999px;background:transparent;border:1px solid var(--ib-line);color:var(--ib-accent);font-size:11px;font-weight:600;cursor:pointer}
#installbase .ib-more:hover{border-color:var(--ib-accent)}
#installbase .ib-filter{width:min(100%,260px);margin:0;padding:5px 10px;border-radius:8px;border:1px solid var(--ib-line);background:#0a150e;color:var(--ib-ink);font-size:12px}
#installbase .ib-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,320px),1fr));gap:12px;margin-top:12px}
#installbase .ib-grid-wide{grid-template-columns:repeat(auto-fill,minmax(min(100%,460px),1fr))}
#installbase .ib-card{background:var(--ib-surface);border:1px solid var(--ib-line);border-radius:12px;padding:12px 14px 10px;min-width:0;position:relative}
#installbase .ib-card-head{display:flex;align-items:center;justify-content:space-between;gap:8px}
#installbase .ib-card-title{font-size:14px;font-weight:700;color:var(--ib-ink);min-width:0}
#installbase .ib-toggle{width:auto;margin:0;padding:3px 10px;border-radius:999px;background:transparent;border:1px solid var(--ib-line);color:var(--ib-ink2);font-size:10px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;cursor:pointer;flex-shrink:0}
#installbase .ib-toggle:hover{border-color:var(--ib-accent);color:var(--ib-ink)}
#installbase .ib-toggle[aria-pressed="true"]{border-color:var(--ib-accent);color:var(--ib-ink);background:rgba(69,168,120,.12)}
#installbase .ib-q{margin:4px 0 8px;font-size:11px;line-height:1.4;color:var(--ib-ink3)}
#installbase .ib-rows{display:flex;flex-direction:column}
#installbase .ib-row,#installbase .ib-axis{display:grid;grid-template-columns:var(--ib-cols);column-gap:10px;align-items:center;padding:0 6px;font-size:12px}
#installbase .ib-row{min-height:26px;border-radius:6px}
#installbase .ib-row:nth-child(odd){background:var(--ib-stripe)}
#installbase .ib-row:hover{background:rgba(120,190,155,.13)}
#installbase .ib-rank{color:var(--ib-ink3);font:500 11px/1 var(--ib-mono);text-align:right}
#installbase .ib-label{color:var(--ib-ink);line-height:1.3;padding:5px 0;overflow-wrap:anywhere}
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
#installbase .ib-flag{display:flex;align-items:center;gap:8px;font-size:12px}
#installbase .ib-sev{font-weight:700;width:14px;text-align:center;font-family:inherit}
#installbase .ib-sev-warn{color:var(--ib-warn)}
#installbase .ib-sev-bad{color:var(--ib-bad)}
#installbase .ib-figs{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,2.2fr);gap:12px;margin-top:8px}
#installbase .ib-herofig{display:flex;flex-direction:column;justify-content:center;background:linear-gradient(160deg,rgba(69,168,120,.16),rgba(15,26,18,1) 70%);border-color:rgba(69,168,120,.35)}
#installbase .ib-herofig-value{font-size:48px;line-height:1;font-weight:800;letter-spacing:-.02em;margin:6px 0 8px;color:var(--ib-ink)}
#installbase .ib-tiles{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}
#installbase .ib-tile{padding:10px 12px}
#installbase .ib-tile-label{font-size:11px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;color:var(--ib-ink2)}
#installbase .ib-tile-value{font-size:24px;line-height:1.1;font-weight:700;margin-top:4px;color:var(--ib-ink)}
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
  #installbase .ib-headline{flex-basis:100%;padding-left:24px}
  #installbase .ib-axis-track span:nth-child(2n){display:none}
}`;
  return st;
}
