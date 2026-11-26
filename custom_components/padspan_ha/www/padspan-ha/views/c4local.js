// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
//
// OS 2 Local for Control4 from inside PadSpan (the owner, 2026-11-25): the specialty add-on c4local
// (editions.js ADDONS) is its own Home Assistant integration, and an administrator can install it
// here as well as with HACS. Two places:
//   settingsCard   Settings → Tracking → Home Assistant and integrations, data-focus-part "c4local":
//                  shown to an administrator once Home Assistant has Control4 (an entry, a discovered
//                  controller, or a control4 folder in custom_components) or the key holds the add-on.
//                  With PadSpan Pro or the add-on: Install, Check for an update, Update, Undo and
//                  Home Assistant's own restart, each behind a confirm. Without: a short offer, only
//                  while it is on sale (addonOnSale); nothing before.
//   overviewCard   the Overview's one card, when a Control4 entry failed to set up or a controller
//                  runs OS 2 and the product isn't installed: to Settings' card, or the offer.
// Nothing runs unless an administrator presses; the status is read once per page load
// (c4local_install.py; padspan_ha/c4local_status reads only). PadSpan never restarts Home
// Assistant by itself.
const { t } = await import(`./i18n.js${new URL(import.meta.url).search}`);
const ED = await import(`./editions.js${new URL(import.meta.url).search}`);
const FOCUS = await import(`./focus.js${new URL(import.meta.url).search}`)
  .catch(() => null);

export const NAME = "c4local";
const HA_CONFIGURE = "/config/integrations/integration/control4";
const HA_ADD = "/config/integrations/dashboard/add?domain=control4";
const NO_OFFER = "padspan_c4local_offer";   // localStorage: "no" once the Overview card's No thanks is pressed

let _status = null;     // padspan_ha/c4local_status's answer, once per page load
let _asked = false;
let _latest = null;     // the update check's answer: { latest, newer }
let _busy = "";         // "install" | "undo" | "check" | "restart" while one runs
let _note = null;       // { ok, text } after a press

const _admin = (ctx) => !!(ctx.hass && ctx.hass.user && ctx.hass.user.is_admin);
const _call = (ctx, type, data) => (ctx.actions.wsCall ? ctx.actions.wsCall(type, data || {}) : ctx.actions.callWS({ type, ...(data || {}) }));
const _rerender = (ctx) => { try { ctx.actions.renderRooms(); } catch (_) { /* nothing to draw */ } };
const _word = () => {
  const a = ED.ADDONS.find(x => x.name === NAME);
  return a ? a.words : "OS 2 Local for Control4";
};

/** The status, asked once per page load (force: again, after a press). Only for an administrator. */
export function load(ctx, force = false) {
  if (!_admin(ctx) || (_asked && !force)) return;
  _asked = true;
  _call(ctx, "padspan_ha/c4local_status")
    .then(r => { _status = r || null; _rerender(ctx); })
    .catch(() => { _status = null; });
}

/** For the tests and a fresh page: forget what was read. */
export function _reset(status = null) { _status = status; _asked = status !== null; _latest = null; _busy = ""; _note = null; }

/** Whether Home Assistant has Control4 at all: an entry, a discovered controller, or the folder. */
export function seen(st) {
  return !!st && ((st.entries || []).length > 0 || !!st.discovered || !!st.disk || !!st.running);
}
/** What PadSpan found worth saying: a Control4 entry that failed to set up, or a controller on OS 2. */
export function trouble(st) {
  return !!st && (!!st.failed || (st.os2 || []).length > 0);
}
const _ours = (st) => !!(st && st.disk && st.disk.ours);

