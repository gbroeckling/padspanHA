// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
// See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html

// The iPhone setup path (GitHub #69). "BLE Transmitter" is a sensor in the
// Android Companion App only; an iPhone owner looking for it finds nothing.
// An iPhone is followed by its IRK, added through HA's Private BLE Device
// integration. Behind Settings → Features → Experimental Features → "iPhone Setup Path"
// (iphone_irk_guide, off by default): with it off, nothing here is drawn and
// every screen reads as it did.
//
// The ways of getting the key are the ones PadSpan already documents: the
// IRK Capture ESP32 (its steps, renderCaptureSteps, are the phone wizard's
// first path) and a Mac (the Terminal command, and the Keychain way in
// Settings → Tracking → Phones and guest tags → Phone Tracking (Private BLE)
// → Detailed Setup Guide, settings.js). The iPhone path writes
// nothing: its check is padspan_ha/irk_validate, which only tests the key
// against the air. The capture steps save the key the person chose to save.
//
// It also holds the Android phone's one check that is not about a key
// (transmitterAdvice): the Overview's phone rows warn when the Companion
// app's BLE Transmitter is set too weak to be heard.
//
// Every text is a function (or a getter) so it is read when drawn, in the
// panel's language then (views/i18n.js; English is the key).
const { t } = await import(`./i18n.js${new URL(import.meta.url).search}`);

export function iphoneGuideOn(settings) {
  return !!settings && settings.iphone_irk_guide === true;
}

/** An Apple phone or tablet, from what companion_discover / the HA device
 *  registry say about it. A name alone counts only when it says iPhone/iPad. */
export function isApplePhone(phone) {
  const p = phone || {};
  if (/\bapple\b/i.test(p.manufacturer || "")) return true;
  if (/^\s*i(os|pados)\b/i.test(p.os_name || "")) return true;
  return /\bi(phone|pad)/i.test(`${p.model || ""} ${p.device_name || ""} ${p.name || ""}`);
}

export const MAC_IRK_COMMAND =
  "sudo defaults read /private/var/root/Library/Preferences/com.apple.bluetoothd.plist";

export function iphoneIrkSteps() {
  return [
    t("Get the iPhone's IRK (Identity Resolving Key). Either pair the iPhone with an ESP32 running DerekSeaman's irk-capture (github.com/DerekSeaman/irk-capture): Bluetooth → IRK Manager → “I have an IRK Capture ESP32” takes you through it and saves the key; or, on a Mac signed into the same iCloud account, run {command} and copy the IRK under the iPhone's name (Settings → Tracking → Phones and guest tags → Phone Tracking (Private BLE) → Detailed Setup Guide has the Keychain way too).",
      { command: MAC_IRK_COMMAND }),
    t("Add it in Home Assistant: Settings → Devices & services → Add integration → Private BLE Device, and paste the IRK. PadSpan picks it up from there within a minute."),
    t("Check it resolves: with the iPhone awake near a scanner, it shows in Bluetooth → IRK Manager → Registered IRK devices and the Resolved count goes up. “Test only” there checks a key without saving it."),
  ];
}

/** The text the Overview's Setup button shows for an iPhone. */
export function iphoneSetupAlert() {
  return t("To track this iPhone:") + "\n\n" +
    iphoneIrkSteps().map((s, i) => `${i + 1}. ${s}`).join("\n\n");
}

export const iphoneMeta = () => t("iPhone · tracked by its IRK, press Setup");

export const noPhonesText = () =>
  t("No phones detected. Android: enable the HA Companion App with BLE Transmitter. iPhone: add its IRK instead (Bluetooth → IRK Manager).");

export const helpNoteText = () =>
  t("Not seeing your phone? Android: open Companion App → Settings → Companion App → Manage Sensors → BLE Transmitter → Enable. iPhone: there is no such setting; add its IRK (Bluetooth → IRK Manager).");

