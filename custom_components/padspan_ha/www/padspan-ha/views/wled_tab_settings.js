// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
// See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
/**
 * WLED workbench — Settings: the rest of WLED's own settings pages, in one
 * place and in plain words (Garry, 2026-09-23: "every facet of WLED operation
 * and setup, as complete as the webpage, but more intuitive").
 *
 * Schema-driven: each field names its config path (cfg.cpp, 0.14–16) and
 * whether WLED needs a restart for it (the settings UI's own "reboot
 * required" marks — research doc §9). Every section saves through the safe
 * config write (backup first, refused over a device that changed meanwhile,
 * reset-prone keys carried — ws_wled.py), and a section with a restart-only
 * change offers "Save and restart". Only fields the device actually reports
 * are shown, so each firmware version gets exactly its own settings.
 *
 * Deliberately NOT editable here: Wi-Fi networks, the access point, and
 * security/OTA — a wrong value there leaves the unit unreachable, which no
 * backup can fix remotely. They're shown (to an admin) with a link to the
 * device's own page. Firmware updates are never offered.
 *
 * Administrators edit; everyone else reads what the redacted config shows.
 */

const _q = new URL(import.meta.url).search;
const M = await import(`./wled_model.js${_q}`);
const { C, S, h, numberBox, textBox, check, select, field, errText, reportCfg } = await import(`./wled_ui.js${_q}`);

const getP = (o, path) => path.reduce((a, k) => (a && typeof a === "object" ? a[k] : undefined), o);
function setP(o, path, v) {
  let n = o;
  for (const k of path.slice(0, -1)) { if (typeof n[k] !== "object" || n[k] === null) n[k] = {}; n = n[k]; }
  n[path[path.length - 1]] = v;
}

const BUTTON_TYPES = [[0, "None"], [2, "Push button"], [3, "Push (active high)"], [4, "Switch"], [5, "PIR sensor"],
  [6, "Touch"], [7, "Analog"], [8, "Analog (inverted)"], [9, "Touch switch"]];
const IR_TYPES = [[0, "None"], [1, "24-key remote"], [2, "24-key (CT)"], [3, "40-key blue"], [4, "44-key RGB"],
  [5, "21-key RGB"], [6, "6-key black"], [7, "9-key red"], [8, "JSON remote"]];
const NL_MODES = [[0, "Instant"], [1, "Fade"], [2, "Colour fade"], [3, "Sunrise"]];
const DMX_MODES = [[0, "Disabled"], [1, "Single RGB"], [2, "Single DRGB"], [3, "Effect"], [4, "Multi RGB"],
  [5, "Dimmer + multi RGB"], [6, "Multi RGBW"], [7, "Effect + W"], [8, "Effect segment"], [9, "Effect segment + W"], [10, "Preset"]];
const PAL_BLEND = [[0, "Blend (wrap if moving)"], [1, "Always wrap"], [2, "Never wrap"], [3, "No blending"]];

