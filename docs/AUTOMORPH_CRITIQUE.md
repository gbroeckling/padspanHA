# Automorph aura — design critique (2026-09-07)

A four-lens automated design review of the Automorph feature in
`custom_components/padspan_ha/www/padspan-ha/views/iso_lights.js`: the morph
geometry (**shape**), the shading/materiality of the rendered aura (**light**),
map-level balance (**composition**), and applicable technique prior art
(**craft**). 27 findings, each with a concrete fix; two of them are explicit
no-change verdicts kept here as guardrails.

File/line references describe the tree at commit `70f3fae` (the state the
critique reviewed); symbols drift as fixes land — trust the symbol names,
not the line numbers.

Application order (the order the fixes were applied in): group A
cell-ring smoothing → B ring correspondence → C `applyHardness` rework →
D composition/paint order → E1 lighting/layer stack → E2 colour systems.
24 of 27 findings are now applied (statuses below); three stay deferred
behind the gates the critique itself set, for the next pass after a live
visual check.

**Adversarial review of the applied work (2026-09-08).** After all six
groups landed, five independent read-only reviewers re-examined the
result — one lens each for geometry, SVG output, finding-completeness,
regression risk, and test quality. 16 findings, every one backed by
execution (node renders with parsed ring geometry, byte-level diffs
against the pre-critique tree, spec-compliant rasterization) rather than
reading — full record in `AUTOMORPH_REVIEW.md`. The dominant root cause:
`offsetPolygonInward` was built for sparse hand-traced room polygons and
folded when fed the new dense Chaikin-smoothed cell rings, producing
self-intersecting rings at the hardness rest position and letting
neighbouring auras cross the non-overlap gap — both blockers. All 16
were fixed, reproduction-first (each repair had to rebuild the finding's
exact failure scenario and observe the defect before touching code); the
findings below that a repair corrected say so inline.

## Shape — morph geometry

### 1. Fixed 24-point arc-length correspondence twists mid-slider shapes on concave cells

**Status:** Applied — `80efdf3`.

**Impact:** high

**Problem:** automorphRing (iso_lights.js:302-309) resamples BOTH the icon and the target ring to the same constant AUTOMORPH_N=24 points, then lerps index-for-index after each ring independently picks its own 'topmost point' as index 0 (alignRingStart, line 234-247). The design comment above AUTOMORPH_N (line 177-191) explicitly justifies index-lerp because 'both endpoints are close to convex' -- true when the target was the whole room, but false now that the target is a per-fixture CELL from buildRoomFixtureCells (line 493), which is carved by Dijkstra distance-field competition against neighbours and is routinely concave (a bite taken out by one or two neighbouring fixtures) or lopsided. Two independently-chosen 'nearest my own bounding-box top' start points on an icon (usually near-circular/symmetric) and an irregular concave cell have no reason to correspond to the same relative position, so a straight-line lerp between them can visibly cross/twist at mid-slider (t~0.3-0.6) exactly where Garry's directive says the aesthetic should read cleanest. 24 points is also too coarse to preserve a cell's concave notch at all once it IS reached at t=1 -- the notch just gets rounded away by the sparse resample, silently blunting the non-overlap partitioning the whole cell system exists to make visible.

**Fix:** 1) In automorphRing, after computing `a=alignRingStart(resamplePolygonRing(iconAbs, N))` and `b=alignRingStart(resamplePolygonRing(roomRingAbs, N))`, add a cyclic-shift search that re-picks b's start index to MINIMIZE total squared point-to-point distance against a (O(N^2), ~4096 ops at N=64 -- trivial per fixture, trivial again x100 fixtures): `function bestRotationalMatch(a,b){ let bestShift=0,bestCost=Infinity; for(let s=0;s<b.length;s++){ let c=0; for(let i=0;i<a.length;i++){ const bp=b[(i+s)%b.length]; c+=(a[i][0]-bp[0])**2+(a[i][1]-bp[1])**2; } if(c<bestCost){bestCost=c;bestShift=s;} } return Array.from({length:b.length},(_,i)=>b[(i+bestShift)%b.length]); }` then use the rotated b in the final lerp. This keeps alignRingStart's own winding-normalization role but stops relying on 'topmost point' as a stand-in for correspondence quality. 2) Make the point count adaptive instead of a flat constant: `const N=Math.max(AUTOMORPH_N, Math.min(64, roomRingAbs.length));` -- a plain 4-8 point room polygon still resamples to 24 (byte-identical for every existing test, all of which use 4-point squares), but a Chaikin-smoothed cell ring (hundreds of points pre-resample) gets proportionally more correspondence points, so its concave features survive into the final ring instead of being averaged away.

**Risk:** Raising N changes how far positive hardness's Catmull-Rom softening (ringPathD) visually rounds a corner at the same slider value, since the spline's control-point offset scales with local chord length (shorter chords from more points -> a visually gentler curve per corner at hardness=100 than today). Worth a quick before/after look at the soft end of the slider after this change, not a functional risk.

### 2. Marching-squares cell rings have no baseline smoothing -- grid jitter shows even at the hardness slider's 'clean' rest position

**Status:** Applied — `f869e46`. Corrected by `4e5b4f7` — the 2026-09-08 adversarial review found the offset stage folded on this smoothed input; 4e5b4f7 fixed the root cause.

**Impact:** high

