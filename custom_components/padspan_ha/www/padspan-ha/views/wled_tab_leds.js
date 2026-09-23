// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
// See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
/**
 * WLED workbench — LEDs: the device's LED outputs and power, and the
 * colour-order wizard. The hardware settings people get wrong most, so:
 *
 * - Checked before saving, in words: duplicate pins, input-only pins, pins
 *   another feature holds (WLED 16's /json/pins), the chip's LED limit, the
 *   per-output limit, outputs that overlap or leave LEDs to no output.
 * - Saved through the safe config write (backup first, refused over a device
 *   that changed meanwhile), with hw.led.ins always sent whole — WLED
 *   replaces every output from that list. Output changes apply live.
 * - Colour-order wizard (no WLED tool has one; people guess — WLED discourse
 *   t/12574): the output lights pure red, green, blue; you tap what you see;
 *   the true order follows (wled_model.orderFromObservation). Everything is
 *   put back afterwards.
 *
 * Administrators only: a wrong pin or length changes real hardware.
 */

const _q = new URL(import.meta.url).search;
const M = await import(`./wled_model.js${_q}`);
const { C, S, h, numberBox, check, select, field, errText } = await import(`./wled_ui.js${_q}`);

export function ledsView(ctx) {
  const root = h("div");
  const status = h("div", { style: `font-size:12px;color:${C.dim}` }, "Reading the LED settings…");
  root.appendChild(status);
  (async () => {
    let cfg, hash, pins = null;
    try {
      ({ data: cfg, hash } = await ctx.call("padspan_ha/wled_get", { path: "json/cfg" }));
      if (M.has(ctx.info, "pins")) pins = await ctx.get("json/pins").catch(() => null);
    } catch (e) { status.textContent = "Couldn't read the settings: " + errText(e); status.style.color = C.red; return; }
    status.remove();
    root.appendChild(editor(ctx, cfg, hash, Array.isArray(pins) ? pins : null));
  })();
  return root;
}

function editor(ctx, cfg, hash, pins) {
  const led = JSON.parse(JSON.stringify((cfg.hw && cfg.hw.led) || {}));
  led.ins = Array.isArray(led.ins) ? led.ins : [];
  const ro = !ctx.isAdmin;
  const wrap = h("div");
  const warnBox = h("div");
  const perBus = M.has(ctx.info, "perBusCurrent");

  const paintWarnings = () => {
    warnBox.innerHTML = "";
    const w = M.outputWarnings(led.ins, ctx.info, pins);
    if (!w.length) return;
    warnBox.appendChild(h("div", { style: S.card + ";border-color:rgba(251,191,36,.45)" },
      w.map(t => h("div", { style: `font-size:12px;color:${C.amber};margin:2px 0` }, "⚠ " + t))));
  };

  // ── Power ──
  const power = h("div", { style: S.card });
  power.appendChild(h("div", { style: "font-weight:700;margin-bottom:6px" }, "Power"));
  const leds = ctx.info.leds || {};
  power.appendChild(h("div", { style: `font-size:12px;color:${C.dim};margin-bottom:6px` },
    leds.pwr !== undefined ? `Drawing about ${leds.pwr} mA now (WLED's estimate).` : ""));
  power.appendChild(h("div", { style: "display:flex;gap:14px;flex-wrap:wrap;align-items:flex-end" }, [
    field("Power supply limit (mA, 0 = none)", numberBox(led.maxpwr ?? 0, v => { led.maxpwr = v; }, { max: 65000, width: 90 }),
      "WLED dims everything to stay under this — set it to your supply's rating, less a margin"),
    "ledma" in led ? field("mA per LED", numberBox(led.ledma ?? 55, v => { led.ledma = v; }, { max: 255 })) : null,
    field("Frame rate limit (0 = none)", numberBox(led.fps ?? 42, v => { led.fps = v; }, { max: 250 })),
  ].filter(Boolean)));
  const whites = h("div", { style: "margin-top:8px" });
  if ("cct" in led) whites.appendChild(check("Correct white balance", led.cct, v => { led.cct = v; }));
  if ("cr" in led) whites.appendChild(check("White from RGB (CCT)", led.cr, v => { led.cr = v; }));
  if (whites.childNodes.length) power.appendChild(whites);

  // ── Outputs ──
  const outputs = h("div");
  const paintOutputs = () => {
    outputs.innerHTML = "";
    led.ins.forEach((b, i) => outputs.appendChild(busCard(ctx, led, b, i, perBus, ro, () => { paintWarnings(); paintOutputs(); })));
    if (!ro && led.ins.length < 10) outputs.appendChild(h("button", { style: S.btn, onclick: () => {
      const last = led.ins[led.ins.length - 1];
      const start = last ? (last.start || 0) + (Number(last.len) || 0) : 0;
      led.ins.push({ start, len: 30, pin: [-1], order: 0, rev: false, skip: 0, type: 22, ref: false, rgbwm: 0, freq: 0 });
      paintWarnings(); paintOutputs();
    } }, "+ Add an output"));
  };
  paintOutputs();
  paintWarnings();

  wrap.appendChild(warnBox);
  wrap.appendChild(power);
  wrap.appendChild(h("div", { style: "font-weight:700;margin:4px 0 6px" }, `LED outputs (${led.ins.length})`));
  wrap.appendChild(outputs);
  if (ro) {
    wrap.appendChild(h("div", { style: `font-size:12px;color:${C.faint};margin-top:6px` }, "An administrator can change the LED outputs."));
    return wrap;
  }
  wrap.appendChild(h("button", { style: S.btnPrimary + ";margin-top:8px", onclick: async () => {
    const w = M.outputWarnings(led.ins, ctx.info, pins);
    const summary = led.ins.map((b, i) => `${i + 1}: ${M.BUS_TYPES[b.type & 0x7f] || "type " + b.type}, ${b.len} LEDs from ${b.start}, `
      + (M.busKind(b.type) === "network" ? `to ${(b.pin || []).join(".")}` : `GPIO ${(b.pin || []).slice(0, M.busPinCount(b.type)).join("+")}`)
      + `, ${M.orderName(b.order)}`).join("\n");
    if (!confirm(`Save these LED outputs?\n\n${summary}${w.length ? "\n\n⚠ " + w.join("\n⚠ ") : ""}\n\nThe device is backed up first.`)) return;
    const patch = { hw: { led: { ...led, ins: led.ins.map(({ _i, ...b }) => b) } } };
    delete patch.hw.led.total;               // informational only
    try {
      await ctx.call("padspan_ha/wled_cfg", { patch, base_hash: hash });
      ctx.toast("LED outputs saved (a backup was taken first)");
      const si = await ctx.get("json/si");
      ctx.info = si.info || ctx.info; ctx.state = si.state || ctx.state;
      wrap.dispatchEvent(new CustomEvent("repaint", { bubbles: true }));
    } catch (e) { ctx.toast("Couldn't save: " + errText(e), true); }
  } }, "Save LED outputs"));
  return wrap;
}

