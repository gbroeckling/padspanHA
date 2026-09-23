// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
// See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
/**
 * Busy Times — aggregate historical room activity across every tracked
 * object, over a selectable day range: which rooms are busiest, and when.
 *
 * This is a different lens than anything else in the app: the live RSSI
 * heatmap (radio_map.js) is a signal-quality surface tied to one scanner's
 * radio coverage, and Traceback/Insights are single-object or per-object
 * history. Busy Times is population-level and time-windowed — every
 * tracked object's dwell time, summed per room, over the last 1/3/7 days —
 * the same shape of view RTLS/retail dwell-analytics dashboards use and
 * PadSpan didn't have one of (docs/BEST_IN_CLASS_ROADMAP.md #4 flagged
 * "dwell heat tint ... deliberately not touched this pass" back when
 * Insights shipped as a table; this is that gap, as its own tab).
 *
 * No new backend: reuses padspan_ha/insights_get verbatim (same call
 * insights.js makes) and re-aggregates dwell_analytics.py's per-object
 * dwell/occupancy data down to per-room totals and a 24-hour profile.
 *
 * Deliberately a flat room-box grid (the same pattern overview.js's Room
 * Grid uses), not drawn onto the 3D isometric floor stack — the iso stack's
 * frame-fitting is its own hard-won, easy-to-subtly-break pipeline
 * (docs/03_MAPPING_SUITE.md), and cramming a second concern into it is
 * exactly what Insights' own "not touched this pass" note was avoiding.
 *
 * PadSpan Pro — the underlying dwell data is already free (it's the same
 * padspan_ha/insights_get Insights uses), so this is a presentation-layer
 * gate, the same pattern Automorph and Showcase already use over otherwise-
 * free Atlas data. No dedicated backend gate for that reason: gating
 * insights_get itself would also break the free Insights tab.
 */

const { tierAtLeast, currentTier } =
  await import(`./editions.js${new URL(import.meta.url).search}`);

let _cache = null, _loading = null, _loadingDays = null, _error = null, _days = 7;

export function render(ctx) {
  const { el, helpBtn } = ctx.helpers;
  const root = el("section", { id: "busytimes" });

  root.appendChild(el("div", { class: "row", style: "align-items:center;gap:8px;margin-bottom:14px;flex-wrap:wrap" }, [
    el("h2", {}, "Busy Times"),
    helpBtn("busytimes"),
    el("span", { class: "muted", style: "font-size:11px" }, "which rooms are busiest, and when — aggregated across every tracked object"),
  ]));

  if (!tierAtLeast(currentTier(ctx.state.settings), "pro")) {
    root.appendChild(_buildProGateCard(ctx, "Busy Times"));
    return root;
  }

  const dayBtnEls = [1, 3, 7].map(d => {
    const b = el("button", { class: "btn tiny" }, `${d}d`);
    b.addEventListener("click", () => { _days = d; _paintDayBtns(dayBtnEls, [1, 3, 7]); load(); });
    return b;
  });
  _paintDayBtns(dayBtnEls, [1, 3, 7]);
  root.appendChild(el("div", { style: "display:flex;gap:6px;margin-bottom:10px" }, dayBtnEls));

  const status = el("span", { class: "muted", style: "font-size:11px" }, "");
  const refresh = el("button", { class: "btn inline" }, "Refresh");
  refresh.addEventListener("click", () => load(true));
  root.appendChild(el("div", { style: "display:flex;gap:10px;align-items:center;margin-bottom:12px" }, [refresh, status]));

  const body = el("div");
  root.appendChild(body);

  const renderBody = () => {
    body.innerHTML = "";
    if (_error) {
      body.appendChild(el("div", { class: "card" }, el("div", { class: "muted" }, "Failed: " + _error)));
      return;
    }
    if (!_cache) {
      body.appendChild(el("div", { class: "card" }, el("div", { class: "muted" }, "Loading…")));
      return;
    }
    if (!_cache.days.length) {
      body.appendChild(el("div", { class: "card" }, [
        el("div", { class: "muted" },
          "No traceback history yet for the selected range — Busy Times builds from the same history Traceback and Insights use."),
      ]));
      return;
    }
    body.appendChild(_buildBusyGrid(ctx, _cache));
  };

  // One request at a time, shared by every mounted copy of this view: a copy
  // mounted while another's request is in flight waits for it and paints
  // itself (inside Traceback there is no poll re-render to repair a copy
  // that returned early — review 2026-09-23).
  const load = async (fresh) => {
    status.textContent = fresh ? "Refreshing…" : "Loading…";
    // A request for a different day range finishes first, then this one runs.
    while (_loading && _loadingDays !== _days) await _loading;
    if (!_loading) {
      _loadingDays = _days;
      _loading = (async () => {
        _error = null;
        try {
          const res = await ctx.actions.wsCall("padspan_ha/insights_get", { days: _days });
          if (!res || !Array.isArray(res.days)) throw new Error("unexpected reply");
          _cache = res;
        } catch (e) { _cache = null; _error = (e && (e.message || e.code)) ? String(e.message || e.code) : "failed"; }
      })();
      _loading.finally(() => { _loading = null; });
      if (fresh) _cache = null;
    }
    renderBody();
    await _loading;
    const n = _cache ? _cache.days.length : 0;
    status.textContent = _error ? "" : `${n} day${n === 1 ? "" : "s"} of history`;
    renderBody();
  };

  if (_cache) renderBody(); else load();
  return root;
}

