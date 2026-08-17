# Changelog

All notable changes to PadSpan HA are documented here.

---

## 0.34.3 — Identity, walls and lights in the fabric; websocket.py split (2026-08-17)

### Fixed — identity (the "closet beacon" flips)
- **Four CP27 beacons were one object.** MAC Rotation Bridging linked a "new RPA" to a cached identified one on a matching advertisement fingerprint without checking that the old address had *stopped*; `48:87:2D:…` is a public OUI the RPA heuristic false-positives on, all four share one fingerprint, so live beacons were chained together — and once bridged they were excluded from iBeacon grouping, so the pack/rotator split never got its turn. The merged object's vector alternated between two closets; what looked like a room-vote flip was two beacons taking turns. A bridge now requires the address bridged *from* to be silent (>5 s or gone), and an advertiser that names its own identity (iBeacon) is never fingerprint-bridged.
- **Same-label dedup merged on a name.** A live beacon that inherited "MaschineBOX" through its MAC was folded into a stale cached ghost wearing the same label (the ghost's frozen RSSI won), so the live object vanished from the list every poll. Two objects merge only when they share an address, and the freshest one is primary.
- **A pinned room decides the floor** exactly as a voted one does; **entity trackers** get a floor too. One rule, one site, after every way the room can be set.
- **Basement Warp drew nothing**: 127 calibration points had no floor. Save time now resolves a blank floor from the room's fabric floor; a one-off migration gives stored floorless points their room's floor, else the floor of the plan they were placed on.

### Fixed — structure (fabric only)
- **Lights** have one write path — metres — and the Pro gate and appearance validation live on it. The per-photo `lights` list (and the gate that guarded only it) is gone; the shape vocabulary is the renderer's, in one place (`const.LIGHT_SHAPE_KINDS`).
- **Walls have an identity**: every barrier carries an id (migration gives stored ones theirs, cuts their `map_id`); set/remove by id; the per-photo `rf_barriers` list is no longer accepted or created. The Edit tab still *draws* a wall on the photo — it goes through the map's metre transform into the fabric the moment it is finished, and the walls shown there are the fabric's projected back. The 2D radio map and distortion grid take walls from the fabric in the world frame. Per-map `radioMapSVG`/`distortionMapSVG` are gone.
- **Library thumbnails** show the fabric's rooms and scanners projected onto the picture.
- **RPA resolution cache bounded** (4096); the room-scoring `_sigma` knob removed end to end (never ran).

### Changed — code structure
- **`websocket.py` split by subject**: 11,942 lines → registration + twenty modules (`ws_*.py`, `snapshot_builder.py`, `ws_common.py`). Every name is re-exported from `websocket.py`; the panel sees one API. Layout in the module docstring.

---

## 0.34.2 — The map is drawn from the fabric, storey by storey (2026-08-17)

### Fixed — Overview / Pure Live
- **Heat and Warp overlays drew nothing.** They sized their grid from the corners of the *photographs* at a level, through a per-photo pixel transform that indoor plans no longer carry — so the extent was empty and both returned `""` with a clean console. They now take a *storey* the overview resolves from the fabric (rooms, scanners with vertical offset, barriers, calibration points — all in metres) and size the grid from the storey's rooms. Storeys share one colour scale computed from the model, so a badly covered floor cannot look green by being scaled to itself. The render harness now asserts both overlays draw.
- **The storey loop iterated photographs.** A floor with rooms but no picture drew nothing, and neither did anything on it. The loop is now the fabric's storeys. Walls are drawn once per storey (per photo drew every wall twice on a floor traced from two pictures); scanners come from `scanner_positions_m` (a radio placed in metres but never pinned on a picture had no marker); a scanner's "Area" is the room polygon that contains it.
- **Pure Live labels were giant again — at every zoom, and after every poll.** Its zoom counter-scale *overwrote* each marker's transform with `scale(1/zoom)`, discarding the annotation scale the overview had baked in. The overview now publishes the scale on the svg root (`data-ann-k`) with an anchor on every annotation (`data-ann`), and Pure Live composes `k / zoom` with it. The scale is one number substituted when the svg is composed, so it no longer depends on what was drawn before what; it measures the container's content box, not its padded width; a width change rebuilds the svg in place wherever it is hosted.
- **Dotted circles floating around the map.** Confidence rings and the outside-the-building ring were drawn *outside* the scaled marker group — and in one branch with no marker at all. Inside the group now, along with the floor badges and the legend row.
- **A floor beside the ground floor was placed a storey up.** `floor_base_elevations_m` read the running sum after it had already advanced, so "Outside" came out level with the bedrooms (5.6 m on the live install). Same-storey floors share the storey's base.

### Fixed — positioning
- **An object is on the floor of its room.** The room is the vote's answer; the solvers' per-poll floor was a second, undefended one — as evidence thinned, spatial (sticky) and k-NN (raw) took turns supplying it, and the *floor* flipped upper↔main every few polls on a beacon whose *room* never left the closet. Measured: 26 floor-change events in a 55-frame capture, all but three on objects whose room did not change. The solver's floor stands only for an object whose room the fabric cannot place — and a *pinned* room decides the floor exactly as a voted one does (pins are applied last, and used to leave the solver's floor in place). Verified on the live snapshot after deploy: every tracked BLE/iBeacon object's floor equals its room's floor.
- **k-NN needs two live scanners.** One reading against several hundred fingerprints matches whichever stored point has that scanner at about that level — on a real house routinely an *outdoor* point. Seventeen of twenty-two floor flips in a ten-minute capture were this.
- **A thin poll holds the last position** for the same window the RSSI stage holds a silent source, instead of handing the object to whatever k-NN said from one faint reading.
- Learned floor attenuation was tried in floor selection against the same capture, made it worse (7 → 24 events), and is not shipped.

