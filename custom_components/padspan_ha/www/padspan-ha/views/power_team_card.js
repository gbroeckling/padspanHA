// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
// See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
//
// A power team on the map (power_team.py): its wall dimmer, its bulbs and its own light are ONE thing there.
//
// 2026-11-21, the owner: "The case we have here needs the control4 light teamed with the hue on one card. Think
// about the logic and make a card that will cover all contingencies. In other words add a power element to the team
// of lights design"; "when controlling the team with a single button press, use hue, but when pressing to get the
// card, give control4 power as an option"; "the circadian rhythm features in the software we used code from, those
// advanced settings should show in the card, and a bit of control over using the lights as a morning alarm".
//
// So whichever of them is placed on the map (the Control4 dimmer, usually: it was there first), a tap switches the
// TEAM (its light: the bulbs, over Zigbee, when the team leaves the power on), a drag dims the team, and a hold opens
// the control card on the team's light with this section in it: what the team is doing, the day or sleep, the power
// (on, off, the dimmer's level, out of reach, and Cut power / Power on), each bulb (answering, off, out of reach, not
// answering, and Try again), the wake-up, and the day's curve. The lists below say which case each line covers.
//
// Imports nothing: lights_map.js hands in its element maker.

/** Every power team's light by the entity ids that belong to it (its own light, its power source, its bulbs), from the
 *  states. Worked out once per states object: the map asks for every light on every poll. */
const _maps = new WeakMap();
export function teamMap(states){
  if (!states || typeof states !== "object") return new Map();
  const had = _maps.get(states);
  if (had) return had;
  const m = new Map();
  for (const eid of Object.keys(states)) {
    const a = (states[eid] && states[eid].attributes) || {};
    if (!a.padspan_power_team || !String(eid).startsWith("light.")) continue;
    m.set(eid, eid);
    if (typeof a.power === "string" && a.power) m.set(a.power, eid);
    for (const b of Array.isArray(a.bulbs) ? a.bulbs : []) if (typeof b === "string") m.set(b, eid);
  }
  _maps.set(states, m);
  return m;
}

/** The team light this entity belongs to (itself, when it is one), or null. */
export function teamOf(states, eid){
  return teamMap(states).get(eid) || null;
}

/** Every entity a team's light stands for: its own, its power source's, its bulbs'. */
export function teamMembers(states, teamEid){
  const a = (states && states[teamEid] && states[teamEid].attributes) || {};
  return [teamEid, ...(a.power ? [a.power] : []), ...(Array.isArray(a.bulbs) ? a.bulbs : [])];
}

/** How a team is drawn in place of one of its members (the wall dimmer, a bulb): its on, brightness and colour. Null
 *  when the team's light is out of reach (the member then shows as itself). */
export function teamLook(states, eid){
  const tl = teamOf(states, eid);
  if (!tl || tl === eid) return null;
  const st = states[tl];
  if (!st || st.state === "unavailable") return null;
  const a = st.attributes || {};
  return {
    team: tl, state: st.state,
    rgb: Array.isArray(a.rgb_color) ? a.rgb_color : null,
    bri: Number(a.brightness) || null,
    ct: Number(a.color_temp_kelvin) || null,
  };
}

// ── words ────────────────────────────────────────────────────────────────────
const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const CURVE_ROWS = [
  ["max_brightness", "Brightest, by day", "%", 1], ["min_brightness", "Dimmest, at midnight", "%", 1],
  ["max_kelvin", "Coolest, at noon", "K", 50], ["min_kelvin", "Warmest, at sunrise and sunset", "K", 50],
  ["sleep_brightness", "Sleep: brightness", "%", 1], ["sleep_kelvin", "Sleep: colour", "K", 50],
  ["sunrise_offset", "Sunrise moved by", "min", 5], ["sunset_offset", "Sunset moved by", "min", 5],
];
const name = (states, eid) => ((states[eid] && states[eid].attributes && states[eid].attributes.friendly_name) || eid);
const pct = (b) => Math.round((Number(b) || 0) / 255 * 100);

