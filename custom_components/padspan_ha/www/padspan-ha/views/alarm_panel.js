// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
// See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
//
// The house's alarm on the emergency button (2026-11-23, the owner: "add the
// alarm control to the emergency button in the top right"). Home Assistant's
// alarm_control_panel entities, read from hass.states; nothing is stored.
//
//   the chip    beside the Atlas's emergency button (lights_panel.js
//               _emergencyOverlay): the alarm's state in words. Bright or Pro
//               (the owner, 2026-11-24): pressed, it opens the card. Free: no
//               chip, but while an alarm is going off a red line says so
//               there, as the leak, smoke, gas and CO alarms ring their rooms
//               on every tier.
//   the card    each alarm, its state, what set it off when the panel says
//               (Alarmo's open_sensors), and Arm (each mode the panel
//               supports) or Disarm. Every one asks first, with the panel's
//               code when it wants one (lights_map.js confirmAsk, the box an
//               unlock asks in): never one blind tap. Home Assistant's own
//               refusal (a wrong code) is said as it says it.
//   the banner  panel.js's red emergency banner, on every tab and every tier:
//               an alarm going off is a row in it (triggeredAlarms).
//
// The services are called from the browser with the person's own Home
// Assistant login, as a lock's are: anyone who can unlock a door here can arm
// the alarm, on a wall screen too. Nothing on the card leaves the page.
// Mounted on document.body, outside the hosts' shadow roots, so styled inline.
// Imports nothing but its words.

const _fill = (s, v) => s.replace(/\{(\w+)\}/g, (m, k) => (v && Object.prototype.hasOwnProperty.call(v, k) ? String(v[k]) : m));
const { t, tn } = await import(`./i18n.js${new URL(import.meta.url).search}`)
  .catch(() => ({ t: _fill, tn: (n, one, other, v) => _fill(n === 1 ? one : other, { n, ...v }) }));

export const DOMAIN = "alarm_control_panel";

// Home Assistant's AlarmControlPanelEntityFeature bits, and each arm mode's
// service and the state it arms to, in the order Home Assistant's own card
// lists them. TRIGGER (8) is not offered: setting the alarm off is not a
// household button.
export const ARM_MODES = [
  { mode: "armed_home", service: "alarm_arm_home", bit: 1, label: () => t("Arm home") },
  { mode: "armed_away", service: "alarm_arm_away", bit: 2, label: () => t("Arm away") },
  { mode: "armed_night", service: "alarm_arm_night", bit: 4, label: () => t("Arm night") },
  { mode: "armed_vacation", service: "alarm_arm_vacation", bit: 32, label: () => t("Arm vacation") },
  { mode: "armed_custom_bypass", service: "alarm_arm_custom_bypass", bit: 16, label: () => t("Arm custom bypass") },
];

const WORDS = {
  disarmed: () => t("Disarmed"), armed_home: () => t("Armed home"), armed_away: () => t("Armed away"),
  armed_night: () => t("Armed night"), armed_vacation: () => t("Armed vacation"),
  armed_custom_bypass: () => t("Armed custom bypass"), pending: () => t("Pending"), arming: () => t("Arming"),
  disarming: () => t("Disarming"), triggered: () => t("Triggered"), unavailable: () => t("Unavailable"),
};
/** A state in words; one Home Assistant may add later, as it is. */
export const stateWord = (state) => (WORDS[state] ? WORDS[state]() : (state ? String(state) : t("Unknown")));

/** How the chip looks: triggered, pending (an entry or exit delay), armed, disarmed, or off (no reading). */
export function stateKind(state){
  if (state === "triggered") return "triggered";
  if (state === "pending" || state === "arming" || state === "disarming") return "pending";
  if (String(state || "").startsWith("armed_")) return "armed";
  return state === "disarmed" ? "disarmed" : "off";
}
const URGENCY = ["triggered", "pending", "armed", "disarmed", "off"];

/** Every alarm_control_panel in the house: [{eid, name, state, attrs}], by name. */
export function alarmPanels(states){
  const out = [];
  for (const [eid, st] of Object.entries(states || {})) {
    if (!eid.startsWith(DOMAIN + ".") || !st) continue;
    const attrs = st.attributes || {};
    out.push({ eid, name: String(attrs.friendly_name || eid), state: String(st.state || ""), attrs });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name) || a.eid.localeCompare(b.eid));
}

/** The arm modes the panel says it supports (supported_features). */
export function armModes(attrs){
  const f = Number((attrs || {}).supported_features) || 0;
  return ARM_MODES.filter(m => (f & m.bit) === m.bit);
}

/** What the panel can be asked now: its arm modes while disarmed; Disarm while armed, arming, pending or going off. */
export function actionsFor(p){
  if (p.state === "disarmed") return armModes(p.attrs);
  if (stateKind(p.state) === "armed" || p.state === "arming" || p.state === "pending" || p.state === "triggered")
    return [{ mode: "disarmed", service: "alarm_disarm", label: () => t("Disarm") }];
  return [];
}

