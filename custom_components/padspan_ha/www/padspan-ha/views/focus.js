// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
//
// Basic's focused views (2026-10-30).
//
// Basic is for seeing who's where and setting the house up (plan, scale,
// rooms, receivers, calibration). When something Basic asks for lives on an
// expert screen (a room's outline in the Mapping editor, a receiver's place,
// the floor heights on 3D Stack, the usage report on Settings → Tracking), a
// link opens just that part: one card, or the editor with one tool, and one
// "← Back" to exactly where the link was. Nothing on it leads into the rest
// of the expert screen, and the mode stays Basic.
//
// state._focus = { view, tab, part, item, title, back }
//   view   "settings" | "maps"
//   tab    the tab the part is on (Settings: presence, atlas, ai;
//          Mapping: edit, stack)
//   part   Settings: the card's data-focus-part; Mapping → Edit: the one
//          tool (rooms, receivers); Mapping → 3D Stack: floor_heights
//   item   the room or receiver the link was about, where it has one
//   back   { view, label, focus } — the screen (and the focused view, for a
//          link inside one) that "← Back" returns to
//
// In Advanced and Development there is no focus: the same links open the
// full tab, as they always have. A menu pick, a mode change or any other
// screen opened (panel.js) forgets it.

// The screens a Basic link can come from, for the "← Back" button.
const BACK_LABELS = {
  overview: "Overview", follow: "Follow", rooms: "Rooms", receivers: "Receivers",
  calibration: "Calibration", settings: "Settings", maps: "Mapping", setup: "Setup",
  guests: "Guests", training: "Training", purelive: "Live Tracker",
};

// The parts a link can open. Settings cards carry data-focus-part="<part>"
// where they are built (settings.js); Mapping's are drawn by maps.js.
export const PARTS = {
  usageReport: { view: "settings", tab: "presence", part: "usage_report", title: "Help improve PadSpan" },
  guestTags:   { view: "settings", tab: "presence", part: "guest_tags", title: "Guest tags" },
  liveAboard:  { view: "settings", tab: "atlas", part: "la3d", title: "Live Aboard" },
  atlasHome:   { view: "settings", tab: "atlas", part: "atlas_overview", title: "The Atlas as Overview" },
  atlasWeather: { view: "settings", tab: "atlas", part: "atlas_weather", title: "Outdoor weather on the Atlas" },
  aiTask:      { view: "settings", tab: "ai", part: "ai_task", title: "AI" },
  roomOutline: { view: "maps", tab: "edit", part: "rooms", title: "Draw the room's outline" },
  receiverPlace: { view: "maps", tab: "edit", part: "receivers", title: "Place the receiver" },
  floorHeights: { view: "maps", tab: "stack", part: "floor_heights", title: "Floor heights" },
};

/** One of PARTS with what this link is about (the room, the receiver). */
export function part(key, extra) { return Object.assign({}, PARTS[key], extra || {}); }

/** Whether a link to an inherently expert screen (QA, the light builder,
 *  receiver tuning on Settings → Tracking) shows: not in Basic, where
 *  More tools still has those screens. The screens themselves don't change. */
export function expertLinks(state) { return !state || state.complexity !== "basic"; }

/** The focus that applies to `view` now, or null (not Basic, none, another screen's). */
export function focusFor(state, view) {
  const f = state && state._focus;
  if (!f || state.complexity !== "basic" || f.view !== view) return null;
  return f;
}

/** Open a part of an expert screen from a link. In Basic: only that part,
 *  with a way back. In Advanced / Development: the full tab, no focus. */
export function openFocus(ctx, f) {
  const st = ctx.state;
  const basic = st.complexity === "basic";
  const prev = basic ? (st._focus || null) : null;
  const from = st.view;
  if (f.view === "settings") st._settingsTab = f.tab;
  if (f.view === "maps") { st._mapsWizard = null; st.mapsTab = f.tab; }
  // The focus is set before the screen opens: showView (panel.js: highlights
  // the menu, loads the screen) may draw it at once, and a Basic Mapping
  // drawn without it would go back to Library and drop the link's room.
  st._focus = basic ? {
    view: f.view, tab: f.tab, part: f.part, item: f.item == null ? null : f.item,
    title: f.title || "",
    back: f.back || { view: from, label: BACK_LABELS[from] || "Back", focus: prev },
  } : null;
  if (from !== f.view && ctx.actions.showView) ctx.actions.showView(f.view, { keepFocus: true });
  st.view = f.view;
  if (ctx.actions.renderNav) ctx.actions.renderNav();
  // Advanced: the Mapping tab as these links always opened it (setMapsTab),
  // so the opt-in report's tab:maps/<tab> count stays as it was.
  if (!basic && f.view === "maps" && ctx.actions.setMapsTab) { ctx.actions.setMapsTab(f.tab); return; }
  ctx.actions.renderRooms();
}

/** "← Back": the screen the link was on, or the focused view it came from. */
export function focusBack(ctx) {
  const st = ctx.state;
  const b = (st._focus && st._focus.back) || { view: "overview" };
  st._focus = b.focus || null;
  if (b.view !== st.view && ctx.actions.showView) ctx.actions.showView(b.view, { keepFocus: !!b.focus });
  st.view = b.view;
  if (ctx.actions.renderNav) ctx.actions.renderNav();
  ctx.actions.renderRooms();
}

/** The bar over a focused part: "← Back to …" and what this is. */
export function focusBar(ctx, f) {
  const { el } = ctx.helpers;
  const label = (f.back && f.back.focus && f.back.focus.title) || (f.back && f.back.label) || "Back";
  // From a guided Setup step, Setup's own bar over the screen (setup.js
  // returnBar) is the one way back; this bar only says what this is.
  const viaSetup = !!ctx.state._setupReturn && f.back && f.back.view === "setup";
  const back = viaSetup ? null
    : el("button", { class: "btn inline", "data-focus-back": f.back ? f.back.view : "", style: "white-space:nowrap" }, "← Back to " + label);
  if (back) back.addEventListener("click", () => focusBack(ctx));
  return el("div", { class: "card", "data-focus-bar": f.view + "/" + f.tab + "/" + f.part,
    style: "display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:8px 12px;margin-bottom:12px" }, [
    back,
    el("div", { style: "font-weight:700;min-width:0" }, f.title || ""),
  ]);
}

/** The one part out of a built tab: the node marked data-focus-part="part". */
export function pickPart(root, part) {
  if (!root || !part) return null;
  if (root.getAttribute && root.getAttribute("data-focus-part") === part) return root;
  const stack = [...(root.children || root.childNodes || [])];
  while (stack.length) {
    const n = stack.shift();
    if (n.getAttribute && n.getAttribute("data-focus-part") === part) return n;
    for (const c of (n.children || n.childNodes || [])) stack.push(c);
  }
  return null;
}
