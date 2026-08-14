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
    // A plain fixture plate: bevel, plus the lamp behind it.
    default:         return path(sub(arcPts(cx,cy,r*0.6,r*0.6,90,450,6)))+dot(cx,cy,HW*0.15);
  }
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

  // Scale from the LARGEST SINGLE FLOOR, not the union of all of them.
  // Floors are drawn stacked (each centred on itself), so only one floor's
  // worth of ground is ever on screen at a time. Scaling to the union — which
  // spans every floor's own band in the metre frame, 51 m here against a 29 m
  // building — drew everything at half the size it could be, wasting the sides
  // of the canvas and shrinking every marker with it.
  let spanX=0, spanY=0;
  {
    const per={};
    const grow2=(z,x,y)=>{ const a=per[z]||(per[z]=[Infinity,Infinity,-Infinity,-Infinity]);
      if(x<a[0])a[0]=x; if(y<a[1])a[1]=y; if(x>a[2])a[2]=x; if(y>a[3])a[3]=y; };
    // indoor sets: outdoor rooms are dropped from the map a few lines below,
    // and letting them size it here is what made the house tiny in the corner.
    // ROOMS set the scale, not the fixtures in them. A light dragged past its
    // room's edge used to expand the floor's span, so the whole map rescaled
    // mid-edit: the fixture landed at the right metres but the drawing shrank
    // under it, and it appeared to move less than the pointer or spring back.
    // The building's extent is a property of the building.
    for(const r of indoorRooms)  for(const p of r.pts) grow2(r.z,p[0],p[1]);
    if(!indoorRooms.length) for(const l of indoorLights) grow2(l.z,l.x,l.y);
    for(const a of Object.values(per)){
      if(!isFinite(a[0])) continue;
      spanX=Math.max(spanX,(a[2]-a[0])+padM*2);
      spanY=Math.max(spanY,(a[3]-a[1])+padM*2);
    }
  }
  if(!(spanX>0)) spanX=Math.max(0.001,maxX-minX);
  if(!(spanY>0)) spanY=Math.max(0.001,maxY-minY);

  // Pixels per metre, chosen so the diamond footprint fits the canvas. The
  // iso footprint is (spanX+spanY) wide at 0.866 and tall at 0.5.
  const S = Math.min((W-90)/((spanX+spanY)*0.866), (BASE_H-260)/((spanX+spanY)*0.5));

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

  const floorOffset = {};
  {
    const per = {};
    for (const r of rooms)  for (const p of r.pts) {
      const a = per[r.z] || (per[r.z] = [Infinity,Infinity,-Infinity,-Infinity]);
      if(p[0]<a[0])a[0]=p[0]; if(p[1]<a[1])a[1]=p[1]; if(p[0]>a[2])a[2]=p[0]; if(p[1]>a[3])a[3]=p[1];
    }
    // Fixtures do not move the floor they sit on. A floor with no rooms at all
    // has nothing else to centre on, so there they still count.
    const floorsWithRooms = new Set(rooms.map(r => r.z));
    for (const l of lights) {
      if (floorsWithRooms.has(l.z)) continue;
      const a = per[l.z] || (per[l.z] = [Infinity,Infinity,-Infinity,-Infinity]);
      if(l.x<a[0])a[0]=l.x; if(l.y<a[1])a[1]=l.y; if(l.x>a[2])a[2]=l.x; if(l.y>a[3])a[3]=l.y;
    }
    for (const [z,a] of Object.entries(per)) {
      if(!isFinite(a[0])) continue;
      floorOffset[z] = [ (a[0]+a[2])/2 - mx, (a[1]+a[3])/2 - my ];
    }
  }
  const off = (z)=>floorOffset[z] || [0,0];

  const iso    = (x,y,z)=>{
    const [ox,oy]=off(z), k=rankOf(z);
    return [ CX + ((x-ox-mx)-(y-oy-my))*S*0.866 + k*HG,
             CY + ((x-ox-mx)+(y-oy-my))*S*0.5   - k*FG ];
  };
  const isoInv = (sx,sy,z)=>{
    const [ox,oy]=off(z), k=rankOf(z);
    const a=(sx - CX - k*HG)/(S*0.866);
    const b=(sy - CY + k*FG)/(S*0.5);
    return [ (a+b)/2 + mx + ox, (b-a)/2 + my + oy ];
  };

  return { rooms, lights, levels, iso, isoInv, rankOf, scale: S,
           bbox:{minX,minY,maxX,maxY}, empty, levelOf };
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
// opts.showcase — the presentation renderer. Same fabric, same fixtures, same
// silhouettes, same placement: what changes is the LIGHTING of the drawing.
// Fixtures that are on cast a real pool in their own colour, markers get a
// contact shadow and a lit rim, and the code steps out from under the glyph so
// the symbol can be seen. Everything the build tools rely on (g.lhex, data-eid,
// data-cx/cy) is untouched, so the map stays fully editable in this mode.
export function buildIsoSVG(model, byRoom, hiddenEids, focusZ, floorGap, horizGap, lightsByEid={}, lightsLoading=false, floors=[], opts={}){
  const SHOW = !!opts.showcase;
  const FIT  = !!opts.fitRooms;
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
  let s=`<svg viewBox="0 ${viewY} ${W} ${HTOTAL}" xmlns="http://www.w3.org/2000/svg" width="100%" `+
    `data-natural-h="${HTOTAL}" style="display:block;font-family:system-ui,sans-serif">`;
  s+=`<rect x="0" y="${viewY}" width="${W}" height="${HTOTAL}" fill="#071008"/>`;

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
  const glowCol=(l,entry)=>Array.isArray(l&&l.rgb)&&l.rgb.length>=3
    ? QCOL(l.rgb)
    : ((entry&&entry.color)||"#fbbf24");
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
  if(SHOW){
    for(const l of lights){
      const li=lightsByEid[l.eid];
      if(!li || li.state!=="on" || hiddenEids.has(l.eid)) continue;
      const c=glowCol(li,l.lp);
      if(!glowIds.has(c)) glowIds.set(c, `psglow_${glowIds.size}`);
    }
    for(const rname of Object.keys(byRoom||{})) for(const li of byRoom[rname]||[]){
      if(li.state!=="on" || hiddenEids.has(li.entity_id)) continue;
      const c=glowCol(li, null);
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
  const capOfRoom=new Map();
  if(FIT){
    for(const r of rooms){
      let a=Infinity,b=Infinity,c=-Infinity,d=-Infinity;
      for(const p of r.pts){
        if(p[0]<a)a=p[0]; if(p[0]>c)c=p[0];
        if(p[1]<b)b=p[1]; if(p[1]>d)d=p[1];
      }
      if(!isFinite(a)) continue;
      const inset=(m)=>Math.max(0.05, m-2*Math.min(0.35, Math.max(0.08, m*0.05)));
      const w=inset(c-a), h=inset(d-b);
      capOfRoom.set(r, [Math.max(w,h), Math.min(w,h)]);   // [longest, shortest]
    }
  }
  // WHICH room a fixture is in comes from its POSITION, not from its Home
  // Assistant area. Keying this on the area assignment is why the constraint
  // did nothing on a real house: not one placed light here has an area set —
  // they were dropped where they physically are, which is the better answer
  // anyway, and the fabric already knows it. Ray-cast against the polygons on
  // the light's own floor; a fixture outside every room is left as typed.
  const pointInRoom=(pts,x,y)=>{
    let inside=false;
    for(let i=0,j=pts.length-1;i<pts.length;j=i++){
      const [xi,yi]=pts[i], [xj,yj]=pts[j];
      if(((yi>y)!==(yj>y)) && (x < (xj-xi)*(y-yi)/((yj-yi)||1e-9) + xi)) inside=!inside;
    }
    return inside;
  };
  // eid -> [longest, shortest] metres, filled as each floor is walked.
  const capForLight={};
  // The fixture's measurements as they should be DRAWN. Its own long axis is
  // capped by the room's long axis, whichever way round it was entered.
  const fitCm=(l,entry)=>{
    let wCm=Number(entry&&entry.width_cm)||0;
    let hCm=Number(entry&&entry.height_cm)||0;
    const cap=FIT && capForLight[l&&l.entity_id];
    if(cap){
      const [lng,sht]=cap;
      const [capW,capH]=wCm>=hCm ? [lng,sht] : [sht,lng];
      if(wCm>capW*100) wCm=capW*100;
      if(hCm>capH*100) hCm=capH*100;
    }
    return {wCm,hCm};
  };

  // Floor surface patterns
  s+=`<defs>`;
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
  for(const z of levels){
    let a=Infinity,b=Infinity,c=-Infinity,d=-Infinity;
    for(const r of rooms) if(r.z===z) for(const p of r.pts){
      if(p[0]<a)a=p[0]; if(p[0]>c)c=p[0]; if(p[1]<b)b=p[1]; if(p[1]>d)d=p[1];
    }
    for(const l of lights) if(l.z===z){
      if(l.x<a)a=l.x; if(l.x>c)c=l.x; if(l.y<b)b=l.y; if(l.y>d)d=l.y;
    }
    if(isFinite(a)){ slabHalfW=Math.max(slabHalfW,(c-a)/2); slabHalfH=Math.max(slabHalfH,(d-b)/2); }
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
      // A placed fixture is capped by the room its METRES fall in.
      for(const pl of hereLights){
        const r=hereRooms.find(rr=>pointInRoom(rr.pts, pl.x, pl.y));
        const cap=r && capOfRoom.get(r);
        if(cap) capForLight[pl.eid]=cap;
      }
      // An unplaced one is drawn clustered at its room's centre, so that is
      // the room it is in for this purpose.
      for(const r of hereRooms){
        const cap=capOfRoom.get(r);
        if(cap) for(const li of (byRoom[r.room]||[])) if(!capForLight[li.entity_id]) capForLight[li.entity_id]=cap;
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
    const markerSvg=(l,hx,hy,entry,extra="")=>{
      const on=l.state==="on";
      // A custom pin colour applies to the LIT state only. Using it while the
      // light is off made every placed light look permanently on, which breaks
      // the one thing the sidebar exists for.
      const lit=bodyCol(l,entry);
      // Showcase: a dark fixture is slate and recedes; the eye should go to
      // what is actually lit. Working mode keeps the flat pair it always had.
      const fill=on?lit:(SHOW?"#1b2733":"#374151");
      const stroke=SHOW
        ? (on?(l.isWled?WLED_BORDER:"#f8fafc"):"#3f5165")
        : (l.isWled?WLED_BORDER:"#60a5fa");
      const op=SHOW?(on?1:0.62):(on?1:0.45);
      const tCol=SHOW?(on?lit:"#7f93a8"):(on?"#111827":"#e2e8f0");
      // Physical size and rotation, in real units. width_cm/height_cm and
      // rotation have been in the stored schema all along and the WS command
      // has always accepted them — nothing ever drew them, which is why
      // "scaling and rotate don't work": they were never wired up. A metre of
      // fixture is frame.scale pixels, so a 2.4 m valance reads as a long bar
      // and a downlight stays a dot, at any zoom.
      const t=[];
      const rot=Number(entry&&entry.rotation)||0;
      const {wCm,hCm}=fitCm(l,entry);
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
      const lbl=SHOW
        ? `<text x="${hx.toFixed(1)}" y="${lblY.toFixed(1)}" text-anchor="middle" dominant-baseline="middle" `+
          `font-family="ui-monospace,monospace" font-size="${(CODE_PX*0.92).toFixed(1)}" font-weight="700" `+
          `letter-spacing="0.06em" fill="${tCol}" paint-order="stroke" stroke="#050d09" `+
          `stroke-width="${(CODE_PX*0.42).toFixed(1)}" stroke-linejoin="round" pointer-events="none">`+
          `${escSVG(l.code)}</text>`
        : `<text x="${hx.toFixed(1)}" y="${hy.toFixed(1)}" text-anchor="middle" dominant-baseline="middle" `+
          `font-family="monospace" font-size="${CODE_PX.toFixed(1)}" font-weight="700" fill="${tCol}" pointer-events="none">`+
          `${escSVG(l.code)}</text>`;

      // data-cx/data-cy is the fixture's own centre. The drag used to recover
      // it from the label's x/y, which is only the same point while the label
      // sits on the marker.
      return `<g class="lhex" data-eid="${escSVG(l.entity_id)}" data-cx="${hx.toFixed(1)}" data-cy="${hy.toFixed(1)}"`+
        `${extra?" "+extra:""} style="cursor:pointer" opacity="${op}">`+
        body+lbl+`</g>`;
    };

    // Showcase underlay for one fixture: the pool it throws on the floor, and
    // the shadow it casts under itself. Both are drawn for the whole floor
    // BEFORE any marker, so one light's glow can never wash over another's
    // glyph. A floor circle projects to an ellipse of 0.5/0.866 — the same
    // ratio the iso projection uses — so the pool lies flat in the room.
    const glowSvg=(l,hx,hy,entry)=>{
      if(l.state!=="on") return "";
      const col=glowCol(l,entry);
      const b=briOf(l);
      // In METRES, like everything else here: a fixture throws roughly 1.4 m at
      // a tenth and 3.4 m at full, which is what a downlight actually does on a
      // floor. Sizing the pool off the marker instead made it a bloom stuck to
      // the icon — markers are clamped to 5-14 px, so on a big site every pool
      // came out the same tiny disc no matter how large the room was.
      const rad=Math.max(HEX_R*2.2, frame.scale*(1.0+1.4*b));
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
      return `<g transform="translate(${hx.toFixed(1)},${hy.toFixed(1)})`+
        `${rot?` rotate(${rot.toFixed(1)})`:""}"><ellipse cx="0" cy="0" `+
        `rx="${rx.toFixed(1)}" ry="${ry.toFixed(1)}" fill="url(#${glowIds.get(col)||"psshade"})" `+
        `opacity="${(0.4+0.45*b).toFixed(2)}" pointer-events="none"/></g>`;
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
      let liy=Math.min(...ipts.map(p=>p[1]))+11;
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
      s+=`<text x="${Math.round(lix)}" y="${Math.round(liy)}" text-anchor="middle" dominant-baseline="middle" `+
        `fill="${color}" font-size="${SHOW?"7.6":"8.5"}" font-family="system-ui,sans-serif" font-weight="600" `+
        (SHOW?`letter-spacing="0.16em" `:``)+
        `paint-order="stroke" stroke="#071008" stroke-width="2.5" stroke-linejoin="round" `+
        `opacity="${SHOW?"0.72":"0.95"}" pointer-events="none">`+
        `${escSVG(SHOW?String(r.room).toUpperCase():r.room)}</text>`;
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
      const offsets=hexCluster(roomLights.length, HEX_R);
      roomLights.forEach((l,idx)=>{
        const [dx,dy]=offsets[idx];
        jobs.push([l, ccx+dx, ccy+dy, null, `data-z="${z}"`]);
      });
    }

    // Placed lights — metres from the fabric, through the same projection the
    // rooms just used.
    for(const pl of hereLights){
      if(hiddenEids.has(pl.eid)) continue;
      const l=lightsByEid[pl.eid];
      if(!l) continue;
      const [hx,hy]=iso(pl.x, pl.y, z);
      jobs.push([l, hx, hy, pl.lp, `data-z="${z}" data-placed="1"`]);
    }

    if(SHOW){
      // Pools first, and blended so overlapping light ADDS instead of stacking
      // opaque discs — two fixtures washing the same corner should read as a
      // brighter corner, which is the whole reason to draw them at all.
      s+=`<g style="mix-blend-mode:screen" pointer-events="none">`;
      for(const [l,hx,hy,entry] of jobs) s+=glowSvg(l,hx,hy,entry);
      s+=`</g>`;
      for(const [,hx,hy] of jobs) s+=shadeSvg(hx,hy);
    }
    for(const j of jobs) s+=markerSvg(...j);

    // Floor level badge
    // The badge marks the storey, so it has to stay on the canvas. Slabs are
    // sized to their own floor now, so a narrow one can put its bottom-left
    // corner past the edge and the badge was drawn half outside the frame.
    const badgeX=Math.max(18, Math.min(W-18, Math.round(BL[0])));
    const badgeY=Math.round(BL[1]);
    if(SHOW) s+=`<circle cx="${badgeX}" cy="${badgeY}" r="19" fill="none" stroke="${lyrColor}" stroke-width="1" opacity="0.3"/>`;
    s+=`<circle cx="${badgeX}" cy="${badgeY}" r="15" fill="${lyrColor}" opacity="0.95"/>`;
    s+=`<text x="${badgeX}" y="${badgeY+6}" text-anchor="middle" fill="#071008" font-size="14" font-weight="700">${lidx+1}</text>`;
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
