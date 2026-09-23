// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
// See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
/**
 * WLED workbench — Presets & playlists. Anyone with the licence can read and
 * apply (a live change); saving, renaming, deleting, playlists and the boot
 * preset are an administrator's (enforced again in ws_wled.py).
 *
 * WLED's own UI has no rename (you re-save the content), no "what's in this
 * preset" summary and no boot badge; this has all three. A rename re-saves
 * the preset's own JSON as an API-command preset ("o":true writes the body
 * as is), so nothing but the name changes.
 */

const _q = new URL(import.meta.url).search;
const M = await import(`./wled_model.js${_q}`);
const { C, S, h, numberBox, check, select, errText, firstFreePreset, reportCfg } = await import(`./wled_ui.js${_q}`);

export async function loadPresets(ctx, force) {
  const pmt = ctx.info.fs && ctx.info.fs.pmt;
  if (!force && ctx.presets && ctx._presetsPmt === pmt) return ctx.presets;
  ctx.presets = await ctx.get("presets.json");
  ctx._presetsPmt = pmt;
  return ctx.presets;
}

export function presetSummary(effects, p) {
  if (p.playlist) return `Playlist · ${(p.playlist.ps || []).length} presets`;
  const segs = (p.seg || []).filter(s => (Number(s.stop) || 0) > 0 || s.fx !== undefined);
  if (!segs.length) return Object.keys(p).some(k => !["n", "ql"].includes(k)) ? "API command" : "Empty";
  const fx = [...new Set(segs.map(s => (effects.find(e => e.id === s.fx) || {}).name).filter(Boolean))];
  return `${segs.length} segment${segs.length === 1 ? "" : "s"} · ${fx.slice(0, 3).join(", ") || "—"}`
    + (p.bri !== undefined ? ` · brightness ${Math.round(p.bri / 2.55)}%` : "");
}

