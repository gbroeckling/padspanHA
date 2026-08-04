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

const APP_VERSION = "0.21.12";
const BUILD_ID = "20260804T174118Z";

// Shared stack transform (P2-5); query inherited from our own module URL so
// the ?b= cache-buster propagates (see docs/06_UI_CACHE_BUSTING.md).
const { makeStackXform, imageAr } =
  await import(`./views/stack_transform.js${new URL(import.meta.url).search}`);

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

// ── Room colour — same palette + hash as panel.js ────────────────────────────
const ROOM_PAL = ["#52b788","#f59e0b","#60a5fa","#e879f9","#fb923c","#34d399","#f87171","#a78bfa","#2dd4bf","#facc15"];
function roomColor(name){
  let h=0; for(let i=0;i<name.length;i++) h=(h*31+name.charCodeAt(i))>>>0;
  return ROOM_PAL[h % ROOM_PAL.length];
}

// ── Hex geometry helpers ──────────────────────────────────────────────────────
function lightCode(idx){
  const letter = String.fromCharCode(65 + Math.floor(idx/99));
  const num    = String((idx%99)+1).padStart(2,"0");
  return letter+num;
}

// Flat-top hexagon points in SVG px (pointy-top orientation)
function hexPts(cx, cy, r){
  const pts=[];
  for(let k=0;k<6;k++){
    const a=(90+k*60)*Math.PI/180;
    pts.push(`${(cx+r*Math.cos(a)).toFixed(1)},${(cy+r*Math.sin(a)).toFixed(1)}`);
  }
  return pts.join(" ");
}

// Cluster offsets (SVG px) for N hexes touching around a centre
function hexCluster(n, r){
  const d=r*Math.sqrt(3)+2;  // centre-to-centre distance (tiny gap between touching hexes)
  const ring=Array.from({length:6},(_,i)=>{const a=(30+i*60)*Math.PI/180;return[d*Math.cos(a),d*Math.sin(a)];});
  const pos=[[0,0],...ring];
  if(n<=7) return pos.slice(0,n);
  // Hex-offset grid: odd rows shift right by d/2 so hexagons mesh instead of stacking as squares
  const cols=Math.max(3,Math.ceil(Math.sqrt(n*1.15)));
  const rows=Math.ceil(n/cols);
  return Array.from({length:n},(_,i)=>{
    const row=Math.floor(i/cols), col=i%cols;
    return [
      (col-(cols-1)/2)*d + (row%2)*d/2,
      (row-(rows-1)/2)*d*0.866,
    ];
  });
}

