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
      t("In Sample mode, a sample house on three floors is shown so you can explore how the feature works without uploading anything."),
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
      t("Settings is in the menu in every mode. In Advanced and Development mode it has seven tabs: Appearance, Scanner Map, Tracking, Features, AI, Atlas and UI Structure. The small \"?\" beside each tab's name gives a short summary of it."),
      t("In Basic mode there are no tabs. Settings shows the Appearance settings, and the buttons \"Usage report →\" and \"Guest tags →\", which each open just that one card."),
      t("Appearance — room colours, Panel Style (Classic or 2025), Theme (Night, Graphite, Ocean, Dusk, High contrast, Light (inverted) or Day, with \"Follow the sun\") and 2D Map Mode. Advanced and Development mode also list your floors. Floors and rooms come from Home Assistant: add or rename them in HA Settings → Areas & Zones."),
      t("Scanner Map — where PadSpan estimates each Bluetooth scanner sits on your floor plans, worked out from your calibration points. It also has Replace Scanner (move calibration readings to a new scanner when you swap hardware), Relearn Radio (shift a scanner's readings after an antenna change) and a Clear button for each map, which deletes that map's calibration points."),
      t("Tracking — how PadSpan decides which room a device is in and when it is away, in eight sections. See \"Tracking Settings\"."),
      t("Features — the PadSpan licence card, the experimental switches and the Forensics card."),
      t("AI — the Home Assistant AI Task PadSpan can use to read photos and floor plans."),
      t("Atlas — the Atlas (the house map for lights), Live Aboard (its 3D view), wall screens, and the Atlas as your Overview."),
      t("UI Structure — which extra screens are in the main menu in Advanced and Development mode, and the Edition & tier card."),
      t("Many cards have their own Save button: nothing on that card is kept until you press it. Switches and lists on a card without one save as soon as you change them."),
    ],
  },
  settings_colors: {
    title: t("Room colours — Pick a colour for each room"),
    body: [
      t("Each room has a colour used across PadSpan's maps and diagrams."),
      t("Settings → Appearance lists every room (in Basic mode the card is called \"Room colours\", in Advanced \"Rooms\"). Click the colour box at the right end of a room's row and pick a colour."),
      t("Press \"Save floors & room settings\" when you're done. Nothing is kept until you press it; then the colours are stored in Home Assistant."),
      t("Each row also shows the room's floor (\"Floor (HA)\"). It comes from Home Assistant: change it in HA Settings → Areas & Zones."),
      t("\"All rooms\" opens the Rooms page, with every room's settings on one page. To clear every colour you picked at once, use Manage → Data → Integration Controls → \"Reset room colors\"."),
    ],
  },
  settings_manage: {
    title: t("Untagging devices and deleting rooms"),
    body: [
      t("Both are on the Manage screen, not in Settings: Manage → Data → \"BLE Device Labels\" (\"Untag\" removes a device's name) and \"HA Areas (Rooms)\" (deletes a room from Home Assistant). See \"Data Management\". Manage is in the main menu in Advanced and Development mode, and under More tools in Basic."),
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
      t("Quick status — a way to the Health page, which has the system checks and the Problems found list. Export for support — press Build export to collect the current diagnostics as JSON, then copy it (to attach to a support request or a GitHub issue). Long lists are cut to 200 entries, but every device you tagged or follow is always kept. Debug — show the values the panel is currently using for troubleshooting."),
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
      t("If you're in a different room, Locate walks a path over your drawn room-adjacency map (Mapping → Layout) and tells you which room to head to next, with the full route shown as a trail. If a floor change is needed it says so up front. If no route is drawn between the two rooms yet, it tells you the target's room and floor so you can head there directly."),
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

  receivers: {
    title: t("Receivers — every Bluetooth receiver in one table"),
    body: [
      t("One row for each Bluetooth receiver (an ESPHome proxy, a Shelly, Home Assistant's own adapter) PadSpan hears from: its room, its floor, whether it is on a floor plan, its height, its signal adjustment, how it is doing, how many devices it hears right now, and when it was last heard."),
      t("Height and signal adjustment can be changed right in the table. They are the same values as Calibration → Tune, Mapping → Edit → Radios and Settings → Tracking → Receivers: saving in one place changes them everywhere."),
      t("Status uses the same rules as the dot in the top bar: Silent means not heard for over 10 minutes, Hearing less means it hears far fewer devices than usual while the others are normal."),
      t("Place (or Move) opens Mapping with that receiver selected, to put it where it is mounted. Positions and calibration are never changed from this page."),
      t("Click a column heading to sort by it; tick Problems only to see just the receivers that need attention. In Sample mode the demo house's receivers are shown and nothing can be edited."),
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
      t("Every screen is in the sidebar in every mode. PadSpan's complexity mode decides which screens are in the main list (the rest are under More tools) and how much detail the screens show:"),
      t("BASIC — A short main list: Follow, Overview, Mapping, Rooms, Receivers, Calibration, Settings, and Training; everything else is under More tools. The screens keep to the essentials. Designed for non-technical household members who just want to see where things are."),
      t("ADVANCED — The default for power users. The main list adds Live Tracker, Manage, Traceback, Occupancy, and Health; the rest (Devices, Bluetooth, Presence, Monitor, QA, Sandbox and more) are under More tools. Tick a tab in Settings → UI Structure to move it into the main list."),
      t("DEVELOPMENT — The same menu as Advanced, with more diagnostic detail inside the screens. Use this when troubleshooting issues or when Claude asks you to check diagnostic data."),
      t("Changing complexity mode doesn't delete any data — it only changes the sidebar's main list and the detail inside screens. Your settings, calibration, and device data are always preserved."),
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
      t("WARP (labelled Signal distortion until you first turn it on) — Shows positioning error vectors (requires Signal distortion map enabled in Settings → Features). Arrows point from where a device actually is to where PadSpan thinks it is, based on leave-one-out cross-validation of calibration data. Heat and Warp are mutually exclusive — turning one on switches the other off."),
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
      t("SIGNAL DISTORTION — Positioning error analysis overlay (requires Signal distortion map enabled in Settings → Features). Shows where the system's predictions disagree with actual positions."),
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
    title: t("Tracking Settings — How rooms and presence are worked out"),
    body: [
      t("Settings → Tracking (Advanced and Development mode) is split into eight sections. Click a section's heading to fold it away or open it again; this browser remembers the ones you folded. Each heading has its own \"?\"."),
      t("Rooms and timing — how quickly a device moves to a new room, and when it counts as away."),
      t("Phones and guest tags — guest tags, and phones tracked by their IRK (Phone Tracking (Private BLE))."),
      t("What the panel shows — Quiet Mode, how long devices you never named are kept, and how long a silent device stays listed."),
      t("Positioning and calibration — how a device's room and position are worked out."),
      t("Receivers — how often Bluetooth readings are refreshed, and a signal adjustment for each receiver."),
      t("Performance — how hard PadSpan works, for small machines and for many screens."),
      t("Home Assistant and integrations — where rooms come from, GPS, simple automations, HA Tags and Bermuda."),
      t("Privacy, updates and feedback — the update check, Enhanced security, ideas and the usage report."),
      t("A card with a number box keeps a change only when you press that card's Save button. Switches and lists on a card without a Save button save as soon as you change them."),
      t("Basic mode has no Tracking tab: Settings' \"Usage report →\" and \"Guest tags →\" buttons open those two cards on their own."),
    ],
  },
  settings_tracking_rooms: {
    title: t("Tracking → Rooms and timing"),
    body: [
      t("Room Change Delay — how many seconds a device must keep reading strongest in a new room before PadSpan moves it there. Higher stops a device near a doorway flickering between two rooms; lower moves it sooner. Default 20 s, range 0–300 s. At 0 it moves on the first update that agrees (moves between far-apart rooms, and indoors to outdoors, still get the stricter checks)."),
      t("Hold Room Through Short Gaps — when a device goes quiet for a moment and comes back, the panel keeps showing the room it was in for up to this many seconds, instead of no room. It only changes what is shown, not how rooms are decided. Default 0 (off), range 0–600 s."),
      t("Why This Room (Sensor Attribute) — adds a room_reason attribute to each area sensor in Home Assistant saying why the device is in that room, such as the votes for it and the top room scores. Handy for fixing a room that keeps flipping. Off by default; it adds to what Home Assistant's recorder stores."),
      t("Home/Away Timeout — how long a device can go unheard before Home Assistant marks it away (not_home); its device tracker and area sensor both change. Raise it if devices drop out for a moment in normal use. Default 5 minutes, range 1 minute to 24 hours."),
      t("Each number box has its own Save button."),
    ],
  },
  settings_tracking_phones: {
    title: t("Tracking → Phones and guest tags"),
    body: [
      t("Guest tags — lend a tag PadSpan already knows to a guest and follow it room by room while they have it. Here you turn it on (\"Use tags as guest tags\") and choose how long a finished stay's report is kept: not kept, 7, 30 (the default) or 90 days. Off by default; while it is on, a Guests screen is in the menu. See \"Guest tags\"."),
      t("Phone Tracking (Private BLE) — track phones and watches that keep changing their Bluetooth address, using each one's IRK (Identity Resolving Key). \"Auto-Detect IRKs\" looks for keys PadSpan can find on its own; or paste a key, give it a name and press \"Add IRK\". See \"Phone Tracking (Private BLE)\"."),
    ],
  },
  guest_tags: {
    title: t("Guest tags — Lend a tag to a guest"),
    body: [
      t("A guest tag is a device PadSpan already knows by a name you gave it (a beacon, a Find My tag, a spare phone), lent to a house-sitter, a visitor or a cleaner. While they have it, PadSpan follows it room by room."),
      t("Turn it on in Settings → Tracking → Phones and guest tags → Guest tags (\"Use tags as guest tags\"); in Basic mode, Settings → \"Guest tags →\". You are asked to confirm. On the same card, choose how long a finished stay's report is kept: not kept, 7, 30 (the default) or 90 days. While it is off nothing is tracked or kept, and the Guests screen is hidden."),
      t("The Guests screen: \"Staying now\" shows each stay running now (who, which tag, the room they are in, how long so far). \"Guest tags\" lists your guest tags, each with \"Lend to a guest\"; \"Use as a guest tag:\" adds another device you have named (name a spare tag first, like \"Guest tag 1\"). \"Past stays\" keeps each finished stay's report: when they arrived and left, time in each room, and visits to rooms they shouldn't go into."),
      t("Lending a tag starts a stay. Give the guest's name, an end time if you like, the rooms they shouldn't go into (you are told if they are there for half a minute), whether to be told when they arrive or leave, quiet hours, and where the notices go. \"Staying here (a house-sitter)\" counts them as someone home for Vacation Mode. \"Tag returned\" ends the stay and keeps its report."),
      t("Tell your guests the tag is tracked. Guests' names stay in this Home Assistant: never in the usage report, never in a backup. Only an administrator can lend a tag or end a stay."),
    ],
  },
  private_ble: {
    title: t("Phone Tracking (Private BLE) — Phones that change their address"),
    body: [
      t("iPhones, Apple Watches and many Android phones change their Bluetooth address every few minutes for privacy, so on their own they show up as a string of unknown devices. An IRK (Identity Resolving Key) is a key the phone shares with devices it is paired with. With it, PadSpan recognises each new address as the same phone."),
      t("Where: Settings → Tracking → Phones and guest tags → \"Phone Tracking (Private BLE)\" (Advanced and Development mode), or Bluetooth → IRK Manager."),
      t("\"Auto-Detect IRKs\" looks for the keys of phones already paired with the Home Assistant machine's own Bluetooth, and keys already in Home Assistant's Private BLE Device integration, and offers to add each new one."),
      t("To add one yourself, paste the IRK, give the device a name and press \"Add IRK\". The phone must be awake, with Bluetooth on, near a receiver: PadSpan checks for up to 30 seconds that the key matches the phone's live addresses, then saves it. If it finds no match it says so and offers \"Save Anyway\", \"Retry\" or \"Cancel\". \"Detailed Setup Guide\" explains how to get the IRK from each kind of device. In Bluetooth → IRK Manager the same is \"Add & validate\", and \"Test Only\" checks a key without saving it."),
      t("The key is saved in Home Assistant as a Private BLE Device. Once it matches, the phone is one device with a blue \"Private BLE\" badge (Devices → By Room), in Follow, calibration and everywhere else."),
      t("\"Delete from HA\" removes that Private BLE Device from Home Assistant itself, not just from PadSpan; you would need the IRK to add it again. It asks twice."),
      t("The Companion app's BLE Transmitter is the other way to track a phone (an iBeacon, amber badge), but iPhones don't have it, so an IRK is the way for an iPhone. Settings → Features → \"Phone Setup Wizard\" and \"iPhone Setup Path\" add guided steps in the IRK Manager. AirTags and other Find My tags are neither: see MAC Rotation Bridging in Settings → Features."),
    ],
  },
  settings_tracking_shown: {
    title: t("Tracking → What the panel shows"),
    body: [
      t("Quiet Mode — hides unidentified Bluetooth devices from the Objects list, the Overview counts and the dropdowns, so only devices you named or follow are shown. Scanning carries on and nothing is deleted. This card only explains it: switch it with the Quiet tick at the top of the Overview (the card's button takes you there)."),
      t("Object History Retention — how long a device you never named is kept in history: 1 day (the default), 2, 7 or 14 days. Devices you named are never removed. A longer time makes the panel slower, because the whole list is sent to it at every refresh. Press Save after choosing."),
      t("BLE Advertisement Timeout — how long a device stays listed after it was last heard. Higher keeps slow-broadcasting devices on the list; lower keeps the list shorter. Default 14400 s (4 hours), range 60–14400 s; press Save. While Low-memory mode is on it is held to 900 s (15 minutes)."),
    ],
  },
  settings_tracking_positioning: {
    title: t("Tracking → Positioning and calibration"),
    body: [
      t("Positioning Algorithm — \"Matched to calibration points\" (the default) compares a device's live signals with your calibration points, and works well even with few scanners. \"Learned model (experimental)\" learns from the same calibration points and only does better where several scanners hear every spot; until it is trained, PadSpan keeps matching calibration points. Switching is instant and safe."),
      t("Positioning Choices — three switches, all off by default. \"Pick the better method for this house\" uses whichever way of placing devices (from the receivers' positions, or from your calibration points) did better on calibration spots it had not seen. \"Mark a room as unsure when the signal is thin\" keeps a device's room, marked unsure, when fewer than 3 scanners hear it or no calibration point matches it well. \"Use motion sensors and usual moves to break ties\" lets a motion, occupancy or presence sensor, and the room-to-room moves PadSpan has learned, decide between two rooms that read almost the same."),
      t("Walk a Room (Calibration) — adds a \"Walk a room\" tab to Calibration: walk slowly around one room for 90 seconds, then save the walk as calibration points if you want it. Off by default."),
      t("Distance Calibration — the two numbers PadSpan uses to turn signal strength into distance, for the distance sensors and when it places a device from where the receivers are. Reference power is the signal a receiver reads from a phone 1 metre away: default −59 dBm, range −100 to 0. Path-loss exponent is how fast the signal fades: default 2.5, range 1–4 (about 2 in open space, 2.5–3.5 indoors). If distances come out too short, raise the reference power (towards 0); if too long, lower it. Press Save."),
      t("Signal smoothing — evens out jumpy signal readings before rooms are worked out (see \"For experts\" below)."),
      t("3D Positioning — Device Height — how high above the floor a device is usually carried: 1.0 m (the default) suits a phone in a pocket or a watch; lower it for tags near the floor, such as a pet collar or a robot vacuum. Range 0–3 m."),
      t("Calibration Accuracy Reminders — \"Check Now\" looks for gaps, old readings and odd scanners in your calibration points and suggests a few spots to stand at with your beacon for 60 seconds each. The tick box turns the reminders on; off by default."),
      t("Adaptive Learning (experimental) — learns each room's signal pattern from rooms PadSpan is already sure of, and which room-to-room moves are usual, so rooms get steadier over days without more calibration. \"Enhance floor-to-floor detection\" also learns how signals change between floors (it needs scanners on more than one floor). \"Reset Learned Data\" clears what it learned; your calibration points are kept. Off by default."),
      t("Positioning Test Mode — \"Suspend All Databases (60 min)\" makes PadSpan ignore everything it has learned or smoothed and place devices from the raw radio signals only, to find out whether learned data is causing wrong rooms. Your calibration points and settings are kept. Press \"Resume Normal Pipeline\" when you're done; until you do, it carries on, even after a Home Assistant restart."),
      t("For experts: Signal smoothing is a Kalman filter on each receiver's RSSI (received signal strength, in dBm). Process noise Q (default 0.125, range 0.01–1.0): higher follows real movement faster, lower smooths more. Measurement noise R (default 8.0, range 0.5–50): higher trusts each single reading less, so it smooths more but notices a room change later. Distance uses the log-distance formula: distance (m) = 10 ^ ((reference power − RSSI) ÷ (10 × path-loss exponent))."),
    ],
  },
  settings_tracking_receivers: {
    title: t("Tracking → Receivers"),
    body: [
      t("Bluetooth refresh interval — how often PadSpan fetches the latest Bluetooth readings from Home Assistant. It matters most for passive receivers (Shelly, ESPHome Bluetooth proxies), whose readings don't arrive on their own. Default 30 s, range 1–60 s; press Save."),
      t("\"Refresh every 5 s for passive proxy scanners\" — tick this if Shelly or other passive receivers show no signal readings during calibration. It refreshes every 5 seconds instead, using a little more CPU; it works around a change in Home Assistant 2026.4."),
      t("Receiver signal adjustments — shown once receivers are heard: a row for each, with a manual adjustment from −20 to +20 dB (press that row's Save). Only the number you save is used. The \"suggested\" figure beside it is half the gap between this receiver's typical reading and the others', from live data: a starting point for a receiver whose hardware reads weaker or stronger. A far-away receiver reads weaker because of the distance, not its hardware, so don't copy its suggestion blindly. \"All receivers\" opens the Receivers page, where the same adjustment can be changed."),
    ],
  },
  settings_tracking_performance: {
    title: t("Tracking → Performance"),
    body: [
      t("Presence Poll Interval — how often PadSpan updates rooms. Lower is quicker but uses more CPU; raise it on a slow machine. Default 5 s, range 1–60 s; press Save. (10 s was the default before PadSpan 0.21.)"),
      t("CPU Mode — where that work runs. \"Shared\" (the default) runs it alongside Home Assistant: fastest, but it can slow Home Assistant on a small machine like a Raspberry Pi. \"Single core\" moves it to a background worker held to one core, so Home Assistant stays responsive. \"Dedicated core\", offered only where the system allows it, also gives that worker a core of its own. It applies from the next update, with no restart."),
      t("Low-memory mode — for a Home Assistant machine with 2 GB of memory near a busy street, where PadSpan hears thousands of passing devices. It caps them: passing devices nobody identified are kept 15 minutes instead of up to 4 hours, and at most 2,000; the device list keeps at most 2,000 unidentified devices, for 1 day at most; the Monitor's advertisement list shows at most 2,000. Devices you named, labelled or follow, positioning, the Atlas and Live Aboard are not affected. Off by default."),
      t("Optimize for scale — for several wall screens or tablets showing PadSpan at once. The Overview and the Atlas's 3D people then ask Home Assistant only for what they draw, screens that update at nearly the same moment share one update, and a screen that is hidden asks for nothing. Monitor, Devices, Bluetooth and the other screens still get everything. Off by default; each screen picks it up within 30 seconds."),
    ],
  },
  settings_tracking_integrations: {
    title: t("Tracking → Home Assistant and integrations"),
    body: [
      t("Room and receiver layout source — \"Follow Home Assistant areas\" (the default) takes your rooms from Home Assistant's areas. \"Standalone\" lets PadSpan run with rooms you created in PadSpan and no Home Assistant areas at all: PadSpan's own record of your rooms and receivers is then the only one."),
      t("GPS Bridge — fill in the origin latitude, longitude and a bearing, and each tracked device's device tracker also reports a latitude and longitude, so it shows on Home Assistant's map; its room name still shows too. Leave latitude and longitude blank to turn it off. Bearing is the compass direction, clockwise from true north, that points down your floor plan as it is drawn: for a plan drawn with north at the top it is 180."),
      t("Automations — simple rules: when a named device arrives or departs, turn a light, switch, scene or script on or off (\"Add Rule\"). Each rule can be switched off or deleted. For anything more, use the padspan_device_arrived and padspan_device_departed events PadSpan fires in Home Assistant for named devices."),
      t("HA Tags Integration — three switches for Home Assistant's Tags: \"Room-change tag events\" (a tag_scanned event when a followed device changes room, for your own automations), \"NFC tap-to-identify\" (scan an NFC tag near an unidentified Bluetooth device to name and follow it) and \"Phone auto-link on NFC scan\" (a phone that scans any NFC tag has its BLE Transmitter found and followed)."),
      t("Ignore Bermuda (experimental) — ignore everything from the Bermuda integration (its devices, receivers and entities), to check whether something odd comes from Bermuda. Press \"Refresh Snapshot\" after changing it."),
    ],
  },
  settings_tracking_privacy: {
    title: t("Tracking → Privacy, updates and feedback"),
    body: [
      t("Update Check — once a day PadSpan asks padspan.traks.ca whether a newer version exists. Only your version number is sent (the server sees your IP address, as with any web request). On by default; turning it off stops the check. If you entered a licence key, it is still checked with traks.ca once a day."),
      t("Enhanced security — when it is on, only a Home Assistant administrator can change how PadSpan is set up for this home (devices, calibration, the layout, alerts and the rest the card lists, and display settings that change every screen in the home). Everyone else can still use the maps, Follow, the lights and the choices kept in their own browser. Off by default; only an administrator can switch it."),
      t("Suggest an idea — post an idea where others can vote on it, see and vote on ideas already there, or email one. Not shown on a wall screen."),
      t("Help improve PadSpan — an anonymous usage report, at most once a day, off until you opt in (in Basic mode, Settings → \"Usage report →\"). It sends counts, versions and which switches are on, never addresses, keys, device or room names, positions or times. \"Preview what would be sent\" shows the exact report, \"Send a report now\" sends one, and \"New anonymous ID\" replaces its random ID. A free licence (a trial, a tester's or a free year) keeps it on until that licence ends. While it is on, you can also sign up as a tester here."),
    ],
  },

  // ── Tiers: Free, Bright, Bright Pro, Pro ─────────────────────────────────
  settings_tiers: {
    title: t("Free, Bright, Bright Pro, Pro — What Each Unlocks"),
    body: [
      t("Two separate things decide what you see and what you can do: which download you installed (PadSpan HA, the full app, or PadSpan Bright, a lighting-only download), and whether a licence key is on this install. A PadSpan Pro key unlocks the paid features (light placement, the 3D house, the wall screen, Forensics, Locate, Busy Times and more); a PadSpan Bright Pro key unlocks light placement. Which download you're running decides whether the presence-tracking half exists to unlock at all."),
      t("PADSPAN HA (this app, full) — Presence tracking, Overview, Follow, Live Tracker, Occupancy, Calibration, mapping and everything else here is free, with no key, forever. A key upgrades this install to PadSpan Pro."),
      t("PADSPAN BRIGHT — A separate, lighter download for a household that only wants lighting from a map, not presence tracking. Free forever on its own: every light shown room-by-room on a map, switched on or off, no key needed. A key upgrades a Bright install to PadSpan Bright Pro, which places each one exactly where it hangs."),
      t("PADSPAN PRO — Light placement (fixture shapes and sizes, WLED, Showcase, Fit room), the 3D house (Live Aboard), the wall screen, Forensics (which Bluetooth devices were near a given scanner in any time window, with dwell time and CSV export), Locate, Busy Times, whole-house presets with Vacation Mode, and the Graphite, Ocean, Dusk and Day themes, on a full PadSpan HA install."),
      t("PADSPAN BRIGHT PRO — The same light-placement unlock as Pro, on a PadSpan Bright install. The 3D house and the wall screen need a PadSpan Pro key, and Forensics needs presence tracking to have anything to report on, so it isn't part of Bright Pro."),
      t("When a licence lapses, nothing you set up is deleted: light placement goes read-only, Forensics stops recording (what it recorded stays searchable for its retention period), the 3D house, the wall screen, Locate and Busy Times switch off, and it all comes back as you left it when you renew."),
      t("Enter or replace a key any time in Settings → Features → PadSpan licence, near the top of this tab — the same card shows this install's edition and tier and, if a key is on file, when it expires."),
      t("FREE TRIAL — While no key is on an install, PadSpan offers all of PadSpan Pro free for 90 days, no card, one trial per home (\"Start 90-day free trial\", on the PadSpan licence card and where you meet a Pro feature). An administrator starts it. It needs the usage report on (Settings → Tracking → Help improve PadSpan), and the report stays on until the trial ends."),
    ],
  },

  // ── Settings Features ──────────────────────────────────────────────────
  settings_features: {
    title: t("Features — Licence, experimental switches and Forensics"),
    body: [
      t("Settings → Features (Advanced and Development mode) starts with the PadSpan licence card: this install's edition and tier, \"Enter licence key\" or \"Replace licence key\", and \"What does each tier unlock?\". See \"Free, Bright, Bright Pro, Pro\"."),
      t("Below it are the experimental switches. They may change or be removed later. Each saves as soon as you tick it; all start off except iPhone Setup Path, which is on for new installs."),
      t("Walk-to-Identify — find out which unknown Bluetooth device belongs to whom: someone stands in a room and you ask \"Who's here?\"."),
      t("Radio Map — a signal-strength overlay on the Overview maps, from your calibration points: green is strong, red is weak."),
      t("Signal distortion map — arrows on the Overview maps showing where your calibration points disagree with where PadSpan would place a device."),
      t("RoomPlan Import — lets Mapping → Layout import an Apple RoomPlan scan (.json). You check the rooms before anything is saved."),
      t("Robot Vacuum Import — lets Mapping → Layout import a robot vacuum's map (Valetudo, Dreame or Xiaomi) as a new floor plan. Administrators only."),
      t("Phone Setup Wizard — a guided setup in Bluetooth → IRK Manager for adding a phone or watch by its IRK."),
      t("iPhone Setup Path — iPhones have no BLE Transmitter in the Companion app, so an iPhone gets the IRK steps instead, in Overview's phone list and the IRK Manager's phone wizard."),
      t("MAC Rotation Bridging — when a device's Bluetooth address changes, links the old address to the new one. An AirTag or other Find My tag you named or follow carries on to its new address only when it is clear which one it is."),
      t("Apple Device Classification — says what sent an Apple Find My signal (an AirTag, another brand's Find My tag, AirPods, or an Apple device) instead of just \"Find My\". A label only: tracking doesn't change."),
      t("RSSI Vector Capture — adds a Record button to Health → Quick actions. A recording keeps every receiver's signal reading for every tracked device, with the room PadSpan chose, so the same walk can be replayed later against changed settings. It stops itself at 60 minutes or 25 MB."),
      t("The Forensics card is always at the bottom of this tab. \"Enable presence-session recording\" asks you to confirm and, if this install doesn't have PadSpan Pro, asks for a licence key. The card also sets how long sessions are kept and has \"Delete all recorded data\". See \"Forensics\"."),
      t("Adaptive Learning isn't here: it is in Settings → Tracking → Positioning and calibration."),
    ],
  },
  settings_ai: {
    title: t("AI — Let your own AI fill things in"),
    body: [
      t("Settings → AI (Advanced and Development mode). PadSpan can use an AI you have already set up in Home Assistant (an AI Task; Home Assistant 2025.8 or newer) to read photos and floor plans for you. Nothing here runs until you pick an AI Task and use a feature that needs it. It reads only what you give it, when you ask, and keeps nothing. Each choice saves as soon as you change it."),
      t("\"AI Task\" — pick one whose model can read pictures (a vision model). If the list is empty, first add an AI integration with a vision model to Home Assistant: a local one such as Ollama, or a cloud one."),
      t("\"Backup AI task\" — optional. It is used automatically when the main one can't be reached, for example when the main one runs on a computer that's away from home. A main one that is only slow is never cut short. \"None\" means no backup."),
      t("\"Furniture from a photo\" (on by default) — in Live Aboard's Furnish, photograph a sofa, a bed or a lamp and the AI fills in its kind, style, colours and size. It takes a quick look first to name the piece, then reads that kind's details; when the quick look isn't sure, it does the full read instead. Telling it what the piece is first is quicker. It asks you for one real measurement unless something in the photo shows the scale."),
      t("\"Stairs from your floor plans\" (off by default) — adds \"Read stairs off the plans (AI)\" to Live Aboard's Furnish → Build ▾ → House. The AI looks for stairs on each floor plan you placed and puts them in as a first guess: check where each one stands and which way is up, then move, turn or delete it. A small AI on your own computer finds most staircases but often gets their shape or direction wrong; a cloud AI reads plans better."),
      t("The two marked COMING SOON can't be switched on yet."),
      t("Privacy: a cloud AI (such as OpenAI, Google or Home Assistant Cloud) sends the photo or plan out of your house to that company; a local one (such as Ollama) keeps it at home. A photo or plan is sent only when you press the button that reads it."),
    ],
  },
  settings_atlas: {
    title: t("Atlas — The house map, Live Aboard and wall screens"),
    body: [
      t("Settings → Atlas (Advanced and Development mode). The Atlas is PadSpan's house map for everyday light control; Live Aboard is its 3D view."),
      t("\"Show the Atlas in the Home Assistant sidebar\" — on by default. Press Save, then restart Home Assistant for the change to show."),
      t("\"Show the Test emergency lighting button on the Atlas\" — the red button appears only when the house has emergency lights; untick this to hide it."),
      t("\"Draw lit lights in their own colour on the Atlas\" — a colour bulb in its colour, a white bulb warm or cool. Off: lit lights are amber, as always. Showcase always uses their colours."),
      t("\"Alert pulse\" — off by default. A door left open, or a window or cover open while it rains, rings its room in amber. On a wall screen, a banner across the top names the worst alert and where it is until it clears."),
      t("Heatmap chip (PadSpan Pro) — adds a ♨ chip to the Atlas's layer bar showing temperature, humidity and CO₂ across each room, from that room's own sensors."),
      t("Outdoor weather — rain or snow drawn around the house on the Atlas, only while it is actually raining or snowing, from a weather entity or one picked automatically, with weather warnings. PadSpan Pro animates it; the free map shows it still."),
      t("Live Aboard (PadSpan Pro, experimental) — \"Show Live Aboard on the Atlas\" adds a Map / Live Aboard switch to the Atlas: walk around your floors, rooms, walls, lights and furniture, built from the map you already drew. Off by default. Its other options are in the same box."),
      t("📺 Wall screens (PadSpan Pro) — the Atlas page opened as /padspan-lights?kiosk=1 is a wall screen: the whole house fits on it, and its controls and names are sized from the screen, or for your room and viewing distance. Night dimming and burn-in protection are here too. Wall screens need the Atlas's new layout (Mapping → Atlas → ▦ New layout)."),
      t("Overview — the Atlas as your main map (PadSpan Pro): \"Show the Atlas as Overview\" makes Overview show the Atlas instead of the classic map. The classic Overview moves under Live Tracker, which gets a switch between the two."),
      t("Everything here saves as soon as you change it and the Atlas follows at its next refresh, except the sidebar entry, which needs Save and a restart."),
    ],
  },
  settings_ui: {
    title: t("UI Structure — The main menu, edition and tier"),
    body: [
      t("Settings → UI Structure (Advanced and Development mode). Every screen is in the menu in every mode; the ones not in the main list are under More tools. Tick Devices, Bluetooth, Presence, Monitor, QA or Sandbox and press Save to list it in the main menu in Advanced and Development mode. Basic keeps its short list."),
      t("Edition & tier — which download this is (PadSpan HA, the full app, or PadSpan Bright, the lighting-only one) and the tier it is running at (free, bright or pro), which the licence key decides. Enter a key in Settings → Features → PadSpan licence. See \"Free, Bright, Bright Pro, Pro\"."),
      t("On a PadSpan Bright install, \"Show the presence tabs too (Overview, Follow, Calibration, …)\" brings back the presence-tracking screens."),
      t("In Development mode, \"Look at this install as tier:\" shows the panel as a lower tier sees it. It can only lower the tier, never raise it past the licence."),
      t("The Atlas, Live Aboard and wall screen settings are on the Atlas tab (\"Open Settings → Atlas\")."),
    ],
  },

  // ── Manage Danger Zone ─────────────────────────────────────────────────
  manage: {
    title: t("Manage — Data, entities and housekeeping"),
    body: [
      t("Manage is in the main menu in Advanced and Development mode, and under More tools in Basic. It has seven tabs: Data, HA Entities, Beacon Characteristics, History, Events, Logs and Factory Reset. (Settings has no Manage tab.)"),
      t("Data — clean-ups and deletions: orphan room shapes, device names (BLE Device Labels), phantom room entries, Home Assistant entities and areas, uploaded maps, Backup & Restore, and Integration Controls."),
      t("HA Entities — the entities PadSpan creates in Home Assistant, which kinds it creates, and the MQTT, ESPresense and Tasmota connections."),
      t("Beacon Characteristics — a report of how each beacon reads in your calibration points."),
      t("History — a button that opens History → Movement, the saved list of room changes."),
      t("Events — alerts by email or phone when a device changes room, and this session's room-change log."),
      t("Logs — PadSpan's recent log messages."),
      t("Factory Reset — erase all of PadSpan's data and start again."),
      t("Actions that change or delete something need Live mode; in Sample mode their buttons are greyed out."),
    ],
  },
  manage_data: {
    title: t("Data Management — Handle with Care"),
    body: [
      t("Manage → Data changes your PadSpan and Home Assistant data directly, and most of it can't be undone. Its buttons work only in Live mode; in Sample mode they are greyed out. Each deletion asks first (\"Yes\" or \"No\"/\"Cancel\"); deleting a Home Assistant area, or another integration's entity, asks twice."),
      t("Orphan Room Polygons — shown only when there are some: room shapes drawn on a map whose room no longer exists in Home Assistant (often left over from the sample house). Delete them one at a time, or all at once with \"Delete ALL orphans\" (shown when there is more than one)."),
      t("BLE Device Labels — every Bluetooth device you named, with its address, its name and when it was last seen. \"Untag\", then \"Yes\", removes the name: the device goes back to showing its address and is still tracked. \"Remove all labels\" removes every name."),
      t("Phantom Room Entries — shown only when there are some: entity IDs in PadSpan's room map that no longer exist in Home Assistant (left over from the sample house or an earlier install). \"Clear phantom room data\" removes them from PadSpan only; no Home Assistant entity is changed."),
      t("HA Entities — permanently deletes an entity from Home Assistant's entity registry, to tidy up old or duplicate trackers. Automations that use it will break. An entity that belongs to an integration that is still running (Bermuda, for example) comes back at that integration's next update; to stop that, disable the device or the integration in Home Assistant."),
      t("HA Areas (Rooms) — deletes an area from Home Assistant itself, not just from PadSpan: every device and entity in it becomes unassigned, for every integration, and its room colour is lost. Add it again in HA Settings → Areas & Zones if you need to."),
      t("Uploaded Maps — deletes a floor plan, together with that map's calibration points. Traceback recordings stop pointing at it, and it is taken off the list of hidden maps. Make a backup first if you might want them back."),
      t("Backup & Restore — \"Create Backup\" saves PadSpan's data: settings, calibration, maps and their images, labels, alerts, history, Live Aboard and more. \"Restore…\" lets you tick what to bring back; maps and the room model are restored together, so positions can't point at a missing map. Backups are kept inside PadSpan, so a Factory Reset deletes them too."),
      t("Integration Controls — \"Reload integration\" restarts PadSpan without restarting Home Assistant (useful when things seem stuck). \"Reset room colors\" clears every room colour you picked; colours are then made from the room names again."),
    ],
  },
  manage_entities: {
    title: t("Manage → HA Entities"),
    body: [
      t("The entities PadSpan creates in Home Assistant for each Bluetooth device you named, and the other ways it can take in or send out data."),
      t("Entity Reference and Entity Type Library — what each kind of entity is for, its states and attributes, with automation examples ready to paste."),
      t("Entity Publishing Controls — untick a kind you don't need: the device tracker, the area sensor, the distance sensors, the occupancy sensor or the sub-zone sensors. Existing ones are disabled in Home Assistant, and ticking it again brings them back. Reload the integration (Manage → Data → Integration Controls) for new devices to follow the change."),
      t("Live Entity Inventory — every PadSpan entity in Home Assistant, with its state, its health and the automations that use it, and tips such as sensors nothing uses."),
      t("MQTT Publishing (experimental) — also publish each device's state, room and distance to MQTT (topics under padspan/devices/), for Node-RED or other systems. Needs Home Assistant's MQTT integration."),
      t("BLE Proxy Compatibility — says whether the 5-second Bluetooth refresh for passive receivers is on. The switch is in Settings → Tracking → Receivers."),
      t("ESPresense MQTT (experimental) — take receiver data from ESP32 boards running ESPresense firmware, over MQTT (topic prefix \"espresense\" unless you change it). The same card has \"Import from ESPresense Companion\"."),
      t("Tasmota BLE (experimental) — use Tasmota devices on ESP32 (smart plugs, Sonoff switches) as receivers, over MQTT. The card lists the console commands each one needs."),
    ],
  },
  manage_espresense_import: {
    title: t("Import from ESPresense Companion"),
    body: [
      t("If you already drew your house in ESPresense Companion, this copies its floors, room outlines and receiver (node) positions into PadSpan, so you don't have to draw them again. Floor plan pictures aren't imported (Companion doesn't keep them): add yours in Mapping → Upload. Calibration points and device settings aren't imported either."),
      t("Where: Manage → HA Entities → the ESPresense MQTT card → \"Import from ESPresense Companion\". Only an administrator can run it."),
      t("How: type the address you open Companion's web page at (it usually ends in :8267) into \"Companion URL\", press \"Save URL\", then \"Import Now\"."),
      t("It only adds. A floor or room PadSpan already has is kept as it is (it counts as skipped); new ones are added. Receivers come in named espresense_ followed by the node's ID, so your other receivers are never touched. Running it again is safe: an imported receiver's position is taken from Companion again, but a room you gave it yourself is kept."),
      t("Each imported receiver is put in the room whose outline it stands in. Check where they landed on the Receivers page. The result line shows how many floors, rooms and receivers came in, and how many were skipped."),
      t("If it fails: \"Cannot reach ESPresense Companion\" means the address is wrong or Companion isn't running; open the same address in your browser to check. \"HTTP 404\" usually means Companion is too old: update it."),
      t("For experts: it reads Companion's GET /api/state/config in one request. Both use metres, so no coordinates are converted."),
    ],
  },
  manage_beacon_chars: {
    title: t("Manage → Beacon Characteristics"),
    body: [
      t("Beacon Signal Profiles: how each beacon reads in your calibration points (its average signal, how much that varies, how many receivers hear it, its transmit power), grouped by model (iBeacon UUID, maker, Bluetooth name). It is only a report: nothing here changes positioning."),
      t("\"Beacon profiles\" (Shown / Hidden) shows or hides the report. \"Refresh Profiles\" works it out again. \"Ungroup\" puts one beacon on its own row and \"Regroup\" puts it back, in the report only. \"Show per-scanner details\" opens each receiver's figures."),
      t("Nothing listed? Collect calibration points with a beacon first, for example with Calibration → Beacon Tune."),
    ],
  },
  manage_events: {
    title: t("Manage → Events — Alerts and this session's room log"),
    body: [
      t("Saved Alerts lists every alert you set up, by email or a Home Assistant notify service: the device, where it goes, the rooms watched, and a button to delete it."),
      t("Configure Alerts sets one up: pick a device, type an email address or choose a notify service (\"Auto-detect\" finds one), tick \"Alert on room change\", tick only some rooms if you like (none ticked means every room), then press \"Save Alert\". \"Test Notification\" sends one now. Needs Live mode. The same alerts can be set on Follow."),
      t("\"No notification services found\" means Home Assistant has nothing to send through yet: set up the Companion app on a phone, or a mail integration such as SMTP, then press \"Refresh Services\"."),
      t("Below that is this session's room-change log: every room change of your tracked tags since you opened the page, newest first. It clears when you reload the page; the saved history is in History → Movement."),
    ],
  },
  manage_logs: {
    title: t("Manage → Logs"),
    body: [
      t("PadSpan's own recent log messages, newest first: the time, the level, which part of PadSpan wrote it, and the message. Hover over a line to see its full date."),
      t("\"Min level:\" picks how much to see: DEBUG shows everything, WARNING and ERROR only problems. \"Refresh\" fetches the latest. Up to 300 lines are shown, from the last 500 kept since Home Assistant started."),
      t("Useful when asking for support: copy the warnings and errors from around the time something went wrong."),
    ],
  },

  // ── Manage Factory Reset ───────────────────────────────────────────────
  manage_factory_reset: {
    title: t("Factory Reset — Start again from nothing"),
    body: [
      t("Manage → Factory Reset erases all of PadSpan's data and returns it to a fresh install. It can't be undone. It needs Live mode and a Home Assistant administrator."),
      t("Erased: calibration points and models, uploaded maps with their room shapes and receiver positions, room colours and floor assignments, device names, follow alerts, movement history and Traceback recordings, learned data, settings and receiver adjustments, Live Aboard, guest tags, Forensics recordings, and every backup kept inside PadSpan."),
      t("Kept: your licence key (and trial), Vacation Mode's learned routine and past trips (a reset turns Vacation Mode off), a tester sign-up, your answer to a Pro invite, and the usage report while a free licence holds it on. Home Assistant's own areas, floors, entities and devices are not touched."),
      t("How: type FACTORY RESET in the box, press \"Erase All Data & Reset\", confirm the final warning, wait for the steps to finish, then press \"Reload Page\". No Home Assistant restart is needed. Your Bluetooth receivers keep working, and devices come back as they are heard again."),
      t("Backups are erased too, so a backup made in Manage → Data doesn't survive the reset."),
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
      t("Forensics answers: which Bluetooth devices were near my receivers between two times? For example after a break-in or a package theft, or to spot an unknown tracker that keeps coming back. It is a PadSpan Pro feature."),
      t("Turn it on in Settings → Features → Forensics → \"Enable presence-session recording\". It asks you to confirm and, if this install doesn't have PadSpan Pro, for a licence key. While it is on, Forensics is in the menu (under More tools). In Live mode PadSpan checks every 60 seconds which devices it hears and records presence sessions: stretches of time a device was heard. More than 5 minutes of silence ends a session."),
      t("Search: pick a start and an end time (times are local), or press \"Last hour\", \"Last 24 h\" or \"Last 7 days\", then press \"Search window\"."),
      t("\"Recorded — actually present\" lists the devices with a recorded session in the window, the longest stay first: its sessions, time in the window (Dwell), strongest signal, and the receivers that heard it. \"Hide my labelled devices\" hides the ones you named, so strangers stand out. \"Export CSV\" saves the results."),
      t("\"Possible\" appears only when the window reaches back before recording began: devices whose first-seen/last-seen times overlap the window but have no recorded session in it. They may have left and come back, so treat them as less certain. They come from the device list's first/last-seen history (Devices → By Room), which is kept as long as Settings → Tracking → What the panel shows → Object History Retention says."),
      t("Reliability: a Bluetooth address is not a person. Phones change their address every 15 minutes to 24 hours, so most phones show as one-off addresses; devices with a fixed address (earbuds, trackers, speakers, gadgets) are what this finds reliably. Addresses can also be faked. Treat results as leads, not proof."),
      t("Privacy: it records every device nearby, including neighbours' and passers-by's. Recordings stay in your Home Assistant and are never uploaded. The Settings card keeps sessions for 7, 14 (the default), 30, 60 or 90 days, even after you turn recording off, and \"Delete all recorded data\" erases them."),
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