### Removed
- **Client-side positioning in the overview** — a fingerprint match and an RSSI-weighted centroid of scanner *screen* positions that filled in behind the server. Two more opinions on where a beacon is, in a spot no other view agreed with. The server places things; the map draws (server position, else room centroid, else nothing).
- **`room_sigma_m` and the "Gaussian room scoring" it configured** — described in the pipeline docstring, the settings card, the QA formula panel and the capture header; never what ran. Removed end to end.
- Per-photo iso heatmap, its legacy calibration variant, the module-level global colour range, and the overview's copy of hidden-map sync.

### Fixed — resource
- The RPA resolution cache is bounded (4096); expired entries are evicted once it is full. Every address heard was cached and never evicted — ~1,800 a poll on a real house.

### Docs
- `03_MAPPING_SUITE.md`: storeys and overlays from the fabric; the annotation contract. `09_HARD_WON_RULES.md`: two views drawing one thing share a contract, not a guess; when something "no longer works", check what it is still reading.

---

## 0.34.1 — Positioning stops acting on evidence it does not have (2026-08-17)

Measured on a live three-storey house before and after, same method: **floor flips per minute 9.7 → 4.9**, and the "gap" polls where the heard scanner count collapsed to 4 are gone (minimum now 10). Groups of beacons sliding off position together for three or four polls — the thing that made the whole map look flakey — was one root cause seen from three angles.

### Fixed — positioning
- **Anchors dropped after one missed poll.** The spatial solve discarded a scanner the first poll it went quiet, while the Kalman stage a few lines above was deliberately holding that scanner's last real value through the silence grace window. Two stages in one function contradicting each other. BLE advertisements miss polls constantly, and every device loses the *same* scanner on the *same* poll — so they all re-solved from the same reduced anchor set and moved as a group, in whichever part of the house that scanner anchors. A source now leaves the solve when it starts *decaying*, not when it merely misses.
- **Position had no plausibility gate.** RSSI has a Kalman covariance and a silence grace; rooms have to win a vote window; the α-β position filter accepted half of any residual unconditionally, and fed it into velocity, so one bad measurement gave the dot momentum in the wrong direction on the next poll. A step implying more than 5 m/s is now treated as a bad measurement — the filter coasts on its prediction, and believes the new position only after three consecutive polls agree (a beacon switched off and carried really does teleport).
- **Floor selection had no sense of how much it had heard.** It was recomputed from scratch each poll and compared on equal terms whether fifteen scanners had reported or two. A floor change now needs the device to have heard a fair share of what it *usually* hears, and to beat the incumbent by a real margin. An earlier version of this used an absolute quorum of three, which was unreachable — floor selection only runs once three scanners have reported. Fixed to be relative to each device's own norm.
- **Cross-floor scanners solved position.** A scanner one storey away hears a device through the slab; its reading says something about which floor and almost nothing about where on it. Two garage scanners at −74 dBm were dragging a device its own closet scanner heard at −63 down a storey and outside every room — while the room vote, which never used them that way, stayed correct. On-floor scanners now solve position whenever there are enough to solve at all; cross-floor readings are the fallback for a thinly covered floor.
- **The metre anchor's Python half.** `fabric_truth.find_metre_anchor` computed both axis scales and returned only x (issue #62's other side — the side that *writes* committed geometry and `map_transforms`). Both axes now.
- **"Excluded scanner" had four implementations**, and the two used by the live snapshot and by advertisement ingestion omitted `excluded_scanners` entirely — a receiver the user had masked because it physically moved went on placing objects. One rule in `presence_rules`, with a guard against a fifth copy.
- **A calibration point on an unmeasured map was saved with no position.** It counted toward every total and was ignored by every learner. Refused at save time now, with a message that says what to do.

