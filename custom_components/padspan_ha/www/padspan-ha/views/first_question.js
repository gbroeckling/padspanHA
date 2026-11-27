// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
// See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
//
// The first-run question (the owner, 2026-11-26, his words): "What do you want PadSpan for?", any of four answers, each
// opening its own first step. Asked once, on a new install's first run only, at the top of the Overview (panel.js), in
// any data mode (a new install opens on the sample house until a receiver is heard; its answers pass there, panel.js
// _sampleKind), to an administrator and never on a wall screen; Skip ends it. The backend makes it due for a settings
// store made fresh (settings_store, purpose_ask "due"); an answer makes it "done" and Skip "skipped" (ws_settings), so an
// install from before is never asked out of the blue. Settings → Appearance has the same choice, for an administrator,
// and changes it later. Stored as settings.purpose: the keys ticked, the first ticked first (onboarding.PURPOSE_KEYS,
// the same keys in the same order). Each answer's first step:
//   whole_house  the Atlas (the sidebar page), then the wall screen tip
//   presence     the Overview's "Who's where now" where it shows (live, no rooms drawn); else the Receivers page, with
//                a line on why receivers come first
//   plan         Mapping → Upload with "No floor plan?" open at the iPhone or iPad scan
//   lights       the Atlas builder's tour (Mapping → Atlas builder); in Basic, which has no builder, the Atlas. With no
//                rooms drawn there is nothing to place lights in: the plan first, the builder offered as the next step
// Several answers: the first ticked opens, and the Getting started card offers the rest as next steps (nextSteps).

const V = new URL(import.meta.url).search;
const { t } = await import(`./i18n.js${V}`);

export const PURPOSES = Object.freeze(["whole_house", "presence", "plan", "lights"]);
export const QUESTION = () => t("What do you want PadSpan for?");
export const LABELS = () => ({
  whole_house: t("The whole house on one screen"),
  presence: t("Who's in which room"),
  plan: t("My floor plan and 3D house"),
  lights: t("Every light in its place"),
});
// The Atlas page's own address (panel.py, frontend_url_path), and the same page as a wall screen (views/wall_scale.js).
export const ATLAS_PATH = "/padspan-lights";
export const WALL_PATH = "/padspan-lights?kiosk=1";

const isAdmin = (ctx) => !!(ctx.hass && ctx.hass.user && ctx.hass.user.is_admin);
/** Rooms drawn on a plan (the model's room outlines): what the Atlas builder places lights in. */
const hasRooms = (state) => Object.keys((state && state.model && state.model.room_geometry_m) || {}).length > 0;

/** The keys ticked, each once, in their order (the backend keeps the same). */
export function picked(settings) {
  const out = [];
  for (const k of Array.isArray(settings && settings.purpose) ? settings.purpose : []) {
    if (PURPOSES.includes(k) && !out.includes(k)) out.push(k);
  }
  return out;
}

/** Asked now: the backend says it is due (a new install's first run only), to an administrator, never on a wall. */
export function due(ctx) {
  const s = ctx.state.settings || {};
  return s.purpose_ask === "due" && !ctx.state.kioskMode && isAdmin(ctx);
}

/** Home Assistant's own router, as the panel opens one of its pages (settings.js, rooms.js), else a plain load. */
function goTo(path) {
  try { history.pushState(null, "", path); window.dispatchEvent(new CustomEvent("location-changed", { detail: { replace: false } })); }
  catch (_) { try { window.location.assign(path); } catch (__) { /* stays here */ } }
}

function openAtlas(ctx) {
  // The Atlas is in the sidebar unless someone took it out (Settings → Atlas).
  if (ctx.state.settings && ctx.state.settings.lights_panel_enabled === false) {
    ctx.state._settingsTab = "atlas";
    ctx.actions.showView("settings");
    return;
  }
  goTo(ATLAS_PATH);
}