// An Android phone's BLE Transmitter reports its own settings as attributes
// of its sensor, which companion_discover passes on as phone.attributes:
// "Transmitting power" (ultraLow, low, medium, high) and "Advertise mode"
// (lowPower, balanced, lowLatency). The app starts on ultraLow and lowPower,
// which receivers barely hear. Keys and values are compared without case,
// spaces or underscores. Returns what to change, or "" when both are fine or
// not reported (an iPhone, or an app that does not say).
export function transmitterAdvice(attrs) {
  const norm = (v) => String(v ?? "").toLowerCase().replace(/[^a-z]/g, "");
  const read = (want) => {
    for (const [k, v] of Object.entries(attrs || {})) if (norm(k) === want) return norm(v);
    return "";
  };
  const power = read("transmittingpower"), mode = read("advertisemode");
  const set = [];
  if (power === "ultralow" || power === "low") set.push(t("Transmit power to High"));
  if (mode === "lowpower") set.push(t("Advertise mode to Low latency"));
  if (!set.length) return "";
  return t("Sends too weakly for receivers to hear it well. In the Companion app, open Settings → Companion app → Manage sensors → BLE Transmitter and set {what}.",
    { what: set.length > 1 ? t("{a} and {b}", { a: set[0], b: set[1] }) : set[0] });
}

/** The wizard's "I have an iPhone" path: the three steps, with a read-only
 *  check that the key resolves. `apple` lists Companion apps that look like
 *  iPhones, so the path can say it spotted one. */
export function renderIphonePath(ctx, pathEl, apple = []) {
  const { el } = ctx.helpers;
  if (apple.length) {
    pathEl.appendChild(el("div", { class: "bt-note info", style: "font-size:12px;margin-bottom:8px" },
      t("Looks like an iPhone: {names}. These are the steps for it.", { names: apple.join(", ") })));
  }
  // overflow-wrap: the Mac command's long path breaks at a phone's width instead of pushing the page sideways.
  const ol = el("ol", { class: "muted", style: "font-size:12px;line-height:1.55;margin:0 0 8px;padding-left:18px;overflow-wrap:anywhere" });
  for (const s of iphoneIrkSteps()) ol.appendChild(el("li", { style: "margin-bottom:5px" }, s));
  pathEl.appendChild(ol);

  const row = el("div", { style: "display:flex;gap:6px;flex-wrap:wrap;align-items:center" });
  const inp = el("input", { class: "input", type: "text", placeholder: t("IRK (hex or base64)"), style: "flex:1;min-width:180px" });
  const btn = el("button", { class: "btn inline" }, t("Check"));
  const msg = el("div", { style: "font-size:12px;margin-top:7px;min-height:16px" });
  btn.addEventListener("click", async () => {
    const irk = String(inp.value || "").trim();
    if (!irk) { msg.style.color = "var(--bt-ok)"; msg.textContent = t("Paste the IRK first."); return; }
    btn.disabled = true; msg.style.color = "var(--bt-dim)"; msg.textContent = t("Checking…");
    try {
      const r = await ctx.actions.wsCall("padspan_ha/irk_validate", { irk_hex: irk });
      if (r.valid) {
        msg.style.color = "var(--bt-good)";
        msg.textContent = t("It resolves: {matched} of {tested} rotating addresses heard now are this iPhone.", { matched: r.matched_count, tested: r.rpa_count });
      } else if (r.not_an_irk) {
        msg.style.color = "var(--bt-bad)";
        msg.textContent = r.not_an_irk;
      } else {
        msg.style.color = "var(--bt-ok)";
        msg.textContent = t("Nothing heard right now resolves with it ({tested} tested). Wake the iPhone near a scanner and check again; if it still fails, the key is wrong.", { tested: r.rpa_count });
      }
    } catch (e) {
      msg.style.color = "var(--bt-bad)";
      msg.textContent = (e && e.message) || "Check failed";
    }
    btn.disabled = false;
  });
  row.appendChild(inp);
  row.appendChild(btn);
  pathEl.appendChild(row);
  pathEl.appendChild(msg);
  return pathEl;
}

