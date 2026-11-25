// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
//
// Settings → Atlas → 📣 Open screens (screens.py): the switch, the
// PadSpan pages open right now, and Reload / Rename / a test announcement.
// Off by default. Saves straight to the wire like wall_card.js, so Settings
// isn't rebuilt under the list.

// Its words in the panel's language (i18n.js, the "atlas" catalogue, as the rest of Settings → Atlas); English if that
// can't load. It had a stand-in that only filled {placeholders}, so the card stayed English in every language.
const _fill = (s, vars) => (vars ? s.replace(/\{(\w+)\}/g, (_, k) => (k in vars ? String(vars[k]) : `{${k}}`)) : s);
const { t } = await import(`./i18n.js${new URL(import.meta.url).search}`).catch(() => ({ t: _fill }));

function ago(s){
  s = Math.max(0, Math.round(Number(s) || 0));
  if (s < 90) return t("{n} s", { n: s });
  if (s < 5400) return t("{n} min", { n: Math.round(s / 60) });
  if (s < 129600) return t("{n} h", { n: Math.round(s / 3600) });
  return t("{n} days", { n: Math.round(s / 86400) });
}

const PAGE_WORD = { panel: "Panel", atlas: "Atlas page" };

/** The card. `build` the running backend's build id: a screen on another one is marked. */
export function screensCard(ctx, el, settings, build){
  const card = el("div", { class: "card", "data-focus-part": "open_screens", style: "padding:16px;margin-top:20px" });
  card.appendChild(el("div", { style: "font-weight:700;font-size:14px;color:#52b788;margin-bottom:6px" }, "📣 Open screens"));
  card.appendChild(el("div", { style: "font-size:12px;color:#94a3b8;margin-bottom:10px;line-height:1.55" },
    "See every PadSpan page open right now (wall tablets, TVs, desktops), reload them from here after an update, " +
    "and put a message on them from an automation: the doorbell, the washing machine, dinner. Off, PadSpan keeps no list and both actions refuse."));
  const row = el("label", { style: "display:flex;align-items:center;gap:8px;cursor:pointer" });
  const cb = el("input", { type: "checkbox" });
  cb.checked = !!(settings && settings.screens_remote_enabled);
  row.appendChild(cb);
  row.appendChild(el("span", { style: "color:#e2e8f0;font-size:14px" }, "List open screens, and let Home Assistant reload them and show announcements"));
  card.appendChild(row);
  const note = el("div", { style: "font-size:11px;color:#94a3b8;margin:4px 0 0 24px" }, "Saves right away.");
  card.appendChild(note);
  const body = el("div", { style: "margin-top:12px" });
  card.appendChild(body);

  let screens = [];
  const call = (msg) => ctx.actions.wsCall(msg.type, (({ type, ...rest }) => rest)(msg));
  const fail = (e) => ctx.toast(t("Could not do that: {why}", { why: ctx.helpers.errorText(e) }), true);

  async function load(){
    try { const r = await call({ type: "padspan_ha/screens_list" }); screens = (r && r.screens) || []; }
    catch (e) { screens = []; }
    paint();
  }
  async function command(cmd, extra){
    try {
      const r = await call({ type: "padspan_ha/screens_command", cmd, ...extra });
      screens = (r && r.screens) || screens;
      paint();
      return r;
    } catch (e) { fail(e); return null; }
  }

  function paint(){
    body.textContent = "";
    if (!cb.checked) return;
    const top = el("div", { style: "display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-bottom:8px" }, [
      el("span", { style: "color:#cbd5e1;font-size:13px;flex:1 1 auto" },
        screens.length ? t("{n} open now", { n: screens.length }) : "No PadSpan page is open anywhere right now (this one joins within a few seconds)."),
      el("button", { class: "btn inline", type: "button", onclick: load }, "Refresh"),
      el("button", { class: "btn inline", type: "button", onclick: async () => {
        if (!confirm("Reload every open PadSpan screen? A screen someone is using right now (this one, most likely) waits, and shows here as older until it's reloaded.")) return;
        const r = await command("reload");
        if (r) ctx.toast(t("Reload sent to {n} screens", { n: r.sent }));
      } }, "Reload all"),
    ]);
    body.appendChild(top);
    for (const s of screens) {
      const name = s.name || s.device || "Unnamed screen";
      const old = build && s.build && s.build !== build;
      const facts = [PAGE_WORD[s.page] || s.page, s.view && s.page === "panel" ? s.view : "", s.kiosk ? "wall (?kiosk=1)" : "",
                     s.device && s.name ? s.device : "", s.user ? t("as {u}", { u: s.user }) : "", t("open {d}", { d: ago(s.open_s) })]
        .filter(Boolean).join(" · ");
      body.appendChild(el("div", { style: "display:flex;flex-wrap:wrap;gap:8px;align-items:center;padding:6px 0;border-top:1px solid #1f3a2b;font-size:12px" }, [
        el("div", { style: "flex:1 1 240px;min-width:0" }, [
          el("div", { style: "color:#e2e8f0;font-size:13px;font-weight:600" }, name),
          el("div", { style: "color:#94a3b8" }, facts),
          old ? el("div", { style: "color:#fbbf24" }, "Running an older PadSpan: Reload brings it up to date.") : null,
        ].filter(Boolean)),
        el("button", { class: "btn tiny", type: "button", onclick: async () => {
          const n = prompt("A name for this screen (e.g. Kitchen tablet):", s.name || "");
          if (n === null) return;
          await command("rename", { screens: [s.screen_id], name: n.trim().slice(0, 60) });
        } }, "Rename"),
        el("button", { class: "btn tiny", type: "button", onclick: () => command("reload", { screens: [s.screen_id] }) }, "Reload"),
      ]));
    }
    // A test announcement, and how to send one from an automation.
    const msg = el("input", { type: "text", maxlength: "300", placeholder: "Someone is at the door", style: "flex:1 1 220px;min-width:160px" });
    body.appendChild(el("div", { style: "display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-top:12px" }, [
      el("span", { style: "color:#cbd5e1;font-size:13px" }, "Try an announcement:"), msg,
      el("button", { class: "btn inline", type: "button", onclick: async () => {
        const m = (msg.value || "").trim() || "Someone is at the door";
        const r = await command("announce", { message: m });
        if (r) ctx.toast(t("Shown on {n} screens", { n: r.sent }));
      } }, "Show on every screen"),
    ]));
    const yaml = "action: padspan_ha.announce\ndata:\n  message: \"Someone is at the door\"\n  title: Doorbell\n  seconds: 20\n  speak: true          # read aloud by the screen's browser\n  screens: [Kitchen tablet]   # leave out for every screen";
    body.appendChild(el("div", { style: "font-size:12px;color:#94a3b8;margin:10px 0 4px" },
      "From an automation or script (padspan_ha.reload_screens works the same way, with screens: to pick some):"));
    body.appendChild(el("pre", { style: "margin:0;padding:8px 10px;background:#0b140e;border:1px solid #1f3a2b;border-radius:6px;font-size:12px;color:#cbd5e1;white-space:pre-wrap" }, yaml));
    body.appendChild(el("div", { style: "font-size:11px;color:#94a3b8;margin-top:6px;line-height:1.5" },
      "Browsers play sound only after someone has tapped the page once. On a Fully Kiosk tablet, turn on Autoplay Audio (Web Content Settings) and it chimes and speaks right away."));
  }

  cb.addEventListener("change", async () => {
    const want = cb.checked;
    try {
      const r = await ctx.actions.wsCall("padspan_ha/settings_set", { screens_remote_enabled: want });
      if (r && r.settings && ctx.state) ctx.state.settings = r.settings;
      note.textContent = want ? "Saved. Open PadSpan pages join within a few seconds." : "Saved. Off: no list, and both actions refuse.";
      note.style.color = "#52b788";
      if (want) setTimeout(load, 2500); else { screens = []; paint(); }
    } catch (e) {
      cb.checked = !want;
      note.textContent = t("Could not save: {why}", { why: String(e && e.message || e) });
      note.style.color = "#f87171";
    }
  });
  if (cb.checked) load();
  return card;
}
