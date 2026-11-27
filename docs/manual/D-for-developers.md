# Appendix D. For developers

[Contents](README.md)

How PadSpan is put together, the rules its code keeps, and every websocket command it registers.
For contributing: the README's [Development](../../README.md#development) section. The longer design
notes are in `docs/` and are linked from each part.

## The shape of it

PadSpan HA is one Home Assistant custom integration, `custom_components/padspan_ha/`:

- **The backend** (Python): reads Home Assistant's Bluetooth data, ESPresense and Tasmota over MQTT,
  and the area, floor, device and entity registries; works out rooms and positions every poll
  (`presence_coordinator.py`); keeps its data in `.storage/padspan_ha.*` stores; creates the entities
  in `sensor.py`, `binary_sensor.py`, `device_tracker.py` and `light.py`; and answers the panel over
  Home Assistant's websocket.
- **The panel** (plain JavaScript modules, no build step): `www/padspan-ha/`, with `panel.js` as the
  shell and one module per screen under `views/`. The sidebar Atlas is `lights_panel.js`.
- **PadSpan Bright** is generated from the same source (`scripts/bright_build.py`), without the
  presence tracking.

A poll, in short: Bluetooth readings from every receiver → per-device smoothing over time → a room
vote and, with three or more placed receivers, a position on the floor plan in metres → the entities
and the live picture every open panel asks for.

## The fabric

**The metric fabric is the truth.** Room shapes, receiver positions, signal walls, beacon pins and
light positions live in **metres**, in the FabricStore (`.storage/padspan_ha.fabric`). A floor-plan
picture is used to trace a building once and to look at afterwards. No working code may derive a
position from a picture, its pixel size, a map's 0–1 fraction space, a map id or a per-picture
transform. `tests/test_photo_divorce.py` holds this; three files remain quarantined
(`calibration.js`, `traceback.js`, `radio_map.js`), and the guard fails if that list goes stale
either way.

| Store | File | Owns |
|---|---|---|
| FabricStore | `padspan_ha.fabric` | Room geometry, receiver, beacon and light positions, signal walls (all in metres) |
| ModelStore | `padspan_ha.model` | Floors, room metadata, adjacency, receiver room and floor, map transforms |
| MapsStore | `padspan_ha.maps` | The floor-plan pictures and their metadata |

Every write goes through a store method (`ModelStore.async_remove_room`, `FabricStore.async_remove_room`
…), never through the stored blob: a handler that edits the data directly misses whatever has moved
to the fabric since. A receiver's height (`z_m`) is measured from its own floor, never absolute.
More: [The mapping suite](../03_MAPPING_SUITE.md).

## Cache busting

Home Assistant serves a custom panel's files with aggressive browser caching, so every panel file's
address carries a stamp. A wrong stamp doesn't look like caching; it looks like your code not working.

| Symbol | Where | Meaning |
|---|---|---|
| `BUILD_VERSION` | `build_info.py` | The version, shown in the sidebar and Diagnostics |
| `BUILD_ID` | `build_info.py` | The release stamp, rewritten by `scripts/release.py` |
| `ASSET_ID` | `build_info.py` | `BUILD_ID` plus a digest of the frontend files: what addresses carry |

`build_info._frontend_digest()` hashes every `.js`, `.css` and `.html` file's path, size and time
under `www/`; `panel.py` registers the panel with `?v=<VERSION>&b=<ASSET_ID>`; `panel.js` reads `b`
off its own `import.meta.url` and uses it for every view it imports. So one stamp flows from the files
on disk to every view, and moves whenever any frontend file does. A view imports another as
`` await import(`./x.js${new URL(import.meta.url).search}`) ``. More:
[UI cache busting](../06_UI_CACHE_BUSTING.md).

## RSSI vector capture

Capture records the input the positioning actually used (the full `{receiver: rssi}` reading per
tracked device per poll) beside the answer it gave, so the same walk can be run again offline against
changed code and the difference stated as a number. Off by default:
**Settings → Features → RSSI Vector Capture**, then **Health → ⏺ Record**, **Mark room** in each room,
**⏹ Stop** and **Export .jsonl**.

- Only named or followed devices are recorded.
- A session stops itself at its duration (1 to 60 minutes), at 25 MB, or when the integration
  unloads.
- `tests/test_capture_replay.py` has `load_capture()` and `replay()`: a golden regression (the
  replayed room equals the recorded one) and an accuracy score against the rooms you marked.
- The accuracy benchmark tools read the same files: [appendix C](C-accuracy-benchmark.md).

More: [RSSI vector capture](../08_RSSI_VECTOR_CAPTURE.md).

## Hard-won rules

Each came from a real mistake; the full text with the story is in
[Hard-won rules](../09_HARD_WON_RULES.md).

1. A frontend change you can't see is not a frontend change.
2. `node --check` doesn't run the code.
3. Look at it rendered.
4. The fabric is the truth, and every write goes through its store.
5. A sidecar that nothing fills is worse than no sidecar.
6. An index difference that means something must be computed that way.
7. Guards that list their targets by hand go stale.
8. A fixture that can't fail is worse than no fixture.
9. Record what the pipeline used, not what it produced.
10. Test it against the site it will run on.
11. Deploy, restart, and click the button.
12. Two views that draw one thing must share a contract, not a guess.
13. When something "no longer works", check what it is still reading.

## Working in the repository

- Several sessions often work at once: each in its own worktree and branch. Release notes are files in
  `changelog.d/`, never a section written into `CHANGELOG.md` by hand. Releases go through
  `scripts/release.py` only. The repository's `CLAUDE.md` has the rules.
- A new third-party import goes into `requirements_test.txt` in the same commit
  (`tests/test_requirements_declared.py`).
- Names from devices, receivers and rooms are always set as text, never as markup
  (`tests/test_hostile_names.py`).
- PadSpan never changes another integration's devices or entities on its own; a test fails if new code
  tries to.
- The manual's reference tables (chapters 12, 14, 20 and the table below) are made by
  `scripts/build_manual_reference.py` and pinned by `tests/test_manual_reference.py`. When that test
  fails, run the script and commit what it wrote.

## Websocket commands

Every command the integration registers, read from the code: each handler with
`@websocket_command` that the integration registers. **Administrator** says `always` for a handler
marked `require_admin`, and `with Enhanced security` for one that needs an administrator while
Enhanced security is on ([chapter 21](21-users-and-security.md)). A handler can also refuse parts of
a request inside it. These are the panel's own commands, not a stable public interface: they change
between versions. For automations, use the entities, services and events in
[chapter 14](14-home-assistant-reference.md). More: [Websocket API](../02_WEBSOCKET_API.md).

<!-- generated:websocket (scripts/build_manual_reference.py) -->
288 commands. Each takes `id` and `type` as well; a field marked (optional) may be left out.

