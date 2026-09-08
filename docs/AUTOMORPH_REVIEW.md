# Automorph — adversarial review of the applied critique (2026-09-08)

After the 27-finding design critique (`AUTOMORPH_CRITIQUE.md`) was applied
across six commits (`f869e46`..`ea25659`), five independent read-only
reviewers re-examined the result — one lens each for geometry, SVG output,
finding-completeness, regression risk, and test quality. Every claim below
was backed by execution, not reading: node renders with parsed ring
geometry and counted crossings, byte-level diffs against the pre-change
tree, and spec-compliant rasterization. The full 1726-test suite was green
the whole time — these are the defects a green suite could not see.

16 findings: 2 blockers, 6 majors, 8 minors. The dominant root cause:
`offsetPolygonInward` was designed for sparse hand-traced room polygons
and folds when fed the new dense Chaikin-smoothed cell rings — producing
self-intersecting loops at the hardness rest position and letting
neighbouring auras cross the non-overlap gap.

Repairs were made reproduce-first: each fix stage had to rebuild the
finding's failure scenario and observe the defect before changing code,
and the reproduction became a permanent test. Statuses below name the
repair commits (doc written while the batch's later build stages were
still completing; `AUTOMORPH_CRITIQUE.md` carries the final per-finding
status pass).

## Geometry — math correctness of the new ring pipeline

### 1. Neighbouring fixtures' rendered aura rings cross at negative hardness — cell non-overlap contract broken

**Severity:** blocker · **Status:** Fixed — 4e5b4f7 (inset ring kept simple with full clearance inside its cell)

**Where:** custom_components/padspan_ha/www/padspan-ha/views/iso_lights.js — automorphAuraSvg hardCapPx / applyHardness call (~lines 2479-2491); root cause in offsetPolygonInward (~line 78)

**Claim:** At negative hardness the rendered rings of two fixtures sharing a room genuinely intersect each other, because hardCapPx's safety argument ('can never eat the gap') rests on the inset ring sitting marginM inside the cell boundary everywhere, and offsetPolygonInward fails to deliver that on Chaikin-densified cell rings.

**Evidence:** Ran the real module under node (copied to .mjs exactly as tests/test_lights_renderer.py does). Model: one 10x4m room, three fixtures at x=1.5/5.0/8.5, middle one a 240x5cm strip at 30deg (weight 2.5 via automorphFixtureWeight). End-to-end buildIsoSVG with {automorph:true, automorphRoomPct:100, automorphHardness:-100, automorphStyle:'glow'}: parsing the emitted aura path d strings, the strip's ring and its right neighbour's ring cross at 6 segment pairs (4 pairs at hardness -50 via exact call-site replication). Direct cause measured: for the strip's cell, offsetPolygonInward(chaikinSmooth(cell,2), 0.463m) leaves 61 of 400 output vertices closer than HALF the margin to the pre-offset boundary (minimum 0.001m — effectively ON the boundary), so the h=0 minimum inter-ring gap is already 12.1px where the two 0.463m insets should guarantee >=36px at S=55.26 px/m; the spike cap (15.4px, correctly derived from the FULL margin) then lets capped spikes cross the bisector. Deterministic, reproducible from the fabric alone. No test covers rendered-ring separation (test_partition_two_fixtures_get_non_overlapping_cells checks only the raw cells; the hardness-cap tests use synthetic rings).

**Fix applied (as suggested):** Make the inset ring honour its own margin before trusting hardCapPx: offset a coarse evenly-resampled ring (resamplePolygonRing the Chaikin output to ~64 points BEFORE offsetPolygonInward, so the miter construction sees well-spaced vertices) and/or add a clearance pass after the offset that drops/projects any vertex closer than ~0.9*marginM to the pre-offset boundary. Then the existing cap math is sound again (verified: cap 0.85*SQRT1_2 <= worst-case projection is correct).

### 2. Automorph-off render is no longer byte-identical to the pre-change tree (always-emitted defs)

**Severity:** blocker · **Status:** Fixed — 8de7bba (aura defs emitted only in renders that can reference them)

**Where:** custom_components/padspan_ha/www/padspan-ha/views/iso_lights.js — ungated defs block: psautomorphduo loop ~line 1842, psclipsoft ~1878, psaurasoft ~1896, per-room clipPath loop ~1908-1912, psglossauto_<floor> ~2105

**Claim:** With opts.automorph falsy, buildIsoSVG output differs from the 70f3fae tree — the stated automorph-off byte-identity contract is broken — though every difference is a non-rendering def, so nothing painted changes.

