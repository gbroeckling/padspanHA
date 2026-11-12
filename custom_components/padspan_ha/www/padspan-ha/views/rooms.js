// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
// See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
//
// Rooms (interface review item 12, 2026-10-30): each room's settings in one
// place. Rooms are Home Assistant's Areas and floors are HA's floors, so the
// names and floors here are read only: renaming or adding one is done in HA
// (linked). What PadSpan keeps per room is edited inline, through the very
// commands the other screens use and nothing new:
//   colour        padspan_ha/model_update {room_meta: {room: {floor_id, color}}}
//                 (Settings → Appearance; it merges per room and keeps heights)
//   ceiling       padspan_ha/room_height_set {room, height_m}     (Mapping → Rooms)
//   split level   padspan_ha/room_height_set {room, floor_raise_m} (Mapping → Rooms)
//   surface       padspan_ha/room_height_set {room, surface}       (outdoor rooms only)
//   kind of space padspan_ha/room_height_set {room, space}         (rooms on a house floor)
// The outline is drawn in Mapping → Edit (linked, opened on that room); one
// drawn on a plan only goes onto the map of the house with the Setup Wizard's
// own "Put it on the map" (wizard_build.putOnMap), on a press, never by itself.
// Never calibration data.

const { scannersOf, whoIsWhere, followedObj } =
  await import(`./whos_where.js${new URL(import.meta.url).search}`)
    .catch(() => ({ scannersOf: () => [], whoIsWhere: () => [], followedObj: () => false }));

// ── PadSpan Bright (2026-10-30) ─────────────────────────────────────────────
// Garry: "Bright should get a rooms page, but only items on it that apply to
// Bright functionality." So in a Bright build each row is the room's colour,
// outline, ceiling height, split level and the lights in it (counted as the
// Atlas counts them, lights_map.js, loaded only here). Its receivers and who
// is in it now are presence: shown exactly when the build shows the Receivers
// screen (always in the full edition; in Bright only behind the reveal switch).
const { currentEdition, surfacesForEdition } =
  await import(`./editions.js${new URL(import.meta.url).search}`)
    .catch(() => ({ currentEdition: () => "full", surfacesForEdition: (ids) => ids.slice() }));
// Basic's focused views: a link opens just the part it is about (views/focus.js).
const FOCUS = await import(`./focus.js${new URL(import.meta.url).search}`);
// Whether a room is drawn: setup_status's one rule (review 2026-11-11, C3), and the one "Put it on the map".
const { roomDrawn } = await import(`./setup_status.js${new URL(import.meta.url).search}`);
const WB = await import(`./wizard_build.js${new URL(import.meta.url).search}`).catch(() => null);
// What kind of space each room is (outdoor_space.js's one rule, from the
// facts it reads of the house: a room of a higher floor over it, a gallery
// in a hall), and an outdoor room's surface.
const { isOutdoorFloorId } = await import(`./iso_lights.js${new URL(import.meta.url).search}`)
  .catch(() => ({ isOutdoorFloorId: () => false }));
const SURF = await import(`./outdoor_space.js${new URL(import.meta.url).search}`).catch(() => null);
const SPACE_WORDS = { indoor: "Indoors", open: "Open deck or patio", covered: "Covered patio or porch" };


let _LM = null;            // lights_map.js once loaded; false if it failed
function _roomLights(ctx) {
  if (_LM === false) return { failed: true };
  if (!_LM) {
    _LM = import(`./lights_map.js${new URL(import.meta.url).search}`)
      .then(m => { _LM = m; ctx.actions.renderRooms(); }, () => { _LM = false; ctx.actions.renderRooms(); });
    return null;
  }
  if (typeof _LM.then === "function") return null;
  // The Atlas's own pipeline (maps.js's Atlas builder tab): the same registry cache,
  // the same light list, its hidden lights left out.
  const st = ctx.state, s = st.settings || {};
  if (!st._lightsRegStore) st._lightsRegStore = {};
  const reg = st._modelLoaded
    ? _LM.ensureLightsRegistry(st._lightsRegStore, ctx.hass, (st.model && st.model.areas) || [], () => ctx.actions.renderRooms())
    : { loading: true };
  if (reg.loading) return null;
  const obj = (v) => (v && typeof v === "object" ? v : {});
  const lights = _LM.gatherLights((ctx.hass && ctx.hass.states) || {}, reg.areaMap, obj(s.light_shapes), s.tier,
    reg.platformMap, obj(s.light_type_overrides), reg.pairMap, reg.manufacturerMap, undefined, false, st._motionReconnects,
    new Set(((st.model && st.model.rf_barriers_m) || []).map(b => b.linked_entity_id).filter(Boolean)));
  const hidden = new Set(Array.isArray(s.lights_hidden) ? s.lights_hidden : []);
  const shown = lights.filter(l => !hidden.has(l.entity_id));
  return { of: (room) => { const a = _LM.roomAggregate(shown, room); return { total: a.lightsTotal, on: a.lightsOn }; } };
}

