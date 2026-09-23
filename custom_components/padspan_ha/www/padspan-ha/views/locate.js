// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
// See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
/**
 * Locate — "which way do I walk from where I am to where that is."
 *
 * The obvious version of this feature (Apple's Precision Finding, Cisco's
 * blue-dot indoor nav) is camera-AR or UWB angle-of-arrival: point the
 * phone, follow an arrow. PadSpan has neither UWB ranging nor a reason to
 * trust a phone's magnetic compass indoors (a house full of BLE scanners,
 * HVAC ducts and rebar is exactly the environment magnetometers get wrong)
 * — and a camera-overlay arrow is useless on a wall-mounted kiosk with no
 * camera pointed anywhere near the user.
 *
 * So this is deliberately NOT that. It's room-graph wayfinding: BFS over
 * ModelStore's own room_adjacency map (already built for gap #9's what-if
 * scanner placement, already shipped to the client as
 * ctx.state.model.room_adjacency) from wherever YOUR tracked device
 * currently is to wherever the TARGET currently is, refreshed on every
 * live poll like Follow already is. No compass, no camera, no new sensor
 * permissions, no new backend beyond one settings field for "which
 * tracked object is me" — works from any browser, including a kiosk
 * tablet with its camera taped over. Once you're in the same room, it
 * switches to a live metre-distance readout from the same x_m/y_m fabric
 * positions everything else already uses, with a "closer"/"further"
 * delta against the previous poll.
 *
 * "You" is a persisted setting (locate_self_key, settings_store.py) —
 * whichever tracked object is your own phone, the same one the Phone
 * Setup Wizard / IRK flow already produces. It's a manual pick, not
 * auto-detected: this panel is as often a shared wall kiosk as it is
 * someone's own phone, so guessing "the viewer" would be wrong as often
 * as it was right.
 *
 * PadSpan Pro. Gated both here (the presentation) and server-side on the
 * locate_self_key setting itself (ws_settings.py refuses the write below
 * pro) — unlike Busy Times, this introduces a genuinely new setting, so
 * unlike that presentation-only gate, there's a real write to refuse.
 */

const { tierAtLeast, currentTier } =
  await import(`./editions.js${new URL(import.meta.url).search}`);

let _targetKey = "";
let _lastDistance = null;
let _lastDistanceKey = "";
// The cue is measured between two snapshots: drawing the same snapshot again
// (a full Follow rebuild after the per-poll refresh) repeats it, rather than
// comparing a distance with itself and dropping it (re-review 2026-09-23).
let _lastSnap = null, _lastDelta = "";

