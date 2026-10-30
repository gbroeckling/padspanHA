// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
// See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
//
// Calibration → Results (interface review item 13, 2026-10-30): the tab
// Calibration opens on. People come to Calibration asking "how accurate is
// it, and how do I make it better"; the other tabs are named after methods,
// and the guided walk-through lost people part-way (10 early exits from 4
// homes). This tab answers both questions from numbers PadSpan already has,
// and hands over to the tab or tool that does the work.
//
// It only READS: calibration points, the model's cached score, the held-out
// score (heldout.py) and the setup tips (setup_checks.py). It never saves,
// computes or deletes anything; each button only moves to another tab.

// The house's accuracy now. The held-out score (0.38.165, "Accuracy on spots
// it hasn't seen") is the honest one, so it leads; the method shown is the
// one that did better there, fingerprints on a tie. With no held-out result
// yet, the old estimate (loo_accuracy) is shown and labelled as such.
export function houseAccuracy(calData) {
  const ho = calData && calData.heldout;
  const loo = calData && calData.model && calData.model.loo_accuracy;
  if (ho && ho.knn) {
    const m = ho.better === "spatial" && ho.spatial && ho.spatial.rooms_right_pc != null ? "spatial" : "knn";
    const r = ho[m] || {};
    if (r.rooms_right_pc != null || r.median_error_m != null) {
      return { kind: "heldout", method: m, rooms_right_pc: r.rooms_right_pc ?? null,
               median_m: r.median_error_m ?? null, spots: r.spots ?? null };
    }
  }
  if (loo && typeof loo.mean_error_m === "number") return { kind: "estimate", mean_m: loo.mean_error_m };
  return { kind: "none" };
}

// A room with fewer points than this is listed as needing work, and below
// 70% rooms right on the calibration score too.
export const FEW_POINTS = 3;
const WEAK_PC = 70;
// ws_diagnostics.py says "Calibration data is stale" past 90 days.
export const STALE_DAYS = 90;

// Rooms, worst first: rooms with no points, then the lowest rooms right,
// then the fewest points. Rooms come from the drawn rooms (roomNames), the
// points' own rooms and the calibration score's rooms (room_confusion,
// the numbers Model's Per-Room Accuracy shows).
export function roomRows(calData, roomNames) {
  const pts = (calData && calData.points) || [];
  const conf = (calData && calData.model && calData.model.loo_accuracy && calData.model.loo_accuracy.room_confusion) || null;
  const scored = (conf && conf.rooms) || {};
  const pairs = (conf && conf.confusion_pairs) || [];
  const count = {};
  for (const p of pts) { const r = p && p.room; if (r) count[r] = (count[r] || 0) + 1; }
  const names = new Set([...(roomNames || []), ...Object.keys(count), ...Object.keys(scored)]);
  const rows = [...names].map(name => {
    const s = scored[name];
    const pc = s && typeof s.accuracy === "number" ? Math.round(s.accuracy * 100) : null;
    const top = pairs.find(p => p.true_room === name);
    const points = count[name] || 0;
    return { name, points, pc, confusedWith: top ? top.pred_room : null,
             needsWork: points < FEW_POINTS || (pc != null && pc < WEAK_PC) };
  });
  rows.sort((a, b) =>
    (b.needsWork - a.needsWork)
    || ((a.points === 0 ? 0 : 1) - (b.points === 0 ? 0 : 1))
    || ((a.pc ?? 101) - (b.pc ?? 101))
    || (a.points - b.points)
    || a.name.localeCompare(b.name));
  return rows;
}

function _ts(s) { const t = Date.parse(s || ""); return Number.isFinite(t) ? t : null; }