export function presetsView(ctx) {
  const root = h("div");
  const list = h("div");
  const editor = h("div");
  const status = h("div", { style: `font-size:12px;color:${C.dim}` }, "Reading presets…");
  const search = document.createElement("input");
  search.placeholder = "Search presets"; search.value = ctx.presetSearch || "";
  search.style.cssText = S.input + ";flex:1;min-width:140px";
  const bar = h("div", { style: "display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin:0 0 8px" }, [search]);
  const bootOf = () => Number((ctx.info.leds && ctx.info.leds.bootps) || 0);
  const reload = async () => { await loadPresets(ctx, true); paint(); paintEditor(); };

  const setBoot = async (id) => {
    try {
      const cur = await ctx.call("padspan_ha/wled_get", { path: "json/cfg" });
      const r = await ctx.call("padspan_ha/wled_cfg", { patch: { def: { ps: id } }, base_hash: cur.hash });
      ctx.info.leds = { ...(ctx.info.leds || {}), bootps: id };
      reportCfg(ctx, r, `Preset ${id} is now what the device starts with`);
      paint();
    } catch (e) { ctx.toast("Couldn't set the boot preset: " + errText(e), true); }
  };

  const paint = () => {
    list.innerHTML = "";
    const q = (ctx.presetSearch || "").toLowerCase();
    const entries = Object.entries(ctx.presets || {}).filter(([id]) => Number(id) > 0 && Number(id) < 255)
      .map(([id, p]) => ({ id: Number(id), p })).sort((a, b) => a.id - b.id)
      .filter(({ id, p }) => !q || String(p.n || "").toLowerCase().includes(q) || String(id) === q);
    if (!entries.length) list.appendChild(h("div", { style: `font-size:12px;color:${C.dim}` },
      q ? "No preset matches." : "No presets saved on this device yet."));
    for (const { id, p } of entries) {
      const isBoot = id === bootOf();
      const running = Number(ctx.state.ps) === id;
      const row = h("div", { style: S.card + ";display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:8px"
        + (running ? `;border-color:${C.purple}` : "") });
      row.appendChild(h("span", { style: `font-family:monospace;color:${C.faint};width:28px` }, String(id)));
      row.appendChild(h("span", { style: "font-weight:700;font-size:13px" }, p.n || `Preset ${id}`));
      if (p.ql) row.appendChild(h("span", { style: S.chip(C.mint), title: "Quick-load label" }, p.ql));
      if (isBoot) row.appendChild(h("span", { style: S.chip(C.green), title: "The device starts with this preset" }, "boot"));
      if (running) row.appendChild(h("span", { style: S.chip(C.purple) }, "running"));
      row.appendChild(h("span", { style: `font-size:11px;color:${C.dim};flex:1;min-width:120px` }, presetSummary(ctx.effects, p)));
      row.appendChild(h("button", { style: S.btnPrimary, onclick: () => ctx.write({ ps: id }, "apply the preset") }, "Apply"));
      if (ctx.isAdmin) {
        if (p.playlist) {
          row.appendChild(h("button", { style: S.btn, onclick: () => { ctx.editPlaylist = { id, n: p.n, ...JSON.parse(JSON.stringify(p.playlist)) }; paintEditor(); } }, "Edit"));
        } else {
          row.appendChild(h("button", { style: S.btn, title: "Replace this preset with what the device is showing now", onclick: async () => {
            if (!confirm(`Overwrite preset ${id} ("${p.n || ""}") with what the device is showing now?`)) return;
            const body = { psave: id, n: p.n || `Preset ${id}`, ib: p.bri !== undefined, sb: true };
            if (p.ql) body.ql = p.ql;
            if (await ctx.write(body, "save the preset")) await reload();
          } }, "Update"));
        }
        row.appendChild(h("button", { style: S.btn, onclick: async () => {
          const n = prompt("New name", p.n || "");
          if (n === null) return;
          if (await ctx.write({ ...p, n, psave: id, o: true }, "rename the preset")) await reload();
        } }, "Rename"));
        if (!isBoot && !p.playlist) row.appendChild(h("button", { style: S.btn, onclick: async () => {
          if (confirm(`Make preset ${id} ("${p.n || ""}") the one the device starts with?`)) await setBoot(id);
        } }, "Make boot"));
        row.appendChild(h("button", { style: S.btn + `;color:${C.red}`, onclick: async () => {
          if (!confirm(`Delete preset ${id} ("${p.n || ""}")?${isBoot ? " It's the boot preset." : ""}`)) return;
          if (await ctx.write({ pdel: id }, "delete the preset")) await reload();
        } }, "Delete"));
      }
      list.appendChild(row);
    }
  };

  // ── Playlist editor ──
  const paintEditor = () => {
    editor.innerHTML = "";
    const pl = ctx.editPlaylist;
    if (!pl) return;
    const presets = Object.entries(ctx.presets || {}).filter(([id, p]) => Number(id) > 0 && Number(id) < 255 && !p.playlist)
      .map(([id, p]) => [Number(id), p.n || `Preset ${id}`]);
    const n = (pl.ps || []).length;
    const asArr = (v, fill) => Array.isArray(v) ? v : Array(n).fill(v === undefined ? fill : v);
    pl.ps = pl.ps || []; pl.dur = asArr(pl.dur, 100); pl.transition = asArr(pl.transition, 7);
    const card = h("div", { style: S.card + `;border-color:${C.purple}` });
    card.appendChild(h("div", { style: "font-weight:700;margin-bottom:8px" }, pl.id ? `Playlist ${pl.id}` : "New playlist"));
    const name = document.createElement("input");
    name.value = pl.n || ""; name.placeholder = "Name"; name.style.cssText = S.input + ";width:220px";
    name.addEventListener("change", () => { pl.n = name.value; });
    card.appendChild(name);
    const rows = h("div", { style: "margin-top:8px" });
    pl.ps.forEach((pid, i) => {
      rows.appendChild(h("div", { style: "display:flex;gap:6px;align-items:center;margin:4px 0;flex-wrap:wrap" }, [
        h("span", { style: `color:${C.faint};width:18px` }, String(i + 1)),
        select(presets.map(([id, label]) => [id, `${id} · ${label}`]), pid, v => { pl.ps[i] = Number(v); }),
        h("span", { style: `font-size:11px;color:${C.dim}` }, "for"),
        numberBox(pl.dur[i] / 10, v => { pl.dur[i] = Math.round(v * 10); }, { max: 6553, step: 0.1 }),
        h("span", { style: `font-size:11px;color:${C.dim}` }, "s (0 = until skipped), fade"),
        numberBox(pl.transition[i] / 10, v => { pl.transition[i] = Math.round(v * 10); }, { max: 6553, step: 0.1 }),
        h("span", { style: `font-size:11px;color:${C.dim}` }, "s"),
        h("button", { style: S.btn, title: "Move up", onclick: () => {
          if (i > 0) { for (const k of ["ps", "dur", "transition"]) [pl[k][i - 1], pl[k][i]] = [pl[k][i], pl[k][i - 1]]; paintEditor(); }
        } }, "↑"),
        h("button", { style: S.btn, title: "Remove", onclick: () => { for (const k of ["ps", "dur", "transition"]) pl[k].splice(i, 1); paintEditor(); } }, "✕"),
      ]));
    });
    card.appendChild(rows);
    if (pl.ps.length < 100 && presets.length) card.appendChild(h("button", { style: S.btn, onclick: () => {
      pl.ps.push(presets[0][0]); pl.dur.push(100); pl.transition.push(7); paintEditor();
    } }, "+ Add a preset"));
    if (pl.ps.length >= 100) card.appendChild(h("div", { style: `font-size:11px;color:${C.amber}` }, "WLED plays at most 100 entries."));
    card.appendChild(h("div", { style: "display:flex;gap:10px;align-items:center;margin-top:8px;flex-wrap:wrap" }, [
      h("span", { style: `font-size:12px;color:${C.dim}` }, "Repeat (0 = forever)"),
      numberBox(pl.repeat || 0, v => { pl.repeat = v; }, { max: 127 }),
      h("span", { style: `font-size:12px;color:${C.dim}` }, "then"),
      select([[0, "stay on the last one"], [255, "go back to how it was"], ...presets.map(([id, l]) => [id, `apply ${l}`])],
        pl.end || 0, v => { pl.end = Number(v); }),
      check("Shuffle", pl.r, v => { pl.r = v; }),
    ]));
    const body = () => ({ ps: pl.ps, dur: pl.dur, transition: pl.transition, repeat: pl.repeat || 0, end: pl.end || 0, r: !!pl.r });
    card.appendChild(h("div", { style: "display:flex;gap:6px;margin-top:10px;flex-wrap:wrap" }, [
      h("button", { style: S.btn, title: "Play it now without saving", onclick: () => pl.ps.length && ctx.write({ playlist: body() }, "test the playlist") }, "▶ Try it"),
      h("button", { style: S.btnPrimary, onclick: async () => {
        if (!pl.ps.length) return;
        const id = pl.id || firstFreePreset(ctx.presets);
        if (await ctx.write({ psave: id, n: pl.n || `Playlist ${id}`, on: true, o: true, playlist: body() }, "save the playlist")) {
          ctx.editPlaylist = null; await reload();
        }
      } }, "Save playlist"),
      h("button", { style: S.btn, onclick: () => { ctx.editPlaylist = null; paintEditor(); } }, "Close"),
    ]));
    editor.appendChild(card);
  };

  search.addEventListener("input", () => { ctx.presetSearch = search.value; paint(); });
  if (ctx.isAdmin) {
    bar.appendChild(h("button", { style: S.btnPrimary, title: "Save what the device is showing now as a new preset", onclick: async () => {
      const id = firstFreePreset(ctx.presets);
      const n = prompt(`Name for preset ${id}`, `Preset ${id}`);
      if (n === null) return;
      const ib = confirm("Include the brightness in this preset?");
      if (await ctx.write({ psave: id, n, ib, sb: true }, "save the preset")) await reload();
    } }, "+ Save current as preset"));
    bar.appendChild(h("button", { style: S.btn, onclick: () => {
      ctx.editPlaylist = { id: 0, n: "", ps: [], dur: [], transition: [], repeat: 0, end: 0, r: false }; paintEditor();
    } }, "+ New playlist"));
  }
  if (Number(ctx.state.pl) > 0 && M.has(ctx.info, "nextInPlaylist")) {
    bar.appendChild(h("button", { style: S.btn, title: "Skip to the next entry of the running playlist",
      onclick: () => ctx.write({ np: true }, "skip ahead") }, "⏭ Next in playlist"));
  }
  root.appendChild(bar);
  root.appendChild(status);
  root.appendChild(editor);
  root.appendChild(list);
  loadPresets(ctx).then(() => { status.remove(); paint(); paintEditor(); })
    .catch(e => { status.textContent = "Couldn't read the presets: " + errText(e); status.style.color = C.red; });
  return root;
}