| Command | Fields | Administrator | Module | What it does (its handler's first sentence, or a line written for this table) |
|---|---|---|---|---|
| `padspan_ha/adaptive_fingerprints_get` | – | – | `ws_adaptive.py` | Return raw adaptive learning fingerprints for heatmap visualization. |
| `padspan_ha/adaptive_reset` | – | with Enhanced security | `ws_adaptive.py` | Clear all adaptive learning data. |
| `padspan_ha/adaptive_status_get` | – | – | `ws_adaptive.py` | Return adaptive learning summary stats. |
| `padspan_ha/ai_usage_get` | – | always | `ai_usage.py` | Settings → AI's line: this month's reads, estimate and stops (summary). |
| `padspan_ha/ai_wizard_check_claude` | – | always | `ai_wizard.py` | Checks that PadSpan's AI Task can answer (an account with credit) before an AI map-building run starts. |
| `padspan_ha/ai_wizard_info` | `surface` (optional), `kiosk` (optional), `live` (optional) | always | `ai_wizard.py` | {reason, offer, wizard, tier, trial_offerable}: the rule's answer for this screen, and where this house is with the helper (settings.ai_map… |
| `padspan_ha/ai_wizard_mark` | `what`, `surface` (optional), `step` (optional), `setup_step` (optional), `page` (optional), `map_id` (optional), `floor_id` (optional), `scale_session` (optional), `rooms_session` (optional) | always | `ai_wizard.py` | One thing the person did with the helper: shown and opened (by where), a step reached (where it reopens), Not now, Don't ask again, came ba… |
| `padspan_ha/area_add` | `name`, `floor_id` (optional) | always | `ai_wizard.py` | Creates a Home Assistant area of this name, on this floor, for a room drawn in Mapping → Edit. |
| `padspan_ha/area_delete` | `area_id` | always | `ws_follow.py` | Delete an HA area and clean up PadSpan room_meta. |
| `padspan_ha/auto_diagnostics` | – | – | `ws_diagnostics.py` | Run quick health checks and return pass/fail with recommendations. |
| `padspan_ha/bright_import` | – | always | `ws_bright_import.py` | Back up, refuse a non-empty target, copy the house, reload. |
| `padspan_ha/bright_import_status` | – | – | `ws_bright_import.py` | Whether a PadSpan Bright house is on this Home Assistant, whether it was imported, and whether it can be. |
| `padspan_ha/c4local_check` | – | always | `c4local_install.py` | Check for an update: the newest release's version (pressed by an administrator). |
| `padspan_ha/c4local_install` | – | always | `c4local_install.py` | Install or update (pressed by an administrator). |
| `padspan_ha/c4local_status` | – | always | `c4local_install.py` | Settings' OS 2 Local for Control4 card and the Overview's offer: what is there now (reads only). |
| `padspan_ha/c4local_undo` | – | always | `c4local_install.py` | Undo (pressed by an administrator): never locked behind the licence. |
| `padspan_ha/calibration_beacon_profiles` | – | – | `ws_calibration.py` | Compute per-beacon signal profiles grouped by model. |
| `padspan_ha/calibration_clear` | – | always | `ws_calibration.py` | Delete all calibration points and reset the model. |
| `padspan_ha/calibration_clear_map` | `map_id` | always | `ws_calibration.py` | Delete all calibration points collected on a specific map. |
| `padspan_ha/calibration_compute_model` | – | with Enhanced security | `ws_calibration.py` | Trigger full calibration model recomputation. |
| `padspan_ha/calibration_delete_point` | `point_id` | with Enhanced security | `ws_calibration.py` | Delete a single calibration point by ID. |
| `padspan_ha/calibration_get` | – | – | `ws_calibration.py` | Return all calibration points and the cached model stats. |
| `padspan_ha/calibration_health_check` | – | – | `ws_calibration.py` | Analyse calibration data quality for the Health Reminder notification. |
| `padspan_ha/calibration_relearn_radio` | `source`, `gain_db` | with Enhanced security | `ws_calibration.py` | Shift stored RSSI readings for a scanner after an antenna upgrade/downgrade. |
| `padspan_ha/calibration_retrain_rf` | – | with Enhanced security | `ws_calibration.py` | Force retrain the Random Forest model (picks up metre-space data). |
| `padspan_ha/calibration_room_walk_preview` | `room`, `polls` | – | `ws_calibration.py` | Walk a room: the summary shown before Save (room_walk.py). |
| `padspan_ha/calibration_room_walk_remove` | `room` | with Enhanced security | `ws_calibration.py` | Remove one room's walk (its room_walk points only). |
| `padspan_ha/calibration_room_walk_save` | `room`, `map_id` (optional), `device_id` (optional), `duration_s` (optional), `polls`, `replace` (optional) | with Enhanced security | `ws_calibration.py` | Save a walk the user confirmed, as room_walk points at the room's centre. |
| `padspan_ha/calibration_save_point` | `point` | with Enhanced security | `ws_calibration.py` | Save one calibration point (position + per-scanner RSSI readings). |
| `padspan_ha/calibration_swap_radio` | `old_source`, `new_source` | with Enhanced security | `ws_calibration.py` | Replace every occurrence of old_source with new_source in calibration data. |
| `padspan_ha/capture_delete` | `session_id` | always | `ws_capture.py` | Remove one recorded session file by id. |
| `padspan_ha/capture_get` | `session_id`, `offset` (optional), `limit` (optional) | always | `ws_capture.py` | One page of a session file — the export transport. |
| `padspan_ha/capture_list` | – | always | `ws_capture.py` | Recorded sessions, newest first. |
| `padspan_ha/capture_mark` | `room`, `keys` (optional), `x_m` (optional), `y_m` (optional) | always | `ws_capture.py` | Stamp ground truth: the operator asserting where a device really is. |
| `padspan_ha/capture_replay` | `session_id`, `settings` (optional) | always | `ws_capture.py` | Replays a finished recording through the room smoothing and scores the rooms it gives. |
| `padspan_ha/capture_start` | `minutes` (optional), `label` (optional), `keys` (optional), `ground_truth` (optional), `include_calibration` (optional) | always | `ws_capture.py` | Open a recording session against the live coordinator state. |
| `padspan_ha/capture_status` | – | always | `ws_capture.py` | Live session state; polled by the Health tab while recording. |
| `padspan_ha/capture_stop` | – | always | `ws_capture.py` | Close the running session. |
| `padspan_ha/companion_discover` | – | – | `ws_companion.py` | Discover HA Companion App phones that have BLE Transmitter enabled. |
| `padspan_ha/companion_follow` | `ibeacon_key`, `device_name`, `entity_id` (optional) | with Enhanced security | `ws_companion.py` | One-click "Follow This Phone" action for Companion App phones. |
| `padspan_ha/companion_unfollow` | `ibeacon_key`, `device_name` (optional) | with Enhanced security | `ws_companion.py` | Remove a Companion App phone from followed list and delete its label. |
| `padspan_ha/device_how_known` | `object` | – | `ws_objects.py` | The device window's "How we know": left off the snapshot, which goes to every screen every 5 s, and worked out from the fields the window a… |
| `padspan_ha/device_registry_add_identity` | `padspan_id`, `kind`, `value` | with Enhanced security | `ws_devices.py` | Link an additional volatile key to an existing device. |
| `padspan_ha/device_registry_delete` | `padspan_id` | with Enhanced security | `ws_devices.py` | Delete a device from the Device Registry. |
| `padspan_ha/device_registry_label_set` | `padspan_id`, `label` | with Enhanced security | `ws_devices.py` | Set label on a device by padspan_id. |
| `padspan_ha/device_registry_list` | – | – | `ws_devices.py` | Return all devices in the Device Registry. |
| `padspan_ha/device_registry_merge` | `keep_id`, `absorb_id` | with Enhanced security | `ws_devices.py` | Merge two devices in the Device Registry. |
| `padspan_ha/device_registry_migrate` | – | with Enhanced security | `ws_devices.py` | Trigger migration from ObjectStore to DeviceRegistry. |
| `padspan_ha/emergency_force_off` | – | – | `emergency_test.py` | Turns every emergency light off. |
| `padspan_ha/emergency_member` | `entity_id`, `on` (optional) | – | `emergency_test.py` | Switches one emergency light by hand, from the test button's card. |
| `padspan_ha/emergency_status` | – | – | `emergency_test.py` | The emergency lighting test: whether it is on, and its lights. |
| `padspan_ha/emergency_test` | `on` | – | `emergency_test.py` | Starts (`on`) or ends the Atlas's emergency lighting test. |
| `padspan_ha/entity_delete` | `entity_id` | always | `ws_follow.py` | Remove an entity from the HA entity registry. |
| `padspan_ha/espresense_companion_import` | – | always | `ws_devices.py` | Import floors, rooms, and scanner positions from ESPresense Companion. |
| `padspan_ha/fabric_beacon_height_set` | `key` (optional), `z_m` (optional), `heights` (optional) | with Enhanced security | `ws_fabric.py` | fabric_light_height_set for a fixed beacon (by its key), on the same gate as pinning one: only its height; x, y and room stay. |
| `padspan_ha/fabric_beacon_position_set` | `key`, `x_m`, `y_m`, `floor_id` (optional), `room` (optional), `kind` (optional), `label` (optional), `z_m` (optional) | with Enhanced security | `ws_fabric.py` | Pin a beacon in real-world metres. |
| `padspan_ha/fabric_beacon_remove` | `key` | with Enhanced security | `ws_fabric.py` | Un-pin a beacon from the positioning fabric. |
| `padspan_ha/fabric_correct_room` | `floor_id`, `room`, `geometry`, `source_map_id` (optional) | with Enhanced security | `ws_fabric.py` | Directly correct one room's real-world shape in the FabricStore. |
| `padspan_ha/fabric_floor_elevations_set` | `floors` | with Enhanced security | `ws_fabric.py` | Upsert per-floor elevation data (floor-to-floor height / base elevation). |
| `padspan_ha/fabric_floor_finalize` | `floor_id`, `committed` | always | `ws_fabric.py` | Finalize (lock) or unlock a floor's fabric. |
| `padspan_ha/fabric_health` | – | – | `ws_fabric.py` | Runs the checks on the house layout (floors, rooms, receivers, calibration). |
| `padspan_ha/fabric_light_height_set` | `entity_id` (optional), `z_m` (optional), `heights` (optional) | with Enhanced security | `ws_fabric.py` | Set only the height of a placed device (any placement record: a light, a fan, a sensor, a lock), x/y untouched: {entity_id, z_m} or {height… |
| `padspan_ha/fabric_light_position_set` | `entity_id`, `x_m`, `y_m`, `floor_id` (optional), `color` (optional), `shape` (optional), `rotation` (optional), `width_cm` (optional), `height_cm` (optional), `margin_cm` (optional), `label` (optional), `z_m` (optional) | with Enhanced security | `ws_fabric.py` | Place a light in real-world metres. |
| `padspan_ha/fabric_light_remove` | `entity_id` | with Enhanced security | `ws_fabric.py` | Un-place a light (it returns to automatic room clustering). |
| `padspan_ha/fabric_map_reanchor` | `map_id`, `origin_x_m` (optional), `origin_y_m` (optional), `rotation_rad` (optional), `scale_x_m` (optional), `scale_y_m` (optional), `shear_rad` (optional) | always | `ws_fabric.py` | Explicitly redefine a map's placement. |
| `padspan_ha/fabric_map_transform_set` | `map_id`, `transform` | always | `ws_fabric.py` | Set the affine transform for a map (frac ↔ metres). |
| `padspan_ha/fabric_open_edges_apply` | `action`, `set_barriers` (optional), `remove_barrier_ids` (optional) | with Enhanced security | `ws_fabric.py` | The Open edges tool's one write (Mapping → Edit → Signal walls): the open edges, what is left of a wall one replaces and the walls it remov… |
| `padspan_ha/fabric_reset_spatial` | – | always | `ws_fabric.py` | Clears receiver and beacon positions and walls, after an automatic backup; rooms are kept. |
| `padspan_ha/fabric_resync` | – | with Enhanced security | `ws_fabric.py` | Wipe all ha_sync scanner entries and rebuild clean from HA + snapshot. |
| `padspan_ha/fabric_rf_barrier_rails_stamp` | `rails` | with Enhanced security | `ws_fabric.py` | Gives older open wall edges the railing they were drawn with. |
| `padspan_ha/fabric_rf_barrier_remove` | `barrier_id` | with Enhanced security | `ws_fabric.py` | Remove an RF barrier by id. |
| `padspan_ha/fabric_rf_barrier_set` | `barrier` | with Enhanced security | `ws_fabric.py` | Add or update an RF barrier in real-world metres, by id. |
| `padspan_ha/fabric_room_add` | `room`, `floor_id` (optional) | with Enhanced security | `ws_fabric.py` | Add a PadSpan-native room (no HA area needed). |
| `padspan_ha/fabric_room_remove` | `room` | with Enhanced security | `ws_fabric.py` | Remove a room from the fabric: geometry, metadata, adjacency, scanners. |
| `padspan_ha/fabric_rooms_merge` | `floor_id`, `keep`, `rooms` | with Enhanced security | `ws_fabric.py` | Merges rooms into one: the kept room's outline goes round the others, which are then deleted. |
| `padspan_ha/fabric_rooms_reconcile` | `floor_id` | with Enhanced security | `ws_fabric.py` | Re-derive this floor's provenance-clean rooms from their maps' current placements. |
| `padspan_ha/fabric_scanner_position_set` | `source`, `x_m`, `y_m`, `z_m` (optional), `floor_id` (optional) | with Enhanced security | `ws_fabric.py` | Set a scanner's real-world position in metres. |
| `padspan_ha/fabric_scanner_remove` | `source` | with Enhanced security | `ws_fabric.py` | Remove a scanner from the positioning fabric. |
| `padspan_ha/fabric_scanner_z_set` | `source`, `z_m` | with Enhanced security | `ws_fabric.py` | Set only a scanner's mounting height (z stays through map syncs). |
| `padspan_ha/fabric_sync_mode_set` | `mode` | with Enhanced security | `ws_fabric.py` | Switch fabric sync mode: 'auto' (sync from HA) or 'manual' (standalone). |
| `padspan_ha/fabric_truth_candidates` | `floor_id` | – | `ws_fabric.py` | Read-only preview of every form of truth a floor's layout can come from, so the user can compare and pick the most accurate one BEFORE anyt… |
| `padspan_ha/factory_reset` | `confirm` | always | `ws_factory_reset.py` | Erase every PadSpan HA persistent store and reset to factory defaults. |
| `padspan_ha/findmy_unlink` | `key`, `address` (optional) | with Enhanced security | `ws_objects.py` | "Not this tag": undo a Find My tag's last address link (findmy.py FindMyBridge.unlink). |
| `padspan_ha/flood_reset` | `entity_id` | – | `websocket.py` | Resets one leak, smoke, gas or CO alarm (the banner's Reset). |
| `padspan_ha/floorplan_import_roomplan` | `roomplan_base64` | always | `ws_floorplan_import.py` | Parse an Apple RoomPlan JSON export into levels + room polygons. |
| `padspan_ha/floorplan_import_sh3d` | `sh3d_base64` | always | `ws_floorplan_import.py` | Parse a Sweet Home 3D (.sh3d) file into levels + room polygons. |
| `padspan_ha/follow_alert_delete` | `addr` | with Enhanced security | `ws_follow.py` | Delete a follow-alert configuration for a tracked object. |
| `padspan_ha/follow_alert_get` | – | – | `ws_follow.py` | Return all saved follow-alert configurations (persisted in AlertStore). |
| `padspan_ha/follow_alert_save` | `addr` (optional), `config` (optional) | with Enhanced security | `ws_follow.py` | Save follow/alert configuration for a tracked object. |
| `padspan_ha/forensics_clear` | – | always | `ws_forensics.py` | Delete all recorded forensics sessions (irreversible). |
| `padspan_ha/forensics_license_activate` | `key` | always | `ws_forensics.py` | Validate a PadSpan Pro licence key against traks.ca and, if valid, store it and enable forensics. |
| `padspan_ha/forensics_license_reveal` | – | always | `ws_forensics.py` | Return the licence key itself — admin only, on explicit request. |
| `padspan_ha/forensics_query` | `from_ts`, `to_ts` | always | `ws_forensics.py` | Return devices present (recorded) or possibly present (first/last-seen overlap) during [from_ts, to_ts] (epoch seconds). |
| `padspan_ha/forensics_stats` | – | – | `ws_forensics.py` | Return recorder stats for the Settings UI. |
| `padspan_ha/guest_session_end` | `session` | always | `ws_guests.py` | The tag is back: the stay ends, its report is kept. |
| `padspan_ha/guest_session_forget` | `session` | always | `ws_guests.py` | Delete a finished stay now, name and report. |
| `padspan_ha/guest_session_start` | `pid`, `name`, `end_at` (optional) | always | `ws_guests.py` | Lend a guest tag: who, until when, and how the stay is watched. |
| `padspan_ha/guest_session_update` | `session`, `name` (optional), `end_at` (optional) | always | `ws_guests.py` | Changes a guest stay: its name, its end, its options. |
| `padspan_ha/guest_tag_mark` | `key` | always | `ws_guests.py` | Make a labelled device a guest tag. |
| `padspan_ha/guest_tag_unmark` | `pid` | always | `ws_guests.py` |  |
| `padspan_ha/guests_get` | – | with Enhanced security | `ws_guests.py` | The guest tags, the stays (running and kept), and the labelled devices that could become a guest tag. |
| `padspan_ha/ha_entities_audit` | – | – | `ws_diagnostics.py` | Return every PadSpan entity with live state, health, and automation usage. |
| `padspan_ha/house3d_clear` | `only` (optional) | always | `ws_house3d.py` |  |
| `padspan_ha/house3d_edit` | `openings` (optional), `lights` (optional), `devices` (optional), `pieces` (optional), `figures` (optional), `rooms` (optional), `floors` (optional), `heights_set` (optional), `rails_chosen` (optional) | with Enhanced security | `ws_house3d.py` | Save the 3D editor's draft: {openings, lights, devices, pieces, figures, rooms, floors}, each {key: entry to set \| None to remove}, and hei… |
| `padspan_ha/house3d_from_photo` | `target`, `photo` (optional), `kind` (optional) | with Enhanced security | `ws_house3d_photo.py` | Read one photo with the chosen AI Task (or, with no photo, say which AI Task would). |
| `padspan_ha/house3d_get` | – | – | `ws_house3d.py` |  |
| `padspan_ha/house3d_import_preview` | `sh3d_base64`, `format` (optional) | – | `ws_house3d_import.py` | A .sh3d's doors, windows and furniture (or a RoomPlan scan's doors, windows, openings, furniture and stairs) as candidates. |
| `padspan_ha/house3d_library_get` | `library_id`, `placed` (optional) | – | `ws_house3d_library.py` | One piece; with placed, the library counts the placing (anonymous +1). |
| `padspan_ha/house3d_library_report` | `library_id`, `reason` | with Enhanced security | `ws_house3d_library.py` |  |
| `padspan_ha/house3d_library_search` | `text` (optional), `filters` (optional), `sort` (optional), `offset` (optional), `limit` (optional) | – | `ws_house3d_library.py` |  |
| `padspan_ha/house3d_library_share` | `recipe`, `submission_id` (optional) | with Enhanced security | `ws_house3d_library.py` | Share a piece's recipe and details sheet (nothing else of the piece), or send new details for one this house shared. |
| `padspan_ha/house3d_library_withdraw` | – | always | `ws_house3d_library.py` | Take every piece this house shared out of the library: {withdrawn, left}. |
| `padspan_ha/house3d_stairs_plans` | – | with Enhanced security | `ws_house3d_stairs.py` | The placed floor plans there are to read: [{map_id, name, floor_id}], and whether the AI Task runs on this home's own computer (local: True… |
| `padspan_ha/house3d_stairs_read` | `map_id` | with Enhanced security | `ws_house3d_stairs.py` | One floor plan's stairs, read by the chosen AI Task. |
| `padspan_ha/house3d_terms_accept` | `version` | with Enhanced security | `ws_house3d_library.py` | Accept the library's terms (the version the screen showed). |
| `padspan_ha/insights_get` | `days` (optional) | – | `websocket.py` | Aggregate TracebackStore frames into time-in-room / entries / occupancy. |
| `padspan_ha/install_base` | `fresh` (optional) | always | `ws_telemetry.py` | The install-base dashboard: what every opted-in report adds up to, plus the update-check ping count for the installs that did not opt in. |
| `padspan_ha/integration_reload` | – | always | `websocket.py` | Reload the PadSpan HA config entry. |
| `padspan_ha/irk_add` | `name`, `irk_hex`, `force` (optional), `via` (optional) | always | `ws_irk.py` | Add an IRK directly via PadSpan settings (no private_ble_device integration needed). |
| `padspan_ha/irk_auto_detect` | – | always | `ws_irk.py` | Scan system Bluetooth bonds and live BLE cache to find IRKs automatically. |
| `padspan_ha/irk_remove` | `irk_hex` | always | `ws_irk.py` | Remove a PadSpan-managed IRK and reload the resolver. |
| `padspan_ha/irk_validate` | `irk_hex` | always | `ws_irk.py` | Test an IRK against all currently-visible BLE RPAs. |
| `padspan_ha/label_link_answer` | `key`, `address`, `same` | with Enhanced security | `ws_objects.py` | "This looks like <label>: same device?" answered (label_follow.py). |
| `padspan_ha/label_link_hint_off` | `key` | with Enhanced security | `ws_objects.py` | The pointer to a device's IRK, dismissed for good. |
| `padspan_ha/label_link_undo` | `key` | with Enhanced security | `ws_objects.py` | One click removes a link: the name goes back to the device's first address. |
| `padspan_ha/licence_homes` | `op` (optional), `home_id` (optional), `label` (optional) | always | `ws_forensics.py` | The licence key's homes, from the licence server: list them, remove one (it frees its place), or name this one. |
| `padspan_ha/lights_follow_get` | – | – | `lights_follow.py` | Lights follow people: the switch, each room's lights and options and who is in it now, and the people. |
| `padspan_ha/live_snapshot` | `slim` (optional) | – | `snapshot_builder.py` | Return the full live snapshot to the panel, enriched with presence + calibration data. |
| `padspan_ha/logs_get` | `level` (optional), `limit` (optional) | with Enhanced security | `websocket.py` | Return recent PadSpan log entries from the in-memory ring buffer. |
| `padspan_ha/lost_and_found_forget` | `key` | with Enhanced security | `websocket.py` | Explicitly clear one object's lost-and-found record. |
| `padspan_ha/lost_and_found_get` | – | – | `websocket.py` | Return every object's last-confirmed room + when — persisted, never reset to Unknown (see lost_and_found_store.py's own header). |
| `padspan_ha/maps_blank_create` | `floor_id`, `across`, `down`, `name` (optional) | always | `ws_maps.py` | {ok, map} or {ok: false, message}: nothing is written unless both lengths read. |
| `padspan_ha/maps_delete` | `map_id` | always | `ws_maps.py` | Delete a map and scrub every OTHER store's reference to it. |
| `padspan_ha/maps_delete_migrate` | `map_id`, `target_map_id`, `extend_canvas` (optional) | always | `ws_maps.py` | Delete a map after migrating its data (receivers, beacons, room_bounds, calibration) to a target map on the same z-level. |
| `padspan_ha/maps_fit_suggest` | `map_id`, `ref_map_id` | always | `ws_maps.py` | Where this plan would sit over the Reference plan's floor, from the rooms traced on it (roomplan_import. |
| `padspan_ha/maps_image_urls` | – | – | `ws_maps.py` | Fresh signed image links only — the panel's keep-alive for them. |
| `padspan_ha/maps_list` | – | – | `ws_maps.py` | Return all maps. |
| `padspan_ha/maps_replace_image` | `map_id`, `width`, `height`, `png_base64`, `crop` (optional), `pixel_op` (optional) | always | `ws_maps.py` | Replace the stored PNG for an existing map and renormalize coordinates. |
| `padspan_ha/maps_revert_extend` | `map_id` | always | `ws_maps.py` | Revert a canvas extension on a map (undo the image padding + coord shift). |
| `padspan_ha/maps_scale_measure` | `map_id`, `measures` (optional), `save` (optional), `not_to_scale` (optional) | always | `ws_maps.py` | What the lengths make of the plan (writes nothing), or with `save` the plan's scale from them. |
| `padspan_ha/maps_scale_nudge_end` | `map_id` | always | `ws_maps.py` | "Later" on "Set this plan's scale now": it ends for this plan, for good. |
| `padspan_ha/maps_scan_create` | `floor_id`, `file_base64`, `name` (optional), `across` (optional), `level` (optional) | always | `ws_maps.py` | {ok, map, rooms, heights_m, warnings, file, skipped, scale} or {ok: false, code, message[, levels]}: nothing is written unless the file rea… |
| `padspan_ha/maps_starter_house` | `dry_run` (optional), `floor_id` (optional), `no_floor_to` (optional), `label` (optional) | always | `ws_maps.py` | {ok, floors, skipped, no_floor, choices} (and, made: maps, rooms); {ok: false, code: "nothing"} when there is nothing to make. |
| `padspan_ha/maps_update` | `map_id`, `receivers` (optional), `calibration` (optional), `notes` (optional), `floor_id` (optional), `room_bounds` (optional), `stack` (optional), `beacons` (optional), `lights` (optional) | with Enhanced security | `ws_maps.py` | Update map metadata: receivers, beacons, room_bounds, calibration, stack, notes. |
| `padspan_ha/maps_upload` | `name`, `filename`, `mime`, `width`, `height`, `png_base64`, `floor_id` (optional), `allow_no_image` (optional), `scale_nudge` (optional), `kind` (optional) | always | `ws_maps.py` | Upload a new floor plan image and create a map entry. |
| `padspan_ha/model_get` | – | – | `websocket.py` | Return floors from HA floor registry, areas from HA area registry, and per-room metadata. |
| `padspan_ha/model_update` | `floors` (optional), `room_meta` (optional) | with Enhanced security | `websocket.py` | Update room_meta (color, floor assignment). |
| `padspan_ha/motion_reconnects` | – | – | `motion_reconnects.py` | Subscription: {entity_id: {"at", "last_changed"}} now, then on every change. |
| `padspan_ha/movement_history_get` | `device` (optional), `limit` (optional) | – | `websocket.py` | Return recent movement history entries. |
| `padspan_ha/notify_services_list` | – | – | `ws_notify.py` | Discover all available HA notification services/entities. |
| `padspan_ha/notify_test` | `email` (optional), `service` (optional) | – | `ws_notify.py` | Send a test notification exactly as a Follow alert is sent (presence_coordinator.async_send_follow_notify): to the chosen target only, auto… |
| `padspan_ha/object_evict` | `key` | always | `ws_calibration.py` | Evict a single object from the coordinator's smoothed state cache. |
| `padspan_ha/object_label_delete` | `address` | with Enhanced security | `ws_objects.py` | Remove the user label for a BLE MAC address. |
| `padspan_ha/object_label_list` | – | – | `ws_objects.py` | Return all stored object labels from ObjectStore + DeviceRegistry. |
| `padspan_ha/object_label_set` | `address`, `label` | with Enhanced security | `ws_objects.py` | Assign a user label to a BLE object (MAC, ibeacon key, or canonical_id). |
| `padspan_ha/objects_clear_history` | – | with Enhanced security | `ws_objects.py` | Purge untagged/unfollowed objects from the 7-day history cache. |
| `padspan_ha/occupancy_estimate` | – | – | `ws_occupancy.py` | WS wrapper for occupancy estimation. |
| `padspan_ha/occupancy_train` | `actual_count`, `room` (optional) | with Enhanced security | `ws_occupancy.py` | Record an actual headcount beside what the estimator said at the time. |
| `padspan_ha/plan_ai_cancel` | `session` | always | `ws_plan_ai.py` |  |
| `padspan_ha/plan_ai_commit` | `session`, `rev`, `items` | always | `ws_plan_ai.py` | Keep suggestions: items [{sug_id, v: new\|correction, final (the draft's piece), rail: {side, style} (a railing), target (a stair it was nam… |
| `padspan_ha/plan_ai_plans` | – | always | `ws_plan_ai.py` |  |
| `padspan_ha/plan_ai_reject_forget` | `key` | always | `ws_plan_ai.py` | Un-ignore: the reject goes (a failure taken back, counted apart), and a suggestion it had marked wrong, in any kept session, is queued agai… |
| `padspan_ha/plan_ai_rejects_get` | – | always | `ws_plan_ai.py` |  |
| `padspan_ha/plan_ai_sessions_get` | – | always | `ws_plan_ai.py` |  |
| `padspan_ha/plan_ai_start` | `map_ids`, `kinds` (optional), `fixtures` (optional) | always | `ws_plan_ai.py` | Start one session over the ticked plans, read by the AI Task, or by the backup when it is away, as ask_ai always does. |
| `padspan_ha/plan_ai_status` | `session` (optional) | always | `ws_plan_ai.py` | The session, after the checks: on one that is not running, a changed plan or a changed target marks its suggestions stale. |
| `padspan_ha/plan_ai_undo` | `batch_id` | always | `ws_plan_ai.py` |  |
| `padspan_ha/plan_ai_verdict` | `session`, `rev`, `sug_id`, `v`, `why` (optional) | always | `ws_plan_ai.py` | Right (it looks right: stored and counted, nothing else), failure (one reason; a reject is remembered with it, and a stair's railing hint l… |
| `padspan_ha/plan_build_answer` | `session`, `question_id`, `answer` | always | `ws_plan_ai.py` | The little help (design 3.5): the answer reruns the local steps only, no new read, and only for the plan it is about. |
| `padspan_ha/plan_build_cancel` | `session`, `via` (optional) | always | `ws_plan_ai.py` |  |
| `padspan_ha/plan_build_commit` | `session`, `rev`, `items`, `group` (optional) | always | `ws_plan_ai.py` | Save accepted items (design 3.8): one at a time, or `group` for items that shift nothing drawn on their plans (form q8). |
| `padspan_ha/plan_build_info` | `via` (optional) | always | `ws_plan_ai.py` | Whether the line-up can be offered here (design 1): the unlock, the switch and the effective rule, the floors with their plans, this house'… |
| `padspan_ha/plan_build_refile` | `session`, `rev`, `map_id`, `to_floor_id` | always | `ws_plan_ai.py` | "This plan isn't Basement?" (design 2, by hand): the same refile item a suggestion makes, under the same rules, accepted and saved like any… |
| `padspan_ha/plan_build_resume` | `session` | always | `ws_plan_ai.py` | A session that stopped short reads the rest (design 8, 14). |
| `padspan_ha/plan_build_rooms_check` | `session`, `items` | always | `ws_plan_ai.py` | The rooms gate for these ticks, before Save (design 5): the room score on this floor's calibration spots, now and with them. |
| `padspan_ha/plan_build_rooms_commit` | `session`, `rev`, `items`, `finals` (optional), `via` (optional), `ha_areas` (optional) | always | `ws_plan_ai.py` | Accept all for this floor: the ticked items in ONE save (design 5). |
| `padspan_ha/plan_build_rooms_edit` | `session`, `rev`, `op`, `parts` (optional), `merge` (optional), `space` (optional), `name` (optional), `room` (optional), `read` (optional), `ticked` (optional), `ha` (optional), `draft` (optional), `via` (optional) | always | `ws_plan_ai.py` | The person's edit of the proposal (design 5): merge rooms and spaces into one, separate a merge, name a space as a new room (or leave it ou… |
| `padspan_ha/plan_build_rooms_read_again` | `session`, `rev`, `room`, `via` (optional) | always | `ws_plan_ai.py` | Reads the plans once more for a room the reads disagreed on; two reads out of three decide it. |
| `padspan_ha/plan_build_rooms_resume` | `session`, `via` (optional) | always | `ws_plan_ai.py` | A rooms session that stopped short reads the rest. |
| `padspan_ha/plan_build_rooms_start` | `floor_id`, `map_ids` (optional), `via` (optional) | always | `ws_plan_ai.py` | One floor's rooms read (design 5): only its lined-up plans, two reads each. |
| `padspan_ha/plan_build_rooms_status` | `session` (optional), `via` (optional), `reproject` (optional), `map_id` (optional) | always | `ws_plan_ai.py` | A rooms session (by id, or the newest) with its proposal, and the names a new room may take. |
| `padspan_ha/plan_build_rooms_undo` | `session`, `via` (optional) | always | `ws_plan_ai.py` | Undo a rooms session; allowed under the master switch whatever the AI Task (form q3), and always for the helper's. |
| `padspan_ha/plan_build_scale_preview` | `map_id`, `measures` (optional), `replace` (optional), `source` (optional), `via` (optional) | always | `ws_plan_ai.py` | What the measurement screen says while the person types (the length understood, the plan's size): worked out here, as the save will. |
| `padspan_ha/plan_build_scale_save` | `map_id`, `sig`, `floor_id` (optional), `measures`, `source` (optional), `session` (optional), `replace` (optional), `via` (optional) | always | `ws_plan_ai.py` | The plan's first scale from the person's measurement (design E.3). |
| `padspan_ha/plan_build_scale_start` | `map_id`, `again` (optional), `held_only` (optional), `recheck` (optional), `via` (optional) | always | `ws_plan_ai.py` | Claude reads a printed dimension off a plan with no scale (piece 4; design E.1): Read A, then one dimension an axis. |
| `padspan_ha/plan_build_scale_status` | `session` (optional), `via` (optional) | always | `ws_plan_ai.py` | A scale read (by id, or the newest): where it is and what it found. |
| `padspan_ha/plan_build_scale_undo` | `map_id` (optional), `via` (optional) | always | `ws_plan_ai.py` | Takes back the helper's scale, while nothing measured in metres has been added since. |
| `padspan_ha/plan_build_start` | `floor_id`, `map_ids` (optional) | always | `ws_plan_ai.py` | One floor's line-up (design 3.1's preconditions; one AI job per house, one a minute, ten a day). |
| `padspan_ha/plan_build_status` | `session` (optional) | always | `ws_plan_ai.py` | A line-up (by id, or the newest), its plans' and items' signatures checked: an item whose plan moved or changed since is stale. |
| `padspan_ha/plan_build_undo` | `session` | always | `ws_plan_ai.py` | Undo a whole line-up session (design 3.8). |
| `padspan_ha/plan_build_verdict` | `session`, `rev`, `item_id`, `v`, `why` (optional) | always | `ws_plan_ai.py` | Not now, Wrong (one reason) or back: written at the click; they describe the AI, not the house (design 4). |
| `padspan_ha/plan_carry_apply` | `map_id`, `kinds` | always | `plan_carry.py` |  |
| `padspan_ha/plan_carry_dismiss` | `map_id` | always | `plan_carry.py` | They are right where they are: the plan is no longer listed, and nothing is moved. |
| `padspan_ha/plan_carry_list` | – | always | `plan_carry.py` |  |
| `padspan_ha/positioning_diag` | – | – | `ws_diagnostics.py` | Return detailed positioning diagnostics for all labelled devices. |
| `padspan_ha/power_team_sleep` | `entity_id`, `minutes` (optional), `end` (optional) | – | `power_team.py` | The card's "Sleep in 30 min": the team fades to Sleep over the minutes, then goes off (or stays). |
| `padspan_ha/power_teams_get` | – | – | `power_team.py` | The power teams. |
| `padspan_ha/power_teams_set` | `teams` | always | `power_team.py` | Saves the power teams. |
| `padspan_ha/private_ble_add_irk` | `irk`, `name` (optional) | always | `ws_irk.py` | Add a Private BLE Device IRK via PadSpan UI (creates HA config entry). |
| `padspan_ha/private_ble_delete_irk` | `entry_id` | always | `ws_irk.py` | Delete a Private BLE Device config entry by entry_id. |
| `padspan_ha/private_ble_status` | – | – | `ws_irk.py` | Return Private BLE Device resolver status for the UI setup wizard. |
| `padspan_ha/pro_invite_claim` | `email` | always | `pro_invite.py` | Claim the open invite: a one-year PadSpan Pro key for this email, stored in the same fields a bought key uses (one gate, licence.py). |
| `padspan_ha/pro_invite_decline` | – | always | `pro_invite.py` | No thanks: final. |
| `padspan_ha/propagation_health` | – | – | `ws_diagnostics.py` | Compute comprehensive propagation model health analysis. |
| `padspan_ha/quiet_errors` | – | always | `ws_diagnostics.py` | Errors PadSpan handled quietly since Home Assistant started (quiet_errors.py): each site that fired, its count, and its last error with the… |
| `padspan_ha/radio_area_set` | `device_id` (optional), `source` (optional), `area_name` (optional) | – | `ws_radios.py` | Assign a BLE scanner to an HA area. |
| `padspan_ha/radio_audit` | – | – | `ws_radios.py` | Cross-reference BLE radios with ESPHome devices and fabric scanners. |
| `padspan_ha/radio_disabled_set` | `source`, `disabled` | with Enhanced security | `ws_radios.py` | Mark or unmark a BLE radio as 'disabled' (intentionally excluded from location math). |
| `padspan_ha/radio_lost_set` | `source`, `lost` | with Enhanced security | `ws_radios.py` | Mark or unmark a BLE radio as 'lost' (excluded from location math). |
| `padspan_ha/radio_reset` | `source` | always | `ws_radios.py` | Clears everything PadSpan holds about one receiver, for a receiver replaced or moved. |
| `padspan_ha/receivers_to_rooms` | `undo` (optional), `dry_run` (optional) | always | `ws_fabric.py` | Every live receiver with a room that has an outline, and no position yet, put inside its room: one backup of the fabric, then one write thr… |
| `padspan_ha/robot_wifi_readings` | – | always | `ws_vacuum.py` | The robot's Wi-Fi at each room location run spot and while it cleans, for other integrations (version 1). |
| `padspan_ha/room_height_set` | `room`, `height_m` (optional), `floor_raise_m` (optional), `surface` (optional), `space` (optional) | with Enhanced security | `websocket.py` | Set one room's own height (room_meta[room].height_m) for Live Aboard: a double-height living room, a hall under a mezzanine, on a floor tha… |
| `padspan_ha/room_tag_purge_missing` | – | with Enhanced security | `ws_follow.py` | Remove entity_ids from room_tag_map that have no current HA state (phantom/sample entities). |
| `padspan_ha/room_tags` | – | – | `ws_follow.py` | Return the room→object map used by the UI. |
| `padspan_ha/rooms_overlap` | `rooms` | – | `setup_checks.py` | Which rooms are drawn over each other, for Mapping's Edit and Layout. |
| `padspan_ha/scanner_offset_set` | `source`, `offset_db` (optional) | with Enhanced security | `ws_radios.py` | Set (or clear) the RSSI calibration offset for a single Bluetooth scanner. |
| `padspan_ha/screens_command` | `cmd`, `screens` (optional), `name` (optional), `message` (optional) | always | `screens.py` | Settings' buttons: reload, rename one screen, or a test announcement. |
| `padspan_ha/screens_join` | `screen_id`, `name` (optional), `page` (optional), `view` (optional), `kiosk` (optional), `build` (optional), `device` (optional) | – | `screens.py` | Subscription: the page is listed until its socket closes; pushes are {"cmd": "reload" \| "announce" \| "rename", ...}. |
| `padspan_ha/screens_list` | – | always | `screens.py` |  |
| `padspan_ha/screens_update` | `screen_id`, `view` (optional), `name` (optional) | – | `screens.py` | A screen telling what it shows now, or its new name. |
| `padspan_ha/settings_get` | – | – | `ws_settings.py` | PadSpan's settings, as the panel reads them. |
| `padspan_ha/settings_set` | `data_mode` (optional), `cpu_mode` (optional), `update_check_enabled` (optional), `telemetry_enabled` (optional), `telemetry_asked` (optional), `telemetry_heard` (optional), `telemetry_heard_ask` (optional), `trial_nudge_done` (optional), `tester_nudge_done` (optional), `launch_card_done` (optional), `lifetime_card_done` (optional), `addon_sale_card_done` (optional), `house3d_free_card_done` (optional), `c4local_offer_done` (optional), `tips_enabled` (optional), `tips_state` (optional), `whatsnew_seen_version` (optional), `room_change_delay_s` (optional), `away_timeout_m` (optional), `thing_away_timeout_h` (optional), `ref_power` (optional), `path_loss_exp` (optional), `kalman_q` (optional), `kalman_r` (optional), `hold_last_room_s` (optional), `room_reason_attribute` (optional), `positioning_pick_better` (optional), `positioning_unsure` (optional), `positioning_sensor_fusion` (optional), `calibration_room_walk` (optional), `assumed_device_height_m` (optional), `fabric_origin_lat` (optional), `fabric_origin_lon` (optional), `fabric_bearing_deg` (optional), `hidden_map_ids` (optional), `locate_self_key` (optional), `followed_addrs` (optional), `health_reminder_enabled` (optional), `health_reminder_last_ts` (optional), `maps_iso_floor_gap` (optional), `maps_iso_horiz_gap` (optional), `maps_iso_focus` (optional), `overview_iso_floor_gap` (optional), `overview_iso_horiz_gap` (optional), `overview_iso_focus` (optional), `overview_iso_zoom` (optional), `lights_hidden` (optional), `atlas_emergency_button` (optional), `atlas_live_colours` (optional), `overview_atlas` (optional), `emergency_entities` (optional), `atlas_alert_pulse` (optional), `emergency_notify` (optional), `atlas_heatmap_enabled` (optional), `atlas_audio_enabled` (optional), `atlas_shades_enabled` (optional), `atlas_thermostats_enabled` (optional), `atlas_weather_enabled` (optional), `atlas_weather_rain_entity` (optional), `atlas_weather_condition_entity` (optional), `atlas_weather_warning_entity` (optional), `atlas_weather_strength` (optional), `wall_screen_in` (optional), `wall_distance_m` (optional), `wall_text_arcmin` (optional), `wall_night_dim` (optional), `wall_pixel_shift` (optional), `wall_floor_cycle_s` (optional), `wall_fully` (optional), `atlas_3d_enabled` (optional), `atlas_3d_quality` (optional), `atlas_3d_people` (optional), `atlas_3d_tags` (optional), `atlas_3d_ai_task_entity` (optional), `atlas_3d_ai_task_backup_entity` (optional), `ai_photos_enabled` (optional), `ai_credit_month_usd` (optional), `ai_credit_warn_pct` (optional), `ai_stairs_enabled` (optional), `ai_plans_enabled` (optional), `ai_plan_build_enabled` (optional), `ai_map_wizard` (optional), `atlas_3d_library` (optional), `atlas_3d_weather` (optional), `atlas_3d_showcase` (optional), `atlas_3d_look` (optional), `atlas_3d_home_idle_s` (optional), `atlas_3d_carries` (optional), `atlas_3d_director` (optional), `atlas_3d_director_people` (optional), `lights_showcase` (optional), `lights_hide_untouched` (optional), `lights_hide_device_codes` (optional), `lights_show_beacons` (optional), `lights_fit_rooms` (optional), `lights_isolux` (optional), `lights_automorph_enabled` (optional), `lights_automorph_room_pct` (optional), `lights_automorph_hardness` (optional), `lights_automorph_style` (optional), `lights_automorph_subtlety` (optional), `lights_showcase_theme` (optional), `lights_showcase_presets` (optional), `whole_house_presets` (optional), `atlas_layout_v2` (optional), `traceback_house_focus` (optional), `vacation_mode_enabled` (optional), `vacation_mode_intensity` (optional), `vacation_mode_dark_only` (optional), `vacation_mode_dark_offset_min` (optional), `vacation_mode_end_at` (optional), `vacation_mode_pause_home` (optional), `vacation_mode_bedtime` (optional), `vacation_mode_max_on_min` (optional), `vacation_mode_max_lights` (optional), `vacation_mode_anchors` (optional), `vacation_mode_source` (optional), `adaptive_learning_enabled` (optional), `adaptive_floor_detection` (optional), `advanced_extra_tabs` (optional), `ha_entity_tracker_enabled` (optional), `ha_entity_area_enabled` (optional), `ha_entity_distance_enabled` (optional), `ha_entity_scanner_distance_enabled` (optional), `ha_entity_occupancy_enabled` (optional), `subzones_enabled` (optional), `screens_remote_enabled` (optional), `mqtt_publish_enabled` (optional), `espresense_mqtt_enabled` (optional), `espresense_topic_prefix` (optional), `tasmota_ble_enabled` (optional), `espresense_room_map` (optional), `espresense_companion_url` (optional), `aggressive_ble_reseed` (optional), `presence_poll_interval_s` (optional), `ble_reseed_interval_s` (optional), `lights_panel_enabled` (optional), `bermuda_ignore` (optional), `tags_room_events_enabled` (optional), `tags_nfc_identify_enabled` (optional), `tags_phone_autolink_enabled` (optional), `quiet_mode` (optional), `units_feet` (optional), `light_theme` (optional), `day_theme` (optional), `theme_palette` (optional), `theme_follow_sun` (optional), `ui_skin` (optional), `light_shapes` (optional), `light_type_overrides` (optional), `door_opener_ids` (optional), `door_composites` (optional), `beacon_auto_calibrate` (optional), `overview_persistent_pins` (optional), `overview_show_walls` (optional), `overview_show_outdoor` (optional), `overview_show_trails` (optional), `object_history_days` (optional), `scanner_offsets` (optional), `excluded_scanners` (optional), `scanner_min_rssi` (optional), `excluded_objects` (optional), `ingest_rules` (optional), `overview_2d_mode` (optional), `positioning_algorithm` (optional), `beacon_profiling_enabled` (optional), `beacon_tune_disabled` (optional), `beacon_group_overrides` (optional), `walk_to_identify_enabled` (optional), `radio_map_enabled` (optional), `distortion_map_enabled` (optional), `roomplan_import_enabled` (optional), `vacuum_import_enabled` (optional), `phone_wizard_enabled` (optional), `iphone_irk_guide` (optional), `mac_rotation_bridging` (optional), `apple_auto_classify` (optional), `low_memory_mode` (optional), `optimize_for_scale` (optional), `guest_tags_enabled` (optional), `guest_retention_days` (optional), `yesterday_home_enabled` (optional), `yesterday_home_time` (optional), `yesterday_home_target` (optional), `yesterday_home_lines` (optional), `lights_follow_enabled` (optional), `lights_follow_rooms` (optional), `lights_follow_people` (optional), `room_audio_matches` (optional), `room_audio_ha_speakers` (optional), `room_audio_matched` (optional), `enhanced_security` (optional), `forensics_enabled` (optional), `license_tier_override` (optional), `bright_reveal_presence` (optional), `forensics_retention_days` (optional), `rssi_capture_enabled` (optional), `rssi_capture_retention_days` (optional), `ble_max_age_s` (optional), `occupancy_hybrid_enabled` (optional), `occupancy_cluster_threshold` (optional), `occupancy_multiplier` (optional), `occupancy_dwell_min` (optional), `distance_stationary_devices` (optional), `onboarding_completed` (optional), `accuracy_tips_hidden` (optional), `setup_progress` (optional), `heatmap_gain` (optional), `heatmap_contrast` (optional), `distortion_intensity` (optional), `heatmap_source` (optional), `padspan_automations` (optional) | with Enhanced security | `ws_settings.py` | Persist one or more settings changes. |
| `padspan_ha/setup_phones` | – | – | `setup_checks.py` | Setup's "Track your phone or watch" step: the phones and watches PadSpan follows as someone's (phones_tracked), {phones: [{name, how}]}. |
| `padspan_ha/setup_tips` | – | – | `setup_checks.py` | The accuracy tips for the Overview: {tips: [ids that apply and are not hidden]}. |
| `padspan_ha/status` | – | – | `websocket.py` | Return the coordinator's current state dict for the Manage → Health tab. |
| `padspan_ha/store_backup_create` | `note` (optional) | always | `ws_backup.py` | Create a full backup snapshot of all PadSpan persistent stores + map images. |
| `padspan_ha/store_backup_delete` | `backup_id` | always | `ws_backup.py` | Delete a specific backup. |
| `padspan_ha/store_backup_list` | – | always | `ws_backup.py` | List all available backups. |
| `padspan_ha/store_backup_restore` | `backup_id`, `store_keys` (optional), `restore_map_images` (optional) | always | `ws_backup.py` | Restore selected stores from a backup snapshot. |
| `padspan_ha/subzone_add` | `zone` | always | `ws_subzones.py` | Adds a sub-zone. |
| `padspan_ha/subzone_from_piece` | `piece_id`, `name` (optional) | always | `ws_subzones.py` |  |
| `padspan_ha/subzone_remove` | `zone_id` | always | `ws_subzones.py` | Removes a sub-zone. |
| `padspan_ha/subzone_update` | `zone_id`, `zone` | always | `ws_subzones.py` | The whole sub-zone, changed fields merged over what is stored. |
| `padspan_ha/subzones_list` | – | – | `ws_subzones.py` | Every sub-zone. |
| `padspan_ha/suspend_databases` | `minutes` (optional) | with Enhanced security | `websocket.py` | Suspend all learned databases — raw radio + spatial centroid only. |
| `padspan_ha/system_critics` | – | – | `ws_diagnostics.py` | Health's list of problems, most serious first, with how often rooms are mistaken for each other. |
| `padspan_ha/tags_status` | – | – | `websocket.py` | Return HA Tags integration status and followed object tag mappings. |
| `padspan_ha/telemetry_event` | `event`, `screen` (optional) | – | `ws_telemetry.py` |  |
| `padspan_ha/telemetry_preview` | – | – | `ws_telemetry.py` | The report as it stands right now — same fields, same values as a send made this second would carry — shown before anyone opts in. |
| `padspan_ha/telemetry_reset_id` | – | always | `ws_telemetry.py` | Gives the usage report a new install id. |
| `padspan_ha/telemetry_send_now` | – | always | `ws_telemetry.py` | Sends the usage report now. |
| `padspan_ha/tester_preview` | – | always | `ws_tester.py` | What a tester sign-up would send, shown before it is sent. |
| `padspan_ha/tester_signup` | – | always | `ws_tester.py` | Signs up as a tester, or changes the sign-up. |
| `padspan_ha/tester_status` | – | always | `ws_tester.py` | The tester sign-up, if there is one. |
| `padspan_ha/tester_withdraw` | – | always | `ws_tester.py` | Withdraws the tester sign-up. |
| `padspan_ha/traceback_get` | `start_ts` (optional), `end_ts` (optional), `obj_key` (optional), `max_frames` (optional) | – | `websocket.py` | Return traceback position frames for playback. |
| `padspan_ha/traceback_objects` | – | – | `websocket.py` | Return all object keys seen in traceback history. |
| `padspan_ha/trial_start` | `email` | always | `ws_forensics.py` | Starts the one-time PadSpan Pro trial. |
| `padspan_ha/unsuspend_databases` | – | with Enhanced security | `websocket.py` | End database suspension early — resume full pipeline. |
| `padspan_ha/vacation_lights` | – | – | `websocket.py` | The lights an evening (anchor) light can be — the ones Vacation Mode switches, by name (vacation_mode.eligible_lights). |
| `padspan_ha/vacation_log_get` | `start_ts`, `end_ts` | – | `websocket.py` | What Vacation Mode switched between two times, and when it was on. |
| `padspan_ha/vacation_preview` | – | – | `websocket.py` | What Vacation Mode would switch over the next 24 hours — a read; it switches nothing and stores nothing (vacation_mode.async_preview). |
| `padspan_ha/vacuum_cal_pending_accept` | `point_id` | always | `ws_vacuum.py` | The user accepted one pending point: THE one road into calibration. |
| `padspan_ha/vacuum_cal_pending_list` | – | always | `ws_vacuum.py` |  |
| `padspan_ha/vacuum_cal_pending_reject` | `point_id` (optional), `all` (optional) | always | `ws_vacuum.py` |  |
| `padspan_ha/vacuum_findings` | – | always | `ws_vacuum.py` | Receivers the robot runs' points say are placed wrongly. |
| `padspan_ha/vacuum_import_commit` | `floor_id` (optional), `name` (optional), `include_rooms` (optional), `vacuum_entity` (optional) | always | `ws_vacuum.py` | Write the previewed candidate: a new map, its placement, new rooms only. |
| `padspan_ha/vacuum_import_preview` | `json_text` (optional), `url` (optional), `entity_id` (optional) | always | `ws_vacuum.py` | Parse a robot vacuum's map into a candidate. |
| `padspan_ha/vacuum_link_set` | `enabled` (optional), `vacuum_entity` (optional), `walker_enabled` (optional), `walker_tag` (optional), `unlink` (optional) | always | `ws_vacuum.py` | Turn the live position / the walker on or off. |
| `padspan_ha/vacuum_robot_control` | `action` | always | `ws_vacuum.py` | Start, Pause or Dock, through Valetudo's BasicControlCapability (not while a run goes). |
| `padspan_ha/vacuum_robot_set` | `url` (optional), `user` (optional), `password` (optional), `wifi_moving` (optional) | always | `ws_vacuum.py` | The robot's Valetudo address, and its user and password when Valetudo asks for them; and the switch "Collect Wi-Fi while it cleans" (vacuum… |
| `padspan_ha/vacuum_robot_status` | `rooms` (optional) | always | `ws_vacuum.py` | The robovac card: the robot as its Valetudo reports it, what a run needs, the last runs. |
| `padspan_ha/vacuum_robot_use_apply` | `leave` (optional), `undo` (optional) | always | `ws_vacuum.py` | Apply the choice to the earlier runs (their points out and back in by it, one step after a backup), or leave them as they are, or undo the… |
| `padspan_ha/vacuum_robot_use_set` | `use` | always | `ws_vacuum.py` | How the robot's points are used from now on. |
| `padspan_ha/vacuum_run_start` | `room` (optional) | always | `ws_vacuum.py` | Start a room location run (every room, or one): calibration is backed up first. |
| `padspan_ha/vacuum_run_stop` | – | always | `ws_vacuum.py` | Stop the run going: the robot is sent home, the points so far stay. |
| `padspan_ha/vacuum_run_undo` | `run_id` | always | `ws_vacuum.py` | Remove exactly one run's points from calibration. |
| `padspan_ha/vacuum_status` | – | always | `ws_vacuum.py` | The import block's read, never refused (the robot vacuum's features' gate is not on it): the link, the walker, the pending count and the ru… |
| `padspan_ha/version` | – | – | `websocket.py` | Return version info. |
| `padspan_ha/wled_backups` | `action` (optional), `backup_id` (optional), `pin` (optional) | – | `ws_wled.py` | List, take, or read a stored backup of a WLED device's cfg/presets. |
| `padspan_ha/wled_cfg` | `patch`, `base_hash`, `reboot` (optional), `pin` (optional) | always | `ws_wled.py` | One /json/cfg write, done safely (safe_cfg_write). |
| `padspan_ha/wled_devices` | – | – | `ws_wled.py` | Every WLED device HA knows, with its light entities — for teaming. |
| `padspan_ha/wled_exact_list` | – | – | `wled_exact.py` | Which WLED lights PadSpan runs — for the Atlas's routing. |
| `padspan_ha/wled_exact_set` | `exact` (optional), `hold` (optional) | always | `wled_exact.py` | Who gives this light its instructions: WLED sync or PadSpan (and the "put the look back" switch). |
| `padspan_ha/wled_get` | `path` | – | `ws_wled.py` |  |
| `padspan_ha/wled_identify` | `seg_id`, `seconds` (optional) | – | `ws_wled.py` |  |
| `padspan_ha/wled_live` | – | – | `ws_wled.py` |  |
| `padspan_ha/wled_look_get` | `compare` (optional) | – | `wled_exact.py` | The device's record. |
| `padspan_ha/wled_look_remember` | `team` (optional), `preview` (optional) | always | `wled_exact.py` | Remember the look as it is now (only when someone asks — an accidental state never becomes the look): GET /json/si, then /json/cfg. |
| `padspan_ha/wled_look_use_history` | `index` | always | `wled_exact.py` |  |
| `padspan_ha/wled_matrix` | `enabled`, `panels` (optional), `pin` (optional) | always | `ws_wled.py` |  |
| `padspan_ha/wled_power` | `entity_id`, `on`, `brightness` (optional), `transition` (optional), `source` (optional) | – | `wled_exact.py` | On (with the look) / off / a brightness, for an exact light — open to any user, as HA's own light control is. |
| `padspan_ha/wled_state` | `body` | – | `ws_wled.py` | POST /json/state — live changes; persisting keys need an admin. |
| `padspan_ha/wled_team_mode` | `team_id`, `mode` | always | `wled_exact.py` | Run this team by WLED sync or by PadSpan. |
| `padspan_ha/wled_teams_get` | – | – | `ws_wled.py` | The WLED teams (devices that act as one light). |
| `padspan_ha/wled_teams_set` | `teams`, `base_hash` (optional) | always | `ws_wled.py` | Saves the WLED teams. |
| `padspan_ha/zigbee_twin_use` | `entity_id`, `twin` | with Enhanced security | `zigbee_twins.py` | Use the Zigbee2MQTT copy's entity wherever PadSpan uses its duplicate's (async_use_twin): {ok, moved, settings}. |
<!-- /generated:websocket -->
