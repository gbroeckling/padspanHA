// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
// See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
//
// Energy on the Atlas (the Energy add-on; the owner, 2026-11-26). Its figures
// are the backend's (energy.py, padspan_ha/energy_get), read from Home
// Assistant's own Energy setup; this module only says them.
//
//   the switch  Audio's rules: on the display layout and on a wall, the ⋯
//               list's "Energy" line (key energy, per screen, off unless
//               ticked; offered only where the house has Energy turned on and
//               the add-on); on the classic layout Settings → Atlas → Energy
//               (atlas_energy_enabled). Off, nothing here is read or drawn.
//   the map     "⚡ 120 W" by the name of a room with metering (chips), and a
//               placed device's watts by its marker (deviceWatts). Quiet: no
//               room without metering, nothing under the backend's quiet_w.
//   the sheet   the room's sheet (lights_map.js openRoomSheet) gains an Energy
//               part: each metered device with its watts now, kWh today and
//               cost today, and the room's total (sheet).
//
// It asks Home Assistant only through its host (o.fetch), at most every
// REFRESH_MS, and imports nothing but its words.

const _fill = (s, v) => s.replace(/\{(\w+)\}/g, (m, k) => (v && Object.prototype.hasOwnProperty.call(v, k) ? String(v[k]) : m));
const { t, currentLanguage } = await import(`./i18n.js${new URL(import.meta.url).search}`)
  .catch(() => ({ t: _fill, currentLanguage: () => "en" }));

