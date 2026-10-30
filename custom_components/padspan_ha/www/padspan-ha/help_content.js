// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
// See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
// PadSpan HA — User-facing help content
// Each entry: { title, body: string[] }
// Opened by the ? help buttons in Basic, Advanced, and Development modes.
//
// A key defined twice below is not a syntax error — it's a SILENT one: the
// second definition simply wins and the first becomes dead prose nobody will
// ever see again (this has bitten real content twice: settings_presence and
// maps_stack each had two definitions, only the second ever reachable).
// training.js's helpKeys arrays pull text from this dict by key at render
// time and just skip any key that isn't found here, so a typo'd or removed
// key doesn't error either — it quietly renders nothing (how `zones` and
// `insights` sat broken). tests/test_help_content_coverage.py guards both
// failure modes; keep it green rather than re-deriving this by hand.

// Every title and paragraph goes through t() (views/i18n.js). The English
// below is the text AND the key: helpTexts() returns it unchanged, so HELP is
// exactly what it always was. When a shipped language is loaded, panel.js
// calls helpTexts() again and i18n/<lang>/help.json swaps each one in; a
// paragraph missing there stays English. Structure stays here, never in JSON.
// If the helper fails to load, the help is the English, as it always was.
const { t, currentLanguage } =
  await import(`./views/i18n.js${new URL(import.meta.url).search}`)
    .catch(() => ({ t: (s) => s, currentLanguage: () => "en" }));

/** The short note a translated help page opens with: the rest of the panel
 *  is still English, so its labels are quoted in English. "" in English. */
export function helpNote() {
  return currentLanguage() === "en" ? ""
    : t("This help is translated, but the rest of the panel is still in English, so the names of its tabs, buttons and settings appear here in English, in quotes.");
}

