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
| 7 | TODO | Floorplan import: Sweet Home 3D first, then RoomPlan JSON, then image room-detection | editing |
| 8 | TODO | Bind arbitrary HA entities to the floorplan (climate/cover/lock/media/camera domain registry) | presentation |
| 9 | TODO | Predictive what-if scanner placement (ghost scanner over the existing radio-map model) | analytics |
| 10 | TODO | Persistent lost-and-found: "last known room" inventory that never resets to Unknown | presentation |
| 11 | TODO | Map interaction parity: pan/zoom everywhere, keyboard nav, touch tooltips, numeric entry | presentation |
| 12 | TODO | Per-room accuracy scoreboard + confusion pairs on the map, directed collect-more guidance | analytics |
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
7. **Floorplan import** — tiers: .sh3d (zip of XML, metres) → fabric rooms;
   RoomPlan JSON→polygons; canvas contour room-candidates on uploaded images
   pre-drawn into the Rooms editor. Mirror/flip fixup buttons.
8. **HA entities on the map** — domain registry generalizing the lights
   pipeline (glyphs, state text, threshold color, tap/hold cards) for climate,
   cover, lock, media_player, camera, sensor.
9. **What-if placement** — draggable ghost scanner recomputing the existing
   modelled-coverage overlay live + room-discrimination delta score.
10. **Lost-and-found** — persisted last-confirmed room/time per tagged object
    (never Unknown), sortable list, locate flash (ring exists in iso_lights).
11. **Interaction parity** — shared viewport helper from _attachPanZoom +
    Pure Live pinch; apply to Overview iso, Mapping Edit stage, Pin & Listen;
    arrows/+/-/0 keys; tap-activated tooltips on touch; numeric X/Y entry.
12. **Per-room accuracy** — group existing LOO predictions by true room:
    accuracy % list + trend, confusion pairs as tinted links between rooms,
    "collect N more points in X" feeding Roam's next-target.
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
