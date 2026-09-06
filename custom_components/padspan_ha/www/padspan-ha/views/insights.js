// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
// See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
/**
 * Insights — room-dwell analytics (gap #4, best-in-class roadmap).
 *
 * Time-in-room, entry counts, and peak concurrent occupancy, aggregated
 * server-side (dwell_analytics.py) from the same TracebackStore frames
 * Traceback plays back — viewed here as a summary instead of a scrubber.
 * 7-day retention is TracebackStore's own limit, not a choice made here.
 *
 * REMAINING (not built this pass, see docs/BEST_IN_CLASS_ROADMAP.md #4):
 * dwell heat-tint drawn ON the iso map's room polygons — this tab is table
 * form only, deliberately not touching overview.js's iso rendering again
 * right after gap #1's animation work.
 */

let _cache = null, _loading = false, _error = null, _days = 7;

export function render(ctx) {
  const { el, helpBtn } = ctx.helpers;
  const root = el("section", { id: "insights" });

  root.appendChild(el("div", { class: "row", style: "align-items:center;gap:8px;margin-bottom:14px;flex-wrap:wrap" }, [
    el("h2", {}, "Insights"),
    helpBtn("insights"),
    el("span", { class: "muted", style: "font-size:11px" }, "room-dwell analytics from traceback history"),
  ]));

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
          "No traceback history yet for the selected range — Insights builds from the same history Traceback plays back."),
      ]));
      return;
    }
    body.appendChild(_buildDwellCard(ctx, _cache));
    body.appendChild(_buildOccupancyCard(ctx, _cache));
  };

  const load = async (fresh) => {
    if (_loading) return;
    _loading = true; _error = null;
    status.textContent = fresh ? "Refreshing…" : "Loading…";
    renderBody();
    try {
      _cache = await ctx.actions.wsCall("padspan_ha/insights_get", { days: _days });
      const n = _cache.days.length;
      status.textContent = `${n} day${n === 1 ? "" : "s"} of history`;
    } catch (e) {
      _error = (e && (e.message || e.code)) ? String(e.message || e.code) : "failed";
      status.textContent = "";
    }
    _loading = false;
    renderBody();
  };

  if (_cache) renderBody(); else load();
  return root;
}

function _paintDayBtns(btnEls, days) {
  btnEls.forEach((b, i) => {
    b.style.cssText = days[i] === _days
      ? "background:#1b3526;border-color:#52b788;color:#52b788"
      : "";
  });
}

function _buildDwellCard(ctx, data) {
  const { el } = ctx.helpers;
  const card = el("div", { class: "card" });
  const exportCsvBtn = el("button", { class: "btn tiny", style: "margin-left:auto" }, "Export CSV");
  const exportJsonBtn = el("button", { class: "btn tiny" }, "Export JSON");
  exportCsvBtn.addEventListener("click", () => _exportCsv(data));
  exportJsonBtn.addEventListener("click", () => _exportJson(data));
  card.appendChild(el("div", { style: "display:flex;align-items:center;gap:8px;margin-bottom:10px" }, [
    el("div", { style: "font-weight:700;font-size:14px" }, "Time in Room"),
    exportCsvBtn, exportJsonBtn,
  ]));

  const rows = [];
  for (const [key, byDay] of Object.entries(data.dwell)) {
    const name = data.objects[key] || key;
    for (const day of data.days) {
      const rooms = byDay[day];
      if (!rooms) continue;
      const entryRooms = (data.entries[key] || {})[day] || {};
      for (const [room, secs] of Object.entries(rooms)) {
        rows.push({ name, day, room, minutes: Math.round(secs / 6) / 10, entries: entryRooms[room] || 0 });
      }
    }
  }
  if (!rows.length) {
    card.appendChild(el("div", { class: "muted" }, "No dwell time recorded yet."));
    return card;
  }
  rows.sort((a, b) => a.name.localeCompare(b.name) || a.day.localeCompare(b.day) || b.minutes - a.minutes);

  const tbody = el("tbody");
  for (const r of rows) {
    tbody.appendChild(el("tr", {}, [
      el("td", { style: "font-size:11px" }, r.name),
      el("td", { class: "muted", style: "font-size:11px" }, r.day),
      el("td", { style: "font-size:11px" }, r.room),
      el("td", { style: "font-family:monospace;font-size:11px" }, `${r.minutes}m`),
      el("td", { class: "muted", style: "font-size:11px" }, String(r.entries)),
    ]));
  }
  const tableWrap = el("div", { style: "overflow-x:auto;max-height:420px;overflow-y:auto" });
  tableWrap.appendChild(el("table", { class: "table" }, [
    el("thead", {}, el("tr", {}, [
      el("th", {}, "Object"), el("th", {}, "Day"), el("th", {}, "Room"), el("th", {}, "Time"), el("th", {}, "Entries"),
    ])),
    tbody,
  ]));
  card.appendChild(tableWrap);
  return card;
}