// "The next best thing to do": the first that applies, in this order.
//   scale             a floor plan with no metre scale (setup tip): points
//                     on it can't be saved at all, so it comes first
//   start             no calibration points yet
//   receiver_heights  every receiver at one height (setup tip)
//   floor_heights     every floor at the default height (setup tip)
//   compute           points newer than the score, or no score yet
//   room_empty        a drawn room with no calibration point
//   room_weak         the room the score trusts least (Roam's own pick),
//                     or one with fewer than FEW_POINTS points
//   stale             the newest point is over STALE_DAYS old
//   matrix            nothing to fix: look at Accuracy by spot
// tips: setup_tips ids; weakestRoom: calibration.js's _weakestRoom.
export function nextAction({ tips = [], calData = {}, roomNames = [], now = Date.now(), weakestRoom = null } = {}) {
  const pts = calData.points || [];
  const model = calData.model || {};
  const t = new Set(tips || []);
  if (t.has("scale")) return { kind: "scale" };
  if (!pts.length) return { kind: "start" };
  if (t.has("receiver_heights")) return { kind: "receiver_heights" };
  if (t.has("floor_heights")) return { kind: "floor_heights" };
  const newest = Math.max(-Infinity, ...pts.map(p => _ts(p.collected_at)).filter(v => v != null));
  const computed = _ts(model.last_computed);
  if (pts.length >= 4 && (!model.loo_accuracy || (computed != null && newest > computed))) return { kind: "compute" };
  const rows = roomRows(calData, roomNames);
  const empty = rows.find(r => r.points === 0);
  if (empty) return { kind: "room_empty", room: empty.name };
  const conf = model.loo_accuracy && model.loo_accuracy.room_confusion;
  const weak = conf && weakestRoom ? weakestRoom(conf) : null;
  if (weak) return { kind: "room_weak", room: weak.name, confusedWith: weak.confusedWith, suggested: weak.suggested };
  const few = rows.find(r => r.points < FEW_POINTS);
  if (few) return { kind: "room_weak", room: few.name, confusedWith: null, suggested: FEW_POINTS - few.points };
  if (Number.isFinite(newest) && now - newest > STALE_DAYS * 86400000) {
    return { kind: "stale", days: Math.round((now - newest) / 86400000) };
  }
  return { kind: "matrix" };
}

export const ACTION_KINDS = ["scale", "start", "receiver_heights", "floor_heights", "compute",
  "room_empty", "room_weak", "stale", "matrix", "guided"];

// What each action says and its button.
function _words(a) {
  switch (a.kind) {
    case "scale": return ["Measure one distance on a floor plan",
      "A floor plan has no real-world scale yet, so calibration points on it can't be saved.", "Measure →"];
    case "start": return ["Calibrate the house",
      "There are no calibration points yet.", "Guided calibration →"];
    case "receiver_heights": return ["Say how high each receiver is mounted",
      "They're all at one height, which makes it harder to tell which floor someone is on.", "Open Tune →"];
    case "floor_heights": return ["Give your floors their real heights",
      "Every floor is at the default height, so PadSpan tells floors apart less well than it could.", "Floor heights →"];
    case "compute": return ["Work out the accuracy again",
      "There are calibration points the numbers above don't include yet.", "Open Model →"];
    case "room_empty": return [`Add calibration points in ${a.room}`,
      `${a.room} has none yet, so PadSpan has nothing to check it against.`, "Open Pin & Listen →"];
    case "room_weak": return [`Add a few points in ${a.room}`,
      a.confusedWith ? `It's the room PadSpan gets wrong most often, mostly mixing it up with ${a.confusedWith}. About ${a.suggested} more point${a.suggested === 1 ? "" : "s"} should help.`
        : `It has only a few points. About ${a.suggested} more point${a.suggested === 1 ? "" : "s"} should help.`, "Open Pin & Listen →"];
    case "stale": return ["Walk the house again",
      `The newest calibration point is ${a.days} days old. Furniture and receivers move; a fresh walk keeps it accurate.`, "Guided calibration →"];
    default: return ["Nothing urgent",
      "Every room has points and none stands out. Accuracy by spot shows where readings disagree, if a room still feels off.", "Open Accuracy by spot →"];
  }
}

const _pcColor = (pc) => pc == null ? "#94a3b8" : pc >= 80 ? "#52b788" : pc >= 50 ? "#f59e0b" : "#dc2626";