/** What the team is doing, in words, and how worrying it is: [text, tone] (tone "ok" | "busy" | "warn" | "off"). */
export function teamStatus(states, teamEid){
  const st = states[teamEid];
  if (!st) return ["This team is not in Home Assistant", "warn"];
  const a = st.attributes || {};
  const bulbs = Array.isArray(a.bulbs) ? a.bulbs : [];
  const missing = Array.isArray(a.missing) ? a.missing : [];
  if (st.state === "unavailable") {
    return [a.power ? "Its wall dimmer is out of Home Assistant's reach, and so are its bulbs" : "Its lights are out of Home Assistant's reach", "warn"];
  }
  if (a.phase === "starting") {
    const answered = bulbs.filter(b => states[b] && states[b].state === "on").length;
    return [`Starting its bulbs… ${answered} of ${bulbs.length} on`, "busy"];
  }
  if (st.state !== "on") {
    const p = a.power ? states[a.power] : null;
    if (p && p.state === "on") return ["Off · the power is on, so it comes on at once", "off"];
    if (p && p.state === "off") return ["Off · the power is off", "off"];
    return ["Off", "off"];
  }
  if (a.phase === "failed" && missing.length) {
    return [`On, but ${missing.length === 1 ? "1 bulb has" : `${missing.length} bulbs have`} not answered`, "warn"];
  }
  if (a.going_off) return ["Going to sleep: fading, then off", "busy"];
  if (a.fading) return [a.waking ? "Waking up: fading in" : a.effect === "Sleep" ? "Going to sleep: fading" : "On · fading", "busy"];
  if (a.waking) return ["On · the wake-up's light", "ok"];
  if (a.effect === "Sleep") return ["On · sleep: dim and warm", "ok"];
  // The day leads the colour (Adaptive) and, unless a brightness was set by hand, the brightness too.
  if (a.follows_the_day) {
    return a.brightness_follows === false
      ? [`On · colour follows the day, brightness set by hand (${pct(a.brightness)}%)`, "ok"]
      : [`On · following the day: ${pct(a.brightness)}%, ${a.color_temp_kelvin || "–"} K`, "ok"];
  }
  if (a.brightness_follows) return ["On · colour set by hand, brightness follows the day", "ok"];
  return ["On · set by hand", "ok"];
}

/** One bulb's state in words: [text, colour of its dot]. */
export function bulbState(states, eid, missing, powerCut){
  const st = states[eid];
  if (!st) return ["not in Home Assistant", "#f87171"];
  if (powerCut) return ["no power", "#475569"];          // a cut bulb goes on showing its last state
  if (st.state === "unavailable") return ["out of reach", "#f87171"];
  if ((missing || []).includes(eid)) return ["not answering", "#fbbf24"];
  if (st.state !== "on") return ["off", "#475569"];
  const a = st.attributes || {};
  const k = Number(a.color_temp_kelvin);
  return [`${pct(a.brightness)}%${k ? `, ${k} K` : ""}`, "#fbbf24"];
}

/** The power source's state in words, and whether it can be cut or put on: {text, tone, canCut, canOn}. */
export function powerState(states, powerEid){
  const st = states[powerEid];
  if (!st) return { text: "not in Home Assistant", tone: "warn", canCut: false, canOn: false };
  if (st.state === "unavailable" || st.state === "unknown") return { text: "out of reach", tone: "warn", canCut: false, canOn: false };
  if (st.state !== "on") return { text: "off: the bulbs have no power", tone: "off", canCut: false, canOn: true };
  const b = st.attributes && st.attributes.brightness;
  const dims = String(powerEid).startsWith("light.") && typeof b === "number";
  if (dims && b < 250) return { text: `on at ${pct(b)}%: PadSpan puts it back to full (the bulbs need it)`, tone: "busy", canCut: true, canOn: false };
  return { text: dims ? "on, full" : "on", tone: "ok", canCut: true, canOn: false };
}

// ── the section ──────────────────────────────────────────────────────────────
/** The team's part of the control card. o: {el, hass, toast, errorText, close, rerender, track(word), lightingPrice (the
 *  Advanced smart lighting add-on's, editions.js), addonsUrl (where to get it; none on a wall)}. Live while the card is open (Home Assistant's state_changed for the
 *  team's own entities). Returns {node, stop}. */