**Evidence:** Ran old (git show 70f3fae) and new modules side by side on identical models with identical opts: work mode 68361 vs 70074 bytes, showcase 236958 vs 238029 (nowMs pinned). Line diff of the outputs shows the delta is exactly: psautomorphduo_on/off radialGradients, psclipsoft + psaurasoft filters, one psclip_N clipPath per room, and one psglossauto_N linearGradient per floor now emitted unconditionally (plus def reordering in showcase, where psglow_0 moved). Verified nothing consumes the new work-mode clipPaths when automorph is off: jobs slot 5 (roomClip.get) is only read inside if(SHOW) at line 3193, so painted elements are byte-identical. Practical cost is ~1-1.7KB of dead defs per render, scaling with room and floor count, for users who never enable Automorph. Severity is per the review's hard-contract rubric; if the contract is meant at painted-output level this is a minor dead-weight issue instead.

**Fix applied (as suggested):** Gate the five new def emissions on (SHOW || AUTOMORPH_PCT>0) — when automorph is off nothing references them (the invalid-reference argument in their comments only applies while auras exist), and keep the clipPath loop's SHOW-era position so showcase def order is restored. That restores strict off-mode byte identity.

### 3. Aura rings self-intersect at the hardness rest position — folded offset geometry survives the adaptive N=64 resample

**Severity:** major · **Status:** Fixed — 4e5b4f7

**Where:** custom_components/padspan_ha/www/padspan-ha/views/iso_lights.js — automorphAuraSvg targetPts/marginM/offset (~lines 2451-2466) with offsetPolygonInward (~line 78) and automorphRing adaptive N (~line 349)

