// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
// See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
/**
 * Wi-Fi coverage (views/wifi.js, test 2026-11-22): how strong the Wi-Fi is around the house, measured in everyday
 * use. The readings come from UniFi Utopia (unifi_utopia/wifi_heatmap): how strongly each access
 * point hears a phone while it sits still somewhere, and each placed smart device where PadSpan
 * has it. PadSpan only draws them, on its own floor model (rooms in metres, never a photograph),
 * in the same colours as its radio map. The tab exists only while UniFi Utopia answers.
 * UniFi Utopia also says what is worth fixing (findings, most urgent first) and where its access
 * points are (put there by an administrator, or estimated from the devices that hear them best).
 */

const V = new URL(import.meta.url).search;
const RM = await import(`./radio_map.js${V}`);

export const WORST = -85;     // dBm at the red end of the ramp
export const BEST = -45;      // dBm at the green end
export const REACH_M = 2.5;   // a reading colours the floor this far round it, no further
const PX_M = 0.2;             // raster pixel size
const MAX_PX = 220;           // per side
const REFRESH_MS = 60000;

const st = (ctx) => ctx.state._wifi || (ctx.state._wifi = { data: null, ts: 0, floor: null, band: null, ap: "*", err: "", links: null });

/** Is UniFi Utopia's Wi-Fi survey there? (the panel asks once and keeps the answer for its menu) */
export async function probe(callWS) {
  try {
    const r = await callWS({ type: "unifi_utopia/wifi_heatmap" });
    return !!(r && r.version >= 1);
  } catch (_e) {
    return false;
  }
}

export const colour = (dbm) => {
  const [r, g, b] = RM.heatRamp((dbm - WORST) / (BEST - WORST));
  return `rgb(${r},${g},${b})`;
};

export function words(dbm) {
  if (!Number.isFinite(dbm)) return "";
  if (dbm >= -55) return "excellent";
  if (dbm >= -65) return "good";
  if (dbm >= -72) return "fair";
  if (dbm >= -80) return "weak";
  return "very weak";
}

function inPoly(x, y, P) {
  let c = false;
  for (let i = 0, j = P.length - 1; i < P.length; j = i++) {
    const [xi, yi] = P[i], [xj, yj] = P[j];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c;
  }
  return c;
}

/** The rooms of one floor, in metres, from PadSpan's own floor model. */
export function floorRooms(model, floor) {
  const g = (model && model.room_geometry_m) || {};
  return Object.entries(g)
    .filter(([, r]) => r && r.floor_id === floor && Array.isArray(r.points_m) && r.points_m.length >= 3)
    .map(([name, r]) => ({ name, pts: r.points_m.map((p) => [Number(p[0]), Number(p[1])]) }));
}

/** Readings that colour the floor: phone cells and placed devices, each a point with a value. */
export function points(data, floor, band) {
  const out = [];
  for (const c of data.cells || []) if (c.floor === floor && c.band === band) out.push({ x: c.x, y: c.y, v: c.median, n: c.n });
  for (const f of data.fixed || []) if (f.floor === floor && f.band === band) out.push({ x: f.x, y: f.y, v: f.median, n: f.n, fixed: true });
  return out;
}

/** Inverse-distance weighting inside REACH_M, clipped to the rooms; NaN where nothing was measured. */
export function raster(rooms, pts, bb) {
  const w = Math.max(1, Math.min(MAX_PX, Math.ceil((bb.x1 - bb.x0) / PX_M)));
  const h = Math.max(1, Math.min(MAX_PX, Math.ceil((bb.y1 - bb.y0) / PX_M)));
  const sx = (bb.x1 - bb.x0) / w, sy = (bb.y1 - bb.y0) / h;
  const grid = new Float32Array(w * h).fill(NaN);
  for (let j = 0; j < h; j++) {
    const y = bb.y0 + (j + 0.5) * sy;
    for (let i = 0; i < w; i++) {
      const x = bb.x0 + (i + 0.5) * sx;
      if (rooms.length && !rooms.some((r) => inPoly(x, y, r.pts))) continue;
      let sw = 0, sv = 0;
      for (const p of pts) {
        const d = Math.hypot(p.x - x, p.y - y);
        if (d > REACH_M) continue;
        const wt = 1 / Math.max(0.3, d) ** 2;
        sw += wt; sv += wt * p.v;
      }
      if (sw > 0) grid[j * w + i] = sv / sw;
    }
  }
  return { grid, w, h };
}

