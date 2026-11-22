// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
// See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
//
// Settings → Atlas → Power teams (power_team.py): a wall dimmer or switch and
// the smart bulbs it feeds, run as one light. Here a team is made, changed
// and removed; the whole list is saved at once (padspan_ha/power_teams_set,
// an administrator's). Nothing is saved until Save is pressed. Imports
// nothing but zigbee_twins.js: settings.js hands in its ctx and el.

// The same Zigbee device in ZHA and Zigbee2MQTT (zigbee_twins.js): the lists leave the
// duplicate copy out, unless a team has it. Optional: missing, every copy is offered.
const TW = await import(`./zigbee_twins.js${new URL(import.meta.url).search}`).catch(() => null);

const COLOUR = new Set(["color_temp", "hs", "xy", "rgb", "rgbw", "rgbww"]);
/** The numbers of the day's light, in the order shown: [key, words, unit]. */
export const CURVE_ROWS = [
  ["max_brightness", "Brightest, by day", "%"], ["min_brightness", "Dimmest, at midnight", "%"],
  ["max_kelvin", "Coolest, at noon", "K"], ["min_kelvin", "Warmest, at sunrise and sunset", "K"],
  ["sleep_brightness", "Sleep: brightness", "%"], ["sleep_kelvin", "Sleep: colour", "K"],
];
const PHASE = { off: "Off", starting: "Starting its bulbs…", ready: "On", failed: "On, but not every bulb answered" };

/** What can power a team (a light or a switch) and what can be its bulb (a light that has colour), from the states. */
export function choices(states){
  const out = { power: [], bulbs: [] };
  for (const eid of Object.keys(states || {}).sort()) {
    const st = states[eid], a = (st && st.attributes) || {};
    if (a.padspan_power_team) continue;                      // a team's own light is neither
    const name = a.friendly_name ? `${a.friendly_name} (${eid})` : eid;
    if (eid.startsWith("light.") || eid.startsWith("switch.")) out.power.push([eid, name]);
    if (eid.startsWith("light.") && (a.supported_color_modes || []).some(m => COLOUR.has(m))) out.bulbs.push([eid, name]);
  }
  return out;
}