const okRoom = (r) => typeof r === "string" && r !== "" && r !== "unknown" && r !== "not_home";

/** "#rrggbb" for a stored colour or room_color.js's "hsl(h 70% 55%)". */
export function toHex(c) {
  const s = String(c || "").trim();
  if (/^#[0-9a-f]{6}$/i.test(s)) return s.toLowerCase();
  const m = /^hsl\(\s*([\d.]+)[\s,]+([\d.]+)%[\s,]+([\d.]+)%\s*\)$/i.exec(s);
  if (!m) return "#888888";
  const h = Number(m[1]) % 360, sat = Number(m[2]) / 100, l = Number(m[3]) / 100;
  const k = (n) => (n + h / 30) % 12, a = sat * Math.min(l, 1 - l);
  const f = (n) => Math.round(255 * (l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1))));
  return "#" + [f(0), f(8), f(4)].map(x => x.toString(16).padStart(2, "0")).join("");
}

/** Floor area of a room_geometry_m entry in m², or null. */
export function areaM2(g) {
  if (!g || typeof g !== "object") return null;
  if (g.type === "circle") return Number(g.r_m) > 0 ? Math.PI * g.r_m * g.r_m : null;
  const P = Array.isArray(g.points_m) ? g.points_m : [];
  if (P.length < 3) return null;
  let s = 0;
  for (let i = 0; i < P.length; i++) {
    const a = P[i], b = P[(i + 1) % P.length];
    s += Number(a[0]) * Number(b[1]) - Number(b[0]) * Number(a[1]);
  }
  const v = Math.abs(s) / 2;
  return isFinite(v) && v > 0 ? v : null;
}

/** The rooms, grouped by floor in Home Assistant's floor order:
 *  [{floorId, floorName, rooms:[row]}]. A row is everything the page shows
 *  for one room. Rooms are HA's areas, plus any room drawn in PadSpan's
 *  layout that is not an area (haId null). */
