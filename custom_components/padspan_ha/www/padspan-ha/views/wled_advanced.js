// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
// See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
/**
 * The Atlas WLED card's Advanced tab (Garry, 2026-09-23): "absolute best in
 * class gui for working on wled configuration ... every facet of WLED
 * operation and setup, as complete as the webpage, but more intuitive".
 *
 * Research behind every choice: docs/research/wled-advanced-tab-2026-09-23.md
 * (four agents over the tools people use — WLED's own UI, WLED+, LedFx,
 * xLights, uber-wled, HyperHDR — and the firmware source at 0.14/0.15/16).
 * What no tool does and this does: overlap/gap checks on the layout, "not
 * saved for the next boot" warnings with a one-tap fix, identify-on-the-
 * hardware, and all of it over HTTPS and away from home, through PadSpan's
 * backend (ws_wled.py) — the browser never talks to the device.
 *
 * Loaded on demand by openControlCard (lights_map.js). Pure rules live in
 * wled_model.js, unit tested; this file is the UI.
 */

const _q = new URL(import.meta.url).search;
const M = await import(`./wled_model.js${_q}`);

// ── Style (inline: the card lives on document.body, outside every shadow root)
const C = {
  text: "#e2e8f0", dim: "#94a3b8", faint: "#64748b", green: "#52b788", mint: "#8ee5b4",
  amber: "#fbbf24", red: "#f87171", purple: "#c084fc", line: "rgba(120,190,155,.22)",
  panel: "rgba(255,255,255,.035)",
};
const S = {
  lbl: `font-size:11px;color:${C.dim};text-transform:uppercase;letter-spacing:.06em;margin-bottom:4px`,
  btn: `background:rgba(255,255,255,.05);border:1px solid ${C.line};border-radius:8px;color:${C.text};`
    + "font-size:12px;cursor:pointer;padding:5px 10px;white-space:nowrap",
  btnOn: `background:rgba(192,132,252,.16);border:1px solid ${C.purple};border-radius:8px;color:${C.purple};`
    + "font-size:12px;cursor:pointer;padding:5px 10px;font-weight:700;white-space:nowrap",
  btnPrimary: "background:linear-gradient(135deg,#166534,#22c55e);border:1px solid rgba(255,255,255,.2);border-radius:8px;"
    + "color:#fff;font-size:12px;cursor:pointer;padding:6px 12px;font-weight:700;white-space:nowrap",
  input: `background:rgba(15,26,18,.9);color:${C.mint};border:1px solid ${C.line};border-radius:6px;padding:4px 6px;font-size:12px`,
  card: `background:${C.panel};border:1px solid ${C.line};border-radius:10px;padding:10px;margin-bottom:10px`,
  chip: (col) => `display:inline-block;font-size:10px;padding:1px 7px;border-radius:999px;border:1px solid ${col};color:${col};margin-left:6px`,
};

function h(tag, attrs = {}, children = []) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (k === "style") n.setAttribute("style", v);
    else if (k.startsWith("on") && typeof v === "function") n.addEventListener(k.slice(2), v);
    else if (v !== undefined && v !== null && v !== false) n.setAttribute(k, v === true ? "" : String(v));
  }
  for (const c of Array.isArray(children) ? children : [children]) {
    if (c === null || c === undefined || c === false) continue;
    n.appendChild(typeof c === "string" || typeof c === "number" ? document.createTextNode(String(c)) : c);
  }
  return n;
}
const slider = (value, max, onChange, min = 0) => {
  const r = document.createElement("input");
  r.type = "range"; r.min = String(min); r.max = String(max); r.value = String(value ?? 0);
  r.style.cssText = `width:100%;accent-color:${C.purple};cursor:pointer`;
  r.addEventListener("change", () => onChange(parseInt(r.value, 10)));
  return r;
};
const numberBox = (value, onChange, { min = 0, max = 65535, width = 64 } = {}) => {
  const i = document.createElement("input");
  i.type = "number"; i.min = String(min); i.max = String(max); i.value = String(value ?? 0);
  i.style.cssText = S.input + `;width:${width}px`;
  i.addEventListener("change", () => onChange(Math.max(min, Math.min(max, parseInt(i.value, 10) || 0))));
  return i;
};
const check = (label, value, onChange, title) => {
  const c = document.createElement("input");
  c.type = "checkbox"; c.checked = !!value;
  c.addEventListener("change", () => onChange(c.checked));
  return h("label", { style: `display:inline-flex;align-items:center;gap:5px;font-size:12px;color:${C.text};margin-right:12px;cursor:pointer`, title },
    [c, label]);
};

// ── Mount ────────────────────────────────────────────────────────────────────

/**
 * mountWledAdvanced(pane, { hass, eid, api })
 * api.wled = { isAdmin, tier } from the host (controlApiFor in lights_map.js).
 */
