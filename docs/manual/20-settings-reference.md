# 20. Settings reference

[Contents](README.md)

Every setting PadSpan keeps: where it is in the panel, its default, what it takes, and what it does.
The tables are made from PadSpan's code by `scripts/build_manual_reference.py` (the defaults from
`settings_store.py`, the ranges from `ws_settings.py`, the labels checked against the panel's own
screens), and a test fails when they and the code disagree.

## Before you change anything

- **Basic mode shows only Appearance.** Settings' other tabs (Tracking, Features, AI, Atlas, UI
  Structure) are in Advanced and Development mode. The mode button at the top right switches
  between them.
- **Most settings save at once** and take effect at the next update, with no restart. The ones that
  need more say so on their card (the Atlas's sidebar entry needs a Home Assistant restart; a newly
  ticked kind of entity needs PadSpan to reload).
- **With Enhanced security on** (on for a new install), only a Home Assistant administrator can change
  PadSpan's shared setup. A few settings are an administrator's whatever it says: Enhanced security
  itself, the usage report, Vacation Mode, guest tags, the AI and the shared furniture library, who
  shows in Live Aboard, and ESPresense Companion's address.
- **Every setting is in PadSpan's backups**, and a Factory Reset puts them back to these defaults
  (keeping your licence key). See [chapter 22](22-backup-restore-moving.md).
- **Keys** are the names PadSpan stores each setting under in `.storage/padspan_ha.settings`. They
  are given for support and for reading a Diagnostics file; there is no need to edit the file.

"Range or choices" is what PadSpan keeps the value to: a number outside the range is moved to its
end, and a word not on the list is refused or replaced. "empty" means nothing is set.

## In Settings

The tabs, sections and cards are named as the panel names them. Tracking's eight sections are each a
folding heading on that tab.

<!-- generated:settings (scripts/build_manual_reference.py) -->
### Settings → Appearance

| Card: control | Default | Range or choices | What it does | Key |
|---|---|---|---|---|
| Panel Style | `2025` | `classic`, `2025` | `2025` restyles the panel's frame (grouped menu with icons); `classic` is the original. | `ui_skin` |
| Theme | empty | `graphite`, `ocean`, `dusk`, `contrast` | The colours: empty is Night (dark green), or Graphite, Ocean, Dusk or High contrast (`contrast`). Graphite, Ocean and Dusk come with Pro. | `theme_palette` |
| Theme: Light (inverted) | off | on or off | The panel's colours turned light (inverted). | `light_theme` |
| Theme: Day | off | on or off | Day, PadSpan's designed light look (Pro). It wins over Light. | `day_theme` |
| Theme: Follow the sun | off | on or off | Day (Light without Pro) from sunrise to sunset, the theme you picked at night. | `theme_follow_sun` |
| Units: Show lengths in feet and inches | off | on or off | Mapping's measuring and the rooms helper show feet and inches. Lengths are kept in metres either way. | `units_feet` |
| 2D Map Mode: Replace 3D isometric view with flat 2D map | off | on or off | Experimental: the Overview shows the floor plan flat, with zoom and pan. | `overview_2d_mode` |

### Settings → Tracking → Rooms and timing

| Card: control | Default | Range or choices | What it does | Key |
|---|---|---|---|---|
| Room Change Delay | 20 | 0 to 300 | Seconds a receiver must stay ahead before a device moves to its room. A clear move next door needs half. | `room_change_delay_s` |
| Hold Room Through Short Gaps: Hold last room | 0 | 0 (off), or 1 to 600 | Seconds a device's room stays shown through a signal gap. Display only: rooms are decided as before. | `hold_last_room_s` |
| Why This Room (Sensor Attribute): Add a room_reason attribute to each area sensor | off | on or off | Adds `room_reason` to each area sensor ([chapter 14](14-home-assistant-reference.md)). | `room_reason_attribute` |
| Home/Away Timeout: Away timeout | 5 | 1 to 1440 | Minutes a device goes unheard before its tracker and area sensor read `not_home`. | `away_timeout_m` |
| Home/Away Timeout: Things keep their room | 0 | 0 (off), or 0.5 to 48 | Hours a device nobody carries (keys, a tag on a bag) keeps its last room before it reads `not_home`. | `thing_away_timeout_h` |

### Settings → Tracking → Phones and guest tags

| Card: control | Default | Range or choices | What it does | Key |
|---|---|---|---|---|
| Guest tags: Use tags as guest tags | off | on or off | Guest tags: the Guests screen, `binary_sensor.padspan_guest_home` and the guest notices. | `guest_tags_enabled` |
| Guest tags: Keep a finished stay's report (name, times, rooms) for | 30 | `0`, `7`, `30`, `90` | Days a finished stay's report is kept. 0: not kept. | `guest_retention_days` |
| Phone Tracking (Private BLE) | empty |  | The phones and watches whose key (IRK) you added in PadSpan. | `irk_devices` |

