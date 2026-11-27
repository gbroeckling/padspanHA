// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
// See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
//
// Settings → Tracking → Home Assistant and integrations → Lights follow people
// (lights_follow.py, free, off by default). Beside the arrive/depart
// Automations: the switch, each room's lights and options, and who counts.
// Every change is saved at once through settings_set (the server keeps only
// what it can use: lights_follow.clean_rooms / clean_people); a room is saved
// once it has a light. What each room holds now comes from
// padspan_ha/lights_follow_get. settings.js hands in its ctx and el.

const { t, tn } = await import(`./i18n.js${new URL(import.meta.url).search}`);

export const DELAYS = [30, 60, 120, 300, 600, 900, 1800, 3600];
const SENSOR_CLASSES = new Set(["motion", "occupancy", "presence"]);
const MANUAL_URL = "https://padspan.traks.ca/manual/home-assistant-reference/#lights-follow-people";

/** Words for an off delay in seconds. */
export function delayWords(s){
  if (s < 60) return t("{n} s", { n: s });
  if (s < 3600) return tn(s / 60, "1 min", "{n} min");
  return tn(s / 3600, "1 hour", "{n} hours");
}

/** What can be picked, from the states: lights and switches, light sensors, motion/occupancy/presence sensors. */
export function choices(states){
  const out = { lights: [], lux: [], sensors: [] };
  for (const eid of Object.keys(states || {}).sort()) {
    const a = (states[eid] && states[eid].attributes) || {};
    const row = [eid, a.friendly_name || eid];
    if (eid.startsWith("light.") || eid.startsWith("switch.")) out.lights.push(row);
    else if (eid.startsWith("sensor.") && (a.device_class === "illuminance" || a.unit_of_measurement === "lx")) out.lux.push(row);
    else if (eid.startsWith("binary_sensor.") && SENSOR_CLASSES.has(a.device_class)) out.sensors.push(row);
  }
  return out;
}

/** A newly added room: its Home Assistant area's lights and motion sensors, the rest as the server's defaults. */
export function newRoom(name, info){
  const lights = ((info && info.area_lights) || {})[name] || [];
  const sensors = ((info && info.area_sensors) || {})[name] || [];
  return { lights: lights.slice(0, 24), off_delay_s: 120, dark: "", lux_entity: "", lux_below: 50, quiet: "", sensors: sensors.slice(0, 8) };
}

/** The rooms as saved: only those with a light (the server drops the rest). */
export function savedRooms(rooms){
  const out = {};
  for (const [name, r] of Object.entries(rooms || {})) if (r && (r.lights || []).length) out[name] = r;
  return out;
}

