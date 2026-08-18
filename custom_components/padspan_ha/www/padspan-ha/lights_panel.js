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

const APP_VERSION = "0.34.6";
const BUILD_ID = "20260818T061923Z";

// Query inherited from our own module URL so the ?b= cache-buster propagates
// (see docs/06_UI_CACHE_BUSTING.md).
const { isWledLight } =
  await import(`./views/light_codes.js${new URL(import.meta.url).search}`);
// THE shared lights view — data pipeline, map card and index table, also used
// verbatim by the Mapping → Lights tab (the builder for this display), so the
// two tools always show the identical map. All lights-view edits go in there.
const { ensureLightsRegistry, gatherLights, buildLightsMapCard, buildLightsTable, lightIsTouched } =
  await import(`./views/lights_map.js${new URL(import.meta.url).search}`);

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
// isWledLight comes from views/light_codes.js — a light counts as
// "WLED-class" (effects + full color) if it advertises an effect list.
// Everything else this panel shows (registry pipeline, map card, index
// table) lives in views/lights_map.js, shared with the Mapping → Lights tab.

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
      model:       { areas:[], floors:[] },
      _modelLoaded: false,
      _hiddenMapIds: new Set(),
      _hidden:     this._loadHidden(),
    };
    // Registry cache owned here, filled by the shared ensureLightsRegistry.
    this._regStore = {};
    // Live view settings for the shared map card (persist across renders).
    this._view = { floorGap: 150, horizGap: 0, focusIdx: 0, zoom: 1.0 };

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
    // The header Refresh button re-boots — without this, each click leaves
    // its predecessor's 5s interval running forever (they can only ever be
    // cleared one deep), multiplying full re-renders and churning the DOM
    // mid-interaction.
    if(this._pollTimer){ clearInterval(this._pollTimer); this._pollTimer=null; }
    // Maps + settings are small and fast — render the floor/room shapes on
    // those alone first. The entity/device registry (needed only to know
    // which room each light is in) is a multi-MB whole-house dump on a
    // large install; don't block first paint on it — the shared
    // ensureLightsRegistry backfills it in the background from _buildUI
    // (guarded on the model so area NAMES exist before the map is built).
    await Promise.allSettled([ this._loadSettings() ]);
    this._settingsTs = Date.now();
    this._render();
    this._loadModel().then(()=>this._render());
    // Clear again AFTER the awaits: two overlapping boots (a second Refresh
    // click while the first is still loading) both pass the clear above before
    // either assigns, and the first timer would be orphaned beyond reach.
    if(this._pollTimer) clearInterval(this._pollTimer);
    this._pollTimer = setInterval(()=>this._poll(), 5000);
  }

  async _poll(){
    if(!this._hass) return;
    // Don't rebuild the DOM under the user's hands: a poll landing mid-drag on
    // a slider, or while a select is open, destroys the control being used.
    // (The Mapping tab's host has the same protection via _editDragging.)
    // INPUT/SELECT only. A button KEEPS focus after it is clicked, so
    // including BUTTON here meant one press of Zoom+ stopped this panel
    // live-updating for good.
    const active = this.shadowRoot && this.shadowRoot.activeElement;
    if(active && /^(INPUT|SELECT)$/.test(active.tagName)) return;
    if(this._pointerDown) return;
    // Hidden lights / hidden maps live in settings and are edited from the
    // Mapping tab. Without re-reading them, the two "identical" views drift
    // apart until this panel is reloaded.
    if(Date.now() - (this._settingsTs || 0) > 30000){
      this._settingsTs = Date.now();
      await this._loadSettings(false);
    }
    this._render();   // registry staleness handled inside _buildUI
  }

  async _loadModel(){
    try{
      const res = await this._hass.callWS({ type:"padspan_ha/model_get" });
      // Keep the WHOLE model payload. This panel used to copy four fields by
      // name, so when placed light positions moved into the model the sidebar
      // silently kept showing every light auto-clustered at its room centre
      // while the Mapping tab drew them at their real positions — the exact
      // display-vs-builder divergence the shared renderer exists to prevent.
      // A field the renderer needs must never depend on this host remembering
      // to list it.
      this.state.model = {
        ...(res || {}),
        areas: res?.areas||[], floors: res?.floors||[],
        room_geometry_m: res?.room_geometry_m||{},
        light_positions_m: res?.light_positions_m||{},
      };
    }catch(e){}
    // Registry area-name resolution waits on this flag (success OR failure) —
    // building the areaMap before areas load would mark every light
    // unassigned and then cache that for 60s.
    this.state._modelLoaded = true;
  }

  // applyView=false on the periodic refresh: the sliders are live UI state
  // the user may be mid-way through adjusting, and re-seeding them from the
  // saved settings would silently revert unsaved Spacing / L-R / Floor
  // changes every 30 seconds. Only the boot load seeds the view.
  async _loadSettings(applyView=true){
    let s = {};
    // A failed settings_get must still leave the hidden-maps fallback below
    // reachable — otherwise a transient websocket error makes this panel
    // render maps the Mapping tab hides, for the whole session.
    try{
      const res = await this._hass.callWS({ type:"padspan_ha/settings_get" });
      s = res?.settings || {};
    }catch(e){}
    try{
      if(applyView){
        this._view.floorGap = s.overview_iso_floor_gap ?? 150;
        this._view.horizGap = s.overview_iso_horiz_gap ?? 0;
        this._view.focusIdx = s.overview_iso_focus     ?? 0;
      }
      // Per-light shape overrides — set in the Mapping → Lights tab, read here
      // so both views draw the same fixture outlines.
      this.state._shapeOverrides = (s.light_shapes && typeof s.light_shapes === "object") ? s.light_shapes : {};
      // The presentation modes are set in the Mapping → Lights tab and read
      // here for the same reason the shapes are: this panel DISPLAYS the map
      // that tab BUILDS, so a mode that changed only one of them would mean
      // the two views no longer show the same house.
      this.state._showcase      = !!s.lights_showcase;
      this.state._fitRooms      = !!s.lights_fit_rooms;
      this.state._hideUntouched = !!s.lights_hide_untouched;
      // The effective tier the backend computed (licence.py). Below `bright`
      // the shared pipeline draws the free map — see lights_map.js. A settings
      // fetch that failed keeps the tier it last knew rather than flickering
      // a Pro house down to the free drawing for one poll.
      if (s.tier !== undefined) this.state._tier = String(s.tier);
      // Hidden-map ids are read only to stay consistent with the Mapping tab
      const savedIds = s.hidden_map_ids;
      if(Array.isArray(savedIds)){
        this.state._hiddenMapIds = new Set(savedIds);
      } else {
        try{ this.state._hiddenMapIds = new Set(JSON.parse(localStorage.getItem("padspan_hiddenMapIds")||"[]")); }
        catch(e){ this.state._hiddenMapIds = new Set(); }
      }
      // Restore hidden lights from backend (authoritative over localStorage).
      // An EMPTY array is a real value — "nothing hidden" — not a missing
      // one: unhiding the last light in the Mapping → Lights tab writes []
      // here, and skipping it would resurrect this device's stale
      // localStorage copy and hide a light the tab shows.
      if(Array.isArray(s.lights_hidden)){
        this.state._hidden = new Set(s.lights_hidden);
        try{ localStorage.setItem(LS_HIDDEN, JSON.stringify(s.lights_hidden)); }catch(_){}
      }
    }catch(e){}
  }

  async _saveSettings(){
    try{
      // Never bundle data_mode: the backend leaves it untouched when the
      // message omits it, and echoing "live" here would make Save view flip
      // a sample-mode install to live as a hidden side effect (same reason
      // panel.js's settingsSet omits it).
      await this._hass.callWS({
        type:                    "padspan_ha/settings_set",
        overview_iso_floor_gap:  this._view.floorGap,
        overview_iso_horiz_gap:  this._view.horizGap,
        overview_iso_focus:      this._view.focusIdx,
      });
    }catch(e){ throw e; }
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

    // Dimmability is a CAPABILITY, not a current value: Home Assistant drops
    // the brightness attribute entirely while a light is off, so testing the
    // attribute hid the slider on every light that was off — which is exactly
    // when you open this popup to set a level. supported_color_modes is
    // present in both states; every mode except onoff/unknown carries
    // brightness.
    const modes = Array.isArray(attrs.supported_color_modes) ? attrs.supported_color_modes : [];
    // ...and supported_color_modes is NOT stable for WLED. The same unit
    // reports ['rgb'] in one state and ['onoff'] in another as segments and
    // effects change, so deciding from the current snapshot made the
    // brightness slider come and go on hardware that dims perfectly well.
    // Three independent kinds of evidence, any one of which is enough:
    // the modes say so, the light is reporting a brightness right now, or it
    // is WLED-class — this popup only opens for effect-capable hardware, and
    // that hardware dims. A slider a rare fixture ignores costs far less than
    // a missing control on one that doesn't.
    const dimmable = modes.some(m => m !== "onoff" && m !== "unknown")
      || typeof attrs.brightness === "number"
      || effectList.length > 0;
    if(dimmable){
      const pct=(v)=>Math.round((v/255)*100);
      const cur=typeof attrs.brightness==="number" ? attrs.brightness : 255;
      const briText=(v)=>`Brightness: ${pct(v)}%` + (on ? "" : " · turns the light on");
      const briLbl=el("div",{style:"font-size:12px;color:#94a3b8;margin-bottom:4px"}, briText(cur));
      const bri=document.createElement("input");
      bri.type="range"; bri.min="1"; bri.max="255"; bri.value=String(cur);
      bri.style.cssText="width:100%;accent-color:#52b788";
      bri.addEventListener("input",()=>{ briLbl.textContent=briText(bri.value); });
      bri.addEventListener("change",async()=>{
        try{ await this._hass.callService("light","turn_on",{entity_id:eid, brightness:parseInt(bri.value,10)}); }
        catch(e){ this._toast("Could not set brightness", true); }
        setTimeout(()=>this._render(), 400);
      });
      box.appendChild(el("div",{style:"margin-bottom:12px"},[briLbl,bri]));
    }

    // Colour has the same instability: a unit that reports a colour mode most
    // of the time can report ['onoff'] for a moment, and the picker would
    // vanish mid-session on hardware that plainly takes colour. A currently
    // reported rgb_color is proof on its own, so either kind of evidence
    // keeps the control. (Only a light that has never shown a colour mode
    // AND is not reporting a colour loses it — that is the switched preset
    // the picker genuinely could not drive.)
    if(modes.some(m => ["rgb","rgbw","rgbww","hs","xy"].includes(m))
       || Array.isArray(attrs.rgb_color)){
      const colorInput=document.createElement("input");
      colorInput.type="color";
      colorInput.value=toHex(rgb);
      colorInput.style.cssText="width:44px;height:30px;border:none;background:none;cursor:pointer";
      colorInput.addEventListener("change",async()=>{
        try{ await this._hass.callService("light","turn_on",{entity_id:eid, rgb_color:fromHex(colorInput.value)}); }
        catch(e){ this._toast("Could not set colour", true); }
        setTimeout(()=>this._render(), 400);
      });
      box.appendChild(el("div",{style:"margin-bottom:12px;display:flex;align-items:center;gap:10px"},[
        el("span",{style:"font-size:12px;color:#94a3b8"},"Color"), colorInput,
      ]));
    }

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
        this._regStore.reg=null; this._boot().then(()=>this._render());
      }},"Refresh"),
    ]));

    // ── Shared data pipeline — identical to the Mapping → Lights tab ─────────
    // Room assignment needs the entity/device registry (a multi-MB dump);
    // on/off state does not. Render immediately from the cached copy — the
    // shared loader refreshes in the background and re-renders when it lands.
    const reg = this.state._modelLoaded
      ? ensureLightsRegistry(this._regStore, this._hass, this.state.model.areas, ()=>this._render())
      : { areaMap:{}, loading:true };
    const lightsLoading = reg.loading;
    const lights = gatherLights(this._hass?.states||{}, reg.areaMap, this.state._shapeOverrides, this.state._tier);

    if(!lights.length){
      root.appendChild(el("div",{class:"muted",style:"padding:8px"},"No light entities found."));
      return root;
    }
    const lightsByEid={};
    for(const l of lights) lightsByEid[l.entity_id]=l;

    // Group by room (hidden excluded from map)
    const hidden=this.state._hidden;
    const byRoom={};
    for(const l of lights){
      if(l.area_name && !hidden.has(l.entity_id))
        (byRoom[l.area_name]=byRoom[l.area_name]||[]).push(l);
    }

    // ── The shared map card — identical map to the Mapping → Lights tab ──────
    const floors=this.state.model.floors||[];

    const host={
      el,
      floors,
      model: this.state.model,
      tier: this.state._tier,
      byRoom,
      hiddenEids: hidden,
      showcase: !!this.state._showcase,
      fitRooms: !!this.state._fitRooms,
      // Same filter as the builder, from the same rule, over the same
      // placements — the map hides them, the index table below still lists
      // every light.
      hiddenEidsMap: this.state._hideUntouched
        ? new Set([...hidden, ...lights
            .filter(l => !lightIsTouched(l, this.state._shapeOverrides || {},
                                         (this.state.model || {}).light_positions_m || {}))
            .map(l => l.entity_id)])
        : hidden,
      lightsByEid,
      lightsLoading,
      view: this._view,
      saveView: ()=>this._saveSettings(),
      callWS: (msg)=>this._hass.callWS(msg),
      toast: (m,isErr)=>this._toast(m,isErr),
      // Sidebar interaction: a hex controls the light (the Mapping tab's
      // host instead wires selection + drag-to-place on the same hexes).
      onHexesBuilt: (isoDiv)=>{
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
      },
      onRowClick: (l)=>{
        if(isWledLight(l)) this._openWledDetail(l.entity_id);
        else this._toggle(l.entity_id);
      },
      onToggleHidden: (eid)=>{
        if(hidden.has(eid)) hidden.delete(eid);
        else hidden.add(eid);
        this._saveHidden();
        this._render();
      },
      afterAssign: ()=>{
        // Force a background registry refresh; keep serving the current copy.
        if(this._regStore.reg) this._regStore.reg.ts=0;
        this._render();
      },
    };

    root.appendChild(buildLightsMapCard(host));

    // ── Unassigned notice + light index table (shared with the Mapping tab) ──
    root.appendChild(buildLightsTable(host, lights));

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
    // Track a held pointer so the 5s poll can't re-render mid-interaction
    // (dragging a slider is the case that actually bites).
    if(!this._pointerWired){
      this._pointerWired = true;
      this.addEventListener("pointerdown", ()=>{ this._pointerDown = true; });
      window.addEventListener("pointerup", ()=>{ this._pointerDown = false; });
      window.addEventListener("pointercancel", ()=>{ this._pointerDown = false; });
    }
    this.style.display="block";
    this.shadowRoot.innerHTML=`
      <link rel="stylesheet" href="/padspan_ha_static/padspan-ha/styles.css?v=${APP_VERSION}&b=${BUILD_ID}">
      <style>
        :host{display:block;min-height:100vh;background:#0a150e;color:#e2e8f0;
              font-family:Inter,system-ui,Arial,sans-serif;box-sizing:border-box}
        #content{padding:16px}
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
