// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
// See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
//
// Heights for Live Aboard, on the Atlas (Garry, 2026-10-05): "Device
// placement on atlas is good until we get to sims, needs same information
// store, but needs to be a tool to add the third dimension for the sims
// view, height mostly ... This needs to be an element for all devices if
// someone starts using sims and wants it to work and look good."
//
//   Height row   in Mapping's Atlas inspector, for the placed device picked:
//                the heights its kind usually sits at (a leak sensor: Floor;
//                a lock: Door height; a motion sensor: Corner, Ceiling...),
//                a box in centimetres, and Default (what Live Aboard uses for
//                its kind)
//   Heights      every placed device, on one floor or all, with its height
//                or "default", sortable; tick some and set them all to one
//                height in one step (one Undo); "Using a default" shows what
//                still has none
//
// A height is z_m on the device's own placement record (the fabric's
// light_positions_m: the record the Atlas places it with), metres above its
// floor. Changes go into Mapping's placement draft, with its Undo, Save
// placements and Discard (maps.js); nothing here writes anything. Mapping
// loads this module only while Live Aboard is on at Pro: off, none of it is
// fetched and Mapping is as it was.

const q = new URL(import.meta.url).search;
const HOUSE = await import(`./live_aboard_house.js${q}`);
const DRAFT = await import(`./live_aboard_draft.js${q}`);
const MARKS = await import(`./live_aboard_marks.js${q}`);
const { deviceClassOf } = await import(`./light_codes.js${q}`);
const { heightNow, withoutGone } = await import(`./lights_map.js${q}`);

const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);
/** A height as shown: "2.40 m". */
export const metres = (z) => `${(Math.round(z * 100) / 100).toFixed(2)} m`;
/** The hover box's words for a height: "2.40 m up". */
export const upWords = (z) => `${metres(z)} up`;

// Where devices usually go, in metres above the floor. Ceiling is the
// floor's own ceiling (a sensor sits just under it, as Live Aboard draws it).
export const SPOTS = {
  ceiling: { label: "Ceiling", z: null },
  corner:  { label: "Corner", z: 2.2 },
  high:    { label: "High on the wall", z: 2.1 },
  counter: { label: "Over a counter", z: 1.7 },
  wall:    { label: "Wall", z: 1.5 },
  switch:  { label: "Switch height", z: 1.2 },
  door:    { label: "Door height", z: 1.0 },
  table:   { label: "Table", z: 0.75 },
  floor:   { label: "Floor", z: 0.02 },
};
// The spots each kind of device is offered, the likeliest first.
const HANGING = new Set(["pendant", "chandelier"]);
const STANDING = new Set(["lamp", "accent", "panel"]);
const ON_A_WALL = new Set(["sconce", "vanity", "valance", "undercab", "tv", "string", "led", "strip"]);
export function spotsFor(cls, kind){
  if (cls === "flood") return ["floor"];
  if (cls === "lock") return ["door"];
  if (cls === "motion") return ["corner", "ceiling", "high", "wall"];
  if (cls === "temp" || cls === "humidity" || cls === "air") return ["wall", "switch", "table", "high"];
  if (HANGING.has(kind)) return ["ceiling", "counter", "table"];
  if (STANDING.has(kind)) return ["table", "floor", "wall"];
  if (kind === "kick") return ["floor", "switch"];
  if (ON_A_WALL.has(kind)) return ["high", "wall", "switch", "ceiling"];
  return ["ceiling", "high", "wall", "table", "floor"];
}
// What one of a kind is called, in words.
const KIND_NAME = {
  glow: "light", fixture: "ceiling light", pot: "pot light", pot_ring: "pot light", perimeter: "light round a room",
  pendant: "pendant", chandelier: "chandelier", fan: "ceiling fan", track: "track light", tube: "tube light",
  spot: "spotlight", sconce: "wall light", vanity: "vanity light", strip: "LED strip", valance: "valance",
  cove: "cove light", undercab: "under-cabinet light", kick: "toe-kick light", tv: "TV backlight",
  string: "string of lights", lamp: "lamp", panel: "panel", accent: "accent light", led: "status light",
};
const CLASS_NAME = { motion: "motion sensor", temp: "temperature sensor", humidity: "humidity sensor",
                     air: "air sensor", flood: "leak sensor", lock: "lock", fan: "ceiling fan" };

