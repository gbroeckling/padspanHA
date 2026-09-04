// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
// See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
import { estimateDistanceM, formatDistanceM } from "./path_loss.js";

// PadSpan HA — BLE Fingerprint Calibration
// Phone-based signal collection for precise indoor location modelling.
//
// Sub-tabs:
//   Tune        — position scanner/receiver markers on 3D iso map
//   Beacon Tune — mark beacon positions, auto-collect 60s RSSI fingerprints
//   Setup       — pick your beacon device, collection settings
//   Pin & Listen — tap map to place pin, collect RSSI for N seconds
//   Roam        — guided coverage-maximising walk with live heatmap
//   Model       — quality stats, path-loss fits, LOO accuracy, export

const GRID_N    = 10;    // 10×10 coverage grid
const SIGMA_C   = 1.8;   // Gaussian sigma in cell units
const POLL_MS   = 1000;  // RSSI poll interval during collection (1s = ~60 samples in 60s)

// Shared stack transform (P2-5); query inherited from our own module URL so
// the ?b= cache-buster propagates (see docs/06_UI_CACHE_BUSTING.md).
// Metres -> a fraction of THIS photo, for drawing only. Returns null when the
// object has no real-world position or the point falls outside the image.
// `k` was `1 / anchor.m_per_world` — the X figure of a per-axis pair —
// applied to BOTH components below. On a trimmed anchor (kx 20, ky 40)
// that drew an object 10.00 m down the house at world 0.5000 instead of
// 0.2500: 10.000 m out in y, on the overlay whose job is to show the
// owner where their calibration points are. There is one gauge now and
// `metresToWorld` is the one place it is inverted, so the pair this bug
// needed to pick the wrong half of does not exist.
function _metresToFracFactory(model) {
  const gauge = worldGauge(model);
  return (obj, m) => {
    if (!gauge || !obj || typeof obj.x_m !== "number" || typeof obj.y_m !== "number") return null;
    const k = metresToWorld(gauge);
    const xf = mapXform(model, m);
    if (!xf) return null;
    const f = xf.invMapPt(obj.x_m * k, obj.y_m * k);
    if (!f) return null;
    const [fx, fy] = f;
    if (!(fx >= -0.05 && fx <= 1.05 && fy >= -0.05 && fy <= 1.05)) return null;
    return [fx, fy];
  };
}

const { mapXform, worldGauge, metresToWorld } =
  await import(`./stack_transform.js${new URL(import.meta.url).search}`);

// ── Exports ──────────────────────────────────────────────────────────────────
export function render(ctx) {
  const { el, radioShortId, scannerStatus } = ctx.helpers;
  const _sid = (source) => radioShortId ? radioShortId(source || "") : "";
  const root = el("section", { id: "calibration" });
  root.className = ctx.state.view === "calibration" ? "" : "hidden";

  // Per-session UI state
  if (!ctx.state._calib) ctx.state._calib = {
    tab:        "tune",
    deviceId:   null,
    deviceLabel: null,
    mapId:      null,
    duration:   15,
    pinX:       null,
    pinY:       null,
    pinRoom:    null,
    pinLabel:   "",
    collecting: false,
    stopFlag:   false,
    readings:   null,   // {source → {name,samples[]}} after collection
    savedThisSession: 0,
  };
  const cs = ctx.state._calib;

  // Load calibration DB once
  if (!ctx.state.calibration) {
    ctx.actions.calibrationGet()
      .then(d => { ctx.state.calibration = d; ctx.actions.renderRooms(); })
      .catch(() => { ctx.state.calibration = { points: [], model: {} }; });
  }
  const calData = ctx.state.calibration || { points: [], model: {} };

  // Guided Calibration Wizard — short-circuits before the ordinary tab bar,
  // same pattern as the Mapping Setup Wizard (maps.js). See _calibWizard
  // below for why: Calibration is scattered across Tune/Setup/Roam/Model
  // exactly like Mapping used to be scattered across Upload/Edit, and it is
  // the step people are most likely to half-do — the manual needs whole
  // paragraphs to explain what an LOO accuracy score even means.
  if (ctx.state._calibWizard) {
    root.appendChild(_calibWizard(ctx, el, cs, calData));
    return root;
  }

  // Header
  root.appendChild(el("div", { style: "margin-bottom:10px" }, [
    el("div", { style: "display:flex;align-items:center;gap:8px;flex-wrap:wrap" }, [
      el("div", { style: "font-weight:700;font-size:16px;color:#52b788" }, "BLE Location Calibration"),
      ctx.helpers.helpBtn("calibration_overview"),
      (() => {
        const b = el("button", { class: "btn inline", style: "font-size:11px;margin-left:auto" }, "🧭 Guided calibration");
        b.addEventListener("click", () => { ctx.state._calibWizard = { step: 1 }; ctx.actions.renderRooms(); });
        return b;
      })(),
    ]),
    el("div", { style: "font-size:12px;color:#78909c;margin-top:2px" },
      "Build a fingerprint database so PadSpan™ can pinpoint every beacon in 3D space."),
  ]));

  // Tab bar
  const TABS = [["tune","Tune"],["beacon","Beacon Tune"],["setup","Setup"],["pin","Pin & Listen"],["roam","Roam"],["model","Model"]];
  const tabBar = el("div", { class: "tabs", style: "margin-bottom:14px;flex-wrap:wrap;gap:4px" });
  for (const [id, label] of TABS) {
    tabBar.appendChild(el("button", {
      class: "tab" + (cs.tab === id ? " active" : ""),
      onclick: () => { cs.tab = id; ctx.actions.renderRooms(); },
    }, label));
  }
  root.appendChild(tabBar);

  if (cs.tab === "setup") root.appendChild(_setup(ctx, el, cs, calData));
  if (cs.tab === "pin")   root.appendChild(_pinAndListen(ctx, el, cs, calData));
  if (cs.tab === "roam")  root.appendChild(_roam(ctx, el, cs, calData));
  if (cs.tab === "model") root.appendChild(_modelTab(ctx, el, cs, calData));
  if (cs.tab === "tune")  root.appendChild(_tuneTab(ctx, el, cs, calData));
  if (cs.tab === "beacon") root.appendChild(_beaconTuneTab(ctx, el, cs, calData));

  return root;
}

// ── Guided Calibration Wizard ────────────────────────────────────────────────
// A thin shell around the real tabs (_tuneTab, _setup, _roam, _modelTab) —
// forces cs.tab to the right sub-view per step and reuses their rendering
// verbatim, the same "compose, don't reimplement" approach the Mapping
// Setup Wizard already established. What a wizard adds here is sequencing
// and validation, not new UI: half of calibration is a physical task (walk
// the house with a phone), so Roam's own live coverage heatmap and "next
// target" crosshair already ARE the guided part — this shell just makes
// sure nobody reaches it without a device chosen first.
//
// ctx.state._calibWizard = { step } while open; falsy means closed.
const CALIB_WIZARD_STEPS = [
  { n: 1, id: "tune",  label: "Check scanner positions" },
  { n: 2, id: "setup", label: "Choose your device" },
  { n: 3, id: "roam",  label: "Walk your home" },
  { n: 4, id: "model", label: "Compute your model" },
  { n: 5, id: "finish", label: "Finish" },
];
const CALIB_TAB_BY_STEP = { 1: "tune", 2: "setup", 3: "roam", 4: "model" };

function _calibWizardFooter(ctx, el, w, opts) {
  opts = opts || {};
  const bar = el("div", { style: "display:flex;justify-content:space-between;align-items:center;margin-top:14px;gap:10px;flex-wrap:wrap" });
  const left = el("div", {});
  if (w.step > 1) {
    const b = el("button", { class: "btn inline" }, "← Back");
    b.addEventListener("click", () => { w.step -= 1; ctx.actions.renderRooms(); });
    left.appendChild(b);
  }
  bar.appendChild(left);
  const right = el("div", { style: "display:flex;gap:8px" });
  if (opts.skip) {
    const sk = el("button", { class: "btn inline", style: "color:#94a3b8" }, opts.skipLabel || "Skip for now");
    sk.addEventListener("click", () => { w.step += 1; ctx.actions.renderRooms(); });
    right.appendChild(sk);
  }
  if (opts.next !== false) {
    const nx = el("button", { class: "btn primary" }, opts.nextLabel || "Next →");
    nx.addEventListener("click", () => { w.step += 1; ctx.actions.renderRooms(); });
    right.appendChild(nx);
  }
  bar.appendChild(right);
  return bar;
}

function _calibWizardTune(ctx, el, cs, calData, w) {
  const wrap = el("div", {});
  wrap.appendChild(el("div", { class: "muted", style: "margin-bottom:10px;line-height:1.5" },
    "Optional, but worth a look before you start walking: drag any scanner marker that isn't quite where the real device is mounted. This step is about scanner positions, not signal samples — nothing here is collected or timed."));
  wrap.appendChild(_tuneTab(ctx, el, cs, calData));
  wrap.appendChild(_calibWizardFooter(ctx, el, w, { skip: true, skipLabel: "Skip — positions look fine" }));
  return wrap;
}

function _calibWizardSetup(ctx, el, cs, calData, w) {
  const wrap = el("div", {});
  const ready = !!(cs.deviceId && cs.mapId);
  wrap.appendChild(el("div", { class: "muted", style: "margin-bottom:10px;line-height:1.5" },
    "Pick the phone or tag you'll carry while you walk, and which floor you're calibrating. Both are needed before the next step — Roam has nothing to show without them."));
  wrap.appendChild(_setup(ctx, el, cs, calData));
  wrap.appendChild(_calibWizardFooter(ctx, el, w, { next: ready, nextLabel: "Next →" }));
  if (!ready) {
    wrap.appendChild(el("div", { class: "muted", style: "font-size:11px;margin-top:6px;text-align:right" },
      "Choose a device and a floor above to continue."));
  }
  return wrap;
}

function _calibWizardRoam(ctx, el, cs, calData, w) {
  const wrap = el("div", {});
  const pts = (calData.points || []).filter(p => p.map_id === cs.mapId);
  wrap.appendChild(el("div", { class: "muted", style: "margin-bottom:10px;line-height:1.5" },
    "Walk to the blue crosshair, stand still, and press collect — the map tells you where to go next, and fills in as you cover the floor. " +
    "There's no fixed number of points; more is always better, but the coverage bar below is a fair guide. Prefer tapping the map yourself instead of being guided? Pin & Listen (the ordinary Calibration tabs) does the same collection without the guidance."));
  wrap.appendChild(_roam(ctx, el, cs, calData));
  wrap.appendChild(_calibWizardFooter(ctx, el, w, {
    skip: pts.length === 0, skipLabel: "Skip — I'll collect points later",
    nextLabel: pts.length ? `Next →` : "Next →",
  }));
  return wrap;
}

function _calibWizardModel(ctx, el, cs, calData, w) {
  const wrap = el("div", {});
  wrap.appendChild(el("div", { class: "muted", style: "margin-bottom:10px;line-height:1.5" },
    "Click Compute Model to fit the path-loss curves and run cross-validation against the points you just collected. The Est. Accuracy figure is how far off the model's guess was, on average, when tested against points it wasn't shown."));
  wrap.appendChild(_modelTab(ctx, el, cs, calData));
  wrap.appendChild(_calibWizardFooter(ctx, el, w, { nextLabel: "Finish →" }));
  return wrap;
}

function _calibWizardFinish(ctx, el, cs, calData) {
  const wrap = el("div", { class: "card" });
  const pts = calData.points || [];
  const mapPts = pts.filter(p => p.map_id === cs.mapId);
  const model = calData.model || {};
  const loo = model.loo_accuracy;
  const accM = loo && typeof loo.mean_error_m === "number" ? loo.mean_error_m.toFixed(1) : null;

  wrap.appendChild(el("div", { style: "font-weight:700;font-size:16px;margin-bottom:8px" }, "Calibration is underway"));
  wrap.appendChild(el("div", { class: "muted", style: "margin-bottom:14px;line-height:1.6" },
    `${mapPts.length} point${mapPts.length === 1 ? "" : "s"} on this floor, ${pts.length} total across the house` +
    (accM ? `. Estimated accuracy: ~${accM}m.` : ". Compute a model once you have a handful of points to see an accuracy estimate.") +
    " Calibration isn't a one-time thing — walk more of the house, or redo a room that reads oddly, any time from the ordinary Calibration tabs."));
  const row = el("div", { style: "display:flex;gap:10px;flex-wrap:wrap" });
  const qaBtn = el("button", { class: "btn primary" }, "See detailed quality report →");
  qaBtn.addEventListener("click", () => {
    ctx.state._calibWizard = null;
    ctx.state.view = "qa";
    ctx.actions.renderRooms();
  });
  row.appendChild(qaBtn);
  const anotherBtn = el("button", { class: "btn inline" }, "+ Calibrate another floor");
  anotherBtn.addEventListener("click", () => {
    cs.mapId = null;
    ctx.state._calibWizard = { step: 2 };
    ctx.actions.renderRooms();
  });
  row.appendChild(anotherBtn);
  const doneBtn = el("button", { class: "btn inline" }, "Done");
  doneBtn.addEventListener("click", () => {
    ctx.state._calibWizard = null;
    cs.tab = "model";
    ctx.actions.renderRooms();
  });
  row.appendChild(doneBtn);
  wrap.appendChild(row);
  return wrap;
}

function _calibWizard(ctx, el, cs, calData) {
  const w = ctx.state._calibWizard;

  // Every step past Setup needs a device and a floor — Roam and Model both
  // read from cs.deviceId/cs.mapId the same way the ordinary tabs do.
  const ready = !!(cs.deviceId && cs.mapId);
  if (w.step === 2 && ready) w.step = 3;   // chosen — move on without a click
  if (w.step > 2 && !ready) w.step = 2;    // lost/never had it — go back

  // cs.tab drives which sub-view _tuneTab/_setup/_roam/_modelTab is a
  // no-op for; keep it in sync so leaving the wizard lands somewhere sane.
  if (CALIB_TAB_BY_STEP[w.step]) cs.tab = CALIB_TAB_BY_STEP[w.step];

  const root = el("div", {});

  const head = el("div", { class: "card", style: "margin-bottom:12px" });
  const hrow = el("div", { style: "display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px" });
  hrow.appendChild(el("div", { style: "font-weight:700;font-size:16px" }, "Guided calibration"));
  const closeBtn = el("button", { class: "btn inline", style: "font-size:12px" }, "Exit guide");
  closeBtn.addEventListener("click", () => { ctx.state._calibWizard = null; ctx.actions.renderRooms(); });
  hrow.appendChild(closeBtn);
  head.appendChild(hrow);

  const dots = el("div", { style: "display:flex;gap:6px;margin-top:12px" });
  const stepList = el("div", { style: "display:flex;flex-wrap:wrap;gap:4px;margin-top:8px" });
  for (const s of CALIB_WIZARD_STEPS) {
    const isCurrent = s.n === w.step;
    const reachable = s.n <= 2 || ready;
    dots.appendChild(el("div", { style: `flex:1;height:4px;border-radius:2px;background:${s.n < w.step ? "#52b788" : isCurrent ? "#5eead4" : "#1b3526"}` }));
    const chip = el("button", {
      class: "btn inline" + (isCurrent ? " primary" : ""),
      style: `font-size:11px;padding:3px 10px;` + (reachable ? "" : "opacity:.4;cursor:not-allowed"),
    }, `${s.n}. ${s.label}`);
    chip.disabled = !reachable;
    if (reachable) chip.addEventListener("click", () => { w.step = s.n; ctx.actions.renderRooms(); });
    stepList.appendChild(chip);
  }
  head.appendChild(dots);
  head.appendChild(stepList);
  root.appendChild(head);

  const body = el("div", {});
  if (w.step === 1) body.appendChild(_calibWizardTune(ctx, el, cs, calData, w));
  else if (w.step === 2) body.appendChild(_calibWizardSetup(ctx, el, cs, calData, w));
  else if (w.step === 3) body.appendChild(_calibWizardRoam(ctx, el, cs, calData, w));
  else if (w.step === 4) body.appendChild(_calibWizardModel(ctx, el, cs, calData, w));
  else body.appendChild(_calibWizardFinish(ctx, el, cs, calData));
  root.appendChild(body);

  return root;
}

// ── Setup tab ─────────────────────────────────────────────────────────────────
function _setup(ctx, el, cs, calData) {
  const { radioShortId, scannerStatus } = ctx.helpers;
  const _sid = (source) => radioShortId ? radioShortId(source || "") : "";
  const wrap = el("div", { style: "display:flex;flex-direction:column;gap:14px" });
  const snap = (ctx.state.live && ctx.state.live.snapshot) || null;

  // How-it-works explainer
  wrap.appendChild(el("div", { class: "card", style: "border-color:#52b788" }, [
    el("div", { style: "font-weight:700;font-size:14px;margin-bottom:8px;color:#52b788" },
      "Phone-Based Calibration (Setup)"),
    el("div", { style: "font-size:13px;line-height:1.7;color:#b0c4b1" }, [
      el("div", {}, "This tab configures phone-based calibration (Pin & Listen / Roam)."),
      el("div", { style: "margin-top:4px" }, "1. Your phone broadcasts BLE. The house scanners hear it."),
      el("div", { style: "margin-top:4px" }, "2. You stand at a known spot on the map and tap it."),
      el("div", { style: "margin-top:4px" }, "3. PadSpan records the RSSI fingerprint — which scanners saw you and how strongly."),
      el("div", { style: "margin-top:4px" }, "4. Repeat at 10–20 locations spread across each floor."),
      el("div", { style: "margin-top:4px" }, "All calibration methods (Tune, Beacon Tune, Pin & Listen, Roam) feed the same model."),
    ]),
  ]));

  // Device selector — merge objects.list + raw advertisements so the user can pick ANY BLE device
  const _quietMode = !!(ctx.state.settings && ctx.state.settings.quiet_mode);
  const _setupIsScanner = ctx.helpers.isScanner;
  const bleObjs = (snap?.objects?.list || [])
    .filter(o => {
      if (o.kind !== "ble" && o.kind !== "entity" && o.kind !== "private_ble" && o.kind !== "ibeacon") return false;
      if (_setupIsScanner(o)) return false;
      if (_quietMode && !o.user_label && !o.identified && !ctx.actions.followedHas(o.address || o.key || "")) return false;
      return true;
    })
    .sort((a, b) => (b.rssi || -100) - (a.rssi || -100));

  // Build unique-address map from raw advertisements (one entry per MAC)
  const _setupScannerAddrs = ctx.helpers.scannerAddrs();
  const adAddrMap = {};
  for (const ad of (snap?.ble?.advertisements || [])) {
    const addr = (ad.address || "").toUpperCase();
    if (!addr) continue;
    if (_setupScannerAddrs.has(addr)) continue;
    if (!adAddrMap[addr]) {
      adAddrMap[addr] = { address: addr, name: ad.name || addr, rssi: ad.rssi };
    } else if ((ad.rssi || -200) > (adAddrMap[addr].rssi || -200)) {
      adAddrMap[addr].rssi = ad.rssi;
    }
  }
  // Only show addresses not already covered by bleObjs (include all_addresses for rotating-MAC devices)
  const knownAddrs = new Set();
  for (const o of bleObjs) {
    if (o.address) knownAddrs.add(o.address.toUpperCase());
    for (const a of (o.all_addresses || [])) { if (a) knownAddrs.add(String(a).toUpperCase()); }
  }
  const adOnlyDevices = Object.values(adAddrMap).filter(d => !knownAddrs.has(d.address));
  adOnlyDevices.sort((a, b) => (b.rssi || -200) - (a.rssi || -200));

  const allDevices = bleObjs.length + adOnlyDevices.length;

  const deviceCard = el("div", { class: "card" });
  deviceCard.appendChild(el("div", { style: "font-weight:700;font-size:14px;margin-bottom:8px" }, "Beacon Device"));
  deviceCard.appendChild(el("div", { class: "muted", style: "font-size:12px;margin-bottom:10px" },
    "Select the phone or tag that will act as your calibration beacon. It must be visible to your scanners (Bluetooth on, HA companion app running)."));

  if (allDevices) {
    const sel = document.createElement("select");
    sel.style.cssText = "width:100%;margin-bottom:10px;";
    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = cs.deviceId ? "" : "— choose device —";
    sel.appendChild(placeholder);
    // Tracked objects — use stable identifiers for rotating-MAC devices
    for (const o of bleObjs) {
      // private_ble → canonical_id (irk:...), ibeacon → key, else → address/entity_id
      const stableId = o.kind === "private_ble" ? (o.canonical_id || o.address || "")
                      : o.kind === "ibeacon"     ? (o.key || o.address || "")
                      : (o.address || o.entity_id || "");
      const opt = document.createElement("option");
      opt.value = stableId;
      opt.textContent = (o.user_label || o.name || stableId) + (o.rssi ? ` (${o.rssi} dBm)` : "") + (o.kind === "private_ble" ? " [Private BLE]" : o.kind === "ibeacon" ? " [iBeacon]" : "");
      if (stableId === cs.deviceId) opt.selected = true;
      sel.appendChild(opt);
    }
    // Raw advertisement devices not already in objects.list (hidden in quiet mode)
    if (adOnlyDevices.length && !_quietMode) {
      const grp = document.createElement("optgroup");
      grp.label = "── Raw BLE advertisements ──";
      for (const d of adOnlyDevices) {
        const opt = document.createElement("option");
        opt.value = d.address;
        opt.textContent = (d.name !== d.address ? d.name + "  " : "") + d.address + (d.rssi ? ` (${d.rssi} dBm)` : "");
        if (d.address === (cs.deviceId || "").toUpperCase()) opt.selected = true;
        grp.appendChild(opt);
      }
      sel.appendChild(grp);
    }
    sel.addEventListener("change", () => {
      cs.deviceId = sel.value;
      const obj = bleObjs.find(o => {
        const sid = o.kind === "private_ble" ? (o.canonical_id || o.address || "")
                  : o.kind === "ibeacon"     ? (o.key || o.address || "")
                  : (o.address || o.entity_id || "");
        return sid === sel.value;
      });
      cs.deviceLabel = obj ? (obj.user_label || obj.name || sel.value) : sel.value;
      ctx.actions.renderRooms();
    });
    deviceCard.appendChild(sel);
  } else {
    deviceCard.appendChild(el("div", { style: "font-size:12px;color:#f59e0b;margin-bottom:10px" },
      "No BLE devices visible in snapshot. Switch to Live mode and ensure Bluetooth is active on your phone."));
  }

  // Manual MAC entry
  const manualRow = el("div", { style: "display:flex;gap:8px;align-items:center;margin-bottom:6px" });
  const macInput = document.createElement("input");
  macInput.type = "text";
  macInput.placeholder = "Or enter MAC / entity_id manually…";
  macInput.style.cssText = "flex:1;font-family:monospace;font-size:12px;";
  macInput.value = cs.deviceId || "";
  const applyBtn = el("button", { class: "btn inline" }, "Use");
  applyBtn.addEventListener("click", () => {
    if (macInput.value.trim()) {
      cs.deviceId = macInput.value.trim();
      cs.deviceLabel = cs.deviceId;
      ctx.actions.renderRooms();
    }
  });
  manualRow.appendChild(macInput);
  manualRow.appendChild(applyBtn);
  deviceCard.appendChild(manualRow);

  // Resolve selected device's advertisements (used by both status box and radio status)
  const _beaconResult = (cs.deviceId && snap) ? _findBeaconAds(snap, cs.deviceId) : { myAds: [], perRadio: {}, targetAddr: "" };

  // Show selected device live data using advertisements for real per-radio RSSI
  if (cs.deviceId && snap) {
    const { perRadio, targetAddr } = _beaconResult;
    const radioCount = Object.keys(perRadio).length;
    const _did = cs.deviceId;
    const obj = (snap?.objects?.list || []).find(o =>
      (o.address || "").toUpperCase() === (targetAddr || _did).toUpperCase() ||
      (o.entity_id || "") === _did ||
      (o.canonical_id || "") === _did ||
      (o.key || "") === _did
    );
    if (radioCount > 0) {
      const box = el("div", { style: "background:#0a150e;border:1px solid #1b3526;border-radius:8px;padding:10px;margin-top:6px" });
      box.appendChild(el("div", { style: "font-weight:600;font-size:13px;color:#52b788;margin-bottom:6px" },
        `✓ ${obj?.user_label || obj?.name || cs.deviceId} — seen by ${radioCount} radio${radioCount > 1 ? "s" : ""}`));
      if (obj?.room) box.appendChild(el("div", { style: "font-size:12px;color:#94a3b8;margin-bottom:6px" }, `Room: ${obj.room}`));
      box.appendChild(el("div", { style: "font-size:11px;color:#78909c;margin-bottom:4px" }, "Per-radio RSSI:"));
      const sorted = Object.entries(perRadio).sort((a, b) => (b[1].rssi || -200) - (a[1].rssi || -200));
      const _setupTxPower = obj?.tx_power ?? null;
      for (const [src, info] of sorted) {
        box.appendChild(_rssiRow(el, info.name || src, info.rssi, null, info.age_s, _setupTxPower, _plOpts(ctx, src)));
      }
      deviceCard.appendChild(box);
    } else {
      // Check if this is a Bermuda/entity tracker with its own RSSI attribute
      const tag = (snap?.tags || []).find(t => t.entity_id === cs.deviceId);
      const entityRssi = tag?.rssi || obj?.rssi;
      const entityScanner = tag?.scanner || tag?.nearest_receiver || tag?.receiver;
      if (entityRssi || entityScanner) {
        const box = el("div", { style: "background:#0a150e;border:1px solid #3d2d0a;border-radius:8px;padding:10px;margin-top:6px" });
        box.appendChild(el("div", { style: "font-weight:600;font-size:13px;color:#fbbf24;margin-bottom:6px" },
          `⚠ ${obj?.user_label || obj?.name || cs.deviceId} — entity data only (no direct BLE advertisements)`));
        if (obj?.room) box.appendChild(el("div", { style: "font-size:12px;color:#94a3b8;margin-bottom:6px" }, `Room: ${obj.room}`));
        if (entityRssi) box.appendChild(el("div", { style: "font-size:12px;color:#94a3b8" }, `RSSI: ${entityRssi} dBm (from entity attributes)`));
        if (entityScanner) box.appendChild(el("div", { style: "font-size:12px;color:#94a3b8" }, `Nearest scanner: ${entityScanner}`));
        box.appendChild(el("div", { style: "font-size:11px;color:#78909c;margin-top:8px;line-height:1.5" },
          "This device uses private BLE (rotating MAC). To get per-radio RSSI, set up the Private BLE Device integration in HA " +
          "(Settings → Devices & Services → Add → Private BLE Device), or enable iBeacon transmitter in the HA Companion App."));
        deviceCard.appendChild(box);
      } else {
        const warnBox = el("div", { style: "font-size:12px;color:#f59e0b;margin-top:6px;padding:10px;background:#0a150e;border-radius:6px;line-height:1.6" });
        warnBox.appendChild(el("div", { style: "font-weight:600;margin-bottom:4px" }, `⚠ "${cs.deviceId}" not seen in any radio advertisement.`));
        warnBox.appendChild(el("div", {}, "If this is a phone or watch (rotating MAC), you need one of:"));
        warnBox.appendChild(el("div", { style: "padding-left:12px;margin-top:4px" }, "• Private BLE Device integration (Settings → Devices & Services → Add Integration)"));
        warnBox.appendChild(el("div", { style: "padding-left:12px" }, "• HA Companion App with iBeacon transmitter enabled"));
        warnBox.appendChild(el("div", { style: "margin-top:4px" }, "For other devices: make sure Bluetooth is on and the device is near a scanner."));
        deviceCard.appendChild(warnBox);
      }
    }
  }
  wrap.appendChild(deviceCard);

  // Floor selector (primary — maps are background visual aids)
  const maps = ctx.state.maps?.list || [];
  const mapCard = el("div", { class: "card" });
  mapCard.appendChild(el("div", { style: "font-weight:700;font-size:14px;margin-bottom:8px" }, "Floor"));
  mapCard.appendChild(el("div", { class: "muted", style: "font-size:12px;margin-bottom:10px" },
    "Select which floor you're calibrating. Maps are used as visual reference only."));
  if (maps.length) {
    const mapSel = document.createElement("select");
    mapSel.style.width = "100%";
    const mp0 = document.createElement("option");
    mp0.value = "";
    mp0.textContent = cs.mapId ? "" : "\u2014 choose a floor \u2014";
    mapSel.appendChild(mp0);

    // Build floor_id → maps lookup
    const _fl = ctx.state.model?.floors || [];
    const _floorMaps = new Map(); // floor_id → [map, ...]
    for (const m of maps) {
      const fid = m.floor_id || "main";
      if (!_floorMaps.has(fid)) _floorMaps.set(fid, []);
      _floorMaps.get(fid).push(m);
    }

    // Floor entries
    for (const f of _fl) {
      const fMaps = _floorMaps.get(f.id) || [];
      if (!fMaps.length) continue;
      const opt = document.createElement("option");
      opt.value = `__floor__${f.id}`;
      opt.textContent = `${f.name || f.id} (${fMaps.length} map${fMaps.length > 1 ? "s" : ""})`;
      if (cs.mapId && fMaps.some(m => m.id === cs.mapId)) opt.selected = true;
      mapSel.appendChild(opt);
    }
    // Floors in maps but not in model
    for (const [fid, fMaps] of _floorMaps) {
      if (_fl.some(f => f.id === fid)) continue;
      const opt = document.createElement("option");
      opt.value = `__floor__${fid}`;
      opt.textContent = `${fid} (${fMaps.length} map${fMaps.length > 1 ? "s" : ""})`;
      if (cs.mapId && fMaps.some(m => m.id === cs.mapId)) opt.selected = true;
      mapSel.appendChild(opt);
    }

    mapSel.addEventListener("change", () => {
      const v = mapSel.value;
      if (v.startsWith("__floor__")) {
        const fid = v.replace("__floor__", "");
        const candidates = _floorMaps.get(fid) || [];
        const best = candidates.slice().sort((a, b) => {
          const ra = (a.receivers || []).length + Object.keys(a.room_bounds || {}).length;
          const rb = (b.receivers || []).length + Object.keys(b.room_bounds || {}).length;
          return rb - ra;
        })[0];
        cs.mapId = best ? best.id : "";
        cs._floorId = fid;
      } else {
        cs.mapId = v;
      }
      ctx.actions.renderRooms();
    });
    mapCard.appendChild(mapSel);
  } else {
    mapCard.appendChild(el("div", { style: "font-size:12px;color:#f59e0b" },
      "No maps uploaded yet. Upload a floor plan in the Maps tab first."));
  }
  wrap.appendChild(mapCard);

  // Duration setting
  const durCard = el("div", { class: "card" });
  durCard.appendChild(el("div", { style: "font-weight:700;font-size:14px;margin-bottom:8px" }, "Collection Duration"));
  durCard.appendChild(el("div", { class: "muted", style: "font-size:12px;margin-bottom:10px" },
    "How long to sample RSSI at each calibration point. Sampled every 1s — 30s gives ~30 samples, 60s gives ~60. 60s recommended for best accuracy."));
  const durRow = el("div", { style: "display:flex;gap:10px;flex-wrap:wrap" });
  for (const d of [15, 30, 60, 90]) {
    const btn = el("button", {
      class: "btn" + (cs.duration === d ? "" : " inline"),
      style: "min-width:60px",
      onclick: () => { cs.duration = d; ctx.actions.renderRooms(); },
    }, `${d}s`);
    durRow.appendChild(btn);
  }
  durCard.appendChild(durRow);
  wrap.appendChild(durCard);

  // Radio status — show all radios and how many BLE devices each sees
  if (snap) {
    const radios = snap?.ble?.radios || [];
    const radioCard = el("div", { class: "card" });
    radioCard.appendChild(el("div", { style: "font-weight:700;font-size:14px;margin-bottom:6px" }, "Radio Status"));
    if (radios.length) {
      const ads = snap?.ble?.advertisements || [];
      for (const r of radios) {
        const seen = ads.filter(a => a.source === r.source).length;
        const beaconHere = cs.deviceId ? !!_beaconResult.perRadio[r.source] : false;
        // Prefer area name (room) over raw adapter name
        const sid = _sid(r.source || "");
        const displayName = (sid ? sid+" " : "") + (r.area_name || r.area || r.name || r.source || "?");
        const subLabel = (r.area_name || r.area) && r.name && r.name !== r.source ? r.name : "";
        const nameEl = el("div", { style: "flex:1;min-width:80px" }, [
          el("span", { style: "font-size:12px;font-weight:600" }, displayName),
          ...(subLabel ? [el("span", { style: "font-size:10px;color:#78909c;display:block;font-family:monospace" }, subLabel)] : []),
        ]);
        const row = el("div", { style: "display:flex;gap:8px;align-items:center;padding:4px 0;border-bottom:1px solid #0d1f12;flex-wrap:wrap" }, [
          nameEl,
          (()=>{ const ss = scannerStatus ? scannerStatus(r, ads) : {label:r.scanning?"scanning":"idle",cls:r.scanning?"badge":"badge warn",title:""}; const b = el("span",{class:ss.cls,style:"font-size:10px",title:ss.title},ss.label); if(ss.style) b.style.cssText+="font-size:10px;"+ss.style; return b; })(),
          el("span", { class: "muted", style: "font-size:11px;white-space:nowrap" }, `${seen} device${seen !== 1 ? "s" : ""}`),
          beaconHere ? el("span", { style: "font-size:10px;color:#52b788;white-space:nowrap" }, "✓ beacon") : null,
        ].filter(Boolean));
        radioCard.appendChild(row);
      }
    } else {
      radioCard.appendChild(el("div", { class: "muted", style: "font-size:12px" },
        "No radios in snapshot. Switch to Live mode."));
    }
    // Total advertisement count
    const totalAds = (snap?.ble?.advertisements || []).length;
    radioCard.appendChild(el("div", { class: "muted", style: "font-size:11px;margin-top:6px" },
      `${totalAds} total BLE advertisement${totalAds !== 1 ? "s" : ""} in snapshot`));
    wrap.appendChild(radioCard);
  }

  // Readiness check
  const ready = cs.deviceId && cs.mapId;
  const readyCard = el("div", { class: "card", style: `border-color:${ready ? "#52b788" : "#f59e0b"}` }, [
    el("div", { style: `font-weight:700;font-size:14px;margin-bottom:6px;color:${ready ? "#52b788" : "#f59e0b"}` },
      ready ? "✓ Ready to calibrate" : "⚠ Setup incomplete"),
    el("div", { style: "font-size:12px;color:#94a3b8" }, [
      el("span", { style: `color:${cs.deviceId ? "#52b788" : "#f59e0b"}` },
        (cs.deviceId ? "✓" : "✗") + " Beacon device selected"),
      el("br"),
      el("span", { style: `color:${cs.mapId ? "#52b788" : "#f59e0b"}` },
        (cs.mapId ? "\u2713" : "\u2717") + " Floor selected"),
    ]),
    ...(ready ? [
      el("button", {
        class: "btn",
        style: "margin-top:10px;width:100%",
        onclick: () => { cs.tab = "pin"; ctx.actions.renderRooms(); },
      }, "Start Calibrating →"),
    ] : []),
  ]);
  wrap.appendChild(readyCard);

  // Progress summary
  const pts = calData.points || [];
  if (pts.length) {
    const mapIds = [...new Set(pts.map(p => p.map_id))];
    wrap.appendChild(el("div", { class: "card" }, [
      el("div", { style: "font-weight:700;font-size:14px;margin-bottom:6px" }, "Calibration Progress"),
      el("div", { style: "font-size:13px;color:#94a3b8" },
        `${pts.length} point${pts.length > 1 ? "s" : ""} collected across ${mapIds.length} map${mapIds.length > 1 ? "s" : ""}.`),
      el("button", {
        class: "btn inline",
        style: "margin-top:8px",
        onclick: () => { cs.tab = "model"; ctx.actions.renderRooms(); },
      }, "View Model →"),
    ]));
  }

  return wrap;
}