/** The code the panel wants for it: "number" or "text" (its code_format), or null. Arming asks for it unless the
 *  panel says code_arm_required false; disarming whenever it has a code. */
export function codeFor(attrs, arming){
  const a = attrs || {};
  if (!a.code_format) return null;
  if (arming && a.code_arm_required === false) return null;
  return a.code_format === "number" ? "number" : "text";
}

/** What set it off, by name, where the panel says: Alarmo's open_sensors ({entity_id: state}, or a list). An
 *  integration that says nothing: []. */
export function trippedBy(p, states){
  const raw = (p && p.attrs || {}).open_sensors;
  const ids = Array.isArray(raw) ? raw : raw && typeof raw === "object" ? Object.keys(raw) : typeof raw === "string" && raw ? [raw] : [];
  return ids.map(String).filter(Boolean)
    .map(e => String(((states || {})[e] && (states || {})[e].attributes || {}).friendly_name || e));
}

/** The alarms going off now, for panel.js's emergency banner: [{eid, text}]. */
export function triggeredAlarms(states){
  return alarmPanels(states).filter(p => p.state === "triggered").map(p => {
    const by = trippedBy(p, states);
    return { eid: p.eid, text: by.length ? t("Alarm going off: {name} · {sensors}", { name: p.name, sensors: by.join(", ") })
      : t("Alarm going off: {name}", { name: p.name }) };
  });
}

const ICON = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" '
  + 'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l7 3v5c0 4.5-3 8.2-7 10-4-1.8-7-5.5-7-10V6z"/></svg>';

/**
 * The chip beside the emergency button, or null: no alarm panel, or the free tier with nothing going off.
 * o: { el, panels, states, controls (Bright or Pro), onOpen }.
 */
export function alarmChip(o){
  const panels = o.panels || [];
  if (!panels.length) return null;
  const worst = panels.slice().sort((a, b) => URGENCY.indexOf(stateKind(a.state)) - URGENCY.indexOf(stateKind(b.state)))[0];
  const kind = stateKind(worst.state);
  if (!o.controls && kind !== "triggered") return null;
  const by = kind === "triggered" ? trippedBy(worst, o.states) : [];
  const word = stateWord(worst.state) + (by.length ? " · " + by.join(", ") : "");
  const title = panels.map(p => `${p.name}: ${stateWord(p.state)}`).join("\n");
  const icon = o.el("span", { class: "lv-alarm-ic" });
  icon.innerHTML = ICON;
  const kids = [icon, o.el("span", { class: "lv-alarm-tx" }, word)];
  if (panels.length > 1) kids.push(o.el("span", { class: "lv-alarm-n", "aria-hidden": "true" }, "×" + panels.length));
  const cls = "lv-alarm lv-alarm-" + kind;
  // Free: the alarm going off, said, and nothing to press.
  if (!o.controls) return o.el("div", { class: cls, role: "alert", title }, kids);
  return o.el("button", { class: cls, title, "aria-label": tn(panels.length, "Alarm: {state}", "{n} alarms: {state}", { state: word }),
    onclick: () => o.onOpen && o.onOpen() }, kids);
}

const C = {
  overlay: "position:fixed;inset:0;z-index:10000;background:rgba(3,8,5,.58);backdrop-filter:blur(6px);"
    + "-webkit-backdrop-filter:blur(6px);display:flex;justify-content:center;",
  sheet: "width:100%;max-width:520px;max-height:78vh;overflow:auto;padding:14px 16px 18px;box-sizing:border-box;"
    + "background:linear-gradient(180deg,#1f1010,#140b0b);border:1px solid rgba(220,38,38,.45);"
    + "color:#e2e8f0;font-family:Inter,system-ui,sans-serif;box-shadow:0 -12px 50px rgba(0,0,0,.6)",
  btn: "font-size:12px;font-weight:600;padding:6px 14px;border-radius:8px;cursor:pointer;min-height:34px;"
    + "background:rgba(255,255,255,.03);border:1px solid rgba(252,165,165,.3);color:rgba(254,226,226,.85)",
  chip: "display:inline-flex;align-items:center;padding:2px 8px;border-radius:999px;font-size:10px;font-weight:700;"
    + "letter-spacing:.04em;white-space:nowrap;",
};
const CHIP_LOOK = {
  triggered: "color:#fff;background:#dc2626;border:1px solid #fecaca",
  pending: "color:#111827;background:#fbbf24;border:1px solid #fbbf24",
  armed: "color:#bfdbfe;border:1px solid rgba(96,165,250,.55)",
  disarmed: "color:rgba(226,240,232,.7);border:1px solid rgba(226,240,232,.25)",
  off: "color:rgba(226,240,232,.4);border:1px dashed rgba(226,240,232,.25)",
};