function rasterURL(r) {
  const px = new Uint8ClampedArray(r.w * r.h * 4);
  for (let k = 0; k < r.grid.length; k++) {
    const v = r.grid[k];
    if (!Number.isFinite(v)) continue;
    const [cr, cg, cb] = RM.heatRamp((v - WORST) / (BEST - WORST));
    px[k * 4] = cr; px[k * 4 + 1] = cg; px[k * 4 + 2] = cb; px[k * 4 + 3] = 200;
  }
  return RM.rasterPNG(px, r.w, r.h);
}

function bbox(rooms, pts, extra = []) {
  const xs = [], ys = [];
  for (const r of rooms) for (const [x, y] of r.pts) { xs.push(x); ys.push(y); }
  for (const p of [...pts, ...extra]) { xs.push(p.x); ys.push(p.y); }
  if (!xs.length) return null;
  const pad = 1;
  return { x0: Math.min(...xs) - pad, y0: Math.min(...ys) - pad, x1: Math.max(...xs) + pad, y1: Math.max(...ys) + pad };
}

/** The access points with a spot on this floor (put there, or estimated). */
export function floorAPs(data, floor) {
  return (data.aps || []).filter((a) => a && a.floor === floor && Number.isFinite(a.x) && Number.isFinite(a.y));
}

/** The floor drawing: rooms, the coloured coverage, each room's typical reading, the placed devices,
 *  the access points, and a ring round what the picked finding is about (opt.focus). */
