// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
// See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
/**
 * Occupancy — people in the building, and how that number was reached.
 * Known people from HA person entities (one per phone), unknown people from
 * unclaimed phones on the air and rooms whose sensors say someone. Tagged
 * things are shown and never counted.
 */

export function render(ctx) {
  const { el } = ctx.helpers;
  const root = el("div", { id: "occupancy" });

  root.appendChild(el("div", { style: "margin-bottom:14px" }, [
    el("div", { style: "display:flex;align-items:center;gap:8px" }, [
      el("div", { style: "font-size:24px" }, "🏢"),
      el("div", { style: "font-weight:700;font-size:16px;color:#5eead4" }, "People in building"),
    ]),
    el("div", { style: "font-size:12px;color:#94a3b8;margin-top:2px" },
      "Known people from HA person entities, unknown people from unclaimed phones and sensed rooms. Tagged things are listed, never counted."),
  ]));

  const content = el("div", {});
  root.appendChild(content);
  _loadOccupancy(ctx, el, content);
  return root;
}

const _plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const _confColor = c => c === "high" ? "#52b788" : c === "medium" ? "#f59e0b" : "#f87171";

async function _loadOccupancy(ctx, el, container) {
  container.innerHTML = "";
  container.appendChild(el("div", { style: "text-align:center;color:#94a3b8;padding:20px" }, "Loading…"));

  try {
    const res = await ctx.actions.callWS({ type: "padspan_ha/occupancy_estimate" });
    container.innerHTML = "";
    const col = _confColor(res.confidence);
    const ev = res.evidence || {};
    const H = t => el("div", { style: "font-weight:700;font-size:13px;color:#94a3b8;text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px" }, t);

    // ── Headline ─────────────────────────────────────────────────────────
    const summary = el("div", { class: "card", style: "margin-bottom:12px;border-color:" + col + "44" });
    summary.appendChild(el("div", { style: "display:flex;align-items:center;gap:14px" }, [
      el("div", { style: "font-size:42px;line-height:1" }, "🏢"),
      el("div", { style: "flex:1" }, [
        el("div", { style: "display:flex;align-items:baseline;gap:10px;flex-wrap:wrap" }, [
          el("span", { style: `font-weight:800;font-size:28px;color:${col}` }, String(res.total_estimate)),
          el("span", { style: "font-size:13px;color:#94a3b8" }, `${res.total_estimate === 1 ? "person" : "people"} in the building`),
          res.total_low !== res.total_high
            ? el("span", { style: `font-size:11px;padding:1px 8px;border-radius:10px;border:1px solid ${col}44;color:${col}`, title: "possible range" }, `${res.total_low}–${res.total_high}`)
            : null,
        ].filter(Boolean)),
        el("div", { style: "font-size:11px;color:#64748b;margin-top:4px" },
          `Confidence: ${res.confidence}` + (res.hybrid_enabled === false ? " · phones only — hybrid counting is off" : "")),
      ]),
    ]));
    summary.appendChild(el("div", { style: "display:grid;grid-template-columns:repeat(auto-fit,minmax(110px,1fr));gap:8px;margin-top:12px" }, [
      _kpi(el, String(res.known || 0), "Known home", "#52b788"),
      _kpi(el, String(res.unknown || 0), "Unknown", "#f59e0b"),
      _kpi(el, String(ev.phone_clusters || 0), "Phones heard", "#a78bfa"),
      _kpi(el, String((ev.occupancy_rooms || []).length + (ev.motion_rooms || []).filter(r => !(ev.occupancy_rooms || []).includes(r)).length), "Sensed rooms", "#60a5fa"),
      _kpi(el, String((ev.things_seen || []).length), "Things, not people", "#64748b"),
    ]));
    container.appendChild(summary);

    // ── Counted ──────────────────────────────────────────────────────────
    const peopleCard = el("div", { class: "card", style: "margin-bottom:12px" });
    peopleCard.appendChild(H("Counted"));
    if (!(res.people || []).length) {
      peopleCard.appendChild(el("div", { style: "font-size:12px;color:#64748b" }, "Nobody"));
    }
    for (const p of res.people || []) {
      peopleCard.appendChild(el("div", { style: "display:flex;gap:10px;font-size:12px;align-items:baseline;flex-wrap:wrap;padding:2px 0" }, [
        el("span", { style: `color:${p.kind === "known" ? "#52b788" : "#f59e0b"};font-weight:600;min-width:120px` },
          p.name + ((p.aliases || []).length ? ` (${p.aliases.join(", ")})` : "")),
        el("span", { style: "color:#e2e8f0" }, (p.room || "not placed") + (p.assumed ? " (assumed)" : "")),
        el("span", { style: "color:#64748b;font-size:11px" }, p.via || ""),
      ]));
    }
    container.appendChild(peopleCard);

    // ── Rooms with evidence ──────────────────────────────────────────────
    if ((res.rooms || []).length) {
      const roomCard = el("div", { class: "card", style: "margin-bottom:12px" });
      roomCard.appendChild(H("Rooms with evidence"));
      const grid = el("div", { style: "display:grid;grid-template-columns:1fr auto auto auto;gap:6px 14px;font-size:12px;align-items:center" });
      for (const h of ["Room", "People", "Phones", "Sensors"]) {
        grid.appendChild(el("div", { style: "font-weight:600;color:#64748b;font-size:10px;text-transform:uppercase" }, h));
      }
      for (const r of res.rooms) {
        const rc = ctx.helpers.roomColor ? ctx.helpers.roomColor(r.room) : "#5eead4";
        const sensors = [r.occupancy ? "occupancy" : null, r.motion ? "motion" : null].filter(Boolean).join(", ");
        grid.appendChild(el("div", { style: `color:${rc};font-weight:600` }, r.room));
        grid.appendChild(el("div", { style: "color:#52b788" }, (r.people || []).join(", ") || "—"));
        grid.appendChild(el("div", { style: "text-align:right;color:#a78bfa;font-family:monospace" }, String(r.phones || 0)));
        grid.appendChild(el("div", { style: "color:#60a5fa" }, sensors || "—"));
      }
      roomCard.appendChild(grid);
      container.appendChild(roomCard);
    }

    // ── How ──────────────────────────────────────────────────────────────
    const howCard = el("div", { class: "card", style: "margin-bottom:12px" });
    howCard.appendChild(H("How the number was reached"));
    const unacc = ev.unaccounted_rooms || [];
    const lines = [
      `${_plural(res.known || 0, "known person", "known people")} home` +
        ((ev.persons_unlocated || []).length ? ` — ${ev.persons_unlocated.join(", ")} not placed by a device` : ""),
      `${_plural(ev.phone_clusters || 0, "unclaimed phone", "unclaimed phones")} heard` +
        (ev.phone_addresses ? ` (${_plural(ev.phone_addresses, "rotating address", "rotating addresses")}, clustered at ${res.cluster_threshold} dBm)` : ""),
      `${_plural(unacc.length, "sensed room", "sensed rooms")} with nobody placed` + (unacc.length ? `: ${unacc.join(", ")}` : ""),
      `Known people who are home but not placed explain phones and rooms first; what is left is unknown people: ${res.unknown || 0}.`,
    ];
    if ((ev.stuck_sensors || []).length) lines.push(`Ignored, held on for over an hour: ${ev.stuck_sensors.join(", ")}`);
    for (const t of lines) howCard.appendChild(el("div", { style: "font-size:11px;color:#94a3b8;line-height:1.6" }, t));
    container.appendChild(howCard);

    // ── Seen, not people ─────────────────────────────────────────────────
    if ((ev.things_seen || []).length) {
      const thingsCard = el("div", { class: "card", style: "margin-bottom:12px" });
      thingsCard.appendChild(H(`Seen, not people (${ev.things_seen.length})`));
      const grid = el("div", { style: "display:grid;grid-template-columns:1fr auto auto;gap:3px 14px;font-size:11px" });
      for (const t of ev.things_seen) {
        grid.appendChild(el("div", { style: "color:#e2e8f0" }, String(t.label)));
        grid.appendChild(el("div", { style: "color:#64748b" }, String(t.kind || "")));
        grid.appendChild(el("div", { style: "color:#94a3b8" }, t.room || "—"));
      }
      thingsCard.appendChild(grid);
      thingsCard.appendChild(el("div", { style: "font-size:10px;color:#64748b;margin-top:6px" },
        "A label names a thing. A person is counted through their HA person entity or their phone."));
      container.appendChild(thingsCard);
    }

    // ── Tuning ───────────────────────────────────────────────────────────
    const tuneCard = el("div", { class: "card", style: "margin-bottom:12px" });
    const hybridOn = res.hybrid_enabled !== false;
    const hybridRow = el("div", { style: "display:flex;align-items:center;gap:8px;margin-bottom:12px;padding-bottom:10px;border-bottom:1px solid #1b3526" });
    const hybridCb = document.createElement("input");
    hybridCb.type = "checkbox"; hybridCb.checked = hybridOn;
    hybridCb.style.cssText = "accent-color:#5eead4;width:16px;height:16px";
    hybridCb.addEventListener("change", async () => {
      try {
        await ctx.actions.settingsSet({ occupancy_hybrid_enabled: hybridCb.checked });
        ctx.toast(hybridCb.checked ? "Hybrid counting enabled" : "Hybrid counting disabled — phones only");
        _loadOccupancy(ctx, el, container);
      } catch (e) { ctx.toast("Failed: " + (e.message || e), true); }
    });
    hybridRow.appendChild(hybridCb);
    hybridRow.appendChild(el("div", {}, [
      el("span", { style: "font-weight:600;font-size:12px;color:#5eead4" }, "Hybrid counting"),
      el("span", { style: "font-size:11px;color:#94a3b8;margin-left:6px" },
        "— count HA person entities and occupancy / motion sensors as well as phones"),
    ]));
    tuneCard.appendChild(hybridRow);

    tuneCard.appendChild(H("Phone clustering"));
    tuneCard.appendChild(el("div", { style: "font-size:11px;color:#64748b;margin-bottom:10px" },
      "Phones heard with nearly the same signal at every scanner are one person (a phone and its watch, or a phone across an address rotation). Lower = stricter grouping, higher = looser."));
    const threshRow = el("div", { style: "display:flex;align-items:center;gap:8px" });
    const threshVal = res.cluster_threshold || 8;
    const threshSlider = document.createElement("input");
    threshSlider.type = "range"; threshSlider.min = "2"; threshSlider.max = "20"; threshSlider.step = "1";
    threshSlider.value = String(threshVal);
    threshSlider.style.cssText = "width:160px;accent-color:#a78bfa";
    const threshLbl = el("span", { style: "font-size:12px;color:#a78bfa;min-width:80px" }, `Threshold: ${threshVal} dBm`);
    threshSlider.addEventListener("input", () => {
      threshLbl.textContent = `Threshold: ${threshSlider.value} dBm`;
    });
    const threshSaveBtn = el("button", { class: "btn", style: "padding:4px 12px;font-size:11px" }, "Save & Refresh");
    threshSaveBtn.addEventListener("click", async () => {
      const v = parseFloat(threshSlider.value) || 8;
      threshSaveBtn.disabled = true; threshSaveBtn.textContent = "Saving…";
      try {
        await ctx.actions.settingsSet({ occupancy_cluster_threshold: v });
        ctx.toast(`Cluster threshold set to ${v} dBm`);
        _loadOccupancy(ctx, el, container);
      } catch (e) {
        ctx.toast("Failed: " + (e.message || e), true);
        threshSaveBtn.disabled = false; threshSaveBtn.textContent = "Save & Refresh";
      }
    });
    threshRow.appendChild(threshLbl);
    threshRow.appendChild(threshSlider);
    threshRow.appendChild(threshSaveBtn);
    tuneCard.appendChild(threshRow);
    container.appendChild(tuneCard);

    // ── Record the real count ────────────────────────────────────────────
    const trainCard = el("div", { class: "card", style: "margin-bottom:12px" });
    trainCard.appendChild(H("Record the real count"));
    trainCard.appendChild(el("div", { style: "font-size:11px;color:#64748b;margin-bottom:10px" },
      "Enter the actual number of people in the building right now. It is stored beside what the estimate said, so the two can be compared over time."));
    const trainRow = el("div", { style: "display:flex;align-items:center;gap:8px" });
    const trainInput = document.createElement("input");
    trainInput.type = "number"; trainInput.min = "0"; trainInput.max = "500"; trainInput.step = "1";
    trainInput.placeholder = "Actual headcount";
    trainInput.style.cssText = "width:120px;padding:6px 10px;border:1px solid #334155;border-radius:6px;background:#1e293b;color:#e2e8f0;font-size:13px";
    trainRow.appendChild(trainInput);
    const trainBtn = el("button", { class: "btn", style: "padding:6px 16px;font-size:12px" }, "Save");
    trainBtn.addEventListener("click", async () => {
      const actual = parseInt(trainInput.value, 10);
      if (isNaN(actual) || actual < 0) { ctx.toast("Enter a valid count"); return; }
      trainBtn.disabled = true; trainBtn.textContent = "Saving…";
      try {
        const r = await ctx.actions.callWS({ type: "padspan_ha/occupancy_train", actual_count: actual });
        ctx.toast(`Saved: actual ${actual}, estimate said ${r.observation.estimated}`);
        trainInput.value = "";
        if (ctx.state.settings) {
          ctx.state.settings.occupancy_training = [...(ctx.state.settings.occupancy_training || []), r.observation];
        }
        _loadOccupancy(ctx, el, container);
      } catch (e) {
        ctx.toast("Failed: " + (e.message || e), true);
        trainBtn.disabled = false; trainBtn.textContent = "Save";
      }
    });
    trainRow.appendChild(trainBtn);
    trainCard.appendChild(trainRow);

    const training = ctx.state.settings?.occupancy_training || [];
    if (training.length) {
      trainCard.appendChild(el("div", { style: "margin-top:12px;font-weight:600;font-size:11px;color:#64748b" }, `History (${training.length} observations)`));
      const histGrid = el("div", { style: "display:grid;grid-template-columns:auto 1fr 1fr 1fr;gap:3px 10px;font-size:10px;margin-top:4px" });
      for (const h of ["When", "Actual", "Estimated", "Known / unknown"]) {
        histGrid.appendChild(el("div", { style: "font-weight:600;color:#475569" }, h));
      }
      for (const obs of [...training].reverse().slice(0, 20)) {
        const d = obs.ts ? new Date(obs.ts).toLocaleString() : "?";
        histGrid.appendChild(el("div", { style: "color:#94a3b8" }, d));
        histGrid.appendChild(el("div", { style: "color:#52b788;font-weight:600;text-align:right" }, String(obs.actual ?? "?")));
        histGrid.appendChild(el("div", { style: `color:${obs.estimated === obs.actual ? "#52b788" : "#f59e0b"};text-align:right` }, String(obs.estimated ?? "?")));
        histGrid.appendChild(el("div", { style: "color:#94a3b8;text-align:right" },
          obs.known != null ? `${obs.known} / ${obs.unknown ?? 0}` : "—"));
      }
      trainCard.appendChild(histGrid);
    }
    container.appendChild(trainCard);

    const refreshBtn = el("button", { class: "btn inline", style: "font-size:11px;padding:3px 12px" }, "↻ Refresh");
    refreshBtn.addEventListener("click", () => _loadOccupancy(ctx, el, container));
    container.appendChild(refreshBtn);

  } catch (e) {
    container.innerHTML = "";
    container.appendChild(el("div", { style: "color:#f87171;font-size:12px;padding:12px" },
      "Failed to load occupancy data: " + (e.message || e)));
  }
}

function _kpi(el, num, label, color) {
  return el("div", { style: "text-align:center;padding:8px;background:#0d1f14;border:1px solid #1b3526;border-radius:6px" }, [
    el("div", { style: `font-size:20px;font-weight:700;color:${color}` }, num),
    el("div", { style: "font-size:10px;color:#94a3b8" }, label),
  ]);
}