// The sample house's results (Sample mode), for the five sample rooms.
// Read-only like everything here; dates are relative to `now`.
export const SAMPLE_ROOMS = ["Living Room", "Kitchen", "Master Bedroom", "Office", "Guest Room"];
export function sampleCalibration(now = Date.now()) {
  const per = { "Living Room": 9, "Kitchen": 6, "Master Bedroom": 7, "Office": 4, "Guest Room": 2 };
  const points = [];
  let i = 0;
  for (const [room, n] of Object.entries(per)) {
    for (let k = 0; k < n; k++, i++) points.push({ id: `sample_${i}`, room, collected_at: new Date(now - (12 + i) * 3600000).toISOString() });
  }
  return {
    points,
    model: {
      last_computed: new Date(now - 3600000).toISOString(),
      loo_accuracy: {
        mean_error_m: 1.2,
        room_confusion: {
          rooms: {
            "Living Room": { point_count: 9, correct: 8, accuracy: 8 / 9 },
            "Kitchen": { point_count: 6, correct: 5, accuracy: 5 / 6 },
            "Master Bedroom": { point_count: 7, correct: 6, accuracy: 6 / 7 },
            "Office": { point_count: 4, correct: 3, accuracy: 0.75 },
            "Guest Room": { point_count: 2, correct: 1, accuracy: 0.5 },
          },
          confusion_pairs: [
            { true_room: "Guest Room", pred_room: "Master Bedroom", count: 1 },
            { true_room: "Office", pred_room: "Living Room", count: 1 },
            { true_room: "Kitchen", pred_room: "Living Room", count: 1 },
          ],
        },
      },
    },
    heldout: {
      radius_m: 1.5,
      knn: { spots: 28, placed: 28, room_spots: 28, rooms_right_pc: 79, median_error_m: 1.6 },
      spatial: { spots: 28, placed: 27, room_spots: 28, rooms_right_pc: 71, median_error_m: 2.1 },
      better: "knn",
    },
  };
}

// The setup tips, fetched as the Overview's card does (every 10 minutes at
// most); only in Live mode, and the server sends none to a non-administrator.
function _tips(ctx, cs, live) {
  if (!live) return [];
  const T = cs._resultsTips || (cs._resultsTips = { at: 0, list: null, busy: false });
  if (!T.busy && Date.now() - T.at > 600000 && ctx.actions.callWS) {
    T.busy = true;
    Promise.resolve().then(() => ctx.actions.callWS({ type: "padspan_ha/setup_tips" }))
      .then(r => { T.list = Array.isArray(r && r.tips) ? r.tips : []; })
      .catch(() => { T.list = T.list || []; })
      .finally(() => { T.at = Date.now(); T.busy = false; ctx.actions.renderRooms(); });
  }
  return T.list || [];
}

// The drawn rooms (not outside), from the model the panel already holds.
function _roomNames(ctx) {
  const g = (ctx.state.model && ctx.state.model.room_geometry_m) || {};
  return Object.entries(g).filter(([, v]) => !(v && v.floor_id === "__outside__")).map(([k]) => k);
}

