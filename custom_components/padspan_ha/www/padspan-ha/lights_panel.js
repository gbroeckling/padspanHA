// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
// See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
/*
  PadSpan HA — Lights Control Panel
  ===================================
  Standalone HA sidebar panel: full-house light control on the same isometric
  3D floor-stack view used by the Overview tab.
  Tap a hexagon or table row to toggle a light on/off.

  BUILD_ID / APP_VERSION updated automatically by scripts/release.py.
*/

const APP_VERSION = "0.25.0";
const BUILD_ID = "20260811T060605Z";

// Shared stack transform (P2-5); query inherited from our own module URL so
// the ?b= cache-buster propagates (see docs/06_UI_CACHE_BUSTING.md).
const { assignLightCodes, isWledLight } =
  await import(`./views/light_codes.js${new URL(import.meta.url).search}`);
// THE shared lights map renderer — also used by the Mapping → Lights tab, so
// the two tools always show the identical map. All map edits go in there.
const { buildIsoSVG } =
  await import(`./views/iso_lights.js${new URL(import.meta.url).search}`);

// ── DOM helpers ──────────────────────────────────────────────────────────────
function el(tag, attrs={}, children=[]){
  const n = document.createElement(tag);
  for(const [k,v] of Object.entries(attrs||{})){
    if(k==="class")  n.className = v;
    else if(k==="id") n.id = v;
    else if(k==="style") n.setAttribute("style", v);
    else if(k.startsWith("on") && typeof v==="function") n.addEventListener(k.slice(2), v);
    else if(v!==undefined && v!==null) n.setAttribute(k, String(v));
  }
  if(!Array.isArray(children)) children=[children];
  for(const c of children){
    if(c===null||c===undefined) continue;
    if(typeof c==="string"||typeof c==="number") n.appendChild(document.createTextNode(String(c)));
    else n.appendChild(c);
  }
  return n;
}
function escSVG(s){ return String(s??"").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;"); }

// isWledLight comes from views/light_codes.js — a light counts as
// "WLED-class" (effects + full color) if it advertises an effect list.

// Room colour + hex geometry helpers live in views/iso_lights.js now.

// buildIsoSVG moved to views/iso_lights.js (shared with the Mapping → Lights tab).

// ── Persistence key ──────────────────────────────────────────────────────────
const LS_HIDDEN = "padspan_ha_lights_hidden";

// ── Custom element ────────────────────────────────────────────────────────────
class PadSpanLightsApp extends HTMLElement {
  constructor(){
    super();
    this._hass   = null;
    this._booted = false;
    this._pollTimer = null;
    this.state = {
      maps:        { list:[] },
      model:       { areas:[], floors:[] },
      _lightsReg:  null,
      _hiddenMapIds: new Set(),
      _hidden:     this._loadHidden(),
      _focusIdx:   0,      // index into _isoPos positions array (0 = all floors)
      _floorGap:   150,    // vertical separation between floors
      _horizGap:   0,      // horizontal L/R offset between floors
      _zoom:       1.0,
    };

    // Custom-element upgrade race: HA can set .hass on this element before
    // the browser finishes upgrading it to this class (the defining module
    // loads async over the network), which creates a plain instance
    // property that permanently shadows the `hass` accessor below — _boot()
    // would then never run and the panel stays blank forever. Reclaim any
    // pre-upgrade value through the accessor now that our class has taken over.
    if (Object.prototype.hasOwnProperty.call(this, "hass")) {
      const preUpgradeHass = this.hass;
      delete this.hass;
      this.hass = preUpgradeHass;
    }
  }

  _loadHidden(){
    try{ return new Set(JSON.parse(localStorage.getItem(LS_HIDDEN)||"[]")); }catch(_){ return new Set(); }
  }
  _saveHidden(){
    const arr = [...this.state._hidden];
    try{ localStorage.setItem(LS_HIDDEN, JSON.stringify(arr)); }catch(_){}
    // Also persist to HA backend so it survives across devices/reboots
    if(this._hass){
      try{ this._hass.callWS({ type:"padspan_ha/settings_set", lights_hidden: arr }); }catch(_){}
    }
  }

  set hass(hass){
    this._hass = hass;
    if(!this._booted){ this._booted=true; this._boot(); }
  }

  async _boot(){
    if(!this._hass) return;
    // Maps + settings are small and fast — render the floor/room shapes on
    // those alone first. The entity/device registry (needed only to know
    // which room each light is in) is a multi-MB whole-house dump on a
    // large install; don't block first paint on it — it backfills in and
    // re-renders once it lands, same as the 5s poll already does.
    await Promise.allSettled([ this._loadMaps(), this._loadSettings() ]);
    this._render();
    this._loadModel().then(()=>this._loadLightsReg()).then(()=>this._render());
    this._pollTimer = setInterval(()=>this._poll(), 5000);
  }

  async _poll(){
    if(!this._hass) return;
    if(!this.state._lightsReg || Date.now()-this.state._lightsReg.ts > 60000)
      await this._loadLightsReg();
    this._render();
  }

  async _loadMaps(){
    try{
      const res = await this._hass.callWS({ type:"padspan_ha/maps_list" });
      this.state.maps.list = res?.maps || [];
    }catch(e){}
  }

  async _loadModel(){
    try{
      const res = await this._hass.callWS({ type:"padspan_ha/model_get" });
      this.state.model = {
        areas: res?.areas||[], floors: res?.floors||[],
        room_geometry_m: res?.room_geometry_m||{},
        map_transforms: res?.map_transforms||{},
      };
    }catch(e){}
  }

  async _loadSettings(){
    try{
      const res = await this._hass.callWS({ type:"padspan_ha/settings_get" });
      const s = res?.settings || {};
      this.state._floorGap  = s.overview_iso_floor_gap ?? 150;
      this.state._horizGap  = s.overview_iso_horiz_gap ?? 0;
      this.state._focusIdx  = s.overview_iso_focus     ?? 0;
      // Sync hidden map IDs from the same source maps.js uses
      const savedIds = s.hidden_map_ids;
      if(Array.isArray(savedIds)){
        this.state._hiddenMapIds = new Set(savedIds);
      } else {
        try{ this.state._hiddenMapIds = new Set(JSON.parse(localStorage.getItem("padspan_hiddenMapIds")||"[]")); }
        catch(e){ this.state._hiddenMapIds = new Set(); }
      }
      // Restore hidden lights from backend (authoritative over localStorage)
      if(Array.isArray(s.lights_hidden) && s.lights_hidden.length){
        this.state._hidden = new Set(s.lights_hidden);
        try{ localStorage.setItem(LS_HIDDEN, JSON.stringify(s.lights_hidden)); }catch(_){}
      }
    }catch(e){}
  }

  async _saveSettings(){
    try{
      await this._hass.callWS({
        type:                    "padspan_ha/settings_set",
        data_mode:               "live",
        overview_iso_floor_gap:  this.state._floorGap,
        overview_iso_horiz_gap:  this.state._horizGap,
        overview_iso_focus:      this.state._focusIdx,
      });
    }catch(e){ throw e; }
  }

  async _loadLightsReg(){
    // Guard against overlapping fetches: this is a multi-MB whole-house
    // registry dump that can take longer than the 5s poll interval, and
    // without this guard the poll (and the background load kicked off from
    // _boot) would each start their own redundant fetch, compounding into a
    // pile of concurrent multi-MB requests that made the panel effectively
    // never finish loading.
    if(this._lightsRegLoading) return;
    this._lightsRegLoading=true;
    try{
      // A stale/half-open HA websocket connection can leave a callWS()
      // promise permanently unsettled — without a bound, that would wedge
      // _lightsRegLoading true forever and silently freeze room grouping.
      const [regRes, devRes] = await Promise.race([
        Promise.all([
          this._hass.callWS({ type:"config/entity_registry/list" }),
          this._hass.callWS({ type:"config/device_registry/list" }),
        ]),
        new Promise((_, reject) => setTimeout(() => reject(new Error("registry fetch timed out")), 30000)),
      ]);
      const areas = this.state.model.areas;
      const areaIdToName={};
      for(const a of areas) areaIdToName[a.id]=a.name;
      // device_id → area_id (for entities that inherit area from device)
      const devAreaId={};
      for(const d of (devRes||[])) if(d.area_id) devAreaId[d.id]=d.area_id;
      const areaMap={};
      for(const e of (regRes||[])){
        if(!e.entity_id.startsWith("light.")) continue;
        const aid = e.area_id || devAreaId[e.device_id] || null;
        areaMap[e.entity_id] = aid ? (areaIdToName[aid]||null) : null;
      }
      this.state._lightsReg={ts:Date.now(), areaMap};
    }catch(e){
      this.state._lightsReg={ts:Date.now(), areaMap:{}};
    }finally{
      this._lightsRegLoading=false;
    }
  }

  async _toggle(eid){
    if(!this._hass) return;
    const on=this._hass.states[eid]?.state==="on";
    try{
      await this._hass.callService("light", on?"turn_off":"turn_on", {entity_id:eid});
      setTimeout(()=>this._render(), 600);
    }catch(e){ this._toast("Could not toggle "+eid, true); }
  }

  // Detailed control popup for WLED-class lights (effect list present):
  // on/off, brightness, RGB color, effect. Appended to document.body (not
  // the shadow root) so it isn't clipped by the panel's scroll container —
  // same reasoning as _toast, so styling is fully inline throughout.
  _openWledDetail(eid){
    if(!this._hass) return;
    const st=this._hass.states[eid];
    if(!st) return;
    const attrs=st.attributes||{};
    const effectList=Array.isArray(attrs.effect_list)?attrs.effect_list:[];
    const rgb=Array.isArray(attrs.rgb_color)?attrs.rgb_color:[255,255,255];
    const toHex=(c)=>"#"+c.map(v=>Math.max(0,Math.min(255,v|0)).toString(16).padStart(2,"0")).join("");
    const fromHex=(hex)=>{ const n=parseInt(hex.slice(1),16); return [(n>>16)&255,(n>>8)&255,n&255]; };

    const overlay=document.createElement("div");
    overlay.style.cssText="position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:10000;"+
      "display:flex;align-items:center;justify-content:center";
    const close=()=>{ try{ document.body.removeChild(overlay); }catch(_){} };
    overlay.addEventListener("click",e=>{ if(e.target===overlay) close(); });

    const box=el("div",{style:
      "background:#0f1c14;border:1px solid #2d5a3d;border-radius:10px;padding:20px;width:300px;max-width:90vw;"+
      "color:#e2e8f0;font-family:Inter,system-ui,sans-serif;box-shadow:0 8px 30px rgba(0,0,0,.6)"});

    box.appendChild(el("div",{style:"display:flex;justify-content:space-between;align-items:center;margin-bottom:14px"},[
      el("div",{style:"font-weight:700;font-size:15px"}, attrs.friendly_name||eid),
      el("button",{
        style:"background:none;border:none;color:#94a3b8;font-size:16px;cursor:pointer;padding:2px 6px",
        onclick:close,
      },"✕"),
    ]));

    const on=st.state==="on";
    const onBtn=el("button",{
      style:`width:100%;margin-bottom:12px;padding:8px;font-weight:700;border:none;border-radius:6px;cursor:pointer;`+
            `background:${on?"#fbbf24":"#374151"};color:${on?"#111827":"#fbbf24"}`,
      onclick:async()=>{
        try{ await this._hass.callService("light", on?"turn_off":"turn_on", {entity_id:eid}); }catch(e){}
        close();
        setTimeout(()=>this._render(), 400);
      },
    }, on?"Turn Off":"Turn On");
    box.appendChild(onBtn);

    if(typeof attrs.brightness==="number"){
      const briLbl=el("div",{style:"font-size:12px;color:#94a3b8;margin-bottom:4px"},
        `Brightness: ${Math.round((attrs.brightness/255)*100)}%`);
      const bri=document.createElement("input");
      bri.type="range"; bri.min="1"; bri.max="255"; bri.value=String(attrs.brightness||128);
      bri.style.cssText="width:100%;accent-color:#52b788";
      bri.addEventListener("input",()=>{ briLbl.textContent=`Brightness: ${Math.round((bri.value/255)*100)}%`; });
      bri.addEventListener("change",async()=>{
        try{ await this._hass.callService("light","turn_on",{entity_id:eid, brightness:parseInt(bri.value,10)}); }catch(e){}
      });
      box.appendChild(el("div",{style:"margin-bottom:12px"},[briLbl,bri]));
    }

    const colorInput=document.createElement("input");
    colorInput.type="color";
    colorInput.value=toHex(rgb);
    colorInput.style.cssText="width:44px;height:30px;border:none;background:none;cursor:pointer";
    colorInput.addEventListener("change",async()=>{
      try{ await this._hass.callService("light","turn_on",{entity_id:eid, rgb_color:fromHex(colorInput.value)}); }catch(e){}
    });
    box.appendChild(el("div",{style:"margin-bottom:12px;display:flex;align-items:center;gap:10px"},[
      el("span",{style:"font-size:12px;color:#94a3b8"},"Color"), colorInput,
    ]));

    if(effectList.length){
      const effSel=document.createElement("select");
      effSel.style.cssText="width:100%;background:#1a2e1e;color:#52b788;border:1px solid #2d4a36;border-radius:4px;padding:6px";
      for(const eff of effectList){
        const o=document.createElement("option");
        o.value=eff; o.textContent=eff;
        if(eff===attrs.effect) o.selected=true;
        effSel.appendChild(o);
      }
      effSel.addEventListener("change",async()=>{
        try{ await this._hass.callService("light","turn_on",{entity_id:eid, effect:effSel.value}); }catch(e){}
      });
      box.appendChild(el("div",{},[
        el("div",{style:"font-size:12px;color:#94a3b8;margin-bottom:4px"},"Effect"), effSel,
      ]));
    }

    overlay.appendChild(box);
    document.body.appendChild(overlay);
  }

  _render(){
    if(!this.shadowRoot) return;
    const $c=this.shadowRoot.querySelector("#content");
    if(!$c) return;
    while($c.firstChild) $c.removeChild($c.firstChild);
    $c.appendChild(this._buildUI());
  }

  _buildUI(){
    const root=el("div",{});

    // ── Header ────────────────────────────────────────────────────────────────
    root.appendChild(el("div",{style:"display:flex;align-items:center;gap:10px;margin-bottom:16px;flex-wrap:wrap"},[
      el("div",{style:"font-size:18px;font-weight:800;color:#e2e8f0"},"Lights"),
      el("span",{style:"font-size:12px;color:#94a3b8"},`v${APP_VERSION}`),
      el("span",{class:"muted",style:"font-size:12px"},"Tap hex or row to toggle \u00b7 Yellow\u00a0=\u00a0on \u00b7 Grey\u00a0=\u00a0off"),
      el("button",{class:"btn inline",style:"margin-left:auto",onclick:()=>{
        this.state._lightsReg=null; this._boot().then(()=>this._render());
      }},"Refresh"),
    ]));

    // Room assignment needs the entity/device registry (a multi-MB
    // whole-house dump); on/off state does not. Render immediately using
    // whatever is already known -- room grouping backfills and re-renders
    // once the registry lands (see _boot) instead of blocking first paint.
    const lightsLoading=!this.state._lightsReg;


    // ── Gather lights ─────────────────────────────────────────────────────────
    const states=this._hass?.states||{};
    const regMap=lightsLoading ? {} : this.state._lightsReg.areaMap;
    const lights=Object.keys(states)
      .filter(eid=>eid.startsWith("light."))
      .map(eid=>({
        entity_id:     eid,
        friendly_name: states[eid].attributes?.friendly_name||eid,
        state:         states[eid].state,
        area_name:     regMap[eid]||null,
        effect_list:   Array.isArray(states[eid].attributes?.effect_list) ? states[eid].attributes.effect_list : null,
      }))
      .sort((a,b)=>(a.area_name||"\xff").localeCompare(b.area_name||"\xff")||
                    a.friendly_name.localeCompare(b.friendly_name));

    if(!lights.length){
      root.appendChild(el("div",{class:"muted",style:"padding:8px"},"No light entities found."));
      return root;
    }
    // Canonical codes shared with the Mapping → Lights tab (entity_id order —
    // identical in both tools regardless of display sort; WLED = W-series).
    assignLightCodes(lights);
    const lightsByEid={};
    for(const l of lights) lightsByEid[l.entity_id]=l;

    // Group by room (hidden excluded from map)
    const hidden=this.state._hidden;
    const byRoom={};
    for(const l of lights){
      if(l.area_name && !hidden.has(l.entity_id))
        (byRoom[l.area_name]=byRoom[l.area_name]||[]).push(l);
    }

    // ── Map card with ISO 3D view ─────────────────────────────────────────────
    const mapCard=el("div",{class:"card",style:"padding:12px;margin-bottom:16px"});

    // Controls row — only visible (non-hidden) maps
    const maps_list=this.state.maps.list.filter(m=>!this.state._hiddenMapIds.has(m.id));
    const sortedLevels=[...new Set(maps_list.map(m=>m.stack?.z_level??0))].sort((a,b)=>a-b);
    const floors=this.state.model.floors||[];
    const floorLabel=(z)=>{
      const f=floors.find(f=>f.level===z);
      return f?(f.name||`L${z}`):`L${z}`;
    };

    // Build positions array FIRST (used by isoDiv and slider below)
    const _isoPos=[null];
    for(let _fi=0; _fi<sortedLevels.length; _fi++){
      _isoPos.push(sortedLevels[_fi]);
      if(_fi<sortedLevels.length-1) _isoPos.push([sortedLevels[_fi],sortedLevels[_fi+1]]);
    }
    const _getFocusZ =(idx)=>_isoPos[Math.max(0,Math.min(idx,_isoPos.length-1))];
    const _getFocusLbl=(idx)=>{
      const pos=_getFocusZ(idx);
      if(pos===null) return "All floors";
      const zArr=Array.isArray(pos)?pos:[pos];
      return zArr.map(z=>{const f=floors.find(x=>x.level===z);return f?(f.name||`L${z}`):`L${z}`;}).join(" + ");
    };
    // Clamp saved index to valid range
    this.state._focusIdx=Math.max(0,Math.min(this.state._focusIdx,_isoPos.length-1));

    const isoDiv=document.createElement("div");
    isoDiv.style.cssText=`overflow:auto;border-radius:8px;background:#071008;padding:8px;`+
      `width:${Math.round(this.state._zoom*100)}%`;
    isoDiv.innerHTML=buildIsoSVG(maps_list, byRoom, hidden, _getFocusZ(this.state._focusIdx), this.state._floorGap, this.state._horizGap, lightsByEid, lightsLoading, floors, this.state.model);

    const rebuildISO=()=>{
      isoDiv.style.width=`${Math.round(this.state._zoom*100)}%`;
      isoDiv.innerHTML=buildIsoSVG(maps_list, byRoom, hidden, _getFocusZ(this.state._focusIdx), this.state._floorGap, this.state._horizGap, lightsByEid, lightsLoading, floors, this.state.model);
      wireHexClicks();
    };

    const wireHexClicks=()=>{
      requestAnimationFrame(()=>{
        isoDiv.querySelectorAll(".lhex").forEach(g=>{
          g.addEventListener("click",e=>{
            e.stopPropagation();
            const eid=g.dataset.eid;
            const l=lightsByEid[eid];
            if(l && isWledLight(l)) this._openWledDetail(eid);
            else this._toggle(eid);
          });
          g.addEventListener("mouseover",()=>{g.style.opacity="0.75";});
          g.addEventListener("mouseout", ()=>{g.style.opacity="1";});
        });
      });
    };

    // Floor focus slider
    const ctrlRow=el("div",{style:"display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-bottom:8px"});

    if(sortedLevels.length > 1){
      const focusLbl=el("span",{style:"font-size:12px;color:#94a3b8;min-width:80px"},
        _getFocusLbl(this.state._focusIdx));
      const focusSlider=document.createElement("input");
      focusSlider.type="range"; focusSlider.min="0"; focusSlider.max=String(_isoPos.length-1);
      focusSlider.style.cssText="width:120px;accent-color:#52b788;vertical-align:middle;cursor:pointer";
      focusSlider.value=String(this.state._focusIdx);
      focusSlider.addEventListener("input",()=>{
        this.state._focusIdx=parseInt(focusSlider.value,10);
        focusLbl.textContent=_getFocusLbl(this.state._focusIdx);
        rebuildISO();
      });
      ctrlRow.appendChild(el("span",{class:"muted",style:"font-size:11px;white-space:nowrap"},"Floor:"));
      ctrlRow.appendChild(focusSlider);
      ctrlRow.appendChild(focusLbl);
    }

    // Floor gap slider
    const gapLbl=el("span",{style:"font-size:12px;color:#94a3b8;min-width:38px"},String(this.state._floorGap));
    const gapSlider=document.createElement("input");
    gapSlider.type="range"; gapSlider.min="50"; gapSlider.max="400"; gapSlider.step="10";
    gapSlider.style.cssText="width:100px;accent-color:#52b788;vertical-align:middle;cursor:pointer";
    gapSlider.value=String(this.state._floorGap);
    gapSlider.addEventListener("input",()=>{
      this.state._floorGap=parseInt(gapSlider.value,10);
      gapLbl.textContent=String(this.state._floorGap);
      rebuildISO();
    });
    ctrlRow.appendChild(el("span",{class:"muted",style:"font-size:11px;white-space:nowrap;margin-left:8px"},"Spacing:"));
    ctrlRow.appendChild(gapSlider);
    ctrlRow.appendChild(gapLbl);

    // L/R horizontal offset slider
    const horizLbl=el("span",{style:"font-size:12px;color:#94a3b8;min-width:38px"},String(this.state._horizGap));
    const horizSlider=document.createElement("input");
    horizSlider.type="range"; horizSlider.min="-120"; horizSlider.max="120"; horizSlider.step="10";
    horizSlider.style.cssText="width:100px;accent-color:#52b788;vertical-align:middle;cursor:pointer";
    horizSlider.value=String(this.state._horizGap);
    horizSlider.addEventListener("input",()=>{
      this.state._horizGap=parseInt(horizSlider.value,10);
      horizLbl.textContent=String(this.state._horizGap);
      rebuildISO();
    });
    ctrlRow.appendChild(el("span",{class:"muted",style:"font-size:11px;white-space:nowrap;margin-left:8px"},"L/R:"));
    ctrlRow.appendChild(horizSlider);
    ctrlRow.appendChild(horizLbl);

    // Save / Reset buttons + status label
    const saveLbl = el("span",{style:"font-size:11px;color:#94a3b8;min-width:50px;display:inline-block"},"");

    const saveBtn = el("button",{class:"btn inline",style:"margin-left:8px;font-size:12px;padding:2px 10px",
      onclick:async()=>{
        saveBtn.disabled=true;
        try{
          await this._saveSettings();
          saveLbl.textContent="Saved \u2713";
          setTimeout(()=>{ saveLbl.textContent=""; },2000);
        }catch(e){ saveLbl.textContent="Error"; }
        saveBtn.disabled=false;
      }
    },"Save");

    const resetBtn = el("button",{class:"btn inline",style:"font-size:12px;padding:2px 10px",
      onclick:async()=>{
        this.state._floorGap=150; this.state._horizGap=0; this.state._focusIdx=0; this.state._zoom=1.0;
        gapSlider.value="150";   gapLbl.textContent="150";
        horizSlider.value="0";   horizLbl.textContent="0";
        isoDiv.style.width="100%";
        rebuildISO();
        resetBtn.disabled=true;
        try{
          await this._saveSettings();
          saveLbl.textContent="Reset \u2713";
          setTimeout(()=>{ saveLbl.textContent=""; resetBtn.disabled=false; },2000);
        }catch(e){ saveLbl.textContent="Error"; resetBtn.disabled=false; }
      }
    },"Reset");

    ctrlRow.appendChild(saveBtn);
    ctrlRow.appendChild(resetBtn);
    ctrlRow.appendChild(saveLbl);

    // Zoom controls
    ctrlRow.appendChild(el("span",{class:"muted",style:"font-size:11px;white-space:nowrap;margin-left:8px"},"Zoom:"));
    ctrlRow.appendChild(el("button",{class:"btn inline",onclick:()=>{
      this.state._zoom=Math.max(0.4,Math.round((this.state._zoom-0.1)*10)/10);
      isoDiv.style.width=`${Math.round(this.state._zoom*100)}%`;
    }},"Zoom \u2212"));
    ctrlRow.appendChild(el("button",{class:"btn inline",onclick:()=>{
      this.state._zoom=1.0; isoDiv.style.width="100%";
    }},"100%"));
    ctrlRow.appendChild(el("button",{class:"btn inline",onclick:()=>{
      this.state._zoom=Math.min(2.5,Math.round((this.state._zoom+0.1)*10)/10);
      isoDiv.style.width=`${Math.round(this.state._zoom*100)}%`;
    }},"Zoom +"));

    mapCard.appendChild(ctrlRow);
    mapCard.appendChild(isoDiv);
    wireHexClicks();
    root.appendChild(mapCard);

    // ── Unassigned notice ─────────────────────────────────────────────────────
    const unassigned=lights.filter(l=>!l.area_name&&!hidden.has(l.entity_id));
    if(lightsLoading){
      root.appendChild(el("div",{class:"muted",style:"font-size:12px;margin-bottom:10px"},"Loading room assignments…"));
    } else if(unassigned.length){
      root.appendChild(el("div",{class:"muted",style:"font-size:12px;margin-bottom:10px"},
        `${unassigned.length} light(s) not assigned to a room \u2014 shown in index only.`));
    }

    // ── Light index table ─────────────────────────────────────────────────────
    const hiddenCount=lights.filter(l=>hidden.has(l.entity_id)).length;
    root.appendChild(el("div",{style:"font-weight:700;font-size:13px;color:#e2e8f0;margin-bottom:6px"},
      `Light Index (${lights.length}${hiddenCount?` \u00b7 ${hiddenCount} hidden from map`:""})`));

    const tbl=el("table",{class:"table",style:"width:100%"});
    tbl.appendChild(el("thead",{},el("tr",{},[
      el("th",{},"Code"),
      el("th",{},"Light"),
      el("th",{},"Room"),
      el("th",{},"State"),
      el("th",{style:"width:60px;text-align:center"},"Map"),
    ])));
    const tbody=el("tbody");
    for(const l of lights){
      const on=l.state==="on";
      const isHidden=hidden.has(l.entity_id);
      const row=el("tr",{style:`cursor:pointer;opacity:${isHidden?"0.45":"1"}`},[
        el("td",{style:"font-family:monospace;font-weight:700;color:#52b788;font-size:12px"},l.code),
        el("td",{},l.friendly_name),
        el("td",{class:"muted"},l.area_name
          ? el("span",{},l.area_name)
          : lightsLoading
          ? el("span",{},"…")
          : (()=>{
              const areas = this.state.model.areas || [];
              if(!areas.length) return "\u2014";
              const sel = document.createElement("select");
              sel.style.cssText = "background:#1a2e1e;color:#52b788;border:1px solid #2d4a36;border-radius:4px;padding:2px 6px;font-size:11px;cursor:pointer";
              sel.appendChild(el("option",{value:""},"Assign room\u2026"));
              for(const a of areas.sort((x,y)=>x.name.localeCompare(y.name))){
                sel.appendChild(el("option",{value:a.id}, a.name));
              }
              sel.addEventListener("click", e=>e.stopPropagation());
              sel.addEventListener("change", async ()=>{
                if(!sel.value) return;
                sel.disabled = true;
                try{
                  await this._hass.callWS({ type:"config/entity_registry/update", entity_id: l.entity_id, area_id: sel.value });
                  this._toast(`Assigned ${l.friendly_name} to room`);
                  this.state._lightsReg = null;
                  await this._loadLightsReg();
                  this._render();
                }catch(e){
                  this._toast("Failed to assign room: "+(e.message||e), true);
                  sel.disabled = false;
                }
              });
              return sel;
            })()
        ),
        el("td",{},el("span",{
          style:`display:inline-block;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:700;`+
                `background:${on?"#fbbf24":"#374151"};color:${on?"#111827":"#fbbf24"}`,
        },on?"ON":"OFF")),
        el("td",{style:"text-align:center"},el("button",{
          class:"btn inline",
          style:`font-size:11px;padding:2px 6px${isHidden?";opacity:0.5":""}`,
          onclick:(e)=>{
            e.stopPropagation();
            if(hidden.has(l.entity_id)) hidden.delete(l.entity_id);
            else hidden.add(l.entity_id);
            this._saveHidden();
            this._render();
          },
        },isHidden?"Show":"Hide")),
      ]);
      row.addEventListener("click",()=>{
        if(isWledLight(l)) this._openWledDetail(l.entity_id);
        else this._toggle(l.entity_id);
      });
      tbody.appendChild(row);
    }
    tbl.appendChild(tbody);
    root.appendChild(tbl);

    return root;
  }

  _toast(msg, isError=false){
    const t=document.createElement("div");
    t.textContent=msg;
    t.style.cssText=`position:fixed;bottom:24px;left:50%;transform:translateX(-50%);`+
      `padding:10px 18px;border-radius:8px;font-size:13px;color:#e2e8f0;z-index:9999;`+
      `background:${isError?"#7f1d1d":"#1a3a2a"};`+
      `border:1px solid ${isError?"#dc2626":"#52b788"};`+
      `box-shadow:0 2px 12px rgba(0,0,0,.5);white-space:pre-wrap;max-width:320px;text-align:center`;
    document.body.appendChild(t);
    setTimeout(()=>{ try{document.body.removeChild(t);}catch(_){} },3500);
  }

  connectedCallback(){
    if(!this.shadowRoot) this.attachShadow({mode:"open"});
    this.style.display="block";
    this.shadowRoot.innerHTML=`
      <link rel="stylesheet" href="/padspan_ha_static/padspan-ha/styles.css?v=${APP_VERSION}&b=${BUILD_ID}">
      <style>
        :host{display:block;min-height:100vh;background:#0a150e;color:#e2e8f0;
              font-family:Inter,system-ui,Arial,sans-serif;box-sizing:border-box}
        #content{padding:16px;max-width:900px;margin:0 auto}
      </style>
      <div id="content"></div>
    `;
    if(this._booted) this._render();
  }

  disconnectedCallback(){
    if(this._pollTimer){ clearInterval(this._pollTimer); this._pollTimer=null; }
  }
}

// Guard against duplicate definition when a stale module lingers alongside a
// freshly-registered one after an integration reload (see panel.js for detail).
if (!customElements.get("padspan-lights-app")) {
  customElements.define("padspan-lights-app", PadSpanLightsApp);
}
