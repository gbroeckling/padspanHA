// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
// See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
//
// The robovac card: the robot vacuum's own card, opened by pressing and
// holding the robot on the Atlas, flat (atlas_aboard.js) or in 3D
// (live_aboard_use.js). A tap there still shows its small card.
//
// 2026-11-24, the owner: "Use the robot optionally as a room location
// enhancement tool. Build that into the robovac card. Again press and hold on
// a map to surface [it]"; and "Are we not building the Valetudo's API into
// PadSpan?": everything here goes to the robot's own Valetudo through
// PadSpan's backend (ws_vacuum.py, vacuum_run.py), never through a Home
// Assistant vacuum entity, and the browser never calls the robot itself.
//
//   the robot   what Valetudo says it is doing and its battery, read every
//               POLL_MS only while the card is open; Start, Pause, Dock
//   room location (the rest)  what a run needs and what is missing (the
//               robot's address, its map from Valetudo, the tag stuck on it
//               and whether that tag is heard now), Start a run (every room
//               or one), its progress and Stop, the last run and Undo this run
//
// Everything on it reaches the robot or calibration, so it is an
// administrator's, as every vacuum command is (ws_vacuum.py require_admin);
// anyone else sees where the robot is and says so. Mounted on document.body,
// outside the hosts' shadow roots, so styled inline (lights_map.js's sheets).
// Imports nothing but its words.

const _fill = (s, v) => s.replace(/\{(\w+)\}/g, (m, k) => (v && Object.prototype.hasOwnProperty.call(v, k) ? String(v[k]) : m));
const { t, tn } = await import(`./i18n.js${new URL(import.meta.url).search}`)
  .catch(() => ({ t: _fill, tn: (n, one, other, v) => _fill(n === 1 ? one : other, { n, ...v }) }));

export const POLL_MS = 3000;
// The sheet's look, shared with its findings card (robovac_findings.js).
export const SHEET = {
  overlay: "position:fixed;inset:0;z-index:10000;background:rgba(3,8,5,.58);backdrop-filter:blur(6px);"
    + "-webkit-backdrop-filter:blur(6px);display:flex;justify-content:center;align-items:flex-end",
  sheet: "width:100%;max-width:520px;max-height:82vh;overflow:auto;padding:14px 16px 18px;box-sizing:border-box;"
    + "background:linear-gradient(180deg,#101f15,#0b1710);border:1px solid rgba(120,190,155,.26);"
    + "border-radius:18px 18px 0 0;color:#e2e8f0;font:13px/1.45 Inter,system-ui,sans-serif;box-shadow:0 -12px 50px rgba(0,0,0,.6)",
  head: "display:flex;justify-content:space-between;align-items:flex-start;gap:10px;margin-bottom:6px",
  title: "font-weight:800;font-size:16px;color:#5eead4",
  muted: "font-size:12px;color:#94a3b8",
  h: "font-weight:700;font-size:14px;margin:14px 0 4px;padding-top:10px;border-top:1px solid rgba(120,190,155,.15)",
  row: "display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin:6px 0",
  btn: "font-size:12px;font-weight:600;padding:6px 14px;border-radius:8px;cursor:pointer;min-height:34px;"
    + "background:rgba(255,255,255,.03);border:1px solid rgba(120,190,155,.18);color:rgba(226,240,232,.85)",
  primary: "font-size:12px;font-weight:600;padding:6px 14px;border-radius:8px;cursor:pointer;min-height:34px;"
    + "color:#e2e8f0;background:#2d6a4f;border:1px solid #52b788",
  input: "font-size:12px;padding:5px 8px;border-radius:6px;border:1px solid rgba(120,190,155,.25);background:#0a140e;color:#e2e8f0;min-width:200px",
  warn: "font-size:12px;color:#fbbf24",
  close: "all:unset;cursor:pointer;padding:0 4px;font-size:18px;line-height:1;color:rgba(226,240,232,.7)",
};
const C = SHEET;