### Settings → Tracking → What the panel shows

| Card: control | Default | Range or choices | What it does | Key |
|---|---|---|---|---|
| Quiet Mode | off | on or off | Hides devices nobody has named from the panel's lists and counts. Switched by the Quiet tick at the top of the Overview. | `quiet_mode` |
| Object History Retention: Keep unlabelled for | 1 | `1`, `2`, `7`, `14` | Days a device nobody named stays in PadSpan's history. Named devices are kept. | `object_history_days` |
| BLE Advertisement Timeout: Max age | 14 400 | 30 to 14 400 | Seconds a device stays listed after its last advertisement. | `ble_max_age_s` |

### Settings → Tracking → Positioning and calibration

| Card: control | Default | Range or choices | What it does | Key |
|---|---|---|---|---|
| Positioning Algorithm | `knn` | `knn`, `rf` | `knn`: live signals matched to your calibration points. `rf`: the learned model (experimental). | `positioning_algorithm` |
| Positioning Choices: Pick the better method for this house | off | on or off | Uses whichever placing method did better on calibration spots it had not seen. | `positioning_pick_better` |
| Positioning Choices: Mark a room as unsure when the signal is thin | off | on or off | With fewer than 3 receivers, or no good calibration match, a device keeps its room and is marked unsure. | `positioning_unsure` |
| Positioning Choices: Use motion sensors and usual moves to break ties | off | on or off | Motion and occupancy sensors, and the moves PadSpan has learned, decide between two rooms that read almost the same. | `positioning_sensor_fusion` |
| Walk a Room (Calibration): Add a "Walk a room" tab to Calibration | off | on or off | Adds Walk a room to Calibration. | `calibration_room_walk` |
| Distance Calibration: Reference power | -59 | -100 to 0 | Signal strength in dBm at 1 metre, for the distance sensors. | `ref_power` |
| Distance Calibration: Path-loss exponent | 2.5 | 1 to 4 | How fast the signal falls with distance, for the distance sensors: about 2 in the open, 2.5 to 3.5 indoors. | `path_loss_exp` |
| Signal smoothing: Process noise Q | 3 | 0.01 to 10 | How fast the smoothed signal follows a change. Higher follows movement faster. | `kalman_q` |
| Signal smoothing: Measurement noise R | 8 | 0.5 to 50 | How little one reading is trusted. Higher smooths more and changes rooms more slowly. | `kalman_r` |
| 3D Positioning — Device Height: Device height (m) | 1 | 0 to 3 | How high a carried device is above the floor, in metres, for 3D distances. | `assumed_device_height_m` |
| Calibration Accuracy Reminders: Remind me to update calibration when needed for accuracy | off | on or off | A check for gaps and stale readings in calibration, with spots to stand at. | `health_reminder_enabled` |
| Adaptive Learning: Enable adaptive learning | off | on or off | Experimental: learns each room's signal from devices PadSpan is sure of. | `adaptive_learning_enabled` |
| Adaptive Learning: Floor detection enhancement | off | on or off | Experimental: learns how much each floor blocks the signal. | `adaptive_floor_detection` |

### Settings → Tracking → Receivers

| Card: control | Default | Range or choices | What it does | Key |
|---|---|---|---|---|
| Bluetooth refresh interval: Refresh interval | 5 | 1 to 60 | Seconds between PadSpan's reads of every receiver's list. | `ble_reseed_interval_s` |
| Bluetooth refresh interval: Refresh every 5 s for passive proxy scanners | off | on or off | Reads every 5 seconds whatever the interval, for Shelly and other passive receivers. | `aggressive_ble_reseed` |
| Receiver signal adjustments | empty |  | A trim in dB for each receiver's readings. | `scanner_offsets` |

### Settings → Tracking → Performance

| Card: control | Default | Range or choices | What it does | Key |
|---|---|---|---|---|
| Presence Poll Interval: Poll interval | 5 | 1 to 60 | Seconds between room updates. Lower is quicker and uses more CPU. | `presence_poll_interval_s` |
| CPU Mode | `shared` | `shared`, `single`, `dedicated` | Where the room work runs: with Home Assistant (`shared`), held to one core (`single`) or on a core of its own (`dedicated`). | `cpu_mode` |
| Low-memory mode | off | on or off | Holds less, for a machine with 2 GB of memory. | `low_memory_mode` |
| Optimize for scale | off | on or off | For several wall screens: a lighter feed for the screens and no updates for a hidden page. | `optimize_for_scale` |

### Settings → Tracking → Home Assistant and integrations