export async function mountWledAdvanced(pane, { hass, eid, api }) {
  const isAdmin = !!(api && api.wled && api.wled.isAdmin);
  const toast = (api && api.toast) || (() => {});
  const call = (type, data) => hass.callWS({ type, entity_id: eid, ...data });
  const get = (path) => call("padspan_ha/wled_get", { path }).then(r => r.data);
  const post = (body) => call("padspan_ha/wled_state", { body }).then(r => r.data);

  const ctx = { hass, eid, isAdmin, toast, get, post, call, info: null, state: null, effects: [], pals: [],
    presets: null, cfg: null, tab: "layout", selSeg: null, openSeg: null, identifying: false };

  pane.innerHTML = "";
  const head = h("div", { style: "display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:10px" });
  const tabs = h("div", { style: "display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px" });
  const body = h("div");
  const status = h("div", { style: `font-size:12px;color:${C.dim};padding:14px 0` }, "Reading the device…");
  pane.appendChild(head); pane.appendChild(tabs); pane.appendChild(body); body.appendChild(status);

  try {
    const [si, eff, fxd, pal] = await Promise.all([get("json/si"), get("json/eff"), get("json/fxdata"), get("json/pal")]);
    ctx.info = si.info || {}; ctx.state = si.state || {};
    ctx.effects = M.effectCatalog(eff, fxd);
    ctx.pals = Array.isArray(pal) ? pal : [];
  } catch (e) {
    status.textContent = "Couldn't read the device: " + ((e && (e.message || e.code)) || e);
    status.style.color = C.red;
    return;
  }

  const TABS = [["layout", "Layout"], ["effect", "Effect"], ["info", "Info"]];
  const paintHead = () => {
    head.innerHTML = "";
    const info = ctx.info;
    head.appendChild(h("span", { style: "font-weight:700;font-size:14px" }, info.name || "WLED"));
    head.appendChild(h("span", { style: S.chip(C.mint) }, `v${info.ver || "?"}`));
    const fork = M.forkOf(info);
    if (fork) head.appendChild(h("span", { style: S.chip(C.amber), title: "Not a stock WLED build — PadSpan never offers firmware updates" }, fork));
    head.appendChild(h("span", { style: `font-size:11px;color:${C.faint};margin-left:auto` },
      `${(info.leds && info.leds.count) || 0} LEDs · ${(ctx.state.seg || []).filter(s => M.segLen(s) > 0).length} segments`));
    const err = M.describeError(ctx.state.error);
    if (err) head.appendChild(h("div", { style: `flex-basis:100%;font-size:12px;color:${C.amber}` }, "⚠ " + err));
  };
  const paintTabs = () => {
    tabs.innerHTML = "";
    for (const [id, label] of TABS) {
      tabs.appendChild(h("button", { style: ctx.tab === id ? S.btnOn : S.btn, onclick: () => { ctx.tab = id; paintTabs(); paint(); } }, label));
    }
  };
  const paint = () => {
    paintHead();
    body.innerHTML = "";
    if (ctx.tab === "layout") body.appendChild(layoutView(ctx, refresh));
    else if (ctx.tab === "effect") body.appendChild(effectView(ctx, refresh));
    else body.appendChild(infoView(ctx));
  };
  // Every write answers with the new state (ws_wled adds v:true); re-read
  // info too when the LED count or segment limits could have moved.
  const refresh = async (newState) => {
    if (newState && typeof newState === "object" && Array.isArray(newState.seg)) ctx.state = newState;
    else {
      try { const si = await get("json/si"); ctx.info = si.info || ctx.info; ctx.state = si.state || ctx.state; }
      catch (e) { toast("Couldn't re-read the device", true); }
    }
    paint();
  };
  ctx.write = async (body, what) => {
    try { await refresh(await post(body)); return true; }
    catch (e) { toast(`Couldn't ${what || "apply that"}: ${(e && (e.message || e.code)) || e}`, true); return false; }
  };
  // Local view changes (selection, filters) repaint in place.
  body.addEventListener("repaint", () => paint());
  paintTabs();
  paint();
}

// ── Layout: segments on the strip ────────────────────────────────────────────