export function floorSVG(ctx, data, floor, band, opt = {}) {
  const { esc } = ctx.helpers;
  const rooms = floorRooms(ctx.state.model, floor);
  const pts = points(data, floor, band);
  const aps = floorAPs(data, floor);
  const bb = bbox(rooms, pts, aps);
  if (!bb) return "";
  const W = bb.x1 - bb.x0, H = bb.y1 - bb.y0, fs = Math.max(0.28, Math.min(W, H) / 38);
  const parts = [];
  for (const r of rooms) {
    parts.push(`<polygon points="${r.pts.map(([x, y]) => `${x},${y}`).join(" ")}" fill="#0f1a14" stroke="none"/>`);
  }
  if (pts.length) {
    const ras = raster(rooms, pts, bb);
    const url = rasterURL(ras);
    if (url) {
      parts.push(`<image href="${url}" x="${bb.x0}" y="${bb.y0}" width="${W}" height="${H}" preserveAspectRatio="none" style="image-rendering:auto"/>`);
    } else {
      // No canvas (tests, very old browsers): the measured cells as squares.
      for (const c of data.cells || []) {
        if (c.floor !== floor || c.band !== band) continue;
        parts.push(`<rect data-wifi="cell" x="${c.x - c.size / 2}" y="${c.y - c.size / 2}" width="${c.size}" height="${c.size}" fill="${colour(c.median)}" opacity="0.8"/>`);
      }
    }
  }
  for (const r of rooms) {
    parts.push(`<polygon points="${r.pts.map(([x, y]) => `${x},${y}`).join(" ")}" fill="none" stroke="#3d5a48" stroke-width="${fs * 0.12}"/>`);
  }
  const roomVals = new Map((data.rooms || []).filter((x) => x.floor === floor && x.band === band).map((x) => [x.room, x]));
  for (const r of rooms) {
    const cx = r.pts.reduce((a, p) => a + p[0], 0) / r.pts.length, cy = r.pts.reduce((a, p) => a + p[1], 0) / r.pts.length;
    const rv = roomVals.get(r.name);
    parts.push(`<text x="${cx}" y="${cy}" font-size="${fs}" text-anchor="middle" fill="#cbd5e1" style="paint-order:stroke" stroke="#0b0f0c" stroke-width="${fs * 0.25}">${esc(r.name)}</text>`);
    if (rv) {
      parts.push(`<text data-wifi="room" x="${cx}" y="${cy + fs * 1.2}" font-size="${fs * 1.1}" font-weight="700" text-anchor="middle" fill="${colour(rv.median)}" style="paint-order:stroke" stroke="#0b0f0c" stroke-width="${fs * 0.28}">${Math.round(rv.median)} dBm</text>`);
    }
  }
  for (const f of data.fixed || []) {
    if (f.floor !== floor || f.band !== band) continue;
    parts.push(`<g data-wifi="device"><circle cx="${f.x}" cy="${f.y}" r="${fs * 0.42}" fill="${colour(f.median)}" stroke="#0b0f0c" stroke-width="${fs * 0.1}"><title>${esc(f.name || "")}: ${Math.round(f.median)} dBm</title></circle></g>`);
  }
  const fo = opt.focus;
  if (fo && fo.floor === floor) {
    const fr = fo.room && rooms.find((r) => r.name === fo.room);
    if (fr) parts.push(`<polygon data-wifi="focus" points="${fr.pts.map(([x, y]) => `${x},${y}`).join(" ")}" fill="none" stroke="#f8fafc" stroke-width="${fs * 0.22}" stroke-dasharray="${fs * 0.6} ${fs * 0.35}"/>`);
    else if (Number.isFinite(fo.x) && Number.isFinite(fo.y)) parts.push(`<circle data-wifi="focus" cx="${fo.x}" cy="${fo.y}" r="${fs * 1.1}" fill="none" stroke="#f8fafc" stroke-width="${fs * 0.18}"/>`);
  }
  for (const a of aps) {
    // A rounded square with three arcs; dashed while it is only an estimate.
    const r = fs * 0.62, est = a.placed !== "you" && a.placed !== "padspan";
    parts.push(`<g data-wifi="ap-mark" data-mac="${esc(a.mac)}" transform="translate(${a.x},${a.y})">`
      + `<rect x="${-r}" y="${-r}" width="${2 * r}" height="${2 * r}" rx="${r * 0.35}" fill="#0b1220" stroke="#60a5fa" stroke-width="${fs * 0.12}"${est ? ` stroke-dasharray="${fs * 0.25} ${fs * 0.18}"` : ""}/>`
      + `<path d="M ${-r * 0.55} ${-r * 0.05} Q 0 ${-r * 0.6} ${r * 0.55} ${-r * 0.05} M ${-r * 0.32} ${r * 0.18} Q 0 ${-r * 0.15} ${r * 0.32} ${r * 0.18}" fill="none" stroke="#93c5fd" stroke-width="${fs * 0.1}" stroke-linecap="round"/>`
      + `<circle cx="0" cy="${r * 0.42}" r="${fs * 0.09}" fill="#93c5fd"/>`
      + `<text y="${r + fs * 1.0}" font-size="${fs * 0.85}" text-anchor="middle" fill="#93c5fd" style="paint-order:stroke" stroke="#0b0f0c" stroke-width="${fs * 0.22}">${esc(a.name || a.mac)}</text>`
      + `<title>${esc(a.name || a.mac)}: ${est ? "estimated from the devices that hear it best" : "placed"}</title></g>`);
  }
  return `<svg viewBox="${bb.x0} ${bb.y0} ${W} ${H}" style="width:100%;height:auto;max-height:72vh;background:#0b0f0c;border-radius:10px">${parts.join("")}</svg>`;
}

async function load(ctx) {
  const s = st(ctx);
  if (s.loading) return;
  s.loading = true;
  try {
    s.data = await ctx.actions.callWS({ type: "unifi_utopia/wifi_heatmap", ...(s.ap && s.ap !== "*" ? { ap: s.ap } : {}) });
    s.err = "";
  } catch (e) {
    s.err = String((e && e.message) || e || "No answer from UniFi Utopia.");
  } finally {
    s.ts = Date.now();
    s.loading = false;
  }
  if (ctx.state.view === "wifi") ctx.actions.renderRooms();
  again(ctx, REFRESH_MS);
}

