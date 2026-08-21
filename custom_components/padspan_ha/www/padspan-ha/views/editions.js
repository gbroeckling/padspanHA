// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
// See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
//
// Editions and tiers, on the frontend side — a mirror of licence.py, read
// from the settings payload (settings.tier / settings.edition / tier_floor)
// and never re-derived here.
//
//   EDITION  which build was downloaded: "full" (PadSpan HA / PadSpan Pro)
//            or "bright" (PadSpan Bright / PadSpan Bright Pro).  Visibility.
//   TIER     what the key says: free < bright < pro.  Capability.
//
// Every navigable surface is classified below, once. A Bright build renders
// the `lighting` surfaces only. The map is asserted TOTAL by
// tests/test_editions_map.py: add a view to panel.js and forget to classify
// it, and the suite goes red — that is the entire mechanism by which "the
// rest just flows" without anyone remembering Bright.

export const TIERS = ["free", "bright", "pro"];

export function tierAtLeast(tier, want) {
  const r = t => { const i = TIERS.indexOf(String(t || "").toLowerCase()); return i < 0 ? 0 : i; };
  return r(tier) >= r(want);
}

/** The effective tier the backend computed, off the settings payload. */
export function currentTier(settings) {
  const t = String((settings && settings.tier) || "").toLowerCase();
  return TIERS.includes(t) ? t : "free";
}

export function currentEdition(settings) {
  return String((settings && settings.edition) || "").toLowerCase() === "bright" ? "bright" : "full";
}

// The classification. `lighting` is what PadSpan Bright is; `presence` is
// everything the lighting product does not show. Health and Settings are
// lighting because a Bright install still has to be diagnosed and configured
// — both trim themselves by edition inside.
export const SURFACE_CLASS = Object.freeze({
  overview:    "presence",
  purelive:    "presence",
  follow:      "presence",
  objects:     "presence",
  devices:     "presence",
  bluetooth:   "presence",
  presence:    "presence",
  history:     "presence",
  monitor:     "presence",
  maps:        "lighting",
  events:      "presence",
  health:      "lighting",
  settings:    "lighting",
  manage:      "presence",
  debug:       "presence",
  diagnostics: "presence",
  qa:          "presence",
  training:    "presence",
  calibration: "presence",
  traceback:   "presence",
  forensics:   "presence",
  sandbox:     "presence",
  occupancy:   "presence",
  // The developer's install-base dashboard is about BOTH builds' installs,
  // but it is a presence-build surface: Bright has no Pro key to present.
  installbase: "presence",
});

/**
 * Which of `ids` a build shows. The full edition shows everything it is
 * handed. Bright shows the lighting surfaces — and the presence ones too when
 * the reveal switch is on (settings.bright_reveal_presence): hide-by-default,
 * never hidden for good.
 */
export function surfacesForEdition(ids, settings) {
  const edition = currentEdition(settings);
  if (edition !== "bright") return ids.slice();
  const reveal = !!(settings && settings.bright_reveal_presence);
  return ids.filter(id => reveal || SURFACE_CLASS[id] === "lighting");
}