function layoutView(ctx, refresh) {
  const info = ctx.info, st = ctx.state;
  const count = (info.leds && info.leds.count) || 0;
  const matrix = info.leds && info.leds.matrix;
  const segs = (st.seg || []).filter(s => M.segLen(s) > 0);
  const root = h("div");
  if (ctx.selSeg === null || !segs.some(s => s.id === ctx.selSeg)) ctx.selSeg = (segs.find(s => s.sel) || segs[0] || {}).id ?? null;

  // Warnings — what no other WLED tool checks (WLED closed overlap checks as not planned).
  const warns = M.layoutWarnings(st.seg || [], count, info.leds && info.leds.maxseg);
  if (warns.length) {
    root.appendChild(h("div", { style: S.card + `;border-color:rgba(251,191,36,.45)` },
      warns.map(w => h("div", { style: `font-size:12px;color:${C.amber};margin:2px 0` }, "⚠ " + w.text))));
  }

  // Strip (1D) or grid (2D).
  root.appendChild(matrix ? matrixView(ctx, segs, matrix) : stripView(ctx, segs, count));

  // Boot preset: is this layout what the device comes back with after a reboot?
  root.appendChild(bootPresetBar(ctx, segs));

  // Actions
  const sel = segs.find(s => s.id === ctx.selSeg);
  const actions = h("div", { style: "display:flex;gap:6px;flex-wrap:wrap;margin:8px 0 12px" });
  actions.appendChild(h("button", { style: S.btn, title: "Fills the first uncovered stretch, or splits the longest segment", onclick: () => {
    const r = M.smartAddRange(st.seg || [], count);
    if (!r) return;
    const id = M.nextSegId(st.seg || []);
    const seg = [];
    if (r.split) { const s = segs.find(x => x.id === r.split.id); seg.push(M.segBoundsWrite(s, s.start, r.split.stop)); }
    seg.push({ id, start: r.start, stop: r.stop, n: `Segment ${id}` });
    ctx.selSeg = id;
    ctx.write({ seg }, "add a segment");
  } }, "+ Add segment"));
  if (sel) {
    actions.appendChild(h("button", { style: S.btn, onclick: () => {
      if (M.segLen(sel) < 2) return;
      const mid = sel.start + Math.floor(M.segLen(sel) / 2);
      const id = M.nextSegId(st.seg || []);
      ctx.write({ seg: [M.segBoundsWrite(sel, sel.start, mid), { id, start: mid, stop: sel.stop, n: `${sel.n || "Segment " + sel.id} (2)` }] }, "split the segment");
    } }, "Split in half"));
    actions.appendChild(h("button", { style: S.btn, title: "Lights this segment white on the real strip for 10 seconds, then puts everything back",
      onclick: () => identify(ctx, sel) }, ctx.identifying ? "Identifying…" : "💡 Identify"));
    if (segs.length > 1) actions.appendChild(h("button", { style: S.btn + `;color:${C.red}`, onclick: () => {
      if (!confirm(`Delete ${sel.n || "segment " + sel.id}? (LEDs ${sel.start}–${sel.stop - 1})`)) return;
      ctx.selSeg = null;
      ctx.write({ seg: [{ id: sel.id, stop: 0 }] }, "delete the segment");
    } }, "Delete"));
  }
  if (M.has(info, "resetSegs")) actions.appendChild(h("button", { style: S.btn + ";margin-left:auto",
    title: "WLED's automatic layout: one segment per LED output",
    onclick: () => { if (confirm("Replace every segment with WLED's automatic layout?")) ctx.write({ rSeg: true }, "reset the segments"); } }, "Automatic layout"));
  root.appendChild(actions);

  // Segment list + inspector
  for (const s of segs) root.appendChild(segmentRow(ctx, s, s.id === ctx.openSeg));
  return root;
}

function segColor(s) { return M.colToHex((s.col && s.col[0]) || [128, 128, 128]); }

function stripView(ctx, segs, count) {
  const wrap = h("div", { style: S.card });
  wrap.appendChild(h("div", { style: S.lbl }, `Strip — ${count} LEDs · drag a segment's ends to move them`));
  const bar = h("div", { style: `position:relative;height:46px;border-radius:8px;overflow:hidden;touch-action:none;`
    + `background:repeating-linear-gradient(45deg,rgba(255,255,255,.03) 0 6px,rgba(255,255,255,.07) 6px 12px);border:1px solid ${C.line}` });
  const pct = (i) => `${(100 * i / Math.max(1, count)).toFixed(3)}%`;
  // Stack overlapping segments in lanes so both stay visible.
  const lanes = [];
  const laneOf = new Map();
  for (const s of [...segs].sort((a, b) => a.start - b.start)) {
    let l = lanes.findIndex(end => end <= s.start);
    if (l < 0) { l = lanes.length; lanes.push(0); }
    lanes[l] = s.stop; laneOf.set(s.id, l);
  }
  const laneH = 46 / Math.max(1, lanes.length);
  for (const s of segs) {
    const selected = s.id === ctx.selSeg;
    const col = segColor(s);
    const block = h("div", { style: `position:absolute;left:${pct(s.start)};width:${pct(M.segLen(s))};`
      + `top:${laneOf.get(s.id) * laneH}px;height:${laneH}px;background:${col}${s.on === false ? "33" : "aa"};`
      + `border:2px solid ${selected ? "#fff" : "rgba(0,0,0,.35)"};box-sizing:border-box;cursor:pointer;`
      + "display:flex;align-items:center;justify-content:center;font-size:10px;color:#fff;text-shadow:0 1px 2px #000;overflow:hidden",
      title: `${s.n || "Segment " + s.id} · ${M.segRangeLabel(s)}`,
      onclick: () => { ctx.selSeg = s.id; ctx.openSeg = s.id; wrap.dispatchEvent(new CustomEvent("repaint", { bubbles: true })); } },
      s.n || String(s.id));
    for (const edge of ["start", "stop"]) {
      const handle = h("div", { style: `position:absolute;${edge === "start" ? "left" : "right"}:-2px;top:0;bottom:0;width:10px;`
        + `cursor:ew-resize;background:${selected ? "rgba(255,255,255,.55)" : "rgba(255,255,255,.18)"}` });
      handle.addEventListener("pointerdown", (ev) => dragEdge(ev, ctx, s, edge, bar, block, count, pct));
      block.appendChild(handle);
    }
    bar.appendChild(block);
  }
  wrap.appendChild(bar);
  wrap.appendChild(h("div", { style: `display:flex;justify-content:space-between;font-size:10px;color:${C.faint};margin-top:3px` },
    [h("span", {}, "0"), h("span", {}, String(Math.max(0, count - 1)))]));
  return wrap;
}