// Mounted by Follow (its "📍 Locate" option, Garry 2026-09-23) rather than
// being a tab of its own: `targetKey` is the object Follow already has
// chosen, so there is no second "Find:" pick to make.
export function render(ctx, { targetKey } = {}) {
  const { el, helpBtn } = ctx.helpers;
  const root = el("section", { id: "locate", class: "card" });
  if (targetKey) _targetKey = targetKey;

  root.appendChild(el("div", { class: "row", style: "align-items:center;gap:8px;margin-bottom:10px;flex-wrap:wrap" }, [
    el("div", { style: "font-weight:700;font-size:14px" }, "📍 Locate"),
    helpBtn("locate"),
    el("span", { class: "muted", style: "font-size:11px" }, "which way to walk, room by room — no compass, no camera"),
  ]));

  // Every root this returns answers _refresh (Follow calls it each poll).
  root._refresh = () => {};
  if (!tierAtLeast(currentTier(ctx.state.settings), "pro")) {
    root.appendChild(_buildProGateCard(ctx, "Locate"));
    return root;
  }

  const pickerCard = el("div");
  const body = el("div");
  root.appendChild(pickerCard);
  root.appendChild(body);

  // Self-contained: picking either device rebuilds `body` immediately from
  // this closure, the same pattern insights.js/busy_times.js use, rather
  // than depending on a generic cross-view re-render action (there isn't
  // one) — a poll cycle is up to 5s away and skips entirely while a
  // <select> has focus, so waiting for one here would leave a pick that
  // visibly "didn't do anything" for several seconds.
  const renderBody = () => {
    body.innerHTML = "";
    const isScanner = ctx.helpers.isScanner;
    const raw = (ctx.state.live?.snapshot?.objects?.list) || [];
    const candidates = raw
      .filter(o => !isScanner(o) && o.room)
      .map(o => ({ key: o.key || o.address || o.entity_id, label: o.user_label || o.private_ble_name || o.name || o.address || o.entity_id || "?", room: o.room, floor_id: o.floor_id, x_m: o.x_m, y_m: o.y_m, identified: !!o.identified }))
      .filter(o => o.key)
      .sort((a, b) => (b.identified - a.identified) || a.label.localeCompare(b.label));

    pickerCard.innerHTML = "";
    const selfKey = ctx.state.settings?.locate_self_key || "";
    // Follow's tag stays the target even while it has no room — that is the
    // lost tag someone most wants found (review 2026-09-23).
    if (!targetKey && _targetKey && !candidates.some(c => c.key === _targetKey)) _targetKey = "";

    // With Follow choosing the target, "you" may be any device — including
    // the one being followed, which is said below rather than hidden here.
    pickerCard.appendChild(_buildPicker(ctx, "You are carrying:", selfKey, candidates.filter(c => targetKey || c.key !== _targetKey), (val) => {
      if (ctx.state.settings) ctx.state.settings.locate_self_key = val;
      ctx.actions.wsCall("padspan_ha/settings_set", { locate_self_key: val }).catch(() => {});
      renderBody();
    }));
    if (!targetKey) pickerCard.appendChild(_buildPicker(ctx, "Find:", _targetKey, candidates.filter(c => c.key !== selfKey), (val) => {
      _targetKey = val;
      renderBody();
    }));

    if (!candidates.length) {
      body.appendChild(el("div", { class: "card" }, el("div", { class: "muted" },
        "No tracked objects currently have a room — nothing to locate yet.")));
      return;
    }
    if (!selfKey) {
      body.appendChild(el("div", { class: "card" }, [
        el("div", { style: "font-weight:700;margin-bottom:6px" }, "Pick which device is yours"),
        el("div", { class: "muted", style: "font-size:12px" },
          "Locate needs to know where you are, the same way it knows where everything else is — from a tracked BLE device, not GPS or a compass. If your own phone isn't tracked yet, set it up from Settings → Features → Phone Setup Wizard, then pick it above."),
      ]));
      return;
    }
    if (!_targetKey) {
      body.appendChild(el("div", { class: "card" }, el("div", { class: "muted" }, "Pick a device or person to find, above.")));
      return;
    }

    if (selfKey === _targetKey) {
      body.appendChild(el("div", { class: "card" }, el("div", { class: "muted" },
        "You're following your own device. Follow another tag to locate it.")));
      return;
    }
    const self = candidates.find(c => c.key === selfKey);
    const target = candidates.find(c => c.key === _targetKey);
    if (!self) {
      body.appendChild(el("div", { class: "card" }, el("div", { class: "muted" },
        "The device set as \"you\" isn't currently reporting a room — it may be out of range.")));
      return;
    }
    if (!target) {
      const rawT = raw.find(o => (o.key || o.address || o.entity_id) === _targetKey);
      const last = rawT && rawT.last_room;
      body.appendChild(el("div", { class: "card" }, el("div", { class: "muted" },
        "That tag isn't reporting a room right now — it may be out of range."
        + (last ? ` It was last seen in ${last}.` : ""))));
      return;
    }

    body.appendChild(_buildGuidance(ctx, self, target));
  };

  renderBody();
  // Follow re-renders only every ~35 s (a full rebuild flickers), so it asks
  // Locate to refresh just this card on every live poll — unless a picker is
  // open, which a rebuild would snap shut.
  root._refresh = () => {
    const active = root.getRootNode && root.getRootNode().activeElement;
    if (active && pickerCard.contains(active)) return;
    renderBody();
  };
  return root;
}

function _buildPicker(ctx, label, value, options, onChange) {
  const { el } = ctx.helpers;
  const wrap = el("div", { style: "margin-bottom:10px" });
  wrap.appendChild(el("label", { style: "display:block;font-size:11px;color:#94a3b8;margin-bottom:4px" }, label));
  const sel = el("select", { class: "input" });
  sel.appendChild(el("option", { value: "" }, "— choose —"));
  for (const o of options) {
    const opt = el("option", { value: o.key }, `${o.label} · ${o.room}`);
    if (o.key === value) opt.selected = true;
    sel.appendChild(opt);
  }
  sel.addEventListener("change", () => onChange(sel.value));
  wrap.appendChild(sel);
  return wrap;
}

function _floorLabel(ctx, floorId) {
  const floors = ctx.state.model?.floors || [];
  const f = floors.find(f => f.id === floorId);
  return f ? f.name : (floorId || "");
}

function _floorDelta(ctx, fromFloorId, toFloorId) {
  if (fromFloorId === toFloorId) return null;
  const floors = ctx.state.model?.floors || [];
  const a = floors.find(f => f.id === fromFloorId);
  const b = floors.find(f => f.id === toFloorId);
  const toName = _floorLabel(ctx, toFloorId);
  if (a && b && typeof a.level === "number" && typeof b.level === "number") {
    if (b.level > a.level) return `Go up to ${toName}`;
    if (b.level < a.level) return `Go down to ${toName}`;
  }
  return `Go to ${toName}`;
}

