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

const APP_VERSION = "0.38.22";
const BUILD_ID = "20260904T172251Z";

// Query inherited from our own module URL so the ?b= cache-buster propagates
// (see docs/06_UI_CACHE_BUSTING.md).
const { isWledLight, isPartitionLight } =
  await import(`./views/light_codes.js${new URL(import.meta.url).search}`);
// THE shared lights view — data pipeline, map card and index table, also used
// verbatim by the Mapping → Lights tab (the builder for this display), so the
// two tools always show the identical map. All lights-view edits go in there.
const { ensureLightsRegistry, gatherLights, buildLightsMapCard, buildLightsTable, lightIsTouched,
        sunAmbient, lastBrightness, setOptimistic, clearOptimistic,
        wireUseSurface, openControlCard, openRoomSheet, openFloorSheet, openActivityCalendar, setManyStates } =
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
// isWledLight / isPartitionLight come from views/light_codes.js — a strip's
// TWO classes: WLED-class advertises an effect list; partition-class is an
// ESPHome-style `light.partition` entity (a physical strip split by LED
// range), signalled by the entity registry rather than by effects, since
// most partitions carry none. Both get the long-press detail popup below —
// and so does any plain DIMMABLE light (l.dimmable from the shared
// pipeline): the popup is capability-driven, so a hold on a dimmer offers
// brightness where a strip also offers colour and effects. Everything else
// this panel shows (registry pipeline, map card, index table) lives in
// views/lights_map.js, shared with the Mapping → Lights tab.