/** What a placed device is, for its height: {cls, kind, what, section, ceil,
 *  top, dflt, spots: [[key, label, z]]}, or null for a device Live Aboard
 *  draws as part of a wall (a door or window sensor). `stored`: the 3D file's
 *  entry for it (its "What is this?" kind); `shape`: the Atlas shape the
 *  person set for it; `at` (optional): {floor, rooms, ground}, its floor as
 *  Live Aboard reads it and that floor's rooms. Defaults are Live Aboard's
 *  own: a light's is where its fixture's bulbs hang as Live Aboard builds it
 *  (fixtureParts; with no `at`, its kind's mount height), a sensor's deviceZ,
 *  a leak sensor's or a lock's markZ. */
export function infoOf(l, lp, ceil, stored, shape, at){
  const cls = deviceClassOf(l).key;
  if (cls === "door") return null;
  const fixture = HOUSE.isFixture(l), section = fixture ? "lights" : "devices";
  const top = DRAFT.heightRange(ceil, section).max;
  let kind = null, dflt;
  if (fixture) {
    const fp = HOUSE.footprint(lp);
    kind = HOUSE.storedKind(stored) || HOUSE.guessKind(l, fp, shape || null);
    dflt = HOUSE.mountHeight(kind, ceil);
    if (at && at.floor) {
      try {
        const L = { eid: l.entity_id, l, floor: at.floor, x: num(lp.x_m) ?? 0, y: num(lp.y_m) ?? 0, kind, fp, rot: num(lp.rotation) || 0,
                    marginM: num(lp.margin_cm) === null ? null : Math.max(0, num(lp.margin_cm) / 100) };
        const z = DRAFT.fixtureZ(HOUSE.fixtureParts(L, { rooms: at.rooms || [], pieces: [], ground: at.ground || 0 }));
        if (z !== null) dflt = z;
      } catch (_) { /* its kind's mount height, then */ }
    }
  } else {
    const sk = HOUSE.sensorKindOf(l), mk = MARKS.markKindOf(l);
    dflt = mk ? MARKS.markZ(mk, ceil, null) : HOUSE.deviceZ(sk || cls, ceil, null);
  }
  dflt = DRAFT.mm(Math.max(0, Math.min(top, dflt)));
  const what = fixture ? KIND_NAME[kind] || "light" : CLASS_NAME[cls] || "device";
  // Under a low ceiling two spots can come to the same height: the first says it.
  const spots = spotsFor(cls, kind).map((k) => [k, SPOTS[k].label, DRAFT.mm(Math.min(top, SPOTS[k].z ?? top))])
    .filter(([, , z], i, all) => all.findIndex((o) => o[2] === z) === i);
  return { cls, kind, what, section, ceil, top, dflt, spots };
}

/** A placed device's height as Mapping has it now (lights_map.js heightNow,
 *  the hover box's too): the Height row's unsaved one, else its record's,
 *  else the 3D file's; null for its default. */
export { heightNow };

/** The Heights list's rows: every placed device (a door or window sensor
 *  aside), each {eid, label, room, floorId, floorName, z (null: its
 *  default), shown (what Live Aboard draws), ...infoOf}. d = {model (the
 *  map as committed), draft (Mapping's unsaved placements), lightsByEid,
 *  floors (the registry's), file (the 3D file: {lights, devices}; a height
 *  there out of date, the model's light_heights_gone, is never read),
 *  shapes (settings.light_shapes)}. */
