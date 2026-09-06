# Idea: Automorph — Aesthetic Shape Morphing for the Lights Map

**Status: NOT STARTED — captured for later (Garry, 2026-09-06).** Not part of
the ranked best-in-class roadmap (`docs/BEST_IN_CLASS_ROADMAP.md`); a
separate, standalone feature idea. Garry asked for this to be written up as
a complete, self-contained prompt so a future session (or Tuesday
2026-09-08, if not picked up sooner) can start directly from this document
with no other context.

## Origin (Garry's own words, verbatim, 2026-09-06)

> A switch and two sliders for 'automorph'. This one is complex and is based
> off the logic for room perimeter in lights. This will show in mapping,
> lights. When on first slider will morph all shapes to fit room dimetions
> and shapes, from slight change to extreme room alignment like a shape
> would look in room perimeter in shapes. The second slider is to make all
> the shapes from hard edges to soft, this one starts in the center. This is
> a significant maths and aesthetic problem, and the intent is to allow the
> cluttered overall look of this complex lights map to be smoothed and
> morphed onto something clean or edgy using the work done by the user as a
> base of information on shape and size, and turn the visual into a work of
> art. Soft, smooth, hard, and geometrically aligned. This is complex,
> really try to get this right, and see if any existing tools morph like
> this.

## The problem being solved