// What a refusal says, by its code (c4local_install.py C4LocalError); its English message otherwise.
const ERRORS = {
  addon_required: () => t("This needs PadSpan Pro or the OS 2 Local for Control4 add-on."),
  busy: () => t("An install or undo is already running."),
  offline: () => t("GitHub couldn't be reached. Nothing was changed."),
  no_release: () => t("OS 2 Local for Control4 has no release on GitHub yet."),
  download_failed: () => t("The download didn't come from the product's GitHub release. Nothing was changed."),
  too_big: () => t("The download is far bigger than the product. Nothing was changed."),
  not_a_zip: () => t("The download is not the product's zip. Nothing was changed."),
  not_the_product: () => t("The download is not OS 2 Local for Control4. Nothing was changed."),
  not_a_folder: () => t("custom_components/control4 is not a plain folder. Nothing was changed."),
  not_ours: () => t("custom_components/control4 holds another integration, so PadSpan leaves it alone."),
  nothing: () => t("There is nothing to undo."),
  files_failed: () => t("The files couldn't be written. Check custom_components/control4."),
};
export function errorWords(e) {
  const code = e && (e.code || (e.error && e.error.code));
  if (code && ERRORS[code]) return ERRORS[code]();
  return String((e && (e.message || (e.error && e.error.message))) || t("That didn't work."));
}

// Why it exists, said plainly (README of the product).
const _why = () => t("Cloud services for Control4 OS 2 ended on November 1, 2026, and Home Assistant's built-in Control4 integration logs in through that cloud. OS 2 Local for Control4 logs in to the controller itself, with the controller's system password, and adds room volume, mute and off on OS 2.");

function _findings(el, st) {
  const out = [];
  for (const e of (st.entries || [])) {
    if (["setup_error", "setup_retry", "migration_error"].includes(e.state))
      out.push(t("Home Assistant's Control4 entry \"{name}\" failed to set up.", { name: e.title || "Control4" }));
  }
  // OS 2 is worth saying until the product is in; after that it is just how the house is.
  if (!_ours(st)) for (const v of (st.os2 || [])) out.push(t("Your Control4 controller runs OS {version}.", { version: v }));
  if (!out.length) return null;
  return el("div", { "data-c4local": "found", style: "font-size:12px;color:#fbbf24;line-height:1.5;margin-bottom:6px" },
    "⚠ " + out.join(" "));
}

function _offer(el, st, now) {
  if (!ED.addonOnSale(NAME, now)) return null;
  const a = ED.ADDONS.find(x => x.name === NAME);
  return el("div", { "data-c4local": "offer", style: "font-size:12px;line-height:1.6" }, [
    el("div", { style: "color:#cbd5e1" }, _why()),
    el("a", { href: a.url, target: "_blank", rel: "noopener", "data-c4local": "buy", style: "color:#a7f3d0;text-decoration:underline" },
      t("{addon}: {price}, once, for life. PadSpan Pro includes it.", { addon: a.words, price: a.price })),
  ]);
}

async function _press(ctx, what, type, done) {
  if (_busy) return;
  _busy = what; _note = null; _rerender(ctx);
  try {
    const r = await _call(ctx, type);
    if (r && r.status) _status = r.status;
    _note = done(r || {});
  } catch (e) {
    _note = { ok: false, text: errorWords(e) };
  } finally {
    _busy = "";
    _rerender(ctx);
  }
}

function _install(ctx) {
  const st = _status || {};
  const over = st.disk && !st.disk.ours;
  const q = over
    ? t("Download OS 2 Local for Control4 from its GitHub release and install it? custom_components/control4 holds another integration now: PadSpan moves it into a backup first, and Undo puts it back.")
    : t("Download OS 2 Local for Control4 from its GitHub release and install it? It takes the place of Home Assistant's built-in Control4 integration once Home Assistant restarts, and Undo takes it out again.");
  if (!confirm(q)) return;
  _press(ctx, "install", "padspan_ha/c4local_install", (r) => {
    _latest = null;
    return { ok: true, text: t("OS 2 Local for Control4 {version} is installed. Restart Home Assistant to load it.", { version: r.version || "" }) };
  });
}

function _undo(ctx) {
  const u = (_status && _status.undo) || {};
  const q = u.what === "restore"
    ? t("Put back the control4 folder that was there before ({name} {version})? Home Assistant loads it when it restarts.", { name: u.name || "control4", version: u.version || "" })
    : t("Remove OS 2 Local for Control4? Home Assistant's built-in Control4 integration comes back when Home Assistant restarts. Your Control4 entry and its entities stay, but on an OS 2 controller the built-in integration can't connect.");
  if (!confirm(q)) return;
  _press(ctx, "undo", "padspan_ha/c4local_undo", (r) => {
    _latest = null;
    return { ok: true, text: r.what === "restore"
      ? t("The earlier control4 folder is back. Restart Home Assistant to load it.")
      : t("OS 2 Local for Control4 is removed. Restart Home Assistant to bring back the built-in Control4 integration.") };
  });
}