**Problem:** buildRoomFixtureCells traces each fixture's cell with marching squares over a coarse grid (`step=Math.max(0.05, dimM/48)`, line 499) driven by an 8-connected approximate-geodesic (Dijkstra) field plus a deliberate sine wobble (line 527-536). The Dijkstra field itself is only approximately isotropic (8-connected octile distance has a few-percent directional error), and the marching-squares crossing points (stitchSegmentsToRing output, line 454) are quantized to that grid. None of this is smoothed before automorphAuraSvg consumes it as `targetPts` (line 2139) -- and at the hardness slider's rest position (0), ringPathD draws these points as a raw straight M/L/Z polygon (line 341), so the grid's sampling noise renders directly as visible small zig-zags along what should read as a soft, deliberate bisector curve. This contradicts the slider's own contract ('0 = today's unchanged, clean straight treatment') -- the noise is a NEW artifact the cell-partitioning feature introduced, not something 0 was ever supposed to mean, and it is entirely independent of where the hardness dial sits (it's equally present, just harder to see, once softening is dialed up over it).

**Fix:** Add a small Chaikin corner-cutting helper next to stitchSegmentsToRing (~line 482): `export function chaikinSmooth(ring, iterations){ let pts=ring; for(let it=0; it<(iterations||1); it++){ if(pts.length<3) break; const out=[]; const n=pts.length; for(let i=0;i<n;i++){ const a=pts[i], b=pts[(i+1)%n]; out.push([a[0]+(b[0]-a[0])*0.25, a[1]+(b[1]-a[1])*0.25]); out.push([a[0]+(b[0]-a[0])*0.75, a[1]+(b[1]-a[1])*0.75]); } pts=out; } return pts; }` then in buildRoomFixtureCells's final loop, replace `if(rings.length) cells.set(id, rings[0]);` (line 580) with `if(rings.length) cells.set(id, chaikinSmooth(rings[0], 2));`. Two passes remove grid-quantization corners while barely changing the traced area/position (Chaikin is a well-known area-preserving-ish corner cut, unlike a Gaussian blur which would shrink and drift the shape). Also apply the same `chaikinSmooth` to the fallback branch in automorphAuraSvg (`targetPts=(cellPtsM && cellPtsM.length>=3) ? cellPtsM : room.pts`, line 2139) so a fixture that fails to resolve a cell and falls back to the raw room polygon doesn't suddenly show a visually different (sharper, offsetPolygonInward-bevelled) corner language than every other fixture in the same room.

**Risk:** Chaikin roughly quadruples point count per iteration (n -> 4n over 2 passes), but that happens before resamplePolygonRing collapses it back down inside automorphRing, so render cost is unaffected. No existing test reads buildRoomFixtureCells's raw point count or exact coordinates (test_partition_two_fixtures_get_non_overlapping_cells checks non-overlap membership, not vertex positions), so this should not need test changes.

### 3. applyHardness spikes away from the ring's own vertex-average centroid, not the fixture -- drifts off-anchor on lopsided cells

**Status:** Applied — `cfb6888`.

**Impact:** medium

**Problem:** applyHardness (line 317-324) scales every point outward from `cx,cy` computed as the plain arithmetic mean of the ring's own points. That is a reasonable stand-in for 'centre' when the ring is a symmetric icon or a roughly-rectangular whole room (the case this slider was designed and tested against -- see test_hardness_negative_spikes_outward_from_the_centroid, a symmetric square). It stops being a good stand-in now that the ring is frequently a fixture's own lopsided, non-overlap CELL: a fixture near a wall or corner routinely has a cell that reaches far more in one direction than another, so the vertex-average sits noticeably away from the fixture's actual position (hx,hy). At negative hardness, 'sharpen' then reads as the whole aura shifting/ballooning off to one side of the light rather than spiking outward in place around it -- the opposite of 'geometrically aligned to this fixture'.

**Fix:** Give applyHardness an optional anchor: `export function applyHardness(ring, hardness, anchor){ const h=Math.max(-100, Math.min(100, hardness||0)); if(h>=0 || ring.length<3) return ring; const cx=anchor?anchor[0]:ring.reduce((a,p)=>a+p[0],0)/ring.length; const cy=anchor?anchor[1]:ring.reduce((a,p)=>a+p[1],0)/ring.length; const k=1+(-h/100)*0.35; return ring.map(p=>[cx+(p[0]-cx)*k, cy+(p[1]-cy)*k]); }` -- omitting `anchor` reproduces today's exact behaviour (all existing tests, which never pass a third argument, are unaffected). In automorphAuraSvg (line 2144-2146), pass the fixture's own drawn position: `applyHardness(automorphRing(iconLocal, hx, hy, roomPx, AUTOMORPH_PCT/100), AUTOMORPH_HARDNESS, [hx,hy])`.

