// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
// See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
/**
 * Diagnostics view — compact JSON dump of UI and backend state.
 * Only includes labelled / confirmed / recently-seen devices to keep
 * the output small enough to paste into a chat or AI conversation.
 */

export function render(ctx){
  const { el } = ctx.helpers;
  const root = el("section",{id:"diagnostics"});
  root.className = ctx.state.view==="diagnostics" ? "" : "hidden";

  // ── Build a trimmed snapshot: only devices with a label, confirmation,
  //    or an identified name, and only those seen in the last 24 hours.
  const MAX_AGE_S = 86400;
  const snap = ctx.state.live && ctx.state.live.snapshot;
  let trimmedSnap = null;
  let totalDevices = 0;
  let includedDevices = 0;
  if (snap && typeof snap === "object") {
    trimmedSnap = {};
    const keys = Object.keys(snap);
    totalDevices = keys.length;
    for (const k of keys) {
      const d = snap[k];
      if (!d) continue;
      const hasLabel = !!(d.user_label || d.name || d.identified);
      const hasRoom = !!(d.room);
      if (!hasLabel && !hasRoom) continue;
      // Skip very stale entries (oldest source age > 24h)
      const sources = d.sources || [];
      const minAge = sources.length
        ? Math.min(...sources.map(s => s.age_s || Infinity))
        : Infinity;
      if (minAge > MAX_AGE_S) continue;
      // Compact: strip all_addresses if huge (e.g. Pixel phone with 200+ MACs)
      const copy = Object.assign({}, d);
      if (copy.all_addresses && copy.all_addresses.length > 10) {
        copy.all_addresses = copy.all_addresses.slice(0, 5);
        copy._addr_truncated = true;
      }
      // Trim sources to top 6 by RSSI
      if (copy.sources && copy.sources.length > 6) {
        copy.sources = copy.sources
          .slice()
          .sort((a, b) => (b.rssi || -999) - (a.rssi || -999))
          .slice(0, 6);
        copy._sources_truncated = true;
      }
      trimmedSnap[k] = copy;
      includedDevices++;
    }
  }

  const payload = {
    ui: {
      version: ctx.state.version,
      buildId: ctx.state.buildId,
      view: ctx.state.view,
      dataMode: ctx.state.dataMode,
      timing: ctx.state.timing,
      wsCounts: ctx.state.wsCounts,
    },
    backend: {
      versionInfo: ctx.state.versionInfo,
      status: ctx.state.status,
      roomTagMap: ctx.state.roomTagMap,
      maps: ctx.state.maps.list,
    },
    snapshot: {
      _summary: `${includedDevices} of ${totalDevices} devices (labelled/confirmed, seen <24h)`,
      devices: trimmedSnap,
    },
    autoDiagnostics: ctx.state.diag,
  };

  const text = JSON.stringify(payload, null, 2);

  // Use a textarea so manual select/copy always works (even on http:// where
  // navigator.clipboard is often blocked).
  const ta = el("textarea", {
    class: "mono",
    style: "width:100%;height:420px;resize:vertical;white-space:pre;overflow:auto;",
    readonly: true,
  });
  ta.value = text;

  const selectAll = ()=>{
    ta.focus();
    ta.select();
  };

  const btnSelect = el("button",{class:"btn"}, "Select All");
  btnSelect.addEventListener("click", ()=>{
    selectAll();
    ctx.toast("Selected. Press Ctrl/Cmd+C to copy.");
  });

  const btnDownload = el("button",{class:"btn"}, "Download Report");
  btnDownload.addEventListener("click", ()=>{
    const ts = new Date().toISOString().replace(/[:.]/g,"-").slice(0,19);
    const blob = new Blob([text], {type:"application/json"});
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `padspan-diag-${ts}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    ctx.toast("Downloaded diagnostic report.");
  });

  const btnCopy = el("button",{class:"btn"}, "Copy");
  btnCopy.addEventListener("click", async ()=>{
    // Try modern clipboard first (works on https:// or localhost)
    try {
      await navigator.clipboard.writeText(text);
      ctx.toast("Copied diagnostics.");
      return;
    } catch (e) {}

    // Fallback: hidden textarea on document.body (bypasses HA shadow DOM)
    try {
      const tmp = document.createElement("textarea");
      tmp.value = text;
      tmp.setAttribute("readonly", "");
      tmp.style.cssText = "position:fixed;left:-9999px;top:0;opacity:0";
      document.body.appendChild(tmp);
      tmp.focus();
      tmp.select();
      const ok = document.execCommand && document.execCommand("copy");
      document.body.removeChild(tmp);
      if (ok) {
        ctx.toast("Copied diagnostics.");
        return;
      }
    } catch (e2) {}

    // Last resort: select in the visible textarea
    selectAll();
    ctx.toast("Auto-copy blocked. Text selected — press Ctrl+C.", true);
  });

  const sizeKb = Math.round(text.length / 1024);
  root.appendChild(el("div",{class:"grid"},[
    el("div",{class:"card"},[
      el("div",{style:"display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap"},[
        el("div",{},[
          el("div",{style:"display:flex;align-items:center;gap:8px"},[
            el("div",{style:"font-weight:700"}, "Diagnostics"),
            ctx.helpers.helpBtn("diagnostics"),
          ]),
          el("div",{class:"muted"}, `${includedDevices} devices · ${sizeKb} KB — when something breaks, email it to hello@traks.ca or attach it to a GitHub issue (issues are public: remove personal details first)`),
        ]),
        el("div",{style:"display:flex;gap:8px;align-items:center"},[ btnSelect, btnCopy, btnDownload ])
      ]),
      ta,
    ]),

    el("div",{class:"card"},[
      el("div",{style:"font-weight:700"}, "Install Verification"),
      el("div",{class:"muted"}, "If UI/Backend versions differ, HA is serving an older install or cached JS."),
      el("div",{class:"mono"}, `UI: v${ctx.state.version} • build ${ctx.state.buildId}`),
      el("div",{class:"mono"}, `Backend: ${ctx.state.versionInfo ? JSON.stringify(ctx.state.versionInfo) : "unknown"}`),
      el("div",{class:"muted", style:"margin-top:8px"}, "If backend version differs from UI, you likely have multiple installs (HACS + manual, or multiple custom_components copies). Remove duplicates and restart HA."),
    ]),
  ]));

  return root;
}
