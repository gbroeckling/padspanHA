// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
// See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
/**
 * Diagnostics view — compact JSON dump of UI and backend state.
 * Only includes labelled / confirmed / recently-seen devices to keep
 * the output small enough to paste into a chat or AI conversation.
 */

// Monitor → Export for support's rules: whose devices are "mine", and phones'
// identity keys (IRKs) left out of anything meant to be sent.
const { _isMine, hideIrks } = await import(`./monitor.js${new URL(import.meta.url).search}`);

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
    // The devices are the snapshot's objects.list. (This loop went over the
    // snapshot's own top-level keys, rooms, ble, objects and so on, so the
    // report counted those as "devices" and listed almost none.)
    const list = (snap.objects && Array.isArray(snap.objects.list)) ? snap.objects.list : [];
    totalDevices = list.length;
    for (const d of list) {
      if (!d || typeof d !== "object") continue;
      const k = d.key || d.address || d.entity_id;
      if (!k) continue;
      // The person's own devices only: named by them, linked to Home
      // Assistant, or a phone known by its key (monitor.js _isMine). "A name
      // or a room" let everything in: the server names every Bluetooth object
      // (its address when nothing else) and gives every heard one the room of
      // its loudest receiver, so the report held every passing device
      // (thousands on a busy street, built again on every 5 s update).
      if (!_isMine(d)) continue;
      // Skip very stale entries: the freshest age the object or its sources
      // report is over 24 h. Nothing reported (an entity) is kept.
      const ages = [d.age_s, ...(Array.isArray(d.sources) ? d.sources.map(s => s && s.age_s) : [])]
        .filter(a => typeof a === "number" && Number.isFinite(a));
      if (ages.length && Math.min(...ages) > MAX_AGE_S) continue;
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
      _summary: `${includedDevices} of ${totalDevices} devices (labelled/confirmed/known phones, seen <24h)`,
      devices: trimmedSnap,
    },
    autoDiagnostics: ctx.state.diag,
  };

  const text = hideIrks(JSON.stringify(payload, null, 2));

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
          el("div",{class:"muted","data-diag-privacy":"",style:"margin-top:4px"},
            "It names your rooms, floor plans and devices, with their Bluetooth addresses, so look it over before you send it. Phones' identity keys (IRKs) are left out."),
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
