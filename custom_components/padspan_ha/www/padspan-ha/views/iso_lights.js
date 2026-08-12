// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
// See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
//
// THE lights map renderer — the 3D isometric stacked-floor SVG used by BOTH
// the Lights sidebar panel and the Mapping → Lights tab. One renderer, one
// look: the two tools previously drew completely different maps (iso stack
// vs a flat per-floor metre canvas), which made cross-referencing hexes
// useless. Moved verbatim out of lights_panel.js; keep all edits HERE.

const { makeStackXform, imageAr, fabricWorldRooms } =
  await import(`./stack_transform.js${new URL(import.meta.url).search}`);
const { WLED_BORDER } =
  await import(`./light_codes.js${new URL(import.meta.url).search}`);

function escSVG(s){ return String(s??"").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;"); }

// ── Room colour — same palette + hash as panel.js ────────────────────────────
const ROOM_PAL = ["#52b788","#f59e0b","#60a5fa","#e879f9","#fb923c","#34d399","#f87171","#a78bfa","#2dd4bf","#facc15"];
export function roomColor(name){
  let h=0; for(let i=0;i<name.length;i++) h=(h*31+name.charCodeAt(i))>>>0;
  return ROOM_PAL[h % ROOM_PAL.length];
}

// Flat-top hexagon points in SVG px (pointy-top orientation)
export function hexPts(cx, cy, r){
  const pts=[];
  for(let k=0;k<6;k++){
    const a=(90+k*60)*Math.PI/180;
    pts.push(`${(cx+r*Math.cos(a)).toFixed(1)},${(cy+r*Math.sin(a)).toFixed(1)}`);
  }
  return pts.join(" ");
}

// One marker outline for a fixture kind. Every shape is inscribed in the same
// radius r, so clusters pack identically whatever the mix — and the code text
// stays centred and legible inside all of them. Unknown kinds fall back to the
// hexagon, which is what makes an arbitrary override string harmless.
export function shapeSvg(kind, cx, cy, r, attrs){
  const n=(v)=>v.toFixed(1);
  const poly=(pts)=>`<polygon points="${pts}" ${attrs}/>`;
  switch(kind){
    case "circle":
      return `<circle cx="${n(cx)}" cy="${n(cy)}" r="${n(r)}" ${attrs}/>`;
    case "bar": {
      // Capsule: a strip reads as elongated even at cluster size.
      const w=r*1.5, h=r*0.82;
      return `<rect x="${n(cx-w)}" y="${n(cy-h)}" width="${n(w*2)}" height="${n(h*2)}" `+
             `rx="${n(h)}" ry="${n(h)}" ${attrs}/>`;
    }
    case "square": {
      const s=r*0.86;
      return `<rect x="${n(cx-s)}" y="${n(cy-s)}" width="${n(s*2)}" height="${n(s*2)}" `+
             `rx="2" ${attrs}/>`;
    }
    case "triangle":
      // Slightly oversized: an equilateral triangle looks small beside a hex.
      return poly([[cx,cy-r*1.15],[cx+r*1.1,cy+r*0.78],[cx-r*1.1,cy+r*0.78]]
        .map(p=>`${n(p[0])},${n(p[1])}`).join(" "));
    case "diamond":
      return poly([[cx,cy-r*1.12],[cx+r*1.0,cy],[cx,cy+r*1.12],[cx-r*1.0,cy]]
        .map(p=>`${n(p[0])},${n(p[1])}`).join(" "));
    default:
      return poly(hexPts(cx,cy,r));
  }
}

// Cluster offsets (SVG px) for N hexes touching around a centre
export function hexCluster(n, r){
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

// Iso projection constants — shared with the drag-inversion in maps.js.
export const ISO = { TILE: 220, CX: 380, CY: 590, W: 760, BASE_H: 940, HEX_R: 14 };

// ── Isometric 3-D SVG builder (same projection as Overview) ──────────────────
export function buildIsoSVG(maps_list, byRoom, hiddenEids, focusZ, floorGap, horizGap, lightsByEid={}, lightsLoading=false, floors=[], model=null){
  const {TILE, CX, CY, W, BASE_H, HEX_R} = ISO;
  const FG=floorGap, HG=horizGap||0;
  const LAYER_PAL = ["#52b788","#f59e0b","#60a5fa","#e879f9","#fb923c","#34d399","#f87171","#a78bfa"];

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
  // Fabric-first: the committed metre fabric (anchored to the world frame by
  // a measured map) is what the house looks like; per-photo room_bounds stay
  // only as the un-anchored fallback. Also kills the "two Mains" duplication.
  const fabricW = model ? fabricWorldRooms(maps_list, model) : null;
  // Every light with a pin on any map, so a pinned light is never ALSO drawn
  // as an auto-cluster hex on a different floor.
  const allPlaced={};
  for(const m of sorted) for(const lt of (m.lights||[])) allPlaced[lt.entity_id]=lt;
  const hasBounds=sorted.some(m=>Object.keys(m.room_bounds||{}).length>0) || !!(fabricW && Object.keys(fabricW).length);

  for(const [z,group] of [...byLevel.entries()].sort((a,b)=>a[0]-b[0])){
    const isFocused=focusZ===null||(Array.isArray(focusZ)?focusZ.includes(z):focusZ===z);
    const go=isFocused?1.0:0.1;
    // A ghosted floor is a backdrop, not a target: at 0.1 opacity its hexes are
    // invisible but would still swallow clicks and drags meant for the focused
    // floor (they overlap in iso space), so you'd toggle or move a light you
    // cannot see.
    const gpe=isFocused?"":` pointer-events="none"`;
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

    s+=`<g opacity="${go}"${gpe}>`;
    // Slab sides
    s+=`<polygon points="${pts([TR,BR,BR_b,TR_b])}" fill="#0d2318" fill-opacity="0.35" stroke="#253e2e" stroke-width="0.8"/>`;
    s+=`<polygon points="${pts([BL,BR,BR_b,BL_b])}" fill="#0a1a12" fill-opacity="0.3" stroke="#253e2e" stroke-width="0.8"/>`;
    s+=`<polygon points="${pts([TL,TR,BR,BL])}" fill="#0f2017" fill-opacity="0.06" stroke="${lyrColor}" stroke-width="1.5" stroke-dasharray="10,5" opacity="0.5"/>`;
    if(lidx!==1) s+=`<polygon points="${pts([TL,TR,BR,BL])}" fill="url(#flrpat_${lidx})" stroke="none"/>`;

    // Room polygons + room name labels + hexagons. `extra` carries data-*
    // attributes (floor z, owning map for placed pins) so the Mapping →
    // Lights tab's build tools can act on any hex directly; the sidebar
    // ignores them.
    const markerSvg=(l,hx,hy,entry,extra="")=>{
      const on=l.state==="on";
      // A custom pin colour applies to the LIT state only. Using it while the
      // light is off made every placed light look permanently on, which breaks
      // the one thing the sidebar exists for.
      const fill=on?((entry&&entry.color)||"#fbbf24"):"#374151";
      const stroke=l.isWled?WLED_BORDER:"#60a5fa";
      const op=on?1:0.45;
      const tCol=on?"#111827":"#e2e8f0";
      return `<g class="lhex" data-eid="${escSVG(l.entity_id)}"${extra?" "+extra:""} style="cursor:pointer" opacity="${op}">`+
        shapeSvg(l.shape, hx, hy, HEX_R, `fill="${fill}" stroke="${stroke}" stroke-width="2"`)+
        `<text x="${hx.toFixed(1)}" y="${hy.toFixed(1)}" text-anchor="middle" dominant-baseline="middle" `+
        `font-family="monospace" font-size="11" font-weight="700" fill="${tCol}" pointer-events="none">`+
        `${escSVG(l.code)}</text></g>`;
    };

    // Room shapes: fabric-first (one true shape per room from the committed
    // metre fabric). Per-photo room_bounds remain only as the un-anchored
    // fallback — where the old "two Mains" duplication needed the seenRooms
    // dedupe.
    const groupFids = new Set(group.map(m=>String(m.stack?.floor_id||m.floor_id||"main")));
    const fabHere = fabricW
      ? Object.entries(fabricW).filter(([,fr])=>groupFids.has(fr.floor_id)) : [];
    // Lights placed on ANY map render at their exact spot and are excluded
    // from the auto hex clusters. The exclusion has to span EVERY map, not
    // just this group's: a light pinned on one floor whose room later moves to
    // another floor would otherwise be drawn twice — once as a pin, once as a
    // cluster hex — and counted twice.
    const groupPlaced=allPlaced;

    const emitRoom=(room,pp,lix,liy)=>{
      const color=roomColor(room);
      s+=`<polygon points="${pp}" fill="${color}" fill-opacity="0.2" stroke="${color}" stroke-width="1.5" opacity="0.9"/>`;
      s+=`<text x="${Math.round(lix)}" y="${Math.round(liy)}" text-anchor="middle" dominant-baseline="middle" `+
        `fill="${color}" font-size="8" font-family="system-ui,sans-serif" opacity="0.7" pointer-events="none">`+
        `${escSVG(room)}</text>`;
      // Room assignment isn't known yet (registry still loading) — show a
      // single pulsing placeholder instead of blocking the whole map on
      // a multi-MB registry fetch; real hexes replace it once it lands.
      if(lightsLoading){
        s+=`<polygon points="${hexPts(lix,liy,HEX_R)}" fill="#374151" stroke="#60a5fa" stroke-width="2" opacity="0.5">`+
          `<animate attributeName="opacity" values="0.25;0.65;0.25" dur="1.2s" repeatCount="indefinite"/>`+
          `</polygon>`;
        return;
      }
      // Hexagon cluster for this room's unplaced lights (Pro-positioned
      // lights were already drawn at their exact spot).
      const roomLights=(byRoom[room]||[]).filter(l=>!hiddenEids.has(l.entity_id) && !groupPlaced[l.entity_id]);
      if(!roomLights.length) return;
      const offsets=hexCluster(roomLights.length, HEX_R);
      roomLights.forEach((l,idx)=>{
        const [dx,dy]=offsets[idx];
        s+=markerSvg(l, lix+dx, liy+dy, null, `data-z="${z}"`);
      });
    };

    if(fabHere.length){
      for(const [room,fr] of fabHere){
        const pp=fr.pts.map(p=>pt(iso(p[0],p[1],z))).join(" ");
        const cx=fr.pts.reduce((a,p)=>a+p[0],0)/fr.pts.length;
        const cy=fr.pts.reduce((a,p)=>a+p[1],0)/fr.pts.length;
        const [lix,liy]=iso(cx,cy,z);
        emitRoom(room,pp,lix,liy);
      }
    }
    const seenRooms=new Set(fabHere.map(([room])=>room));
    for(const m of group){
      const mapPt = makeStackXform(m.stack, imageAr(m)).mapPt;

      // Lights with a Pro-placed pin on THIS map render at their exact spot,
      // regardless of which room (or no room) they're assigned to. Position
      // is still purely a "fraction of room/world space" concept, drawn
      // through the same mapPt/iso pipeline as room polygons — no raw photo
      // is ever involved in this view.
      const posByEid={};
      for(const lt of (m.lights||[])) posByEid[lt.entity_id]=lt;
      for(const [eid,entry] of Object.entries(posByEid)){
        if(hiddenEids.has(eid)) continue;
        const l=lightsByEid[eid];
        if(!l) continue;
        const [wx,wy]=mapPt(entry.x, entry.y);
        const [hx,hy]=iso(wx,wy,z);
        s+=markerSvg(l,hx,hy,entry,`data-z="${z}" data-map="${escSVG(m.id)}" data-placed="1"`);
      }

      if(fabHere.length) continue;   // the fabric drew this group's rooms
      for(const [room,b] of Object.entries(m.room_bounds||{})){
        if(!b || seenRooms.has(room)) continue;
        seenRooms.add(room);
        let roomCx, roomCy;   // world-space centroid
        let pp;
        if(b.type==="poly" && Array.isArray(b.points) && b.points.length>=3){
          pp=b.points.map(p=>{const[wx,wy]=mapPt(p[0],p[1]);return pt(iso(wx,wy,z));}).join(" ");
          roomCx=b.points.reduce((a,p)=>a+p[0],0)/b.points.length;
          roomCy=b.points.reduce((a,p)=>a+p[1],0)/b.points.length;
        } else if(b.type==="circle"){
          const N=16, rcx=b.cx??0.5, rcy=b.cy??0.5, rr=b.r??0.12;
          pp=Array.from({length:N},(_,i)=>{
            const a=i*2*Math.PI/N;
            const[wx,wy]=mapPt(rcx+rr*Math.cos(a), rcy+rr*Math.sin(a));
            return pt(iso(wx,wy,z));
          }).join(" ");
          roomCx=rcx; roomCy=rcy;
        } else { continue; }
        const [lwx,lwy]=mapPt(roomCx,roomCy);
        const [lix,liy]=iso(lwx,lwy,z);
        emitRoom(room,pp,lix,liy);
      }
    }

    // Floor level badge
    s+=`<circle cx="${Math.round(BL[0])}" cy="${Math.round(BL[1])}" r="15" fill="${lyrColor}" opacity="0.95"/>`;
    s+=`<text x="${Math.round(BL[0])}" y="${Math.round(BL[1])+6}" text-anchor="middle" fill="#071008" font-size="14" font-weight="700">${lidx+1}</text>`;
    s+=`</g>`;
  }

  if(!hasBounds && sorted.length){
    s+=`<text x="${W/2}" y="${BASE_H-20}" text-anchor="middle" fill="#4a6052" font-size="15">`+
      `Go to Maps → Edit to draw room boundaries</text>`;
  }

  // Legend
  s+=`<line x1="10" y1="${BASE_H+4}" x2="${W-10}" y2="${BASE_H+4}" stroke="#1b3526" stroke-width="0.8"/>`;
  sortedLevels.forEach((z,i)=>{
    const ly=BASE_H+10+i*30, color=levelColor(z);
    // The real HA floor name (never the uploaded photo's own name) — z_level
    // is synced from the floor's own "level" attribute, so this is the same
    // lookup floorLabel()/​_getFocusLbl() already use elsewhere in this file.
    const fl=floors.find(f=>f.level===z);
    const groupLabel=fl?(fl.name||`Floor ${z}`):`Floor ${z}`;
    s+=`<circle cx="18" cy="${ly+11}" r="11" fill="${color}" opacity="0.9"/>`;
    s+=`<text x="18" y="${ly+15}" text-anchor="middle" fill="#071008" font-size="12" font-weight="700">${i+1}</text>`;
    s+=`<text x="36" y="${ly+15}" fill="${color}" font-size="18" font-weight="500">${escSVG(groupLabel)}</text>`;
  });

  s+=`</svg>`;
  return s;
}
