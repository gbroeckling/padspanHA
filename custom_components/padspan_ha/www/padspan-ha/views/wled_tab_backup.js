// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
// See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
/**
 * WLED workbench — Backup. PadSpan keeps cfg.json + presets.json per device,
 * keyed by the device's MAC: automatically before every settings change made
 * from the workbench, and on demand. A restore only ever goes back to the
 * same device (another unit's LED count breaks every segment bound), takes a
 * safety copy of the device first, and presets are checked after upload.
 * WLED's own UI hides "restore presets" and "restore config" side by side
 * and people pick the wrong one (wled/WLED#3778) — here they look different
 * and say what they do.
 */

const _q = new URL(import.meta.url).search;
const { C, S, h, errText, downloadJson } = await import(`./wled_ui.js${_q}`);

const stamp = (id) => `${id.slice(0, 4)}-${id.slice(4, 6)}-${id.slice(6, 8)} ${id.slice(9, 11)}:${id.slice(11, 13)}:${id.slice(13, 15)}`;

export function backupView(ctx) {
  const root = h("div");
  const list = h("div");
  const status = h("div", { style: `font-size:12px;color:${C.dim}` }, "Reading backups…");
  const run = (data) => ctx.call("padspan_ha/wled_backups", data);
  const fileBase = (ctx.info.name || "wled").replace(/\W+/g, "_");

  const paint = async () => {
    try {
      const { backups } = await run({ action: "list" });
      status.remove();
      list.innerHTML = "";
      if (!backups.length) list.appendChild(h("div", { style: `font-size:12px;color:${C.dim}` },
        "No backups yet. One is taken automatically before any settings change made here."));
      for (const b of backups) {
        const row = h("div", { style: S.card + ";display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:8px" }, [
          h("span", { style: "font-family:monospace;font-size:12px" }, stamp(b.id)),
          h("span", { style: `font-size:11px;color:${C.dim};flex:1` }, b.files.join(", ")),
          h("button", { style: S.btn, onclick: async () => {
            try {
              const { files } = await run({ action: "get", backup_id: b.id });
              for (const [name, data] of Object.entries(files)) downloadJson(`${fileBase}-${b.id}-${name}`, data);
            } catch (e) { ctx.toast("Couldn't read that backup: " + errText(e), true); }
          } }, "Download"),
        ]);
        if (ctx.isAdmin && b.files.includes("presets.json")) row.appendChild(h("button", { style: S.btn, onclick: async () => {
          if (!confirm(`Put back the presets from ${stamp(b.id)}?\n\nThe presets on the device now are backed up first.`)) return;
          try {
            const r = await run({ action: "restore_presets", backup_id: b.id });
            ctx.presets = null;
            ctx.toast(r.verified ? "Presets restored and checked" : "Presets uploaded, but the device didn't confirm them", !r.verified);
            paint();
          } catch (e) { ctx.toast("Couldn't restore: " + errText(e), true); }
        } }, "Restore presets"));
        if (ctx.isAdmin && b.files.includes("cfg.json")) row.appendChild(h("button", { style: S.btn + `;color:${C.amber};border-color:rgba(251,191,36,.45)`, onclick: async () => {
          if (!confirm(`Put back ALL settings from ${stamp(b.id)} — LED outputs, sync, Wi-Fi, everything?\n\nThe device reboots. Its settings now are backed up first.`)) return;
          try { await run({ action: "restore_cfg", backup_id: b.id }); ctx.toast("Settings restored — the device is rebooting"); }
          catch (e) { ctx.toast("Couldn't restore: " + errText(e), true); }
        } }, "Restore all settings"));
        list.appendChild(row);
      }
    } catch (e) {
      status.textContent = "Couldn't read backups: " + errText(e);
      status.style.color = C.red;
    }
  };
  if (ctx.isAdmin) root.appendChild(h("button", { style: S.btnPrimary + ";margin-bottom:10px", onclick: async () => {
    try { await run({ action: "create" }); ctx.toast("Backup taken"); paint(); }
    catch (e) { ctx.toast("Couldn't take a backup: " + errText(e), true); }
  } }, "Back up now"));
  root.appendChild(status);
  root.appendChild(list);
  paint();
  return root;
}
