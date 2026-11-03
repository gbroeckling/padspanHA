# The stable after 0.38.199: guided Setup, Receivers and Rooms pages, one name for each device, no online maker lookup, railings only where you choose, and fixes

### Start here
- **This is everything since 0.38.199 in one go,** written as how it works now. The betas' notes under it are steps along the way; where they differ, this one is right.
- **Coming from 0.38.166 or older?** The changes before these are in 0.38.199's notes, under Full history on padspan.traks.ca.

### Things you'll notice
- **Setup, one step after another.** Plan, scale, floor heights, rooms, receivers, then calibration. Each step says whether it's done, and you can skip one and come back. Open it from the Overview's Getting started card or the Setup button on Mapping.
- **Calibration opens on Results:** how accurate your house is now, which rooms need work, and the one next thing to do. Every other tab is still there, and Calibration is in Basic mode too.
- **A Receivers page.** Every Bluetooth receiver in one table: room, height, signal adjustment, status and how many devices it hears.
- **A Rooms page.** Every room under its floor, with its colour, outline, ceiling height, split level, receivers and who is in it. Names and floors still come from Home Assistant's Areas.
- **A status dot in the top bar** when something is wrong: red when something is broken, amber when something needs a look, nothing when all is well. Click it to open Health.
- **One name for each device, on every screen.** The name you gave it comes first, then the phone's or Home Assistant device's name, the name it broadcasts, and its maker ("Samsung device"). The address sits underneath. Where you pick a device, a name that is only a maker gets the end of its address: "Apple device · 8A:3B:63".
- **What a device is.** Windows PC, AirTag, AirPods, Tile, SmartTag and others are read from the device's own broadcast, and the device window says how PadSpan knows. Apple's broadcasts mostly don't say iPhone, iPad, Mac or Watch, so those read "Apple device". A Fixed or Rotating badge shows what a receiver said about the address.
- **Shorter device lists.** Devices, By Room and All objects gather the rotating addresses nobody named by kind ("169 Windows PC addresses"), and older rows fade. Nothing is deleted: click the line, or search.
- **A name can follow a device whose address changes.** A device you named or follow, with no IRK or fixed ID, can keep its name and its row on a new address. That takes strong evidence: it started as the old one stopped, with the same name or data, maker and kind, heard by at least two of the same receivers, and nothing else fits.
- **When it's close, it asks.** One quiet line says "This looks like Car Keys: same device?" A No is remembered for that address, though a device that keeps changing can be asked about its next one. The question closes itself if the old address comes back. "Now on ..." has Undo, and all of this survives a restart.
- **Following a name only moves what's on screen.** Calibration, learning, Follow's alerts and Home Assistant's sensors stay on the first address, so a wrong link can't mix another device's signal into them.
- **West Coast Forest, a new Showcase theme (Pro key).** Dark colours for the whole map, and on the flat Atlas a forest of fir, cedar and hemlock round the house, behind everything on the map. Pick it in Showcase options → Theme.
- **Live Aboard on a wall screen (`?kiosk=1`) is sharp and fills the screen.** It draws every pixel, softer only while turning if the graphics chip needs that; a chip too slow for that draws about 1440p's worth, or on Auto goes to Low. **Low** chosen in Settings stays Low. If turning by hand runs the house past the edge, **Fit** brings it back. Home Assistant's sidebar is hidden on that browser; **Show HA** on the Atlas page (without `?kiosk=1`) brings it back.
- **Choosing a floor on the flat Atlas fades the others,** so what looks tappable is tappable. Floor badges and leak or open-window rings stay bright. A saved floor now applies when the page opens.
- **In Live Aboard,** a motion sensor's reach is a soft pool of light, and a raised marker moves clear of the words around it. Stored heights and spots don't change.
- **A backup AI Task** in Settings → AI, used for photo and stair reads only when the main one can't be reached. There's no backup until you pick one.
- **The help was rewritten for every screen,** with "?" buttons where there were none, in English, German, French and Dutch.
- **Preview a finished house** shows a three-storey sample house on every screen. Nothing in it can be changed or saved. If you see a house you don't recognise, you're in Sample mode: press **Live** in the top bar.

### Where things moved
- **More tools.** Every screen is in the menu in every mode now. Devices, Bluetooth, Presence, Monitor, QA, Sandbox and Install Base are in a **More tools** group at the bottom. In Basic, Live Tracker, Occupancy, Manage, Traceback and Health are there too. Opening one never changes your mode.
- **Pure Live is now Live Tracker.** Links and settings are the same.
- **The menu's Setup group is now Build, and Mapping's Rooms tab is now Layout.** The guided Setup keeps its name.
- **Settings → Presence is now Settings → Tracking,** in eight sections you can fold. No setting or default changed, though some have plainer names.
- **Settings → Atlas** is a new tab with everything about the Atlas, Live Aboard and wall screens, moved from UI Structure.
- **Quiet mode is switched with the Quiet tick at the top of the Overview.** Its card in Settings says whether it's on and takes you there.
- **"Aggressive BLE reseed (5s)"** is in Settings → Tracking → Receivers.
- **Plain names for expert words,** such as Error Matrix → Accuracy by spot, RF Barriers → Signal walls, Isolux → Light spread and Diag Export → Export for support.
- **The Overview's Objects list is now All objects.**
- **Monitor → Quick status and Manage → History** now point to Health and History. Manage → Events' room log, which never filled, is now a button to History → Movement.

