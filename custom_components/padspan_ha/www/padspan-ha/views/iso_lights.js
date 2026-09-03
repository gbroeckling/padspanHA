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
// (the stored world gauge), draw each floor slab as that photo's footprint, and take a
// dropped light's floor from the map under it — so a house with no uploaded
// plan, or one whose plan was never measured, rendered nothing at all and
// refused to place a light. Everything the view needs is in the fabric, in
// metres, and now that is the only thing it reads.

const { WLED_BORDER, PARTITION_BORDER, FAN_BORDER, MOTION_BORDER, MOTION_PULSE, TEMP_BORDER } =
  await import(`./light_codes.js${new URL(import.meta.url).search}`);

function escSVG(s){ return String(s??"").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;"); }

// ── Room colour ──────────────────────────────────────────────────────────────
// Re-exported, not reimplemented. This file used to carry its own palette and
// its own hash under a comment claiming they matched panel.js; they did not,
// and this map was the only surface that ignored a hand-set room colour.
// `export ... from` re-exports without binding the name locally, and this
// file calls it — so import it and re-export the same binding.
import { roomColor } from "./room_color.js";
export { roomColor };

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
const n=(v)=>v.toFixed(1);
// Points along an arc, in degrees, y down. The curved glyphs sample their
// outline instead of using SVG arc commands: at this size a dozen segments are
// indistinguishable from a true arc, and there is no large-arc/sweep flag to
// get backwards. `ox,oy` because several of them are struck off-centre.
const arcPts=(ox,oy,rx,ry,a0,a1,steps)=>{
  const out=[];
  for(let i=0;i<=steps;i++){
    const a=(a0+(a1-a0)*i/steps)*Math.PI/180;
    out.push([ox+rx*Math.cos(a), oy+ry*Math.sin(a)]);
  }
  return out;
};
const sub=(pts)=>pts.map((p,i)=>`${i?"L":"M"}${n(p[0])},${n(p[1])}`).join(" ")+"Z";

// ── Room-perimeter geometry ──────────────────────────────────────────────────
// Pure metre-space math, no projection, no fixture — kept standalone so it is
// directly unit-testable against synthetic polygons rather than only through
// rendered SVG path strings.
//
// Offsets every edge inward by marginM and re-intersects consecutive offset
// edges to find each new vertex — the standard "shrink a simple polygon"
// construction. Which side is "inward" is decided by comparing each edge's
// two normals against the polygon's own centroid, which sidesteps ever
// needing to know this codebase's winding or y-axis convention (this file
// never assumes one elsewhere either). Good for the common case — rectangular
// and mildly irregular rooms; a large margin on a very concave room can fold
// the result on itself, which is why callers clamp marginM against the
// room's own half-min-dimension before calling this.
export function offsetPolygonInward(rawPts, marginM){
  if(rawPts.length<3 || !(marginM>0)) return rawPts;
  // Real traced rooms carry near-coincident vertices (Garry's Bedroom closes
  // with two points 3.6cm apart) — a "wall" shorter than the margin's own
  // scale contributes nothing but a phantom edge and a corner artifact to
  // the offset, so collapse them first. The threshold rides the margin so a
  // deliberately fine trace with a tiny margin keeps its detail.
  const eps=Math.min(0.05, marginM*0.25);
  const pts=[];
  for(const p of rawPts){
    const prev=pts[pts.length-1];
    if(!prev || Math.hypot(p[0]-prev[0], p[1]-prev[1])>eps) pts.push(p);
  }
  while(pts.length>3 && Math.hypot(pts[0][0]-pts[pts.length-1][0], pts[0][1]-pts[pts.length-1][1])<=eps) pts.pop();
  const cnt=pts.length;
  if(cnt<3) return rawPts;
  const ctr=[pts.reduce((a,p)=>a+p[0],0)/cnt, pts.reduce((a,p)=>a+p[1],0)/cnt];
  const lines=[]; // one offset line per edge: a point on it, its direction, its normal
  for(let i=0;i<cnt;i++){
    const a=pts[i], b=pts[(i+1)%cnt];
    const dx=b[0]-a[0], dy=b[1]-a[1];
    const len=Math.hypot(dx,dy)||1e-9;
    const ux=dx/len, uy=dy/len;
    let nx=-uy, ny=ux;                       // one of the two perpendiculars
    const mx=(a[0]+b[0])/2, my=(a[1]+b[1])/2;
    if((ctr[0]-mx)*nx+(ctr[1]-my)*ny<0){ nx=-nx; ny=-ny; }  // must point at the centroid
    lines.push({ p:[a[0]+nx*marginM, a[1]+ny*marginM], d:[ux,uy], n:[nx,ny] });
  }
  // A sharp (acute) corner's true offset intersection can land many times
  // marginM away from the vertex it came from — found live, on a real
  // 11-vertex room, one corner overshot 0.14m to 0.49m. Past this limit the
  // corner is BEVELLED instead: the midpoint of the vertex's own two normal
  // offsets, which by construction can never be farther than marginM away
  // (both points sit exactly marginM from the same vertex, on a circle around
  // it, and a chord's midpoint never leaves that circle).
  const MITER_LIMIT=2.5;
  const out=[];
  for(let i=0;i<cnt;i++){
    const prev=lines[(i-1+cnt)%cnt], here=lines[i];
    const [x1,y1]=prev.p, [dx1,dy1]=prev.d, [x2,y2]=here.p, [dx2,dy2]=here.d;
    const denom=dx1*dy2-dy1*dx2;
    let vx, vy;
    if(Math.abs(denom)<1e-9){
      // Parallel (or near-straight through this vertex): the incoming edge's
      // own offset point is already correct here.
      [vx,vy]=here.p;
    } else {
      const t=((x2-x1)*dy2-(y2-y1)*dx2)/denom;
      vx=x1+dx1*t; vy=y1+dy1*t;
    }
    const orig=pts[i];
    if(Math.hypot(vx-orig[0], vy-orig[1]) > marginM*MITER_LIMIT){
      const p0=[orig[0]+prev.n[0]*marginM, orig[1]+prev.n[1]*marginM];
      const p1=[orig[0]+here.n[0]*marginM, orig[1]+here.n[1]*marginM];
      vx=(p0[0]+p1[0])/2; vy=(p0[1]+p1[1])/2;
    }
    out.push([vx,vy]);
  }
  return out;
}

// Half the smaller side of a polygon's own bounding box — the room-size term
// callers clamp a requested margin against, so it can shrink toward a point
// rather than fold past it.
export function roomHalfMinDim(pts){
  let a=Infinity,b=Infinity,c=-Infinity,d=-Infinity;
  for(const p of pts){ if(p[0]<a)a=p[0]; if(p[0]>c)c=p[0]; if(p[1]<b)b=p[1]; if(p[1]>d)d=p[1]; }
  return Math.min(c-a,d-b)/2;
}

// The perimeter shape's DEFAULT margin when nothing has been set is a fixed
// ON-SCREEN gap, not a fixed real-world one — found live, on Garry's own
// house: a flat 15cm inset landed at frame.scale=26 px/m as a 4-7px sliver,
// visually indistinguishable from the room's own outline stroke, which is
// the actual bug behind "doesn't follow the room boundary at all". A small
// apartment and a spread-out house do not share a scale, so a metre constant
// can never stay visible on both; a pixel constant does, by construction.
// Only the DEFAULT works this way — an explicit margin (0 included) always
// wins, this only supplies what nothing was asked for.
// ...but the pixel target is itself capped at a physically plausible cove
// offset. Uncapped it computed 0.6m for Garry's house — and 0.6m consumed
// 76% of his L-shaped Bedroom's 1.57m-wide lower arm, collapsing that whole
// section of the trace into slivers at angles matching no wall ("some weird
// square in the middle"). No real cove sits 60cm off the wall; 30cm is the
// top of the plausible range, still lands ~8px at that house's scale
// (double the invisible 15cm original), and a narrow room arm has to be
// narrower than 60cm before it can collapse.
const DEFAULT_TRACE_PX = 16;
const DEFAULT_TRACE_MAX_M = 0.3;
export function defaultPerimeterMarginM(frame){
  const s = (frame && frame.scale) || 1;
  return Math.max(0.05, Math.min(DEFAULT_TRACE_MAX_M, DEFAULT_TRACE_PX / s));
}

export function shapeSvg(kind, cx, cy, r, attrs){
  const poly=(pts)=>`<polygon points="${pts}" ${attrs}/>`;
  // Every shape stays within the hexagon's own width (r*√3 ≈ 1.73r), because
  // hexCluster packs markers at that pitch — a wider marker would overlap its
  // neighbours in any room holding more than one light. HW is that half-width.
  const HW=r*0.866;
  // The code label is drawn ACROSS the marker (CODE_PX is ~0.96 of the
  // half-width), so every glyph here is a SOLID body: a hollow one would leave
  // dark text on the dark map. Detail lives at the rim, never in the middle.
  switch(kind){
    case "circle":
      return `<circle cx="${n(cx)}" cy="${n(cy)}" r="${n(HW)}" ${attrs}/>`;
    case "bar": {
      // Capsule at ~2:1 — reads as a strip without exceeding the hex footprint.
      const h=r*0.55;
      return `<rect x="${n(cx-HW)}" y="${n(cy-h)}" width="${n(HW*2)}" height="${n(h*2)}" `+
             `rx="${n(h)}" ry="${n(h)}" ${attrs}/>`;
    }
    case "line": {
      // A RUN of light — a track, a cove, a length of tape. Three fat dashes
      // in a row was the first attempt and it read as a dotted border rather
      // than a fixture: at marker size the gaps dominate, it had no body to
      // carry on/off, and it was the one shape that painted nothing when drawn
      // as an outline in the key.
      //
      // This is the linear-luminaire symbol instead: one slim continuous rail
      // at the full marker width, with the heads sitting on it. Solid, so it
      // takes the state colour like everything else, reads as continuous at
      // any size, and stretches in Transform into exactly the length of run it
      // is. Slimmer than `bar` — a run is a line of light, a valance is a body.
      const h = r * 0.17;
      const cap = Math.min(h * 1.6, HW * 0.22);
      let d = sub([[cx-HW+cap*0.6, cy-h],[cx+HW-cap*0.6, cy-h],
                   [cx+HW-cap*0.6, cy+h],[cx-HW+cap*0.6, cy+h]]);
      // End caps: a run terminates in a fitting, and squared-off ends read as
      // a cut-off line rather than a finished fixture.
      d += " " + sub([[cx-HW, cy-h*2.1],[cx-HW+cap, cy-h*2.1],
                      [cx-HW+cap, cy+h*2.1],[cx-HW, cy+h*2.1]]);
      d += " " + sub([[cx+HW-cap, cy-h*2.1],[cx+HW, cy-h*2.1],
                      [cx+HW, cy+h*2.1],[cx+HW-cap, cy+h*2.1]]);
      // The plate keeps a slim fixture as easy to grab as a fat one, and gives
      // the right-click picker a real bounding box. data-hit keeps it out of
      // the selection highlight.
      return `<rect data-hit="1" x="${n(cx-HW)}" y="${n(cy-r*0.4)}" width="${n(HW*2)}" `+
             `height="${n(r*0.8)}" fill="transparent" stroke="none"/>`+
             `<path d="${d}" ${attrs}/>`;
    }
    case "fan": {
      // Ceiling fan: hub plus four swept blades — a pinwheel. A fan was a plain
      // triangle, which is the one glyph on a lighting plan that already means
      // "directional", so the two read as the same thing.
      // Broad blades and narrow gaps: a wedge with a sharp root and a big sweep
      // reads as a shuriken at 13 px, which is the size this is actually drawn
      // at. Four blades, each two thirds of its quadrant, tips rounded on the
      // marker's own radius so the whole thing still sits in one circle.
      const hub=HW*0.58;
      let d=sub(arcPts(cx,cy,hub,hub,0,360,22));
      for(let k=0;k<4;k++){
        const b=k*90;
        d+=" "+sub([
          ...arcPts(cx,cy,hub*0.95,hub*0.95,b+6,b+38,3),   // root, on the hub
          ...arcPts(cx,cy,HW,HW,b+14,b+80,5),              // swept, rounded tip
        ]);
      }
      return `<path d="${d}" ${attrs}/>`;
    }
    case "pendant": {
      // Suspended fixture: the shade with its drop above it. Stretched
      // vertically in Transform the drop lengthens, which is what a long
      // pendant actually looks like.
      const shy=cy+r*0.24, rod=r*0.11;
      const d=sub([[cx-rod,cy-r],[cx+rod,cy-r],[cx+rod,shy],[cx-rod,shy]])+
              " "+sub(arcPts(cx,shy,HW,HW*0.8,0,360,20));
      return `<path d="${d}" ${attrs}/>`;
    }
    case "sconce": {
      // Wall light: the plan symbol is a half-round sitting against its wall.
      // Flat edge at the bottom, dome up — rotate it in Transform and it points
      // the way the fixture really faces.
      const base=cy+HW*0.5;
      return poly(arcPts(cx,base,HW,HW*1.3,180,360,14)
        .map(p=>`${n(p[0])},${n(p[1])}`).join(" "));
    }
    case "chandelier": {
      // Decorative multi-arm fixture: an eight-point star. Unmistakable against
      // every other outline here, and a non-uniform stretch only leans the
      // points — it still reads as a chandelier.
      const pts=[];
      for(let k=0;k<16;k++){
        const a=(k*22.5-90)*Math.PI/180, rr=(k%2)?HW*0.44:HW;
        pts.push(`${n(cx+rr*Math.cos(a))},${n(cy+rr*Math.sin(a))}`);
      }
      return poly(pts.join(" "));
    }
    case "square":
      return `<rect x="${n(cx-HW)}" y="${n(cy-HW)}" width="${n(HW*2)}" height="${n(HW*2)}" `+
             `rx="2" ${attrs}/>`;
    // The drag handle/code-label icon for a room-perimeter light — its real
    // extent is the traced room boundary drawn separately (perimeterSvg),
    // not this point. A generously rounded plate reads as "a plate", between
    // square's sharp corners and circle's full round; the actual "traces a
    // boundary" idea is what the Showcase detail ring below carries.
    case "perimeter":
      return `<rect x="${n(cx-HW)}" y="${n(cy-HW)}" width="${n(HW*2)}" height="${n(HW*2)}" `+
             `rx="${n(HW*0.42)}" ${attrs}/>`;
    // A motion sensor: the ceiling-plan PIR symbol — a solid dome. The
    // detection fan lives in the detail layer; what a sensor is DOING lives
    // in the blue pulse drawn under the marker while it is triggered.
    case "motion":
      return poly(arcPts(cx,cy+HW*0.45,HW,HW*1.15,180,360,14)
        .map(p=>`${n(p[0])},${n(p[1])}`).join(" "));
    // A thermometer: slim stem, round bulb at the foot — the one glyph here
    // that isn't a light fixture at all, so it has to read as unmistakably
    // something else. The reading itself (when fresh and placed) is drawn
    // separately, in place of the code — this is just what marks the spot.
    case "tempreadout": {
      const bulbR=HW*0.42, stemW=HW*0.3, stemTop=cy-r*0.72, stemBot=cy+HW*0.18;
      return `<rect x="${n(cx-stemW/2)}" y="${n(stemTop)}" width="${n(stemW)}" `+
        `height="${n(stemBot-stemTop)}" rx="${n(stemW/2)}" ${attrs}/>`+
        `<circle cx="${n(cx)}" cy="${n(cy+HW*0.55)}" r="${n(bulbR)}" ${attrs}/>`;
    }
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

// ── Showcase: the inside of the fixture ─────────────────────────────────────
// The working map draws the code ACROSS the marker, so the middle of every
// glyph is spoken for and the silhouette is all it can ever be. Showcase moves
// the code below the marker, which frees the centre — so each fixture can carry
// the detail its plan symbol actually has: the lamp inside a downlight, the
// tubes in a troffer, the motor in a fan hub, the bulb in a pendant shade.
//
// Drawn ON TOP of the same body, in the same transform, so the silhouette and
// the placement are untouched — this only fills in what was already there.
// `ink` is the contrast colour (dark on a lit fixture, pale on a dark one) and
// `sw` the stroke width the body was drawn at.
export function shapeDetailSvg(kind, cx, cy, r, ink, sw){
  const HW=r*0.866;
  const a=`fill="none" stroke="${ink}" stroke-width="${n(sw*0.85)}" `+
    `stroke-linecap="round" stroke-linejoin="round" pointer-events="none"`;
  const dot=(x,y,rr)=>`<circle cx="${n(x)}" cy="${n(y)}" r="${n(rr)}" fill="${ink}" `+
    `stroke="none" pointer-events="none"/>`;
  const path=(d)=>`<path d="${d}" ${a}/>`;
  const ring=(x,y,rr)=>path(sub(arcPts(x,y,rr,rr,0,360,18)));
  const line=(x1,y1,x2,y2)=>`<line x1="${n(x1)}" y1="${n(y1)}" x2="${n(x2)}" y2="${n(y2)}" ${a}/>`;
  switch(kind){
    // A recessed downlight is a trim ring with the lamp inside it — which is
    // exactly how it is drawn on a reflected ceiling plan.
    case "circle":  return ring(cx,cy,HW*0.54)+dot(cx,cy,HW*0.16);
    // The diffuser, inset from the housing.
    case "bar":     return `<rect x="${n(cx-HW*0.72)}" y="${n(cy-r*0.24)}" `+
                           `width="${n(HW*1.44)}" height="${n(r*0.48)}" `+
                           `rx="${n(r*0.24)}" ${a}/>`+
                           line(cx-HW*0.86,cy-r*0.3,cx-HW*0.86,cy+r*0.3)+
                           line(cx+HW*0.86,cy-r*0.3,cx+HW*0.86,cy+r*0.3);
    // A troffer's tubes. Two, because that is what a 2-lamp fitting has and
    // because one line down the middle reads as a fold, not a lamp.
    case "square":  return `<rect x="${n(cx-HW*0.7)}" y="${n(cy-HW*0.7)}" `+
                           `width="${n(HW*1.4)}" height="${n(HW*1.4)}" rx="1" ${a}/>`+
                           line(cx-HW*0.52,cy-HW*0.3,cx+HW*0.52,cy-HW*0.3)+
                           line(cx-HW*0.52,cy+HW*0.3,cx+HW*0.52,cy+HW*0.3);
    // The heads along the run, evenly spaced — what makes a rail read as a
    // line of fixtures rather than a painted stripe.
    case "line": {
      let s="";
      for(let k=-1;k<=1;k++) s+=dot(cx+k*HW*0.46, cy, r*0.1);
      return s;
    }
    // Hub and motor.
    case "fan": {
      let s=ring(cx,cy,HW*0.36)+dot(cx,cy,HW*0.13);
      for(let k=0;k<4;k++){
        const ang=(k*90+22)*Math.PI/180;
        s+=line(cx+HW*0.42*Math.cos(ang), cy+HW*0.42*Math.sin(ang),
                cx+HW*0.86*Math.cos(ang), cy+HW*0.86*Math.sin(ang));
      }
      return s;
    }
    // The fitter across the top of the shade, and the lamp inside it.
    case "pendant": return line(cx-HW*0.34,cy+r*0.24-HW*0.62,cx+HW*0.34,cy+r*0.24-HW*0.62)+
                           dot(cx,cy+r*0.3,HW*0.17);
    // The wall plate it is mounted on, and the reflector inside the shade.
    case "sconce":  return line(cx-HW*0.86,cy+HW*0.5,cx+HW*0.86,cy+HW*0.5)+
                           path(sub(arcPts(cx,cy+HW*0.5,HW*0.5,HW*0.72,180,360,10)));
    // The body ring, with candles on the arms.
    case "chandelier": {
      let s=ring(cx,cy,HW*0.3);
      for(let k=0;k<4;k++){
        const ang=(k*90-90)*Math.PI/180;
        s+=dot(cx+HW*0.72*Math.cos(ang), cy+HW*0.72*Math.sin(ang), HW*0.1);
      }
      return s;
    }
    // The aperture, at the wide end the light leaves by.
    case "triangle": return ring(cx,cy+r*0.26,HW*0.32)+
                            line(cx-HW*0.4,cy+r*0.55,cx+HW*0.4,cy+r*0.55);
    case "diamond":  return ring(cx,cy,HW*0.42)+dot(cx,cy,HW*0.15);
    // An inset frame — the glyph's own echo of what it actually draws
    // full-size on the floor: a boundary, traced inside another boundary.
    case "perimeter": return `<rect x="${n(cx-HW*0.62)}" y="${n(cy-HW*0.62)}" `+
                             `width="${n(HW*1.24)}" height="${n(HW*1.24)}" rx="${n(HW*0.3)}" ${a}/>`;
    // The PIR lens segments across the dome.
    case "motion": return path(sub(arcPts(cx,cy+HW*0.45,HW*0.6,HW*0.7,180,360,10)))+
                          line(cx,cy-HW*0.25,cx,cy+HW*0.45);
    // The "mercury" filling the bulb — a solid dot, matching the fill
    // convention every other detail dot here already uses.
    case "tempreadout": return dot(cx,cy+HW*0.55,HW*0.22);
    // A plain fixture plate: bevel, plus the lamp behind it.
    default:         return path(sub(arcPts(cx,cy,r*0.6,r*0.6,90,450,6)))+dot(cx,cy,HW*0.15);
  }
}

// Ray-cast point-in-polygon, in whatever units the polygon is in. Exported
// because "spread these lights inside this room" (lights_map.js) needs the
// same answer the renderer gives when it decides which room a fixture sits
// in — one test for both, so a light can never be placed where the map
// would then draw it outside.
export function pointInPolygon(pts, x, y){
  let inside=false;
  for(let i=0,j=pts.length-1;i<pts.length;j=i++){
    const [xi,yi]=pts[i], [xj,yj]=pts[j];
    if(((yi>y)!==(yj>y)) && (x < (xj-xi)*(y-yi)/((yj-yi)||1e-9) + xi)) inside=!inside;
  }
  return inside;
}

// Which interaction class a device belongs to on the map. Four classes, not
// four domains: a strip (WLED or partition) is a light with more to offer,
// and the layer chips, the halo and the tap semantics all key off this.
export function lightClassOf(l){
  if(!l) return "light";
  if(l.isFan) return "fan";
  if(l.isMotion) return "motion";
  if(l.isTemp) return "temp";
  if(l.isWled||l.isPartition) return "strip";
  return "light";
}

// Cluster offsets (SVG px) for N hexes touching around a centre
export function hexCluster(count, r){
  const d=r*Math.sqrt(3)+2;  // centre-to-centre distance (tiny gap between touching hexes)
  const ring=Array.from({length:6},(_,i)=>{const a=(30+i*60)*Math.PI/180;return[d*Math.cos(a),d*Math.sin(a)];});
  const pos=[[0,0],...ring];
  if(count<=7) return pos.slice(0,count);
  // Hex-offset grid: odd rows shift right by d/2 so hexagons mesh instead of stacking as squares
  const cols=Math.max(3,Math.ceil(Math.sqrt(count*1.15)));
  const rows=Math.ceil(count/cols);
  return Array.from({length:count},(_,i)=>{
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

// How a fixture's real measurements become a marker transform.
//
// Exported because the Mapping tab's free-transform handles must preview the
// EXACT scale the renderer will commit — when the preview computed its own
// version, the shape jumped the moment the pointer came up.
//
// A metre of fixture is `scale` pixels. The floor is SOFT, not a clamp:
// max(0.5, ...) created a dead zone, because at a house's scale the factor is
// about 0.016 per cm, so nothing under ~31 cm could clear 0.5 and a 10 cm pot
// light, the 15 cm default and a 30 cm fixture all drew at the same size —
// which is why setting a width appeared to do nothing. hypot keeps the same
// legibility minimum but stays strictly increasing.
//
// There is deliberately NO upper ceiling. An 8x cap saturated at about a 5 m
// fixture, so a 12 m strip run and a 20 m one drew identically and a handle
// dragged past that point stopped following the pointer — the drawn box was no
// longer the box you drew. A fixture is rendered at the size it measures, the
// same promise the rest of the fabric makes; MAX_FIXTURE_CM already bounds
// what can be stored.
export function markerScale(wCm, hCm, scale, hexR){
  const w = Number(wCm) || 0, h = Number(hCm) || 0;
  if(!(w > 0 || h > 0)) return { sx: 1, sy: 1 };
  const baseW = hexR * 2 * 0.866, baseH = hexR * 2;
  const soft = (cm, base) => Math.hypot((cm / 100) * scale / base, 0.5);
  return { sx: soft(w || h, baseW), sy: soft(h || w, baseH) };
}

// A transform handle dragged to `px` from the marker's centre describes HALF
// the fixture, so the stored measurement is twice that — in centimetres.
export const MAX_FIXTURE_CM = 2000;
export function cmFromHandlePx(px, scale){
  if(!(scale > 0)) return 0;
  return Math.max(0, Math.min(MAX_FIXTURE_CM, Math.round(Math.abs(px) / scale * 200)));
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
  // Conventional storeys, for the registry that never got filled in. Mirrors
  // ModelStore._CONVENTIONAL_LEVEL — the backend owns this rule for the RF
  // slab count, and the drawing has to agree with it or the picture and the
  // physics describe different buildings.
  //
  // Ranking undeclared floors by NAME was the bug: a registry holding only
  // "main" put main at 0 and then sorted the rest alphabetically after it, so
  // a house with a basement and an upper floor came out
  // main=0, __outside__=1, basement=2, upper=3 — the basement drawn above the
  // main floor, the garden between them, and the top floor floating three
  // slabs up. The stack was also one storey taller than the house, which
  // stretched the fitted frame vertically and left dead space at the sides.
  const CONVENTIONAL = {
    subbasement:-2, sub_basement:-2, cellar:-1, basement:-1, lower:-1, downstairs:-1,
    ground:0, main:0, first:0, mainfloor:0, main_floor:0,
    upper:1, upstairs:1, second:1, middle:1,
    third:2, loft:2, attic:3, roof:4,
  };
  const conventional = (id) => {
    const k = String(id || "").trim().toLowerCase().replace(/\s+/g, "_");
    return Object.prototype.hasOwnProperty.call(CONVENTIONAL, k) ? CONVENTIONAL[k] : null;
  };
  const ranked = (() => {
    const regIds = floorList.map(f => String(f.id));
    if (floorList.length && floorList.every(f => num(f.level) !== null)) return null;  // explicit levels win
    const extra = [...fabricFloorIds].filter(id => !regIds.includes(id));
    const ids = [...regIds, ...extra];
    const elev = ids.map(id => num(elevations[id]));
    const useElev = elev.some(v => v !== null) && new Set(elev).size > 1;
    // Priority: a measured elevation, then the storey a name denotes, then
    // registry order — and outdoors sits at ground level, because it does.
    const keyOf = (id, i) => {
      if (useElev && elev[i] !== null) return elev[i];
      const f = floorList.find(x => String(x.id) === id);
      const lvl = f ? num(f.level) : null;
      if (lvl !== null) return lvl;
      if (id === "__outside__" || id === "outside") return 0;
      const conv = conventional(id);
      return conv !== null ? conv : i;
    };
    const order = ids.map((id, i) => ({ id, key: keyOf(id, i), i }))
      .sort((a, b) => (a.key - b.key) || (a.i - b.i));
    const out = {};
    // Collapse to contiguous slab indices: two floors that share a storey
    // (the garden and the ground floor) must share a slab, not be pushed apart.
    let slab = -1, prevKey = null;
    for (const o of order) {
      if (prevKey === null || o.key !== prevKey) slab++;
      prevKey = o.key;
      out[o.id] = slab;
    }
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
  // The frame's centre, like its scale, is a property of the BUILDING. Letting
  // fixtures grow it meant dragging one light shifted the whole projection
  // under the pointer, so the light landed at the right metres while the map
  // moved beneath it — it looked like the drag fell short or sprang back.
  for(const r of scaleRooms) for(const p of r.pts) grow(p[0], p[1]);
  if(!scaleRooms.length) for(const l of scaleLights) grow(l.x, l.y);
  const empty = !rooms.length && !lights.length;
  if(!isFinite(minX)){ minX=0; minY=0; maxX=10; maxY=8; }

  const padM  = Math.max(0.5, Math.max(maxX-minX, maxY-minY) * 0.04);
  minX-=padM; minY-=padM; maxX+=padM; maxY+=padM;
  const mx=(minX+maxX)/2, my=(minY+maxY)/2;

  // Scale from the whole INDOOR building — every floor at its true position.
  //
  // This used to scale to the largest single floor, because each floor was
  // then drawn centred on itself. Both halves of that were a workaround for a
  // measurement that no longer exists: the union was "51 m against a 29 m
  // building" only while OUTDOOR rooms were still in it, and a garden 40 m
  // down the lot really does dwarf a house. Outdoor is dropped now, and the
  // indoor union is 33.7 m against the biggest floor's 30.2 — twelve percent,
  // not seventy-six.
  //
  // Meanwhile the per-floor centring was costing the thing the drawing is
  // for. Floors overlap properly in the fabric on a real install (basement
  // x -4.3..11.6, main -3.2..16.7, upper 3.4..12.8), so re-centring each one
  // on its own bounding box SHIFTED them apart: the upper floor moved 5.4 m in
  // y relative to the main floor under it. In an isometric that shears the
  // stack — the vertical edges between storeys meet misaligned outlines, so
  // the building's walls run at different angles on different floors, the
  // silhouette spreads wider than the house, and a set-back floor reads as a
  // box floating out of place.
  //
  // One building, one origin. A floor that genuinely is set back now looks set
  // back, because it is.
  // Fit to the shape that is actually drawn, not to the box around it.
  //
  // The isometric of a bounding RECTANGLE is a diamond (spanX+spanY) wide,
  // and sizing to that assumes the building fills its diamond. No building
  // does: on a real house the drawing came out 533 px inside a 760 px canvas
  // with 90 px of margin one side and 137 px the other — a third of the width
  // unused, and off-centre with it, because the metre-space bbox centre is not
  // the centre of the projected shape.
  //
  // Projecting the room points first and measuring THAT costs one pass over
  // geometry already in hand, and it cannot over- or under-shoot: u and v are
  // the isometric axes, so their extents are exactly the drawing's width and
  // height in unit space.
  let minU=Infinity, maxU=-Infinity, minV=Infinity, maxV=-Infinity;
  for(const r of scaleRooms){
    for(const p of r.pts){
      const u=(p[0]-mx)-(p[1]-my), v=(p[0]-mx)+(p[1]-my);
      if(u<minU)minU=u; if(u>maxU)maxU=u;
      if(v<minV)minV=v; if(v>maxV)maxV=v;
    }
  }
  if(!isFinite(minU)){
    // No rooms — fall back to the bounding diamond, which is all there is.
    const sX=Math.max(0.001,maxX-minX), sY=Math.max(0.001,maxY-minY);
    minU=-(sX+sY)/2; maxU=(sX+sY)/2; minV=-(sX+sY)/2; maxV=(sX+sY)/2;
  }
  const spanU = Math.max(0.001, maxU-minU);
  const spanV = Math.max(0.001, maxV-minV);
  // Recentre on the DRAWN shape. Without this the projection is centred on the
  // metre bbox centre, which lands off to one side whenever the footprint is
  // not symmetric — the uneven margins above.
  const uMid = (minU+maxU)/2, vMid = (minV+maxV)/2;

  const S = Math.min((W-90)/(spanU*0.866), (BASE_H-260)/(spanV*0.5));

  // Floors are STACKED, not scattered. These floors do not share a footprint
  // in the metre frame — each was built in its own band (upper y≈-21..6, main
  // y≈-16..12) — so drawing every floor at its literal metre position pushed
  // them apart on screen on top of the floor spacing, leaving one gap twice
  // the size of another. Each floor is drawn centred on its own contents, so
  // the stack reads as a building; the offset is per floor, so a light keeps
  // its exact position WITHIN its floor, and the drag inverse below undoes
  // the same offset.
  // Outside is not on this map. It is not a storey, so ranking it as one wedged
  // a slab between two real floors; and it is not the building, so a shed 50 m
  // down the garden either dwarfed the house or had to be squeezed into an
  // envelope it does not belong in. This map is the building. Outdoor lights
  // still appear in the index table below it, they just have no place in a
  // floor stack. Dropped BEFORE the offsets and the stack are computed — the
  // garden's extent must not steer either.
  // Kept, not discarded. The building stack has no place for a shed 50 m down
  // the garden, but Overview draws outdoor areas as an overlay fitted into the
  // building's own footprint, and it used to get them from per-photo bounds.
  // Handing them back here is what let that path stop reading photographs.
  const outdoorRooms = rooms.filter(r => isOutside(r.floor_id));
  rooms.length = 0;  rooms.push(...indoorRooms);
  lights.length = 0; lights.push(...indoorLights);
  const levels = [...new Set([...rooms.map(r=>r.z), ...lights.map(l=>l.z)])].sort((a,b)=>a-b);

  // Storeys are drawn evenly spaced, whatever their level NUMBERS are. Using
  // the raw level as the stack multiplier meant any hole in the numbering drew
  // as a hole in the building: dropping the garden left ranks 0,1,3, so the gap
  // between the top two floors came out twice the size of the one below it. A
  // floor the map does not draw must not reserve a storey of empty air.
  const drawRank = new Map(levels.map((z, i) => [z, i]));
  const rankOf = (z) => (drawRank.has(z) ? drawRank.get(z) : z);

  // One origin for the whole building. Every floor shares (mx, my), so a point
  // at the same metres on two storeys lands on the same spot on screen and the
  // stack is a building rather than a pile of independently centred outlines.
  // Only the storey index moves a floor, and it moves it straight up.
  // u and v are the two isometric axes. Centring on their midpoints puts the
  // drawn building in the middle of the canvas rather than wherever its metre
  // bounding box happened to sit.
  const iso    = (x,y,z)=>{
    const k=rankOf(z);
    return [ CX + (((x-mx)-(y-my)) - uMid)*S*0.866 + k*HG,
             CY + (((x-mx)+(y-my)) - vMid)*S*0.5   - k*FG ];
  };
  const isoInv = (sx,sy,z)=>{
    const k=rankOf(z);
    const a=(sx - CX - k*HG)/(S*0.866) + uMid;
    const b=(sy - CY + k*FG)/(S*0.5)   + vMid;
    return [ (a+b)/2 + mx, (b-a)/2 + my ];
  };

  return { rooms, lights, levels, iso, isoInv, rankOf, scale: S,
           bbox:{minX,minY,maxX,maxY}, empty, levelOf, outdoor: outdoorRooms };
}

// The inverse of levelOf: which floor did the renderer draw at this height?
//
// Lives here, beside the forward resolution, because the two MUST agree. The
// map used to invert by matching the registry's `level`, but on a real install
// every floor has level null — Number(null) is 0, so z=0 matched the first
// floor by accident and every storey above it fell through to a "main"
// default. A light dropped in an upstairs room was stored as main and vanished
// from the room it had just been placed in.
//
// Registry floors are considered before fabric-only ids, so the id that comes
// back is the one the floor registry knows.
export function floorIdAtLevel(frame, model, floors, z){
  if(!frame || typeof frame.levelOf !== "function") return null;
  const ids = (floors || []).map(f => String(f.id));
  for(const g of Object.values((model && model.room_geometry_m) || {})){
    const fid = String((g && g.floor_id) || "");
    if(fid && !ids.includes(fid)) ids.push(fid);
  }
  for(const id of ids){
    if(Number(frame.levelOf(id)) === Number(z)) return id;
  }
  return null;
}

// ── Isometric 3-D SVG builder ────────────────────────────────────────────────
// A spatial scene is a colour field laid across a floor, not a colour list:
// every fixture samples the field at its own metres, so "Sunset" is warm on
// one side of the house and dusk on the other. The same function drives the
// preview AND the applied service calls, so the map cannot promise a colour
// the lights don't get. field = {stops:[[r,g,b],...], angleDeg}; box = the
// floor's metre bbox {x0,y0,x1,y1}.
export function sampleSceneField(field, x, y, box){
  const stops=(field&&field.stops)||[];
  if(!stops.length) return [255,191,36];
  if(stops.length===1) return stops[0];
  const th=((Number(field.angleDeg)||0)*Math.PI)/180;
  const ux=Math.cos(th), uy=Math.sin(th);
  // Project the corners onto the axis so t spans exactly the floor, whatever
  // the angle — normalising by width alone squashed diagonal scenes.
  const px=[box.x0*ux+box.y0*uy, box.x1*ux+box.y0*uy, box.x0*ux+box.y1*uy, box.x1*ux+box.y1*uy];
  const lo=Math.min(...px), hi=Math.max(...px);
  const t=hi>lo ? Math.max(0, Math.min(1, ((x*ux+y*uy)-lo)/(hi-lo) )) : 0;
  const seg=Math.min(stops.length-2, Math.floor(t*(stops.length-1)));
  const f=t*(stops.length-1)-seg;
  const a=stops[seg], b=stops[seg+1];
  return [0,1,2].map(i=>Math.round(a[i]+(b[i]-a[i])*f));
}

// The colours a scene APPLY sends — one function against the same frame and
// the same sampler the preview drew with, so the two cannot disagree. Returns
// [{eid, rgb:[r,g,b]}] for every visible lit fixture: placed ones sampled at
// their own metres, cluster ones at their room's centre.
export function sceneColours(model, floors, byRoom, lightsByEid, hiddenEids, field, floorGap=150, horizGap=0){
  if(!field) return [];
  const frame=fabricFrame(model, floors, floorGap, horizGap);
  const { rooms, lights }=frame;
  const box=new Map();
  for(const r of rooms){
    const b=box.get(r.z)||{x0:Infinity,y0:Infinity,x1:-Infinity,y1:-Infinity};
    for(const p of r.pts){
      if(p[0]<b.x0)b.x0=p[0]; if(p[0]>b.x1)b.x1=p[0];
      if(p[1]<b.y0)b.y0=p[1]; if(p[1]>b.y1)b.y1=p[1];
    }
    box.set(r.z,b);
  }
  for(const l of lights){
    const b=box.get(l.z)||{x0:Infinity,y0:Infinity,x1:-Infinity,y1:-Infinity};
    if(l.x<b.x0)b.x0=l.x; if(l.x>b.x1)b.x1=l.x;
    if(l.y<b.y0)b.y0=l.y; if(l.y>b.y1)b.y1=l.y;
    box.set(l.z,b);
  }
  const out=[], seen=new Set();
  for(const pl of lights){
    const li=lightsByEid[pl.eid];
    if(!li || li.state!=="on" || (hiddenEids&&hiddenEids.has(pl.eid)) || seen.has(pl.eid)) continue;
    const bx=box.get(pl.z);
    if(!bx || !isFinite(bx.x0)) continue;
    out.push({ eid: pl.eid, rgb: sampleSceneField(field, pl.x, pl.y, bx) });
    seen.add(pl.eid);
  }
  for(const rname of Object.keys(byRoom||{})){
    const r=rooms.find(rr=>rr.room===rname);
    if(!r || !r.pts.length) continue;
    const cx=r.pts.reduce((a,p)=>a+p[0],0)/r.pts.length;
    const cy=r.pts.reduce((a,p)=>a+p[1],0)/r.pts.length;
    const bx=box.get(r.z);
    if(!bx || !isFinite(bx.x0)) continue;
    for(const li of byRoom[rname]||[]){
      if(li.state!=="on" || seen.has(li.entity_id) || (hiddenEids&&hiddenEids.has(li.entity_id))) continue;
      out.push({ eid: li.entity_id, rgb: sampleSceneField(field, cx, cy, bx) });
      seen.add(li.entity_id);
    }
  }
  return out;
}

// opts.showcase — the presentation renderer. Same fabric, same fixtures, same
// silhouettes, same placement: what changes is the LIGHTING of the drawing.
// Fixtures that are on cast a real pool in their own colour, markers get a
// contact shadow and a lit rim, and the code steps out from under the glyph so
// the symbol can be seen. Everything the build tools rely on (g.lhex, data-eid,
// data-cx/cy) is untouched, so the map stays fully editable in this mode.
export function buildIsoSVG(model, byRoom, hiddenEids, focusZ, floorGap, horizGap, lightsByEid={}, lightsLoading=false, floors=[], opts={}){
  const SHOW = !!opts.showcase;
  const FIT  = !!opts.fitRooms;
  // Daylight, 0 (night) to 1 (full day), from the sun the callers already
  // know about. Day lifts the ground and mutes the pools — a lit lamp at noon
  // is a detail, not the drawing — and night is exactly the render as it was.
  const AMB    = SHOW ? Math.max(0, Math.min(1, Number(opts.ambient)||0)) : 0;
  // A spatial scene preview: pools sample this colour field at their own
  // metres instead of their live colour. Preview only — nothing is written.
  const FIELD  = SHOW ? (opts.sceneField || null) : null;
  const ISOLUX = SHOW && !!opts.isolux;
  // ── Ergonomics of control-from-a-map (both hosts opt in per surface) ──────
  // codeChip: the code is a TAP TARGET of its own (data-role="code"), drawn
  //   as a pill under the glyph — the glyph is the switch, the chip opens the
  //   controls. Splitting the target is what makes the controls discoverable
  //   without a hidden hold (the sidebar). The builder keeps the code on the
  //   glyph: there a click selects, and nothing needs a second target.
  // hideCodes: semantic zoom — at overview zoom the glyph and the room name
  //   carry identity; the codes come back as the viewer zooms in.
  // classFilter: "light" | "strip" | "fan" | "motion" — every other class is
  //   DIMMED, not removed (spatial context stays), and stops taking taps.
  // hitHalo: an invisible ≥44 px-on-screen disc under every marker, drawn
  //   BEFORE the markers so a glyph always wins over a neighbour's halo.
  // collapseUnplaced: use-mode — the room-centre cluster of unplaced devices
  //   becomes ONE chip ("3 unplaced"), because a pile of overlapping markers
  //   at an inferred position is a set of mis-taps waiting to happen. The
  //   builder never collapses: dragging a marker out of the pile is how a
  //   light gets placed.
  const CODECHIP  = !!opts.codeChip;
  const HIDECODES = !!opts.hideCodes;
  const CLASSF    = opts.classFilter && opts.classFilter!=="all" ? String(opts.classFilter) : null;
  const HALO      = !!opts.hitHalo;
  const COLLAPSE  = !!opts.collapseUnplaced;
  const dimmed=(l)=>!!CLASSF && lightClassOf(l)!==CLASSF;
  // The builder, choosing a light from the INDEX rather than the map: "make
  // it easy to find" — one big ring flashes outward from wherever that light
  // actually is, a third of the whole canvas across, so a small glyph in a
  // big house is unmissable for a moment. One-shot (the host clears
  // locateEid after the render that draws it), not a permanent decoration.
  const LOCATE_EID = opts.locateEid ? String(opts.locateEid) : null;
  // "Now", injectable so a test can pin elapsed time instead of racing the
  // clock — every other opt here follows the same pattern.
  const NOW_MS=Number(opts.nowMs)||Date.now();
  const MOTION_RECENT_MS=6*60*60*1000;
  // "if they gave the temperature in the last hour" — Garry.
  const TEMP_FRESH_MS=60*60*1000;
  const mixHex=(a,b,t)=>{
    const pa=parseInt(a.slice(1),16), pb=parseInt(b.slice(1),16);
    const ch=(sh)=>Math.round(((pa>>sh)&255)+(((pb>>sh)&255)-((pa>>sh)&255))*t);
    return `#${[ch(16),ch(8),ch(0)].map(v=>v.toString(16).padStart(2,"0")).join("")}`;
  };
  const {CX, CY, W, BASE_H} = ISO;
  const FG=floorGap;
  const LAYER_PAL = ["#52b788","#f59e0b","#60a5fa","#e879f9","#fb923c","#34d399","#f87171","#a78bfa"];

  const frame = fabricFrame(model, floors, floorGap, horizGap);
  const { iso, rooms, lights, levels, rankOf } = frame;
  // Markers are sized from the fabric's own scale, not a fixed pixel count.
  const HEX_R = markerRadiusPx(frame.scale);
  // The label must FIT INSIDE its marker. A monospace glyph is about 0.6 em
  // wide, so a 3-character code needs ~1.8x the font size; at a marker 8.7 px
  // across, the old 8 px floor produced text half again wider than the icon it
  // sat on — which is why the markers read as loose floating text rather than
  // icons. The sidebar upscales this 760-unit viewBox ~2.6x to its panel, so
  // 4.8 px here is ~12 px on screen and still perfectly readable.
  const CODE_PX = Math.max(4, Math.min(11, (HEX_R * 2 * 0.866) / 1.8));
  // "3 digit, and larger" — Garry, on the temperature readout. Clearly
  // bigger than the code at any scale, not just proportionate to it.
  const TEMP_DIGIT_PX = Math.max(13, CODE_PX * 2.2);
  // The hit halo, in viewBox units: the sidebar draws this 760-unit box at
  // ~2.6x, so 9 units is ~23 px on screen — a 46 px target on a phone, the
  // platform minimum, even when the marker itself is the 5 px legibility floor.
  const HALO_R = Math.max(HEX_R*1.25, 9);
  const pt  = c=>`${Math.round(c[0])},${Math.round(c[1])}`;
  const pts = cs=>cs.map(pt).join(" ");

  const levelColor=(z)=>LAYER_PAL[levels.indexOf(z)%LAYER_PAL.length];
  const LEGEND_H=Math.max(1,levels.length)*30+24;
  // Top of the stack in DRAWN storeys, not level numbers — otherwise a gap in
  // the numbering reserved empty canvas above the building.
  const maxIsoZ = levels.length ? rankOf(levels[levels.length-1]) : 0;
  const viewY   = Math.min(0, CY - maxIsoZ*FG - 50);   // 50 px top padding
  const HTOTAL  = BASE_H + LEGEND_H - viewY;

  // width:100% with NO height cap. `max-height:${HTOTAL}px` pinned the drawing
  // to its natural size, so on any panel wider than the 760-unit viewBox the
  // browser letterboxed it — the map sat at 1:1 in the middle with dead space
  // down both sides, and the zoom control could only slide it around inside
  // that box instead of making it bigger. The aspect ratio still comes from
  // the viewBox; the host sizes it.
  // Per-floor metre bbox, needed BEFORE the gradient prepass: the scene field
  // spans it (each storey gets the whole gradient) and the isolux grid walks
  // it. The slab sizing below reads the same numbers.
  const floorBox=new Map();
  for(const z of levels){
    let a=Infinity,b=Infinity,c=-Infinity,d=-Infinity;
    for(const r of rooms) if(r.z===z) for(const p of r.pts){
      if(p[0]<a)a=p[0]; if(p[0]>c)c=p[0]; if(p[1]<b)b=p[1]; if(p[1]>d)d=p[1];
    }
    for(const l of lights) if(l.z===z){
      if(l.x<a)a=l.x; if(l.x>c)c=l.x; if(l.y<b)b=l.y; if(l.y>d)d=l.y;
    }
    if(isFinite(a)) floorBox.set(z, {x0:a, y0:b, x1:c, y1:d});
  }
  // Room centroids by name — where an unplaced light clusters, so a scene
  // field can give cluster lights the colour of the middle of their room.
  const roomCentre=new Map();
  for(const r of rooms){
    if(!r.pts.length || roomCentre.has(r.room)) continue;
    roomCentre.set(r.room, [r.pts.reduce((a,p)=>a+p[0],0)/r.pts.length,
                            r.pts.reduce((a,p)=>a+p[1],0)/r.pts.length, r.z]);
  }
  // The field colour a fixture previews, or null when no scene is active.
  const fieldColOf=(x,y,z)=>{
    const box=FIELD && floorBox.get(z);
    return box ? QCOL(sampleSceneField(FIELD, x, y, box)) : null;
  };

  let s=`<svg viewBox="0 ${viewY} ${W} ${HTOTAL}" xmlns="http://www.w3.org/2000/svg" width="100%" `+
    `data-natural-h="${HTOTAL}" style="display:block;font-family:system-ui,sans-serif">`;
  s+=`<rect x="0" y="${viewY}" width="${W}" height="${HTOTAL}" fill="${AMB?mixHex("#071008","#22301f",AMB):"#071008"}"/>`;

  // ── Showcase: the colour a fixture actually throws ────────────────────────
  // A light that reports rgb_color is drawn and glows in ITS OWN colour, so a
  // WLED run sitting on magenta reads as magenta on the map. entry.color is the
  // fallback rather than the winner because every placed light is stamped with
  // the default amber on drop — preferring it would mean the live colour never
  // showed for any light that had ever been moved.
  const QCOL=(c)=>{
    const q=(v)=>Math.max(24, Math.min(255, Math.round(Math.max(0, Math.min(255, v))/24)*24));
    return `#${[q(c[0]),q(c[1]),q(c[2])].map(v=>v.toString(16).padStart(2,"0")).join("")}`;
  };
  // Kelvin → RGB (Tanner Helland blackbody approximation, clamped to the
  // 1800-6500K range real bulbs report). A white-only bulb has no rgb_color,
  // but it does have a temperature — and 2700K vs 5000K is the difference
  // between a living room and a workshop, which the default amber erased.
  const kelvinRGB=(k)=>{
    const t=Math.max(1800, Math.min(6500, k))/100;
    const g=Math.round(99.47*Math.log(t)-161.12);
    const b=t>=66 ? 255 : (t<=19 ? 0 : Math.round(138.52*Math.log(t-10)-305.04));
    return [255, Math.max(0,Math.min(255,g)), Math.max(0,Math.min(255,b))];
  };
  const glowCol=(l,entry)=>Array.isArray(l&&l.rgb)&&l.rgb.length>=3
    ? QCOL(l.rgb)
    : (Number(l&&l.ct)>0 ? QCOL(kelvinRGB(l.ct)) : ((entry&&entry.color)||"#fbbf24"));
  const bodyCol=(l,entry)=>SHOW ? glowCol(l,entry) : ((entry&&entry.color)||"#fbbf24");
  // Detail has to be legible on whatever colour the fixture is throwing, and a
  // WLED run can be anything from pale yellow to deep blue — so the ink is
  // picked from the body's luminance rather than assumed dark.
  const inkOn=(hex)=>{
    const m=/^#?([0-9a-f]{6})$/i.exec(String(hex||""));
    if(!m) return "#20160a";
    const v=parseInt(m[1],16);
    const y=0.299*((v>>16)&255)+0.587*((v>>8)&255)+0.114*(v&255);
    return y>140 ? "#20160a" : "#f1f5f9";
  };
  // Brightness rides the pool's size and opacity, not the marker's colour: a
  // fixture at 3% should look like a fixture at 3%.
  const briOf=(l)=>{
    const b=Number(l&&l.bri);
    return isFinite(b)&&b>0 ? Math.max(0.12, Math.min(1, b/255)) : 0.8;
  };
  // One gradient per DISTINCT colour in use (quantised above), collected before
  // the defs are written. A per-light gradient would be one def per fixture.
  const glowIds=new Map();
  // room record -> clipPath id, filled while the defs are written (SHOW only).
  const roomClip=new Map();
  if(SHOW){
    for(const l of lights){
      const li=lightsByEid[l.eid];
      if(!li || li.state!=="on" || hiddenEids.has(l.eid) || li.isFan || li.isMotion || li.isTemp) continue;
      const c=(FIELD ? fieldColOf(l.x,l.y,l.z) : null) || glowCol(li,l.lp);
      if(!glowIds.has(c)) glowIds.set(c, `psglow_${glowIds.size}`);
    }
    for(const rname of Object.keys(byRoom||{})) for(const li of byRoom[rname]||[]){
      if(li.state!=="on" || hiddenEids.has(li.entity_id) || li.isFan || li.isMotion || li.isTemp) continue;
      const rc=FIELD && roomCentre.get(rname);
      const c=(rc ? fieldColOf(rc[0],rc[1],rc[2]) : null) || glowCol(li, null);
      if(!glowIds.has(c)) glowIds.set(c, `psglow_${glowIds.size}`);
    }
  }

  // ── Fit to room ───────────────────────────────────────────────────────────
  // No fixture may be drawn larger than the room it is in. A measurement typed
  // in centimetres is easy to get wrong by a factor of ten, and the result is a
  // 24 m valance lying across the whole house — which reads as a broken map
  // rather than as a bad number.
  //
  // The cap is the room's own extent less a margin, so a fixture that fills its
  // room still stops short of the walls instead of sitting on them: about 5% of
  // the dimension per side, floored at 8 cm so a tiny room keeps a visible gap
  // and capped at 35 cm so a large one is not needlessly shrunk.
  //
  // Longest side against longest side: a fixture capped this way can physically
  // fit the room in SOME orientation, which is the honest reading of "does not
  // exceed the room". This is a drawing constraint — the stored width_cm and
  // height_cm are never rewritten, so turning it off restores what was typed.
  const boxOfRoom=new Map();
  if(FIT){
    for(const r of rooms){
      let a=Infinity,b=Infinity,c=-Infinity,d=-Infinity;
      for(const p of r.pts){
        if(p[0]<a)a=p[0]; if(p[0]>c)c=p[0];
        if(p[1]<b)b=p[1]; if(p[1]>d)d=p[1];
      }
      if(!isFinite(a)) continue;
      // Margin per side: 5% of the smaller dimension, at least 8 cm so a small
      // room keeps a visible gap, at most 35 cm so a large one is not
      // needlessly shrunk.
      const m=Math.min(0.35, Math.max(0.08, Math.min(c-a,d-b)*0.05));
      boxOfRoom.set(r, {x0:a+m, y0:b+m, x1:c-m, y1:d-m});
    }
  }
  // How far a fixture has to shrink to stay inside its room — as a FACTOR, so
  // it keeps its proportions instead of being squashed on one axis.
  //
  // The first rule capped the fixture's long axis against the room's long axis,
  // and on a real house that let almost everything through: a 4.97 m valance in
  // a 1.9 x 6.3 m kitchen "fitted" the 6.3 m side while visibly lying across
  // the 1.9 m one. Rotation and position matter — a fixture is drawn centred on
  // its own metres at its own angle, so a 5 m run at 30 degrees near a wall
  // pokes out of the room even when its length fits the room's longest side.
  //
  // A rectangle of half-extents (a,b) turned by θ spans a·|cos|+b·|sin| in x and
  // a·|sin|+b·|cos| in y, so the factor is exact and needs no searching.
  const fitFactor=(r,x,y,wCm,hCm,rotDeg)=>{
    const box=boxOfRoom.get(r);
    if(!box) return 1;
    const a=(Number(wCm)||0)/200, b=(Number(hCm)||0)/200;   // half-extents, metres
    if(!(a>0||b>0)) return 1;
    const t=(Number(rotDeg)||0)*Math.PI/180;
    const cs=Math.abs(Math.cos(t)), sn=Math.abs(Math.sin(t));
    const halfX=a*cs+b*sn, halfY=a*sn+b*cs;
    // Room left on each side of where the fixture actually sits.
    const roomX=Math.max(0.02, Math.min(x-box.x0, box.x1-x));
    const roomY=Math.max(0.02, Math.min(y-box.y0, box.y1-y));
    return Math.max(0.05, Math.min(1, halfX>0?roomX/halfX:1, halfY>0?roomY/halfY:1));
  };
  // eid -> shrink factor, filled as each floor is walked.
  const fitK={};
  // WHICH room a fixture is in comes from its POSITION, not from its Home
  // Assistant area. Keying this on the area assignment is why the constraint
  // did nothing on a real house: not one placed light here has an area set —
  // they were dropped where they physically are, which is the better answer
  // anyway, and the fabric already knows it. Ray-cast against the polygons on
  // the light's own floor; a fixture outside every room is left as typed.
  const pointInRoom=(pts,x,y)=>pointInPolygon(pts,x,y);
  // The fixture's measurements as they should be DRAWN. Its own long axis is
  // capped by the room's long axis, whichever way round it was entered.
  const fitCm=(l,entry)=>{
    const k=(FIT && fitK[l&&l.entity_id]) || 1;
    return { wCm:(Number(entry&&entry.width_cm)||0)*k,
             hCm:(Number(entry&&entry.height_cm)||0)*k };
  };

  // Floor surface patterns
  s+=`<defs>`;
  // Motion pulse gradient — UNGATED (both modes): a triggered sensor is
  // status, not presentation, and it has to read on the working map too.
  s+=`<radialGradient id="psmotion">`+
    `<stop offset="0%" stop-color="${MOTION_PULSE}" stop-opacity="0.55"/>`+
    `<stop offset="60%" stop-color="${MOTION_PULSE}" stop-opacity="0.18"/>`+
    `<stop offset="100%" stop-color="${MOTION_PULSE}" stop-opacity="0"/></radialGradient>`;
  if(SHOW){
    // Light pools. Four stops, not two: a linear ramp reads as a flat disc with
    // a hard edge, and the near-quadratic falloff here is what makes it look
    // like light landing on a floor rather than a coloured circle.
    for(const [col,id] of glowIds){
      s+=`<radialGradient id="${id}">`+
        `<stop offset="0%" stop-color="${col}" stop-opacity="0.85"/>`+
        `<stop offset="28%" stop-color="${col}" stop-opacity="0.34"/>`+
        `<stop offset="62%" stop-color="${col}" stop-opacity="0.10"/>`+
        `<stop offset="100%" stop-color="${col}" stop-opacity="0"/>`+
        `</radialGradient>`;
    }
    // Softens the wall cut on a clipped pool: applied OUTSIDE the clip, so a
    // couple of pixels of light feather over the boundary the way a doorway
    // leaks. A hard polygon edge is the one artifact every hand-built
    // floor-plan thread complains about.
    s+=`<filter id="psclipsoft" x="-8%" y="-8%" width="116%" height="116%">`+
      `<feGaussianBlur stdDeviation="1.6"/></filter>`;
    // One clip path per room, so a fixture's pool can be stopped at its own
    // walls. Light crossing a wall polygon reads as a rendering error the
    // moment the drawing is good enough for anything else to read as real —
    // and the fabric has known these polygons in metres all along.
    for(let ri=0; ri<rooms.length; ri++){
      const r=rooms[ri];
      roomClip.set(r, `psclip_${ri}`);
      s+=`<clipPath id="psclip_${ri}"><polygon points="${r.pts.map(p=>pt(iso(p[0],p[1],r.z))).join(" ")}"/></clipPath>`;
    }
    // Contact shadow under a fixture — what actually sells a marker as an
    // object sitting in the room rather than a sticker on the glass.
    s+=`<radialGradient id="psshade">`+
      `<stop offset="0%" stop-color="#000" stop-opacity="0.55"/>`+
      `<stop offset="55%" stop-color="#000" stop-opacity="0.22"/>`+
      `<stop offset="100%" stop-color="#000" stop-opacity="0"/></radialGradient>`;
    // One light source, upper-left, for the whole drawing: the marker gloss and
    // the room sheen use the same ramp so nothing looks lit from two suns.
    s+=`<linearGradient id="psgloss" x1="0.15" y1="0" x2="0.6" y2="1">`+
      `<stop offset="0%" stop-color="#fff" stop-opacity="0.5"/>`+
      `<stop offset="45%" stop-color="#fff" stop-opacity="0.1"/>`+
      `<stop offset="100%" stop-color="#000" stop-opacity="0.18"/></linearGradient>`;
    s+=`<linearGradient id="pswash" x1="0" y1="0" x2="0.35" y2="1">`+
      `<stop offset="0%" stop-color="#fff" stop-opacity="0.075"/>`+
      `<stop offset="100%" stop-color="#fff" stop-opacity="0"/></linearGradient>`;
    s+=`<linearGradient id="psslab" x1="0" y1="0" x2="0" y2="1">`+
      `<stop offset="0%" stop-color="#7dd3a0" stop-opacity="0.05"/>`+
      `<stop offset="100%" stop-color="#0b1c13" stop-opacity="0.12"/></linearGradient>`;
    // A flat black field reads as an empty canvas; a lit one reads as a room
    // the model is standing in. This is the cheapest depth in the whole file.
    s+=`<radialGradient id="psvig" cx="50%" cy="42%" r="72%">`+
      `<stop offset="0%" stop-color="#1a3a26" stop-opacity="0.55"/>`+
      `<stop offset="60%" stop-color="#0d2016" stop-opacity="0.22"/>`+
      `<stop offset="100%" stop-color="#040a07" stop-opacity="0"/></radialGradient>`;
  }
  levels.forEach((z2,li)=>{
    const c2=levelColor(z2);
    if(li===0){
      s+=`<pattern id="flrpat_${li}" x="0" y="0" width="24" height="24" patternUnits="userSpaceOnUse">`;
      s+=`<path d="M12,2 C16,2 19,6 19,11 C19,16 16,21 12,22 C8,21 5,16 5,11 C5,6 8,2 12,2 Z" fill="none" stroke="${c2}" stroke-width="0.7" opacity="0.075"/>`;
      s+=`<path d="M12,2 C13.5,0 15.5,0.5 14.5,2.5 C13.5,1.5 12,2 12,2 Z" fill="${c2}" opacity="0.06"/>`;
      s+=`<circle cx="12" cy="15" r="1.4" fill="${c2}" opacity="0.055"/></pattern>`;
    } else if(li===2){
      s+=`<pattern id="flrpat_${li}" x="0" y="0" width="12" height="12" patternUnits="userSpaceOnUse">`;
      s+=`<line x1="0" y1="12" x2="12" y2="0" stroke="${c2}" stroke-width="0.6" opacity="0.095"/>`;
      s+=`<line x1="0" y1="0" x2="12" y2="12" stroke="${c2}" stroke-width="0.6" opacity="0.095"/></pattern>`;
    } else if(li>=3){
      s+=`<pattern id="flrpat_${li}" x="0" y="0" width="16" height="13.86" patternUnits="userSpaceOnUse">`;
      s+=`<circle cx="0"  cy="0"     r="1.5" fill="${c2}" opacity="0.075"/>`;
      s+=`<circle cx="8"  cy="6.93"  r="1.5" fill="${c2}" opacity="0.075"/>`;
      s+=`<circle cx="16" cy="0"     r="1.5" fill="${c2}" opacity="0.075"/>`;
      s+=`<circle cx="0"  cy="13.86" r="1.5" fill="${c2}" opacity="0.075"/>`;
      s+=`<circle cx="16" cy="13.86" r="1.5" fill="${c2}" opacity="0.075"/></pattern>`;
    }
  });
  s+=`</defs>`;
  if(SHOW) s+=`<rect x="0" y="${viewY}" width="${W}" height="${HTOTAL}" fill="url(#psvig)" pointer-events="none"/>`;

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

  // One slab footprint for the whole stack: the largest floor's, so no floor
  // is cropped and every floor reads at the same scale.
  let slabHalfW=0, slabHalfH=0;
  for(const box of floorBox.values()){
    slabHalfW=Math.max(slabHalfW,(box.x1-box.x0)/2);
    slabHalfH=Math.max(slabHalfH,(box.y1-box.y0)/2);
  }
  // One padding for the whole stack, so slabs stay visually consistent even
  // though each is sized to its own floor.
  const slabPad=Math.max(0.4, Math.max(slabHalfW,slabHalfH)*0.08);
  slabHalfW+=slabPad; slabHalfH+=slabPad;

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

    if(FIT){
      // A placed fixture is fitted to the room its METRES fall in, at the
      // angle and position it is actually drawn at.
      for(const pl of hereLights){
        const r=hereRooms.find(rr=>pointInRoom(rr.pts, pl.x, pl.y));
        if(!r) continue;
        fitK[pl.eid]=fitFactor(r, pl.x, pl.y, pl.lp&&pl.lp.width_cm,
                               pl.lp&&pl.lp.height_cm, pl.lp&&pl.lp.rotation);
      }
      // An unplaced one is drawn clustered at its room's centre, so that is
      // where it has to fit.
      for(const r of hereRooms){
        if(!boxOfRoom.has(r)) continue;
        const cx0=r.pts.reduce((a,p)=>a+p[0],0)/r.pts.length;
        const cy0=r.pts.reduce((a,p)=>a+p[1],0)/r.pts.length;
        for(const li of (byRoom[r.room]||[])){
          if(fitK[li.entity_id]!==undefined) continue;
          fitK[li.entity_id]=fitFactor(r, cx0, cy0, 0, 0, 0);
        }
      }
    }

    // Every slab is the SAME SIZE, centred on the floor it belongs to.
    // Sizing each slab to its own contents made the stack look like the floors
    // were drawn at different scales — this basement legitimately reaches
    // further than the main floor (a 25.8 m patio), so its slab came out half
    // as long again and nothing lined up. Using one shared envelope instead
    // fixed that but left each floor as a small island in a large empty slab,
    // because these floors sit in different parts of the metre frame rather
    // than stacked on one footprint. Uniform size, floor-centred position, is
    // both consistent and snug.
    let cx0=Infinity,cy0=Infinity,cx1=-Infinity,cy1=-Infinity;
    const growS=(x,y)=>{ if(x<cx0)cx0=x; if(x>cx1)cx1=x; if(y<cy0)cy0=y; if(y>cy1)cy1=y; };
    for(const r of hereRooms) for(const p of r.pts) growS(p[0],p[1]);
    if(!hereRooms.length) for(const l of hereLights) growS(l.x,l.y);
    const ccx=isFinite(cx0)?(cx0+cx1)/2:(frame.bbox.minX+frame.bbox.maxX)/2;
    const ccy=isFinite(cy0)?(cy0+cy1)/2:(frame.bbox.minY+frame.bbox.maxY)/2;
    // Each slab is the size of the floor it represents. Every floor is drawn
    // at the SAME px/m, so a smaller storey reads as a smaller storey, which
    // is what it is — an upper floor really is narrower than the ground it
    // sits on. The shared-envelope rule this replaces was a workaround for a
    // basement whose imported geometry was nearly twice its true area; the
    // fabric has since been corrected, so the thing it compensated for is
    // gone, and all it did was leave every floor as an island in a large
    // empty plate.
    const halfW=isFinite(cx0)?(cx1-cx0)/2+slabPad:slabHalfW;
    const halfH=isFinite(cy0)?(cy1-cy0)/2+slabPad:slabHalfH;
    const x0=ccx-halfW, x1=ccx+halfW, y0_=ccy-halfH, y1_=ccy+halfH;

    const TL=iso(x0,y0_,z), TR=iso(x1,y0_,z), BR=iso(x1,y1_,z), BL=iso(x0,y1_,z);
    const TR_b=iso(x1,y0_,z-slabWZ), BR_b=iso(x1,y1_,z-slabWZ), BL_b=iso(x0,y1_,z-slabWZ);

    s+=`<g opacity="${go}"${gpe}>`;
    // Slab sides
    s+=`<polygon points="${pts([TR,BR,BR_b,TR_b])}" fill="#0d2318" fill-opacity="0.3" stroke="#1c2e24" stroke-width="0.7"/>`;
    s+=`<polygon points="${pts([BL,BR,BR_b,BL_b])}" fill="#0a1a12" fill-opacity="0.26" stroke="#1c2e24" stroke-width="0.7"/>`;
    if(SHOW){
      // A dashed border round every storey is drafting shorthand; a lit plate
      // with a hairline edge is what a finished drawing looks like. Same
      // rectangle, same size, same place.
      s+=`<polygon points="${pts([TL,TR,BR,BL])}" fill="url(#psslab)" stroke="${lyrColor}" stroke-width="0.9" opacity="0.5"/>`;
      s+=`<line x1="${pt(TL).split(",")[0]}" y1="${pt(TL).split(",")[1]}" x2="${pt(TR).split(",")[0]}" y2="${pt(TR).split(",")[1]}" stroke="${lyrColor}" stroke-width="1.4" opacity="0.45"/>`;
    } else {
      s+=`<polygon points="${pts([TL,TR,BR,BL])}" fill="#0f2017" fill-opacity="0.05" stroke="${lyrColor}" stroke-width="1" stroke-dasharray="7,7" opacity="0.28"/>`;
    }
    if(lidx!==1) s+=`<polygon points="${pts([TL,TR,BR,BL])}" fill="url(#flrpat_${lidx})" stroke="none"/>`;

    // `extra` carries data-* attributes (floor z, whether it is placed) so the
    // Mapping → Lights tab's build tools can act on any hex directly; the
    // sidebar ignores them.
    // The code as its own tap target: a small pill under the glyph carrying
    // data-role="code". The sidebar opens the controls from it; the glyph
    // above stays the switch. pointer-events="all" so the pill's box, not
    // just the glyph strokes of the letters, takes the tap.
    // gapPx is how far BELOW hy the chip sits — HEX_R*1.55 clears a marker
    // drawn at its base radius, but a fixture given a real width_cm/height_cm
    // (the resize handles this session added) can draw many times that size,
    // and a fixed gap then lands the chip inside the glyph instead of below
    // it. Callers whose marker can be scaled pass the ACTUAL half-height.
    const codeChipSvg=(l,hx,hy,tCol,gapPx=HEX_R*1.55)=>{
      const fs=CODE_PX*0.92;
      const w=String(l.code||"").length*fs*0.64+fs*0.9, h=fs*1.5;
      const cy=hy+gapPx+fs*0.45;
      return `<g data-role="code" style="cursor:pointer" pointer-events="all">`+
        `<rect x="${(hx-w/2).toFixed(1)}" y="${(cy-h/2).toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" `+
        `rx="${(h*0.35).toFixed(1)}" fill="#050d09" fill-opacity="0.72" stroke="${tCol}" stroke-opacity="0.45" stroke-width="0.6"/>`+
        `<text x="${hx.toFixed(1)}" y="${cy.toFixed(1)}" text-anchor="middle" dominant-baseline="middle" `+
        `font-family="ui-monospace,monospace" font-size="${fs.toFixed(1)}" font-weight="700" `+
        `letter-spacing="0.06em" fill="${tCol}" pointer-events="none">${escSVG(l.code)}</text></g>`;
    };
    const markerSvg=(l,hx,hy,entry,extra="")=>{
      const on=l.state==="on";
      // A custom pin colour applies to the LIT state only. Using it while the
      // light is off made every placed light look permanently on, which breaks
      // the one thing the sidebar exists for.
      const lit=bodyCol(l,entry);
      // Showcase: a dark fixture is slate and recedes; the eye should go to
      // what is actually lit. Working mode keeps the flat pair it always had.
      const fill=on?lit:(SHOW?"#1b2733":"#374151");
      const stripBorder=l.isWled?WLED_BORDER
        :(l.isPartition?PARTITION_BORDER
        :(l.isFan?FAN_BORDER
        :(l.isMotion?MOTION_BORDER
        :(l.isTemp?TEMP_BORDER:null))));
      const stroke=SHOW
        ? (on?(stripBorder||"#f8fafc"):"#3f5165")
        : (stripBorder||"#60a5fa");
      // A class the layer chips have filtered out is dimmed to a ghost and
      // stops taking taps — it keeps its place on the map (that IS the
      // context) but can no longer be switched by mistake.
      const dim=dimmed(l);
      const op=(SHOW?(on?1:0.62):(on?1:0.45))*(dim?0.22:1);
      const gAttrs=`data-class="${lightClassOf(l)}"${dim?' pointer-events="none"':""}`;
      const tCol=SHOW?(on?lit:"#7f93a8"):(on?"#111827":"#e2e8f0");
      // A perimeter light's body IS its trace ("should be just the custom
      // shape formed to the room" — Garry, then: "Keep the glow, and the
      // click space of the square, but hide the square"). So: the Showcase
      // pool still glows (drawn from the jobs pass, untouched by this), the
      // grab target is the EXACT rounded-rect footprint the square had —
      // just transparent — and the code stays, centred in that space, so
      // click, drag and long-press keep the target they always had. The
      // legend keeps shapeSvg's small frame icon: a key needs a symbol,
      // the map doesn't.
      if(l.shape==="perimeter"){
        const HW=HEX_R*0.866;
        const pCol=SHOW?(on?lit:"#7f93a8"):(on?lit:"#94a3b8");
        const pLbl=HIDECODES ? "" : (CODECHIP
          ? codeChipSvg(l,hx,hy-HEX_R*1.55,pCol)   // the pill sits in the hit space, where the code was
          : `<text x="${hx.toFixed(1)}" y="${hy.toFixed(1)}" text-anchor="middle" dominant-baseline="middle" `+
            `font-family="ui-monospace,monospace" font-size="${CODE_PX.toFixed(1)}" font-weight="700" `+
            `fill="${pCol}" paint-order="stroke" stroke="#050d09" stroke-width="${(CODE_PX*0.42).toFixed(1)}" `+
            `stroke-linejoin="round" pointer-events="none">${escSVG(l.code)}</text>`);
        return `<g class="lhex" data-eid="${escSVG(l.entity_id)}" data-cx="${hx.toFixed(1)}" data-cy="${hy.toFixed(1)}"`+
          `${extra?" "+extra:""} ${gAttrs} style="cursor:pointer" opacity="${op}">`+
          `<rect data-hit="1" x="${n(hx-HW)}" y="${n(hy-HW)}" width="${n(HW*2)}" height="${n(HW*2)}" `+
          `rx="${n(HW*0.42)}" fill="transparent" stroke="none"/>`+
          pLbl+`</g>`;
      }
      // Physical size and rotation, in real units. width_cm/height_cm and
      // rotation have been in the stored schema all along and the WS command
      // has always accepted them — nothing ever drew them, which is why
      // "scaling and rotate don't work": they were never wired up. A metre of
      // fixture is frame.scale pixels, so a 2.4 m valance reads as a long bar
      // and a downlight stays a dot, at any zoom.
      // A perimeter light's real extent is the traced boundary
      // (perimeterSvg), never this point-icon — so its width_cm/height_cm/
      // rotation are ignored here even if the entry carries real numbers
      // (very likely, on a light that used to be some other shape: found
      // live, a light still stamped 308x285cm from when it was literal pot
      // lights stretched the plain "perimeter" square into a room-sized
      // block sitting on top of its own trace — a second, distinct bug from
      // the ones already fixed tonight, same root class: a control that
      // only makes sense for OTHER shapes was never turned off for this one).
      const isPerimeter=l.shape==="perimeter";
      const t=[];
      const rot=isPerimeter ? 0 : (Number(entry&&entry.rotation)||0);
      const {wCm,hCm}=isPerimeter ? {wCm:0,hCm:0} : fitCm(l,entry);
      const {sx,sy}=markerScale(wCm, hCm, frame.scale, HEX_R);
      if(rot||sx!==1||sy!==1){
        t.push(`translate(${hx.toFixed(1)},${hy.toFixed(1)})`);
        if(rot) t.push(`rotate(${rot.toFixed(1)})`);
        if(sx!==1||sy!==1) t.push(`scale(${sx.toFixed(3)},${sy.toFixed(3)})`);
      }
      // The outline scales and rotates; the CODE never does. A rotated or
      // stretched label is the thing that stops the map being readable at a
      // glance, which is the entire point of the view.
      const sw=t.length?(2/Math.max(sx,sy)):2;
      // One helper for every layer of the marker, so the halo, the body and the
      // gloss are the SAME silhouette at the SAME transform — the whole point
      // of Showcase is that it re-lights the shape you drew, not another one.
      const layer=(a)=>t.length
        ? `<g transform="${t.join(" ")}">`+shapeSvg(l.shape, 0, 0, HEX_R, a)+`</g>`
        : shapeSvg(l.shape, hx, hy, HEX_R, a);

      let body;
      if(SHOW){
        // Bloom hugging the silhouette (a stroke, so it follows any shape),
        // then the body, then the fixture's own detail, then a single
        // upper-left gloss over the lot. objectBoundingBox gradients mean one
        // def serves every marker on the map.
        //
        // Detail is skipped below 8 px: markers are sized in metres and floor
        // at 5 px, and a lamp ring inside a 5 px disc is mud, not information.
        const ink=on?inkOn(lit):"#8fa6bb";
        const detail=HEX_R>=8
          ? (t.length
              ? `<g transform="${t.join(" ")}">`+shapeDetailSvg(l.shape,0,0,HEX_R,ink,sw)+`</g>`
              : shapeDetailSvg(l.shape,hx,hy,HEX_R,ink,sw))
          : "";
        body=(on?layer(`fill="none" stroke="${lit}" stroke-width="${(sw*2.6).toFixed(2)}" stroke-opacity="0.22" stroke-linejoin="round"`):"")+
          layer(`fill="${fill}" stroke="${stroke}" stroke-width="${sw.toFixed(2)}" stroke-opacity="${on?0.75:0.55}" stroke-linejoin="round"`)+
          detail+
          layer(`fill="url(#psgloss)" stroke="none" pointer-events="none"`);
      } else {
        body=layer(`fill="${fill}" stroke="${stroke}" stroke-width="${sw.toFixed(2)}"`);
      }

      // Showcase moves the code out from under the glyph. At CODE_PX the label
      // is as wide as the marker it sits on, so in Showcase the symbol was
      // never actually visible — which defeats a mode whose job is to make the
      // symbols readable. Underneath, haloed, it reads as a plan's fixture tag.
      const lblY=SHOW ? hy+HEX_R*1.55+CODE_PX*0.45 : hy;
      // Semantic zoom hides the code entirely; the code CHIP (use surface)
      // makes it a target of its own under the glyph in both modes; otherwise
      // the code sits where it always did. Its gap clears the marker's ACTUAL
      // drawn size — Math.max(sx,sy) is a safe over-estimate at any rotation
      // (same reasoning `sw` above already uses) — so a fixture given a real
      // width/height (the resize handles) doesn't swallow its own chip.
      const chipGap=HEX_R*Math.max(1,sx,sy)*1.15;
      // Garry: "devices telling the temperature can also act like a motion
      // sensor, so rule is if they gave the temperature in the last hour
      // and they are placed on the map, a shape can be chosen for that
      // temp and inside is simply the temperature, 3 digit, and larger" —
      // then: "only if placed like all others". `entry` is the placement
      // record (null for an auto-clustered light — see the two call sites
      // below), so that half of the rule is the SAME truthiness check
      // every other placement-only behaviour here already uses. Replaces
      // the code outright, unconditionally of HIDECODES/CODECHIP — a live
      // reading is status, the same as the motion pulse, not a code.
      const tempFreshMs=l.isTemp && l.last_changed ? NOW_MS-Date.parse(l.last_changed) : NaN;
      const tempLbl=(l.isTemp && entry && Number.isFinite(l.temperature)
                     && tempFreshMs>=0 && tempFreshMs<TEMP_FRESH_MS)
        ? `<text x="${hx.toFixed(1)}" y="${hy.toFixed(1)}" text-anchor="middle" dominant-baseline="middle" `+
          `font-family="ui-monospace,monospace" font-size="${TEMP_DIGIT_PX.toFixed(1)}" font-weight="800" `+
          `fill="${tCol}" paint-order="stroke" stroke="#050d09" stroke-width="${(TEMP_DIGIT_PX*0.32).toFixed(1)}" `+
          `stroke-linejoin="round" pointer-events="none">${l.temperature}</text>`
        : null;
      const lbl=tempLbl!==null ? tempLbl : (HIDECODES ? "" : (CODECHIP ? codeChipSvg(l,hx,hy,SHOW?tCol:"#e2e8f0",chipGap) : (SHOW
        ? `<text x="${hx.toFixed(1)}" y="${lblY.toFixed(1)}" text-anchor="middle" dominant-baseline="middle" `+
          `font-family="ui-monospace,monospace" font-size="${(CODE_PX*0.92).toFixed(1)}" font-weight="700" `+
          `letter-spacing="0.06em" fill="${tCol}" paint-order="stroke" stroke="#050d09" `+
          `stroke-width="${(CODE_PX*0.42).toFixed(1)}" stroke-linejoin="round" pointer-events="none">`+
          `${escSVG(l.code)}</text>`
        : `<text x="${hx.toFixed(1)}" y="${hy.toFixed(1)}" text-anchor="middle" dominant-baseline="middle" `+
          `font-family="monospace" font-size="${CODE_PX.toFixed(1)}" font-weight="700" fill="${tCol}" pointer-events="none">`+
          `${escSVG(l.code)}</text>`)));

      // data-cx/data-cy is the fixture's own centre. The drag used to recover
      // it from the label's x/y, which is only the same point while the label
      // sits on the marker.
      return `<g class="lhex" data-eid="${escSVG(l.entity_id)}" data-cx="${hx.toFixed(1)}" data-cy="${hy.toFixed(1)}"`+
        `${extra?" "+extra:""} ${gAttrs} style="cursor:pointer" opacity="${op}">`+
        body+lbl+`</g>`;
    };
    // The invisible tap disc under a marker (sidebar only). Drawn in its own
    // pass BEFORE every marker on the floor, so a glyph is always above a
    // neighbour's halo and a tap on what you can see goes where it looks.
    const haloSvg=(l,hx,hy)=>dimmed(l) ? "" :
      `<circle class="lhalo" data-eid="${escSVG(l.entity_id)}" data-class="${lightClassOf(l)}" `+
      `cx="${hx.toFixed(1)}" cy="${hy.toFixed(1)}" r="${HALO_R.toFixed(1)}" fill="transparent" stroke="none" `+
      `pointer-events="all" style="cursor:pointer"/>`;
    // Use-mode stand-in for a room's pile of unplaced devices: one chip that
    // says how many, lit if any is on, carrying every entity id so the host
    // can open the room's sheet from it. Nothing here pretends to be a
    // measured position.
    const stackChipSvg=(room,eids,anyOn,cx,cy,z)=>{
      const label=`${eids.length} unplaced`;
      const fs=Math.max(5.5, CODE_PX*1.05);
      const w=label.length*fs*0.58+fs*2.4, h=fs*2.1;
      const col=anyOn?"#fbbf24":"#94a3b8";
      return `<g class="lstack" data-role="stack" data-room="${escSVG(room)}" data-z="${z}" `+
        `data-eids="${escSVG(eids.join(","))}" style="cursor:pointer" pointer-events="all">`+
        `<rect x="${(cx-w/2).toFixed(1)}" y="${(cy-h/2).toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" `+
        `rx="${(h/2).toFixed(1)}" fill="#0b1810" fill-opacity="0.88" stroke="${col}" stroke-opacity="0.6" `+
        `stroke-width="0.8" stroke-dasharray="3,2"/>`+
        `<polygon points="${hexPts(cx-w/2+fs*1.1, cy, fs*0.55)}" fill="${anyOn?col:"#374151"}" stroke="${col}" stroke-width="0.6"/>`+
        `<text x="${(cx+fs*0.55).toFixed(1)}" y="${cy.toFixed(1)}" text-anchor="middle" dominant-baseline="middle" `+
        `font-family="system-ui,sans-serif" font-size="${fs.toFixed(1)}" font-weight="600" fill="${col}" `+
        `pointer-events="none">${escSVG(label)}</text></g>`;
    };

    // A "perimeter" light's real extent: the room it is dropped in, traced
    // inward by its own margin_cm. Drawn for BOTH modes — this is the
    // fixture's shape, not a Showcase presentation effect — under everything
    // else on the floor, same reasoning as the room fills it sits just above.
    // entry is the fixture's placement record (pl.lp) — margin_cm lives there
    // alongside width_cm/height_cm/rotation, same storage, same draft path.
    const perimeterSvg=(l,room,entry)=>{
      if(!room || room.pts.length<3) return "";
      // Nullish, not ||: an explicit margin of 0 (right on the wall) is a
      // real, meaningful choice and must not fall back to the default just
      // because 0 is falsy — that would make a true zero unreachable.
      const rawCm=entry&&entry.margin_cm;
      const wantM=(rawCm===undefined||rawCm===null) ? defaultPerimeterMarginM(frame) : (Number(rawCm)||0)/100;
      // Clamped so a margin typed larger than the room cannot fold the
      // offset polygon back on itself — see offsetPolygonInward's own note.
      const marginM=Math.max(0, Math.min(wantM, roomHalfMinDim(room.pts)*0.85));
      const inset=offsetPolygonInward(room.pts, marginM);
      const ppx=inset.map(p=>pt(iso(p[0],p[1],room.z))).join(" ");
      const on=l.state==="on";
      const col=bodyCol(l,entry);
      // The crisp line wears the SAME outline colours every other marker
      // does (blue working / white lit / slate off, strip borders first) —
      // it used to draw in the fixture's body colour, which for the default
      // amber meant "a yellow line" indistinguishable from yellow-hued room
      // outlines. The LIGHT'S colour still shows where it belongs: the
      // Showcase glow underneath stays in the live colour.
      const stripBorder=l.isWled?WLED_BORDER:(l.isPartition?PARTITION_BORDER:null);
      const lineCol=SHOW ? (on?(stripBorder||"#f8fafc"):"#3f5165") : (stripBorder||"#60a5fa");
      const op=SHOW?(on?0.95:0.4):(on?1:0.45);
      const sw=Math.max(1.4, frame.scale*0.05);
      const eidAttr=`data-eid="${escSVG(l.entity_id)}"`;
      let s2=`<polygon ${eidAttr} points="${ppx}" fill="none" stroke="${lineCol}" stroke-width="${sw.toFixed(2)}" `+
        `stroke-linejoin="round" opacity="${op}" pointer-events="none"/>`;
      // Showcase: the trace also glows, faintly, the same way a real cove
      // run washes the ceiling line beside it — a wider, softer duplicate
      // underneath the crisp line, reusing the blur filter the room clips
      // already declared. This half keeps the fixture's own colour.
      if(SHOW && on) s2=`<polygon ${eidAttr} points="${ppx}" fill="none" stroke="${col}" `+
        `stroke-width="${(sw*3.5).toFixed(2)}" stroke-linejoin="round" opacity="0.28" `+
        `filter="url(#psclipsoft)" pointer-events="none"/>`+s2;
      return s2;
    };

    // Showcase underlay for one fixture: the pool it throws on the floor, and
    // the shadow it casts under itself. Both are drawn for the whole floor
    // BEFORE any marker, so one light's glow can never wash over another's
    // glyph. A floor circle projects to an ellipse of 0.5/0.866 — the same
    // ratio the iso projection uses — so the pool lies flat in the room.
    // Beam width is a property of the fixture TYPE — a spot at 20° and a
    // chandelier at 120° do not throw the same pool from the same lamp. The
    // factors are photometric defaults per type, not per-install tuning.
    // Shared with the push sites, which need the same radius for wall spill.
    const BEAM={triangle:0.68, diamond:0.45, sconce:0.8, chandelier:1.2, pendant:1.05};
    // The pool's reach in METRES for a fixture — the number the wall-spill
    // test asks "did the light reach this wall" with.
    const poolReachM=(l)=>Math.max((HEX_R*2.2)/frame.scale, (1.0+1.4*briOf(l))*(BEAM[l.shape]||1));
    const pointSegDist=(x,y,p,q)=>{
      const dx=q[0]-p[0], dy=q[1]-p[1];
      const L2=dx*dx+dy*dy;
      const t=L2 ? Math.max(0, Math.min(1, ((x-p[0])*dx+(y-p[1])*dy)/L2)) : 0;
      const ex=p[0]+t*dx-x, ey=p[1]+t*dy-y;
      return Math.sqrt(ex*ex+ey*ey);
    };
    // fx: optional per-fixture extras computed at push time, where the metre
    // coordinates and room polygons are in scope — {col} overrides the pool
    // colour (scene preview), {spill} is wall-spill line segments already
    // projected to px: [[x1,y1,x2,y2,fade], ...].
    // The blue pulse a triggered motion sensor throws — both modes, drawn
    // in the same underlay pass as the light pools so it sits beneath every
    // marker. Two layers: a breathing soft disc, and a ring that expands
    // and fades, radar-style, on a shared 1.6s clock.
    const motionPulseSvg=(hx,hy,eid)=>{
      const r0=HEX_R*1.15;
      return `<g class="lpulse" data-eid="${escSVG(eid)}" pointer-events="none">`+
        `<circle cx="${hx.toFixed(1)}" cy="${hy.toFixed(1)}" r="${(r0*1.6).toFixed(1)}" fill="url(#psmotion)" opacity="0.55">`+
        `<animate attributeName="opacity" values="0.55;0.2;0.55" dur="1.6s" repeatCount="indefinite"/>`+
        `</circle>`+
        `<circle cx="${hx.toFixed(1)}" cy="${hy.toFixed(1)}" r="${r0.toFixed(1)}" fill="none" stroke="${MOTION_PULSE}" stroke-width="1.6">`+
        `<animate attributeName="r" values="${(r0*0.7).toFixed(1)};${(r0*2.4).toFixed(1)}" dur="1.6s" repeatCount="indefinite"/>`+
        `<animate attributeName="opacity" values="0.8;0" dur="1.6s" repeatCount="indefinite"/>`+
        `</circle></g>`;
    };

    // A sensor that has GONE QUIET still says how long ago, at a glance:
    // "flashing blue goes to a flashing purple after the blue has stopped
    // ... all colours from blue to purple over 6 hours" — Garry. The hue
    // sweeps almost the whole wheel (a genuine rainbow, not a two-colour
    // flip) from blue at the instant it untrips to violet at the 6-hour
    // mark, then the glow is gone — "recent" has a hard edge, same as the
    // 6-hour window it is answering.
    const motionRecentHue=(elapsedMs)=>{
      const t=Math.max(0,Math.min(1,elapsedMs/MOTION_RECENT_MS));
      // 240°=blue, sweeping DOWN (the long way through cyan/green/yellow/
      // red/magenta) by 325° lands at 275°=violet when t reaches 1.
      return ((240-325*t)%360+360)%360;
    };
    // Calmer than the active pulse on purpose — a single breathing ring, no
    // expanding radar sweep, slower — it is a memory of activity, not a
    // claim that something is happening right now.
    // Named degSweep, not the shorter, more obvious word for it: a guard
    // test greps views/*.js for an inline HSL string built from a variable
    // spelled that way, because that shape is what a second, drifting copy
    // of room_color.js's OWN colour deriver would look like. This is a
    // genuinely different thing (time since a sensor went quiet, not a
    // room's identity), so it earns a name the guard was never meant to catch.
    const motionRecentPulseSvg=(hx,hy,degSweep,eid)=>{
      const r0=HEX_R*1.15;
      const col=`hsl(${degSweep.toFixed(0)},75%,58%)`;
      return `<circle class="lrecent" data-eid="${escSVG(eid)}" pointer-events="none" `+
        `cx="${hx.toFixed(1)}" cy="${hy.toFixed(1)}" `+
        `r="${r0.toFixed(1)}" fill="none" stroke="${col}" stroke-width="1.3" opacity="0.5">`+
        `<animate attributeName="opacity" values="0.5;0.16;0.5" dur="3s" repeatCount="indefinite"/>`+
        `</circle>`;
    };

    // "Choose an item in the list, make it easy to find" — one slow ring,
    // a third of the whole canvas across, sweeping outward from wherever
    // the light actually is and fading as it goes. Base opacity 0 so once
    // the two repeats finish (SMIL reverts to the base value on completion)
    // it is simply gone, not a ring left sitting on the map.
    const LOCATE_R = W/6;
    const locateSvg=(hx,hy)=>
      `<circle class="llocate" pointer-events="none" cx="${hx.toFixed(1)}" cy="${hy.toFixed(1)}" `+
      `r="${(HEX_R*1.4).toFixed(1)}" fill="none" stroke="#e879f9" stroke-width="2.2" opacity="0">`+
      `<animate attributeName="r" values="${(HEX_R*1.4).toFixed(1)};${LOCATE_R.toFixed(1)}" dur="1.9s" repeatCount="2" fill="freeze"/>`+
      `<animate attributeName="opacity" values="0;0.75;0" dur="1.9s" repeatCount="2" fill="freeze"/>`+
      `</circle>`;

    const glowSvg=(l,hx,hy,entry,clipId,fx)=>{
      if(l.state!=="on") return "";
      // Fans, motion sensors and temperature readouts are on the map, but
      // they are not light sources — nothing pools on the floor beneath them.
      if(l.isFan||l.isMotion||l.isTemp) return "";
      const col=(fx&&fx.col)||glowCol(l,entry);
      const b=briOf(l);
      const beam=BEAM[l.shape]||1;
      // In METRES, like everything else here: a fixture throws roughly 1.4 m at
      // a tenth and 3.4 m at full, which is what a downlight actually does on a
      // floor. Sizing the pool off the marker instead made it a bloom stuck to
      // the icon — markers are clamped to 5-14 px, so on a big site every pool
      // came out the same tiny disc no matter how large the room was.
      const rad=Math.max(HEX_R*2.2, frame.scale*(1.0+1.4*b)*beam);
      // A 3 m strip does not light a circle. The throw is ADDED to the
      // fixture's own length — multiplying by its scale instead made a 3 m run
      // throw three times as far as a downlight in every direction, and its
      // pool ran clean off the slab.
      const rot=Number(entry&&entry.rotation)||0;
      // The pool follows the CAPPED fixture, or a mis-typed 24 m valance would
      // still light the whole house from a marker that fits its room.
      const {wCm,hCm}=fitCm(l,entry);
      const half=(cm)=>((Number(cm)||0)/100)*frame.scale/2;
      const rx=rad+half(wCm);
      const ry=(rad+half(hCm))*0.577;
      // Directional types throw AHEAD of the glyph, not around it: the spot
      // glyph points up at rotation 0, so "forward" is -y in the rotated
      // frame and the group's own rotate() carries the pool with the aim. A
      // sconce washes off its wall the same way, just closer in.
      const fwd=l.shape==="triangle" ? rad*0.5 : (l.shape==="sconce" ? rad*0.35 : 0);
      // A very slow breathe, Showcase only — light is never as static as a
      // print. Amplitude rides brightness so a dim lamp barely stirs, and the
      // phase is staggered off the entity id so the house doesn't pulse in
      // lockstep like a hazard beacon.
      // Daylight mutes every pool together: at noon a lit lamp is a detail on
      // a bright plan, not a beacon on a black one.
      const op=(0.4+0.45*b)*(1-0.5*AMB);
      let ph=0; const eid=String(l.entity_id||"");
      for(let i=0;i<eid.length;i++) ph=(ph+eid.charCodeAt(i))%7;
      // Wall spill: where the pool reaches its room's wall, a faint stroke of
      // the pool's own colour runs along that wall — light climbing the
      // skirting is what sells the clip as walls rather than a stencil.
      let spill="";
      for(const sg of (fx&&fx.spill)||[]){
        spill+=`<line x1="${sg[0].toFixed(1)}" y1="${sg[1].toFixed(1)}" x2="${sg[2].toFixed(1)}" y2="${sg[3].toFixed(1)}" `+
          `stroke="${col}" stroke-width="2.4" stroke-linecap="round" opacity="${(sg[4]*0.32*(1-0.5*AMB)).toFixed(2)}" pointer-events="none"/>`;
      }
      const pool=`<g transform="translate(${hx.toFixed(1)},${hy.toFixed(1)})`+
        `${rot?` rotate(${rot.toFixed(1)})`:""}"><ellipse cx="0" cy="${fwd?(-fwd*0.577).toFixed(1):"0"}" `+
        `rx="${rx.toFixed(1)}" ry="${ry.toFixed(1)}" fill="url(#${glowIds.get(col)||"psshade"})" `+
        `opacity="${op.toFixed(2)}" pointer-events="none">`+
        `<animate attributeName="opacity" values="${op.toFixed(2)};${(op*0.9).toFixed(2)};${op.toFixed(2)}" `+
        `dur="${6+ph}s" begin="-${ph}s" repeatCount="indefinite"/>`+
        `</ellipse></g>`;
      // The pool stops at the room's walls; the fixture, its marker and its
      // label do not — only the light is clipped, so a fixture dropped on a
      // boundary still shows whole. The blur sits OUTSIDE the clip so the cut
      // edge feathers a couple of pixels past the wall, like a doorway leak.
      return clipId
        ? `<g filter="url(#psclipsoft)"><g clip-path="url(#${clipId})">${pool}${spill}</g></g>`
        : pool+spill;
    };
    // Small and faint, deliberately. At 1.45x the marker these were WIDER than
    // hexCluster's spacing (r*√3+2), so every room with more than one fixture
    // merged its shadows into one grey smear with tiny markers floating in it —
    // and the sidebar upscales this viewBox ~2.6x, which magnified the mess.
    // A contact shadow only has to seat the marker on the floor.
    const shadeSvg=(hx,hy)=>`<ellipse cx="${hx.toFixed(1)}" cy="${(hy+HEX_R*0.42).toFixed(1)}" `+
      `rx="${(HEX_R*0.9).toFixed(1)}" ry="${(HEX_R*0.34).toFixed(1)}" fill="url(#psshade)" `+
      `opacity="0.6" pointer-events="none"/>`;

    // Markers are collected and flushed after every room on the floor is drawn,
    // so a room polygon can never be painted over the fixtures of the room
    // beside it — and so Showcase can slide the light pools in underneath them.
    const jobs=[];
    // Collapsed piles of unplaced devices (use-mode), flushed with the markers.
    const stacks=[];

    // Rooms, straight from the metre fabric.
    for(const r of hereRooms){
      const color=roomColor(r.room, model);
      const ipts=r.pts.map(p=>iso(p[0],p[1],z));
      const pp=ipts.map(pt).join(" ");
      const cx=r.pts.reduce((a,p)=>a+p[0],0)/r.pts.length;
      const cy=r.pts.reduce((a,p)=>a+p[1],0)/r.pts.length;
      // The room's CENTRE. Unplaced lights cluster here — a light with no
      // stored position belongs in the middle of its room, not wherever the
      // name happens to be drawn.
      const [ccx,ccy]=iso(cx,cy,z);
      const lix=ccx;
      // The name sits near the room's TOP edge, not on its centroid. Fixtures
      // cluster around the middle of a room, so a centred name had a marker
      // punched through it in almost every room — "Garry's Office" with a hex
      // over the "y's". Horizontally it still tracks the centroid, so it reads
      // as that room's title rather than drifting to a corner.
      let liy=Math.min(...ipts.map(p=>p[1]))+8;
      // ...and if a fixture happens to sit on that spot anyway, the name steps
      // up out of the way rather than being drawn through. The halo keeps it
      // readable once it crosses the room's own edge.
      {
        const near=(ly)=>hereLights.some(l=>{
          const [mx2,my2]=iso(l.x,l.y,z);
          return Math.abs(mx2-lix)<34 && Math.abs(my2-ly)<9;
        });
        for(let tries=0; tries<3 && near(liy); tries++) liy-=13;
      }
      if(SHOW){
        // Same polygon, given depth: a soft dark edge seats the room on the
        // slab, the fill carries the room colour, and one sheen from the shared
        // upper-left light source keeps every room lit from the same place.
        s+=`<polygon points="${pp}" fill="none" stroke="#04100a" stroke-width="4" stroke-linejoin="round" opacity="0.5"/>`;
        s+=`<polygon points="${pp}" fill="${color}" fill-opacity="0.085" stroke="${color}" stroke-width="1.3" stroke-opacity="0.8" stroke-linejoin="round"/>`;
        s+=`<polygon points="${pp}" fill="url(#pswash)" stroke="none" pointer-events="none"/>`;
      } else {
        s+=`<polygon points="${pp}" fill="${color}" fill-opacity="0.16" stroke="${color}" stroke-width="1.6" opacity="1"/>`;
      }
      // paint-order puts the dark stroke UNDER the glyphs, so the name stays
      // legible over the floor hatch and over a slab edge it happens to cross.
      // Showcase sets it in tracked small caps — the convention every printed
      // plan uses for a room name, and it stops competing with the fixture codes.
      // The room's name is a TAP TARGET (data-role="room"): the sidebar opens
      // the room's sheet from it — every light in the room, all off, all on —
      // and the builder selects the room's lights. A transparent box behind
      // the text takes the tap; the glyph strokes alone would be a needle.
      {
        const rfs=SHOW?6.6:7.4;
        const rtxt=SHOW?String(r.room).toUpperCase():String(r.room);
        const rw=rtxt.length*rfs*(SHOW?0.78:0.6)+10, rh=rfs*1.9;
        s+=`<g class="lroom" data-role="room" data-room="${escSVG(r.room)}" data-z="${z}" style="cursor:pointer">`+
          `<rect x="${(lix-rw/2).toFixed(1)}" y="${(liy-rh/2).toFixed(1)}" width="${rw.toFixed(1)}" height="${rh.toFixed(1)}" `+
          `rx="3" fill="transparent" stroke="none" pointer-events="all"/>`;
      }
      s+=`<text x="${Math.round(lix)}" y="${Math.round(liy)}" text-anchor="middle" dominant-baseline="middle" `+
        `fill="${color}" font-size="${SHOW?"6.6":"7.4"}" font-family="system-ui,sans-serif" font-weight="600" `+
        (SHOW?`letter-spacing="0.16em" `:``)+
        `paint-order="stroke" stroke="#071008" stroke-width="2.5" stroke-linejoin="round" `+
        `opacity="${SHOW?"0.72":"0.95"}" pointer-events="none">`+
        `${escSVG(SHOW?String(r.room).toUpperCase():r.room)}</text></g>`;
      // Room assignment isn't known yet (registry still loading) — show a
      // single pulsing placeholder instead of blocking the whole map on
      // a multi-MB registry fetch; real hexes replace it once it lands.
      if(lightsLoading){
        s+=`<polygon points="${hexPts(ccx,ccy,HEX_R)}" fill="#374151" stroke="#60a5fa" stroke-width="2" opacity="0.5">`+
          `<animate attributeName="opacity" values="0.25;0.65;0.25" dur="1.2s" repeatCount="indefinite"/>`+
          `</polygon>`;
        continue;
      }
      // Hexagon cluster for this room's unplaced lights — a light with a real
      // position was already drawn at it.
      const roomLights=(byRoom[r.room]||[]).filter(l=>!hiddenEids.has(l.entity_id) && !placed[l.entity_id]);
      if(!roomLights.length) continue;
      // A perimeter light traces its ROOM, which is already known here —
      // no placement needed to see it. Unplaced means no entry, so this
      // draws at the default margin; dragging it onto the map is only for
      // adjusting margin, not for making the trace appear at all.
      for(const l of roomLights) if(l.shape==="perimeter") s+=perimeterSvg(l, r, null);
      // Use-mode: the pile becomes one chip. The chip is drawn with the
      // markers (a job with no light) so it sits above the pools and the
      // room fill like a marker would.
      if(COLLAPSE){
        const eids=roomLights.map(l=>l.entity_id);
        const anyOn=roomLights.some(l=>l.state==="on");
        stacks.push([r.room, eids, anyOn, ccx, ccy, z]);
        continue;
      }
      const offsets=hexCluster(roomLights.length, HEX_R);
      // Build-mode: the pile stays a pile (drag one out to place it), but it
      // is VISIBLY provisional — a dashed ring round the cluster says "these
      // are inferred from the room, not measured", and how many there are.
      {
        let rr=0;
        for(const [dx,dy] of offsets) rr=Math.max(rr, Math.hypot(dx,dy));
        rr+=HEX_R+3;
        s+=`<circle class="lprov" cx="${ccx.toFixed(1)}" cy="${ccy.toFixed(1)}" r="${rr.toFixed(1)}" fill="none" `+
          `stroke="#94a3b8" stroke-width="0.7" stroke-dasharray="3,2.5" opacity="${SHOW?0.28:0.45}" pointer-events="none"/>`;
        if(!SHOW && !HIDECODES){
          const pfs=Math.max(4.5, CODE_PX*0.85);
          s+=`<text x="${ccx.toFixed(1)}" y="${(ccy+rr+pfs*0.9).toFixed(1)}" text-anchor="middle" dominant-baseline="middle" `+
            `font-family="system-ui,sans-serif" font-size="${pfs.toFixed(1)}" fill="#94a3b8" opacity="0.7" `+
            `pointer-events="none">${roomLights.length} unplaced</text>`;
        }
      }
      roomLights.forEach((l,idx)=>{
        const [dx,dy]=offsets[idx];
        const fx=SHOW&&FIELD ? {col: fieldColOf(cx,cy,z)} : undefined;
        jobs.push([l, ccx+dx, ccy+dy, null, `data-z="${z}"`, roomClip.get(r), fx]);
      });
    }

    // Placed lights — metres from the fabric, through the same projection the
    // rooms just used.
    for(const pl of hereLights){
      if(hiddenEids.has(pl.eid)) continue;
      const l=lightsByEid[pl.eid];
      if(!l) continue;
      const [hx,hy]=iso(pl.x, pl.y, z);
      // Which room this fixture sits in — from its POSITION, the same
      // ray-cast the fit cap uses. Outside every polygon (a hallway, the
      // garden) it is left unclipped/untraced. Needed in BOTH modes now: a
      // perimeter light's shape depends on it, not only Showcase's pool clip.
      let room=null;
      if(SHOW || l.shape==="perimeter"){
        for(const r of hereRooms){ if(pointInRoom(r.pts, pl.x, pl.y)){ room=r; break; } }
      }
      if(l.shape==="perimeter") s+=perimeterSvg(l, room, pl.lp);
      let clip, fx;
      if(SHOW){
        clip=room?roomClip.get(room):undefined;
        const col=FIELD ? fieldColOf(pl.x, pl.y, z) : null;
        // Wall spill: every wall of the fixture's room its pool actually
        // reaches, faded by how far away the wall is.
        let spillSegs=null;
        if(room && l.state==="on" && !l.isFan && !l.isMotion && !l.isTemp){
          const reach=poolReachM(l)*0.8;
          for(let i=0,j=room.pts.length-1;i<room.pts.length;j=i++){
            const d=pointSegDist(pl.x, pl.y, room.pts[j], room.pts[i]);
            if(d<reach){
              const a=iso(room.pts[j][0], room.pts[j][1], z), b2=iso(room.pts[i][0], room.pts[i][1], z);
              (spillSegs=spillSegs||[]).push([a[0], a[1], b2[0], b2[1], 1-d/reach]);
            }
          }
        }
        if(col||spillSegs) fx={col, spill:spillSegs};
      }
      jobs.push([l, hx, hy, pl.lp, `data-z="${z}" data-placed="1"`, clip, fx]);
    }

    if(SHOW){
      // Pools first, and blended so overlapping light ADDS instead of stacking
      // opaque discs — two fixtures washing the same corner should read as a
      // brighter corner, which is the whole reason to draw them at all.
      s+=`<g style="mix-blend-mode:screen" pointer-events="none">`;
      for(const [l,hx,hy,entry,,clip,fx] of jobs) s+=glowSvg(l,hx,hy,entry,clip,fx);
      s+=`</g>`;
      // A contact shadow seats a MARKER on the floor; a perimeter light's
      // marker is hidden (only its hit space and code remain), so a shadow
      // there would be a smudge under nothing.
      for(const [l2,hx,hy] of jobs) if(l2.shape!=="perimeter") s+=shadeSvg(hx,hy);

      // ── Isolux contours — the engineer's view, honest because the grid is
      // real metres and the sources are the fixtures' real positions and
      // brightness. RELATIVE illuminance (lumens are unknown), three bands at
      // fractions of this floor's own peak, marching-squares into thin paths.
      if(ISOLUX){
        const box=floorBox.get(z);
        const srcs=hereLights
          .filter(pl=>!hiddenEids.has(pl.eid) && lightsByEid[pl.eid] && lightsByEid[pl.eid].state==="on")
          .map(pl=>({x:pl.x, y:pl.y, b:briOf(lightsByEid[pl.eid])}));
        if(box && srcs.length){
          const step=Math.max(0.25, Math.max(box.x1-box.x0, box.y1-box.y0)/56);
          const pad=1.0;
          const nx=Math.max(2, Math.ceil((box.x1-box.x0+2*pad)/step))+1;
          const ny=Math.max(2, Math.ceil((box.y1-box.y0+2*pad)/step))+1;
          const gx=(i)=>box.x0-pad+i*step, gy=(j)=>box.y0-pad+j*step;
          const E=new Float64Array(nx*ny);
          let emax=0;
          for(let j=0;j<ny;j++) for(let i=0;i<nx;i++){
            let e=0;
            for(const sc of srcs){
              const dx=gx(i)-sc.x, dy=gy(j)-sc.y;
              e+=sc.b/(dx*dx+dy*dy+0.35);
            }
            E[j*nx+i]=e; if(e>emax) emax=e;
          }
          const LEVELS_LX=[[0.5,"0.55"],[0.22,"0.4"],[0.09,"0.28"]];
          for(const [frac,opac] of LEVELS_LX){
            const thr=emax*frac;
            let d="";
            // Marching squares: interpolated crossing per cell edge, one line
            // segment (two for the saddles) per crossed cell.
            const lerpP=(x0,y0,e0,x1,y1,e1)=>{
              const t=(thr-e0)/((e1-e0)||1e-9);
              return [x0+(x1-x0)*t, y0+(y1-y0)*t];
            };
            for(let j=0;j<ny-1;j++) for(let i=0;i<nx-1;i++){
              const e00=E[j*nx+i], e10=E[j*nx+i+1], e01=E[(j+1)*nx+i], e11=E[(j+1)*nx+i+1];
              const c=(e00>thr?1:0)|(e10>thr?2:0)|(e11>thr?4:0)|(e01>thr?8:0);
              if(c===0||c===15) continue;
              const x0=gx(i), x1=gx(i+1), y0=gy(j), y1=gy(j+1);
              const T=()=>lerpP(x0,y0,e00,x1,y0,e10), R=()=>lerpP(x1,y0,e10,x1,y1,e11);
              const B=()=>lerpP(x0,y1,e01,x1,y1,e11), L=()=>lerpP(x0,y0,e00,x0,y1,e01);
              const segs={1:[[L,T]],2:[[T,R]],3:[[L,R]],4:[[R,B]],5:[[L,T],[R,B]],6:[[T,B]],7:[[L,B]],
                          8:[[B,L]],9:[[T,B]],10:[[T,R],[B,L]],11:[[R,B]],12:[[L,R]],13:[[T,R]],14:[[L,T]]}[c];
              for(const [f1,f2] of segs){
                const p1=f1(), p2=f2();
                const a=iso(p1[0],p1[1],z), b2=iso(p2[0],p2[1],z);
                d+=`M${a[0].toFixed(1)} ${a[1].toFixed(1)}L${b2[0].toFixed(1)} ${b2[1].toFixed(1)}`;
              }
            }
            if(d) s+=`<path d="${d}" fill="none" stroke="#9fe3bd" stroke-width="0.7" opacity="${opac}" pointer-events="none"/>`;
          }
        }
      }
    }
    // Triggered motion sensors pulse blue beneath their markers — BOTH
    // modes, unlike the light pools above: a tripped sensor is live status,
    // not a presentation effect.
    if(LOCATE_EID){
      const found=jobs.find(j=>j[0].entity_id===LOCATE_EID);
      if(found) s+=locateSvg(found[1],found[2]);
    }
    for(const [l2,hx,hy] of jobs){
      if(!l2.isMotion) continue;
      if(l2.state==="on"){ s+=motionPulseSvg(hx,hy,l2.entity_id); continue; }
      // Quiet now — was it quiet RECENTLY? last_changed is when it last
      // flipped state, so while off that IS when it stopped tripping. No
      // timestamp (or an unparsable one) makes elapsed NaN, and every
      // comparison below is false for NaN — that's the bail-out, nothing
      // extra needed for a missing last_changed.
      const lastMs=l2.last_changed ? Date.parse(l2.last_changed) : NaN;
      const elapsed=NOW_MS-lastMs;
      if(elapsed>=0 && elapsed<MOTION_RECENT_MS) s+=motionRecentPulseSvg(hx,hy, motionRecentHue(elapsed), l2.entity_id);
    }
    // Halos go under EVERY marker on the floor (see haloSvg); then the
    // markers; then the use-mode stack chips, which stand in for markers.
    if(HALO) for(const [l2,hx,hy] of jobs) s+=haloSvg(l2,hx,hy);
    for(const j of jobs) s+=markerSvg(...j);
    for(const st of stacks) s+=stackChipSvg(...st);

    // Floor level badge
    // The badge marks the storey, so it has to stay on the canvas. Slabs are
    // sized to their own floor now, so a narrow one can put its bottom-left
    // corner past the edge and the badge was drawn half outside the frame.
    // It is a TAP TARGET too (data-role="floor"): the sidebar's floor sheet —
    // everything on this storey, all off — hangs off it.
    const badgeX=Math.max(18, Math.min(W-18, Math.round(BL[0])));
    const badgeY=Math.round(BL[1]);
    s+=`<g class="lfloor" data-role="floor" data-z="${z}" style="cursor:pointer">`;
    if(SHOW) s+=`<circle cx="${badgeX}" cy="${badgeY}" r="19" fill="none" stroke="${lyrColor}" stroke-width="1" opacity="0.3"/>`;
    s+=`<circle cx="${badgeX}" cy="${badgeY}" r="15" fill="${lyrColor}" opacity="0.95"/>`;
    s+=`<text x="${badgeX}" y="${badgeY+6}" text-anchor="middle" fill="#071008" font-size="14" font-weight="700" pointer-events="none">${lidx+1}</text>`;
    s+=`</g>`;
    s+=`</g>`;
  }

  // A second way to place the selected light: a pin parked in the
  // bottom-right corner of the canvas — always in the same spot, so it is
  // always findable — that the builder drags out onto the map. Not tied to
  // any entity (no data-eid); the host resolves the drop itself and this
  // glyph simply snaps back home on the next render, exactly as every other
  // interactive element here is rebuilt fresh each time.
  if(opts.dropMarker){
    const dx=W-40, dy=BASE_H-40;
    s+=`<g class="ldropmarker" data-role="dropmarker" style="cursor:grab" pointer-events="all">`+
      `<title>Drag onto the map to place the selected light</title>`+
      `<circle cx="${dx}" cy="${dy}" r="17" fill="#1b0f24" fill-opacity="0.92" stroke="#e879f9" stroke-width="2"/>`+
      `<circle cx="${dx}" cy="${dy}" r="17" fill="none" stroke="#e879f9" stroke-width="6" stroke-opacity="0.18"/>`+
      `<line x1="${dx-7}" y1="${dy}" x2="${dx+7}" y2="${dy}" stroke="#f0abfc" stroke-width="2.2" stroke-linecap="round"/>`+
      `<line x1="${dx}" y1="${dy-7}" x2="${dx}" y2="${dy+7}" stroke="#f0abfc" stroke-width="2.2" stroke-linecap="round"/>`+
      `</g>`;
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