export function lightsFollowSection(ctx, el){
  const settings = ctx.state.settings || {};
  const card = el("div", { class: "card", "data-focus-part": "lights_follow" });   // a feature tip's Show me lands here (views/tips.js)
  let info = null;                                   // padspan_ha/lights_follow_get
  let rooms = JSON.parse(JSON.stringify(settings.lights_follow_rooms || {}));
  let people = Object.assign({}, settings.lights_follow_people || {});
  const states = (ctx.hass && ctx.hass.states) || {};
  const pick = choices(states);
  const nameOf = (eid) => (states[eid] && states[eid].attributes && states[eid].attributes.friendly_name) || eid;

  const save = async (patch, word) => {
    try {
      await ctx.actions.settingsSet(patch);
      ctx.state.settings = Object.assign({}, ctx.state.settings, patch);
      if (word) ctx.toast(word);
      return true;
    } catch (e) {
      ctx.toast(t("Failed to save: {error}", { error: ctx.helpers.errorText(e) }), true);
      return false;
    }
  };
  const saveRooms = () => save({ lights_follow_rooms: savedRooms(rooms) }, t("Saved"));

  const select = (options, value, attrs) => {
    const s = el("select", Object.assign({ class: "select", style: "width:auto;max-width:260px" }, attrs || {}));
    for (const [v, label] of options) s.appendChild(el("option", { value: v }, label));
    s.value = value;
    return s;
  };
  const chips = (ids, onRemove, attr) => el("div", { style: "display:flex;flex-wrap:wrap;gap:6px" }, ids.map(eid => {
    const x = el("button", { class: "btn inline", [attr]: eid, title: t("Remove {name}", { name: nameOf(eid) }) }, "×");
    x.addEventListener("click", () => onRemove(eid));
    return el("span", { class: "badge", title: eid, style: "display:inline-flex;align-items:center;gap:4px" }, [nameOf(eid), x]);
  }));
  const row = (label, ...kids) => el("div", { style: "display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin:6px 0" },
    [el("span", { style: "font-size:12px;color:#94a3b8;min-width:150px" }, label), ...kids]);

  function roomBlock(name){
    const r = rooms[name];
    const now = info && info.now && info.now[name];
    const box = el("div", { "data-room": name, style: "border:1px solid #2d4a38;border-radius:8px;padding:10px;margin:8px 0" });
    const remove = el("button", { class: "btn inline", "data-remove": name }, t("Remove"));
    remove.addEventListener("click", async () => { delete rooms[name]; draw(); await saveRooms(); });
    box.appendChild(el("div", { style: "display:flex;align-items:center;gap:8px" }, [
      el("div", { style: "font-weight:600;color:#e2e8f0;flex:1" }, name), remove]));
    if (now) {
      const who = (now.people || []).length ? t("Now: {people}", { people: now.people.join(", ") }) : t("Now: nobody");
      box.appendChild(el("div", { class: "muted", style: "font-size:12px" },
        now.held ? who + " · " + t("turned off by hand: stays off until everyone has left the room") : who));
    }
    // Lights
    const addLight = select([["", t("Add a light…")], ...pick.lights.filter(([e]) => !r.lights.includes(e)).map(([e, n]) => [e, n])], "", { "data-add-light": name });
    addLight.addEventListener("change", async () => {
      if (!addLight.value) return;
      r.lights.push(addLight.value); draw(); await saveRooms();
    });
    box.appendChild(row(t("Lights"), chips(r.lights, async (eid) => {
      r.lights = r.lights.filter(x => x !== eid); draw(); await saveRooms();
    }, "data-light"), addLight));
    if (!r.lights.length) box.appendChild(el("div", { class: "muted", style: "font-size:12px;color:#fbbf24" }, t("Pick a light: a room is saved once it has one.")));
    // Off delay
    const delay = select(DELAYS.map(s => [String(s), delayWords(s)]), String(r.off_delay_s ?? 120), { "data-delay": name });
    delay.addEventListener("change", async () => { r.off_delay_s = parseInt(delay.value, 10); await saveRooms(); });
    box.appendChild(row(t("Off once empty for"), delay));
    // Only when dark
    const dark = select([["", t("Always")], ["sun", t("Only when the sun is down")], ["lux", t("Only when a light sensor reads below")]],
      r.dark || "", { "data-dark": name });
    const darkKids = [dark];
    if (r.dark === "lux") {
      const lux = select([["", t("Choose a light sensor…")], ...pick.lux], r.lux_entity || "", { "data-lux": name });
      lux.addEventListener("change", async () => { r.lux_entity = lux.value; await saveRooms(); });
      const below = el("input", { type: "number", min: "0", max: "100000", step: "1", class: "select", style: "width:90px", "data-lux-below": name });
      below.value = String(r.lux_below ?? 50);
      below.addEventListener("change", async () => { r.lux_below = Number(below.value) || 0; await saveRooms(); });
      darkKids.push(lux, below, el("span", { class: "muted" }, "lx"));
    }
    dark.addEventListener("change", async () => {
      r.dark = dark.value;
      draw();
      if (r.dark !== "lux" || r.lux_entity) await saveRooms();
    });
    box.appendChild(row(t("Turn on"), ...darkKids));
    // Quiet hours
    const [qa, qb] = String(r.quiet || "").split("-");
    const qFrom = el("input", { type: "time", class: "select", style: "width:auto", "data-quiet-from": name });
    const qTo = el("input", { type: "time", class: "select", style: "width:auto", "data-quiet-to": name });
    qFrom.value = qa || ""; qTo.value = qb || "";
    const quietChanged = async () => {
      const q = qFrom.value && qTo.value ? `${qFrom.value}-${qTo.value}` : "";
      if (q === (r.quiet || "") || (!q && (qFrom.value || qTo.value))) return;   // half a range: wait for the other end
      r.quiet = q; await saveRooms();
    };
    qFrom.addEventListener("change", quietChanged); qTo.addEventListener("change", quietChanged);
    box.appendChild(row(t("Quiet hours (nothing turns on)"), qFrom, el("span", { class: "muted" }, "–"), qTo));
    // Motion sensors
    const addSensor = select([["", t("Add a motion or occupancy sensor…")], ...pick.sensors.filter(([e]) => !(r.sensors || []).includes(e))],
      "", { "data-add-sensor": name });
    addSensor.addEventListener("change", async () => {
      if (!addSensor.value) return;
      r.sensors = [...(r.sensors || []), addSensor.value]; draw(); await saveRooms();
    });
    box.appendChild(row(t("Sensors"), chips(r.sensors || [], async (eid) => {
      r.sensors = (r.sensors || []).filter(x => x !== eid); draw(); await saveRooms();
    }, "data-sensor"), addSensor));
    box.appendChild(el("div", { class: "muted", style: "font-size:11px" },
      t("A motion or occupancy sensor in the room turns its lights on as soon as it sees someone PadSpan is moving into the room, without waiting for Room Change Delay.")));
    return box;
  }

  function peopleBlock(){
    const list = (info && info.people) || [];
    const box = el("div", { style: "margin-top:12px" }, [
      el("div", { style: "font-weight:600;color:#e2e8f0;margin-bottom:4px" }, t("People")),
      el("div", { class: "muted", style: "font-size:12px;margin-bottom:6px" },
        t("Everyone you have named counts, except guest tags. A tag that stays put (keys, a bag) keeps its room's lights on: untick it.")),
    ]);
    if (!list.length) box.appendChild(el("div", { class: "muted", style: "font-size:12px;font-style:italic" }, t("No named phones, watches or tags yet.")));
    for (const p of list) {
      const key = String(p.name).trim().toLowerCase();
      const cb = el("input", { type: "checkbox", "data-person": key, style: "width:16px;height:16px;cursor:pointer" });
      cb.checked = key in people ? people[key] === true : !p.guest;
      cb.addEventListener("change", async () => {
        people[key] = cb.checked;
        if (!await save({ lights_follow_people: people }, t("Saved"))) cb.checked = !cb.checked;
      });
      box.appendChild(el("label", { style: "display:flex;align-items:center;gap:8px;font-size:13px;color:#e2e8f0;margin:3px 0" },
        [cb, p.name, p.guest ? el("span", { class: "badge warn" }, t("guest tag")) : null].filter(Boolean)));
    }
    return box;
  }

  function draw(){
    card.replaceChildren();
    const on = ctx.state.settings && ctx.state.settings.lights_follow_enabled === true;
    const toggle = el("input", { type: "checkbox", "data-lf-on": "", style: "width:16px;height:16px;accent-color:#52b788;cursor:pointer" });
    toggle.checked = on;
    toggle.addEventListener("change", async () => {
      if (await save({ lights_follow_enabled: toggle.checked }, toggle.checked ? t("Lights follow people: on") : t("Lights follow people: off"))) {
        draw(); refresh();
      } else toggle.checked = !toggle.checked;
    });
    card.appendChild(el("div", { class: "h2", style: "margin-bottom:4px" }, t("Lights follow people")));
    card.appendChild(el("label", { style: "display:flex;align-items:center;gap:8px;margin-bottom:6px;font-size:13px;color:#e2e8f0;cursor:pointer" },
      [toggle, t("Turn room lights on and off as people move")]));
    card.appendChild(el("div", { class: "muted", style: "font-size:12px;margin-bottom:8px;line-height:1.5" },
      t("When someone with a named phone, watch or tag comes into a room, its lights go on. Once nobody has been in the room for the time you set, they go off. A light someone turns off by hand while they are in the room stays off until everyone has left and someone comes back. Off: nothing is switched.")));
    if (!on) return;
    const names = Object.keys(rooms).sort((a, b) => a.localeCompare(b));
    if (!names.length) card.appendChild(el("div", { class: "muted", style: "font-size:12px;font-style:italic" }, t("No room yet.")));
    for (const n of names) card.appendChild(roomBlock(n));
    const free = ((info && info.room_names) || []).filter(n => !(n in rooms));
    const add = select([["", t("Add a room…")], ...free.map(n => [n, n])], "", { "data-add-room": "" });
    add.addEventListener("change", async () => {
      const n = add.value;
      if (!n) return;
      rooms[n] = newRoom(n, info);
      draw();
      if (rooms[n].lights.length) await saveRooms();
    });
    card.appendChild(add);
    card.appendChild(peopleBlock());
    const more = el("a", { href: MANUAL_URL, target: "_blank", rel: "noopener" }, t("Blueprints for your own automations"));
    card.appendChild(el("div", { class: "muted", style: "font-size:12px;margin-top:10px" }, [t("Rather write your own?") + " ", more]));
  }

  async function refresh(){
    if (!(ctx.state.settings && ctx.state.settings.lights_follow_enabled === true)) return;
    try {
      const r = await ctx.actions.wsCall("padspan_ha/lights_follow_get", {});
      info = (r && typeof r === "object") ? r : null;
    } catch (_) { info = null; }
    draw();
  }

  draw();
  refresh();
  return card;
}
