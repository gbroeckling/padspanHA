// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
// See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
//
// Canonical light codes — shared by the Mapping → Lights tab and the Lights
// sidebar panel so the SAME physical light wears the SAME code in both tools.
// Codes derive from the entity_id sort: stable across display sorts, hidden
// toggles, and entity-registry load races (each view previously numbered by
// its own display order, so the two tools disagreed).
//
// WLED-class lights (effect-capable) get the W-series (W01…); everything else
// runs A01…A99, B01… with the letter W skipped so the series never collide.

export function isWledLight(l) {
  return Array.isArray(l.effect_list) && l.effect_list.length > 0;
}

// Distinct marker border/stroke for WLED-class lights in both views.
export const WLED_BORDER = "#c084fc";

// Mutates each light in place: sets l.code and l.isWled. Pass EVERY light
// entity (including hidden ones) so codes stay stable when visibility changes.
export function assignLightCodes(lights) {
  const sorted = [...lights].sort((a, b) => a.entity_id.localeCompare(b.entity_id));
  let w = 0, n = 0;
  const seriesCode = (idx) => {
    let letter = Math.floor(idx / 99);
    if (letter >= 22) letter++;              // skip 'W' — reserved for WLED
    return String.fromCharCode(65 + letter) + String((idx % 99) + 1).padStart(2, "0");
  };
  for (const l of sorted) {
    if (isWledLight(l)) {
      l.isWled = true;
      l.code = "W" + String((w++ % 99) + 1).padStart(2, "0");
    } else {
      l.isWled = false;
      l.code = seriesCode(n++);
    }
  }
  return lights;
}