### Fixed — Overview
- **The frame never saw the drawing.** `_isoBB`, which the svg frame is fitted to, was grown *below* the fabric early-return in `iso()` — so on every install with a fabric it stayed empty and the frame silently fell back to a fixed 880-unit heuristic around a ~500-unit building. That was the blank sides, and it is why five attempts to fit the drawing more tightly *inside* `fabricFrame` changed nothing visible.
- `max-height:${vh}px` capped the rendered width to about `vw` px regardless of the panel. Removed; the map fills its width and scrolls.
- Labels and markers are counter-scaled per group by designed-vs-actual pixels per unit, so a wider frame does not mean bigger words.

### Fixed — panel
- `_getModel` spread the whole `model_get` response instead of whitelisting keys. The whitelist had dropped a key three separate times (origin forwarding, the migration marker, `light_positions_m`/`floor_elevations`). Guarded so it cannot come back.

### Removed
- `_primaryMapIdForFloor` in `views/maps.js` — one reference, its own definition.

---

## 0.34.0 — RSSI Vector Capture, and a floor model that reaches positioning (2026-08-16)

### Fixed — multi-floor positioning

- **The floor list never reached the positioning code.** `ModelStore.data["floors"]` is the sole input to `floor_stack_index()` and `floor_base_elevations_m()`, and nothing ever wrote it. The panel looked right because it reads the HA floor registry live *for display* — but positioning found the single synthetic `main` entry the store is created with and ran **every multi-floor install as one storey**. Cross-floor RF paths all fell back to a flat one-slab penalty, so a basement scanner and an upstairs scanner were penalised identically and floor selection had nothing left to discriminate with. Measured on a three-storey house: 2,886,899 confirmed cross-floor room changes, split 1,093,120 / 1,062,985 between the two directions — a near-perfect symmetry, which is oscillation and not movement. Floors are now synced from the registry each poll, and any learned cross-floor attenuation gathered before this is suspect.
- **Two floors on the same storey were a slab apart.** `floor_stack_index()` returned enumerate() positions, so "Outside" and "Main" — both at ground level — came out one apart, and every outdoor scanner was charged 10 dB of concrete it never saw through. Indices are assigned per distinct storey now, and floors sharing a storey also share a base elevation instead of inventing 2.8 m of building between them.
- **Floors with no `level` set stacked in creation order.** HA's registry leaves `level` null on most installs, so an alphabetical registry stacked a house wrongly. Ordering now falls back to what a floor id means (`basement`, `ground`, `upper`, `attic`, and outdoors at ground) before it falls back to stored order.

### Fixed — four views that parsed and then threw

Each rendered blank with a clean console, because `panel.js` loads views with `.catch(console.warn)`:

- **2D Map Mode was dead entirely** — `liveSnap` and `helpBtn` were locals of `overview.js` that did not survive the extraction into `plan_viewer.js`.
- **Clicking an occupied room did nothing** — `_showRoomDetail` called `fmtAgo`, a local of `_showObjectDetail`. It is a shared helper now.
- **Floor heatmap legends threw** — `floorHeatmapSVG` read `_wpRssis`, a local of a different function.

`tests/test_frontend_renders.py` now imports every view under a DOM shim and calls its entry points, flushing deferred work. Verified as a real guard: with the `liveSnap` bug reintroduced, `node --check` passes and this fails by name.

### Fixed — the reason none of the above was visible

- **Frontend changes were invisible until a release.** `BUILD_ID` was a hard-coded literal in `build_info.py` and again in `panel.js`, so every asset URL kept the same `?b=` stamp between releases and browsers served cached JavaScript no matter what was on disk or how many times Home Assistant restarted. A new `ASSET_ID` appends a digest of the frontend tree, and `panel.js` reads the stamp off its own module URL so every view inherits it.

### Fixed — mapping

