// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
// See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
//
// The status dot in the panel's top bar: something is wrong, and what.
// Pure functions over what the panel already has (the 5 s live snapshot,
// whether that poll answered, the floor plans' receivers); panel.js draws it
// and opens Health on a click. Nothing here asks the server for anything.
//
//   red    broken: PadSpan isn't answering, positioning's last update
//          failed, or no Bluetooth receiver is reporting
//   amber  needs attention: a receiver silent for over 10 minutes, one
//          hearing far less than usual (proxy_health.py), a receiver on a
//          floor plan that no live receiver matches, learning suspended
//   none   fine: no dot at all. On a wall screen, only red shows.
//
// Setup tips (setup_checks.py) and scanner reliability scores are advice
// about accuracy, not faults: they stay on the Overview and in Health.
//
// A condition must be seen on PERSIST polls in a row before it shows, and be
// gone on PERSIST polls in a row before it goes, so one slow poll or one
// quiet moment never makes the dot blink.

export const PERSIST = 2;
// The panel's own "idle" line (panel.js scannerStatus): not heard for 10 minutes.
export const SILENT_S = 600;

const _n = (k, one, many) => `${k} ${k === 1 ? one : many}`;

/** What is wrong right now, worst first: [{id, level: "red"|"amber", text}].
 *  input: { live: bool, failed: bool, snapshot, maps } */
export function statusIssues({ live, failed, snapshot, maps } = {}) {
  if (!live) return [];
  if (failed) return [{ id: "no_answer", level: "red", text: "PadSpan isn't answering, so the live data has stopped updating" }];
  const snap = snapshot && typeof snapshot === "object" ? snapshot : null;
  if (!snap) return [];
  const out = [];
  if (snap.positioning_failed === true) {
    out.push({ id: "positioning_failed", level: "red", text: "Positioning has stopped: its last update failed" });
  }
  const radios = Array.isArray(snap.ble && snap.ble.radios) ? snap.ble.radios.filter(r => r && typeof r === "object") : null;
  if (radios) {
    // A radio with no last_heard_s yet is not counted as silent: PadSpan
    // can't tell "not heard yet" from "gone" (just after a restart).
    const silent = radios.filter(r => typeof r.last_heard_s === "number" && r.last_heard_s > SILENT_S);
    if (!radios.length || silent.length === radios.length) {
      out.push({ id: "no_receivers", level: "red", text: "No Bluetooth receivers are reporting" });
    } else {
      if (silent.length) {
        out.push({ id: "receivers_silent", level: "amber",
          text: `${_n(silent.length, "receiver hasn't", "receivers haven't")} been heard from in over 10 minutes` });
      }
      const deaf = radios.filter(r => r.adv_rate_low === true);
      if (deaf.length) {
        out.push({ id: "hearing_less", level: "amber",
          text: `${_n(deaf.length, "receiver is", "receivers are")} hearing far fewer devices than usual` });
      }
      const missing = missingReceivers(maps, radios);
      if (missing) {
        out.push({ id: "map_receivers_missing", level: "amber",
          text: `${_n(missing, "receiver", "receivers")} on your floor plans ${missing === 1 ? "doesn't" : "don't"} match any live receiver` });
      }
    }
  }
  if (snap.suspended === true) {
    out.push({ id: "learning_suspended", level: "amber", text: "Learning is suspended: rooms come from the raw signal only" });
  }
  return out;
}

/** Receivers placed on the floor plans that no live radio matches, by source
 *  or by name (the Mapping › 3D Stack "stale" rule, views/maps.js). */
export function missingReceivers(maps, radios) {
  // An older Home Assistant lists only a count, no sources: nothing to match.
  if ((radios || []).some(r => !r || !r.source)) return 0;
  const keys = new Set();
  for (const r of radios || []) {
    if (r && r.source) keys.add(String(r.source).toLowerCase());
    if (r && r.name && r.source) keys.add(String(r.name).toLowerCase());
  }
  let n = 0;
  for (const m of maps || []) {
    for (const rx of (m && m.receivers) || []) {
      if (!rx) continue;
      const live = (rx.source && keys.has(String(rx.source).toLowerCase()))
        || (rx.label && keys.has(String(rx.label).toLowerCase()));
      if (!live) n++;
    }
  }
  return n;
}

/** One poll's issues into the tracker (a Map, kept by the caller); returns the
 *  issues that have lasted: shown after PERSIST polls in a row, kept until
 *  gone for PERSIST polls in a row. */
export function trackIssues(tracker, issues) {
  const seen = new Set();
  for (const is of issues || []) {
    seen.add(is.id);
    const t = tracker.get(is.id) || { on: 0, off: 0, active: false };
    t.on++; t.off = 0; t.issue = is;
    if (t.on >= PERSIST) t.active = true;
    tracker.set(is.id, t);
  }
  for (const [id, t] of [...tracker]) {
    if (seen.has(id)) continue;
    t.off++; t.on = 0;
    if (!t.active || t.off >= PERSIST) tracker.delete(id);
  }
  const order = { red: 0, amber: 1 };
  return [...tracker.values()].filter(t => t.active).map(t => t.issue)
    .sort((a, b) => order[a.level] - order[b.level]);
}

/** What the dot shows: null (nothing), or {level, count, label}. On a wall
 *  screen only red shows, and only the red issues are named. */
export function dotView(active, { wall = false } = {}) {
  const list = (active || []).filter(i => !wall || i.level === "red");
  if (!list.length) return null;
  const level = list.some(i => i.level === "red") ? "red" : "amber";
  const head = level === "red" ? "Something is broken" : "Something needs attention";
  const count = list.length;
  const label = `${head}: ${count === 1 ? "1 issue" : count + " issues"}. ${list.map(i => i.text).join(". ")}. Open Health.`;
  return { level, count, label };
}