/** The panel's language for numbers, money and dates ("de": 1,8 kW). */
export const locale = () => { try { return (currentLanguage && currentLanguage()) || "en"; } catch (_) { return "en"; } };
/** ⚡ drawn as text, in the colour around it, never as a colour emoji (U+FE0E, as the transport's are). */
export const BOLT = "\u26A1\uFE0E";
const num = (v, digits) => {
  try { return new Intl.NumberFormat(locale(), { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(v); }
  catch (_) { return v.toFixed(digits); }
};

/** How often the figures are asked for again while they are shown. */
export const REFRESH_MS = 30000;

/** Watts as said on the map and in the cards: "120 W", "1.2 kW". */
export function fmtW(w){
  const v = w === null || w === undefined || w === "" ? NaN : Number(w);
  if (!Number.isFinite(v)) return "—";
  return Math.abs(v) >= 1000 ? `${num(v / 1000, Math.abs(v) >= 10000 ? 0 : 1)} kW` : `${num(Math.round(v), 0)} W`;
}
/** kWh: "0.42 kWh", "12.3 kWh". */
export function fmtKwh(k){
  const v = k === null || k === undefined || k === "" ? NaN : Number(k);
  if (!Number.isFinite(v)) return "—";
  return `${num(v, v < 10 ? 2 : 1)} kWh`;
}
/** Money in Home Assistant's currency ("$0.40"; "0.40 CAD" where the browser can't say it), "" without one. */
export function fmtMoney(v, currency){
  const n = Number(v);
  if (!Number.isFinite(n) || !currency) return "";
  try { return new Intl.NumberFormat(locale(), { style: "currency", currency, currencyDisplay: "narrowSymbol" }).format(n); }
  catch (_) { return `${n.toFixed(2)} ${currency}`; }
}
/** A stretch of time: "40 min", "2 h", "2 h 10 min", "3 d". */
export function fmtFor(s){
  const m = Math.max(0, Math.round(Number(s) / 60) || 0);
  if (m < 60) return t("{n} min", { n: m });
  const h = Math.floor(m / 60), r = m % 60;
  if (h >= 48) return t("{n} d", { n: Math.floor(h / 24) });
  return r && h < 10 ? t("{h} h {m} min", { h, m: r }) : t("{n} h", { n: h });
}

const S = {
  section: "padding:6px 2px 8px;border-bottom:1px solid rgba(120,190,155,.12);margin-bottom:6px",
  head: "font-size:10px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:#94a3b8;margin:2px 0 2px",
  row: "display:flex;align-items:center;gap:8px;flex-wrap:nowrap;padding:5px 0",
  name: "flex:1 1 auto;min-width:0;font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap",
  // The figures together, never wrapped under the name.
  figs: "display:inline-flex;align-items:center;gap:8px;flex:0 0 auto;flex-wrap:nowrap",
  num: "min-width:58px;text-align:right;font-variant-numeric:tabular-nums;font-size:13px;white-space:nowrap",
  watts: "min-width:58px;text-align:right;font-variant-numeric:tabular-nums;font-size:13px;font-weight:800;color:#fbbf24;white-space:nowrap",
  legend: "display:flex;justify-content:flex-end;gap:8px;font-size:10px;color:#94a3b8;margin:0 0 2px",
  note: "font-size:11px;color:#94a3b8;margin-top:4px",
};
// The cost column only where it fits beside the name (a phone narrower than this has watts and kWh).
const COST_MIN_PX = 400;
const mk = (tag, style, text) => { const n = document.createElement(tag); if (style) n.style.cssText = style; if (text !== undefined) n.textContent = text; return n; };
const key = (s) => String(s || "").toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();

/**
 * Energy for one screen. o:
 *   fetch()     resolves to energy_get's answer (the host's WebSocket call)
 *   hass()      Home Assistant now (entities, for a placed device's own sensors)
 *   count(word) the report's energy:<word>; redraw() the map and an open sheet
 * Returns { refresh, chips, deviceWatts, sheet, data } — functions only.
 */
export function createEnergy(o){
  let data = null, at = 0, asking = null, drawn = "", counted = false, sheetCounted = false, watts = {};
  const count = (w) => { try { o.count(w); } catch (_) { /* the report is never the error */ } };
  const H = () => (o.hass && o.hass()) || {};
  const live = () => !!(data && data.on === true);
  const quiet = () => (live() && Number(data.quiet_w) > 0 ? Number(data.quiet_w) : 1);
  const sigOf = () => JSON.stringify([chipsNow(), watts]);
  /** Ask again when the last answer is older than REFRESH_MS (or now, forced); the map is drawn again only when what
   *  it shows changed. */
  function refresh(force = false){
    if (asking || (!force && Date.now() - at < REFRESH_MS)) return asking;
    at = Date.now();
    asking = Promise.resolve().then(() => o.fetch()).then((got) => {
      asking = null;
      if (!got || typeof got !== "object") return;
      data = got;
      watts = wattsNow();                      // once per answer: it walks the entity registry
      const sig = sigOf();
      if (sig !== drawn) { drawn = sig; try { o.redraw(); } catch (_) { /* gone */ } }
    }, () => { asking = null; });
    return asking;
  }
  function chipsNow(){
    const out = {};
    if (!live()) return out;
    for (const r of data.rooms || []) {
      if (r && r.on_map && r.metered > 0 && Number(r.w) >= quiet()) out[r.room] = fmtW(r.w);
    }
    return out;
  }
  function wattsNow(){
    const out = {};
    if (!live()) return out;
    const byDevice = new Map();
    // Several metered devices on one Home Assistant device (a strip's outlets): their watts together.
    for (const d of data.devices || []) {
      if (d && d.device_id && Number.isFinite(Number(d.w)) && d.w !== null) byDevice.set(d.device_id, (byDevice.get(d.device_id) || 0) + Number(d.w));
    }
    for (const [k, w] of byDevice) if (w < quiet()) byDevice.delete(k);
    if (!byDevice.size) return out;
    for (const [eid, e] of Object.entries(H().entities || {})) {
      const w = e && e.device_id ? byDevice.get(e.device_id) : undefined;
      if (w !== undefined && !eid.startsWith("sensor.")) out[eid] = fmtW(w);
    }
    return out;
  }
  /** {room: "120 W"}: rooms on the map with metering, at or over the quiet threshold. */
  function chips(){
    refresh();
    if (!counted && live()) { counted = true; count("on"); }
    const c = chipsNow();
    drawn = drawn || sigOf();
    return c;
  }
  /** {entity id: "45 W"}: every entity of a metered device (its sensors aside), for the map's placed markers; worked
   *  out once per answer. */
  function deviceWatts(){ refresh(); return watts; }

  /** The room's Energy part for its sheet ({sig, draw}), or null: no metering in the room, or Energy not answered. */
  /** The room's answer and its metered devices, or null: no metering in the room, or Energy not answered. */
  function roomOf(room){
    if (!live()) return null;
    const r = (data.rooms || []).find(x => x && (x.room === room || key(x.room) === key(room)));
    if (!r || !r.metered) return null;
    const byId = new Map((data.devices || []).map(d => [d.id, d]));
    return { r, devs: (r.devices || []).map(id => byId.get(id)).filter(Boolean) };
  }
  /** The sensors the room's Energy rows read (each device's energy sensor and its power sensor): what the 3D panel's
   *  "More devices of the area" leaves out while the card shows them. [] where the card has no Energy part. */
  function shownIn(room){
    const got = roomOf(room);
    return got ? got.devs.flatMap(d => [d.id, d.rate]).filter(e => typeof e === "string" && e) : [];
  }
  function sheet(room){
    refresh();
    const got = roomOf(room);
    if (!got) return null;
    const { r, devs } = got;
    const cur = data.currency;
    const wide = !(typeof window !== "undefined" && Number(window.innerWidth) > 0 && window.innerWidth < COST_MIN_PX);
    const price = data.price !== null && data.price !== undefined && wide;
    // Every reading in the room stale: its watts aren't known ("—"), never "0 W" (nothing on).
    const allStale = devs.length > 0 && devs.every(d => d.stale);
    const sig = JSON.stringify([r.w, r.kwh, r.cost, r.empty, cur, price, devs.map(d => [d.id, d.name, d.own_w, d.own_kwh, d.cost, d.stale, d.always_on])]);
    return {
      sig,
      draw: () => {
        if (!sheetCounted) { sheetCounted = true; count("sheet"); }
        const sec = mk("div", S.section);
        sec.setAttribute("data-room-controls", "energy");
        sec.appendChild(mk("div", S.head, t("Energy")));
        // The columns' words above the rows they name.
        const legend = mk("div", S.legend);
        legend.setAttribute("data-energy-legend", "");
        legend.appendChild(mk("span", null, price ? t("Watts now · today's kWh · today's cost") : t("Watts now · today's kWh")));
        sec.appendChild(legend);
        const figures = (w, kwh, cost) => {
          const g = mk("span", S.figs);
          g.appendChild(mk("span", S.watts, w));
          g.appendChild(mk("span", S.num, kwh));
          if (price) g.appendChild(mk("span", S.num, cost));
          return g;
        };
        for (const d of devs) {
          const row = mk("div", S.row);
          row.setAttribute("data-energy-device", d.id);
          const name = mk("span", S.name, d.name);
          name.title = d.name;
          row.appendChild(name);
          row.appendChild(figures(d.stale ? "—" : fmtW(d.own_w), d.own_kwh === null || d.own_kwh === undefined ? "—" : fmtKwh(d.own_kwh),
            fmtMoney(d.cost, cur)));
          sec.appendChild(row);
        }
        const total = mk("div", S.row + ";border-top:1px solid rgba(120,190,155,.12);font-weight:700");
        total.setAttribute("data-energy-total", "");
        total.appendChild(mk("span", S.name, t("Room total")));
        total.appendChild(figures(allStale ? "—" : fmtW(r.w), fmtKwh(r.kwh), fmtMoney(r.cost, cur)));
        sec.appendChild(total);
        // A stale reading's "—" said once, under the rows.
        if (devs.some(d => d.stale)) sec.appendChild(mk("div", S.note, t("— No recent reading")));
        if (r.empty) {
          const money = fmtMoney(r.empty.cost, cur);
          sec.appendChild(mk("div", S.note + ";color:#fbbf24", money
            ? t("Empty for {for}: {w} (about {money} today)", { for: fmtFor(r.empty.for_s), w: fmtW(r.empty.w), money })
            : t("Empty for {for}: {w}", { for: fmtFor(r.empty.for_s), w: fmtW(r.empty.w) })));
        }
        return sec;
      },
    };
  }
  return { refresh, chips, deviceWatts, sheet, shownIn, data: () => data };
}
