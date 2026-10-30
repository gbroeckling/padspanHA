// pad.traks.ca — the Install Base page. index.php is the gate and the page's
// skeleton; this file fetches the numbers (body[data-src], signed in only) and
// draws them, problems first:
//   0 headline strip + "needs attention" (shown only when something does)
//   1 release health (is anything broken or getting worse; did the last release help or hurt)
//   2 today and yesterday (only what changed beyond normal noise)
//   3 growth, with releases and marketing pushes marked, a before/after verdict,
//     the visit-to-paid funnel and where visitors came from
//   4 everything else, folded, with a search over every number
// Charts follow the dataviz rules: one y-axis, thin marks, a legend for two or
// more series, a table view, hover tooltips, colour never alone.
//
// The numbers come from digest.php (schema 1, see the data contract): the model a
// cron rebuilds every 5 minutes. Fields beyond the mockup's, drawn when present:
//   needs_attention   [{ key, kind, title, detail, homes, of, first_seen, days_listed, growing }]
//   health_same_age   the latest stable against the previous one at the same age since release
//   versions_top      top 5 versions of the last 24 h plus "other", with "adopted" at 10% or more
//   setup_fail        new installs that don't finish setting up, against a threshold, with splits
//   markers.ranges    every campaign and launch as a date range
//   archive           longer history kept daily (HA opt-in count, GitHub traffic)
//   generated_iso, stale_after_s   to say when the numbers are stale
// Without them it falls back to the mockup's fields (watch, new_issues, versions24, markers.campaign).

"use strict";
const $ = (s, root = document) => root.querySelector(s);
const NS = "http://www.w3.org/2000/svg";
const css = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const fmtN = n => n == null ? "–" : Math.round(n).toLocaleString("en-US");
const fmtDay = s => new Date(s + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" });
const pct = (n, of) => of ? Math.round(100 * n / of) : 0;
function el(tag, attrs = {}, text) { const e = document.createElement(tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); if (text != null) e.textContent = text; return e; }
function sv(tag, attrs = {}) { const e = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); return e; }

let M = null;
const SRC = document.body.dataset.src || "digest.php";

// ── tooltip ─────────────────────────────────────────────────────────────────
const tip = $("#tip");
function showTip(ev, rows) {
  tip.replaceChildren();
  rows.forEach(r => { const d = el("div", { class: r.cls || "r" }); if (r.color) { const k = el("span", { class: "key-line" }); k.style.background = r.color; d.append(k); }
    d.append(el("span", { class: r.strong ? "v" : "m" }, r.text)); tip.append(d); });
  tip.style.display = "block";
  const x = Math.min(ev.clientX + 14, innerWidth - tip.offsetWidth - 8), y = Math.min(ev.clientY + 14, innerHeight - tip.offsetHeight - 8);
  tip.style.left = x + "px"; tip.style.top = y + "px";
}
const hideTip = () => { tip.style.display = "none"; };

// One section failing to draw must never blank the page.
function safe(fn, boxSel) {
  try { fn(); } catch (e) {
    console.error(fn.name, e);
    const b = boxSel && $(boxSel);
    if (b) b.replaceChildren(el("p", { class: "cap" }, "This part couldn't be drawn from the data: " + e.message));
  }
}

// ── theme ───────────────────────────────────────────────────────────────────
const themeBtn = $("#theme");
function applyTheme(t) { document.documentElement.dataset.theme = t; themeBtn.textContent = t === "dark" ? "Light" : "Dark"; }
applyTheme(localStorage.getItem("pad-theme") || "dark");
themeBtn.onclick = () => { const t = document.documentElement.dataset.theme === "dark" ? "light" : "dark"; localStorage.setItem("pad-theme", t); applyTheme(t); if (M) renderCharts(); };

// ── needs attention ─────────────────────────────────────────────────────────
function attentionItems() {
  if (Array.isArray(M.needs_attention)) return M.needs_attention.map(a => ({
    level: a.kind === "issue" || a.kind === "setup" ? "bad" : "watch", what: a.title,
    why: [a.detail, a.homes != null && a.of ? `${a.homes} of ${a.of} homes.` : (a.homes != null ? `${a.homes} home${a.homes === 1 ? "" : "s"}.` : ""),
          a.first_seen ? `Listed since ${fmtDay(a.first_seen)}${a.growing ? ", still growing" : ""}.` : ""].filter(Boolean).join(" ") }));
  if (Array.isArray(M.attention)) return M.attention;
  const items = (M.watch || []).map(x => ({ level: "watch", what: `${x.what} on ${M.prev}`,
    why: `${x.a[0]} of ${x.a[1]} opt-in homes (${pct(x.a[0], x.a[1])}%) against ${x.b[0]} of ${x.b[1]} on ${M.prev2} (${pct(x.b[0], x.b[1])}%). Bigger than chance at these sizes.` }));
  for (const x of (M.new_issues || [])) items.push({ level: "bad", what: `${x.status === "regressed" ? "Back" : "New"}: ${String(x.key).replace(/^log:WARNING:/, "Log warning: ")}`,
    why: `${x.homes7} home${x.homes7 === 1 ? "" : "s"} in 7 days, first seen ${fmtDay(x.first)}.` });
  return items;
}
function renderStatus() {
  const n = attentionItems().length, st = $("#status");
  st.querySelector(".dot").style.background = n ? css("--serious") : css("--good");
  st.querySelector("span:last-child").textContent = n ? `${n} worth a look` : "All normal";
}
function renderAttention() {
  const box = $("#attention"); box.replaceChildren();
  const items = attentionItems();
  if (!items.length) { const d = el("div", { class: "allok" }); d.append(el("span", { class: "ok" }, "✓ All normal"), el("span", {}, "Nothing new, back or out of its normal range.")); box.append(d); return; }
  const c = el("div", { class: "card attn" }); c.append(el("h3", {}, "Needs attention"));
  c.append(el("p", { class: "cap" }, "Only what's new, back, or outside its normal range. Each item drops off after 7 days unless it grows."));
  const ul = el("ul");
  for (const it of items) { const li = el("li"); li.append(el("span", { class: "ic", "aria-hidden": "true" }, it.level === "bad" ? "⚠" : "▲"));
    const t = el("div"); t.append(el("b", {}, it.what)); if (it.why) t.append(el("span", { class: "why" }, it.why)); li.append(t); ul.append(li); }
  c.append(ul); box.append(c);
}

