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
| 1 | IN PROGRESS | Animated live movement: tweened markers, room-color transitions, fading trails | visualization |
| 2 | TODO | Confidence/evidence visualization: per-scanner distance rings, per-room probability, confidence halo | visualization |
| 3 | TODO | Scanner-pair calibration error matrix (heat-colored, reset/relearn buttons) | analytics |
| 4 | TODO | Room-dwell analytics: time-in-room, occupancy heatmap, entries/exits, CSV export ("Insights" tab) | analytics |
| 5 | TODO | GPS geolocation bridge: fabric→lat/long, device_tracker GPS attrs, HA map interop | platform |
| 6 | TODO | Anchored beacons: stationary tags as ground truth (drift warnings, free auto-calibration) | editing |
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

1. **Animated live movement** — stable per-object `<g>` nodes in the iso object
   layer (Overview `ISO_OBJECTS_START` partial swap currently string-replaces)
   with CSS-transition transform + fill: dots slide ~1s to new positions and
   re-tint to room color instead of teleporting each 5s poll. Optional fading
   breadcrumb polyline (client ring buffer, world-metre frame). Apply to
   Overview iso, Pure Live, Traceback frames. (ESPresense-companion has
   spring-animated markers; most visible hobbyist-vs-commercial tell.)
2. **Confidence visualization** — click object → per-scanner distance rings in
   metre space projected to iso, "why this room" probability bars from existing
   k-NN/fingerprint scores, uncertainty halo. Backend: expose per-scanner
   distance estimates + room scores in live_snapshot.
3. **Calibration error matrix** — TX×RX grid, expected (fabric positions) vs
   measured (path-loss) distance, blue→green→red by error, tooltips, grey when
   silent; link Relearn. Data exists server-side; new sub-view in calibration.js.
4. **Room-dwell analytics** — "Insights" tab off existing server history:
   per-object per-day time-in-room table, dwell heat tint per room on the iso
   map, entry counts, concurrent-occupancy timeline, CSV/JSON export.
5. **GPS bridge** — settings lat/long/bearing for fabric origin; publish
   latitude/longitude/gps_accuracy on tracked device_trackers; alignment view.
6. **Anchored beacons** — flag object as anchored at a fabric position (reuse
   drag/placement pipeline); pin marker; solver uses as live reference; drift
   warning; extra rows in the #3 matrix.
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