export function rowsOf(d){
  const committed = (d.model && d.model.light_positions_m) || {}, draft = d.draft || {};
  const live = withoutGone(d.file, d.model && d.model.light_heights_gone);
  const pos = { ...committed, ...draft };
  const F = HOUSE.readFloors(d.model, d.floors), rooms = HOUSE.readRooms(d.model, F);
  const out = [];
  for (const eid of Object.keys(pos)) {
    const lp = pos[eid], l = d.lightsByEid && d.lightsByEid[eid];
    if (!l || !lp || typeof lp !== "object") continue;
    const fl = F.byId.get(F.canon(lp.floor_id));
    const ceil = (fl ? fl.h : HOUSE.FLOOR_TO_FLOOR_M) - HOUSE.SLAB_T;
    const file = live || {};
    const at = fl ? { floor: fl, rooms: rooms.filter((r) => r.floor === fl), ground: F.ground } : null;
    const info = infoOf(l, lp, ceil, (file.lights || {})[eid], (d.shapes || {})[eid], at);
    if (!info) continue;
    const z = heightNow(eid, committed, draft, file, info.section);
    out.push({ eid, label: `${l.code ? l.code + " · " : ""}${l.friendly_name || eid}`, room: l.area_name || "",
               floorId: fl ? fl.id : String(lp.floor_id || ""), floorName: fl ? fl.name : String(lp.floor_id || ""),
               floorElev: fl ? fl.elev : 0,
               z, shown: z === null ? info.dflt : Math.min(z, info.top), ...info });
  }
  return out;
}
/** Sorted by "name", "room", "floor" or "height" (dir 1 or -1); ties by name. */
export function sortRows(rows, by = "name", dir = 1){
  const key = { name: (r) => r.label.toLowerCase(), room: (r) => r.room.toLowerCase(), floor: (r) => r.floorName.toLowerCase(),
                height: (r) => r.shown }[by] || ((r) => r.label.toLowerCase());
  return [...rows].sort((a, b) => {
    const x = key(a), y = key(b);
    const c = x < y ? -1 : x > y ? 1 : 0;
    return c * dir || (a.label < b.label ? -1 : a.label > b.label ? 1 : 0);
  });
}
/** The rows the list shows: on `floor` ("all" for every floor), and only the
 *  ones using a default when `onlyDefault`. */
export const filterRows = (rows, floor, onlyDefault) =>
  rows.filter((r) => (floor === "all" || !floor || r.floorId === floor) && (!onlyDefault || r.z === null));
/** A spot's height for one device: its own ceiling for "ceiling", and never
 *  over the highest it may go. */
export function spotZ(key, r){
  const s = SPOTS[key];
  if (!s) return null;
  return DRAFT.mm(Math.min(r.top, s.z ?? r.top));
}

// ── what the person sees ────────────────────────────────────────────────────
function chip(el, text, sub, on, onclick, title){
  return el("button", { class: "lv-chipbtn" + (on ? " on" : ""), title: title || null, onclick },
    sub ? [text, el("span", { class: "lv-chipn" }, sub)] : [text]);
}
function cmBox(r, onSet){
  const inp = document.createElement("input");
  inp.type = "number"; inp.className = "lv-num"; inp.min = "0"; inp.max = String(Math.round(r.top * 100)); inp.step = "1";
  inp.placeholder = String(Math.round(r.dflt * 100));
  inp.value = r.z === null ? "" : String(Math.round(r.z * 100));
  inp.setAttribute("aria-label", "Height in centimetres");
  inp.addEventListener("change", () => {
    const v = parseFloat(inp.value);
    if (inp.value.trim() === "" || !Number.isFinite(v)) { onSet(null); return; }
    onSet(DRAFT.mm(Math.max(0, Math.min(r.top, v / 100))));
  });
  return inp;
}
/** The inspector's Height row for row `r` (rowsOf's); set(z_m or null). */
export function heightRow(el, r, set){
  const row = el("div", { class: "lv-heightrow", style: "flex-basis:100%;display:flex;gap:6px;align-items:center;flex-wrap:wrap" });
  row.appendChild(el("span", { class: "lv-field", title: "How high it is above its floor, for Live Aboard" }, "Height"));
  for (const [, label, z] of r.spots) {
    row.appendChild(chip(el, label, metres(z), r.z !== null && Math.abs(r.z - z) < 0.005, () => set(z)));
  }
  const box = el("label", { class: "lv-field" }, [cmBox(r, set), "cm"]);
  row.appendChild(box);
  row.appendChild(chip(el, "Default", metres(r.dflt), r.z === null, () => set(null), `What Live Aboard uses for a ${r.what}`));
  row.appendChild(el("span", { class: "lv-hint" }, r.z === null
    ? `Live Aboard uses the default for a ${r.what}`
    : `${upWords(Math.min(r.z, r.top))} in Live Aboard`));
  return row;
}