**Claim:** At hardness 0 (the slider's rest position) every cell-targeted aura ring renders with self-crossing bowtie loops: offsetPolygonInward — a miter offset documented for sparse room traces — is now fed 270-520-point Chaikin-densified marching-squares rings at a 1.6x-enlarged margin, folds locally, and the new adaptive N=64 resample faithfully preserves the folds that the old fixed N=24 aliased away.

**Evidence:** Same 10x4m/3-fixture model, end-to-end buildIsoSVG at {automorphRoomPct:100, automorphHardness:0, style:'glow'}: all three emitted 64-point aura paths self-intersect (5 crossings each), so edgeCore/edgeRim/gloss strokes visibly cross themselves. Pipeline instrumentation: raw cell rings and Chaikin output are simple (0 crossings); offsetPolygonInward output has 9-12 self-crossings per cell; the resampled 64-pt ring keeps 4-5 as loops with bounding boxes up to 63x28px and 59x28px (strip cell) — plainly visible. Identical cells through the 70f3fae call site (raw cell, 1x margin, N=24) give 0-1 loops <=29px2. Sensitivity: at 1x margin the new pipeline still yields 2-3 loops (so f869e46's chaikin + 80efdf3's N=64 alone surface the defect); 34437a6's 1.6x margin grows them (12 offset crossings vs 6). L-shaped rooms and plain circle fixtures show the same (5-9 crossings). Separately verified NOT the correspondence's fault: bestRotationalMatch morphs onto a clean synthetic concave target with zero self-intersections at every t for circle/square/rotated-strip icons — the folds come entirely from the offset stage.

**Fix applied (as suggested):** Same repair as the non-overlap finding, and it fixes both: give offsetPolygonInward a well-spaced ring (resample the Chaikin output to the final ~64 count first, then offset), or post-process its output to the largest simple loop (drop fold loops) before automorphRing. Re-verify with a self-intersection assertion on the emitted path — no current test parses the rendered ring for simplicity, which is why the suite stays green.

## SVG — paint correctness and render cost

### 4. Glow bloom and nebula wash paint through a viewport-relative mask, not a per-ring edge fade

**Severity:** major · **Status:** Fixed — 357fd4e (mask fades at each ring's own edge)

**Where:** custom_components/padspan_ha/www/padspan-ha/views/iso_lights.js — automorphAuraSvg bloom layer ~line 2665 (mask def line 1824; nebula wash ~line 2594)

**Claim:** The bloom layer this diff adds to the glow style (and the nebula wash it shares the mask with) references psautomorphmask, whose content rect uses percentage coordinates under the default maskContentUnits=userSpaceOnUse, so the mask resolves against the whole SVG viewport as one canvas-centred vignette — there is no fade at the ring's own edge anywhere, and bloom/wash strength varies with the fixture's position on the canvas instead of encoding 'light welling up from inside'.

**Evidence:** Def (line 1824): <mask id="psautomorphmask"><rect x="-20%" y="-20%" width="140%" height="140%" fill="url(#psautomorphgrad)"/></mask> — maskContentUnits defaults to userSpaceOnUse, where percentage lengths resolve against the viewport (SVG 1.1 §14.4 + §7.10), so the rect spans 140% of the canvas and psautomorphgrad (objectBoundingBox of that rect) centres on the canvas, not on the masked path. Verified by rasterizing (resvg, spec-compliant): three identical 60x60 masked squares in a 760x900 viewport read alpha 255 at canvas centre vs 35 (~14%) at the top-left and bottom-right corners, and the mask is nearly flat across any fixture-sized shape (241 vs 255 across the 60px square) — no interior-to-edge fade exists. On a real HEAD render (2-floor model, glow style, pct=100), the four emitted bloom paths (fill=url(#psautomorphduo_on) mask=url(#psautomorphmask), added in bd9f515/ea25659) land at computed mask values 0.709-0.860 purely by canvas position; on taller multi-floor stacks fixtures near the top slab or canvas corners approach the measured 0.14 floor. Failure scenario: two identical lit fixtures in identically-shaped rooms on different floors — the mid-canvas one gets full bloom (the glow style's primary 'on' material cue), the top-floor one gets a visibly weaker one, and in the nebula style (whose ONLY softening mechanism is this mask) every orb renders as a hard-edged flat fill whose overall opacity depends on where the room happens to sit on the canvas, the opposite of the documented 'fades the fill to nothing at the ring's own edge'. String-matching tests cannot catch this; only rasterization does.

**Fix applied (as suggested):** Make the mask content bbox-relative so the gradient centres on each referencing ring: <mask id="psautomorphmask" maskContentUnits="objectBoundingBox"><rect x="-0.2" y="-0.2" width="1.4" height="1.4" fill="url(#psautomorphgrad)"/></mask>. This keeps the single shared def (the O(2) defs discipline) while giving every bloom/nebula fill the intended per-fixture centre-to-edge fade, independent of canvas position.

### 5. Automorph-off render is no longer byte-identical to the pre-change tree: 11 inert defs emitted unconditionally

**Severity:** blocker · **Status:** Fixed — 8de7bba (same defect as the geometry lens's byte-identity finding)

**Where:** custom_components/padspan_ha/www/padspan-ha/views/iso_lights.js — buildIsoSVG defs block lines 1842-1913 (duotone gradients, psclipsoft/psaurasoft, psclip loop) and per-floor psglossauto def ~line 2105

**Claim:** With Automorph fully off (opts.automorph absent, false, or pct 0), the emitted SVG differs from the pre-change (70f3fae) output: the diff's new defs — psautomorphduo_on/off, psaurasoft, psglossauto_<lidx> per floor — are emitted unconditionally, and the psclipsoft filter plus the O(rooms) psclip_N clipPath loop were moved out of if(SHOW) without any AUTOMORPH_PCT gate, so the default working map now carries defs that nothing in that render can ever reference, violating the automorph-off byte-identity contract.

**Evidence:** Empirical: rendered the same 5-room/7-fixture 2-floor model through both trees (node, nowMs pinned). Working mode with automorph off: HEAD 13028 bytes vs base 11416, first divergence at byte 805 where HEAD inserts <radialGradient id="psautomorphduo_on">; the def-element delta is exactly [psautomorphduo_on, psautomorphduo_off, psclipsoft, psaurasoft, psclip_0..psclip_4, psglossauto_0, psglossauto_1] (11 elements, 8->19 defs); showcase-off adds 5 (psautomorphduo_on/off, psaurasoft, psglossauto_0/1) plus reordering. After stripping gradient/filter/clipPath/mask/pattern elements the painted content is byte-identical in both modes, so this is inert-def bloat, not a paint change — but it is a reproducible byte-level break of the stated off-state identity contract, scaling as O(rooms)+O(floors) dead DOM per render in the most common configuration (working map, feature off), and no test compares the off state against the pre-change output. Repro: node render of both trees with identical inputs and opts {} / {automorph:false} / {automorph:true, automorphRoomPct:0}.

**Fix applied (as suggested):** Gate every automorph-only def on the feature actually being on: emit psautomorphduo_on/off, psaurasoft and the per-floor psglossauto_<lidx> only when AUTOMORPH_PCT>0, and emit psclipsoft/psclip_N when SHOW || AUTOMORPH_PCT>0 — keeping them at their original position inside the if(SHOW) block when automorph is off so showcase-off output also stays byte-identical. All consumers already resolve ids document-wide, so no reference changes are needed; the automorph-on output is unchanged.

## Completeness — did each critique finding's intent land

### 6. composition[2] rebalance misses its stated weight target ~4x; in-code comment asserts the false relationship

**Severity:** major · **Status:** Fixed — a965458 (all five fill layers re-budgeted together)

**Where:** custom_components/padspan_ha/www/padspan-ha/views/iso_lights.js — automorphAuraSvg glow-style layer constants, ~lines 2624-2674 (comment claiming the target at ~2628-2631)

**Claim:** The applied rebalance does not achieve composition[2]'s stated relationship — at t=1/subtlety 0 the aura's summed fill weight is roughly 2-4x the room's own fill+glow weight, not 'under roughly half' of it, and the comment above the layers ('Rebalanced so the combined fill weight stays under roughly half the room's own at t=1/subtlety 0') asserts a relationship the constants do not deliver.

**Evidence:** Rendered via node (buildIsoSVG, automorphRoomPct:100, glow, working mode): a lit fixture's aura fill layers are wash 0.22 + bloom 0.22 (psautomorphmask, full weight at shape centre) + edgeCore fill 0.14 + gloss 0.36 (x psglossauto stop-opacity 0.036-0.18 effective) + offset shadow 0.16 - nominal sum ~0.78-0.94, composited coverage ~0.50-0.58 at centre; off fixtures ~0.33. The room's own weight (iso_lights.js:3005-3006) is fill 0.16 + psroomglow (0.16 centre stop fading to 0) = 0.16-0.32 nominal (~0.29 composited max); Showcase fill is lower still (0.085, line 3001). 'Under roughly half' means <=~0.08-0.16; the actual aura weight is ~4x that ceiling and still outweighs the room's colour outright - the exact defect composition[2] described. The pre-change stack composited to ~0.5-0.7, so the total barely moved: wash/gloss were cut per the critique's example numbers, but the same edit series added bloom, edgeCore-as-duotone and the always-on shadow back on top, and no one re-summed.

**Fix applied (as suggested):** Re-budget ALL five glow-style fill layers together against the room's 0.16-0.32 weight (e.g. roughly halve wash/bloom/edgeCore ceilings and taper the 0.16 shadow with t), or - if the shipped look is deliberately heavier - fix the comment and docs/AUTOMORPH_CRITIQUE.md to state the real achieved relationship instead of the unmet target.

### 7. light[1]'s lit-bevel rim is defeated by pointing edgeRim at the floor-wide userSpaceOnUse ramp

**Severity:** major · **Status:** Fixed — 357fd4e (edgeRim moved to a per-shape bbox gradient)

**Where:** custom_components/padspan_ha/www/padspan-ha/views/iso_lights.js — edgeRim ~line 2670; psglossauto def ~2105-2116; comment ~2637-2646

**Claim:** light[1]'s stated purpose - a brighter rim on each shape's upper-left arc and darker where it faces away, killing the uniform-stroke 'flat sticker' tell - does not land: edgeRim strokes with psglossauto (userSpaceOnUse across the whole slab), so bright-vs-dark is decided by the fixture's POSITION on the floor, not by which side of each shape faces the light, and the adjacent comment ('landing bright on the upper-left arc and dark on the lower-right... every cell's bright arc agrees on where the sun is') describes objectBoundingBox behaviour this gradient cannot produce.

**Evidence:** Rendered 3 fixtures across a 16x8m two-room floor: the three rim rings project onto the psglossauto axis at offset fractions [-0.01..0.62], [0.24..0.89], [0.56..1.22]. Stops are white@0.5 (0%), white@0.1 (45%), black@0.18 (100%) - so the right-hand fixture's ENTIRE rim sits past the 45% stop: max white opacity ~0.1 (x0.55 stroke-opacity = ~0.05), no bright arc anywhere, a near-uniform dark outline - the exact defect light[1] targeted - while the upper-left fixture's rim is bright on most of its perimeter. At the ~100-fixture scale this feature targets, each cell spans only a few percent of the ramp, making every rim locally uniform. Note the literal fix in light[1] (stroke=url(#psgloss)) was genuinely unusable - psgloss is Showcase-gated (defined at line 1934 inside if(SHOW)), so the rim would be dropped on the working map - but that forced a choice, not this substitute.

**Fix applied (as suggested):** Give edgeRim its own UNGATED objectBoundingBox clone of psgloss's stops (one def, O(1)) so each shape's rim sweeps bright-to-dark across its own bbox, and keep psglossauto for the gloss FILL only, which is what composition[4] actually asked to move.

### 8. light[3] never landed in the blueprint style: on vs off still differ only by the ink hex

**Severity:** minor · **Status:** Fixed — 357fd4e (blueprint gained its on/off split)

**Where:** custom_components/padspan_ha/www/padspan-ha/views/iso_lights.js — blueprint branch of automorphAuraSvg, ~lines 2558-2573

**Claim:** light[3]'s problem statement - 'Every opacity/stroke-width formula in automorphAuraSvg is identical for on and off; the sole difference is base' - remains literally true for the blueprint style: dashOp=opac(0.35+0.45*t), stroke-width, dash pattern and node radius are all state-independent, so a lit and an unlit fixture render byte-identically except for the grey hex.

**Evidence:** Rendered blueprint at automorphRoomPct:100 with one on and one off fixture: on stroke '#94a3b8'/opacity 0.80/width 1.10 vs off '#475569'/0.80/1.10 - identical formulas, hex-only difference. glow got bloom + wash/gloss/rim/AO splits and nebula got an intensity split (0.26 vs 0.17) with an explicit comment reasoning about which parts of the material split fit; blueprint's block contains no on/off reasoning at all, indicating it was skipped rather than deliberated.

**Fix applied (as suggested):** Give blueprint a state split in its one channel, e.g. dashOp=opac((on?0.45:0.30)+0.40*t) - or add a one-line comment recording a deliberate decision that linework brightness alone carries state in this style.

### 9. chaikinSmooth on the sparse room.pts fallback rounds corners at metre scale, defeating shape[1]'s 'barely changing the traced position' property

**Severity:** minor · **Status:** Fixed — 4e5b4f7 (scale-aware smoothing at the shared call site)

**Where:** custom_components/padspan_ha/www/padspan-ha/views/iso_lights.js — targetPts=chaikinSmooth(... : room.pts, 2) in automorphAuraSvg, line 2451

**Claim:** Chaikin's cut scales with input edge length, so the two passes that give a dense marching-squares cell ring the intended cm-scale noise cleanup give the 4-8-vertex room.pts fallback metre-scale corner rounding instead - the fallback aura at t=1 no longer tracks the room's actual corners, and the fallback's corner treatment ends up orders of magnitude heavier than the cells', the inverse of shape[3]'s stated goal of one consistent corner language across both paths.

**Evidence:** node, current module: chaikinSmooth([[0,0],[6,0],[6,4],[0,4]], 2) passes 0.83m from the (6,0) corner (min vertex distance 0.839m, min segment distance 0.832m) - ~1m of a 6x4m room's corner is cut before the marginM inset even runs, on input that had zero grid/digitization noise to remove. The same call on a measured real cell ring (137 points, ~10cm edges) moves the boundary ~2-3cm. Mitigated only by rarity: the fallback fires when buildRoomFixtureCells fails to resolve a cell (stitch failure, fixture on the room boundary), so most fixtures take the dense-cell path.

**Fix applied (as suggested):** Make the smoothing scale-aware at the one call site: skip or pre-densify sparse rings before Chaikin (e.g. resample room.pts to ~0.1m edge spacing first, or apply Chaikin only when the ring's median edge is below a threshold), so the fallback gets the same cm-scale cleanup as a cell instead of metre-scale reshaping.

## Regression — everything that is not the aura

### 10. Aura inset ring escapes its own cell: neighbouring auras' crisp edges visibly cross at full morph, even at rest hardness

**Severity:** major · **Status:** Fixed — 4e5b4f7 (same root cause as the geometry lens's blocker)

**Where:** custom_components/padspan_ha/www/padspan-ha/views/iso_lights.js — automorphAuraSvg, lines 2451-2466 (targetPts=chaikinSmooth(...,2); marginM with hasCell*1.6; roomPx=offsetPolygonInward(targetPts, marginM))

**Claim:** The new chaikinSmooth->offsetPolygonInward inset stage emits ring vertices up to a full marginM OUTSIDE the fixture's own non-overlap cell, and the new adaptive 64-point resample (80efdf3) carries them into the drawn ring, so at automorphRoomPct=100 neighbouring fixtures' aura edge rings cross by 6-8px on screen in ordinary symmetric multi-fixture rooms - including at hardness 0, the rest position whose contract is today's clean treatment - where 70f3fae rendered at most 0.7px.

**Evidence:** Rendered through the module at HEAD vs a 70f3fae copy (scratchpad ab/ harness, node). Screen-space test parses each fixture's edgeCore path and point-in-polygon tests it against every neighbour's: 4 circle downlights in a 5x5m room ('4pack', positions (1.5,1.5)/(3.5,1.5)/(1.5,3.5)/(3.5,3.5)), pct=100: old h=0 max penetration 0.7px -> new h=0 6.0px; 5 fixtures in a 7x7m cross: old h=0 0.0px -> new 7.1px; at soft hardness +100 old 4.4-4.7px -> new 7.8-8.1px (21 ring points inside neighbours in the 5cross case). Metre-space localization using the module's own exports: for cell k2 of the 4pack, offsetPolygonInward(chaikinSmooth(cell,2), marginM=0.331m) produces vertices 0.332m (= the entire marginM) outside the fixture's own cell at (0.48,2.13) on the wobbled bisector, and automorphRing t=1 keeps the escape at 0.330m; the metre-space cells themselves are disjoint (0.000m overlap). Old pipeline masked the same offsetPolygonInward weakness because it resampled to only 24 points (averaging the escaped vertex away) and inset by 1x margin, not 1.6x. This defeats the diff's own stated discipline (34437a6's two-tier rationale: a neighbour's wash 'can never muddy the crisp bisector edge', and cfb6888's hardCapPx exists solely so nothing 'can spend the gap' the inset created - yet the inset stage itself spends the whole gap before hardness runs). None of the new tests catch it: they pin single-fixture insets, cell disjointness in metres, and hardness caps, but never test two DRAWN rings against each other. Repro scripts: scratchpad ab/overlap.mjs and the inline sweeps in this session; both builds rendered from C:/Users/Garry/padspanha via git show 70f3fae vs HEAD.

**Fix applied (as suggested):** After offsetPolygonInward, clamp the inset ring back inside its source cell: drop or project any vertex that lands outside the pre-inset targetPts ring (a pointInPolygon test per vertex against targetPts, projecting escapees onto the nearest targetPts edge minus a small epsilon). Alternatively run the Chaikin pass AFTER the inset (offset the raw cell, then smooth), which restores the old behaviour of rounding off offset artifacts while keeping the corner-language fix; either way add a test that renders 4 fixtures in a square room at pct=100 for hardness -100/0/+100 and asserts no edgeCore ring vertex falls inside a neighbouring fixture's edgeCore ring by more than ~1px.

## Tests — what the suite still could not see

### 11. Cell non-overlap under negative hardness is enforced by no test: hardCapPx derivation unpinned, no render ever uses hardness < 0

**Severity:** major · **Status:** Fixed — 4e5b4f7 / a12b9d0 (end-to-end negative-hardness separation tests)

**Where:** tests/test_lights_renderer.py — test_hardness_negative_outward_push_respects_an_absolute_cap (~line 2288) / test_ring_jitter_applied_once_before_hardness_and_skipped_for_nebula (~line 3315)

**Claim:** The cap that keeps hardness spikes from eating the inter-cell non-overlap gap is tested only in unit space with a hand-passed cap of 2; the real cap's derivation (iso_lights.js:2479, `const hardCapPx=marginM*frame.scale*Math.SQRT1_2*0.85;`) is neither pinned nor exercised, and every buildIsoSVG-level test in the file passes automorphHardness:0 or omits it.

**Evidence:** grep of tests/test_lights_renderer.py: `hardCapPx` appears only in the call-shape pin at line 3330 (`applyHardness(inked, AUTOMORPH_HARDNESS, hardCapPx)`), and `automorphHardness` appears only with value 0 (lines 2671, 2745, 2800); tests/js/render_smoke.mjs never sets hardness. Replacing line 2479's RHS with `Infinity` (or `marginM*frame.scale*100`) breaks no pinned substring and no rendered assertion — the full 95-test suite stays green. Failure scenario: two fixtures sharing a room at hardness=-100 — the room clipPath only stops spikes at the ROOM wall (clipWrap uses psclip_{room}, shared by both cells), so with the cap regressed a corner spike crosses the marginM gap and paints over the neighbouring fixture's aura, silently defeating the cell non-overlap contract the tests' own docstrings call out ('hardness must never eat the non-overlap gap').

**Fix applied (as suggested):** Add an end-to-end test: render the two-fixtures-one-room scene at automorphHardness=-100/glow, extract both edgeCore path `d` rings, and assert no vertex of one fixture's ring falls inside the other's cell (or, cheaper, assert max displacement of the -100 render's ring vs the 0-hardness render's ring is <= marginM*frame.scale*SQRT1_2*0.85 + epsilon). Alternatively pin the hardCapPx derivation line the way the marginM line already is.

### 12. Hardness rewrite dropped the only magnitude anchor: a slider-magnitude-blind gain (hardness -1 spiking like -100) passes every test

**Severity:** minor · **Status:** Fixed — 4e5b4f7 / a12b9d0 (amplitude/linearity anchor)

**Where:** tests/test_lights_renderer.py — test_hardness_negative_spikes_corners_and_holds_straight_runs_still (~line 2256)

**Claim:** The old centroid test pinned the -100 endpoint amplitude exactly (corners land at +/-13.5, i.e. a calibrated 35% inflate); the rewritten tests pin direction, locality, quadrant, count, determinism and the two caps, but the only amplitude constraint left anywhere is `dFree > 2` in the cap test — so the negative side's gain formula (iso_lights.js:445, `const gain=(-h/100)*2`) can drift or lose slider proportionality entirely without any test noticing, while the positive side keeps a dedicated continuity test (test_hardness_softening_scales_continuously_with_the_slider).

**Evidence:** Ran the four rewritten/new hardness tests' exact assertions in node against a patched module with `const gain=2;` (negative slider magnitude fully ignored): all pass — {spikes:true, cap:true, needle:true, passthrough:true} — and `applyHardness(ring,-1)` becomes byte-identical to `applyHardness(ring,-100)` (verified minus1_equals_minus100:true). A gain drift down to ~0.29x also passes (dFree=0.29*7.07=2.05>2). Visible result of the undetected regression: the negative half of the hardness slider becomes an all-or-nothing switch, or spikes at a fraction of the intended strength.

**Fix applied (as suggested):** Add one amplitude assertion mirroring the soft side's continuity test: on the midpointed square, assert disp(applyHardness(ring,-50)) is approximately half of disp(applyHardness(ring,-100)) (gain is linear in -h), and pin the -100 endpoint push on an unclamped corner exactly (dev*2, e.g. corner (-10,-10) with neighbours' midpoint (-5,-5) moves by 2*sqrt(50) before the 75%-edge clamp — pick a ring where neither clamp binds).

### 13. Nebula's per-fixture weight channel (the +/-0.028 fill-opacity delta) is documented in the tests' own comments but tested nowhere

**Severity:** minor · **Status:** Fixed — a12b9d0

**Where:** tests/test_lights_renderer.py — test_automorph_weight_offset_rides_the_ink_and_stays_inside_the_state_gap (~line 3213); colour-round section comment ~line 3102

**Claim:** The colour-ownership contract the test section's own header states — 'for inkless nebula, a narrow fill-opacity delta' — has no assertion: the weight test probes only the glow style's edgeCore stroke ink, and the two nebula-rendering tests (style dropdown, shadow gating) use fixtures with no width_cm/height_cm, so the `+weightOffPct*0.004` term in nebula's fill-opacity (iso_lights.js:2595) is exercised by no test at any weight other than the identity 0.

**Evidence:** grep: every nebula render in the test file (lines 2420, 3008 via _aura_probe) uses fixtures without manual sizes; the weight test's ink regex (`fill="url\(#psautomorphduo_on\)" fill-opacity="[\d.]+" stroke="(#hex)"`) matches only stroked paths, which nebula's stroke="none" wash never is. Failure scenario: delete `+weightOffPct*0.004` from line 2595 (or fat-finger it to *0.4, blowing the +/-0.028 ceiling and swamping the ~0.09 on/off split the comment promises it stays under) — the suite stays green either way.

**Fix applied (as suggested):** Extend the weight test with a nebula variant: render the same two-fixture room with automorphStyle:'nebula', one fixture sized 300x300cm, and assert the two washes' fill-opacity values differ by >0 and by <0.03, and that both sit clearly inside the on/off intensity split.

### 14. The room-fallback aura branch (hasCell=false) is reachable through the real partition but has no end-to-end test — only a source-string pin

**Severity:** minor · **Status:** Fixed — a12b9d0

**Where:** tests/test_lights_renderer.py — test_automorph_interior_margin_is_a_larger_multiple_of_the_wall_margin (~line 2865)

**Claim:** Every render test that gives a fixture an aura resolves a cell for it (single or evenly-matched fixtures always get one), so the fallback path — chaikinSmooth(room.pts,2), the 1x margin multiplier, and the docstring promise that a cell-less fixture 'never silently loses its aura' — runs in no test; the only coverage is the exact-substring pin on the ternary and marginM line, which a runtime-only regression leaves intact.

**Evidence:** Demonstrated reachability with the real buildRoomFixtureCells: a weight-0.25 fixture at (0.05,0.05) crowded by three weight-2.5 fixtures at (0.3,0.3)/(0.05,0.5)/(0.5,0.05) in an 8x4 room is ABSENT from the returned cell map (cells.has('t')===false), and the corresponding buildIsoSVG render works today (4 psaurasoft glow groups — the cell-less fixture still gets its fallback aura). Failure scenario: a later edit adds `if(!hasCell) return null;` (or otherwise breaks only the fallback branch at runtime) — both pinned substrings survive verbatim, the suite stays green, and the cornered fixture silently loses its aura while keeping its glyph, exactly the regression the code comment promises against.

**Fix applied (as suggested):** Add an end-to-end test using the cornered-fixture scene above: assert buildRoomFixtureCells omits the tiny fixture (proving the scene really exercises the fallback), then render via buildIsoSVG and assert one psaurasoft glow group per fixture (4), so a cell-less fixture demonstrably still paints an aura through the room.pts path.

### 15. psglossauto's per-floor contract is asserted only on a one-floor scene; hardcoding floor 0's ramp everywhere would pass the suite

**Severity:** minor · **Status:** Fixed — a12b9d0

**Where:** tests/test_lights_renderer.py — test_automorph_sheen_is_one_userspace_ramp_per_floor (~line 3151)

**Claim:** The test whose docstring states 'ONE ungated userSpaceOnUse gradient per FLOOR' renders a single floor and asserts defs==1 and refs==2; nothing checks that a second floor defines psglossauto_1 or that upper-floor auras reference their own floor's ramp rather than floor 0's.

**Evidence:** Every automorph render test in the file uses a one-floor FLOORS list. I rendered a two-floor automorph map through the node harness against the current code: defs [psglossauto_0, psglossauto_1], refs split 4 (floor 0, two fixtures) / 2 (floor 1, one fixture) — correct today because glossAutoId closes over the per-floor loop. Failure scenario: replace `url(#${glossAutoId})` with a literal `url(#psglossauto_0)` in edgeRim/gloss (iso_lights.js:2670/2673) — the entire suite passes, but on a real multi-floor home every upper floor's rim and gloss sample floor 0's user-space bbox, which sits elsewhere in iso space, so upper-floor auras get an off-range (near-uniform) sheen — the exact 'two suns'/wrong-sun defect the change exists to prevent.

**Fix applied (as suggested):** Add a two-floor render test: one lit fixture per floor, assert two psglossauto defs and that url(#psglossauto_1) is referenced exactly twice (rim+gloss of the upper fixture), e.g. by slicing the svg at the second floor group or just counting refs per id.

### 16. No two-render byte-determinism test of a full automorph map, though determinism is a hard contract and the diff added many unpinned painted formulas

**Severity:** minor · **Status:** Fixed — a12b9d0

**Where:** tests/test_lights_renderer.py — test_automorph_ring_jitter_is_deterministic_bounded_and_fades_hard (~line 3277)

**Claim:** Determinism is pinned per helper (applyHardness, chaikinSmooth, automorphRingJitter each compare two calls), but no test builds a full automorph buildIsoSVG twice and compares bytes, so entropy introduced in any of the new unpinned layer formulas (shadow displacement, AO/wash/bloom/rim opacities, duotone stops) would pass every existing test.

**Evidence:** grep shows the only two-call comparisons are on the three exported helpers. I verified the current full map IS deterministic (two buildIsoSVG calls over a two-floor model with hardness -100 are ===), so this is purely missing enforcement. Failure scenario: a future tweak adds e.g. `*(1+Math.random()*0.01)` to the shadow's diag scale (iso_lights.js:2658) or seeds anything from Date.now() outside the pinned jitter call — helper unit tests still pass (they call helpers directly with fixed args), every render probe compares within one render, and the suite stays green while renders stop being reproducible from the fabric alone.

**Fix applied (as suggested):** One cheap test: build the same automorph glow scene twice in one node run (same nowMs) with nonzero hardness and a sized fixture, assert svg1 === svg2. It closes the class, not just the instances the helper tests cover.