// Each section: fields {path, label, kind, reboot?, options?, min?, max?, hint?, scale?}
const SECTIONS = [
  { id: "device", title: "Device", fields: [
    { path: ["id", "name"], label: "Name", kind: "text", hint: "Shown in apps and on the network" },
    { path: ["id", "mdns"], label: "Network name (mDNS)", kind: "text", reboot: true, hint: "<name>.local" },
    { path: ["id", "inv"], label: "Alexa calls it", kind: "text" },
    { path: ["id", "sui"], label: "Simplified WLED interface", kind: "bool" },
  ] },
  { id: "boot", title: "When it starts", fields: [
    { path: ["def", "on"], label: "Turn on at start", kind: "bool" },
    { path: ["def", "bri"], label: "Brightness at start", kind: "int", min: 0, max: 255 },
    { path: ["def", "ps"], label: "Preset at start (0 = none)", kind: "preset" },
  ] },
  { id: "light", title: "Transitions & brightness", fields: [
    { path: ["light", "tr", "dur"], label: "Transition (seconds)", kind: "num", scale: 10, min: 0, max: 6553, step: 0.1 },
    { path: ["light", "tr", "rpc"], label: "Random palette change (seconds, 0 = off)", kind: "int", min: 0, max: 255 },
    { path: ["light", "tr", "hrp"], label: "Harmonic random palettes", kind: "bool" },
    { path: ["light", "scale-bri"], label: "Brightness scale (%)", kind: "int", min: 1, max: 255 },
    { path: ["light", "pal-mode"], label: "Palette blending", kind: "select", options: PAL_BLEND },
    { path: ["light", "aseg"], label: "One segment per LED output, automatically", kind: "bool" },
    { path: ["light", "gc", "val"], label: "Gamma value", kind: "num", min: 1, max: 3, step: 0.1 },
    { path: ["light", "gc", "bri"], label: "Gamma-correct brightness", kind: "gamma" },
    { path: ["light", "gc", "col"], label: "Gamma-correct colours", kind: "gamma" },
  ] },
  { id: "nightlight", title: "Nightlight", fields: [
    { path: ["light", "nl", "mode"], label: "How it ends", kind: "select", options: NL_MODES },
    { path: ["light", "nl", "dur"], label: "Length (minutes)", kind: "int", min: 1, max: 255 },
    { path: ["light", "nl", "tbri"], label: "End brightness", kind: "int", min: 0, max: 255 },
    { path: ["light", "nl", "macro"], label: "Then apply preset (0 = none)", kind: "preset" },
  ] },
  { id: "time", title: "Time", fields: [
    { path: ["if", "ntp", "en"], label: "Get the time from the internet", kind: "bool" },
    { path: ["if", "ntp", "host"], label: "Time server", kind: "text" },
    { path: ["if", "ntp", "tz"], label: "Time zone (WLED's list number)", kind: "int", min: 0, max: 30, hint: "The number from the device's Time page list" },
    { path: ["if", "ntp", "offset"], label: "Extra offset (seconds)", kind: "int", min: -65000, max: 65000 },
    { path: ["if", "ntp", "ampm"], label: "12-hour clock", kind: "bool" },
    { path: ["if", "ntp", "ln"], label: "Longitude (for sunrise/sunset)", kind: "num", min: -180, max: 180, step: 0.0001 },
    { path: ["if", "ntp", "lt"], label: "Latitude", kind: "num", min: -90, max: 90, step: 0.0001 },
  ] },
  { id: "buttons", title: "Relay & IR", fields: [
    { path: ["hw", "relay", "pin"], label: "Relay GPIO (-1 = none)", kind: "int", min: -1, max: 48 },
    { path: ["hw", "relay", "rev"], label: "Relay: on means open", kind: "bool" },
    { path: ["hw", "relay", "odrain"], label: "Relay: open-drain", kind: "bool" },
    { path: ["hw", "ir", "pin"], label: "IR receiver GPIO (-1 = none)", kind: "int", min: -1, max: 48, reboot: true },
    { path: ["hw", "ir", "type"], label: "IR remote", kind: "select", options: IR_TYPES, reboot: true },
    { path: ["hw", "btn", "pull"], label: "Buttons: internal pull-up", kind: "bool" },
    { path: ["hw", "btn", "tt"], label: "Touch threshold", kind: "int", min: 0, max: 255 },
  ] },
  { id: "realtime", title: "Realtime control (E1.31 / Art-Net / DDP / UDP)", fields: [
    { path: ["if", "live", "en"], label: "Accept realtime data", kind: "bool" },
    { path: ["if", "live", "mso"], label: "Use the main segment only", kind: "bool" },
    { path: ["if", "live", "rlm"], label: "Respect LED maps", kind: "bool" },
    { path: ["if", "live", "port"], label: "E1.31 / Art-Net port", kind: "int", min: 1, max: 65535, reboot: true, hint: "5568 E1.31, 6454 Art-Net" },
    { path: ["if", "live", "mc"], label: "Multicast", kind: "bool", reboot: true },
    { path: ["if", "live", "dmx", "uni"], label: "Universe", kind: "int", min: 0, max: 63999, reboot: true },
    { path: ["if", "live", "dmx", "addr"], label: "Start address", kind: "int", min: 1, max: 510 },
    { path: ["if", "live", "dmx", "mode"], label: "DMX mode", kind: "select", options: DMX_MODES },
    { path: ["if", "live", "dmx", "dss"], label: "Channels per LED spacing", kind: "int", min: 0, max: 150 },
    { path: ["if", "live", "dmx", "e131prio"], label: "E1.31 priority", kind: "int", min: 0, max: 200 },
    { path: ["if", "live", "dmx", "seqskip"], label: "Ignore sequence numbers", kind: "bool" },
    { path: ["if", "live", "timeout"], label: "Timeout (seconds)", kind: "num", scale: 10, min: 0, max: 65, step: 0.1 },
    { path: ["if", "live", "maxbri"], label: "Force full brightness", kind: "bool" },
    { path: ["if", "live", "no-gc"], label: "No gamma on realtime data", kind: "bool" },
    { path: ["if", "live", "offset"], label: "LED offset", kind: "int", min: -255, max: 255 },
  ] },
  { id: "mqtt", title: "MQTT", fields: [
    { path: ["if", "mqtt", "en"], label: "Use MQTT", kind: "bool", reboot: true },
    { path: ["if", "mqtt", "broker"], label: "Broker", kind: "text", reboot: true },
    { path: ["if", "mqtt", "port"], label: "Port", kind: "int", min: 1, max: 65535, reboot: true },
    { path: ["if", "mqtt", "user"], label: "User", kind: "text", reboot: true },
    { path: ["if", "mqtt", "psk"], label: "Password (leave empty to keep)", kind: "secret", reboot: true },
    { path: ["if", "mqtt", "cid"], label: "Client ID", kind: "text", reboot: true },
    { path: ["if", "mqtt", "rtn"], label: "Retain messages", kind: "bool" },
    { path: ["if", "mqtt", "topics", "device"], label: "Device topic", kind: "text", reboot: true },
    { path: ["if", "mqtt", "topics", "group"], label: "Group topic", kind: "text", reboot: true },
  ] },
  { id: "hue", title: "Philips Hue sync", fields: [
    { path: ["if", "hue", "en"], label: "Follow a Hue light", kind: "bool", reboot: true },
    { path: ["if", "hue", "id"], label: "Hue light number", kind: "int", min: 1, max: 99 },
    { path: ["if", "hue", "iv"], label: "Poll interval (seconds)", kind: "num", scale: 10, min: 0.1, max: 25, step: 0.1 },
    { path: ["if", "hue", "recv", "on"], label: "Take on/off", kind: "bool" },
    { path: ["if", "hue", "recv", "bri"], label: "Take brightness", kind: "bool" },
    { path: ["if", "hue", "recv", "col"], label: "Take colour", kind: "bool" },
  ] },
  { id: "alexa", title: "Alexa", fields: [
    { path: ["if", "va", "alexa"], label: "Alexa can control it", kind: "bool", reboot: true },
    { path: ["if", "va", "macros", 0], label: "Preset when Alexa turns it on", kind: "preset" },
    { path: ["if", "va", "macros", 1], label: "Preset when Alexa turns it off", kind: "preset" },
  ] },
];

