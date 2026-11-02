# The stable after 0.38.199: guided Setup, Receivers and Rooms pages, Calibration results, Vacation Mode replays last week, and fixes

If you're on the stable channel, this is everything from 0.38.200 to 0.38.216 in one go. Coming from 0.38.166 or older? The changes before these are in 0.38.199's notes, under Full history on padspan.traks.ca.

### Things you'll notice
- **Setup, one step after another.** Upload a plan, set its scale, give the floors their heights, draw the rooms, place the receivers and their heights, then calibrate. Each step says whether it's done, and you can skip one and come back. Open it from the Overview's Getting started card or the Setup button on Mapping.
- **Calibration opens on Results:** how accurate your house is now, which rooms need work, and the one next thing to do, with a button to it. Every other tab is still there.
- **A Receivers page.** Every Bluetooth receiver in one table: its room, height, signal adjustment, status and how many devices it hears. Height and signal adjustment can be changed right there.
- **A Rooms page.** Every room under its floor, with its colour, outline, ceiling height, split level, receivers and who is in it. Names and floors still come from Home Assistant's Areas.
- **A status dot in the top bar** when something is wrong: red when something is broken, amber when something needs a look. Nothing shows when all is well. Click it to open Health.
- **Calibration is in Basic mode**, with the same tabs as in Advanced.
- **A backup AI Task** in Settings → AI. Photo and stair reads use it only when the main one can't be reached. There's no backup until you pick one.
- **The help was rewritten for every screen**, with "?" buttons where there were none, in English, German, French and Dutch.
- **Preview a finished house** shows a three-storey sample house on every screen of the panel. Nothing in it can be changed or saved. If you see a house you don't recognise, you're in Sample mode: press **Live** in the top bar.

- **Live Aboard on a wall screen (`?kiosk=1`) is sharp and fills the screen.** On Auto or High it draws every pixel the screen has. If the graphics chip can't turn the house smoothly at that size, the picture is softer only while the camera moves, and sharp again when it stops; a slower chip draws about 1440p's worth, or on Auto goes to Low. **Low** chosen in Settings stays Low. The whole house is framed as large as the screen allows, so turning or tilting it by hand can run part of it past the edge: **Fit** or going home brings it back. Home Assistant's sidebar is hidden on that browser too; **Show HA** on the Atlas page (without `?kiosk=1`) brings it back.

### Where things moved
- **More tools.** Every screen is in the menu in every mode now. Devices, Bluetooth, Presence, Monitor, QA, Sandbox and Install Base are in a **More tools** group at the bottom of the menu. In Basic, Live Tracker, Occupancy, Manage, Traceback and Health are there too. Opening one never changes your mode.
- **Pure Live is now Live Tracker.** Links and settings are the same.
- **The menu's Setup group is now Build, and Mapping's Rooms tab is now Layout.** Same screens, new names. The guided Setup keeps its name.
- **Settings → Presence is now Settings → Tracking,** in eight sections you can fold. No setting or default changed, though some have plainer names (Signal smoothing, Bluetooth refresh interval, Receiver signal adjustments).
- **Settings → Atlas** is a new tab with everything about the Atlas, Live Aboard and wall screens, moved from UI Structure.
- **Quiet mode is switched with the Quiet tick at the top of the Overview.** Its card in Settings says whether it's on and takes you there.
- **"Aggressive BLE reseed (5s)"** is in Settings → Tracking → Receivers, next to the Bluetooth refresh interval.
- **Plain names for expert words,** such as Error Matrix → Accuracy by spot, RF Barriers → Signal walls, Isolux → Light spread and Diag Export → Export for support.
- **Monitor → Quick status and Manage → History** now point to Health and History, which have all of it. Manage → Events' room log, which never filled, is now a button to History → Movement.