function openPlan(ctx) {
  const st = ctx.state;
  // Mapping → Upload, the ways to a plan open at the scan (rough_plan.js keeps its state in _roughPlan).
  st._mapsWizard = null;
  // rough_plan.js's own defaults first: a new install has no _roughPlan yet, and its blank floor reads across/down.
  st._roughPlan = { across: "", down: "", busy: false, ...(st._roughPlan || {}), open: true, kind: "scan", msg: "", walk: null };
  st.mapsTab = "upload";
  ctx.actions.showView("maps");
}

/** The Atlas builder and its tour; in Basic, which has no builder (views/maps.js), the Atlas with its own tips. */
function openLights(ctx) {
  const st = ctx.state;
  if (st.complexity === "basic") { openAtlas(ctx); return; }
  st._mapsWizard = null;
  st.mapsTab = "lights";
  st._lightsTour = { step: 1 };
  if (ctx.actions.telemetryEvent) ctx.actions.telemetryEvent("lights_tour_opened");
  ctx.actions.showView("maps");
}

/** Each answer's first step. */
export function openStep(ctx, key) {
  const st = ctx.state;
  if (key === "whole_house") { openAtlas(ctx); return; }
  if (key === "presence") {
    // "Who's where now" (views/whos_where.js) is the Overview's own first step for a live house with no rooms drawn.
    if (st.dataMode === "live" && st.live && st.live.snapshot && !hasRooms(st)) {
      ctx.actions.showView("overview");
      ctx.toast(t("Who's where now, on the Overview, shows each receiver's room and who is in it."));
      return;
    }
    ctx.actions.showView("receivers");
    ctx.toast(t("Rooms come from your Bluetooth receivers: each one hears who is near it. Give each one its room here."));
    return;
  }
  if (key === "plan") { openPlan(ctx); return; }
  if (key === "lights") {
    // Nothing to place lights in yet: the plan first (nextSteps offers the builder after it).
    if (!hasRooms(st)) { openPlan(ctx); return; }
    openLights(ctx);
  }
}

/** The next steps after answering: the first answer's own next step (the wall screen tip after the Atlas; the Atlas
 *  builder after the plan the lights answer opened, with no rooms drawn), then each other answer's first step. The
 *  phone is not one: Getting started lists it as its own step. */
export function nextSteps(settings, state) {
  const keys = picked(settings);
  if (!keys.length) return [];
  const labels = LABELS();
  const out = [];
  const lightsFirstPlan = keys[0] === "lights" && !hasRooms(state);
  if (keys[0] === "whole_house") out.push({ id: "wall", label: t("Put it on a wall screen"), link: WALL_PATH,
    tip: t("Open {path} on the screen: the whole house fits it. Settings → Atlas → Wall screens sizes it for the room.", { path: "\u0000" }) });
  if (lightsFirstPlan) out.push({ id: "lights", label: t("Then place your lights in the Atlas builder"), open: openLights });
  for (const k of keys.slice(1)) {
    if (lightsFirstPlan && k === "plan") continue;   // the plan step is already open
    out.push({ id: k, label: labels[k], open: (ctx) => openStep(ctx, k) });
  }
  return out;
}

/** The four answers as tick boxes, in their order: rows a finger can hit (36 px at least). `order` is the list ticked
 *  so far (the first ticked first); onChange(order) after each tick. */
function answers(ctx, order, onChange, attr) {
  const { el } = ctx.helpers;
  const labels = LABELS();
  const box = el("div", { style: "display:flex;flex-direction:column;gap:2px;margin:6px 0 8px" });
  for (const k of PURPOSES) {
    const c = el("input", { type: "checkbox", [attr]: k, style: "width:18px;height:18px;margin:0;flex:none" });
    c.checked = order.includes(k);
    c.addEventListener("change", () => {
      const i = order.indexOf(k);
      if (c.checked && i < 0) order.push(k);
      if (!c.checked && i >= 0) order.splice(i, 1);
      onChange(order);
    });
    box.appendChild(el("label", { "data-purpose-row": k,
      style: "display:flex;align-items:center;gap:10px;min-height:36px;padding:2px 4px;font-size:14px;color:#e2e8f0;cursor:pointer" }, [c, labels[k]]));
  }
  return box;
}

