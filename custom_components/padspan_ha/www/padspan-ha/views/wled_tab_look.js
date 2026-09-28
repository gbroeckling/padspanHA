// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
// See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
/**
 * WLED workbench — Exact look (Garry, 2026-09-27: "an exact, durable on/off
 * that reproduces complex 5-6 channel strings 100% every time").
 *
 * The look PadSpan puts on this light every time it turns it on: remembered
 * only when someone presses Remember (an accidental state never becomes the
 * look), shown part by part with its colours, white and warmth, with the
 * last command's result, any change to the LED setup since, and the five
 * looks before it. The backend (wled_exact.py) keeps the memory and does
 * every write; the switch between WLED sync and PadSpan is on the Sync &
 * team tab (wled_tab_sync.js).
 */

const _q = new URL(import.meta.url).search;
const M = await import(`./wled_model.js${_q}`);
const { C, S, h, check, errText } = await import(`./wled_ui.js${_q}`);

const when = (at) => {
  const d = new Date(Number(at) * 1000);
  return `${M.clockTime(at)} on ${d.getDate()} ${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][d.getMonth()]}`;
};

function swatch(hex, title, opacity = 1) {
  return h("span", { title, style: `display:inline-block;width:18px;height:18px;border-radius:5px;border:1px solid ${C.line};`
    + `background:${hex};opacity:${opacity.toFixed(2)};vertical-align:middle` });
}

/** One look's parts as swatch rows: colour, then white (tinted by its warmth). */
function partRows(summary) {
  return summary.parts.map(p => h("div", { style: "display:flex;align-items:center;gap:6px;font-size:12px;margin:3px 0;flex-wrap:wrap" }, [
    swatch(p.hex, `Colour ${p.hex}`),
    p.white ? swatch(p.white, `White ${p.w}${p.cct !== null ? `, warmth ${p.cct}` : ""}`, 0.15 + 0.85 * (p.w || 0) / 255) : null,
    h("span", {}, p.text),
    p.autoWhite ? h("div", { style: `flex-basis:100%;font-size:11px;color:${C.faint};margin-left:30px` },
      `White is worked out from the colour on this output (${p.autoWhite})`) : null,
  ]));
}

/**
 * Remember the look as it is now: read first (nothing saved), show the
 * summary and any warnings, then save. `team`: every member at once — none
 * is saved unless every member answered. Shared with the Sync & team tab.
 */
export async function rememberLook(ctx, { team = false } = {}) {
  let pre;
  try { pre = await ctx.call("padspan_ha/wled_look_remember", { team, preview: true }); }
  catch (e) { ctx.toast("Couldn't read the device: " + errText(e), true); return false; }
  const lines = (pre.looks || []).map(l => (team ? `${l.name}: ` : "") + M.lookSummary(l.look, ctx.effects).text
    + (l.warnings || []).map(w => `\n⚠ ${w}`).join(""));
  const warn = (pre.team_warnings || []).map(w => `\n\n⚠ ${w}`).join("");
  if (!confirm(`Remember ${team ? "the team look" : "this look"}?\n\n${lines.join("\n\n")}${warn}\n\n`
    + "PadSpan puts it back every time it turns this light on. The look it had before moves into the history.")) return false;
  try { await ctx.call("padspan_ha/wled_look_remember", { team }); }
  catch (e) { ctx.toast("Couldn't remember the look: " + errText(e), true); return false; }
  ctx.toast(team ? "Team look remembered" : "Look remembered");
  if (ctx.onExactChanged) ctx.onExactChanged();
  return true;
}

export function lookView(ctx) {
  const root = h("div");
  const status = h("div", { style: `font-size:12px;color:${C.dim};padding:6px 0` }, "Reading the remembered look…");
  root.appendChild(status);
  (async () => {
    let x;
    // compare: the device now against the look (and, after a restart or once
    // a day, its LED setup against the one the look was made on).
    try { x = await ctx.call("padspan_ha/wled_look_get", { compare: true }); }
    catch (e) { status.textContent = "Couldn't read the remembered look: " + errText(e); status.style.color = C.red; return; }
    ctx.exact = x;
    status.remove();
    paintLook(ctx, root, x || {});
  })();
  return root;
}