| Card: control | Default | Range or choices | What it does | Key |
|---|---|---|---|---|
| GPS Bridge: Origin latitude | not set | -90 to 90, or empty | With the longitude: where the layout's zero point is on Earth, so trackers report a latitude and longitude. Both empty: off. | `fabric_origin_lat` |
| GPS Bridge: Origin longitude | not set | -180 to 180, or empty | See Origin latitude. | `fabric_origin_lon` |
| GPS Bridge: Bearing (°) | 0 | 0 to 360 | Which way the layout's up points, in degrees clockwise from true north. Live Aboard's North is the same setting. | `fabric_bearing_deg` |
| Automations | not set |  | Simple arrive and depart rules that turn a light, switch, scene or script on or off. | `padspan_automations` |
| HA Tags Integration: Room-change tag events | off | on or off | A tag scan and a `padspan_room_change` event each time a followed device changes room. | `tags_room_events_enabled` |
| HA Tags Integration: NFC tap-to-identify | off | on or off | Scanning an NFC tag names the strongest unnamed Bluetooth signal in that phone's room. | `tags_nfc_identify_enabled` |
| HA Tags Integration: Phone auto-link on NFC scan | off | on or off | A phone that scans any NFC tag is followed by its BLE Transmitter. | `tags_phone_autolink_enabled` |
| Ignore Bermuda: Ignore all Bermuda integration data | off | on or off | Experimental: PadSpan uses nothing from the Bermuda integration. | `bermuda_ignore` |

### Settings → Tracking → Privacy, updates and feedback

| Card: control | Default | Range or choices | What it does | Key |
|---|---|---|---|---|
| Update Check | on | on or off | The daily check for a new version ([chapter 3](03-install-update-uninstall.md)). | `update_check_enabled` |
| Enhanced security | off | on or off | Only an administrator can change PadSpan's shared setup. On for a new install; a home set up before November 2026 keeps what it had. | `enhanced_security` |
| Help improve PadSpan | off | on or off | The opt-in daily usage report. A free licence (trial, tester, free year) keeps it on until the licence ends. | `telemetry_enabled` |
| Help improve PadSpan: Where you heard of PadSpan | empty |  | Your answer, one word from a fixed list, sent with the report. Empty: not said. | `telemetry_heard` |

### Settings → Features

| Card: control | Default | Range or choices | What it does | Key |
|---|---|---|---|---|
| PadSpan licence | empty |  | Your licence key. Kept through a Factory Reset. | `forensics_license_key` |
| PadSpan licence | empty |  | The name you gave this home among your licence's homes. | `license_home_label` |
| Experimental Features: Walk-to-Identify | off | on or off | Finds which unknown device is yours by walking into a room. | `walk_to_identify_enabled` |
| Experimental Features: Radio Map | off | on or off | A signal-strength overlay on the floor plans, from calibration. | `radio_map_enabled` |
| Experimental Features: Signal distortion map | off | on or off | Shows where calibration and live readings disagree. | `distortion_map_enabled` |
| Experimental Features: RoomPlan Import | off | on or off | Mapping → Layout can import an Apple RoomPlan scan. | `roomplan_import_enabled` |
| Experimental Features: Robot Vacuum Import | off | on or off | Mapping → Layout can import a robot vacuum's map as a floor plan. | `vacuum_import_enabled` |
| Experimental Features: Phone Setup Wizard | off | on or off | A guided phone setup in the IRK Manager. | `phone_wizard_enabled` |
| Experimental Features: iPhone Setup Path | off | on or off | iPhones get the steps for their key (IRK). On for a new install. | `iphone_irk_guide` |
| Experimental Features: MAC Rotation Bridging | off | on or off | Links a device's old and new address when its address changes. | `mac_rotation_bridging` |
| Experimental Features: Apple Device Classification | off | on or off | Says whether an Apple Find My signal is an AirTag, a Find My accessory or an Apple device. Display only. | `apple_auto_classify` |
| Experimental Features: RSSI Vector Capture | off | on or off | A Record button in Health for signal recordings to replay. | `rssi_capture_enabled` |
| Forensics | off | on or off | Pro: records when every Bluetooth device nearby comes and goes, to look back at later. | `forensics_enabled` |
| Forensics: Keep sessions for | 14 | `7`, `14`, `30`, `60`, `90` | Days Forensics keeps what it recorded. | `forensics_retention_days` |

### Settings → AI

| Card: control | Default | Range or choices | What it does | Key |
|---|---|---|---|---|
| Your AI: AI Task | empty |  | The Home Assistant AI Task PadSpan asks to read a photo or a plan. Empty: none, and nothing is read. | `atlas_3d_ai_task_entity` |
| Your AI: Backup AI task | empty |  | Used when the main AI Task can't be reached. | `atlas_3d_ai_task_backup_entity` |
| Your AI: Your monthly credit, US$ | 0 | 0 (off), or 0.01 to 100 000 | Your AI's monthly credit, for the use line. 0: none. | `ai_credit_month_usd` |
| Your AI: Warn me | 0 | `0` (off), `50`, `75`, `90` | One notice a month once this share of the credit is used. | `ai_credit_warn_pct` |
| What it does for you: AI map-building research (experimental) | off | on or off | Shows the stair finder and the Plans tool. | `ai_plans_enabled` |
| What it does for you: Stairs from your floor plans | off | on or off | Live Aboard's Furnish can have your AI read the stairs off the plans. | `ai_stairs_enabled` |
| What it does for you: Furniture from a photo | on | on or off | Live Aboard's Furnish can fill in a piece from a photo. | `ai_photos_enabled` |
| What it does for you: Build from plans: advanced plan alignment (Claude, experimental) | off | on or off | Lines up plans and rooms with Claude Opus 5.5 or newer. Needs AI map-building research on. | `ai_plan_build_enabled` |