// What Valetudo's StatusStateAttribute says, in words.
const STATUS = {
  docked: () => t("Docked"), idle: () => t("Idle"), cleaning: () => t("Cleaning"),
  returning: () => t("Returning to its dock"), paused: () => t("Paused"), moving: () => t("Moving"),
  manual_control: () => t("Under manual control"), error: () => t("Error"),
};
// How a run ended.
const ENDED = {
  finished: () => t("finished"), stopped: () => t("stopped"), failed: () => t("ended by a problem"),
  time_limit: () => t("stopped at the two-hour limit"), interrupted: () => t("ended by a restart"),
  running: () => t("running"),
};
// A refusal's code (vacuum_run.py RunRefused, RobotError) in words.
const REFUSED = {
  busy: () => t("A run is going: stop it first."),
  no_map: () => t("Import the robot's map from Valetudo first."),
  no_address: () => t("Give the robot's address first."),
  no_tag: () => t("Name the tag on the robot first."),
  not_ready: () => t("PadSpan is still loading. Try again in a moment."),
  no_spots: () => t("No room on the robot's map has a spot clear of its walls."),
  backup_failed: () => t("Calibration could not be backed up, so the run did not start."),
  auth: () => t("The robot asked for its Valetudo user name and password (HTTP 401). Enter the ones set in Valetudo."),
  unreachable: () => t("The robot did not answer. Is it on and on the network?"),
  robot_error: () => t("The robot reported an error."),
  not_found: () => t("That run is no longer in the list."),
  undone: () => t("That run was undone already."),
};
const words = (code, text) => (REFUSED[code] ? REFUSED[code]() : String(text || code || ""));
const errWords = (e) => words(e && e.code, e && (e.message || e));

let _open = null;

/** Close the card, if one is open. */
export function closeRobovacCard(){
  if (!_open) return;
  const o = _open;
  _open = null;
  if (o.timer) clearTimeout(o.timer);
  if (typeof window !== "undefined" && window.removeEventListener) window.removeEventListener("keydown", o.esc);
  try { o.overlay.remove(); } catch (_) { /* gone with the page */ }
}

/** The card as it is now: {admin, status, text} (for the tests). */
export function robovacCardState(){
  return _open ? { admin: _open.admin, status: _open.st.status, text: _open.sheet.textContent } : null;
}

/**
 * Open the robot's card.
 * api   the host's use api: {hass (callWS, user), toast(text, bad)}
 * info  optional: {lines} the small card's lines (where its map says it is, when seen)
 */