// deps: { sample, weakestRoom, heldoutLine, openWizard(), goTab(id), telemetry(name) }
export function renderResults(ctx, el, cs, calData, deps) {
  const sample = !!deps.sample;
  const data = sample ? sampleCalibration() : (calData || { points: [], model: {} });
  const roomNames = sample ? SAMPLE_ROOMS : _roomNames(ctx);
  const tips = _tips(ctx, cs, !sample);
  const action = nextAction({ tips, calData: data, roomNames, weakestRoom: deps.weakestRoom });
  const pts = data.points || [];
  const count = (kind) => { if (!sample && deps.telemetry) deps.telemetry("cal_results_action:" + kind); };

  const wrap = el("div", { "data-cal-results": "tab", style: "display:flex;flex-direction:column;gap:12px" });
  if (sample) {
    wrap.appendChild(el("div", { "data-cal-results": "sample", class: "muted", style: "font-size:12px" },
      "Sample house: these are made-up results. Switch to Live to see your own."));
  }

  const go = (kind) => {
    count(kind);
    if (kind === "scale") {
      const maps = (ctx.state.maps && ctx.state.maps.list) || [];
      const id = (ctx.state.activeMapId && maps.some(m => m.id === ctx.state.activeMapId)) ? ctx.state.activeMapId : ((maps[0] && maps[0].id) || null);
      cs._resultsCounted = false;
      ctx.state.view = "maps";
      ctx.state._mapsWizard = { step: 2, mapId: id };
      if (ctx.actions.renderNav) ctx.actions.renderNav();
      ctx.actions.renderRooms();
    } else if (kind === "floor_heights") {
      cs._resultsCounted = false;
      // 3D Stack is Advanced-only (Basic's Mapping sends it to Library):
      // switch and say so, as the Overview's floor-heights tip does.
      if (ctx.state.complexity === "basic" && ctx.actions.setComplexity) {
        ctx.actions.setComplexity("advanced");
        // ctx.toast, as every view says it (there is no ctx.actions.toast).
        if (ctx.toast) ctx.toast("Floor heights are in Advanced mode, so PadSpan switched to Advanced. The Basic / Advanced button at the top switches back.");
      }
      ctx.state.view = "maps";
      if (ctx.actions.renderNav) ctx.actions.renderNav();
      if (ctx.actions.setMapsTab) ctx.actions.setMapsTab("stack");
      else { ctx.state.mapsTab = "stack"; ctx.actions.renderRooms(); }
    } else if (kind === "start" || kind === "stale" || kind === "guided") {
      deps.openWizard();
    } else {
      deps.goTab({ receiver_heights: "tune", compute: "model", room_empty: "pin", room_weak: "pin", matrix: "matrix" }[kind] || "matrix");
    }
  };

  const guidedBtn = (primary) => {
    const b = el("button", { class: primary ? "btn inline primary" : "btn inline", "data-cal-results": "guided" }, "🧭 Guided calibration");
    b.addEventListener("click", () => go("guided"));
    return b;
  };

  const actionCard = () => {
    const [title, why, label] = _words(action);
    const card = el("div", { class: "card", "data-cal-results": "next", "data-kind": action.kind, style: "border-color:#52b788" });
    card.appendChild(el("div", { style: "font-size:11px;color:#94a3b8;text-transform:uppercase;letter-spacing:.04em;margin-bottom:4px" }, "The next best thing to do"));
    card.appendChild(el("div", { style: "font-weight:700;font-size:14px;color:#e2e8f0;margin-bottom:4px" }, title));
    card.appendChild(el("div", { class: "muted", style: "font-size:12px;line-height:1.5;margin-bottom:10px" }, why));
    const b = el("button", { class: "btn inline", "data-cal-results": "go" }, label);
    b.addEventListener("click", () => go(action.kind));
    card.appendChild(b);
    return card;
  };

  // A new house: two lines and the guided walk-through.
  if (!pts.length) {
    if (action.kind !== "start") wrap.appendChild(actionCard());
    wrap.appendChild(el("div", { class: "card", "data-cal-results": "empty" }, [
      el("div", { style: "font-weight:700;font-size:14px;color:#e2e8f0;margin-bottom:6px" }, "No calibration yet"),
      el("div", { class: "muted", style: "font-size:13px;line-height:1.6;margin-bottom:12px" },
        "Until you calibrate, PadSpan places people from the receivers alone. " +
        "Walk the house once with your phone and this page shows how accurate it is, room by room."),
      guidedBtn(true),
    ]));
    return wrap;
  }

  // How accurate it is now.
  const acc = houseAccuracy(data);
  const accCard = el("div", { class: "card", "data-cal-results": "accuracy" });
  accCard.appendChild(el("div", { style: "display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:6px" }, [
    el("div", { style: "font-weight:700;font-size:14px;color:#e2e8f0" }, "How accurate it is now"),
    el("div", { style: "margin-left:auto" }, [guidedBtn(true)]),
  ]));
  const big = (value, label, color) => el("div", { style: "flex:1;min-width:120px;background:#0a150e;border:1px solid #1b3526;border-radius:8px;padding:10px;text-align:center" }, [
    el("div", { style: `font-size:24px;font-weight:700;color:${color}` }, value),
    el("div", { style: "font-size:11px;color:#94a3b8;margin-top:2px" }, label),
  ]);
  const stats = el("div", { style: "display:flex;gap:10px;flex-wrap:wrap" });
  if (acc.kind === "heldout") {
    if (acc.rooms_right_pc != null) stats.appendChild(big(`${acc.rooms_right_pc}%`, "rooms right", _pcColor(acc.rooms_right_pc)));
    if (acc.median_m != null) stats.appendChild(big(`${acc.median_m} m`, "typical distance off", acc.median_m < 2 ? "#52b788" : "#f59e0b"));
    stats.appendChild(big(String(pts.length), "calibration points", "#a7f3d0"));
    accCard.appendChild(stats);
    // The Model tab's own line says both methods; this one only if it can't.
    const line = deps.heldoutLine ? deps.heldoutLine(el, data.heldout) : null;
    if (line) { line.setAttribute("data-cal-results", "how"); accCard.appendChild(line); }
    else accCard.appendChild(el("div", { class: "muted", "data-cal-results": "how", style: "font-size:12px;line-height:1.5;margin-top:8px" },
      `Tested on spots it hasn't seen, using ${acc.method === "spatial" ? "receiver positions (spatial)" : "your calibration points (fingerprints)"}.`));
  } else if (acc.kind === "estimate") {
    stats.appendChild(big(`~${acc.mean_m} m`, "estimated distance off", acc.mean_m < 2 ? "#52b788" : "#f59e0b"));
    stats.appendChild(big(String(pts.length), "calibration points", "#a7f3d0"));
    accCard.appendChild(stats);
    accCard.appendChild(el("div", { class: "muted", "data-cal-results": "how", style: "font-size:12px;line-height:1.5;margin-top:8px" },
      "An estimate, tested with nearby points still in, so it reads better than what you see. The test on unseen spots appears here once it has run."));
  } else {
    stats.appendChild(big(String(pts.length), "calibration points", "#a7f3d0"));
    accCard.appendChild(stats);
    accCard.appendChild(el("div", { class: "muted", "data-cal-results": "how", style: "font-size:12px;line-height:1.5;margin-top:8px" },
      pts.length >= 4 ? "Not worked out yet: Compute Model on the Model tab does it." : "A few more points (4 or more) and PadSpan can work out how accurate it is."));
  }
  wrap.appendChild(accCard);

  wrap.appendChild(actionCard());

  // Room by room, the ones that need work first.
  const rows = roomRows(data, roomNames);
  if (rows.length) {
    const card = el("div", { class: "card", "data-cal-results": "rooms" });
    card.appendChild(el("div", { style: "font-weight:700;font-size:14px;color:#e2e8f0;margin-bottom:4px" }, "Room by room"));
    card.appendChild(el("div", { class: "muted", style: "font-size:12px;line-height:1.5;margin-bottom:10px" },
      "Rooms that need work first. Rooms right is from the calibration score, which keeps nearby points in, so it reads higher than the figure above."));
    const list = el("div", { style: "display:flex;flex-direction:column;gap:6px" });
    // Rooms that look fine fold away under one line, so a big house's list
    // starts with the work.
    const fine = rows.filter(r => !r.needsWork).length;
    const fineList = el("div", { style: "display:flex;flex-direction:column;gap:6px;margin-top:6px" });
    for (const r of rows) {
      const note = r.points === 0 ? "no points yet"
        : r.confusedWith ? `mixed up with ${r.confusedWith}`
        : r.points < FEW_POINTS ? "few points" : "";
      (r.needsWork ? list : fineList).appendChild(el("div", { "data-cal-room": r.name, "data-needs-work": String(r.needsWork), style: "display:flex;align-items:center;gap:8px;flex-wrap:wrap" }, [
        el("span", { style: `font-size:12px;color:${r.needsWork ? "#f59e0b" : "#52b788"};width:14px;flex-shrink:0` }, r.needsWork ? "!" : "✓"),
        el("div", { style: "flex:1 1 120px;min-width:0;font-size:12px;color:#e2e8f0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" }, r.name),
        el("div", { style: "flex:0 0 72px;height:8px;background:#1b3526;border-radius:4px;overflow:hidden" }, [
          el("div", { style: `width:${r.pc ?? 0}%;height:100%;background:${_pcColor(r.pc)}` }),
        ]),
        el("div", { style: `font-size:11px;color:${_pcColor(r.pc)};width:36px;text-align:right;flex-shrink:0` }, r.pc == null ? "–" : `${r.pc}%`),
        el("div", { class: "muted", style: "font-size:11px;width:60px;text-align:right;flex-shrink:0" }, `${r.points} pt${r.points === 1 ? "" : "s"}`),
        note ? el("div", { class: "muted", style: "font-size:11px;flex-basis:100%;padding-left:22px" }, note) : null,
      ]));
    }
    card.appendChild(list);
    if (fine && fine === rows.length) card.appendChild(fineList);
    else if (fine) {
      const det = el("details", { "data-cal-results": "fine", style: "margin-top:8px" }, [
        el("summary", { style: "cursor:pointer;font-size:12px;color:#94a3b8" }, `${fine} room${fine === 1 ? "" : "s"} look${fine === 1 ? "s" : ""} fine`),
        fineList,
      ]);
      card.appendChild(det);
    }
    wrap.appendChild(card);
  }

  wrap.appendChild(el("div", { class: "muted", "data-cal-results": "more", style: "font-size:12px;line-height:1.5" },
    "More tools are in the tabs above: Tune and Beacon Tune place receivers and beacons, Pin & Listen and Roam collect points, Model and Accuracy by spot show the details."));
  return wrap;
}
