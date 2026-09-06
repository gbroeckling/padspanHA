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
| 13 | DONE (2b29c56) — numeric position mark, not draggable; room-accuracy A/B only, position not re-solved | Ground-truth capture walks with accuracy scoring and settings A/B replay | history |
| 14 | DONE (23b24a8) — agreement badges + count chips on room polygons; solver demotion not built | BLE + motion fusion made visible: per-room agreement badges, occupancy count chips | visualization |
| 15 | DONE (72e93fb) — live-blended room tint added; clipPath wall-bleed prevention and sun-driven ambient were ALREADY shipped, undocumented | Room-polygon-clipped light glow + live-color room tinting (cinematic Showcase upgrade) | presentation |
| 16 | DONE (5f29ca4) — search + fly-to camera in Pure Live only; follow is a one-shot "center camera" action, not continuous auto-pin | Search-to-locate with fly-to camera; follow-mode pinning the live viewport to an object | presentation |
| 17 | DONE (82e12b4) — unified Follow's log onto movement_store; first-seen distinction + filters + Traceback jump on the existing Movement tab, not a new view; motion-burst not built | Activity review timeline (Frigate-style scrubable event feed; unifies Follow/Traceback history) | history |
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
13. **Ground-truth walks** — DONE (numeric position mark, not draggable;
    room-accuracy A/B, not position A/B). Verified first that replay
    (`load_capture`/`build_coordinator`/`replay`) already existed complete
    and correct — but ONLY inside tests/test_capture_replay.py, deliberately
    ("The panel does not replay anything — replay lives in pytest"), and
    that ground truth was room-only (`mark_ground_truth`, no position).
    Promoted the replay logic verbatim into a new capture_replay.py so
    ws_capture.py's new `capture_replay` command can run the SAME code as a
    real feature; the test file now imports it instead of duplicating it.
    Extended `mark_ground_truth` with optional x_m/y_m, carried onto every
    labelled frame as `gx`/`gy` alongside the existing `g` room field. New
    `score_replay()` reports room accuracy (from the replay's own `got` vs
    `truth`) AND metre error (the frame's OWN recorded `mx`/`my` vs the
    `gx`/`gy` mark) — the metre side does NOT re-solve position, since the
    spatial locate step lives inside the full poll loop, not the replayable
    _smooth_room path; a settings A/B therefore only ever moves the room-
    accuracy number, which the UI states plainly rather than implying a
    position A/B it cannot do. Health tab's capture card: a mark can carry
    numeric x_m/y_m alongside the room (deliberately NOT a draggable map
    pin — that would depend on the map being anchored to the fabric's world
    gauge, a real dependency a numeric field has no need of); each finished
    session gets a "Replay & Score" panel with baseline scoring and an A/B
    box for kalman_q/kalman_r/room_change_delay_s. REMAINING: no
    draggable/tap-to-place position picker; no position (metre-accuracy) A/B.
