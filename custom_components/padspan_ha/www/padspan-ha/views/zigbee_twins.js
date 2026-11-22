// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
// See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
//
// The same Zigbee device in Home Assistant twice (zigbee_twins.py, 2026-11-22):
// once through Zigbee2MQTT and once through ZHA (or deCONZ). The owner: "do
// not double up sensors"; the Zigbee2MQTT one is used, the other copy is the
// duplicate. PadSpan never changes Home Assistant: it leaves the duplicate out
// of its lists, with a quiet note saying so, and where a duplicate is already
// chosen or placed it says so, with a button the person presses to use the
// kept one instead (never switched without them).
//
// The map comes with the settings (settings.zigbee_twins, ws_common._get_settings):
//   devices:  {copy's device id: {name, via, twin, twin_name, twin_via}}
//   entities: {copy's entity id: {twin: kept entity id or "", device}}
// An entity not in it is nobody's duplicate.

// Its words in the panel's language (views/i18n.js; English is the key).
const { t, tn } = await import(`./i18n.js${new URL(import.meta.url).search}`);

function _map(settings) {
  const z = settings && settings.zigbee_twins;
  return { devices: (z && z.devices) || {}, entities: (z && z.entities) || {} };
}

/** eid's duplicate entry, {twin, name, via, twin_name, twin_via}, or null. */
export function duplicateOf(eid, settings) {
  const z = _map(settings);
  const e = Object.prototype.hasOwnProperty.call(z.entities, eid) ? z.entities[eid] : null;
  if (!e) return null;
  const d = z.devices[e.device] || {};
  return { twin: String(e.twin || ""), name: String(d.name || ""), via: String(d.via || ""),
           twin_name: String(d.twin_name || ""), twin_via: String(d.twin_via || "Zigbee2MQTT") };
}

/** ids with the duplicates left out: {ids, hidden, via}. `keep` (a list or a
 *  Set) holds ids that stay whatever they are (the one already chosen). via:
 *  the kept copies' integration, for the note. */
export function dropDuplicates(ids, settings, keep = []) {
  const out = [], vias = new Set(), kept = keep instanceof Set ? keep : new Set(keep);
  let hidden = 0;
  for (const id of ids || []) {
    const d = kept.has(id) ? null : duplicateOf(id, settings);
    if (d) { hidden++; vias.add(d.twin_via); } else out.push(id);
  }
  return { ids: out, hidden, via: vias.size === 1 ? [...vias][0] : "Zigbee2MQTT" };
}

/** The quiet line under a list: "1 duplicate hidden (same unit on Zigbee2MQTT)", "" with none. */
export function hiddenNote(hidden, via = "Zigbee2MQTT") {
  return hidden > 0 ? tn(hidden, "1 duplicate hidden (same unit on {via})", "{n} duplicates hidden (same units on {via})", { via }) : "";
}

/** The warning for a chosen or placed duplicate: {text, twin, button}, or null
 *  when eid is nobody's duplicate. twin: the entity to use instead ("" when
 *  the kept copy has several that could be it, or it is not in Home
 *  Assistant's states), button its words. nameOf(eid) names an entity. */
export function duplicateWarning(eid, settings, states, nameOf) {
  const d = duplicateOf(eid, settings);
  if (!d) return null;
  const st = states || {};
  const name = (id) => (nameOf ? nameOf(id) : String((st[id] && st[id].attributes && st[id].attributes.friendly_name) || id));
  const twin = d.twin && st[d.twin] ? d.twin : "";
  const v = { name: name(eid), via: d.via, twin_via: d.twin_via, device: d.twin_name };
  const text = twin
    ? t("{name} is the {via} copy of a device that is also in {twin_via}, as {twin}. PadSpan uses the {twin_via} one.", { ...v, twin: name(twin) })
    : t("{name} is the {via} copy of {device}, which is also in {twin_via}. Pick the {twin_via} one in the list.", v);
  return { text, twin, button: twin ? t("Use the {twin_via} one", v) : "" };
}

/** duplicateWarning as a line for a page: the words and, with a twin, the
 *  button; onUse(twin) when it is pressed. null when eid is nobody's duplicate. */
export function duplicateWarningEl(eid, settings, states, onUse, nameOf) {
  const w = duplicateWarning(eid, settings, states, nameOf);
  if (!w) return null;
  const box = document.createElement("div");
  box.setAttribute("data-zigbee-twin", eid);
  box.setAttribute("style", "font-size:11px;color:#fbbf24;line-height:1.5;margin-top:4px;display:flex;flex-wrap:wrap;align-items:center;gap:4px 8px");
  const words = document.createElement("span");
  words.textContent = w.text;
  box.appendChild(words);
  if (w.twin && onUse) {
    const b = document.createElement("button");
    b.className = "btn";
    b.setAttribute("style", "font-size:11px;padding:2px 8px");
    b.textContent = w.button;
    b.addEventListener("click", () => onUse(w.twin));
    box.appendChild(b);
  }
  return box;
}

/** "Use the Zigbee2MQTT one" pressed: the kept copy's entity takes the
 *  duplicate's place everywhere PadSpan keeps it (padspan_ha/zigbee_twin_use:
 *  every setting naming it, its place with its looks, label and height, the
 *  walls linked to it, Live Aboard's links), and the duplicate's entries go.
 *  wsCall(type, data): the page's own; the reply is {ok, moved, settings}. */
export function useTwin(wsCall, eid, twin) {
  return Promise.resolve(wsCall("padspan_ha/zigbee_twin_use", { entity_id: eid, twin }));
}

/** The words once it is done, and when it failed (why: errorText of the error). */
export const usedNow = (name) => t("{name} is used now.", { name });
export const useFailed = (why) => t("Could not switch to it: {why}", { why });

/** hiddenNote as a quiet line, or null with nothing hidden. */
export function hiddenNoteEl(hidden, via) {
  const text = hiddenNote(hidden, via);
  if (!text) return null;
  const n = document.createElement("div");
  n.setAttribute("data-zigbee-hidden", String(hidden));
  n.setAttribute("style", "font-size:11px;color:#64748b;margin-top:2px");
  n.textContent = text;
  return n;
}