/** The panel's poll redraws only its live views, so this one asks again by itself each minute
 *  while it is open: not on another tab, not when the panel has gone, and not under an open picker. */
function again(ctx, ms) {
  const s = st(ctx);
  clearTimeout(s.timer);
  s.timer = setTimeout(() => {
    s.timer = 0;
    if (ctx.state.view !== "wifi" || (s.root && s.root.isConnected === false)) return;  // the next visit loads afresh
    const rn = s.root && s.root.getRootNode ? s.root.getRootNode() : null;
    const a = rn && rn.activeElement;
    if (a && a.tagName === "SELECT" && s.root.contains(a)) { again(ctx, 15000); return; }
    load(ctx);
  }, ms);
  if (s.timer && s.timer.unref) s.timer.unref();   // node (the tests): never what keeps it running
}

async function loadLinks(ctx) {
  const s = st(ctx);
  try { s.links = await ctx.actions.callWS({ type: "unifi_utopia/wifi_links" }); } catch (_e) { s.links = { error: true }; }
  if (ctx.state.view === "wifi") ctx.actions.renderRooms();
}

const LEVEL = { bad: "#f87171", warn: "#fbbf24", good: "#4ade80", info: "#94a3b8" };
const FINDINGS_SHOWN = 6;

/** What UniFi Utopia found worth fixing, most urgent first; a click shows it on the plan. */
function findingsCard(ctx, D) {
  const { el } = ctx.helpers;
  const s = st(ctx);
  const F = Array.isArray(D.findings) ? D.findings : null;
  if (!F) return null;                          // an older UniFi Utopia: no findings to show
  const box = el("div", { "data-wifi": "findings", style: "border:1px solid #1f3328;border-radius:10px;padding:10px 12px;margin-bottom:12px" });
  box.appendChild(el("div", { style: "font-weight:700;font-size:13px;margin-bottom:6px" }, F.length ? `What to fix (${F.length})` : "What to fix"));
  if (!F.length) {
    box.appendChild(el("div", { style: "font-size:12px;color:#94a3b8" }, "Nothing found yet. Findings appear as your devices and phones are measured; the devices within the first hour, the phones over days."));
    return box;
  }
  const list = s.allFindings ? F : F.slice(0, FINDINGS_SHOWN);
  let said = null;                              // the same advice for the next finding too: said once
  for (const f of list) {
    const on = s.focus && s.focus.id === f.id;
    const row = el("div", { "data-wifi-finding": f.id, style: `display:flex;gap:10px;align-items:flex-start;padding:6px 6px;border-radius:8px;${f.floor ? "cursor:pointer;" : ""}${on ? "background:#13211a;" : ""}` });
    row.appendChild(el("span", { style: `flex:0 0 auto;width:9px;height:9px;border-radius:50%;margin-top:5px;background:${LEVEL[f.level] || LEVEL.info}` }));
    row.appendChild(el("div", { style: "min-width:0" }, [
      el("div", { style: "font-size:13px;font-weight:600" }, String(f.title || "")),
      el("div", { style: "font-size:12px;color:#cbd5e1;line-height:1.5" }, String(f.detail || "")),
      f.advice && f.advice !== said ? el("div", { style: "font-size:12px;color:#94a3b8;line-height:1.5" }, String(f.advice)) : null,
    ]));
    said = f.advice || null;
    if (f.floor) {
      row.addEventListener("click", () => {
        s.focus = on ? null : { id: f.id, floor: f.floor, room: f.room || null, x: f.x, y: f.y };
        if (!on) { s.floor = f.floor; if (f.band) s.band = f.band; }
        ctx.actions.renderRooms();
      });
    }
    box.appendChild(row);
  }
  if (F.length > FINDINGS_SHOWN) {
    box.appendChild(el("button", { class: "btn inline", "data-wifi": "findings-more", style: "font-size:12px;padding:3px 10px;margin-top:4px",
      onclick: () => { s.allFindings = !s.allFindings; ctx.actions.renderRooms(); } }, s.allFindings ? "Show fewer" : `Show all ${F.length}`));
  }
  if (F.some((f) => f.kind === "far_ap")) {
    box.appendChild(el("div", { style: "font-size:11px;color:#64748b;margin-top:6px" },
      "Devices differ in their transmitters and antennas, so a gap between neighbours is a strong sign, not proof."));
  }
  return box;
}