// ── Persistence keys ─────────────────────────────────────────────────────────
const LS_HIDDEN = "padspan_ha_lights_hidden";
// The one-time coach mark ("tap to switch · code or hold for controls") —
// per browser, because that is where the hands are.
const LS_COACH = "padspan_ha_lights_coach_seen";
const LS_CLASS = "padspan_ha_lights_class";

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
      // Layer chips: which device class is in front. Remembered per browser.
      _classFilter: (()=>{ try{ return localStorage.getItem(LS_CLASS)||"all"; }catch(_){ return "all"; } })(),
      _coachSeen:   (()=>{ try{ return localStorage.getItem(LS_COACH)==="1"; }catch(_){ return false; } })(),
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
      // Read for display parity with the Mapping tab (the only place they
      // are edited): a light forced to a class there must wear the same
      // class here, or the two "identical" views disagree on its code.
      this.state._typeOverrides = (s.light_type_overrides && typeof s.light_type_overrides === "object") ? s.light_type_overrides : {};
      // The presentation modes are set in the Mapping → Lights tab and read
      // here for the same reason the shapes are: this panel DISPLAYS the map
      // that tab BUILDS, so a mode that changed only one of them would mean
      // the two views no longer show the same house.
      this.state._showcase      = !!s.lights_showcase;
      this.state._fitRooms      = !!s.lights_fit_rooms;
      this.state._hideUntouched = !!s.lights_hide_untouched;
      this.state._isolux        = !!s.lights_isolux;
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
    // The service domain is the entity's own: light.* → light, fan.* → fan.
    // A motion sensor is read-only — a tap on it is a no-op, its state is
    // the blue pulse on the map. A temperature sensor.* is read-only the
    // same way — its "state" is the number it just showed on the marker.
    const domain=String(eid).split(".")[0];
    if(domain==="binary_sensor"){ this._toast("Motion sensors are read-only"); return; }
    if(domain==="sensor"){ this._toast("Temperature sensors are read-only"); return; }
    const on=this._hass.states[eid]?.state==="on";
    // Optimistic: the marker flips NOW (shared claim in lights_map.js, so the
    // index row flips with it), and HA's next state reconciles it. A failed
    // call takes the claim back at once and shakes the marker — a tap that
    // did nothing must never look like a tap that worked.
    setOptimistic(eid, on?"off":"on");
    this._render();
    try{
      // Off→on restores the level it was dimmed to. HA drops `brightness`
      // while a light is off, so this comes from the shared memory
      // gatherLights keeps — a light that never reported one (or a plain
      // switch, or a fan) sends none and behaves exactly as before.
      const data={entity_id:eid};
      if(!on && domain==="light"){
        const bri=lastBrightness(eid);
        if(bri!==null) data.brightness=bri;
      }
      await this._hass.callService(domain, on?"turn_off":"turn_on", data);
      setTimeout(()=>this._render(), 600);
    }catch(e){
      clearOptimistic(eid);
      this._render();
      this._shake(eid);
      this._toast("Could not toggle "+eid, true);
    }
  }

  // The revert shake: a short wobble on the marker whose tap failed.
  _shake(eid){
    requestAnimationFrame(()=>{
      const g=this.shadowRoot && this.shadowRoot.querySelector(`.lhex[data-eid="${String(eid).replace(/"/g,'\\"')}"]`);
      if(!g) return;
      g.classList.add("lv-shake");
      setTimeout(()=>g.classList.remove("lv-shake"), 500);
    });
  }

  // Aggregate actions: every light (and, separately, every fan) in a room
  // or on a floor. Fans are never swept up by "all lights off" — the sheet
  // offers them their own button, so the word "all" is never ambiguous.
  async _setMany(eids, turnOn){
    await setManyStates(this._hass, eids, turnOn, {toast:(m,e)=>this._toast(m,e), rerender:()=>this._render()});
  }

  // The control card (shared, views/lights_map.js): capability-driven —
  // brightness / colour / effects for a light, speed / preset / oscillate /
  // direction for a fan. The admin's pencil deep-links to the builder.
  _openWledDetail(eid){
    openControlCard(this._hass, eid, {
      toast:(m,e)=>this._toast(m,e),
      rerender:()=>this._render(),
      onEdit: this._isAdmin() ? (e)=>this._gotoBuilder(e) : null,
      ip: this._regStore?.reg?.ipMap?.[eid] || null,
    });
  }

  _isAdmin(){ return !!(this._hass && this._hass.user && this._hass.user.is_admin); }
  // Deep-link into the builder: the panel reads ?view= (existing), ?tab= and
  // ?light= (panel.js) and lands on Mapping → Lights with the light selected.
  _gotoBuilder(eid){
    const q=new URLSearchParams({view:"maps", tab:"lights"});
    if(eid) q.set("light", eid);
    try{ window.location.assign(`/padspan-ha?${q.toString()}`); }catch(_){}
  }

  // The api the shared use surface and sheets act through — the sidebar's
  // toggle (optimistic + shake), its control card, its aggregate action.
  _useApi(lightsByEid, lights){
    const controlsFor=(l0)=>!!(l0 && (isWledLight(l0)||isPartitionLight(l0)||l0.dimmable||l0.isFan));
    const api={
      hass:this._hass, lightsByEid, lights, controlsFor,
      toggle:(eid)=>this._toggle(eid),
      openControls:(eid)=>this._openWledDetail(eid),
      openActivity:(eid)=>openActivityCalendar(this._hass, eid),
      setMany:(eids,on)=>this._setMany(eids,on),
      toast:(m,e)=>this._toast(m,e),
      rerender:()=>this._render(),
    };
    api.openRoom=(room, onlyEids)=>openRoomSheet(api, lights, room, onlyEids);
    api.openFloor=(z)=>openFloorSheet(api, lights, this.state.model, z);
    return api;
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
    // The lv- vocabulary from styles.css (loaded in this shadow root), so the
    // sidebar and the Mapping tab wear the same face.
    root.appendChild(el("div",{class:"lv-hero"},[
      el("div",{class:"lv-hero-title"},"Lights"),
      el("span",{class:"lv-ver"},`v${APP_VERSION}`),
      el("span",{class:"lv-hint"},"Tap a light to switch it \u00b7 tap its code or hold for controls \u00b7 tap a room name for the whole room \u00b7 motion and temperature tiles are read-only"),
      // Admin only: the pencil to the builder. Same map, the other tool.
      ...(this._isAdmin() ? [el("button",{class:"lv-act",style:"margin-left:auto",title:"Open Mapping \u2192 Lights",
        onclick:()=>this._gotoBuilder(null)},"\u270e Edit map")] : []),
      el("button",{class:"lv-act",style:this._isAdmin()?"":"margin-left:auto",onclick:()=>{
        this._regStore.reg=null; this._boot().then(()=>this._render());
      }},"\u21bb Refresh"),
    ]));
    // One-time coach mark. Dismissed once per browser; never again.
    if(!this.state._coachSeen){
      root.appendChild(el("div",{class:"lv-coach"},[
        el("span",{},"\u{1F4A1} Tap a light to switch it. Tap its code, or press and hold, for brightness, colour, effects and fan speed. Hold a dimmable light and slide up or down to dim it. Tap a room name for everything in the room. Motion and temperature tiles are read-only — they just show what's happening."),
        el("button",{class:"lv-act",onclick:()=>{
          this.state._coachSeen=true;
          try{ localStorage.setItem(LS_COACH,"1"); }catch(_){}
          this._render();
        }},"Got it"),
      ]));
    }

    // ── Shared data pipeline — identical to the Mapping → Lights tab ─────────
    // Room assignment needs the entity/device registry (a multi-MB dump);
    // on/off state does not. Render immediately from the cached copy — the
    // shared loader refreshes in the background and re-renders when it lands.
    const reg = this.state._modelLoaded
      ? ensureLightsRegistry(this._regStore, this._hass, this.state.model.areas, ()=>this._render())
      : { areaMap:{}, platformMap:{}, loading:true };
    const lightsLoading = reg.loading;
    const lights = gatherLights(this._hass?.states||{}, reg.areaMap, this.state._shapeOverrides, this.state._tier, reg.platformMap, this.state._typeOverrides, reg.pairMap, reg.manufacturerMap);

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
      isolux: !!this.state._isolux,
      ambient: sunAmbient(this._hass),
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
      // The use surface — wireUseSurface (shared). The renderer is asked for the
      // use-mode ergonomics: the code as its own tap target (codeChip), a
      // ≥44 px halo under every marker (hitHalo), the piles of unplaced
      // devices collapsed to one chip per room (collapseUnplaced), and the
      // layer chips' class filter. The Mapping tab's host asks for none of
      // these: there a click selects and a drag places.
      codeChip: true,
      hitHalo: true,
      collapseUnplaced: true,
      classFilter: this.state._classFilter,
      onClassFilter: (cls)=>{
        this.state._classFilter=cls;
        try{ localStorage.setItem(LS_CLASS, cls); }catch(_){}
        this._render();
      },
      onHexesBuilt: (isoDiv)=>{
        requestAnimationFrame(()=>wireUseSurface(isoDiv, this._useApi(lightsByEid, lights)));
      },
      // A row in the list is the same object as its marker on the map, so a
      // tap here has to mean the same thing a tap THERE means — the map's
      // own click handler (wirePress in lights_map.js) already special-cases
      // motion to open its activity history instead of the read-only
      // refusal; this row click went through the generic toggle path
      // unconditionally and never got the same treatment, so clicking a
      // motion sensor in the list still said "read-only" long after tapping
      // its marker on the map started opening the calendar.
      onRowClick: (l)=> l.isMotion ? openActivityCalendar(this._hass, l.entity_id) : this._toggle(l.entity_id),
      onRowLongPress: (l)=>{ if(isWledLight(l) || isPartitionLight(l) || l.dimmable || l.isFan) this._openWledDetail(l.entity_id); },
      // The "⋯" on every row: the controls in plain sight.
      onRowMore: (l)=>{ if(isWledLight(l) || isPartitionLight(l) || l.dimmable || l.isFan) this._openWledDetail(l.entity_id); else this._toggle(l.entity_id); },
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
      // The index's own filter + sort — independent of the map's layer
      // chips (classFilter/onClassFilter above): this hides rows outright,
      // the ordinary meaning of "filter" for a list, so choosing a type
      // here never has the side effect of dimming the map too.
      tableClassFilter: this.state._tableClassFilter || "all",
      onTableClassFilter: (cls)=>{ this.state._tableClassFilter=cls; this._render(); },
      tableSort: this.state._tableSort || null,
      onTableSort: (next)=>{ this.state._tableSort=next; this._render(); },
      tableHealthFilter: !!this.state._tableHealthFilter,
      onTableHealthFilter: (on)=>{ this.state._tableHealthFilter=on; this._render(); },
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
      `padding:10px 18px;border-radius:12px;font-size:13px;color:#e2e8f0;z-index:9999;`+
      `background:${isError?"rgba(127,29,29,.92)":"rgba(16,40,26,.92)"};`+
      `border:1px solid ${isError?"#dc2626":"rgba(82,183,136,.6)"};`+
      `backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);`+
      `box-shadow:0 8px 30px rgba(0,0,0,.5),0 0 20px ${isError?"rgba(220,38,38,.2)":"rgba(82,183,136,.15)"};`+
      `white-space:pre-wrap;max-width:320px;text-align:center`;
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