// ── The IRK Capture ESP32, step by step (the phone wizard's first path) ─────
// Name and person come first, so the key lands named and linked: it is saved
// under the name typed (never the ESP32's own name, never "Auto-detected"),
// the device is labelled with it (which gives it its Home Assistant
// entities), and, with a person picked, it is added to what that person
// carries (settings.atlas_3d_carries: Live Aboard's People & devices, and the
// people count). An iPhone and an Apple Watch pair in different places.
// Afterwards the pairing is removed, and before the next device the ESP32
// gets a new Bluetooth identity, or the device paired before connects to it
// again. Android phones never come this way: they don't keep sending
// adverts with this key in the background.
// The keys come from padspan_ha/irk_auto_detect: what each irk-capture ESP32
// in Home Assistant holds now, and this Home Assistant's own Bluetooth bonds.

export const captureAndroid = () =>
  t("For an iPhone or Apple Watch. Android phones can't be added this way: they don't keep sending this key in the background. Track an Android phone with the Companion app's BLE Transmitter instead.");

export const CAPTURE_PAIR = {
  get iphone() { return t("On the iPhone, open Settings → Bluetooth and tap the ESP32 under Other Devices to pair. Not listed? Switch the ESP32's profile in Home Assistant (Keyboard or Heart Sensor) and look again."); },
  get watch() { return t("On the watch, open Settings → Bluetooth and tap the ESP32 under Health Devices to pair. Its profile in Home Assistant needs to be Heart Sensor."); },
};

export const CAPTURE_FORGET = {
  get iphone() { return t("On the iPhone: Settings → Bluetooth → ⓘ beside the ESP32 → Forget This Device."); },
  get watch() { return t("On the watch: Settings → Bluetooth → the ESP32 → Forget Device."); },
};

// The ESP32's own button name, as Home Assistant shows it: never translated.
export function captureNextText(refresh) {
  return t("Press “{button}” on the ESP32 in Home Assistant, so the device you just paired doesn't connect to it again. Then start again at 1.",
    { button: refresh || "Refresh BLE Identity" });
}

/** A scan's keys that can be saved, or why there are none.
 *  found, devices: irk_auto_detect's found and capture_devices. */
export function captureFindings(found, devices) {
  const fresh = (found || []).filter(f => !f.already_registered);
  if (fresh.length) return { keys: fresh, note: "" };
  const known = (found || []).find(f => f.already_registered && f.source === "irk_capture");
  if (known) {
    return { keys: [], note: known.registered_as
      ? t("The key on “{device}” is one PadSpan already has (“{name}”). Do step 5, pair the next device, then look again.", { device: known.name, name: known.registered_as })
      : t("The key on “{device}” is one PadSpan already has. Do step 5, pair the next device, then look again.", { device: known.name }) };
  }
  const empty = (devices || []).find(d => !d.has_key);
  if (empty) return { keys: [], note: t("“{device}” has no key yet. Pair the device (step 2), then look again.", { device: empty.name }) };
  return { keys: [], note: t("No irk-capture ESP32 found in Home Assistant. Add it there (Settings → Devices & services → ESPHome), or paste the key from its IRK sensor below.") };
}

// A saved key's device gets its name, and goes to the person picked.
// Returns what could not be saved, in words.
async function _linkKey(ctx, key, name, person) {
  const failed = [];
  try { await ctx.actions.wsCall("padspan_ha/object_label_set", { address: key, label: name }); }
  catch (_) { failed.push(t("its name")); }
  if (person) {
    const cur = (ctx.state.settings && ctx.state.settings.atlas_3d_carries) || {};
    const mine = Array.isArray(cur[person]) ? cur[person] : [];
    const next = { ...cur, [person]: mine.includes(key) ? mine : [...mine, key] };
    try {
      const r = await ctx.actions.wsCall("padspan_ha/settings_set", { atlas_3d_carries: next });
      if (ctx.state.settings) ctx.state.settings.atlas_3d_carries = (r && r.settings && r.settings.atlas_3d_carries) || next;
    } catch (_) { failed.push(t("whose it is")); }
  }
  return failed;
}

