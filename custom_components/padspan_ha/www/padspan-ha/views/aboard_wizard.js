// PadSpan HA — Live Aboard setup wizard (Pro)
//
// Builds the Sims-style house from scratch, one step at a time, from what the
// house already has: turn it on, floor heights, rooms, devices on the Atlas,
// heights, doors and windows, LED strips, furniture, the optional extras,
// and making it the screen you look at. Each step says what it found (from
// the model, Home Assistant's states and Live Aboard's own file), sets what
// can be set right here (the same settings and calls as Settings and
// Mapping), and sends you to the tool for the rest.
//
// survey() and the step checks are pure, for tests (tests/js/aboard_wizard.mjs).

const { tierAtLeast, surfacesForEdition } = await import(`./editions.js${new URL(import.meta.url).search}`);

export const GUIDE_URL = "https://github.com/gbroeckling/padspanHA/blob/main/docs/LIVE_ABOARD_GUIDE.md";

export const STEPS = [
  { id: "on",        title: "Turn it on" },
  { id: "floors",    title: "Floor heights" },
  { id: "rooms",     title: "Rooms" },
  { id: "devices",   title: "Devices on the Atlas" },
  { id: "heights",   title: "Heights" },
  { id: "openings",  title: "Doors and windows" },
  { id: "strips",    title: "LED strips" },
  { id: "furniture", title: "Furniture" },
  { id: "extras",    title: "The extras" },
  { id: "screen",    title: "Make it your screen" },
];

const DOOR_CLASSES = ["door", "window", "garage_door", "opening"];
// What a strip is called; a status or indicator LED on some gadget is not one.
const STRIP_WORDS = /(^|[^a-z])(strip|lightstrip|valance|cove|under_?cab(inet)?|cabinet|kick|toe_?kick|segment|quinled)([^a-z0-9]|\d|$)/;
const NOT_STRIP = /status|indicator|controller|control4|power_?led|button/;
const STRIP_KINDS = new Set(["strip", "valance", "undercab", "kick", "tv"]);

/** What the house has, for every step. All inputs plain data:
 *  settings (settings_get), model (model_get), states ({entity_id: state}),
 *  house (house3d_get's data), webgl (bool | null = not checked). */