export function roomGroups(ctx) {
  const model = ctx.state.model || {};
  const floors = Array.isArray(model.floors) ? model.floors : [];
  const areas = Array.isArray(model.areas) ? model.areas : [];
  const meta = model.room_meta || {};
  const geo = model.room_geometry_m || {};
  const scannerRoom = model.scanners || {};
  const maps = (ctx.state.maps && ctx.state.maps.list) || [];
  const snap = (ctx.state.live && ctx.state.live.snapshot) || null;
  // Bright only: the lights in each room (null while the Atlas's list loads).
  const lit = currentEdition(ctx.state.settings) === "bright" ? _roomLights(ctx) : undefined;

  const rooms = areas.filter(a => a && a.name).map(a => ({ name: String(a.name), haId: a.id || null, floorId: String(a.floor_id || "main") }));
  const named = new Set(rooms.map(r => r.name));
  for (const [name, g] of Object.entries(geo)) {
    if (!named.has(name)) rooms.push({ name, haId: null, floorId: String((g && g.floor_id) || (meta[name] && meta[name].floor_id) || "main") });
  }

  // Receivers in each room: the room PadSpan placed it in, else its HA area.
  const rx = {};
  const addRx = (room, source) => { if (okRoom(room) && source) (rx[room] ||= new Set()).add(String(source)); };
  const placed = new Set();
  for (const [source, s] of Object.entries(scannerRoom)) if (s && okRoom(s.room)) { addRx(s.room, source); placed.add(String(source)); }
  for (const s of scannersOf(snap)) if (!placed.has(s.source)) addRx(s.area, s.source);

  // Who is in each room now (the Overview's own "Who's where" reading).
  const now = {};
  // Not the demo house's people in your own rooms (Sample mode): only the
  // sample house's people in its own rooms (sample_house.js).
  if (snap && (!_isSample(ctx.state) || (ctx.state.live && ctx.state.live.fromSample))) {
    const h = ctx.helpers || {};
    const opts = {
      followed: (o) => !!(ctx.actions && ctx.actions.followedHas) && followedObj(o, ctx.actions.followedHas),
      away: (o) => !!(h.isAway && h.awayTimeoutS) && h.isAway(o, h.awayTimeoutS(ctx.state.settings)),
      isScanner: h.isScanner,
    };
    for (const r of whoIsWhere(snap, scannersOf(snap), opts)) if (r.room) now[r.room] = r;
  }

  const floorOf = (id) => floors.find(f => String(f.id) === id) || null;
  // Each drawn room's facts, read as Live Aboard reads them (houseFacts): its floor on the plan it is drawn on.
  const facts = SURF ? SURF.houseFacts(model, isOutdoorFloorId) : {};
  const rows = rooms.map(r => {
    // The one rule: as stored (space), and as worked out (shown beside the choice).
    // On an Outside floor by the plan it is drawn on (its area may have no floor), else by its area's.
    const f = { name: r.name, ground: isOutdoorFloorId(r.floorId), ...(facts[r.name] || {}) };
    const stored = SURF ? SURF.storedSpace(model, r.name) : null;
    const spaceNow = SURF ? SURF.outdoorKind({ ...f, stored }) : "indoor";
    const m = meta[r.name] || null;
    const g = geo[r.name] || null;
    const drawn = roomDrawn(ctx.state, r.name);
    const fl = floorOf(r.floorId);
    const a = areaM2(g);
    const color = (m && m.color) || (ctx.helpers.roomColor ? ctx.helpers.roomColor(r.name) : "#888888");
    return {
      ...r,
      color: toHex(color),
      metaFloorId: (m && m.floor_id) || r.floorId,
      // Drawn: on the map of the house (the layout's outline), or traced on a plan that has a scale (setup_status.roomDrawn).
      outline: !!drawn,
      // Drawn on a plan only, not on the house yet: {id, name, floorId} of that plan.
      onPlan: drawn && drawn.map ? { id: drawn.map.id, name: String(drawn.map.name || "a floor plan"), floorId: String(drawn.map.floor_id || "main") } : null,
      // The floor plan Edit opens on: one on the room's floor, else the first.
      mapId: ((maps.find(mp => mp && String(mp.floor_id || "main") === r.floorId) || maps[0] || {}).id) || null,
      areaM2: a == null ? null : Math.round(a * 10) / 10,
      heightM: m && m.height_m != null ? Number(m.height_m) : null,
      floorHeightM: Number(fl && fl.floor_to_floor_m) || 2.8,
      raiseM: m && m.floor_raise_m != null ? Number(m.floor_raise_m) : null,
      space: stored, spaceWorked: SURF ? SURF.outdoorKind(f) : "indoor", spaceNow,
      outdoor: spaceNow !== "indoor",
      surface: SURF ? SURF.roomSurface(model, r.name) : null,
      // room_height_set refuses a room it has no record or outline of.
      heightEditable: !!(m || g),
      receivers: rx[r.name] ? rx[r.name].size : 0,
      people: (now[r.name] && now[r.name].people.map(p => p.name)) || [],
      others: (now[r.name] && now[r.name].others) || 0,
      ...(lit === undefined ? {} : { lights: !lit ? null : lit.failed ? false : lit.of(r.name) }),
    };
  });

  const order = floors.map(f => String(f.id));
  for (const r of rows) if (!order.includes(r.floorId)) order.push(r.floorId);
  return order.map(id => {
    const fl = floorOf(id);
    return {
      floorId: id,
      floorName: fl ? String(fl.name || fl.id) : id === "main" ? "No floor set in Home Assistant" : id,
      rooms: rows.filter(r => r.floorId === id).sort((a, b) => a.name.localeCompare(b.name)),
    };
  }).filter(g => g.rooms.length);
}

// ── Going elsewhere ─────────────────────────────────────────────────────────

function _go(ctx, view) {
  ctx.state.view = view;
  if (ctx.actions.renderNav) ctx.actions.renderNav();
  ctx.actions.renderRooms();
}

/** Mapping → Edit with the Rooms tool on and the room chosen, on the plan
 *  it is traced on (maps.js finds that one) or else one of its floor's. In
 *  Basic only the Rooms tool, on that room, with a way back here
 *  (views/focus.js); Advanced, the whole Edit tab. */
