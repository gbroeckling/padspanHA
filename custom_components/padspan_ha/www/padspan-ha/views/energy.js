// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
// See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
//
// Energy, the main panel's view (the Energy add-on; the owner, 2026-11-26).
// In the menu only while the house has Energy turned on (Settings → Atlas →
// Energy) and may use it (PadSpan Pro or the add-on): panel.js
// _getVisibleTabs. The house-level numbers, from the backend's
// padspan_ha/energy_get (energy.py), which reads Home Assistant's own Energy
// setup:
//
//   now        the house's watts, the metered devices and the rest of the house
//   standby    while everyone is out: its watts and their cost over a year
//   empty      the watts in rooms nobody is in, with the rooms
//   today      the rooms and devices by today's kWh, with their cost
//   health     what looks wrong with the sensors, each with its entity
//   always on  an administrator's list of devices left out of the empty rooms
//   spikes     who was home at the spikes (an administrator's, only while its
//              switch is on: energy data shows routines)

const SEARCH = new URL(import.meta.url).search;
const _fill = (s, v) => s.replace(/\{(\w+)\}/g, (m, k) => (v && Object.prototype.hasOwnProperty.call(v, k) ? String(v[k]) : m));
const { t } = await import(`./i18n.js${SEARCH}`).catch(() => ({ t: _fill }));
const { fmtW, fmtKwh, fmtMoney, fmtFor, locale, BOLT } = await import(`./energy_map.js${SEARCH}`);
const { addonUsedSeen } = await import(`./editions.js${SEARCH}`);

const REFRESH_MS = 30000;
const AMBER = "#fbbf24";
const HEAD = "#52b788";            // the panel's own card headings (amber reads as a warning elsewhere)
const ISSUE_WORDS = {
  // A stale power reading is left out of the watts now; its kWh today come from the recorder and still count.
  stale: () => t("No recent power reading: it is left out of the watts now"),
  unit: () => t("Its unit isn't W or kW (power) or kWh or Wh (energy)"),
  mismatch: () => t("Its power and energy sensors disagree about today"),
  child_over_parent: () => t("It uses more than the device it is part of"),
  grid_sign: () => t("The grid shows export at night: its sign may be the wrong way round"),
  no_area: () => t("It has no area in Home Assistant, so it is in no room"),
  loop: () => t("It and another device are each set as part of the other: neither is taken out of the other"),
};
let _viewCounted = false;

const _when = (ts) => new Date(ts * 1000).toLocaleString(locale(), { weekday: "short", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });

export function render(ctx) {
  const { el } = ctx.helpers;
  const root = el("div", { id: "energy" });
  root.appendChild(el("div", { style: "margin-bottom:14px" }, [
    el("div", { style: "display:flex;align-items:center;gap:8px" }, [
      el("div", { style: `font-size:24px;color:${AMBER}` }, BOLT),
      el("div", { style: `font-weight:700;font-size:16px;color:${HEAD}` }, t("Energy")),
    ]),
    el("div", { style: "font-size:12px;color:#94a3b8;margin-top:2px" },
      t("Your house's power from Home Assistant's Energy setup, room by room, and what it uses while rooms are empty or everyone is out.")),
  ]));
  const content = el("div", {});
  root.appendChild(content);
  const es = ctx.state._energy || (ctx.state._energy = { data: null, ts: 0 });
  if (es.data) draw(ctx, el, content, es.data);
  else content.appendChild(el("div", { style: "text-align:center;color:#94a3b8;padding:20px" }, es.error ? es.error : t("Loading…")));
  if (!es.data || Date.now() - es.ts > REFRESH_MS) load(ctx);
  if (!_viewCounted) {
    _viewCounted = true;
    const send = (n) => ctx.actions.telemetryEvent(n);
    send("energy:view");
    addonUsedSeen(send, "energy");
  }
  return root;
}