export function survey({ settings = {}, model = {}, states = {}, house = null, webgl = null } = {}) {
  const floors = (model.floors || []).filter(f => f && f.id && f.id !== "outside" && f.id !== "__outside__");
  const floorIds = new Set(floors.map(f => f.id));
  // Rooms on the house's floors (Outside's yard areas aren't part of the house).
  const rooms = Object.fromEntries(Object.entries(model.room_geometry_m || {})
    .filter(([, r]) => floorIds.has((r && r.floor_id) || "main")));
  const roomsByFloor = {};
  for (const r of Object.values(rooms)) {
    const fid = (r && r.floor_id) || "main";
    roomsByFloor[fid] = (roomsByFloor[fid] || 0) + 1;
  }
  const placed = model.light_positions_m || {};
  const placedIds = Object.keys(placed);
  const st = (id) => states[id] || null;
  const dc = (id) => (st(id) && st(id).attributes && st(id).attributes.device_class) || null;
  const all = Object.keys(states);
  const lights = all.filter(e => e.startsWith("light."));
  const doorSensors = all.filter(e => e.startsWith("binary_sensor.") && DOOR_CLASSES.includes(dc(e)));
  const h = (house && house.data) || house || {};
  const openings = h.openings || {};
  const linked = new Set();
  for (const b of model.rf_barriers_m || []) if (b && b.linked_entity_id) linked.add(b.linked_entity_id);
  for (const o of Object.values(openings)) if (o && typeof o.link === "string" && o.link) linked.add(o.link);
  const drawn = Object.keys(openings).filter(k => /^(win|door|doorway)_/.test(k));
  const runs = h.lights || {};
  const isStripLike = (id) => {
    const k = runs[id] && runs[id].kind;
    if (k) return STRIP_KINDS.has(k);
    const a = (st(id) && st(id).attributes) || {};
    const words = (id + " " + String(a.friendly_name || "")).toLowerCase().replace(/[\s-]+/g, "_");
    return !NOT_STRIP.test(words) && STRIP_WORDS.test(words);
  };
  const placedLights = placedIds.filter(e => e.startsWith("light."));
  const strips = placedLights.filter(isStripLike);
  const withRun = strips.filter(e => runs[e] && Array.isArray(runs[e].run) && runs[e].run.length > 1);
  const heightSet = placedIds.filter(e => placed[e] && placed[e].z_m != null).length
    + Object.values(h.devices || {}).filter(d => d && d.z_m != null).length;
  const temps = all.filter(e => e.startsWith("sensor.") && dc(e) === "temperature");
  const motion = all.filter(e => e.startsWith("binary_sensor.") && ["motion", "occupancy", "presence"].includes(dc(e)));
  const pieces = Object.keys(h.pieces || {}).length;
  return {
    pro: tierAtLeast(settings.tier, "pro"),
    on: settings.atlas_3d_enabled === true,
    webgl,
    overviewAtlas: settings.overview_atlas === true,
    // Bright hides Overview (a presence surface) unless presence is revealed:
    // no Overview, no "Show the Atlas as Overview".
    hasOverview: surfacesForEdition(["overview"], settings).length > 0,
    floors: floors.map(f => ({ id: f.id, name: f.name || f.id, f2f: f.floor_to_floor_m ?? null, base: f.base_elevation_m ?? null,
                                rooms: roomsByFloor[f.id] || 0 })),
    rooms: Object.keys(rooms).length,
    placed: placedIds.length,
    placedLights: placedLights.length,
    lights: lights.length,
    heightSet,
    doorSensors: doorSensors.map(e => ({ id: e, name: (st(e).attributes || {}).friendly_name || e, cls: dc(e), linked: linked.has(e) })),
    drawnOpenings: drawn.length,
    strips: strips.map(e => ({ id: e, name: ((st(e) && st(e).attributes) || {}).friendly_name || e, run: withRun.includes(e) })),
    pieces,
    temps: { all: temps.length, placed: temps.filter(e => placed[e]).length },
    motion: { all: motion.length, placed: motion.filter(e => placed[e]).length },
    weather: { on: settings.atlas_weather_enabled === true, rain: settings.atlas_3d_weather !== false,
               source: settings.atlas_weather_rain_entity || settings.atlas_weather_condition_entity || (all.find(e => e.startsWith("weather.")) || "") },
    people: all.filter(e => e.startsWith("person.")).length,
    aiTasks: all.filter(e => e.startsWith("ai_task.")),
    scenes: all.filter(e => e.startsWith("scene.") || e.startsWith("script.")).length,
  };
}

/** Each step: done (nothing left that the house needs), and one line saying what was found. */
export function checks(s) {
  const noH = s.floors.filter(f => f.f2f == null && f.base == null);
  const empty = s.floors.filter(f => !f.rooms);
  const unlinked = s.doorSensors.filter(d => !d.linked);
  const noRun = s.strips.filter(x => !x.run);
  return {
    on: { done: s.pro && s.on && s.webgl !== false,
          line: !s.pro ? "Live Aboard comes with PadSpan Pro." : !s.on ? "Live Aboard is off." :
                s.webgl === false ? "This browser can't draw it (no WebGL)." : "Live Aboard is on." },
    floors: { done: s.floors.length > 0 && !noH.length,
              line: !s.floors.length ? "No floors yet (they come from Home Assistant's floors)." :
                    noH.length ? `${noH.map(f => f.name).join(", ")} ${noH.length === 1 ? "has" : "have"} no height yet (2.8 m is used).` :
                    `All ${s.floors.length} floors have a height.` },
    rooms: { done: s.rooms > 0 && !empty.length,
             line: !s.rooms ? "No rooms drawn yet." : empty.length ? `${s.rooms} rooms; nothing on ${empty.map(f => f.name).join(", ")}.` :
                   `${s.rooms} rooms across ${s.floors.length} floor${s.floors.length === 1 ? "" : "s"}.` },
    devices: { done: s.placed > 0,
               line: `${s.placed} devices on the Atlas (${s.placedLights} of ${s.lights} lights, ${s.motion.placed} of ${s.motion.all} motion sensors, ${s.temps.placed} of ${s.temps.all} thermometers).` },
    // Done once any height is set: the usual height for each kind is right
    // for most, so this step is for the few that aren't.
    heights: { done: s.heightSet > 0,
               line: `${s.heightSet} of ${s.placed} devices have their own height; the rest use the usual height for their kind.` },
    openings: { done: !unlinked.length,
                line: !s.doorSensors.length ? `No door or window sensors in Home Assistant. ${s.drawnOpenings} openings drawn.` :
                      `${s.doorSensors.length - unlinked.length} of ${s.doorSensors.length} door and window sensors are on a door or window; ${s.drawnOpenings} drawn in Live Aboard.` },
    strips: { done: !noRun.length,
              line: !s.strips.length ? "No placed lights look like LED strips." :
                    `${s.strips.length - noRun.length} of ${s.strips.length} lights that look like strips are laid out.` },
    furniture: { done: s.pieces > 0, line: s.pieces ? `${s.pieces} pieces of furniture.` : "No furniture yet." },
    extras: { done: true, line: "All optional." },
    screen: !s.hasOverview ? { done: true, line: "The sidebar Atlas is your screen." }
          : { done: s.overviewAtlas, line: s.overviewAtlas ? "Overview shows the Atlas." : "Overview shows the classic map." },
  };
}