/** Open Mapping's device placement with this access point selected (its "Online" sensor on the Atlas). */
export function placeInMapping(ctx, eid) {
  ctx.state.view = "maps";
  ctx.state.mapsTab = "lights";
  ctx.state.maps = ctx.state.maps || {};
  ctx.state.maps._selLight = { eid, mapId: null };
  ctx.state.maps._focusRow = eid;
  if (ctx.actions.renderNav) ctx.actions.renderNav();
  ctx.actions.renderRooms();
}

/** Where each access point is. They are placed in Mapping like any device (UniFi Utopia adds each one to
 *  Home Assistant); until then the plan shows where the devices that hear it best suggest, dashed. */
function apCard(ctx, D) {
  const { el } = ctx.helpers;
  const s = st(ctx);
  const A = (D.aps || []).filter((a) => a && "placed" in a);
  if (!A.length) return null;
  const box = el("details", { "data-wifi": "aps", style: "margin-top:14px;border:1px solid #1f3328;border-radius:10px;padding:10px 12px" });
  if (s.apsOpen) box.open = true;
  box.addEventListener("toggle", () => { s.apsOpen = box.open; });
  box.appendChild(el("summary", { style: "cursor:pointer;font-weight:600;font-size:13px" }, "Where the access points are"));
  box.appendChild(el("div", { style: "font-size:12px;color:#94a3b8;margin:6px 0" },
    "Access points are placed in Mapping, like any device. Until one is, the plan shows it dashed, where the devices that hear it best suggest."));
  for (const a of A) {
    const how = a.placed === "padspan" ? "placed in Mapping"
      : a.placed === "you" ? "put here on this screen before"
        : a.placed === "estimated" ? "estimated" : "no placed device hears it yet";
    const row = el("div", { style: "display:flex;gap:10px;align-items:center;margin:4px 0;font-size:12px;flex-wrap:wrap" }, [
      el("span", { style: "min-width:180px;font-weight:600" }, String(a.name || a.mac)),
      el("span", { style: "color:#94a3b8" }, how),
    ]);
    if (a.entity_id) {
      row.appendChild(el("button", { class: "btn inline", style: "font-size:12px;padding:2px 8px", "data-wifi-ap-place": a.mac,
        onclick: () => placeInMapping(ctx, a.entity_id) }, a.placed === "padspan" ? "Move in Mapping" : "Place in Mapping"));
    } else if (a.placed !== "padspan") {
      row.appendChild(el("span", { style: "color:#64748b" }, "(update UniFi Utopia to place it in Mapping)"));
    }
    box.appendChild(row);
  }
  return box;
}

function chip(ctx, label, on, onClick, attrs = {}) {
  const { el } = ctx.helpers;
  return el("button", { class: "btn inline", style: `font-size:12px;padding:3px 10px;${on ? "background:#1f3d2b;border-color:#52b788;color:#d1fae5" : ""}`, onclick: onClick, ...attrs }, label);
}