/** The question, at the top of the Overview. Start saves the answers and opens the first ticked one's step; Skip ends
 *  the asking. Either way it is never asked again (the backend's purpose_ask "done" or "skipped"). */
export function askCard(ctx) {
  const { el } = ctx.helpers;
  const order = [];
  const card = el("div", { "data-first-question": "card", style: "margin:0 0 12px;padding:12px 14px;background:#0f2a1a;border:1px solid #2d5a3d;border-radius:8px" });
  card.appendChild(el("div", { style: "font-weight:700;font-size:15px;color:#e2e8f0" }, QUESTION()));
  card.appendChild(el("div", { style: "font-size:12px;color:#94a3b8;margin-top:2px" },
    t("Tick any. Each opens its own first step, and Settings → Appearance changes it later.")));
  const start = el("button", { class: "btn inline primary", "data-first-question": "start" }, t("Start"));
  start.disabled = true;
  card.appendChild(answers(ctx, order, (o) => { start.disabled = !o.length; }, "data-purpose"));
  const save = async (payload) => {
    start.disabled = skip.disabled = true;
    try { await ctx.actions.settingsSet(payload); return true; }
    catch (e) { ctx.toast(t("Failed to save setting"), true); start.disabled = !order.length; skip.disabled = false; return false; }
  };
  start.addEventListener("click", async () => {
    if (!order.length) return;
    const first = order[0];
    if (await save({ purpose: order.slice() })) openStep(ctx, first);
  });
  const skip = el("button", { class: "btn inline", "data-first-question": "skip", style: "color:#94a3b8" }, t("Skip"));
  skip.addEventListener("click", () => { save({ purpose_ask: "skipped" }); });
  card.appendChild(el("div", { style: "display:flex;gap:8px;flex-wrap:wrap" }, [start, skip]));
  return card;
}

/** The next steps on the Getting started card, once answered: null with none. */
export function nextCard(ctx) {
  const steps = nextSteps(ctx.state.settings, ctx.state);
  if (!steps.length) return null;
  const { el } = ctx.helpers;
  const box = el("div", { "data-first-question": "next", style: "margin:0 0 8px;font-size:12px;color:#cbd5e1;line-height:1.55" });
  box.appendChild(el("div", { style: "font-weight:700;color:#52b788;margin-bottom:2px" }, t("Your next steps")));
  for (const s of steps) {
    if (s.tip) {
      // The tip's {path} as a link to the wall screen's page.
      const [before, after = ""] = s.tip.split("\u0000");
      box.appendChild(el("div", { "data-next": s.id }, [`${s.label}: ${before}`,
        el("a", { href: s.link, target: "_blank", rel: "noopener", "data-next-link": s.id, style: "color:#5eead4" }, s.link), after]));
      continue;
    }
    const b = el("span", { "data-next": s.id, ...(ctx.helpers.asButton || {}), style: "cursor:pointer;color:#5eead4;text-decoration:underline;margin-right:12px" }, s.label);
    b.addEventListener("click", () => s.open(ctx));
    box.appendChild(b);
  }
  return box;
}

/** Settings → Appearance: the same four answers, for every install, saved as they are ticked. An administrator's:
 *  null for anyone else. */
export function settingsCard(ctx) {
  if (!isAdmin(ctx)) return null;
  const { el } = ctx.helpers;
  const card = el("div", { class: "card", "data-first-question": "settings" });
  card.appendChild(el("div", { style: "font-weight:700" }, QUESTION()));
  card.appendChild(el("div", { class: "muted", style: "font-size:12px;margin-top:4px" },
    t("Tick any. The first ticked comes first. With the usage report on, the answers go with it as words.")));
  const order = picked(ctx.state.settings);
  card.appendChild(answers(ctx, order, async (o) => {
    try { await ctx.actions.settingsSet({ purpose: o.slice() }); }
    catch (e) { ctx.toast(t("Failed to save setting"), true); }
  }, "data-purpose-setting"));
  return card;
}
