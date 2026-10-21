// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
//
// Temperature / humidity / CO2 heatmap on the flat Atlas (buildIsoSVG's
// opts.heatmap). Off by default; with it off buildIsoSVG never calls in here
// and its drawing is byte-identical to before.
//
// Where the numbers come from: every PLACED sensor of the chosen kind with a
// fresh reading (the same "reported in the last hour" rule the temperature
// digits use), plus, for a room with no placed one, the average of the
// room's own unplaced sensors (HA area) at the room's centre. Between them
// the value is inverse-distance weighted on a metre grid per floor, coloured
// in a fixed number of steps so each room is a handful of paths, and each
// room's cells are clipped to its own walls. Cheap: a few thousand cells and
// a few sources, rebuilt with the rest of the drawing every 5 s.

export const HEATMAP_KINDS = ["temp", "humidity", "co2"];
export const HEATMAP_LABELS = { temp: "Temperature", humidity: "Humidity", co2: "CO₂" };
const FRESH_MS = 60 * 60 * 1000;

// Colour stops per kind, in the units drawn (°C, %, ppm). Temperature and
// humidity are a comfort band (green) with cold/dry and hot/damp either side;
// CO2 runs from fresh outdoor air (400) to stuffy (1500 and over).
export const HEAT_SCALES = {
  temp:     { unit: "°", stops: [[16, "#3b82f6"], [19, "#60a5fa"], [20.5, "#34d399"], [23.5, "#34d399"], [25, "#fbbf24"], [28, "#ef4444"]] },
  humidity: { unit: "%", stops: [[20, "#f97316"], [30, "#fbbf24"], [40, "#34d399"], [60, "#34d399"], [70, "#60a5fa"], [80, "#6366f1"]] },
  co2:      { unit: "",  stops: [[400, "#34d399"], [800, "#a3e635"], [1000, "#facc15"], [1250, "#fb923c"], [1500, "#ef4444"]] },
};
const STEPS = 24;

// One device's reading for a kind, or NaN: the right class, a number, and
// reported within the hour. Temperature is drawn in °C whatever HA reports.
export function heatReadingOf(li, kind, nowMs) {
  if (!li) return NaN;
  let v = NaN;
  if (kind === "temp" && li.isTemp) {
    v = Number.isFinite(li.temperature) ? li.temperature : NaN;
    if (/F$/i.test(String(li.air_unit || "").trim())) v = (v - 32) * 5 / 9;
  } else if (kind === "humidity" && li.isHumidity) {
    v = Number.isFinite(li.humidity) ? li.humidity : NaN;
  } else if (kind === "co2" && li.isAir && li.device_class === "carbon_dioxide") {
    v = Number.isFinite(li.air_value) ? li.air_value : NaN;
  }
  if (!Number.isFinite(v)) return NaN;
  const age = li.last_changed ? nowMs - Date.parse(li.last_changed) : NaN;
  return age >= 0 && age < FRESH_MS ? v : NaN;
}

const hexMix = (a, b, t) => {
  const pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16);
  const ch = (sh) => Math.round(((pa >> sh) & 255) + (((pb >> sh) & 255) - ((pa >> sh) & 255)) * t);
  return `#${[ch(16), ch(8), ch(0)].map(v => v.toString(16).padStart(2, "0")).join("")}`;
};
// The colour for a value, snapped to one of STEPS+1 shades across the scale.
export function heatColourOf(kind, v) {
  const st = HEAT_SCALES[kind].stops, lo = st[0][0], hi = st[st.length - 1][0];
  const t = Math.round(Math.max(0, Math.min(1, (v - lo) / (hi - lo))) * STEPS) / STEPS;
  const q = lo + t * (hi - lo);
  for (let i = 1; i < st.length; i++) {
    if (q <= st[i][0]) return hexMix(st[i - 1][1], st[i][1], (q - st[i - 1][0]) / ((st[i][0] - st[i - 1][0]) || 1));
  }
  return st[st.length - 1][1];
}

// The sources for one floor: [{x, y, v}] in metres.
//   placedHere  [{eid, x, y}] this floor's placed devices
//   rooms       this floor's room records ({room, pts})
//   centreOf    room name -> [x, y] (its centroid)
export function heatSources(kind, placedHere, rooms, byRoom, lightsByEid, hiddenEids, placed, centreOf, nowMs, inRoom) {
  const out = [];
  for (const pl of placedHere) {
    if (hiddenEids.has(pl.eid)) continue;
    const v = heatReadingOf(lightsByEid[pl.eid], kind, nowMs);
    if (Number.isFinite(v)) out.push({ x: pl.x, y: pl.y, v });
  }
  for (const r of rooms) {
    if (out.some(p => inRoom(r.pts, p.x, p.y))) continue;
    let sum = 0, n = 0;
    for (const li of (byRoom[r.room] || [])) {
      if (hiddenEids.has(li.entity_id) || placed[li.entity_id]) continue;
      const v = heatReadingOf(li, kind, nowMs);
      if (Number.isFinite(v)) { sum += v; n++; }
    }
    const c = n && centreOf(r.room);
    if (c) out.push({ x: c[0], y: c[1], v: sum / n });
  }
  return out;
}