function _editOutline(ctx, row) {
  ctx.state.maps = ctx.state.maps || {};
  const ms = ctx.state.maps;
  ctx.state.activeMapId = row.mapId;
  // One-shot, applied by Mapping → Edit (maps.js), which keeps an open
  // plan's unsaved drafts.
  ms._openMode = "rooms";
  ms._openRoom = row.name;
  FOCUS.openFocus(ctx, FOCUS.part("roomOutline", { item: row.name, title: "Outline: " + row.name }));
}

/** The receivers: the Receivers page (panel.js openReceivers, which loads
 *  it if the background load has not yet), else Bluetooth → Receivers. */
function _receivers(ctx) {
  if (ctx.actions.openReceivers) { ctx.actions.openReceivers(); return; }
  ctx.state.btTab = "scanners";
  _go(ctx, "bluetooth");
}

/** A link into Home Assistant's own pages (Areas), in the same window;
 *  the rooms helper (views/ai_wizard.js) uses it too. */
export function _haLink(el, path, label) {
  const a = el("a", { href: path, target: "_top", style: "color:#52b788;font-size:12px;text-decoration:underline;cursor:pointer" }, label);
  a.addEventListener("click", (e) => {
    try {
      history.pushState(null, "", path);
      window.dispatchEvent(new CustomEvent("location-changed", { detail: { replace: false } }));
      e.preventDefault();
    } catch (_) { /* the plain link then */ }
  });
  return a;
}

// ── Saving ──────────────────────────────────────────────────────────────────

async function _saved(ctx, ok) {
  // Settings → Appearance edits a copy of the model taken when it opened;
  // drop it so it re-reads this change instead of saving the old one back.
  ctx.state._settingsDraft = null;
  if (ctx.actions.telemetryEvent) ctx.actions.telemetryEvent("rooms_page_edit");
  if (ok) ctx.toast(ok);
}

async function _setColor(ctx, row, hex) {
  if (_isSample(ctx.state)) return;
  try {
    // Settings → Appearance's own save, for this one room: model_update
    // merges per room and keeps a height it is not sent.
    await ctx.actions.modelUpdate({ room_meta: { [row.name]: { floor_id: row.metaFloorId, color: hex } } });
    await _saved(ctx, `"${row.name}" colour saved`);
  } catch (err) { ctx.toast("Colour not saved: " + (err.message || err), true); }
}

/** A room drawn on a plan only, onto the map of the house: the Setup Wizard's "Put it on the map" for this one room
 *  (wizard_build.putOnMap: only a room the house doesn't have, never one it has). */
function _putOnMap(ctx, row) {
  if (_isSample(ctx.state) || !WB) return;
  WB.putOnMap(ctx, { mapId: row.onPlan.id, floorId: row.onPlan.floorId, rooms: [row.name], scanners: [], readable: true },
    { refresh: () => ctx.actions.modelRefresh(), where: ctx.state.complexity === "basic" ? "Edit outline opens it on its plan" : "Mapping → Layout shows them" });
}

async function _setRoom(ctx, row, msg, ok) {
  if (_isSample(ctx.state)) return;
  try {
    await ctx.actions.wsCall("padspan_ha/room_height_set", { room: row.name, ...msg });
    await _saved(ctx, ok);
    await ctx.actions.modelRefresh();
  } catch (err) { ctx.toast("Not saved: " + (err.message || err), true); }
}

// ── The page ────────────────────────────────────────────────────────────────

const INPUT = "width:76px;background:#071008;color:#e2e8f0;border:1px solid #2d4a38;border-radius:6px;padding:4px 6px;font-size:12px";
const LABEL = "font-size:11px;color:#94a3b8;margin-bottom:3px";
const LINKBTN = "background:none;border:none;color:#52b788;font-size:12px;padding:0;text-decoration:underline;cursor:pointer";

function _field(el, label, kids, basis = 130) {
  return el("div", { style: `display:flex;flex-direction:column;min-width:120px;flex:1 1 ${basis}px` }, [
    el("div", { style: LABEL }, label),
    el("div", { style: "display:flex;align-items:center;gap:6px;flex-wrap:wrap;font-size:12px;color:#e2e8f0" }, kids),
  ]);
}

// Sample mode shows the sample house (its rooms come with it): nothing is
// saved from here then, and nothing counted.
const _isSample = (st) => st.dataMode === "sample" && !!st._dataModeKnown;