async function load(ctx) {
  const es = ctx.state._energy;
  if (es.loading) return;
  es.loading = true;
  // Stamped before the call, as energy_map.js refresh() does: a failed call is tried again after REFRESH_MS, never on
  // every redraw (each failure drew the view again, which asked again).
  es.ts = Date.now();
  try {
    es.data = await ctx.actions.wsCall("padspan_ha/energy_get");
    es.error = null;
  } catch (e) {
    es.error = ctx.helpers.errorText(e);
  } finally {
    es.loading = false;
  }
  if (ctx.state.view === "energy") ctx.actions.renderRooms();
}

const card = (el, title, kids, attr) => el("div", { class: "card", style: "padding:14px 16px;margin-bottom:12px", ...(attr ? { "data-energy": attr } : {}) },
  [el("div", { style: `font-weight:700;font-size:14px;color:${HEAD};margin-bottom:8px` }, title), ...kids]);
// A name and its numbers: on a phone the numbers go under the name rather than break it mid-word.
const line = (el, left, right, attrs = {}) => el("div", { style: "display:flex;flex-wrap:wrap;justify-content:space-between;column-gap:12px;row-gap:2px;padding:4px 0;font-size:13px;border-bottom:1px solid rgba(120,190,155,.08)", ...attrs },
  [el("span", { style: "flex:1 1 9em;min-width:0;overflow-wrap:normal;word-break:normal" }, left),
   el("span", { style: "flex:0 1 auto;margin-left:auto;text-align:right;font-variant-numeric:tabular-nums" }, right)]);
const note = (el, text) => el("div", { style: "font-size:12px;color:#94a3b8;margin-top:6px;line-height:1.5" }, text);