### Settings → Atlas

| Card: control | Default | Range or choices | What it does | Key |
|---|---|---|---|---|
| Atlas — Mapped Light Control: Show the Atlas in the Home Assistant sidebar | on | on or off | The Atlas's own sidebar entry. Takes a Home Assistant restart. | `lights_panel_enabled` |
| Atlas — Mapped Light Control: Show the Test emergency lighting button on the Atlas | on | on or off | The Atlas's Test emergency lighting button. | `atlas_emergency_button` |
| Atlas — Mapped Light Control: Draw lit lights in their own colour on the Atlas | off | on or off | Lit lights in the colour they report. Off: amber. | `atlas_live_colours` |
| Atlas — Mapped Light Control: Alert pulse | off | on or off | Rings an opening left open, or open in the rain, and names the worst alert. | `atlas_alert_pulse` |
| Atlas — Mapped Light Control: Heatmap chip on the Atlas (temperature, humidity, CO₂) | off | on or off | A Heatmap chip on the Atlas: rooms coloured by their own sensors. | `atlas_heatmap_enabled` |
| Power teams | empty |  | Each wall dimmer or switch and the smart bulbs it feeds, as one light ([chapter 14](14-home-assistant-reference.md)). | `power_teams` |
| Outdoor weather: Show rain and snow on the Atlas | on | on or off | Rain or snow around the house while it really rains or snows. | `atlas_weather_enabled` |
| Outdoor weather: Rain sensor | empty | an entity: `binary_sensor.*` or `sensor.*`, or empty | A rain sensor that says when it is wet. Empty: the weather entity decides. | `atlas_weather_rain_entity` |
| Outdoor weather: Weather entity | empty | an entity: `weather.*`, or empty | The weather entity, for rain or snow. Empty: the first one Home Assistant has. | `atlas_weather_condition_entity` |
| Outdoor weather: Weather warnings | empty | an entity: `binary_sensor.*` or `sensor.*`, or empty | A weather-warning sensor. Empty: found by itself. | `atlas_weather_warning_entity` |
| Outdoor weather: Strength | 1 | 0.5 to 1.5 | How strongly the rain or snow is drawn. | `atlas_weather_strength` |
| Live Aboard: Show Live Aboard on the Atlas | off | on or off | Pro: the 3D house. Off: no 3D, no Furnish, nothing written or read. | `atlas_3d_enabled` |
| Live Aboard: Quality | `auto` | `auto`, `low`, `high` | How much the 3D house draws: picked for the screen, low or high. | `atlas_3d_quality` |
| Live Aboard: Look | `atlas` | `atlas`, `own`, `studio` | The same look as the Atlas, Live Aboard's own colours, or Studio. | `atlas_3d_look` |
| Live Aboard: Back to home view | 60 | `0`, `30`, `60`, `300` | Seconds untouched before the sidebar's Live Aboard goes back to its home view. 0: never. | `atlas_3d_home_idle_s` |
| Live Aboard: Show people | off | on or off | People in the 3D house. | `atlas_3d_people` |
| Live Aboard: Show tags & scanners | off | on or off | Every placed tag and receiver in the 3D house. | `atlas_3d_tags` |
| Live Aboard: Rain and snow | on | on or off | Rain and snow in Live Aboard, while Outdoor weather is on too. | `atlas_3d_weather` |
| Live Aboard: Fly to when it goes off | empty |  | Doorbells, doors, sensors or alarms the view flies to when they go off. | `atlas_3d_director` |
| Live Aboard: Fly to when they arrive | empty |  | People and tags the view flies to when they come into a room. | `atlas_3d_director_people` |
| Live Aboard: Use the shared furniture library | off | on or off | Swaps furniture with other PadSpan homes. Off unless an administrator turns it on. | `atlas_3d_library` |
| Wall screens: Screen size | 0 | 0 (off), or 10 to 120 | The wall screen's diagonal in inches. 0: sized from the screen's resolution. | `wall_screen_in` |
| Wall screens: Viewing distance | 2.5 | 0.3 to 10 | How far away people stand, in metres. | `wall_distance_m` |
| Wall screens: Text size | 20 | 14 to 36 | How big text looks from there (minutes of arc). | `wall_text_arcmin` |
| Wall screens: Dim at night | 0 | 0 to 0.7 | How much darker after sunset (0 to 0.7). | `wall_night_dim` |
| Wall screens: Protect against burn-in | off | on or off | Moves the picture a few pixels every few minutes (OLED screens). | `wall_pixel_shift` |
| Wall screens: Show each floor | 0 | 0 (off), or 10 to 600 | Seconds between floors while nobody touches the wall. 0: off. | `wall_floor_cycle_s` |
| Wall screens: On Fully Kiosk tablets | off | on or off | Dims by the tablet's own brightness, and its motion detection turns the screen on. | `wall_fully` |
| Overview — the Atlas as your main map: Show the Atlas as Overview | off | on or off | Pro: the Overview shows the Atlas; the classic Overview is under Live Tracker. | `overview_atlas` |