function _check(ctx) {
  _press(ctx, "check", "padspan_ha/c4local_check", (r) => {
    _latest = { latest: r.latest, newer: !!r.newer };
    return null;
  });
}

function _restart(ctx) {
  if (!confirm(t("Restart Home Assistant now? Everything in Home Assistant stops for a minute or two while it starts again."))) return;
  _busy = "restart"; _rerender(ctx);
  // The connection drops while Home Assistant stops (home-assistant-js-websocket's ERR_CONNECTION_LOST, 3): that
  // is the restart going ahead. Any other refusal (an invalid configuration stops it) is said.
  const going = () => { _note = { ok: true, text: t("Home Assistant is restarting.") }; _rerender(ctx); };
  Promise.resolve()
    .then(() => ctx.hass.callService("homeassistant", "restart", {}))
    .then(going)
    .catch((e) => {
      if (e === 3 || (e && e.code === 3)) return going();
      _busy = ""; _note = { ok: false, text: errorWords(e) }; _rerender(ctx);
    });
}

function _btn(el, label, key, onclick, primary) {
  const b = el("button", { class: "btn inline" + (primary ? " primary" : ""), "data-c4local": key, style: "font-size:12px" }, label);
  if (_busy) b.disabled = true;
  b.addEventListener("click", onclick);
  return b;
}

function _link(el, href, label, key) {
  return el("a", { href, "data-c4local": key, style: "color:#a7f3d0;text-decoration:underline" }, label);
}

/** Settings → Tracking → Home Assistant and integrations: the card, or null (nothing to show). */
export function settingsCard(ctx, el, now = Date.now()) {
  if (!_admin(ctx)) return null;
  load(ctx);
  const st = _status;
  if (!st) return null;
  const settings = (ctx.state && ctx.state.settings) || {};
  const bought = ED.currentTier(settings) !== "pro" && ED.addonAllowed(settings, NAME);
  if (!seen(st) && !bought) return null;
  const card = el("div", { class: "card", "data-focus-part": "c4local", "data-c4local": "card" });
  card.appendChild(el("div", { style: "font-weight:700;font-size:14px;color:#52b788;margin-bottom:4px" }, _word()));
  const found = _findings(el, st);
  if (found) card.appendChild(found);
  if (!st.allowed) {
    const offer = _offer(el, st, now);
    if (!offer) return null;
    card.appendChild(offer);
    return card;
  }
  card.appendChild(el("div", { style: "font-size:12px;color:#94a3b8;line-height:1.5;margin-bottom:8px" }, _why()));
  const lines = el("div", { "data-c4local": "state", style: "font-size:12px;color:#cbd5e1;line-height:1.6;margin-bottom:8px" });
  const buttons = [];
  if (_ours(st)) {
    lines.appendChild(el("div", { "data-c4local": "installed" }, "✓ " + t("Installed: version {version}.", { version: st.disk.version })));
    if (_latest && _latest.newer) {
      lines.appendChild(el("div", { "data-c4local": "newer" }, t("Version {version} is out.", { version: _latest.latest })));
      buttons.push(_btn(el, _busy === "install" ? t("Updating…") : t("Update to {version}", { version: _latest.latest }), "update", () => _install(ctx), true));
    } else if (_latest) {
      lines.appendChild(el("div", { "data-c4local": "newest" }, t("This is the newest version.")));
    }
    if (!(_latest && _latest.newer)) buttons.push(_btn(el, _busy === "check" ? t("Checking…") : t("Check for an update"), "check", () => _check(ctx)));
    // How to use it: the key and the controller's password go into the entry's Configure.
    const hasEntry = (st.entries || []).length > 0;
    lines.appendChild(el("div", { "data-c4local": "setup", style: "margin-top:4px" }, hasEntry
      ? [t("To use it: open Settings → Devices & services → Control4 → Configure, and enter the controller's system password and your PadSpan key (an OS 2 Local for Control4 key or a PadSpan Pro key)."), " ",
         _link(el, HA_CONFIGURE, t("Open Control4"), "configure")]
      : [t("To use it: open Settings → Devices & services → Add integration → OS 2 Local for Control4, and enter the controller's IP address, the controller's system password and your PadSpan key (an OS 2 Local for Control4 key or a PadSpan Pro key)."), " ",
         _link(el, HA_ADD, t("Add Control4"), "add")]));
  } else {
    if (st.disk && !st.disk.ours)
      lines.appendChild(el("div", { "data-c4local": "other" }, t("custom_components/control4 holds another integration ({name}). Installing moves it into a backup first.", { name: st.disk.name || "control4" })));
    buttons.push(_btn(el, _busy === "install" ? t("Installing…") : t("Install OS 2 Local for Control4"), "install", () => _install(ctx), true));
  }
  if (st.undo && (st.undo.what === "remove" || st.undo.what === "restore"))
    buttons.push(_btn(el, _busy === "undo" ? t("Undoing…") : t("Undo"), "undo", () => _undo(ctx)));
  if (st.restart_needed) {
    lines.appendChild(el("div", { "data-c4local": "restart", style: "color:#fbbf24" }, t("Home Assistant loads the change when it restarts.")));
    buttons.push(_btn(el, _busy === "restart" ? t("Restarting…") : t("Restart Home Assistant"), "restart", () => _restart(ctx)));
  }
  if (lines.childNodes.length || (lines.children && lines.children.length)) card.appendChild(lines);
  if (_note && _note.text)
    card.appendChild(el("div", { "data-c4local": "note", style: "font-size:12px;margin-bottom:8px;color:" + (_note.ok ? "#a7f3d0" : "#fbbf24") }, _note.text));
  card.appendChild(el("div", { style: "display:flex;gap:8px;flex-wrap:wrap" }, buttons));
  return card;
}