// ── the wizard ───────────────────────────────────────────────────────────────

function hasWebGL() {
  try { const c = document.createElement("canvas"); return !!(c.getContext && (c.getContext("webgl2") || c.getContext("webgl"))); }
  catch (_) { return false; }
}

/** Open the wizard (a modal) on `step` (an id, or the first that isn't done). */
export async function openLiveAboardWizard(ctx, step) {
  const { el } = ctx.helpers;
  const W = ctx.state._laWizard = ctx.state._laWizard || { i: 0 };
  let house = null, states = {};
  const load = async () => {
    try { const r = await ctx.actions.callWS({ type: "padspan_ha/house3d_get" }); house = r && r.data ? r.data : null; } catch (_) { house = null; }
    states = (ctx.hass && ctx.hass.states) || {};
  };
  await load();
  const S = () => survey({ settings: ctx.state.settings || {}, model: ctx.state.model || {}, states, house, webgl: hasWebGL() });
  if (step) W.i = Math.max(0, STEPS.findIndex(s => s.id === step));
  else if (!W.started) {
    const c = checks(S());
    const first = STEPS.findIndex(s => !c[s.id].done);
    W.i = first < 0 ? 0 : first;
  }
  W.started = true;
  W.away = null;
  if (ctx.actions.telemetryEvent) ctx.actions.telemetryEvent("wizard_la_opened");

  // Centred in the modal at a readable width, whatever the modal's own width.
  const body = el("div", { class: "la-wiz", style: "width:min(760px,100%);min-width:min(560px,92vw);margin:0 auto" });
  const save = async (payload, note) => {
    try { await ctx.actions.settingsSet(payload); if (note) { note.textContent = "Saved."; note.style.color = "#52b788"; } }
    catch (e) { if (note) { note.textContent = "Could not save: " + String((e && e.message) || e); note.style.color = "#f87171"; } }
    draw();
  };
  // Off to a tool: Live Aboard picked for Mapping → Atlas, the tool asked for
  // (Live Aboard opens Edit there on its way in), and the step remembered so
  // Mapping → Atlas offers "← Back to the setup wizard".
  const go = (where) => {
    ctx.actions.closeModal();
    if (where.liveAboard) { try { localStorage.setItem("padspan_lv_3d_builder", "1"); } catch (_) { /* private mode */ } }
    if (where.tool) { ctx.state.maps = ctx.state.maps || {}; ctx.state.maps._laOpenTool = { tool: where.tool, eid: where.eid || null }; }
    W.away = where.finish ? null : STEPS[W.i].id;
    if (where.settings) { ctx.state.view = "settings"; ctx.state._settingsTab = "ui"; ctx.actions.renderRooms(); return; }
    ctx.state.view = "maps";
    if (ctx.actions.setMapsTab) ctx.actions.setMapsTab(where.tab); else { ctx.state.mapsTab = where.tab; ctx.actions.renderRooms(); }
    if (where.toast && ctx.toast) ctx.toast(where.toast);
  };
  const btn = (label, fn, primary) => {
    const b = el("button", { class: "btn inline", style: primary ? "background:#1b4332;border-color:#52b788;color:#d8f3dc;font-weight:700" : "" }, label);
    b.addEventListener("click", fn);
    return b;
  };
  const p = (text, style) => el("p", { style: "margin:6px 0;font-size:13px;line-height:1.55;color:#e2e8f0;" + (style || "") }, text);
  const tip = (text) => el("div", { style: "margin:8px 0;padding:8px 10px;border-radius:8px;background:rgba(82,183,136,.08);font-size:12px;line-height:1.5;color:#a7c4b5" }, text);
  const toggle = (label, on, fn, sub) => {
    const cb = el("input", { type: "checkbox" }); cb.checked = !!on;
    const note = el("span", { style: "font-size:11px;color:#94a3b8;margin-left:6px" });
    cb.addEventListener("change", () => fn(cb.checked, note));
    return el("div", { style: "margin:8px 0" }, [
      el("label", { style: "display:flex;align-items:center;gap:8px;cursor:pointer;font-size:13px;color:#e2e8f0" }, [cb, label, note]),
      sub ? el("div", { style: "font-size:11px;color:#94a3b8;margin:2px 0 0 24px;line-height:1.45" }, sub) : null,
    ]);
  };
  const select = (label, value, options, fn, sub) => {
    const s = el("select", { class: "select", style: "max-width:260px" });
    for (const [v, t] of options) { const o = el("option", { value: String(v) }, t); if (String(v) === String(value)) o.selected = true; s.appendChild(o); }
    const note = el("span", { style: "font-size:11px;color:#94a3b8;margin-left:6px" });
    s.addEventListener("change", () => fn(s.value, note));
    return el("div", { style: "margin:8px 0" }, [
      el("div", { style: "display:flex;align-items:center;gap:8px;flex-wrap:wrap;font-size:13px;color:#e2e8f0" }, [el("span", { style: "min-width:150px" }, label), s, note]),
      sub ? el("div", { style: "font-size:11px;color:#94a3b8;margin:2px 0 0 0;line-height:1.45" }, sub) : null,
    ]);
  };
  const list = (rows) => el("ul", { style: "margin:6px 0 6px 18px;padding:0;font-size:12px;color:#e2e8f0;line-height:1.6;max-height:160px;overflow:auto" },
    rows.map(r => el("li", {}, r)));

  const STEP = {
    on(s, c) {
      const out = [p("Live Aboard is the Atlas in 3D: your floors, rooms, walls, doors, windows, lights and sensors as a little house you can turn, zoom and tap, the way you'd look into a house in The Sims. It's built from the map you already drew.")];
      if (!s.pro) {
        out.push(tip("It comes with PadSpan Pro (and Bright Pro). Settings → PadSpan licence."));
        return out;
      }
      out.push(toggle("Show Live Aboard on the Atlas", s.on, (v, n) => save({ atlas_3d_enabled: v }, n),
        "Saves right away. In the sidebar Atlas, 🏠 on the left switches between the flat map and Live Aboard; in Mapping → Atlas, the Map | Live Aboard switch does."));
      if (s.webgl === false) out.push(tip("This browser can't draw 3D (no WebGL). Live Aboard still works on other screens; this one keeps the flat map."));
      if (s.hasOverview) out.push(toggle("Show the Atlas as Overview", s.overviewAtlas, (v, n) => { ctx.state._liveClassic = false; save({ overview_atlas: v }, n); },
        "Optional, off unless you turn it on. Overview, the first tab, shows the Atlas (and Live Aboard) instead of the classic map; Live Tracker gets a switch to the classic Overview. You can change it any time in Settings → UI Structure."));
      return out;
    },
    floors(s) {
      const out = [p("Each floor needs its height, floor to floor (the next floor up starts that far above this one). Without one, 2.8 m is used, which is fine for a lot of houses. A basement or a tall great room usually isn't.")];
      if (!s.floors.length) { out.push(tip("Floors come from Home Assistant (Settings → Areas, labels & zones → Floors). Add them there first.")); return out; }
      const inputs = [];
      for (const f of s.floors) {
        const inp = el("input", { type: "number", class: "input", min: "1.5", max: "10", step: "0.05", value: f.f2f != null ? String(f.f2f) : "", placeholder: "2.8", style: "width:80px" });
        inputs.push([f.id, inp]);
        out.push(el("div", { style: "display:flex;align-items:center;gap:8px;margin:4px 0;font-size:13px;color:#e2e8f0" },
          [el("span", { style: "min-width:150px" }, f.name), inp, el("span", { style: "color:#94a3b8;font-size:12px" }, `m · ${f.rooms} room${f.rooms === 1 ? "" : "s"}`)]));
      }
      const note = el("span", { style: "font-size:11px;color:#94a3b8;margin-left:8px" });
      out.push(el("div", { style: "margin-top:8px" }, [btn("Save heights", async () => {
        const floors = inputs.map(([id, inp]) => ({ id, floor_to_floor_m: inp.value === "" ? null : Number(inp.value) }));
        try {
          await ctx.actions.callWS({ type: "padspan_ha/fabric_floor_elevations_set", floors });
          if (ctx.actions.modelRefresh) await ctx.actions.modelRefresh();
          note.textContent = "Saved."; note.style.color = "#52b788"; draw();
        } catch (e) { note.textContent = "Could not save: " + String((e && e.message) || e); note.style.color = "#f87171"; }
      }, true), note]));
      out.push(tip("Measure from one floor's surface to the next one's. Mapping → 3D Stack has the same numbers with the floors drawn stacked."));
      return out;
    },
    rooms(s, c) {
      return [p("Walls in Live Aboard come from the rooms you drew: every room's outline stands up as its walls, at the floor's height."),
        list(s.floors.map(f => `${f.name}: ${f.rooms} room${f.rooms === 1 ? "" : "s"}`)),
        tip("Room names match Home Assistant's areas, which is what puts each device in its room. A floor with no rooms shows as a bare slab."),
        btn("Open Mapping → Rooms", () => go({ tab: "rooms" }))];
    },
    devices(s) {
      return [p("Everything Live Aboard shows lives on the Atlas: place a light, sensor, fan, lock or thermometer on the flat map and it's in the 3D house too, in its room."),
        list([`Lights: ${s.placedLights} of ${s.lights}`, `Motion sensors: ${s.motion.placed} of ${s.motion.all}`,
              `Thermometers: ${s.temps.placed} of ${s.temps.all} (the heat map uses these)`, `Everything placed: ${s.placed}`]),
        tip("Place at least one thermometer per room you care about: with Temps picked in Live Aboard, each room turns its temperature colour."),
        btn("Open Mapping → Atlas", () => go({ tab: "lights" }), true)];
    },
    heights(s) {
      return [p("Live Aboard puts each device at the height it really is: a pot light on the ceiling, a lamp on a table, a switch at switch height. Anything without its own height uses the usual height for its kind, so this is about the ones that are wrong."),
        tip("In Live Aboard: Edit → Heights, tap a device, then a spot (Ceiling, Corner, Wall, Switch height, Table, Floor…) or the slider. For a light, What is this? (pot light, pendant, lamp…) sets its look and height together. Mapping → Atlas also has a Heights list for setting several at once."),
        btn("Open Live Aboard at Heights", () => go({ tab: "lights", liveAboard: true, tool: "heights" }), true)];
    },
    openings(s) {
      const unl = s.doorSensors.filter(d => !d.linked);
      const out = [p("Doors and windows open and shut as their sensors do. Draw each one on its wall and pick the sensor it Follows.")];
      if (unl.length) {
        out.push(p("Not on a door or window yet (the button opens the right tool; pick this sensor under Follows):"));
        out.push(el("div", { style: "max-height:180px;overflow:auto;margin:4px 0" }, unl.map(d => {
          const t = d.cls === "door" || d.cls === "garage_door" ? "door" : "window";
          return el("div", { style: "display:flex;align-items:center;gap:8px;padding:3px 0;font-size:12px;color:#e2e8f0" }, [
            el("span", { style: "flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" }, `${d.name} (${d.cls.replace("_", " ")})`),
            btn(t === "door" ? "Draw its door" : "Draw its window", () => go({ tab: "lights", liveAboard: true, tool: t })),
          ]);
        })));
      }
      out.push(tip("In Live Aboard: Edit → Door, Window or Doorway, then press on a wall and drag along it (it snaps every 5 cm and stops at corners). On the sheet that opens: Type, hinge and swing, sill and head for a window, and Follows for its sensor. An open window in the rain glows blue and gets a warning, so link your windows if you have sensors on them."),
        el("div", { style: "display:flex;gap:8px;flex-wrap:wrap" }, [
          btn("Draw a door", () => go({ tab: "lights", liveAboard: true, tool: "door" }), true),
          btn("Draw a window", () => go({ tab: "lights", liveAboard: true, tool: "window" }), true),
          btn("Draw a doorway", () => go({ tab: "lights", liveAboard: true, tool: "doorway" })),
        ]));
      return out;
    },
    strips(s) {
      const out = [p("An LED strip, valance, cove or under-cabinet light is a line, not a point. Lay each one out so it glows along the right wall at the right height.")];
      const todo = s.strips.filter(x => !x.run);
      if (todo.length) {
        out.push(p("Look like strips and aren't laid out:"));
        out.push(el("div", { style: "max-height:180px;overflow:auto;margin:4px 0" }, todo.map(x =>
          el("div", { style: "display:flex;align-items:center;gap:8px;padding:3px 0;font-size:12px;color:#e2e8f0" }, [
            el("span", { style: "flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" }, x.name),
            btn("Lay it out", () => go({ tab: "lights", liveAboard: true, tool: "strip", eid: x.id })),
          ]))));
      }
      out.push(tip("In Live Aboard: Edit → Strip, tap the light (or pick it from Lights to lay out). Round this room runs it round the walls in one tap, with gaps at doors and windows if you like; Under, Behind or Top edge follows a piece of furniture; Draw lets you trace it. Then pick its height (Toe-kick, Counter, Under cabinets, Valance, Cove, Ceiling edge) and which way it shines."),
        btn("Open Live Aboard at Strip", () => go({ tab: "lights", liveAboard: true, tool: "strip" }), true));
      return out;
    },
    furniture(s) {
      const set = ctx.state.settings || {};
      const out = [p("Furniture makes it a home: build a sofa, bed, table and more with sliders, make one from a photo, or find one in the shared library. A piece can be a device too, so a lamp glows, a fan turns or a washer shakes when the real one does."),
        toggle("Use the shared furniture library", set.atlas_3d_library === true, (v, n) => save({ atlas_3d_library: v }, n),
          "Optional. Find pieces other PadSpan users shared, and share yours. Nothing is shared unless you press Share on a piece.")];
      out.push(select("Make furniture from a photo", set.atlas_3d_ai_task_entity || "",
        [["", "Off (no AI task)"], ...s.aiTasks.map(e => [e, e])], (v, n) => save({ atlas_3d_ai_task_entity: v }, n),
        s.aiTasks.length ? "Optional. Uses the Home Assistant AI Task you pick to turn a photo into a piece." :
          "Optional. Needs an AI Task entity in Home Assistant (an AI integration that provides ai_task)."));
      out.push(btn("Open Mapping → Furnish", () => go({ tab: "furnish" }), true));
      return out;
    },
    extras(s) {
      const set = ctx.state.settings || {};
      const out = [p("The cool stuff, all optional. Turn on what you like; everything here can be changed later in Settings → UI Structure.")];
      out.push(select("Look", set.atlas_3d_look || "atlas", [["atlas", "Same as the Atlas"], ["own", "Live Aboard's own colours"], ["studio", "Studio: soft light and sky"]],
        (v, n) => save({ atlas_3d_look: v }, n), "Same as the Atlas uses its Showcase theme, if you have one."));
      out.push(select("Quality", set.atlas_3d_quality || "auto",
        [["auto", "Auto: picked for this screen"], ["low", "Low: wall tablets and phones"], ["high", "High: sun shadows and more lamps"]],
        (v, n) => save({ atlas_3d_quality: v }, n)));
      if (!s.weather.on) out.push(toggle("Outdoor weather on the Atlas", false, (v, n) => save({ atlas_weather_enabled: v }, n),
        "Rain and snow (and the open-window warning) follow the Atlas's outdoor weather: your weather entity's condition, or a rain sensor. Pick those in Mapping → Atlas."));
      out.push(toggle("Rain and snow", s.weather.rain, (v, n) => save({ atlas_3d_weather: v }, n),
        s.weather.on ? `Falls outside the house when your weather says so${s.weather.source ? ` (${s.weather.source})` : ""}. With windows linked to sensors, an open window in the rain glows blue and gets a warning.`
          : "Needs the Atlas's Outdoor weather on (Mapping → Atlas), with a rain sensor or weather entity."));
      out.push(toggle("Show people", set.atlas_3d_people === true, (v, n) => save({ atlas_3d_people: v }, n),
        `Optional. Everyone PadSpan can place (${s.people} ${s.people === 1 ? "person" : "people"} in Home Assistant) as a figure in their room. Furnish → People & devices says who carries what.`));
      out.push(toggle("Show tags & scanners", set.atlas_3d_tags === true, (v, n) => save({ atlas_3d_tags: v }, n),
        "Optional. Every placed tag with its name, and every scanner at its height."));
      out.push(select("Back to home view", String(set.atlas_3d_home_idle_s ?? 60),
        [["0", "Off"], ["30", "After 30 s"], ["60", "After 1 min"], ["300", "After 5 min"]], (v, n) => save({ atlas_3d_home_idle_s: Number(v) }, n),
        "On the sidebar Atlas: how long it waits untouched before flying back to its home view."));
      out.push(tip("Built in, nothing to set: ⇕ Explode (with All floors) pulls the floors apart; ☰ → Temps turns each room its temperature colour; motion lights up badges with lines to the floor; at night lit rooms glow through the windows; a leak, smoke, gas or CO alarm sends rings across its room; the room sheet has ▶ for the room's scenes and scripts" + (s.scenes ? ` (${s.scenes} in your house)` : "") + "."));
      return out;
    },
    screen(s) {
      return [p("Last, make it the view you look at."),
        list([
          "Get the camera where you like it, then Views ▾ → Set as home. The sidebar Atlas flies back there after it's been left alone.",
          "Views ▾ → Save this view for other angles you use a lot.",
          "On a wall tablet: the sidebar Atlas, full screen with the corner button. With nothing changing, it draws nothing.",
        ]),
        s.hasOverview ? toggle("Show the Atlas as Overview", s.overviewAtlas, (v, n) => { ctx.state._liveClassic = false; save({ overview_atlas: v }, n); },
          "Optional, off unless you turn it on. Overview shows the Atlas instead of the classic map; the classic Overview moves under Live Tracker, behind a ⚡ Live Tracker | ▦ Overview switch.") : null,
        el("div", { style: "margin-top:8px;font-size:12px" }, [el("a", { href: GUIDE_URL, target: "_blank", rel: "noopener" }, "The Live Aboard Guide"), " has every tool in detail."]),
      ];
    },
  };

  function draw() {
    const s = S(), c = checks(s), step = STEPS[W.i];
    body.innerHTML = "";
    const rail = el("div", { style: "display:flex;flex-wrap:wrap;gap:4px;margin-bottom:12px" });
    STEPS.forEach((t, i) => {
      const b = el("button", { class: "btn inline", title: c[t.id].line,
        style: "font-size:11px;padding:2px 8px;border-radius:999px;" + (i === W.i ? "background:#1b4332;border-color:#52b788;color:#d8f3dc;font-weight:700"
          : c[t.id].done ? "border-color:#2d6a4f;color:#74c69d" : "border-color:#3f3f46;color:#94a3b8") },
        `${c[t.id].done ? "✓" : i + 1} ${t.title}`);
      b.addEventListener("click", () => { W.i = i; draw(); });
      rail.appendChild(b);
    });
    body.appendChild(rail);
    body.appendChild(el("div", { style: "font-weight:700;font-size:15px;color:#e2e8f0;margin-bottom:2px" }, `${W.i + 1}. ${step.title}`));
    body.appendChild(el("div", { style: "font-size:12px;color:" + (c[step.id].done ? "#74c69d" : "#fbbf24") + ";margin-bottom:6px" },
      (c[step.id].done ? "✓ " : "") + c[step.id].line));
    for (const n of STEP[step.id](s, c)) if (n) body.appendChild(n);
    const nav = el("div", { style: "display:flex;justify-content:space-between;align-items:center;margin-top:16px;gap:8px" });
    nav.appendChild(W.i > 0 ? btn("← Back", () => { W.i -= 1; draw(); }) : el("span", {}));
    nav.appendChild(W.i < STEPS.length - 1 ? btn("Next →", () => { W.i += 1; draw(); }, true)
      : btn("Finish: open Live Aboard", () => {
          if (ctx.actions.telemetryEvent) ctx.actions.telemetryEvent("wizard_la_finished");
          W.started = false;
          go({ tab: "lights", liveAboard: true, finish: true });
        }, true));
    body.appendChild(nav);
  }

  draw();
  ctx.actions.openModal("Set up Live Aboard", body, "A step at a time; come back any time");
}