export function helpTexts() { return {

  // ── Follow ──────────────────────────────────────────────────────────────────
  follow: {
    title: t("Follow — Track a tag in real time"),
    body: [
      t("The Follow page lets you watch exactly where a specific person or object is right now."),
      t("Pick any tracked tag from the dropdown — a phone, key fob, AirTag, Tile tracker, or anything Bluetooth. PadSpan™ shows you which room it's currently in, how strong the signal is, and which of your scanners can see it."),
      t("The location updates automatically every few seconds. You don't need to refresh the page."),
      t("Click Details → in the status card to open the full device detail view — per-scanner RSSI, signal history, and quick access to Tag/Relabel."),
    ],
  },
  follow_selector: {
    title: t("Choosing which tag to follow"),
    body: [
      t("The dropdown is sorted by signal strength, strongest first — so whatever's closest right now tends to be near the top, not whatever has a name."),
      t("Give an unnamed device a friendly name (like 'Alice's Phone' or 'Car Keys') using the Tag button in the Objects section, so it's easier to pick out of the list."),
      t("In Quiet Mode, unidentified and unfollowed devices are left out of the dropdown entirely — turn Quiet Mode off if you're looking for one that isn't there."),
      t("If a device shows 'not_home' or is missing from the list, it hasn't been detected recently. It may have left range or gone away. Check the Objects tab for the red Away badge and its last known location."),
    ],
  },
  follow_map: {
    title: t("Location map — Where is the tag right now?"),
    body: [
      t("The map shows every room in your home and highlights the tracked tag's current location with a bright pulsing dot."),
      t("Green antenna rings inside rooms show where your Bluetooth scanners (radios) are placed."),
      t("The more scanners that can detect the tag, the more accurately PadSpan can pinpoint the location."),
      t("The map refreshes automatically every few seconds — no manual refresh needed."),
    ],
  },
  follow_alerts: {
    title: t("Movement alerts — Get notified when a tag moves"),
    body: [
      t("PadSpan can tell you when a tracked tag moves from one room to another, arrives home, or leaves: on your phone, by email, or both."),
      t("For your phone, pick it under Notify service (the Home Assistant Companion app's notify target); no email is needed. For email, type the address and leave Notify service on Auto-detect, or pick your mail service. Tick what you want to hear about, then press Save — nothing is active until you save it."),
      t("Send Test sends one right now to exactly where alerts go, and says plainly if it couldn't reach your phone or mail service."),
      t("Arrive and leave use the same away timeout as the Away badge, and also fire Home Assistant events (padspan_device_arrived and padspan_device_departed) you can use in your own automations. In Advanced mode you can also pick specific rooms to watch."),
      t("Alerts go out through Home Assistant's notify services. If none arrive, check that the Companion app (for a phone) or a mail integration (like SMTP) is set up in HA Settings → Devices & Services."),
    ],
  },

  // ── Overview ─────────────────────────────────────────────────────────────────
  overview: {
    title: t("Overview — Your home at a glance"),
    body: [
      t("Overview shows a live diagram of all your rooms with your Bluetooth scanners and tracked objects displayed inside them."),
      t("Think of it as your home's control tower — a quick snapshot of where everything is right now."),
      t("Each box is a room from your Home Assistant Areas & Zones. Green antenna icons are your Bluetooth radios. Coloured dots are tracked people or objects."),
      t("In Advanced or Development mode, use the buttons below the KPI row — View rooms list, All objects / Unidentified, View radios list — to see a full list. Click any row in that list for detailed info on that item."),
    ],
  },
  overview_grid: {
    title: t("The map — What you're seeing"),
    body: [
      t("Once you have traced your rooms in Mapping, Overview draws the floors as a 3D stack. Each room uses its own colour, and rooms sharing a wall join into one clean shape."),
      t("Bluetooth scanners appear as fixed-size rings — colour, not size, tells you their state: green for online and reporting, dim grey for offline. A pulsing red ring means the scanner is actively mid-scan."),
      t("Coloured dots are tracked objects. Followed (starred) devices always draw as an amber marker, even when away (it just dims). Teal dots are identified/tagged devices; orange dots are unrecognised Bluetooth signals."),
      t("Before any floor plan has real room geometry, Overview falls back to a flat grid of coloured boxes instead — one per room, with a count badge in the corner showing scanners and objects in it. That's the fallback view, not the everyday one."),
      t("The map refreshes every 5 seconds in Live mode."),
    ],
  },

  // ── Objects ───────────────────────────────────────────────────────────────────
  objects: {
    title: t("Objects — Everything being tracked"),
    body: [
      t("Objects lists Bluetooth devices your scanners have detected — phones tracked by Home Assistant, Tile trackers, key fobs, AirTags, and anything else broadcasting BLE. By default only devices seen in the last 4 hours are shown; widen the History filter to go further back."),
      t("Badge colours tell you the device type: green BLE = standard Bluetooth device, orange BLE? = unidentified, blue Private BLE = phone using rotating MAC address (resolved automatically via IRK), amber iBeacon = Tile / HA Companion App iBeacon grouped by stable UUID. AirTags and other Apple Find My tags (purple Find My badge) change both their MAC and their advertised key — every 15 min near their owner's iPhone, once a day away from it — and do NOT have a stable identifier; see the Naming help below for what works."),
      t("A red Away badge appears when a BLE device hasn't been seen for longer than the configured away timeout (default 5 min). The corresponding device_tracker entity in HA also shows not_home."),
      t("Lost & Found: '📍 Kitchen · 2 h ago' under a device is the last room PadSpan was sure it was in, and when. It's kept across Home Assistant restarts, so you can still see where your keys were last seen after a reboot."),
      t("Basic mode shows one card per device; click its Details button to open the full detail panel. Advanced/Development mode instead shows a sortable table with a search box (find a device by name, address, company, or device type — try 'apple' or 'tile') and the extra company/device-type/service badges decoded from its BLE advertisement; click anywhere on a row to open the same detail panel."),
    ],
  },
  objects_tag: {
    title: t("Naming (tagging) a device"),
    body: [
      t("When PadSpan detects a Bluetooth device it doesn't recognise, it shows a hardware address like AA:BB:CC:11:22:33."),
      t("Click the 'Tag' button next to any device to give it a friendly name — for example 'Backpack Tile', 'Car Keys', or 'Cat Collar'. Click Save. The name is stored permanently in Home Assistant."),
      t("Once tagged, the name appears everywhere in PadSpan — on the Overview map, the Follow tracker, and all other pages. PadSpan also creates a device_tracker entity (e.g. device_tracker.car_keys) and an area sensor (e.g. sensor.car_keys_area) in Home Assistant for use in automations."),
      t("What sticks across rotations: Tile/Chipolo and HA Companion-App iBeacons broadcast a stable UUID, so the tag follows them forever. Phones use IRK resolution (Bluetooth → IRK Manager) to bind a friendly name to the rotating address. AirTags, other Apple Find My tags and Samsung SmartTags are the hard case — they rotate both MAC and advertised key with no stable identifier. For Find My tags, enable Settings → Features → MAC Rotation Bridging: a tag you've named or followed carries on to its next address when it's clear which one it is (same kind of tag, the old address stopped, heard in the same place). It won't guess — two tags lying together that change at once, or a tag out of range when it changed, need naming again."),
      t("You can rename a device at any time by clicking 'Relabel'. To remove a tag entirely, go to the sidebar Manage view → BLE Tags."),
    ],
  },

  // ── Maps ─────────────────────────────────────────────────────────────────────
  maps: {
    title: t("Mapping — Floor plans for your home"),
    body: [
      t("The Mapping section lets you upload photos or scans of your home's floor plans."),
      t("Once uploaded, your floor plan shows the rooms alongside your Bluetooth scanner layout, helping you visualise coverage and plan where to add more scanners."),
      t("You can upload one floor plan per floor — for example 'Ground Floor', 'Upper Floor', and 'Basement'."),
    ],
  },
  maps_library: {
    title: t("Map library — Your uploaded floor plans"),
    body: [
      t("The library shows all the floor plans you've uploaded."),
      t("In Sample mode, a demonstration home (Smith Residence) is shown so you can explore how the feature works without uploading anything."),
      t("Switch to Live mode and go to the Upload tab to add your own floor plans."),
    ],
  },
  maps_upload: {
    title: t("Uploading a floor plan"),
    body: [
      t("You can upload any floor plan image — PNG, JPG, or even a photo you took of a hand-drawn plan."),
      t("Give the map a name (like 'Ground Floor'), then pick your image file and click Upload & Convert."),
      t("PadSpan automatically resizes and stores the image in Home Assistant so it loads quickly."),
      t("Tip: a photo of your architect's drawing or even a rough sketch works great."),
    ],
  },
  // ── Settings ─────────────────────────────────────────────────────────────────
  settings: {
    title: t("Settings — Customise PadSpan™"),
    body: [
      t("In Advanced or Development mode, Settings has tabs: Appearance, Scanner Map, Presence, Features, and UI Structure."),
      t("Appearance — change room colours. Your floors and rooms are read from HA; add or rename them in HA Settings → Areas & Zones."),
      t("Scanner Map — see estimated scanner positions on your floor plans, derived from calibration fingerprint data."),
      t("Presence — tune room-switching speed and set the Home/Away timeout."),
      t("Features — turn on experimental features, and the PadSpan Pro licence and Forensics cards live here too."),
      t("UI Structure — choose which extra tabs appear in Advanced mode. All tabs are always visible in Development mode."),
      t("In Basic mode only the Appearance tab is shown."),
    ],
  },
  settings_colors: {
    title: t("Room colours — Pick a colour for each room"),
    body: [
      t("Each room has a colour used across all of PadSpan's maps and diagrams."),
      t("Click the coloured square (■) next to a room name to open the colour picker and choose a new colour."),
      t("Click 'Save floors & room settings' when you're done — your choices are stored in Home Assistant and will be remembered next time."),
    ],
  },
  settings_manage: {
    title: t("Untagging devices and deleting rooms"),
    body: [
      t("Settings doesn't have its own Manage tab — for this, open the separate Manage entry in the sidebar (Advanced and Development modes)."),
      t("BLE Tags — every named BLE device is listed with its address, kind, and last-seen time. Click Untag to remove the friendly name (two-click confirm prevents accidents). The device reverts to its hardware address but continues to be tracked."),
      t("Rooms (HA Areas) — lists every area from Home Assistant. Click Delete to remove an area from HA entirely. This also unassigns any scanners in that room. Cannot be undone from within PadSpan — re-add in HA Settings → Areas & Zones if needed."),
      t("The Manage sidebar entry also covers deeper data management — orphan cleanup, entity deletion, integration controls, and Factory Reset."),
    ],
  },

  // ── Monitor ────────────────────────────────────────────────────────────────
  monitor: {
    title: t("Monitor — System health & analytics hub"),
    body: [
      t("Monitor has six sub-tabs: Calls and timing, Zones, Signal and coverage, Quick status, Export for support, and Debug."),
      t("Calls and timing — websocket call counts, timing, scanner performance, advertisement freshness, and session info. The Per-Scanner Breakdown table shows each scanner's device count, average RSSI, and quality grade."),
      t("Zones — every room as a card sorted by occupancy. Occupied rooms have a coloured border; empty rooms are dimmed. Click a room card to see its detail. Rooms are grouped by floor when configured in HA."),
      t("Signal and coverage — charts for room occupancy, scanner signal quality, devices moving between rooms, coverage gaps, and devices by type."),
      t("Quick status — the current Problems found results described below. Export for support — press Build export to collect the current diagnostics as JSON, then copy it (to attach to a support request or a GitHub issue). Long lists are cut to 200 entries, but every device you tagged or follow is always kept. Debug — show the values the panel is currently using for troubleshooting."),
    ],
  },
  zones: {
    title: t("Zones — Every room, at a glance"),
    body: [
      t("Zones shows one card per room, sorted so the busiest rooms come first. A coloured left border means the room currently has something in it; an empty room's card is dimmed grey."),
      t("Each card lists what's in that room — up to 8 objects by name, with signal strength in dBm and a small dot for anything you're following. Click a card, or an object inside it, to open its full detail view."),
      t("The badge row at the top counts rooms, occupied rooms, empty rooms, and total tracked objects."),
      t("If your Home Assistant floors are set up, rooms are grouped under their floor's name. Quiet Mode (top of Overview) hides unidentified devices here too, showing only tagged and followed objects."),
    ],
  },
  insights: {
    title: t("Insights — Room-dwell analytics"),
    body: [
      t("Insights is a mode of Traceback (Traceback → Insights). It aggregates your traceback history into two tables. Time in Room shows, per tracked object per day, how long it spent in each room and how many times it entered — pick a 1/3/7-day range with the buttons at the top."),
      t("Peak Concurrent Occupancy shows the most tracked objects seen in any one room at the same time, per day, with the hour it happened."),
      t("Both tables can be exported as CSV or JSON from the buttons on the Time in Room card. Data comes from the same 7-day traceback history Traceback plays back — nothing older is available."),
      t("For a visual, room-by-room version of the same underlying data — which rooms are busiest overall and by hour of day — see Traceback → Busy Times."),
    ],
  },
  busytimes: {
    title: t("Busy Times — Which rooms are busiest, and when"),
    body: [
      t("Busy Times is a mode of Traceback (Traceback → Busy Times). It aggregates every tracked object's dwell time into one room-by-room picture: how much total time each room was occupied over the last 1/3/7 days, and a 24-hour bar showing when in the day that room tends to get busy."),
      t("Each room's box is tinted by its total occupied time relative to the busiest room in the selected range — darker means quieter, brighter orange/red means busier. The red bar in each room's 24-hour strip marks its single busiest hour."),
      t("This is a different view of the same data Insights shows as tables: Insights is per-object, day-by-day detail; Busy Times is the room-level summary at a glance. Neither is the live RSSI signal-quality heatmap on the Overview map — that's about scanner coverage, not room activity."),
      t("Busy Times is a PadSpan Pro feature."),
    ],
  },
  locate: {
    title: t("Locate — Which way to walk to find something"),
    body: [
      t("Locate is an option on Follow: pick a tag to follow, then tap 📍 Locate. It answers \"which way do I walk from here to that\" without a compass or a camera. Pick which tracked device is yours — the same one your Phone Setup Wizard or IRK setup already tracks — and it guides you to the tag you are following."),
      t("If you're in the same room already, Locate shows the live distance in metres between you, with \"getting closer\" or \"getting further\" as you move."),
      t("If you're in a different room, Locate walks a path over your drawn room-adjacency map (Mapping → Rooms) and tells you which room to head to next, with the full route shown as a trail. If a floor change is needed it says so up front. If no route is drawn between the two rooms yet, it tells you the target's room and floor so you can head there directly."),
      t("This deliberately does not use your phone's compass — indoors, near BLE scanners and building wiring, a magnetic compass is not reliable enough to trust. Locate is a PadSpan Pro feature, and needs \"you\" set to a tracked device to work at all."),
    ],
  },

  // ── History ────────────────────────────────────────────────────────────────
  history: {
    title: t("History — Session event timeline"),
    body: [
      t("History has two sub-tabs: Session Events and Movement."),
      t("Session Events shows every action taken during this browser session — view changes, data refreshes, tagging, and websocket calls. Use the type filter buttons to show or hide specific event types; the timeline is newest-first. This data is session-scoped and resets when you reload the page — it is not stored on the server. Click Clear History to reset it."),
      t("Movement is different: it's your saved room-transition history, fetched from the server, and survives a page reload. Use it to see when tracked objects actually changed rooms, not just what happened in this browser session."),
    ],
  },

  // ── Events ─────────────────────────────────────────────────────────────────
  events: {
    title: t("Events — Notable activity stream"),
    body: [
      t("Events shows only the actionable events from your session — tagging, navigation, and data refreshes."),
      t("Click a navigation event to jump back to that view."),
      t("Unlike History (which logs everything), Events filters to the activity that matters most for understanding what's happened."),
    ],
  },

  // ── QA ─────────────────────────────────────────────────────────────────────
  qa: {
    title: t("QA — Configuration quality checks"),
    body: [
      t("QA runs automated health checks on your PadSpan setup and highlights anything that needs attention."),
      t("Config Health — pass/warn/fail checks covering maps, rooms, scanners, BLE feed, tagging, and snapshot availability. A warning gets an amber ⚠️ rather than a hard fail. Failed and warned checks include a fix suggestion."),
      t("Data Consistency — detects orphaned objects, unmapped scanners, and rooms without scanner coverage. Click any item to see its detail."),
      t("Propagation Health — grades your radio propagation model (A through F) based on room coverage, distance accuracy, fingerprint stability, and floor separation. Click 'More Detail' for per-room and per-scanner breakdowns with improvement recommendations. 'How It Works' shows the underlying math."),
      t("Radio Analysis — grades each scanner's hardware, coverage and reliability, and explains why it received that grade."),
      t("Data Backup & Recovery — create snapshots of all PadSpan data before enabling experimental features. Restore to roll back if needed. Up to 3 backups you create are kept, plus the last 3 automatic ones."),
      t("Quick Actions — refresh the snapshot, export the full panel state as JSON for debugging, or jump to diagnostics."),
    ],
  },

  qa_propagation: {
    title: t("Propagation Health — Model quality analysis"),
    body: [
      t("Propagation Health analyses the quality of PadSpan's underlying radio model \u2014 the math that converts signal strength (RSSI) into room assignments."),
      t("The overall grade (A\u2013F) combines four sub-indicators: Model Coverage (% of rooms with learned fingerprints), Distance Accuracy (cross-validation error from calibration data), Fingerprint Stability (variance in adaptive room models), and Floor Separation (signal attenuation between floors)."),
      t("Click 'More Detail' to see per-room fingerprint quality (how many observations each room has, variance, and stability status) and per-scanner path-loss models (exponent, RSSI@1m, R\u00b2 fit quality)."),
      t("Improvement recommendations are generated automatically: rooms that need more data, scanners with poor path-loss fits, suggestions to enable adaptive learning or add calibration points."),
      t("'How It Works' shows the actual formulas and current parameter values: path-loss distance calculation, Kalman filter settings, and adaptive blending weight."),
      t("Reset buttons at the bottom let you clear adaptive learning data (keeps manual calibration) or clear all calibration data (requires typing RESET to confirm)."),
    ],
  },

  qa_backup: {
    title: t("Data Backup & Recovery"),
    body: [
      t("The backup system lets you create a full snapshot of all PadSpan configuration and learned data before making changes."),
      t("Each backup captures: settings, calibration points, adaptive learning fingerprints, object tags, model data, map metadata, movement history, and follow alert configs."),
      t("Up to 3 backups you create are stored. Creating a 4th automatically removes the oldest of them. The automatic backups PadSpan takes before a reset, an import or a conversion are kept apart (the last 3) and never remove one of yours. Each backup shows its timestamp, version, and optional note."),
      t("Click 'Restore' to overwrite all current data with a backup. The page reloads automatically after restore. Click 'Delete' to remove a backup you no longer need."),
      t("Recommended workflow: create a backup before enabling adaptive learning, before major calibration changes, or before upgrading PadSpan."),
    ],
  },

  qa_radio_analysis: {
    title: t("Radio Analysis — Per-scanner ranking & health"),
    body: [
      t("Radio Analysis ranks every Bluetooth scanner by overall quality, combining three scores: Hardware (40%), Coverage (30%), and Reliability (30%)."),
      t("Hardware Score isolates radio hardware quality from placement. It compares per-device RSSI across scanners that share the same devices \u2014 a radio that consistently reads higher RSSI for shared devices has a better antenna or Bluetooth chipset."),
      t("Coverage Score measures how many devices the scanner sees and how many other scanners it overlaps with. High coverage means the scanner reaches broadly across your home."),
      t("Reliability Score combines advertisement freshness, RSSI consistency (spread), WiFi signal strength (or wired bonus), and scanning status."),
      t("Scanners are sorted by overall score (best first) with medal badges for the top 3. Click any row to expand and see the full score breakdown with comparison notes."),
      t("Click a scanner's name to open its details, including per-device signal bars and room controls."),
    ],
  },

  qa_radio_ranking: {
    title: t("Understanding radio ranking scores"),
    body: [
      t("The ranking system helps you identify which radios have the best hardware versus which are just well-placed."),
      t("Hardware Score (0\u2013100): For each pair of radios that share devices, PadSpan compares the RSSI each radio reads for those same devices. A radio that consistently reads stronger signals has better hardware. Score 50 = average; higher = better antenna/chipset."),
      t("Coverage Score (0\u2013100): Combines device count (how many devices seen), overlap breadth (how many other scanners share devices), and unique reach (devices only seen by this scanner)."),
      t("Reliability Score (0\u2013100): Freshness of latest advertisement (up to 35 pts), RSSI spread consistency (up to 25 pts), WiFi signal or wired connection (up to 20 pts), and scanning status (up to 20 pts)."),
      t("The comparison note in expanded detail tells you exactly how much stronger or weaker a radio reads compared to the top-ranked radio, in dBm. A 3\u20135 dBm difference is noticeable; 6+ dBm suggests meaningfully different hardware."),
    ],
  },

  // ── Calibration — Beacon Tune ────────────────────────────────────────────
  calibration_beacon: {
    title: t("Beacon Tune — Pin stationary beacons on floor plans"),
    body: [
      t("Beacon Tune lets you place stationary BLE beacons (Tiles, key fobs, fixed-location iBeacons) at their exact physical positions on your floor plans. Note: AirTags and other Find My tags change their address (every 15 min near their owner, once a day away), so pinning one only persists as long as MAC Rotation Bridging keeps the chain alive — Tile/iBeacon devices with stable UUIDs are the reliable choice for fixed pins."),
      t("Pick a map, then add beacons from the dropdown. Each pinned beacon appears as a teal diamond on the floor plan — drag it to match the real-world position."),
      t("Once pinned, PadSpan uses the known position to override the beacon's room assignment — no more flickering between adjacent rooms."),
      t("With Auto-Calibrate enabled, PadSpan automatically builds calibration fingerprints from the beacon's RSSI readings at its pinned location. This improves location accuracy for ALL tracked devices over time."),
      t("Auto-generated calibration points are labelled [auto] in the Model tab and are capped at 50 per beacon to prevent data bloat."),
      t("This is an experimental feature — it works best with stationary beacons that don't move. If you relocate a beacon, update its position on the map and the old auto-calibration data will naturally age out."),
    ],
  },

  // ── Sandbox ────────────────────────────────────────────────────────────────
  sandbox: {
    title: t("Sandbox — Experimental data playground"),
    body: [
      t("Sandbox is your data playground — explore live data, check experimental feature status, and poke around under the hood. Nothing here changes your config."),
      t("Experimental Features — status dashboard for all experimental features across PadSpan (Adaptive Learning, Floor Detection, MQTT Publishing, Ignore Bermuda, Beacon Tune). Click any row to jump to its settings."),
      t("State Inspector — current data mode, the snapshot's own timestamp, object/room/radio/advertisement counts, session uptime, and a signal-strength (RSSI) distribution histogram, all in one card."),
      t("Floor Towers — rooms grouped into a column per floor, each room a stacked colour band. Click a band for that room's details."),
      t("Live Signal Bars — per-scanner bar chart showing device count. Click any bar for scanner details."),
      t("Signal Pulse — animated room activity bubbles. Ring size reflects device count, pulsing rings indicate fresh signal activity."),
      t("Raw Snapshot Explorer — browse the live data snapshot as a collapsible JSON tree. Copy the full snapshot to clipboard for debugging."),
    ],
  },

  installbase: {
    title: t("Install Base — what the opt-in reports add up to"),
    body: [
      t("Developer view, PadSpan Pro, and the server admits only a key on its developer list — a Pro customer sees a clean refusal, not other people's houses."),
      t("Installs — lifetime (from the server's ledger, which outlives the 90-day spool), active in the last 7 days, new in the window, lapsed (silent 14+ days). Pinging = distinct update-check callers, which is the whole install base including everyone who did not opt in; Reporting = the opted-in slice."),
      t("Per day — two charts: pinging installs per day, and reporting installs per day."),
      t("Distributions — every install's latest report bucketed: version, HA version, tier, scanners, floors, rooms, maps, calibration points, IRKs, walls, lights, objects — plus which integrations are present and pinging-by-version."),
      t("BLE scan mode — which scan mode installs have chosen versus what they're actually running right now, and how many have pinned a mode versus left it on auto."),
      t("Geometry — how many installs are multi-floor, and counts of geometry issues: faulted map geometry, a faulted anchor, no metre anchor, all-default floor heights, uniform scanner Z, and calibration points with no floor assigned."),
      t("Flags — installs whose latest report carries a bad health flag. A flag is only counted where the report has the field, so zero means none bad among those that can say."),
      t("Identity — installs with IRKs registered, how many of those resolved anything in their window, how many are silent, and how many have Private BLE Device configured."),
      t("Usage, tabs, errors — summed across the window, with how many installs contributed to each."),
      t("Table — one row per install by the first 8 characters of its random id. Nothing here can name a house."),
    ],
  },

  // ── Data Mode (Live / Sample) ──────────────────────────────────────────
  data_mode: {
    title: t("Data Mode — Live vs Sample"),
    body: [
      t("PadSpan has two data modes that control where the UI gets its information:"),
      t("LIVE mode connects to your actual Bluetooth scanners and shows real device positions, signal strengths, and room assignments from your physical home. All changes you make (tagging devices, calibrating, editing maps) are saved and affect your live system."),
      t("SAMPLE mode uses built-in demo data so you can explore every feature without needing hardware. It's safe to experiment — nothing you do in Sample mode changes your real configuration."),
      t("Switch modes using the button in the top-right corner. The current mode is shown as a badge. If you see 'SAMPLE' but expected live data, click it to switch to Live."),
      t("Important: Some management actions (deleting rooms, clearing calibration) are disabled in Sample mode to prevent accidents. Switch to Live to enable them."),
    ],
  },

  // ── Complexity Mode ────────────────────────────────────────────────────
  complexity_mode: {
    title: t("Complexity Mode — Basic / Advanced / Development"),
    body: [
      t("PadSpan's complexity mode controls how many tabs and features are visible in the sidebar:"),
      t("BASIC — Shows only the essential tabs: Follow, Overview, Maps, Settings, and Training. Designed for non-technical household members who just want to see where things are."),
      t("ADVANCED — The default for power users. Shows Basic tabs plus Live Tracker, Manage, Calibration, Traceback, Occupancy, and Health. You can add more tabs (Devices, Bluetooth, Presence, Monitor, QA, Sandbox) in Settings → UI Structure."),
      t("DEVELOPMENT — Shows everything Advanced does, plus every tab in UI Structure at once (Devices, Bluetooth, Presence, Monitor, QA, Sandbox). Use this when troubleshooting issues or when Claude asks you to check diagnostic data."),
      t("Changing complexity mode doesn't delete any data — it only controls what's visible in the sidebar. Your settings, calibration, and device data are always preserved."),
    ],
  },

  // ── Overview 3D Controls ───────────────────────────────────────────────
  overview_3d_controls: {
    title: t("3D Overview Controls"),
    body: [
      t("The buttons below the 3D floor stack control what's visible on the isometric map:"),
      t("Followed (starred) devices always appear as amber beacon markers. They dim when they are away."),
      t("PINS ON shows every other identified or labelled device: a red crosshair when away, or a teal dot when present."),
      t("PINS OFF hides those markers but leaves unlabelled identified devices visible and dimmed."),
      t("WALLS — Toggles signal wall lines on the 3D map. Walls affect how PadSpan calculates signal propagation between rooms. If walls are drawn on your maps, turning this ON helps you see where signal blockage occurs."),
      t("HEAT — Shows a radio signal coverage overlay on each floor (requires Radio Map enabled in Settings → Features). Green = strong signal, red = weak. This uses your calibration data to visualize where scanners have good coverage and where dead zones exist."),
      t("WARP (labelled Signal distortion until you first turn it on) — Shows positioning error vectors (requires Distortion Map enabled in Settings → Features). Arrows point from where a device actually is to where PadSpan thinks it is, based on leave-one-out cross-validation of calibration data. Heat and Warp are mutually exclusive — turning one on switches the other off."),
      t("FLOOR SLIDER — Focuses on a specific floor or pair of adjacent floors. 'All floors' shows the full building. Focusing on a single floor makes it larger and easier to see detail."),
      t("GAP — How far apart floors are drawn, vertically, in the isometric stack. Purely visual — it does not change any stored measurement, only how tall the drawing looks."),
      t("L / R — Shifts each floor sideways relative to the one below it, so a staggered building (an upper floor that does not sit directly over the main floor) can be drawn the way it actually looks, instead of every storey stacking straight up."),
    ],
  },

  // ── Overview 2D Controls ───────────────────────────────────────────────
  overview_2d_controls: {
    title: t("2D Map Controls"),
    body: [
      t("The toggle buttons above the 2D map control which layers are visible:"),
      t("MAP — Shows/hides the floor plan image. Turn OFF for a cleaner view with just rooms and devices. Turn ON to see the actual floor plan underneath."),
      t("ROOMS — Shows/hides room boundary polygons and labels. These are drawn from the room boundaries you defined in the Maps → Edit tab."),
      t("SCANNERS — Shows/hides Bluetooth scanner (receiver) positions. Green = online, gray = offline. Scanners are the anchor points for all positioning."),
      t("TAGGED — Shows/hides devices that have been given a name (tagged). These are your known devices like phones, keys, and wearables."),
      t("UNKNOWN — Shows/hides unidentified Bluetooth devices. These are anonymous BLE signals — usually other people's phones, fitness trackers, or IoT devices passing nearby."),
      t("RADIO MAP — Signal strength heatmap overlay (requires Radio Map enabled in Settings → Features). Shows where Bluetooth coverage is strong (green) vs weak (red) based on your calibration data."),
      t("SIGNAL DISTORTION — Positioning error analysis overlay (requires Distortion Map enabled in Settings → Features). Shows where the system's predictions disagree with actual positions."),
      t("FLOOR SELECTOR — When you have multiple floors, click a floor name to switch. If a floor has multiple maps, they are stitched together into one unified view using their alignment transforms."),
      t("SCANNER SELECTOR — When Radio Map is active, choose 'Combined' to see overall coverage or click a specific scanner name to see that scanner's individual reach."),
      t("Zoom with mouse wheel. Pan by clicking and dragging. Click 'Reset zoom' to return to the default view."),
    ],
  },

  // ── Lights Build Controls ───────────────────────────────────────────────
  lights_build_controls: {
    title: t("Lights Map — Build Controls"),
    body: [
      t("The row above the map controls how it's drawn while you're arranging fixtures. Nothing here changes any device's real position or settings — it only changes what this view looks like."),
      t("SHOWCASE — Switches to the same presentation rendering the Lights sidebar uses day to day (ambient dimming, glow), instead of the flatter working view most editing is easiest in."),
      t("HIDE UNTOUCHED / UNTOUCHED (N) — Hides every fixture that has never been given a size, rotation, colour or shape of its own (only ever dropped at its default look). N is how many that currently is. Moving a fixture does not count as 'touching' it — nearly every fixture on a finished house has been moved, so that would hide almost nothing."),
      t("HIDE CODES / CODES HIDDEN — Hides the A01/M08-style code label on every marker. The marker itself, and everything you can do with it, is unchanged — this is a decluttered view only."),
      t("SHOW BEACONS / BEACONS SHOWN — Overlays working, identified beacons as read-only dots, same as the Overview map. Off by default. Their name text follows Hide Codes — turn codes off and beacon names hide too."),
      t("AUTOMORPH — Grows a soft aura behind each placed fixture toward its own room's shape. Purely a visual aura; the fixture's own icon is never changed by it. Turning it on reveals four more controls:"),
      t("  ROOM % — How far the aura reaches into the room, as a percentage of the room's own size. 0 keeps it tight to the fixture; higher lets it spread further before it fades out."),
      t("  HARDNESS — The aura's edge shape. Centre (0) is unchanged; left sharpens the edge into a spikier outline, right softens it into a smoother, rounder one."),
      t("  STYLE — Which of several distinct visual treatments (Glow / Blueprint / Nebula, …) paints the aura. Purely a look — switch freely, nothing else changes."),
      t("  SUBTLETY — How much the aura fades toward the background. 0 keeps it fully visible; higher dials it down toward barely-there."),
      t("FLOOR — Focuses the drawing on one storey (or an adjacent pair) instead of the whole stack, so a specific floor draws larger and is easier to work on."),
      t("SPACING (Gap) — How far apart floors are drawn, vertically, in the isometric stack. Purely visual — it does not change any stored measurement."),
      t("L / R — Shifts each floor sideways relative to the one below it, for a staggered building where an upper floor does not sit directly over the one below."),
      t("SAVE VIEW / RESET VIEW — Save persists the current Gap, L/R and Floor focus as everyone's default for this map; Reset puts all three back to their defaults and saves that."),
      t("ZOOM — Standard zoom in / reset to 100% / zoom out for the drawing itself. Mouse wheel and drag also work."),
    ],
  },

  // ── Settings Presence ──────────────────────────────────────────────────
  settings_presence: {
    title: t("Presence Settings — Tuning the Positioning Engine"),
    body: [
      t("These sliders control how PadSpan's positioning algorithm behaves. Changes take effect immediately."),
      t("ROOM CHANGE DELAY — How many seconds a device must consistently appear in a new room before PadSpan confirms the move. Higher = more stable (fewer false room changes), lower = faster response. Default: 20s. Range: 0–300s."),
      t("AWAY TIMEOUT — How long after a device's signal disappears before it's marked 'not_home'. If your phone briefly loses signal (e.g., in a Faraday-cage bathroom), a longer timeout prevents false 'away' events. Default: 5 minutes. Range: 1–1440 min."),
      t("SIGNAL LOSS LINGER — Extra grace period for devices with high confidence (room_confidence ≥ 0.6). Prevents established presence from being erased by brief BLE dropouts. Default: 90s. Range: 10–300s."),
      t("BLE MAX AGE — How old a Bluetooth advertisement can be before it's discarded. Older data is less reliable but can help in areas with sparse scanner coverage. Default: 120s. Range: 30–14400s."),
      t("REFERENCE POWER (dBm) — Expected RSSI at 1 meter from a scanner. Used in the path-loss model to estimate distance. Typical range: -50 to -70 dBm. If objects appear too close to scanners, lower this value."),
      t("PATH LOSS EXPONENT — How quickly signal decays with distance. 2.0 = free space, 2.5–3.5 = typical indoor, 4.0+ = heavy walls. Higher values make the system more sensitive to distance differences."),
      t("KALMAN Q (Process Noise) — How much the true RSSI is expected to vary between polls. Higher = faster response to movement, lower = smoother but slower. Default: 0.125."),
      t("KALMAN R (Measurement Noise) — How noisy raw RSSI readings are. Higher = more smoothing, lower = more responsive. Default: 8.0."),
      t("ROOM SIGMA — The Gaussian scoring radius in meters. Controls how much nearby scanners influence room assignment. Smaller = more precise but requires good scanner coverage. Default: 4m."),
      t("ADAPTIVE LEARNING — When enabled, PadSpan passively learns room RSSI fingerprints from confirmed room assignments. Over days/weeks this improves accuracy without manual calibration. No data is sent externally."),
    ],
  },

  // ── Tiers: Free, Bright, Bright Pro, Pro ─────────────────────────────────
  settings_tiers: {
    title: t("Free, Bright, Bright Pro, Pro — What Each Unlocks"),
    body: [
      t("Two separate things decide what you see and what you can do: which download you installed (PadSpan HA, the full app, or PadSpan Bright, a lighting-only download), and whether a licence key is on this install. A PadSpan Pro key unlocks the paid features (light placement, the 3D house, the wall screen, Forensics, Locate, Busy Times and more); a PadSpan Bright Pro key unlocks light placement. Which download you're running decides whether the presence-tracking half exists to unlock at all."),
      t("PADSPAN HA (this app, full) — Presence tracking, Overview, Follow, Live Tracker, Occupancy, Calibration, mapping and everything else here is free, with no key, forever. A key upgrades this install to PadSpan Pro."),
      t("PADSPAN BRIGHT — A separate, lighter download for a household that only wants lighting from a map, not presence tracking. Free forever on its own: every light shown room-by-room on a map, switched on or off, no key needed. A key upgrades a Bright install to PadSpan Bright Pro, which places each one exactly where it hangs."),
      t("PADSPAN PRO — Light placement (fixture shapes and sizes, WLED, Showcase, Fit room), the 3D house (Live Aboard), the wall screen, Forensics (which Bluetooth devices were near a given scanner in any time window, with dwell time and CSV export), Locate and Busy Times, on a full PadSpan HA install."),
      t("PADSPAN BRIGHT PRO — The same light-placement unlock as Pro, on a PadSpan Bright install. The 3D house and the wall screen need a PadSpan Pro key, and Forensics needs presence tracking to have anything to report on, so it isn't part of Bright Pro."),
      t("When a licence lapses, nothing you set up is deleted: light placement goes read-only, Forensics stops recording (what it recorded stays searchable for its retention period), the 3D house, the wall screen, Locate and Busy Times switch off, and it all comes back as you left it when you renew."),
      t("Enter or replace a key any time in Settings → Features → PadSpan licence, near the top of this tab — the same card shows this install's edition and tier and, if a key is on file, when it expires."),
    ],
  },

  // ── Settings Features ──────────────────────────────────────────────────
  settings_features: {
    title: t("Experimental Features — Preview & Test"),
    body: [
      t("These features are under active development. Enable them to preview and help test. They may change or be removed."),
      t("WALK-TO-IDENTIFY — Discover unknown BLE devices by walking into a room. PadSpan correlates signal changes with your location to identify who owns which device."),
      t("RADIO MAP — Signal strength heatmap overlay on floor plan maps. Shows coverage from calibration data — green = strong, red = weak. Appears as a toggle button in Overview (2D and 3D)."),
      t("DISTORTION MAP — Shows where calibration predictions disagree with reality. Renders error arrows on the map so you can see where walls or interference cause positioning problems."),
      t("PHONE SETUP WIZARD, MAC ROTATION BRIDGING, APPLE DEVICE CLASSIFICATION, RSSI VECTOR CAPTURE — a related group of experimental tools for phones and Apple devices that rotate their Bluetooth address, aimed at keeping a tag attached to a device through those rotations."),
      t("This tab also holds the PadSpan Pro licence card and, once you have a key, the Forensics card — a paid, time-window presence search. Turning Forensics on for the first time asks for a licence key if you don't already have one entered."),
    ],
  },

  // ── Manage Danger Zone ─────────────────────────────────────────────────
  manage_data: {
    title: t("Data Management — Handle with Care"),
    body: [
      t("This tab contains administrative actions that directly modify your Home Assistant data. Most actions cannot be undone."),
      t("ORPHAN CLEANUP — Finds room boundary polygons on maps that reference rooms/areas no longer in Home Assistant. 'Delete orphans' removes these stale references."),
      t("PHANTOM ROOM ENTRIES — A separate cleanup for stale entries left behind when a room is renamed or removed elsewhere in Home Assistant."),
      t("LABEL REMOVAL — Removes user-assigned names (tags) from BLE devices. The device will revert to showing its MAC address. The device itself is not affected — just its friendly name."),
      t("ENTITY DELETION — Removes PadSpan sensor entities from Home Assistant. This clears the entity from dashboards and automations. The device may be recreated on the next scan."),
      t("AREA DELETION — Removes an area (room) from Home Assistant's area registry. WARNING: This affects ALL integrations using that area, not just PadSpan. Integration Controls here also includes a 'Reset room colors' action."),
      t("MAP DELETION — Removes an uploaded floor plan map. Calibration data for that map is NOT automatically deleted (it becomes orphaned but can still be used if the map is re-uploaded)."),
      t("BACKUP & RESTORE — Backs up your settings, maps, placements, labels, calibration, alerts and history. Maps and placements are restored together so positions cannot be left pointing at a missing map. Always make a backup before a major change."),
      t("INTEGRATION RELOAD — Restarts the PadSpan integration without restarting all of Home Assistant. Use this after manual file changes or when things seem stuck."),
    ],
  },

  // ── Manage Factory Reset ───────────────────────────────────────────────
  manage_espresense_import: {
    title: t("ESPresense Companion Import"),
    body: [
      t("Imports floor layouts, room boundaries, and scanner/node positions from ESPresense Companion into PadSpan."),
      t("WHAT IT IMPORTS — Floors (with z-level from 3D bounds), rooms (polygon boundaries in metres), and scanner/node positions (x, y, z in metres). All coordinates transfer directly — ESPresense and PadSpan both use metres, so no conversion is needed."),
      t("WHAT IT DOESN'T IMPORT — Floor plan images (ESPresense Companion doesn't store them server-side). You still upload your own floor plan images in PadSpan's Maps tab. Device settings and calibration data are also not imported."),
      t("HOW TO USE — 1. Enter your ESPresense Companion URL (e.g., http://espresense:8267 for the HA add-on, or whatever host:port your Docker container runs on). 2. Click 'Save URL'. 3. Click 'Import Now'. PadSpan fetches the full config from Companion's REST API in a single request."),
      t("MERGE BEHAVIOUR — Import never deletes existing PadSpan data. If a floor or room already exists, it updates the geometry. If it's new, it's added. Run import multiple times safely — it's idempotent."),
      t("SCANNER ROOM ASSIGNMENT — After importing room polygons and scanner positions, PadSpan automatically determines which room each scanner is in using a point-in-polygon test. You can adjust this in the Calibration → Tune tab."),
      t("FINDING YOUR COMPANION URL — HA Add-on: check the add-on's Web UI link (usually http://homeassistant.local:8267 or the add-on sidebar). Docker: use the host and port you configured (default port 8267). The import calls GET /api/state/config on that URL."),
      t("TROUBLESHOOTING — 'Cannot reach Companion': verify the URL is correct and Companion is running. Try opening the URL in your browser — you should see the Companion web UI. 'HTTP 404': your Companion version may be too old to have the REST API. Update to the latest version."),
    ],
  },

  manage_factory_reset: {
    title: t("Factory Reset — Nuclear Option"),
    body: [
      t("Factory Reset wipes ALL PadSpan data and returns the integration to a fresh install state."),
      t("This deletes: all calibration data, all maps, all object labels/tags, all adaptive learning history, all movement history, all follow/alert configurations, all traceback recordings, and all settings."),
      t("This does NOT delete: the integration itself, your Home Assistant areas/rooms, or any non-PadSpan entities."),
      t("Consider creating a backup (Manage → Data → Backup) before proceeding — but note Factory Reset also deletes any backups stored within PadSpan itself, so a backup only protects you if you export or copy it outside PadSpan first. Factory Reset cannot be undone."),
    ],
  },

  // ── Calibration Overview ───────────────────────────────────────────────
  calibration_overview: {
    title: t("Calibration — Teaching PadSpan Your Home"),
    body: [
      t("Calibration captures real Bluetooth signal readings at known positions in your home. PadSpan uses this data to build a fingerprint model that maps signal patterns to physical locations."),
      t("SETUP — Choose which device to calibrate with (usually your phone) and verify scanner connectivity."),
      t("TUNE — Receiver position tuning: drag your scanner markers on the 3D map to match where they really are mounted. This doesn't collect signal samples — it's about getting scanner positions right before you calibrate."),
      t("BEACON TUNE — For stationary Bluetooth beacons (iBeacons, Tiles in fixed locations). Pin them on the map so PadSpan knows exactly where they are. AirTags work too but only while MAC Rotation Bridging keeps the address chain intact."),
      t("PIN & LISTEN — Classic calibration: click a spot on the map, stand there physically, and collect signal samples for 15–90 seconds (90s recommended for best accuracy). Repeat across the home."),
      t("ROAM — PadSpan shows a coverage map and marks the weakest-covered spot with a 'next target' crosshair. Walk there and press 'I'm Here — Collect.' It records one point at a time, like Pin & Listen, but chooses where you should go next."),
      t("MODEL — View calibration statistics, LOO accuracy, and per-scanner signal vs distance fits. Export or clear calibration data."),
      t("More calibration points = better accuracy. Focus on room boundaries, doorways, and areas near walls where signal transitions are sharpest."),
    ],
  },

  // ── Forensics ──────────────────────────────────────────────────────────
  forensics: {
    title: t("Forensics — Time-window presence search"),
    body: [
      t("Forensics answers: which Bluetooth devices were near my scanners between two points in time? Useful after a break-in, a package theft, or to spot an unknown tracker that keeps returning."),
      t("This is a PadSpan Pro feature — enabling it asks for a licence key. Keys are validated against the traks.ca licence server; contact hello@traks.ca for licensing."),
      t("While enabled (Settings → Features), PadSpan samples every 60 seconds in Live mode and records presence sessions — contiguous stretches during which a device was heard. A gap of more than 5 minutes closes a session."),
      t("Recorded results are devices with an actual session inside your window. Possible results only have a first-seen/last-seen span overlapping the window — they may have left and come back, so treat them as lower confidence."),
      t("Reliability: a Bluetooth address is not a person. Phones rotate their addresses every 15 minutes to 24 hours, so most phones appear as one-off addresses. Fixed-address devices (earbuds, trackers, speakers, gadgets) are what this reliably surfaces. Addresses can also be spoofed — treat results as investigative leads, not proof."),
      t("All recordings stay on your Home Assistant instance and are never uploaded. Retention is configurable (7–90 days, enforced even after you disable recording) and recorded sessions can be deleted from Settings → Features → Forensics. The Possible tier comes from the Objects first/last-seen history and is governed by the Object History Retention setting instead."),
    ],
  },

  // ── Traceback ──────────────────────────────────────────────────────────
  traceback_overview: {
    title: t("Traceback — Movement Replay"),
    body: [
      t("Traceback records a snapshot of all tracked objects every ~10 seconds and lets you play back their movement over time."),
      t("TIMELINE SLIDER — Drag to scrub through recorded frames. Each frame shows where every tracked object was at that moment."),
      t("PLAY / PAUSE — Automatically advances through frames at the selected speed."),
      t("PLAYBACK SPEED — Controls how fast playback runs. '1 min' compresses all frames into 1 minute of playback; '1 hr' plays at near-real-time speed."),
      t("OBJECT FILTER — Focus on a specific device to see only its movement trail. 'All' shows every tracked object."),
      t("Objects that never changed rooms during the recording period are hidden automatically once there are enough moving objects to make that useful — you don't need to turn this on yourself."),
      t("NEW OBJECTS HEARD — A separate search, not part of playback: shows which BLE devices were first seen within a chosen time window (e.g. \"from 30 min ago to 10 min ago\"), for spotting something new that showed up."),
      t("Object positions use matches to your calibration points (k-NN) when available (precise sub-room placement) or fall back to room centroids. Older recordings before v0.14.71 only have room-level data."),
      t("INSIGHTS and BUSY TIMES — two more modes on the same row: time-in-room tables, and which rooms are busiest and when. Both read the same history playback does."),
      t("FULL HOUSE ACTIVITY (PadSpan Pro) — an option of Playback. Turn it on and the map becomes your Atlas map, with the tracked beacons playing back on it. The same play, scrub, speed and range controls drive it."),
      t("💡 DEVICES — shown when Full house activity is on. Turn it on and the whole house plays back too: every device your Atlas draws, as it was at each moment of the chosen period — lights, locks and motion where they are drawn, doors and windows linked to a wall, and the temperature, humidity and air-quality readings of sensors placed on the map (a reading counts when it has moved a clear whole degree or percent, or its air-quality level changes). Every tracked object plays along. Each device that changed at the moment on screen is ringed on the map (a door or window along its wall) and named above it, and the list under the map shows every change — tap one to jump there. House history comes from Home Assistant's own recorder, so it reaches back as far as your recorder keeps (10 days by default); beacon history keeps 7 days."),
    ],
  },

  // ── Bluetooth View ─────────────────────────────────────────────────────
  bluetooth_overview: {
    title: t("Bluetooth — Scanner & Signal Analysis"),
    body: [
      t("Bluetooth shows exactly what each scanner is hearing."),
      t("VISUALISATION — A graph showing how scanners and devices are connected. Line and node colours show signal strength (green/amber/red); node size does not change. Click a scanner to open its details and assign it to a room."),
      t("ADVERTISEMENTS — Live feed of Bluetooth advertisements. Filter by source scanner or search by MAC address. Shows RSSI, age, and device type."),
      t("SCANNERS — Lists all Bluetooth receivers/scanners with their room, online status and other details. Click a scanner row to see the devices it is currently hearing in the panel beside it. To change its room, open the scanner details from Visualisation."),
      t("IRK MANAGER — Manages Identity Resolving Keys (IRKs) for tracking Apple/Android devices that rotate their MAC addresses. Without IRKs, these devices appear as constantly-changing random addresses. To capture IRKs from phones and watches, see the ESPHome IRK Capture tool: https://github.com/DerekSeaman/irk-capture — flash a spare ESP32, pair briefly with each device, copy the IRK, and paste it here. PadSpan resolves all rotating MACs back to a stable identity automatically."),
      t("ESPHOME CONFIGS — A library of ready-made ESPHome YAML configs for building your own scanners."),
    ],
  },

  // ── Health & System Critics ────────────────────────────────────────────
  health_critics: {
    title: t("Problems found — Automated Health Diagnosis"),
    body: [
      t("The Problems found check automatically analyses your PadSpan setup and flags issues that may affect positioning accuracy."),
      t("Each critic has a severity level: CRITICAL (red, major impact), WARNING (amber, should address), INFO (gray, minor or informational)."),
      t("ROOM CONFUSION — Detects room pairs where objects frequently bounce back and forth. High confusion means the system can't reliably distinguish between those rooms. Fix: add calibration points near the boundary, or add a signal wall in the map editor."),
      t("MAP QUALITY — Checks leave-one-out cross-validation error per map. High error means the calibration data doesn't accurately predict positions. Fix: add more calibration points, especially in areas with poor coverage."),
      t("SCANNER DISAGREEMENT — Flags scanners that consistently disagree with the consensus room assignment. Fix: check scanner placement, antenna orientation, or RSSI offset in Settings → Scanner Map."),
      t("CALIBRATION STALENESS — Warns when calibration data is old. The RF environment changes over time (furniture moves, new devices added). Fix: run a fresh calibration walk-around periodically."),
      t("PROPAGATION HEALTH — Checks adaptive learning fingerprint stability. High variance means the signal environment is noisy or changing. Fix: check for interference sources (WiFi APs, microwaves, USB3 devices)."),
      t("Each critic includes a concrete 'Action' step telling you exactly what to do to fix the issue."),
    ],
  },

  // ── Maps Edit Tools ────────────────────────────────────────────────────
  maps_edit: {
    title: t("Map Editor — Drawing Rooms & Placing Scanners"),
    body: [
      t("The map editor has four modes, selectable with the buttons at the top:"),
      t("RADIOS — Place Bluetooth scanner markers on the map. Double-click the map to add a scanner, then drag to position. Click a placed scanner to select it (shows delete button). Each scanner should be positioned where the physical device is mounted."),
      t("ROOMS — Draw room boundary polygons. Click the map to add polygon points, double-click to finish the shape. Each polygon becomes a named room. Room names should match your Home Assistant Area names exactly."),
      t("SIGNAL WALLS — Draw wall/barrier lines that block Bluetooth signal. Click to start, click to add points, double-click to finish. Choose material type: Open (Loft) for areas open to the floor above/below (0dB, no wall — only height-based attenuation applies), Brick (4dB), Concrete (8dB), Metal (12dB), or Custom for anything else (6dB unless you set your own number, 0-30dB). These are rough starting points, not measurements of your house: the Walls Guide (docs/WALLS_GUIDE.md) gives real-world ranges and what to do about old plaster-and-lath or thick stone walls. Open/Loft markers tell PadSpan that signal flows freely between floors at that boundary, reducing cross-floor stickiness. In Live Aboard an open edge over a hall that rises past it (a mezzanine or gallery, with the floor kept at its normal height in Floor Heights and the hall given its full height with Rises to in Rooms) is drawn with a railing."),
      t("MEASURE — Click two points you know the real distance between, to set or check the map's scale."),
      t("SAVE LAYOUT — Saves all changes (receivers, rooms, barriers) to the server. Changes are not saved automatically."),
      t("REVERT — Discards unsaved changes and reloads the last saved state."),
      t("Important: Room names must match HA Area names for positioning to work. If a room boundary has a different name than the HA Area, objects won't be correctly positioned in that room."),
    ],
  },

  // ── Unknown phone (Occupancy's Counted list) ────────────────────────────
  unknown_phone: {
    title: t("Unknown phone — what it is and what to do"),
    body: [
      t("An Unknown phone is a phone or watch PadSpan can hear in that room but can't tie to anyone. Phones change their Bluetooth address every few minutes for privacy (iPhones and most Androids do), so on its own the signal says \"a phone is here\" but not whose."),
      t("IF IT'S YOURS (or someone who lives with you): link the phone so PadSpan knows it. The Home Assistant Companion app with its Bluetooth sensor, or the phone's IRK under Private BLE Device in Home Assistant, both work. After that it's counted as that person."),
      t("IF IT'S A VISITOR: nothing to do. It goes when they do."),
      t("IF IT'S A NEIGHBOUR through the wall: it has to be heard by two or more of your receivers, fairly strongly, to be counted. A receiver on a shared wall makes that easy. Move that receiver away from the wall, draw the wall as a stronger material on the map (see the Walls Guide), or give that receiver a minimum signal in Bluetooth → Scanners (Ignore < -85, say): it then ignores anything weaker for positioning and this count, while every list still shows everything."),
    ],
  },

  // ── Walk-to-Identify ────────────────────────────────────────────────────
  walk_to_identify: {
    title: t("Walk-to-Identify \u2014 Who's in which room?"),
    body: [
      t("Walk-to-Identify helps you figure out which unknown Bluetooth device belongs to which person \u2014 without needing MAC addresses."),
      t("HOW IT WORKS: Select a room from the dropdown and press 'Who's here?'. PadSpan checks which unidentified devices have the strongest signal from scanners in that room, and ranks them by likelihood of being physically present there."),
      t("The score is based on signal correlation: devices heard strongly by the room's scanners but weakly by scanners in other rooms get high scores. Devices heard equally everywhere score low."),
      t("TOP CANDIDATES appear with a purple 'Likely in [Room]' badge and a match percentage. Click 'Tag' on a candidate to give it a friendly name."),
      t("TIPS: Make sure the person is actually in the room when you press the button. Works best with 4+ scanners spread across different rooms."),
    ],
  },

  // ── Maps 3D Stack ──────────────────────────────────────────────────────
  maps_stack: {
    title: t("3D Stack — Multi-Floor Alignment"),
    body: [
      t("The 3D Stack tab lets you align multiple floor plan maps so they stack correctly in the isometric building view."),
      t("FLOOR ASSIGNMENT TABLE — Set the z-level (floor number), ceiling height, and visibility for each map. Z-level 0 = ground floor, 1 = first floor, etc. Maps on the same z-level are shown as overlapping layers."),
      t("ALIGNMENT OVERLAY — Position one map relative to another by dragging, rotating, and scaling. Choose a Reference map (fixed) and a Target map (movable). Align structural features like stairwells and exterior walls."),
      t("POINT ALIGN SOLVER — For precise alignment, place matching point pairs on both maps (e.g., the same corner of a stairwell). The solver computes the optimal transform (rotation + scale + position) automatically."),
      t("COMPARE ALL MAPS — Cross-checks room boundaries across all visible maps. Shows the worst-case alignment error as a percentage. Target: <5% for good accuracy."),
      t("Accurate alignment is important because it affects how PadSpan handles cross-floor positioning and how the isometric view renders your building."),
    ],
  },
}; }

export const HELP = helpTexts();