export function settingsView(ctx) {
  const root = h("div");
  const status = h("div", { style: `font-size:12px;color:${C.dim}` }, "Reading the settings…");
  root.appendChild(status);
  (async () => {
    let cfg, hash;
    try {
      ({ data: cfg, hash } = await ctx.call("padspan_ha/wled_get", { path: "json/cfg" }));
      if (!ctx.presets) ctx.presets = await ctx.get("presets.json").catch(() => ({}));
    } catch (e) { status.textContent = "Couldn't read the settings: " + errText(e); status.style.color = C.red; return; }
    status.remove();
    const state = { cfg, hash };
    const presetOpts = [[0, "None"], ...Object.entries(ctx.presets || {}).filter(([id]) => Number(id) > 0 && Number(id) < 255)
      .map(([id, p]) => [Number(id), `${id} · ${p.n || "Preset " + id}`]).sort((a, b) => a[0] - b[0])];
    for (const sec of SECTIONS) {
      const card = sectionCard(ctx, state, sec, presetOpts);
      if (card) root.appendChild(card);
    }
    root.appendChild(schedulesCard(ctx, state, presetOpts));
    const btns = buttonsCard(ctx, state, presetOpts);
    if (btns) root.appendChild(btns);
    const um = usermodsCard(ctx, state);
    if (um) root.appendChild(um);
    root.appendChild(networkCard(ctx, cfg));
    if (ctx.isAdmin) root.appendChild(h("div", { style: S.card }, [
      h("div", { style: "font-weight:700;margin-bottom:6px" }, "Restart"),
      h("div", { style: `font-size:12px;color:${C.dim};margin-bottom:6px` },
        "Restarts the controller. It comes back with its start-up settings — lights may switch on."),
      h("button", { style: S.btn + `;color:${C.amber}`, onclick: async () => {
        if (confirm(`Restart ${ctx.info.name || "this device"} now?`)) await ctx.write({ rb: true }, "restart the device");
      } }, "Restart now"),
    ]));
  })();
  return root;
}