function linksCard(ctx) {
  const { el } = ctx.helpers;
  const s = st(ctx);
  const box = el("details", { "data-wifi": "links", style: "margin-top:14px;border:1px solid #1f3328;border-radius:10px;padding:10px 12px" });
  box.appendChild(el("summary", { style: "cursor:pointer;font-weight:600;font-size:13px" }, "Which Wi-Fi device is which phone"));
  box.addEventListener("toggle", () => { if (box.open && !s.links) loadLinks(ctx); });
  const L = s.links;
  if (!L) return box;
  if (L.error) { box.appendChild(el("div", { style: "font-size:12px;color:#f59e0b;margin-top:6px" }, "UniFi Utopia didn't answer.")); box.open = true; return box; }
  box.open = true;
  box.appendChild(el("div", { style: "font-size:12px;color:#94a3b8;margin:6px 0" },
    "A phone is linked when its Wi-Fi name matches its name in PadSpan. Pick one here when the names differ (an iPhone called \"iPhone\" on Wi-Fi, say)."));
  const opts = [["", "Not linked"], ...(L.padspan || []).map((p) => [p.id, p.label])];
  for (const w of L.wifi || []) {
    if (!w.linked_to && !w.manual && !/phone|pixel|galaxy|ipad|watch|android/i.test(String(w.name))) continue;
    const sel = el("select", { class: "select", style: "font-size:12px" });
    for (const [v, t] of opts) {
      const o = el("option", { value: v }, t);
      if ((w.linked_to && t === w.linked_to) || (!w.linked_to && !v)) o.selected = true;
      sel.appendChild(o);
    }
    sel.addEventListener("change", async () => {
      try {
        s.links = await ctx.actions.callWS({ type: "unifi_utopia/wifi_link_set", mac: w.mac, padspan_id: sel.value || null });
        ctx.toast(sel.value ? `${w.name} is now linked.` : `${w.name} is no longer linked.`);
      } catch (e) { ctx.toast(ctx.helpers.errorText(e), true); }
      ctx.actions.renderRooms();
    });
    box.appendChild(el("div", { style: "display:flex;gap:10px;align-items:center;margin:4px 0;font-size:12px" }, [
      el("span", { style: "min-width:180px" }, `${w.name} (${w.band} GHz, ${w.signal} dBm)`), sel]));
  }
  return box;
}