function dragEdge(ev, ctx, s, edge, bar, block, count, pct) {
  ev.preventDefault(); ev.stopPropagation();
  const rect = bar.getBoundingClientRect();
  let start = s.start, stop = s.stop;
  const tip = h("div", { style: "position:absolute;top:-22px;font-size:11px;background:#000;color:#fff;padding:1px 5px;border-radius:4px;pointer-events:none" });
  block.appendChild(tip);
  const move = (e) => {
    const led = Math.round(((e.clientX - rect.left) / Math.max(1, rect.width)) * count);
    if (edge === "start") start = Math.max(0, Math.min(stop - 1, led));
    else stop = Math.min(count, Math.max(start + 1, led));
    block.style.left = pct(start); block.style.width = pct(stop - start);
    tip.textContent = `${start}–${stop - 1} (${stop - start})`;
  };
  const up = () => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
    tip.remove();
    if (start !== s.start || stop !== s.stop) ctx.write({ seg: [M.segBoundsWrite(s, start, stop)] }, "move the segment");
  };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up);
}

function matrixView(ctx, segs, matrix) {
  const wrap = h("div", { style: S.card });
  const w = Number(matrix.w) || 1, hgt = Number(matrix.h) || 1;
  wrap.appendChild(h("div", { style: S.lbl }, `Matrix — ${w} × ${hgt} · set each segment's X/Y below`));
  const grid = h("div", { style: `position:relative;width:100%;aspect-ratio:${w}/${hgt};max-height:260px;border:1px solid ${C.line};`
    + "border-radius:8px;overflow:hidden;background:repeating-linear-gradient(45deg,rgba(255,255,255,.03) 0 6px,rgba(255,255,255,.07) 6px 12px)" });
  for (const s of segs) {
    const x0 = s.start, x1 = s.stop, y0 = s.startY || 0, y1 = s.stopY || 1;
    grid.appendChild(h("div", { style: `position:absolute;left:${100 * x0 / w}%;width:${100 * (x1 - x0) / w}%;`
      + `top:${100 * y0 / hgt}%;height:${100 * (y1 - y0) / hgt}%;background:${segColor(s)}88;box-sizing:border-box;`
      + `border:2px solid ${s.id === ctx.selSeg ? "#fff" : "rgba(0,0,0,.35)"};font-size:10px;color:#fff;cursor:pointer;`
      + "display:flex;align-items:center;justify-content:center;text-shadow:0 1px 2px #000",
      onclick: () => { ctx.selSeg = s.id; ctx.openSeg = s.id; wrap.dispatchEvent(new CustomEvent("repaint", { bubbles: true })); } }, s.n || String(s.id)));
  }
  wrap.appendChild(grid);
  return wrap;
}