- **Delete room did nothing visible.** It cleared `room_meta`, adjacency and the scanner map — all ModelStore fields — and left `room_geometry_m` alone, which is where the shape lives. The room kept drawing and kept being a room the pipeline could choose. Removal is now one store call covering all four.
- **Floor slabs were the bounding rectangle of a floor's rooms**, 1.7–2.5× the real floor area on a house with a stairwell void or one outlying room. Each slab is the union of its room footprints now.
- **The 3D stack was sheared.** Every floor was drawn centred on its own bounding box, so storeys that overlap correctly in the fabric were pushed apart on screen — walls met at different angles per floor and set-back floors read as boxes in the wrong place. One building, one origin. Scale and centring also come from the projected shape now rather than the bounding diamond, which a building never fills.

### Added
- **RSSI Vector Capture** (Settings → Features, off by default) — record what every scanner heard for every tracked device, poll by poll, alongside the room PadSpan chose, then export the trace and replay the same walk offline against changed settings. Until now a positioning change could only be argued from memory: a room felt stickier, a floor flipped less. A capture makes the input reproducible, so a change can be scored instead of recalled.
  - Session-scoped. Nothing is written until you press Record in Health → Quick actions; a session stops itself at 60 minutes or 25 MB and says which cap it hit.
  - **Mark room** stamps ground truth while you walk, which is what turns a recording into something that can be scored rather than merely replayed.
  - Records **identified or followed devices only** — the same rule the traceback uses. Measured on a real house, that is about 12 devices out of ~1,800 BLE objects per poll; the rest are neighbours' phones heard by one or two scanners, useless to a positioning fixture and not ours to record.
  - Exports as `.jsonl` straight from the browser. `tests/test_capture_replay.py` loads an export as a pytest fixture and scores it two ways: against the answers the pipeline gave when recording (a refactor that moves one answer fails), and against your own room labels (a tuning change becomes a number).
  - Captures are not included in backups, and a factory reset deletes their files as well as their index.

### Fixed
- **Per-device state no longer accumulates for the life of the process** — `_spatial_debug` was written for every object key from four places and cleared from none, so every rotating Bluetooth address that ever passed the house left an entry behind. Invisible on a home install; unbounded on a large one. The guard that should have caught it listed the state dicts by hand, and now discovers them instead, so the next one is caught the first time it is populated.

---

## 0.22.7 — Lights placement (Pro) + private-BLE and map-migrate fixes (2026-08-10)

### Added
- **Lights map placement** (PadSpan Pro) — place your lights on the floor plan from the Mapping view's Lights tab, rendered as a room-polygon view. Saving light placements requires an active Pro license; everything else in Mapping is unaffected.