### Settings → UI Structure

| Card: control | Default | Range or choices | What it does | Key |
|---|---|---|---|---|
| UI Structure | empty |  | Screens moved from More tools into the main list in Advanced and Development mode. | `advanced_extra_tabs` |
| Edition & tier: Look at this install as tier: | empty | `free`, `bright`, `pro` | Shows the panel as a lower tier would (`free`, `bright`); empty: as it is. | `license_tier_override` |
| Edition & tier: Show the presence tabs too (Overview, Follow, Calibration, …) | off | on or off | PadSpan Bright only: shows the presence screens. | `bright_reveal_presence` |
<!-- /generated:settings -->

## On other screens

Settings PadSpan keeps for a control on another screen. Each is saved when you use that control.

<!-- generated:elsewhere (scripts/build_manual_reference.py) -->
| Where | Card: control | Default | Range or choices | What it does | Key |
|---|---|---|---|---|---|
| Overview | Preview a finished house | `sample` | `sample`, `live` | `live`: your own house. `sample`: the sample house (**Back to my house** returns). A new install switches to live as soon as a receiver is heard. | `data_mode` |
| Overview | Walls | off | on or off | Draws the signal walls over the map. | `overview_show_walls` |
| Overview | Trails | off | on or off | A fading trail behind each device. | `overview_show_trails` |
| Overview | Pins | off | on or off | Keeps away devices at their last place on the map. | `overview_persistent_pins` |
| Overview | Outdoor | off | on or off | Draws sheds, driveways and other outdoor areas, fitted into the house's footprint. | `overview_show_outdoor` |
| Overview | Heat: Gain | 0 | -20 to 20 | The Radio Map overlay's gain. | `heatmap_gain` |
| Overview | Heat: Contrast | 0 | -15 to 15 | The Radio Map overlay's contrast. | `heatmap_contrast` |
| Overview | Warp | 50 | 0 to 100 | How strongly the signal distortion map is drawn. | `distortion_intensity` |
| Overview | Heat: Source | 0 | 0 to 100 | Which readings the Radio Map overlay draws from. | `heatmap_source` |
| Follow | Follow | empty |  | The devices you follow. Following a device with no name gives it one. | `followed_addrs` |
| Locate | Locate: You | empty |  | Pro: which device is you, for directions. | `locate_self_key` |
| Bluetooth | Scanners: Exclude | empty |  | Receivers left out of positioning. Nothing they recorded is deleted. | `excluded_scanners` |
| Bluetooth | Scanners: Min signal: off | empty |  | For each receiver, readings weaker than this are ignored. | `scanner_min_rssi` |
| Calibration | Beacon Tune: Auto-Cal | on | on or off | Pinned beacons add calibration points by themselves. | `beacon_auto_calibrate` |
| Devices | Door Openers | empty |  | Entities marked as door or window openers. | `door_opener_ids` |
| Devices | Door Openers | empty |  | What each opener built from relays made in Home Assistant, so Remove deletes exactly that. | `door_composites` |
| Traceback | Full house activity | 0 | 0 to 64 | The floor Full house activity opens on. | `traceback_house_focus` |
| Traceback | Mark as stationary reference (known-fixed device for accuracy monitoring) | not set | a list | Devices that never move, used to watch accuracy. | `distance_stationary_devices` |
| Occupancy | Hybrid counting | on | on or off | Counts people from sensors as well as phones. Off: phones only. | `occupancy_hybrid_enabled` |
| Occupancy | Phone clustering | not set | 2 to 30 | How close phones must be to count as one person. | `occupancy_cluster_threshold` |
| Manage → HA Entities | Entity Publishing Controls: device_tracker.{label} | on | on or off | A tracker for each named device. | `ha_entity_tracker_enabled` |
| Manage → HA Entities | Entity Publishing Controls: sensor.{label}_area | on | on or off | An area sensor for each named device. | `ha_entity_area_enabled` |
| Manage → HA Entities | Entity Publishing Controls: sensor.{label}_distance | on | on or off | A distance sensor for each named device. | `ha_entity_distance_enabled` |
| Manage → HA Entities | Entity Publishing Controls: sensor.{label}_distance_{scanner} | on | on or off | A distance sensor for each named device and receiver. | `ha_entity_scanner_distance_enabled` |
| Manage → HA Entities | Entity Publishing Controls: sensor.padspan_occupancy_occupancy | off | on or off | The house's occupancy sensor. Takes a reload. | `ha_entity_occupancy_enabled` |
| Manage → HA Entities | Entity Publishing Controls: binary_sensor.padspan_{sub-zone}_occupied | off | on or off | Sub-zones: the Sub-zones tool in Mapping → Edit, and two entities for each. | `subzones_enabled` |
| Manage → HA Entities | MQTT Publishing: Enable experimental MQTT publishing | off | on or off | Publishes each named device to MQTT ([chapter 14](14-home-assistant-reference.md)). | `mqtt_publish_enabled` |
| Manage → HA Entities | ESPresense MQTT: Enable ESPresense MQTT ingestion | off | on or off | Reads ESPresense receivers over MQTT. | `espresense_mqtt_enabled` |
| Manage → HA Entities | ESPresense MQTT: Topic prefix: | `espresense` |  | The MQTT topic ESPresense publishes under. | `espresense_topic_prefix` |
| Manage → HA Entities | Import from ESPresense Companion: Companion URL: | empty |  | ESPresense Companion's address, for importing from it. | `espresense_companion_url` |
| Manage → HA Entities | Tasmota BLE: Read Tasmota BLE over MQTT | off | on or off | Experimental: Tasmota devices as receivers, over MQTT. | `tasmota_ble_enabled` |
| Manage → Beacon Characteristics | Beacon Signal Profiles: Beacon profiles | on | on or off | Shows or hides the beacon profiles report. | `beacon_profiling_enabled` |
| Manage → Beacon Characteristics | Beacon Signal Profiles | empty | a list | Beacons left out of calibration tuning. | `beacon_tune_disabled` |
| Manage → Beacon Characteristics | Beacon Signal Profiles | empty | a mapping | Beacons moved to another model group. | `beacon_group_overrides` |
| Mapping → Atlas builder | Classic layout | on | on or off | On: the Atlas's new layout (wall screens need it). Off: the classic layout. | `atlas_layout_v2` |
| Mapping → Atlas builder | Showcase | off | on or off | Pro: the Atlas's presentation look. | `lights_showcase` |
| Mapping → Atlas builder | Showcase: Theme | `classic` | `classic`, `cinematic_glass`, `neo_hud`, `ambient_premium`, `dataviz_precision`, `organic_bioluminescent`, `material_you`, `neon_precision`, `luxury_realestate`, `wabi_sabi`, `hygge`, `aurora`, `automotive_hud`, `art_deco`, `swiss_style`, `bauhaus`, `holographic`, `retro_futurism`, `obsidian_noir`, `west_coast_forest` | Showcase's theme. | `lights_showcase_theme` |
| Mapping → Atlas builder | Showcase: Fit room | off | on or off | Never draws a light bigger than its room. | `lights_fit_rooms` |
| Mapping → Atlas builder | Showcase: Light spread | off | on or off | Lines of equal light on the floor. | `lights_isolux` |
| Mapping → Atlas builder | Hide untouched | off | on or off | Draws only lights that were set up (sized, turned, coloured or shaped). | `lights_hide_untouched` |
| Mapping → Atlas builder | Hide device codes | off | on or off | Hides each marker's A01-style code. | `lights_hide_device_codes` |
| Mapping → Atlas builder | Show beacons | off | on or off | Shows working, named beacons on the Atlas. | `lights_show_beacons` |
| Mapping → Atlas builder | Automorph | off | on or off | Pro: a glow from each light out into its room. | `lights_automorph_enabled` |
| Mapping → Atlas builder | Automorph | 0 | 0 to 100 | How far each glow grows toward its room's shape. | `lights_automorph_room_pct` |
| Mapping → Atlas builder | Automorph: Hardness | 0 | -100 to 100 | Sharper (below 0) or smoother (above 0) glow edges. | `lights_automorph_hardness` |
| Mapping → Atlas builder | Automorph: Style | `glow` | `glow`, `blueprint`, `nebula`, `halo`, `spikecrown`, `scallop`, `bloomflower`, `geode`, `honeycomb`, `extrude`, `shardburst`, `origami`, `inkbleed`, `rosette`, `lensflare`, `mycelium` | The glow's style. | `lights_automorph_style` |
| Mapping → Atlas builder | Automorph: Subtlety | 0 | 0 to 100 | How faint the glow is. | `lights_automorph_subtlety` |
| Mapping → Atlas builder | Presets | empty |  | Saved looks: theme, Automorph and display choices, by name. | `lights_showcase_presets` |
| Mapping → Atlas builder | Whole house | empty |  | Saved states of every light and fan, by name. | `whole_house_presets` |
| Mapping → Atlas builder | Vacation Mode | off | on or off | Switches lights as on an ordinary day, learned from Home Assistant's history. | `vacation_mode_enabled` |
| Mapping → Atlas builder | Vacation Mode: Intensity | 100 | 5 to 100 | How much of the usual lighting it switches. | `vacation_mode_intensity` |
| Mapping → Atlas builder | Vacation Mode | `last_week` | `last_week`, `month` | Each day's routine: the same day last week, or that weekday's average over the last month. | `vacation_mode_source` |
| Mapping → Atlas builder | Vacation Mode: Only after dark | off | on or off | Lights only after sunset. | `vacation_mode_dark_only` |
| Mapping → Atlas builder | Vacation Mode: Only after dark | 0 | -60 to 120 | How long after sunset, in minutes. | `vacation_mode_dark_offset_min` |
| Mapping → Atlas builder | Vacation Mode: Ends | 0 |  | When the trip ends and Vacation Mode turns itself off. 0: no end. | `vacation_mode_end_at` |
| Mapping → Atlas builder | Vacation Mode: Pause while someone is home | off | on or off | Switches nothing while anyone is home. | `vacation_mode_pause_home` |
| Mapping → Atlas builder | Vacation Mode: Bedtime | empty |  | Lights off from this time (HH:MM, 17:00 to 03:00). | `vacation_mode_bedtime` |
| Mapping → Atlas builder | Vacation Mode: Longest on | 0 | 0 (off), or 15 to 720 | Minutes a light it turned on stays on at most. | `vacation_mode_max_on_min` |
| Mapping → Atlas builder | Vacation Mode: Most lights on at once | 0 | 0 (off), or 1 to 50 | Lights on at once, at most. | `vacation_mode_max_lights` |
| Mapping → Atlas builder | Vacation Mode: Evening lights | empty |  | Up to 10 lights held on through the evenings they were really on. | `vacation_mode_anchors` |
| Mapping → Atlas builder | Atlas builder | empty |  | Each light's marker shape. | `light_shapes` |
| Mapping → Atlas builder | Atlas builder | empty |  | Pro: a light forced to be drawn as WLED, a partition or plain. | `light_type_overrides` |
| Mapping → Atlas builder | Atlas builder | not set | a list | Lights hidden from the Atlas. | `lights_hidden` |
| Mapping → Atlas builder | Save view | 150 | 60 to 340 | Space between floors on the Overview and the Atlas. | `overview_iso_floor_gap` |
| Mapping → Atlas builder | Save view | 0 | -120 to 120 | Sideways offset between floors. | `overview_iso_horiz_gap` |
| Mapping → Atlas builder | Save view | not set |  | The one floor shown; empty: all floors. | `overview_iso_focus` |
| Mapping → Atlas builder | Save view | 1 | 0.4 to 2.5 | The Atlas's zoom. | `overview_iso_zoom` |
| Mapping → 3D Stack | 3D Isometric Preview | 200 | 60 to 340 | Space between floors in the preview. | `maps_iso_floor_gap` |
| Mapping → 3D Stack | 3D Isometric Preview | 0 | -120 to 120 | Sideways offset between floors in the preview. | `maps_iso_horiz_gap` |
| Mapping → 3D Stack | 3D Isometric Preview: All floors | not set |  | The one floor shown; empty: all floors. | `maps_iso_focus` |
| Mapping → 3D Stack | Floor Assignment & Ceiling Heights | empty | a list | Floor plans hidden from the 3D stack. | `hidden_map_ids` |
| Live Aboard → Furnish | People & devices | empty |  | Who carries which phone or tag. Kept in this home only. | `atlas_3d_carries` |
<!-- /generated:elsewhere -->