// Breadth-first search over the room_adjacency graph — unweighted, every
// edge costs one room-crossing. Same graph gap #9's what-if scanner
// placement (whatif_placement.js) already reads; this is the second
// consumer, not a new source of truth.
function _shortestRoomPath(adjacency, fromRoom, toRoom) {
  if (fromRoom === toRoom) return [fromRoom];
  const visited = new Set([fromRoom]);
  const queue = [[fromRoom]];
  while (queue.length) {
    const path = queue.shift();
    const last = path[path.length - 1];
    const neighbors = adjacency[last] || [];
    for (const n of neighbors) {
      if (visited.has(n)) continue;
      const next = [...path, n];
      if (n === toRoom) return next;
      visited.add(n);
      queue.push(next);
    }
  }
  return null;
}

function _buildGuidance(ctx, self, target) {
  const { el } = ctx.helpers;
  const card = el("div", { class: "card" });

  if (self.room === target.room) {
    card.appendChild(el("div", { style: "font-weight:700;font-size:16px;color:#52b788;margin-bottom:8px" },
      `Same room — ${target.room}`));
    if (self.floor_id === target.floor_id && typeof self.x_m === "number" && typeof target.x_m === "number") {
      const dist = Math.hypot(target.x_m - self.x_m, target.y_m - self.y_m);
      const pairKey = self.key + ">" + target.key;
      const snap = ctx.state.live?.snapshot || null;
      let delta = "";
      if (snap && snap === _lastSnap && _lastDistanceKey === pairKey) {
        delta = _lastDelta;                       // same snapshot drawn again
      } else {
        if (_lastDistanceKey === pairKey && _lastDistance != null) {
          const diff = dist - _lastDistance;
          if (Math.abs(diff) > 0.3) delta = diff < 0 ? " — getting closer" : " — getting further";
        }
        _lastDistance = dist;
        _lastDistanceKey = pairKey;
        _lastSnap = snap;
        _lastDelta = delta;
      }
      card.appendChild(el("div", { style: "font-size:28px;font-weight:700" }, `${dist.toFixed(1)} m${delta}`));
      card.appendChild(el("div", { class: "muted", style: "font-size:11px;margin-top:4px" },
        "Straight-line distance from your tracked position — look around, you're close."));
    } else {
      card.appendChild(el("div", { class: "muted", style: "font-size:12px" },
        "You're both in this room right now — look around."));
    }
    return card;
  }

  const adjacency = ctx.state.model?.room_adjacency || {};
  const path = _shortestRoomPath(adjacency, self.room, target.room);
  const floorNote = _floorDelta(ctx, self.floor_id, target.floor_id);

  if (floorNote) {
    card.appendChild(el("div", { style: "font-weight:700;font-size:16px;color:#f59e0b;margin-bottom:8px" }, floorNote));
  }

  if (!path) {
    card.appendChild(el("div", { style: "font-weight:700;font-size:15px;margin-bottom:6px" },
      `Head toward ${target.room}${floorNote ? "" : ""}`));
    card.appendChild(el("div", { class: "muted", style: "font-size:12px" },
      `No mapped route between ${self.room} and ${target.room} yet — draw room adjacency in Mapping → Rooms to get turn-by-turn steps here.`));
    return card;
  }

  const next = path[1];
  card.appendChild(el("div", { style: "font-weight:700;font-size:20px;color:#52b788;margin-bottom:6px" },
    `Head to: ${next}`));
  card.appendChild(el("div", { class: "muted", style: "font-size:11px;margin-bottom:10px" },
    `${path.length - 1} room${path.length - 1 === 1 ? "" : "s"} to go`));

  const trail = el("div", { style: "display:flex;align-items:center;flex-wrap:wrap;gap:6px" });
  path.forEach((room, i) => {
    const isNext = i === 1;
    const isLast = i === path.length - 1;
    trail.appendChild(el("span", {
      style: `padding:4px 10px;border-radius:12px;font-size:11px;` +
        (isLast ? "background:#3a0a0a;color:#f87171;border:1px solid #7f1d1d;" :
         isNext ? "background:#1b3526;color:#52b788;border:1px solid #52b788;font-weight:700;" :
         i === 0 ? "background:#0a150e;color:#94a3b8;border:1px solid #1b3526;" :
         "background:#0a150e;color:#4a6052;border:1px solid #1b3526;")
    }, room));
    if (i < path.length - 1) trail.appendChild(el("span", { class: "muted", style: "font-size:11px" }, "→"));
  });
  card.appendChild(trail);
  return card;
}

function _buildProGateCard(ctx, featureName) {
  const { el } = ctx.helpers;
  const card = el("div", { class: "card" });
  card.appendChild(el("div", { style: "font-weight:700;font-size:16px;margin-bottom:6px" },
    `${featureName} is a PadSpan Pro feature`));
  card.appendChild(el("div", { class: "muted", style: "font-size:12px;margin-bottom:10px" },
    "Unlock it, and everything else gated, with a PadSpan Pro key — or start a one-time 3-month free trial, no card required."));
  card.appendChild(el("div", { class: "muted", style: "font-size:11px" }, "Settings → Features → PadSpan licence"));
  return card;
}