// ── Pin & Listen tab ──────────────────────────────────────────────────────────
function _pinAndListen(ctx, el, cs, calData) {
  const wrap = el("div", { style: "display:flex;flex-direction:column;gap:14px" });

  if (!cs.deviceId || !cs.mapId) {
    wrap.appendChild(el("div", { class: "card", style: "border-color:#f59e0b" }, [
      el("div", { style: "font-size:13px;color:#f59e0b;font-weight:700" }, "Setup required"),
      el("div", { class: "muted", style: "font-size:12px;margin-top:4px" },
        "Return to Setup and select your beacon device and floor."),
      el("button", {
        class: "btn", style: "margin-top:10px",
        onclick: () => { cs.tab = "setup"; ctx.actions.renderRooms(); },
      }, "Go to Setup"),
    ]));
    return wrap;
  }

  const maps = ctx.state.maps?.list || [];
  const mapData = maps.find(m => m.id === cs.mapId);
  if (!mapData?.image?.filename) {
    wrap.appendChild(el("div", { class: "card" }, [
      el("div", { class: "muted" }, "Selected map has no image. Upload a floor plan in the Maps tab."),
    ]));
    return wrap;
  }

  // Instructions (collapsed after first point)
  const pts = calData.points || [];
  const mapPts = pts.filter(p => p.map_id === cs.mapId);
  if (!mapPts.length) {
    wrap.appendChild(el("div", { style: "font-size:12px;color:#78909c;padding:8px 4px;line-height:1.6" },
      "Tap anywhere on the map to place a calibration pin, then press Start Collecting. Stand still at that exact spot for the full duration."));
  }

  // ── Interactive map ──────────────────────────────────────────────────────
  const mapWrap = el("div", { style: "position:relative;border-radius:10px;overflow:hidden;border:2px solid #1b3526;touch-action:none" });
  const snap = (ctx.state.live && ctx.state.live.snapshot) || null;

  // Build SVG string
  const ar = (mapData.image.height || 600) / (mapData.image.width || 800);
  const imgUrl = ctx.helpers.mapImageUrl(mapData);
  const vbH = ar * 100;

  // Existing calibration points as dots
  let dotsSvg = mapPts.map(p => {
    const px = p.x_frac * 100;
    const py = p.y_frac * vbH;
    const sc = (p.scanner_readings || []).length;
    return `<circle cx="${px}" cy="${py}" r="3.5" fill="#52b788" stroke="white" stroke-width="1" opacity="0.85"/>
            <title>${p.room || p.label || ""} (${sc} scanners)</title>`;
  }).join("");

  // Current pin
  let pinSvg = "";
  if (cs.pinX !== null) {
    const px = cs.pinX * 100;
    const py = cs.pinY * vbH;
    pinSvg = `
      <circle cx="${px}" cy="${py}" r="10" fill="none" stroke="#f59e0b" stroke-width="2" stroke-dasharray="3 2" opacity="0.8"/>
      <circle cx="${px}" cy="${py}" r="4" fill="#f59e0b" stroke="white" stroke-width="1.5"/>
      <line x1="${px}" y1="${py - 10}" x2="${px}" y2="${py - 16}" stroke="#f59e0b" stroke-width="1.5"/>`;
  }

  const svgStr = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 ${vbH}"
      preserveAspectRatio="none" style="width:100%;display:block;cursor:crosshair">
    <image href="${imgUrl}" x="0" y="0" width="100" height="${vbH}" preserveAspectRatio="none"/>
    ${dotsSvg}
    ${pinSvg}
  </svg>`;

  mapWrap.innerHTML = svgStr;

  // Tap handler — must attach after setting innerHTML
  const svgEl = mapWrap.querySelector("svg");
  if (svgEl && !cs.collecting) {
    const onTap = (ev) => {
      const rect = svgEl.getBoundingClientRect();
      // touchend: use changedTouches (the lifted finger); click: use clientX/Y directly
      const touch = (ev.changedTouches && ev.changedTouches[0]) || null;
      const clientX = touch ? touch.clientX : ev.clientX;
      const clientY = touch ? touch.clientY : ev.clientY;
      cs.pinX = (clientX - rect.left) / rect.width;
      cs.pinY = (clientY - rect.top) / rect.height;
      cs.readings = null;
      // Auto-detect room
      cs.pinRoom = _detectRoom(cs.pinX, cs.pinY, mapData) || "";
      ctx.actions.renderRooms();
    };
    svgEl.addEventListener("click", onTap);
    svgEl.addEventListener("touchend", (ev) => { ev.preventDefault(); onTap(ev); });
  }
  wrap.appendChild(mapWrap);

  // Map legend
  wrap.appendChild(el("div", { style: "font-size:11px;color:#78909c;text-align:center" },
    `${mapPts.length} point${mapPts.length !== 1 ? "s" : ""} on this map · tap to place pin`));

  // ── Pin info panel ────────────────────────────────────────────────────────
  if (cs.pinX !== null) {
    const pinPanel = el("div", { class: "card" });

    if (cs.collecting) {
      // Active collection UI — injected as a real DOM node we can update
      const collUI = _buildCollectionUI(ctx, el, cs, mapData);
      pinPanel.appendChild(collUI);
    } else if (cs.readings) {
      // Collection done — show summary + save/discard
      pinPanel.appendChild(_buildSavePanel(ctx, el, cs, calData, mapData));
    } else {
      // Ready to collect
      pinPanel.appendChild(el("div", { style: "margin-bottom:10px" }, [
        el("div", { style: "font-weight:700;font-size:14px;margin-bottom:4px" },
          `Pin at: ${cs.pinRoom || "Unknown room"}`),
        el("div", { style: "font-size:12px;color:#94a3b8" },
          `Position: ${(cs.pinX * 100).toFixed(1)}% × ${(cs.pinY * 100).toFixed(1)}%`),
      ]));

      // Optional label
      const lblRow = el("div", { style: "margin-bottom:10px" });
      const lblInput = document.createElement("input");
      lblInput.type = "text";
      lblInput.placeholder = `Label (optional, e.g. "Kitchen center")`;
      lblInput.style.width = "100%";
      lblInput.style.boxSizing = "border-box";
      lblInput.value = cs.pinLabel || "";
      lblInput.addEventListener("input", () => { cs.pinLabel = lblInput.value; });
      lblRow.appendChild(lblInput);
      pinPanel.appendChild(lblRow);

      // Live beacon signal status
      const { perRadio: pinPerRadio } = _findBeaconAds(snap, cs.deviceId);
      const pinRadioCount = Object.keys(pinPerRadio).length;
      // Resolve TX power from selected object (iBeacon tx_power field) for distance estimate
      const _pinObj = (snap?.objects?.list || []).find(o =>
        (o.key || "") === cs.deviceId || (o.address || "").toUpperCase() === (cs.deviceId || "").toUpperCase() ||
        (o.entity_id || "") === cs.deviceId || (o.canonical_id || "") === cs.deviceId);
      const _pinTxPower = _pinObj?.tx_power ?? null;
      const signalBox = el("div", { style: `padding:8px 10px;border-radius:8px;margin-bottom:10px;background:#071008;border:1px solid ${pinRadioCount > 0 ? "#1b3526" : "#7d5c2b"}` });
      if (pinRadioCount > 0) {
        signalBox.appendChild(el("div", { style: "font-size:12px;color:#52b788;font-weight:600;margin-bottom:4px" },
          `✓ Beacon visible on ${pinRadioCount} radio${pinRadioCount > 1 ? "s" : ""}`));
        const sorted = Object.entries(pinPerRadio).sort((a, b) => (b[1].rssi || -200) - (a[1].rssi || -200));
        for (const [src, info] of sorted) {
          signalBox.appendChild(_rssiRow(el, info.name || src, info.rssi, null, info.age_s, _pinTxPower, _plOpts(ctx, src)));
        }
      } else {
        signalBox.appendChild(el("div", { style: "font-size:12px;color:#f59e0b;font-weight:600" },
          "⚠ Beacon not currently detected by any radio"));
        signalBox.appendChild(el("div", { class: "muted", style: "font-size:11px;margin-top:3px" },
          "Collection will start but may capture no data. Verify beacon is broadcasting."));
      }
      pinPanel.appendChild(signalBox);

      // Start button
      const startBtn = el("button", {
        class: "btn",
        style: "width:100%;font-size:15px;padding:12px",
      }, `▶  Start Collecting (${cs.duration}s)`);
      startBtn.addEventListener("click", () => _startCollection(ctx, cs, snap, mapData));
      pinPanel.appendChild(startBtn);
    }

    wrap.appendChild(pinPanel);
  }

  return wrap;
}

// ── Collection UI ─────────────────────────────────────────────────────────────
function _buildCollectionUI(ctx, el, cs) {
  const wrap = el("div", { id: "collect-ui" });
  wrap.appendChild(el("div", { style: "font-weight:700;font-size:15px;text-align:center;margin-bottom:10px" },
    "Collecting — hold still!"));

  // Countdown — updated by collection loop via direct DOM ref stored on cs
  const timerDiv = el("div", {
    id: "collect-timer",
    style: "font-size:48px;font-weight:900;text-align:center;color:#52b788;font-family:monospace;margin-bottom:4px",
  }, "…");
  cs._timerEl = timerDiv;   // store ref so loop can update without document.getElementById
  wrap.appendChild(timerDiv);

  // Poll counter — proves the loop is running
  const pollDiv = el("div", {
    style: "font-size:11px;text-align:center;color:#78909c;margin-bottom:12px;font-family:monospace",
  }, `Poll #${cs._pollCount || 0}  ·  ${_totalSamples(cs)} sample${_totalSamples(cs) !== 1 ? "s" : ""} collected`);
  cs._pollCountEl = pollDiv;
  wrap.appendChild(pollDiv);

  wrap.appendChild(el("div", { style: "font-size:12px;color:#78909c;text-align:center;margin-bottom:8px" },
    "Per-radio RSSI (updating live):"));

  // Scanner RSSI container — updated by collection loop
  const scanDiv = el("div", { id: "collect-scanners", style: "display:flex;flex-direction:column;gap:6px" });
  cs._scanEl = scanDiv;     // store ref so loop can update without document.getElementById
  // Populate immediately from any readings already accumulated
  const { el: elHelper } = ctx.helpers;
  for (const [src, rd] of Object.entries(cs.readings || {})) {
    const mean = rd.samples.length ? rd.samples.reduce((a, b) => a + b, 0) / rd.samples.length : -100;
    scanDiv.appendChild(_rssiRow(elHelper, rd.name || src, Math.round(mean), rd.samples.length, null, cs._txPower, _plOpts(ctx, src)));
  }
  wrap.appendChild(scanDiv);

  // Stop button
  const stopBtn = el("button", {
    class: "btn inline",
    style: "margin-top:14px;width:100%",
  }, "Stop & Discard");
  stopBtn.addEventListener("click", () => {
    cs.stopFlag = true;
    cs.collecting = false;
    cs.readings = null;
    ctx.actions.renderRooms();
  });
  wrap.appendChild(stopBtn);

  return wrap;
}

// ── Start collection loop ─────────────────────────────────────────────────────
function _startCollection(ctx, cs, _snap, _mapData) {
  cs.collecting  = true;
  cs.stopFlag    = false;
  cs.readings    = {};
  cs._lastSample = {};   // per-radio {rssi, age_s} from previous tick (stale-ad dedup)
  cs._pollCount  = 0;
  // Resolve TX power for distance estimates during/after collection
  const _csObj = (_snap?.objects?.list || []).find(o =>
    (o.key || "") === cs.deviceId || (o.address || "").toUpperCase() === (cs.deviceId || "").toUpperCase() ||
    (o.entity_id || "") === cs.deviceId || (o.canonical_id || "") === cs.deviceId);
  cs._txPower = _csObj?.tx_power ?? null;
  ctx.actions.renderRooms();

  const endTime = Date.now() + cs.duration * 1000;

  const loop = async () => {
    if (cs.stopFlag) return;

    // Poll snapshot
    try { await ctx.actions.refreshSnapshot(); } catch (_) { /**/ }
    cs._pollCount = (cs._pollCount || 0) + 1;

    const snap = ctx.state.live?.snapshot;

    // ── Collect per-radio RSSI from BLE advertisements (primary source) ──────
    // snap.objects.list[].sources is a list of {source, rssi, age_s} objects.
    // The real per-radio RSSI also lives in snap.ble.advertisements, one entry per {device,radio}.
    const { perRadio } = _findBeaconAds(snap, cs.deviceId);
    for (const [src, info] of Object.entries(perRadio)) {
      if (!_acceptCalSample(cs._lastSample, src, info)) continue;
      if (!cs.readings[src]) {
        cs.readings[src] = { name: info.name || src, samples: [] };
      } else if (info.name && info.name !== src) {
        cs.readings[src].name = info.name; // update to area name if now available
      }
      cs.readings[src].samples.push(info.rssi);
    }

    const remaining = Math.max(0, Math.ceil((endTime - Date.now()) / 1000));
    const total = _totalSamples(cs);
    const { el } = ctx.helpers;

    // Update DOM directly via refs stored on cs (works in shadow DOM)
    if (cs._timerEl) cs._timerEl.textContent = remaining + "s";
    if (cs._pollCountEl) cs._pollCountEl.textContent =
      `Poll #${cs._pollCount}  ·  ${total} sample${total !== 1 ? "s" : ""} collected`;
    if (cs._scanEl) {
      cs._scanEl.innerHTML = "";
      const sorted = Object.entries(cs.readings).sort((a, b) => {
        const ma = a[1].samples.length ? a[1].samples.reduce((x,y)=>x+y,0)/a[1].samples.length : -200;
        const mb = b[1].samples.length ? b[1].samples.reduce((x,y)=>x+y,0)/b[1].samples.length : -200;
        return mb - ma;
      });
      if (sorted.length) {
        for (const [src, rd] of sorted) {
          const mean = rd.samples.reduce((a, b) => a + b, 0) / rd.samples.length;
          cs._scanEl.appendChild(_rssiRow(el, rd.name || src, Math.round(mean), rd.samples.length, null, cs._txPower, _plOpts(ctx, src)));
        }
      } else {
        cs._scanEl.appendChild(el("div", { style: "font-size:12px;color:#f59e0b;text-align:center;padding:8px" },
          "Beacon not detected yet. Make sure Bluetooth is on and device is near a scanner."));
      }
    }

    if (Date.now() >= endTime || cs.stopFlag) {
      cs.collecting = false;
      cs.readings = (!cs.stopFlag && Object.keys(cs.readings).length > 0) ? cs.readings : null;
      ctx.actions.renderRooms();
      return;
    }

    const nextIn = Math.min(POLL_MS, endTime - Date.now());
    if (nextIn > 0) setTimeout(loop, nextIn);
  };

  loop();
}

// ── Save panel (after collection) ─────────────────────────────────────────────
function _buildSavePanel(ctx, el, cs, calData, mapData) {
  const wrap = el("div");
  const readingsEntries = Object.entries(cs.readings || {});
  const totalSamples = readingsEntries.reduce((s, [, r]) => s + r.samples.length, 0);

  wrap.appendChild(el("div", { style: "font-weight:700;font-size:14px;margin-bottom:8px;color:#52b788" },
    "✓ Collection complete"));
  wrap.appendChild(el("div", { style: "font-size:12px;color:#94a3b8;margin-bottom:10px" },
    `${readingsEntries.length} scanner${readingsEntries.length !== 1 ? "s" : ""} · ${totalSamples} total samples · ${cs.pinRoom || "unknown room"}`));

  // Per-scanner summary
  if (readingsEntries.length) {
    for (const [src, rd] of readingsEntries) {
      const mean = rd.samples.length ? rd.samples.reduce((a, b) => a + b, 0) / rd.samples.length : -100;
      wrap.appendChild(_rssiRow(el, rd.name || src, Math.round(mean), rd.samples.length, null, cs._txPower, _plOpts(ctx, src)));
    }
  } else {
    wrap.appendChild(el("div", { style: "font-size:12px;color:#f59e0b;margin-bottom:8px" },
      "No scanner data captured. The device was not visible during collection."));
  }

  // Buttons
  const btnRow = el("div", { style: "display:flex;gap:8px;margin-top:12px" });

  if (readingsEntries.length > 0) {
    const saveBtn = el("button", { class: "btn save-pulse", style: "flex:1" }, "\ud83d\udcbe Save Point");
    saveBtn.addEventListener("click", async () => {
      saveBtn.disabled = true;
      saveBtn.textContent = "Saving…";
      try {
        // Build point payload
        const scannerReadings = readingsEntries.map(([source, rd]) => ({
          source,
          name: rd.name || source,
          rssi_samples: rd.samples,
        }));
        await ctx.actions.calibrationSavePoint({
          map_id:    cs.mapId,
          x_frac:    cs.pinX,
          y_frac:    cs.pinY,
          floor_id:  mapData.floor_id || "",
          room:      cs.pinRoom || "",
          label:     cs.pinLabel || "",
          device_id: cs.deviceId || "",
          duration_s: cs.duration,
          scanner_readings: scannerReadings,
        });
        // Refresh local DB
        const fresh = await ctx.actions.calibrationGet();
        ctx.state.calibration = fresh;
        cs.readings   = null;
        cs.pinX       = null;
        cs.pinY       = null;
        cs.pinRoom    = null;
        cs.pinLabel   = "";
        cs.savedThisSession++;
        ctx.toast(`Point saved (${cs.savedThisSession} this session).`);
        ctx.actions.renderRooms();
      } catch (e) {
        saveBtn.disabled = false;
        saveBtn.textContent = "Save Point";
        // HA websocket errors are objects; String() gives "[object Object]"
        // and hides the one thing the user needs — e.g. that this map has no
        // metre scale yet and the point was refused for having no position.
        ctx.toast("Save failed: " + (e && (e.message || e.code) || String(e)), true);
      }
    });
    btnRow.appendChild(saveBtn);
  }

  const discardBtn = el("button", { class: "btn inline", style: "flex:1" }, "Discard");
  discardBtn.addEventListener("click", () => {
    cs.readings = null;
    cs.pinX     = null;
    cs.pinY     = null;
    cs.pinLabel = "";
    ctx.actions.renderRooms();
  });
  btnRow.appendChild(discardBtn);
  wrap.appendChild(btnRow);

  return wrap;
}

// ── Roam tab ──────────────────────────────────────────────────────────────────
function _roam(ctx, el, cs, calData) {
  const wrap = el("div", { style: "display:flex;flex-direction:column;gap:14px" });

  if (!cs.deviceId || !cs.mapId) {
    wrap.appendChild(el("div", { class: "card", style: "border-color:#f59e0b" }, [
      el("div", { style: "color:#f59e0b;font-weight:700" }, "Setup required"),
      el("button", {
        class: "btn", style: "margin-top:10px",
        onclick: () => { cs.tab = "setup"; ctx.actions.renderRooms(); },
      }, "Go to Setup"),
    ]));
    return wrap;
  }

  const maps = ctx.state.maps?.list || [];
  const mapData = maps.find(m => m.id === cs.mapId);
  if (!mapData?.image?.filename) {
    wrap.appendChild(el("div", { class: "card" }, [
      el("div", { class: "muted" }, "No map image available."),
    ]));
    return wrap;
  }

  const pts = calData.points || [];
  const mapPts = pts.filter(p => p.map_id === cs.mapId);

  // Compute coverage grid (JS side)
  const grid = _computeCoverage(mapPts, GRID_N);
  const covered = grid.filter(v => v >= 0.5).length;
  const pct = Math.round(covered / (GRID_N * GRID_N) * 100);
  const target = _nextTarget(grid, GRID_N);

  // Coverage progress bar
  const progCard = el("div", { class: "card" });
  progCard.appendChild(el("div", { style: "display:flex;align-items:center;gap:10px;margin-bottom:8px" }, [
    el("div", { style: "font-weight:700;font-size:14px" }, "Coverage"),
    el("span", { class: "badge", style: "margin-left:auto" }, `${mapPts.length} points`),
    el("span", { class: pct >= 70 ? "badge" : "badge warn" }, `${pct}%`),
  ]));
  const barOuter = el("div", { style: "height:10px;background:#1b3526;border-radius:5px;overflow:hidden" });
  const barInner = el("div", { style: `height:100%;width:${pct}%;background:${pct >= 70 ? "#52b788" : pct >= 40 ? "#f59e0b" : "#dc2626"};transition:width 0.5s` });
  barOuter.appendChild(barInner);
  progCard.appendChild(barOuter);
  progCard.appendChild(el("div", { class: "muted", style: "font-size:11px;margin-top:6px" },
    pct >= 80
      ? "✓ Excellent coverage — model should be highly accurate."
      : pct >= 50
      ? "Good progress. Keep adding points to improve accuracy."
      : "Keep going — more points needed for a reliable model."));
  wrap.appendChild(progCard);

  // Coverage heatmap map
  const ar = (mapData.image.height || 600) / (mapData.image.width || 800);
  const vbH = ar * 100;
  const imgUrl = ctx.helpers.mapImageUrl(mapData);
  const cellW = 100 / GRID_N;
  const cellH = vbH / GRID_N;

  // Coverage grid cells
  let gridSvg = "";
  for (let cy = 0; cy < GRID_N; cy++) {
    for (let cx = 0; cx < GRID_N; cx++) {
      const v = grid[cy * GRID_N + cx];
      const opacity = Math.max(0, 0.6 * (1 - v)).toFixed(2);
      const color = v >= 0.5 ? "#52b788" : v >= 0.2 ? "#f59e0b" : "#dc2626";
      gridSvg += `<rect x="${(cx * cellW).toFixed(2)}" y="${(cy * cellH).toFixed(2)}" width="${cellW.toFixed(2)}" height="${cellH.toFixed(2)}" fill="${color}" opacity="${opacity}" rx="0.5"/>`;
    }
  }

  // Existing calibration dots
  const dotsSvg = mapPts.map(p =>
    `<circle cx="${(p.x_frac * 100).toFixed(2)}" cy="${(p.y_frac * vbH).toFixed(2)}" r="2.5" fill="#52b788" stroke="white" stroke-width="0.8" opacity="0.9"/>`
  ).join("");

  // Next target crosshair
  const tx = (target.x_frac * 100).toFixed(2);
  const ty = (target.y_frac * vbH).toFixed(2);
  const targetSvg = `
    <circle cx="${tx}" cy="${ty}" r="7" fill="none" stroke="#60a5fa" stroke-width="2" stroke-dasharray="3 2"/>
    <circle cx="${tx}" cy="${ty}" r="2.5" fill="#60a5fa"/>
    <line x1="${tx}" y1="${(parseFloat(ty) - 7)}" x2="${tx}" y2="${(parseFloat(ty) - 13)}" stroke="#60a5fa" stroke-width="1.5"/>
    <line x1="${tx}" y1="${(parseFloat(ty) + 7)}" x2="${tx}" y2="${(parseFloat(ty) + 13)}" stroke="#60a5fa" stroke-width="1.5"/>
    <line x1="${(parseFloat(tx) - 7)}" y1="${ty}" x2="${(parseFloat(tx) - 13)}" y2="${ty}" stroke="#60a5fa" stroke-width="1.5"/>
    <line x1="${(parseFloat(tx) + 7)}" y1="${ty}" x2="${(parseFloat(tx) + 13)}" y2="${ty}" stroke="#60a5fa" stroke-width="1.5"/>`;

  const mapWrap = el("div", { style: "border-radius:10px;overflow:hidden;border:2px solid #1b3526" });
  mapWrap.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 ${vbH}"
      preserveAspectRatio="none" style="width:100%;display:block">
    <image href="${imgUrl}" x="0" y="0" width="100" height="${vbH}" preserveAspectRatio="none"/>
    ${gridSvg}
    ${dotsSvg}
    ${pct < 100 ? targetSvg : ""}
  </svg>`;
  wrap.appendChild(mapWrap);

  // Legend
  wrap.appendChild(el("div", { style: "display:flex;gap:14px;font-size:11px;color:#78909c;padding:0 4px" }, [
    el("span", {}, [el("span", { style: "color:#52b788" }, "■ "), "Covered"]),
    el("span", {}, [el("span", { style: "color:#f59e0b" }, "■ "), "Partial"]),
    el("span", {}, [el("span", { style: "color:#dc2626" }, "■ "), "Uncovered"]),
    el("span", {}, [el("span", { style: "color:#60a5fa" }, "⊕ "), "Target"]),
  ]));

  // Next target card
  if (pct < 100) {
    const tgtRoom = _detectRoom(target.x_frac, target.y_frac, mapData);
    const tgtCard = el("div", { class: "card", style: "border-color:#60a5fa" });
    tgtCard.appendChild(el("div", { style: "font-weight:700;font-size:14px;color:#60a5fa;margin-bottom:6px" },
      "Next Target"));
    tgtCard.appendChild(el("div", { style: "font-size:13px;margin-bottom:4px" },
      tgtRoom ? `Go to: ${tgtRoom}` : `Position: ${(target.x_frac * 100).toFixed(0)}% × ${(target.y_frac * 100).toFixed(0)}%`));
    tgtCard.appendChild(el("div", { class: "muted", style: "font-size:12px;margin-bottom:12px" },
      "Walk to the blue crosshair location on the map. Stand still, then press the button below."));

    if (cs.collecting) {
      tgtCard.appendChild(_buildCollectionUI(ctx, el, cs));
    } else if (cs.readings) {
      tgtCard.appendChild(_buildSavePanel(ctx, el, cs, calData, mapData));
    } else {
      const collectBtn = el("button", {
        class: "btn",
        style: "width:100%;font-size:15px;padding:12px",
      }, `▶  I'm Here — Collect (${cs.duration}s)`);
      collectBtn.addEventListener("click", () => {
        // Auto-set pin to target location
        cs.pinX     = target.x_frac;
        cs.pinY     = target.y_frac;
        cs.pinRoom  = tgtRoom || "";
        cs.pinLabel = tgtRoom ? `Roam: ${tgtRoom}` : "Roam point";
        const snap = (ctx.state.live && ctx.state.live.snapshot) || null;
        _startCollection(ctx, cs, snap, mapData);
      });
      tgtCard.appendChild(collectBtn);
    }
    wrap.appendChild(tgtCard);
  } else {
    wrap.appendChild(el("div", { class: "card", style: "border-color:#52b788;text-align:center" }, [
      el("div", { style: "font-size:28px;margin-bottom:8px" }, "🎉"),
      el("div", { style: "font-weight:700;font-size:15px;color:#52b788;margin-bottom:6px" }, "Full Coverage!"),
      el("div", { class: "muted", style: "font-size:12px" },
        "Every zone has calibration data. Check the Model tab to see accuracy estimates."),
      el("button", {
        class: "btn", style: "margin-top:12px",
        onclick: () => { cs.tab = "model"; ctx.actions.renderRooms(); },
      }, "View Model →"),
    ]));
  }

  return wrap;
}