function _paintDayBtns(btnEls, days) {
  btnEls.forEach((b, i) => {
    b.style.cssText = days[i] === _days
      ? "background:#3a1a0a;border-color:#f59e0b;color:#f59e0b"
      : "";
  });
}

// Quiet (little/no dwell time) through hot (the busiest room in range) — a
// warm scale, deliberately distinct from the cool blue/green scale the
// live RSSI heatmap uses elsewhere, so "busy" can never be misread as
// "good signal" or vice versa.
function _heatColor(t) {
  t = Math.max(0, Math.min(1, t));
  const stops = [
    [0.00, [10, 26, 15]],
    [0.35, [120, 78, 30]],
    [0.70, [217, 119, 6]],
    [1.00, [248, 113, 113]],
  ];
  let a = stops[0], b = stops[stops.length - 1];
  for (let i = 0; i < stops.length - 1; i++) {
    if (t >= stops[i][0] && t <= stops[i + 1][0]) { a = stops[i]; b = stops[i + 1]; break; }
  }
  const span = (b[0] - a[0]) || 1;
  const lt = (t - a[0]) / span;
  const mix = (x, y) => Math.round(x + (y - x) * lt);
  const r = mix(a[1][0], b[1][0]), g = mix(a[1][1], b[1][1]), bl = mix(a[1][2], b[1][2]);
  return `rgb(${r},${g},${bl})`;
}

function _fmtDuration(secs) {
  if (!secs) return "0m";
  const h = Math.floor(secs / 3600), m = Math.round((secs % 3600) / 60);
  return h ? `${h}h ${m}m` : `${m}m`;
}

