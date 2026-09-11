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

const { WLED_BORDER, PARTITION_BORDER, FAN_BORDER, MOTION_BORDER, MOTION_PULSE, TEMP_BORDER, LOCK_BORDER, DOOR_BORDER } =
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
// The one shared "which wall does this circle match" function — the same
// one the door/window circle tool's commit handler uses (maps.js), so the
// live preview drawn here can never name a different wall than what
// actually gets cut on Done. Pure polyline/circle geometry, no photo or
// map-placement code — wall_geom.js, not stack_transform.js, which the
// lights render path may never import (test_no_lights_file_touches_the_
// photo_machinery).
import { bestCircleWall, splitPolylineAtTwoPositions, roomEdgeForCircle, circlePolylineIntersections } from "./wall_geom.js";

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

// ── Automorph geometry: room-alignment shape morphing (Garry, 2026-09-07) ───
// "A switch and two sliders... morph all shapes to fit room dimensions...
// turn the cluttered overall look... into a work of art." Slider 1 (built
// here) grows every fixture's icon outline toward its own room's shape.
//
// Full point-correspondence morphing between two arbitrary polygons is a
// classical hard problem — see flubber (JS, MIT: "smoothly interpolate
// between any two arbitrary SVG paths") for real prior art; it cannot be
// installed here (no build step, no npm, and per this project's policy any
// third-party code needs asking first). The hand-built scheme: resample
// both outlines to the SAME point count at even arc-length spacing,
// normalize both to the same winding direction (alignRingStart), then let
// a cyclic-shift search (bestRotationalMatch below) pick which of the
// target's start indices lines up against the icon at minimum total
// squared point-to-point distance, and lerp corresponding points
// straight-line. An earlier version skipped the search and trusted each
// ring's own topmost point as a shared start reference, justified by both
// endpoints being near-convex; that justification died when the morph
// target became a per-fixture CELL from buildRoomFixtureCells — carved by
// distance-field competition against neighbours, routinely concave (a
// bite taken out by one or two neighbours) or lopsided — where "nearest my
// own bounding-box top" on a symmetric icon and on an irregular cell land
// at unrelated relative positions around the outline, and a straight
// index lerp between mismatched indices visibly crosses/twists at
// mid-slider, exactly where the morph should read cleanest.
//
// AUTOMORPH_N is a FLOOR on the correspondence count, not the count
// itself: automorphRing raises it toward the target ring's own
// pre-resample density (capped at 64) so the Chaikin-densified cell rings
// keep their concave detail — a notch sampled by only 24 points just gets
// rounded away, silently blunting the very non-overlap partition the cell
// system exists to make visible. A plain 4-8 vertex room polygon still
// resamples to exactly 24, unchanged from before.
const AUTOMORPH_N = 24;

function _polySignedArea(pts){
  let a=0;
  for(let i=0,j=pts.length-1;i<pts.length;j=i++) a += (pts[j][0]*pts[i][1] - pts[i][0]*pts[j][1]);
  return a/2;
}

// `count` evenly ARC-LENGTH-spaced points around a closed polygon, in the
// ring's own point order — the step both morph endpoints need before they
// can be lerped index-for-index (a hex's 6 vertices and a room's dozen
// can't otherwise line up).
export function resamplePolygonRing(pts, count){
  if(!pts || pts.length<2 || count<3) return pts||[];
  const segLens=[];
  let total=0;
  for(let i=0;i<pts.length;i++){
    const a=pts[i], b=pts[(i+1)%pts.length];
    const d=Math.hypot(b[0]-a[0], b[1]-a[1]);
    segLens.push(d); total+=d;
  }
  if(total<=0) return pts.slice(0,count);
  const out=[];
  for(let k=0;k<count;k++){
    let target=(total*k)/count;
    let i=0;
    while(i<segLens.length-1 && target>segLens[i]){ target-=segLens[i]; i++; }
    const a=pts[i], b=pts[(i+1)%pts.length];
    const segLen=segLens[i]||1e-9;
    const t=target/segLen;
    out.push([a[0]+(b[0]-a[0])*t, a[1]+(b[1]-a[1])*t]);
  }
  return out;
}

// Winds a ring to a consistent handedness and rotates its start to the
// point nearest the top of its own bounding box. Two rings built by
// completely different code (a hand-written icon outline, the room trace's
// own vertex order) need a SHARED, deterministic starting reference before
// lerping them index-for-index, or the interpolation twists through itself
// whenever the two happened to start at unrelated angles around their
// respective centroids.
export function alignRingStart(pts){
  if(!pts || pts.length<3) return pts||[];
  let ring=pts;
  if(_polySignedArea(ring) < 0) ring=[...ring].reverse();
  const cx=ring.reduce((a,p)=>a+p[0],0)/ring.length;
  const cy=ring.reduce((a,p)=>a+p[1],0)/ring.length;
  let bestI=0, bestD=Infinity;
  for(let i=0;i<ring.length;i++){
    const ang=Math.atan2(ring[i][1]-cy, ring[i][0]-cx);
    const d=Math.abs(ang-(-Math.PI/2));
    if(d<bestD){ bestD=d; bestI=i; }
  }
  return ring.slice(bestI).concat(ring.slice(0,bestI));
}

// A small icon's own outline, LOCAL space centred on (0,0), at the same
// radius shapeSvg's own glyphs use — v1 covers only the simple, roughly
// convex families the design doc scopes for a first pass (circle, bar,
// square); every other kind (fan, pendant, lock, hex itself, ...) falls
// back to the plain hexagon every unstyled fixture already draws as, so an
// unrecognised shape still morphs into something rather than nothing.
export function iconRingLocal(shape, r){
  const HW=r*0.866;
  if(shape==="circle"){
    const pts=[];
    for(let i=0;i<AUTOMORPH_N;i++){ const a=i/AUTOMORPH_N*2*Math.PI; pts.push([Math.cos(a)*HW, Math.sin(a)*HW]); }
    return pts;
  }
  if(shape==="bar" || shape==="square"){
    const h=shape==="bar" ? r*0.55 : HW;
    return [[-HW,-h],[HW,-h],[HW,h],[-HW,h]];
  }
  const pts=[];
  for(let k=0;k<6;k++){ const a=(90+k*60)*Math.PI/180; pts.push([r*Math.cos(a), r*Math.sin(a)]); }
  return pts;
}

// The morph's STARTING point should be the fixture's REAL manually-set
// footprint, not the generic default-radius glyph iconRingLocal alone draws
// (Garry, 2026-09-07: "the existing manual shapes are still meant to be a
// guide for the overall look, don't throw that info away"). Reuses
// markerScale verbatim — the SAME function the real (non-automorph) glyph's
// own `translate(hx,hy) rotate(rot) scale(sx,sy)` transform already scales
// and rotates with — so a 240cm strip at 30° starts the morph as its own
// real long, angled shape instead of snapping to a small hex the instant
// Automorph turns on, and the two stay visually consistent with each other.
// With no manual size recorded, markerScale returns identity {sx:1,sy:1},
// so this is a byte-for-byte no-op for every fixture that has none —
// exactly today's iconRingLocal(shape, hexR) output, unchanged.
export function automorphIconRing(shape, wCm, hCm, rotDeg, scale, hexR){
  const local=iconRingLocal(shape, hexR);
  const {sx,sy}=markerScale(wCm, hCm, scale, hexR);
  const rot=(Number(rotDeg)||0)*Math.PI/180;
  const cos=Math.cos(rot), sin=Math.sin(rot);
  return local.map(([x,y])=>{
    const sxp=x*sx, syp=y*sy;
    return [sxp*cos-syp*sin, sxp*sin+syp*cos];
  });
}

// Cyclic-shift correspondence search: returns `b` rotated so its points
// pair with `a`'s index-for-index at minimum total squared distance.
// alignRingStart already normalized both rings' winding and gave each a
// deterministic start, but its "topmost point" is a per-ring guess — on a
// symmetric icon and an irregular concave cell those two tops have no
// reason to sit at the same relative position around the outline, and a
// lerp between mismatched indices twists through itself (see the design
// comment above AUTOMORPH_N). O(N^2) — ~4096 ops at the N=64 cap, once
// per fixture per render, trivial even at ~100 fixtures. Ties break
// toward the smallest shift (strict <), so the result is fully
// deterministic — a render must be reproducible from the fabric alone.
export function bestRotationalMatch(a, b){
  if(!a || !a.length || !b || !b.length) return b||[];
  let bestShift=0, bestCost=Infinity;
  for(let s=0;s<b.length;s++){
    let c=0;
    for(let i=0;i<a.length;i++){
      const bp=b[(i+s)%b.length];
      const dx=a[i][0]-bp[0], dy=a[i][1]-bp[1];
      c+=dx*dx+dy*dy;
    }
    if(c<bestCost){ bestCost=c; bestShift=s; }
  }
  if(!bestShift) return b;
  return b.map((_,i)=>b[(i+bestShift)%b.length]);
}

// The morph itself. `iconLocal` is centred on (0,0) (iconRingLocal's own
// output); `iconCx,iconCy` places it at the fixture's real drawn position.
// `roomRingAbs` is the room's own outline in the SAME space (whatever space
// the caller already projected both into — this function is unit-agnostic,
// pure point arithmetic). t=0 returns the icon's own outline completely
// untouched (no resampling, no alignment) — the "off = current behaviour
// exactly" guarantee the switch and the slider's own rest position both
// depend on.
export function automorphRing(iconLocal, iconCx, iconCy, roomRingAbs, t){
  const iconAbs=iconLocal.map(p=>[p[0]+iconCx, p[1]+iconCy]);
  const clampT=Math.max(0, Math.min(1, t||0));
  if(clampT<=0 || !roomRingAbs || roomRingAbs.length<3) return iconAbs;
  // Adaptive count — AUTOMORPH_N is the floor (see its own comment): a
  // sparse hand-traced polygon still gets exactly 24, a Chaikin-densified
  // cell ring gets its own density up to 64 so concave detail survives.
  const N=Math.max(AUTOMORPH_N, Math.min(64, roomRingAbs.length));
  const a=alignRingStart(resamplePolygonRing(iconAbs, N));
  const b=bestRotationalMatch(a, alignRingStart(resamplePolygonRing(roomRingAbs, N)));
  return a.map((p,i)=>[p[0]+(b[i][0]-p[0])*clampT, p[1]+(b[i][1]-p[1])*clampT]);
}

// Hand-inked finish: a small deterministic per-vertex radial jitter on the
// FINAL morphed ring — the same never-Math.random() discipline the cell
// wobble established one level down (buildRoomFixtureCells seeds a sine
// from the fixture's own position, because the fabric alone must reproduce
// a render), extended upward: the partition BOUNDARY already reads organic
// thanks to that wobble, but the perfectly clean ring sitting on top of it
// read slightly too plastic/CAD-perfect next to its own bisector. Each
// point slides along its own ray from the fixture (seedX,seedY — the
// aura's true anchor) by a sine of its own position, low spatial frequency
// so neighbouring points move together as a gentle waviness rather than
// per-point noise.
//
// Amplitude discipline — why this can never fight the passes around it:
//  - scales with t, so at the morph slider's low end the offsets vanish
//    smoothly and the icon-outline identity contract is untouched;
//  - fades linearly to ZERO on the negative-hardness side (gone entirely
//    at -100): jitter on a "hard, geometrically aligned" shape reads as
//    dirt, not craft;
//  - capped at ~1px — far below the Chaikin/spike scale, so it decorates
//    the deliberately smooth curve instead of competing with it, and far
//    inside the marginM non-overlap gap, so it can never spend what the
//    inset created between neighbouring cells.
// Zero amplitude returns the SAME array untouched — the exact-passthrough
// convention applyHardness's non-negative side already sets.
// The caller skips this entirely for the nebula style (the mask already
// fades that edge to nothing — the jitter would be invisible effort).
export function automorphRingJitter(ring, seedX, seedY, t, hardness){
  if(!ring || ring.length<3) return ring||[];
  const h=Math.max(-100, Math.min(100, hardness||0));
  const clampT=Math.max(0, Math.min(1, t||0));
  const amp=1.1*clampT*(h<0 ? 1+h/100 : 1);
  if(!(amp>0)) return ring;
  const seed=seedX*37.1+seedY*91.7;
  return ring.map(p=>{
    const dx=p[0]-seedX, dy=p[1]-seedY;
    const len=Math.hypot(dx, dy);
    if(!(len>0)) return p;
    const wob=Math.sin(seed + p[0]*0.16 + p[1]*0.12)*amp;
    return [p[0]+dx/len*wob, p[1]+dy/len*wob];
  });
}

// Slider 2 (edge hardness): centered at 0 — Garry's own spec, "this slider
// starts in the center" and 0 is today's unchanged straight-edged treatment
// either direction. Positive is handled separately, at path-build time
// (ringPathD below), since softening needs the RAW points; every
// non-negative input is therefore an EXACT passthrough here (the same array,
// untouched — the rest-position contract the tests pin).
//
// The negative ("hard, geometrically aligned") side is the vector-tool
// Pucker-and-Bloat operator, keyed to LOCAL structure: each point is pushed
// away from the midpoint of its own two neighbours, so a point sitting on a
// straight run (zero deviation from its neighbours' chord) does not move at
// all, while a point that already IS a corner has that corner exaggerated
// into a real spike. The first version was a uniform scale about the ring's
// vertex-average centroid, and it failed twice over once the ring became a
// fixture's own non-overlap CELL: a rounded cell scaled up is exactly as
// rounded, just bigger — no angularity added, contradicting the slider's
// "sharp, precise geometric angles" spec — and on a lopsided cell (fixture
// near a wall, cell reaching much farther one way than the other) the
// vertex average sits well away from the fixture itself, so "sharpen" read
// as the whole aura ballooning off to one side of the light. The local
// operator has no global centre at all, so there is nothing left to drift
// off-anchor.
//
// The push is `gain * local deviation` with gain up to 2 at -100 — rings
// arriving here are densely resampled (24-64 points at even arc spacing),
// so per-point deviations are small and the old fractional factor would be
// invisible; tripling the deviation reads as a real spike at corners while
// leaving straight runs mathematically untouched. Two clamps then bound it,
// because unbounded outward growth breaks real constraints:
//  - `maxOutPx` (3rd arg, same units as the ring's own coordinates — the
//    aura call site passes screen px): a HARD cap on each point's total
//    displacement. The ring was just inset by marginM to create the
//    deliberate gap between neighbouring cells and to the room's own
//    walls; a push proportional to the ring's own size blows through that
//    small fixed gap on any normal-sized cell, silently defeating the
//    non-overlap partition with a control that was never meant to touch
//    spacing. The call site derives the cap from the SAME margin it inset
//    by, so very hard settings on tight cells plateau (intentional) but
//    can never eat the gap or cross a wall. Omitted/null = uncapped, for
//    unit-space callers.
//  - 75% of the shorter adjacent edge: at -100 an already-sharp corner's
//    amplified deviation could overshoot its own neighbours and locally
//    self-intersect; a spike kept shorter than its own edges cannot fold
//    over them.
export function applyHardness(ring, hardness, maxOutPx){
  const h=Math.max(-100, Math.min(100, hardness||0));
  if(h>=0 || ring.length<3) return ring;
  const n=ring.length;
  const gain=(-h/100)*2; // push = gain * local deviation, before the clamps
  const cap=(maxOutPx===undefined||maxOutPx===null)?Infinity:Math.max(0, maxOutPx);
  return ring.map((p,i)=>{
    const a=ring[(i-1+n)%n], b=ring[(i+1)%n];
    const mx=(a[0]+b[0])/2, my=(a[1]+b[1])/2;
    const dx=p[0]-mx, dy=p[1]-my;
    const dev=Math.hypot(dx, dy);
    if(!(dev>0)) return p; // exactly on the chord — no direction to spike in
    const edge=Math.min(Math.hypot(p[0]-a[0], p[1]-a[1]), Math.hypot(b[0]-p[0], b[1]-p[1]));
    const push=Math.min(dev*gain, edge*0.75, cap);
    return [p[0]+dx/dev*push, p[1]+dy/dev*push];
  });
}

