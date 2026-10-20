// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
//
// Home Assistant's own sidebar, hidden or shown from PadSpan (the panel's
// Hide HA beside Toggle, the sidebar Atlas's beside Refresh). It is the
// frontend's "hass-dock-sidebar" event, the switch behind Profile > "Always
// hide the sidebar", which Home Assistant keeps per browser. Hiding remembers
// what it was (docked or auto); showing puts that back.

const BEFORE = "padspan_ha_dock_before";

/** "docked" | "auto" | "always_hidden", as Home Assistant has it now. */
export const haDock = (hass) => (hass && hass.dockedSidebar) || "docked";

/** Is Home Assistant's sidebar hidden? */
export const haHidden = (hass) => haDock(hass) === "always_hidden";

/** The button's word for what it would do. */
export const haLabel = (hass) => (haHidden(hass) ? "Show HA" : "Hide HA");

/** Hide or show it, from `el` (any element inside the panel); returns the
 *  opt-in report's word for what was done. */
export function toggleHaSidebar(el, hass) {
  const hidden = haHidden(hass);
  let dock = "always_hidden";
  if (hidden) {
    try { dock = localStorage.getItem(BEFORE) || "docked"; } catch (e) { dock = "docked"; }
    if (dock !== "auto") dock = "docked";
  } else {
    try { localStorage.setItem(BEFORE, haDock(hass)); } catch (e) {}
  }
  el.dispatchEvent(new CustomEvent("hass-dock-sidebar", { detail: { dock }, bubbles: true, composed: true }));
  return hidden ? "ha_sidebar:shown" : "ha_sidebar:hidden";
}