function bootPresetBar(ctx, segs) {
  const bar = h("div", { style: "font-size:12px;margin:0 0 4px" });
  const bootId = ctx.info.leds && ctx.info.leds.bootps;
  const run = async () => {
    try {
      if (!ctx.presets) ctx.presets = await ctx.get("presets.json");
      const id = bootId || Number((await ctx.get("json/cfg")).def?.ps) || 0;
      const differs = id ? M.layoutDiffersFromPreset(segs, ctx.presets[String(id)]) : true;
      bar.innerHTML = "";
      if (!differs) { bar.appendChild(h("span", { style: `color:${C.green}` }, `✓ This layout is saved — it's what the device starts with (preset ${id}).`)); return; }
      bar.appendChild(h("span", { style: `color:${C.amber}` }, id
        ? `⚠ Not saved for the next boot — after a restart the device goes back to preset ${id}'s layout. `
        : "⚠ No boot preset — after a restart the device may come back with a different layout. "));
      if (ctx.isAdmin) {
        const free = id || firstFreePreset(ctx.presets);
        bar.appendChild(h("button", { style: S.btnPrimary + ";margin-left:6px", onclick: async () => {
          const name = (ctx.presets[String(free)] && ctx.presets[String(free)].n) || "Layout";
          if (!confirm(`Save the current layout, colours and effects as preset ${free} ("${name}") and make it the boot preset?`)) return;
          const body = { psave: free, n: name, ib: true, sb: true };
          if (M.has(ctx.info, "bootPreset")) body.bootps = free;
          if (await ctx.write(body, "save the boot preset")) { ctx.presets = null; ctx.toast(`Saved as preset ${free}`); }
        } }, "Save as boot preset"));
      }
    } catch (e) {
      bar.textContent = "";
    }
  };
  run();
  return bar;
}

function firstFreePreset(presets) {
  for (let i = 1; i <= 250; i++) if (!presets || !presets[String(i)]) return i;
  return 250;
}

// LedFx's pattern: the chosen segment lights up on the real hardware so you
// can find it; everything goes back the way it was after 10 seconds.
async function identify(ctx, seg) {
  if (ctx.identifying) return;
  ctx.identifying = true;
  const saved = JSON.parse(JSON.stringify(ctx.state));
  const segs = (saved.seg || []).map(s => s.id === seg.id
    ? { id: s.id, on: true, bri: 255, frz: false, fx: 0, col: [[255, 255, 255], [0, 0, 0], [0, 0, 0]] }
    : { id: s.id, on: false });
  try {
    await ctx.post({ on: true, bri: Math.max(96, saved.bri || 0), tt: 0, seg: segs });
    ctx.toast(`Lit ${seg.n || "segment " + seg.id} (LEDs ${seg.start}–${seg.stop - 1}) for 10 s`);
    await new Promise(r => setTimeout(r, 10000));
  } finally {
    const restore = { on: saved.on, bri: saved.bri, tt: 0, seg: (saved.seg || []).map(s => {
      const r = { ...s }; delete r.len; delete r.lc; return r;
    }) };
    ctx.identifying = false;
    await ctx.write(restore, "put the lights back");
  }
}

