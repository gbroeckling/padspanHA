// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
// See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
// PadSpan HA — User-facing help content
// Each entry: { title, body: string[] }
// Opened by the ? help buttons in Basic, Advanced, and Development modes.

export const HELP = {

  // ── Follow ──────────────────────────────────────────────────────────────────
  follow: {
    title: "Follow — Track a tag in real time",
    body: [
      "The Follow page lets you watch exactly where a specific person or object is right now.",
      "Pick any tracked tag from the dropdown — a phone, key fob, AirTag, Tile tracker, or anything Bluetooth. PadSpan™ shows you which room it's currently in, how strong the signal is, and which of your scanners can see it.",
      "The location updates automatically every few seconds. You don't need to refresh the page.",
      "Click Details → in the status card to open the full device detail view — per-scanner RSSI, signal history, and quick access to Tag/Relabel.",
    ],
  },
  follow_selector: {
    title: "Choosing which tag to follow",
    body: [
      "The dropdown is sorted by signal strength, strongest first — so whatever's closest right now tends to be near the top, not whatever has a name.",
      "Give an unnamed device a friendly name (like 'Alice's Phone' or 'Car Keys') using the Tag button in the Objects section, so it's easier to pick out of the list.",
      "In Quiet Mode, unidentified and unfollowed devices are left out of the dropdown entirely — turn Quiet Mode off if you're looking for one that isn't there.",
      "If a device shows 'not_home' or is missing from the list, it hasn't been detected recently. It may have left range or gone away. Check the Objects tab for the red Away badge and its last known location.",
    ],
  },
  follow_map: {
    title: "Location map — Where is the tag right now?",
    body: [
      "The map shows every room in your home and highlights the tracked tag's current location with a bright pulsing dot.",
      "Green antenna rings inside rooms show where your Bluetooth scanners (radios) are placed.",
      "The more scanners that can detect the tag, the more accurately PadSpan can pinpoint the location.",
      "The map refreshes automatically every few seconds — no manual refresh needed.",
    ],
  },
  follow_alerts: {
    title: "Movement alerts — Get notified when a tag moves",
    body: [
      "PadSpan can send you an email every time a tracked tag moves from one room to another.",
      "Enter the email address where you want notifications sent, check the box to turn it on, then click Save — nothing is active until you save it.",
      "You can also choose specific rooms to watch — for example, get an alert only when a tag enters the front hallway.",
      "Emails are sent through Home Assistant's built-in notification system. If emails aren't arriving, check that a notification service (like Gmail or SMTP) is configured in HA Settings → Integrations.",
    ],
  },

  // ── Overview ─────────────────────────────────────────────────────────────────
  overview: {
    title: "Overview — Your home at a glance",
    body: [
      "Overview shows a live diagram of all your rooms with your Bluetooth scanners and tracked objects displayed inside them.",
      "Think of it as your home's control tower — a quick snapshot of where everything is right now.",
      "Each box is a room from your Home Assistant Areas & Zones. Green antenna icons are your Bluetooth radios. Coloured dots are tracked people or objects.",
      "In Advanced or Development mode, use the buttons below the KPI row — View rooms list, All objects / Unidentified, View radios list — to see a full list. Click any row in that list for detailed info on that item.",
    ],
  },
  overview_grid: {
    title: "The map — What you're seeing",
    body: [
      "Once you have traced your rooms in Mapping, Overview draws the floors as a 3D stack. Each room uses its own colour, and rooms sharing a wall join into one clean shape.",
      "Bluetooth scanners appear as fixed-size rings — colour, not size, tells you their state: green for online and reporting, dim grey for offline. A pulsing red ring means the scanner is actively mid-scan.",
      "Coloured dots are tracked objects. Followed (starred) devices always draw as an amber marker, even when away (it just dims). Teal dots are identified/tagged devices; orange dots are unrecognised Bluetooth signals.",
      "Before any floor plan has real room geometry, Overview falls back to a flat grid of coloured boxes instead — one per room, with a count badge in the corner showing scanners and objects in it. That's the fallback view, not the everyday one.",
      "The map refreshes every 5 seconds in Live mode.",
    ],
  },

  // ── Objects ───────────────────────────────────────────────────────────────────
  objects: {
    title: "Objects — Everything being tracked",
    body: [
      "Objects lists Bluetooth devices your scanners have detected — phones tracked by Home Assistant, Tile trackers, key fobs, AirTags, and anything else broadcasting BLE. By default only devices seen in the last 4 hours are shown; widen the History filter to go further back.",
      "Badge colours tell you the device type: green BLE = standard Bluetooth device, orange BLE? = unidentified, blue Private BLE = phone using rotating MAC address (resolved automatically via IRK), amber iBeacon = Tile / HA Companion App iBeacon grouped by stable UUID. AirTags (purple Find My badge) rotate both their MAC and their advertised key every ~15 min and do NOT have a stable identifier — see the Naming help below for what works.",
      "A red Away badge appears when a BLE device hasn't been seen for longer than the configured away timeout (default 5 min). 'Last: Kitchen' shows where it was last detected. The corresponding device_tracker entity in HA also shows not_home.",
      "Basic mode shows one card per device; click its Details button to open the full detail panel. Advanced/Development mode instead shows a sortable table with a search box (find a device by name, address, company, or device type — try 'apple' or 'tile') and the extra company/device-type/service badges decoded from its BLE advertisement; click anywhere on a row to open the same detail panel.",
    ],
  },
  objects_tag: {
    title: "Naming (tagging) a device",
    body: [
      "When PadSpan detects a Bluetooth device it doesn't recognise, it shows a hardware address like AA:BB:CC:11:22:33.",
      "Click the 'Tag' button next to any device to give it a friendly name — for example 'Backpack Tile', 'Car Keys', or 'Cat Collar'. Click Save. The name is stored permanently in Home Assistant.",
      "Once tagged, the name appears everywhere in PadSpan — on the Overview map, the Follow tracker, and all other pages. PadSpan also creates a device_tracker entity (e.g. device_tracker.car_keys) and an area sensor (e.g. sensor.car_keys_area) in Home Assistant for use in automations.",
      "What sticks across rotations: Tile/Chipolo and HA Companion-App iBeacons broadcast a stable UUID, so the tag follows them forever. Phones use IRK resolution (Bluetooth → IRK Manager) to bind a friendly name to the rotating address. AirTags / Samsung SmartTags are the hard case — they rotate both MAC and advertised key with no stable identifier. Enable Settings → Features → MAC Rotation Bridging + Apple Device Classification to get probabilistic tracking; the tag will follow the AirTag while it stays in continuous range but may break across long absences.",
      "You can rename a device at any time by clicking 'Relabel'. To remove a tag entirely, go to the sidebar Manage view → BLE Tags.",
    ],
  },

  // ── Maps ─────────────────────────────────────────────────────────────────────
  maps: {
    title: "Mapping — Floor plans for your home",
    body: [
      "The Mapping section lets you upload photos or scans of your home's floor plans.",
      "Once uploaded, your floor plan shows the rooms alongside your Bluetooth scanner layout, helping you visualise coverage and plan where to add more scanners.",
      "You can upload one floor plan per floor — for example 'Ground Floor', 'Upper Floor', and 'Basement'.",
    ],
  },
  maps_library: {
    title: "Map library — Your uploaded floor plans",
    body: [
      "The library shows all the floor plans you've uploaded.",
      "In Sample mode, a demonstration home (Smith Residence) is shown so you can explore how the feature works without uploading anything.",
      "Switch to Live mode and go to the Upload tab to add your own floor plans.",
    ],
  },
  maps_upload: {
    title: "Uploading a floor plan",
    body: [
      "You can upload any floor plan image — PNG, JPG, or even a photo you took of a hand-drawn plan.",
      "Give the map a name (like 'Ground Floor'), then pick your image file and click Upload & Convert.",
      "PadSpan automatically resizes and stores the image in Home Assistant so it loads quickly.",
      "Tip: a photo of your architect's drawing or even a rough sketch works great.",
    ],
  },
  // ── Settings ─────────────────────────────────────────────────────────────────
  settings: {
    title: "Settings — Customise PadSpan™",
    body: [
      "In Advanced or Development mode, Settings has tabs: Appearance, Scanner Map, Presence, Features, and UI Structure.",
      "Appearance — change room colours. Your floors and rooms are read from HA; add or rename them in HA Settings → Areas & Zones.",
      "Scanner Map — see estimated scanner positions on your floor plans, derived from calibration fingerprint data.",
      "Presence — tune room-switching speed and set the Home/Away timeout.",
      "Features — turn on experimental features, and the PadSpan Pro licence and Forensics cards live here too.",
      "UI Structure — choose which extra tabs appear in Advanced mode. All tabs are always visible in Development mode.",
      "In Basic mode only the Appearance tab is shown.",
    ],
  },
  settings_colors: {
    title: "Room colours — Pick a colour for each room",
    body: [
      "Each room has a colour used across all of PadSpan's maps and diagrams.",
      "Click the coloured square (■) next to a room name to open the colour picker and choose a new colour.",
      "Click 'Save floors & room settings' when you're done — your choices are stored in Home Assistant and will be remembered next time.",
    ],
  },
  settings_manage: {
    title: "Untagging devices and deleting rooms",
    body: [
      "Settings doesn't have its own Manage tab — for this, open the separate Manage entry in the sidebar (Advanced and Development modes).",
      "BLE Tags — every named BLE device is listed with its address, kind, and last-seen time. Click Untag to remove the friendly name (two-click confirm prevents accidents). The device reverts to its hardware address but continues to be tracked.",
      "Rooms (HA Areas) — lists every area from Home Assistant. Click Delete to remove an area from HA entirely. This also unassigns any scanners in that room. Cannot be undone from within PadSpan — re-add in HA Settings → Areas & Zones if needed.",
      "The Manage sidebar entry also covers deeper data management — orphan cleanup, entity deletion, integration controls, and Factory Reset.",
    ],
  },

  // ── Monitor ────────────────────────────────────────────────────────────────
  monitor: {
    title: "Monitor — System health & analytics hub",
    body: [
      "Monitor has six sub-tabs: Diagnostics, Zones, Insights, Health, Diag Export, and Debug.",
      "Diagnostics — websocket call counts, timing, scanner performance, advertisement freshness, and session info. The Per-Scanner Breakdown table shows each scanner's device count, average RSSI, and quality grade.",
      "Zones — every room as a card sorted by occupancy. Occupied rooms have a coloured border; empty rooms are dimmed. Click a room card to see its detail. Rooms are grouped by floor when configured in HA.",
      "Insights — charts for room occupancy, scanner signal quality, devices moving between rooms, coverage gaps, and devices by type.",
      "Health — the current System Critics results described below. Diag Export — download the current diagnostics as JSON. Debug — show the values the panel is currently using for troubleshooting.",
    ],
  },
  zones: {
    title: "Zones — Every room, at a glance",
    body: [
      "Zones shows one card per room, sorted so the busiest rooms come first. A coloured left border means the room currently has something in it; an empty room's card is dimmed grey.",
      "Each card lists what's in that room — up to 8 objects by name, with signal strength in dBm and a small dot for anything you're following. Click a card, or an object inside it, to open its full detail view.",
      "The badge row at the top counts rooms, occupied rooms, empty rooms, and total tracked objects.",
      "If your Home Assistant floors are set up, rooms are grouped under their floor's name. Quiet Mode (top of Overview) hides unidentified devices here too, showing only tagged and followed objects.",
    ],
  },
  insights: {
    title: "Insights — Rooms, signals and movement",
    body: [
      "Insights turns your tracking data into charts. Room Occupancy is a bar chart of how many objects are currently in each room — click a bar to jump to that room's detail view.",
      "Signal Quality lists every Bluetooth scanner with its device count, average RSSI, and a plain-language grade — Excellent, Good, Fair, or Poor — so you can spot a scanner that needs to move or be replaced.",
      "The remaining charts show devices that move between rooms, rooms with weak coverage, and devices by type.",
      "Quiet Mode filters unidentified devices out of these charts the same way it does everywhere else.",
    ],
  },

  // ── History ────────────────────────────────────────────────────────────────
  history: {
    title: "History — Session event timeline",
    body: [
      "History has two sub-tabs: Session Events and Movement.",
      "Session Events shows every action taken during this browser session — view changes, data refreshes, tagging, and websocket calls. Use the type filter buttons to show or hide specific event types; the timeline is newest-first. This data is session-scoped and resets when you reload the page — it is not stored on the server. Click Clear History to reset it.",
      "Movement is different: it's your saved room-transition history, fetched from the server, and survives a page reload. Use it to see when tracked objects actually changed rooms, not just what happened in this browser session.",
    ],
  },

  // ── Events ─────────────────────────────────────────────────────────────────
  events: {
    title: "Events — Notable activity stream",
    body: [
      "Events shows only the actionable events from your session — tagging, navigation, and data refreshes.",
      "Click a navigation event to jump back to that view.",
      "Unlike History (which logs everything), Events filters to the activity that matters most for understanding what's happened.",
    ],
  },

  // ── QA ─────────────────────────────────────────────────────────────────────
  qa: {
    title: "QA — Configuration quality checks",
    body: [
      "QA runs automated health checks on your PadSpan setup and highlights anything that needs attention.",
      "Config Health — pass/warn/fail checks covering maps, rooms, scanners, BLE feed, tagging, and snapshot availability. A warning gets an amber ⚠️ rather than a hard fail. Failed and warned checks include a fix suggestion.",
      "Data Consistency — detects orphaned objects, unmapped scanners, and rooms without scanner coverage. Click any item to see its detail.",
      "Propagation Health — grades your radio propagation model (A through F) based on room coverage, distance accuracy, fingerprint stability, and floor separation. Click 'More Detail' for per-room and per-scanner breakdowns with improvement recommendations. 'How It Works' shows the underlying math.",
      "Radio Analysis — grades each scanner's hardware, coverage and reliability, and explains why it received that grade.",
      "Data Backup & Recovery — create snapshots of all PadSpan data before enabling experimental features. Restore to roll back if needed. Up to 3 backups are kept.",
      "Quick Actions — refresh the snapshot, export the full panel state as JSON for debugging, or jump to diagnostics.",
    ],
  },

  qa_propagation: {
    title: "Propagation Health — Model quality analysis",
    body: [
      "Propagation Health analyses the quality of PadSpan's underlying radio model \u2014 the math that converts signal strength (RSSI) into room assignments.",
      "The overall grade (A\u2013F) combines four sub-indicators: Model Coverage (% of rooms with learned fingerprints), Distance Accuracy (cross-validation error from calibration data), Fingerprint Stability (variance in adaptive room models), and Floor Separation (signal attenuation between floors).",
      "Click 'More Detail' to see per-room fingerprint quality (how many observations each room has, variance, and stability status) and per-scanner path-loss models (exponent, RSSI@1m, R\u00b2 fit quality).",
      "Improvement recommendations are generated automatically: rooms that need more data, scanners with poor path-loss fits, suggestions to enable adaptive learning or add calibration points.",
      "'How It Works' shows the actual formulas and current parameter values: path-loss distance calculation, Kalman filter settings, and adaptive blending weight.",
      "Reset buttons at the bottom let you clear adaptive learning data (keeps manual calibration) or clear all calibration data (requires typing RESET to confirm).",
    ],
  },

  qa_backup: {
    title: "Data Backup & Recovery",
    body: [
      "The backup system lets you create a full snapshot of all PadSpan configuration and learned data before making changes.",
      "Each backup captures: settings, calibration points, adaptive learning fingerprints, object tags, model data, map metadata, movement history, and follow alert configs.",
      "Up to 3 backups are stored. Creating a 4th automatically removes the oldest. Each backup shows its timestamp, version, and optional note.",
      "Click 'Restore' to overwrite all current data with a backup. The page reloads automatically after restore. Click 'Delete' to remove a backup you no longer need.",
      "Recommended workflow: create a backup before enabling adaptive learning, before major calibration changes, or before upgrading PadSpan.",
    ],
  },

  qa_radio_analysis: {
    title: "Radio Analysis — Per-scanner ranking & health",
    body: [
      "Radio Analysis ranks every Bluetooth scanner by overall quality, combining three scores: Hardware (40%), Coverage (30%), and Reliability (30%).",
      "Hardware Score isolates radio hardware quality from placement. It compares per-device RSSI across scanners that share the same devices \u2014 a radio that consistently reads higher RSSI for shared devices has a better antenna or Bluetooth chipset.",
      "Coverage Score measures how many devices the scanner sees and how many other scanners it overlaps with. High coverage means the scanner reaches broadly across your home.",
      "Reliability Score combines advertisement freshness, RSSI consistency (spread), WiFi signal strength (or wired bonus), and scanning status.",
      "Scanners are sorted by overall score (best first) with medal badges for the top 3. Click any row to expand and see the full score breakdown with comparison notes.",
      "Click a scanner's name to open its details, including per-device signal bars and room controls.",
    ],
  },

  qa_radio_ranking: {
    title: "Understanding radio ranking scores",
    body: [
      "The ranking system helps you identify which radios have the best hardware versus which are just well-placed.",
      "Hardware Score (0\u2013100): For each pair of radios that share devices, PadSpan compares the RSSI each radio reads for those same devices. A radio that consistently reads stronger signals has better hardware. Score 50 = average; higher = better antenna/chipset.",
      "Coverage Score (0\u2013100): Combines device count (how many devices seen), overlap breadth (how many other scanners share devices), and unique reach (devices only seen by this scanner).",
      "Reliability Score (0\u2013100): Freshness of latest advertisement (up to 35 pts), RSSI spread consistency (up to 25 pts), WiFi signal or wired connection (up to 20 pts), and scanning status (up to 20 pts).",
      "The comparison note in expanded detail tells you exactly how much stronger or weaker a radio reads compared to the top-ranked radio, in dBm. A 3\u20135 dBm difference is noticeable; 6+ dBm suggests meaningfully different hardware.",
    ],
  },

  // ── Calibration — Beacon Tune ────────────────────────────────────────────
  calibration_beacon: {
    title: "Beacon Tune — Pin stationary beacons on floor plans",
    body: [
      "Beacon Tune lets you place stationary BLE beacons (Tiles, key fobs, fixed-location iBeacons) at their exact physical positions on your floor plans. Note: AirTags rotate their address every ~15 min, so pinning one only persists as long as MAC Rotation Bridging keeps the chain alive — Tile/iBeacon devices with stable UUIDs are the reliable choice for fixed pins.",
      "Pick a map, then add beacons from the dropdown. Each pinned beacon appears as a teal diamond on the floor plan — drag it to match the real-world position.",
      "Once pinned, PadSpan uses the known position to override the beacon's room assignment — no more flickering between adjacent rooms.",
      "With Auto-Calibrate enabled, PadSpan automatically builds calibration fingerprints from the beacon's RSSI readings at its pinned location. This improves location accuracy for ALL tracked devices over time.",
      "Auto-generated calibration points are labelled [auto] in the Model tab and are capped at 50 per beacon to prevent data bloat.",
      "This is an experimental feature — it works best with stationary beacons that don't move. If you relocate a beacon, update its position on the map and the old auto-calibration data will naturally age out.",
    ],
  },

  // ── Sandbox ────────────────────────────────────────────────────────────────
  sandbox: {
    title: "Sandbox — Experimental data playground",
    body: [
      "Sandbox is your data playground — explore live data, check experimental feature status, and poke around under the hood. Nothing here changes your config.",
      "Experimental Features — status dashboard for all experimental features across PadSpan (Adaptive Learning, Floor Detection, MQTT Publishing, Ignore Bermuda, Beacon Tune). Click any row to jump to its settings.",
      "State Inspector — current data mode, the snapshot's own timestamp, object/room/radio/advertisement counts, session uptime, and a signal-strength (RSSI) distribution histogram, all in one card.",
      "Floor Towers — rooms grouped into a column per floor, each room a stacked colour band. Click a band for that room's details.",
      "Live Signal Bars — per-scanner bar chart showing device count. Click any bar for scanner details.",
      "Signal Pulse — animated room activity bubbles. Ring size reflects device count, pulsing rings indicate fresh signal activity.",
      "Raw Snapshot Explorer — browse the live data snapshot as a collapsible JSON tree. Copy the full snapshot to clipboard for debugging.",
    ],
  },

  installbase: {
    title: "Install Base — what the opt-in reports add up to",
    body: [
      "Developer view, PadSpan Pro, and the server admits only a key on its developer list — a Pro customer sees a clean refusal, not other people's houses.",
      "Installs — lifetime (from the server's ledger, which outlives the 90-day spool), active in the last 7 days, new in the window, lapsed (silent 14+ days). Pinging = distinct update-check callers, which is the whole install base including everyone who did not opt in; Reporting = the opted-in slice.",
      "Per day — two charts: pinging installs per day, and reporting installs per day.",
      "Distributions — every install's latest report bucketed: version, HA version, tier, scanners, floors, rooms, maps, calibration points, IRKs, walls, lights, objects — plus which integrations are present and pinging-by-version.",
      "BLE scan mode — which scan mode installs have chosen versus what they're actually running right now, and how many have pinned a mode versus left it on auto.",
      "Geometry — how many installs are multi-floor, and counts of geometry issues: faulted map geometry, a faulted anchor, no metre anchor, all-default floor heights, uniform scanner Z, and calibration points with no floor assigned.",
      "Flags — installs whose latest report carries a bad health flag. A flag is only counted where the report has the field, so zero means none bad among those that can say.",
      "Identity — installs with IRKs registered, how many of those resolved anything in their window, how many are silent, and how many have Private BLE Device configured.",
      "Usage, tabs, errors — summed across the window, with how many installs contributed to each.",
      "Table — one row per install by the first 8 characters of its random id. Nothing here can name a house.",
    ],
  },

  // ── Data Mode (Live / Sample) ──────────────────────────────────────────
  data_mode: {
    title: "Data Mode — Live vs Sample",
    body: [
      "PadSpan has two data modes that control where the UI gets its information:",
      "LIVE mode connects to your actual Bluetooth scanners and shows real device positions, signal strengths, and room assignments from your physical home. All changes you make (tagging devices, calibrating, editing maps) are saved and affect your live system.",
      "SAMPLE mode uses built-in demo data so you can explore every feature without needing hardware. It's safe to experiment — nothing you do in Sample mode changes your real configuration.",
      "Switch modes using the button in the top-right corner. The current mode is shown as a badge. If you see 'SAMPLE' but expected live data, click it to switch to Live.",
      "Important: Some management actions (deleting rooms, clearing calibration) are disabled in Sample mode to prevent accidents. Switch to Live to enable them.",
    ],
  },

  // ── Complexity Mode ────────────────────────────────────────────────────
  complexity_mode: {
    title: "Complexity Mode — Basic / Advanced / Development",
    body: [
      "PadSpan's complexity mode controls how many tabs and features are visible in the sidebar:",
      "BASIC — Shows only the essential tabs: Follow, Overview, Maps, Settings, and Training. Designed for non-technical household members who just want to see where things are.",
      "ADVANCED — The default for power users. Shows Basic tabs plus Pure Live, Manage, Calibration, Traceback, Occupancy, and Health. You can add more tabs (Devices, Bluetooth, Presence, Monitor, QA, Sandbox) in Settings → UI Structure.",
      "DEVELOPMENT — Shows everything Advanced does, plus every tab in UI Structure at once (Devices, Bluetooth, Presence, Monitor, QA, Sandbox). Use this when troubleshooting issues or when Claude asks you to check diagnostic data.",
      "Changing complexity mode doesn't delete any data — it only controls what's visible in the sidebar. Your settings, calibration, and device data are always preserved.",
    ],
  },

  // ── Overview 3D Controls ───────────────────────────────────────────────
  overview_3d_controls: {
    title: "3D Overview Controls",
    body: [
      "The buttons below the 3D floor stack control what's visible on the isometric map:",
      "Followed (starred) devices always appear as amber beacon markers. They dim when they are away.",
      "PINS ON shows every other identified or labelled device: a red crosshair when away, or a teal dot when present.",
      "PINS OFF hides those markers but leaves unlabelled identified devices visible and dimmed.",
      "WALLS — Toggles RF barrier (wall) lines on the 3D map. Walls affect how PadSpan calculates signal propagation between rooms. If walls are drawn on your maps, turning this ON helps you see where signal blockage occurs.",
      "HEAT — Shows a radio signal coverage overlay on each floor (requires Radio Map enabled in Settings → Features). Green = strong signal, red = weak. This uses your calibration data to visualize where scanners have good coverage and where dead zones exist.",
      "WARP (labelled Distortion until you first turn it on) — Shows positioning error vectors (requires Distortion Map enabled in Settings → Features). Arrows point from where a device actually is to where PadSpan thinks it is, based on leave-one-out cross-validation of calibration data. Heat and Warp are mutually exclusive — turning one on switches the other off.",
      "FLOOR SLIDER — Focuses on a specific floor or pair of adjacent floors. 'All floors' shows the full building. Focusing on a single floor makes it larger and easier to see detail.",
    ],
  },

  // ── Overview 2D Controls ───────────────────────────────────────────────
  overview_2d_controls: {
    title: "2D Map Controls",
    body: [
      "The toggle buttons above the 2D map control which layers are visible:",
      "MAP — Shows/hides the floor plan image. Turn OFF for a cleaner view with just rooms and devices. Turn ON to see the actual floor plan underneath.",
      "ROOMS — Shows/hides room boundary polygons and labels. These are drawn from the room boundaries you defined in the Maps → Edit tab.",
      "SCANNERS — Shows/hides Bluetooth scanner (receiver) positions. Green = online, gray = offline. Scanners are the anchor points for all positioning.",
      "TAGGED — Shows/hides devices that have been given a name (tagged). These are your known devices like phones, keys, and wearables.",
      "UNKNOWN — Shows/hides unidentified Bluetooth devices. These are anonymous BLE signals — usually other people's phones, fitness trackers, or IoT devices passing nearby.",
      "RADIO MAP — Signal strength heatmap overlay (requires Radio Map enabled in Settings → Features). Shows where Bluetooth coverage is strong (green) vs weak (red) based on your calibration data.",
      "DISTORTION — Positioning error analysis overlay (requires Distortion Map enabled in Settings → Features). Shows where the system's predictions disagree with actual positions.",
      "FLOOR SELECTOR — When you have multiple floors, click a floor name to switch. If a floor has multiple maps, they are stitched together into one unified view using their alignment transforms.",
      "SCANNER SELECTOR — When Radio Map is active, choose 'Combined' to see overall coverage or click a specific scanner name to see that scanner's individual reach.",
      "Zoom with mouse wheel. Pan by clicking and dragging. Click 'Reset zoom' to return to the default view.",
    ],
  },

  // ── Settings Presence ──────────────────────────────────────────────────
  settings_presence: {
    title: "Presence Settings — Tuning the Positioning Engine",
    body: [
      "These sliders control how PadSpan's positioning algorithm behaves. Changes take effect immediately.",
      "ROOM CHANGE DELAY — How many seconds a device must consistently appear in a new room before PadSpan confirms the move. Higher = more stable (fewer false room changes), lower = faster response. Default: 20s. Range: 0–300s.",
      "AWAY TIMEOUT — How long after a device's signal disappears before it's marked 'not_home'. If your phone briefly loses signal (e.g., in a Faraday-cage bathroom), a longer timeout prevents false 'away' events. Default: 5 minutes. Range: 1–1440 min.",
      "SIGNAL LOSS LINGER — Extra grace period for devices with high confidence (room_confidence ≥ 0.6). Prevents established presence from being erased by brief BLE dropouts. Default: 90s. Range: 10–300s.",
      "BLE MAX AGE — How old a Bluetooth advertisement can be before it's discarded. Older data is less reliable but can help in areas with sparse scanner coverage. Default: 120s. Range: 30–14400s.",
      "REFERENCE POWER (dBm) — Expected RSSI at 1 meter from a scanner. Used in the path-loss model to estimate distance. Typical range: -50 to -70 dBm. If objects appear too close to scanners, lower this value.",
      "PATH LOSS EXPONENT — How quickly signal decays with distance. 2.0 = free space, 2.5–3.5 = typical indoor, 4.0+ = heavy walls. Higher values make the system more sensitive to distance differences.",
      "KALMAN Q (Process Noise) — How much the true RSSI is expected to vary between polls. Higher = faster response to movement, lower = smoother but slower. Default: 0.125.",
      "KALMAN R (Measurement Noise) — How noisy raw RSSI readings are. Higher = more smoothing, lower = more responsive. Default: 8.0.",
      "ROOM SIGMA — The Gaussian scoring radius in meters. Controls how much nearby scanners influence room assignment. Smaller = more precise but requires good scanner coverage. Default: 4m.",
      "ADAPTIVE LEARNING — When enabled, PadSpan passively learns room RSSI fingerprints from confirmed room assignments. Over days/weeks this improves accuracy without manual calibration. No data is sent externally.",
    ],
  },

  // ── Settings Features ──────────────────────────────────────────────────
  settings_features: {
    title: "Experimental Features — Preview & Test",
    body: [
      "These features are under active development. Enable them to preview and help test. They may change or be removed.",
      "WALK-TO-IDENTIFY — Discover unknown BLE devices by walking into a room. PadSpan correlates signal changes with your location to identify who owns which device.",
      "RADIO MAP — Signal strength heatmap overlay on floor plan maps. Shows coverage from calibration data — green = strong, red = weak. Appears as a toggle button in Overview (2D and 3D).",
      "DISTORTION MAP — Shows where calibration predictions disagree with reality. Renders error arrows on the map so you can see where walls or interference cause positioning problems.",
      "PHONE SETUP WIZARD, MAC ROTATION BRIDGING, APPLE DEVICE CLASSIFICATION, RSSI VECTOR CAPTURE — a related group of experimental tools for phones and Apple devices that rotate their Bluetooth address, aimed at keeping a tag attached to a device through those rotations.",
      "This tab also holds the PadSpan Pro licence card and, once you have a key, the Forensics card — a paid, time-window presence search. Turning Forensics on for the first time asks for a licence key if you don't already have one entered.",
    ],
  },

  // ── Manage Danger Zone ─────────────────────────────────────────────────
  manage_data: {
    title: "Data Management — Handle with Care",
    body: [
      "This tab contains administrative actions that directly modify your Home Assistant data. Most actions cannot be undone.",
      "ORPHAN CLEANUP — Finds room boundary polygons on maps that reference rooms/areas no longer in Home Assistant. 'Delete orphans' removes these stale references.",
      "PHANTOM ROOM ENTRIES — A separate cleanup for stale entries left behind when a room is renamed or removed elsewhere in Home Assistant.",
      "LABEL REMOVAL — Removes user-assigned names (tags) from BLE devices. The device will revert to showing its MAC address. The device itself is not affected — just its friendly name.",
      "ENTITY DELETION — Removes PadSpan sensor entities from Home Assistant. This clears the entity from dashboards and automations. The device may be recreated on the next scan.",
      "AREA DELETION — Removes an area (room) from Home Assistant's area registry. WARNING: This affects ALL integrations using that area, not just PadSpan. Integration Controls here also includes a 'Reset room colors' action.",
      "MAP DELETION — Removes an uploaded floor plan map. Calibration data for that map is NOT automatically deleted (it becomes orphaned but can still be used if the map is re-uploaded).",
      "BACKUP & RESTORE — Backs up your settings, maps, placements, labels, calibration, alerts and history. Maps and placements are restored together so positions cannot be left pointing at a missing map. Always make a backup before a major change.",
      "INTEGRATION RELOAD — Restarts the PadSpan integration without restarting all of Home Assistant. Use this after manual file changes or when things seem stuck.",
    ],
  },

  // ── Manage Factory Reset ───────────────────────────────────────────────
  manage_espresense_import: {
    title: "ESPresense Companion Import",
    body: [
      "Imports floor layouts, room boundaries, and scanner/node positions from ESPresense Companion into PadSpan.",
      "WHAT IT IMPORTS — Floors (with z-level from 3D bounds), rooms (polygon boundaries in metres), and scanner/node positions (x, y, z in metres). All coordinates transfer directly — ESPresense and PadSpan both use metres, so no conversion is needed.",
      "WHAT IT DOESN'T IMPORT — Floor plan images (ESPresense Companion doesn't store them server-side). You still upload your own floor plan images in PadSpan's Maps tab. Device settings and calibration data are also not imported.",
      "HOW TO USE — 1. Enter your ESPresense Companion URL (e.g., http://espresense:8267 for the HA add-on, or whatever host:port your Docker container runs on). 2. Click 'Save URL'. 3. Click 'Import Now'. PadSpan fetches the full config from Companion's REST API in a single request.",
      "MERGE BEHAVIOUR — Import never deletes existing PadSpan data. If a floor or room already exists, it updates the geometry. If it's new, it's added. Run import multiple times safely — it's idempotent.",
      "SCANNER ROOM ASSIGNMENT — After importing room polygons and scanner positions, PadSpan automatically determines which room each scanner is in using a point-in-polygon test. You can adjust this in the Calibration → Tune tab.",
      "FINDING YOUR COMPANION URL — HA Add-on: check the add-on's Web UI link (usually http://homeassistant.local:8267 or the add-on sidebar). Docker: use the host and port you configured (default port 8267). The import calls GET /api/state/config on that URL.",
      "TROUBLESHOOTING — 'Cannot reach Companion': verify the URL is correct and Companion is running. Try opening the URL in your browser — you should see the Companion web UI. 'HTTP 404': your Companion version may be too old to have the REST API. Update to the latest version.",
    ],
  },

  manage_factory_reset: {
    title: "Factory Reset — Nuclear Option",
    body: [
      "Factory Reset wipes ALL PadSpan data and returns the integration to a fresh install state.",
      "This deletes: all calibration data, all maps, all object labels/tags, all adaptive learning history, all movement history, all follow/alert configurations, all traceback recordings, and all settings.",
      "This does NOT delete: the integration itself, your Home Assistant areas/rooms, or any non-PadSpan entities.",
      "Consider creating a backup (Manage → Data → Backup) before proceeding — but note Factory Reset also deletes any backups stored within PadSpan itself, so a backup only protects you if you export or copy it outside PadSpan first. Factory Reset cannot be undone.",
    ],
  },

  // ── Calibration Overview ───────────────────────────────────────────────
  calibration_overview: {
    title: "Calibration — Teaching PadSpan Your Home",
    body: [
      "Calibration captures real Bluetooth signal readings at known positions in your home. PadSpan uses this data to build a fingerprint model that maps signal patterns to physical locations.",
      "SETUP — Choose which device to calibrate with (usually your phone) and verify scanner connectivity.",
      "TUNE — Receiver position tuning: drag your scanner markers on the 3D map to match where they really are mounted. This doesn't collect signal samples — it's about getting scanner positions right before you calibrate.",
      "BEACON TUNE — For stationary Bluetooth beacons (iBeacons, Tiles in fixed locations). Pin them on the map so PadSpan knows exactly where they are. AirTags work too but only while MAC Rotation Bridging keeps the address chain intact.",
      "PIN & LISTEN — Classic calibration: click a spot on the map, stand there physically, and collect signal samples for 15–90 seconds (90s recommended for best accuracy). Repeat across the home.",
      "ROAM — PadSpan shows a coverage map and marks the weakest-covered spot with a 'next target' crosshair. Walk there and press 'I'm Here — Collect.' It records one point at a time, like Pin & Listen, but chooses where you should go next.",
      "MODEL — View calibration statistics, LOO accuracy, and per-scanner path-loss fits. Export or clear calibration data.",
      "More calibration points = better accuracy. Focus on room boundaries, doorways, and areas near walls where signal transitions are sharpest.",
    ],
  },

  // ── Forensics ──────────────────────────────────────────────────────────
  forensics: {
    title: "Forensics — Time-window presence search",
    body: [
      "Forensics answers: which Bluetooth devices were near my scanners between two points in time? Useful after a break-in, a package theft, or to spot an unknown tracker that keeps returning.",
      "This is a PadSpan Pro feature — enabling it asks for a licence key. Keys are validated against the traks.ca licence server; contact hello@traks.ca for licensing.",
      "While enabled (Settings → Features), PadSpan samples every 60 seconds in Live mode and records presence sessions — contiguous stretches during which a device was heard. A gap of more than 5 minutes closes a session.",
      "Recorded results are devices with an actual session inside your window. Possible results only have a first-seen/last-seen span overlapping the window — they may have left and come back, so treat them as lower confidence.",
      "Reliability: a Bluetooth address is not a person. Phones rotate their addresses every 15 minutes to 24 hours, so most phones appear as one-off addresses. Fixed-address devices (earbuds, trackers, speakers, gadgets) are what this reliably surfaces. Addresses can also be spoofed — treat results as investigative leads, not proof.",
      "All recordings stay on your Home Assistant instance and are never uploaded. Retention is configurable (7–90 days, enforced even after you disable recording) and recorded sessions can be deleted from Settings → Features → Forensics. The Possible tier comes from the Objects first/last-seen history and is governed by the Object History Retention setting instead.",
    ],
  },

  // ── Traceback ──────────────────────────────────────────────────────────
  traceback_overview: {
    title: "Traceback — Movement Replay",
    body: [
      "Traceback records a snapshot of all tracked objects every ~10 seconds and lets you play back their movement over time.",
      "TIMELINE SLIDER — Drag to scrub through recorded frames. Each frame shows where every tracked object was at that moment.",
      "PLAY / PAUSE — Automatically advances through frames at the selected speed.",
      "PLAYBACK SPEED — Controls how fast playback runs. '1 min' compresses all frames into 1 minute of playback; '1 hr' plays at near-real-time speed.",
      "OBJECT FILTER — Focus on a specific device to see only its movement trail. 'All' shows every tracked object.",
      "Objects that never changed rooms during the recording period are hidden automatically once there are enough moving objects to make that useful — you don't need to turn this on yourself.",
      "NEW OBJECTS HEARD — A separate search, not part of playback: shows which BLE devices were first seen within a chosen time window (e.g. \"from 30 min ago to 10 min ago\"), for spotting something new that showed up.",
      "Object positions use k-NN fingerprint data when available (precise sub-room placement) or fall back to room centroids. Older recordings before v0.14.71 only have room-level data.",
    ],
  },

  // ── Bluetooth View ─────────────────────────────────────────────────────
  bluetooth_overview: {
    title: "Bluetooth — Scanner & Signal Analysis",
    body: [
      "Bluetooth shows exactly what each scanner is hearing.",
      "VISUALISATION — A graph showing how scanners and devices are connected. Line and node colours show signal strength (green/amber/red); node size does not change. Click a scanner to open its details and assign it to a room.",
      "ADVERTISEMENTS — Live feed of Bluetooth advertisements. Filter by source scanner or search by MAC address. Shows RSSI, age, and device type.",
      "SCANNERS — Lists all Bluetooth receivers/scanners with their room, online status and other details. Click a scanner row to see the devices it is currently hearing in the panel beside it. To change its room, open the scanner details from Visualisation.",
      "IRK MANAGER — Manages Identity Resolving Keys (IRKs) for tracking Apple/Android devices that rotate their MAC addresses. Without IRKs, these devices appear as constantly-changing random addresses. To capture IRKs from phones and watches, see the ESPHome IRK Capture tool: https://github.com/DerekSeaman/irk-capture — flash a spare ESP32, pair briefly with each device, copy the IRK, and paste it here. PadSpan resolves all rotating MACs back to a stable identity automatically.",
      "ESPHOME CONFIGS — A library of ready-made ESPHome YAML configs for building your own scanners.",
    ],
  },

  // ── Health & System Critics ────────────────────────────────────────────
  health_critics: {
    title: "System Critics — Automated Health Diagnosis",
    body: [
      "System Critics automatically analyses your PadSpan setup and flags issues that may affect positioning accuracy.",
      "Each critic has a severity level: CRITICAL (red, major impact), WARNING (amber, should address), INFO (gray, minor or informational).",
      "ROOM CONFUSION — Detects room pairs where objects frequently bounce back and forth. High confusion means the system can't reliably distinguish between those rooms. Fix: add calibration points near the boundary, or add an RF barrier (wall) in the map editor.",
      "MAP QUALITY — Checks leave-one-out cross-validation error per map. High error means the calibration data doesn't accurately predict positions. Fix: add more calibration points, especially in areas with poor coverage.",
      "SCANNER DISAGREEMENT — Flags scanners that consistently disagree with the consensus room assignment. Fix: check scanner placement, antenna orientation, or RSSI offset in Settings → Scanner Map.",
      "CALIBRATION STALENESS — Warns when calibration data is old. The RF environment changes over time (furniture moves, new devices added). Fix: run a fresh calibration walk-around periodically.",
      "PROPAGATION HEALTH — Checks adaptive learning fingerprint stability. High variance means the signal environment is noisy or changing. Fix: check for interference sources (WiFi APs, microwaves, USB3 devices).",
      "Each critic includes a concrete 'Action' step telling you exactly what to do to fix the issue.",
    ],
  },

  // ── Maps Edit Tools ────────────────────────────────────────────────────
  maps_edit: {
    title: "Map Editor — Drawing Rooms & Placing Scanners",
    body: [
      "The map editor has four modes, selectable with the buttons at the top:",
      "RADIOS — Place Bluetooth scanner markers on the map. Double-click the map to add a scanner, then drag to position. Click a placed scanner to select it (shows delete button). Each scanner should be positioned where the physical device is mounted.",
      "ROOMS — Draw room boundary polygons. Click the map to add polygon points, double-click to finish the shape. Each polygon becomes a named room. Room names should match your Home Assistant Area names exactly.",
      "RF BARRIERS — Draw wall/barrier lines that block Bluetooth signal. Click to start, click to add points, double-click to finish. Choose material type: Open (Loft) for areas open to the floor above/below (0dB, no wall — only height-based attenuation applies), Brick (4dB), Concrete (8dB), Metal (12dB), or Custom (6dB) for anything else. Open/Loft markers tell PadSpan that signal flows freely between floors at that boundary, reducing cross-floor stickiness.",
      "MEASURE — Click two points you know the real distance between, to set or check the map's scale.",
      "SAVE LAYOUT — Saves all changes (receivers, rooms, barriers) to the server. Changes are not saved automatically.",
      "REVERT — Discards unsaved changes and reloads the last saved state.",
      "Important: Room names must match HA Area names for positioning to work. If a room boundary has a different name than the HA Area, objects won't be correctly positioned in that room.",
    ],
  },

  // ── Walk-to-Identify ────────────────────────────────────────────────────
  walk_to_identify: {
    title: "Walk-to-Identify \u2014 Who's in which room?",
    body: [
      "Walk-to-Identify helps you figure out which unknown Bluetooth device belongs to which person \u2014 without needing MAC addresses.",
      "HOW IT WORKS: Select a room from the dropdown and press 'Who's here?'. PadSpan checks which unidentified devices have the strongest signal from scanners in that room, and ranks them by likelihood of being physically present there.",
      "The score is based on signal correlation: devices heard strongly by the room's scanners but weakly by scanners in other rooms get high scores. Devices heard equally everywhere score low.",
      "TOP CANDIDATES appear with a purple 'Likely in [Room]' badge and a match percentage. Click 'Tag' on a candidate to give it a friendly name.",
      "TIPS: Make sure the person is actually in the room when you press the button. Works best with 4+ scanners spread across different rooms.",
    ],
  },

  // ── Maps 3D Stack ──────────────────────────────────────────────────────
  maps_stack: {
    title: "3D Stack — Multi-Floor Alignment",
    body: [
      "The 3D Stack tab lets you align multiple floor plan maps so they stack correctly in the isometric building view.",
      "FLOOR ASSIGNMENT TABLE — Set the z-level (floor number), ceiling height, and visibility for each map. Z-level 0 = ground floor, 1 = first floor, etc. Maps on the same z-level are shown as overlapping layers.",
      "ALIGNMENT OVERLAY — Position one map relative to another by dragging, rotating, and scaling. Choose a Reference map (fixed) and a Target map (movable). Align structural features like stairwells and exterior walls.",
      "POINT ALIGN SOLVER — For precise alignment, place matching point pairs on both maps (e.g., the same corner of a stairwell). The solver computes the optimal transform (rotation + scale + position) automatically.",
      "COMPARE ALL MAPS — Cross-checks room boundaries across all visible maps. Shows the worst-case alignment error as a percentage. Target: <5% for good accuracy.",
      "Accurate alignment is important because it affects how PadSpan handles cross-floor positioning and how the isometric view renders your building.",
    ],
  },
};