async function saveSection(ctx, state, patch, reboot, label) {
  try {
    const r = await ctx.call("padspan_ha/wled_cfg", { patch, base_hash: state.hash, reboot });
    if (r.after) { state.cfg = r.after; state.hash = r.hash; }
    reportCfg(ctx, r, `${label} saved${reboot ? " — restarting" : ""}`);
    return true;
  } catch (e) { ctx.toast(`Couldn't save ${label}: ${errText(e)}`, true); return false; }
}

function sectionCard(ctx, state, sec, presetOpts) {
  const present = sec.fields.filter(f => getP(state.cfg, f.path) !== undefined);
  if (!present.length) return null;               // this firmware has none of it
  const draft = {};                                 // path-string -> value
  const card = h("div", { style: S.card });
  card.appendChild(h("div", { style: "font-weight:700;margin-bottom:8px" }, sec.title));
  const grid = h("div", { style: "display:grid;grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:10px" });
  const ro = !ctx.isAdmin;
  for (const f of present) {
    const cur = getP(state.cfg, f.path);
    const put = (v) => { draft[JSON.stringify(f.path)] = { f, v }; paintSave(); };
    let node;
    if (ro) node = h("span", { style: "font-size:12px" }, f.kind === "bool" ? (cur ? "yes" : "no")
      : f.kind === "gamma" ? (Number(cur) !== 1 ? "yes" : "no") : f.kind === "secret" ? "••••" : String(f.scale ? cur / f.scale : cur));
    else if (f.kind === "bool") node = check("", cur, put);
    else if (f.kind === "gamma") node = check("", Number(cur) !== 1, v => put(v ? (getP(state.cfg, ["light", "gc", "val"]) || 2.2) : 1));
    else if (f.kind === "select") node = select(f.options, cur, v => put(Number(v)), "100%");
    else if (f.kind === "preset") node = select(presetOpts.some(o => o[0] === Number(cur)) ? presetOpts : [...presetOpts, [Number(cur), `Preset ${cur}`]],
      Number(cur) || 0, v => put(Number(v)), "100%");
    else if (f.kind === "text") node = textBox(cur, put, { width: 170 });
    else if (f.kind === "secret") node = textBox("", v => { if (v) put(v); }, { width: 170, placeholder: "unchanged" });
    else node = numberBox(f.scale ? cur / f.scale : cur, v => put(f.scale ? Math.round(v * f.scale) : v),
      { min: f.min ?? 0, max: f.max ?? 65535, step: f.step ?? 1, width: 100 });
    grid.appendChild(field(f.label + (f.reboot ? " ⟳" : ""), node, f.hint || (f.reboot ? "Takes effect after a restart" : undefined)));
  }
  card.appendChild(grid);
  if (present.some(f => f.reboot)) card.appendChild(h("div", { style: `font-size:11px;color:${C.faint};margin-top:6px` }, "⟳ takes effect after a restart"));
  const saveRow = h("div", { style: "display:flex;gap:6px;margin-top:8px" });
  card.appendChild(saveRow);
  const paintSave = () => {
    saveRow.innerHTML = "";
    const changes = Object.values(draft);
    if (!changes.length || ro) return;
    const needsReboot = changes.some(c => c.f.reboot);
    const patch = {};
    for (const { f, v } of changes) setP(patch, f.path, v);
    // Gamma is sent whole: WLED resets whichever of bri/col a write leaves
    // out (cfg.cpp), and a partial gc would otherwise escape the backend's
    // reset-if-absent carry (it only fills a gc that is missing entirely).
    if (patch.light && patch.light.gc) patch.light.gc = { ...(getP(state.cfg, ["light", "gc"]) || {}), ...patch.light.gc };
    // An array path (Alexa macros) is sent whole: WLED replaces arrays.
    if (patch.if && patch.if.va && patch.if.va.macros) {
      const full = [...(getP(state.cfg, ["if", "va", "macros"]) || [0, 0])];
      for (const [k, v] of Object.entries(patch.if.va.macros)) full[Number(k)] = v;
      patch.if.va.macros = full;
    }
    const go = async (reboot) => { if (await saveSection(ctx, state, patch, reboot, sec.title)) { for (const k of Object.keys(draft)) delete draft[k]; paintSave(); } };
    saveRow.appendChild(h("button", { style: S.btnPrimary, onclick: () => go(false) }, `Save ${changes.length} change${changes.length === 1 ? "" : "s"}`));
    if (needsReboot) saveRow.appendChild(h("button", { style: S.btn + `;color:${C.amber}`, onclick: () => go(true) }, "Save and restart"));
    saveRow.appendChild(h("button", { style: S.btn, onclick: () => { for (const k of Object.keys(draft)) delete draft[k]; ctx.repaint(); } }, "Undo"));
  };
  return card;
}