function _buildBusyGrid(ctx, data) {
  const { el } = ctx.helpers;
  const card = el("div", { class: "card" });

  // Per-room total dwell seconds, summed across every object and day in range.
  const roomTotals = {};
  for (const byDay of Object.values(data.dwell)) {
    for (const rooms of Object.values(byDay)) {
      for (const [room, secs] of Object.entries(rooms)) {
        roomTotals[room] = (roomTotals[room] || 0) + secs;
      }
    }
  }

  // Per-room 24-hour occupancy profile, summed across every day in range —
  // "when" a room gets busy, not just "how much" overall.
  const roomHourly = {};
  for (const byHour of Object.values(data.occupancy)) {
    for (const [hour, rooms] of Object.entries(byHour)) {
      const h = parseInt(hour, 10);
      for (const [room, count] of Object.entries(rooms)) {
        const arr = roomHourly[room] || (roomHourly[room] = new Array(24).fill(0));
        arr[h] = (arr[h] || 0) + count;
      }
    }
  }

  const rooms = Object.keys(roomTotals).sort((a, b) => roomTotals[b] - roomTotals[a]);
  if (!rooms.length) {
    card.appendChild(el("div", { class: "muted" }, "No dwell time recorded yet in this range."));
    return card;
  }
  const maxTotal = Math.max(...rooms.map(r => roomTotals[r]));

  card.appendChild(el("div", { style: "display:flex;align-items:center;gap:8px;margin-bottom:10px;flex-wrap:wrap" }, [
    el("div", { style: "font-weight:700;font-size:14px" }, "Room Activity"),
    el("span", { class: "muted", style: "font-size:10px" },
      "colour = total time occupied, relative to the busiest room in range · red bar = that room's busiest hour"),
  ]));

  const COLS = 2, BW = 380, BH = 210, GAP = 16, PX = 14, PY = 14;
  const rowsN = Math.ceil(rooms.length / COLS);
  const svgW = COLS * (BW + GAP) - GAP + PX * 2;
  const svgH = rowsN * (BH + GAP) - GAP + PY * 2;
  const _esc = s => String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

  let s = `<svg viewBox="0 0 ${svgW} ${svgH}" xmlns="http://www.w3.org/2000/svg" width="100%" style="display:block;font-family:system-ui,sans-serif">`;
  s += `<rect width="${svgW}" height="${svgH}" fill="#071008" rx="8"/>`;

  rooms.forEach((room, idx) => {
    const col = idx % COLS, row = Math.floor(idx / COLS);
    const x = PX + col * (BW + GAP), y = PY + row * (BH + GAP);
    const t = maxTotal > 0 ? roomTotals[room] / maxTotal : 0;
    const color = _heatColor(t);

    s += `<rect x="${x}" y="${y}" width="${BW}" height="${BH}" fill="${color}" fill-opacity="${(0.12 + t * 0.18).toFixed(2)}" stroke="${color}" stroke-width="1.5" rx="10"/>`;
    s += `<text x="${x + 14}" y="${y + 26}" fill="${color}" font-size="15" font-weight="700">${_esc(room)}</text>`;
    s += `<text x="${x + 14}" y="${y + 50}" fill="#e2e8f0" font-size="22" font-weight="700">${_fmtDuration(roomTotals[room])}</text>`;
    s += `<text x="${x + 14}" y="${y + 66}" fill="#4a6052" font-size="9">total occupied time, this range</text>`;

    // 24-hour sparkline — when this room gets busy, not just how much.
    const hourly = roomHourly[room] || new Array(24).fill(0);
    const hMax = Math.max(1, ...hourly);
    const barW = (BW - 28) / 24, barMaxH = 70, baseY = y + BH - 20;
    let peakHour = 0, peakVal = -1;
    hourly.forEach((v, h) => { if (v > peakVal) { peakVal = v; peakHour = h; } });
    for (let h = 0; h < 24; h++) {
      const bh = Math.max(1, (hourly[h] / hMax) * barMaxH);
      const bx = x + 14 + h * barW;
      const barColor = (h === peakHour && peakVal > 0) ? "#f87171" : color;
      s += `<rect x="${bx.toFixed(1)}" y="${(baseY - bh).toFixed(1)}" width="${Math.max(1, barW - 1).toFixed(1)}" height="${bh.toFixed(1)}" fill="${barColor}" fill-opacity="${hourly[h] > 0 ? 0.85 : 0.15}"/>`;
    }
    s += `<line x1="${x + 14}" y1="${baseY}" x2="${x + BW - 14}" y2="${baseY}" stroke="#1b3526" stroke-width="1"/>`;
    s += `<text x="${x + 14}" y="${baseY + 12}" fill="#4a6052" font-size="8">0:00</text>`;
    s += `<text x="${x + BW - 14}" y="${baseY + 12}" text-anchor="end" fill="#4a6052" font-size="8">23:00</text>`;
    if (peakVal > 0) {
      s += `<text x="${x + BW - 14}" y="${y + 50}" text-anchor="end" fill="#f87171" font-size="10">busiest ${String(peakHour).padStart(2, "0")}:00</text>`;
    }
  });

  s += `</svg>`;
  const wrap = document.createElement("div");
  wrap.innerHTML = s;
  card.appendChild(wrap);
  return card;
}

function _buildProGateCard(ctx, featureName) {
  const { el } = ctx.helpers;
  const card = el("div", { class: "card" });
  card.appendChild(el("div", { style: "font-weight:700;font-size:16px;margin-bottom:6px" },
    `${featureName} is a PadSpan Pro feature`));
  card.appendChild(el("div", { class: "muted", style: "font-size:12px;margin-bottom:10px" },
    "Unlock it, and everything else gated, with a PadSpan Pro key — or start a one-time 3-month free trial, no card required."));
  card.appendChild(el("div", { class: "muted", style: "font-size:11px" }, "Settings → Features → PadSpan licence"));
  return card;
}
