# Changelog

All notable changes to PadSpan HA are documented here.

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