function busCard(ctx, led, b, i, perBus, ro, changed) {
  const kind = M.busKind(b.type);
  const card = h("div", { style: S.card });
  const types = Object.entries(M.BUS_TYPES).map(([id, name]) => [Number(id), name]).sort((a, b) => a[1].localeCompare(b[1]));
  const set = (patch) => { Object.assign(b, patch); changed(); };
  card.appendChild(h("div", { style: "display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:8px" }, [
    h("b", {}, `Output ${i + 1}`),
    h("span", { style: `font-size:11px;color:${C.dim}` }, `LEDs ${b.start || 0}–${(b.start || 0) + (Number(b.len) || 0) - 1}`),
    ro ? null : h("button", { style: S.btn + `;margin-left:auto;color:${C.red}`, onclick: () => {
      if (confirm(`Remove output ${i + 1}?`)) { led.ins.splice(i, 1); changed(); }
    } }, "Remove"),
  ].filter(Boolean)));
  const grid = h("div", { style: "display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px" });
  grid.appendChild(field("LED type", ro ? h("span", {}, M.BUS_TYPES[b.type & 0x7f] || String(b.type))
    : select(types, b.type & 0x7f, v => set({ type: Number(v) | (b.type & 0x80), pin: (b.pin || []).slice(0, M.busPinCount(v)) }), "100%")));
  grid.appendChild(field("First LED", ro ? h("span", {}, String(b.start || 0)) : numberBox(b.start || 0, v => set({ start: v }), { max: 16384 })));
  grid.appendChild(field("How many LEDs", ro ? h("span", {}, String(b.len)) : numberBox(b.len || 0, v => set({ len: v }), { min: 1, max: M.MAX_LEDS_PER_BUS })));
  const pinN = M.busPinCount(b.type);
  if (pinN) {
    const labels = kind === "network" ? ["IP", "", "", ""] : kind === "2pin" ? ["Data GPIO", "Clock GPIO"] : pinN > 1 ? Array.from({ length: pinN }, (_, k) => `GPIO ${k + 1}`) : ["Data GPIO"];
    const pinsRow = h("div", { style: "display:flex;gap:4px;align-items:center" });
    for (let k = 0; k < pinN; k++) {
      if (ro) pinsRow.appendChild(h("span", {}, String((b.pin || [])[k] ?? "–") + (k < pinN - 1 && kind === "network" ? "." : " ")));
      else pinsRow.appendChild(numberBox((b.pin || [])[k] ?? -1, v => { b.pin = [...(b.pin || [])]; b.pin[k] = v; changed(); }, { min: -1, max: 255, width: 48 }));
    }
    grid.appendChild(field(kind === "network" ? "Send to (IP)" : labels.slice(0, pinN).join(" / "), pinsRow));
  }
  if (kind === "digital" || kind === "2pin") {
    grid.appendChild(field("Colour order", ro ? h("span", {}, M.orderName(b.order))
      : select(M.ORDERS.map(o => [o, o]), M.orderName(b.order), v => set({ order: M.orderCode(v, M.wSwapOf(b.order)) }))));
    grid.appendChild(field("White channel swap", ro ? h("span", {}, M.W_SWAPS[M.wSwapOf(b.order)])
      : select(M.W_SWAPS.map((n, k) => [k, n]), M.wSwapOf(b.order), v => set({ order: M.orderCode(M.orderName(b.order), Number(v)) }))));
    grid.appendChild(field("Skip first LEDs", ro ? h("span", {}, String(b.skip || 0)) : numberBox(b.skip || 0, v => set({ skip: v }), { max: 255 }),
      "For a sacrificial first LED used as a level shifter"));
  }
  if (perBus && kind !== "network" && kind !== "onoff" && kind !== "pwm") {
    grid.appendChild(field("This output's limit (mA)", ro ? h("span", {}, String(b.maxpwr ?? 0)) : numberBox(b.maxpwr ?? 0, v => set({ maxpwr: v }), { max: 65000, width: 80 })));
  }
  card.appendChild(grid);
  const opts = h("div", { style: "margin-top:8px" });
  if (!ro) {
    opts.appendChild(check("Reversed", b.rev, v => set({ rev: v }), "The strip is wired from the far end"));
    if (kind === "digital") opts.appendChild(check("Refresh when off", !!(b.type & 0x80) || b.ref, v => set({ ref: v })));
  }
  card.appendChild(opts);
  if (!ro && (kind === "digital" || kind === "2pin")) {
    card.appendChild(h("button", { style: S.btn + ";margin-top:6px", title: "Lights this output red, green then blue — tap what you see", onclick: () => colourWizard(ctx, led, b, i, changed) }, "🎨 Colour-order wizard"));
  }
  return card;
}