/** The Heights list (a card), shut or open. st: Mapping's own remembered
 *  {open, floor, onlyDefault, sort, dir, sel: [entity ids]}; rows: rowsOf's;
 *  act = {change() (st changed: draw again),
 *  set(eids, zOf(row)) (one step, one Undo), pick(eid) (select it on the
 *  map), mapSel: [entity ids picked on the map]}. */
export function heightsCard(el, st, rows, act){
  const nDefault = rows.filter((r) => r.z === null).length;
  // The floors the devices are on, bottom up.
  const floors = [...new Map([...rows].sort((a, b) => a.floorElev - b.floorElev).map((r) => [r.floorId, r.floorName]))];
  // In the wide layouts it sits over the light index, in the index's column.
  const card = el("div", { class: "card lv-tablecard lv-atlascol-table lv-heightscard", style: "padding:10px 12px;margin-bottom:12px" });
  const head = el("div", { style: "display:flex;gap:10px;align-items:center;flex-wrap:wrap" }, [
    el("div", { class: "lv-tbl-title" }, "Heights for Live Aboard"),
    el("span", { class: "lv-hint" }, `${rows.length} placed · ${nDefault} using a default`),
    el("span", { style: "flex:1" }),
    el("button", { class: "lv-act", onclick: () => { st.open = !st.open; act.change(); } }, st.open ? "Hide" : "Show"),
  ]);
  card.appendChild(head);
  if (!st.open) return card;

  const shown = sortRows(filterRows(rows, st.floor, st.onlyDefault), st.sort, st.dir);
  const sel = new Set((st.sel || []).filter((e) => rows.some((r) => r.eid === e)));
  const keep = () => { st.sel = [...sel]; act.change(); };

  // Which floor, and only the ones still on a default.
  const bar = el("div", { style: "display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin-top:8px" });
  const pickFloor = document.createElement("select");
  pickFloor.className = "lv-select";
  pickFloor.setAttribute("aria-label", "Floor");
  for (const [id, name] of [["all", "All floors"], ...floors]) {
    const o = document.createElement("option");
    o.value = id; o.textContent = name;
    if (id === (st.floor || "all")) o.selected = true;
    pickFloor.appendChild(o);
  }
  pickFloor.addEventListener("change", () => { st.floor = pickFloor.value; act.change(); });
  bar.appendChild(pickFloor);
  bar.appendChild(chip(el, "Using a default", String(nDefault), !!st.onlyDefault, () => { st.onlyDefault = !st.onlyDefault; act.change(); },
    "Only the devices with no height of their own yet"));
  bar.appendChild(el("span", { style: "flex:1" }));
  bar.appendChild(el("button", { class: "lv-act", onclick: () => { for (const r of shown) sel.add(r.eid); keep(); } }, "Tick all shown"));
  if (act.mapSel && act.mapSel.length) {
    bar.appendChild(el("button", { class: "lv-act", title: "Tick the devices picked on the map",
      onclick: () => { for (const e of act.mapSel) if (rows.some((r) => r.eid === e)) sel.add(e); keep(); } }, `Tick the ${act.mapSel.length} picked on the map`));
  }
  bar.appendChild(el("button", { class: "lv-act", onclick: () => { sel.clear(); keep(); } }, "Untick all"));
  card.appendChild(bar);

  // Set every ticked one to a spot (each by its own ceiling and limit), a number, or its default.
  const picked = rows.filter((r) => sel.has(r.eid));
  if (picked.length) {
    const setBar = el("div", { style: "display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin-top:8px" });
    setBar.appendChild(el("span", { class: "lv-field" }, `Set ${picked.length} ticked to`));
    const offered = [...new Set(picked.flatMap((r) => r.spots.map(([k]) => k)))];
    for (const k of Object.keys(SPOTS).filter((s) => offered.includes(s))) {
      const s = SPOTS[k];
      setBar.appendChild(chip(el, s.label, s.z === null ? null : metres(s.z), false,
        () => act.set(picked.map((r) => r.eid), (r) => spotZ(k, r))));
    }
    const box = document.createElement("input");
    box.type = "number"; box.className = "lv-num"; box.min = "0"; box.step = "1"; box.placeholder = "cm";
    box.setAttribute("aria-label", "Height in centimetres for every ticked device");
    box.addEventListener("change", () => {
      const v = parseFloat(box.value);
      if (!Number.isFinite(v)) return;
      act.set(picked.map((r) => r.eid), (r) => DRAFT.mm(Math.max(0, Math.min(r.top, v / 100))));
    });
    setBar.appendChild(el("label", { class: "lv-field" }, [box, "cm"]));
    setBar.appendChild(chip(el, "Default", null, false, () => act.set(picked.map((r) => r.eid), () => null),
      "Back to what Live Aboard uses for each one's kind"));
    card.appendChild(setBar);
  }

  // The list, sorted by a column's heading (again: the other way).
  const sortBy = (by) => { if (st.sort === by) st.dir = -(st.dir || 1); else { st.sort = by; st.dir = 1; } act.change(); };
  const th = (by, text) => el("th", { class: "lv-sortable", style: "cursor:pointer", onclick: () => sortBy(by),
    title: "Sort by this" }, st.sort === by ? `${text} ${st.dir < 0 ? "▼" : "▲"}` : text);
  // The light index's own table: a row's name picks it on the map.
  const table = el("table", { class: "table lv-table lv-heightstable", style: "width:100%;margin-top:8px" });
  table.appendChild(el("thead", {}, [el("tr", {}, [el("th", {}, ""), th("name", "Device"), th("room", "Room"),
    th("floor", "Floor"), th("height", "Height")])]));
  const body = el("tbody");
  for (const r of shown) {
    const tick = document.createElement("input");
    tick.type = "checkbox"; tick.checked = sel.has(r.eid);
    tick.setAttribute("aria-label", `Tick ${r.label}`);
    tick.addEventListener("change", () => { if (tick.checked) sel.add(r.eid); else sel.delete(r.eid); keep(); });
    body.appendChild(el("tr", { "data-eid": r.eid }, [
      el("td", {}, [tick]),
      el("td", { class: "lv-name", style: "cursor:pointer", title: "Pick it on the map", onclick: () => act.pick(r.eid) }, r.label),
      el("td", { class: "muted lv-room" }, r.room),
      el("td", { class: "muted" }, r.floorName),
      el("td", { style: "font-variant-numeric:tabular-nums" }, r.z === null
        ? [el("span", { class: "lv-hint" }, `default (${metres(r.dflt)})`)] : metres(Math.min(r.z, r.top))),
    ]));
  }
  table.appendChild(body);
  card.appendChild(table);
  if (!shown.length) card.appendChild(el("div", { class: "lv-hint", style: "margin-top:6px" },
    st.onlyDefault ? "Every device here has a height of its own." : "No placed devices here."));
  return card;
}
