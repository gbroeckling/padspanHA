// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
// See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
//
// Find mistakes: the robot vacuum's card for findings only (the owner,
// 2026-11-24: "the robovac card could also have a mistake finder. Since it can
// go anywhere, have it find where radios are placed incorrectly", "maybe
// opening a separate card for finding only"). Opened by the robovac card's
// Find mistakes; the same sheet.
//
// What it shows comes from padspan_ha/vacuum_findings (vacuum_findings.py):
// the room location runs' points already stored, no extra driving. Each
// finding says which receiver, where it is placed, where the readings put it
// and how sure, with a link to Mapping's placement of that receiver. Nothing
// here moves anything.

const _fill = (s, v) => s.replace(/\{(\w+)\}/g, (m, k) => (v && Object.prototype.hasOwnProperty.call(v, k) ? String(v[k]) : m));
const { t, tn } = await import(`./i18n.js${new URL(import.meta.url).search}`)
  .catch(() => ({ t: _fill, tn: (n, one, other, v) => _fill(n === 1 ? one : other, { n, ...v }) }));
const { SHEET: C } = await import(`./robovac_card.js${new URL(import.meta.url).search}`);

let _open = null;

/** Close the findings card, if one is open. */
export function closeFindings(){
  if (!_open) return;
  const o = _open;
  _open = null;
  if (typeof window !== "undefined" && window.removeEventListener) window.removeEventListener("keydown", o.esc);
  try { o.overlay.remove(); } catch (_) { /* gone with the page */ }
}

/** The address that opens Mapping's placement of one receiver (panel.js ?receiver=). */
export function placementLink(source){
  return `/padspan-ha?view=maps&tab=edit&receiver=${encodeURIComponent(String(source || ""))}`;
}

/** Open the findings card. api: the host's use api ({hass}). */
export function openFindings(api){
  closeFindings();
  const hass = api && api.hass;
  const mk = (tag, style, text) => { const n = document.createElement(tag); if (style) n.style.cssText = style; if (text !== undefined) n.textContent = text; return n; };
  const overlay = mk("div", C.overlay), sheet = mk("div", C.sheet);
  sheet.className = "ps-robovac-findings";
  sheet.setAttribute("role", "dialog");
  sheet.setAttribute("aria-label", t("Find mistakes"));
  overlay.appendChild(sheet);
  overlay.addEventListener("click", (e) => { if (e.target === overlay) closeFindings(); });
  for (const ev of ["pointerdown", "pointerup", "wheel"]) sheet.addEventListener(ev, (e) => e.stopPropagation());
  const o = { overlay, sheet, esc: (e) => { if (e.key === "Escape") closeFindings(); } };
  _open = o;
  if (typeof window !== "undefined" && window.addEventListener) window.addEventListener("keydown", o.esc);

  function draw(body){
    while (sheet.firstChild) sheet.removeChild(sheet.firstChild);
    const head = mk("div", C.head), x = mk("button", C.close, "✕");
    x.type = "button"; x.title = t("Close");
    x.addEventListener("click", (e) => { e.stopPropagation(); closeFindings(); });
    head.append(mk("div", C.title, t("Find mistakes")), x);
    sheet.appendChild(head);
    sheet.appendChild(mk("div", C.muted, t("Where the robot's runs say each receiver is, from the tag's readings at the spots the robot stood on. Nothing is moved here.")));
    for (const n of body) sheet.appendChild(n);
  }
  const room = (r) => (r && r.room) || t("no room");

  function render(r){
    const out = [];
    if (!r.points) {
      out.push(mk("div", `${C.muted};margin-top:10px`, t("No room location run has added points yet. Start one on the robot's card first.")));
      return draw(out);
    }
    out.push(mk("div", `${C.muted};margin-top:4px`, tn(r.points, "From {n} robot spot.", "From {n} robot spots.")));
    for (const f of r.findings || []) {
      const box = mk("div", "margin-top:12px;padding:10px;border:1px solid rgba(251,191,36,.35);border-radius:10px");
      box.appendChild(mk("div", "font-weight:700;font-size:14px", f.name || f.source));
      if (f.kind === "other_floor") {
        box.appendChild(mk("div", C.warn, t("Placed on floor {placed}, yet it hears the robot strongly on floor {here} ({strong} spots, up to {dbm} dBm). It may be on the wrong floor.",
          { placed: f.placed.floor_id, here: f.found.floor_id, strong: f.strong, dbm: f.strongest_dbm })));
        if (f.found.room) box.appendChild(mk("div", "font-size:12px", t("On that floor the readings put it in {room}.", { room: f.found.room })));
      } else {
        box.appendChild(mk("div", "font-size:12px", t("Placed in {placed}. The readings put it in {found}, {d} m away.",
          { placed: room(f.placed), found: room(f.found), d: f.found.distance_m })));
        box.appendChild(mk("div", C.muted, t("How sure: {n} spots; the readings fit {before} dB off where it is placed, {after} dB off there.",
          { n: f.spots, before: f.rms_before, after: f.rms_after })));
      }
      const a = mk("a", "display:inline-block;margin-top:6px;font-size:12px;color:#5eead4", t("Open its placement"));
      a.href = placementLink(f.source);
      box.appendChild(a);
      out.push(box);
    }
    if (!(r.findings || []).length) {
      out.push(mk("div", "margin-top:10px;font-size:13px", (r.fine || []).length
        ? tn(r.fine.length, "No receiver looks misplaced: {n} checked.", "No receiver looks misplaced: {n} checked.")
        : t("No receiver was heard at enough spots to check yet.")));
    }
    if ((r.thin || []).length) {
      out.push(mk("div", `${C.muted};margin-top:10px`, t("Not enough readings to judge: {names}", { names: r.thin.map(x => `${x.name} (${x.spots})`).join(", ") })));
    }
    draw(out);
  }

  draw([mk("div", `${C.muted};margin-top:10px`, t("Looking…"))]);
  document.body.appendChild(overlay);
  if (hass && hass.callWS) {
    Promise.resolve(hass.callWS({ type: "padspan_ha/vacuum_findings" }))
      .then((r) => { if (_open === o) render(r || {}); })
      .catch((e) => { if (_open === o) draw([mk("div", C.warn, t("Could not read the findings: {why}", { why: String((e && e.message) || e) }))]); });
  }
  return o;
}