function _noOffer() { try { return localStorage.getItem(NO_OFFER) === "no"; } catch (_) { return false; } }

/** The Overview's card: a Control4 entry failed to set up or a controller runs OS 2, the product is not
 *  installed, and an administrator can get it (Pro or the add-on) or buy it (on sale). Null otherwise. */
export function overviewCard(ctx, now = Date.now()) {
  if (!_admin(ctx) || _noOffer()) return null;
  const comps = (ctx.hass && ctx.hass.config && ctx.hass.config.components) || [];
  if (!_status && !comps.includes("control4")) return null;   // no Control4 in this Home Assistant: nothing asked
  load(ctx);
  const st = _status;
  if (!st || !trouble(st) || _ours(st)) return null;
  const { el } = ctx.helpers;
  const offer = st.allowed ? null : _offer(el, st, now);
  if (!st.allowed && !offer) return null;
  const card = el("div", { "data-c4local": "overview", style: "background:#0a1f14;border:1px solid #1a4228;border-radius:8px;padding:10px 14px;margin-bottom:12px" });
  card.appendChild(el("div", { style: "font-weight:700;font-size:13px;color:#52b788;margin-bottom:4px" }, _word()));
  const found = _findings(el, st);
  if (found) card.appendChild(found);
  const row = [];
  if (st.allowed) {
    card.appendChild(el("div", { style: "font-size:12px;color:#cbd5e1;line-height:1.55;margin-bottom:8px" }, _why()));
    const go = el("button", { class: "btn inline primary", "data-c4local": "open", style: "font-size:12px" }, t("Install it from Settings"));
    go.addEventListener("click", () => {
      ctx.state._presenceReveal = "integrations"; ctx.state._settingsPart = "c4local";
      if (FOCUS) FOCUS.openFocus(ctx, FOCUS.part("c4local", { back: { view: "overview", label: t("Overview") } }));
    });
    row.push(go);
  } else {
    card.appendChild(offer);
  }
  const no = el("button", { class: "btn inline", "data-c4local": "no", style: "font-size:12px;color:#94a3b8" }, t("No thanks"));
  no.addEventListener("click", () => { try { localStorage.setItem(NO_OFFER, "no"); } catch (_) { /* this page only */ } _rerender(ctx); });
  row.push(no);
  card.appendChild(el("div", { style: "display:flex;gap:8px;flex-wrap:wrap;margin-top:6px" }, row));
  return card;
}
