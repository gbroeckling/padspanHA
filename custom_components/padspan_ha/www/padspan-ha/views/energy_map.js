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
const { t } = await import(`./i18n.js${new URL(import.meta.url).search}`)
  .catch(() => ({ t: _fill }));

/** How often the figures are asked for again while they are shown. */
export const REFRESH_MS = 30000;

/** Watts as said on the map and in the cards: "120 W", "1.2 kW". */
export function fmtW(w){
  const v = w === null || w === undefined || w === "" ? NaN : Number(w);
  if (!Number.isFinite(v)) return "—";
  return Math.abs(v) >= 1000 ? `${(v / 1000).toFixed(v >= 10000 ? 0 : 1)} kW` : `${Math.round(v)} W`;
}
/** kWh: "0.42 kWh", "12.3 kWh". */
export function fmtKwh(k){
  const v = k === null || k === undefined || k === "" ? NaN : Number(k);
  if (!Number.isFinite(v)) return "—";
  return `${v < 10 ? v.toFixed(2) : v.toFixed(1)} kWh`;
}
/** Money in Home Assistant's currency ("$0.40"; "0.40 CAD" where the browser can't say it), "" without one. */
export function fmtMoney(v, currency){
  const n = Number(v);
  if (!Number.isFinite(n) || !currency) return "";
  try { return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(n); }
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
  row: "display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:5px 0",
  name: "flex:1 1 140px;min-width:0;font-size:13px;overflow:hidden;text-overflow:ellipsis",
  num: "min-width:58px;text-align:right;font-variant-numeric:tabular-nums;font-size:13px",
  watts: "min-width:58px;text-align:right;font-variant-numeric:tabular-nums;font-size:13px;font-weight:800;color:#fbbf24",
  note: "font-size:11px;color:#94a3b8;margin-top:4px",
};
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
  let data = null, at = 0, asking = null, drawn = "", counted = false, sheetCounted = false;
  const count = (w) => { try { o.count(w); } catch (_) { /* the report is never the error */ } };
  const H = () => (o.hass && o.hass()) || {};
  const live = () => !!(data && data.on === true);
  const quiet = () => (live() && Number(data.quiet_w) > 0 ? Number(data.quiet_w) : 1);
  const sigOf = () => JSON.stringify([chipsNow(), wattsNow()]);
  /** Ask again when the last answer is older than REFRESH_MS (or now, forced); the map is drawn again only when what
   *  it shows changed. */
  function refresh(force = false){
    if (asking || (!force && Date.now() - at < REFRESH_MS)) return asking;
    at = Date.now();
    asking = Promise.resolve().then(() => o.fetch()).then((got) => {
      asking = null;
      if (!got || typeof got !== "object") return;
      data = got;
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
    for (const d of data.devices || []) if (d && d.device_id && Number(d.w) >= quiet()) byDevice.set(d.device_id, d.w);
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
  /** {entity id: "45 W"}: every entity of a metered device (its sensors aside), for the map's placed markers. */
  function deviceWatts(){ refresh(); return wattsNow(); }

  /** The room's Energy part for its sheet ({sig, draw}), or null: no metering in the room, or Energy not answered. */
  function sheet(room){
    refresh();
    if (!live()) return null;
    const r = (data.rooms || []).find(x => x && (x.room === room || key(x.room) === key(room)));
    if (!r || !r.metered) return null;
    const byId = new Map((data.devices || []).map(d => [d.id, d]));
    const devs = (r.devices || []).map(id => byId.get(id)).filter(Boolean);
    const cur = data.currency, price = data.price !== null && data.price !== undefined;
    const sig = JSON.stringify([r.w, r.kwh, r.cost, r.empty, cur, devs.map(d => [d.id, d.name, d.own_w, d.own_kwh, d.cost, d.stale, d.always_on])]);
    return {
      sig,
      draw: () => {
        if (!sheetCounted) { sheetCounted = true; count("sheet"); }
        const sec = mk("div", S.section);
        sec.setAttribute("data-room-controls", "energy");
        sec.appendChild(mk("div", S.head, t("Energy")));
        for (const d of devs) {
          const row = mk("div", S.row);
          row.setAttribute("data-energy-device", d.id);
          row.appendChild(mk("span", S.name, d.name));
          row.appendChild(mk("span", S.watts, d.stale ? t("No recent reading") : fmtW(d.own_w)));
          row.appendChild(mk("span", S.num, d.own_kwh === null || d.own_kwh === undefined ? "—" : fmtKwh(d.own_kwh)));
          if (price) row.appendChild(mk("span", S.num, fmtMoney(d.cost, cur)));
          sec.appendChild(row);
        }
        const total = mk("div", S.row + ";border-top:1px solid rgba(120,190,155,.12);font-weight:700");
        total.setAttribute("data-energy-total", "");
        total.appendChild(mk("span", S.name, t("Room total")));
        total.appendChild(mk("span", S.watts, fmtW(r.w)));
        total.appendChild(mk("span", S.num, fmtKwh(r.kwh)));
        if (price) total.appendChild(mk("span", S.num, fmtMoney(r.cost, cur)));
        sec.appendChild(total);
        sec.appendChild(mk("div", S.note, price ? t("Watts now · today's kWh · today's cost") : t("Watts now · today's kWh")));
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
  return { refresh, chips, deviceWatts, sheet, data: () => data };
}
