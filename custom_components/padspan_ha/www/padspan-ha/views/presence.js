// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
// See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
/**
 * Presence view — lookup tool for object-to-room presence.
 * Enter an object/tag ID to see which rooms it appears in, using the
 * roomTagMap inverse index. Useful for debugging room assignment and
 * verifying that objects are detected where expected.
 */

export function render(ctx){
  const { el, radioShortId } = ctx.helpers;
  const _sid = (source) => radioShortId ? radioShortId(source || "") : "";
  const { roomTagMap } = ctx.state;

  const root = el("section",{id:"presence"});
  root.className = ctx.state.view==="presence" ? "" : "hidden";

  const snap = (ctx.state.live && ctx.state.live.snapshot) || null;
  const isLive = ctx.state.dataMode === "live";

  // --- Original: room→tag lookup ---
  const tagRooms = {};
  for(const r of Object.keys(roomTagMap||{})){
    for(const t of (roomTagMap[r]||[])){
      const k=String(t);
      tagRooms[k]=tagRooms[k]||[];
      tagRooms[k].push(r);
    }
  }
  Object.keys(tagRooms).forEach(k=>tagRooms[k].sort((a,b)=>a.localeCompare(b)));

  const input = el("input",{type:"text", placeholder:"Enter object id (e.g., tag.keys)"});
  const out = el("div",{class:"mono"},"Enter an object id to see which rooms it appears in.");
  const btn = el("button",{class:"btn"}, "Find");

  btn.addEventListener("click", ()=>{
    const id = (input.value||"").trim();
    if(!id){ out.textContent="Enter an object id first."; return; }
    const rooms = tagRooms[id] || [];
    out.textContent = rooms.length ? `Object: ${id}\nSeen in rooms:\n- ${rooms.join("\n- ")}` : `No sightings for ${id}.`;
  });

  root.appendChild(el("div",{class:"card"},[
    el("div",{class:"muted"},"Presence model (derived from object↔room sightings)"),
    el("div",{class:"toolbar"},[input, btn]),
    out,
  ]));

  // --- BLE presence: objects by scanner ---
  if(snap){
    const bleAds = (snap.ble && Array.isArray(snap.ble.advertisements)) ? snap.ble.advertisements : [];
    const radios = (snap.ble && Array.isArray(snap.ble.radios)) ? snap.ble.radios : [];
    const objList = (snap.objects && Array.isArray(snap.objects.list)) ? snap.objects.list : [];

    // Build addr → object metadata index (for user_label, identified)
    const objIndex = new Map();
    for(const o of objList){
      if(o.address) objIndex.set(String(o.address).toUpperCase(), o);
    }

    // Build scanner name + area lookup
    const radioNames = {};
    const radioAreas = {};
    for(const r of radios){
      const src = String(r.source || "");
      if(src){
        radioNames[src] = r.name || src;
        if(r.area_name) radioAreas[src] = r.area_name;
      }
    }

    // Use isScanner helper to filter scanner self-detections
    const _isScanner = ctx.helpers.isScanner || (() => false);

    // Group advertisements by scanner source, keep best RSSI per address
    const scannerDevices = {};
    for(const ad of bleAds){
      const src = String(ad.source || "unknown");
      const addr = String(ad.address || "").toUpperCase();
      if(!addr) continue;
      // Skip advertisements FROM scanner devices (they're infrastructure, not trackable)
      if(_isScanner({address: addr, name: ad.name || ""})) continue;
      if(!scannerDevices[src]) scannerDevices[src] = {};
      const existing = scannerDevices[src][addr];
      const rssi = Number(ad.rssi);
      if(!existing || (isFinite(rssi) && rssi > (existing.rssi || -Infinity))){
        scannerDevices[src][addr] = { addr, rssi: isFinite(rssi)?rssi:null, name: ad.name||"", age_s: ad.age_s };
      }
    }

    const scanners = Object.keys(scannerDevices).sort();

    if(scanners.length){
      const scannerCards = el("div",{style:"columns:3;column-gap:10px"});

      for(const src of scanners){
        const sid = _sid(src);
        const scannerName = (sid ? sid+" " : "") + (radioNames[src] || src);
        const devs = Object.values(scannerDevices[src])
          .sort((a,b)=>(b.rssi||(-Infinity))-(a.rssi||(-Infinity)))
          .slice(0, 50);

        const _quietMode = !!(ctx.state.settings && ctx.state.settings.quiet_mode);
        const tagged = devs.filter(d=>{ const o=objIndex.get(d.addr); return o && (o.user_label||o.identified); });
        const untagged = _quietMode ? [] : devs.filter(d=>{ const o=objIndex.get(d.addr); return !o || (!o.user_label && !o.identified); });

        const devRow = d => {
          const o = objIndex.get(d.addr);
          const label = (o && o.user_label) || (o && o.name) || d.name || d.addr;
          const rssiStr = d.rssi!=null ? `RSSI ${d.rssi}` : "";

          // Use stable identifier for private_ble/ibeacon — their raw BLE
          // address is not a durable key (private_ble MAC addresses rotate
          // periodically by the Bluetooth spec's own design; an iBeacon has
          // no MAC-like address at all, just a UUID/major/minor triple), so
          // tagging by d.addr here would silently orphan the tag the next
          // time the address rotates. canonical_id/key are the identity the
          // backend already resolved rotation/beacon-id down to.
          const kind = o && o.kind;
          const tagAddr = kind === "private_ble" ? (o.canonical_id || d.addr)
                        : kind === "ibeacon"     ? (o.key || d.addr)
                        : d.addr;
          const tagBtn = el("button",{class:"btn tiny"}, o&&o.user_label ? "Relabel" : "Tag");
          tagBtn.addEventListener("click",()=>ctx.actions.tagObjectPrompt(tagAddr, (o&&o.user_label)||""));

          // Follow toggle
          const followKey = (d.addr || (o && o.entity_id) || "").toUpperCase();
          const followBtn = (() => {
            if(!followKey) return null;
            const isF = ctx.actions.followedHas(followKey);
            const btn = el("button",{class:"btn tiny", style: isF ? "background:#1a3a2a;border-color:#52b788;color:#52b788" : ""}, isF ? "Following" : "Follow");
            btn.addEventListener("click",()=>{
              ctx.actions.followedToggle(followKey);
              const nowF = ctx.actions.followedHas(followKey);
              btn.textContent = nowF ? "Following" : "Follow";
              btn.style.cssText = nowF ? "background:#1a3a2a;border-color:#52b788;color:#52b788" : "";
            });
            return btn;
          })();

          // Clickable label for drill-down
          const labelEl = el("span",{style:"cursor:pointer"}, label);
          labelEl.addEventListener("click",()=>{
            const detailObj = o || { address: d.addr, name: d.name || d.addr, kind: "ble" };
            ctx.actions.showObjectDetail(detailObj);
          });

          return el("div",{class:"item",style:"display:flex;align-items:center;gap:6px;padding:4px 0;border-bottom:1px solid #1e293b;overflow:hidden"},[
            el("div",{style:"flex:1;min-width:0;overflow:hidden"},[
              el("div",{style:"display:flex;align-items:center;gap:6px;overflow:hidden"},[
                (() => { const s = el("span",{style:"cursor:pointer;font-size:12px"}, label); s.addEventListener("click",()=>{ const detailObj = o || { address: d.addr, name: d.name || d.addr, kind: "ble" }; ctx.actions.showObjectDetail(detailObj); }); return s; })(),
                rssiStr ? el("span",{class:"muted", style:"white-space:nowrap;font-size:11px"}, rssiStr) : null,
              ].filter(Boolean)),
            ]),
            followBtn,
            tagBtn,
          ].filter(Boolean));
        };

        const areaName = radioAreas[src];
        const card = el("div",{class:"card",style:"overflow:hidden;break-inside:avoid;margin-bottom:10px"},[
          el("div",{class:"row",style:"flex-wrap:wrap;gap:4px"},[
            el("div",{style:"flex:1;min-width:0"},[
              el("div",{class:"h2",style:"overflow:hidden;text-overflow:ellipsis;white-space:nowrap"}, scannerName),
              areaName ? el("div",{class:"muted",style:"font-size:12px;margin-top:2px"}, areaName) : null,
            ].filter(Boolean)),
            el("span",{class:"badge"}, `${tagged.length} tagged`),
            _quietMode ? null : el("span",{class:"badge warn"}, `${untagged.length} untagged`),
          ]),
          el("div",{class:"muted",style:"overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px"}, src),
          tagged.length ? el("div",{},[
            el("div",{class:"muted",style:"margin:6px 0 2px"},"Tagged"),
            el("div",{class:"list"}, tagged.map(devRow)),
          ]) : null,
          untagged.length ? el("div",{},[
            el("div",{class:"muted",style:"margin:6px 0 2px"},"Unidentified"),
            el("div",{class:"list"}, untagged.map(devRow)),
          ]) : null,
        ].filter(Boolean));

        scannerCards.appendChild(card);
      }

      root.appendChild(el("div",{class:"card"},[
        el("div",{class:"muted"},"BLE Objects by Scanner (live)"),
        el("div",{class:"muted", style:"margin-bottom:8px"}, "Objects visible to each scanner, sorted by signal strength. Use Tag to label unknown devices."),
      ]));
      root.appendChild(scannerCards);
    } else {
      root.appendChild(el("div",{class:"card"},[
        el("div",{class:"muted"},"No BLE scanner data yet. Ensure Bluetooth is enabled in HA."),
      ]));
    }
  }

  return root;
}