// ── Isometric 3-D SVG builder (same projection as Overview) ──────────────────
function buildIsoSVG(maps_list, byRoom, hiddenEids, focusZ, floorGap, horizGap){
  const TILE=220, CX=380, CY=590, W=760, BASE_H=940;
  const FG=floorGap, HG=horizGap||0;
  const LAYER_PAL = ["#52b788","#f59e0b","#60a5fa","#e879f9","#fb923c","#34d399","#f87171","#a78bfa"];
  const HEX_R = 14;   // hexagon radius in SVG px

  const iso = (wx,wy,wz)=>[CX+(wx-wy)*TILE*0.866+wz*HG, CY+(wx+wy)*TILE*0.5-wz*FG];
  const pt  = c=>`${Math.round(c[0])},${Math.round(c[1])}`;
  const pts = cs=>cs.map(pt).join(" ");

  const sorted  = [...maps_list].sort((a,b)=>(a.stack?.z_level||0)-(b.stack?.z_level||0));

  const byLevel = new Map();
  for(const m of sorted){
    const z=m.stack?.z_level??0;
    if(!byLevel.has(z)) byLevel.set(z,[]);
    byLevel.get(z).push(m);
  }
  const sortedLevels=[...byLevel.keys()].sort((a,b)=>a-b);
  const levelColor=(z)=>LAYER_PAL[sortedLevels.indexOf(z)%LAYER_PAL.length];
  const LEGEND_H=sortedLevels.length*30+24;
  // Dynamic viewBox: expand upward so high floors aren't clipped when spacing is large
  const maxIsoZ = sortedLevels.length ? sortedLevels[sortedLevels.length-1] : 0;
  const viewY   = Math.min(0, CY - maxIsoZ*FG - 50);   // 50 px top padding
  const HTOTAL  = BASE_H + LEGEND_H - viewY;

  let s=`<svg viewBox="0 ${viewY} ${W} ${HTOTAL}" xmlns="http://www.w3.org/2000/svg" width="100%" `+
    `style="max-height:${HTOTAL}px;display:block;font-family:system-ui,sans-serif">`;
  s+=`<rect x="0" y="${viewY}" width="${W}" height="${HTOTAL}" fill="#071008"/>`;

  // Floor surface patterns (same as Overview)
  s+=`<defs>`;
  sortedLevels.forEach((z2,li)=>{
    const c2=levelColor(z2);
    if(li===0){
      s+=`<pattern id="flrpat_${li}" x="0" y="0" width="24" height="24" patternUnits="userSpaceOnUse">`;
      s+=`<path d="M12,2 C16,2 19,6 19,11 C19,16 16,21 12,22 C8,21 5,16 5,11 C5,6 8,2 12,2 Z" fill="none" stroke="${c2}" stroke-width="0.7" opacity="0.14"/>`;
      s+=`<path d="M12,2 C13.5,0 15.5,0.5 14.5,2.5 C13.5,1.5 12,2 12,2 Z" fill="${c2}" opacity="0.11"/>`;
      s+=`<circle cx="12" cy="15" r="1.4" fill="${c2}" opacity="0.1"/></pattern>`;
    } else if(li===2){
      s+=`<pattern id="flrpat_${li}" x="0" y="0" width="12" height="12" patternUnits="userSpaceOnUse">`;
      s+=`<line x1="0" y1="12" x2="12" y2="0" stroke="${c2}" stroke-width="0.6" opacity="0.18"/>`;
      s+=`<line x1="0" y1="0" x2="12" y2="12" stroke="${c2}" stroke-width="0.6" opacity="0.18"/></pattern>`;
    } else if(li>=3){
      s+=`<pattern id="flrpat_${li}" x="0" y="0" width="16" height="13.86" patternUnits="userSpaceOnUse">`;
      s+=`<circle cx="0"  cy="0"     r="1.5" fill="${c2}" opacity="0.14"/>`;
      s+=`<circle cx="8"  cy="6.93"  r="1.5" fill="${c2}" opacity="0.14"/>`;
      s+=`<circle cx="16" cy="0"     r="1.5" fill="${c2}" opacity="0.14"/>`;
      s+=`<circle cx="0"  cy="13.86" r="1.5" fill="${c2}" opacity="0.14"/>`;
      s+=`<circle cx="16" cy="13.86" r="1.5" fill="${c2}" opacity="0.14"/></pattern>`;
    }
  });
  s+=`</defs>`;

  if(!sorted.length){
    s+=`<text x="${W/2}" y="${BASE_H/2}" text-anchor="middle" fill="#4a6052" font-size="14">No floor plans uploaded yet.</text>`;
    s+=`</svg>`; return s;
  }

  const slabWZ=18/FG;
  const hasBounds=sorted.some(m=>Object.keys(m.room_bounds||{}).length>0);

  for(const [z,group] of [...byLevel.entries()].sort((a,b)=>a[0]-b[0])){
    const isFocused=focusZ===null||(Array.isArray(focusZ)?focusZ.includes(z):focusZ===z);
    const go=isFocused?1.0:0.1;
    const lyrColor=levelColor(z);
    const lidx=sortedLevels.indexOf(z);

    // Bounding box for this group
    let x0=Infinity,y0_=Infinity,x1=-Infinity,y1_=-Infinity;
    for(const m of group){
      const bbPt = makeStackXform(m.stack, imageAr(m)).mapPt;
      for(const [cx,cy] of [[0,0],[1,0],[1,1],[0,1]]){
        const[wx,wy]=bbPt(cx,cy);
        x0=Math.min(x0,wx); y0_=Math.min(y0_,wy); x1=Math.max(x1,wx); y1_=Math.max(y1_,wy);
      }
    }
    if(!isFinite(x0)){x0=0;y0_=0;x1=1;y1_=0.75;}

    const TL=iso(x0,y0_,z), TR=iso(x1,y0_,z), BR=iso(x1,y1_,z), BL=iso(x0,y1_,z);
    const TR_b=iso(x1,y0_,z-slabWZ), BR_b=iso(x1,y1_,z-slabWZ), BL_b=iso(x0,y1_,z-slabWZ);

    s+=`<g opacity="${go}">`;
    // Slab sides
    s+=`<polygon points="${pts([TR,BR,BR_b,TR_b])}" fill="#0d2318" fill-opacity="0.35" stroke="#253e2e" stroke-width="0.8"/>`;
    s+=`<polygon points="${pts([BL,BR,BR_b,BL_b])}" fill="#0a1a12" fill-opacity="0.3" stroke="#253e2e" stroke-width="0.8"/>`;
    s+=`<polygon points="${pts([TL,TR,BR,BL])}" fill="#0f2017" fill-opacity="0.06" stroke="${lyrColor}" stroke-width="1.5" stroke-dasharray="10,5" opacity="0.5"/>`;
    if(lidx!==1) s+=`<polygon points="${pts([TL,TR,BR,BL])}" fill="url(#flrpat_${lidx})" stroke="none"/>`;

    // Room polygons + room name labels + hexagons
    for(const m of group){
      const mapPt = makeStackXform(m.stack, imageAr(m)).mapPt;

      for(const [room,b] of Object.entries(m.room_bounds||{})){
        if(!b) continue;
        const color=roomColor(room);

        let roomCx, roomCy;   // world-space centroid
        if(b.type==="poly" && Array.isArray(b.points) && b.points.length>=3){
          // Draw room polygon
          const pp=b.points.map(p=>{const[wx,wy]=mapPt(p[0],p[1]);return pt(iso(wx,wy,z));}).join(" ");
          s+=`<polygon points="${pp}" fill="${color}" fill-opacity="0.2" stroke="${color}" stroke-width="1.5" opacity="0.9"/>`;
          roomCx=b.points.reduce((a,p)=>a+p[0],0)/b.points.length;
          roomCy=b.points.reduce((a,p)=>a+p[1],0)/b.points.length;
        } else if(b.type==="circle"){
          // Draw room circle (approximated as projected ellipse via poly)
          const N=16, rcx=b.cx??0.5, rcy=b.cy??0.5, rr=b.r??0.12;
          const pp=Array.from({length:N},(_,i)=>{
            const a=i*2*Math.PI/N;
            const[wx,wy]=mapPt(rcx+rr*Math.cos(a), rcy+rr*Math.sin(a));
            return pt(iso(wx,wy,z));
          }).join(" ");
          s+=`<polygon points="${pp}" fill="${color}" fill-opacity="0.2" stroke="${color}" stroke-width="1.5" opacity="0.9"/>`;
          roomCx=rcx; roomCy=rcy;
        } else { continue; }

        // Room centroid in ISO screen coords
        const [lwx,lwy]=mapPt(roomCx,roomCy);
        const [lix,liy]=iso(lwx,lwy,z);

        // Room name label
        s+=`<text x="${Math.round(lix)}" y="${Math.round(liy)}" text-anchor="middle" dominant-baseline="middle" `+
          `fill="${color}" font-size="8" font-family="system-ui,sans-serif" opacity="0.7" pointer-events="none">`+
          `${escSVG(room)}</text>`;

        // Hexagon cluster for this room's lights
        const roomLights=(byRoom[room]||[]).filter(l=>!hiddenEids.has(l.entity_id));
        if(!roomLights.length) continue;
        const offsets=hexCluster(roomLights.length, HEX_R);
        roomLights.forEach((l,idx)=>{
          const [dx,dy]=offsets[idx];
          const hx=(lix+dx).toFixed(1), hy=(liy+dy).toFixed(1);
          const on=l.state==="on";
          const fill=on?"#fbbf24":"#374151";
          const stroke=on?"#f59e0b":"#4b5563";
          const tCol=on?"#111827":"#fbbf24";
          s+=`<g class="lhex" data-eid="${escSVG(l.entity_id)}" style="cursor:pointer">`;
          s+=`<polygon points="${hexPts(+hx,+hy,HEX_R)}" fill="${fill}" stroke="${stroke}" stroke-width="2"/>`;
          s+=`<text x="${hx}" y="${hy}" text-anchor="middle" dominant-baseline="middle" `+
            `font-family="monospace" font-size="11" font-weight="700" fill="${tCol}" pointer-events="none">`+
            `${escSVG(l.code)}</text></g>`;
        });
      }
    }

    // Floor level badge
    s+=`<circle cx="${Math.round(BL[0])}" cy="${Math.round(BL[1])}" r="15" fill="${lyrColor}" opacity="0.95"/>`;
    s+=`<text x="${Math.round(BL[0])}" y="${Math.round(BL[1])+6}" text-anchor="middle" fill="#071008" font-size="14" font-weight="700">${lidx+1}</text>`;
    s+=`</g>`;
  }

  if(!hasBounds && sorted.length){
    s+=`<text x="${W/2}" y="${BASE_H-20}" text-anchor="middle" fill="#4a6052" font-size="15">`+
      `Go to Maps \u2192 Edit to draw room boundaries</text>`;
  }

  // Legend
  s+=`<line x1="10" y1="${BASE_H+4}" x2="${W-10}" y2="${BASE_H+4}" stroke="#1b3526" stroke-width="0.8"/>`;
  sortedLevels.forEach((z,i)=>{
    const ly=BASE_H+10+i*30, color=levelColor(z);
    const groupLabel=byLevel.get(z).map(m=>m.name||m.id).join(" + ");
    s+=`<circle cx="18" cy="${ly+11}" r="11" fill="${color}" opacity="0.9"/>`;
    s+=`<text x="18" y="${ly+15}" text-anchor="middle" fill="#071008" font-size="12" font-weight="700">${i+1}</text>`;
    s+=`<text x="36" y="${ly+15}" fill="${color}" font-size="18" font-weight="500">${escSVG(groupLabel)}</text>`;
  });

  s+=`</svg>`;
  return s;
}

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
    await Promise.allSettled([
      this._loadMaps(),
      this._loadSettings(),
      this._loadModel().then(()=>this._loadLightsReg()),
    ]);
    this._render();
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
      this.state.model = { areas: res?.areas||[], floors: res?.floors||[] };
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
    try{
      const [regRes, devRes] = await Promise.all([
        this._hass.callWS({ type:"config/entity_registry/list" }),
        this._hass.callWS({ type:"config/device_registry/list" }),
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

    if(!this.state._lightsReg){
      root.appendChild(el("div",{style:"padding:24px;color:#52b788;font-family:monospace;font-size:13px"},"Loading\u2026"));
      return root;
    }

    // ── Gather lights ─────────────────────────────────────────────────────────
    const states=this._hass?.states||{};
    const regMap=this.state._lightsReg.areaMap;
    const lights=Object.keys(states)
      .filter(eid=>eid.startsWith("light."))
      .map(eid=>({
        entity_id:     eid,
        friendly_name: states[eid].attributes?.friendly_name||eid,
        state:         states[eid].state,
        area_name:     regMap[eid]||null,
      }))
      .sort((a,b)=>(a.area_name||"\xff").localeCompare(b.area_name||"\xff")||
                    a.friendly_name.localeCompare(b.friendly_name));

    if(!lights.length){
      root.appendChild(el("div",{class:"muted",style:"padding:8px"},"No light entities found."));
      return root;
    }
    lights.forEach((l,i)=>{ l.code=lightCode(i); });

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
    isoDiv.innerHTML=buildIsoSVG(maps_list, byRoom, hidden, _getFocusZ(this.state._focusIdx), this.state._floorGap, this.state._horizGap);

    const rebuildISO=()=>{
      isoDiv.style.width=`${Math.round(this.state._zoom*100)}%`;
      isoDiv.innerHTML=buildIsoSVG(maps_list, byRoom, hidden, _getFocusZ(this.state._focusIdx), this.state._floorGap, this.state._horizGap);
      wireHexClicks();
    };

    const wireHexClicks=()=>{
      requestAnimationFrame(()=>{
        isoDiv.querySelectorAll(".lhex").forEach(g=>{
          g.addEventListener("click",e=>{e.stopPropagation();this._toggle(g.dataset.eid);});
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
    if(unassigned.length){
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
      row.addEventListener("click",()=>this._toggle(l.entity_id));
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