// ── Schedules (cfg timers) ──
function schedulesCard(ctx, state, presetOpts) {
  const card = h("div", { style: S.card });
  card.appendChild(h("div", { style: "font-weight:700;margin-bottom:8px" }, "Schedules"));
  const timers = getP(state.cfg, ["timers"]);
  if (!timers || !Array.isArray(timers.ins)) {
    card.appendChild(h("div", { style: `font-size:12px;color:${C.dim}` }, "This device reports no schedules."));
    return card;
  }
  const gen16 = M.wledGen(ctx.info) >= 16;
  const list = JSON.parse(JSON.stringify(timers.ins));
  const ro = !ctx.isAdmin;
  const DAYS = ["M", "T", "W", "T", "F", "S", "S"];
  const rows = h("div");
  const hourKind = (t, i) => {
    if (gen16) return t.hour === 255 ? "sunrise" : t.hour === 254 ? "sunset" : "time";
    return i === 8 ? "sunrise" : i === 9 ? "sunset" : "time";   // 0.14/0.15: fixed slots
  };
  const paint = () => {
    rows.innerHTML = "";
    list.forEach((t, i) => {
      const kind = hourKind(t, i);
      if (!gen16 && kind === "time" && !t.macro && !t.en && i >= 8) return;
      const r = h("div", { style: "display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin:4px 0;padding:4px;border-bottom:1px solid rgba(255,255,255,.04)" });
      r.appendChild(ro ? h("span", {}, t.en ? "on" : "off") : check("", !!t.en, v => { t.en = v ? 1 : 0; }));
      if (kind === "time") {
        r.appendChild(ro ? h("span", {}, `${String(t.hour).padStart(2, "0")}:${String(t.min).padStart(2, "0")}`)
          : h("span", {}, [numberBox(t.hour, v => { t.hour = v; }, { max: 23, width: 44 }), ":", numberBox(t.min, v => { t.min = v; }, { max: 59, width: 44 })]));
      } else {
        r.appendChild(h("span", { style: "font-size:12px" }, kind === "sunrise" ? "Sunrise" : "Sunset"));
        r.appendChild(ro ? h("span", {}, `${t.min >= 0 ? "+" : ""}${t.min} min`)
          : h("span", { style: "font-size:12px" }, [numberBox(t.min, v => { t.min = v; }, { min: -59, max: 59, width: 50 }), " min"]));
      }
      const days = h("span", { style: "display:inline-flex;gap:2px" });
      DAYS.forEach((d, k) => {
        const on = ((t.dow ?? 127) >> k) & 1;
        days.appendChild(h("button", { style: (on ? S.btnOn : S.btn) + ";padding:2px 6px;font-size:11px", onclick: () => {
          if (ro) return; t.dow = (t.dow ?? 127) ^ (1 << k); paint();
        } }, d));
      });
      r.appendChild(days);
      r.appendChild(h("span", { style: `font-size:12px;color:${C.dim}` }, "→"));
      r.appendChild(ro ? h("span", {}, (presetOpts.find(o => o[0] === t.macro) || [0, `Preset ${t.macro}`])[1])
        : select(presetOpts, t.macro || 0, v => { t.macro = Number(v); }));
      if (!ro && gen16) r.appendChild(h("button", { style: S.btn + `;color:${C.red}`, onclick: () => { list.splice(i, 1); paint(); } }, "✕"));
      rows.appendChild(r);
    });
  };
  paint();
  card.appendChild(rows);
  if (!ro) {
    const bar = h("div", { style: "display:flex;gap:6px;margin-top:8px;flex-wrap:wrap" });
    if (gen16) {
      bar.appendChild(h("button", { style: S.btn, onclick: () => { list.push({ en: 1, hour: 18, min: 0, macro: 0, dow: 127, start: { mon: 1, day: 1 }, end: { mon: 12, day: 31 } }); paint(); } }, "+ At a time"));
      bar.appendChild(h("button", { style: S.btn, onclick: () => { list.push({ en: 1, hour: 254, min: 0, macro: 0, dow: 127, start: { mon: 1, day: 1 }, end: { mon: 12, day: 31 } }); paint(); } }, "+ At sunset"));
      bar.appendChild(h("button", { style: S.btn, onclick: () => { list.push({ en: 1, hour: 255, min: 0, macro: 0, dow: 127, start: { mon: 1, day: 1 }, end: { mon: 12, day: 31 } }); paint(); } }, "+ At sunrise"));
    }
    bar.appendChild(h("button", { style: S.btnPrimary, onclick: () =>
      saveSection(ctx, state, { timers: { ins: list } }, false, "Schedules") }, "Save schedules"));
    card.appendChild(bar);
    const ntp = getP(state.cfg, ["if", "ntp"]) || {};
    if (!ntp.en) card.appendChild(h("div", { style: `font-size:11px;color:${C.amber};margin-top:6px` },
      "⚠ Internet time is off (Time, above) — schedules need the correct time."));
    if (list.some(t => hourKind(t, list.indexOf(t)) !== "time") && !Number(ntp.lt) && !Number(ntp.ln)) {
      card.appendChild(h("div", { style: `font-size:11px;color:${C.amber};margin-top:4px` }, "⚠ Sunrise/sunset need the latitude and longitude (Time, above)."));
    }
  }
  return card;
}