// Show pure R, G, B on this output; the person taps what they actually see.
async function colourWizard(ctx, led, bus, i, changed) {
  const saved = JSON.parse(JSON.stringify(ctx.state));
  const start = bus.start || 0, stop = start + (Number(bus.len) || 0);
  const answers = {};
  const overlay = h("div", { style: "position:fixed;inset:0;z-index:10001;background:rgba(3,8,5,.7);display:flex;align-items:center;justify-content:center" });
  const box = h("div", { style: "background:#101f15;border:1px solid " + C.line + ";border-radius:14px;padding:18px;width:320px;max-width:92vw;color:" + C.text });
  overlay.appendChild(box); document.body.appendChild(overlay);
  const show = async (rgb) => ctx.post({ on: true, bri: 128, tt: 0, seg: [
    { id: 0, start, stop, on: true, bri: 255, fx: 0, frz: false, col: [rgb, [0, 0, 0], [0, 0, 0]] },
    ...(saved.seg || []).filter(s => s.id !== 0).map(s => ({ id: s.id, on: false })),
  ] });
  const restore = async () => {
    overlay.remove();
    await ctx.write({ on: saved.on, bri: saved.bri, tt: 0, seg: (saved.seg || []).map(s => { const r = { ...s }; delete r.len; delete r.lc; return r; }) },
      "put the lights back");
  };
  const ask = (label, rgb) => new Promise(async (resolve) => {
    box.innerHTML = "";
    box.appendChild(h("div", { style: "font-weight:700;margin-bottom:8px" }, `Output ${i + 1} — step ${Object.keys(answers).length + 1} of 3`));
    box.appendChild(h("div", { style: "font-size:13px;margin-bottom:10px" }, `The LEDs on this output should now be pure ${label}. What colour are they?`));
    try { await show(rgb); } catch (e) { box.appendChild(h("div", { style: `color:${C.red}` }, errText(e))); }
    const row = h("div", { style: "display:flex;gap:8px" });
    for (const [ch, name, col] of [["R", "Red", "#ef4444"], ["G", "Green", "#22c55e"], ["B", "Blue", "#3b82f6"]]) {
      row.appendChild(h("button", { style: S.btn + `;flex:1;border-color:${col};color:${col};font-weight:700`, onclick: () => resolve(ch) }, name));
    }
    box.appendChild(row);
    box.appendChild(h("button", { style: S.btn + ";margin-top:10px;width:100%", onclick: () => resolve(null) }, "Cancel"));
  });
  try {
    for (const [ch, label, rgb] of [["R", "red", [255, 0, 0]], ["G", "green", [0, 255, 0]], ["B", "blue", [0, 0, 255]]]) {
      const seen = await ask(label, rgb);
      if (!seen) { await restore(); return; }
      answers[ch] = seen;
    }
    const order = M.orderFromObservation(bus.order, answers);
    await restore();
    if (!order) { ctx.toast("Those answers don't add up to a colour order — try again, one colour each", true); return; }
    if (order === M.orderName(bus.order)) { ctx.toast(`${order} is already right for output ${i + 1}`); return; }
    bus.order = M.orderCode(order, M.wSwapOf(bus.order));
    changed();
    ctx.toast(`Output ${i + 1} should be ${order} — press "Save LED outputs" to keep it`);
  } catch (e) {
    await restore();
    ctx.toast("The wizard stopped: " + errText(e), true);
  }
}