### What works differently
- **Vacation Mode replays last week.** Turned on after this update, each day plays like the same day last week, half hour by half hour. For the old way, pick **Monthly average** under Options → Routine from. A trip already running when you update keeps its routine, and so does one you turn back on within 3 weeks. The choice applies to the next new trip.
- **Vacation Mode has new options,** all off until you set them: evening lights (up to 10 lights kept on over the stretch they were really on in the evening), a limit on lights on at once, and a preview of the next 24 hours.
- **Beacon Tune's hard relocation keeps the points you collected by carrying the device.** Replacing a moved beacon's data now deletes only its earlier Beacon Tune and [auto] points, not those from Pin & Listen, Roam or Walk a room. Beacon Tune points saved before this update are kept too, so if a moved beacon keeps showing at its old spot, delete those points by hand.
- **Photo reads are quicker.** A quick look names the kind first, and photos are sent at 1024 px instead of 1280.
- **Sample mode is per browser.** Turning on the preview on one screen no longer switches every screen in the house. A house left in Sample mode before the update stays in it, showing the sample house, until someone presses Live.
- **In Basic, a link opens just the part it's about,** with a "← Back", and you stay in Basic.
- **Getting started's Calibrate tick needs real calibration** (five points or a computed model). A card you already finished or skipped stays away.
- **Point Align and Compare Maps give their errors in metres,** not percentages. The ratings are the same.

### Privacy
- **The device maker lookup sends only the maker part of an address** (the first three bytes, such as AA:BB:CC), and only for devices a receiver confirms have a fixed, maker-assigned address. Random addresses, the kind phones use, are never sent. 0.38.199 sent whole addresses. Shelly, ESPresense and Tasmota receivers can't confirm that, so in a house with only those, new makers show as unknown.
- **It has a switch:** Settings → Tracking → Privacy, updates and feedback → Look up device makers online, or the top of the Overview's All objects list. Only an administrator can change it. It's still on by default. Factory Reset now erases what it learned.
- **Support reports hide phones' identity keys,** with "irk:hidden-1" and so on in their place. Diagnostics lists only your own devices, not everything nearby. Reports still name your rooms, plans and devices' Bluetooth addresses, so look them over before you send one.

### Fixes
- A mouse click on a light's ⋯, Hide or Show in the Atlas's list no longer switches the light.
- Hiding the Atlas's controls can be undone without a reload, on wall screens too.
- There's a menu at window widths from 901 to 1100 px.
- Vacation Mode's Options box scrolls instead of hiding Evening lights and the preview in side columns.
- Rooms no longer draw solid black in the Library and 3D Stack, the support report's text can be read, and the 3D map's floors no longer hang dark shafts over the floors below.
- Day and Light themes: dark-on-dark boxes, pale Bluetooth colours and solid black checkboxes are fixed. Phone layouts on Devices, Presence, Bluetooth, Health and Manage are fixed.
- Stop & Discard during a calibration capture no longer leaves the capture running.
- A receiver signal adjustment past ±20 dB (from 1 m Reference Calibration) is no longer cut to ±20 when you press Save without changing it.
- Holding a light on the map to dim it is no longer cut short by an update.
- Compare Maps no longer shows nothing when a plan has rooms but isn't placed yet.
- Diagnostics lists your devices again.
- A wall turned by its link (`&wall_rotate=90` or `270`) uses the whole screen.
- Manage → HA Entities names the occupancy sensor correctly: `sensor.padspan_occupancy_occupancy`.
- Track Your Phone's search no longer fails because of one phone.
- Fewer warnings in the Home Assistant log.

### Before you roll back
- **0.38.199 and older send whole Bluetooth addresses to the maker lookup.** The on/off setting carries over, so if that matters to you, turn the lookup off before you go back.
- **On an older version, Beacon Tune's hard relocation deletes carried-device points again.**
- Nothing else needs a newer version. What this one stores that older ones don't know (Beacon Tune's marks on its points, the Vacation Mode choice, Setup's progress) is ignored by them, and a running trip's routine still plays.

### If something looks different
- Can't find a screen? Open More tools at the bottom of the menu.
- Settings → Presence is Settings → Tracking. Mapping → Rooms is Mapping → Layout. The menu's Setup group is Build.
- Calibration opens on Results; the tab you used is still in the tab bar.
- Vacation lights following a different pattern on a new trip? Options → Routine from → Monthly average brings back the old routine next time.

### Usage report (if you share it)
New counts, never names, places or values:
- how far people get through Setup, and which Calibration Results buttons are used
- opening More tools, the Receivers and Rooms pages, and the status dot
- Vacation Mode's routine choice and which options are set (yes or no)
- photo quick looks and backup AI Task use
- whether the maker lookup is on
- how a wall screen ended up drawing (every pixel, every pixel but less while moving, about 1440p's worth, or Low)