// ── headline tiles ──────────────────────────────────────────────────────────
function sparkline(values, w = 120, h = 26) {
  const s = sv("svg", { viewBox: `0 0 ${w} ${h}`, width: w, height: h, "aria-hidden": "true" });
  const vals = values.filter(v => v != null); if (vals.length < 2) return s;
  const lo = Math.min(...vals), hi = Math.max(...vals), span = hi - lo || 1;
  const pts = values.map((v, i) => [i * (w - 4) / (values.length - 1) + 2, h - 3 - ((v ?? lo) - lo) / span * (h - 6)]);
  s.append(sv("polyline", { points: pts.map(p => p.join(",")).join(" "), fill: "none", stroke: css("--other"), "stroke-width": 1.5, "stroke-linejoin": "round", "stroke-linecap": "round" }));
  const last = pts[pts.length - 1]; s.append(sv("circle", { cx: last[0], cy: last[1], r: 3, fill: css("--s1"), stroke: css("--surface"), "stroke-width": 1.5 }));
  return s;
}
function renderTiles() {
  const box = $("#tiles"); box.replaceChildren();
  for (const t of M.tiles) {
    const d = el("div", { class: "tile", title: t.help || "" });
    d.append(el("div", { class: "lab" }, t.label), el("div", { class: "val" }, fmtN(t.value)), el("div", { class: "unit" }, t.unit));
    const c = el("div", { class: "cmp" });
    const word = { normal: "normal", above: "above normal", below: "below normal", good: "✓ none", bad: "needs you", watch: "▲ worth a look", info: "" }[t.state] || "";
    if (t.delta != null) { const sign = t.delta > 0 ? "+" : t.delta < 0 ? "−" : "±"; c.append(el("span", {}, `${sign}${fmtN(Math.abs(t.delta))} vs ${t.cmp}`)); }
    else c.append(el("span", {}, t.cmp));
    if (word) c.append(el("span", { class: "st " + t.state }, word));
    d.append(c);
    if (t.spark && t.spark.length > 1) d.append(sparkline(t.spark));
    box.append(d);
  }
}

// ── release health ──────────────────────────────────────────────────────────
function renderHealth() {
  const w = $("#watch"); w.replaceChildren();
  const n = (M.watch || []).length;
  if (n) w.append(el("p", { class: "cap" }, `${n === 1 ? "One row is" : n + " rows are"} worth a look (listed under Needs attention). Homes that just updated also restarted Home Assistant, which can cause one-off stalls and unclean stops. Check again in a week before treating either as a regression.`));
  const t = $("#health"); t.replaceChildren();
  const hr = el("tr"); hr.append(el("th", {}, "Opt-in homes, 7 days"));
  M.health.forEach((h, i) => hr.append(el("th", { class: "num" }, h.v + (i === 0 ? " (newest)" : ""))));
  t.append(hr);
  const rows = [["Homes reporting", "homes", null], ["Event-loop stall over 1 s", "lag_1s", true], ["Home Assistant stopped uncleanly", "unclean", true],
                ["Panel errors", "ui_err", true], ["Log warnings", "warn", true], ["3D view fell back to flat", "fallback", true]];
  for (const [label, key, isPct] of rows) {
    const tr = el("tr"); tr.append(el("td", {}, label));
    M.health.forEach(h => {
      const td = el("td", { class: "num" });
      if (!isPct) { td.textContent = h.homes + (h.homes === 1 ? " home" : " homes"); if (h.too_early) td.append(el("div", { class: "early" }, "too early to judge")); }
      else if (h.too_early) td.append(el("span", { class: "early" }, h[key] ? `${h[key]} of ${h.homes}` : "–"));
      else {
        const p = h.homes ? 100 * h[key] / h.homes : 0;
        const cell = el("div", { class: "cell" }); cell.append(el("span", {}, `${h[key]} of ${h.homes} · ${Math.round(p)}%`));
        const b = el("div", { class: "mbar" }); const i = el("i"); i.style.width = Math.max(p, h[key] ? 3 : 0) + "%"; b.append(i); cell.append(b); td.append(cell);
      }
      tr.append(td);
    });
    t.append(tr);
  }
  const tr = el("tr"); tr.append(el("td", {}, "Stall, typical home / worst 5%"));
  M.health.forEach(h => tr.append(el("td", { class: "num" }, h.too_early || h.lag_p50 == null ? "–" : `${(h.lag_p50 / 1000).toFixed(1)} s / ${(h.lag_p95 / 1000).toFixed(0)} s`)));
  t.append(tr);
}
// The latest release against the one before at the same age since release
// (Play Console / Datadog style), when the endpoint sends it.
function renderSameAge() {
  const box = $("#same-age"); box.replaceChildren();
  const S = M.health_same_age; if (!S || !S.latest || !S.prev) return;
  const L = S.latest, P = S.prev, d = S.age_days;
  box.append(el("h3", {}, `${L.v} against ${P.v} at the same age`));
  box.append(el("p", { class: "cap" }, `Opt-in homes in each version's first ${d + 1} day${d ? "s" : ""} after release (Play Console's rule: compare like with like, not this week with last).` + (S.note ? " " + S.note : "")));
  const cellOf = (h, key) => h.too_early ? (h[key] ? `${h[key]} of ${h.homes}` : "–") : `${h[key]} of ${h.homes} · ${pct(h[key], h.homes)}%`;
  const rows = [["Homes reporting", h => `${h.homes} home${h.homes === 1 ? "" : "s"}${h.too_early ? " (too early)" : ""}`],
    ["Event-loop stall over 1 s", h => cellOf(h, "lag_1s")], ["Home Assistant stopped uncleanly", h => cellOf(h, "unclean")],
    ["Panel errors", h => cellOf(h, "ui_err")], ["Log warnings", h => cellOf(h, "warn")], ["3D view fell back to flat", h => cellOf(h, "fallback")]];
  box.append(tbl(["Same age", `${L.v} (newest)`, P.v], rows.map(([label, f]) => [label, f(L), f(P)])));
  for (const x of (S.watch || [])) box.append(el("p", { class: "cap" }, `▲ ${x.what}: ${x.a[0]} of ${x.a[1]} on ${L.v} against ${x.b[0]} of ${x.b[1]} on ${P.v}.`));
}
// New installs that don't finish setting up, against a threshold (Play Console's bad-behaviour bar).
function renderSetup() {
  const card = $("#setup-card"), F = M.setup_fail; if (!F) { card.hidden = true; return; }
  card.hidden = false;
  const box = $("#setup"); box.replaceChildren();
  $("#setup-cap").textContent = `New opt-in installs first seen in the last ${F.window_days} days and at least ${F.grace_days} days old. ${F.definition || ""}`.trim();
  const line = el("p", {});
  line.append(el("b", {}, `${F.failing} of ${F.total}`), document.createTextNode(F.total ? ` didn't finish (${Math.round(F.rate ?? pct(F.failing, F.total))}%). The bar is ${F.threshold_pct}%` : " yet."));
  if (F.total) line.append(el("span", { class: "st " + (F.over ? "bad" : "normal"), style: "margin-left:6px" }, F.over ? "▲ over the bar" : "under the bar"));
  box.append(line);
  const lab = { ha_version: "Home Assistant version", install_type: "Install type", hardware: "Hardware" };
  for (const [k, title] of Object.entries(lab)) { const rows = ((F.by || {})[k] || []); if (!rows.length) continue;
    box.append(tbl([title, "Didn't finish"], rows.map(r => [r.k, r.of < 30 ? `${r.failing} of ${r.of}` : `${r.failing} of ${r.of} · ${pct(r.failing, r.of)}%`]))); }
}