export function draw(ctx, el, content, d) {
  if (!d || d.on !== true) {
    // Not allowed here: Settings has no Energy card to point to; say what it needs.
    content.appendChild(d && d.allowed === false
      ? card(el, t("Energy"), [note(el, t("Energy needs PadSpan Pro or the Energy add-on."))], "not_allowed")
      : card(el, t("Energy is off"), [note(el, t("Turn it on in Settings → Atlas → Energy."))], "off"));
    return;
  }
  const cur = d.currency, priced = d.price !== null && d.price !== undefined;
  const money = (v) => (priced ? fmtMoney(v, cur) : "");
  if (!d.set_up) {
    const a = el("a", { href: d.config_url || "/config/energy", target: "_top", class: "btn inline", "data-energy-setup": "" }, t("Open Home Assistant's Energy settings"));
    content.appendChild(card(el, t("Home Assistant's Energy isn't set up"), [
      note(el, t("PadSpan reads Home Assistant's own Energy setup: add your devices' energy and power sensors there, and the house's grid or home figure. Nothing to import: it shows here as soon as it is set up.")), a], "setup"));
    return;
  }
  // Now.
  const h = d.house || {};
  const now = [];
  if (h.w !== null && h.w !== undefined) now.push(line(el, t("The house now"), fmtW(h.w), { "data-energy-house": "" }));
  else now.push(note(el, t("No whole-house figure: add the grid's or the home's power sensor in Home Assistant's Energy settings to see it and the rest of the house.")));
  now.push(line(el, t("Metered devices"), fmtW(h.metered_w)));
  if (h.rest_w !== null && h.rest_w !== undefined) now.push(line(el, t("Rest of the house"), fmtW(h.rest_w), { "data-energy-rest": "" }));
  content.appendChild(card(el, t("Now"), now, "now"));
  // Standby while you're out.
  const sb = d.standby;
  content.appendChild(card(el, t("Standby while you're out"), [sb
    ? el("div", { style: "font-size:13px", "data-energy-standby": "" }, sb.year_cost !== null && sb.year_cost !== undefined
      ? t("{w}, about {money} a year at your price", { w: fmtW(sb.w), money: fmtMoney(sb.year_cost, cur) })
      : t("{w}, about {kwh} a year", { w: fmtW(sb.w), kwh: fmtKwh(sb.year_kwh) }))
    : note(el, t("Not measured yet: PadSpan measures the house's lowest steady use while everyone is out or Vacation Mode is on."))], "standby"));
  // Empty rooms now.
  const em = d.empty || { rooms: [] };
  const emptyRows = (em.rooms || []).map(r => {
    const m = money(r.cost);
    return line(el, r.room, m ? t("Empty for {for}: {w} (about {money} today)", { for: fmtFor(r.for_s), w: fmtW(r.w), money: m })
      : t("Empty for {for}: {w}", { for: fmtFor(r.for_s), w: fmtW(r.w) }), { "data-energy-empty": r.room });
  });
  content.appendChild(card(el, t("Empty rooms now"), [
    ...(emptyRows.length ? [line(el, t("In empty rooms"), fmtW(em.w)), ...emptyRows]
      : [note(el, em.source ? t("Nothing is using power in an empty room.") : t("PadSpan can't tell yet which rooms are empty: it needs Bluetooth receivers, or motion or occupancy sensors in the rooms' areas, or everyone's Home Assistant person away."))]),
    note(el, t("A room counts as empty once nobody has been in it for {n} minutes.", { n: em.after_min || 15 })),
  ], "empty"));
  // Today.
  // One rule for both lists: what used something today (0.005 kWh or more, so nothing reads "0.00 kWh").
  const used = (k) => Number(k) >= 0.005;
  const rooms = (d.rooms || []).filter(r => used(r.kwh)).slice().sort((a, b) => b.kwh - a.kwh);
  const devs = (d.devices || []).filter(x => used(x.own_kwh)).slice().sort((a, b) => (b.own_kwh || 0) - (a.own_kwh || 0));
  const kwhMoney = (k, c) => [fmtKwh(k), money(c)].filter(Boolean).join(" · ");
  const tday = d.today || {};
  content.appendChild(card(el, t("Today"), [
    ...(used(tday.kwh) ? [line(el, el("b", {}, t("All metered devices")), kwhMoney(tday.kwh, tday.cost), { "data-energy-today": "" })] : []),
    el("div", { style: "font-size:11px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:#94a3b8;margin:2px 0" }, t("Rooms")),
    ...(rooms.length ? rooms.map(r => line(el, r.room, kwhMoney(r.kwh, r.cost), { "data-energy-room": r.room })) : [note(el, t("No room has used anything yet today."))]),
    el("div", { style: "font-size:11px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:#94a3b8;margin:10px 0 2px" }, t("Devices")),
    ...(devs.length ? devs.map(x => line(el, x.name, kwhMoney(x.own_kwh, x.cost), { "data-energy-device": x.id })) : [note(el, t("No device has used anything yet today."))]),
    ...(priced ? [] : [note(el, t("No price: add the grid's price in Home Assistant's Energy settings to see what it costs."))]),
  ], "today"));
  // Health.
  const issues = d.issues || [];
  // Each by its name (the device's, else the sensor's own), its entity id small under it.
  const names = new Map();
  for (const x of d.devices || []) { names.set(x.id, x.name); if (x.rate) names.set(x.rate, x.name); }
  const nameOf = (eid) => names.get(eid) || ((ctx.hass && ctx.hass.states && ctx.hass.states[eid] && ctx.hass.states[eid].attributes) || {}).friendly_name || eid || "";
  content.appendChild(card(el, t("Sensor health"), issues.length ? issues.map(i => el("div", { style: "padding:4px 0;font-size:13px", "data-energy-issue": i.kind }, [
    el("div", { style: "color:#e2e8f0" }, nameOf(i.entity)),
    el("div", { style: "font-family:ui-monospace,monospace;font-size:10px;color:#64748b" }, i.entity || ""),
    el("div", { style: "color:#94a3b8;font-size:12px" }, ISSUE_WORDS[i.kind] ? ISSUE_WORDS[i.kind]() : i.kind),
  ])) : [note(el, t("Every sensor looks right."))], "health"));
  const admin = !!(ctx.hass && ctx.hass.user && ctx.hass.user.is_admin);
  if (admin) content.appendChild(alwaysOnCard(ctx, el, d));
  if (admin && ctx.state.settings && ctx.state.settings.energy_spikes_enabled === true) content.appendChild(spikesCard(ctx, el, d));
}

