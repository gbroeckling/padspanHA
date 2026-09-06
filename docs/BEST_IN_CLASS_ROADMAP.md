# Best-in-Class Roadmap

Ranked gap list from the 2026-09-05 competitive research pass (5 web-research
agents over ESPresense-companion, Bermuda + HA-native surfaces, commercial RTLS
dashboards, modern floorplan technique, and community feature-requests, plus a
full inventory of this repo's views; 98 evidence-grounded findings synthesized).
Directive: build top-down until PadSpan is the most modern, complete graphical
solution of its kind.

**Status legend:** `TODO` · `IN PROGRESS` · `DONE <commit>` · `SKIPPED <why>`

| # | Status | Feature | Category |
|---|--------|---------|----------|
| 1 | DONE (4fea4ae) — position glide + fade + trails; room-color re-tint still an instant snap, not crossfaded | Animated live movement: tweened markers, room-color transitions, fading trails | visualization |
| 2 | DONE (9c5e792) — distance rings + room-vote bars in the detail modal; confidence halo was already shipped (always-on dashed ring, not gated on click) | Confidence/evidence visualization: per-scanner distance rings, per-room probability, confidence halo | visualization |
| 3 | DONE (1211334) — point×scanner, not literally scanner×scanner (verified no scanner-to-scanner RSSI exists) | Scanner-pair calibration error matrix (heat-colored, reset/relearn buttons) | analytics |
| 4 | DONE (e63d664) — table form; iso-map heat-tint not built this pass | Room-dwell analytics: time-in-room, occupancy heatmap, entries/exits, CSV export ("Insights" tab) | analytics |
| 5 | DONE (e7285bc) — no "alignment view"; numeric settings fields only | GPS geolocation bridge: fabric→lat/long, device_tracker GPS attrs, HA map interop | platform |
| 6 | DONE (ea14f51) — pinning/auto-cal already existed; drift + matrix rows were the actual gap | Anchored beacons: stationary tags as ground truth (drift warnings, free auto-calibration) | editing |
| 7 | DONE (9c10575) — tier 1/3 (Sweet Home 3D) only; RoomPlan JSON and image room-detection not started | Floorplan import: Sweet Home 3D first, then RoomPlan JSON, then image room-detection | editing |
| 8 | DONE (53ee119) — lock domain only; cover/climate/media_player/camera/sensor not started | Bind arbitrary HA entities to the floorplan (climate/cover/lock/media/camera domain registry) | presentation |
| 9 | DONE (de8b986) — built in the 2D Rooms tab, not the 3D iso overview | Predictive what-if scanner placement (ghost scanner over the existing radio-map model) | analytics |
| 10 | DONE (8e3eab9) — slotted into the existing object list, not a new dedicated view; column-sort not built | Persistent lost-and-found: "last known room" inventory that never resets to Unknown | presentation |
| 11 | DONE (70d6c1a) — shared module + keyboard nav + Pin & Listen only; Overview iso, Mapping Edit, touch tooltips, numeric entry not done | Map interaction parity: pan/zoom everywhere, keyboard nav, touch tooltips, numeric entry | presentation |
| 12 | DONE (cbb4bfd) — scoreboard + tinted confusion links + Roam priority card; accuracy-over-time trend not built | Per-room accuracy scoreboard + confusion pairs on the map, directed collect-more guidance | analytics |
| 13 | TODO | Ground-truth capture walks with accuracy scoring and settings A/B replay | history |
| 14 | TODO | BLE + motion fusion made visible: per-room agreement badges, occupancy count chips | visualization |
| 15 | TODO | Room-polygon-clipped light glow + live-color room tinting (cinematic Showcase upgrade) | presentation |
| 16 | TODO | Search-to-locate with fly-to camera; follow-mode pinning the live viewport to an object | presentation |
| 17 | TODO | Activity review timeline (Frigate-style scrubable event feed; unifies Follow/Traceback history) | history |
| 18 | TODO | Multi-floor navigation polish: animated explode/collapse, click-to-focus, saved viewpoints, swipe | presentation |

Full per-item build guidance (what to build, who has it, impact/effort) lives in
the research output; the essentials are restated per item below.

## Per-item build notes

1. **Animated live movement** — DONE for position: `iso_motion.js`'s
   `planObjectLayerMerge`/`mergeObjectLayer` key each object's `<g>` by
   `data-obj-key`, glide it (CSS `translate` property, composes with
   overview's counter-scale `transform` attribute) ~0.9s to its new anchor
   instead of teleporting, fade new/departed objects, and preserve fresh
   z-order. Wired into overview.js's `_updateIsoObjects` (Pure Live reuses
   the same DOM node + updater, so it's covered too) and traceback.js's
   playback frame renderer (markers now wrapped in a keyed `<g>`). Fading
   breadcrumb trails (client ring buffer, world-metre frame, `trailPush`/
   `trailSvg`) ship on Overview; Traceback already draws its own
   server-frame-derived trail and doesn't need the client one.
   REMAINING: room-color re-tint still swaps instantly with the fresh
   markup rather than crossfading `fill` — the swapped-in node is a new
   element, so there is no previous value for a CSS transition to animate
   from; doing that properly needs attribute-level mutation of the kept
   node instead of a wholesale replace. (ESPresense-companion has
   spring-animated markers; most visible hobbyist-vs-commercial tell —
   the position half of that gap is now closed.)
2. **Confidence visualization** — DONE. The uncertainty halo already existed
   before this pass (overview.js's always-visible dashed confidence ring,
   sized/opacity by knn_confidence, plus a red warning ring under 30% —
   ambient, not gated on a click, which is arguably better). What was
   missing: presence_coordinator.py now exposes `source_distances_m`
   (per-scanner distance, reusing the solver's own per-source calibration
   fit) and `room_scores` (the k-NN/RF weighted room vote, previously
   computed and discarded the instant argmax picked a winner) on live_snapshot
   objects. The object detail modal (panel.js) renders both: a small
   self-contained evidence diagram (evidence_diagram.js, flat top-down, NOT
   the iso map's projection — deliberately decoupled from overview.js's
   poll/glide machinery) with a dashed ring per scanner at its estimated
   distance, and a "Why this room?" probability bar list.
   REMAINING (not done): the rings are modal-only, not drawn live on the
   main iso map itself on object click — the roadmap's literal "projected
   to iso" phrasing. Scoped out this pass to avoid touching gap #1's
   freshly-built animation pipeline; would reuse the same source_distances_m
   data if built later.
3. **Calibration error matrix** — DONE. Verified first (reading
   fit_path_loss()/path_loss_by_source() in calibration_store.py) that no
   scanner ever hears another scanner's advertisement — "TX×RX" as literally
   scanner×scanner does not exist in this codebase. The real pairwise data,
   already computed and discarded inside fit_path_loss()'s regression, is
   calibration-point×scanner: each point's known fabric distance to a
   scanner vs. what that scanner's fitted path-loss curve derives from the
   point's own RSSI. New calibration_matrix.js (pure, no DOM, reuses
   path_loss.js's estimateDistanceM rather than a 3rd formula copy) builds
   the grid; wired into calibration.js as an "Error Matrix" tab — diverging
   blue/green/red heat color by signed error, grey for a silent pair,
   per-cell tooltip, "Relearn" button calling the existing
   calibrationComputeModel action.
4. **Room-dwell analytics** — DONE (table form). New dwell_analytics.py
   aggregates TracebackStore's existing frames (verified first that nothing
   already computes this — presence_coordinator.py's room/floor dwell
   timers are ephemeral velocity-gate state, discarded on every room
   change) into per-object per-day time-in-room + entry counts, and a
   per-room hourly concurrent-occupancy count. New "Insights" tab
   (views/insights.js): a Time-in-Room table, a Peak Concurrent Occupancy
   summary, CSV export (reuses forensics.js's escaper) and JSON export.
   REMAINING: dwell heat tint drawn ON the iso map's room polygons —
   deliberately not touched this pass to avoid two features fighting over
   overview.js's rendering pipeline so soon after gap #1.
5. **GPS bridge** — DONE (core bridge). New geo_bridge.py converts fabric
   (x_m, y_m) to real lat/long given a settings-configured origin +
   bearing (verified first nothing like this existed — the fabric plane
   has no relationship to true north or a real location). Wired into
   device_tracker.py's PadSpanDeviceTracker, whose latitude/longitude
   properties already existed but were hardcoded to None — additive to the
   existing room-name location_name state, not a replacement. Settings →
   GPS Bridge card sets origin lat/lon/bearing. Uncovered zero test
   coverage on device_tracker.py itself (a metaclass TypeError on import
   under the test stub) and fixed the conftest.py gap causing it.
   REMAINING: no visual "alignment view" (dragging/rotating the fabric on
   an embedded real map) — numeric lat/lon/bearing fields only. That is a
   much bigger frontend undertaking (an embedded map widget) than the
   other roadmap items shipped this pass.
6. **Anchored beacons** — DONE. Verified first that most of this already
   existed: pinning a beacon to a fabric position (model.py's
   beacon_positions_m, placed via the existing drag pipeline in maps.js's
   Rooms editor or Beacon Tune's click-to-place), the solver computing a
   live position for it every poll same as any other object (the pin
   override only ever touches room, never x_m/y_m), and auto-calibration
   injection from pinned beacons (presence_coordinator.py's
   _inject_beacon_calibration) — all pre-existing, not built this pass.
   What was missing: new beacon_drift.py compares an anchor's live SOLVED
   position against its DECLARED pin position (the actual "ground truth"
   signal an anchor uniquely offers over a one-off calibration point) and
   classifies ok/warn/bad. Wired into the existing pin-override block — no
   new solver plumbing needed. calibration.js's Error Matrix (#3) now takes
   anchors as extra rows (📍) using their DECLARED position, plus a
   dedicated drift summary card.
7. **Floorplan import** — tier 1/3 DONE (Sweet Home 3D). Verified the .sh3d
   schema against the live official DTD before writing a parser (rooms are
   siblings of level, not nested; centimetres; a pre-2016 legacy-format ZIP
   is rejected with a clear error, not guessed at) — see sh3d_import.py's
   header for the full citation trail. New floorplan_import_sh3d WS command
   (ws_floorplan_import.py, sized for the next two tiers to share) parses
   only — nothing is written to the fabric. Wired into maps.js's Rooms tab
   as a new entry in its EXISTING "candidates" mechanism (same one "Map
   placements"/"Blended" use for preview/edit/commit), so this needed zero
   new preview/edit/commit UI — an upload button, a multi-level picker, and
   an import-notes line were the only new UI. Also gave the Rooms tab its
   first-ever render_smoke coverage in the process (it had none at all).
   REMAINING: tier 2 (RoomPlan JSON), tier 3 (image contour detection), and
   mirror/flip fixup buttons — not started. No real exported .sh3d file was
   available to test against; the parser is DTD-verified but not yet
   confirmed against a real file — treat the first real import as the
   actual validation.
8. **HA entities on the map** — DONE for lock, the proof of the pattern.
   Verified first that the pipeline's domain-dispatch was already an
   established (if informal) pattern — fan/motion/temp were each added the
   same way: an isX() classifier, a code-series letter, a glyph, a health
   branch, a placement-whitelist entry. lock was chosen over cover/
   climate/media_player/camera because its 3-state shape (locked/unlocked/
   jammed) already matches every assumption this pipeline makes — one
   glyph, a small closed state set, one tap action — matching a light's
   on/off shape exactly, unlike climate/media_player's numeric ranges or
   camera's live-image needs. Every extension point got the lock
   treatment: classifier, L-series code, padlock glyph (new shapeSvg/
   shapeDetailSvg case), jammed-is-unhealthy health check, class-filter
   chip, list-table state text, and — the part that would have silently
   broken locks specifically — lock/unlock services swapped in wherever
   the pipeline assumed turn_on/turn_off (openControlCard, _toggle,
   onRowClick), since the lock domain has neither service.
   REMAINING: cover (natural next — same toggle shape, 4 states), climate
   and media_player (need real new gauge/slider rendering, not just a new
   glyph), camera (live image fetching — structurally unlike anything in
   this pipeline), sensor (arbitrary, needs its own display convention).
9. **What-if placement** — DONE. Verified first that the existing modelled-
   coverage heatmap is pure client-side JS (radio_map.js's
   _modelRssiAt/_storeyModelGrid) — cheap to recompute live on every drag
   frame, no server round-trip — and that no existing scoring (the LOO
   cross-validation tooling) can evaluate a scanner that doesn't exist yet.
   New whatif_placement.js computes a per-scanner RSSI fingerprint VECTOR
   at a point (not just the strongest reading radio_map.js's own heatmap
   keeps) and scores room-discrimination as mean fingerprint separation
   across ADJACENT room pairs only — reuses radio_map.js's own newly-
   exported physics (barrierAttenuation, path-loss constants) rather than
   re-deriving it. Built into maps.js's Rooms tab (2D), NOT the 3D iso
   overview — that view has no inverse iso→world projection today and
   building one was out of scope; the Rooms tab's existing runDrag gives
   proven screen↔metre conversion for free. A toggle drops a draggable
   ghost scanner; dragging it live-repaints the discrimination delta.
10. **Lost-and-found** — DONE (core persistence + locate; sort deferred).
    Verified first `last_room` already existed but was in-memory-only (a
    bare dict on the coordinator, no Store — lost on restart) and carried
    no timestamp; also verified movement_store.py's global 500-entry cap +
    7-day age prune independently disqualify it — a new store with NO
    pruning at all was the right call. New lost_and_found_store.py (one
    {room,ts} record per object, overwritten in place, forever) wired into
    the exact moment last_room is already set. objects.js shows the
    persisted "last confirmed + time ago" for away objects; a new
    "Locate" button (panel.js) jumps to Overview and flashes the marker —
    the ring ported from iso_lights.js's locateSvg (scoped inside a
    different renderer, so reproduced not imported), auto-clearing after
    its own animation duration. REMAINING: slotted into the existing
    object list rather than a new dedicated "sortable list" view —
    column-sort-by-last-seen not built.
11. **Interaction parity** — PARTIAL. Verified first _attachPanZoom
    (maps.js) was already fully generic with exactly ONE caller (Rooms
    tab) — Overview iso, Mapping Edit, and Pin & Listen all had zero
    pan/zoom. Extracted to pan_zoom.js so views can share it, added
    keyboard nav (arrows/+/-/0) once in the shared module (Rooms tab gets
    it for free too), wired into Pin & Listen (tap-to-place needed zero
    changes — getBoundingClientRect() already reflects the post-transform
    box). REMAINING: Overview's iso map shares its DOM node with Pure Live
    and has its own resize-driven counter-scale system plus gap #1's
    mergeObjectLayer poll-surgery — retrofitting a transform wrapper there
    needs careful, unhurried verification, not a rushed change to the
    most complex, most heavily-shared view in the codebase. Mapping Edit's
    multi-mode (receivers/rooms/barriers) click-to-draw interactions carry
    a similar risk (attachPanZoom's drag-exclusion list doesn't know about
    them). Touch-activated tooltips and numeric X/Y coordinate entry —
    also named in this item — not built.
12. **Per-room accuracy** — DONE (scoreboard + confusion links + directed
    guidance; trend history not built). Verified first that loo_accuracy()
    already held-out every calibration point and re-scored it against its
    k-NN/RF neighbours for POSITION error, discarding the room label it
    also implicitly predicts — the room-vote math (same weighted vote as
    knn_locate's room_scores, same OOB-leaf vote as RandomForestLocator's
    room_scores) already existed on the live path, just never run during
    LOO. Extended both the k-NN loop and the RF out-of-bag loop to also
    track (true_room, predicted_room) per held-out point in the SAME pass
    used for position error (no second O(n²) walk), aggregated by a new
    shared _summarize_room_confusion() into a per-room accuracy scoreboard
    + sorted confusion-pair list, attached as room_confusion on both the
    global and per-map loo_accuracy. Model tab gets a scoreboard card
    (bars, worst room first) and, on each floor's mini map, tinted dashed
    lines between confused rooms' centroids (reusing calibration.js's own
    _roomCentroid — thicker/redder = confused more often). Roam tab gets a
    "Priority: <room>" advisory card (using that map's OWN room_confusion)
    ahead of the purely-geometric next-target crosshair, naming which room
    is actually wrong and suggesting how many more points to collect —
    the crosshair only knows about geometric coverage gaps, not accuracy.
    REMAINING: no accuracy-over-time trend (would need to store historical
    loo snapshots, not just the latest compute).
13. **Ground-truth walks** — extend RSSI Vector Capture with a draggable
    truth marker; replay through solver for metre/room accuracy; A/B settings
    against the same capture.
14. **BLE+motion fusion visible** — per-room agreement badge (BLE vs motion),
    person/device count chip on room polygons; optional solver demotion.
15. **Cinematic lights** — glow gradients clipped to room polygons via
    clipPath (no wall bleed), slab tint from blended live rgb/brightness,
    sun-driven ambient (hook exists in Showcase).
16. **Search + fly-to + follow-mode** — search box matching objects/rooms/
    scanners, viewport tween to result + locate flash; follow pins Pure Live
    viewport to an object across floors.
17. **Review timeline** — room-change/first-seen/motion-burst event feed with
    filters; click jumps Traceback scrubber; unify Follow + Traceback history
    onto one server API.
18. **Multi-floor polish** — animated slab explode/collapse transitions,
    click-slab-to-focus, saved viewpoint presets + kiosk auto-tour, swipe
    floor switching. Explicitly NOT WebGL — stays pure-SVG.

## Already ahead of the field — extend, don't rebuild

- **Traceback history playback** (only commercial RTLS matches it; competitor
  stores history but has no UI). Extend via #1 trails, #4 analytics, #17 feed.
- **Multi-map/floor alignment tooling** (3D Stack, point-pair solver, tie-ins,
  migration-with-undo) — nothing comparable at any tier.
- **Photo pipeline + fabric metre-space truth** (photos display-only).
- **Calibration suite depth** (Pin & Listen, Roam coverage + next-target,
  LOO CV, wizard) — gaps are presentation (#3, #12), not collection.
- **RF modelling overlays** (per-wall attenuation, IDW heatmap, distortion
  vectors) — #9 monetizes what exists.
- **Lights on the presence map** (entire iso_lights engine) — unique asset;
  #15 is polish.
- **Onboarding/education machinery** (wizard, ~40 animated SVGs, manual) —
  unique; fix stale master-map/QA copy when touched.
- **Bluetooth forensics** (bipartite graph, ad explorer, IRK manager).
- **Occupancy intelligence** (people-count + evidence + training) — #14
  extends to room level.
- **Operational self-diagnosis** (health tables, critics, checklists) —
  remaining work is consolidating Health/Monitor/QA, not new capability.
- **Kiosk Pure Live** — wall-panel territory competitors ignore.

## Known internal debt the builds should respect (from the code inventory)

- 3+ independent copies of the iso projection (overview, traceback,
  calibration ×2) beside the newer shared fabricFrame used by lights —
  prefer extending the shared one; don't add a 5th copy.
- Everything renders by full innerHTML rebuild; #1 introduces stable-node
  animation — keep its pattern reusable.
- No i18n, no real theming (light mode = CSS invert filter), no WebSocket
  push (5s polling), Follow history is client-only vs Traceback server
  history (#17 unifies).
- Stale copy: first-upload tip and QA/manual still reference the removed
  "Master map" concept and a "3D Stack" placement flow that moved.