export function teamSection(teamEid, o){
  const { el, hass } = o;
  const toast = o.toast || (() => {});
  // The words a failure shows (ui_error.js errorText, handed in by the Atlas).
  const errorText = o.errorText || ((e) => String((e && (e.message || e.code)) || e));
  const track = o.track || (() => {});
  const states = { ...(hass.states || {}) };
  const members = new Set(teamMembers(states, teamEid));
  const base = ((states[teamEid] || {}).attributes) || {};
  const admin = !!(hass.user && hass.user.is_admin);
  const node = el("div", { "data-team-card": teamEid, style: "margin-top:4px" });
  const live = el("div");
  node.appendChild(live);
  let stored = null, wakeDefault = null, wakeMinutes = [1, 90], limits = {}, nextWake = null;
  let bedDefault = null, bedMinutes = [1, 120], nightDefault = null;
  // Advanced smart lighting here (power_teams_get "lighting": PadSpan Pro, the add-on or a Bright key): the day, Sleep
  // and the wake-up. Without it the team is one light, nothing more (the backend applies none of them).
  let lighting = true;
  const cap = "font-size:11px;color:#94a3b8;margin:12px 0 5px;text-transform:uppercase;letter-spacing:.06em";
  const btn = (primary) => "padding:7px 10px;font-size:12px;font-weight:700;border-radius:9px;cursor:pointer;font-family:inherit;"
    + (primary ? "background:rgba(251,191,36,.14);color:#fbbf24;border:1px solid rgba(251,191,36,.5)"
               : "background:rgba(255,255,255,.04);color:#cbd5e1;border:1px solid rgba(120,190,155,.22)");
  const call = async (domain, service, data, ok) => {
    try { await hass.callService(domain, service, data); if (ok) toast(ok); return true; }
    catch (e) { toast(`That didn't work: ${errorText(e)}`, true); return false; }
  };

  function drawLive(){
    while (live.firstChild) live.removeChild(live.firstChild);
    const st = states[teamEid];
    const a = (st && st.attributes) || {};
    const tone = { ok: "#8ee5b4", busy: "#fbbf24", warn: "#fca5a5", off: "#94a3b8" };
    const [text, t] = teamStatus(states, teamEid);
    live.appendChild(el("div", { "data-team-status": t, style: `font-size:12px;color:${tone[t]};margin:-4px 0 4px;line-height:1.45` }, text));

    // The day: follow it, or sleep. A brightness or colour chosen above stops the day leading until it is next turned
    // on, or until Follow the day is pressed; the wake-up's light stays until then too.
    // Advanced smart lighting's: without it the light offers no effects (power_team.py), and the card none either.
    if (lighting && Array.isArray(a.effect_list) && a.effect_list.length) {
      live.appendChild(el("div", { style: cap }, "The day's light"));
      const following = !!a.follows_the_day, sleeping = a.effect === "Sleep";
      const pick = (effect, word, on) => el("button", {
        "data-team-effect": effect, "aria-pressed": on ? "true" : "false",
        style: btn(on) + ";flex:1",
        onclick: async () => {
          track(effect === "Sleep" ? "team_card:sleep" : "team_card:day");
          if (await call("light", "turn_on", { entity_id: teamEid, effect })) setTimeout(o.rerender || (() => {}), 400);
        },
      }, word);
      live.appendChild(el("div", { style: "display:flex;gap:6px" }, [pick("Adaptive", "Follow the day", following), pick("Sleep", "Sleep", sleeping)]));
      const byHand = st && st.state === "on" && !sleeping && (!following || a.brightness_follows === false);
      if (byHand) {
        live.appendChild(el("div", { style: "font-size:11px;color:#94a3b8;margin-top:5px;line-height:1.45" },
          a.waking ? "The wake-up set this light. Follow the day goes back to the day's now."
            : "Set by hand: the day takes it back at the next turn-on" + (stored && stored.resume ? `, or ${stored.resume} min after the last change` : "")
              + ", or now with Follow the day."));
      }
      // Sleep in 30 min: the team fades to Sleep, then goes off (or stays, as its bedtime says).
      if (st && st.state === "on" && !a.going_off) {
        live.appendChild(el("button", {
          type: "button", "data-team-sleep-now": "1", style: btn(false) + ";width:100%;margin-top:6px",
          onclick: async () => {
            track("team_card:sleep_now");
            const end = stored && stored.bedtime && stored.bedtime.end === "sleep" ? "sleep" : "off";
            try {
              await hass.callWS({ type: "padspan_ha/power_team_sleep", entity_id: teamEid, minutes: 30, end });
              toast(end === "off" ? "Going to sleep: off in 30 minutes" : "Going to sleep: Sleep in 30 minutes");
            } catch (e) { toast(`That didn't work: ${errorText(e)}`, true); }
          },
        }, "Sleep in 30 min"));
      }
    }

    // The power: the wall dimmer or switch the bulbs are fed from. Every state it can be in, and the one thing to do in
    // each: cut it (on), put it on (off: that starts the bulbs and sets them, as the team's own on does), or nothing
    // (out of reach: Home Assistant cannot reach the dimmer; with the power left on the bulbs may still be switched).
    if (a.power) {
      live.appendChild(el("div", { style: cap }, "Power"));
      const p = powerState(states, a.power);
      live.appendChild(el("div", { style: "display:flex;align-items:center;gap:8px;font-size:12px" }, [
        el("span", { style: `width:8px;height:8px;border-radius:50%;flex:none;background:${tone[p.tone]}` }),
        el("span", { style: "flex:1;line-height:1.4" }, [el("b", { style: "font-weight:600;color:#e2e8f0" }, name(states, a.power)), el("br"), p.text]),
        ...(p.canCut ? [el("button", {
          "data-team-power": "cut", style: btn(false),
          onclick: async () => {
            track("team_card:power_cut");
            await call(String(a.power).split(".")[0], "turn_off", { entity_id: a.power }, "Power cut: the bulbs are off at the wall");
          },
        }, "Cut power")] : []),
        ...(p.canOn ? [el("button", {
          "data-team-power": "on", style: btn(true),
          onclick: async () => {
            track("team_card:power_on");
            await call("light", "turn_on", { entity_id: teamEid }, "Power on: the bulbs are starting");
          },
        }, "Power on")] : []),
      ]));
      live.appendChild(el("div", { style: "font-size:11px;color:#94a3b8;margin-top:5px;line-height:1.45" },
        a.turns_off === "bulbs"
          ? "A tap on the map turns the bulbs off and leaves this on, so they come back at once. The wall button cuts it (its second press brings them back)."
          : "A tap on the map cuts this, and the bulbs start again when it is back on."));
    }

    // Each bulb: answering (its brightness and colour), off, out of reach (Home Assistant has lost it), or not answering
    // (on, but it never showed what it was sent). Try again sends it the team's light once more.
    const bulbs = Array.isArray(a.bulbs) ? a.bulbs : [];
    const missing = Array.isArray(a.missing) ? a.missing : [];
    if (bulbs.length) {
      live.appendChild(el("div", { style: cap }, `Bulbs (${bulbs.length})`));
      const list = el("div", { style: "max-height:150px;overflow:auto" });
      for (const b of bulbs) {
        const [words, dot] = bulbState(states, b, missing, !!a.power && !!states[a.power] && states[a.power].state === "off");
        list.appendChild(el("div", { "data-team-bulb": b, style: "display:flex;align-items:center;gap:8px;font-size:12px;padding:2px 0" }, [
          el("span", { style: `width:8px;height:8px;border-radius:50%;flex:none;background:${dot}` }),
          el("span", { style: "flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" }, name(states, b)),
          el("span", { style: "color:#94a3b8" }, words),
        ]));
      }
      live.appendChild(list);
      const unwell = bulbs.filter(b => missing.includes(b) || !states[b] || states[b].state === "unavailable");
      if (unwell.length && st && st.state === "on") {
        live.appendChild(el("div", { style: "display:flex;align-items:center;gap:8px;margin-top:6px" }, [
          el("span", { style: "flex:1;font-size:11px;color:#fbbf24;line-height:1.45" },
            a.power ? "Check it is screwed in and its socket has power; one far from the others may need a bulb or plug between." : "Check it has power and is in reach."),
          el("button", {
            "data-team-retry": "1", style: btn(true),
            onclick: async () => { track("team_card:retry"); await call("light", "turn_on", { entity_id: teamEid }, "Sent again"); },
          }, "Try again"),
        ]));
      }
    }
  }
  drawLive();

  // ── Wake-up and the day's curve: the team's settings, saved with the team (an administrator's) ──
  const settings = el("div");
  node.appendChild(settings);
  // (declared at the top: the live part reads the stored team too)
  const say = el("div", { style: "font-size:11px;color:#94a3b8;margin-top:6px;min-height:14px" });
  // The stored team is the one whose id the light carries (team_id).
  const tid = String(((states[teamEid] || {}).attributes || {}).team_id || "");
  async function load(){
    const r = await hass.callWS({ type: "padspan_ha/power_teams_get" });
    stored = ((r && r.teams) || []).find(t => t.id === tid) || null;
    wakeDefault = (r && r.wake_default) || null; wakeMinutes = (r && r.wake_minutes) || wakeMinutes; limits = (r && r.limits) || {};
    bedDefault = (r && r.bedtime_default) || null; bedMinutes = (r && r.bedtime_minutes) || bedMinutes;
    nightDefault = (r && r.night_default) || null;
    nextWake = (r && r.live && r.live[tid] && r.live[tid].next_wake) || null;    // [day, "HH:MM"]
    lighting = !(r && r.lighting === false);
    return r;
  }
  async function save(change, word, done){
    try {
      const r = await hass.callWS({ type: "padspan_ha/power_teams_get" });      // fresh: someone may have saved since
      const teams = JSON.parse(JSON.stringify((r && r.teams) || []));
      const t = teams.find(x => x.id === tid);
      if (!t) { say.textContent = "This team was changed elsewhere: close the card and open it again."; return; }
      change(t);
      const back = await hass.callWS({ type: "padspan_ha/power_teams_set", teams });
      track(word);
      // Its own section drawn again from what was saved (the next wake-up, a skip, its title), and the live part
      // (it says how long a change by hand is kept).
      stored = ((back && back.teams) || teams).find(x => x.id === tid) || stored;
      if (back && back.live && back.live[tid]) nextWake = back.live[tid].next_wake || null;
      redraw(word.includes("wake") ? "wake" : word.includes("bedtime") ? "bedtime" : word.includes("night") ? "night" : "advanced");
      drawLive();
      say.style.color = "#8ee5b4"; say.textContent = done;
    } catch (e) { say.style.color = "#fca5a5"; say.textContent = "Could not save: " + errorText(e); }
  }
  const fold = (title, key) => {
    const d = el("details", { "data-team-fold": key, style: "margin-top:12px;border-top:1px solid rgba(120,190,155,.14);padding-top:8px" });
    d.appendChild(el("summary", { style: "cursor:pointer;font-size:12px;font-weight:700;color:#cbd5e1" }, title));
    return d;
  };
  // Each field's value is set as the field's own (an attribute is only its starting value, and not every page reads it).
  const field = (attrs, value) => { const n = el("input", attrs); n.value = String(value ?? ""); return n; };
  const numIn = (value, lo, hi, step, w = 70) => field({ type: "number", min: String(lo), max: String(hi), step: String(step),
    style: `width:${w}px;background:#1a2e1e;color:#e2e8f0;border:1px solid #2d4a36;border-radius:6px;padding:4px;font-size:12px;font-family:inherit` }, value);
  const timeIn = (value, data) => field({ type: "time", ...data,
    style: "background:#1a2e1e;color:#e2e8f0;border:1px solid #2d4a36;border-radius:6px;padding:3px;font-size:12px;font-family:inherit" }, value);
  const row = (label, ...nodes) => el("label", { style: "display:flex;align-items:center;justify-content:space-between;gap:8px;font-size:12px;color:#cbd5e1;margin-top:6px" },
    [el("span", {}, label), el("span", { style: "display:flex;align-items:center;gap:4px" }, nodes)]);

  // A row of day buttons (Monday 0), pressed for each day in `on` (a Set it changes).
  const daysPicker = (on, attr) => {
    const box = el("div", { style: "display:flex;gap:3px;flex-wrap:wrap;margin-top:6px" });
    DAYS.forEach((d, i) => {
      const b = el("button", { type: "button", [attr]: String(i), "aria-pressed": on.has(i) ? "true" : "false" }, d);
      const paint = () => b.setAttribute("style", btn(on.has(i)) + ";padding:4px 6px;font-size:11px;min-width:34px");
      paint();
      b.addEventListener("click", () => { if (on.has(i)) on.delete(i); else on.add(i); b.setAttribute("aria-pressed", on.has(i) ? "true" : "false"); paint(); });
      box.appendChild(b);
    });
    return box;
  };
  const selectOf = (pairs, value, data) => {
    const sel = el("select", { ...data, style: "background:#1a2e1e;color:#e2e8f0;border:1px solid #2d4a36;border-radius:6px;padding:4px;font-size:12px;font-family:inherit;max-width:170px" });
    for (const [v, words] of pairs) sel.appendChild(el("option", { value: String(v) }, words));
    sel.value = String(value);
    return sel;
  };
  const note = (text) => el("div", { style: "font-size:11px;color:#94a3b8;margin-top:6px;line-height:1.45" }, text);
  const dayName = (iso) => { const d = new Date(`${iso}T12:00:00`); return isNaN(d) ? iso : DAYS[(d.getDay() + 6) % 7]; };

  // Each section is built by itself, so a save draws again only its own: what was typed and not yet saved in another
  // stays as it is.
  const ro = !admin;
  const keepOpen = (d) => d;
  const nodes = {};
  const isOpen = (d) => !!d && (d.open === true || (d.getAttribute && d.getAttribute("open") !== null));
  function buildWake(){
    if (!lighting) return null;

    // The morning alarm: on its days, a team that is off comes on at its dimmest and warmest `minutes` before the time
    // and fades to the brightness and colour by then. A team already on is left alone (someone is up).
    const w = { ...(wakeDefault || {}), ...(stored.wake || {}) };
    const skipped = !!(nextWake && w.skip && w.skip === nextWake[0]);
    const wake = keepOpen(fold(w.on ? `Wake-up: ${w.time}${w.weekend_time ? `, weekends ${w.weekend_time}` : ""}, ${(w.days || []).map(d => DAYS[d]).join(" ") || "no days"}`
      + (nextWake ? ` · next ${dayName(nextWake[0])} ${nextWake[1]}${skipped ? " (skipped)" : ""}` : "") : "Wake-up: off", "wake"));
    const onBox = el("input", { type: "checkbox", "data-wake": "on" }); onBox.checked = !!w.on;
    const time = timeIn(w.time || "06:30", { "data-wake": "time" });
    const weekend = timeIn(w.weekend_time || "", { "data-wake": "weekend_time" });
    const dayOn = new Set(w.days || []);
    const mins = numIn(w.minutes ?? 30, wakeMinutes[0], wakeMinutes[1], 5);
    const wBri = numIn(w.brightness ?? 100, 1, 100, 5);
    const wK = numIn(w.kelvin ?? 4000, 1500, 9000, 100, 80);
    const backAfter = numIn(w.back_after ?? 60, 0, 720, 15);
    backAfter.setAttribute("data-wake", "back_after");
    wake.appendChild(row("On", onBox));
    wake.appendChild(row("Full light at", time));
    wake.appendChild(row("Saturday and Sunday at (empty: the same)", weekend));
    wake.appendChild(daysPicker(dayOn, "data-wake-day"));
    wake.appendChild(row("Fading in over", mins, "min"));
    wake.appendChild(row("Ends at", wBri, "%", wK, "K"));
    wake.appendChild(row("Then back to the day after (0: until off)", backAfter, "min"));
    wake.appendChild(note("It starts at its dimmest and warmest and is at full light by the time. If the lights are on, it leaves them alone; left on in Sleep, it wakes them from there."
      + (stored.off === "power" && stored.power ? " This team cuts its power when off, so its bulbs start up first (a moment at their start-up light)." : "")));
    if (!ro) {
      // Saved whole: what the card does not show (a skipped morning) is kept.
      wake.appendChild(el("button", {
        type: "button", "data-wake-save": "1", style: btn(true) + ";margin-top:8px;width:100%",
        onclick: () => save((t) => {
          t.wake = { ...(t.wake || {}), on: onBox.checked, time: time.value || "06:30", weekend_time: weekend.value || "", days: [...dayOn].sort(),
            minutes: Number(mins.value), brightness: Number(wBri.value), kelvin: Number(wK.value), back_after: Number(backAfter.value) };
        }, "team_card:wake_saved", onBox.checked ? `Saved: full light at ${time.value || "06:30"}` : "Saved: the wake-up is off"),
      }, "Save the wake-up"));
      if (w.on && nextWake) {
        wake.appendChild(el("button", {
          type: "button", "data-wake-skip": skipped ? "undo" : "skip", style: btn(false) + ";margin-top:6px;width:100%",
          onclick: () => save((t) => { t.wake = { ...(t.wake || {}), skip: skipped ? "" : nextWake[0] }; },
            "team_card:wake_skip", skipped ? `${dayName(nextWake[0])} wakes as usual` : `${dayName(nextWake[0])} ${nextWake[1]} skipped`),
        }, skipped ? `Don't skip ${dayName(nextWake[0])}` : `Skip ${dayName(nextWake[0])} ${nextWake[1]}`));
      }
    }
    return wake;
  }
  function buildBedtime(){
    if (stored.adaptive === false || !lighting) return null;
    // Bedtime: on its days at its time, a lit team fades to Sleep (warming as it dims), then off or stays in Sleep.
    // Only with the day's curve (Sleep is one of its looks).
      const b = { ...(bedDefault || {}), ...(stored.bedtime || {}) };
      const bed = keepOpen(fold(b.on ? `Bedtime: ${b.time}, ${(b.days || []).map(d => DAYS[d]).join(" ") || "no days"}` : "Bedtime: off", "bedtime"));
      const bOn = el("input", { type: "checkbox", "data-bed": "on" }); bOn.checked = !!b.on;
      const bTime = timeIn(b.time || "22:30", { "data-bed": "time" });
      const bDays = new Set(b.days || []);
      const bMins = numIn(b.minutes ?? 30, bedMinutes[0], bedMinutes[1], 5);
      bMins.setAttribute("data-bed", "minutes");
      const bEnd = selectOf([["off", "Then off"], ["sleep", "Then stay in Sleep"]], b.end === "sleep" ? "sleep" : "off", { "data-bed": "end" });
      bed.appendChild(row("On", bOn));
      bed.appendChild(row("Starts at", bTime));
      bed.appendChild(daysPicker(bDays, "data-bed-day"));
      bed.appendChild(row("Fading over", bMins, "min"));
      bed.appendChild(row("At the end", bEnd));
      bed.appendChild(note("A team that is on fades to Sleep, warmer as it dims. One that is off is left off."
        + (stored.power && stored.off === "power" ? " Off here cuts the power, as the team's own off does." : "")));
      if (!ro) {
        bed.appendChild(el("button", {
          type: "button", "data-bed-save": "1", style: btn(true) + ";margin-top:8px;width:100%",
          onclick: () => save((t) => {
            t.bedtime = { ...(t.bedtime || {}), on: bOn.checked, time: bTime.value || "22:30", days: [...bDays].sort(), minutes: Number(bMins.value), end: bEnd.value };
          }, "team_card:bedtime_saved", bOn.checked ? `Saved: bedtime at ${bTime.value || "22:30"}` : "Saved: no bedtime"),
        }, "Save the bedtime"));
      }
      return bed;
  }
  function buildNight(){
    if (stored.adaptive === false || !lighting) return null;
      // The night light: switched on between these hours (the wall, a tap, an automation), it comes on in Sleep.
      const n = { ...(nightDefault || {}), ...(stored.night || {}) };
      const night = keepOpen(fold(n.on ? `Night light: ${n.from} to ${n.to}` : "Night light: off", "night"));
      const nOn = el("input", { type: "checkbox", "data-night": "on" }); nOn.checked = !!n.on;
      const nFrom = timeIn(n.from || "23:00", { "data-night": "from" });
      const nTo = timeIn(n.to || "06:00", { "data-night": "to" });
      night.appendChild(row("On", nOn));
      night.appendChild(row("From", nFrom));
      night.appendChild(row("To", nTo));
      night.appendChild(note("Turned on in these hours with no brightness asked for, it comes on dim and warm (Sleep), not at the day's light. A brightness asked for is given."));
      if (!ro) {
        night.appendChild(el("button", {
          type: "button", "data-night-save": "1", style: btn(true) + ";margin-top:8px;width:100%",
          onclick: () => save((t) => { t.night = { on: nOn.checked, from: nFrom.value || "23:00", to: nTo.value || "06:00" }; },
            "team_card:night_saved", nOn.checked ? `Saved: night light ${nFrom.value || "23:00"} to ${nTo.value || "06:00"}` : "Saved: no night light"),
        }, "Save the night light"));
      }
      return night;
  }
  function buildAdvanced(){
    if (!lighting) return null;                          // changing a team is Advanced smart lighting's (its off too)
    const day = stored.adaptive !== false;
    if (!(day || stored.power)) return null;
    // The day's curve (adapted from Adaptive Lighting, with credit: THIRD_PARTY_NOTICES.md): its brightness and colour
    // at noon, at the horizon and at midnight, sleep's, and when this light's day starts and ends (the sun's sunrise
    // and sunset moved by minutes, or fixed times). And what a tap's off does.
      const adv = keepOpen(fold(day ? "Advanced: the day's curve" + (stored.power ? " and the power" : "") : "Advanced: the power", "advanced"));
      const c = stored.curve || {};
      const inputs = {}, times = {};
      if (day) {
        for (const [key, words, unit, step] of CURVE_ROWS) {
          const [lo, hi] = limits[key] || (unit === "K" ? [1500, 9000] : unit === "min" ? [-180, 180] : [1, 100]);
          inputs[key] = numIn(c[key] ?? 0, lo, hi, step);
          inputs[key].setAttribute("data-curve", key);
          adv.appendChild(row(words, inputs[key], unit));
        }
        for (const [key, words] of [["sunrise_time", "Day starts at a fixed time"], ["sunset_time", "Day ends at a fixed time"]]) {
          times[key] = timeIn(c[key] || "", { "data-curve": key });
          adv.appendChild(row(words, times[key]));
        }
        for (const [key, words] of [["min_sunrise_time", "Sunrise no earlier than"], ["max_sunrise_time", "Sunrise no later than"],
                                    ["min_sunset_time", "Sunset no earlier than"], ["max_sunset_time", "Sunset no later than"]]) {
          times[key] = timeIn(c[key] || "", { "data-curve": key });
          adv.appendChild(row(words, times[key]));
        }
        adv.appendChild(note("Empty times follow the sun. A fixed start suits a bedroom: the day's light from the same time all year. "
          + "The limits keep the sun's own times but hold them in: a summer dawn at five need not light the room before half past six."));
      }
      let resumeSel = null;
      if (day) {
        const r = Number(stored.resume) || 0;
        const choices = [[0, "At the next turn-on"], [30, "After 30 min"], [60, "After 1 hour"], [120, "After 2 hours"], [240, "After 4 hours"], [480, "After 8 hours"]];
        if (!choices.some(([v]) => v === r)) choices.push([r, `After ${r} min`]);
        resumeSel = selectOf(choices, r, { "data-team-resume": "1" });
        adv.appendChild(row("Set by hand: the day takes it back", resumeSel));
      }
      let offSel = null;
      if (stored.power) {
        offSel = el("select", { "data-team-off": "1",
          style: "background:#1a2e1e;color:#e2e8f0;border:1px solid #2d4a36;border-radius:6px;padding:4px;font-size:12px;font-family:inherit;max-width:170px" });
        offSel.appendChild(el("option", { value: "bulbs" }, "Turns the bulbs off (power stays on)"));
        offSel.appendChild(el("option", { value: "power" }, "Cuts the power"));
        offSel.value = stored.off === "bulbs" ? "bulbs" : "power";
        adv.appendChild(row("A tap's off", offSel));
      }
      if (!ro) {
        adv.appendChild(el("button", {
          type: "button", "data-curve-save": "1", style: btn(true) + ";margin-top:8px;width:100%",
          onclick: () => save((t) => {
            const nc = { ...(t.curve || {}) };
            for (const [key, inp] of Object.entries(inputs)) nc[key] = Number(inp.value);
            for (const [key, inp] of Object.entries(times)) nc[key] = inp.value || "";
            t.curve = nc;
            if (offSel) t.off = offSel.value;
            if (resumeSel) t.resume = Number(resumeSel.value);
          }, offSel && offSel.value !== stored.off ? "team_card:off_mode_saved" : "team_card:curve_saved", "Saved"),
        }, "Save"));
      }
      return adv;
  }
  const BUILD = [["wake", buildWake], ["bedtime", buildBedtime], ["night", buildNight], ["advanced", buildAdvanced]];
  function drawSettings(){
    while (settings.firstChild) settings.removeChild(settings.firstChild);
    if (!stored) return;
    for (const [k, build] of BUILD) {
      const n = build();
      if (n) { nodes[k] = n; settings.appendChild(n); } else delete nodes[k];
    }
    if (!lighting) settings.appendChild(el("div", { "data-team-lighting": "locked", style: "font-size:11px;color:#94a3b8;margin-top:10px;line-height:1.45" },
      "Power teams are part of the Advanced smart lighting add-on" + (o.lightingPrice ? ` (${o.lightingPrice})` : "")
        + ", with PadSpan Pro: following the day, Sleep, the bedtime, the night light, the wake-up and changing a team. Without it this team"
        + " keeps switching as one light: on, off, dimming, its power and each bulb."));
    if (!lighting && o.addonsUrl) settings.appendChild(el("a", { "data-team-lighting": "offer", href: o.addonsUrl, target: "_blank", rel: "noopener",
      style: "display:inline-block;margin-top:6px;font-size:12px;font-weight:700;color:#fbbf24" }, "Get Advanced smart lighting"));
    else if (ro) settings.appendChild(el("div", { style: "font-size:11px;color:#94a3b8;margin-top:8px" }, "An administrator changes the wake-up, the bedtime, the night light and the curve."));
    settings.appendChild(say);
  }
  /** Draw one section again from what was saved, open if it was open. */
  function redraw(key){
    const old = nodes[key], build = (BUILD.find(([k]) => k === key) || [])[1];
    if (!old || !build || old.parentNode !== settings) { drawSettings(); return; }
    const n = build();
    if (!n) return;
    if (isOpen(old)) n.setAttribute("open", "");
    settings.replaceChild(n, old);
    nodes[key] = n;
  }
  if (tid) Promise.resolve().then(load).then(() => { drawSettings(); drawLive(); }, () => { /* no teams read: the card works without its settings */ });

  // Live: the team's own entities as Home Assistant changes them.
  let unsub = null, stopped = false, queued = false;
  const conn = hass.connection;
  if (conn && typeof conn.subscribeEvents === "function") {
    conn.subscribeEvents((ev) => {
      const d = ev && ev.data;
      if (!d || !members.has(d.entity_id)) return;
      if (d.new_state) {
        const ns = d.new_state;
        // Out of reach, Home Assistant drops a light's attributes: the team's power and bulbs stay as they were.
        states[d.entity_id] = d.entity_id === teamEid && !(ns.attributes && ns.attributes.bulbs)
          ? { ...ns, attributes: { ...(ns.attributes || {}), power: base.power, bulbs: base.bulbs, team_id: base.team_id } } : ns;
      } else delete states[d.entity_id];
      if (queued) return;
      queued = true;
      setTimeout(() => { queued = false; if (!stopped) drawLive(); }, 150);
    }, "state_changed").then((u) => { if (stopped) u(); else unsub = u; }, () => {});
  }
  const stop = () => { stopped = true; if (unsub) { try { unsub(); } catch (_) { /* gone with the connection */ } unsub = null; } };
  track("team_card:opened");
  return { node, stop };
}