function segmentRow(ctx, s, open) {
  const info = ctx.info;
  const is2D = !!(info.leds && info.leds.matrix);
  const set = (patch, what) => ctx.write({ seg: [{ id: s.id, ...patch }] }, what);
  const row = h("div", { style: S.card + (open ? `;border-color:${C.purple}` : "") });
  const swatch = document.createElement("input");
  swatch.type = "color"; swatch.value = segColor(s);
  swatch.style.cssText = "width:30px;height:24px;border:none;background:none;cursor:pointer;padding:0";
  swatch.addEventListener("change", () => set({ col: [M.hexToCol(swatch.value)] }, "set the colour"));
  const name = document.createElement("input");
  name.value = s.n || ""; name.placeholder = `Segment ${s.id}`;
  name.style.cssText = S.input + ";flex:1;min-width:90px";
  name.addEventListener("change", () => set({ n: name.value }, "rename the segment"));
  const onBtn = h("button", { style: s.on === false ? S.btn : S.btnOn, onclick: () => set({ on: s.on === false }, "switch the segment") },
    s.on === false ? "Off" : "On");
  const effName = (ctx.effects.find(e => e.id === s.fx) || {}).name || `#${s.fx}`;
  row.appendChild(h("div", { style: "display:flex;align-items:center;gap:8px;flex-wrap:wrap" }, [
    swatch, name,
    h("span", { style: `font-size:11px;color:${C.dim}` }, is2D ? `X ${s.start}–${s.stop - 1}, Y ${s.startY || 0}–${(s.stopY || 1) - 1}` : M.segRangeLabel(s)),
    h("span", { style: `font-size:11px;color:${C.faint}` }, effName),
    onBtn,
    h("button", { style: S.btn, onclick: () => { ctx.selSeg = s.id; ctx.openSeg = open ? null : s.id; row.dispatchEvent(new CustomEvent("repaint", { bubbles: true })); } }, open ? "▲" : "▼"),
  ]));
  if (!open) return row;

  const grid = h("div", { style: "display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px;margin-top:10px" });
  const field = (label, node, title) => h("div", { title }, [h("div", { style: S.lbl }, label), node]);
  // Inclusive first/last LED — WLED's exclusive stop reads as a bug to people.
  grid.appendChild(field(is2D ? "First column" : "First LED", numberBox(s.start, v => ctx.write({ seg: [M.segBoundsWrite(s, v, s.stop)] }, "move the segment"))));
  grid.appendChild(field(is2D ? "Last column" : "Last LED", numberBox(s.stop - 1, v => ctx.write({ seg: [M.segBoundsWrite(s, s.start, v + 1)] }, "move the segment"))));
  if (is2D) {
    grid.appendChild(field("First row", numberBox(s.startY || 0, v => set({ startY: v, n: s.n }, "move the segment"))));
    grid.appendChild(field("Last row", numberBox((s.stopY || 1) - 1, v => set({ stopY: v + 1, n: s.n }, "move the segment"))));
  }
  grid.appendChild(field("Opacity", slider(s.bri ?? 255, 255, v => set({ bri: v }, "set the opacity"))));
  grid.appendChild(field("Grouping", numberBox(s.grp || 1, v => set({ grp: v }, "set grouping"), { min: 1, max: 255 }), "Light N LEDs as one"));
  grid.appendChild(field("Spacing", numberBox(s.spc || 0, v => set({ spc: v }, "set spacing"), { max: 255 }), "Leave N LEDs dark between groups"));
  grid.appendChild(field("Offset", numberBox(s.of || 0, v => set({ of: v }, "set the offset"), { min: -65535 }), "Shift the effect along the segment"));
  if (typeof s.cct === "number" && (s.lc === undefined || (s.lc & 4))) {
    grid.appendChild(field("White temperature", slider(s.cct, 255, v => set({ cct: v }, "set white temperature"))));
  }
  row.appendChild(grid);

  const opts = h("div", { style: "margin-top:10px;display:flex;flex-wrap:wrap;gap:4px" });
  opts.appendChild(check("Reverse", s.rev, v => set({ rev: v }, "reverse"), "Run the effect the other way"));
  opts.appendChild(check("Mirror", s.mi, v => set({ mi: v }, "mirror"), "Mirror the effect around the middle"));
  opts.appendChild(check("Freeze", s.frz, v => set({ frz: v }, "freeze"), "Hold the current frame"));
  if (is2D) {
    opts.appendChild(check("Reverse Y", s.rY, v => set({ rY: v }, "reverse Y")));
    opts.appendChild(check("Mirror Y", s.mY, v => set({ mY: v }, "mirror Y")));
    opts.appendChild(check("Transpose", s.tp, v => set({ tp: v }, "transpose"), "Swap X and Y"));
  }
  row.appendChild(opts);

  const more = h("div", { style: "display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px;margin-top:10px" });
  const select = (options, value, onChange) => {
    const sel = document.createElement("select");
    sel.style.cssText = S.input + ";width:100%";
    for (const [v, label] of options) {
      const o = document.createElement("option"); o.value = String(v); o.textContent = label;
      if (Number(v) === Number(value)) o.selected = true;
      sel.appendChild(o);
    }
    sel.addEventListener("change", () => onChange(parseInt(sel.value, 10)));
    return sel;
  };
  more.appendChild(field("Sound simulation", select([[0, "Off"], [1, "Weird 1"], [2, "Weird 2"], [3, "Weird 3"]], s.si || 0,
    v => set({ si: v }, "set sound simulation")), "Fake audio for audio-reactive effects when there's no microphone"));
  if (is2D) {
    const m12 = [[0, "Pixels"], [1, "Bar"], [2, "Arc"], [3, "Corner"]];
    if (M.has(info, "pinwheel")) m12.push([4, "Pinwheel"]);
    more.appendChild(field("1D effect on 2D", select(m12, s.m12 || 0, v => set({ m12: v }, "set 1D-to-2D"))));
  }
  if (M.has(info, "segBlend")) {
    const modes = ["Top", "Bottom", "Add", "Subtract", "Difference", "Average", "Multiply", "Divide", "Lighten", "Darken",
      "Screen", "Overlay", "Hard light", "Soft light", "Dodge", "Burn", "Stencil"].map((n, i) => [i, n]);
    more.appendChild(field("Blend with segments below", select(modes, s.bm || 0, v => set({ bm: v }, "set the blend"))));
  }
  row.appendChild(more);

  // The three colour slots, named by the running effect (fxdata).
  const meta = (ctx.effects.find(e => e.id === s.fx) || {}).meta;
  const slots = (meta && meta.colors.length ? meta.colors : [{ slot: 0, label: "Fx" }, { slot: 1, label: "Bg" }, { slot: 2, label: "Cs" }]);
  const cols = h("div", { style: "display:flex;gap:10px;margin-top:10px;align-items:center" }, [h("span", { style: S.lbl + ";margin:0" }, "Colours")]);
  for (const c of slots) {
    const inp = document.createElement("input");
    inp.type = "color"; inp.value = M.colToHex((s.col || [])[c.slot] || [0, 0, 0]);
    inp.style.cssText = "width:34px;height:26px;border:none;background:none;cursor:pointer";
    inp.addEventListener("change", () => {
      const col = [...(s.col || [[0, 0, 0], [0, 0, 0], [0, 0, 0]])].map(x => Array.isArray(x) ? x : [0, 0, 0]);
      col[c.slot] = M.hexToCol(inp.value, Array.isArray(col[c.slot]) && col[c.slot].length > 3 ? col[c.slot][3] : undefined);
      set({ col }, "set the colour");
    });
    cols.appendChild(h("label", { style: `display:inline-flex;align-items:center;gap:4px;font-size:11px;color:${C.dim}` }, [inp, c.label]));
  }
  row.appendChild(cols);
  return row;
}