// ── Buttons (cfg hw.btn.ins — WLED rebuilds the list from what's sent) ──
function buttonsCard(ctx, state, presetOpts) {
  const btn = getP(state.cfg, ["hw", "btn"]);
  if (!btn || !Array.isArray(btn.ins)) return null;
  const list = JSON.parse(JSON.stringify(btn.ins));
  const ro = !ctx.isAdmin;
  const card = h("div", { style: S.card });
  card.appendChild(h("div", { style: "font-weight:700;margin-bottom:8px" }, "Buttons"));
  list.forEach((b, i) => {
    if (!b.type && ro) return;
    const macros = Array.isArray(b.macros) ? b.macros : [0, 0, 0];
    b.macros = macros;
    card.appendChild(h("div", { style: "display:flex;gap:8px;align-items:flex-end;flex-wrap:wrap;margin:4px 0" }, [
      h("b", { style: "font-size:12px;width:62px" }, `Button ${i}`),
      field("Type", ro ? h("span", {}, (BUTTON_TYPES.find(t => t[0] === b.type) || [0, String(b.type)])[1])
        : select(BUTTON_TYPES, b.type, v => { b.type = Number(v); })),
      field("GPIO", ro ? h("span", {}, String((b.pin || [])[0] ?? -1)) : numberBox((b.pin || [])[0] ?? -1, v => { b.pin = [v]; }, { min: -1, max: 48, width: 50 })),
      field("Press", ro ? h("span", {}, String(macros[0])) : select(presetOpts, macros[0], v => { macros[0] = Number(v); })),
      field("Hold", ro ? h("span", {}, String(macros[1])) : select(presetOpts, macros[1], v => { macros[1] = Number(v); })),
      field("Double", ro ? h("span", {}, String(macros[2])) : select(presetOpts, macros[2], v => { macros[2] = Number(v); })),
    ]));
  });
  if (!ro) card.appendChild(h("button", { style: S.btnPrimary + ";margin-top:6px", onclick: () =>
    saveSection(ctx, state, { hw: { btn: { ins: list } } }, false, "Buttons") }, "Save buttons"));
  return card;
}