/** The five steps, drawn into pathEl. save(name, irk, msgEl, after, via) is
 *  bluetooth.js's _addIrk: saved only if the key resolves something on the
 *  air, or the person saves it unverified; after(result) once saved. via is
 *  "irk_capture" for a key from the ESP32 (found on it, or pasted from its
 *  IRK sensor), "" for one of Home Assistant's own Bluetooth bonds. What
 *  was typed and found lives in ctx.state._irkCapture, across redraws. */
export function renderCaptureSteps(ctx, pathEl, save) {
  const { el } = ctx.helpers;
  const S = ctx.state._irkCapture || (ctx.state._irkCapture = { name: "", person: "", kind: "iphone", found: null, devices: [], done: "" });
  const states = (ctx.hass && ctx.hass.states) || {};
  const people = Object.keys(states).filter(e => e.startsWith("person.")).sort()
    .map(e => [e, String(((states[e] || {}).attributes || {}).friendly_name || e)]);
  const small = "font-size:12px;line-height:1.55";
  const step = (n, text) => el("div", { style: "font-weight:700;font-size:12px;margin:12px 0 5px" }, `${n}. ${text}`);

  pathEl.appendChild(el("div", { class: "bt-note", "data-capture": "android", style: small }, captureAndroid()));

  // 1. Its name, and whose it is.
  pathEl.appendChild(step(1, t("Its name, and whose it is")));
  const who = el("div", { style: "display:flex;gap:6px;flex-wrap:wrap" });
  const nameInp = el("input", { class: "input", type: "text", "data-capture": "name", placeholder: t("Name, e.g. Sam's iPhone"), style: "flex:1;min-width:160px" });
  nameInp.value = S.name;
  nameInp.addEventListener("input", () => { S.name = nameInp.value; });
  const sel = el("select", { class: "input", "data-capture": "person" });
  for (const [v, label] of [["", t("Nobody in particular")], ...people]) {
    const o = el("option", { value: v }, label);
    if (v === S.person) o.setAttribute("selected", "");
    sel.appendChild(o);
  }
  sel.addEventListener("change", () => { S.person = sel.value; });
  who.appendChild(nameInp);
  who.appendChild(sel);
  pathEl.appendChild(who);

  // 2. Pair it: an iPhone and an Apple Watch do it in different places.
  pathEl.appendChild(step(2, t("Pair it with the ESP32")));
  const kinds = el("div", { style: "display:flex;gap:6px;margin-bottom:6px" });
  for (const [k, label] of [["iphone", "iPhone"], ["watch", "Apple Watch"]]) {
    const b = el("button", { class: "btn tiny" + (S.kind === k ? " bt-btn-info" : ""), "data-capture-kind": k, "aria-pressed": String(S.kind === k) }, label);
    b.addEventListener("click", () => { S.kind = k; ctx.actions.renderRooms(); });
    kinds.appendChild(b);
  }
  pathEl.appendChild(kinds);
  pathEl.appendChild(el("div", { class: "muted", "data-capture": "pair", style: small }, CAPTURE_PAIR[S.kind] || CAPTURE_PAIR.iphone));

  // 3. Save its key, under the name from step 1.
  pathEl.appendChild(step(3, t("Save its key")));
  const findBtn = el("button", { class: "btn inline bt-btn-info", "data-capture": "find" }, t("Find the key"));
  const msg = el("div", { "data-capture": "msg", style: "font-size:12px;margin-top:7px;min-height:16px" });
  const keys = el("div", { "data-capture": "keys" });
  const saveAs = (irk, outEl, via) => {
    const name = String(S.name || "").trim();
    if (!name) { outEl.style.color = "var(--bt-ok)"; outEl.textContent = t("Type its name first (step 1)."); return; }
    const person = S.person;
    save(name, irk, outEl, async (r) => {
      const failed = r && r.canonical_id ? await _linkKey(ctx, r.canonical_id, name, person) : [];
      S.done = "✓ " + t("Saved “{name}”.", { name }) + (failed.length ? " " + t("Could not save {what}.", { what: failed.length > 1 ? t("{a} or {b}", { a: failed[0], b: failed[1] }) : failed[0] }) : "")
        + " " + t("Now do steps 4 and 5.");
      S.name = ""; S.person = "";
      S.found = (S.found || []).filter(f => f.irk_hex !== irk);
      ctx.state._irkPanelStatus = null;
      ctx.actions.renderRooms();
    }, via);
  };
  const draw = () => {
    keys.textContent = "";
    msg.style.color = "var(--bt-good)";
    msg.textContent = S.done || "";
    if (S.found === null) return;
    const { keys: fresh, note } = captureFindings(S.found, S.devices);
    if (note) { msg.style.color = S.done ? "var(--bt-good)" : "var(--bt-ok)"; msg.textContent = (S.done ? S.done + " " : "") + note; }
    for (const f of fresh) {
      const row = el("div", { "data-capture-key": f.source || "", style: "display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:6px;font-size:12px" });
      row.appendChild(el("span", {}, f.verified ? t("A key from “{device}”, heard right now", { device: f.name }) : t("A key from “{device}”", { device: f.name })));
      const out = el("div", { style: "font-size:12px;width:100%" });
      const b = el("button", { class: "btn tiny bt-btn-accent" }, t("Save"));
      b.addEventListener("click", () => saveAs(f.irk_hex, out, f.source === "irk_capture" ? "irk_capture" : ""));
      row.appendChild(b);
      row.appendChild(out);
      keys.appendChild(row);
    }
  };
  findBtn.addEventListener("click", async () => {
    findBtn.disabled = true;
    S.done = "";
    msg.style.color = "var(--bt-dim)";
    msg.textContent = t("Looking…");
    try {
      const r = await ctx.actions.wsCall("padspan_ha/irk_auto_detect", {});
      S.found = (r && r.found) || [];
      S.devices = (r && r.capture_devices) || [];
      draw();
    } catch (e) {
      msg.style.color = "var(--bt-bad)";
      msg.textContent = (e && e.message) || "Could not look for keys";
    }
    findBtn.disabled = false;
  });
  pathEl.appendChild(findBtn);
  pathEl.appendChild(msg);
  pathEl.appendChild(keys);
  const pasteRow = el("div", { style: "display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-top:8px" });
  const pasteInp = el("input", { class: "input", type: "text", "data-capture": "paste", placeholder: t("Or paste the key from the ESP32's IRK sensor"),
    style: "flex:1;min-width:180px;font-family:ui-monospace,SFMono-Regular,Consolas,monospace" });
  const pasteBtn = el("button", { class: "btn inline", "data-capture": "paste-save" }, t("Save"));
  const pasteOut = el("div", { style: "font-size:12px;width:100%" });
  pasteBtn.addEventListener("click", () => {
    const v = String(pasteInp.value || "").trim();
    if (!v) { pasteOut.style.color = "var(--bt-ok)"; pasteOut.textContent = t("Paste the key first."); return; }
    saveAs(v, pasteOut, "irk_capture");
  });
  pasteRow.appendChild(pasteInp);
  pasteRow.appendChild(pasteBtn);
  pasteRow.appendChild(pasteOut);
  pathEl.appendChild(pasteRow);
  draw();

  // 4 and 5: afterwards, and before the next device.
  pathEl.appendChild(step(4, t("Once it's saved, remove the pairing")));
  pathEl.appendChild(el("div", { class: "muted", "data-capture": "forget", style: small }, CAPTURE_FORGET[S.kind] || CAPTURE_FORGET.iphone));
  pathEl.appendChild(step(5, t("Before the next device")));
  const refresh = (S.devices || []).map(d => d.refresh).find(Boolean) || "";
  pathEl.appendChild(el("div", { class: "muted", "data-capture": "next", style: small }, captureNextText(refresh)));
  return pathEl;
}
