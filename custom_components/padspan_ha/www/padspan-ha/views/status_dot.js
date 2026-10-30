// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
// See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
//
// The status dot in the panel's top bar: something is wrong, and what.
// Pure functions over what the panel already has (the 5 s live snapshot,
// whether that poll answered, the receivers masked in Settings); panel.js
// draws it and opens Health on a click. Nothing here asks the server for
// anything.
//
//   red    broken: PadSpan isn't answering, positioning's last update
//          failed, or no Bluetooth receiver is reporting
//   amber  needs attention: a receiver silent for over 10 minutes, one
//          hearing far less than usual (proxy_health.py), learning suspended
//   none   fine: no dot at all. On a wall screen, only red shows.
//
// Only the receivers in use count: one marked lost, disabled or excluded
// (Bluetooth screen, presence_rules.excluded_sources) is left out, so it
// can't keep the dot amber, or make it red when it is the only one listed.
// A receiver the Bluetooth screen calls fine (scanning, or with
// advertisements in this snapshot; panel.js scannerStatus) is never silent.
//
// Setup tips (setup_checks.py), scanner reliability scores and floor-plan
// markers no live receiver matches are advice, not faults: they stay on the
// Overview, in Health and in Mapping.
//
// A condition must be seen on PERSIST polls in a row before it shows (red:
// RED_PERSIST, about 15 s), and be gone on PERSIST polls in a row before it
// goes, so one slow poll or one quiet moment never makes the dot blink.
// "No receivers reporting" waits out the first two minutes after the panel
// loads or PadSpan answers again (warmup): receivers report in after a start.

export const PERSIST = 2;
export const RED_PERSIST = 3;
export const WARMUP_MS = 120000;
// The panel's own "idle" line (panel.js scannerStatus): not heard for 10 minutes.
export const SILENT_S = 600;

const _n = (k, one, many) => `${k} ${k === 1 ? one : many}`;

/** What is wrong right now, worst first: [{id, level: "red"|"amber", text}].
 *  input: { live: bool, failed: bool, snapshot, excluded: sources (iterable),
 *  warmup: bool } */
export function statusIssues({ live, failed, snapshot, excluded, warmup = false } = {}) {
  if (!live) return [];
  if (failed) return [{ id: "no_answer", level: "red", text: "PadSpan isn't answering, so the live data has stopped updating" }];
  const snap = snapshot && typeof snapshot === "object" ? snapshot : null;
  if (!snap) return [];
  const out = [];
  if (snap.positioning_failed === true) {
    out.push({ id: "positioning_failed", level: "red", text: "Positioning has stopped: its last update failed" });
  }
  const masked = new Set([...(excluded || [])].map(String));
  const radios = Array.isArray(snap.ble && snap.ble.radios)
    ? snap.ble.radios.filter(r => r && typeof r === "object" && !r.lost && !r.disabled && !masked.has(String(r.source || "")))
    : null;
  if (radios) {
    const ads = Array.isArray(snap.ble && snap.ble.advertisements) ? snap.ble.advertisements : [];
    const heard = new Set(ads.map(a => a && a.source).filter(Boolean));
    // A radio with no last_heard_s yet is not counted as silent: PadSpan
    // can't tell "not heard yet" from "gone" (just after a restart).
    const silent = radios.filter(r => r.scanning !== true && !(r.source && heard.has(r.source))
      && typeof r.last_heard_s === "number" && r.last_heard_s > SILENT_S);
    if (!radios.length || silent.length === radios.length) {
      if (!warmup) out.push({ id: "no_receivers", level: "red", text: "No Bluetooth receivers are reporting" });
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
    }
  }
  if (snap.suspended === true) {
    out.push({ id: "learning_suspended", level: "amber", text: "Learning is suspended: rooms come from the raw signal only" });
  }
  return out;
}

/** One poll's issues into the tracker (a Map, kept by the caller); returns the
 *  issues that have lasted: shown after PERSIST polls in a row (red after
 *  RED_PERSIST), kept until gone for PERSIST polls in a row. */
export function trackIssues(tracker, issues) {
  const seen = new Set();
  for (const is of issues || []) {
    seen.add(is.id);
    const t = tracker.get(is.id) || { on: 0, off: 0, active: false };
    t.on++; t.off = 0; t.issue = is;
    if (t.on >= (is.level === "red" ? RED_PERSIST : PERSIST)) t.active = true;
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