14. **BLE+motion fusion visible** — DONE (badges + chips; solver demotion
    not built). Verified first that ws_occupancy.py's compute_occupancy_estimate
    already computed everything per room (people placed by BLE, unclaimed
    phone count, HA occupancy/motion sensor flags) — occupancy.js's "Rooms
    with evidence" table already listed it as a flat table, just never
    compared the two evidence families or drawn it on a room shape. Added
    one new field, `agreement` ("agree" | "ble_only" | "sensor_only"), from
    evidence the room-building loop already had — no new sensor reads, no
    change to positioning. maps.js's Rooms tab gets a "Show occupancy"
    toggle (off by default — occupancy_estimate does real work, lazy-
    fetched like objects.js's lost-and-found) drawing a small count+
    agreement badge under each room's label, using the SAME room-polygon
    surface gap #9's what-if ghost scanner already lives on (not the 3D iso
    overview, for the same shared-view-risk reason). occupancy.js's table
    gained an Agreement column for the non-map view. REMAINING: "optional
    solver demotion" — letting a sensor/BLE disagreement lower a tracked
    object's displayed room_confidence — not built; it would need to
    cross-reference a SPECIFIC object's placement against its room's
    sensor evidence (this gap's data is per-room, not per-object-vs-room),
    and doing it safely would mean touching the live confidence pipeline
    rather than only adding a read-only visualization, a materially
    bigger and riskier change than the rest of this item.
15. **Cinematic lights** — DONE. Verified first, and found two of the three
    asks were ALREADY fully shipped, just never marked done here: (a)
    clipPath wall-bleed prevention already existed — iso_lights.js's
    buildIsoSVG writes one `psclip_N` clipPath per room polygon and applies
    it to every fixture's light pool (`clip-path="url(#...)"`), with a
    `psclipsoft` Gaussian-blur filter OUTSIDE the clip so the cut feathers
    like a real doorway leak rather than reading as a hard edge; (b) sun-
    driven ambient already existed and was already wired end-to-end —
    lights_map.js's exported `sunAmbient(hass)` reads `sun.sun`'s live
    elevation attribute and both Showcase call sites (maps.js's Lights tab,
    lights_panel.js) already pass it through as `opts.ambient`, lifting the
    ground tone and muting pools by daylight — fully functional, not just a
    "hook". The one genuinely missing piece — slab tint from BLENDED LIVE
    rgb/brightness, not a static per-room display colour — is what got
    built: a new `liveRoomColor(room, fallback)` in iso_lights.js walks the
    same on/visible/non-utility fixtures glowIds already collects for that
    room's light pools, brightness-weights their glow colours into one RGB
    average, and feeds that into BOTH the room-tint gradient dedup
    (roomGlowIds) and the room polygon's own fill/stroke — falling back to
    the room's ordinary static colour the instant nothing is lit there, so
    an empty/off room never reads as unlit black. Gated on Showcase only
    (`if(!SHOW) return fallback`), so the working map is untouched.
    REMAINING: nothing outstanding from this item's own description.
16. **Search + fly-to + follow-mode** — DONE, scoped to Pure Live only.
    Verified first that Overview's iso map has NO pan/zoom camera at all
    (gap #11 deliberately left it that way — retrofitting one was judged
    too risky on "the most complex, most heavily-shared view"), while Pure
    Live already has a real one (`MapViewport`'s tx/ty/scale state) reusing
    Overview's own rendered DOM node — building fly-to on a camera that
    already exists, in the view that already has it, is the low-risk path.
    New search index (`_buildSearchIndex`) reads objects/rooms/scanners
    straight out of already-loaded `ctx.state` — no new backend endpoint.
    Selecting a result switches Overview/Pure Live's shared floor-focus
    slider if needed (a plain instant switch — an ANIMATED slab transition
    is gap #18's job, not this one's), then measures the target's exact
    projected position via `fabricFrame` (the SAME shared, already-tested
    function `iso_lights.js` exports and Overview's own renderer uses) and
    tweens the camera there via a new `_tweenCamera` rAF easing helper.
    Object results also reuse the EXISTING "📍 Locate" ring (gap #10,
    `_overviewLocateKey`) — rooms/scanners get the fly-to zoom itself as
    feedback, no equivalent ring built for those. Followed-device chips
    get a "🎯 center camera" action reusing the same fly-to. Debugged and
    fixed live in a real browser (this JS — camera math, shadow-DOM
    traversal, async map-rebuild timing — has no realistic unit-test
    harness): a `document.querySelector` that cannot see into the panel's
    shadow root, and a fixed-delay assumption that raced the map's own
    async "Building 3D map…" → real-SVG rebuild after a floor switch
    (replaced with a bounded retry-until-ready poll). REMAINING: "follow
    pins Pure Live viewport to an object ACROSS FLOORS" is NOT a continuous
    auto-follow — it is a one-shot "center camera now" action per followed
    device (a continuous per-poll camera pin risks fighting a user's own
    pan/zoom and needed more live-tuning time than this pass had); no
    locate-flash equivalent for room/scanner results.
17. **Review timeline** — DONE (room-change + first-seen; motion-burst not
    built; extended the existing Movement tab rather than a new view).
    Verified first that THREE separate, independent client-side room-
    change trackers already existed — Follow's own ephemeral ring buffer,
    Pure Live's own ephemeral `ActivityFeed`, and history.js's Movement
    tab / manage.js's History tab, which were the only two ALREADY sharing
    one server API (`movement_history_get`) — and that "first seen" data
    already existed too, just uncredited: `presence_coordinator.py`'s
    `self._confirmed_room.get(key)` returns `None` for a device's first-
    ever room confirmation, and that `None` already flows straight into
    `movement_store.record()`'s `from` field — the loader just rendered it
    as "unknown → room", indistinguishable from a real transition. Follow
    now reads the SAME `movement_history_get` API (filtered by the
    followed object's own canonical key, not its raw address, which does
    not always match what the coordinator records under `device`),
    dropping its own tracker. history.js's Movement tab gets: a genuine
    first-seen/"returned" distinction (✨ badge, its own filter chip,
    matching the sibling Session Events tab's existing chip pattern — a
    DIFFERENT, unrelated event stream, not reused for this), and a "▶
    Traceback" action per row that opens Traceback centred on that moment
    (`ctx.state._traceback.startTs/endTs` ±2 min, `filterKey`) — the
    literal "click jumps Traceback" ask, achieved within Traceback's
    existing time-WINDOW loading model rather than building exact-frame
    seeking. Deliberately did NOT put this behind a new top-level view —
    history.js's Movement tab (already reachable, already this exact UI
    shape) is the natural home, and history.js is itself deliberately
    NOT in the sidebar MENU today (reachable by internal navigation only)
    — a precedent worth keeping rather than adding yet another tab.
    REMAINING: motion-burst — genuinely new plumbing (no existing
    persistence of motion `binary_sensor` state CHANGES anywhere, only
    live-state reads each occupancy request; this codebase never touches
    HA's own logbook/recorder either) — not started; Pure Live's own
    `ActivityFeed` still runs its separate tracker (a smaller duplicate
    left as-is rather than risking a third file mid-pass).
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
