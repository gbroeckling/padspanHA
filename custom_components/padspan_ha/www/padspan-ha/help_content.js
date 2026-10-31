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
    title: t("Follow — Watch one tag in real time"),
    body: [
      t("Follow shows where one person or thing is right now: a phone, a key fob, a Tile, an AirTag or anything else Bluetooth that PadSpan™ hears."),
      t("Pick it under \"Choose a tag to follow\". The card below then shows the room it is in, its floor and when a receiver last heard it. In Advanced and Development mode the card also lists the receivers that hear it (\"Detected by\") and its address, and a \"Movement log\" card lists its recent room changes."),
      t("\"Name this tag\" (or \"Rename\") gives it a friendly name. \"Details →\" opens everything PadSpan knows about it."),
      t("Under the card, \"📍 Locate\" (PadSpan Pro) guides you to the tag, and \"Movement Alerts\" tells you when it moves. Each has its own ? help."),
      t("In Live mode the page updates itself every 5 seconds. In Sample mode it shows the sample house."),
    ],
  },
  follow_selector: {
    title: t("Choosing which tag to follow"),
    body: [
      t("Click the search box (\"Search tags...\") to open the list, or type part of a name, room or address to narrow it. The list is sorted by signal strength, strongest first, so whatever is closest tends to be near the top. Each entry starts with [Tagged], [Unidentified] or [Entity], then its name, room and signal."),
      t("Picking a tag shows it here and also adds it to your followed list, so the Overview map draws it as a followed (amber) marker. The × clears the choice; the tag stays followed."),
      t("Name unnamed devices first so they are easy to find: \"Name this tag\" on the card here, or Tag in Devices → By Room."),
      t("With Quiet on (the tick at the top of the Overview), unnamed devices you don't follow are left out of the list. Turn Quiet off if the one you want isn't there. A device that hasn't been heard for a while may have left range: Devices → By Room shows its Away badge and the last room it was seen in."),
    ],
  },
  follow_map: {
    title: t("Where the tag is now — the card and the room map"),
    body: [
      t("The card under the search box says which room the tag is in now (\"Currently in\" in Basic mode, \"Current room\" in Advanced), its floor, and when a receiver last heard it. A \"Calibrated\" badge with a percentage appears when its place comes from your calibration points: the number is how sure that match is."),
      t("The \"Location map\" draws every room as a box, with your receivers as small green rings in the room they belong to. The tag's room has a stronger outline and the tag is a pulsing teal dot in it. It is a room diagram, not your floor plan: the Overview has the drawn house."),
      t("Both update every 5 seconds in Live mode, with no need to refresh."),
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
      t("Overview is the first page: where everyone and everything is right now, on a drawing of your house. In Live mode it updates every 5 seconds."),
      t("What you see depends on how far setup has got. A house with no rooms drawn yet starts with \"Who's where now\" (each room and who is in it) and a \"Getting started\" card with the steps to a map. Once rooms are drawn, the map is a 3D stack of your floors. Most cards have their own ? help."),
      t("Basic mode keeps it short: the Quiet tick, counts of rooms, objects, scanners and calibration points, the \"Track Your Phone\" card, and the map in \"Your home\"."),
      t("Advanced and Development mode add \"People in building\" (how many people are home; click it to see how the number was reached) and, under the map, cards for Rooms, Objects, Bluetooth radios and Calibration. Their buttons open full lists: \"View rooms list\", \"All objects\" and \"Unidentified\", \"View radios list\". Click a row for its details. \"Clear unidentified\" removes devices nobody has named or followed."),
      t("The Quiet tick (top right) hides devices nobody has named or followed, here and on the other pages, so only the ones you care about remain. It changes what is shown, not what is tracked."),
      t("Other cards come and go: a yellow banner on the sample house (\"Back to my house\" returns to yours; see the Live and Sample help), \"Improve accuracy\" with a last setup tip or two once setup is done, and \"Positioning Diagnostics\" (folded) for support."),
      t("With PadSpan Pro you can make the Atlas your Overview (Settings → Atlas, \"Show the Atlas as Overview\"). This page is then the \"▦ Overview\" side of the Live Tracker."),
    ],
  },
  overview_grid: {
    title: t("The map — What you're seeing"),
    body: [
      t("Once your rooms are drawn in Mapping, the map is a 3D stack of your floors. Each room has its own colour, and rooms that share a wall join into one shape. A numbered dot marks each floor, with the floor names along the bottom."),
      t("Receivers (your Bluetooth scanners) are fixed-size rings with a short name: green when reporting, dim grey when offline. A red blinking inner ring means that receiver is set to active scanning (it asks each device for a little more information), not that it is busy right now. Point at a ring to see its name, room and mode."),
      t("Devices you follow are always drawn, as amber markers with their name and a percentage: how sure PadSpan is of the spot (\"Room only\" when it knows the room but not the spot). They dim and say \"(Away)\" when away."),
      t("Other named devices are hidden until you turn \"Pins\" on: then each is a teal dot, or a red crosshair when away. Devices PadSpan recognises but nobody has named are small dim amber dots. Devices it doesn't recognise at all are not drawn here; Devices → By Room lists them. A blue ring means the device is outside the building and is drawn at its edge."),
      t("Before any rooms are drawn, Overview shows \"Who's where now\" (in Live mode) or a simple box per room instead."),
      t("The row of buttons with the map changes what is drawn: see its ? help. The map updates every 5 seconds in Live mode."),
    ],
  },
  whos_where: {
    title: t("Who's where now"),
    body: [
      t("A house with no rooms drawn yet sees this card first on the Overview, in Live mode. Each room comes from a receiver and the Home Assistant area you gave it: a device belongs to the room whose receiver hears it best. No floor plan needed."),
      t("The line at the top says what your receivers give you so far: none found yet, receivers with no area (home or away only), one room, or several rooms. Give each receiver the area it is in, in Home Assistant."),
      t("Each row is a room and who is in it: named and followed devices by name, then a count of the other devices heard there. \"Heard, no room yet\" collects devices heard only by a receiver with no area."),
      t("Phones Home Assistant already knows through its Private BLE Device integration have a \"Track\" button: one click names and follows the phone, which gives it room and home/away sensors in Home Assistant. \"Not heard right now\" lists the ones out of range. With Enhanced security on, only an administrator can track them."),
      t("\"Make it a map\" opens the guided Setup (floor plan, scale, floors, rooms, receivers, calibration). \"Preview a finished house\" shows the sample house; \"Back to my house\" returns."),
    ],
  },
  getting_started: {
    title: t("Getting started — from receivers to a map"),
    body: [
      t("1. Receivers. PadSpan™ listens through the Bluetooth receivers Home Assistant already has: ESPHome Bluetooth proxies (an ESP32 board in each room is the usual choice), Shelly devices with Bluetooth, or the Home Assistant machine's own Bluetooth. Each one shows up on the Receivers page within a minute. A new install starts on the sample house and switches to your own by itself once PadSpan finds your first receiver."),
      t("2. Rooms. Your rooms are your Home Assistant areas (HA Settings → Areas & Zones). Give each receiver the area it is in. That is already enough for \"Who's where now\" on the Overview."),
      t("3. Your phone and tags. Track your phone with the Overview's \"Track Your Phone\" card, and name your other devices (Tag in Devices → By Room, or \"Name this tag\" on Follow). Then watch any of them on Follow."),
      t("4. A map. Optional, but it gives the 3D view and, with three or more receivers placed, positions between receivers. The \"Getting started\" card on the Overview lists the steps: Upload Floor Plan, Set Scale, Draw Rooms, Place Scanners, Calibrate, and See someone on the map. Click a step to go straight to it, or press \"Open Setup\" for the guided Setup: the same steps in order, with floor heights and receiver heights too, each opening its tool and leading back. \"Skip setup\" hides the card. A Live house with no rooms drawn sees it as \"Make it a map (optional)\"."),
      t("5. Calibration. Calibration (in the menu in every mode) teaches PadSpan your house by recording the signals at known spots. The Calibrate step opens its guided walk-through."),
      t("The Rooms page has each room's settings in one place, and the Receivers page every receiver with its room, height and health. Once setup is done, an \"Improve accuracy\" card on the Overview may suggest a last step or two."),
    ],
  },
  phone_tracking: {
    title: t("Track Your Phone"),
    body: [
      t("The \"Track Your Phone\" card on the Overview (Live mode only) lists the phones that have the Home Assistant Companion app. Once your house has rooms drawn it is folded: click its title to open it."),
      t("Android: the Companion app has a BLE Transmitter sensor that sends a steady beacon, which PadSpan can follow even though the phone keeps changing its Bluetooth address for privacy. Press \"Track\" (Basic mode) or \"Track this phone\" (Advanced and Development). PadSpan names the phone, follows it, switches its BLE Transmitter sensor on in Home Assistant and asks the app to start sending."),
      t("iPhone: the iPhone app has no BLE Transmitter. An iPhone is followed by its IRK (see the Phone Tracking (Private BLE) help). Add it in Settings → Tracking → Phones and guest tags → \"Phone Tracking (Private BLE)\" (Advanced and Development mode) or in Bluetooth → IRK Manager (under More tools). A phone without a key also has \"Add IRK\" in this card. Turn on \"iPhone Setup Path\" in Settings → Features and an iPhone here gets a \"Setup\" button with the steps."),
      t("Other buttons: \"Setup\" on an Android phone means its BLE Transmitter sensor isn't on in the app yet; it shows the steps. \"Enable & Track\" means the sensor is switched off in Home Assistant; it switches it on and tracks the phone (restart Home Assistant afterwards)."),
      t("In Advanced mode the button then says how it went: \"Tracked!\" (a receiver hears it), \"Registered — waiting for signal\" (it is sending but no receiver has heard it yet: walk near one), or \"Registered — enable BLE\" (the app didn't switch the transmitter on: in the Companion app open Settings → Companion App → Manage Sensors → BLE Transmitter and turn it on). Later visits show Tracked, Waiting for signal or BLE off."),
      t("To stop, press \"Unfollow\" (Basic) or \"Untrack\" (Advanced): the phone's name is removed and it is no longer followed. A phone tracked before any receiver has heard it waits in Devices → By Room as \"Waiting for signal\"."),
    ],
  },
  live_tracker: {
    title: t("Live Tracker — the live map, full screen"),
    body: [
      t("Live Tracker is the live map on its own, as large as the screen allows: good for a wall tablet or a second screen. It is in the main list in Advanced and Development mode, and under More tools in Basic."),
      t("Drag to move the map and use the mouse wheel or pinch to zoom; the +, − and ⌂ buttons in the corner do the same, and ⌂ resets the view. \"Search objects, rooms, scanners…\" finds a device, room or receiver and moves the map to it."),
      t("Top left: counts of rooms, named devices (Tracked) and receivers (Radios). Top right: your receivers, each with how many devices it hears; red means it isn't scanning. Click one for its details. When a device changes room, it shows briefly on the map and in a short list of recent moves."),
      t("Below the map, \"Tracked Devices\" lists the devices you follow and their rooms (the target icon centres the map on one), a strip lists every receiver, and the bottom line shows Live or Sample, the counts and the version. ℹ hides or shows these panels."),
      t("\"Controls\" opens the drawing controls: Floor with ◀ ▶, Gap, L/R, Walls, Trails, Pins, Heat and Warp (when those features are on), Save and Collapse. They work as on the Overview's 3D map: see its controls help."),
      t("For a wall screen, open it with ?view=purelive&kiosk=1 in the address: the panel's menus are hidden. If the Atlas is your Overview, a switch above the map (\"⚡ Live Tracker\" or \"▦ Overview\") brings up the classic Overview here."),
    ],
  },

  // ── Objects ───────────────────────────────────────────────────────────────────
  devices: {
    title: t("Devices — four lists of what PadSpan tracks"),
    body: [
      t("Devices is under More tools in every mode (in Advanced and Development mode, Settings → UI Structure can move it into the main list). It has four tabs."),
      t("All Devices: your Home Assistant trackers and the Bluetooth devices PadSpan hears, in one list without duplicates. The counts at the top and the buttons All, Named, Untagged and Missing filter it; the search box finds a name, address or room. Each row has Details, Tag (or Rename) and, for a named device, Untag."),
      t("By Room: every device with its room, signal and history, where you name devices and use Walk-to-Identify. It has its own ? help."),
      t("Registry: PadSpan gives every device a fixed ID (padspan_id) that stays the same when its Bluetooth address, beacon ID or firmware changes. Tick two entries and press \"Merge Selected\" when one device shows up twice, delete an entry, or add an identity link by hand."),
      t("Door Openers (PadSpan Bright Pro or PadSpan Pro): tick a cover, switch, button or script that opens a door, gate or garage, so Mapping → Atlas can link it to that door or window beside its sensor and lock."),
    ],
  },
  objects: {
    title: t("Devices → By Room — every device PadSpan hears"),
    body: [
      t("This list is the By Room tab of Devices (under More tools). It shows the Bluetooth devices your receivers hear (phones, Tiles, key fobs, AirTags, watches) and Home Assistant trackers with a room."),
      t("Basic mode shows a card per device, in two groups: \"Tracked Objects\" (named or recognised) and \"Unidentified\". Each card has Follow, Tag (or Relabel) and Details. Advanced and Development mode show one table, \"BLE Scanner Detections\", with a search box (try a name, an address, or a maker such as apple), kind and status filters, and counts you can click to filter. Click a row for its details."),
      t("The History slider limits the list to devices heard within the last 1 minute up to 1 week. It starts at 4 hours (at 1 week if you set it on the Overview's objects list first)."),
      t("Badges say what a device is. BLE: an ordinary Bluetooth device. Private BLE (blue): a phone or watch recognised by its IRK (see the Phone Tracking (Private BLE) help). iBeacon (amber): a beacon with a fixed ID, such as the Android Companion app's BLE Transmitter or many key finders. Entity: a Home Assistant tracker. A ? after the badge (BLE?) means nobody has named it yet. In Advanced mode more badges show the maker and the kind of device, read from its signal."),
      t("AirTags and other Apple Find My tags change their address (every 15 minutes near their owner's iPhone, once a day away from it) and have no fixed ID; see the Naming help for what keeps their name."),
      t("\"Away\" (red) means the device hasn't been heard for longer than the away timeout (5 minutes unless changed). A line like \"📍 Kitchen · 2h 5m ago\" says the last room PadSpan was sure of, and when; it is kept across Home Assistant restarts. \"Waiting for signal\" marks a phone you set up to track that no receiver has heard yet."),
      t("\"Clear unidentified\" removes the devices nobody has named or followed. Named and followed devices are kept, and a cleared device comes back if it is heard again. With Quiet on (the tick at the top of the Overview), unnamed devices are hidden here too, and the heading says how many."),
    ],
  },
  objects_tag: {
    title: t("Naming (tagging) a device"),
    body: [
      t("A device nobody has named shows its Bluetooth address, like AA:BB:CC:11:22:33. To name it, press Tag (in Devices → By Room or Devices → All Devices) or \"Name this tag\" on Follow. Type a name such as \"Car Keys\" and press \"Save label\". The name is kept in Home Assistant."),
      t("To change a name, press Relabel or Rename: the box then says \"Update label\". To remove a name, press Untag, in that same box, in the device's Details or in Devices → All Devices. The device goes back to its address and is still tracked."),
      t("A named device appears by name everywhere in PadSpan, and Home Assistant gets a device for it with a tracker (device_tracker.car_keys, its state is the room), a room sensor (sensor.car_keys_area), a distance sensor (metres to the nearest receiver) and a distance sensor for each receiver that hears it. See \"HA Entities & Automations\" in Training → Full Manual."),
      t("Some devices change their Bluetooth address. Whether the name stays with them: Tile and Chipolo tags and the Home Assistant Companion app's iBeacon always send the same ID, so the name stays. A phone keeps its name through its IRK (see the Phone Tracking (Private BLE) help). AirTags, other Apple Find My tags and Samsung SmartTags are the hard case: they change their address and everything else they send, so nothing stays the same to recognise them by. For Find My tags, turn on Settings → Features → MAC Rotation Bridging: a tag you've named or followed carries on to its next address when it's clear which one it is (same kind of tag, the old address stopped, heard in the same place). It won't guess: two tags lying together that change at once, or a tag out of range when it changed, need naming again."),
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
      t("Open: in Basic mode it starts the Setup Wizard on that plan, at Set the scale; in Advanced it opens the plan in Edit. Delete removes a plan: its picture and the room outlines and receiver and beacon pins drawn on it. The saved layout in metres (Mapping → Layout) and calibration points with a position in metres are kept. If the plan holds data and another plan sits at the same stack level, you can move the data there first (Migrate & Delete); Revert migration undoes that for 10 minutes."),
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
      t("Rises to (m): select one room and give its height from floor to roof, for a room taller than its floor (a double-height living room, a hall under a gallery). Blank means the floor's height. It is used for drawing Live Aboard, and it is the same value as Ceiling height on the Rooms page. Split level… sets a room's floor a little up or down."),
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
    title: t("Monitor — what PadSpan is hearing, in numbers"),
    body: [
      t("Monitor has six tabs: \"Calls and timing\", \"Zones\", \"Signal and coverage\", \"Quick status\", \"Export for support\" and \"Debug\". It is in the menu under \"More tools\" in every mode."),
      t("Calls and timing — a red \"BLE Feed Unhealthy\" banner at the top means Home Assistant's Bluetooth side reported a problem; restarting Home Assistant (Settings → System → Restart) usually clears it. Below it: how many requests the panel has made and how long they took; \"BLE Objects\" (how many devices PadSpan knows and how many Bluetooth messages it has; click the unidentified count to see those devices); \"Per-Scanner Breakdown\"; \"Advertisement Freshness\" (how recent the latest messages are); \"Snapshot Summary\" (how many objects, rooms, receivers and tags the live data holds, and when it was made); and \"Session Info\"."),
      t("Per-Scanner Breakdown — one row per receiver: how many devices it hears, its \"Best-RSSI\" and a grade. Best-RSSI is the average signal strength of only the devices this receiver hears louder than any other receiver does, so a device that is nearer another receiver doesn't pull its number down. The grade is Excellent from −60 dBm, Good from −70, Fair from −80, and Poor below that. Click a row for that receiver's details."),
      t("Zones — one card per room, busiest first (see the Zones help)."),
      t("Signal and coverage — \"Room Occupancy\" (how many devices are in each room), \"Signal Quality\" (the same Best-RSSI figures), \"Object Mobility\" (devices seen in more than one room), \"Coverage Gaps\" (rooms with nothing in them right now, and receivers that aren't on any floor plan), \"Device Breakdown\" (Total, Identified, Unidentified and Tagged, meaning the ones you have named) and \"Dashboard Card Preview\" (a sketch of what a Home Assistant dashboard card could show with your current data)."),
      t("Quick status — just a link: press \"Open Health\" for the system checks and the Problems found list."),
      t("Export for support — press \"Build export\" to collect the panel's state, the server's state, the live data and the automatic checks into one report, then \"Copy\" it and email it to hello@traks.ca, or attach it to a GitHub issue (GitHub issues are public, so remove personal details first). The device list is cut to 200 entries but always keeps every device that is identified, named or a Private BLE phone; the advertisement list is cut to its first 200. \"Install Verification\" below it compares the panel's version with the server's (see the Diagnostics help). Debug shows the panel's own state, for support."),
    ],
  },
  zones: {
    title: t("Zones — Every room, at a glance"),
    body: [
      t("Zones is a tab of Monitor (under More tools). It shows one card per room, sorted so the busiest rooms come first. A coloured left border means the room currently has something in it; an empty room's card is dimmed grey."),
      t("Each card lists what's in that room — up to 8 objects by name, with signal strength in dBm and a small dot for anything you're following. Click a card, or an object inside it, to open its full detail view."),
      t("The badge row at the top counts rooms, occupied rooms, empty rooms, and total tracked objects."),
      t("If your Home Assistant floors are set up, rooms are grouped under their floor's name. Quiet (the tick at the top of the Overview) hides unnamed devices here too, showing only named and followed ones."),
    ],
  },
  insights: {
    title: t("Insights — Time spent in each room"),
    body: [
      t("Insights is a mode of Traceback (Traceback → Insights). It turns the history Traceback records into two tables, for the last 1, 3 or 7 days (the 1d, 3d and 7d buttons at the top)."),
      t("Time in Room: for each tracked device and each day, how long it spent in each room and how many times it went in."),
      t("Peak Concurrent Occupancy: for each day, the most tracked devices seen in one room at the same time, and the hour it happened."),
      t("\"Export CSV\" on the Time in Room card saves that table; \"Export JSON\" saves everything Insights read. Refresh reads the history again."),
      t("It reads the same 7 days of history Traceback keeps, so it covers only the devices you have named or follow, and nothing older. It works without a floor plan. For the same history as one picture per room, see Busy Times."),
    ],
  },
  busytimes: {
    title: t("Busy Times — Which rooms are busiest, and when"),
    body: [
      t("Busy Times is a mode of Traceback (Traceback → Busy Times). It adds up the time every tracked device spent in each room over the last 1, 3 or 7 days and shows one box per room, busiest first."),
      t("Each box shows the room's total occupied time, coloured by how busy it was compared with the busiest room in that range, and a 24-hour bar chart of when in the day it gets busy. The red bar, and \"busiest\" with an hour, mark its busiest hour."),
      t("It reads the same history as Insights, which has the day-by-day tables for each device. It works without a floor plan. It is not a signal map: it shows where people spent time, not where your receivers hear well."),
      t("Busy Times is a PadSpan Pro feature. Without a key it shows how to unlock it (Settings → Features → PadSpan licence) and, where the free trial is offered, a \"Start 90-day free trial\" button. The trial needs the usage report on for as long as it lasts."),
    ],
  },
  locate: {
    title: t("Locate — Which way to walk to find something"),
    body: [
      t("Locate is on Follow: pick a tag, then press \"📍 Locate\". It tells you which way to walk to find that tag, using the same receivers that track everything else: no compass, no camera. It is a PadSpan Pro feature."),
      t("Under \"You are carrying:\", pick the tracked device that is yours, usually your phone. If your phone isn't tracked yet, see the Track Your Phone help (Overview → \"Track Your Phone\"); the Phone Setup Wizard, switched on in Settings → Features, can help too."),
      t("In the same room, Locate shows the straight-line distance in metres, with \"getting closer\" or \"getting further\" as you move."),
      t("In another room, it says which room to head to next, and whether to go up or down a floor. The route follows the room connections drawn in Mapping → Layout (Advanced and Development mode). If no route is drawn between the two rooms yet, it names the room the tag is in so you can go there directly."),
      t("It deliberately doesn't use your phone's compass: indoors, near receivers and wiring, a compass is not reliable enough to trust."),
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
      t("Click a row to open it: the three scores and the overall, \"Identity & Network\", \"Activity Metrics\", \"Cross-Scanner Comparison\" (how many devices it shares with each other receiver) and \"Health Verdict\". When its hardware differs from the top-ranked receiver's by 2 dBm or more, a note says by how much (\"~X dBm\"). As a rule of thumb, 3–5 dBm is noticeable and 6 dBm or more suggests different hardware."),
      t("Click a receiver's name for its details window: its room (shown, not changed there), network details, the devices it hears, and \"Mark as Lost\" / \"Mark as Disabled\". To change its room, use Overview → \"View radios list\" → \"Assign\" or \"Change\", or Mapping → Edit → Radios → \"Room\" (Advanced and Development modes)."),
    ],
  },

  // ── Calibration — Beacon Tune ────────────────────────────────────────────
  calibration_beacon: {
    title: t("Beacon Tune — Pin beacons that stay in one place"),
    body: [
      t("Beacon Tune (marked EXPERIMENTAL) is for Bluetooth beacons that stay put: a Tile on a shelf, a key finder by the door, a fixed iBeacon. You mark where each one really is, and PadSpan keeps learning from it while it sits there. It needs a floor plan."),
      t("To add one: pick the floor, choose the beacon in \"select beacon to add\" (the list holds devices you have named or follow) and press \"Add to map\". It appears in the middle of the floor; drag it to where the beacon really is. Or click a beacon marked \"Not placed\" in the list under the map, then double-click the map where it is. Press Save to keep the beacons' places."),
      t("Placing or dragging a beacon starts a 60-second capture: leave the beacon where it is until the timer ends, and the readings are saved as a calibration point."),
      t("A beacon you place is pinned as a fixed beacon: PadSpan shows it in its pinned room instead of working the room out from signals. A device PadSpan knows moves is never pinned: a phone with its IRK, a Find My tag (such as an AirTag) it has followed across an address change, or anything you follow. That one gets the single 60-second capture, then goes back to live tracking. Follow a tag that moves before placing it."),
      t("\"Auto-Cal: ON/OFF\" (on unless you turn it off): while a pinned beacon sits still, PadSpan adds a fresh calibration point from it, at most once every 10 minutes per beacon and only when at least two receivers hear it well. Each beacon keeps at most 50 of these points; past that the oldest are removed. They are labelled [auto] on the Model tab. Adaptive Learning (Settings → Tracking → Positioning and calibration) adds them too, even with Auto-Cal off."),
      t("Moving a beacon: drag it to its new spot (or use \"Relocate\"), and another 60-second capture follows. If you move the same beacon three times within about 6 minutes, PadSpan asks about a \"hard relocation\". OK DELETES that beacon's earlier Beacon Tune points and its [auto] points, once the new one has saved; this can't be undone. Points you collected by carrying the same device (Pin & Listen, Roam, Walk a room) are kept, and so are Beacon Tune points saved by an older version of PadSpan, which didn't mark them. Cancel keeps the old points and adds the new one. Choose OK only if the old spots were wrong."),
      t("The small ? beside a beacon's position opens \"Position Percentages\": what its x% and y% mean (how far across and down the floor plan image it sits) and how signal strength is read."),
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
    title: t("Live and Sample — your house or the sample house"),
    body: [
      t("Live shows your own house: your receivers, your devices, your rooms. Sample (\"Preview a finished house\") shows a sample house on three floors with every feature set up, so you can see what PadSpan does before your own setup is finished."),
      t("The sample house is read-only. Anything that would change it is refused with a message; only how the panel itself looks (its theme and style) can be changed there. Nothing you do on the sample house touches your own."),
      t("Live or Sample is this browser's own choice: one person previewing the sample house doesn't switch a wall screen or anyone else. A new install starts on the sample house and switches to Live by itself once PadSpan finds your first receiver."),
      t("To switch, use the Data button at the top right (on a phone, the button at the top), which shows the current mode. From Live, the first click turns it into \"Show demo data?\": click again within 3 seconds to open the sample house; otherwise it goes back to Live. From Sample, one click returns to Live. On the Overview, the yellow sample-house banner has \"Back to my house\", and \"Who's where now\" has \"Preview a finished house\"."),
      t("If the house itself is still set to Sample and Enhanced security is on, only an administrator can switch it back to Live."),
    ],
  },

  // ── Complexity Mode ────────────────────────────────────────────────────
  complexity_mode: {
    title: t("Basic, Advanced and Development"),
    body: [
      t("The mode button at the top right (it reads Basic, Advanced or Dev; on a phone, the button at the top) cycles through the three modes, and this browser remembers your choice. Every screen is in the menu in every mode: the mode decides which screens are in the main list (the rest are in \"More tools\" at the bottom of the menu, closed until you open it) and how much detail each screen shows."),
      t("BASIC — A short main list: Follow, Overview, Mapping, Rooms, Receivers, Calibration, Settings, and Training; everything else is under More tools. The screens keep to the essentials, for anyone at home who just wants to see where things are."),
      t("In Basic, a link to part of an expert screen (a room's outline, a receiver's place, the floor heights, the usage report) opens just that part, with \"← Back\" to where you were. The mode stays Basic."),
      t("ADVANCED — The default mode. The main list adds Live Tracker, Manage, Traceback, Occupancy, and Health; the rest (Devices, Bluetooth, Presence, Monitor, QA, Sandbox and more) are under More tools. Tick a tab in Settings → UI Structure to move it into the main list."),
      t("DEVELOPMENT — The same menu as Advanced, with more diagnostic detail inside the screens. Use it when troubleshooting, or when support asks you to check diagnostic data."),
      t("Forensics and Guests, while switched on, are in the main list in every mode."),
      t("Changing complexity mode doesn't delete any data — it only changes the sidebar's main list and the detail inside screens. Your settings, calibration, and device data are always preserved."),
    ],
  },

  // ── Overview 3D Controls ───────────────────────────────────────────────
  overview_3d_controls: {
    title: t("3D map controls"),
    body: [
      t("The row of small buttons with the 3D map changes only how the map is drawn. Nothing here moves a device or changes tracking."),
      t("FLOOR — The slider and ◀ ▶ pick which floor (or pair of floors) is shown large. \"All floors\" shows the whole building."),
      t("OUTDOOR — Also draws sheds, driveways and other areas that are not a storey. They are fitted inside the building's footprint, not drawn at their true distance."),
      t("GAP — How far apart floors are drawn, vertically, in the isometric stack. Purely visual — it does not change any stored measurement, only how tall the drawing looks."),
      t("L / R — Shifts each floor sideways relative to the one below it, so a staggered building (an upper floor that does not sit directly over the main floor) can be drawn the way it actually looks, instead of every storey stacking straight up."),
      t("SAVE keeps Gap, L/R and the floor choice as this map's default for everyone; RESET puts all three back to the defaults."),
      t("ROOMS — Opens a list of the rooms on the map; click one for its details."),
      t("▣ OVERHEAD — Switches to the flat top-down map (the 2D view). Its \"◈ 3D view\" button comes back here."),
      t("PINS — Off by default: only devices you follow are drawn as markers. With Pins on, every named or recognised device is drawn too, as a teal dot, or a red crosshair when away."),
      t("WALLS — Shows the signal walls drawn in Mapping → Edit: the walls PadSpan allows for when a signal passes between rooms."),
      t("TRAILS — Off by default. Draws a fading line behind each moving device."),
      t("HEAT — Needs Radio Map switched on in Settings → Features. Colours each floor by how well your receivers hear it, from your calibration data: green strong, red weak."),
      t("WARP — Needs Signal distortion map switched on in Settings → Features (the button reads \"→ Signal distortion\" until first used). Arrows show where PadSpan's guess of a spot misses where your calibration points say it really is: long arrows mean that area needs work. Heat and Warp take turns: turning one on turns the other off."),
      t("With Heat or Warp on, a second row appears: Gain (brighter or dimmer overall), Contrast (how sharply strong and weak differ), Warp % (how long the arrows are drawn) and Source (from the calibration model alone towards what PadSpan has learned over time). Save keeps them."),
    ],
  },

  // ── Overview 2D Controls ───────────────────────────────────────────────
  overview_2d_controls: {
    title: t("2D overhead map controls"),
    body: [
      t("The flat overhead map is marked EXPERIMENTAL. Turn it on with \"▣ Overhead\" on the 3D map, or with Settings → Appearance → 2D Map Mode; \"◈ 3D view\" goes back."),
      t("The buttons above it show or hide layers (◉ on, ○ off):"),
      t("MAP — The floor plan picture. The Overview keeps it off, because floor plan pictures are a setup tool in Mapping: the map shows rooms and devices only."),
      t("ROOMS — Room outlines and names, as drawn in Mapping → Edit."),
      t("SCANNERS — Your receivers: green when online, grey when offline."),
      t("TAGGED — Named or recognised devices, as teal dots. Devices you follow are always shown, in amber."),
      t("UNKNOWN — Devices nobody has named, as small dim amber dots. Off by default."),
      t("Devices sit near their room's centre here, fanned out, not at their exact spot."),
      t("RADIO MAP and SIGNAL DISTORTION — Shown when those features are switched on in Settings → Features: a signal-strength overlay (green strong, red weak) and the places where PadSpan's guesses miss. With Radio Map on, pick \"Combined\" for all receivers or one receiver to see its reach."),
      t("FLOOR SELECTOR — With more than one floor, click a floor's name to switch. A floor with more than one plan shows them joined into one view, placed the way they are lined up in Mapping → 3D Stack."),
      t("Zoom with the mouse wheel and drag to move around. \"Reset zoom\" goes back to the starting view."),
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
      t("Phone Tracking (Private BLE) — track phones and watches that keep changing their Bluetooth address, by each one's IRK. \"Auto-Detect IRKs\" looks for keys PadSpan can find on its own; or paste a key, give it a name and press \"Add IRK\". See the \"Phone Tracking (Private BLE)\" help for what an IRK is."),
    ],
  },
  guest_tags: {
    title: t("Guest tags — Lend a tag to a guest"),
    body: [
      t("A guest tag is a device PadSpan already knows by a name you gave it (a beacon, a Find My tag, a spare phone), lent to a house-sitter, a visitor or a cleaner. While they have it, PadSpan follows it room by room."),
      t("Turn it on in Settings → Tracking → Phones and guest tags → Guest tags (\"Use tags as guest tags\"); in Basic mode, Settings → \"Guest tags →\". You are asked to confirm. On the same card, choose how long a finished stay's report is kept: not kept, 7, 30 (the default) or 90 days. While it is off nothing is tracked or kept, and the Guests screen is hidden; while it is on, Guests is in the menu in every mode."),
      t("The Guests screen: \"Staying now\" shows each stay running now (who, which tag, the room they are in, how long so far). \"Guest tags\" lists your guest tags, each with \"Lend to a guest\"; \"Use as a guest tag:\" adds another device you have named (name a spare tag first, like \"Guest tag 1\"). A tag with a steady identity works best: a beacon, a Find My tag, or a phone PadSpan recognises by its key. \"Past stays\" keeps each finished stay's report: when they arrived and left, time in each room, and visits to rooms they shouldn't go into."),
      t("Lending a tag starts a stay. Give the guest's name, an end time if you like, the rooms they shouldn't go into (you are told if they are there for half a minute), whether to be told when they arrive or leave, quiet hours, and where the notices go. \"Staying here (a house-sitter)\" counts them as someone home for Vacation Mode. \"Tag returned\" ends the stay and keeps its report, \"Change\" edits it and \"Traceback\" replays it; \"Forget\" deletes a past stay. On the maps, a lent tag shows the guest's name with an amber \"Guest\" label."),
      t("Tell your guests the tag is tracked. Guests' names stay in this Home Assistant: never in the usage report, never in a PadSpan backup (Home Assistant's own full backups do include them, with the rest of its data). Only an administrator can lend a tag or end a stay."),
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
      t("Quiet Mode — hides unidentified Bluetooth devices from Devices → By Room, the Overview counts and the dropdowns, so only devices you named or follow are shown. Scanning carries on and nothing is deleted. This card only explains it: switch it with the Quiet tick at the top of the Overview (the card's button takes you there)."),
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
      t("Device maker lookup — when you open a device list such as the Overview's \"All objects\" or \"Unidentified\", PadSpan can ask macvendors.com and maclookup.app which company made each nearby Bluetooth device. It sends only the first three bytes of an address, and only after a Bluetooth receiver has confirmed that the device has a fixed, maker-assigned address (ESPHome proxies on version 2022.12 or newer and Home Assistant's own Bluetooth say so, and PadSpan remembers it; Shelly, ESPresense and Tasmota don't, so a device only they have heard isn't looked up). Each answer is kept for 30 days. It is on by default; an administrator can turn it off in Settings → Tracking → Privacy, updates and feedback → \"Look up device makers online\"."),
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
      t("Events — alerts by email or phone when a device changes room, and a button that opens History → Movement, the saved list of room changes."),
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
      t("Uploaded Maps — deletes a floor plan: its picture and the room outlines and receiver and beacon pins drawn on it. The saved layout in metres (the rooms and receivers on Mapping → Layout) is kept, and so are the plan's calibration points that have a position in metres: they are no longer on any map and are still used for positioning. Only an old point saved without a real-world position is deleted. To remove the points too, first use that map's Clear in Settings → Scanner Map, which deletes its calibration points. Traceback recordings stop pointing at the map, and it is taken off the list of hidden maps. Make a backup first if you might want it back."),
      t("Backup & Restore — \"Create Backup\" saves PadSpan's data: settings, calibration, maps and their images, labels, alerts, history, Live Aboard and more. \"Restore…\" lets you tick what to bring back; maps and the room model are restored together, so positions can't point at a missing map. Backups are kept inside PadSpan, so a Factory Reset deletes them too."),
      t("Integration Controls — \"Reload integration\" restarts PadSpan without restarting Home Assistant (useful when things seem stuck). \"Reset room colors\" clears every room colour you picked; colours are then made from the room names again."),
    ],
  },
  manage_entities: {
    title: t("Manage → HA Entities"),
    body: [
      t("The entities PadSpan creates in Home Assistant for each Bluetooth device you named, and the other ways it can take in or send out data. A named device has up to four kinds, their IDs taken from its name: for Car Keys, device_tracker.car_keys, sensor.car_keys_area, sensor.car_keys_distance, and a sensor.car_keys_distance_… for each receiver that hears it."),
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
      t("It only adds. A floor PadSpan already has is kept as it is, and so is a room (that one counts as skipped); new ones are added. Receivers come in named espresense_ followed by the node's ID, so your other receivers are never touched. Running it again is safe: an imported receiver's position is taken from Companion again, but a room you gave it yourself is kept."),
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
    title: t("Manage → Events — Room-change alerts"),
    body: [
      t("To get here: Manage → \"Events\" tab. (Manage is in the main menu in Advanced and Development modes, and under \"More tools\" in Basic.)"),
      t("Saved Alerts lists every alert you set up, by an email address or a notify service: the device, where it goes, the rooms watched, and a button to delete it."),
      t("Configure Alerts sets one up: pick a device, type an email address or choose a notify service (\"Auto-detect\" finds one), tick \"Alert on room change\", tick only some rooms if you like (none ticked means every room), then press \"Save Alert\". \"Test Notification\" sends one now. Needs Live mode. The same alerts can be set on Follow."),
      t("PadSpan sends through Home Assistant's own notify services, so one has to be set up there first. \"No notification services found\" means Home Assistant has nothing to send through yet: set up the Companion app on a phone, or a mail integration such as SMTP, then press \"Refresh Services\"."),
      t("Below that, \"Open History\" opens History → Movement, the saved list of room changes."),
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

  // ── Rooms page and guided Setup ────────────────────────────────────────
  rooms: {
    title: t("Rooms — Each room's settings in one place"),
    body: [
      t("Rooms lists every room, grouped by floor. It is in the main menu in every mode, Basic included."),
      t("Rooms and floors are your Home Assistant Areas and floors, so their names can't be changed here. \"Rename in Home Assistant\" opens that area, and \"Add a room in Home Assistant\" opens Areas; press Refresh when you come back. A room drawn in PadSpan that is not an area is marked \"PadSpan only, not a Home Assistant area\"."),
      t("Colour: the square next to the room's name. A new colour saves at once and is used on every map."),
      t("Outline: whether the room is drawn on its floor plan, and its size in m². \"Edit outline\" (or \"Draw outline\") opens Mapping's room tool on that room; in Basic you get just that tool, with a way back. With no floor plan yet, \"Add a floor plan\" takes you to Mapping."),
      t("Ceiling height (m): only for a room taller than the rest of its floor, such as a double-height living room. Type the height and press \"Save height\"; leave it blank for the floor's height. It changes the 3D view, never positioning. It is the same value as Rises to on Mapping → Layout."),
      t("Split level (m up or down): for a room whose floor sits higher or lower than the rest of its floor, such as a step-down living room. Press \"Change\", type how far up (or down, with a minus: up to 3 m up or 1.5 m down) and press Save. Ceiling height and split level need the room's outline first."),
      t("Receivers: how many Bluetooth receivers are in the room, with \"See receivers\". In it now: who is in the room at the moment, and how many other devices."),
      t("In Sample mode the demo house's rooms are shown and nothing can be changed. In PadSpan Bright each room also shows its lights (how many, and how many are on); its receivers and who is in it show only when Bright's presence screens are switched on."),
    ],
  },
  setup: {
    title: t("Setup — Your house, one step at a time"),
    body: [
      t("Setup puts setting up the house in order, as six steps: 1. \"Upload a floor plan\", 2. \"Set the scale\", 3. \"Floors and their heights\", 4. \"Draw the rooms\", 5. \"Place receivers and set their heights\", 6. \"Calibrate\". Each step opens the tool that already does that job; come back here when it's done."),
      t("Each step is marked Done, Next, To do or Skipped. Done is read from the house itself, so a step you finished somewhere else counts too. A house with one floor has no floor heights to set, and Calibrate is done at 5 calibration points."),
      t("Each step's button says \"Start →\", \"Continue →\" (where you left off), \"Open\", or \"Change\" once it's done (\"Add a floor\" on the floor plan step). \"Skip for now\" moves on and marks the step Skipped; open it again any time. The floor plan step can't be skipped, because every later step uses a plan."),
      t("Where the steps go: the floor plan, scale, rooms and receivers steps open Mapping's set-up wizard at that step; floors opens the Floor Heights card (just that card, in Basic); Calibrate opens Guided calibration. While you work in a step's tool, a bar at the top says which step it is, with \"← Back to Setup\". Setup remembers where you were."),
      t("To open Setup: \"Open Setup\" on the Overview's Getting started card, \"Make it a map\" on the Overview's Who's where card, the Setup button at the top of Mapping, or \"Start Setup Wizard\" in Mapping when there are no floor plans yet."),
      t("Setup works on your own house: while the demo house is showing, its buttons can't be used until you press \"Back to my house\". Only an administrator can add or change floor plans."),
    ],
  },

  // ── Calibration ────────────────────────────────────────────────────────
  calibration_overview: {
    title: t("Calibration — Teaching PadSpan your home"),
    body: [
      t("Calibration teaches PadSpan what your house sounds like. You carry your phone or a tag to spots around the house, and at each spot PadSpan records how strongly every Bluetooth receiver hears it. These calibration points are what it later compares live signals with, to put people in the right room."),
      t("Calibration is in the main menu in every mode, with the same tabs in Basic and Advanced. It opens on Results: how accurate PadSpan is now, room by room, and the next best thing to do. The easiest way to start is \"🧭 Guided calibration\" (on Results, and at the top of every other tab), which takes you through the steps in order."),
      t("The floor plan needs a scale first. A calibration point is a spot measured in metres, so on a floor with no scale it can't be saved: the card \"This floor needs a measurement first\" and its \"Measure this floor →\" button take you to measure one distance you know."),
      t("RESULTS — how accurate it is now, and what to do next. Its ? explains the numbers."),
      t("TUNE — drag each receiver marker on the 3D map to where the receiver is really mounted, then press Save. Click a marker to set its \"Height above floor (m)\" and press \"Save height\" (2.4 m until you change it). It is the same height as on the Receivers page and, in Advanced, in Mapping → Edit → Radios: change it in one place and the others follow. Tune records no signals."),
      t("BEACON TUNE — pin beacons that stay in one place, so they keep calibrating on their own. Its ? has the details."),
      t("BEACON AND FLOOR — pick the phone or tag you will carry (\"Beacon Device\"), the \"Floor\" you are calibrating, and the \"Collection Duration\": 15, 30, 60 or 90 seconds at each spot. It starts at 15 s; the screen recommends 60 s, about one reading a second from each receiver. Plan on 10–20 spots spread across each floor."),
      t("PIN & LISTEN — tap the map where you are standing, press \"Start Collecting\" and stand still until the time is up (\"Stop & Discard\" cancels). Then press \"Save Point\" to keep it, or \"Discard\"."),
      t("ROAM — the same collecting, but PadSpan picks the spot. The coverage map shows which parts of the floor are covered, partly covered or not yet covered, and a blue crosshair marks the \"Next Target\". Walk there, stand still and press \"I'm Here — Collect\". Once the accuracy has been worked out, a \"Priority:\" card names the room PadSpan gets wrong most often and how many more points it needs."),
      t("MODEL — press \"Compute Model\" after adding points (it needs 4 or more). The Summary shows your calibration points, receivers and floors, and \"Est. Accuracy ~X m\": how far off PadSpan's guess was on average when each point was tested, green under 2 m. It is a distance, not a percentage, and it reads better than real life. The line under it, \"Tested on spots it hasn't seen\", is the stricter test Results leads with."),
      t("Model also shows \"Per-Room Accuracy\", with the room each one is most often \"Confused With\"; a \"Scanner Coverage\" table of how strongly each receiver hears your points; and every calibration point, each with its own Delete."),
      t("Model's Actions: \"Export JSON\" saves all your calibration points to a file, and \"Import\" reads one back, skipping points you already have (press Compute Model afterwards). \"Clear All\" deletes every calibration point in the house after one more confirmation. That can't be undone, so export first."),
      t("ACCURACY BY SPOT shows, point by point and receiver by receiver, where the readings disagree. WALK A ROOM calibrates a whole room in one 90-second walk, and is off until you turn it on. Each has its own ?."),
      t("Tips: more points make it more accurate, especially in doorways and near the walls between rooms, where rooms are hardest to tell apart. Hold the phone the way you usually carry it. Press Compute Model again after adding points."),
      t("For experts: in Advanced, Settings → Tracking → Positioning and calibration → \"Positioning Algorithm\" chooses how the points are used. \"Matched to calibration points\" (the default) compares live signals with the nearest points; \"Learned model (experimental)\" trains a model on them. Both use the same points. Model's \"Signal vs distance\" table is each receiver's fit of signal strength against distance."),
    ],
  },
  calibration_results: {
    title: t("Results — How accurate it is, and what to do next"),
    body: [
      t("Results is the tab Calibration opens on. It only reads your calibration: nothing here saves or deletes anything, and each button takes you to the tab or tool that does the work."),
      t("How accurate it is now: \"rooms right\" is the share of test spots PadSpan put in the right room, and \"typical distance off\" is how far off it usually was, in metres. Both come from a strict test on spots it hasn't seen: PadSpan hides a spot, and every calibration point within 1.5 m of it, then checks where it would have placed someone standing there."),
      t("The line under the numbers gives that test for both ways PadSpan can place someone: from your calibration points (fingerprints) and from where the receivers are (spatial), and says which did better. Before the test has run you see an estimate instead (\"estimated distance off\"), which reads better than real life. Below 4 points there is nothing to work out yet."),
      t("The next best thing to do: one suggestion, the first that applies. Measure a floor plan that has no scale (points on it can't be saved); start calibrating; say how high the receivers are mounted; give the floors their real heights; work the accuracy out again after new points; add points in a room that has none, or in the room PadSpan gets wrong most often; or walk the house again once the newest point is over 90 days old. When nothing stands out, it suggests Accuracy by spot."),
      t("Room by room: rooms that need work come first: no points yet, fewer than 3 points, or under 70% right. \"mixed up with\" names the room it is most often confused with. Rooms that look fine fold away under one line."),
      t("Why a room can read higher than the headline: each room's % comes from the older, more generous score, which keeps nearby points in when it tests a spot. The headline uses the strict test on spots it hasn't seen. So a room can show 90% while the house shows 75%; trust the headline."),
      t("In Basic, \"Floor heights →\" opens just the Floor Heights card, and \"Measure →\" opens Mapping's set-up wizard at its scale step. In Sample mode Results shows made-up numbers for the demo house."),
    ],
  },
  calibration_guided: {
    title: t("Guided calibration — The steps in order"),
    body: [
      t("\"🧭 Guided calibration\" takes you through calibration one step at a time, using the ordinary tabs. Open it from Results, from the button at the top of any other Calibration tab, or from Setup's Calibrate step."),
      t("1. Check scanner positions (Tune): optional. Drag any receiver marker that isn't where the real receiver is mounted, or press \"Skip — positions look fine\"."),
      t("2. Choose your device (Beacon and floor): pick the phone or tag you will carry, and the floor. The floor plan needs a scale; if it has none, \"Measure this floor →\" takes you to measure one distance. Steps 3 to 5 stay locked until this is done."),
      t("3. Walk your home (Roam): walk to the blue crosshair, stand still and press \"I'm Here — Collect\"; the map then picks the next spot. There is no fixed number, but 10–20 spots spread across the floor is a good aim. To pick the spots yourself, leave the guide and use Pin & Listen."),
      t("4. Compute your model (Model): press \"Compute Model\". \"Est. Accuracy\" shows how far off PadSpan's guess was, on average."),
      t("5. Finish: how many points this floor and the whole house have. \"+ Calibrate another floor\" goes back to step 2 for the next floor, and \"Done\" closes the guide. Outside Basic, \"See detailed quality report →\" opens QA."),
      t("\"✕ Exit guide → full tabs\" leaves at any time and keeps every point you saved. Opened from Results, it takes you back there."),
    ],
  },
  calibration_matrix: {
    title: t("Accuracy by spot — Where the readings disagree"),
    body: [
      t("Accuracy by spot is a table with one row per calibration point and one column per receiver. Each cell compares how far the point really is from that receiver (from your room and receiver layout) with how far the receiver's signal says it is. Hover over a cell to see the numbers."),
      t("Green means they agree. Blue means the signal makes the point seem farther away than it is; red, closer. Grey means that receiver never heard the point."),
      t("A column that is blue or red all the way down usually means that receiver's position or height is off (fix it on Tune), or something is in its way. A row that is off everywhere is usually a point saved in the wrong place: delete it on the Model tab and collect it again."),
      t("Rows marked 📍 are beacons pinned in Beacon Tune, refreshed live. \"📍 Anchored Beacon Drift\" lists how far each pinned beacon's live position is from its pin, as OK, WARN or BAD."),
      t("\"Relearn (recompute model)\" works the model out again from your current points, the same as Compute Model on the Model tab. It deletes nothing."),
      t("The table needs each receiver's signal-vs-distance fit, so collect some points and press Compute Model first. Rooms PadSpan keeps flipping between in live tracking are a different thing: see Health → \"Room mix-ups\"."),
    ],
  },
  calibration_walk: {
    title: t("Walk a room — Calibrate a whole room in 90 seconds"),
    body: [
      t("Walk a room is off by default. Turn it on in Settings → Tracking → Positioning and calibration → \"Walk a Room (Calibration)\" (Advanced mode); a \"Walk a room\" tab then appears in Calibration. It needs Live mode."),
      t("First pick the phone or tag and the floor on the Beacon and floor tab. Then choose a room, press \"Start walking\" and walk slowly for 90 seconds: along the walls, into each corner, then through the middle, holding the phone the way you usually carry it. Stay in the room until the ring is full. \"Cancel & discard\" stops early."),
      t("Nothing is saved until you say so. The summary shows what was heard and how different the room sounds from the closest other room. Press \"Save this walk?\" to keep it, or \"Discard\". After saving, PadSpan tests itself again and shows the result before and after."),
      t("Each room keeps one walk: saving a new walk replaces that room's earlier walk only, and \"Remove the walk of\" a room takes out just its walk points. Your other calibration points are never touched. Turning the setting off hides the tab, but saved walks stay in use."),
      t("The rooms are the ones drawn on that floor; if none are drawn yet, draw them in Mapping first."),
    ],
  },

  // ── Forensics ──────────────────────────────────────────────────────────
  forensics: {
    title: t("Forensics — Time-window presence search"),
    body: [
      t("Forensics answers: which Bluetooth devices were near my receivers between two times? For example after a break-in or a package theft, or to spot an unknown tracker that keeps coming back. It is a PadSpan Pro feature."),
      t("Turn it on in Settings → Features → Forensics → \"Enable presence-session recording\". It asks you to confirm and, if this install doesn't have PadSpan Pro, for a licence key. While it is on, Forensics is in the main menu list in every mode. In Live mode PadSpan checks every 60 seconds which devices it hears and records presence sessions: stretches of time a device was heard. More than 5 minutes of silence ends a session."),
      t("Search: pick a start and an end time (times are local), or press \"Last hour\", \"Last 24 h\" or \"Last 7 days\", then press \"Search window\"."),
      t("\"Recorded — actually present\" lists the devices with a recorded session in the window, the longest stay first: its sessions, time in the window (Dwell), strongest signal, and the receivers that heard it. \"Hide my labelled devices\" hides the ones you named, so strangers stand out. \"Export CSV\" saves the results."),
      t("\"Possible\" appears only when the window reaches back before recording began: devices whose first-seen/last-seen times overlap the window but have no recorded session in it. They may have left and come back, so treat them as less certain. They come from the device list's first/last-seen history (Devices → By Room), which is kept as long as Settings → Tracking → What the panel shows → Object History Retention says."),
      t("Reliability: a Bluetooth address is not a person. Phones change their address every 15 minutes to 24 hours, so most phones show as one-off addresses; devices with a fixed address (earbuds, trackers, speakers, gadgets) are what this finds reliably. Addresses can also be faked. Treat results as leads, not proof."),
      t("Privacy: it records every device nearby, including neighbours' and passers-by's. Recordings stay in your Home Assistant and are never uploaded. The Settings card keeps sessions for 7, 14 (the default), 30, 60 or 90 days, even after you turn recording off, and \"Delete all recorded data\" erases them."),
    ],
  },

  // ── Traceback ──────────────────────────────────────────────────────────
  traceback_overview: {
    title: t("Traceback — Replay where devices went"),
    body: [
      t("Traceback replays where your tracked devices went. About every 10 seconds PadSpan records where each device you have named or follow is. Unnamed devices are not recorded, and neither are beacons pinned in Beacon Tune, since they don't move. It keeps 7 days."),
      t("Traceback is in the main menu in Advanced mode, and under More tools in Basic. The row at the top switches between Playback, New Objects, Insights and Busy Times."),
      t("PERIOD — the \"Time range\" buttons (5 min up to 7 days), a number of minutes typed in the small box with Go, or \"Custom range\" with a start and an end and Load."),
      t("OBJECT — \"All objects\", or one device to follow its trail alone. Devices are grouped by kind, and receivers are left out. Devices that never changed rooms are hidden automatically once at least two others moved."),
      t("PLAY — ▶ plays the whole period. \"Run time\" (1 to 60 minutes, 5 to start with) is how long the whole replay takes. Step one frame back or forward, jump to the start or end, or drag the timeline. \"Export CSV\" and \"Export JSON\" save the recorded frames."),
      t("WHERE THE DOTS ARE — each device is drawn where live tracking placed it at that moment, in metres; when there was no position, at the centre of its room."),
      t("NEW OBJECTS — a search, not a replay: which of the devices PadSpan knows now were first heard in a window, \"From\" so many minutes ago \"to\" so many minutes ago (up to 7 days back), or a Quick button from \"Last 5 min\" to \"2-4 hr ago\". Click a result to see that device."),
      t("INSIGHTS and BUSY TIMES — time spent in each room, and which rooms are busiest when. Each has its own ?. Both work without a floor plan."),
      t("FULL HOUSE ACTIVITY (PadSpan Pro) — an option of Playback. Turn it on and the map becomes your Atlas, with the tracked devices playing back on it. The same period, play and Run time controls drive it."),
      t("💡 DEVICES — appears once Full house activity is on. Turn it on to replay the house as well: lights, locks and motion drawn on the Atlas, doors and windows linked to a wall, and the temperature, humidity and air-quality readings of sensors placed on the map. A reading counts when it moves a whole degree or percent, or its air-quality level changes."),
      t("Each device that changed at the moment on screen is ringed on the map (a door or window along its wall) and named above it. The list under the map shows every change; tap one to jump there. House history comes from Home Assistant's recorder, so it reaches back as far as your recorder keeps (10 days by default); tracked devices keep 7 days."),
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
      t("Each Scanners row also has these buttons. \"RSSI offset\" and \"Set\": a correction in dB added to everything it hears, positive if it reads weaker than it should (the same value as the Receivers page and Settings → Tracking → Receivers). \"Relearn\": after an antenna change, shifts its saved calibration readings by the gain you enter, + for better, − for worse. \"Exclude\" / \"Include\": leave it out of positioning without deleting anything. \"Min signal\": ignore anything it hears weaker than the level you pick, for positioning and the occupancy count only; handy for a receiver on an outside or shared wall (the lists still show everything)."),
      t("\"Reset\" erases what PadSpan stored for that receiver: its offsets, its pins on the floor plans and its learned patterns, and its readings from every calibration point. A point left with no readings is deleted. It asks first, but no backup is taken, so make one in Manage → Data first if you might want them back."),
      t("\"Find the one in your hand.\" (beside a selected receiver) finds which device is yours: pick \"Louder\" and hold the device against the receiver for about 20 seconds, or \"Quieter\" and hide it in a metal bin or saucepan, then press \"Start\". The devices that changed are listed so you can tag yours."),
      t("Rooms: a receiver's room is set in Overview → \"View radios list\" → \"Assign\" or \"Change\", or in Mapping → Edit → Radios → \"Room\" (Advanced and Development modes). Bluetooth, the Rooms page and the Receivers page show it but don't change it. The receiver details window (from Visualisation, QA → Radio Analysis or Monitor) shows its room, network, the devices it hears, and \"Mark as Lost\" / \"Mark as Disabled\"."),
      t("IRK MANAGER — adds and checks the IRKs that let PadSpan recognise a phone or watch through its address changes (see the Phone Tracking (Private BLE) help). Paste a key under \"Add an IRK\" (\"Add & validate\", or \"Test only\" to check it first), or press \"Auto-detect IRKs\" to pick up keys from devices already paired with your Home Assistant computer. With Settings → Features → \"Phone Setup Wizard\" (or \"iPhone Setup Path\") on, in Advanced and Development modes, \"Track your phone\" offers three guided ways in: \"I have an IRK Capture ESP32\" (\"Scan for IRK Capture devices\" collects the keys such a board captured; the tool is at https://github.com/DerekSeaman/irk-capture), \"I have an Android phone\" (use the Companion app's BLE Transmitter; no key needed) and \"I have an iPhone\"."),
      t("ESPHOME CONFIGS — ready-made ESPHome settings (YAML) for building your own receiver from an ESP32 board, with copy buttons, plus antenna and board suggestions."),
    ],
  },

  // ── Health ────────────────────────────────────────────────────────────
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
      t("CALIBRATION — no calibration points at all (critical: start 🧭 Guided calibration in Calibration), or calibration getting old: info after 60 days, a warning after 90. Furniture and devices change over time, so walk the house again now and then."),
      t("PROPAGATION — a room whose learned signal pattern is unsteady (warning: look for things nearby that interfere, such as Wi-Fi access points, microwaves and USB 3 devices, and add calibration points), or \"Adaptive learning is disabled\" (info: turn it on in Settings → Tracking, in Advanced and Development modes, so PadSpan keeps improving by itself)."),
      t("Under the list: \"Room mix-ups\" shows up to 15 room pairs with the most moves back and forth (\"Transitions\") and their share of all room changes (\"Rate\"). \"Map Calibration Quality\" shows each floor plan's calibration points with the average and the worst error, amber from 1.2 m and red from 2.25 m."),
      t("For experts: MAP QUALITY and Map Calibration Quality use leave-one-out cross-validation (each calibration point predicted from the others); PROPAGATION flags a room whose average RSSI variance is over 25."),
    ],
  },

  diagnostics: {
    title: t("Diagnostics — a report to send to support"),
    body: [
      t("Diagnostics isn't in the menu: open it from QA → \"Go to Diagnostics\". It puts a short report in a box: the panel's and the server's versions, PadSpan's status, your rooms and floor plans, your own devices seen in the last 24 hours (the ones you named, the ones linked to Home Assistant, and phones PadSpan knows by their key), and the automatic checks."),
      t("\"Select All\" selects it, \"Copy\" copies it, and \"Download Report\" saves it as a file. Email it to hello@traks.ca, or attach it to a GitHub issue (GitHub issues are public, so remove personal details first). It names your rooms, floor plans and devices, with their Bluetooth addresses, so look it over before you send it (phones' identity keys, their IRKs, are left out). Monitor → \"Export for support\" builds a fuller report the same way."),
      t("\"Install Verification\" — if the panel's version and the server's differ, your browser is showing an old copy (press Ctrl+F5) or Home Assistant has two copies of PadSpan installed (for example one from HACS and one copied by hand): remove the extra one and restart Home Assistant."),
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
      t("Open (Loft) marks an opening with no wall, such as a gallery over a hall. In Live Aboard an open edge over a hall that rises past it (a mezzanine or gallery, with the floor kept at its normal height in Floor Heights and the hall given its full height on the Rooms page (Ceiling height) or with Rises to on Mapping → Layout) is drawn with a railing."),
      t("📏 MEASURE — Click two points you know the real distance between, type it in metres and click Add 1st Measurement; do it again at a different angle, then click Save Scale. If the two disagree, the picture is stretched. Start Over clears them."),
      t("SUB-ZONES — Draw an area inside a room (a bed, a couch, a desk) that gets its own occupied and who sensors in Home Assistant. Off until you tick its line (binary_sensor.padspan_…_occupied) under Manage → HA Entities."),
      t("ROTATE IMAGE and TRIM IMAGE (administrators) — Rotate Image turns the picture: -90°, -15°, -5°, +5°, +15°, +90° or back to 0°, then Apply Rotation. Rooms and receivers turn with it; if PadSpan can't keep the scale, it asks you to measure again. Rotate before drawing rooms if you can: walls that run along the screen's edges stack best in 3D. Once a plan is tied to another in 3D Stack, Rotate Image is hidden. Trim Image crops the picture (drag, then Apply Trim)."),
      t("Suggest Placement shows where one more receiver would help most; Clear Suggestion hides it."),
    ],
  },

  // ── Occupancy and Guests ────────────────────────────────────────────────
  occupancy: {
    title: t("Occupancy — how many people are home"),
    body: [
      t("Occupancy counts people, not devices. It is in the main list in Advanced and Development mode and under More tools in Basic; the same number is the \"People in building\" card on the Overview (Advanced and Development)."),
      t("Known people come from your Home Assistant person entities. Unknown people come from phones nobody has claimed, and from rooms whose occupancy or motion sensors say someone is there when no known person is. Named things (keys, tags) are listed under \"Seen, not people\" but never counted."),
      t("At the top: the count, a possible range when it isn't sure, how confident it is, and counts of known and unknown people, phones heard, sensed rooms and things. \"Counted\" lists each person and how they were found, and \"Rooms with evidence\" and \"How the number was reached\" show the working. An \"Unknown phone\" has its own ? help."),
      t("\"Hybrid counting\" also uses person entities and occupancy and motion sensors; untick it to count phones only. \"Phone clustering\": phones heard at nearly the same strength by every receiver count as one person (a phone and its watch). A lower threshold groups more strictly; \"Save & Refresh\" applies it."),
      t("\"Record the real count\": type how many people are really in the building and press Save. It is kept beside what the estimate said, and the \"Accuracy\" card shows how often the two agree."),
    ],
  },

  // ── Unknown phone (Occupancy's Counted list) ────────────────────────────
  unknown_phone: {
    title: t("Unknown phone — what it is and what to do"),
    body: [
      t("An Unknown phone is a phone or watch PadSpan can hear in that room but can't tie to anyone. Phones change their Bluetooth address every few minutes for privacy (iPhones and most Androids do), so on its own the signal says \"a phone is here\" but not whose."),
      t("IF IT'S YOURS (or someone who lives with you): let PadSpan know the phone. An Android phone: track it with the Overview's \"Track Your Phone\" card (the Companion app's BLE Transmitter). An iPhone: add its IRK with Home Assistant's Private BLE Device integration or in Bluetooth → IRK Manager. After that it's counted as that person."),
      t("IF IT'S A VISITOR: nothing to do. It goes when they do."),
      t("IF IT'S A NEIGHBOUR through the wall: it has to be heard by two or more of your receivers, fairly strongly, to be counted. A receiver on a shared wall makes that easy. Move that receiver away from the wall, draw that wall as a stronger material in Mapping → Edit → Signal walls, or give that receiver a minimum signal in Bluetooth → Scanners (\"Ignore < -85\", say): it then ignores anything weaker for positioning and this count, while every list still shows everything."),
    ],
  },

  // ── Walk-to-Identify ────────────────────────────────────────────────────
  walk_to_identify: {
    title: t("Walk-to-Identify \u2014 Who's in which room?"),
    body: [
      t("Walk-to-Identify helps you work out which unnamed Bluetooth device belongs to whom, without reading addresses. It is off until you turn it on in Settings → Features → Walk-to-Identify, and it works in Live mode only."),
      t("It is in Devices → By Room, as a purple walk-to-identify bar: in the \"Unidentified\" card in Basic mode, above the table in Advanced and Development."),
      t("Have the person stand in a room with their phone, pick that room and press \"Who's here?\". PadSpan ranks the unnamed devices by how much more strongly that room's receivers hear them than the other receivers do, from the last 30 seconds of signals."),
      t("The best matches get a purple \"Likely in [room]\" badge with a match percentage. Press Tag on one to name it. \"Clear\" ends the search."),
      t("It needs a receiver in that room (one whose Home Assistant area is that room), and works best with receivers spread over several rooms."),
    ],
  },

  // ── Maps 3D Stack ──────────────────────────────────────────────────────
  maps_stack: {
    title: t("3D Stack — Floor heights and lining up floors"),
    body: [
      t("3D Stack (Advanced) says how your floors sit on top of each other: how tall each one is, which plan belongs to which floor, and where each plan sits over the one below. It matters for telling floors apart and for every 3D view. With a single plan there is nothing to line up, but floor heights still count."),
      t("FLOOR HEIGHTS — One row per floor. Floor↕ (m) is floor-to-floor height; blank means 2.8 m. Base elevation (m) is how high the floor starts; blank means it's worked out from the floors below. Click Save Floor Heights. For one tall room (a double-height living room), keep the floor's normal height here and give that room its full height on the Rooms page (Ceiling height), or with Rises to on Mapping → Layout: both are the same value."),
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