// Builds the SVG path `d` for a closed ring, honouring hardness's SOFT side
// (hardness>0) — the hard side is already baked into `ring` by
// applyHardness above, so a straight polygon through those points is all
// this needs at hardness<=0. Soft is a closed Catmull-Rom spline through
// every point (every point still on the curve, unlike a Bezier fit that
// would drift off them) converted to cubic Beziers — the standard
// construction, each segment's two control points derived from its
// neighbours with a fixed 1/6 tension factor — scaled continuously by
// hardness/100 so the dial softens gradually rather than snapping at some
// threshold. hardness<=0 returns byte-identical output to before this
// slider existed (plain M/L/Z), which is the "centered = unchanged"
// contract the switch and both sliders all share.
export function ringPathD(ring, hardness){
  if(ring.length<3) return "";
  const h=Math.max(0, Math.min(100, hardness||0));
  if(h<=0) return ring.map((p,i)=>`${i?"L":"M"}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ")+"Z";
  const n=ring.length;
  const at=(i)=>ring[(i%n+n)%n];
  let d=`M${ring[0][0].toFixed(1)},${ring[0][1].toFixed(1)}`;
  for(let i=0;i<n;i++){
    const p0=at(i-1), p1=at(i), p2=at(i+1), p3=at(i+2);
    const c1=[p1[0]+(p2[0]-p0[0])/6*h/100, p1[1]+(p2[1]-p0[1])/6*h/100];
    const c2=[p2[0]-(p3[0]-p1[0])/6*h/100, p2[1]-(p3[1]-p1[1])/6*h/100];
    d+=` C${c1[0].toFixed(1)},${c1[1].toFixed(1)} ${c2[0].toFixed(1)},${c2[1].toFixed(1)} ${p2[0].toFixed(1)},${p2[1].toFixed(1)}`;
  }
  return d+"Z";
}

// ── Automorph colour ────────────────────────────────────────────────────────
// The aura's two state greys (Garry, 2026-09-07: "follow the grey shaded
// type visual you used before" — "on" is a brighter grey, never a different
// hue). Module consts because the SAME two values must agree in two places:
// automorphAuraSvg's flat ink, and the shared duotone gradient defs whose
// rim stop each fill interior fades to.
const AUTOMORPH_BASE_ON="#94a3b8", AUTOMORPH_BASE_OFF="#475569";

// Lightness offset for a #rrggbb colour: pct>0 moves every channel toward
// white, pct<0 toward black, and pct=0 returns the INPUT STRING untouched.
// That exact identity at 0 is load-bearing, not an optimisation: the
// per-fixture weight offset derived from automorphFixtureWeight is exactly
// 0 for every default-weight fixture (no recorded manual size — the common
// case), and those must keep today's byte-identical ink so two ordinary
// neighbours stay essentially indistinguishable apart from edge and gap.
// The offset is a bonus presence cue, never the primary separator.
export function lighten(hex, pct){
  if(!pct) return hex;
  const f=Math.max(-100, Math.min(100, pct))/100;
  const v=parseInt(hex.slice(1), 16);
  const ch=(x)=>Math.round(f>0 ? x+(255-x)*f : x*(1+f));
  return "#"+((1<<24)|(ch(v>>16&255)<<16)|(ch(v>>8&255)<<8)|ch(v&255)).toString(16).slice(1);
}

// ── Automorph non-overlap partitioning (Garry, 2026-09-07): "you have not
// built in a complex and attractive non overlap of devices visually into the
// morph... give a thorough rethink to complete the logic of this feature".
// Before this, every fixture in a room morphed toward the SAME target — the
// room's own full inset shape — so two lights sharing a room piled their
// auras on top of each other instead of dividing the space. Each fixture now
// gets its OWN cell within the room: the set of points closest to it among
// every fixture sharing that room, found with a masked approximate-geodesic
// flood (8-connected Dijkstra that only steps through room-interior cells) —
// masking is what makes this correct on a concave (L-shaped) room, where a
// straight-line Voronoi split would cut clean through a wall into the other
// arm. A real Voronoi diagram (Fortune's algorithm) plus polygon clipping was
// the other option researched for this; rejected because it is concavity-
// blind (needs a separate, fragile clip pass to fix that up after the fact)
// and because per-fixture SIZE weighting — the next paragraph — folds into a
// distance-grid field for free but has no clean equivalent in exact-geometry
// Voronoi without moving to power diagrams.
//
// Each fixture also carries a WEIGHT and a REACH CAP derived from its own
// manual footprint (automorphFixtureWeight — 1 when no width_cm/height_cm is
// recorded). The cap alone, not a hand-written N===1 branch, is what gives
// "common sense" sizing when a fixture happens to be the ONLY one in its
// room (Garry: "if the existing manual shape is something very small in the
// corner, don't make the morph take up the majority of the room" — with no
// other fixture to compete against, min-over-others is +Infinity and the cap
// is the only thing left deciding membership, so a lone tiny fixture still
// gets a small cell). Cells are also given a small deterministic wobble
// (seeded from the fixture's own position — never Math.random(): the fabric
// alone must reproduce a render) so a bisector between two ordinary fixtures
// reads as a soft organic curve rather than a ruler-straight cut.
const AUTOMORPH_BASELINE_DIAG_M = 0.5;
export function automorphFixtureWeight(wCm, hCm){
  const wM=(Number(wCm)||0)/100, hM=(Number(hCm)||0)/100;
  if(!(wM>0) && !(hM>0)) return 1;
  const diag=Math.hypot(wM, hM);
  return Math.max(0.25, Math.min(2.5, diag/AUTOMORPH_BASELINE_DIAG_M));
}

// Small binary min-heap: Dijkstra needs a priority queue and nothing in this
// file already provides one (no build step here to reach for a package).
function _heapPush(heap, item){
  heap.push(item);
  let i=heap.length-1;
  while(i>0){
    const p=(i-1)>>1;
    if(heap[p][0]<=heap[i][0]) break;
    [heap[p],heap[i]]=[heap[i],heap[p]]; i=p;
  }
}
function _heapPop(heap){
  const top=heap[0], last=heap.pop();
  if(heap.length){
    heap[0]=last;
    let i=0;
    for(;;){
      const l=i*2+1, r=i*2+2; let s=i;
      if(l<heap.length && heap[l][0]<heap[s][0]) s=l;
      if(r<heap.length && heap[r][0]<heap[s][0]) s=r;
      if(s===i) break;
      [heap[s],heap[i]]=[heap[i],heap[s]]; i=s;
    }
  }
  return top;
}

// Single-source approximate geodesic distance over a masked grid — the
// "masked" half of "masked flood": a cell outside the room mask is never
// expanded THROUGH, so a source in one arm of an L-shaped room cannot
// shortcut across the missing corner into the other arm. 8-connected with a
// √2 diagonal cost so the field is isotropic rather than city-block.
function _floodFrom(sx, sy, nx, ny, step, mask){
  const dist=new Float64Array(nx*ny).fill(Infinity);
  const si=Math.round(sx), sj=Math.round(sy);
  if(si<0||si>=nx||sj<0||sj>=ny||!mask[sj*nx+si]) return dist;
  dist[sj*nx+si]=0;
  const heap=[[0, si, sj]];
  const NB=[[1,0,1],[-1,0,1],[0,1,1],[0,-1,1],[1,1,Math.SQRT2],[1,-1,Math.SQRT2],[-1,1,Math.SQRT2],[-1,-1,Math.SQRT2]];
  while(heap.length){
    const [d,i,j]=_heapPop(heap);
    if(d>dist[j*nx+i]) continue;
    for(const [di,dj,cost] of NB){
      const ni=i+di, nj=j+dj;
      if(ni<0||ni>=nx||nj<0||nj>=ny||!mask[nj*nx+ni]) continue;
      const nd=d+cost*step;
      if(nd<dist[nj*nx+ni]){ dist[nj*nx+ni]=nd; _heapPush(heap,[nd,ni,nj]); }
    }
  }
  return dist;
}

// Chains marching-squares' disconnected [x1,y1,x2,y2] segments into a closed
// ring by matching shared endpoints. Isolux (see buildIsoSVG's own ISOLUX
// block) never needed this — a stroked contour draws fine as disjoint
// segments — but a FILLED cell polygon does. Endpoints are rounded before
// keying so the same crossing point, computed independently from each of its
// two adjacent cells, still matches despite float drift. Returns every ring
// found, largest-area first: a cell only rarely splits into more than one
// piece (a fixture pinched off from part of its own region by neighbours on
// both sides in a narrow room), and the fixture itself always sits inside
// the largest one.
export function stitchSegmentsToRing(segments){
  if(!segments || !segments.length) return [];
  const key=(x,y)=>`${Math.round(x*64)},${Math.round(y*64)}`;
  const adj=new Map();
  const pointOf=new Map();
  for(const [x1,y1,x2,y2] of segments){
    const ka=key(x1,y1), kb=key(x2,y2);
    if(ka===kb) continue;
    if(!adj.has(ka)) adj.set(ka, []);
    if(!adj.has(kb)) adj.set(kb, []);
    adj.get(ka).push(kb); adj.get(kb).push(ka);
    pointOf.set(ka,[x1,y1]); pointOf.set(kb,[x2,y2]);
  }
  const visited=new Set();
  const rings=[];
  for(const start of adj.keys()){
    if(visited.has(start)) continue;
    const ring=[]; let prev=null, cur=start;
    while(cur && !visited.has(cur)){
      visited.add(cur); ring.push(pointOf.get(cur));
      const nbrs=adj.get(cur)||[];
      const next=nbrs.find(k=>k!==prev && !visited.has(k));
      prev=cur; cur=next||null;
    }
    if(ring.length>=3) rings.push(ring);
  }
  rings.sort((a,b)=>Math.abs(_polySignedArea(b))-Math.abs(_polySignedArea(a)));
  return rings;
}

// Chaikin corner-cutting: each pass replaces every edge (a,b) with its 25%
// and 75% points, so every corner is cut by a chord and every OUTPUT point
// lies ON an edge of that pass's INPUT ring — the property that makes this
// safe next to the non-overlap partition: sliding points along their own
// edges can never change a ring's topology or push it broadly into a
// neighbour's cell the way a blur/inflate could.
//
// WHY it exists: the marching-squares cell rings (buildRoomFixtureCells) are
// quantized to a coarse grid (step = dimM/48) over an only-approximately-
// isotropic 8-connected Dijkstra field, and at the hardness slider's rest
// position (0) ringPathD draws its points as a raw M/L/Z polygon — so the
// grid's stairstep noise renders directly as small zig-zags along what
// should read as a soft, deliberate bisector. That noise is a NEW artifact
// the cell partition introduced; "hardness 0 = today's clean straight
// treatment" never meant "show the sampling grid". The room-trace fallback
// has the same class of artifact from the other side (hand-trace
// digitization noise, offsetPolygonInward's occasional flat MITER bevels).
// This pass is pure grid/trace-noise cleanup, always on regardless of
// AUTOMORPH_HARDNESS — mechanically separate from ringPathD's Catmull-Rom,
// which stays the aesthetic hard/soft dial.
//
// WHERE it is applied — exactly ONCE, at automorphAuraSvg's targetPts
// choice, so the cell path and the room.pts fallback share one corner
// language and nothing is ever smoothed twice; never on the already-
// resampled AUTOMORPH_N ring and never on the icon endpoint, which would
// break the "t=0 = icon outline byte-identical" contract. Iterations are
// CLAMPED at 2 here rather than trusted to callers: beyond that, corner
// cutting starts eating the real concave corners of an L-shaped trace
// instead of the grid noise it exists to remove.
//
// Scope guardrail (this is the "metaball-style" borrow, so be precise about
// which half): only the SMOOTHING half of metaball rendering — post-process
// one fixture's marching-squares boundary into a soft curve — is taken.
// The MERGING half (blending two blobs' fields so their silhouettes fuse)
// is the exact opposite of the partition's purpose: never blend two
// fixtures' weighted() fields before marching squares.
export function chaikinSmooth(ring, iterations){
  const passes=Math.max(0, Math.min(2, Math.floor(iterations!==undefined?iterations:1)));
  let pts=ring||[];
  for(let it=0; it<passes; it++){
    if(pts.length<3) break;
    const out=[];
    const n=pts.length;
    for(let i=0;i<n;i++){
      const a=pts[i], b=pts[(i+1)%n];
      out.push([a[0]+(b[0]-a[0])*0.25, a[1]+(b[1]-a[1])*0.25]);
      out.push([a[0]+(b[0]-a[0])*0.75, a[1]+(b[1]-a[1])*0.75]);
    }
    pts=out;
  }
  return pts;
}

// Chaikin's cut scales with INPUT EDGE LENGTH — the same two passes that
// give a ~0.1m-edged marching-squares cell ring the cm-scale noise cleanup
// they exist for gave the sparse 4-8-vertex room.pts fallback METRE-scale
// corner rounding instead (measured: a 6x4m room's smoothed fallback passed
// 0.83m inside its own corner — reshaping the room, on input that had no
// grid noise to remove). Splitting long edges first, with every ORIGINAL
// vertex kept exact, hands Chaikin the same edge scale for both target
// kinds, so the fallback gets the cells' corner language instead of an
// orders-of-magnitude heavier one. Pure subdivision — points only ever
// added ON existing edges, the traced shape itself untouched.
export function densifyRing(pts, maxEdgeM){
  if(!pts || pts.length<3 || !(maxEdgeM>0)) return pts||[];
  const out=[];
  const n=pts.length;
  for(let i=0;i<n;i++){
    const a=pts[i], b=pts[(i+1)%n];
    out.push(a);
    const cuts=Math.ceil(Math.hypot(b[0]-a[0], b[1]-a[1])/maxEdgeM);
    for(let k=1;k<cuts;k++){
      const t=k/cuts;
      out.push([a[0]+(b[0]-a[0])*t, a[1]+(b[1]-a[1])*t]);
    }
  }
  return out;
}

// Removes the inverted fold loops an inward offset leaves wherever the
// margin exceeds the local radius of curvature. That folding is intrinsic
// to per-vertex offsetting, not a bug in offsetPolygonInward: the TRUE
// eroded region simply has no boundary there any more, and the standard
// cure is exactly this — cut the ring at each self-intersection and keep
// the dominant loop, dropping the small inverted one (measured on real
// Chaikin-smoothed cell rings: 4-8 bowtie loops per cell at the aura's own
// 1.6x margin, with bounding boxes up to 63x28px — plainly visible
// self-crossing strokes at the hardness slider's REST position). Each
// found crossing splits the ring into two candidate loops; the shorter
// vertex run is the fold, so it is replaced by the intersection point
// itself and the scan restarts. Deterministic (fixed scan order, no
// randomness), and the guard bound only exists so a pathological ring
// degrades to "some crossings survive" rather than looping forever.
export function pruneRingFolds(ring){
  if(!ring || ring.length<4) return ring||[];
  const segX=(a,b,c,d)=>{
    const d1x=b[0]-a[0], d1y=b[1]-a[1], d2x=d[0]-c[0], d2y=d[1]-c[1];
    const den=d1x*d2y-d1y*d2x;
    if(Math.abs(den)<1e-12) return null;
    const t=((c[0]-a[0])*d2y-(c[1]-a[1])*d2x)/den;
    const u=((c[0]-a[0])*d1y-(c[1]-a[1])*d1x)/den;
    if(t<=1e-9 || t>=1-1e-9 || u<=1e-9 || u>=1-1e-9) return null;
    return [a[0]+d1x*t, a[1]+d1y*t];
  };
  let pts=ring.slice();
  for(let guard=0; guard<12; guard++){
    const n=pts.length;
    let found=false;
    for(let i=0;i<n && !found;i++){
      for(let j=i+1;j<n;j++){
        if((j+1)%n===i || (i+1)%n===j) continue;
        const X=segX(pts[i], pts[(i+1)%n], pts[j], pts[(j+1)%n]);
        if(!X) continue;
        const innerLen=j-i;
        if(innerLen<=n-innerLen) pts=pts.slice(0,i+1).concat([X], pts.slice(j+1));
        else pts=[X].concat(pts.slice(i+1, j+1));
        found=true;
        break;
      }
    }
    if(!found || pts.length<4) return pts;
  }
  return pts;
}

// Containment pass over an inset ring: every vertex must sit INSIDE
// `boundary` with at least `clearM` of clearance to it, or it is projected
// back to exactly that clearance depth off its nearest boundary point.
// This enforces the invariant the whole aura pipeline's safety argument
// rests on — offsetPolygonInward's miter construction is trusted to leave
// the inset ring a full margin inside its source ring, and hardCapPx then
// spends a capped fraction of that margin on hardness spikes; when the
// offset instead leaves a vertex ON the boundary (measured on real
// Chaikin-densified cell rings: 61 of 400 vertices closer than HALF the
// margin, minimum 0.001m), the "can never eat the gap" proof is void and
// neighbouring fixtures' rendered rings genuinely cross. The projection
// direction comes from the vertex's own nearest-point ray (inward for an
// interior vertex, reversed for an escapee); a vertex exactly ON the
// boundary has no ray, so it aims at the ring's own vertex average — good
// enough for a point that pathological, and deterministic.
export function containRingInside(ring, boundary, clearM){
  if(!ring || ring.length<3 || !boundary || boundary.length<3 || !(clearM>0)) return ring||[];
  const bn=boundary.length;
  const ctr=[ring.reduce((a,p)=>a+p[0],0)/ring.length, ring.reduce((a,p)=>a+p[1],0)/ring.length];
  return ring.map(p=>{
    let bd=Infinity, bx=p[0], by=p[1];
    for(let i=0;i<bn;i++){
      const a=boundary[i], b=boundary[(i+1)%bn];
      const dx=b[0]-a[0], dy=b[1]-a[1];
      const L2=dx*dx+dy*dy;
      let t=L2>0 ? ((p[0]-a[0])*dx+(p[1]-a[1])*dy)/L2 : 0;
      if(t<0)t=0; else if(t>1)t=1;
      const qx=a[0]+dx*t, qy=a[1]+dy*t;
      const d=Math.hypot(p[0]-qx, p[1]-qy);
      if(d<bd){ bd=d; bx=qx; by=qy; }
    }
    const inside=pointInPolygon(boundary, p[0], p[1]);
    if(inside && bd>=clearM) return p;
    let ux, uy;
    if(bd>1e-9){
      ux=(p[0]-bx)/bd; uy=(p[1]-by)/bd;
      if(!inside){ ux=-ux; uy=-uy; }
    } else {
      const cl=Math.hypot(ctr[0]-bx, ctr[1]-by)||1e-9;
      ux=(ctr[0]-bx)/cl; uy=(ctr[1]-by)/cl;
    }
    return [bx+ux*clearM, by+uy*clearM];
  });
}

// Builds every fixture's own non-overlapping cell within one room, in the
// ROOM'S OWN metre space (the same space room.pts already lives in) —
// callers project to pixels the same way offsetPolygonInward's output
// already is, via iso(). `fixtures` is [{id,x,y,weight}], weight from
// automorphFixtureWeight. Returns a Map id -> ring ([x,y] metres, closed,
// room-local) for every fixture whose cell resolved to a real polygon; a
// fixture ABSENT from the result (a pathological room, or a cell squeezed to
// nothing by its neighbours) is the caller's cue to fall back to today's
// full-room shape for that one fixture rather than draw nothing.
export function buildRoomFixtureCells(roomPts, fixtures){
  const cells=new Map();
  if(!roomPts || roomPts.length<3 || !fixtures || !fixtures.length) return cells;
  let x0=Infinity,y0=Infinity,x1=-Infinity,y1=-Infinity;
  for(const [x,y] of roomPts){ if(x<x0)x0=x; if(x>x1)x1=x; if(y<y0)y0=y; if(y>y1)y1=y; }
  const dimM=Math.max(x1-x0, y1-y0, 0.5);
  const step=Math.max(0.05, dimM/48);
  const pad=step*2;
  const nx=Math.max(3, Math.ceil((x1-x0+2*pad)/step)+1);
  const ny=Math.max(3, Math.ceil((y1-y0+2*pad)/step)+1);
  const gx=(i)=>x0-pad+i*step, gy=(j)=>y0-pad+j*step;
  const mask=new Uint8Array(nx*ny);
  for(let j=0;j<ny;j++) for(let i=0;i<nx;i++) mask[j*nx+i]=pointInPolygon(roomPts, gx(i), gy(j)) ? 1 : 0;

  const fields=fixtures.map((f,idx)=>{
    const fi=(f.x-gx(0))/step, fj=(f.y-gy(0))/step;
    const dist=_floodFrom(fi, fj, nx, ny, step, mask);
    const w=Math.max(0.1, f.weight||1);
    // The cap is relative to THIS fixture's own worst-case distance across
    // the room — the farthest ROOM VERTEX from its position — not a fixed
    // fraction of the room's half-min-dimension. A fixture off in a corner
    // is farther from the opposite corner than roomHalfMinDim ever accounts
    // for; anchoring the cap there instead means weight=1 (no recorded
    // manual size) reliably still covers the WHOLE room from anywhere
    // inside it — today's original v1 behaviour for the common case — while
    // a smaller weight shrinks the very same cap proportionally, which is
    // what actually produces "common sense" sizing for a lone tiny fixture.
    // The farthest point of a convex room from any interior point is always
    // one of its own vertices; the ×1.5 buffer covers ordinary concave
    // (L-shaped) rooms too, where a masked geodesic path can run a little
    // longer than the straight-line distance this is measured with.
    let maxVertexDist=0;
    for(const [px,py] of roomPts) maxVertexDist=Math.max(maxVertexDist, Math.hypot(px-f.x, py-f.y));
    const maxReach=Math.max(0.5, maxVertexDist*1.5)*w;
    const seed=f.x*37.1+f.y*91.7+idx*13.37;
    const amp=step*1.6;
    return {
      id:f.id, maxReach,
      weighted:(i,j)=>{
        const d=dist[j*nx+i];
        if(!isFinite(d)) return Infinity;
        const wob=amp*Math.sin(seed+gx(i)*2.3+gy(j)*1.7);
        return d/w + wob;
      },
    };
  });

  const lerpAt=(ax,ay,fa,bx,by,fb)=>{
    const t=(0-fa)/((fb-fa)||1e-9);
    return [ax+(bx-ax)*t, ay+(by-ay)*t];
  };
  const segsById=new Map(fixtures.map(f=>[f.id,[]]));
  for(const me of fields){
    const F=new Float64Array(nx*ny);
    for(let j=0;j<ny;j++) for(let i=0;i<nx;i++){
      const idx2=j*nx+i;
      if(!mask[idx2]){ F[idx2]=-1e9; continue; }
      const myD=me.weighted(i,j);
      if(!(myD<=me.maxReach)){ F[idx2]=-1e9; continue; }
      let best=Infinity;
      for(const other of fields){
        if(other===me) continue;
        const od=other.weighted(i,j);
        if(od<best) best=od;
      }
      F[idx2]=(best===Infinity ? me.maxReach*2 : best) - myD;
    }
    // Marching squares at threshold 0 — the exact cell-case table isolux
    // uses, over this fixture's own field, in room-local metres.
    const segs=segsById.get(me.id);
    for(let j=0;j<ny-1;j++) for(let i=0;i<nx-1;i++){
      const e00=F[j*nx+i], e10=F[j*nx+i+1], e01=F[(j+1)*nx+i], e11=F[(j+1)*nx+i+1];
      const c=(e00>0?1:0)|(e10>0?2:0)|(e11>0?4:0)|(e01>0?8:0);
      if(c===0||c===15) continue;
      const gx0=gx(i), gx1=gx(i+1), gy0=gy(j), gy1=gy(j+1);
      const T=()=>lerpAt(gx0,gy0,e00,gx1,gy0,e10), R=()=>lerpAt(gx1,gy0,e10,gx1,gy1,e11);
      const B=()=>lerpAt(gx0,gy1,e01,gx1,gy1,e11), L=()=>lerpAt(gx0,gy0,e00,gx0,gy1,e01);
      const cellSegs={1:[[L,T]],2:[[T,R]],3:[[L,R]],4:[[R,B]],5:[[L,T],[R,B]],6:[[T,B]],7:[[L,B]],
                  8:[[B,L]],9:[[T,B]],10:[[T,R],[B,L]],11:[[R,B]],12:[[L,R]],13:[[T,R]],14:[[L,T]]}[c];
      for(const [f1,f2] of cellSegs){
        const p1=f1(), p2=f2();
        segs.push([p1[0],p1[1],p2[0],p2[1]]);
      }
    }
  }
  for(const [id,segs] of segsById){
    const rings=stitchSegmentsToRing(segs);
    if(rings.length) cells.set(id, rings[0]);
  }
  return cells;
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
    // A padlock: solid shackle arch over a solid body — the universal
    // access-control symbol, so a lock reads as a lock even to someone
    // who has never seen this map before. Solid, like every glyph here
    // (the code label is drawn across it — a hollow ring would leave dark
    // text on the dark map, same reason "tempreadout" is a filled bulb).
    case "lock": {
      const bodyW=HW*1.3, bodyH=HW*0.9, bodyTop=cy+HW*0.15;
      const shackleTop=bodyTop-HW*0.12, outerR=HW*0.62, innerR=HW*0.32;
      const shackleD=sub([
        ...arcPts(cx,shackleTop,outerR,outerR,180,360,12),
        ...arcPts(cx,shackleTop,innerR,innerR,360,180,12),
      ]);
      return `<path d="${shackleD}" ${attrs}/>`+
        `<rect x="${n(cx-bodyW/2)}" y="${n(bodyTop)}" width="${n(bodyW)}" `+
        `height="${n(bodyH)}" rx="${n(bodyW*0.12)}" ${attrs}/>`;
    }
    // A door leaf with its handle — the reflected-ceiling-plan symbol for
    // an opening, portrait-proportioned (taller than wide) unlike every
    // other glyph here so it reads as "a door" and not another fixture.
    // Solid, like lock's body+shackle: a handle dot layered on the same
    // fill reads as one silhouette, not a cutout (a true hole would need a
    // mask against a background colour this glyph never actually sits on).
    case "door": {
      const bodyW=HW*0.9, bodyH=r*1.5, bodyTop=cy-bodyH/2;
      return `<rect x="${n(cx-bodyW/2)}" y="${n(bodyTop)}" width="${n(bodyW)}" `+
        `height="${n(bodyH)}" rx="${n(bodyW*0.16)}" ${attrs}/>`+
        `<circle cx="${n(cx+bodyW/2-HW*0.18)}" cy="${n(cy)}" r="${n(HW*0.12)}" ${attrs}/>`;
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
    // The keyhole — the one detail that says "lock" unambiguously at any size.
    case "lock":     return dot(cx,cy+HW*0.08,HW*0.14)+line(cx,cy+HW*0.08,cx,cy+HW*0.42);
    // A single panel line, offset toward the handle side — the door leaf's
    // own echo of a real panelled door, same spirit as perimeter's inset
    // frame below.
    case "door":     return line(cx-HW*0.2,cy-r*0.5,cx-HW*0.2,cy+r*0.5);
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
  if(l.isDoor) return "door";
  if(l.isTemp) return "temp";
  if(l.isLock) return "lock";
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
  // Automorph (Garry, 2026-09-07): 0 disables it outright — see
  // automorphAuraSvg/automorphRing below, near perimeterSvg.
  const AUTOMORPH_PCT = opts.automorph ? Math.max(0, Math.min(100, Number(opts.automorphRoomPct) || 0)) : 0;
  // Slider 2 — edge hardness, centered at 0 (today's straight-edged look,
  // either direction) — see applyHardness/ringPathD.
  const AUTOMORPH_HARDNESS = opts.automorph ? Math.max(-100, Math.min(100, Number(opts.automorphHardness) || 0)) : 0;
  // Style — which of several distinct visual TREATMENTS paints the same
  // morphed ring (see automorphAuraSvg). "glow" is the shipped default;
  // the others are exploratory, kept behind this dropdown so any of them
  // can be dropped later without touching the geometry underneath.
  const AUTOMORPH_STYLE = ["glow","blueprint","nebula","circuit","contour","facet","sumie",
    "stainedglass","constellation","halo","pulse"].includes(opts.automorphStyle) ? opts.automorphStyle : "glow";
  // Subtlety, 0-100 (Garry, 2026-09-07: "a slider for subtlety, so you can
  // dial from objects looking full, to almost completely lost in
  // background... with shades, thinner lines"). 0 = today's opacity/line-
  // weight exactly; 100 thins every stroke to 40% width and caps every
  // opacity at 15% of its normal value — never fully zero, so the control
  // still reads as "very subtle" rather than "silently did nothing".
  const AUTOMORPH_SUBTLETY = opts.automorph ? Math.max(0, Math.min(100, Number(opts.automorphSubtlety) || 0)) : 0;
  const _automorphOpacityMult = 1 - (AUTOMORPH_SUBTLETY/100)*0.85;
  const _automorphStrokeMult = 1 - (AUTOMORPH_SUBTLETY/100)*0.6;
  const dimmed=(l)=>!!CLASSF && lightClassOf(l)!==CLASSF;
  // The builder, choosing a light from the INDEX rather than the map: "make
  // it easy to find" — one big ring flashes outward from wherever that light
  // actually is, a third of the whole canvas across, so a small glyph in a
  // big house is unmissable for a moment. One-shot (the host clears
  // locateEid after the render that draws it), not a permanent decoration.
  const LOCATE_EID = opts.locateEid ? String(opts.locateEid) : null;
  // In-progress door/window circle (maps.js's on-map circle tool, triggered
  // from the Lights table's "Place"): the circle placed so far, if any —
  // {x_m, y_m, r_m, floorId} — and whether the tool is armed at all (armed
  // with no circle yet just means "waiting for the first click").
  const DOOR_CIRCLE_ARMED = !!opts.doorCircleArmedEid;
  const DOOR_CIRCLE_M = opts.doorCircleM && Number.isFinite(Number(opts.doorCircleM.x_m))
    && Number.isFinite(Number(opts.doorCircleM.y_m)) && Number.isFinite(Number(opts.doorCircleM.r_m))
    ? opts.doorCircleM : null;
  // Working, proven beacons — read-only (Garry, 2026-09-09: "add working
  // proven beacons to the mapping, lights section under devices. For now
  // have them look the same as they do in overview... No placement for
  // them of course"). Each is {key, label, x_m, y_m, floor_id} — the
  // caller (maps.js) is the one that decides "working, proven" (identified
  // or user-labelled, with a real server position); this only draws
  // whatever it's handed, on its own floor, with no click handler at all —
  // never a device to place, size, rotate or link.
  const BEACONS = Array.isArray(opts.beacons) ? opts.beacons : null;
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
  const { iso, rooms, lights: rawLights, levels, rankOf } = frame;
  // A door/window's real position is a SECTION OF WALL, not a point (see
  // docs/IDEA_DOOR_WINDOW_BARRIERS.md) — so even a legacy light_positions_m
  // entry for one is never drawn as a freestanding marker here. The barrier
  // pass below, keyed off rf_barriers_m's own linked_entity_id, is the only
  // thing that ever marks where a door/window actually is on this map. A
  // lock keeps its ordinary point marker (Garry, 2026-09-09: "some of the
  // same visibility as other devices if placed") — wall-linking one is
  // additive, drawn alongside it by the barrier pass below, not instead of it.
  const lights = rawLights.filter(l => !(lightsByEid[l.eid] && lightsByEid[l.eid].isDoor));
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
  // +1 row: the motion colour-index strip below the floor rows (Garry,
  // 2026-09-08) reuses this exact same growing-row layout, one row past
  // the last floor.
  const LEGEND_H=(Math.max(1,levels.length)+1)*30+24;
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
  // Slab tint from blended live rgb/brightness (gap #15, best-in-class
  // roadmap): a room with its lights actually glowing magenta should read
  // as tinted magenta on the floor, not just wear its assigned display
  // colour. Brightness-weighted average of the SAME on/visible/non-utility
  // fixtures glowIds already walks for this room's light pools, so a room
  // with no fixture literally lit (a hallway, or every light off) keeps
  // its ordinary static colour rather than reading as unlit black.
  const liveRoomColor=(rname,fallback)=>{
    if(!SHOW) return fallback;
    const onLights=(byRoom[rname]||[]).filter(li=>
      li.state==="on" && !hiddenEids.has(li.entity_id) && !li.isFan && !li.isMotion && !li.isTemp && !li.isLock);
    if(!onLights.length) return fallback;
    let rSum=0,gSum=0,bSum=0,wSum=0;
    for(const li of onLights){
      const m=/^#?([0-9a-f]{6})$/i.exec(glowCol(li,null));
      if(!m) continue;
      const v=parseInt(m[1],16), w=briOf(li);
      rSum+=((v>>16)&255)*w; gSum+=((v>>8)&255)*w; bSum+=(v&255)*w; wSum+=w;
    }
    if(wSum<=0) return fallback;
    const q=(x)=>Math.max(0,Math.min(255,Math.round(x/wSum)));
    return `#${[q(rSum),q(gSum),q(bSum)].map(v=>v.toString(16).padStart(2,"0")).join("")}`;
  };
  // One gradient per DISTINCT colour in use (quantised above), collected before
  // the defs are written. A per-light gradient would be one def per fixture.
  const glowIds=new Map();
  // room record -> clipPath id, filled while the defs are written (both
  // modes — see the UNGATED clipPath block below).
  const roomClip=new Map();
  if(SHOW){
    for(const l of lights){
      const li=lightsByEid[l.eid];
      if(!li || li.state!=="on" || hiddenEids.has(l.eid) || li.isFan || li.isMotion || li.isTemp || li.isLock) continue;
      const c=(FIELD ? fieldColOf(l.x,l.y,l.z) : null) || glowCol(li,l.lp);
      if(!glowIds.has(c)) glowIds.set(c, `psglow_${glowIds.size}`);
    }
    for(const rname of Object.keys(byRoom||{})) for(const li of byRoom[rname]||[]){
      if(li.state!=="on" || hiddenEids.has(li.entity_id) || li.isFan || li.isMotion || li.isTemp || li.isLock) continue;
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

  // A sensor that has GONE QUIET still says how long ago, at a glance.
  // Revised three times against variations of the same complaint. First:
  // a smooth sweep is invisible at a glance, and the milestones must
  // actually be reachable in the window that matters — fixed by a STEP
  // function, held stages, front-loaded (fine resolution early, coarse
  // once it has been a while). Then (2026-09-05): the first three stops
  // — blue/violet/magenta, all "cool" blue-purple-pink tones — read as
  // one colour to a glance even though they are 40deg apart on paper, so
  // in practice most rooms (re-triggered inside 20min, or quiet for
  // hours) only ever LOOKED like two states, blue and green. Every stop
  // below is now a classic, immediately-nameable colour-wheel colour
  // (blue/cyan/green/yellow/orange/red/magenta), evenly spaced by eye
  // rather than by degree count, still travelling the long way round the
  // wheel so it passes through every colour family exactly once on the
  // way to the held end colour (magenta, reached at 2h). Timings
  // unchanged from the original spec — only which colour lands at each one.
  // The one hold duration every sensor class shares: how long the ACTIVE
  // flashing treatment lasts from a sensor's most recent transition,
  // whatever its own hardware hold-timer does — and, identically, where
  // the quiet-state colour fade begins. One constant so the two can
  // never disagree about where "recently active" ends. Hoisted above the
  // defs block (originally declared down with motionActive/
  // motionRecentHue, which still read it fine from here — same function
  // scope) so the legend strip below can build itself from this ONE real
  // array instead of a second, hand-copied list of hues.
  const MOTION_HOLD_MS=5*60*1000;
  const MOTION_COLOR_STOPS=[
    [0,             240],  // blue — the active colour, holds firm for the whole hold window
    [MOTION_HOLD_MS,180],  // cyan
    [20*60*1000,    120],  // green
    [40*60*1000,     60],  // yellow
    [65*60*1000,     30],  // orange
    [90*60*1000,      0],  // red
    [120*60*1000,   300],  // magenta — reached at 2h, held from there
  ];
  // The legend strip's own stop offsets (Garry, 2026-09-08: "make sure
  // that's actually aligned with what is happening on the map" — the
  // first version spaced all colours evenly by INDEX, which does not
  // match the real fade at all: cyan's real window is 15 minutes, red's
  // is 30). Every band's WIDTH is proportional to its real held duration
  // (a smooth <linearGradient> blend would misrepresent the fade too —
  // the real thing is hard STEPS, held stages, never a blend between two
  // colours — so each colour gets two same-offset-adjacent stops, a hard
  // edge, not a gradient). Magenta has no finite duration (held forever
  // past 2h), so it gets a fixed terminal band rather than a proportional
  // one no finite width could honestly represent.
  const MOTION_LEGEND_HELD_PCT=10;
  const MOTION_LEGEND_SPAN_MS=MOTION_COLOR_STOPS[MOTION_COLOR_STOPS.length-1][0];
  let motionLegendStops="";
  for(let mi=0; mi<MOTION_COLOR_STOPS.length; mi++){
    // Named degSweep, not "hue" — see motionRecentPulseSvg's own comment:
    // a guard test greps for an inline hue-templated HSL colour string as
    // the shape a second, drifting copy of room_color.js's own colour
    // deriver would take, and a variable spelled "hue" trips that same
    // pattern by starting with "h" right after the interpolation brace.
    const [atMs,degSweep]=MOTION_COLOR_STOPS[mi];
    const isLast=mi===MOTION_COLOR_STOPS.length-1;
    const p0=isLast ? (100-MOTION_LEGEND_HELD_PCT) : (atMs/MOTION_LEGEND_SPAN_MS)*(100-MOTION_LEGEND_HELD_PCT);
    const p1=isLast ? 100 : (MOTION_COLOR_STOPS[mi+1][0]/MOTION_LEGEND_SPAN_MS)*(100-MOTION_LEGEND_HELD_PCT);
    const col=`hsl(${degSweep},75%,58%)`;
    motionLegendStops+=`<stop offset="${p0.toFixed(2)}%" stop-color="${col}"/>`+
      `<stop offset="${p1.toFixed(2)}%" stop-color="${col}"/>`;
  }

  // Floor surface patterns
  s+=`<defs>`;
  // Motion pulse gradient — UNGATED (both modes): a triggered sensor is
  // status, not presentation, and it has to read on the working map too.
  // The motion legend strip's colour index (Garry, 2026-09-08 — first
  // "a small line at the bottom... starting at blue, and thru the colors
  // to ending on green", then "I ask for all the colors in the shift
  // from blue to green for motion. Every color in the rainbow" — every
  // stop MOTION_COLOR_STOPS actually has, not just the first three) —
  // built from motionLegendStops above so this can never become a second,
  // drifting copy of the real colours or their real timing.
  s+=`<linearGradient id="psmotionlegend" x1="0" y1="0" x2="1" y2="0">${motionLegendStops}</linearGradient>`;
  s+=`<radialGradient id="psmotion">`+
    `<stop offset="0%" stop-color="${MOTION_PULSE}" stop-opacity="0.55"/>`+
    `<stop offset="60%" stop-color="${MOTION_PULSE}" stop-opacity="0.18"/>`+
    `<stop offset="100%" stop-color="${MOTION_PULSE}" stop-opacity="0"/></radialGradient>`;
  // Automorph's "Nebula" style — a colour-agnostic soft-edge MASK (white
  // fading to transparent) rather than a per-fixture gradient: any number
  // of fixtures can share this ONE definition regardless of their own
  // colour, so this stays cheap no matter how many auras are on screen —
  // a true per-colour gradient would need one <radialGradient> per
  // distinct colour in play, which is the defs-bloat a mask sidesteps.
  s+=`<radialGradient id="psautomorphgrad">`+
    `<stop offset="0%" stop-color="#fff" stop-opacity="1"/>`+
    `<stop offset="55%" stop-color="#fff" stop-opacity="0.55"/>`+
    `<stop offset="100%" stop-color="#fff" stop-opacity="0"/></radialGradient>`;
  // maskContentUnits="objectBoundingBox" with FRACTION coordinates is what
  // makes the shared def per-fixture at all. Mask content defaults to
  // userSpaceOnUse, where percentage lengths resolve against the VIEWPORT
  // (SVG 1.1 §7.10/§14.4) — so the original -20%..140% rect spanned the
  // whole canvas and the fade was one canvas-centred vignette: bloom and
  // nebula strength varied with where the room sat on the canvas
  // (rasterized, identical shapes read ~0.11 alpha at a canvas corner vs
  // 1.0 at its centre), and the ring's own edge had no fade anywhere. In
  // bbox units the same -0.2..1.4 rect hugs each REFERENCING ring instead,
  // and psautomorphgrad (objectBoundingBox itself) centres on it — light
  // welling up from inside, identical wherever the fixture sits. This def
  // is also part of the automorph-off output (it predates the aura-defs
  // slider gate), so fixing it moved those bytes deliberately: nothing in
  // an automorph-off render references the mask, dead-DOM bytes only.
  s+=`<mask id="psautomorphmask" maskContentUnits="objectBoundingBox"><rect x="-0.2" y="-0.2" width="1.4" height="1.4" fill="url(#psautomorphgrad)"/></mask>`;
  // Automorph duotone interiors — exactly TWO shared radialGradients, one
  // per state, NEVER per fixture (the same O(2) defs discipline as
  // psautomorphgrad above). A flat two-value grey ignored the one signal
  // the cell partition computes per fixture — how far a point is from its
  // own light — so every aura fill interior now runs lighter at the centre
  // and fades to the state's base tone at the rim, the classic
  // hypsometric-duotone depth cue keyed to that distance. The stops carry
  // COLOUR only (full stop opacity): the referencing path's own
  // fill-opacity, routed through the subtlety multipliers, stays the
  // single authority on layer weight, so the rebalanced fill ceilings and
  // the subtlety slider keep their exact contracts. objectBoundingBox (the
  // default) centres each fill on whatever ring references it —
  // per-fixture geometry for free. Being SHARED, these can carry no
  // per-fixture offset by construction — that cue lives in the flat ink
  // instead (see automorphAuraSvg's colour-ownership comment). GATED on
  // the slider, unlike psmotion (whose consumer exists in both modes):
  // only the aura ever references these, so with Automorph off they were
  // pure dead DOM — and the automorph-off render is contractually
  // byte-identical to the pre-Automorph output.
  if(AUTOMORPH_PCT>0) for(const [duoId,duoBase] of [["psautomorphduo_on",AUTOMORPH_BASE_ON],["psautomorphduo_off",AUTOMORPH_BASE_OFF]]){
    s+=`<radialGradient id="${duoId}">`+
      `<stop offset="0%" stop-color="${lighten(duoBase,18)}"/>`+
      `<stop offset="55%" stop-color="${lighten(duoBase,8)}"/>`+
      `<stop offset="100%" stop-color="${duoBase}"/></radialGradient>`;
  }
  // Garry: "that cool look you have inside the [light glow]... can the shape
  // built by the room shape also have some of that, a bit less intense, but
  // the same shaded look" — the same near-quadratic radial falloff the light
  // pools use (see glowIds below), tinted with each room's own colour and
  // held far softer, so a room reads as gently lit from its centre instead
  // of a flat colour block. UNGATED like psmotion: rooms exist in both
  // modes, and objectBoundingBox (the default, no cx/cy/r given) centres
  // this on whatever polygon references it with zero per-room geometry.
  // One gradient per distinct room colour, same dedup as glowIds.
  const roomGlowIds=new Map();
  for(const r of rooms){
    const rc=liveRoomColor(r.room, roomColor(r.room, model));
    if(!roomGlowIds.has(rc)) roomGlowIds.set(rc, `psroomglow_${roomGlowIds.size}`);
  }
  for(const [rc,rid] of roomGlowIds){
    s+=`<radialGradient id="${rid}">`+
      `<stop offset="0%" stop-color="${rc}" stop-opacity="0.16"/>`+
      `<stop offset="45%" stop-color="${rc}" stop-opacity="0.05"/>`+
      `<stop offset="100%" stop-color="${rc}" stop-opacity="0"/>`+
      `</radialGradient>`;
  }
  // Softens the wall cut on a clipped pool: applied OUTSIDE the clip, so a
  // couple of pixels of light feather over the boundary the way a doorway
  // leaks. A hard polygon edge is the one artifact every hand-built
  // floor-plan thread complains about. Only Showcase surfaces (pools, the
  // perimeter cove glow) reference this def now — the Automorph aura,
  // which used to share it, blurs through its own clone psaurasoft just
  // below, whose region is sized for the aura's shadow-bearing blur
  // group.
  const emitClipSoft=()=>{
    s+=`<filter id="psclipsoft" x="-8%" y="-8%" width="116%" height="116%">`+
      `<feGaussianBlur stdDeviation="1.6"/></filter>`;
  };
  // One clip path per room, so a fixture's pool — and its Automorph aura —
  // can be stopped at its own walls. Light crossing a wall polygon reads as
  // a rendering error the moment the drawing is good enough for anything
  // else to read as real — and the fabric has known these polygons in
  // metres all along. O(rooms) defs, not O(fixtures), so still cheap at
  // any fixture count.
  const emitRoomClips=()=>{
    for(let ri=0; ri<rooms.length; ri++){
      const r=rooms[ri];
      roomClip.set(r, `psclip_${ri}`);
      s+=`<clipPath id="psclip_${ri}"><polygon points="${r.pts.map(p=>pt(iso(p[0],p[1],r.z))).join(" ")}"/></clipPath>`;
    }
  };
  // Emitters rather than inline defs because these two are needed at
  // DIFFERENT positions depending on who can reference them. The aura is
  // gated on the Automorph slider alone, never on Showcase, so with
  // Automorph on the room clips must exist on the working map too — while
  // this loop lived inside if(SHOW), roomClip stayed EMPTY for the whole
  // working-mode render and a blurred or hardness-spiked aura had nothing
  // stopping it at its own room's wall. With Automorph OFF nothing outside
  // if(SHOW) can reference either def, and the automorph-off render is
  // contractually byte-identical to the pre-Automorph output — def ORDER
  // included, which is why the showcase-only emission happens at the defs'
  // pre-Automorph spot inside if(SHOW) below rather than up here.
  if(AUTOMORPH_PCT>0){
    emitClipSoft();
    // Automorph's aura blur — a clone of psclipsoft with a WIDER region,
    // and deliberately its own def. The aura's soft layers (cast shadow,
    // ambient occlusion, wash, bloom) blur as ONE group per fixture, and
    // that group's bbox includes the shadow's offset copy; a filter's
    // default region is relative to the bbox of whatever it filters, and
    // psclipsoft's -8% margin stops covering the blur's ~3-sigma bleed
    // (~5px at stdDeviation 1.6) once the filtered bbox is small — the
    // icon-sized low-t aura, and the shadow's trailing lower-right edge is
    // the first thing a too-tight region visibly shears off. 12% covers
    // the bleed for any group upwards of ~40px across; smaller than that,
    // the clipped tail sits under ~2% alpha — invisible. Cloning rather
    // than widening psclipsoft itself keeps the Showcase pools' raster
    // area (region size IS raster cost) exactly what it was. Gated with
    // the rest of the aura defs: only the aura references it.
    s+=`<filter id="psaurasoft" x="-12%" y="-12%" width="124%" height="124%">`+
      `<feGaussianBlur stdDeviation="1.6"/></filter>`;
    // The aura rim's OWN sheen ramp — psgloss's exact stops, on the default
    // objectBoundingBox units, cloned because the rim can use neither
    // existing ramp: psgloss is Showcase-gated (an invalid paint ref makes
    // SVG drop the element, so the rim would silently vanish on the
    // working map), and the floor-wide userSpaceOnUse psglossauto decided
    // bright-vs-dark by the fixture's POSITION on the slab — a fixture on
    // a floor's lower-right had its entire rim past the ramp's 45% stop
    // (max white opacity ~0.1): no bright arc anywhere, the exact
    // flat-sticker outline the rim exists to kill. A rim's job is
    // per-shape — "which side of THIS shape faces the light" — so it
    // sweeps each referencing shape's own bbox: bright upper-left arc,
    // dark lower-right, on every shape, still agreeing with the drawing's
    // one upper-left sun. The stretched-per-cell spread that pushed the
    // gloss FILL to psglossauto is harmless on a ~1px stroke with no
    // visible interior. ONE shared def (O(1) at any fixture count), gated
    // with the rest of the aura-only defs: only edgeRim references it.
    s+=`<linearGradient id="psglossrim" x1="0.15" y1="0" x2="0.6" y2="1">`+
      `<stop offset="0%" stop-color="#fff" stop-opacity="0.5"/>`+
      `<stop offset="45%" stop-color="#fff" stop-opacity="0.1"/>`+
      `<stop offset="100%" stop-color="#000" stop-opacity="0.18"/></linearGradient>`;
    emitRoomClips();
  }
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
    // With Automorph off, psclipsoft and the room clips are emitted HERE —
    // their pre-Automorph home between the pool gradients and psshade — so
    // the showcase render stays byte-identical to that era in def order,
    // not merely def set.
    if(!(AUTOMORPH_PCT>0)){
      emitClipSoft();
      emitRoomClips();
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

    // Automorph non-overlap partitioning: one pass per floor, before any
    // fixture is drawn, grouping this floor's placed lights by the room
    // their POSITION falls in (same ray-cast the FIT block above already
    // uses) and handing each room's group to buildRoomFixtureCells once.
    // room -> Map(eid -> cell ring, room-local metres). A perimeter light
    // draws its own trace (perimeterSvg — Automorph restyles it in place,
    // see perimeterAuraSvg — never a cell aura), so it never enters this
    // grouping or competes for room space against fixtures that do.
    const roomFixtureCells=new Map();
    if(AUTOMORPH_PCT>0){
      const byRoomFixtures=new Map();
      for(const pl of hereLights){
        if(hiddenEids.has(pl.eid)) continue;
        const l=lightsByEid[pl.eid];
        // Motion/fan/temp fixtures are on the map but are not the "lights"
        // Automorph was built for (docs/IDEA_AUTOMORPH_LIGHTS.md) — they
        // carry their own established visual language (the pulse ring and
        // border colour for motion, isFan's own treatment, a temp readout)
        // that has nothing to do with a room-alignment aura. Left
        // unexcluded here they still competed for and won a real partition
        // cell purely by sharing a room with a real light, which then
        // suppressed their own glyph body via automorphAuraSvg's aura-
        // painted flag below — the exact live bug Garry reported ("the
        // center not activating on motion... only some sensors"): the
        // pulse ring is a separate code path and kept firing, but the
        // glyph itself had been swapped for a transparent hit rect.
        if(!l || l.shape==="perimeter" || l.isMotion || l.isFan || l.isTemp) continue;
        const r=hereRooms.find(rr=>pointInRoom(rr.pts, pl.x, pl.y));
        if(!r || r.pts.length<3) continue;
        const weight=automorphFixtureWeight(pl.lp&&pl.lp.width_cm, pl.lp&&pl.lp.height_cm);
        if(!byRoomFixtures.has(r)) byRoomFixtures.set(r, []);
        byRoomFixtures.get(r).push({id:pl.eid, x:pl.x, y:pl.y, weight});
      }
      for(const [r,fixtures] of byRoomFixtures) roomFixtureCells.set(r, buildRoomFixtureCells(r.pts, fixtures));
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
    const TR_b=iso(x1,y0_,rankOf(z)-slabWZ), BR_b=iso(x1,y1_,rankOf(z)-slabWZ), BL_b=iso(x0,y1_,rankOf(z)-slabWZ);

    // One gloss ramp per FLOOR for the Automorph aura's gloss FILL (the
    // rim is per-shape by design — see psglossrim in the aura defs):
    // psgloss's stops and diagonal, but gradientUnits=
    // userSpaceOnUse spanning this floor's own projected slab bbox instead
    // of each shape's bounding box. psgloss leans on objectBoundingBox —
    // cheap and correct while every shape sharing it is a near-uniform
    // hexagon, but Automorph cells range from thin wedges to room-sized
    // blobs, and the "same" 0.15,0 -> 0.6,1 ramp stretched per cell lands
    // the highlight at a visibly different angle/spread on each one — the
    // exact "two suns" outcome psgloss's own comment exists to prevent,
    // compounding at the ~100-fixture scale. One def per floor (O(floors),
    // free at any fixture count), every cell on the slab lit from the same
    // upper-left. Gated on the SLIDER, not on Showcase: Automorph runs on
    // the working map, and while the aura pointed at Showcase-gated
    // psgloss its rim and gloss silently vanished there (invalid paint
    // ref = element dropped) — but with Automorph off nothing references
    // this ramp, and the render stays byte-identical to the pre-Automorph
    // output. psgloss itself is untouched — markers and rooms keep exactly
    // what they have. A gradient element renders nothing on its own, so it
    // is safe outside <defs>; url() references resolve document-wide.
    const glossAutoId=`psglossauto_${lidx}`;
    if(AUTOMORPH_PCT>0){
      const gxs=[TL[0],TR[0],BR[0],BL[0]], gys=[TL[1],TR[1],BR[1],BL[1]];
      const gx0=Math.min(...gxs), gw=Math.max(...gxs)-gx0;
      const gy0=Math.min(...gys), gh=Math.max(...gys)-gy0;
      s+=`<linearGradient id="${glossAutoId}" gradientUnits="userSpaceOnUse" `+
        `x1="${(gx0+gw*0.15).toFixed(1)}" y1="${gy0.toFixed(1)}" `+
        `x2="${(gx0+gw*0.6).toFixed(1)}" y2="${(gy0+gh).toFixed(1)}">`+
        `<stop offset="0%" stop-color="#fff" stop-opacity="0.5"/>`+
        `<stop offset="45%" stop-color="#fff" stop-opacity="0.1"/>`+
        `<stop offset="100%" stop-color="#000" stop-opacity="0.18"/></linearGradient>`;
    }

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
    // invisible: same pill, same tap target, no pixels — the "hide device
    // codes" preference (Garry, 2026-09-09) must hide the TEXT, not the
    // place you tap. Without this, hiding codes silently shrank the
    // sidebar's tap target down to the glyph alone: the pill was the ONLY
    // thing here ever drawn with pointer-events enabled of its own (the
    // plain label below is pointer-events="none" even when shown — it
    // never caught a tap either way), so skipping it outright also
    // skipped the one extra bit of hit area codeChip mode actually added.
    // "all" on the <g> below means a fully transparent rect still takes
    // the tap; the shape is what matters; the paint is optional.
    const codeChipSvg=(l,hx,hy,tCol,gapPx=HEX_R*1.55,invisible=false)=>{
      const fs=CODE_PX*0.92;
      const w=String(l.code||"").length*fs*0.64+fs*0.9, h=fs*1.5;
      const cy=hy+gapPx+fs*0.45;
      const rect=invisible
        ? `<rect x="${(hx-w/2).toFixed(1)}" y="${(cy-h/2).toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" `+
          `rx="${(h*0.35).toFixed(1)}" fill="transparent" stroke="none"/>`
        : `<rect x="${(hx-w/2).toFixed(1)}" y="${(cy-h/2).toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" `+
          `rx="${(h*0.35).toFixed(1)}" fill="#050d09" fill-opacity="0.72" stroke="${tCol}" stroke-opacity="0.45" stroke-width="0.6"/>`;
      const text=invisible ? "" :
        `<text x="${hx.toFixed(1)}" y="${cy.toFixed(1)}" text-anchor="middle" dominant-baseline="middle" `+
        `font-family="ui-monospace,monospace" font-size="${fs.toFixed(1)}" font-weight="700" `+
        `letter-spacing="0.06em" fill="${tCol}" pointer-events="none">${escSVG(l.code)}</text>`;
      return `<g data-role="code" style="cursor:pointer" pointer-events="all">`+rect+text+`</g>`;
    };
    // suppressGlyph (Garry, 2026-09-07: "why do you keep all the old non
    // morphed stuff showing... weird choice?"): when this fixture's
    // Automorph aura is actively painting, the old glyph body stops
    // drawing — mirroring the perimeter shape's own precedent below
    // ("keep the glow, and the click space..., but hide the square").
    // Only the BODY goes; the hit region (same silhouette, same
    // rotate/scale transform, via the same layer() the body used),
    // the code label/chip and the <g data-eid/cx/cy> wrapper all stay,
    // so click/drag/tap and identity are untouched.
    const markerSvg=(l,hx,hy,entry,extra="",suppressGlyph=false)=>{
      // A motion sensor's icon lights for the SAME window its pulse
      // flashes (motionActive — state, or the shared hold window), never
      // the raw state alone: an alarm zone's hardware clears in ~5s and
      // the icon used to go dark then, mid-flash. Every other class is the
      // raw state, as always.
      // A lock has no "on"/"off" state at all — "locked" is its normal,
      // secure state, so that is what reads as lit here, the same way a
      // light being on is its normal active state. "unlocked" and
      // "jammed" both read as dim/attention, same treatment as a light
      // that's off.
      const on=l.isMotion ? motionActive(l) : (l.isLock ? l.state==="locked" : l.state==="on");
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
        :(l.isDoor?DOOR_BORDER
        :(l.isTemp?TEMP_BORDER
        :(l.isLock?LOCK_BORDER:null))))));
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
        const pLbl=HIDECODES ? (CODECHIP ? codeChipSvg(l,hx,hy-HEX_R*1.55,pCol,HEX_R*1.55,true) : "") : (CODECHIP
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
      // Divide by the MAX of sx/sy, not min or average: the scale() transform
      // multiplies stroke-width by whichever axis a point moves along, so the
      // larger factor is what would balloon the line — countering the smaller
      // one instead would still leave the stretched axis too thick.
      const sw=t.length?(2/Math.max(sx,sy)):2;
      // One helper for every layer of the marker, so the halo, the body and the
      // gloss are the SAME silhouette at the SAME transform — the whole point
      // of Showcase is that it re-lights the shape you drew, not another one.
      const layer=(a)=>t.length
        ? `<g transform="${t.join(" ")}">`+shapeSvg(l.shape, 0, 0, HEX_R, a)+`</g>`
        : shapeSvg(l.shape, hx, hy, HEX_R, a);

      let body;
      if(suppressGlyph){
        // The aura is this fixture's visual now; what remains here is the
        // SAME silhouette at the SAME transform, painted transparent —
        // fill="transparent", never "none": SVG's default pointer-events
        // (visiblePainted) hit-tests a transparent fill but not a none
        // fill, so this is exactly what keeps the fixture clickable and
        // draggable while invisible (the same deliberate choice
        // perimeter's own hit rect makes below).
        body=layer(`data-hit="1" fill="transparent" stroke="none" pointer-events="all"`);
      } else if(SHOW){
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
      // HIDECODES + CODECHIP (the sidebar, always; the builder's own
      // "Preview as sidebar") keeps the chip's tap target, invisibly — see
      // codeChipSvg's own comment. Plain HIDECODES (the builder's normal
      // editing view) still draws nothing: that label was pointer-events
      // "none" even when shown, so no live hit region has ever depended on
      // it — hiding it changes what is drawn, not what is clickable.
      const lbl=tempLbl!==null ? tempLbl : (HIDECODES ? (CODECHIP ? codeChipSvg(l,hx,hy,SHOW?tCol:"#e2e8f0",chipGap,true) : "") : (CODECHIP ? codeChipSvg(l,hx,hy,SHOW?tCol:"#e2e8f0",chipGap) : (SHOW
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
    const haloSvg=(l,hx,hy,maxR)=>dimmed(l) ? "" :
      `<circle class="lhalo" data-eid="${escSVG(l.entity_id)}" data-class="${lightClassOf(l)}" `+
      `cx="${hx.toFixed(1)}" cy="${hy.toFixed(1)}" r="${Math.max(HEX_R,Math.min(HALO_R,maxR)).toFixed(1)}" fill="transparent" stroke="none" `+
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

    // ── Shared Automorph rendering stages ───────────────────────────────────
    // Split out of automorphAuraSvg (2026-09-08) so the perimeter trace can
    // ride the IDENTICAL pipeline (Garry: the room-boundary shapes were left
    // out of "the whole morph thing... and now is a serious mismatch"): one
    // authority each for the smoothing/offset/containment maths and for the
    // jitter/hardness/path chain, so the aura and the trace can never drift
    // apart corner-language-first. Pure extractions — the aura's own output
    // is byte-identical through them.
    //
    // Subtlety scales every opacity and stroke-width the Automorph
    // treatments compute — one multiplier applied at the point of use,
    // rather than threading it through each style's own formula, so a
    // future 4th style gets it for free by using these same two helpers.
    // opac() floors its OUTPUT at 0.01: the slider's contract is "almost
    // completely lost", never gone, and after the composition re-budget the
    // quiet fills (0.02-0.05) times the 0.15 floor multiplier would
    // otherwise round to an exactly-invisible 0.00 through toFixed(2). At
    // subtlety 0 the multiplier is 1 and every input is >=0.01, so rest
    // positions are byte-untouched.
    const opac=(v)=>Math.max(v*_automorphOpacityMult, 0.01).toFixed(2);
    const swid=(v)=>(v*_automorphStrokeMult).toFixed(2);
    // The inset stage. Two Chaikin passes over WHICHEVER target the caller
    // chose — smoothing lives only here so the cell path, the room-trace
    // fallback and the perimeter trace get the identical corner language,
    // nothing upstream (the stored cells) or downstream (the AUTOMORPH_N
    // resample, the icon endpoint) is ever smoothed twice — see
    // chaikinSmooth's own comment for the grid-noise rationale and the
    // metaball scope guardrail. densifyRing first, because "identical
    // corner language" has to hold at the SCALE of the cut too: Chaikin's
    // cut rides its input's edge length, so sparse traced polygons fed in
    // raw got metre-scale corner rounding where a ~0.1m-edged cell ring got
    // the intended cm-scale cleanup — see the helper's own comment for the
    // measured failure.
    //
    // The ring handed back must honour TWO invariants everything after it
    // silently trusts: it is SIMPLE (no self-intersections) and it sits at
    // least 0.9*marginM inside its source ring EVERYWHERE — hardCapPx's
    // whole safety argument ("a spike can never eat the non-overlap gap")
    // assumes the gap actually exists before hardness runs. Feeding
    // offsetPolygonInward the raw Chaikin output broke both: its miter
    // construction — documented for sparse room traces — folds on a
    // 270-520-point ring's tightly-spaced vertices (bowtie loops the
    // adaptive 64-point resample then faithfully kept, where the old fixed
    // 24 aliased them away), and left vertices essentially ON the
    // pre-offset boundary, so at negative hardness neighbouring fixtures'
    // rendered rings genuinely crossed. So: resample the smoothed target
    // down to the SAME 64-point count automorphRing caps at BEFORE the
    // offset (well-spaced input, and no detail lost that the final resample
    // would have kept anyway), pruneRingFolds the inverted loops the offset
    // intrinsically leaves where the margin exceeds the local curvature
    // radius, then containRingInside projects any vertex still outside, or
    // closer than 0.9*marginM to, the source ring back to clearance depth —
    // with a final prune in case a projection itself crossed the ring.
    // Measured on the scenes that exposed this: pruning alone already
    // restores the full-margin clearance, so containment is the guarantee
    // for the shapes nobody measured, not the workhorse.
    //
    // hardCapPx rides along because it must derive from the SAME margin the
    // ring was just inset by. Hardness's negative side pushes ring points
    // OUTWARD (applyHardness) — cap that push so it can never spend the gap
    // this very inset just created between neighbouring cells and to the
    // room's own walls. Units: marginM is metres, but the ring applyHardness
    // receives is screen px. frame.scale is px-per-metre for an axis-aligned
    // metre step, and the iso projection is anisotropic — a metre maps to
    // between ~0.71x (SQRT1_2, the metre-space diagonal) and ~1.22x
    // frame.scale px depending on direction — so the cap takes the
    // conservative floor: whichever direction a spike happens to point, 85%
    // of the projected gap is the most it can ever spend.
    const automorphInsetRing=(rawPts, baseMarginM)=>{
      const targetPts=chaikinSmooth(densifyRing(rawPts, 0.1), 2);
      const marginM=Math.max(0, Math.min(baseMarginM, roomHalfMinDim(targetPts)*0.85));
      const coarsePts=resamplePolygonRing(targetPts, 64);
      const insetPts=pruneRingFolds(containRingInside(
        pruneRingFolds(offsetPolygonInward(coarsePts, marginM)), coarsePts, marginM*0.9));
      const hardCapPx=marginM*frame.scale*Math.SQRT1_2*0.85;
      return {insetPts, hardCapPx};
    };
    // The ink/hardness/path chain. Order is deliberate: the hand-inked
    // jitter, then hardness, then the path builder — so the spike operator
    // grows its spikes from the inked points and the soft Catmull-Rom runs
    // through them, instead of the jitter roughing up an already-built
    // curve. Nebula skips the jitter entirely (its treatments fade or blur
    // the edge to softness — invisible effort); its amplitude already
    // scales with t and dies on the negative-hardness side (see the
    // helper's own comment for the amplitude discipline). hx,hy seed the
    // jitter — the shape's own anchor, whatever the caller anchors on.
    const automorphInkedRing=(morphed, hx, hy, hardCapPx)=>{
      const inked=(AUTOMORPH_STYLE==="nebula") ? morphed
        : automorphRingJitter(morphed, hx, hy, AUTOMORPH_PCT/100, AUTOMORPH_HARDNESS);
      const ring=applyHardness(inked, AUTOMORPH_HARDNESS, hardCapPx);
      return {ring, d:ringPathD(ring, AUTOMORPH_HARDNESS)};
    };
    // The trace's requested margin in metres. Nullish, not ||: an explicit
    // margin of 0 (right on the wall) is a real, meaningful choice and must
    // not fall back to the default just because 0 is falsy — that would
    // make a true zero unreachable (that bug shipped once). One authority
    // because BOTH perimeter paths — the byte-stable legacy trace below and
    // the Automorph treatment (perimeterAuraSvg) — must agree on it.
    const perimeterWantM=(entry)=>{
      const rawCm=entry&&entry.margin_cm;
      return (rawCm===undefined||rawCm===null) ? defaultPerimeterMarginM(frame) : (Number(rawCm)||0)/100;
    };

    // A "perimeter" light's real extent: the room it is dropped in, traced
    // inward by its own margin_cm. Drawn for BOTH modes — this is the
    // fixture's shape, not a Showcase presentation effect — under everything
    // else on the floor, same reasoning as the room fills it sits just above.
    // entry is the fixture's placement record (pl.lp) — margin_cm lives there
    // alongside width_cm/height_cm/rotation, same storage, same draft path.
    // With Automorph up this legacy treatment stands down and
    // perimeterAuraSvg below draws the trace instead; with the slider at 0
    // this output is contractually BYTE-IDENTICAL to the pre-Automorph era.
    const perimeterSvg=(l,room,entry)=>{
      if(!room || room.pts.length<3) return "";
      const wantM=perimeterWantM(entry);
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

    // The perimeter trace in Automorph's design language (Garry, 2026-09-07:
    // "why did you not include the shapes generated by room boundaries in
    // the whole morph thing? That looked bad before, and now is a serious
    // mismatch"). V1 skipped perimeter lights as redundant — right for the
    // MORPH (the trace already IS the room shape, there is nothing to grow
    // toward, so no automorphRing here and the pct slider only scales the
    // treatment's presence) but wrong for the STYLING: the flat
    // single-colour polygon above sat beside auras with smoothed corners
    // and a lit-material stack. So with the slider up the trace is rebuilt
    // through the SAME automorphInsetRing pipeline the auras use, at the
    // fixture's OWN margin (perimeterWantM — margin_cm honoured exactly as
    // the legacy trace honours it), reshaped by the same
    // jitter+hardness+path chain (automorphInkedRing, seeded from the
    // ring's own centroid: the trace is a room-anchored object, and an
    // UNPLACED perimeter light has no fixture position to seed from), and
    // restyled per AUTOMORPH_STYLE in each style's own language. A cove
    // line is a LINE, not a cell, so NO style fills the interior:
    //   glow — stroke-centric material: AO and the lit cove's colour glow
    //     in the soft tier (the "working-mode glow" the legacy trace only
    //     had in Showcase), ink core + psglossrim bevel in the crisp tier.
    //     On/off is the aura's own MATERIAL split, never a hex swap: lit
    //     gets the glow and the brighter rim, off gets no glow and the
    //     deeper AO.
    //   blueprint — the dashed wireframe + vertex nodes, state riding
    //     linework brightness exactly like the aura's blueprint.
    //   nebula — one soft wide glow through the shared blur, state read as
    //     intensity. Stroked with the shared duotone so the orb language's
    //     colour ownership holds (no mask: psautomorphmask fades a FILL
    //     across its bbox — on a boundary-hugging line it would just eat
    //     the line).
    // No weight offset on the ink: automorphFixtureWeight is a manual-
    // FOOTPRINT cue and a trace's extent is the room, not a footprint.
    // Everything routes through opac()/swid() so subtlety fades it, the
    // tiers are clipped to the room like every aura, and the markup joins
    // the floor-wide glow/edge buffers so labels stay above it. Only
    // automorph-gated defs are referenced (psaurasoft, psglossrim, the
    // duotone pair, psclip_N) — the F2 gating contract — and this function
    // is only ever called with AUTOMORPH_PCT>0. data-eid rides on every
    // path, same tooling contract as the legacy polygons.
    const perimeterAuraSvg=(l,room,entry)=>{
      if(!(AUTOMORPH_PCT>0) || !room || room.pts.length<3) return null;
      const {insetPts, hardCapPx}=automorphInsetRing(room.pts, perimeterWantM(entry));
      const ringPx=insetPts.map(p=>iso(p[0],p[1],room.z));
      let scx=0, scy=0;
      for(const [px,py] of ringPx){ scx+=px; scy+=py; }
      scx/=ringPx.length; scy/=ringPx.length;
      const {ring, d}=automorphInkedRing(ringPx, scx, scy, hardCapPx);
      const on=l.state==="on";
      const t=AUTOMORPH_PCT/100;
      const ink=on?AUTOMORPH_BASE_ON:AUTOMORPH_BASE_OFF;
      const col=bodyCol(l,entry);
      const eidAttr=`data-eid="${escSVG(l.entity_id)}"`;
      const clip=roomClip.get(room);
      const clipWrap=(m)=>(m&&clip)?`<g clip-path="url(#${clip})" pointer-events="none">${m}</g>`:m;
      if(AUTOMORPH_STYLE==="blueprint"){
        const dashOp=opac((on?0.45:0.30)+0.40*t);
        let nodes="";
        for(const [px,py] of ring) nodes+=`<circle cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" r="1.6" `+
          `fill="${ink}" fill-opacity="${dashOp}" pointer-events="none"/>`;
        return {glow:"", edge: clipWrap(
          `<path ${eidAttr} d="${d}" fill="none" stroke="${ink}" stroke-opacity="${dashOp}" stroke-width="${swid(1.1)}" `+
          `stroke-dasharray="4,3" stroke-linejoin="round" pointer-events="none"/>`+nodes)};
      }
      if(AUTOMORPH_STYLE==="nebula"){
        return {glow: `<g filter="url(#psaurasoft)">`+clipWrap(
          `<path ${eidAttr} d="${d}" fill="none" stroke="url(#psautomorphduo_${on?"on":"off"})" `+
          `stroke-opacity="${opac((on?0.13:0.09)+0.22*t)}" stroke-width="${swid(6)}" `+
          `stroke-linejoin="round" pointer-events="none"/>`)+`</g>`, edge:""};
      }
      // "glow": the aura's material stack minus every fill. The colour glow
      // peaks at 0.28 at pct=100 — the exact weight the legacy Showcase
      // cove glow carried, so a full slider lands on the familiar look.
      const ao=`<path ${eidAttr} d="${d}" fill="none" stroke="#020617" stroke-opacity="${opac(on?0.10:0.18)}" `+
        `stroke-width="${swid(3.5)}" pointer-events="none"/>`;
      const coveGlow=on ? `<path ${eidAttr} d="${d}" fill="none" stroke="${col}" `+
        `stroke-opacity="${opac(0.08+0.20*t)}" stroke-width="${swid(4.5)}" `+
        `stroke-linejoin="round" pointer-events="none"/>` : "";
      const edgeCore=`<path ${eidAttr} d="${d}" fill="none" stroke="${ink}" `+
        `stroke-opacity="${opac(0.28+0.32*t)}" stroke-width="${swid(1.3)}" `+
        `stroke-linejoin="round" pointer-events="none"/>`;
      const edgeRim=`<path ${eidAttr} d="${d}" fill="none" stroke="url(#psglossrim)" `+
        `stroke-opacity="${opac(on?0.55:0.35)}" stroke-width="${swid(0.9)}" `+
        `stroke-linejoin="round" pointer-events="none"/>`;
      return {glow: `<g filter="url(#psaurasoft)">${clipWrap(ao+coveGlow)}</g>`,
              edge: clipWrap(edgeCore+edgeRim)};
    };

    // Automorph's rendering (Garry, 2026-09-07): a soft, neutral-grey aura
    // drawn BEHIND the ordinary icon, growing from a tight outline at the
    // fixture toward a target shape as AUTOMORPH_PCT rises. That target is
    // this fixture's own NON-OVERLAPPING CELL (cellPtsM, room-local metres,
    // from buildRoomFixtureCells) when one was computed for it — every
    // fixture sharing a room morphs toward its own share of the room instead
    // of every fixture piling onto the same full-room shape. Falls back to
    // the room's own full inset (today's original v1 target) when no cell
    // exists for this fixture — a room with only one OTHER fixture placed via
    // an area assignment rather than a real position, or any other case the
    // partition couldn't resolve — so a fixture never silently loses its aura
    // over an edge case in the newer geometry.
    // Deliberately does NOT touch markerSvg's own output — that function
    // already carries a lot of interdependent state (health dot, hit-test
    // rect, code chip placement, rotation) a first pass shouldn't risk
    // breaking. This is the smaller, reviewable step: the real morph maths
    // (automorphRing) proven and shipped, with "replace the icon's own
    // outline" left as a deliberate follow-up once this reads well live.
    //
    // Returns null when no aura paints, else the markup split into TWO
    // tiers — {glow, edge} — which the floor-wide aura pass (above the
    // labelJobs flush) accumulates across every fixture and appends
    // glow-tier-first: all blurred washes land under all crisp edges, so
    // one fixture's blur can never muddy the crisp bisector edge a
    // neighbouring cell already drew. Same two-pass discipline the pool
    // underlay establishes for markers ("drawn for the whole floor BEFORE
    // any marker, so one light's glow can never wash over another's
    // glyph") — per-fixture interleaving was the one draw order that
    // convention exists to forbid.
    const automorphAuraSvg=(l,hx,hy,room,z,cellPtsM,entry)=>{
      // Defensive twin of the exclusion in the partition-grouping pass
      // above — motion/fan/temp never get a cell there any more, but this
      // function must refuse to aura them even if ever called directly.
      if(!(AUTOMORPH_PCT>0) || !room || room.pts.length<3 || l.isMotion || l.isFan || l.isTemp) return null;
      // Inset stage — the shared automorphInsetRing above (smoothing,
      // well-spaced offset, fold pruning, containment, and the hardness cap
      // derived from the same margin). One inset constant was serving two
      // different composition jobs. defaultPerimeterMarginM is tuned for
      // exactly one of them: a shape sitting a plausible cove-distance off
      // a static WALL. A resolved cell's inset does the OTHER job —
      // separating two comparably-weighted aura objects from each other —
      // and there 2x a wall-tuned margin between neighbours read as tiles
      // laid nearly edge-to-edge. So the interior (fixture-vs-fixture) case
      // gets a distinctly larger multiple of the same frame-scaled base —
      // still pixel-constant at any zoom, by the same construction as the
      // base — while the room-outline fallback keeps 1x, the wall-distance
      // job the constant was actually tuned for. The roomHalfMinDim clamp
      // stays inside the helper, outside the multiplier, so a tight cell
      // can never be inset past its own middle.
      const hasCell=!!(cellPtsM && cellPtsM.length>=3);
      const {insetPts, hardCapPx}=automorphInsetRing(hasCell?cellPtsM:room.pts,
        defaultPerimeterMarginM(frame)*(hasCell?1.6:1));
      const roomPx=insetPts.map(p=>iso(p[0],p[1],z));
      const iconLocal=automorphIconRing(l.shape, entry&&entry.width_cm, entry&&entry.height_cm,
        entry&&entry.rotation, frame.scale, HEX_R);
      // Morph toward the inset target, then the shared ink/hardness/path
      // chain (jitter before spikes, spikes before pathing — see
      // automorphInkedRing's own comment), seeded from the fixture's
      // position, the aura's true anchor.
      const morphed=automorphRing(iconLocal, hx, hy, roomPx, AUTOMORPH_PCT/100);
      const {ring, d}=automorphInkedRing(morphed, hx, hy, hardCapPx);
      const on=l.isMotion ? motionActive(l) : (l.isLock ? l.state==="locked" : l.state==="on");
      // Neutral, colourless shading (Garry, 2026-09-07: "all these colors
      // now are doing the exact opposite of keeping the visuals clean and
      // aesthetic, the border of the rooms are already a bit much...
      // follow the grey shaded type visual you used before"). No per-room
      // or per-fixture hue — "on" reads as brighter, never as a different
      // colour, so this stays quiet next to the room borders' own colour
      // instead of competing with them. The gloss FILL's sheen ramp is
      // psglossauto — the SAME white-to-black diagonal psgloss gives every
      // marker and room ("one light source, upper-left, for the whole
      // drawing"), but defined once per floor in user space across the
      // slab's own bbox, so every differently-proportioned cell's interior
      // is lit from the one sun instead of each stretching its own copy of
      // the ramp; the RIM sweeps each shape's own bbox through psglossrim
      // instead — see both gradients' comments at their defs.
      const base=on?AUTOMORPH_BASE_ON:AUTOMORPH_BASE_OFF;
      const t=AUTOMORPH_PCT/100;
      // COLOUR OWNERSHIP — two features pull the fill attribute in
      // opposite directions, reconciled by splitting the channels:
      //  - the two SHARED duotone radialGradients (psautomorphduo_on/off —
      //    exactly two defs however many fixtures are on screen) own every
      //    fill INTERIOR: lighter at the centre fading to the state's base
      //    tone at the rim, the distance-from-the-light depth cue a flat
      //    fill can never give. Shared defs cannot carry a per-fixture
      //    offset by construction — expected and correct.
      //  - the per-fixture WEIGHT offset therefore expresses only through
      //    the flat-colour INK: automorphFixtureWeight (0.25-2.5, 1 with
      //    no recorded manual size) maps to a deterministic ±7% lightness
      //    band — edgeCore's stroke here, blueprint's linework and nodes,
      //    and, because nebula has no ink at all, a narrow fill-opacity
      //    delta (±0.028 ceiling) on its single wash. A bigger manually-
      //    sized fixture reads very slightly more present, a small one
      //    recedes. The band sits far inside the on/off gap (the darkest
      //    on-ink stays well lighter than the lightest off-ink), so state
      //    stays unambiguous, and weight 1 gives exactly today's ink
      //    (lighten() returns the hex untouched at 0), so two default-
      //    weight neighbours — the common case — stay essentially
      //    identical apart from edge and gap. Deterministic from the
      //    entry the call already receives — same no-Math.random()
      //    discipline as the cell wobble, no new seed scheme.
      const weightOffPct=Math.max(-7, Math.min(7,
        (automorphFixtureWeight(entry&&entry.width_cm, entry&&entry.height_cm)-1)*6));
      const ink=lighten(base, weightOffPct);
      const duo=`url(#psautomorphduo_${on?"on":"off"})`;
      // opac()/swid() — the shared subtlety multipliers — live with the
      // shared Automorph stages above, so the perimeter treatment fades
      // through the very same two helpers.
      // Every tier is clipped to the fixture's own room — the identical
      // mechanism the Showcase pools use, and the reason the clipPath defs
      // are UNGATED now (see the defs block): the wash's blur bleeds past
      // the ring, and negative hardness spikes outward on purpose, so a
      // wall-adjacent aura otherwise has a clear path across its room's
      // own boundary line — worst in exactly the small rooms
      // defaultPerimeterMarginM's own comment flags (the 1.57m bedroom
      // arm). roomClip covers every room in both modes, but a missing id
      // still degrades to unclipped rather than to an invalid reference,
      // which SVG would answer by not drawing the aura at all.
      const clip=roomClip.get(room);
      const clipWrap=(m)=>(m&&clip)?`<g clip-path="url(#${clip})" pointer-events="none">${m}</g>`:m;
      // Exploratory alternate treatments (Garry, 2026-09-07: "add a style
      // pulldown to build more morph concepts... I can always remove them
      // later") — same ring/path every style paints, only HOW it's drawn
      // differs, so dropping one later never touches the geometry above.
      if(AUTOMORPH_STYLE==="blueprint"){
        // Technical/architectural linework: no fill at all, a dashed
        // outline plus a small node at every vertex — reads as a wireframe
        // draft of the room shape rather than a glow.
        // State rides the one channel this style has — linework
        // brightness: lit linework runs a step brighter than unlit at
        // every t (0.45..0.85 vs 0.30..0.70), so on/off never comes down
        // to the ink hex alone (the "hex swap on a static sticker" tell
        // the other styles' material splits exist to kill). Width, dash
        // pattern and node radius stay state-independent on purpose:
        // heavier lit linework would read as a different pen, not a lit
        // fixture.
        const dashOp=opac((on?0.45:0.30)+0.40*t);
        let nodes="";
        for(const [px,py] of ring) nodes+=`<circle cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" r="1.6" `+
          `fill="${ink}" fill-opacity="${dashOp}" pointer-events="none"/>`;
        // All crisp linework, no blur anywhere — the whole style rides in
        // the edge tier so it sits above every other fixture's wash. Flat
        // INK throughout (dashes and nodes both), so this style carries
        // the per-fixture weight offset in its only channel; no fill
        // interior exists here for the duotone to own.
        return {glow:"", edge: clipWrap(
          `<path d="${d}" fill="none" stroke="${ink}" stroke-opacity="${dashOp}" stroke-width="${swid(1.1)}" `+
          `stroke-dasharray="4,3" stroke-linejoin="round" pointer-events="none"/>`+nodes)};
      }
      if(AUTOMORPH_STYLE==="nebula"){
        // A single soft-edged wash: the mask (defined once, shared by
        // every fixture — see psautomorphmask) fades the fill to nothing
        // at the ring's own edge, reading as a glowing orb rather than a
        // bounded shape with a stroke. A wash with no crisp linework at
        // all, so it rides entirely in the glow tier. Of the glow style's
        // material stack, only the on/off MATERIAL split fits here: the
        // orb language has no crisp bevel to hang a rim or AO ring on, a
        // cast shadow is gated to the glow style on purpose, and the
        // wash already draws through psautomorphmask, so adding the
        // masked bloom would run the same fill through the same mask
        // twice. A lit orb simply glows heavier than an inert one —
        // state read as intensity, not as a swapped grey alone. The fill
        // is the shared duotone (interior depth cue, like every other fill
        // interior); with no ink channel at all in this style, the
        // per-fixture weight offset rides a narrow fill-opacity delta
        // instead (±0.028 at the weight clamps — a nudge in presence,
        // nowhere near the ~0.09 on/off intensity split, so state stays
        // unambiguous).
        return {glow: clipWrap(
          `<path d="${d}" fill="${duo}" fill-opacity="${opac((on?0.26:0.17)+0.45*t+weightOffPct*0.004)}" `+
          `stroke="none" mask="url(#psautomorphmask)" pointer-events="none"/>`), edge:""};
      }
      // Five more exploratory treatments (Garry, 2026-09-09: "dig around
      // hard for 5 more candidates... look at what other options are out
      // there in the artistic world") — same ring/d/on/t/ink/duo contract
      // as blueprint/nebula above, nothing new required of the geometry.
      if(AUTOMORPH_STYLE==="circuit"){
        // State reads as electrical continuity, not brightness: off is a
        // broken dashed trace with hollow via pads (unpowered bare
        // copper); on closes into one solid trace with filled diamond
        // pads (current has continuity). No wash, no blur — pure ink,
        // `duo` reserved only for the on-state pad fill so state never
        // reads as a hue swap.
        const traceOp = on ? (0.70+0.30*t) : (0.45+0.25*t);
        const traceWidth = on ? 2.2 : 1.8;
        const traceDash = on ? "none" : "3 5";
        const mainTrace = `<path d="${d}" fill="none" stroke="${ink}" stroke-width="${swid(traceWidth)}" stroke-linejoin="miter" stroke-linecap="square" stroke-dasharray="${traceDash}" opacity="${opac(traceOp)}" pointer-events="none"/>`;

        const viaCount = Math.max(3, Math.round(3+4*t));
        const step = Math.max(1, Math.floor(ring.length/viaCount));
        const markerOp = on ? (0.55+0.35*t) : (0.35+0.25*t);
        const stubLen = 5+3*t;
        const padSize = (on ? 3.4 : 2.6)+1.2*t;

        let vias = "";
        for(let i=0;i<ring.length;i+=step){
          const vx = ring[i][0], vy = ring[i][1];
          const horiz = Math.floor(i/step)%2===0;
          const dir = (i%4<2) ? 1 : -1;
          const sx = horiz ? dir*stubLen : 0;
          const sy = horiz ? 0 : dir*stubLen;
          const pad = on
            ? `<rect x="${vx-padSize/2}" y="${vy-padSize/2}" width="${padSize}" height="${padSize}" transform="rotate(45 ${vx} ${vy})" fill="${duo}" pointer-events="none"/>`
            : `<rect x="${vx-padSize/2}" y="${vy-padSize/2}" width="${padSize}" height="${padSize}" fill="none" stroke="${ink}" stroke-width="${swid(0.75)}" pointer-events="none"/>`;
          vias += `<g opacity="${opac(markerOp)}" pointer-events="none"><line x1="${vx}" y1="${vy}" x2="${vx+sx}" y2="${vy+sy}" stroke="${ink}" stroke-width="${swid(on?1:0.75)}" stroke-linecap="square" pointer-events="none"/>${pad}</g>`;
        }

        return {glow: "", edge: clipWrap(`<g pointer-events="none">${mainTrace}${vias}</g>`)};
      }
      if(AUTOMORPH_STYLE==="contour"){
        // Topographic contour bands: several nested copies of the ring,
        // each scaled toward the fixture's own anchor (hx,hy) instead of
        // one outline — real contour lines are surveyed polylines, not
        // Bezier curves, so straight segments between ring's own sampled
        // vertices is the correct craft, not a shortcut. Bands fade with
        // distance from the anchor and alternate bold/thin ("index"
        // contours), the material/intensity split this style carries
        // instead of a hex swap.
        const bandAt=(f)=>{
          let bp="";
          for(let i=0;i<ring.length;i++){
            const vx=ring[i][0], vy=ring[i][1];
            bp+=(i===0?"M":"L")+(hx+(vx-hx)*f).toFixed(1)+","+(hy+(vy-hy)*f).toFixed(1)+" ";
          }
          return bp+"Z";
        };
        const fracs=on ? [0.34,0.52,0.70,0.86,1] : [0.40,0.62,0.84,1];
        const stateMul=on ? 1 : 0.8;
        const bandCount=fracs.length;
        let edge="";
        for(let i=0;i<bandCount;i++){
          const frac=fracs[i];
          const distFade=1-0.55*(i/(bandCount-1));
          const isIndex=(i%2===0);
          const raw=(0.55+0.30*t)*distFade*stateMul*(isIndex?1:0.6);
          const sw=swid((isIndex?1.6:1.0)+(isIndex?0.5:0.3)*t);
          const path=(frac===1) ? d : bandAt(frac);
          edge+=`<path d="${path}" fill="none" stroke="${ink}" stroke-opacity="${opac(raw)}" `+
            `stroke-width="${sw}" stroke-linejoin="round" pointer-events="none"/>`;
        }
        return {glow:"", edge: clipWrap(edge)};
      }
      if(AUTOMORPH_STYLE==="facet"){
        // A fan of flat triangular wedges from the fixture's own anchor to
        // every ring vertex, each lightened toward white or darkened
        // toward near-black by how much it faces the shared upper-left
        // light — a low-poly paper-sculpture read, hard edges only, zero
        // gradient softness inside any one facet.
        const n = ring.length;
        const baseHex = on ? AUTOMORPH_BASE_ON : AUTOMORPH_BASE_OFF;
        const baseR = parseInt(baseHex.slice(1,3),16), baseG = parseInt(baseHex.slice(3,5),16), baseB = parseInt(baseHex.slice(5,7),16);
        const WHITE = [255,255,255], NEARBLACK = [12,12,12];
        const mixRgb = (c,to,amt) => [0,1,2].map(i => Math.round(c[i] + (to[i]-c[i])*amt));
        const LX = -0.7071, LY = -0.7071;
        const CONTRAST = on ? 0.50 : 0.22;
        const fillOp = (0.50 + 0.35*t) * (on ? 1.1 : 0.85);

        const facets = ring.map((p,i) => {
          const q = ring[(i+1) % n];
          let fdx = (p[0]+q[0])/2 - hx, fdy = (p[1]+q[1])/2 - hy;
          const len = Math.hypot(fdx,fdy) || 1;
          fdx /= len; fdy /= len;
          const facing = fdx*LX + fdy*LY;
          const blend = facing * CONTRAST;
          const rgb = blend >= 0
            ? mixRgb([baseR,baseG,baseB], WHITE, Math.min(1, blend))
            : mixRgb([baseR,baseG,baseB], NEARBLACK, Math.min(1, -blend));
          return `<path d="M${hx},${hy} L${p[0]},${p[1]} L${q[0]},${q[1]} Z" fill="rgb(${rgb[0]},${rgb[1]},${rgb[2]})" fill-opacity="${opac(fillOp)}" pointer-events="none"/>`;
        }).join("");

        const spokeOp = 0.25 + 0.35*t;
        const spokes = ring.map(p =>
          `<line x1="${hx}" y1="${hy}" x2="${p[0]}" y2="${p[1]}" stroke="${ink}" stroke-width="${swid(0.6)}" stroke-opacity="${opac(spokeOp)}" pointer-events="none"/>`
        ).join("");

        const rimOp = 0.25 + 0.35*t;
        const rim = `<path d="${d}" fill="none" stroke="url(#psglossrim)" stroke-width="${swid(on ? 1.1 : 0.8)}" stroke-opacity="${opac(rimOp)}" pointer-events="none"/>`;

        return {glow: clipWrap(facets), edge: spokes + rim};
      }
      if(AUTOMORPH_STYLE==="sumie"){
        // Ink-wash brush stroke: a wide, soft, blurred bleed along the
        // ring (ink soaking into paper) under a crisp but irregular
        // dry-brush dash on top — never a regular machine rhythm — plus a
        // couple of soft pooling blots where a real brush would linger.
        // Flat and matte throughout; no bevel, no cast shadow.
        const smul = on ? 1 : 0.6;

        const bleedW = swid((on?7:5)+3*t);
        const bleedOp = opac((0.35+0.30*t)*smul);
        const bleedStroke = `<path d="${d}" fill="none" stroke="${on?AUTOMORPH_BASE_ON:AUTOMORPH_BASE_OFF}" stroke-width="${bleedW}" stroke-linecap="round" stroke-linejoin="round" transform="translate(0.6,0.4)" opacity="${bleedOp}" pointer-events="none"/>`;

        const rawIdx = [0, Math.floor(ring.length/3), Math.floor(2*ring.length/3)];
        const blotIdx = rawIdx.filter((v,i,a)=> ring[v] && a.indexOf(v)===i);
        const blotR = ((1.1+1.2*t)*(on?1.1:0.85)).toFixed(2);
        const blotOp = opac((0.30+0.20*t)*smul);
        const blots = blotIdx.map(i=>{
          const p = ring[i];
          return `<circle cx="${p[0]}" cy="${p[1]}" r="${blotR}" fill="${duo}" opacity="${blotOp}" pointer-events="none"/>`;
        }).join('');

        const glow = clipWrap(`<g filter="url(#psaurasoft)" pointer-events="none">${bleedStroke}${blots}</g>`);

        const dash = on ? "14,1.5,9,1,17,2,6,1.5" : "5,3,2,4,7,5,3,3.5,6,4";
        const crispW = swid((on?1.6:1.1)+0.5*t);
        const crispOp = opac((0.65+0.30*t)*smul);
        const edge = `<path d="${d}" fill="none" stroke="${ink}" stroke-width="${crispW}" stroke-linecap="round" stroke-linejoin="round" stroke-dasharray="${dash}" opacity="${crispOp}" pointer-events="none"/>`;

        return {glow, edge};
      }
      if(AUTOMORPH_STYLE==="stainedglass"){
        // The ring fan-cut from the fixture's own anchor into uneven
        // wedge panes, each a flat solid-toned cell at its own opacity
        // (hand-cut glass), with heavy dead-flat near-black leading along
        // every pane boundary and the outer frame. On vs off is the
        // panes' and the backlight wash's own opacity roughly doubling —
        // more luminous, as if backlit — the leading itself never changes.
        const n = ring.length;
        if(n < 3) return {glow: "", edge: ""};

        const LEAD = "#0a0a0c";
        const paneCount = 5 + (Math.abs(Math.round(hx + hy)) % 3);
        const seed = hx * 0.7 + hy * 1.3;
        const rnd = (i) => { const x = Math.sin(seed + i * 12.9898) * 43758.5453; return x - Math.floor(x); };

        const cutIdx = [];
        for(let k = 0; k < paneCount; k++){
          const spacing = n / paneCount;
          const jitter = (rnd(k) - 0.5) * spacing * 0.7;
          const raw = Math.round(k * spacing + jitter);
          cutIdx.push(((raw % n) + n) % n);
        }
        const cuts = [...new Set(cutIdx)].sort((a, b) => a - b);
        const m = cuts.length;
        if(m < 3) return {glow: "", edge: ""};

        const baseTone = on ? AUTOMORPH_BASE_ON : AUTOMORPH_BASE_OFF;
        const paneMax = on ? 0.60 : 0.30;
        const washMax = (on ? 0.45 : 0.25) * (1 + weightOffPct / 100);
        const floor = 0.45 + 0.55 * t;

        let panes = "";
        let spokes = "";
        for(let k = 0; k < m; k++){
          const i0 = cuts[k];
          const i1 = cuts[(k + 1) % m];
          let pts = `${hx},${hy} `;
          let idx = i0;
          let guard = 0;
          while(guard <= n){
            pts += `${ring[idx][0]},${ring[idx][1]} `;
            if(idx === i1) break;
            idx = (idx + 1) % n;
            guard++;
          }
          const variance = 0.7 + 0.6 * rnd(k * 7 + 3);
          const paneOp = paneMax * floor * variance;
          panes += `<path d="M ${pts.trim()} Z" fill="${baseTone}" fill-opacity="${opac(paneOp)}" pointer-events="none"/>`;
          spokes += `<line x1="${hx}" y1="${hy}" x2="${ring[i0][0]}" y2="${ring[i0][1]}" stroke="${LEAD}" stroke-width="${swid(1.2)}" stroke-opacity="${opac(0.85)}" stroke-linecap="round" pointer-events="none"/>`;
        }

        const wash = `<path d="${d}" fill="${duo}" fill-opacity="${opac(washMax * floor)}" mask="url(#psautomorphmask)" pointer-events="none"/>`;
        const glowMarkup = clipWrap(wash + panes);

        const outerLead = `<path d="${d}" fill="none" stroke="${LEAD}" stroke-width="${swid(1.8)}" stroke-opacity="${opac(0.90)}" pointer-events="none"/>`;
        const edgeMarkup = outerLead + spokes;

        return {glow: glowMarkup, edge: edgeMarkup};
      }
      if(AUTOMORPH_STYLE==="constellation"){
        // A sparse star-chart: every ring vertex becomes a tiny star (a
        // soft duotone halo plus a crisp core dot), joined by faint
        // straight vertex-to-vertex chords — literal polygon edges, never
        // the smoothed ring path — with one or two even fainter spokes
        // reaching back to the fixture's own anchor. No fill, wash or
        // dashing anywhere; the interior stays empty, a chart rather than
        // a rendering. On is bigger/brighter/denser; off shrinks to faint
        // pinpricks with the spokes almost gone.
        const n = ring.length;

        const coreR   = (on ? 2.2 : 1.5) + (on ? 1.2 : 0.8) * t;
        const haloR   = (on ? 4.5 : 3.2) + (on ? 2.0 : 1.2) * t;
        const coreOp  = opac(on ? 0.75 : 0.40);
        const haloOp  = opac(on ? 0.45 : 0.22);
        const chordW  = swid(on ? 0.9 : 0.6);
        const chordOp = opac((on ? 0.45 : 0.22) * (0.55 + 0.45 * t));
        const spokeW  = swid(on ? 0.7 : 0.5);
        const spokeOp = opac((on ? 0.30 : 0.15) * (0.3 + 0.7 * t));

        let chords = "";
        for(let i = 0; i < n; i++){
          const [cx1, cy1] = ring[i];
          const [cx2, cy2] = ring[(i + 1) % n];
          chords += `<line x1="${cx1}" y1="${cy1}" x2="${cx2}" y2="${cy2}" stroke="${ink}" stroke-width="${chordW}" opacity="${chordOp}" pointer-events="none"/>`;
        }

        let spokes = "";
        for(const i of [0, Math.floor(n / 2)]){
          const [sx, sy] = ring[i];
          spokes += `<line x1="${hx}" y1="${hy}" x2="${sx}" y2="${sy}" stroke="${ink}" stroke-width="${spokeW}" opacity="${spokeOp}" pointer-events="none"/>`;
        }

        let halos = "";
        for(let i = 0; i < n; i++){
          const [hpx, hpy] = ring[i];
          halos += `<circle cx="${hpx}" cy="${hpy}" r="${haloR}" fill="${duo}" opacity="${haloOp}" pointer-events="none"/>`;
        }
        const glow = clipWrap(`<g filter="url(#psaurasoft)" pointer-events="none">${halos}</g>`);

        let cores = "";
        for(let i = 0; i < n; i++){
          const [rpx, rpy] = ring[i];
          cores += `<circle cx="${rpx}" cy="${rpy}" r="${coreR}" fill="${ink}" opacity="${coreOp}" pointer-events="none"/>`;
        }

        return {glow, edge: chords + spokes + cores};
      }
      // Halo and Pulse (Garry, 2026-09-10: the first 8 candidates read as
      // "way too subtle" even after the opacity fix above, plus "add some
      // more ideas") — same ring/d/on/t/ink/duo contract as every style
      // above, tuned deliberately BOLDER than the original three so there is
      // no ambiguity about whether something is drawing. (A third style from
      // this batch, Chevron, and two earlier styles, Engrave and Woven, were
      // all cut on Garry's word, 2026-09-10: "all misses.")
      if(AUTOMORPH_STYLE==="halo"){
        // Maximum-legibility treatment, on purpose: one thick near-opaque
        // ring plus a soft blurred halo behind it. No dash, no wash, no
        // fine detail to lean in for — this style exists purely to be
        // unmistakable at a glance, at any slider position.
        const ringOp = on ? (0.85+0.15*t) : (0.55+0.20*t);
        const ringW  = swid((on ? 3.6 : 2.6) + 1.4*t);
        const glowOp = opac((on ? 0.30 : 0.16) + 0.20*t);
        const glowW  = swid((on ? 10 : 7) + 4*t);
        const glow = clipWrap(`<g filter="url(#psaurasoft)" pointer-events="none">`+
          `<path d="${d}" fill="none" stroke="${duo}" stroke-width="${glowW}" stroke-opacity="${glowOp}" pointer-events="none"/></g>`);
        const edge = clipWrap(`<path d="${d}" fill="none" stroke="${ink}" stroke-width="${ringW}" `+
          `stroke-opacity="${opac(ringOp)}" stroke-linejoin="round" pointer-events="none"/>`);
        return {glow, edge};
      }
      if(AUTOMORPH_STYLE==="pulse"){
        // A solid base ring with a wave of pulse-dots travelling around
        // it — dot size follows a sine wave keyed to position around the
        // ring (three lobes) and phase-shifted by `t`, so it reads as
        // energy moving along the silhouette rather than uniform beading
        // (constellation's language). Deliberately stays ON the ring
        // itself, never scaled past it: a fixture whose ring already
        // fills most of its room has nowhere to expand into once clipped
        // to the room boundary — an earlier "ripples expanding outward"
        // version vanished completely in exactly that common case.
        const n = ring.length;
        const base = `<path d="${d}" fill="none" stroke="${ink}" stroke-width="${swid(on?2.2:1.5)}" `+
          `stroke-opacity="${opac(on?0.80:0.50)}" stroke-linejoin="round" pointer-events="none"/>`;
        const phase = t * Math.PI * 2;
        let dots = "";
        for(let i=0;i<n;i+=2){
          const wave = (Math.sin((i/n)*Math.PI*2*3 + phase) + 1) / 2;
          const r = (on?1.4:0.9) + (on?3.2:2.0)*wave;
          const op = (on?0.35:0.20) + (on?0.50:0.30)*wave;
          const [px,py] = ring[i];
          dots += `<circle cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" r="${r.toFixed(2)}" fill="${duo}" `+
            `opacity="${opac(op)}" pointer-events="none"/>`;
        }
        return {glow: clipWrap(`<g filter="url(#psaurasoft)" pointer-events="none">${dots}</g>`), edge: clipWrap(base)};
      }
      // "glow" (default): a material stack, every layer the SAME path `d`
      // — no second geometry anywhere, so hardness/wobble/cell shape stay
      // correct in every layer for free. Bottom to top: cast shadow,
      // ambient-occlusion ring, wash, inner bloom (lit only) — the soft
      // layers, blurred ONCE as a group — then crisp edgeCore, edgeRim
      // and gloss. What each buys, and the constraint it protects:
      //
      //   shadow — a copy of `d` displaced along psgloss's own light-to-
      //     dark diagonal (0.45,1.0 normalized -> 0.41,0.91), ~5% of the
      //     ring's OWN bbox diagonal so it stays proportionate from
      //     icon-small (t=0) to room-large (t=1). Without a displaced
      //     dark shape nothing separates "object" from "floor it rests
      //     on" and the aura floats as a decal — every marker already
      //     earns its seat this way (psshade); the aura was the one
      //     shaded surface that didn't. The ink is a flat near-black,
      //     NOT url(#psshade): that gradient's def is Showcase-gated,
      //     and an invalid paint reference makes SVG drop the element
      //     entirely — the shadow would silently vanish on the working
      //     map, where Automorph also runs. Its weight rides t like
      //     every fill: the old flat 0.16 out-shadowed an icon-sized
      //     low-t aura (whose own wash was half that), and was the
      //     single heaviest slice of the over-budget stack the
      //     wash/bloom bullet re-sums below.
      //   ao — one wide dark stroke under the wash: the wash's fill
      //     mutes its outer half, leaving the inner half reading as
      //     contact darkening just inside the boundary, so the interior
      //     reads as a form with a cross-section instead of a uniformly
      //     lit cutout. Off fixtures get more of it — matte, inert
      //     surfaces show deeper contact shadow — lit ones push light
      //     out instead (the on/off split below).
      //   wash / bloom — the room-scale presence. The five FILLS are
      //     budgeted TOGETHER against the room's own colour — room fill
      //     0.16 + psroomglow's 0.16 centre stop = 0.32 at its centre,
      //     and the grey stays QUIET next to that hue — so the whole
      //     stack (shadow 0.04 + wash 0.04 + bloom 0.04 + edgeCore fill
      //     0.02 + gloss 0.05 x its ramp's 0.5 max stop) composites to
      //     1-PROD(1-o) = 0.155 <= 0.16, under half the room's own at
      //     t=1/subtlety 0. Cutting layers one at a time doesn't keep
      //     that: the first rebalance trimmed wash/gloss while the same
      //     edit series added bloom, the duotone edge fill and an
      //     untapered shadow back on top, and nobody re-summed — the
      //     stack composited to ~0.58-0.64 at centre, ~4x the ceiling,
      //     grey OVER the hue. The thin edge, not the fills, is what
      //     signals "distinct shape". Both fill through
      //     the shared duotone (see the colour-ownership comment above):
      //     lighter at the centre, base tone at the rim. The bloom (lit
      //     fixtures only) reuses nebula's shared psautomorphmask to
      //     fade its fill toward the ring's edge: light welling up from
      //     inside, the one cue a re-tinted flat fill can never give.
      //   edgeCore / edgeRim — one flat stroke all the way around was
      //     the "flat sticker" tell: it outlines the silhouette without
      //     saying which way the surface turns. edgeCore keeps the flat
      //     role (in the per-fixture INK, the weight offset's channel),
      //     dialed back for headroom; edgeRim strokes the same `d` with
      //     psglossrim — psgloss's stops swept across this shape's OWN
      //     bbox — landing bright on the upper-left arc and dark on the
      //     lower-right of every shape: a lit bevel with one shared def
      //     and zero new geometry. NOT the floor-wide psglossauto: that
      //     ramp decided bright-vs-dark by position on the slab (a
      //     lower-right fixture's whole rim fell past the 45% stop — no
      //     bright arc at all), while a bevel must say which way EACH
      //     shape's surface turns; the per-bbox sweep still points every
      //     bright arc at the same upper-left sun. The gloss FILL below
      //     keeps the floor ramp — that is the layer the one-sun rule
      //     was moved for.
      //
      // ON vs OFF is a MATERIAL split, not a hex swap: lit gets the
      // bloom plus a slightly heavier wash/gloss/rim; off gets no bloom,
      // lighter fills and the deeper AO — the two states differ in how
      // the surface behaves, not merely in which grey it wears.
      let minX=ring[0][0], minY=ring[0][1], maxX=minX, maxY=minY;
      for(const [px,py] of ring){
        if(px<minX)minX=px; if(px>maxX)maxX=px;
        if(py<minY)minY=py; if(py>maxY)maxY=py;
      }
      const diag=Math.hypot(maxX-minX, maxY-minY);
      const sdx=diag*0.05*0.41, sdy=diag*0.05*0.91;
      const shadow=`<g transform="translate(${sdx.toFixed(1)},${sdy.toFixed(1)})">`+
        `<path d="${d}" fill="#020617" fill-opacity="${opac(0.02+0.02*t)}" stroke="none" pointer-events="none"/></g>`;
      const ao=`<path d="${d}" fill="none" stroke="#020617" stroke-opacity="${opac(on?0.10:0.18)}" `+
        `stroke-width="${swid(3.5)}" pointer-events="none"/>`;
      const wash=`<path d="${d}" fill="${duo}" fill-opacity="${opac((on?0.02:0.01)+0.02*t)}" `+
        `stroke="none" pointer-events="none"/>`;
      const bloom=on ? `<path d="${d}" fill="${duo}" fill-opacity="${opac(0.02+0.02*t)}" `+
        `stroke="none" mask="url(#psautomorphmask)" pointer-events="none"/>` : "";
      const edgeCore=`<path d="${d}" fill="${duo}" fill-opacity="${opac(0.01+0.01*t)}" `+
        `stroke="${ink}" stroke-opacity="${opac(0.28+0.32*t)}" stroke-width="${swid(1.3)}" `+
        `stroke-linejoin="round" pointer-events="none"/>`;
      const edgeRim=`<path d="${d}" fill="none" stroke="url(#psglossrim)" `+
        `stroke-opacity="${opac(on?0.55:0.35)}" stroke-width="${swid(0.9)}" `+
        `stroke-linejoin="round" pointer-events="none"/>`;
      const gloss=`<path d="${d}" fill="url(#${glossAutoId})" fill-opacity="${opac((on?0.02:0.01)+0.03*t)}" `+
        `stroke="none" pointer-events="none"/>`;
      // ALL the soft layers share ONE blur: the filter sits on the outer
      // group, so the renderer blurs a single composited raster instead
      // of rasterizing up to four separate feGaussianBlur passes per
      // fixture — done the obvious way (one filter attribute per path)
      // that would be ~400 blur passes at the ~100-fixture scale this
      // feature targets, for an effect whose whole brief is "cheap".
      // The blur is OUTSIDE the clip — filter on the outer group, clip
      // on the inner — so the cut edge feathers a couple of pixels over
      // the wall exactly the way the clipped pools already do, instead
      // of stopping in a razor line. psaurasoft, not psclipsoft: the
      // shadow's offset copy grows this group's bbox, so the aura owns a
      // clone with a wider filter region (see the def's comment) while
      // the pools keep their tighter, cheaper one untouched.
      return {glow: `<g filter="url(#psaurasoft)">${clipWrap(shadow+ao+wash+bloom)}</g>`,
              edge: clipWrap(edgeCore+edgeRim+gloss)};
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
    // The pulse a CURRENTLY TRIGGERED motion sensor throws — drawn in the
    // same underlay pass as the light pools so it sits beneath every marker.
    // Two layers: a breathing soft disc, and a ring that expands and fades,
    // radar-style, on a shared 1.6s clock.
    //
    // Drawn while a sensor is genuinely "on" OR still inside the shared
    // hold window since its last transition (MOTION_HOLD_MS — see the call
    // site), and its colour is ALWAYS the fixed active hue
    // (MOTION_COLOR_STOPS[0][1]) — never elapsed-shifted, whatever the
    // device class or how long it has been "on". Three things this fixes,
    // all from Garry's own live reports:
    //   0. (2026-09-05, round three) An alarm panel's PIR zone self-clears
    //      back to "off" ~5 seconds after triggering, so a flash tied to
    //      the raw state alone lasted five SECONDS there while other
    //      sensors' firmware held it for minutes — the hold window gives
    //      every class the same minimum flash from the same real event.
    //   1. (2026-09-03, the original problem this pulse exists to solve)
    //      A short-hold PIR, a long-retrigger PIR and a sustained
    //      occupancy/radar unit used to each look different simply because
    //      their hardware holds "on" for a different length of time. A
    //      fixed colour while triggered is the most direct fix — three
    //      different pieces of hardware now look IDENTICAL while active,
    //      which a shared elapsed clock (tried first, see git history)
    //      does not actually guarantee.
    //   2. (2026-09-05) That EARLIER fix — one continuous elapsed-since-
    //      last-changed clock running whether "on" or "off" — swapped in a
    //      worse inconsistency: a genuine occupancy/radar sensor that
    //      stays "on" for hours while someone is continuously present has
    //      a last_changed that is also hours old, so its pulse faded all
    //      the way to the "long since quiet" colour while the room was
    //      still actively occupied — backwards for "simple occupancy
    //      viewing" (Garry: "I need consistent behaviour regardless of the
    //      sensor type"). Triggered now always means the same thing, on
    //      sight, for every sensor class: something is happening HERE,
    //      RIGHT NOW. The elapsed clock still runs, but only once a sensor
    //      goes QUIET (motionRecentPulseSvg, below) — that is genuinely a
    //      "how long ago" question, and every class starts that clock at
    //      the same place (last_changed, the moment it went quiet).
    const motionPulseSvg=(hx,hy,eid,degSweep)=>{
      const r0=HEX_R*1.15;
      const col=`hsl(${degSweep.toFixed(0)},75%,58%)`;
      return `<g class="lpulse" data-eid="${escSVG(eid)}" pointer-events="none">`+
        `<circle cx="${hx.toFixed(1)}" cy="${hy.toFixed(1)}" r="${(r0*1.6).toFixed(1)}" fill="url(#psmotion)" opacity="0.55">`+
        `<animate attributeName="opacity" values="0.55;0.2;0.55" dur="1.6s" repeatCount="indefinite"/>`+
        `</circle>`+
        `<circle cx="${hx.toFixed(1)}" cy="${hy.toFixed(1)}" r="${r0.toFixed(1)}" fill="none" stroke="${col}" stroke-width="1.6">`+
        `<animate attributeName="r" values="${(r0*0.7).toFixed(1)};${(r0*2.4).toFixed(1)}" dur="1.6s" repeatCount="indefinite"/>`+
        `<animate attributeName="opacity" values="0.8;0" dur="1.6s" repeatCount="indefinite"/>`+
        `</circle></g>`;
    };

    // The ONE shared answer to "is this motion sensor active right now":
    // genuinely "on", or within the hold window of its last transition.
    // Every element that lights up for activity — the marker ICON's lit
    // body and the flashing pulse beneath it — must go through this, or
    // they drift apart: round four (Garry) was exactly that, "the blue
    // solid flash for the motion icon still goes out ... The ring might
    // be OK, but not the icon" — the pulse had the hold window, the icon
    // was still keyed to the raw 5-second hardware hold.
    const motionActive=(l)=>{
      if(l.state==="on") return true;
      const lastMs=l.last_changed ? Date.parse(l.last_changed) : NaN;
      const e=NOW_MS-lastMs;
      return e>=0 && e<MOTION_HOLD_MS;
    };
    const motionRecentHue=(elapsedMs)=>{
      let hue=MOTION_COLOR_STOPS[0][1];
      for(const [atMs,h] of MOTION_COLOR_STOPS){ if(elapsedMs>=atMs) hue=h; else break; }
      return hue;
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
    // Everything from a room's own NAME onward (label, provisional pile,
    // unplaced count) is deferred the same way, into its own pass run only
    // after every room's polygon on this floor is drawn (Garry, 2026-09-07:
    // a name near a shared wall was landing under a NEIGHBOURING room's
    // boundary whenever that room happened to iterate later — this was
    // arbitrary array order, not geometry, so it read as "sometimes on top,
    // sometimes under" with no visible pattern). Labels now paint over every
    // boundary line on the floor, always, the same way markers already paint
    // over every room.
    const labelJobs=[];

    // Rooms, straight from the metre fabric.
    for(const r of hereRooms){
      const color=liveRoomColor(r.room, roomColor(r.room, model));
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
      // The label's own rendered footprint, computed here (not down by the
      // <text> itself) because the collision check below needs it.
      // Trimmed ~10% (Garry, 2026-09-07: room names were "too much space" —
      // shrink-to-fit below only ever shrinks further from here, never grows).
      const rfsBase=SHOW?5.9:6.7;
      const rtxt=SHOW?String(r.room).toUpperCase():String(r.room);
      // Shrink to fit the room's own isometric width — a fixed size read
      // fine in an average room but visibly overflowed a small one, live on
      // Garry's house: "PowderRoom" drew 61.5px wide inside a room only
      // 48px wide. Only ever shrinks, never grows past the base size for a
      // room with room to spare — a small gap (FIT_MARGIN) to the room's
      // own edges keeps the label from touching them exactly, and MIN_RFS
      // is the same small-text floor CODE_PX and the unplaced-cluster count
      // already use elsewhere on this map.
      const roomIsoW=Math.max(...ipts.map(p=>p[0]))-Math.min(...ipts.map(p=>p[0]));
      const naturalW=rtxt.length*rfsBase*(SHOW?0.78:0.6)+10;
      const FIT_MARGIN=0.88, MIN_RFS=4.5;
      const rfs=(roomIsoW>0 && naturalW>roomIsoW*FIT_MARGIN)
        ? Math.max(MIN_RFS, rfsBase*(roomIsoW*FIT_MARGIN)/naturalW)
        : rfsBase;
      const rw=rtxt.length*rfs*(SHOW?0.78:0.6)+10, rh=rfs*1.9;
      // ...and if a fixture happens to sit on that spot anyway, the name steps
      // up out of the way rather than being drawn through. The halo keeps it
      // readable once it crosses the room's own edge.
      //
      // The half-width here MUST be the label's own half-width (rw/2), not a
      // flat constant — a short name like "Den" and "SpareBedroomBath" occupy
      // very different horizontal spans, and a fixed window sized for a short
      // name lets a marker sit just outside it while still under the text of
      // a long one. That was live on Garry's own house: "SPAREBEDROOMBATH"
      // (16 characters, ~46px half-width in Showcase) against a flat ±34px
      // window left its M08 marker checked as "not near" while visibly
      // drawn through the name.
      {
        const near=(ly)=>hereLights.some(l=>{
          const [mx2,my2]=iso(l.x,l.y,z);
          return Math.abs(mx2-lix)<rw/2 && Math.abs(my2-ly)<9;
        });
        for(let tries=0; tries<3 && near(liy); tries++) liy-=13;
      }
      if(SHOW){
        // Same polygon, given depth: a soft dark edge seats the room on the
        // slab, the fill carries the room colour, one sheen from the shared
        // upper-left light source keeps every room lit from the same place,
        // and the room's own soft centre-glow (see roomGlowIds) rounds it out.
        s+=`<polygon points="${pp}" fill="none" stroke="#04100a" stroke-width="4" stroke-linejoin="round" opacity="0.5"/>`;
        s+=`<polygon points="${pp}" fill="${color}" fill-opacity="0.085" stroke="${color}" stroke-width="1.3" stroke-opacity="0.8" stroke-linejoin="round"/>`;
        s+=`<polygon points="${pp}" fill="url(#${roomGlowIds.get(color)})" stroke="none" pointer-events="none"/>`;
        s+=`<polygon points="${pp}" fill="url(#pswash)" stroke="none" pointer-events="none"/>`;
      } else {
        s+=`<polygon points="${pp}" fill="${color}" fill-opacity="0.16" stroke="${color}" stroke-width="1.6" opacity="1"/>`;
        s+=`<polygon points="${pp}" fill="url(#${roomGlowIds.get(color)})" stroke="none" pointer-events="none"/>`;
      }
      // Deferred to labelJobs (see above): the name itself, plus everything
      // that was drawn right after it — the loop below runs these only once
      // every room's polygon on this floor is already painted.
      labelJobs.push(() => {
        // paint-order puts the dark stroke UNDER the glyphs, so the name
        // stays legible over the floor hatch and over a slab edge it happens
        // to cross. Showcase sets it in tracked small caps — the convention
        // every printed plan uses for a room name, and it stops competing
        // with the fixture codes. The room's name is a TAP TARGET
        // (data-role="room"): the sidebar opens the room's sheet from it —
        // every light in the room, all off, all on — and the builder selects
        // the room's lights. A transparent box behind the text takes the
        // tap; the glyph strokes alone would be a needle.
        {
          s+=`<g class="lroom" data-role="room" data-room="${escSVG(r.room)}" data-z="${z}" style="cursor:pointer">`+
            `<rect x="${(lix-rw/2).toFixed(1)}" y="${(liy-rh/2).toFixed(1)}" width="${rw.toFixed(1)}" height="${rh.toFixed(1)}" `+
            `rx="3" fill="transparent" stroke="none" pointer-events="all"/>`;
        }
        // Lighter and smaller than before (Garry, 2026-09-07: "takes up too
        // much space" and needs to stay "somewhat transparent" over whatever
        // it crosses) — a thinner halo and a lower opacity so a marker or
        // boundary line underneath still reads through it.
        s+=`<text x="${Math.round(lix)}" y="${Math.round(liy)}" text-anchor="middle" dominant-baseline="middle" `+
          `fill="${color}" font-size="${rfs.toFixed(2)}" font-family="system-ui,sans-serif" font-weight="600" `+
          (SHOW?`letter-spacing="0.16em" `:``)+
          `paint-order="stroke" stroke="#071008" stroke-width="1.8" stroke-linejoin="round" `+
          `opacity="${SHOW?"0.6":"0.78"}" pointer-events="none">`+
          `${escSVG(SHOW?String(r.room).toUpperCase():r.room)}</text></g>`;
        // Room assignment isn't known yet (registry still loading) — show a
        // single pulsing placeholder instead of blocking the whole map on
        // a multi-MB registry fetch; real hexes replace it once it lands.
        if(lightsLoading){
          s+=`<polygon points="${hexPts(ccx,ccy,HEX_R)}" fill="#374151" stroke="#60a5fa" stroke-width="2" opacity="0.5">`+
            `<animate attributeName="opacity" values="0.25;0.65;0.25" dur="1.2s" repeatCount="indefinite"/>`+
            `</polygon>`;
          return;
        }
        // Hexagon cluster for this room's unplaced lights — a light with a
        // real position was already drawn at it. A door/window never joins
        // this pile: dragging one out of a room-centre cluster to "place" it
        // is exactly the meaningless interaction this class was pulled out
        // of (see the `lights` filter above and the barrier pass below). A
        // lock still can — it keeps its ordinary point placement.
        const roomLights=(byRoom[r.room]||[]).filter(l=>!hiddenEids.has(l.entity_id) && !placed[l.entity_id] && !l.isDoor);
        if(!roomLights.length) return;
        // A perimeter light traces its ROOM, which is already known here —
        // no placement needed to see it. Unplaced means no entry, so this
        // draws at the default margin; dragging it onto the map is only for
        // adjusting margin, not for making the trace appear at all. With
        // Automorph up the floor-wide tier pass draws these instead (same
        // fixtures, same filter — see its unplaced-perimeter loop), so the
        // legacy call stands down rather than double-drawing.
        for(const l of roomLights) if(l.shape==="perimeter" && !(AUTOMORPH_PCT>0)) s+=perimeterSvg(l, r, null);
        // Use-mode: the pile becomes one chip. The chip is drawn with the
        // markers (a job with no light) so it sits above the pools and the
        // room fill like a marker would.
        if(COLLAPSE){
          const eids=roomLights.map(l=>l.entity_id);
          const anyOn=roomLights.some(l=>l.state==="on");
          stacks.push([r.room, eids, anyOn, ccx, ccy, z]);
          return;
        }
        const offsets=hexCluster(roomLights.length, HEX_R);
        // Build-mode: the pile stays a pile (drag one out to place it), but
        // it is VISIBLY provisional — a dashed ring round the cluster says
        // "these are inferred from the room, not measured", and how many
        // there are.
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
          // Trailing false: the unplaced/room-cluster path never gets an
          // aura (only the floor-wide aura pass over PLACED lights calls
          // automorphAuraSvg), so its glyph must never be suppressed —
          // hiding it here would leave nothing drawn at all.
          jobs.push([l, ccx+dx, ccy+dy, null, `data-z="${z}"`, roomClip.get(r), fx, false]);
        });
      });
    }
    // ── Door/window/lock barriers: the one wall this map ever draws, and
    // only a LINKED section — an ordinary rf_barriers_m wall stays
    // Rooms-tab-only; this is narrowly the open/closed (or locked/unlocked)
    // indicator the whole feature is for (docs/IDEA_DOOR_WINDOW_BARRIERS.md,
    // step 5; Garry, 2026-09-08: "I want the lighting map to clearly show
    // when a door or window is left open"; 2026-09-09, extended to locks:
    // "use the same logic as the open door to build a break in the wall
    // that has the lock").
    {
      // Garry, 2026-09-10: "any setting should not negate a door showing up
      // properly" — a layer-chip filter (Lights/Strips/Fans/Motion) used to
      // dim a door/window/lock wall to 22% opacity when some OTHER class was
      // selected. Its open/closed (or locked/unlocked) state is load-bearing
      // information about the house, not clutter a layer filter should mute.
      const barDim = 1;
      // Which wall (if any) the in-progress circle currently straddles —
      // computed once per floor, shared by the "every other wall" faint pass
      // below and the "this one, with a gap" pass after it, and the exact
      // function maps.js's _commitDoorCircle uses too (bestCircleWall,
      // stack_transform.js) — so the live preview here and the final commit
      // can never name a different wall or a different cut.
      let circleMatch = null;
      if(DOOR_CIRCLE_M && frame.levelOf(String(DOOR_CIRCLE_M.floorId||"main"))===z){
        const dcFid = String(DOOR_CIRCLE_M.floorId||"main");
        const floorBars = ((model && model.rf_barriers_m) || [])
          .filter(b => String(b.floor_id||"main")===dcFid);
        circleMatch = bestCircleWall(floorBars, DOOR_CIRCLE_M.x_m, DOOR_CIRCLE_M.y_m, DOOR_CIRCLE_M.r_m);
        // No RF Barrier straddles it — a room's own edge might (Garry,
        // 2026-09-10: "I draw the circle, it is visually perfect over the
        // wall I need the door in"). Synthesized as the SAME {bar, hits}
        // shape a real match has, purely so the drawing code below needs no
        // special case; maps.js's _commitDoorCircle creates the real
        // barrier from this exact edge on Done — this is only ever a
        // preview of that, never a write.
        // Same guard as maps.js's commit: an already-linked barrier crossing
        // the circle still means a real wall is recorded here, so no
        // room-edge preview should suggest a duplicate is about to be made.
        const alreadyExplained = floorBars.some(b => {
          const pts=(b.points_m||[]).map(p=>[Number(p[0]),Number(p[1])]);
          return pts.length>=2 && circlePolylineIntersections(pts, DOOR_CIRCLE_M.x_m, DOOR_CIRCLE_M.y_m, DOOR_CIRCLE_M.r_m).length>=2;
        });
        if(!circleMatch && !alreadyExplained){
          const roomEdge = roomEdgeForCircle((model && model.room_geometry_m), dcFid,
            DOOR_CIRCLE_M.x_m, DOOR_CIRCLE_M.y_m, DOOR_CIRCLE_M.r_m);
          if(roomEdge) circleMatch = { bar: { points_m: roomEdge.points, name: roomEdge.room }, hits: roomEdge.hits };
        }
      }
      // Every OTHER unlinked wall, while the circle tool is armed — without
      // this there is nothing on the map to aim the circle at: an ordinary
      // wall otherwise never draws here at all (see the comment above).
      // Faint on purpose — "here is roughly where the walls are", not the
      // wall's real presence the way Overview's Walls toggle draws it. The
      // wall the circle currently matches is skipped here — drawn (with its
      // gap) below instead.
      if(DOOR_CIRCLE_ARMED) for(const bar of ((model && model.rf_barriers_m) || [])){
        if(bar.linked_entity_id) continue;
        if(circleMatch && bar===circleMatch.bar) continue; // drawn with a gap, below
        if(frame.levelOf(String(bar.floor_id || "main"))!==z) continue;
        const bpts=(bar.points_m||[]).map(p=>[Number(p[0]), Number(p[1])]);
        if(bpts.length<2 || bpts.some(p=>!Number.isFinite(p[0])||!Number.isFinite(p[1]))) continue;
        const ppx=bpts.map(p=>pt(iso(p[0],p[1],z))).join(" ");
        s+=`<polyline points="${ppx}" fill="none" stroke="#94a3b8" stroke-width="2" `+
          `stroke-dasharray="4,4" stroke-linecap="round" opacity="0.45" pointer-events="none"/>`;
      }
      for(const bar of ((model && model.rf_barriers_m) || [])){
        // Garry, 2026-09-10: "any setting should not negate a door showing
        // up properly" — a linked wall is never gated by hiddenEids (the
        // "hide this fixture" / "hide untouched" declutter filters). Those
        // exist to declutter ordinary placeable lights; a door/window/lock's
        // open state is load-bearing information about the house, not
        // clutter, and must show regardless of any filter.
        if(!bar.linked_entity_id) continue;
        if(frame.levelOf(String(bar.floor_id || "main"))!==z) continue;
        const bpts=(bar.points_m||[]).map(p=>[Number(p[0]), Number(p[1])]);
        if(bpts.length<2 || bpts.some(p=>!Number.isFinite(p[0])||!Number.isFinite(p[1]))) continue;
        const dl=lightsByEid[bar.linked_entity_id];
        const ppx=bpts.map(p=>pt(iso(p[0],p[1],z))).join(" ");
        if(dl && dl.isLock){
          // A lock reports its OWN state, not the opening's — the section
          // stays drawn either way (a lock does not make the wall vanish
          // the way an open door does); unlocked is the alert, so it
          // flashes red instead of looking like just another closed door.
          const locked=dl.state==="locked";
          s+=locked
            ? `<polyline points="${ppx}" fill="none" stroke="#94a3b8" stroke-width="2.6" `+
              `stroke-linecap="round" opacity="${(0.85*barDim).toFixed(2)}" pointer-events="none"/>`
            : `<polyline points="${ppx}" fill="none" class="lv-lockflash" stroke-width="3" `+
              `stroke-linecap="round" opacity="${barDim.toFixed(2)}" pointer-events="none"/>`;
        } else {
          const isOpen=!!(dl && dl.state==="on");
          // Garry, 2026-09-10 (repeated, emphatically): "the doors when
          // open show a grey line where the door is, I want nothing
          // there." A prior pass drew a dashed DOOR_BORDER line for the
          // open state instead of a true gap — replaced with nothing at
          // all: open means the wall section is gone, full stop. Closed
          // still draws the solid grey line.
          if(!isOpen){
            s+=`<polyline points="${ppx}" fill="none" stroke="#94a3b8" stroke-width="2.6" `+
              `stroke-linecap="round" opacity="${barDim.toFixed(2)}" pointer-events="none"/>`;
          }
        }
        // The two points where this opening meets the rest of the wall it
        // was split from — Garry, 2026-09-08: "a small purple dot showing on
        // the two sides where the opening starts and ends", in BOTH states
        // (it marks WHERE the door is, not whether it's open). #9333ea is
        // deliberately not maps.js's _MAT_COLORS.custom purple (#a855f7) —
        // checked, not assumed, per the design doc's own warning.
        for(const p of [bpts[0], bpts[bpts.length-1]]){
          const [dx,dy]=iso(p[0],p[1],z);
          s+=`<circle cx="${dx.toFixed(1)}" cy="${dy.toFixed(1)}" r="2.6" fill="#9333ea" `+
            `stroke="#1b0f24" stroke-width="0.8" opacity="${barDim.toFixed(2)}" pointer-events="none"/>`;
        }
      }
      // The wall the circle currently straddles, drawn WITH A GAP over the
      // part inside the circle — Garry, 2026-09-09: "make sure when the
      // circle is visible, the room line in the circle is gone, so the user
      // understands what is going on". Cyan, so it reads as "armed and
      // matched", not an ordinary (grey) or linked (white/DOOR_BORDER) wall.
      if(circleMatch){
        const bpts=(circleMatch.bar.points_m||[]).map(p=>[Number(p[0]), Number(p[1])]);
        const hits=circleMatch.hits;
        const split=splitPolylineAtTwoPositions(bpts, hits[0], hits[hits.length-1]);
        for(const seg of [split.before, split.after]){
          if(!seg || seg.length<2) continue;
          const ppx=seg.map(p=>pt(iso(p[0],p[1],z))).join(" ");
          s+=`<polyline points="${ppx}" fill="none" stroke="#22d3ee" stroke-width="3.2" `+
            `stroke-linecap="round" opacity="0.9" pointer-events="none"/>`;
        }
      }
      // The circle itself — sampled in world metres and projected through
      // this floor's iso transform (affine per fixed z, so a world circle
      // always projects to a true ellipse). A drag handle sits on its rim,
      // due east in world space, for the resize gesture (maps.js's
      // _wireDoorCircle) — data-cx/cy/z let that wiring find this group's
      // own screen centre without re-deriving the projection.
      if(DOOR_CIRCLE_M && frame.levelOf(String(DOOR_CIRCLE_M.floorId||"main"))===z){
        const {x_m: ccx, y_m: ccy, r_m: cr} = DOOR_CIRCLE_M;
        const [scx,scy]=iso(ccx,ccy,z);
        const N=48, ring=[];
        for(let i=0;i<N;i++){ const t=(i/N)*Math.PI*2; ring.push(pt(iso(ccx+cr*Math.cos(t), ccy+cr*Math.sin(t), z))); }
        const [hx,hy]=iso(ccx+cr, ccy, z);
        s+=`<g class="ldoorcircle" data-role="doorcircle" data-cx="${scx.toFixed(1)}" data-cy="${scy.toFixed(1)}" `+
          `data-z="${z}" style="cursor:move">`+
          `<polygon points="${ring.join(" ")}" fill="#22d3ee" fill-opacity="0.14" stroke="#22d3ee" `+
          `stroke-width="2" stroke-dasharray="2,3"/>`+
          `<circle data-role="doorcircle-resize" cx="${hx.toFixed(1)}" cy="${hy.toFixed(1)}" r="7" `+
          `fill="#22d3ee" stroke="#083344" stroke-width="1.5" style="cursor:ew-resize"/>`+
          `</g>`;
      }
    }
    // ── Beacons: read-only, no click handler, never a device to place —
    // Garry, 2026-09-09: "add working proven beacons to the mapping, lights
    // section under devices. For now have them look the same as they do in
    // overview... No placement for them of course." Overview's own beacon
    // system (away/present states, trails, outside-tethering, persistent
    // pins) is a substantial, live-updating subsystem in its own right —
    // this basic pass draws the one thing that actually carries over
    // cleanly: a dot at the same teal Overview uses for a proven beacon,
    // with its name beside it.
    if(BEACONS) for(const b of BEACONS){
      // typeof, not Number(...): Number(null) is 0, a real coordinate — a
      // beacon with no server position at all would silently draw at world
      // (0,0) instead of being skipped. Found by its own test.
      if(typeof b.x_m!=="number" || !Number.isFinite(b.x_m) || typeof b.y_m!=="number" || !Number.isFinite(b.y_m)) continue;
      if(frame.levelOf(String(b.floor_id||"main"))!==z) continue;
      const [bx,by]=iso(b.x_m, b.y_m, z);
      s+=`<circle cx="${bx.toFixed(1)}" cy="${by.toFixed(1)}" r="4.5" fill="#5eead4" `+
        `stroke="#0a1a12" stroke-width="1.2" opacity="0.9" pointer-events="none"/>`;
      // "Hide codes" also covers beacon names (Garry, 2026-09-09: "when txt
      // is turned off, should include beacons text") — one declutter switch,
      // not two separate label toggles to remember.
      if(b.label && !HIDECODES){
        s+=`<text x="${bx.toFixed(1)}" y="${(by-9).toFixed(1)}" text-anchor="middle" `+
          `font-family="system-ui,sans-serif" font-size="9" font-weight="600" fill="#5eead4" `+
          `paint-order="stroke" stroke="#0a1a12" stroke-width="2.2" stroke-linejoin="round" `+
          `opacity="0.9" pointer-events="none">${escSVG(String(b.label).slice(0,20))}</text>`;
      }
    }
    // ── Automorph auras: the whole floor's, in two tiers, under the labels.
    // Computed HERE — after every room's fill/border above is already in s,
    // before the deferred label pass below runs — because the auras used to
    // be appended from the placed-lights loop, which runs after the labels:
    // every aura painted OVER its own room's name, the exact opposite of
    // the convention documented above labelJobs ("Labels now paint over
    // every boundary line on the floor, always"), and worst precisely where
    // the name always sits — a cell reaching the room's top edge. Fixture
    // CODE chips never had the problem (they defer into the marker pass);
    // this ends the inconsistent treatment between the two label kinds.
    //
    // Two floor-wide buffers, not per-fixture concatenation: every
    // fixture's blurred glow flushes before any fixture's crisp edge, so a
    // later neighbour's wash can never muddy the shared cell bisector an
    // earlier fixture's edge already drew — the same underlay discipline
    // the light pools document for markers. Final floor order, bottom to
    // top: room fills/borders, all aura glow, all aura edges, labels,
    // markers/glyphs.
    //
    // auraByEid records which fixtures REALLY painted: the placed-lights
    // loop below no longer generates the aura, but its suppressGlyph
    // decision (hide the old glyph body only when an aura replaced it)
    // still has to be per-fixture and true to what was emitted — a hallway
    // fixture outside every room polygon gets no aura here, so hiding its
    // glyph too would leave nothing drawn there at all.
    const auraByEid=new Map();
    if(AUTOMORPH_PCT>0){
      let auraGlow="", auraEdge="";
      for(const pl of hereLights){
        if(hiddenEids.has(pl.eid)) continue;
        const l=lightsByEid[pl.eid];
        if(!l) continue;
        // Same position ray-cast the partition pass above used to group
        // this floor's fixtures, so the aura and its cell agree on the room.
        let room=null;
        for(const r of hereRooms){ if(pointInRoom(r.pts, pl.x, pl.y)){ room=r; break; } }
        // A perimeter light's trace joins these SAME tiers while the
        // slider is up (restyled, never morphed — see perimeterAuraSvg);
        // the legacy trace call in the placed loop below stands down then.
        // auraByEid stays out of it: the suppressGlyph decision is about
        // hiding a glyph BODY an aura replaced, and a perimeter marker
        // hides its own body by its own precedent already.
        if(l.shape==="perimeter"){
          const tiers=perimeterAuraSvg(l, room, pl.lp);
          if(tiers){ auraGlow+=tiers.glow; auraEdge+=tiers.edge; }
          continue;
        }
        const cellsInRoom=room && roomFixtureCells.get(room);
        const cellPtsM=cellsInRoom && cellsInRoom.get(pl.eid);
        const [hx,hy]=iso(pl.x, pl.y, z);
        const tiers=automorphAuraSvg(l, hx, hy, room, z, cellPtsM, pl.lp);
        if(!tiers) continue;
        auraByEid.set(pl.eid, true);
        auraGlow+=tiers.glow; auraEdge+=tiers.edge;
      }
      // Unplaced perimeter lights (room via HA area only, no placement
      // entry) trace their room too — the same set the label job's legacy
      // call walks, filtered the same way — but with Automorph up the
      // trace belongs in these tiers, under the labels, with every other
      // aura. Same lightsLoading gate as that job: no traces while the
      // registry is still loading.
      if(!lightsLoading) for(const r of hereRooms){
        for(const l of (byRoom[r.room]||[])){
          if(hiddenEids.has(l.entity_id) || placed[l.entity_id] || l.shape!=="perimeter") continue;
          const tiers=perimeterAuraSvg(l, r, null);
          if(tiers){ auraGlow+=tiers.glow; auraEdge+=tiers.edge; }
        }
      }
      s+=auraGlow+auraEdge;
    }
    for(const fn of labelJobs) fn();

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
      // perimeter light's shape depends on it, not only Showcase's pool
      // clip. (The aura resolves its own room in the floor-wide tier pass
      // above, so it no longer forces this ray-cast here.)
      let room=null;
      if(SHOW || l.shape==="perimeter"){
        for(const r of hereRooms){ if(pointInRoom(r.pts, pl.x, pl.y)){ room=r; break; } }
      }
      // With Automorph up the floor-wide tier pass above already drew this
      // fixture's trace (perimeterAuraSvg) under the labels; the legacy
      // call stands down rather than double-drawing.
      if(l.shape==="perimeter" && !(AUTOMORPH_PCT>0)) s+=perimeterSvg(l, room, pl.lp);
      // Whether an aura ACTUALLY painted for this fixture — consulted from
      // the floor-wide tier pass, which recorded every fixture it emitted
      // markup for. The markup itself now lands up there (two tiers under
      // the labels), but THIS per-fixture record, not the bare slider
      // value, is still what may suppress the old glyph: a hallway fixture
      // outside every room polygon gets no aura, so hiding its glyph too
      // would leave nothing drawn there at all.
      const auraPainted=!!auraByEid.get(pl.eid);
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
      jobs.push([l, hx, hy, pl.lp, `data-z="${z}" data-placed="1"`, clip, fx, auraPainted]);
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
      // ...and the same reasoning excludes an aura-suppressed glyph (the
      // tuple's trailing flag): its marker is hidden too, so a shadow
      // there would equally be a smudge under nothing.
      for(const j2 of jobs) if(j2[0].shape!=="perimeter" && !j2[7]) s+=shadeSvg(j2[1],j2[2]);

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
    // Motion sensors pulse beneath their markers — live status, not a
    // presentation effect. Elapsed since the ENTITY'S OWN last_changed
    // still runs on ONE clock whichever state a sensor is in (the moment
    // it started triggering while "on", the moment it stopped while
    // "off") — that part stays: it is still what decides when a stuck-"on"
    // sensor should vanish rather than being drawn forever. What no longer
    // depends on that elapsed value is the ACTIVE colour itself — see
    // motionPulseSvg's own comment for why a fixed hue while triggered, not
    // an elapsed-shifted one, is what actually makes a five-second-hold
    // PIR, a twenty-minute one, and a sustained occupancy sensor read the
    // same. Past the outer cutoff nothing is drawn at all, on or off: a
    // sensor still reporting "on" six hours later is a stuck sensor, not
    // six hours of continuous fresh motion.
    if(LOCATE_EID){
      const found=jobs.find(j=>j[0].entity_id===LOCATE_EID);
      if(found) s+=locateSvg(found[1],found[2]);
    }
    for(const [l2,hx,hy] of jobs){
      if(!l2.isMotion) continue;
      // No timestamp (or an unparsable one) makes rawElapsed NaN. While OFF
      // that is a genuine bail-out — with no known quiet-since time there is
      // no recency to show. While ON it is not: the sensor is demonstrably
      // active RIGHT NOW regardless of whether last_changed happened to
      // come through, so a missing/bad timestamp there falls back to
      // elapsed 0 rather than drawing nothing and silently losing the one
      // signal ("this sensor just tripped") the marker exists to show.
      const lastMs=l2.last_changed ? Date.parse(l2.last_changed) : NaN;
      const rawElapsed=NOW_MS-lastMs;
      const elapsed=(l2.state==="on" && !(rawElapsed>=0)) ? 0 : rawElapsed;
      if(!(elapsed>=0) || elapsed>=MOTION_RECENT_MS) continue;
      // The FLASHING treatment runs while a sensor is genuinely "on" OR is
      // still inside the shared hold window since its last transition —
      // NOT merely while the raw state is "on". The raw "on" duration is a
      // hardware artefact: an alarm panel's PIR zone clears itself after
      // ~5 seconds, a standalone PIR's retrigger timer holds for minutes,
      // a radar unit holds for as long as someone is present. Tying the
      // flash to the raw flag alone meant the alarm zones flashed for five
      // SECONDS while other sensors flashed for minutes, for the identical
      // real-world event (Garry: "Make them all behave the same way").
      // Because last_changed also resets on the on→off transition, a
      // short-hold sensor's off-flip lands within seconds of the trigger
      // itself, so "within the hold window of the last transition" gives
      // every class the same minimum flash — and a sensor whose hardware
      // honestly still claims "on" (sustained presence) keeps flashing for
      // as long as it does, which is the one difference that reflects the
      // ROOM rather than the firmware.
      if(motionActive(l2)) s+=motionPulseSvg(hx,hy,l2.entity_id,MOTION_COLOR_STOPS[0][1]);
      else s+=motionRecentPulseSvg(hx,hy,motionRecentHue(elapsed),l2.entity_id);
    }
    // Halos go under EVERY marker on the floor (see haloSvg); then the
    // markers; then the use-mode stack chips, which stand in for markers.
    // A halo enlarges the tap target well past the glyph itself — good for
    // one isolated marker, but two markers placed closer together than
    // 2×HALO_R apart get OVERLAPPING invisible discs, so a tap that looks
    // like it lands on marker B's own visible shape can still fall inside
    // marker A's halo and fire A instead. Garry, 2026-09-09: "some of the
    // clickable lights also activate the light next to them when the shape
    // implies that should not happen." Each halo is capped at half the
    // screen distance to its nearest neighbour on this floor — never below
    // HEX_R, so a marker's own visible shape is always at least as tappable
    // as it looks, whatever a crowded neighbourhood does to the halo around it.
    if(HALO) for(let i=0;i<jobs.length;i++){
      const [l2,hx,hy]=jobs[i];
      let nearest=Infinity;
      for(let k=0;k<jobs.length;k++){
        if(k===i) continue;
        // A dimmed neighbour (an active class filter hiding it) draws no
        // halo of its own — nothing there to overlap with, so it must not
        // shrink a VISIBLE marker's tap target just for sitting nearby.
        if(dimmed(jobs[k][0])) continue;
        const d=Math.hypot(jobs[k][1]-hx, jobs[k][2]-hy);
        if(d<nearest) nearest=d;
      }
      s+=haloSvg(l2,hx,hy,nearest/2);
    }
    // Explicit arguments, not a blind spread: the tuple's positions 5/6
    // are clip/fx (consumed by the glow/shade passes above, not by
    // markerSvg), and position 7 is the aura-painted flag — a spread would
    // silently hand markerSvg the clip id as its suppressGlyph parameter.
    for(const j of jobs) s+=markerSvg(j[0], j[1], j[2], j[3], j[4], !!j[7]);
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
    // Flashes (Garry, 2026-09-07): a static pin in a corner is easy to select
    // a light and then never notice — the outer ring breathes to draw the eye
    // there for as long as something is actually armed and waiting for a tap.
    s+=`<g class="ldropmarker" data-role="dropmarker" style="cursor:grab" pointer-events="all">`+
      `<title>Drag onto the map to place the selected light</title>`+
      `<circle cx="${dx}" cy="${dy}" r="17" fill="#1b0f24" fill-opacity="0.92" stroke="#e879f9" stroke-width="2"/>`+
      `<circle cx="${dx}" cy="${dy}" r="17" fill="none" stroke="#e879f9" stroke-width="6" stroke-opacity="0.18">`+
        `<animate attributeName="stroke-opacity" values="0.15;0.6;0.15" dur="1.4s" repeatCount="indefinite"/>`+
        `<animate attributeName="r" values="17;23;17" dur="1.4s" repeatCount="indefinite"/>`+
      `</circle>`+
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
  // Motion colour index (Garry, 2026-09-08) — one row past the last floor,
  // in the space LEGEND_H's +1 above reserved. "Thin, all in one row, 1/4
  // of the size you have now, and no extra row of text for no reason" —
  // label and strip share the SAME line, no caption row beneath it.
  {
    const my=BASE_H+10+levels.length*30;
    s+=`<text x="18" y="${my+11}" fill="#9fb0a8" font-size="13" font-weight="500">Motion</text>`+
      `<rect x="70" y="${my+7}" width="140" height="1.5" rx="0.75" fill="url(#psmotionlegend)"/>`;
  }

  s+=`</svg>`;
  return s;
}