// ── generic line chart (one y-axis, crosshair tooltip) ──────────────────────
function lineChart(box, cfg) {
  box.replaceChildren();
  const W = Math.max(300, box.clientWidth), H = cfg.height || 240, m = { l: 40, r: cfg.right || 12, t: cfg.top || 14, b: 26 };
  const s = sv("svg", { viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": cfg.label });
  const xs = cfg.x, n = xs.length, X = i => m.l + i * (W - m.l - m.r) / Math.max(1, n - 1);
  const [y0, y1] = cfg.y, Y = v => m.t + (1 - (v - y0) / (y1 - y0)) * (H - m.t - m.b);
  for (const v of cfg.ticks) { s.append(sv("line", { x1: m.l, x2: W - m.r, y1: Y(v), y2: Y(v), stroke: css("--grid"), "stroke-width": 1 }));
    const tx = sv("text", { x: m.l - 6, y: Y(v) + 4, "text-anchor": "end", "font-size": 11, fill: css("--muted") }); tx.textContent = cfg.tickFmt ? cfg.tickFmt(v) : v; s.append(tx); }
  const every = Math.max(1, Math.round(n / (W < 560 ? 4 : 8)));
  for (let i = 0; i < n; i += every) { const tx = sv("text", { x: X(i), y: H - 8, "text-anchor": "middle", "font-size": 11, fill: css("--muted") }); tx.textContent = fmtDay(xs[i]); s.append(tx); }
  s.append(sv("line", { x1: m.l, x2: W - m.r, y1: H - m.b, y2: H - m.b, stroke: css("--axis"), "stroke-width": 1 }));
  if (cfg.under) cfg.under(s, X, Y, W, H, m);
  for (const sr of cfg.series) {
    if (sr.band) { const top = sr.band.map((b, i) => `${X(i)},${Y(b[1])}`), bot = sr.band.map((b, i) => `${X(i)},${Y(b[0])}`).reverse();
      s.append(sv("polygon", { points: top.concat(bot).join(" "), fill: sr.color, opacity: .12 })); continue; }
    if (sr.dots) { sr.values.forEach((v, i) => { if (v != null) s.append(sv("circle", { cx: X(i), cy: Y(v), r: 2.2, fill: sr.color, opacity: .85 })); }); continue; }
    const pts = sr.values.map((v, i) => v == null ? null : `${X(i)},${Y(v)}`).filter(Boolean);
    s.append(sv("polyline", { points: pts.join(" "), fill: "none", stroke: sr.color, "stroke-width": 2, "stroke-linejoin": "round", "stroke-linecap": "round" }));
    if (sr.endLabel) { const i = sr.values.length - 1, v = sr.values[i]; s.append(sv("circle", { cx: X(i), cy: Y(v), r: 4, fill: sr.color, stroke: css("--surface"), "stroke-width": 2 }));
      (s._ends = s._ends || []).push({ x: X(i), y: Y(v), text: sr.endLabel }); }
  }
  if (s._ends) { const ends = s._ends.sort((a, b) => a.y - b.y); let last = -1e9;
    for (const e of ends) { e.ly = Math.max(e.y, last + 13); last = e.ly; }
    const over = ends.length ? ends[ends.length - 1].ly - (H - m.b + 4) : 0; if (over > 0) ends.forEach(e => { e.ly -= over; });
    for (const e of ends) { if (Math.abs(e.ly - e.y) > 2) s.append(sv("line", { x1: e.x + 4, y1: e.y, x2: e.x + 9, y2: e.ly, stroke: css("--muted"), "stroke-width": 1 }));
      const tx = sv("text", { x: e.x + 11, y: e.ly + 4, "font-size": 11.5, fill: css("--ink2") }); tx.textContent = e.text; s.append(tx); } }
  if (cfg.over) cfg.over(s, X, Y, W, H, m);
  const hair = sv("line", { y1: m.t, y2: H - m.b, stroke: css("--muted"), "stroke-width": 1, opacity: 0 }); s.append(hair);
  const hit = sv("rect", { x: m.l, y: 0, width: W - m.l - m.r, height: H, fill: "transparent" }); s.append(hit);
  const move = ev => { const r = s.getBoundingClientRect(), px = (ev.clientX - r.left) * W / r.width;
    const i = Math.max(0, Math.min(n - 1, Math.round((px - m.l) / ((W - m.l - m.r) / Math.max(1, n - 1)))));
    hair.setAttribute("x1", X(i)); hair.setAttribute("x2", X(i)); hair.setAttribute("opacity", 1); showTip(ev, cfg.tip(i)); };
  hit.addEventListener("pointermove", move); hit.addEventListener("pointerleave", () => { hair.setAttribute("opacity", 0); hideTip(); });
  box.append(s);
}

// ── version adoption ────────────────────────────────────────────────────────
function renderAdopt() {
  const vs = M.adopt_versions, cols = [css("--s1"), css("--s2"), css("--s3")], rows = M.adopt.filter(r => !r.partial);
  const leg = $("#adopt-legend"); leg.replaceChildren();
  vs.forEach((v, i) => { const sp = el("span"); const k = el("span", { class: "key-line" }); k.style.background = cols[i]; sp.append(k, document.createTextNode(v + (i === 0 ? " (newest stable)" : ""))); leg.append(sp); });
  const so = el("span"); const ko = el("span", { class: "key-line" }); ko.style.background = css("--other"); so.append(ko, document.createTextNode("Other versions")); leg.append(so);
  const series = vs.map((v, i) => ({ values: rows.map(r => r[v]), color: cols[i], endLabel: `${Math.round(rows[rows.length - 1][v])}%` }));
  series.push({ values: rows.map(r => r.Other), color: css("--other"), endLabel: `${Math.round(rows[rows.length - 1].Other)}%` });
  lineChart($("#adopt"), { label: "Share of homes by version", x: rows.map(r => r.d), y: [0, 100], ticks: [0, 25, 50, 75, 100], tickFmt: v => v + "%", series, right: 46, height: 220,
    tip: i => [{ text: fmtDay(rows[i].d), cls: "m" }].concat(vs.map((v, k) => ({ text: `${rows[i][v]}% · ${v}`, color: cols[k], strong: true })), [{ text: `${rows[i].Other}% · other`, color: css("--other") }]) });
  const t = $("#adopt-table"); t.replaceChildren(); const hr = el("tr"); hr.append(el("th", {}, "Day")); vs.forEach(v => hr.append(el("th", { class: "num" }, v))); hr.append(el("th", { class: "num" }, "Other")); t.append(hr);
  rows.forEach(r => { const tr = el("tr"); tr.append(el("td", {}, fmtDay(r.d))); vs.forEach(v => tr.append(el("td", { class: "num" }, r[v] + "%"))); tr.append(el("td", { class: "num" }, r.Other + "%")); t.append(tr); });
  // Last 24 h: the top 5 versions and everything else; "adopted" at 10% or more (Sentry's rule).
  const box = $("#vtop"); box.replaceChildren();
  let top, other, tot;
  if (M.versions_top && Array.isArray(M.versions_top.rows)) {
    tot = M.versions_top.total || 1;
    top = M.versions_top.rows.map(r => ({ v: r.v === "-" ? "(no version sent)" : r.v, n: r.n, share: r.share, adopted: r.adopted, stable: r.v === "-" ? undefined : r.stable }));
    other = M.versions_top.other && M.versions_top.other.n ? M.versions_top.other : null;
  } else {
    const list = (M.versions24 || []).map(([v, n]) => [v === "-" ? "(no version sent)" : v, +n]).sort((a, b) => b[1] - a[1]);
    tot = M.l24_total || list.reduce((a, x) => a + x[1], 0) || 1;
    top = list.slice(0, 5).map(([v, n]) => ({ v, n, share: 100 * n / tot, adopted: 100 * n / tot >= 10 }));
    const rest = list.slice(5); other = rest.length ? { n: rest.reduce((a, x) => a + x[1], 0), versions: rest.length } : null; if (other) other.share = 100 * other.n / tot;
  }
  const vt = el("table");
  const h = el("tr"); ["Last 24 h", "Homes", "Share"].forEach((x, i) => h.append(el("th", { class: i ? "num" : "" }, x))); vt.append(h);
  for (const r of top) { const tr = el("tr"); const td = el("td", {}, r.v); if (r.adopted) td.append(el("span", { class: "badge" }, "adopted")); if (r.stable === false) td.append(el("span", { class: "badge" }, "beta"));
    tr.append(td, el("td", { class: "num" }, fmtN(r.n)), el("td", { class: "num" }, Math.round(r.share) + "%")); vt.append(tr); }
  if (other) { const tr = el("tr"); tr.append(el("td", {}, `Other (${other.versions} versions)`), el("td", { class: "num" }, fmtN(other.n)), el("td", { class: "num" }, Math.round(other.share) + "%")); vt.append(tr); }
  const w = el("div", { class: "tablewrap" }); w.append(vt); box.append(w);
  box.append(el("p", { class: "cap", style: "margin:6px 0 0" }, `Of ${fmtN(tot)} homes that checked for updates in the last 24 hours. "Adopted" means 10% or more of them.`));
}

// ── issues and performance ──────────────────────────────────────────────────
function renderIssues() {
  const box = $("#issues"); box.replaceChildren();
  const ni = M.new_issues || [];
  const c = el("div", { class: "callout" });
  c.append(el("span", { class: "ic", "aria-hidden": "true" }, ni.length ? "⚠" : "✓"));
  c.append(el("div", {}, ni.length ? `${ni.length} new or back in the last 3 days.` : "Nothing new or back in the last 3 days."));
  box.append(c);
  const word = { new: "new", regressed: "back", ongoing: "ongoing", quiet: "quiet" };
  const active = (M.issues || []).filter(x => x.homes7 > 0);
  if (!active.length) box.append(el("p", { class: "cap" }, "No issue reported in the last 7 days."));
  else box.append(tbl(["Issue", "State", "Homes 7 d", "Homes 30 d", "Last seen"], active.slice(0, 6).map(x => [String(x.key).replace(/^log:WARNING:/, "Log warning: "), word[x.status] || x.status, x.homes7, x.homes30, fmtDay(x.last)]), 2));
  const quiet = (M.issues || []).length - active.length;
  if (quiet) box.append(el("p", { class: "cap", style: "margin-top:8px" }, `${quiet} more seen in the last 30 days but not this week. They're under Everything else.`));
}
function renderPerf() {
  const p = M.perf, box = $("#perf"); box.replaceChildren();
  box.append(el("p", { class: "cap" }, `${p.homes_lag_1s} of ${p.homes} homes stalled over 1 s at least once. Typical home's worst stall: ${(p.lag_p50 / 1000).toFixed(1)} s. Worst 5%: ${(p.lag_p95 / 1000).toFixed(0)} s.`));
  box.append(tbl(["Home", "Version", "Worst stall", "Snapshot p95", "Unclean stops", "Receivers / rooms"], p.worst.map(w => [w.home, w.version,
    (w.lag / 1000).toFixed(w.lag >= 10000 ? 0 : 1) + " s", w.snap >= 1000 ? (w.snap / 1000).toFixed(1) + " s" : Math.round(w.snap) + " ms", w.unclean, `${w.scanners ?? "–"} / ${w.rooms ?? "–"}`]), 2));
}

// ── today and yesterday ─────────────────────────────────────────────────────
function renderDigest() {
  const box = $("#digest"); box.replaceChildren();
  for (const [k, lines] of Object.entries(M.digest || {})) { if (!lines || !lines.length) continue;
    const g = el("div", { class: "grp" }); g.append(el("div", { class: "k" }, k)); const body = el("div"); lines.forEach(l => body.append(el("p", {}, l))); g.append(body); box.append(g); }
  box.append(el("p", { class: "cap", style: "margin:8px 0 0" }, "Everything else is within its normal range."));
  const feed = M.feed || [];
  const d = el("details"); d.append(el("summary", {}, `All events, yesterday and today (${feed.length})`));
  const ul = el("ul", { class: "feed" }); feed.forEach(f => { const li = el("li"); li.append(el("span", { class: "t" }, f.t), el("span", { class: "kd" }, f.kind), document.createTextNode(f.text)); ul.append(li); });
  d.append(ul); box.append(d);
}

// ── growth ──────────────────────────────────────────────────────────────────
function campaignsOf() {
  const mk = M.markers || {};
  if (Array.isArray(mk.ranges) && mk.ranges.length) return mk.ranges;
  if (Array.isArray(mk.campaigns)) return mk.campaigns;
  return mk.campaign ? [mk.campaign] : [];
}
// A date range drawn across the days it covers. Dates are compared as text
// (YYYY-MM-DD), so an end date past the chart's last day still spans to it.
function spanIdx(xs, from, to) {
  let a = xs.findIndex(d => d >= from); if (a < 0) return null;
  let b = -1; for (let i = xs.length - 1; i >= 0; i--) if (xs[i] <= (to || xs[xs.length - 1])) { b = i; break; }
  return b < a ? null : [a, b];
}
function renderGrowth() {
  const ns = M.ns, sr = M.series;
  $("#ns-cap").textContent = `All installs, last ${sr.length} days. Yesterday ${fmtN(ns.yday)}, typical ${fmtN(ns.typ)}. Dots are days, the line is the 7-day average, and the shaded band is the normal range around it.` +
    (M.series_all && M.series_all.length ? ` Since ${fmtDay(M.series_all[0].d)} it grew from ${fmtN(M.series_all[0].v)} to ${fmtN(ns.yday)}; the table has every day.` : "");
  $("#goal-bar").style.width = Math.max(0.4, 100 * ns.yday / ns.goal) + "%";
  $("#goal-cap").textContent = `${fmtN(ns.yday)} of the ${fmtN(ns.goal)} goal (${(100 * ns.yday / ns.goal).toFixed(1)}%).`;
  const camps = campaignsOf();
  const leg = $("#ns-legend"); leg.replaceChildren();
  const add = (cls, color, text) => { const sp = el("span"); const k = el("span", { class: cls }); k.style.background = color; sp.append(k, document.createTextNode(text)); leg.append(sp); };
  add("key-dot", css("--s1"), "Homes that day"); add("key-line", css("--s1"), "7-day average"); add("key-band", css("--s1"), "Normal range");
  if (camps.length) add("key-band", css("--wash"), camps.length === 1 ? camps[0].label : "Marketing pushes");
  add("key-dot", css("--s3"), "Guide or demo went live"); add("key-line", css("--muted"), "Stable release");
  const xs = sr.map(s => s.d), vals = sr.map(s => s.v), lo = Math.min(...sr.map(s => s.lo), ...vals), hi = Math.max(...sr.map(s => s.hi), ...vals);
  const stp = [5, 10, 20, 25, 50, 100].find(s => (Math.ceil(hi / s) - Math.floor(lo / s)) <= 6) || 100;
  const y0 = Math.floor(lo / stp) * stp, y1 = Math.ceil(hi / stp) * stp, ticks = []; for (let v = y0; v <= y1; v += stp) ticks.push(v);
  const idx = d => xs.indexOf(d);
  const contentByIdx = {}; ((M.markers || {}).content || []).forEach(c => { const i = idx(c.d); if (i >= 0) contentByIdx[i] = c.items; });
  const stableByIdx = {}; ((M.markers || {}).stables || []).forEach(r => { const i = idx(r.d); if (i >= 0) stableByIdx[i] = r.tag; });
  const spans = camps.map(c => ({ c, r: spanIdx(xs, c.from, c.to) })).filter(x => x.r);
  lineChart($("#ns"), { label: "Homes checking in each day", x: xs, y: [y0, y1], ticks, height: 280, top: 30,
    series: [{ band: sr.map(s => [s.lo, s.hi]), color: css("--s1") }, { dots: true, values: vals, color: css("--s1") }, { values: sr.map(s => s.avg), color: css("--s1") }],
    under: (s, X, Y, W, H, m) => {
      const step = (W - m.l - m.r) / Math.max(1, xs.length - 1);
      for (const { r: [a, b] } of spans) s.append(sv("rect", { x: X(a) - step / 2, y: m.t, width: Math.max(6, X(b) - X(a) + step), height: H - m.t - m.b, fill: css("--wash") }));
      let lastX = -1e9; for (const [i, tag] of Object.entries(stableByIdx).sort((p, q) => q[0] - p[0])) { s.append(sv("line", { x1: X(+i), x2: X(+i), y1: m.t, y2: H - m.b, stroke: css("--muted"), "stroke-width": 1, opacity: .7 }));
        if (Math.abs(lastX - X(+i)) < 44) continue; lastX = X(+i);
        const tx = sv("text", { x: X(+i) - 3, y: m.t + 9, "text-anchor": "end", "font-size": 10.5, fill: css("--muted") }); tx.textContent = tag; s.append(tx); }
    },
    over: (s, X, Y, W, H, m) => { for (const i of Object.keys(contentByIdx)) s.append(sv("circle", { cx: X(+i), cy: m.t - 14, r: 4, fill: css("--s3"), stroke: css("--surface"), "stroke-width": 2 })); },
    tip: i => { const r = [{ text: fmtDay(xs[i]), cls: "m" }, { text: `${sr[i].v} homes`, strong: true, color: css("--s1") }, { text: `7-day average ${sr[i].avg}` }, { text: `normal ${Math.round(sr[i].lo)}–${Math.round(sr[i].hi)}` }];
      if (stableByIdx[i]) r.push({ text: `Stable ${stableByIdx[i]} released` }); if (contentByIdx[i]) contentByIdx[i].forEach(t => r.push({ text: "Live: " + t, color: css("--s3") }));
      for (const { c, r: [a, b] } of spans) if (i >= a && i <= b) r.push({ text: c.label, color: css("--s2") });
      return r; } });
  const ba = M.ba, v = $("#ba"); v.replaceChildren();
  if (ba) {
    v.append(el("div", { class: "big" }, ba.verdict === "too early" ? `Outreach push since ${fmtDay(ba.push)}: too early to call (${ba.after_days} of 14 days)` : `Outreach push since ${fmtDay(ba.push)}: ${ba.verdict}`));
    v.append(el("div", {}, `So far ${ba.after} homes a day, against ${ba.before} in the 14 days before (${ba.diff >= 0 ? "+" : "−"}${Math.abs(ba.diff)}). A real lift has to beat ±${ba.band} at these numbers, so this ${Math.abs(ba.diff) > ba.band ? "already stands out" : "is still inside normal day-to-day noise"}. The Marketplace launch on Nov 4 will overlap this window.`));
  } else v.remove();
  const t = $("#ns-table"); t.replaceChildren(); const hr = el("tr"); ["Day", "Homes", "7-day avg", "Normal range"].forEach((h, i) => hr.append(el("th", { class: i ? "num" : "" }, h))); t.append(hr);
  (M.series_all || sr).slice().reverse().forEach(s => { const tr = el("tr"); tr.append(el("td", {}, fmtDay(s.d)), el("td", { class: "num" }, s.v), el("td", { class: "num" }, s.avg), el("td", { class: "num" }, `${Math.round(s.lo)}–${Math.round(s.hi)}`)); t.append(tr); });
  safe(renderSmall, "#small"); safe(renderFunnel, "#funnel"); safe(renderSources, "#sources");
}
function columns(box, data, opts) {
  box.replaceChildren();
  const W = Math.max(280, box.clientWidth), H = 110, m = { l: 26, r: 6, t: 8, b: 20 }, n = data.length;
  const s = sv("svg", { viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": opts.label });
  const max = Math.max(1, ...data.map(d => d.v || 0)), X = i => m.l + i * (W - m.l - m.r) / n, bw = Math.max(1.5, Math.min(24, (W - m.l - m.r) / n - 2)), Y = v => m.t + (1 - v / max) * (H - m.t - m.b);
  s.append(sv("line", { x1: m.l, x2: W - m.r, y1: Y(max), y2: Y(max), stroke: css("--grid") }));
  const tx = sv("text", { x: m.l - 4, y: Y(max) + 4, "text-anchor": "end", "font-size": 10.5, fill: css("--muted") }); tx.textContent = max; s.append(tx);
  const t0 = sv("text", { x: m.l - 4, y: Y(0) + 4, "text-anchor": "end", "font-size": 10.5, fill: css("--muted") }); t0.textContent = 0; s.append(t0);
  data.forEach((d, i) => { if (!d.v) return; const x = X(i) + 1, g = sv("g");
    const segs = opts.stack ? opts.stack(d).filter(sg => sg[0] > 0) : [[d.v, opts.color(d)]]; let base = 0;
    segs.forEach(([v, col], k) => { const top = k === segs.length - 1, a = Y(base) - (k ? 2 : 0), b = Y(base + v), r = top ? Math.min(4, bw / 2, Math.max(0, a - b)) : 0;
      if (a - b < 0.5) { base += v; return; }
      g.append(sv("path", { d: `M${x},${a} V${b + r} Q${x},${b} ${x + r},${b} H${x + bw - r} Q${x + bw},${b} ${x + bw},${b + r} V${a} Z`, fill: col })); base += v; });
    g.append(sv("rect", { x: x - 2, y: m.t, width: bw + 4, height: H - m.t - m.b, fill: "transparent" }));
    g.addEventListener("pointermove", ev => showTip(ev, opts.tip(d))); g.addEventListener("pointerleave", hideTip); s.append(g); });
  s.append(sv("line", { x1: m.l, x2: W - m.r, y1: Y(0), y2: Y(0), stroke: css("--axis") }));
  [0, Math.floor(n / 2), n - 1].forEach(i => { const tt = sv("text", { x: X(i) + bw / 2, y: H - 5, "text-anchor": i === 0 ? "start" : i === n - 1 ? "end" : "middle", "font-size": 10.5, fill: css("--muted") }); tt.textContent = fmtDay(data[i].d); s.append(tt); });
  box.append(s);
}
function renderSmall() {
  const box = $("#small"); box.replaceChildren(); const S = M.small || {};
  const defs = [
    ["New installs that share a report", "Per day. About 1 in 3 installs share one, so the real number is roughly three times this.", S.new, () => css("--s1"), d => [{ text: fmtDay(d.d), cls: "m" }, { text: `${d.v} new opt-in install(s)`, strong: true }]],
    ["Keys issued", "Per day, all plans.", S.keys, d => d.paid ? css("--s2") : css("--s1"), d => [{ text: fmtDay(d.d), cls: "m" }, { text: `${d.v} key(s)`, strong: true }, { text: `${d.paid} paid` }]],
    ["GitHub stars", `Per day. ${fmtN(M.stars_total)} in total.`, S.stars, () => css("--s1"), d => [{ text: fmtDay(d.d), cls: "m" }, { text: `+${d.v} star(s)`, strong: true }]],
    ["Site page views by people", "Per day. Logs are kept 15 days, so earlier days are empty.", S.site, () => css("--s1"), d => [{ text: fmtDay(d.d), cls: "m" }, { text: `${d.v ?? "no log"} page views`, strong: true }]],
  ];
  const A = M.archive || {};
  if ((A.ha_optin || []).length > 1) defs.push(["Home Assistant's opt-in count", `HA analytics' count for PadSpan, saved daily since ${fmtDay(A.since || A.ha_optin[0].d)}. About 1 in 3 installs share analytics with HA.`,
    A.ha_optin.map(x => ({ d: x.d, v: x.n })), () => css("--s1"), d => [{ text: fmtDay(d.d), cls: "m" }, { text: `${d.v} opt-in installs`, strong: true }], "level"]);
  if ((A.github_traffic || []).length > 1) defs.push(["GitHub page views", "Per day, saved daily (GitHub keeps only 14 days).",
    A.github_traffic.map(x => ({ d: x.d, v: x.views, u: x.uniques })), () => css("--s1"), d => [{ text: fmtDay(d.d), cls: "m" }, { text: `${d.v} views`, strong: true }, { text: `${d.u} people` }]]);
  for (const [title, cap, data, color, tipf, level] of defs) { if (!data || !data.length) continue;
    const c = el("div", { class: "card" }); c.append(el("h4", {}, title), el("p", { class: "cap" }, cap));
    if (title === "Keys issued") { const lg = el("div", { class: "legend" }); [["--s1", "Free, trial or tester"], ["--s2", "Paid"]].forEach(([v, txt]) => { const sp = el("span"); const k = el("span", { class: "key-band" }); k.style.background = css(v); sp.append(k, document.createTextNode(txt)); lg.append(sp); }); c.append(lg); }
    const ch = el("div", { class: "chart" }); c.append(ch); box.append(c);
    if (level) {
      const vals = data.map(d => d.v), lo = Math.min(...vals), hi = Math.max(...vals), pad = Math.max(2, Math.ceil((hi - lo) * 0.2));
      const y0 = lo - pad, y1 = hi + pad;
      lineChart(ch, { label: title, x: data.map(d => d.d), y: [y0, y1], ticks: [y0, Math.round((y0 + y1) / 2), y1], height: 110, series: [{ values: vals, color: color(), endLabel: fmtN(vals[vals.length - 1]) }], right: 40, tip: i => tipf(data[i]) });
    } else columns(ch, data, { label: title, color, tip: tipf, stack: title === "Keys issued" ? (d => [[d.v - d.paid, css("--s1")], [d.paid, css("--s2")]]) : null });
    const dt = el("details"); dt.append(el("summary", {}, "Show as table"));
    dt.append(tbl(["Day", title === "Keys issued" ? "Keys (paid)" : "Count"], data.filter(d => d.v).slice().reverse().map(d => [fmtDay(d.d), title === "Keys issued" ? `${d.v} (${d.paid})` : d.v])));
    c.append(dt);
  }
}
function hbars(box, items, colorOf, labelOf) {
  box.replaceChildren(); const max = Math.max(...items.map(i => i.n), 1); const g = el("div", { class: "hb" });
  items.forEach((it, k) => { const l = el("div", { class: "lbl" }, it.label); if (it.note) l.append(el("small", {}, it.note)); const b = el("div", { class: "bar" });
    const i = el("i"); i.style.width = Math.max(0.5, 100 * it.n / max) + "%"; i.style.background = colorOf(k); b.append(i, el("span", {}, labelOf(it, k))); g.append(l, b); });
  box.append(g);
}
function renderFunnel() {
  $("#funnel-cap").textContent = `Last ${M.src_days || 15} days (the site logs keep 15). Visitors, installs and keys aren't linked to each other, so only the first two steps share a ratio.`;
  const ramp = ["--f1", "--f2", "--f3", "--f4", "--f5"].map(css);
  hbars($("#funnel"), M.funnel.map(f => ({ label: f.step, note: f.note, n: f.n })), k => ramp[k] || ramp[ramp.length - 1],
    (it, k) => k === 1 && M.funnel[0].n ? `${fmtN(it.n)} · ${Math.round(100 * it.n / M.funnel[0].n)}% of page views` : fmtN(it.n));
}
function renderSources() {
  $("#src-cap").textContent = `Page views by people, last ${M.src_days || 15} days. Most browsers send no referrer, so "direct or unknown" is large. Tagged links would split it.`;
  const top = M.sources.filter(s => +s[1] >= 5), rest = M.sources.filter(s => +s[1] < 5).reduce((a, s) => a + +s[1], 0);
  const items = top.map(s => ({ label: s[0], n: +s[1] })); if (rest) items.push({ label: "Other small sources", n: rest });
  hbars($("#sources"), items, () => css("--s1"), it => fmtN(it.n));
}

// ── everything else ─────────────────────────────────────────────────────────
function fold(title, count, fill) { const d = el("details", { class: "fold" }); const s = el("summary", {}, title); if (count != null) s.append(el("span", { class: "n" }, count)); d.append(s); const body = el("div", { style: "margin-top:8px" }); fill(body); d.append(body); return d; }
function tbl(head, rows, numFrom = 1) { const t = el("table"); const hr = el("tr"); head.forEach((h, i) => hr.append(el("th", { class: i >= numFrom ? "num" : "" }, h))); t.append(hr);
  rows.forEach(r => { const tr = el("tr"); r.forEach((c, i) => tr.append(el("td", { class: i >= numFrom ? "num" : "" }, c == null ? "–" : String(c)))); t.append(tr); }); const w = el("div", { class: "tablewrap" }); w.append(t); return w; }
function renderElse() {
  const box = $("#else"); box.replaceChildren();
  const v24 = (M.versions24 || []).map(([v, n]) => [v === "-" ? "(no version sent)" : v, +n]).sort((a, b) => b[1] - a[1]), tot = M.l24_total || 1;
  box.append(fold("Every version on update checks", `${v24.length} versions, last 24 h`, b => b.append(tbl(["Version", "Homes", "Share"], v24.map(([v, n]) => [v, n, (100 * n / tot).toFixed(1) + "%"])))));
  if (M.setup28) box.append(fold("New installs and how far they got", `${M.new15} in 15 days`, b => {
    const st = ["none", "map", "rooms", "receivers", "calibrated"], lab = { none: "Nothing yet", map: "Floor plan", rooms: "Rooms", receivers: "Receivers placed", calibrated: "Calibrated" };
    b.append(el("p", { class: "cap" }, "Installs that share a report, first seen in the last 28 days, by the furthest setup step in their latest report. \"Gone quiet\" means no report for 3 or more days."));
    b.append(tbl(["Furthest step", "Still reporting", "Gone quiet"], st.map(s => [lab[s], (M.setup28.still || {})[s] || 0, (M.setup28.quiet || {})[s] || 0]))); }));
  box.append(fold("All issues", `${(M.issues || []).length}, last 30 days`, b => b.append(tbl(["Issue", "Homes 30 d", "First seen", "Versions (7 d)"], (M.issues || []).map(x => [String(x.key).replace(/^log:WARNING:/, "Log warning: "), x.homes30, fmtDay(x.first), (x.versions7 || []).map(v => v[0]).join(", ") || "–"])))));
  if (M.tiers) box.append(fold("Plans of opt-in homes", "last 7 days", b => b.append(tbl(["Plan", "Homes"], M.tiers.map(([t, n]) => [t, n])))));
  if (M.lic_totals) { const L = M.lic_totals;
    box.append(fold("Keys issued, all time", `${fmtN(L.trial + L.tester + L.pro + L.lifetime)} keys`, b => b.append(tbl(["Plan", "Keys"], [["Trial", L.trial], ["Tester", L.tester], ["Pro", L.pro], ["Lifetime", L.lifetime], ["of which paid", L.paid]])))); }
  box.append(fold("Free Pro push", "invites and testers", renderPro));
  box.append(fold("Find any number", "search every metric", b => {
    const rows = [["Homes checking in, yesterday", M.ns.yday, "BC day", "typical " + Math.round(M.ns.typ)], ["Opt-in homes, 7 days", (M.reports || {}).active7, "7 days", ""], ["Opt-in installs ever", (M.reports || {}).lifetime, "all time", ""],
      ["GitHub stars", M.stars_total, "all time", ""], ...v24.map(([v, n]) => [`Homes on ${v}`, n, "24 h", ""]), ...(M.issues || []).map(x => [x.key, x.homes30, "30 days", x.status])];
    const inp = el("input", { class: "search", type: "search", placeholder: "Type to filter, e.g. warning, 0.38.166, stars", "aria-label": "Filter metrics" });
    const wrap = tbl(["Metric", "Value", "Window", "Note"], rows, 1); b.append(inp, wrap);
    inp.addEventListener("input", () => { const q = inp.value.toLowerCase(); wrap.querySelectorAll("tr").forEach((tr, i) => { if (i) tr.style.display = tr.textContent.toLowerCase().includes(q) ? "" : "none"; }); }); }));
}
// The free-Pro push, from pro.php (the same list the old page showed, folded here).
function renderPro(body) {
  body.append(el("p", { class: "cap" }, "Loading the invite list…"));
  fetch("pro.php", { cache: "no-store", credentials: "same-origin" }).then(r => r.json()).then(d => {
    body.replaceChildren();
    if (!d || !d.ok) throw new Error("no data");
    const c = { invited: 0, delivered: 0, claimed: 0, declined: 0 }; for (const i of d.invites) if (i.status in c) c[i.status]++;
    body.append(el("p", {}, `${d.invites.length} invited in all · ${c.invited} waiting for an update · ${c.delivered} seeing the card · ${c.claimed} claimed · ${c.declined} declined · ${d.testers} tester sign-up${d.testers === 1 ? "" : "s"}. All time.`));
    body.append(tbl(["Install", "Wave", "Status", "Delivered", "Answered", "Until"], d.invites.map(i => [i.id, i.wave, i.status, i.delivered || "–", i.answered || "–", i.until || "–"]), 9));
  }).catch(e => { body.replaceChildren(el("p", { class: "cap" }, "Couldn't load the invite list: " + e.message)); });
}

// ── load and draw ───────────────────────────────────────────────────────────
function renderCharts() { safe(renderTiles, "#tiles"); safe(renderAdopt, "#adopt"); safe(renderGrowth, "#ns"); safe(renderStatus); }
function renderAll() {
  $("#app").hidden = false; $("#loading").hidden = true;   // first: hidden boxes measure 0 wide
  const gen = $("#gen"); gen.replaceChildren(document.createTextNode("Updated " + (M.generated || "–")));
  const age = M.generated_iso ? (Date.now() - Date.parse(M.generated_iso)) / 1000 : 0;
  if (M.stale_after_s && age > M.stale_after_s) gen.append(el("span", { class: "st watch", style: "margin-left:8px" }, `▲ ${Math.round(age / 60)} min old`));
  safe(renderAttention, "#attention"); safe(renderHealth, "#health"); safe(renderSameAge, "#same-age"); safe(renderSetup, "#setup"); safe(renderIssues, "#issues"); safe(renderPerf, "#perf");
  safe(renderDigest, "#digest"); safe(renderElse, "#else"); renderCharts();
}
const refreshBtn = $("#refresh");
async function load(fresh) {
  refreshBtn.disabled = true; refreshBtn.textContent = "Refreshing…";
  try {
    const url = SRC + (fresh ? (SRC.includes("?") ? "&" : "?") + "fresh=1" : "");
    const r = await fetch(url, { cache: "no-store", credentials: "same-origin" });
    if (r.status === 403) { location.reload(); return; }
    const d = await r.json().catch(() => null);
    if (r.status === 503) throw new Error("they aren't built yet (the first build runs within 5 minutes of setup)");
    if (!r.ok || !d || d.ok === false) throw new Error(`the numbers answered ${r.status}`);
    M = d.model || d;
    $("#loaderr").hidden = true;
    renderAll();
  } catch (e) {
    const box = $("#loaderr"); box.hidden = false; box.replaceChildren(el("b", {}, "Couldn't load the numbers. "), document.createTextNode(e.message + ". Try Refresh, or the old view."));
    $("#loading").hidden = true;
  } finally { refreshBtn.disabled = false; refreshBtn.textContent = "Refresh"; }
}
refreshBtn.onclick = () => load(true);
let rz; addEventListener("resize", () => { if (!M) return; clearTimeout(rz); rz = setTimeout(renderCharts, 150); });
load(false);