### What works differently
- **Railings only where you choose them.** A new stair has no rail until you pick Both, Left or Right (Inside or Outside on a turn) on its panel in Furnish, with two new styles, Topless and Single bar. A new Open (Loft) edge has none until you press Railing on its row in Signal walls.
- **Your railings were converted, so nothing looks different.** Stairs you have keep the rail they showed, as their own setting. Open edges keep theirs, and it becomes their own setting the first time you Save in Live Aboard; one railed on only part of its length stays as it is until you choose.
- **Open edges, for rooms with no wall between them.** In Mapping → Edit → Signal walls, **Open edge: tap a room edge** opens one edge, **Open all edges** a whole room, and **Remove open edges** takes them back. If a signal wall runs along an edge, PadSpan asks first: that stretch of wall goes, and positions near it can shift.
- **Occupancy matches wearables by their real company numbers.** Garmin, Polar, Oura and Withings now count; Logitech, hearing aids and others the old table mislabelled don't. This hasn't been checked with real wearables yet, and a watch left on a charger can count as a person, so your count may move a little.
- **Vacation Mode replays last week.** Each day of a new trip plays like the same day last week. For the old way, pick **Monthly average** under Options → Routine from. A trip already running when you update keeps its routine, and so does one you turn back on within 3 weeks.
- **Vacation Mode has new options,** all off until you set them: evening lights (up to 10), a limit on lights on at once, and a preview of the next 24 hours.
- **Moving a beacon keeps more of your calibration.** Beacon Tune's hard relocation deletes only that beacon's earlier Beacon Tune and [auto] points, not Pin & Listen, Roam, Walk a room or Calibration Guide points. Points from before this update are kept too, so if a moved beacon keeps showing at its old spot, delete those by hand.
- **Placing on a chosen floor.** With a floor chosen in Mapping, a light from another floor isn't placed: it says which floor to choose and stays in the queue. A door or window circle fades with its floor; choose that floor to drag it.
- **A device you named, pinned, calibrated or are following is never merged with another on a guess.** It keeps its own row.
- **A receiver goes by one name on screen:** the one set on its ESPHome or Shelly device. What calibration already saved under it stays as it was.
- **Photo reads are quicker.** A quick look names the kind first, and photos are sent at 1024 px.
- **Sample mode is per browser.** A house left in Sample mode before the update stays in it, showing the sample house, until someone presses Live.
- **In Basic, a link opens just the part it's about,** with a "← Back", and you stay in Basic.
- **Getting started's Calibrate tick needs real calibration** (five points or a computed model). A card you already finished or skipped stays away.
- **Point Align and Compare Maps give their errors in metres.** The ratings are the same.
- **Forensics' CSV has two new columns at the end,** `best_name` and `what_it_is`. The others stay as they were.

### Experimental, and off by default
- **Add data via plans (experimental).** In Live Aboard's Edit → Plans, your AI reads the floor plans you tick for stairs and railings, and lists what it finds on a map for you to check one item at a time. There is no "accept all". Nothing is kept until you press Save, and one undo takes a whole session back.
- **What it can touch.** It writes only your 3D house, after a safety backup, and never your map, rooms, walls, floors, scale, settings or calibration. If you ask it to read lights on a plan, it can only change how a light you already placed is drawn; it never adds or moves one.
- **What it needs.** A Pro key and an AI Task. Plans go only to the AI Task you chose, or to your backup when that one is away, and a read can keep that AI busy for up to 8 minutes. A smoke, gas, CO or leak alarm still shows over the map.
- **One switch: Settings → AI → AI map-building research (experimental).** It covers the plans tool and the stair finder, and off hides both. If you had the stair finder on when you updated, the switch comes up on, so you keep it. If not, the stair finder stays hidden until you turn the switch on.
- **The stair finder lands stairs where they're drawn.** On a tall plan, a local AI's stairs landed metres away or went missing, and a stair with a landing was thrown out. It's still a first guess to check.

### Privacy
- **The online maker lookup is gone, and nothing is sent.** 0.38.199 sent whole Bluetooth addresses to macvendors.com and maclookup.app when the Objects list opened. Makers now come from lists built into PadSpan (Bluetooth's company and service numbers, and IEEE's address list), on your own machine. Its switch has gone too, and the first start removes the answers it kept.
- **"Probably" where nobody can be sure.** IEEE's list counts as fact only for an address a receiver has confirmed is fixed (ESPHome from 2022.12 and Home Assistant's own Bluetooth say so). With Shelly, ESPresense or Tasmota a match reads "Probably Espressif". A random address is never looked up.
- **Hashes of phone numbers, emails and Apple IDs in Apple's broadcasts are no longer kept,** in new adverts or in what history already holds. Nothing ever read them.
- **Support reports hide phones' identity keys,** and Diagnostics lists only your own devices. Reports still name your rooms, plans and devices' Bluetooth addresses, so look them over before you send one. A device's "Copy raw broadcast" hides any IRK and your label.