export function render(ctx) {
  const { el } = ctx.helpers;
  const s = st(ctx);
  const root = el("div", { id: "wifi" });
  s.root = root;
  root.appendChild(el("div", { style: "margin-bottom:12px" }, [
    el("div", { style: "font-weight:700;font-size:16px;color:#38bdf8" }, "Wi-Fi coverage"),
    el("div", { style: "font-size:12px;color:#94a3b8;margin-top:2px;line-height:1.5" },
      "How strongly your access points hear the house, measured in everyday use: phones while they sit still for a minute, and your smart devices where PadSpan has them placed. From UniFi Utopia; it fills in over days."),
  ]));
  if (!s.data || Date.now() - s.ts > REFRESH_MS) load(ctx);
  if (!s.data) {
    root.appendChild(el("div", { style: "color:#94a3b8;padding:18px;text-align:center" }, s.err ? `UniFi Utopia didn't answer: ${s.err}` : "Loading…"));
    return root;
  }
  const D = s.data;
  const fc = findingsCard(ctx, D);
  if (fc) root.appendChild(fc);
  // 2.4 and 5 GHz always have their button, measured or not yet (a 6 GHz one when there are readings).
  const bands = [...new Set(["2.4", "5", ...(D.bands || [])])].sort((a, b) => Number(a) - Number(b));
  if (!s.band || !bands.includes(s.band)) s.band = (D.bands || []).includes("5") ? "5" : ((D.bands || [])[0] || "5");
  const inBand = (x) => x.band === s.band;
  const floorsWithData = new Set([...(D.cells || []), ...(D.rooms || []), ...(D.fixed || [])].filter(inBand).map((c) => c.floor));
  const floors = ((ctx.state.model && ctx.state.model.floors) || []).map((f) => ({ id: f.id || f.floor_id, name: f.name || f.id }))
    .filter((f) => f.id && (floorsWithData.has(f.id) || floorRooms(ctx.state.model, f.id).length));
  if (!s.floor || !floors.some((f) => f.id === s.floor)) s.floor = (floors.find((f) => floorsWithData.has(f.id)) || floors[0] || {}).id || null;

  const bar = el("div", { style: "display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-bottom:8px" });
  for (const f of floors) bar.appendChild(chip(ctx, f.name, f.id === s.floor, () => { s.floor = f.id; ctx.actions.renderRooms(); }, { "data-wifi-floor": f.id }));
  bar.appendChild(el("span", { style: "width:12px" }));
  for (const b of bands) bar.appendChild(chip(ctx, `${b} GHz`, b === s.band, () => { s.band = b; ctx.actions.renderRooms(); }, { "data-wifi-band": b }));
  if ((D.aps || []).length > 1) {
    const sel = el("select", { class: "select", style: "width:auto;font-size:12px;padding:3px 8px;margin-left:8px", "data-wifi": "ap" });
    for (const [v, t] of [["*", "All access points"], ...D.aps.map((a) => [a.mac, a.name])]) {
      const o = el("option", { value: v }, t);
      if (v === s.ap) o.selected = true;
      sel.appendChild(o);
    }
    sel.addEventListener("change", () => { s.ap = sel.value; s.ts = 0; load(ctx); });
    bar.appendChild(sel);
  }
  root.appendChild(bar);

  const admin = !!(ctx.hass && ctx.hass.user && ctx.hass.user.is_admin);
  const svg = s.floor ? floorSVG(ctx, D, s.floor, s.band, { focus: s.focus }) : "";
  const pics = el("div", { "data-wifi": "map" });
  if (svg) pics.innerHTML = svg;
  else pics.appendChild(el("div", { style: "color:#94a3b8;padding:18px" }, "This floor has no rooms drawn in PadSpan yet."));
  root.appendChild(pics);

  const legend = el("div", { style: "display:flex;align-items:center;gap:8px;margin-top:8px;font-size:11px;color:#94a3b8" }, [
    el("span", {}, `${WORST} dBm, very weak`),
    el("div", { style: `flex:1;max-width:320px;height:10px;border-radius:5px;background:${RM.heatRampCSS(12)}` }),
    el("span", {}, `${BEST} dBm, excellent`),
  ]);
  root.appendChild(legend);

  const cellsHere = (D.cells || []).filter((c) => c.floor === s.floor && c.band === s.band);
  const fixedHere = (D.fixed || []).filter((f) => f.floor === s.floor && f.band === s.band);
  const minutes = cellsHere.reduce((a, c) => a + (c.n || 0), 0);
  root.appendChild(el("div", { "data-wifi": "counts", style: "font-size:12px;color:#94a3b8;margin-top:8px;line-height:1.6" },
    `This floor, ${s.band} GHz: ${minutes} minute${minutes === 1 ? "" : "s"} of still-phone readings in ${cellsHere.length} spot${cellsHere.length === 1 ? "" : "s"}, ` +
    `and ${fixedHere.length} placed smart device${fixedHere.length === 1 ? "" : "s"}. ` +
    (s.band === "2.4" ? "Most smart devices use 2.4 GHz; most phones use 5 GHz, so each band is its own map." : "Phones mostly use 5 GHz; smart devices show on the 2.4 GHz map.") +
    (fixedHere.length ? " Each dot is a placed device, coloured by how strongly its own access point hears it: a red dot beside green ones is a device holding on to a far access point. Pick one access point above to see its reach alone." : "")));

  const roomRows = (D.rooms || []).filter((r) => r.floor === s.floor && r.band === s.band).sort((a, b) => a.median - b.median);
  if (roomRows.length) {
    const tbl = el("div", { "data-wifi": "rooms", style: "margin-top:10px;display:grid;grid-template-columns:auto auto auto;gap:4px 16px;font-size:12px;max-width:520px" });
    for (const r of roomRows) {
      tbl.appendChild(el("span", {}, r.room));
      tbl.appendChild(el("span", { style: `color:${colour(r.median)};font-weight:700` }, `${Math.round(r.median)} dBm, ${words(r.median)}`));
      tbl.appendChild(el("span", { style: "color:#64748b" }, `${r.n} min`));
    }
    root.appendChild(tbl);
  }
  if (admin) {
    const ac = apCard(ctx, D);
    if (ac) root.appendChild(ac);
  }
  if (D.status && admin) root.appendChild(linksCard(ctx));
  return root;
}
