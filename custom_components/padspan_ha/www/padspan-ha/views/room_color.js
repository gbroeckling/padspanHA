// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
// See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
//
// THE room colour. One implementation, imported by everything that draws a
// room — panel.js (which hands it to every view as ctx.helpers.roomColor) and
// the lights renderer.
//
// There used to be two, with entirely different algorithms: a continuous HSL
// hue here, and a fixed ten-colour palette indexed by a different hash in
// iso_lights.js. The comment above that second one claimed "same palette +
// hash as panel.js" — it never was. So every room was one colour on the
// Overview and a different colour on the lights map, and a colour the user had
// set by hand was honoured everywhere EXCEPT the lights map, which had no
// notion of the override at all.

/** FNV-1a 32-bit hash — deterministic hue selection, stable across sessions. */
function hash32(str){
  let h = 2166136261;
  for(let i = 0; i < str.length; i++){
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * Deterministic room colour.
 *
 * An explicit colour in room_meta wins — it is the user's answer, and it has
 * to hold on every surface or it is not really a setting. Otherwise the hue
 * comes from the room name, so the same room is the same colour everywhere,
 * across sessions and installs.
 *
 * `model` is optional: a caller without one still gets the derived colour
 * rather than nothing.
 */
export function roomColor(roomName, model){
  const meta = model && model.room_meta
    ? model.room_meta[String(roomName ?? "")]
    : null;
  if(meta && meta.color) return String(meta.color);
  const h = hash32(String(roomName ?? "")) % 360;
  // 70/55 keeps every hue legible on the dark ground the maps are drawn on.
  return `hsl(${h} 70% 55%)`;
}