// The always-on list (energy_always_on): an administrator's, its ticks kept as they are made.
function alwaysOnCard(ctx, el, d) {
  const kept = new Set(((ctx.state.settings || {}).energy_always_on) || []);
  const rows = (d.devices || []).map(x => {
    const cb = el("input", { type: "checkbox", "data-energy-always": x.id });
    cb.checked = kept.has(x.id) || (x.rate && kept.has(x.rate));
    cb.addEventListener("change", async () => {
      const next = new Set(((ctx.state.settings || {}).energy_always_on) || []);
      next.delete(x.id); if (x.rate) next.delete(x.rate);
      if (cb.checked) next.add(x.id);
      try {
        await ctx.actions.settingsSet({ energy_always_on: [...next] });
        ctx.actions.telemetryEvent("energy:always_on");
        ctx.state._energy.ts = 0;
      } catch (e) {
        cb.checked = !cb.checked;
        ctx.toast(t("Could not save: {why}", { why: ctx.helpers.errorText(e) }), true);
      }
    });
    return el("label", { style: "display:flex;align-items:center;gap:8px;min-height:36px;padding:4px 0;font-size:13px;cursor:pointer" },
      [cb, el("span", {}, x.name + (x.room ? ` · ${x.room}` : ""))]);
  });
  return card(el, t("Expected always on"), [
    note(el, t("Devices you expect to run all the time (a fridge, network gear) are left out of the empty rooms' watts.")),
    ...(rows.length ? rows : [note(el, t("No metered devices yet."))]),
  ], "always_on");
}

// Who was home at spikes: an administrator's, asked for only when opened (energy_spikes).
function spikesCard(ctx, el, d) {
  const es = ctx.state._energy;
  const body = el("div", {});
  const show = (got) => {
    body.replaceChildren();
    if (!got || !got.spikes || !got.spikes.length) { body.appendChild(note(el, got && got.house === false ? t("No whole-house figure: spikes need the grid's or the home's power sensor.") : t("No spikes in the last 7 days."))); return; }
    for (const s of got.spikes) {
      const who = (s.who || []).map(p => p.rooms && p.rooms.length ? t("{name}: {rooms}", { name: p.name, rooms: p.rooms.join(", ") }) : p.name).join("; ");
      body.appendChild(el("div", { style: "padding:6px 0;border-bottom:1px solid rgba(120,190,155,.08);font-size:13px", "data-energy-spike": String(s.ts) }, [
        el("div", { style: "display:flex;justify-content:space-between;gap:10px" }, [el("span", {}, _when(s.ts)), el("span", { style: `font-weight:800;color:${AMBER}` }, fmtW(s.w))]),
        el("div", { style: "font-size:12px;color:#94a3b8" }, who || t("Nobody PadSpan tracks was home")),
        el("a", { href: s.link, target: "_top", style: "font-size:12px;color:#a7f3d0" }, t("Open Traceback then")),
      ]));
    }
  };
  const btn = el("button", { class: "btn inline", "data-energy-spikes": "" }, t("Show who was home at spikes"));
  btn.addEventListener("click", async () => {
    btn.disabled = true;
    try {
      es.spikes = await ctx.actions.wsCall("padspan_ha/energy_spikes");
      ctx.actions.telemetryEvent("energy:spikes");
      show(es.spikes);
    } catch (e) {
      ctx.toast(ctx.helpers.errorText(e), true);
    }
    btn.disabled = false;
  });
  if (es.spikes) show(es.spikes);
  return card(el, t("Who was home at spikes"), [
    note(el, t("The biggest jumps in the house's power over the last 7 days, and who PadSpan saw at home then. It stays on this house and only administrators see it.")),
    btn, body], "spikes");
}