## Not in the panel

Settings with no control in the panel: one a service changes, a few the panel never shows (they
can only be changed by a command, or are kept for older versions), and the ones PadSpan keeps for
itself (when it last checked, what it has asked, what it has learned). You never need to set these.

<!-- generated:not-in-panel (scripts/build_manual_reference.py) -->
### Changed by a service

| Key | Default | Range or choices | What it is |
|---|---|---|---|
| `room_tag_map` | empty |  | The objects that belong in each room: set by `padspan_ha.set_room_tag_map`. |

### Not shown in the panel

| Key | Default | Range or choices | What it is |
|---|---|---|---|
| `excluded_objects` | empty |  | Devices dropped as they arrive, by their lasting key (never a MAC): no cost, no history. |
| `ingest_rules` | empty |  | Rules that drop or keep devices as they arrive, by key, UUID, maker or address. |
| `espresense_room_map` | empty | a mapping | ESPresense room names matched to Home Assistant areas. |
| `atlas_3d_showcase` | off | on or off | An older Live Aboard look switch, kept so old backups load; Look decides now. |
| `emergency_entities` | empty |  | The lights the Atlas's emergency lighting test switches. Empty: Home Assistant's emergency groups, or PadSpan's own rule. |
| `auto_offset_mode` | not set | `off`, `partial`, `full` | Accepted but nothing reads it: only the manual receiver trims are applied. |
| `signal_loss_linger_s` | not set | 10 to 300 | Retired in 0.20.16: accepted, read by nothing. |
| `rssi_capture_retention_days` | 14 | `1`, `3`, `7`, `14`, `30` | Days RSSI recordings are kept (RSSI Vector Capture). |

