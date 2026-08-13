// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
// See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
//
// THE lights map renderer — the 3D isometric stacked-floor SVG used by BOTH
// the Lights sidebar panel and the Mapping → Lights tab. One renderer, one
// look, so a hex means the same thing in both tools.
//
// FABRIC ONLY. This file does not import stack_transform, never sees a map,
// a photo, an image aspect ratio or a per-photo coordinate, and it does not
// need one to exist. Rooms are metre polygons from room_geometry_m; lights
// are metres from light_positions_m; floors and their heights come from the
// floor registry. It used to derive its world frame from a MEASURED PHOTO
// (metreAnchor), draw each floor slab as that photo's footprint, and take a
// dropped light's floor from the map under it — so a house with no uploaded
// plan, or one whose plan was never measured, rendered nothing at all and
// refused to place a light. Everything the view needs is in the fabric, in
// metres, and now that is the only thing it reads.

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
  // Every shape stays within the hexagon's own width (r*√3 ≈ 1.73r), because
  // hexCluster packs markers at that pitch — a wider marker would overlap its
  // neighbours in any room holding more than one light. HW is that half-width.
  const HW=r*0.866;
  switch(kind){
    case "circle":
      return `<circle cx="${n(cx)}" cy="${n(cy)}" r="${n(HW)}" ${attrs}/>`;
    case "bar": {
      // Capsule at ~2:1 — reads as a strip without exceeding the hex footprint.
      const h=r*0.55;
      return `<rect x="${n(cx-HW)}" y="${n(cy-h)}" width="${n(HW*2)}" height="${n(h*2)}" `+
             `rx="${n(h)}" ry="${n(h)}" ${attrs}/>`;
    }
    case "square":
      return `<rect x="${n(cx-HW)}" y="${n(cy-HW)}" width="${n(HW*2)}" height="${n(HW*2)}" `+
             `rx="2" ${attrs}/>`;
    case "triangle":
      return poly([[cx,cy-r],[cx+HW,cy+r*0.62],[cx-HW,cy+r*0.62]]
        .map(p=>`${n(p[0])},${n(p[1])}`).join(" "));
    case "diamond":
      return poly([[cx,cy-r],[cx+HW,cy],[cx,cy+r],[cx-HW,cy]]
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

// Iso canvas constants. There is no TILE any more: the scale is derived from
// the fabric's own extent, so a 12 m flat and a 40 000 m² warehouse both fill
// the frame instead of one being a dot and the other running off the canvas.
export const ISO = { CX: 380, CY: 590, W: 760, BASE_H: 940, HEX_R: 14 };

// A marker is a real object in a real room, so it is sized in METRES like
// everything else here. HEX_R used to be a flat 14 px, which was proportionate
// back when the world was a normalised photo — but the scale now comes from
// the fabric, so on a 25 x 51 m house one marker measured 2.38 m across: wider
// than the Laundry it sat in, and the map became unreadable. MIN keeps a
// marker clickable and its code legible on a large site; MAX stops a studio
// flat rendering saucers.
export const MARKER_M = 0.6;      // nominal fixture footprint, metres
const MARKER_MIN_R = 5;           // px, floor for legibility (still a ~15px target on screen,
                                  // because the sidebar upscales this 760-unit viewBox to its width)
const MARKER_MAX_R = 14;          // px, the old fixed size as the ceiling

export function markerRadiusPx(scale){
  const r = (MARKER_M * scale) / (2 * 0.866);   // metres across → hex radius
  return Math.max(MARKER_MIN_R, Math.min(MARKER_MAX_R, r));
}

const CIRCLE_SEGMENTS = 16;

function circleToPoly(cx, cy, r){
  return Array.from({length:CIRCLE_SEGMENTS},(_,i)=>{
    const a=i*2*Math.PI/CIRCLE_SEGMENTS;
    return [cx+r*Math.cos(a), cy+r*Math.sin(a)];
  });
}

// ── THE frame: metres → screen, derived from the fabric alone ────────────────
// Exported so the Mapping tab's drag inverts through the SAME projection this
// draws with. When those two were computed separately they could disagree,
// and a dragged light landed somewhere other than where it was dropped.
export function fabricFrame(model, floors, floorGap, horizGap){
  const {CX, CY, W, BASE_H} = ISO;
  const FG = floorGap, HG = horizGap || 0;

  const geo    = (model && model.room_geometry_m) || {};
  const lightsM= (model && model.light_positions_m) || {};
  const floorList = floors || [];

  // A floor's iso height, without ever consulting a map. `level` is the
  // authority when the Floor Heights table has been filled in — but on a real
  // install every floor can still be null, and Number(null) is 0, so reading
  // it naively stacks Basement, Main, Upper and Outside on ONE slab. Base
  // elevation is the second authority; failing both, floors are ranked in
  // registry order so they at least stay distinct and stable. The stack that
  // used to come from a photo's z_level now comes from the floor list.
  const elevations = (model && model.floor_elevations) || {};
  const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  // Floors the FABRIC actually uses, which is not the same set as the floor
  // registry: the outdoor sentinel is "__outside__" in the fabric and
  // "outside" in the registry, so ranking the registry alone dropped it back
  // to 0 and drew the garden on top of the basement.
  // The fabric's outdoor sentinel and the registry's outdoor floor are the
  // same place under two spellings; treating them as two floors left a gap in
  // the stack and drew the garden on a storey of its own.
  const canon = (id) => {
    const s = String(id || "main");
    if (s !== "__outside__") return s;
    return floorList.some(f => String(f.id) === "outside") ? "outside" : s;
  };
  const fabricFloorIds = new Set();
  for (const g of Object.values((model && model.room_geometry_m) || {})) {
    if (g && typeof g === "object") fabricFloorIds.add(canon(g.floor_id));
  }
  for (const lp of Object.values((model && model.light_positions_m) || {})) {
    if (lp && typeof lp === "object") fabricFloorIds.add(canon(lp.floor_id));
  }
  const ranked = (() => {
    const regIds = floorList.map(f => String(f.id));
    if (floorList.length && floorList.every(f => num(f.level) !== null)) return null;  // explicit levels win
    const extra = [...fabricFloorIds].filter(id => !regIds.includes(id)).sort();
    const ids = [...regIds, ...extra];
    const elev = ids.map(id => num(elevations[id]));
    const useElev = elev.some(v => v !== null) && new Set(elev).size > 1;
    const order = ids.map((id, i) => ({ id, key: useElev ? (elev[i] ?? 0) : i }))
      .sort((a, b) => a.key - b.key);
    const out = {};
    order.forEach((o, i) => { out[o.id] = i; });
    return out;
  })();
  const levelOf = (fidRaw) => {
    const fid = canon(fidRaw);
    const f = floorList.find(x => String(x.id) === fid);
    const explicit = f ? num(f.level) : null;
    if (explicit !== null) return explicit;
    if (ranked && Object.prototype.hasOwnProperty.call(ranked, String(fid))) return ranked[String(fid)];
    return 0;
  };

  const rooms = [];
  for(const [room, g] of Object.entries(geo)){
    if(!g || typeof g !== "object") continue;
    const fid = String(g.floor_id || "main");
    let pts = null;
    if(g.type === "poly" && Array.isArray(g.points_m) && g.points_m.length >= 3){
      pts = g.points_m.map(p => [Number(p[0]), Number(p[1])]);
    } else if(g.type === "circle"){
      pts = circleToPoly(Number(g.cx_m)||0, Number(g.cy_m)||0, Number(g.r_m)||0.5);
    }
    if(!pts || pts.some(p => !Number.isFinite(p[0]) || !Number.isFinite(p[1]))) continue;
    rooms.push({ room, floor_id: fid, z: levelOf(fid), pts });
  }

  const lights = [];
  for(const [eid, lp] of Object.entries(lightsM)){
    const x = Number(lp && lp.x_m), y = Number(lp && lp.y_m);
    if(!Number.isFinite(x) || !Number.isFinite(y)) continue;
    const fid = String((lp && lp.floor_id) || "main");
    lights.push({ eid, lp, floor_id: fid, z: levelOf(fid), x, y });
  }

  // Extent that sets the scale. Outdoor areas are excluded when there is a
  // building to look at: a shed 50 m down the garden is legitimately part of
  // the fabric, but letting it size the frame shrinks the whole house into a
  // corner — which is exactly how it rendered. Outdoor rooms still draw, they
  // just don't get a vote on how big everything else is.
  const isOutside = (fid) => canon(fid) === "outside" || String(fid) === "__outside__";
  const indoorRooms  = rooms.filter(r => !isOutside(r.floor_id));
  const indoorLights = lights.filter(l => !isOutside(l.floor_id));
  const scaleRooms  = indoorRooms.length  ? indoorRooms  : rooms;
  const scaleLights = indoorRooms.length  ? indoorLights : lights;

  let minX=Infinity, minY=Infinity, maxX=-Infinity, maxY=-Infinity;
  const grow=(x,y)=>{ if(x<minX)minX=x; if(x>maxX)maxX=x; if(y<minY)minY=y; if(y>maxY)maxY=y; };
  for(const r of scaleRooms) for(const p of r.pts) grow(p[0], p[1]);
  for(const l of scaleLights) grow(l.x, l.y);
  const empty = !rooms.length && !lights.length;
  if(!isFinite(minX)){ minX=0; minY=0; maxX=10; maxY=8; }

  const padM  = Math.max(0.5, Math.max(maxX-minX, maxY-minY) * 0.04);
  minX-=padM; minY-=padM; maxX+=padM; maxY+=padM;
  const spanX = Math.max(0.001, maxX-minX), spanY = Math.max(0.001, maxY-minY);
  const mx=(minX+maxX)/2, my=(minY+maxY)/2;

  // Pixels per metre, chosen so the diamond footprint fits the canvas. The
  // iso footprint is (spanX+spanY) wide at 0.866 and tall at 0.5.
  const S = Math.min((W-90)/((spanX+spanY)*0.866), (BASE_H-260)/((spanX+spanY)*0.5));

  const iso    = (x,y,z)=>[ CX + ((x-mx)-(y-my))*S*0.866 + z*HG,
                            CY + ((x-mx)+(y-my))*S*0.5   - z*FG ];
  const isoInv = (sx,sy,z)=>{
    const a=(sx - CX - z*HG)/(S*0.866);
    const b=(sy - CY + z*FG)/(S*0.5);
    return [ (a+b)/2 + mx, (b-a)/2 + my ];
  };

  const levels = [...new Set([...rooms.map(r=>r.z), ...lights.map(l=>l.z)])].sort((a,b)=>a-b);
  return { rooms, lights, levels, iso, isoInv, scale: S, bbox:{minX,minY,maxX,maxY}, empty, levelOf };
}

// ── Isometric 3-D SVG builder ────────────────────────────────────────────────
export function buildIsoSVG(model, byRoom, hiddenEids, focusZ, floorGap, horizGap, lightsByEid={}, lightsLoading=false, floors=[]){
  const {CX, CY, W, BASE_H} = ISO;
  const FG=floorGap;
  const LAYER_PAL = ["#52b788","#f59e0b","#60a5fa","#e879f9","#fb923c","#34d399","#f87171","#a78bfa"];

  const frame = fabricFrame(model, floors, floorGap, horizGap);
  const { iso, rooms, lights, levels } = frame;
  // Markers are sized from the fabric's own scale, not a fixed pixel count.
  const HEX_R = markerRadiusPx(frame.scale);
  const CODE_PX = Math.max(8, Math.min(11, HEX_R * 1.45));
  const pt  = c=>`${Math.round(c[0])},${Math.round(c[1])}`;
  const pts = cs=>cs.map(pt).join(" ");

  const levelColor=(z)=>LAYER_PAL[levels.indexOf(z)%LAYER_PAL.length];
  const LEGEND_H=Math.max(1,levels.length)*30+24;
  const maxIsoZ = levels.length ? levels[levels.length-1] : 0;
  const viewY   = Math.min(0, CY - maxIsoZ*FG - 50);   // 50 px top padding
  const HTOTAL  = BASE_H + LEGEND_H - viewY;

  let s=`<svg viewBox="0 ${viewY} ${W} ${HTOTAL}" xmlns="http://www.w3.org/2000/svg" width="100%" `+
    `style="max-height:${HTOTAL}px;display:block;font-family:system-ui,sans-serif">`;
  s+=`<rect x="0" y="${viewY}" width="${W}" height="${HTOTAL}" fill="#071008"/>`;

  // Floor surface patterns
  s+=`<defs>`;
  levels.forEach((z2,li)=>{
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

  // Nothing in the fabric yet. The old copy blamed a missing PHOTO ("No floor
  // plans uploaded yet"), which sent people to upload an image that this view
  // does not use and cannot draw from.
  if(!rooms.length && !lights.length){
    s+=`<text x="${W/2}" y="${BASE_H/2}" text-anchor="middle" fill="#4a6052" font-size="14">`+
      `No rooms in the fabric yet — build a floor in Mapping → Rooms.</text>`;
    s+=`</svg>`; return s;
  }

  const slabWZ=18/FG;
  const placed={};
  for(const l of lights) placed[l.eid]=l.lp;

  for(const z of levels){
    const isFocused=focusZ===null||(Array.isArray(focusZ)?focusZ.includes(z):focusZ===z);
    const go=isFocused?1.0:0.1;
    // A ghosted floor is a backdrop, not a target: at 0.1 opacity its hexes are
    // invisible but would still swallow clicks and drags meant for the focused
    // floor (they overlap in iso space), so you'd toggle or move a light you
    // cannot see.
    const gpe=isFocused?"":` pointer-events="none"`;
    const lyrColor=levelColor(z);
    const lidx=levels.indexOf(z);

    const hereRooms  = rooms.filter(r=>r.z===z);
    const hereLights = lights.filter(l=>l.z===z);

    // The slab is the extent of what this floor CONTAINS, in metres — not the
    // footprint of a photograph of it.
    let x0=Infinity,y0_=Infinity,x1=-Infinity,y1_=-Infinity;
    const growS=(x,y)=>{ if(x<x0)x0=x; if(x>x1)x1=x; if(y<y0_)y0_=y; if(y>y1_)y1_=y; };
    for(const r of hereRooms) for(const p of r.pts) growS(p[0],p[1]);
    for(const l of hereLights) growS(l.x,l.y);
    if(!isFinite(x0)){ x0=frame.bbox.minX; y0_=frame.bbox.minY; x1=frame.bbox.maxX; y1_=frame.bbox.maxY; }
    else {
      const padS=Math.max(0.4, Math.max(x1-x0, y1_-y0_)*0.06);
      x0-=padS; y0_-=padS; x1+=padS; y1_+=padS;
    }

    const TL=iso(x0,y0_,z), TR=iso(x1,y0_,z), BR=iso(x1,y1_,z), BL=iso(x0,y1_,z);
    const TR_b=iso(x1,y0_,z-slabWZ), BR_b=iso(x1,y1_,z-slabWZ), BL_b=iso(x0,y1_,z-slabWZ);

    s+=`<g opacity="${go}"${gpe}>`;
    // Slab sides
    s+=`<polygon points="${pts([TR,BR,BR_b,TR_b])}" fill="#0d2318" fill-opacity="0.35" stroke="#253e2e" stroke-width="0.8"/>`;
    s+=`<polygon points="${pts([BL,BR,BR_b,BL_b])}" fill="#0a1a12" fill-opacity="0.3" stroke="#253e2e" stroke-width="0.8"/>`;
    s+=`<polygon points="${pts([TL,TR,BR,BL])}" fill="#0f2017" fill-opacity="0.06" stroke="${lyrColor}" stroke-width="1.5" stroke-dasharray="10,5" opacity="0.5"/>`;
    if(lidx!==1) s+=`<polygon points="${pts([TL,TR,BR,BL])}" fill="url(#flrpat_${lidx})" stroke="none"/>`;

    // `extra` carries data-* attributes (floor z, whether it is placed) so the
    // Mapping → Lights tab's build tools can act on any hex directly; the
    // sidebar ignores them.
    const markerSvg=(l,hx,hy,entry,extra="")=>{
      const on=l.state==="on";
      // A custom pin colour applies to the LIT state only. Using it while the
      // light is off made every placed light look permanently on, which breaks
      // the one thing the sidebar exists for.
      const fill=on?((entry&&entry.color)||"#fbbf24"):"#374151";
      const stroke=l.isWled?WLED_BORDER:"#60a5fa";
      const op=on?1:0.45;
      const tCol=on?"#111827":"#e2e8f0";
      // Physical size and rotation, in real units. width_cm/height_cm and
      // rotation have been in the stored schema all along and the WS command
      // has always accepted them — nothing ever drew them, which is why
      // "scaling and rotate don't work": they were never wired up. A metre of
      // fixture is frame.scale pixels, so a 2.4 m valance reads as a long bar
      // and a downlight stays a dot, at any zoom.
      const t=[];
      const rot=Number(entry&&entry.rotation)||0;
      const wCm=Number(entry&&entry.width_cm)||0;
      const hCm=Number(entry&&entry.height_cm)||0;
      let sx=1, sy=1;
      if(wCm>0||hCm>0){
        const baseW=HEX_R*2*0.866, baseH=HEX_R*2;
        // Faithful to the measurement. The floor used to be 1× — never
        // smaller than the default marker — but the default marker is already
        // about 2.4 m wide at a house's scale, so every real fixture came out
        // the same size and setting a width appeared to do nothing at all.
        // 0.5× keeps a 15 cm downlight clickable while a 2.4 m valance and a
        // 5 m run are visibly different; 8× stops one long strip swamping its
        // floor.
        sx=Math.max(0.5, Math.min(8, ((wCm||hCm)/100)*frame.scale/baseW));
        sy=Math.max(0.5, Math.min(8, ((hCm||wCm)/100)*frame.scale/baseH));
      }
      if(rot||sx!==1||sy!==1){
        t.push(`translate(${hx.toFixed(1)},${hy.toFixed(1)})`);
        if(rot) t.push(`rotate(${rot.toFixed(1)})`);
        if(sx!==1||sy!==1) t.push(`scale(${sx.toFixed(3)},${sy.toFixed(3)})`);
      }
      // The outline scales and rotates; the CODE never does. A rotated or
      // stretched label is the thing that stops the map being readable at a
      // glance, which is the entire point of the view.
      const body = t.length
        ? `<g transform="${t.join(" ")}">`+
          shapeSvg(l.shape, 0, 0, HEX_R, `fill="${fill}" stroke="${stroke}" stroke-width="${(2/Math.max(sx,sy)).toFixed(2)}"`)+
          `</g>`
        : shapeSvg(l.shape, hx, hy, HEX_R, `fill="${fill}" stroke="${stroke}" stroke-width="2"`);
      return `<g class="lhex" data-eid="${escSVG(l.entity_id)}"${extra?" "+extra:""} style="cursor:pointer" opacity="${op}">`+
        body+
        `<text x="${hx.toFixed(1)}" y="${hy.toFixed(1)}" text-anchor="middle" dominant-baseline="middle" `+
        `font-family="monospace" font-size="${CODE_PX.toFixed(1)}" font-weight="700" fill="${tCol}" pointer-events="none">`+
        `${escSVG(l.code)}</text></g>`;
    };

    // Rooms, straight from the metre fabric.
    for(const r of hereRooms){
      const color=roomColor(r.room);
      const pp=r.pts.map(p=>pt(iso(p[0],p[1],z))).join(" ");
      const cx=r.pts.reduce((a,p)=>a+p[0],0)/r.pts.length;
      const cy=r.pts.reduce((a,p)=>a+p[1],0)/r.pts.length;
      const [lix,liy]=iso(cx,cy,z);
      s+=`<polygon points="${pp}" fill="${color}" fill-opacity="0.2" stroke="${color}" stroke-width="1.5" opacity="0.9"/>`;
      s+=`<text x="${Math.round(lix)}" y="${Math.round(liy)}" text-anchor="middle" dominant-baseline="middle" `+
        `fill="${color}" font-size="8" font-family="system-ui,sans-serif" opacity="0.7" pointer-events="none">`+
        `${escSVG(r.room)}</text>`;
      // Room assignment isn't known yet (registry still loading) — show a
      // single pulsing placeholder instead of blocking the whole map on
      // a multi-MB registry fetch; real hexes replace it once it lands.
      if(lightsLoading){
        s+=`<polygon points="${hexPts(lix,liy,HEX_R)}" fill="#374151" stroke="#60a5fa" stroke-width="2" opacity="0.5">`+
          `<animate attributeName="opacity" values="0.25;0.65;0.25" dur="1.2s" repeatCount="indefinite"/>`+
          `</polygon>`;
        continue;
      }
      // Hexagon cluster for this room's unplaced lights — a light with a real
      // position was already drawn at it.
      const roomLights=(byRoom[r.room]||[]).filter(l=>!hiddenEids.has(l.entity_id) && !placed[l.entity_id]);
      if(!roomLights.length) continue;
      const offsets=hexCluster(roomLights.length, HEX_R);
      roomLights.forEach((l,idx)=>{
        const [dx,dy]=offsets[idx];
        s+=markerSvg(l, lix+dx, liy+dy, null, `data-z="${z}"`);
      });
    }

    // Placed lights — metres from the fabric, through the same projection the
    // rooms just used.
    for(const pl of hereLights){
      if(hiddenEids.has(pl.eid)) continue;
      const l=lightsByEid[pl.eid];
      if(!l) continue;
      const [hx,hy]=iso(pl.x, pl.y, z);
      s+=markerSvg(l,hx,hy,pl.lp,`data-z="${z}" data-placed="1"`);
    }

    // Floor level badge
    s+=`<circle cx="${Math.round(BL[0])}" cy="${Math.round(BL[1])}" r="15" fill="${lyrColor}" opacity="0.95"/>`;
    s+=`<text x="${Math.round(BL[0])}" y="${Math.round(BL[1])+6}" text-anchor="middle" fill="#071008" font-size="14" font-weight="700">${lidx+1}</text>`;
    s+=`</g>`;
  }

  // Legend
  s+=`<line x1="10" y1="${BASE_H+4}" x2="${W-10}" y2="${BASE_H+4}" stroke="#1b3526" stroke-width="0.8"/>`;
  levels.forEach((z,i)=>{
    const ly=BASE_H+10+i*30, color=levelColor(z);
    const fl=(floors||[]).find(f=>Number(f.level)===z);
    const groupLabel=fl?(fl.name||`Floor ${z}`):`Floor ${z}`;
    s+=`<circle cx="18" cy="${ly+11}" r="11" fill="${color}" opacity="0.9"/>`;
    s+=`<text x="18" y="${ly+15}" text-anchor="middle" fill="#071008" font-size="12" font-weight="700">${i+1}</text>`;
    s+=`<text x="36" y="${ly+15}" fill="${color}" font-size="18" font-weight="500">${escSVG(groupLabel)}</text>`;
  });

  s+=`</svg>`;
  return s;
}