// ── Usermods (cfg um): rendered from the device's own tree ──
function usermodsCard(ctx, state) {
  const um = getP(state.cfg, ["um"]);
  if (!um || typeof um !== "object" || !Object.keys(um).length) return null;
  const card = h("div", { style: S.card });
  card.appendChild(h("div", { style: "font-weight:700;margin-bottom:4px" }, "Usermods"));
  card.appendChild(h("div", { style: `font-size:11px;color:${C.faint};margin-bottom:8px` },
    "Add-ons built into this firmware. Most changes here take effect after a restart."));
  for (const [name, tree] of Object.entries(um)) {
    const draft = JSON.parse(JSON.stringify(tree));
    const box = h("details", { style: "margin:4px 0" });
    box.appendChild(h("summary", { style: "cursor:pointer;font-size:13px" }, name));
    const grid = h("div", { style: "display:grid;grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:8px;margin:8px 0" });
    const walk = (obj, prefix) => {
      for (const [k, v] of Object.entries(obj || {})) {
        const label = prefix ? `${prefix} › ${k}` : k;
        if (v && typeof v === "object" && !Array.isArray(v)) { walk(v, label); continue; }
        const put = (nv) => { obj[k] = nv; };
        let node;
        if (!ctx.isAdmin) node = h("span", { style: "font-size:12px" }, JSON.stringify(v));
        else if (typeof v === "boolean") node = check("", v, put);
        else if (typeof v === "number") node = numberBox(v, put, { min: -1e9, max: 1e9, step: Number.isInteger(v) ? 1 : 0.01, width: 100 });
        else if (Array.isArray(v)) node = textBox(JSON.stringify(v), (t) => { try { put(JSON.parse(t)); } catch (_) { ctx.toast(`${label}: not a valid list`, true); } }, { width: 170 });
        else node = textBox(String(v ?? ""), put, { width: 170 });
        grid.appendChild(field(label, node));
      }
    };
    walk(draft, "");
    box.appendChild(grid);
    if (ctx.isAdmin) box.appendChild(h("div", { style: "display:flex;gap:6px" }, [
      h("button", { style: S.btnPrimary, onclick: () => saveSection(ctx, state, { um: { [name]: draft } }, false, name) }, "Save"),
      h("button", { style: S.btn + `;color:${C.amber}`, onclick: () => saveSection(ctx, state, { um: { [name]: draft } }, true, name) }, "Save and restart"),
    ]));
    card.appendChild(box);
  }
  return card;
}

// ── Network: shown, not edited (a wrong value leaves the unit unreachable) ──
function networkCard(ctx, cfg) {
  const card = h("div", { style: S.card });
  card.appendChild(h("div", { style: "font-weight:700;margin-bottom:6px" }, "Wi-Fi, access point & security"));
  const nets = getP(cfg, ["nw", "ins"]);
  if (Array.isArray(nets)) {
    card.appendChild(h("div", { style: "font-size:12px" }, "Networks: " + (nets.map(n => n.ssid).filter(Boolean).join(", ") || "none")));
  }
  const ap = getP(cfg, ["ap"]);
  if (ap) card.appendChild(h("div", { style: "font-size:12px" }, `Access point: ${ap.ssid || "?"} · opens ${["when not connected after boot", "when disconnected", "always", "by button only", "temporarily"][ap.behav] || "?"}`));
  card.appendChild(h("div", { style: `font-size:12px;color:${C.dim};margin-top:6px` },
    "Changed on the device's own settings page on purpose: a wrong value here leaves the controller unreachable, and no backup can fix that from here."
    + (ctx.info.ip ? ` Open http://${ctx.info.ip}/settings on your home network.` : "")));
  return card;
}
