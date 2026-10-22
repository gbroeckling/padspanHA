// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
// See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html

// The iPhone setup path (GitHub #69). "BLE Transmitter" is a sensor in the
// Android Companion App only; an iPhone owner looking for it finds nothing.
// An iPhone is followed by its IRK, added through HA's Private BLE Device
// integration. Behind Settings → Experimental → "iPhone Setup Path"
// (iphone_irk_guide, off by default): with it off, nothing here is drawn and
// every screen reads as it did.
//
// The ways of getting the key are the ones PadSpan already documents: the
// IRK Capture ESP32 (its scan lives in the phone wizard) and a Mac (the
// Terminal command, and the Keychain way in Settings → Phone Tracking →
// Detailed Setup Guide). Nothing here writes anything: the check is
// padspan_ha/irk_validate, which only tests the key against the air.

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

export const IPHONE_IRK_STEPS = [
  "Get the iPhone's IRK (Identity Resolving Key). Either pair the iPhone with an ESP32 running " +
    "DerekSeaman's irk-capture (github.com/DerekSeaman/irk-capture), then press Auto-detect IRKs in " +
    "Bluetooth → IRK Manager; or, on a Mac signed into the same iCloud account, run " +
    MAC_IRK_COMMAND + " and copy the IRK under the iPhone's name (Settings → Phone Tracking → " +
    "Detailed Setup Guide has the Keychain way too).",
  "Add it in Home Assistant: Settings → Devices & services → Add integration → Private BLE Device, " +
    "and paste the IRK. PadSpan picks it up from there within a minute.",
  "Check it resolves: with the iPhone awake near a scanner, it shows in Bluetooth → IRK Manager → " +
    "Registered IRK devices and the Resolved count goes up. \u201cTest only\u201d there checks a key without saving it.",
];

/** The text the Overview's Setup button shows for an iPhone. */
export function iphoneSetupAlert() {
  return "To track this iPhone:\n\n" +
    IPHONE_IRK_STEPS.map((s, i) => `${i + 1}. ${s}`).join("\n\n");
}

export const IPHONE_META = "iPhone · tracked by its IRK, press Setup";

export const NO_PHONES_TEXT =
  "No phones detected. Android: enable the HA Companion App with BLE Transmitter. " +
  "iPhone: add its IRK instead (Bluetooth → IRK Manager).";

export const HELP_NOTE_TEXT =
  "Not seeing your phone? Android: open Companion App → Settings → Companion App → Manage Sensors → " +
  "BLE Transmitter → Enable. iPhone: there is no such setting; add its IRK (Bluetooth → IRK Manager).";

/** The wizard's "I have an iPhone" path: the three steps, with a read-only
 *  check that the key resolves. `apple` lists Companion apps that look like
 *  iPhones, so the path can say it spotted one. */
export function renderIphonePath(ctx, pathEl, apple = []) {
  const { el } = ctx.helpers;
  if (apple.length) {
    pathEl.appendChild(el("div", { class: "bt-note info", style: "font-size:12px;margin-bottom:8px" },
      `Looks like an iPhone: ${apple.join(", ")}. These are the steps for it.`));
  }
  const ol = el("ol", { class: "muted", style: "font-size:12px;line-height:1.55;margin:0 0 8px;padding-left:18px" });
  for (const s of IPHONE_IRK_STEPS) ol.appendChild(el("li", { style: "margin-bottom:5px" }, s));
  pathEl.appendChild(ol);

  const row = el("div", { style: "display:flex;gap:6px;flex-wrap:wrap;align-items:center" });
  const inp = el("input", { class: "input", type: "text", placeholder: "IRK (hex or base64)", style: "flex:1;min-width:180px" });
  const btn = el("button", { class: "btn inline" }, "Check");
  const msg = el("div", { style: "font-size:12px;margin-top:7px;min-height:16px" });
  btn.addEventListener("click", async () => {
    const irk = String(inp.value || "").trim();
    if (!irk) { msg.style.color = "var(--bt-ok)"; msg.textContent = "Paste the IRK first."; return; }
    btn.disabled = true; msg.style.color = "var(--bt-dim)"; msg.textContent = "Checking…";
    try {
      const r = await ctx.actions.wsCall("padspan_ha/irk_validate", { irk_hex: irk });
      if (r.valid) {
        msg.style.color = "var(--bt-good)";
        msg.textContent = `It resolves: ${r.matched_count} of ${r.rpa_count} rotating addresses heard now are this iPhone.`;
      } else if (r.not_an_irk) {
        msg.style.color = "var(--bt-bad)";
        msg.textContent = r.not_an_irk;
      } else {
        msg.style.color = "var(--bt-ok)";
        msg.textContent = `Nothing heard right now resolves with it (${r.rpa_count} tested). ` +
          "Wake the iPhone near a scanner and check again; if it still fails, the key is wrong.";
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