### Fixed
- **IRK table Delete button targets the right entry** — devices with identical names were merged by an internal name-keyed join, so deleting one row could remove a *different* device's config entry. Rows now carry their own entry identity, and renamed devices show their new name immediately instead of after a restart.
- **Adding an IRK no longer leaves phantom config flows** — each failed format attempt now cleans up after itself (they used to accumulate as in-progress flows until restart), and re-adding the same IRK in a different format/byte order is correctly detected as a duplicate instead of creating a second entry.
- **Delete & Migrate now actually moves calibration points** — a wrong field name meant migrated points kept their old on-map positions while being re-owned to the target map. Positions now transform correctly.
- **3D alignment editor: different-aspect maps open undistorted** — the editor sizes its stage to the reference map, which pre-stretched any target with a different aspect ratio and forced users to hand-hunt the X-stretch correction (destroying precise 4-point alignments along the way, part of the issue #56 chain). A never-aligned target is now auto-corrected on selection.

---

## 0.22.6 — Re-anchor hardening (2026-08-09)

### Fixed
- **Re-anchor no longer adopts stray calibration points** — remapping after a re-anchor could claim orphaned points (from deleted maps or other floors) that happened to land inside the map under the chosen pose; a wrong pose would then make the corrective re-anchor impossible. Re-anchor now only ever moves points the map already owns.
- Re-anchor preflight tolerates malformed calibration points, and the origin readout in the Measure panel updates immediately after a successful re-anchor.

---

## 0.22.5 — Map origins are now anchored (2026-08-09)

### Fixed
- **Display edits can no longer redefine world coordinates** — a map's real-world origin and rotation used to be re-derived from presentation state (stack offsets, master flag) whenever a map was re-measured, migrated, or had its image replaced. Moving a map in the 3D alignment editor and then re-measuring could silently shift every calibration pin's world position (the root cause behind issue #56). The world pose is now **write-once**: set when a map is first measured, preserved through re-measures and image replacements, and changed only by the new explicit re-anchor action.
- On upgrade, every existing map transform is frozen exactly as it is — a one-time migration marks the stored pose as anchored without changing a single number, verified against a production dataset (9 maps, 746 calibration points, zero movement).

### Added
- **Re-anchor origin** (Measure panel) — the one sanctioned way to redefine a map's world origin/rotation. Your calibration pins keep their real-world metre positions and their on-map positions re-derive through the new pose. The action refuses (changing nothing) if the requested pose would strand most pins off the map, and rolls back completely if anything fails partway.

---

## 0.22.3 — Calibration & Private BLE fixes (2026-08-04)

### Fixed
- **Calibration pins no longer collapse to the map corner** (issue #56) — re-deriving point positions after a map save used to clamp out-of-range results to (0,0); when the map transform disagreed with stored metre coordinates this silently piled a whole floor's calibration into the upper-left corner. Out-of-range points now keep their existing positions, and a remap that would displace most of a map's points is aborted entirely.
- **3D stack alignment saves no longer touch calibration** — the alignment editor only writes the cosmetic stack transform, which calibration does not depend on; the save was needlessly re-deriving (and potentially corrupting) pin positions.
- **Private BLE devices now show their real names** (issue #57 root cause) — the IRK table displayed the config-entry title, which Home Assistant leaves as the original MAC address forever. It now prefers the device-registry friendly name, so your renamed iPhone shows as "Garry's iPhone", not `AA:BB:…`.

---

## 0.22.0 — Forensics (PadSpan Pro) (2026-08-04)

### Added
- **PadSpan Pro licensing** — Forensics is the first Pro feature ($45 CAD/year). Enabling it asks for a licence key, validated server-side against the traks.ca licence service. The rest of PadSpan remains free and unchanged.
- **Forensics mode** (off by default, opt-in via Settings → Features) — answers "which Bluetooth devices were near my scanners between X and Y?" (issue #55). While enabled and in Live mode, a background sampler records presence *sessions* per address every 60 seconds (a 5-minute silence closes a session), with configurable retention (7–90 days, default 14) and hard caps.
- **Forensics tab** — appears only while the setting is on. Time-window search with two confidence tiers: *Recorded* (actual presence sessions overlapping the window, with dwell time, peak signal, and scanners) and *Possible* (object-history first/last-seen span overlaps the window — lower confidence). CSV export for handing results to investigators.
- **Privacy guardrails** — always-visible privacy notice, explicit confirm before enabling, double-confirm data deletion, stats display, and reliability disclaimers throughout (a BLE address is not a person; rotating MACs mean most phones won't appear consistently; results are leads, not proof). Recordings never leave the Home Assistant instance and are never included in live snapshots.

---

## 0.19.0 — Stable Release (2026-03-24)

Consolidates all v0.18.x fixes into a clean stable release.

### Fixed
- **Version display corrected** — APP_VERSION in panel.js and lights_panel.js was hardcoded at 0.17.1 and never updated. Now all 5 version sources (const.py, build_info.py, manifest.json, panel.js, lights_panel.js) are aligned.
- **UI freeze from wizard crash** — wizard auto-complete and Skip button called `this.actions.settingsSave` before actions was initialized, crashing `_renderCurrentView` and freezing the entire UI. All `this.actions` references now use optional chaining.
- **Wizard only shows on Overview** — no longer blocks navigation to other tabs.
- **Wizard recognizes Beacon Tune calibration** — checks fabric scanner positions, not just Pin & Listen points.
- **k-NN logging flood** — 652 per-cycle warnings downgraded to DEBUG. Was choking the HA event loop and degrading WebSocket responsiveness.
- **Indoor devices misplaced outdoors** — outdoor room score damping now applies to all devices unless already confirmed outdoor.
- **Hidden floors hide objects in 3D overview** — objects on disabled floors no longer render.
- **Private BLE friendly names** on map, follow, and devices views.
- **Map scale save crash** fixed.
- **Occupancy training save crash** fixed.
- **HACS ZIP structure** — verified flat layout matching v0.17.1.

### Documentation
- README rewritten for v0.17+ features
- Getting Started and Floor Plan Setup guides updated
- New screenshots: Calibration Tune, Traceback Playback, Bluetooth Visualization

---

## 0.18.2 — Stable Release (2026-03-24)

Consolidates all v0.17.2–v0.18.1 fixes into a clean stable release. Version string now consistent across all three sources (const.py, manifest.json, build_info.py).

### Includes
- Onboarding wizard: reordered steps, sub-tab routing, Basic mode fix
- Private BLE friendly names on map/follow/devices
- Map scale save, occupancy training save, blocking scandir fixes
- Documentation overhaul (README, Getting Started, Floor Plan Setup)
- New screenshots: Calibration Tune, Traceback Playback, Bluetooth Visualization
- Clean HACS ZIP (flat structure, no __pycache__)

---

## 0.18.1 — Onboarding Wizard Fix (2026-03-24)

### Fixed
- **Wizard step order** — reordered to logical sequence: Upload → Set Scale → Draw Rooms → Place Scanners → Calibrate. All map setup steps now run consecutively before calibration, eliminating unnecessary context-switching between views.
- **Sub-tab routing** — clicking a wizard step now navigates directly to the correct sub-tab (e.g., "Upload Floor Plan" goes to Maps → Upload tab, "Calibrate" goes to Calibration → Pin & Listen tab). Previously all steps landed on the default tab.
- **Basic mode calibration crash** — clicking "Place Scanners" or "Calibrate" in Basic mode now auto-promotes to Advanced mode so the Calibration view is visible. Previously these steps navigated to an invisible view.

---

## 0.18.0 — Stable Release (2026-03-24)

### Documentation
- **README rewritten** for v0.17+ features: Device Registry, positioning fabric, occupancy estimation, onboarding wizard, 2D map mode, measure tool, multi-floor intelligence, experimental features, movement playback, comparison table updated (22 views)
- **Getting Started guide updated** — onboarding wizard steps, Apple device tracking (Private BLE/IRK), occupancy estimation, movement history, troubleshooting for v0.17 fixes
- **Floor Plan Setup guide updated** — measure tool instructions, master map concept, 2D flat map mode, multi-floor alignment workflow
- **Documentation index** added to README linking all guides

### Fixed (from v0.17.2–v0.17.3)
- Private BLE devices show friendly name instead of MAC on map, follow, and devices views
- Map scale save crash (`scale_x_m` undefined)
- Occupancy training save crash (`async_save` → `store.async_save`)
- Blocking `scandir` in factory reset event loop
- Onboarding step click crash (`renderRooms` undefined)

---

## 0.17.3 — Bug Fix (2026-03-24)

### Fixed
- **Private BLE devices show friendly name instead of MAC** — map, follow, and devices views now use the resolved `private_ble_name` (e.g., "Adam's iPhone") when no user label is set, instead of displaying the raw rotating MAC address. Affects overview (2D, 3D, room chips, ISO stack), follow view, and devices list.

---

## 0.17.2 — Bug Fix (2026-03-24)

### Fixed
- **Map scale save crash** — "Save Scale" button referenced `scale_x_m` / `scale_y_m` before they were defined, causing `ReferenceError` and preventing scale saves (maps.js:1944)
- **Occupancy training save crash** — `ws_occupancy_train` called `_st.async_save()` which doesn't exist on `SettingsStore`; corrected to `_st.store.async_save(_st.data)` (websocket.py:8374)
- **Blocking `scandir` in event loop** — factory reset's map-file cleanup used synchronous `iterdir()` / `is_dir()` inside an async handler, triggering HA's blocking-call detector; wrapped in `asyncio.to_thread` (websocket.py:7508)
- **Onboarding step click crash** — `this.actions.renderRooms()` could fail with `TypeError` if `actions` was undefined during panel init; added optional chaining with fallback (panel.js:2414)

---

## 0.17.0 — Stable Release (2026-03-23)

Major release with 78 commits since last stable (v0.15.25). Introduces the Device Registry identity system, positioning fabric decoupling, multi-floor accuracy learning, occupancy estimation, and an onboarding wizard.

### Device Registry (NEW)
- **Stable device identity** — every physical device gets an immutable `padspan_id` (format: `ps_<12 hex chars>`) that survives MAC rotation, iBeacon UUID changes, and firmware updates
- **Identity resolution** — O(1) lookup from any volatile key (MAC, iBeacon, canonical_id) to stable padspan_id
- **Automatic migration** — existing labeled objects in ObjectStore are auto-migrated to DeviceRegistry on first startup
- **Label pipeline** — DeviceRegistry is now the primary label source; ObjectStore is a thin fallback
- **HA entity identity** — sensor and device_tracker entities use padspan_id for stable HA device identity
- **Frontend management** — Devices view has interactive registry: merge duplicates, add identities, relabel, delete, view identity chains
- **7 WS commands** — list, migrate, merge, resolve, label_set, add_identity, delete
- **Health checks** — Device Registry status, Label Pipeline health, dependent store migration progress

### Positioning Fabric (decoupling from maps)
- **Fabric is the authority** — all spatial data (scanner positions, room geometry, RF barriers, beacon positions) stored in real-world metres in the positioning fabric
- **Maps are setup tools only** — floor plan images no longer own positioning data, overview map toggle defaults to off
- **Metre-space coordinates** — all stores use real-world metres with floor_id references
- **Map transforms** — affine transforms convert between map fracs and metres
- **Measure tool** — two-point reference distance calibration with aspect ratio validation

### Multi-Floor Accuracy
- **Floor-transition learning** — adaptive store records floor-to-floor transitions with Welford stats on dwell time
- **Dwell-based velocity gate** — short dwell (<30s) requires unanimous vote; medium dwell (30-120s) needs supermajority for cross-floor; long dwell (>120s) uses normal threshold
- **Learned cross-floor attenuation** — Gaussian scorer applies learned RSSI corrections to cross-floor scanners when adaptive floor detection is enabled
- **Outdoor penalties** — outdoor scanners get 0.30x Gaussian damping; indoor-outdoor transitions require 4x floor stickiness

### Occupancy Estimation
- **Dedicated Occupancy dashboard** — new sidebar view with building summary, per-room breakdown, training controls, and training history
- **Hybrid counting** — identified devices count 1:1, unidentified BLE with dwell >5min count with configurable multiplier (default 1.5x)
- **Training** — enter actual headcount to adjust the multiplier via EMA learning

### Onboarding Wizard
- **Guided first-run setup** — persistent progress bar detects 5 steps: upload floor plan, set scale, place scanners, draw rooms, calibrate
- **Auto-detection** — each step auto-completes when its data is detected
- **Click-to-navigate** — each step links directly to the right view
- **Skip option** — dismisses permanently via settings

### Calibration & Beacon Tune Fixes
- **Room polygons no longer block dragging** — `pointer-events: none` on room polygons in both Tune and Beacon Tune
- **Save-pulse animation** — save button pulses green when there are unsaved changes (dynamically updated after drags)
- **Beacon sync to maps** — fabric beacons are now synced back to maps store for consistent rendering
- **Unique beacon IDs** — prevents drag handler from matching wrong beacon when multiple have empty IDs
- **SVG not rebuilt mid-drag** — `_refreshSVG()` checks `_dragging` flag
- **Watchdog fix** — no longer force-renders on non-live views (was disrupting calibration mid-drag)
- **Out-of-bounds beacons filtered** — beacons outside map coordinate range are skipped instead of clamped to edges

### Distance Traveled
- **Fixed data reading** — was reading `frame.objects` instead of `frame.o` (compact format), producing zero distance for everything
- **Jitter filtering** — steps <0.5m ignored, same-room capped at 3m, time-gap scaling for downsampled views
- **Reliability score** — shows what % of position steps passed the jitter filter
- **Investigate button** — popup showing total steps, good steps, jitter filtered, max step
- **Stationary references** — mark known-fixed devices as references; their phantom distance becomes a BLE accuracy diagnostic
- **BLE Accuracy rating** — Excellent/Good/Fair/Poor based on total phantom distance from reference devices

### Other
- **Donate button** added to README (PayPal)
- **Traceback** — padspan_id recorded on each frame object for stable history
- **Movement history** — padspan_id on room transition records
- **Follow alerts** — padspan_id auto-backfilled on startup
- **`padspan_id` in HA entity attributes** — visible in developer tools on area sensors and device trackers

---

## 0.5.91 — Hardware Guide & Cleanup (2026-03-01)

### Added
- **Scanner Hardware walkthrough** — New Training Hub walkthrough with animated SVGs covering antenna comparison, board recommendations, and why room-level tracking demands better hardware than home/away
- **Scanner Hardware manual section** — Detailed reference in Training Hub manual with tested board recommendations (ESP32-S3 + Ethernet, ESP32-S3 + WiFi, ESP32-C3 — all with external antennas)
- Hardware guidance added to Getting Started guide and README
- `.gitignore` updated to exclude dev artifacts

### Fixed
- `esc is not defined` error in Settings → Scanner Map (`_scannerMap()` function was missing `ctx.helpers.esc`)
- SVG XSS hardening in demo floor plan builder (room/radio/object names now escaped)

### Removed
- 21 legacy doc files (old v0.3.x install notes, placeholders, duplicates)

---

## 0.5.88 — Beta Launch Prep (2026-02-28)

### Added
- **BLE data enrichment** — Objects now show decoded company names (Apple, Samsung, Google, Xiaomi, etc.), device types (Find My, AirPods, Nearby Info), and GATT service names (Battery, Tile, Device Information) as color-coded badges. Search by company or device type in the Objects tab.
- **QA Radio Analysis card** — Per-radio health scoring with activity metrics, cross-scanner overlap comparison, and network info (IP, SSID, WiFi signal)
- **Development disclosure** — README, CONTRIBUTING, and repo topics transparently describe AI-assisted development process
- CI tests — 36 automated tests for maps store, object store, config flow
- GitHub issue templates (bug report + feature request)
- CONTRIBUTING.md with development setup guide
- `connectable` flag captured per BLE advertisement

### Fixed
- **Security** — Escaped all user-controlled strings in overview, maps, and settings SVG innerHTML (XSS prevention)
- **Security** — Admin-only gating on destructive WebSocket handlers (maps delete, area delete, entity delete, calibration clear, integration reload)
- **Security** — Map upload 20MB size limit + path traversal protection on file operations
- **Mobile** — Tooltip overflow on small screens, input minWidth overflow, toolbar wrapping
- **Performance** — Visibility handler and modal ESC listener now properly cleaned up on disconnect (prevents memory leak in long sessions)
- `esc is not defined` error in maps.js 3D Stack view
- Radio Analysis identity section words running together
- Network info only showing for one radio (backend now tries source slug)

### Changed
- Radio health scoring only flags provable issues — "Unhealthy" for hard failures, "Fair" for ambiguous, "Healthy" otherwise
- `binary_sensor.py` proper `async_setup_entry` stub (was causing silent platform failure)
- Config flow exception handling narrowed from `Exception` to `(ValueError, TypeError)`

---

## 0.5.79 — Training Hub & Documentation (2026-02-27)

### Added
- **Training Hub** — Guided walkthroughs for Overview, Follow, Objects, Maps, Settings, and Calibration
- 9 new Manual sections covering all remaining views
- Calibration walkthrough with 4-step animated guide
- Marketing screenshots and launch documentation

---

## 0.5.77 — HACS & Hassfest Validation (2026-02-27)

### Added
- HACS validation CI workflow
- Hassfest validation CI workflow
- Brand icon for HACS store listing

### Fixed
- manifest.json key ordering and removed invalid `icon` key
- services.yaml removed invalid `response` key, added proper `target`
- Added `bluetooth` to `after_dependencies` in manifest

---

## 0.5.75 — Major Feature Release (2026-02-27)

### Presence & Tracking
- **Follow mode** — animated room map, movement timeline, multi-device simultaneous tracking
- **Email alerts** on room change (per-device, 60s rate limit, persistent config)
- **Kalman-filtered RSSI smoothing** replacing simple EMA for smoother room transitions
- **Private BLE address resolution** — iBeacon UUID parsing + IRK support for rotating addresses
- **HA entities** — area sensors, distance sensors, device trackers, binary sensors per tracked device
- **Home/away persistence** — binary sensors survive HA restarts
- **Distance estimation** — log-distance path-loss model with configurable reference power and exponent

### Floor Plans & Maps
- **Floor plan editor** — upload PNG/JPG, draw room boundary polygons over blueprints
- **3D isometric multi-floor visualization** with live object positions and room labels
- **Scanner markers** — drag-and-place with 3-digit radio short IDs
- **Stale radio detection** — auto-detect and flag radios no longer in your BLE network
- **Scanner network info** — WiFi SSID, IP address, connection type

### Calibration
- **Full calibration system** — walk-around fingerprint collection with standalone phone panel
- **k-NN fingerprint matching** + **OLS path-loss model** fitting per scanner
- **Coverage heatmap** with guided next-target suggestions
- **Leave-one-out cross-validation** for model quality scoring
- **3D isometric tune view** with draggable receiver markers

### UI & Experience
- **21 dedicated views** across Basic and Advanced modes
- **Training Hub** with guided walkthroughs
- **Sample mode** — fully functional demo with synthetic data
- **11 languages** — EN, ES, FR, DE, IT, PT, NL, ZH, JA, KO, RU
- **Dark forest-green theme** designed for ambient displays
- **Object tagging** — label BLE devices with friendly names, OUI vendor lookup

### Backend
- **DataUpdateCoordinator** polling live BLE snapshot every 10s
- **WebSocket API** for all frontend communication
- **Persistent stores** for settings, maps, objects, calibration, and alert configs

---

## 0.4.x — Foundation (2026-02)

### Added
- Initial integration scaffold with config flow
- Basic BLE scanning via HA Bluetooth component
- Live snapshot with radios and advertisements
- Objects inventory with deduplication and OUI frequency badges
- Vendor lookup via MACVendors + MACLookup APIs (cached 30 days)
- Packaging for HACS (icons, install path, cache-busting)
