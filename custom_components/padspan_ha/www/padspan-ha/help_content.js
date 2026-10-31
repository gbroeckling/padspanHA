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
    title: t("Mapping — Floor plans, rooms and receivers"),
    body: [
      t("Mapping is where you give PadSpan a picture of each floor, its real size, the rooms on it and where your receivers (the Bluetooth listeners) hang. Positioning, the 3D views and the Atlas are all built from it."),
      t("In Basic mode Mapping has two tabs, Library and Upload, and Open on a plan starts the Setup Wizard. Advanced and Development add Edit, 3D Stack, Layout, Atlas, Export and Help, plus Furnish while Live Aboard is on. Only an administrator gets Upload or can change a plan."),
      t("New to it? Click Setup at the top (or Start Setup Wizard in an empty Library). It takes you through the plan, its scale, floor heights, rooms, receivers and calibration, one step at a time."),
      t("Floors and rooms come from Home Assistant: create or rename them in Home Assistant's Settings → Areas & Zones. A floor can have more than one plan (a wing drawn on its own, say); only Outside is limited to one."),
      t("Each tab has its own ? with the details."),
    ],
  },
  maps_library: {
    title: t("Map library — Your floor plans"),
    body: [
      t("The Library lists every floor plan, grouped by floor, with its picture size, its floor and how many receivers are on it."),
      t("\"not placed\" means the plan has no real-world size yet: measure it (Set the scale in the Setup Wizard, or Edit → Measure). \"gap detected\" means a room is far from every receiver, where one more receiver would help; Suggest Placement in Edit shows where."),
      t("Open: in Basic mode it starts the Setup Wizard on that plan, at Set the scale; in Advanced it opens the plan in Edit. Delete removes a plan. If the plan holds data and another plan sits at the same stack level, you can move the data there first (Migrate & Delete); Revert migration undoes that for 10 minutes."),
      t("+ Add a floor starts the Setup Wizard for a new plan. With no plans yet, Start Setup Wizard does the same."),
      t("Compare Maps (Advanced, two or more plans) checks how well your floors line up. It compares where rooms with the same name sit on each plan shown in 3D Stack and rates the worst: Excellent under 2%, Good under 5%, Fair under 10%, otherwise Poor. Above 5%, line the floors up again in 3D Stack."),
      t("In Sample mode the Library shows the sample house's plans, read-only. Switch to Live in the top bar to see and change your own."),
    ],
  },
  maps_upload: {
    title: t("Uploading a floor plan"),
    body: [
      t("Upload adds a floor plan picture. Only an administrator sees this tab."),
      t("1. Floor (from HA): the Home Assistant floor this plan belongs to, or Outside (Experimental) for a garden or yard. A house can have one Outside plan."),
      t("2. Map name: optional. Left blank, it takes the file's name."),
      t("3. Max size: the longest side, in pixels, after conversion. 1600 unless you change it."),
      t("4. Choose the picture: PNG, JPG, GIF, BMP, WebP or SVG. A photo of a paper plan or a hand sketch works too. Drag on the preview to crop it if you like; Reset Crop starts over."),
      t("5. Click Upload & Convert. PadSpan turns it into a PNG and keeps it in Home Assistant, where only people signed in can see it."),
      t("In Advanced mode you land in Edit, ready to measure it. In Basic mode, Open on the plan in the Library starts the Setup Wizard on it."),
      t("Tip: upload your most accurate, to-scale plan first. It makes the best Reference when you line up your other floors in 3D Stack."),
    ],
  },
  maps_wizard: {
    title: t("Setup Wizard — one floor plan, step by step"),
    body: [
      t("The Setup Wizard takes one floor plan from picture to working map in five steps: 1. Upload floor plan, 2. Set the scale, 3. Draw rooms, 4. Place scanners, 5. Finish. Once the plan exists, click any step's chip to jump to it."),
      t("It starts from Start Setup Wizard or + Add a floor in the Library, and in Basic mode from Open on a plan. The guided Setup (Setup at the top of Mapping) sends you through the same steps, with floor heights and calibration added."),
      t("Set the scale: click two points you know the real distance between, type it in metres and click Add 1st Measurement. Measure again at a different angle (Add 2nd Measurement), then click Save Scale. Two angles show whether the picture is stretched."),
      t("Draw rooms: pick a room in Choose room…, click its corners on the plan, then double-click or click Finish (3 points or more). Click Save Layout to keep the rooms. The box above the map counts the rooms still to draw."),
      t("Place scanners: in Live BLE Radios click Add next to a receiver, drag it to where it really is, pick its Room, then Save Layout. Its height (Height above floor, Save height) saves on its own."),
      t("Steps 2 to 4 can be skipped and done later. Finish offers Put it on the map (adds the rooms and receivers your house layout doesn't have yet), Go to Calibration →, + Set up another floor and Done. Exit setup leaves at any time."),
      t("In Basic mode each step shows only its own tool; Advanced keeps all of Edit's tools."),
    ],
  },
  maps_layout: {
    title: t("Layout — rooms and receivers in metres"),
    body: [
      t("Layout (Advanced) shows the house the way positioning sees it: each floor's rooms, receivers (green pins), beacons and walls, in real metres, with no floor plan behind them. Pick a floor with the Floor buttons."),
      t("Move things: click a room to select it (Shift-click for more), drag it, or drag a corner to reshape it; drag a green pin to where that receiver really is. Then click Save corrections, or Discard changes."),
      t("Rises to (m): select one room and give its height from floor to roof, for a room taller than its floor (a double-height living room, a hall under a gallery). Blank means the floor's height. It is used for drawing Live Aboard. Split level… sets a room's floor a little up or down."),
      t("Layout: switches between the Saved layout and the layout your floor plans imply (Map placements), or a Blended one. Commit this layout writes the one you're looking at into the saved layout; Reset to computed layout throws away your edits to it first; Load into the layout editor brings it in for more changes."),
      t("Also here: + Add room (a room in this layout only, no Home Assistant area needed), Import floorplan (.sh3d), What-if scanner (drag a pretend receiver to see whether it would tell rooms apart) and Show occupancy."),
      t("Finalize floor locks the floor's room shapes against bulk rebuilds from the plans (Unlock… undoes it); single corrections still work."),
    ],
  },
  maps_export: {
    title: t("Export — copies of your maps"),
    body: [
      t("Export (Advanced) saves copies of your work. Pick a plan in Map:, then:"),
      t("1 · Floor Plan Image — the plain picture (Download PNG, Open in new tab)."),
      t("2 · Room Drawing (SVG) — the rooms and receivers as a line drawing."),
      t("3 · Combined (Floor Plan + Rooms) — the picture with the rooms on it (Render & Download PNG)."),
      t("4 · Full 3D Building — every floor stacked (Download SVG, Render PNG)."),
      t("5 · Map Data Backup (JSON) — Backup All Maps saves every plan, its picture, its place in the stack and its real size in one file. Restore from Backup brings it back (Choose Backup File…, then Restore Maps); a plan whose name already exists is skipped."),
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
    title: t("Atlas — Build controls"),
    body: [
      t("The rows above the map in Mapping → Atlas change how the map is drawn while you place and style devices. None of them moves a device or changes its settings. Most need a PadSpan Bright Pro or PadSpan Pro key; Whole house, ▦ New layout and Live Aboard need PadSpan Pro."),
      t("SHOWCASE — Draws each fixture in its real colour, with pools of light and shadows. It's only a picture: everything stays where it is and stays editable. While it's on (in the new layout, under Showcase options) you also get:"),
      t("  Theme — one of 19 looks for the whole map: colours, room edges and the style of the light."),
      t("  ⊞ Fit room — keeps each fixture's drawing inside its room, a little in from the walls. Saved sizes don't change."),
      t("  ☼ Light spread — bands showing roughly how far each light reaches."),
      t("  ✨ Scene — previews a colour layout across the house: Sunset, Dusk, Ember, Ocean, then off. ↻ turns it 45°. Your lights change only when you click Apply, and only the ones already on."),
      t("  ◉ Ripple — tap the map and a pulse of brightness runs outward from there through the lights that are on."),
      t("  Presets — Save current keeps the whole look under a name, and Apply brings it back: Showcase, Theme, Fit room, Light spread, Beacons, Codes, Untouched, Automorph and the Floor, Spacing, L / R and Zoom positions."),
      t("◫ HIDE UNTOUCHED / UNTOUCHED (N) — Shows only lights that have been resized, rotated, recoloured or given a shape; N is how many are hidden. Moving a light doesn't count as touching it."),
      t("▤ HIDE CODES / CODES HIDDEN — Hides the code label (A01, M08…) on every marker. The markers work as before."),
      t("◉ SHOW BEACONS / BEACONS SHOWN — Adds your identified beacons as read-only dots. Off by default; their names hide along with the codes."),
      t("◈ AUTOMORPH — A soft glow behind each placed fixture that grows toward its room's shape. It never moves a fixture. Its sliders (under Automorph tuning in the new layout):"),
      t("  ROOM % — how far the glow reaches into the room."),
      t("  HARDNESS — the edge: left is sharper and spikier, right is smoother; 0 in the middle leaves it as it is."),
      t("  STYLE — one of 16 looks (Glow, Blueprint, Nebula, Halo and more)."),
      t("  SUBTLETY — how faint it is; 0 is full strength."),
      t("FLOOR — Draws one floor (or a pair) larger instead of the whole stack. Only shown with more than one floor."),
      t("SPACING — How far apart the floors are drawn (60 to 340). L / R shifts each floor sideways, for an upper floor that doesn't sit straight over the one below. Both change only the drawing."),
      t("SAVE VIEW / RESET VIEW — Save view keeps Spacing, L / R, Floor and Zoom as everyone's starting view. Reset view goes back to Spacing 150, L / R 0, all floors and 100%, and saves that. In the new layout these sit under Layout & view."),
      t("ZOOM — − / 100% / +. The mouse wheel and dragging work too."),
      t("MAP | LIVE ABOARD — With Live Aboard turned on, switches between this flat map and the 3D house. While the 3D house shows, Save view keeps the camera in Live Aboard's Views, Reset view goes back to the whole house, Zoom moves the 3D camera, and Spacing and L / R are hidden."),
      t("▦ NEW LAYOUT / CLASSIC LAYOUT — Switches between the packed new layout (the default, and the one wall screens need) and the classic one."),
      t("WHOLE HOUSE — Saves how every light and fan is right now as a named preset (type a name, then Set) and puts it all back with Apply. 🌴 Vacation Mode is the first entry; it has its own help."),
      t("Placing devices is done on the map itself: drag a light to its spot, or click + Place on its row in the light index (or ◎ Queue all unplaced) and tap the map where it is."),
    ],
  },

  // ── The Atlas (its own sidebar page) ────────────────────────────────────
  atlas_page: {
    title: t("The Atlas — everyday control"),
    body: [
      t("The Atlas is the map you use day to day: every floor, with your lights, strips, fans, sensors, locks, doors and windows where they really are. It has its own entry in Home Assistant's sidebar, on by default (Settings → Atlas → Show the Atlas in the Home Assistant sidebar; a change needs a restart of Home Assistant). Administrators get ✎ Edit map (not in Basic mode), which opens Mapping → Atlas, where the map is built."),
      t("Tap a light to switch it. Tap its code, or press and hold, for brightness, colour, effects and fan speed; hold a dimmable light and slide up or down to dim it. Tap a room's name for everything in the room. Motion, temperature and air-quality tiles only show what's happening; tap a motion tile for its last 7 days."),
      t("Above the map, the device chips (All, Lights, Strips, Fans, Motion, Temps and so on) bring one kind to the front, and the floor chips show one floor, with a dot for what's on up there. ◎ Find active jumps to whatever is on or tripped. Below the map, the light index lists every device, placed or not; click Code, Light, Room or State to sort it."),
      t("Two taps on a room's empty floor zoom to that room. ⛶ at the bottom right fills the screen. Zoom in far enough and the bars step aside for the map; ☰ brings them back."),
      t("Whole house (PadSpan Pro): save how every light and fan is right now as a named preset (type a name, then Set) and put it all back later with Apply. 🌴 Vacation Mode is in the same list."),
      t("Settings → Atlas turns on the extras: ♨ Heatmap (PadSpan Pro; colours each room by temperature, then humidity, then CO₂), Alert pulse (a door left open, or a window or cover open while it rains, rings its room in amber), the Test emergency lighting button (shown only in a house with emergency lights) and 🌧️ Outdoor weather (rain and snow drawn around the house)."),
      t("A leak sensor that reports wet rings its room in red, and a banner with its own Reset stays on every PadSpan screen until someone dismisses it, or for 2 days."),
      t("With PadSpan Pro you can also show the Atlas as Overview (Settings → Atlas), put it on a wall screen, and switch it to Live Aboard, the 3D house. Each has its own help."),
    ],
  },

  // ── Vacation Mode (Atlas → Whole house) ─────────────────────────────────
  vacation_mode: {
    title: t("Vacation Mode — lights that look lived-in"),
    body: [
      t("Vacation Mode (PadSpan Pro) switches your lights and fans while you're away, so the house looks lived in. It replays your own routine, learned from Home Assistant's history; it doesn't make one up. Only an administrator can turn it on or off."),
      t("To turn it on: in the Atlas (the sidebar Atlas or Mapping → Atlas), pick 🌴 Vacation Mode in the Whole house list, click Apply, then Yes, turn on Vacation Mode. A banner then shows it's on, with an Energy saving slider (at 100% it plays the full routine; lower it and each light is less likely to come on), Options and Disable."),
      t("Routine from: Last week plays each day like the same day last week. Monthly average plays each weekday from the last month's average. The choice is fixed when Vacation Mode is turned on, so a change applies the next time. A day missing from last week is taken from the week before, then from the monthly average."),
      t("The other options are all off until you set them:"),
      t("Only after dark — lights it would turn on in daylight stay off. Pick when dark starts, from 30 minutes before sunset to 2 hours after."),
      t("Ends — a date and time when it turns itself off (No end clears it). You get the same notice as when someone turns it off."),
      t("Pause while someone is home — while anyone in Home Assistant's People is home, nothing is switched. Nothing is forced off either."),
      t("Bedtime — every light it runs goes off from about then until 5 am. The time moves up to 20 minutes either way each night."),
      t("Longest on — a light it turned on goes off after this long, and stays off as long."),
      t("Most lights on at once — the rest wait their turn. Evening lights and lights turned on by hand don't count."),
      t("Evening lights — up to 10 lights, such as a porch or hall light. Each stays on for the part of the evening it was really on in that history (last week, or on average), and goes off at bedtime. Turned off in the evening, it comes back on within 5 minutes."),
      t("Preview — Show the next 24 hours lists what it would switch with these options. Nothing is switched."),
      t("Good to know: it learns only from Home Assistant's recorder, which keeps 10 days unless you've changed it, so a light left out of the recorder is never switched. It checks every 5 minutes, and a light someone switches by hand can be set back to what the routine says. When it ends or is turned off, Home Assistant gets a notification. Turned back on within 3 weeks, it carries on with the same routine."),
      t("For experts: binary_sensor.padspan_vacation_mode shows it in Home Assistant, and the padspan_ha_vacation_mode event fires on every change."),
    ],
  },

  // ── Wall screens (?kiosk=1) ─────────────────────────────────────────────
  wall_screens: {
    title: t("Wall screens — the Atlas on a wall"),
    body: [
      t("A wall screen is a tablet or TV that shows the Atlas all the time. Open the Atlas page with ?kiosk=1 on the end of its address (/padspan-lights?kiosk=1) and it becomes a wall: the whole house fits the screen, the header and the light list are left out, and the controls, room names and rain are sized for the room. It needs PadSpan Pro and the Atlas's new layout (Mapping → Atlas → ▦ New layout)."),
      t("Set it up in Settings → Atlas → 📺 Wall screens. Size from the screen, or Size for my room: a preset (Desk monitor, Kitchen tablet, Hallway screen, Living-room TV, Big TV) or the Screen size and Viewing distance. Then Text size, Dim at night, burn-in protection, Show each floor (the floors take turns while nobody touches the wall) and the Fully Kiosk option. Changes save at once, and wall screens follow within half a minute."),
      t("Just make a link (the house's walls stay as they are) builds a link for one screen with its own size and Screen orientation, without changing the others; Copy puts it on the clipboard."),
      t("On the wall, the controls fade after 30 seconds with nobody there, and the first touch only wakes them. The screen is kept awake where the browser allows it (a secure https address, or the device itself). With Alert pulse on (Settings → Atlas), a banner across the top names the worst alert."),
    ],
  },

  // ── Live Aboard (the 3D house) ──────────────────────────────────────────
  aboard_3d: {
    title: t("Live Aboard — the house in 3D"),
    body: [
      t("Live Aboard (PadSpan Pro, experimental) draws your house in 3D from the maps you already made: floors, rooms, walls, lights and furniture. Turn it on in Settings → Atlas → 🏠 Live Aboard (Show Live Aboard on the Atlas); ✨ Set it up step by step walks you through the rest. Then Map | Live Aboard switches the Atlas between the flat map and the 3D house (on the sidebar's new layout, the 🏠 button on the rail at the left)."),
      t("Moving around: drag to turn the house; two fingers or the right mouse button move it; pinch or the wheel zooms. Double-tap a room to go there. Tap a light to switch it; hold it for brightness and colour. The bar underneath has Walls (Cut, Up, Down), Roof, Iso, Top, ⟳ 90° and Fit, and with two floors or more ▲ / ▼, All and ⇕ (pull the floors apart). Tap the compass for north up."),
      t("Views ▾: All floors or one floor, Whole house, your saved views and Save this view (up to 8, kept for this screen in this browser; ✕ forgets one), Home view and Set as home, Show people and Show tags & scanners (administrators), Trails, last 30 min, and How it works, which brings back the first-time card. With the 3D house showing, the Atlas's Save view saves into Views too."),
      t("Edit (Mapping → Atlas only): draw a Door, Window or Doorway (an opening with no door) along a wall, set a light's or sensor's height with Heights, or lay out an LED Strip. Undo, Redo, then Save or Discard; Done leaves Edit."),
      t("Furnish (the Mapping → Furnish tab): Build ▾ adds a piece (Starter set, Furniture, Devices, House → Stairs, Other → Box); drag it into place. Floor ▲ / ▼ moves it to another floor and Height in room lifts it onto a table, a shelf or a wall. Stand on what's under it, Hang on wall, Duplicate, Delete, and This is a device… links it to a light, TV or fan. Nothing is kept until Save."),
      t("Also in Furnish: From a photo (photograph a piece and an AI Task reads what it is and its size; needs Home Assistant 2025.8 or newer and an AI Task that reads pictures, chosen in Settings → AI), Library (the starter set and pieces other PadSpan houses have shared; Place, Fits here), Import (furniture from a Sweet Home 3D .sh3d file) and People & devices (give each person, beacon and receiver a look, by hand or from a photo)."),
      t("Settings → Atlas → 🏠 Live Aboard also holds Quality, Look (Same as the Atlas, Live Aboard's own, or Studio — soft light and sky), Back to home view, North and Rain and snow. On the sidebar Atlas's flat map, Show furniture draws Live Aboard's furniture, doors and windows faintly."),
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
    title: t("Map Editor — Rooms, receivers, walls and scale"),
    body: [
      t("Edit (Advanced) is where a floor plan gets its rooms, receivers, walls and scale. Pick the plan in Map: and its floor in Floor:. The tool buttons are Radios, Rooms, Signal walls and 📏 Measure, plus Sub-zones when it's turned on. In Basic mode the Setup Wizard opens the same editor with one tool per step."),
      t("WHAT SAVES WHEN — Rooms and receivers are drafts until you click Save Layout (it pulses when something is unsaved); Revert throws the draft away. Walls, sub-zones, the scale and a receiver's height save the moment you finish them."),
      t("RADIOS — In Live BLE Radios, click Add next to a receiver Home Assistant hears: it lands mid-map, already in its Home Assistant room. Drag it to where it's really mounted. Click a placed receiver to give it a Room, a label, a Height above floor (Save height) or to Delete receiver. Double-clicking the map (or Add Receiver) adds a blank \"Receiver N\" that isn't tied to any real receiver."),
      t("ROOMS — Pick the room in Choose room… (your Home Assistant areas), click its corners on the plan, then double-click or click Finish once you have 3 points or more. Undo point takes back a click; Clear boundary removes the room's shape so you can redraw it. A room already drawn on another plan is marked ⚠ with that plan's name: drawing it here makes a second copy. Enclose (3dB walls) puts a light wall along every edge of the room (the plan must be measured). A shape whose room is no longer in Home Assistant shows ⚠ orphan in Polygon layers, where Delete removes it. All rooms opens every room's settings on one page."),
      t("SIGNAL WALLS — Walls tell PadSpan where signal is weakened. Pick a Material (Metal (12 dB) to start; Open (Loft), Brick, Concrete or Custom), click along the wall and double-click or click Finish (2 points or more). Which material? opens the Walls Guide. The plan must be measured first. In Walls on this floor, each wall can be deleted; Delete all walls on this floor clears them all."),
      t("Doors and windows: click Door on a wall, click its two edges on the wall, choose the Linked sensor (a door or window sensor) and click Create door/window. Its open or closed state then shows on the map. If it reads backwards, click Invert on that wall."),
      t("Open (Loft) marks an opening with no wall, such as a gallery over a hall. In Live Aboard an open edge over a hall that rises past it (a mezzanine or gallery, with the floor kept at its normal height in Floor Heights and the hall given its full height with Rises to on Mapping → Layout) is drawn with a railing."),
      t("📏 MEASURE — Click two points you know the real distance between, type it in metres and click Add 1st Measurement; do it again at a different angle, then click Save Scale. If the two disagree, the picture is stretched. Start Over clears them."),
      t("SUB-ZONES — Draw an area inside a room (a bed, a couch, a desk) that gets its own occupied and who sensors in Home Assistant. Off until you tick its line (binary_sensor.padspan_…_occupied) under Manage → HA Entities."),
      t("ROTATE IMAGE and TRIM IMAGE (administrators) — Rotate Image turns the picture: -90°, -15°, -5°, +5°, +15°, +90° or back to 0°, then Apply Rotation. Rooms and receivers turn with it; if PadSpan can't keep the scale, it asks you to measure again. Rotate before drawing rooms if you can: walls that run along the screen's edges stack best in 3D. Once a plan is tied to another in 3D Stack, Rotate Image is hidden. Trim Image crops the picture (drag, then Apply Trim)."),
      t("Suggest Placement shows where one more receiver would help most; Clear Suggestion hides it."),
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
    title: t("3D Stack — Floor heights and lining up floors"),
    body: [
      t("3D Stack (Advanced) says how your floors sit on top of each other: how tall each one is, which plan belongs to which floor, and where each plan sits over the one below. It matters for telling floors apart and for every 3D view. With a single plan there is nothing to line up, but floor heights still count."),
      t("FLOOR HEIGHTS — One row per floor. Floor↕ (m) is floor-to-floor height; blank means 2.8 m. Base elevation (m) is how high the floor starts; blank means it's worked out from the floors below. Click Save Floor Heights. For one tall room (a double-height living room), keep the floor's normal height here and give that room its own height with Rises to on Mapping → Layout."),
      t("FLOOR ASSIGNMENT & CEILING HEIGHTS — One row per plan: Map, HA Floor, Stack Level (↓ / ↑; it fills in when you pick the floor), Ceiling (m) and Show. Click Save on a row to keep it. Show saves at once: untick it to hide a plan, which also leaves it out of Compare Maps."),
      t("ALIGNMENT OVERLAY — Choose a Reference (fixed) and a Target (draggable). The Reference must be measured; ⚠ marks a plan that isn't placed yet, and Reset starts an unplaced Target on top of the Reference. Drag the Target until stairwells and outside walls line up. Scale + and Scale − resize it, X − and X + stretch it sideways with Lock AR turned off, −15°, ﹢15° and 0° turn it; Zoom and Opacity only change your view."),
      t("Nothing is kept until you click Save Alignment. PadSpan refuses a position that would put more than half of the plan's calibration points off the map, and changes nothing. If the new position disagrees with a saved tie-in, it shows the conflict and offers Average & Save, Override & Save or Cancel."),
      t("+ Tie-in remembers where the Target sits against this Reference, so a later move that disagrees is caught. 🚑 Emergency Recovery finds tie-ins that contradict each other and lets you remove the bad ones."),
      t("POINT ALIGN — For a close fit, click the same real point on both plans (a stairwell corner, say); it switches between the plans for you. With 3 pairs or more, click Compute and check the preview (Excellent, Fair or Poor). Apply moves the Target on screen only, so click Save Alignment afterwards. With Bake ticked (administrators), Bake & Apply redraws the Target's picture to fit and saves it straight away."),
      t("3D ISOMETRIC PREVIEW — The whole building stacked, to check by eye. Floor, Spacing and L/R change the drawing (Save keeps them, Reset restores them). ⊕ Persistent shows where away devices were last seen. \"N stale\" counts receivers on the plans that no live receiver matches; click it for the list. ☰ Room List lists the rooms."),
      t("Compare Maps, in the Library, rates how well the floors line up once you're done."),
    ],
  },
}; }

export const HELP = helpTexts();