### Fixes
- **Device makers are right.** The old company table had 36 of its 53 entries wrong: Samsung showed as "Beats Electronics". It's replaced by Bluetooth's full list. A company that only holds a service number reads "Uses a service from Google", not as the maker.
- **A rain sensor that has stopped reporting no longer makes it rain.** If its device's Last seen is over 3 hours old, PadSpan goes by the weather entity, and Settings says so.
- **The emergency banner shows on Mapping too.**
- **A device's id in Home Assistant no longer grows or moves.** Existing ids stay as they are.
- **Open walls store 0 dB when saved.** One an old path saved at 6 dB counts 6 dB until you save it again. Saving a signal wall no longer moves it to the end of the list.
- **Screens that fit.** Tabs no longer jump when clicked, fields stay inside their cards, Monitor, QA, Sandbox, Health and Diagnostics use the width of the screen, and tall plans fit the window on Pin & Listen, Roam and Model. Phone layouts are fixed on Devices, Presence, Bluetooth, Health, Manage, Sandbox and Mapping.
- **There's a menu at window widths from 901 to 1100 px.**
- **Mapping's Edit tools.** The highlight follows the tool you're using, the Set the scale step opens on Measure, and names on the map stay a normal size.
- **Floors go by their names,** not internal ids, and the 3D Isometric Preview names the right floors.
- **Colours.** Rooms no longer draw solid black in the Library and 3D Stack. Day and Light themes no longer have dark-on-dark boxes, pale Bluetooth colours or solid black checkboxes. The support report's text can be read, and the 3D map's floors no longer hang dark shafts over the floors below.
- **Sample mode.** It no longer closes what you opened, or shows your own rooms on the sample house while Home Assistant is slow to answer.
- **The Atlas.** A mouse click on a light's ⋯, Hide or Show no longer switches the light, and hiding the controls can be undone without a reload.
- **Vacation Mode's Options box scrolls** instead of hiding Evening lights and the preview.
- **Bluetooth → Advertisements says only what it knows,** and a made-up UUID no longer reads as a real service.
- **Calibration and receivers.** Stop & Discard no longer leaves a capture running, and a signal adjustment past ±20 dB is no longer cut when you press Save without changing it.
- **Compare Maps** no longer shows nothing when a plan has rooms but isn't placed yet, and **Diagnostics** lists your devices again.
- **A wall turned by its link (`&wall_rotate=90` or `270`)** uses the whole screen, and draws the forest correctly.
- **Manage → HA Entities** names the occupancy sensor correctly: `sensor.padspan_occupancy_occupancy`.
- Holding a light on the map to dim it is no longer cut short by an update, and Track Your Phone's search no longer fails because of one phone.
- A very large home stays quick while looking for a named device's new address. A link can come a little later, never differently.
- The third-party notices now come with the download. Fewer warnings in the Home Assistant log.

### Before you roll back
- **Going back to 0.38.199 brings the online lookup back.** Opening the Objects list sends whole Bluetooth addresses again, unless the lookup was off when you updated: that choice is kept. 0.38.199 has no switch for it on screen.
- **On 0.38.199, Beacon Tune's hard relocation deletes carried-device points again.**
- **0.38.199 doesn't know the new railing choices.** An open edge over a drop gets its glass railing back, and stairs draw their rail in the old style. A stair set to no rail stays that way.
- **West Coast Forest shows as Classic.**
- **What you kept from plans stays in your 3D house,** but the plans tool and its undo aren't there.
- Nothing else needs a newer version. What this one stores that older ones don't know (name links and answers, Beacon Tune's marks, the Vacation Mode choice, Setup's progress) is ignored by them, and a running trip's routine still plays.

### If something looks different
- Can't find a screen? Open More tools at the bottom of the menu.
- Settings → Presence is Settings → Tracking. Mapping → Rooms is Mapping → Layout. The menu's Setup group is Build.
- Calibration opens on Results; the tab you used is still in the tab bar.
- A new stair has no rail? Pick one on its panel in Furnish.
- Stair finder gone? Settings → AI → AI map-building research (experimental).
- People count moved a little? See Occupancy above.
- Vacation lights following a different pattern on a new trip? Options → Routine from → Monthly average brings back the old routine next time.

### Usage report (if you share it)
New counts, never names, places, plans or addresses:
- how far people get through Setup, and which Calibration Results buttons are used
- opening More tools, the Receivers and Rooms pages, and the status dot
- Vacation Mode's routine choice and which options are set (yes or no)
- photo quick looks, backup AI Task use, and how a wall screen ended up drawing
- how many devices have a real name, a maker and a type, and what the wearable change did to the estimate
- names that followed a device: links made, questions asked, yes, no, undone and proved wrong
- open edges, railings brought over, and a rain sensor that went quiet
- the plans tool, only when its switch is on: reads, what was suggested, each verdict and undo