// One floor's heatmap: per room, a grid of cells in metres (shared across
// the floor so neighbouring rooms line up), each row's runs of equal colour
// merged into one quad, one path per colour, the whole room under its clip.
export function heatFloorSvg(kind, srcs, rooms, box, iso, z, clipOf, opacity) {
  if (!srcs.length || !box) return "";
  const step = Math.max(0.25, Math.max(box.x1 - box.x0, box.y1 - box.y0) / 48);
  const valAt = (x, y) => {
    let ws = 0, vs = 0;
    for (const p of srcs) {
      const dx = x - p.x, dy = y - p.y, w = 1 / (dx * dx + dy * dy + 0.25);
      ws += w; vs += w * p.v;
    }
    return vs / ws;
  };
  const P = (x, y) => { const a = iso(x, y, z); return `${a[0].toFixed(1)} ${a[1].toFixed(1)}`; };
  let s = "";
  for (const r of rooms) {
    const clip = clipOf(r);
    if (!clip || !r.pts.length) continue;
    let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity;
    for (const p of r.pts) { if (p[0] < a) a = p[0]; if (p[0] > c) c = p[0]; if (p[1] < b) b = p[1]; if (p[1] > d) d = p[1]; }
    const i0 = Math.floor((a - box.x0) / step), i1 = Math.ceil((c - box.x0) / step);
    const j0 = Math.floor((b - box.y0) / step), j1 = Math.ceil((d - box.y0) / step);
    const paths = new Map();
    for (let j = j0; j < j1; j++) {
      // A hair of overlap (under one group opacity, so it never darkens)
      // hides the antialiased seam between neighbouring quads.
      const y0 = box.y0 + j * step, y1 = y0 + step * 1.06;
      let runCol = null, runX = 0;
      const flush = (xEnd) => {
        if (runCol === null) return;
        paths.set(runCol, (paths.get(runCol) || "") + `M${P(runX, y0)}L${P(xEnd + step * 0.06, y0)}L${P(xEnd + step * 0.06, y1)}L${P(runX, y1)}Z`);
      };
      for (let i = i0; i < i1; i++) {
        const x0 = box.x0 + i * step;
        const col = heatColourOf(kind, valAt(x0 + step / 2, y0 + step / 2));
        if (col !== runCol) { flush(x0); runCol = col; runX = x0; }
      }
      flush(box.x0 + i1 * step);
    }
    s += `<g clip-path="url(#${clip})">`;
    for (const [col, dd] of paths) s += `<path d="${dd}" fill="${col}"/>`;
    s += `</g>`;
  }
  return s ? `<g class="lheat" data-heat="${kind}" opacity="${opacity}" pointer-events="none">${s}</g>` : "";
}

// The key, in the legend row at (x, y): the kind's name, a strip of its
// stops, the two ends. Returns {svg, end} — end is where the next thing goes.
export function heatLegendSvg(kind, x, y, fs) {
  const sc = HEAT_SCALES[kind], st = sc.stops;
  const name = HEATMAP_LABELS[kind];
  let s = `<text x="${x}" y="${y + 3}" fill="#9fb0a8" font-size="${fs}" font-weight="500">${name}</text>`;
  let lx = x + name.length * fs * 0.6 + 6;
  const lo = `${st[0][0]}${sc.unit}`, hi = `${st[st.length - 1][0]}${sc.unit}+`;
  s += `<text x="${lx}" y="${y + 3}" fill="#9fb0a8" font-size="${fs}">${lo}</text>`;
  lx += lo.length * fs * 0.6 + 3;
  const W = 60, n = 12;
  for (let i = 0; i < n; i++) {
    const v = st[0][0] + (i + 0.5) / n * (st[st.length - 1][0] - st[0][0]);
    s += `<rect x="${(lx + i * W / n).toFixed(1)}" y="${y - 3}" width="${(W / n).toFixed(1)}" height="4" fill="${heatColourOf(kind, v)}"/>`;
  }
  lx += W + 3;
  s += `<text x="${lx}" y="${y + 3}" fill="#9fb0a8" font-size="${fs}">${hi}</text>`;
  return { svg: s, end: lx + hi.length * fs * 0.6 };
}