export function openRobovacCard(api, info){
  closeRobovacCard();
  const hass = api && api.hass;
  const admin = !!(hass && hass.user && hass.user.is_admin);
  const toast = (m, bad) => { try { if (api && api.toast) api.toast(m, bad); } catch (_) { /* the host's */ } };
  const call = (type, data) => hass.callWS({ type: `padspan_ha/${type}`, ...(data || {}) });
  const mk = (tag, style, text) => { const n = document.createElement(tag); if (style) n.style.cssText = style; if (text !== undefined) n.textContent = text; return n; };
  const overlay = mk("div", C.overlay), sheet = mk("div", C.sheet);
  sheet.className = "ps-robovac-card";
  sheet.setAttribute("role", "dialog");
  sheet.setAttribute("aria-label", t("Robot vacuum"));
  overlay.appendChild(sheet);
  overlay.addEventListener("click", (e) => { if (e.target === overlay) closeRobovacCard(); });
  for (const ev of ["pointerdown", "pointerup", "wheel"]) sheet.addEventListener(ev, (e) => e.stopPropagation());
  // draft: what was typed in the card's boxes, kept while the card is drawn again on each read.
  const st = { status: null, err: null, rooms: null, room: "", edit: false, draft: {} };
  const o = { overlay, sheet, admin, st, timer: null, esc: (e) => { if (e.key === "Escape") closeRobovacCard(); } };
  _open = o;
  if (typeof window !== "undefined" && window.addEventListener) window.addEventListener("keydown", o.esc);

  const button = (text, act, primary, disabled) => {
    const b = mk("button", primary ? C.primary : C.btn, text);
    b.type = "button";
    b.disabled = !!disabled;
    if (disabled) b.style.opacity = "0.45";
    b.addEventListener("click", async (e) => {
      e.stopPropagation();
      if (b.disabled) return;
      b.disabled = true;
      try { await act(); } finally { b.disabled = false; }
    });
    return b;
  };
  const input = (key, value, placeholder, type) => {
    const i = mk("input", C.input);
    i.type = type || "text"; i.value = st.draft[key] ?? (value || ""); i.placeholder = placeholder || "";
    i.addEventListener("keydown", (e) => e.stopPropagation());
    i.addEventListener("input", () => { st.draft[key] = i.value; });
    return i;
  };
  // Typing in one of its boxes: the read every POLL_MS does not draw the card again under the cursor.
  const typing = () => {
    const a = typeof document !== "undefined" ? document.activeElement : null;
    return !!(a && a !== sheet && typeof sheet.contains === "function" && sheet.contains(a) && (a.localName === "input" || a.localName === "select"));
  };

  async function refresh(rooms){
    if (!admin || _open !== o) return;
    try {
      const s = await call("vacuum_robot_status", rooms ? { rooms: true } : {});
      if (_open !== o) return;
      if (s && s.rooms) st.rooms = s.rooms;
      st.status = s; st.err = null;
    } catch (e) { if (_open !== o) return; st.err = errWords(e); }
    if (!typing()) render();
    if (_open === o) { if (o.timer) clearTimeout(o.timer); o.timer = setTimeout(() => refresh(!st.rooms), POLL_MS); }
  }
  // A button's work, then the card read again.
  const doing = (fn, ok) => async () => {
    try { const r = await fn(); const m = typeof ok === "function" ? ok(r) : ok; if (m) toast(m); }
    catch (e) { toast(errWords(e), true); }
    await refresh(false);
  };

  function render(){
    if (_open !== o) return;
    while (sheet.firstChild) sheet.removeChild(sheet.firstChild);
    const head = mk("div", C.head), name = mk("div", C.title, t("Robot vacuum")), x = mk("button", C.close, "✕");
    x.type = "button"; x.title = t("Close");
    x.addEventListener("click", (e) => { e.stopPropagation(); closeRobovacCard(); });
    head.append(name, x);
    sheet.appendChild(head);
    for (const l of (info && Array.isArray(info.lines) ? info.lines : [])) sheet.appendChild(mk("div", C.muted, l));
    if (!admin) {
      sheet.appendChild(mk("div", `${C.muted};margin-top:8px`, t("Only an administrator can reach the robot from here.")));
      return;
    }
    const s = st.status;
    if (!s) { sheet.appendChild(mk("div", `${C.muted};margin-top:8px`, st.err || t("Reading the robot…"))); return; }
    const running = !!s.run;

    // ── the robot ──
    const rs = s.state;
    if (rs && rs.error) {
      sheet.appendChild(mk("div", `${C.warn};margin-top:8px`, words(rs.error, rs.text)));
    } else if (rs) {
      const said = rs.status ? (STATUS[rs.status] ? STATUS[rs.status]() : rs.status) : t("Status unknown");
      const bat = typeof rs.battery === "number" ? " · " + t("battery {n} %", { n: rs.battery }) + (rs.charging ? " " + t("(charging)") : "") : "";
      sheet.appendChild(mk("div", "font-size:14px;font-weight:700;margin-top:8px", said + bat));
      const row = mk("div", C.row);
      row.append(
        button(t("Start"), doing(() => call("vacuum_robot_control", { action: "start" })), false, running),
        button(t("Pause"), doing(() => call("vacuum_robot_control", { action: "pause" })), false, running),
        button(t("Dock"), doing(() => call("vacuum_robot_control", { action: "home" })), false, running));
      sheet.appendChild(row);
    }
    // Valetudo over MQTT, if the link names its entity: Home Assistant's own card for it, nothing more.
    const ent = s.link && s.link.vacuum_entity;
    if (ent) {
      const a = mk("button", `${C.btn};margin-top:4px`, t("Open in Home Assistant"));
      a.type = "button";
      a.addEventListener("click", (e) => {
        e.stopPropagation();
        const root = document.querySelector("home-assistant") || document.body;
        root.dispatchEvent(new CustomEvent("hass-more-info", { bubbles: true, composed: true, detail: { entityId: ent } }));
      });
      sheet.appendChild(a);
    }

    // ── room location ──
    sheet.appendChild(mk("div", C.h, t("Room location")));
    sheet.appendChild(mk("div", C.muted, t("The robot drives to spots in each room and stands still while PadSpan listens to the tag on it. Each spot is added to calibration at once. Calibration is backed up before every run, and a run can be undone.")));
    const need = mk("div", "display:flex;flex-direction:column;gap:6px;margin:8px 0");
    const line = (ok, text) => mk("div", "font-size:12px", `${ok ? "✓" : "✗"} ${text}`);

    // The robot's address (and its login, when Valetudo asks for one).
    const url = s.robot && s.robot.url;
    need.appendChild(line(!!url, url ? t("The robot's address: {url}", { url }) : t("The robot's address")));
    if (!url || st.edit || (rs && rs.error === "auth")) {
      const u = input("url", url, "http://192.168.1.50"), user = input("user", "", t("Valetudo user (only if its login is on)"));
      const pw = input("password", "", t("Password"), "password");
      const row = mk("div", C.row);
      row.append(u, user, pw, button(t("Save"), doing(async () => {
        const args = { url: u.value.trim() };
        if (user.value.trim()) { args.user = user.value.trim(); args.password = pw.value; }
        await call("vacuum_robot_set", args);
        st.edit = false; st.draft = {};
        return true;
      }), true));
      need.appendChild(row);
    } else {
      need.appendChild(button(t("Change the address or login"), async () => { st.edit = true; render(); }));
    }
    // Its map, imported from Valetudo (the Mapping tab's import, from the robot's address or its map camera).
    const map = !!(s.link && s.link.valetudo);
    need.appendChild(line(map, map ? t("Its map, imported from Valetudo") : t("Its map: import it from Valetudo on the Mapping tab (Import from a robot vacuum)")));
    // The tag stuck on the robot: the walker's tag setting (vacuum_link_set walker_tag).
    const tag = s.tag || {}, heard = tag.address && tag.receivers > 0;
    need.appendChild(line(heard, tag.address
      ? (heard ? tn(tag.receivers, "The tag on the robot is heard now by {n} receiver", "The tag on the robot is heard now by {n} receivers")
        : typeof tag.age_s === "number" ? t("The tag on the robot was last heard {s} s ago", { s: tag.age_s }) : t("The tag on the robot is not heard"))
      : t("The tag on the robot")));
    if (!tag.address || !heard) {
      need.appendChild(mk("div", C.warn, t("It must be a fixed-address beacon (iBeacon or Eddystone) stuck on top of the robot, away from its laser turret. Not an AirTag or a Tile: their addresses keep changing.")));
      const ti = input("tag", tag.address, t("Tag address (AA:BB:…)"));
      const row = mk("div", C.row);
      row.append(ti, button(t("Save"), doing(async () => { await call("vacuum_link_set", { walker_tag: ti.value.trim() }); delete st.draft.tag; return true; }), true));
      need.appendChild(row);
    }
    sheet.appendChild(need);

    // A run: going, or one to start.
    if (running) {
      const r = s.run;
      sheet.appendChild(mk("div", "font-size:13px;font-weight:700",
        t("Running in {room}: spot {n} of {total}, {added} added, {skipped} skipped", { room: r.at_room || "…", n: r.spot, total: r.spots, added: r.added, skipped: r.skipped })));
      sheet.appendChild(button(t("Stop"), doing(() => call("vacuum_run_stop"), t("Stopping: the robot goes back to its dock")), true));
    } else {
      const row = mk("div", C.row), sel = mk("select", C.input);
      const all = mk("option", null, t("All rooms")); all.value = ""; sel.appendChild(all);
      for (const n of st.rooms || []) { const op = mk("option", null, n); op.value = n; sel.appendChild(op); }
      sel.value = st.room;
      sel.addEventListener("change", () => { st.room = sel.value; });
      const ready = !!(url && map && tag.address && !(rs && rs.error));
      row.append(sel, button(t("Start a run"), doing(() => call("vacuum_run_start", st.room ? { room: st.room } : {}),
        (r) => tn(r && r.run ? r.run.spots : 0, "Run started: {n} spot", "Run started: {n} spots")), true, !ready));
      sheet.appendChild(row);
    }

    // Find mistakes (the owner, 2026-11-24): receivers the runs' points say are misplaced, on a card of its own.
    if ((s.runs || []).some(r => r.points_kept > 0)) {
      sheet.appendChild(button(t("Find mistakes"), async () => {
        try { (await import(`./robovac_findings.js${new URL(import.meta.url).search}`)).openFindings(api); }
        catch (err) { console.warn("PadSpan: robovac_findings failed to load", err); }
      }));
    }

    // The last run, and its undo.
    const last = (s.runs || []).find(r => r.state !== "running");
    if (last) {
      const when = String(last.started || "").slice(0, 16).replace("T", " ");
      sheet.appendChild(mk("div", `${C.muted};margin-top:8px`, t("Last run, {when} UTC: {added} points added, {skipped} spots skipped, {how}.",
        { when, added: last.added, skipped: last.skipped, how: (ENDED[last.state] || (() => last.state))() })));
      if (last.small && last.small.length) sheet.appendChild(mk("div", C.muted, t("Too small for a spot: {rooms}", { rooms: last.small.join(", ") })));
      if (last.error) sheet.appendChild(mk("div", C.warn, words(last.error)));
      if (last.home_failed) sheet.appendChild(mk("div", C.warn, t("It could not be sent back to its dock: send it there yourself.")));
      if (last.undone) sheet.appendChild(mk("div", C.muted, t("Undone: its points were taken out of calibration.")));
      else if (last.points_kept > 0) {
        sheet.appendChild(button(t("Undo this run"), doing(async () => {
          if (!confirm(tn(last.points_kept, "Remove the {n} point this run added? Every other calibration point stays as it is.",
            "Remove the {n} points this run added? Every other calibration point stays as it is."))) return null;
          return call("vacuum_run_undo", { run_id: last.id });
        }, (r) => (r ? tn(r.removed, "Removed {n} point", "Removed {n} points") : null))));
      }
    }
  }

  render();
  document.body.appendChild(overlay);
  if (admin) refresh(true);
  return o;
}