export function powerTeamsSection(ctx, el){
  const box = el("div", { "data-focus-part": "power_teams", style: "margin-top:14px;padding-top:12px;border-top:1px solid #1e3a2a" });
  box.appendChild(el("div", { style: "font-weight:600;font-size:14px;color:#e2e8f0;margin-bottom:4px" }, "💡 Power teams"));
  box.appendChild(el("div", { style: "font-size:11px;color:#94a3b8;line-height:1.5;margin-bottom:8px" },
    "Smart colour bulbs in sockets fed by a wall dimmer or switch. A team makes them one light in Home Assistant: turning it on puts the power on at full, " +
    "waits for the bulbs to start, then sets their brightness and colour. Turning it off cuts the power. The wall button still works, and a dimmer held " +
    "to a level at the wall sets how bright the bulbs go. With “Follow the day” the light is cool and bright at midday, warm in the evening and dim at night. " +
    "Lights that always have power (LED strings on their own supply) can be a team with no power source: they then switch and change colour as one, " +
    "and one of them switched by an automation takes the others with it."));
  const body = el("div"), note = el("div", { style: "font-size:11px;color:#94a3b8;margin-top:6px" });
  box.appendChild(body);
  box.appendChild(note);
  const admin = !!(ctx.hass && ctx.hass.user && ctx.hass.user.is_admin);
  let teams = [], live = {}, defaults = {}, limits = {};
  const pick = choices((ctx.hass && ctx.hass.states) || {});
  const say = (text, bad) => { note.textContent = text; note.style.color = bad ? "#fca5a5" : "#94a3b8"; };

  function teamBox(t, i){
    const b = el("div", { "data-team": String(i), style: "border:1px solid #1e3a2a;border-radius:8px;padding:8px 10px;margin-top:8px" });
    const row = (label, node) => b.appendChild(el("div", { style: "display:flex;flex-wrap:wrap;align-items:center;gap:6px 10px;margin-top:6px" },
      [el("span", { style: "color:#cbd5e1;font-size:13px;min-width:130px" }, label), node]));     // returns the row
    const name = el("input", { type: "text", class: "input", value: t.name || "", placeholder: "Bedroom lights", maxlength: "60" });
    name.addEventListener("input", () => { t.name = name.value; });
    row("Name", name);
    const sel = document.createElement("select");
    sel.className = "select"; sel.style.maxWidth = "100%";
    sel.appendChild(el("option", { value: "" }, "None: these lights always have power"));
    // A Zigbee device's duplicate copy is left out, unless this team has it: then it is said, with the kept one a tap away.
    const st = (ctx.hass && ctx.hass.states) || {}, dup = (eid) => !!(TW && TW.duplicateOf(eid, ctx.state && ctx.state.settings));
    const power = pick.power.filter(([eid]) => eid === t.power || !dup(eid));
    for (const [eid, words] of power) sel.appendChild(el("option", { value: eid }, words));
    sel.value = t.power || "";
    // What off does (power_team.py `off`): turn the bulbs off and leave the power on (on again at once, in the day's
    // colour), or cut the power. Only with a power source: lights that always have power are switched themselves.
    const off = document.createElement("select");
    off.className = "select"; off.setAttribute("data-off", "1");
    off.appendChild(el("option", { value: "bulbs" }, "Turns the bulbs off, power stays on"));
    off.appendChild(el("option", { value: "power" }, "Cuts the power"));
    off.value = t.off === "bulbs" ? "bulbs" : "power";
    off.addEventListener("change", () => { t.off = off.value; });
    sel.addEventListener("change", () => { t.power = sel.value; offRow.hidden = !sel.value; });
    row("Power from", sel);
    const hidPower = TW && TW.hiddenNoteEl(pick.power.length - power.length);
    if (hidPower) b.appendChild(hidPower);
    const powerTwin = TW && TW.duplicateWarningEl(t.power || "", ctx.state && ctx.state.settings, st, (use) => useKept(t.power, use));
    if (powerTwin) b.appendChild(powerTwin);
    const offRow = row("Off", off);
    offRow.hidden = !t.power;
    const list = el("div", { style: "max-height:150px;overflow:auto;border:1px solid #1e3a2a;border-radius:6px;padding:4px 8px;min-width:240px" });
    if (!pick.bulbs.length) list.appendChild(el("div", { style: "font-size:12px;color:#94a3b8" }, "No colour lights found in Home Assistant yet."));
    const bulbs = pick.bulbs.filter(([eid]) => (t.bulbs || []).includes(eid) || !dup(eid));
    for (const [eid, words] of bulbs) {
      const cb = el("input", { type: "checkbox", "data-bulb": eid });
      cb.checked = (t.bulbs || []).includes(eid);
      cb.addEventListener("change", () => { t.bulbs = cb.checked ? [...(t.bulbs || []), eid] : (t.bulbs || []).filter(x => x !== eid); });
      list.appendChild(el("label", { style: "display:flex;align-items:center;gap:6px;font-size:12px;color:#e2e8f0;cursor:pointer" }, [cb, el("span", {}, words)]));
    }
    row("Its bulbs", list);
    const hidBulbs = TW && TW.hiddenNoteEl(pick.bulbs.length - bulbs.length);
    if (hidBulbs) b.appendChild(hidBulbs);
    for (const eid of (t.bulbs || [])) {
      const w = TW && TW.duplicateWarningEl(eid, ctx.state && ctx.state.settings, st, (use) => useKept(eid, use));
      if (w) b.appendChild(w);
    }
    const day = el("input", { type: "checkbox", "data-adaptive": "1" });
    day.checked = t.adaptive !== false;
    const curve = el("div", { style: "display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:4px 14px;margin-top:6px" });
    curve.hidden = !day.checked;
    day.addEventListener("change", () => { t.adaptive = day.checked; curve.hidden = !day.checked; });
    row("Follow the day", day);
    t.curve = { ...defaults, ...(t.curve || {}) };
    for (const [key, words, unit] of CURVE_ROWS) {
      const [lo, hi] = limits[key] || [1, 9000];
      const inp = el("input", { type: "number", class: "input", min: String(lo), max: String(hi), step: unit === "K" ? "50" : "1", value: String(t.curve[key]), "data-curve": key, style: "width:90px;box-sizing:content-box" });
      inp.addEventListener("change", () => { const v = Number(inp.value); if (Number.isFinite(v)) t.curve[key] = Math.max(lo, Math.min(hi, Math.round(v))); inp.value = String(t.curve[key]); });
      curve.appendChild(el("label", { style: "display:flex;align-items:center;justify-content:space-between;gap:8px;font-size:12px;color:#cbd5e1" }, [el("span", {}, words), el("span", {}, [inp, ` ${unit}`])]));
    }
    b.appendChild(curve);
    const l = t.id ? live[t.id] : null;
    if (l) {
      const missing = (l.missing || []).length ? ` No answer from: ${l.missing.join(", ")}.` : "";
      b.appendChild(el("div", { style: `font-size:11px;margin-top:6px;color:${l.phase === "failed" ? "#fbbf24" : "#94a3b8"}` }, `Now: ${PHASE[l.phase] || l.phase}.${missing}`));
    }
    const rm = el("button", { type: "button", class: "btn inline", "data-remove": "1", style: "margin-top:8px;font-size:12px" }, "Remove this team");
    rm.addEventListener("click", () => { teams.splice(i, 1); draw(); say("Removed here. Press Save to keep it."); });
    b.appendChild(rm);
    return b;
  }

  // "Use the Zigbee2MQTT one": the kept bulb or switch takes the duplicate's place in every team, and everywhere
  // else PadSpan keeps it (zigbee_twins.js useTwin), saved at once; the teams are read again.
  function useKept(eid, use){
    TW.useTwin(ctx.actions.wsCall, eid, use)
      .then((r) => { if (r && r.settings && ctx.state) ctx.state.settings = r.settings; return ctx.actions.wsCall("padspan_ha/power_teams_get", {}); })
      .then((r) => { take(r); say(TW.usedNow(((((ctx.hass && ctx.hass.states) || {})[use] || {}).attributes || {}).friendly_name || use)); },
            (e) => say(TW.useFailed(ctx.helpers && ctx.helpers.errorText ? ctx.helpers.errorText(e) : String((e && e.message) || e)), true));
  }
  function draw(){
    while (body.firstChild) body.removeChild(body.firstChild);
    if (!teams.length) body.appendChild(el("div", { style: "font-size:12px;color:#94a3b8" }, "No team yet."));
    teams.forEach((t, i) => body.appendChild(teamBox(t, i)));
    if (!admin) { body.appendChild(el("div", { style: "font-size:11px;color:#94a3b8;margin-top:6px" }, "An administrator makes and changes teams.")); return; }
    const add = el("button", { type: "button", class: "btn inline", "data-add": "1", style: "margin-top:8px" }, "+ Add a team");
    add.addEventListener("click", () => { teams.push({ name: "", power: "", bulbs: [], off: "bulbs", adaptive: true, curve: { ...defaults } }); draw(); });
    const save = el("button", { type: "button", class: "btn", "data-save": "1", style: "margin:8px 0 0 8px" }, "Save");
    save.addEventListener("click", async () => {
      try {
        take(await ctx.actions.wsCall("padspan_ha/power_teams_set", { teams }));
        say(teams.length ? "Saved. Each team is now a light in Home Assistant, under its name: give it its room there, then place it on the map." : "Saved.");
      } catch (e) { say("Could not save: " + String((e && e.message) || e), true); }
    });
    body.appendChild(el("div", {}, [add, save]));
  }
  function take(r){
    teams = JSON.parse(JSON.stringify((r && r.teams) || []));
    live = (r && r.live) || {}; defaults = (r && r.defaults) || {}; limits = (r && r.limits) || {};
    draw();
  }
  // Read only when asked for: Settings draws this page often, and most houses have no team.
  const open = el("button", { type: "button", class: "btn inline", "data-open": "1" }, "Show power teams");
  open.addEventListener("click", () => {
    open.remove();
    Promise.resolve(ctx.actions.wsCall("padspan_ha/power_teams_get", {})).then(take, (e) => say("Could not read the teams: " + String((e && e.message) || e), true));
  });
  body.appendChild(open);
  return box;
}