### Kept by PadSpan itself

| Key | Default | Range or choices | What it is |
|---|---|---|---|
| `onboarding_completed` | off | on or off | The first-run setup was finished. |
| `setup_progress` | not set |  | Where Setup has got to. |
| `accuracy_tips_hidden` | not set |  | The Improve accuracy tips you closed. |
| `health_reminder_last_ts` | not set |  | When the calibration reminder last showed. |
| `ai_map_wizard` | empty |  | Let Claude draw your rooms: whether it was started, put off or finished. |
| `onboarding` | empty |  | A new install's first steps and how long they took. |
| `telemetry_asked` | off | on or off | The panel has asked about the usage report once. |
| `telemetry_heard_ask` | empty |  | Whether the where-did-you-hear question is due, or done. |
| `telemetry_install_id` | empty |  | The usage report's random install id (Settings → Tracking → Privacy, updates and feedback → Help improve PadSpan replaces it). |
| `telemetry_last_day` | empty |  | The day the last usage report was sent. |
| `report_locked_key` | empty |  | Which free licence keeps the usage report on. |
| `whatsnew_seen_version` | empty |  | The last version whose update card someone saw. |
| `first_seen_ts` | 0 |  | When PadSpan first ran here. |
| `calibration_points_seen` | 0 |  | Calibration points at the last report. |
| `maps_seen` | 0 |  | Floor plans at the last report. |
| `trial_nudge_done` | off | on or off | The trial card was answered. |
| `tester_nudge_done` | off | on or off | The tester card was shown. |
| `launch_card_done` | off | on or off | The launch-price card was shown. |
| `tester_signup` | empty |  | Your tester sign-up, so you can update or withdraw it. |
| `pro_invite` | empty |  | An invite to free Pro, and your answer. |
| `server_offers` | empty |  | Which free-Pro offers the update check last said are on. |
| `flood_latches` | empty |  | Leak alarms the Atlas keeps showing until cleared. |
| `lights_showcase_seen` | off |  | Showcase has been on here. |
| `wled_teams` | empty |  | WLED devices that act as one light. |
| `power_teams_woke` | empty |  | Each power team's last wake-up day, so a restart never wakes it twice. |
| `power_teams_slept` | empty |  | Each power team's last bedtime day, so a restart never runs it twice. |
| `room_speed_v1_applied` | off |  | The November 2026 room-speed defaults were applied once. |
| `atlas_default_v1_applied` | off |  | The Atlas's sidebar entry was switched on once, by default. |
| `server_checked_at` | 0 |  | When the update check and licence check last ran. |
| `forensics_license_expires` | empty |  | When the licence ends, as the licence server last said. |
| `license_is_trial` | off |  | The key is a trial key. |
| `license_home_token` | empty |  | This home's token from the licence server. |
| `license_home_status` | empty |  | The licence server's last word on this home, when it refused it. |
| `license_homes_used` | 0 |  | How many homes the key is on. |
| `license_homes_warning` | empty |  | A warning about a home whose usage report is off. |
| `license_install_id` | empty |  | This install's own id, where Home Assistant's can't be read. |
| `vacation_mode_pattern` | empty |  | Vacation Mode's learned routine. |
| `vacation_mode_pattern_built_at` | 0 |  | When the routine was learned. |
| `vacation_mode_pattern_until` | 0 |  | Where the history it learned from ends. |
| `vacation_mode_enabled_at` | 0 |  | When this vacation started. |
| `vacation_mode_periods` | empty |  | Earlier vacations, left out of what it learns. |
| `vacation_mode_tracked_since` | 0 |  | Since when every vacation is recorded. |
| `vacation_mode_pattern_prev` | empty |  | The last routine learned before this vacation. |
| `vacation_mode_pattern_attempt` | `[0, 0]` |  | The last try at learning that found nothing. |
| `vacation_mode_pattern_for` | 0 |  | Which vacation a carried-over routine serves. |
| `vacation_mode_last_off` | empty |  | Who turned Vacation Mode off last, and how. |
| `vacation_mode_trip_source` | empty |  | The routine source this trip started with. |
| `vacation_mode_pattern_source` | empty |  | The source the routine was learned from. |
| `vacation_mode_pattern_prev_source` | empty |  | The source the last routine was learned from. |
| `vacation_mode_pattern_end` | 0 |  | Where a resumed trip's routine is learned again from. |
<!-- /generated:not-in-panel -->