// ── Effect: the catalogue and its controls, from WLED's own metadata ─────────

function effectView(ctx) {
  const st = ctx.state;
  const segs = (st.seg || []).filter(s => M.segLen(s) > 0);
  const root = h("div");
  if (ctx.effectTargets === undefined) ctx.effectTargets = new Set([ctx.selSeg ?? (segs[0] || {}).id].filter(v => v !== undefined && v !== null));
  const targets = segs.filter(s => ctx.effectTargets.has(s.id));
  const first = targets[0] || segs[0];

  const chips = h("div", { style: "display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px;align-items:center" },
    [h("span", { style: S.lbl + ";margin:0 6px 0 0" }, "Apply to")]);
  for (const s of segs) {
    chips.appendChild(h("button", { style: ctx.effectTargets.has(s.id) ? S.btnOn : S.btn, onclick: () => {
      if (ctx.effectTargets.has(s.id)) ctx.effectTargets.delete(s.id); else ctx.effectTargets.add(s.id);
      chips.dispatchEvent(new CustomEvent("repaint", { bubbles: true }));
    } }, s.n || `Segment ${s.id}`));
  }
  chips.appendChild(h("button", { style: S.btn, onclick: () => { segs.forEach(s => ctx.effectTargets.add(s.id)); chips.dispatchEvent(new CustomEvent("repaint", { bubbles: true })); } }, "All"));
  root.appendChild(chips);
  const toTargets = (patch, what) => ctx.write({ seg: targets.map(s => ({ id: s.id, ...patch })) }, what);

  // Parameters of the running effect on the first target.
  if (first) {
    const cur = ctx.effects.find(e => e.id === first.fx);
    const meta = cur ? cur.meta : M.parseFxData(undefined, first.fx);
    const card = h("div", { style: S.card });
    card.appendChild(h("div", { style: "font-weight:700;font-size:13px;margin-bottom:8px" }, cur ? cur.name : `Effect ${first.fx}`));
    const grid = h("div", { style: "display:grid;grid-template-columns:repeat(auto-fill,minmax(170px,1fr));gap:10px" });
    for (const sl of meta.sliders) {
      grid.appendChild(h("div", {}, [h("div", { style: S.lbl }, sl.label), slider(first[sl.key] ?? 128, sl.max, v => toTargets({ [sl.key]: v }, "set " + sl.label))]));
    }
    if (meta.palette) {
      const sel = document.createElement("select");
      sel.style.cssText = S.input + ";width:100%";
      ctx.pals.forEach((n, i) => { const o = document.createElement("option"); o.value = String(i); o.textContent = n; if (i === first.pal) o.selected = true; sel.appendChild(o); });
      sel.addEventListener("change", () => toTargets({ pal: parseInt(sel.value, 10) }, "set the palette"));
      grid.appendChild(h("div", {}, [h("div", { style: S.lbl }, meta.paletteLabel || "Palette"), sel]));
    }
    card.appendChild(grid);
    if (meta.toggles.length) {
      card.appendChild(h("div", { style: "margin-top:8px" }, meta.toggles.map(t => check(t.label, first[t.key], v => toTargets({ [t.key]: v }, "set " + t.label)))));
    }
    card.appendChild(h("button", { style: S.btn + ";margin-top:8px", title: "The effect's own default speed, intensity, palette and options",
      onclick: () => toTargets({ fx: first.fx, fxdef: true }, "reset the effect") }, "Effect defaults"));
    root.appendChild(card);
  }

  // Catalogue with search and filters.
  const filters = [["all", "All"], ["d1", "1D"], ["d2", "2D"], ["audio", "Audio"], ["pal", "Uses palette"]];
  if (!ctx.effFilter) ctx.effFilter = "all";
  const search = document.createElement("input");
  search.placeholder = `Search ${ctx.effects.length} effects`;
  search.value = ctx.effSearch || "";
  search.style.cssText = S.input + ";flex:1;min-width:140px";
  const list = h("div", { style: "display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:6px;max-height:320px;overflow:auto;margin-top:8px" });
  const is2D = !!(ctx.info.leds && ctx.info.leds.matrix);
  const paintList = () => {
    list.innerHTML = "";
    const q = (ctx.effSearch || "").toLowerCase();
    for (const e of ctx.effects) {
      const f = e.meta.flags;
      if (q && !e.name.toLowerCase().includes(q)) continue;
      if (ctx.effFilter === "d1" && f.d2) continue;
      if (ctx.effFilter === "d2" && !f.d2) continue;
      if (ctx.effFilter === "audio" && !(f.volume || f.frequency)) continue;
      if (ctx.effFilter === "pal" && !e.meta.palette) continue;
      const active = first && first.fx === e.id;
      const badges = (f.d2 ? " ▦" : "") + (f.volume || f.frequency ? " ♪" : "");
      list.appendChild(h("button", {
        style: (active ? S.btnOn : S.btn) + ";text-align:left;overflow:hidden;text-overflow:ellipsis" + (f.d2 && !is2D ? ";opacity:.45" : ""),
        title: f.d2 && !is2D ? "A 2D effect — this device isn't set up as a matrix" : e.name,
        onclick: () => toTargets({ fx: e.id, fxdef: true }, "change the effect"),
      }, e.name + badges));
    }
  };
  search.addEventListener("input", () => { ctx.effSearch = search.value; paintList(); });
  const fbar = h("div", { style: "display:flex;gap:6px;flex-wrap:wrap;align-items:center" }, [search]);
  for (const [id, label] of filters) {
    fbar.appendChild(h("button", { style: ctx.effFilter === id ? S.btnOn : S.btn, onclick: () => { ctx.effFilter = id; fbar.dispatchEvent(new CustomEvent("repaint", { bubbles: true })); } }, label));
  }
  root.appendChild(fbar);
  paintList();
  root.appendChild(list);
  return root;
}