function _buildOccupancyCard(ctx, data) {
  const { el } = ctx.helpers;
  const card = el("div", { class: "card", style: "margin-top:14px" });
  card.appendChild(el("div", { style: "font-weight:700;font-size:14px;margin-bottom:6px" }, "Peak Concurrent Occupancy"));
  card.appendChild(el("div", { class: "muted", style: "font-size:12px;margin-bottom:10px" },
    "The most tracked objects seen in one room at the same time, per day."));

  // Reduce the hourly grid to one peak (room, hour, count) per room per day
  // — a full hour-by-hour timeline is more data than a summary view needs.
  const peaks = [];
  for (const day of data.days) {
    const byHour = data.occupancy[day];
    if (!byHour) continue;
    const perRoomPeak = {};
    for (const [hour, rooms] of Object.entries(byHour)) {
      for (const [room, count] of Object.entries(rooms)) {
        if (!perRoomPeak[room] || count > perRoomPeak[room].count) perRoomPeak[room] = { count, hour };
      }
    }
    for (const [room, v] of Object.entries(perRoomPeak)) {
      peaks.push({ day, room, count: v.count, hour: v.hour });
    }
  }
  if (!peaks.length) {
    card.appendChild(el("div", { class: "muted" }, "No occupancy data yet."));
    return card;
  }
  peaks.sort((a, b) => b.count - a.count || a.day.localeCompare(b.day));
  const tbody = el("tbody");
  for (const p of peaks.slice(0, 40)) {
    tbody.appendChild(el("tr", {}, [
      el("td", { class: "muted", style: "font-size:11px" }, p.day),
      el("td", { style: "font-size:11px" }, p.room),
      el("td", { class: "muted", style: "font-size:11px" }, `${p.hour}:00`),
      el("td", { style: "font-family:monospace;font-size:11px" }, String(p.count)),
    ]));
  }
  card.appendChild(el("table", { class: "table" }, [
    el("thead", {}, el("tr", {}, [
      el("th", {}, "Day"), el("th", {}, "Room"), el("th", {}, "Peak Hour"), el("th", {}, "Objects"),
    ])),
    tbody,
  ]));
  return card;
}

// Quote + neutralize spreadsheet formula injection, same escaper as
// forensics.js's CSV export — one implementation of this rule, not two.
function _csvEsc(v) {
  v = String(v == null ? "" : v);
  if (/^[=+\-@\t\r]/.test(v)) v = "'" + v;
  return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
}

function _downloadBlob(content, type, filename) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function _exportCsv(data) {
  const lines = ["object,day,room,minutes,entries"];
  for (const [key, byDay] of Object.entries(data.dwell)) {
    const name = data.objects[key] || key;
    for (const [day, rooms] of Object.entries(byDay)) {
      const entryRooms = (data.entries[key] || {})[day] || {};
      for (const [room, secs] of Object.entries(rooms)) {
        lines.push([name, day, room, Math.round(secs / 6) / 10, entryRooms[room] || 0].map(_csvEsc).join(","));
      }
    }
  }
  _downloadBlob(lines.join("\n"), "text/csv",
    `padspan-insights-${new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)}.csv`);
}

function _exportJson(data) {
  _downloadBlob(JSON.stringify(data, null, 2), "application/json",
    `padspan-insights-${new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)}.json`);
}