function _row(ctx, el, row, readOnly = false, presence = true) {
  const card = el("div", { style: "border-top:1px solid #1b3526;padding:12px 0", "data-room": row.name });

  // Name, colour, and where to rename it.
  const col = el("input", { type: "color", title: "Room colour, on every map", style: "width:34px;height:26px;padding:0;border:1px solid #2d4a38;border-radius:6px;background:#071008;cursor:pointer" });
  col.value = row.color;
  col.setAttribute("data-edit", "color");
  col.addEventListener("change", () => { if (col.value && col.value.toLowerCase() !== row.color) _setColor(ctx, row, col.value.toLowerCase()); });
  card.appendChild(el("div", { style: "display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:10px" }, [
    col,
    el("div", { style: "font-weight:700;font-size:14px;color:#e2e8f0" }, row.name),
    row.haId
      ? _haLink(el, `/config/areas/area/${encodeURIComponent(row.haId)}`, "Rename in Home Assistant")
      : el("span", { class: "muted", style: "font-size:11px", title: ctx.state.complexity === "basic" ? "A room PadSpan has that isn't an area in Home Assistant" : "Drawn in PadSpan's layout (Mapping → Layout) but not an area in Home Assistant" }, "PadSpan only, not a Home Assistant area"),
  ]));

  const fields = el("div", { style: "display:flex;flex-wrap:wrap;gap:12px 16px" });

  // Outline.
  const outlineKids = [el("span", {}, row.onPlan ? `Drawn on ${row.onPlan.name}, not on the house map yet`
    : row.outline ? (row.areaM2 != null ? `Drawn, ${row.areaM2} m²` : "Drawn") : "Not drawn")];
  if (row.onPlan && !readOnly && WB) outlineKids.push(el("button", { class: "btn inline", style: "font-size:12px;padding:3px 10px", "data-put": "map", onclick: () => _putOnMap(ctx, row) }, "Put it on the map"));
  if (row.mapId) {
    outlineKids.push(el("button", { style: LINKBTN, "data-link": "outline", onclick: () => _editOutline(ctx, row) }, row.outline ? "Edit outline" : "Draw outline"));
  } else {
    outlineKids.push(el("button", { style: LINKBTN, "data-link": "mapping", onclick: () => { ctx.state.mapsTab = "library"; _go(ctx, "maps"); } }, "Add a floor plan"));
  }
  fields.appendChild(_field(el, "Outline", outlineKids));

  // Ceiling height (Live Aboard's "Rises to").
  const hIn = el("input", { type: "number", min: "1.5", max: "30", step: "0.1", placeholder: `floor's, ${row.floorHeightM}`, style: INPUT,
    title: "For a room taller than its floor (a double-height living room): floor to ceiling for this room only. Blank = its floor's height. Used for the 3D view, never for positioning." });
  hIn.value = row.heightM != null ? String(row.heightM) : "";
  hIn.setAttribute("data-edit", "height");
  const hBtn = el("button", { class: "btn inline", style: "font-size:12px;padding:3px 10px", onclick: () => {
    const raw = String(hIn.value || "").trim(), v = raw === "" ? null : parseFloat(raw);
    if (v !== null && !(isFinite(v) && v >= 1.5 && v <= 30)) { ctx.toast("Enter a height in metres (1.5 to 30), or leave it blank for the floor's", true); return; }
    _setRoom(ctx, row, { height_m: v }, v === null ? `"${row.name}" is as high as its floor` : `"${row.name}" rises to ${v} m`);
  } }, "Save height");
  hBtn.setAttribute("data-save", "height");
  if (!row.heightEditable) { hIn.disabled = true; hBtn.disabled = true; hIn.title = "Draw this room's outline first"; }
  fields.appendChild(_field(el, "Ceiling height (m)", [hIn, hBtn], 190));

  // Split level: behind a quiet link until used, as in Mapping → Rooms.
  const rIn = el("input", { type: "number", min: "-1.5", max: "3", step: "0.05", placeholder: "0", style: INPUT,
    title: "For a split level: how far this room's floor sits above the rest of its floor, or below it with a minus (a step-down living room). Blank or 0: level with its floor." });
  rIn.value = row.raiseM != null ? String(row.raiseM) : "";
  rIn.setAttribute("data-edit", "raise");
  const rBtn = el("button", { class: "btn inline", style: "font-size:12px;padding:3px 10px", onclick: () => {
    const raw = String(rIn.value || "").trim(), v = raw === "" ? null : parseFloat(raw);
    if (v !== null && !(isFinite(v) && v >= -1.5 && v <= 3)) { ctx.toast("Enter how far up in metres (up to 3, or down to -1.5), or leave it blank", true); return; }
    const off = v !== null && Math.abs(v) >= 0.05;
    _setRoom(ctx, row, { floor_raise_m: off ? v : null },
      off ? `"${row.name}" sits ${Math.abs(v)} m ${v > 0 ? "above" : "below"} the rest of its floor` : `"${row.name}" is level with its floor`);
  } }, "Save");
  rBtn.setAttribute("data-save", "raise");
  if (!row.heightEditable) { rIn.disabled = true; rBtn.disabled = true; }
  if (readOnly) { col.disabled = true; hIn.disabled = true; hBtn.disabled = true; rIn.disabled = true; rBtn.disabled = true; }
  const rEdit = el("span", { style: `display:${row.raiseM ? "inline-flex" : "none"};align-items:center;gap:6px` }, [rIn, rBtn]);
  const rText = el("span", { style: `display:${row.raiseM ? "none" : "inline"}` }, "Level with its floor");
  const rLink = el("button", { style: LINKBTN + `;display:${row.raiseM || !row.heightEditable || readOnly ? "none" : ""}`, "data-link": "split",
    onclick: () => { rEdit.style.display = "inline-flex"; rText.style.display = "none"; rLink.style.display = "none"; } }, "Change");
  fields.appendChild(_field(el, "Split level (m up or down)", [rText, rLink, rEdit]));

  // What kind of space: a room on a house floor (a room on an Outside floor is outside ground).
  if (row.spaceNow !== "ground") {
    const kSel = el("select", { style: INPUT + ";width:auto", "data-edit": "space",
      title: "Indoors, open to the sky, or covered (a roof, deck or floor over it, open sides). Used for the 3D view: walls, rain, where ceiling lights hang. Never for positioning." }, [
      el("option", { value: "" }, "Work it out"),
      el("option", { value: "indoor" }, SPACE_WORDS.indoor),
      el("option", { value: "open" }, SPACE_WORDS.open + " (open to the sky)"),
      el("option", { value: "covered" }, SPACE_WORDS.covered + " (a roof, deck or floor over it)"),
    ]);
    kSel.value = row.space || "";
    kSel.addEventListener("change", () => {
      const v = kSel.value || null;
      _setRoom(ctx, row, { space: v }, v ? `"${row.name}" is ${SPACE_WORDS[v].toLowerCase()}` : `"${row.name}" is worked out again`);
    });
    if (!row.heightEditable || readOnly) kSel.disabled = true;
    fields.appendChild(_field(el, "Kind of space", [kSel,
      el("span", { class: "muted", style: "font-size:11px", "data-space-worked": row.spaceWorked },
        "Worked out: " + SPACE_WORDS[row.spaceWorked].toLowerCase())], 220));
  } else if (SURF && SURF.FLOOR_SPACE_NAME.test(row.name)) {
    fields.appendChild(_field(el, "Kind of space", [el("span", { class: "muted", style: "font-size:11px", "data-space-note": "1" },
      "A deck or patio usually belongs to the floor it is level with")], 220));
  }

  // Surface: outdoor rooms only (a deck, a patio, or a room on an outdoor floor).
  if (row.outdoor) {
    const sSel = el("select", { style: INPUT + ";width:auto", "data-edit": "surface",
      // The flat map draws no room of an Outside floor: there, the 3D view only.
      title: (row.spaceNow === "ground" ? "What the 3D view draws on this outdoor space's floor (the flat map does not show rooms on the Outside floor)."
        : "What the 3D view and the map draw on this outdoor space's floor.") + " Drawing only, never positioning." }, [
      el("option", { value: "" }, "Standard"),
      el("option", { value: "pavers_2ft" }, "Grey paving tiles (2 ft × 2 ft)"),
    ]);
    sSel.value = row.surface || "";
    sSel.addEventListener("change", () => {
      const v = sSel.value || null;
      _setRoom(ctx, row, { surface: v }, v ? `"${row.name}" is paved with grey tiles` : `"${row.name}" has the standard surface`);
    });
    if (!row.heightEditable || readOnly) sSel.disabled = true;
    fields.appendChild(_field(el, "Surface", [sSel]));
  }

  // Lights (Bright): how many the Atlas has in the room, and how many are on.
  if ("lights" in row) {
    const L = row.lights;
    fields.appendChild(_field(el, "Lights", [el("span", { "data-lights": "1" },
      L === null ? "Loading…" : L === false ? "Not available"
        : L.total ? `${L.total} light${L.total === 1 ? "" : "s"}, ${L.on ? `${L.on} on` : "all off"}` : "None")]));
  }

  // Receivers.
  if (presence) fields.appendChild(_field(el, "Receivers", [
    el("span", {}, row.receivers ? `${row.receivers} receiver${row.receivers === 1 ? "" : "s"}` : "None"),
    el("button", { style: LINKBTN, "data-link": "receivers", onclick: () => _receivers(ctx) }, "See receivers"),
  ]));

  // In it now.
  const nowText = row.people.length
    ? row.people.join(", ") + (row.others ? `, and ${row.others} other device${row.others === 1 ? "" : "s"}` : "")
    : row.others ? `${row.others} unnamed device${row.others === 1 ? "" : "s"}` : "Nobody";
  if (presence) fields.appendChild(_field(el, "In it now", [el("span", { "data-now": "1" }, nowText)]));

  card.appendChild(fields);
  return card;
}