// ── Model tab ─────────────────────────────────────────────────────────────────
function _modelTab(ctx, el, cs, calData) {
  const wrap = el("div", { style: "display:flex;flex-direction:column;gap:14px" });
  const pts  = calData.points || [];
  const model = calData.model || {};
  const maps  = ctx.state.maps?.list || [];

  // Compute button
  const computeCard = el("div", { class: "card" });
  computeCard.appendChild(el("div", { style: "font-weight:700;font-size:14px;margin-bottom:6px" }, "Model Computation"));
  computeCard.appendChild(el("div", { class: "muted", style: "font-size:12px;margin-bottom:10px" },
    "Fit path-loss curves and run cross-validation after adding new calibration points."));
  const computeWrap = el("div", { style: "display:flex;gap:8px;align-items:center" });
  const makeComputeBtn = () => {
    const b = el("button", { class: "btn" }, "Compute Model");
    b.addEventListener("click", async () => {
      computeWrap.innerHTML = "";
      computeWrap.appendChild(el("span", { class: "muted", style: "font-size:12px" }, "Computing…"));
      try {
        const result = await ctx.actions.calibrationComputeModel();
        ctx.state.calibration = await ctx.actions.calibrationGet();
        ctx.toast("Model computed.");
        ctx.actions.renderRooms();
      } catch (e) {
        ctx.toast("Compute failed: " + String(e), true);
        computeWrap.innerHTML = "";
        computeWrap.appendChild(makeComputeBtn());
      }
    });
    return b;
  };
  computeWrap.appendChild(makeComputeBtn());
  computeCard.appendChild(computeWrap);

  if (model.last_computed) {
    computeCard.appendChild(el("div", {
      class: "muted",
      style: "font-size:11px;margin-top:8px",
    }, `Last computed: ${model.last_computed}`));
  }
  wrap.appendChild(computeCard);

  if (!pts.length) {
    wrap.appendChild(el("div", { class: "card" }, [
      el("div", { class: "muted" }, "No calibration points yet. Use Tune, Beacon Tune, Pin & Listen, or Roam to collect data."),
    ]));
    return wrap;
  }

  // Summary stats
  const floors = ctx.state.model?.floors || [];
  const floorIds = [...new Set(pts.map(p => p.floor_id).filter(Boolean))];
  const scanners = new Set();
  pts.forEach(p => p.scanner_readings?.forEach(r => scanners.add(r.source)));

  const summCard = el("div", { class: "card" });
  summCard.appendChild(el("div", { style: "font-weight:700;font-size:14px;margin-bottom:12px" }, "Summary"));
  const statGrid = el("div", { style: "display:grid;grid-template-columns:1fr 1fr;gap:10px" });
  const stat = (label, value, color) => el("div", { style: "background:#0a150e;border:1px solid #1b3526;border-radius:8px;padding:10px;text-align:center" }, [
    el("div", { style: `font-size:22px;font-weight:900;color:${color || "#52b788"}` }, String(value)),
    el("div", { style: "font-size:11px;color:#78909c;margin-top:2px" }, label),
  ]);
  statGrid.appendChild(stat("Calibration Points", pts.length));
  statGrid.appendChild(stat("Scanners Seen", scanners.size));
  statGrid.appendChild(stat("Floors Calibrated", floorIds.length || 1));

  const loo = model.loo_accuracy;
  if (loo) {
    const accM = loo.mean_error_m;
    statGrid.appendChild(stat("Est. Accuracy", `~${accM}m`, accM < 2 ? "#52b788" : "#f59e0b"));
  } else {
    statGrid.appendChild(stat("Accuracy", pts.length >= 4 ? "Compute →" : "Need ≥4 pts", "#78909c"));
  }
  summCard.appendChild(statGrid);
  wrap.appendChild(summCard);

  // Per-floor coverage — selector to choose which map to display
  const floorName = (fid) => {
    const f = floors.find(fl => fl.id === fid);
    return f ? f.name : fid || "Default Floor";
  };
  const effectiveFloors = floorIds.length ? floorIds : [""];
  for (const fid of effectiveFloors) {
    const floorMaps = maps.filter(m => (m.floor_id || "") === fid);
    const floorMapIds = new Set(floorMaps.map(m => m.id));
    const floorPts = pts.filter(p => (p.floor_id || "") === fid);
    floorPts.forEach(p => { if (p.map_id) floorMapIds.add(p.map_id); });
    const midsOnFloor = [...floorMapIds].filter(mid => floorPts.some(p => p.map_id === mid));

    if (!midsOnFloor.length) continue;

    const floorCard = el("div", { class: "card" });
    const floorPtCount = floorPts.length;

    // Floor header with total points
    floorCard.appendChild(el("div", { style: "display:flex;align-items:center;gap:8px;margin-bottom:10px" }, [
      el("div", { style: "font-weight:700;font-size:14px" }, floorName(fid)),
      el("span", { class: "badge", style: "margin-left:auto" }, `${floorPtCount} pts`),
    ]));

    // Container for the selected map's coverage viz
    const mapVizContainer = el("div");

    // Render a specific map's coverage into the container
    const renderMapCoverage = (mid) => {
      mapVizContainer.innerHTML = "";
      const mapData = maps.find(m => m.id === mid);
      const mapPts  = floorPts.filter(p => p.map_id === mid);
      const grid = _computeCoverage(mapPts, GRID_N);
      const covered = grid.filter(v => v >= 0.5).length;
      const pct = Math.round(covered / (GRID_N * GRID_N) * 100);

      // Stats row
      mapVizContainer.appendChild(el("div", { style: "display:flex;align-items:center;gap:8px;margin-bottom:6px" }, [
        el("span", { class: "badge", style: "font-size:10px" }, `${mapPts.length} pts on this map`),
        el("span", { class: pct >= 70 ? "badge" : "badge warn", style: "font-size:10px" }, `${pct}% coverage`),
      ]));

      if (mapData?.image?.filename) {
        const ar = (mapData.image.height || 600) / (mapData.image.width || 800);
        const vbH = ar * 100;
        const imgUrl = ctx.helpers.mapImageUrl(mapData);
        const cellW = 100 / GRID_N;
        const cellH = vbH / GRID_N;

        let gSvg = "";
        for (let cy = 0; cy < GRID_N; cy++) {
          for (let cx = 0; cx < GRID_N; cx++) {
            const v = grid[cy * GRID_N + cx];
            const op = Math.max(0, 0.55 * (1 - v)).toFixed(2);
            const col = v >= 0.5 ? "#52b788" : v >= 0.2 ? "#f59e0b" : "#dc2626";
            gSvg += `<rect x="${(cx * cellW).toFixed(1)}" y="${(cy * cellH).toFixed(1)}" width="${cellW.toFixed(1)}" height="${cellH.toFixed(1)}" fill="${col}" opacity="${op}" rx="0.5"/>`;
          }
        }
        const dotsSvg = mapPts.map(p =>
          `<circle cx="${(p.x_frac * 100).toFixed(1)}" cy="${(p.y_frac * vbH).toFixed(1)}" r="2" fill="#52b788" stroke="white" stroke-width="0.6" opacity="0.9"/>`
        ).join("");

        const miniDiv = el("div", { style: "border-radius:6px;overflow:hidden;border:1px solid #1b3526;margin-bottom:6px" });
        miniDiv.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 ${vbH}" preserveAspectRatio="none" style="width:100%;display:block">
          <image href="${imgUrl}" x="0" y="0" width="100" height="${vbH}" preserveAspectRatio="none"/>
          ${gSvg}${dotsSvg}
        </svg>`;
        mapVizContainer.appendChild(miniDiv);
      }

      const mapLoo = model.coverage_by_map?.[mid]?.loo_accuracy;
      if (mapLoo) {
        mapVizContainer.appendChild(el("div", { style: "font-size:12px;color:#94a3b8;margin-bottom:4px" },
          `Cross-validation accuracy: ~${mapLoo.mean_error_m}m mean · ${mapLoo.max_error_m}m max`));
      }
    };

    // Map selector — dropdown if multiple maps, plain label if single
    if (midsOnFloor.length > 1) {
      const sel = document.createElement("select");
      sel.style.cssText = "background:#0a150e;color:#e0e0e0;border:1px solid #1b3526;border-radius:6px;padding:6px 10px;font-size:12px;width:100%;margin-bottom:8px;cursor:pointer";
      for (const mid of midsOnFloor) {
        const mapData = maps.find(m => m.id === mid);
        const opt = document.createElement("option");
        opt.value = mid;
        opt.textContent = mapData?.name || mid;
        sel.appendChild(opt);
      }
      sel.addEventListener("change", () => renderMapCoverage(sel.value));
      floorCard.appendChild(sel);
    } else {
      const mapData = maps.find(m => m.id === midsOnFloor[0]);
      floorCard.appendChild(el("div", { style: "font-weight:600;font-size:12px;color:#94a3b8;margin-bottom:8px" }, mapData?.name || midsOnFloor[0]));
    }

    floorCard.appendChild(mapVizContainer);
    renderMapCoverage(midsOnFloor[0]);
    wrap.appendChild(floorCard);
  }

  // Per-scanner path-loss stats
  if (model.path_loss && Object.keys(model.path_loss).length) {
    const plCard = el("div", { class: "card" });
    plCard.appendChild(el("div", { style: "font-weight:700;font-size:14px;margin-bottom:10px" }, "Path-Loss Fits"));
    plCard.appendChild(el("div", { class: "muted", style: "font-size:12px;margin-bottom:10px" },
      "RSSI = RSSI_1m − 10 · n · log₁₀(d). n > 3 = heavy attenuation (walls/floors). R² > 0.7 = reliable fit."));
    const tbody = el("tbody");
    for (const [src, fit] of Object.entries(model.path_loss)) {
      const rSqColor = fit.r_squared >= 0.7 ? "#52b788" : fit.r_squared >= 0.4 ? "#f59e0b" : "#dc2626";
      tbody.appendChild(el("tr", {}, [
        el("td", { style: "font-size:11px;max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" },
          fit.scanner_name || src),
        el("td", { style: "font-family:monospace;font-size:11px" }, fit.n.toFixed(2)),
        el("td", { style: "font-family:monospace;font-size:11px" }, fit.rssi_1m + " dBm"),
        el("td", { style: `font-family:monospace;font-size:11px;color:${rSqColor}` }, fit.r_squared.toFixed(2)),
        el("td", { class: "muted", style: "font-size:11px" }, fit.point_count),
      ]));
    }
    plCard.appendChild(el("table", { class: "table" }, [
      el("thead", {}, el("tr", {}, [
        el("th", {}, "Scanner"), el("th", {}, "n"), el("th", {}, "RSSI@1m"), el("th", {}, "R²"), el("th", {}, "Pts"),
      ])),
      tbody,
    ]));
    wrap.appendChild(plCard);
  }

  // Per-scanner general stats
  if (model.scanner_stats && Object.keys(model.scanner_stats).length) {
    const ssCard = el("div", { class: "card" });
    ssCard.appendChild(el("div", { style: "font-weight:700;font-size:14px;margin-bottom:10px" }, "Scanner Coverage"));
    const tbody = el("tbody");
    for (const [src, st] of Object.entries(model.scanner_stats)) {
      tbody.appendChild(el("tr", {}, [
        el("td", { style: "font-size:11px;max-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" },
          st.name || src),
        el("td", { style: "font-family:monospace;font-size:11px" }, st.mean_rssi != null ? st.mean_rssi + " dBm" : "—"),
        el("td", { style: "font-family:monospace;font-size:11px" }, st.std_rssi != null ? "±" + st.std_rssi : "—"),
        el("td", { class: "muted", style: "font-size:11px" }, st.point_count),
      ]));
    }
    ssCard.appendChild(el("table", { class: "table" }, [
      el("thead", {}, el("tr", {}, [
        el("th", {}, "Scanner"), el("th", {}, "Mean RSSI"), el("th", {}, "Std"), el("th", {}, "Pts"),
      ])),
      tbody,
    ]));
    wrap.appendChild(ssCard);
  }

  // Calibration points list
  const ptsCard = el("div", { class: "card" });
  ptsCard.appendChild(el("div", { class: "row", style: "margin-bottom:10px" }, [
    el("div", { style: "font-weight:700;font-size:14px" }, "Calibration Points"),
    el("span", { class: "badge", style: "margin-left:8px" }, pts.length),
  ]));
  const ptsList = el("div", { style: "display:flex;flex-direction:column;gap:4px;max-height:320px;overflow-y:auto" });
  for (const pt of [...pts].reverse()) {
    const mapName = maps.find(m => m.id === pt.map_id)?.name || pt.map_id || "?";
    const sc = pt.scanner_readings?.length || 0;
    const rowWrap = el("div", {
      style: "display:flex;align-items:center;gap:8px;padding:6px 8px;background:#0a150e;border:1px solid #1b3526;border-radius:8px"
    });
    rowWrap.appendChild(el("div", { style: "flex:1;min-width:0" }, [
      el("div", { style: "font-size:12px;font-weight:600" }, pt.label || pt.room || "Unlabeled"),
      el("div", { style: "font-size:11px;color:#78909c" },
        `${mapName} · ${sc} scanner${sc !== 1 ? "s" : ""} · ${pt.collected_at?.slice(0, 10) || ""}`),
    ]));
    const delWrap = el("div");
    const makeDelBtn = () => {
      const b = el("button", { class: "btn tiny" }, "Delete");
      b.addEventListener("click", () => {
        delWrap.innerHTML = "";
        const yes = el("button", { class: "btn tiny", style: "background:#7f1d1d;border-color:#dc2626" }, "Yes");
        const no  = el("button", { class: "btn tiny" }, "No");
        yes.addEventListener("click", async () => {
          delWrap.innerHTML = "";
          try {
            await ctx.actions.calibrationDeletePoint(pt.id);
            ctx.state.calibration = await ctx.actions.calibrationGet();
            ctx.actions.renderRooms();
          } catch (e) {
            ctx.toast("Delete failed: " + String(e), true);
            delWrap.appendChild(makeDelBtn());
          }
        });
        no.addEventListener("click", () => { delWrap.innerHTML = ""; delWrap.appendChild(makeDelBtn()); });
        delWrap.appendChild(yes); delWrap.appendChild(no);
      });
      return b;
    };
    delWrap.appendChild(makeDelBtn());
    rowWrap.appendChild(delWrap);
    ptsList.appendChild(rowWrap);
  }
  ptsCard.appendChild(ptsList);
  wrap.appendChild(ptsCard);

  // Actions
  const actCard = el("div", { class: "card" });
  actCard.appendChild(el("div", { style: "font-weight:700;font-size:14px;margin-bottom:10px" }, "Actions"));

  // Export JSON
  const expBtn = el("button", { class: "btn inline" }, "Export JSON");
  expBtn.addEventListener("click", () => {
    const blob = new Blob([JSON.stringify(calData, null, 2)], { type: "application/json" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href = url; a.download = "padspan_calibration.json";
    document.body.appendChild(a); a.click();
    document.body.removeChild(a); URL.revokeObjectURL(url);
  });
  actCard.appendChild(expBtn);

  // Clear all
  const clearWrap = el("div", { style: "margin-top:10px;display:flex;gap:8px;align-items:center" });
  const makeClearBtn = () => {
    const b = el("button", { class: "btn inline", style: "border-color:#dc2626;color:#fca5a5" },
      `Clear All (${pts.length})`);
    b.addEventListener("click", () => {
      clearWrap.innerHTML = "";
      const yes = el("button", { class: "btn", style: "background:#7f1d1d;border-color:#dc2626" },
        `Yes, delete all ${pts.length} points`);
      const no  = el("button", { class: "btn inline" }, "Cancel");
      yes.addEventListener("click", async () => {
        clearWrap.innerHTML = "";
        try {
          await ctx.actions.calibrationClear();
          ctx.state.calibration = { points: [], model: {} };
          ctx.toast("All calibration data cleared.");
          ctx.actions.renderRooms();
        } catch (e) {
          ctx.toast("Failed: " + String(e), true);
          clearWrap.appendChild(makeClearBtn());
        }
      });
      no.addEventListener("click", () => { clearWrap.innerHTML = ""; clearWrap.appendChild(makeClearBtn()); });
      clearWrap.appendChild(yes); clearWrap.appendChild(no);
    });
    return b;
  };
  clearWrap.appendChild(makeClearBtn());
  actCard.appendChild(clearWrap);
  wrap.appendChild(actCard);

  return wrap;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

// ── Find all BLE advertisements for the given device ID ───────────────────────
// Returns { myAds, perRadio, targetAddr } where perRadio is {source→{name,rssi,age_s}}.
// Handles MAC addresses, entity_id values, canonical_id (private_ble), and iBeacon keys.
function _findBeaconAds(snap, deviceId) {
  if (!snap || !deviceId) return { myAds: [], perRadio: {}, targetAddr: "" };
  const rawId = String(deviceId).trim();
  const upperId = rawId.toUpperCase();
  const objects = snap?.objects?.list || [];

  // Resolve device — collect ALL addresses (handles rotating-MAC private_ble devices)
  let targetAddr = "";
  const targetAddrs = new Set();

  // Helper: extract all addresses from an object
  const _collectAddrs = (obj) => {
    if (obj.address) targetAddrs.add(obj.address.toUpperCase());
    for (const a of (obj.all_addresses || [])) { if (a) targetAddrs.add(String(a).toUpperCase()); }
  };

  if (upperId.match(/^[0-9A-F:]{17}$/)) {
    // Direct MAC address
    targetAddr = upperId;
    targetAddrs.add(upperId);
    const obj = objects.find(o =>
      (o.address || "").toUpperCase() === upperId ||
      (o.all_addresses || []).some(a => String(a).toUpperCase() === upperId)
    );
    if (obj) _collectAddrs(obj);
  } else {
    // Try multiple resolution strategies:
    // 1) entity_id match
    let obj = objects.find(o =>
      (o.entity_id || "") === rawId || (o.entity_id || "").toUpperCase() === upperId
    );
    // 2) canonical_id match (private_ble phones)
    if (!obj) obj = objects.find(o => (o.canonical_id || "") === rawId);
    // 3) key match (ibeacon:uuid:major:minor)
    if (!obj) obj = objects.find(o => (o.key || "") === rawId);
    // 4) address match (iBeacon address field = uuid key)
    if (!obj) obj = objects.find(o => (o.address || "") === rawId);

    if (obj) {
      targetAddr = (obj.address || "").toUpperCase();
      _collectAddrs(obj);
    }

    // 5) If entity_id selected but no BLE address found, try matching via linked_entities.
    //    Bermuda tracker entities don't have a BLE MAC themselves, but may reference
    //    the same HA device as a BLE object that does have advertisements.
    if (!targetAddrs.size && rawId.includes(".")) {
      for (const o of objects) {
        if ((o.linked_entities || []).includes(rawId)) {
          _collectAddrs(o);
          if (!targetAddr && o.address) targetAddr = o.address.toUpperCase();
          break;
        }
      }
    }
  }

  // Build source → display name from snap.ble.radios
  // Include both device name and area for full context
  const radioNameMap = {};
  for (const r of (snap?.ble?.radios || [])) {
    if (!r.source) continue;
    const devName = r.name || r.source;
    const area = r.area_name || r.area || "";
    radioNameMap[r.source] = area && area !== devName ? `${devName} · ${area}` : devName;
  }

  // For private_ble devices, also collect the canonical_id so we can match via _xref
  let targetCanonical = "";
  if (targetAddrs.size > 0) {
    const cObj = objects.find(o => o.kind === "private_ble" && (
      (o.canonical_id || "") === rawId ||
      targetAddrs.has((o.address || "").toUpperCase()) ||
      (o.all_addresses || []).some(a => targetAddrs.has(String(a).toUpperCase()))
    ));
    if (cObj && cObj.canonical_id) targetCanonical = cObj.canonical_id;
  }

  // Filter raw advertisements by ANY known address for this device.
  // For private_ble (rotating MAC), also match via _xref.canonical_id on the ad
  // to catch addresses that rotated AFTER the object was built.
  const myAds = (snap?.ble?.advertisements || []).filter(ad => {
    const adAddr = (ad.address || "").toUpperCase();
    if (targetAddrs.size > 0 && targetAddrs.has(adAddr)) return true;
    if (targetCanonical && ad._xref && ad._xref.canonical_id === targetCanonical) return true;
    if (!targetAddrs.size && !targetCanonical && adAddr === upperId) return true;
    return false;
  });

  // Build per-radio map — keep the FRESHEST reading per radio (lowest age_s),
  // falling back to strongest only when ages are equal/unknown. A stale cached
  // ad can be stronger than the live one and would otherwise mask it.
  const perRadio = {};
  for (const ad of myAds) {
    const src = String(ad.source || "");
    if (!src) continue;
    const cur = perRadio[src];
    const adAge = (typeof ad.age_s === "number") ? ad.age_s : Infinity;
    const curAge = cur && (typeof cur.age_s === "number") ? cur.age_s : Infinity;
    if (!cur || adAge < curAge || (adAge === curAge && (ad.rssi || -200) > (cur.rssi || -200))) {
      perRadio[src] = {
        name: radioNameMap[src] || src,
        rssi: ad.rssi,
        age_s: ad.age_s,
      };
    }
  }
  return { myAds, perRadio, targetAddr };
}

// ── Calibration sample quality gate (P0-11.1) ────────────────────────────────
// Collection loops poll the snapshot once per second, but a scanner that last
// heard the beacon minutes ago keeps serving the same cached advertisement —
// without a gate it contributes 15-60 identical stale samples per point.
const _CAL_MAX_AGE_S = 10;

// Decide whether info ({rssi, age_s}) is a NEW usable sample for radio `src`.
// lastMap tracks the previously accepted/seen {rssi, age_s} per radio.
// Rejects: non-numeric rssi; readings older than _CAL_MAX_AGE_S; and repeats
// of the same cached ad (rssi identical while age_s only grows between polls).
function _acceptCalSample(lastMap, src, info) {
  if (typeof info.rssi !== "number") return false;
  const age = (typeof info.age_s === "number") ? info.age_s : null;
  if (age != null && age > _CAL_MAX_AGE_S) return false;
  const prev = lastMap[src];
  lastMap[src] = { rssi: info.rssi, age_s: age };
  if (prev && prev.rssi === info.rssi &&
      age != null && prev.age_s != null && age >= prev.age_s) {
    // Same rssi and age did not reset since last tick → same cached ad.
    return false;
  }
  return true;
}

function _totalSamples(cs) {
  return Object.values(cs.readings || {}).reduce((t, r) => t + r.samples.length, 0);
}

/** Path-loss inputs for one scanner: its calibration fit + the site settings. */
function _plOpts(ctx, src){
  const fits = (ctx && ctx.state && ctx.state.model && ctx.state.model.path_loss) || {};
  return { fit: fits[src] || null, settings: (ctx && ctx.state && ctx.state.settings) || null };
}

function _rssiRow(el, name, rssi, samples, age_s, txPower, opts) {
  const pct = Math.max(0, Math.min(100, ((rssi ?? -100) + 100) / 60 * 100));
  const color = pct >= 66 ? "#52b788" : pct >= 33 ? "#f59e0b" : "#dc2626";
  // Distance comes from the shared path-loss model, so this screen and the
  // positioning engine agree. It used to hard-code n = 2.5 and rssi_1m = -59
  // while the engine used the configured values and, where calibration had
  // produced one, this scanner's own fitted pair — so tuning either moved
  // only half the system.
  const o = opts || {};
  const distStr = formatDistanceM(estimateDistanceM(rssi, o.fit, txPower, o.settings));
  // Age label
  let ageStr = null;
  if (age_s != null && isFinite(age_s)) {
    ageStr = age_s < 60 ? `${Math.round(age_s)}s ago` : `${Math.floor(age_s / 60)}m ago`;
  }
  return el("div", {
    style: "display:flex;align-items:center;gap:8px;padding:4px 0"
  }, [
    el("div", { style: "font-size:11px;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#94a3b8" }, name || "?"),
    ageStr
      ? el("div", { style: "font-size:10px;color:#78909c;width:40px;text-align:right;flex-shrink:0" }, ageStr)
      : null,
    el("div", { style: "width:80px;height:6px;background:#1b3526;border-radius:3px;overflow:hidden;flex-shrink:0" }, [
      el("div", { style: `width:${pct.toFixed(0)}%;height:100%;background:${color}` }),
    ]),
    el("div", { style: "font-family:monospace;font-size:11px;color:#e2e8f0;width:48px;text-align:right;flex-shrink:0" },
      rssi != null ? rssi + " dBm" : "—"),
    distStr
      ? el("div", { style: "font-size:10px;color:#78909c;width:38px;text-align:right;flex-shrink:0" }, distStr)
      : null,
    samples != null
      ? el("div", { style: "font-size:10px;color:#78909c;width:28px;text-align:right;flex-shrink:0" }, "×" + samples)
      : null,
  ].filter(Boolean));
}

function _computeCoverage(pts, gridN) {
  const grid = new Array(gridN * gridN).fill(0);
  for (const pt of pts) {
    const px = pt.x_frac * gridN;
    const py = pt.y_frac * gridN;
    for (let cy = 0; cy < gridN; cy++) {
      for (let cx = 0; cx < gridN; cx++) {
        const dist = Math.sqrt((cx + 0.5 - px) ** 2 + (cy + 0.5 - py) ** 2);
        const contrib = Math.exp(-(dist ** 2) / (2 * SIGMA_C ** 2));
        const idx = cy * gridN + cx;
        grid[idx] = Math.min(1, grid[idx] + contrib);
      }
    }
  }
  return grid;
}

function _nextTarget(grid, gridN) {
  let min = 2, bx = 0.5, by = 0.5;
  for (let cy = 0; cy < gridN; cy++) {
    for (let cx = 0; cx < gridN; cx++) {
      const v = grid[cy * gridN + cx];
      const edgePen = (cx === 0 || cx === gridN - 1 || cy === 0 || cy === gridN - 1) ? 0.05 : 0;
      if (v + edgePen < min) {
        min = v + edgePen;
        bx = (cx + 0.5) / gridN;
        by = (cy + 0.5) / gridN;
      }
    }
  }
  return { x_frac: bx, y_frac: by };
}

// ── Tune tab — 3D iso map with draggable receiver markers ──────────────────
function _tuneTab(ctx, el, cs, calData) {
  const wrap = el("div", { style: "display:flex;flex-direction:column;gap:10px" });
  const maps_list = (ctx.state.maps && ctx.state.maps.list) ? ctx.state.maps.list : [];

  if (!maps_list.length) {
    wrap.appendChild(el("div", { class: "card" }, [
      el("div", { style: "font-weight:700;font-size:14px;margin-bottom:6px;color:#52b788" }, "No Maps Uploaded"),
      el("div", { style: "font-size:12px;color:#94a3b8" },
        "Upload floor plan images in the Maps tab first, then return here to fine-tune receiver positions."),
    ]));
    return wrap;
  }

  // Explainer card
  wrap.appendChild(el("div", { class: "card", style: "border-color:#52b788" }, [
    el("div", { style: "font-weight:700;font-size:14px;margin-bottom:6px;color:#52b788" }, "Receiver Position Tuning"),
    el("div", { style: "font-size:12px;color:#94a3b8;line-height:1.5" },
      "Drag BLE scanner markers to match their real-world positions. The 3D view matches the Overview map. Saves go to the fabric."),
  ]));

  // ── Constants & state ─────────────────────────────────────────────────────
  const TILE = 220, CX = 380, CY = 590, W = 760, BASE_H = 940;
  const LAYER_PAL = ["#52b788","#f59e0b","#60a5fa","#e879f9","#fb923c","#34d399","#f87171","#a78bfa"];
  const _esc = s => String(s||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
  // roomColor may not exist in standalone calibration panel — provide fallback
  const roomColorFn = ctx.helpers.roomColor || (name => {
    let h = 0; const s = String(name || "");
    for (let i = 0; i < s.length; i++) { h = Math.imul(h ^ s.charCodeAt(i), 16777619); }
    return `hsl(${(h >>> 0) % 360} 70% 55%)`;
  });

  // Live radios from snapshot — used to filter stale receivers
  const _snap = (ctx.state.live && ctx.state.live.snapshot) || null;
  const _liveRadios = _snap?.ble?.radios || [];

  if (!ctx.state._calibTune) ctx.state._calibTune = {
    fg: ctx.state.settings?.overview_iso_floor_gap ?? 150,
    hg: ctx.state.settings?.overview_iso_horiz_gap ?? 0,
    focusIdx: 0,
    draftReceivers: {},   // mapId → [{id,label,x,y,room}]
    dirtyMaps: {},        // mapId → true
    selectedRx: null,     // {mapId, rxId}
    pendingPlace: null,   // {source, name, area_name} — awaiting dblclick on map
    _mapsStamp: null,     // tracks when maps data last changed
  };
  const ts = ctx.state._calibTune;

  // Build a stamp from maps data to detect external updates
  const mapsStamp = maps_list.map(m => `${m.id}:${m.updated||""}:${(m.receivers||[]).length}`).join("|");
  const hasDirty = Object.values(ts.dirtyMaps).some(Boolean);

  // Re-sync draft receivers when maps data changes externally (and no unsaved edits)
  // Keep ALL stored receivers — do not filter by live status (radios may not have reconnected yet)
  if (!Object.keys(ts.draftReceivers).length || (mapsStamp !== ts._mapsStamp && !hasDirty)) {
    for (const m of maps_list) {
      ts.draftReceivers[m.id] = (m.receivers || [])
        .map(r => ({
          id: r.id || r.source || ("rx_" + Math.random().toString(16).slice(2, 10)), label: r.label || "", x: Number(r.x || 0), y: Number(r.y || 0), room: r.room || "", source: r.source || ""
        }));
    }
    // Remove drafts for maps that no longer exist
    for (const id of Object.keys(ts.draftReceivers)) {
      if (!maps_list.find(m => m.id === id)) delete ts.draftReceivers[id];
    }
    ts._mapsStamp = mapsStamp;
  }

  let _fg = ts.fg, _hg = ts.hg;

  // ── Transforms ────────────────────────────────────────────────────────────
  const iso = (wx, wy, wz) => [CX + (wx - wy) * TILE * 0.866 + wz * _hg, CY + (wx + wy) * TILE * 0.5 - wz * _fg];
  const pt  = c => `${Math.round(c[0])},${Math.round(c[1])}`;
  const pts = cs => cs.map(pt).join(" ");

  // Inverse iso: screen → world at known z-level
  const invIso = (sx, sy, z) => {
    const ax = sx - CX - z * _hg;
    const ay = sy - CY + z * _fg;
    const A = TILE * 0.866, B = TILE * 0.5;
    const wx = (ax / A + ay / B) / 2;
    const wy = (ay / B - ax / A) / 2;
    return [wx, wy];
  };

  // Filter & sort maps
  const hiddenIds = ctx.state.maps._hiddenMapIds || new Set();
  const sorted = [...maps_list].filter(m => !hiddenIds.has(m.id)).sort((a, b) => (a.stack?.z_level || 0) - (b.stack?.z_level || 0));
  const byLevel = new Map();
  for (const m of sorted) { const z = m.stack?.z_level ?? 0; if (!byLevel.has(z)) byLevel.set(z, []); byLevel.get(z).push(m); }
  const sortedIsoLevels = [...byLevel.keys()].sort((a, b) => a - b);
  const levelColor = z => LAYER_PAL[sortedIsoLevels.indexOf(z) % LAYER_PAL.length];

  // Floor focus slider positions
  const _isoPos = [null];
  for (let i = 0; i < sortedIsoLevels.length; i++) {
    _isoPos.push(sortedIsoLevels[i]);
    if (i < sortedIsoLevels.length - 1) _isoPos.push([sortedIsoLevels[i], sortedIsoLevels[i + 1]]);
  }
  ts.focusIdx = Math.max(0, Math.min(ts.focusIdx, _isoPos.length - 1));
  const _getFocusZ = idx => _isoPos[Math.max(0, Math.min(idx, _isoPos.length - 1))];
  const _getFocusLbl = idx => {
    const pos = _getFocusZ(idx);
    if (pos === null) return "All floors";
    const fl = ctx.state.model?.floors || [];
    const zArr = Array.isArray(pos) ? pos : [pos];
    return zArr.map(z => { const f = fl.find(x => x.level === z); return f ? (f.name || `L${z}`) : `L${z}`; }).join(" + ");
  };

  // Per-map forward+inverse transforms (shared stack_transform.js module)
  const mapXforms = {};
  for (const m of sorted) {
    const stk = m.stack || {};
    const xf = mapXform(ctx.state.model, m);
    if (!xf) continue;     // unplaced, or no world frame: draw nothing
    mapXforms[m.id] = { z: stk.z_level || 0, mapPt: xf.mapPt, invMapPt: xf.invMapPt };
  }

  // ── Build SVG ───────────────────────────────────────────────────────────────
  const LEGEND_H = sortedIsoLevels.length * 30 + 24;
  const buildTuneSVG = (focusZ) => {
    const slabWZ = 18 / _fg;
    const maxIsoZ = sortedIsoLevels.length ? sortedIsoLevels[sortedIsoLevels.length - 1] : 0;
    const viewY = Math.min(0, CY - maxIsoZ * _fg - 50);
    const HTOTAL = BASE_H + LEGEND_H - viewY;
    let s = `<svg viewBox="0 ${viewY} ${W} ${HTOTAL}" xmlns="http://www.w3.org/2000/svg" width="100%" style="max-height:${HTOTAL}px;display:block;font-family:system-ui,sans-serif">`;
    s += `<rect x="0" y="${viewY}" width="${W}" height="${HTOTAL}" fill="#071008"/>`;

    // Floor patterns
    s += `<defs>`;
    sortedIsoLevels.forEach((z2, li) => {
      const c2 = levelColor(z2);
      if (li === 0) {
        s += `<pattern id="tpat_${li}" x="0" y="0" width="24" height="24" patternUnits="userSpaceOnUse">`;
        s += `<path d="M12,2 C16,2 19,6 19,11 C19,16 16,21 12,22 C8,21 5,16 5,11 C5,6 8,2 12,2 Z" fill="none" stroke="${c2}" stroke-width="0.7" opacity="0.14"/>`;
        s += `<path d="M12,2 C13.5,0 15.5,0.5 14.5,2.5 C13.5,1.5 12,2 12,2 Z" fill="${c2}" opacity="0.11"/>`;
        s += `<circle cx="12" cy="15" r="1.4" fill="${c2}" opacity="0.1"/>`;
        s += `</pattern>`;
      } else if (li === 2) {
        s += `<pattern id="tpat_${li}" x="0" y="0" width="12" height="12" patternUnits="userSpaceOnUse">`;
        s += `<line x1="0" y1="12" x2="12" y2="0" stroke="${c2}" stroke-width="0.6" opacity="0.18"/>`;
        s += `<line x1="0" y1="0" x2="12" y2="12" stroke="${c2}" stroke-width="0.6" opacity="0.18"/>`;
        s += `</pattern>`;
      } else if (li >= 3) {
        s += `<pattern id="tpat_${li}" x="0" y="0" width="16" height="13.86" patternUnits="userSpaceOnUse">`;
        s += `<circle cx="0" cy="0" r="1.5" fill="${c2}" opacity="0.14"/>`;
        s += `<circle cx="8" cy="6.93" r="1.5" fill="${c2}" opacity="0.14"/>`;
        s += `<circle cx="16" cy="0" r="1.5" fill="${c2}" opacity="0.14"/>`;
        s += `<circle cx="0" cy="13.86" r="1.5" fill="${c2}" opacity="0.14"/>`;
        s += `<circle cx="16" cy="13.86" r="1.5" fill="${c2}" opacity="0.14"/>`;
        s += `</pattern>`;
      }
    });
    s += `</defs>`;

    if (!sorted.length) {
      s += `<text x="${W / 2}" y="${BASE_H / 2}" text-anchor="middle" fill="#4a6052" font-size="13">All layers hidden</text>`;
      s += `</svg>`; return s;
    }

    // ── Pass 1: Floor slabs + room polygons (bottom to top) ──
    for (const [z, group] of [...byLevel.entries()].sort((a, b) => a[0] - b[0])) {
      const isFocused = focusZ === null || (Array.isArray(focusZ) ? focusZ.includes(z) : focusZ === z);
      const go = isFocused ? 1.0 : 0.1;
      const lyrColor = levelColor(z);
      const lidx = sortedIsoLevels.indexOf(z);

      // Bounding box for all maps at this level
      let x0 = Infinity, y0_ = Infinity, x1 = -Infinity, y1_ = -Infinity;
      for (const m of group) {
        const xf = mapXforms[m.id]; if (!xf) continue;
        for (const [cx, cy] of [[0, 0], [1, 0], [1, 1], [0, 1]]) {
          const [wx, wy] = xf.mapPt(cx, cy);
          x0 = Math.min(x0, wx); y0_ = Math.min(y0_, wy); x1 = Math.max(x1, wx); y1_ = Math.max(y1_, wy);
        }
      }
      if (!isFinite(x0)) { x0 = 0; y0_ = 0; x1 = 1; y1_ = 0.75; }

      const TL = iso(x0, y0_, z), TR = iso(x1, y0_, z), BR = iso(x1, y1_, z), BL = iso(x0, y1_, z);
      const TR_b = iso(x1, y0_, z - slabWZ), BR_b = iso(x1, y1_, z - slabWZ), BL_b = iso(x0, y1_, z - slabWZ);

      s += `<g opacity="${go}">`;
      s += `<polygon points="${pts([TR, BR, BR_b, TR_b])}" fill="#0d2318" fill-opacity="0.35" stroke="#253e2e" stroke-width="0.8"/>`;
      s += `<polygon points="${pts([BL, BR, BR_b, BL_b])}" fill="#0a1a12" fill-opacity="0.3" stroke="#253e2e" stroke-width="0.8"/>`;
      s += `<polygon points="${pts([TL, TR, BR, BL])}" fill="#0f2017" fill-opacity="0.06" stroke="${lyrColor}" stroke-width="1.5" stroke-dasharray="10,5" opacity="0.5"/>`;
      if (lidx !== 1) { s += `<polygon points="${pts([TL, TR, BR, BL])}" fill="url(#tpat_${lidx})" stroke="none"/>`; }

      // Room polygons + labels
      for (const m of group) {
        const xf = mapXforms[m.id]; if (!xf) continue;
        for (const [room, b] of Object.entries(m.room_bounds || {})) {
          if (!b || b.type !== "poly" || !Array.isArray(b.points) || b.points.length < 3) continue;
          const color = roomColorFn(room);
          const pp = b.points.map(p => { const [wx, wy] = xf.mapPt(p[0], p[1]); return pt(iso(wx, wy, z)); }).join(" ");
          s += `<polygon points="${pp}" fill="${color}" fill-opacity="0.2" stroke="${color}" stroke-width="1.5" opacity="0.9" pointer-events="none"/>`;
          const cx2 = b.points.reduce((a, p) => a + p[0], 0) / b.points.length;
          const cy2 = b.points.reduce((a, p) => a + p[1], 0) / b.points.length;
          const [lwx, lwy] = xf.mapPt(cx2, cy2);
          const [lix, liy] = iso(lwx, lwy, z);
          s += `<text x="${Math.round(lix)}" y="${Math.round(liy) + lidx * 2}" text-anchor="middle" dominant-baseline="middle" fill="${color}" font-size="7" pointer-events="none">${_esc(room)}</text>`;
        }
      }

      // Layer index dot
      s += `<circle cx="${Math.round(BL[0])}" cy="${Math.round(BL[1])}" r="15" fill="${lyrColor}" opacity="0.95"/>`;
      s += `<text x="${Math.round(BL[0])}" y="${Math.round(BL[1]) + 6}" text-anchor="middle" fill="#071008" font-size="14" font-weight="700">${lidx + 1}</text>`;
      s += `</g>`;
    }

    // ── Pass 2: Receiver markers ON TOP of all slabs (always interactive) ──
    for (const [z, group] of [...byLevel.entries()].sort((a, b) => a[0] - b[0])) {
      const isFocused = focusZ === null || (Array.isArray(focusZ) ? focusZ.includes(z) : focusZ === z);
      const go = isFocused ? 1.0 : 0.1;
      s += `<g opacity="${go}">`;
      for (const m of group) {
        const xf = mapXforms[m.id]; if (!xf) continue;
        const draft = ts.draftReceivers[m.id] || [];
        for (const r of draft) {
          const [wx, wy] = xf.mapPt(r.x || 0, r.y || 0);
          const [px, py] = iso(wx, wy, z);
          const isSel = ts.selectedRx && ts.selectedRx.mapId === m.id && ts.selectedRx.rxId === r.id;
          const rx = Math.round(px), ry = Math.round(py);
          const _full = r.label || r.id || "R";
          const lbl = _full.length > 20 ? _full.substring(0, 19) + "…" : _full;
          const tip = `${r.label || r.id || "Receiver"}${r.room ? " | Room: " + r.room : ""} | x: ${(r.x * 100).toFixed(1)}% y: ${(r.y * 100).toFixed(1)}%`;

          s += `<g data-rx-id="${_esc(r.id)}" data-map-id="${_esc(m.id)}" data-z="${z}" data-tip="${_esc(tip)}" style="cursor:grab">`;
          // Transparent hit area for easier clicking/dragging
          s += `<circle cx="${rx}" cy="${ry}" r="22" fill="transparent" stroke="none"/>`;
          // Selection highlight
          if (isSel) s += `<circle cx="${rx}" cy="${ry}" r="22" fill="none" stroke="#fbbf24" stroke-width="2" stroke-dasharray="4,3" opacity="0.9"/>`;
          // Outer pulse ring
          s += `<circle cx="${rx}" cy="${ry}" r="16" fill="none" stroke="#52b788" stroke-width="1.2" opacity="0.35"/>`;
          // Middle ring
          s += `<circle cx="${rx}" cy="${ry}" r="10" fill="none" stroke="#52b788" stroke-width="1.8" opacity="0.7"/>`;
          // Center dot
          s += `<circle cx="${rx}" cy="${ry}" r="5" fill="#52b788" opacity="0.95"/>`;
          // Label below
          const lblW = Math.min(lbl.length * 6 + 8, 132);
          s += `<rect x="${rx - lblW / 2}" y="${ry + 18}" width="${lblW}" height="13" rx="3" fill="#071008" opacity="0.8"/>`;
          s += `<text x="${rx}" y="${ry + 28}" text-anchor="middle" fill="#52b788" font-size="9" font-weight="600">${_esc(lbl)}</text>`;
          s += `</g>`;
        }
      }
      s += `</g>`;
    }

    // Legend
    s += `<line x1="10" y1="${BASE_H + 4}" x2="${W - 10}" y2="${BASE_H + 4}" stroke="#1b3526" stroke-width="0.8"/>`;
    sortedIsoLevels.forEach((z, i) => {
      const ly = BASE_H + 10 + i * 30;
      const color = levelColor(z);
      const groupLabel = byLevel.get(z).map(m => m.name || m.id).join(" + ");
      s += `<circle cx="18" cy="${ly + 11}" r="11" fill="${color}" opacity="0.9"/>`;
      s += `<text x="18" y="${ly + 15}" text-anchor="middle" fill="#071008" font-size="12" font-weight="700">${i + 1}</text>`;
      s += `<text x="36" y="${ly + 15}" fill="${color}" font-size="18" font-weight="500">${_esc(groupLabel)}</text>`;
    });

    s += `</svg>`;
    return s;
  };

  // ── DOM: SVG container ──────────────────────────────────────────────────────
  const isoWrap = document.createElement("div");
  isoWrap.style.cssText = "position:relative;margin-top:6px";

  const isoDiv = document.createElement("div");
  isoDiv.style.cssText = "overflow:auto;border-radius:8px;background:#071008;padding:8px;touch-action:none";
  isoDiv.innerHTML = buildTuneSVG(_getFocusZ(ts.focusIdx));

  // Hover tooltip
  const tipEl = document.createElement("div");
  tipEl.style.cssText = "position:absolute;top:8px;left:8px;background:rgba(7,16,8,0.92);" +
    "border:1px solid #2d6a4f;border-radius:8px;padding:6px 10px;font-size:11px;color:#a7f3d0;" +
    "pointer-events:none;white-space:pre-line;max-width:min(260px,calc(100vw - 40px));z-index:5;display:none;" +
    "font-family:ui-monospace,SFMono-Regular,Consolas,monospace;line-height:1.5";
  isoWrap.appendChild(isoDiv);
  isoWrap.appendChild(tipEl);

  isoDiv.addEventListener("mouseover", e => {
    const g = e.target.closest("[data-tip]");
    if (g) {
      tipEl.textContent = "";
      g.getAttribute("data-tip").split("|").forEach((line, i) => {
        if (i > 0) tipEl.appendChild(document.createElement("br"));
        tipEl.appendChild(document.createTextNode(line));
      });
      tipEl.style.display = "block";
    }
  });
  isoDiv.addEventListener("mouseout", e => {
    const g = e.target.closest("[data-tip]");
    if (!g || !isoDiv.contains(e.relatedTarget && e.relatedTarget.closest && e.relatedTarget.closest("[data-tip]")))
      tipEl.style.display = "none";
  });

  // ── Drag interaction ────────────────────────────────────────────────────────
  // Document-level listeners (always fire regardless of pointer location).
  // ts._dragging prevents the 5s poll from destroying the DOM mid-drag.
  // No setPointerCapture — document listeners are universally reliable.
  let _didDrag = false;

  isoDiv.addEventListener("pointerdown", e => {
    const g = e.target.closest("[data-rx-id]");
    if (!g) return;
    e.preventDefault();
    e.stopPropagation();
    const mapId = g.getAttribute("data-map-id");
    const rxId  = g.getAttribute("data-rx-id");
    const z     = Number(g.getAttribute("data-z") || 0);
    ts.selectedRx = { mapId, rxId };
    _didDrag = false;
    isoDiv.style.cursor = "grabbing";
    _refreshInfo();

    const draft = ts.draftReceivers[mapId];
    if (!draft) { ctx.toast("Cannot drag: map data not loaded. Try Reset.", true); isoDiv.style.cursor = ""; return; }
    // Match by id first, then fallback to source or label (handles legacy receivers)
    let rxObj = draft.find(r => r.id === rxId);
    if (!rxObj) rxObj = draft.find(r => (r.source || "") === rxId || (r.label || "") === rxId);
    if (!rxObj) { ctx.toast("Cannot drag: receiver data out of sync. Try Reset.", true); isoDiv.style.cursor = ""; return; }
    const xf = mapXforms[mapId];
    if (!xf) { console.warn("[PadSpan] drag: no xform for map", mapId); isoDiv.style.cursor = ""; return; }
    const [origWx, origWy] = xf.mapPt(rxObj.x, rxObj.y);
    const [origPx, origPy] = iso(origWx, origWy, z);

    ts._dragging = true;

    const onMove = (ev) => {
      ev.preventDefault();
      _didDrag = true;
      const svgNode = isoDiv.querySelector("svg");
      if (!svgNode) return;
      const ctm = svgNode.getScreenCTM();
      if (!ctm) return;
      const inv = ctm.inverse();
      const sx = ev.clientX * inv.a + ev.clientY * inv.c + inv.e;
      const sy = ev.clientX * inv.b + ev.clientY * inv.d + inv.f;
      const [wx, wy] = invIso(sx, sy, z);
      const [nx, ny] = xf.invMapPt(wx, wy);
      // No 0-1 clamp — allow cross-map dragging on the same floor
      rxObj.x = nx;
      rxObj.y = ny;
      ts.dirtyMaps[mapId] = true;
      const [newWx, newWy] = xf.mapPt(nx, ny);
      const [newPx, newPy] = iso(newWx, newWy, z);
      g.setAttribute("transform", `translate(${newPx - origPx},${newPy - origPy})`);
    };

    const onUp = (ev) => {
      document.removeEventListener("pointermove", onMove, true);
      document.removeEventListener("pointerup", onUp, true);
      document.removeEventListener("pointercancel", onUp, true);
      ts._dragging = false;
      isoDiv.style.cursor = "";
      if (_didDrag) {
        const mapObj = maps_list.find(m => m.id === mapId);
        if (mapObj) rxObj.room = _detectRoom(rxObj.x, rxObj.y, mapObj) || rxObj.room || "";
      }
      _refreshSVG();
      _refreshInfo();
      _refreshDirtyLabel();
    };

    document.addEventListener("pointermove", onMove, true);
    document.addEventListener("pointerup", onUp, true);
    document.addEventListener("pointercancel", onUp, true);
  });

  // Click to select (without drag)
  isoDiv.addEventListener("click", e => {
    // After a drag, skip the click so we don't rebuild SVG again
    if (_didDrag) { _didDrag = false; return; }
    const g = e.target.closest("[data-rx-id]");
    if (g) {
      ts.selectedRx = { mapId: g.getAttribute("data-map-id"), rxId: g.getAttribute("data-rx-id") };
      _refreshSVG();
      _refreshInfo();
    }
  });

  // Helper: commit placement of a pending radio onto a specific map at (nx, ny)
  function _placeRadioOnMap(m, nx, ny) {
    const rd = ts.pendingPlace;
    const newRx = {
      id: "rx_" + Date.now().toString(16),
      label: rd.name || rd.source || "",
      x: nx,
      y: ny,
      room: _detectRoom(nx, ny, m) || rd.area_name || "",
      source: rd.source || "",
    };
    if (!ts.draftReceivers[m.id]) ts.draftReceivers[m.id] = [];
    ts.draftReceivers[m.id].push(newRx);
    ts.dirtyMaps[m.id] = true;
    ts.selectedRx = { mapId: m.id, rxId: newRx.id };
    ts.pendingPlace = null;
    ts._confirming = false;
    _refreshSVG();
    _refreshInfo();
    _refreshDirtyLabel();
    _refreshRadiosList();
    _refreshPlaceBanner();
  }

  // Double-click to place a pending (unplaced) radio at the clicked location
  isoDiv.addEventListener("dblclick", e => {
    if (!ts.pendingPlace) return;
    const svgNode = isoDiv.querySelector("svg");
    if (!svgNode) return;

    const ctm = svgNode.getScreenCTM();
    if (!ctm) return;
    const inv = ctm.inverse();
    const sx = e.clientX * inv.a + e.clientY * inv.c + inv.e;
    const sy = e.clientX * inv.b + e.clientY * inv.d + inv.f;

    // Collect all candidate maps that contain the click point
    const candidates = [];
    for (let i = sortedIsoLevels.length - 1; i >= 0; i--) {
      const z = sortedIsoLevels[i];
      const [wx, wy] = invIso(sx, sy, z);
      const group = byLevel.get(z) || [];
      for (const m of group) {
        const xf = mapXforms[m.id];
        if (!xf) continue;
        const [nx, ny] = xf.invMapPt(wx, wy);
        if (nx >= 0 && nx <= 1 && ny >= 0 && ny <= 1) {
          candidates.push({ m, nx, ny, z });
        }
      }
    }

    if (candidates.length === 0) return;

    // Single match — place immediately
    if (candidates.length === 1) {
      _placeRadioOnMap(candidates[0].m, candidates[0].nx, candidates[0].ny);
      return;
    }

    // Multiple overlapping maps — show disambiguation popup
    ts._confirming = true;
    const popup = document.createElement("div");
    popup.style.cssText = "position:absolute;z-index:10;background:#0d1f14;border:2px solid #52b788;border-radius:10px;padding:10px 14px;min-width:180px;box-shadow:0 4px 20px rgba(0,0,0,0.5)";
    // Position near the click
    const rect = isoDiv.getBoundingClientRect();
    popup.style.left = Math.min(e.clientX - rect.left + 8, rect.width - 200) + "px";
    popup.style.top = Math.min(e.clientY - rect.top + 8, rect.height - 100) + "px";

    const title = document.createElement("div");
    title.style.cssText = "font-size:12px;font-weight:700;color:#52b788;margin-bottom:8px";
    title.textContent = "Place on which map?";
    popup.appendChild(title);

    // Group candidates by floor for floor-level shortcuts
    const fl = ctx.state.model?.floors || [];
    const candByFloor = new Map(); // z → [candidate, ...]
    for (const c of candidates) {
      if (!candByFloor.has(c.z)) candByFloor.set(c.z, []);
      candByFloor.get(c.z).push(c);
    }

    // Floor shortcuts at top (only if multiple floors or floor has multiple maps)
    const floorZs = [...candByFloor.keys()].sort((a, b) => a - b);
    if (floorZs.length > 1 || (floorZs.length === 1 && candByFloor.get(floorZs[0]).length > 1)) {
      for (const z of floorZs) {
        const floorObj = fl.find(f => f.level === z);
        const floorName = floorObj ? (floorObj.name || `Floor ${z}`) : `Floor ${z}`;
        const floorCands = candByFloor.get(z);
        const btn = document.createElement("button");
        btn.className = "btn inline";
        btn.style.cssText = "display:block;width:100%;text-align:left;padding:6px 10px;margin-bottom:4px;font-size:12px;color:#fbbf24;border-color:#92400e;cursor:pointer;font-weight:600";
        btn.textContent = `${floorName}`;
        btn.addEventListener("click", () => {
          if (isoWrap.contains(popup)) isoWrap.removeChild(popup);
          // Pick the map on this floor with the most receivers (most activity)
          const best = floorCands.slice().sort((a, b) => {
            const ra = (ts.draftReceivers[a.m.id] || []).length + Object.keys(a.m.room_bounds || {}).length;
            const rb = (ts.draftReceivers[b.m.id] || []).length + Object.keys(b.m.room_bounds || {}).length;
            return rb - ra;
          })[0];
          _placeRadioOnMap(best.m, best.nx, best.ny);
        });
        popup.appendChild(btn);
      }
      // Separator
      const sep = document.createElement("div");
      sep.style.cssText = "border-top:1px solid #2d6a4f;margin:6px 0;opacity:0.5";
      popup.appendChild(sep);
      const subTitle = document.createElement("div");
      subTitle.style.cssText = "font-size:10px;color:#94a3b8;margin-bottom:4px";
      subTitle.textContent = "Or pick a specific map:";
      popup.appendChild(subTitle);
    }

    for (const c of candidates) {
      const floorObj = fl.find(f => f.level === c.z);
      const floorName = floorObj ? (floorObj.name || `L${c.z}`) : `L${c.z}`;
      const btn = document.createElement("button");
      btn.className = "btn inline";
      btn.style.cssText = "display:block;width:100%;text-align:left;padding:6px 10px;margin-bottom:4px;font-size:12px;color:#a7f3d0;border-color:#2d6a4f;cursor:pointer";
      btn.textContent = `${c.m.name || c.m.id} (${floorName})`;
      btn.addEventListener("click", () => {
        if (isoWrap.contains(popup)) isoWrap.removeChild(popup);
        _placeRadioOnMap(c.m, c.nx, c.ny);
      });
      popup.appendChild(btn);
    }

    const cancelBtn = document.createElement("button");
    cancelBtn.className = "btn inline";
    cancelBtn.style.cssText = "display:block;width:100%;text-align:center;padding:4px 10px;font-size:11px;color:#94a3b8;border-color:#94a3b840;margin-top:4px;cursor:pointer";
    cancelBtn.textContent = "Cancel";
    cancelBtn.addEventListener("click", () => {
      ts._confirming = false;
      if (isoWrap.contains(popup)) isoWrap.removeChild(popup);
    });
    popup.appendChild(cancelBtn);

    isoWrap.appendChild(popup);
  });

  // ── Helper: rebuild SVG without losing scroll ─────────────────────────────
  function _refreshSVG() {
    if (ts._dragging) return; // Don't rebuild SVG mid-drag
    const scrollTop = isoDiv.scrollTop, scrollLeft = isoDiv.scrollLeft;
    isoDiv.innerHTML = buildTuneSVG(_getFocusZ(ts.focusIdx));
    isoDiv.scrollTop = scrollTop;
    isoDiv.scrollLeft = scrollLeft;
  }

  // ── Controls row ──────────────────────────────────────────────────────────
  const ctrlRow = document.createElement("div");
  ctrlRow.style.cssText = "display:flex;align-items:center;gap:10px;flex-wrap:wrap";

  // Floor focus
  const focusLbl = document.createElement("span");
  focusLbl.style.cssText = "font-size:12px;color:#94a3b8;min-width:80px;display:inline-block";
  focusLbl.textContent = _getFocusLbl(ts.focusIdx);
  const focusSlider = document.createElement("input");
  focusSlider.type = "range"; focusSlider.min = "0"; focusSlider.max = String(_isoPos.length - 1);
  focusSlider.style.cssText = "width:130px;accent-color:#52b788;vertical-align:middle;cursor:pointer";
  focusSlider.value = String(ts.focusIdx);
  focusSlider.addEventListener("input", () => {
    ts.focusIdx = parseInt(focusSlider.value, 10);
    focusLbl.textContent = _getFocusLbl(ts.focusIdx);
    _refreshSVG();
  });

  const floorLbl = document.createElement("span");
  floorLbl.style.cssText = "font-size:12px;color:#94a3b8";
  floorLbl.textContent = "Floor:";
  ctrlRow.appendChild(floorLbl);
  ctrlRow.appendChild(focusSlider);
  ctrlRow.appendChild(focusLbl);

  // Spacing slider
  const gapLbl = document.createElement("span");
  gapLbl.style.cssText = "font-size:12px;color:#94a3b8;min-width:36px;display:inline-block;text-align:right";
  gapLbl.textContent = String(ts.fg);
  const gapSlider = document.createElement("input");
  gapSlider.type = "range"; gapSlider.min = "60"; gapSlider.max = "340"; gapSlider.step = "10";
  gapSlider.style.cssText = "width:110px;accent-color:#52b788;vertical-align:middle;cursor:pointer";
  gapSlider.value = String(ts.fg);
  gapSlider.addEventListener("input", () => {
    ts.fg = parseInt(gapSlider.value, 10);
    _fg = ts.fg;
    gapLbl.textContent = String(ts.fg);
    _refreshSVG();
  });
  const spacingLbl = document.createElement("span");
  spacingLbl.style.cssText = "font-size:12px;color:#94a3b8;margin-left:8px";
  spacingLbl.textContent = "Spacing:";
  ctrlRow.appendChild(spacingLbl);
  ctrlRow.appendChild(gapSlider);
  ctrlRow.appendChild(gapLbl);

  // L/R slider
  const hgLbl = document.createElement("span");
  hgLbl.style.cssText = "font-size:12px;color:#94a3b8;min-width:36px;display:inline-block;text-align:right";
  hgLbl.textContent = String(ts.hg);
  const hgSlider = document.createElement("input");
  hgSlider.type = "range"; hgSlider.min = "-120"; hgSlider.max = "120"; hgSlider.step = "10";
  hgSlider.style.cssText = "width:110px;accent-color:#52b788;vertical-align:middle;cursor:pointer";
  hgSlider.value = String(ts.hg);
  hgSlider.addEventListener("input", () => {
    ts.hg = parseInt(hgSlider.value, 10);
    _hg = ts.hg;
    hgLbl.textContent = String(ts.hg);
    _refreshSVG();
  });
  const lrLbl = document.createElement("span");
  lrLbl.style.cssText = "font-size:12px;color:#94a3b8;margin-left:8px";
  lrLbl.textContent = "L/R:";
  ctrlRow.appendChild(lrLbl);
  ctrlRow.appendChild(hgSlider);
  ctrlRow.appendChild(hgLbl);

  // Save button
  const statusLbl = document.createElement("span");
  statusLbl.style.cssText = "font-size:11px;color:#94a3b8;min-width:90px";
  const saveBtn = document.createElement("button");
  saveBtn.className = "btn inline" + (hasDirty ? " save-pulse" : "");
  saveBtn.style.cssText = "padding:2px 10px;font-size:12px";
  saveBtn.textContent = hasDirty ? "\ud83d\udcbe Save" : "Save";
  saveBtn.title = "Save updated receiver positions to all modified maps";
  saveBtn.addEventListener("click", async () => {
    const dirtyIds = Object.keys(ts.dirtyMaps).filter(id => ts.dirtyMaps[id]);
    if (!dirtyIds.length) { statusLbl.textContent = "No changes"; setTimeout(() => { statusLbl.textContent = ""; }, 2000); return; }
    saveBtn.disabled = true;
    statusLbl.textContent = "Saving...";
    try {
      // Save to fabric (metre-space authority), then sync fracs back to maps
      for (const mapId of dirtyIds) {
        const origMap = maps_list.find(m => m.id === mapId);
        if (!origMap) continue;
      }
      // Clear dirty state BEFORE refresh so re-rendered view shows clean state
      ts.dirtyMaps = {};
      ts.selectedRx = null;
      ctx.toast("Receiver positions saved");
      // mapsRefresh refreshes data + triggers re-render (which updates dirty label & stamp)
      await ctx.actions.mapsRefresh();
    } catch (e) {
      ctx.toast("Save failed: " + String(e), true);
      statusLbl.textContent = "Error saving";
      saveBtn.disabled = false;
    }
  });

  // Reset button
  const resetBtn = document.createElement("button");
  resetBtn.className = "btn inline";
  resetBtn.style.cssText = "padding:2px 10px;font-size:12px";
  resetBtn.textContent = "Reset";
  resetBtn.title = "Discard unsaved changes and reload receiver positions";
  resetBtn.addEventListener("click", () => {
    ts.draftReceivers = {};
    for (const m of maps_list) {
      ts.draftReceivers[m.id] = (m.receivers || [])
        .map(r => ({
          id: r.id || r.source || ("rx_" + Math.random().toString(16).slice(2, 10)), label: r.label || "", x: Number(r.x || 0), y: Number(r.y || 0), room: r.room || "", source: r.source || ""
        }));
    }
    ts.dirtyMaps = {};
    ts.selectedRx = null;
    ts.pendingPlace = null;
    ts.fg = ctx.state.settings?.overview_iso_floor_gap ?? 150;
    ts.hg = ctx.state.settings?.overview_iso_horiz_gap ?? 0;
    ts.focusIdx = 0;
    _fg = ts.fg; _hg = ts.hg;
    gapSlider.value = String(ts.fg); gapLbl.textContent = String(ts.fg);
    hgSlider.value = String(ts.hg); hgLbl.textContent = String(ts.hg);
    focusSlider.value = "0"; focusLbl.textContent = "All floors";
    statusLbl.textContent = "Reset \u2713";
    setTimeout(() => { statusLbl.textContent = ""; }, 2000);
    _refreshSVG();
    _refreshInfo();
    _refreshDirtyLabel();
    _refreshRadiosList();
    _refreshPlaceBanner();
  });

  ctrlRow.appendChild(saveBtn);
  ctrlRow.appendChild(resetBtn);
  ctrlRow.appendChild(statusLbl);

  // Dirty indicator
  const dirtyLbl = document.createElement("span");
  dirtyLbl.style.cssText = "font-size:11px;color:#f59e0b;font-weight:600;margin-left:auto";
  function _refreshDirtyLabel() {
    const n = Object.keys(ts.dirtyMaps).filter(id => ts.dirtyMaps[id]).length;
    dirtyLbl.textContent = n ? `${n} map${n > 1 ? "s" : ""} unsaved` : "";
    if (n) { saveBtn.classList.add("save-pulse"); saveBtn.textContent = "\ud83d\udcbe Save"; }
    else { saveBtn.classList.remove("save-pulse"); saveBtn.textContent = "Save"; }
  }
  _refreshDirtyLabel();
  ctrlRow.appendChild(dirtyLbl);

  // ── Selected receiver info panel ──────────────────────────────────────────
  const infoCard = document.createElement("div");
  infoCard.style.cssText = "background:#0d1f14;border:1px solid #1b3526;border-radius:8px;padding:10px 14px;font-size:12px;color:#a7f3d0;min-height:24px";
  function _refreshInfo() {
    if (!ts.selectedRx) {
      infoCard.textContent = "Click a receiver marker to select it, then drag to reposition.";
      return;
    }
    const draft = ts.draftReceivers[ts.selectedRx.mapId] || [];
    const rx = draft.find(r => r.id === ts.selectedRx.rxId);
    if (!rx) { infoCard.textContent = "Receiver not found."; return; }
    const mapObj = maps_list.find(m => m.id === ts.selectedRx.mapId);
    infoCard.innerHTML = "";
    // Show floor + metres from fabric when available
    const _floorName = (() => {
      const fid = mapObj?.floor_id || "main";
      const fObj = (ctx.state.model?.floors || []).find(f => f.id === fid);
      return fObj ? fObj.name : fid;
    })();
    const _fabPos = (ctx.state.model?.scanner_positions_m || {})[rx.source];
    const _posStr = _fabPos ? `${_fabPos.x_m?.toFixed(1)}m, ${_fabPos.y_m?.toFixed(1)}m` : `${(rx.x * 100).toFixed(1)}%, ${(rx.y * 100).toFixed(1)}%`;
    const lines = [
      `<b style="color:#52b788">${_esc(rx.label || rx.id)}</b>`,
      `Floor: ${_esc(_floorName)}`,
      `Room: ${_esc(rx.room || "\u2014")}`,
      `Position: ${_posStr}`,
    ];
    const infoLine = document.createElement("div");
    infoLine.innerHTML = lines.join(" &nbsp;·&nbsp; ");
    infoCard.appendChild(infoLine);
    // Height (z) input — only once the scanner exists in the fabric
    if (_fabPos) {
      const zRow = document.createElement("div");
      zRow.style.cssText = "display:flex;gap:6px;align-items:center;margin-top:6px";
      const zLbl = document.createElement("span");
      zLbl.style.cssText = "font-size:11px;color:#94a3b8";
      zLbl.textContent = "Height above floor (m):";
      const zInp = document.createElement("input");
      zInp.type = "number"; zInp.min = "0"; zInp.max = "100"; zInp.step = "0.1";
      zInp.value = String(_fabPos.z_m != null ? _fabPos.z_m : 2.4);
      zInp.style.cssText = "width:64px;background:#0a150e;border:1px solid #1b3526;color:#e2e8f0;padding:2px 6px;border-radius:4px;font-size:12px";
      const zBtn = document.createElement("button");
      zBtn.className = "btn inline";
      zBtn.style.cssText = "font-size:10px;padding:2px 10px";
      zBtn.textContent = "Save Z";
      zBtn.title = "Mounting height above this scanner's own floor. Used for 3D distance; survives map syncs.";
      zBtn.addEventListener("click", async () => {
        const v = parseFloat(zInp.value);
        if (!isFinite(v) || v < 0 || v > 100) { ctx.toast("Height must be 0–100 m", true); return; }
        try {
          await ctx.actions.callWS({ type: "padspan_ha/fabric_scanner_z_set", source: rx.source, z_m: v });
          ctx.toast(`${rx.label || rx.source}: height set to ${v} m`);
          ctx.actions.modelRefresh && ctx.actions.modelRefresh();
        } catch (e) { ctx.toast("Save failed: " + String(e), true); }
      });
      zRow.appendChild(zLbl); zRow.appendChild(zInp); zRow.appendChild(zBtn);
      infoCard.appendChild(zRow);
    }
    // "Remove from this map" button — removes from current map only
    const _selMapId = ts.selectedRx.mapId;
    const _selRxId = ts.selectedRx.rxId;
    const removeBtn = document.createElement("button");
    removeBtn.className = "btn inline";
    removeBtn.style.cssText = "font-size:10px;padding:2px 10px;color:#f87171;border-color:#f8717140;margin-top:6px";
    removeBtn.textContent = "Remove from floor";
    removeBtn.title = "Remove this receiver from " + _floorName;
    removeBtn.addEventListener("click", async () => {
      const d = ts.draftReceivers[_selMapId] || [];
      const _removed = d.find(r => r.id === _selRxId);
      ts.draftReceivers[_selMapId] = d.filter(r => r.id !== _selRxId);
      ts.dirtyMaps[_selMapId] = true;
      ts.selectedRx = null;
      // Save immediately
      const origMap = maps_list.find(m => m.id === _selMapId);
      if (origMap) {
        try {
          // Drop it from the fabric FIRST. A batch save only writes the
          // entries it carries — it never deletes — and the re-derive that
          // follows re-injects any fabric scanner claiming this map, so
          // saving the shortened draft alone would put it straight back.
          const _rmSrc = (_removed && (_removed.source || _removed.id)) || "";
          if (_rmSrc) {
            await ctx.actions.callWS({ type: "padspan_ha/fabric_scanner_remove", source: _rmSrc });
          }
          ts.dirtyMaps = {};
          ts._mapsStamp = null;
          ctx.toast("Receiver removed");
          await ctx.actions.mapsRefresh();
        } catch (e) {
          ctx.toast("Remove failed: " + String(e), true);
        }
      }
    });
    infoCard.appendChild(removeBtn);
  }
  _refreshInfo();

  // ── Placement banner — shows when an unplaced radio is awaiting dblclick ─
  const placeBanner = document.createElement("div");
  placeBanner.style.cssText = "display:none;background:#1a2e0e;border:2px solid #52b788;border-radius:8px;padding:8px 14px;font-size:12px;color:#a7f3d0;text-align:center";
  function _refreshPlaceBanner() {
    if (ts.pendingPlace) {
      const nm = ts.pendingPlace.name || ts.pendingPlace.source || "radio";
      placeBanner.innerHTML = `<b style="color:#52b788">Double-click</b> on the 3D map to place <b style="color:#fbbf24">${_esc(nm)}</b> &nbsp; <span style="color:#94a3b8;cursor:pointer;text-decoration:underline" id="_cancelPlace">Cancel</span>`;
      placeBanner.style.display = "block";
      const cancelEl = placeBanner.querySelector("#_cancelPlace");
      if (cancelEl) cancelEl.addEventListener("click", () => {
        ts.pendingPlace = null;
        _refreshPlaceBanner();
        _refreshRadiosList();
      });
    } else {
      placeBanner.style.display = "none";
    }
  }
  _refreshPlaceBanner();

  // ── Live radios list (placed + unplaced) ────────────────────────────────
  const radiosCard = document.createElement("div");
  radiosCard.className = "card";
  function _refreshRadiosList() {
    radiosCard.innerHTML = "";

    // Header
    const hdr = document.createElement("div");
    hdr.style.cssText = "font-weight:700;font-size:13px;margin-bottom:8px;color:#52b788";
    hdr.textContent = `Live Radios (${_liveRadios.length})`;
    radiosCard.appendChild(hdr);

    if (!_liveRadios.length) {
      const msg = document.createElement("div");
      msg.style.cssText = "font-size:12px;color:#94a3b8";
      msg.textContent = "No live radios detected. Switch to Live mode and ensure Bluetooth scanners are active.";
      radiosCard.appendChild(msg);
      return;
    }

    const hint = document.createElement("div");
    hint.style.cssText = "font-size:11px;color:#94a3b8;margin-bottom:8px";
    hint.textContent = "Click an unplaced radio, then double-click on the 3D map to place it. Click a placed radio to select it in the 3D view.";
    radiosCard.appendChild(hint);

    // Build lookup: which map(s) each radio is placed on
    // Use source as the primary key; fall back to label only for legacy receivers
    const radioPlacement = {}; // source|label → [{mapId, mapName, rxId}]
    for (const [mapId, recs] of Object.entries(ts.draftReceivers)) {
      const mapObj = maps_list.find(m => m.id === mapId);
      const mapName = mapObj?.name || mapId;
      for (const r of recs) {
        const key = r.source || r.label || "";
        if (!key) continue;
        if (!radioPlacement[key]) radioPlacement[key] = [];
        if (!radioPlacement[key].some(p => p.mapId === mapId && p.rxId === r.id)) {
          radioPlacement[key].push({ mapId, mapName, rxId: r.id });
        }
      }
    }

    for (const rd of _liveRadios) {
      const src = rd.source || "";
      const nm = rd.name || "";
      const placements = radioPlacement[src] || radioPlacement[nm] || [];
      const isPlaced = placements.length > 0;

      const row = document.createElement("div");
      row.style.cssText = "display:flex;align-items:center;gap:8px;padding:6px 8px;border-radius:6px;cursor:pointer;transition:background 0.15s";
      row.addEventListener("mouseenter", () => { row.style.background = "#0d2818"; });
      row.addEventListener("mouseleave", () => { row.style.background = ""; });

      // Status icon
      const icon = document.createElement("div");
      if (isPlaced) {
        icon.style.cssText = "width:14px;height:14px;border-radius:50%;background:#52b788;flex-shrink:0;display:flex;align-items:center;justify-content:center";
        const check = document.createElement("span");
        check.style.cssText = "font-size:10px;color:#071008;font-weight:700";
        check.textContent = "\u2713";
        icon.appendChild(check);
      } else {
        icon.style.cssText = "width:14px;height:14px;border-radius:50%;border:2px solid #94a3b8;background:transparent;flex-shrink:0";
      }
      row.appendChild(icon);

      // Name + area
      const lbl = document.createElement("span");
      lbl.style.cssText = `flex:1;font-size:12px;color:${isPlaced ? "#d1d5db" : "#e2e8f0;font-weight:600"}`;
      const area = rd.area_name ? ` (${rd.area_name})` : "";
      lbl.textContent = `${nm || src || "Unknown"}${area}`;
      row.appendChild(lbl);

      if (isPlaced) {
        // Show which map it's on
        const mapTag = document.createElement("span");
        mapTag.style.cssText = "font-size:10px;color:#52b788;background:#52b78818;padding:1px 6px;border-radius:4px;white-space:nowrap";
        mapTag.textContent = placements.map(p => p.mapName).join(", ");
        row.appendChild(mapTag);
        // Click to select in 3D view
        row.addEventListener("click", () => {
          const p = placements[0];
          ts.selectedRx = { mapId: p.mapId, rxId: p.rxId };
          _refreshSVG();
          _refreshInfo();
        });
      } else {
        // Highlight if this radio is the pending placement target
        const isPending = ts.pendingPlace && (ts.pendingPlace.source === src || ts.pendingPlace.name === nm);
        if (isPending) {
          row.style.background = "#1a2e0e";
          row.style.border = "1px solid #52b788";
        }

        const placeTag = document.createElement("span");
        placeTag.style.cssText = `font-size:10px;padding:1px 6px;border-radius:4px;white-space:nowrap;${isPending ? "color:#fbbf24;background:#fbbf2418;font-weight:600" : "color:#94a3b8;background:#94a3b818"}`;
        placeTag.textContent = isPending ? "Double-click map…" : "Not placed";
        row.appendChild(placeTag);

        // Click row to enter pending-placement mode (select this radio, then dblclick map)
        row.addEventListener("click", () => {
          ts.pendingPlace = { source: src, name: nm, area_name: rd.area_name || "" };
          _refreshRadiosList();
          _refreshPlaceBanner();
        });
      }

      // ── Action buttons wrap ──
      const actWrap = document.createElement("span");
      actWrap.style.cssText = "display:inline-flex;gap:4px;align-items:center;margin-left:4px;flex-shrink:0";

      // Delete button — removes placement + all data, radio re-appears as unplaced
      const makeDeleteBtn = () => {
        const db = document.createElement("button");
        db.className = "btn inline";
        db.style.cssText = "font-size:10px;padding:2px 8px;color:#f87171;border-color:#f8717140";
        db.textContent = "Delete";
        db.title = "Remove this radio from all maps and clear all its stored data";
        db.addEventListener("click", (ev) => {
          ev.stopPropagation();
          // Block 5s poll from destroying the confirmation dialog
          ts._confirming = true;
          actWrap.innerHTML = "";
          const prompt = document.createElement("span");
          prompt.style.cssText = "font-size:10px;color:#fca5a5";
          prompt.textContent = "Delete all data? ";
          const yesBtn = document.createElement("button");
          yesBtn.className = "btn inline";
          yesBtn.style.cssText = "font-size:10px;padding:2px 8px;background:#7f1d1d;border-color:#dc2626;color:#fca5a5";
          yesBtn.textContent = "Yes";
          const noBtn = document.createElement("button");
          noBtn.className = "btn inline";
          noBtn.style.cssText = "font-size:10px;padding:2px 8px;color:#94a3b8;border-color:#94a3b840";
          noBtn.textContent = "No";
          yesBtn.addEventListener("click", async (ev2) => {
            ev2.stopPropagation();
            ts._confirming = false;
            actWrap.innerHTML = "";
            const spin = document.createElement("span");
            spin.style.cssText = "font-size:10px;color:#94a3b8";
            spin.textContent = "Deleting…";
            actWrap.appendChild(spin);
            try {
              // 1. Remove from local drafts (match by source — the stable key)
              let removedMaps = [];
              for (const [mapId, recs] of Object.entries(ts.draftReceivers)) {
                const before = recs.length;
                ts.draftReceivers[mapId] = recs.filter(r =>
                  !src || (r.source || "") !== src
                );
                if (ts.draftReceivers[mapId].length < before) {
                  ts.dirtyMaps[mapId] = true;
                  removedMaps.push(mapId);
                }
              }
              // 2. Save cleaned maps immediately so removal persists
              for (const mapId of removedMaps) {
                const origMap = maps_list.find(m => m.id === mapId);
                if (!origMap) continue;
              }
              // 3. Update state BEFORE any re-render so rebuilt UI is correct
              ts.dirtyMaps = {};
              ts._mapsStamp = null;
              ts.selectedRx = null;
              ts.pendingPlace = null;
              // 4. Call radioResetQuiet — WS only, no re-render
              const res = await ctx.actions.radioResetQuiet(src);
              const sm = res?.summary || {};
              const parts = [];
              if (removedMaps.length) parts.push(`${removedMaps.length} map(s)`);
              if (sm.calibration?.readings_removed) parts.push(`${sm.calibration.readings_removed} cal reading(s)`);
              if (sm.adaptive?.room_pairs_removed) parts.push(`${sm.adaptive.room_pairs_removed} fingerprint(s)`);
              const detail = parts.length ? " — removed " + parts.join(", ") : "";
              ctx.toast(`Radio deleted${detail}`);
              // 5. Refresh maps data + re-render once (rebuilds entire Tune tab cleanly)
              await ctx.actions.mapsRefresh();
            } catch (e) {
              ts._confirming = false;
              ctx.toast("Delete failed: " + String(e), true);
              _refreshRadiosList();
            }
          });
          noBtn.addEventListener("click", (ev2) => {
            ev2.stopPropagation();
            ts._confirming = false;
            _refreshRadiosList();
          });
          actWrap.appendChild(prompt);
          actWrap.appendChild(yesBtn);
          actWrap.appendChild(noBtn);
        });
        return db;
      };
      actWrap.appendChild(makeDeleteBtn());
      row.appendChild(actWrap);

      radiosCard.appendChild(row);
    }
  }
  _refreshRadiosList();

  // ── Assemble ──────────────────────────────────────────────────────────────
  wrap.appendChild(ctrlRow);
  wrap.appendChild(isoWrap);
  wrap.appendChild(placeBanner);
  wrap.appendChild(infoCard);
  wrap.appendChild(radiosCard);

  return wrap;
}

function _showPosHelp(ctx) {
  const body = document.createElement("div");
  body.style.cssText = "font-size:13px;line-height:1.7;color:#d1d5db;max-width:520px";
  body.innerHTML = `
    <p style="margin:0 0 12px"><b style="color:#5eead4">Position Percentages (x%, y%)</b></p>
    <p style="margin:0 0 10px">
      The two percentages represent this beacon's location on the floor plan image
      as a fraction of the image's width and height:
    </p>
    <ul style="margin:0 0 12px;padding-left:20px">
      <li><b style="color:#a7f3d0">x %</b> &mdash; how far across the image from the <b>left edge</b>.
        0% is the left edge, 100% is the right edge.</li>
      <li><b style="color:#a7f3d0">y %</b> &mdash; how far down the image from the <b>top edge</b>.
        0% is the top edge, 100% is the bottom edge.</li>
    </ul>
    <p style="margin:0 0 10px">
      For example, <span style="color:#5eead4">x 50.0%, y 25.0%</span> means the beacon is
      centered horizontally and one-quarter of the way down from the top of the map image.
    </p>
    <p style="margin:0 0 12px;border-top:1px solid #1b3526;padding-top:10px">
      <b style="color:#f59e0b">Why this matters:</b>
    </p>
    <ul style="margin:0 0 12px;padding-left:20px">
      <li><b>Calibration reference</b> &mdash; PadSpan records which Bluetooth scanners can see this
        beacon at this position, and how strong the signal is. Over time, this builds a
        <em>radio fingerprint database</em> that maps signal strengths to physical locations.</li>
      <li><b>k-NN positioning</b> &mdash; When PadSpan sees a device with similar signal readings
        to a known calibration point, it estimates the device's position using k-Nearest Neighbors
        (k-NN). More pinned beacons at accurate positions = better positioning accuracy.</li>
      <li><b>Sub-room tracking</b> &mdash; Unlike room-level presence which only knows "Kitchen" or
        "Living Room", these positions enable <em>within-room</em> tracking on the 3D map &mdash;
        showing exactly where in the room a device is, not just which room.</li>
    </ul>
    <p style="margin:0 0 12px;border-top:1px solid #1b3526;padding-top:10px">
      <b style="color:#60a5fa">How to set accurate positions:</b>
    </p>
    <ol style="margin:0 0 12px;padding-left:20px">
      <li><b>Drag the beacon diamond</b> on the 3D map to where the physical device
        actually is in your home.</li>
      <li><b>Use room boundaries</b> as visual guides &mdash; the detected room updates
        in real time as you drag.</li>
      <li><b>Multiple beacons</b> spread across different rooms and positions give PadSpan
        more reference points, dramatically improving positioning accuracy.</li>
      <li>After placing, PadSpan <b>automatically collects calibration data</b> every 10 minutes
        by recording RSSI readings at the pinned position.</li>
    </ol>
    <p style="margin:0 0 12px;border-top:1px solid #1b3526;padding-top:10px">
      <b style="color:#a78bfa">RSSI (Received Signal Strength Indicator)</b>
    </p>
    <p style="margin:0 0 10px">
      RSSI is measured in <b>dBm</b> (decibel-milliwatts) and is always a negative number.
      It tells you how strong the Bluetooth signal is when it reaches a scanner.
    </p>
    <ul style="margin:0 0 10px;padding-left:20px">
      <li><b style="color:#52b788">&minus;50 dBm</b> &mdash; strong signal, device is close to the scanner. <b>This is good.</b></li>
      <li><b style="color:#f59e0b">&minus;75 dBm</b> &mdash; moderate signal, typical for a device one or two rooms away.</li>
      <li><b style="color:#f87171">&minus;95 dBm</b> &mdash; weak signal, device is far away or obstructed by walls/floors.</li>
    </ul>
    <p style="margin:0 0 10px">
      <b>Lower numbers (closer to zero) = stronger signal = better.</b>
      Think of it as a score where &minus;40 is excellent and &minus;100 is barely detectable.
    </p>
    <p style="margin:0 0 10px">
      PadSpan uses RSSI from multiple scanners simultaneously to triangulate a device's position.
      The pattern of strong vs. weak signals across your scanners creates a unique
      <em>radio fingerprint</em> for each location in your home. This is why calibration data
      from accurately placed beacons is so valuable &mdash; it teaches the system what those
      fingerprints look like at known positions.
    </p>
    <p style="margin:0;color:#94a3b8;font-size:11px">
      Tip: Place at least 2&ndash;3 beacons per room for best results.
      Beacons near walls or corners are especially useful for triangulation.
    </p>
  `;
  if (ctx?.actions?.openModal) {
    ctx.actions.openModal("Position Percentages", body, "Beacon Tune \u00b7 Place Beacons");
  }
}

function _detectRoom(x, y, mapData) {
  const bounds = mapData?.room_bounds || {};
  for (const [room, b] of Object.entries(bounds)) {
    if (b.type === "poly" && _pointInPoly(x, y, b.points)) return room;
    if (b.type === "circle") {
      const dx = x - b.cx, dy = y - b.cy;
      if (Math.sqrt(dx * dx + dy * dy) <= b.r) return room;
    }
  }
  return "";
}

function _roomCentroid(roomName, mapData) {
  const b = (mapData?.room_bounds || {})[roomName];
  if (!b) return null;
  if (b.type === "poly" && Array.isArray(b.points) && b.points.length >= 3) {
    const cx = b.points.reduce((a, p) => a + p[0], 0) / b.points.length;
    const cy = b.points.reduce((a, p) => a + p[1], 0) / b.points.length;
    return [cx, cy];
  }
  if (b.type === "circle") return [b.cx, b.cy];
  return null;
}

// ── Beacon collection helpers (active 60s RSSI capture) ──────────────────────

function _resolveBeaconAddr(bkKey, snap) {
  if (!bkKey || !snap) return "";
  // Try objects.list lookup by key
  const obj = (snap?.objects?.list || []).find(o => o.key === bkKey);
  if (obj) return obj.address || obj.entity_id || "";
  // Fallback: strip common prefixes
  return bkKey.replace(/^(ble:|entity:|ibeacon:)/, "");
}

// ── Beacon Tune tab — 3D iso map with draggable beacon markers ───────────────
function _beaconTuneTab(ctx, el, cs, calData) {
  const wrap = el("div", { style: "display:flex;flex-direction:column;gap:10px" });
  const snap = (ctx.state.live && ctx.state.live.snapshot) || null;
  const maps_list = (ctx.state.maps && ctx.state.maps.list) ? ctx.state.maps.list : [];
  const _metresToFrac = _metresToFracFactory(ctx.state.model);

  if (!maps_list.length) {
    wrap.appendChild(el("div", { class: "card" }, [
      el("div", { style: "font-weight:700;font-size:14px;margin-bottom:6px;color:#52b788" }, "No Maps Uploaded"),
      el("div", { style: "font-size:12px;color:#94a3b8" },
        "Upload floor plan images in the Maps tab first, then return here to mark beacon reference positions."),
    ]));
    return wrap;
  }

  // ── Experimental badge + explainer ────────────────────────────────────
  wrap.appendChild(el("div", { class: "card", style: "border-color:#f59e0b" }, [
    el("div", { style: "display:flex;align-items:center;gap:8px;margin-bottom:6px" }, [
      el("span", { style: "background:#f59e0b;color:#000;font-weight:700;font-size:11px;padding:2px 8px;border-radius:4px" }, "EXPERIMENTAL"),
      el("span", { style: "font-weight:700;font-size:14px;color:#f59e0b" }, "Beacon Tune"),
    ]),
    el("div", { style: "font-size:12px;color:#94a3b8;line-height:1.5" },
      "Mark where beacons (AirTags, Tiles, key fobs) are right now on the 3D floor stack. Drag a beacon to reposition it — a 60-second radio capture starts automatically. After the timer finishes, calibration data is saved and the beacon returns to live tracking. Green circles show scanner positions for reference."),
  ]));

  // ── Constants & state ─────────────────────────────────────────────────────
  const TILE = 220, CX = 380, CY = 590, W = 760, BASE_H = 940;
  const LAYER_PAL = ["#52b788","#f59e0b","#60a5fa","#e879f9","#fb923c","#34d399","#f87171","#a78bfa"];
  const _esc = s => String(s||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
  const roomColorFn = ctx.helpers.roomColor || (name => {
    let h = 0; const s = String(name || "");
    for (let i = 0; i < s.length; i++) { h = Math.imul(h ^ s.charCodeAt(i), 16777619); }
    return `hsl(${(h >>> 0) % 360} 70% 55%)`;
  });

  if (!ctx.state._calibBeacon) ctx.state._calibBeacon = {
    fg: ctx.state.settings?.overview_iso_floor_gap ?? 150,
    hg: ctx.state.settings?.overview_iso_horiz_gap ?? 0,
    focusIdx: 0,
    draftBeacons: {},    // mapId → [{id, label, key, kind, x, y}]
    dirtyMaps: {},       // mapId → true
    selectedBk: null,    // {mapId, bkId}
    pendingPlace: null,  // {key, label, kind} — awaiting dblclick on map
    _relocating: null,   // {bkId, mapId} — beacon being relocated (old entry to remove on place)
    _mapsStamp: null,
    // ── Per-beacon live timers (independent 60s RSSI capture) ──
    _liveTimers: {},       // bkId → { endTime, mapId, bk:{...}, readings:{}, timer, pollTimer, warning }
    _liveBeaconKeys: new Set(),  // beacon keys that completed calibration → show live position
    _calibRounds: {},      // bkKey → number of completed calibration rounds (weight increases)
    // ── Calibration Guide (guided calibration) ──
    _guideActive: false,
    _guideBkKey: null,     // selected beacon key for guide
    _guideTarget: null,    // {mapId, x, y, room} — suggested position
    _guideSkipped: [],     // [{mapId, x, y}] — positions user skipped
    _guideCapturing: false, // true while 60s capture is running
    _guideSaved: false,    // brief "Saved!" flash before advancing to next location
    _guideReport: "",      // capture report text shown after save
    _guideTimerId: null,
    _guidePollId: null,
    _guideReadings: {},    // {source: {name, samples:[]}}
    _guideEndTime: 0,
    _guideResolvedAddr: null,
    _guideAllAddrs: null,
    _guideCanonical: null,
  };
  const bs = ctx.state._calibBeacon;

  const _isFollowed = (obj) => ctx.actions.followedHas(obj.address || obj.entity_id || "");
  function _autoPinTracked() {
    const pinnedKeys = new Set();
    const pinnedLabels = new Set();
    const pinnedAddrs = new Set();  // track MACs to dedup cross-protocol
    for (const bks of Object.values(bs.draftBeacons)) {
      for (const bk of bks) {
        if (bk.key) pinnedKeys.add(bk.key.toUpperCase());
        if (bk.label) pinnedLabels.add(bk.label.toUpperCase());
      }
    }
    // Collect addresses from snapshot objects that are already pinned by key
    for (const obj of (snap?.objects?.list || [])) {
      if (pinnedKeys.has((obj.key||"").toUpperCase())) {
        for (const a of (obj.all_addresses || [])) if (a) pinnedAddrs.add(String(a).toUpperCase());
        if (obj.address) pinnedAddrs.add(String(obj.address).toUpperCase());
      }
    }
    // Sort: prefer iBeacon > private_ble > ble > entity (avoids pinning
    // the entity duplicate when the BLE version is already tracked)
    const kindPri = { ibeacon: 0, private_ble: 1, ble: 2, entity: 3 };
    const sortedObjs = [...(snap?.objects?.list || [])].sort((a, b) =>
      (kindPri[a.kind] ?? 9) - (kindPri[b.kind] ?? 9)
    );
    for (const obj of sortedObjs) {
      if (!(obj.user_label || obj.identified || _isFollowed(obj))) continue;
      if (!obj.room || pinnedKeys.has((obj.key||"").toUpperCase())) continue;
      // Skip if another object with the same label is already pinned
      const lbl = (obj.user_label || obj.name || "").toUpperCase();
      if (lbl && pinnedLabels.has(lbl)) continue;
      // Skip if this object shares any MAC address with an already-pinned object
      const objAddrs = (obj.all_addresses || []).map(a => String(a).toUpperCase());
      if (obj.address) objAddrs.push(String(obj.address).toUpperCase());
      if (objAddrs.some(a => pinnedAddrs.has(a))) continue;
      for (const m of maps_list) {
        const c = _roomCentroid(obj.room, m);
        if (!c) continue;
        if (!bs.draftBeacons[m.id]) bs.draftBeacons[m.id] = [];
        const bkLabel = obj.user_label || obj.name || obj.key;
        bs.draftBeacons[m.id].push({
          id: "bk_" + Math.random().toString(16).slice(2, 10),
          label: bkLabel, key: obj.key, kind: obj.kind || "ble",
          x: c[0], y: c[1],
        });
        pinnedKeys.add((obj.key||"").toUpperCase());
        if (lbl) pinnedLabels.add(lbl);
        for (const a of objAddrs) pinnedAddrs.add(a);
        bs.dirtyMaps[m.id] = true;
        break;
      }
    }
  }

  // Build stamp and sync draft beacons from maps data
  const mapsStamp = maps_list.map(m => `${m.id}:${m.updated||""}:${(m.beacons||[]).length}`).join("|");
  const hasDirty = Object.values(bs.dirtyMaps).some(Boolean);
  if (!Object.keys(bs.draftBeacons).length || (mapsStamp !== bs._mapsStamp && !hasDirty)) {
    for (const m of maps_list) {
      bs.draftBeacons[m.id] = (m.beacons || []).map(bk => ({
        id: bk.id || ("bk_" + Math.random().toString(16).slice(2, 10)),
        label: bk.label || "", key: bk.key || "",
        kind: bk.kind || "", x: Number(bk.x || 0), y: Number(bk.y || 0),
      }));
    }
    for (const id of Object.keys(bs.draftBeacons)) {
      if (!maps_list.find(m => m.id === id)) delete bs.draftBeacons[id];
    }
    bs._mapsStamp = mapsStamp;
    _autoPinTracked();
    // Dedup: ensure each beacon key, label, AND address appears at most once.
    // Cross-protocol dedup: use snapshot all_addresses to detect same device.
    const _seenKeys = new Set();
    const _seenLabels = new Set();
    const _seenAddrs = new Set();
    // Build key→addresses lookup from snapshot
    const _keyAddrs = {};
    for (const obj of (snap?.objects?.list || [])) {
      const addrs = [];
      for (const a of (obj.all_addresses || [])) if (a) addrs.push(String(a).toUpperCase());
      if (obj.address) addrs.push(String(obj.address).toUpperCase());
      if (addrs.length) _keyAddrs[(obj.key||"").toUpperCase()] = addrs;
    }
    let _dedupRemoved = false;
    for (const mapId of Object.keys(bs.draftBeacons)) {
      const before = bs.draftBeacons[mapId].length;
      bs.draftBeacons[mapId] = bs.draftBeacons[mapId].filter(bk => {
        if (!bk.key) return true;
        const k = bk.key.toUpperCase();
        const l = (bk.label || "").toUpperCase();
        if (_seenKeys.has(k)) return false;
        if (l && _seenLabels.has(l)) return false;
        // Check if this beacon shares any MAC with an already-seen beacon
        const addrs = _keyAddrs[k] || [];
        if (addrs.some(a => _seenAddrs.has(a))) return false;
        _seenKeys.add(k);
        if (l) _seenLabels.add(l);
        for (const a of addrs) _seenAddrs.add(a);
        return true;
      });
      if (bs.draftBeacons[mapId].length !== before) {
        bs.dirtyMaps[mapId] = true;
        _dedupRemoved = true;
      }
    }
    // Auto-save deduped beacons to backend so duplicates are permanently cleaned
    if (_dedupRemoved) {
      (async () => {
        for (const mid of Object.keys(bs.dirtyMaps)) {
          if (!bs.dirtyMaps[mid]) continue;
          const origMap = maps_list.find(m => m.id === mid);
          if (!origMap) continue;
          try {
            bs.dirtyMaps[mid] = false;
          } catch(_) {}
        }
      })();
    }
  }

  // Auto-enable live tracking for beacons that have snapshot position data
  // (metres from k-NN, or room from the presence coordinator). This makes
  // beacons float to their RSSI-derived position by default instead of being
  // stuck at pinned coordinates until a calibration round completes.
  if (snap) {
    const snapObjs = snap?.objects?.list || [];
    for (const bks of Object.values(bs.draftBeacons)) {
      for (const bk of bks) {
        if (!bk.key || bs._liveBeaconKeys.has(bk.key)) continue;
        // Skip beacons that have an active timer (calibration in progress)
        if (bs._liveTimers[bk.id] && bs._liveTimers[bk.id].endTime > Date.now()) continue;
        const obj = snapObjs.find(o => o.key === bk.key);
        if (obj && (typeof obj.x_m === "number" || obj.room)) {
          bs._liveBeaconKeys.add(bk.key);
        }
      }
    }
  }

  let _fg = bs.fg, _hg = bs.hg;

  // ── Transforms ────────────────────────────────────────────────────────────
  const iso = (wx, wy, wz) => [CX + (wx - wy) * TILE * 0.866 + wz * _hg, CY + (wx + wy) * TILE * 0.5 - wz * _fg];
  const pt  = c => `${Math.round(c[0])},${Math.round(c[1])}`;
  const pts = cs2 => cs2.map(pt).join(" ");

  const invIso = (sx, sy, z) => {
    const ax = sx - CX - z * _hg;
    const ay = sy - CY + z * _fg;
    const A = TILE * 0.866, B = TILE * 0.5;
    const wx = (ax / A + ay / B) / 2;
    const wy = (ay / B - ax / A) / 2;
    return [wx, wy];
  };

  // Filter & sort maps
  const hiddenIds = ctx.state.maps._hiddenMapIds || new Set();
  const sorted = [...maps_list].filter(m => !hiddenIds.has(m.id)).sort((a, b) => (a.stack?.z_level || 0) - (b.stack?.z_level || 0));
  const byLevel = new Map();
  for (const m of sorted) { const z = m.stack?.z_level ?? 0; if (!byLevel.has(z)) byLevel.set(z, []); byLevel.get(z).push(m); }
  const sortedIsoLevels = [...byLevel.keys()].sort((a, b) => a - b);
  const levelColor = z => LAYER_PAL[sortedIsoLevels.indexOf(z) % LAYER_PAL.length];

  // Floor focus slider positions
  const _isoPos = [null];
  for (let i = 0; i < sortedIsoLevels.length; i++) {
    _isoPos.push(sortedIsoLevels[i]);
    if (i < sortedIsoLevels.length - 1) _isoPos.push([sortedIsoLevels[i], sortedIsoLevels[i + 1]]);
  }
  bs.focusIdx = Math.max(0, Math.min(bs.focusIdx, _isoPos.length - 1));
  const _getFocusZ = idx => _isoPos[Math.max(0, Math.min(idx, _isoPos.length - 1))];
  const _getFocusLbl = idx => {
    const pos = _getFocusZ(idx);
    if (pos === null) return "All floors";
    const fl = ctx.state.model?.floors || [];
    const zArr = Array.isArray(pos) ? pos : [pos];
    return zArr.map(z => { const f = fl.find(x => x.level === z); return f ? (f.name || `L${z}`) : `L${z}`; }).join(" + ");
  };

  // Per-map forward+inverse transforms (shared stack_transform.js module)
  const mapXforms = {};
  for (const m of sorted) {
    const stk = m.stack || {};
    const xf = mapXform(ctx.state.model, m);
    if (!xf) continue;     // unplaced, or no world frame: draw nothing
    mapXforms[m.id] = { z: stk.z_level || 0, mapPt: xf.mapPt, invMapPt: xf.invMapPt };
  }

  // ── Build SVG ───────────────────────────────────────────────────────────────
  const LEGEND_H = sortedIsoLevels.length * 30 + 24;
  const buildBeaconSVG = (focusZ) => {
    const slabWZ = 18 / _fg;
    const maxIsoZ = sortedIsoLevels.length ? sortedIsoLevels[sortedIsoLevels.length - 1] : 0;
    const viewY = Math.min(0, CY - maxIsoZ * _fg - 50);
    const HTOTAL = BASE_H + LEGEND_H - viewY;
    let s = `<svg viewBox="0 ${viewY} ${W} ${HTOTAL}" xmlns="http://www.w3.org/2000/svg" width="100%" style="max-height:${HTOTAL}px;display:block;font-family:system-ui,sans-serif">`;
    s += `<rect x="0" y="${viewY}" width="${W}" height="${HTOTAL}" fill="#071008"/>`;

    // Floor patterns
    s += `<defs>`;
    sortedIsoLevels.forEach((z2, li) => {
      const c2 = levelColor(z2);
      if (li === 0) {
        s += `<pattern id="bpat_${li}" x="0" y="0" width="24" height="24" patternUnits="userSpaceOnUse">`;
        s += `<path d="M12,2 C16,2 19,6 19,11 C19,16 16,21 12,22 C8,21 5,16 5,11 C5,6 8,2 12,2 Z" fill="none" stroke="${c2}" stroke-width="0.7" opacity="0.14"/>`;
        s += `<path d="M12,2 C13.5,0 15.5,0.5 14.5,2.5 C13.5,1.5 12,2 12,2 Z" fill="${c2}" opacity="0.11"/>`;
        s += `<circle cx="12" cy="15" r="1.4" fill="${c2}" opacity="0.1"/>`;
        s += `</pattern>`;
      } else if (li === 2) {
        s += `<pattern id="bpat_${li}" x="0" y="0" width="12" height="12" patternUnits="userSpaceOnUse">`;
        s += `<line x1="0" y1="12" x2="12" y2="0" stroke="${c2}" stroke-width="0.6" opacity="0.18"/>`;
        s += `<line x1="0" y1="0" x2="12" y2="12" stroke="${c2}" stroke-width="0.6" opacity="0.18"/>`;
        s += `</pattern>`;
      } else if (li >= 3) {
        s += `<pattern id="bpat_${li}" x="0" y="0" width="16" height="13.86" patternUnits="userSpaceOnUse">`;
        s += `<circle cx="0" cy="0" r="1.5" fill="${c2}" opacity="0.14"/>`;
        s += `<circle cx="8" cy="6.93" r="1.5" fill="${c2}" opacity="0.14"/>`;
        s += `<circle cx="16" cy="0" r="1.5" fill="${c2}" opacity="0.14"/>`;
        s += `<circle cx="0" cy="13.86" r="1.5" fill="${c2}" opacity="0.14"/>`;
        s += `<circle cx="16" cy="13.86" r="1.5" fill="${c2}" opacity="0.14"/>`;
        s += `</pattern>`;
      }
    });
    s += `</defs>`;

    if (!sorted.length) {
      s += `<text x="${W / 2}" y="${BASE_H / 2}" text-anchor="middle" fill="#4a6052" font-size="13">All layers hidden</text>`;
      s += `</svg>`; return s;
    }

    // Floor slabs + room polygons + receivers (reference) + beacons (draggable)
    for (const [z, group] of [...byLevel.entries()].sort((a, b) => a[0] - b[0])) {
      const isFocused = focusZ === null || (Array.isArray(focusZ) ? focusZ.includes(z) : focusZ === z);
      const go = isFocused ? 1.0 : 0.1;
      const lyrColor = levelColor(z);
      const lidx = sortedIsoLevels.indexOf(z);

      // Bounding box for all maps at this level
      let x0 = Infinity, y0_ = Infinity, x1 = -Infinity, y1_ = -Infinity;
      for (const m of group) {
        const xf = mapXforms[m.id]; if (!xf) continue;
        for (const [cx2, cy2] of [[0, 0], [1, 0], [1, 1], [0, 1]]) {
          const [wx, wy] = xf.mapPt(cx2, cy2);
          x0 = Math.min(x0, wx); y0_ = Math.min(y0_, wy); x1 = Math.max(x1, wx); y1_ = Math.max(y1_, wy);
        }
      }
      if (!isFinite(x0)) { x0 = 0; y0_ = 0; x1 = 1; y1_ = 0.75; }

      const TL = iso(x0, y0_, z), TR = iso(x1, y0_, z), BR = iso(x1, y1_, z), BL = iso(x0, y1_, z);
      const TR_b = iso(x1, y0_, z - slabWZ), BR_b = iso(x1, y1_, z - slabWZ), BL_b = iso(x0, y1_, z - slabWZ);

      s += `<g opacity="${go}">`;
      // 3D slab sides
      s += `<polygon points="${pts([TR, BR, BR_b, TR_b])}" fill="#0d2318" fill-opacity="0.35" stroke="#253e2e" stroke-width="0.8"/>`;
      s += `<polygon points="${pts([BL, BR, BR_b, BL_b])}" fill="#0a1a12" fill-opacity="0.3" stroke="#253e2e" stroke-width="0.8"/>`;
      // Top face
      s += `<polygon points="${pts([TL, TR, BR, BL])}" fill="#0f2017" fill-opacity="0.06" stroke="${lyrColor}" stroke-width="1.5" stroke-dasharray="10,5" opacity="0.5"/>`;
      if (lidx !== 1) { s += `<polygon points="${pts([TL, TR, BR, BL])}" fill="url(#bpat_${lidx})" stroke="none"/>`; }

      // Room polygons + labels
      for (const m of group) {
        const xf = mapXforms[m.id]; if (!xf) continue;
        for (const [room, b] of Object.entries(m.room_bounds || {})) {
          if (!b || b.type !== "poly" || !Array.isArray(b.points) || b.points.length < 3) continue;
          const color = roomColorFn(room);
          const pp = b.points.map(p => { const [wx, wy] = xf.mapPt(p[0], p[1]); return pt(iso(wx, wy, z)); }).join(" ");
          s += `<polygon points="${pp}" fill="${color}" fill-opacity="0.2" stroke="${color}" stroke-width="1.5" opacity="0.9" pointer-events="none"/>`;
          const rcx = b.points.reduce((a, p) => a + p[0], 0) / b.points.length;
          const rcy = b.points.reduce((a, p) => a + p[1], 0) / b.points.length;
          const [lwx, lwy] = xf.mapPt(rcx, rcy);
          const [lix, liy] = iso(lwx, lwy, z);
          s += `<text x="${Math.round(lix)}" y="${Math.round(liy) + lidx * 2}" text-anchor="middle" dominant-baseline="middle" fill="${color}" font-size="7" pointer-events="none">${_esc(room)}</text>`;
        }

        // Receiver markers (non-draggable green reference) — show all, dim offline
        const _liveRadios = snap?.ble?.radios || [];
        for (const r of (m.receivers || [])) {
          const _lr = _liveRadios.find(rd => rd.name === (r.label || "") || rd.source === (r.id || "") || rd.source === (r.source || "") || rd.name === (r.id || ""));
          const _isLive = !!_lr;
          const [wx, wy] = xf.mapPt(r.x || 0, r.y || 0);
          const [px, py] = iso(wx, wy, z);
          const rx = Math.round(px), ry = Math.round(py);
          const _full = r.label || r.id || "R";
          const lbl = _full.length > 20 ? _full.substring(0, 19) + "…" : _full;
          const tip = `Scanner: ${r.label || r.id || "Receiver"}${r.room ? " | Room: " + r.room : ""}${!_isLive ? " (offline)" : ""}`;
          const _rxCol = _isLive ? "#52b788" : "#4a6052";
          s += `<g data-tip="${_esc(tip)}" style="cursor:default;opacity:${_isLive ? 0.6 : 0.3}">`;
          s += `<circle cx="${rx}" cy="${ry}" r="10" fill="none" stroke="${_rxCol}" stroke-width="1.2" opacity="0.5"/>`;
          s += `<circle cx="${rx}" cy="${ry}" r="5" fill="${_rxCol}" opacity="0.6"/>`;
          const lblW = Math.min(lbl.length * 5 + 6, 112);
          s += `<rect x="${rx - lblW / 2}" y="${ry + 12}" width="${lblW}" height="11" rx="3" fill="#071008" opacity="0.7"/>`;
          s += `<text x="${rx}" y="${ry + 21}" text-anchor="middle" fill="${_rxCol}" font-size="7" opacity="0.7">${_esc(lbl)}</text>`;
          s += `</g>`;
        }

        // Beacon markers (draggable teal diamonds, or live-tracking green diamonds)
        const draft = bs.draftBeacons[m.id] || [];
        const _snap = (ctx.state.live && ctx.state.live.snapshot) || null;
        for (const bk of draft) {
          const isLive = bs._liveBeaconKeys.has(bk.key);
          const isTimerActive = bs._liveTimers[bk.id] && bs._liveTimers[bk.id].endTime > Date.now();

          // Always render at draft (pinned) position — the user placed it here.
          // Server k-NN estimates may be stale or on a different map; showing them
          // would make the beacon appear to jump away and become undraggable.
          let useX = bk.x || 0, useY = bk.y || 0;
          let liveObj = null;
          if (isLive && !isTimerActive) {
            liveObj = (_snap?.objects?.list || []).find(o => o.key === bk.key);
          }

          const [wx, wy] = xf.mapPt(useX, useY);
          const [px, py] = iso(wx, wy, z);
          const isSel = bs.selectedBk && bs.selectedBk.mapId === m.id && bs.selectedBk.bkId === bk.id;
          const bx = Math.round(px), by = Math.round(py);
          const lbl = (liveObj?.user_label || liveObj?.name || bk.label || bk.key || "B").substring(0, 8);
          const detectedRoom = isLive && liveObj?.room ? liveObj.room : _detectRoom(useX, useY, m);
          const fillColor = isLive && !isTimerActive ? "#52b788" : "#5eead4";
          const confidence = liveObj?.knn_confidence;
          const tipParts = [liveObj?.user_label || liveObj?.name || bk.label || bk.key || "Beacon"];
          if (detectedRoom) tipParts.push("Room: " + detectedRoom);
          tipParts.push(`Pinned: x ${(useX * 100).toFixed(1)}% y ${(useY * 100).toFixed(1)}%`);
          // Show server estimate in tooltip if available
          // The server answers in metres. Turning that into a spot on this
          // photo is drawing, and it happens here, at the last moment.
          let serverX = null, serverY = null;
          const _srv = _metresToFrac(liveObj, m);
          if (_srv) {
            serverX = _srv[0]; serverY = _srv[1];
            tipParts.push(`Server: ${liveObj.x_m.toFixed(2)}, ${liveObj.y_m.toFixed(2)} m`);
          }
          if (isLive && confidence != null) tipParts.push(`Confidence: ${(confidence * 100).toFixed(0)}%`);
          if (isLive) tipParts.push("LIVE");
          const tip = tipParts.join(" | ");

          s += `<g data-bk-id="${_esc(bk.id)}" data-map-id="${_esc(m.id)}" data-z="${z}" data-tip="${_esc(tip)}" style="cursor:grab">`;
          // Transparent hit area for easier clicking/dragging
          s += `<circle cx="${bx}" cy="${by}" r="22" fill="transparent" stroke="none"/>`;
          // Selection highlight
          if (isSel) s += `<circle cx="${bx}" cy="${by}" r="22" fill="none" stroke="#fbbf24" stroke-width="2" stroke-dasharray="4,3" opacity="0.9"/>`;
          // Pulse ring
          s += `<circle cx="${bx}" cy="${by}" r="16" fill="${fillColor}" opacity="0.2"/>`;
          // Diamond (rotated square)
          s += `<rect x="${bx - 8}" y="${by - 8}" width="16" height="16" rx="2" transform="rotate(45 ${bx} ${by})" fill="${fillColor}" stroke="#071008" stroke-width="1.5" opacity="0.95"/>`;
          // Center dot
          s += `<circle cx="${bx}" cy="${by}" r="3" fill="#071008" opacity="0.7"/>`;
          // Label + LIVE badge
          if (isLive && !isTimerActive) {
            const liveLbl = lbl + " LIVE";
            const lblW = Math.min(liveLbl.length * 7 + 8, 90);
            s += `<rect x="${bx - lblW / 2}" y="${by + 18}" width="${lblW}" height="13" rx="3" fill="#071008" opacity="0.8"/>`;
            s += `<text x="${bx}" y="${by + 28}" text-anchor="middle" fill="#52b788" font-size="9" font-weight="600">${_esc(liveLbl)}</text>`;
          } else {
            const lblW = Math.min(lbl.length * 7 + 8, 70);
            s += `<rect x="${bx - lblW / 2}" y="${by + 18}" width="${lblW}" height="13" rx="3" fill="#071008" opacity="0.8"/>`;
            s += `<text x="${bx}" y="${by + 28}" text-anchor="middle" fill="#5eead4" font-size="9" font-weight="600">${_esc(lbl)}</text>`;
          }
          // Live timer overlay (amber dashed ring + countdown)
          const timerEntry = bs._liveTimers[bk.id];
          if (timerEntry && timerEntry.endTime > Date.now()) {
            const rem = Math.max(0, Math.ceil((timerEntry.endTime - Date.now()) / 1000));
            s += `<circle cx="${bx}" cy="${by}" r="28" fill="none" stroke="#f59e0b" stroke-width="2" stroke-dasharray="8,4" opacity="0.9">`;
            s += `<animateTransform attributeName="transform" type="rotate" from="0 ${bx} ${by}" to="360 ${bx} ${by}" dur="3s" repeatCount="indefinite"/>`;
            s += `</circle>`;
            s += `<text x="${bx}" y="${by + 42}" text-anchor="middle" fill="#f59e0b" font-size="10" font-weight="700">${rem}s</text>`;
          }
          s += `</g>`;

          // Ghost marker: show server's k-NN estimated position (if on this map and differs from pinned)
          if (isLive && !isTimerActive && liveObj && serverX != null && serverY != null) {
            {
              const dist = Math.hypot(serverX - useX, serverY - useY);
              if (dist > 0.03) {  // only show if > 3% away
                const [gwx, gwy] = xf.mapPt(serverX, serverY);
                const [gpx, gpy] = iso(gwx, gwy, z);
                const gx = Math.round(gpx), gy = Math.round(gpy);
                // Dashed line from pinned to server estimate
                s += `<line x1="${bx}" y1="${by}" x2="${gx}" y2="${gy}" stroke="#f59e0b" stroke-width="1" stroke-dasharray="4,3" opacity="0.5"/>`;
                // Small ghost diamond at server position
                s += `<rect x="${gx - 5}" y="${gy - 5}" width="10" height="10" rx="1" transform="rotate(45 ${gx} ${gy})" fill="none" stroke="#f59e0b" stroke-width="1" stroke-dasharray="3,2" opacity="0.5"/>`;
                s += `<text x="${gx}" y="${gy + 16}" text-anchor="middle" fill="#f59e0b" font-size="7" opacity="0.6">server</text>`;
              }
            }
          }
        }
      }

      // Layer index dot
      s += `<circle cx="${Math.round(BL[0])}" cy="${Math.round(BL[1])}" r="15" fill="${lyrColor}" opacity="0.95"/>`;
      s += `<text x="${Math.round(BL[0])}" y="${Math.round(BL[1]) + 6}" text-anchor="middle" fill="#071008" font-size="14" font-weight="700">${lidx + 1}</text>`;
      s += `</g>`;
    }

    // Legend
    s += `<line x1="10" y1="${BASE_H + 4}" x2="${W - 10}" y2="${BASE_H + 4}" stroke="#1b3526" stroke-width="0.8"/>`;
    sortedIsoLevels.forEach((z, i) => {
      const ly = BASE_H + 10 + i * 30;
      const color = levelColor(z);
      const groupLabel = byLevel.get(z).map(m => m.name || m.id).join(" + ");
      s += `<circle cx="18" cy="${ly + 11}" r="11" fill="${color}" opacity="0.9"/>`;
      s += `<text x="18" y="${ly + 15}" text-anchor="middle" fill="#071008" font-size="12" font-weight="700">${i + 1}</text>`;
      s += `<text x="36" y="${ly + 15}" fill="${color}" font-size="18" font-weight="500">${_esc(groupLabel)}</text>`;
    });

    s += `</svg>`;
    return s;
  };

  // ── Beacon picker row ─────────────────────────────────────────────────
  const allPinnedKeys = new Set();
  for (const bks of Object.values(bs.draftBeacons)) {
    for (const bk of bks) if (bk.key) allPinnedKeys.add(bk.key);
  }
  const availObjs = (snap?.objects?.list || [])
    .filter(o => (o.user_label || o.identified || _isFollowed(o)) && !allPinnedKeys.has(o.key)
      && (o.kind === "ble" || o.kind === "private_ble" || o.kind === "ibeacon" || (o.kind === "entity" && o.address)))
    .sort((a, b) => (a.user_label || a.name || "").localeCompare(b.user_label || b.name || ""));

  const pickerRow = el("div", { style: "display:flex;gap:8px;align-items:center;flex-wrap:wrap" });

  // Floor selector for beacon placement
  const bkMapSel = document.createElement("select");
  bkMapSel.style.cssText = "min-width:120px;";
  {
    const _fl = ctx.state.model?.floors || [];
    const _floorMaps = new Map();
    for (const m of sorted) {
      const fid = m.floor_id || "main";
      if (!_floorMaps.has(fid)) _floorMaps.set(fid, []);
      _floorMaps.get(fid).push(m);
    }
    // Floor entries only
    for (const f of _fl) {
      const fMaps = _floorMaps.get(f.id) || [];
      if (!fMaps.length) continue;
      const opt = document.createElement("option");
      opt.value = `__floor__${f.id}`;
      opt.textContent = f.name || f.id;
      bkMapSel.appendChild(opt);
    }
    // Floors in maps but not in model
    for (const [fid, fMaps] of _floorMaps) {
      if (_fl.some(f => f.id === fid)) continue;
      const opt = document.createElement("option");
      opt.value = `__floor__${fid}`;
      opt.textContent = fid;
      bkMapSel.appendChild(opt);
    }
  }

  const bkSel = document.createElement("select");
  bkSel.style.cssText = "flex:1;min-width:160px;";
  const ph = document.createElement("option");
  ph.value = "";
  ph.textContent = availObjs.length ? "\u2014 select beacon to add \u2014" : "\u2014 no available beacons \u2014";
  bkSel.appendChild(ph);
  for (const o of availObjs) {
    const opt = document.createElement("option");
    opt.value = o.key;
    const kindBadge = o.kind === "ibeacon" ? " [iBeacon]" : o.kind === "private_ble" ? " [Private BLE]" : " [BLE]";
    opt.textContent = (o.user_label || o.name || o.key) + (o.rssi ? ` (${o.rssi} dBm)` : "") + kindBadge;
    bkSel.appendChild(opt);
  }

  const addBtn = el("button", { class: "btn inline" }, "Add to map");
  addBtn.addEventListener("click", () => {
    const selKey = bkSel.value;
    if (!selKey) return;
    const obj = (snap?.objects?.list || []).find(o => o.key === selKey);
    if (!obj) return;
    let targetMapId = bkMapSel.value;
    // Resolve floor selection to best map on that floor
    if (targetMapId.startsWith("__floor__")) {
      const fid = targetMapId.replace("__floor__", "");
      const candidates = sorted.filter(m => (m.floor_id || "main") === fid);
      const best = candidates.slice().sort((a, b) => {
        const ra = (a.receivers || []).length + Object.keys(a.room_bounds || {}).length;
        const rb = (b.receivers || []).length + Object.keys(b.room_bounds || {}).length;
        return rb - ra;
      })[0];
      targetMapId = best ? best.id : "";
      if (!targetMapId) return;
    }
    const newBk = {
      id: "bk_" + Math.random().toString(16).slice(2, 10),
      label: obj.user_label || obj.name || selKey,
      key: selKey,
      kind: obj.kind || "ble",
      x: 0.5,
      y: 0.5,
    };
    if (!bs.draftBeacons[targetMapId]) bs.draftBeacons[targetMapId] = [];
    bs.draftBeacons[targetMapId].push(newBk);
    bs.dirtyMaps[targetMapId] = true;
    bs.selectedBk = { mapId: targetMapId, bkId: newBk.id };
    _refreshSVG();
    _refreshInfo();
    _refreshDirtyLabel();
    _refreshBeaconList();
  });

  pickerRow.appendChild(el("span", { style: "font-weight:600;font-size:13px" }, "Beacon:"));
  pickerRow.appendChild(bkSel);
  pickerRow.appendChild(el("span", { style: "font-size:12px;color:#94a3b8" }, "on"));
  pickerRow.appendChild(bkMapSel);
  pickerRow.appendChild(addBtn);

  // Timer display area — shows per-beacon countdown inline
  const timerArea = document.createElement("div");
  timerArea.style.cssText = "width:100%;display:flex;gap:10px;flex-wrap:wrap;min-height:0";
  function _refreshTimerRow() {
    timerArea.innerHTML = "";
    const ids = Object.keys(bs._liveTimers);
    if (!ids.length) return;
    for (const bkId of ids) {
      const t = bs._liveTimers[bkId];
      const rem = Math.max(0, Math.ceil((t.endTime - Date.now()) / 1000));
      const row = document.createElement("div");
      row.style.cssText = "display:flex;align-items:center;gap:6px;flex-wrap:wrap";
      const span = document.createElement("span");
      if (rem > 0) {
        const sc = Object.keys(t.readings).length;
        const sm = Object.values(t.readings).reduce((tot, r) => tot + r.samples.length, 0);
        const rd = (bs._calibRounds[t.bk.key] || 0) + 1;
        span.style.cssText = "font-size:12px;color:#f59e0b;font-weight:600;white-space:nowrap";
        span.textContent = `${t.bk.label || t.bk.key} \u2014 live in ${rem}s`;
        if (sm > 0) span.textContent += ` (${sc} scanners, ${sm} samples)`;
        if (rd > 1) span.textContent += ` [round ${rd}]`;
      } else {
        span.style.cssText = "font-size:12px;color:#52b788;font-weight:600;white-space:nowrap";
        span.textContent = `\u2713 ${t.bk.label || t.bk.key} live`;
      }
      row.appendChild(span);
      // Inline warning
      if (t.warning && rem > 0) {
        const warn = document.createElement("span");
        warn.style.cssText = "font-size:11px;color:#f87171;white-space:nowrap";
        warn.textContent = t.warning;
        row.appendChild(warn);
      }
      // Delete button — removes beacon from draft + stops timer
      const delBtn = document.createElement("button");
      delBtn.className = "btn inline";
      delBtn.style.cssText = "padding:1px 6px;font-size:10px;color:#f87171;border-color:#f87171;margin-left:4px";
      delBtn.textContent = "\u2716 Delete";
      delBtn.title = "Remove this beacon from all maps";
      delBtn.addEventListener("click", async () => {
        // Stop timer
        if (t.timer) clearTimeout(t.timer);
        if (t.pollTimer) clearTimeout(t.pollTimer);
        delete bs._liveTimers[bkId];
        bs._liveBeaconKeys.delete(t.bk.key);
        // Remove beacon from all maps' draftBeacons
        for (const mid of Object.keys(bs.draftBeacons)) {
          const before = bs.draftBeacons[mid].length;
          bs.draftBeacons[mid] = bs.draftBeacons[mid].filter(b => b.id !== bkId);
          if (bs.draftBeacons[mid].length !== before) bs.dirtyMaps[mid] = true;
        }
        // Un-pin from the fabric first — a batch save never deletes.
        try {
          if (t.bk.key) await ctx.actions.callWS({ type: "padspan_ha/fabric_beacon_remove", key: t.bk.key });
        } catch(_) {}
        // Auto-save the deletion
        for (const mid of Object.keys(bs.dirtyMaps)) {
          if (!bs.dirtyMaps[mid]) continue;
          const origMap = maps_list.find(m => m.id === mid);
          if (!origMap) continue;
          try {
            bs.dirtyMaps[mid] = false;
          } catch(_) {}
        }
        _refreshTimerRow();
        _refreshSVG();
        ctx.toast("Beacon removed");
      });
      row.appendChild(delBtn);
      timerArea.appendChild(row);
    }
  }
  _refreshTimerRow();
  pickerRow.appendChild(timerArea);
  wrap.appendChild(pickerRow);

  // ── Controls row ──────────────────────────────────────────────────────────
  const ctrlRow = document.createElement("div");
  ctrlRow.style.cssText = "display:flex;align-items:center;gap:10px;flex-wrap:wrap";

  // Floor focus
  const focusLbl = document.createElement("span");
  focusLbl.style.cssText = "font-size:12px;color:#94a3b8;min-width:80px;display:inline-block";
  focusLbl.textContent = _getFocusLbl(bs.focusIdx);
  const focusSlider = document.createElement("input");
  focusSlider.type = "range"; focusSlider.min = "0"; focusSlider.max = String(_isoPos.length - 1);
  focusSlider.style.cssText = "width:130px;accent-color:#5eead4;vertical-align:middle;cursor:pointer";
  focusSlider.value = String(bs.focusIdx);
  focusSlider.addEventListener("input", () => {
    bs.focusIdx = parseInt(focusSlider.value, 10);
    focusLbl.textContent = _getFocusLbl(bs.focusIdx);
    _refreshSVG();
  });

  const floorLbl = document.createElement("span");
  floorLbl.style.cssText = "font-size:12px;color:#94a3b8";
  floorLbl.textContent = "Floor:";
  ctrlRow.appendChild(floorLbl);
  ctrlRow.appendChild(focusSlider);
  ctrlRow.appendChild(focusLbl);

  // Spacing slider
  const gapLbl = document.createElement("span");
  gapLbl.style.cssText = "font-size:12px;color:#94a3b8;min-width:36px;display:inline-block;text-align:right";
  gapLbl.textContent = String(bs.fg);
  const gapSlider = document.createElement("input");
  gapSlider.type = "range"; gapSlider.min = "60"; gapSlider.max = "340"; gapSlider.step = "10";
  gapSlider.style.cssText = "width:110px;accent-color:#5eead4;vertical-align:middle;cursor:pointer";
  gapSlider.value = String(bs.fg);
  gapSlider.addEventListener("input", () => {
    bs.fg = parseInt(gapSlider.value, 10);
    _fg = bs.fg;
    gapLbl.textContent = String(bs.fg);
    _refreshSVG();
  });
  const spacingLbl = document.createElement("span");
  spacingLbl.style.cssText = "font-size:12px;color:#94a3b8;margin-left:8px";
  spacingLbl.textContent = "Spacing:";
  ctrlRow.appendChild(spacingLbl);
  ctrlRow.appendChild(gapSlider);
  ctrlRow.appendChild(gapLbl);

  // L/R slider
  const hgLbl = document.createElement("span");
  hgLbl.style.cssText = "font-size:12px;color:#94a3b8;min-width:36px;display:inline-block;text-align:right";
  hgLbl.textContent = String(bs.hg);
  const hgSlider = document.createElement("input");
  hgSlider.type = "range"; hgSlider.min = "-120"; hgSlider.max = "120"; hgSlider.step = "10";
  hgSlider.style.cssText = "width:110px;accent-color:#5eead4;vertical-align:middle;cursor:pointer";
  hgSlider.value = String(bs.hg);
  hgSlider.addEventListener("input", () => {
    bs.hg = parseInt(hgSlider.value, 10);
    _hg = bs.hg;
    hgLbl.textContent = String(bs.hg);
    _refreshSVG();
  });
  const lrLbl = document.createElement("span");
  lrLbl.style.cssText = "font-size:12px;color:#94a3b8;margin-left:8px";
  lrLbl.textContent = "L/R:";
  ctrlRow.appendChild(lrLbl);
  ctrlRow.appendChild(hgSlider);
  ctrlRow.appendChild(hgLbl);

  // Save button
  const statusLbl = document.createElement("span");
  statusLbl.style.cssText = "font-size:11px;color:#94a3b8;min-width:90px";
  const _bsDirty = Object.values(bs.dirtyMaps).some(Boolean);
  const saveBtn = document.createElement("button");
  saveBtn.className = "btn inline" + (_bsDirty ? " save-pulse" : "");
  saveBtn.style.cssText = "padding:2px 10px;font-size:12px";
  saveBtn.textContent = _bsDirty ? "\ud83d\udcbe Save" : "Save";
  saveBtn.title = "Save beacon reference positions";
  saveBtn.addEventListener("click", async () => {
    const dirtyIds = Object.keys(bs.dirtyMaps).filter(id => bs.dirtyMaps[id]);
    if (!dirtyIds.length) { statusLbl.textContent = "No changes"; setTimeout(() => { statusLbl.textContent = ""; }, 2000); return; }
    saveBtn.disabled = true;
    statusLbl.textContent = "Saving...";
    try {
      for (const mapId of dirtyIds) {
        const origMap = maps_list.find(m => m.id === mapId);
        if (!origMap) continue;
      }
      bs.dirtyMaps = {};
      bs.selectedBk = null;
      await ctx.actions.mapsRefresh();
      ctx.toast("Reference positions saved");
      saveBtn.disabled = false;
      statusLbl.textContent = "";
    } catch (e) {
      ctx.toast("Save failed: " + String(e), true);
      statusLbl.textContent = "Error saving";
      saveBtn.disabled = false;
    }
  });

  // Reset button
  const resetBtn = document.createElement("button");
  resetBtn.className = "btn inline";
  resetBtn.style.cssText = "padding:2px 10px;font-size:12px";
  resetBtn.textContent = "Reset";
  resetBtn.title = "Discard changes and reload beacon reference positions";
  resetBtn.addEventListener("click", () => {
    // Stop all live timers
    for (const bkId of Object.keys(bs._liveTimers)) {
      const t = bs._liveTimers[bkId];
      if (t.timer) clearTimeout(t.timer);
      if (t.pollTimer) clearTimeout(t.pollTimer);
    }
    bs._liveTimers = {};
    bs._liveBeaconKeys = new Set();
    bs._calibRounds = {};
    bs.draftBeacons = {};
    for (const m of maps_list) {
      bs.draftBeacons[m.id] = (m.beacons || []).map(bk => ({
        id: bk.id || "", label: bk.label || "", key: bk.key || "",
        kind: bk.kind || "", x: Number(bk.x || 0), y: Number(bk.y || 0),
      }));
    }
    bs.dirtyMaps = {};
    _autoPinTracked();
    // Dedup: ensure each beacon key, label, AND address appears at most once
    const _seenKeysR = new Set();
    const _seenLabelsR = new Set();
    const _seenAddrsR = new Set();
    const _kaR = {};
    for (const obj of (snap?.objects?.list || [])) {
      const addrs = [];
      for (const a of (obj.all_addresses || [])) if (a) addrs.push(String(a).toUpperCase());
      if (obj.address) addrs.push(String(obj.address).toUpperCase());
      if (addrs.length) _kaR[(obj.key||"").toUpperCase()] = addrs;
    }
    for (const mid of Object.keys(bs.draftBeacons)) {
      bs.draftBeacons[mid] = bs.draftBeacons[mid].filter(bk => {
        if (!bk.key) return true;
        const k = bk.key.toUpperCase();
        const l = (bk.label || "").toUpperCase();
        if (_seenKeysR.has(k)) return false;
        if (l && _seenLabelsR.has(l)) return false;
        const addrs = _kaR[k] || [];
        if (addrs.some(a => _seenAddrsR.has(a))) return false;
        _seenKeysR.add(k);
        if (l) _seenLabelsR.add(l);
        for (const a of addrs) _seenAddrsR.add(a);
        return true;
      });
    }
    bs.selectedBk = null;
    bs.fg = ctx.state.settings?.overview_iso_floor_gap ?? 150;
    bs.hg = ctx.state.settings?.overview_iso_horiz_gap ?? 0;
    bs.focusIdx = 0;
    _fg = bs.fg; _hg = bs.hg;
    gapSlider.value = String(bs.fg); gapLbl.textContent = String(bs.fg);
    hgSlider.value = String(bs.hg); hgLbl.textContent = String(bs.hg);
    focusSlider.value = "0"; focusLbl.textContent = "All floors";
    statusLbl.textContent = "Reset \u2713";
    setTimeout(() => { statusLbl.textContent = ""; }, 2000);
    _refreshSVG();
    _refreshInfo();
    _refreshDirtyLabel();
    _refreshBeaconList();
  });

  ctrlRow.appendChild(saveBtn);
  ctrlRow.appendChild(resetBtn);

  // Auto-calibrate toggle
  const autoCal = ctx.state.settings?.beacon_auto_calibrate !== false;
  const toggleLbl = document.createElement("span");
  toggleLbl.style.cssText = "font-size:12px;color:#94a3b8;margin-left:4px";
  toggleLbl.textContent = "Auto-Cal:";
  const toggleBtn = document.createElement("button");
  toggleBtn.className = "btn inline";
  toggleBtn.style.cssText = `font-size:11px;padding:2px 10px;${autoCal ? "background:#5eead4;color:#071008;border-color:#5eead4;" : ""}`;
  toggleBtn.textContent = autoCal ? "ON" : "OFF";
  toggleBtn.addEventListener("click", () => {
    ctx.actions.settingsSet({ beacon_auto_calibrate: !autoCal });
  });
  ctrlRow.appendChild(toggleLbl);
  ctrlRow.appendChild(toggleBtn);

  ctrlRow.appendChild(statusLbl);

  // Dirty indicator
  const dirtyLbl = document.createElement("span");
  dirtyLbl.style.cssText = "font-size:11px;color:#f59e0b;font-weight:600;margin-left:auto";
  function _refreshDirtyLabel() {
    const n = Object.keys(bs.dirtyMaps).filter(id => bs.dirtyMaps[id]).length;
    dirtyLbl.textContent = n ? `${n} map${n > 1 ? "s" : ""} unsaved` : "";
    if (n) { saveBtn.classList.add("save-pulse"); saveBtn.textContent = "\ud83d\udcbe Save"; }
    else { saveBtn.classList.remove("save-pulse"); saveBtn.textContent = "Save"; }
  }
  _refreshDirtyLabel();
  ctrlRow.appendChild(dirtyLbl);

  // ── DOM: SVG container ──────────────────────────────────────────────────────
  const isoWrap = document.createElement("div");
  isoWrap.style.cssText = "position:relative;margin-top:6px";

  const isoDiv = document.createElement("div");
  isoDiv.style.cssText = "overflow:auto;border-radius:8px;background:#071008;padding:8px;touch-action:none";
  isoDiv.innerHTML = buildBeaconSVG(_getFocusZ(bs.focusIdx));

  // Hover tooltip
  const tipEl = document.createElement("div");
  tipEl.style.cssText = "position:absolute;top:8px;left:8px;background:rgba(7,16,8,0.92);" +
    "border:1px solid #2d6a4f;border-radius:8px;padding:6px 10px;font-size:11px;color:#a7f3d0;" +
    "pointer-events:none;white-space:pre-line;max-width:min(260px,calc(100vw - 40px));z-index:5;display:none;" +
    "font-family:ui-monospace,SFMono-Regular,Consolas,monospace;line-height:1.5";
  isoWrap.appendChild(isoDiv);
  isoWrap.appendChild(tipEl);

  isoDiv.addEventListener("mouseover", e => {
    const g = e.target.closest("[data-tip]");
    if (g) {
      tipEl.textContent = "";
      g.getAttribute("data-tip").split("|").forEach((line, i) => {
        if (i > 0) tipEl.appendChild(document.createElement("br"));
        tipEl.appendChild(document.createTextNode(line));
      });
      tipEl.style.display = "block";
    }
  });
  isoDiv.addEventListener("mouseout", e => {
    const g = e.target.closest("[data-tip]");
    if (!g || !isoDiv.contains(e.relatedTarget && e.relatedTarget.closest && e.relatedTarget.closest("[data-tip]")))
      tipEl.style.display = "none";
  });

  // ── Drag interaction ────────────────────────────────────────────────────────
  // Document-level listeners (always fire). bs._dragging prevents DOM destruction.
  let _didDrag = false;

  isoDiv.addEventListener("pointerdown", e => {
    const g = e.target.closest("[data-bk-id]");
    if (!g) return;
    e.preventDefault();
    e.stopPropagation();
    const mapId = g.getAttribute("data-map-id");
    const bkId  = g.getAttribute("data-bk-id");
    const z     = Number(g.getAttribute("data-z") || 0);
    bs.selectedBk = { mapId, bkId };
    _didDrag = false;
    isoDiv.style.cursor = "grabbing";
    _refreshInfo();

    const draft = bs.draftBeacons[mapId];
    if (!draft) { console.warn("[PadSpan] bk drag: no draft for map", mapId); isoDiv.style.cursor = ""; return; }
    let bkObj = draft.find(b => b.id === bkId);
    if (!bkObj) bkObj = draft.find(b => (b.key || "") === bkId || (b.label || "") === bkId);
    if (!bkObj) { console.warn("[PadSpan] bk drag: no beacon", bkId, "in draft", draft.map(b => b.id)); isoDiv.style.cursor = ""; return; }
    const xf = mapXforms[mapId];
    if (!xf) { console.warn("[PadSpan] bk drag: no xform for map", mapId); isoDiv.style.cursor = ""; return; }
    const [origWx, origWy] = xf.mapPt(bkObj.x, bkObj.y);
    const [origPx, origPy] = iso(origWx, origWy, z);

    bs._dragging = true;

    const onMove = (ev) => {
      ev.preventDefault();
      _didDrag = true;
      const svgNode = isoDiv.querySelector("svg");
      if (!svgNode) return;
      const ctm = svgNode.getScreenCTM();
      if (!ctm) return;
      const inv = ctm.inverse();
      const sx = ev.clientX * inv.a + ev.clientY * inv.c + inv.e;
      const sy = ev.clientX * inv.b + ev.clientY * inv.d + inv.f;
      const [wx, wy] = invIso(sx, sy, z);
      const [nx, ny] = xf.invMapPt(wx, wy);
      bkObj.x = nx;
      bkObj.y = ny;
      bs.dirtyMaps[mapId] = true;
      const [newWx, newWy] = xf.mapPt(nx, ny);
      const [newPx, newPy] = iso(newWx, newWy, z);
      g.setAttribute("transform", `translate(${newPx - origPx},${newPy - origPy})`);
    };

    const onUp = (ev) => {
      document.removeEventListener("pointermove", onMove, true);
      document.removeEventListener("pointerup", onUp, true);
      document.removeEventListener("pointercancel", onUp, true);
      bs._dragging = false;
      isoDiv.style.cursor = "";
      if (_didDrag) {
        const mapObj = maps_list.find(m => m.id === mapId);
        if (mapObj) bkObj.room = _detectRoom(bkObj.x, bkObj.y, mapObj) || bkObj.room || "";
        // Auto-save position and start live timer
        _autoSaveAndStartTimer(bkObj, mapId);
      }
      _refreshSVG();
      _refreshInfo();
      _refreshDirtyLabel();
    };

    document.addEventListener("pointermove", onMove, true);
    document.addEventListener("pointerup", onUp, true);
    document.addEventListener("pointercancel", onUp, true);
  });

  // Click to select (without drag)
  isoDiv.addEventListener("click", e => {
    if (_didDrag) { _didDrag = false; return; }
    const g = e.target.closest("[data-bk-id]");
    if (g) {
      bs.selectedBk = { mapId: g.getAttribute("data-map-id"), bkId: g.getAttribute("data-bk-id") };
      _refreshSVG();
      _refreshInfo();
    }
  });

  // Helper: commit placement of a pending beacon onto a specific map at (nx, ny)
  function _placeBeaconOnMap(m, nx, ny) {
    const pd = bs.pendingPlace;
    // If relocating, update the existing marker's position (preserves all calibration data)
    if (bs._relocating) {
      const { bkId: oldId, mapId: oldMapId } = bs._relocating;
      // Stop any active timer so a fresh capture starts
      if (bs._liveTimers[oldId]) {
        const t = bs._liveTimers[oldId];
        if (t.timer) clearTimeout(t.timer);
        if (t.pollTimer) clearTimeout(t.pollTimer);
        delete bs._liveTimers[oldId];
      }
      bs._liveBeaconKeys.delete(pd.key);
      // Find the existing draft entry and update its position
      const oldDraft = (bs.draftBeacons[oldMapId] || []).find(b => b.id === oldId);
      if (oldDraft) {
        // If placing on a different map, move the entry across maps
        if (oldMapId !== m.id) {
          bs.draftBeacons[oldMapId] = (bs.draftBeacons[oldMapId] || []).filter(b => b.id !== oldId);
          bs.dirtyMaps[oldMapId] = true;
          oldDraft.x = nx;
          oldDraft.y = ny;
          if (!bs.draftBeacons[m.id]) bs.draftBeacons[m.id] = [];
          bs.draftBeacons[m.id].push(oldDraft);
        } else {
          oldDraft.x = nx;
          oldDraft.y = ny;
        }
        bs.dirtyMaps[m.id] = true;
        bs.selectedBk = { mapId: m.id, bkId: oldId };
        bs.pendingPlace = null;
        bs._confirming = false;
        bs._relocating = null;
        _autoSaveAndStartTimer(oldDraft, m.id);
        _refreshSVG();
        _refreshInfo();
        _refreshDirtyLabel();
        _refreshBeaconList();
        _refreshAvailable();
        _refreshPlaceBanner();
        return;
      }
      bs._relocating = null;
    }
    const newBk = {
      id: "bk_" + Date.now().toString(16),
      label: pd.label || pd.key || "",
      key: pd.key || "",
      kind: pd.kind || "ble",
      x: nx,
      y: ny,
    };
    if (!bs.draftBeacons[m.id]) bs.draftBeacons[m.id] = [];
    bs.draftBeacons[m.id].push(newBk);
    bs.dirtyMaps[m.id] = true;
    bs.selectedBk = { mapId: m.id, bkId: newBk.id };
    bs.pendingPlace = null;
    bs._confirming = false;
    // Auto-save position and start live timer
    _autoSaveAndStartTimer(newBk, m.id);
    _refreshSVG();
    _refreshInfo();
    _refreshDirtyLabel();
    _refreshBeaconList();
    _refreshAvailable();
    _refreshPlaceBanner();
  }

  // Double-click to place a pending beacon
  isoDiv.addEventListener("dblclick", e => {
    if (!bs.pendingPlace) return;
    const svgNode = isoDiv.querySelector("svg");
    if (!svgNode) return;
    const ctm = svgNode.getScreenCTM();
    if (!ctm) return;
    const inv2 = ctm.inverse();
    const sx = e.clientX * inv2.a + e.clientY * inv2.c + inv2.e;
    const sy = e.clientX * inv2.b + e.clientY * inv2.d + inv2.f;

    const candidates = [];
    for (let i = sortedIsoLevels.length - 1; i >= 0; i--) {
      const z = sortedIsoLevels[i];
      const [wx, wy] = invIso(sx, sy, z);
      const group = byLevel.get(z) || [];
      for (const m2 of group) {
        const xf2 = mapXforms[m2.id];
        if (!xf2) continue;
        const [nx2, ny2] = xf2.invMapPt(wx, wy);
        if (nx2 >= 0 && nx2 <= 1 && ny2 >= 0 && ny2 <= 1) {
          candidates.push({ m: m2, nx: nx2, ny: ny2, z });
        }
      }
    }
    if (candidates.length === 0) return;
    if (candidates.length === 1) {
      _placeBeaconOnMap(candidates[0].m, candidates[0].nx, candidates[0].ny);
      return;
    }
    // Disambiguation popup for overlapping maps
    bs._confirming = true;
    const popup = document.createElement("div");
    popup.style.cssText = "position:absolute;z-index:10;background:#0d1f14;border:2px solid #f59e0b;border-radius:10px;padding:10px 14px;min-width:180px;box-shadow:0 4px 20px rgba(0,0,0,0.5)";
    const rect = isoDiv.getBoundingClientRect();
    popup.style.left = Math.min(e.clientX - rect.left + 8, rect.width - 200) + "px";
    popup.style.top = Math.min(e.clientY - rect.top + 8, rect.height - 100) + "px";
    const title2 = document.createElement("div");
    title2.style.cssText = "font-size:12px;font-weight:700;color:#f59e0b;margin-bottom:8px";
    title2.textContent = "Which map is it on right now?";
    popup.appendChild(title2);

    // Group candidates by floor for floor-level shortcuts
    const fl2 = ctx.state.model?.floors || [];
    const candByFloor2 = new Map();
    for (const c of candidates) {
      if (!candByFloor2.has(c.z)) candByFloor2.set(c.z, []);
      candByFloor2.get(c.z).push(c);
    }
    const floorZs2 = [...candByFloor2.keys()].sort((a, b) => a - b);
    if (floorZs2.length > 1 || (floorZs2.length === 1 && candByFloor2.get(floorZs2[0]).length > 1)) {
      for (const z of floorZs2) {
        const floorObj = fl2.find(f => f.level === z);
        const floorName = floorObj ? (floorObj.name || `Floor ${z}`) : `Floor ${z}`;
        const floorCands = candByFloor2.get(z);
        const btn = document.createElement("button");
        btn.className = "btn inline";
        btn.style.cssText = "display:block;width:100%;text-align:left;padding:6px 10px;margin-bottom:4px;font-size:12px;color:#fbbf24;border-color:#92400e;cursor:pointer;font-weight:600";
        btn.textContent = `${floorName}`;
        btn.addEventListener("click", () => {
          if (isoWrap.contains(popup)) isoWrap.removeChild(popup);
          const best = floorCands.slice().sort((a, b) => {
            const ra = (bs.draftBeacons[a.m.id] || []).length + Object.keys(a.m.room_bounds || {}).length;
            const rb = (bs.draftBeacons[b.m.id] || []).length + Object.keys(b.m.room_bounds || {}).length;
            return rb - ra;
          })[0];
          _placeBeaconOnMap(best.m, best.nx, best.ny);
        });
        popup.appendChild(btn);
      }
      const sep2 = document.createElement("div");
      sep2.style.cssText = "border-top:1px solid #2d6a4f;margin:6px 0;opacity:0.5";
      popup.appendChild(sep2);
      const subTitle2 = document.createElement("div");
      subTitle2.style.cssText = "font-size:10px;color:#94a3b8;margin-bottom:4px";
      subTitle2.textContent = "Or pick a specific map:";
      popup.appendChild(subTitle2);
    }

    for (const c of candidates) {
      const floorObj = fl2.find(f => f.level === c.z);
      const floorName = floorObj ? (floorObj.name || `L${c.z}`) : `L${c.z}`;
      const btn = document.createElement("button");
      btn.className = "btn inline";
      btn.style.cssText = "display:block;width:100%;text-align:left;padding:6px 10px;margin-bottom:4px;font-size:12px;color:#a7f3d0;border-color:#2d6a4f;cursor:pointer";
      btn.textContent = `${c.m.name || c.m.id} (${floorName})`;
      btn.addEventListener("click", () => {
        if (isoWrap.contains(popup)) isoWrap.removeChild(popup);
        _placeBeaconOnMap(c.m, c.nx, c.ny);
      });
      popup.appendChild(btn);
    }
    const cancelBtn2 = document.createElement("button");
    cancelBtn2.className = "btn inline";
    cancelBtn2.style.cssText = "display:block;width:100%;text-align:center;padding:4px 10px;font-size:11px;color:#94a3b8;border-color:#94a3b840;margin-top:4px;cursor:pointer";
    cancelBtn2.textContent = "Cancel";
    cancelBtn2.addEventListener("click", () => {
      bs._confirming = false;
      if (isoWrap.contains(popup)) isoWrap.removeChild(popup);
    });
    popup.appendChild(cancelBtn2);
    isoWrap.appendChild(popup);
  });

  // ── Auto-save beacon position to map + start live timer ──────────────────
  async function _autoSaveAndStartTimer(bkObj, mapId) {
    const origMap = maps_list.find(m => m.id === mapId);
    if (!origMap) return;
    try {
      bs.dirtyMaps[mapId] = false;
      _refreshDirtyLabel();
    } catch (e) {
      console.warn("[PadSpan] auto-save failed:", e);
    }
    const autoCal = ctx.state.settings?.beacon_auto_calibrate !== false;
    if (autoCal) _startLiveTimer(bkObj, mapId);
  }

  // ── Per-beacon live timer: 60s independent RSSI capture ────────────────
  function _startLiveTimer(bk, mapId) {
    const bkId = bk.id;
    // If timer already running for this beacon, clear and restart
    if (bs._liveTimers[bkId]) {
      const old = bs._liveTimers[bkId];
      if (old.timer) clearTimeout(old.timer);
      if (old.pollTimer) clearTimeout(old.pollTimer);
      delete bs._liveTimers[bkId];
    }
    // Remove from live tracking — back to calibrating
    bs._liveBeaconKeys.delete(bk.key);
    // Resolve the beacon address + all known addresses ONCE at timer start.
    // This avoids re-resolution failures if the object temporarily drops out of a
    // refreshed snapshot (dedup, cache timing, iBeacon MAC rotation, etc.).
    const _initSnap = (ctx.state.live && ctx.state.live.snapshot) || null;
    const _initAddr = _resolveBeaconAddr(bk.key, _initSnap);
    const _initObj = (_initSnap?.objects?.list || []).find(o => o.key === bk.key);
    const _allKnownAddrs = new Set();
    if (_initAddr) _allKnownAddrs.add(_initAddr.toUpperCase());
    if (_initObj) {
      if (_initObj.address) _allKnownAddrs.add(_initObj.address.toUpperCase());
      for (const a of (_initObj.all_addresses || [])) { if (a) _allKnownAddrs.add(String(a).toUpperCase()); }
    }
    const _initCanonical = _initObj?.canonical_id || "";

    const entry = {
      endTime: Date.now() + 60000,
      startTime: Date.now(),
      mapId,
      bk: { ...bk },
      readings: {},
      warning: "",  // inline warning text (updated on each poll)
      _resolvedAddr: _initAddr,        // stable address for the entire capture
      _allAddrs: _allKnownAddrs,       // all known MACs (handles rotation)
      _canonical: _initCanonical,      // for private_ble matching
    };
    bs._liveTimers[bkId] = entry;
    _refreshTimerRow();
    _refreshSVG();

    // 1s poll loop — accumulate RSSI samples
    const poll = async () => {
      if (!bs._liveTimers[bkId]) return;
      try { await ctx.actions.refreshSnapshotQuiet(); } catch (_) { /**/ }
      const snap2 = (ctx.state.live && ctx.state.live.snapshot) || null;

      // Try to update known addresses from refreshed snapshot (picks up rotated MACs)
      const freshObj = snap2 ? (snap2.objects?.list || []).find(o => o.key === entry.bk.key) : null;
      if (freshObj) {
        if (freshObj.address) entry._allAddrs.add(freshObj.address.toUpperCase());
        for (const a of (freshObj.all_addresses || [])) { if (a) entry._allAddrs.add(String(a).toUpperCase()); }
      }

      // Use the stable resolved address, falling back to fresh resolution
      const addr = entry._resolvedAddr || _resolveBeaconAddr(entry.bk.key, snap2);
      if (addr) {
        const { perRadio } = _findBeaconAds(snap2, addr);
        // Also directly scan advertisements for any of our known addresses
        // (handles cases where _findBeaconAds resolution path fails)
        if (entry._allAddrs.size > 0) {
          for (const ad of (snap2?.ble?.advertisements || [])) {
            const adAddr = (ad.address || "").toUpperCase();
            const src = String(ad.source || "");
            if (!src || typeof ad.rssi !== "number") continue;
            if (entry._allAddrs.has(adAddr) || (entry._canonical && ad._xref && ad._xref.canonical_id === entry._canonical)) {
              // Prefer freshest ad per radio (lowest age_s), not strongest
              const cur = perRadio[src];
              const adAge = (typeof ad.age_s === "number") ? ad.age_s : Infinity;
              const curAge = cur && (typeof cur.age_s === "number") ? cur.age_s : Infinity;
              if (!cur || adAge < curAge || (adAge === curAge && ad.rssi > (cur.rssi || -200))) {
                perRadio[src] = { name: cur?.name || src, rssi: ad.rssi, age_s: ad.age_s };
              }
            }
          }
        }
        const _last = entry._lastSample || (entry._lastSample = {});
        for (const [src, info] of Object.entries(perRadio)) {
          if (!_acceptCalSample(_last, src, info)) continue;
          if (!entry.readings[src]) {
            entry.readings[src] = { name: info.name || src, samples: [] };
          } else if (info.name && info.name !== src) {
            entry.readings[src].name = info.name;
          }
          entry.readings[src].samples.push(info.rssi);
        }
      }
      // Check for warning conditions
      const elapsed = Date.now() - entry.startTime;
      const scannerCount = Object.keys(entry.readings).length;
      if (scannerCount === 0 && elapsed > 10000) {
        entry.warning = "\u26a0 No signal \u2014 beacon invisible to all scanners";
      } else if (scannerCount === 1 && elapsed > 15000) {
        entry.warning = "\u26a0 Single scanner \u2014 only 1 scanner detecting this beacon";
      } else if (scannerCount > 0) {
        const allWeak = Object.values(entry.readings).every(r => {
          if (!r.samples.length) return true;
          const mean = r.samples.reduce((a, b) => a + b, 0) / r.samples.length;
          return mean < -90;
        });
        if (allWeak && elapsed > 5000) {
          entry.warning = "\u26a0 Weak signal \u2014 all scanners below -90 dBm";
        } else {
          // Check for wild variance on any scanner
          let highVar = "";
          for (const [src, rd] of Object.entries(entry.readings)) {
            if (rd.samples.length < 5) continue;
            const mean = rd.samples.reduce((a, b) => a + b, 0) / rd.samples.length;
            const variance = rd.samples.reduce((a, v) => a + (v - mean) ** 2, 0) / rd.samples.length;
            if (Math.sqrt(variance) > 15) { highVar = rd.name || src; break; }
          }
          entry.warning = highVar ? `\u26a0 High variance on ${highVar}` : "";
        }
      } else {
        entry.warning = "";
      }

      _refreshTimerRow();
      _refreshSVG();
      // Continue polling if time remains
      if (Date.now() < entry.endTime && bs._liveTimers[bkId]) {
        const nextIn = Math.min(POLL_MS, entry.endTime - Date.now());
        entry.pollTimer = setTimeout(poll, nextIn);
      }
    };
    entry.pollTimer = setTimeout(poll, POLL_MS);

    // 60s timer → save calibration point and clean up
    entry.timer = setTimeout(async () => {
      if (!bs._liveTimers[bkId]) return;
      if (entry.pollTimer) clearTimeout(entry.pollTimer);
      // Save calibration point — weight increases with each round
      const readingCount = Object.keys(entry.readings).length;
      if (readingCount === 0) {
        ctx.toast(`No signal: ${entry.bk.label || entry.bk.key} — no scanners detected this beacon during 60s capture`, "warning");
      }
      if (readingCount > 0) {
        const bkKey = entry.bk.key;
        bs._calibRounds[bkKey] = (bs._calibRounds[bkKey] || 0) + 1;
        const round = bs._calibRounds[bkKey];
        const weight = Math.min(5.0, 1.0 + (round - 1) * 0.5);
        const mapObj = maps_list.find(m => m.id === entry.mapId);
        const room = mapObj ? _detectRoom(entry.bk.x, entry.bk.y, mapObj) : "";
        const snap3 = (ctx.state.live && ctx.state.live.snapshot) || null;
        const deviceId = _resolveBeaconAddr(entry.bk.key, snap3);

        // ── Hard relocation (faulty data correction) ─────────────────────────
        // After 3 consecutive POSITION CHANGES within 6 minutes, offer to
        // purge old data.  Only moves where the beacon actually changed
        // position count — repeated calibrations at the same spot are normal
        // accuracy-building and must NOT trigger purge.
        if (!bs._relocHistory) bs._relocHistory = {};
        if (!bs._relocHistory[bkKey]) bs._relocHistory[bkKey] = [];
        const _lastReloc = bs._relocHistory[bkKey][bs._relocHistory[bkKey].length - 1];
        const _MOVE_THRESHOLD = 0.02; // minimum position change to count as a move
        const _moved = !_lastReloc ||
          Math.abs(entry.bk.x - _lastReloc.x) > _MOVE_THRESHOLD ||
          Math.abs(entry.bk.y - _lastReloc.y) > _MOVE_THRESHOLD ||
          entry.mapId !== _lastReloc.mapId;
        if (_moved) {
          bs._relocHistory[bkKey].push({
            x: entry.bk.x, y: entry.bk.y, mapId: entry.mapId, ts: Date.now(),
          });
        }

        const hist = bs._relocHistory[bkKey];
        const RELOC_ROUNDS = 3;
        let doRelocation = false;
        if (hist.length >= RELOC_ROUNDS) {
          const recent = hist.slice(-RELOC_ROUNDS);
          const timespanMs = recent[recent.length - 1].ts - recent[0].ts;
          doRelocation = timespanMs < 360000;  // 6 minutes
        }

        if (!bs._relocSavedIds) bs._relocSavedIds = {};
        if (!bs._relocSavedIds[bkKey]) bs._relocSavedIds[bkKey] = [];

        if (doRelocation) {
          const confirmPurge = confirm(
            `This is the 3rd consecutive calibration for "${entry.bk.label || bkKey}" within a few minutes.\n\n` +
            `This will REPLACE all previous calibration data for this beacon with the new readings.\n\n` +
            `Choose OK to replace old data (hard relocation).\n` +
            `Choose Cancel to keep old data and just add this as another data point.`
          );
          if (!confirmPurge) doRelocation = false;
        }

        if (doRelocation) {
          const protectedIds = new Set(bs._relocSavedIds[bkKey] || []);
          try {
            const calData = await ctx.actions.calibrationGet();
            const allPts = calData?.points || [];
            const myDev = (deviceId || "").toUpperCase();
            const myLbl = (entry.bk.label || "").toUpperCase();
            const myKey = bkKey.toUpperCase();
            let purged = 0;
            for (const pt of allPts) {
              if (protectedIds.has(pt.id)) continue;
              const ptDev = (pt.device_id || "").toUpperCase();
              const ptLbl = (pt.label || "").toUpperCase();
              const isMatch =
                (ptDev && myDev && ptDev === myDev) ||
                (ptDev && myKey && ptDev === myKey) ||
                (ptLbl && myLbl && ptLbl === myLbl) ||
                (ptLbl && myKey && ptLbl === myKey);
              if (!isMatch) continue;
              try {
                await ctx.actions.calibrationDeletePoint(pt.id);
                purged++;
              } catch (_) { /**/ }
            }
            if (purged > 0) {
              console.log(`[PadSpan] Hard relocation: purged ${purged} old point(s) for ${bkKey}`);
            }
          } catch (e) {
            console.warn("[PadSpan] relocation purge failed:", e);
          }
        }

        // Transform readings object → scanner_readings array for backend
        const scannerReadings = Object.entries(entry.readings).map(([source, rd]) => ({
          source,
          name: rd.name || source,
          rssi_samples: rd.samples || [],
        }));
        const point = {
          map_id: entry.mapId,
          x_frac: entry.bk.x,
          y_frac: entry.bk.y,
          room: room,
          device_id: deviceId,
          label: entry.bk.label || entry.bk.key || "",
          scanner_readings: scannerReadings,
          weight: doRelocation ? 5.0 : weight,
        };
        const _tActiveRadios = scannerReadings.filter(r => (r.rssi_samples || []).length > 0);
        const _tTotalSamples = scannerReadings.reduce((s, r) => s + (r.rssi_samples || []).length, 0);
        try {
          const saved = await ctx.actions.calibrationSavePoint(point);
          if (saved?.point?.id) {
            bs._relocSavedIds[bkKey].push(saved.point.id);
          } else if (saved?.id) {
            bs._relocSavedIds[bkKey].push(saved.id);
          }
          const _bkName = entry.bk.label || entry.bk.key;
          const _scanInfo = `${_tActiveRadios.length} scanner(s), ${_tTotalSamples} samples`;
          const _roomInfo = room ? `, room: ${room}` : ", room: (undetected)";
          const _warns = [];
          if (_tActiveRadios.length === 1) _warns.push("1 scanner only");
          if (_tTotalSamples < 10) _warns.push("low samples");
          if (!room) _warns.push("no room detected");
          const _warnStr = _warns.length ? " | " + _warns.join(", ") : "";
          if (doRelocation) {
            ctx.toast(`HARD RELOCATION: ${_bkName} — old data replaced. ${_scanInfo}${_roomInfo}${_warnStr}`);
          } else {
            const weightLabel = round > 1 ? ` (round ${round}, ${weight.toFixed(1)}x)` : "";
            ctx.toast(`Saved: ${_bkName}${weightLabel} — ${_scanInfo}${_roomInfo}${_warnStr}`);
          }
        } catch (e) {
          const _errMsg = (e && e.message) || String(e);
          ctx.toast(`SAVE FAILED: ${entry.bk.label || entry.bk.key} — ${_errMsg}`, "error");
          console.error("[PadSpan] live timer save failed:", e);
        }
        if (doRelocation) {
          try {
            ctx.state.calibration = await ctx.actions.calibrationGet();
          } catch (_) { /**/ }
          try { await ctx.actions.objectEvict(bkKey); } catch (_) { /**/ }
          if (deviceId && deviceId !== bkKey) {
            try { await ctx.actions.objectEvict(deviceId); } catch (_) { /**/ }
          }
          bs._lastRelocation = {
            key: bkKey,
            label: entry.bk.label || bkKey,
            time: Date.now(),
          };
          _refreshInfo();
          bs._calibRounds[bkKey] = 0;
          bs._relocHistory[bkKey] = [];
          bs._relocSavedIds[bkKey] = [];
        }
      }
      // Mark beacon as live — switches to estimated position rendering
      bs._liveBeaconKeys.add(entry.bk.key);
      // Show green "live" briefly, then remove timer entry
      entry.endTime = 0;
      _refreshTimerRow();
      _refreshSVG();
      setTimeout(() => {
        delete bs._liveTimers[bkId];
        _refreshTimerRow();
        _refreshSVG();
      }, 2500);
    }, 60000);
  }

  // ── Helper: rebuild SVG without losing scroll ─────────────────────────────
  function _refreshSVG() {
    if (bs._dragging) return; // Don't rebuild SVG mid-drag
    const scrollTop = isoDiv.scrollTop, scrollLeft = isoDiv.scrollLeft;
    isoDiv.innerHTML = buildBeaconSVG(_getFocusZ(bs.focusIdx));
    isoDiv.scrollTop = scrollTop;
    isoDiv.scrollLeft = scrollLeft;
  }

  // ── Placement banner ──────────────────────────────────────────────────────
  const placeBanner = document.createElement("div");
  placeBanner.style.cssText = "display:none;background:#1a200e;border:2px solid #f59e0b;border-radius:8px;padding:8px 14px;font-size:12px;color:#fef3c7;text-align:center";
  function _refreshPlaceBanner() {
    if (bs.pendingPlace) {
      const nm = bs.pendingPlace.label || bs.pendingPlace.key || "beacon";
      const verb = bs._relocating ? "relocate" : "mark the current location of";
      placeBanner.innerHTML = `<b style="color:#f59e0b">Double-click</b> on the 3D map to ${verb} <b style="color:#5eead4">${_esc(nm)}</b> &nbsp; <span style="color:#94a3b8;cursor:pointer;text-decoration:underline" id="_cancelBkPlace">Cancel</span>`;
      placeBanner.style.display = "block";
      const cancelEl = placeBanner.querySelector("#_cancelBkPlace");
      if (cancelEl) cancelEl.addEventListener("click", () => {
        bs.pendingPlace = null;
        bs._relocating = null;
        _refreshPlaceBanner();
        _refreshAvailable();
      });
    } else {
      placeBanner.style.display = "none";
    }
  }
  _refreshPlaceBanner();

  // ── Move beacon between maps ───────────────────────────────────────────
  function _moveBeaconToMap(bk, fromMapId, toMapId) {
    // Remove from source map
    bs.draftBeacons[fromMapId] = (bs.draftBeacons[fromMapId] || []).filter(b => b.id !== bk.id);
    bs.dirtyMaps[fromMapId] = true;
    // Find room centroid on target map, else center
    const toMap = maps_list.find(m => m.id === toMapId);
    const srcObj = (snap?.objects?.list || []).find(o => o.key === bk.key);
    const roomName = srcObj?.room || "";
    const centroid = roomName && toMap ? _roomCentroid(roomName, toMap) : null;
    const nx = centroid ? centroid[0] : 0.5;
    const ny = centroid ? centroid[1] : 0.5;
    // Add to target map
    const moved = { ...bk, x: nx, y: ny };
    if (!bs.draftBeacons[toMapId]) bs.draftBeacons[toMapId] = [];
    bs.draftBeacons[toMapId].push(moved);
    bs.dirtyMaps[toMapId] = true;
    bs.selectedBk = { mapId: toMapId, bkId: moved.id };
    _refreshSVG();
    _refreshInfo();
    _refreshDirtyLabel();
    _refreshBeaconList();
    _refreshAvailable();
  }

  // ── Selected beacon info panel ──────────────────────────────────────────
  const infoCard = document.createElement("div");
  infoCard.style.cssText = "background:#0d1f14;border:1px solid #1b3526;border-radius:8px;padding:10px 14px;font-size:12px;color:#a7f3d0;min-height:24px";
  function _refreshInfo() {
    if (!bs.selectedBk) {
      infoCard.textContent = "Click a teal diamond to select it, then drag to mark its current location.";
      return;
    }
    const draft = bs.draftBeacons[bs.selectedBk.mapId] || [];
    const bk = draft.find(b => b.id === bs.selectedBk.bkId);
    if (!bk) { infoCard.textContent = "Beacon not found."; return; }
    const mapObj = maps_list.find(m => m.id === bs.selectedBk.mapId);
    const detectedRoom = mapObj ? _detectRoom(bk.x, bk.y, mapObj) : "";
    const obj = (snap?.objects?.list || []).find(o => o.key === bk.key);
    const lastRssi = obj?.rssi != null ? `${obj.rssi} dBm` : "\u2014";
    infoCard.innerHTML = "";
    const infoLine = document.createElement("div");
    infoLine.style.cssText = "display:flex;align-items:center;gap:0;flex-wrap:wrap";
    const _bkFloor = (() => { const fid = mapObj?.floor_id || "main"; const f = (ctx.state.model?.floors||[]).find(f2=>f2.id===fid); return f ? f.name : fid; })();
    const _bkFab = (ctx.state.model?.beacon_positions_m || {})[bk.key];
    const _bkPos = _bkFab ? `${_bkFab.x_m?.toFixed(1)}m, ${_bkFab.y_m?.toFixed(1)}m` : `${(bk.x*100).toFixed(1)}%, ${(bk.y*100).toFixed(1)}%`;
    const _bkRoom = _bkFab?.room || detectedRoom;
    const lines = [
      `<b style="color:#5eead4">${_esc(bk.label || bk.key)}</b>`,
      `Floor: ${_esc(_bkFloor)}`,
      `Room: ${_esc(_bkRoom || "\u2014")}`,
      `Position: ${_bkPos}`,
      `RSSI: ${lastRssi}`,
      `Kind: ${_esc(bk.kind || "ble")}`,
    ];
    infoLine.innerHTML = `<span>${lines.join(" &nbsp;\u00b7&nbsp; ")}</span>`;
    const posHelp = document.createElement("button");
    posHelp.style.cssText = "background:none;border:1px solid #4a6052;color:#94a3b8;cursor:pointer;font-size:11px;font-weight:700;width:18px;height:18px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;margin-left:6px;padding:0;flex-shrink:0;line-height:1";
    posHelp.textContent = "?";
    posHelp.title = "What do these percentages mean?";
    posHelp.addEventListener("click", (ev) => {
      ev.stopPropagation();
      _showPosHelp(ctx);
    });
    infoLine.appendChild(posHelp);
    infoCard.appendChild(infoLine);
    // Server estimate row (helps user see if calibration is converging)
    const isLive = bs._liveBeaconKeys.has(bk.key);
    if (isLive && obj) {
      const srvParts = [];
      if (typeof obj.x_frac === "number" && typeof obj.y_frac === "number") {
        srvParts.push(`x ${(obj.x_frac * 100).toFixed(1)}%, y ${(obj.y_frac * 100).toFixed(1)}%`);

        if (obj.knn_confidence != null) srvParts.push(`${(obj.knn_confidence * 100).toFixed(0)}% conf`);
        if (obj.room) srvParts.push(`room: ${obj.room}`);
      }
      if (srvParts.length) {
        const srvLine = document.createElement("div");
        srvLine.style.cssText = "font-size:11px;color:#f59e0b;margin-top:4px";
        srvLine.textContent = `Server estimate: ${srvParts.join(" · ")}`;
        infoCard.appendChild(srvLine);
      }
    }
    // Move-to-map control
    const otherMaps = maps_list.filter(m => m.id !== bs.selectedBk.mapId);
    if (otherMaps.length) {
      const moveRow = document.createElement("div");
      moveRow.style.cssText = "margin-top:8px;display:flex;align-items:center;gap:8px";
      const moveLbl = document.createElement("span");
      moveLbl.style.cssText = "font-size:11px;color:#94a3b8";
      moveLbl.textContent = "Move to:";
      moveRow.appendChild(moveLbl);
      const moveSel = document.createElement("select");
      moveSel.style.cssText = "font-size:11px;padding:2px 6px;border-radius:4px;background:#071008;color:#a7f3d0;border:1px solid #2d6a4f";
      const defOpt = document.createElement("option");
      defOpt.value = ""; defOpt.textContent = "\u2014 select map \u2014";
      moveSel.appendChild(defOpt);
      for (const m of otherMaps) {
        const fl = ctx.state.model?.floors || [];
        const floorObj = fl.find(f => f.level === (m.stack?.z_level ?? 0));
        const floorName = floorObj ? (floorObj.name || `L${m.stack?.z_level ?? 0}`) : "";
        const opt = document.createElement("option");
        opt.value = m.id;
        opt.textContent = `${m.name || m.id}${floorName ? ` (${floorName})` : ""}`;
        moveSel.appendChild(opt);
      }
      moveSel.addEventListener("change", () => {
        if (!moveSel.value) return;
        _moveBeaconToMap(bk, bs.selectedBk.mapId, moveSel.value);
      });
      moveRow.appendChild(moveSel);
      infoCard.appendChild(moveRow);
    }
    // Hard relocation warning banner
    if (bs._lastRelocation && bs._lastRelocation.key === bk.key) {
      const elapsed = Date.now() - bs._lastRelocation.time;
      if (elapsed < 300000) {  // show for 5 minutes
        const relocBanner = document.createElement("div");
        relocBanner.style.cssText = "margin-top:8px;background:#3b1219;border:2px solid #f87171;border-radius:8px;padding:8px 12px;font-size:12px;color:#fecaca";
        const ago = elapsed < 60000 ? "just now" : `${Math.floor(elapsed / 60000)}m ago`;
        relocBanner.innerHTML = `<b style="color:#f87171">HARD RELOCATION</b> &mdash; All previous calibration data for <b style="color:#5eead4">${_esc(bs._lastRelocation.label)}</b> was purged (${ago}). The new position is locked at 5.0\u00d7 weight. If the beacon still appears in the wrong location, wait 10\u201315 seconds for the server to recalculate.`;
        infoCard.appendChild(relocBanner);
      }
    }
    // Delete button — remove this beacon from the map
    const delRow = document.createElement("div");
    delRow.style.cssText = "margin-top:8px;display:flex;align-items:center;gap:8px";
    const delBtn = document.createElement("button");
    delBtn.className = "btn";
    delBtn.style.cssText = "font-size:11px;padding:3px 10px;background:#3b1219;border-color:#f87171;color:#f87171";
    delBtn.textContent = "Delete";
    delBtn.title = "Remove this beacon from the map";
    delBtn.addEventListener("click", async () => {
      const mapId = bs.selectedBk.mapId;
      const bkId = bs.selectedBk.bkId;
      // Stop any running timer for this beacon
      if (bs._liveTimers[bkId]) {
        const old = bs._liveTimers[bkId];
        if (old.timer) clearTimeout(old.timer);
        if (old.pollTimer) clearTimeout(old.pollTimer);
        delete bs._liveTimers[bkId];
      }
      const removedBk = (bs.draftBeacons[mapId] || []).find(b => b.id === bkId);
      if (removedBk) bs._liveBeaconKeys.delete(removedBk.key);
      // Remove from draft
      bs.draftBeacons[mapId] = (bs.draftBeacons[mapId] || []).filter(b => b.id !== bkId);
      bs.selectedBk = null;
      // Auto-save to backend
      const origMap = maps_list.find(m => m.id === mapId);
      if (origMap) {
        try {
          // Un-pin from the fabric first — a batch save never deletes.
          if (removedBk && removedBk.key) {
            await ctx.actions.callWS({ type: "padspan_ha/fabric_beacon_remove", key: removedBk.key });
          }
          bs.dirtyMaps[mapId] = false;
        } catch (e) { console.warn("[PadSpan] delete beacon save failed:", e); }
      }
      _refreshSVG();
      _refreshInfo();
      _refreshDirtyLabel();
      _refreshBeaconList();
      _refreshAvailable();
      _refreshTimerRow();
    });
    delRow.appendChild(delBtn);
    const delHint = document.createElement("span");
    delHint.style.cssText = "font-size:11px;color:#94a3b8";
    delHint.textContent = "Remove this beacon placement from the map";
    delRow.appendChild(delHint);
    infoCard.appendChild(delRow);
  }
  _refreshInfo();

  // ── Available beacons (tracked objects from snapshot) ──────────────────
  // Only show objects with actual BLE radio presence (not entity-only trackers or Bermuda sensors).
  // An object is "BLE-capable" if it has kind ble/private_ble/ibeacon, or is an entity with an address.
  if (!bs._hiddenObjKeys) bs._hiddenObjKeys = new Set();
  // Dedup object list: same physical device may appear as ibeacon + private_ble + entity.
  // Keep highest-priority kind (ibeacon > private_ble > ble > entity).
  const _kindPri2 = { ibeacon: 0, private_ble: 1, ble: 2, entity: 3 };
  const _calIsScanner = ctx.helpers.isScanner;
  const _rawTracked = (snap?.objects?.list || [])
    .filter(o => !_calIsScanner(o))
    .filter(o => o.user_label || o.identified || _isFollowed(o))
    .sort((a, b) => (_kindPri2[a.kind] ?? 9) - (_kindPri2[b.kind] ?? 9));
  const _dedupAddrs2 = new Set();
  const _dedupKeys2 = new Set();
  const _dedupLabels2 = new Set();
  const _allTracked = _rawTracked.filter(o => {
    const k = (o.key||"").toUpperCase();
    if (_dedupKeys2.has(k)) return false;
    // Check addresses
    const addrs = [];
    for (const a of (o.all_addresses || [])) if (a) addrs.push(String(a).toUpperCase());
    if (o.address) addrs.push(String(o.address).toUpperCase());
    if (o.canonical_id) addrs.push(String(o.canonical_id).toUpperCase());
    if (addrs.some(a => _dedupAddrs2.has(a))) return false;
    // Same user_label = same physical device (prevents entity + iBeacon dupes)
    const ul = (o.user_label || "").toUpperCase();
    if (ul && _dedupLabels2.has(ul)) return false;
    _dedupKeys2.add(k);
    for (const a of addrs) _dedupAddrs2.add(a);
    if (ul) _dedupLabels2.add(ul);
    return true;
  });
  const _hasBlePresence = (o) => {
    // Must have BLE advertisements to be useful for calibration
    if (o.kind === "ble" || o.kind === "private_ble" || o.kind === "ibeacon") return true;
    // Entity with a resolved BLE address
    if (o.kind === "entity" && o.address) return true;
    return false;
  };
  const _trackedObjects = _allTracked.filter(o => _hasBlePresence(o) && !bs._hiddenObjKeys.has(o.key));
  const _hiddenCount = _allTracked.filter(o => bs._hiddenObjKeys.has(o.key)).length;
  const _entityOnlyCount = _allTracked.filter(o => !_hasBlePresence(o)).length;
  const availCard = document.createElement("div");
  availCard.className = "card";
  function _refreshAvailable() {
    availCard.innerHTML = "";
    // Recompute with latest hidden set
    const visibleObjs = _allTracked.filter(o => _hasBlePresence(o) && !bs._hiddenObjKeys.has(o.key));
    const hiddenN = _allTracked.filter(o => bs._hiddenObjKeys.has(o.key)).length;
    const entityOnlyN = _allTracked.filter(o => !_hasBlePresence(o)).length;
    const filteredN = hiddenN + entityOnlyN;

    // Header row
    const hdrRow = document.createElement("div");
    hdrRow.style.cssText = "display:flex;align-items:center;gap:8px;margin-bottom:4px";
    const hdr0 = document.createElement("div");
    hdr0.style.cssText = "font-weight:700;font-size:13px;flex:1;color:#f59e0b";
    hdr0.textContent = `BLE Objects for Calibration (${visibleObjs.length})`;
    hdrRow.appendChild(hdr0);
    if (filteredN > 0) {
      const filterNote = document.createElement("span");
      filterNote.style.cssText = "font-size:10px;color:#64748b";
      const parts = [];
      if (entityOnlyN) parts.push(`${entityOnlyN} entity-only`);
      if (hiddenN) parts.push(`${hiddenN} hidden`);
      filterNote.textContent = `${parts.join(", ")} filtered`;
      hdrRow.appendChild(filterNote);
    }
    if (hiddenN > 0) {
      const showAllBtn = document.createElement("button");
      showAllBtn.className = "btn inline";
      showAllBtn.style.cssText = "font-size:10px;padding:1px 6px";
      showAllBtn.textContent = "Show hidden";
      showAllBtn.addEventListener("click", (ev) => {
        ev.stopPropagation();
        bs._hiddenObjKeys.clear();
        _refreshAvailable();
      });
      hdrRow.appendChild(showAllBtn);
    }
    availCard.appendChild(hdrRow);

    if (!visibleObjs.length) {
      const msg = document.createElement("div");
      msg.style.cssText = "font-size:12px;color:#94a3b8";
      msg.textContent = "No BLE objects available. Label objects in the Objects tab or follow them in the Follow tab.";
      availCard.appendChild(msg);
      return;
    }

    const hint0 = document.createElement("div");
    hint0.style.cssText = "font-size:11px;color:#94a3b8;margin-bottom:8px";
    hint0.textContent = "Click to select for placement, then double-click on the 3D map. Hide irrelevant objects with \u00d7.";
    availCard.appendChild(hint0);

    // Build lookup: which objects are already pinned
    const pinnedKeys = new Set();
    for (const recs of Object.values(bs.draftBeacons)) {
      for (const bk of recs) { if (bk.key) pinnedKeys.add(bk.key); }
    }

    for (const obj of visibleObjs) {
      const isPinned = pinnedKeys.has(obj.key);
      const isPending = bs.pendingPlace && bs.pendingPlace.key === obj.key;
      const row = document.createElement("div");
      row.style.cssText = `display:flex;align-items:center;gap:8px;padding:6px 8px;border-radius:6px;cursor:pointer;transition:background 0.15s;${isPending ? "background:#1a200e;border:1px solid #f59e0b;" : ""}`;
      row.addEventListener("mouseenter", () => { if (!isPending) row.style.background = "#0d2818"; });
      row.addEventListener("mouseleave", () => { if (!isPending) row.style.background = ""; });

      // Icon
      const icon = document.createElement("div");
      if (isPinned) {
        icon.style.cssText = "width:10px;height:10px;background:#5eead4;transform:rotate(45deg);border-radius:2px;flex-shrink:0";
      } else {
        icon.style.cssText = "width:10px;height:10px;border:2px solid #94a3b8;transform:rotate(45deg);border-radius:2px;flex-shrink:0;background:transparent";
      }
      row.appendChild(icon);

      // Name + kind
      const nameCol = document.createElement("div");
      nameCol.style.cssText = "flex:1;min-width:0;display:flex;flex-direction:column;gap:1px";
      const nameEl = document.createElement("span");
      nameEl.style.cssText = `font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:${isPinned ? "#d1d5db" : "#e2e8f0"};${isPinned ? "" : "font-weight:600"}`;
      nameEl.textContent = obj.user_label || obj.name || obj.key;
      nameCol.appendChild(nameEl);
      // Detail line: kind + RSSI + room
      const detailParts = [];
      const kindLabel = obj.kind === "ibeacon" ? "iBeacon" : obj.kind === "private_ble" ? "Private BLE" : obj.kind === "entity" ? "Entity+BLE" : "BLE";
      detailParts.push(kindLabel);
      if (obj.rssi != null) detailParts.push(`${obj.rssi} dBm`);
      if (obj.room) detailParts.push(obj.room);
      if (obj.sources?.length) detailParts.push(`${obj.sources.length} radio${obj.sources.length > 1 ? "s" : ""}`);
      if (obj.age_s != null) detailParts.push(`${Math.round(obj.age_s)}s ago`);
      const detailEl = document.createElement("span");
      detailEl.style.cssText = "font-size:10px;color:#64748b;overflow:hidden;text-overflow:ellipsis;white-space:nowrap";
      detailEl.textContent = detailParts.join(" \u00b7 ");
      nameCol.appendChild(detailEl);
      row.appendChild(nameCol);

      // Status badge
      if (isPinned) {
        const tag = document.createElement("span");
        tag.style.cssText = "font-size:10px;color:#5eead4;background:#5eead418;padding:1px 6px;border-radius:4px;white-space:nowrap";
        tag.textContent = "Placed";
        row.appendChild(tag);
        // Relocate button — re-place at a new position via double-click
        const relocBtn = document.createElement("button");
        relocBtn.className = "btn inline";
        relocBtn.style.cssText = "font-size:10px;padding:1px 6px;color:#f59e0b;border-color:#92400e;flex-shrink:0";
        relocBtn.textContent = "Relocate";
        relocBtn.title = "Move this beacon to a new spot and re-calibrate";
        relocBtn.addEventListener("click", (ev) => {
          ev.stopPropagation();
          // Find the draft beacon entry for this object
          let foundBk = null, foundMapId = null;
          for (const [mid, bks] of Object.entries(bs.draftBeacons)) {
            const bk = bks.find(b => b.key === obj.key);
            if (bk) { foundBk = bk; foundMapId = mid; break; }
          }
          if (!foundBk) return;
          // Set relocating state so _placeBeaconOnMap removes the old entry
          bs._relocating = { bkId: foundBk.id, mapId: foundMapId };
          // Enter pending-place mode (same as clicking an unplaced beacon)
          bs.pendingPlace = { key: obj.key, label: obj.user_label || obj.name || "", kind: obj.kind || "ble" };
          _refreshAvailable();
          _refreshPlaceBanner();
        });
        row.appendChild(relocBtn);
      } else {
        const tag = document.createElement("span");
        tag.style.cssText = `font-size:10px;padding:1px 6px;border-radius:4px;white-space:nowrap;${isPending ? "color:#fbbf24;background:#fbbf2418;font-weight:600" : "color:#94a3b8;background:#94a3b818"}`;
        tag.textContent = isPending ? "Double-click map\u2026" : "Not placed";
        row.appendChild(tag);
      }

      // Detail button — opens the object detail modal (rename, delete, etc.)
      const detailBtn = document.createElement("button");
      detailBtn.className = "btn inline";
      detailBtn.style.cssText = "font-size:10px;padding:1px 6px;color:#94a3b8;border-color:#94a3b840;flex-shrink:0";
      detailBtn.textContent = "Details";
      detailBtn.addEventListener("click", (ev) => {
        ev.stopPropagation();
        ctx.actions.showObjectDetail(obj);
      });
      row.appendChild(detailBtn);

      // Hide button (only for non-pinned)
      if (!isPinned) {
        const hideBtn = document.createElement("button");
        hideBtn.style.cssText = "background:none;border:none;color:#64748b;cursor:pointer;font-size:14px;padding:0 4px;line-height:1;flex-shrink:0";
        hideBtn.textContent = "\u00d7";
        hideBtn.title = "Hide from this list";
        hideBtn.addEventListener("click", (ev) => {
          ev.stopPropagation();
          bs._hiddenObjKeys.add(obj.key);
          _refreshAvailable();
        });
        row.appendChild(hideBtn);
      }

      if (isPinned) {
        // Pinned: click row to open details
        row.addEventListener("click", () => {
          ctx.actions.showObjectDetail(obj);
        });
      } else {
        // Not pinned: click row to enter placement mode
        row.addEventListener("click", () => {
          bs.pendingPlace = { key: obj.key, label: obj.user_label || obj.name || "", kind: obj.kind || "ble" };
          _refreshAvailable();
          _refreshPlaceBanner();
        });
      }

      availCard.appendChild(row);
    }
  }
  _refreshAvailable();

  // ── Pinned beacons list ───────────────────────────────────────────────
  const beaconListCard = document.createElement("div");
  beaconListCard.className = "card";
  function _refreshBeaconList() {
    beaconListCard.innerHTML = "";
    // Gather all beacons across all maps
    let totalCount = 0;
    const allEntries = [];
    for (const m of sorted) {
      const bks = bs.draftBeacons[m.id] || [];
      for (const bk of bks) {
        allEntries.push({ bk, map: m });
        totalCount++;
      }
    }
    if (!totalCount) {
      beaconListCard.style.display = "none";
      return;
    }
    beaconListCard.style.display = "";
    const hdr = document.createElement("div");
    hdr.style.cssText = "font-weight:700;font-size:13px;margin-bottom:8px";
    hdr.textContent = `Placed Beacons (${totalCount})`;
    beaconListCard.appendChild(hdr);

    const snap2 = (ctx.state.live && ctx.state.live.snapshot) || null;
    for (const { bk, map } of allEntries) {
      const isSel = bs.selectedBk && bs.selectedBk.mapId === map.id && bs.selectedBk.bkId === bk.id;
      const obj = (snap2?.objects?.list || []).find(o => o.key === bk.key);
      const detectedRoom = map ? _detectRoom(bk.x, bk.y, map) : "";
      const isLive = bs._liveBeaconKeys.has(bk.key);
      const timerEntry = bs._liveTimers[bk.id];
      const isTimerActive = timerEntry && timerEntry.endTime > Date.now();
      const calRounds = bs._calibRounds[bk.key] || 0;

      // Per-radio RSSI data
      const addr = obj?.address || obj?.canonical_id || bk.key || "";
      const beaconAds = addr ? _findBeaconAds(snap2, addr) : { myAds: [], perRadio: {}, targetAddr: "" };
      const radioEntries = Object.entries(beaconAds.perRadio).sort((a, b) => (b[1].rssi || -200) - (a[1].rssi || -200));

      const row = document.createElement("div");
      row.style.cssText = `display:flex;gap:10px;padding:8px 10px;border-radius:8px;cursor:pointer;border:1px solid ${isSel ? "#5eead4" : "transparent"};${isSel ? "background:#0d2818;" : ""}`;
      row.addEventListener("mouseenter", () => { if (!isSel) row.style.background = "#0a1a12"; });
      row.addEventListener("mouseleave", () => { if (!isSel) row.style.background = ""; });

      // Left column: icon + name + actions (compact)
      const leftCol = document.createElement("div");
      leftCol.style.cssText = "flex:0 0 auto;min-width:100px;max-width:160px;display:flex;flex-direction:column;gap:4px";

      // Name row with diamond icon
      const nameRow = document.createElement("div");
      nameRow.style.cssText = "display:flex;align-items:center;gap:6px";
      const icon = document.createElement("div");
      const fillC = isLive && !isTimerActive ? "#52b788" : "#5eead4";
      icon.style.cssText = `width:10px;height:10px;background:${fillC};transform:rotate(45deg);border-radius:2px;flex-shrink:0`;
      nameRow.appendChild(icon);
      const nameEl = document.createElement("span");
      nameEl.style.cssText = "font-size:12px;font-weight:600;color:#e2e8f0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis";
      nameEl.textContent = obj?.user_label || obj?.name || bk.label || bk.key;
      nameEl.title = obj?.user_label || obj?.name || bk.label || bk.key;
      nameRow.appendChild(nameEl);
      leftCol.appendChild(nameRow);

      // Map name (small)
      const mapLbl = document.createElement("div");
      mapLbl.style.cssText = "font-size:10px;color:#94a3b8;padding-left:16px";
      mapLbl.textContent = map.name || map.id;
      leftCol.appendChild(mapLbl);

      // Actions row
      const actRow = document.createElement("div");
      actRow.style.cssText = "display:flex;gap:4px;padding-left:16px;flex-wrap:wrap";
      const rmBtn = document.createElement("button");
      rmBtn.className = "btn inline";
      rmBtn.style.cssText = "font-size:10px;padding:1px 6px;color:#f87171;border-color:#7f1d1d";
      rmBtn.textContent = "Remove";
      rmBtn.addEventListener("click", async (ev) => {
        ev.stopPropagation();
        bs.draftBeacons[map.id] = (bs.draftBeacons[map.id] || []).filter(b => b.id !== bk.id);
        bs.dirtyMaps[map.id] = true;
        if (bs.selectedBk?.bkId === bk.id) bs.selectedBk = null;
        // Auto-save removal so coordinator state gets cleaned immediately
        try {
          const origMap = maps_list.find(m => m.id === map.id);
          if (origMap) {
            // Un-pin from the fabric first — a batch save never deletes.
            if (bk.key) await ctx.actions.callWS({ type: "padspan_ha/fabric_beacon_remove", key: bk.key });
            bs.dirtyMaps[map.id] = false;
          }
        } catch(_) {}
        _refreshSVG();
        _refreshInfo();
        _refreshDirtyLabel();
        _refreshBeaconList();
        _refreshAvailable();
      });
      actRow.appendChild(rmBtn);
      // Compact move dropdown
      const otherMaps2 = maps_list.filter(m => m.id !== map.id);
      if (otherMaps2.length) {
        const moveSel2 = document.createElement("select");
        moveSel2.style.cssText = "font-size:10px;padding:1px 4px;border-radius:4px;background:#071008;color:#60a5fa;border:1px solid #2d4a6f;cursor:pointer;max-width:70px";
        const def2 = document.createElement("option");
        def2.value = ""; def2.textContent = "Move\u2026";
        moveSel2.appendChild(def2);
        for (const m2 of otherMaps2) {
          const o2 = document.createElement("option");
          o2.value = m2.id;
          o2.textContent = m2.name || m2.id;
          moveSel2.appendChild(o2);
        }
        moveSel2.addEventListener("click", (ev) => ev.stopPropagation());
        moveSel2.addEventListener("change", (ev) => {
          ev.stopPropagation();
          if (!moveSel2.value) return;
          _moveBeaconToMap(bk, map.id, moveSel2.value);
        });
        actRow.appendChild(moveSel2);
      }
      // Purge all calibration data for this beacon
      const purgeBtn = document.createElement("button");
      purgeBtn.className = "btn inline";
      purgeBtn.style.cssText = "font-size:10px;padding:1px 6px;color:#f87171;border-color:#7f1d1d";
      purgeBtn.textContent = "Purge Data";
      purgeBtn.title = "Delete all calibration data points for this beacon";
      purgeBtn.addEventListener("click", async (ev) => {
        ev.stopPropagation();
        const bkLabel = obj?.user_label || obj?.name || bk.label || bk.key;
        if (!confirm(`Delete ALL calibration data for "${bkLabel}"?\n\nThis removes every data point collected for this beacon across all maps. The beacon marker stays on the map — only the RSSI training data is erased.\n\nThis cannot be undone.`)) return;
        purgeBtn.disabled = true;
        purgeBtn.textContent = "Purging...";
        try {
          const calData = await ctx.actions.calibrationGet();
          const allPts = calData?.points || [];
          const deviceId = (obj?.address || obj?.canonical_id || bk.key || "").toUpperCase();
          const myLabel = (bk.label || "").toUpperCase();
          const myKey = (bk.key || "").toUpperCase();
          let purged = 0;
          for (const pt of allPts) {
            const ptDev = (pt.device_id || "").toUpperCase();
            const ptLbl = (pt.label || "").toUpperCase();
            const isMatch =
              (ptDev && deviceId && ptDev === deviceId) ||
              (ptDev && myKey && ptDev === myKey) ||
              (ptLbl && myLabel && ptLbl === myLabel) ||
              (ptLbl && myKey && ptLbl === myKey);
            if (!isMatch) continue;
            try {
              await ctx.actions.calibrationDeletePoint(pt.id);
              purged++;
            } catch (_) { /**/ }
          }
          ctx.toast(`Purged ${purged} calibration point${purged !== 1 ? "s" : ""} for ${bkLabel}`);
          // Refresh calibration data
          try { ctx.state.calibration = await ctx.actions.calibrationGet(); } catch(_) {}
          purgeBtn.textContent = `${purged} purged`;
          purgeBtn.style.color = "#52b788";
          bs._calibRounds[bk.key] = 0;
        } catch (e) {
          purgeBtn.textContent = "Error";
          purgeBtn.disabled = false;
          ctx.toast("Purge failed: " + String(e), true);
        }
      });
      actRow.appendChild(purgeBtn);
      leftCol.appendChild(actRow);
      row.appendChild(leftCol);

      // Right column: detailed info (takes most space)
      const rightCol = document.createElement("div");
      rightCol.style.cssText = "flex:1;min-width:0;display:flex;flex-direction:column;gap:3px";

      // Status badges row
      const badgeRow = document.createElement("div");
      badgeRow.style.cssText = "display:flex;gap:6px;flex-wrap:wrap;align-items:center";
      // Kind badge
      const kindBadge = document.createElement("span");
      const kindLabel = bk.kind === "ibeacon" ? "iBeacon" : bk.kind === "private_ble" ? "Private BLE" : "BLE";
      const kindColor = bk.kind === "ibeacon" ? "#c4b5fd" : bk.kind === "private_ble" ? "#7dd3fc" : "#5eead4";
      kindBadge.style.cssText = `font-size:9px;padding:1px 6px;border-radius:3px;background:${kindColor}18;color:${kindColor};border:1px solid ${kindColor}40`;
      kindBadge.textContent = kindLabel;
      badgeRow.appendChild(kindBadge);
      // Room badge
      const roomName = obj?.room || detectedRoom || "";
      if (roomName) {
        const roomBadge = document.createElement("span");
        const rc = roomColorFn(roomName);
        roomBadge.style.cssText = `font-size:9px;padding:1px 6px;border-radius:3px;background:${rc}18;color:${rc};border:1px solid ${rc}40`;
        roomBadge.textContent = roomName;
        badgeRow.appendChild(roomBadge);
      }
      // Live / Timer badge
      if (isTimerActive) {
        const rem = Math.max(0, Math.ceil((timerEntry.endTime - Date.now()) / 1000));
        const tmBadge = document.createElement("span");
        tmBadge.style.cssText = "font-size:9px;padding:1px 6px;border-radius:3px;background:#f59e0b18;color:#f59e0b;border:1px solid #f59e0b40;font-weight:600";
        tmBadge.textContent = `Calibrating ${rem}s`;
        badgeRow.appendChild(tmBadge);
      } else if (isLive) {
        const liveBadge = document.createElement("span");
        liveBadge.style.cssText = "font-size:9px;padding:1px 6px;border-radius:3px;background:#52b78818;color:#52b788;border:1px solid #52b78840;font-weight:600";
        liveBadge.textContent = "LIVE";
        badgeRow.appendChild(liveBadge);
      }
      // Cal rounds badge
      if (calRounds > 0) {
        const calBadge = document.createElement("span");
        calBadge.style.cssText = "font-size:9px;padding:1px 6px;border-radius:3px;background:#60a5fa18;color:#60a5fa;border:1px solid #60a5fa40";
        calBadge.textContent = `${calRounds} cal round${calRounds > 1 ? "s" : ""}`;
        badgeRow.appendChild(calBadge);
      }
      rightCol.appendChild(badgeRow);

      // Detail metrics row
      const metricsRow = document.createElement("div");
      metricsRow.style.cssText = "display:flex;gap:12px;flex-wrap:wrap;font-size:11px;color:#94a3b8";
      const addMetric = (label, value, color) => {
        const m = document.createElement("span");
        m.style.cssText = "white-space:nowrap";
        m.innerHTML = `<span style="color:#64748b">${label}</span> <span style="color:${color || "#d1d5db"}">${_esc(String(value))}</span>`;
        metricsRow.appendChild(m);
      };
      // Position metric with help button
      const posMetric = document.createElement("span");
      posMetric.style.cssText = "white-space:nowrap;display:inline-flex;align-items:center;gap:3px";
      posMetric.innerHTML = `<span style="color:#64748b">Pos:</span> <span style="color:#d1d5db">${_esc(`${(bk.x*100).toFixed(1)}%, ${(bk.y*100).toFixed(1)}%`)}</span>`;
      const posHelp2 = document.createElement("button");
      posHelp2.style.cssText = "background:none;border:1px solid #4a6052;color:#94a3b8;cursor:pointer;font-size:9px;font-weight:700;width:14px;height:14px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;padding:0;flex-shrink:0;line-height:1";
      posHelp2.textContent = "?";
      posHelp2.title = "What do these percentages mean?";
      posHelp2.addEventListener("click", (ev) => { ev.stopPropagation(); _showPosHelp(ctx); });
      posMetric.appendChild(posHelp2);
      metricsRow.appendChild(posMetric);
      if (obj?.rssi != null) addMetric("RSSI:", `${obj.rssi} dBm`, obj.rssi > -70 ? "#52b788" : obj.rssi > -85 ? "#f59e0b" : "#f87171");
      if (obj?.age_s != null) addMetric("Seen:", `${Math.round(obj.age_s)}s ago`, obj.age_s < 30 ? "#52b788" : obj.age_s < 120 ? "#f59e0b" : "#f87171");
      if (obj?.knn_confidence != null) addMetric("Conf:", `${(obj.knn_confidence*100).toFixed(0)}%`, obj.knn_confidence > 0.7 ? "#52b788" : "#f59e0b");
      if (obj?.sources?.length) addMetric("Radios:", String(obj.sources.length));
      rightCol.appendChild(metricsRow);

      // Per-radio RSSI breakdown (compact)
      if (radioEntries.length) {
        const radioRow = document.createElement("div");
        radioRow.style.cssText = "display:flex;gap:6px;flex-wrap:wrap;font-size:10px";
        for (const [src, info] of radioEntries.slice(0, 6)) {
          const chip = document.createElement("span");
          const rssiColor = (info.rssi || -200) > -70 ? "#52b788" : (info.rssi || -200) > -85 ? "#f59e0b" : "#f87171";
          const shortName = (info.name || src || "?").substring(0, 10);
          chip.style.cssText = `padding:1px 6px;border-radius:3px;background:#0a1a12;border:1px solid #1b3526;color:#d1d5db;white-space:nowrap`;
          chip.innerHTML = `${_esc(shortName)} <span style="color:${rssiColor};font-weight:600">${info.rssi ?? "?"}</span>`;
          if (info.age_s != null) chip.innerHTML += ` <span style="color:#64748b">${Math.round(info.age_s)}s</span>`;
          radioRow.appendChild(chip);
        }
        if (radioEntries.length > 6) {
          const more = document.createElement("span");
          more.style.cssText = "color:#64748b;font-size:10px;padding:1px 4px";
          more.textContent = `+${radioEntries.length - 6} more`;
          radioRow.appendChild(more);
        }
        rightCol.appendChild(radioRow);
      } else {
        const noRadio = document.createElement("div");
        noRadio.style.cssText = "font-size:10px;color:#64748b;font-style:italic";
        noRadio.textContent = "No radio data available";
        rightCol.appendChild(noRadio);
      }

      row.appendChild(rightCol);

      row.addEventListener("click", () => {
        bs.selectedBk = { mapId: map.id, bkId: bk.id };
        _refreshSVG();
        _refreshInfo();
        _refreshBeaconList();
      });
      beaconListCard.appendChild(row);
    }
  }
  _refreshBeaconList();

  // ── Calibration Guide — guided calibration at optimal positions ──────────
  const guideCard = document.createElement("div");
  guideCard.className = "card";
  guideCard.style.cssText = "border-color:#3b82f6;background:rgba(59,130,246,.06)";

  // Compute best next calibration position for a given beacon
  // Prefers spots that: (1) lack calibration data, (2) overlap multiple radios,
  // (3) are inside room polygons, (4) haven't been skipped
  function _computeBestTarget(bkKey) {
    // Use fresh calibration data (ctx.state.calibration) instead of the
    // stale closure `calData` — otherwise the just-saved point is missing
    // and the algorithm picks the same spot again.
    const _fresh = ctx.state.calibration || calData || { points: [] };
    const calPts = (_fresh.points || []).filter(p => !bkKey || p.device_id === bkKey || p.label === bkKey);
    const allPts = _fresh.points || [];
    const GRID = 12;
    let bestScore = -1, bestTarget = null;

    for (const m of sorted) {
      const rooms = m.room_bounds || {};
      if (!Object.keys(rooms).length) continue;
      const rxList = m.receivers || [];
      const mapPts = allPts.filter(p => p.map_id === m.id);
      const bkPts = calPts.filter(p => p.map_id === m.id);

      for (let gy = 0; gy < GRID; gy++) {
        for (let gx = 0; gx < GRID; gx++) {
          const x = (gx + 0.5) / GRID;
          const y = (gy + 0.5) / GRID;

          // Must be inside a room polygon
          let inRoom = "";
          for (const [room, b] of Object.entries(rooms)) {
            if (b.type === "poly" && _pointInPoly(x, y, b.points || [])) { inRoom = room; break; }
          }
          if (!inRoom) continue;

          // Skip if user already skipped this spot
          const isSkipped = bs._guideSkipped.some(s =>
            s.mapId === m.id && Math.abs(s.x - x) < 1 / GRID && Math.abs(s.y - y) < 1 / GRID
          );
          if (isSkipped) continue;

          // Score: distance from nearest existing cal point (farther = better)
          let minDistAll = 1.0;
          for (const p of mapPts) {
            const d = Math.hypot(p.x_frac - x, p.y_frac - y);
            if (d < minDistAll) minDistAll = d;
          }
          // Skip positions that already have a calibration point very close
          // (within half a grid cell). This prevents the guide from suggesting
          // the same spot repeatedly when radio overlap score is high.
          if (minDistAll < 0.5 / GRID) continue;

          // Extra bonus for distance from this beacon's own points
          let minDistBk = 1.0;
          for (const p of bkPts) {
            const d = Math.hypot(p.x_frac - x, p.y_frac - y);
            if (d < minDistBk) minDistBk = d;
          }

          // Radio overlap: count receivers within range (~0.35 map units)
          let radioCount = 0;
          for (const r of rxList) {
            const d = Math.hypot((r.x || 0) - x, (r.y || 0) - y);
            if (d < 0.4) radioCount++;
          }
          // Bonus for 2+ radios, but distance from existing points is dominant
          const radioScore = radioCount >= 2 ? 1.0 + radioCount * 0.3 : radioCount * 0.2;

          const score = minDistAll * 3.0 + minDistBk * 2.0 + radioScore;
          if (score > bestScore) {
            bestScore = score;
            bestTarget = { mapId: m.id, x, y, room: inRoom, radioCount, score };
          }
        }
      }
    }
    return bestTarget;
  }

  function _refreshGuideCard() {
    guideCard.innerHTML = "";
    if (!bs._guideActive) {
      // Collapsed: show activation button
      const row = document.createElement("div");
      row.style.cssText = "display:flex;align-items:center;gap:8px";
      const icon = document.createElement("span");
      icon.style.cssText = "font-size:14px";
      icon.textContent = "\uD83C\uDFAF";
      row.appendChild(icon);
      const lbl = document.createElement("span");
      lbl.style.cssText = "font-weight:700;font-size:13px;color:#3b82f6";
      lbl.textContent = "Calibration Guide";
      row.appendChild(lbl);
      const desc = document.createElement("span");
      desc.style.cssText = "font-size:11px;color:#94a3b8;flex:1";
      desc.textContent = "Guided beacon placement for maximum accuracy.";
      row.appendChild(desc);
      const startBtn = document.createElement("button");
      startBtn.className = "btn inline";
      startBtn.style.cssText = "color:#3b82f6;border-color:#3b82f6;font-weight:700;font-size:12px;padding:3px 12px";
      startBtn.textContent = "Start Guide";
      startBtn.addEventListener("click", () => {
        bs._guideActive = true;
        bs._guideSkipped = [];
        _refreshGuideCard();
      });
      row.appendChild(startBtn);
      guideCard.appendChild(row);
      return;
    }

    // Active guide UI — compact single header row with beacon selector inline
    const hdr = document.createElement("div");
    hdr.style.cssText = "display:flex;align-items:center;gap:8px;margin-bottom:6px";
    const icon = document.createElement("span");
    icon.style.cssText = "font-size:14px";
    icon.textContent = "\uD83C\uDFAF";
    hdr.appendChild(icon);
    const title = document.createElement("span");
    title.style.cssText = "font-weight:700;font-size:13px;color:#3b82f6;white-space:nowrap";
    title.textContent = "Guide";
    hdr.appendChild(title);
    // Beacon selector inline in header
    const guideSel = document.createElement("select");
    guideSel.style.cssText = "max-width:25%;min-width:100px;background:#071008;color:#e2e8f0;border:1px solid #1e40af;border-radius:4px;padding:2px 6px;font-size:11px";
    // All tracked beacons on any map
    const allBks = [];
    for (const [mapId, bks] of Object.entries(bs.draftBeacons)) {
      for (const bk of bks) allBks.push({ ...bk, mapId });
    }
    const ph2 = document.createElement("option");
    ph2.value = ""; ph2.textContent = allBks.length ? "\u2014 select beacon \u2014" : "\u2014 no beacons placed \u2014";
    guideSel.appendChild(ph2);
    const seenKeys = new Set();
    for (const bk of allBks) {
      if (seenKeys.has(bk.key)) continue;
      seenKeys.add(bk.key);
      const opt = document.createElement("option");
      opt.value = bk.key;
      opt.textContent = bk.label || bk.key;
      if (bs._guideBkKey === bk.key) opt.selected = true;
      guideSel.appendChild(opt);
    }
    guideSel.addEventListener("change", () => {
      bs._guideBkKey = guideSel.value || null;
      bs._guideSkipped = [];
      bs._guideTarget = bs._guideBkKey ? _computeBestTarget(bs._guideBkKey) : null;
      _refreshGuideCard();
      _refreshSVG();
    });
    hdr.appendChild(guideSel);
    const closeBtn = document.createElement("button");
    closeBtn.className = "btn inline";
    closeBtn.style.cssText = "margin-left:auto;font-size:10px;color:#94a3b8;padding:2px 8px";
    closeBtn.textContent = "Close";
    closeBtn.addEventListener("click", () => {
      bs._guideActive = false;
      bs._guideTarget = null;
      bs._guideCapturing = false;
      bs._guideSaved = false;
      if (bs._guideTimerId) { clearTimeout(bs._guideTimerId); bs._guideTimerId = null; }
      if (bs._guidePollId) { clearTimeout(bs._guidePollId); bs._guidePollId = null; }
      _refreshGuideCard();
      _refreshSVG();
    });
    hdr.appendChild(closeBtn);
    guideCard.appendChild(hdr);

    if (!bs._guideBkKey) {
      const hint = document.createElement("div");
      hint.style.cssText = "font-size:11px;color:#64748b";
      hint.textContent = "Select a beacon to start guided calibration.";
      guideCard.appendChild(hint);
      return;
    }

    // Compute target if not set
    if (!bs._guideTarget && !bs._guideCapturing) {
      bs._guideTarget = _computeBestTarget(bs._guideBkKey);
    }

    if (bs._guideCapturing) {
      // Show capture in progress
      const rem = Math.max(0, Math.ceil((bs._guideEndTime - Date.now()) / 1000));
      const prog = document.createElement("div");
      prog.style.cssText = "text-align:center;padding:4px;font-size:12px;color:#3b82f6;font-weight:700";
      const scannerCount = Object.keys(bs._guideReadings).length;
      prog.textContent = `Capturing... ${rem}s \u2022 ${scannerCount} scanner${scannerCount !== 1 ? "s" : ""}`;
      guideCard.appendChild(prog);
      const stopBtn = document.createElement("button");
      stopBtn.className = "btn inline";
      stopBtn.style.cssText = "display:block;margin:4px auto 0;color:#f87171;border-color:#f87171;font-size:11px;padding:2px 10px";
      stopBtn.textContent = "Cancel Capture";
      stopBtn.addEventListener("click", () => {
        if (bs._guideTimerId) { clearTimeout(bs._guideTimerId); bs._guideTimerId = null; }
        if (bs._guidePollId) { clearTimeout(bs._guidePollId); bs._guidePollId = null; }
        bs._guideCapturing = false;
        bs._guideTarget = _computeBestTarget(bs._guideBkKey);
        _refreshGuideCard();
        _refreshSVG();
      });
      guideCard.appendChild(stopBtn);
      return;
    }

    // Capture report before showing next location
    if (bs._guideSaved) {
      const saved = document.createElement("div");
      saved.style.cssText = "padding:4px 8px;font-size:11px;line-height:1.5";
      if (bs._guideSaved === "no_signal") {
        saved.innerHTML = `<span style="color:#f59e0b;font-weight:700">&#9888; No Signal</span>`;
      } else if (bs._guideSaved === "error") {
        saved.innerHTML = `<span style="color:#f87171;font-weight:700">&#10007; Save Failed</span>`;
      } else {
        saved.innerHTML = `<span style="color:#52b788;font-weight:700">&#10003; Saved</span>`;
      }
      if (bs._guideReport) {
        const lines = bs._guideReport.split("\n");
        saved.innerHTML += ` <span style="color:#e2e8f0">${_esc(lines[0])}</span>`;
        for (let i = 1; i < lines.length; i++) {
          const isError = lines[i].includes("SAVE FAILED");
          saved.innerHTML += `<br><span style="color:${isError ? "#f87171" : "#f59e0b"};font-size:10px">${_esc(lines[i])}</span>`;
        }
      }
      if (bs._guideSaved === true) {
        saved.innerHTML += `<br><span style="color:#94a3b8;font-size:10px">Next location\u2026</span>`;
      }
      guideCard.appendChild(saved);
      return;
    }

    if (!bs._guideTarget) {
      const done = document.createElement("div");
      done.style.cssText = "text-align:center;padding:4px;font-size:12px;color:#52b788";
      done.innerHTML = "<b>All areas covered!</b> Reset skipped spots or close.";
      guideCard.appendChild(done);
      const resetBtn = document.createElement("button");
      resetBtn.className = "btn inline";
      resetBtn.style.cssText = "display:block;margin:4px auto 0;color:#3b82f6;border-color:#3b82f6;font-size:11px;padding:2px 10px";
      resetBtn.textContent = "Reset Skipped";
      resetBtn.addEventListener("click", () => {
        bs._guideSkipped = [];
        bs._guideTarget = _computeBestTarget(bs._guideBkKey);
        _refreshGuideCard();
        _refreshSVG();
      });
      guideCard.appendChild(resetBtn);
      return;
    }

    // Show suggested position
    const tgt = bs._guideTarget;
    const tgtMap = sorted.find(m => m.id === tgt.mapId);
    const fl = ctx.state.model?.floors || [];
    const flObj = fl.find(f => f.level === (tgtMap?.stack?.z_level ?? 0));
    const flName = flObj ? (flObj.name || `Floor ${tgtMap?.stack?.z_level ?? 0}`) : "";

    const suggest = document.createElement("div");
    suggest.style.cssText = "background:rgba(59,130,246,.1);border-radius:6px;padding:6px 10px;margin-bottom:6px;font-size:11px;line-height:1.5";
    suggest.innerHTML = `<span style="font-weight:700;color:#3b82f6">Next:</span> `
      + `<b style="color:#5eead4">${_esc(tgt.room)}</b>`
      + (flName ? ` \u2022 ${_esc(flName)}` : "")
      + ` \u2022 ${tgtMap ? _esc(tgtMap.name || tgtMap.id) : "?"}`
      + ` <span style="color:#94a3b8">(${tgt.radioCount} scanner${tgt.radioCount !== 1 ? "s" : ""}, ${bs._guideSkipped.length} skipped)</span>`
      + `<br><span style="color:#60a5fa">Place beacon at the <b>blue spiral</b> on the map, then Start.</span>`;
    guideCard.appendChild(suggest);

    const btnRow = document.createElement("div");
    btnRow.style.cssText = "display:flex;gap:6px;justify-content:center";
    const goBtn = document.createElement("button");
    goBtn.className = "btn";
    goBtn.style.cssText = "background:#1e3a5f;border-color:#3b82f6;color:#93c5fd;font-weight:700;padding:4px 14px;font-size:12px";
    goBtn.textContent = "Start (60s)";
    goBtn.addEventListener("click", () => _startGuideCapture());
    btnRow.appendChild(goBtn);
    const skipBtn = document.createElement("button");
    skipBtn.className = "btn inline";
    skipBtn.style.cssText = "color:#94a3b8;font-size:11px;padding:4px 10px";
    skipBtn.textContent = "Skip \u2192";
    skipBtn.title = "Skip this location and suggest the next best spot";
    skipBtn.addEventListener("click", () => {
      bs._guideSkipped.push({ mapId: tgt.mapId, x: tgt.x, y: tgt.y });
      bs._guideTarget = _computeBestTarget(bs._guideBkKey);
      _refreshGuideCard();
      _refreshSVG();
    });
    btnRow.appendChild(skipBtn);
    guideCard.appendChild(btnRow);
  }

  // Start 60s RSSI capture at guide target position
  async function _startGuideCapture() {
    const tgt = bs._guideTarget;
    if (!tgt) return;
    const bkKey = bs._guideBkKey;
    // Find beacon object in snapshot
    const bkObj = (snap?.objects?.list || []).find(o => o.key === bkKey);
    if (!bkObj) { console.warn("Guide: beacon not found in snapshot"); return; }

    // Resolve stable address
    let addr = bkObj.address || bkObj.entity_id || bkKey;
    const allAddrs = new Set();
    if (bkObj.address) allAddrs.add(bkObj.address.toUpperCase());
    for (const a of (bkObj.all_addresses || [])) if (a) allAddrs.add(String(a).toUpperCase());
    const canonical = bkObj.canonical_id || null;

    bs._guideCapturing = true;
    bs._guideReadings = {};
    bs._guideLastSample = {};  // per-radio {rssi, age_s} from previous tick (stale-ad dedup)
    bs._guideEndTime = Date.now() + 60000;
    bs._guideResolvedAddr = addr;
    bs._guideAllAddrs = allAddrs;
    bs._guideCanonical = canonical;

    _refreshGuideCard();
    _refreshSVG();

    // Poll loop — collect RSSI each second
    async function _guidePoll() {
      if (!bs._guideCapturing) return;
      try {
        await ctx.actions.refreshSnapshotQuiet();
        const snap2 = ctx.state.live?.snapshot;
        const ads = snap2?.ble?.advertisements || [];
        // Pick the freshest matching ad per radio (lowest age_s), then gate
        // through the age filter + stale-ad dedup before recording a sample.
        const perRadio = {};
        for (const ad of ads) {
          const adAddr = String(ad.address || "").toUpperCase();
          const src = String(ad.source || "");
          if (!src) continue;
          // Match by address, all_addresses, canonical_id, or key
          let match = false;
          if (allAddrs.has(adAddr)) match = true;
          if (!match && canonical && ad.canonical_id === canonical) match = true;
          if (!match && ad.key === bkKey) match = true;
          if (!match) continue;
          const cur = perRadio[src];
          const adAge = (typeof ad.age_s === "number") ? ad.age_s : Infinity;
          const curAge = cur && (typeof cur.age_s === "number") ? cur.age_s : Infinity;
          if (!cur || adAge < curAge || (adAge === curAge && (ad.rssi || -200) > (cur.rssi || -200))) {
            perRadio[src] = { rssi: ad.rssi, age_s: ad.age_s };
          }
        }
        for (const [src, info] of Object.entries(perRadio)) {
          if (!_acceptCalSample(bs._guideLastSample, src, info)) continue;
          if (!bs._guideReadings[src]) {
            const radioName = (snap2?.ble?.radios || []).find(r => r.source === src)?.name || src;
            bs._guideReadings[src] = { name: radioName, samples: [] };
          }
          bs._guideReadings[src].samples.push(info.rssi);
        }
      } catch (e) { /* ignore poll errors */ }
      _refreshGuideCard();
      _refreshSVG();
      if (bs._guideCapturing) bs._guidePollId = setTimeout(_guidePoll, 1000);
    }
    bs._guidePollId = setTimeout(_guidePoll, 500);

    // 60s timer — save calibration point
    bs._guideTimerId = setTimeout(async () => {
      bs._guideCapturing = false;
      if (bs._guidePollId) { clearTimeout(bs._guidePollId); bs._guidePollId = null; }
      bs._guideTimerId = null;

      // Transform readings → scanner_readings array
      const scannerReadings = Object.entries(bs._guideReadings).map(([source, rd]) => ({
        source, name: rd.name || source, rssi_samples: rd.samples || [],
      }));

      // Build capture report
      const _totalSamples = scannerReadings.reduce((s, r) => s + (r.rssi_samples || []).length, 0);
      const _activeRadios = scannerReadings.filter(r => (r.rssi_samples || []).length > 0);

      if (!_activeRadios.length) {
        bs._guideSaved = "no_signal";
        bs._guideReport = "No scanners detected this beacon during 60s capture. Move closer to a scanner or check that the beacon is broadcasting.";
        bs._guideReadings = {};
        ctx.actions.renderRooms();
        setTimeout(() => {
          bs._guideSaved = false;
          bs._guideReport = "";
          bs._guideTarget = _computeBestTarget(bs._guideBkKey);
          ctx.actions.renderRooms();
        }, 3000);
        return;
      }

      // Detect room from position
      const tgtMap = maps_list.find(m => m.id === tgt.mapId);
      const room = tgtMap ? _detectRoom(tgt.x, tgt.y, tgtMap) : "";

      const deviceId = bkObj.address || bkObj.entity_id || bkKey;
      const bkLabel = bkObj.user_label || bkObj.name || bkKey;
      const rounds = (bs._calibRounds[bkKey] || 0) + 1;
      bs._calibRounds[bkKey] = rounds;
      const weight = Math.min(5.0, 1.0 + (rounds - 1) * 0.5);

      // Build report lines
      const _reportLines = [];
      _reportLines.push(`${_activeRadios.length} scanner(s), ${_totalSamples} RSSI samples`);
      if (room) _reportLines.push(`Room: ${room}`);
      else _reportLines.push("Room: (not detected — position outside room boundaries)");
      _reportLines.push(`Weight: ${weight.toFixed(1)}x (round ${rounds})`);
      const _warnings = [];
      if (_activeRadios.length === 1) _warnings.push("Only 1 scanner heard — accuracy will be limited");
      if (_totalSamples < 10) _warnings.push("Very few samples collected — signal may be weak");
      const _emptyRadios = scannerReadings.length - _activeRadios.length;
      if (_emptyRadios > 0) _warnings.push(`${_emptyRadios} scanner(s) had no usable samples`);

      let _saveOk = false;
      let _saveError = "";
      try {
        await ctx.actions.calibrationSavePoint({
          map_id: tgt.mapId,
          x_frac: tgt.x,
          y_frac: tgt.y,
          room: room,
          device_id: deviceId,
          label: bkLabel,
          scanner_readings: scannerReadings,
          weight: weight,
        });
        _saveOk = true;
      } catch (e) {
        _saveError = (e && e.message) || String(e);
        _warnings.push(`SAVE FAILED: ${_saveError}`);
      }

      // Store report for display
      bs._guideSaved = _saveOk ? true : "error";
      bs._guideReport = _reportLines.join(" · ") + (_warnings.length ? "\n" + _warnings.map(w => "⚠ " + w).join("\n") : "");
      bs._guideReadings = {};
      // Refresh calibration data so _computeBestTarget sees the new point
      if (_saveOk) {
        try { ctx.state.calibration = await ctx.actions.calibrationGet(); } catch (_) {}
      }
      // Force full re-render so live DOM (not stale closure) updates
      ctx.actions.renderRooms();
      setTimeout(() => {
        bs._guideSaved = false;
        bs._guideReport = "";
        if (_saveOk) bs._guideTarget = _computeBestTarget(bs._guideBkKey);
        ctx.actions.renderRooms();
      }, _saveOk ? 3000 : 5000);
    }, 60000);
  }

  _refreshGuideCard();

  // ── 1 m Reference Calibration (P0-7c) — per-scanner RSSI offsets ──────────
  // Hold a known tag 1 m from each positioned receiver in turn, sample ~15 s,
  // write offset = ref_power - median via padspan_ha/scanner_offset_set.
  const refCard = document.createElement("div");
  refCard.className = "card";
  refCard.style.cssText = "border-color:#f59e0b;background:rgba(245,158,11,.05)";
  if (!bs._refCal) bs._refCal = {
    active: false, bkKey: null, idx: 0, receivers: [], results: {},
    sampling: false, samples: [], lastSample: {}, endTime: 0,
    pollId: null, timerId: null, done: false, status: "",
  };
  const rc = bs._refCal;

  function _refReceivers() {
    const radios = snap?.ble?.radios || [];
    const seen = new Set(); const out = [];
    for (const m of maps_list) for (const r of (m.receivers || [])) {
      const src = r.source || "";
      if (!src || seen.has(src)) continue;
      seen.add(src);
      out.push({ source: src, name: (radios.find(x => x.source === src)?.name) || r.label || src });
    }
    return out;
  }

  function _refStopSampling() {
    if (rc.pollId) { clearTimeout(rc.pollId); rc.pollId = null; }
    if (rc.timerId) { clearTimeout(rc.timerId); rc.timerId = null; }
    rc.sampling = false;
  }

  async function _refFinish() {
    rc.done = true;
    const refPower = ctx.state.settings?.ref_power != null ? Number(ctx.state.settings.ref_power) : -59;
    const lines = [];
    for (const r of rc.receivers) {
      const med = rc.results[r.source];
      if (med == null) { lines.push(`${r.name}: skipped (no usable samples)`); continue; }
      const off = Math.round((refPower - med) * 10) / 10;
      try {
        await ctx.actions.scannerOffsetSet(r.source, off);
        lines.push(`${r.name}: median ${med} dBm → offset ${off > 0 ? "+" : ""}${off} dB saved`);
      } catch (e) {
        lines.push(`${r.name}: SAVE FAILED (${(e && e.message) || e})`);
      }
    }
    rc.status = lines.join("\n") || "No receivers.";
    _refreshRefCard();
  }

  function _refAdvance(median) {
    rc.results[rc.receivers[rc.idx].source] = median; // null = skipped / no signal
    rc.idx++;
    if (rc.idx >= rc.receivers.length) { _refFinish(); return; }
    _refreshRefCard();
  }

  function _refStartSample() {
    const bkObj = (snap?.objects?.list || []).find(o => o.key === rc.bkKey);
    if (!bkObj) return;
    const allAddrs = new Set();
    if (bkObj.address) allAddrs.add(bkObj.address.toUpperCase());
    for (const a of (bkObj.all_addresses || [])) if (a) allAddrs.add(String(a).toUpperCase());
    const canonical = bkObj.canonical_id || null;
    const src = rc.receivers[rc.idx].source;
    rc.sampling = true; rc.samples = []; rc.lastSample = {}; rc.endTime = Date.now() + 15000;
    async function _poll() {
      if (!rc.sampling) return;
      try {
        await ctx.actions.refreshSnapshotQuiet();
        const ads = ctx.state.live?.snapshot?.ble?.advertisements || [];
        // Freshest matching ad from THIS receiver (lowest age_s), then gate
        // through the age filter + stale-ad dedup (same as guide capture).
        let best = null;
        for (const ad of ads) {
          if (String(ad.source || "") !== src) continue;
          const adAddr = String(ad.address || "").toUpperCase();
          if (!(allAddrs.has(adAddr) || (canonical && ad.canonical_id === canonical) || ad.key === rc.bkKey)) continue;
          const adAge = (typeof ad.age_s === "number") ? ad.age_s : Infinity;
          const bestAge = best && (typeof best.age_s === "number") ? best.age_s : Infinity;
          if (!best || adAge < bestAge || (adAge === bestAge && (ad.rssi || -200) > (best.rssi || -200))) {
            best = { rssi: ad.rssi, age_s: ad.age_s };
          }
        }
        if (best && _acceptCalSample(rc.lastSample, src, best)) rc.samples.push(best.rssi);
      } catch (e) { /* ignore poll errors */ }
      _refreshRefCard();
      if (rc.sampling) rc.pollId = setTimeout(_poll, 1000);
    }
    rc.pollId = setTimeout(_poll, 500);
    rc.timerId = setTimeout(() => {
      _refStopSampling();
      let median = null;
      if (rc.samples.length) {
        const s2 = [...rc.samples].sort((a, b) => a - b);
        median = s2[Math.floor(s2.length / 2)];
      }
      _refAdvance(median);
    }, 15000);
    _refreshRefCard();
  }

  function _refreshRefCard() {
    refCard.innerHTML = "";
    const mkBtn = (txt, css, fn) => {
      const b = document.createElement("button");
      b.className = "btn inline"; b.style.cssText = css; b.textContent = txt;
      b.addEventListener("click", fn); return b;
    };
    if (!rc.active) {
      const row = document.createElement("div");
      row.style.cssText = "display:flex;align-items:center;gap:8px";
      row.innerHTML = `<span style="font-size:14px">📏</span>`
        + `<span style="font-weight:700;font-size:13px;color:#f59e0b">1 m Reference</span>`
        + `<span style="font-size:11px;color:#94a3b8;flex:1">Hold a known tag 1 m from each scanner to auto-set per-scanner RSSI offsets.</span>`;
      row.appendChild(mkBtn("Start", "color:#f59e0b;border-color:#f59e0b;font-weight:700;font-size:12px;padding:3px 12px", () => {
        Object.assign(rc, { active: true, idx: 0, receivers: _refReceivers(), results: {}, sampling: false, samples: [], done: false, status: "" });
        _refreshRefCard();
      }));
      refCard.appendChild(row);
      return;
    }
    const hdr = document.createElement("div");
    hdr.style.cssText = "display:flex;align-items:center;gap:8px;margin-bottom:6px";
    hdr.innerHTML = `<span style="font-size:14px">📏</span><span style="font-weight:700;font-size:13px;color:#f59e0b;white-space:nowrap">1 m Reference</span>`;
    // Tag selector — same tracked-beacon picker as the guide
    const sel = document.createElement("select");
    sel.style.cssText = "max-width:25%;min-width:100px;background:#071008;color:#e2e8f0;border:1px solid #92600a;border-radius:4px;padding:2px 6px;font-size:11px";
    sel.disabled = rc.sampling || rc.idx > 0 || rc.done;
    const allBks2 = [];
    const seenK2 = new Set();
    for (const bks of Object.values(bs.draftBeacons)) for (const bk of bks) {
      if (seenK2.has(bk.key)) continue; seenK2.add(bk.key); allBks2.push(bk);
    }
    const ph3 = document.createElement("option");
    ph3.value = ""; ph3.textContent = allBks2.length ? "— select tag —" : "— no tags placed —";
    sel.appendChild(ph3);
    for (const bk of allBks2) {
      const opt = document.createElement("option");
      opt.value = bk.key; opt.textContent = bk.label || bk.key;
      if (rc.bkKey === bk.key) opt.selected = true;
      sel.appendChild(opt);
    }
    sel.addEventListener("change", () => { rc.bkKey = sel.value || null; _refreshRefCard(); });
    hdr.appendChild(sel);
    hdr.appendChild(mkBtn("Close", "margin-left:auto;font-size:10px;color:#94a3b8;padding:2px 8px", () => {
      _refStopSampling();
      Object.assign(rc, { active: false, idx: 0, results: {}, done: false, status: "" });
      _refreshRefCard();
    }));
    refCard.appendChild(hdr);
    const body = document.createElement("div");
    body.style.cssText = "font-size:11px;line-height:1.5";
    if (rc.done) {
      body.innerHTML = `<span style="color:#52b788;font-weight:700">&#10003; Done</span><br>`
        + rc.status.split("\n").map(l => `<span style="color:${l.includes("FAILED") ? "#f87171" : "#e2e8f0"}">${_esc(l)}</span>`).join("<br>");
    } else if (!rc.bkKey) {
      body.innerHTML = `<span style="color:#64748b">Select a known tag to begin.</span>`;
    } else if (!rc.receivers.length) {
      body.innerHTML = `<span style="color:#f59e0b">No positioned receivers found — place scanners in the Tune tab first.</span>`;
    } else {
      const r = rc.receivers[rc.idx];
      body.innerHTML = `<span style="color:#94a3b8">Step ${rc.idx + 1}/${rc.receivers.length}:</span> `
        + `hold the tag <b style="color:#fef3c7">1 m</b> from <b style="color:#5eead4">${_esc(r.name)}</b>`;
      if (rc.sampling) {
        const rem = Math.max(0, Math.ceil((rc.endTime - Date.now()) / 1000));
        body.innerHTML += `<br><span style="color:#f59e0b;font-weight:700">Sampling… ${rem}s • ${rc.samples.length} sample${rc.samples.length !== 1 ? "s" : ""}</span>`;
      }
      const bRow = document.createElement("div");
      bRow.style.cssText = "display:flex;gap:6px;margin-top:6px";
      if (rc.sampling) {
        bRow.appendChild(mkBtn("Cancel Sample", "color:#f87171;border-color:#f87171;font-size:11px;padding:2px 10px", () => {
          _refStopSampling(); _refreshRefCard();
        }));
      } else {
        bRow.appendChild(mkBtn("Sample (15 s)", "background:#3a2a0a;border-color:#f59e0b;color:#fbbf24;font-weight:700;font-size:12px;padding:3px 12px", () => _refStartSample()));
        bRow.appendChild(mkBtn("Skip →", "color:#94a3b8;font-size:11px;padding:3px 10px", () => _refAdvance(null)));
      }
      body.appendChild(bRow);
    }
    refCard.appendChild(body);
  }
  _refreshRefCard();

  // ── Add blue spiral to SVG when guide target is active ───────────────────
  const _origBuildBeaconSVG = buildBeaconSVG;
  const buildBeaconSVGWrapped = (focusZ) => {
    let s = _origBuildBeaconSVG(focusZ);
    // Inject blue spiral before closing </svg>
    if (bs._guideActive && bs._guideTarget && !bs._guideCapturing) {
      const tgt = bs._guideTarget;
      const xf = mapXforms[tgt.mapId];
      if (xf) {
        const [wx, wy] = xf.mapPt(tgt.x, tgt.y);
        const [px, py] = iso(wx, wy, xf.z);
        const tx = Math.round(px), ty = Math.round(py);
        // Blue pulsing spiral
        s = s.replace("</svg>",
          `<g class="guide-target" style="cursor:pointer" data-action="guide-start">`
          + `<circle cx="${tx}" cy="${ty}" r="30" fill="rgba(59,130,246,.12)"><animate attributeName="r" values="24;34;24" dur="2s" repeatCount="indefinite"/></circle>`
          + `<circle cx="${tx}" cy="${ty}" r="18" fill="none" stroke="#3b82f6" stroke-width="2.5" stroke-dasharray="6,4" opacity="0.9"><animateTransform attributeName="transform" type="rotate" from="0 ${tx} ${ty}" to="360 ${tx} ${ty}" dur="2.5s" repeatCount="indefinite"/></circle>`
          + `<circle cx="${tx}" cy="${ty}" r="10" fill="none" stroke="#60a5fa" stroke-width="1.5" stroke-dasharray="3,3" opacity="0.7"><animateTransform attributeName="transform" type="rotate" from="360 ${tx} ${ty}" to="0 ${tx} ${ty}" dur="1.8s" repeatCount="indefinite"/></circle>`
          + `<circle cx="${tx}" cy="${ty}" r="4" fill="#3b82f6" opacity="0.9"/>`
          + `<text x="${tx}" y="${ty + 42}" text-anchor="middle" fill="#3b82f6" font-size="9" font-weight="700">PLACE HERE</text>`
          + `</g></svg>`
        );
      }
    }
    // Amber ring during capture
    if (bs._guideActive && bs._guideCapturing && bs._guideTarget) {
      const tgt = bs._guideTarget;
      const xf = mapXforms[tgt.mapId];
      if (xf) {
        const [wx, wy] = xf.mapPt(tgt.x, tgt.y);
        const [px, py] = iso(wx, wy, xf.z);
        const tx = Math.round(px), ty = Math.round(py);
        const rem = Math.max(0, Math.ceil((bs._guideEndTime - Date.now()) / 1000));
        const scanners = Object.keys(bs._guideReadings).length;
        s = s.replace("</svg>",
          `<circle cx="${tx}" cy="${ty}" r="28" fill="none" stroke="#3b82f6" stroke-width="2.5" stroke-dasharray="8,4" opacity="0.9">`
          + `<animateTransform attributeName="transform" type="rotate" from="0 ${tx} ${ty}" to="360 ${tx} ${ty}" dur="3s" repeatCount="indefinite"/>`
          + `</circle>`
          + `<circle cx="${tx}" cy="${ty}" r="5" fill="#3b82f6" opacity="0.9"/>`
          + `<text x="${tx}" y="${ty + 42}" text-anchor="middle" fill="#3b82f6" font-size="10" font-weight="700">${rem}s \u2022 ${scanners} radio${scanners !== 1 ? "s" : ""}</text>`
          + `</svg>`
        );
      }
    }
    return s;
  };

  // Patch _refreshSVG to use wrapped builder
  function _refreshSVGPatched() {
    if (bs._dragging) return; // Don't rebuild SVG mid-drag (matches original)
    const scrollTop = isoDiv.scrollTop, scrollLeft = isoDiv.scrollLeft;
    isoDiv.innerHTML = buildBeaconSVGWrapped(_getFocusZ(bs.focusIdx));
    isoDiv.scrollTop = scrollTop;
    isoDiv.scrollLeft = scrollLeft;
    // Click handler for guide spiral
    const guideG = isoDiv.querySelector("[data-action='guide-start']");
    if (guideG) {
      guideG.addEventListener("click", (e) => {
        e.stopPropagation();
        _startGuideCapture();
      });
    }
  }
  // Reassign the binding so every _refreshSVG() call site (function declarations
  // are mutable bindings) uses the wrapped builder — otherwise the guide's
  // "PLACE HERE" spiral and countdown ring vanish on the next refresh (P1-11).
  _refreshSVG = _refreshSVGPatched;

  // ── Assemble ──────────────────────────────────────────────────────────────
  wrap.appendChild(ctrlRow);
  wrap.appendChild(isoWrap);
  wrap.appendChild(placeBanner);
  wrap.appendChild(guideCard);
  wrap.appendChild(refCard);
  wrap.appendChild(infoCard);
  wrap.appendChild(availCard);
  wrap.appendChild(beaconListCard);

  // After assembly, patch SVG refresh to include guide overlay
  isoDiv.innerHTML = buildBeaconSVGWrapped(_getFocusZ(bs.focusIdx));

  return wrap;
}


function _pointInPoly(px, py, points) {
  let inside = false;
  const n = points.length;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = points[i][0], yi = points[i][1];
    const xj = points[j][0], yj = points[j][1];
    if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}
