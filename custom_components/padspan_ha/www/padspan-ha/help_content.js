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
      t("In Advanced or Development mode, Settings has tabs: Appearance, Scanner Map, Tracking, Features, AI, Atlas, and UI Structure."),
      t("Appearance — change room colours. Your floors and rooms are read from HA; add or rename them in HA Settings → Areas & Zones."),
      t("Scanner Map — see estimated scanner positions on your floor plans, derived from calibration fingerprint data."),
      t("Tracking — tune room-switching speed and set the Home/Away timeout."),
      t("Features — turn on experimental features, and the PadSpan Pro licence and Forensics cards live here too."),
      t("UI Structure — tick a tab to move it from More tools into the main list in Advanced and Development mode. Basic keeps its short list."),
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
      t("Settings doesn't have its own Manage tab — for this, open the separate Manage entry in the sidebar (in Basic mode it's under More tools)."),
      t("BLE Tags — every named BLE device is listed with its address, kind, and last-seen time. Click Untag to remove the friendly name (two-click confirm prevents accidents). The device reverts to its hardware address but continues to be tracked."),
      t("Rooms (HA Areas) — lists every area from Home Assistant. Click Delete to remove an area from HA entirely. This also unassigns any scanners in that room. Cannot be undone from within PadSpan — re-add in HA Settings → Areas & Zones if needed."),
      t("The Manage sidebar entry also covers deeper data management — orphan cleanup, entity deletion, integration controls, and Factory Reset."),
    ],
  },

  // ── Monitor ────────────────────────────────────────────────────────────────
  monitor: {
    title: t("Monitor — what PadSpan is hearing, in numbers"),
    body: [
      t("Monitor has six tabs: \"Calls and timing\", \"Zones\", \"Signal and coverage\", \"Quick status\", \"Export for support\" and \"Debug\". It is in the menu under \"More tools\" in every mode."),
      t("Calls and timing — a red \"BLE Feed Unhealthy\" banner at the top means Home Assistant's Bluetooth side reported a problem; restarting Home Assistant (Settings → System → Restart) usually clears it. Below it: how many requests the panel has made and how long they took; \"BLE Objects\" (how many devices PadSpan knows and how many Bluetooth messages it has; click the unidentified count to see those devices); \"Per-Scanner Breakdown\"; \"Advertisement Freshness\" (how recent the latest messages are); \"Snapshot Summary\" (how many objects, rooms, receivers and tags the live data holds, and when it was made); and \"Session Info\"."),
      t("Per-Scanner Breakdown — one row per receiver: how many devices it hears, its \"Best-RSSI\" and a grade. Best-RSSI is the average signal strength of only the devices this receiver hears louder than any other receiver does, so a device that is nearer another receiver doesn't pull its number down. The grade is Excellent from −60 dBm, Good from −70, Fair from −80, and Poor below that. Click a row for that receiver's details."),
      t("Zones — one card per room, busiest first (see the Zones help)."),
      t("Signal and coverage — \"Room Occupancy\" (how many devices are in each room), \"Signal Quality\" (the same Best-RSSI figures), \"Object Mobility\" (devices seen in more than one room), \"Coverage Gaps\" (rooms with nothing in them right now, and receivers that aren't on any floor plan), \"Device Breakdown\" (Total, Identified, Unidentified and Tagged, meaning the ones you have named) and \"Dashboard Card Preview\" (a sketch of what a Home Assistant dashboard card could show with your current data)."),
      t("Quick status — just a link: press \"Open Health\" for the system checks and the Problems found list."),
      t("Export for support — press \"Build export\" to collect the panel's state, the server's state, the live data and the automatic checks into one report, then \"Copy\" it and attach it to a GitHub issue or an email to support. Long lists are cut to 200 entries, but every device you named or follow is always kept. \"Install Verification\" below it compares the panel's version with the server's (see the Diagnostics help). Debug shows the panel's own state, for support."),
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
    title: t("History — what happened, and where things moved"),
    body: [
      t("To get here: Manage → \"History\" tab → \"Open History\". It opens on the Movement tab. (Manage is in the main menu in Advanced and Development modes, and under \"More tools\" in Basic.)"),
      t("Movement — the saved list of room changes, kept on the server, so it is still there after a reload. It shows the latest 200, newest first: \"from → to\" for a room change, and \"First seen in\" when a device first turned up. The \"Room change\" and \"First seen\" buttons show or hide each kind, \"Refresh\" fetches the latest, and \"▶ Traceback\" on a row plays back that moment in Traceback (two minutes either side)."),
      t("Session Events — what you did in the panel since this page opened: screens opened (View), data refreshes (Data), tagging (Tag) and calls to the server (WS). Use the buttons to show or hide each kind. It keeps the latest 500, lives only in this browser and is gone when you reload; \"Clear History\" empties it now."),
    ],
  },

  // ── Events ─────────────────────────────────────────────────────────────────
  events: {
    title: t("Events — email alerts and room changes"),
    body: [
      t("To get here: Manage → \"Events\" tab. (Manage is in the main menu in Advanced and Development modes, and under \"More tools\" in Basic.)"),
      t("Email Notifications — \"Saved Alerts\" lists every alert you have set up. In \"Configure Alerts\" pick a tracked device, enter an email address and a Home Assistant notify service, tick \"Alert on room change\", and optionally tick only the rooms you care about (none ticked means all rooms). \"Save Alert\" stores it and \"Test Notification\" sends a test. PadSpan sends through Home Assistant's own notify service, so one has to be set up there first; this needs Live mode. You can also set alerts per device in Follow."),
      t("Under it, \"Room Transitions\" is a list for this page only that clears when you reload. For the saved room changes, use History → Movement."),
    ],
  },

  // ── QA ─────────────────────────────────────────────────────────────────────
  qa: {
    title: t("QA — checks on your setup"),
    body: [
      t("QA checks your setup and shows what needs attention. It is in the menu under \"More tools\" in every mode. Only the backup buttons and the two reset buttons (under Propagation Health → \"More Detail\") change anything, and the resets ask first."),
      t("Config Health — seven checks: \"Maps configured\", \"Receivers on maps\", \"Rooms defined\", \"BLE scanners active\", \"BLE feed healthy\", \"Objects tagged\" and \"Snapshot available\". ✅ passed, ⚠️ works but worth a look, ❌ failed. A failed or amber check says how to fix it, and some failed ones have a \"Go →\" link to the right screen."),
      t("Data Consistency — devices in rooms PadSpan doesn't know, receivers not placed on any floor plan, and rooms with no receiver. Click a name for its details. Under it, \"Quick Actions\": \"Refresh Snapshot\" fetches the live data again, \"Export State\" downloads the panel's current data as a file, and \"Go to Diagnostics\" opens the report for support."),
      t("Propagation Health — a grade from A to F for how well PadSpan's signal model fits your home. Its own ? explains it."),
      t("Data Backup & Recovery — back up your PadSpan data before you try something new, and restore it if needed. Its own ? explains it. Manage → Data → \"Backup & Restore\" works on the same backups and also lets you choose which parts to restore."),
      t("Radio Analysis — every receiver ranked, with a health verdict and the reason. Its own ? explains the scores."),
    ],
  },

  qa_propagation: {
    title: t("Propagation Health — how well the signal model fits your home"),
    body: [
      t("QA → \"Propagation Health\" grades, from A (excellent) to F, how well PadSpan turns signal strength into rooms in your home. It improves as you add calibration points and as adaptive learning (PadSpan learning each room's signal pattern by itself, switched on in Settings → Tracking in Advanced and Development modes) gathers data."),
      t("Four bars make up the grade. \"Model Coverage\": how many rooms have a learned signal pattern. \"Distance Accuracy\": on average, how many metres off PadSpan is at your calibration spots; the bar is full at 0 m and empty at 3 m. When it can, a line under it says how it did on spots it was not trained on (\"Tested on spots it hasn't seen\": the share of rooms it got right). \"Fingerprint Stability\": how steady each room's signal pattern is. \"Floor Separation\": how clearly the signal drops between floors (\"N/A\" with one floor or no data yet)."),
      t("\"Recommendations\" lists up to five things to do next, such as rooms that need more readings or turning on adaptive learning."),
      t("\"More Detail\" adds a table per room (its receivers, how many readings it has and how steady they are) and per receiver (how well its signal fits distance). \"How It Works\" shows the formulas and the values in use now. At the bottom, under \"Data Management\": \"Reset Adaptive Learning\" clears what PadSpan learned by itself and keeps your calibration points; \"Reset All Calibration\" clears every calibration point too, asks you to type RESET, and cannot be undone."),
      t("For experts: Distance Accuracy is the mean leave-one-out error in metres; Fingerprint Stability is the average per-room RSSI variance (dBm²); the per-receiver table is a path-loss fit (RSSI at 1 m, R²); \"How It Works\" shows the path-loss formula, the Kalman filter's Q and R, and the adaptive blending weight."),
    ],
  },

  qa_backup: {
    title: t("Data Backup & Recovery"),
    body: [
      t("QA → \"Data Backup & Recovery\" keeps copies of your PadSpan data so you can go back. Type an optional note and press \"Create Backup\"."),
      t("A backup holds your settings; calibration points; what adaptive learning has learned; your device names; your floor plans, their placement and the plan images; the room and receiver layout and the model built from it; email alerts; movement history; Traceback history; device history; Forensics sessions; the list of known devices; each WLED light's saved look; Lost & Found's last-known rooms; and, once you have used them, Live Aboard's furniture, sub-zones and the robot vacuum link."),
      t("Up to 3 backups you make are kept; a 4th removes your oldest. PadSpan also backs up by itself before a reset, an import or a conversion: those automatic backups copy only the data that step is about to change (no plan images), are kept apart (the last 3) and never remove one of yours. Each backup shows its time, version and note."),
      t("\"Restore\" puts everything in that backup back over your current data, after asking, and reloads the page. \"Delete\" removes a backup. To restore only some parts, or the plan images, use Manage → Data → \"Backup & Restore\"."),
      t("Good times to make one: before turning on adaptive learning, before big calibration changes, and before upgrading PadSpan."),
    ],
  },

  qa_radio_analysis: {
    title: t("Radio Analysis — which receivers work best"),
    body: [
      t("QA → \"Radio Analysis\" lists every receiver, best first, with a score out of 100, a health verdict (Healthy, Fair, Unhealthy or Unknown) and the reason for it. The top three get medals. Unhealthy and Unknown receivers always go to the bottom, with their score capped at 10."),
      t("The score is Hardware 40%, Coverage 30% and Reliability 30%. Hardware: how loudly this receiver hears the devices it shares with other receivers, compared with them, so it tells a better antenna or chip apart from simply good placement; 50 is halfway between your best and your worst receiver. Coverage: how many devices it hears (half), how many other receivers share some of them (about a third), and devices only it hears. Reliability: how recent its latest message is (up to 35 points), how steady its readings are (up to 25), its Wi-Fi signal, or full marks if wired (up to 20), and whether it is scanning (up to 20)."),
      t("Click a row to open it: the three scores and the overall, \"Identity & Network\", \"Activity Metrics\", \"Cross-Scanner Comparison\" (how many devices it shares with each other receiver) and \"Health Verdict\". When its hardware differs from the top-ranked receiver's by 2 dBm or more, a note says by how much: 3–5 dBm is noticeable, 6 dBm or more suggests different hardware."),
      t("Click a receiver's name for its details window: its room (shown, not changed there), network details, the devices it hears, and \"Mark as Lost\" / \"Mark as Disabled\". To change its room, use Overview → \"View radios list\" → \"Assign\" or \"Change\", or Mapping → Edit → Radios → \"Room\" (Advanced and Development modes)."),
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
    title: t("Sandbox — a look under the hood"),
    body: [
      t("Sandbox shows live data in different ways; nothing here changes your setup. It is in the menu under \"More tools\" in every mode."),
      t("Experimental Features — whether each one is on: Adaptive Learning, Floor Detection, MQTT Publishing, Ignore Bermuda, and Beacon Tune (always available). Each row says where its switch is; click a row to open that screen."),
      t("State Inspector — the data mode, how long this page has been open, how many objects, receivers, rooms and Bluetooth messages there are, when the live data was made, and an \"RSSI Distribution\" chart of how strong the signals are."),
      t("Floor Towers — each floor as a column of rooms; click a room for its details. Live Signal Bars — how many devices each receiver hears; click a row for that receiver. Signal Pulse — one bubble per room, bigger for more devices and pulsing while signals are fresh; click one for the room."),
      t("Raw Snapshot Explorer — the live data as a list you can expand; \"Copy snapshot JSON\" copies all of it, for support."),
    ],
  },

  receivers: {
    title: t("Receivers — every Bluetooth receiver in one table"),
    body: [
      t("One row for each Bluetooth receiver (an ESPHome proxy, a Shelly, Home Assistant's own adapter) PadSpan hears from: its room, its floor, whether it is on a floor plan, its height, its signal adjustment, how it is doing, how many devices it hears right now, and when it was last heard."),
      t("Height and signal adjustment can be changed right in the table. They are the same values as Calibration → Tune, Mapping → Edit → Radios, Settings → Tracking → Receivers and Bluetooth → Scanners (\"RSSI offset\"): saving in one place changes them everywhere. \"No position yet\" in the Height column means PadSpan has no position for it: place it on a floor plan, then Calibration → Tune → Save, and its height can be set after that."),
      t("Status uses the same rules as the dot in the top bar: \"Silent\" means not heard for over 10 minutes; \"Hearing less\" means it hears far fewer devices than usual while the others are normal; \"Not in use\" means you marked it lost, disabled or excluded, so the dot leaves it out; \"Not heard yet\" means nothing from it since PadSpan started; \"Online\" means it is reporting normally."),
      t("Place (or Move) opens Mapping with that receiver selected, to put it where it is mounted. Positions, rooms and calibration are never changed from this page: a receiver's room is set in Overview → \"View radios list\" or Mapping → Edit → Radios."),
      t("Click a column heading to sort by it; tick Problems only to see just the receivers that need attention. In Sample mode the demo house's receivers are shown and nothing can be edited."),
    ],
  },

  installbase: {
    title: t("Install Base — what the opt-in usage reports add up to"),
    body: [
      t("This is the developer's screen. It is in the menu under \"More tools\", asks for a PIN, and needs a PadSpan Pro licence; the reports server only answers licence keys on its developer list, so anyone else sees a refusal, never other people's homes. Installs are listed by the start of a random id that says nothing about who or where."),
      t("The figures at the top: \"Installs sharing a report\" (turned the usage report on and sent one in the report window), \"Homes running\" (different homes that checked for an update yesterday, whether they share a report or not, with today's count so far), \"Active\", \"Ever reported\", \"New\" (first report in the window), \"Gone quiet\" (no report for a while) and \"Pro\"."),
      t("Sections: \"Reach\" and \"Needs attention\" start open; click any other to open it: \"New installs\", \"Versions\" (PadSpan and Home Assistant versions, licence, country and language), \"Homes\", \"Receivers\", \"Health\", \"Usage\", \"Everything else in the reports\" and \"Installs\". The chips at the top jump to a section, \"Open all\" and \"Close all\" do what they say, and \"Refresh\" fetches fresh numbers."),
      t("Counting by internet address overcounts homes: a home's address changes, so over a month one home can show up many times. That is why \"Homes running\" counts a single day, and why \"Versions running (by address)\" is for the mix of versions, not for how many homes."),
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
    title: t("Tracking Settings — Tuning the Positioning Engine"),
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
      t("SIGNAL DISTORTION MAP — Shows where calibration predictions disagree with reality. Renders error arrows on the map so you can see where walls or interference cause positioning problems."),
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
    title: t("Bluetooth — what each receiver hears"),
    body: [
      t("Bluetooth shows what each receiver (scanner) is hearing. It is in the menu under \"More tools\" in every mode. The figures at the top count receivers, recent Bluetooth messages, device addresses, phone keys and more (click \"Private BLE IRKs\" for the IRK Manager). It has five tabs: \"Visualisation\" (opens first), \"Advertisements\", \"Scanners\", \"IRK Manager\" and \"ESPHome Configs\"."),
      t("The first three tabs share a filter bar: \"Search\" finds a name, address or receiver (and also a device's company, type, room or label), \"Source\" shows one receiver only, and \"Max rows\" sets how many to list (200 to start with)."),
      t("VISUALISATION (\"Who hears what\") — receivers on the left, devices on the right. Each line is one receiver hearing one device, coloured by how strongly: green −70 dBm or better, amber down to −82, red weaker. Click a receiver for its details window, or a device for its details."),
      t("ADVERTISEMENTS — the live list of Bluetooth messages (advertisements), each with its signal strength, age and what kind of device sent it. \"Tag\" or \"Relabel\" names a device; click a row for everything in the message. With Quiet mode on, only your tracked devices are listed."),
      t("SCANNERS — one row per receiver with its room, IP address and Wi-Fi signal. Click a row to see, beside it, everything that receiver hears, strongest first (\"All receivers\" there opens the Receivers page). After 6 checks a bar shows how often the receiver agrees with the room the others point to (\"Reliable\", \"Fair\" or \"Unreliable\"); low agreement means its placement, antenna or offset needs a look."),
      t("Each Scanners row also has: \"RSSI offset\" and \"Set\" (a correction in dB added to everything it hears, positive if it reads weaker than it should; the same value as the Receivers page and Settings → Tracking → Receivers); \"Relearn\" (after an antenna change, shifts its saved calibration readings by the gain you enter, + for better, − for worse); \"Reset\" (erases everything stored for it: calibration, placement, offsets and learned patterns; asks first); \"Exclude\" / \"Include\" (leave it out of positioning without deleting anything); and \"Min signal\" (ignore anything it hears weaker than the level you pick, for positioning and the occupancy count only; handy for a receiver on an outside or shared wall; the lists still show everything)."),
      t("\"Find the one in your hand.\" (beside a selected receiver) finds which device is yours: pick \"Louder\" and hold the device against the receiver for about 20 seconds, or \"Quieter\" and hide it in a metal bin or saucepan, then press \"Start\". The devices that changed are listed so you can tag yours."),
      t("Rooms: a receiver's room is set in Overview → \"View radios list\" → \"Assign\" or \"Change\", or in Mapping → Edit → Radios → \"Room\" (Advanced and Development modes). Bluetooth, the Rooms page and the Receivers page show it but don't change it. The receiver details window (from Visualisation, QA → Radio Analysis or Monitor) shows its room, network, the devices it hears, and \"Mark as Lost\" / \"Mark as Disabled\"."),
      t("IRK MANAGER — phones and watches change their Bluetooth address every few minutes. An IRK (the phone's identity key) lets PadSpan recognise all those addresses as one phone. Paste a key under \"Add an IRK\" (\"Add & validate\", or \"Test only\" to check it first), or press \"Auto-detect IRKs\" to pick up keys from devices already paired with your Home Assistant computer. With Settings → Features → \"Phone Setup Wizard\" (or \"iPhone Setup Path\") on, in Advanced and Development modes, \"Track your phone\" offers three guided ways in: \"I have an IRK Capture ESP32\" (\"Scan for IRK Capture devices\" collects the keys such a board captured; the tool is at https://github.com/DerekSeaman/irk-capture), \"I have an Android phone\" (use the Companion app's BLE Transmitter; no key needed) and \"I have an iPhone\"."),
      t("ESPHOME CONFIGS — ready-made ESPHome settings (YAML) for building your own receiver from an ESP32 board, with copy buttons, plus antenna and board suggestions."),
    ],
  },

  // ── Health & System Critics ────────────────────────────────────────────
  health: {
    title: t("Health — is PadSpan working?"),
    body: [
      t("Health gathers PadSpan's own checks in one page, from a quick summary at the top to the detail below. It is in the main menu in Advanced and Development modes and under \"More tools\" in Basic, and clicking the status dot in the top bar opens it in any mode (what the dot means: Training → Full Manual → Health → The status dot)."),
      t("\"System\" — the panel's version and build, Live or Sample data, and how long the last refresh took. \"Live Discovery (best-effort)\" — rough counts of the rooms, receivers and tags PadSpan has found. To send details to support, use Diagnostics (QA → \"Go to Diagnostics\") or Monitor → \"Export for support\"."),
      t("\"Hearing less than usual\" — shows only when a receiver has heard far fewer Bluetooth messages than normal for over 10 minutes while the others are fine. Rooms near it can be wrong; restarting it often helps."),
      t("\"Scanner Health\" — for each receiver, \"Agreement\": how often it agrees with the room the other receivers point to, and \"Weight\": how much PadSpan trusts it, from 0 to 1 (its dot is green from 0.9, amber from 0.7, red below). Once a receiver has had 12 checks, a warning lists any with a weight below 0.7. \"All receivers\" opens the Receivers page."),
      t("\"Room and receiver layout\" — PadSpan's model of your home in metres: rooms per floor, a list of layout checks that pass or fail, receiver positions, room shapes, which rooms touch, which receiver is in which room, and your floor plans. Its buttons: \"Retrain learned model\" (when shown) rebuilds the learned model from your calibration points; \"Resync Scanners\" rebuilds the receivers' rooms and floors from Home Assistant, keeping ones you set by hand; \"Reset Spatial Model\" clears every receiver position, beacon position and signal wall after taking a backup (it asks first; room shapes, lights, plan placements and calibration points are kept); \"Run Radio Audit\" compares each receiver's room and floor in Home Assistant with PadSpan's and lists any that differ; \"Refresh layout\" reloads this section. \"🔑 Migrate Device Identity\" appears only when an upgrade step is needed."),
      t("\"RSSI Vector Capture\" — only with Settings → Features → \"RSSI Vector Capture\" on (Advanced and Development modes). Press \"⏺ Record\", walk the house pressing \"Mark room\" in each room, then \"⏹ Stop\". Each recording can be exported, deleted, or replayed with \"Replay & Score\" to see how other settings would have done on the same walk. Nothing is recorded until you press Record, and a recording stops by itself after 60 minutes or 25 MB."),
      t("\"Problems found\" — automatic checks of the whole setup, with \"Room mix-ups\", \"Map Calibration Quality\" and \"Check again\" under it. Its own ? explains each check."),
    ],
  },
  status_dot: {
    title: t("The status dot — when something needs a look"),
    body: [
      t("A small round mark in the top bar shows only when something is wrong: amber means something needs attention, red means something is broken. No dot means all is well. It shows how many issues there are, hovering over it names them, and clicking it opens Health."),
      t("Red: PadSpan isn't answering, so the live data has stopped updating; positioning's last update failed; or no Bluetooth receivers are reporting (not checked for the first two minutes after the page opens or PadSpan answers again). Amber: a receiver hasn't been heard from in over 10 minutes; a receiver is hearing far fewer devices than usual; or learning is suspended, so rooms come from the raw signal only."),
      t("It waits before it shows, so one slow moment doesn't make it blink: amber after two checks in a row (about 10 seconds), red after three (about 15 seconds). It goes once the problem has been gone for two checks. Receivers you marked lost, disabled or excluded don't count, and it only watches live data, not Sample mode."),
      t("On a wall screen (kiosk mode, or a full-screen window nobody has touched for two minutes) only red shows; in kiosk mode it sits in a corner and says how many problems there are. The Receivers page's Status column uses the same rules."),
    ],
  },
  health_critics: {
    title: t("Problems found — what each check means"),
    body: [
      t("Health → \"Problems found\" checks your whole setup for things that can put devices in the wrong room. The banner says \"HEALTHY\" or how many issues it found. Each card shows its kind and how serious it is (critical: fix this; warning: worth fixing; info: good to know), what is wrong, and an \"Action:\" line saying what to do. Critical ones come first. The list refreshes about every 30 seconds while the page is open; \"Check again\" refreshes it now."),
      t("ROOM CONFUSION — two rooms PadSpan keeps moving a device between (at least 4 moves back and forth; critical when they are 15% or more of all room changes, a warning from 8% or 20 moves). Fix: add calibration points in both rooms near where they meet, and draw a signal wall between them in the map editor if there is a real wall."),
      t("MAP QUALITY — how far off PadSpan is when it tests a floor plan's calibration points against each other: a warning from 1.2 m average error, critical from 2.25 m; just info when a plan has fewer than 5 points. Fix: add calibration points, especially where coverage is weak."),
      t("MAP GEOMETRY — a floor plan problem. No plan has been measured, so the house has no metre scale and nothing can be drawn (critical); a plan's placement can't be read (critical); or a plan isn't placed yet (a warning, and normal just after uploading). Fix: measure a plan in Mapping → Edit → Measure, or line it up over a measured plan in Mapping → 3D Stack and press \"Save Alignment\"."),
      t("ROOM FOOTPRINT — the rooms on a floor are bigger than the floor plan they were drawn on (critical) or don't match its size (warning), usually because the plan's scale changed after the rooms were drawn. Don't redraw them by hand: in Mapping → Layout, preview \"Map placements\" and save it if it looks right."),
      t("ROOM DIVERGENCE — a floor plan's traced rooms and the saved rooms all differ by the same amount, so one of the two is out of date (warning). In Mapping → Layout, compare \"Saved layout\" and \"Map placements\" over the photo and keep the one that matches."),
      t("SCANNER — a receiver that often disagrees with the room the other receivers point to (judged after 12 checks: a warning when its weight, how much PadSpan trusts it, is below 0.7; critical below 0.6). Fix: check where it is and which way its antenna points, check it is in the right room, or adjust its signal offset in Settings → Tracking → Receivers (or the Receivers page)."),
      t("CALIBRATION — no calibration points at all (critical: run Calibration → Tune), or calibration getting old: info after 60 days, a warning after 90. Furniture and devices change over time, so walk the house again now and then."),
      t("PROPAGATION — a room whose learned signal pattern is unsteady (warning: look for things nearby that interfere, such as Wi-Fi access points, microwaves and USB 3 devices, and add calibration points), or \"Adaptive learning is disabled\" (info: turn it on in Settings → Tracking, in Advanced and Development modes, so PadSpan keeps improving by itself)."),
      t("Under the list: \"Room mix-ups\" shows up to 15 room pairs with the most moves back and forth (\"Transitions\") and their share of all room changes (\"Rate\"). \"Map Calibration Quality\" shows each floor plan's calibration points with the average and the worst error, amber from 1.2 m and red from 2.25 m."),
      t("For experts: MAP QUALITY and Map Calibration Quality use leave-one-out cross-validation (each calibration point predicted from the others); PROPAGATION flags a room whose average RSSI variance is over 25."),
    ],
  },

  diagnostics: {
    title: t("Diagnostics — a report to send to support"),
    body: [
      t("Diagnostics isn't in the menu: open it from QA → \"Go to Diagnostics\". It puts a short report in a box: the panel's and the server's versions, PadSpan's status, your rooms and floor plans, and the automatic checks."),
      t("\"Select All\" selects it, \"Copy\" copies it, and \"Download Report\" saves it as a file. Attach it to a GitHub issue or an email to support. It names your rooms and floor plans, so look it over before you send it. Monitor → \"Export for support\" builds a fuller report the same way."),
      t("\"Install Verification\" — if the panel's version and the server's differ, your browser is showing an old copy (press Ctrl+F5) or Home Assistant has two copies of PadSpan installed (for example one from HACS and one copied by hand): remove the extra one and restart Home Assistant."),
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