export function render(ctx) {
  const { el } = ctx.helpers;
  const isBasic = ctx.state.complexity === "basic";
  const root = el("div", { id: "rooms" });

  const head = el("div", { class: "card" });
  head.appendChild(el("div", { style: "display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap" }, [
    el("div", { style: "display:flex;align-items:center;gap:8px" }, [
      el("div", { style: "font-weight:700;font-size:16px" }, "Rooms"),
      ctx.helpers.helpBtn("rooms"),
    ]),
    el("div", { style: "display:flex;gap:8px;align-items:center;flex-wrap:wrap" }, [
      _haLink(el, "/config/areas/dashboard", "Add a room in Home Assistant"),
      el("button", { class: "btn inline", style: "white-space:nowrap", onclick: async () => { await ctx.actions.modelRefresh(); } }, "Refresh"),
    ]),
  ]));
  head.appendChild(el("div", { class: "muted", style: "font-size:12px;margin-top:6px;line-height:1.5" },
    "Each room's settings in one place. Rooms and floors are your Home Assistant Areas: add or rename them there, then press Refresh. " +
    "Colour, ceiling height and split level save here at once; the outline is drawn on your floor plan in Mapping."
    + (isBasic ? "" : " The layout in metres is in Mapping → Layout.")));
  root.appendChild(head);
  const readOnly = _isSample(ctx.state);
  // Receivers and people only where the build shows the Receivers screen (not Bright).
  const presence = surfacesForEdition(["receivers"], ctx.state.settings || {}).length > 0;
  if (readOnly) {
    root.appendChild(el("div", { class: "card", style: "margin-top:12px;font-size:12px", "data-rooms-note": "sample" },
      ctx.state.live && ctx.state.live.fromSample
        ? "Sample mode: these are the sample house's rooms, shown read-only. Switch to Live mode to see and change yours."
        // The sample house could not load: your own rooms (panel.js reads them then), and nobody in them.
        : "Sample mode is on but the sample house could not be shown, so these are your own rooms"
          + (presence ? ", without who is in them" : "") + ". Nothing can be changed here until you switch back to Live."));
  }

  const groups = roomGroups(ctx);
  if (!groups.length) {
    root.appendChild(el("div", { class: "card", style: "margin-top:12px" }, [
      el("div", { style: "font-weight:600;margin-bottom:6px" }, "No rooms yet"),
      el("div", { class: "muted", style: "font-size:12px" }, "Add areas in Home Assistant (Settings → Areas, labels & zones) and they show up here."),
    ]));
    return root;
  }
  for (const g of groups) {
    const card = el("div", { class: "card", style: "margin-top:12px", "data-floor": g.floorId });
    card.appendChild(el("div", { style: "display:flex;align-items:baseline;gap:8px;margin-bottom:2px" }, [
      el("div", { style: "font-weight:700;font-size:13px;color:#a7f3d0" }, g.floorName),
      el("span", { class: "muted", style: "font-size:12px" }, `${g.rooms.length} room${g.rooms.length === 1 ? "" : "s"}`),
    ]));
    for (const row of g.rooms) card.appendChild(_row(ctx, el, row, readOnly, presence));
    root.appendChild(card);
  }
  return root;
}