The Mapping → Lights iso map places many small fixture-glyph icons (hex,
circle, bar, fan, lock, etc. — `light_codes.js`'s `LIGHT_SHAPES`) at their
real positions. With many fixtures placed, the map reads as a cluttered
scatter of small disconnected icons rather than a unified visual. The
existing "perimeter" light type already proves one end of a spectrum is
possible: a light's rendered shape can be the ACTUAL room polygon it sits
in (inset by a margin), not a small point icon — see
`iso_lights.js`'s `perimeterSvg`/`defaultPerimeterMarginM` and the
"Room-perimeter geometry" section (a polygon-edge-offset-and-reintersect
algorithm, "the standard shrink-a-simple-polygon problem", already written
and working). Automorph generalizes this into a continuously adjustable
aesthetic transform applied to ALL fixtures at once, not just ones an owner
individually typed "perimeter".

## The feature, precisely

A new switch + two sliders in Mapping → Lights (alongside the existing
`lights_showcase`/`lights_fit_rooms`/`lights_hide_untouched` toggles —
same settings-store pattern, see `settings_store.py`'s `DEFAULT_SETTINGS`
and the corresponding `settings.js`/`maps.js` "lights" tab controls):

1. **Switch — Automorph on/off.** Off = current behavior exactly, byte for
   byte. This is a rendering-mode overlay, never the default.

2. **Slider 1 — Room-alignment amount, 0–100%.** At 0%, every fixture
   renders as its normal small point-icon shape (today's behavior). At
   100%, every fixture's rendered outline has morphed into something like
   the room-perimeter shape it sits in — the room polygon it's inside,
   inset the way `perimeterSvg` already insets one. Values in between
   interpolate: a small value is a subtle expansion/distortion of the
   normal glyph toward the room's geometry; a large value pulls the
   icon's boundary increasingly toward the actual room boundary.

3. **Slider 2 — Edge hardness, CENTERED (not 0–100 from one end).** Its
   rest/default position is dead centre, representing each shape's
   CURRENT corner treatment as designed today (unchanged). Moving one
   direction progressively sharpens every shape's corners into hard,
   precise geometric angles (an "edgy", architectural look). Moving the
   other direction progressively rounds/softens every corner into smooth,
   organic, blob-like curves (a "soft", ambient look). This slider changes
   ONLY corner/edge curvature — never position or overall size.

## The aesthetic goal, in Garry's words

"The intent is to allow the cluttered overall look of this complex lights
map to be smoothed and morphed onto something clean or edgy using the work
done by the user as a base of information on shape and size, and turn the
visual into a work of art. Soft, smooth, hard, and geometrically aligned."

This is explicitly an ARTISTIC/aesthetic feature, not a functional one.
Each fixture's already-placed position, its declared/derived shape, its
`width_cm`/`height_cm`/`rotation`, and the room polygon it sits inside are
the INPUT; the output is a transformed rendering only. Nothing about
light control, state, or health logic should change. This should be a new
rendering path (or a post-process layered onto the existing marker
geometry) in `iso_lights.js`'s marker-drawing pipeline
(`markerSvg`/`shapeSvg`), not a rewrite of the underlying data model.

## Relevant existing code to build on — do not reinvent

- `custom_components/padspan_ha/www/padspan-ha/views/iso_lights.js`:
  - `shapeSvg(kind, cx, cy, r, attrs)` — every glyph (hex, circle, bar,
    line, fan, pendant, sconce, chandelier, square, perimeter, motion,
    tempreadout, lock, triangle, diamond, as of 2026-09-06) is built from
    raw point arrays or path `d` strings via the `arcPts`/`sub`/`poly`
    helpers defined near the top of the file.
  - The "Room-perimeter geometry" section — polygon-edge-offset-and-
    reintersect ("shrink a simple polygon"), already implemented and
    working, feeding `perimeterSvg`. This is the PROVEN room-conforming
    shape slider 1 should interpolate toward — reuse its output, don't
    re-derive polygon offsetting.
- `light_codes.js`'s `LIGHT_SHAPES` / `deriveLightShape` / `resolveLightShape`
  — the shape vocabulary slider 1 morphs FROM (at 0%).
- `maps.js`'s "lights" mapsTab and `lights_panel.js` — where a new
  Automorph switch+sliders control would live, matching how
  `lights_showcase` etc. are already wired as persisted settings toggles
  for this same map.

## Technical challenges (the "significant maths" Garry flagged)

1. **Shape interpolation, not shape replacement.** Naively cross-fading
   opacity between "small icon" and "full room outline" reads as two
   overlapping shapes, not one morphing shape. A real solution needs
   GEOMETRIC interpolation between the fixture's own point-set/path and
   the room-boundary point-set/path at the same parameter t (slider 1's
   value) — e.g. resampling both shapes to the same ordered point count
   and interpolating each corresponding point's position. Vertex
   correspondence between two differently-shaped, differently-sized
   polygons is the classical hard part of shape morphing (naive
   index-matching produces twisted/self-intersecting results when winding
   or vertex order don't line up). Worth researching before writing new
   math:
   - **`flubber`** (JS, MIT) — "smoothly interpolate between any two
     arbitrary SVG paths". Direct prior art for exactly this problem.
     This project has no build step and no npm (a Home Assistant custom
     component's frontend), so it cannot simply be installed — study its
     approach and hand-port only the needed algorithm, and per this
     project's third-party-repo policy, ASK before adding any new
     dependency or vendored code at all.
   - As-rigid-as-possible (ARAP) shape interpolation; compatible-
     triangulation polygon morphing — classical computer-graphics
     techniques for the same correspondence problem.
   - How vector/motion tools implement a shape-morph or corner-rounding
     slider (Figma, Illustrator, After Effects, Rive, Lottie) — for both
     UX and algorithm inspiration.
2. **Edge hardness as a single continuous, CENTERED parameter across
   many different shape families.** A superellipse (Lamé curve)
   parameterization is a well-known way to get one continuous hard↔soft
   dial across a shape family (exponent n=2 is a circle/ellipse — soft;
   n→∞ approaches a rectangle — hard; n<2 approaches a soft
   diamond/astroid) and may be a cleaner backbone than per-vertex corner-
   rounding radii. Evaluate both before committing.
3. **Performance.** Many dozens of fixtures; automorph must not re-run an
   expensive polygon-offset + correspondence computation every 5s poll or
   pan/zoom frame. Likely design: precompute each fixture's "room-
   conformed" target shape once per model/geometry change (cache it), and
   make slider movement itself cheap (just re-lerping already-
   corresponded points).
4. **Interaction with the existing "perimeter" light type.** Decide
   whether Automorph at 100% should degenerate to the same output a
   fixture already typed "perimeter" gets (ideally yes, so the two
   features don't visually contradict each other), and whether Automorph
   should even apply to already-"perimeter"-typed fixtures (arguably not
   — they already opted into the room-shape look individually; automorph
   is the "everyone at once" version for fixtures that didn't).

## What "done" looks like

- A persisted Automorph switch (e.g. `lights_automorph_enabled`) and two
  sliders (e.g. `lights_automorph_room_pct` 0–100, and a centered
  `lights_automorph_hardness`, e.g. -100..100 with 0 = today's unchanged
  corner treatment) in Mapping → Lights.
- Moving the sliders visibly and smoothly transforms every (non-
  "perimeter"-typed, at minimum for v1) fixture's marker shape on the iso
  map in real time between its normal glyph and a room-conformed outline,
  and between hard and soft edges — without breaking the marker's
  click/tap/hold hit-testing area, health-dot rendering, code-chip label,
  or any other existing marker feature.
- Since this is a visual/aesthetic feature, it must actually be LOOKED AT
  to validate (a live-browser check or an SVG-dump comparison at a few
  slider positions), not just unit-tested.
- Unit tests for the pure geometry/interpolation math (correspondence,
  point interpolation, corner-rounding/superellipse radius) — this part
  IS testable without a browser. Match this repo's established pattern:
  a pure JS module + a node-harness pytest wrapper with no DOM dependency
  (see `tests/test_iso_motion.py`, `tests/test_evidence_diagram.py`,
  `tests/test_calibration_matrix.py` for the exact harness to copy).

## Explicit non-goals for v1

- No change to any entity's actual state, position, or type
  classification — a rendering transform only.
- Does not need to work identically across every shape family on day
  one. Starting with the simpler polygon-like shapes (circle, hex,
  square) and extending to the more complex silhouettes (fan, pendant,
  chandelier, lock) later is a reasonable phased approach — the same
  tiering this session used for floorplan import (gap #7).

## Research task before writing any implementation code

Garry's own instruction: "see if any existing tools morph like this."
Before writing new geometry code:
- Study `flubber`'s algorithm (cannot be installed here — no build step,
  no npm — but its approach is worth understanding before re-deriving a
  worse version of a solved problem).
- Superellipse/Lamé-curve parameterization for the hardness slider.
- Whether a much SIMPLER approximation (e.g. a weighted blend toward each
  fixture's room bounding box, skipping true point-correspondence
  morphing) gets most of the visual goal for far less complexity — and
  present that as an alternative, smaller v1 to Garry before committing
  to full polygon morphing.

## Follow-up

Saved to Engram (project memory) alongside this file, and a calendar
reminder was placed for Tuesday 2026-09-08 in case this doesn't get
picked up sooner ("this afternoon", per Garry).