**Risk:** Purely additive/optional-parameter change; zero risk to the symmetric-icon and whole-room cases the existing tests cover. Worth confirming live that anchoring at hx,hy (rather than the ring's own centroid) still looks like 'sharpening' rather than 'inflating' for a cell where hx,hy sits very close to the cell's own edge (e.g. a fixture pushed into a corner) -- the spike will visibly push some points much farther than others in that case, which may actually read better (radiating from the real light) but is worth a quick look.

### 4. Room polygons keep every traced/original vertex (plus occasional MITER_LIMIT bevel corners) with no smoothing pass of their own

**Status:** Applied — `f869e46`. Corrected by `4e5b4f7` — the 2026-09-08 adversarial review found this smoothing rounded the sparse room-fallback ring at metre scale; 4e5b4f7 made the smoothing scale-aware.

**Impact:** medium

**Problem:** offsetPolygonInward (line 78-137), which produces the room-shape target whenever a fixture's cell doesn't resolve, preserves one vertex per input room-trace vertex (after only near-duplicate collapse, line 85-91), including its own MITER_LIMIT=2.5 bevel treatment on any corner whose offset intersection overshoots (line 106-133) -- a flat, geometric chord standing in for what could be a real corner. A hand-traced room with several close-together vertices (the file's own comment cites 'a real 11-vertex room') or an acute corner therefore contributes its raw digitization noise and occasional flat bevels straight into the automorph ring at hardness=0, same class of artifact as finding #2 but from the room-trace side rather than the marching-squares side.

**Fix:** No separate fix needed beyond applying finding #2's `chaikinSmooth` uniformly at the point `targetPts` is chosen in automorphAuraSvg (line 2139), rather than only inside buildRoomFixtureCells -- one smoothing call covering both the cell path and the room.pts fallback path keeps the two visually consistent instead of fixing only one of them.

**Risk:** None beyond what's already noted for finding #2 -- this is the same fix applied at the shared call site rather than a second implementation.

### 5. Marching-squares grid resolution is flat (dimM/48) regardless of how many fixtures compete in a room

**Status:** Deferred — the finding's own gate: only if jitter is still visible after Chaikin smoothing

**Impact:** low

**Problem:** buildRoomFixtureCells (line 499) always divides the room's largest dimension into ~48 cells, whatever the room's size or how many fixtures' distance fields are competing inside it. A large room, or a small area with 3+ fixtures' bisectors converging near one point, gets the same absolute grid density as a simple two-fixture room -- tight concave dimples between several close bisector junctions can fall inside a single grid cell and simply not exist in the traced boundary at all, which no post-hoc smoothing pass (Chaikin included) can restore since the detail was never sampled.

**Fix:** Lower priority than findings #1-#2, which fix the more visible jitter cheaply. If still visible after those: scale divisions modestly with fixture count sharing the room, e.g. `const divs=Math.min(80, 48 + 6*(fixtures.length-1));` in place of the flat `48` at line 499, capped to bound the O(divs^2) Dijkstra cost per fixture.

## Light — shading and materiality

### 6. No cast/contact shadow behind the shape — it floats instead of sitting on the floor

**Status:** Applied — `bd9f515`. Corrected by `357fd4e` — the 2026-09-08 adversarial review found the shared bloom/nebula mask faded against the canvas, not the ring; 357fd4e made it bbox-relative.

**Impact:** high

**Problem:** automorphAuraSvg (iso_lights.js:2195-2202) draws glow, edge and gloss all from the exact same path `d`, all in the exact same position. Nothing is displaced relative to anything else. A real object under a raking upper-left light throws a shadow onto the surface behind and below it; without a displaced dark shape, there is no cue separating 'object' from 'floor it rests on' — the aura reads as one flat decal stamped on the glass. The room-perimeter/marker code already knows this trick (psshade + shadeSvg's contact-shadow ellipse under every marker), but automorphAuraSvg never uses it.

**Fix:** Add one new bottom-most layer, drawn before `glow`, reusing the SAME `d` string inside a translated group (so hardness/wobble/cell-shape stay correct for free, no new point math): compute the ring's own bbox diagonal from the already-in-scope `ring` array (cheap min/max reduce), offset along psgloss's own light-to-dark vector (dx=0.45,dy=1.0 normalized -> ~0.41,0.91) scaled to ~5% of that diagonal — `const diag=Math.hypot(maxX-minX,maxY-minY); const sdx=diag*0.05*0.41, sdy=diag*0.05*0.91;` then `<g transform="translate(${sdx.toFixed(1)},${sdy.toFixed(1)})"><path d="${d}" fill="url(#psshade)" fill-opacity="${opac(0.16)}" stroke="none" filter="url(#psclipsoft)" pointer-events="none"/></g>`. Reuses psshade and psclipsoft verbatim — zero new defs. Scaling the offset off the ring's own diagonal, not a fixed px constant, keeps it proportionate from icon-small (t=0) to room-large (t=1).

**Risk:** psclipsoft's filter region is only -8%/116% of the filtered element's own bbox; a 5%-of-diagonal offset should stay inside that margin but check live at t=1 on an elongated room cell that the shadow's blur isn't visibly clipped at its trailing edge — widen the shared filter's region a couple of percent if so (it's reused by the light-pool clip-soften too, so test both).

### 7. Stroke is one flat colour/opacity all the way around — reads as a decal outline, not a lit bevel

**Status:** Applied — `bd9f515`. Corrected by `357fd4e` — the 2026-09-08 adversarial review found the floor-wide gradient defeated the per-shape lit rim; 357fd4e gave the rim its own per-shape gradient.

**Impact:** high

**Problem:** The `edge` layer (iso_lights.js:2197-2199) strokes the entire perimeter with the same `base` colour at the same opacity on every side. A genuinely embossed object has a brighter rim where it faces the upper-left key light and a darker rim where it faces away — uniform stroke is exactly the 'flat sticker' tell: it outlines the silhouette without describing which way the surface turns.

**Fix:** Split `edge` into two stroke passes over the SAME `d`, no new geometry: (1) `edgeCore` keeps today's flat-colour role but dialed back to leave headroom — `fill="${base}" fill-opacity="${opac(0.04+0.1*t)}" stroke="${base}" stroke-opacity="${opac(0.28+0.32*t)}" stroke-width="${swid(1.3)}"`; (2) a new `edgeRim` drawn on top with NO fill, `stroke="url(#psgloss)"` (the exact same white-to-black diagonal ramp already used for gloss and every marker), `stroke-opacity="${opac(on?0.55:0.35)}"` and `stroke-width="${swid(0.9)}"`. Because SVG gradients default to objectBoundingBox, `url(#psgloss)` painted as a STROKE automatically comes out bright on the upper-left arc of whatever polygon it's applied to and dark on the lower-right arc — a correct split highlight/shadow rim with zero new defs and zero new per-vertex geometry.

**Risk:** On a very elongated cell (a long thin partition sliver) the bounding-box-relative gradient can land its bright/dark transition off-centre from where a human eye expects the 'corner' to be — acceptable for a soft aesthetic effect, but worth a quick look on a narrow room.

### 8. No ambient occlusion — the shape's interior reads as flat as its edge

**Status:** Applied — `bd9f515`.

**Impact:** medium

**Problem:** Between the blurred wash and the crisp edge there is nothing that darkens as the surface approaches its own boundary. A raised or inset object typically shows some contact darkening just inside where it meets the surrounding surface; without it, the shape looks like a uniformly-lit flat cutout rather than a form with any cross-section.

**Fix:** Add one wide, soft, dark stroke on the SAME `d`, drawn between `shadow` and `wash` (so wash's translucent fill sits over the outer half of the stroke and mutes it, leaving only the inward-facing half reading as edge recession): `<path d="${d}" fill="none" stroke="#020617" stroke-opacity="${opac(on?0.10:0.18)}" stroke-width="${swid(3.5)}" filter="url(#psclipsoft)" pointer-events="none"/>`. Reuses `d` and psclipsoft verbatim — no inset-polygon math needed at all.

**Risk:** Stacking a second blurred layer on every fixture doubles the feGaussianBlur passes unless folded into the shared-filter-group fix below — do that fix alongside this one, not after.

### 9. On vs off differ ONLY by base hex colour — 'on' doesn't read as self-luminous, just re-tinted

**Status:** Applied — `bd9f515`. Corrected by `357fd4e` — the 2026-09-08 adversarial review found blueprint never got an on/off split; 357fd4e added one.

**Impact:** medium

**Problem:** Every opacity/stroke-width formula in automorphAuraSvg is identical for on and off; the sole difference is `base=on?"#94a3b8":"#475569"` (iso_lights.js:2159). A lit fixture and an unlit one are rendered with the same material quality at the same intensity — the only thing that changes is which grey is used, which reads as a colour swap on a static sticker, not as 'this object is emitting light' vs 'this object is inert'.

**Fix:** Give `on` two things `off` doesn't get: (1) a masked inner-bloom layer reusing the SAME `d` and the SAME psautomorphmask nebula already defines — `if(on) bloom=<path d="${d}" fill="${base}" fill-opacity="${opac(0.14+0.16*t)}" stroke="none" mask="url(#psautomorphmask)" pointer-events="none"/>` drawn just above `wash` (the radial mask fades the fill toward the shape's own bbox edge, reading as light welling up from inside rather than a hard-edged tint); (2) small on/off splits on the two layers that already exist — wash fill-opacity `opac((on?0.13:0.09)+0.26*t)` and gloss fill-opacity `opac((on?0.55:0.35)+0.4*t)`. Off correspondingly gets the stronger AO opacity already given to it in the AO finding above (0.18 vs 0.10) — matte, inert surfaces show more contact darkening and no internal glow; lit ones push light out instead.

**Risk:** None structural — this only touches opacity constants and adds one conditional layer, all routed through the existing opac()/swid() subtlety multipliers so the subtlety slider keeps working on the new pieces for free.

### 10. Naively stacking these new layers multiplies feGaussianBlur passes per fixture — a real cost at ~100 fixtures

**Status:** Applied — `bd9f515`. 8de7bba later gated this def so it is only emitted when Automorph can reference it, restoring automorph-off byte-identity.

**Impact:** medium

**Problem:** Today automorphAuraSvg applies `filter="url(#psclipsoft)"` exactly once per fixture (the `glow` layer). The three additions above (shadow, AO, bloom) each want the same soft blur, which — done the obvious way, one `filter` attribute per `<path>` — would take that to up to 4 separate rasterized blur operations per fixture, ~400 across ~100 fixtures, for an effect the goal is to keep 'cheap.'

**Fix:** Wrap the blur-needing layers in ONE group so the renderer blurs a single composited raster instead of four: `<g filter="url(#psclipsoft)">${shadow}${ao}${wash}${bloom}</g>` (drop the per-path `filter=` attributes on those four and keep it only on the group), then the sharp, unblurred `edgeCore+edgeRim+gloss` on top outside that group exactly as today. Same visual result, one blur pass per fixture instead of up to four.

**Risk:** A shared group filter's default region is relative to the GROUP's own bbox, which now includes the shadow's offset copy — re-check that psclipsoft's -8%/116% margin still comfortably contains the shadow's blurred bleed once it's the group's bbox driving the region, not just `d`'s own bbox (same check as finding 1, but now it's one region shared by four layers instead of one).

## Composition — map-level balance

### 11. Hardness slider can blow through the non-overlap gap it was given

**Status:** Applied — `cfb6888`.

**Impact:** high

**Problem:** applyHardness's negative-hardness branch scales the ALREADY-morphed ring outward from its own centroid by up to 35% (k=1+(-h/100)*0.35) at exactly the point in the pipeline where automorphRing has just pulled that ring onto the inset cell/room boundary. The push is proportional to the ring's OWN size; the gap it needs to stay inside is a small fixed on-screen constant (~16px per side via defaultPerimeterMarginM). On any normal-sized cell, 35% of the ring's own radius is far larger than that fixed inset, so pushing the hardness slider toward 'hard' reliably drives two neighbouring cells' auras into overlap -- and can push a wall-adjacent aura across the room's own boundary in the same motion. This silently defeats the non-overlap partitioning Garry called out as 'a complex and critical element,' using a control (hardness) that was never meant to touch spacing at all.

**Fix:** Cap the outward displacement in absolute space by the same marginM automorphAuraSvg already computed for that fixture's inset, instead of a flat percentage of the ring's own extent. Thread marginM into applyHardness (e.g. applyHardness(ring, hardness, maxGrowM)) and clamp each point's outward move to Math.min((-h/100)*0.35*selfExtent, maxGrowM*0.85). A hard shape still looks more angular near its own centre; it just stops eating the gap between neighbours.

**Risk:** Very hard settings on very small/tightly-packed cells will visibly plateau (bounded growth) rather than spiking outward -- an intentional trade-off, worth a quick look on a room with several fixtures.

### 12. Aura paints over the room's own name, breaking the file's own label rule

**Status:** Applied — `34437a6`.

**Impact:** high

**Problem:** Per-floor paint order is: room fill/border -> labelJobs (room name, tap target, unplaced stack) -> the placed-lights loop, which is where automorphAuraSvg's markup gets appended into s. So every aura draws ON TOP of that room's own name label -- the opposite of the convention this file documents a few lines above labelJobs ('Labels now paint over every boundary line on the floor, always, the same way markers already paint over every room'). A cell reaching toward the room's top edge -- exactly where the name always sits -- can wash its glow/edge/gloss over text that already fights for legibility (shrunk to fit, nudged off markers, given its own halo stroke). Fixture CODE chips don't have this problem since they're deferred into the true final marker pass, so the two label types now get inconsistent treatment for no reason tied to what they are.

**Fix:** Move the aura draw into the room loop itself, right after that room's own fill/border/glow polygons and before that room's labelJobs.push(...) call. roomFixtureCells is already built before the room loop starts, so every fixture's room/cellPtsM is available there -- this only moves WHERE the resulting markup is appended, not how it's computed.

**Risk:** Needs a small bookkeeping change to iterate 'this room's fixtures' at that point in the loop (not currently assembled there) -- no geometry change.

### 13. Aura's opacity ceiling outweighs the room's own colour identity

**Status:** Applied — `bd9f515`. Corrected by `a965458` — the 2026-09-08 adversarial review found the rebalance missed its own stated target by ~4x once every layer was summed; a965458 re-budgeted all five together.

**Impact:** high

**Problem:** At the default subtlety=0, the aura's gloss layer alone reaches 0.5-0.9 fill-opacity (0.5+0.4*t) and its glow layer 0.10-0.36 (0.10+0.26*t), while the room's own colour fill+centre-glow it sits on top of totals only ~0.085-0.135 (Showcase) or ~0.16-0.32 (working). Once Automorph is turned up, the neutral-grey overlay is visually heavier than the room's own colour across most of the room's footprint -- the reverse of Garry's own ask ('lines... mostly grey, so they don't clash' implies grey stays quiet next to the room's hue, not sits above it).

**Fix:** Rebalance the three layers' ceilings so their combined opacity stays under roughly half the room's own fill+glow weight at t=1/no subtlety -- e.g. drop gloss from 0.5+0.4*t to 0.18+0.16*t (peak ~0.34) and glow from 0.10+0.26*t to 0.06+0.14*t (peak ~0.20), leaving the thin edge stroke as the layer that signals 'distinct shape' rather than the fill layers doing it via a flat wash.

**Risk:** Pure constant tuning, no structural change -- just re-check the on/off contrast still reads clearly at the new ceilings.

### 14. One inset constant serves two different composition jobs

**Status:** Applied — `34437a6`.

**Impact:** medium

**Problem:** automorphAuraSvg insets whichever target it got (a fixture's own partition cell, or the room's full outline when no cell resolved) by the exact same defaultPerimeterMarginM(frame) -- a constant tuned for ONE job: a shape sitting a plausible cove-distance off a static wall. Reused for the OTHER job -- separating two comparably-weighted aura 'objects' from each other -- that same small constant is what produces the 'tile nearly edge-to-edge' read: the combined gap between two neighbours is only 2x a margin sized for one shape against an inert wall, not for two shapes that need to read as separate things.

**Fix:** Give the interior (fixture-vs-fixture) case a distinctly larger multiple of the same base constant: marginM = defaultPerimeterMarginM(frame) * (cellPtsM ? 1.6 : 1). One line, still frame-scale-relative so the gap stays visually constant at any zoom, and leaves every other caller of defaultPerimeterMarginM (the real perimeter shape) untouched.

**Risk:** A room with several fixtures could see individual cells shrink a bit further once the interior margin grows -- buildRoomFixtureCells' existing reach-cap/weight logic already handles a squeezed cell by falling back to the room outline, so this composes with what's already there.

### 15. Shared diagonal highlight drifts per-cell instead of reading as one light source

**Status:** Applied — `ea25659`.

**Impact:** medium

**Problem:** The aura's gloss layer reuses psgloss, an objectBoundingBox gradient -- cheap because ordinarily every shape sharing it is a near-uniform hexagon, so the 'same' diagonal ramp lands at basically the same angle everywhere. Automorph cells are not uniform: marching-squares output ranges from thin wedges to near-room-sized blobs, each with its own aspect ratio, so the identical 0.15,0 -> 0.6,1 ramp is stretched differently per cell. Across a room with several fixtures the highlight visibly lands at a different angle/spread on each one -- exactly the 'two suns' outcome this file's own comment on psgloss says the shared ramp exists to avoid -- and the drift compounds at the ~100-fixture scale Automorph targets.

**Fix:** Add one extra per-floor gradient, psglossauto, with gradientUnits="userSpaceOnUse" positioned across that floor's own slab bounding box (x0,y0_/x1,y1_, already computed before the room loop) instead of per-shape. That's one definition per FLOOR, not per fixture, so it costs nothing extra at 100 fixtures. Point the aura's gloss layer at psglossauto instead of psgloss; leave psgloss itself untouched so markers/rooms keep exactly what they have.

**Risk:** None to existing rendering -- purely an additive defs entry and one attribute swap inside automorphAuraSvg's glow style.

### 16. Flat grey gives neighbours no way to read as separate objects beyond a thin edge

**Status:** Applied — `ea25659`.

**Impact:** medium

**Problem:** base is exactly one of two hex values (on/off) for every fixture on the map. With subtlety at its default the edge stroke is the only per-shape differentiator, and it's the first thing subtlety fades toward nothing -- so at moderate-to-high subtlety, two adjacent same-state cells become indistinguishable except by the gap between them (which findings 1 and 4 already show can itself shrink to nothing). There's currently no signal that a busy room is N separate fixtures rather than one unevenly-drawn shape.

**Fix:** Derive a small, deterministic lightness offset from data the call site already has -- automorphFixtureWeight(entry&&entry.width_cm, entry&&entry.height_cm), 0.25-2.5, 1=no recorded size -- mapped to roughly +-6-8% lightness around whichever base the on/off state picked, clamped well inside the existing on/off gap so state stays unambiguous. A bigger manually-sized fixture reads very slightly more present, a small one recedes slightly -- reusing the same 'no Math.random(), reproducible' discipline the cell wobble already established, and reusing data (entry) automorphAuraSvg already receives rather than adding a new seed scheme.

**Risk:** Needs a small lighten(hex,pct) helper if none exists yet in this file; keep the band narrow so two default-weight (1) neighbours -- the common case -- still look essentially identical apart from edge/gap, so this reads as a bonus cue, not the primary way neighbours are told apart.

### 17. Aura has no clip-path in working mode (or Showcase), so blur/overshoot can cross the room's own wall

**Status:** Applied — `34437a6`. 8de7bba later gated these defs so they are only emitted when Automorph can reference it, restoring automorph-off byte-identity.

**Impact:** medium

**Problem:** Showcase pools are clipped to their room via psclip_${ri}, but automorphAuraSvg never clips its own output -- and roomClip is populated only inside the if(SHOW){...} block (the clipPath defs are built there), even though Automorph itself is gated solely on opts.automorph/AUTOMORPH_PCT, independent of Showcase. So in working mode roomClip is empty for the entire render, and even in Showcase the aura's own blur filter (psclipsoft, applied here with no clip) plus finding 1's hardness overshoot have a clear, currently-unblocked path to visibly cross the room's own boundary line rather than just a neighbour's cell -- precisely the small-room case this file already flags elsewhere (the 1.57m bedroom arm noted in defaultPerimeterMarginM's own comment).

**Fix:** Build the room clip-path defs UNGATED -- the same precedent this file already sets for psmotion/psautomorphgrad/roomGlowIds ('UNGATED (both modes): ...it has to read on the working map too') -- and wrap automorphAuraSvg's returned markup in clip-path="url(#${roomClip.get(room)})", the same mechanism pools already use.

**Risk:** Moving clip-path defs generation out of the if(SHOW) block adds rooms.length more <clipPath> defs to the working-mode render -- O(rooms), not O(fixtures), so still cheap at any fixture count.

## Craft — technique prior art

### 18. Metaball-style junction smoothing via Chaikin corner-cutting on the raw partition ring

**Status:** Applied — `f869e46`. Corrected by `4e5b4f7` — the 2026-09-08 adversarial review found neighbouring rendered rings could still cross; 4e5b4f7 fixed the shared inset pipeline this smoothing feeds.

**Impact:** high

**Problem:** buildRoomFixtureCells (iso_lights.js:493-583) already IS an implicit-field/metaball construction — a per-fixture geodesic distance field, min-over-others minus mine, zero-crossed with the same marching-squares table isolux uses (grid step = Math.max(0.05, dimM/48), so ~8-12cm facets in a typical 4-6m room). That raw stitchSegmentsToRing output (line 579) is stored in `cells` and fed straight through as automorphAuraSvg's targetPts (line 2139) into offsetPolygonInward and then automorphRing's `b` endpoint — no smoothing pass exists anywhere between the marching-squares grid and the final 24-point arc-length resample (resamplePolygonRing, AUTOMORPH_N=24). The high-frequency grid stairstep aliases into that coarse resample as small zigzags, especially visible once ringPathD's Catmull-Rom (positive hardness) tries to fit a smooth curve through noisy input.

**Fix:** In buildRoomFixtureCells, after `const rings=stitchSegmentsToRing(segs)` (line 579), run 1-2 Chaikin corner-cutting passes on `rings[0]` before storing it in `cells` — for each edge (p,q) replace it with two points at 0.75p+0.25q and 0.25p+0.75q. This is the standard post-process every metaball/marching-squares renderer and GIS contour tool applies to the exact artifact this grid produces; keep it mechanically separate from ringPathD's Catmull-Rom (that dial is the aesthetic hard/soft slider — this pass is pure grid-noise cleanup, always-on regardless of AUTOMORPH_HARDNESS). Chaikin only slides points along their own edges, so it cannot change the ring's topology or merge it with a neighbour's cell — the non-overlap guarantee survives untouched.

**Risk:** Applying this to the wrong ring (the already-resampled 24-point ring inside automorphRing) would also smooth the icon's own `a` endpoint and break the 't=0 = icon outline byte-identical' contract; over-iterating (>2-3 passes) starts eating real concave corners of an L-shaped room trace. The flood-fill Dijkstra already dominates buildRoomFixtureCells' cost, so this adds a negligible fraction at ~100 fixtures.

### 19. applyHardness's negative side is a uniform scale, not a corner-sharpening operator

**Status:** Applied — `cfb6888`.

**Impact:** high

**Problem:** applyHardness (iso_lights.js:317-324) implements 'hard, geometrically aligned' as `p => cx+(p-cx)*k` — a similarity scale about the ring centroid, same factor k for every point. A rounded/soft cell scaled up this way is still exactly as rounded, just bigger; the slider's hard side never actually adds angularity, contradicting both the UI label and the design doc's 'sharp, precise geometric angles' spec.

**Fix:** Replace the centroid-scale with the standard vector-tool 'spikiness'/Pucker-and-Bloat technique, keyed to LOCAL structure instead of the global centroid: for each point ring[i], let m = midpoint(ring[i-1], ring[i+1]); push ring[i] to `m + (ring[i]-m)*k`. Points already near-straight (small ring[i]-m) barely move; points that are already local corners get exaggerated into real spikes — angularity that reads as 'hard, geometric' because it's keyed to the shape's own existing vertices, at the identical O(24) cost applyHardness already pays.

**Risk:** At extreme hardness (-100) an already-sharp room-corner point could spike far enough to self-intersect locally; clamp the push to some multiple of the point's own local edge length rather than letting k grow unbounded.

### 20. Batch glow/edge/gloss into shared layer passes across all fixtures instead of per-fixture interleaving

**Status:** Applied — `34437a6`.

**Impact:** medium

**Problem:** automorphAuraSvg (iso_lights.js:2137-2203) returns glow+edge+gloss concatenated per fixture, and the placed-lights loop (line ~2625-2628) calls it inline per `pl`, so draw order interleaves fixture by fixture. A neighbour's blurred `glow` wash (filter psclipsoft, real even if faint) drawn AFTER an earlier fixture's crisp `edge`/`gloss` can paint over it — muddying exactly the shared cell bisectors the non-overlap partition exists to keep clean. This is the opposite of the file's own established convention: the light-pool/shadow underlay is explicitly drawn 'for the whole floor BEFORE any marker, so one light's glow can never wash over another's glyph' (comment above BEAM/poolReachM, ~line 2205-2211).

**Fix:** Accumulate two string buffers across the placed-lights loop (auraGlow, auraEdge) instead of concatenating per-fixture inside automorphAuraSvg's caller, then append the glow buffer once, followed by the edge/gloss buffer once, after the loop. Zero new geometry, identical total SVG output — only the concatenation order changes.

**Risk:** None on the geometry; only care is both new buffers must still flush entirely before markerSvg's own glyph-drawing pass, preserving 'aura fully behind the icon'.

### 21. Distance-based duotone radial fill instead of flat on/off grey

**Status:** Applied — `ea25659`.

**Impact:** medium

**Problem:** automorphAuraSvg's base fill (`on?"#94a3b8":"#475569"`, line 2159) is a flat two-value grey plus the shared psgloss diagonal sheen — a real but coarse duotone that ignores the geodesic distance field buildRoomFixtureCells already computed per fixture (literally 'how far is this point from the light'), the exact signal every hypsometric/bathymetric duotone ramp keys to.

**Fix:** Add two SHARED radialGradients (one for on, one for off — not per-fixture, so defs stay O(2) like psautomorphgrad), objectBoundingBox stops lighter near the centre fading to the current base tone at the rim, and swap `fill="${base}"` for `fill="url(#psautomorphduo_on|off)"` in the glow/edge/nebula layers. Reuses the exact gradient-def-sharing pattern already used for psroomglow/glowIds, so it adds fewer defs than several already-shipped features, not more.

**Risk:** objectBoundingBox assumes the fixture sits near its own cell's bbox centre — true by construction for a resolved cell, but the whole-room fallback path (no cell resolved) can put the fixture visibly off-centre from the gradient; worth a quick live look at that specific fallback case.

### 22. Deterministic per-vertex ring jitter as a hand-inked finish, extending the existing wobble convention upward

**Status:** Applied — `ea25659`.

**Impact:** low

**Problem:** buildRoomFixtureCells already adds a deterministic sine wobble to the fixture-vs-fixture BISECTOR (seed from `f.x*37.1+f.y*91.7+idx*13.37`, line 527-534 — explicitly never Math.random, 'the fabric alone must reproduce a render'), so partition boundaries read organic. The final rendered `ring` (post-automorphRing, post-applyHardness) gets no equivalent treatment — a perfectly clean Catmull-Rom spline over 24 points can read as slightly too plastic/CAD-perfect sitting directly on top of that organic boundary.

**Fix:** Apply the same deterministic-sine-from-position technique one level up: a small per-point radial offset on `ring` in automorphAuraSvg, after automorphRing and before applyHardness/ringPathD, amplitude scaled by t and faded toward zero on the hard (negative-hardness) side — jitter on a 'geometrically aligned' hard shape reads as dirt, not craft. Reuse the same seed-formula shape as the existing wobble for house-style consistency. O(24) sine evals per fixture, ~2400 total at 100 fixtures.

**Risk:** Must stay far smaller in amplitude than the Chaikin/corner-sharpen changes (findings 1-2) or it fights the deliberately smooth curve it sits on; skip on 'nebula' where the mask already fades the edge and the jitter would be invisible effort.

### 23. Paper-cutout contact shadow under the aura, matching psgloss's established light direction

**Status:** Applied — `bd9f515`.

**Impact:** medium

**Problem:** Every marker gets a contact shadow (psshade) that sells it as an object sitting in the room, and psgloss's own diagonal (x1=0.15,y1=0 to x2=0.6,y2=1, upper-left highlight) establishes one consistent light source for the whole drawing (line 1668-1673) — but the automorph aura, despite becoming the single largest shaded surface on the map at high room-alignment, gets no corresponding cast shadow and reads as a flat decal next to everything else the file deliberately shades.

**Fix:** In 'glow' style only, add one more blurred duplicate of path `d`, translated ~1-2px down-and-right (away from the established upper-left light source), filled black at low opacity (~0.12-0.18 before the subtlety multiplier), reusing the existing psclipsoft blur filter — drawn as the bottom-most layer, folded into finding 3's shared glow-tier buffer so a neighbour's own glow can never muddy it.

**Risk:** One more path per fixture in the already-largest style (~+33% more path elements for 'glow' at ~100 fixtures); gate to that style only and let the existing AUTOMORPH_SUBTLETY opacity multiplier fade it out at high subtlety like everything else, so it's never a fixed cost users can't dial down.

### 24. Inset the edge stroke instead of centring it, at shared cell bisectors

**Status:** Deferred — the finding's own gate: ship after smoothing lands, may be moot; measure paint cost first

**Impact:** low

**Problem:** The 'glow' style's `edge` layer (line 2197-2199) strokes `d` centred — SVG's only broadly-portable stroke alignment across the range of browsers this HA frontend has to render in (kiosk Chromium, mobile WebViews) — so at every shared bisector between two adjacent fixtures' cells, both fixtures' centred strokes bleed roughly half a stroke-width past the true boundary into their neighbour's cell, doubling/thickening the line exactly at the seam the non-overlap partition was built to keep clean.

**Fix:** Portable inside-stroke trick without relying on stroke-alignment/paint-order CSS support: draw the same `d` twice — once as today (fill only), once stroke-only but wrapped in a `<clipPath>` built from the identical `d`, so only the inward half of the centred stroke survives. One extra clipPath def per aura'd fixture, same O(fixtures) cost the file already accepts for its per-room clip paths (psclip_${ri}) — not per-colour, so it doesn't explode with fixture count.

**Risk:** Adds ~100 extra small defs/DOM nodes at full occupancy — worth measuring actual parse/paint cost, and worth shipping AFTER finding 1 (shared-field boundaries already coincide closely once Chaikin-smoothed), since the double-stroke muddiness is mild specifically because both cells already derive from the same underlying field.

### 25. Vary Catmull-Rom tension per-vertex by local field steepness, not one global hardness for every point

**Status:** Deferred — the finding's own gate: only after smoothing + correspondence are live and read well

**Impact:** medium

**Problem:** ringPathD (line 338-352) applies the identical tension factor `h/100` to every one of the 24 control points uniformly. A cell edge running flush along a real room wall (forced there by the mask, field gradient shallow) gets rounded exactly as much as a point sitting on a tight, genuinely negotiated bisector between two close competing fixtures (steep gradient) — losing a distinction the geodesic-field partition could offer for free.

**Fix:** At buildRoomFixtureCells build time, sample each stitched ring point's local field steepness (a cheap finite-difference over `dist`/mask, already dense arrays in scope) and carry that scalar alongside x/y through resamplePolygonRing's lerp. Have ringPathD scale each vertex's own c1/c2 tension by hardness × that vertex's steepness instead of hardness alone — wall-hugging points stay closer to straight even at high softness, negotiated seams get the full organic curve. Default the scalar to 1 for points with no real field sample (icon ring, whole-room fallback) so today's behaviour is unchanged there.

**Risk:** The most invasive of these findings — changes resamplePolygonRing/ringPathD signatures to carry an extra per-point scalar; must stay a pure multiplier on the soft (h>0) side only, never touching the hard/local-chord-pull side (finding 2) or the icon endpoint. Ship only after findings 1-2 are live and read well; it's a refinement on top of them, not a substitute.

### 26. Superellipse bias: considered, not worth adopting as the hardness backbone

**Status:** No change — superellipse backbone rejected by the critique itself

**Impact:** low

**Problem:** The design doc (docs/IDEA_AUTOMORPH_LIGHTS.md, 'Technical challenges' #2) explicitly floats a Lamé-curve/superellipse parameterization as a cleaner single continuous hard↔soft dial than per-vertex treatment.

**Fix:** Keep the current point-ring approach (local-chord pull for hard per finding 2, Catmull-Rom for soft, optionally field-weighted per finding 10) rather than re-deriving the hardness backbone as a superellipse. A superellipse fit would require replacing iconRingLocal's circle/square/bar generators with closed-form Lamé boundaries AND re-solving correspondence against the room ring's irregular, non-closed-form point set — redoing the exact generic problem automorphRing already solved for every shape family, including targets a superellipse has no closed form for at all (an L-shaped room cell). No code change recommended.

### 27. Scope guardrail: metaball MERGING is the wrong half of the technique to borrow

**Status:** No change — standing guardrail: only the smoothing half of the metaball technique is borrowed

**Impact:** low

**Problem:** Classic metaball rendering lets two nearby blobs' silhouettes fuse into one shape as they approach — the exact opposite of buildRoomFixtureCells's whole purpose (Garry's own words: 'you have not built in a complex and attractive non overlap of devices... give a thorough rethink'). Worth flagging explicitly since 'metaball-style' is named directly in the technique list and the merging behaviour is the more famous half of the term.

**Fix:** No code change: only the SMOOTHING half of metaball rendering (finding 1 — post-process the implicit field's marching-squares boundary into a soft curve) is prior art worth taking here. Keep automorphFixtureWeight/buildRoomFixtureCells's per-fixture min-over-others field exactly as is — never blend two fixtures' `weighted()` fields together before marching squares — and apply finding 1's Chaikin pass strictly per-fixture, post-stitchSegmentsToRing, so the non-overlap guarantee is never at risk from smoothing work done under this lens.
