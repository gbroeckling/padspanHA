# Bug log

A running record of bugs found and fixed. Each one has what people saw, why it
happened, the commit and release that fixed it, and how the fix shows up in
the opt-in report (Settings → Presence → Help improve PadSpan), so a fix can
be checked in houses the tests cannot see. Newest first. Started 2026-10-12.

Status: **fixed** (in a release), **committed** (on main or a branch, not yet
released), **watching** (fixed; confirming from the field).

| # | Area | What people saw | Cause | Fix | Release | Field signal | Status |
|---|---|---|---|---|---|---|---|
| 117 | Bermuda | A device with Area Last Seen enabled could show twice, once in an old room | Entity picked by current state swapped between Area and Area Last Seen (from #114) | 0a4f1439 | 0.38.120 | — | committed |
| 116 | Entities | Ordinary sensors (kitchen_voltage, dining_table_occupancy) became tracked objects | Bluetooth words matched as substrings | a6495d60, 0a4f1439 | 0.38.120 | `bermuda_entities_n` | committed |
| 115 | Bermuda | Bermuda Ignore still let `*_area_last_seen` entities in | Ignore covered one of two candidate checks | a6495d60 | 0.38.120 | — | committed |
| 114 | Bermuda | One Bermuda device became several objects (Area, Floor, one per scanner) - likely driver of slow builds | Every entity with an area attribute was a candidate | a6495d60 | 0.38.120 | `snap_ha_ms`, `bermuda_entities_n` | committed |
| 113 | Startup | One store failing to load dropped every other store, and the device registry | Store loads gathered without return_exceptions | 6f333d25 | 0.38.120 | `runs` | committed |
| 112 | Startup (data loss) | One failed disk read at startup could overwrite rooms, maps, settings (licence, followed devices, IRKs) and calibration with defaults | SafeStore turned a read error into "first boot" | 6f333d25 | 0.38.120 | — | committed |
| 111 | Pre-existing | Forget object, clearing a removed beacon and immediate beacon calibration never did anything | Called PresenceCoordinator methods on the config holder (`coordinator`) | 430fb527 | 0.38.119 | — | fixed |
| 110 | WLED | Removing Bright after moving to HA would leave every light with sync off | Skipped all devices when the other edition was installed (from #89) | 430fb527 | 0.38.119 | — | fixed |
| 109 | Maps | Old floor's devices still drawn after a Stack move | Either floor counted (from #88) | 430fb527 | 0.38.119 | — | fixed |
| 108 | Alerts | Alerts to a telegram_bot.send_message-style target never sent | No direct call once the fallback went (from #99) | 430fb527 | 0.38.119 | — | fixed |
| 107 | Entities | The occupancy sensor's leftover device could never be deleted | Refused unconditionally (from #102) | 430fb527 | 0.38.119 | — | fixed |
| 106 | Traceback | Newest frames still lost in thinned 7-day replays | Each pass still re-clamped with its own clock (from #92) | 430fb527 | 0.38.119 | — | fixed |
| 105 | Presence | Naming a device that is home fired depart then arrive | Label groups keyed by text; a renamed group looked new (from #95) | 430fb527 | 0.38.119 | — | fixed |
| 104 | Low memory | An unlabelled IRK phone could be dropped by the history cap | Cap checked only identified/label (from #1) | dc48872d | 0.38.119 | — | fixed |
| 103 | IRK | A phone could stay unresolved 20 min after a routine reload | Cache cleared before the key list was rebuilt (from #62) | dc48872d | 0.38.119 | — | fixed |
| 102 | Entities | Deleting a device in use lost its entities until restart | Removal allowed for every device (from #70) | dc48872d | 0.38.119 | — | fixed |
| 101 | Entities | A plain-address device registered under its address got `_2` entities | Registry checked only the new uid form (from #79) | dc48872d | 0.38.119 | — | fixed |
| 100 | Entities | Per-scanner distance sensors could come back as new entities | Took the area sensor's uid without checking the registry (from #79) | dc48872d | 0.38.119 | — | fixed |
| 99 | Alerts | An alert whose phone was renamed went to some other notify target | Auto-pick ran after a missing saved target (from #12) | 8a5944dd | 0.38.119 | — | fixed |
| 98 | Alerts | Kitchen -> Hall -> Bedroom reported Hall only | 60 s cooldown dropped the latest room (from #24) | 8a5944dd | 0.38.119 | — | fixed |
| 97 | Presence | A move after a 60 s - 5 min gap was never reported | Re-entry reset cleared the room; next change had no "from" (from #30/#25) | 8a5944dd | 0.38.119 | — | fixed |
| 96 | Presence | Changing the away timeout fired arrivals or departures for everyone | Diffed against the previous poll (from #17) | 8a5944dd | 0.38.119 | — | fixed |
| 95 | Presence | A phone on two keys "left" while home (depart alert/rules) | Arrive/depart per key, not per device (from #17) | 8a5944dd | 0.38.119 | — | fixed |
| 94 | Lost & Found | Records of HA-linked devices away >1 day dropped at restart (records from 0.38.106-0.38.118 stay unmarked until their next departure) | Start-up prune judged by whether still heard (from #3) | db370862 | 0.38.119 | — | fixed |
| 93 | Lost & Found | Followed devices without a label stopped being recorded | `identified` ignored the followed list (from #3) | db370862 | 0.38.119 | — | fixed |
| 92 | Traceback | A thinned 7-day replay lost its newest frames | Retention floor computed separately in each pass (from #51) | db370862 | 0.38.119 | — | fixed |
| 91 | Presence | Arrive/depart rules delayed while a replay or Insights read history | Poll's save waited on the history lock (from #51) | db370862 | 0.38.119 | — | fixed |
| 90 | Traceback | Filtered replay auto-expand found nothing with nobody home | Range end taken from 10-min memory (from #51) | db370862 | 0.38.119 | — | fixed |
| 89 | WLED | Removing Bright could rewrite sync on devices PadSpan HA runs | Give-back ignored the other edition (from #49) | ba45a236 | 0.38.119 | — | fixed |
| 88 | Maps | Redraw after a Stack move added the old floor's devices | Preferred stale stack.floor_id (from #45) | ba45a236 | 0.38.119 | — | fixed |
| 87 | Licence | Last grace day said "stops in 0 days" | days_left rounds down (from #60) | ba45a236 | 0.38.119 | — | fixed |
| 86 | Traceback | ?view=insights deep link opened plain playback | Used up by a render before maps loaded (from #77) | ba45a236 | 0.38.119 | — | fixed |
| 85 | Install Base | Shares over 100% | Divided spool-wide distributions by the 30-day count (from the redesign) | ba45a236 | 0.38.119 | — | fixed |
| 84 | Licence / Backup | Restore kept an expired trial over the backup's paid key | Live licence always kept (from #56) | ba45a236 | 0.38.119 | — | fixed |
| 83 | Beacon Tune | A second drag during an auto-save was dropped silently | `busy` never checked (from #6) | ba45a236 | 0.38.119 | — | fixed |
| 82 | Beacon Tune | A map with no metre placement stayed "unsaved" for good | Refused before checking for changes (from #6) | ba45a236 | 0.38.119 | — | fixed |
| 81 | Beacon Tune | Dragging a phone pinned it as a fixed beacon | Tracked display rows written like beacons (from #6) | ba45a236 | 0.38.119 | — | fixed |
| 80 | Process | ~30 bugs introduced by the day's fixes (#81-#110), found by two reviews of the fixes | Fixes verified against the reported case only; callers and interactions between fixes unchecked; a beta per batch | — | — | — | changed: fix batches get a regression review before release |
| 79 | Entities | A phone's Area/Distance sensors stuck on not_home while its tracker followed it; restarts made `_2` entities | Sensors re-targeted only on a new key; unique_id from whichever key polled first; created before the device list loaded | fc66b76e | 0.38.117 | — | fixed |
| 78 | Traceback | A custom range typed backwards always read "No data in range" | Not swapped | bcdb092b | 0.38.117 | — | fixed |
| 77 | Traceback / Insights | No Insights or Busy Times on a house without a floor-plan photo | Traceback returned before drawing anything | 599cf895 | 0.38.117 | `tab:traceback` | fixed |
| 76 | NFC | Tap-to-identify labelled objects `NFC: <tag id>` | Tag names live on the tag's entity; read `.name` off a dict | 275d223e | 0.38.117 | — | fixed |
| 75 | Setup | Setup asked for an update interval that did nothing | Field only copied into diagnostics | 33346357 | 0.38.117 | — | fixed |
| 74 | MQTT | `home` ignored the away timeout; `/area` kept the last room when away; `/distance` never sent | Fixed 300 s; nothing set `obj["distance"]` | 8e883092 | 0.38.116 | — | fixed |
| 73 | Lost & Found | A panel left open showed where a device was yesterday | Fetched once per panel lifetime and preferred over the live room | 1b91125e | 0.38.116 | — | fixed |
| 72 | Forensics | A frequent visitor's older sessions vanished inside the retention; the search said its list was complete | Fixed 50 sessions per address | a595e03b | 0.38.116 | — | fixed |
| 71 | Tag events | A second room change within 30 s was never reported (automations on `to_room` missed it) | Cooldown dropped the change instead of holding it | 3061ccf7 | 0.38.116 | — | fixed |
| 70 | Entities | Stale PadSpan entities/devices could not be deleted | No `async_remove_config_entry_device` | 1bbd4382 | 0.38.116 | — | fixed |
| 69 | Services | `dump_devices` with `notify: false` still notified; target picker the schema rejects | `call.data` never read; empty `target:` | 1bbd4382 | 0.38.116 | — | fixed |
| 68 | Automations | A rule turning a scene OFF saved and never ran | HA has no `scene.turn_off` | 1bbd4382 | 0.38.116 | — | fixed |
| 67 | Forensics | Search failed at random | Executor iterated the live dict the tick changes | 1bbd4382 | 0.38.116 | `forensics_query` | fixed |
| 66 | Forensics | "+N more" too low; CSV held 10 sessions per device | Counted the 10 shipped, not `session_count` | 1bbd4382 | 0.38.116 | — | fixed |
| 65 | Traceback | Distance Traveled 0 m inside a room | Read `x/y/m`; frames carry `x_m/y_m` | 1bbd4382 | 0.38.116 | — | fixed |
| 64 | Bright | With presence revealed, presence polled once and stopped | No entity listens to the coordinator, so HA scheduled no refresh | f3dbbf05 | 0.38.116 (Bright: next stable) | — | committed |
| 63 | Scanners | A disconnected proxy showed as scanning for up to 4 h | Orphan radio hard-coded `scanning: True` | f3dbbf05 | 0.38.116 | — | fixed |
| 62 | IRK | A phone stayed unresolved up to 20 min after adding its IRK | Reload kept cached "unresolved" answers | f3dbbf05 | 0.38.116 | `irks_resolving` | fixed |
| 61 | ESPresense | ESPresense radios and readings flickered out on busy houses | MQTT handlers ran in worker threads and raced the snapshot | f3dbbf05 | 0.38.116 | `errors` (snapshot) | fixed |
| 60 | Licence | Card said "Trial active, -5 days left" during grace | No grace branch | 19a423c5 | 0.38.116 | — | fixed |
| 59 | Licence | Factory reset turned Bright Pro into Pro | `license_tier` not kept | 19a423c5 | 0.38.116 | — | fixed |
| 58 | Licence | Grace ended after 13 days | Compared `.days` (rounded down) | 19a423c5 | 0.38.116 | — | fixed |
| 57 | Licence | A refunded key kept working until its date (lifetime: forever) | Revocation wrote "now" only when no expiry was stored | 19a423c5 | 0.38.116 | — | fixed |
| 56 | Licence / Backup | Restoring an older backup blanked a paid key | Settings restore replaced the licence fields | 19a423c5 | 0.38.116 | — | fixed |
| 55 | Forensics / Traceback | Up to 5 min of Forensics and 30 s of Traceback lost on every restart | Flushes ran only on unload, which HA doesn't do at stop | 95f3fe10 | 0.38.116 | — | fixed |
| 54 | Traceback / Backup | A restore erased all movement since the backup | Restore replaced the history | e3e49b86 | 0.38.116 | — | fixed |
| 53 | Insights | Insights/Busy Times stalled HA's event loop (~0.8 s per load) | Dwell computed on the loop over the in-memory week | e3e49b86 | 0.38.116 | `lag` | fixed |
| 52 | Backup | Each backup carried ~120 MB of Traceback | Backup copied the whole week | e3e49b86 | 0.38.116 | — | fixed (backups carry the last day) |
| 51 | Traceback (memory) | ~600 MB RAM after a restart with 10 devices home, on every install since 0.38.112 | The week of frames lived in memory (~1 KB per object per frame) | e3e49b86 | 0.38.116 | `rss_mb`, `runs.unclean` | watching |
| 50 | WLED | With a lapsed licence, a team PadSpan runs could not be given back to WLED sync | The no-licence card skipped team members; the Team card is behind the licence | c4935d32 | 0.38.114 | — | fixed |
| 49 | WLED | Deleting PadSpan left its WLED lights with sync switched off for good | No `async_remove_entry`; the original sync lives only in PadSpan's store | 95e14609 | 0.38.114 | — | fixed |
| 48 | WLED / Backup | After restoring an older backup a light read "WLED sync" with sync off; switching again lost the original settings | Restore replaced the switch fields (join/exact/sync_off/prior_sync) and team mode/prior | 27d6b4ea | 0.38.114 | — | fixed |
| 47 | WLED | Without a licence, one offline team member stopped the rest switching | Plain calls looped with no `except`; the first error ended the loop | 602b1b05 | 0.38.114 | — | fixed |
| 46 | Rooms editor | Add room / Delete room threw away unsaved drags | Both reset the draft, which re-copied the model | 81fa9544 | 0.38.114 | — | fixed |
| 45 | Maps | Upstairs and basement scanners/beacons drawn on the main plan after a crop/rotate/replace | Re-derive appended any fabric device inside the picture, any floor | 76ddf395 | 0.38.114 | — | fixed (pins already added stay) |
| 44 | Rooms editor | Dragging a door's wall erased its sensor, opener, lock and Invert links | Save sent six fields; the set replaces the wall by id | 769cd567 | 0.38.114 | — | fixed |
| 43 | Lights | A new light shrank to half size on Save; perimeter lights sat on the wall line | Handler turned "default" 0 / missing into stored 1 cm and 0 cm | 977522c6 | 0.38.114 | — | fixed (saved lights keep their values) |
| 42 | Floors | A floor HA dropped lost its heights and its rooms' place in the stack | Guard called a method FabricStore doesn't have; error swallowed (test fake had it) | c6736368 | 0.38.114 | — | fixed |
| 41 | Calibration | Replace Scanner / Relearn Radio ignored by the forest until restart; Replace made two readings from one scanner | No retrain after either; no collision check | bdc56d28 | 0.38.114 | — | fixed |
| 40 | Beacon Tune | Hard relocation with a failed save left the beacon with no data | Old points deleted before the new one was saved | bdc56d28 | 0.38.114 | — | fixed |
| 39 | Calibration | Re-importing a file duplicated every point; Import hidden on an empty install | Save stamped "now" over collected_at, so the dedupe key never matched; empty state returned early | bdc56d28 | 0.38.114 | `calibration_point_added` | fixed |
| 38 | Calibration | Settings per-map Clear (N) deleted nothing ("Cleared 0") and hid the points from the map | Clear detached metre points (map-delete behaviour) instead of deleting | bdc56d28 | 0.38.114 | — | fixed |
| 37 | Auto-calibration | Phantom room names in auto points | Pin room used unchecked (legacy pins hold a device label) | f7de4b9f | 0.38.114 | — | fixed |
| 36 | Auto-calibration | Each map save carrying beacons added a one-scanner auto point per beacon | Immediate injection saved one smoothed reading per scanner | f7de4b9f | 0.38.114 | — | fixed |
| 35 | Sandbox / Settings | Sandbox rows did nothing; Suspend/Resume said they worked when the coordinator wasn't ready | Called a missing `navigate` action; ignored the handler's `{ok:false}` | a3d639bb | 0.38.113 | — | fixed |
| 34 | Settings | Auto-Offset and the Beacon Profile toggles changed nothing (and the help text said they did) | Nothing in the backend reads `auto_offset_mode`, `beacon_tune_disabled` or `beacon_profiling_enabled` | 40460818 | 0.38.113 | — | fixed (screens made honest) |
| 33 | Factory reset | Tagged devices came back labelled after a reset; Lost & Found and Forensics survived | Device registry, Lost & Found and Forensics weren't reset | 800e73e7 | 0.38.113 | — | fixed |
| 32 | Backup / reset | A restored Traceback vanished at restart; a factory reset's Traceback came back on reload | History lives in daily segment files; restore and reset only touched the legacy file | c2883af9 | 0.38.113 | — | fixed |
| 31 | Backup | Restoring Forensics, the device registry or the object history was undone at their next save | In-memory copies never reloaded (`.addrs`, `._devices`, plain dict) | c2883af9 | 0.38.113 | — | fixed |
| 30 | Presence | A tagged device coming home was reported in the room it left from | History replay kept it "present", so the re-entry reset never cleared old votes | 3fcd8a22 | 0.38.113 | `tagged_arrived` | watching |
| 29 | Alerts | Alerts for an IRK phone stopped after its first address rotation (~15 min) | Config saved under the rotating address; lookups tried only key + current address | ef835776 | 0.38.113 | `follow_alert_sent` | watching |
| 28 | Calibration | Scanner at a whole-metre height/position could not be saved again ("Saved N, failed 1") | Schema declared plain `float`; the browser sends 2.0 back as 2 | f7773235 | 0.38.112 | — | fixed |
| 27 | Phone wizard | Overview's phone Unfollow always showed Error; when it worked elsewhere the phone stayed labelled via its IRK | Schema refused the extra `device_name`; unfollow left the IRK canonical_id label | 0223c974 | 0.38.112 | — | fixed |
| 26 | Tag events | `padspan_room_change` never fired for followed BLE/IRK devices | Followed list holds addresses; compared against the object key | 16066183 | 0.38.112 | — | fixed |
| 25 | Alerts | Every restart sent "moved from unknown to X" per followed device | First room confirmation (old room None) treated as a move | cdbcb4fa | 0.38.112 | `follow_alert_sent` | watching |
| 24 | Alerts | Room-change alerts never rate-limited (a tag on a boundary alerted every flip) | Cooldown read under `key`, written under `key:room` | 7b997d0b | 0.38.112 | `follow_alert_sent` | watching |
| 23 | Traceback | No playback history for any time no PadSpan panel was open | Frames were recorded from the panel's snapshot request | 59f0089a | 0.38.112 | — | fixed |
| 21 | Backup | A restore reset every Lost & Found "last seen" | The Lost & Found store was never in a backup; a restore also wouldn't have reloaded it (its data is `records`) | 088b5303 | 0.38.111 | — | fixed |
| 20 | Settings | Linger time could be set and did nothing | The linger logic was removed in 0.20.16 for a fixed 120 s grace; the card stayed | 3816e7af | 0.38.111 | — | fixed |
| 19 | Alerts | A phone-only alert didn't appear in Manage's saved list | The list filtered on email | 7a56aeae | 0.38.110 | — | fixed |
| 18 | Alerts | Room-change alerts to a phone picked without an email never went out | Room-change path required an email; arrive/depart didn't | 5a8b69af | 0.38.110 | `follow_alert_sent/_failed` (0.38.111) | watching |
| 17 | Presence | Arrive/leave alerts and `padspan_device_arrived/departed` never fired for tagged devices; every arrive alert fired on each restart | "Present" was any key in the poll result, and the object history keeps tagged devices there forever; no startup baseline | 4337b3d6 | 0.38.110 | `tagged_arrived/_departed` (0.38.111) | watching |
| 16 | MQTT | A label with `#` or `+` stopped MQTT publishing for every device after it | Wildcards in the topic made the publish raise inside a whole-loop `try` | ed98e8e4 | 0.38.109 | `mqtt_publish_failed` (0.38.111) | watching |
| 15 | Phone wizard | A phone named like "Garry's Pixel 8" was listed twice | Title-cased slug compared with the lowercase name | e1f27764 | 0.38.109 | — | fixed |
| 14 | Devices | An iBeacon and a plain address of the same HA device stayed two devices | Matched on `"id"`; the entries are keyed `"device_id"` | 36078bbd | 0.38.109 | `merged_by_device_n` (0.38.111) | watching |
| 13 | Phone wizard | "Turn on BLE Transmitter" always failed | Used the app's device id as the notify service name; the app names it after the phone | d3e15bda | 0.38.109 | `companion_tx_sent/_no_service/_failed` (0.38.111) | watching |
| 12 | Alerts | Alerts to a phone picked in the list went nowhere; Test said it worked | Every `notify.*` was sent as an entity via `send_message`, which drops a missing entity silently | d0c522b2 | 0.38.108 | `follow_alert_sent/_failed` (0.38.111) | watching |
| 11 | Log | Opening the alert service list wrote a warning to HA's log | Normal result logged at WARNING | d0c522b2 | 0.38.108 | `errors` (ws_notify) | fixed |
| 10 | Bermuda | Slow snapshot builds | Missing saved tags each walked every HA state, every build | da0e82e3 | 0.38.108 | `saved_tags_missing_n`, `snap_ha_ms` | watching |
| 9 | Bermuda | Slow snapshot builds (1.4–18 s on a third of installs) | A dead tags × Bluetooth-devices walk per build (compared a key the entries never had) | f13ef188 | 0.38.108 | `snap_*_ms`, `ha_states_n`, `bermuda_*` | watching — the 18 s cause is not yet proven |
| 8 | Beacon Tune | Pinned beacons missing from Calibration → Matrix | Snapshot never carried the pin fields the coordinator set | d32c5d0f | 0.38.107 | — | fixed |
| 7 | Overview | A pinned beacon drawn where the solver put it, not at its pin | Overview ignored `anchor_true_*` (also not carried, #8) | d32c5d0f | 0.38.107 | — | fixed |
| 6 | Beacon Tune | Placing or moving a beacon was never saved (since 0.30.0) | Save loop had an empty body after the photo-write removal | d32c5d0f | 0.38.107 | `beacon_tune_saved/_refused/_failed` | watching |
| 5 | Monitor | Diag Export froze the browser near a busy street | Whole live snapshot stringified on every Monitor redraw | 392e45e5 | 0.38.106 | `diag_export_built` | watching |
| 4 | Settings | BLE timeout said 900 s default; cache ignored it | UI default text wrong; cache pruned at a fixed 4 h | 392e45e5 | 0.38.106 | `ble_addrs_n` | watching |
| 3 | Lost & Found | File grew without end and was rewritten every poll | Recorded every passing stranger; IDs changed every build (#2) | 392e45e5 | 0.38.106 | `lostfound_n`, `lost_and_found_pruned` | watching |
| 2 | Devices | Unidentified devices got a new internal ID every build past ~1,000 | Random IDs from a cache that held ~1,000 devices | 392e45e5 | 0.38.106 | — | fixed |
| 1 | Presence (#91) | HA CPU 3.6% → 13.9% near a busy street | Every object, including thousands not heard for hours, smoothed every poll | 392e45e5 | 0.38.106 | `loop_ms`, `smoothed_n`, `background_n`, `cpu_pc` | watching |

## Open leads

- **Traceback replays a floor with no photo at ground level**: its storey comes from the photos' stack levels; Overview's floor frame numbers storeys differently (HA levels or slab indices), so mixing them could put a floor on the wrong storey. Left until it can be done in one number space.
- **Insights on a full week** takes ~3 s on a desktop (streamed in the executor now); a Pi will be slower. Per-day caching would fix it if reports show it.

- **Auto-calibration from a pinned beacon that was physically moved** keeps labelling new points with the old spot until the pin is updated. Gating on solver drift was considered and left out: the solver is least accurate exactly where auto-calibration is needed most.
- **`emergency_entities`** has no UI and accepts only `light.`/`switch.` ids, though its docstring mentions groups.

- **Bermuda builds of 1.4–18 s**: waiting for the per-phase timings (0.38.108+) from b222e30f, f6e4e364, eb3e9ecf, eee7d648, 300fbac3.
- **IRKs silent on 12 of 22 installs**: looks like phones away or wrong keys, not the resolver. Not a bug yet.

### Decided

- **A kept floor's stored level decides the numbering** (2026-10-12): found in the regression review; it is the 2026-09-27 design (test_a_kept_floor_with_a_stored_level_keeps_the_stored_numbering), which #42 only made reachable. Not changed.
- **README vs licence check** (2026-10-12): the README said PadSpan makes no outbound requests with Update Check off, but the daily licence revalidation runs whenever a key is entered. Garry: reword the README, keep the check (so a refunded key is caught).
- **device_tracker state is the room name** (2026-10-12): HA's Person counts any non-`home` state as away, so a Person linked only to PadSpan isn't counted in `zone.home`. Garry: leave the tracker as is (existing automations depend on it).

### Earlier leads

- **Bermuda builds of 1.4–18 s** (#9, #10): the per-phase timings (0.38.108+) will say which phase. Baseline installs: b222e30f, f6e4e364, eb3e9ecf, eee7d648, 300fbac3.
- **IRKs silent on 12 of 22 installs:** looks like phones away or wrong keys, not the resolver (both sources resolve elsewhere). Not a bug yet.