// ── Info ─────────────────────────────────────────────────────────────────────

function infoView(ctx) {
  const i = ctx.info;
  const leds = i.leds || {};
  const rows = [
    ["Name", i.name], ["Version", `${i.ver || "?"}${i.vid ? ` (build ${i.vid})` : ""}`], ["Release", i.release],
    ["Source", i.repo], ["Build", M.forkOf(i) ? `${M.forkOf(i)} — not stock WLED` : "Stock WLED"],
    ["Chip", [i.arch, i.core].filter(Boolean).join(" · ")], ["Brand / product", [i.brand, i.product].filter(Boolean).join(" · ")],
    ["LEDs", `${leds.count || 0}${leds.matrix ? ` · matrix ${leds.matrix.w}×${leds.matrix.h}` : ""} · up to ${leds.maxseg || "?"} segments`],
    ["Frame rate", leds.fps !== undefined ? `${leds.fps} fps` : null],
    ["Power", leds.pwr !== undefined ? `${leds.pwr} mA estimated${leds.maxpwr ? ` of ${leds.maxpwr} mA limit` : " · no limit set"}` : null],
    ["Wi-Fi", i.wifi ? `${i.wifi.signal ?? "?"}% (${i.wifi.rssi ?? "?"} dBm) · channel ${i.wifi.channel ?? "?"}` : null],
    ["Address", [i.ip, i.mac].filter(Boolean).join(" · ")],
    ["Uptime", M.fmtUptime(i.uptime)], ["Free memory", i.freeheap ? `${Math.round(i.freeheap / 1024)} KB` : null],
    ["Storage", i.fs ? `${i.fs.u} of ${i.fs.t} KB used` : null],
    ["Live connections", i.ws !== undefined ? (i.ws < 0 ? "disabled" : String(i.ws)) : null],
    ["Effects / palettes", `${i.fxcount ?? "?"} / ${i.palcount ?? "?"}`],
    ["Realtime", i.live ? `receiving from ${i.lm || "?"} ${i.lip || ""}` : "not receiving"],
  ].filter(r => r[1] !== null && r[1] !== undefined && r[1] !== "");
  const card = h("div", { style: S.card });
  for (const [k, v] of rows) {
    card.appendChild(h("div", { style: "display:flex;gap:10px;font-size:12px;padding:3px 0;border-bottom:1px solid rgba(255,255,255,.04)" }, [
      h("span", { style: `color:${C.dim};width:130px;flex-shrink:0` }, k), h("span", {}, String(v)),
    ]));
  }
  const err = M.describeError(ctx.state.error);
  if (err) card.appendChild(h("div", { style: `color:${C.amber};font-size:12px;margin-top:6px` }, "⚠ " + err));
  card.appendChild(h("div", { style: `font-size:11px;color:${C.faint};margin-top:8px` },
    "Firmware updates are deliberately not offered here — many WLED units run custom builds that a stock update would wipe."));
  return card;
}