function paintLook(ctx, root, x) {
  const look = x.look;
  const padspan = x.join === "padspan";
  const redo = () => (ctx.reload ? ctx.reload() : ctx.repaint());

  // ── Who runs it, "put the look back", the last result ──
  const head = h("div", { style: S.card });
  root.appendChild(head);
  head.appendChild(h("div", { style: "font-weight:700;margin-bottom:6px" }, "Exact look"));
  head.appendChild(h("div", { style: `font-size:12px;color:${C.dim}` }, padspan
    ? "PadSpan gives this light its instructions: it comes on with the look below every time."
    : "WLED sync gives this light its instructions. Remember a look here, then choose PadSpan on the Sync & team tab."));
  if (x.team_mode === "padspan") head.appendChild(h("div", { style: `font-size:12px;color:${C.dim};margin-top:4px` },
    "Its team is run by PadSpan: every member comes on with its own look at the same moment."));
  if (x.sync_off_message) head.appendChild(h("div", { style: `font-size:12px;color:${C.amber};margin-top:4px` }, "⚠ " + x.sync_off_message));
  // Only while PadSpan runs it: under WLED sync nothing is put back.
  if (look && x.exact) {
    const hold = check("Put the look back when something else turns it on", x.hold !== false, async (v) => {
      try { await ctx.call("padspan_ha/wled_exact_set", { hold: v }); ctx.toast(v ? "The look goes back on when something else turns it on" : "Something else turning it on keeps what it asked for"); }
      catch (e) { ctx.toast("Couldn't change that: " + errText(e), true); }
      redo();
    }, "Home Assistant dashboards, voice, automations, the WLED app: the light keeps the brightness it was given and gets its look back");
    if (!ctx.isAdmin) hold.firstChild.disabled = true;
    head.appendChild(h("div", { style: "margin-top:8px" }, hold));
  }
  const res = M.lookResultLine(x.last_result);
  if (res) {
    head.appendChild(h("div", { style: `font-size:12px;margin-top:8px;color:${res.ok ? C.green : res.waiting ? C.amber : C.red}` },
      (res.ok ? "✓ " : "⚠ ") + res.text));
    if (res.late) head.appendChild(h("div", { style: `font-size:11px;color:${C.amber};margin-top:2px` }, res.late));
  }

  // ── The LED setup changed since the look was remembered ──
  const drift = x.drift;
  if (drift && (drift.what || []).length) {
    const banner = h("div", { style: S.card + ";border-color:rgba(251,191,36,.45)" });
    banner.appendChild(h("div", { style: `font-weight:700;color:${C.amber};margin-bottom:4px` },
      `⚠ The LED setup changed since the look was remembered (${when(drift.at)})`));
    for (const w of drift.what) banner.appendChild(h("div", { style: "font-size:12px;margin:2px 0" }, w));
    banner.appendChild(h("div", { style: `font-size:12px;color:${C.dim};margin-top:6px` }, drift.geometry
      ? "Until then PadSpan puts the look on without its part sizes, which may no longer fit. "
      : "The look is still put on exactly as remembered; these settings change how it comes out."));
    if (drift.geometry) {
      banner.appendChild(h("div", { style: `font-weight:700;font-size:12px;color:${C.amber};margin-top:4px` }, "Remember the look again"));
    }
    root.appendChild(banner);
  }

  // ── The remembered look ──
  const card = h("div", { style: S.card });
  root.appendChild(card);
  card.appendChild(h("div", { style: S.lbl }, "Remembered look"));
  if (!look) {
    card.appendChild(h("div", { style: `font-size:12px;color:${C.dim}` },
      "No look remembered yet. Set the light the way it should look, then press Remember this look."));
  } else {
    const sum = M.lookSummary(look, ctx.effects);
    card.appendChild(h("div", { style: "font-size:13px;margin-bottom:6px" }, sum.text));
    for (const row of partRows(sum)) card.appendChild(row);
    for (const w of look.warnings || []) card.appendChild(h("div", { style: `font-size:12px;color:${C.amber};margin-top:3px` }, "⚠ " + w));
    card.appendChild(h("div", { style: `font-size:11px;color:${C.faint};margin-top:6px` },
      `Remembered at ${when(look.at)}${look.by ? ` by ${look.by}` : ""} · WLED ${look.fw || "?"}`));
    if (Array.isArray(x.differs)) {
      card.appendChild(h("div", { style: `font-size:12px;margin-top:6px;color:${x.differs.length ? C.amber : C.green}` }, x.differs.length
        ? `Differs from the remembered look now: ${M.diffWords(x.differs)}` : "✓ The light matches the remembered look now"));
    } else if (x.compare_error) {
      card.appendChild(h("div", { style: `font-size:12px;margin-top:6px;color:${C.faint}` },
        x.compare_error === "offline" ? "The light is offline, so it couldn't be compared now" : `Couldn't compare with the light now: ${x.compare_error}`));
    }
  }
  const actions = h("div", { style: "display:flex;gap:6px;flex-wrap:wrap;margin-top:10px" });
  if (ctx.isAdmin) {
    actions.appendChild(h("button", { style: S.btnPrimary, title: "Reads the light as it is now, shows it, then remembers it",
      onclick: async () => { if (await rememberLook(ctx)) redo(); } }, "Remember this look"));
    if (x.team_id) actions.appendChild(h("button", { style: S.btn, title: "Every member of the team at once",
      onclick: async () => { if (await rememberLook(ctx, { team: true })) redo(); } }, "Remember team look"));
  }
  if (look && x.exact) actions.appendChild(h("button", { style: S.btn, title: "Off, then on with the look",
    onclick: async () => {
      try {
        await ctx.hass.callWS({ type: "padspan_ha/wled_power", entity_id: ctx.eid, on: false, source: "try" });
        const r = await ctx.hass.callWS({ type: "padspan_ha/wled_power", entity_id: ctx.eid, on: true, source: "try" });
        const bad = ((r && r.results) || []).filter(m => !m.ok);
        ctx.toast(bad.length ? bad.map(m => `${m.name}: ${m.message || M.diffWords(m.diffs) || "didn't take"}`).join(" · ")
          : "On with the look — matched exactly", bad.length > 0);
      } catch (e) { ctx.toast("Couldn't try it: " + errText(e), true); }
      redo();
    } }, "Try it"));
  if (actions.children.length) card.appendChild(actions);
  if (!ctx.isAdmin) card.appendChild(h("div", { style: `font-size:11px;color:${C.faint};margin-top:6px` }, "An administrator remembers the look."));

  // ── History: the five looks before this one ──
  const history = x.history || [];
  if (history.length) {
    const hist = h("div", { style: S.card });
    root.appendChild(hist);
    hist.appendChild(h("div", { style: S.lbl }, `History (${history.length})`));
    for (const old of history) {
      const sum = M.lookSummary(old, ctx.effects);
      hist.appendChild(h("div", { style: "display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:6px 0;border-top:1px solid rgba(255,255,255,.04)" }, [
        h("span", { style: "display:inline-flex;gap:3px" }, sum.parts.map(p => swatch(p.hex, p.text))),
        h("span", { style: "font-size:12px;flex:1;min-width:200px" }, [
          h("div", {}, sum.text),
          h("div", { style: `font-size:11px;color:${C.faint}` }, `Remembered at ${when(old.at)}${old.by ? ` by ${old.by}` : ""}`),
        ]),
        ctx.isAdmin ? h("button", { style: S.btn, onclick: async () => {
          if (!confirm("Use this look instead? The one remembered now moves into the history.")) return;
          try {
            await ctx.call("padspan_ha/wled_look_use_history", { index: old.index });
            ctx.toast("That's the remembered look now — the light gets it the next time it turns on");
          } catch (e) { ctx.toast("Couldn't use that look: " + errText(e), true); }
          redo();
        } }, "Use this one") : null,
      ]));
    }
  }
}