/**
 * The card behind the chip. host: { el, states() (hass.states now), call(service, data) (hass.callService on the
 * alarm_control_panel domain), ask (lights_map.js confirmAsk), toast(msg, isError), errorText(e), count(word)
 * (the opt-in report: arm, disarm, refused), keys (dialog_keys.js or null), onClose }.
 * Returns { close, refresh, sheet, overlay }: refresh refills it when what it shows changed (never under a finger),
 * and closes it once the house has no alarm.
 */
export function openAlarmCard(host){
  const el = host.el;
  const desktop = typeof window !== "undefined" && window.innerWidth > 768;
  const overlay = document.createElement("div");
  overlay.style.cssText = C.overlay + `align-items:${desktop ? "center" : "flex-end"}`;
  const sheet = el("div", { class: "ps-alarm-card", style: C.sheet + `;border-radius:${desktop ? "16px" : "18px 18px 0 0"}` });
  overlay.appendChild(sheet);
  let release = () => {}, down = false, shown = null, busy = null, closed = false;
  const close = () => { if (closed) return; closed = true; overlay.remove(); release(); if (host.onClose) host.onClose(); };
  overlay.addEventListener("click", e => { if (e.target === overlay) close(); });
  overlay.addEventListener("pointerdown", () => { down = true; });
  for (const ev of ["pointerup", "pointercancel", "pointerleave"]) overlay.addEventListener(ev, () => { down = false; });
  const panelsNow = () => alarmPanels(host.states());
  const shows = () => JSON.stringify([panelsNow().map(p => [p.eid, p.name, p.state, p.attrs.supported_features,
    p.attrs.code_format, p.attrs.code_arm_required, trippedBy(p, host.states())]), busy]);
  const act = async (p, a) => {
    if (busy) return;
    const arming = a.mode !== "disarmed";
    const label = a.label();
    const q = arming ? t("{action}: {name}?", { action: label, name: p.name }) : t("Disarm {name}?", { name: p.name });
    const ans = await host.ask(q, label, { code: codeFor(p.attrs, arming) });
    if (ans === false || closed) return;
    const data = { entity_id: p.eid };
    if (typeof ans === "string") data.code = ans;
    busy = p.eid; fill();
    try {
      await host.call(a.service, data);
      host.count(arming ? "arm" : "disarm");
    } catch (e) {
      host.count("refused");
      host.toast(t("{name} refused: {why}", { name: p.name, why: host.errorText(e) }), true);
    } finally {
      busy = null;
      if (!closed) fill();
    }
  };
  const fill = () => {
    const panels = panelsNow();
    if (!panels.length) { close(); return; }
    shown = shows();
    const states = host.states();
    while (sheet.firstChild) sheet.removeChild(sheet.firstChild);
    sheet.appendChild(el("div", { style: "display:flex;justify-content:space-between;align-items:flex-start;gap:10px;margin-bottom:6px" }, [
      el("div", { style: "font-weight:800;font-size:16px;letter-spacing:-.01em" }, tn(panels.length, "Alarm", "Alarms")),
      el("button", { style: C.btn, title: t("Close"), onclick: close }, "✕"),
    ]));
    for (const p of panels) {
      const kind = stateKind(p.state);
      const by = kind === "triggered" ? trippedBy(p, states) : [];
      const rows = [el("div", { style: "display:flex;align-items:center;gap:8px" }, [
        el("span", { style: "flex:1;font-size:13px;font-weight:600;min-width:0;overflow:hidden;text-overflow:ellipsis" }, p.name),
        el("span", { style: C.chip + CHIP_LOOK[kind] }, stateWord(p.state)),
      ])];
      if (by.length) rows.push(el("div", { style: "font-size:12px;color:#fecaca;margin-top:4px" }, t("Set off by {sensors}", { sensors: by.join(", ") })));
      const acts = actionsFor(p);
      const mine = busy === p.eid;
      if (acts.length) rows.push(el("div", { style: "display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-top:8px",
        "aria-busy": mine ? "true" : null }, [
        ...acts.map(a => el("button", { style: C.btn + (a.mode === "disarmed" ? ";background:#7f1d1d;border-color:#dc2626;color:#fff" : "")
          + (busy ? ";opacity:.55;cursor:progress" : ""), "data-alarm-action": a.service, onclick: () => act(p, a) }, a.label())),
        ...(mine ? [el("span", { style: "font-size:12px;color:rgba(254,226,226,.75)" }, t("Sending…"))] : []),
      ]));
      sheet.appendChild(el("div", { style: "padding:10px 2px;border-bottom:1px solid rgba(252,165,165,.1)", "data-alarm": p.eid }, rows));
    }
    sheet.appendChild(el("div", { style: "font-size:11px;color:rgba(226,240,232,.5);line-height:1.5;margin-top:10px" },
      t("Each one asks first, with the alarm's code when it has one.")));
  };
  const refresh = () => { if (!closed && !down && shows() !== shown) fill(); };
  fill();
  if (closed) return null;
  document.body.appendChild(overlay);
  if (host.keys) release = host.keys.holdKeys(sheet, { close, modal: true });
  return { close, refresh, sheet, overlay };
}
